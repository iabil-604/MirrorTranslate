import test from 'node:test';
import assert from 'node:assert/strict';

import { collectBackgroundLayers, summarizeRaster } from '../theme-probe.js';
import { blendOver, computeSafeBand, meetsContrast, parseCssColor, toHex } from '../palette.js';

// A minimal stand-in for the parts of the DOM the probe reads.
function fakeTree(nodes) {
  let child = null;
  for (const node of [...nodes].reverse()) {
    const element = {
      nodeType: 1,
      id: node.id ?? '',
      className: node.className ?? '',
      tagName: (node.tag ?? 'DIV').toUpperCase(),
      parentElement: null,
      style: { backgroundColor: node.background ?? 'rgba(0, 0, 0, 0)', backgroundImage: node.image ? `url("${node.image}")` : 'none', opacity: node.opacity ?? '1' },
    };
    if (child) child.parentElement = element;
    child = child ?? element;
    if (element !== child) element.child = child;
    node.element = element;
  }
  for (let index = 0; index < nodes.length - 1; index += 1) nodes[index].element.parentElement = nodes[index + 1].element;
  return { leaf: nodes[0].element, window: { getComputedStyle: element => element.style } };
}

test('background layers stop at the first opaque colour and keep alpha for the rest', () => {
  const { leaf, window } = fakeTree([
    { id: 'mes_text', background: 'rgba(0, 0, 0, 0)' },
    { className: 'mes', background: 'rgba(255, 255, 255, 0.08)' },
    { id: 'chat', background: 'rgba(20, 22, 28, 0.6)' },
    { id: 'sheld', background: '#101014' },
    { tag: 'body', background: '#ffffff' },
  ]);
  const layers = collectBackgroundLayers(leaf, window);
  assert.deepEqual(layers.map(layer => layer.selector), ['.mes', '#chat', '#sheld']);
  assert.equal(layers.at(-1).color.a, 1, '最底层是不透明色，再往上就不必看了');
  assert.equal(layers[0].color.a.toFixed(2), '0.08');
});

test('an element opacity multiplies into the layer it paints', () => {
  const { leaf, window } = fakeTree([
    { id: 'mes_text', background: 'rgba(0, 0, 0, 0)' },
    { id: 'chat', background: 'rgba(0, 0, 0, 0.5)', opacity: '0.5' },
    { tag: 'body', background: '#ffffff' },
  ]);
  assert.equal(collectBackgroundLayers(leaf, window)[0].color.a.toFixed(2), '0.25');
});

test('a wallpaper is summarised by its dark, median and bright regions, not its average', () => {
  const pixels = [
    ...Array.from({ length: 50 }, () => parseCssColor('#101014')),
    ...Array.from({ length: 50 }, () => parseCssColor('#808080')),
    ...Array.from({ length: 50 }, () => parseCssColor('#f2f2f2')),
  ];
  const summary = summarizeRaster(pixels).map(toHex);
  assert.equal(summary.length, 3);
  assert.equal(summary[0], '#101014');
  assert.equal(summary[2], '#f2f2f2');
  assert.equal(summarizeRaster([]).length, 0);
  // One stray highlight must not decide the palette for the whole image.
  const withSpeck = summarizeRaster([...Array.from({ length: 400 }, () => parseCssColor('#1b1b22')), parseCssColor('#ffffff')]).map(toHex);
  assert.deepEqual(withSpeck, ['#1b1b22', '#1b1b22', '#1b1b22']);
});

test('a translucent chat tint over a bright wallpaper still yields a readable palette', () => {
  const wallpaper = summarizeRaster([
    ...Array.from({ length: 30 }, () => parseCssColor('#c8d4e8')),
    ...Array.from({ length: 30 }, () => parseCssColor('#e8eef8')),
    ...Array.from({ length: 30 }, () => parseCssColor('#96a8c4')),
  ]);
  const tint = parseCssColor('rgba(12, 14, 20, 0.82)');
  const samples = wallpaper.map(bottom => blendOver(tint, bottom));
  const band = computeSafeBand(samples);
  assert.equal(band.feasible, true, band.note);
  assert.equal(band.direction, 'light', '压了一层深色底之后应该用亮字');
  for (const background of band.backgrounds) {
    assert.ok(meetsContrast(parseCssColor('#ffffff'), [background], band.minContrast));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { __testing } from '../index.js';
import { mergeSettings } from '../core.js';

const {
  renderChannelCards, syncChannelFields, syncDeskFields, syncDeskConnectionSummary,
  updateSummary, fillTtsChannelPickers, configureForTest,
} = __testing;

// A tiny DOM stand-in, same style and coverage as test/channel-cards.test.mjs's own makeElement/makeDoc
// (createElement/createTextNode, appendChild/append/replaceChildren, dataset, className,
// setAttribute/getAttribute, a tag-name-only querySelector) plus a couple of things this file's own
// functions touch that channel-cards.test.mjs's callers never did (per-node querySelectorAll and a
// recursive attribute walk, both used only to locate the handful of nodes these tests assert on).

function makeElement(tag, doc) {
  const el = {
    tagName: String(tag).toUpperCase(),
    ownerDocument: doc,
    dataset: {},
    attrs: {},
    className: '',
    textContent: '',
    type: '',
    hidden: false,
    checked: false,
    value: '',
    children: [],
    parentNode: null,
    setAttribute(name, value) { el.attrs[name] = String(value); },
    getAttribute(name) { return name in el.attrs ? el.attrs[name] : null; },
    appendChild(node) {
      if (node.parentNode?.children) {
        const at = node.parentNode.children.indexOf(node);
        if (at >= 0) node.parentNode.children.splice(at, 1);
      }
      node.parentNode = el;
      el.children.push(node);
      return node;
    },
    append(...nodes) { for (const node of nodes) el.appendChild(node); },
    replaceChildren(...nodes) {
      for (const child of [...el.children]) child.parentNode = null;
      el.children = [];
      el.append(...nodes);
    },
    querySelector(selector) {
      const match = matcherFor(selector);
      const search = node => {
        for (const child of node.children || []) {
          if (match(child)) return child;
          const found = search(child);
          if (found) return found;
        }
        return null;
      };
      return search(el);
    },
  };
  return el;
}

// A tag name, or one `[data-…]` / `[data-…="value"]` attribute selector read off the dataset — the only two
// shapes the functions under test look nodes up by.
function matcherFor(selector) {
  const attr = /^\[data-([a-z-]+)(?:="([^"]*)")?\]$/.exec(String(selector));
  if (attr) {
    const key = attr[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return node => Boolean(node.dataset) && key in node.dataset && (attr[2] === undefined || node.dataset[key] === attr[2]);
  }
  const tag = String(selector).toUpperCase();
  return node => node.tagName === tag;
}

function makeDoc() {
  const doc = {};
  doc.createElement = tag => makeElement(tag, doc);
  doc.createTextNode = text => ({ nodeType: 3, textContent: text, parentNode: null });
  return doc;
}

// Depth-first search for every descendant carrying a given dataset key (any value).
function collectByDatasetKey(node, key, results = []) {
  for (const child of node.children || []) {
    if (child.dataset && key in child.dataset) results.push(child);
    collectByDatasetKey(child, key, results);
  }
  return results;
}

// Depth-first search for the one node matching both dataset entries — used only to find a desk row's own
// toggle button by its channel id, the way syncDeskConnectionSummary's real selector does in the browser.
function findByDataset(node, matches) {
  for (const child of node.children || []) {
    if (child.dataset && matches(child.dataset)) return child;
    const found = findByDataset(child, matches);
    if (found) return found;
  }
  return null;
}

function makeConsoleRoot() {
  const doc = makeDoc();
  const usesBox = makeElement('div', doc); // [data-jy-connection-uses]
  const host = makeElement('div', doc); // [data-jy-channel-cards]
  const detail = makeElement('div', doc);
  const holder = makeElement('div', doc);
  detail.hidden = true;
  holder.hidden = true;
  const presetGrid = makeElement('div', doc); // just needs to exist so syncDeskFields does not bail out
  const presetDriftList = makeElement('ul', doc); // [data-jy-preset-drift-list]
  const deskList = makeElement('div', doc); // [data-jy-desk-connection-list]
  const channelSummary = makeElement('p', doc); // [data-jy-channel-summary]
  const deepSelects = [makeElement('select', doc)];

  const root = {
    dataset: {},
    querySelector(selector) {
      if (selector === '[data-jy-channel-cards]') return host;
      if (selector === '[data-jy-channel-detail]') return detail;
      if (selector === '[data-jy-channel-detail-holder]') return holder;
      if (selector === '[data-jy-preset-grid]') return presetGrid;
      if (selector === '[data-jy-preset-drift-list]') return presetDriftList;
      if (selector === '[data-jy-desk-connection-list]') return deskList;
      if (selector === '[data-jy-channel-summary]') return channelSummary;
      const toggle = /^\[data-jy-action="desk-toggle-channel"\]\[data-jy-channel-id="([^"]+)"\]$/.exec(selector);
      if (toggle) return findByDataset(deskList, d => d.jyAction === 'desk-toggle-channel' && d.jyChannelId === toggle[1]);
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-jy-channel-card]') return host.children;
      if (selector === '[data-jy-connection-uses]') return [usesBox];
      if (selector === '[data-jy-tts-field="deepChannelId"]') return deepSelects;
      return [];
    },
  };
  return { root, host, detail, holder, deskList, channelSummary, deepSelects, usesBox };
}

function testSettings() {
  const base = mergeSettings({});
  return {
    ...base,
    apiMode: 'independent',
    selectedChannelId: 'a',
    channels: [
      { id: 'a', name: 'Chan A', url: 'https://a.example/v1', model: 'model-a', models: [], key: '' },
      { id: 'b', name: 'Chan B', url: '', model: '', models: [], key: '' },
    ],
    tts: { ...base.tts, deepChannelId: 'follow' },
  };
}

// --- syncChannelFields({ rebuildCards: false }) keeps 「各功能用哪条连接」 in step ------------------------
// Review finding index.js:12626: the channel-field fast path only ever updated the open card's <h2>; a
// rename has to reach the pickers that name the connection too (DESIGN §17.1), without rebuilding the
// cards or the pickers' own rows.

test('syncChannelFields({ rebuildCards: false }) renames the open card and the pickers naming it, keeping every picker row in place', () => {
  const { root, host, usesBox } = makeConsoleRoot();
  const settings = testSettings();
  renderChannelCards(root, settings, 'a');
  configureForTest({ editingChannelId: 'a' });
  syncChannelFields(root, settings);

  const rows = [...usesBox.children];
  assert.deepEqual(rows.map(row => row.dataset.jyUseRow), ['translation', 'deep', 'helper'], '三行：翻译、分析模式、小助手');
  const pickers = rows.map(row => usesBox.querySelector(`[data-jy-use-row="${row.dataset.jyUseRow}"]`).querySelector('[data-jy-use-picker]'));
  assert.deepEqual(pickers.map(picker => picker.value), ['a', 'follow', 'follow'], '各自选中现在用的那一条');
  assert.equal(collectByDatasetKey(host, 'jyChannelUse').length, 0, '连接卡上不再有用途勾选');

  const renamed = { ...settings, channels: settings.channels.map(c => (c.id === 'a' ? { ...c, name: 'Renamed Chan' } : c)) };
  syncChannelFields(root, renamed, { rebuildCards: false });

  assert.deepEqual([...usesBox.children], rows, '行还是原来那几行，没有被换掉');
  const option = pickers[0].children.find(o => o.value === 'a');
  assert.match(option.textContent, /^Renamed Chan/);
  const heading = findByDataset(host, d => d.jyChannelCard === 'a').querySelector('h2');
  assert.equal(heading.textContent, 'Renamed Chan');
});

// --- updateSummary / fillTtsChannelPickers on the channel-field fast path ------------------------
// Review finding index.js:12626: the fast path used to call only syncChannelFields/syncDeskFields/
// syncFinetuneFields, so a renamed/re-modeled connection left the advanced 翻译台's own summary line and
// the 朗读/深度分析 pickers all showing the connection's old model — until something else happened to
// rebuild them (switching tabs did not).

test('updateSummary reflects a channel\'s current model/url once it is re-run, not whatever it read the first time', () => {
  const { root, channelSummary } = makeConsoleRoot();
  const settings = testSettings();
  updateSummary(root, settings);
  assert.match(channelSummary.textContent, /model-a/);
  assert.match(channelSummary.textContent, /https:\/\/a\.example\/v1/);

  const changed = { ...settings, channels: settings.channels.map(c => (c.id === 'a' ? { ...c, model: 'model-a2', url: 'https://moved.example/v2' } : c)) };
  updateSummary(root, changed);
  assert.match(channelSummary.textContent, /model-a2/);
  assert.match(channelSummary.textContent, /https:\/\/moved\.example\/v2/);
});

test('fillTtsChannelPickers refills 分析模式\'s selects and 「各功能用哪条连接」 for the connection\'s current name/model', () => {
  const { root, deepSelects, usesBox } = makeConsoleRoot();
  const settings = { ...testSettings(), tts: { ...testSettings().tts, enabled: true, mode: 'deep', deepChannelId: 'a' } };
  fillTtsChannelPickers(root, settings);
  assert.match(deepSelects[0].children.find(o => o.value === 'a').textContent, /model-a\b/);
  assert.equal(deepSelects[0].value, 'a');
  assert.equal(deepSelects[0].children.some(o => o.value === ''), false, '没有「和朗读分析用同一条」这一项了');
  const deepRow = usesBox.querySelector('[data-jy-use-row="deep"]');
  assert.equal(deepRow.querySelector('[data-jy-use-picker]').value, 'a');
  assert.equal(deepRow.querySelector('[data-jy-use-note]').hidden, true, '开着分析模式时不写「用不到」');

  const renamed = { ...settings, channels: settings.channels.map(c => (c.id === 'a' ? { ...c, name: 'Renamed', model: 'model-a2' } : c)) };
  fillTtsChannelPickers(root, renamed);
  assert.match(deepSelects[0].children.find(o => o.value === 'a').textContent, /Renamed · model-a2/);

  fillTtsChannelPickers(root, { ...renamed, tts: { ...renamed.tts, mode: 'off' } });
  assert.equal(deepRow.querySelector('[data-jy-use-note]').textContent, '分析模式没开，眼下用不到');
  fillTtsChannelPickers(root, { ...renamed, tts: { ...renamed.tts, enabled: false } });
  assert.equal(deepRow.querySelector('[data-jy-use-note]').textContent, '朗读没开，眼下用不到');
});

// --- syncDeskFields({ rebuildList: false }) --------------------------------------------------------
// Review finding index.js:12396: the same swallowed-click/lost-Tab bug renderChannelCards had at
// index.js:12376, on the desk API Key card's own connection list — a desk-channel-field settling used to
// resync through the full renderDeskConnections, replacing every row (its toggle, 用在 checkboxes and
// 「测试这条连接」/「删除」buttons) out from under a click or Tab still in flight.

test('syncDeskFields({ rebuildList: false }) updates only the open row\'s own model text, leaving every row node exactly as it was', () => {
  const { root, deskList } = makeConsoleRoot();
  const settings = testSettings();
  configureForTest({ deskExpandedChannelId: 'a' });
  syncDeskFields(root, settings); // first, full build (rebuildList defaults to true)

  const rowsBefore = [...deskList.children];
  assert.equal(rowsBefore.length, 3, 'follow + two channels');
  const toggleBefore = findByDataset(deskList, d => d.jyAction === 'desk-toggle-channel' && d.jyChannelId === 'a');
  const testButtonBefore = findByDataset(deskList, d => d.jyAction === 'desk-test-channel' && d.jyChannelId === 'a');
  assert.ok(toggleBefore && testButtonBefore, 'sanity: row a is expanded with its own buttons');

  const updated = { ...settings, channels: settings.channels.map(c => (c.id === 'a' ? { ...c, model: 'brand-new-model' } : c)) };
  syncDeskFields(root, updated, { rebuildList: false });

  assert.deepEqual(deskList.children, rowsBefore, '一整批行节点都还是原来那些，没有被换掉');
  const toggleAfter = findByDataset(deskList, d => d.jyAction === 'desk-toggle-channel' && d.jyChannelId === 'a');
  const testButtonAfter = findByDataset(deskList, d => d.jyAction === 'desk-test-channel' && d.jyChannelId === 'a');
  assert.equal(toggleAfter, toggleBefore, '展开/收起按钮没有被换掉——一次正在进行中的点击不会被吞掉');
  assert.equal(testButtonAfter, testButtonBefore, '「测试这条连接」按钮也没有被换掉');
  const small = toggleAfter.children.find(el => el.tagName === 'SMALL');
  assert.equal(small.textContent, 'brand-new-model', '行内的模型名跟着更新');
});

// Review finding index.js:9217: syncDeskFields(root, s, { rebuildList: false }) used to still call
// renderPresetCards unconditionally, so the 套餐 grid — right above the API Key card, on the same
// 正常模式 翻译台 page — was rebuilt every time a desk channel field settled too. A desk channel field is
// not one of PRESET_MANAGED_FIELDS, so it cannot actually have changed which 套餐 is active or its drift;
// rebuilding the grid anyway swallowed the first click on a preset radio the same way the connection
// list's own full rebuild swallowed clicks on its rows.

test('syncDeskFields({ rebuildList: false }) leaves the 套餐 grid and its drift list untouched', () => {
  const { root } = makeConsoleRoot();
  const settings = { ...testSettings(), preset: 'comfort' };
  syncDeskFields(root, settings); // first, full build (rebuildList defaults to true)

  const presetGrid = root.querySelector('[data-jy-preset-grid]');
  const cardsBefore = [...presetGrid.children];
  assert.ok(cardsBefore.length > 0, 'sanity: 套餐 grid has cards after a full build');
  const driftList = root.querySelector('[data-jy-preset-drift-list]');
  const driftItemsBefore = [...driftList.children];

  const updated = { ...settings, channels: settings.channels.map(c => (c.id === 'a' ? { ...c, model: 'brand-new-model' } : c)) };
  syncDeskFields(root, updated, { rebuildList: false });

  assert.deepEqual(presetGrid.children, cardsBefore, '套餐卡片节点没有被换掉——正在进行中的点击不会被吞掉');
  assert.deepEqual(driftList.children, driftItemsBefore, '改过项列表也没有被换掉');
});

test('syncDeskFields() with no options still rebuilds the connection list (add/delete/expand keep going through the full render)', () => {
  const { root, deskList } = makeConsoleRoot();
  const settings = testSettings();
  configureForTest({ deskExpandedChannelId: 'a' });
  syncDeskFields(root, settings);
  const rowsBefore = [...deskList.children];

  syncDeskFields(root, settings);
  assert.notDeepEqual(deskList.children, rowsBefore, '默认行为仍然是整体重建');
});

test('syncDeskConnectionSummary is a no-op with nothing expanded, or an id matching no channel', () => {
  const { root, deskList } = makeConsoleRoot();
  const settings = testSettings();
  configureForTest({ deskExpandedChannelId: 'a' });
  syncDeskFields(root, settings);
  const rowsBefore = [...deskList.children];

  configureForTest({ deskExpandedChannelId: null });
  syncDeskConnectionSummary(root, settings);
  assert.deepEqual(deskList.children, rowsBefore);

  configureForTest({ deskExpandedChannelId: 'missing' });
  syncDeskConnectionSummary(root, settings);
  assert.deepEqual(deskList.children, rowsBefore);
});

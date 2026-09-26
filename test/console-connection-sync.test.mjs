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
      const tag = String(selector).toUpperCase();
      const search = node => {
        for (const child of node.children) {
          if (child.tagName === tag) return child;
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

function makeDoc() {
  const doc = {};
  doc.createElement = tag => makeElement(tag, doc);
  doc.createTextNode = text => ({ nodeType: 3, textContent: text, parentNode: null });
  return doc;
}

// Depth-first search for every descendant carrying a given dataset key (any value) — used only to find
// [data-jy-channel-use] checkboxes without needing a real attribute-selector engine.
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
  const followRow = makeElement('div', doc);
  const host = makeElement('div', doc); // [data-jy-channel-cards]
  const detail = makeElement('div', doc);
  const holder = makeElement('div', doc);
  detail.hidden = true;
  holder.hidden = true;
  const presetGrid = makeElement('div', doc); // just needs to exist so syncDeskFields does not bail out
  const presetDriftList = makeElement('ul', doc); // [data-jy-preset-drift-list]
  const deskList = makeElement('div', doc); // [data-jy-desk-connection-list]
  const channelSummary = makeElement('p', doc); // [data-jy-channel-summary]
  const analysisSelects = [makeElement('select', doc)];
  const deepSelects = [makeElement('select', doc)];

  const root = {
    dataset: {},
    querySelector(selector) {
      if (selector === '[data-jy-channel-use-row="follow"]') return followRow;
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
      if (selector === '[data-jy-channel-use]') return [...collectByDatasetKey(host, 'jyChannelUse'), ...collectByDatasetKey(followRow, 'jyChannelUse')];
      if (selector === '[data-jy-tts-field="analysisChannelId"]') return analysisSelects;
      if (selector === '[data-jy-tts-field="deepChannelId"]') return deepSelects;
      return [];
    },
  };
  return { root, host, detail, holder, deskList, channelSummary, analysisSelects, deepSelects };
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
    tts: { ...base.tts, analysisChannelId: 'follow', deepChannelId: '' },
  };
}

// --- syncChannelFields({ rebuildCards: false }) also refreshes the 用在 aria-labels --------------
// Review finding index.js:12626: the channel-field fast path (index.js:12376's own fix) only ever
// updated the open card's <h2>; a screen reader kept hearing the connection's old name on its own 用在
// checkboxes ("Chan A · 翻译") after a rename, since nothing besides a full renderChannelCards ever
// touched their aria-label.

test('syncChannelFields({ rebuildCards: false }) updates the open card\'s 用在 checkbox aria-labels on a rename, without touching any other card\'s', () => {
  const { root, host } = makeConsoleRoot();
  const settings = testSettings();
  renderChannelCards(root, settings, 'a');
  configureForTest({ editingChannelId: 'a' });

  const before = collectByDatasetKey(host, 'jyChannelUse').filter(el => el.dataset.jyChannelUseChoice === 'a');
  assert.ok(before.length > 0, 'sanity: card a has 用在 checkboxes');
  assert.ok(before.every(el => el.getAttribute('aria-label').startsWith('Chan A ·')));

  const renamed = { ...settings, channels: settings.channels.map(c => (c.id === 'a' ? { ...c, name: 'Renamed Chan' } : c)) };
  syncChannelFields(root, renamed, { rebuildCards: false });

  const afterA = collectByDatasetKey(host, 'jyChannelUse').filter(el => el.dataset.jyChannelUseChoice === 'a');
  const afterB = collectByDatasetKey(host, 'jyChannelUse').filter(el => el.dataset.jyChannelUseChoice === 'b');
  assert.ok(afterA.length > 0);
  for (const box of afterA) assert.ok(box.getAttribute('aria-label').startsWith('Renamed Chan ·'), `expected renamed label, got ${box.getAttribute('aria-label')}`);
  // The other card's own checkboxes are a different connection entirely and must not be touched.
  for (const box of afterB) assert.ok(box.getAttribute('aria-label').startsWith('Chan B ·'));
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

test('fillTtsChannelPickers refills the 朗读分析/深度分析 selects for the connection\'s current name/model', () => {
  const { root, analysisSelects, deepSelects } = makeConsoleRoot();
  const settings = { ...testSettings(), tts: { ...testSettings().tts, analysisChannelId: 'a', deepChannelId: 'a' } };
  fillTtsChannelPickers(root, settings);
  const analysisOption = analysisSelects[0].children.find(o => o.value === 'a');
  const deepOption = deepSelects[0].children.find(o => o.value === 'a');
  assert.match(analysisOption.textContent, /model-a\b/);
  assert.match(deepOption.textContent, /model-a\b/);

  const renamed = { ...settings, channels: settings.channels.map(c => (c.id === 'a' ? { ...c, name: 'Renamed', model: 'model-a2' } : c)) };
  fillTtsChannelPickers(root, renamed);
  const analysisOption2 = analysisSelects[0].children.find(o => o.value === 'a');
  assert.match(analysisOption2.textContent, /Renamed · model-a2/);
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

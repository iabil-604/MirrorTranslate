import test from 'node:test';
import assert from 'node:assert/strict';

// applyDeskChannelFieldChange/applyChannelFieldChange run the real fast-path change handlers —
// createControlCenter's own [data-jy-desk-channel-field]/[data-jy-channel-field] change listeners are now
// single-line calls straight into these two (index.js:12792/13014), so driving the functions here IS
// driving the handlers a revert of either call site would break. Both call
// saveSettings(collectSettings(root)), and collectSettings reaches worldInfoCharacterKey() (through
// collectColoringFields, which this file's "black hole" stub root's always-present [data-jy-coloring]
// makes collectSettings always run) — that calls getContext(), so this must exist before index.js is even
// imported, same as test/console-confirm-races.test.mjs's own header comment explains. `document` is set
// only *after* the import below, once index.js's own module-level bootstrap (its last few lines) has
// already run and found no real host to activate against.
globalThis.SillyTavern = { getContext: () => ({ extensionSettings: {}, getRequestHeaders: () => ({}) }) };

const { __testing } = await import('../index.js');
const { mergeSettings, DEFAULT_CHANNEL } = await import('../core.js');

globalThis.document = {
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  visibilityState: 'visible', hidden: false, head: null, body: null, documentElement: null,
  addEventListener() {}, removeEventListener() {},
  createElement: tag => ({ tagName: String(tag).toUpperCase(), value: '', textContent: '' }),
};

const {
  configureForTest, applyDeskChannelFieldChange, applyChannelFieldChange,
} = __testing;

// A "black hole" DOM stand-in, same shape and reasoning as test/console-confirm-races.test.mjs's own
// makeStubDoc/makeStubRoot: every querySelector/querySelectorAll call collectSettings or a sync* function
// happens to make returns a brand-new, fully mutable stub element rather than null/[] — real elements
// from the actual template are never absent there, and this file only needs the whole save → resync
// chain to run to completion without throwing. makeTrackedRoot below pins a handful of selectors to
// elements this file keeps its own reference to, so it can assert on what the fast path actually wrote
// into them.
function makeStubDoc() {
  const doc = {};
  const makeEl = () => {
    const el = {
      ownerDocument: doc,
      dataset: {},
      style: {},
      className: '',
      textContent: '',
      value: 'x',
      checked: false,
      hidden: false,
      disabled: false,
      type: '',
      children: [],
      parentNode: null,
      attrs: {},
      setAttribute(name, v) { el.attrs[name] = String(v); },
      getAttribute(name) { return name in el.attrs ? el.attrs[name] : null; },
      removeAttribute(name) { delete el.attrs[name]; },
      appendChild(node) { el.children.push(node); if (node && typeof node === 'object') node.parentNode = el; return node; },
      append(...nodes) { for (const node of nodes) el.appendChild(node); },
      remove() {
        if (el.parentNode) {
          const at = el.parentNode.children.indexOf(el);
          if (at >= 0) el.parentNode.children.splice(at, 1);
        }
        el.parentNode = null;
      },
      replaceChildren(...nodes) { el.children = []; el.append(...nodes); },
      replaceWith(...nodes) {
        if (el.parentNode) {
          const at = el.parentNode.children.indexOf(el);
          if (at >= 0) el.parentNode.children.splice(at, 1, ...nodes);
          for (const node of nodes) if (node && typeof node === 'object') node.parentNode = el.parentNode;
        }
        el.parentNode = null;
      },
      insertBefore(node) { return el.appendChild(node); },
      before() {}, after() {}, cloneNode: () => makeEl(),
      contains: node => el.children.includes(node),
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      querySelector: () => makeEl(),
      querySelectorAll: () => [],
      closest: () => null,
      matches: () => false,
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
      focus() {}, setSelectionRange() {}, scrollIntoView() {},
    };
    return el;
  };
  doc.createElement = () => makeEl();
  doc.createTextNode = text => ({ nodeType: 3, textContent: text, parentNode: null });
  return doc;
}

// A desk-card field, [data-jy-desk-channel-field] — `hidden: false` on its 正常模式 block is the only
// case this fast path ever runs from (the card does not exist in 高级模式 at all).
function deskField(key, value) {
  const modeBlock = { hidden: false };
  return { dataset: { jyDeskChannelField: key }, value, closest: selector => (selector === '[data-jy-mode-content]' ? modeBlock : null) };
}

// A 模型连接页 field, [data-jy-channel-field] — starts holding whatever that page's own render last put
// there, independent of the desk card's own value (review finding index.js:12561's whole point).
function channelField(key, value) {
  return { dataset: { jyChannelField: key }, type: 'text', value };
}

function makeTrackedRoot({ deskFields = [], channelFields = [], editingChannelId } = {}) {
  const doc = makeStubDoc();
  const root = doc.createElement();
  root.dataset.jyEditingChannelId = editingChannelId;
  const channelSummary = doc.createElement();
  const analysisSelect = doc.createElement();
  const deepSelect = doc.createElement();
  const genericQuerySelector = root.querySelector;
  root.querySelector = selector => {
    if (selector === '[data-jy-channel-summary]') return channelSummary;
    return genericQuerySelector(selector);
  };
  root.querySelectorAll = selector => {
    if (selector === '[data-jy-desk-channel-field]') return deskFields;
    if (selector === '[data-jy-channel-field]') return channelFields;
    if (selector === '[data-jy-tts-field="analysisChannelId"]') return [analysisSelect];
    if (selector === '[data-jy-tts-field="deepChannelId"]') return [deepSelect];
    return [];
  };
  return { root, channelSummary, analysisSelect, deepSelect };
}

function testSettings(overrides = {}) {
  const base = mergeSettings({});
  return {
    ...base,
    apiMode: 'independent',
    selectedChannelId: 'a',
    channels: [{ ...DEFAULT_CHANNEL, id: 'a', name: 'Chan A', url: '', key: '', model: '' }],
    ...overrides,
  };
}

// --- applyDeskChannelFieldChange (review finding index.js:12561, HIGH) -----------------------------
// Before this fix, the handler only ran syncDeskFields({ rebuildList: false }) — it left the 模型连接
// page's own [data-jy-channel-field] copy of this same connection exactly as it was. Since 模型连接 is
// hidden in 正常模式, nothing rebuilds that copy until the reader actually opens 模型连接 — and
// collectSettings(root) always reads it regardless of visibility. The next save made from anywhere while
// 模型连接 sits hidden (switching to 高级模式 and touching any field there at all) then wrote that stale
// copy straight back over what was just typed on the desk card.

test('applyDeskChannelFieldChange saves the desk card\'s address/key onto the connection, and refreshes the hidden 模型连接 form so it agrees', () => {
  configureForTest({ settings: testSettings(), deskExpandedChannelId: 'a', editingChannelId: 'a' });
  // 模型连接's own copy starts stale/empty — the page has never been opened since the connection was
  // first created, exactly the "new user, default single connection" scenario the review reproduced.
  const urlField = channelField('url', '');
  const keyField = channelField('key', '');
  const { root, channelSummary, analysisSelect, deepSelect } = makeTrackedRoot({
    deskFields: [deskField('url', 'https://new.example/v1'), deskField('key', 'sk-NEW')],
    channelFields: [urlField, keyField],
    editingChannelId: 'a',
  });

  const ok = applyDeskChannelFieldChange(root);

  assert.equal(ok, true);
  assert.equal(urlField.value, 'https://new.example/v1', '模型连接页的地址栏跟着桌面卡刚存的值更新，不再是旧的空值');
  assert.equal(keyField.value, 'sk-NEW', '模型连接页的密钥栏同理');
  assert.match(channelSummary.textContent, /https:\/\/new\.example\/v1/, '翻译台自己的摘要行也跟着刷新');
  assert.ok(analysisSelect.children.some(o => o.value === 'a'), '朗读分析的连接选择器也刷新了这条连接');
  assert.ok(deepSelect.children.some(o => o.value === 'a'));
});

test('applyDeskChannelFieldChange leaves everything alone and reports failure when collectSettings fails on an unrelated field', () => {
  configureForTest({ settings: testSettings(), deskExpandedChannelId: 'a', editingChannelId: 'a' });
  const urlField = channelField('url', '');
  const { root, channelSummary } = makeTrackedRoot({
    deskFields: [deskField('url', 'https://new.example/v1')],
    channelFields: [urlField],
    editingChannelId: 'a',
  });
  const realQuerySelector = root.querySelector;
  // 排除标签 filled with something parseTagNamesWithErrors rejects outright — the same shape review
  // finding index.js:11889 used to reproduce collectSettings throwing on an unrelated field.
  root.querySelector = selector => (selector === '[data-jy-field="excludedTags"]' ? { value: '<<<' } : realQuerySelector(selector));

  const ok = applyDeskChannelFieldChange(root);

  assert.equal(ok, false);
  assert.equal(urlField.value, '', '保存本身失败了，模型连接页的旧值不去动它——没有东西可刷新');
  assert.equal(channelSummary.textContent, '', '摘要行同样没有被刷新过');
});

// --- applyChannelFieldChange (index.js:13014, the reverse direction) -------------------------------
// The 模型连接 page's own fast path: a field settling there must not leave the desk card, the advanced
// 翻译台摘要 or the 朗读/深度分析 pickers showing the connection's old name/model either.

test('applyChannelFieldChange saves the 模型连接 page\'s own field and refreshes the desk card\'s summary and the tts pickers', () => {
  configureForTest({ settings: testSettings(), deskExpandedChannelId: 'a', editingChannelId: 'a' });
  const urlField = channelField('url', 'https://renamed.example/v1');
  const { root, channelSummary, analysisSelect } = makeTrackedRoot({ channelFields: [urlField], editingChannelId: 'a' });

  const ok = applyChannelFieldChange(root);

  assert.equal(ok, true);
  assert.match(channelSummary.textContent, /https:\/\/renamed\.example\/v1/, '翻译台摘要跟着模型连接页刚存的地址更新');
  assert.ok(analysisSelect.children.some(o => o.value === 'a'));
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { __testing } from '../index.js';

const { collectDeskChannelFields, configureForTest, focusIdentity, withFocusPreserved } = __testing;

// --- collectDeskChannelFields -------------------------------------------------------------------
// Review findings index.js:9054 (both the JP and EN write-ups): 高级模式 hides the desk API Key
// card's own [data-jy-desk-channel-field] inputs but leaves them in the DOM with stale values, and
// collectSettings used to apply them to whatever connection runtime.deskExpandedChannelId names
// regardless — clobbering a 模型连接 edit to the very same connection.

function fakeDeskField(key, value, modeHidden) {
  const modeBlock = { hidden: modeHidden };
  return {
    dataset: { jyDeskChannelField: key },
    value,
    closest: selector => (selector === '[data-jy-mode-content]' ? modeBlock : null),
  };
}

function fakeRoot(fields) {
  return { querySelectorAll: selector => (selector === '[data-jy-desk-channel-field]' ? fields : []) };
}

test('collectDeskChannelFields leaves the connection alone while the desk card sits in a hidden 正常模式 block (高级模式)', () => {
  configureForTest({ deskExpandedChannelId: 'c1' });
  const fields = [fakeDeskField('url', 'https://typed.example/v1', true), fakeDeskField('key', 'sk-typed', true)];
  const current = { channels: [{ id: 'c1', url: 'https://saved.example/v1', key: 'sk-saved', model: 'm' }] };
  collectDeskChannelFields(fakeRoot(fields), current);
  assert.equal(current.channels[0].url, 'https://saved.example/v1', '模型连接 页刚存的地址不会被隐藏的桌面卡冲掉');
  assert.equal(current.channels[0].key, 'sk-saved');
});

test('collectDeskChannelFields applies the desk card once its 正常模式 block is actually visible', () => {
  configureForTest({ deskExpandedChannelId: 'c1' });
  const fields = [fakeDeskField('url', 'https://typed.example/v1', false), fakeDeskField('key', 'sk-typed', false)];
  const current = { channels: [{ id: 'c1', url: 'https://saved.example/v1', key: 'sk-saved', model: 'm' }] };
  collectDeskChannelFields(fakeRoot(fields), current);
  assert.equal(current.channels[0].url, 'https://typed.example/v1');
  assert.equal(current.channels[0].key, 'sk-typed');
});

test('collectDeskChannelFields is a no-op with nothing expanded, an id matching no channel, or no fields in the DOM', () => {
  const current = { channels: [{ id: 'c1', url: 'x' }] };
  configureForTest({ deskExpandedChannelId: null });
  collectDeskChannelFields(fakeRoot([fakeDeskField('url', 'y', false)]), current);
  assert.equal(current.channels[0].url, 'x');

  configureForTest({ deskExpandedChannelId: 'missing' });
  collectDeskChannelFields(fakeRoot([fakeDeskField('url', 'y', false)]), current);
  assert.equal(current.channels[0].url, 'x');

  configureForTest({ deskExpandedChannelId: 'c1' });
  collectDeskChannelFields(fakeRoot([]), current);
  assert.equal(current.channels[0].url, 'x');
});

// --- focusIdentity / withFocusPreserved ---------------------------------------------------------
// Review finding index.js:11759: several autosave branches rebuild the very control a keyboard user
// just used (a preset radio, a connection row, a channel card), dropping focus to <body>.

function fakeElement(tag, attrs, { selectable = false } = {}) {
  const el = {
    tagName: tag,
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    focused: false,
    focusOptions: null,
    focus(options) { el.focused = true; el.focusOptions = options; },
  };
  if (selectable) {
    el.selectionStart = 3;
    el.selectionEnd = 5;
    el.setSelectionRange = (start, end) => { el.selectionStart = start; el.selectionEnd = end; };
  }
  return el;
}

test('focusIdentity builds a tag-qualified selector from data-jy-* attributes only', () => {
  const el = fakeElement('SELECT', { 'data-jy-tts-field': 'deepChannelId', class: 'jy-summary-select', id: 'x' });
  assert.equal(focusIdentity(el), 'select[data-jy-tts-field="deepChannelId"]');
});

test('focusIdentity returns null for an element with no data-jy-* attribute, or no element at all', () => {
  assert.equal(focusIdentity({ tagName: 'DIV', attributes: [] }), null);
  assert.equal(focusIdentity(null), null);
  assert.equal(focusIdentity(undefined), null);
});

test('withFocusPreserved refocuses the rebuilt node carrying the same identity and restores its caret', () => {
  const before = fakeElement('INPUT', { 'data-jy-desk-channel-field': 'url' }, { selectable: true });
  before.selectionStart = 3;
  before.selectionEnd = 5;
  const after = fakeElement('INPUT', { 'data-jy-desk-channel-field': 'url' }, { selectable: true });
  const root = {
    ownerDocument: { activeElement: before },
    contains: element => element === before,
    querySelector: selector => (selector === 'input[data-jy-desk-channel-field="url"]' ? after : null),
  };
  const result = withFocusPreserved(root, () => 'rendered');
  assert.equal(result, 'rendered', "passes the render callback's own return value through");
  assert.equal(after.focused, true);
  assert.deepEqual(after.focusOptions, { preventScroll: true });
  assert.equal(after.selectionStart, 3);
  assert.equal(after.selectionEnd, 5);
});

test('withFocusPreserved does nothing when nothing inside root had focus, or the focused element has no data-jy-* identity', () => {
  const untouchable = selector => { throw new Error(`querySelector should not run: ${selector}`); };
  const noFocus = { ownerDocument: { activeElement: null }, contains: () => false, querySelector: untouchable };
  assert.equal(withFocusPreserved(noFocus, () => 42), 42);

  const plain = fakeElement('BUTTON', {});
  const noIdentity = { ownerDocument: { activeElement: plain }, contains: element => element === plain, querySelector: untouchable };
  assert.equal(withFocusPreserved(noIdentity, () => 7), 7);
});

test('withFocusPreserved leaves focus alone when the rebuilt DOM has nothing matching that identity any more', () => {
  const before = fakeElement('BUTTON', { 'data-jy-channel-id': 'gone' });
  const root = { ownerDocument: { activeElement: before }, contains: element => element === before, querySelector: () => null };
  assert.equal(withFocusPreserved(root, () => 'ok'), 'ok');
});

// Review finding index.js:8246: the control center always sits inside a shadow root (attachShadow),
// where `root.ownerDocument.activeElement` is forever the shadow host div — never whatever is actually
// focused inside it — so the old lookup always concluded nothing inside `root` had focus and never
// refocused anything after a resync. `root.getRootNode()` returns that shadow root, whose own
// `.activeElement` does track focus within it.
test('withFocusPreserved finds the active element through getRootNode() when root sits in a shadow root, not the shadow host via ownerDocument', () => {
  const before = fakeElement('BUTTON', { 'data-jy-channel-chevron': 'true', 'data-jy-channel-id': 'c1' });
  const after = fakeElement('BUTTON', { 'data-jy-channel-chevron': 'true', 'data-jy-channel-id': 'c1' });
  const shadowHost = fakeElement('DIV', {}); // what ownerDocument.activeElement is stuck on from outside the shadow tree
  const shadowRoot = { activeElement: before };
  const root = {
    ownerDocument: { activeElement: shadowHost },
    getRootNode: () => shadowRoot,
    contains: element => element === before,
    querySelector: selector => (selector === 'button[data-jy-channel-chevron="true"][data-jy-channel-id="c1"]' ? after : null),
  };
  const result = withFocusPreserved(root, () => 'rendered');
  assert.equal(result, 'rendered', "passes the render callback's own return value through");
  assert.equal(after.focused, true, 'shadowRoot.activeElement 才是真正聚焦的节点，焦点应该转移到它的替身上');
});

// Review finding index.js:12541 (the rest of 8246): renderChannelCards moves the shared channel-detail
// node into a different card rather than recreating it — the DOM identity is the same node, just at a new
// parent — and a browser drops focus on its own the moment a focused node is relocated like that. The old
// guard compared the found node only against the *pre-render* `active` reference and skipped refocusing
// whenever they were the identical node, even though the shadow root's own activeElement had already gone
// stale (null, here) the instant render() moved it.
test('withFocusPreserved refocuses a node that render() only moved, once the shadow root itself has already dropped focus from it', () => {
  const moved = fakeElement('SELECT', { 'data-jy-model-select': 'true' });
  const shadowRoot = { activeElement: moved };
  const root = {
    getRootNode: () => shadowRoot,
    contains: element => element === moved,
    querySelector: selector => (selector === 'select[data-jy-model-select="true"]' ? moved : null),
  };
  const result = withFocusPreserved(root, () => {
    // A render that only relocates the node in the DOM — the way renderChannelCards re-appends the
    // shared detail editor into whichever card is open — the browser itself clears focus for this,
    // it never re-fires focus back onto the very same node on its own.
    shadowRoot.activeElement = null;
    return 'moved';
  });
  assert.equal(result, 'moved');
  assert.equal(moved.focused, true, '同一个节点被搬动后也要拿回焦点，不能因为“还是这个节点”就跳过');
});

// Review finding index.js:8246 (second half): the chevron and the toggle used to share the exact same
// data-jy-action/data-jy-channel-id pair, so focusIdentity built the same selector for both and
// querySelector always resolved to whichever comes first in the head (the toggle) — even when the
// chevron is what a keyboard user actually activated.
test('focusIdentity gives the chevron its own selector once it carries data-jy-channel-chevron, distinct from the toggle sharing the same action/id', () => {
  const toggle = fakeElement('BUTTON', { 'data-jy-action': 'edit-channel', 'data-jy-channel-id': 'c1' });
  const chevron = fakeElement('BUTTON', { 'data-jy-action': 'edit-channel', 'data-jy-channel-id': 'c1', 'data-jy-channel-chevron': 'true' });
  const toggleSelector = focusIdentity(toggle);
  const chevronSelector = focusIdentity(chevron);
  assert.equal(toggleSelector, 'button[data-jy-action="edit-channel"][data-jy-channel-id="c1"]');
  assert.equal(chevronSelector, 'button[data-jy-action="edit-channel"][data-jy-channel-id="c1"][data-jy-channel-chevron="true"]');
  assert.notEqual(chevronSelector, toggleSelector, '箭头和展开按钮不再共用同一个选择器');
});

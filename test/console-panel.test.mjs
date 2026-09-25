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
  const el = fakeElement('SELECT', { 'data-jy-tts-field': 'analysisChannelId', class: 'jy-summary-select', id: 'x' });
  assert.equal(focusIdentity(el), 'select[data-jy-tts-field="analysisChannelId"]');
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

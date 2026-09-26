import test from 'node:test';
import assert from 'node:assert/strict';

import { __testing } from '../index.js';

const { scheduleFieldResync, isTextEntryElement } = __testing;

// Review finding index.js:12538: 翻译规则's field-settle autosave used to resync with `setTimeout(0)`,
// on the assumption a pending click would already have been dispatched a tick later. True only for a
// synthesized touch tap (mousedown/mouseup/click land back to back); a real mouse's mouseup follows
// 50-150ms later, long after a 0ms timer already fired and rebuilt the very editor panel the click or Tab
// was headed for. scheduleFieldResync instead waits for the next 'click' on `root` (or, lacking one, a
// fallback timer) before running the deferred resync — `root`'s own delegated click handler is always
// registered long before any field ever settles, so it always gets the click first.

test('scheduleFieldResync does not run immediately, and does not run on a 0ms timer either', async () => {
  const root = new EventTarget();
  let ran = 0;
  // A short-but-not-instant fallback: long enough that the 0ms tick below cannot be mistaken for it,
  // short enough this test does not hold the process open waiting for it. Dispatching a click at the end
  // both proves the mechanism and clears the fallback timer so nothing lingers past this test.
  scheduleFieldResync(root, () => { ran += 1; }, { fallbackMs: 200 });
  assert.equal(ran, 0, 'not synchronous');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(ran, 0, 'still not run after a bare tick, unlike the old setTimeout(0)');
  root.dispatchEvent(new Event('click'));
  assert.equal(ran, 1);
});

test('scheduleFieldResync runs once the next click on root arrives, exactly once even if more clicks follow', async () => {
  const root = new EventTarget();
  let ran = 0;
  scheduleFieldResync(root, () => { ran += 1; }, { fallbackMs: 200 });
  root.dispatchEvent(new Event('click'));
  assert.equal(ran, 1);
  root.dispatchEvent(new Event('click'));
  assert.equal(ran, 1, 'one-shot: a later click does not run it again');
});

test('scheduleFieldResync runs after the fallback timer when no click ever follows (Tab only, or a click outside the panel)', () => {
  const root = new EventTarget();
  let ran = 0;
  scheduleFieldResync(root, () => { ran += 1; }, { fallbackMs: 5 });
  const { setTimeout: realSetTimeout } = globalThis;
  return new Promise(resolve => {
    realSetTimeout(() => {
      assert.equal(ran, 1);
      resolve();
    }, 30);
  });
});

test('scheduleFieldResync runs the delegated click handler already on root before its own one-shot listener, matching registration order', () => {
  // root.addEventListener('click', onClick) is registered once at panel setup, long before any field
  // ever settles; scheduleFieldResync's own listener is always added afterwards, so it always runs after
  // whatever the click was actually for.
  const root = new EventTarget();
  const order = [];
  root.addEventListener('click', () => order.push('delegated-onClick'));
  scheduleFieldResync(root, () => order.push('resync'), { fallbackMs: 200 });
  root.dispatchEvent(new Event('click'));
  assert.deepEqual(order, ['delegated-onClick', 'resync']);
});

// --- isTextEntryElement --------------------------------------------------------------------------
// Review finding index.js:8452's own fix: a keystroke that is about to type into a text field must
// resync early; one that activates a checkbox/radio/button/select must not — Space/Enter on those
// already go through the delegated click handler, and treating them as "typing" too would just run the
// resync a second time for nothing.

function fakeField(tagName, type) {
  return { tagName, ...(type !== undefined ? { type } : {}) };
}

test('isTextEntryElement accepts a textarea and every ordinary text-shaped input, rejects checkbox/radio/button-shaped inputs, selects and non-form targets', () => {
  assert.equal(isTextEntryElement(fakeField('TEXTAREA')), true);
  assert.equal(isTextEntryElement(fakeField('INPUT', 'text')), true);
  assert.equal(isTextEntryElement(fakeField('INPUT')), true, '不写 type 的 input，浏览器按 text 处理');
  for (const type of ['search', 'url', 'email', 'password', 'number', 'tel', 'date']) {
    assert.equal(isTextEntryElement(fakeField('INPUT', type)), true, `input[type=${type}] 也是文本输入`);
  }
  for (const type of ['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image']) {
    assert.equal(isTextEntryElement(fakeField('INPUT', type)), false, `input[type=${type}] 不是文本输入`);
  }
  assert.equal(isTextEntryElement(fakeField('SELECT')), false);
  assert.equal(isTextEntryElement(fakeField('BUTTON')), false);
  assert.equal(isTextEntryElement(null), false);
  assert.equal(isTextEntryElement(undefined), false);
});

// --- scheduleFieldResync's keydown/beforeinput/compositionstart listeners ------------------------
// Review finding index.js:8452: with no click at all (Tab, or clicking outside the panel), the deferred
// rebuild used to wait for the full 500ms fallback. A real keystroke — or an IME composition's very
// first character — typed into whatever Tab landed on arrives well inside that window and used to be
// silently replaced once the fallback fired and rebuilt that very field from the last-saved settings.

test('scheduleFieldResync runs at once on a keydown into a text field, without waiting for the fallback timer', () => {
  const root = new EventTarget();
  let ran = 0;
  scheduleFieldResync(root, () => { ran += 1; }, { fallbackMs: 5000 });
  const event = new Event('keydown');
  Object.defineProperty(event, 'target', { value: fakeField('TEXTAREA'), configurable: true });
  root.dispatchEvent(event);
  assert.equal(ran, 1, 'Tab 之后紧接着敲字符，不用等 5 秒的兜底定时器');
});

test('scheduleFieldResync also runs on beforeinput / compositionstart into a text field (an IME composition, or a virtual keyboard with no keydown at all)', () => {
  for (const type of ['beforeinput', 'compositionstart']) {
    const root = new EventTarget();
    let ran = 0;
    scheduleFieldResync(root, () => { ran += 1; }, { fallbackMs: 5000 });
    const event = new Event(type);
    Object.defineProperty(event, 'target', { value: fakeField('INPUT', 'text'), configurable: true });
    root.dispatchEvent(event);
    assert.equal(ran, 1, `${type} 落在文本框上时立刻触发`);
  }
});

test('scheduleFieldResync ignores a keydown that lands on a checkbox/radio/button/select — Space/Enter on those still goes through the delegated click handler alone', () => {
  const root = new EventTarget();
  let ran = 0;
  scheduleFieldResync(root, () => { ran += 1; }, { fallbackMs: 5000 });
  for (const target of [fakeField('INPUT', 'checkbox'), fakeField('INPUT', 'radio'), fakeField('BUTTON'), fakeField('SELECT')]) {
    const event = new Event('keydown');
    Object.defineProperty(event, 'target', { value: target, configurable: true });
    root.dispatchEvent(event);
  }
  assert.equal(ran, 0, '不是文本输入的目标不提前触发');
  root.dispatchEvent(new Event('click'));
  assert.equal(ran, 1, '真正落下的点击仍然照常触发');
});

test('scheduleFieldResync is still one-shot once a keydown has run it: it does not remove the click listener without also removing the keyboard ones, or fire twice', () => {
  const root = new EventTarget();
  let ran = 0;
  scheduleFieldResync(root, () => { ran += 1; }, { fallbackMs: 5000 });
  const first = new Event('keydown');
  Object.defineProperty(first, 'target', { value: fakeField('TEXTAREA'), configurable: true });
  root.dispatchEvent(first);
  assert.equal(ran, 1);

  const second = new Event('keydown');
  Object.defineProperty(second, 'target', { value: fakeField('TEXTAREA'), configurable: true });
  root.dispatchEvent(second);
  root.dispatchEvent(new Event('beforeinput'));
  root.dispatchEvent(new Event('click'));
  assert.equal(ran, 1, '第一次触发之后，键盘和点击的监听都已经摘掉');
});

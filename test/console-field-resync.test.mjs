import test from 'node:test';
import assert from 'node:assert/strict';

import { __testing } from '../index.js';

const { scheduleFieldResync } = __testing;

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

import test from 'node:test';
import assert from 'node:assert/strict';

import { MESSAGE_META_KEY } from '../core.js';
import { describeLog, describeRemaining, estimateRemaining, filterLogs, floorRows, floorState, segmentAnchors, segmentAtPosition, untranslatedFloors } from '../mini.js';
import { __testing } from '../index.js';

test('a floor becomes rows with a state each: done, running, missing, or never asked', () => {
  const snapshot = {
    segments: [{ id: 1, text: '雨。' }, { id: 2, text: '「来た」' }, { id: 3, text: '風。' }],
    existingTranslations: new Map([[1, '雨。'], [3, '   ']]),
    existingAnnotations: new Map([[1, { speaker: '樱井', emotion: 'happy' }]]),
  };
  const rows = floorRows(snapshot);
  assert.deepEqual(rows.map(row => [row.id, row.state]), [[1, 'done'], [2, 'missing'], [3, 'missing']], 'blank text is not a translation');
  assert.equal(rows[0].speaker, '樱井');
  assert.equal(rows[0].emotion, 'happy');
  assert.equal(rows[1].translation, '');
  assert.deepEqual(floorRows(snapshot, { running: true }).map(row => row.state), ['done', 'running', 'running']);
  assert.deepEqual(floorRows(snapshot, { running: true, activeIds: new Set([2]) }).map(row => row.state), ['done', 'running', 'missing'], 'only the ids in flight run');
  assert.deepEqual(floorRows({ segments: snapshot.segments, existingTranslations: new Map() }).map(row => row.state), ['pending', 'pending', 'pending'], 'a floor never translated is pending, not missing');
  assert.deepEqual(floorRows(null), []);
});

test('the floor state is one word, and counts what is left', () => {
  const rows = id => ({ id, state: id % 2 ? 'done' : 'missing' });
  assert.deepEqual(floorState([]), { key: 'empty', label: '没有正文', done: 0, total: 0, missing: 0 });
  assert.equal(floorState([rows(1), rows(3)]).label, '已译');
  assert.equal(floorState([rows(2), rows(4)]).label, '未译');
  const partial = floorState([rows(1), rows(2), rows(4)]);
  assert.equal(partial.label, '缺 2 段');
  assert.equal(partial.missing, 2);
  assert.equal(floorState([rows(1), rows(2)], { running: true }).label, '翻译中');
});

test('the remaining time follows the finished batches, with the lanes running side by side', () => {
  assert.equal(estimateRemaining({ done: 0, total: 3 }), null, 'nothing finished and no history');
  assert.equal(estimateRemaining({ done: 3, total: 3, durations: [2] }), null, 'nothing left');
  const estimate = estimateRemaining({ done: 2, total: 5, active: 2, lanes: 2, durations: [2, 2], elapsedActive: 1 });
  assert.equal(estimate.seconds, 3, 'one second left on the pair in flight, then one more batch');
  assert.equal(estimate.slow, false);
  assert.equal(estimateRemaining({ done: 0, total: 2, active: 1, lanes: 1, history: [10] }).seconds, 20, 'history stands in before a batch finishes');
  assert.equal(estimateRemaining({ done: 0, total: 1, active: 1, durations: [4], elapsedActive: 9 }).slow, true, 'twice the average and still running');
  assert.equal(describeRemaining(null), '');
  assert.equal(describeRemaining({ seconds: 12 }), '还要约 12 秒');
  assert.equal(describeRemaining({ seconds: 1 }), '就快好了');
  assert.equal(describeRemaining({ seconds: 150 }), '还要约 3 分钟');
  assert.equal(describeRemaining({ seconds: 5, slow: true }), '比平时慢');
});

test('log filters keep the right lines, newest first, and each line reads as a clock, an area and a floor', () => {
  const entries = [
    { time: '2026-09-16T01:02:03.000Z', level: 'info', scope: 'translation.start', message: '开始', floor: 3 },
    { time: '2026-09-16T01:02:04.000Z', level: 'error', scope: 'tts.request-failed', message: '连不上', floor: 3 },
    { time: '2026-09-16T01:02:05.000Z', level: 'warn', scope: 'channel.test', message: '测试', floor: 4 },
    { time: '2026-09-16T01:02:06.000Z', level: 'info', scope: 'host.interceptor-missing', message: '宿主' },
  ];
  assert.deepEqual(filterLogs(entries, { filter: 'all' }).map(entry => entry.message), ['宿主', '测试', '连不上', '开始']);
  assert.deepEqual(filterLogs(entries, { filter: 'floor', floor: 3 }).map(entry => entry.message), ['连不上', '开始']);
  assert.deepEqual(filterLogs(entries, { filter: 'floor', floor: null }), []);
  assert.deepEqual(filterLogs(entries, { filter: 'translation' }).map(entry => entry.message), ['测试', '开始'], 'channel tests belong to translation');
  assert.deepEqual(filterLogs(entries, { filter: 'tts' }).map(entry => entry.message), ['连不上']);
  assert.deepEqual(filterLogs(entries, { filter: 'errors' }).map(entry => entry.message), ['连不上']);
  const line = describeLog(entries[1]);
  const stamp = new Date(entries[1].time);
  const pad = value => String(value).padStart(2, '0');
  assert.deepEqual(line, { time: `${pad(stamp.getHours())}:${pad(stamp.getMinutes())}:${pad(stamp.getSeconds())}`, area: '朗读', floor: 3, level: 'error', message: '连不上' });
  assert.equal(describeLog(entries[3]).area, '宿主');
  assert.equal(describeLog(entries[3]).floor, null);
  assert.equal(describeLog({ scope: 'weird' }).time, '');
});

test('the untranslated floors are read off the stored metadata, newest first, users and system skipped', () => {
  const done = { mes: 'x', swipe_id: 0, extra: { [MESSAGE_META_KEY]: { complete: true, swipe_id: 0 } } };
  const partial = { mes: 'x', swipe_id: 0, extra: { [MESSAGE_META_KEY]: { complete: false, swipe_id: 0 } } };
  const otherSwipe = { mes: 'x', swipe_id: 1, extra: { [MESSAGE_META_KEY]: { complete: true, swipe_id: 0 } } };
  const chat = [done, { mes: 'u', is_user: true }, partial, { mes: 'x' }, otherSwipe, { mes: 's', is_system: true }, done];
  assert.deepEqual(untranslatedFloors(chat), [4, 3, 2]);
  assert.deepEqual(untranslatedFloors(chat, { limit: 2 }), [4, 3]);
  assert.deepEqual(untranslatedFloors(null), []);
});

test('片段跳转: a floor becomes two anchor lists, translation and original, empty text left out of both', () => {
  const snapshot = {
    segments: [{ id: 1, text: '雨。' }, { id: 2, text: '「来た」' }, { id: 3, text: '' }],
    existingTranslations: new Map([[1, '下雨了。'], [2, '   ']]),
  };
  const anchors = segmentAnchors(snapshot);
  assert.deepEqual(anchors.translation, [{ id: 1, lineId: 1, text: '下雨了。' }], 'blank translations do not count as one');
  assert.deepEqual(anchors.source, [{ id: 1, lineId: 1, text: '雨。' }, { id: 2, lineId: 2, text: '「来た」' }], 'the blank-text segment has nothing to search for');
  assert.deepEqual(segmentAnchors(null), { translation: [], source: [] });
});

test('片段跳转: a click lands on whichever segment its point falls inside, translation checked before original', () => {
  const hit = (startNode, startOffset, endNode, endOffset) => ({ start: { node: startNode, offset: startOffset }, end: { node: endNode, offset: endOffset } });
  const translationHits = new Map([[1, hit(0, 0, 0, 3)], [2, hit(0, 3, 0, 6)], [3, null]]);
  const sourceHits = new Map([[4, hit(1, 0, 1, 4)]]);
  assert.equal(segmentAtPosition({ node: 0, offset: 1 }, translationHits, sourceHits), 1, 'inside the first translation');
  assert.equal(segmentAtPosition({ node: 0, offset: 3 }, translationHits, sourceHits), 1, 'a shared boundary is inclusive on both sides; the earlier hit is checked first');
  assert.equal(segmentAtPosition({ node: 0, offset: 6 }, translationHits, sourceHits), 2, 'inclusive of its own end');
  assert.equal(segmentAtPosition({ node: 0, offset: 7 }, translationHits, sourceHits), null, 'past every translation hit and no source hit on that node');
  assert.equal(segmentAtPosition({ node: 1, offset: 2 }, translationHits, sourceHits), 4, 'falls through to the original when nothing in the translation matches');
  assert.equal(segmentAtPosition({ node: 9, offset: 0 }, translationHits, sourceHits), null, 'a null hit (locateAnchors could not find that segment) is never a match');
  assert.equal(segmentAtPosition({ node: 0, offset: 0 }, null, null), null, 'missing maps do not throw');
});

test('片段跳转: the host\'s own delete-message mode is recognised, checkbox and confirmation bar alike', () => {
  const hidden = { offsetParent: null };
  const visible = { offsetParent: {} };
  const fakeDocument = (checkbox, bar) => ({
    querySelector: selector => (selector === '.del_checkbox' ? checkbox : null),
    getElementById: id => (id === 'dialogue_del_mes' ? bar : null),
  });
  const before = globalThis.document;
  try {
    globalThis.document = fakeDocument(null, null);
    assert.equal(__testing.chatInDeleteMode(), false, '既没有勾选框也没有确认栏时不是删除模式');
    globalThis.document = fakeDocument(hidden, null);
    assert.equal(__testing.chatInDeleteMode(), false, '勾选框存在但不可见（offsetParent 为 null）不算删除模式');
    globalThis.document = fakeDocument(visible, null);
    assert.equal(__testing.chatInDeleteMode(), true, '勾选框可见即为删除模式');
    globalThis.document = fakeDocument(null, hidden);
    assert.equal(__testing.chatInDeleteMode(), false, '确认栏存在但隐藏不算删除模式');
    globalThis.document = fakeDocument(null, visible);
    assert.equal(__testing.chatInDeleteMode(), true, '确认栏显示中同样是删除模式');
  } finally {
    globalThis.document = before;
  }
});

// DESIGN §14 片段跳转 · 减少动态效果: style.css kills every animation under prefers-reduced-motion
// (`*, *::before, *::after { animation: none !important }`), which used to leave the jump highlight's
// own animation-only .jy-mini-row-jump with nothing to show at all (review finding style.css:975).
// focusRow (inside openMiniWindow, which needs a real window to construct) reads this pure plan to
// decide which class to use and how to clear it, so the decision is testable without a DOM.
test('segmentJumpHighlightPlan: normal motion animates and clears on animationend; reduced motion holds a static background for ~2s instead', () => {
  assert.deepEqual(__testing.segmentJumpHighlightPlan(false), { className: 'jy-mini-row-jump', clearAfterMs: null });
  assert.deepEqual(__testing.segmentJumpHighlightPlan(true), { className: 'jy-mini-row-jump-static', clearAfterMs: 2000 });
});

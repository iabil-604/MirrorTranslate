import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFloorRegions, segmentSource } from '../core.js';
import { READING_STATES, readingPositions, readingSnapshot, readingState } from '../reading.js';
import { __testing } from '../index.js';

globalThis.toastr ??= Object.fromEntries(['success', 'error', 'warning', 'info'].map(kind => [kind, () => {}]));

// ---------------------------------------------------------------------------------------------
// __JINGYI__.reading: one floor's alternative as 镜译 reads it — the original, each line placed in it
// by UTF-16 offsets, the line's translation and marks, where the floor stands — and a word on change.
// The floor is the 东京都2051 card's own sample: a body tag of its own, tagged dialogue and a thought,
// a character outside the BMP, and blocks other scripts append after the body.
// ---------------------------------------------------------------------------------------------

const SOURCE = '<cxx-story>\n雨水沿着校门滴下。🌧️\n<cxx-say speaker="千早爱音" expression="smile">明天见。</cxx-say>\n<cxx-say speaker="千早爱音" expression="normal" kind="thought">希望能顺利。</cxx-say>\n</cxx-story>\n<ztl>{"date":"2051年10月10日","time":"15:10","location":"羽丘校门","characters":[]}</ztl>\n<UpdateVariable><JSONPatch>[]</JSONPatch></UpdateVariable>';
const OTHER = SOURCE.replace('明天见。', '今天就走吧。');
const REPLY = JSON.stringify({ translations: [
  { id: 1, text: '雨珠从校门边缘一滴滴落下。🌧️' },
  { id: 2, text: '明天见啦。' },
  { id: 3, text: '但愿一切顺利。' },
] });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function placed(source) {
  const extraction = extractFloorRegions(source, { bodyTags: ['cxx-story'], replaceTags: [], startMarkers: [], excludedTags: [] });
  const segments = [];
  for (const region of extraction.regions) {
    const segmented = segmentSource(region.inner, { startId: segments.length + 1 });
    region.layout = segmented.layout;
    segments.push(...segmented.segments);
  }
  return { segments, positions: readingPositions(source, extraction.regions, new Map(segments.map(segment => [segment.id, segment.text]))) };
}

test('each line is placed in the original by UTF-16 offsets: its words, not the tags around them', () => {
  const { segments, positions } = placed(SOURCE);
  assert.deepEqual(segments.map(segment => segment.text), ['雨水沿着校门滴下。🌧️', '明天见。', '希望能顺利。']);
  assert.deepEqual([...positions].map(([id, where]) => [id, where.start, where.end, where.text]), [
    [1, 12, 24, '雨水沿着校门滴下。🌧️'],
    [2, 68, 72, '明天见。'],
    [3, 142, 148, '希望能顺利。'],
  ]);
  for (const where of positions.values()) assert.equal(SOURCE.slice(where.start, where.end), where.text);
  const other = placed(OTHER).positions;
  assert.deepEqual([other.get(2).start, other.get(2).end, other.get(3).start, other.get(3).end], [68, 74, 144, 150]);
});

test('a line whose words carry markup stands as the whole line; one written twice is placed in turn', () => {
  const source = '<cxx-story>\n  他说<b>重</b>要的话。\n\n嗯。\n\n嗯。\n</cxx-story>';
  const { segments, positions } = placed(source);
  const marked = segments.find(segment => segment.text.includes('要的话'));
  const where = positions.get(marked.id);
  assert.equal(where.text, '他说<b>重</b>要的话。', 'the whole line, without the blanks before it');
  assert.equal(source.slice(where.start, where.end), where.text);
  const twice = segments.filter(segment => segment.text === '嗯。').map(segment => positions.get(segment.id).start);
  assert.equal(twice.length, 2);
  assert.ok(twice[0] < twice[1], 'the second one after the first');
});

test('a floor\'s state: a run in flight first, then complete, outdated, failed, some lines, none', () => {
  assert.equal(readingState({ total: 3, done: 3, complete: true, processing: true }), 'processing');
  assert.equal(readingState({ total: 3, done: 3, complete: true }), 'ready');
  assert.equal(readingState({ total: 3, done: 0, outdated: true }), 'stale');
  assert.equal(readingState({ total: 3, done: 0, failed: true }), 'failed');
  assert.equal(readingState({ total: 3, done: 1 }), 'partial');
  assert.equal(readingState({ total: 3, done: 0 }), 'absent');
  assert.equal(readingState({ total: 0, complete: true }), 'absent', 'nothing to translate is nothing translated');
  assert.deepEqual([...READING_STATES], ['absent', 'processing', 'partial', 'ready', 'failed', 'stale']);
});

test('a snapshot reads null for a line with no translation, and its revisions follow the original and the reading', () => {
  const { segments, positions } = placed(SOURCE);
  const base = { chatId: 'c', messageId: 12, swipeId: 0, source: SOURCE, segments, positions, language: '日语' };
  const none = readingSnapshot(base);
  assert.equal(none.schema, 1);
  assert.deepEqual(none.owner, { chatId: 'c', messageId: 12, swipeId: 0 });
  assert.equal(none.state, 'absent');
  assert.equal(none.readingRevision, 'none');
  assert.ok(none.segments.every(segment => segment.reading === null));
  assert.equal(none.error, null);
  const some = readingSnapshot({ ...base, translations: new Map([[2, 'また明日。']]), annotations: new Map([[2, { speaker: '千早爱音', emotion: 'happy' }]]), state: 'partial' });
  assert.equal(some.sourceRevision, none.sourceRevision, 'translating leaves the original\'s revision alone');
  assert.notEqual(some.readingRevision, 'none');
  assert.deepEqual(some.segments[1], { id: '2', source: { start: 68, end: 72, text: '明天见。' }, reading: { text: 'また明日。', language: '日语' }, annotations: { speaker: '千早爱音', emotion: 'happy' } });
  assert.equal(some.segments[0].reading, null);
  const failed = readingSnapshot({ ...base, state: 'failed', error: '超时' });
  assert.equal(failed.error, '超时');
  assert.equal(readingSnapshot({ ...base, state: 'nonsense' }).state, 'absent');
});

// A headless stand-in for the parts of the host a translation touches.
function mockHost(chat, extra = {}) {
  const context = {
    chat,
    chatId: 'reading-fixture',
    extensionSettings: {},
    characters: [{ name: '千早爱音', avatar: 'anon.png' }],
    characterId: 0,
    substituteParams: value => String(value ?? ''),
    saveChat: async () => {},
    updateMessageBlock: () => {},
    getRequestHeaders: () => ({}),
    saveSettingsDebounced: () => {},
    eventTypes: {},
    eventSource: { emit: () => {}, on: () => {}, removeListener: () => {} },
    ...extra,
  };
  globalThis.SillyTavern = { getContext: () => context };
  __testing.initializeSettings();
  __testing.installPublicApi();
  return context;
}

function floorOf(texts, shown = 0) {
  return { name: '千早爱音', is_user: false, mes: texts[shown], swipe_id: shown, swipes: [...texts], swipe_info: texts.map(() => ({ extra: {} })), extra: {} };
}

function useHost(t, chat, { reply = () => Promise.resolve(REPLY), settings = {} } = {}) {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const context = mockHost(chat, { generateRaw: () => reply() });
  __testing.configureForTest({ settings: { apiMode: 'follow', streamingWriteback: false, translationOnly: false, retries: 0, bodyTags: ['cxx-story'], ...settings }, initialized: true });
  return context;
}

test('reading.get: absent before a translation, ready after it, the original and its revision untouched', async t => {
  const context = useHost(t, [floorOf([SOURCE])]);
  const { reading, features } = globalThis.__JINGYI__;
  assert.ok(features.includes('reading'));
  const before = await reading.get({ messageId: 0 });
  assert.equal(before.state, 'absent');
  assert.equal(before.sourceMessage, SOURCE);
  assert.deepEqual(before.owner, { chatId: 'reading-fixture', messageId: 0, swipeId: 0 });
  assert.deepEqual(before.segments.map(segment => [segment.id, segment.source.start, segment.source.end, segment.reading]), [
    ['1', 12, 24, null], ['2', 68, 72, null], ['3', 142, 148, null],
  ]);

  await __testing.startTranslation(0, { quiet: true });
  assert.notEqual(context.chat[0].mes, SOURCE, 'the translation is written into the floor');
  const after = await reading.get({ messageId: 0, swipeId: 0 });
  assert.equal(after.state, 'ready');
  assert.equal(after.sourceMessage, SOURCE, 'what 镜译 wrote is not the original');
  assert.equal(after.sourceRevision, before.sourceRevision);
  assert.notEqual(after.readingRevision, 'none');
  assert.deepEqual(after.segments.map(segment => segment.reading?.text), ['雨珠从校门边缘一滴滴落下。🌧️', '明天见啦。', '但愿一切顺利。']);
  assert.ok(after.segments.every(segment => SOURCE.slice(segment.source.start, segment.source.end) === segment.source.text));

  // The same text translated again: the reading may change, the original does not.
  await __testing.startTranslation(0, { quiet: true, force: true });
  const again = await reading.get({ messageId: 0 });
  assert.equal(again.sourceRevision, before.sourceRevision);
  assert.deepEqual(again.segments.map(segment => [segment.id, segment.source.start]), after.segments.map(segment => [segment.id, segment.source.start]));
});

test('reading.get never borrows another alternative\'s translation, and gives null for what is not there', async t => {
  useHost(t, [floorOf([SOURCE, OTHER], 0)]);
  const { reading } = globalThis.__JINGYI__;
  await __testing.startTranslation(0, { quiet: true });
  const shown = await reading.get({ messageId: 0 });
  const other = await reading.get({ messageId: 0, swipeId: 1 });
  assert.equal(shown.state, 'ready');
  assert.equal(other.state, 'absent');
  assert.deepEqual(other.owner, { chatId: 'reading-fixture', messageId: 0, swipeId: 1 });
  assert.equal(other.sourceMessage, OTHER);
  assert.notEqual(other.sourceRevision, shown.sourceRevision);
  assert.ok(other.segments.every(segment => segment.reading === null));
  assert.deepEqual(other.segments.map(segment => [segment.source.start, segment.source.end]), [[12, 24], [68, 74], [144, 150]]);
  assert.equal(await reading.get({ messageId: 0, swipeId: 7 }), null);
  assert.equal(await reading.get({ messageId: 9 }), null);
  assert.equal(await reading.get({}), null);
  assert.equal(await reading.get({ messageId: null }), null, 'null is no floor, not floor 0');
  assert.equal((await reading.get({ messageId: '0', swipeId: '1' })).owner.swipeId, 1, 'the digits of a number do');
});

test('a floor with only its translation left in it reads its original back', async t => {
  const context = useHost(t, [floorOf([SOURCE])], { settings: { translationOnly: true } });
  await __testing.startTranslation(0, { quiet: true });
  assert.doesNotMatch(context.chat[0].mes, /希望能顺利/, 'the floor holds only the translation');
  const snapshot = await globalThis.__JINGYI__.reading.get({ messageId: 0 });
  assert.equal(snapshot.state, 'ready');
  assert.equal(snapshot.sourceMessage, SOURCE);
  assert.equal(snapshot.segments[1].reading.text, '明天见啦。');
});

test('a floor changed after its translation is stale; a failed translation says so, until it succeeds', async t => {
  let fail = true;
  const context = useHost(t, [floorOf([SOURCE])], { reply: () => (fail ? Promise.reject(new Error('模拟的接口错误')) : Promise.resolve(REPLY)) });
  const { reading } = globalThis.__JINGYI__;
  await assert.rejects(__testing.startTranslation(0, { quiet: true }));
  const failed = await reading.get({ messageId: 0 });
  assert.equal(failed.state, 'failed');
  assert.match(failed.error, /模拟的接口错误/);
  fail = false;
  await __testing.startTranslation(0, { quiet: true });
  assert.equal((await reading.get({ messageId: 0 })).state, 'ready');

  context.chat[0].mes = context.chat[0].mes.replace('雨水沿着校门滴下', '雪花沿着校门飘下');
  context.chat[0].swipes[0] = context.chat[0].mes;
  const stale = await reading.get({ messageId: 0 });
  assert.equal(stale.state, 'stale');
  assert.ok(stale.segments.every(segment => segment.reading === null), 'a translation of other words is not this text\'s');
});

test('a floor being translated reads processing, and onChange tells of it, never after the listener left', async t => {
  let release = null;
  useHost(t, [floorOf([SOURCE])], { reply: () => new Promise(resolve => { release = () => resolve(REPLY); }) });
  const { reading } = globalThis.__JINGYI__;
  const heard = [];
  const stop = reading.onChange(event => heard.push(event));
  const run = __testing.startTranslation(0, { quiet: true });
  await wait(20);
  assert.equal((await reading.get({ messageId: 0 })).state, 'processing');
  await wait(220);
  assert.equal(heard.length, 1);
  assert.deepEqual(heard[0].owner, { chatId: 'reading-fixture', messageId: 0, swipeId: 0 });
  assert.deepEqual(heard[0].reasons, ['state']);
  assert.equal(heard[0].state, 'processing');
  release();
  await run;
  await wait(220);
  assert.equal(heard.length, 2);
  assert.equal(heard[1].state, 'ready');
  assert.notEqual(heard[1].readingRevision, 'none');

  // Left before a word on its way arrives: not told.
  stop();
  const again = __testing.startTranslation(0, { quiet: true, force: true });
  await wait(20);
  release();
  await again;
  await wait(220);
  assert.equal(heard.length, 2);
});

test('reading asks no model, saves nothing and changes no setting', async t => {
  const calls = { generate: 0, save: 0 };
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const context = mockHost([floorOf([SOURCE, OTHER])], {
    generateRaw: () => { calls.generate += 1; return Promise.resolve(REPLY); },
  });
  context.saveChat = async () => { calls.save += 1; };
  context.saveSettingsDebounced = () => { calls.save += 1; };
  __testing.configureForTest({ settings: { apiMode: 'follow', streamingWriteback: false, retries: 0, bodyTags: ['cxx-story'] }, initialized: true });
  const before = JSON.stringify(context.chat);
  const { reading } = globalThis.__JINGYI__;
  const stop = reading.onChange(() => {});
  await reading.get({ messageId: 0 });
  await reading.get({ messageId: 0, swipeId: 1 });
  reading.status();
  stop();
  assert.deepEqual(calls, { generate: 0, save: 0 });
  assert.equal(JSON.stringify(context.chat), before, 'the floor is left exactly as it was');
});

test('reading.status gives the settings a reading is shaped by and nothing secret; tts.status says whether speak can read', async t => {
  useHost(t, [floorOf([SOURCE])]);
  const status = globalThis.__JINGYI__.reading.status();
  assert.equal(status.apiVersion, 1);
  assert.equal(status.autoGeneration, true);
  assert.equal(status.translationOnly, false);
  assert.equal(typeof status.targetLanguage, 'string');
  assert.deepEqual(status.bodyTags, ['cxx-story']);
  assert.deepEqual(Object.keys(status.tts).sort(), ['autoRead', 'enabled', 'range', 'side']);
  assert.doesNotMatch(JSON.stringify(status), /key|url|channel/i);
  const tts = globalThis.__JINGYI__.tts.status();
  assert.equal(tts.readReady, false);
  assert.match(tts.readReason, /朗读/);
});

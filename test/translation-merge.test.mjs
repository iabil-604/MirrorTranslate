import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { MESSAGE_META_KEY, getActivePromptProfile, normalizeChannel, remapTranslationsBySource, stripGeneratedTranslationLines } from '../core.js';
import { __testing } from '../index.js';

const SOURCE = '<story_scene>她说：「你好！」旁白。\n\n他回答：「你好！」尾声。</story_scene>\n<reply>她补充：「再见！」</reply>';
const PICTURE = '<bbi_image prompt="a > b, 「你好！」">\n![图](picture.png)\n\n<story_scene>「你好！」</story_scene>\n</bbi_image>';
const WORDS = ['「你好！」', '「你好！」', '「再见！」'];
const ANSWERS = [{ id: 1, text: 'Hello one!' }, { id: 2, text: 'Hello two!' }, { id: 3, text: 'Goodbye!' }];
const withPicture = text => text.replace('她说：', `${PICTURE}\n她说：`);
const waitFor = async predicate => {
  for (let n = 0; n < 1000; n++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail('expected translation progress did not arrive');
};
const setText = (message, text) => { message.mes = text; message.swipes[message.swipe_id] = text; };

function fixture(t, { stream = false, source = SOURCE, onSave = () => {} } = {}) {
  const names = ['SillyTavern', 'fetch', 'crypto', 'toastr', '__JINGYI__'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => {
    __testing.stopTranslating();
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  globalThis.toastr = Object.fromEntries(['success', 'error', 'warning', 'info'].map(kind => [kind, () => {}]));
  const message = { mes: source, swipe_id: 0, swipes: [source, '<story_scene>别的滑动页。</story_scene>'], swipe_info: [{ extra: {} }, { extra: {} }], extra: {} };
  const calls = [], saves = [];
  const request = messages => {
    const input = messages.map(item => { try { return JSON.parse(item.content); } catch { return null; } }).find(item => item?.segments);
    const call = { segments: input.segments, response: Promise.withResolvers() };
    calls.push(call);
    return call;
  };
  const context = {
    chat: [message], chatId: t.name, extensionSettings: {}, characters: [{ name: '樱井' }], characterId: 0,
    substituteParams: value => String(value ?? ''), getRequestHeaders: () => ({}), saveSettingsDebounced() {},
    updateMessageBlock() {}, eventTypes: {}, eventSource: { emit() {}, on() {}, removeListener() {} },
    saveChat: async () => { saves.push(message.mes); await onSave(message, saves.length); },
    ChatCompletionService: { processRequest: async payload => request(payload.messages).response.promise },
  };
  globalThis.SillyTavern = { getContext: () => context };
  globalThis.fetch = async (_url, init) => {
    const call = request(JSON.parse(init.body).messages);
    const body = new ReadableStream({ start(controller) {
      call.controller = controller;
      init.signal.addEventListener('abort', () => controller.error(new DOMException('stopped', 'AbortError')), { once: true });
    } });
    return { ok: true, status: 200, body, text: async () => '' };
  };
  __testing.initializeSettings();
  const settings = __testing.configureForTest({ initialized: true, settings: {
    apiMode: 'independent', streamingWriteback: stream, translationScope: 'dialogue', translationOnly: true,
    bodyTags: ['story_scene'], replaceTags: ['reply'], excludedTags: ['bbi_image'], retries: 0,
    channels: [normalizeChannel({ id: 'test', url: 'https://example.invalid/v1', model: 'translator', timeoutSec: 5 })], selectedChannelId: 'test',
    includeWorldbook: false, includeCharacterCard: false, includeRecentContext: false,
    tts: { side: 'source', range: 'narration', readWhileWriting: true },
  } });
  getActivePromptProfile(settings).targetLanguage = 'English';
  __testing.installPublicApi();
  const delta = (call, value) => call.controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: value }] })}\n\n`));
  return {
    context, message, calls, saves, settings, delta,
    start: options => __testing.startTranslation(0, { quiet: true, ...options }),
    next: async (index = 0) => { await waitFor(() => calls.length > index); return calls[index]; },
    finish(call, result = JSON.stringify(ANSWERS)) {
      if (call.controller) {
        delta(call, typeof result === 'string' ? { content: result } : { content: result.content, reasoning_content: result.reasoning });
        call.controller.close();
      } else call.response.resolve(result);
    },
  };
}

async function assertFloor(f, original, translations = ANSWERS) {
  assert.equal(stripGeneratedTranslationLines(f.message.mes), original);
  assert.equal(f.message.mes.split(PICTURE).length - 1, original.split(PICTURE).length - 1);
  assert.notEqual(f.message.extra[MESSAGE_META_KEY]?.stripped, true, 'dialogue scope retains the original even with translationOnly enabled');
  assert.equal(f.message.swipes[0], f.message.mes);
  assert.equal(f.message.swipes[1], '<story_scene>别的滑动页。</story_scene>');
  const snapshot = await __testing.readMessageSnapshot(0, f.settings);
  assert.deepEqual(snapshot.segments.map(item => item.text), WORDS);
  assert.deepEqual([...snapshot.existingTranslations].sort(([a], [b]) => a - b), translations.map(item => [item.id, item.text]));
  const reading = await globalThis.__JINGYI__.reading.get({ messageId: 0 });
  assert.equal(reading.sourceMessage, original);
  assert.deepEqual(reading.segments.map(item => item.source.start), [
    original.indexOf('「你好！」', original.indexOf('她说：')),
    original.indexOf('「你好！」', original.indexOf('他回答：')),
    original.indexOf('「再见！」', original.indexOf('她补充：')),
  ], 'reading positions point at spoken text, never the same words in the inserted block');
  const floor = await __testing.collectTtsFloor(0, f.settings);
  assert.deepEqual(__testing.ttsUtterances(floor, f.settings).map(item => item.text), translations.map(item => item.text));
  assert.equal(f.settings.tts.side, 'source', 'temporary dialogue reading settings do not overwrite the user preference');
}

function atNextDigest(action) {
  let pending = true;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: { async digest(...args) {
    const result = await webcrypto.subtle.digest(...args);
    if (pending) { pending = false; action(); }
    return result;
  } } } });
}

for (const stream of [false, true]) for (const when of ['request', 'hash']) {
  test(`dialogue insertion during ${when}, stream=${stream}: intact blocks, fresh positions and one request`, async t => {
    const pictured = withPicture(SOURCE).replace('她补充：', `${PICTURE}\n她补充：`);
    const f = fixture(t, { stream, onSave(message, count) {
      if (stream && when === 'hash' && count === 1) atNextDigest(() => setText(message, withPicture(message.mes).replace('她补充：', `${PICTURE}\n她补充：`)));
    } });
    const running = f.start();
    const call = await f.next();
    assert.deepEqual(call.segments.map(item => item.text), WORDS);
    if (when === 'request') setText(f.message, pictured);
    else if (!stream) atNextDigest(() => setText(f.message, pictured));
    f.finish(call);
    assert.equal((await running).skipped, false);
    await assertFloor(f, pictured);
    assert.equal((await f.start()).reason, 'already-translated');
    assert.equal(f.calls.length, 1);
    await __testing.clearFloorTranslation(0, { ask: () => true });
    assert.equal(f.message.mes, pictured);
  });
}

test('a progressive dialogue write can receive a block and resume without retranslating completed dialogue', async t => {
  const f = fixture(t, { stream: true });
  const running = f.start();
  const call = await f.next();
  f.delta(call, { content: '[{"id":1,"text":"Hello one!"},' });
  await waitFor(() => f.saves.length > 0);
  setText(f.message, withPicture(f.message.mes));
  const joined = f.start();
  f.finish(call, '{"id":2,"text":"Hello two!"},{"id":3,"text":"Goodbye!"}]');
  assert.equal((await running).skipped, false);
  assert.equal((await joined).skipped, false);
  await assertFloor(f, withPicture(SOURCE));
  assert.equal(f.calls.length, 1);
});

test('missing final dialogue is repaired on its own after an inserted block', async t => {
  const f = fixture(t, { stream: true });
  const running = f.start();
  const call = await f.next();
  f.delta(call, { content: '[{"id":1,"text":"Hello one!"},' });
  await waitFor(() => f.saves.length > 0);
  setText(f.message, withPicture(f.message.mes));
  f.finish(call, '{"id":2,"text":"Hello two!"}]');
  assert.equal((await running).partial, true);
  await assertFloor(f, withPicture(SOURCE), ANSWERS.slice(0, 2));
  const repair = f.start();
  const next = await f.next(1);
  assert.deepEqual(next.segments.map(item => item.id), [3]);
  f.finish(next, JSON.stringify([ANSWERS[2]]));
  assert.equal((await repair).skipped, false);
  await assertFloor(f, withPicture(SOURCE));
});

for (const stream of [false, true]) for (const shape of ['reasoning-only', 'open-thinking', 'thinking-and-answer']) {
  test(`dialogue insertion plus ${shape}, stream=${stream}`, async t => {
    const source = '<story_scene>她说：「你好！」旁白。</story_scene>';
    const f = fixture(t, { stream, source });
    const running = f.start().then(value => ({ value }), error => ({ error }));
    const call = await f.next();
    setText(f.message, withPicture(source));
    const draft = '{"translations":[{"id":1,"text":"SECRET THOUGHT"}]}';
    const result = shape === 'reasoning-only' ? { content: '', reasoning: draft }
      : shape === 'open-thinking' ? `<think>\n${draft}`
        : `<analysis>${draft}</analysis>\n[{"id":1,"text":"Hello one!"}]`;
    f.finish(call, result);
    const settled = await running;
    assert.equal(stripGeneratedTranslationLines(f.message.mes), withPicture(source));
    assert.equal(f.message.mes.split(PICTURE).length - 1, 1);
    assert.ok(f.saves.every(text => !text.includes('SECRET THOUGHT')));
    if (shape === 'thinking-and-answer') assert.equal(settled.value.skipped, false);
    else { assert.ok(settled.error); assert.equal(f.saves.length, 0); }
  });
}

for (const final of ['some', 'none']) test(`stream failure after a dialogue preview and insertion, fallback has ${final} final translations`, async t => {
  const f = fixture(t, { stream: true });
  const running = f.start().then(value => ({ value }), error => ({ error }));
  const call = await f.next();
  f.delta(call, { content: '[{"id":1,"text":"Temporary draft!"},' });
  await waitFor(() => f.saves.length > 0);
  setText(f.message, withPicture(f.message.mes));
  call.controller.error(new Error('fixture: connection lost'));
  const fallback = await f.next(1);
  assert.deepEqual(fallback.segments.map(item => item.id), [1, 2, 3]);
  f.finish(fallback, final === 'some' ? JSON.stringify([ANSWERS[1]]) : { content: '', reasoning: '1: SECRET THOUGHT' });
  const result = await running;
  assert.equal(stripGeneratedTranslationLines(f.message.mes), withPicture(SOURCE));
  assert.equal(f.message.mes.split(PICTURE).length - 1, 1);
  assert.doesNotMatch(f.message.mes, /Temporary draft|SECRET THOUGHT/);
  if (final === 'some') {
    assert.equal(result.value.partial, true);
    await assertFloor(f, withPicture(SOURCE), [ANSWERS[1]]);
  } else {
    assert.ok(result.error);
    assert.equal(f.message.mes, withPicture(SOURCE), 'no final translation leaves the latest original without preview markers');
    assert.notEqual(f.message.extra?.[MESSAGE_META_KEY]?.complete, true);
  }
});

for (const change of ['source', 'swipe', 'chat']) test(`dialogue insertion and ${change} change during final hashing preserve the new state`, async t => {
  const f = fixture(t);
  const running = f.start();
  const call = await f.next();
  const changed = withPicture(SOURCE).replace('她说：「你好！」', '她说：「晚安！」');
  atNextDigest(() => {
    if (change === 'source') setText(f.message, changed);
    else if (change === 'swipe') { f.message.swipe_id = 1; f.message.mes = f.message.swipes[1]; }
    else { f.context.chatId = 'new-chat'; f.context.chat = [{ mes: changed, swipe_id: 0, extra: {} }]; }
  });
  f.finish(call);
  const result = await running;
  if (change === 'source') {
    assert.equal(result.partial, true);
    assert.equal(stripGeneratedTranslationLines(f.message.mes), changed);
    assert.doesNotMatch(f.message.mes, /Hello one!/);
    assert.doesNotMatch(f.message.mes, /Hello two!/, 'ambiguous repeated dialogue is left for repair instead of guessing');
    assert.match(f.message.mes, /Goodbye!/, 'the unambiguous answer is kept');
  } else {
    assert.equal(result.reason, 'cancelled');
    assert.equal(f.message.swipes[0], SOURCE);
    assert.equal(f.context.chat[0].mes, change === 'chat' ? changed : f.message.swipes[1]);
  }
});

test('dialogue resync preserves occurrence holes and rejects changed duplicate counts', () => {
  const before = [{ id: 1, text: 'A' }, { id: 2, text: 'A' }, { id: 3, text: 'B' }];
  const after = [{ id: 1, text: 'new' }, { id: 2, text: 'A' }, { id: 3, text: 'A' }, { id: 4, text: 'B' }];
  const answers = new Map([[2, 'second A'], [3, 'B answer']]);
  const options = { stableOccurrences: true };
  assert.deepEqual([...remapTranslationsBySource(before, answers, after, options)], [[3, 'second A'], [4, 'B answer']]);
  assert.deepEqual([...remapTranslationsBySource(before, answers, after.filter(item => item.id !== 2), options)], [[4, 'B answer']]);
  assert.deepEqual([...remapTranslationsBySource(before, answers, [...after, { id: 5, text: 'A' }], options)], [[4, 'B answer']]);
});

for (const stream of [false, true]) test(`quoted text only inside inserted image blocks is not dialogue, stream=${stream}`, async t => {
  const source = `<story_scene>只有旁白。${PICTURE}</story_scene>`;
  const f = fixture(t, { stream, source });
  assert.equal((await f.start()).reason, 'no-dialogue');
  assert.equal(f.message.mes, source);
  assert.equal(f.calls.length, 0);
  assert.equal(f.saves.length, 0);
});

test('a failed forced stream restores confirmed translations while keeping the newly inserted block', async t => {
  const f = fixture(t, { stream: true });
  const first = f.start();
  f.finish(await f.next());
  await first;
  const saved = f.saves.length;
  const retry = f.start({ force: true }).then(value => ({ value }), error => ({ error }));
  const call = await f.next(1);
  f.delta(call, { content: '[{"id":1,"text":"Temporary replacement!"},' });
  await waitFor(() => f.saves.length > saved);
  setText(f.message, withPicture(f.message.mes));
  call.controller.error(new Error('fixture: connection lost'));
  f.finish(await f.next(2), { content: '', reasoning: '1: SECRET THOUGHT' });
  assert.ok((await retry).error);
  assert.doesNotMatch(f.message.mes, /Temporary replacement|SECRET THOUGHT/);
  await assertFloor(f, withPicture(SOURCE));
});

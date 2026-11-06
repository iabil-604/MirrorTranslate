import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { MESSAGE_META_KEY, normalizeChannel, readFloor, stripGeneratedTranslationLines } from '../core.js';
import { __testing } from '../index.js';
import { clearDiagnostics, readDiagnostics } from '../diagnostics.js';

const SOURCE = '<story_scene>\n雨が降っている。\n\n彼女は笑った。\n</story_scene>';
const PICTURE = '<bbi_image prompt="a > b, <lora:style:0.6>">\n![图](picture.png)\n\n<story_scene>画像の指定。</story_scene>\n</bbi_image>';
const TRANSLATIONS = [{ id: 1, text: '下着雨。' }, { id: 2, text: '她笑了。' }];
const channel = normalizeChannel({ id: 'test', url: 'https://example.invalid/v1', model: 'translator', timeoutSec: 5 });
const waitFor = async check => {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail('the expected translation event did not arrive');
};

function fixture(t, { stream = false, translationOnly = false, paragraphPerLine = false, onSave = () => {} } = {}) {
  const globals = Object.fromEntries(['SillyTavern', 'fetch', 'crypto', 'toastr'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    __testing.stopTranslating();
    for (const [key, descriptor] of Object.entries(globals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  globalThis.toastr = Object.fromEntries(['success', 'error', 'warning', 'info'].map(key => [key, () => {}]));
  const message = { mes: SOURCE, swipe_id: 0, swipes: [SOURCE], swipe_info: [{ extra: {} }], extra: {} };
  const requested = Promise.withResolvers();
  const answer = Promise.withResolvers();
  const requests = [];
  let controller;
  let saves = 0;
  const context = {
    chat: [message], chatId: t.name, extensionSettings: {}, characters: [{ name: '樱井' }], characterId: 0,
    substituteParams: value => String(value ?? ''), getRequestHeaders: () => ({}), saveSettingsDebounced() {},
    updateMessageBlock() {}, eventTypes: {}, eventSource: { emit() {}, on() {}, removeListener() {} },
    saveChat: async () => { saves++; await onSave(message, saves); },
    generateRaw: ({ prompt }) => {
      requests.push(prompt);
      requested.resolve();
      return answer.promise;
    },
  };
  globalThis.SillyTavern = { getContext: () => context };
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body).messages);
    const body = new ReadableStream({ start(value) {
      controller = value;
      init.signal.addEventListener('abort', () => controller.error(new DOMException('stopped', 'AbortError')), { once: true });
    } });
    requested.resolve();
    return { ok: true, status: 200, body, text: async () => '' };
  };
  __testing.initializeSettings();
  const settings = __testing.configureForTest({ initialized: true, settings: {
    apiMode: stream ? 'independent' : 'follow', streamingWriteback: stream, translationOnly, paragraphPerLine,
    bodyTags: ['story_scene'], excludedTags: ['bbi_image'], channels: [channel], selectedChannelId: 'test',
    autoEdit: true, retries: 0, includeWorldbook: false, includeCharacterCard: false, includeRecentContext: false,
  } });
  clearDiagnostics();
  const push = content => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`));
  return {
    context, message, settings, requests, requested: requested.promise,
    start: () => __testing.startTranslation(0, { quiet: true }),
    push,
    finish: (content = JSON.stringify(TRANSLATIONS)) => {
      if (stream) { push(content); controller.close(); }
      else answer.resolve(content);
    },
  };
}

function setText(message, text) {
  message.mes = text;
  message.swipes[message.swipe_id] = text;
}

async function assertFinished(f, running, original, pictures) {
  const result = await running;
  assert.equal(result.skipped, false);
  assert.equal(result.partial, undefined);
  assert.equal(f.requests.length, 1, 'an inserted tag never starts another model request');
  assert.equal(f.message.mes.split(PICTURE).length - 1, pictures, 'each whole block is kept once, with no translation inside it');
  const floor = readFloor(f.message);
  assert.equal(floor.diverged, false);
  assert.equal(stripGeneratedTranslationLines(floor.text), original, 'the original and complete blocks remain recoverable');
  const snapshot = await __testing.readMessageSnapshot(0, f.settings);
  assert.equal(snapshot.translated, true);
  assert.deepEqual(snapshot.segments.map(item => item.text), ['雨が降っている。', '彼女は笑った。']);
  assert.deepEqual([...snapshot.existingTranslations], TRANSLATIONS.map(item => [item.id, item.text]));
  assert.equal(f.message.swipes[0], f.message.mes);
}

for (const stream of [false, true]) for (const translationOnly of [false, true]) for (const paragraphPerLine of [false, true]) {
  test(`in-flight excluded blocks survive ${stream ? 'streaming' : 'whole'} / ${translationOnly ? 'translation only' : 'bilingual'} / ${paragraphPerLine ? 'per line' : 'paragraph'}`, async t => {
    const f = fixture(t, { stream, translationOnly, paragraphPerLine });
    const running = f.start();
    await f.requested;
    const pictured = SOURCE.replace('雨が降っている。', `雨が降っている。\n${PICTURE}`)
      .replace('彼女は笑った。', `彼女は笑った。${PICTURE}`);
    setText(f.message, pictured);
    // The same entry point an automatic edit invokes must join the running request.
    const joined = f.start();
    f.finish();
    await assertFinished(f, running, pictured, 2);
    assert.equal((await joined).skipped, false);
  });
}

test('an automatic edit during a progressive write keeps the stream and the inserted block intact', async t => {
  const f = fixture(t, { stream: true });
  const running = f.start();
  await f.requested;
  f.push('[{"id":1,"text":"下着雨。"},');
  await waitFor(() => f.message.mes.includes('下着雨。'));
  setText(f.message, f.message.mes.replace('雨が降っている。', `雨が降っている。\n${PICTURE}`));
  __testing.scheduleAuto(0, 'edit');
  await waitFor(() => readDiagnostics().some(entry => entry.scope === 'translation.auto'));
  f.finish('{"id":2,"text":"她笑了。"}]');
  await assertFinished(f, running, SOURCE.replace('雨が降っている。', `雨が降っている。\n${PICTURE}`), 1);
});

test('translation-only conversion waits for the final streamed write, so an intervening tag does not stop completion', async t => {
  let intermediate;
  const f = fixture(t, { stream: true, translationOnly: true, onSave(message, count) {
    if (count !== 1) return;
    intermediate = message.mes;
    setText(message, message.mes.replace('</story_scene>', `${PICTURE}\n</story_scene>`));
  } });
  const running = f.start();
  await f.requested;
  f.finish();
  await assertFinished(f, running, SOURCE.replace('</story_scene>', `${PICTURE}\n</story_scene>`), 1);
  assert.ok(intermediate.includes('雨が降っている。'), 'the original stays available until the final write');
  assert.equal(f.message.extra[MESSAGE_META_KEY].stripped, true);
  assert.doesNotMatch(f.message.mes, /雨が降っている。/);
});

// Pause at an actual asynchronous digest, after the reply arrived but before the writer can commit.
function atNextDigest(change) {
  let changed = false;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: {
    async digest(...args) {
      const result = await webcrypto.subtle.digest(...args);
      if (!changed) { changed = true; change(); }
      return result;
    },
  } } });
}

test('a tag inserted while the writeback snapshot is hashing is reread without losing or retranslating it', async t => {
  const f = fixture(t);
  const running = f.start();
  await f.requested;
  const pictured = SOURCE.replace('雨が降っている。', `雨が降っている。\n${PICTURE}`);
  atNextDigest(() => setText(f.message, pictured));
  f.finish();
  await assertFinished(f, running, pictured, 1);
});

test('a real source edit during the writeback snapshot is preserved and only unchanged lines take translations', async t => {
  const f = fixture(t);
  const running = f.start();
  await f.requested;
  atNextDigest(() => setText(f.message, SOURCE.replace('雨が降っている。', '雪が降っている。')));
  f.finish();
  assert.equal((await running).partial, true);
  assert.match(f.message.mes, /雪が降っている。/);
  assert.doesNotMatch(f.message.mes, /雨が降っている。|下着雨。/);
  assert.match(f.message.mes, /她笑了。/);
  assert.equal(f.requests.length, 1);
});

for (const change of ['swipe', 'chat']) test(`a ${change} changed during the writeback snapshot never receives the old translation`, async t => {
  const f = fixture(t);
  const running = f.start();
  await f.requested;
  const replacement = '<story_scene>雪が降っている。</story_scene>';
  atNextDigest(() => {
    if (change === 'swipe') {
      f.message.swipes.push(replacement);
      f.message.swipe_id = 1;
      f.message.mes = replacement;
    } else {
      f.context.chatId = 'another-chat';
      f.context.chat = [{ mes: replacement, swipe_id: 0, extra: {} }];
    }
  });
  f.finish();
  assert.equal((await running).reason, 'cancelled');
  assert.equal(f.context.chat[0].mes, replacement);
  assert.equal(f.message.swipes[0], SOURCE);
});

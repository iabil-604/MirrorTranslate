import test from 'node:test';
import assert from 'node:assert/strict';

// Probe: does the newest floor's audio get generated automatically in the background once its deep
// analysis is done and the floor has settled, with autoGenerate on and autoRead off (R1's toggles)?
// Real event emitter (SillyTavern 1.18 shape), real onActivate(), a floor that already carries its
// translation (so ttsFloorClosed takes the "carries" branch straight away), mocked sub-model + Fish.

globalThis.document = {
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], visibilityState: 'visible',
  head: null, body: null, documentElement: null, addEventListener() {}, removeEventListener() {},
};
globalThis.toastr = Object.fromEntries(['success', 'error', 'warning', 'info'].map(() => [])
  .concat([['success', () => {}], ['error', () => {}], ['warning', () => {}], ['info', () => {}]]));

const fishCalls = [];
let subModelDelayMs = 250; // stands in for the tester's ~10s deep-analysis wait
let failFishFor = null; // a substring: a Fish request whose text contains it comes back as a hard 400

function sseAnswer(text) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: String(text ?? '') } }] })}\n\n`));
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

globalThis.fetch = async (url, init) => {
  const href = String(url);
  if (href.includes('chat-completions/generate')) {
    await new Promise(resolve => setTimeout(resolve, subModelDelayMs));
    return sseAnswer(JSON.stringify({ voices: [{ id: 1 }, { id: 2, emotion: 'sad' }] }));
  }
  // Everything else is the Fish call (same response shape as test/tts-runtime.test.mjs's mockFish).
  const sent = init?.body ? JSON.parse(init.body) : null;
  fishCalls.push({ url: href, at: Date.now(), init, body: sent });
  if (failFishFor && String(sent?.text ?? '').includes(failFishFor)) return new Response('bad request', { status: 400 });
  const spoken = String(sent?.text ?? '').replace(/<\|speaker:\d+\|>/g, '').replace(/\[[^\]]*\]/g, '');
  const characters = [...spoken].filter(character => /[\p{L}\p{N}]/u.test(character));
  const segments = characters.map((text, index) => ({ text, start: index * 0.25, end: index * 0.25 + 0.2 }));
  const duration = characters.length * 0.25;
  const event = { audio_base64: 'AAEC', content: spoken, alignment: { audio_duration: duration, segments }, chunk_seq: 0, chunk_audio_offset_sec: 0 };
  return new Response(`event: message\ndata: ${JSON.stringify(event)}\n\n`, { status: 200 });
};

const { onActivate, __testing } = await import('../index.js');
const { readDiagnostics, clearDiagnostics } = await import('../diagnostics.js');
const { MESSAGE_META_KEY, assembleBilingual, createTranslationSignature, hashText, segmentSource, normalizeChannel } = await import('../core.js');

class Emitter {
  constructor() { this.events = {}; }
  on(event, listener) { (this.events[event] ??= []).push(listener); }
  removeListener(event, listener) {
    const list = this.events[event];
    if (list && list.includes(listener)) list.splice(list.indexOf(listener), 1);
  }
  async emit(event, ...args) {
    for (const listener of [...(this.events[event] ?? [])]) {
      try { await listener(...args); } catch { /* ignore */ }
    }
  }
}
const T = {
  GENERATION_STARTED: 'generation_started', GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS', GENERATION_ENDED: 'generation_ended', GENERATION_STOPPED: 'generation_stopped',
  CHARACTER_MESSAGE_RENDERED: 'character_message_rendered', MESSAGE_RECEIVED: 'message_received', MESSAGE_DELETED: 'message_deleted',
  MESSAGE_SWIPED: 'message_swiped', MESSAGE_EDITED: 'message_edited', MESSAGE_UPDATED: 'message_updated', CHAT_CHANGED: 'chat_id_changed',
  MESSAGE_SWIPE_DELETED: 'message_swipe_deleted', MORE_MESSAGES_LOADED: 'more_messages_loaded',
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const eventSource = new Emitter();
const chat = [];
const context = {
  chat, chatId: 'r1-chat', extensionSettings: { 'jingyi-translator': { showFloatingButton: false } }, characters: [{ name: '泰罗', avatar: 'taro.png', description: '', personality: '', scenario: '' }], characterId: 0,
  name1: '玩家', name2: '泰罗',
  substituteParams: value => String(value ?? ''), saveChat: async () => {}, updateMessageBlock: () => {}, getRequestHeaders: () => ({}),
  saveSettingsDebounced: () => {}, eventTypes: T, eventSource, streamingProcessor: null,
  ChatCompletionService: { processRequest: async payload => {
    await new Promise(resolve => setTimeout(resolve, subModelDelayMs));
    return { content: JSON.stringify({ voices: [{ id: 1 }, { id: 2, emotion: 'sad' }] }) };
  } },
};
globalThis.SillyTavern = { getContext: () => context };
await onActivate();
await eventSource.emit(T.CHAT_CHANGED, 'r1-chat');

const CHANNEL = normalizeChannel({ id: 'c1', name: 'test', url: 'https://relay.example/v1', key: 'k', model: 'labeler' });
const settings = __testing.configureForTest({
  settings: {
    apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1',
    autoGeneration: true,
    tts: {
      enabled: true, deepUnlocked: true, mode: 'deep', side: 'translation', prosodySplit: true,
      autoGenerate: true, autoRead: false, playAfterGenerate: true,
      context: { character: false, worldbook: false, recent: false, floors: 0 },
      fish: { key: 'sk-test', viaProxy: true },
    },
  },
});

async function translatedFloor(source, translations) {
  const segmented = segmentSource(source, settings);
  const inner = `\n${assembleBilingual(segmented.layout, new Map(translations), settings)}\n`;
  return {
    name: '泰罗', is_user: false, is_system: false,
    mes: `<story_scene>${inner}</story_scene>`,
    swipe_id: 0,
    swipes: [`<story_scene>${inner}</story_scene>`],
    extra: {
      [MESSAGE_META_KEY]: {
        schema_version: 4,
        swipe_id: 0,
        complete: true,
        source_hash: await hashText(createTranslationSignature([{ tagName: 'story_scene', segments: segmentSource(inner, settings).segments }])),
        segment_prefix: settings.segmentPrefix ?? '',
        segment_suffix: settings.segmentSuffix ?? '',
        translation_prefix: settings.translationPrefix ?? '{',
        translation_suffix: settings.translationSuffix ?? '}',
        paragraph_per_line: settings.paragraphPerLine ?? false,
      },
    },
  };
}

test('R1: deep-mode autoGenerate makes the floor\'s audio in the background, before any play press', async () => {
  clearDiagnostics();
  fishCalls.length = 0;
  chat.push(await translatedFloor('空は青い。泰羅は言った：「暑い！」', [[1, '蓝蓝的天空，泰罗说：「我操好热啊！」']]));
  const id = chat.length - 1;
  await eventSource.emit(T.CHARACTER_MESSAGE_RENDERED, id, 'normal');
  // Wait past: ttsFloorClosed's own 1200ms appointment -> deep analysis (subModelDelayMs) -> autoGenerate -> Fish.
  // Nobody calls playTtsFloor in this test.
  await wait(1200 + subModelDelayMs + 1500);
  const recorded = readDiagnostics().filter(entry => entry.scope === 'tts.recording' && entry.message.startsWith(`第 ${id} 楼`));
  assert.ok(recorded.length > 0, `expected an automatic tts.recording diagnostic for floor ${id}; diagnostics: ${JSON.stringify(readDiagnostics().map(e => [e.scope, e.message]))}`);
  assert.ok(fishCalls.length > 0, 'expected an automatic Fish call before any play press');
});

test('R1: a Fish failure on one side does not stop the other, independent side\'s background audio', async () => {
  clearDiagnostics();
  fishCalls.length = 0;
  __testing.configureForTest({ settings: { tts: { ...settings.tts, side: 'both' } } });
  // The translation's own words fail every time; the original's do not.
  failFishFor = '好热啊';
  chat.push(await translatedFloor('空は青い。泰羅は言った：「暑い！」', [[1, '蓝蓝的天空，泰罗说：「我操好热啊！」']]));
  const id = chat.length - 1;
  await eventSource.emit(T.CHARACTER_MESSAGE_RENDERED, id, 'normal');
  await wait(1200 + subModelDelayMs * 2 + 2000);
  failFishFor = null;
  const messages = readDiagnostics().filter(entry => entry.message.startsWith(`第 ${id} 楼`));
  assert.ok(messages.some(entry => entry.scope === 'tts.auto' && entry.message.includes('译文')), `expected the translation side's failure to be logged; got: ${JSON.stringify(messages.map(e => [e.scope, e.message]))}`);
  assert.ok(messages.some(entry => entry.scope === 'tts.recording' && entry.message.includes('原文')), `expected the original side to still be made automatically despite the translation side's failure; got: ${JSON.stringify(messages.map(e => [e.scope, e.message]))}`);
  __testing.configureForTest({ settings: { tts: { ...settings.tts, side: 'translation' } } });
});

test.after(() => __testing.forgetTtsSession?.());

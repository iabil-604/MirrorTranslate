import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MESSAGE_META_KEY,
  assembleBilingual,
  createTranslationSignature,
  hashText,
  normalizeChannel,
  segmentSource,
} from '../core.js';
import { __testing } from '../index.js';

// The host pieces the read-aloud runtime touches, with a chat of its own so labels and cached audio from
// one test never answer for another.
function mockHost(chatId, { processRequest } = {}) {
  const toasts = [];
  globalThis.toastr = Object.fromEntries(['success', 'error', 'warning', 'info'].map(kind => [kind, message => toasts.push([kind, message])]));
  const context = {
    chat: [],
    chatId,
    name1: '玩家',
    name2: '泰罗',
    extensionSettings: {},
    characters: [{ name: '泰罗', avatar: 'taro.png' }],
    characterId: 0,
    substituteParams: value => value,
    saveChat: async () => {},
    updateMessageBlock: () => {},
    getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'host-token' }),
    saveSettingsDebounced: () => {},
    eventTypes: {},
    eventSource: { emit: () => {}, on: () => {}, removeListener: () => {} },
    ChatCompletionService: { processRequest: processRequest ?? (async () => ({ content: '{}' })) },
  };
  globalThis.SillyTavern = { getContext: () => context };
  __testing.initializeSettings();
  return { context, toasts };
}

async function translatedFloor(source, translations, settings, annotations = undefined) {
  const segmented = segmentSource(source, settings);
  const inner = `\n${assembleBilingual(segmented.layout, new Map(translations), settings)}\n`;
  return {
    mes: `<story_scene>${inner}</story_scene>`,
    swipe_id: 0,
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
        ...(annotations ? { annotations } : {}),
      },
    },
  };
}

const FISH = { key: 'sk-test', viaProxy: true };
const CHANNEL = normalizeChannel({ id: 'c1', name: 'test', url: 'https://relay.example/v1', key: 'k', model: 'labeler' });

function restoreGlobals(t) {
  const host = globalThis.SillyTavern;
  const fetchBefore = globalThis.fetch;
  const toastrBefore = globalThis.toastr;
  t.after(() => {
    globalThis.SillyTavern = host;
    globalThis.fetch = fetchBefore;
    globalThis.toastr = toastrBefore;
  });
}

test('a floor is read through its own boundaries whatever the visible affixes, and literal tags otherwise', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-collect');
  const settings = __testing.configureForTest({ settings: { translationPrefix: '<jy-translation>', translationSuffix: '</jy-translation>' } });
  context.chat.push(await translatedFloor('空は青い。\n\n「暑い！」', [[1, '天空很蓝。'], [2, '「好热！」']], settings));
  context.chat.push({ mes: '<story>x</story>\n<jy-translation>风停了。\n「走吧。」</jy-translation>', swipe_id: 0, extra: {} });
  context.chat.push({ mes: '什么都没有。', swipe_id: 0, extra: {} });

  const translated = await __testing.collectTtsFloor(0, settings);
  assert.equal(translated.source, 'translation');
  assert.deepEqual(translated.lines, [{ lineId: 1, text: '天空很蓝。' }, { lineId: 2, text: '「好热！」' }]);
  assert.equal(translated.floorId, 'tts-collect|0|0|translation');

  const tagged = await __testing.collectTtsFloor(1, settings);
  assert.equal(tagged.source, 'tags');
  assert.deepEqual(tagged.lines.map(line => line.text), ['风停了。', '「走吧。」']);
  assert.equal(await __testing.collectTtsFloor(2, settings), null);

  // A different translation is a different version, which is what retires the cached audio.
  context.chat[0] = await translatedFloor('空は青い。\n\n「暑い！」', [[1, '天很蓝。'], [2, '「好热！」']], settings);
  assert.notEqual((await __testing.collectTtsFloor(0, settings)).version, translated.version);
});

test('reading the original takes the source lines, translated or not, with each translation as a reference', async t => {
  restoreGlobals(t);
  const requests = [];
  const { context } = mockHost('tts-source', {
    async processRequest(payload) {
      requests.push(payload);
      return { content: JSON.stringify({ labels: [{ id: 2, type: 'dialogue', speaker: '樱井', emotion: 'happy' }] }) };
    },
  });
  const settings = __testing.configureForTest({
    settings: { apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1', tts: { enabled: true, side: 'source', analysis: 'model', fish: FISH } },
  });
  context.chat.push(await translatedFloor('桜井は振り返った。\n\n「来たんだね」', [[1, '樱井回过头。'], [2, '「你来了啊」']], settings, { 2: { speaker: '樱井', emotion: 'happy' } }));
  context.chat.push({ mes: '<story_scene>\n雨が降っている。\n</story_scene>', swipe_id: 0, extra: {} });

  const source = await __testing.collectTtsFloor(0, settings);
  assert.equal(source.source, 'source');
  assert.equal(source.floorId, 'tts-source|0|0|source');
  assert.deepEqual(source.lines, [{ lineId: 1, text: '桜井は振り返った。' }, { lineId: 2, text: '「来たんだね」' }]);
  assert.deepEqual([...source.references], [[1, '樱井回过头。'], [2, '「你来了啊」']]);

  const { segments } = await __testing.prepareTtsSegments(source, settings);
  assert.deepEqual(segments.map(item => [item.type, item.speaker, item.text]), [['narration', 'narrator', '桜井は振り返った。'], ['dialogue', '樱井', '来たんだね']]);
  const input = JSON.parse(requests[0].messages.at(-1).content);
  assert.deepEqual(input.translations, [{ line: 1, text: '樱井回过头。' }, { line: 2, text: '「你来了啊」' }]);
  assert.equal(input.utterances[1].line, 2);
  assert.match(requests[0].messages[0].content, /按 roster 或译文里的写法/);

  // A floor that was never translated has an original to read all the same.
  const untranslated = await __testing.collectTtsFloor(1, settings);
  assert.deepEqual(untranslated.lines, [{ lineId: 1, text: '雨が降っている。' }]);
  assert.equal(untranslated.references, null);
  const translationSide = __testing.configureForTest({ settings: { tts: { ...settings.tts, side: 'translation' } } });
  assert.equal(await __testing.collectTtsFloor(1, translationSide), null);
});

test('the analysis request labels utterances once per text version and never rewrites a line', async t => {
  restoreGlobals(t);
  const requests = [];
  const { context } = mockHost('tts-analysis', {
    async processRequest(payload) {
      requests.push(payload);
      return { content: JSON.stringify({ labels: [{ id: 2, type: 'dialogue', speaker: '泰罗', emotion: 'angry', intensity: 2, text: '哎呀，真是热死我了！' }] }) };
    },
  });
  const settings = __testing.configureForTest({
    settings: { apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1', tts: { enabled: true, analysis: 'model', fish: FISH } },
  });
  context.chat.push(await translatedFloor('空は青い。泰羅は言った：「暑い！」', [[1, '蓝蓝的天空，泰罗说：「我操好热啊！」']], settings));
  const floor = await __testing.collectTtsFloor(0, settings);
  const first = await __testing.prepareTtsSegments(floor, settings);
  assert.deepEqual(first.segments.map(({ type, speaker, emotion, intensity, text }) => ({ type, speaker, emotion, intensity, text })), [
    { type: 'narration', speaker: 'narrator', emotion: null, intensity: null, text: '蓝蓝的天空，泰罗说：' },
    { type: 'dialogue', speaker: '泰罗', emotion: 'angry', intensity: 2, text: '我操好热啊！' },
  ]);
  const input = JSON.parse(requests[0].messages.at(-1).content);
  assert.equal(input.task, 'label_utterances_for_audiobook');
  assert.deepEqual(input.utterances.map(item => item.text), ['蓝蓝的天空，泰罗说：', '「我操好热啊！」']);

  await __testing.prepareTtsSegments(floor, settings);
  assert.equal(requests.length, 1, 'the same text version is not analysed twice');
});

test('a failed analysis reads with the translation annotations and asks again next time', async t => {
  restoreGlobals(t);
  let calls = 0;
  const { context, toasts } = mockHost('tts-analysis-fail', {
    async processRequest() {
      calls += 1;
      throw new Error('relay down');
    },
  });
  const settings = __testing.configureForTest({
    settings: { apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1', tts: { enabled: true, analysis: 'model', fish: FISH } },
  });
  context.chat.push(await translatedFloor('「暑い！」', [[1, '「好热！」']], settings, { 1: { speaker: '泰罗', emotion: 'happy', intensity: 1 } }));
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  assert.deepEqual([segments[0].speaker, segments[0].emotion], ['泰罗', 'happy']);
  assert.ok(toasts.some(([kind, message]) => kind === 'warning' && /朗读分析失败/.test(message)));
  await __testing.prepareTtsSegments(floor, settings);
  assert.equal(calls, 2);
});

test('a sentence goes to /v1/tts through the host proxy once, and is played from the cache after', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-sentence');
  const settings = __testing.configureForTest({
    settings: {
      tts: { enabled: true, mode: 'sentence', analysis: 'annotations', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: { ...FISH, model: 's2.1-pro-free' } },
      ttsVoices: { 'taro.png': [{ name: '泰罗', voiceId: 'voice-taro' }] },
    },
  });
  context.chat.push(await translatedFloor('「暑い！」', [[1, '「好热！」']], settings, { 1: { speaker: '泰罗', emotion: 'happy', intensity: 1 } }));
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    // The host proxy forwards the audio without a content type.
    return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0xc4]), { status: 200 });
  };
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  const first = await __testing.ensureSentenceAudio(floor, segments[0], settings);
  assert.equal(first.cached, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/proxy/https://api.fish.audio/v1/tts');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-test');
  assert.equal(calls[0].init.headers.model, 's2.1-pro-free');
  assert.equal(calls[0].init.headers['X-CSRF-Token'], 'host-token');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.text, '[happy] 好热！');
  assert.equal(body.reference_id, 'voice-taro');
  assert.equal(first.record.parts[0].blob.type, 'audio/mpeg');

  const again = await __testing.ensureSentenceAudio(floor, segments[0], settings);
  assert.equal(again.cached, true);
  assert.equal(calls.length, 1, 'no second request for the same sentence');
});

test('a whole floor is one timestamp stream whose sentences land on the audio timeline', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-floor');
  const settings = __testing.configureForTest({
    settings: {
      tts: { enabled: true, mode: 'floor', analysis: 'annotations', narratorVoice: 'voice-narrator', fish: FISH },
      ttsVoices: { 'taro.png': [{ name: '泰罗', voiceId: 'voice-taro' }] },
    },
  });
  context.chat.push(await translatedFloor(
    '青い空。\n\n「なんで来た？」\n\n泰羅はカップを置いた。',
    [[1, '蓝蓝的天空上有红红的太阳。'], [2, '「你怎么来了？」'], [3, '泰罗放下了杯子。']],
    settings,
    { 2: { speaker: '泰罗', emotion: '惊讶', intensity: 1 } },
  ));
  // Two text chunks, the second with its own offset, alignment snapshots growing and the audio arriving
  // in pieces — the shape the real endpoint returned for a request like this one.
  const chunk0 = [...'蓝蓝的天空上有红红的太阳你怎么来了'].map((text, index) => ({ text, start: index * 0.24, end: index * 0.24 + 0.2 }));
  const chunk1 = [...'泰罗放下了杯子'].map((text, index) => ({ text, start: 0.16 + index * 0.2, end: 0.32 + index * 0.2 }));
  const events = [
    { audio_base64: 'AAEC', content: '…', alignment: { audio_duration: 4.3, segments: chunk0.slice(0, 5) }, chunk_seq: 0, chunk_audio_offset_sec: 0 },
    { audio_base64: 'AwQF', content: '…', alignment: { audio_duration: 4.3, segments: chunk0 }, chunk_seq: 0, chunk_audio_offset_sec: 0 },
    { audio_base64: 'BgcI', content: '泰罗放下了杯子。', alignment: { audio_duration: 1.8, segments: chunk1 }, chunk_seq: 1, chunk_audio_offset_sec: 4.32 },
  ];
  const wire = events.map(event => `event: message\ndata: ${JSON.stringify(event)}\n\n`).join('');
  let requests = 0;
  let sentBody = null;
  globalThis.fetch = async (url, init) => {
    requests += 1;
    assert.equal(url, '/proxy/https://api.fish.audio/v1/tts/stream/with-timestamp');
    sentBody = JSON.parse(init.body);
    const bytes = new TextEncoder().encode(wire);
    return new Response(new ReadableStream({
      start(controller) {
        for (let index = 0; index < bytes.length; index += 37) controller.enqueue(bytes.slice(index, index + 37));
        controller.close();
      },
    }), { status: 200 });
  };
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  const { record, cached } = await __testing.ensureFloorAudio(floor, segments, settings);
  assert.equal(cached, false);
  assert.deepEqual(sentBody.reference_id, ['voice-narrator', 'voice-taro']);
  assert.equal(sentBody.text, '<|speaker:0|>蓝蓝的天空上有红红的太阳。\n<|speaker:1|>[surprised] 你怎么来了？\n<|speaker:0|>泰罗放下了杯子。');
  assert.equal(record.parts.length, 1);
  assert.equal(record.parts[0].blob.size, 9, 'every audio chunk is kept in order');
  assert.deepEqual(record.timeline.map(entry => [entry.id, entry.start, entry.end, entry.coverage]), [
    [1, 0, 2.84, 1],
    [2, 2.88, 4.04, 1],
    [3, 4.48, 5.84, 1],
  ]);
  const again = await __testing.ensureFloorAudio(floor, segments, settings);
  assert.equal(again.cached, true);
  assert.equal(requests, 1);
});

test('a floor with an unvoiced speaker says who is missing, and Fish failures surface as readable errors', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-errors');
  const settings = __testing.configureForTest({
    settings: { tts: { enabled: true, mode: 'floor', analysis: 'annotations', narratorVoice: '', dialogueVoice: '', fish: FISH }, ttsVoices: {} },
  });
  context.chat.push(await translatedFloor('「暑い！」', [[1, '「好热！」']], settings, { 1: { speaker: '佐菲' } }));
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  await assert.rejects(__testing.ensureFloorAudio(floor, segments, settings), /佐菲/);

  const voiced = __testing.configureForTest({ settings: { tts: { ...settings.tts, dialogueVoice: 'voice-default' } } });
  globalThis.fetch = async () => new Response('{"status":402,"message":"Insufficient API credit."}', { status: 402 });
  await assert.rejects(__testing.ensureFloorAudio(floor, segments, voiced), /余额不足/);
  globalThis.fetch = async () => new Response('CORS proxy is disabled. Enable it in config.yaml or use the --corsProxy flag.', { status: 404 });
  await assert.rejects(__testing.ensureSentenceAudio(floor, segments[0], voiced), /enableCorsProxy/);
});

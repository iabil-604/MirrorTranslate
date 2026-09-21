import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MESSAGE_META_KEY,
  assembleBilingual,
  createTranslationSignature,
  hashText,
  mergeSettings,
  normalizeChannel,
  segmentSource,
} from '../core.js';
import { __testing } from '../index.js';

// One answer in one SSE frame: how the host's generate endpoint replies to a streamed request.
function sseAnswer(text) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: String(text ?? '') } }] })}\n\n`));
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return { ok: true, status: 200, body, text: async () => '' };
}

// The host pieces the read-aloud runtime touches, with a chat of its own so labels and cached audio from
// one test never answer for another.
function mockHost(chatId, { processRequest } = {}) {
  const answer = processRequest ?? (async () => ({ content: '{}' }));
  // The reading's own requests go out as a stream, straight to the host's endpoint; the same handler
  // answers them, so a test writes one `processRequest` and asserts on one payload either way.
  const otherFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes('chat-completions/generate')) return otherFetch ? otherFetch(url, init) : new Response('', { status: 404 });
    const payload = init?.body ? JSON.parse(init.body) : {};
    const reply = await answer(payload);
    return sseAnswer(typeof reply === 'string' ? reply : reply?.content ?? '');
  };
  const toasts = [];
  globalThis.toastr = Object.fromEntries(['success', 'error', 'warning', 'info'].map(kind => [kind, message => toasts.push([kind, message])]));
  const context = {
    chat: [],
    chatId,
    name1: '玩家',
    name2: '泰罗',
    extensionSettings: {},
    characters: [{ name: '泰罗', avatar: 'taro.png', description: '怕热，嘴硬，一急就想脱衣服。', personality: '', scenario: '' }],
    characterId: 0,
    substituteParams: value => value,
    saveChat: async () => {},
    updateMessageBlock: () => {},
    getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'host-token' }),
    saveSettingsDebounced: () => {},
    eventTypes: {},
    eventSource: { emit: () => {}, on: () => {}, removeListener: () => {} },
    ChatCompletionService: { processRequest: answer },
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

// The settings as the runtime holds them after configureForTest, for a second call on the same floor.
function runtime() {
  return __testing.configureForTest({});
}

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

// A Fish stand-in: every request answers with one text chunk whose characters are aligned in order, so
// each sentence lands on its own stretch of the timeline. The bodies are kept for the assertions.
function mockFish({ status = 200, body = null, audio = null } = {}) {
  const calls = [];
  const toSubModel = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('chat-completions/generate') && toSubModel) return toSubModel(url, init);
    const sent = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, init, body: sent });
    if (status !== 200) return new Response(body ?? '', { status });
    const spoken = String(sent?.text ?? '').replace(/<\|speaker:\d+\|>/g, '').replace(/\[[^\]]*\]/g, '');
    const characters = [...spoken].filter(character => /[\p{L}\p{N}]/u.test(character));
    const segments = characters.map((text, index) => ({ text, start: index * 0.25, end: index * 0.25 + 0.2 }));
    const duration = characters.length * 0.25;
    const event = { audio_base64: audio ? audio(calls.length, duration) : 'AAEC', content: spoken, alignment: { audio_duration: duration, segments }, chunk_seq: 0, chunk_audio_offset_sec: 0 };
    return new Response(`event: message\ndata: ${JSON.stringify(event)}\n\n`, { status: 200 });
  };
  return calls;
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
    settings: { apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1', tts: { enabled: true, side: 'source', analysis: 'light', fish: FISH } },
  });
  // No labels from the translation, so the light reading is asked; with labels it would not be.
  context.chat.push(await translatedFloor('桜井は振り返った。\n\n「来たんだね」', [[1, '樱井回过头。'], [2, '「你来了啊」']], settings));
  context.chat.push({ mes: '<story_scene>\n雨が降っている。\n</story_scene>', swipe_id: 0, extra: {} });

  const source = await __testing.collectTtsFloor(0, settings);
  assert.equal(source.source, 'source');
  assert.equal(source.floorId, 'tts-source|0|0|source');
  assert.deepEqual(source.lines, [{ lineId: 1, text: '桜井は振り返った。' }, { lineId: 2, text: '「来たんだね」' }]);
  assert.deepEqual([...source.references], [[1, '樱井回过头。'], [2, '「你来了啊」']]);

  const { segments } = await __testing.prepareTtsSegments(source, settings);
  assert.deepEqual(segments.map(item => [item.type, item.speaker, item.text, item.lang]), [['narration', 'narrator', '桜井は振り返った。', 'ja'], ['dialogue', '樱井', '来たんだね', 'ja']]);
  const input = JSON.parse(requests[0].messages.at(-1).content);
  assert.deepEqual(input.translations, [{ line: 1, text: '樱井回过头。' }, { line: 2, text: '「你来了啊」' }]);
  assert.deepEqual(input.lines, [{ line: 1, text: '桜井は振り返った。' }, { line: 2, text: '⟦2⟧「来たんだね」' }]);
  assert.match(requests[0].messages[0].content, /按 roster 或译文里的写法/);

  // A floor that was never translated has an original to read all the same.
  const untranslated = await __testing.collectTtsFloor(1, settings);
  assert.deepEqual(untranslated.lines, [{ lineId: 1, text: '雨が降っている。' }]);
  assert.equal(untranslated.references, null);
  const translationSide = __testing.configureForTest({ settings: { tts: { ...settings.tts, side: 'translation' } } });
  assert.equal(await __testing.collectTtsFloor(1, translationSide), null);
});

test('the light analysis labels utterances once per text version and never rewrites a line', async t => {
  restoreGlobals(t);
  const requests = [];
  const { context } = mockHost('tts-analysis', {
    async processRequest(payload) {
      requests.push(payload);
      return { content: JSON.stringify({ labels: [{ id: 2, type: 'dialogue', speaker: '泰罗', emotion: 'angry', intensity: 2, text: '哎呀，真是热死我了！' }] }) };
    },
  });
  const settings = __testing.configureForTest({
    settings: { apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1', tts: { enabled: true, mode: 'stream', analysis: 'auto', fish: FISH } },
  });
  context.chat.push(await translatedFloor('空は青い。泰羅は言った：「暑い！」', [[1, '蓝蓝的天空，泰罗说：「我操好热啊！」']], settings));
  const floor = await __testing.collectTtsFloor(0, settings);
  const first = await __testing.prepareTtsSegments(floor, settings);
  assert.deepEqual(first.segments.map(({ type, speaker, emotion, intensity, text }) => ({ type, speaker, emotion, intensity, text })), [
    { type: 'narration', speaker: 'narrator', emotion: null, intensity: null, text: '蓝蓝的天空，泰罗说：' },
    { type: 'dialogue', speaker: '泰罗', emotion: 'angry', intensity: 2, text: '我操好热啊！' },
  ]);
  const input = JSON.parse(requests[0].messages.at(-1).content);
  assert.equal(input.task, 'sketch_voices_for_audiobook', 'a floor without a skeleton gets the simple reading');
  assert.deepEqual(input.lines, [{ line: 1, text: '蓝蓝的天空，泰罗说：⟦2⟧「我操好热啊！」' }], 'the paragraph goes whole, the dialogue inside it numbered');

  await __testing.prepareTtsSegments(floor, settings);
  assert.equal(requests.length, 1, 'the same text version is not analysed twice');
});
test('the deep reading carries the card and the recent floors, and every sentence comes back with a voice', async t => {
  restoreGlobals(t);
  const requests = [];
  const { context } = mockHost('tts-deep', {
    async processRequest(payload) {
      requests.push(payload);
      return {
        content: JSON.stringify({
          scene: '闷热的教室',
          characters: [{ name: '泰罗', state: '快热疯了', habit: '句尾拖长' }],
          voices: [
            { id: 1, type: 'narration' },
            { id: 2, type: 'dialogue', speaker: '泰罗', emotion: 'frustrated', intensity: 2, speed: 'fast', volume: 'loud', tension: 1, stress: ['热'], pauses: [{ after: '我操', length: 'short' }], subtext: '想让人拦着' },
          ],
        }),
      };
    },
  });
  const settings = __testing.configureForTest({
    settings: { apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1', tts: { enabled: true, deepUnlocked: true, mode: 'floor', analysis: 'auto', context: { character: true, worldbook: false, recent: true, floors: 2 }, fish: FISH } },
  });
  context.chat.push({ mes: '<story_scene>\n前一楼：泰罗擦了擦汗。\n</story_scene>', is_user: false, swipe_id: 0, extra: {} });
  context.chat.push(await translatedFloor('空は青い。泰羅は言った：「暑い！」', [[1, '蓝蓝的天空，泰罗说：「我操好热啊！」']], settings));
  const floor = await __testing.collectTtsFloor(1, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  const input = JSON.parse(requests[0].messages.at(-1).content);
  assert.equal(input.task, 'direct_voices_for_audiobook');
  assert.match(input.references.character, /怕热，嘴硬/);
  assert.match(input.references.recent, /泰罗擦了擦汗/);
  assert.equal('worldbook' in input.references, false);
  assert.equal(segments[1].emotion, 'frustrated');
  assert.equal(segments[1].voice.subtext, '想让人拦着');
  assert.deepEqual(segments[1].voice.pauses, [{ after: '我操', length: 'short' }]);

  const inspected = await __testing.ttsInspect(1, 2);
  assert.equal(inspected.text, '[frustrated] 我操 [pause] 好 [emphasis] 热啊！', 'Fish\'s own words only: the mood, the pause, the stress');
  assert.deepEqual(inspected.prosody, { speed: 1.12, volume: 3 });
  assert.ok(inspected.summary.some(([term]) => term === '潜台词'));
  assert.equal(inspected.depth, 'deep');
  assert.equal(requests.length, 1);
  // A longer cast list or another floor on top is no reason to read this floor again.
  __testing.configureForTest({ settings: { ttsVoices: { 'taro.png': [{ name: '佐菲', voiceId: 'voice-zoffy' }] } } });
  context.chat.push({ mes: '<story_scene>\n后一楼。\n</story_scene>', is_user: false, swipe_id: 0, extra: {} });
  await __testing.prepareTtsSegments(floor, runtime());
  assert.equal(requests.length, 1, 'the reading is keyed by the text alone');

  // The fast, loud sentence is its own request: Fish's prosody is per request.
  const calls = mockFish();
  const { items } = await __testing.ttsItemsFor(floor, segments, settings);
  const { record } = await __testing.ensureTtsRecording(floor, 'floor:all', items, settings);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body.prosody, { speed: 1, volume: 0 });
  assert.deepEqual(calls[1].body.prosody, { speed: 1.12, volume: 3 });
  assert.equal(calls[1].body.text, '[frustrated] 我操 [pause] 好 [emphasis] 热啊！');
  assert.equal(record.parts.length, 2);
  assert.deepEqual(record.timeline.map(entry => [entry.id, entry.part]), [[1, 0], [2, 1]]);
});



test('the deep reading ignores the translation\'s marks and reads the text it will speak', async t => {
  restoreGlobals(t);
  const requests = [];
  const { context } = mockHost('tts-hints', {
    async processRequest(payload) {
      requests.push(payload);
      return { content: JSON.stringify({ voices: [{ id: 1 }, { id: 2, emotion: 'nervous', volume: 'quiet' }] }) };
    },
  });
  const settings = __testing.configureForTest({
    settings: { apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1', tts: { enabled: true, deepUnlocked: true, mode: 'deep', analysis: 'deep', context: { character: false, worldbook: false, recent: false, floors: 0 }, fish: FISH } },
  });
  context.chat.push(await translatedFloor('風。\n\n「暑い！」', [[1, '风停了。'], [2, '「好热！」']], settings, { 2: { speaker: '泰罗', emotion: 'happy', intensity: 1 } }));
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  const input = JSON.parse(requests[0].messages.at(-1).content);
  assert.equal('skeleton' in input, false, 'the translation marked this floor already, and the deep reading still reads it itself');
  assert.deepEqual(input.lines, [{ line: 1, text: '风停了。' }, { line: 2, text: '⟦2⟧「好热！」' }], 'the text that will be spoken, so its pauses and stresses land on real words');
  assert.equal('references' in input, false, 'no context asked for, none sent');
  // The translation's own mark still names the speaker it knew; the mood is the deep reading's.
  assert.deepEqual(segments.map(item => [item.type, item.speaker, item.emotion]), [['narration', 'narrator', null], ['dialogue', '泰罗', 'nervous']]);
  const inspected = await __testing.ttsInspect(0, 2);
  assert.equal(inspected.text, '[nervous] 好热！');
  assert.equal(requests.length, 1, 'one request for the floor');
});

test('reading both languages: one reading of the original carries over to the translation, each side its own audio', async t => {
  restoreGlobals(t);
  const requests = [];
  const { context } = mockHost('tts-both', {
    async processRequest(payload) {
      requests.push(payload);
      return { content: JSON.stringify({ voices: [{ id: 1 }, { id: 2, type: 'dialogue', speaker: '樱井', emotion: 'tender', speed: 'slow', stress: ['来'] }] }) };
    },
  });
  const settings = __testing.configureForTest({
    settings: {
      apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1',
      tts: { enabled: true, deepUnlocked: true, mode: 'deep', side: 'both', analysis: 'deep', narratorVoice: 'voice-narrator', context: { character: false, worldbook: false, recent: false, floors: 0 }, fish: FISH },
      ttsVoices: { 'taro.png': [{ name: '樱井', voiceId: 'voice-zh', voices: { ja: 'voice-ja' } }] },
    },
  });
  context.chat.push(await translatedFloor('桜井は振り返った。\n\n「来たんだね」', [[1, '樱井回过头。'], [2, '「你来了啊」']], settings));
  const source = await __testing.collectTtsFloor(0, settings, 'source');
  const read = await __testing.prepareTtsSegments(source, settings);
  assert.equal(requests.length, 1, 'one reading, of the original the floor closed on');
  assert.deepEqual(JSON.parse(requests[0].messages.at(-1).content).lines, [{ line: 1, text: '桜井は振り返った。' }, { line: 2, text: '⟦2⟧「来たんだね」' }]);
  assert.deepEqual(read.segments.map(item => [item.type, item.speaker, item.lang, item.emotion]), [['narration', 'narrator', 'ja', null], ['dialogue', '樱井', 'ja', 'tender']]);
  assert.deepEqual(read.segments[1].voice, { emotion: 'tender', speed: 'slow', stress: ['来'] });
  const { items } = await __testing.ttsItemsFor(source, read.segments, settings);
  assert.deepEqual(items.map(item => item.voiceId), ['voice-narrator', 'voice-ja'], 'the Japanese voice for the Japanese line');
  const translation = await __testing.collectTtsFloor(0, settings, 'translation');
  const other = await __testing.prepareTtsSegments(translation, settings);
  assert.equal(requests.length, 1, 'the other side follows the reading already made');
  assert.equal(other.segments[1].emotion, 'tender');
  assert.equal(other.segments[1].voice.stress, undefined, 'a stressed word of the original names nothing in the translation');
  assert.deepEqual((await __testing.ttsItemsFor(translation, other.segments, settings)).items.map(item => item.voiceId), ['voice-narrator', 'voice-zh']);
  assert.notEqual(source.floorId, translation.floorId, 'each language keeps its own recordings');
});
test('a sentence clicked alone gets its paragraph, and the paragraph is never made twice', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-stream-sentence');
  const settings = __testing.configureForTest({
    settings: { tts: { enabled: true, mode: 'simple', narratorVoice: 'voice-narrator', fish: FISH } },
  });
  context.chat.push(await translatedFloor('一。二。', [[1, '第一句。第二句。']], settings));
  const calls = mockFish();
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  const { items } = await __testing.ttsItemsFor(floor, segments, settings);
  assert.equal(items.length, 2);
  const first = await __testing.resolveTtsEntry(floor, items, items[1], settings, null, null, { single: true });
  assert.equal(first.record.unit, 'line:1', 'the paragraph is the unit');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.text, '第一句。\n第二句。');
  assert.equal(await __testing.pregenerateTtsFloor(0, { quiet: true }), 0, 'the whole floor is already made');
  assert.equal(calls.length, 1);
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
    settings: { apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1', tts: { enabled: true, deepUnlocked: true, analysis: 'deep', context: { character: false, worldbook: false, recent: false, floors: 0 }, fish: FISH } },
  });
  context.chat.push(await translatedFloor('「暑い！」', [[1, '「好热！」']], settings, { 1: { speaker: '泰罗', emotion: 'happy', intensity: 1 } }));
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  assert.deepEqual([segments[0].speaker, segments[0].emotion], ['泰罗', 'happy']);
  assert.ok(toasts.some(([kind, message]) => kind === 'warning' && /朗读分析失败/.test(message)));
  await __testing.prepareTtsSegments(floor, settings);
  assert.equal(calls, 2);
});

test('the stream records one paragraph per request, and a sentence already recorded is never requested again, whatever the mode', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-stream');
  const settings = __testing.configureForTest({
    settings: {
      tts: { enabled: true, mode: 'stream', analysis: 'annotations', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: { ...FISH, model: 's2.1-pro-free' } },
      ttsVoices: { 'taro.png': [{ name: '泰罗', voiceId: 'voice-taro' }] },
    },
  });
  context.chat.push(await translatedFloor(
    '青い空。\n\n「なんで来た？」\n\n泰羅はカップを置いた。',
    [[1, '蓝蓝的天空上有红红的太阳。'], [2, '「你怎么来了？」'], [3, '泰罗放下了杯子。']],
    settings,
    { 2: { speaker: '泰罗', emotion: '惊讶', intensity: 1 } },
  ));
  const calls = mockFish();
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  const { items } = await __testing.ttsItemsFor(floor, segments, settings);
  assert.deepEqual(items.map(item => item.voiceId), ['voice-narrator', 'voice-taro', 'voice-narrator']);

  // Clicking the second sentence makes its paragraph only.
  const second = await __testing.resolveTtsEntry(floor, items, items[1], settings);
  assert.equal(second.cached, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/proxy/https://api.fish.audio/v1/tts/stream/with-timestamp');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-test');
  assert.equal(calls[0].init.headers.model, 's2.1-pro-free');
  assert.equal(calls[0].init.headers['X-CSRF-Token'], 'host-token');
  assert.equal(calls[0].body.text, '[surprised] 你怎么来了？');
  assert.equal(calls[0].body.reference_id, 'voice-taro');
  assert.equal(second.record.unit, 'line:2');
  assert.equal(second.record.parts[0].blob.type, 'audio/mpeg');

  // The same sentence again: found, not requested.
  const again = await __testing.resolveTtsEntry(floor, items, items[1], settings);
  assert.equal(again.cached, true);
  assert.equal(calls.length, 1);

  // The deep reading finds it too, and the next paragraph is its own request in either reading.
  const deep = __testing.configureForTest({ settings: { tts: { ...settings.tts, mode: 'deep', deepUnlocked: true } } });
  assert.equal(await __testing.findTtsEntry(floor, items[1], deep), null, 'a recording belongs to the mode that made it; another mode reads the words differently');
  assert.equal((await __testing.findTtsEntry(floor, items[1], settings)).record.unit, 'line:2', 'in its own mode the paragraph recording answers for the sentence');
  const consoled = __testing.configureForTest({ settings: { tts: { ...settings.tts, console: { speed: 80 } } } });
  assert.equal(await __testing.findTtsEntry(floor, items[1], consoled), null, 'a changed console retires the recording, so the reader can hear the difference');
  __testing.configureForTest({ settings: { tts: settings.tts } });
  const third = await __testing.resolveTtsEntry(floor, items, items[2], settings);
  assert.equal(third.cached, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.text, '泰罗放下了杯子。');
  assert.equal(calls[1].body.reference_id, 'voice-narrator');
  assert.equal(third.record.unit, 'line:3');
  assert.equal(third.record.timeline.length, 1);
  assert.ok(third.record.timeline.every(entry => entry.coverage === 1));

  // Making the floor ahead of time only makes the paragraph still missing; then nothing is left.
  assert.equal(await __testing.pregenerateTtsFloor(0, { quiet: true }), 1);
  assert.equal(calls.length, 3);
  for (const item of items) assert.ok(await __testing.findTtsEntry(floor, item, settings));
  assert.equal(await __testing.pregenerateTtsFloor(0, { quiet: true }), 0);
  assert.equal(calls.length, 3);
});

test('nobody is silenced for want of a voice: no ids means Fish\'s own default, and Fish failures read plainly', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-errors');
  const settings = __testing.configureForTest({
    settings: { tts: { enabled: true, mode: 'floor', analysis: 'annotations', narratorVoice: '', dialogueVoice: '', fish: FISH }, ttsVoices: {} },
  });
  context.chat.push(await translatedFloor('「暑い！」', [[1, '「好热！」']], settings, { 1: { speaker: '佐菲' } }));
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  const { items, unvoiced } = await __testing.ttsItemsFor(floor, segments, settings);
  assert.deepEqual(unvoiced, ['佐菲']);
  const calls = mockFish();
  const { record } = await __testing.ensureTtsRecording(floor, 'floor:all', items, settings);
  assert.equal(record.timeline.length, 1);
  assert.equal('reference_id' in calls[0].body, false, 'no voice at all: Fish chooses');

  const voiced = __testing.configureForTest({ settings: { tts: { ...settings.tts, dialogueVoice: 'voice-default' } } });
  const voicedItems = (await __testing.ttsItemsFor(floor, segments, voiced)).items;
  mockFish({ status: 402, body: '{"status":402,"message":"Insufficient API credit."}' });
  await assert.rejects(__testing.ensureTtsRecording(floor, 'floor:all', voicedItems, voiced), /余额不足/);
  mockFish({ status: 404, body: 'CORS proxy is disabled. Enable it in config.yaml or use the --corsProxy flag.' });
  await assert.rejects(__testing.ensureTtsRecording(floor, 'floor:all', voicedItems, voiced), /enableCorsProxy/);
});

test('the reader\'s own version of a sentence is recorded as written and preferred until it is taken back', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-override');
  const settings = __testing.configureForTest({
    settings: { tts: { enabled: true, mode: 'floor', analysis: 'annotations', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH } },
  });
  context.chat.push(await translatedFloor('風。\n\n「暑い！」', [[1, '风停了。'], [2, '「好热！」']], settings, { 2: { speaker: '泰罗', emotion: 'happy' } }));
  const calls = mockFish();
  const made = await __testing.saveTtsOverride(0, 2, { text: '[whispering][sad] 好 [long pause] 热……', speed: 0.8, volume: -4 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.text, '[whispering][sad] 好 [long pause] 热……');
  assert.deepEqual(calls[0].body.prosody, { speed: 0.8, volume: -4 });
  assert.equal(made.unit, 'sentence:2');
  assert.equal(made.overrideText, '[whispering][sad] 好 [long pause] 热……');

  const inspected = await __testing.ttsInspect(0, 2);
  assert.equal(inspected.override.text, '[whispering][sad] 好 [long pause] 热……');
  assert.equal(inspected.override.speed, 0.8);
  assert.equal(inspected.text, '[happy] 好热！', 'the automatic version is still shown beside it');
  assert.equal(inspected.recorded, true);

  // The floor read as a whole uses the edited take and only records the rest.
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  const { items } = await __testing.ttsItemsFor(floor, segments, settings);
  assert.equal(items[1].override.text, '[whispering][sad] 好 [long pause] 热……');
  const edited = await __testing.resolveTtsEntry(floor, items, items[1], settings);
  assert.equal(edited.cached, true);
  assert.equal(edited.record.unit, 'sentence:2');
  assert.equal(calls.length, 1);

  await __testing.clearTtsOverride(0, 2);
  const plain = await __testing.ttsInspect(0, 2);
  assert.equal(plain.override, null);
  assert.equal(plain.recorded, false, 'the edited take does not stand in for the plain sentence');
});

test('the latest floor is made in the background, paragraph by paragraph in the stream, and never twice', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-pregen');
  const settings = __testing.configureForTest({
    settings: { tts: { enabled: true, mode: 'stream', analysis: 'annotations', autoGenerate: true, narratorVoice: 'voice-narrator', fish: FISH } },
  });
  context.chat.push(await translatedFloor('一。\n\n二。\n\n三。', [[1, '第一段。'], [2, '第二段。'], [3, '第三段。']], settings));
  const calls = mockFish();
  assert.equal(await __testing.pregenerateTtsFloor(0, { quiet: true }), 3);
  assert.deepEqual(calls.map(call => call.body.text), ['第一段。', '第二段。', '第三段。']);
  assert.equal(await __testing.pregenerateTtsFloor(0, { quiet: true }), 0);
  assert.equal(calls.length, 3);
  const usage = await __testing.ttsStore().usage();
  assert.equal(usage.entries >= 3, true);
});

test('a voice table can be kept per chat: a new chat borrows the card\'s until it saves its own', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-scope');
  const cardTable = [{ name: '泰罗', voiceId: 'voice-card' }];
  const settings = __testing.configureForTest({
    settings: { tts: { enabled: true, analysis: 'annotations', voiceScope: 'chat', fish: FISH }, ttsVoices: { 'taro.png': cardTable } },
  });
  context.chat.push(await translatedFloor('「暑い！」', [[1, '「好热！」']], settings, { 1: { speaker: '泰罗' } }));
  assert.equal(__testing.ttsVoicesKey(settings), 'taro.png|chat|tts-scope');
  assert.deepEqual(__testing.ttsVoicesFor(settings).map(row => row.voiceId), ['voice-card'], 'borrowed from the card');
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  assert.equal((await __testing.ttsItemsFor(floor, segments, settings)).items[0].voiceId, 'voice-card');

  const own = __testing.configureForTest({ settings: { ttsVoices: { 'taro.png': cardTable, 'taro.png|chat|tts-scope': [{ name: '泰罗', voiceId: 'voice-chat' }] } } });
  assert.equal((await __testing.ttsItemsFor(floor, segments, own)).items[0].voiceId, 'voice-chat', 'the chat\'s own table wins');
  const emptied = __testing.configureForTest({ settings: { ttsVoices: { 'taro.png': cardTable, 'taro.png|chat|tts-scope': [] } } });
  assert.deepEqual(__testing.ttsVoicesFor(emptied), [], 'an emptied chat table does not fall back to the card');
  const card = __testing.configureForTest({ settings: { tts: { ...own.tts, voiceScope: 'character' } } });
  assert.equal(__testing.ttsVoicesKey(card), 'taro.png');
  assert.equal((await __testing.ttsItemsFor(floor, segments, card)).items[0].voiceId, 'voice-card');
});

test('the cast is read out of the card and the worldbook by the model, and never guessed without it', async t => {
  restoreGlobals(t);
  const requests = [];
  mockHost('tts-cast', {
    async processRequest(payload) {
      requests.push(payload);
      return { content: JSON.stringify({ characters: [{ name: '樱井', aliases: ['桜井'], lang: 'ja' }, { name: '泰罗', lang: 'en-gb' }, { name: '玩家' }, { name: '' }] }) };
    },
  });
  const lore = {
    globalLore: [
      { world: 'w', uid: 1, comment: '樱井', key: ['桜井', '樱井'], content: '{{char}} 的同学，安静。' },
      { world: 'w', uid: 2, comment: '体型指导条目', key: ['体型'], content: '描写身体时……' },
      { world: 'w', uid: 3, comment: '', key: ['老胡'], content: '小卖部老板。' },
    ],
    characterLore: [], chatLore: [], personaLore: [],
  };
  const settings = __testing.configureForTest({ settings: { apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1', tts: { analysisChannelId: 'c1' } }, worldInfoEntries: lore });
  const result = await __testing.importCastFromWorldbook(settings);
  assert.equal(result.source, 'model');
  assert.deepEqual(result.cast, [{ name: '樱井', aliases: ['桜井'], lang: 'ja', seen: false }, { name: '泰罗', aliases: [], lang: 'en-GB', seen: false }], 'the user is left out, blanks dropped, accents kept');
  const input = JSON.parse(requests[0].messages.at(-1).content);
  assert.equal(input.task, 'list_characters_from_worldbook');
  assert.deepEqual(input.entries.map(entry => entry.title), ['角色卡：泰罗', '樱井', '体型指导条目', ''], 'the card goes first');
  assert.match(input.entries[0].content, /怕热，嘴硬/);
  assert.match(requests[0].messages[0].content, /「XX 指导」[^。]*的条目通常不是人物/);

  // Without a model there is no list at all: titles are not names.
  mockHost('tts-cast-offline', { async processRequest() { throw new Error('relay down'); } });
  const offline = __testing.configureForTest({ settings: { apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1', tts: { analysisChannelId: 'c1' } }, worldInfoEntries: lore });
  await assert.rejects(__testing.importCastFromWorldbook(offline), /识别角色需要副模型/);

  // Nothing readable at all is its own message.
  const { context } = mockHost('tts-cast-empty');
  context.characters = [];
  const bare = __testing.configureForTest({ settings: { apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1' }, worldInfoEntries: { globalLore: [], characterLore: [], chatLore: [], personaLore: [] } });
  await assert.rejects(__testing.importCastFromWorldbook(bare), /没有可读的世界书条目/);
});

test('the cast the model names is checked: nobody the lore never wrote, no crowds, not the reader, one row per person, the card\'s own book first', async t => {
  restoreGlobals(t);
  const requests = [];
  const { context } = mockHost('tts-cast-checked', {
    async processRequest(payload) {
      requests.push(payload);
      return { content: JSON.stringify({ characters: [
        { name: '艾莉丝', aliases: ['Alice', '爱丽丝大人'] },
        // The same person again under her other spelling: one row, not two.
        { name: 'Alice', aliases: ['艾莉丝'] },
        // A name the lore never wrote: the model's own invention.
        { name: '赛巴斯蒂安', aliases: [] },
        { name: '村民们' },
        { name: '「旁白」' },
        { name: '冒险者公会是一个组织，里面有很多人' },
        { name: '主人' },
        { name: '格雷', aliases: ['Grey'] },
        { name: '玛莎' },
      ] }) };
    },
  });
  context.name1 = '主人';
  context.chat.push({ mes: '<story_scene>艾莉丝推开门：「欢迎回来！」</story_scene>', is_user: false, swipe_id: 0, extra: {} });
  const lore = {
    globalLore: Array.from({ length: 260 }, (_, index) => ({ world: 'big', uid: index, comment: `地名${index}`, key: [`地名${index}`], content: '一个小镇。'.repeat(40) })),
    characterLore: [
      { world: 'own', uid: 1, comment: '艾莉丝', key: ['艾莉丝', 'Alice'], content: '女仆长，叫主人「主人」。' },
      { world: 'own', uid: 2, comment: '格雷', key: ['格雷'], content: '管家，英国人。' },
      // Switched off by the reader: whoever is in it is not in this story.
      { world: 'own', uid: 3, comment: '玛莎', key: ['玛莎'], content: '旧版设定里的厨娘。', disable: true },
    ],
    chatLore: [], personaLore: [],
  };
  const settings = __testing.configureForTest({ settings: { apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1', tts: { analysisChannelId: 'c1' } }, worldInfoEntries: lore });
  const { cast, dropped } = await __testing.importCastFromWorldbook(settings);
  const input = JSON.parse(requests[0].messages.at(-1).content);
  assert.deepEqual(input.entries.slice(1, 3).map(entry => entry.title), ['艾莉丝', '格雷'], 'the card\'s own book goes before a global book of 260 entries, which used to push it out');
  assert.ok(!input.entries.some(entry => entry.title === '玛莎'), 'an entry switched off is not sent');
  assert.match(input.story, /艾莉丝推开门/, 'the story rides along, so names come back spelled the way it spells them');
  assert.match(requests[0].messages[0].content, /不要翻译名字/);
  assert.deepEqual(cast, [
    { name: '艾莉丝', aliases: ['Alice'], lang: '', seen: true },
    { name: '格雷', aliases: [], lang: '', seen: false },
  ], 'one row for one person, only spellings someone wrote, and whether the story has met them yet');
  const reasons = Object.fromEntries(dropped.map(item => [item.name, item.reason]));
  assert.match(reasons['赛巴斯蒂安'], /找不到这个名字/);
  assert.match(reasons['村民们'], /群体/);
  assert.match(reasons['旁白'], /群体|占位|称呼/);
  assert.match(reasons['冒险者公会是一个组织，里面有很多人'], /一句话|太长/);
  assert.match(reasons['主人'], /你自己/);
  assert.match(reasons['玛莎'], /找不到/, 'a person only in a switched-off entry is not in this story');
});

test('a long floor is one request: the whole floor at once, and never read twice', async t => {
  restoreGlobals(t);
  const requests = [];
  const { context } = mockHost('tts-batches', {
    async processRequest(payload) {
      requests.push(payload);
      const input = JSON.parse(payload.messages.at(-1).content);
      const ids = input.lines.flatMap(line => [...String(line.text).matchAll(/⟦(\d+)⟧/g)].map(match => Number(match[1])));
      return { content: JSON.stringify({ voices: ids.map(id => ({ id, type: 'dialogue', speaker: '泰罗', emotion: 'tired' })) }) };
    },
  });
  const wide = normalizeChannel({ id: 'c1', name: 'wide', url: 'https://relay.example/v1', key: 'k', model: 'labeler', concurrency: 3 });
  const settings = __testing.configureForTest({
    settings: { apiMode: 'independent', channels: [wide], selectedChannelId: 'c1', tts: { enabled: true, deepUnlocked: true, mode: 'deep', analysis: 'deep', context: { character: false, worldbook: false, recent: false, floors: 0 }, fish: FISH } },
  });
  const lines = Array.from({ length: 36 }, (_, index) => `「第${index + 1}句。」`);
  context.chat.push(await translatedFloor(lines.map((_, index) => `「${index + 1}」`).join('\n\n'), lines.map((text, index) => [index + 1, text]), settings));
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  assert.equal(requests.length, 1, '36 sentences, one request: the floor is read whole or not at all');
  const input = JSON.parse(requests[0].messages.at(-1).content);
  assert.equal(input.lines.length, 36, 'every paragraph of the floor is in it');
  assert.equal(segments.length, 36);
  assert.ok(segments.every(item => item.speaker === '泰罗' && item.emotion === 'tired'), 'the whole floor came back labelled');
  // Preparing the floor again asks nothing.
  await __testing.prepareTtsSegments(floor, runtime());
  assert.equal(requests.length, 1);
});
test('an old setting that left the reading on the translation\'s connection still reads there; the deep reading may have one of its own', async t => {
  restoreGlobals(t);
  const requests = [];
  const { context } = mockHost('tts-channel', {
    async processRequest(payload) {
      requests.push(payload);
      return { content: JSON.stringify({ voices: [{ id: 1, type: 'dialogue', speaker: '泰罗' }] }) };
    },
  });
  const cheap = normalizeChannel({ id: 'c2', name: 'cheap', url: 'https://cheap.example/v1', key: 'k2', model: 'flash' });
  const settings = __testing.configureForTest({
    settings: { apiMode: 'independent', channels: [CHANNEL, cheap], selectedChannelId: 'c1', tts: { enabled: true, mode: 'simple', deepChannelId: 'c2', fish: FISH } },
  });
  context.chat.push(await translatedFloor('「暑い」', [[1, '「好热」']], settings));
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  assert.equal(segments[0].speaker, '泰罗');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, 'labeler', 'the translation\'s model, whatever the deep reading was given');
  assert.match(requests[0].reverse_proxy, /relay\.example/);
  assert.equal(__testing.ttsRequestSettings(settings), settings, 'the simple reading follows the translation');
  const deep = __testing.ttsRequestSettings(settings, 'deep');
  assert.equal(deep.selectedChannelId, 'c2');
  assert.equal(deep.apiMode, 'independent');
  const gone = { ...settings, tts: { ...settings.tts, deepChannelId: 'nowhere' } };
  assert.equal(__testing.ttsRequestSettings(gone, 'deep'), gone, 'a connection that no longer exists means following the translation');
  const { normalizeTts } = await import('../core.js');
  assert.equal(normalizeTts({ channelId: 'c2' }).deepChannelId, 'c2', 'the connection chosen for analysis before is the deep reading\'s now');
});

test('the connection page is a shelf: the translation and the reading each keep their own connection, and neither follows the other', () => {
  const cheap = normalizeChannel({ id: 'c2', name: 'cheap', url: 'https://cheap.example/v1', key: 'k2', model: 'flash' });
  // An old setting: the reading followed the translation, which used c1. It is pinned to c1 when read.
  const settings = mergeSettings({ apiMode: 'independent', channels: [CHANNEL, cheap], selectedChannelId: 'c1', tts: { enabled: true, analysisChannelId: '' } });
  assert.equal(settings.tts.analysisChannelId, 'c1', 'pinned to what the translation used on the day it was read');
  assert.equal(mergeSettings({ apiMode: 'follow', tts: {} }).tts.analysisChannelId, 'follow', 'a translation on the host connection pins the reading there');
  assert.equal(mergeSettings({ apiMode: 'follow', channels: [CHANNEL], tts: { analysisChannelId: 'gone' } }).tts.analysisChannelId, 'follow', 'a deleted connection is replaced the same way');
  assert.equal(mergeSettings({ apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1', tts: { analysisChannelId: 'follow' } }).tts.analysisChannelId, 'follow', 'a choice made is kept');
  assert.equal(mergeSettings({ channels: [CHANNEL], tts: { deepChannelId: 'gone' } }).tts.deepChannelId, '', 'a deep connection that is gone is the reading one again');
  // The translation moves to c2: the reading does not move with it.
  const moved = __testing.applyTranslationChoice(mergeSettings(settings), 'c2');
  assert.equal(moved.apiMode, 'independent');
  assert.equal(moved.selectedChannelId, 'c2');
  const reading = __testing.ttsRequestSettings(moved);
  assert.equal(reading.selectedChannelId, 'c1', 'the reading stays where it was put');
  assert.equal(reading.apiMode, 'independent');
  // The translation goes to the host connection: the reading still does not move.
  const hosted = __testing.applyTranslationChoice(mergeSettings(settings), 'follow');
  assert.equal(hosted.apiMode, 'follow');
  assert.equal(__testing.ttsRequestSettings(hosted).selectedChannelId, 'c1');
  assert.equal(__testing.ttsRequestSettings(hosted).apiMode, 'independent');
  // The host connection, chosen for the reading alone; the deep reading left empty goes with it.
  const onHost = mergeSettings({ ...moved, tts: { ...moved.tts, analysisChannelId: 'follow', deepChannelId: '' } });
  assert.equal(__testing.ttsRequestSettings(onHost).apiMode, 'follow');
  assert.equal(__testing.ttsRequestSettings(onHost, 'deep').apiMode, 'follow');
  const deepOwn = mergeSettings({ ...onHost, tts: { ...onHost.tts, deepChannelId: 'c2' } });
  assert.equal(__testing.ttsRequestSettings(deepOwn, 'deep').selectedChannelId, 'c2');
  assert.equal(__testing.ttsRequestSettings(deepOwn, 'deep').apiMode, 'independent');
  const deepHost = mergeSettings({ ...moved, tts: { ...moved.tts, deepChannelId: 'follow' } });
  assert.equal(__testing.ttsRequestSettings(deepHost, 'deep').apiMode, 'follow');
  // Who uses what, as the connection page lists it and as deleting a connection is checked against.
  assert.deepEqual(__testing.channelUsers(moved).map(user => [user.feature, user.choice]), [['翻译', 'c2'], ['朗读分析', 'c1'], ['深度分析', 'c1']]);
});

test('the stream reads from the translation\'s own labels and asks the sub-model nothing', async t => {
  restoreGlobals(t);
  let requests = 0;
  const { context } = mockHost('tts-annotations-first', {
    async processRequest() {
      requests += 1;
      return { content: JSON.stringify({ labels: [{ id: 1, type: 'dialogue', speaker: '泰罗' }] }) };
    },
  });
  const settings = __testing.configureForTest({
    settings: {
      apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1',
      tts: { enabled: true, mode: 'stream', analysis: 'auto', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH },
      ttsVoices: { 'taro.png': [{ name: '泰罗', voiceId: 'voice-taro' }, { name: '樱井', voiceId: 'voice-sakurai' }] },
    },
  });
  context.chat.push(await translatedFloor(
    '「来たの？」顔を上げた。「座れ」\n\n「……うん」',
    [[1, '「你来了？」抬起头，「坐吧。」'], [2, '「……嗯。」']],
    settings,
    {
      1: { speaker: '泰罗', emotion: 'surprised', quotes: [{ head: '你来了', speaker: '樱井', emotion: 'surprised', intensity: 2, tone: 'in a hurry tone' }, { head: '坐吧', speaker: '泰罗', emotion: 'calm' }] },
      2: { speaker: '樱井', emotion: 'uncertain', tone: 'whispering' },
    },
  ));
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments, depth } = await __testing.prepareTtsSegments(floor, settings);
  assert.equal(requests, 0, 'the translation already said who speaks and how');
  assert.equal(depth, 'annotations');
  assert.deepEqual(segments.map(item => item.speakerSource ?? null), ['hint', null, 'hint', 'hint'], 'the simple reading takes the translation\'s word for who speaks');
  assert.deepEqual(segments.map(item => [item.type, item.speaker, item.emotion]), [
    ['dialogue', '樱井', 'surprised'], ['narration', 'narrator', null], ['dialogue', '泰罗', 'calm'], ['dialogue', '樱井', 'uncertain'],
  ]);
  const { items } = await __testing.ttsItemsFor(floor, segments, settings);
  assert.deepEqual(items.map(item => item.voiceId), ['voice-sakurai', 'voice-narrator', 'voice-taro', 'voice-sakurai']);
  const first = await __testing.ttsInspect(0, segments[0].id);
  assert.equal(first.text, '[surprised][in a hurry tone] 你来了？');
  assert.equal(first.depth, 'annotations');
  assert.ok(first.summary.some(([term, value]) => term === '语气' && value === '急促'));
  const last = await __testing.ttsInspect(0, segments[3].id);
  assert.equal(last.text, '[uncertain][whispering] ……嗯。');
  // Asking twice changes nothing; a floor the translation never labelled still gets the light reading, once.
  await __testing.prepareTtsSegments(floor, settings);
  assert.equal(requests, 0);
  context.chat.push(await translatedFloor('「もう帰る」', [[1, '「我先回去了。」']], settings));
  const bare = await __testing.collectTtsFloor(1, settings);
  const read = await __testing.prepareTtsSegments(bare, settings);
  assert.equal(requests, 1);
  assert.equal(read.depth, 'simple');
  assert.equal(read.segments[0].speaker, '泰罗');
});

test('one sentence clicked on an unrecorded floor gets its paragraph now, not the whole floor first', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-single-line');
  const settings = __testing.configureForTest({
    settings: { tts: { enabled: true, mode: 'floor', analysis: 'annotations', narratorVoice: 'voice-narrator', fish: FISH } },
  });
  context.chat.push(await translatedFloor('一。\n\n二。\n\n三。', [[1, '第一段。'], [2, '第二段。'], [3, '第三段。']], settings));
  const calls = mockFish();
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  const { items } = await __testing.ttsItemsFor(floor, segments, settings);
  const clicked = await __testing.resolveTtsEntry(floor, items, items[1], settings, null, null, { single: true });
  assert.equal(clicked.record.unit, 'line:2');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.text, '第二段。');
  // Once made, the sentence is found whatever asks for it; playing the floor makes the other paragraphs each on their own.
  assert.ok(await __testing.findTtsEntry(floor, items[1], settings));
  const whole = await __testing.resolveTtsEntry(floor, items, items[0], settings);
  assert.equal(whole.record.unit, 'line:1');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.text, '第一段。');
});

test('the parts of one recording go to Fish side by side and are stored in order', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-parallel');
  const settings = __testing.configureForTest({
    settings: { tts: { enabled: true, mode: 'floor', analysis: 'annotations', narratorVoice: 'voice-narrator', fish: { ...FISH, maxChars: 200, concurrency: 3 } } },
  });
  const lines = ['甲', '乙', '丙'].map(mark => `${mark.repeat(120)}。`);
  context.chat.push(await translatedFloor('一。\n\n二。\n\n三。', lines.map((text, index) => [index + 1, text]), settings));
  const calls = mockFish();
  // The first part answers last, and the number in flight at once is watched.
  const answer = globalThis.fetch;
  let inFlight = 0;
  let peak = 0;
  let started = 0;
  globalThis.fetch = async (...args) => {
    const order = started++;
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      const response = await answer(...args);
      if (order === 0) await new Promise(resolve => setTimeout(resolve, 30));
      return response;
    } finally {
      inFlight -= 1;
    }
  };
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  const { items } = await __testing.ttsItemsFor(floor, segments, settings);
  const { record } = await __testing.ensureTtsRecording(floor, 'floor:all', items, settings);
  assert.equal(calls.length, 3);
  assert.equal(peak, 3, 'three parts, three at once');
  assert.equal(record.parts.length, 3);
  assert.deepEqual(record.timeline.map(entry => [entry.id, entry.part]), [[1, 0], [2, 1], [3, 2]]);
  assert.deepEqual(calls.map(call => call.body.text[0]), ['甲', '乙', '丙']);
});


test('the analysis is read as it streams: the paragraphs already labelled start playing while the rest arrives', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-progressive', {
    async processRequest() { throw new Error('a streaming connection must not fall back to one shot'); },
  });
  const settings = __testing.configureForTest({
    settings: { apiMode: 'independent', streamingWriteback: true, channels: [CHANNEL], selectedChannelId: 'c1', tts: { enabled: true, mode: 'simple', narratorVoice: 'v-n', dialogueVoice: 'v-d', fish: FISH } },
  });
  const lines = Array.from({ length: 6 }, (_, index) => `「第${index + 1}句哦。」`);
  context.chat.push(await translatedFloor(lines.map((_, index) => `「${index + 1}哦」`).join('\n\n'), lines.map((text, index) => [index + 1, text]), settings));
  const fish = mockFish();
  const toFish = globalThis.fetch;
  let release = null;
  const held = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes('chat-completions/generate')) return toFish(url, init);
    const body = new ReadableStream({
      async start(controller) {
        const send = text => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
        // One frame carrying the first three paragraphs: what a model actually sends is not cut
        // on object boundaries, and the reading takes whatever is whole so far.
        send(`{"voices":[${[1, 2, 3].map(id => `{"id":${id},"speaker":"泰罗","emotion":"tired"}`).join(',')},`);
        await held;
        for (const id of [4, 5, 6]) send(`{"id":${id},"speaker":"泰罗","emotion":"tired"}${id === 6 ? ']}' : ','}`);
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return { ok: true, status: 200, body, text: async () => '' };
  };
  const transport = await __testing.createTtsTransport(0);
  assert.equal(transport.prepared, false, 'the rest of the floor is still on its way');
  assert.equal(transport.items.length, 3, 'the paragraphs whose dialogue is labelled are enough to start on');
  assert.ok(transport.items.every(item => item.segment.speaker === '泰罗'));
  release();
  await transport.preparing;
  assert.equal(transport.prepared, true);
  assert.equal(transport.items.length, 6);
  assert.ok(transport.items.every(item => item.segment.emotion === 'tired'), 'the rest carried its own labels');
  assert.equal(transport.batches[0].ids.size, 3, 'what arrived first is a recording of its own');
  assert.equal(transport.batches.reduce((sum, batch) => sum + batch.ids.size, 0), 6, 'and the rest joins the list as it arrives');
});
test('a look at the floor asks nothing; the reading asks once and the look then shows it', async t => {
  restoreGlobals(t);
  const requests = [];
  const { context } = mockHost('tts-passive', {
    async processRequest(payload) {
      requests.push(payload);
      return { content: JSON.stringify({ voices: [{ id: 1, type: 'narration' }, { id: 2, type: 'dialogue', speaker: '泰罗', emotion: 'angry', intensity: 2, direction: '压着火，装冷淡' }] }) };
    },
  });
  const settings = __testing.configureForTest({
    settings: { apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1', tts: { enabled: true, deepUnlocked: true, mode: 'deep', context: { character: false, worldbook: false, recent: false, floors: 0 }, fish: FISH } },
  });
  context.chat.push(await translatedFloor('空は青い。泰羅は言った：「暑いな、まだ九月か」', [[1, '蓝蓝的天空，泰罗说：「热死了，才九月啊」']], settings));
  const floor = await __testing.collectTtsFloor(0, settings);
  // The sentence list, the inspector and the overrides all look through this path.
  const looked = await __testing.prepareTtsSegments(floor, settings, { passive: true });
  assert.equal(requests.length, 0, 'looking asks nothing');
  assert.equal(looked.passive, true);
  assert.equal(looked.depth, 'pending', 'no skeleton and no analysis yet');
  assert.equal(looked.segments.length, 2, 'the split itself is local');
  const inspected = await __testing.ttsInspect(0, 2);
  assert.equal(requests.length, 0, 'the inspector asks nothing either');
  assert.equal(inspected.depth, 'pending');
  // The reading asks once, and without a skeleton the deep reading still goes out as itself.
  const read = await __testing.prepareTtsSegments(floor, settings);
  assert.equal(requests.length, 1);
  assert.equal(read.depth, 'deep');
  assert.equal(JSON.parse(requests[0].messages.at(-1).content).task, 'direct_voices_for_audiobook');
  // The next look shows the reading without asking again.
  const again = await __testing.ttsInspect(0, 2);
  assert.equal(requests.length, 1);
  assert.equal(again.depth, 'deep');
  assert.equal(again.voice?.direction, '压着火，装冷淡');
});

test('a floor plans one pair of buttons per paragraph, in reading order', () => {
  const segments = [
    { id: 1, lineId: 1, type: 'narration', text: '傍晚的教室里，一个人也没有。' },
    { id: 2, lineId: 2, type: 'narration', text: '樱井回过头，' },
    { id: 3, lineId: 2, type: 'dialogue', text: '你来了啊' },
    { id: 4, lineId: 2, type: 'narration', text: '轻轻笑了一下。' },
    { id: 5, lineId: 5, type: 'dialogue', text: '明天，也能在这里见面吗？' },
  ];
  const plan = __testing.planTtsLineButtons(segments);
  assert.deepEqual(plan.map(line => line.lineId), [1, 2, 5], 'one entry per paragraph, paragraphs in the order they are read');
  assert.deepEqual(plan.map(line => line.ids), [[1], [2, 3, 4], [5]], 'every sentence of the paragraph, so the buttons can hang off the last located one');
  assert.deepEqual(__testing.planTtsLineButtons([]), []);
  assert.deepEqual(__testing.planTtsLineButtons(null), [], 'nothing readable is no buttons, not a throw');
  // Only what will be read is planned: with dialogue alone, a paragraph's narration is not in the list.
  const dialogue = segments.filter(segment => segment.type === 'dialogue');
  assert.deepEqual(__testing.planTtsLineButtons(dialogue).map(line => line.ids), [[3], [5]]);
  // The plan is pure: the same segments twice give the same answer.
  assert.deepEqual(__testing.planTtsLineButtons(segments), plan);
});

test('the floor button modes: paragraphs by default, the older names carried over', () => {
  assert.equal(__testing.floorButtonMode({ floorButtons: 'line' }), 'line');
  assert.equal(__testing.floorButtonMode({ floorButtons: 'sentence' }), 'sentence');
  assert.equal(__testing.floorButtonMode({ floorButtons: 'off' }), 'off');
  assert.equal(__testing.floorButtonMode({}), 'line', 'no setting reads as paragraphs');
  assert.equal(__testing.floorButtonMode({ floorButtons: 'auto' }), 'line', 'the old device-dependent mode is paragraphs now');
  assert.equal(__testing.floorButtonMode({ floorButtons: 'on' }), 'sentence', 'the old always-on mode kept its sentences');
  assert.equal(__testing.floorButtonsOn({ floorButtons: 'off' }), false);
  assert.equal(__testing.floorButtonsOn({ floorButtons: 'line' }), true);
  // Stored settings are remapped once, at normalisation, so nobody silently loses their choice.
  assert.equal(mergeSettings({ floorButtons: 'auto' }).floorButtons, 'line');
  assert.equal(mergeSettings({ floorButtons: 'on' }).floorButtons, 'sentence');
  assert.equal(mergeSettings({ floorButtons: 'off' }).floorButtons, 'off');
  assert.equal(mergeSettings({ floorButtons: 'nonsense' }).floorButtons, 'line');
  assert.equal(mergeSettings({}).floorButtons, 'line');
});

test('a Fish request that failed on the way out is asked again; a refusal is answered once', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-retry');
  const settings = __testing.configureForTest({
    settings: { tts: { enabled: true, mode: 'off', narratorVoice: 'voice-narrator', fish: { ...FISH, retries: 2 } } },
  });
  context.chat.push(await translatedFloor('空は青い。', [[1, '天空很蓝。']], settings));
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  const { items } = await __testing.ttsItemsFor(floor, segments, settings);

  // Two server errors, then the audio: one paragraph, three calls, no error surfaced.
  const calls = [];
  let attempt = 0;
  const good = mockFish();
  const speaking = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push(url);
    attempt += 1;
    if (attempt <= 2) return new Response('upstream exploded', { status: 502 });
    return speaking(url, init);
  };
  const entry = await __testing.resolveTtsEntry(floor, items, items[0], settings);
  assert.equal(calls.length, 3, 'two failures and the take that worked');
  assert.equal(entry.cached, false);
  assert.ok(good.length >= 1, 'the last attempt went through the speaking mock');

  // A refusal is not worth repeating: 402 comes back once, as an error the reader can act on.
  const refusals = [];
  globalThis.fetch = async url => {
    refusals.push(url);
    return new Response(JSON.stringify({ status: 402, message: 'Insufficient API credit.' }), { status: 402 });
  };
  const second = __testing.configureForTest({ settings: { tts: { ...settings.tts, fish: { ...settings.tts.fish, retries: 3 } } } });
  context.chat.push(await translatedFloor('雨が降る。', [[1, '下雨了。']], second));
  const other = await __testing.collectTtsFloor(1, second);
  const prepared = await __testing.prepareTtsSegments(other, second);
  const made = await __testing.ttsItemsFor(other, prepared.segments, second);
  await assert.rejects(__testing.resolveTtsEntry(other, made.items, made.items[0], second), /余额不足/);
  assert.equal(refusals.length, 1, 'a wallet that is empty stays empty, however many times it is asked');
});

test('a re-made paragraph is heard, not replayed: the urls of the take it replaces are let go', t => {
  restoreGlobals(t);
  const made = [];
  const revoked = [];
  globalThis.URL.createObjectURL = blob => {
    const url = `blob:take-${made.length}`;
    made.push({ url, blob });
    return url;
  };
  globalThis.URL.revokeObjectURL = url => revoked.push(url);
  // The same content-addressed key twice: without the purge the second take plays the first one's url.
  const first = __testing.ttsObjectUrl('rec-1#0', { size: 1 });
  assert.equal(__testing.ttsObjectUrl('rec-1#0', { size: 2 }), first, 'the cache answers for a key it already has');
  __testing.dropTtsObjectUrls('rec-1');
  assert.deepEqual(revoked, [first], 'the url of the take being replaced is released');
  const second = __testing.ttsObjectUrl('rec-1#0', { size: 2 });
  assert.notEqual(second, first, 'the take that replaces it gets a url of its own');
  // Another recording's urls are left alone.
  const other = __testing.ttsObjectUrl('rec-2#0', { size: 3 });
  __testing.dropTtsObjectUrls('rec-1');
  assert.equal(__testing.ttsObjectUrl('rec-2#0', { size: 9 }), other, 'only the recording named is dropped');
});

test('the public interface reads text another extension hands over, in that character\'s voice', async t => {
  restoreGlobals(t);
  let subModelCalls = 0;
  mockHost('tts-api', { async processRequest() { subModelCalls += 1; return { content: '{"voices":[]}' }; } });
  const settings = __testing.configureForTest({
    initialized: true,
    settings: {
      apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1',
      tts: { enabled: true, mode: 'simple', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', range: 'dialogue', fish: FISH },
      ttsVoices: { 'taro.png': [{ name: '樱井', aliases: ['桜井'], voiceId: 'voice-sakurai' }] },
    },
  });
  t.after(() => __testing.configureForTest({ initialized: false }));

  // The text becomes a floor of its own: one paragraph per line, nothing touching the chat.
  const floor = await __testing.apiFloor('  今天也来了啊。\n\n等你很久了。  ', { speaker: '樱井' });
  assert.deepEqual(floor.lines, [{ lineId: 1, text: '今天也来了啊。' }, { lineId: 2, text: '等你很久了。' }]);
  assert.match(floor.floorId, /^jy-api\|/);
  assert.equal(floor.source, 'api');
  await assert.rejects(__testing.apiFloor('   '), /没有可朗读的文字/);
  await assert.rejects(__testing.apiFloor('字'.repeat(20001)), /20000/);
  // Markup a caller pasted is stripped before anything is billed for reading it aloud.
  assert.deepEqual((await __testing.apiFloor('<p>你好<br>世界</p>')).lines.map(line => line.text), ['你好', '世界']);

  const calls = mockFish();
  const session = await __testing.apiSpeak({ text: '今天也来了啊。\n等你很久了。', speaker: '樱井', play: false });
  await session.done;
  assert.equal(session.total, 2, 'one item per paragraph');
  assert.equal(subModelCalls, 0, 'no analysis unless it was asked for');
  assert.equal(calls.length, 2, 'one Fish request per paragraph');
  assert.deepEqual(calls.map(call => call.body.reference_id), ['voice-sakurai', 'voice-sakurai'], 'the voice the reader registered for that name');
  assert.deepEqual(calls.map(call => call.body.text), ['今天也来了啊。', '等你很久了。'], 'the words go out as given');
  assert.equal(session.playing, false);

  // The audio it made comes back as one file, and saves in one line.
  const blob = await session.blob();
  assert.ok(blob.size > 0, 'both paragraphs in one file');
  assert.equal(blob.type, 'audio/mpeg');
  const saves = [];
  globalThis.URL.createObjectURL = () => 'blob:saved';
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.document = {
    body: { appendChild() {} },
    createElement: () => ({ set download(name) { saves.push(name); }, click() {}, remove() {}, style: {} }),
  };
  const saved = await session.download();
  assert.match(saves[0], /^镜译-朗读-樱井-.*\.mp3$/, 'a name a user can find again');
  assert.equal(saved.bytes, blob.size);
  await session.download('打招呼');
  assert.equal(saves[1], '打招呼.mp3', 'a name without an extension gets the right one');
  await session.download('打招呼.mp3');
  assert.equal(saves[2], '打招呼.mp3', 'a name that has one keeps it');
  delete globalThis.document;

  // Said twice, asked for once.
  const again = await __testing.apiSpeak({ text: '今天也来了啊。\n等你很久了。', speaker: '樱井', play: false });
  await again.done;
  assert.equal(calls.length, 2, 'the second reading is the cached one');
  assert.equal(again.cached, true);

  // The reader's 朗读范围 belongs to their chat: a caller's text is read whole even in dialogue-only.
  assert.equal(settings.tts.range, 'dialogue');

  // No speaker named: the narrator's voice.
  const narrated = await __testing.apiSpeak({ text: '从前有一座山。', play: false });
  await narrated.done;
  assert.equal(calls.at(-1).body.reference_id, 'voice-narrator');

  // Asking for the analysis costs exactly one sub-model call.
  await (await __testing.apiSpeak({ text: '「你来了啊。」', speaker: '樱井', analyze: true, play: false })).done;
  assert.equal(subModelCalls, 1);

  // Switched off, the door says so instead of throwing something a caller cannot show a user.
  __testing.configureForTest({ settings: { tts: { ...settings.tts, enabled: false } } });
  await assert.rejects(__testing.apiSpeak({ text: '你好' }), /没有打开镜译的朗读功能/);
  __testing.configureForTest({ settings: { tts: { ...settings.tts, enabled: true, fish: { ...FISH, key: '' } } } });
  await assert.rejects(__testing.apiSpeak({ text: '你好' }), /还没有在镜译里填 Fish Audio/);
});

test('the public interface announces itself on the page, and says what it can do before it is asked', t => {
  restoreGlobals(t);
  mockHost('tts-api-global');
  __testing.configureForTest({
    settings: {
      tts: { enabled: true, narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH },
      ttsVoices: { 'taro.png': [{ name: '樱井', aliases: ['桜井'], voiceId: 'voice-sakurai' }, { name: '老胡', aliases: [], voiceId: '' }] },
    },
  });
  __testing.installPublicApi();
  const api = globalThis.__JINGYI__;
  assert.ok(api, 'the door exists');
  assert.equal(api.tts.apiVersion, 1);
  assert.equal(typeof api.tts.speak, 'function');
  assert.equal(typeof api.tts.read, 'function');
  const status = api.tts.status();
  assert.equal(status.enabled, true);
  assert.equal(status.hasKey, true);
  assert.equal(status.provider, 'fish');
  const voices = api.tts.voices();
  assert.deepEqual(voices.find(voice => voice.name === '樱井'), { name: '樱井', aliases: ['桜井'], hasOwnVoice: true });
  assert.equal(voices.find(voice => voice.name === '老胡').hasOwnVoice, false, 'a name with no voice of its own still answers');
  assert.equal(Object.isFrozen(api), true, 'a caller cannot rewrite the door');
  delete globalThis.__JINGYI__;
});

test('asking again with an opinion only touches what the opinion is about; a name the reader set is not the model\'s to move', async t => {
  restoreGlobals(t);
  const requests = [];
  const { context } = mockHost('tts-refine', {
    async processRequest(payload) {
      requests.push(payload);
      const input = JSON.parse(payload.messages.at(-1).content);
      if (input.task === 'refine_voices_for_audiobook') {
        // The complaint was about who says it; everything else comes back as a bare id.
        return { content: JSON.stringify({ voices: [{ id: 2, type: 'dialogue', speaker: '泰罗', emotion: 'angry' }, { id: 1 }] }) };
      }
      return { content: JSON.stringify({ voices: [{ id: 1, type: 'narration' }, { id: 2, type: 'dialogue', speaker: '樱井', emotion: 'happy' }] }) };
    },
  });
  const settings = __testing.configureForTest({
    settings: {
      apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1',
      tts: { enabled: true, mode: 'simple', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH },
      ttsVoices: { 'taro.png': [{ name: '樱井', voiceId: 'voice-sakurai' }, { name: '泰罗', voiceId: 'voice-taro' }] },
    },
  });
  context.chat.push(await translatedFloor('泰羅は言った：「またか」', [[1, '泰罗说：「又来了。」']], settings));
  const floor = await __testing.collectTtsFloor(0, settings);
  // First pass: the simple reading is the model's, name and mood alike.
  const first = await __testing.prepareTtsSegments(floor, settings);
  assert.equal(first.segments[1].speaker, '樱井');
  assert.equal(first.segments[1].speakerSource, 'model');
  assert.equal(first.segments[1].emotion, 'happy');
  assert.equal(requests.length, 1);
  const sent = JSON.parse(requests[0].messages.at(-1).content);
  assert.equal('speakers' in sent, false, 'nothing is named for the model: naming is its job here');
  assert.match(requests[0].messages[0].content, /硬性要求/, 'the console\'s rules bind');
  const fish = mockFish();
  const items = (await __testing.ttsItemsFor(floor, first.segments, settings)).items;
  await __testing.resolveTtsEntry(floor, items, items[1], settings);
  assert.equal(fish.length, 1, 'the line has audio, made from the old labels');

  // The reader says it is the wrong speaker: one short request, and only that sentence moves.
  const result = await __testing.refineTtsAnalysis(0, { utteranceId: 2, feedback: '说话人不对，这句是泰罗说的' });
  assert.equal(requests.length, 2);
  const refine = JSON.parse(requests[1].messages.at(-1).content);
  assert.equal(refine.task, 'refine_voices_for_audiobook');
  assert.deepEqual(refine.utterances.map(item => item.id), [2], 'only the sentence in scope is sent');
  assert.deepEqual(refine.current, [{ id: 2, type: 'dialogue', speaker: '樱井', emotion: 'happy', intensity: 1 }], 'last time answer rides along');
  assert.match(refine.feedback, /说话人不对/);
  assert.match(requests[1].messages[0].content, /按用户的意见修正上一次的标注/);
  assert.equal(result.changed, 1);

  // The correction is what the floor reads by now, and the take made from the old labels is gone.
  const after = await __testing.prepareTtsSegments(floor, settings);
  assert.equal(after.segments[1].speaker, '泰罗');
  assert.equal(after.segments[1].speakerSource, 'model');
  assert.equal(after.segments[1].emotion, 'angry');
  assert.equal(after.segments[0].type, 'narration', 'the sentence nobody complained about is untouched');
  assert.equal(requests.length, 2, 'reading the floor again asks nothing: the analysis is cached');
  const fresh = (await __testing.ttsItemsFor(floor, after.segments, settings)).items;
  assert.equal(fresh[1].voiceId, 'voice-taro', 'a new speaker means a new voice, with no re-analysis');
  // The correction remakes what could already be heard, so the new voice is there without a second click.
  const remadeEntry = await __testing.findTtsEntry(floor, fresh[1], settings);
  assert.ok(remadeEntry, 'the paragraph was made again under the new labels');
  assert.equal(fish.length, 2, 'one more Fish request, for the paragraph that changed');
  assert.equal(result.remade, 1);

  // The reader names the speaker by hand: the sentence reads in that voice, and nobody is asked anything.
  await __testing.saveTtsSpeaker(0, 2, '樱井');
  assert.equal(requests.length, 2);
  const named = await __testing.ttsInspect(0, 2);
  assert.equal(named.segment.speaker, '樱井');
  assert.equal(named.speakerSource, 'manual');
  assert.equal(named.manualSpeaker, '樱井');
  assert.equal(named.edited, false, 'the words were not touched');
  assert.equal(named.voiceId, 'voice-sakurai', 'a new name means the voice that name has');
  assert.ok(named.cast.includes('泰罗') && named.cast.includes('樱井'), 'the list to pick from is the cast');
  const renamed = await __testing.ttsPrepared(0);
  const voiced = await __testing.resolveTtsEntry(renamed.floor, renamed.items, renamed.items[1], renamed.settings);
  assert.equal(voiced.cached, false);
  assert.ok([].concat(fish.at(-1).body.reference_id).includes('voice-sakurai'), 'the sentence was made again in the new voice');
  assert.equal(requests.length, 2, 'still no analysis');
  // A refine asked while the name is the reader's tells the model so, and the model's answer cannot move it.
  await __testing.refineTtsAnalysis(0, { utteranceId: 2, feedback: '说话人不对' });
  assert.equal(requests.length, 3);
  const told = JSON.parse(requests[2].messages.at(-1).content);
  assert.deepEqual(told.current, [{ id: 2, type: 'dialogue', speaker: '樱井', manual: true, emotion: 'angry', intensity: 1 }]);
  const held = await __testing.ttsInspect(0, 2);
  assert.equal(held.segment.speaker, '樱井', 'the model answered 泰罗 and was overruled');
  assert.equal(held.speakerSource, 'manual');
  // Handed back: the model's word returns.
  await __testing.saveTtsSpeaker(0, 2, '');
  const back = await __testing.ttsInspect(0, 2);
  assert.equal(back.segment.speaker, '泰罗');
  assert.equal(back.speakerSource, 'model');
  assert.equal(back.manualSpeaker, null);

  // A sentence outside the floor is refused rather than silently doing the whole floor.
  await assert.rejects(__testing.refineTtsAnalysis(0, { utteranceId: 99, feedback: 'x' }), /不在当前的朗读范围/);
});

// ---------------------------------------------------------------------------------------------
// Speakers named on this side; voices looked up when the audio is made.
// ---------------------------------------------------------------------------------------------

test('the plain reading names the speakers itself: several voices in one floor, and the model hears nothing', async t => {
  restoreGlobals(t);
  let requests = 0;
  const { context } = mockHost('tts-local-plain', {
    async processRequest() {
      requests += 1;
      return { content: '{}' };
    },
  });
  const settings = __testing.configureForTest({
    settings: {
      apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1',
      tts: { enabled: true, mode: 'off', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH },
      ttsVoices: { 'taro.png': [{ name: '泰罗', aliases: ['泰羅'], voiceId: 'voice-taro' }, { name: '樱井', aliases: ['桜井'], voiceId: 'voice-sakurai' }] },
    },
  });
  context.chat.push(await translatedFloor(
    '泰羅が入ってきた。「来たの？」\n\n「……うん」桜井は頷いた。\n\n「座れ」\n\n「はい」',
    [[1, '泰罗推门进来。「你来了？」'], [2, '「……嗯。」樱井点了点头。'], [3, '「坐吧。」'], [4, '「好。」']],
    settings,
  ));
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments, depth } = await __testing.prepareTtsSegments(floor, settings);
  assert.equal(requests, 0, 'nothing is asked');
  assert.equal(depth, 'off');
  assert.deepEqual(segments.filter(segment => segment.type === 'dialogue').map(segment => [segment.speaker, segment.speakerSource]), [
    ['泰罗', 'local'], ['樱井', 'local'], ['泰罗', 'local'], ['樱井', 'local'],
  ]);
  assert.match(segments[1].speakerEvidence.join('；'), /引号前「泰罗推门进来/);
  assert.match(segments[4].speakerEvidence.join('；'), /轮流说话/);
  const { items } = await __testing.ttsItemsFor(floor, segments, settings);
  assert.deepEqual(items.map(item => item.voiceId), ['voice-narrator', 'voice-taro', 'voice-sakurai', 'voice-narrator', 'voice-taro', 'voice-sakurai']);
  // The original, read in its own language, is named through the aliases the table knows.
  const source = await __testing.collectTtsFloor(0, settings, 'source');
  const read = await __testing.prepareTtsSegments(source, settings);
  assert.equal(requests, 0);
  assert.deepEqual(read.segments.filter(segment => segment.type === 'dialogue').map(segment => segment.speaker), ['泰罗', '樱井', '泰罗', '樱井']);
  const inspected = await __testing.ttsInspect(0, 2);
  assert.equal(inspected.speakerSource, 'local');
  assert.equal(inspected.manualSpeaker, null);
  assert.deepEqual(inspected.cast.slice(0, 2), ['泰罗', '樱井']);
});

test('the simple analysis is the model\'s, names and moods alike; only the reader\'s own word is set before it', async t => {
  restoreGlobals(t);
  const requests = [];
  const { context } = mockHost('tts-local-simple', {
    async processRequest(payload) {
      requests.push({ system: payload.messages[0].content, input: JSON.parse(payload.messages.at(-1).content) });
      return { content: JSON.stringify({ voices: [
        { id: 1, type: 'narration' },
        { id: 2, type: 'dialogue', speaker: '樱井', emotion: 'angry', intensity: 2, speed: 'fast', pauses: [{ after: '你', length: 'short' }] },
        { id: 3, type: 'dialogue', speaker: '樱井', emotion: 'sad' },
      ] }) };
    },
  });
  const settings = __testing.configureForTest({
    settings: {
      apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1',
      tts: { enabled: true, mode: 'simple', askAnalysis: 'analyze', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH },
      ttsVoices: { 'taro.png': [{ name: '泰罗', voiceId: 'voice-taro' }, { name: '樱井', voiceId: 'voice-sakurai' }] },
    },
  });
  context.chat.push(await translatedFloor('泰羅が入ってきた。「来たの？」\n\n「……うん」', [[1, '泰罗推门进来。「你来了？」'], [2, '「……嗯。」']], settings));
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  assert.equal(requests.length, 1);
  assert.equal('speakers' in requests[0].input, false, 'nobody is named for the model: naming is its job in this reading');
  assert.match(requests[0].system, /硬性要求，不是参考/);
  assert.deepEqual([segments[1].speaker, segments[1].speakerSource, segments[1].emotion, segments[1].intensity], ['樱井', 'model', 'angry', 2], 'the model\'s name and mood are taken, whatever the text beside the quote says');
  assert.equal(segments[1].voice.speed, 'fast');
  assert.deepEqual([segments[2].speaker, segments[2].speakerSource, segments[2].emotion], ['樱井', 'model', 'sad']);
  const { items } = await __testing.ttsItemsFor(floor, segments, settings);
  assert.deepEqual(items.map(item => item.voiceId), ['voice-narrator', 'voice-sakurai', 'voice-sakurai']);
  const inspected = await __testing.ttsInspect(0, 2);
  assert.equal(inspected.text, '[furious] 你 [pause] 来了？', 'the strength and the pause reach the provider in its own words');
  assert.equal(inspected.prosody.speed, 1.12);
  // The reader's word goes out with the request and is kept over the model's answer.
  await __testing.saveTtsSpeaker(0, 2, '泰罗');
  await __testing.reanalyzeTtsFloor(0);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].input.speakers, { 2: '泰罗' }, 'the reader\'s own word goes out with the request');
  const held = await __testing.prepareTtsSegments(floor, settings);
  assert.deepEqual([held.segments[1].speaker, held.segments[1].speakerSource, held.segments[1].emotion], ['泰罗', 'manual', 'angry']);
});

test('a voice id edited in the library is heard on the next play, whole floor or one sentence, with no re-analysis', async t => {
  restoreGlobals(t);
  let requests = 0;
  const { context } = mockHost('tts-voice-follows', {
    async processRequest() {
      requests += 1;
      return { content: JSON.stringify({ voices: [{ id: 1, type: 'narration' }, { id: 2, type: 'dialogue', speaker: '樱井', emotion: 'happy' }] }) };
    },
  });
  const settings = __testing.configureForTest({
    settings: {
      apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1',
      tts: { enabled: true, mode: 'simple', askAnalysis: 'analyze', playAfterGenerate: false, narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH },
      voiceLibrary: [{ id: 'lib-girl', name: '少女', voiceId: 'voice-a' }],
      ttsVoices: { 'taro.png': [{ name: '樱井', voiceId: 'voice-a' }] },
    },
  });
  context.chat.push(await translatedFloor('桜井は言った。「またか」', [[1, '樱井说：「又来了。」']], settings));
  const fish = mockFish();
  const transport = await __testing.createTtsTransport(0, { single: false });
  await __testing.runTtsTransport(transport);
  assert.equal(requests, 1, 'analysed once');
  assert.equal(fish.length, 1);
  assert.ok([].concat(fish[0].body.reference_id).includes('voice-a'), 'read in voice A');
  assert.equal(transport.items[1].voiceId, 'voice-a');

  // The library entry moves to voice B: the row that pointed at it follows.
  __testing.saveSettings({ ...runtime(), voiceLibrary: [{ id: 'lib-girl', name: '少女', voiceId: 'voice-b' }] });
  assert.equal(__testing.ttsVoicesFor().find(row => row.name === '樱井').voiceId, 'voice-b');
  // The take in voice A is not handed to voice B.
  await __testing.syncTtsTransport(transport);
  assert.equal(transport.items[1].voiceId, 'voice-b', 'the transport reads the voice table as it is now');
  assert.equal(await __testing.findTtsEntry(transport.floor, transport.items[1], transport.settings), null, 'voice A\'s audio never stands in for voice B');

  // One sentence made again: the same analysis, a request in voice B, nothing asked of the model.
  await __testing.regenerateTtsSentence(0, 2);
  assert.equal(requests, 1, 'no re-analysis');
  assert.equal(fish.length, 2);
  assert.ok([].concat(fish[1].body.reference_id).includes('voice-b'), 'read in voice B');
  assert.ok(![].concat(fish[1].body.reference_id).includes('voice-a'));

  // A row edited directly is the same story.
  __testing.saveSettings({ ...runtime(), ttsVoices: { 'taro.png': [{ name: '樱井', voiceId: 'voice-c' }] } });
  await __testing.regenerateTtsSentence(0, 2);
  assert.equal(requests, 1);
  assert.equal(fish.length, 3);
  assert.ok([].concat(fish[2].body.reference_id).includes('voice-c'));
});

test('the plain reading can ask for one simple analysis of a floor by hand, and keeps it', async t => {
  restoreGlobals(t);
  let requests = 0;
  const { context } = mockHost('tts-plain-asks', {
    async processRequest() {
      requests += 1;
      return { content: JSON.stringify({ voices: [
        { id: 1, type: 'narration' },
        { id: 2, type: 'dialogue', speaker: '樱井', emotion: 'surprised' },
        { id: 3, type: 'dialogue', speaker: '泰罗', emotion: 'calm', intensity: 0 },
      ] }) };
    },
  });
  const settings = __testing.configureForTest({
    settings: {
      apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1',
      tts: { enabled: true, mode: 'off', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH },
      ttsVoices: { 'taro.png': [{ name: '泰罗', voiceId: 'voice-taro' }, { name: '樱井', voiceId: 'voice-sakurai' }] },
    },
  });
  context.chat.push(await translatedFloor('泰羅が入ってきた。「来たの？」\n\n「座れ」', [[1, '泰罗推门进来。「你来了？」'], [2, '「坐吧。」']], settings));
  const floor = await __testing.collectTtsFloor(0, settings);
  const plain = await __testing.prepareTtsSegments(floor, settings);
  assert.equal(requests, 0);
  assert.equal(plain.depth, 'off');
  assert.deepEqual(plain.segments.slice(1).map(segment => [segment.speaker, segment.speakerSource, segment.emotion]), [['泰罗', 'local', null], ['泰罗', 'local', null]], 'the text names the one person in the floor');

  // Asked by hand: one request, and the floor reads by the model's word from then on, mode unchanged.
  await __testing.reanalyzeTtsFloor(0);
  assert.equal(requests, 1);
  const analysed = await __testing.prepareTtsSegments(floor, settings);
  assert.equal(analysed.depth, 'simple');
  assert.deepEqual(analysed.segments.slice(1).map(segment => [segment.speaker, segment.speakerSource, segment.emotion, segment.intensity]), [['樱井', 'model', 'surprised', 1], ['泰罗', 'model', 'calm', 0]]);
  assert.equal(requests, 1, 'the analysis is kept; looking again asks nothing');
  const inspected = await __testing.ttsInspect(0, 2);
  assert.equal(inspected.depth, 'simple');
  assert.equal(inspected.voiceId, 'voice-sakurai');
  assert.equal(__testing.configureForTest({}).tts.mode, 'off', 'the mode did not move');
  // Another floor in the same chat is still read plain.
  context.chat.push(await translatedFloor('「もう帰る」', [[1, '「我先回去了。」']], settings));
  const other = await __testing.prepareTtsSegments(await __testing.collectTtsFloor(1, settings), settings);
  assert.equal(other.depth, 'off');
  assert.equal(requests, 1);
});

test('regenerating one sentence asks for that sentence alone; the paragraph keeps the rest, and asking twice gives two takes', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-regen-sentence');
  const settings = __testing.configureForTest({
    settings: { tts: { enabled: true, mode: 'off', playAfterGenerate: false, narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH } },
  });
  context.chat.push(await translatedFloor('一。二。三。', [[1, '第一句。第二句。第三句。']], settings));
  const calls = mockFish();
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  const { items } = await __testing.ttsItemsFor(floor, segments, settings);
  assert.equal(items.length, 3);
  // The paragraph is made whole, once.
  const first = await __testing.resolveTtsEntry(floor, items, items[1], settings, null, null, { single: true });
  assert.equal(first.record.unit, 'line:1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.text, '第一句。\n第二句。\n第三句。');
  // One sentence again: a request for that sentence only.
  await __testing.regenerateTtsSentence(0, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.text, '第二句。', 'only the sentence asked for goes out');
  const again = await __testing.findTtsEntry(floor, items[1], settings);
  assert.equal(again.record.unit, 'sentence:2', 'the newer take is what the next play finds');
  const neighbour = await __testing.findTtsEntry(floor, items[0], settings);
  assert.equal(neighbour.record.unit, 'line:1', 'the paragraph still serves the others');
  assert.equal(neighbour.record.key, first.record.key);
  // Asked again: another take, not the cached one.
  await __testing.regenerateTtsSentence(0, 2);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].body.text, '第二句。');
  // The whole paragraph again drops the sentence's own take with it.
  await __testing.regenerateTtsParagraph(0, 1);
  assert.equal(calls.length, 4);
  assert.equal(calls[3].body.text, '第一句。\n第二句。\n第三句。');
  assert.equal((await __testing.findTtsEntry(floor, items[1], settings)).record.unit, 'line:1');
});

// A stand-in for the browser's audio element: loads at once, plays at once, ends on the next tick.
// What was asked to play, and from where, is kept for the assertions.
function mockAudio() {
  const plays = [];
  class FakeAudio {
    constructor() {
      this.listeners = new Map();
      this.readyState = 0;
      this.currentTime = 0;
      this.duration = 3;
      this.preload = '';
      this.value = '';
    }

    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    }

    removeEventListener(type, handler) {
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== handler));
    }

    emit(type) {
      for (const handler of [...(this.listeners.get(type) ?? [])]) handler({ type });
    }

    set src(value) {
      this.value = value;
    }

    get src() {
      return this.value;
    }

    load() {
      this.readyState = 1;
      setTimeout(() => this.emit('loadedmetadata'), 0);
    }

    play() {
      plays.push({ src: this.value, start: Number(this.currentTime.toFixed(2)) });
      setTimeout(() => this.emit('ended'), 5);
      return Promise.resolve();
    }

    pause() {}
  }
  const before = globalThis.Audio;
  globalThis.Audio = FakeAudio;
  __testing.resetTtsPlayer();
  return { plays, restore: () => { globalThis.Audio = before; __testing.resetTtsPlayer(); } };
}

test('a sentence with a take of its own is heard from it inside its paragraph: rewritten by hand, or made again alone', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-own-take');
  const settings = __testing.configureForTest({
    settings: { tts: { enabled: true, mode: 'off', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH } },
  });
  context.chat.push(await translatedFloor('一。二。三。', [[1, '第一句。第二句。第三句。']], settings));
  const calls = mockFish();
  const audio = mockAudio();
  t.after(audio.restore);
  // Each recording gets a url of its own here, so the plays can be told apart by what they were given.
  const createUrl = URL.createObjectURL;
  let urls = 0;
  URL.createObjectURL = () => `blob:take-${urls += 1}`;
  t.after(() => { URL.createObjectURL = createUrl; });
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  const { items } = await __testing.ttsItemsFor(floor, segments, settings);
  const paragraph = await __testing.resolveTtsEntry(floor, items, items[0], settings);
  assert.equal(paragraph.record.unit, 'line:1');
  assert.deepEqual(paragraph.record.timeline.map(entry => [entry.id, entry.start]), [[1, 0], [2, 0.75], [3, 1.5]], 'the mock aligns a character every quarter second');
  // The reader rewrites the third sentence and makes the second again on its own.
  await __testing.saveTtsOverride(0, 3, { text: '第三句……' });
  await __testing.regenerateTtsSentence(0, 2);
  assert.equal(calls.length, 3);
  assert.equal(audio.plays.length, 1, 'the sentence made again is played on its own');
  const from = audio.plays.length;
  // The paragraph played from the top: the first sentence from the paragraph's take, then the
  // second from its own, then the third from the reader's, each a play of its own.
  const transport = await __testing.createTtsTransport(0, { single: false });
  await __testing.runTtsTransport(transport);
  assert.equal(calls.length, 3, 'nothing was made again');
  const stretches = audio.plays.slice(from);
  assert.equal(stretches.length, 3, 'three stretches, not one');
  assert.equal(stretches[0].start, 0, 'the paragraph take, from the first sentence');
  assert.notEqual(stretches[1].src, stretches[0].src, 'the second sentence comes from its own take');
  assert.equal(stretches[1].start, 0);
  assert.notEqual(stretches[2].src, stretches[0].src, 'the third from the reader\'s version');
  assert.equal(stretches[2].start, 0);
  assert.equal(transport.state, 'idle');
  // Without a take of their own, the sentences play through in one stretch.
  await __testing.clearTtsOverride(0, 3);
  await __testing.regenerateTtsParagraph(0, 1);
  assert.equal(calls.length, 4);
  const mark = audio.plays.length;
  const whole = await __testing.createTtsTransport(0, { single: false });
  await __testing.runTtsTransport(whole);
  assert.equal(audio.plays.length - mark, 1, 'one stretch for the whole paragraph');
  assert.equal(audio.plays.at(-1).start, 0);
});

// A stand-in for the browser's audio decoder: a part's bytes become samples, one number per part,
// so a file cut from several parts can be read back as the sequence of takes it was cut from.
function mockAudioContext() {
  class FakeContext {
    async decodeAudioData(buffer) {
      const bytes = new Uint8Array(buffer);
      const value = bytes[0] ?? 0;
      const length = bytes.length * 25;
      return { sampleRate: 100, numberOfChannels: 1, length, duration: length / 100, getChannelData: () => new Float32Array(length).fill(value / 100) };
    }

    close() {}
  }
  const before = globalThis.AudioContext;
  globalThis.AudioContext = FakeContext;
  return { restore: () => { globalThis.AudioContext = before; } };
}

// The takes a wav made by the fake decoder is cut from, in order, each with its length in samples.
function readTakes(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const takes = [];
  for (let at = 44; at + 1 < bytes.length; at += 2) {
    const call = Math.round((view.getInt16(at, true) / 0x7fff) * 100);
    const last = takes.at(-1);
    if (last && last.call === call) last.samples += 1;
    else takes.push({ call, samples: 1 });
  }
  return takes;
}

test('saving a floor in which a sentence has a take of its own cuts and joins the takes in reading order', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-splice-save');
  const settings = __testing.configureForTest({
    settings: { tts: { enabled: true, mode: 'off', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH } },
  });
  context.chat.push(await translatedFloor('一。二。三。', [[1, '第一句。第二句。第三句。']], settings));
  // Each request's audio is its own number, one byte per quarter second.
  const calls = mockFish({ audio: (call, duration) => Buffer.from(new Uint8Array(Math.round(duration * 4)).fill(call)).toString('base64') });
  const audio = mockAudio();
  t.after(audio.restore);
  const decoder = mockAudioContext();
  t.after(decoder.restore);
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  const { items } = await __testing.ttsItemsFor(floor, segments, settings);
  await __testing.resolveTtsEntry(floor, items, items[0], settings);
  await __testing.saveTtsOverride(0, 3, { text: '第三句……' });
  await __testing.regenerateTtsSentence(0, 2);
  assert.equal(calls.length, 3, 'the paragraph, the reader\'s third sentence, the second sentence alone');
  const prepared = await __testing.ttsPrepared(0);
  const entries = [];
  for (const item of prepared.items) entries.push({ item, entry: await __testing.resolveTtsEntry(prepared.floor, prepared.items, item, prepared.settings) });
  assert.equal(calls.length, 3, 'everything is at hand');
  assert.equal(__testing.downloadNeedsSplice(entries), true, 'the paragraph still holds sentences that play from elsewhere');
  const blob = await __testing.ttsSplicedWav(entries);
  assert.equal(blob.type, 'audio/wav');
  const takes = readTakes(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(takes.map(take => take.call), [1, 3, 2], 'the first sentence from the paragraph, the second from its own take, the third from the reader\'s');
  assert.ok(takes.every(take => take.samples >= 70 && take.samples <= 80), `each stretch is one sentence long: ${takes.map(take => take.samples).join(', ')}`);
  // Neighbouring sentences of one take come out as one stretch: nothing between them is lost.
  await __testing.clearTtsOverride(0, 3);
  const partly = await __testing.ttsPrepared(0);
  const mixed = [];
  for (const item of partly.items) mixed.push({ item, entry: await __testing.resolveTtsEntry(partly.floor, partly.items, item, partly.settings) });
  const again = readTakes(new Uint8Array(await (await __testing.ttsSplicedWav(mixed)).arrayBuffer()));
  assert.deepEqual(again.map(take => take.call), [1, 3, 1]);
  assert.ok(again[2].samples >= 70 && again[2].samples <= 80, 'the third sentence, cut from the paragraph again');
  // Whole recordings, untouched, need no cutting.
  await __testing.regenerateTtsParagraph(0, 1);
  const whole = await __testing.ttsPrepared(0);
  const plain = [];
  for (const item of whole.items) plain.push({ item, entry: await __testing.resolveTtsEntry(whole.floor, whole.items, item, whole.settings) });
  assert.equal(__testing.downloadNeedsSplice(plain), false);
});

// ---------------------------------------------------------------------------------------------
// Translated floors read from their marks in every mode; the plain reading asks about the rest;
// a paragraph button reads its paragraph and stops.
// ---------------------------------------------------------------------------------------------

test('a translated floor reads from its marks in the plain reading too: the translation was the analysis', async t => {
  restoreGlobals(t);
  let requests = 0;
  const { context } = mockHost('tts-plain-marks', {
    async processRequest() {
      requests += 1;
      return { content: '{}' };
    },
  });
  const settings = __testing.configureForTest({
    settings: {
      apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1',
      tts: { enabled: true, mode: 'off', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH },
      ttsVoices: { 'taro.png': [{ name: '泰罗', voiceId: 'voice-taro' }, { name: '樱井', voiceId: 'voice-sakurai' }] },
    },
  });
  // The text beside the quotes says 泰罗; the translation's marks say 樱井. The marks decide.
  context.chat.push(await translatedFloor(
    '泰羅が入ってきた。「来たの？」\n\n「……うん」',
    [[1, '泰罗推门进来。「你来了？」'], [2, '「……嗯。」']],
    settings,
    { 1: { speaker: '樱井', emotion: 'surprised', intensity: 2 }, 2: { speaker: '泰罗', emotion: 'tender', tone: 'whispering' } },
  ));
  const floor = await __testing.collectTtsFloor(0, settings);
  const read = await __testing.prepareTtsSegments(floor, settings);
  assert.equal(requests, 0, 'nothing is asked: the translation already answered');
  assert.equal(read.depth, 'annotations');
  assert.deepEqual(read.segments.filter(segment => segment.type === 'dialogue').map(segment => [segment.speaker, segment.speakerSource, segment.emotion]), [['樱井', 'hint', 'surprised'], ['泰罗', 'hint', 'tender']]);
  const { items } = await __testing.ttsItemsFor(floor, read.segments, settings);
  assert.deepEqual(items.map(item => item.voiceId), ['voice-narrator', 'voice-sakurai', 'voice-taro']);
  const inspected = await __testing.ttsInspect(0, 2);
  assert.equal(inspected.depth, 'annotations');
  assert.match(inspected.text, /^\[surprised\]/, 'the mark\'s mood reaches Fish in the plain reading as well');
  // Looking again, or making a transport, still asks nothing: the marks are the analysis.
  const transport = await __testing.createTtsTransport(0, { single: true, fromUtterance: 2 });
  assert.equal(requests, 0);
  assert.equal(transport.items[1].segment.speaker, '樱井');
});

test('in the plain reading an untranslated floor asks what to do: analysed once, or read as the text says', async t => {
  restoreGlobals(t);
  let requests = 0;
  const { context } = mockHost('tts-plain-choice', {
    async processRequest() {
      requests += 1;
      return { content: JSON.stringify({ voices: [{ id: 1, type: 'narration' }, { id: 2, type: 'dialogue', speaker: '樱井', emotion: 'happy' }] }) };
    },
  });
  const base = {
    apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1',
    tts: { enabled: true, mode: 'off', askAnalysis: 'analyze', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH },
    ttsVoices: { 'taro.png': [{ name: '泰罗', voiceId: 'voice-taro' }, { name: '樱井', voiceId: 'voice-sakurai' }] },
  };
  const settings = __testing.configureForTest({ settings: base });
  context.chat.push(await translatedFloor('泰羅は言った。「今度こそ最後だ」', [[1, '泰罗说：「这次真的是最后一次了。」']], settings));
  // Set to analyse: the reading asks the model once for this floor, and the mode stays plain.
  const analysed = await __testing.createTtsTransport(0, { single: true, fromUtterance: 2 });
  assert.equal(requests, 1);
  assert.deepEqual([analysed.items[1].segment.speaker, analysed.items[1].segment.speakerSource, analysed.items[1].segment.emotion], ['樱井', 'model', 'happy']);
  assert.equal(__testing.configureForTest({}).tts.mode, 'off');
  // Set to read plain: nothing is asked, the text names the speaker.
  __testing.configureForTest({ settings: { ...base, tts: { ...base.tts, askAnalysis: 'plain' } } });
  context.chat.push(await translatedFloor('泰羅は言った。「もう帰る」', [[1, '泰罗说：「我先回去了。」']], __testing.configureForTest({})));
  const plain = await __testing.createTtsTransport(1, { single: true, fromUtterance: 2 });
  assert.equal(requests, 1);
  assert.deepEqual([plain.items[1].segment.speaker, plain.items[1].segment.speakerSource, plain.items[1].segment.emotion], ['泰罗', 'local', null]);
  // A floor analysed before is picked up silently when read plain later.
  __testing.configureForTest({ settings: { ...base, tts: { ...base.tts, askAnalysis: 'ask' } } });
  const again = await __testing.createTtsTransport(0, { single: true, fromUtterance: 2 });
  assert.equal(requests, 1, 'the analysis is at hand; nobody is asked');
  assert.equal(again.items[1].segment.speaker, '樱井');
});

test('a paragraph button reads its paragraph and stops; the floor button reads on', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-paragraph-only');
  const settings = __testing.configureForTest({
    settings: { tts: { enabled: true, mode: 'off', askAnalysis: 'plain', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH } },
  });
  context.chat.push(await translatedFloor('一。\n\n二。三。', [[1, '第一段。'], [2, '第二段一。第二段二。']], settings));
  mockFish();
  const audio = mockAudio();
  t.after(audio.restore);
  const createUrl = URL.createObjectURL;
  let urls = 0;
  URL.createObjectURL = () => `blob:take-${urls += 1}`;
  t.after(() => { URL.createObjectURL = createUrl; });
  await __testing.playTtsParagraph(0, 1);
  assert.equal(audio.plays.length, 1, 'the first paragraph, and nothing after it');
  await __testing.playTtsParagraph(0, 2);
  assert.equal(audio.plays.length, 2, 'the second paragraph alone');
  assert.notEqual(audio.plays[1].src, audio.plays[0].src);
  await __testing.playTtsFloor(0);
  assert.equal(audio.plays.length, 4, 'the floor button reads both paragraphs on');
});



test('the deep reading: its own request on the floor it speaks, with the card and the last floors, on its own connection', async t => {
  restoreGlobals(t);
  const requests = [];
  const { context } = mockHost('tts-deep-open', {
    async processRequest(payload) {
      requests.push(payload);
      const input = JSON.parse(payload.messages.at(-1).content);
      if (input.task === 'refine_voices_for_audiobook') return { content: JSON.stringify({ voices: [{ id: 2, emotion: 'angry', intensity: 2 }] }) };
      return { content: JSON.stringify({ voices: [{ id: 1 }, { id: 2, why: '嘴硬，其实是撒娇', emotion: 'shy', intensity: 0, tone: 'soft tone', pauses: [{ after: '我', length: 'short' }] }] }) };
    },
  });
  const deepChannel = normalizeChannel({ id: 'c2', name: 'thinker', url: 'https://deep.example/v1', key: 'k2', model: 'reasoner' });
  const settings = __testing.configureForTest({
    settings: {
      apiMode: 'independent', channels: [CHANNEL, deepChannel], selectedChannelId: 'c1',
      tts: { enabled: true, mode: 'deep', deepChannelId: 'c2', context: { character: true, worldbook: false, recent: true, floors: 2 }, narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH },
      ttsVoices: { 'taro.png': [{ name: '泰罗', voiceId: 'voice-taro' }] },
    },
  });
  context.chat.push({ mes: '<story_scene>\n前一楼：泰罗把作业塞进了书包。\n</story_scene>', is_user: false, swipe_id: 0, extra: {} });
  context.chat.push(await translatedFloor('泰羅は言った：「別に、寂しくなんかない」', [[1, '泰罗说：「我才没有寂寞。」']], settings, { 1: { speaker: '泰罗', emotion: 'sad', intensity: 1, quotes: [{ head: '我才', speaker: '泰罗', emotion: 'sad', intensity: 1 }] } }));
  const floor = await __testing.collectTtsFloor(1, settings);
  const read = await __testing.prepareTtsSegments(floor, settings);
  assert.equal(requests.length, 1, 'one request, the deep reading\'s own');
  assert.equal(requests[0].model, 'reasoner', 'the deep reading\'s own connection');
  const input = JSON.parse(requests[0].messages.at(-1).content);
  assert.equal(input.task, 'direct_voices_for_audiobook');
  assert.equal('skeleton' in input, false, 'the translation marked this floor; the deep reading reads it again itself');
  assert.deepEqual(input.lines, [{ line: 1, text: '泰罗说：⟦2⟧「我才没有寂寞。」' }]);
  assert.match(input.references.character, /怕热，嘴硬/);
  assert.match(input.references.recent, /作业塞进了书包/);
  assert.equal(read.depth, 'deep');
  // The mood is the reading's own; the name the translation marked is kept where the reading gave none.
  assert.deepEqual([read.segments[1].speaker, read.segments[1].emotion, read.segments[1].intensity], ['泰罗', 'shy', 0]);
  const inspected = await __testing.ttsInspect(1, 2);
  assert.equal(inspected.depth, 'deep');
  assert.equal(inspected.text, '[shy][soft tone] 我 [pause] 才没有寂寞。');
  assert.ok(inspected.summary.some(([term, value]) => term === '依据' && value === '嘴硬，其实是撒娇'));
  // A second look asks nothing.
  await __testing.prepareTtsSegments(floor, settings);
  assert.equal(requests.length, 1);
  // A correction on this floor goes out short, and the floor stays deep.
  await __testing.refineTtsAnalysis(1, { utteranceId: 2, feedback: '情绪不够饱满' });
  assert.equal(requests.length, 2);
  const after = await __testing.prepareTtsSegments(floor, settings);
  assert.equal(requests.length, 2, 'not read again');
  assert.equal(after.depth, 'deep');
  assert.deepEqual([after.segments[1].emotion, after.segments[1].intensity], ['angry', 2]);
});

test('a character switched off is not read: no request for their lines, and the list says why', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-mute');
  const settings = __testing.configureForTest({
    settings: {
      tts: { enabled: true, mode: 'off', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH },
      ttsVoices: { 'taro.png': [{ name: '泰罗', voiceId: 'voice-taro' }, { name: '樱井', voiceId: 'voice-sakurai', mute: true }] },
    },
  });
  __testing.resetTtsPlayer();
  context.chat.push(await translatedFloor('一。\n\n二。', [[1, '泰罗说：「走吧。」'], [2, '樱井说：「等一下。」']], settings, {
    1: { speaker: '泰罗', quotes: [{ head: '走吧', speaker: '泰罗' }] },
    2: { speaker: '樱井', quotes: [{ head: '等一下', speaker: '樱井' }] },
  }));
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  const { items, skipped } = await __testing.ttsItemsFor(floor, segments, settings);
  assert.deepEqual(skipped.map(item => [item.segment.text, item.reason]), [['等一下。', 'mute']], 'the muted character\'s line is passed over');
  assert.equal(items.some(item => item.segment.text === '等一下。'), false);
  assert.deepEqual(items.map(item => item.voiceId), ['voice-narrator', 'voice-taro', 'voice-narrator'], 'everyone else reads as before');

  const calls = mockFish();
  await __testing.ensureTtsRecording(floor, 'floor:all', items, settings);
  assert.equal(calls.length, 1);
  assert.match(calls[0].body.text, /走吧/);
  assert.doesNotMatch(calls[0].body.text, /等一下/, 'the muted line never reaches Fish');

  // The dialogue default set to 跳过: only the characters actually cast are heard.
  const cast = __testing.configureForTest({ settings: { tts: { ...settings.tts, dialogueFallback: 'skip' }, ttsVoices: { 'taro.png': [{ name: '泰罗', voiceId: 'voice-taro' }] } } });
  const second = await __testing.collectTtsFloor(0, cast);
  const read = await __testing.prepareTtsSegments(second, cast);
  const plan = await __testing.ttsItemsFor(second, read.segments, cast);
  assert.deepEqual(plan.skipped.map(item => [item.segment.text, item.reason]), [['等一下。', 'fallback']], '樱井 has no voice of their own any more');
  assert.equal(plan.items.some(item => item.segment.text === '走吧。'), true, 'a character with a voice of their own still reads');
});

test('the audio saves from the floor the window is looking at, with nothing playing', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-save-source');
  const settings = __testing.configureForTest({
    settings: { tts: { enabled: true, mode: 'off', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH } },
  });
  __testing.resetTtsPlayer();
  context.chat.push(await translatedFloor('一。\n\n二。', [[1, '第一段的话。'], [2, '第二段的话。']], settings));
  const calls = mockFish();
  // Nothing has been played, and the save still knows what it is about.
  const source = await __testing.ttsSaveSource({ messageId: 0 });
  assert.equal(source.messageId, 0);
  assert.equal(source.items.length, 2);
  assert.equal(source.current, null, 'nothing is playing, so no sentence is the current one');

  const saves = [];
  globalThis.URL.createObjectURL = () => 'blob:saved';
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.document = {
    body: { appendChild() {} },
    querySelector: () => null,
    createElement: () => ({ set download(name) { saves.push(name); }, click() {}, remove() {}, style: {} }),
  };
  t.after(() => { delete globalThis.document; });
  // The file is built and handed back; writing it is the reader's own tap on a link in the dialog.
  const whole = await __testing.downloadTtsAudio({ messageId: 0, scope: 'floor' });
  assert.equal(whole.name, '镜译-第0楼.mp3');
  assert.ok(whole.bytes > 0);
  assert.equal(whole.blob.size, whole.bytes, 'the audio itself comes back, not a promise that it was saved');
  assert.deepEqual(saves, [], 'nothing is written behind the reader’s back');
  // One paragraph, named by its place in the floor rather than by what is playing.
  const one = await __testing.downloadTtsAudio({ messageId: 0, lineId: 2 });
  assert.equal(one.name, '镜译-第0楼-第2段.mp3');
  assert.ok(one.bytes > 0);
  assert.ok(calls.length >= 1, 'what had not been made was made for the save');
  await assert.rejects(__testing.downloadTtsAudio({ messageId: 0, lineId: 99 }), /没有可朗读的句子/);
});

test('an analysis that fails does not leave the floor saying 正在分析 for good', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-status-leak', {
    async processRequest() { throw new Error('独立副 API 请求超时(>240秒)'); },
  });
  const settings = __testing.configureForTest({
    settings: { apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1', tts: { enabled: true, mode: 'simple', narratorVoice: 'v-n', dialogueVoice: 'v-d', fish: FISH } },
  });
  __testing.resetTtsPlayer();
  context.chat.push(await translatedFloor('一。', [[1, '「这一句要读。」']], settings));
  await __testing.reanalyzeTtsFloor(0);
  assert.equal(__testing.ttsStatusOf(0), null, 'the line under the floor is cleared however the request ended');
});

test('a paragraph Fish did not answer is asked again as often as the reader allowed, a refusal only once', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-fish-retry');
  const settings = __testing.configureForTest({
    settings: { tts: { enabled: true, mode: 'off', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: { ...FISH, retries: 2 } } },
  });
  __testing.resetTtsPlayer();
  context.chat.push(await translatedFloor('一。\n\n二。', [[1, '第一段要读。'], [2, '第二段也要读。']], settings));
  const calls = mockFish();
  const toFish = globalThis.fetch;
  let attempts = 0;
  let refuse = 0;
  let status = 502;
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes('/v1/tts/')) return toFish(url, init);
    attempts += 1;
    if (refuse > 0) {
      refuse -= 1;
      return new Response('boom', { status });
    }
    return toFish(url, init);
  };
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  const { items } = await __testing.ttsItemsFor(floor, segments, settings);

  // Two failures of the kind that passes, then the answer: three attempts, one recording.
  refuse = 2;
  const { record } = await __testing.ensureTtsRecording(floor, 'line:1', items.filter(item => item.segment.lineId === 1), settings);
  assert.equal(attempts, 3, 'asked again twice, as 失败后自动重试次数 says');
  assert.equal(refuse, 0);
  assert.ok(record.parts.length, 'the paragraph was recorded in the end');

  // A refusal is answered once: asking again would buy the same answer.
  attempts = 0;
  refuse = 9;
  status = 401;
  await assert.rejects(__testing.ensureTtsRecording(floor, 'line:2', items.filter(item => item.segment.lineId === 2), settings));
  assert.equal(attempts, 1, 'a key Fish will not take is not worth three requests');
  assert.ok(calls.length >= 1);
});

test('a request that timed out is asked again: the timeout is not a stop', async t => {
  restoreGlobals(t);
  mockHost('tts-fish-timeout');
  const fish = { ...FISH, retries: 1, timeoutSec: 10, model: 's2.1-pro-free', format: 'mp3' };
  const calls = mockFish();
  const toFish = globalThis.fetch;
  let seen = 0;
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes('/v1/tts/')) return toFish(url, init);
    seen += 1;
    // The first attempt never answers, and is cut off by the timeout window. That abort used to be
    // read as 「the reader pressed 停止」, and the second attempt was never made.
    if (seen === 1) {
      return new Promise((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      });
    }
    return toFish(url, init);
  };
  const result = await __testing.streamFishTimestamps({ text: '这一段要读。' }, fish, undefined);
  assert.equal(seen, 2, 'the second attempt was made');
  assert.ok(result.audio.length, 'and it came back');
  assert.equal(calls.length, 1, 'Fish answered once, on the attempt that got through');
});

// ---------------------------------------------------------------------------------------------
// A floor analysed again is heard again: audio made before the analysis was asked for is not its audio.
// ---------------------------------------------------------------------------------------------

async function waitFor(check, { tries = 80, step = 10 } = {}) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (await check()) return true;
    await new Promise(resolve => setTimeout(resolve, step));
  }
  return false;
}

test('a floor analysed again remakes by time every paragraph that had audio, after a reload too, and picks the reading up where it was', async t => {
  restoreGlobals(t);
  const requests = [];
  const { context } = mockHost('tts-remake-by-time', {
    async processRequest(payload) {
      requests.push(payload);
      const input = JSON.parse(payload.messages.at(-1).content);
      if (input.task === 'refine_voices_for_audiobook') {
        return { content: JSON.stringify({ voices: [{ id: 2 }, { id: 3, type: 'dialogue', speaker: '樱井', emotion: 'sad' }] }) };
      }
      // The same answer every time: a reading asked for again that comes out word for word the same.
      return { content: JSON.stringify({ voices: [
        { id: 2, type: 'dialogue', speaker: '泰罗', emotion: 'determined', pauses: [{ after: '出发', length: 'short' }] },
        { id: 3, type: 'dialogue', speaker: '樱井', emotion: 'pleading' },
      ] }) };
    },
  });
  const settings = __testing.configureForTest({
    settings: {
      apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1',
      tts: { enabled: true, mode: 'simple', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH },
      ttsVoices: { 'taro.png': [{ name: '泰罗', voiceId: 'voice-taro' }, { name: '樱井', voiceId: 'voice-sakurai' }] },
    },
  });
  context.chat.push(await translatedFloor('風が止んだ。\n\n「行くぞ」\n\n「待って」', [[1, '风在桥头停了下来。'], [2, '「出发吧，别磨蹭。」'], [3, '「等一下嘛，鞋带开了。」']], settings));
  const fish = mockFish();
  const audio = mockAudio();
  t.after(audio.restore);

  // Every paragraph made once: one analysis, three Fish requests.
  await __testing.pregenerateTtsFloor(0, { quiet: true });
  assert.equal(requests.length, 1);
  assert.equal(fish.length, 3);

  // The page is reloaded. Nothing of the session is left but the store.
  __testing.forgetTtsSession();
  const look = await __testing.ttsInspect(0, 3);
  assert.equal(look.depth, 'simple', 'a look after a reload finds the reading kept in the store');
  assert.equal(look.segment.emotion, 'pleading');
  assert.equal(look.recorded, true, 'and the audio made from it');
  assert.equal(requests.length, 1, 'finding it asked nobody');
  assert.deepEqual([...await __testing.ttsRecordedLines(0, 'translation')].sort(), [1, 2, 3], 'the paragraphs that had audio are read off the store');

  // Analysed again: the answer is the same, and the audio is made again all the same — it predates
  // the reading. The narration the reading never labels keeps its audio.
  const done = await __testing.reanalyzeTtsFloor(0);
  assert.equal(requests.length, 2);
  assert.deepEqual(done.remake, { made: 2, kept: 1, failed: 0 });
  assert.equal(fish.length, 5, 'two paragraphs with dialogue made again, the narration kept');
  assert.match(__testing.describeTtsRemake(done.remake), /2 段音频已按新分析重做，1 段不受影响/);
  // What was made afterwards is the floor's audio now: reading the floor asks Fish nothing.
  const transport = await __testing.createTtsTransport(0, { single: false });
  await __testing.runTtsTransport(transport);
  assert.equal(fish.length, 5);
  assert.equal(requests.length, 2);

  // A correction about one line: that line's paragraph is made again, the rest is left alone, and a
  // line the model sent back untouched keeps its whole voice.
  const refined = await __testing.refineTtsAnalysis(0, { feedback: '最后一句太撒娇了' });
  assert.equal(refined.changed, 1);
  assert.deepEqual(refined.remake, { made: 1, kept: 2, failed: 0 });
  assert.equal(fish.length, 6);
  const kept = await __testing.ttsInspect(0, 2);
  assert.deepEqual(kept.segment.voice?.pauses, [{ after: '出发', length: 'short' }], 'the untouched line keeps its pause');
  assert.equal((await __testing.ttsInspect(0, 3)).segment.emotion, 'sad');

  // A reading that was playing when the floor was analysed again picks up at the paragraph it was on.
  const playing = await __testing.createTtsTransport(0, { single: false });
  playing.index = playing.items.findIndex(item => item.segment.lineId === 3);
  playing.state = 'playing';
  const plays = audio.plays.length;
  await __testing.reanalyzeTtsFloor(0);
  assert.ok(await waitFor(() => __testing.ttsTransport() && __testing.ttsTransport() !== playing && __testing.ttsTransport().state === 'idle'), 'a new reading ran');
  assert.equal(audio.plays.length - plays, 1, 'from the third paragraph, not from the top');
  assert.equal(fish.length, 8, 'the two paragraphs with dialogue were made again before it was heard');
});


// ---------------------------------------------------------------------------------------------
// Speaker marks the story writes itself: several voices, with moods, and nobody asked.
// ---------------------------------------------------------------------------------------------

test('a floor the story marked itself reads by its marks: who, how, several voices, and no request to anybody', async t => {
  restoreGlobals(t);
  let requests = 0;
  const { context } = mockHost('tts-say-plain', {
    async processRequest() {
      requests += 1;
      return { content: '{}' };
    },
  });
  const settings = __testing.configureForTest({
    settings: {
      apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1',
      tts: { enabled: true, mode: 'off', side: 'source', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH },
      ttsVoices: { 'taro.png': [{ name: '泰罗', voiceId: 'voice-taro' }, { name: '樱井', voiceId: 'voice-sakurai' }] },
    },
  });
  context.chat.push({ mes: '<story_scene>樱井推开家门。<say who="樱井" mood="开心">「你终于回来啦！」</say>\n\n<say who="泰罗" mood="生气、大喊">别碰我冰箱里的布丁！</say>泰罗在厨房里吼道。</story_scene>', swipe_id: 0, extra: {} });
  const floor = await __testing.collectTtsFloor(0, settings);
  assert.deepEqual(floor.lines.map(line => line.text), ['樱井推开家门。「你终于回来啦！」', '「别碰我冰箱里的布丁！」泰罗在厨房里吼道。'], 'the marks are gone from the words, and dialogue left unquoted is quoted');
  const { segments, depth } = await __testing.prepareTtsSegments(floor, settings);
  assert.equal(requests, 0, 'nobody is asked');
  assert.equal(depth, 'off');
  assert.deepEqual(segments.filter(segment => segment.type === 'dialogue').map(segment => [segment.speaker, segment.speakerSource, segment.emotion]), [['樱井', 'tag', 'happy'], ['泰罗', 'tag', 'angry']]);
  const { items } = await __testing.ttsItemsFor(floor, segments, settings);
  assert.deepEqual(items.map(item => item.voiceId), ['voice-narrator', 'voice-sakurai', 'voice-taro', 'voice-narrator'], 'each character in their own voice');
  const shout = await __testing.ttsInspect(0, 3);
  assert.match(shout.text, /angry/);
  assert.match(shout.text, /shouting/, 'how loud the mark said is heard too');
  assert.equal(shout.speakerSource, 'tag');

  // The same floor in the simple reading: every line is marked, so there is nothing to ask.
  __testing.configureForTest({ settings: { tts: { ...runtime().tts, mode: 'simple' } } });
  const simple = await __testing.prepareTtsSegments(await __testing.collectTtsFloor(0, runtime()), runtime());
  assert.equal(requests, 0);
  assert.equal(simple.depth, 'annotations');
});

test('a floor marked only here and there is still analysed in the simple reading, with the marked speakers settled', async t => {
  restoreGlobals(t);
  const requests = [];
  const { context } = mockHost('tts-say-partial', {
    async processRequest(payload) {
      requests.push(JSON.parse(payload.messages.at(-1).content));
      return { content: JSON.stringify({ voices: [{ id: 1, speaker: '泰罗', emotion: 'sad' }, { id: 2, speaker: '泰罗', emotion: 'calm' }] }) };
    },
  });
  const settings = __testing.configureForTest({
    settings: {
      apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1',
      tts: { enabled: true, mode: 'simple', side: 'source', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH },
      ttsVoices: { 'taro.png': [{ name: '泰罗', voiceId: 'voice-taro' }, { name: '樱井', voiceId: 'voice-sakurai' }] },
    },
  });
  context.chat.push({ mes: '<story_scene><say who="樱井" mood="害羞">「这个……给你的。」</say>\n\n「谢了。」泰罗接过盒子。</story_scene>', swipe_id: 0, extra: {} });
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  assert.equal(requests.length, 1, 'one line has no mark, so the reading asks once');
  assert.deepEqual(requests[0].speakers, { 1: '樱井' }, 'the marked speaker goes out as settled');
  assert.deepEqual([segments[0].speaker, segments[0].speakerSource], ['樱井', 'tag'], 'and the model could not move it');
  assert.deepEqual([segments[1].speaker, segments[1].speakerSource], ['泰罗', 'model']);
});

test('reading the translation of a marked floor: the original\'s marks carry over line by line', async t => {
  restoreGlobals(t);
  let requests = 0;
  const { context } = mockHost('tts-say-translation', {
    async processRequest() {
      requests += 1;
      return { content: '{}' };
    },
  });
  const settings = __testing.configureForTest({
    settings: {
      apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1',
      tts: { enabled: true, mode: 'off', side: 'translation', narratorVoice: 'voice-narrator', dialogueVoice: 'voice-default', fish: FISH },
      ttsVoices: { 'taro.png': [{ name: '泰罗', voiceId: 'voice-taro' }, { name: '樱井', voiceId: 'voice-sakurai' }] },
    },
  });
  context.chat.push(await translatedFloor('<say who="樱井" mood="害羞">「……ありがとう。」</say>桜井は俯いた。', [[1, '「……谢谢你。」樱井低下了头。']], settings));
  const floor = await __testing.collectTtsFloor(0, settings);
  assert.equal(floor.side, 'translation');
  assert.ok(floor.speechSource?.length, 'the original\'s marks ride along with the translation');
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  assert.equal(requests, 0);
  assert.deepEqual([segments[0].text, segments[0].speaker, segments[0].speakerSource, segments[0].emotion], ['……谢谢你。', '樱井', 'tag', 'shy']);
});

test('the speaker-mark entry goes into the card\'s own book, is rewritten in place, and a chat with no book gets one of its own', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-say-entry');
  const books = new Map([['泰罗的书', { entries: { 0: { uid: 0, comment: '泰罗', content: '怕热。', key: ['泰罗'] } } }]]);
  let metadataSaves = 0;
  Object.assign(context, {
    getWorldInfoNames: () => [...books.keys()],
    loadWorldInfo: async name => (books.has(name) ? structuredClone(books.get(name)) : null),
    saveWorldInfo: async (name, data) => { books.set(name, structuredClone(data)); },
    updateWorldInfoList: async () => {},
    chatMetadata: {},
    saveMetadata: async () => { metadataSaves += 1; },
  });
  context.characters[0].data = { extensions: { world: '泰罗的书' } };
  const settings = __testing.configureForTest({
    settings: { tts: { enabled: true, mode: 'off', fish: FISH }, ttsVoices: { 'taro.png': [{ name: '泰罗' }, { name: '樱井' }] } },
  });
  const first = await __testing.installSpeechEntry(settings);
  assert.deepEqual([first.where, first.name, first.updated], ['character', '泰罗的书', false]);
  const entries = () => Object.values(books.get('泰罗的书').entries);
  assert.equal(entries().length, 2, 'the entry sits beside what the book already had');
  const entry = entries().find(item => item.comment === '镜译 · 说话人与情绪标记');
  assert.equal(entry.constant, true);
  assert.equal(entry.disable, false);
  assert.equal(entry.uid, 1);
  assert.match(entry.content, /<say who="说话人" mood="情绪">「台词」<\/say>/);
  assert.match(entry.content, /泰罗、樱井/, 'the names the voices are registered under');
  assert.doesNotMatch(entry.content, /玩家/, 'the reader is not on the list');
  // Whatever the entry offers as a mood is a mood the reading understands.
  const offered = entry.content.match(/mood 从这些词里选一个最贴切的：([^。]+)。/)[1].split('、');
  assert.ok(offered.length > 10);

  // Pressed again after a character was added: the same entry, with the new name.
  __testing.configureForTest({ settings: { ttsVoices: { 'taro.png': [{ name: '泰罗' }, { name: '樱井' }, { name: '小林' }] } } });
  const again = await __testing.installSpeechEntry(runtime());
  assert.equal(again.updated, true);
  assert.equal(entries().filter(item => item.comment === '镜译 · 说话人与情绪标记').length, 1, 'rewritten, not added twice');
  assert.match(entries().find(item => item.comment === '镜译 · 说话人与情绪标记').content, /小林/);

  // A card with no book in a chat with none: a book of its own, hung on this chat and nothing else.
  delete context.characters[0].data;
  const fresh = await __testing.installSpeechEntry(runtime());
  assert.equal(fresh.where, 'new');
  assert.ok(books.has(fresh.name));
  assert.equal(context.chatMetadata.world_info, fresh.name);
  assert.equal(metadataSaves, 1);
  // The example quotes the way the story does.
  context.chat.push({ mes: '<story_scene>“早。”她说。“今天也很热。”</story_scene>', swipe_id: 0, extra: {} });
  assert.match(__testing.speechEntryContent(runtime(), context), /<say who="说话人" mood="情绪">“台词”<\/say>/);
});

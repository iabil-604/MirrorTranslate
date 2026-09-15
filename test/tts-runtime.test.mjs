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
    characters: [{ name: '泰罗', avatar: 'taro.png', description: '怕热，嘴硬，一急就想脱衣服。', personality: '', scenario: '' }],
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

// A Fish stand-in: every request answers with one text chunk whose characters are aligned in order, so
// each sentence lands on its own stretch of the timeline. The bodies are kept for the assertions.
function mockFish({ status = 200, body = null } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const sent = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, init, body: sent });
    if (status !== 200) return new Response(body ?? '', { status });
    const spoken = String(sent?.text ?? '').replace(/<\|speaker:\d+\|>/g, '').replace(/\[[^\]]*\]/g, '');
    const characters = [...spoken].filter(character => /[\p{L}\p{N}]/u.test(character));
    const segments = characters.map((text, index) => ({ text, start: index * 0.25, end: index * 0.25 + 0.2 }));
    const duration = characters.length * 0.25;
    const event = { audio_base64: 'AAEC', content: spoken, alignment: { audio_duration: duration, segments }, chunk_seq: 0, chunk_audio_offset_sec: 0 };
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
  context.chat.push(await translatedFloor('桜井は振り返った。\n\n「来たんだね」', [[1, '樱井回过头。'], [2, '「你来了啊」']], settings, { 2: { speaker: '樱井', emotion: 'happy' } }));
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
  assert.equal(input.utterances[1].line, 2);
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
  assert.equal(input.task, 'label_utterances_for_audiobook', 'the stream reads lightly by default');
  assert.deepEqual(input.utterances.map(item => item.text), ['蓝蓝的天空，泰罗说：', '「我操好热啊！」']);

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
    settings: { apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1', tts: { enabled: true, mode: 'floor', analysis: 'auto', context: { character: true, worldbook: false, recent: true, floors: 2 }, fish: FISH } },
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
  assert.equal(inspected.text, '[very frustrated][shouting] 我操 [break] 好 [emphasis] 热啊！');
  assert.deepEqual(inspected.prosody, { speed: 1.12, volume: 3 });
  assert.equal(inspected.scene, '闷热的教室');
  assert.equal(inspected.character.habit, '句尾拖长');
  assert.ok(inspected.summary.some(([term]) => term === '潜台词'));
  assert.equal(inspected.depth, 'deep');

  // The fast, loud sentence is its own request: Fish's prosody is per request.
  const calls = mockFish();
  const { items } = await __testing.ttsItemsFor(floor, segments, settings);
  const { record } = await __testing.ensureTtsRecording(floor, 'floor:all', items, settings);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body.prosody, { speed: 1, volume: 0 });
  assert.deepEqual(calls[1].body.prosody, { speed: 1.12, volume: 3 });
  assert.equal(calls[1].body.text, '[very frustrated][shouting] 我操 [break] 好 [emphasis] 热啊！');
  assert.equal(record.parts.length, 2);
  assert.deepEqual(record.timeline.map(entry => [entry.id, entry.part]), [[1, 0], [2, 1]]);
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
    settings: { apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1', tts: { enabled: true, analysis: 'light', fish: FISH } },
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

  // Switching to the whole-floor mode still finds it, and the rest of the floor is one more request.
  const wholeFloor = __testing.configureForTest({ settings: { tts: { ...settings.tts, mode: 'floor' } } });
  const found = await __testing.findTtsEntry(floor, items[1], wholeFloor);
  assert.equal(found.record.unit, 'line:2', 'the paragraph recording answers for the sentence in floor mode too');
  const third = await __testing.resolveTtsEntry(floor, items, items[2], wholeFloor);
  assert.equal(third.cached, false);
  assert.equal(calls.length, 2);
  assert.match(calls[1].body.text, /<\|speaker:0\|>蓝蓝的天空上有红红的太阳。\n<\|speaker:1\|>\[surprised\] 你怎么来了？\n<\|speaker:0\|>泰罗放下了杯子。/);
  assert.deepEqual(calls[1].body.reference_id, ['voice-narrator', 'voice-taro']);
  assert.equal(third.record.unit, 'floor:all');
  assert.equal(third.record.timeline.length, 3);
  assert.ok(third.record.timeline.every(entry => entry.coverage === 1));

  // Back in the stream, every sentence is covered by the floor recording: nothing more is requested.
  for (const item of items) assert.ok(await __testing.findTtsEntry(floor, item, settings));
  assert.equal(await __testing.pregenerateTtsFloor(0, { quiet: true }), 0);
  assert.equal(calls.length, 2);
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
  const made = await __testing.saveTtsOverride(0, 2, { text: '[whispering][sad] 好 [long-break] 热……', speed: 0.8, volume: -4 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.text, '[whispering][sad] 好 [long-break] 热……');
  assert.deepEqual(calls[0].body.prosody, { speed: 0.8, volume: -4 });
  assert.equal(made.unit, 'sentence:2');
  assert.equal(made.overrideText, '[whispering][sad] 好 [long-break] 热……');

  const inspected = await __testing.ttsInspect(0, 2);
  assert.equal(inspected.override.text, '[whispering][sad] 好 [long-break] 热……');
  assert.equal(inspected.override.speed, 0.8);
  assert.equal(inspected.text, '[happy] 好热！', 'the automatic version is still shown beside it');
  assert.equal(inspected.recorded, true);

  // The floor read as a whole uses the edited take and only records the rest.
  const floor = await __testing.collectTtsFloor(0, settings);
  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  const { items } = await __testing.ttsItemsFor(floor, segments, settings);
  assert.equal(items[1].override.text, '[whispering][sad] 好 [long-break] 热……');
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
  const settings = __testing.configureForTest({ settings: { apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1' }, worldInfoEntries: lore });
  const result = await __testing.importCastFromWorldbook(settings);
  assert.equal(result.source, 'model');
  assert.deepEqual(result.cast, [{ name: '樱井', aliases: ['桜井'], lang: 'ja' }, { name: '泰罗', aliases: [], lang: 'en-GB' }], 'the user is left out, blanks dropped, accents kept');
  const input = JSON.parse(requests[0].messages.at(-1).content);
  assert.equal(input.task, 'list_characters_from_worldbook');
  assert.deepEqual(input.entries.map(entry => entry.title), ['角色卡：泰罗', '樱井', '体型指导条目', ''], 'the card goes first');
  assert.match(input.entries[0].content, /怕热，嘴硬/);
  assert.match(requests[0].messages[0].content, /「XX 指导」的条目通常不是人物/);

  // Without a model there is no list at all: titles are not names.
  mockHost('tts-cast-offline', { async processRequest() { throw new Error('relay down'); } });
  const offline = __testing.configureForTest({ settings: { apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1' }, worldInfoEntries: lore });
  await assert.rejects(__testing.importCastFromWorldbook(offline), /识别角色需要副模型/);

  // Nothing readable at all is its own message.
  const { context } = mockHost('tts-cast-empty');
  context.characters = [];
  const bare = __testing.configureForTest({ settings: { apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1' }, worldInfoEntries: { globalLore: [], characterLore: [], chatLore: [], personaLore: [] } });
  await assert.rejects(__testing.importCastFromWorldbook(bare), /没有可读的世界书条目/);
});

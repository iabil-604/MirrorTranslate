import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_TTS, mergeSettings, normalizeTts, normalizeVoiceList } from '../core.js';
import {
  NARRATOR,
  alignSpansToTimeline,
  analysisCacheKey,
  buildFishPayload,
  buildGlobalTimeline,
  buildSegments,
  buildTtsAnalysisMessages,
  createSseParser,
  createTimestampCollector,
  describeFishFailure,
  emotionCue,
  fishEndpoint,
  fishFingerprint,
  fishHeaders,
  floorCacheKey,
  labelsFromAnnotations,
  linesFromTaggedText,
  locateAnchors,
  parseTtsAnalysis,
  planFishParts,
  planVoices,
  playbackWindow,
  resolveSegmentVoice,
  segmentsInRange,
  sentenceCacheKey,
  splitNarrationSentences,
  splitUtterances,
  toStandardDocument,
} from '../tts.js';
import { createMemoryBackend, createTtsStore, planEviction } from '../tts-store.js';
import { addDiagnostic, clearDiagnostics, readDiagnostics } from '../diagnostics.js';

// Captured from api.fish.audio /v1/tts/stream/with-timestamp (model s2.1-pro-free) for the request text
// 「蓝蓝的天空上有红红的太阳。[happy] 我操好热啊！然后泰罗喝了口水。」. Chinese is aligned per character with
// the punctuation dropped, the cue does not appear, and the cue left a three-second pause after 我.
const LIVE_SINGLE = [
  ['蓝', 0, 0.24], ['蓝', 0.24, 0.4], ['的', 0.4, 0.48], ['天', 0.48, 0.8], ['空', 0.8, 0.96], ['上', 0.96, 1.28],
  ['有', 1.28, 1.36], ['红', 1.36, 1.6], ['红', 1.6, 1.76], ['的', 1.76, 1.84], ['太', 1.84, 2.08], ['阳', 2.08, 2.32],
  ['我', 2.88, 2.96], ['操', 6.08, 6.32], ['好', 6.4, 6.56], ['热', 6.56, 6.72], ['啊', 6.96, 7.12],
  ['然', 7.92, 8.08], ['后', 8.08, 8.24], ['泰', 8.24, 8.48], ['罗', 8.48, 8.56], ['喝', 8.56, 8.72], ['了', 8.72, 8.8],
  ['口', 8.8, 8.96], ['水', 8.96, 9.28],
].map(([text, start, end]) => ({ text, start, end }));

// The multi-speaker request 「<|speaker:0|>蓝蓝的天空上有红红的太阳。<|speaker:1|>[surprised] 你怎么来了？
// <|speaker:0|>泰罗放下了杯子。」 came back as two text chunks; the second carries its own offset.
const LIVE_MULTI_CHUNK0 = [
  ['蓝', 0, 0.4], ['蓝', 0.4, 0.64], ['的', 0.64, 0.72], ['天', 0.72, 0.96], ['空', 0.96, 1.2], ['上', 1.2, 1.6],
  ['有', 1.6, 1.76], ['红', 1.76, 2], ['红', 2.08, 2.24], ['的', 2.24, 2.32], ['太', 2.32, 2.56], ['阳', 2.56, 2.96],
  ['你', 3.2, 3.36], ['怎', 3.44, 3.6], ['么', 3.6, 3.68], ['来', 3.68, 3.84], ['了', 3.84, 4.16],
].map(([text, start, end]) => ({ text, start, end }));
const LIVE_MULTI_CHUNK1 = [
  ['泰', 0.16, 0.4], ['罗', 0.4, 0.56], ['放', 0.56, 0.8], ['下', 0.8, 0.96], ['了', 0.96, 1.04], ['杯', 1.04, 1.28], ['子', 1.28, 1.52],
].map(([text, start, end]) => ({ text, start, end }));

const FISH = normalizeTts({}).fish;

test('a line is cut into narration and dialogue the way the reader hears it', () => {
  const utterances = splitUtterances([{ lineId: 1, text: '蓝蓝的天空上有红红的太阳，泰罗说：「我操好热啊！」，然后泰罗喝了口水' }]);
  assert.deepEqual(utterances.map(({ kind, text, anchor }) => ({ kind, text, anchor })), [
    { kind: 'narration', text: '蓝蓝的天空上有红红的太阳，泰罗说：', anchor: '蓝蓝的天空上有红红的太阳，泰罗说：' },
    { kind: 'quoted', text: '我操好热啊！', anchor: '「我操好热啊！」' },
    { kind: 'narration', text: '然后泰罗喝了口水', anchor: '，然后泰罗喝了口水' },
  ]);
  assert.deepEqual(utterances.map(item => item.id), [1, 2, 3]);
});

test('narration splits at full stops and silent runs are not utterances', () => {
  assert.deepEqual(splitNarrationSentences('雨停了。她推开门！外面很冷'), ['雨停了。', '她推开门！', '外面很冷']);
  assert.deepEqual(splitNarrationSentences('He left. She stayed?'), ['He left.', ' She stayed?']);
  const utterances = splitUtterances([{ lineId: 3, text: '「……」她没有回答。' }]);
  assert.deepEqual(utterances.map(item => [item.kind, item.text]), [['narration', '她没有回答。']]);
});

test('the analysis request carries ids and never offers the model a place to return text', () => {
  const utterances = splitUtterances([{ lineId: 1, text: '泰罗说：「我操好热啊！」' }]);
  const messages = buildTtsAnalysisMessages(utterances, { roster: ['泰罗', '佐菲'], userName: '玩家' });
  const input = JSON.parse(messages.at(-1).content);
  assert.deepEqual(input.utterances, [
    { id: 1, kind: 'narration', text: '泰罗说：' },
    { id: 2, kind: 'quoted', text: '「我操好热啊！」' },
  ]);
  assert.deepEqual(input.roster, ['泰罗', '佐菲']);
  assert.match(messages[0].content, /不要输出 text/);
});

test('analysis labels are validated and any text the model sends back is ignored', () => {
  const utterances = splitUtterances([{ lineId: 1, text: '泰罗说：「我操好热啊！」佐菲：「来了。」「嗯。」' }]);
  const raw = JSON.stringify({
    labels: [
      { id: 2, type: 'dialogue', speaker: '泰罗', emotion: 'angry', intensity: 5, text: '哎呀，真是热死我了！' },
      { id: 2, type: 'dialogue', speaker: '别人' },
      { id: 4, type: 'dialogue', speaker: '旁白', emotion: 'furious-ish' },
      { id: 99, type: 'dialogue', speaker: '不存在' },
      { id: 5, type: 'narration' },
    ],
  });
  const { labels } = parseTtsAnalysis(`好的：\n\`\`\`json\n${raw}\n\`\`\``, utterances);
  assert.deepEqual(labels.get(2), { type: 'dialogue', speaker: '泰罗', emotion: 'angry', intensity: 2 });
  assert.deepEqual(labels.get(4), { type: 'dialogue' });
  assert.equal(labels.has(99), false);
  const segments = buildSegments(utterances, labels);
  assert.equal(segments[1].text, '我操好热啊！');
  assert.equal(segments.find(item => item.id === 5).type, 'narration');

  // A reply cut off mid-array still gives up the objects that closed.
  const truncated = '{"labels":[{"id":2,"type":"dialogue","speaker":"泰罗","emotion":"happy"},{"id":4,"type":"dia';
  assert.equal(parseTtsAnalysis(truncated, utterances).labels.get(2).emotion, 'happy');
});

test('segments follow the standard structure: narrator for narration, unified speakers, null for neutral', () => {
  const utterances = splitUtterances([{ lineId: 1, text: '太阳很大。「好热！」「你怎么来了？」' }]);
  const labels = new Map([
    [2, { type: 'dialogue', speaker: '泰罗先生', emotion: 'happy', intensity: 1 }],
    [3, { type: 'dialogue', speaker: '佐菲', emotion: 'neutral' }],
  ]);
  const segments = buildSegments(utterances, labels, { knownNames: ['泰罗', '佐菲'] });
  assert.deepEqual(toStandardDocument(segments).segments, [
    { id: 'seg_001', type: 'narration', text: '太阳很大。', speaker: NARRATOR, emotion: null },
    { id: 'seg_002', type: 'dialogue', text: '好热！', speaker: '泰罗', emotion: 'happy' },
    { id: 'seg_003', type: 'dialogue', text: '你怎么来了？', speaker: '佐菲', emotion: null },
  ]);
  assert.deepEqual(segmentsInRange(segments, 'dialogue').map(item => item.id), [2, 3]);
  assert.deepEqual(segmentsInRange(segments, 'narration').map(item => item.id), [1]);
  assert.equal(segmentsInRange(segments, 'all').length, 3);
});

test('translation annotations label only the quoted runs of their line', () => {
  const utterances = splitUtterances([{ lineId: 7, text: '泰罗放下杯子，「好热。」' }]);
  const labels = labelsFromAnnotations(utterances, new Map([[7, { speaker: '泰罗', emotion: '恼火', intensity: 2 }]]));
  assert.deepEqual([...labels], [[2, { type: 'dialogue', speaker: '泰罗', emotion: 'angry', intensity: 2 }]]);
});

test('voices resolve by name or alias, narration keeps its own voice, and gaps are reported', () => {
  const voices = normalizeVoiceList([
    { name: '泰罗', aliases: '小泰', voiceId: 'voice-b' },
    { name: '佐菲', voiceId: 'voice c' },
  ]);
  assert.equal(voices[1].voiceId, '', 'an id with whitespace is not an id');
  const config = { voices, narratorVoice: 'voice-a', dialogueVoice: '' };
  assert.equal(resolveSegmentVoice({ type: 'narration' }, config), 'voice-a');
  assert.equal(resolveSegmentVoice({ type: 'dialogue', speaker: '小泰' }, config), 'voice-b');
  assert.equal(resolveSegmentVoice({ type: 'dialogue', speaker: '奥特之母' }, { ...config, dialogueVoice: 'voice-d' }), 'voice-d');
  const plan = planVoices([
    { id: 1, type: 'dialogue', speaker: '佐菲', text: '来了。' },
    { id: 2, type: 'narration', speaker: NARRATOR, text: '风很大。' },
  ], { voices, narratorVoice: '', dialogueVoice: '' });
  assert.deepEqual(plan.missing, ['佐菲', '旁白']);
  assert.equal(plan.items.length, 0);
});

test('moods become Fish cues: brackets for S2, the fixed parenthesised set for S1', () => {
  assert.equal(emotionCue('happy', 1, 's2-pro'), '[happy]');
  assert.equal(emotionCue('开心', 2, 's2.1-pro'), '[delighted]');
  assert.equal(emotionCue('whisper', 0, 's2-pro'), '[soft tone]');
  assert.equal(emotionCue('angry', 2, 's1'), '(angry)(shouting)');
  assert.equal(emotionCue('neutral', 2, 's2-pro'), '');
  assert.equal(emotionCue('nonsense', 1, 's2-pro'), '');
});

test('the Fish payload uses one reference id alone and speaker tags only where the voice changes', () => {
  const segment = (id, text, extra = {}) => ({ id, type: 'dialogue', text, speaker: null, emotion: null, intensity: null, ...extra });
  const single = buildFishPayload([{ segment: segment(1, '好热！', { emotion: 'happy', intensity: 1 }), voiceId: 'v-taro' }], FISH);
  assert.equal(single.body.text, '[happy] 好热！');
  assert.equal(single.body.reference_id, 'v-taro');
  assert.equal(single.body.mp3_bitrate, 128);
  assert.doesNotMatch(single.body.text, /<\|speaker/);

  const multi = buildFishPayload([
    { segment: segment(1, '蓝蓝的天空上有红红的太阳。', { type: 'narration' }), voiceId: 'v-narrator' },
    { segment: segment(2, '你怎么来了？', { emotion: 'surprise', intensity: 1 }), voiceId: 'v-taro' },
    { segment: segment(3, '那就一起吧。'), voiceId: 'v-taro' },
    { segment: segment(4, '泰罗放下了杯子。', { type: 'narration' }), voiceId: 'v-narrator' },
  ], FISH);
  assert.deepEqual(multi.body.reference_id, ['v-narrator', 'v-taro']);
  assert.equal(multi.body.text, '<|speaker:0|>蓝蓝的天空上有红红的太阳。\n<|speaker:1|>[surprised] 你怎么来了？\n那就一起吧。\n<|speaker:0|>泰罗放下了杯子。');
  assert.deepEqual(multi.spans.map(span => span.text), ['蓝蓝的天空上有红红的太阳。', '你怎么来了？', '那就一起吧。', '泰罗放下了杯子。']);

  const plain = buildFishPayload([{ segment: segment(1, '好热！', { emotion: 'happy' }), voiceId: 'v' }], { ...FISH, format: 'opus' }, { emotionCues: false });
  assert.equal(plain.body.text, '好热！');
  assert.equal('mp3_bitrate' in plain.body, false);
  assert.throws(() => buildFishPayload(multi.spans.map((span, index) => ({ segment: segment(span.id, span.text), voiceId: `v${index % 2}` })), { ...FISH, model: 's1' }), /s1/);
});

test('a floor is split into requests by voice on S1 and by size on every model', () => {
  const items = ['一二三四五', '六七八', '九十', '十一十二'].map((text, index) => ({
    segment: { id: index + 1, text }, voiceId: index === 2 ? 'b' : 'a',
  }));
  assert.deepEqual(planFishParts(items, { model: 's2-pro', maxChars: 100 }).map(part => part.map(item => item.segment.id)), [[1, 2, 3, 4]]);
  assert.deepEqual(planFishParts(items, { model: 's1', maxChars: 100 }).map(part => part.map(item => item.segment.id)), [[1, 2], [3], [4]]);
  assert.deepEqual(planFishParts(items, { model: 's2-pro', maxChars: 8 }).map(part => part.map(item => item.segment.id)), [[1, 2], [3, 4]]);
});

test('the SSE parser survives frames split anywhere, CRLF line ends and comments', () => {
  const payloads = [
    { audio_base64: 'QUJD', content: '甲', alignment: null, chunk_seq: 0, chunk_audio_offset_sec: 0 },
    { audio_base64: 'REVG', content: '甲', alignment: { audio_duration: 1, segments: [{ text: '甲', start: 0, end: 1 }] }, chunk_seq: 0, chunk_audio_offset_sec: 0 },
  ];
  const wire = `: keep-alive\r\n\r\n${payloads.map(item => `event: message\r\ndata: ${JSON.stringify(item)}\r\n\r\n`).join('')}`;
  for (const size of [1, 2, 3, 7, 50, wire.length]) {
    const events = [];
    const parser = createSseParser(event => events.push(event));
    for (let index = 0; index < wire.length; index += size) parser.push(wire.slice(index, index + size));
    parser.end();
    assert.equal(events.length, 2, `chunk size ${size}`);
    assert.deepEqual(events.map(event => JSON.parse(event.data).audio_base64), ['QUJD', 'REVG']);
    assert.equal(events[0].event, 'message');
  }
  const multiline = [];
  const parser = createSseParser(event => multiline.push(event.data));
  parser.push('data: {"a":\ndata: 1}\n\n');
  parser.end();
  assert.deepEqual(JSON.parse(multiline[0]), { a: 1 });
});

test('alignment snapshots replace each other per chunk and chunks sit on one timeline', () => {
  const collector = createTimestampCollector();
  collector.accept({ audio_base64: 'AA==', alignment: { audio_duration: 4, segments: LIVE_MULTI_CHUNK0.slice(0, 16) }, chunk_seq: 0, chunk_audio_offset_sec: 0 });
  collector.accept({ audio_base64: 'AQ==', alignment: { audio_duration: 4.31891156462585, segments: LIVE_MULTI_CHUNK0 }, chunk_seq: 0, chunk_audio_offset_sec: 0 });
  collector.accept({ audio_base64: 'Ag==', alignment: { audio_duration: 1.7690249433106575, segments: LIVE_MULTI_CHUNK1 }, chunk_seq: 1, chunk_audio_offset_sec: 4.31891156462585 });
  const { audio, alignments, events } = collector.result();
  assert.equal(events, 3);
  assert.deepEqual(audio, ['AA==', 'AQ==', 'Ag==']);
  assert.equal(alignments.get(0).segments.length, 17, 'the newer snapshot wins');
  const { timeline, duration } = buildGlobalTimeline(alignments);
  assert.equal(timeline.length, 24);
  assert.equal(timeline[17].text, '泰');
  assert.ok(Math.abs(timeline[17].start - 4.47891156462585) < 1e-9);
  assert.ok(Math.abs(duration - 6.0879365079365075) < 1e-9);
});

test('sentences find their place in real Fish alignment, pauses and punctuation included', () => {
  const single = alignSpansToTimeline([
    { id: 1, text: '蓝蓝的天空上有红红的太阳。' },
    { id: 2, text: '我操好热啊！' },
    { id: 3, text: '然后泰罗喝了口水。' },
  ], LIVE_SINGLE, { duration: 9.427301587301587 });
  assert.deepEqual(single, [
    { id: 1, start: 0, end: 2.32, coverage: 1 },
    { id: 2, start: 2.88, end: 7.12, coverage: 1 },
    { id: 3, start: 7.92, end: 9.28, coverage: 1 },
  ]);

  const alignments = new Map([
    [0, { offset: 0, duration: 4.31891156462585, segments: LIVE_MULTI_CHUNK0 }],
    [1, { offset: 4.31891156462585, duration: 1.7690249433106575, segments: LIVE_MULTI_CHUNK1 }],
  ]);
  const { timeline, duration } = buildGlobalTimeline(alignments);
  const multi = alignSpansToTimeline([
    { id: 1, text: '蓝蓝的天空上有红红的太阳。' },
    { id: 2, text: '你怎么来了？' },
    { id: 3, text: '泰罗放下了杯子。' },
  ], timeline, { duration });
  assert.deepEqual(multi.map(item => [item.id, item.start, item.end]), [[1, 0, 2.96], [2, 3.2, 4.16], [3, 4.479, 5.839]]);
});

test('alignment resynchronises past numbers read as words and gives a lost sentence the gap', () => {
  const timeline = [...'他花了一百二十三元', ...'好的', ...'走吧'].map((text, index) => ({ text, start: index * 0.2, end: index * 0.2 + 0.18 }));
  const result = alignSpansToTimeline([
    { id: 1, text: '他花了123元。' },
    { id: 2, text: '「……」' },
    { id: 3, text: '好的。' },
    { id: 4, text: '12' },
    { id: 5, text: '走吧！' },
  ], timeline, { duration: 2.6 });
  assert.equal(result[0].start, 0);
  assert.equal(result[0].end, 1.78, 'the sentence runs to 元 after the digits were read as words');
  assert.equal(result[2].start, 1.8);
  assert.equal(result[2].end, 2.18);
  assert.equal(result[1].interpolated, true);
  assert.equal(result[3].interpolated, true);
  assert.ok(result[3].start >= result[2].end && result[3].end <= result[4].start);
  assert.equal(result[4].start, 2.2);
});

test('a sentence replays with a little air, never reaching into its neighbours', () => {
  const entries = [
    { id: 1, part: 0, start: 0, end: 2.32 },
    { id: 2, part: 0, start: 2.88, end: 7.12 },
    { id: 3, part: 0, start: 7.2, end: 9.28 },
    { id: 4, part: 1, start: 0.1, end: 1.5 },
  ];
  assert.deepEqual(playbackWindow(entries, 0, 9.43), { part: 0, start: 0, end: 2.67 });
  assert.deepEqual(playbackWindow(entries, 1, 9.43), { part: 0, start: 2.8, end: 7.2 });
  assert.deepEqual(playbackWindow(entries, 2, 9.43), { part: 0, start: 7.12, end: 9.43 });
  assert.deepEqual(playbackWindow(entries, 3, 1.7), { part: 1, start: 0.02, end: 1.7 });
});

test('cache keys change with text, voice, mood and sound settings, and not with credentials', async () => {
  const segment = { id: 2, type: 'dialogue', text: '好热！', speaker: '泰罗', emotion: 'happy', intensity: 1 };
  const fingerprint = fishFingerprint(FISH);
  const base = { floorId: 'chat|3|0', segment, voiceId: 'voice-b', fingerprint };
  const key = await sentenceCacheKey(base);
  assert.equal(await sentenceCacheKey(structuredClone(base)), key);
  assert.notEqual(await sentenceCacheKey({ ...base, segment: { ...segment, text: '好热啊！' } }), key);
  assert.notEqual(await sentenceCacheKey({ ...base, voiceId: 'voice-c' }), key);
  assert.notEqual(await sentenceCacheKey({ ...base, segment: { ...segment, emotion: 'angry' } }), key);
  assert.notEqual(await sentenceCacheKey({ ...base, fingerprint: fishFingerprint({ ...FISH, speed: 1.2 }) }), key);
  assert.equal(await sentenceCacheKey({ ...base, fingerprint: fishFingerprint({ ...FISH, key: 'other', baseUrl: 'https://relay.example' }) }), key);

  const items = [{ segment, voiceId: 'voice-b' }];
  const floor = await floorCacheKey({ floorId: 'chat|3|0', version: 'v1', range: 'all', maxChars: 1500, items, fingerprint });
  assert.notEqual(await floorCacheKey({ floorId: 'chat|3|0', version: 'v1', range: 'dialogue', maxChars: 1500, items, fingerprint }), floor);
  assert.notEqual(await floorCacheKey({ floorId: 'chat|4|0', version: 'v1', range: 'all', maxChars: 1500, items, fingerprint }), floor);
  const utterances = splitUtterances([{ lineId: 1, text: '「好热！」' }]);
  assert.notEqual(await analysisCacheKey({ utterances, roster: ['泰罗'], source: 'model' }), await analysisCacheKey({ utterances, roster: ['佐菲'], source: 'model' }));
});

test('Fish failures read as something a reader can act on', () => {
  assert.match(describeFishFailure({ status: 402, body: '{"status":402,"message":"Insufficient API credit."}' }), /余额不足.*s2\.1-pro-free/);
  // The host proxy turns 401 into 400; the body keeps the real status.
  assert.match(describeFishFailure({ status: 400, body: '{"status":401,"message":"this route requires an api-key or Authorization: Bearer <api key> header"}' }), /API Key/);
  assert.match(describeFishFailure({ status: 404, body: 'CORS proxy is disabled. Enable it in config.yaml or use the --corsProxy flag.' }), /enableCorsProxy/);
  assert.match(describeFishFailure({ status: 403, body: 'Invalid CSRF token. Please refresh the page and try again.' }), /CSRF/);
  assert.match(describeFishFailure({ network: true, viaProxy: false }), /跨域/);
  assert.match(describeFishFailure({ status: 429, body: '' }), /限流/);
});

test('requests go through the host proxy with its headers, and direct calls carry none of them', () => {
  const proxied = { ...FISH, key: 'sk-test' };
  assert.equal(fishEndpoint(proxied, '/v1/tts'), '/proxy/https://api.fish.audio/v1/tts');
  assert.deepEqual(fishHeaders(proxied, { 'X-CSRF-Token': 'host-token' }), {
    'X-CSRF-Token': 'host-token', 'Content-Type': 'application/json', Authorization: 'Bearer sk-test', model: 's2-pro',
  });
  const direct = { ...proxied, viaProxy: false, baseUrl: 'http://127.0.0.1:8080' };
  assert.equal(fishEndpoint(direct, '/v1/tts'), 'http://127.0.0.1:8080/v1/tts');
  assert.equal('X-CSRF-Token' in fishHeaders(direct, { 'X-CSRF-Token': 'host-token' }), false);
});

test('utterances are found on the rendered floor after markdown and quote wrapping', () => {
  // The host's rendering: source paragraph, then the translation with 「…」 inside <q> and *emphasis*
  // turned into <em>. The source shares kanji with the translation on purpose.
  const nodes = ['太陽が暑い。泰罗は水を飲んだ。', '\n', '蓝蓝的天空上有红红的太阳，泰罗说：', '「我操', '好热啊！」', '，然后泰罗', '喝了口水', '\n', '泰罗'];
  const lines = [{ lineId: 1, text: '蓝蓝的天空上有红红的太阳，泰罗说：「我操*好热*啊！」，然后泰罗喝了口水' }, { lineId: 2, text: '泰罗' }];
  const utterances = splitUtterances(lines);
  const found = locateAnchors(nodes, lines, utterances.map(item => ({ id: item.id, lineId: item.lineId, text: item.anchor })));
  assert.deepEqual(found.get(1), { start: { node: 2, offset: 0 }, end: { node: 2, offset: 17 } });
  assert.deepEqual(found.get(2), { start: { node: 3, offset: 0 }, end: { node: 4, offset: 5 } });
  assert.deepEqual(found.get(3), { start: { node: 5, offset: 0 }, end: { node: 6, offset: 4 } });
  assert.deepEqual(found.get(4), { start: { node: 8, offset: 0 }, end: { node: 8, offset: 2 } }, 'the short line does not latch onto the source above');
});

test('tag fallback reads literal jy-translation blocks and sheds markup and boundaries', () => {
  const mes = '<story>原文</story>\n<jy-translation>\u2063\u200c\u2063蓝蓝的天空\n<span class="jy-spk" style="color:red">「好热！」</span>\u2063\u200b\u2063</jy-translation>\n<jy-translation>你&amp;我</jy-translation>';
  assert.deepEqual(linesFromTaggedText(mes, ['jy-translation']), [
    { lineId: 1, text: '蓝蓝的天空' },
    { lineId: 2, text: '「好热！」' },
    { lineId: 3, text: '你&我' },
  ]);
});

test('read-aloud settings normalise, clamp and follow the character card', () => {
  const settings = mergeSettings({
    tts: {
      enabled: true, mode: 'sentence', range: 'dialogue', analysis: 'bogus', narratorVoice: '99c6e180c87c4d5fb506534e7ac62ced',
      fish: { model: 'gpt', speed: 9, maxChars: 5, viaProxy: false, baseUrl: 'ftp://nope', key: '  sk-x  ' },
    },
    ttsVoices: { 'card.png': [{ name: '泰罗', voiceId: 'abc' }, { name: '' }], empty: [] },
  });
  assert.equal(settings.tts.enabled, true);
  assert.equal(settings.tts.mode, 'sentence');
  assert.equal(settings.tts.range, 'dialogue');
  assert.equal(settings.tts.analysis, DEFAULT_TTS.analysis);
  assert.equal(settings.tts.fish.model, 's2-pro');
  assert.equal(settings.tts.fish.speed, 2);
  assert.equal(settings.tts.fish.maxChars, 200);
  assert.equal(settings.tts.fish.viaProxy, false);
  assert.equal(settings.tts.fish.baseUrl, 'https://api.fish.audio');
  assert.equal(settings.tts.fish.key, 'sk-x');
  assert.deepEqual(settings.ttsVoices, { 'card.png': [{ name: '泰罗', aliases: [], voiceId: 'abc', title: '' }] });
  assert.deepEqual(mergeSettings({}).tts, normalizeTts(undefined));
  assert.deepEqual(mergeSettings({}).tts.sourceTags, ['jy-translation']);
  // Ordinary mode is the default: nothing about reading aloud is on until someone turns it on.
  assert.equal(mergeSettings({}).tts.enabled, false);
  assert.equal(mergeSettings({}).tts.side, 'translation');
  assert.equal(mergeSettings({ tts: { side: 'source' } }).tts.side, 'source');
  assert.equal(mergeSettings({ tts: { side: 'klingon' } }).tts.side, 'translation');
});

test('the cache evicts least recently used audio, prunes stale floor versions and clears by chat', async () => {
  let clock = 0;
  const store = createTtsStore({ indexedDB: null, maxBytes: 10, now: () => ++clock });
  const blob = size => ({ size });
  await store.putAudio({ key: 'a', floorId: 'chat1|1|0', version: 'v1', parts: [{ blob: blob(4) }] });
  await store.putAudio({ key: 'b', floorId: 'chat1|2|0', version: 'v1', parts: [{ blob: blob(4) }] });
  await store.getAudio('a');
  await store.putAudio({ key: 'c', floorId: 'chat2|1|0', version: 'v1', parts: [{ blob: blob(4) }] });
  assert.equal(await store.getAudio('b'), null, 'b was the least recently used');
  assert.ok(await store.getAudio('a'));
  assert.equal((await store.usage()).bytes, 8);

  await store.putAnalysis({ key: 'x', floorId: 'chat1|1|0', version: 'v1', labels: [] });
  await store.putAnalysis({ key: 'y', floorId: 'chat1|1|0', version: 'v2', labels: [] });
  assert.equal(await store.pruneFloor('chat1|1|0', 'v2'), 2, 'only the old version of this floor goes');
  assert.ok(await store.getAnalysis('y'));
  assert.equal(await store.getAudio('a'), null);
  assert.equal(await store.getAnalysis('x'), null);
  assert.equal(await store.clearChat('chat2'), 1);
  assert.equal((await store.usage()).entries, 0);
  assert.deepEqual(planEviction([{ key: 'k', bytes: 5, usedAt: 1 }], 10), []);
});

test('a provider key quoted back in an error never reaches the log, safe summary included', () => {
  const values = new Map();
  const adapter = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  addDiagnostic({
    level: 'error',
    scope: 'tts.request-failed',
    message: 'Fish 返回错误：invalid token sk-fish-X-abcdefghijklmnop1234',
    details: { echoed: 'rejected sk-fish-abcdefghijklmnopqrstu', status: 401 },
  }, adapter);
  const [entry] = readDiagnostics(adapter);
  assert.doesNotMatch(JSON.stringify(entry), /sk-fish-/);
  assert.equal(entry.details.status, 401);
  clearDiagnostics(adapter);
});

test('a refused IndexedDB falls back to memory for the rest of the session', async () => {
  const refusing = { open() { throw new Error('SecurityError'); } };
  const store = createTtsStore({ indexedDB: refusing });
  await store.putAudio({ key: 'k', floorId: 'c|1|0', version: 'v', parts: [{ blob: { size: 3 } }] });
  assert.equal(store.backendName, 'memory');
  assert.match(store.note, /本次会话/);
  assert.ok(await store.getAudio('k'));
  const memory = createMemoryBackend();
  await memory.put('audio', { key: 'z' });
  assert.equal((await memory.all('audio')).length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_TTS, formatPairList, mergeSettings, normalizeTts, normalizeVoiceLibrary, normalizeVoiceList, parsePairList } from '../core.js';
import {
  FISH_EMOTIONS,
  SOUND_TAGS,
  FISH_TONES,
  NARRATOR,
  alignSpansToTimeline,
  analysisCacheKey,
  annotationReading,
  buildFishPayload,
  buildGlobalTimeline,
  buildSegments,
  buildTtsAnalysisMessages,
  compileVoiceCues,
  consoleDirections,
  createSseParser,
  createTimestampCollector,
  cueLabel,
  deriveLabelsForSide,
  describeFishFailure,
  detectLanguage,
  emotionCue,
  findCoveringEntry,
  fingerprintKey,
  fishEndpoint,
  fishFingerprint,
  fishHeaders,
  floorCacheKey,
  groupSegmentsByLine,
  labelsFromAnnotations,
  linesFromTaggedText,
  locateAnchors,
  mergeWavBuffers,
  normalizeVoice,
  parseTtsAnalysis,
  parseVoiceAnalysis,
  planFishParts,
  planVoices,
  plainLineText,
  playbackWindow,
  recordCovers,
  recordingCacheKey,
  resolveSegmentVoice,
  segmentsInRange,
  sentenceFishText,
  sentenceProsody,
  splitByPairs,
  splitNarrationSentences,
  splitUtterances,
  stripCues,
  tamePunctuationMarks,
  toStandardDocument,
  voiceSummary,
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

test('the reader chooses which marks hold speech and which hold what is never read', () => {
  // A preset that writes actions between asterisks and speech between curly quotes.
  const line = '泰罗说：“真的好热啊” *好想裸奔* 然后他站了起来。';
  const parts = splitByPairs(line, { quotePairs: ['“”'], skipPairs: ['* *'] });
  assert.deepEqual(parts.map(part => [part.kind, part.text]), [
    ['narration', '泰罗说：'], ['quoted', '“真的好热啊”'], ['narration', ' '], ['skipped', '*好想裸奔*'], ['narration', ' 然后他站了起来。'],
  ]);
  const utterances = splitUtterances([{ lineId: 1, text: line }], { quotePairs: ['“”'], skipPairs: ['* *'] });
  assert.deepEqual(utterances.map(item => [item.kind, item.text]), [['narration', '泰罗说：'], ['quoted', '真的好热啊'], ['narration', '然后他站了起来。']]);
  // With the default pairs the asterisks mean nothing and the run is read as narration.
  assert.deepEqual(splitUtterances([{ lineId: 1, text: line }]).map(item => item.kind), ['narration', 'quoted', 'narration']);
  // Double asterisks are their own pair when written with a space; nesting of an asymmetric pair holds.
  assert.deepEqual(splitByPairs('**加粗**「他说「好」了」', { quotePairs: ['「」'], skipPairs: ['** **'] }).map(part => [part.kind, part.text]), [
    ['skipped', '**加粗**'], ['quoted', '「他说「好」了」'],
  ]);
  // An unterminated opener is narration, not a guess.
  assert.deepEqual(splitByPairs('他说：“没有结尾', { quotePairs: ['“”'] }).map(part => part.kind), ['narration']);
  assert.deepEqual(parsePairList('「」, “”, ** **, x'), [{ open: '「', close: '」' }, { open: '“', close: '”' }, { open: '**', close: '**' }, { open: 'x', close: 'x' }]);
  assert.equal(formatPairList(['「」', '** **']), '「」, ** **');
});

test('the language of a sentence is read off its script, kana outranking han', () => {
  assert.equal(detectLanguage('蓝蓝的天空'), 'zh');
  assert.equal(detectLanguage('夕暮れの教室には、誰もいなかった。'), 'ja');
  assert.equal(detectLanguage('What a beautiful day.'), 'en');
  assert.equal(detectLanguage('안녕하세요'), 'ko');
  assert.equal(detectLanguage('Привет'), 'ru');
  assert.equal(detectLanguage('……'), '');
  assert.deepEqual(groupSegmentsByLine([{ id: 1, lineId: 1 }, { id: 2, lineId: 1 }, { id: 3, lineId: 2 }]).map(line => [line.lineId, line.segments.length]), [[1, 2], [2, 1]]);
});

test('the analysis request carries ids and never offers the model a place to return text', () => {
  const utterances = splitUtterances([{ lineId: 1, text: '泰罗说：「我操好热啊！」' }]);
  const messages = buildTtsAnalysisMessages(utterances, { roster: ['泰罗', '佐菲'], characterName: '泰罗', userName: '玩家' });
  assert.equal(messages.length, 2);
  const input = JSON.parse(messages[1].content);
  assert.equal(input.task, 'sketch_voices_for_audiobook');
  assert.deepEqual(input.roster, ['泰罗', '佐菲']);
  assert.deepEqual(input.emotions, FISH_EMOTIONS);
  assert.deepEqual(input.sounds, FISH_SOUND_LIST, 'the simple reading offers only the sounds Fish lists');
  assert.deepEqual(input.tones, FISH_TONE_LIST);
  assert.equal('styles' in input, false, 'no console set, none sent');
  assert.deepEqual(input.utterances, [{ id: 1, kind: 'narration', text: '泰罗说：' }, { id: 2, kind: 'quoted', text: '「我操好热啊！」' }]);
  assert.match(messages[0].content, /不要输出 text/);
  assert.doesNotMatch(messages[0].content, /direction/, 'the simple reading asks for no directions');
  assert.match(messages[0].content, /不要加 slightly、very 这类程度词/);
  assert.match(messages[0].content, /lang：这一句的语言代码/);
  assert.doesNotMatch(messages[0].content, /"text":/);
  // The consoles ride along as sentences under each name.
  const styled = JSON.parse(buildTtsAnalysisMessages(utterances, { styles: [{ name: '泰罗', rules: ['语速偏快：多用 fast，急的时候更快。'] }, { name: '', rules: ['x'] }] })[1].content);
  assert.deepEqual(styled.styles, [{ name: '泰罗', rules: ['语速偏快：多用 fast，急的时候更快。'] }]);
});

test('analysis labels are validated and any text the model sends back is ignored', () => {
  const utterances = splitUtterances([{ lineId: 1, text: '泰罗说：「我操好热啊！」' }, { lineId: 2, text: '「Sure.」' }]);
  const { labels } = parseTtsAnalysis(`好的：\n\`\`\`json\n${JSON.stringify({
    labels: [
      { id: 1, type: 'narration', text: '泰罗说：' },
      { id: 2, type: 'dialogue', speaker: '泰罗', emotion: 'angry', intensity: 5, text: '哎呀，真是热死我了！' },
      { id: 3, type: 'dialogue', speaker: '佐菲', emotion: 'happy', lang: 'en-US' },
      { id: 9, type: 'dialogue', speaker: '幽灵' },
      { id: 2, type: 'dialogue', speaker: '佐菲' },
      { id: 1, speaker: '未知' },
    ],
  })}\n\`\`\``, utterances);
  assert.deepEqual([...labels], [
    [1, { type: 'narration' }],
    [2, { type: 'dialogue', speaker: '泰罗', emotion: 'angry', intensity: 2 }],
    [3, { type: 'dialogue', speaker: '佐菲', emotion: 'happy', lang: 'en-US' }],
  ]);
  // A reply cut off mid-array still yields the objects that closed.
  const truncated = parseTtsAnalysis('{"labels":[{"id":1,"type":"narration"},{"id":2,"type":"dialogue","speaker":"泰罗","emo', utterances);
  assert.equal(truncated.labels.get(1)?.type, 'narration');
});

test('segments follow the standard structure: narrator for narration, unified speakers, null for neutral', () => {
  const utterances = splitUtterances([{ lineId: 1, text: '希尔达夫人说：「来了。」' }, { lineId: 2, text: '「Hello.」' }]);
  const labels = new Map([[2, { type: 'dialogue', speaker: '希尔达夫人', emotion: 'neutral' }], [3, { type: 'dialogue', speaker: '希尔达' }]]);
  const segments = buildSegments(utterances, labels, { knownNames: ['希尔达'] });
  assert.equal(segments[0].speaker, NARRATOR);
  assert.equal(segments[0].lang, 'zh');
  assert.equal(segments[1].speaker, '希尔达');
  assert.equal(segments[1].emotion, null);
  assert.equal(segments[2].speaker, '希尔达');
  assert.equal(segments[2].lang, 'en');
  const document = toStandardDocument(segments, [{ id: 2, start: 1.5, end: 2.25 }]);
  assert.deepEqual(document.segments[1], { id: 'seg_002', type: 'dialogue', text: '来了。', speaker: '希尔达', lang: 'zh', emotion: null, start: 1.5, end: 2.25 });
  assert.deepEqual(segmentsInRange(segments, 'dialogue').map(item => item.id), [2, 3]);
  assert.deepEqual(segmentsInRange(segments, 'narration').map(item => item.id), [1]);
});

test('translation annotations label only the quoted runs of their line', () => {
  const utterances = splitUtterances([{ lineId: 4, text: '泰罗说：「走吧。」' }]);
  const labels = labelsFromAnnotations(utterances, new Map([[4, { speaker: '泰罗', emotion: 'resolute', intensity: 2 }]]));
  assert.deepEqual([...labels], [[2, { type: 'dialogue', speaker: '泰罗', emotion: 'resolute', intensity: 2 }]]);
});

test('voices resolve by name, alias, language and lock; nobody is left silent', () => {
  const voices = normalizeVoiceList([
    { name: '泰罗', aliases: ['泰罗奥特曼'], voiceId: 'v-taro', voices: { ja: 'v-taro-ja' } },
    { name: '佐菲', voiceId: '', locked: false },
  ]);
  const config = { voices, narratorVoice: 'v-narr', narratorVoices: { ja: 'v-narr-ja' }, dialogueVoice: 'v-default' };
  const dialogue = (speaker, lang = 'zh') => ({ type: 'dialogue', speaker, lang });
  assert.equal(resolveSegmentVoice(dialogue('泰罗'), config), 'v-taro');
  assert.equal(resolveSegmentVoice(dialogue('泰罗奥特曼'), config), 'v-taro');
  assert.equal(resolveSegmentVoice(dialogue('泰罗', 'ja'), config), 'v-taro-ja');
  assert.equal(resolveSegmentVoice(dialogue('泰罗', 'en'), config), 'v-taro', 'no voice for that language falls back to the character\'s own');
  // Accents: the exact tag, then the plain language, then any accent of it.
  const accented = normalizeVoiceList([{ name: '爱丽丝', voiceId: 'v-alice', voices: { 'en-US': 'v-us', 'en-GB': 'v-gb', 'en': 'v-en' } }]);
  const accents = { voices: accented, narratorVoice: '', narratorVoices: { 'en-GB': 'v-narr-gb' }, dialogueVoice: 'v-default' };
  assert.equal(resolveSegmentVoice(dialogue('爱丽丝', 'en-GB'), accents), 'v-gb');
  assert.equal(resolveSegmentVoice(dialogue('爱丽丝', 'en-AU'), accents), 'v-en', 'an accent nobody bound takes the plain language');
  assert.equal(resolveSegmentVoice(dialogue('爱丽丝', 'en'), accents), 'v-en');
  const usOnly = { ...accents, voices: normalizeVoiceList([{ name: '爱丽丝', voiceId: 'v-alice', voices: { 'en-US': 'v-us' } }]) };
  assert.equal(resolveSegmentVoice(dialogue('爱丽丝', 'en'), usOnly), 'v-us', 'plain English reaches the one accent bound');
  assert.equal(resolveSegmentVoice(dialogue('爱丽丝', 'en-GB'), usOnly), 'v-us', 'a sibling accent is closer than the character\'s own voice');
  assert.equal(resolveSegmentVoice(dialogue('爱丽丝', 'de'), usOnly), 'v-alice');
  assert.equal(resolveSegmentVoice({ type: 'narration', lang: 'en' }, accents), 'v-narr-gb');
  assert.equal(resolveSegmentVoice({ type: 'narration', lang: 'ja' }, accents), 'v-default');
  assert.equal(resolveSegmentVoice(dialogue('佐菲'), config), 'v-default', 'an unlocked row follows the dialogue default');
  assert.equal(resolveSegmentVoice({ type: 'narration', lang: 'zh' }, config), 'v-narr');
  assert.equal(resolveSegmentVoice({ type: 'narration', lang: 'ja' }, config), 'v-narr-ja');
  assert.equal(resolveSegmentVoice(dialogue('路人'), { voices, narratorVoice: 'v-narr' }), 'v-narr', 'no dialogue default: the narrator reads it');
  assert.equal(resolveSegmentVoice(dialogue('路人'), { voices }), '', 'nothing configured means the provider\'s default voice');

  const plan = planVoices([
    { id: 1, type: 'dialogue', speaker: '佐菲', text: '来了。', lang: 'zh' },
    { id: 2, type: 'narration', speaker: NARRATOR, text: '风很大。', lang: 'zh' },
    { id: 3, type: 'dialogue', speaker: '泰罗', text: '走吧。', lang: 'zh' },
  ], { voices, narratorVoice: '', narratorVoices: {}, dialogueVoice: '' });
  assert.equal(plan.items.length, 3, 'every sentence keeps its place');
  assert.deepEqual(plan.items.map(item => item.voiceId), ['', '', 'v-taro']);
  assert.deepEqual(plan.unvoiced, ['佐菲', '旁白']);
  assert.deepEqual(plan.defaulted, []);
});

test('rows lock when they get a voice and unlock when it is taken away', () => {
  const rows = normalizeVoiceList([{ name: 'A', voiceId: 'v' }, { name: 'B' }, { name: 'C', voices: { ja: 'v-ja' } }, { name: 'D', voiceId: 'v', locked: false }]);
  assert.deepEqual(rows.map(row => [row.name, row.locked]), [['A', true], ['B', false], ['C', true], ['D', false]]);
  assert.deepEqual(rows[2].voices, { ja: 'v-ja' });
  const library = normalizeVoiceLibrary([{ name: '少年', voiceId: '99c6e180c87c4d5fb506534e7ac62ced', lang: 'ZH-cn' }, { name: 'x', voiceId: 'bad id' }, { id: 'k', voiceId: 'abc', lang: 'en_gb' }, { id: 'j', voiceId: 'def', lang: 'english' }]);
  assert.deepEqual(library.map(item => [item.id, item.name, item.lang]), [['voice-1', '少年', 'zh-CN'], ['k', 'abc', 'en-GB'], ['j', 'def', '']]);
});

test('moods become Fish cues: brackets for S2, the fixed parenthesised set for S1', () => {
  assert.equal(emotionCue('happy', 1, 's2-pro'), '[happy]');
  assert.equal(emotionCue('开心', 2, 's2.1-pro'), '[delighted]');
  assert.equal(emotionCue('whisper', 0, 's2-pro'), '[soft tone]');
  assert.equal(emotionCue('angry', 2, 's1'), '(angry)(shouting)');
  assert.equal(emotionCue('neutral', 2, 's2-pro'), '');
  assert.equal(emotionCue('nonsense', 1, 's2-pro'), '[nonsense]', 'S2 reads free-form natural language');
  assert.equal(emotionCue('nonsense', 1, 's1'), '', 'S1 only knows its fixed set');
  // Fish's own vocabulary keeps Fish's own scale.
  assert.equal(emotionCue('frustrated', 2, 's2-pro'), '[very frustrated]');
  assert.equal(emotionCue('scared', 0, 's2-pro'), '[nervous]');
  assert.equal(emotionCue('excited', 2, 's2-pro'), '[ecstatic]');
  assert.equal(cueLabel('frustrated'), '沮丧');
  assert.equal(cueLabel('very sad'), '很悲伤');
  assert.equal(cueLabel('tender'), '温柔');
});

test('the deep request carries the cast, the references and the voice fields, still without text', () => {
  const utterances = splitUtterances([{ lineId: 1, text: '泰罗压低了声音：「我……我要裸奔啦。」' }]);
  const messages = buildVoiceAnalysisMessages(utterances, {
    roster: ['泰罗'], characterName: '泰罗', userName: '玩家',
    packet: { character: '泰罗：怕热，嘴硬。', worldbook: '教室没有空调。', recent: '【第 3 楼】泰罗擦汗。' },
  });
  const input = JSON.parse(messages[1].content);
  assert.equal(input.task, 'direct_voices_for_audiobook');
  assert.deepEqual(input.references, { character: '泰罗：怕热，嘴硬。', worldbook: '教室没有空调。', recent: '【第 3 楼】泰罗擦汗。' });
  assert.deepEqual(input.emotions, FISH_EMOTIONS);
  assert.deepEqual(input.utterances.map(item => item.text), ['泰罗压低了声音：', '「我……我要裸奔啦。」']);
  for (const field of ['why', 'intensity', 'tone', 'pauses', 'shift', 'sounds', 'speed', 'volume', 'skeleton', 'previous', 'styles']) assert.match(messages[0].content, new RegExp(field));
  for (const gone of ['trend', 'pitch', 'energy', 'rhythm', 'ending', 'urgency', 'delivery', 'focus']) assert.doesNotMatch(messages[0].content, new RegExp(`- ${gone}`));
  assert.match(messages[0].content, /不是惯性/);
  assert.match(messages[0].content, /省力原则/);
  assert.match(messages[0].content, /不要输出 text/);
  assert.equal('skeleton' in input, false);
  assert.deepEqual(input.sounds, FISH_SOUND_LIST, 'the sounds Fish lists itself');
  assert.deepEqual(input.tones, FISH_TONE_LIST);
  // The translation's own labels ride along as the skeleton, and a custom prompt replaces the built-in one.
  const hinted = buildVoiceAnalysisMessages(utterances, { userName: '玩家', hints: new Map([[2, { type: 'dialogue', speaker: '泰罗', emotion: 'shy', intensity: 1 }]]), systemPrompt: '自定义提示词，{{user}}标签：{{sounds}}' });
  assert.deepEqual(JSON.parse(hinted[1].content).skeleton, [{ id: 2, speaker: '泰罗', emotion: 'shy', intensity: 1 }]);
  assert.equal(hinted[0].content, `自定义提示词，用户扮演的角色叫 玩家。标签：${SOUND_TAGS.join(' / ')}`);
  // What the speakers said last, and the consoles, ride along too.
  const rich = JSON.parse(buildVoiceAnalysisMessages(utterances, { previous: [{ speaker: '泰罗', text: '不热。', direction: '嘴硬' }, { speaker: '', text: 'x' }], styles: [{ name: '默认', rules: ['停顿感强'] }] })[1].content);
  assert.deepEqual(rich.previous, [{ speaker: '泰罗', text: '不热。', direction: '嘴硬' }]);
  assert.deepEqual(rich.styles, [{ name: '默认', rules: ['停顿感强'] }]);
});

test('the deep reply becomes labels plus a checked voice per sentence', () => {
  const utterances = splitUtterances([{ lineId: 1, text: '泰罗压低了声音：「我……我要裸奔啦。」' }]);
  const reply = JSON.stringify({
    scene: '闷热的教室，放学后。',
    characters: [{ name: '泰罗', state: '热得快疯了', habit: '句尾拖长' }],
    voices: [
      { id: 1, type: 'narration' },
      {
        id: 2, type: 'dialogue', speaker: '泰罗', lang: 'zh', emotion: 'Frustrated', secondary: 'embarrassed', intensity: 2, trend: 'rising',
        state: '又热又躁', intent: '抱怨', subtext: '想让人拦着', restraint: 2, speed: 'fast', pitch: 'high', volume: 'quiet', energy: 2, tension: 2,
        breath: 'panting', rasp: 0, hesitation: 2, rhythm: 'choppy', ending: 'cut', urgency: 1,
        pauses: [{ after: '我', length: 'long' }, { after: '不存在的词', length: 'short' }],
        stress: ['裸奔', '也不存在'], shifts: [{ at: '我要', emotion: 'shy' }], sounds: [{ at: 'start', tag: 'sighing' }, { at: 'end', tag: 'nonsense' }],
        delivery: '崩溃式抱怨', focus: '热', text: '哎呀热死了',
      },
    ],
  });
  const { labels, voices } = parseVoiceAnalysis(reply, utterances);
  assert.deepEqual(labels.get(1), { type: 'narration' });
  // The label carries the palette's fold of the word, for the colouring's vocabulary; the voice keeps the word.
  assert.deepEqual(labels.get(2), { type: 'dialogue', speaker: '泰罗', emotion: 'angry', intensity: 2, lang: 'zh' });
  const voice = voices.get(2);
  assert.equal(voice.emotion, 'frustrated');
  assert.equal(voice.secondary, 'embarrassed');
  assert.equal(voice.restraint, 2);
  assert.deepEqual(voice.pauses, [{ after: '我', length: 'long' }], 'a pause after a word the sentence lacks is dropped');
  assert.deepEqual(voice.stress, ['裸奔']);
  assert.deepEqual(voice.shifts, [{ at: '我要', emotion: 'shy' }]);
  assert.deepEqual(voice.sounds, [{ at: 'start', tag: 'sighing' }], 'a sound that is neither one of Fish\'s nor a short Chinese word is dropped');
  assert.equal('trend' in voice, false, 'fields that never became a cue are no longer kept');
  assert.equal('state' in voice, false);
  assert.equal(voices.get(1), undefined, 'a plain narration line carries no voice');
  assert.equal(normalizeVoice({ speed: 'normal', volume: 'normal', intensity: 'x' }, ''), null);

  const segments = buildSegments(utterances, labels, { voices });
  assert.equal(segments[1].emotion, 'frustrated');
  assert.equal(segments[1].intensity, 2);
  assert.equal(segments[1].voice.subtext, '想让人拦着');
  const summary = voiceSummary(segments[1].voice);
  assert.deepEqual(summary[0], ['情绪', '沮丧（强） · 难为情']);
  assert.ok(summary.some(([term, value]) => term === '停顿' && value === '「我」后长停'));
  assert.ok(summary.some(([term, value]) => term === '潜台词' && value === '想让人拦着'));

  // Hints: an id alone, or a sentence left out, keeps the translation's own label; a partial answer
  // keeps the hint's speaker under the model's mood (folded onto the palette in the label).
  const hints = new Map([[1, { type: 'narration' }], [2, { type: 'dialogue', speaker: '泰罗', emotion: 'shy', intensity: 1 }]]);
  const lean = parseVoiceAnalysis('{"voices":[{"id":1},{"id":2,"emotion":"frustrated","intensity":2}]}', utterances, { hints });
  assert.deepEqual(lean.labels.get(1), { type: 'narration' });
  assert.deepEqual(lean.labels.get(2), { type: 'dialogue', speaker: '泰罗', emotion: 'angry', intensity: 2 });
  assert.equal(lean.voices.get(2).emotion, 'frustrated');
  assert.equal(lean.reused, 1);
  const silent = parseVoiceAnalysis('{"voices":[]}', utterances, { hints });
  assert.equal(silent.labels.size, 2, 'sentences the model skipped keep their hints');
  assert.equal(silent.reused, 2);
});

test('the other language of a floor is labelled from the one that was read', () => {
  const primary = splitUtterances([{ lineId: 1, text: '樱井回过头，「你来了啊」，轻轻笑了一下。' }, { lineId: 2, text: '「明天见。」' }]);
  const labels = new Map([[2, { type: 'dialogue', speaker: '樱井', emotion: 'happy', lang: 'zh' }], [4, { type: 'dialogue', speaker: '樱井', emotion: 'tender' }]]);
  const voices = new Map([[2, { emotion: 'happy', intensity: 1, stress: ['来'], pauses: [{ after: '你', length: 'short' }], speed: 'slow' }]]);
  const other = splitUtterances([{ lineId: 1, text: '桜井は振り返って、「来たんだね」と小さく笑った。' }, { lineId: 2, text: '「また明日。」' }]);
  const derived = deriveLabelsForSide(primary, labels, voices, other);
  assert.deepEqual(derived.labels.get(2), { type: 'dialogue', speaker: '樱井', emotion: 'happy' }, 'the language does not carry over');
  assert.deepEqual(derived.labels.get(4), { type: 'dialogue', speaker: '樱井', emotion: 'tender' });
  assert.deepEqual(derived.voices.get(2), { emotion: 'happy', intensity: 1, speed: 'slow' }, 'word-bound cues stay with their own text');
  assert.equal(derived.labels.has(1), false);
});

test('runs of exclamation marks are tamed in what Fish is sent, never in what is aligned', () => {
  assert.equal(tamePunctuationMarks('吵死了!!!笨蛋真嗣!!! 看前面!?'), '吵死了!笨蛋真嗣! 看前面?!');
  assert.equal(tamePunctuationMarks('うるさいわね！！！　前だけ！？'), 'うるさいわね！　前だけ？！');
  assert.equal(tamePunctuationMarks('好～～～热'), '好～热');
  const item = { segment: { id: 1, type: 'dialogue', text: '吵死了!!!', emotion: 'angry', intensity: 2 }, voiceId: 'v' };
  assert.equal(sentenceFishText(item, FISH, { tamePunctuation: true }), '[furious] 吵死了!');
  assert.equal(sentenceFishText(item, FISH), '[furious] 吵死了!!!');
  const payload = buildFishPayload([item], FISH, { tamePunctuation: true });
  assert.equal(payload.body.text, '[furious] 吵死了!');
  assert.equal(payload.spans[0].text, '吵死了!!!');
  assert.notEqual(JSON.stringify(fishFingerprint(FISH, { tamePunctuation: true })), JSON.stringify(fishFingerprint(FISH)));
});

test('a voice compiles into leading cues, inline cues and prosody steps, and the words stay', () => {
  const segment = {
    id: 2, type: 'dialogue', text: '我……我要裸奔啦。', speaker: '泰罗', lang: 'zh', emotion: 'frustrated', intensity: 2,
    voice: {
      emotion: 'frustrated', secondary: 'embarrassed', intensity: 2, restraint: 2, speed: 'fast', volume: 'quiet', tension: 2, hesitation: 2, urgency: 1,
      pauses: [{ after: '我', length: 'long' }], stress: ['裸奔'], shifts: [{ at: '我要', emotion: 'shy' }], sounds: [{ at: 'start', tag: 'sighing' }, { at: 'end', tag: 'chuckling' }],
    },
  };
  const compiled = compileVoiceCues(segment, { model: 's2-pro' });
  assert.deepEqual(compiled.cues, ['[very frustrated]', '[embarrassed]', '[whispering]', '[sighing]'], 'four cues at most: the hesitant descriptor gives way to the sigh');
  assert.equal(compiled.text, '我 [long-break] …… [shy] 我要 [emphasis] 裸奔啦。');
  assert.equal(compiled.tail, '[chuckling]');
  assert.deepEqual([compiled.speed, compiled.volume], ['fast', 'quiet']);
  const item = { segment, voiceId: 'v' };
  assert.equal(sentenceFishText(item, { model: 's2-pro' }), '[very frustrated][embarrassed][whispering][sighing] 我 [long-break] …… [shy] 我要 [emphasis] 裸奔啦。 [chuckling]');
  assert.equal(stripCues(sentenceFishText(item, { model: 's2-pro' })).replace(/\s/g, ''), '我……我要裸奔啦。');
  // S1: only its fixed set, in parentheses, and no emphasis.
  const legacy = compileVoiceCues(segment, { model: 's1' });
  assert.deepEqual(legacy.cues, ['(frustrated)', '(embarrassed)', '(whispering)', '(sighing)']);
  assert.equal(legacy.text, '我 (long-break) …… (embarrassed) 我要裸奔啦。');
  // Cues off: the words alone, the prosody steps still known.
  assert.equal(sentenceFishText(item, { model: 's2-pro' }, { emotionCues: false }), '我……我要裸奔啦。');
  assert.deepEqual(sentenceProsody(item, { speed: 1, volume: 0 }), { speed: 1.12, volume: -3 });
  assert.deepEqual(sentenceProsody(item, { speed: 1, volume: 0 }, { prosodySplit: false }), { speed: 1, volume: 0 });
  // The reader's own version wins whole, prosody included.
  const edited = { ...item, override: { text: '[calm] 我要裸奔啦。', speed: 0.8, volume: 4 } };
  assert.equal(sentenceFishText(edited, { model: 's2-pro' }), '[calm] 我要裸奔啦。');
  assert.deepEqual(sentenceProsody(edited, { speed: 1, volume: 0 }), { speed: 0.8, volume: 4 });
  // A light label with no voice still gets its one cue.
  assert.deepEqual(compileVoiceCues({ text: '好热！', emotion: 'happy', intensity: 1 }).cues, ['[happy]']);
  assert.deepEqual(compileVoiceCues({ text: '好热！' }).cues, []);
});

test('the Fish payload uses one reference id alone, speaker tags where the voice changes, none when unvoiced', () => {
  const segment = (id, text, extra = {}) => ({ id, type: 'dialogue', text, speaker: null, emotion: null, intensity: null, lang: 'zh', ...extra });
  const single = buildFishPayload([{ segment: segment(1, '好热！', { emotion: 'happy', intensity: 1 }), voiceId: 'v-taro' }], FISH);
  assert.equal(single.body.text, '[happy] 好热！');
  assert.equal(single.body.reference_id, 'v-taro');
  assert.equal(single.body.mp3_bitrate, 128);
  assert.deepEqual(single.body.prosody, { speed: 1, volume: 0 });
  assert.doesNotMatch(single.body.text, /<\|speaker/);

  const multi = buildFishPayload([
    { segment: segment(1, '蓝蓝的天空上有红红的太阳。', { type: 'narration' }), voiceId: 'v-narrator' },
    { segment: segment(2, '你怎么来了？', { emotion: 'surprise', intensity: 1 }), voiceId: 'v-taro' },
    { segment: segment(3, '那就一起吧。'), voiceId: 'v-taro' },
    { segment: segment(4, '泰罗放下了杯子。', { type: 'narration' }), voiceId: 'v-narrator' },
  ], FISH);
  assert.equal(multi.body.text, '<|speaker:0|>蓝蓝的天空上有红红的太阳。\n<|speaker:1|>[surprised] 你怎么来了？\n那就一起吧。\n<|speaker:0|>泰罗放下了杯子。');
  assert.deepEqual(multi.body.reference_id, ['v-narrator', 'v-taro']);
  assert.deepEqual(multi.spans.map(span => span.text), ['蓝蓝的天空上有红红的太阳。', '你怎么来了？', '那就一起吧。', '泰罗放下了杯子。']);

  const unvoiced = buildFishPayload([{ segment: segment(1, '好热！'), voiceId: '' }], FISH);
  assert.equal('reference_id' in unvoiced.body, false, 'Fish picks its default voice');
  assert.throws(() => buildFishPayload([{ segment: segment(1, 'a'), voiceId: 'v' }, { segment: segment(2, 'b'), voiceId: '' }], FISH), /混用/);
  assert.throws(() => buildFishPayload([{ segment: segment(1, 'a'), voiceId: 'v-a' }, { segment: segment(2, 'b'), voiceId: 'v-b' }], { ...FISH, model: 's1' }), /s1/);
  // An edited sentence's span is the edited words with the cues taken off.
  const edited = buildFishPayload([{ segment: segment(1, '好热！'), voiceId: 'v', override: { text: '[calm] 好 [break] 热啊！' } }], FISH);
  assert.equal(edited.body.text, '[calm] 好 [break] 热啊！');
  assert.equal(edited.spans[0].text, '好 热啊！');
});

test('a floor is split into requests by voice on S1, by voicelessness, by prosody and by size', () => {
  const item = (id, voiceId, extra = {}) => ({ segment: { id, type: 'dialogue', text: '一'.repeat(10), lang: 'zh', ...extra }, voiceId });
  const items = [item(1, 'a'), item(2, 'a'), item(3, 'b'), item(4, 'a')];
  assert.deepEqual(planFishParts(items, { model: 's1' }).map(part => part.map(entry => entry.segment.id)), [[1, 2], [3], [4]]);
  assert.deepEqual(planFishParts(items, { model: 's2-pro' }).map(part => part.length), [4]);
  assert.deepEqual(planFishParts(items, { model: 's2-pro', maxChars: 25 }).map(part => part.map(entry => entry.segment.id)), [[1, 2], [3, 4]]);
  // A sentence read faster is its own request, since Fish sets speed per request.
  const paced = [item(1, 'a'), item(2, 'a', { voice: { speed: 'fast' } }), item(3, 'a', { voice: { speed: 'fast' } }), item(4, 'a')];
  assert.deepEqual(planFishParts(paced, { model: 's2-pro' }).map(part => part.map(entry => entry.segment.id)), [[1], [2, 3], [4]]);
  assert.deepEqual(planFishParts(paced, { model: 's2-pro', prosodySplit: false }).map(part => part.length), [4]);
  assert.equal(buildFishPayload(planFishParts(paced, {})[1], FISH).body.prosody.speed, 1.12);
  // A sentence with no voice cannot sit in a speaker array beside one that has.
  assert.deepEqual(planFishParts([item(1, 'a'), item(2, ''), item(3, '')], {}).map(part => part.map(entry => entry.segment.id)), [[1], [2, 3]]);
});

test('the SSE parser survives frames split anywhere, CRLF line ends and comments', () => {
  const events = [];
  const parser = createSseParser(event => events.push(event));
  const wire = 'event: message\r\ndata: {"a":1}\r\n\r\n: keepalive\n\ndata: {"b":\ndata: 2}\n\nevent: done\ndata: [DONE]\n\n';
  for (let index = 0; index < wire.length; index += 7) parser.push(wire.slice(index, index + 7));
  parser.end();
  assert.deepEqual(events, [
    { event: 'message', data: '{"a":1}' },
    { event: 'message', data: '{"b":\n2}' },
    { event: 'done', data: '[DONE]' },
  ]);
  const tail = [];
  const trailing = createSseParser(event => tail.push(event));
  trailing.push('data: last');
  trailing.end();
  assert.deepEqual(tail, [{ event: 'message', data: 'last' }]);
});

test('alignment snapshots replace each other per chunk and chunks sit on one timeline', () => {
  const collector = createTimestampCollector();
  collector.accept({ audio_base64: 'AA==', chunk_seq: 0, chunk_audio_offset_sec: 0, alignment: { audio_duration: 4.5, segments: LIVE_MULTI_CHUNK0.slice(0, 3) } });
  collector.accept({ audio_base64: 'AQ==', chunk_seq: 0, chunk_audio_offset_sec: 0, alignment: { audio_duration: 4.5, segments: LIVE_MULTI_CHUNK0 } });
  collector.accept({ audio_base64: 'Ag==', chunk_seq: 1, chunk_audio_offset_sec: 4.58, alignment: { audio_duration: 1.8, segments: LIVE_MULTI_CHUNK1 } });
  const { audio, alignments, events } = collector.result();
  assert.deepEqual(audio, ['AA==', 'AQ==', 'Ag==']);
  assert.equal(events, 3);
  assert.equal(alignments.get(0).segments.length, LIVE_MULTI_CHUNK0.length, 'the later snapshot replaced the earlier one');
  const { timeline, duration } = buildGlobalTimeline(alignments);
  assert.equal(timeline.length, LIVE_MULTI_CHUNK0.length + LIVE_MULTI_CHUNK1.length);
  assert.equal(timeline.at(-1).text, '子');
  assert.equal(timeline.at(-1).start, 4.58 + 1.28);
  assert.equal(duration, 4.58 + 1.8);
});

test('sentences find their place in real Fish alignment, pauses and punctuation included', () => {
  const spans = [
    { id: 1, text: '蓝蓝的天空上有红红的太阳。' },
    { id: 2, text: '我操好热啊！' },
    { id: 3, text: '然后泰罗喝了口水。' },
  ];
  const aligned = alignSpansToTimeline(spans, LIVE_SINGLE, { duration: 9.6 });
  assert.deepEqual(aligned.map(({ id, start, end, coverage }) => ({ id, start, end, coverage })), [
    { id: 1, start: 0, end: 2.32, coverage: 1 },
    { id: 2, start: 2.88, end: 7.12, coverage: 1 },
    { id: 3, start: 7.92, end: 9.28, coverage: 1 },
  ]);
  const { timeline } = buildGlobalTimeline(new Map([
    [0, { offset: 0, duration: 4.5, segments: LIVE_MULTI_CHUNK0 }],
    [1, { offset: 4.58, duration: 1.8, segments: LIVE_MULTI_CHUNK1 }],
  ]));
  const multi = alignSpansToTimeline([
    { id: 1, text: '蓝蓝的天空上有红红的太阳。' }, { id: 2, text: '你怎么来了？' }, { id: 3, text: '泰罗放下了杯子。' },
  ], timeline);
  assert.deepEqual(multi.map(({ id, start, end }) => [id, start, end]), [[1, 0, 2.96], [2, 3.2, 4.16], [3, 4.74, 6.1]]);
  assert.ok(multi.every(entry => entry.coverage === 1));
});

test('alignment resynchronises past numbers read as words and gives a lost sentence the gap', () => {
  const spoken = [...'一共来了'].map((text, index) => ({ text, start: index * 0.2, end: index * 0.2 + 0.18 }))
    .concat([{ text: '一百二十三', start: 0.9, end: 1.7 }])
    .concat([...'个人然后走了'].map((text, index) => ({ text, start: 1.8 + index * 0.2, end: 1.98 + index * 0.2 })));
  const aligned = alignSpansToTimeline([
    { id: 1, text: '一共来了123个人。' },
    { id: 2, text: '456' },
    { id: 3, text: '然后走了。' },
  ], spoken);
  assert.equal(aligned[0].start, 0);
  assert.equal(aligned[0].end, 2.18, 'resynchronised on 个人 after the digits');
  assert.ok(aligned[0].coverage > 0.5 && aligned[0].coverage < 1);
  assert.equal(aligned[1].interpolated, true);
  assert.equal(aligned[1].start, aligned[0].end);
  assert.equal(aligned[1].end, aligned[2].start);
  assert.equal(aligned[2].start, 2.2);
  assert.equal(aligned[2].coverage, 1);
});

test('a sentence replays with a little air, never reaching into its neighbours', () => {
  const entries = [
    { id: 1, part: 0, start: 0, end: 2.32 },
    { id: 2, part: 0, start: 2.88, end: 7.12 },
    { id: 3, part: 0, start: 7.92, end: 9.28 },
    { id: 4, part: 1, start: 0.16, end: 1.52 },
  ];
  assert.deepEqual(playbackWindow(entries, 0, 9.6), { part: 0, start: 0, end: 2.67 });
  assert.deepEqual(playbackWindow(entries, 1, 9.6), { part: 0, start: 2.8, end: 7.47 });
  assert.deepEqual(playbackWindow(entries, 2, 9.6), { part: 0, start: 7.84, end: 9.6 });
  assert.deepEqual(playbackWindow(entries, 3, 1.8), { part: 1, start: 0.08, end: 1.8 });
  assert.equal(playbackWindow(entries, 9), null);
});

test('cache keys change with text, voice, mood, edits and sound settings, and not with credentials', async () => {
  const segment = { id: 2, type: 'dialogue', text: '好热！', speaker: '泰罗', emotion: 'happy', intensity: 1 };
  const fingerprint = fishFingerprint(FISH);
  const items = [{ segment, voiceId: 'voice-b' }];
  const base = { floorId: 'chat|3|0', version: 'v1', unit: 'sentence:2', maxChars: 1500, items, fingerprint };
  const key = await recordingCacheKey(base);
  assert.equal(await recordingCacheKey(structuredClone(base)), key);
  assert.notEqual(await recordingCacheKey({ ...base, items: [{ segment: { ...segment, text: '好热啊！' }, voiceId: 'voice-b' }] }), key);
  assert.notEqual(await recordingCacheKey({ ...base, items: [{ segment, voiceId: 'voice-c' }] }), key);
  assert.notEqual(await recordingCacheKey({ ...base, items: [{ segment: { ...segment, emotion: 'angry' }, voiceId: 'voice-b' }] }), key);
  assert.notEqual(await recordingCacheKey({ ...base, items: [{ segment, voiceId: 'voice-b', override: { text: '[calm] 好热！' } }] }), key);
  assert.notEqual(await recordingCacheKey({ ...base, fingerprint: fishFingerprint({ ...FISH, speed: 1.2 }) }), key);
  assert.notEqual(await recordingCacheKey({ ...base, unit: 'line:1' }), key);
  assert.equal(await recordingCacheKey({ ...base, fingerprint: fishFingerprint({ ...FISH, key: 'other', baseUrl: 'https://relay.example' }) }), key);
  const floor = await floorCacheKey({ floorId: 'chat|3|0', version: 'v1', range: 'all', maxChars: 1500, items, fingerprint });
  assert.notEqual(await floorCacheKey({ floorId: 'chat|3|0', version: 'v1', range: 'dialogue', maxChars: 1500, items, fingerprint }), floor);
  assert.notEqual(await fingerprintKey(fingerprint), await fingerprintKey(fishFingerprint(FISH, { emotionCues: false })));
  const utterances = splitUtterances([{ lineId: 1, text: '「好热！」' }]);
  // The reading is keyed by the text alone: a longer cast list or another floor above is no reason to read it again.
  assert.notEqual(await analysisCacheKey({ utterances, depth: 'light' }), await analysisCacheKey({ utterances, depth: 'deep' }));
  assert.notEqual(await analysisCacheKey({ utterances, depth: 'deep', side: 'source' }), await analysisCacheKey({ utterances, depth: 'deep', side: 'translation' }));
  assert.equal(await analysisCacheKey({ utterances, depth: 'deep' }), await analysisCacheKey({ utterances: structuredClone(utterances), depth: 'deep' }));
});

test('a recording remembers which sentences it holds, and a later click finds them whatever unit made them', () => {
  const items = [
    { segment: { id: 1, type: 'narration', text: '风停了。', lineId: 1, speaker: 'narrator' }, voiceId: 'v-n' },
    { segment: { id: 2, type: 'dialogue', text: '走吧。', lineId: 1, speaker: '泰罗' }, voiceId: 'v-t', override: { text: '[calm] 走吧。' } },
  ];
  const covers = recordCovers(items, [{ id: 1, start: 0, end: 1, coverage: 1 }, { id: 2, start: 1.2, end: 2, coverage: 1 }]);
  assert.deepEqual(covers.map(entry => [entry.id, entry.text, entry.voiceId, entry.edited, entry.lineId]), [[1, '风停了。', 'v-n', false, 1], [2, '走吧。', 'v-t', true, 1]]);
  const older = { key: 'old', fingerprint: 'fp', createdAt: 1, timeline: covers.map(entry => ({ ...entry, part: 0 })) };
  const newer = { key: 'new', fingerprint: 'fp', createdAt: 2, timeline: [{ ...covers[0], part: 0 }] };
  const other = { key: 'other', fingerprint: 'fp2', createdAt: 3, timeline: [{ ...covers[0], part: 0 }] };
  const found = findCoveringEntry([older, newer, other], { text: '风停了。', voiceId: 'v-n', fingerprint: 'fp' });
  assert.equal(found.record.key, 'new', 'the newest recording with the same sound settings wins');
  assert.equal(findCoveringEntry([older], { text: '风停了。', voiceId: 'v-x', fingerprint: 'fp' }), null, 'another voice is another recording');
  assert.equal(findCoveringEntry([older], { text: '走吧。', voiceId: 'v-t', fingerprint: 'fp' }), null, 'an edited take does not stand in for the plain sentence');
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

  // A preset that folds the original under a summary, turns 「」 into “”, drops a comma and wraps the
  // characters in its own tags: only the letters are compared, so every sentence is still found, and
  // the button still lands after the closing quote.
  const folded = ['原文', '桜井は振り返って', '“来たんだね”', 'と小さく笑った', '樱井回过头', '“你来了啊”', '轻轻笑了一下。'];
  const foldedLines = [{ lineId: 1, text: '桜井は振り返って、「来たんだね」と小さく笑った。' }];
  const foldedUtterances = splitUtterances(foldedLines);
  const foldedFound = locateAnchors(folded, foldedLines, foldedUtterances.map(item => ({ id: item.id, lineId: item.lineId, text: item.anchor })));
  assert.deepEqual(foldedFound.get(1), { start: { node: 1, offset: 0 }, end: { node: 1, offset: 8 } });
  assert.deepEqual(foldedFound.get(2), { start: { node: 2, offset: 1 }, end: { node: 2, offset: 6 } }, 'the page\'s own quote marks are not the anchor\'s, so they stay outside');
  assert.deepEqual(foldedFound.get(3), { start: { node: 3, offset: 0 }, end: { node: 3, offset: 7 } });
  // A word the rendering swallowed in the middle: the first and last letters still bracket the run.
  const gappy = ['蓝蓝的天空上有红红的太阳', '<图>', '，泰罗放下杯子说道：'];
  const gappyLines = [{ lineId: 1, text: '蓝蓝的天空上有红红的太阳，泰罗放下杯子说道：' }];
  const gappyFound = locateAnchors(gappy, gappyLines, [{ id: 1, lineId: 1, text: '蓝蓝的天空上有红红的太阳，泰罗放下杯子说道：' }]);
  assert.deepEqual(gappyFound.get(1), { start: { node: 0, offset: 0 }, end: { node: 2, offset: 10 } });
});

test('tag fallback reads literal jy-translation blocks and sheds markup and boundaries', () => {
  const text = '<story>原文</story>\n<jy-translation>\n蓝蓝的天空。\n<b>泰罗</b>说：「好热！」&nbsp;\n\n</jy-translation>\n<jy-translation>第二段。</jy-translation>';
  assert.deepEqual(linesFromTaggedText(text, ['jy-translation']), [
    { lineId: 1, text: '蓝蓝的天空。' },
    { lineId: 2, text: '泰罗说：「好热！」' },
    { lineId: 3, text: '第二段。' },
  ]);
  assert.deepEqual(linesFromTaggedText(text, ['nope', 'bad tag']), []);
});

test('read-aloud settings normalise, clamp, migrate and follow the character card', () => {
  const settings = mergeSettings({
    tts: {
      enabled: true, mode: 'sentence', range: 'dialogue', analysis: 'model', narratorVoice: '99c6e180c87c4d5fb506534e7ac62ced',
      quotePairs: '“”, ** **', skipPairs: '* *', context: { floors: 99, worldbook: false }, narratorVoices: { JA: 'v-ja', xx: '', 'en-us': 'v-us' },
      fish: { model: 'gpt', speed: 9, maxChars: 5, viaProxy: false, baseUrl: 'ftp://nope', key: '  sk-x  ' },
    },
    ttsVoices: { 'card.png': [{ name: '泰罗', voiceId: 'abc' }, { name: '' }], empty: [] },
    voiceLibrary: [{ name: '少年', voiceId: 'lib-1', lang: 'zh' }],
  });
  assert.equal(settings.tts.enabled, true);
  assert.equal(settings.tts.mode, 'simple', 'the old sentence and stream modes are the simple reading now');
  assert.equal('analysis' in settings.tts, false, 'the depth is the mode');
  assert.equal(mergeSettings({ tts: { mode: 'floor' } }).tts.mode, 'deep', 'the whole-floor mode of old is the deep reading, open again');
  assert.equal(mergeSettings({ tts: { mode: 'stream', analysis: 'deep' } }).tts.mode, 'deep', 'a depth named outright is kept');
  assert.equal(mergeSettings({ tts: { mode: 'deep' } }).tts.mode, 'deep');
  assert.equal(mergeSettings({ tts: { mode: 'off' } }).tts.mode, 'off', 'the plain reading is a mode of its own');
  assert.equal(mergeSettings({ tts: { askAnalysis: 'plain' } }).tts.askAnalysis, 'plain');
  assert.equal(mergeSettings({ tts: { askAnalysis: 'sometimes' } }).tts.askAnalysis, 'ask');
  assert.equal(mergeSettings({ tts: { prompts: { light: '旧的' } } }).tts.prompts.simple, '旧的', 'the light prompt is the simple prompt');
  assert.equal(settings.tts.sanitizeHtml, true);
  assert.deepEqual(settings.tts.console, { pause: 50, breath: 50, grain: 50, intensity: 50, range: 50, speed: 50, expression: 50, rules: '', marks: [] });
  assert.deepEqual(mergeSettings({ tts: { console: { pause: 150, breath: -3, rules: ' a \n\n b ' } } }).tts.console, { pause: 100, breath: 0, grain: 50, intensity: 50, range: 50, speed: 50, expression: 50, rules: 'a\nb', marks: [] });
  assert.equal(settings.tts.range, 'dialogue');
  assert.deepEqual(settings.tts.quotePairs, ['“”', '** **']);
  assert.deepEqual(settings.tts.skipPairs, ['* *']);
  assert.deepEqual(settings.tts.context, { character: true, worldbook: false, recent: true, floors: 10 });
  assert.deepEqual(settings.tts.narratorVoices, { ja: 'v-ja', 'en-US': 'v-us' });
  assert.equal(settings.tts.fish.model, 's2-pro');
  assert.equal(settings.tts.fish.speed, 2);
  assert.equal(settings.tts.fish.maxChars, 200);
  assert.equal(settings.tts.fish.viaProxy, false);
  assert.equal(settings.tts.fish.baseUrl, 'https://api.fish.audio');
  assert.equal(settings.tts.fish.key, 'sk-x');
  assert.deepEqual(settings.ttsVoices, { 'card.png': [{ name: '泰罗', aliases: [], voiceId: 'abc', voices: {}, locked: true, title: '', console: null }] });
  assert.deepEqual(normalizeVoiceList([{ name: '樱井', console: { breath: 80, rules: '害羞时别太娇' } }])[0].console, { pause: 50, breath: 80, grain: 50, intensity: 50, range: 50, speed: 50, expression: 50, rules: '害羞时别太娇', marks: [] });
  assert.equal(normalizeVoiceList([{ name: '樱井', console: { breath: 50 } }])[0].console, null, 'a console left in the middle is no console');
  assert.deepEqual(settings.voiceLibrary, [{ id: 'voice-1', name: '少年', voiceId: 'lib-1', lang: 'zh', title: '' }]);
  assert.deepEqual(mergeSettings({}).tts, normalizeTts(undefined));
  assert.deepEqual(mergeSettings({}).tts.sourceTags, ['jy-translation']);
  assert.deepEqual(mergeSettings({}).tts.quotePairs, ['「」', '『』', '“”', '""']);
  assert.equal(mergeSettings({ tts: { quotePairs: '' } }).tts.quotePairs.length, 0, 'an emptied field means no quote pairs');
  // Ordinary mode is the default: nothing about reading aloud is on until someone turns it on.
  assert.equal(mergeSettings({}).tts.enabled, false);
  assert.equal(mergeSettings({}).tts.side, 'translation');
  assert.equal(mergeSettings({}).tts.analysis, DEFAULT_TTS.analysis);
  assert.equal(mergeSettings({}).tts.autoGenerate, false);
  assert.equal(mergeSettings({}).tts.downloadScope, 'auto');
  assert.equal(mergeSettings({}).tts.voiceScope, 'character');
  assert.equal(mergeSettings({ tts: { voiceScope: 'chat' } }).tts.voiceScope, 'chat');
  assert.equal(mergeSettings({ tts: { voiceScope: 'universe' } }).tts.voiceScope, 'character');
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
  assert.equal((await store.listFloorAudio('chat1|1|0')).length, 1);

  await store.putAnalysis({ key: 'x', floorId: 'chat1|1|0', version: 'v1', labels: [] });
  await store.putAnalysis({ key: 'y', floorId: 'chat1|1|0', version: 'v2', labels: [] });
  await store.putOverride({ floorId: 'chat1|1|0', version: 'v2', segmentId: 3, text: '[calm] 好。' });
  assert.equal((await store.getOverride('chat1|1|0', 'v2', 3)).text, '[calm] 好。');
  assert.equal((await store.listOverrides('chat1|1|0', 'v2')).length, 1);
  assert.equal(await store.pruneFloor('chat1|1|0', 'v2'), 2, 'only the old version of this floor goes');
  assert.ok(await store.getAnalysis('y'));
  assert.ok(await store.getOverride('chat1|1|0', 'v2', 3), 'the override for the current text stays');
  assert.equal(await store.getAudio('a'), null);
  assert.equal(await store.getAnalysis('x'), null);
  await store.deleteOverride('chat1|1|0', 'v2', 3);
  assert.equal(await store.getOverride('chat1|1|0', 'v2', 3), null);
  assert.equal(await store.clearChat('chat2'), 1);
  assert.equal((await store.usage()).entries, 0);
  assert.deepEqual(planEviction([{ key: 'k', bytes: 5, usedAt: 1 }], 10), []);
});

test('saved wav parts become one file with one header', () => {
  const wav = (samples) => {
    const bytes = new Uint8Array(44 + samples.length);
    const text = (offset, value) => { for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index); };
    text(0, 'RIFF'); text(8, 'WAVE'); text(12, 'fmt ');
    bytes[16] = 16; bytes[20] = 1; bytes[22] = 1; bytes[34] = 16;
    text(36, 'data'); bytes[40] = samples.length;
    bytes.set(samples, 44);
    return bytes;
  };
  const merged = mergeWavBuffers([wav([1, 2, 3, 4]), wav([5, 6])]);
  assert.equal(String.fromCharCode(...merged.slice(0, 4)), 'RIFF');
  assert.equal(merged.length, 44 + 6);
  assert.deepEqual([...merged.slice(44)], [1, 2, 3, 4, 5, 6]);
  assert.equal(merged[40], 6, 'the data length is the total');
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

test('the sentences before a batch ride along as lead, to be read and never answered', () => {
  const all = splitUtterances([{ lineId: 1, text: '教室里没有空调。' }, { lineId: 2, text: '泰罗擦了擦汗。' }, { lineId: 3, text: '「热死了。」' }]);
  const lead = all.slice(0, 1);
  const batch = all.slice(1);
  const deep = buildVoiceAnalysisMessages(batch, { lead });
  const deepInput = JSON.parse(deep[1].content);
  assert.deepEqual(deepInput.utterances.map(item => item.id), [2, 3]);
  assert.equal(deepInput.lead.length, 1);
  assert.equal(deepInput.lead[0].id, 1);
  assert.match(deepInput.lead[0].text, /空调/);
  assert.match(deep[0].content, /lead 是这一批前面紧挨着的几句/);
  const light = buildTtsAnalysisMessages(batch, { lead });
  const lightInput = JSON.parse(light[1].content);
  assert.deepEqual(lightInput.lead.map(item => item.id), [1]);
  assert.match(light[0].content, /只用来认人和判断语气，不用回答/);
  assert.equal('lead' in JSON.parse(buildVoiceAnalysisMessages(batch)[1].content), false, 'a first batch has nothing before it');
});

test('per-quote annotations tell the runs of one line apart, by the characters they open on or by order', () => {
  const utterances = splitUtterances([{ lineId: 4, text: '「你来了？」泰罗抬起头，「坐吧。」' }, { lineId: 5, text: '「……嗯。」' }, { lineId: 6, text: '「走。」她说，「快。」' }]);
  const id = text => utterances.find(item => item.text.includes(text)).id;
  const annotations = new Map([
    // Heads out of order: the characters place each mark on its run.
    [4, { speaker: '泰罗', emotion: 'surprised', quotes: [
      { head: '坐吧', speaker: '泰罗', emotion: 'calm' },
      { head: '你来了', speaker: '樱井', emotion: 'surprised', intensity: 2, tone: 'in a hurry tone' },
    ] }],
    // One run: the line's mark and the run's own fold into one.
    [5, { speaker: '泰罗', emotion: 'hesitant', tone: 'whispering', quotes: [{ emotion: 'uncertain' }] }],
    // No heads, equal counts: by order.
    [6, { speaker: '樱井', emotion: 'serious', quotes: [{ speaker: '樱井', emotion: 'determined' }, { speaker: '泰罗', emotion: 'in a hurry tone' }] }],
  ]);
  const { labels, voices } = annotationReading(utterances, annotations);
  assert.deepEqual(labels.get(id('你来了')), { type: 'dialogue', speaker: '樱井', emotion: 'surprise', intensity: 2 });
  assert.deepEqual(voices.get(id('你来了')), { emotion: 'surprised', tone: 'in a hurry tone', intensity: 2 });
  assert.deepEqual(labels.get(id('坐吧')), { type: 'dialogue', speaker: '泰罗', emotion: 'neutral' });
  assert.deepEqual(voices.get(id('坐吧')), { emotion: 'calm' });
  assert.equal(labels.has(id('泰罗抬起头')), false, 'narration between the runs stays narration');
  assert.deepEqual(labels.get(id('嗯')), { type: 'dialogue', speaker: '泰罗', emotion: 'fear' });
  assert.deepEqual(voices.get(id('嗯')), { emotion: 'uncertain', tone: 'whispering' });
  assert.equal(labels.get(id('走')).speaker, '樱井');
  assert.equal(labels.get(id('快')).speaker, '泰罗');
  assert.deepEqual(voices.get(id('快')), { emotion: 'in a hurry tone' });
  const segments = buildSegments(utterances, labels, { voices });
  assert.equal(sentenceFishText({ segment: segments.find(item => item.id === id('你来了')) }, { model: 's2-pro' }), '[very surprised][in a hurry tone] 你来了？');
  assert.equal(sentenceFishText({ segment: segments.find(item => item.id === id('嗯')) }, { model: 's2-pro' }), '[uncertain][whispering] ……嗯。');
  // A miscount with no heads: every run keeps the line's mark.
  const loose = annotationReading(utterances, new Map([[4, { speaker: '泰罗', emotion: 'happy', quotes: [{ speaker: '樱井' }] }]]));
  assert.deepEqual([...loose.labels.values()].map(label => label.speaker), ['泰罗', '泰罗']);
  assert.deepEqual([...labelsFromAnnotations(utterances, annotations).keys()], [...labels.keys()]);
});

test('a tone named outright is a cue of its own and beats what the volume would imply', () => {
  const voice = normalizeVoice({ emotion: 'sad', tone: 'Whispering', volume: 'loud' }, '走吧。');
  assert.equal(voice.tone, 'whispering');
  assert.deepEqual(compileVoiceCues({ text: '走吧。', voice }).cues, ['[sad]', '[whispering]']);
  assert.deepEqual(compileVoiceCues({ text: '走吧。', voice: { emotion: 'sad', volume: 'loud' } }).cues, ['[sad]', '[shouting]']);
  assert.equal(normalizeVoice({ tone: 'grumpy' }, '走吧。'), null, 'a tone Fish does not name is not a tone');
  assert.ok(voiceSummary(voice).some(([term, value]) => term === '语气' && value === '耳语'));
  assert.deepEqual([...FISH_TONES], ['whispering', 'soft tone', 'shouting', 'screaming', 'in a hurry tone']);
  // S1 keeps the exact word where it knows it, and the palette's own columns for the palette's words.
  assert.equal(emotionCue('frustrated', 2, 's1'), '(frustrated)');
  assert.equal(emotionCue('angry', 2, 's1'), '(angry)(shouting)');
  assert.equal(emotionCue('frustrated', 1, 's2-pro'), '[frustrated]');
});

test('the deep request hands the translation\'s own Fish words and tones on as hints', () => {
  const utterances = splitUtterances([{ lineId: 1, text: '「走吧。」' }]);
  const hints = new Map([[1, { type: 'dialogue', speaker: '泰罗', emotion: 'angry', intensity: 1 }]]);
  const hintVoices = new Map([[1, { emotion: 'frustrated', tone: 'soft tone', intensity: 1 }]]);
  const input = JSON.parse(buildVoiceAnalysisMessages(utterances, { hints, hintVoices })[1].content);
  assert.deepEqual(input.skeleton, [{ id: 1, speaker: '泰罗', emotion: 'frustrated', intensity: 1, tone: 'soft tone' }]);
  assert.deepEqual(JSON.parse(buildVoiceAnalysisMessages(utterances, { hints })[1].content).skeleton, [{ id: 1, speaker: '泰罗', emotion: 'angry', intensity: 1 }]);
  // A direction from the translation rides in the skeleton with the words it points at.
  const directed = new Map([[1, { direction: '压着火，装冷淡', speed: 'slow', stress: ['走'], sounds: [{ at: 'end', tag: '叹气' }] }]]);
  assert.deepEqual(JSON.parse(buildVoiceAnalysisMessages(utterances, { hints, hintVoices: directed })[1].content).skeleton, [{ id: 1, speaker: '泰罗', emotion: 'angry', intensity: 1, direction: '压着火，装冷淡', speed: 'slow', stress: ['走'], sounds: [{ at: 'end', tag: '叹气' }] }]);
  assert.equal(normalizeTts({ fish: { concurrency: 9 } }).fish.concurrency, 4);
  assert.equal(normalizeTts({}).fish.concurrency, 2);
});

test('a direction goes to the S2 models in the reader\'s own words, with the marks at their words', () => {
  const utterances = splitUtterances([{ lineId: 1, text: '「热死了，我才不想喝，你去给别人喝吧……也不是不行。」' }]);
  const voice = normalizeVoice({
    direction: ' 压着火，装冷淡，语速稍慢 ', emotion: 'frustrated', speed: 'slow', volume: 'quiet',
    stress: ['别人', '不在句里'], pauses: [{ after: '也', length: 'long' }], shift: { at: '也不是', direction: '松下来，带一点期待' },
    sounds: [{ at: 'start', tag: '轻笑' }, { at: 'after', after: '喝吧', tag: '叹气' }, { at: 'end', tag: 'chuckling' }, { at: 'end', tag: 'nonsense' }],
  }, utterances[0].text);
  assert.equal(voice.direction, '压着火，装冷淡，语速稍慢');
  assert.deepEqual(voice.shifts, [{ at: '也不是', direction: '松下来，带一点期待' }]);
  assert.deepEqual(voice.sounds, [{ at: 'start', tag: '轻笑' }, { at: 'after', tag: '叹气', after: '喝吧' }, { at: 'end', tag: 'chuckling' }]);
  const segment = { ...utterances[0], type: 'dialogue', speaker: '泰罗', voice };
  const compiled = compileVoiceCues(segment, { model: 's2-pro' });
  assert.deepEqual(compiled.cues, ['[压着火，装冷淡，语速稍慢]', '[轻笑]']);
  assert.equal(compiled.text, '热死了，我才不想喝，你去给 [重读] 别人喝吧…… [叹气] [松下来，带一点期待] 也 [长停顿] 不是不行。');
  assert.equal(compiled.tail, '[chuckling]');
  assert.equal(compiled.speed, 'slow');
  assert.equal(compiled.volume, 'quiet');
  assert.equal(sentenceFishText({ segment }, { model: 's2-pro' }), '[压着火，装冷淡，语速稍慢][轻笑] 热死了，我才不想喝，你去给 [重读] 别人喝吧…… [叹气] [松下来，带一点期待] 也 [长停顿] 不是不行。 [chuckling]');
  assert.equal(stripCues(sentenceFishText({ segment }, { model: 's2-pro' })), '热死了，我才不想喝，你去给 别人喝吧…… 也 不是不行。', 'every mark comes off again for alignment');
  // S1 cannot read free-form words: the mood word and Fish\'s own sound tags stand in.
  const s1 = compileVoiceCues(segment, { model: 's1' });
  assert.deepEqual(s1.cues, ['(frustrated)', '(soft tone)', '(chuckling)'], 'quiet without restraint is a soft tone');
  assert.equal(s1.text, '热死了，我才不想喝，你去给别人喝吧 (sighing) ……也 (long-break) 不是不行。');
  assert.equal(s1.tail, '(chuckling)');
  assert.ok(voiceSummary(voice).some(([term, value]) => term === '指令' && value === '压着火，装冷淡，语速稍慢'));
  assert.ok(voiceSummary(voice).some(([term, value]) => term === '非语言声' && value === '开头轻笑，「喝吧」后叹气，句尾轻笑'));
});

test('the translation\'s marks carry the direction and its words into the reading, checked against the sentence', () => {
  const utterances = splitUtterances([{ lineId: 1, text: '泰罗说：「热死了，我才不想喝。」' }]);
  const annotations = new Map([[1, { speaker: '泰罗', emotion: 'frustrated', intensity: 2, direction: '压着火，装冷淡', speed: 'slow', stress: ['不想'], pauses: [{ after: '不存在', length: 'long' }], sounds: [{ at: 'end', tag: '叹气' }] }]]);
  const { labels, voices } = annotationReading(utterances, annotations);
  assert.deepEqual(labels.get(2), { type: 'dialogue', speaker: '泰罗', emotion: 'angry', intensity: 2 });
  assert.deepEqual(voices.get(2), { direction: '压着火，装冷淡', speed: 'slow', stress: ['不想'], sounds: [{ at: 'end', tag: '叹气' }], emotion: 'frustrated', intensity: 2 });
  const segments = buildSegments(utterances, labels, { voices });
  assert.equal(sentenceFishText({ segment: segments[1] }, { model: 's2-pro' }), '[压着火，装冷淡] 热死了，我才 [重读] 不想喝。 [叹气]');
  // The other language keeps the direction and the sounds at either end, not the words it points at.
  const other = splitUtterances([{ lineId: 1, text: 'タロウ：「暑い、飲みたくない。」' }]);
  const derived = deriveLabelsForSide(utterances, labels, voices, other);
  assert.deepEqual(derived.voices.get(2), { direction: '压着火，装冷淡', speed: 'slow', sounds: [{ at: 'end', tag: '叹气' }], emotion: 'frustrated', intensity: 2 });
});

test('a console becomes sentences at its ends and says nothing in the middle', () => {
  assert.deepEqual(consoleDirections({ pause: 50, breath: 50, grain: 50, intensity: 50, range: 50, speed: 50, expression: 50, rules: '' }), []);
  const lines = consoleDirections({ pause: 80, breath: 20, grain: 50, intensity: 70, range: 30, speed: 100, expression: 0, rules: '害羞时不要过度娇柔\n\n生气时保持克制' });
  assert.equal(lines.length, 8);
  assert.match(lines[0], /^停顿感强/);
  assert.match(lines[1], /^呼吸声少/);
  assert.match(lines[2], /^情感强度高/);
  assert.match(lines[3], /^情绪幅度小/);
  assert.match(lines[4], /^语速很快/);
  assert.match(lines[5], /^不要非语言声音/);
  assert.deepEqual(lines.slice(6), ['害羞时不要过度娇柔', '生气时保持克制']);
  assert.deepEqual(consoleDirections(null), []);
  // The further out a slider sits, the more it demands; the middle band is silent.
  assert.match(consoleDirections({ intensity: 90 })[0], /^情感强度很高：.*一半以上写 intensity 2/);
  assert.match(consoleDirections({ intensity: 10 })[0], /^情感强度极低：intensity 一律写 0/);
  assert.match(consoleDirections({ expression: 70 })[0], /每三四句对白至少一处/);
  assert.deepEqual(consoleDirections({ intensity: 40, expression: 60, pause: 64, breath: 36 }), []);
});

test('the lines a floor reads lose their markup before anything hears them', () => {
  assert.equal(plainLineText('<span style="color:#78B750;font-size:0.85em;">真的可以用……<strong>帮您</strong>吗……？</span>'), '真的可以用……帮您吗……？');
  assert.equal(plainLineText('第一句<br>第二句 &amp; 第三句'), '第一句\n第二句 & 第三句');
  const utterances = splitUtterances([{ lineId: 1, text: plainLineText('<p>泰罗说：<q>「<em>好热</em>！」</q></p>') }]);
  assert.deepEqual(utterances.map(item => item.text), ['泰罗说：', '好热！'], 'the quoted run keeps its words, the marks stay on the anchor');
  assert.equal(utterances[1].anchor, '「好热！」');
});

import { detectTtsHost, fishGoesDirect, fishEndpoint as fishEndpointOnHost, fishHeaders as fishHeadersOnHost, describeFishFailure as describeFishFailureOnHost } from '../tts.js';

test('on TauriTavern a Fish call goes direct, carries no host headers, and fails with that host in mind', () => {
  assert.equal(detectTtsHost({}), 'sillytavern');
  assert.equal(detectTtsHost({ __TAURITAVERN__: { abiVersion: 1 } }), 'tauritavern');
  assert.equal(detectTtsHost({ __TAURITAVERN_MAIN_READY__: Promise.resolve() }), 'tauritavern');
  const fish = { baseUrl: 'https://api.fish.audio', viaProxy: true, key: 'k', model: 's2-pro' };
  assert.equal(fishGoesDirect(fish, 'sillytavern'), false);
  assert.equal(fishGoesDirect(fish, 'tauritavern'), true);
  assert.equal(fishEndpointOnHost(fish, '/v1/tts'), '/proxy/https://api.fish.audio/v1/tts');
  assert.equal(fishEndpointOnHost(fish, '/v1/tts', { host: 'tauritavern' }), 'https://api.fish.audio/v1/tts');
  assert.equal(fishEndpointOnHost({ ...fish, baseUrl: 'https://relay.example/fish/' }, '/v1/tts', { host: 'tauritavern' }), 'https://relay.example/fish/v1/tts');
  const headers = fishHeadersOnHost(fish, { 'X-CSRF-Token': 't' }, { host: 'tauritavern' });
  assert.equal(headers['X-CSRF-Token'], undefined);
  assert.equal(headers.Authorization, 'Bearer k');
  assert.ok(fishHeadersOnHost(fish, { 'X-CSRF-Token': 't' })['X-CSRF-Token']);
  const message = describeFishFailureOnHost({ network: true, viaProxy: true, host: 'tauritavern' });
  assert.match(message, /TauriTavern/);
  assert.match(message, /转发地址/);
  assert.doesNotMatch(message, /检查酒馆是否还在运行/);
  assert.match(describeFishFailureOnHost({ network: true, viaProxy: true }), /检查酒馆是否还在运行/);
});

test('the analysis batch size is a sentence count, with zero meaning the whole floor at once', () => {
  assert.equal(normalizeTts({}).batchSize, 0, 'a floor is analysed whole unless told otherwise');
  assert.equal(normalizeTts({ batchSize: 0 }).batchSize, 0);
  assert.equal(normalizeTts({ batchSize: '20' }).batchSize, 20);
  assert.equal(normalizeTts({ batchSize: 2 }).batchSize, 4);
  assert.equal(normalizeTts({ batchSize: 999 }).batchSize, 60);
  assert.equal(normalizeTts({ batchSize: 'abc' }).batchSize, 0);
});


import { normalizeConsole, normalizeMarks, RECOMMENDED_MARKS } from '../core.js';
import { applyPunctuationMarks, sentenceFishText as fishTextOf, sentenceProsody as prosodyOf, fishFingerprint as fingerprintOf } from '../tts.js';

test('punctuation marks: an inline mark replaces its run, a head mark opens the clause, and nothing doubles', () => {
  const marks = normalizeMarks([{ punct: '……', tag: '停顿', at: 'inline' }, { punct: '！！', tag: '加大音量', at: 'head' }, { punct: '？！', tag: '惊讶' }]);
  assert.deepEqual(marks.map(mark => mark.at), ['inline', 'head', 'head'], 'a mark without a place takes the catalogue default');
  assert.equal(applyPunctuationMarks('这……不太好吧', marks), '这 [break] 不太好吧');
  assert.equal(applyPunctuationMarks('真的吗。骗人的吧！！我不信。', marks), '真的吗。[shouting] 骗人的吧！！我不信。');
  assert.equal(applyPunctuationMarks('骗人的吧！！', marks, 's1'), '(shouting) 骗人的吧！！');
  assert.equal(applyPunctuationMarks('这……不太好吧', marks, 's1'), '这 (break) 不太好吧');
  assert.equal(applyPunctuationMarks('[压着火……] 你好……', marks), '[压着火……] 你好 [break]', 'punctuation inside a cue is left alone');
  assert.equal(applyPunctuationMarks('[shouting] 骗人的吧！！', marks), '[shouting] 骗人的吧！！', 'a cue already there is not doubled');
  assert.equal(applyPunctuationMarks('等等……不对……', marks), '等等 [break] 不对 [break]');
  assert.equal(applyPunctuationMarks('平常的一句。', marks), '平常的一句。');
  assert.equal(applyPunctuationMarks('这……不太好吧', []), '这……不太好吧');
  assert.deepEqual(normalizeMarks([{ punct: ' ', tag: '停顿' }, { punct: '……', tag: '不存在的' }, { punct: '……', tag: '停顿' }, { punct: '……', tag: '叹气' }]).length, 1, 'blank, unknown and repeated runs are dropped');
  assert.equal(normalizeConsole({ marks: RECOMMENDED_MARKS }).marks.length, 3);
  assert.equal(normalizeConsole({ marks: RECOMMENDED_MARKS }, { sparse: true })?.marks.length, 3, 'marks alone make a console worth keeping');
});

test('the lean compile sends one of Fish\'s own words, the named tone and an official sound, and the marks ride along', () => {
  const segment = { id: 1, type: 'dialogue', speaker: '泰罗', text: '骗人的吧！！这……不太好吧', voice: { emotion: 'angry', intensity: 2, tone: 'shouting', direction: '压着火，装冷淡', sounds: [{ at: 'end', tag: '轻笑' }, { at: 'start', tag: '深呼吸' }] } };
  const item = { segment, voiceId: 'v', console: { marks: normalizeMarks([{ punct: '……', tag: '停顿' }, { punct: '！！', tag: '加大音量' }]) } };
  assert.equal(fishTextOf(item, { model: 's2-pro' }, { lean: true, directions: false }), '[furious][shouting] 骗人的吧！！这 [break] 不太好吧 [chuckling]', 'the mood at its strength, no adverb, no direction, the head tone not doubled by the mark, a sound Fish has no word for dropped');
  assert.equal(fishTextOf(item, { model: 's1' }, { lean: true, directions: false }), '(angry)(shouting) 骗人的吧！！这 (break) 不太好吧 (chuckling)');
  assert.equal(fishTextOf({ segment: { ...segment, voice: null }, console: item.console }, { model: 's2-pro' }, { lean: true }), '[shouting] 骗人的吧！！这 [break] 不太好吧', 'the plain reading is the text plus the marks, head marks included');
  assert.match(fishTextOf(item, { model: 's2-pro' }, { directions: true }), /^\[压着火，装冷淡\]/, 'the deep reading still speaks in its own words');
});

test('the console\'s speed lean nudges the prosody only where the voice said nothing about speed', () => {
  const fish = { speed: 1, volume: 0, model: 's2-pro' };
  assert.equal(prosodyOf({ segment: { text: '你好' }, console: { speed: 80 } }, fish).speed, 1.15);
  assert.equal(prosodyOf({ segment: { text: '你好' }, console: { speed: 20 } }, fish).speed, 0.85);
  assert.equal(prosodyOf({ segment: { text: '你好' }, console: { speed: 50 } }, fish).speed, 1);
  assert.equal(prosodyOf({ segment: { text: '你好', voice: { speed: 'fast' } }, console: { speed: 80 } }, fish).speed, 1.12, 'a speed the voice named wins');
  assert.equal(prosodyOf({ segment: { text: '你好' }, console: { speed: 80 } }, fish, { prosodySplit: false }).speed, 1.15, 'the lean applies even without prosody splitting');
  assert.equal(fingerprintOf(fish, { mode: 'off', consoles: 'c1' }).mode, 'off');
  assert.notDeepEqual(fingerprintOf(fish, { mode: 'off', consoles: 'c1' }), fingerprintOf(fish, { mode: 'off', consoles: 'c2' }), 'a different console is a different recording');
});

import { FISH_SOUNDS as FISH_SOUND_LIST, FISH_TONES as FISH_TONE_LIST } from '../tts.js';

import { encodeWav as encodeWavFile } from '../tts.js';
import { DEEP_PROMPT, DEEP_STATUS, buildDeepAnalysisMessages as buildVoiceAnalysisMessages, deepRequestSettings } from '../tts-deep.js';

test('a cut of decoded audio is written out as a wav file that names its own shape', () => {
  const left = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const bytes = encodeWavFile([left], 24000);
  const text = (from, length) => String.fromCharCode(...bytes.slice(from, from + length));
  const uint32 = at => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24);
  const uint16 = at => bytes[at] | (bytes[at + 1] << 8);
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(text(8, 4), 'WAVE');
  assert.equal(text(12, 4), 'fmt ');
  assert.equal(text(36, 4), 'data');
  assert.equal(uint16(20), 1, 'plain PCM');
  assert.equal(uint16(22), 1, 'one channel in, one channel out');
  assert.equal(uint32(24), 24000, 'the sample rate it was decoded at');
  assert.equal(uint16(34), 16, 'sixteen bits a sample');
  assert.equal(uint32(40), left.length * 2, 'the data chunk is the samples');
  assert.equal(bytes.length, 44 + left.length * 2);
  assert.equal(uint32(4), bytes.length - 8);
  // The far ends are the far ends, and nothing clips round to the wrong sign.
  const view = new DataView(bytes.buffer);
  assert.equal(view.getInt16(44, true), 0);
  assert.equal(view.getInt16(50, true), 32767);
  assert.equal(view.getInt16(52, true), -32768);
  // Two channels interleave.
  const stereo = encodeWavFile([new Float32Array([1, 0]), new Float32Array([-1, 0])], 48000);
  assert.equal(uint16.call(null, 22), 1, 'the first file is untouched by the second');
  const stereoView = new DataView(stereo.buffer);
  assert.equal(stereo[22], 2);
  assert.equal(stereoView.getInt16(44, true), 32767);
  assert.equal(stereoView.getInt16(46, true), -32768);
  // Nothing at all is still a valid, empty file rather than a throw.
  assert.equal(encodeWavFile([], 44100).length, 44);
});

// ---------------------------------------------------------------------------------------------
// Who speaks, read off the text; names pinned over labels; the audio's identity; the provider boundary.
// ---------------------------------------------------------------------------------------------
import { pinSpeakers, resolveSpeakers, speakerHints, speakersOf } from '../tts-speakers.js';
import { FISH_ADAPTER, itemIdentity, registerTtsProvider, ttsProvider } from '../tts.js';

const CAST = [{ name: '顾旭禾', aliases: ['小苗苗'] }, { name: '陆玲', aliases: [] }, { name: '林可森', aliases: ['森畜'] }];
function readFloor(lines, options = {}) {
  const utterances = splitUtterances(lines.map((text, index) => ({ lineId: index + 1, text })));
  const resolved = resolveSpeakers(utterances, { cast: CAST, ...options });
  const quoted = utterances.filter(item => item.kind === 'quoted').map(item => [item.text, resolved.get(item.id)?.speaker ?? null, resolved.get(item.id)?.source ?? null]);
  return { utterances, resolved, quoted };
}

test('the speaker engine reads who speaks off the text: the name beside the quote, the one who acts, the script form', () => {
  const single = readFloor(['顾旭禾看了她一眼。“你来了？”', '“坐吧。”他说道。', '“外面冷吧。”']);
  assert.deepEqual(single.quoted, [['你来了？', '顾旭禾', 'local'], ['坐吧。', '顾旭禾', 'local'], ['外面冷吧。', '顾旭禾', 'local']]);
  assert.match(single.resolved.get(2).evidence.join('；'), /引号前「顾旭禾看了她一眼/);
  assert.match(single.resolved.get(3).evidence.join('；'), /场上只有这一个人/, 'a pronoun with one person present is that person');
  assert.match(single.resolved.get(5).evidence.join(''), /只有这一个人在说话/, 'one person carries the floor: a bare quote is theirs');

  const script = readFloor(['顾旭禾：“陆玲，你看这个。”', '“这是什么？”', '林可森从后面凑过来，“欸嘿~小苗苗在干嘛呢~”', '“滚。”']);
  assert.deepEqual(script.quoted, [['陆玲，你看这个。', '顾旭禾', 'local'], ['这是什么？', '陆玲', 'local'], ['欸嘿~小苗苗在干嘛呢~', '林可森', 'local'], ['滚。', null, null]]);
  assert.match(script.resolved.get(2).evidence.join('；'), /话里叫的是陆玲/, 'the one called by name is the one spoken to');
  assert.equal(script.resolved.get(2).confidence, 1);
  assert.equal(script.resolved.get(6).speaker, null, 'a third person in the scene ends the taking of turns');

  const same = readFloor(['“早。”顾旭禾说道，“今天冷。”', '顾旭禾看着陆玲说：“写得挺好。”']);
  assert.deepEqual(same.quoted.map(([, who]) => who), ['顾旭禾', '顾旭禾', '顾旭禾'], 'the one looked at is not the one speaking');
  const above = readFloor(['顾旭禾挠了挠头，开口道：', '“那个……”']);
  assert.deepEqual(above.quoted, [['那个……', '顾旭禾', 'local']]);
  assert.match(above.resolved.get(2).evidence.join(''), /上一段末尾/);
});

test('two people take turns: once both are named, the nameless lines alternate between them', () => {
  const two = readFloor(['顾旭禾推门进来。“早。”', '“早。”陆玲头也不抬。', '“今天很冷。”', '“嗯。”', '“作业写完了吗？”', '“……没有。”']);
  assert.deepEqual(two.quoted.map(([, who, source]) => [who, source]), [
    ['顾旭禾', 'local'], ['陆玲', 'local'], ['顾旭禾', 'local'], ['陆玲', 'local'], ['顾旭禾', 'local'], ['陆玲', 'local'],
  ]);
  assert.match(two.resolved.get(5).evidence.join('；'), /和陆玲轮流说话/);
  // The same floor with nobody named at all: nobody is guessed at.
  const nameless = readFloor(['“早。”', '“早。”', '“今天很冷。”']);
  assert.deepEqual(nameless.quoted.map(([, who]) => who), [null, null, null]);
});

test('a quote nobody can name goes to the translation\'s label, then to nobody; the reader\'s word beats them all', () => {
  const hinted = readFloor(['王轩风走过来。“喂。”', '“干嘛。”'], { hints: new Map([[2, '顾旭禾']]) });
  assert.deepEqual(hinted.quoted, [['喂。', '顾旭禾', 'hint'], ['干嘛。', '顾旭禾', 'local']], 'the one person the labels name carries the floor');
  assert.equal(hinted.resolved.get(2).confidence, 0.6);
  // A line beside a verb of speech with no known name is somebody else's: nobody's here.
  const nobody = readFloor(['老板说道：“好嘞。”', '“快点。”'], { hints: new Map([[3, '顾旭禾']]) });
  assert.deepEqual(nobody.quoted, [['好嘞。', null, null], ['快点。', '顾旭禾', 'hint']]);
  // What the text says outright outranks the label; what it only suggests does not.
  const clear = readFloor(['顾旭禾说道：“早。”'], { hints: new Map([[2, '陆玲']]) });
  assert.deepEqual(clear.quoted, [['早。', '顾旭禾', 'local']]);
  const suggested = readFloor(['顾旭禾推门进来。“早。”'], { hints: new Map([[2, '陆玲']]) });
  assert.deepEqual(suggested.quoted, [['早。', '陆玲', 'hint']]);
  // The reader's word, in any spelling the cast knows, is final.
  const manual = readFloor(['顾旭禾推门进来。“早。”', '“早。”陆玲头也不抬。'], { manual: new Map([[3, '小苗苗']]) });
  assert.deepEqual(manual.quoted, [['早。', '顾旭禾', 'local'], ['早。', '顾旭禾', 'manual']]);
  assert.deepEqual(manual.resolved.get(3).evidence, ['手动指定']);
  // Carried over from the other language: only the labels and the reader's word, never the text.
  const carried = readFloor(['顾旭禾推门进来。“早。”'], { hints: new Map([[2, '陆玲']]), infer: false });
  assert.deepEqual(carried.quoted, [['早。', '陆玲', 'hint']]);
});

test('pinning names over labels: the model\'s word stands only where nobody else had one', () => {
  const labels = new Map([[2, { type: 'dialogue', speaker: '泰罗', emotion: 'happy' }], [3, { type: 'dialogue', speaker: '樱井' }], [4, { type: 'narration' }]]);
  const resolved = new Map([[2, { speaker: '陆玲', source: 'local', confidence: 1, evidence: ['引号前「陆玲说」'] }], [3, { speaker: null, source: null, confidence: 0, evidence: [] }]]);
  const pinned = pinSpeakers(labels, resolved);
  assert.deepEqual(pinned.get(2), { type: 'dialogue', speaker: '陆玲', emotion: 'happy', speakerSource: 'local', speakerEvidence: ['引号前「陆玲说」'] });
  assert.deepEqual(pinned.get(3), { type: 'dialogue', speaker: '樱井', speakerSource: 'model', speakerEvidence: [] });
  assert.equal(pinSpeakers(labels, resolved, { fallback: 'hint' }).get(3).speakerSource, 'hint');
  assert.deepEqual(pinned.get(4), { type: 'narration' });
  assert.equal(labels.get(2).speaker, '泰罗', 'the labels handed in are left as they were');
  assert.deepEqual([...speakerHints(labels)], [[2, '泰罗'], [3, '樱井']]);
  assert.deepEqual([...speakersOf(resolved)], [[2, '陆玲']]);
  // A label carried over from the other language keeps saying where its name was read.
  const other = pinSpeakers(new Map([[7, { type: 'dialogue', speaker: '陆玲', speakerSource: 'local', speakerEvidence: ['x'] }]]),
    new Map([[7, { speaker: '陆玲', source: 'hint', confidence: 0.6, evidence: ['翻译时的标注'] }]]));
  assert.deepEqual(other.get(7), { type: 'dialogue', speaker: '陆玲', speakerSource: 'local', speakerEvidence: ['x'] });
  // The segments say the same.
  const utterances = splitUtterances([{ lineId: 1, text: '“早。”' }, { lineId: 2, text: '“嗯。”' }]);
  const segments = buildSegments(utterances, pinSpeakers(new Map(), new Map([[1, { speaker: '陆玲', source: 'local', confidence: 0.55, evidence: ['e'] }], [2, { speaker: null, source: null, confidence: 0, evidence: [] }]])));
  assert.deepEqual(segments.map(segment => [segment.speaker, segment.speakerSource, segment.speakerEvidence]), [['陆玲', 'local', ['e']], [null, null, []]]);
});

test('the simple request names what the reader set, asks the model for the rest, and holds it to the console', () => {
  const utterances = splitUtterances([{ lineId: 1, text: '顾旭禾推门进来。“早。”' }, { lineId: 2, text: '“早。”' }]);
  const messages = buildTtsAnalysisMessages(utterances, { roster: ['顾旭禾', '陆玲'], speakers: new Map([[2, '顾旭禾']]), lead: [{ id: 0, anchor: '前一句', text: '前一句' }] });
  const input = JSON.parse(messages[1].content);
  assert.deepEqual(input.utterances.map(item => [item.id, item.speaker ?? null]), [[1, null], [2, '顾旭禾'], [3, null]]);
  assert.match(messages[0].content, /个别对白句带 speaker，那是用户手动定的，照抄，不要改/);
  assert.match(messages[0].content, /2\. speaker 只给 dialogue/);
  assert.match(messages[0].content, /硬性要求，不是参考/);
  assert.match(messages[0].content, /intensity：0 弱、1 中、2 强/);
  assert.match(messages[0].content, /pauses：/);
  assert.match(messages[0].content, /自然为先/);
});

test('in a floor the character wrote, the reader is the one spoken to', () => {
  const cast = [{ name: '明日香', aliases: [] }, { name: '孟空', aliases: [] }];
  const protagonists = { character: '明日香', user: '孟空' };
  const read = lines => {
    const utterances = splitUtterances(lines.map((text, index) => ({ lineId: index + 1, text })));
    const resolved = resolveSpeakers(utterances, { cast, protagonists });
    return utterances.filter(item => item.kind === 'quoted').map(item => [item.text.slice(0, 6), resolved.get(item.id)?.speaker ?? null, resolved.get(item.id)?.evidence ?? []]);
  };
  // The character narrated, the reader addressed: every quote is the character's.
  const addressed = read(['明日香抱着胳膊靠在墙上，瞥了孟空一眼。', '“那可是前线诶，”', '“孟空，你现在的样子，比那时候死脑筋。”', '她哼了一声。', '“我是认真的。”']);
  assert.deepEqual(addressed.map(([, who]) => who), ['明日香', '明日香', '明日香']);
  assert.match(addressed[1][2].join('；'), /话里叫的是孟空（你），说话的是明日香/);
  // The reader speaks outright once; everything else stays the character's.
  const once = read(['明日香抱着胳膊。“你来干什么？”', '孟空说道：“来看你。”', '“……哼。”', '“随便你。”']);
  assert.deepEqual(once.map(([, who]) => who), ['明日香', '孟空', '明日香', '明日香']);
  // The character is only ever 她; the reader is named as the one looked at: the character speaks.
  const pronouns = read(['她看着孟空，皱起眉。', '“你又迟到了。”', '“别找借口。”']);
  assert.deepEqual(pronouns.map(([, who]) => who), ['明日香', '明日香']);
  assert.match(pronouns[0][2].join(''), /只有你被叫到，说话的是明日香/);
  // Somebody outside the cast speaks: that line is nobody's, and the character keeps the rest.
  const stranger = read(['明日香推开门。“老板，两份拉面。”', '老板笑着说道：“好嘞。”', '“快点。”']);
  assert.deepEqual(stranger.map(([, who]) => who), ['明日香', null, '明日香']);
});

test('a recording\'s identity: the same words in another voice, mood, strength or name are never shared', () => {
  const base = { segment: { id: 1, type: 'dialogue', text: '早。', speaker: '顾旭禾', lang: 'zh', emotion: 'happy', intensity: 1, voice: null }, voiceId: 'voice-a' };
  assert.equal(itemIdentity(base), itemIdentity({ ...base, segment: { ...base.segment } }));
  for (const changed of [
    { ...base, voiceId: 'voice-b' },
    { ...base, segment: { ...base.segment, emotion: 'sad' } },
    { ...base, segment: { ...base.segment, intensity: 2 } },
    { ...base, segment: { ...base.segment, speaker: '陆玲' } },
    { ...base, segment: { ...base.segment, lang: 'ja' } },
    { ...base, override: { text: '早……' } },
  ]) assert.notEqual(itemIdentity(changed), itemIdentity(base));
  const record = { key: 'r1', fingerprint: 'fp', createdAt: 1, timeline: recordCovers([base], [{ id: 1, start: 0, end: 1, part: 0 }]) };
  assert.ok(findCoveringEntry([record], { text: '早。', voiceId: 'voice-a', fingerprint: 'fp', identity: itemIdentity(base) }));
  assert.equal(findCoveringEntry([record], { text: '早。', voiceId: 'voice-b', fingerprint: 'fp', identity: itemIdentity({ ...base, voiceId: 'voice-b' }) }), null, 'voice A\'s take never stands in for voice B');
  assert.equal(findCoveringEntry([record], { text: '早。', voiceId: 'voice-a', fingerprint: 'fp', identity: itemIdentity({ ...base, segment: { ...base.segment, emotion: 'sad' } }) }), null, 'nor for another mood');
  // A recording from before identities were kept is matched by its words and voice, as it always was.
  const older = { ...record, timeline: record.timeline.map(({ identity, ...entry }) => entry) };
  assert.ok(findCoveringEntry([older], { text: '早。', voiceId: 'voice-a', fingerprint: 'fp', identity: itemIdentity({ ...base, segment: { ...base.segment, emotion: 'sad' } }) }));
});

test('the provider boundary: another adapter registers under its id, and what reaches it was named and voiced upstream', () => {
  assert.equal(ttsProvider('fish'), FISH_ADAPTER);
  assert.equal(ttsProvider('nobody'), FISH_ADAPTER, 'an unknown id reads through Fish');
  assert.deepEqual(Object.keys(FISH_ADAPTER.vocabulary), ['emotions', 'tones', 'sounds']);
  const seen = [];
  const echo = registerTtsProvider({
    id: 'echo', label: 'Echo', vocabulary: { emotions: ['happy'], tones: [], sounds: [] },
    sentenceText: item => item.segment.text,
    prosody: () => ({ speed: 1, volume: 0 }),
    parts: items => [items],
    payload: items => {
      seen.push(items.map(item => [item.segment.speaker, item.voiceId, item.segment.emotion]));
      return { body: { lines: items.map(item => item.segment.text) }, spans: items.map(item => ({ id: item.segment.id, text: item.segment.text })) };
    },
    fingerprint: () => ({ provider: 'echo' }),
    mime: () => 'audio/wav',
  });
  assert.equal(ttsProvider('echo'), echo);
  const utterances = splitUtterances([{ lineId: 1, text: '顾旭禾推门进来。“早。”' }, { lineId: 2, text: '“早。”陆玲头也不抬。' }]);
  const resolved = resolveSpeakers(utterances, { cast: CAST });
  const segments = buildSegments(utterances, pinSpeakers(new Map([[2, { emotion: 'happy' }]]), resolved));
  const { items } = planVoices(segments, { voices: [{ name: '顾旭禾', voiceId: 'v-gu', locked: true }, { name: '陆玲', voiceId: 'v-lu', locked: true }], narratorVoice: 'v-n', dialogueVoice: 'v-d' });
  const { body } = echo.payload(echo.parts(items, {})[0], {});
  assert.deepEqual(body.lines, ['顾旭禾推门进来。', '早。', '早。', '陆玲头也不抬。']);
  assert.deepEqual(seen[0], [['narrator', 'v-n', null], ['顾旭禾', 'v-gu', 'happy'], ['陆玲', 'v-lu', null], ['narrator', 'v-n', null]], 'names, voices and moods arrive settled; the adapter only formats');
  assert.throws(() => registerTtsProvider({ id: 'half', vocabulary: {} }), /missing sentenceText/);
  assert.equal(FISH_ADAPTER.sentenceText({ segment: segments[1], voiceId: 'v-gu' }, { fish: { model: 's2-pro' }, mode: 'simple' }), '[happy] 早。');
});

test('a quote set off inside a sentence is part of the sentence, not speech: the reading keeps it in the narration', () => {
  const line = '“如果是怕那些麻烦，那你不做不就好了？”她挑起眉毛，语气轻飘飘的，却精准地刺中了孟空那份关于“想要接近”却又“深怕伤害”的纠结，“还是说，你其实并没有那么想，只是习惯了把自己当成一个必须负责的照顾者？”';
  const utterances = splitUtterances([{ lineId: 1, text: line }]);
  assert.deepEqual(utterances.map(item => [item.kind, item.text]), [
    ['quoted', '如果是怕那些麻烦，那你不做不就好了？'],
    ['narration', '她挑起眉毛，语气轻飘飘的，却精准地刺中了孟空那份关于“想要接近”却又“深怕伤害”的纠结，'],
    ['quoted', '还是说，你其实并没有那么想，只是习惯了把自己当成一个必须负责的照顾者？'],
  ]);
  assert.equal(utterances.map(item => item.anchor).join(''), line, 'the anchors still cover the line end to end');
  // Announced speech stays speech; a phrase set off after a word does not.
  const cases = [
    ['他说“好”。', ['narration', 'quoted']],
    ['他说：“好。”', ['narration', 'quoted']],
    ['所谓“朋友”，不过如此。', ['narration']],
    ['她只说了两个字“再见”', ['narration']],
    ['顾旭禾看着她“你来了？”', ['narration', 'quoted']],
    ['“早。”“嗯。”', ['quoted', 'quoted']],
    ['彼は「はい」と言った。', ['narration', 'quoted', 'narration']],
    ['いわゆる「友達」という関係だ。', ['narration']],
    ['the so-called "friend" was gone.', ['narration']],
    ['she said "hi" and left.', ['narration', 'quoted', 'narration']],
  ];
  for (const [text, kinds] of cases) {
    assert.deepEqual(splitUtterances([{ lineId: 1, text }]).map(item => item.kind), kinds, text);
  }
  // Skipped runs stand between their neighbours and never merge.
  const skipped = splitUtterances([{ lineId: 1, text: '所谓*旁注*“朋友”，不过如此。' }], { skipPairs: ['**'] });
  assert.deepEqual(skipped.map(item => item.kind), ['narration', 'quoted', 'narration']);
});

test('the deep reading is a module of its own, open, on a connection of its own', () => {
  assert.equal(DEEP_STATUS.available, true);
  assert.match(DEEP_PROMPT, /配音导演/);
  const settings = { apiMode: 'tavern', channels: [{ id: 'd1', name: 'deep', url: 'https://deep.example/v1', key: 'k', model: 'thinker' }], tts: { deepChannelId: 'd1' } };
  assert.equal(deepRequestSettings(settings).selectedChannelId, 'd1');
  const unset = { ...settings, tts: { deepChannelId: '' } };
  assert.equal(deepRequestSettings(unset), unset, 'nothing chosen: the translation connection, untouched');
});

test('the deep reading asks why and how strongly, in Fish\'s own words, and keeps its reason for the reader', () => {
  const utterances = splitUtterances([{ lineId: 1, text: '泰罗压低了声音：「我……我要裸奔啦。」' }]);
  const messages = buildVoiceAnalysisMessages(utterances, { roster: ['泰罗'], speakers: new Map([[2, '泰罗']]), hints: new Map([[2, { type: 'dialogue', speaker: '泰罗', emotion: 'shy', intensity: 1 }]]) });
  const system = messages[0].content;
  for (const field of ['why', 'intensity', 'tone', 'speed', 'volume', 'pauses', 'shift', 'sounds', 'skeleton', 'previous', 'styles']) assert.match(system, new RegExp(field), field);
  assert.match(system, /感情浓度/);
  assert.match(system, /硬性要求/);
  assert.match(system, /省力原则/);
  assert.doesNotMatch(system, /direction/, 'no free-text directions: they read badly');
  const input = JSON.parse(messages[1].content);
  assert.deepEqual(input.tones, FISH_TONE_LIST);
  assert.deepEqual(input.sounds, FISH_SOUND_LIST, 'the sounds Fish itself lists, not the free-text ones');
  assert.equal(input.utterances[1].speaker, '泰罗', 'a name the reader set travels with the sentence');
  assert.deepEqual(input.skeleton, [{ id: 2, speaker: '泰罗', emotion: 'shy', intensity: 1 }]);
  // The reply: the reason is kept beside the voice and shown, never sent.
  const parsed = parseVoiceAnalysis(JSON.stringify({ voices: [{ id: 1 }, { id: 2, why: '嘴硬，其实怕被拦下来', emotion: 'nervous', intensity: 2, tone: 'whispering', shift: { at: '裸奔', emotion: 'excited' }, sounds: [{ at: 'start', tag: 'gasping' }] }] }), utterances, { hints: new Map([[2, { type: 'dialogue', speaker: '泰罗', emotion: 'shy' }]]) });
  const voice = parsed.voices.get(2);
  assert.equal(voice.why, '嘴硬，其实怕被拦下来');
  assert.deepEqual(voice.shifts, [{ at: '裸奔', emotion: 'excited' }]);
  assert.ok(voiceSummary(voice).some(([term, value]) => term === '依据' && value === '嘴硬，其实怕被拦下来'));
  const segments = buildSegments(utterances, parsed.labels, { voices: parsed.voices });
  const text = fishTextOf({ segment: segments[1], voiceId: 'v' }, { model: 's2-pro' }, { lean: true });
  assert.equal(text, '[nervous][whispering][gasping] 我……我要 [excited] 裸奔啦。', 'the turn lands as one of Fish\'s words at its word; nothing of the reason goes out');
  assert.equal(DEEP_STATUS.available, true);
});

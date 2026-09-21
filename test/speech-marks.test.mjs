import test from 'node:test';
import assert from 'node:assert/strict';

import { SPEECH_ENTRY_HEAD, readSpeechAttributes, segmentSource, speechMarkedLine, withoutSpeechMarks } from '../core.js';
import { __workflowTesting } from '../workflow.js';
import {
  findCoveringEntry,
  readSpeechLine,
  recordedLines,
  recordPredates,
  speechMarkLabels,
  speechMood,
  speechTagReading,
  splitUtterances,
  stampLabels,
  unitAnalyzedAt,
  buildSegments,
  SPEECH_MOODS,
  FISH_EMOTIONS,
} from '../tts.js';
import { castNameOccurs, refineCast, resolveSpeakers } from '../tts-speakers.js';

// One source line as the reading gets it: marks turned into runs, the utterances cut, the marks read on.
function readLine(source, options = {}) {
  const marked = speechMarkedLine(source);
  const read = marked ? readSpeechLine(marked, options) : { text: source, spans: [] };
  const lines = [{ lineId: 1, text: read.text, speech: read.spans }];
  const utterances = splitUtterances(lines, options);
  return { read, lines, utterances, reading: speechTagReading(utterances, lines) };
}

test('a speaker mark is read however the model half-remembered how to write it', () => {
  assert.deepEqual(readSpeechAttributes(' who="樱井" mood="开心"'), { speaker: '樱井', mood: '开心' });
  assert.deepEqual(readSpeechAttributes(' name=樱井 情绪=害羞/'), { speaker: '樱井', mood: '害羞' }, 'other names for the fields, no quotes, self-closing');
  assert.deepEqual(readSpeechAttributes(' 樱井|生气、大喊'), { speaker: '樱井', mood: '生气、大喊' }, 'the bare form');
  assert.deepEqual(readSpeechAttributes(" speaker='Alice' emotion=“happy”"), { speaker: 'Alice', mood: 'happy' });
  assert.equal(speechMarkedLine('没有标记的一行。'), null, 'a line without marks is left as it always was');
  assert.equal(speechMarkedLine('<saying>不是标记</saying>'), null, 'a tag that only starts with say is not a mark');
});

test('the translator never sees a mark; the reading gets it beside the segment, not on it', () => {
  const segmented = segmentSource('樱井推开门。<say who="樱井" mood="开心">「你回来啦！」</say>\n\n风停了。');
  assert.deepEqual(segmented.segments, [{ id: 1, text: '樱井推开门。「你回来啦！」' }, { id: 2, text: '风停了。' }], 'the text sent to be translated is the story without its marks');
  assert.ok(segmented.speech.has(1));
  assert.equal(segmented.speech.has(2), false);
  assert.match(segmented.layout.find(item => item.type === 'segment').sourceText, /<say who="樱井"/, 'the floor itself keeps them, so the main model keeps writing them');
});

test('each mark lands on the dialogue it wraps, or on the next line of dialogue after it', () => {
  const plain = readLine('樱井推开门。<say who="樱井" mood="开心">「今天也来了吗？」</say>她笑着问。');
  assert.equal(plain.read.text, '樱井推开门。「今天也来了吗？」她笑着问。');
  assert.deepEqual(plain.utterances.map(item => item.kind), ['narration', 'quoted', 'narration']);
  assert.deepEqual(plain.reading.labels.get(2), { type: 'dialogue', speaker: '樱井', emotion: 'happy', speakerSource: 'tag' });
  assert.equal(plain.reading.labels.has(1), false, 'narration is never a speaker\'s');

  // Wrapped, but the quotes were left off: the dialogue is quoted, so it is read as dialogue.
  const bare = readLine('<say who="泰罗" mood="生气、大喊">别碰我的布丁！</say>泰罗吼道。');
  assert.equal(bare.read.text, '「别碰我的布丁！」泰罗吼道。');
  assert.deepEqual(bare.reading.labels.get(1), { type: 'dialogue', speaker: '泰罗', emotion: 'angry', speakerSource: 'tag' });
  assert.deepEqual(bare.reading.voices.get(1), { tone: 'shouting' }, 'a word for loudness goes out as Fish\'s tone');

  // The configured quotes are the ones put round it.
  assert.equal(readLine('<say who="A">走吧</say>', { quotePairs: ['“”'] }).read.text, '“走吧”');
  // Already quoted from outside the mark: nothing is added.
  assert.equal(readLine('「<say who="A">走吧</say>」').read.text, '「走吧」');

  // A mark in front of the line it names, the way a prefix is written.
  const prefixed = readLine('<say 樱井|害羞/>「……谢谢。」小林说：<say name=小林 情绪=温柔>「不客气。」</say>');
  assert.deepEqual([...prefixed.reading.labels].map(([id, label]) => [id, label.speaker, label.emotion]), [[1, '樱井', 'shy'], [3, '小林', 'tender']]);

  // Two lines of dialogue inside one mark are both that speaker's.
  const both = readLine('<say who="樱井">「等等。」她停了一下。「我也去。」</say>');
  assert.deepEqual([...both.reading.labels.keys()], [1, 3]);
});

test('a mood is heard in Fish\'s own words, whichever language the mark wrote it in', () => {
  assert.deepEqual(speechMood('生气、大喊'), { emotion: 'angry', tone: 'shouting' });
  assert.deepEqual(speechMood('happy'), { emotion: 'happy', tone: '' });
  assert.deepEqual(speechMood('悲伤'), { emotion: 'sad', tone: '' }, 'the panel\'s own labels are understood too');
  assert.deepEqual(speechMood('耳语'), { emotion: '', tone: 'whispering' });
  assert.deepEqual(speechMood('不存在的情绪'), { emotion: '', tone: '' });
  for (const [, english] of SPEECH_MOODS) assert.ok(FISH_EMOTIONS.includes(english), `${english} is a word Fish knows`);
});

test('the reader\'s own word still outranks a mark; a mark outranks everything the text only suggests', () => {
  const { utterances, reading } = readLine('泰罗说：<say who="樱井" mood="开心">「走吧。」</say>');
  const tagged = new Map([...reading.labels].map(([id, label]) => [id, label.speaker]));
  const cast = [{ name: '泰罗', aliases: [] }, { name: '樱井', aliases: [] }];
  const byMark = resolveSpeakers(utterances, { cast, tagged });
  assert.deepEqual([byMark.get(2).speaker, byMark.get(2).source], ['樱井', 'tag'], 'the author named her; 「泰罗说」 beside it does not move that');
  const byReader = resolveSpeakers(utterances, { cast, tagged, manual: new Map([[2, '泰罗']]) });
  assert.deepEqual([byReader.get(2).speaker, byReader.get(2).source], ['泰罗', 'manual']);
});

test('a name counts as written only where it is written: whole words for Latin names, any run for the rest', () => {
  assert.equal(castNameOccurs('Ann', 'Anne went home'), false);
  assert.equal(castNameOccurs('Ann', 'Then ann said'), true);
  assert.equal(castNameOccurs('樱井', '樱井美咲推开门'), true);
  assert.equal(castNameOccurs('', 'x'), false);
});

test('the cast a model names keeps only people someone wrote down, one row each, and never the reader', () => {
  const { cast, dropped } = refineCast([
    { name: '艾莉丝', aliases: ['Alice', '爱丽丝大人'], lang: 'en' },
    { name: 'alice', aliases: [] },
    { name: '赛巴斯蒂安' },
    { name: '村民们' },
    { name: '{{user}}' },
    { name: '主人' },
  ], { sourceText: '艾莉丝（Alice）是女仆长。', storyText: '艾莉丝推开门。', exclude: ['主人'] });
  assert.deepEqual(cast, [{ name: '艾莉丝', aliases: ['Alice'], lang: 'en', seen: true }]);
  assert.deepEqual(dropped.map(item => item.name), ['赛巴斯蒂安', '村民们', '{{user}}', '主人']);
});

test('audio is judged by time: made before its sentences were last read, it belongs to the reading before', () => {
  const labels = stampLabels(new Map([[1, { type: 'dialogue', speaker: '樱井' }]]), 500);
  assert.equal(labels.get(1).at, 500);
  const segments = buildSegments([{ id: 1, lineId: 1, kind: 'quoted', text: '好。', anchor: '「好。」' }, { id: 2, lineId: 1, kind: 'narration', text: '她说。', anchor: '她说。' }], labels);
  assert.equal(segments[0].analyzedAt, 500);
  assert.equal('analyzedAt' in segments[1], false, 'narration no reading touched has no moment to be older than');
  assert.equal(unitAnalyzedAt(segments.map(segment => ({ segment }))), 500);
  assert.equal(recordPredates({ createdAt: 499 }, 500), true);
  assert.equal(recordPredates({ createdAt: 500 }, 500), false);
  assert.equal(recordPredates({ createdAt: 1 }, 0), false, 'a sentence never analysed keeps any audio');
  const records = [
    { key: 'old', fingerprint: 'f', createdAt: 400, timeline: [{ id: 1, text: '好。', voiceId: 'v', identity: 'x', lineId: 1 }] },
    { key: 'new', fingerprint: 'f', createdAt: 600, timeline: [{ id: 1, text: '好。', voiceId: 'v', identity: 'x', lineId: 1 }] },
  ];
  assert.equal(findCoveringEntry(records.slice(0, 1), { text: '好。', voiceId: 'v', fingerprint: 'f', identity: 'x', since: 500 }), null, 'the older take is not this reading\'s');
  assert.equal(findCoveringEntry(records, { text: '好。', voiceId: 'v', fingerprint: 'f', identity: 'x', since: 500 }).record.key, 'new');
  assert.deepEqual([...recordedLines([{ timeline: [{ id: 3 }, { id: 9, lineId: 4 }] }], [{ id: 3, lineId: 2 }])].sort(), [2, 4], 'an older entry without its paragraph is placed by its sentence');
});

test('the translator is never handed the request for marks, nor the marks: it could start writing them', () => {
  const entry = [
    SPEECH_ENTRY_HEAD,
    '正文里角色说出口的每一句台词，都用 <say> 标签连同引号一起包起来：',
    '<say who="说话人" mood="情绪">「台词」</say>',
    '例：{{char}}放下茶杯。<say who="{{char}}" mood="温柔">「回来啦？」</say>',
  ].join('\n');
  const lore = `樱井是女仆长。\n${entry}\n老胡开小卖部。`;
  assert.equal(withoutSpeechMarks(lore), '樱井是女仆长。\n老胡开小卖部。', 'the entry goes whole, whatever stands around it');
  assert.equal(__workflowTesting.cleanReferenceText('樱井说：<say who="樱井" mood="开心">「好。」</say>'), '樱井说：「好。」', 'recent floors are quoted without their marks');
  const chunks = __workflowTesting.worldInfoChunks({ worldInfoBefore: '樱井是女仆长。', worldInfoDepth: [{ depth: 1, entries: [entry] }] });
  assert.deepEqual(chunks, ['樱井是女仆长。'], 'the entry sits at a depth of its own and drops out of the worldbook sent along');
});

test('marks read onto the right runs even when a line holds narration between them', () => {
  const lines = [{ lineId: 7, text: '「一。」他说。「二。」', speech: [{ start: 0, end: 4, speaker: '甲', mood: '' }, { start: 7, end: null, speaker: '乙', mood: '' }] }];
  const utterances = splitUtterances(lines);
  assert.deepEqual([...speechMarkLabels(utterances, lines)].map(([id, span]) => [id, span.speaker]), [[1, '甲'], [3, '乙']]);
});

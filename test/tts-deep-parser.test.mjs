import test from 'node:test';
import assert from 'node:assert/strict';

import { SOUND_END_RULE, TTS_ANALYSIS_VERSION, buildSegments, compileVoiceCues, sentenceFishText, splitUtterances } from '../tts.js';
import { DEEP_PROMPT, parseDeepAnalysis, pauseDisplay, stressDisplay } from '../tts-deep.js';

const S2 = { model: 's2-pro' };
const lean = segment => sentenceFishText({ segment, voiceId: 'v' }, S2, { lean: true, directions: false });

// A one-sentence floor, read back as the deep reading's own reply would answer it: the quoted
// utterance's own id, and the sentence it is supposed to reproduce (unquoted, as core's
// splitUtterances already leaves it).
function quoteOf(text) {
  const utterances = splitUtterances([{ lineId: 1, text: `「${text}」` }]);
  return { utterances, quote: utterances.find(item => item.kind === 'quoted') };
}

function fishOf(utterances, labels, voices, id, model = 's2-pro') {
  const segments = buildSegments(utterances, labels, { voices });
  return sentenceFishText({ segment: segments.find(item => item.id === id), voiceId: 'v' }, { model }, { lean: true, directions: false });
}

test('a tag lands on the word it names by its own position, not by the first place that word happens to occur', () => {
  // Alice's name is said twice; a pause the reply wrote right after the second one must not fall on
  // the first — the exact failure compileVoiceCues' own indexOf search would make on its own.
  const { utterances, quote } = quoteOf('Alice看着Alice，笑了。');
  const line = 'Alice看着Alice， [pause] 笑了。';
  const { labels, voices } = parseDeepAnalysis(JSON.stringify({ voices: [{ id: quote.id, emotion: 'happy', line }] }), utterances);
  assert.equal(fishOf(utterances, labels, voices, quote.id), '[happy] Alice看着Alice， [pause] 笑了。');
});

test('the sentence design itself named: a nervous whisper before it, a pause dropped beside the ellipsis it already trails off on', () => {
  const { utterances, quote } = quoteOf('你别靠这么近……会让人看见的。');
  const line = '[nervous] 你别靠这么近…… [pause] 会让人看见的。';
  const { labels, voices, mismatches } = parseDeepAnalysis(JSON.stringify({ voices: [{ id: quote.id, speaker: '林浅', emotion: 'nervous', pace: 'fast', line }] }), utterances);
  assert.deepEqual(mismatches, []);
  assert.equal(labels.get(quote.id).speaker, '林浅');
  // A pause placed right where the sentence already trails off is held to the text like any other
  // reading's: groundVoice takes it out (the ellipsis performs it already), and only the mood is left.
  assert.equal(fishOf(utterances, labels, voices, quote.id), '[nervous] 你别靠这么近……会让人看见的。');
});

test('a line that does not reproduce its sentence keeps only its own opening tags, and reports where it first differed', () => {
  const { utterances, quote } = quoteOf('你先走吧。');
  // A word the sentence never had, plus a mid-sentence tag that must not survive the failed check.
  const line = '[sad] 你先走吧啊。 [pause] 真的。';
  const { labels, voices, mismatches } = parseDeepAnalysis(JSON.stringify({ voices: [{ id: quote.id, emotion: 'sad', line }] }), utterances);
  assert.deepEqual(voices.get(quote.id), { emotion: 'sad' });
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].id, quote.id);
  assert.equal(mismatches[0].sentence, '你先走吧。');
  assert.equal(mismatches[0].at, 4, 'the fourth character (啊) is the first that does not agree');
  assert.equal(labels.get(quote.id).type, 'dialogue', 'the label itself does not depend on the line matching');
});

test('the sentence\'s own quotation marks, reproduced around the line, are taken off before the check', () => {
  const { utterances, quote } = quoteOf('好。');
  const withQuotes = parseDeepAnalysis(JSON.stringify({ voices: [{ id: quote.id, emotion: 'happy', line: '「[happy] 好。」' }] }), utterances);
  assert.deepEqual(withQuotes.mismatches, []);
  assert.deepEqual(withQuotes.voices.get(quote.id), { emotion: 'happy' });
});

test('whisper and snicker, the reference script\'s own words, fold to this reading\'s tone and sound', () => {
  const { utterances, quote } = quoteOf('她笑了笑，转身走了。');
  const line = '[whisper][snicker] 她 [emphasis] 笑了笑，转身走了。';
  const { voices } = parseDeepAnalysis(JSON.stringify({ voices: [{ id: quote.id, emotion: 'happy', line }] }), utterances);
  const voice = voices.get(quote.id);
  assert.equal(voice.tone, 'whispering', 'whisper reads as this reading\'s own whispering');
  assert.deepEqual(voice.sounds, [{ at: 'start', tag: 'chuckling' }], 'snicker reads as this reading\'s own chuckling');
  assert.deepEqual(voice.stress, ['笑'], 'emphasis still lands on the word right after it');
});

test('snicker, laughter, sigh, gasp and groan each fold to the word this reading already sends Fish', () => {
  const cases = [
    ['[snicker] ', 'chuckling'],
    ['[laughter] ', 'laughing'],
    ['[sigh] ', 'sighing'],
    ['[gasp] ', 'gasping'],
    ['[groan] ', 'groaning'],
  ];
  for (const [tag, sound] of cases) {
    const { utterances, quote } = quoteOf('她低声说了一句，我没听清。');
    const line = `${tag}她低声说了一句，我没听清。`;
    const { voices } = parseDeepAnalysis(JSON.stringify({ voices: [{ id: quote.id, emotion: 'sad', line }] }), utterances);
    assert.deepEqual(voices.get(quote.id).sounds, [{ at: 'start', tag: sound }], tag);
  }
});

test('pause and break name the same short pause, long pause and long-break the same long one', () => {
  for (const word of ['pause', 'break']) {
    const { utterances, quote } = quoteOf('走吧，别回头了。');
    const line = `走吧， [${word}] 别回头了。`;
    const { voices } = parseDeepAnalysis(JSON.stringify({ voices: [{ id: quote.id, emotion: 'sad', line }] }), utterances);
    assert.equal(voices.get(quote.id).pauses[0].length, 'short', word);
  }
  for (const word of ['long pause', 'long-break']) {
    const { utterances, quote } = quoteOf('走吧，别回头了。');
    const line = `走吧， [${word}] 别回头了。`;
    const { voices } = parseDeepAnalysis(JSON.stringify({ voices: [{ id: quote.id, emotion: 'sad', line }] }), utterances);
    assert.equal(voices.get(quote.id).pauses[0].length, 'long', word);
  }
});

test('the caps hold even when a reply stacks more tags than this reading asked for', () => {
  // Five tags stand at the sentence's own opening (the cap is three); the fourth clause turns three
  // times over (the cap on turns is two); the same goes for pauses, stress and sounds.
  const { utterances, quote } = quoteOf('你走吧你走吧你快走吧你别回来了。');
  const line = '[sad][angry][happy][excited][worried] 你走吧 [pause] 你走吧 [pause] 你 [emphasis] 快 [emphasis] 走吧 [scared] 你 [nervous] 别 [sighing] 回来了。';
  const { voices } = parseDeepAnalysis(JSON.stringify({ voices: [{ id: quote.id, emotion: 'sad', line }] }), utterances);
  const voice = voices.get(quote.id);
  // Of the five leading tags only three count at all: sad (the emotion already), angry (the second
  // emotion slot) and happy (a tone or sound would have taken the third slot; happy is neither, so it
  // is simply not placed) — excited and worried, past the cap, are never looked at.
  assert.equal(voice.emotion, 'sad');
  assert.equal(voice.secondary, 'angry');
  assert.equal(voice.tone, undefined);
  assert.equal(voice.shifts.length, 2, 'scared and nervous are the two turns this line keeps');
  assert.equal(voice.pauses.length, 2);
  assert.equal(voice.stress.length, 2);
  assert.equal(voice.sounds.length, 1, 'sighing is past the one-sound cap and is dropped');
});

test('an unrecognised word is dropped where it stands, and the rest of the line still reads', () => {
  const { utterances, quote } = quoteOf('这样也好。');
  const line = '[soft] [happy] 这样也好。 [breathy]';
  const { voices } = parseDeepAnalysis(JSON.stringify({ voices: [{ id: quote.id, emotion: 'happy', line }] }), utterances);
  // [soft] names nothing this reading offers (soft tone is the offered word); [happy] still lands.
  assert.equal(voices.get(quote.id).emotion, 'happy');
  assert.equal(voices.get(quote.id).sounds, undefined, '[breathy] is not on offer either, and nothing stands in for it');
});

test('a bare id with nothing beside it is not an answer: it is left exactly as unlabelled as one never named', () => {
  const utterances = splitUtterances([{ lineId: 1, text: '门开了。' }, { lineId: 2, text: '「你来了。」' }]);
  const narration = utterances.find(item => item.kind === 'narration');
  const quote = utterances.find(item => item.kind === 'quoted');
  const { labels, voices } = parseDeepAnalysis(JSON.stringify({ voices: [{ id: narration.id }, { id: quote.id, speaker: '泰罗', line: '你来了。' }] }), utterances);
  assert.equal(labels.has(narration.id), false, 'an id with no speaker, mood, pace or line answers nothing');
  assert.deepEqual(labels.get(quote.id), { type: 'dialogue', speaker: '泰罗' });
  assert.equal(voices.has(quote.id), false, 'a line with no tags carries no voice of its own');
});

test('pace maps to the same speed channel every other reading writes to, and normal writes nothing', () => {
  const { utterances, quote } = quoteOf('慢慢说，不着急。');
  for (const [pace, speed] of [['slow', 'slow'], ['fast', 'fast'], ['normal', undefined], [undefined, undefined]]) {
    const item = { id: quote.id, emotion: 'calm', ...(pace !== undefined ? { pace } : {}) };
    const { voices } = parseDeepAnalysis(JSON.stringify({ voices: [item] }), utterances);
    assert.equal(voices.get(quote.id)?.speed, speed, String(pace));
  }
});

test('narration answers with nothing but its type, and never reaches the voice map', () => {
  const { utterances, quote } = quoteOf('闲人免进');
  const { labels, voices } = parseDeepAnalysis(JSON.stringify({ voices: [{ id: quote.id, type: 'narration' }] }), utterances);
  assert.deepEqual(labels.get(quote.id), { type: 'narration' });
  assert.equal(voices.has(quote.id), false);
});

test('a reply still streaming in is read one closed sentence at a time, the same way every reading\'s partial reply is', () => {
  const { utterances, quote } = quoteOf('你听我说。');
  const partial = `{"voices":[{"id":${quote.id},"speaker":"泰罗","emotion":"calm","line":"你听我说。"}`;
  const { labels } = parseDeepAnalysis(partial, utterances);
  assert.deepEqual(labels.get(quote.id), { type: 'dialogue', speaker: '泰罗', emotion: 'neutral' });
});

test('an analysis stored in the old, structured shape still compiles exactly as it always did', () => {
  // What a floor analysed before this file last changed still holds: a voice keyed by word, not by
  // character offset. Nothing here reads differently for it — parseDeepAnalysis is only ever asked
  // about a fresh reply; a stored one is read back by its own field names, unchanged.
  const utterances = splitUtterances([{ lineId: 1, text: '「我没事，你先回去吧。」' }]);
  const quote = utterances.find(item => item.kind === 'quoted');
  const oldVoice = { emotion: 'resigned', tone: 'soft tone', pauses: [{ after: '我没事', length: 'short' }], stress: ['先'] };
  const segments = buildSegments(utterances, new Map([[quote.id, { type: 'dialogue', speaker: '泰罗', emotion: 'resigned' }]]), {
    voices: new Map([[quote.id, oldVoice]]), evidence: new Map([[quote.id, '她压低声音说：']]),
  });
  assert.equal(lean(segments.find(item => item.id === quote.id)), '[resigned][soft tone] 我没事 [pause] ，你 [emphasis] 先回去吧。');
});

test('the analysis cache key is not moved by this change: the shape a stored deep reading keeps is the shape it always kept', () => {
  assert.equal(TTS_ANALYSIS_VERSION, 4);
});

test('a line that legitimately opens with punctuation utterance.text already lost — an ellipsis, a lead the utterance itself trimmed — is still checked against the sentence, not against the untrimmed anchor the model was shown', () => {
  // splitUtterances trims utterance.text's own leading EDGE_PUNCTUATION_RE run; the model was shown
  // utterance.anchor instead, which still has it, and rule 10 has it copy that lead back verbatim.
  const { utterances, quote } = quoteOf('...没事，你先走吧。');
  assert.equal(quote.text, '没事，你先走吧。', 'the lead is already gone from what this line is checked against');
  const line = '...没事， [pause] 你先走吧。';
  const { voices, mismatches } = parseDeepAnalysis(JSON.stringify({ voices: [{ id: quote.id, emotion: 'sad', line }] }), utterances);
  assert.deepEqual(mismatches, [], 'the two sides agree once the same lead is trimmed from both');
  assert.deepEqual(voices.get(quote.id).pauses, [{ after: '，', length: 'short' }]);
  assert.equal(fishOf(utterances, new Map([[quote.id, { type: 'dialogue' }]]), voices, quote.id), '[sad] 没事， [pause] 你先走吧。');
});

test('lang, offered by the deep prompt\'s own {{lang_rule}}, is read onto the label the same way every other reading reads it', () => {
  const { utterances, quote } = quoteOf('Na gut, gehen wir.');
  const { labels } = parseDeepAnalysis(JSON.stringify({ voices: [
    { id: quote.id, speaker: 'Karl', emotion: 'neutral', lang: 'de', line: 'Na gut, gehen wir.' },
  ] }), utterances);
  assert.equal(labels.get(quote.id).lang, 'de');
});

test('the console\'s own field names (speed, intensity — the ones its rules actually say to write) are read the same as pace and emotion', () => {
  const { utterances, quote } = quoteOf('慢慢说，不着急。');
  const { voices } = parseDeepAnalysis(JSON.stringify({ voices: [
    { id: quote.id, speaker: '甲', emotion: 'calm', speed: 'slow', intensity: 0, line: '慢慢说，不着急。' },
  ] }), utterances);
  assert.equal(voices.get(quote.id).speed, 'slow', 'speed is read the same as pace when pace itself is absent');
  assert.equal(voices.get(quote.id).intensity, 0, 'intensity is read even though it is not part of the new schema\'s own example');
});

test('pace still wins over speed when a reply somehow carries both', () => {
  const { utterances, quote } = quoteOf('慢慢说，不着急。');
  const { voices } = parseDeepAnalysis(JSON.stringify({ voices: [
    { id: quote.id, emotion: 'calm', pace: 'fast', speed: 'slow', line: '慢慢说，不着急。' },
  ] }), utterances);
  assert.equal(voices.get(quote.id).speed, 'fast', 'this reading\'s own field is read first');
});

test('a reply built for a reader\'s old, pre-v0.37 custom deep prompt — the structured fields, no line — still reads exactly as the simple reading already reads that shape', () => {
  const { utterances, quote } = quoteOf('我没事，你先回去吧。');
  const oldItem = {
    id: quote.id, speaker: '林浅', emotion: 'resigned', intensity: 2,
    tone: 'soft tone', pauses: [{ after: '我没事' }], stress: ['先'],
  };
  const { labels, voices } = parseDeepAnalysis(JSON.stringify({ voices: [oldItem] }), utterances);
  assert.equal(labels.get(quote.id).speaker, '林浅');
  assert.deepEqual(voices.get(quote.id), {
    emotion: 'resigned', intensity: 2, tone: 'soft tone',
    pauses: [{ after: '我没事', length: 'short' }], stress: ['先'],
  });
});

test('a reply with neither a line nor any of the old structured fields is still nothing said, exactly as before', () => {
  const { utterances, quote } = quoteOf('走吧。');
  const { labels } = parseDeepAnalysis(JSON.stringify({ voices: [{ id: quote.id }] }), utterances);
  assert.equal(labels.has(quote.id), false);
});

test('the reader\'s own configured quote pair, not only the four default ones, is taken off the edge of a reproduced line', () => {
  const utterances = splitUtterances([{ lineId: 1, text: '【你好，我到了】' }], { quotePairs: ['【】'] });
  const quote = utterances.find(item => item.kind === 'quoted');
  const line = '【你好， [pause] 我到了】';
  // Proof the bug is real: without telling the parser which pairs are configured, the reproduced 【】
  // is read as part of the sentence, and the whole line — including the pause — fails the check.
  const naive = parseDeepAnalysis(JSON.stringify({ voices: [{ id: quote.id, emotion: 'happy', line }] }), utterances);
  assert.equal(naive.mismatches.length, 1);

  const fixed = parseDeepAnalysis(JSON.stringify({ voices: [{ id: quote.id, emotion: 'happy', line }] }), utterances, { quotePairs: ['【】'] });
  assert.deepEqual(fixed.mismatches, []);
  assert.deepEqual(fixed.voices.get(quote.id).pauses, [{ after: '，', length: 'short' }]);
});

test('a bracketed run the sentence itself was written with (a status line, a system message) is not mistaken for one of this reading\'s own tags', () => {
  const { utterances, quote } = quoteOf('[警告]能量不足，所有人立刻撤离');
  const line = '[警告]能量不足， [pause] 所有人立刻撤离';
  const { voices, mismatches } = parseDeepAnalysis(JSON.stringify({ voices: [{ id: quote.id, emotion: 'urgent', line }] }), utterances);
  assert.deepEqual(mismatches, [], 'the sentence\'s own [警告] is text, not a tag to strip out from under it');
  assert.deepEqual(voices.get(quote.id).pauses, [{ after: '，', length: 'short' }]);
});

test('the prompt\'s own worked example does not place a pause where its own rule 8 says punctuation already stops', () => {
  const match = DEEP_PROMPT.match(/"line":"((?:[^"\\]|\\.)*)"/);
  assert.ok(match, 'the worked example carries a line field');
  const line = match[1];
  const pauseAt = line.indexOf('[pause]');
  assert.ok(pauseAt > 0, 'the example still shows a mid-sentence pause');
  const before = line.slice(0, pauseAt).replace(/\[[^\]]*\]\s*/g, '').trimEnd();
  assert.equal(/[…—～]$/.test(before), false, `a pause must not sit right where trailing-off punctuation already stops, per rule 8: "${before}"`);
});

test('SOUND_END_RULE, shared by every prompt that uses it, no longer names an "end" field the deep prompt\'s own output format never defines', () => {
  assert.equal(/\bend\b/i.test(SOUND_END_RULE), false, 'the deep prompt never asks the model for an "end" field, so the shared rule must not name one');
  assert.ok(DEEP_PROMPT.includes(SOUND_END_RULE), 'the deep prompt still carries the rule itself, just not the bare English word');
});

test('a pause anchor is widened toward its own start for the panel, keeping the edge the pause actually lands on untouched', () => {
  const text = '你别靠这么近会让人看见的。';
  assert.equal(pauseDisplay(text, '近'), '你别靠这么近', 'widens left, all the way to the start of this clause');
  assert.equal(pauseDisplay(text, '不存在的词'), '不存在的词', 'an anchor the text no longer has shows exactly as it is, unchanged');
  assert.equal(pauseDisplay(text, ''), '', 'no anchor, nothing to widen');
});

test('a stress anchor is widened toward its own end for the panel, keeping the edge the stress actually starts on untouched', () => {
  const text = '你去给别人喝吧，也不是不行。';
  assert.equal(stressDisplay(text, '喝'), '喝吧', 'widens right, stopping at the comma');
  assert.equal(stressDisplay(text, '别人喝'), '别人喝吧', 'widening never moves the start the model actually pointed at');
});

test('widening a pause/stress anchor for the panel does not run past a fixed margin on text with no punctuation to stop it', () => {
  // A long run of the same word character with nothing else to stop at: the anchor itself is unique
  // only at the very end, so widening left has nowhere to give up except its own bounded margin.
  const text = `${'啊'.repeat(20)}喝`;
  const widened = pauseDisplay(text, '喝');
  assert.ok(widened.endsWith('喝'));
  assert.ok(widened.length <= 7, `widening stops at a fixed margin rather than running to the start of the text: "${widened}"`);
});

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

test('only a sentence that carries a tag is copied out as a line; the rest answer in fields, so a long floor is not written out twice', () => {
  const example = JSON.parse(DEEP_PROMPT.split('\n')[1].match(/\{"voices".*\]\}/)[0]).voices;
  const bare = example.find(item => item.type !== 'narration' && !Object.hasOwn(item, 'line'));
  assert.ok(bare, 'the worked example shows a spoken sentence with no line');
  assert.ok(bare.emotion && bare.speaker);
  assert.match(DEEP_PROMPT, /line 只给要加标签的句子写/);
  assert.match(DEEP_PROMPT, /大多数句子一个标签都不用加，也就不写 line/);
  // The copy is checked by the program; the model is not asked to check it again in its head.
  assert.doesNotMatch(DEEP_PROMPT, /line 去掉标签、去掉首尾引号后和正文这句逐字一样；/);
  assert.match(DEEP_PROMPT, /由程序逐字核对/);

  const { utterances, quote } = quoteOf('你怎么才来');
  const { labels, voices, mismatches } = parseDeepAnalysis(JSON.stringify({ voices: [{ id: quote.id, speaker: '林浅', emotion: 'worried' }] }), utterances);
  assert.deepEqual(mismatches, [], 'no line is not a line that failed to match');
  assert.equal(labels.get(quote.id).speaker, '林浅');
  assert.equal(voices.get(quote.id).emotion, 'worried');
  assert.equal(fishOf(utterances, labels, voices, quote.id), '[worried] 你怎么才来');
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

test('SOUND_END_RULE scopes its condition to the line within its own paragraph, the same condition rule 6 states for using `end`, not to the paragraph being the floor\'s last one', () => {
  // "这一句所在段落后面又没有别的正文" reads most naturally as "nothing after the paragraph this line is
  // in" — i.e. this is the floor's last paragraph — which is not what groundVoice actually checks and
  // not what rule 6 (同一段里这句后面还有正文时用 end) or the comment above this constant says. The
  // wording must instead be scoped inside the line's own paragraph, matching rule 6's own phrasing.
  assert.match(SOUND_END_RULE, /同一段里这句后面又没有别的正文/, `must read "nothing more after this line, within its own paragraph", matching rule 6's condition: "${SOUND_END_RULE}"`);
});

test('a pause anchor is widened toward its own start for the panel, by the real word it opens rather than a character class, keeping the edge the pause actually lands on untouched', () => {
  const text = '他们说的那些话我都听见了只是不想理。';
  // '听见了' is one word to real word segmentation (Intl.Segmenter); the old character-class/margin
  // widening cut in mid-word instead, landing on '些话我都听见了'.
  assert.equal(pauseDisplay(text, '了'), '听见了', 'widens left to the start of the word segment the anchor itself sits in');
  const wholeAlready = '你别靠这么近会让人看见的。';
  assert.equal(pauseDisplay(wholeAlready, '近'), '近', '近 is already a whole word by itself, so there is nothing to widen it into');
  assert.equal(pauseDisplay(text, '不存在的词'), '不存在的词', 'an anchor the text no longer has shows exactly as it is, unchanged');
  assert.equal(pauseDisplay(text, ''), '', 'no anchor, nothing to widen');
});

test('a stress anchor is widened toward its own end for the panel, by the real word it starts rather than a character class, keeping the edge the stress actually starts on untouched', () => {
  const text = '我根本不在乎你说什么。';
  // '根本' is one word to real word segmentation; the old character-class/margin widening ran on past
  // it to the six-character cap, landing on '根本不在乎你说'.
  assert.equal(stressDisplay(text, '根'), '根本', 'widens right to the end of the word segment the anchor itself sits in');
  const wholeAlready = '你去给别人喝吧，也不是不行。';
  assert.equal(stressDisplay(wholeAlready, '喝'), '喝', '喝 is already a whole word by itself, so there is nothing to widen it into');
  assert.equal(stressDisplay(wholeAlready, '别人喝'), '别人喝', 'widening never moves the start the model actually pointed at, nor shrinks what was already there');
});

test('widening a pause/stress anchor for the panel follows the real word boundary (Intl.Segmenter) past the old fixed character margin, rather than cutting a longer word short', () => {
  // A run of digits or Latin letters with nothing else in it is one word to a segmenter however long,
  // unlike the old character-class margin, which gave up after six characters no matter what.
  const stressText = '打这个号码13800138000就对了';
  assert.equal(stressDisplay(stressText, '1'), '13800138000', 'widens right across the whole number, well past the old six-character margin');
  const pauseText = '输入这个网址abcdefghij就能看到';
  assert.equal(pauseDisplay(pauseText, 'j'), 'abcdefghij', 'widens left across the whole word, well past the old six-character margin');
});

test('a Japanese kanji stem is widened through its own okurigana for the panel, past the boundary Intl.Segmenter cuts it at for lack of a dictionary', () => {
  // Without a Japanese dictionary, Intl.Segmenter tells 聞こえた apart from its own conjugation
  // (聞|こ|え|た) and 寂しく from its own kanji (寂|しく), so wordBoundsAt alone hands back just the
  // stem's own single character. The panel must still show the whole word, not the cut-off stem.
  const pauseText = '彼らが言ったことは全部聞こえたけど、無視したいだけ。';
  assert.equal(pauseDisplay(pauseText, 'えた'), '聞こえた', 'widens left through the okurigana and the kanji stem it hangs off of');
  const stressText = '別に、寂しくなんかないし。';
  assert.equal(stressDisplay(stressText, '寂'), '寂しく', 'widens right through the okurigana attached to the kanji stem, and no further');
});

test('the okurigana widening never moves a word already found whole, and never fires on a lone kanji that is simply a whole Chinese word', () => {
  // こと is already its own whole segment to Intl.Segmenter; nothing here should touch it, chain past
  // it into 全部, or run at all when there is no hiragana anywhere for the extension to key off of.
  const pauseText = '彼らが言ったことは全部聞こえたけど、無視したいだけ。';
  assert.equal(pauseDisplay(pauseText, 'こと'), 'こと', 'a word already whole is left exactly as it is');
  const stressText = '別に、寂しくなんかないし。';
  assert.equal(stressDisplay(stressText, '寂しく'), '寂しく', 'widening never chains past the word it just found into the next one (なんか)');
  // 近 is a whole Chinese word on its own (你别靠这么近...); a lone kanji seed by itself must not
  // trigger the Japanese-only extension just because kanji also happens to be Han script in Chinese.
  assert.equal(pauseDisplay('你别靠这么近会让人看见的。', '近'), '近', '近 is a complete Chinese word; nothing here may widen it as if it were an okurigana stem');
});

test('the okurigana widening covers common Japanese conjugations generally, past the two shapes (聞こえた, 寂しく) it was first tested against', () => {
  // Intl.Segmenter often groups a whole run of okurigana into one multi-character segment rather than
  // single kana (寝ていた -> 寝|てい|た). A pause anchored on いた sits inside that two-character てい
  // segment, which the old code refused to widen past at all because it was not exactly one character.
  const sleepText = '寝ていたけど、物音で目が覚めた。';
  assert.equal(pauseDisplay(sleepText, 'いた'), '寝ていた', 'widens left across a multi-character okurigana segment (てい) directly off its kanji stem (寝)');
  // Same shape on a different verb: べた is its own two-character segment, not a lone kana.
  const ateText = '本当に食べたかったのに、我慢した。';
  assert.equal(pauseDisplay(ateText, 'た'), '食べた', 'widens left through a multi-character okurigana segment (べた) back to its kanji stem (食)');
  // On the right, the old code crossed exactly one following segment (聞こ). A longer conjugation needs
  // more than one hop (こ, え, た) before it reaches a real word boundary — here the trailing けど.
  const heardText = '全部聞こえたけど、無視したいだけ。';
  assert.equal(stressDisplay(heardText, '聞'), '聞こえた', 'keeps absorbing okurigana segments past the first one, all the way to the end of the conjugation');
  // Same idea one hiragana hop deeper (さ, then ない), stopping before the trailing から.
  const forgiveText = '絶対に許さないから、覚悟しておいて。';
  assert.equal(stressDisplay(forgiveText, '許'), '許さない', 'keeps absorbing across more than one hop, still stopping at a trailing particle (から)');
  // って closes the sentence the same way から and けど do above.
  const goText = '私は行かないって。';
  assert.equal(stressDisplay(goText, '行'), '行かない', 'stops at って the same way it stops at から and けど, instead of only crossing the first segment (行か)');
});

test('the wider okurigana rules still stop at a real word boundary instead of chaining into an unrelated word or particle', () => {
  // こと is preceded by hiragana (った), not a kanji segment, so the new multi-character allowance on
  // the left must not fire for it — same expectation as the existing whole-word test above, restated
  // here because it is exactly what the wider left-side rule must keep rejecting.
  const gotchaText = '彼らが言ったことは全部聞こえたけど、無視したいだけ。';
  assert.equal(pauseDisplay(gotchaText, 'こと'), 'こと', 'preceded by hiragana rather than a kanji stem, so it is left exactly where it was found');
  // なんか is pure hiragana and sits right after しく, but it is a separate word (a particle), not more
  // of the same conjugation, so the right-side widening must stop before it even though it never hits
  // OKURIGANA_MARGIN or a non-hiragana character.
  const sadText = '別に、寂しくなんかないし。';
  assert.equal(stressDisplay(sadText, '寂'), '寂しく', 'stops before なんか instead of chaining into the next word');
});

test('a stress on a kanji stem takes its first okurigana segment even when that segment looks like a particle', () => {
  assert.equal(stressDisplay('ちょっと待ってくれ。', '待'), '待って', 'te-form: って right after the stem is its conjugation, and it stops there');
  assert.equal(stressDisplay('全部話してよ。', '話'), '話して', 'し right after the stem, then stops at よ');
  assert.equal(stressDisplay('みんな笑わないで。', '笑'), '笑わない', 'a-row negative: わ right after the stem');
  assert.equal(stressDisplay('もう死にたい。', '死'), '死にたい', 'に right after the stem');
  assert.equal(stressDisplay('猫が好きだ。', '猫'), '猫', 'a case particle is never okurigana, so a noun stays itself');
});

test('a pause after an auxiliary ending shows the whole conjugated verb, not just the ending', () => {
  assert.equal(pauseDisplay('許さないから。', 'ない'), '許さない');
  assert.equal(pauseDisplay('まだ寝ているよ。', 'いる'), '寝ている');
  assert.equal(pauseDisplay('彼に言われるなんて。', 'れる'), '言われる');
  assert.equal(pauseDisplay('行きたい。', 'たい'), '行きたい', 'a stem the segmenter kept with its own kana still counts');
  assert.equal(pauseDisplay('言ったこと', 'こと'), 'こと', 'a whole word after a verb is left as it is');
  assert.equal(pauseDisplay('ここにいる。', 'いる'), 'いる', 'no kanji stem to reach, so nothing to widen into');
});

test('a stress on a noun followed by a particle stops at the particle instead of running into the next word', () => {
  for (const [text, word, shown] of [['家にいる。', '家', '家に'], ['君といたい。', '君', '君と'], ['私にください。', '私', '私に'], ['雨でぬれた。', '雨', '雨で'], ['猫ってかわいい', '猫', '猫って'], ['変なやつ', '変', '変な'], ['前にいた', '前', '前に']]) {
    assert.equal(stressDisplay(text, word), shown, text);
  }
});

test('a pause after an auxiliary ending does not widen back across a particle', () => {
  for (const [text, shown] of [['時間がない。', 'ない'], ['意味がない', 'ない'], ['誰もいない', 'ない'], ['本ではない', 'ない'], ['俺にはもう何もない', 'ない']]) {
    assert.equal(pauseDisplay(text, 'ない'), shown, text);
  }
  for (const [text, shown] of [['家にいる', 'いる'], ['彼がいる', 'いる'], ['友達がいるよ', 'いる'], ['話している', '話している']]) {
    assert.equal(pauseDisplay(text, 'いる'), shown, text);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANNOTATION_SOUNDS,
  DEFAULT_TTS_PROMPTS,
  FISH_EMOTIONS,
  FISH_EMOTION_GROUPS,
  FISH_SOUNDS,
  FISH_TONES,
  SOFT_MOODS,
  SOUND_CUES,
  SOUND_EVIDENCE,
  SOUND_GROUNDS,
  SOUND_END_RULE,
  SOUND_PLACE_RULE,
  SOUND_TAGS,
  SPOKEN_SOUNDS,
  TONE_CUES,
  annotationReading,
  buildSegments,
  compileVoiceCues,
  deriveLabelsForSide,
  groundVoice,
  itemIdentity,
  parseVoiceAnalysis,
  recordingCacheKey,
  sentenceFishText,
  splitUtterances,
} from '../tts.js';
import { normalizeEmotion } from '../palette.js';
import { DEEP_PROMPT, buildDeepAnalysisMessages } from '../tts-deep.js';
import { pinSpeakers } from '../tts-speakers.js';

const S2 = { model: 's2-pro' };
const lean = segment => sentenceFishText({ segment, voiceId: 'v' }, S2, { lean: true, directions: false });
const withVoices = (lines, voices, labels = new Map(), options = {}) => {
  const utterances = splitUtterances(lines);
  return { utterances, segments: buildSegments(utterances, labels, { voices: new Map(voices), ...options }) };
};

test('every word a prompt names for a sound or a quiet tone is one the check before Fish accepts', () => {
  // The sounds the analyses are offered are exactly the ones with words to call for them.
  assert.deepEqual([...Object.keys(SOUND_CUES)].sort(), [...SPOKEN_SOUNDS].sort());
  assert.deepEqual(SPOKEN_SOUNDS.filter(sound => ['moaning', 'crowd laughing', 'background laughter', 'audience laughing'].includes(sound)), [], 'no moan, and the room\'s laughter is nobody\'s line');
  assert.deepEqual(ANNOTATION_SOUNDS.filter(sound => ['panting', 'groaning', 'moaning'].includes(sound)), [], 'the translation marks no drawn-out sound');
  assert.equal(FISH_EMOTIONS.includes('flirtatious'), false);
  for (const [sound, words] of Object.entries(SOUND_CUES)) {
    for (const word of words) assert.match(word, SOUND_EVIDENCE[sound], `${word} grounds ${sound}`);
  }
  for (const pair of SOUND_GROUNDS.split('；')) {
    const [words, sound] = pair.split('→');
    assert.ok(SPOKEN_SOUNDS.includes(sound));
    for (const word of words.split('、')) assert.match(word, SOUND_EVIDENCE[sound]);
  }
  // A quiet tone the prompt says the text asks for is one the check lets through.
  for (const word of [...TONE_CUES.whispering, ...TONE_CUES['soft tone']]) {
    assert.equal(groundVoice({ tone: 'whispering' }, { text: '今晚别走。', evidence: `她${word}说` }).changed, false, word);
  }
  // Every prompt that asks for sounds says them the same way.
  for (const prompt of [DEFAULT_TTS_PROMPTS.simple, DEFAULT_TTS_PROMPTS.refine, DEEP_PROMPT]) {
    assert.ok(prompt.includes(SOUND_GROUNDS));
    assert.doesNotMatch(prompt, /moaning|flirtatious|slightly|very/);
  }
});

test('what calls for a sound is what the narration says, not a smile, a joke or a moan', () => {
  const heard = (sound, narration) => groundVoice({ sounds: [{ at: 'start', tag: sound }] }, { text: '你到底想怎样。', evidence: narration }).changed === false;
  assert.ok(heard('laughing', '她笑出了声'));
  assert.ok(heard('gasping', '他倒抽一口冷气'));
  assert.ok(heard('gasping', '她吸了一口凉气'));
  assert.ok(heard('gasping', '彼女ははっと息を呑んだ'));
  assert.ok(heard('panting', '他喘着气跑过来'));
  assert.ok(heard('sighing', '彼はため息をついた'));
  // What reads like a sound and is not one.
  for (const [sound, narration] of [
    ['panting', '她娇喘着'], ['panting', '甘い喘ぎ声が漏れた'], ['panting', 'He pulled on his pants.'],
    ['laughing', '她露出笑顔'], ['laughing', '别开玩笑了'], ['laughing', '她微微一笑'], ['laughing', '他笑了笑'],
    ['gasping', '他深吸了一口气'], ['sighing', '他感叹道'], ['sighing', 'The sight of it'],
    ['groaning', '她呻吟了一声'], ['crying loudly', '他放声大笑'],
  ]) assert.equal(heard(sound, narration), false, `${narration} is no ${sound}`);
});

test('a sound is heard only where the narration writes it for that line, once for each time it is written', () => {
  const sighing = { emotion: 'sad', sounds: [{ at: 'start', tag: 'sighing' }] };
  // The sigh on its own line before the quote, or after it: both are this line's.
  for (const lines of [
    [{ lineId: 1, text: '她叹了口气。' }, { lineId: 2, text: '「算了。」' }],
    [{ lineId: 1, text: '「算了，随你吧。」' }, { lineId: 2, text: '她叹了口气，转身走了。' }],
  ]) {
    const quote = splitUtterances(lines).find(item => item.kind === 'quoted');
    const voiced = buildSegments(splitUtterances(lines), new Map(), { voices: new Map([[quote.id, sighing]]) });
    assert.deepEqual(voiced.find(item => item.id === quote.id).voice.sounds, [{ at: 'start', tag: 'sighing' }], lines.map(line => line.text).join(''));
  }
  // A sigh in a neighbouring paragraph that has its own speaker is that speaker's.
  const theirs = splitUtterances([{ lineId: 1, text: '樱井叹了口气：「好吧。」' }, { lineId: 2, text: '「你呢？」' }]);
  const other = theirs.find(item => item.text === '你呢？');
  assert.equal(buildSegments(theirs, new Map(), { voices: new Map([[other.id, sighing]]) }).find(item => item.id === other.id).voice.sounds, undefined);
  // 笑 inside the quote is a word said, not a laugh written.
  const said = splitUtterances([{ lineId: 1, text: '「你笑什么？」' }]);
  assert.equal(buildSegments(said, new Map(), { voices: new Map([[1, { emotion: 'happy', sounds: [{ at: 'start', tag: 'chuckling' }] }]]) })[0].voice.sounds, undefined);
  // One laugh written, two lines asking for it: the first has it.
  const twice = splitUtterances([{ lineId: 1, text: '「真的吗，你没骗我？」她笑出了声，「那太好了。」' }]);
  const [first, second] = twice.filter(item => item.kind === 'quoted');
  const laughs = buildSegments(twice, new Map(), { voices: new Map([[first.id, { sounds: [{ at: 'end', tag: 'laughing' }] }], [second.id, { sounds: [{ at: 'start', tag: 'laughing' }] }]]) });
  assert.deepEqual(laughs.find(item => item.id === first.id).voice.sounds, [{ at: 'end', tag: 'laughing' }]);
  assert.equal(laughs.find(item => item.id === second.id).voice, null);
  // One sound to a sentence; a moan never, written or not; a laugh on top of the line's own 哈哈 never.
  const crowded = groundVoice({ sounds: [{ at: 'start', tag: 'panting' }, { at: 'start', tag: 'sighing' }, { at: 'start', tag: 'moaning' }] }, { text: '你别这样，我受不了了。', evidence: '她喘着气，叹了一声，呻吟起来' });
  assert.deepEqual(crowded.voice.sounds, [{ at: 'start', tag: 'panting' }]);
  assert.deepEqual(crowded.dropped.map(item => item.why), ['count', 'unknown']);
  assert.deepEqual(groundVoice({ sounds: [{ at: 'start', tag: 'laughing' }] }, { text: '哈哈，你真逗。', evidence: '她大笑' }).dropped.map(item => item.why), ['said']);
  // Nothing written: the sound goes, the mood stays, and nothing else changes.
  const bare = groundVoice({ emotion: 'nervous', sounds: [{ at: 'start', tag: 'panting' }] }, { text: '你别这样。', evidence: '她靠过来。' });
  assert.deepEqual(bare.voice, { emotion: 'nervous' });
  assert.deepEqual(bare.dropped.map(item => item.why), ['no-text']);
  // Written only in the other language still counts.
  const japanese = splitUtterances([{ lineId: 1, text: '「等一下。」' }]);
  const counted = buildSegments(japanese, new Map(), { voices: new Map([[1, { sounds: [{ at: 'start', tag: 'panting' }] }]]), evidence: new Map([[1, '彼女は息を切らして言った：「待って」']]) });
  assert.deepEqual(counted[0].voice.sounds, [{ at: 'start', tag: 'panting' }]);
});

test('a pause or a sound beside a trailing-off mark is taken out, and so is a pause with nothing after it', () => {
  const held = groundVoice({ emotion: 'sad', pauses: [{ after: '不', length: 'long' }, { after: '又甜', length: 'short' }, { after: '又酸', length: 'short' }] }, { text: '不……又甜又酸。' });
  assert.deepEqual(held.voice.pauses, [{ after: '又甜', length: 'short' }]);
  assert.deepEqual(held.dropped.map(item => item.why), ['drawn-out', 'bare-end']);
  const panting = groundVoice({ emotion: 'shy', sounds: [{ at: 'start', tag: 'panting' }] }, { text: '……哈啊，别这样。', evidence: '她喘着气' });
  assert.deepEqual(panting.voice, { emotion: 'shy' });
  assert.equal(panting.dropped[0].why, 'drawn-out');
  const sigh = groundVoice({ emotion: 'sad', sounds: [{ at: 'after', after: '不', tag: 'sighing' }] }, { text: '不……又甜又酸。', evidence: '她叹气' });
  assert.equal(sigh.dropped[0].why, 'drawn-out');
  assert.equal(groundVoice({ sounds: [{ at: 'end', tag: 'sighing' }] }, { text: '好舒服♡', evidence: '她叹气' }).dropped[0].why, 'drawn-out');
});

test('a line of nothing but 嗯 and 啊 keeps a plain mood and a shout, and loses what is laid inside it', () => {
  const plain = (text, voice) => lean({ id: 1, type: 'dialogue', text, voice: groundVoice(voice, { text, evidence: '她喘着气，小声说' }).voice });
  assert.equal(plain('诶？！', { emotion: 'surprised' }), '[surprised] 诶？！');
  assert.equal(plain('おい！', { emotion: 'angry', tone: 'shouting' }), '[angry][shouting] おい！');
  assert.equal(plain('……嗯。', { emotion: 'tender', tone: 'whispering' }), '……嗯。', 'a tender whisper over 嗯 is the moan');
  assert.equal(plain('啊♡', { emotion: 'embarrassed', sounds: [{ at: 'start', tag: 'panting' }] }), '啊♡');
  assert.equal(plain('哈啊……哈啊……', { emotion: 'nervous', pauses: [{ after: '哈啊', length: 'short' }] }), '[nervous] 哈啊……哈啊……');
  assert.equal(plain('Mmm…', { emotion: 'shy', speed: 'slow' }), 'Mmm…');
  // A word or two keeps a mood, a tone and the sound the narration wrote, and nothing placed inside it.
  const short = groundVoice({ emotion: 'angry', tone: 'shouting', stress: ['滚'], shifts: [{ at: '滚', emotion: 'sad' }], sounds: [{ at: 'start', tag: 'groaning' }] }, { text: '滚！', evidence: '他闷哼一声' });
  assert.deepEqual(short.voice, { emotion: 'angry', tone: 'shouting', sounds: [{ at: 'start', tag: 'groaning' }] });
  const laughed = splitUtterances([{ lineId: 1, text: '她噗嗤一声笑了：「笨蛋。」' }]);
  assert.deepEqual(buildSegments(laughed, new Map(), { voices: new Map([[2, { sounds: [{ at: 'start', tag: 'chuckling' }] }]]) })[1].voice.sounds, [{ at: 'start', tag: 'chuckling' }]);
});

test('only moods Fish knows reach it, a quiet voice needs the text to ask for it, and a turn has to turn', () => {
  const sentence = '今晚留下来陪我好不好？';
  assert.equal(groundVoice({ emotion: 'aroused' }, { text: sentence }).voice, null, 'a free-form mood is what S2 acts out literally');
  assert.equal(groundVoice({ emotion: 'flirtatious' }, { text: sentence }).voice, null);
  assert.equal(groundVoice({ emotion: 'very sad', intensity: 2 }, { text: sentence }).voice.emotion, 'sad', 'the strength rides on the intensity, not on the word');
  assert.deepEqual(groundVoice({ emotion: 'shy', tone: 'whispering' }, { text: sentence }).voice, { emotion: 'shy' });
  assert.deepEqual(groundVoice({ emotion: 'shy', tone: 'whispering' }, { text: sentence, evidence: '她凑到他耳边小声说' }).voice, { emotion: 'shy', tone: 'whispering' });
  assert.equal(groundVoice({ emotion: 'breathy' }, { text: sentence }).voice, null, 'breathy folds to a whisper, which the text did not ask for');
  // A turn at the head of the line, or to the mood it is already in, is no turn.
  const turns = groundVoice({ emotion: 'happy', shifts: [{ at: '今晚', emotion: 'sad' }, { at: '陪我', emotion: 'happy' }, { at: '好不好', emotion: 'sultry' }, { at: '留下来', emotion: 'nervous' }] }, { text: sentence });
  assert.deepEqual(turns.voice.shifts, [{ at: '留下来', emotion: 'nervous' }]);
  assert.deepEqual(turns.dropped.map(item => item.why), ['turn', 'turn', 'unknown']);
  // The reading's own word was one Fish does not hear: the label's mood stands in, held to the same text.
  const { segments } = withVoices([{ lineId: 1, text: '「你别过来。」' }], [[1, { emotion: 'aroused and scared' }]], new Map([[1, { type: 'dialogue', emotion: 'fear' }]]));
  assert.equal(lean(segments[0]), '[scared] 你别过来。');
  // A strong tender mood from the palette brings no quiet tone the text never asked for.
  assert.equal(lean({ id: 1, type: 'dialogue', text: '今晚留下来陪我好不好？', voice: { emotion: 'flirtatious', intensity: 2 } }), '[tender] 今晚留下来陪我好不好？');
});

test('what Fish never hears is left alone, so a reading that changes nothing audible keeps its recording', async () => {
  const text = '热死了，我才不想喝。';
  const voice = { emotion: 'frustrated', intensity: 2, secondary: 'relieved and flirty', breath: 'audible', why: '嘴硬', sounds: [{ at: 'start', tag: '冷哼' }] };
  const held = groundVoice(voice, { text });
  assert.equal(held.changed, false);
  assert.equal(held.voice, voice, 'the very same object');
  const utterances = splitUtterances([{ lineId: 1, text: `「${text}」` }]);
  const segments = buildSegments(utterances, new Map([[1, { type: 'dialogue', speaker: '泰罗' }]]), { voices: new Map([[1, voice]]) });
  const key = async segment => recordingCacheKey({ floorId: 'f', version: 'v', items: [{ segment, voiceId: 'v' }], fingerprint: {} });
  assert.equal(await key(segments[0]), await key({ ...segments[0], voice }));
  // The Chinese sound Fish never had a word for still reaches nobody.
  assert.equal(compileVoiceCues(segments[0], { lean: true }).cues.join(''), '[frustrated]');
});

test('the analyses ask for every line in order, the minimal answer for an unread one, and a quote that is not speech read as narration', () => {
  for (const prompt of [DEFAULT_TTS_PROMPTS.simple, DEEP_PROMPT]) {
    assert.match(prompt, /每个编号都要回答，按编号从小到大|每个 ⟦编号⟧ 都要回答，按编号从小到大/);
    assert.match(prompt, /\{"id":N,"type":"dialogue"\}/);
    assert.match(prompt, /\{"id":N,"type":"narration"\}/);
    assert.doesNotMatch(prompt, /写 calm|calm 凑数(?!。)/);
  }
  assert.match(DEEP_PROMPT, /不要拿 calm 凑数/);
  assert.match(DEEP_PROMPT, /evidence 逐字照抄写出这个声音的那几个字/);
  assert.match(DEEP_PROMPT, /在心里核对一遍，不要写出来/);
  assert.match(DEEP_PROMPT, /styles 对停顿另有要求时按 styles/);
  // The example shows the shape, and nothing a rule forbids: no volume beside a tone, no strength by default.
  const example = JSON.parse(DEEP_PROMPT.split('\n')[1].match(/\{"voices".*\]\}/)[0]).voices[0];
  assert.ok(example.tone && !('volume' in example), 'rule 12: a volume only where no tone is written');
  assert.equal('intensity' in example, false, 'rule 4: a strength only where the mood is clearly weaker or stronger');
  assert.match(DEEP_PROMPT, /示例里没有的 intensity、speed、volume 按第 4、12 条写/);
  // The words a situation is mapped to are ones the request offers.
  const offered = new Set([...FISH_EMOTIONS, ...SPOKEN_SOUNDS, ...FISH_TONES]);
  for (const prompt of [DEFAULT_TTS_PROMPTS.simple, DEEP_PROMPT]) {
    const named = [...prompt.matchAll(/→\s*([a-z][a-z ]*[a-z](?: 或 [a-z][a-z ]*[a-z])*)/g)].flatMap(match => match[1].split(' 或 '));
    assert.ok(named.length > 5);
    for (const word of named) assert.ok(offered.has(word), word);
  }
  const input = JSON.parse(buildDeepAnalysisMessages(splitUtterances([{ lineId: 1, text: '「好。」' }]))[1].content);
  assert.deepEqual(input.sounds, SPOKEN_SOUNDS);
  assert.deepEqual(input.emotions, FISH_EMOTIONS);
  // The reply: a sign in quotes is the narrator's, a bare dialogue answer labels the line and sends no cue.
  const utterances = splitUtterances([{ lineId: 1, text: '门上挂着「闲人免进」的牌子。她叹了口气：「又锁了。」' }, { lineId: 2, text: '「走吧。」' }]);
  const parsed = parseVoiceAnalysis(JSON.stringify({ voices: [
    { id: 2, type: 'narration' },
    { id: 5, speaker: '千夏', emotion: 'disappointed', sounds: [{ at: 'start', tag: 'sighing', evidence: '叹了口气' }] },
    { id: 6, type: 'dialogue' },
  ] }), utterances);
  assert.deepEqual(parsed.labels.get(2), { type: 'narration' });
  assert.deepEqual(parsed.labels.get(6), { type: 'dialogue' });
  const segments = buildSegments(utterances, parsed.labels, { voices: parsed.voices });
  assert.equal(segments.find(item => item.id === 2).type, 'narration');
  assert.equal(lean(segments.find(item => item.id === 5)), '[disappointed][sighing] 又锁了。');
  assert.equal(lean(segments.find(item => item.id === 6)), '走吧。');
  assert.ok(FISH_SOUNDS.includes('moaning'), 'a stored moan still parses, to be dropped on its way out');
  // A prompt of the reader's own is offered the same sounds, in the reader's words.
  assert.deepEqual(SOUND_TAGS.filter(word => ['呻吟', '人群笑声', '背景笑声', '观众笑声'].includes(word)), []);
  assert.ok(SOUND_TAGS.includes('叹气') && SOUND_TAGS.includes('冷哼'));
});

test('a line the reader or the story gave to somebody stays spoken, whatever a model made of the quote', () => {
  const labels = new Map([[2, { type: 'narration' }], [3, { type: 'narration' }]]);
  const resolved = new Map([
    [2, { speaker: '樱井', source: 'manual', evidence: ['手动'] }],
    [3, { speaker: '泰罗', source: 'local', evidence: ['推断'] }],
  ]);
  const pinned = pinSpeakers(labels, resolved);
  assert.equal(pinned.get(2).type, undefined, 'the reader said who says it: it is dialogue again');
  assert.equal(pinned.get(3).type, 'narration', 'a guess does not overrule the model');
});

test('a sound written between two lines goes to the line it leads into, whatever the line before asks for', () => {
  const utterances = splitUtterances([
    { lineId: 1, text: '「又来了。」艾琳说。' },
    { lineId: 2, text: '莉莉笑出了声。' },
    { lineId: 3, text: '「你真是个笨蛋。」' },
  ]);
  const laugh = { emotion: 'happy', sounds: [{ at: 'start', tag: 'laughing' }] };
  const read = first => buildSegments(utterances, new Map(), { voices: new Map([[1, first], [4, laugh]]) });
  const before = read({ emotion: 'resigned' });
  const after = read({ emotion: 'resigned', sounds: [{ at: 'start', tag: 'chuckling' }] });
  assert.equal(lean(before.find(item => item.id === 4)), '[happy][laughing] 你真是个笨蛋。');
  assert.equal(lean(after.find(item => item.id === 4)), '[happy][laughing] 你真是个笨蛋。', 'a chuckle asked for on the line before does not take the laugh');
  assert.equal(lean(after.find(item => item.id === 1)), '[resigned] 又来了。');
  assert.equal(itemIdentity({ segment: before.find(item => item.id === 4), voiceId: 'v' }), itemIdentity({ segment: after.find(item => item.id === 4), voiceId: 'v' }));
});

test('a quiet voice is kept wherever the text asks for one in its usual words, from the original alone', () => {
  for (const narration of [
    '彼女は声を潜めて言った。', '彼女は声をひそめた。', '彼は耳元で言った。', '彼女は声を落として言った。', 'ぼそっと言った。',
    '她在他耳边说：', '她轻轻地说：', '她把声音放得很轻：', '他低低地说：', '她压着嗓子说：', '她的声音越来越低：', '他的声音也低了下去：',
  ]) {
    for (const tone of ['whispering', 'soft tone']) assert.equal(groundVoice({ emotion: 'nervous', tone }, { text: '别告诉别人。', evidence: narration }).changed, false, `${narration} ${tone}`);
  }
  assert.deepEqual(groundVoice({ emotion: 'nervous', tone: 'soft tone' }, { text: '别告诉别人。', evidence: '她笑着说：' }).dropped.map(item => item.why), ['quiet']);
  // A voice that is low in pitch, an ear shouted into, or a voice told to be louder asks for nothing quiet.
  for (const [text, narration] of [
    ['跟我走。', '他的声音低沉而沙哑：'], ['跟我走。', '她的声音里带着轻蔑：'], ['站住！', '耳边响起一声怒吼：'], ['醒醒！', '他在她耳边大吼：'],
    ['起きろ！', '彼は彼女の耳元で叫んだ。'], ['你把我的话当耳边风吗！', ''], ['声音太低了，大声点！', ''],
  ]) {
    for (const tone of ['whispering', 'soft tone']) assert.deepEqual(groundVoice({ emotion: 'angry', tone }, { text, evidence: narration }).dropped.map(item => item.why), ['quiet'], `${text} ${narration} ${tone}`);
  }
  // Read while the translation is still being written, with nothing but the original to go by.
  const source = splitUtterances([{ lineId: 1, text: '彼女は声を潜めて言った。「誰にも言わないで」' }]);
  const quote = source.find(item => item.kind === 'quoted');
  const alone = buildSegments(source, new Map(), { voices: new Map([[quote.id, { emotion: 'nervous', tone: 'whispering' }]]) });
  assert.equal(lean(alone.find(item => item.id === quote.id)), '[nervous][whispering] 誰にも言わないで');
});

test('a sound written after a line that trails off is heard where the line starts, and every prompt says where a sound may go', () => {
  const read = (text, voice) => {
    const utterances = splitUtterances([{ lineId: 1, text }]);
    const quote = utterances.find(item => item.kind === 'quoted');
    return lean(buildSegments(utterances, new Map(), { voices: new Map([[quote.id, voice]]) }).find(item => item.id === quote.id));
  };
  assert.equal(read('「我知道了……」她叹了口气。', { emotion: 'resigned', sounds: [{ at: 'end', tag: 'sighing' }] }), '[resigned][sighing] 我知道了……');
  assert.equal(read('「才不要呢～」她笑出了声，跑开了。', { emotion: 'playful', sounds: [{ at: 'end', tag: 'laughing' }] }), '[playful][laughing] 才不要呢～');
  // Both ends trail off: there is nowhere to put it.
  assert.equal(read('她叹了口气：「……算了……」', { emotion: 'resigned', sounds: [{ at: 'end', tag: 'sighing' }] }), '[resigned] ……算了……');
  for (const prompt of [DEFAULT_TTS_PROMPTS.simple, DEFAULT_TTS_PROMPTS.refine, DEEP_PROMPT]) assert.ok(prompt.includes(SOUND_PLACE_RULE));
  // A prompt that keeps end for a line with more of its paragraph after it says what becomes of a sound
  // whose line trails off at the start and ends its paragraph, rather than asking for end there too.
  for (const prompt of [DEFAULT_TTS_PROMPTS.simple, DEFAULT_TTS_PROMPTS.refine, DEEP_PROMPT]) {
    if (/end[^。]*只在同一段里这句后面还有正文时用/.test(prompt)) assert.ok(prompt.includes(`${SOUND_PLACE_RULE}${SOUND_END_RULE}`));
  }
  assert.match(SOUND_END_RULE, /不写/);
});

test('a breath drawn in is no gasp; a cold one drawn in sharply is', () => {
  for (const narration of ['她吸了一口气', '她轻轻吸了口气', '他缓缓地吸了一口气', '他深吸了一口气']) assert.equal(SOUND_EVIDENCE.gasping.test(narration), false, narration);
  for (const narration of ['她倒吸一口气', '她吸了一口凉气', '他倒抽一口冷气', '他抽了一口冷气']) assert.equal(SOUND_EVIDENCE.gasping.test(narration), true, narration);
  const lines = splitUtterances([{ lineId: 1, text: '她吸了一口气，看着他：「我喜欢你。」' }]);
  const quote = lines.find(item => item.kind === 'quoted');
  const segments = buildSegments(lines, new Map(), { voices: new Map([[quote.id, { emotion: 'nervous', sounds: [{ at: 'start', tag: 'gasping' }] }]]) });
  assert.equal(lean(segments.find(item => item.id === quote.id)), '[nervous] 我喜欢你。');
});

test('はい and いいえ are words, and a strength written into the mood word moves to the intensity', () => {
  const read = (text, voice) => {
    const utterances = splitUtterances([{ lineId: 1, text }]);
    const quote = utterances.find(item => item.kind === 'quoted');
    return lean(buildSegments(utterances, new Map(), { voices: new Map([[quote.id, voice]]) }).find(item => item.id === quote.id));
  };
  assert.equal(read('彼女は顔を赤らめて頷いた。「……はい」', { emotion: 'shy' }), '[shy] ……はい');
  assert.equal(read('「いいえ……」', { emotion: 'embarrassed' }), '[embarrassed] いいえ……');
  assert.equal(read('「……嗯。」', { emotion: 'shy' }), '……嗯。');
  assert.equal(read('「ハァ……」', { emotion: 'shy' }), 'ハァ……');
  assert.equal(read('「你给我滚出去！」', { emotion: 'very angry' }), '[furious] 你给我滚出去！');
  assert.equal(read('「这样啊。」', { emotion: 'slightly sad' }), '[disappointed] 这样啊。');
  assert.equal(groundVoice({ emotion: 'very sad', intensity: 1 }, { text: '这样啊。' }).voice.intensity, 1, 'a strength already given stays');
});

test('on S1 a tender line keeps its warmth and gets no soft tone the text never asked for', () => {
  for (const intensity of [0, 1, 2]) {
    const [segment] = buildSegments(splitUtterances([{ lineId: 1, text: '「没关系，我在这里。」' }]), new Map([[1, { type: 'dialogue', emotion: 'tender', intensity }]]));
    const text = sentenceFishText({ segment, voiceId: 'v' }, { model: 's1' }, { lean: true, directions: false });
    assert.doesNotMatch(text, /soft tone|whispering/, text);
    assert.match(text, /^\(\w+\) /);
  }
});

test('the prompts agree: who may go unnamed, what a mood maps to, a quoted thought, a line of nothing but 嗯', () => {
  assert.doesNotMatch(DEEP_PROMPT, /至少写 speaker/, 'rule 1 would demand the guess rule 3 forbids');
  assert.match(DEEP_PROMPT, /看得出情绪、看不出说话人时照写 emotion，不写 speaker/);
  // A Chinese word the translation's mood table glosses maps to that same word in the analyses.
  const gloss = new Map(FISH_EMOTION_GROUPS.flatMap(([, words]) => words.flatMap(([word, meaning]) => meaning.split('、').map(said => [said, word]))));
  let checked = 0;
  for (const prompt of [DEFAULT_TTS_PROMPTS.simple, DEEP_PROMPT]) {
    for (const [, left, right] of prompt.matchAll(/([^\s：；。，→]+(?:、[^\s：；。，→]+)*)\s*→\s*([a-z][a-z ]*[a-z](?: 或 [a-z][a-z ]*[a-z])*)/g)) {
      for (const said of left.split('、').filter(word => gloss.has(word))) {
        checked += 1;
        assert.ok(right.split(' 或 ').includes(gloss.get(said)), `${said} → ${right}; the table says ${gloss.get(said)}`);
      }
    }
  }
  assert.ok(checked >= 5);
  // A thought in quotes is its thinker's, as the translation counts it.
  for (const prompt of [DEFAULT_TTS_PROMPTS.simple, DEFAULT_TTS_PROMPTS.refine, DEEP_PROMPT]) assert.match(prompt, /引号里心里想的话算这个人的话，照常写 speaker/);
  assert.doesNotMatch(DEFAULT_TTS_PROMPTS.refine, /narration（[^）]*(?<!引号外的)心理描写/, 'a correction keeps a thought in quotes as its thinker\'s');
  // The refine prompt says what becomes of a whisper the text never asked for, rather than refusing it.
  assert.doesNotMatch(DEFAULT_TTS_PROMPTS.refine, /就不写 whispering/);
  assert.match(DEFAULT_TTS_PROMPTS.refine, /whispering 和 soft tone 写了也会被丢掉/);
  // The moods a line of nothing but 嗯 may not wear are named one by one, and they are the ones dropped.
  assert.deepEqual([...SOFT_MOODS].sort(), FISH_EMOTIONS.filter(word => ['tender', 'shy'].includes(normalizeEmotion(word))).sort());
  for (const prompt of [DEFAULT_TTS_PROMPTS.simple, DEEP_PROMPT]) assert.ok(prompt.includes(`emotion 不用 ${SOFT_MOODS.join('、')}`));
  for (const mood of SOFT_MOODS) assert.equal(groundVoice({ emotion: mood }, { text: '嗯……' }).voice, null, mood);
});

test('on the original\'s side a sign the translation counted is the narrator\'s, and the lines after it keep their speakers', () => {
  const mark = { speaker: '艾琳', emotion: 'nervous', quotes: [
    { head: '等等', speaker: '艾琳', emotion: 'nervous' }, { head: '禁止入内', type: 'narration' }, { head: '那里很危险', speaker: '莉莉丝', emotion: 'worried' },
  ] };
  // Where the original keeps the sign as a run of its own, the counts agree.
  const kept = [
    { id: 1, lineId: 5, kind: 'quoted', text: '待って！' },
    { id: 2, lineId: 5, kind: 'narration', text: '彼女は看板を指さした。' },
    { id: 3, lineId: 5, kind: 'quoted', text: '立入禁止' },
    { id: 4, lineId: 5, kind: 'narration', text: 'リリスが答えた。' },
    { id: 5, lineId: 5, kind: 'quoted', text: 'そこは危ないよ' },
  ];
  const { labels } = annotationReading(kept, new Map([[5, mark]]));
  assert.equal(labels.get(1).speaker, '艾琳');
  assert.deepEqual(labels.get(3), { type: 'narration' });
  assert.equal(labels.get(5).speaker, '莉莉丝');
  assert.equal(buildSegments(kept, labels).find(item => item.id === 3).type, 'narration');
  // The original as it is cut: 看板の「立入禁止」を is part of its sentence, so the line has two runs.
  const folded = splitUtterances([{ lineId: 5, text: '「待って！」彼女は看板の「立入禁止」を指さした。リリスが答えた。「そこは危ないよ」' }]);
  assert.deepEqual(folded.filter(item => item.kind === 'quoted').map(item => item.text), ['待って！', 'そこは危ないよ']);
  const read = annotationReading(folded, new Map([[5, mark]]));
  const segments = buildSegments(folded, read.labels, { voices: read.voices });
  assert.deepEqual(segments.filter(item => item.type === 'dialogue').map(item => [item.text, item.speaker]), [['待って！', '艾琳'], ['そこは危ないよ', '莉莉丝']]);
});

test('reading both languages, the original\'s runs after a sign it folded keep their speakers', () => {
  const mark = { speaker: '艾琳', emotion: 'nervous', quotes: [
    { head: '等等', speaker: '艾琳', emotion: 'nervous' }, { head: '禁止入内', type: 'narration' }, { head: '那里很危险', speaker: '莉莉丝', emotion: 'worried' },
  ] };
  const translation = splitUtterances([{ lineId: 5, text: '「等等！」她指着写着「禁止入内」的牌子。莉莉丝回答：「那里很危险哦。」' }]);
  const original = splitUtterances([{ lineId: 5, text: '「待って！」彼女は看板の「立入禁止」を指さした。リリスが答えた。「そこは危ないよ」' }]);
  const read = annotationReading(translation, new Map([[5, mark]]));
  const derived = deriveLabelsForSide(translation, read.labels, read.voices, original);
  const segments = buildSegments(original, derived.labels, { voices: derived.voices });
  assert.deepEqual(segments.filter(item => item.kind === 'quoted' || item.type === 'dialogue').map(item => [item.text, item.type, item.speaker]), [
    ['待って！', 'dialogue', '艾琳'], ['そこは危ないよ', 'dialogue', '莉莉丝'],
  ]);
});

test('runs a mark does not place still take the line\'s direction, pauses and stress, each where its words are', () => {
  const utterances = [
    { id: 1, lineId: 3, kind: 'quoted', text: '我不想走。' },
    { id: 2, lineId: 3, kind: 'narration', text: '她哽咽着说，' },
    { id: 3, lineId: 3, kind: 'quoted', text: '求你了。' },
  ];
  const mark = { speaker: '英梨梨', emotion: 'sad', direction: '哽咽着，声音发抖', pauses: [{ after: '求你', length: 'short' }], stress: ['不想'], sounds: [{ at: 'start', tag: 'sobbing' }] };
  const { voices } = annotationReading(utterances, new Map([[3, mark]]));
  assert.equal(voices.get(1)?.direction, '哽咽着，声音发抖');
  assert.deepEqual(voices.get(1)?.stress, ['不想']);
  assert.equal(voices.get(1)?.pauses, undefined, 'a pause after 求你 is not in this run');
  assert.deepEqual(voices.get(3)?.pauses, [{ after: '求你', length: 'short' }]);
  assert.equal(voices.get(3)?.sounds, undefined, 'the line\'s sound belongs to one moment, not to every run');
});

test('read as the analysis arrives, a line gets no sound from the narration after it before the line that narration leads into is read', () => {
  const utterances = splitUtterances([
    { lineId: 1, text: '「又来了。」艾琳说。' },
    { lineId: 2, text: '莉莉笑出了声。' },
    { lineId: 3, text: '「你真是个笨蛋。」' },
  ]);
  const first = [1, { emotion: 'resigned', sounds: [{ at: 'start', tag: 'laughing' }] }];
  const ready = new Set(utterances.filter(item => item.lineId <= 2).map(item => item.id));
  const undecided = [];
  const partial = buildSegments(utterances, new Map(), { voices: new Map([first]), ready, undecided });
  const final = buildSegments(utterances, new Map(), { voices: new Map([first, [4, { emotion: 'happy', sounds: [{ at: 'start', tag: 'laughing' }] }]]) });
  assert.equal(lean(partial.find(item => item.id === 1)), '[resigned] 又来了。');
  assert.deepEqual(undecided, [1], 'the line says its voice is not settled yet');
  // Narration after it that writes no laugh has nothing to give it, now or later: nothing waits.
  const quiet = splitUtterances([{ lineId: 1, text: '「又来了。」艾琳说。' }, { lineId: 2, text: '莉莉转身走了。' }, { lineId: 3, text: '「你真是个笨蛋。」' }]);
  const none = [];
  buildSegments(quiet, new Map(), { voices: new Map([first]), ready: new Set(quiet.filter(item => item.lineId <= 2).map(item => item.id)), undecided: none });
  assert.deepEqual(none, []);
  assert.equal(lean(final.find(item => item.id === 4)), '[happy][laughing] 你真是个笨蛋。');
  assert.equal(itemIdentity({ segment: partial.find(item => item.id === 1), voiceId: 'v' }), itemIdentity({ segment: final.find(item => item.id === 1), voiceId: 'v' }));
  // Once that line is read and leaves the laugh, the line before may have it.
  const left = buildSegments(utterances, new Map(), { voices: new Map([first, [4, { emotion: 'happy' }]]) });
  assert.equal(lean(left.find(item => item.id === 1)), '[resigned][laughing] 又来了。');
});

test('the narration after a line gives it no sound another person makes, nor a breath drawn out', () => {
  const people = splitUtterances([{ lineId: 1, text: '「又来了。」艾琳说。' }, { lineId: 2, text: '莉莉笑出了声。' }, { lineId: 3, text: '「你真是个笨蛋。」' }]);
  const named = buildSegments(people, new Map([[1, { type: 'dialogue', speaker: '艾琳' }], [4, { type: 'dialogue', speaker: '莉莉' }]]), {
    voices: new Map([[1, { emotion: 'resigned', sounds: [{ at: 'start', tag: 'laughing' }] }], [4, { emotion: 'happy' }]]),
  });
  assert.equal(lean(named.find(item => item.id === 1)), '[resigned] 又来了。', '莉莉 laughs, not 艾琳');
  // The original says the same of her by a name the floor does not know.
  const both = buildSegments(people, new Map([[1, { type: 'dialogue', speaker: '艾琳' }], [4, { type: 'dialogue', speaker: '莉莉' }]]), {
    voices: new Map([[1, { emotion: 'resigned', sounds: [{ at: 'start', tag: 'laughing' }] }], [4, { emotion: 'happy' }]]),
    evidence: new Map([[1, '「また来た」とエリンが言った。'], [2, 'リリーは笑い出した。'], [3, '「バカね」']]),
  });
  assert.equal(lean(both.find(item => item.id === 1)), '[resigned] 又来了。');
  // Her own sigh after her own line is still hers.
  const own = splitUtterances([{ lineId: 1, text: '「算了，随你吧。」' }, { lineId: 2, text: '艾琳叹了口气，转身走了。' }]);
  const sighed = buildSegments(own, new Map([[1, { type: 'dialogue', speaker: '艾琳' }]]), { voices: new Map([[1, { emotion: 'sad', sounds: [{ at: 'start', tag: 'sighing' }] }]]) });
  assert.deepEqual(sighed[0].voice.sounds, [{ at: 'start', tag: 'sighing' }]);
  // Another of her names is still her, in either language, and so is a sentence that names her first.
  const cast = [{ name: '艾琳', aliases: ['小琳', 'エリン'] }, { name: '莉莉', aliases: [] }];
  const knownNames = ['艾琳', '小琳', 'エリン', '莉莉'];
  for (const [narration, original] of [
    ['小琳叹了口气，转身走了。', 'エリンはため息をついて背を向けた。'],
    ['艾琳看着莉莉，叹了口气。', 'エリンはリリーを見て、ため息をついた。'],
  ]) {
    const lines = splitUtterances([{ lineId: 1, text: '「算了，随你吧。」' }, { lineId: 2, text: narration }]);
    const read = buildSegments(lines, new Map([[1, { type: 'dialogue', speaker: '艾琳' }]]), {
      knownNames, cast, voices: new Map([[1, { emotion: 'sad', sounds: [{ at: 'start', tag: 'sighing' }] }]]),
      evidence: new Map([[1, '「もういい、好きにして」'], [2, original]]),
    });
    assert.deepEqual(read[0].voice.sounds, [{ at: 'start', tag: 'sighing' }], narration);
  }
  // A sentence about somebody else keeps its sound from her, whatever the sentence before it was about.
  const turned = splitUtterances([{ lineId: 1, text: '「又来了。」' }, { lineId: 2, text: '艾琳转过身。莉莉笑出了声。' }]);
  const laughed = buildSegments(turned, new Map([[1, { type: 'dialogue', speaker: '艾琳' }]]), {
    knownNames, cast, voices: new Map([[1, { emotion: 'resigned', sounds: [{ at: 'start', tag: 'laughing' }] }]]),
  });
  assert.equal(lean(laughed[0]), '[resigned] 又来了。');
  const scene = splitUtterances(['她的身体微微颤抖。', '「你……你轻一点……」千夏小声说。', '泰罗没有回答，只是吻住了她。', '「放松，交给我。」', '她咬着嘴唇，发出细碎的喘息。', '「嗯……」']
    .map((text, index) => ({ lineId: index + 1, text })));
  const his = scene.find(item => item.text.startsWith('放松')).id;
  const segments = buildSegments(scene, new Map([[his, { type: 'dialogue', speaker: '泰罗' }]]), { voices: new Map([[his, { emotion: 'tender', sounds: [{ at: 'start', tag: 'panting' }] }]]) });
  assert.equal(lean(segments.find(item => item.id === his)), '[tender] 放松，交给我。');
});

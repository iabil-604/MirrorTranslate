import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analysisCacheKey, buildFishPayload, buildSegments, consoleDirections, deriveLabelsForSide, floorTextWithMarks,
  planFishParts, scriptOutline, sentenceFishText, sentenceProsody, sentenceSampling, splitUtterances,
} from '../tts.js';
import { ACOUSTIC_INTIMATE_ON, DEEP_PROMPT, acousticCurrentItem, acousticScript, isAcousticPrompt, parseDeepAnalysis } from '../tts-deep.js';

// ---------------------------------------------------------------------------------------------
// 分析模式 in the reader's 声学标注规则: the content a model writes is held to the sentence, the tags are
// settled, and the script reaches Fish with its pace and tension as Fish's own parameters.
// ---------------------------------------------------------------------------------------------

test('content may add stutters, marks and interjections, and replace the sentence\'s own punctuation', () => {
  const held = acousticScript('[whisper] 我、我不是故意的…… [whisper][gasp] 呜……我真的已经很努力了，呜呜……', '我不是故意的。我真的已经很努力了。');
  assert.equal(held.mismatch, false);
  assert.equal(held.script, '[whisper] 我、我不是故意的…… [whisper][gasp] 呜……我真的已经很努力了，呜呜……');
  // A dash in the sentence may become a stutter, and 「！」 may become 「！！」.
  assert.equal(acousticScript('[gasp] 凭、凭什么！！', '凭——凭什么！').script, '[gasp] 凭、凭什么！！');
  // Japanese gains its own interjections.
  assert.equal(acousticScript('[whisper] う、うそ……っ', 'うそ').mismatch, false);
});

test('content that changes a word, drops one or adds too much is read as written, keeping the tags it opened on', () => {
  const changed = acousticScript('[whisper] 我不是有意的。', '我不是故意的。');
  assert.equal(changed.mismatch, true);
  assert.equal(changed.script, '[whisper] 我不是故意的。');
  const dropped = acousticScript('我不是的。', '我不是故意的。');
  assert.equal(dropped.mismatch, true);
  assert.equal(dropped.script, '', 'no opening tag, nothing to keep');
  const flooded = acousticScript('呜呜呜呜呜呜呜呜我好', '我好');
  assert.equal(flooded.mismatch, true, 'more added than the line can carry');
});

test('tags are settled: unknown words dropped, Fish\'s own spellings read, filters first, two at one point at most', () => {
  assert.equal(acousticScript('[teasing] 你来了啊', '你来了啊').script, '', 'a made-up tag is dropped, and nothing else changed');
  assert.equal(acousticScript('[whispering] 你来了啊', '你来了啊').script, '[whisper] 你来了啊');
  assert.equal(acousticScript('[gasp][whisper][sigh] 你来了啊', '你来了啊').script, '[whisper][gasp] 你来了啊');
  assert.equal(acousticScript('[pause] 你来了啊', '你来了啊').script, '', 'a pause before anything is said is no pause');
  assert.equal(acousticScript('你来了[pause]啊', '你来了啊').script, '你来了 [pause] 啊');
  assert.equal(acousticScript('「[whisper] 你来了啊」', '你来了啊').script, '[whisper] 你来了啊', 'quotes around the whole line come off');
  assert.equal(acousticScript('你来了啊', '你来了啊').script, '', 'the sentence as written needs no script');
  assert.equal(acousticScript('你来了啊！！', '你来了啊').script, '你来了啊！！', 'marks alone still perform the line');
});

test('the narrator never pants or moans, and without 亲密场景 nobody moans', () => {
  assert.equal(acousticScript('[breathy][panting] 她靠了过来', '她靠了过来', { narrator: true }).script, '[breathy] 她靠了过来');
  assert.equal(acousticScript('[panting][groan] 嗯…不要', '嗯…不要', { intimate: false }).script, '[panting] 嗯…不要');
  assert.equal(acousticScript('[panting][groan] 嗯…不要', '嗯…不要', { intimate: true }).script, '[panting][groan] 嗯…不要');
});

test('every sentence is numbered and answered, the narration as the narrator\'s whatever the model names it', () => {
  const utterances = splitUtterances([{ lineId: 1, text: '她压低了声音：「你别靠这么近，会让人看见的。」' }]);
  assert.deepEqual(floorTextWithMarks(utterances, { all: true }), [{ line: 1, text: '⟦1⟧她压低了声音：⟦2⟧「你别靠这么近，会让人看见的。」' }]);
  const reply = JSON.stringify({ voices: [
    { id: 1, role: '林浅', is_narrator: false, pace: 'slow', content: '她压低了声音：' },
    { id: 2, role: '林浅', is_narrator: false, pace: 'very_fast', tension_level: 9, reason: '心虚压声，怕被别人发现了', content: '[whisper] 你、你别靠这么近…… [pause] 会让人看见的。' },
  ] });
  const { labels, voices, mismatches } = parseDeepAnalysis(reply, utterances);
  assert.deepEqual(mismatches, []);
  assert.deepEqual(labels.get(1), { type: 'narration' }, 'a sentence outside the quotes is the narrator\'s');
  assert.deepEqual(voices.get(1), { speed: 'slow' });
  assert.deepEqual(labels.get(2), { type: 'dialogue', speaker: '林浅' });
  assert.equal(voices.get(2).speed, 'very_fast');
  assert.equal(voices.get(2).tensionLevel, 5, 'tension is held to 1–5');
  assert.equal(voices.get(2).why.length <= 24, true);
  // A sign in quotes the model calls narration is narration.
  const sign = splitUtterances([{ lineId: 1, text: '门上写着「闲人免进」。' }]);
  const signId = sign.find(item => item.kind === 'quoted').id;
  assert.deepEqual(parseDeepAnalysis(JSON.stringify({ voices: [{ id: signId, role: '旁白', is_narrator: true }] }), sign).labels.get(signId), { type: 'narration' });
});

test('a correction starts from the reading as it stands, a hand-set name marked as the reader\'s', () => {
  const quote = { id: 2, kind: 'quoted' };
  assert.deepEqual(acousticCurrentItem(quote, { type: 'dialogue', speaker: '樱井', manual: true }, { speed: 'fast', tensionLevel: 4, why: '急', script: '[gasp] 等等！！' }),
    { role: '樱井', is_narrator: false, manual: true, pace: 'fast', tension_level: 4, reason: '急', content: '[gasp] 等等！！' });
  assert.deepEqual(acousticCurrentItem({ id: 1, kind: 'narration' }, null, null), { role: '旁白', is_narrator: true });
  assert.equal(isAcousticPrompt(''), true);
  assert.equal(isAcousticPrompt('只回 line，emotion 从列表里选'), false);
  assert.equal(isAcousticPrompt('content 写最终朗读文本，tension_level 1~5'), true);
});

test('a script is sent as written to the S2 models, through S1\'s own words on S1, and as words alone with cues off', () => {
  const segment = { id: 2, type: 'dialogue', text: '我不是故意的', voice: { script: '[whisper][gasp] 我、我不是 [pause] 故意的' } };
  assert.equal(sentenceFishText({ segment, voiceId: 'v' }, { model: 's2-pro' }), '[whisper][gasp] 我、我不是 [pause] 故意的');
  assert.equal(sentenceFishText({ segment, voiceId: 'v' }, { model: 's1' }), '(whispering) (gasping) 我、我不是 (break) 故意的');
  assert.equal(sentenceFishText({ segment, voiceId: 'v' }, { model: 's2-pro' }, { emotionCues: false }), '我、我不是故意的');
  const english = { id: 3, type: 'dialogue', text: 'I am not', voice: { script: 'I [pause] am not' } };
  assert.equal(sentenceFishText({ segment: english, voiceId: 'v' }, { model: 's2-pro' }, { emotionCues: false }), 'I am not');
  // The reader's punctuation marks and the taming of runs are not laid over a script.
  const loud = { id: 4, type: 'dialogue', text: '凭什么', voice: { script: '[gasp] 凭、凭什么！！' } };
  assert.equal(sentenceFishText({ segment: loud, voiceId: 'v', console: { marks: [{ punctuation: '！！', cue: 'shouting' }] } }, { model: 's2-pro' }, { tamePunctuation: true }), '[gasp] 凭、凭什么！！');
});

test('pace has five steps, and tension moves Fish\'s temperature from the reader\'s own setting', () => {
  const item = voice => ({ segment: { id: 1, type: 'dialogue', text: '你来了啊，我等了好久', voice }, voiceId: 'v' });
  assert.equal(sentenceProsody(item({ speed: 'very_slow' }), { speed: 1, volume: 0 }).speed, 0.8);
  assert.equal(sentenceProsody(item({ speed: 'very_fast' }), { speed: 1, volume: 0 }).speed, 1.25);
  const fish = { temperature: 0.7 };
  assert.deepEqual(sentenceSampling(item({ tensionLevel: 1 }), fish), { temperature: 0.6 });
  assert.deepEqual(sentenceSampling(item({ tensionLevel: 2 }), fish), { temperature: 0.7 });
  assert.deepEqual(sentenceSampling(item({ tensionLevel: 3 }), fish), { temperature: 0.75 });
  assert.deepEqual(sentenceSampling(item({ tensionLevel: 5 }), fish), { temperature: 0.85 });
  assert.deepEqual(sentenceSampling(item({ tensionLevel: 5 }), { temperature: 0.85 }), { temperature: 0.9 }, 'capped at 0.9');
  assert.deepEqual(sentenceSampling(item({ tensionLevel: 5 }), { temperature: 0.95 }), { temperature: 0.95 }, 'a reader who set it higher keeps it');
  assert.deepEqual(sentenceSampling(item({}), fish), { temperature: 0.7 }, 'no tension, the reader\'s own');
  assert.deepEqual(sentenceSampling({ ...item({ tensionLevel: 1 }), override: { tension: 4 } }, fish), { temperature: 0.8 }, 'the reader\'s number in the panel wins');
  assert.deepEqual(sentenceSampling(item({ tensionLevel: 5 }), fish, { prosodySplit: false }), { temperature: 0.7 }, 'not split, the reader\'s own');
});

test('a very short performed line gets a stiffer repetition penalty and never a hotter temperature', () => {
  const item = voice => ({ segment: { id: 1, type: 'dialogue', text: '不要', voice }, voiceId: 'v' });
  assert.deepEqual(sentenceSampling(item({ script: '[gasp] 不、不要……', tensionLevel: 5 }), { temperature: 0.7 }), { temperature: 0.7, repetitionPenalty: 1.5 });
  assert.deepEqual(sentenceSampling(item({ script: '呜……呜呜……嗯', tensionLevel: 4 }), { temperature: 0.7 }), { temperature: 0.7, repetitionPenalty: 1.5 });
  assert.deepEqual(sentenceSampling(item({ script: '[whisper] 我真的已经很努力了', tensionLevel: 4 }), { temperature: 0.7 }), { temperature: 0.8 });
  // The request carries both.
  const { body } = buildFishPayload([{ ...item({ script: '[gasp] 不、不要……', tensionLevel: 5 }) }], { model: 's2-pro', temperature: 0.7, topP: 0.7, speed: 1, volume: 0, format: 'mp3' });
  assert.equal(body.temperature, 0.7);
  assert.equal(body.repetition_penalty, 1.5);
  assert.equal(body.text, '[gasp] 不、不要……');
});

test('sentences of different tension are sent apart, and what is aligned is what was sent', () => {
  const make = (id, voice) => ({ segment: { id, type: 'dialogue', lineId: 1, text: '你好啊朋友们', voice }, voiceId: 'v' });
  const parts = planFishParts([make(1, { tensionLevel: 2 }), make(2, { tensionLevel: 2 }), make(3, { tensionLevel: 4 })], { model: 's2-pro' });
  assert.deepEqual(parts.map(part => part.map(item => item.segment.id)), [[1, 2], [3]]);
  const whole = planFishParts([make(1, { tensionLevel: 2 }), make(3, { tensionLevel: 4 })], { model: 's2-pro', wholeFloor: true });
  assert.equal(whole.length, 1, 'a floor sent whole is one take');
  const { spans } = buildFishPayload([make(5, { script: '[whisper] 你、你好啊朋友们' })], { model: 's2-pro', temperature: 0.7, speed: 1, volume: 0 });
  assert.deepEqual(spans, [{ id: 5, text: '你、你好啊朋友们' }]);
});

test('a script carried to the other language keeps only the tags it opens and closes on', () => {
  assert.equal(scriptOutline('[whisper][gasp] 呜……我、我不是 [pause] 故意的 [sigh]', '私はわざとじゃない'), '[whisper][gasp] 私はわざとじゃない [sigh]');
  assert.equal(scriptOutline('我不是 [pause] 故意的', '私はわざとじゃない'), '');
  const original = [{ id: 1, lineId: 1, kind: 'quoted', text: '我不是故意的' }];
  const other = [{ id: 9, lineId: 1, kind: 'quoted', text: '私はわざとじゃない' }];
  const { voices } = deriveLabelsForSide(original, new Map([[1, { type: 'dialogue', speaker: '林浅' }]]), new Map([[1, { tensionLevel: 4, script: '[whisper] 我、我不是 [pause] 故意的' }]]), other);
  assert.deepEqual(voices.get(9), { tensionLevel: 4, script: '[whisper] 私はわざとじゃない' });
});

test('the console speaks 分析模式\'s own terms, and a reading without a permission keeps the key it always had', async () => {
  const lines = consoleDirections({ pause: 5, breath: 5, intensity: 95, speed: 95 }, { acoustic: true });
  assert.ok(lines.some(line => line.includes('[pause]')));
  assert.ok(lines.some(line => line.includes('tension_level')));
  assert.ok(lines.every(line => !/\bemotion\b|intensity|sounds/.test(line)), 'no field the acoustic format does not have');
  const utterances = splitUtterances([{ lineId: 1, text: '「好」' }]);
  const plain = await analysisCacheKey({ utterances, depth: 'deep', side: 'translation' });
  assert.equal(await analysisCacheKey({ utterances, depth: 'deep', side: 'translation', variant: '' }), plain);
  assert.notEqual(await analysisCacheKey({ utterances, depth: 'deep', side: 'translation', variant: 'intimate' }), plain);
});

test('a scripted line survives the check before Fish untouched', () => {
  const utterances = splitUtterances([{ lineId: 1, text: '「嗯……」' }]);
  const id = utterances.find(item => item.kind === 'quoted').id;
  const segments = buildSegments(utterances, new Map([[id, { type: 'dialogue', speaker: '林浅' }]]), { voices: new Map([[id, { script: '[whisper] 嗯、嗯……', tensionLevel: 3 }]]) });
  assert.deepEqual(segments.find(item => item.id === id).voice, { script: '[whisper] 嗯、嗯……', tensionLevel: 3 });
});

// A floor of two-sentence narration paragraphs with one line of dialogue between them, every sentence
// numbered the way the acoustic request numbers it.
function trainingFloor() {
  return splitUtterances([
    { lineId: 1, text: '朝の演習場には、まだ誰もいなかった。風が草を揺らしている。' },
    { lineId: 2, text: '「へへ……すげえな、孟空」' },
    { lineId: 3, text: '孟空は黙って構えを直した。額の汗が光っている。' },
    { lineId: 4, text: '「ここまで防ぎ切るとは思わなかったってばよ！」' },
  ]);
}

test('an acoustic reply numbered by the paragraph lands each performed line on its own sentence', () => {
  const utterances = trainingFloor();
  assert.deepEqual(utterances.map(item => `${item.id}:${item.lineId}:${item.kind}`), ['1:1:narration', '2:1:narration', '3:2:quoted', '4:3:narration', '5:3:narration', '6:4:quoted']);
  const reply = { voices: [
    { id: 2, role: '鸣人', is_narrator: false, pace: 'fast', tension_level: 3, content: '[snicker] へへ……すげえな、孟空~' },
    { id: 4, role: '鸣人', is_narrator: false, tension_level: 4, content: '[gasp] ここまで防ぎ切るとは思わなかったってばよ！！' },
  ] };
  const parsed = parseDeepAnalysis(JSON.stringify(reply), utterances);
  assert.equal(parsed.numbering, 'line');
  assert.equal(parsed.moved, 2);
  assert.deepEqual(parsed.mismatches, []);
  assert.equal(parsed.labels.get(3).speaker, '鸣人');
  assert.equal(parsed.voices.get(3).script, '[snicker] へへ……すげえな、孟空~');
  assert.equal(parsed.voices.get(6).tensionLevel, 4);
  for (const id of [2, 4]) assert.equal(parsed.labels.has(id), false, `narration ${id} keeps no answer meant for a line of dialogue`);
});

test('an acoustic reply numbered by ⟦编号⟧ is read as it always was; one stray performed line moves to the sentence it performs', () => {
  const utterances = trainingFloor();
  const right = parseDeepAnalysis(JSON.stringify({ voices: [
    { id: 1, role: '旁白', is_narrator: true },
    { id: 3, role: '鸣人', is_narrator: false, content: '[snicker] へへ……すげえな、孟空~' },
    { id: 6, role: '鸣人', is_narrator: false },
  ] }), utterances);
  assert.deepEqual([right.numbering, right.moved, right.dropped], ['', 0, []]);
  assert.equal(right.voices.get(3).script, '[snicker] へへ……すげえな、孟空~');
  const stray = parseDeepAnalysis(JSON.stringify({ voices: [
    { id: 3, role: '鸣人', is_narrator: false },
    // The last line's performance under a narration sentence's number.
    { id: 5, role: '鸣人', is_narrator: false, tension_level: 4, content: '[gasp] ここまで防ぎ切るとは思わなかったってばよ！！' },
    { id: 9, role: '鸣人', is_narrator: false },
  ] }), utterances);
  assert.equal(stray.numbering, '');
  assert.equal(stray.moved, 1);
  assert.deepEqual(stray.dropped, [9], 'a number no sentence has is left out and named');
  assert.equal(stray.voices.get(6).script, '[gasp] ここまで防ぎ切るとは思わなかったってばよ！！');
  assert.equal(stray.voices.has(5), false);
});

test('words the sentence is written with in brackets, emoji and the marks that shape them are not taken for changes', () => {
  assert.deepEqual(acousticScript('按下 [OK] 键。', '按下 [OK] 键。'), { script: '', mismatch: false, at: -1 });
  assert.equal(acousticScript('[whisper] 按下 [OK] 键。', '按下 [OK] 键。').script, '[whisper] 按下 [OK] 键。');
  assert.equal(acousticScript('[teasing] 好的', '好的').script, '', 'a made-up tag the sentence does not have is still dropped');
  assert.equal(acousticScript('[laughter] 好的', '好的🙂').mismatch, false, 'an emoji left out is a mark left out');
  assert.equal(acousticScript('[laughter] 好的🙂', '好的🙂').script, '[laughter] 好的🙂');
  assert.equal(acousticScript('[sigh] 我爱你❤', '我爱你❤️').mismatch, false, 'a variation selector left out changes nothing');
});

test('a pause is a point of its own: never merged into the tags after it, never cut by their cap', () => {
  assert.equal(acousticScript('[whisper] 别说了…… [pause] [panting][whisper] 我叫你别说了！', '别说了……我叫你别说了！').script,
    '[whisper] 别说了…… [pause] [whisper][panting] 我叫你别说了！');
  assert.equal(acousticScript('你来了…… [pause] [whisper] 别出声', '你来了……别出声').script, '你来了…… [pause] [whisper] 别出声');
});

test('a prompt is taken for the acoustic format by its own field names, not by a word any prompt may use', () => {
  assert.equal(isAcousticPrompt(''), true);
  assert.equal(isAcousticPrompt('只输出 JSON，不要输出 text 或 content 之外的解释。emotion 写情绪，line 写原句。'), false);
  assert.equal(isAcousticPrompt('每句回 role、is_narrator、pace、tension_level。'), true);
});

test('an answer that copied its own sentence short stays on it, rather than moving to a shorter sentence its words happen to fit', () => {
  const utterances = splitUtterances([{ lineId: 1, text: '「好的，我知道了。」' }, { lineId: 2, text: '「好的。」' }]);
  const [first, second] = utterances.filter(item => item.kind === 'quoted').map(item => item.id);
  const parsed = parseDeepAnalysis(JSON.stringify({ voices: [{ id: first, role: '林浅', is_narrator: false, tension_level: 4, content: '[sigh] 好的……' }] }), utterances);
  assert.equal(parsed.moved, 0);
  assert.equal(parsed.labels.get(first).speaker, '林浅');
  assert.equal(parsed.labels.has(second), false);
  assert.deepEqual(parsed.mismatches.map(item => item.id), [first], 'the copy is reported, on its own sentence');
});

test('a long reply is read from its first answer, still arriving or cut off, and says whether it closed', () => {
  const lines = Array.from({ length: 200 }, (_, index) => ({ lineId: index + 1, text: `第${index + 1}段旁白。「台词${index + 1}。」` }));
  const utterances = splitUtterances(lines);
  assert.ok(utterances.length >= 400);
  const answers = utterances.map(item => (item.kind === 'quoted'
    ? { id: item.id, role: '泰罗', is_narrator: false }
    : { id: item.id, role: '旁白', is_narrator: true }));
  const whole = JSON.stringify({ voices: answers });
  const full = parseDeepAnalysis(whole, utterances);
  assert.equal(full.labels.size, utterances.length);
  assert.equal(full.complete, true);
  assert.equal(full.format, 'acoustic');
  // Cut off two thirds of the way: every answer up to the cut is read, the very first ones included.
  const cut = whole.slice(0, Math.floor(whole.length * 2 / 3));
  const partial = parseDeepAnalysis(cut, utterances);
  assert.equal(partial.complete, false);
  assert.ok(partial.labels.has(utterances[0].id) && partial.labels.has(utterances[1].id));
  assert.ok(partial.labels.size > 240);
});

test('an answer with only a pace is read in the acoustic format', () => {
  const utterances = splitUtterances([{ lineId: 1, text: '雨下了一整夜。' }]);
  const parsed = parseDeepAnalysis(JSON.stringify({ voices: [{ id: 1, pace: 'very_slow' }] }), utterances);
  assert.deepEqual(parsed.labels.get(1), { type: 'narration' });
  assert.equal(parsed.voices.get(1).speed, 'very_slow');
});

test('a script carried to the other language keeps a two-word tag whole', () => {
  assert.equal(scriptOutline('[whisper][clear throat] 行、行くぞ！！', '出发吧，别磨蹭。'), '[whisper][clear throat] 出发吧，别磨蹭。');
  assert.equal(scriptOutline('你来了 [clear throat]', '来たね'), '来たね [clear throat]');
});

test('with cues off, a tag taken out of an English line leaves its space, and Chinese still closes up', () => {
  const words = text => sentenceFishText({ segment: { id: 1, type: 'dialogue', text: 'x', voice: { script: text } }, voiceId: 'v' }, { model: 's2-pro' }, { emotionCues: false, lean: true });
  assert.equal(words('Well, [pause] I guess so.'), 'Well, I guess so.');
  assert.equal(words('Hello. [sigh] I am here.'), 'Hello. I am here.');
  assert.equal(words('[whisper] 别说了…… [pause] 我叫你别说了！'), '别说了……我叫你别说了！');
});

test('the reader\'s own tension holds with the split off, and the short-line rule reads what is actually said', () => {
  const item = { segment: { id: 1, type: 'dialogue', text: '我真的已经很努力了，可是还是不行。', voice: { tensionLevel: 2, script: '呜……' } }, voiceId: 'v' };
  assert.deepEqual(sentenceSampling(item, { temperature: 0.7 }, { prosodySplit: false }), { temperature: 0.7 });
  const own = { ...item, override: { text: '我真的已经很努力了，可是还是不行。', tension: 5 } };
  assert.deepEqual(sentenceSampling(own, { temperature: 0.7 }, { prosodySplit: false }), { temperature: 0.85 }, 'the reader\'s number, and their long line is no short line');
  assert.deepEqual(sentenceSampling({ ...item, override: { text: '嗯……' } }, { temperature: 0.7 }), { temperature: 0.7, repetitionPenalty: 1.5 });
});

test('sentences share a request only where they would be sent alike at the reader\'s own speed', () => {
  const fish = { model: 's2-pro', speed: 1.2, volume: 0, temperature: 0.7 };
  const items = [
    { segment: { id: 1, lineId: 1, type: 'narration', text: '风停了。' }, voiceId: 'v', override: { text: '风停了。', speed: 1 } },
    { segment: { id: 2, lineId: 1, type: 'narration', text: '云散了。' }, voiceId: 'v' },
    { segment: { id: 3, lineId: 1, type: 'narration', text: '天亮了。' }, voiceId: 'v' },
  ];
  const parts = planFishParts(items, { model: 's2-pro', fish });
  assert.deepEqual(parts.map(part => part.map(item => item.segment.id)), [[1], [2, 3]]);
  assert.equal(buildFishPayload(parts[1], { ...fish, format: 'mp3' }).body.prosody.speed, 1.2);
});

test('a reader\'s own take keeps its pace, volume and tension even where the floor goes whole', () => {
  const fish = { model: 's2-pro', speed: 1, volume: 0, temperature: 0.7, format: 'mp3' };
  const own = { segment: { id: 2, lineId: 1, type: 'dialogue', text: '我真的已经很努力了，可是还是不行。' }, voiceId: 'v', override: { text: '我真的已经很努力了，可是还是不行。', speed: 0.8, volume: -4, tension: 5 } };
  const { body } = buildFishPayload([own], fish, { wholeFloor: true });
  assert.deepEqual([body.prosody.speed, body.prosody.volume, body.temperature], [0.8, -4, 0.85]);
  const plain = { segment: { id: 3, lineId: 2, type: 'narration', text: '风停了。' }, voiceId: 'v' };
  const whole = buildFishPayload([plain, { ...own, override: undefined }], fish, { wholeFloor: true }).body;
  assert.deepEqual([whole.prosody.speed, whole.temperature], [1, 0.7], 'the floor sent whole keeps the reader\'s own settings');
});

test('a one-character question keeps its question mark however the analysis performs it (疑问尾词保护)', () => {
  const said = (source, content) => acousticScript(content, source, { intimate: true }).script;
  // ~ in its place, nothing after it, a stutter and an ellipsis: the question mark follows what was said.
  assert.equal(said('「嗯？」', '[whisper][breathy] 嗯~'), '[whisper][breathy] 嗯~？');
  assert.equal(said('喜欢这条裙子吗？嗯？', '[whisper][breathy] 喜欢这条裙子吗？ [whisper] 嗯'), '[whisper][breathy] 喜欢这条裙子吗？ [whisper] 嗯？');
  assert.equal(said('嗯？', '嗯嗯……'), '嗯嗯……？');
  // At the start, before the words it asks about, and in Japanese.
  assert.equal(said('嗯？喜欢这条裙子吗？', '[whisper][breathy] 嗯~ [whisper] 喜欢这条裙子吗~'), '[whisper][breathy] 嗯~？ [whisper] 喜欢这条裙子吗~');
  assert.equal(said('え？そうなの？', '[whisper] え～ そうなの～'), '[whisper] え～？ そうなの～');
  // One that kept it is left as written; a question with words in it is the model's to shape.
  assert.equal(said('嗯？', '嗯~？'), '嗯~？');
  assert.equal(said('好啊？', '[snicker] 好啊~'), '[snicker] 好啊~');
  // A content that does not fit still falls back to the sentence as written, question mark and all.
  assert.equal(said('嗯？', '[whisper] 不对'), '[whisper] 嗯？');
});

test('分析模式 is told to keep the question marks of one-character questions, the intimate rule included', () => {
  const numbers = DEEP_PROMPT.split('\n').map(line => line.match(/^(\d+)\. /)?.[1]).filter(Boolean).map(Number);
  assert.deepEqual(numbers, Array.from({ length: 19 }, (_, index) => index + 1));
  assert.match(DEEP_PROMPT, /9\. 疑问尾词保护（务必执行，防止疑问被主情绪盖平）/);
  assert.match(DEEP_PROMPT, /它的 ？ 绝不能改成 ~，也不能删；可以和 ~ 并存写成 嗯~？/);
  assert.match(DEEP_PROMPT, /\[whisper\]\[breathy\] 喜欢这条裙子吗？ \[whisper\] 嗯？/);
  assert.match(DEEP_PROMPT, /正文的标点可以换成这些（第 9 条的单字疑问的 ？ 除外）/);
  // The rules that point at others still point at the same ones.
  assert.match(DEEP_PROMPT, /哭出来了按第 14 条/);
  assert.match(DEEP_PROMPT, /14\. 哭泣/);
  assert.match(DEEP_PROMPT, /12\. 高张力长句/);
  assert.match(ACOUSTIC_INTIMATE_ON, /叠加第 16 条的害羞配方/);
  assert.match(DEEP_PROMPT, /16\. 害羞/);
  assert.match(ACOUSTIC_INTIMATE_ON, /单字疑问照第 9 条保住 ？，不改成 ~/);
});

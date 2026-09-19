import { normalizeTts } from './core.js?v=0.28.0';
import {
  FISH_EMOTIONS,
  FISH_SOUNDS,
  FISH_TONES,
  fillPrompt,
  leadList,
  referenceLines,
  rosterList,
  styleEntries,
} from './tts.js?v=0.28.0';

// ---------------------------------------------------------------------------------------------
// The deep reading, on its own.
//
// Everything the deep reading is made of lives here and nowhere else: its prompt, the request it
// sends (the floor with its card, worldbook, recent floors and the simple reading's skeleton), and
// the connection it goes out on. The rest of the reading — cutting sentences, naming speakers, the
// simple reading, the cache, the provider adapter — never looks in here, so a change to how the
// deep reading thinks never has to touch them, and they never have to know it changed.
//
// On the simple reading's skeleton it reads the floor again with its context and judges the cause
// and the weight of each feeling — the work a reader would otherwise do by hand on the console —
// and answers in Fish's own words: a mood at a strength, a tone, a speed, a volume, pauses, one turn
// inside a sentence, a sound. No free-text directions: those read badly. `DEEP_STATUS` says whether
// it is open; the settings page follows that word.
// ---------------------------------------------------------------------------------------------

export const DEEP_STATUS = Object.freeze({ available: true, note: '可用' });

export const DEEP_PROMPT = [
  '你是有声小说的配音导演。下面是一楼正文按顺序切好的句子，附带这一楼的背景资料，还有已经搭好的骨架（skeleton：每句已有的说话人和情绪，来自翻译或简单分析）。骨架说的是每一句「大概是什么感觉」；你的工作是弄清「为什么是这个感觉、有多重」，把每一句的表演定下来：情绪、强度、语气、语速、音量、停顿、非语言声音。不改写、不复述、不翻译任何句子。',
  '输入：utterances 每项有 id、kind（quoted 表示在引号里，narration 表示不在引号里）和 text，个别对白句带 speaker，那是用户手动定的，照抄不改；skeleton 是每句已有的说话人和情绪；references 里是角色卡、世界书和前几楼的剧情；previous 是各角色在前几楼最后说的话和当时的念法；styles 是每个角色的表达习惯和用户在调音台上定下的规则，是硬性要求，每一条都要落实到你写的字段上，写完对照一遍。',
  '只输出一个 JSON 对象，不要任何解释：{"voices":[{"id":1,"type":"narration"},{"id":2,"type":"dialogue","speaker":"名字","why":"不超过 20 字的依据","emotion":"英文情绪词","intensity":1,"tone":"英文语气词","speed":"slow","volume":"quiet","pauses":[{"after":"句中的词","length":"short"}],"shift":{"at":"句中的词","emotion":"英文情绪词"},"sounds":[{"at":"start","tag":"英文声音词"}]}]}',
  '每一句先想清楚再填：这句为什么这样说；表面的情绪和底下的情绪；和上一句的关系，是延续、转折还是爆发；说话的目的（试探、掩饰、安抚、挑衅……）；说的人和听的人是什么关系。结论写进 why，字段按结论填。',
  '省力原则：骨架里的说话人和情绪都对、强度不用改、也不需要停顿和声音的句子，只写 {"id":N}，骨架自动沿用。',
  '1. type：dialogue（角色说出口的话）或 narration（旁白、叙述、动作、心理描写）。引号用来标书名、专有名词、强调或引用时是 narration；不在引号里却明显是角色在说的话也是 dialogue。',
  '2. speaker 只给 dialogue：优先从 roster 里逐字照抄名字，不加敬称；roster 里没有的人写正文里对这个人的称呼；skeleton 里已有的说话人一般沿用，只在明显错了时改。{{user}}看不出是谁说的就省略，不要猜。',
  '3. emotion：只能取 emotions 列表里的一个英文词，逐字照抄；对白句都要给，旁白只在明显带情绪时给。骨架里的情绪是参考：底下的情绪和表面不一样时，按念出来该有的那个给。不要自己造词，不要加 slightly、very 这类程度词。',
  '4. intensity 是这一句的感情浓度：0 弱、1 中、2 强，按语义和情境定——压着说、试探、耳语、平常的交代是 0，明显起伏是 1，爆发、哭喊、狂喜、崩溃是 2。同一角色连续几句要有起伏，不要全写一个数。',
  '5. tone：可选，只能取 tones 列表里的一个；speed 只能是 slow 或 fast；volume 只能是 quiet 或 loud；都只在明显时写。',
  '6. pauses：句中某个词后面要停顿，after 逐字照抄句中的词，length 是 short 或 long，最多两处，只在犹豫、转折、哽住处写。shift：句子从某个词起情绪明显变了，at 逐字照抄那个词，emotion 取 emotions 列表里的词，一句最多一处，没有就不写。',
  '7. sounds：笑声、叹气、喘息、倒吸气这类非语言声音，只在原文写了、或者情绪明显到该有的时候写，tag 只能取 sounds 列表里的词，at 是 start（句首）或 end（句尾），一句最多一个。',
  '8. 上一句的情绪只是参考，不是惯性：剧情已经跳过时间、换了场景、事情已经解决，情绪就不延续；只有剧情上有连续的依据（同一场对话、同一件没解决的事）才延续。previous 里的念法同理。',
  '9. lang：这一句的语言代码（zh、en、ja、ko、de、fr、es、ru……），与整楼主要语言相同时省略。每个 id 最多出现一次。不要输出 text，不要输出 id 以外的句子内容。输入里的 lead 是这一批前面紧挨着的几句，只用来认人和判断语气，不用回答。',
  '{{references_rule}}',
].join('\n');

/**
 * The connection the deep reading goes out on: its own when one is chosen and still exists, else
 * the translation's. The simple reading never comes here; it always follows the translation.
 */
export function deepRequestSettings(settings) {
  const id = normalizeTts(settings?.tts).deepChannelId;
  if (!id) return settings;
  const channel = (Array.isArray(settings?.channels) ? settings.channels : []).find(item => item.id === id);
  if (!channel) return settings;
  return { ...settings, apiMode: 'independent', selectedChannelId: id };
}

// The translation's own labels, as the base the deep reading may leave alone. Where the translation
// chose one of Fish's words, that word goes rather than the palette's fold of it, and so does the tone.
function skeletonFor(utterances, hints, voices = null) {
  const list = Array.isArray(utterances) ? utterances : [];
  return list
    .filter(item => (hints instanceof Map && hints.has(item.id)) || (voices instanceof Map && voices.has(item.id)))
    .map(item => {
      const hint = hints instanceof Map ? (hints.get(item.id) ?? {}) : {};
      const voice = voices instanceof Map ? (voices.get(item.id) ?? {}) : {};
      const emotion = voice.emotion || hint.emotion;
      const entry = { id: item.id };
      if (hint.speaker) entry.speaker = hint.speaker;
      if (emotion) entry.emotion = emotion;
      if (hint.intensity !== undefined) entry.intensity = hint.intensity;
      for (const key of ['direction', 'tone', 'speed', 'volume', 'stress', 'pauses', 'sounds', 'shifts']) if (voice[key] !== undefined) entry[key] = voice[key];
      return entry;
    });
}

// What each speaker said last, before this floor, with the direction it was read in.
function previousEntries(previous) {
  return (Array.isArray(previous) ? previous : [])
    .map(item => ({ speaker: String(item?.speaker ?? '').trim().slice(0, 60), text: String(item?.text ?? '').trim().slice(0, 120), ...(item?.direction ? { direction: String(item.direction).trim().slice(0, 60) } : {}) }))
    .filter(item => item.speaker && item.text)
    .slice(0, 12);
}

/**
 * The deep request. The floor's sentences go with the cast, the card, the worldbook and the last few
 * floors, and the answer describes the voice of every sentence that needs one. The translation's own
 * labels ride along as hints: a sentence whose mood is the hint's and turns nowhere is answered with
 * its id alone, and the hint stands. Speaker, type and language come back the same way the light
 * request returns them; the rest is the voice.
 */
export function buildDeepAnalysisMessages(utterances, { roster = [], characterName = '', userName = '', translations = null, packet = {}, hints = null, hintVoices = null, systemPrompt = '', lead = null, styles = null, previous = null, speakers = null } = {}) {
  const references = referenceLines(translations);
  const system = fillPrompt(String(systemPrompt ?? '').trim() || DEEP_PROMPT, { userName, references: references.length > 0 });
  const referencesBlock = {};
  for (const key of ['character', 'worldbook', 'recent']) {
    const value = String(packet?.[key] ?? '').trim();
    if (value) referencesBlock[key] = value;
  }
  const skeleton = skeletonFor(utterances, hints, hintVoices);
  const leads = leadList(lead, speakers);
  const named = speakers instanceof Map ? speakers : new Map();
  const styleList = styleEntries(styles);
  const previousList = previousEntries(previous);
  const input = {
    task: 'direct_voices_for_audiobook',
    ...(characterName ? { character: characterName } : {}),
    ...(userName ? { user: userName } : {}),
    roster: rosterList(roster),
    emotions: FISH_EMOTIONS,
    tones: FISH_TONES,
    sounds: FISH_SOUNDS,
    ...(Object.keys(referencesBlock).length ? { references: referencesBlock } : {}),
    ...(styleList.length ? { styles: styleList } : {}),
    ...(previousList.length ? { previous: previousList } : {}),
    ...(skeleton.length ? { skeleton } : {}),
    ...(leads.length ? { lead: leads } : {}),
    utterances: (Array.isArray(utterances) ? utterances : []).map(item => ({
      id: item.id,
      ...(references.length ? { line: item.lineId } : {}),
      kind: item.kind,
      ...(named.get(item.id) ? { speaker: named.get(item.id) } : {}),
      text: item.anchor,
    })),
    ...(references.length ? { translations: references } : {}),
  };
  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(input) },
  ];
}

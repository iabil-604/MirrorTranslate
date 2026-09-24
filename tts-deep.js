import { normalizeTts } from './core.js?v=0.37.0-beta.1';
import {
  FISH_EMOTIONS,
  FISH_TONES,
  SOFT_MOODS,
  SOUND_END_RULE,
  SOUND_GROUNDS,
  SOUND_PLACE_RULE,
  SPOKEN_SOUNDS,
  fillPrompt,
  floorTextWithMarks,
  mixedScripts,
  referenceLines,
  rosterList,
  styleEntries,
} from './tts.js?v=0.37.0-beta.1';

// ---------------------------------------------------------------------------------------------
// The deep reading, on its own.
//
// Everything the deep reading is made of lives here and nowhere else: its prompt, the request it
// sends (the floor with its card, worldbook, recent floors and the simple reading's skeleton), and
// the connection it goes out on. The rest of the reading — cutting sentences, naming speakers, the
// simple reading, the cache, the provider adapter — never looks in here, so a change to how the
// deep reading thinks never has to touch them, and they never have to know it changed.
//
// It reads the original on its own, the moment the floor has closed, whatever the translation is
// doing: the dialogue with the paragraphs around it, the character's profile, the last floor. It
// answers for the dialogue alone, in Fish's own words: who speaks, the mood, the turns of mood inside
// a sentence, a tone, a speed, a volume, pauses, stresses, sounds where they fall — the work a reader
// would otherwise do by hand on the console. No free-text directions: those read badly. `DEEP_STATUS` says whether
// it is open; the settings page follows that word.
// ---------------------------------------------------------------------------------------------

export const DEEP_STATUS = Object.freeze({ available: true, note: '可用' });

export const DEEP_PROMPT = [
  '你是有声小说的配音导演。lines 是一楼正文，按段给出，引号里的话前面标着 ⟦编号⟧；references 里有角色资料、世界书和前面几楼；roster 是登记过的名字；character 是角色卡的名字，user 是用户扮演的角色；styles 是角色的表达习惯和用户在调音台上定下的规则，是硬性要求，只有声音例外：第 9、10 条的限制 styles 也不能放宽。你只管带编号的句子：由谁念，什么情绪，一句里情绪在哪里转，哪里停一下，哪个词重读，哪里有正文写出来的声音。旁白不用管，也不用输出。不改写、不复述、不翻译任何句子。',
  '只输出一个 JSON 对象，不要任何解释：{"voices":[{"id":4,"speaker":"名字","emotion":"英文情绪词","shifts":[{"at":"分句开头的词","emotion":"英文情绪词"}],"tone":"英文语气词","pauses":[{"after":"词","length":"short"}],"stress":["词"],"sounds":[{"at":"after","after":"词","tag":"英文声音词","evidence":"正文原字"}]},{"id":5,"type":"narration"}]}。示例里没有的 intensity、speed、volume 按第 4、12 条写。不要输出 text；用不上的字段不写。',
  '1. 编号：每个 ⟦编号⟧ 都要回答，按编号从小到大，每个只出现一次，一个都不能漏。说话人和情绪都看不出时，只写 {"id":N,"type":"dialogue"}；看得出情绪、看不出说话人时照写 emotion，不写 speaker。',
  '2. 不是说出口的话：引号里是书名、招牌、标语、信和文件上的字、拟声词（「砰」「咔嚓」）时（比如门上写着「闲人免进」），只写 {"id":N,"type":"narration"}。引号里心里想的话算这个人的话，照常写 speaker。speakers 里的编号都是说出口的话。',
  '3. speaker：从 roster 里逐字照抄名字，不加敬称，不加括号说明。正文用昵称、姓或称呼（「学姐」「那家伙」）指 roster 里的人，也写 roster 里的名字；正文用「你」「我」指某个人，写这个人的名字；roster 里没有的人，写正文对他的称呼。按这个顺序判断：引号前后写明的说话人和动作 → 话里叫到的名字（被叫到的是听的人，不是说的人）→ 话里的自称、口癖和语尾 → 对话一来一回的顺序。不要写「他」「她」「众人」「旁白」「未知」。character 可能是整个故事或旁白的名字，正文没显示是这个人在说，就不要写它。{{user}}看不出是谁说的就省略 speaker，不要猜。输入里的 speakers 是用户手动定的说话人，这些编号照抄。',
  '4. emotion：这句开头的情绪，只能从 emotions 列表里选一个词逐字照抄，不加表示程度的词，不自己造词；看不出明显情绪就不写，不要拿 calm 凑数。依据按这个顺序：这句话本身的字面、语气词和标点 → 紧挨着它的动作和神态描写 → 前后几句。不要拿整场的气氛代替这一句：吵架里也有平静的一句，伤心的场景里也有勉强的笑。嘴硬、说反话、强装镇定的句子，按念出来听得到的那一层选。intensity：0 弱、1 中、2 强，情绪明显比平常弱或强、或者 styles 要求时才写。',
  '5. 没有更贴切的词时，常见说法这样对应：嘴硬、傲娇 → embarrassed 或 frustrated；温柔安慰、哄人 → empathetic 或 compassionate；亲昵、说情话 → tender；调侃、逗人 → playful，带刺的 → sarcastic；担心 → worried；害怕 → scared 或 nervous；慌张 → anxious；冷淡、敷衍 → indifferent；瞧不起人 → contemptuous；得意 → proud；感动 → moved；失落 → disappointed；认命 → resigned。',
  '6. 特殊状态：喝醉 → relaxed 或 happy，醉得难受 → unhappy；困、累、刚睡醒 → tired 或 bored；生病、受伤、没力气 → 按话的意思选 tired、sad 或 worried；冷着脸生气、压着火 → angry 或 disdainful，不写 shouting；阴阳怪气、说反话 → sarcastic。这些状态都不自带声音：哈欠、闷哼、喘气要正文写了，才按第 9 条加。',
  '7. shifts：一句里情绪真的转了才写，最多两处。at 逐字照抄转折那个分句开头的几个字，它必须在句子中间，不能是这句的开头；emotion 取 emotions 列表里的词，而且和转之前的不一样。算转折的只有正文写出来的变化：「可是」「但是」「不过」或省略号之后话锋一转，先笑着后来哭了这类。整句一个口气、或者六个字以内的短句，不写。',
  '8. pauses：只写在没有标点、但念的时候要顿一下的地方（话说到一半卡住，说出关键的词之前），after 逐字照抄停顿前的那个词，length 是 short 或 long，一句最多两处；标点处本来就会停，省略号、破折号、波浪号紧挨着的地方和句子最后更不要写。stress：这句真正要咬重的词，逐字照抄，最多两个。大多数句子两项都不写；styles 对停顿另有要求时按 styles。',
  `9. sounds：只加正文在引号外写出来、而且是这个说话人此刻发出的声音，只看这句所在的这一段、或前后紧挨着的没有台词的叙述段（看意思，不要求逐字；笑容、微笑、开玩笑不算笑，感叹不算叹气，深吸一口气不算倒吸气）：${SOUND_GROUNDS}。evidence 逐字照抄写出这个声音的那几个字，抄不出来就不加。一句最多一处。at 写 start（句首）或 after（某个词之后，after 逐字照抄那个词）；end（句尾）只在同一段里这句后面还有正文时用。${SOUND_PLACE_RULE}${SOUND_END_RULE}`,
  '10. 不加声音：正文没写的一律不加，styles 也不能让你加。亲密、撒娇、调情的句子不加喘气、叹气一类的声音，除非描写里写着这个人此刻在喘、在叹气；娇喘、呻吟不算喘气，sounds 列表里没有它们，也不要拿别的词代替。这句本身就是「嗯」「啊」「哈啊」「唔」「呜」这类语气词，或者引号里已经写了「唉」「哈哈」「呜呜」，不再叠加声音。哭着说、笑着说只在描写里写了哭、哽咽、笑着、大笑时才加。',
  `11. 只有语气词的句子（「嗯……」「啊？」「唔」「哈？」）：只写 speaker 和 emotion，emotion 不用 ${SOFT_MOODS.join('、')}，描写里写了喊、尖叫时可以加 tone（shouting 或 screaming）；不写 shifts、pauses、stress、sounds。去掉标点不到三个字（英文只有一个词）的句子不写 shifts、pauses、stress。`,
  '12. tone、speed、volume：只在正文写了这句是怎么说出来的时候写。tone：小声、低声、耳语、压低声音 → whispering 或 soft tone；喊、吼、大声 → shouting；尖叫、惨叫 → screaming；急忙、飞快地说 → in a hurry tone。speed 是 slow 或 fast，只在写明说得慢或快时写；volume 是 quiet 或 loud，只在写明说得轻或响、而且没写 tone 时写。正文没写就都不写；styles 对语速、音量另有要求时按 styles，但 whispering 和 soft tone 仍要正文写了小声、耳语才写。',
  '13. 一楼是一条走向：情绪跟着剧情走，剧情转了才转。上一句的情绪只是参考，不是惯性：换了场景、事情已经过去，就不延续。还在同一件事、同一口气里的相邻两句，不要从一头跳到另一头（从 calm 直接跳到 hysterical）；同一个人前后几句的情绪要接得上。',
  '14. 大多数句子只要 speaker 和 emotion。shifts、pauses、stress、sounds、tone、speed、volume 只给真正需要的那几句；字段越少，念出来越像人说话，回得也越快。styles 要求更多时按 styles，声音仍按第 9、10 条。',
  '15. 输出前在心里核对一遍，不要写出来：编号齐全、从小到大；每个英文词都在对应的列表里原样出现；at、after、stress、evidence 里的字都能在正文里原样找到；没有正文没写的声音。不要在 JSON 之外写任何思考过程。',
  '{{lang_rule}}',
  '{{references_rule}}',
].join('\n');

/**
 * The connection the deep reading goes out on: its own when one is chosen and still exists — a saved
 * connection, or 'follow' for the host's own — else the one the reading's analysis already goes to,
 * which the caller has applied. The simple reading never comes here.
 */
export function deepRequestSettings(settings) {
  const id = normalizeTts(settings?.tts).deepChannelId;
  if (!id) return settings;
  if (id === 'follow') return settings?.apiMode === 'follow' ? settings : { ...settings, apiMode: 'follow' };
  const channel = (Array.isArray(settings?.channels) ? settings.channels : []).find(item => item.id === id);
  if (!channel) return settings;
  if (settings?.apiMode === 'independent' && settings?.selectedChannelId === id) return settings;
  return { ...settings, apiMode: 'independent', selectedChannelId: id };
}

/**
 * The deep request. The floor's paragraphs go with the cast, the card, the worldbook and the last
 * floors, and the answer describes how each line of dialogue is read. Nothing of the translation
 * rides along but the reference lines that name people the way the voices are registered; the deep
 * reading is its own reading of the original.
 */
export function buildDeepAnalysisMessages(utterances, { roster = [], characterName = '', userName = '', translations = null, packet = {}, systemPrompt = '', styles = null, speakers = null } = {}) {
  const list = Array.isArray(utterances) ? utterances : [];
  const references = referenceLines(translations);
  const system = fillPrompt(String(systemPrompt ?? '').trim() || DEEP_PROMPT, { userName, references: references.length > 0, lang: mixedScripts(list) });
  const referencesBlock = {};
  for (const key of ['character', 'worldbook', 'recent']) {
    const value = String(packet?.[key] ?? '').trim();
    if (value) referencesBlock[key] = value;
  }
  const styleList = styleEntries(styles);
  const named = {};
  if (speakers instanceof Map) for (const [id, name] of speakers) if (name && list.some(item => item.id === id)) named[id] = name;
  const input = {
    task: 'direct_voices_for_audiobook',
    ...(characterName ? { character: characterName } : {}),
    ...(userName ? { user: userName } : {}),
    roster: rosterList(roster),
    emotions: FISH_EMOTIONS,
    tones: FISH_TONES,
    sounds: SPOKEN_SOUNDS,
    ...(Object.keys(referencesBlock).length ? { references: referencesBlock } : {}),
    ...(styleList.length ? { styles: styleList } : {}),
    ...(Object.keys(named).length ? { speakers: named } : {}),
    lines: floorTextWithMarks(list),
    ...(references.length ? { translations: references } : {}),
  };
  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(input) },
  ];
}

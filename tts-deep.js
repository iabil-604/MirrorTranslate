import { normalizeTts } from './core.js?v=0.36.0-beta.2';
import {
  FISH_EMOTIONS,
  FISH_SOUNDS,
  FISH_TONES,
  fillPrompt,
  floorTextWithMarks,
  mixedScripts,
  referenceLines,
  rosterList,
  styleEntries,
} from './tts.js?v=0.36.0-beta.2';

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
  '你是有声小说的配音导演。下面是一楼正文，按段给出，每句对白前面标着 ⟦编号⟧；references 里有角色资料、世界书和前一楼；roster 是登记过的名字；styles 是角色的表达习惯和用户在调音台上定下的规则，是硬性要求。你只管对白：每句由谁念，念的时候是什么情绪，一句里情绪在哪里变，哪里该停一下、重读哪个词，哪里该有叹气、笑、抽泣、喘气这类声音，让它像真人在说话。旁白不用管，也不用输出。不改写、不复述、不翻译任何句子。',
  '只输出一个 JSON 对象，不要任何解释：{"voices":[{"id":4,"speaker":"名字","emotion":"英文情绪词","shifts":[{"at":"分句开头的词","emotion":"英文情绪词"}],"tone":"英文语气词","speed":"slow","volume":"quiet","pauses":[{"after":"词","length":"short"}],"stress":["词"],"sounds":[{"at":"start","tag":"英文声音词"},{"at":"after","after":"词","tag":"英文声音词"},{"at":"end","tag":"英文声音词"}]}]}。每个编号最多出现一次；不要输出 text；用不上的字段不写。',
  '1. speaker：优先从 roster 里逐字照抄名字，不加敬称；roster 里没有的人写正文里对这个人的称呼。看引号前后的人名和动作、话里叫到的名字（被叫到的是听的人）、一来一回的顺序。{{user}}看不出是谁说的就省略。输入里的 speakers 是用户手动定的说话人，那些编号照抄。',
  '2. emotion：这句开头的情绪，只能取 emotions 列表里的一个英文词，逐字照抄，直接选最贴切的，不加程度词。想一下这个人为什么这样说、表面和底下的情绪是不是一回事，按念出来该有的那个给。',
  '3. shifts：一句里情绪变了，就在变的地方标：at 逐字照抄那个分句开头的词，emotion 是从这里起的情绪。最多三处，情绪没变就不写。转折要落在句子真的转的地方（「可是」「但是」「……」之后、问句翻成陈述句这类），前后两个情绪不要是毫不相干的两头——从平静到不安是转，从大笑到崩溃要正文真的写了才算。',
  '4. sounds：tag 只能取 sounds 列表里的词；at 是 start（句首）、end（句尾）或 after（某个词之后，after 逐字照抄那个词）。原文写了的一定加；原文没写但这个人这时候真的会有的，也可以加一个。它是可用的手段，不是每句都要用的手段：拿不准就不写，一句最多两处。moaning、groaning、panting 是拖着出声的，只有原文明写了呻吟、闷哼、喘息才用。',
  '5. pauses：某个词后面停一下，after 逐字照抄，length 是 short 或 long，最多三处；stress：重读的词，最多两个。tone 只能取 tones 列表里的词；speed 是 slow 或 fast；volume 是 quiet 或 loud；都只在明显时写。',
  '6. 上一句的情绪只是参考，不是惯性；换了场景、事情已经过去，情绪就不延续。反过来也一样：还在同一件事里的两句，不要一句冷淡一句歇斯底里；一楼读下来该是一条走向，不是一串互不相干的情绪。',
  '7. 大多数句子只要一个 emotion 就够了。shifts、pauses、stress、sounds 是给真的需要的那几句准备的，不是每句都要填；字段越少写得越快，也越像人说话。不要在回答之外写任何思考过程。',
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
    sounds: FISH_SOUNDS,
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

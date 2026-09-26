import { DEFAULT_QUOTE_PAIRS, isPlaceholderSpeaker, normalizeLanguageCode, normalizeTts, parseJsonCandidates } from './core.js?v=0.38.0';
import {
  EDGE_PUNCTUATION_RE,
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
  normalizeVoice,
  referenceLines,
  rosterList,
  styleEntries,
} from './tts.js?v=0.38.0';
import { normalizeEmotion } from './palette.js?v=0.38.0';

// ---------------------------------------------------------------------------------------------
// The deep reading, on its own.
//
// Everything the deep reading is made of lives here and nowhere else: its prompt, the request it
// sends (the floor with its card, worldbook, recent floors and the simple reading's skeleton), the
// reply it gets back and the connection it goes out on. The rest of the reading — cutting sentences,
// naming speakers, the simple reading, the cache, the provider adapter — never looks in here, so a
// change to how the deep reading thinks never has to touch them, and they never have to know it
// changed.
//
// It reads the original on its own, the moment the floor has closed, whatever the translation is
// doing: the dialogue with the paragraphs around it, the character's profile, the last floor. It
// answers for the dialogue alone, in Fish's own words, with every tag written right on the word it
// changes — a script marked up in place, rather than a set of side fields naming a word for the
// compiler to go find — so the same word said twice in a sentence is never confused for the other.
// `DEEP_STATUS` says whether it is open; the settings page follows that word.
//
// What the reply is read into is not a shape of its own: it is the very `voice` object every other
// reading builds (an emotion, a tone, pauses, stress, shifts, sounds, each keyed the same way), so a
// deep analysis stored before this file last changed reads back exactly as it always did, and
// buildSegments' one call to groundVoice — the only place either reading's voice is held to the text
// — is not repeated here. This file's own job is turning the reply's inline tags into that object, at
// the character they were written at rather than at the first place their word happens to occur.
// ---------------------------------------------------------------------------------------------

export const DEEP_STATUS = Object.freeze({ available: true, note: '可用' });

export const DEEP_PROMPT = [
  '你是有声小说的配音导演。lines 是一楼正文，按段给出，引号里的话前面标着 ⟦编号⟧；references 里有角色资料、世界书和前面几楼；roster 是登记过的名字；character 是角色卡的名字，user 是用户扮演的角色；styles 是角色的表达习惯和用户在调音台上定下的规则，是硬性要求，只有声音例外：第 10、11 条的限制 styles 也不能放宽。你只管带编号的句子：由谁念、开头是什么情绪、这句怎么念。旁白不用管，也不用输出。不改写、不复述、不翻译任何句子。',
  '只输出一个 JSON 对象，不要任何解释：{"voices":[{"id":4,"speaker":"林浅","emotion":"nervous","pace":"fast","line":"[nervous] 你别靠这么近 [pause] 会让人看见的。"},{"id":5,"type":"narration"}]}。line 是这句话本身，一字不改地抄一遍，只能往里面插 [标签]，标签和它紧挨着的字之间空一格；旁白只写 type，不写 line。speaker、emotion、pace 看不出就不写。',
  '1. 编号：每个 ⟦编号⟧ 都要回答，按编号从小到大，每个只出现一次，一个都不能漏。',
  '2. 不是说出口的话：引号里是书名、招牌、标语、信和文件上的字、拟声词（「砰」「咔嚓」）时（比如门上写着「闲人免进」），只写 {"id":N,"type":"narration"}。引号里心里想的话算这个人的话，照常写 speaker。speakers 里的编号都是说出口的话。',
  '3. speaker：从 roster 里逐字照抄名字，不加敬称，不加括号说明。正文用昵称、姓或称呼（「学姐」「那家伙」）指 roster 里的人，也写 roster 里的名字；正文用「你」「我」指某个人，写这个人的名字；roster 里没有的人，写正文对他的称呼。按这个顺序判断：引号前后写明的说话人和动作 → 话里叫到的名字（被叫到的是听的人，不是说的人）→ 话里的自称、口癖和语尾 → 对话一来一回的顺序。不要写「他」「她」「众人」「旁白」「未知」。character 可能是整个故事或旁白的名字，正文没显示是这个人在说，就不要写它。{{user}}看不出是谁说的就省略 speaker，不要猜。输入里的 speakers 是用户手动定的说话人，这些编号照抄。',
  '4. emotion：这句开头的情绪，只能从 emotions 列表里选一个词逐字照抄，不加表示程度的词，不自己造词；看得出情绪、看不出说话人时照写 emotion，不写 speaker；看不出明显情绪就不写，不要拿 calm 凑数。依据按这个顺序：这句话本身的字面、语气词和标点 → 紧挨着它的动作和神态描写 → 前后几句。不要拿整场的气氛代替这一句：吵架里也有平静的一句，伤心的场景里也有勉强的笑。嘴硬、说反话、强装镇定的句子，按念出来听得到的那一层选。',
  '5. 没有更贴切的词时，常见说法这样对应：嘴硬、傲娇 → embarrassed 或 frustrated；温柔安慰、哄人 → empathetic 或 compassionate；亲昵、说情话 → tender；调侃、逗人 → playful，带刺的 → sarcastic；担心 → worried；害怕 → scared 或 nervous；慌张 → anxious；冷淡、敷衍 → indifferent；瞧不起人 → contemptuous；得意 → proud；感动 → moved；失落 → disappointed；认命 → resigned。',
  '6. 特殊状态：喝醉 → relaxed 或 happy，醉得难受 → unhappy；困、累、刚睡醒 → tired 或 bored；生病、受伤、没力气 → 按话的意思选 tired、sad 或 worried；冷着脸生气、压着火 → angry 或 disdainful，不写 shouting；阴阳怪气、说反话 → sarcastic。这些状态都不自带声音：哈欠、闷哼、喘气要正文写了，才按第 9、10 条加进 line。',
  '7. pace：这句整体的语速，取 slow、normal、fast，正常语速不写；只在正文明显写了说得快或慢时写，用法和朗读设置里的语速一样。',
  `8. line 里能插的标签，都贴着生效的那个字放，一句里的标签各管各的位置：情绪词（emotions 里的词）放在句首，算这句的开头情绪，和 emotion 字段一致，最多再跟一个不同的情绪词；放在句子中间某个分句开头，算这句从这里转成那个情绪（转折），转折处不能是这句的第一个字，最多两处。语气词（tones 里的 whispering、soft tone、shouting、screaming、in a hurry tone）只能放在句首，一句最多一个，正文写了小声、耳语、喊、尖叫、说得很急才写。声音词（sounds 里的词）放在句首、句尾或句中某个词之后，全句最多一个，只有这句所在的这一段、或前后紧挨着的没有台词的叙述段，写出了这个说话人此刻发出这个声音才写（看意思，不要求逐字）：${SOUND_GROUNDS}。${SOUND_PLACE_RULE}${SOUND_END_RULE} [pause]（短停顿）、[long pause]（长停顿）放在要停顿的词后面，前面必须已经有字，一句最多两处，标点本来就会停的地方不写。[emphasis] 放在要重读的词前面，表示这个词重读，一句最多两处。句首的标签最多算 3 个，多出来的、以及三张表和 pause、long pause、emphasis 之外的词，一律不生效——不要指望写更多能起作用，line 里没把握就少写。`,
  '9. 吼、怒吼、大喊：情绪仍按第 4、5 条从 emotions 里选（angry、frustrated 这类），正文确实写了喊、吼、大声才在句首加 [shouting]；抽气、喘气这类呼吸声只在正文明确写了倒吸一口气、喘着气时才作为声音词加在那处，愤怒本身不天然带呼吸声，看到吼、怒吼不要顺手配上 [gasp][panting]。',
  '10. line 除了 [标签] 什么都不能加：不许补标点，不许插入正文没有的拟声字（比如「呼……」「~」），不许改一个字、漏一个字。line 去掉标签、去掉首尾的引号（如果带着的话）之后要和这句正文逐字一样，一个字、一个标点都对不上就整句只保留句首那串标签，句中的一律不算。',
  '11. emotions、tones、sounds 三张表里的词都是合法标签，选中它就能写进 line，不必顾虑「太露骨」；这三张表、加上 pause、long pause、emphasis，是 line 里能出现的全部词，别的英文词写了也不算数。',
  `12. 只有语气词的句子（「嗯……」「啊？」「唔」「哈？」）：只写 speaker 和 emotion，emotion 不用 ${SOFT_MOODS.join('、')}；line 里最多在句首加一个 [shouting] 或 [screaming]（正文写了喊、尖叫才加），不写别的标签。`,
  '13. 一楼是一条走向：情绪跟着剧情走，剧情转了才转。上一句的情绪只是参考，不是惯性：换了场景、事情已经过去，就不延续。还在同一件事、同一口气里的相邻两句，不要从一头跳到另一头（从 calm 直接跳到 hysterical）；同一个人前后几句的情绪要接得上。',
  '14. 大多数句子的 line 只要照抄这句、一个标签都不加；情绪和场面真有起伏的句子才多写。标签越少，念出来越像人说话，回得也越快。styles 要求更多时按 styles，第 9、10、11 条不放宽。',
  '15. 输出前在心里核对一遍，不要写出来：编号齐全、从小到大；speaker 之外，emotion、tone、sounds 里用到的每个英文词都在对应的列表里原样出现；line 去掉标签、去掉首尾引号后和正文这句逐字一样；没有正文没写的声音，没有超过第 8 条的上限。不要在 JSON 之外写任何思考过程。',
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

// ---------------------------------------------------------------------------------------------
// Reading the reply.
//
// Every legal word in a tag is one of three vocabularies (an emotion, a tone, a sound) or one of
// three fixed markers (pause, long pause, emphasis); everything else is not a word this reading
// knows and is dropped where it stands. Six of the words the reference script this reading is built
// from spells its own way — whisper, snicker, laughter, sigh, gasp, groan — are understood as the
// words this reading already speaks, so a model that reaches for Fish's documented name instead of
// the offered list is still read correctly; pause and break name the same short pause.
// ---------------------------------------------------------------------------------------------

const DEEP_TAG_ALIASES = Object.freeze({
  whisper: 'whispering',
  snicker: 'chuckling',
  laughter: 'laughing',
  sigh: 'sighing',
  gasp: 'gasping',
  groan: 'groaning',
});

const VOICE_LEVELS = new Set(['slow', 'normal', 'fast']);
const TAG_CAPS = Object.freeze({ start: 3, shifts: 2, pauses: 2, stress: 2, sounds: 1 });

// The same loose word Fish's own tags are read as: letters, spaces, apostrophes and hyphens, nothing
// that could be a fragment of the sentence itself.
function cueLike(value) {
  const word = String(value ?? '').trim().toLowerCase().replace(/[[\]()]/g, '').replace(/\s+/g, ' ');
  return /^[a-z][a-z '-]{0,40}$/.test(word) ? word : '';
}

// One tag word, told apart: a pause of one length or the other, a stress marker, or — once the
// reference script's own spelling has been folded to this reading's — an emotion, a tone or a sound.
// Anything else, including a word from a vocabulary this reading never offered, is unknown.
function classifyTagWord(raw) {
  const word = cueLike(raw);
  if (!word) return { kind: 'unknown' };
  if (word === 'pause' || word === 'break') return { kind: 'pause', length: 'short' };
  if (word === 'long pause' || word === 'long-break' || word === 'long break') return { kind: 'pause', length: 'long' };
  if (word === 'emphasis') return { kind: 'emphasis' };
  const resolved = DEEP_TAG_ALIASES[word] ?? word;
  if (FISH_TONES.includes(resolved)) return { kind: 'tone', word: resolved };
  if (FISH_EMOTIONS.includes(resolved)) return { kind: 'emotion', word: resolved };
  if (SPOKEN_SOUNDS.includes(resolved)) return { kind: 'sound', word: resolved };
  return { kind: 'unknown' };
}

/**
 * `line` with every `[tag]` lifted out: the words alone, and where each tag stood in them (as a
 * character offset into what is left). The one required space on each side of a tag — the format
 * this reading's own prompt asks for — is the tag's own padding and goes with it; a run of two tags
 * back to back therefore still meets at the same offset, which is what makes them both count as the
 * sentence's own opening.
 *
 * Only a `[...]` this reading actually offers (classifyTagWord's three vocabularies and the three
 * fixed markers) is lifted out. A `[...]` the sentence itself was written with — a system message, a
 * status line, anything RP commonly puts in brackets — is not one of this reading's own words, so it
 * is left standing as part of the sentence rather than mistaken for a tag and cut out from under it.
 */
function stripInlineTags(line) {
  const source = String(line ?? '');
  let text = '';
  const tags = [];
  let index = 0;
  while (index < source.length) {
    if (source[index] === '[') {
      const close = source.indexOf(']', index + 1);
      if (close > index) {
        const word = source.slice(index + 1, close).trim();
        if (classifyTagWord(word).kind !== 'unknown') {
          // The tag's own leading space, if the model left one, goes with it — trimmed before the
          // offset is taken, so the offset lands where the words meet rather than one past it.
          if (text.endsWith(' ')) text = text.slice(0, -1);
          if (word) tags.push({ word, offset: text.length });
          index = close + 1;
          if (source[index] === ' ') index += 1;
          continue;
        }
      }
    }
    text += source[index];
    index += 1;
  }
  return { text, tags };
}

// The quotation marks this reading's own prompt shows the model around a marked run, taken off both
// ends together when a model reproduced them — the utterance itself never carries them (core's
// splitUtterances already took them off) — with every tag's offset moved down to match. The reader's
// own configured pairs are used when given (a line may be split on a pair other than the four default
// ones, and the model was shown the anchor with whichever pair actually wrapped it); the default pairs
// are the fallback, not the only ones.
function edgeQuotePairs(quotePairs) {
  const list = Array.isArray(quotePairs) && quotePairs.length ? quotePairs : DEFAULT_QUOTE_PAIRS;
  return list.map(pair => [pair[0], pair[1]]);
}

function stripEdgeQuote(text, tags, quotePairs) {
  for (const [open, close] of edgeQuotePairs(quotePairs)) {
    if (text.length < open.length + close.length || !text.startsWith(open) || !text.endsWith(close)) continue;
    const trimmed = text.slice(open.length, text.length - close.length);
    return { text: trimmed, tags: tags.map(tag => ({ ...tag, offset: Math.min(trimmed.length, Math.max(0, tag.offset - open.length)) })) };
  }
  return { text, tags };
}

// The same lead splitUtterances trimmed off `utterance.text` (EDGE_PUNCTUATION_RE) is trimmed off the
// reply's own line before the two are compared, so a sentence that legitimately opens on an ellipsis or
// a comma is not failed by the check for a lead that was never part of what the model was held to.
function trimEdgePunctuation(text) {
  const match = text.match(EDGE_PUNCTUATION_RE);
  const cut = match ? match[0].length : 0;
  return { text: text.slice(cut), cut };
}

/**
 * The character-for-character check: `stripped` (the reply's line with its tags and edge quotes
 * already taken off) against `source` (the sentence as the floor itself has it), each side's own
 * whitespace skipped rather than compared. A match returns a map from a position in `stripped` to the
 * same point in `source`, so a tag's offset converts straight across; a mismatch returns the position
 * of the first character that differs (or, when `stripped` ran out first, its own length), for the
 * one diagnostic line the caller logs about it.
 */
function alignToSource(stripped, source) {
  const isSpace = character => /\s/.test(character);
  const map = new Array(stripped.length + 1);
  let at = 0;
  for (let index = 0; index < stripped.length; index += 1) {
    const character = stripped[index];
    if (isSpace(character)) {
      map[index] = at;
      continue;
    }
    while (at < source.length && isSpace(source[at])) at += 1;
    if (source[at] !== character) return { map: null, at: index };
    map[index] = at;
    at += 1;
  }
  while (at < source.length && isSpace(source[at])) at += 1;
  if (at !== source.length) return { map: null, at: stripped.length };
  map[stripped.length] = at;
  return { map, at: -1 };
}

/** The shortest run of `text` starting at `start` that occurs nowhere else in `text`. */
function anchorForward(text, start) {
  if (start < 0 || start >= text.length) return '';
  for (let length = 1; start + length <= text.length; length += 1) {
    const candidate = text.slice(start, start + length);
    if (text.indexOf(candidate) === start) return candidate;
  }
  return text.slice(start);
}

/** The shortest run of `text` ending at `end` that occurs nowhere else in `text`. */
function anchorBackward(text, end) {
  if (end <= 0 || end > text.length) return '';
  for (let length = 1; end - length >= 0; length += 1) {
    const candidate = text.slice(end - length, end);
    if (text.indexOf(candidate) === end - length) return candidate;
  }
  return text.slice(0, end);
}

// ---------------------------------------------------------------------------------------------
// The edit panel shows a reader the word a pause or a stress sits on. anchorForward/anchorBackward
// above keep that word the shortest run that still finds it, which is what pauses.after and stress are
// stored as everywhere else — the same string a reader's own text search would use to locate it, kept
// exactly as it is. A reader looking at the panel is not searching, though: shown "近" by itself for a
// pause that trails a whole clause, they see one character. These two widen the anchor back out to the
// word or short phrase it sits in, purely for that display — the far edge, the one tag.offset itself
// pinned, is never moved; only the loose edge (the start for a pause, the end for a stress) moves out
// to the boundary of the word its own character sits in. Chinese and Japanese have no spaces between
// words, so that boundary comes from Intl.Segmenter's word segmentation rather than a character class —
// a run of CJK letters has no gaps for a naive class to stop at, and stopping instead at punctuation or
// a fixed number of characters (the old approach) just as often lands mid-word. Where Intl.Segmenter is
// missing entirely, the old letters/digits-run, capped a few characters out so a run with no punctuation
// in it does not widen without end, is what is left to fall back on. Nothing stored anywhere is this
// value; a floor edited since the analysis, or a result read back from before this existed, simply shows
// the anchor itself, exactly as the panel always has.
//
// Without a dictionary, Intl.Segmenter tells Japanese words apart mostly by script: 全部, こと, しく each
// come back whole, but a kanji stem gets cut away from the hiragana conjugation right after it (聞こえた
// -> 聞|こ|え|た), so wordBoundsAt alone hands back just the stem's own single character — and a longer
// conjugation (寝ていた -> 寝|てい|た, 食べた -> 食|べた) still leaves the stem cut off from a multi-character
// okurigana segment right next to it. extendOkurigana widens across any run of segments shaped like that:
// on the right, every further hiragana segment gets absorbed in turn (聞こえた, 許さない), stopping at a
// segment that is a known particle or conjunction (けど, から, って, なんか, …) rather than more of the
// same word, at anything that is not pure hiragana, or once OKURIGANA_MARGIN segments have been crossed;
// on the left, a segment already more than one character is only widened past when it hangs directly off
// a kanji segment (べた off 食, てい off 寝) — otherwise (こと after った) it is a whole word already and is
// left exactly where wordBoundsAt put it, same as before.
// ---------------------------------------------------------------------------------------------

const DISPLAY_WORD_RE = /[\p{L}\p{N}]/u;
const DISPLAY_MARGIN = 6;
const HAN_RUN_RE = /^\p{Script=Han}+$/u;
const HIRAGANA_RUN_RE = /^\p{Script=Hiragana}+$/u;
const OKURIGANA_MARGIN = 4;
// Particles and conjunctions that close off a conjugated word instead of continuing it — encountering
// one of these while absorbing hiragana segments to the right of a kanji stem stops the widening just
// before it, the same way a segment that is not pure hiragana already stops it.
const OKURIGANA_STOP_WORDS = new Set([
  'は', 'が', 'を', 'に', 'で', 'と', 'も', 'の', 'から', 'けど', 'けれど', 'ので', 'のに',
  'し', 'な', 'ね', 'よ', 'わ', 'って', 'とか', 'だけ', 'より', 'まで', 'へ', 'や', 'なんか', 'など', 'でも', 'しか',
]);
// The first segment right after a kanji stem is its okurigana far more often than not, even when it
// looks like a particle (待|って, 話|し|て, 笑|わ|ない, 死|に|たい): only these, which never spell a
// conjugation, stop that first step.
const NEVER_OKURIGANA = new Set([
  'は', 'が', 'を', 'の', 'へ', 'や', 'も', 'から', 'けど', 'けれど', 'ので', 'のに', 'より', 'まで',
  'とか', 'だけ', 'など', 'しか', 'なんか',
]);

// Word segmentation does not depend on locale for the languages this extension reads (Chinese, Japanese,
// English all come out the same either way), so one shared segmenter covers all of them. Older runtimes
// without Intl.Segmenter fall back to the character-class/margin widening below instead.
let wordSegmenter = null;
try {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
} catch {
  wordSegmenter = null;
}

/** The [start, end) span of the word segment `at` falls inside, or null when Intl.Segmenter is
 * unavailable, `at` is out of range, or (should it ever happen) no segment covers it. */
function wordBoundsAt(source, at) {
  if (!wordSegmenter || at < 0 || at >= source.length) return null;
  try {
    for (const piece of wordSegmenter.segment(source)) {
      const end = piece.index + piece.segment.length;
      if (at < end) return at >= piece.index ? { start: piece.index, end } : null;
    }
  } catch {
    return null;
  }
  return null;
}

/** A stress's own end, pushed further right across an okurigana run the segmenter cut away from its
 * kanji stem — every further hiragana segment in a row, not just the first, stopping at whichever comes
 * first: a segment that is not pure hiragana, a known trailing particle or conjunction (OKURIGANA_STOP_WORDS,
 * け, から, って, なんか, …) that is a separate word rather than more of the same conjugation, or the margin. */
function extendOkuriganaRight(source, bounds) {
  if (bounds.end - bounds.start !== 1) return bounds.end;
  const seed = source[bounds.start];
  if (!HAN_RUN_RE.test(seed) && !HIRAGANA_RUN_RE.test(seed)) return bounds.end;
  const seedIsHan = HAN_RUN_RE.test(seed);
  let end = bounds.end;
  for (let steps = 0; steps < OKURIGANA_MARGIN; steps += 1) {
    const next = wordBoundsAt(source, end);
    if (!next || next.start !== end) break;
    const chunk = source.slice(next.start, next.end);
    const stops = steps === 0 && seedIsHan ? NEVER_OKURIGANA : OKURIGANA_STOP_WORDS;
    if (!HIRAGANA_RUN_RE.test(chunk) || stops.has(chunk)) break;
    end = next.end;
  }
  return end;
}

/** A pause's own start, pulled further left across the same kind of cut: any hiragana run right before
 * it, one segment at a time, then the one kanji segment it hangs off of — the word's own stem, not
 * whatever came before that. The seed itself must be hiragana, never a kanji: a kanji anchor already
 * standing alone is a complete Chinese word as often as it is a cut-off Japanese one (近, 喝), and
 * nothing here can tell those apart — only a hiragana seed is the okurigana's own signature.
 *
 * The segment the anchor itself sits in (the seed) is not always a single kana — Intl.Segmenter groups
 * a whole run of okurigana together as often as not (寝ていた -> 寝|てい|た, so the seed for a pause
 * anchored on いた is the two-character segment てい). A seed longer than one character only counts as
 * okurigana, rather than a whole word already sitting on its own (こと after 言った), when it hangs
 * directly off a kanji segment; the loop below then finds that same kanji segment on its first step.
 */
function extendOkuriganaLeft(source, bounds) {
  const seed = source.slice(bounds.start, bounds.end);
  if (!HIRAGANA_RUN_RE.test(seed)) return bounds.start;
  if (seed.length > 1) {
    const stem = wordBoundsAt(source, bounds.start - 1);
    if (!stem || stem.end !== bounds.start || !HAN_RUN_RE.test(source.slice(stem.start, stem.end))) return bounds.start;
  }
  let start = bounds.start;
  for (let steps = 0; start > 0 && steps < OKURIGANA_MARGIN; steps += 1) {
    const prev = wordBoundsAt(source, start - 1);
    if (!prev || prev.end !== start) break;
    const chunk = source.slice(prev.start, prev.end);
    if (HIRAGANA_RUN_RE.test(chunk)) { start = prev.start; continue; }
    if (HAN_RUN_RE.test(chunk)) return prev.start;
    break;
  }
  return start;
}

function widenAnchor(text, anchor, side) {
  const source = String(text ?? '');
  const word = String(anchor ?? '');
  if (!word) return word;
  const at = source.indexOf(word);
  if (at < 0) return word;
  if (side === 'left') {
    const bounds = wordBoundsAt(source, at);
    if (bounds) return source.slice(extendOkuriganaLeft(source, bounds), at + word.length);
    let start = at;
    for (let steps = 0; start > 0 && steps < DISPLAY_MARGIN && DISPLAY_WORD_RE.test(source[start - 1]); steps += 1) start -= 1;
    return source.slice(start, at + word.length);
  }
  const bounds = wordBoundsAt(source, at + word.length - 1);
  if (bounds) return source.slice(at, extendOkuriganaRight(source, bounds));
  let end = at + word.length;
  for (let steps = 0; end < source.length && steps < DISPLAY_MARGIN && DISPLAY_WORD_RE.test(source[end]); steps += 1) end += 1;
  return source.slice(at, end);
}

/** A pause's anchor, widened toward its own start — a pause lands right where the anchor already ends,
 * so that edge is kept exactly and only the word it opens on is guessed at. Panel display only. */
export function pauseDisplay(text, after) {
  return widenAnchor(text, after, 'left');
}

/** A stress anchor, widened toward its own end — stress lands right where the anchor already starts,
 * so that edge is kept exactly and only the rest of the word is guessed at. Panel display only. */
export function stressDisplay(text, word) {
  return widenAnchor(text, word, 'right');
}

/**
 * Tags, in the order they stood, turned into the same `voice` shape every other reading builds.
 *
 * Each tag's offset is a position in `sourceText` — 0 is the sentence's own opening, `sourceText.length`
 * its close. `full` is false only once this line failed the word-for-word check: then only the run of
 * tags standing at offset 0, the sentence's own opening, is read at all (the same little a bare mood
 * and tone the simple reading would have given it), and everything a tag further in would have placed
 * is left for `groundVoice` to never see. The caps (TAG_CAPS) hold whether or not the check passed:
 * three tags at the opening, two turns, two pauses, two stresses, one sound, no more — a model that
 * stacks more than this reading asked for is trimmed rather than obeyed.
 *
 * An anchor for a mid-sentence tag is not the word the model wrote beside it but the shortest run of
 * `sourceText` that starts or ends exactly at that tag's own offset and nowhere else in the sentence —
 * so the second `Alice` in a line that says her name twice is never the one a pause lands on because
 * the first one already claimed the same word.
 */
function classifyAndApply(voice, tags, sourceText, { full = true } = {}) {
  let startUsed = 0;
  let shiftsUsed = 0;
  let pausesUsed = 0;
  let stressUsed = 0;
  let soundsUsed = 0;
  const shifts = [];
  const pauses = [];
  const stress = [];
  const sounds = [];
  const length = sourceText.length;
  for (const tag of tags) {
    const atStart = tag.offset === 0;
    if (!full && !atStart) continue;
    if (atStart) {
      if (startUsed >= TAG_CAPS.start) continue;
      startUsed += 1;
    }
    const cls = classifyTagWord(tag.word);
    if (cls.kind === 'emotion') {
      if (atStart) {
        if (voice.emotion === undefined) voice.emotion = cls.word;
        else if (voice.secondary === undefined && cls.word !== voice.emotion) voice.secondary = cls.word;
      } else if (full && shiftsUsed < TAG_CAPS.shifts) {
        const anchor = anchorForward(sourceText, tag.offset);
        if (anchor) {
          shifts.push({ at: anchor, emotion: cls.word });
          shiftsUsed += 1;
        }
      }
    } else if (cls.kind === 'tone') {
      // A tone named mid-sentence has no slot of its own — one voice speaks the whole line — so only
      // the one at the opening is kept.
      if (atStart && voice.tone === undefined) voice.tone = cls.word;
    } else if (cls.kind === 'sound') {
      if (soundsUsed >= TAG_CAPS.sounds) continue;
      const at = atStart ? 'start' : tag.offset >= length ? 'end' : full ? 'after' : null;
      if (!at) continue;
      const entry = { at, tag: cls.word };
      if (at === 'after') {
        const anchor = anchorBackward(sourceText, tag.offset);
        if (!anchor) continue;
        entry.after = anchor;
      }
      sounds.push(entry);
      soundsUsed += 1;
    } else if (cls.kind === 'pause' && full && tag.offset > 0 && pausesUsed < TAG_CAPS.pauses) {
      const anchor = anchorBackward(sourceText, tag.offset);
      if (anchor) {
        pauses.push({ after: anchor, length: cls.length });
        pausesUsed += 1;
      }
    } else if (cls.kind === 'emphasis' && full && stressUsed < TAG_CAPS.stress) {
      const anchor = anchorForward(sourceText, tag.offset);
      if (anchor) {
        stress.push(anchor);
        stressUsed += 1;
      }
    }
    // Anything else — a word from neither vocabulary, three tags already spent at the opening — is a
    // tag this reading does not place, and it is simply not placed.
  }
  if (shifts.length) voice.shifts = shifts;
  // pausesAnchored/stressAnchored mark that these specific arrays are the shortest run that still finds
  // its word, not the word the model actually named — the one thing that tells the panel it may widen
  // them (see widenPauseStressSummary in index.js). A translation's mark or a correction sets pauses or
  // stress of its own without either flag, and mergeVoiceMaps (index.js) lays this voice's fields over
  // theirs one key at a time, so a field this line left untagged keeps whichever it had — anchored or
  // not, exactly as it already was.
  if (pauses.length) { voice.pauses = pauses; voice.pausesAnchored = true; }
  if (stress.length) { voice.stress = stress; voice.stressAnchored = true; }
  if (sounds.length) voice.sounds = sounds;
}

// The reply's own envelope ({"voices":[...]}), a bare array, or — while the reply is still streaming
// in — one closed object at a time, the same three shapes every reading's reply may come in.
function deepItemsOf(candidate) {
  if (Array.isArray(candidate)) return candidate;
  if (Array.isArray(candidate?.voices)) return candidate.voices;
  if (candidate && typeof candidate === 'object' && Object.hasOwn(candidate, 'id')) return [candidate];
  return [];
}

/**
 * The deep reply, read onto the utterances.
 *
 * `speaker`, `emotion` and `pace` are read exactly as the simple reading's own fields are: `emotion`
 * alone decides both the label's colour and, unless a tag in `line` overrules it, the voice Fish is
 * sent, so a reply that leaves `line` bare or unreadable still colours and voices the line as the
 * simple reading would have. `line` is held to the sentence it is supposed to be (`alignToSource`):
 * on a match every tag in it is placed by where it stood (`classifyAndApply`); on a mismatch only the
 * tags at the sentence's own opening are kept, the same little this line would have carried from the
 * simple reading, and the mismatch is reported in `mismatches` for the one diagnostic line the caller
 * logs about it — the sentence and the first character that did not agree.
 *
 * Nothing here calls `groundVoice`: every voice this reading returns still passes through it exactly
 * once, in buildSegments, the one place any reading's voice is held to the text.
 *
 * `quotePairs` is the reader's own configured set (falling back to the four default pairs), used to
 * take a reproduced quote mark off the edge of `line` the same way it was taken off `utterance.anchor`
 * in the first place. An item with no `line` but one of the old structured fields (`tone`, `pauses`,
 * `stress`, `sounds`, `shifts`, `intensity` and the rest) is a reply to a reader's own custom deep
 * prompt still written in the format this reading carried before v0.37 — its performance is read the
 * same way the simple reading already reads that shape (`normalizeVoice`) rather than silently dropped
 * because this reading now expects `line` instead.
 */
const LEGACY_VOICE_KEYS = Object.freeze([
  'tone', 'pauses', 'stress', 'sounds', 'shifts', 'shift', 'intensity', 'subtext', 'why', 'reason',
  'direction', 'instruction', 'speed', 'volume', 'breath', 'restraint', 'tension', 'rasp', 'hesitation',
]);

function levelOf(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(2, Math.max(0, Math.round(number))) : null;
}

export function parseDeepAnalysis(raw, utterances, { quotePairs = null } = {}) {
  const byId = new Map((Array.isArray(utterances) ? utterances : []).map(item => [item.id, item]));
  const labels = new Map();
  const voices = new Map();
  const mismatches = [];
  let candidates = 0;
  for (const candidate of parseJsonCandidates(raw)) {
    candidates += 1;
    for (const item of deepItemsOf(candidate)) {
      const id = Number(item?.id);
      const utterance = byId.get(id);
      if (!utterance || labels.has(id)) continue;
      if (String(item?.type ?? '').trim().toLowerCase() === 'narration') {
        labels.set(id, { type: 'narration' });
        continue;
      }
      const speaker = String(item?.speaker ?? '').trim().slice(0, 60);
      const paletteEmotion = normalizeEmotion(item?.emotion);
      const topEmotion = cueLike(item?.emotion);
      const rawLine = item?.line;
      const hasLine = typeof rawLine === 'string' && rawLine.trim();
      // pace is this reading's own field; a reply built for an old custom prompt (see LEGACY_VOICE_KEYS
      // below) may instead carry the simple reading's `speed`, read here as the same thing.
      const paceValue = VOICE_LEVELS.has(item?.pace) ? item.pace : VOICE_LEVELS.has(item?.speed) ? item.speed : null;
      const hasPace = paceValue !== null && paceValue !== 'normal';
      const hasLegacyVoice = !hasLine && LEGACY_VOICE_KEYS.some(key => item?.[key] !== undefined);
      // An id with nothing beside it — no speaker, no mood, no pace, no line — is not an answer: the
      // model did not address this sentence, and it is left exactly as unlabelled as one it never
      // named at all, rather than turned into a bare dialogue line by the mere fact of appearing.
      if (!(speaker && !isPlaceholderSpeaker(speaker)) && !paletteEmotion && !hasLine && !hasPace && !hasLegacyVoice) continue;
      const label = { type: 'dialogue' };
      if (speaker && !isPlaceholderSpeaker(speaker)) label.speaker = speaker;
      if (paletteEmotion) label.emotion = paletteEmotion;
      const lang = normalizeLanguageCode(item?.lang ?? item?.language);
      if (lang) label.lang = lang;
      labels.set(id, label);
      const voice = {};
      if (topEmotion && topEmotion !== 'neutral') voice.emotion = topEmotion;
      if (hasPace) voice.speed = paceValue;
      const intensity = levelOf(item?.intensity);
      if (intensity !== null) voice.intensity = intensity;
      if (hasLine) {
        const { text: untagged, tags: rawTags } = stripInlineTags(rawLine);
        const { text: unquoted, tags: edgeTags } = stripEdgeQuote(untagged, rawTags, quotePairs);
        const { text: leadTrimmed, cut } = trimEdgePunctuation(unquoted);
        const shiftedTags = cut ? edgeTags.map(tag => ({ ...tag, offset: Math.max(0, tag.offset - cut) })) : edgeTags;
        const source = String(utterance.text ?? '');
        const { map, at } = alignToSource(leadTrimmed, source);
        if (map) {
          classifyAndApply(voice, shiftedTags.map(tag => ({ word: tag.word, offset: map[tag.offset] })), source, { full: true });
        } else {
          classifyAndApply(voice, shiftedTags, source, { full: false });
          mismatches.push({ id, at, sentence: source });
        }
      } else if (hasLegacyVoice) {
        const legacy = normalizeVoice(item, String(utterance.text ?? ''));
        if (legacy) Object.assign(voice, legacy);
      }
      if (Object.keys(voice).length) voices.set(id, voice);
    }
  }
  return { labels, voices, candidates, mismatches };
}

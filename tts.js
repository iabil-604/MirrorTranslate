import {
  DEFAULT_QUOTE_PAIRS,
  hashText,
  isPlaceholderSpeaker,
  languageBase,
  normalizeLanguageCode,
  normalizeNewlines,
  parseJsonCandidates,
  parsePairList,
  unifySpeakerNames,
} from './core.js?v=0.19.1';
import { EMOTION_KEYS, EMOTION_STYLES, normalizeEmotion, normalizeIntensity } from './palette.js?v=0.19.1';

// ---------------------------------------------------------------------------------------------
// Reading the translation aloud.
//
// The same split the colouring uses holds here: the model is asked who says a line and in what mood,
// and nothing else. It never hands text back, so it cannot rewrite a line on its way to the voice —
// the text that is read is always the text on the floor. Where the lines are cut, which voice reads
// them, how a mood becomes a provider's markup and where each sentence sits in the audio are all
// computed on this side.
//
// Three layers, so another provider only ever replaces the last one:
//   floor text → utterances (local split) → segments (labels + standard structure) → provider adapter
//
// The reading of a line comes at two depths. The light one names a speaker and one mood per sentence.
// The deep one reads the floor with its context and describes the voice of every sentence — the
// intent, the subtext, the restraint, where it pauses and what it stresses — as a structure this side
// compiles into the provider's cues. Either way the model only ever returns labels keyed by id.
// ---------------------------------------------------------------------------------------------

export const TTS_DOCUMENT_VERSION = 2;
export const TTS_ANALYSIS_VERSION = 3;
export const NARRATOR = 'narrator';

const INVISIBLE_RE = /[\u200b-\u200f\u2060-\u2064\ufeff]/g;
const ENTITY_MAP = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' });

function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return Object.hasOwn(ENTITY_MAP, body.toLowerCase()) ? ENTITY_MAP[body.toLowerCase()] : whole;
  });
}

// Markup that reached a line is presentation, not speech.
export function plainLineText(text) {
  return decodeEntities(String(text ?? '').replace(INVISIBLE_RE, '').replace(/<[^<>]*>/g, ''))
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Lines inside literal source tags, for floors this extension never translated.
 *
 * A floor written by the translator is read through its own boundaries instead, which work whatever the
 * visible affixes are; this is the fallback for a preset that types `<jy-translation>` itself.
 */
export function linesFromTaggedText(text, tags = []) {
  const source = normalizeNewlines(text);
  const blocks = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    if (!/^[A-Za-z][A-Za-z0-9_:-]*$/.test(String(tag))) continue;
    const name = escapeRegex(tag);
    const pattern = new RegExp(`<${name}(?:\\s[^<>]*)?>([\\s\\S]*?)<\\/${name}\\s*>`, 'gi');
    for (const match of source.matchAll(pattern)) blocks.push({ index: match.index, inner: match[1] });
  }
  blocks.sort((left, right) => left.index - right.index);
  const lines = [];
  for (const block of blocks) {
    for (const raw of block.inner.split('\n')) {
      const text = plainLineText(raw);
      if (/[\p{L}\p{N}]/u.test(text)) lines.push({ lineId: lines.length + 1, text });
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------
// Layer 1: utterances. A line is cut at its quotation marks, and narration again at its full stops,
// so every sentence someone might want to hear twice has a boundary of its own. Runs inside the skip
// pairs — *actions* between asterisks, stage directions in parentheses — are not utterances at all.
// ---------------------------------------------------------------------------------------------

const SENTENCE_STOP_RE = /[。！？!?]/u;
const SENTENCE_TAIL_RE = /[。！？!?…～~」』”’"'）)\]】》]/u;
const EDGE_PUNCTUATION_RE = /^[\s，,、；;：:。．.！!？?）)\]】》」』”’]+/u;
const SPEAKABLE_RE = /[\p{L}\p{N}]/u;

export function splitNarrationSentences(text) {
  const characters = [...String(text ?? '')];
  const pieces = [];
  let buffer = '';
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    buffer += character;
    const englishStop = character === '.' && (index + 1 === characters.length || /\s/.test(characters[index + 1]));
    if (!SENTENCE_STOP_RE.test(character) && !englishStop) continue;
    // The marks and closers that finish a sentence belong to it, not to the start of the next one.
    while (index + 1 < characters.length && SENTENCE_TAIL_RE.test(characters[index + 1])) {
      index += 1;
      buffer += characters[index];
    }
    pieces.push(buffer);
    buffer = '';
  }
  if (buffer) pieces.push(buffer);
  return pieces;
}

function pairsOf(value, fallback) {
  const pairs = parsePairList(value === undefined ? fallback : value);
  return pairs;
}

/**
 * Cuts one line into runs by the quote pairs (speech) and the skip pairs (never read).
 *
 * Openers are matched at the earliest position; a same-character pair (`"…"`, `*…*`) closes at the
 * next occurrence. Nesting of the same pair counts depth so 「他说「好」了」 stays one run. An unterminated
 * opener is reported as narration rather than guessed at, the same rule the colouring keeps.
 */
export function splitByPairs(value, { quotePairs = DEFAULT_QUOTE_PAIRS, skipPairs = [] } = {}) {
  const source = String(value ?? '');
  const quotes = pairsOf(quotePairs, DEFAULT_QUOTE_PAIRS).map(pair => ({ ...pair, kind: 'quoted' }));
  const skips = pairsOf(skipPairs, []).map(pair => ({ ...pair, kind: 'skipped' }));
  // Longer openers first, so `**` is tried before `*` when both are configured.
  const openers = [...skips, ...quotes].sort((left, right) => right.open.length - left.open.length);
  const parts = [];
  let index = 0;
  let buffer = '';
  const flush = (kind, text) => {
    if (text) parts.push({ text, kind, spoken: kind === 'quoted' });
  };
  while (index < source.length) {
    const pair = openers.find(item => source.startsWith(item.open, index));
    if (!pair) {
      buffer += source[index];
      index += 1;
      continue;
    }
    // Find the closer, honouring nesting when opener and closer differ.
    let depth = 1;
    let cursor = index + pair.open.length;
    let closeAt = -1;
    while (cursor < source.length) {
      if (pair.open !== pair.close && source.startsWith(pair.open, cursor)) {
        depth += 1;
        cursor += pair.open.length;
        continue;
      }
      if (source.startsWith(pair.close, cursor)) {
        depth -= 1;
        if (!depth) {
          closeAt = cursor;
          break;
        }
        cursor += pair.close.length;
        continue;
      }
      cursor += 1;
    }
    if (closeAt < 0) {
      buffer += source[index];
      index += 1;
      continue;
    }
    flush('narration', buffer);
    buffer = '';
    const end = closeAt + pair.close.length;
    flush(pair.kind, source.slice(index, end));
    index = end;
  }
  flush('narration', buffer);
  return parts;
}

function unquote(run, pairs) {
  for (const pair of pairs) {
    if (run.startsWith(pair.open) && run.endsWith(pair.close) && run.length >= pair.open.length + pair.close.length) {
      return run.slice(pair.open.length, run.length - pair.close.length);
    }
  }
  return run;
}

/**
 * Cuts translated lines into utterances.
 *
 * `anchor` is the run exactly as it stands in the line, quotation marks and leftover commas included,
 * so it can be found again on the rendered floor. `text` is what gets read: the quotes come off a
 * spoken run and a narration run loses the comma it inherited from the quote before it. Nothing else
 * about the words changes. Skipped runs leave no utterance and no button.
 */
export function splitUtterances(lines, { quotePairs = DEFAULT_QUOTE_PAIRS, skipPairs = [] } = {}) {
  const quotes = pairsOf(quotePairs, DEFAULT_QUOTE_PAIRS);
  const utterances = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const lineText = String(line?.text ?? '');
    for (const part of splitByPairs(lineText, { quotePairs: quotes, skipPairs })) {
      if (part.kind === 'skipped') continue;
      const runs = part.spoken ? [part.text] : splitNarrationSentences(part.text);
      for (const run of runs) {
        const text = (part.spoken ? unquote(run, quotes) : run).replace(EDGE_PUNCTUATION_RE, '').trim();
        if (!SPEAKABLE_RE.test(text)) continue;
        utterances.push({
          id: utterances.length + 1,
          lineId: line.lineId,
          kind: part.spoken ? 'quoted' : 'narration',
          anchor: run,
          text,
        });
      }
    }
  }
  return utterances;
}

// Which language a sentence is written in, by script alone. Latin script says 'en' because the
// scripts of English, German and French are one and the same; the analysis names those apart.
export function detectLanguage(text) {
  const counts = { zh: 0, ja: 0, ko: 0, en: 0, ru: 0, ar: 0, th: 0 };
  for (const character of String(text ?? '')) {
    if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character)) counts.ja += 1;
    else if (/\p{Script=Han}/u.test(character)) counts.zh += 1;
    else if (/\p{Script=Hangul}/u.test(character)) counts.ko += 1;
    else if (/\p{Script=Cyrillic}/u.test(character)) counts.ru += 1;
    else if (/\p{Script=Arabic}/u.test(character)) counts.ar += 1;
    else if (/\p{Script=Thai}/u.test(character)) counts.th += 1;
    else if (/\p{Script=Latin}/u.test(character)) counts.en += 1;
  }
  // Kana anywhere makes the Han around it Japanese.
  if (counts.ja) return 'ja';
  const [best, count] = Object.entries(counts).sort((left, right) => right[1] - left[1])[0];
  return count ? best : '';
}

// Paragraphs, for the stream mode: one recording per line of the floor.
export function groupSegmentsByLine(segments) {
  const groups = new Map();
  for (const segment of Array.isArray(segments) ? segments : []) {
    if (!groups.has(segment.lineId)) groups.set(segment.lineId, []);
    groups.get(segment.lineId).push(segment);
  }
  return [...groups].map(([lineId, items]) => ({ lineId, segments: items }));
}

// ---------------------------------------------------------------------------------------------
// Layer 2: labels and the standard structure.
// ---------------------------------------------------------------------------------------------

const DIALOGUE_TYPES = new Set(['dialogue', 'speech', 'spoken', 'line', 'quote', 'quoted', '对白', '对话', '台词']);
const NARRATION_TYPES = new Set(['narration', 'narrator', 'narrative', 'description', 'thought', 'inner', 'monologue', '旁白', '叙述', '描写', '心理']);

function normalizeUtteranceType(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (DIALOGUE_TYPES.has(raw)) return 'dialogue';
  if (NARRATION_TYPES.has(raw)) return 'narration';
  return '';
}

function readTtsLabel(item) {
  if (!item || typeof item !== 'object') return null;
  const label = {};
  const type = normalizeUtteranceType(item.type ?? item.kind ?? item.role);
  if (type) label.type = type;
  const speaker = String(item.speaker ?? item.who ?? item.name ?? item.character ?? '').trim().slice(0, 60);
  if (speaker && !isPlaceholderSpeaker(speaker)) label.speaker = speaker;
  const emotion = normalizeEmotion(item.emotion ?? item.mood ?? item.tone);
  if (emotion) label.emotion = emotion;
  const intensity = Number(item.intensity ?? item.level);
  if (Number.isFinite(intensity)) label.intensity = Math.min(2, Math.max(0, Math.round(intensity)));
  const lang = normalizeLanguageCode(item.lang ?? item.language);
  if (lang) label.lang = lang;
  return Object.keys(label).length ? label : null;
}

/**
 * Labels taken from the translation's own per-line annotations: no request, but one speaker per line.
 * A narrated line wears no speaker even when the model gave it one, the same rule the colouring keeps.
 */
export function labelsFromAnnotations(utterances, annotations) {
  const labels = new Map();
  if (!(annotations instanceof Map)) return labels;
  for (const utterance of utterances) {
    if (utterance.kind !== 'quoted') continue;
    const mark = annotations.get(utterance.lineId);
    if (!mark) continue;
    const label = readTtsLabel({ type: 'dialogue', speaker: mark.speaker, emotion: mark.emotion, intensity: mark.intensity });
    if (label) labels.set(utterance.id, label);
  }
  return labels;
}

const EMOTION_GLOSS = EMOTION_KEYS.map(key => `${key}=${EMOTION_STYLES[key].label}`).join('、');

function rosterList(roster) {
  return [...new Set((Array.isArray(roster) ? roster : []).map(name => String(name ?? '').trim()).filter(Boolean))].slice(0, 60);
}

function referenceLines(translations) {
  return translations instanceof Map
    ? [...translations].filter(([, text]) => String(text ?? '').trim()).map(([line, text]) => ({ line, text: String(text) }))
    : [];
}

// The two system prompts, as templates the reader may replace in the settings. Placeholders:
// {{user}} the user's role, {{palette}} the light emotion labels, {{sounds}} the Fish sound tags,
// {{references_rule}} the rule about translations riding along when the original is read.
export const DEFAULT_TTS_PROMPTS = Object.freeze({
  light: [
    '你是有声小说的配音导演助手。下面是一楼正文按顺序切好的句子。你只判断每一句由谁念、用什么情绪念，不改写、不复述、不翻译任何句子。',
    '输入的 utterances 每项有 id、kind（quoted 表示原文在引号里，narration 表示不在引号里）和 text。',
    '只输出一个 JSON 对象，不要任何解释：{"labels":[{"id":1,"type":"narration"},{"id":2,"type":"dialogue","speaker":"名字","emotion":"标签","intensity":1}]}',
    '1. type 只能是 dialogue（角色说出口的话）或 narration（旁白、叙述、动作、心理描写）。引号里通常是 dialogue；引号用来标书名、专有名词、强调或引用文字时是 narration。不在引号里、却是角色直接说出的话（例如「樱井：好热」这种写法）是 dialogue。确实是旁白的 narration 句可以不写。',
    '2. speaker 只给 dialogue。优先从 roster 里逐字照抄名字，不加敬称；roster 里没有的人，写正文里对这个人的称呼。{{user}}看不出是谁说的就省略 speaker，不要猜。',
    '3. emotion 只给 dialogue，只能取下列英文标签之一并逐字照抄：{{palette}}。依据是这句话本身和紧挨着它的叙述（例如「吼道」「小声说」），不是你对剧情的推测。看不出明显情绪写 neutral。',
    '4. intensity 0 弱、1 中、2 强，默认 1。只有原文明确写了加强或减弱（感叹号连用、吼、尖叫、低声、颤抖）才写 2 或 0。',
    '5. lang 是这一句的语言代码（zh、en、ja、ko、de、fr、es、ru……）。英语按人物设定区分 en-US（美式）和 en-GB（英式、伦敦腔），分不出就写 en。只在这一句的语言和整楼主要语言不同、或人物设定明确了口音时写，其余省略。',
    '6. 每个 id 最多出现一次。不要输出 text，不要输出 id 以外的句子内容。输入里如果有 lead，那是这一批前面紧挨着的几句，只用来认人和判断语气，不用回答。',
    '{{references_rule}}',
  ].join('\n'),
  deep: [
    '你是有声小说的配音导演。下面是一楼正文按顺序切好的句子，以及这一楼的背景资料。你为每一句写配音指令：由谁念、用什么声音念。不改写、不复述、不翻译任何句子。',
    '输入的 utterances 每项有 id、kind（quoted 表示原文在引号里，narration 表示不在引号里）和 text；references 里是角色卡、世界书和前几楼的正文，只用来理解人物和剧情；hints 是翻译时已经标好的每句说话人和情绪底色。',
    '只输出一个 JSON 对象：{"voices":[{"id":1},{"id":2,"type":"dialogue","speaker":"名字","emotion":"frustrated","intensity":2,"speed":"fast","stress":["热"]}]}',
    '省力原则：一句话的情绪和 hints 里的底色一样、和上一句没有转折、也不需要停顿重音的，只写 {"id":N}，底色会自动沿用。只有情绪有转折、有压抑或爆发、需要停顿重音、有非语言声音的句子才展开写。旁白通常只写 id。',
    '展开写时可用的字段（都可省略，省略就是平常）：',
    '- type：dialogue（角色说出口的话）或 narration（旁白、叙述、动作、心理描写）。引号用来标书名、专有名词、强调时是 narration；「樱井：好热」这种没有引号的台词是 dialogue。',
    '- speaker：只给 dialogue，优先从 roster 里逐字照抄，不加敬称；roster 里没有的人写正文里对这个人的称呼。{{user}}看不出是谁说的就省略。',
    '- lang：这句的语言代码（zh、en、ja、ko、de、fr、es、ru……）。英语按人物设定区分 en-US（美式）和 en-GB（英式、伦敦腔），分不出就写 en。与整楼主要语言相同、人物设定又没说口音时省略。',
    '- emotion：基础情绪，英文，优先取 emotions 列表里的词；都不合适时用 1–3 个英文词描述。secondary：次级情绪。intensity：0 弱、1 中、2 强。',
    '- restraint：自我克制 0 放开、1 一般、2 压着（压着会转成气声、耳语）。tension：紧张 0–2。hesitation：犹豫 0–2。rasp：嘶哑 0–2。',
    '- speed：slow / normal / fast。volume：quiet / normal / loud。breath：none / audible / panting。',
    '- pauses：[{"after":"句中的词","length":"short|long"}]。stress：重音词 ["词"]。shifts：句内情绪变化 [{"at":"从这个词起","emotion":"英文"}]。这三项里的词必须逐字出现在这句里。',
    '- sounds：非语言声音 [{"at":"start|end","tag":"标签"}]，tag 取 {{sounds}}。只在这个人此刻真的会发出这个声音时写。',
    '- subtext：言不由衷时写真正想说的（中文 ≤20 字），其余省略。',
    '判断依据：这句话本身、紧挨着的叙述（吼道、小声说）、这个人的性格和说话习惯、前文的情绪惯性（上一句还在哭，这一句不会立刻平静）、场景与人物关系。同一句最多三种情绪相关的词。',
    '输入里如果有 lead，那是这一批前面紧挨着的几句，只用来判断情绪惯性，不要给它们写指令。',
    '每个 id 最多出现一次。不要输出 text，不要输出 id 以外的句子内容。',
    '{{references_rule}}',
  ].join('\n'),
});

const REFERENCES_RULE = '输入里的 translations 是这些原文行（按 line 对应）的译文，只用来帮你认人、理解语气。speaker 按 roster 或译文里的写法写，不要写原文里的名字。';

function fillPrompt(template, { userName = '', references = false } = {}) {
  return String(template ?? '')
    .replaceAll('{{user}}', userName ? `用户扮演的角色叫 ${userName}。` : '')
    .replaceAll('{{palette}}', EMOTION_GLOSS)
    .replaceAll('{{sounds}}', FISH_SOUNDS.join(' / '))
    .replaceAll('{{references_rule}}', references ? REFERENCES_RULE : '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * The light request: who reads each utterance, in what mood.
 *
 * The utterances travel with their ids and the model answers with labels keyed by those ids. There is no
 * text field in the answer at all, which is what keeps 「烦死了！」 from coming back as something
 * politer: whatever the model thinks of the wording, it has nowhere to write it.
 */
// The sentences just before a batch, sent along as context only.
function leadList(lead) {
  return (Array.isArray(lead) ? lead : []).map(item => ({ id: item.id, text: item.anchor ?? item.text })).filter(item => item.text);
}

export function buildTtsAnalysisMessages(utterances, { roster = [], characterName = '', userName = '', translations = null, systemPrompt = '', lead = null } = {}) {
  // Reading the original: the roster holds the names as the translation spells them (樱井), the text
  // says 桜井. Each line's translation rides along so the model can name people the way the voices are
  // registered, and the rule below says so.
  const references = referenceLines(translations);
  const system = fillPrompt(String(systemPrompt ?? '').trim() || DEFAULT_TTS_PROMPTS.light, { userName, references: references.length > 0 });
  const leads = leadList(lead);
  const input = {
    task: 'label_utterances_for_audiobook',
    ...(characterName ? { character: characterName } : {}),
    ...(userName ? { user: userName } : {}),
    roster: rosterList(roster),
    emotions: EMOTION_KEYS,
    ...(leads.length ? { lead: leads } : {}),
    utterances: (Array.isArray(utterances) ? utterances : []).map(item => (references.length
      ? { id: item.id, line: item.lineId, kind: item.kind, text: item.anchor }
      : { id: item.id, kind: item.kind, text: item.anchor })),
    ...(references.length ? { translations: references } : {}),
  };
  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(input) },
  ];
}

function labelItemsOf(candidate, listKeys) {
  if (Array.isArray(candidate)) return candidate;
  for (const key of listKeys) if (Array.isArray(candidate?.[key])) return candidate[key];
  // A reply cut off mid-array still yields its closed objects one by one.
  if (candidate && typeof candidate === 'object' && Object.hasOwn(candidate, 'id')) return [candidate];
  return [];
}

export function parseTtsAnalysis(raw, utterances) {
  const ids = new Set((Array.isArray(utterances) ? utterances : []).map(item => item.id));
  const labels = new Map();
  let candidates = 0;
  for (const candidate of parseJsonCandidates(raw)) {
    candidates += 1;
    for (const item of labelItemsOf(candidate, ['labels', 'utterances', 'items', 'voices'])) {
      const id = Number(item?.id ?? item?.utterance);
      if (!ids.has(id) || labels.has(id)) continue;
      const label = readTtsLabel(item);
      if (label) labels.set(id, label);
    }
  }
  return { labels, candidates };
}

// ---------------------------------------------------------------------------------------------
// The deep reading. The model describes each sentence's voice as a structure; every field is optional
// and absent means ordinary. Nothing in it is text to be read.
// ---------------------------------------------------------------------------------------------

// Fish's own emotion vocabulary, offered to the model first; anything else it says is used as free-form
// natural language, which the S2 models also accept.
export const FISH_EMOTIONS = Object.freeze([
  'happy', 'sad', 'angry', 'excited', 'calm', 'nervous', 'confident', 'surprised', 'satisfied', 'delighted', 'scared',
  'worried', 'upset', 'frustrated', 'depressed', 'empathetic', 'embarrassed', 'disgusted', 'moved', 'proud', 'relaxed',
  'grateful', 'curious', 'sarcastic', 'disdainful', 'unhappy', 'anxious', 'hysterical', 'indifferent', 'uncertain',
  'doubtful', 'confused', 'disappointed', 'regretful', 'guilty', 'ashamed', 'jealous', 'envious', 'hopeful', 'optimistic',
  'pessimistic', 'nostalgic', 'lonely', 'bored', 'contemptuous', 'sympathetic', 'compassionate', 'determined', 'resigned',
  'tender', 'gentle', 'shy', 'serious', 'playful', 'cold', 'pleading', 'mysterious', 'tired', 'flirtatious',
]);
export const FISH_SOUNDS = Object.freeze(['sighing', 'gasping', 'sobbing', 'laughing', 'chuckling', 'groaning', 'panting', 'crying loudly', 'clear throat', 'yawning']);

// Chinese for the cues, for the summary a reader sees beside a sentence. Unknown cues show as written.
export const FISH_TAG_LABELS = Object.freeze({
  happy: '开心', sad: '悲伤', angry: '愤怒', excited: '兴奋', calm: '平静', nervous: '紧张', confident: '自信', surprised: '惊讶',
  satisfied: '满意', delighted: '欣喜', scared: '害怕', worried: '担忧', upset: '难过', frustrated: '沮丧', depressed: '消沉',
  empathetic: '共情', embarrassed: '难为情', disgusted: '厌恶', moved: '感动', proud: '骄傲', relaxed: '放松', grateful: '感激',
  curious: '好奇', sarcastic: '讽刺', disdainful: '轻蔑', unhappy: '不悦', anxious: '焦虑', hysterical: '歇斯底里', indifferent: '冷淡',
  uncertain: '不确定', doubtful: '怀疑', confused: '困惑', disappointed: '失望', regretful: '懊悔', guilty: '愧疚', ashamed: '羞愧',
  jealous: '嫉妒', envious: '羡慕', hopeful: '期盼', optimistic: '乐观', pessimistic: '悲观', nostalgic: '怀念', lonely: '孤独',
  bored: '无聊', contemptuous: '鄙夷', sympathetic: '同情', compassionate: '怜惜', determined: '坚定', resigned: '认命',
  tender: '温柔', gentle: '轻柔', shy: '害羞', serious: '严肃', playful: '俏皮', cold: '冷漠', pleading: '恳求', mysterious: '神秘',
  tired: '疲惫', flirtatious: '撩拨', furious: '暴怒', terrified: '惊恐', ecstatic: '狂喜', interested: '有兴趣',
  whispering: '耳语', 'soft tone': '轻声', shouting: '喊', screaming: '尖叫', 'in a hurry tone': '急促', emphasis: '强调',
  'holding back': '压着', hesitant: '犹豫', hoarse: '沙哑', breathy: '带气声', trembling: '发抖',
  sighing: '叹气', gasping: '倒吸气', sobbing: '抽泣', laughing: '大笑', chuckling: '轻笑', groaning: '呻吟', panting: '喘气',
  'crying loudly': '大哭', 'clear throat': '清嗓子', yawning: '打哈欠', break: '停顿', 'long-break': '长停顿',
});

const VOICE_LEVELS = new Set(['slow', 'normal', 'fast']);
const VOLUMES = new Set(['quiet', 'normal', 'loud']);
const BREATHS = new Set(['none', 'audible', 'panting']);

function shortText(value, limit) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function cueWord(value) {
  const word = String(value ?? '').trim().toLowerCase().replace(/[[\]()]/g, '').replace(/\s+/g, ' ');
  return /^[a-z][a-z '-]{0,40}$/.test(word) ? word : '';
}

function level(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(2, Math.max(0, Math.round(number))) : null;
}

/**
 * One sentence's voice, checked field by field. Words the model points at (pauses, stress, shifts) are
 * kept only when they occur in the sentence, since a tag that cannot be placed has nowhere to go.
 */
export function normalizeVoice(item, text = '') {
  if (!item || typeof item !== 'object') return null;
  const voice = {};
  const sentence = String(text ?? '');
  const emotion = cueWord(item.emotion ?? item.mood);
  if (emotion && emotion !== 'neutral') voice.emotion = emotion;
  const secondary = cueWord(item.secondary);
  if (secondary && secondary !== voice.emotion && secondary !== 'neutral') voice.secondary = secondary;
  const intensity = level(item.intensity);
  if (intensity !== null) voice.intensity = intensity;
  const subtext = shortText(item.subtext, 40);
  if (subtext) voice.subtext = subtext;
  // Only what the compiler turns into a cue or a prosody step is kept; the rest was thinking aloud.
  for (const key of ['restraint', 'tension', 'rasp', 'hesitation']) {
    const value = level(item[key]);
    if (value !== null) voice[key] = value;
  }
  if (VOICE_LEVELS.has(item.speed) && item.speed !== 'normal') voice.speed = item.speed;
  if (VOLUMES.has(item.volume) && item.volume !== 'normal') voice.volume = item.volume;
  if (BREATHS.has(item.breath) && item.breath !== 'none') voice.breath = item.breath;
  const inSentence = word => word && sentence.includes(word);
  const pauses = (Array.isArray(item.pauses) ? item.pauses : [])
    .map(pause => ({ after: shortText(pause?.after ?? pause?.word, 20), length: pause?.length === 'long' ? 'long' : 'short' }))
    .filter(pause => inSentence(pause.after))
    .slice(0, 4);
  if (pauses.length) voice.pauses = pauses;
  const stress = [...new Set((Array.isArray(item.stress) ? item.stress : [item.stress]).map(word => shortText(word, 20)).filter(inSentence))].slice(0, 3);
  if (stress.length) voice.stress = stress;
  const shifts = (Array.isArray(item.shifts) ? item.shifts : [])
    .map(shift => ({ at: shortText(shift?.at ?? shift?.word, 20), emotion: cueWord(shift?.emotion) }))
    .filter(shift => shift.emotion && inSentence(shift.at))
    .slice(0, 2);
  if (shifts.length) voice.shifts = shifts;
  const sounds = (Array.isArray(item.sounds) ? item.sounds : [])
    .map(sound => ({ at: sound?.at === 'end' ? 'end' : 'start', tag: cueWord(sound?.tag ?? sound?.sound) }))
    .filter(sound => sound.tag)
    .slice(0, 2);
  if (sounds.length) voice.sounds = sounds;
  return Object.keys(voice).length ? voice : null;
}

// The translation's own per-line labels, as the base the deep reading may leave alone.
function hintsFor(utterances, hints) {
  if (!(hints instanceof Map)) return [];
  return (Array.isArray(utterances) ? utterances : [])
    .filter(item => hints.has(item.id))
    .map(item => {
      const hint = hints.get(item.id);
      return { id: item.id, ...(hint.speaker ? { speaker: hint.speaker } : {}), ...(hint.emotion ? { emotion: hint.emotion } : {}), ...(hint.intensity !== undefined ? { intensity: hint.intensity } : {}) };
    });
}

/**
 * The deep request. The floor's sentences go with the cast, the card, the worldbook and the last few
 * floors, and the answer describes the voice of every sentence that needs one. The translation's own
 * labels ride along as hints: a sentence whose mood is the hint's and turns nowhere is answered with
 * its id alone, and the hint stands. Speaker, type and language come back the same way the light
 * request returns them; the rest is the voice.
 */
export function buildVoiceAnalysisMessages(utterances, { roster = [], characterName = '', userName = '', translations = null, packet = {}, hints = null, systemPrompt = '', lead = null } = {}) {
  const references = referenceLines(translations);
  const system = fillPrompt(String(systemPrompt ?? '').trim() || DEFAULT_TTS_PROMPTS.deep, { userName, references: references.length > 0 });
  const referencesBlock = {};
  for (const key of ['character', 'worldbook', 'recent']) {
    const value = String(packet?.[key] ?? '').trim();
    if (value) referencesBlock[key] = value;
  }
  const hintList = hintsFor(utterances, hints);
  const leads = leadList(lead);
  const input = {
    task: 'direct_voices_for_audiobook',
    ...(characterName ? { character: characterName } : {}),
    ...(userName ? { user: userName } : {}),
    roster: rosterList(roster),
    emotions: FISH_EMOTIONS,
    ...(Object.keys(referencesBlock).length ? { references: referencesBlock } : {}),
    ...(hintList.length ? { hints: hintList } : {}),
    ...(leads.length ? { lead: leads } : {}),
    utterances: (Array.isArray(utterances) ? utterances : []).map(item => (references.length
      ? { id: item.id, line: item.lineId, kind: item.kind, text: item.anchor }
      : { id: item.id, kind: item.kind, text: item.anchor })),
    ...(references.length ? { translations: references } : {}),
  };
  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(input) },
  ];
}

/**
 * Labels plus voices from the deep reply. Type, speaker, language and the palette mood (for the
 * colouring's vocabulary) land in the labels; the whole voice lands beside them. A sentence the model
 * answered with its id alone, or not at all, keeps the hint it was given.
 */
export function parseVoiceAnalysis(raw, utterances, { hints = null } = {}) {
  const byId = new Map((Array.isArray(utterances) ? utterances : []).map(item => [item.id, item]));
  const labels = new Map();
  const voices = new Map();
  let candidates = 0;
  let reused = 0;
  for (const candidate of parseJsonCandidates(raw)) {
    candidates += 1;
    for (const item of labelItemsOf(candidate, ['voices', 'labels', 'utterances', 'items'])) {
      const id = Number(item?.id ?? item?.utterance);
      const utterance = byId.get(id);
      if (!utterance || labels.has(id)) continue;
      const label = readTtsLabel({ ...item, emotion: normalizeEmotion(item?.emotion) ? item.emotion : undefined }) ?? {};
      const voice = normalizeVoice(item, utterance.text);
      if (!Object.keys(label).length && !voice) {
        // An id alone: the hint stands, and counts as an answer.
        if (hints instanceof Map && hints.has(id)) {
          labels.set(id, { ...hints.get(id) });
          reused += 1;
        }
        continue;
      }
      // A partial answer keeps the hint's speaker and mood where the model said nothing about them.
      const hint = hints instanceof Map ? hints.get(id) : null;
      labels.set(id, hint ? { ...hint, ...label } : label);
      if (voice) voices.set(id, voice);
    }
  }
  if (candidates && hints instanceof Map) {
    for (const [id, hint] of hints) {
      if (!labels.has(id) && byId.has(id)) {
        labels.set(id, { ...hint });
        reused += 1;
      }
    }
  }
  return { labels, voices, candidates, reused, scene: '', characters: [] };
}

/**
 * The other language of the same floor, labelled from the one that was read.
 *
 * Both texts cut into the same lines and the same run of quotes per line, so the k-th quoted utterance
 * of a line in one language is the k-th in the other. Speaker and mood carry over; the language does
 * not, nor do pauses, stresses and shifts, which name words of the other text.
 */
export function deriveLabelsForSide(primaryUtterances, primaryLabels, primaryVoices, otherUtterances) {
  const byLine = new Map();
  for (const utterance of Array.isArray(primaryUtterances) ? primaryUtterances : []) {
    if (!byLine.has(utterance.lineId)) byLine.set(utterance.lineId, { quoted: [], narration: [] });
    byLine.get(utterance.lineId)[utterance.kind === 'quoted' ? 'quoted' : 'narration'].push(utterance.id);
  }
  const labels = new Map();
  const voices = new Map();
  const counters = new Map();
  for (const utterance of Array.isArray(otherUtterances) ? otherUtterances : []) {
    const kind = utterance.kind === 'quoted' ? 'quoted' : 'narration';
    const list = byLine.get(utterance.lineId)?.[kind] ?? [];
    const counterKey = `${utterance.lineId}|${kind}`;
    const index = counters.get(counterKey) ?? 0;
    counters.set(counterKey, index + 1);
    const source = list[index] ?? list.at(-1);
    if (source === undefined) continue;
    const label = primaryLabels instanceof Map ? primaryLabels.get(source) : null;
    if (label) {
      const { lang, ...rest } = label;
      if (Object.keys(rest).length) labels.set(utterance.id, rest);
    }
    const voice = primaryVoices instanceof Map ? primaryVoices.get(source) : null;
    if (voice) {
      const { pauses, stress, shifts, ...rest } = voice;
      if (Object.keys(rest).length) voices.set(utterance.id, rest);
    }
  }
  return { labels, voices };
}

const LEVEL_WORDS = ['弱', '中', '强'];
const THREE_WORDS = { restraint: ['放开', '一般', '压着'], tension: ['松', '中', '紧'], rasp: ['无', '略', '重'], hesitation: ['无', '略', '重'] };
const WORD_TABLE = {
  speed: { slow: '慢', fast: '快' },
  volume: { quiet: '小', loud: '大' },
  breath: { audible: '带气声', panting: '喘' },
};

export function cueLabel(cue) {
  const word = String(cue ?? '').trim().toLowerCase();
  if (FISH_TAG_LABELS[word]) return FISH_TAG_LABELS[word];
  const palette = normalizeEmotion(word);
  if (palette) return EMOTION_STYLES[palette].label;
  const stripped = word.replace(/^(?:slightly|very|extremely)\s+/, '');
  if (FISH_TAG_LABELS[stripped]) {
    const prefix = word.startsWith('slightly') ? '略' : word.startsWith('very') ? '很' : word.startsWith('extremely') ? '极' : '';
    return `${prefix}${FISH_TAG_LABELS[stripped]}`;
  }
  return word;
}

/** The voice as short Chinese lines, for the panel beside a sentence. */
export function voiceSummary(voice) {
  if (!voice || typeof voice !== 'object') return [];
  const lines = [];
  if (voice.emotion) lines.push(['情绪', `${cueLabel(voice.emotion)}${voice.intensity !== undefined && voice.intensity !== null ? `（${LEVEL_WORDS[voice.intensity]}）` : ''}${voice.secondary ? ` · ${cueLabel(voice.secondary)}` : ''}`]);
  if (voice.subtext) lines.push(['潜台词', voice.subtext]);
  for (const key of ['restraint', 'tension']) {
    if (voice[key] !== undefined && voice[key] !== 1) lines.push([{ restraint: '克制', tension: '紧张' }[key], THREE_WORDS[key][voice[key]]]);
  }
  const delivery = ['speed', 'volume'].filter(key => voice[key]).map(key => `${{ speed: '语速', volume: '音量' }[key]}${WORD_TABLE[key][voice[key]]}`);
  if (delivery.length) lines.push(['声音', delivery.join(' · ')]);
  const texture = [];
  if (voice.breath) texture.push(WORD_TABLE.breath[voice.breath]);
  if (voice.rasp) texture.push(`沙哑${THREE_WORDS.rasp[voice.rasp]}`);
  if (voice.hesitation) texture.push(`犹豫${THREE_WORDS.hesitation[voice.hesitation]}`);
  if (texture.length) lines.push(['质感', texture.join(' · ')]);
  if (voice.pauses?.length) lines.push(['停顿', voice.pauses.map(pause => `「${pause.after}」后${pause.length === 'long' ? '长停' : '短停'}`).join('，')]);
  if (voice.stress?.length) lines.push(['重音', voice.stress.join('、')]);
  if (voice.shifts?.length) lines.push(['句内变化', voice.shifts.map(shift => `「${shift.at}」起转${cueLabel(shift.emotion)}`).join('，')]);
  if (voice.sounds?.length) lines.push(['非语言声', voice.sounds.map(sound => `${sound.at === 'end' ? '句尾' : '开头'}${cueLabel(sound.tag)}`).join('，')]);
  return lines;
}

/**
 * Utterances plus labels, in the provider-neutral shape.
 *
 * Speaker spellings are unified against the names this cast is known by first, so 希尔达夫人 and 希尔达
 * reach the same voice. A label that is missing or invalid costs the utterance its speaker or mood and
 * nothing else; the type falls back to what the quotation marks said. The language is what the label
 * says, else what the script says.
 */
export function buildSegments(utterances, labels = new Map(), { knownNames = [], voices = null } = {}) {
  const reported = [...labels.values()].map(label => label?.speaker).filter(Boolean);
  const names = unifySpeakerNames(reported, knownNames);
  return (Array.isArray(utterances) ? utterances : []).map(utterance => {
    const label = labels.get(utterance.id) ?? {};
    const type = label.type || (utterance.kind === 'quoted' ? 'dialogue' : 'narration');
    const lang = label.lang || detectLanguage(utterance.text);
    const rawVoice = voices instanceof Map ? (voices.get(utterance.id) ?? null) : null;
    // A voice that says how but not what mood — the model added restraint to a hinted line — keeps the
    // label's mood under it.
    const voice = rawVoice && !rawVoice.emotion && label.emotion && label.emotion !== 'neutral'
      ? { emotion: label.emotion, intensity: label.intensity ?? 1, ...rawVoice }
      : rawVoice;
    const base = { id: utterance.id, lineId: utterance.lineId, type, text: utterance.text, anchor: utterance.anchor, lang, voice };
    if (type === 'narration') {
      // Narration keeps a mood only when the deep reading gave it one; the light labels never do.
      const mood = voice?.emotion ? voice.emotion : null;
      return { ...base, speaker: NARRATOR, emotion: mood, intensity: mood ? normalizeIntensity(voice.intensity ?? 1) : null };
    }
    const speaker = label.speaker ? (names.get(label.speaker) ?? label.speaker) : null;
    const emotion = voice?.emotion ? voice.emotion : (label.emotion && label.emotion !== 'neutral' ? label.emotion : null);
    return { ...base, speaker, emotion, intensity: emotion ? normalizeIntensity(voice?.intensity ?? label.intensity) : null };
  });
}

export function segmentsInRange(segments, range = 'all') {
  const list = Array.isArray(segments) ? segments : [];
  if (range === 'dialogue') return list.filter(segment => segment.type === 'dialogue');
  if (range === 'narration') return list.filter(segment => segment.type === 'narration');
  return list;
}

export function toStandardDocument(segments, timeline = null) {
  const times = new Map((Array.isArray(timeline) ? timeline : []).map(item => [item.id, item]));
  return {
    version: TTS_DOCUMENT_VERSION,
    segments: (Array.isArray(segments) ? segments : []).map(segment => ({
      id: `seg_${String(segment.id).padStart(3, '0')}`,
      type: segment.type,
      text: segment.text,
      speaker: segment.type === 'narration' ? NARRATOR : segment.speaker,
      lang: segment.lang || null,
      emotion: segment.emotion,
      ...(segment.voice ? { voice: segment.voice } : {}),
      ...(times.has(segment.id) ? { start: times.get(segment.id).start, end: times.get(segment.id).end } : {}),
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Voices.
// ---------------------------------------------------------------------------------------------

export function voiceRosterNames(voices) {
  return (Array.isArray(voices) ? voices : []).flatMap(item => [item.name, ...(item.aliases ?? [])]).filter(Boolean);
}

export function findVoiceEntry(voices, name) {
  const wanted = String(name ?? '');
  if (!wanted) return null;
  return (Array.isArray(voices) ? voices : []).find(item => item.name === wanted || item.aliases?.includes(wanted)) ?? null;
}

/**
 * The voice a segment is read in.
 *
 * Narration: the narrator's voice for the sentence's language, then the narrator's voice, then the
 * dialogue default. Dialogue: the character's voice for the language, then the character's own voice
 * when the row is locked, then the dialogue default, then the narrator. Nothing at all means the
 * provider's own default voice; a floor never stays silent for want of a row.
 */
/**
 * The voice bound to a language, accents included: the exact tag first (`en-GB`), then the plain
 * language (`en`), then any accent of it (a sentence the model only called `en` still reaches the
 * `en-US` voice the character has).
 */
export function languageVoice(table, lang) {
  if (!table || typeof table !== 'object' || !lang) return '';
  if (table[lang]) return table[lang];
  const base = languageBase(lang);
  if (table[base]) return table[base];
  const sibling = Object.keys(table).find(key => languageBase(key) === base);
  return sibling ? table[sibling] : '';
}

export function resolveSegmentVoice(segment, { voices = [], narratorVoice = '', narratorVoices = {}, dialogueVoice = '' } = {}) {
  const lang = String(segment?.lang ?? '');
  if (segment?.type === 'narration') return languageVoice(narratorVoices, lang) || narratorVoice || dialogueVoice || '';
  const entry = findVoiceEntry(voices, segment?.speaker);
  if (entry) {
    const byLanguage = languageVoice(entry.voices, lang);
    if (byLanguage) return byLanguage;
    if (entry.locked !== false && entry.voiceId) return entry.voiceId;
  }
  return dialogueVoice || narratorVoice || '';
}

export function planVoices(segments, config) {
  const items = [];
  const defaulted = new Set();
  const unvoiced = new Set();
  for (const segment of Array.isArray(segments) ? segments : []) {
    const voiceId = resolveSegmentVoice(segment, config);
    const who = segment.type === 'narration' ? '旁白' : (segment.speaker || '未知说话人');
    if (!voiceId) unvoiced.add(who);
    else if (segment.type === 'dialogue') {
      const entry = findVoiceEntry(config?.voices, segment.speaker);
      const own = entry && (languageVoice(entry.voices, segment.lang) || (entry.locked !== false && entry.voiceId));
      if (!own) defaulted.add(who);
    }
    items.push({ segment, voiceId });
  }
  return { items, defaulted: [...defaulted], unvoiced: [...unvoiced] };
}

// ---------------------------------------------------------------------------------------------
// Layer 3: the Fish Audio adapter.
// ---------------------------------------------------------------------------------------------

// S2 reads free-form bracket cues; the three steps follow Fish's own intensity table where it has one.
// S1 only knows a fixed parenthesised set, so its column stays inside that set.
const FISH_S2_CUES = Object.freeze({
  happy: ['[satisfied]', '[happy]', '[delighted]'],
  tender: ['[warm]', '[gentle]', '[tender][soft tone]'],
  sad: ['[disappointed]', '[sad]', '[very sad]'],
  angry: ['[frustrated]', '[angry]', '[furious]'],
  fear: ['[nervous]', '[scared]', '[terrified]'],
  shy: ['[shy]', '[embarrassed]', '[very embarrassed]'],
  surprise: ['[slightly surprised]', '[surprised]', '[shocked]'],
  serious: ['[calm]', '[serious]', '[stern]'],
  resolute: ['[confident]', '[determined]', '[very determined]'],
  whisper: ['[soft tone]', '[whispering]', '[whispering]'],
  shout: ['[loud]', '[shouting]', '[screaming]'],
});
const FISH_S1_CUES = Object.freeze({
  happy: ['(satisfied)', '(happy)', '(delighted)'],
  tender: ['(relaxed)', '(soft tone)', '(soft tone)'],
  sad: ['(disappointed)', '(sad)', '(depressed)'],
  angry: ['(frustrated)', '(angry)', '(angry)(shouting)'],
  fear: ['(nervous)', '(scared)', '(scared)'],
  shy: ['(embarrassed)', '(embarrassed)', '(embarrassed)'],
  surprise: ['(surprised)', '(surprised)', '(surprised)'],
  serious: ['(calm)', '(calm)', '(confident)'],
  resolute: ['(determined)', '(determined)', '(determined)'],
  whisper: ['(whispering)', '(whispering)', '(whispering)'],
  shout: ['(shouting)', '(shouting)', '(screaming)'],
});
// Fish's own intensity scale for the emotions it lists one for.
const FISH_INTENSITY = Object.freeze({
  happy: ['satisfied', 'happy', 'delighted'],
  sad: ['disappointed', 'sad', 'depressed'],
  angry: ['frustrated', 'angry', 'furious'],
  scared: ['nervous', 'scared', 'terrified'],
  excited: ['interested', 'excited', 'ecstatic'],
});
const S1_FIXED = new Set([
  ...FISH_EMOTIONS.slice(0, 49), 'in a hurry tone', 'shouting', 'screaming', 'whispering', 'soft tone', ...FISH_SOUNDS, 'break', 'long-break',
]);

export function fishSupportsMultiSpeaker(model) {
  return model !== 's1';
}

function wrapCue(word, model) {
  if (!word) return '';
  if (model === 's1') return S1_FIXED.has(word) ? `(${word})` : '';
  return `[${word}]`;
}

/**
 * One cue for a mood. A word Fish lists is used as Fish scales it; the palette's own twelve (and their
 * Chinese aliases) go through their tables; anything else is free-form natural language on S2.
 */
export function emotionCue(emotion, intensity, model = 's2-pro') {
  const word = cueWord(emotion);
  const palette = normalizeEmotion(emotion);
  // S1 cannot read free-form cues, so anything with a palette column takes that column there.
  if (palette && (model === 's1' || !FISH_EMOTIONS.includes(word))) {
    if (palette === 'neutral') return '';
    const table = model === 's1' ? FISH_S1_CUES : FISH_S2_CUES;
    return table[palette]?.[normalizeIntensity(intensity)] ?? '';
  }
  if (!word || word === 'neutral') return '';
  const step = normalizeIntensity(intensity);
  const scaled = FISH_INTENSITY[word]?.[step] ?? (step === 0 ? `slightly ${word}` : step === 2 ? `very ${word}` : word);
  if (model === 's1') return wrapCue(S1_FIXED.has(scaled) ? scaled : word, model);
  return wrapCue(scaled, model);
}

function insertAll(text, insertions) {
  let result = text;
  for (const item of [...insertions].sort((left, right) => right.index - left.index)) {
    result = `${result.slice(0, item.index)}${item.value}${result.slice(item.index)}`;
  }
  return result;
}

/**
 * The voice compiled into the provider's markup.
 *
 * Leading cues say the mood, the tone and any sound the sentence opens on; inline cues sit at the word
 * a pause follows, an emphasis precedes or the mood turns. The speed and volume the reading asked for
 * are not cues at all but Fish's per-request prosody, so they are returned as steps for the request
 * planner. The words of the sentence never change.
 */
export function compileVoiceCues(segment, { model = 's2-pro', emotionCues = true } = {}) {
  const voice = segment?.voice ?? (segment?.emotion ? { emotion: segment.emotion, intensity: segment.intensity ?? 1 } : null);
  const text = String(segment?.text ?? '');
  const result = { cues: [], text, tail: '', speed: 'normal', volume: 'normal' };
  if (!voice) return result;
  result.speed = VOICE_LEVELS.has(voice.speed) ? voice.speed : 'normal';
  result.volume = VOLUMES.has(voice.volume) ? voice.volume : 'normal';
  if (!emotionCues) return result;
  const s1 = model === 's1';
  const cues = [];
  const push = cue => {
    if (cue && !cues.includes(cue)) cues.push(cue);
  };
  push(emotionCue(voice.emotion, voice.intensity ?? 1, model));
  if (voice.secondary) push(emotionCue(voice.secondary, 1, model));
  const intensity = normalizeIntensity(voice.intensity ?? 1);
  let tone = '';
  if (voice.volume === 'quiet') tone = (voice.restraint >= 2 || voice.tension >= 2) ? 'whispering' : 'soft tone';
  else if (voice.volume === 'loud') tone = intensity === 2 && voice.tension >= 2 ? 'screaming' : 'shouting';
  else if (voice.speed === 'fast' && voice.tension >= 1) tone = 'in a hurry tone';
  if (tone) push(wrapCue(tone, model));
  // A sound the sentence opens on is more audible than a descriptor, so it comes before them.
  if (voice.breath === 'panting') push(wrapCue('panting', model));
  for (const sound of voice.sounds ?? []) if (sound.at !== 'end') push(wrapCue(sound.tag, model));
  if (!s1) {
    if (voice.restraint >= 2 && voice.volume !== 'quiet') push('[holding back]');
    if (voice.hesitation >= 2) push('[hesitant]');
    if (voice.rasp >= 2) push('[hoarse]');
    if (voice.breath === 'audible') push('[breathy]');
  }
  result.cues = cues.slice(0, 4);
  const insertions = [];
  const placed = new Set();
  const find = word => {
    const index = text.indexOf(word);
    return index >= 0 && !placed.has(`${word}@${index}`) ? index : -1;
  };
  for (const pause of voice.pauses ?? []) {
    const index = find(pause.after);
    if (index < 0) continue;
    const cue = wrapCue(pause.length === 'long' ? 'long-break' : 'break', model);
    if (cue) insertions.push({ index: index + pause.after.length, value: ` ${cue} ` });
  }
  if (!s1) {
    for (const word of voice.stress ?? []) {
      const index = find(word);
      if (index >= 0) insertions.push({ index, value: ' [emphasis] ' });
    }
  }
  for (const shift of voice.shifts ?? []) {
    const index = find(shift.at);
    const cue = emotionCue(shift.emotion, 1, model);
    if (index >= 0 && cue) insertions.push({ index, value: ` ${cue} ` });
  }
  result.text = insertAll(text, insertions).replace(/\s{2,}/g, ' ').trim();
  const tail = (voice.sounds ?? []).filter(sound => sound.at === 'end').map(sound => wrapCue(sound.tag, model)).filter(Boolean);
  result.tail = tail.join('');
  return result;
}

/** The text one sentence sends: the reader's own version when there is one, else the compiled voice. */
export function sentenceFishText(item, fish, { emotionCues = true, tamePunctuation = false } = {}) {
  const override = item?.override;
  if (override && typeof override.text === 'string' && override.text.trim()) return override.text.trim();
  const compiled = compileVoiceCues(item.segment, { model: fish?.model, emotionCues });
  const head = compiled.cues.join('');
  const text = tamePunctuation ? tamePunctuationMarks(compiled.text) : compiled.text;
  return `${head}${head ? ' ' : ''}${text}${compiled.tail ? ` ${compiled.tail}` : ''}`;
}

/**
 * Runs of exclamation and question marks collapsed to one, so the strength of a line comes from its
 * cue rather than from the voice shrieking at 「！！！」. A run with a question mark keeps a `?!`.
 */
export function tamePunctuationMarks(text) {
  return String(text ?? '').replace(/[!！?？]{2,}/g, run => {
    const wide = /[！？]/.test(run);
    const asks = /[?？]/.test(run);
    const shouts = /[!！]/.test(run);
    if (asks && shouts) return wide ? '？！' : '?!';
    if (asks) return wide ? '？' : '?';
    return wide ? '！' : '!';
  }).replace(/[～~]{2,}/g, run => run[0]);
}

const SPEED_STEPS = Object.freeze({ slow: 0.88, normal: 1, fast: 1.12 });
const VOLUME_STEPS = Object.freeze({ quiet: -3, normal: 0, loud: 3 });

/** Fish's prosody for one sentence: the reader's own numbers, else the voice's step on the settings. */
export function sentenceProsody(item, fish, { prosodySplit = true } = {}) {
  const base = { speed: Number(fish?.speed) || 1, volume: Number(fish?.volume) || 0 };
  const override = item?.override;
  const speedOverride = Number(override?.speed);
  const volumeOverride = Number(override?.volume);
  if (override && (Number.isFinite(speedOverride) || Number.isFinite(volumeOverride))) {
    return {
      speed: Number(Math.min(2, Math.max(0.5, Number.isFinite(speedOverride) ? speedOverride : base.speed)).toFixed(2)),
      volume: Number(Math.min(20, Math.max(-20, Number.isFinite(volumeOverride) ? volumeOverride : base.volume)).toFixed(1)),
    };
  }
  if (!prosodySplit) return base;
  const compiled = compileVoiceCues(item.segment, { model: fish?.model, emotionCues: false });
  return {
    speed: Number(Math.min(2, Math.max(0.5, base.speed * SPEED_STEPS[compiled.speed])).toFixed(2)),
    volume: Number(Math.min(20, Math.max(-20, base.volume + VOLUME_STEPS[compiled.volume])).toFixed(1)),
  };
}

/** Everything the provider markup adds, removed again: what is left is what alignment reports. */
export function stripCues(text) {
  return String(text ?? '')
    .replace(/<\|speaker:\d+\|>/g, '')
    .replace(/\[[^\]\n]{1,60}\]/g, ' ')
    .replace(/\((?:[a-z][a-z -]{1,30})\)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Cuts a floor into requests.
 *
 * A new request starts where a model that cannot switch speakers mid-text changes voice, where a
 * sentence with a voice meets one without (the provider's default voice cannot be indexed in a speaker
 * array), where the prosody steps change, and when the character budget would run out.
 */
export function planFishParts(items, { model = 's2-pro', maxChars = 1500, prosodySplit = true } = {}) {
  const multi = fishSupportsMultiSpeaker(model);
  const budget = Math.max(1, Number(maxChars) || 1500);
  const parts = [];
  let current = [];
  let characters = 0;
  let voice = null;
  let voiced = null;
  let prosody = null;
  for (const item of Array.isArray(items) ? items : []) {
    const length = String(item.segment.text).length;
    const hasVoice = Boolean(item.voiceId);
    const step = JSON.stringify(sentenceProsody(item, { speed: 1, volume: 0, model }, { prosodySplit }));
    const breaks = current.length && (
      (!multi && item.voiceId !== voice)
      || hasVoice !== voiced
      || step !== prosody
      || characters + length > budget
    );
    if (breaks) {
      parts.push(current);
      current = [];
      characters = 0;
    }
    current.push(item);
    characters += length;
    voice = item.voiceId;
    voiced = hasVoice;
    prosody = step;
  }
  if (current.length) parts.push(current);
  return parts;
}

/**
 * Turns the standard structure into Fish's own request.
 *
 * One voice sends a plain reference id and no speaker tags, which every model accepts. Several voices
 * send the id array and a `<|speaker:N|>` tag wherever the voice changes, N indexing that array. No
 * voice at all sends no reference id and lets Fish choose. The mood rides as cues at the start of its
 * sentence, where Fish says sentence-level cues work best, and the prosody is the part's.
 */
export function buildFishPayload(items, fish, { emotionCues = true, prosodySplit = true, tamePunctuation = false } = {}) {
  const list = Array.isArray(items) ? items : [];
  const voices = [];
  for (const item of list) if (item.voiceId && !voices.includes(item.voiceId)) voices.push(item.voiceId);
  if (voices.length && list.some(item => !item.voiceId)) throw new Error('一次请求里不能混用有音色和没有音色的句子。');
  const multi = voices.length > 1;
  if (multi && !fishSupportsMultiSpeaker(fish.model)) throw new Error('s1 模型不支持一次请求里用多个音色。');
  let text = '';
  let currentVoice = null;
  const spans = [];
  list.forEach((item, index) => {
    if (index) text += '\n';
    if (multi && item.voiceId !== currentVoice) text += `<|speaker:${voices.indexOf(item.voiceId)}|>`;
    currentVoice = item.voiceId;
    const sentence = sentenceFishText(item, fish, { emotionCues, tamePunctuation });
    text += sentence;
    spans.push({ id: item.segment.id, text: item.override?.text ? stripCues(sentence) : item.segment.text });
  });
  const prosody = list.length ? sentenceProsody(list[0], fish, { prosodySplit }) : { speed: fish.speed, volume: fish.volume };
  const body = {
    text,
    ...(voices.length ? { reference_id: multi ? voices : voices[0] } : {}),
    format: fish.format,
    latency: fish.latency,
    normalize: fish.normalize,
    temperature: fish.temperature,
    top_p: fish.topP,
    prosody,
  };
  if (fish.format === 'mp3') body.mp3_bitrate = fish.mp3Bitrate;
  return { body, spans, voices };
}

export const FISH_MIME = Object.freeze({ mp3: 'audio/mpeg', opus: 'audio/ogg', wav: 'audio/wav', pcm: 'audio/L16' });

export function fishEndpoint(fish, path) {
  const base = String(fish?.baseUrl || 'https://api.fish.audio').replace(/\/+$/, '');
  const target = `${base}${path}`;
  // The host's proxy takes the full target URL as its path.
  return fish?.viaProxy === false ? target : `/proxy/${target}`;
}

/**
 * Request headers for one Fish call.
 *
 * Through the proxy the host's own headers go along: the CSRF token is what lets a disabled proxy answer
 * with its own explanation instead of a bare 403, and the proxy strips it before forwarding. A direct
 * call never carries the host's session token to a third party.
 */
export function fishHeaders(fish, hostHeaders = {}) {
  const base = fish?.viaProxy === false ? {} : { ...hostHeaders };
  return {
    ...base,
    'Content-Type': 'application/json',
    Authorization: `Bearer ${fish?.key ?? ''}`,
    model: fish?.model ?? 's2-pro',
  };
}

export function describeFishFailure({ status = 0, body = '', viaProxy = true, network = false } = {}) {
  if (network) {
    return viaProxy
      ? '连不上酒馆的代理接口，检查酒馆是否还在运行。'
      : '浏览器直连失败：api.fish.audio 不允许浏览器跨域访问。改用「经酒馆代理」，或者填一个允许跨域的中转地址。';
  }
  const text = String(body ?? '');
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = null; }
  const message = typeof payload?.message === 'string' ? payload.message : text.replace(/\s+/g, ' ').slice(0, 240);
  // The host proxy rewrites 401 to 400 so the browser keeps its own Basic auth; the body still says 401.
  const upstream = Number(payload?.status) || Number(status) || 0;
  if (Number(status) === 404 && /CORS proxy is disabled/i.test(text)) {
    return '酒馆的 CORS 代理没有打开。在酒馆目录的 config.yaml 里把 enableCorsProxy 改成 true，重启酒馆后再试。';
  }
  if (Number(status) === 403 && /csrf/i.test(text)) return '酒馆拒绝了这次代理请求（CSRF）。刷新酒馆页面后再试。';
  if (upstream === 401 || /api[- ]?key|unauthorized/i.test(message)) return 'Fish API Key 无效或没有填写。';
  if (upstream === 402) return 'Fish API 余额不足。API 额度和网页端的额度分开计算；可以先把模型换成 s2.1-pro-free（免费开发者档），或者去 fish.audio/app/developers 充值。';
  if (upstream === 429) return 'Fish 限流了，请求太频繁。等一会儿再试，免费档的限制更紧。';
  if (upstream === 404) return `Fish 接口地址不对（HTTP 404）：${message || '没有说明'}`;
  if (upstream >= 500) return `Fish 服务端暂时不可用（HTTP ${upstream}）：${message || '没有说明'}`;
  return `Fish 返回错误（HTTP ${upstream || '未知'}）：${message || '没有说明'}`;
}

/**
 * Server-Sent Events, fed as text arrives.
 *
 * Frames split anywhere — mid-line, mid-CRLF, mid-base64 — so the parser keeps its own buffer and only
 * dispatches a frame on its blank line.
 */
export function createSseParser(onEvent) {
  let buffer = '';
  let data = [];
  let eventName = '';
  const dispatch = () => {
    if (data.length) onEvent({ event: eventName || 'message', data: data.join('\n') });
    data = [];
    eventName = '';
  };
  const feedLine = line => {
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') eventName = value;
  };
  return {
    push(text) {
      buffer += String(text ?? '');
      for (;;) {
        const index = buffer.search(/\r\n|\r|\n/);
        if (index < 0) break;
        // A trailing \r may be the first half of \r\n that the next chunk completes.
        if (buffer[index] === '\r' && index === buffer.length - 1) break;
        const width = buffer.startsWith('\r\n', index) ? 2 : 1;
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + width);
        feedLine(line);
      }
    },
    end() {
      if (buffer) feedLine(buffer.replace(/\r$/, ''));
      buffer = '';
      dispatch();
    },
  };
}

/**
 * Audio and alignment from the timestamp stream.
 *
 * Every audio chunk is kept in arrival order. Alignment is a cumulative snapshot per text chunk, so a
 * newer one replaces the older one for the same `chunk_seq` rather than adding to it.
 */
export function createTimestampCollector() {
  const audio = [];
  const alignments = new Map();
  let events = 0;
  return {
    accept(payload) {
      events += 1;
      if (typeof payload?.audio_base64 === 'string' && payload.audio_base64) audio.push(payload.audio_base64);
      const alignment = payload?.alignment;
      if (alignment && Array.isArray(alignment.segments)) {
        const seq = Number.isInteger(payload.chunk_seq) ? payload.chunk_seq : 0;
        alignments.set(seq, {
          offset: Number(payload.chunk_audio_offset_sec) || 0,
          duration: Number(alignment.audio_duration) || 0,
          segments: alignment.segments,
          content: String(payload.content ?? ''),
        });
      }
    },
    result() {
      return { audio, alignments, events };
    },
  };
}

export function base64ToBytes(value) {
  const binary = globalThis.atob(String(value ?? ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function buildGlobalTimeline(alignments) {
  const timeline = [];
  let duration = 0;
  const ordered = [...(alignments instanceof Map ? alignments : new Map())].sort((left, right) => left[0] - right[0]);
  for (const [, chunk] of ordered) {
    for (const segment of Array.isArray(chunk.segments) ? chunk.segments : []) {
      const start = Number(segment?.start);
      const end = Number(segment?.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      timeline.push({ text: String(segment?.text ?? ''), start: start + chunk.offset, end: Math.max(start, end) + chunk.offset });
    }
    duration = Math.max(duration, chunk.offset + chunk.duration, timeline.at(-1)?.end ?? 0);
  }
  return { timeline, duration };
}

// What alignment keeps of a text: letters and digits. Fish drops punctuation from its segments and
// spells apostrophes its own way, so both sides are reduced to the same alphabet before comparing.
function speakableCharacters(text) {
  return [...String(text ?? '').normalize('NFKC').toLowerCase()].filter(character => SPEAKABLE_RE.test(character));
}

/**
 * Where each of our sentences sits in the generated audio.
 *
 * Fish reports words (per character for Chinese) with the punctuation gone, and with number
 * normalisation on it may say 一百二十三 where the text has 123. So this is a character alignment with
 * resynchronisation, not a lookup: matching characters advance both sides, and a mismatch searches a
 * short window on either side for the next run of two that agree. A sentence then spans the first to
 * the last of its characters that found a partner. A sentence with none — all digits that were read out
 * as words, say — takes the gap between its neighbours, so every sentence still has somewhere to seek.
 */
export function alignSpansToTimeline(spans, timeline, { duration = 0, window = 24 } = {}) {
  const target = [];
  (Array.isArray(spans) ? spans : []).forEach((span, spanIndex) => {
    for (const character of speakableCharacters(span.text)) target.push({ character, spanIndex });
  });
  const spoken = [];
  for (const item of Array.isArray(timeline) ? timeline : []) {
    const characters = speakableCharacters(item.text);
    const step = characters.length ? (item.end - item.start) / characters.length : 0;
    characters.forEach((character, index) => {
      spoken.push({ character, start: item.start + step * index, end: item.start + step * (index + 1) });
    });
  }
  const matched = new Array(target.length).fill(-1);
  const agrees = (targetIndex, spokenIndex) => {
    const run = Math.min(2, target.length - targetIndex, spoken.length - spokenIndex);
    if (run <= 0) return false;
    for (let offset = 0; offset < run; offset += 1) {
      if (target[targetIndex + offset].character !== spoken[spokenIndex + offset].character) return false;
    }
    return true;
  };
  let targetIndex = 0;
  let spokenIndex = 0;
  while (targetIndex < target.length && spokenIndex < spoken.length) {
    if (target[targetIndex].character === spoken[spokenIndex].character) {
      matched[targetIndex] = spokenIndex;
      targetIndex += 1;
      spokenIndex += 1;
      continue;
    }
    let found = null;
    for (let distance = 1; distance <= window * 2 && !found; distance += 1) {
      for (let skipTarget = 0; skipTarget <= distance; skipTarget += 1) {
        const skipSpoken = distance - skipTarget;
        if (skipTarget > window || skipSpoken > window) continue;
        if (targetIndex + skipTarget >= target.length || spokenIndex + skipSpoken >= spoken.length) continue;
        if (agrees(targetIndex + skipTarget, spokenIndex + skipSpoken)) {
          found = { skipTarget, skipSpoken };
          break;
        }
      }
    }
    if (!found) {
      targetIndex += 1;
      continue;
    }
    targetIndex += found.skipTarget;
    spokenIndex += found.skipSpoken;
  }

  const results = (Array.isArray(spans) ? spans : []).map(span => ({ id: span.id, start: null, end: null, matched: 0, total: speakableCharacters(span.text).length }));
  target.forEach((item, index) => {
    const partner = matched[index];
    if (partner < 0) return;
    const result = results[item.spanIndex];
    const time = spoken[partner];
    result.start = result.start === null ? time.start : Math.min(result.start, time.start);
    result.end = result.end === null ? time.end : Math.max(result.end, time.end);
    result.matched += 1;
  });
  const total = Math.max(Number(duration) || 0, spoken.at(-1)?.end ?? 0);
  results.forEach((result, index) => {
    if (result.start !== null) return;
    const previous = results.slice(0, index).reverse().find(item => item.end !== null);
    const next = results.slice(index + 1).find(item => item.start !== null);
    result.start = previous?.end ?? 0;
    result.end = Math.max(result.start, next?.start ?? total);
    result.interpolated = true;
  });
  return results.map(result => ({
    id: result.id,
    start: Number(result.start.toFixed(3)),
    end: Number(result.end.toFixed(3)),
    coverage: result.total ? Number((result.matched / result.total).toFixed(3)) : 0,
    ...(result.interpolated ? { interpolated: true } : {}),
  }));
}

/**
 * The stretch of audio to play for one sentence of a recording.
 *
 * The aligned span is word-tight, which clips the breath before the first word and the fall of the last
 * one. A little is added on either side, never reaching into the neighbouring sentence.
 */
export function playbackWindow(entries, index, duration = 0) {
  const list = Array.isArray(entries) ? entries : [];
  const entry = list[index];
  if (!entry) return null;
  const previous = list[index - 1];
  const next = list[index + 1];
  const floor = previous && previous.part === entry.part ? previous.end : 0;
  const ceiling = next && next.part === entry.part ? next.start : (Number(duration) || entry.end + 0.6);
  const round = value => Number(value.toFixed(3));
  return {
    part: entry.part ?? 0,
    start: round(Math.max(floor, entry.start - 0.08)),
    end: round(Math.max(entry.start, Math.min(ceiling, entry.end + 0.35))),
  };
}

export function fishFingerprint(fish, { emotionCues = true, prosodySplit = true, tamePunctuation = false } = {}) {
  return {
    provider: 'fish',
    model: fish.model,
    format: fish.format,
    mp3Bitrate: fish.format === 'mp3' ? fish.mp3Bitrate : null,
    latency: fish.latency,
    speed: fish.speed,
    volume: fish.volume,
    temperature: fish.temperature,
    topP: fish.topP,
    normalize: fish.normalize,
    emotionCues,
    prosodySplit,
    tamePunctuation,
  };
}

// Floor, text version, unit, every sentence's text, voice and mood, the reader's own edits and every
// setting that changes the sound. The key and the endpoint are left out: they decide whether a request
// works, not what it sounds like.
export async function recordingCacheKey({ floorId, version, unit = 'floor', maxChars, items, fingerprint }) {
  return `r:${await hashText(JSON.stringify({
    v: 2, floorId, version, unit, maxChars, fingerprint,
    items: (Array.isArray(items) ? items : []).map(({ segment, voiceId, override }) => [
      segment.id, segment.type, segment.text, segment.speaker, segment.emotion, segment.intensity, voiceId,
      segment.voice ?? null, override ?? null,
    ]),
  }))}`;
}

export async function floorCacheKey({ floorId, version, range, maxChars, items, fingerprint }) {
  return recordingCacheKey({ floorId, version, unit: `floor:${range}`, maxChars, items, fingerprint });
}

// What a recording is good for, in the terms a later click has: the words, the voice and the sound
// settings. The mood is left out on purpose — an analysis that comes out a shade different the next
// time is not a reason to pay for the same sentence again.
export async function fingerprintKey(fingerprint) {
  return hashText(JSON.stringify(fingerprint ?? null));
}

export function recordCovers(items, timeline) {
  const byId = new Map((Array.isArray(items) ? items : []).map(item => [item.segment.id, item]));
  return (Array.isArray(timeline) ? timeline : []).map(entry => {
    const item = byId.get(entry.id);
    return {
      ...entry,
      text: item?.segment.text ?? '',
      voiceId: item?.voiceId ?? '',
      lineId: item?.segment.lineId ?? null,
      speaker: item?.segment.speaker ?? null,
      type: item?.segment.type ?? null,
      edited: Boolean(item?.override?.text),
    };
  });
}

/** The entry in one of `records` that already holds this sentence in this voice, newest first. */
export function findCoveringEntry(records, { text, voiceId, fingerprint }) {
  const list = (Array.isArray(records) ? records : []).filter(record => Array.isArray(record?.timeline) && record.fingerprint === fingerprint);
  list.sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  for (const record of list) {
    const index = record.timeline.findIndex(entry => entry.text === text && (entry.voiceId ?? '') === (voiceId ?? '') && !entry.edited);
    if (index >= 0) return { record, index };
  }
  return null;
}

// The text, the depth and the language side: nothing else. The cast list, the worldbook and the floors
// before this one all change as a chat goes on, and none of them is a reason to read the same floor
// again and pay for it; a reader who wants a fresh reading asks for one.
export async function analysisCacheKey({ utterances, source = 'model', depth = 'light', side = '' }) {
  return `a:${await hashText(JSON.stringify({
    v: TTS_ANALYSIS_VERSION, source, depth, side,
    utterances: (Array.isArray(utterances) ? utterances : []).map(item => [item.id, item.kind, item.anchor]),
  }))}`;
}

// ---------------------------------------------------------------------------------------------
// Saving audio. Fish streams frames without a container header, so consecutive mp3 and Ogg parts
// simply follow one another; WAV parts need one header for the total.
// ---------------------------------------------------------------------------------------------

function readUint32(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | ((bytes[offset + 3] << 24) >>> 0);
}

function wavData(bytes) {
  // RIFF WAVE with an fmt chunk somewhere before data; anything else is treated as bare PCM.
  if (bytes.length < 12 || String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...bytes.slice(8, 12)) !== 'WAVE') {
    return { header: null, data: bytes };
  }
  let offset = 12;
  let header = null;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const size = readUint32(bytes, offset + 4);
    if (id === 'fmt ') header = bytes.slice(offset + 8, offset + 8 + size);
    if (id === 'data') return { header, data: bytes.slice(offset + 8, offset + 8 + size) };
    offset += 8 + size + (size % 2);
  }
  return { header, data: new Uint8Array(0) };
}

export function mergeWavBuffers(buffers) {
  const parsed = (Array.isArray(buffers) ? buffers : []).map(buffer => wavData(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)));
  const fmt = parsed.find(item => item.header)?.header ?? new Uint8Array([1, 0, 1, 0, 0x44, 0xac, 0, 0, 0x88, 0x58, 1, 0, 2, 0, 16, 0]);
  const dataLength = parsed.reduce((sum, item) => sum + item.data.length, 0);
  const out = new Uint8Array(12 + 8 + fmt.length + 8 + dataLength);
  const write = (offset, text) => { for (let index = 0; index < text.length; index += 1) out[offset + index] = text.charCodeAt(index); };
  const writeUint32 = (offset, value) => { out[offset] = value & 255; out[offset + 1] = (value >>> 8) & 255; out[offset + 2] = (value >>> 16) & 255; out[offset + 3] = (value >>> 24) & 255; };
  write(0, 'RIFF');
  writeUint32(4, out.length - 8);
  write(8, 'WAVE');
  write(12, 'fmt ');
  writeUint32(16, fmt.length);
  out.set(fmt, 20);
  const dataAt = 20 + fmt.length;
  write(dataAt, 'data');
  writeUint32(dataAt + 4, dataLength);
  let cursor = dataAt + 8;
  for (const item of parsed) {
    out.set(item.data, cursor);
    cursor += item.data.length;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Finding utterances again on the rendered floor.
//
// The host renders the floor through markdown, wraps quotes in <q>, and the display regex drops every
// invisible boundary, so the only thing the page and the stored text still share is the words. Both
// sides are reduced to the characters markdown cannot change, and utterances are located in order,
// inside their own line first, so a short Chinese line cannot latch onto the Japanese above it.
// ---------------------------------------------------------------------------------------------

// What the page and the stored text still share after the host has rendered the floor: letters, digits
// and combining marks. Quotes, punctuation, dashes, markdown characters and spaces are whatever the
// preset's regex and the markdown pass made of them, so none of that is compared.
const MATCH_KEEP_RE = /[\p{L}\p{N}\p{M}]/u;

function matchCharacters(character) {
  const kept = [];
  for (const piece of String(character).normalize('NFKC').toLowerCase()) if (MATCH_KEEP_RE.test(piece)) kept.push(piece);
  return kept;
}

function matchKey(text) {
  let key = '';
  for (const character of plainLineText(text)) key += matchCharacters(character).join('');
  return key;
}

// The punctuation an anchor opens and closes on (「, ”, 。, ！), so the range on the page can take the
// same marks in, and the button lands after the closing quote rather than inside it.
function anchorMarks(text) {
  const characters = [...String(text ?? '')];
  const first = characters.findIndex(character => MATCH_KEEP_RE.test(character));
  const last = characters.length - 1 - [...characters].reverse().findIndex(character => MATCH_KEEP_RE.test(character));
  if (first < 0) return { head: new Set(), tail: new Set() };
  const marks = list => new Set(list.filter(character => !/\s/.test(character)));
  return { head: marks(characters.slice(0, first)), tail: marks(characters.slice(last + 1)) };
}

/**
 * Locates each anchor in a sequence of text-node contents.
 *
 * Returns, per anchor, the node and offset just after its last character (`end`) and of its first
 * (`start`), or null when it cannot be found. Offsets are UTF-16 units, ready for a DOM Range. A run
 * that cannot be found whole is bracketed by its first and last six letters, which rides over a mark
 * or a tag the rendering put in the middle.
 */
export function locateAnchors(nodeTexts, lines, anchors) {
  const texts = (Array.isArray(nodeTexts) ? nodeTexts : []).map(text => String(text ?? ''));
  const units = [];
  let stream = '';
  texts.forEach((text, node) => {
    let offset = 0;
    for (const character of text) {
      const start = offset;
      offset += character.length;
      for (const piece of matchCharacters(character)) {
        units.push({ node, start, end: offset });
        stream += piece;
      }
    }
  });
  const findKey = (key, from, limit) => {
    if (!key) return null;
    const at = stream.indexOf(key, from);
    if (at >= 0 && (limit === undefined || at + key.length <= limit)) return { at, length: key.length };
    if (key.length < 8) return null;
    const head = key.slice(0, 6);
    const tail = key.slice(-6);
    const headAt = stream.indexOf(head, from);
    if (headAt < 0 || (limit !== undefined && headAt >= limit)) return null;
    const tailAt = stream.indexOf(tail, headAt + head.length);
    if (tailAt < 0 || tailAt - headAt > key.length * 2 || (limit !== undefined && tailAt + tail.length > limit)) return null;
    return { at: headAt, length: tailAt + tail.length - headAt };
  };
  const result = new Map();
  // Lines first. Each one also records where the last line found before it ended, which is where a
  // search for an unfound line's utterances may start without reaching back into the source above.
  let cursor = 0;
  const lineRanges = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    const found = findKey(matchKey(line.text), cursor);
    if (!found) {
      lineRanges.set(line.lineId, { found: false, after: cursor });
      continue;
    }
    lineRanges.set(line.lineId, { found: true, start: found.at, end: found.at + found.length, cursor: found.at });
    cursor = found.at + found.length;
  }
  const stepBack = (text, offset) => {
    if (offset <= 0) return 0;
    const code = text.charCodeAt(offset - 1);
    return code >= 0xdc00 && code <= 0xdfff && offset >= 2 ? offset - 2 : offset - 1;
  };
  const positionAfter = (index, tail) => {
    const unit = units[index];
    const text = texts[unit.node];
    let offset = unit.end;
    while (offset < text.length) {
      const character = String.fromCodePoint(text.codePointAt(offset));
      if (!tail.has(character)) break;
      offset += character.length;
    }
    return { node: unit.node, offset };
  };
  const positionAt = (index, head) => {
    const unit = units[index];
    const text = texts[unit.node];
    let offset = unit.start;
    while (offset > 0) {
      const previous = stepBack(text, offset);
      const character = String.fromCodePoint(text.codePointAt(previous));
      if (!head.has(character)) break;
      offset = previous;
    }
    return { node: unit.node, offset };
  };
  let lastEnd = 0;
  for (const anchor of Array.isArray(anchors) ? anchors : []) {
    const key = matchKey(anchor.text);
    const range = lineRanges.get(anchor.lineId);
    let found = null;
    if (key && range?.found) {
      found = findKey(key, range.cursor, range.end);
      if (found) range.cursor = found.at + found.length;
    } else if (key) {
      found = findKey(key, Math.max(lastEnd, range?.after ?? 0));
    }
    if (!found) {
      result.set(anchor.id, null);
      continue;
    }
    lastEnd = found.at + found.length;
    const marks = anchorMarks(anchor.text);
    result.set(anchor.id, { start: positionAt(found.at, marks.head), end: positionAfter(found.at + found.length - 1, marks.tail) });
  }
  return result;
}

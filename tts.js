import {
  DEFAULT_QUOTE_PAIRS,
  foldEmbeddedQuotes,
  hashText,
  isPlaceholderSpeaker,
  languageBase,
  normalizeLanguageCode,
  normalizeNewlines,
  parseJsonCandidates,
  parsePairList,
  unifySpeakerNames,
  MARK_TAGS,
} from './core.js?v=0.29.3';
import { EMOTION_KEYS, EMOTION_STYLES, normalizeEmotion, normalizeIntensity } from './palette.js?v=0.29.3';
import { sanitizeForTts } from './tts-sanitizer.js?v=0.29.3';

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
export const TTS_ANALYSIS_VERSION = 4;
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

// Markup that reached a line is presentation, not speech: the copy the voice gets loses it whole.
export function plainLineText(text) {
  return sanitizeForTts(String(text ?? '').replace(INVISIBLE_RE, ''));
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
    // A quote set off inside a sentence is part of that sentence, read as narration with it.
    for (const part of foldEmbeddedQuotes(splitByPairs(lineText, { quotePairs: quotes, skipPairs }), run => unquote(run, quotes))) {
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
 * The translation's own labels, read onto the utterances: no request at all.
 *
 * A line's mark names one speaker and one mood for the whole line; its `quotes` name them for each
 * quoted run in order, each with the first few characters of that run, so the runs are told apart
 * even when the model miscounted them. A narrated run wears no speaker even when the model gave the
 * line one, the same rule the colouring keeps. Fish's own words come back as the voice beside the
 * label, so the cue Fish hears is the word the translation chose and not the palette's fold of it.
 */
export function annotationReading(utterances, annotations) {
  const labels = new Map();
  const voices = new Map();
  if (!(annotations instanceof Map)) return { labels, voices };
  const byLine = new Map();
  for (const utterance of Array.isArray(utterances) ? utterances : []) {
    if (utterance.kind !== 'quoted') continue;
    if (!byLine.has(utterance.lineId)) byLine.set(utterance.lineId, []);
    byLine.get(utterance.lineId).push(utterance);
  }
  for (const [lineId, quoted] of byLine) {
    const mark = annotations.get(lineId);
    if (!mark) continue;
    const quotes = (Array.isArray(mark.quotes) ? mark.quotes : []).filter(quote => quote && typeof quote === 'object');
    const matched = matchQuoteMarks(quoted, quotes);
    for (const utterance of quoted) {
      const own = matched.get(utterance.id);
      // A run's own mark fills in from the line's only where the line has just this one run to speak of.
      const source = own ? (quoted.length === 1 ? { ...mark, ...own } : own) : mark;
      const label = readTtsLabel({ type: 'dialogue', speaker: source.speaker, emotion: source.emotion, intensity: source.intensity });
      if (label) labels.set(utterance.id, label);
      const voice = annotationVoice(source, utterance.text);
      if (voice) voices.set(utterance.id, voice);
    }
  }
  return { labels, voices };
}

// The runs of a line matched to the marks the translation gave them: by the opening characters each
// mark quotes, then by order when the counts agree. What matches nothing keeps the line's own mark.
function matchQuoteMarks(quoted, quotes) {
  const matched = new Map();
  if (!quotes.length) return matched;
  const keys = quoted.map(utterance => matchKey(utterance.text));
  const taken = new Set();
  const pending = [];
  for (const quote of quotes) {
    const head = matchKey(quote.head ?? '');
    const found = head ? keys.findIndex((key, index) => !taken.has(index) && key.startsWith(head)) : -1;
    if (found >= 0) {
      taken.add(found);
      matched.set(quoted[found].id, quote);
    } else pending.push(quote);
  }
  if (quotes.length === quoted.length) {
    const rest = quoted.map((utterance, index) => index).filter(index => !taken.has(index));
    pending.forEach((quote, offset) => {
      if (rest[offset] !== undefined) matched.set(quoted[rest[offset]].id, quote);
    });
  }
  return matched;
}

// The voice a mark carries: the direction and the words it points at, checked against the sentence;
// the mood when it is one of Fish's rather than one of the palette's; the tone.
function annotationVoice(mark, text = '') {
  if (!mark || typeof mark !== 'object') return null;
  const voice = normalizeVoice({ ...mark, emotion: undefined, intensity: undefined }, text) ?? {};
  const word = cueWord(mark.emotion);
  if (word && word !== 'neutral' && !Object.hasOwn(EMOTION_STYLES, word)) voice.emotion = word;
  if (!Object.keys(voice).length) return null;
  const intensity = level(mark.intensity);
  if (intensity !== null) voice.intensity = intensity;
  return voice;
}

/** The labels alone, for callers that have no use for the voices. */
export function labelsFromAnnotations(utterances, annotations) {
  return annotationReading(utterances, annotations).labels;
}

const EMOTION_GLOSS = EMOTION_KEYS.map(key => `${key}=${EMOTION_STYLES[key].label}`).join('、');

export function rosterList(roster) {
  return [...new Set((Array.isArray(roster) ? roster : []).map(name => String(name ?? '').trim()).filter(Boolean))].slice(0, 60);
}

export function referenceLines(translations) {
  return translations instanceof Map
    ? [...translations].filter(([, text]) => String(text ?? '').trim()).map(([line, text]) => ({ line, text: String(text) }))
    : [];
}

// The two system prompts, as templates the reader may replace in the settings. Placeholders:
// {{user}} the user's role, {{palette}} the light emotion labels, {{sounds}} the Fish sound tags,
// {{references_rule}} the rule about translations riding along when the original is read.
export const DEFAULT_TTS_PROMPTS = Object.freeze({
  simple: [
    '你是有声小说的配音助手。下面是一楼正文，按段给出，每句对白前面标着 ⟦编号⟧。你只做两件事：每句对白由谁念、带什么情绪念。不改写、不复述、不翻译任何句子。',
    '只输出一个 JSON 对象，不要任何解释：{"voices":[{"id":4,"speaker":"名字","emotion":"英文情绪词"}]}。只输出对白的条目，旁白不用输出；每个编号最多出现一次；不要输出 text。',
    '1. speaker：优先从 roster 里逐字照抄名字，不加敬称；roster 里没有的人写正文里对这个人的称呼。看引号前后的人名和动作、话里叫到的名字（被叫到的是听的人，不是说的人）、两个人一来一回的顺序。{{user}}看不出是谁说的就省略，不要猜。输入里的 speakers 是用户手动定的说话人，那些编号照抄。',
    '2. emotion：只能取 emotions 列表里的一个英文词，逐字照抄，一句一个，看不出明显情绪就省略。不要自己造词，不要加程度词。',
    '3. 可选：tone 只在原文明确写了小声、耳语、喊、尖叫、急促时写，取 tones 列表里的词；sounds 只在原文明确写了笑、叹气、喘息这类声音时写：[{"at":"start 或 end","tag":"sounds 列表里的词"}]。styles 是角色的表达习惯和用户定下的规则，是硬性要求，不是参考。',
    '{{lang_rule}}',
    '{{references_rule}}',
  ].join('\n'),
  simpleOld: [
    '你是有声小说的配音导演助手。下面是一楼正文按顺序切好的句子。你为每一句搭一个「情绪骨架」：由谁念、带什么情绪念、情绪在句中怎么变、语气语速如何、哪里该停顿或重读、有没有笑声喘息这类声音。不改写、不复述、不翻译任何句子。',
    '输入的 utterances 每项有 id、kind（quoted 表示原文在引号里，narration 表示不在引号里）和 text；styles 是每个角色的表达习惯和用户定下的规则，指令必须遵守。',
    '只输出一个 JSON 对象，不要任何解释：{"voices":[{"id":1,"type":"narration"},{"id":2,"type":"dialogue","speaker":"名字","emotion":"英文情绪词","direction":"中文配音指令","speed":"slow","stress":["句中的词"],"pauses":[{"after":"句中的词","length":"long"}],"sounds":[{"at":"start","tag":"声音词"}],"shift":{"at":"句中的词","direction":"中文指令"}}]}',
    '1. type：dialogue（角色说出口的话）或 narration（旁白、叙述、动作、心理描写）。引号用来标书名、专有名词、强调或引用时是 narration；不在引号里却明显是角色在说的话也是 dialogue。',
    '2. speaker 只给 dialogue：优先从 roster 里逐字照抄名字，不加敬称；roster 里没有的人写正文里对这个人的称呼。{{user}}看不出是谁说的就省略，不要猜。',
    '3. direction：一句中文配音指令，20 字左右、最多 40 字，写这一句真正该怎么念：基础情绪、情绪的变化、语气（压着、装冷淡、带笑、发抖……）、语速倾向、必要的停顿感。要写出配音演员能照着演的话，不要只写一个情绪词。旁白也可以写，写旁白的口吻（平静叙述、轻声、带一点紧张……）；平淡的句子省略 direction。',
    '4. emotion：可选，英文，取 emotions 列表里最接近的一个词，给界面着色用；direction 才是配音的依据。intensity 0 弱、1 中、2 强，只在原文明确加强或减弱时写。',
    '5. speed：slow / fast，只在明显比平常快或慢时写；volume：quiet / loud，同理。这两项会变成语音模型的语速音量参数。',
    '6. stress：要重读的词（最多 3 个）；pauses：某个词后面要停顿，length 是 short 或 long（最多 4 处）；shift：句子从某个词起情绪转变，写那个词和转变后的中文指令；sounds：笑声、叹气、喘息这类非语言声音，tag 取 {{sounds}} 之一或一个简短的中文声音词，at 是 start（句首）、end（句尾）或 after（某个词后面，配 after 字段写那个词）。这几项里的词必须逐字出现在这句里，只在这个人此刻真的会这样时写，不要每句都加。',
    '7. lang：这一句的语言代码（zh、en、ja、ko、de、fr、es、ru……）。英语按人物设定区分 en-US（美式）和 en-GB（英式、伦敦腔），分不出就写 en。与整楼主要语言相同、人物设定又没说口音时省略。',
    '8. 每个 id 最多出现一次。不要输出 text，不要输出 id 以外的句子内容。输入里如果有 lead，那是这一批前面紧挨着的几句，只用来认人和判断语气，不用回答。',
    '{{references_rule}}',
  ].join('\n'),
  refine: [
    '你是有声小说的配音助手。下面是一楼正文里的几句话、上一次给它们的标注（current），还有用户对上一次结果的意见（feedback）。你的工作不是重新通读正文，而是按用户的意见修正上一次的标注。',
    '只改用户的意见涉及到的句子。意见没有说到的句子，只输出 {"id":N}，表示上一次的标注原样保留——这是最重要的一条，不要把没提到的句子重写一遍。',
    '只输出一个 JSON 对象，不要任何解释，格式和上一次一样：{"voices":[{"id":1},{"id":2,"type":"dialogue","speaker":"名字","emotion":"英文情绪词","tone":"英文语气词","sounds":[{"at":"start","tag":"英文声音词"}]}]}',
    '1. type：dialogue（角色说出口的话）或 narration（旁白、叙述、动作、心理描写）。',
    '2. speaker 只给 dialogue：优先从 roster 里逐字照抄名字，不加敬称。用户说「说话人不对」时，重新判断这几句到底是谁在说，参考前后文和 roster；current 里 manual 为 true 的句子是用户手动定的说话人，不要改。',
    '3. emotion：只能取 emotions 列表里的一个英文词，逐字照抄，一句一个。用户说「情绪不够」就换一个更贴切、更强的词；说「太夸张」就换平一点的；不要自己造词，不要加 slightly、very 这类程度词。',
    '4. tone：可选，只能取 tones 列表里的一个；sounds：只能取 sounds 列表里的词，at 是 start 或 end。用户嫌声音多就删掉，嫌少就在真的合适的地方加。',
    '5. styles 是角色的表达习惯和用户定下的规则，改的时候要遵守。',
    '6. 每个 id 最多出现一次，不要输出 text。',
    '{{references_rule}}',
  ].join('\n'),
  // The older name of the simple prompt, for settings that still say it.
  get light() { return this.simple; },
});

const REFERENCES_RULE = '输入里的 translations 是这些原文行（按 line 对应）的译文，只用来帮你认人、理解语气。speaker 按 roster 或译文里的写法写，不要写原文里的名字。';

// Asked for only when a floor mixes scripts; a floor in one language has nothing to say about it.
const LANG_RULE = 'lang：这一楼混着几种语言，给每句对白加 lang（zh、en、ja、ko、de、fr、es、ru……），与整楼主要语言相同的省略；英语按人物设定分 en-US 和 en-GB，分不出写 en。';

export function fillPrompt(template, { userName = '', references = false, lang = false } = {}) {
  return String(template ?? '')
    .replaceAll('{{user}}', userName ? `用户扮演的角色叫 ${userName}。` : '')
    .replaceAll('{{palette}}', EMOTION_GLOSS)
    .replaceAll('{{sounds}}', SOUND_TAGS.join(' / '))
    .replaceAll('{{lang_rule}}', lang ? LANG_RULE : '')
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
/**
 * The floor as the analyses read it: each paragraph as one line of text, every quoted run marked
 * with its id in front — ⟦4⟧「……」 — so the model sees the words around a line of dialogue and
 * answers by number, and nothing is listed twice.
 */
export function floorTextWithMarks(utterances) {
  const lines = new Map();
  for (const utterance of Array.isArray(utterances) ? utterances : []) {
    const text = `${utterance.kind === 'quoted' ? `⟦${utterance.id}⟧` : ''}${utterance.anchor ?? utterance.text ?? ''}`;
    lines.set(utterance.lineId, `${lines.get(utterance.lineId) ?? ''}${text}`);
  }
  return [...lines].map(([line, text]) => ({ line, text }));
}

/** Whether the floor's sentences come in more than one script, so the reading must be told each one's language. */
export function mixedScripts(utterances) {
  const seen = new Set();
  for (const utterance of Array.isArray(utterances) ? utterances : []) {
    const lang = detectLanguage(utterance.text);
    if (lang) seen.add(lang);
    if (seen.size > 1) return true;
  }
  return false;
}

// The sentences just before a batch, sent along as context only.
export function leadList(lead, speakers = null) {
  const named = speakers instanceof Map ? speakers : new Map();
  return (Array.isArray(lead) ? lead : [])
    .map(item => ({ id: item.id, ...(named.get(item.id) ? { speaker: named.get(item.id) } : {}), text: item.anchor ?? item.text }))
    .filter(item => item.text);
}

export function buildTtsAnalysisMessages(utterances, { roster = [], characterName = '', userName = '', translations = null, systemPrompt = '', styles = null, speakers = null } = {}) {
  const list = Array.isArray(utterances) ? utterances : [];
  // Reading the original: the roster holds the names as the translation spells them (樱井), the text
  // says 桜井. Each line's translation rides along so the model can name people the way the voices are
  // registered, and the rule below says so.
  const references = referenceLines(translations);
  const system = fillPrompt(String(systemPrompt ?? '').trim() || DEFAULT_TTS_PROMPTS.simple, { userName, references: references.length > 0, lang: mixedScripts(list) });
  const styleList = styleEntries(styles);
  // The names the reader set by hand travel by number; the model copies them and names the rest.
  const named = {};
  if (speakers instanceof Map) for (const [id, name] of speakers) if (name && list.some(item => item.id === id)) named[id] = name;
  const input = {
    task: 'sketch_voices_for_audiobook',
    ...(characterName ? { character: characterName } : {}),
    ...(userName ? { user: userName } : {}),
    roster: rosterList(roster),
    emotions: FISH_EMOTIONS,
    tones: FISH_TONES,
    sounds: FISH_SOUNDS,
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

/**
 * The same question as the simple reading, with last time's answer and what the reader made of it.
 *
 * The sentences sent are only the ones in scope, so fixing one line costs one short request rather
 * than another pass over the floor.
 */
export function buildRefineAnalysisMessages(utterances, { roster = [], characterName = '', userName = '', translations = null, systemPrompt = '', styles = null, current = null, feedback = '' } = {}) {
  const references = referenceLines(translations);
  const system = fillPrompt(String(systemPrompt ?? '').trim() || DEFAULT_TTS_PROMPTS.refine, { userName, references: references.length > 0 });
  const styleList = styleEntries(styles);
  const list = Array.isArray(utterances) ? utterances : [];
  const known = current instanceof Map ? current : new Map();
  const input = {
    task: 'refine_voices_for_audiobook',
    ...(characterName ? { character: characterName } : {}),
    ...(userName ? { user: userName } : {}),
    roster: rosterList(roster),
    emotions: FISH_EMOTIONS,
    tones: FISH_TONES,
    sounds: FISH_SOUNDS,
    ...(styleList.length ? { styles: styleList } : {}),
    feedback: String(feedback ?? '').slice(0, 600),
    current: list.map(item => ({ id: item.id, ...(known.get(item.id) ?? {}) })),
    utterances: list.map(item => (references.length
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
export const FISH_SOUNDS = Object.freeze(['sighing', 'gasping', 'sobbing', 'laughing', 'chuckling', 'moaning', 'groaning', 'panting', 'crying loudly', 'clear throat', 'yawning', 'crowd laughing', 'background laughter', 'audience laughing']);
// The ways of delivering a line Fish names. One optional choice, for the translation and the deep reading alike.
export const FISH_TONES = Object.freeze(['whispering', 'soft tone', 'shouting', 'screaming', 'in a hurry tone']);
// The sounds a sentence can carry, in the reader's own words, each with Fish's fixed tag for the S1
// model that only knows its set; the S2 models read the word as written. An empty tag has no S1 twin.
export const SOUND_WORDS = Object.freeze({
  轻笑: 'chuckling', 笑: 'laughing', 大笑: 'laughing', 叹气: 'sighing', 叹息: 'sighing', 喘息: 'panting', 喘气: 'panting',
  倒吸气: 'gasping', 吸气: 'gasping', 抽泣: 'sobbing', 哽咽: 'sobbing', 大哭: 'crying loudly', 咳嗽: '', 清嗓: 'clear throat',
  清嗓子: 'clear throat', 呻吟: 'moaning', 闷哼: 'groaning', 哈欠: 'yawning', 打哈欠: 'yawning', 冷哼: '', 哼: '', 吞咽: '', 深呼吸: '',
  人群笑声: 'crowd laughing', 背景笑声: 'background laughter', 观众笑声: 'audience laughing',
});
export const SOUND_TAGS = Object.freeze(Object.keys(SOUND_WORDS));

// A sound as a mark names it: one of the Chinese words, one of Fish's English tags, or any short
// Chinese word for a sound the S2 models can read as written.
function soundWord(value) {
  const raw = String(value ?? '').trim().replace(/^[[(（【]|[\])）】]$/g, '').trim();
  if (!raw) return '';
  if (Object.hasOwn(SOUND_WORDS, raw)) return raw;
  const english = cueWord(raw);
  if (english && FISH_SOUNDS.includes(english)) return english;
  return /^[\u4e00-\u9fff]{1,6}$/.test(raw) ? raw : '';
}

// The tag a sound goes out as: S1 wants Fish's own word, the S2 models take the Chinese.
function soundTagFor(tag, model) {
  if (model !== 's1') return tag;
  return Object.hasOwn(SOUND_WORDS, tag) ? SOUND_WORDS[tag] : tag;
}

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
  sighing: '叹气', gasping: '倒吸气', sobbing: '抽泣', laughing: '大笑', chuckling: '轻笑', moaning: '呻吟', groaning: '闷哼', panting: '喘气',
  'crying loudly': '大哭', 'clear throat': '清嗓子', yawning: '打哈欠', 'crowd laughing': '人群笑声', 'background laughter': '背景笑声', 'audience laughing': '观众笑声',
  pause: '停顿', 'long pause': '长停顿', break: '停顿', 'long-break': '长停顿',
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
  // The deep reading's reason for its choice: shown to the reader, never sent to the provider.
  const why = shortText(item.why ?? item.reason, 40);
  if (why) voice.why = why;
  // The reading's own words for how the sentence is said; this is what the S2 models are handed.
  const direction = shortText(item.direction ?? item.instruction, 60);
  if (direction) voice.direction = direction;
  // Only what the compiler turns into a cue or a prosody step is kept; the rest was thinking aloud.
  for (const key of ['restraint', 'tension', 'rasp', 'hesitation']) {
    const value = level(item[key]);
    if (value !== null) voice[key] = value;
  }
  if (VOICE_LEVELS.has(item.speed) && item.speed !== 'normal') voice.speed = item.speed;
  if (VOLUMES.has(item.volume) && item.volume !== 'normal') voice.volume = item.volume;
  if (BREATHS.has(item.breath) && item.breath !== 'none') voice.breath = item.breath;
  const tone = cueWord(item.tone);
  if (FISH_TONES.includes(tone)) voice.tone = tone;
  const inSentence = word => word && sentence.includes(word);
  const pauses = (Array.isArray(item.pauses) ? item.pauses : [])
    .map(pause => ({ after: shortText(pause?.after ?? pause?.word, 20), length: pause?.length === 'long' ? 'long' : 'short' }))
    .filter(pause => inSentence(pause.after))
    .slice(0, 4);
  if (pauses.length) voice.pauses = pauses;
  const stress = [...new Set((Array.isArray(item.stress) ? item.stress : [item.stress]).map(word => shortText(word, 20)).filter(inSentence))].slice(0, 3);
  if (stress.length) voice.stress = stress;
  // A turn mid-sentence: from a word on, a new direction in the reader's words, or one of Fish's moods.
  const shiftSource = Array.isArray(item.shifts) ? item.shifts : (item.shift && typeof item.shift === 'object' ? [item.shift] : []);
  const shifts = shiftSource
    .map(shift => {
      const emotion = cueWord(shift?.emotion);
      const direction = shortText(shift?.direction ?? (emotion ? '' : shift?.emotion), 40);
      const out = { at: shortText(shift?.at ?? shift?.word, 20) };
      if (direction) out.direction = direction;
      if (emotion) out.emotion = emotion;
      return out;
    })
    .filter(shift => (shift.direction || shift.emotion) && inSentence(shift.at))
    .slice(0, 3);
  if (shifts.length) voice.shifts = shifts;
  const sounds = (Array.isArray(item.sounds) ? item.sounds : [])
    .map(sound => {
      const after = shortText(sound?.after, 20);
      const at = sound?.at === 'end' ? 'end' : (after && inSentence(after)) ? 'after' : 'start';
      return { at, tag: soundWord(sound?.tag ?? sound?.sound), ...(at === 'after' ? { after } : {}) };
    })
    .filter(sound => sound.tag)
    .slice(0, 3);
  if (sounds.length) voice.sounds = sounds;
  return Object.keys(voice).length ? voice : null;
}

// The consoles as the request carries them: a name and the sentences its sliders and rules became.
export function styleEntries(styles) {
  return (Array.isArray(styles) ? styles : [])
    .map(style => ({ name: String(style?.name ?? '').trim().slice(0, 60), rules: (Array.isArray(style?.rules) ? style.rules : []).map(rule => String(rule ?? '').trim()).filter(Boolean).slice(0, 20) }))
    .filter(style => style.name && style.rules.length)
    .slice(0, 40);
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
      // The language is the one thing that does not carry over; where the name came from does.
      const { lang, ...rest } = label;
      if (Object.keys(rest).length) labels.set(utterance.id, rest);
    }
    const voice = primaryVoices instanceof Map ? primaryVoices.get(source) : null;
    if (voice) {
      const { pauses, stress, shifts, sounds, ...rest } = voice;
      const kept = (sounds ?? []).filter(sound => sound.at !== 'after');
      if (kept.length) rest.sounds = kept;
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
  if (voice.direction) lines.push(['指令', voice.direction]);
  if (voice.why) lines.push(['依据', voice.why]);
  if (voice.emotion) lines.push(['情绪', `${cueLabel(voice.emotion)}${voice.intensity !== undefined && voice.intensity !== null ? `（${LEVEL_WORDS[voice.intensity]}）` : ''}${voice.secondary ? ` · ${cueLabel(voice.secondary)}` : ''}`]);
  if (voice.tone) lines.push(['语气', cueLabel(voice.tone)]);
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
  if (voice.shifts?.length) lines.push(['句内变化', voice.shifts.map(shift => `「${shift.at}」起转${shift.direction || cueLabel(shift.emotion)}`).join('，')]);
  if (voice.sounds?.length) lines.push(['非语言声', voice.sounds.map(sound => `${sound.at === 'end' ? '句尾' : sound.at === 'after' ? `「${sound.after}」后` : '开头'}${cueLabel(sound.tag)}`).join('，')]);
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
    return {
      ...base, speaker, emotion, intensity: emotion ? normalizeIntensity(voice?.intensity ?? label.intensity) : null,
      // Where the name came from — the reader, the text, the translation or the model — and what showed it.
      speakerSource: speaker ? (label.speakerSource ?? null) : null,
      speakerEvidence: speaker && Array.isArray(label.speakerEvidence) ? [...label.speakerEvidence] : [],
    };
  });
}

/**
 * Whether a sentence is passed over instead of read.
 *
 * Narration is never muted by a character row: the narrator has a voice of their own. A line of
 * dialogue is passed over when the row for whoever says it is switched off, and — when the reader
 * set the dialogue default to 跳过 — when nobody has cast a voice for that speaker at all.
 */
export function segmentMuted(segment, { voices = [], dialogueFallback = 'default' } = {}) {
  if (!segment || segment.type !== 'dialogue') return false;
  const entry = findVoiceEntry(voices, segment.speaker);
  if (entry?.mute === true) return true;
  if (dialogueFallback !== 'skip') return false;
  return !(entry && (languageVoice(entry.voices, segment.lang) || (entry.locked !== false && entry.voiceId)));
}

/** The sentences that will actually be heard: in range, and not passed over. */
export function audibleSegments(segments, range = 'all', config = null) {
  return segmentsInRange(segments, range).filter(segment => !segmentMuted(segment, config ?? {}));
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
  const skipped = [];
  const defaulted = new Set();
  const unvoiced = new Set();
  const muted = new Set();
  for (const segment of Array.isArray(segments) ? segments : []) {
    const voiceId = resolveSegmentVoice(segment, config);
    const who = segment.type === 'narration' ? '旁白' : (segment.speaker || '未知说话人');
    // Passed over: it keeps its place in the list so the reader can see why it is silent.
    if (segmentMuted(segment, config ?? {})) {
      muted.add(who);
      skipped.push({ segment, voiceId, reason: findVoiceEntry(config?.voices, segment.speaker)?.mute === true ? 'mute' : 'fallback' });
      continue;
    }
    if (!voiceId) unvoiced.add(who);
    else if (segment.type === 'dialogue') {
      const entry = findVoiceEntry(config?.voices, segment.speaker);
      const own = entry && (languageVoice(entry.voices, segment.lang) || (entry.locked !== false && entry.voiceId));
      if (!own) defaulted.add(who);
    }
    items.push({ segment, voiceId });
  }
  return { items, skipped, muted: [...muted], defaulted: [...defaulted], unvoiced: [...unvoiced] };
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

// Fish's pause marks by model: its app writes [pause] and [long pause] for the S2 models, while S1
// knows (break) and (long-break). Whichever name a reading was stored under, each model hears its own.
const PAUSE_TAGS = Object.freeze({
  s2: Object.freeze({ break: 'pause', 'long-break': 'long pause' }),
  s1: Object.freeze({ pause: 'break', 'long pause': 'long-break' }),
});

function wrapCue(word, model) {
  if (!word) return '';
  if (model === 's1') {
    const own = PAUSE_TAGS.s1[word] ?? word;
    return S1_FIXED.has(own) ? `(${own})` : '';
  }
  return `[${PAUSE_TAGS.s2[word] ?? word}]`;
}

/**
 * One cue for a mood. A word Fish lists is used as Fish scales it; the palette's own twelve (and their
 * Chinese aliases) go through their tables; anything else is free-form natural language on S2.
 */
export function emotionCue(emotion, intensity, model = 's2-pro') {
  const word = cueWord(emotion);
  const palette = normalizeEmotion(emotion);
  // A word Fish knows is sent as itself. Anything else with a palette column takes that column. S1
  // cannot read free-form cues, so there every word outside its fixed set takes the column too, and
  // so do the palette's own twelve, whose S1 columns spell intensity the way S1 can hear it.
  const known = model === 's1' ? (S1_FIXED.has(word) && !Object.hasOwn(EMOTION_STYLES, word)) : FISH_EMOTIONS.includes(word);
  if (palette && !known) {
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

// The tag a catalogue word goes out as: Fish's own word, wrapped the way the model wants it.
function markCue(label, model) {
  const known = MARK_TAGS.find(item => item.label === label);
  return known ? wrapCue(known.tag, model) : '';
}

const CLAUSE_ENDS = /[。！？!?…\n]/;

/**
 * The reader's punctuation marks applied to one sentence's text: an inline mark replaces the run of
 * punctuation it is paired with; a head mark goes to the start of the clause that run closes. A tag
 * already standing where a mark would go is not doubled, and nothing inside an existing cue is touched.
 */
export function applyPunctuationMarks(text, marks, model = 's2-pro', { leading = '' } = {}) {
  let result = String(text ?? '');
  const list = (Array.isArray(marks) ? marks : []).filter(mark => mark?.punct && mark?.tag).slice().sort((left, right) => right.punct.length - left.punct.length);
  if (!list.length || !result) return result;
  const inCue = (value, index) => {
    const open = Math.max(value.lastIndexOf('[', index), value.lastIndexOf('(', index));
    if (open < 0) return false;
    const close = Math.max(value.lastIndexOf(']', index), value.lastIndexOf(')', index));
    return close < open;
  };
  for (const mark of list) {
    const cue = markCue(mark.tag, model);
    if (!cue) continue;
    let from = 0;
    for (let guard = 0; guard < 40; guard += 1) {
      const at = result.indexOf(mark.punct, from);
      if (at < 0) break;
      if (inCue(result, at)) { from = at + mark.punct.length; continue; }
      if (mark.at === 'head') {
        let start = at - 1;
        while (start >= 0 && !CLAUSE_ENDS.test(result[start]) && result[start] !== ']' && result[start] !== ')') start -= 1;
        start += 1;
        while (start < at && /\s/.test(result[start])) start += 1;
        const clause = result.slice(start, at);
        const before = result.slice(0, start).trimEnd();
        if (clause.includes(cue) || before.endsWith(cue) || (start === 0 && String(leading).includes(cue))) { from = at + mark.punct.length; continue; }
        result = `${result.slice(0, start)}${cue} ${result.slice(start)}`;
        from = at + cue.length + 1 + mark.punct.length;
      } else {
        const before = result.slice(0, at).trimEnd();
        if (before.endsWith(cue)) { from = at + mark.punct.length; continue; }
        const after = result.slice(at + mark.punct.length);
        result = `${result.slice(0, at).replace(/\s+$/, '')} ${cue} ${after.replace(/^\s+/, '')}`;
        from = result.length - after.replace(/^\s+/, '').length;
      }
    }
  }
  return result.replace(/\s{2,}/g, ' ').trim();
}

// A sound word as Fish lists it, whichever way the mark spelled it; an unlisted sound is dropped.
function officialSound(tag) {
  const raw = String(tag ?? '').trim();
  if (FISH_SOUNDS.includes(raw)) return raw;
  return Object.hasOwn(SOUND_WORDS, raw) && FISH_SOUNDS.includes(SOUND_WORDS[raw]) ? SOUND_WORDS[raw] : '';
}

/**
 * The simple reading's compile: one of Fish's own emotion words, the tone the text named, a sound the
 * sentence opens or ends on, and nothing else. Stacked descriptors and made-up tags are what the
 * voice stumbles on, so the sentence itself is left as written.
 */
function compileLean(voice, text, result, model) {
  const cues = [];
  // A tone the mood's own cue already carries (S1's strong anger comes with its shout) is not said twice.
  const push = cue => {
    if (cue && !cues.some(existing => existing.includes(cue))) cues.push(cue);
  };
  // The strength only moves along Fish's own scale: a word Fish lists no steps for goes out bare rather
  // than with an adverb Fish never documented.
  const word = cueWord(voice.emotion);
  const stepped = !FISH_EMOTIONS.includes(word) || Object.hasOwn(FISH_INTENSITY, word);
  push(emotionCue(voice.emotion, stepped ? voice.intensity ?? 1 : 1, model));
  if (FISH_TONES.includes(voice.tone)) push(wrapCue(voice.tone, model));
  for (const sound of voice.sounds ?? []) if (sound.at === 'start') push(wrapCue(officialSound(sound.tag), model));
  result.cues = cues.slice(0, 3);
  const insertions = [];
  const placed = new Set();
  const find = needle => {
    const index = text.indexOf(needle);
    return index >= 0 && !placed.has(`${needle}@${index}`) ? index : -1;
  };
  // Where the feeling turns inside the sentence: one of Fish's own words before the word it turns on,
  // up to three turns, so the first clause and the second are heard differently.
  for (const shift of (voice.shifts ?? []).slice(0, 3)) {
    const index = find(shift.at);
    const cue = shift.emotion ? emotionCue(shift.emotion, 1, model) : '';
    if (index < 0 || !cue) continue;
    placed.add(`${shift.at}@${index}`);
    insertions.push({ index, value: ` ${cue} ` });
  }
  // A pause is one of Fish's own marks at the word it belongs to; three at most.
  for (const pause of (voice.pauses ?? []).slice(0, 3)) {
    const index = text.indexOf(pause.after);
    const cue = wrapCue(pause.length === 'long' ? 'long-break' : 'break', model);
    if (index >= 0 && cue) insertions.push({ index: index + pause.after.length, value: ` ${cue} ` });
  }
  // A sound after a word — a sigh mid-sentence, a laugh before the rest — in Fish's own word.
  for (const sound of (voice.sounds ?? []).filter(item => item.at === 'after').slice(0, 2)) {
    const index = text.indexOf(sound.after);
    const cue = wrapCue(officialSound(sound.tag), model);
    if (index >= 0 && cue) insertions.push({ index: index + sound.after.length, value: ` ${cue} ` });
  }
  // A stressed word, for the models that know the mark.
  if (model !== 's1') {
    for (const stressed of (voice.stress ?? []).slice(0, 2)) {
      const index = text.indexOf(stressed);
      if (index >= 0) insertions.push({ index, value: ' [emphasis] ' });
    }
  }
  result.text = insertions.length ? insertAll(text, insertions).replace(/\s{2,}/g, ' ').trim() : text;
  result.tail = (voice.sounds ?? []).filter(sound => sound.at === 'end').map(sound => wrapCue(officialSound(sound.tag), model)).filter(Boolean).slice(0, 1).join('');
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
export function compileVoiceCues(segment, { model = 's2-pro', emotionCues = true, directions = true, lean = false } = {}) {
  const voice = segment?.voice ?? (segment?.emotion ? { emotion: segment.emotion, intensity: segment.intensity ?? 1 } : null);
  const text = String(segment?.text ?? '');
  const result = { cues: [], text, tail: '', speed: 'normal', volume: 'normal' };
  if (!voice) return result;
  result.speed = VOICE_LEVELS.has(voice.speed) ? voice.speed : 'normal';
  result.volume = VOLUMES.has(voice.volume) ? voice.volume : 'normal';
  if (!emotionCues) return result;
  const s1 = model === 's1';
  if (voice.direction && !s1 && directions && !lean) return compileDirection(voice, text, result);
  if (lean) return compileLean(voice, text, result, model);
  const cues = [];
  const push = cue => {
    if (cue && !cues.includes(cue)) cues.push(cue);
  };
  push(emotionCue(voice.emotion, voice.intensity ?? 1, model));
  if (voice.secondary) push(emotionCue(voice.secondary, 1, model));
  const intensity = normalizeIntensity(voice.intensity ?? 1);
  // A tone named outright beats the one the volume and tension would imply.
  let tone = FISH_TONES.includes(voice.tone) ? voice.tone : '';
  if (!tone) {
    if (voice.volume === 'quiet') tone = (voice.restraint >= 2 || voice.tension >= 2) ? 'whispering' : 'soft tone';
    else if (voice.volume === 'loud') tone = intensity === 2 && voice.tension >= 2 ? 'screaming' : 'shouting';
    else if (voice.speed === 'fast' && voice.tension >= 1) tone = 'in a hurry tone';
  }
  if (tone) push(wrapCue(tone, model));
  // A sound the sentence opens on is more audible than a descriptor, so it comes before them.
  if (voice.breath === 'panting') push(wrapCue('panting', model));
  for (const sound of voice.sounds ?? []) if (sound.at === 'start') push(wrapCue(soundTagFor(sound.tag, model), model));
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
    const cue = shift.emotion ? emotionCue(shift.emotion, 1, model) : (s1 ? '' : `[${shift.direction}]`);
    if (index >= 0 && cue) insertions.push({ index, value: ` ${cue} ` });
  }
  for (const sound of voice.sounds ?? []) {
    if (sound.at !== 'after') continue;
    const index = find(sound.after);
    const cue = wrapCue(soundTagFor(sound.tag, model), model);
    if (index >= 0 && cue) insertions.push({ index: index + sound.after.length, value: ` ${cue} ` });
  }
  result.text = insertAll(text, insertions).replace(/\s{2,}/g, ' ').trim();
  const tail = (voice.sounds ?? []).filter(sound => sound.at === 'end').map(sound => wrapCue(soundTagFor(sound.tag, model), model)).filter(Boolean);
  result.tail = tail.join('');
  return result;
}

/**
 * The reading's own words, as the S2 models read them: the direction up front, a sound the sentence
 * opens on, then the pauses, stresses, turns and sounds at the words they belong to, and a sound at
 * the end. The words of the sentence never change.
 */
function compileDirection(voice, text, result) {
  const cues = [`[${voice.direction}]`];
  for (const sound of voice.sounds ?? []) if (sound.at === 'start' && !cues.includes(`[${sound.tag}]`)) cues.push(`[${sound.tag}]`);
  result.cues = cues.slice(0, 3);
  const insertions = [];
  const find = word => (word ? text.indexOf(word) : -1);
  const afterWord = (index, word) => index + word.length + (text.slice(index + word.length).match(/^[s，。、；：！？…—～~,.;:!?]*/)?.[0].length ?? 0);
  for (const pause of voice.pauses ?? []) {
    const index = find(pause.after);
    if (index >= 0) insertions.push({ index: afterWord(index, pause.after), value: ` [${pause.length === 'long' ? '长停顿' : '停顿'}] ` });
  }
  for (const word of voice.stress ?? []) {
    const index = find(word);
    if (index >= 0) insertions.push({ index, value: ' [重读] ' });
  }
  for (const shift of voice.shifts ?? []) {
    const index = find(shift.at);
    const cue = shift.direction || cueLabel(shift.emotion);
    if (index >= 0 && cue) insertions.push({ index, value: ` [${cue}] ` });
  }
  for (const sound of voice.sounds ?? []) {
    if (sound.at !== 'after') continue;
    const index = find(sound.after);
    if (index >= 0) insertions.push({ index: afterWord(index, sound.after), value: ` [${sound.tag}] ` });
  }
  result.text = insertAll(text, insertions).replace(/\s{2,}/g, ' ').trim();
  result.tail = (voice.sounds ?? []).filter(sound => sound.at === 'end').map(sound => `[${sound.tag}]`).join('');
  return result;
}

// What each slider demands at each end, in terms of the fields the model fills in: the outer bands
// speak in numbers (how many sentences, which value), so a slider pushed far out is a rule the model
// can be checked against rather than a mood it may weigh. Every word named here is one Fish knows.
const CONSOLE_BANDS = Object.freeze({
  pause: [
    '几乎不停顿：pauses 一律不写。',
    '停顿少：pauses 只在真正哽住、话说一半的地方写，整楼两三处以内。',
    '停顿感强：犹豫、转折、话没说完的地方写 pauses，允许 long，每三四句对白至少一处。',
    '停顿感很强：几乎每句对白都找一处该停的地方写 pauses，转折和哽咽用 long。',
  ],
  breath: [
    '不要呼吸声：sounds 里不写 gasping、panting、sighing。',
    '呼吸声少：只有原文明写了喘、叹气才在 sounds 里写。',
    '呼吸感明显：紧张、害羞、疲惫、犹豫的句子在句首加 gasping、panting 或 sighing 这类 sounds，不要每句都加。',
    '呼吸感很重：情绪起伏的句子大多在句首或句尾带 sighing、gasping、panting 这类 sounds。',
  ],
  grain: [
    '说话顺畅利落：不写表示迟疑的 pauses，不用 soft tone。',
    '口语毛边少：迟疑的短停顿只在明显吞吞吐吐的地方写。',
    '口语颗粒度高：迟疑、重复、支支吾吾的地方用 short pauses 表现，小声嘀咕的句子给 soft tone。',
    '口语颗粒度很高：真人说话的毛边要多，迟疑处普遍写 short pauses，含糊小声的句子写 soft tone 或 whispering。',
  ],
  intensity: [
    '情感强度极低：intensity 一律写 0，情绪词选克制的（calm、gentle、indifferent 这类），不要 hysterical 这类爆发词。',
    '情感强度低：intensity 多写 0，最高 1；情绪词选含蓄的。',
    '情感强度高：对白句都要给 emotion，不要省略；intensity 多写 1 和 2，明显的情绪句写 2。',
    '情感强度很高：对白句全部给 emotion，一半以上写 intensity 2，允许 hysterical、excited、scared 这类强烈的词。',
  ],
  range: [
    '情绪幅度极小：整楼情绪平稳，相邻句子的情绪词尽量一致，不写 shouting、screaming 这类 tone。',
    '情绪幅度小：整体平稳，情绪词少换，intensity 不跳变。',
    '情绪幅度大：情绪跟着句意起伏，相邻句子可以从平静跳到激动，intensity 可以 0 到 2 跳变。',
    '情绪幅度很大：激动处写 shouting，压抑处写 whispering，intensity 大起大落。',
  ],
  speed: [
    '语速很慢：对白句多写 speed: slow，不写 fast。',
    '语速偏慢：多用 slow，很少用 fast。',
    '语速偏快：多用 fast，急的时候更要写。',
    '语速很快：对白句多写 speed: fast，不写 slow，急促的句子加 in a hurry tone。',
  ],
  expression: [
    '不要非语言声音：sounds 一律不写。',
    '声音表现克制：sounds 只在原文明写了笑、叹气、咳嗽时写。',
    '声音表现外放：合适的地方写 sounds（笑声、叹气、喘息、清嗓子），每三四句对白至少一处，要贴合当下的情绪。',
    '声音表现很外放：大多数带情绪的对白句都配一个 sounds，笑就 laughing 或 chuckling，难过就 sobbing 或 sighing，一句最多一个。',
  ],
});

/**
 * A console as rules a model can be held to. Sliders near the middle say nothing; the outer bands
 * speak, and the further out, the more they demand; the reader's own rules ride along as written.
 * The numbers themselves never go out.
 */
export function consoleDirections(console) {
  if (!console || typeof console !== 'object') return [];
  const lines = [];
  for (const [key, bands] of Object.entries(CONSOLE_BANDS)) {
    const value = Number(console[key]);
    if (!Number.isFinite(value)) continue;
    if (value <= 15) lines.push(bands[0]);
    else if (value <= 35) lines.push(bands[1]);
    else if (value >= 85) lines.push(bands[3]);
    else if (value >= 65) lines.push(bands[2]);
  }
  for (const rule of String(console.rules ?? '').split('\n').map(line => line.trim()).filter(Boolean).slice(0, 12)) lines.push(rule.slice(0, 120));
  return lines;
}

/** The text one sentence sends: the reader's own version when there is one, else the compiled voice. */
export function sentenceFishText(item, fish, { emotionCues = true, tamePunctuation = false, directions = true, lean = false } = {}) {
  const override = item?.override;
  if (override && typeof override.text === 'string' && override.text.trim()) return override.text.trim();
  const compiled = compileVoiceCues(item.segment, { model: fish?.model, emotionCues, directions, lean });
  const head = compiled.cues.join('');
  // The reader's punctuation marks go in before the runs are tamed, so a rule for 「！！」 still sees them.
  const marked = applyPunctuationMarks(compiled.text, item?.console?.marks, fish?.model, { leading: head });
  const text = tamePunctuation ? tamePunctuationMarks(marked) : marked;
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
  // The character's speed lean, from the console: a small nudge that only applies where the voice
  // itself said nothing about speed.
  const lean = Number(item?.console?.speed);
  const factor = Number.isFinite(lean) && lean !== 50 ? 1 + ((lean - 50) / 50) * 0.25 : 1;
  const override = item?.override;
  const speedOverride = Number(override?.speed);
  const volumeOverride = Number(override?.volume);
  if (override && (Number.isFinite(speedOverride) || Number.isFinite(volumeOverride))) {
    return {
      speed: Number(Math.min(2, Math.max(0.5, Number.isFinite(speedOverride) ? speedOverride : base.speed)).toFixed(2)),
      volume: Number(Math.min(20, Math.max(-20, Number.isFinite(volumeOverride) ? volumeOverride : base.volume)).toFixed(1)),
    };
  }
  if (!prosodySplit) return { speed: Number(Math.min(2, Math.max(0.5, base.speed * factor)).toFixed(2)), volume: base.volume };
  const compiled = compileVoiceCues(item.segment, { model: fish?.model, emotionCues: false });
  return {
    speed: Number(Math.min(2, Math.max(0.5, base.speed * SPEED_STEPS[compiled.speed] * (compiled.speed === 'normal' ? factor : 1))).toFixed(2)),
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
export function buildFishPayload(items, fish, { emotionCues = true, prosodySplit = true, tamePunctuation = false, directions = true, lean = false } = {}) {
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
    const sentence = sentenceFishText(item, fish, { emotionCues, tamePunctuation, directions, lean });
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

// ---------------------------------------------------------------------------------------------
// The provider boundary.
//
// Everything above this line speaks in the reading's own terms: a segment has a speaker, a language,
// a mood at a strength, a tone, a speed, a volume, pauses, stresses and sounds. An adapter turns that
// into one provider's request and back, and nothing above it needs to know the provider's markup or
// its parameter names. Fish is the only adapter today; another provider is another object of this
// shape, registered under its own id, and the speaker engine, the analysis and the cache are none
// the wiser.
// ---------------------------------------------------------------------------------------------

/** How the reading's marks are compiled for this provider under these settings. */
function fishCompileOptions(tts) {
  return {
    emotionCues: tts?.emotionCues !== false,
    prosodySplit: tts?.prosodySplit !== false,
    tamePunctuation: tts?.tamePunctuation === true,
    // Every reading speaks in Fish's own words now, the deep one included; a stored free-text
    // direction from an older deep reading is passed over for its mood.
    directions: false,
    lean: true,
  };
}

export const FISH_ADAPTER = Object.freeze({
  id: 'fish',
  label: 'Fish Audio',
  /** The words the analysis may use for a mood, a tone and a sound: the ones this provider hears. */
  vocabulary: Object.freeze({ emotions: FISH_EMOTIONS, tones: FISH_TONES, sounds: FISH_SOUNDS }),
  /** The text one sentence sends: its cues in the provider's markup ahead of the words. */
  sentenceText: (item, tts) => sentenceFishText(item, tts.fish, fishCompileOptions(tts)),
  /** The provider's prosody parameters for one sentence. */
  prosody: (item, tts) => sentenceProsody(item, tts.fish, { prosodySplit: tts?.prosodySplit !== false }),
  /** A unit's items cut into requests. */
  parts: (items, tts) => planFishParts(items, { model: tts.fish.model, maxChars: tts.fish.maxChars, prosodySplit: tts?.prosodySplit !== false }),
  /** One request's body, with the span each sentence occupies in its text. */
  payload: (items, tts) => buildFishPayload(items, tts.fish, fishCompileOptions(tts)),
  /** Everything in the settings that changes the audio, so a change retires the recordings. */
  fingerprint: (tts, { consoles = '' } = {}) => fishFingerprint(tts.fish, { ...fishCompileOptions(tts), mode: tts.mode, consoles }),
  mime: format => FISH_MIME[format] ?? 'audio/mpeg',
  supportsMultiSpeaker: model => fishSupportsMultiSpeaker(model),
});

const PROVIDERS = new Map([[FISH_ADAPTER.id, FISH_ADAPTER]]);

/** The adapter for a provider id; an unknown id reads through Fish, the one every setting was made for. */
export function ttsProvider(id = 'fish') {
  return PROVIDERS.get(String(id ?? '')) ?? FISH_ADAPTER;
}

/** Another provider, made known under its id. Its adapter must offer what Fish's offers. */
export function registerTtsProvider(adapter) {
  for (const key of ['id', 'vocabulary', 'sentenceText', 'prosody', 'parts', 'payload', 'fingerprint', 'mime']) {
    if (!adapter || adapter[key] === undefined) throw new Error(`provider adapter is missing ${key}`);
  }
  PROVIDERS.set(adapter.id, adapter);
  return adapter;
}

/**
 * Which host page the reader is running in. TauriTavern serves the same SillyTavern frontend from a
 * Rust backend that answers only its own /api routes; the /proxy route of the Node server does not
 * exist there, so a Fish call has to go direct.
 */
export function detectTtsHost(scope = globalThis) {
  return scope?.__TAURITAVERN__ || scope?.__TAURITAVERN_MAIN_READY__ ? 'tauritavern' : 'sillytavern';
}

export function fishGoesDirect(fish, host = 'sillytavern') {
  return fish?.viaProxy === false || host === 'tauritavern';
}

export function fishEndpoint(fish, path, { host = 'sillytavern' } = {}) {
  const base = String(fish?.baseUrl || 'https://api.fish.audio').replace(/\/+$/, '');
  const target = `${base}${path}`;
  // The host's proxy takes the full target URL as its path.
  return fishGoesDirect(fish, host) ? target : `/proxy/${target}`;
}

/**
 * Request headers for one Fish call.
 *
 * Through the proxy the host's own headers go along: the CSRF token is what lets a disabled proxy answer
 * with its own explanation instead of a bare 403, and the proxy strips it before forwarding. A direct
 * call never carries the host's session token to a third party.
 */
export function fishHeaders(fish, hostHeaders = {}, { host = 'sillytavern' } = {}) {
  const base = fishGoesDirect(fish, host) ? {} : { ...hostHeaders };
  return {
    ...base,
    'Content-Type': 'application/json',
    Authorization: `Bearer ${fish?.key ?? ''}`,
    model: fish?.model ?? 's2-pro',
  };
}

export function describeFishFailure({ status = 0, body = '', viaProxy = true, network = false, host = 'sillytavern' } = {}) {
  if (network && host === 'tauritavern') {
    return 'TauriTavern 里没有酒馆那条 CORS 代理，api.fish.audio 又不让网页直接访问，所以请求发不出去。在「接口地址」填一个自己的、带跨域头的转发地址（使用手册里有现成的 Cloudflare Worker 脚本），或者等 TauriTavern 加上通用代理。config.yaml 那一步在 TauriTavern 里不存在，不用做。';
  }
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
  if (upstream === 429) return 'Fish 限流了，请求太频繁。等一会儿再试，免费档的限制更紧；「声音参数」里的「同时生成几段」调回 1 也会好一些。';
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

export function fishFingerprint(fish, { emotionCues = true, prosodySplit = true, tamePunctuation = false, mode = '', consoles = '' } = {}) {
  return {
    provider: 'fish',
    // The reading mode and the consoles change the text and the prosody, so they retire recordings too.
    mode,
    consoles,
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
      segment.voice ?? null, override ?? null, segment.lang ?? null,
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

/**
 * What one sentence's audio is made of, as one string: the words, who says them, in which language,
 * in which voice, in what mood and how strongly, with whatever the reader wrote over it. Two items
 * with the same identity may share a recording; two that differ in any of it never do — the voice
 * that reads a name is looked up when the audio is made, so a name bound to a new voice is a new
 * identity, and the take made in the old voice is never heard in its place.
 */
export function itemIdentity(item) {
  const segment = item?.segment ?? {};
  const override = item?.override ?? null;
  return JSON.stringify([
    segment.type ?? null, segment.text ?? '', segment.speaker ?? null, segment.lang ?? null,
    segment.emotion ?? null, segment.intensity ?? null, item?.voiceId ?? '', segment.voice ?? null,
    override ? [override.text ?? null, override.speed ?? null, override.volume ?? null] : null,
  ]);
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
      identity: item ? itemIdentity(item) : '',
    };
  });
}

/**
 * The entry in one of `records` that already holds this sentence, newest first. With an identity to
 * match, the entry must have been made of the same everything; a recording from before identities
 * were kept is matched by its words and voice alone, as it always was.
 */
export function findCoveringEntry(records, { text, voiceId, fingerprint, identity = null }) {
  const list = (Array.isArray(records) ? records : []).filter(record => Array.isArray(record?.timeline) && record.fingerprint === fingerprint);
  list.sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  for (const record of list) {
    const index = record.timeline.findIndex(entry => entry.text === text && (entry.voiceId ?? '') === (voiceId ?? '') && !entry.edited
      && (identity === null || entry.identity === undefined || entry.identity === identity));
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

/**
 * Samples as a wav file: 16-bit PCM with one header. What a slice of decoded audio is saved as,
 * whatever the format it was decoded from, since cutting mp3 or Ogg at an arbitrary moment does not
 * give a file that plays.
 */
export function encodeWav(channels, sampleRate = 44100) {
  const list = (Array.isArray(channels) ? channels : []).filter(channel => channel && typeof channel.length === 'number');
  const count = Math.max(1, list.length);
  const frames = list[0]?.length ?? 0;
  const bytes = new Uint8Array(44 + frames * count * 2);
  const view = new DataView(bytes.buffer);
  const write = (offset, text) => { for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index); };
  write(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, frames * count * 2, true);
  let at = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < count; channel += 1) {
      const sample = Math.max(-1, Math.min(1, list[channel]?.[frame] ?? 0));
      view.setInt16(at, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      at += 2;
    }
  }
  return bytes;
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

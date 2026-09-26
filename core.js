import {
  CORE_TRANSLATION_SPEC,
  DEFAULT_PROMPT_PROFILE,
  KNOWN_DEFAULT_CHECKLIST_PROMPTS,
  KNOWN_DEFAULT_CORE_PROMPTS,
  LEGACY_DEFAULT_TRANSLATION_PROMPT,
  PRE_OUTPUT_CHECKLIST,
  normalizeTargetLanguage,
  STYLE_PRESETS,
  LEANING_PRESETS,
} from './prompts.js?v=0.38.0';
// The same judgement the reading applies everywhere else a line is heard (tts.js's plainLineText):
// struck-through and redacted content dropped with its words, so a segment carries it for the
// translation to see — that stays in `text`, unaffected — while what the floor's own words are read
// with, `speech`/`reading`, never says a word neither the floor nor its reader is meant to hear.
import { dropHiddenMarkup } from './tts-sanitizer.js?v=0.38.0';
// A move's colour is recomputed against the current band on restyle (`restyleBilingual` below), the
// same maths index.js `moveStyleFor` used to paint it the first time.
import { resolveMoveStyle } from './palette.js?v=0.38.0';

export const MODULE_ID = 'jingyi-translator';
export const APP_NAME = '镜译 · 正文翻译器';
export const APP_VERSION = '0.38.0';
// How a floor's own segmentation rules read: 1 is v0.36.0 and older (a <br> mid-line glues its words,
// a <say> shell or a custom preserve rule's indentation is matched literally). 2 adds the v0.36.1
// built-in-regex fixes. 3 adds v0.40.0's 「音乐卡片」 tightening: a run of <br> rows is only treated as a
// card when it actually shows one of the three documented signals, a kana-holding parenthesis no longer
// counts as an already-bilingual row, and a card's first row starts its own unit apart from whatever
// narration precedes it. A floor already translated keeps whichever rules produced what is stored on
// it — recorded on its metadata as `segmentation_version` — so re-deriving its segments for matching
// never disagrees with what was actually written; a floor with no record yet always starts on the
// latest rules. See segmentSource's `segmentationVersion` option.
export const SEGMENTATION_RULES_VERSION = 3;
export const MESSAGE_META_KEY = 'jingyi_translation';
export const INVISIBLE_MARKER = '\u2063';
// These boundaries belong to MirrorTranslate; visible affixes never identify a block.
export const SOURCE_START = '\u2063\u2060\u2063';
export const SOURCE_END = '\u2063\u2061\u2063';
export const TRANSLATION_START = '\u2063\u2062\u2063';
export const TRANSLATION_END = '\u2063\u2064\u2063';
export const AFFIX_START = '\u2063\u200b\u2063';
export const AFFIX_END = '\u2063\u200c\u2063';
// Replace-tag regions keep the original inside a hidden block: prompts drop it, display hides it,
// and re-translation restores it, so the swap is reversible without touching swipes.
export const HIDDEN_START = '\u2063\u200d\u2063';
export const HIDDEN_END = '\u2063\ufeff\u2063';

/**
 * Which segmentation rules a floor's own metadata actually speaks for. `metadata` alone is not enough:
 * the host starts a freshly generated swipe with a *copy* of the previous swipe's `extra` (see readFloor
 * above), so a floor nothing has ever translated can still carry a `segmentation_version` that describes
 * someone else's text entirely. Trusting it there would lock a brand new reply onto whatever rules
 * produced a different swipe, forever — `writeTranslation` copies whatever this returns straight onto
 * the record it writes next.
 *
 * `text` is read for the boundaries a write of this extension's own leaves inside the floor itself
 * (SOURCE_START/TRANSLATION_START/HIDDEN_START, and the legacy brace marker) — proof this exact text,
 * not a copied record, was actually written to. `stripped` (a 只留译文 floor) is exempt: readFloor's own
 * fingerprint or carriesTranslation already matched this metadata to this text by content, not by the
 * swipe's copied `extra`, so nothing more needs proving here.
 */
export function resolveSegmentationVersion(text, metadata, { stripped = false } = {}) {
  if (!metadata) return SEGMENTATION_RULES_VERSION;
  const source = String(text ?? '');
  const carries = stripped || [SOURCE_START, TRANSLATION_START, HIDDEN_START, `{${INVISIBLE_MARKER}`].some(marker => source.includes(marker));
  return carries ? (Number(metadata.segmentation_version) || 1) : SEGMENTATION_RULES_VERSION;
}

const SOURCE_BLOCK_RE = new RegExp(`${SOURCE_START}([\\s\\S]*?)${SOURCE_END}`, 'g');
const TRANSLATION_BLOCK_RE = new RegExp(`\\n?${TRANSLATION_START}([\\s\\S]*?)${TRANSLATION_END}`, 'g');
const AFFIX_RE = new RegExp(`${AFFIX_START}[\\s\\S]*?${AFFIX_END}`, 'g');
const HIDDEN_BLOCK_RE = new RegExp(`\\n?${HIDDEN_START}[\\s\\S]*?${HIDDEN_END}`, 'g');
// Tempered patterns: the pair's translation payload may not cross a boundary, so a bilingual
// source block can never falsely pair up with a later replace pair's hidden original.
const REPLACE_PAIR_RE = new RegExp(`${SOURCE_START}(?:(?!${SOURCE_START}|${SOURCE_END})[\\s\\S])*?${SOURCE_END}\\n?${HIDDEN_START}([\\s\\S]*?)${HIDDEN_END}`, 'g');
// Both halves at once. Pairing 补译 seeds by the hidden original keeps a partly translated floor from
// handing an untranslated segment the translation that belongs to the next one.
const REPLACE_PAIR_BOTH_RE = new RegExp(`${SOURCE_START}((?:(?!${SOURCE_END})[\\s\\S])*)${SOURCE_END}\\n?${HIDDEN_START}((?:(?!${HIDDEN_END})[\\s\\S])*)${HIDDEN_END}`, 'g');

const GENERATED_BLOCK_RE = new RegExp(`(?:^|\\n)\\{${INVISIBLE_MARKER}([\\s\\S]*?)${INVISIBLE_MARKER}\\}[ \\t]*(?=\\n|$)`, 'g');
const LEGACY_GENERATED_LINE_RE = new RegExp(`^\\{${INVISIBLE_MARKER}[^\\r\\n]*\\}[ \\t]*$`);
// The wrapper speaker/emotion styling is rendered into. Kept here so the restyle pass can recognise
// and carry over a wrapper it did not generate.
export const SPEAKER_CLASS = 'jy-spk';
// Speech marks, and the narration that surrounds them.
//
// Speaker colour used to run across a whole line, so a line like 「あ、そう」と呟き、通話を切った
// wore one speaker's colour over its narration as well. The narration belongs to the narrator no
// matter who is quoted inside it, so the colour has to stop at these boundaries.
const SPEECH_OPENERS = new Map([
  ['「', '」'],
  ['『', '』'],
  ['“', '”'],
  ['"', '"'],
]);
// A whole line wrapped in exactly one speaker mark, its story-side shell rather than anything
// carryable — <say who="樱井" mood="开心">…</say>. Used to look past the mark to whatever it wraps: the
// words a preserve rule tests, the formatting a translation carries. The inner group excludes another
// <say>/</say>, so a line where two people speak — two marks run together with nothing between them —
// is not mistaken for one shell around both; that stays unmatched, for the ordinary handling. A
// self-closing mark is not this shell either; it names the run after it rather than enclosing one.
const SAY_SHELL_RE = /^<say(?=[\s/>])[^<>]*>((?:(?!<\/?say(?=[\s/>]))[\s\S])*)<\/say>$/i;

/**
 * Splits a translated line into quoted and unquoted runs.
 *
 * An unterminated quote is reported as narration rather than guessed at: painting a run that was
 * never closed would spill the speaker's colour over the rest of the line, which is the very thing
 * this exists to stop.
 */
// Speech is announced: a colon, a comma or a full stop before the opening quote, a verb of speech
// before it, a quotative と after it in Japanese, or a sentence of its own inside. A short quote with
// none of these and a word right before it is a phrase set off inside the sentence around it.
const QUOTE_SPEECH_VERB_TAIL = /(?:说|讲|问|答|喊|叫|吼|嚷|骂|念|唱|道|应|写|读|喃|咕|囔|哝|语|声|句|话|口|曰|云|言|想|回|叹|笑|哼|嗯|着|地)\s*$|(?<![\p{L}\p{N}-])(?:said|says|say|asked|asks|replied|answered|shouted|whispered|called|cried|added|muttered|murmured|repeated|announced|wrote|reads?|goes|went|like)\s*$/iu;
const QUOTE_INNER_SENTENCE = /[。！？!?…；;]/u;
const QUOTE_JA_QUOTATIVE = /^\s*(?:と|って)(?!いう|よば|呼ば|称|書か|書い)/u;

/**
 * Whether a quoted run is a phrase inside its sentence rather than something said: short, with no
 * sentence of its own inside, a word (not punctuation, not a verb of speech) right before it, and
 * no quotative particle after it.
 */
export function isEmbeddedQuote(inner, before = '', after = '') {
  const text = String(inner ?? '').trim();
  if (!text || [...text].length > 12 || QUOTE_INNER_SENTENCE.test(text)) return false;
  const lead = String(before ?? '').replace(/\s+$/u, '');
  const tail = String(after ?? '').replace(/^\s+/u, '');
  const beforeChar = lead.slice(-1);
  if (!beforeChar || !/[\p{L}\p{N}]/u.test(beforeChar)) return false;
  if (QUOTE_SPEECH_VERB_TAIL.test(lead)) return false;
  if (QUOTE_JA_QUOTATIVE.test(tail)) return false;
  return true;
}

/**
 * The parts of one line with its embedded quotes folded back into the narration around them.
 *
 * Parts carry `text` and either `spoken` or `kind` ('quoted' / 'narration' / 'skipped'); `innerOf`
 * strips a quoted part's marks. Only narration merges; a skipped run stands between its neighbours.
 */
export function foldEmbeddedQuotes(parts, innerOf = text => text.slice(1, -1)) {
  const list = Array.isArray(parts) ? parts : [];
  const isNarration = part => (part.kind ? part.kind === 'narration' : !part.spoken);
  const isQuoted = part => (part.kind ? part.kind === 'quoted' : Boolean(part.spoken));
  const folded = [];
  list.forEach((part, index) => {
    let piece = part;
    if (isQuoted(part)) {
      const before = list[index - 1] && isNarration(list[index - 1]) ? list[index - 1].text : '';
      const after = list[index + 1] && isNarration(list[index + 1]) ? list[index + 1].text : '';
      if (!isEmbeddedQuote(innerOf(part.text), before, after)) {
        folded.push({ ...part });
        return;
      }
      piece = { ...part, spoken: false, ...(part.kind ? { kind: 'narration' } : {}) };
    }
    const last = folded.at(-1);
    if (isNarration(piece) && last && isNarration(last)) last.text += piece.text;
    else folded.push({ ...piece });
  });
  return folded;
}

export function splitSpeechParts(value) {
  const source = String(value ?? '');
  const parts = [];
  let buffer = '';
  let closer = '';
  let depth = 0;
  const flush = spoken => {
    if (buffer) parts.push({ text: buffer, spoken });
    buffer = '';
  };
  for (const character of source) {
    if (!closer) {
      const pair = SPEECH_OPENERS.get(character);
      if (pair) {
        flush(false);
        buffer = character;
        closer = pair;
        depth = 1;
        continue;
      }
      buffer += character;
      continue;
    }
    buffer += character;
    if (character === closer) {
      depth -= 1;
      if (!depth) {
        flush(true);
        closer = '';
      }
    } else if (SPEECH_OPENERS.get(character) === closer) {
      depth += 1;
    }
  }
  flush(false);
  return foldEmbeddedQuotes(parts);
}

/**
 * How a unit of translated lines carries speech: all of it quoted, none of it, or a mix.
 *
 * 'narration' is the case the reader complained about twice over — a line with no quoted span at
 * all should not wear anybody's colour.
 */
export function describeSpeechShape(texts) {
  const lines = (Array.isArray(texts) ? texts : [texts]).map(item => String(item ?? ''));
  let spoken = 0;
  let narrated = 0;
  for (const line of lines) {
    for (const part of splitSpeechParts(line)) {
      if (part.spoken) spoken += 1;
      else if (part.text.trim()) narrated += 1;
    }
  }
  if (!spoken) return 'narration';
  return narrated ? 'mixed' : 'spoken';
}

// Letters and digits alone, so the few characters a mark quotes find their run whatever the quotes,
// the spacing or the width of the punctuation around them.
const QUOTE_KEY_KEEP = /[\p{L}\p{N}\p{M}]/u;

function quoteKey(text) {
  let key = '';
  for (const character of String(text ?? '').normalize('NFKC').toLowerCase()) if (QUOTE_KEY_KEEP.test(character)) key += character;
  return key;
}

/**
 * The mark each quoted run of one line stands under, in the order the runs stand.
 *
 * A line's mark names who opens it; its `quotes` name each run, with the first few characters of the
 * run to place it by. A run is placed by those characters first, then by order when the counts agree,
 * with or without the quotes marked as narration. A run left without a mark, or with one that names
 * nobody, is the line's speaker's, unless the runs already placed show more than one person, or nothing
 * was placed and the quotes name more than one: then nobody knows whose it is, and a wrong name costs
 * more than none. A run left without a mark is said the way the line is, whoever opens it: it takes the
 * whole mark, and whoever reads a word-anchored field checks it against the run's own words. When no
 * quote names a mood, a run of the line's own speaker takes the line's mood and strength. The line's
 * sounds belong to one moment, so a run takes them only when it is the line's only run. A run marked as
 * narration (a sign, a title) stays nobody's.
 *
 * `runs` are the runs' texts; `key` reduces a text to what is compared, and the colouring and the
 * reading each pass their own. Returns one mark or null per run.
 */
export function placeQuoteMarks(runs, mark, key = quoteKey) {
  const list = Array.isArray(runs) ? runs : [];
  if (!list.length || !mark || typeof mark !== 'object') return list.map(() => null);
  const quotes = (Array.isArray(mark.quotes) ? mark.quotes : []).filter(quote => quote && typeof quote === 'object');
  const keys = list.map(text => key(text));
  const placed = list.map(() => null);
  const pending = [];
  for (const quote of quotes) {
    const head = key(quote.head ?? '');
    const found = head ? keys.findIndex((runKey, index) => !placed[index] && runKey.startsWith(head)) : -1;
    if (found >= 0) placed[found] = quote;
    else pending.push(quote);
  }
  const told = own => own?.type === 'narration';
  const spoken = quotes.filter(quote => !told(quote));
  // By order when the counts agree. A sign or a title the translation counted may be one the other
  // language folded into its narration (看板の「立入禁止」を), so the count without those is tried too.
  const byOrder = quotes.length === list.length ? pending
    : spoken.length === list.length ? pending.filter(quote => !told(quote)) : null;
  if (byOrder) {
    const rest = placed.map((own, index) => (own ? -1 : index)).filter(index => index >= 0);
    byOrder.forEach((quote, offset) => {
      if (rest[offset] !== undefined) placed[rest[offset]] = quote;
    });
  }
  const { quotes: _quotes, ...line } = mark;
  if (list.length === 1) return [placed[0] ? (told(placed[0]) ? { ...placed[0] } : { ...line, ...placed[0] }) : line];
  const lineSpeaker = String(line.speaker ?? '');
  const named = new Set(placed.map(own => own?.speaker).filter(Boolean));
  // Nothing placed while the quotes name more than one person is as unknown as two people placed.
  const quoted = new Set(spoken.map(quote => quote.speaker).filter(Boolean));
  const ambiguous = (lineSpeaker ? named.has(lineSpeaker) && named.size > 1 : named.size > 1)
    || (!placed.some(Boolean) && quoted.size > 1);
  // A line that names nobody still says how it is said.
  const { sounds: _sounds, ...fields } = line;
  const stand = ambiguous || !Object.keys(fields).length ? null : fields;
  // The line's mood is its first speaker's. Where no quote names a mood of its own, the mood was written
  // on the line alone, and a run the mark gives that same person, or nobody where that is safe, is said
  // in it. A quote left without one beside quotes that name theirs was left so on purpose. The line's
  // tone, a whisper or a shout, is one moment's and stays there.
  const moodOnLine = Boolean(line.emotion) && !spoken.some(quote => quote.emotion);
  return placed.map(own => {
    if (!own) return stand ? { ...stand } : null;
    if (told(own)) return own;
    const same = moodOnLine && (own.speaker ? own.speaker === lineSpeaker : Boolean(stand));
    const how = same ? { emotion: line.emotion, ...(line.intensity !== undefined ? { intensity: line.intensity } : {}) } : {};
    const merged = { ...how, ...own };
    return merged.speaker || !stand?.speaker ? merged : { ...merged, speaker: stand.speaker };
  });
}

// Titles a model bolts onto a name even when told to copy the roster verbatim. Stripping only ever
// serves to find a name that is already known, so a real name that happens to end in one of these is
// never cut down on its own.
const SPEAKER_TITLE_TAIL = /(?:さん|ちゃん|くん|さま|様|殿|先輩|酱|醬|君|桑|大人|殿下|陛下|夫人|小姐|少爷|少爺|老师|老師|先生|前辈|前輩|学姐|学长|學姊|學長|哥哥|姐姐)$/u;
const SPEAKER_NAME_SEPARATOR = /[\u00B7\u30FB\u2022\uFF65=\uFF1D\s]+/u;
const HAN_ONLY = /^\p{Script=Han}+$/u;

function speakerNameParts(name) {
  return String(name ?? '').split(SPEAKER_NAME_SEPARATOR).filter(Boolean);
}

function uniqueSpeakerNames(values) {
  return [...new Set([...(values ?? [])].map(value => String(value ?? '').trim()).filter(Boolean))];
}

function matchKnownSpeaker(name, known) {
  if (known.includes(name)) return name;
  const bare = name.replace(SPEAKER_TITLE_TAIL, '').trim();
  if (bare && bare !== name && known.includes(bare)) return bare;
  const target = bare || name;
  // A full name for a registered short one: 艾莉丝·伯雷亚斯·格雷拉特 → 艾莉丝.
  const parts = speakerNameParts(target);
  if (parts.length > 1) {
    const hits = known.filter(candidate => parts.includes(candidate));
    if (hits.length === 1) return hits[0];
  }
  // A short name for a registered full one: 菲利普 → 菲利普·伯雷亚斯·格雷拉特. A shared family name
  // matches several people and so matches nobody.
  const wider = known.filter(candidate => {
    const pieces = speakerNameParts(candidate);
    return pieces.length > 1 && pieces.includes(target);
  });
  if (wider.length === 1) return wider[0];
  // A bare given name for a registered family-and-given one with no separator to show the seam:
  // 律 → 源律. Only in this direction; a longer unknown name that ends in a registered short one is
  // as likely to be somebody else.
  if (HAN_ONLY.test(target)) {
    const hits = known.filter(candidate => HAN_ONLY.test(candidate)
      && candidate.length > target.length
      && candidate.length - target.length <= 2
      && candidate.endsWith(target));
    if (hits.length === 1) return hits[0];
  }
  return null;
}

/**
 * Maps each speaker name a model reported onto the name the palette knows that person by.
 *
 * A closed roster says "copy these names verbatim", and a small model still answers 希尔达夫人,
 * 艾莉丝·伯雷亚斯·格雷拉特 or 律 for 源律. Each spelling used to resolve on its own: one person in
 * three colours, or in none. Registered and previously seen names win first; whatever is still loose is
 * then unified with the shorter names reported beside it, so one floor never splits a character in two.
 * Anything ambiguous is left exactly as the model wrote it.
 */
export function unifySpeakerNames(reported, knownNames = []) {
  const known = uniqueSpeakerNames(knownNames);
  const mapping = new Map();
  for (const name of uniqueSpeakerNames(reported)) mapping.set(name, matchKnownSpeaker(name, known) ?? name);
  const loose = [...new Set(mapping.values())].filter(name => !known.includes(name));
  for (const [name, current] of mapping) {
    if (known.includes(current)) continue;
    const shorter = loose.filter(other => other !== current && other.length < current.length);
    const bare = current.replace(SPEAKER_TITLE_TAIL, '').trim();
    if (bare && bare !== current && shorter.includes(bare)) {
      mapping.set(name, bare);
      continue;
    }
    const parts = speakerNameParts(bare || current);
    if (parts.length < 2) continue;
    const hits = shorter.filter(other => parts.includes(other));
    if (hits.length === 1) mapping.set(name, hits[0]);
  }
  return mapping;
}

// Hiragana and katakana letters. The prolonged sound mark and the middle dot are left out on purpose:
// both turn up in ordinary Chinese renderings of names and drawn-out cries.
const KANA_RE = /[\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FD-\u30FF\u31F0-\u31FF]/gu;
const KANA_OR_HAN_RE = /[\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FD-\u30FF\u31F0-\u31FF\p{Script=Han}]/gu;

// What a line still says once every mark around it is gone: whitespace, punctuation, symbols and quote
// marks stripped away along with this extension's own invisible block markers (SOURCE_START and the
// others just above — all Unicode "format" characters, category \p{Cf}). Kept the other way around
// instead — only \p{L}/\p{N} survive — so nothing has to be enumerated by hand except the drawn-out
// sound mark's fullwidth spelling, which Unicode itself files under "symbol" rather than "letter" the
// way it files ー (U+30FC, a modifier letter, \p{L} already). A segment sent for translation that
// reduces to nothing here was already caught by segmentSource's own isBuiltinPreservedLine and never
// sent at all; this is for the ones a stray kana still let through.
const RESIDUE_LETTER_RE = /[\p{L}\p{N}]|[～〜]/u;

// Small kana that only decorate a gasp or a stammer, the moraic ん/ン and the drawn-out sound marks:
// filler that never turns a gasp into a word or a name on its own, so none of it counts toward how
// many real morae a residue has. ん stays here rather than among the counted morae so that あっ-style
// stammers keep working (「……うん。」, 「うーん……」) — the cost is a narrow gap of its own, see
// isTrivialInterjectionSource's own note.
const INTERJECTION_FILLER = new Set('ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮーんン～〜');

// The five vowels and the は/か consonant rows: the only full-size morae an honest gasp or stammer is
// ever built from (はぁ, ひっ, くっ, きゃっ, ふぅ…). Kept in step with tts.js's own INTERJECTION_CHARS,
// which draws the same は行 line for a breath rather than a word.
const INTERJECTION_MORA = new Set('あいうえおアイウエオはひふへほハヒフヘホかきくけこカキクケコ');

// Real short kana words this same letter shape can spell — carrying actual meaning, never "nothing to
// translate" even though every letter of them is drawn from INTERJECTION_MORA. Kept in step with
// tts.js's own KANA_WORDS_RE (はい/いいえ/いえ/いい are words there too, not gasps); おい/ええ/あい/うえ
// are the other short real words the same two-vowel shape spells.
const KANA_REAL_WORDS = new Set([
  'はい', 'ハイ', 'いいえ', 'イイエ', 'いえ', 'いい', 'おい', 'オイ', 'ええ', 'エエ', 'あい', 'アイ', 'うえ', 'ウエ',
]);

// A bare ん/ン next to a real mora is letter-for-letter what a short name looks like (アン, ケン, カン…)
// as much as it is a real interjection (うん, ふん…) — the shapes are identical, so only a small fixed
// set of the real words is trusted outright. ううん carries two real morae (う, う) and still belongs
// here for the same reason, and so do フン (katakana ふん), ウウン and ふうん (both a doubled vowel plus
// ん, spelled without ー). うふん/あはん/はうん are the same kind of fixed moan, just not shaped like a
// doubled vowel at all (う-ふ-ん, あ-は-ん, は-う-ん are three distinct morae, not one mora drawn out).
const INTERJECTION_N_WORDS = new Set([
  'うん', 'ううん', 'ウン', 'ふん', 'フン', 'ウウン', 'ふうん', 'うふん', 'あはん', 'はうん',
]);
// A moan's own extra marker: a stammered glottal stop, a heart, or a drawn-out vowel — none of which a
// bare name is ever written with. Checked against the untouched source so ♡/♥/❤, which residueLetters
// never keeps, still count.
const MOAN_MARKER_RE = /[っッ♡♥❤ー～〜~]/;

// The vowel each full-size mora (あいうえお/アイウエオ/はひふへほ/ハヒフヘホ/かきくけこ/カキクケコ), each
// small vowel kana (ぁぃぅぇぉ/ァィゥェォ) and each small ya/yu/yo kana (ゃゅょ/ャュョ, a/u/o — the vowel
// its own yōon compound ends on: ひゃ "hya", きゅ "kyu", りょ "ryo") carries. Used only to spot a drawn-out
// gasp spelled by doubling a vowel instead of by ー — ふぅ, あぁ, ああ, ウウ, and (with ゃ/ゅ/ょ's own
// vowel) ひゃあ, きゅう — without also matching a yōon name that happens to share a consonant (ファン,
// フィン: フ carries u, ァ/ィ carry a/i, so the vowels differ).
const SMALL_VOWEL_KANA = new Set('ぁぃぅぇぉァィゥェォ');
const FULL_VOWEL_KANA = new Set('あいうえおアイウエオ');
const VOWEL_OF = new Map();
for (const [group, vowels] of [
  ['あいうえお', 'aiueo'], ['アイウエオ', 'aiueo'],
  ['はひふへほ', 'aiueo'], ['ハヒフヘホ', 'aiueo'],
  ['かきくけこ', 'aiueo'], ['カキクケコ', 'aiueo'],
  ['ぁぃぅぇぉ', 'aiueo'], ['ァィゥェォ', 'aiueo'],
  ['ゃゅょ', 'auo'], ['ャュョ', 'auo'],
]) {
  for (let index = 0; index < group.length; index += 1) VOWEL_OF.set(group[index], vowels[index]);
}

// Whether `rawSource` spells a drawn-out gasp or moan directly against a bare ん/ン: the two characters
// right before it doubling a vowel — a mora followed by a small or full-size vowel kana carrying the same
// vowel (はあん, ひいん, へえん, ふうん, かあん, はぁん, and ひゃあん/きゅうん once ゃ/ゅ/ょ have a vowel
// of their own above), or a mora followed by an exact repeat of itself (ああん, ウウン) — or one of
// MOAN_MARKER_RE's own characters sitting right against it, before (あーん) or after (あんっ, アンッ♡).
// Checked only against the ん itself, never the line at large: a marker or a doubled vowel elsewhere in
// the same line (オーエン, はっけん, ええ、ケン) says nothing about whether *this* ん is a moan or the
// middle of an unrelated name — the two used to be found by scanning the whole line for either, which
// waved through exactly those.
function hasDrawnOutVowel(rawSource) {
  const chars = [...String(rawSource ?? '')];
  for (let index = 0; index < chars.length; index += 1) {
    if (chars[index] !== 'ん' && chars[index] !== 'ン') continue;
    const after = chars[index + 1];
    if (after !== undefined && MOAN_MARKER_RE.test(after)) return true;
    const before = chars[index - 1];
    if (before !== undefined && MOAN_MARKER_RE.test(before)) return true;
    if (index < 2) continue;
    const mora = chars[index - 1], earlier = chars[index - 2];
    const vowel = VOWEL_OF.get(earlier);
    if (vowel === undefined || VOWEL_OF.get(mora) !== vowel) continue;
    if (SMALL_VOWEL_KANA.has(mora) || FULL_VOWEL_KANA.has(mora) || earlier === mora) return true;
  }
  return false;
}

// Full katakana letters only (ァ–ヺ, ヽヾヿ, the phonetic extensions) — never ー, which a hiragana moan
// drawn out with it (あーん) still spells entirely in hiragana otherwise. Used only to tell a hiragana
// moan from the katakana name the same bare-ん shape could just as easily be (see isInterjectionShaped).
const KATAKANA_LETTER_RE = /[ァ-ヺヽ-ヿㇰ-ㇿ]/;

function residueLetters(text) {
  return [...String(text ?? '')].filter(ch => RESIDUE_LETTER_RE.test(ch));
}

// Whether a bare ん/ン sitting among `letters` (every one of which is already known to be filler or a
// real mora) is genuinely free filler here, rather than the one real thing that turns "gasp" into
// "name": a small fixed set of real ん-interjections (INTERJECTION_N_WORDS), a moan carrying its own
// extra marker right against it in the untouched source (hasDrawnOutVowel), or a shape built by
// repeating a shorter unit two or more times over (あんあん). Only meaningful once the caller already
// knows `letters` contains at least one real mora — with none at all (ん, んん, んー…) there is nothing
// left to mistake for a name in the first place.
function bareNIsFreeFiller(letters, rawSource) {
  if (INTERJECTION_N_WORDS.has(letters.join(''))) return true;
  if (hasDrawnOutVowel(rawSource)) return true;
  return isReduplicatedSound(letters);
}

// A source with nothing in it worth translating beyond a gasp or a stammer: everything left once every
// mark is stripped is filler, with at most one real mora among it (design: a repair request over
// 「……っ」, 「ッ！」 or 「はぁ……」 only ever gets the same unchanged answer back, forever). Two or more
// real morae is always either a real short word (see KANA_REAL_WORDS) or a name, never a bare gasp.
// A bare ん/ン is the one exception worth naming: next to a single real mora it reads exactly like a
// short name (アン, ケン, カン…) as much as a real stammer (うん, ふん…), so that narrow shape is
// accepted only when bareNIsFreeFiller above says so — a fixed real word, a moan's own extra marker, or
// a repeated unit (あんあん, which is why this only otherwise caps at one real mora and yet still takes
// あんあん's two) — never on letter shape alone. The one-real-mora cap still applies once ん brings a
// *second* real mora into the mix (オーエン, ハーケン, けっこん): bareNIsFreeFiller's own moan-marker
// check would otherwise wave through an untranslated multi-mora word just because ー or っ appears
// somewhere in it (a promotion mark and a geminate consonant, not a moan), so a second real mora is
// only ever forgiven by a fixed real word (ううん) or an actually repeated unit (あんあん).
function isTrivialInterjectionSource(source) {
  const letters = residueLetters(source);
  if (!letters.length || letters.length > 4) return false;
  if (!letters.every(ch => INTERJECTION_FILLER.has(ch) || INTERJECTION_MORA.has(ch))) return false;
  const morae = letters.filter(ch => INTERJECTION_MORA.has(ch));
  if (!letters.includes('ん') && !letters.includes('ン')) return morae.length <= 1;
  if (morae.length > 1) return INTERJECTION_N_WORDS.has(letters.join('')) || isReduplicatedSound(letters);
  return !morae.length || bareNIsFreeFiller(letters, source);
}

// An answer to a trivial interjection source is accepted whole (an unchanged echo) or with some/all of
// its filler kana dropped — never with anything in it the source did not already have.
function isAcceptedInterjectionEcho(text, source) {
  if (!isTrivialInterjectionSource(source)) return false;
  const remaining = residueLetters(source);
  for (const letter of residueLetters(text)) {
    const at = remaining.indexOf(letter);
    if (at === -1) return false;
    remaining.splice(at, 1);
  }
  return true;
}

/**
 * Whether a returned "translation" is still, in substance, the source language.
 *
 * Small models sometimes hand a line back untouched, or translate half of it and leave the rest in
 * Japanese. That passes every structural check — the id is right, the text is not empty — and lands
 * on the floor looking like a translation. Kana are the tell: Chinese text carries none, so a line in
 * which they make up a real share of the script goes back for another attempt instead.
 *
 * The one exception is an echo of a source that had nothing to translate in the first place — see
 * isAcceptedInterjectionEcho above. There the unchanged answer is not a failure to flag; it is the
 * only correct one.
 */
export function looksUntranslated(text, source = '') {
  const value = String(text ?? '');
  const kana = value.match(KANA_RE)?.length ?? 0;
  if (!kana) return false;
  if (source && isAcceptedInterjectionEcho(value, source)) return false;
  if (source && value.replace(/\s+/g, '') === String(source).replace(/\s+/g, '')) return true;
  const script = value.match(KANA_OR_HAN_RE)?.length ?? 0;
  return kana >= 3 && kana / script >= 0.3;
}

// ドキドキ, ワクワク, ゴゴゴ: Japanese sound-symbolic words are almost always built by repeating a short
// unit two or more times over, which an ordinary word or a name never is. True when `letters` splits
// evenly into two or more copies of the same shorter run.
function isReduplicatedSound(letters) {
  for (let unit = 1; unit <= Math.floor(letters.length / 2); unit += 1) {
    if (letters.length % unit) continue;
    const base = letters.slice(0, unit).join('');
    let repeats = true;
    for (let at = unit; at < letters.length; at += unit) {
      if (letters.slice(at, at + unit).join('') !== base) { repeats = false; break; }
    }
    if (repeats) return true;
  }
  return false;
}

// Every letter drawn from INTERJECTION_FILLER or INTERJECTION_MORA, with no cap at all on how many real
// morae are among them — isShortExactEcho's own looser half of the shape isTrivialInterjectionSource
// caps at one. A bare ん/ン still needs bareNIsFreeFiller's say-so on a first sighting, same as there, and
// two or more real morae or any katakana letter still needs it here too: an unmarked, non-repeating
// mora-plus-ん is a short name (アン, ケン…) whether it is sighted once or twice in a row. A single
// hiragana mora next to a bare ん (あん, ひゃん, きゃん) is the one exception the second sighting alone
// gets: real moans are written this freely far more often than a name is ever left untranslated twice
// running, and this exact letter shape's names (アン, ケン, カン…) are always written in katakana.
function isInterjectionShaped(letters, rawSource) {
  if (!letters.every(ch => INTERJECTION_FILLER.has(ch) || INTERJECTION_MORA.has(ch))) return false;
  if (!letters.includes('ん') && !letters.includes('ン')) return true;
  const morae = letters.filter(ch => INTERJECTION_MORA.has(ch));
  if (!morae.length) return true;
  if (morae.length === 1 && !letters.some(ch => KATAKANA_LETTER_RE.test(ch))) return true;
  return bareNIsFreeFiller(letters, rawSource);
}

/**
 * Whether `text` is a short, exact echo of `source` (whitespace aside) that is still plausibly
 * untranslatable — not merely short. A model that already echoed a source once is not, on its own,
 * good evidence that a real sentence, name or ordinary word needs no translation; it usually just means
 * the model is lazy. This only ever fires for a source with no Han character in it, at most 8 letters
 * once every mark is stripped, and shaped either like a gasp or a stammer (the same filler-shaped
 * material isTrivialInterjectionSource accepts on a single sighting, just without its own one-real-mora
 * ceiling — a second identical reply is stronger evidence than a first) or a doubled/tripled
 * sound-symbolic word (see isReduplicatedSound). KANA_REAL_WORDS is checked first and always wins, so a
 * real short word built from the same letters — いい, ええ… — is never waved through by either shape,
 * and a bare-ん name (アン, ケン…) is no more accepted here on a second sighting than on a first.
 *
 * A short segment the model hands back unchanged twice in a row — once on the first request, once on
 * the repair that followed — is treated as the model saying it needs no translation, rather than being
 * asked a third time forever (see withoutUntranslated / translateOneBatch in index.js, which are the
 * only callers: this never overrides looksUntranslated's own verdict by itself, only what a caller does
 * once that verdict, and a second matching one, have already been reached).
 */
export function isShortExactEcho(text, source) {
  if (!source) return false;
  const value = String(text ?? '');
  if (value.replace(/\s+/g, '') !== String(source).replace(/\s+/g, '')) return false;
  if (/\p{Script=Han}/u.test(String(source))) return false;
  const letters = residueLetters(source);
  if (!letters.length || letters.length > 8) return false;
  if (KANA_REAL_WORDS.has(letters.join(''))) return false;
  if (isInterjectionShaped(letters, source)) return true;
  return isReduplicatedSound(letters);
}

// SillyTavern rewrites message class names with a custom- prefix when it renders, and an edited
// floor can be saved back in that form, so both spellings have to be recognised here.
const SPEAKER_OPEN_RE = new RegExp(`<span class="(?:custom-)?${SPEAKER_CLASS}(?:[ "][^>]*)?>`);
const VALID_TAG_RE = /^[A-Za-z][A-Za-z0-9_:-]*$/;
const STRUCTURAL_TAG_RE = /\\?<(\/?)([A-Za-z][A-Za-z0-9_:-]*)(?:\s[^<>]*?)?\s*\/?>/g;
const HTML_ENTITY_RE = /&(?:#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi;
// A Markdown picture as the host's showdown renders it — ![alt](src "title"), sizes and one level of
// brackets in the address included — and the empty link a linked picture [![a](b)](c) leaves once the
// picture is gone. A picture is not prose.
const MARKDOWN_IMAGE_RE = /(?<!\\)!\[[^\]\n]*\][ \t]*\((?:[^()\n]|\([^()\n]*\))*\)/g;
const EMPTY_MARKDOWN_LINK_RE = /(?<!\\)\[\s*\][ \t]*\((?:[^()\n]|\([^()\n]*\))*\)/g;
const LEGACY_BUNDLED_PRELUDE_FINGERPRINT = '2921:75ac807f';
// A guard against typos and NaN, not a real output-policy ceiling; providers reject what they reject.
const MAX_OUTPUT_TOKENS_LIMIT = 1000000;

export const DEFAULT_CHANNEL = Object.freeze({
  id: 'default',
  name: '默认副 API',
  url: '',
  key: '',
  model: '',
  models: [],
  timeoutSec: 240,
  maxTokens: 60000,
  temperature: 0.15,
  tokenSaving: false,
  reasoningEffort: '',
  excludeParams: [],
  // Batches sent at once. 1 keeps the whole floor in one request, which is what every run did before.
  concurrency: 1,
});

export const MAX_CHANNEL_CONCURRENCY = 4;

// Speaker colouring and emotion typography. The secondary model only ever returns a label; the
// palette, the contrast maths and the typography all live on this side. See palette.js.
export const DEFAULT_COLORING = Object.freeze({
  speakers: false,
  emotions: false,
  // 特效字 (design 声线排版/招式上色/搬运原文排版, folded together as one switch): a sub-switch of
  // speakers, asked for and applied only while `speakers` is also on — see `normalizeColoring`.
  effects: false,
  // WCAG AA for body text. The theme probe reports what a background can actually reach.
  minContrast: 4.5,
  // 0 keeps a character's own hair colour faithfully, 1 paints everyone at full strength.
  vividness: 0.65,
  // A speaker the model named but the palette has never heard of still gets a colour, derived from
  // the name the way a black-haired character already is. Without this the whole feature silently
  // does nothing until every character has been registered by hand, which is indistinguishable from
  // "翻译把对话的颜色弄掉了".
  autoSpeakers: true,
  // The size contour inside one spoken line, computed from punctuation and the emotion label that
  // already came back. It costs the secondary model nothing, so it rides with 情绪排版.
  rhythm: true,
  // Filled in by 取色: { direction, luminance, chromaMax, minContrast, backgrounds }.
  band: null,
  bandProbedAt: '',
});

// Reading the translation aloud. The provider block is Fish Audio today; everything above it — which
// lines are read, by whom, in what mood — is provider-neutral and lives in tts.js.
// 'floor' sends the whole floor as one recording after a deep reading of it; 'stream' sends one
// paragraph at a time and starts playing as soon as the first one is back. The old 'sentence' mode is
// folded into 'stream': a single sentence is found inside whichever recording already holds it.
// The two readings: the simple one gives every sentence its feeling, the deep one asks a model why
// and how to play it, on top of the simple one.
export const TTS_MODES = Object.freeze(['off', 'simple', 'deep']);
// What a play does on a floor the simple reading has not seen: ask, analyse without asking, or read the plain text.
export const TTS_ASK_MODES = Object.freeze(['ask', 'analyze', 'plain']);
// Punctuation the reader pairs with a tag: the Chinese word shown, Fish's own tag sent, and where the tag
// lands by default (inline: in place of the punctuation; head: at the start of the clause it closes).
export const MARK_TAGS = Object.freeze([
  ['停顿', 'break', 'inline'], ['长停顿', 'long-break', 'inline'],
  ['叹气', 'sighing', 'inline'], ['轻笑', 'chuckling', 'inline'], ['笑', 'laughing', 'inline'], ['喘息', 'panting', 'inline'],
  ['倒吸气', 'gasping', 'inline'], ['抽泣', 'sobbing', 'inline'], ['清嗓', 'clear throat', 'inline'],
  ['加大音量', 'shouting', 'head'], ['小声', 'soft tone', 'head'], ['耳语', 'whispering', 'head'], ['急促', 'in a hurry tone', 'head'],
  ['生气', 'angry', 'head'], ['开心', 'happy', 'head'], ['难过', 'sad', 'head'], ['惊讶', 'surprised', 'head'], ['紧张', 'nervous', 'head'],
  ['害怕', 'scared', 'head'], ['疑惑', 'doubtful', 'head'], ['困惑', 'confused', 'head'], ['温柔', 'tender', 'head'], ['害羞', 'shy', 'head'],
  ['兴奋', 'excited', 'head'], ['平静', 'calm', 'head'], ['严肃', 'serious', 'head'], ['冷淡', 'indifferent', 'head'], ['讽刺', 'sarcastic', 'head'],
  ['疲惫', 'tired', 'head'], ['哀求', 'pleading', 'head'],
].map(([label, tag, at]) => Object.freeze({ label, tag, at })));
export const MARK_TAG_LABELS = Object.freeze(MARK_TAGS.map(item => item.label));
// 「……」 is deliberately not among these. A pause tag dropped into a drawn-out line is read by the
// voice model as something to perform, and on a line like 「不……又甜又酸」 what it performs is a moan.
// The models already hear an ellipsis; they do not need to be told to stop at one.
export const RECOMMENDED_MARKS = Object.freeze([
  Object.freeze({ punct: '！！', tag: '加大音量', at: 'head' }),
  Object.freeze({ punct: '？！', tag: '惊讶', at: 'head' }),
]);
/** Punctuation marks as saved: a run of punctuation, one catalogue word, and where the tag goes. */
export function normalizeMarks(value) {
  const list = Array.isArray(value) ? value : [];
  const result = [];
  const seen = new Set();
  for (const item of list) {
    const punct = String(item?.punct ?? '').replace(/\s+/g, '').slice(0, 8);
    const known = MARK_TAGS.find(candidate => candidate.label === String(item?.tag ?? '').trim());
    if (!punct || !known || seen.has(punct)) continue;
    seen.add(punct);
    result.push({ punct, tag: known.label, at: item?.at === 'head' || item?.at === 'inline' ? item.at : known.at });
    if (result.length >= 12) break;
  }
  return result;
}
export const TTS_RANGES = Object.freeze(['all', 'dialogue', 'narration']);
// Which language is read: the translation, the original the floor was written in, both — each made on
// its own, every line getting a button in either language — or dialogue_source, one reading where the
// narration is the translation and every quoted run is the original, in whatever language it was
// written in.
export const TTS_SIDES = Object.freeze(['translation', 'source', 'both', 'dialogue_source']);
// What one request of the stream carries: a paragraph, or a single sentence.
export const TTS_STREAM_UNITS = Object.freeze(['line', 'sentence']);
// What one request to the voice provider carries: the whole floor with every speaker in it, one
// paragraph at a time (the default: the first paragraph plays while the rest are made), or one
// sentence at a time.
export const TTS_REQUEST_UNITS = Object.freeze(['floor', 'line', 'sentence']);
// 'auto' reads deeply for a whole floor and lightly for a stream; the rest pin one depth.
export const TTS_ANALYSIS_MODES = Object.freeze(['auto', 'deep', 'light', 'annotations']);

// A character's console: how its voice tends to pause, breathe, fray, feel, swing, hurry and sound.
// Sliders run 0–100 with 50 as the ordinary setting. The numbers never reach a model as numbers; they
// become sentences about the character's habits first.
export const CONSOLE_KEYS = Object.freeze(['pause', 'breath', 'grain', 'intensity', 'range', 'speed', 'expression']);
export const DEFAULT_CONSOLE = Object.freeze({ pause: 50, breath: 50, grain: 50, intensity: 50, range: 50, speed: 50, expression: 50, rules: '', marks: Object.freeze([]) });

/** A console with every slider clamped and the rules trimmed; `sparse` returns null for an untouched one. */
export function normalizeConsole(value, { sparse = false } = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const console = {};
  for (const key of CONSOLE_KEYS) console[key] = clampInteger(source[key], 0, 100, DEFAULT_CONSOLE[key]);
  console.rules = normalizeNewlines(String(source.rules ?? '')).split('\n').map(line => line.trim()).filter(Boolean).slice(0, 12).join('\n').slice(0, 800);
  console.marks = normalizeMarks(source.marks);
  if (sparse && !console.rules && !console.marks.length && CONSOLE_KEYS.every(key => console[key] === 50)) return null;
  return console;
}
export const TTS_DOWNLOAD_SCOPES = Object.freeze(['auto', 'floor', 'current', 'sentence']);
// What becomes of a line whose speaker has no voice of their own: read in the dialogue default, or
// left unread, so that only the characters actually given a voice are heard.
export const TTS_DIALOGUE_FALLBACKS = Object.freeze(['default', 'skip']);
// Where the character voice table lives: one per character card (every chat of the card shares it),
// or one per chat, for a card played through several times with different casts.
export const TTS_VOICE_SCOPES = Object.freeze(['character', 'chat']);
// Languages a voice can be bound to. Codes are what the analysis returns and what the script check
// falls back to; the labels are only for the settings page.
export const TTS_LANGUAGES = Object.freeze([
  ['zh', '中文'], ['en', '英语（通用）'], ['en-US', '美式英语'], ['en-GB', '英式英语（伦敦腔）'], ['ja', '日语'], ['ko', '韩语'],
  ['de', '德语'], ['fr', '法语'], ['es', '西班牙语'], ['ru', '俄语'], ['it', '意大利语'], ['pt', '葡萄牙语'], ['nl', '荷兰语'],
  ['pl', '波兰语'], ['ar', '阿拉伯语'],
]);
export const FISH_MODELS = Object.freeze(['s2-pro', 's2.1-pro', 's2.1-pro-free', 'drama-3-preview', 's1']);
export const FISH_FORMATS = Object.freeze(['mp3', 'opus', 'wav']);
export const FISH_LATENCIES = Object.freeze(['normal', 'balanced', 'low']);
// What a line is cut at. Quote pairs hold speech; skip pairs hold what is never read aloud, such as
// the *actions* a preset writes between asterisks. Each entry is an opener and a closer.
export const DEFAULT_QUOTE_PAIRS = Object.freeze(['「」', '『』', '“”', '""']);
export const DEFAULT_SKIP_PAIRS = Object.freeze([]);

// The list is typed as text: entries separated by commas or line breaks, an opener and a closer inside
// each entry separated by a space (`** **`), or written together when both are one character (`「」`).
export function parsePairList(value) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(/[\n,，;；]+/);
  const pairs = [];
  const seen = new Set();
  for (const raw of source) {
    let open = '';
    let close = '';
    if (raw && typeof raw === 'object') {
      open = String(raw.open ?? '');
      close = String(raw.close ?? '');
    } else {
      const entry = String(raw ?? '').trim();
      if (!entry) continue;
      const tokens = entry.split(/\s+/).filter(Boolean);
      if (tokens.length >= 2) [open, close] = tokens;
      else {
        const characters = [...tokens[0]];
        if (characters.length === 1) open = close = characters[0];
        else if (characters.length === 2) [open, close] = characters;
        else if (characters.length % 2 === 0) {
          open = characters.slice(0, characters.length / 2).join('');
          close = characters.slice(characters.length / 2).join('');
        } else continue;
      }
    }
    if (!open || !close || open.length > 4 || close.length > 4) continue;
    const key = `${open}\u0000${close}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ open, close });
  }
  return pairs.slice(0, 16);
}

export function formatPairList(pairs) {
  return parsePairList(pairs).map(pair => ([...pair.open].length === 1 && [...pair.close].length === 1 ? `${pair.open}${pair.close}` : `${pair.open} ${pair.close}`)).join(', ');
}

// Stored as the strings the reader typed, so the field shows exactly what was saved.
function normalizePairStrings(value, fallback) {
  if (value === undefined) return [...fallback];
  const entries = Array.isArray(value) ? value : String(value ?? '').split(/[\n,，;；]+/);
  const result = [];
  const seen = new Set();
  for (const raw of entries) {
    const [pair] = parsePairList([raw]);
    if (!pair) continue;
    const key = `${pair.open}\u0000${pair.close}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(typeof raw === 'string' ? raw.trim() : formatPairList([pair]));
  }
  return result.slice(0, 16);
}

// A language tag: `en`, or with a region for an accent, `en-US` / `en-GB`. The base is kept lowercase
// and the region uppercase, the way the tags are usually written, so `EN_us` and `en-US` are one key.
export function normalizeLanguageCode(value) {
  const match = String(value ?? '').trim().match(/^([A-Za-z]{2,3})(?:[_-]([A-Za-z]{2}|\d{3}))?$/);
  if (!match) return '';
  return match[2] ? `${match[1].toLowerCase()}-${match[2].toUpperCase()}` : match[1].toLowerCase();
}

// `en-GB` → `en`; a plain code is its own base.
export function languageBase(code) {
  return String(code ?? '').split('-')[0];
}

export function languageLabel(code) {
  const found = TTS_LANGUAGES.find(([key]) => key === code);
  return found ? found[1] : String(code ?? '');
}

export const DEFAULT_FISH = Object.freeze({
  key: '',
  baseUrl: 'https://api.fish.audio',
  // api.fish.audio answers no CORS preflight, so a browser cannot call it directly. The host's own
  // /proxy/ route is the way through; direct stays available for a relay or a local fish-speech server.
  viaProxy: true,
  model: 's2-pro',
  format: 'mp3',
  mp3Bitrate: 128,
  latency: 'normal',
  speed: 1,
  volume: 0,
  temperature: 0.7,
  topP: 0.7,
  normalize: true,
  // Characters per request, counted as sent: the words with their cues, the speaker tags and the line
  // breaks. A longer unit is cut between paragraphs and played back as consecutive parts.
  maxChars: 1500,
  timeoutSec: 180,
  // How many times one Fish request is asked again after a network error, a timeout or a 5xx.
  retries: 1,
  // How many of one recording's parts go to Fish at once. Fish charges per character either way; the
  // wait for a long floor drops by about this factor. Rate limits on the free tier argue for 1.
  concurrency: 2,
});

export const DEFAULT_TTS = Object.freeze({
  // The whole feature. Off is the ordinary translate-only mode: no 朗读 page, no floor buttons, nothing
  // listening in the background and no audio store opened.
  enabled: false,
  side: 'translation',
  mode: 'simple',
  range: 'all',
  emotionCues: true,
  // The copy sent to the voice loses the markup a preset or the colouring wrapped around the words.
  sanitizeHtml: true,
  // The console every character reads by unless a row has one of its own; the narrator's too.
  console: DEFAULT_CONSOLE,
  // Sentences whose analysis asks for another speed or volume become their own request, since Fish
  // sets prosody per request; off keeps one request and says it with cues alone.
  prosodySplit: true,
  // The latest floor's audio is made right after its translation lands, without playing it.
  autoGenerate: false,
  // What 「保存到本地」 saves: the whole floor, the paragraph being read, or one or the other by mode.
  downloadScope: 'auto',
  // What one Fish request carries: 'line' a paragraph, 'floor' the whole floor with all its voices in
  // one take, 'sentence' one sentence. See TTS_REQUEST_UNITS.
  requestUnit: 'line',
  voiceScope: 'character',
  // Off means a click makes the audio and stops there; a second click on a made sentence plays it.
  playAfterGenerate: true,
  // Runs of ！！！ become one mark; the cue carries the strength instead of the voice shrieking.
  tamePunctuation: true,
  // The reader's own system prompts for the two readings; empty means the built-in ones.
  prompts: Object.freeze({ simple: '', deep: '' }),
  // The connection the reading's analysis goes to: 'follow' for the host's own connection, or a saved
  // connection's id. Empty only ever comes from an older setting, and is pinned to the translation's
  // choice when the settings are read, so the reading never follows the translation silently.
  analysisChannelId: '',
  // The connection the deep reading goes to: empty is the same one as the analysis above, 'follow' the
  // host's own, else a saved connection's id.
  deepChannelId: '',
  // The longest one analysis may take, counted from the request going out, whether or not the model
  // is still writing. The connection's own timeout only counts silence, so a model that thinks out
  // loud can hold a floor open for as long as it likes without this.
  analysisLimitSec: 150,
  // Sentences per analysis batch; 0 sends the whole floor in one request.
  batchSize: 0,
  // A play on a floor the simple reading has not seen: ask first, always analyse, or read the plain text.
  askAnalysis: 'ask',
  // The deep reading is shelved while it is reworked; this hatch keeps it reachable for tests.
  deepUnlocked: false,
  quotePairs: DEFAULT_QUOTE_PAIRS,
  skipPairs: DEFAULT_SKIP_PAIRS,
  // What the deep reading is allowed to see besides the floor itself.
  context: Object.freeze({ character: true, worldbook: true, recent: true, floors: 2 }),
  // Read when a floor carries no translation written by this extension.
  sourceTags: Object.freeze(['jy-translation']),
  narratorVoice: '',
  narratorTitle: '',
  // Narrator voices per language, for a reader who switches between the translation and the original.
  narratorVoices: Object.freeze({}),
  dialogueVoice: '',
  dialogueTitle: '',
  dialogueFallback: 'default',
  // Every reply the main model writes goes out asking it to mark each line of dialogue with who says
  // it and how; the plain reading then tells the voices apart from the text alone.
  speechMarks: false,
  // A new reply is read aloud by itself once its text is final.
  autoRead: false,
  fish: DEFAULT_FISH,
});

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 13,
  // The control center rail: 'normal' shows the small three-page layout (翻译台 · 微调 · 运行记录),
  // 'advanced' the full six pages that used to be the only layout. See UI_MODES / mergeSettings below
  // for who gets which on first load.
  uiMode: 'normal',
  // The last one-click package applied from 正常模式 · 翻译台, so its card stays highlighted and a
  // hand-changed managed field can say what it drifted from. '' once nothing has been applied yet, or
  // after 「恢复原样」 leaves a set of choices that matches no package by construction (it does).
  preset: '',
  coloring: DEFAULT_COLORING,
  speakerPalette: {},
  tts: DEFAULT_TTS,
  ttsVoices: {},
  // Voice ids the reader has saved by name, shared across every character card.
  voiceLibrary: [],
  // Whole consoles saved by name: the set of stops and rules that suits a kind of scene, kept so it
  // can be put back when that kind of scene comes round again. Global, like the voice library.
  consolePresets: [],
  theme: 'day',
  autoGeneration: true,
  autoSwipe: true,
  autoEdit: false,
  streamingWriteback: false,
  // 「只留译文」: a finished floor holds only its translation; the bilingual text goes into its metadata.
  translationOnly: false,
  apiMode: 'follow',
  selectedChannelId: DEFAULT_CHANNEL.id,
  channels: [DEFAULT_CHANNEL],
  showFloatingButton: true,
  floatingStyle: 'auto',
  // The reading buttons inside a floor: one pair per paragraph ('line', the default, on every device
  // because a paragraph-sized target is one a thumb can hit), those plus the per-sentence pair
  // ('sentence'), or none at all ('off', leaving the floating window's list to do the job).
  floorButtons: 'line',
  // Mirrors the floating window's main controls for a thumb on the left.
  leftHanded: false,
  retries: 1,
  bodyTags: Object.freeze(['story_scene']),
  replaceTags: Object.freeze([]),
  excludedTags: Object.freeze([]),
  preserveLineRules: '',
  // v0.37.0 「歌词」: lines matched here are translated one line in, one line out and laid out beside
  // their original instead of joining the surrounding prose unit. Same grammar as preserveLineRules.
  lyricLineRules: '',
  // The 「音乐卡片」 rule group (processing.js PROCESSING_FIELDS carries it alongside the other
  // per-profile fields above): off by default, a reader turns it on by hand. See splitCardRows.
  musicCardRules: false,
  segmentPrefix: '',
  segmentSuffix: '',
  translationPrefix: '{',
  translationSuffix: '}',
  paragraphPerLine: false,
  // Presentation tags around a source line come back around its translation. Default on: leaving it
  // off is what made a preset that paints dialogue paint only half the floor.
  carryFormatting: true,
  includeWorldbook: true,
  includeCharacterCard: true,
  includeRecentContext: true,
  contextMessages: 2,
  selectedPromptProfileId: DEFAULT_PROMPT_PROFILE.id,
  promptProfiles: [DEFAULT_PROMPT_PROFILE],
});

export const FLOATING_STYLES = Object.freeze(['auto', 'ring', 'pill', 'edge']);
export const FLOOR_BUTTON_MODES = Object.freeze(['line', 'sentence', 'off']);
// What the two older names meant: 'auto' was per-sentence on a desktop and nothing on a phone, which
// the paragraph buttons replace; 'on' was per-sentence everywhere, which is now the fuller mode.
const FLOOR_BUTTON_LEGACY = Object.freeze({ auto: 'line', on: 'sentence' });

export const UI_MODES = Object.freeze(['normal', 'advanced']);
export const CONSOLE_PRESET_IDS = Object.freeze(['light', 'comfort', 'audiobook', 'everything']);

// DESIGN §15.1: which rail pages exist in which mode. 'main' (翻译台) and 'logs' (运行记录) are in
// both; 'finetune' (微调) is normal-mode only. The other four are unchanged advanced-mode pages.
export const CONTROL_CENTER_PAGES = Object.freeze({
  normal: Object.freeze(['main', 'finetune', 'logs']),
  advanced: Object.freeze(['main', 'prompt', 'settings', 'processing', 'tts', 'logs']),
});

/** The page ids shown in a mode's rail, advanced's list for anything that is not a known mode. */
export function pagesForMode(mode) {
  return CONTROL_CENTER_PAGES[UI_MODES.includes(mode) ? mode : 'advanced'];
}

export function pageExistsInMode(pageId, mode) {
  return pagesForMode(mode).includes(pageId);
}

/** Which page should be showing after a mode switch: the current one if it still exists there, else 翻译台. */
export function resolvePageForMode(pageId, mode) {
  return pageExistsInMode(pageId, mode) ? pageId : 'main';
}

// -------------------------------------------------------------------------------------------
// DESIGN.md §15.4 折叠组: "收起时同一行写当前值摘要". Each of these is the pure half of one collapsed
// fold's summary line on the 正文处理 / 朗读 advanced pages — given the settings already on the page, no
// DOM. The DOM-facing sync functions in index.js call these and write the result into that fold's
// `[data-jy-fold-summary]` span.
// -------------------------------------------------------------------------------------------

/** "N 条" for a rule list with content, "空" for none — 原样保留白名单 and 歌词行 share this reading. */
export function preserveLineRuleCountLabel(value) {
  const { rules } = parsePreserveLineRulesWithErrors(value);
  return rules.length ? `${rules.length} 条` : '空';
}

function affixPairLabel(prefix, suffix) {
  return prefix || suffix ? `${prefix || ''} ${suffix || ''}`.trim() : '无';
}

/** "原文 无 · 译文 { }" — the 段落前后缀 fold's summary. */
export function segmentAffixSummary(settings = {}) {
  return `原文 ${affixPairLabel(settings.segmentPrefix, settings.segmentSuffix)} · 译文 ${affixPairLabel(settings.translationPrefix, settings.translationSuffix)}`;
}

/** "情绪起伏 · 名单外自动取色 · 对比度目标 4.5 · 彩度 0.65 · 读取当前主题与壁纸" — 颜色细节 fold's summary.
 * 情绪起伏/名单外自动取色 only appear when actually on — a collapsed row used to claim both regardless
 * of the real setting (review finding core.js:946). */
export function coloringDetailFoldSummary(coloring = {}) {
  const contrast = Number.isFinite(coloring.minContrast) ? coloring.minContrast : DEFAULT_COLORING.minContrast;
  const vividness = Number.isFinite(coloring.vividness) ? coloring.vividness : DEFAULT_COLORING.vividness;
  return [
    coloring.rhythm ? '情绪起伏' : '',
    coloring.autoSpeakers ? '名单外自动取色' : '',
    `对比度目标 ${contrast}`,
    `彩度 ${vividness.toFixed(2)}`,
    '读取当前主题与壁纸',
  ].filter(Boolean).join(' · ');
}

/** "「」 『』 · （）" — 对白符号 · 跳过符号 fold's summary, empty skip pairs shown as "空". */
export function quoteSymbolFoldSummary(tts = {}) {
  const quotes = formatPairList(tts.quotePairs ?? DEFAULT_QUOTE_PAIRS);
  const skips = formatPairList(tts.skipPairs ?? DEFAULT_SKIP_PAIRS);
  return `${quotes || '空'} · ${skips || '空'}`;
}

/** "mp3 · 语速 1.0 · 同时生成 2 段" — Fish 参数 fold's summary. */
export function fishParamsFoldSummary(fish = {}) {
  return `${fish.format} · 语速 ${fish.speed} · 同时生成 ${fish.concurrency} 段`;
}

/** "AI 判断 · 标点情绪标签 3 条" (or "N 项已设定" once a slider leaves the middle) — 默认调音台 fold's summary. */
export function consoleFoldSummary(value = {}) {
  const overridden = CONSOLE_KEYS.filter(key => Number(value[key]) !== DEFAULT_CONSOLE[key]).length;
  const tuning = overridden ? `${overridden} 项已设定` : 'AI 判断';
  const marks = Array.isArray(value.marks) ? value.marks.length : 0;
  return `${tuning} · 标点情绪标签 ${marks} 条`;
}

/** "N 个音色" for a non-empty library, "空" for none — 音色库 fold's summary, nested inside 音色's card. */
export function voiceLibraryFoldSummary(voiceLibrary) {
  const list = normalizeVoiceLibrary(voiceLibrary);
  return list.length ? `${list.length} 个音色` : '空';
}

/** "超时 240s · 上限 60000 tokens · 温度 0.15" (plus 并发/推理强度/排除参数/节约模式 only when actually set) —
 * 模型连接 每条连接卡「请求参数」fold's summary (DESIGN §15.4). */
export function channelRequestFoldSummary(channel = {}) {
  const timeoutSec = Number.isFinite(channel.timeoutSec) ? channel.timeoutSec : DEFAULT_CHANNEL.timeoutSec;
  const maxTokens = Number.isFinite(channel.maxTokens) ? channel.maxTokens : DEFAULT_CHANNEL.maxTokens;
  const temperature = Number.isFinite(channel.temperature) ? channel.temperature : DEFAULT_CHANNEL.temperature;
  const concurrency = Number.isFinite(channel.concurrency) ? channel.concurrency : DEFAULT_CHANNEL.concurrency;
  const excludeCount = Array.isArray(channel.excludeParams) ? channel.excludeParams.length : 0;
  return [
    `超时 ${timeoutSec}s`,
    `上限 ${maxTokens} tokens`,
    `温度 ${temperature}`,
    concurrency > 1 ? `并发 ${concurrency}` : '',
    channel.reasoningEffort ? `推理强度 ${channel.reasoningEffort}` : '',
    excludeCount ? `排除 ${excludeCount} 项` : '',
    channel.tokenSaving ? '节约 token 模式' : '',
  ].filter(Boolean).join(' · ');
}

/** "user · 未设置" / "system · 已设置（12 字）" — 模型连接「后置提示词」fold's summary (DESIGN §15.4). */
export function channelPostscriptFoldSummary(channel = {}) {
  const role = ['system', 'user', 'assistant'].includes(channel.postscriptRole) ? channel.postscriptRole : 'user';
  const text = String(channel.postscript || '').trim();
  return `${role} · ${text ? `已设置（${text.length} 字）` : '未设置'}`;
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function parseExcludedParams(value) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(/[\s,，;；]+/);
  return [...new Set(source.map(item => String(item).trim()).filter(Boolean))];
}

function normalizeTagToken(value) {
  let token = String(value ?? '').trim();
  const wrapped = token.match(/^<\s*\/?\s*([A-Za-z][A-Za-z0-9_:-]*)\s*\/?>$/);
  if (wrapped) token = wrapped[1];
  return token;
}

export function parseTagNamesWithErrors(value) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(/[\s,，;；]+/);
  const result = [];
  const invalid = [];
  const seen = new Set();
  for (const item of source) {
    const raw = String(item ?? '').trim();
    if (!raw) continue;
    const tag = normalizeTagToken(raw);
    if (!VALID_TAG_RE.test(tag)) {
      invalid.push(raw);
      continue;
    }
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return { tags: result, invalid };
}

export function parseTagNames(value, fallback = []) {
  const result = parseTagNamesWithErrors(value).tags;
  if (result.length) return result;
  return Array.isArray(fallback) ? [...fallback] : [];
}

function parseRegexRule(raw, lineNumber) {
  const end = raw.lastIndexOf('/');
  if (end <= 0) return { error: `第 ${lineNumber} 行正则缺少结束斜杠。` };
  const pattern = raw.slice(1, end);
  const flags = raw.slice(end + 1);
  if (!/^[dgimsuvy]*$/.test(flags)) return { error: `第 ${lineNumber} 行正则标志无效：${flags || '（空）'}。` };
  try {
    return { type: 'regex', source: raw, regex: new RegExp(pattern, flags.replace(/[gy]/g, '')) };
  } catch (error) {
    return { error: `第 ${lineNumber} 行正则无效：${error.message}` };
  }
}

export function parsePreserveLineRulesWithErrors(value) {
  const lines = Array.isArray(value) ? value : normalizeNewlines(value).split('\n');
  const rules = [];
  const errors = [];
  lines.forEach((item, index) => {
    const raw = String(item ?? '').trim();
    if (!raw) return;
    if (raw.startsWith('/')) {
      const parsed = parseRegexRule(raw, index + 1);
      if (parsed.error) errors.push(parsed.error);
      else rules.push(parsed);
      return;
    }
    if (/^prefix:/i.test(raw)) {
      const text = raw.slice(raw.indexOf(':') + 1).trim();
      if (!text) errors.push(`第 ${index + 1} 行的 prefix 不能为空。`);
      else rules.push({ type: 'prefix', source: raw, text });
      return;
    }
    rules.push({ type: 'exact', source: raw, text: raw });
  });
  return { rules, errors };
}

// 「歌词行」 rules read exactly like preserve rules — exact / prefix: / /regex/ — the grammar is shared
// verbatim; only what a hit means differs (lyric translation instead of untouched original).
export const parseLyricLineRulesWithErrors = parsePreserveLineRulesWithErrors;

// `options.modern`: v0.36.1 also looks past a whole-line <say> shell before testing a rule, so an
// indented line or one the story marked with a speaker still hits a preserve rule written for the bare
// text. It is strictly additional — every version through v0.36.0's own test (a regex against the
// untrimmed original, a prefix or exact rule against the trimmed line) is tried first and still wins on
// its own; the shell-stripped subject is only a second try for whichever of those missed, never a
// replacement for them. Off (segmentSource's old floors), behaviour is byte-identical to every version
// through v0.36.0.
export function matchesPreserveLine(line, rules, options = {}) {
  const raw = String(line ?? '');
  const trimmed = raw.trim();
  let subject = null;
  if (options.modern) {
    const shell = trimmed.match(SAY_SHELL_RE);
    subject = shell ? shell[1].trim() : trimmed;
  }
  return (Array.isArray(rules) ? rules : []).some(rule => {
    if (rule.type === 'regex') return rule.regex.test(raw) || (subject !== null && subject !== raw && rule.regex.test(subject));
    if (rule.type === 'prefix') return trimmed.startsWith(rule.text) || (subject !== null && subject !== trimmed && subject.startsWith(rule.text));
    return trimmed === rule.text || (subject !== null && subject !== trimmed && subject === rule.text);
  });
}

const REASONING_EFFORTS = Object.freeze(['', 'minimal', 'low', 'medium', 'high']);

export function normalizeChannel(value = {}, fallbackId = DEFAULT_CHANNEL.id) {
  const source = value && typeof value === 'object' ? value : {};
  const id = String(source.id || fallbackId).trim() || fallbackId;
  const models = Array.isArray(source.models)
    ? [...new Set(source.models.map(item => String(item).trim()).filter(Boolean))].sort()
    : [];
  return {
    id,
    name: String(source.name || DEFAULT_CHANNEL.name).trim() || DEFAULT_CHANNEL.name,
    url: String(source.url ?? source.apiUrl ?? '').trim(),
    key: String(source.key ?? source.apiKey ?? '').trim(),
    model: String(source.model ?? source.apiModel ?? '').trim(),
    models,
    timeoutSec: clampInteger(source.timeoutSec, 10, 600, DEFAULT_CHANNEL.timeoutSec),
    maxTokens: clampInteger(source.maxTokens, 256, MAX_OUTPUT_TOKENS_LIMIT, DEFAULT_CHANNEL.maxTokens),
    temperature: clampNumber(source.temperature, 0, 2, DEFAULT_CHANNEL.temperature),
    tokenSaving: source.tokenSaving === true,
    reasoningEffort: REASONING_EFFORTS.includes(source.reasoningEffort) ? source.reasoningEffort : '',
    excludeParams: parseExcludedParams(source.excludeParams),
    concurrency: clampInteger(source.concurrency, 1, MAX_CHANNEL_CONCURRENCY, DEFAULT_CHANNEL.concurrency),
    // Appended to every request on this connection, whoever made it. This is where a model is told
    // not to think out loud, and the reading needs to be able to say it as much as the translation.
    postscript: String(source.postscript ?? '').slice(0, 2000),
    postscriptRole: ['system', 'user', 'assistant'].includes(source.postscriptRole) ? source.postscriptRole : 'user',
  };
}

/** The translation's own choice, as one value: 'follow' for the host's connection, else a saved one's id. */
export function translationChannelChoice(settings) {
  return settings?.apiMode === 'independent' ? String(settings?.selectedChannelId ?? '') : 'follow';
}

/**
 * A feature's choice of connection, made explicit: 'follow' for the host's own connection, or the id
 * of a saved one. Empty — the old 「follow the translation」 — and an id that no longer exists both
 * become what the translation uses right now.
 */
export function resolveFeatureChannel(value, settings) {
  const wanted = String(value ?? '').trim();
  const channels = Array.isArray(settings?.channels) ? settings.channels : [];
  if (wanted === 'follow' || channels.some(channel => channel.id === wanted)) return wanted;
  return translationChannelChoice(settings);
}

export function getActiveChannel(settings) {
  const channels = Array.isArray(settings?.channels) ? settings.channels : [];
  return channels.find(channel => channel.id === settings?.selectedChannelId) || channels[0] || normalizeChannel();
}

// ---------------------------------------------------------------------------------------------
// Connection uses: the three places a saved connection (or the host's own) can be put to work,
// named the way the control center names them rather than by the settings fields underneath —
// 'translation' is apiMode + selectedChannelId, 'analysis' is tts.analysisChannelId, 'deep' is
// tts.deepChannelId. Each use holds exactly one choice at a time; the pages that used to have three
// separate pickers for this (翻译用哪条连接 / 朗读分析用的连接 / 深度分析用的连接) become one checkbox
// per connection per use, and these helpers are what that checkbox reads and writes.
// ---------------------------------------------------------------------------------------------

export const CONNECTION_USES = Object.freeze(['translation', 'analysis', 'deep']);

/**
 * What a use points at right now, resolved to something real: 'follow' for the host's own connection,
 * or a saved connection's id. 深度分析's own empty value — 「和朗读分析用同一条」 — resolves through to
 * whatever 朗读分析 resolves to, so all three uses are always directly comparable to a connection id.
 */
export function connectionUseChoice(settings, use) {
  if (use === 'translation') return translationChannelChoice(settings);
  if (use === 'analysis') return resolveFeatureChannel(settings?.tts?.analysisChannelId, settings);
  if (use === 'deep') {
    const own = String(settings?.tts?.deepChannelId ?? '').trim();
    return own ? resolveFeatureChannel(own, settings) : connectionUseChoice(settings, 'analysis');
  }
  throw new Error(`未知用途：${use}`);
}

/**
 * Points a use at a connection — 'follow' for the host's own, a saved connection's id, or (深度分析
 * only) '' for 「和朗读分析用同一条」. A use holds exactly one choice, so pointing it here is what moves
 * it away from wherever it pointed before; nothing else needs writing.
 */
export function setConnectionUse(settings, use, choice) {
  const value = String(choice ?? '').trim();
  if (use === 'translation') {
    return value && value !== 'follow'
      ? { ...settings, apiMode: 'independent', selectedChannelId: value }
      : { ...settings, apiMode: 'follow' };
  }
  if (use === 'analysis') return { ...settings, tts: { ...settings.tts, analysisChannelId: value || 'follow' } };
  if (use === 'deep') return { ...settings, tts: { ...settings.tts, deepChannelId: value } };
  throw new Error(`未知用途：${use}`);
}

/** Which uses currently resolve to this connection id — for saying who is using a connection. */
export function channelUsesPointingAt(settings, channelId) {
  return CONNECTION_USES.filter(use => connectionUseChoice(settings, use) === channelId);
}

/**
 * Deleting a connection cannot leave a use pointing at nothing still in the list, so every use it
 * served moves to 跟随酒馆 first. 深度分析 is left to defer (its field stays '') when it was only
 * following 朗读分析 to this connection — moving 朗读分析 already carries it along, and leaving the
 * field empty means it keeps deferring afterwards instead of being pinned to today's fallback.
 * Returns the adjusted settings and which uses moved, for whoever deletes the connection to say so.
 */
export function reassignConnectionUsesOnDelete(settings, channelId) {
  const moved = [];
  let next = settings;
  if (connectionUseChoice(next, 'translation') === channelId) {
    next = setConnectionUse(next, 'translation', 'follow');
    moved.push('translation');
  }
  const deepOwnChoice = String(next?.tts?.deepChannelId ?? '').trim();
  const analysisPointedHere = connectionUseChoice(next, 'analysis') === channelId;
  if (analysisPointedHere) {
    next = setConnectionUse(next, 'analysis', 'follow');
    moved.push('analysis');
  }
  if (deepOwnChoice && deepOwnChoice === channelId) {
    next = setConnectionUse(next, 'deep', 'follow');
    moved.push('deep');
  } else if (!deepOwnChoice && analysisPointedHere) {
    moved.push('deep');
  }
  return { settings: next, moved };
}

// ---------------------------------------------------------------------------------------------
// 正常模式 · 翻译台 one-click packages (DESIGN §15.2 方案 C): 只看翻译 / 看得舒服 / 有声小说 / 全都要.
// Each sets exactly the nine fields below and nothing else — 只留译文、流式写回、全部连接与密钥、提取标
// 签、翻译规则文字、音色、主题 are never touched by a package, per the same section.
//
// The four packages' actual field values are a proposal — 镜译 has never shipped a package system
// before this branch — chosen to read as a cost ladder (translation only → + display → + simple
// reading → + deep reading, the priciest pass). They are pending 常夜灯's sign-off before a page ships
// them; presetContent is the one place to change once that lands.
// ---------------------------------------------------------------------------------------------

export const PRESET_MANAGED_FIELDS = Object.freeze([
  { key: 'autoGeneration', label: '自动接续翻译', path: Object.freeze(['autoGeneration']) },
  { key: 'autoSwipe', label: '切换滑动页时补译', path: Object.freeze(['autoSwipe']) },
  { key: 'coloringSpeakers', label: '说话人着色', path: Object.freeze(['coloring', 'speakers']) },
  { key: 'coloringEmotions', label: '情绪排版', path: Object.freeze(['coloring', 'emotions']) },
  { key: 'coloringEffects', label: '特效字', path: Object.freeze(['coloring', 'effects']) },
  { key: 'ttsEnabled', label: '朗读功能', path: Object.freeze(['tts', 'enabled']) },
  { key: 'ttsMode', label: '分析模式', path: Object.freeze(['tts', 'mode']) },
  { key: 'ttsAutoRead', label: '新回复自动朗读', path: Object.freeze(['tts', 'autoRead']) },
  { key: 'ttsPlayAfterGenerate', label: '点播放后做完直接播', path: Object.freeze(['tts', 'playAfterGenerate']) },
]);

export const PRESET_LABELS = Object.freeze({
  light: '只看翻译',
  comfort: '看得舒服',
  audiobook: '有声小说',
  everything: '全都要',
});

// The 药丸 pills DESIGN §15.2 names for three of the four cards; 有声小说 carries none.
export const PRESET_TIER_LABELS = Object.freeze({ light: '最省', comfort: '推荐', everything: '最费' });

const CONSOLE_PRESET_CONTENT = Object.freeze({
  light: Object.freeze({
    autoGeneration: true, autoSwipe: true,
    coloringSpeakers: false, coloringEmotions: false, coloringEffects: false,
    ttsEnabled: false, ttsMode: 'off', ttsAutoRead: false, ttsPlayAfterGenerate: true,
  }),
  comfort: Object.freeze({
    autoGeneration: true, autoSwipe: true,
    coloringSpeakers: true, coloringEmotions: true, coloringEffects: false,
    ttsEnabled: false, ttsMode: 'off', ttsAutoRead: false, ttsPlayAfterGenerate: true,
  }),
  audiobook: Object.freeze({
    autoGeneration: true, autoSwipe: true,
    coloringSpeakers: true, coloringEmotions: true, coloringEffects: false,
    ttsEnabled: true, ttsMode: 'simple', ttsAutoRead: true, ttsPlayAfterGenerate: true,
  }),
  everything: Object.freeze({
    autoGeneration: true, autoSwipe: true,
    coloringSpeakers: true, coloringEmotions: true, coloringEffects: true,
    ttsEnabled: true, ttsMode: 'deep', ttsAutoRead: true, ttsPlayAfterGenerate: true,
  }),
});

function pathGet(object, path) {
  return path.reduce((node, key) => (node === undefined || node === null ? undefined : node[key]), object);
}

function pathSet(object, path, value) {
  const [head, ...rest] = path;
  if (!rest.length) return { ...object, [head]: value };
  return { ...object, [head]: pathSet((object && typeof object === 'object' ? object[head] : undefined) ?? {}, rest, value) };
}

/** A package's content by field key, or null for an id that names no package (including ''). */
export function presetContent(id) {
  return CONSOLE_PRESET_CONTENT[id] ?? null;
}

/** Settings with one package's fields written and `preset` remembering which package that was. */
export function applyPreset(settings, id) {
  const content = presetContent(id);
  if (!content) throw new Error(`没有这个套餐：${id}`);
  let next = settings;
  for (const field of PRESET_MANAGED_FIELDS) next = pathSet(next, field.path, content[field.key]);
  return { ...next, preset: id };
}

/**
 * The gap between what `settings.preset` last set and what the managed fields hold now: each field
 * that no longer matches, with its label — the list 「看改了什么」 shows and `.length` is 「改过 N 项」.
 * Empty when no package is remembered (`preset` is '') or every managed field still matches it.
 */
export function presetDrift(settings) {
  const content = presetContent(settings?.preset);
  if (!content) return [];
  return PRESET_MANAGED_FIELDS
    .filter(field => pathGet(settings, field.path) !== content[field.key])
    .map(field => ({ key: field.key, label: field.label }));
}

function normalizePromptSection(value = {}, fallbackId = 'section-1') {
  const source = value && typeof value === 'object' ? value : {};
  return {
    id: String(source.id || fallbackId).trim() || fallbackId,
    title: String(source.title || '自定义规则').trim() || '自定义规则',
    content: String(source.content ?? ''),
    enabled: source.enabled !== false,
  };
}

function normalizePromptMode(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function promptFingerprint(value) {
  const source = String(value ?? '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${source.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function normalizePromptProfile(value = {}, fallbackId = DEFAULT_PROMPT_PROFILE.id) {
  const source = value && typeof value === 'object' ? value : {};
  const base = deepClone(DEFAULT_PROMPT_PROFILE);
  const profile = { ...base, ...source };
  profile.id = String(source.id || fallbackId).trim() || fallbackId;
  profile.name = String(source.name || base.name).trim() || base.name;
  profile.targetLanguage = normalizeTargetLanguage(source.targetLanguage ?? base.targetLanguage);
  profile.jailbreakPrompt = String(source.jailbreakPrompt ?? base.jailbreakPrompt);
  profile.corePrompt = String(source.corePrompt ?? '').trim() || CORE_TRANSLATION_SPEC;
  profile.checklistPrompt = String(source.checklistPrompt ?? '').trim() || PRE_OUTPUT_CHECKLIST;
  // v0.16.0 listed the leanings inside 翻译文风, so a profile saved then can carry one as its styleMode.
  // Move it to its own item instead of dropping it back to the default style.
  const legacyLeaning = !source.leaningMode && source.styleMode !== 'none' && Object.hasOwn(LEANING_PRESETS, source.styleMode)
    ? source.styleMode
    : null;
  profile.styleMode = normalizePromptMode(legacyLeaning ? base.styleMode : source.styleMode, [...Object.keys(STYLE_PRESETS), 'custom'], base.styleMode);
  profile.leaningMode = normalizePromptMode(legacyLeaning ?? source.leaningMode, [...Object.keys(LEANING_PRESETS), 'custom'], base.leaningMode);
  profile.nameMode = normalizePromptMode(source.nameMode, ['contextual', 'keep', 'transliterate', 'custom'], base.nameMode);
  profile.honorificMode = normalizePromptMode(source.honorificMode, ['preserve', 'translate', 'remove', 'custom'], base.honorificMode);
  profile.punctuationMode = normalizePromptMode(source.punctuationMode, ['japanese', 'chinese', 'source', 'custom'], base.punctuationMode);
  for (const key of [
    'styleCustom',
    'leaningCustom',
    'nameCustom',
    'honorificCustom',
    'punctuationCustom',
    'avoidPhrases',
    'forbiddenPhrases',
    'glossary',
    'examples',
    'postscript',
  ]) profile[key] = String(source[key] ?? base[key] ?? '');
  profile.postscriptRole = ['system', 'user', 'assistant'].includes(source.postscriptRole)
    ? source.postscriptRole
    : 'user';
  const rawSections = Array.isArray(source.customSections) ? source.customSections.slice(0, 30) : [];
  const usedIds = new Set();
  profile.customSections = rawSections.map((section, index) => {
    let normalized = normalizePromptSection(section, `section-${index + 1}`);
    while (usedIds.has(normalized.id)) normalized = { ...normalized, id: `${normalized.id}-${index + 1}` };
    usedIds.add(normalized.id);
    return normalized;
  });
  return profile;
}

export function getActivePromptProfile(settings) {
  const profiles = Array.isArray(settings?.promptProfiles) ? settings.promptProfiles : [];
  return profiles.find(profile => profile.id === settings?.selectedPromptProfileId)
    || profiles[0]
    || normalizePromptProfile();
}

// A saved band is data the probe wrote, but it also comes back from an imported profile, so every
// field is re-checked rather than trusted.
function normalizeColorBand(value) {
  if (!value || typeof value !== 'object') return null;
  const backgrounds = (Array.isArray(value.backgrounds) ? value.backgrounds : [])
    .map(item => (item && typeof item === 'object'
      ? { r: clampNumber(item.r, 0, 1, 0), g: clampNumber(item.g, 0, 1, 0), b: clampNumber(item.b, 0, 1, 0), a: 1 }
      : null))
    .filter(Boolean);
  if (!backgrounds.length) return null;
  const chromaMax = clampNumber(value.chromaMax, 0, 0.4, 0);
  if (!chromaMax) return null;
  return {
    direction: value.direction === 'dark' ? 'dark' : 'light',
    luminance: clampNumber(value.luminance, 0, 1, 0.5),
    chromaMax,
    minContrast: clampNumber(value.minContrast, 1, 21, 4.5),
    backgrounds,
  };
}

export function normalizeColoring(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    speakers: Boolean(source.speakers),
    emotions: Boolean(source.emotions),
    // A sub-switch: on paper it out-lives `speakers` in storage, but every reader (prompts.js
    // `annotationRequest`, index.js `buildSegmentStyler`) checks `speakers && effects`, so turning
    // speaker colouring off silently turns this off with it, exactly like a sub-switch under it should.
    effects: Boolean(source.effects),
    minContrast: clampNumber(source.minContrast, 1.5, 21, DEFAULT_COLORING.minContrast),
    vividness: clampNumber(source.vividness, 0, 1, DEFAULT_COLORING.vividness),
    autoSpeakers: source.autoSpeakers === undefined ? DEFAULT_COLORING.autoSpeakers : Boolean(source.autoSpeakers),
    rhythm: source.rhythm === undefined ? DEFAULT_COLORING.rhythm : Boolean(source.rhythm),
    band: normalizeColorBand(source.band),
    bandProbedAt: typeof source.bandProbedAt === 'string' ? source.bandProbedAt.slice(0, 40) : '',
  };
}

// One entry per character whose speech gets its own colour. `source` is the declared hair or eye
// colour; the displayed colour is derived from it and the current band, never stored.
export function normalizeSpeakerList(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const name = String(item.name ?? '').trim().slice(0, 60);
      if (!name) return null;
      const aliases = [...new Set((Array.isArray(item.aliases) ? item.aliases : String(item.aliases ?? '').split(/[\s,，、;；]+/))
        .map(alias => String(alias ?? '').trim().slice(0, 60))
        .filter(alias => alias && alias !== name))].slice(0, 8);
      return {
        name,
        aliases,
        source: /^#[0-9a-fA-F]{3,8}$/.test(String(item.source ?? '').trim()) ? String(item.source).trim().toLowerCase() : '',
        from: ['hair', 'eye', 'manual'].includes(item.from) ? item.from : 'hair',
      };
    })
    .filter(item => {
      if (!item || seen.has(item.name)) return false;
      seen.add(item.name);
      return true;
    })
    .slice(0, 40);
}

// Fish voice ids are 32 hex characters; a relay or a local server may name voices differently, so the
// check only keeps out whitespace and markup rather than insisting on one provider's spelling.
export function normalizeVoiceId(value) {
  const id = String(value ?? '').trim();
  return /^[A-Za-z0-9_.:@-]{1,128}$/.test(id) ? id : '';
}

function normalizeVoiceTitle(value) {
  return String(value ?? '').replace(/[\r\n<>]/g, ' ').trim().slice(0, 80);
}

// lang → voice id. An entry without a language is dropped rather than guessed at.
export function normalizeLanguageVoices(value) {
  const result = {};
  const entries = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value)
    : (Array.isArray(value) ? value : []).map(item => [item?.lang, item?.voiceId]);
  for (const [rawLang, rawId] of entries) {
    const lang = normalizeLanguageCode(rawLang);
    const voiceId = normalizeVoiceId(rawId);
    if (lang && voiceId && Object.keys(result).length < 16) result[lang] = voiceId;
  }
  return result;
}

// One row per character whose lines get their own voice. Stored per character card, like the speaker
// palette, because a name only means somebody within one cast.
//
// A row is either locked to its own voice or follows the dialogue default. Importing a cast from the
// worldbook makes unlocked rows, so changing the default changes all of them at once; typing a voice
// id into a row locks it, and a locked row keeps its voice whatever the default does later.
export function normalizeVoiceList(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const name = String(item.name ?? '').trim().slice(0, 60);
      if (!name) return null;
      const aliases = [...new Set((Array.isArray(item.aliases) ? item.aliases : String(item.aliases ?? '').split(/[\s,，、;；]+/))
        .map(alias => String(alias ?? '').trim().slice(0, 60))
        .filter(alias => alias && alias !== name))].slice(0, 8);
      const voiceId = normalizeVoiceId(item.voiceId);
      const voices = normalizeLanguageVoices(item.voices);
      // A row written before locks existed is locked exactly when it carries a voice of its own.
      const locked = item.locked === undefined ? Boolean(voiceId || Object.keys(voices).length) : item.locked === true;
      // A console of its own only when something on it was moved; null means the default console.
      // Muted: this character's lines are not read at all. Never by accident — only an explicit true.
      return { name, aliases, voiceId, voices, locked, mute: item.mute === true, title: normalizeVoiceTitle(item.title), console: normalizeConsole(item.console, { sparse: true }) };
    })
    .filter(item => {
      if (!item || seen.has(item.name)) return false;
      seen.add(item.name);
      return true;
    })
    .slice(0, 60);
}

export function normalizeFishSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  let baseUrl = String(source.baseUrl ?? DEFAULT_FISH.baseUrl).trim().replace(/\/+$/, '');
  try {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) baseUrl = DEFAULT_FISH.baseUrl;
  } catch {
    baseUrl = DEFAULT_FISH.baseUrl;
  }
  return {
    key: String(source.key ?? '').trim(),
    baseUrl,
    viaProxy: source.viaProxy === undefined ? DEFAULT_FISH.viaProxy : source.viaProxy !== false,
    model: FISH_MODELS.includes(source.model) ? source.model : DEFAULT_FISH.model,
    format: FISH_FORMATS.includes(source.format) ? source.format : DEFAULT_FISH.format,
    mp3Bitrate: [64, 128, 192].includes(Number(source.mp3Bitrate)) ? Number(source.mp3Bitrate) : DEFAULT_FISH.mp3Bitrate,
    retries: clampInteger(source.retries, 0, 5, DEFAULT_FISH.retries),
    latency: FISH_LATENCIES.includes(source.latency) ? source.latency : DEFAULT_FISH.latency,
    speed: clampNumber(source.speed, 0.5, 2, DEFAULT_FISH.speed),
    volume: clampNumber(source.volume, -20, 20, DEFAULT_FISH.volume),
    temperature: clampNumber(source.temperature, 0, 1, DEFAULT_FISH.temperature),
    topP: clampNumber(source.topP, 0, 1, DEFAULT_FISH.topP),
    normalize: source.normalize === undefined ? DEFAULT_FISH.normalize : source.normalize !== false,
    maxChars: clampInteger(source.maxChars, 200, 10000, DEFAULT_FISH.maxChars),
    timeoutSec: clampInteger(source.timeoutSec, 10, 600, DEFAULT_FISH.timeoutSec),
    concurrency: clampInteger(source.concurrency, 1, 4, DEFAULT_FISH.concurrency),
  };
}

// Voices saved by name, independent of any character card. `id` is a local handle for the rows on the
// settings page; `voiceId` is what the provider knows.
/** Consoles saved by name. The console itself is normalised the same way as any other. */
export function normalizeConsolePresets(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const name = String(item.name ?? '').replace(/[\r\n<>]/g, ' ').trim().slice(0, 40);
      if (!name) return null;
      const id = String(item.id ?? '').trim().slice(0, 40) || `console-${index + 1}`;
      return { id, name, console: normalizeConsole(item.console) };
    })
    .filter(item => {
      if (!item || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, 40);
}

export function normalizeVoiceLibrary(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const voiceId = normalizeVoiceId(item.voiceId);
      if (!voiceId) return null;
      const name = String(item.name ?? '').replace(/[\r\n<>]/g, ' ').trim().slice(0, 60) || voiceId.slice(0, 8);
      const id = String(item.id ?? '').trim().slice(0, 40) || `voice-${index + 1}`;
      return { id, name, voiceId, lang: normalizeLanguageCode(item.lang), title: normalizeVoiceTitle(item.title) };
    })
    .filter(item => {
      if (!item || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, 200);
}

/**
 * The bindings brought along when a library entry's voice id changes.
 *
 * A character row, the narrator and the dialogue default all name a voice by its id, and the library
 * is where a reader edits that id. The entry is the identity: an id edited in the library moves every
 * binding that held the old id onto the new one, so the name keeps reading in the voice the reader
 * just chose for it. Returns the settings untouched when no entry moved.
 */
export function followVoiceLibrary(previousLibrary, settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const before = new Map(normalizeVoiceLibrary(previousLibrary).map(entry => [entry.id, entry.voiceId]));
  const moved = new Map();
  for (const entry of normalizeVoiceLibrary(settings.voiceLibrary)) {
    const old = before.get(entry.id);
    if (old && old !== entry.voiceId) moved.set(old, entry.voiceId);
  }
  if (!moved.size) return settings;
  const follow = id => (typeof id === 'string' && moved.has(id) ? moved.get(id) : id);
  const followTable = table => (table && typeof table === 'object'
    ? Object.fromEntries(Object.entries(table).map(([lang, id]) => [lang, follow(id)]))
    : table);
  const tts = settings.tts && typeof settings.tts === 'object' ? settings.tts : {};
  const nextTts = { ...tts, narratorVoice: follow(tts.narratorVoice), dialogueVoice: follow(tts.dialogueVoice), narratorVoices: followTable(tts.narratorVoices) };
  // A title is the provider's name for the old id; it goes when the id does.
  if (nextTts.narratorVoice !== tts.narratorVoice) nextTts.narratorTitle = '';
  if (nextTts.dialogueVoice !== tts.dialogueVoice) nextTts.dialogueTitle = '';
  const ttsVoices = Object.fromEntries(Object.entries(settings.ttsVoices ?? {}).map(([key, rows]) => [key, Array.isArray(rows)
    ? rows.map(row => {
      if (!row || typeof row !== 'object') return row;
      const voiceId = follow(row.voiceId);
      return { ...row, voiceId, voices: followTable(row.voices), ...(voiceId !== row.voiceId ? { title: '' } : {}) };
    })
    : rows]));
  return { ...settings, tts: nextTts, ttsVoices };
}

function normalizeTtsContext(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    character: source.character === undefined ? DEFAULT_TTS.context.character : source.character !== false,
    worldbook: source.worldbook === undefined ? DEFAULT_TTS.context.worldbook : source.worldbook !== false,
    recent: source.recent === undefined ? DEFAULT_TTS.context.recent : source.recent !== false,
    floors: clampInteger(source.floors, 0, 10, DEFAULT_TTS.context.floors),
  };
}

/** 0 keeps a floor in one request; anything else is clamped to a sensible batch. */
export function normalizeBatchSize(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_TTS.batchSize;
  const count = Number(value);
  if (!Number.isFinite(count)) return DEFAULT_TTS.batchSize;
  if (count <= 0) return 0;
  return Math.min(60, Math.max(4, Math.round(count)));
}

export function normalizeTts(value) {
  const source = value && typeof value === 'object' ? value : {};
  const tags = parseTagNames(source.sourceTags ?? DEFAULT_TTS.sourceTags);
  // Older settings named how the audio was made (whole floor, stream, sentence) and how deeply the
  // floor was read (auto, deep, light, annotations). Only the depth survives as the mode: the whole
  // floor read deeply, the stream read simply, and a depth named outright wins over either.
  const legacyMode = source.mode === 'floor' ? 'deep' : ['stream', 'sentence'].includes(source.mode) ? 'simple' : source.mode;
  const wanted = TTS_MODES.includes(source.mode)
    ? source.mode
    : source.analysis === 'deep' ? 'deep' : ['light', 'annotations'].includes(source.analysis) ? 'simple' : legacyMode;
  const mode = wanted;
  return {
    enabled: source.enabled === true,
    side: TTS_SIDES.includes(source.side) ? source.side : DEFAULT_TTS.side,
    mode: TTS_MODES.includes(mode) ? mode : DEFAULT_TTS.mode,
    range: TTS_RANGES.includes(source.range) ? source.range : DEFAULT_TTS.range,
    emotionCues: source.emotionCues === undefined ? DEFAULT_TTS.emotionCues : source.emotionCues !== false,
    sanitizeHtml: source.sanitizeHtml === undefined ? DEFAULT_TTS.sanitizeHtml : source.sanitizeHtml !== false,
    console: normalizeConsole(source.console),
    prosodySplit: source.prosodySplit === undefined ? DEFAULT_TTS.prosodySplit : source.prosodySplit !== false,
    autoGenerate: source.autoGenerate === true,
    downloadScope: TTS_DOWNLOAD_SCOPES.includes(source.downloadScope) ? source.downloadScope : DEFAULT_TTS.downloadScope,
    requestUnit: TTS_REQUEST_UNITS.includes(source.requestUnit) ? source.requestUnit : DEFAULT_TTS.requestUnit,
    voiceScope: TTS_VOICE_SCOPES.includes(source.voiceScope) ? source.voiceScope : DEFAULT_TTS.voiceScope,
    playAfterGenerate: source.playAfterGenerate === undefined ? DEFAULT_TTS.playAfterGenerate : source.playAfterGenerate !== false,
    tamePunctuation: source.tamePunctuation === undefined ? DEFAULT_TTS.tamePunctuation : source.tamePunctuation !== false,
    prompts: {
      // The light reading's prompt of earlier versions is the simple reading's now.
      simple: typeof source.prompts?.simple === 'string' ? normalizeNewlines(source.prompts.simple).slice(0, 12000)
        : typeof source.prompts?.light === 'string' ? normalizeNewlines(source.prompts.light).slice(0, 12000) : '',
      deep: typeof source.prompts?.deep === 'string' ? normalizeNewlines(source.prompts.deep).slice(0, 12000) : '',
    },
    // The connection chosen for analysis in earlier versions is the deep reading's now. The reading's
    // own choice is made explicit in mergeSettings, which knows the translation's.
    analysisChannelId: String(source.analysisChannelId ?? '').trim().slice(0, 80),
    deepChannelId: String(source.deepChannelId ?? source.channelId ?? '').trim().slice(0, 80),
    analysisLimitSec: clampInteger(source.analysisLimitSec, 20, 900, DEFAULT_TTS.analysisLimitSec),
    batchSize: normalizeBatchSize(source.batchSize),
    askAnalysis: TTS_ASK_MODES.includes(source.askAnalysis) ? source.askAnalysis : DEFAULT_TTS.askAnalysis,
    deepUnlocked: source.deepUnlocked === true,
    quotePairs: normalizePairStrings(source.quotePairs, DEFAULT_QUOTE_PAIRS),
    skipPairs: normalizePairStrings(source.skipPairs, DEFAULT_SKIP_PAIRS),
    context: normalizeTtsContext(source.context),
    sourceTags: tags,
    narratorVoice: normalizeVoiceId(source.narratorVoice),
    narratorTitle: normalizeVoiceTitle(source.narratorTitle),
    narratorVoices: normalizeLanguageVoices(source.narratorVoices),
    dialogueVoice: normalizeVoiceId(source.dialogueVoice),
    dialogueFallback: TTS_DIALOGUE_FALLBACKS.includes(source.dialogueFallback) ? source.dialogueFallback : DEFAULT_TTS.dialogueFallback,
    speechMarks: source.speechMarks === true,
    autoRead: source.autoRead === true,
    dialogueTitle: normalizeVoiceTitle(source.dialogueTitle),
    fish: normalizeFishSettings(source.fish),
  };
}

export function mergeSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const merged = { ...deepClone(DEFAULT_SETTINGS), ...source };
  const sourceSchemaVersion = clampInteger(source.schemaVersion, 0, 999, 0);
  // A reader who has never saved anything here gets the small normal-mode rail; anything saved by
  // schemaVersion 12 or earlier (or missing uiMode outright, which only an old save can do) lands in
  // advanced mode instead, so every control it already relied on is still where it was. A round trip
  // through this schemaVersion keeps whatever the reader picked.
  merged.uiMode = Object.keys(source).length === 0
    ? 'normal'
    : (sourceSchemaVersion <= 12 || typeof source.uiMode !== 'string')
      ? 'advanced'
      : (UI_MODES.includes(source.uiMode) ? source.uiMode : 'advanced');
  merged.preset = CONSOLE_PRESET_IDS.includes(source.preset) ? source.preset : '';
  merged.schemaVersion = 13;
  merged.theme = ['day', 'night', 'fresh', 'vampire', 'glass'].includes(source.theme) ? source.theme : 'day';
  delete merged.chunkChars;
  delete merged.chunkSegments;
  merged.retries = clampInteger(merged.retries, 0, 5, DEFAULT_SETTINGS.retries);
  merged.apiMode = ['follow', 'independent'].includes(merged.apiMode) ? merged.apiMode : DEFAULT_SETTINGS.apiMode;
  const hasLegacyChannel = ['apiUrl', 'apiKey', 'apiModel'].some(key => String(source[key] ?? '').trim());
  const legacyChannel = normalizeChannel({
    id: DEFAULT_CHANNEL.id,
    name: hasLegacyChannel ? '迁移的副 API' : DEFAULT_CHANNEL.name,
    apiUrl: source.apiUrl,
    apiKey: source.apiKey,
    apiModel: source.apiModel,
    timeoutSec: source.timeoutSec,
    maxTokens: source.maxTokens,
    temperature: source.temperature,
    excludeParams: source.excludeParams,
  });
  const rawChannels = Array.isArray(source.channels) && source.channels.length ? source.channels : [legacyChannel];
  const usedIds = new Set();
  merged.channels = rawChannels.map((channel, index) => {
    let normalized = normalizeChannel(channel, index ? `channel-${index + 1}` : DEFAULT_CHANNEL.id);
    while (usedIds.has(normalized.id)) normalized = { ...normalized, id: `${normalized.id}-${index + 1}` };
    usedIds.add(normalized.id);
    return normalized;
  });
  merged.selectedChannelId = merged.channels.some(channel => channel.id === source.selectedChannelId)
    ? source.selectedChannelId
    : merged.channels[0].id;
  const legacyBodyTag = typeof source.bodyTag === 'string' ? source.bodyTag : '';
  merged.bodyTags = parseTagNames(
    Array.isArray(source.bodyTags) || typeof source.bodyTags === 'string' ? source.bodyTags : [legacyBodyTag],
    DEFAULT_SETTINGS.bodyTags,
  );
  merged.excludedTags = parseTagNames(source.excludedTags);
  merged.replaceTags = parseTagNames(source.replaceTags);
  merged.preserveLineRules = typeof source.preserveLineRules === 'string'
    ? normalizeNewlines(source.preserveLineRules)
    : '';
  delete merged.bodyTag;
  const oldTranslationPrompt = typeof source.translationPrompt === 'string' ? source.translationPrompt.trim() : '';
  const migratedSections = oldTranslationPrompt && oldTranslationPrompt !== LEGACY_DEFAULT_TRANSLATION_PROMPT.trim()
    ? [{ id: 'migrated-translation-rule', title: '从旧版迁移的翻译规则', content: oldTranslationPrompt, enabled: true }]
    : [];
  const fallbackProfile = normalizePromptProfile({
    ...DEFAULT_PROMPT_PROFILE,
    glossary: typeof source.glossary === 'string' ? source.glossary : '',
    customSections: migratedSections,
  });
  const rawPromptProfiles = Array.isArray(source.promptProfiles) && source.promptProfiles.length
    ? source.promptProfiles
    : [fallbackProfile];
  const needsPromptUpgrade = sourceSchemaVersion < 8;
  const needsBundledPreludeRemoval = sourceSchemaVersion < 10;
  const usedPromptProfileIds = new Set();
  merged.promptProfiles = rawPromptProfiles.slice(0, 20).map((profile, index) => {
    const upgraded = needsPromptUpgrade && profile && typeof profile === 'object' ? { ...profile } : profile;
    if (upgraded && typeof upgraded === 'object') {
      if (KNOWN_DEFAULT_CORE_PROMPTS.some(prompt => normalizeNewlines(upgraded.corePrompt).trim() === normalizeNewlines(prompt).trim())) upgraded.corePrompt = CORE_TRANSLATION_SPEC;
      if (KNOWN_DEFAULT_CHECKLIST_PROMPTS.some(prompt => normalizeNewlines(upgraded.checklistPrompt).trim() === normalizeNewlines(prompt).trim())) upgraded.checklistPrompt = PRE_OUTPUT_CHECKLIST;
      if (needsBundledPreludeRemoval && promptFingerprint(upgraded.jailbreakPrompt) === LEGACY_BUNDLED_PRELUDE_FINGERPRINT) upgraded.jailbreakPrompt = '';
    }
    let normalized = normalizePromptProfile(upgraded, index ? `prompt-profile-${index + 1}` : DEFAULT_PROMPT_PROFILE.id);
    while (usedPromptProfileIds.has(normalized.id)) normalized = { ...normalized, id: `${normalized.id}-${index + 1}` };
    usedPromptProfileIds.add(normalized.id);
    return normalized;
  });
  merged.selectedPromptProfileId = merged.promptProfiles.some(profile => profile.id === source.selectedPromptProfileId)
    ? source.selectedPromptProfileId
    : merged.promptProfiles[0].id;
  merged.segmentPrefix = typeof merged.segmentPrefix === 'string' ? merged.segmentPrefix : '';
  merged.segmentSuffix = typeof merged.segmentSuffix === 'string' ? merged.segmentSuffix : '';
  // 0.12.4 shipped this as a pure affix switch; the intent was always one line per paragraph.
  merged.paragraphPerLine = Boolean(merged.paragraphPerLine ?? merged.affixPerLine);
  merged.carryFormatting = merged.carryFormatting !== false;
  delete merged.affixPerLine;
  merged.translationPrefix = typeof merged.translationPrefix === 'string' ? merged.translationPrefix : '';
  merged.translationSuffix = typeof merged.translationSuffix === 'string' ? merged.translationSuffix : '';
  // Older versions added their braces outside the user's fields. Preserve that appearance once.
  if (sourceSchemaVersion < 11 && Object.keys(source).length) {
    merged.translationPrefix = `{${typeof source.translationPrefix === 'string' ? source.translationPrefix : ''}`;
    merged.translationSuffix = `${typeof source.translationSuffix === 'string' ? source.translationSuffix : ''}}`;
  }
  merged.contextMessages = clampInteger(merged.contextMessages, 1, 20, DEFAULT_SETTINGS.contextMessages);
  // Worldbook whitelist for the token-saving mode, stored per character card so switching
  // characters switches the selection with it.
  merged.worldInfoWhitelist = {};
  const rawWhitelist = source.worldInfoWhitelist && typeof source.worldInfoWhitelist === 'object' ? source.worldInfoWhitelist : {};
  for (const [characterKey, list] of Object.entries(rawWhitelist)) {
    const picks = (Array.isArray(list) ? list : [])
      .filter(item => item && typeof item === 'object' && item.world && Number.isInteger(Number(item.uid)))
      .map(item => ({ world: String(item.world), uid: Number(item.uid) }));
    if (picks.length) merged.worldInfoWhitelist[characterKey] = picks;
  }
  // The world books switched on for the token-saving mode, per character card like the picks. A card with
  // no list yet has the books of its picks on (the whitelist before books could be switched).
  merged.worldInfoBooks = {};
  const rawBooks = source.worldInfoBooks && typeof source.worldInfoBooks === 'object' ? source.worldInfoBooks : {};
  for (const [characterKey, list] of Object.entries(rawBooks)) {
    if (!Array.isArray(list)) continue;
    merged.worldInfoBooks[characterKey] = [...new Set(list.map(name => String(name ?? '')).filter(Boolean))];
  }
  merged.coloring = normalizeColoring(source.coloring);
  // The speaker palette follows the character card, like the worldbook whitelist above.
  merged.speakerPalette = {};
  const rawPalette = source.speakerPalette && typeof source.speakerPalette === 'object' ? source.speakerPalette : {};
  for (const [characterKey, list] of Object.entries(rawPalette)) {
    const speakers = normalizeSpeakerList(list);
    if (speakers.length) merged.speakerPalette[characterKey] = speakers;
  }
  merged.tts = normalizeTts(source.tts);
  // The connection page is a shelf: each feature names the connection it uses, and nothing follows
  // another feature's choice behind the reader's back. A reading that used to follow the translation
  // is pinned, once, to whatever the translation used at the time, so nothing changes on the day this
  // is read and nothing changes silently after it. A choice that points at a deleted connection is
  // treated the same way.
  merged.tts.analysisChannelId = resolveFeatureChannel(merged.tts.analysisChannelId, merged);
  if (merged.tts.deepChannelId && merged.tts.deepChannelId !== 'follow' && !merged.channels.some(channel => channel.id === merged.tts.deepChannelId)) {
    merged.tts.deepChannelId = '';
  }
  // Voices follow the character card for the same reason the palette does.
  merged.ttsVoices = {};
  const rawVoices = source.ttsVoices && typeof source.ttsVoices === 'object' ? source.ttsVoices : {};
  for (const [characterKey, list] of Object.entries(rawVoices)) {
    const voices = normalizeVoiceList(list);
    if (voices.length) merged.ttsVoices[characterKey] = voices;
  }
  merged.voiceLibrary = normalizeVoiceLibrary(source.voiceLibrary);
  merged.consolePresets = normalizeConsolePresets(source.consolePresets);
  merged.includeWorldbook = Boolean(merged.includeWorldbook);
  merged.includeCharacterCard = Boolean(merged.includeCharacterCard);
  merged.includeRecentContext = Boolean(merged.includeRecentContext);
  merged.autoGeneration = Boolean(merged.autoGeneration);
  merged.autoSwipe = Boolean(merged.autoSwipe);
  merged.autoEdit = Boolean(merged.autoEdit);
  merged.streamingWriteback = Boolean(merged.streamingWriteback);
  merged.translationOnly = merged.translationOnly === true;
  merged.showFloatingButton = Boolean(merged.showFloatingButton);
  merged.floatingStyle = FLOATING_STYLES.includes(merged.floatingStyle) ? merged.floatingStyle : DEFAULT_SETTINGS.floatingStyle;
  merged.floorButtons = FLOOR_BUTTON_MODES.includes(merged.floorButtons)
    ? merged.floorButtons
    : (FLOOR_BUTTON_LEGACY[merged.floorButtons] ?? DEFAULT_SETTINGS.floorButtons);
  merged.leftHanded = merged.leftHanded === true;
  for (const key of [
    'profileId',
    'apiUrl',
    'apiKey',
    'apiModel',
    'timeoutSec',
    'maxTokens',
    'temperature',
    'excludeParams',
    'glossary',
    'basePrompt',
    'translationPrompt',
    'referencePrompt',
    'reviewPrompt',
    'outputPrompt',
    'repairPrompt',
  ]) {
    delete merged[key];
  }
  return merged;
}

export function normalizeNewlines(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n');
}

// No tokenizer ships with the extension, so request size is estimated: CJK-heavy prompt text runs
// close to one token per character while JSON scaffolding and Latin text average roughly four
// characters per token under common vocabularies.
const CJK_CHAR_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/g;

export function estimateRequestTokens(messages) {
  let text = '';
  for (const message of Array.isArray(messages) ? messages : []) {
    const content = message?.content;
    text += typeof content === 'string' ? content : JSON.stringify(content ?? '');
  }
  const cjk = (text.match(CJK_CHAR_RE) || []).length;
  return Math.round(cjk * 1.05 + (text.length - cjk) / 3.8);
}

export function normalizeOpenAiBaseUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('请填写独立副 API 地址。');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('独立副 API 地址不是有效 URL。');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('独立副 API 地址只支持 http 或 https。');
  url.hash = '';
  let pathname = url.pathname.replace(/\/+$/, '');
  pathname = pathname.replace(/\/chat\/completions$/i, '');
  url.pathname = pathname || '/v1';
  return url.toString().replace(/\/$/, '');
}

export function createIndependentRequest(settings, messages) {
  const channel = Array.isArray(settings?.channels)
    ? getActiveChannel(settings)
    : normalizeChannel(settings);
  const model = String(channel.model ?? '').trim();
  if (!model) throw new Error('请填写独立副 API 模型。');
  if (!Array.isArray(messages) || !messages.length) throw new Error('翻译请求没有消息内容。');
  // The connection's own last word, after everything the feature had to say.
  const tail = String(channel.postscript ?? '').trim();
  const sent = tail ? [...messages, { role: channel.postscriptRole || 'user', content: tail }] : messages;
  const payload = {
    stream: false,
    messages: sent,
    model,
    chat_completion_source: 'openai',
    reverse_proxy: normalizeOpenAiBaseUrl(channel.url),
    proxy_password: String(channel.key ?? ''),
    temperature: channel.temperature,
    max_tokens: channel.maxTokens,
    presence_penalty: 0,
    frequency_penalty: 0,
  };
  // Sent only when the channel picks one; stays excludable like the numeric knobs above.
  if (channel.reasoningEffort) payload.reasoning_effort = channel.reasoningEffort;
  const protectedFields = new Set(['stream', 'messages', 'model', 'chat_completion_source', 'reverse_proxy', 'proxy_password']);
  for (const parameter of channel.excludeParams) {
    if (!protectedFields.has(parameter)) delete payload[parameter];
  }
  return payload;
}

export function parseModelListResponse(data) {
  const list = data?.data ?? data?.models ?? [];
  if (!Array.isArray(list)) return [];
  return [...new Set(list
    .map(item => typeof item === 'string' ? item : item?.id)
    .filter(item => typeof item === 'string' && item.trim())
    .map(item => item.trim()))].sort();
}

// A generation's type as SillyTavern means it: no type at all is its own 'normal'.
function generationKind(type) {
  return typeof type === 'string' && type ? type : 'normal';
}

/**
 * The generation a rendered reply belongs to: opened when a real generation starts, consumed by the
 * render of its reply.
 *
 * The render does not always report the type the generation started with. Saving a reply without
 * streaming, SillyTavern turns every type but a continuation into 'normal' once the last message is
 * the user's — which it always is after 重新生成, since the old reply is deleted first — and renders a
 * continuation as 'appendFinal'; the match follows both. What never matches: the renders of messages no
 * generation made, a greeting ('first_message') and a slash command's insert ('command'), and a
 * 'normal' render while a continuation is pending.
 */
export function createGenerationGate() {
  let pending = null;
  let untyped = false;
  const typed = type => typeof type === 'string' && type !== '';
  return Object.freeze({
    begin(chatId, type, dryRun = false) {
      const kind = generationKind(type);
      if (!chatId || dryRun || ['quiet', 'impersonate'].includes(kind)) return false;
      pending = { chatId: String(chatId), type: kind };
      untyped = !typed(type);
      return true;
    },
    // `newest`: the render is of a message that was not there, or not like that, when the generation
    // began. A reply always is. A render that names no type is a script redrawing a floor — the host
    // names the type of every reply it renders — unless the generation itself was started without one.
    consume(chatId, type, { newest = true } = {}) {
      if (!pending || pending.chatId !== String(chatId) || !newest) return false;
      if (!typed(type) && !untyped) return false;
      const rendered = generationKind(type);
      const continuing = ['continue', 'append', 'appendFinal'].includes(pending.type);
      const matched = rendered === pending.type
        || (pending.type === 'continue' && rendered === 'appendFinal')
        || (rendered === 'normal' && !continuing);
      if (matched) pending = null;
      return matched;
    },
    clear() {
      pending = null;
    },
    peek() {
      return pending ? { ...pending } : null;
    },
  });
}

// Affixes normally travel inside AFFIX_START/AFFIX_END so they can be removed exactly. Editors,
// clipboards and third-party regex rules do sometimes drop the invisible pair while leaving the
// visible text behind; re-rendering then nested a second copy inside the first, which is what
// "双重前后缀标签" looks like.
//
// Only a matching open/close tag pair is repaired. Symbol affixes such as ☆{ … } are indistinguishable
// from ordinary punctuation a scene may legitimately open and close with, and guessing there would
// eat real source text, so those are reported rather than rewritten.
const AFFIX_OPEN_TAG_RE = /^<[A-Za-z][A-Za-z0-9_:-]*(?:\s[^<>]*)?>$/;
const AFFIX_CLOSE_TAG_RE = /^<\/[A-Za-z][A-Za-z0-9_:-]*\s*>$/;

function repairableAffixPair(prefix, suffix) {
  return AFFIX_OPEN_TAG_RE.test(String(prefix ?? '')) && AFFIX_CLOSE_TAG_RE.test(String(suffix ?? ''));
}

function affixLeftoverStripper(metadata) {
  const prefix = String(metadata?.segment_prefix ?? '');
  const suffix = String(metadata?.segment_suffix ?? '');
  if (!repairableAffixPair(prefix, suffix)) return value => value;
  return value => {
    const text = String(value ?? '');
    return text.startsWith(prefix) && text.endsWith(suffix) && text.length >= prefix.length + suffix.length
      ? text.slice(prefix.length, text.length - suffix.length)
      : text;
  };
}

// True when a floor still holds a translation written before the owned block markers: a `{…}` line
// outside every owned block. An owned affix may end in `{` itself (the default translation prefix, a
// segment prefix), so the owned blocks are set aside before looking.
export function hasLegacyTranslation(text) {
  return normalizeNewlines(String(text ?? ''))
    .replace(TRANSLATION_BLOCK_RE, '')
    .replace(SOURCE_BLOCK_RE, '')
    .replace(HIDDEN_BLOCK_RE, '')
    .includes(`{${INVISIBLE_MARKER}`);
}

// True when a floor still carries visible tag affixes that have lost their invisible boundaries.
export function detectUnmarkedAffixes(text, metadata) {
  const stripped = normalizeNewlines(String(text ?? ''))
    .replace(TRANSLATION_BLOCK_RE, '')
    .replace(SOURCE_BLOCK_RE, (_match, inner) => inner.replace(AFFIX_RE, ''))
    .replace(HIDDEN_BLOCK_RE, '');
  return [
    [metadata?.segment_prefix, metadata?.segment_suffix],
    [metadata?.translation_prefix, metadata?.translation_suffix],
  ].some(([prefix, suffix]) => repairableAffixPair(prefix, suffix)
    && stripped.includes(String(prefix)) && stripped.includes(String(suffix)));
}

// The source view (default) restores replace-tag regions to their original language for
// re-translation; the prompt view keeps the visible translation and drops the hidden original.
export function stripGeneratedTranslationLines(text, metadata, view = 'source') {
  const upgraded = upgradeLegacyBilingual(text, metadata);
  const stripLeftoverAffix = affixLeftoverStripper(metadata);
  const collapsed = view === 'prompt'
    ? upgraded.replace(HIDDEN_BLOCK_RE, '')
    : upgraded.replace(REPLACE_PAIR_RE, (_match, original) => original);
  return collapsed
    .replace(TRANSLATION_BLOCK_RE, '')
    .replace(SOURCE_BLOCK_RE, (_match, source) => stripLeftoverAffix(source.replace(AFFIX_RE, '')))
    .replace(GENERATED_BLOCK_RE, '')
    // A lyric line's inline "(" / ")" / restored <br> (renderLyricPair) are marked affixes standing
    // outside both blocks above, the only ones ever written there — every other marked affix has
    // always been nested inside a source or translation block and is already gone by this point, so
    // this pass is a no-op for a floor without lyric lines.
    .replace(AFFIX_RE, '')
    .split('\n')
    .filter(line => !LEGACY_GENERATED_LINE_RE.test(line))
    .join('\n');
}

// `\n?`: an ordinary bilingual unit still writes the real newline that puts the translation on its own
// line, but a lyric line's translation follows its source block on the very same line — see
// renderLyricPair — with nothing at all between SOURCE_END and TRANSLATION_START to require here.
function generatedBlockAfter(value) {
  const current = String(value ?? '');
  const owned = current.match(new RegExp(`^\\n?${TRANSLATION_START}([\\s\\S]*?)${TRANSLATION_END}`));
  if (owned) return { full: owned[0], text: owned[1].replace(AFFIX_RE, ''), modern: true, owned: true };
  const modern = current.match(new RegExp(`^\\n\\{${INVISIBLE_MARKER}([\\s\\S]*?)${INVISIBLE_MARKER}\\}(?=\\n|$)`));
  if (modern) return { full: modern[0], text: modern[1], modern: true };
  const legacy = current.match(new RegExp(`^\\n\\{${INVISIBLE_MARKER}([^\\r\\n]*)\\}(?=\\n|$)`));
  return legacy ? { full: legacy[0], text: legacy[1], modern: false } : null;
}

export function translationAffixes(options = {}) {
  return {
    prefix: typeof options.translationPrefix === 'string' ? options.translationPrefix : DEFAULT_SETTINGS.translationPrefix,
    suffix: typeof options.translationSuffix === 'string' ? options.translationSuffix : DEFAULT_SETTINGS.translationSuffix,
  };
}

// The affixes sit inside the invisible markers, so a stored block has to shed them before it is read back.
export function stripTranslationAffixes(text, affixes = {}) {
  let body = String(text ?? '');
  const prefix = String(affixes.prefix ?? '');
  const suffix = String(affixes.suffix ?? '');
  if (prefix && body.startsWith(prefix)) body = body.slice(prefix.length);
  if (suffix && body.endsWith(suffix)) body = body.slice(0, body.length - suffix.length);
  return body;
}

export function extractGeneratedTranslations(text, options = {}) {
  const source = normalizeNewlines(text);
  const segmented = segmentSource(stripGeneratedTranslationLines(source), {
    ...options, legacyWrappers: !source.includes(SOURCE_START) && source.includes(`{${INVISIBLE_MARKER}`),
  });
  const prefix = typeof options.segmentPrefix === 'string' ? options.segmentPrefix : '';
  const suffix = typeof options.segmentSuffix === 'string' ? options.segmentSuffix : '';
  const translations = new Map();
  let cursor = 0;

  for (const layoutPart of segmented.layout.filter(part => part.type === 'segment')) {
    const ids = Array.isArray(layoutPart.ids) && layoutPart.ids.length ? layoutPart.ids : [layoutPart.id];
    // renderLyricPair writes only the row's bare text (its own trailing <br>, if any, restored outside
    // the source block) inside SOURCE_START/END, so a lyric part is looked up by that same bare text.
    const rawOriginal = layoutPart.sourceText ?? layoutPart.text;
    const original = layoutPart.lyric ? String(rawOriginal).replace(TRAILING_BR_RE, '') : rawOriginal;
    const ownedSources = new RegExp(SOURCE_BLOCK_RE.source, 'g');
    ownedSources.lastIndex = cursor;
    let match, start = -1, renderedSource = '';
    while ((match = ownedSources.exec(source))) {
      if (match[1].replace(AFFIX_RE, '') !== original) continue;
      start = match.index;
      renderedSource = match[0];
      break;
    }
    if (start < 0) {
      renderedSource = `${prefix}${layoutPart.sourceText ?? layoutPart.text}${suffix}`;
      start = source.indexOf(renderedSource, cursor);
    }
    if (start < 0) continue;
    const end = start + renderedSource.length;
    const generated = generatedBlockAfter(source.slice(end));
    if (generated?.text?.trim()) {
      const body = generated.owned ? generated.text : stripTranslationAffixes(generated.text, {
        prefix: options.translationPrefix ?? '', suffix: options.translationSuffix ?? '',
      });
      const lines = generated.modern ? normalizeNewlines(body).split('\n') : [body];
      if (ids.length === lines.length) {
        ids.forEach((id, index) => {
          const translation = lines[index].trim();
          if (translation) translations.set(id, translation);
        });
      } else if (ids.length === 1) {
        translations.set(ids[0], normalizeNewlines(body).replace(/\n+/g, ' ').trim());
      }
    }
    cursor = end + (generated?.full?.length || 0);
  }
  return translations;
}

/**
 * The records a floor with only its translation left in it (「只留译文」) may have, for the swipe shown:
 * the message's own and the swipe's. Each keeps the bilingual text the floor would otherwise hold, as
 * `mirror`, with the fingerprint of what was written to the floor.
 */
function strippedRecords(message) {
  const swipeId = Number(message?.swipe_id ?? 0);
  const records = [message?.extra?.[MESSAGE_META_KEY], message?.swipe_info?.[swipeId]?.extra?.[MESSAGE_META_KEY]]
    .filter(meta => meta?.stripped === true && typeof meta.mirror === 'string');
  return records[0] && records[1] === records[0] ? [records[0]] : records;
}

/**
 * A floor's full text, wherever it is kept. Everything that reads a floor reads it through here, so
 * translating again, reading the original aloud and the main model's prompt all find the original of a
 * floor with only its translation left in it.
 *
 * A record is told to be this floor's by what the floor holds, never by the swipe's number: the host
 * renumbers nothing when a swipe is deleted, and a new swipe starts with a copy of the record of the
 * swipe before it.
 *
 * - The floor holds exactly what was written to it: its text is the mirror.
 * - It holds the bilingual text itself, or what the main model was shown of it and more (a continue):
 *   an ordinary floor again.
 * - It still carries the record's translation, changed (by hand, by another extension, a continue from
 *   the translation): `diverged`. Its text is what it holds, and nothing may translate it — that would
 *   take the translation for the original and write over the original in the mirror.
 * - Anything else is not the record's floor at all (a new reply on a copied record): ordinary.
 */
export function readFloor(message) {
  const text = typeof message?.mes === 'string' ? message.mes : '';
  const ordinary = { text, stripped: false, diverged: false, metadata: null };
  const records = strippedRecords(message);
  if (!records.length) return ordinary;
  const fingerprint = hashTextSync(text);
  const written = records.find(meta => meta.projection_hash === fingerprint);
  if (written) return { text: written.mirror, stripped: true, diverged: false, metadata: written };
  for (const metadata of records) {
    if (normalizeNewlines(text) === normalizeNewlines(metadata.mirror) || continuedFromMirror(text, metadata)) continue;
    if (carriesTranslation(text, metadata)) return { text, stripped: true, diverged: true, metadata };
  }
  return ordinary;
}

/** The record `readFloor` holds this floor to, or null. */
export function strippedMetadataOf(message) {
  return readFloor(message).metadata;
}

// Blank lines and the spaces at line ends are what the host's clean-up of a reply changes.
function looseText(value) {
  return normalizeNewlines(value).replace(/[^\S\n]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

// Only a floor with a bilingual region can tell: what the main model sees of a replace-tag region is the
// translation, which is what the floor holds anyway.
function continuedFromMirror(text, metadata) {
  if (!metadata.mirror.includes(TRANSLATION_START)) return false;
  const shown = looseText(stripGeneratedTranslationLines(metadata.mirror, metadata, 'prompt'));
  return Boolean(shown) && looseText(text).startsWith(shown);
}

/**
 * Whether a floor still carries the record's translation: one of its lines word for word, or, when every
 * line was touched, most of its wording. A reply in the original's language shares next to none of it.
 */
function carriesTranslation(text, metadata) {
  const mirror = normalizeNewlines(metadata.mirror);
  const bodies = [...mirror.matchAll(TRANSLATION_BLOCK_RE)].map(match => match[1]);
  for (const match of mirror.matchAll(REPLACE_PAIR_BOTH_RE)) bodies.push(match[1]);
  const bare = value => String(value ?? '').replace(AFFIX_RE, '').replace(/<[^<>]*>/g, '');
  const original = bare(stripGeneratedTranslationLines(mirror, metadata));
  const lines = bodies.flatMap(body => bare(body).split('\n')).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return false;
  const floor = bare(text);
  // A line the translation left as it was (a name, a number) proves nothing.
  if (lines.some(line => [...line].length >= 6 && floor.includes(line) && !original.includes(line))) return true;
  const pairs = value => {
    const chars = [...value.replace(/\s+/g, '')];
    const found = new Set();
    for (let index = 0; index < chars.length - 1; index += 1) found.add(`${chars[index]}${chars[index + 1]}`);
    return found;
  };
  const wanted = pairs(lines.join(''));
  if (!wanted.size) return false;
  const present = pairs(floor);
  let shared = 0;
  for (const pair of wanted) if (present.has(pair)) shared += 1;
  return shared / wanted.size >= 0.6;
}

export function floorText(message) {
  return readFloor(message).text;
}

/**
 * What the main model is shown of a floor with only its translation left in it: the text it would have
 * been shown of the bilingual floor, which the prompt view then takes the translation out of as for
 * every other floor. `item.mes` has already been through the host's prompt regexes (and may carry the
 * reasoning before it and attachments after it); `regexed` runs the same regexes on another text when
 * the host lends them. Null when the floor is not one of these; `{ mes: null }` when what the host made
 * of it cannot be found in the item.
 */
export function restoreStrippedForPrompt(item, message, regexed = value => value) {
  const floor = readFloor(message);
  if (!floor.stripped || floor.diverged) return null;
  const said = String(item?.mes ?? '');
  const pairs = [[regexed(message.mes), regexed(floor.text)], [message.mes, floor.text]];
  for (const [from, to] of pairs) {
    if (typeof from !== 'string' || !from) continue;
    const at = said.indexOf(from);
    if (at >= 0) return { mes: `${said.slice(0, at)}${to}${said.slice(at + from.length)}` };
  }
  return { mes: null };
}

export function interceptGenerationChat(chat) {
  if (!Array.isArray(chat)) return 0;
  let changed = 0;
  for (const [index, item] of chat.entries()) {
    if (!item || typeof item.mes !== 'string') continue;
    const stripped = stripGeneratedTranslationLines(item.mes, item.extra?.[MESSAGE_META_KEY], 'prompt');
    if (stripped !== item.mes) {
      // Some hosts pass shallow prompt copies. Never mutate the canonical message object.
      chat[index] = { ...item, mes: stripped };
      changed += 1;
    }
  }
  return changed;
}

// The plain translated text of a floor, used to trigger the host's worldinfo from translations.
export function extractTranslationBlockText(text) {
  const source = normalizeNewlines(String(text ?? ''));
  const chunks = [];
  for (const match of source.matchAll(TRANSLATION_BLOCK_RE)) chunks.push(match[1].replace(AFFIX_RE, ''));
  return chunks.join('\n');
}

function scanTagGroups(source, tagName, options = {}) {
  const tag = String(tagName || '').trim();
  if (!VALID_TAG_RE.test(tag)) throw new Error(`标签名称无效：${tag || '（空）'}`);
  const target = tag.toLowerCase();
  const tokenPattern = /\\?<\/?([A-Za-z][A-Za-z0-9_:-]*)(?:\s[^<>]*?)?\s*\/?>/g;
  const stack = [];
  const groups = [];
  let strayCloses = 0;
  for (const match of source.matchAll(tokenPattern)) {
    if (String(match[1]).toLowerCase() !== target) continue;
    const raw = match[0];
    const closing = /^\\?<\//.test(raw);
    const selfClosing = /\/\s*>$/.test(raw);
    if (selfClosing && !closing) {
      if (options.includeSelfClosing) {
        groups.push({
          tagName: tag,
          openStart: match.index,
          contentStart: match.index + raw.length,
          closeStart: match.index + raw.length,
          closeEnd: match.index + raw.length,
          openTag: raw,
          closeTag: '',
          selfClosing: true,
        });
      }
      continue;
    }
    if (!closing) {
      stack.push({ start: match.index, end: match.index + raw.length, raw });
      continue;
    }
    const open = stack.pop();
    if (!open) {
      strayCloses += 1;
      continue;
    }
    groups.push({
      tagName: tag,
      openStart: open.start,
      contentStart: open.end,
      closeStart: match.index,
      closeEnd: match.index + raw.length,
      openTag: open.raw,
      closeTag: raw,
    });
  }
  groups.sort((left, right) => left.openStart - right.openStart);
  groups.unclosedOpens = stack.length;
  groups.unclosedStack = stack.slice();
  groups.strayCloses = strayCloses;
  return groups;
}

// True when the tag opens but never closes, which is what a half-streamed floor looks like.
export function hasUnclosedTag(text, tagName) {
  const tag = String(tagName || '').trim();
  if (!VALID_TAG_RE.test(tag)) return false;
  const target = tag.toLowerCase();
  const tokenPattern = /\\?<\/?([A-Za-z][A-Za-z0-9_:-]*)(?:\s[^<>]*?)?\s*\/?>/g;
  let depth = 0;
  for (const match of normalizeNewlines(String(text ?? '')).matchAll(tokenPattern)) {
    if (match[1].toLowerCase() !== target) continue;
    const token = match[0];
    if (token.endsWith('/>')) continue;
    if (token.includes('</')) depth = Math.max(0, depth - 1);
    else depth += 1;
  }
  return depth > 0;
}

export function extractTaggedRegions(text, tagNames = DEFAULT_SETTINGS.bodyTags, options = {}) {
  const source = normalizeNewlines(text);
  const tags = parseTagNames(tagNames, DEFAULT_SETTINGS.bodyTags);
  const mode = options.mode === 'replace' ? 'replace' : 'bilingual';
  const regions = [];
  const missingTags = [];
  let unbalanced = 0;
  let assumedCloses = 0;
  for (const tag of tags) {
    const groups = scanTagGroups(source, tag);
    unbalanced += (groups.unclosedOpens || 0) + (groups.strayCloses || 0);
    // Some presets never emit the closing tag at all. A hard failure helps nobody, so an opener with
    // no partner is read as running to the end of the message. Complete groups always win over this.
    if (!groups.length && groups.unclosedStack?.length) {
      const open = groups.unclosedStack.at(-1);
      groups.push({
        tagName: tag,
        openStart: open.start,
        contentStart: open.end,
        closeStart: source.length,
        closeEnd: source.length,
        openTag: open.raw,
        closeTag: '',
        assumedClose: true,
      });
      assumedCloses += 1;
    }
    if (!groups.length) {
      missingTags.push(tag);
      continue;
    }
    const selected = groups.at(-1);
    regions.push({
      ...selected,
      mode,
      inner: source.slice(selected.contentStart, selected.closeStart),
    });
  }
  if (!regions.length) {
    if (mode === 'replace') {
      return { source, regions, missingTags, unbalanced, assumedCloses };
    }
    if (unbalanced) {
      throw new Error(`正文标签没有成对闭合：${tags.map(tag => `<${tag}>`).join('、')}。这一楼可能还在生成，或预设输出的标签不完整。`);
    }
    throw new Error(`当前 AI 回复中没有找到正文标签：${tags.map(tag => `<${tag}>`).join('、')}。`);
  }
  regions.sort((left, right) => left.openStart - right.openStart);
  regions.unbalanced = unbalanced;
  regions.assumedCloses = assumedCloses;
  for (let index = 1; index < regions.length; index += 1) {
    if (regions[index].openStart < regions[index - 1].closeEnd) {
      throw new Error(`正文提取标签发生嵌套：<${regions[index - 1].tagName}> 与 <${regions[index].tagName}>。请只保留外层正文标签。`);
    }
  }
  return { source, regions, missingTags, unbalanced, assumedCloses };
}

// Body and replace regions live in one floor and are rebuilt in a single pass, so they may sit side
// by side but never overlap. Both the runtime path and the tag inspector go through here, which is
// what lets the inspector warn about a nesting the translation would otherwise only hit at run time.
export function mergeExtractedRegions(body, replace) {
  const regions = [...(body?.regions ?? []), ...(replace?.regions ?? [])]
    .sort((left, right) => left.openStart - right.openStart);
  for (let index = 1; index < regions.length; index += 1) {
    if (regions[index].openStart < regions[index - 1].closeEnd) {
      throw new Error(`<${regions[index - 1].tagName}> 与 <${regions[index].tagName}> 的区域交叉重叠，请检查提取标签与替换标签的嵌套。镜译不支持标签嵌套。`);
    }
  }
  return {
    source: String(body?.source ?? replace?.source ?? ''),
    regions,
    missingTags: [...(body?.missingTags ?? []), ...(replace?.missingTags ?? [])],
    unbalanced: (body?.unbalanced || 0) + (replace?.unbalanced || 0),
    assumedCloses: (body?.assumedCloses || 0) + (replace?.assumedCloses || 0),
  };
}

export function inspectTagConfiguration(text, bodyTags, excludedTags, segmentOptions = {}) {
  const source = normalizeNewlines(text);
  const body = parseTagNames(bodyTags, DEFAULT_SETTINGS.bodyTags);
  const excluded = parseTagNames(excludedTags);
  const errors = [];
  const bodyResults = body.map(tag => {
    try {
      const groups = scanTagGroups(source, tag);
      const unclosedOpens = groups.unclosedOpens || 0;
      const strayCloses = groups.strayCloses || 0;
      // Still reported, but no longer fatal: the complete groups above remain usable.
      if (unclosedOpens) {
        errors.push(groups.length
          ? `最后一组 <${tag}> 没有对应的结束标签，已改用前面 ${groups.length} 组完整内容。`
          : `<${tag}> 没有结束标签，已把开标签之后到楼层末尾的内容当作正文。`);
      }
      if (strayCloses) errors.push(`发现 ${strayCloses} 个没有对应开始标签的 </${tag}>，已忽略。`);
      return {
        tag,
        count: groups.length,
        selected: groups.length ? groups.length : null,
        // Only present when something is actually unbalanced, so the common shape stays clean.
        ...(unclosedOpens ? { unclosedOpens } : {}),
        ...(strayCloses ? { strayCloses } : {}),
      };
    } catch (error) {
      errors.push(error.message);
      // A tag that opens but has not closed yet is a floor still being written, not a wrong setting.
      const streaming = hasUnclosedTag(source, tag);
      return { tag, count: 0, selected: null, streaming, error: error.message };
    }
  });
  const excludedResults = excluded.map(tag => {
    try {
      const groups = scanTagGroups(source, tag, { includeSelfClosing: true });
      return { tag, count: groups.length };
    } catch (error) {
      errors.push(error.message);
      return { tag, count: 0, error: error.message };
    }
  });
  // Replace tags used to be absent from this report, so the common
  // <story_scene><status>…</status></story_scene> shape passed the check and only failed once a
  // translation was actually running.
  const replace = parseTagNames(segmentOptions.replaceTags);
  const replaceResults = replace.map(tag => {
    try {
      const groups = scanTagGroups(source, tag);
      return { tag, count: groups.length };
    } catch (error) {
      errors.push(error.message);
      return { tag, count: 0, error: error.message };
    }
  });
  let paragraphs = 0;
  let translationUnits = 0;
  let customPreservedLines = 0;
  let builtinPreservedLines = 0;
  let cardPreservedLines = 0;
  let lyricLines = 0;
  const structuralTags = new Set();
  if (!errors.length && bodyResults.some(result => result.count)) {
    try {
      const extraction = mergeExtractedRegions(
        extractTaggedRegions(source, body),
        replace.length ? extractTaggedRegions(source, replace, { mode: 'replace' }) : null,
      );
      let nextId = 1;
      for (const region of extraction.regions) {
        const segmented = segmentSource(region.inner, { ...segmentOptions, excludedTags: excluded, startId: nextId });
        paragraphs += segmented.paragraphs;
        translationUnits += segmented.segments.length;
        customPreservedLines += segmented.customPreservedLines;
        builtinPreservedLines += segmented.builtinPreservedLines;
        cardPreservedLines += segmented.cardPreservedLines;
        lyricLines += segmented.lyricLines;
        segmented.structuralTags.forEach(tag => structuralTags.add(tag));
        nextId += segmented.segments.length;
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
  return {
    bodyTags: bodyResults,
    excludedTags: excludedResults,
    replaceTags: replaceResults,
    paragraphs,
    translationUnits,
    customPreservedLines,
    builtinPreservedLines,
    cardPreservedLines,
    lyricLines,
    structuralTags: [...structuralTags].sort(),
    errors: [...new Set(errors)],
  };
}

export function extractTaggedRegion(text, tagName = DEFAULT_SETTINGS.bodyTags[0]) {
  const extraction = extractTaggedRegions(text, [tagName]);
  const region = extraction.regions[0];
  return {
    ...region,
    before: extraction.source.slice(0, region.openStart),
    after: extraction.source.slice(region.closeEnd),
  };
}

export function rebuildTaggedRegion(region, inner) {
  return `${region.before}${region.openTag}${inner}${region.closeTag}${region.after}`;
}

export function rebuildTaggedRegions(extraction, replacements) {
  const source = String(extraction?.source ?? '');
  const regions = Array.isArray(extraction?.regions) ? extraction.regions : [];
  let output = source;
  for (let index = regions.length - 1; index >= 0; index -= 1) {
    const region = regions[index];
    const replacement = typeof replacements === 'function'
      ? replacements(region, index)
      : Array.isArray(replacements)
        ? replacements[index]
        : replacements?.get?.(region) ?? region.inner;
    output = `${output.slice(0, region.contentStart)}${String(replacement ?? '')}${output.slice(region.closeStart)}`;
  }
  return output;
}

/**
 * The HTML comments in a body. A page never shows them, and presets use them for what the story is not:
 * a plan for the scene, notes to itself. One that is not closed hides the rest, as it does in a browser.
 */
function commentRanges(source) {
  const ranges = [];
  let start = source.indexOf('<!--');
  while (start >= 0) {
    const close = source.indexOf('-->', start + 4);
    const end = close < 0 ? source.length : close + 3;
    ranges.push({ start, end, tagName: '!--', comment: true });
    start = source.indexOf('<!--', end);
  }
  return ranges;
}

function outermostExcludedRanges(source, tagNames) {
  const ranges = commentRanges(source);
  for (const tag of parseTagNames(tagNames)) {
    for (const group of scanTagGroups(source, tag, { includeSelfClosing: true })) {
      ranges.push({ start: group.openStart, end: group.closeEnd, tagName: tag });
    }
  }
  ranges.sort((left, right) => left.start - right.start || right.end - left.end);
  const outermost = [];
  for (const range of ranges) {
    const previous = outermost.at(-1);
    if (previous && range.start >= previous.start && range.end <= previous.end) continue;
    if (previous && range.start < previous.end) {
      // A comment across a tag's edge hides what it covers: the two are left out as one.
      if (previous.comment || range.comment) {
        previous.end = Math.max(previous.end, range.end);
        previous.comment = true;
        continue;
      }
      throw new Error(`排除标签交叉重叠：<${previous.tagName}> 与 <${range.tagName}>。`);
    }
    outermost.push({ ...range });
  }
  return outermost;
}

function maskExcludedTags(source, tagNames) {
  const blocks = [];
  let masked = '';
  let cursor = 0;
  for (const [index, range] of outermostExcludedRanges(source, tagNames).entries()) {
    const token = `\uE000JY_EXCLUDED_${index}\uE001`;
    masked += `${source.slice(cursor, range.start)}${token}`;
    blocks.push({ token, text: source.slice(range.start, range.end) });
    cursor = range.end;
  }
  masked += source.slice(cursor);
  return { masked, blocks };
}

/**
 * The excluded blocks inside one translatable line (a picture's prompt written mid-sentence), split by
 * where they stand: before any of the line's words, or after. A replace-tag region shows the translation
 * in the original's place, and these go back beside it — the translation has no place for them inside.
 */
function excludedAround(maskedLine, blocks) {
  let lead = '';
  let trail = '';
  const found = blocks
    .map(block => ({ block, at: maskedLine.indexOf(block.token) }))
    .filter(item => item.at >= 0)
    .sort((left, right) => left.at - right.at);
  for (const { block, at } of found) {
    let before = maskedLine.slice(0, at);
    for (const other of blocks) before = before.split(other.token).join('');
    if (/[\p{L}\p{N}]/u.test(stripStructuralTags(before))) trail += block.text;
    else lead += block.text;
  }
  return { lead, trail };
}

function replaceMaskedBlocks(value, blocks, mode) {
  let output = String(value ?? '');
  for (const block of blocks) output = output.split(block.token).join(mode === 'restore' ? block.text : '');
  return output;
}

function stripSegmentWrappers(value, prefix, suffix) {
  let result = String(value ?? '');
  if (prefix && result.startsWith(prefix)) result = result.slice(prefix.length);
  if (suffix && result.endsWith(suffix)) result = result.slice(0, -suffix.length);
  return result;
}

function splitPhysicalLines(value) {
  const lines = String(value ?? '').split('\n');
  return lines.map((text, index) => ({ text, separator: index < lines.length - 1 ? '\n' : '' }));
}

// Tags that begin a fresh line where they stand, matching the reading's own BREAK_RE (tts-sanitizer.js):
// br/hr always, and the block containers whose OPEN tag starts a line and whose CLOSE tag ends one — a
// container tag (ul/ol/table/section/article/header/footer) only on its CLOSE, since its own open holds
// nothing but further block children that already break on their own.
const BREAK_TAGS_ALWAYS = new Set(['br', 'hr']);
const BREAK_TAGS_ON_OPEN = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'tr', 'pre', 'dd', 'dt']);
const BREAK_TAGS_ON_CLOSE = new Set([...BREAK_TAGS_ON_OPEN, 'ul', 'ol', 'section', 'article', 'header', 'footer', 'table']);

// `modern`: v0.36.1's rule for what a removed tag leaves behind. Off (segmentSource's old floors) a tag
// always leaves nothing, exactly as every version through v0.36.0 read it — a card's "NOW PLAYING<br>A"
// glued into "NOW PLAYINGA". On, <br> and a block edge leave the line break they stood for, so text
// split only by markup is not glued into one run of words when it is sent to be translated; two inline
// elements sitting right against each other with nothing of their own between them — "<span>A</span>
// <span>B</span>" — leave the single space that already keeps every other such pair apart instead.
function stripStructuralTags(value, structuralTags, options = {}) {
  const source = String(value ?? '');
  return source.replace(STRUCTURAL_TAG_RE, (raw, closing, name, offset) => {
    const tag = String(name).toLowerCase();
    structuralTags?.add(tag);
    if (!options.modern) return '';
    const breaks = BREAK_TAGS_ALWAYS.has(tag) || (closing ? BREAK_TAGS_ON_CLOSE.has(tag) : BREAK_TAGS_ON_OPEN.has(tag));
    if (breaks) return '\n';
    // Only a closer immediately followed by another element's opener needs this: an opener followed by
    // more markup is only nesting deeper into the same run, two closers in a row are only unwinding one,
    // and a tag next to real text already has that text to stand on its own.
    const next = source.slice(offset + raw.length, offset + raw.length + 2);
    return closing && next[0] === '<' && next[1] !== '/' ? ' ' : '';
  });
}

// ---------------------------------------------------------------------------------------------
// Speaker marks written into the story itself: <say who="樱井" mood="开心">「……」</say>.
//
// The main model is asked, with each reply it writes, to wrap each line of dialogue this way. Like any
// other tag it is stripped from what the translator is sent and hidden when the floor is shown; unlike
// the others, what it says is kept for the reading. The tag is swapped for private-use markers that
// survive every clean-up a line goes through on its way to the voice, and the reading turns them back
// into who said which run and how. The translation's text is never touched by any of this.
// ---------------------------------------------------------------------------------------------

// The first line of the request for marks. The request goes out with the main model's replies; an
// older setup kept it in a worldbook entry, and the requests that quote the worldbook back — the
// translator's, the deep reading's — leave such an entry out by this line.
export const SPEECH_ENTRY_HEAD = '[对白标记：给朗读程序看的，读者看不到]';
export const SPEECH_OPEN = '\uE0A1';
export const SPEECH_SEP = '\uE0A2';
export const SPEECH_CLOSE = '\uE0A3';
const SPEECH_TAG_RE = /\\?<(\/?)say(?=[\s/>])([^<>]*)>/gi;
const SPEECH_SPEAKER_KEYS = ['who', 'name', 'speaker', 'char', 'character', 'n', 's', '说话人', '角色', '人物', '名字'];
const SPEECH_MOOD_KEYS = ['mood', 'emotion', 'feeling', 'e', 'm', '情绪', '心情', '语气', 'tone'];

/**
 * Text quoted back as context, without the speaker-mark entry and without the marks themselves: the
 * translator and the readings get the story, not the request to mark it, and a mark is not theirs to
 * copy into a translation.
 */
export function withoutSpeechMarks(text) {
  const head = SPEECH_ENTRY_HEAD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text ?? '')
    .replace(new RegExp(`${head}[\\s\\S]*?例：[^\\n]*(?:\\n|$)`, 'g'), '')
    .replace(SPEECH_TAG_RE, '');
}

/**
 * Who and how, out of what stands inside one opening tag. Lenient on purpose — a model told to write
 * who= and mood= will sometimes write name= or 情绪=, leave the quotes off, or write the bare form
 * <say 樱井|开心> — because a mark it half-remembered is still a mark.
 */
export function readSpeechAttributes(inner) {
  const text = String(inner ?? '').replace(/\/\s*$/, '').trim();
  const attrs = {};
  for (const match of text.matchAll(/([^\s="'“”]+)\s*[=＝]\s*(?:"([^"]*)"|'([^']*)'|“([^”]*)”|「([^」]*)」|([^\s"'“”]+))/gu)) {
    attrs[match[1].toLowerCase()] = (match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6] ?? '').trim();
  }
  const pick = keys => keys.map(key => attrs[key]).find(value => value);
  let speaker = pick(SPEECH_SPEAKER_KEYS) ?? '';
  let mood = pick(SPEECH_MOOD_KEYS) ?? '';
  if (!Object.keys(attrs).length && text) {
    // The bare form: a name, then a mood, split by a bar or a space.
    const [first = '', ...rest] = text.split(/\s*[|｜]\s*|\s+/u).filter(Boolean);
    speaker = first;
    mood = rest.join('、');
  }
  const clean = (value, limit) => String(value ?? '').replace(/^[「『“"'（(【\[]+|[」』”"'）)】\]]+$/gu, '').replace(/\s+/g, ' ').trim().slice(0, limit);
  return { speaker: clean(speaker, 40), mood: clean(mood, 24) };
}

/**
 * One source line with its speaker marks turned into markers: the text the reading will clean, and
 * what each mark said, by its number in the line. Null for a line without any mark, which the reading
 * then takes exactly as before.
 */
export function speechMarkedLine(value) {
  const source = String(value ?? '');
  if (!/<\/?say(?=[\s/>])/i.test(source)) return null;
  const marks = [];
  const replaced = source.replace(SPEECH_TAG_RE, (_whole, closing, inner) => {
    if (closing) return SPEECH_CLOSE;
    const mark = readSpeechAttributes(inner);
    // A self-closing tag marks the run after it rather than enclosing one.
    marks.push({ ...mark, open: /\/\s*$/.test(inner) });
    return `${SPEECH_OPEN}${marks.length - 1}${SPEECH_SEP}`;
  });
  if (!marks.length) return null;
  // Struck through or painted invisible on itself, inside the marked dialogue or outside it: dropped
  // before the tags are stripped, the same as an unmarked line's own reading text — see segmentSource's
  // `readingText`. The private-use markers just written in for <say> survive: dropHiddenMarkup only
  // matches ordinary `<tag>` syntax, never those code points.
  return { text: stripStructuralTags(dropHiddenMarkup(replaced)).trim(), marks };
}

// Presentation tags a preset puts around a line of dialogue. The translation is sent to the model
// with every tag stripped — it has to be, or the model starts translating markup — and for a long
// time it came back and was written down bare. A preset that paints dialogue therefore painted the
// original and left the translation grey, which reads as "翻译把对话的颜色弄掉了".
//
// Only a wrapper that encloses the whole line is carried, and only these tags: they change how the
// line looks and nothing else. Block tags would change the layout and anchors would give the
// translation a link the original's author never put there.
const CARRYABLE_FORMAT_TAGS = new Set([
  'span', 'font', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins',
  'mark', 'small', 'big', 'sub', 'sup', 'q', 'cite', 'abbr', 'tt',
]);
// Presentation attributes only. Copying an event handler or an id onto a second element would be
// this extension inventing behaviour the floor never had.
const CARRYABLE_FORMAT_ATTRS = new Set(['style', 'color', 'class', 'size', 'face']);
const COLOR_DECLARATION_RE = /^(?:-webkit-text-fill-)?color\s*:/i;

function sanitizeFormatOpenTag(raw, tag) {
  const attributes = [];
  for (const match of raw.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    const name = match[1].toLowerCase();
    if (!CARRYABLE_FORMAT_ATTRS.has(name)) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (/[<>]/.test(value)) continue;
    attributes.push(`${name}="${value.replace(/"/g, '&quot;')}"`);
  }
  return `<${tag}${attributes.length ? ` ${attributes.join(' ')}` : ''}>`;
}

// Used when speaker colouring already painted the line: the carried bold and italic still apply, but
// two colours on one line would just be the outer one losing silently.
export function withoutCarriedColor(openTag) {
  return String(openTag ?? '')
    .replace(/\scolor\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\sstyle\s*=\s*"([^"]*)"/i, (_whole, css) => {
      const kept = css.split(';').map(item => item.trim()).filter(item => item && !COLOR_DECLARATION_RE.test(item));
      return kept.length ? ` style="${kept.join(';')}"` : '';
    });
}

// True when the opening tag at the head of `rest`'s parent closes exactly at the end of the line,
// i.e. it really wraps everything rather than being the first of several siblings.
function wrapperClosesAtEnd(rest, tag) {
  const pattern = new RegExp(`<(/?)${tag}(?:\\s[^<>]*?)?\\s*(/?)>`, 'gi');
  let depth = 1;
  for (const match of rest.matchAll(pattern)) {
    if (match[2] === '/') continue;
    depth += match[1] === '/' ? -1 : 1;
    if (depth > 0) continue;
    return rest.slice(match.index + match[0].length).trim() === ''
      ? { inner: rest.slice(0, match.index) }
      : null;
  }
  return null;
}

// A line-level <say> shell and, inside or outside it, the pair of story quotes wrapping the whole
// line: neither is formatting to carry, but a preset writes the tags that ARE — <big><b> — between
// them, not outside them, so both are looked past before the carryable tags are searched for. Neither
// shell reappears in the return value: the translation writes its own quotes and never sees a <say>.
function unwrapLineForFormatting(line) {
  // A leading indent (plain or full-width), a trailing space, or a space just inside the <say> shell is
  // never part of either wrapper: trimmed here so an indented or speaker-marked line finds its shell the
  // same way an unmarked one already does. lineFormatting's own '^\s*<' and wrapperClosesAtEnd re-trim
  // whatever this returns, so nothing about the untrimmed case changes.
  const trimmedLine = String(line ?? '').trim();
  const say = trimmedLine.match(SAY_SHELL_RE);
  let body = say ? say[1].trim() : trimmedLine;
  for (const [open, close] of SPEECH_OPENERS) {
    if (body.length > open.length + close.length - 1 && body.startsWith(open) && body.endsWith(close)) {
      body = body.slice(open.length, body.length - close.length);
      break;
    }
  }
  return body;
}

// The wrapper's own opening/closing tags when `body` really is wrapped whole in one to four nested
// carryable tags, and really has text inside once they are peeled off — a body that is only tags has
// nothing to carry, and a body with two sibling spans has no single wrapper to speak of. Shared by
// `lineFormatting` (the whole line) and `lineQuoteFormats` (one quote's own content, §2 layer 2:
// "整句引号内容被同一组标签包住"), which differ only in what substring of the line they hand in.
function extractCarryableWrap(body) {
  let content = body;
  const opens = [];
  const closes = [];
  for (let depth = 0; depth < 4; depth += 1) {
    const match = content.match(/^\s*<([A-Za-z][A-Za-z0-9]*)(?:\s[^<>]*?)?\s*>/);
    if (!match) break;
    const tag = match[1].toLowerCase();
    if (!CARRYABLE_FORMAT_TAGS.has(tag)) break;
    const closed = wrapperClosesAtEnd(content.slice(match[0].length), tag);
    if (!closed) break;
    opens.push(sanitizeFormatOpenTag(match[0], tag));
    closes.unshift(`</${tag}>`);
    content = closed.inner;
  }
  if (!opens.length || !stripStructuralTags(content).trim()) return null;
  return { open: opens.join(''), close: closes.join('') };
}

/**
 * The presentation wrapper around a whole source line, ready to be re-applied to its translation.
 *
 * Returns null unless the line really is wrapped and really has text inside — a line that is only
 * tags has nothing to carry, and a line with two sibling spans has no single wrapper to speak of.
 */
export function lineFormatting(line) {
  return extractCarryableWrap(unwrapLineForFormatting(line));
}

// The `<say>` shell peeled off, nothing else touched — unlike `unwrapLineForFormatting`, the outer
// speech quotes stay on, because `lineQuoteFormats` needs to see every quote on the line, not just
// treat the first and last as one wrapper around all of them.
function sayShellInner(line) {
  const trimmed = String(line ?? '').trim();
  const say = trimmed.match(SAY_SHELL_RE);
  return say ? say[1].trim() : trimmed;
}

/**
 * Layer 2 of carrying the original's own typesetting into the translation (design §2 「原文自带的排版
 * 怎么搬到译文」item 2): a line that is not wholly one carried wrapper (narration beside a quote, or
 * more than one quote on the line — `lineFormatting` already returned null for it) can still have one
 * or more of its own quotes entirely wrapped in carryable tags. No question is put to the translator
 * for this layer: the k-th quote of the translation is simply given the k-th quote's own wrapper here,
 * paired by order the same way `deriveLabelsForSide` already pairs quoted runs for speaker colouring.
 *
 * Returns one entry per quoted run of the line, in order — `null` for a run with nothing to carry —
 * so the caller can zip it directly against `splitSpeechParts` run for run.
 */
// A quote mark used to delimit an attribute (`name="甲"`, `style="color:#c00"`) is not one of the
// story's own quote marks; masked here, with a space in its place, so splitSpeechParts's count of
// quotes on the line is not thrown off by it. Only characters inside a tag's own `<…>` span are
// touched — never the length of the line, so every other position on it is unmoved.
const SPEECH_MARK_CHARS = new Set([...SPEECH_OPENERS.keys(), ...SPEECH_OPENERS.values()]);
function maskTagAttributeQuotes(text) {
  return String(text ?? '').replace(/<[^<>]*>/g, tag => [...tag].map(character => SPEECH_MARK_CHARS.has(character) ? ' ' : character).join(''));
}

export function lineQuoteFormats(line) {
  const body = sayShellInner(line);
  // Quote boundaries are found on the masked copy, so an attribute's own quote marks never pair off
  // against a real one; splitSpeechParts consumes every character of what it is given into some part
  // or other, in order, so summing each part's own length walks the same offsets in `body` — and the
  // *content* extractCarryableWrap sees is read back from `body` itself, attributes and all, rather
  // than from the masked copy, so a carried tag's own real attributes are never the ones blanked out.
  const masked = maskTagAttributeQuotes(body);
  const wraps = [];
  let offset = 0;
  for (const part of splitSpeechParts(masked)) {
    const start = offset;
    offset += part.text.length;
    if (!part.spoken) continue;
    wraps.push(extractCarryableWrap(body.slice(start, offset).slice(1, -1)));
  }
  return wraps;
}

// A tag this run's own wrapper carried in the original that means the words were not actually said
// out loud (design §2 「朗读怎么处理」: "删除线...涂黑...朗读时按存下的 runs 把这几个字去掉"): struck
// through, or painted the same colour as its own background ("隐形涂黑"). The reading drops a run
// marked this way; the display still shows it struck through or blacked out as always.
function isHiddenCarryTag(tag, openTag) {
  if (tag === 's' || tag === 'del' || tag === 'strike') return true;
  return tag === 'span' && /background(?:-color)?\s*:\s*currentcolor/i.test(String(openTag ?? ''));
}

// A fragment small enough, and specific enough, to be worth carrying on its own rather than as part
// of a whole line or a whole quote — half a sentence bolded, a move name bolded inside a narrated
// paragraph. Found by scanning for the first, outermost carryable tag at every position in turn, left
// to right, non-overlapping; nothing about the scan requires the fragment to be the line's or the
// quote's entire content, which is what tells this layer apart from the two above.
const INLINE_FORMAT_OPEN_RE = /<([A-Za-z][A-Za-z0-9]*)((?:\s[^<>]*)?)>/g;

/**
 * Layer 3, the structural half (design §2 item 3 「行内片段」): every carryable-tagged fragment inside
 * one line that is not the line's entire content, in the order it appears, with the fragment's own
 * plain text (what gets numbered and sent to the translator to place in its own words) and the exact
 * wrapper to re-apply around whatever the translator says that fragment became.
 *
 * The scan's cursor jumps past whatever a found fragment closed on, so a fragment already claimed —
 * the whole body (`lineFormatting`'s job), or an outer tag this same scan just matched — is never
 * matched a second time from a tag nested inside it: `<b>bold <i>and italic</i> more</b>` carries once,
 * as the outer `<b>…</b>`, with the inner `<i>` left as plain text once `stripStructuralTags` runs on
 * its own content — a known simplification (report §「anything left undone」), not a rendering bug.
 */
export function inlineFormatRuns(line) {
  const body = sayShellInner(line);
  // `lineFormatting` (layer 1) unwraps the speech quotes too, before it looks for a whole-line
  // wrapper — so on `<say>…「<big><b>…</b></big>」…</say>`, its own carryable-wrap span sits one
  // character in from where this scan sees it (`sayShellInner` keeps the quotes on, on purpose, so
  // `lineQuoteFormats` can still see every quote on the line). Comparing only against `body.trim()`
  // therefore never matches for the single-quote-with-a-carried-wrapper shape, and the wrapper this
  // scan found was carried a second time, nested inside the one layer 1 already carries.
  const unwrapped = String(unwrapLineForFormatting(line) ?? '').trim();
  const runs = [];
  INLINE_FORMAT_OPEN_RE.lastIndex = 0;
  let match;
  while ((match = INLINE_FORMAT_OPEN_RE.exec(body))) {
    const tag = match[1].toLowerCase();
    if (!CARRYABLE_FORMAT_TAGS.has(tag)) continue;
    const openTag = match[0];
    const from = match.index + openTag.length;
    const closed = wrapperClosesAtEndAnywhere(body, from, tag);
    if (!closed) continue;
    const span = body.slice(match.index, closed.end);
    // The whole body, trimmed, or the whole body with its speech quotes peeled off the same way layer
    // 1 peels them: either way `lineFormatting` already carries this one, as the whole line.
    if (span === body.trim() || span === unwrapped) {
      INLINE_FORMAT_OPEN_RE.lastIndex = closed.end;
      continue;
    }
    const text = stripStructuralTags(closed.inner).trim();
    INLINE_FORMAT_OPEN_RE.lastIndex = closed.end;
    if (!text) continue;
    runs.push({
      text,
      format: { open: sanitizeFormatOpenTag(openTag, tag), close: `</${tag}>` },
      hidden: isHiddenCarryTag(tag, openTag),
    });
  }
  return runs;
}

// Like `wrapperClosesAtEnd`, but the closing tag only has to be found somewhere in `source` from
// `from` onward — an inline fragment usually has more of the line after it, which is exactly the case
// `wrapperClosesAtEnd` (built for a wrapper that has to reach the line's own end) refuses.
function wrapperClosesAtEndAnywhere(source, from, tag) {
  const pattern = new RegExp(`<(/?)${tag}(?:\\s[^<>]*?)?\\s*(/?)>`, 'gi');
  pattern.lastIndex = from;
  let depth = 1;
  let match;
  while ((match = pattern.exec(source))) {
    if (match[2] === '/') continue;
    depth += match[1] === '/' ? -1 : 1;
    if (depth > 0) continue;
    return { inner: source.slice(from, match.index), end: match.index + match[0].length };
  }
  return null;
}

function isClosingTagOnlyLine(value) {
  const source = String(value ?? '');
  const tokens = [...source.matchAll(STRUCTURAL_TAG_RE)];
  return tokens.length > 0
    && tokens.every(match => /^\\?<\//.test(match[0]))
    && stripStructuralTags(source).trim() === '';
}

// ---------------------------------------------------------------------------------------------
// v0.37.0 「音乐卡片」 rule group and 「歌词行」 lyric lines.
// ---------------------------------------------------------------------------------------------

// A card row's own trailing line break, kept as a literal tag rather than folded into a real '\n' the
// way segmentSource's usual <br>-to-break handling does — splitCardRows and the lyric renderers below
// need to know a row had one (to restore it) without losing which exact spelling it was.
const TRAILING_BR_RE = /(<br\s*\/?>)\s*$/i;

// The one caption every such card is assumed to carry verbatim, decoration marks either side allowed
// ("♪ NOW PLAYING ♪", "- NOW PLAYING -"): unambiguous, so it needs no rule of the reader's own.
const MUSIC_CARD_CAPTION_RE = /^[^\p{L}\p{N}]*now\s*playing[^\p{L}\p{N}]*$/iu;
// A row the card already wrote as "原文 (译文)": before v0.40.0 (segmentation_version 3) any Han
// character inside the parens was enough, which also caught a still-untranslated parenthetical that
// mixes kana into its kanji — a ruby reading, or a phrase like "Hoshi (星の歌)" — as if it were already
// Chinese. An old floor keeps being read this way.
const MUSIC_CARD_BILINGUAL_LEGACY_RE = /[(（][^()（）]*[一-鿿㐀-䶿][^()（）]*[)）]\s*$/u;
// v0.40.0 and up: captures the parenthesised half so isCardBilingualRow can judge it the same way
// looksAlreadyTranslatedLyric judges a lyric line — a CJK ideograph and no kana in it — so a
// parenthetical with any kana in it is no longer taken for an already-translated row. A parenthetical
// written entirely in kanji (a Japanese gloss such as あんた(貴方), with no kana to tell it apart from
// Chinese) is still counted as already-translated, same as before this change — a known, accepted limit
// shared with looksAlreadyTranslatedLyric itself (design §7 item 9).
const MUSIC_CARD_BILINGUAL_RE = /[(（]([^()（）]*)[)）]\s*$/u;

// Hiragana/katakana (no 'g' flag — see KANA_RE's own note above on why a global one is unsafe to
// `.test()` repeatedly) and any CJK ideograph.
const KANA_TEST_RE = /[ぁ-ゖゝ-ゟァ-ヺヽ-ヿㇰ-ㇿ]/u;
const HAN_TEST_RE = /[一-鿿㐀-䶿]/u;

/**
 * Whether a candidate lyric line is already Chinese and so is not translated at all (design §2 「歌词
 *怎么译、怎么排」: 中文歌词行不翻). Judged the same way `looksUntranslated` tells a returned translation
 * apart from a still-Japanese one: kana is the tell. A Japanese lyric written entirely in on'yomi kanji
 * carries none and is misjudged as Chinese too — a known, accepted limit (design §7 item 9).
 */
function looksAlreadyTranslatedLyric(text) {
  const value = String(text ?? '');
  return HAN_TEST_RE.test(value) && !KANA_TEST_RE.test(value);
}

/**
 * Whether a row's trailing parenthesised half is itself Chinese — see MUSIC_CARD_BILINGUAL_RE. `v3`
 * false reads it the pre-v0.40.0 way (MUSIC_CARD_BILINGUAL_LEGACY_RE), so an old floor's stored
 * translations still match what it was actually segmented with.
 */
function isCardBilingualRow(text, v3) {
  const value = String(text ?? '');
  if (!v3) return MUSIC_CARD_BILINGUAL_LEGACY_RE.test(value);
  const match = value.match(MUSIC_CARD_BILINGUAL_RE);
  return Boolean(match) && looksAlreadyTranslatedLyric(match[1]);
}

/**
 * One physical line, split at every `<br>` into the card's own rows — each becomes as independent a
 * "line" as a real newline would have, for every purpose downstream (preserve rules, builtin decorative
 * lines, lyric classification, formatting). A row keeps its own trailing `<br>` as literal text, so
 * `sourceText`/`lineParts` reproduce the card's structure byte for byte; only the true last row (nothing
 * split off after it) carries the physical line's own `separator` instead of one of its own.
 *
 * A physical line with no `<br>` in it at all comes back as the one row it always was — `fromBr: false`,
 * `separator` unchanged — so a caller that never turns this on (musicCardRules off) never has to call it,
 * and a caller that does pays nothing extra for the lines it does not affect.
 */
function splitCardRows(line) {
  const pieces = String(line?.text ?? '').split(/(<br\s*\/?>)/i);
  if (pieces.length < 2) return [line];
  const rows = [];
  let buffer = '';
  for (const piece of pieces) {
    if (/^<br\s*\/?>$/i.test(piece)) {
      rows.push({ text: buffer + piece, separator: '', fromBr: true });
      buffer = '';
    } else {
      buffer += piece;
    }
  }
  // Whatever is left after the last <br> is the card's last row — no tag of its own to restore, but
  // still "from" the same run of card rows, which is what tells apart, further down, a genuine blank
  // trailing row from an ordinary physical line that merely happens to have no <br> anywhere in it.
  rows.push({ text: buffer, separator: line.separator, fromBr: true });
  return rows;
}

/**
 * Whether a would-be run of card rows actually looks like a card at all — one of the three documented
 * shapes: NOW PLAYING's own caption, a row already written "原文 (译文)", or a hit from the reader's own
 * 「歌词行」 rules. Checked before a run of `<br>`-joined rows is even treated as a card (see `rawLines`
 * in segmentSource), so ordinary prose that merely uses `<br>` for its own line breaks never reaches the
 * catch-all that would otherwise assume every row it cannot otherwise classify is a lyric.
 */
function cardRowsShowSignal(rows, lyricRules, blocks, modern) {
  return rows.some(row => {
    if (!row.fromBr) return false;
    const withoutExcluded = replaceMaskedBlocks(row.text, blocks, 'remove');
    const translationText = withoutDecorativeSublines(
      stripStructuralTags(withoutExcluded, null, { modern }).trim(),
      { modern },
    );
    // Only called under musicCardRulesV3 (see rawLines in segmentSource), so the v3 bilingual test applies.
    if (MUSIC_CARD_CAPTION_RE.test(translationText) || isCardBilingualRow(translationText, true)) return true;
    const matchSubject = replaceMaskedBlocks(row.text, blocks, 'restore').replace(TRAILING_BR_RE, '');
    return matchesPreserveLine(matchSubject, lyricRules.rules, { modern });
  });
}

// A play-time readout — "01:23 / 04:56", with a played/total pair of m:ss clocks and whatever icons or
// dashes a card decorates it with — never prose, even though the digits themselves pass the letter and
// number test below. Two clocks are required so an ordinary sentence that happens to end in one time
// ("11:30 に会おう。") is not caught by this rule.
const PLAY_TIME_RE = /^[^\p{L}\p{N}\n]*\d{1,2}:\d{2}[^\p{L}\p{N}\n]*\/[^\p{L}\p{N}\n]*\d{1,2}:\d{2}[^\p{L}\p{N}\n]*$/u;
// A pseudo waveform some players draw from tall, thin glyphs — ı l I | — never actual letters, though
// each one alone is a real letter the general check above would keep as prose.
const WAVEFORM_RE = /^[ılI|]+$/u;

// `options.modern`: v0.36.1's two new built-in patterns, gated the same way as segmentSource's other
// rules — see stripStructuralTags. Off (an old floor's own rules), only the general "no letters, no
// digits" test applies, exactly as every version through v0.36.0 read a line.
function isBuiltinPreservedLine(value, options = {}) {
  const visibleOf = text => text
    .replace(HTML_ENTITY_RE, '')
    .replace(/\\(?=[\\`*_{}\[\]()#+\-.!|<>])/g, '')
    .trim();
  const stripped = stripStructuralTags(value);
  if (!visibleOf(stripped)) return false;
  // What is left once the pictures are gone: a line of pictures alone has no words in it.
  const words = visibleOf(stripped.replace(MARKDOWN_IMAGE_RE, '').replace(EMPTY_MARKDOWN_LINK_RE, ''));
  if (!/[\p{L}\p{N}]/u.test(words)) return true;
  if (!options.modern) return false;
  if (PLAY_TIME_RE.test(words)) return true;
  const compact = words.replace(/\s+/gu, '');
  return compact.length >= 6 && WAVEFORM_RE.test(compact);
}

/**
 * Whether a line of already-plain text (tags gone, as every reading and translation sees it) is one of
 * the built-in decorative shapes segmentSource itself never sends translating or reading — a play-time
 * readout or a pseudo waveform, on top of a line with no letters or digits in it at all. The one
 * judgement shared by every path that decides this for itself instead of through segmentSource: the
 * literal-tag fallback a translated floor with no mirror of its own falls back to (tts.js's
 * linesFromTaggedText) is the other reader of it.
 */
export function isDecorativeLine(text) {
  return isBuiltinPreservedLine(String(text ?? ''), { modern: true });
}

// A play-time readout or a pseudo waveform is judged by its own physical line, but stripStructuralTags's
// modern rule can now fold several of a card's physical lines — joined only by <br> or a block edge —
// into one, `\n`-separated "line" here (see stripStructuralTags). Judging the joined whole against
// PLAY_TIME_RE/WAVEFORM_RE would never match (their anchors let neither pattern see past an embedded
// `\n`), so a played/total clock or a waveform on its own <br>-joined sub-line would otherwise reach the
// translator and the reader after all — exactly the card the built-in rule exists for. Sub-lines that
// are themselves builtin-preserved are dropped before the whole is judged or sent anywhere; prose
// sub-lines are kept, `\n` and all, so an ordinary multi-line card is untouched.
function withoutDecorativeSublines(value, options = {}) {
  if (!options.modern || !value.includes('\n')) return value;
  return value.split('\n').filter(sub => !isBuiltinPreservedLine(sub.trim(), options)).join('\n').trim();
}

/** A line that is only pictures (Markdown or <img>), with nothing to translate or read beside them. */
function isPictureLine(value) {
  const text = String(value ?? '');
  if (!text.includes('![') && !/<img\b/i.test(text)) return false;
  const stripped = stripStructuralTags(text).trim();
  return !stripped || isBuiltinPreservedLine(text);
}

export function segmentSource(text, options = {}) {
  const source = stripGeneratedTranslationLines(text);
  const layout = [];
  const segments = [];
  const prefix = typeof options.segmentPrefix === 'string' ? options.segmentPrefix : '';
  const suffix = typeof options.segmentSuffix === 'string' ? options.segmentSuffix : '';
  const startId = clampInteger(options.startId, 1, Number.MAX_SAFE_INTEGER, 1);
  // Which rule generation a floor's own segmentation_version speaks for: see SEGMENTATION_RULES_VERSION.
  // A caller with no opinion gets the latest rules; a legacy (pre-schema-4) wrapper predates the option
  // entirely and is always exactly version 1.
  const segmentationRules = options.legacyWrappers === true ? 1
    : (options.segmentationVersion == null ? SEGMENTATION_RULES_VERSION : Number(options.segmentationVersion));
  // v0.36.1's built-in-regex fixes (version 2 and up).
  const modern = segmentationRules >= 2;
  // v0.40.0's 「音乐卡片」 tightening (version 3 and up) — see SEGMENTATION_RULES_VERSION's own note. An
  // old floor keeps reading with the broader, unsignalled rules it was actually segmented and translated
  // with, so its stored translations still match.
  const musicCardRulesV3 = segmentationRules >= 3;
  const parsedRules = parsePreserveLineRulesWithErrors(options.preserveLineRules);
  const lyricRules = parseLyricLineRulesWithErrors(options.lyricLineRules);
  if (parsedRules.errors.length || lyricRules.errors.length) {
    throw new Error([...parsedRules.errors, ...lyricRules.errors].join(' '));
  }
  const { masked, blocks } = maskExcludedTags(source, options.excludedTags);
  const structuralTags = new Set();
  // Segment id → the line with its speaker marks as markers, for the reading; see speechMarkedLine.
  const speech = new Map();
  // Segment id → the same segment read aloud instead of translated: struck-through and redacted text
  // dropped, everything else the same. Only present when it differs from the segment's own `text` — a
  // reader who has never touched this leaves every id out and pays nothing beyond that one check per
  // line — so a caller looks it up with `reading.get(id) ?? segments[i].text`.
  const reading = new Map();
  // Every lyric segment's id, translated or not — collectTtsFloor reads this to skip them; the built-in
  // decorative and card-preserved lines never need it, since they hold no segment id to skip.
  const lyricIds = new Set();
  // Segment id → that line's own layer-3 structural fragments (`inlineFormatRuns`, format and `hidden`
  // included), the same list `segment.fragments` sent the translator the plain text of. Kept apart from
  // `segment.fragments` because the reading (collectTtsFloor) needs `hidden` and `format`, which have no
  // business riding in the request JSON a model reads.
  const fragmentsById = new Map();
  let paragraphs = 0;
  let customPreservedLines = 0;
  let builtinPreservedLines = 0;
  let cardPreservedLines = 0;
  let lyricLines = 0;
  let body = masked;
  const leading = body.match(/^(?:[ \t]*\n)+/)?.[0] || '';
  if (leading) {
    layout.push({ type: 'raw', text: replaceMaskedBlocks(leading, blocks, 'restore') });
    body = body.slice(leading.length);
  }
  const trailing = body.match(/(?:\n[ \t]*)+$/)?.[0] || '';
  if (trailing) body = body.slice(0, -trailing.length);

  const appendParagraph = maskedParagraph => {
    if (!maskedParagraph) return;
    // A picture on a line of its own splits its paragraph there: it stays where it stands, shown once
    // in either mode, and the text on each side is translated as the paragraph it is. Left inside the
    // paragraph it would travel with the source block, which the replace mode hides.
    if (options.paragraphPerLine !== true && options.legacyWrappers !== true) {
      const physical = splitPhysicalLines(maskedParagraph);
      const at = physical.length > 1 ? physical.findIndex(line => isPictureLine(replaceMaskedBlocks(line.text, blocks, 'remove'))) : -1;
      if (at >= 0) {
        const before = physical.slice(0, at).map(line => line.text).join('\n');
        const after = physical.slice(at + 1).map(line => line.text).join('\n');
        if (at > 0) {
          appendParagraph(before);
          layout.push({ type: 'raw', text: '\n' });
        }
        builtinPreservedLines += 1;
        layout.push({ type: 'raw', text: replaceMaskedBlocks(physical[at].text, blocks, 'restore') });
        if (at < physical.length - 1) {
          layout.push({ type: 'raw', text: '\n' });
          appendParagraph(after);
        }
        return;
      }
    }
    const restoredParagraph = replaceMaskedBlocks(maskedParagraph, blocks, 'restore');
    const unwrapped = options.legacyWrappers === true
      ? stripSegmentWrappers(maskedParagraph, prefix, suffix)
      : maskedParagraph;
    const physicalLines = splitPhysicalLines(unwrapped);
    // The 「音乐卡片」 group turns each <br>-joined card row into its own "physical line" before anything
    // else runs, so every rule below (preserve, lyric, builtin, format) already applies per row with no
    // further special-casing. Off (the default), splitCardRows is never called and this is the exact
    // array `physicalLines` already was. Since musicCardRulesV3, a run of physical lines is only split
    // this way when cardRowsShowSignal finds one of the three documented card shapes among the whole
    // run's would-be rows, so ordinary prose that happens to use <br> stays the physical lines it always
    // was, never fed to the lyric catch-all; an older floor keeps the broader, unconditional split it was
    // segmented with.
    const rawLines = options.musicCardRules === true ? (() => {
      // The signal is judged once per run of *consecutive* physical lines that each have a <br> of their
      // own, not once per physical line — a NOW PLAYING card pretty-printed with every row on its own
      // source line only shows its signal on the caption's line, and every other row of that same card
      // would otherwise lose lyric handling entirely (v0.40.0). A run of exactly one physical line (the
      // ordinary case, several rows sharing one <br>-joined line) behaves exactly as before.
      const result = [];
      let run = [];
      const flushRun = () => {
        if (!run.length) return;
        const split = !musicCardRulesV3 || cardRowsShowSignal(run.flatMap(item => item.rows), lyricRules, blocks, modern);
        for (const item of run) result.push(...(split ? item.rows : [item.line]));
        run = [];
      };
      for (const line of physicalLines) {
        const rows = splitCardRows(line);
        if (rows.length < 2) { flushRun(); result.push(line); continue; }
        run.push({ line, rows });
      }
      flushRun();
      return result;
    })() : physicalLines;
    // What `lineFormatting`/`lineQuoteFormats`/`inlineFormatRuns` all read: a card row's own trailing
    // <br> dropped first, so a wrapper's closing tag right before it still looks like it closes at the
    // row's end.
    const formatSource = raw => (raw.fromBr ? raw.text.replace(TRAILING_BR_RE, '') : raw.text);
    const lines = rawLines.map(line => {
      const sourceLine = replaceMaskedBlocks(line.text, blocks, 'restore');
      const withoutExcluded = replaceMaskedBlocks(line.text, blocks, 'remove');
      const lineStructuralTags = new Set();
      const translationText = withoutDecorativeSublines(
        stripStructuralTags(withoutExcluded, lineStructuralTags, { modern }).trim(),
        { modern },
      );
      lineStructuralTags.forEach(tag => structuralTags.add(tag));
      // What the reading hears for this line when the story wrote no <say> mark on it: the same words
      // as `translationText`, with whatever is struck through or painted invisible on itself dropped —
      // that stays in `translationText`/segment.text untouched, so the translation still sees it and
      // nothing about a segment's identity or hash changes. Skipped when nothing would differ, so a line
      // with none of this markup costs nothing beyond the one `dropHiddenMarkup` no-op check.
      const withoutHidden = dropHiddenMarkup(withoutExcluded);
      const readingText = withoutHidden === withoutExcluded
        ? translationText
        : withoutDecorativeSublines(stripStructuralTags(withoutHidden, null, { modern }).trim(), { modern });
      // A card row still carries its own trailing <br>, which a preserve/lyric rule written for the bare
      // caption never expects (an exact rule "NOW PLAYING" would never match "NOW PLAYING<br>"). Matched
      // against with that tag off, same as matchesPreserveLine already looks past a <say> shell.
      const matchSubject = line.fromBr ? sourceLine.replace(TRAILING_BR_RE, '') : sourceLine;
      const customPreserved = matchesPreserveLine(matchSubject, parsedRules.rules, { modern });
      const builtinPreserved = !customPreserved && (
        isBuiltinPreservedLine(translationText, { modern })
        || (!translationText && lineStructuralTags.size > 0)
      );
      if (customPreserved) customPreservedLines += 1;
      if (builtinPreserved) builtinPreservedLines += 1;
      // 「音乐卡片」 catches what a reader's own rules did not: the fixed NOW PLAYING caption and a row
      // already written "原文 (译文)" are kept exactly as they are, never translated or read.
      const cardCaption = options.musicCardRules === true && line.fromBr && !customPreserved && !builtinPreserved
        && MUSIC_CARD_CAPTION_RE.test(translationText);
      const cardBilingual = options.musicCardRules === true && line.fromBr && !customPreserved && !builtinPreserved
        && isCardBilingualRow(translationText, musicCardRulesV3);
      const cardPreserved = cardCaption || cardBilingual;
      if (cardPreserved) cardPreservedLines += 1;
      const lyricByRule = matchesPreserveLine(matchSubject, lyricRules.rules, { modern });
      // "其余以 <br> 结尾的卡片行": whatever is left of a card row once the reader's own preserve and
      // lyric rules and the two built-ins above have all had a turn is assumed to be a lyric line — the
      // one guess this group makes, and the reason it defaults off (design §7 item 10).
      const cardCatchAll = options.musicCardRules === true && line.fromBr
        && !customPreserved && !builtinPreserved && !cardPreserved && !lyricByRule;
      const lyricCandidate = Boolean(translationText) && !customPreserved && !builtinPreserved && !cardPreserved
        && (lyricByRule || cardCatchAll);
      const lyricChinese = lyricCandidate && looksAlreadyTranslatedLyric(translationText);
      if (lyricCandidate) lyricLines += 1;
      const lyric = lyricCandidate && !lyricChinese;
      const semantic = Boolean(translationText) && !customPreserved && !builtinPreserved && !cardPreserved && !lyricChinese;
      return {
        source: sourceLine,
        separator: line.separator,
        translationText,
        readingText,
        ...(semantic ? excludedAround(line.text, blocks) : { lead: '', trail: '' }),
        // Who says what, when the story marked it; kept beside the segment, never on it.
        speech: speechMarkedLine(withoutExcluded),
        semantic,
        lyric,
        // Carried through so the chunk-building below can tell a run of card rows apart from the
        // ordinary line that may precede it (a card's first row always starts its own unit).
        fromBr: Boolean(line.fromBr),
        closingTagOnly: isClosingTagOnlyLine(withoutExcluded),
        // `format`/`quoteFormats`/`inlineFragments` are all read off the masked text (via
        // `formatSource`) so an excluded block inside the line cannot be mistaken for part of a
        // wrapper — the tokens standing in for it carry no angle brackets. A card row's own trailing
        // <br> is dropped first, so a wrapper's closing tag right before it still looks like it closes
        // at the row's end.
        ...(() => {
          const source = formatSource(line);
          const format = lineFormatting(source);
          // Layers 2 and 3 of carrying the original's own typesetting (design §2): one quote-shaped
          // wrapper per quoted run, and every smaller tagged fragment. Both are cheap, structural reads
          // of the original alone — no different from `format` — so both are always computed; only
          // rendering and the translation request itself are gated on 特效字 (index.js, prompts.js).
          // A whole line already covered by `format` is not reported again by `lineQuoteFormats` too —
          // the ordinary case of one line, one quote, would otherwise wrap `<b>` around it twice, once
          // from each layer.
          return {
            format,
            quoteFormats: format ? [] : lineQuoteFormats(source),
            inlineFragments: inlineFormatRuns(source),
          };
        })(),
      };
    });
    const firstSemantic = lines.findIndex(line => line.semantic);
    if (firstSemantic < 0) {
      layout.push({ type: 'raw', text: restoredParagraph });
      return;
    }
    let lastIncluded = lines.length - 1;
    while (lastIncluded > firstSemantic && lines[lastIncluded].closingTagOnly) lastIncluded -= 1;

    const leading = lines.slice(0, firstSemantic).map(line => `${line.source}${line.separator}`).join('');
    if (leading) layout.push({ type: 'raw', text: leading });

    if (options.paragraphPerLine === true) {
      const selected = lines.slice(firstSemantic, lastIncluded + 1);
      const lastSemantic = selected.reduce((last, line, index) => (line.semantic ? index : last), -1);
      let pendingRaw = '';
      selected.forEach((line, index) => {
        const separator = index < selected.length - 1 ? line.separator : '';
        if (!line.semantic) {
          pendingRaw += `${line.source}${separator}`;
          return;
        }
        if (pendingRaw) {
          layout.push({ type: 'raw', text: pendingRaw });
          pendingRaw = '';
        }
        const segment = { id: startId + segments.length, text: line.translationText };
        const fragments = line.inlineFragments ?? [];
        // Same as the ordinary (non-paragraphPerLine) branch below: only present when this line
        // actually carries one, so a line with nothing to carry costs nothing beyond the length check.
        if (fragments.length) {
          segment.fragments = fragments.map(fragment => fragment.text);
          fragmentsById.set(segment.id, fragments);
        }
        segments.push(segment);
        if (line.speech) speech.set(segment.id, line.speech);
        if (line.readingText !== line.translationText) reading.set(segment.id, line.readingText);
        if (line.lyric) lyricIds.add(segment.id);
        layout.push({
          type: 'segment',
          id: segment.id,
          ids: [segment.id],
          text: segment.text,
          sourceText: line.source,
          formats: [line.format ?? null],
          // Layers 2 and 3 (design §2), aligned with `ids`/`formats` one entry per line — the same shape
          // the ordinary branch's own chunk carries, so 特效字's carried formatting works in this mode too.
          quoteFormats: [line.quoteFormats ?? []],
          fragments: [fragments],
          lineParts: [{ semantic: true, source: line.source, lead: line.lead, trail: line.trail }],
          padAfter: index !== lastSemantic,
          ...(line.lyric ? { lyric: true } : {}),
        });
        paragraphs += 1;
        if (separator) layout.push({ type: 'raw', text: separator });
      });
      if (pendingRaw) layout.push({ type: 'raw', text: pendingRaw });
      const tail = `${lines[lastIncluded].separator}${lines.slice(lastIncluded + 1)
        .map(line => `${line.source}${line.separator}`)
        .join('')}`;
      if (tail) layout.push({ type: 'raw', text: tail });
      return;
    }

    // A lyric line never joins the surrounding narration's unit (design §3 「歌词行单独成单元」): the
    // selected range is cut into chunks at every lyric line, each lyric line its own one-line chunk, the
    // narration between them grouped exactly as the whole range used to be grouped as one.
    const selectedAll = lines.slice(firstSemantic, lastIncluded + 1);
    const chunks = [];
    let current = [];
    for (const line of selectedAll) {
      if (line.lyric) {
        if (current.length) chunks.push(current);
        chunks.push([line]);
        current = [];
        continue;
      }
      // v0.40.0 (musicCardRulesV3): a card's first row must start its own unit too, never merge into
      // the narration that precedes it. Only the transition from an ordinary line into a run of
      // <br>-joined card rows forces this boundary — later rows of the same run still group with each
      // other exactly as before. Gated the same as the rest of musicCardRulesV3, so an older floor's
      // units still match what it was actually segmented and translated with.
      if (musicCardRulesV3 && line.fromBr && current.length && !current[current.length - 1].fromBr) {
        chunks.push(current);
        current = [];
      }
      current.push(line);
    }
    if (current.length) chunks.push(current);

    chunks.forEach((chunk, chunkIndex) => {
      const isLastChunk = chunkIndex === chunks.length - 1;
      // Every line but the chunk's own last one keeps its separator inside the unit; the chunk's own
      // last line defers its separator to whatever follows the chunk — the same way the single unit
      // this loop replaces always deferred `lines[lastIncluded]`'s own separator to `trailing` below.
      const heldSeparator = (line, indexInChunk) => (indexInChunk < chunk.length - 1 ? line.separator : '');
      if (chunk.length === 1 && chunk[0].lyric) {
        const line = chunk[0];
        const segment = { id: startId + segments.length, text: line.translationText };
        segments.push(segment);
        if (line.speech) speech.set(segment.id, line.speech);
        if (line.readingText !== line.translationText) reading.set(segment.id, line.readingText);
        lyricIds.add(segment.id);
        layout.push({
          type: 'segment',
          id: segment.id,
          ids: [segment.id],
          text: segment.text,
          sourceText: line.source,
          formats: [line.format ?? null],
          lineParts: [{ semantic: true, source: line.source, lead: line.lead, trail: line.trail }],
          lyric: true,
        });
      } else {
        const ids = [];
        const unitTexts = [];
        const unitFormats = [];
        const unitQuoteFormats = [];
        const unitFragments = [];
        for (const line of chunk) {
          if (!line.semantic) continue;
          const fragments = line.inlineFragments ?? [];
          const segment = { id: startId + segments.length, text: line.translationText };
          // Only present when this line actually has one: a segment with nothing to carry costs the
          // request payload (and every reader of `segments` that is not this feature) nothing.
          if (fragments.length) {
            segment.fragments = fragments.map(fragment => fragment.text);
            fragmentsById.set(segment.id, fragments);
          }
          segments.push(segment);
          if (line.speech) speech.set(segment.id, line.speech);
          if (line.readingText !== line.translationText) reading.set(segment.id, line.readingText);
          ids.push(segment.id);
          unitTexts.push(segment.text);
          unitFormats.push(line.format ?? null);
          unitQuoteFormats.push(line.quoteFormats ?? []);
          unitFragments.push(fragments);
        }
        const sourceText = chunk.map((line, index) => `${line.source}${heldSeparator(line, index)}`).join('');
        if (ids.length) {
          layout.push({
            type: 'segment',
            id: ids[0],
            ids,
            text: unitTexts.join('\n'),
            sourceText,
            formats: unitFormats,
            // Aligned with `ids`/`formats`, one entry per line: layer 2's per-quote wrappers and layer
            // 3's structural fragments (design §2). Both travel with the layout the same way `formats`
            // already does — recomputed fresh from the original each time, never stored — so a restyle
            // that re-runs `segmentSource` on the kept original sees them again without asking anybody.
            quoteFormats: unitQuoteFormats,
            fragments: unitFragments,
            // Every line of the unit in order, translatable or not: a replace-tag region rebuilds the
            // paragraph from these so what is not for translation stays where it stood. `separator` is
            // the same value `sourceText` above was actually built with — a card row's own trailing
            // <br> already is the break (separator ''), an ordinary physical-line boundary is '\n' —
            // so replaceUnitBody can join with what really separated these lines instead of assuming
            // '\n' for all of them (v0.40.0).
            lineParts: chunk.map((line, index) => (
              { semantic: line.semantic, source: line.source, lead: line.lead, trail: line.trail, separator: heldSeparator(line, index) }
            )),
          });
        } else {
          // A run of nothing but preserved/card-caption lines between two lyric lines: nothing to
          // translate here, so it stands exactly as written, same as any other preserved run.
          layout.push({ type: 'raw', text: sourceText });
        }
      }
      if (!isLastChunk) {
        const lastLine = chunk[chunk.length - 1];
        if (lastLine.separator) layout.push({ type: 'raw', text: lastLine.separator });
      }
    });
    paragraphs += 1;

    const trailing = `${lines[lastIncluded].separator}${lines.slice(lastIncluded + 1)
      .map(line => `${line.source}${line.separator}`)
      .join('')}`;
    if (trailing) layout.push({ type: 'raw', text: trailing });
  };

  const separatorPattern = /\n(?:[ \t]*\n)+/g;
  let cursor = 0;
  for (const match of body.matchAll(separatorPattern)) {
    appendParagraph(body.slice(cursor, match.index));
    layout.push({ type: 'raw', text: replaceMaskedBlocks(match[0], blocks, 'restore') });
    cursor = match.index + match[0].length;
  }
  appendParagraph(body.slice(cursor));
  if (trailing) layout.push({ type: 'raw', text: replaceMaskedBlocks(trailing, blocks, 'restore') });
  return {
    source,
    layout,
    segments,
    paragraphs,
    customPreservedLines,
    builtinPreservedLines,
    cardPreservedLines,
    lyricLines,
    structuralTags: [...structuralTags].sort(),
    speech,
    reading,
    lyricIds,
    fragmentsById,
  };
}

// When the floor's body changed while the API was working, the ids no longer line up, but the
// paragraphs that were not touched still have identical source text. Carrying those across turns a
// total loss into a partial write that 补译 can finish.
export function remapTranslationsBySource(previousSegments, translations, currentSegments) {
  const carried = new Map();
  if (!(translations instanceof Map) || !translations.size) return carried;
  const byText = new Map();
  for (const segment of Array.isArray(previousSegments) ? previousSegments : []) {
    const text = String(segment?.text ?? '');
    if (!translations.has(segment?.id)) continue;
    if (!byText.has(text)) byText.set(text, []);
    byText.get(text).push(segment.id);
  }
  for (const segment of Array.isArray(currentSegments) ? currentSegments : []) {
    const queue = byText.get(String(segment?.text ?? ''));
    if (!queue?.length) continue;
    const sourceId = queue.shift();
    const value = translations.get(sourceId);
    if (value) carried.set(segment.id, value);
  }
  return carried;
}

export function createTranslationSignature(regions) {
  return JSON.stringify((Array.isArray(regions) ? regions : []).map(region => ({
    tag: String(region?.tagName ?? '').toLowerCase(),
    segments: (Array.isArray(region?.segments) ? region.segments : []).map(segment => String(segment?.text ?? '')),
  })));
}

function unwrapResponseContent(raw) {
  let value = raw;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!value || typeof value !== 'object') break;
    const content = value.content;
    if ((typeof content === 'string' && content.trim()) || (content && typeof content === 'object')) {
      value = content;
      continue;
    }
    const reasoning = value.reasoning ?? value.reasoning_content ?? value.thinking;
    if (typeof reasoning === 'string' && reasoning.trim()) {
      value = reasoning;
      continue;
    }
    break;
  }
  return value;
}

/**
 * The model's own thinking, wherever this provider decided to put it.
 *
 * Every provider spells it differently and buries it at a different depth, and none of it is part of
 * the translation — it is only evidence of what the minutes went into. Pulled out separately so a
 * reader who waited through them can see it without the parser ever confusing it with an answer.
 */
export function extractReasoningText(raw) {
  const seen = new Set();
  const walk = (value, depth) => {
    if (!value || typeof value !== 'object' || depth > 4 || seen.has(value)) return '';
    seen.add(value);
    for (const key of ['reasoning_content', 'reasoning', 'thinking', 'thought']) {
      const found = value[key];
      if (typeof found === 'string' && found.trim()) return found;
    }
    for (const key of ['choices', 'message', 'delta', 'content', 'data', '0']) {
      const child = Array.isArray(value) ? value[0] : value[key];
      const found = walk(child, depth + 1);
      if (found) return found;
    }
    return Array.isArray(value) ? walk(value[0], depth + 1) : '';
  };
  return walk(raw, 0);
}

function findJsonFragmentEnd(text, start) {
  const opening = text[start];
  if (opening !== '{' && opening !== '[') return -1;
  const stack = [opening];
  let inString = false;
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{' || character === '[') stack.push(character);
    else if (character === '}' || character === ']') {
      const expected = character === '}' ? '{' : '[';
      if (stack.at(-1) !== expected) return -1;
      stack.pop();
      if (!stack.length) return index;
    }
  }
  return -1;
}

// Every JSON value a model reply can be read as: the whole reply, fenced blocks, and each balanced
// fragment. Shared with the read-aloud analysis, which asks for labels in the same loose way.
export function parseJsonCandidates(raw) {
  const value = unwrapResponseContent(raw);
  if (value && typeof value === 'object') return [value];
  if (typeof value !== 'string') return [];
  const cleaned = value.replace(/<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
  const candidates = [cleaned];
  for (const match of cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(match[1].trim());
  const fragmentStarts = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < cleaned.length; index += 1) {
    const character = cleaned[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{' || character === '[') fragmentStarts.push(index);
  }
  for (const start of fragmentStarts.slice(-240)) {
    const end = findJsonFragmentEnd(cleaned, start);
    if (end > start) candidates.push(cleaned.slice(start, end + 1));
  }

  const parsed = [];
  const seen = new Set();
  for (const candidate of candidates) {
    try {
      const result = JSON.parse(candidate);
      const signature = JSON.stringify(result);
      if (!seen.has(signature)) {
        seen.add(signature);
        parsed.push(result);
      }
    } catch {
      // Try the next recoverable JSON envelope.
    }
  }
  return parsed;
}

function translationItems(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return [];
  for (const key of ['translations', 'items', 'results', 'data']) {
    if (Array.isArray(parsed[key])) return parsed[key];
  }
  const numericEntries = Object.entries(parsed).filter(([key]) => /^\d+$/.test(key));
  if (numericEntries.length) return numericEntries.map(([id, text]) => ({ id: Number(id), text }));
  if (['id', 'segment_id', 'segmentId'].some(key => Object.hasOwn(parsed, key))) return [parsed];
  return [];
}

const TRANSLATION_PLACEHOLDER_RE = /^(?:[<\[(（【]\s*)?(?:none|null|nil|empty|undefined|n\/a|no\s+translation|not?\s+applicable|untranslated)(?:\s*[>\])）】])?$/i;

function normalizeTranslationText(value) {
  if (typeof value !== 'string') return '';
  let text = value.trim().replace(/^```(?:text)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (text.startsWith('{') && text.endsWith('}') && text.length > 2) text = text.slice(1, -1).trim();
  text = text.replaceAll(INVISIBLE_MARKER, '').replace(/\r?\n+/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
  text = text.replace(/^(?:中文|译文|translation)\s*[:：]\s*/i, '').trim();
  // Some models answer a segment they decided not to translate with a placeholder token. Writing that
  // into the floor is worse than reporting the segment as missing, which lets 补译 pick it up.
  if (TRANSLATION_PLACEHOLDER_RE.test(text)) return '';
  return text;
}

// The optional speaker/emotion labels. They are display metadata: a value that is missing, wrong or
// nonsense costs the line its colour and nothing else, so nothing here is allowed to throw or to
// reach the translated text itself.
// Answers a small model gives instead of leaving the field out. Kept as speakers they would each earn
// a colour of their own, and a narrated line would be painted as though somebody were talking.
const NON_SPEAKERS = new Set([
  '旁白', '叙述', '叙述者', '敘述', '敘述者', '描写', '描寫', '心理描写', '内心', '内心独白', '独白',
  '无', '無', '未知', '不明', '无人', 'narrator', 'narration', 'none', 'null', 'unknown', 'n/a', 'na', '-',
  // A pronoun is nobody's name: given a colour it would join the roster as a person of its own. The
  // host's placeholders stay unexpanded only by mistake. "User" is not here: it is the host's default
  // name for the reader, and a real person on every chat that kept it.
  '你', '我', '您', '他', '她', '它', '他们', '她们', '众人', '大家', '{{user}}', '{{char}}',
]);

export function isPlaceholderSpeaker(name) {
  return NON_SPEAKERS.has(String(name ?? '').trim().toLowerCase()) || isExampleValue(name);
}

// The request's example shows each field with a stand-in in angle brackets. A model that copies one
// back would otherwise earn a colour for 「<人名>」; the older stand-ins are here for the same reason. A
// real value the model wrapped in the same brackets, 「<英梨梨>」, is that value.
const EXAMPLE_WRAP_RE = /^[<＜〈]([^<>＜＞〈〉]*)[>＞〉]$/u;
export const EXAMPLE_STAND_INS = Object.freeze([
  '人名', '情绪词', '说法', '声音词', '台词开头几个字', '译文里这处台词开头 2 到 6 个字',
  '这一项该怎么念的中文指令', '这句台词该怎么念的中文指令',
]);
const OLD_EXAMPLE_VALUES = new Set(['名单中的名字', '下列标签之一', '可选', '这句台词开头几个字']);

// A value as the model meant it: '' for a stand-in copied back, the inside of the brackets for a real
// value wrapped in them, anything else as written. A stand-in counts only in the example's brackets: a
// head of 说法 or 人名 is two words of the translation. The older stand-ins were shown bare.
function exampleFree(value) {
  const text = String(value ?? '').trim();
  const wrapped = text.match(EXAMPLE_WRAP_RE);
  if (!wrapped) return OLD_EXAMPLE_VALUES.has(text) ? '' : text;
  const bare = wrapped[1].trim();
  return EXAMPLE_STAND_INS.includes(bare) || OLD_EXAMPLE_VALUES.has(bare) ? '' : bare;
}

function isExampleValue(value) {
  return Boolean(String(value ?? '').trim()) && !exampleFree(value);
}

/**
 * One mark as a model wrote it, field by field: who, in what mood, and the reading's own words for how
 * the line is said. The words a mark points at (stress, pauses, sounds, the turn) are kept as written
 * here and checked against the sentence where the mark is placed on it.
 */
export function readAnnotationFields(object) {
  if (!object || typeof object !== 'object') return null;
  const reportedSpeaker = exampleFree(object.speaker ?? object.who ?? object.name ?? object.character).slice(0, 60);
  const speaker = isPlaceholderSpeaker(reportedSpeaker) ? '' : reportedSpeaker;
  const tone = exampleFree(object.tone).slice(0, 30);
  // `tone` used to be read as the mood; a mark with a tone and no mood still is.
  const emotion = exampleFree(object.emotion ?? object.emo ?? object.mood ?? tone).slice(0, 40);
  const direction = exampleFree(String(object.direction ?? object.instruction ?? '').replace(/\s+/g, ' ')).slice(0, 80);
  const word = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
  const sounds = (Array.isArray(object.sounds) ? object.sounds : [])
    .map(sound => {
      const after = word(sound?.after);
      const at = sound?.at === 'end' ? 'end' : (sound?.at === 'after' && after) ? 'after' : 'start';
      return { at, tag: word(exampleFree(sound?.tag ?? sound?.sound)), ...(at === 'after' ? { after } : {}) };
    })
    .filter(sound => sound.tag)
    .slice(0, 3);
  // A run's mark may carry nothing but its sound: the prompt asks for the sound on the run, and says to
  // leave out whatever else is unsure.
  if (!speaker && !emotion && !direction && !sounds.length) return null;
  const intensity = Number(object.intensity ?? object.level ?? object.strength);
  const annotation = {};
  if (speaker) annotation.speaker = speaker;
  if (emotion) annotation.emotion = emotion;
  if (Number.isFinite(intensity)) annotation.intensity = Math.min(2, Math.max(0, Math.round(intensity)));
  if (tone) annotation.tone = tone;
  if (direction) annotation.direction = direction;
  const speed = String(object.speed ?? '').trim().toLowerCase();
  if (speed === 'slow' || speed === 'fast') annotation.speed = speed;
  const volume = String(object.volume ?? '').trim().toLowerCase();
  if (volume === 'quiet' || volume === 'loud') annotation.volume = volume;
  const stress = [...new Set((Array.isArray(object.stress) ? object.stress : [object.stress]).map(word).filter(Boolean))].slice(0, 3);
  if (stress.length) annotation.stress = stress;
  const pauses = (Array.isArray(object.pauses) ? object.pauses : [])
    .map(pause => ({ after: word(pause?.after ?? pause?.word), length: pause?.length === 'long' ? 'long' : 'short' }))
    .filter(pause => pause.after)
    .slice(0, 4);
  if (pauses.length) annotation.pauses = pauses;
  if (sounds.length) annotation.sounds = sounds;
  const shiftSource = object.shift && typeof object.shift === 'object' ? object.shift : (Array.isArray(object.shifts) ? object.shifts[0] : null);
  if (shiftSource && typeof shiftSource === 'object') {
    const shift = { at: word(shiftSource.at ?? shiftSource.word), direction: String(shiftSource.direction ?? shiftSource.emotion ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) };
    if (shift.at && shift.direction) annotation.shift = shift;
  }
  return annotation;
}

/**
 * One quoted run's own mark, with the opening characters that place it on its run. A run in quotes that
 * nobody says — a sign, a title — is marked as narration and nothing else: it is still counted, so the
 * runs after it are placed by order where their heads cannot be matched, as on the original's side.
 * Null for anything that is neither.
 */
export function readQuoteMark(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const head = exampleFree(entry.head ?? entry.start).slice(0, 20);
  if (String(entry.type ?? '').trim().toLowerCase() === 'narration') return { ...(head ? { head } : {}), type: 'narration' };
  const mark = readAnnotationFields(entry);
  return mark ? { ...(head ? { head } : {}), ...mark } : null;
}

// 1–3, whatever a model answers (see palette.js `normalizeMoveTier`, which clamps the same way for a
// mark read back out of storage): core.js stays independent of palette.js's colour maths, so the
// clamp is repeated here rather than imported.
function clampMoveTier(value) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(3, Math.max(1, number)) : 1;
}

// One move (招式/技能/法宝) the translator named inside this item: what it is called, what it draws
// on, and how big a deal it is. `element` and `tier` are free-form enough that a model rarely leaves
// them out, so both default rather than dropping the whole move for want of one — the colour maths
// (palette.js `resolveMoveStyle`) already falls back to a name-derived hue when `element` is empty.
export function readMoveMark(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const name = exampleFree(entry.name ?? entry.move ?? entry.title).slice(0, 24);
  if (!name) return null;
  const element = exampleFree(entry.element ?? entry.attribute ?? entry.type).slice(0, 12);
  return { name, element, tier: clampMoveTier(entry.tier ?? entry.level) };
}

// A run's own text is checked against the item's `text` before it is trusted anywhere (design §2
// item 4: "找不到的丢掉"); this only shapes the raw string the model wrote, the same way `word()` above
// shapes a stress or a pause.
function readCarriedRunText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

// A line's mark, plus one mark per quoted run when the reading asked for them, this item's own moves
// and the translated text of its carried-format runs (特效字 — see core.js `inlineFormatRuns`, which
// is what numbered the fragments this answers, in the same order). Whatever is not a mark is dropped
// without a word.
function readAnnotation(object) {
  if (!object || typeof object !== 'object') return null;
  const fields = readAnnotationFields(object) ?? {};
  const quotes = (Array.isArray(object.quotes) ? object.quotes : []).slice(0, 12).map(readQuoteMark).filter(Boolean);
  if (quotes.length) fields.quotes = quotes;
  const moves = (Array.isArray(object.moves) ? object.moves : []).slice(0, 6).map(readMoveMark).filter(Boolean);
  if (moves.length) fields.moves = moves;
  if (Array.isArray(object.runs) && object.runs.length) {
    const runs = object.runs.slice(0, 12).map(readCarriedRunText);
    if (runs.some(Boolean)) fields.runs = runs;
  }
  return Object.keys(fields).length ? fields : null;
}

function lineProtocolItems(raw) {
  const value = unwrapResponseContent(raw);
  if (typeof value !== 'string') return [];
  return normalizeNewlines(value).split('\n').map(line => {
    const match = line.trim().match(/^(?:\[|【)?\s*(\d+)\s*(?:\]|】)?\s*[:：|]\s*(.+)$/);
    return match ? { id: Number(match[1]), text: match[2] } : null;
  }).filter(Boolean);
}

// A whole floor sent as one request is capped by the channel's own output budget, so a long floor
// truncates the JSON and comes back missing most of its ids. Batches are sized from that budget:
// 0.8 chars per token leaves headroom for JSON overhead and thinking; a truncating channel is
// recovered by the repair loop rather than by shrinking every batch up front.
export function translationCharBudget(maxTokens) {
  const tokens = clampInteger(maxTokens, 256, MAX_OUTPUT_TOKENS_LIMIT, DEFAULT_CHANNEL.maxTokens);
  return clampInteger(Math.round(tokens * 0.8), 400, 160000, 1400);
}

export function planTranslationBatches(segments, options = {}) {
  const list = Array.isArray(segments) ? segments.filter(Boolean) : [];
  if (!list.length) return [];
  // The character budget is the only constraint; segment counts never split a batch.
  const maxChars = clampInteger(options.maxChars, 200, 200000, 1400);
  const batches = [];
  let current = [];
  let chars = 0;
  for (const segment of list) {
    const length = String(segment?.text ?? '').length;
    // A single oversized segment still travels alone rather than being dropped or split.
    if (current.length && chars + length > maxChars) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(segment);
    chars += length;
  }
  if (current.length) batches.push(current);
  const parallel = clampInteger(options.parallel, 1, 8, 1);
  // Parallel lanes only pay off when there is something to spread across them. A floor that already
  // needs at least as many batches as lanes keeps its budget-sized ones; a floor that fits in fewer is
  // split evenly by characters, so no lane sits idle while another carries the whole floor.
  if (parallel > 1 && batches.length < parallel && list.length > batches.length) {
    const even = splitBatchesEvenly(list, Math.min(parallel, list.length));
    const fits = even.every(batch => batch.length === 1
      || batch.reduce((sum, segment) => sum + String(segment?.text ?? '').length, 0) <= maxChars);
    if (fits) return even;
  }
  return batches;
}

function splitBatchesEvenly(list, count) {
  const total = list.reduce((sum, segment) => sum + String(segment?.text ?? '').length, 0);
  const share = total / count;
  const batches = [];
  let current = [];
  let chars = 0;
  for (const segment of list) {
    const length = String(segment?.text ?? '').length;
    // Close a lane once this segment would carry it past its share, while lanes remain to open.
    if (current.length && chars + length / 2 > share && batches.length < count - 1) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(segment);
    chars += length;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function recoverStructuredTranslations(raw, expectedSegments) {
  const expected = Array.isArray(expectedSegments) ? expectedSegments : [];
  const expectedIds = new Set(expected.map(item => Number(item.id)));
  const parsedCandidates = parseJsonCandidates(raw);
  const items = [];
  const seenItems = new Set();
  // A run's own marks inside `quotes` parse as fragments of their own: the array alone reads as a list
  // of items. None of them is a translation. Counted, one reported an empty item and upset the order
  // fallback; one written with a text of its own could even hand a quote's words to a line by position.
  const TEXT_KEYS = ['text', 'chinese', 'translation', 'zh', 'cn', 'id', 'segment_id', 'segmentId', 'index'];
  const ID_KEYS = ['id', 'segment_id', 'segmentId', 'index'];
  const runMarks = new Set();
  // An item's own `runs` (特效字 layer 3, prompts.js) is a plain array of strings, not objects — the
  // same bracket scan that recovers a truncated JSON reply also finds this array on its own and hands
  // it to `translationItems` as if it were the top-level `translations` array, each of its strings then
  // read as an id-less translation. `isRunMark` below only ever catches an *object* item; a `runs`
  // entry is a bare string, so nothing stops it from joining `items` and, having no id, throwing off
  // the position count `items.length === expected.length` gates the id-less recovery fallback on. The
  // fix is not to filter it back out item by item but to never walk into it as a fallback list of
  // items at all: its own signature is recorded here and the candidate is skipped outright below.
  const consumedRunArrays = new Set();
  const collectRuns = value => {
    if (Array.isArray(value)) {
      value.forEach(collectRuns);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.quotes)) for (const quote of value.quotes) if (quote && typeof quote === 'object') runMarks.add(JSON.stringify(quote));
    if (Array.isArray(value.runs)) consumedRunArrays.add(JSON.stringify(value.runs));
    for (const key of ['translations', 'items', 'results', 'data']) if (Array.isArray(value[key])) value[key].forEach(collectRuns);
  };
  parsedCandidates.forEach(collectRuns);
  const isRunMark = item => item && typeof item === 'object' && !Array.isArray(item)
    && (!TEXT_KEYS.some(key => Object.hasOwn(item, key)) || (!ID_KEYS.some(key => Object.hasOwn(item, key)) && runMarks.has(JSON.stringify(item))));
  for (const parsed of parsedCandidates) {
    if (Array.isArray(parsed) && consumedRunArrays.has(JSON.stringify(parsed))) continue;
    for (const item of translationItems(parsed)) {
      if (isRunMark(item)) continue;
      const signature = typeof item === 'string' ? `text:${item}` : `json:${JSON.stringify(item)}`;
      if (!seenItems.has(signature)) {
        seenItems.add(signature);
        items.push(item);
      }
    }
  }
  if (!items.length) items.push(...lineProtocolItems(raw));
  const translations = new Map();
  const annotations = new Map();
  const warnings = [];
  const unresolved = [];

  items.forEach((item, index) => {
    const object = item && typeof item === 'object' && !Array.isArray(item) ? item : null;
    const rawText = typeof item === 'string'
      ? item
      : object?.text ?? object?.chinese ?? object?.translation ?? object?.zh ?? object?.cn;
    const text = normalizeTranslationText(rawText);
    const rawId = object?.id ?? object?.segment_id ?? object?.segmentId ?? object?.index;
    const id = Number(rawId);
    const annotation = readAnnotation(object);
    if (!text) {
      warnings.push(`第 ${Number.isInteger(id) ? id : index + 1} 项为空，已留待补译。`);
      return;
    }
    if (Number.isInteger(id) && expectedIds.has(id)) {
      if (!translations.has(id)) {
        translations.set(id, text);
        if (annotation) annotations.set(id, annotation);
      } else warnings.push(`第 ${id} 项重复，已保留第一条。`);
      return;
    }
    unresolved.push({ index, text, annotation });
  });

  if (items.length === expected.length) {
    for (const item of unresolved) {
      const fallbackId = Number(expected[item.index]?.id);
      if (expectedIds.has(fallbackId) && !translations.has(fallbackId)) {
        translations.set(fallbackId, item.text);
        if (item.annotation) annotations.set(fallbackId, item.annotation);
        warnings.push(`第 ${fallbackId} 项缺少有效 id，已按位置恢复。`);
      }
    }
  }

  const missingIds = expected.map(item => Number(item.id)).filter(id => !translations.has(id));
  const unwrapped = unwrapResponseContent(raw);
  let contentCharacters = 0;
  if (typeof unwrapped === 'string') contentCharacters = unwrapped.length;
  else if (unwrapped && typeof unwrapped === 'object') {
    try {
      contentCharacters = JSON.stringify(unwrapped).length;
    } catch {
      contentCharacters = 0;
    }
  }
  const response = {
    envelope: Array.isArray(raw) ? 'array' : raw === null ? 'null' : typeof raw,
    topLevelKeys: raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw).slice(0, 12) : [],
    contentType: Array.isArray(unwrapped) ? 'array' : unwrapped === null ? 'null' : typeof unwrapped,
    contentCharacters,
    parsedCandidates: parsedCandidates.length,
    recoveredItems: items.length,
    annotatedItems: annotations.size,
  };
  return { translations, annotations, missingIds, warnings, parsed: parsedCandidates.length > 0, response };
}

export function parseStructuredTranslations(raw, expectedSegments) {
  const recovered = recoverStructuredTranslations(raw, expectedSegments);
  if (!recovered.translations.size) throw new Error('副模型没有返回可恢复的译文。');
  if (recovered.missingIds.length) throw new Error(`副模型缺少第 ${recovered.missingIds.join('、')} 段译文。`);
  return recovered.translations;
}

export function assembleBilingual(layout, translationMap, options = {}) {
  const allowMissing = options.allowMissing === true;
  const pieces = [];
  for (const part of layout) {
    if (part.type === 'raw' || part.type === 'blank') {
      pieces.push(part.text);
      continue;
    }
    const ids = Array.isArray(part.ids) && part.ids.length ? part.ids : [part.id];
    const missingIds = ids.filter(id => !translationMap.get(id));
    if (missingIds.length && !allowMissing) throw new Error(`缺少第 ${missingIds.join('、')} 段译文。`);
    if (part.lyric) {
      pieces.push(renderLyricPair(part, translationMap.get(ids[0]), options));
      continue;
    }
    pieces.push(renderSourceBlock(part.sourceText ?? part.text, options));
    const decoration = segmentDecoration(options.styleFor, ids, ids.map(id => translationMap.get(id) ?? ''), part.quoteFormats, part.fragments);
    const body = translationUnitBody(part, ids, translationMap, options, decoration);
    if (body) {
      pieces.push(`\n${renderTranslationBlock(body, {
        ...options,
        padAfter: part.padAfter === true,
        ...decoration,
        // The body is already shaped line by line above, rhythm and carried formatting included.
        styleBody: null,
      })}`);
    }
  }
  return pieces.join('');
}

function markedAffix(value) {
  return value ? `${AFFIX_START}${value}${AFFIX_END}` : '';
}

// The exact marked-affix bytes a lyric pair's parentheses are written with — restyleBilingual matches
// against these literally to tell a lyric block apart from an ordinary one without any layout of its
// own to consult (it works by regex over the raw floor text alone).
const LYRIC_OPEN_AFFIX = markedAffix(' (');
const LYRIC_CLOSE_AFFIX = markedAffix(')');

/**
 * A lyric line, bilingual mode: "原文 (译文)" on one visible line, the restored `<br>` (if the row had
 * one) ending it — see design §2 「歌词怎么译、怎么排」 and §3 item 2. `generatedBlockAfter`'s leading
 * `\n?` is what lets the translation block sit right after the source block with nothing between them.
 *
 * The opening "(" rides inside the source block itself, as the block's own trailing affix, so
 * `extractGeneratedTranslations`/`restyleBilingual` never need to look past anything between
 * `SOURCE_END` and `TRANSLATION_START` — there is nothing there. The closing ")" is a marked affix,
 * the `<br>` bare text: read-back strips the punctuation and keeps the tag, which is what lets the
 * card's own line structure survive a re-translation (segmentSource sees the same `<br>`-ended row).
 */
function renderLyricPair(part, translation, options = {}) {
  const trailingBr = String(part?.sourceText ?? '').match(TRAILING_BR_RE);
  const bareSource = trailingBr ? part.sourceText.slice(0, trailingBr.index) : String(part?.sourceText ?? '');
  const trailer = trailingBr ? trailingBr[1] : '';
  // No translation yet (a partial write, mid-stream, or a row withoutUntranslated dropped): the row's
  // own trailing <br> has to go back exactly where it came from, and without a translation there is no
  // " (" to open — writing it here would leave a dangling affix with nothing to close it, and the very
  // next line's <br> gone with it.
  if (!translation) return `${SOURCE_START}${bareSource}${SOURCE_END}${trailer}`;
  const sourceBlock = `${SOURCE_START}${bareSource}${LYRIC_OPEN_AFFIX}${SOURCE_END}`;
  const translationBlock = `${TRANSLATION_START}${String(translation)}${TRANSLATION_END}`;
  return `${sourceBlock}${translationBlock}${LYRIC_CLOSE_AFFIX}${trailer}`;
}

/**
 * A lyric line, replace mode: still "原文 (译文)" in place (design §2, same as bilingual/只留译文), but
 * built as an ordinary replace pair — visible SOURCE-block position, hidden original — instead of
 * `renderLyricPair`'s own SOURCE+TRANSLATION shape, which has no hidden block at all for a replace
 * region's reader (`extractReplaceTranslations`) to find: the lyric id was never in `existingTranslations`,
 * so the row was re-sent on every run, and the main model saw the original in its prompt (stripped down
 * to whatever a plain SOURCE block holds) instead of the translation replace mode is supposed to show it.
 *
 * "原文 (" and ")" ride as marked affixes either side of the bare translation, exactly like the visible
 * decoration around an ordinary replace segment's translation — `extractReplaceTranslations` already
 * strips every marked affix off a pair's translation half (`AFFIX_RE`), so it reads the plain translation
 * straight out from between them with no changes of its own needed.
 *
 * The row's own trailing `<br>` (if it had one), like `renderLyricPair`'s, is bare text outside every
 * block rather than folded into either half: inside the hidden block it would double up on restore (the
 * source view already gets it back once, from the hidden bare source that keeps it); inside the visible
 * half it would vanish from the prompt view along with the rest of that half's marked affixes, taking the
 * card's own line break out of what the main model sees with it. Kept bare after the whole pair, it
 * survives both.
 */
function renderReplaceLyricPair(part, translation, options = {}) {
  const sourceFull = String(part?.sourceText ?? '');
  const trailingBr = sourceFull.match(TRAILING_BR_RE);
  const bareSource = trailingBr ? sourceFull.slice(0, trailingBr.index) : sourceFull;
  const trailer = trailingBr ? trailingBr[1] : '';
  if (!translation) return sourceFull; // Not translated yet: stay as plain original text, ready for 补译.
  const visible = `${markedAffix(`${bareSource} (`)}${String(translation)}${markedAffix(')')}`;
  return `${SOURCE_START}${visible}${SOURCE_END}\n${HIDDEN_START}${bareSource}${HIDDEN_END}${trailer}`;
}

/**
 * Builds one unit's translated body, line by line.
 *
 * Two things happen per line rather than per block. The rhythm contour reads one line at a time, and
 * the carried formatting belongs to the line it came from — a paragraph where only the dialogue line
 * is painted has to come back with only that line painted.
 *
 * The carried tags go in as marked affixes, so `AFFIX_RE` strips them on read-back exactly like the
 * speaker wrapper: 补译 still sees the plain translation and the main model still sees the original.
 */
function translationUnitBody(part, ids, translationMap, options, decoration = {}) {
  const carry = options.carryFormatting !== false;
  const formats = Array.isArray(part?.formats) ? part.formats : [];
  const lines = [];
  ids.forEach((id, index) => {
    const translation = translationMap.get(id);
    if (!translation) return;
    const shaped = styledBody(String(translation), decoration.styleBody, markedAffix, id);
    const format = carry ? formats[index] : null;
    if (!format?.open) {
      lines.push(shaped);
      return;
    }
    // Speaker colouring is an explicit choice about this line's colour, so it wins; the carried
    // weight and slant still apply underneath it. A line it did not paint keeps the original's colour.
    const open = paintsLine(decoration, id) ? withoutCarriedColor(format.open) : format.open;
    lines.push(`${markedAffix(open)}${shaped}${markedAffix(format.close)}`);
  });
  return lines.join('\n');
}

// Speaker and emotion styling rides inside the same invisible affix markers the visible prefixes
// use. That is the whole trick: nothing new has to learn how to strip it, the main model's prompt
// never sees it, and a floor written with colouring on reads back identically with it off.
function segmentDecoration(styleFor, ids, texts = [], quoteFormats = [], fragments = []) {
  if (typeof styleFor !== 'function') return {};
  let decoration;
  try {
    decoration = styleFor(ids, texts, quoteFormats, fragments);
  } catch {
    return {}; // A palette problem must never cost the reader their translation.
  }
  if (!decoration?.open) return {};
  return {
    stylePrefix: String(decoration.open),
    styleSuffix: String(decoration.close ?? ''),
    styleBody: typeof decoration.emphasis === 'function' ? decoration.emphasis : null,
    // True, or which lines: a unit painted run by run paints some of its lines and leaves the rest.
    paintsColor: typeof decoration.paintsColor === 'function' ? decoration.paintsColor : decoration.paintsColor === true,
  };
}

// Whether the unit's decoration paints this line's colour, so the original's carried colour gives way.
function paintsLine(decoration, id) {
  if (typeof decoration?.paintsColor !== 'function') return decoration?.paintsColor === true;
  try {
    return decoration.paintsColor(id) === true;
  } catch {
    return false;
  }
}

/**
 * Applies the per-clause rhythm inside one translation.
 *
 * Every tag goes in wrapped as its own marked affix, which is what makes this safe: `AFFIX_RE` is
 * global, so the same read-back that already strips the outer wrapper strips these too. A floor with
 * rhythm therefore still yields the exact translation for 补译 and the exact original for the main
 * model — the invariant is unchanged, there are just more markers inside the block.
 */
/**
 * Keeps a quotation mark in the same span as its partner.
 *
 * SillyTavern wraps 「…」 in its own dialogue tag as the floor renders. A tag that opens inside one
 * span and closes inside the next is not nesting the parser can keep — it truncates the tag at the
 * first `</span>`, so the opening clause takes the dialogue colour and everything after it falls
 * back to narration. That is what one line of dialogue reading half yellow and half white is.
 *
 * A mark whose partner ended up in another piece is lifted out as bare text, which leaves both tags
 * properly nested: `「<span>…</span><span>…</span>」`. Marks that already sit whole inside one piece
 * are left alone, so a quoted run painted in the speaker's colour keeps its quotes painted too.
 */
export function liftSplitQuotes(pieces) {
  const characters = [];
  const owners = [];
  pieces.forEach((piece, index) => {
    for (const character of String(piece?.text ?? '')) {
      characters.push(character);
      owners.push(index);
    }
  });
  const lift = new Set();
  let closer = '';
  let depth = 0;
  let openedAt = -1;
  characters.forEach((character, position) => {
    if (!closer) {
      const pair = SPEECH_OPENERS.get(character);
      if (!pair) return;
      closer = pair;
      depth = 1;
      openedAt = position;
      return;
    }
    if (character === closer) {
      depth -= 1;
      if (depth) return;
      if (owners[openedAt] !== owners[position]) {
        lift.add(openedAt);
        lift.add(position);
      }
      closer = '';
      openedAt = -1;
      return;
    }
    if (SPEECH_OPENERS.get(character) === closer) depth += 1;
  });
  if (!lift.size) return pieces;

  const lifted = [];
  let cursor = 0;
  for (const piece of pieces) {
    let buffer = '';
    for (const character of String(piece?.text ?? '')) {
      if (lift.has(cursor)) {
        if (buffer) lifted.push({ ...piece, text: buffer });
        buffer = '';
        lifted.push({ text: character });
      } else {
        buffer += character;
      }
      cursor += 1;
    }
    if (buffer) lifted.push({ ...piece, text: buffer });
  }
  return lifted;
}

// Written into a move's own span (below) so a later restyle (`restyleBilingual`) can recompute its
// colour against a new band without needing the chat's own annotations again. A move's name or element
// is otherwise free-form model output, so it is escaped exactly like an ordinary HTML attribute value.
function escapeMoveAttribute(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescapeMoveAttribute(value) {
  return String(value ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

// `id` is the line's segment id, so a unit with more than one speaker in it can paint each line's
// quoted runs by that line's own marks.
function styledBody(translation, styleBody, wrap = markedAffix, id = undefined) {
  if (typeof styleBody !== 'function') return translation;
  let pieces;
  try {
    pieces = styleBody(translation, id);
  } catch {
    return translation; // Rhythm is decoration; it never costs the reader their translation.
  }
  if (!Array.isArray(pieces) || !pieces.length) return translation;
  // Refuse anything that does not reassemble into the exact translation, so a bad split is inert
  // rather than a silent rewrite of the text.
  if (pieces.map(piece => piece?.text ?? '').join('') !== translation) return translation;
  // Reassembly alone does not prove the split was safe: cutting a line that carries its own markup
  // between `style="color:` and the rest still rejoins perfectly while nesting a tag inside another
  // tag's attribute. Anything with markup in it keeps its own structure.
  if (translation.includes('<')) return translation;
  pieces = liftSplitQuotes(pieces);
  // Nothing to carry means nothing to wrap: a line split into runs that all came back bare is the
  // line itself, and wrapping it would only add markers for a reader to strip later.
  if (!pieces.some(piece => piece?.css || piece?.className || piece?.rawOpen || piece?.rawClose)) return translation;
  return pieces
    .map(piece => {
      const attributes = [
        piece.className ? `class="${piece.className}"` : '',
        piece.css ? `style="${piece.css}"` : '',
        // A move's own element/name/tier (index.js `moveStyleFor`), carried on the span so a restyle
        // can recolour it later without the chat's annotations — see `recolorMoveSpans` below.
        piece.moveElement !== undefined ? `data-jy-move-element="${escapeMoveAttribute(piece.moveElement)}"` : '',
        piece.moveName !== undefined ? `data-jy-move-name="${escapeMoveAttribute(piece.moveName)}"` : '',
        piece.moveTier !== undefined ? `data-jy-move-tier="${escapeMoveAttribute(piece.moveTier)}"` : '',
      ].filter(Boolean).join(' ');
      const inner = attributes
        ? `${wrap(`<span ${attributes}>`)}${piece.text}${wrap('</span>')}`
        : piece.text;
      // `rawOpen`/`rawClose` are literal carried tags (layer 2's quote wrapper, §2 「原文自带的排版怎么
      // 搬到译文」) wrapped OUTSIDE whatever colour span the piece already got — the same nesting layer
      // 1's own `format.open`/`format.close` sit at around the whole line, just per-run instead.
      return piece.rawOpen || piece.rawClose ? `${wrap(piece.rawOpen ?? '')}${inner}${wrap(piece.rawClose ?? '')}` : inner;
    })
    .join('');
}

// `dropSurroundingCss`'s own job (design §2 "字号二选一"): a fragment carried as <big>/<small> is its
// own size decision, so only the font-size the piece it sat inside was already carrying — an emotion's
// rhythm scale, most often — is dropped. Everything else the piece's `css` held (a speaker's colour,
// most often) rides through untouched, so a carried fragment inside a painted quote keeps that colour.
function dropSizeCss(css) {
  if (!css) return css ?? '';
  return css.split(';').map(part => part.trim()).filter(part => part && !/^font-size\s*:/i.test(part)).join(';');
}

// One longest-first carving pass, deciding both moves and layer 3's carried fragments together. Each
// run in `ordered` is found by its first remaining occurrence and cut into its own piece; `...run`
// rides onto the carved piece ahead of the computed fields below, so any field a caller put on the run
// (a move's `moveElement`/`moveName`/`moveTier`, say) reaches the rendered piece without this function
// having to know its name.
//
// A carried run (one with `rawOpen`/`rawClose`) may never land inside a piece any earlier run of
// *either* kind already carved — its job is to claim the whole span its tag covered, and a piece a move
// already cut up has no single span left to find it by. A move's own colour run is not held to that:
// it may still be cut out of a piece a carried run just produced, which is what lets a move landing
// inside an already-carried half-sentence still get coloured, inside that run's own wrapper — it only
// ever skips a piece another move already claimed, or one carried fully invisible (`hidden`, design §2
// 涂黑/删除线): a move's own colour would make a blacked-out or struck-through name readable again, so
// it is left inside the hidden piece uncoloured instead of carved out on its own.
//
// The one exception to "never land inside a piece an earlier run already carved" is a hidden carried
// run meeting a move piece: when the move's own name is *longer* than the hidden span inside it (a name
// carrying a blacked-out prefix, say), the move is carved first (longest-first) and would otherwise
// leave nothing behind for the hidden run to find — the redaction would vanish and its characters would
// render in the move's colour, the exact leak this run exists to prevent. So a hidden run alone may
// still carve out of a move-applied piece, and the piece it takes does not keep the move's own colour or
// its data-jy-move-* identity: leaving either would let a later restyle's recolorMoveSpans (core.js,
// which matches by that same data attribute and adds a `style` back onto a tag missing one) repaint or
// re-tag exactly the characters this run hides. Whatever text of the move piece is left over keeps the
// move's colour as it did before, since none of it is hidden.
//
// 字号二选一 (design §2 item 4): a run carved out of a piece that is itself a <big>/<small> carried
// fragment (`piece.dropSurroundingCss`, set on that fragment's own run and carried forward on every piece
// it produced) must not add its own `font-size` on top of the wrapper's — the wrapper already made that
// size decision. A carried run with no `css` of its own instead drops any font-size the *piece* it is cut
// from was carrying, the same rule from the other side.
function carvedCss(run, piece) {
  return run.css !== undefined
    ? (piece.dropSurroundingCss ? dropSizeCss(run.css) : run.css)
    : (run.dropSurroundingCss ? dropSizeCss(piece.css) : piece.css);
}

function carveRuns(pieces, ordered) {
  let result = pieces;
  const placed = new Set();
  for (const run of ordered) {
    const carried = Boolean(run.rawOpen || run.rawClose);
    const flag = carried ? 'runApplied' : 'moveApplied';
    let claimed = false;
    const next = [];
    for (const piece of result) {
      const text = piece?.text ?? '';
      const unhidesMove = carried && Boolean(run.hidden) && Boolean(piece.moveApplied);
      const blocked = carried ? Boolean(piece.runApplied || (piece.moveApplied && !unhidesMove)) : Boolean(piece.moveApplied || piece.hidden);
      const at = !claimed && !blocked ? text.indexOf(run.text) : -1;
      if (at < 0) {
        next.push(piece);
        continue;
      }
      claimed = true;
      if (at > 0) next.push({ ...piece, text: text.slice(0, at) });
      const carvedPiece = {
        ...piece,
        ...run,
        css: carvedCss(run, piece),
        className: run.className ?? piece.className,
        // A run with no wrapper of its own (a move) keeps whatever wrapper the piece it was cut from
        // already had, instead of erasing it.
        rawOpen: run.rawOpen ?? piece.rawOpen,
        rawClose: run.rawClose ?? piece.rawClose,
        // A carried run's own `hidden` (index.js `carriedRunsFor`) rides onto the piece it produced, so
        // a move carved out of it later still sees it; a move run carries none of its own, so it falls
        // back to whatever the piece already had.
        hidden: run.hidden ?? piece.hidden,
        [flag]: true,
      };
      if (unhidesMove) {
        carvedPiece.css = undefined;
        carvedPiece.className = undefined;
        carvedPiece.moveElement = undefined;
        carvedPiece.moveName = undefined;
        carvedPiece.moveTier = undefined;
        carvedPiece.moveApplied = false;
      }
      next.push(carvedPiece);
      const rest = text.slice(at + run.text.length);
      if (rest) next.push({ ...piece, text: rest });
    }
    if (claimed) placed.add(run);
    result = next;
  }
  // The source cannot nest fragments (inlineFormatRuns jumps past each one it finds), but the
  // translator's own answer can still make one carried run's text sit only inside another carried run's
  // already-carved span (word reordering, most often). The pass above never lets a carried run land
  // there (a carried run may never land inside a piece any earlier run of either kind already carved,
  // the whole point of "carried" being to claim its own span), so that run's own wrapper — a struck-
  // through or blacked-out fragment, `run.hidden` most often — would otherwise disappear entirely and
  // render as plain, legible text. Nested inside that span instead, both wrappers apply: the outer
  // fragment's tag stays on the rest of its own text, the inner run's tag (and `hidden`) wraps only its
  // own characters.
  for (const run of ordered) {
    if (placed.has(run) || !(run.rawOpen || run.rawClose)) continue;
    let claimed = false;
    const next = [];
    for (const piece of result) {
      const text = piece?.text ?? '';
      const at = !claimed && piece.runApplied && !piece.moveApplied ? text.indexOf(run.text) : -1;
      if (at < 0) {
        next.push(piece);
        continue;
      }
      claimed = true;
      if (at > 0) next.push({ ...piece, text: text.slice(0, at) });
      next.push({
        ...piece,
        ...run,
        css: carvedCss(run, piece),
        className: run.className ?? piece.className,
        rawOpen: `${piece.rawOpen ?? ''}${run.rawOpen ?? ''}`,
        rawClose: `${run.rawClose ?? ''}${piece.rawClose ?? ''}`,
        hidden: Boolean(run.hidden) || Boolean(piece.hidden),
        runApplied: true,
      });
      const rest = text.slice(at + run.text.length);
      if (rest) next.push({ ...piece, text: rest });
    }
    result = next;
  }
  return result;
}

/**
 * Carves named runs out of a piece list, each run's own text found and given its own rendering while
 * whatever piece it sat inside keeps its own `css`/`className` on the rest of its text. Used for both
 * 招式 colouring and layer 3's carried inline fragments (design §2): the two differ only in what a
 * `runs` entry carries — a colour (`css`) for a move, a literal tag pair (`rawOpen`/`rawClose`) for a
 * carried fragment — not in how they are placed.
 *
 * All runs go through one longest-first pass together (`carveRuns`, above): a carried run and a move
 * skip different things once something else has already been carved, which is what lets a move inside
 * an already-carried half-sentence still get coloured without a short carried run inside an earlier,
 * longer move name stealing the move's own characters first. Ties (a carried run and a move of the same
 * length) carve the carried run first, since its whole point is to claim its span before anything else
 * can. A hidden carried run is the one exception to the ordering itself: even when a longer move name
 * carves first and leaves nothing behind for it, it still gets to carve out of the move's own piece
 * afterward (`carveRuns`'s `unhidesMove`) rather than lose its redaction to the move's colour. Only the
 * first remaining occurrence of each run's text is carved — a name mentioned twice in one segment is
 * uncommon, and carving every occurrence would let one wrong `indexOf` match repaint the whole segment.
 */
export function splitPiecesByRuns(pieces, runs) {
  const list = Array.isArray(runs) ? runs.filter(run => run?.text) : [];
  if (!Array.isArray(pieces) || !pieces.length || !list.length) return pieces;
  const isCarried = run => Boolean(run.rawOpen || run.rawClose);
  const ordered = [...list].sort((left, right) => {
    if (right.text.length !== left.text.length) return right.text.length - left.text.length;
    return Number(isCarried(right)) - Number(isCarried(left));
  });
  return carveRuns(pieces, ordered);
}

export function renderSourceBlock(source, options = {}) {
  return `${SOURCE_START}${markedAffix(options.segmentPrefix ?? '')}${source}${markedAffix(options.segmentSuffix ?? '')}${SOURCE_END}`;
}

// A replace-tag pair: the translation rides in the source-block position so the host prompt keeps
// it as plain floor text, while the original hides in the trailing block for re-translation.
export function renderReplacePair(translation, source, decoration = {}) {
  const open = markedAffix(decoration.stylePrefix ?? '');
  const close = markedAffix(decoration.styleSuffix ?? '');
  const body = styledBody(String(translation ?? ''), decoration.styleBody);
  return `${SOURCE_START}${open}${body}${close}${SOURCE_END}\n${HIDDEN_START}${String(source ?? '')}${HIDDEN_END}`;
}

/**
 * A replace-tag paragraph's visible side, line by line: each translatable line as its translation with
 * any excluded block of the line beside it, every other line (a picture on its own line, a preserved
 * line) exactly as written. A line not translated yet shows its original inside the invisible markers,
 * so reading the floor back takes it for missing, not for a translation.
 */
function replaceUnitBody(part, ids, translationMap, options, decoration = {}) {
  const carry = options.carryFormatting !== false;
  const formats = Array.isArray(part?.formats) ? part.formats : [];
  const lineParts = part.lineParts;
  let index = 0;
  return lineParts.map((line, at) => {
    let body;
    if (!line.semantic) {
      body = line.source;
    } else {
      const id = ids[index];
      const format = carry ? formats[index] : null;
      index += 1;
      const translation = translationMap.get(id);
      if (!translation) {
        body = markedAffix(line.source);
      } else {
        const shaped = styledBody(String(translation), decoration.styleBody, markedAffix, id);
        const painted = format?.open
          ? `${markedAffix(paintsLine(decoration, id) ? withoutCarriedColor(format.open) : format.open)}${shaped}${markedAffix(format.close)}`
          : shaped;
        body = `${line.lead ?? ''}${painted}${line.trail ?? ''}`;
      }
    }
    // v0.40.0: each line's own separator (a card row's own trailing <br> already is the break, an
    // ordinary physical-line boundary is a real '\n') instead of assuming '\n' joined every line —
    // see the `lineParts` note in segmentSource that carries it, and readReplaceBodyByLine's own note
    // on reading both this and what a floor written before this fix already has stored.
    const separator = at < lineParts.length - 1 ? (typeof line.separator === 'string' ? line.separator : '\n') : '';
    return `${body}${separator}`;
  }).join('');
}

export function assembleReplace(layout, translationMap, options = {}) {
  const allowMissing = options.allowMissing === true;
  const pieces = [];
  for (const part of layout) {
    if (part.type === 'raw' || part.type === 'blank') {
      pieces.push(part.text);
      continue;
    }
    const ids = Array.isArray(part.ids) && part.ids.length ? part.ids : [part.id];
    // A lyric line keeps its own "原文 (译文)" layout inside a replace region too (design §2 「歌词怎么译、
    // 怎么排」 applies regardless of mode) — but as its own replace pair (renderReplaceLyricPair), not
    // assembleBilingual's renderLyricPair: that shape has no hidden block for extractReplaceTranslations
    // to read the translation back from, and would show the main model the original instead of the
    // translation replace mode is meant to keep visible to it.
    if (part.lyric) {
      const missingIds = ids.filter(id => !translationMap.get(id));
      if (missingIds.length && !allowMissing) throw new Error(`缺少第 ${missingIds.join('、')} 段译文。`);
      pieces.push(renderReplaceLyricPair(part, translationMap.get(ids[0]), options));
      continue;
    }
    const sourceText = part.sourceText ?? part.text;
    const decoration = segmentDecoration(options.styleFor, ids, ids.map(id => translationMap.get(id) ?? ''), part.quoteFormats, part.fragments);
    const byLine = Array.isArray(part.lineParts) && part.lineParts.length > 0;
    const body = !ids.some(id => translationMap.get(id)) ? ''
      : byLine ? replaceUnitBody(part, ids, translationMap, options, decoration)
        : translationUnitBody(part, ids, translationMap, options, decoration);
    if (!body) {
      if (!allowMissing) throw new Error(`缺少第 ${ids.join('、')} 段译文。`);
      // Untranslated replace segments stay as their original plain text, ready for 补译.
      pieces.push(sourceText);
      continue;
    }
    pieces.push(renderReplacePair(body, sourceText, { ...decoration, styleBody: null }));
  }
  return pieces.join('');
}

/**
 * A region with only its translation left in it (「只留译文」): every translatable line becomes its
 * translation, with any excluded block of the line beside it; every other line (a picture, a preserved
 * line, what lies between paragraphs) stays exactly as written. The speaker colours and carried
 * formatting stay as ordinary HTML. No invisible marker goes in: this is the text other extensions and
 * front ends read, and the bilingual text it came from is kept elsewhere.
 */
export function assembleTranslationOnly(layout, translationMap, options = {}) {
  const carry = options.carryFormatting !== false;
  const plain = value => value;
  const pieces = [];
  for (const part of layout) {
    if (part.type === 'raw' || part.type === 'blank') {
      pieces.push(part.text);
      continue;
    }
    const ids = Array.isArray(part.ids) && part.ids.length ? part.ids : [part.id];
    const texts = ids.map(id => translationMap.get(id)).filter(Boolean);
    if (!texts.length) {
      pieces.push(part.sourceText ?? part.text);
      continue;
    }
    if (part.lyric) {
      // No markers needed here: a 只留译文 floor is never re-parsed from its own displayed text, only
      // rebuilt fresh from translationMap each time (see readFloor/strippedRecords), so the pairing can
      // be plain visible text straight away.
      const trailingBr = String(part.sourceText ?? '').match(TRAILING_BR_RE);
      const bareSource = trailingBr ? part.sourceText.slice(0, trailingBr.index) : String(part.sourceText ?? '');
      pieces.push(`${bareSource} (${String(translationMap.get(ids[0]))})${trailingBr ? trailingBr[1] : ''}`);
      continue;
    }
    const decoration = segmentDecoration(options.styleFor, ids, ids.map(id => translationMap.get(id) ?? ''), part.quoteFormats, part.fragments);
    const formats = Array.isArray(part.formats) ? part.formats : [];
    const lineParts = Array.isArray(part.lineParts) && part.lineParts.length
      ? part.lineParts
      : ids.map(() => ({ semantic: true, source: '', lead: '', trail: '' }));
    let index = 0;
    const body = lineParts.map(line => {
      if (!line.semantic) return line.source;
      const id = ids[index];
      const format = carry ? formats[index] : null;
      index += 1;
      const translation = translationMap.get(id);
      if (!translation) return line.source;
      const shaped = styledBody(String(translation), decoration.styleBody, plain, id);
      const wrapped = format?.open
        ? `${paintsLine(decoration, id) ? withoutCarriedColor(format.open) : format.open}${shaped}${format.close}`
        : shaped;
      return `${line.lead ?? ''}${wrapped}${line.trail ?? ''}`;
    }).join('\n');
    pieces.push(`${decoration.stylePrefix ?? ''}${body}${decoration.styleSuffix ?? ''}`);
  }
  return pieces.join('');
}

/**
 * A replace pair's visible side read back along the paragraph it was built from (replaceUnitBody): a
 * line not for translation must be there exactly as written, a translated line is its translation with
 * the line's excluded blocks beside it, a line not translated yet has nothing left once the markers are
 * gone. Blocks and pictures may run over several lines, so the reading follows the text, not a line
 * count. Anything that does not follow (a floor written before this, an edited floor) gives null, and
 * the older line-count reading is used.
 *
 * Between two lines, the separator consumed is whatever `replaceUnitBody` actually joined them with
 * (v0.40.0: a card row's own trailing <br> is '', an ordinary line boundary is '\n') — except a boundary
 * expecting '' also tolerates one stray leading '\n', because a floor written before this fix always
 * inserted one there regardless of what actually separated the two lines. A floor written after the fix
 * has no such byte to tolerate; either way the boundary is consumed and reading continues.
 */
function readReplaceBodyByLine(body, lineParts, ids) {
  if (!Array.isArray(lineParts) || !lineParts.length) return null;
  const found = new Map();
  let rest = body;
  let index = 0;
  for (let at = 0; at < lineParts.length; at += 1) {
    const line = lineParts[at];
    if (!line.semantic) {
      if (!rest.startsWith(line.source)) return null;
      rest = rest.slice(line.source.length);
    } else {
      const id = ids[index];
      index += 1;
      // Not translated yet: its original was inside the markers, and nothing of it is left.
      if (rest && !rest.startsWith('\n')) {
        if (line.lead) {
          if (!rest.startsWith(line.lead)) return null;
          rest = rest.slice(line.lead.length);
        }
        const end = line.trail ? rest.indexOf(line.trail) : (rest.indexOf('\n') < 0 ? rest.length : rest.indexOf('\n'));
        if (end < 0) return null;
        const translation = rest.slice(0, end).trim();
        rest = rest.slice(end + (line.trail ? line.trail.length : 0));
        if (translation) found.set(id, translation);
      }
    }
    if (at < lineParts.length - 1) {
      const expected = typeof line.separator === 'string' ? line.separator : '\n';
      if (expected) {
        if (!rest.startsWith(expected)) return null;
        rest = rest.slice(expected.length);
      } else if (rest.startsWith('\n')) {
        // Backward compatibility: a floor written before this fix always inserted a '\n' here even
        // when nothing actually separated the two lines (two rows of the same <br>-joined physical
        // line) — tolerate consuming that leftover byte so an old floor still reads back correctly. A
        // floor written after the fix has none to consume.
        rest = rest.slice(1);
      }
    }
  }
  return rest === '' ? found : null;
}

// Seeds for 补译: each replace pair's source block holds that part's translation.
// A partly translated floor has fewer pairs than segments, so the pairs are matched against the
// hidden original rather than consumed by position. Getting that wrong silently shifted every
// remaining translation one segment earlier and overwrote good paragraphs on the next run.
export function extractReplaceTranslations(text, options = {}) {
  const segmented = segmentSource(stripGeneratedTranslationLines(text), { ...options, legacyWrappers: false });
  const pairs = [];
  for (const match of String(text ?? '').matchAll(REPLACE_PAIR_BOTH_RE)) {
    pairs.push({ translation: match[1].replace(AFFIX_RE, ''), original: match[2].replace(AFFIX_RE, '') });
  }
  const translations = new Map();
  let cursor = 0;
  for (const part of segmented.layout.filter(item => item.type === 'segment')) {
    const rawSourceText = String(part.sourceText ?? part.text ?? '');
    // renderReplaceLyricPair's hidden half holds only the bare source, its own trailing <br> kept
    // outside every block (see its own note) — the same way extractGeneratedTranslations already reads
    // a lyric part's rendered source by its bare text alone. 「歌词行」 predates that pair shape (v0.37.0):
    // a lyric part in a replace region written before this fix went through the ordinary path instead,
    // its hidden half holding the full source, trailing <br> included — so a lyric part accepts either
    // form here, whichever this particular floor was actually written with.
    const bareSourceText = part.lyric ? rawSourceText.replace(TRAILING_BR_RE, '') : rawSourceText;
    const pair = pairs[cursor];
    // An untranslated segment has no pair of its own; leave the queue where it is for the next one.
    if (!pair || (pair.original !== rawSourceText && pair.original !== bareSourceText)) continue;
    cursor += 1;
    const body = pair.translation;
    if (typeof body !== 'string' || !body.trim()) continue;
    const ids = Array.isArray(part.ids) && part.ids.length ? part.ids : [part.id];
    const lines = normalizeNewlines(body).split('\n');
    const lineWise = readReplaceBodyByLine(normalizeNewlines(body), part.lineParts, ids);
    if (lineWise) {
      for (const [id, translation] of lineWise) translations.set(id, translation);
    } else if (ids.length === lines.length) {
      ids.forEach((id, line) => {
        const translation = lines[line].trim();
        if (translation) translations.set(id, translation);
      });
    } else if (ids.length === 1) {
      translations.set(ids[0], normalizeNewlines(body).replace(/\n+/g, ' ').trim());
    }
  }
  return translations;
}

// The blank line that separates one pair from the next lives INSIDE the boundaries, so stripping the
// translation also removes it and the main model still sees the original line structure.
export function renderTranslationBlock(translation, options = {}) {
  const { prefix, suffix } = translationAffixes(options);
  const padding = options.padAfter === true ? '\n' : '';
  // The speaker/emotion wrapper sits inside the visible affixes, so a beautify regex written against
  // <jy-source>…</jy-translation> keeps matching whether or not colouring is on.
  const open = markedAffix(`${prefix}${options.stylePrefix ?? ''}`);
  const close = markedAffix(`${options.styleSuffix ?? ''}${suffix}`);
  const body = styledBody(String(translation ?? ''), options.styleBody);
  return `${TRANSLATION_START}${open}${body}${close}${padding}${TRANSLATION_END}`;
}

// Upgrade only source paragraphs proven by saved metadata AND an adjacent legacy translation.
// Without that provenance, legacy translations still filter, but ordinary source symbols stay.
export function upgradeLegacyBilingual(text, metadata) {
  const source = normalizeNewlines(text);
  if (!metadata || Number(metadata.schema_version) >= 4 || !source.includes(`{${INVISIBLE_MARKER}`)) return source;
  const options = {
    segmentPrefix: metadata.segment_prefix ?? '', segmentSuffix: metadata.segment_suffix ?? '',
    translationPrefix: metadata.translation_prefix ?? '', translationSuffix: metadata.translation_suffix ?? '',
    excludedTags: metadata.excluded_tags ?? [], preserveLineRules: metadata.preserve_line_rules ?? '',
    legacyWrappers: true,
  };
  let extraction;
  try { extraction = extractTaggedRegions(source, metadata.body_tags ?? DEFAULT_SETTINGS.bodyTags); }
  catch { return source; } // An edited legacy wrapper must not block generation or trigger guessed removals.
  return rebuildTaggedRegions(extraction, region => {
    let cursor = 0;
    const parts = [];
    for (const part of segmentSource(region.inner, options).layout) {
      if (part.type !== 'segment') continue;
      const original = part.sourceText ?? part.text;
      const wrapped = `${options.segmentPrefix}${original}${options.segmentSuffix}`;
      const start = region.inner.indexOf(wrapped, cursor);
      if (start < 0) continue;
      const end = start + wrapped.length;
      const generated = generatedBlockAfter(region.inner.slice(end));
      if (!generated || generated.owned) continue;
      const translation = stripTranslationAffixes(generated.text, { prefix: options.translationPrefix, suffix: options.translationSuffix });
      parts.push(region.inner.slice(cursor, start), renderSourceBlock(original, options), '\n', renderTranslationBlock(translation, {
        translationPrefix: `{${options.translationPrefix}`, translationSuffix: `${options.translationSuffix}}`,
      }));
      cursor = end + generated.full.length;
    }
    parts.push(region.inner.slice(cursor));
    return parts.join('');
  });
}

const TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9_:-]*)(?:\s[^<>]*?)?\s*(\/?)>/g;

// Whether the affixes kept inside a body are ones a body is written with and still pair up: nothing but
// the tags the runs' colours and the original's carried formatting use, each closed by its own name in
// order. Any other tag, or the speaker wrapper, belongs to an outer affix the record did not know about,
// like a prefix changed while the record was not kept up, and keeping it would wrap it again inside the
// new one.
function balancedAffixes(affixes) {
  const open = [];
  for (const affix of affixes) {
    const inside = affix.slice(AFFIX_START.length, -AFFIX_END.length);
    if (inside.replace(TAG_RE, '').trim() || SPEAKER_OPEN_RE.test(inside)) return false;
    for (const tag of inside.matchAll(TAG_RE)) {
      if (!CARRYABLE_FORMAT_TAGS.has(tag[2].toLowerCase())) return false;
      if (tag[3]) continue;
      if (!tag[1]) open.push(tag[2].toLowerCase());
      else if (open.pop() !== tag[2].toLowerCase()) return false;
    }
  }
  return open.length === 0;
}

/**
 * A translation block as it was written: the visible prefix and the speaker wrapper, the body, the
 * wrapper's close and the visible suffix. The body's own affixes — each run in its speaker's colour, the
 * rhythm, the original's carried formatting — are what a restyle has no annotations to rebuild, so
 * they are kept byte for byte. Null when the block cannot be read that way: no record of the affixes it
 * was written with, a block that no longer starts and ends with them, or a body whose tags would not
 * pair up. The restyle then keeps only the words and the wrapper, as it always did.
 */
function translationBlockBody(translation, metadata) {
  if (!(Number(metadata?.schema_version) >= 4)) return null;
  if (typeof metadata.translation_prefix !== 'string' || typeof metadata.translation_suffix !== 'string') return null;
  const { prefix, suffix } = translationAffixes({ translationPrefix: metadata.translation_prefix, translationSuffix: metadata.translation_suffix });
  const padAfter = translation.replace(AFFIX_RE, '').endsWith('\n');
  if (padAfter && !translation.endsWith('\n')) return null;
  const content = padAfter ? translation.slice(0, -1) : translation;
  const affixes = [...content.matchAll(AFFIX_RE)];
  const inside = affix => affix[0].slice(AFFIX_START.length, -AFFIX_END.length);
  let from = 0;
  let to = content.length;
  let wrapper = '';
  const first = affixes[0];
  const opening = first?.index === 0 ? inside(first) : null;
  const rest = opening !== null && opening.startsWith(prefix) ? opening.slice(prefix.length) : null;
  const wrapped = rest ? rest.match(SPEAKER_OPEN_RE) : null;
  if (rest !== null && (rest === '' ? prefix !== '' : wrapped?.index === 0 && wrapped[0] === rest)) {
    wrapper = rest;
    from = first[0].length;
  } else if (prefix) return null;
  const closing = `${wrapper ? '</span>' : ''}${suffix}`;
  if (closing) {
    const last = affixes.at(-1);
    if (!last || last.index < from || last.index + last[0].length !== content.length || inside(last) !== closing) return null;
    to = last.index;
  }
  const body = content.slice(from, to);
  if (!balancedAffixes([...body.matchAll(AFFIX_RE)].map(affix => affix[0]))) return null;
  return { body, wrapper, padAfter };
}

// Matches a move's own opening span (index.js `moveStyleFor`, above `escapeMoveAttribute`) by the
// data attribute nothing else on a translation body writes, whatever else the tag carries and in
// whatever order — a speaker's own class can sit on the same span when a move lands inside a painted
// quote.
const MOVE_SPAN_OPEN_RE = /<span\b[^>]*\sdata-jy-move-element="[^"]*"[^>]*>/g;

/**
 * A restyle keeps a translation body byte for byte (`translationBlockBody`, below) because it has no
 * annotations left to rebuild rhythm or speaker paint from — but a move's own colour is not read back
 * from an annotation either; it is recomputed here, the same `resolveMoveStyle` call `moveStyleFor`
 * (index.js) made the first time, against whatever band `options.coloring` carries now. Skipped
 * entirely while 特效字 is off or there is no band to resolve against, in which case the span is left
 * exactly as it already reads.
 *
 * Exported because a translation block's markers are not the only place a move span can live: a 「只留
 * 译文」 floor's shown text (`assembleTranslationOnly`) carries the same span directly, with no marker
 * around it for `restyleBilingual` below to find, so index.js's own restyle pass calls this straight on
 * that text too.
 */
export function recolorMoveSpans(body, options) {
  if (typeof body !== 'string' || !body.includes('data-jy-move-element="')) return body;
  const coloring = normalizeColoring(options?.coloring);
  if (!coloring.speakers || !coloring.effects || !coloring.band) return body;
  return body.replace(MOVE_SPAN_OPEN_RE, tag => {
    const element = unescapeMoveAttribute(tag.match(/\sdata-jy-move-element="([^"]*)"/)?.[1]);
    const name = unescapeMoveAttribute(tag.match(/\sdata-jy-move-name="([^"]*)"/)?.[1]);
    const tier = unescapeMoveAttribute(tag.match(/\sdata-jy-move-tier="([^"]*)"/)?.[1]);
    const resolved = resolveMoveStyle({ element, name, tier, band: coloring.band, vividness: coloring.vividness });
    if (!resolved) return tag;
    return /\sstyle="[^"]*"/.test(tag)
      ? tag.replace(/\sstyle="[^"]*"/, ` style="${resolved.css}"`)
      : tag.replace(/>$/, ` style="${resolved.css}">`);
  });
}

export function restyleBilingual(text, options = {}, metadata) {
  return upgradeLegacyBilingual(text, metadata)
    .replace(SOURCE_BLOCK_RE, (match, source, offset, whole) => {
      // A replace pair's source-block position holds the translation, dressed in its speaker colours;
      // the visible prefixes are never part of it, so a restyle leaves the pair as it is — except for a
      // move's own colour, which still has to move with the band exactly as inside an ordinary
      // translation block below, or a floor with only replace-tag regions would never restyle at all.
      const after = whole.slice(offset + match.length);
      if (after.startsWith(HIDDEN_START) || after.startsWith(`\n${HIDDEN_START}`)) {
        return `${SOURCE_START}${recolorMoveSpans(source, options)}${SOURCE_END}`;
      }
      // A lyric pair (renderLyricPair): its own trailing "(" is unmistakable, and a restyle has no
      // per-line decoration to offer it anyway — the visible prefix/suffix a plain unit would gain here
      // is exactly what the "(" already is, so the block is left exactly as it was written.
      if (source.endsWith(LYRIC_OPEN_AFFIX)) return match;
      return renderSourceBlock(source.replace(AFFIX_RE, ''), options);
    })
    .replace(TRANSLATION_BLOCK_RE, (match, translation, offset, whole) => {
      // The lyric pair's other half: its ")" (and the row's own restored <br>, bare text past it) sit
      // right after this match, unlike a plain unit's visible affixes, which live inside it.
      const after = whole.slice(offset + match.length);
      if (after.startsWith(LYRIC_CLOSE_AFFIX)) return match;
      // Only the outer affixes change: the runs painted in each speaker's colour, the rhythm and the
      // original's carried formatting inside the body are kept as they are.
      const kept = translationBlockBody(translation, metadata);
      if (kept) {
        return `${match.startsWith('\n') ? '\n' : ''}${renderTranslationBlock(recolorMoveSpans(kept.body, options), {
          ...options, padAfter: kept.padAfter, stylePrefix: kept.wrapper, styleSuffix: kept.wrapper ? '</span>' : '', styleBody: null,
        })}`;
      }
      // The 每行单独成段 separator is a newline stored after the suffix affix. Reading it back as
      // part of the translation moved the closing affix onto its own line, so it is recovered here
      // and re-applied as padding, keeping a restyle byte-identical when nothing else changed.
      const body = translation.replace(AFFIX_RE, '');
      const padAfter = body.endsWith('\n');
      const inner = padAfter ? body.slice(0, -1) : body;
      // Changing the visible affixes must not silently drop a floor's speaker colours; the wrapper
      // is carried across rather than regenerated, because a restyle has no annotations to work from.
      const stylePrefix = translation.match(SPEAKER_OPEN_RE)?.[0] ?? '';
      return `${match.startsWith('\n') ? '\n' : ''}${renderTranslationBlock(inner, {
        ...options, padAfter, stylePrefix, styleSuffix: stylePrefix ? '</span>' : '',
      })}`;
    });
}

export async function hashText(text) {
  const normalized = normalizeNewlines(text);
  try {
    if (globalThis.crypto?.subtle && typeof TextEncoder !== 'undefined') {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
      return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // Non-secure preview/test environments use the deterministic fallback below.
  }
  return hashTextSync(normalized);
}

/**
 * The same text always gives the same short fingerprint, at once. Used where the answer is needed
 * without waiting, such as telling whether a floor still holds exactly what was written to it.
 */
export function hashTextSync(text) {
  const normalized = normalizeNewlines(text);
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}-${normalized.length}`;
}

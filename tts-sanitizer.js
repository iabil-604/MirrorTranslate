// The copy of a line that goes to the voice.
//
// A preset paints its prose with spans, the colouring wraps speakers in styled tags, a line break
// arrives as <br>; all of it is presentation, none of it is speech. The floor on the page keeps every
// bit of it. What the reading gets is the words alone, with the breaks the markup implied.

const ENTITIES = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', laquo: '«', raquo: '»',
  middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', times: '×', deg: '°', zwj: '', zwnj: '', shy: '',
});
const COMMENT_RE = /<!--[\s\S]*?-->/g;
// Whole elements whose content is never read: code, styles, hidden templates.
const DROP_RE = /<(script|style|template|noscript)\b[^<>]*>[\s\S]*?<\/\1\s*>/gi;
// Elements that end a line where they stand, so text on either side does not run together.
const BREAK_RE = /<(?:br|hr)\b[^<>]*\/?>|<\/(?:p|div|li|ul|ol|h[1-6]|blockquote|tr|section|article|header|footer|pre|table|dd|dt)\s*>|<(?:p|div|li|h[1-6]|blockquote|tr|pre|dd|dt)\b[^<>]*>/gi;
// The opening tag of anything hidden from the voice: struck through, or an element whose own style
// paints its background the same as its text — invisible ink on the page, a redaction. Matched
// generically (any tag name) so dropHiddenMarkup can count nested same-name tags itself rather than
// stopping at the first closer of that name, which a lazy [\s\S]*? would do.
const HIDDEN_OPEN_RE = /<([a-zA-Z][a-zA-Z0-9:-]*)\b([^<>]*)>/g;
const STRIKE_TAGS = new Set(['s', 'del', 'strike']);
// The lookahead in the old single-pass version read only this tag's own attributes, never past the '>'
// that closes it; kept as a plain match here since dropHiddenMarkup no longer needs a lookahead to stay
// inside one tag's attributes.
const REDACTED_STYLE_RE = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const REDACTED_BACKGROUND_RE = /background(?:-color)?\s*:\s*currentcolor/i;
// Block containers whose own open and close each normally stand for a line break (BREAK_RE below); a
// redaction or strike-through removes both tag and content in one piece, so the break it stood for is
// put back in its place rather than letting the words on either side run together.
const BLOCK_HIDDEN_TAGS = new Set(['p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'tr', 'section', 'article', 'header', 'footer', 'pre', 'table', 'dd', 'dt']);
function isHiddenOpenTag(tag, attrs) {
  const lower = tag.toLowerCase();
  if (STRIKE_TAGS.has(lower)) return true;
  const style = attrs.match(REDACTED_STYLE_RE);
  return style ? REDACTED_BACKGROUND_RE.test(style[1] ?? style[2] ?? '') : false;
}
// Any other tag, attributes and all.
const TAG_RE = /<\/?[a-zA-Z][^<>]*>/g;
const INVISIBLE_RE = /[\u200b-\u200f\u2060-\u2064\ufeff]/g;
// A tone drawn as an arrow, not a word: \u2197 rising, \u2198 falling, \u2934 pitched up, \u2935 pitched down, \u3030 held flat.
const TONE_ARROW_RE = /[\u2197\u2198\u2934\u2935\u3030]/g;
// Fraktur, bold, script, double-struck and the other Mathematical Alphanumeric Symbols read fine on the
// page but are not letters a voice knows; NFKC's own compatibility decomposition is exactly the fold to
// plain ones. A handful of script/black-letter/double-struck capitals (C, H, I, R, Z among them) were
// never assigned a slot in that block and live in the Letterlike Symbols block instead, covered by the
// ranges below; PLANCK CONSTANT OVER TWO PI sits among them too but folds to a letter with a stroke
// through it, not a plain one, so it is left out on purpose.
const MATH_ALPHANUMERIC_RE = /[\u{1D400}-\u{1D7FF}\u{2102}\u{210A}-\u{210E}\u{2110}-\u{2113}\u{2115}\u{2119}-\u{211D}\u{2124}\u{2128}\u{212C}\u{212D}\u{212F}-\u{2131}\u{2133}\u{2134}]/gu;
// A Markdown picture, and the empty link a linked picture leaves behind: seen, never read aloud. The
// same patterns as core's, kept here because this module imports nothing.
const MARKDOWN_IMAGE_RE = /(?<!\\)!\[[^\]\n]*\][ \t]*\((?:[^()\n]|\([^()\n]*\))*\)/g;
const EMPTY_MARKDOWN_LINK_RE = /(?<!\\)\[\s*\][ \t]*\((?:[^()\n]|\([^()\n]*\))*\)/g;

export function decodeHtmlEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    const key = body.toLowerCase();
    return Object.hasOwn(ENTITIES, key) ? ENTITIES[key] : whole;
  });
}

/** Whether a line carries markup at all; a line that does not is handed back untouched. */
export function looksLikeMarkup(text) {
  return /<[a-zA-Z/!]/.test(String(text ?? '')) || /&(?:#\d+|#x[0-9a-f]+|[a-z]+\d*);/i.test(String(text ?? ''));
}

/**
 * Drops every element hidden from the voice — struck through, or painted the same colour as its own
 * background — tag and content together. Closed by counting nested same-name tags rather than a lazy
 * match to the first closer of that name, so a redaction with an ordinary span (or another redaction)
 * inside it does not leave the words after that inner closer behind. A block element's own open and
 * close normally each stand for a line break (BREAK_RE); removed whole, it leaves one line break in its
 * place instead, so the words on either side of it do not run together. An opening tag never closed is
 * left exactly as it was — there is nothing here to safely remove.
 *
 * core.js reuses this directly: it is the same judgement wherever a line is prepared to be heard,
 * whether or not it also carries a `<say>` speaker mark.
 */
export function dropHiddenMarkup(text) {
  const source = String(text ?? '');
  let result = '';
  let cursor = 0;
  HIDDEN_OPEN_RE.lastIndex = 0;
  let match;
  while ((match = HIDDEN_OPEN_RE.exec(source))) {
    const [whole, tag, attrs] = match;
    if (whole.endsWith('/>') || !isHiddenOpenTag(tag, attrs)) continue;
    const closeRe = new RegExp(`<(/?)${tag}\\b[^<>]*?(/?)>`, 'gi');
    closeRe.lastIndex = HIDDEN_OPEN_RE.lastIndex;
    let depth = 1;
    let end = null;
    let scan;
    while ((scan = closeRe.exec(source))) {
      if (!scan[1] && scan[2] === '/') continue; // a nested self-closer of the same name
      depth += scan[1] ? -1 : 1;
      if (depth === 0) { end = scan.index + scan[0].length; break; }
    }
    if (end === null) continue;
    result += source.slice(cursor, match.index);
    if (BLOCK_HIDDEN_TAGS.has(tag.toLowerCase())) result += '\n';
    cursor = end;
    HIDDEN_OPEN_RE.lastIndex = end;
  }
  return result + source.slice(cursor);
}

/**
 * The words of a line, without its markup: comments and scripts gone whole, line-level elements turned
 * into line breaks, every other tag removed with its attributes, entities decoded, spaces tidied. Blank
 * lines are kept to one, so a paragraph split by <br><br> stays a split.
 */
export function sanitizeForTts(text) {
  let value = String(text ?? '').replace(INVISIBLE_RE, '')
    .replace(MARKDOWN_IMAGE_RE, '')
    .replace(EMPTY_MARKDOWN_LINK_RE, '');
  if (looksLikeMarkup(value)) {
    value = value
      .replace(COMMENT_RE, '')
      .replace(DROP_RE, '');
    // Struck through or painted invisible on itself: gone with the words inside, before a block edge in
    // there could turn into a break and leave a stray blank line behind.
    value = dropHiddenMarkup(value)
      .replace(BREAK_RE, '\n')
      .replace(TAG_RE, '');
    value = decodeHtmlEntities(value);
  }
  // A tone written as an arrow, and a letter from the Mathematical Alphanumeric block: neither is
  // markup, so both apply whether or not the line carries any.
  value = value.replace(TONE_ARROW_RE, '').replace(MATH_ALPHANUMERIC_RE, char => char.normalize('NFKC'));
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t　]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
}

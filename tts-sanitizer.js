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
// Any other tag, attributes and all.
const TAG_RE = /<\/?[a-zA-Z][^<>]*>/g;
const INVISIBLE_RE = /[\u200b-\u200f\u2060-\u2064\ufeff]/g;
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
      .replace(DROP_RE, '')
      .replace(BREAK_RE, '\n')
      .replace(TAG_RE, '');
    value = decodeHtmlEntities(value);
  }
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t　]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
}

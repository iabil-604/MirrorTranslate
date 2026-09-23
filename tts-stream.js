// Reading a reply while it is still being written.
//
// A model streams its reply and the text grows at its end. A stretch of it is safe to read once nothing
// written later can change how it sounds: it ends at the end of a sentence outside every quotation and
// speaker mark, and something already follows that end (the next character decides whether 「。」 was
// the end or 「？」 comes after it). A finished line is safe whole. The first stretch of a reply may stop
// at a comma instead, so the first sound comes early; after that stretches are left to grow a little, so
// Fish is not asked for three words at a time.
//
// Pure functions only: index.js feeds them the reply as it stands and turns what they hand back into
// requests and sound.

import { DEFAULT_QUOTE_PAIRS, SPEECH_CLOSE, SPEECH_OPEN, SPEECH_SEP, parsePairList } from './core.js?v=0.35.0-beta.3';

// The characters a sentence ends on, and the ones the first stretch may also stop at.
const SENTENCE_END = new Set(['。', '！', '？', '!', '?', '…', '．', '.']);
const PAUSE = new Set(['，', '、', '；', '：', ',', ';', ':']);

/**
 * Where the next stretch of one line may end, reading from `from`: an index just past the stretch, or
 * -1 when nothing more is safe yet. `final` means the line will not grow any more.
 *
 * `marks` are the line's speaker marks (as core's speechMarkedLine leaves them): a mark that encloses
 * its dialogue is a bracket like a quotation, one that does not (self-closing) is not.
 */
export function nextStreamCut(text, from, { quotePairs = DEFAULT_QUOTE_PAIRS, marks = [], first = false, firstMin = 6, minChars = 14, final = false } = {}) {
  const line = String(text ?? '');
  const pairs = parsePairList(quotePairs);
  const depth = new Map();
  let marksOpen = 0;
  let candidate = -1;
  const quoted = () => [...depth.values()].some(value => value > 0) || marksOpen > 0;
  for (let index = from; index < line.length; index += 1) {
    const character = line[index];
    if (character === SPEECH_OPEN) {
      const stop = line.indexOf(SPEECH_SEP, index + 1);
      const mark = stop > index ? marks[Number(line.slice(index + 1, stop))] : null;
      if (mark && !mark.open) marksOpen += 1;
      if (stop > index) index = stop;
      continue;
    }
    if (character === SPEECH_CLOSE) {
      marksOpen = Math.max(0, marksOpen - 1);
      continue;
    }
    const pair = pairs.find(item => line.startsWith(item.open, index) || line.startsWith(item.close, index));
    if (pair) {
      const key = `${pair.open}${pair.close}`;
      const current = depth.get(key) ?? 0;
      if (pair.open === pair.close) depth.set(key, current > 0 ? 0 : 1);
      else if (line.startsWith(pair.open, index)) depth.set(key, current + 1);
      else depth.set(key, Math.max(0, current - 1));
      index += (line.startsWith(pair.open, index) ? pair.open.length : pair.close.length) - 1;
      continue;
    }
    if (quoted()) continue;
    const length = index + 1 - from;
    const ends = SENTENCE_END.has(character);
    const pauses = first && PAUSE.has(character);
    if (!ends && !pauses) continue;
    // A run of end marks (「……」「？！」) ends where the run does, and only once something follows it.
    let stop = index + 1;
    while (stop < line.length && (SENTENCE_END.has(line[stop]) || (pauses && PAUSE.has(line[stop])))) stop += 1;
    if (stop >= line.length && !final) break;
    index = stop - 1;
    if (length >= (first ? firstMin : minChars)) {
      candidate = stop;
      break;
    }
  }
  if (candidate >= 0) return candidate;
  // A finished line is read to its end, however short or however its quotations stand.
  return final && line.slice(from).trim() ? line.length : -1;
}

/**
 * The stretches of the reply that became safe since last time. `lines` are the reply's lines as they
 * stand ({ lineId, text, marks }); `state` remembers how far each line has been handed out and is
 * updated in place. Every line but the last is finished; with `final`, so is the last.
 */
export function takeStreamPieces(lines, state, { final = false, quotePairs = DEFAULT_QUOTE_PAIRS, firstMin = 6, minChars = 14 } = {}) {
  const pieces = [];
  const list = Array.isArray(lines) ? lines : [];
  state.done ??= new Map();
  state.count ??= 0;
  list.forEach((line, index) => {
    const text = String(line?.text ?? '');
    let offset = Math.min(state.done.get(line.lineId) ?? 0, text.length);
    const finished = final || index < list.length - 1;
    for (;;) {
      const end = nextStreamCut(text, offset, {
        quotePairs, marks: line.marks ?? [], first: state.count === 0, firstMin, minChars, final: finished,
      });
      if (end < 0 || end <= offset) break;
      const piece = text.slice(offset, end);
      if (piece.trim()) {
        pieces.push({ lineId: line.lineId, start: offset, end, text: piece, marks: line.marks ?? [] });
        state.count += 1;
      }
      offset = end;
    }
    state.done.set(line.lineId, offset);
  });
  return pieces;
}

/**
 * The reply as far as it can be read now: a body tag the model opened and has not closed yet is closed,
 * so what is inside it counts; a tag whose content is never read (a status panel) that has not closed
 * yet is cut off where it opens, so its text is not read as story; half a tag at the very end goes.
 */
export function readableStreamText(raw, { bodyTags = [], excludedTags = [] } = {}) {
  let text = String(raw ?? '');
  // Half a tag still being written: 「<sta」.
  const lastOpen = text.lastIndexOf('<');
  if (lastOpen >= 0 && text.indexOf('>', lastOpen) < 0) text = text.slice(0, lastOpen);
  const escape = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = list => (Array.isArray(list) ? list : String(list ?? '').split(/[\s,，]+/)).map(name => String(name).trim()).filter(Boolean);
  for (const name of names(excludedTags)) {
    const opens = [...text.matchAll(new RegExp(`<${escape(name)}(?=[\\s>/])[^>]*>`, 'gi'))];
    const last = opens.at(-1);
    if (!last) continue;
    const closed = new RegExp(`</${escape(name)}\\s*>`, 'i').test(text.slice(last.index));
    if (!closed) text = text.slice(0, last.index);
  }
  for (const name of names(bodyTags)) {
    const opened = (text.match(new RegExp(`<${escape(name)}(?=[\\s>])[^>]*>`, 'gi')) ?? []).length;
    const closed = (text.match(new RegExp(`</${escape(name)}\\s*>`, 'gi')) ?? []).length;
    for (let missing = opened - closed; missing > 0; missing -= 1) text += `</${name}>`;
  }
  return text;
}

/** Text handed over in chunks or as the whole so far: the whole so far either way. */
export function mergeStreamText(previous, incoming) {
  const before = String(previous ?? '');
  const next = String(incoming ?? '');
  return next.startsWith(before) ? next : before + next;
}

import { hashTextSync } from './core.js?v=0.50.0';

// ---------------------------------------------------------------------------------------------
// The public interface's reading of a floor (window.__JINGYI__.reading), in the shape agreed with the
// 东京都2051 card (schema 1): the floor's original — what the main model wrote and other extensions added
// after it, without anything 镜译 wrote — each line 镜译 translates, placed in that original by UTF-16
// offsets (start inclusive, end exclusive), the translation written for the line, the speaker and mood
// the translation marked, and where the floor stands.
//
// Pure: index.js reads the floor (readMessageSnapshot) and the runtime (a run in flight, the last failure)
// and hands them over; everything here is arithmetic on what it is given. Reading never translates, asks a
// model, speaks, saves or changes a setting.
// ---------------------------------------------------------------------------------------------

export const READING_SCHEMA = 1;
export const READING_API_VERSION = 1;

/**
 * Where a floor stands:
 * - absent: nothing of it translated (or nothing in it for 镜译 to translate);
 * - processing: a translation of this floor's alternative is running now;
 * - partial: some lines translated, the others not yet;
 * - ready: every line translated;
 * - failed: the last translation of this very text failed;
 * - stale: the translation on the floor was written for text the floor no longer holds.
 */
export const READING_STATES = Object.freeze(['absent', 'processing', 'partial', 'ready', 'failed', 'stale']);

/** The state of a floor, from what its snapshot and the runtime say. A run in flight says it first. */
export function readingState({ total = 0, done = 0, complete = false, processing = false, outdated = false, failed = false } = {}) {
  if (processing) return 'processing';
  if (total > 0 && complete) return 'ready';
  if (outdated) return 'stale';
  if (failed) return 'failed';
  return total > 0 && done > 0 ? 'partial' : 'absent';
}

/**
 * Where each translated line stands in the original, by segment id. `regions` are the floor's regions as
 * readMessageSnapshot segmented them — each with its `contentStart`, `closeStart` and the `layout`
 * segmentSource built — and `texts` the segments' own words by id. A line is found in turn after the one
 * before it; its words are placed exactly where they are written in their line, or, where they are not
 * written there as they are (markup inside the words, which the translator never saw), the whole line
 * without the blanks around it stands for them. A line that cannot be found at all is left out.
 */
export function readingPositions(source, regions, texts = new Map()) {
  const text = String(source ?? '');
  const placed = new Map();
  for (const region of Array.isArray(regions) ? regions : []) {
    let cursor = Math.max(0, Number(region?.contentStart) || 0);
    const end = Number.isInteger(region?.closeStart) ? Math.min(region.closeStart, text.length) : text.length;
    for (const part of Array.isArray(region?.layout) ? region.layout : []) {
      if (part?.type !== 'segment') continue;
      const ids = Array.isArray(part.ids) && part.ids.length ? part.ids : [part.id];
      const lines = Array.isArray(part.lineParts) && part.lineParts.length
        ? part.lineParts
        : [{ semantic: true, source: part.sourceText }];
      let next = 0;
      for (const line of lines) {
        const lineText = String(line?.source ?? '');
        const lineAt = lineText ? text.indexOf(lineText, cursor) : -1;
        const found = lineAt >= 0 && lineAt + lineText.length <= end;
        if (line?.semantic) {
          const id = ids[next];
          next += 1;
          if (id !== undefined) {
            const words = String(texts.get(id) ?? '');
            let span = null;
            if (found) {
              const at = words ? text.indexOf(words, lineAt) : -1;
              if (at >= 0 && at + words.length <= lineAt + lineText.length) {
                span = [at, at + words.length];
              } else {
                const lead = lineText.length - lineText.trimStart().length;
                const trimmed = lineText.trimEnd().length;
                if (trimmed > lead) span = [lineAt + lead, lineAt + trimmed];
              }
            } else if (words) {
              const at = text.indexOf(words, cursor);
              if (at >= 0 && at + words.length <= end) {
                span = [at, at + words.length];
                cursor = span[1];
              }
            }
            if (span) placed.set(id, { start: span[0], end: span[1], text: text.slice(span[0], span[1]) });
          }
        }
        if (found) cursor = lineAt + lineText.length;
      }
    }
  }
  return placed;
}

/**
 * One floor's reading, as reading.get hands it out. `segments` are the floor's segments in order (id and
 * words); `positions` from readingPositions; `translations` and `annotations` by segment id, as the
 * floor's record holds them; `language` the language the translations are in. A line with no translation
 * reads `reading: null`, never another alternative's. The original's revision changes only with the
 * original itself; the reading's revision only with the translations and their marks ('none' while there
 * are none).
 */
export function readingSnapshot({
  chatId = '', messageId = null, swipeId = null, source = '', segments = [], positions = new Map(),
  translations = new Map(), annotations = new Map(), language = '', state = 'absent', error = null,
} = {}) {
  const text = String(source ?? '');
  const list = [];
  for (const segment of Array.isArray(segments) ? segments : []) {
    const where = positions.get(segment?.id);
    if (!where) continue;
    const translated = translations.get(segment.id);
    const mark = annotations.get(segment.id) ?? {};
    list.push({
      id: String(segment.id),
      source: { start: where.start, end: where.end, text: where.text },
      reading: typeof translated === 'string' && translated ? { text: translated, language: String(language ?? '') } : null,
      annotations: {
        speaker: String(mark.speaker ?? ''),
        ...(mark.emotion ? { emotion: String(mark.emotion) } : {}),
      },
    });
  }
  const read = list.filter(item => item.reading);
  return {
    schema: READING_SCHEMA,
    owner: { chatId: String(chatId ?? ''), messageId, swipeId },
    sourceRevision: hashTextSync(text),
    readingRevision: read.length
      ? hashTextSync(JSON.stringify(list.map(item => [item.id, item.reading?.text ?? null, item.annotations])))
      : 'none',
    state: READING_STATES.includes(state) ? state : 'absent',
    sourceMessage: text,
    segments: list,
    error: state === 'failed' ? String(error ?? '') : null,
  };
}

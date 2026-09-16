// The floating window's arithmetic, kept apart from the DOM so it can be tested: what the rows of a
// floor look like, how long a wait still has to go, which log lines a filter keeps.

import { MESSAGE_META_KEY } from './core.js';

export const LOG_FILTERS = Object.freeze(['floor', 'all', 'translation', 'tts', 'errors']);

/**
 * One row per paragraph of a floor: the source, the translation if there is one, and the state the
 * paragraph is in. `running` says a translation of this floor is in flight; `activeIds` names the
 * paragraphs that run is asking for (when known), the rest of the missing ones are simply missing.
 */
export function floorRows(snapshot, { annotations = null, running = false, activeIds = null } = {}) {
  const segments = Array.isArray(snapshot?.segments) ? snapshot.segments : [];
  const translations = snapshot?.existingTranslations instanceof Map ? snapshot.existingTranslations : new Map();
  const marks = annotations instanceof Map
    ? annotations
    : (snapshot?.existingAnnotations instanceof Map ? snapshot.existingAnnotations : new Map());
  const anyTranslation = [...translations.values()].some(value => typeof value === 'string' && value.trim());
  return segments.map(segment => {
    const translation = translations.get(segment.id);
    const has = typeof translation === 'string' && translation.trim().length > 0;
    const mark = marks.get(segment.id) ?? null;
    let state = 'pending';
    if (has) state = 'done';
    else if (running && (!activeIds || activeIds.has(segment.id))) state = 'running';
    else if (anyTranslation) state = 'missing';
    return {
      id: segment.id,
      source: String(segment.text ?? ''),
      translation: has ? translation : '',
      state,
      speaker: mark?.speaker ? String(mark.speaker) : '',
      emotion: mark?.emotion ? String(mark.emotion) : '',
    };
  });
}

/** A floor's one-line state, from its rows: 翻译中 / 已译 / 缺 N 段 / 未译. */
export function floorState(rows, { running = false } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length;
  const done = list.filter(row => row.state === 'done').length;
  if (!total) return { key: 'empty', label: '没有正文', done, total, missing: 0 };
  if (running) return { key: 'running', label: '翻译中', done, total, missing: total - done };
  if (done === total) return { key: 'done', label: '已译', done, total, missing: 0 };
  if (done === 0) return { key: 'pending', label: '未译', done, total, missing: total };
  return { key: 'missing', label: `缺 ${total - done} 段`, done, total, missing: total - done };
}

/**
 * Seconds a run still has to go. The batches already finished set the pace; earlier runs stand in
 * while none has finished yet. Null when there is nothing to go on. Batches in flight have already
 * spent part of their time, and `lanes` of them run side by side.
 */
export function estimateRemaining({ done = 0, total = 0, active = 0, lanes = 1, durations = [], elapsedActive = 0, history = [] } = {}) {
  const sample = (Array.isArray(durations) && durations.length ? durations : history).filter(value => Number.isFinite(value) && value > 0);
  const remaining = Math.max(0, Number(total) - Number(done));
  if (!sample.length || !remaining) return null;
  const average = sample.reduce((sum, value) => sum + value, 0) / sample.length;
  const width = Math.max(1, Number(lanes) || 1);
  const inFlight = Math.min(Math.max(0, Number(active) || 0), remaining);
  const queued = remaining - inFlight;
  const spent = Math.max(0, Number(elapsedActive) || 0);
  const current = inFlight ? Math.max(0, average - spent) : 0;
  const seconds = current + Math.ceil(queued / width) * average;
  return { seconds: Math.round(seconds), average, slow: inFlight > 0 && spent > average * 2 };
}

/** The words for an estimate: 还要约 N 秒 / 分钟, 就快好了, or 比平时慢 when a batch has overrun. */
export function describeRemaining(estimate) {
  if (!estimate) return '';
  if (estimate.slow) return '比平时慢';
  const seconds = Math.max(0, Math.round(estimate.seconds));
  if (seconds <= 1) return '就快好了';
  if (seconds >= 90) return `还要约 ${Math.round(seconds / 60)} 分钟`;
  return `还要约 ${seconds} 秒`;
}

/** The lines a log filter keeps, newest first. */
export function filterLogs(entries, { filter = 'all', floor = null } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const kept = list.filter(entry => {
    const scope = String(entry?.scope ?? '');
    if (filter === 'floor') return Number.isInteger(floor) && entry?.floor === floor;
    if (filter === 'translation') return /^(translation|channel)/.test(scope);
    if (filter === 'tts') return scope.startsWith('tts');
    if (filter === 'errors') return entry?.level === 'error';
    return true;
  });
  return kept.reverse();
}

/** One log entry as the list shows it: a clock, an area word, the floor, the sentence. */
export function describeLog(entry) {
  const scope = String(entry?.scope ?? '');
  const area = scope.startsWith('tts') ? '朗读'
    : /^(translation|channel)/.test(scope) ? '翻译'
      : scope.startsWith('host') ? '宿主'
        : scope.startsWith('update') ? '更新'
          : '其他';
  const stamp = new Date(entry?.time ?? NaN);
  const pad = value => String(value).padStart(2, '0');
  const time = Number.isNaN(stamp.getTime()) ? '' : `${pad(stamp.getHours())}:${pad(stamp.getMinutes())}:${pad(stamp.getSeconds())}`;
  return {
    time,
    area,
    floor: Number.isInteger(entry?.floor) ? entry.floor : null,
    level: ['info', 'warn', 'error'].includes(entry?.level) ? entry.level : 'info',
    message: String(entry?.message ?? ''),
  };
}

/**
 * The assistant floors of a chat that have no finished translation on them, newest first. Read off
 * the stored metadata only, so a long chat costs nothing to scan.
 */
export function untranslatedFloors(chat, { limit = 20 } = {}) {
  const list = Array.isArray(chat) ? chat : [];
  const found = [];
  for (let index = list.length - 1; index >= 0 && found.length < limit; index -= 1) {
    const message = list[index];
    if (!message || message.is_user || message.is_system || typeof message.mes !== 'string') continue;
    const meta = message.extra?.[MESSAGE_META_KEY];
    if (meta && meta.complete !== false && Number(meta.swipe_id ?? 0) === Number(message.swipe_id ?? 0)) continue;
    found.push(index);
  }
  return found;
}

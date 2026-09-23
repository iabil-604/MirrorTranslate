const STORAGE_KEY = 'jingyi-translator.diagnostics.v1';
const MAX_ENTRIES = 100;
const MAX_STORAGE_CHARACTERS = 1_800_000;
const SECRET_KEY_RE = /(?:api.?key|secret|password|authorization|proxy_password|token)/i;
// "token" also names ordinary usage counters. Redacting those hid the request-size numbers the log
// page renders, so the statistics keys are named explicitly and everything else stays redacted.
const TOKEN_STAT_KEY_RE = /^(?:requestTokens|promptTokens|completionTokens|totalTokens|inputTokens|outputTokens|maxTokens|max_tokens|prompt_tokens|completion_tokens|total_tokens|tokenSaving|estimatedTokens)$/;

function isSecretKey(key) {
  return !TOKEN_STAT_KEY_RE.test(String(key ?? '')) && SECRET_KEY_RE.test(String(key ?? ''));
}

// The log as it stands. Storage is read once, the first time, and written back in one go a moment
// after the last entry: reading, re-serialising and rewriting the whole log for every line was the
// cost of logging, and a busy floor logs dozens of lines.
// Shared through globalThis: a second copy of this module (one imported under another URL) must see
// the same log, or a line written through one copy would be missing from the other until it is saved.
const state = (globalThis[Symbol.for('jingyi-translator.diagnostics')] ??= {
  entries: [], pending: [], fallback: false, mirrored: null, timer: null, target: null,
});
const PERSIST_DELAY = 800;

function storageOrNull(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function cleanString(value) {
  return String(value ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [已隐藏]')
    .replace(/([?&](?:key|token|api_key|access_token)=)[^&#\s]+/gi, '$1[已隐藏]')
    // Provider keys such as Fish's sk-fish-… can surface inside an error message quoted back verbatim.
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[密钥已隐藏]')
    .slice(0, 2000);
}

function cleanFullString(value) {
  return String(value ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [已隐藏]')
    .replace(/([?&](?:key|token|api_key|access_token)=)[^&#\s]+/gi, '$1[已隐藏]')
    .replace(/((?:api[_-]?key|authorization|token|secret|password)\s*["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, '$1[已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[密钥已隐藏]')
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, '[密钥已隐藏]')
    // The whole of a long request is not worth the rest of the log: the store keeps a fixed number of
    // characters, and one untrimmed body used to evict everything a reader was looking for.
    .slice(0, 40000);
}

export function sanitizeDiagnostic(value, key = '') {
  if (isSecretKey(key)) return '[已隐藏]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return cleanString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 40).map(item => sanitizeDiagnostic(item));
  if (typeof value === 'object') {
    const result = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 40)) {
      result[childKey] = sanitizeDiagnostic(childValue, childKey);
    }
    return result;
  }
  return cleanString(value);
}

export function sanitizeFullResponse(value, key = '', seen = new WeakSet()) {
  if (isSecretKey(key)) return '[已隐藏]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return cleanFullString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'object') {
    if (seen.has(value)) return '[循环引用]';
    seen.add(value);
    let result;
    if (Array.isArray(value)) {
      result = value.map(item => sanitizeFullResponse(item, '', seen));
    } else {
      result = {};
      for (const [childKey, childValue] of Object.entries(value)) {
        result[childKey] = sanitizeFullResponse(childValue, childKey, seen);
      }
    }
    seen.delete(value);
    return result;
  }
  return cleanFullString(value);
}

function fitEntriesForStorage(entries) {
  const fitted = entries.slice(-MAX_ENTRIES);
  // Each entry is measured once; the oldest go until the rest fit.
  const sizes = fitted.map(entry => JSON.stringify(entry).length + 1);
  let total = sizes.reduce((sum, size) => sum + size, 1);
  let start = 0;
  while (total > MAX_STORAGE_CHARACTERS && fitted.length - start > 1) {
    total -= sizes[start];
    start += 1;
  }
  const kept = fitted.slice(start);
  return { entries: kept, serialized: JSON.stringify(kept) };
}

/** What this storage holds right now. */
function storedEntries(target) {
  try {
    const parsed = JSON.parse(target.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The entries in memory, loaded from this storage the first time it is asked about. */
function entriesFor(target) {
  if (!target || state.fallback) return state.entries;
  if (state.mirrored !== target) {
    // Lines waiting for another storage go there first: they are not this one's.
    if (state.pending.length && state.target && state.target !== target) flushDiagnostics();
    // Lines this tab has not saved yet stay on top of what is stored.
    state.entries = [...storedEntries(target), ...state.pending].slice(-MAX_ENTRIES);
    state.mirrored = target;
  }
  return state.entries;
}

function persistNow() {
  const target = state.target;
  state.target = null;
  if (!target || !state.pending.length) return;
  // Another tab may have written since this one last read: its lines stay, and this tab's go after them.
  const fitted = fitEntriesForStorage([...storedEntries(target), ...state.pending]);
  try {
    target.setItem(STORAGE_KEY, fitted.serialized);
    state.entries = fitted.entries;
    state.mirrored = target;
  } catch {
    // Keep the in-memory copy when browser storage is unavailable or full.
    state.fallback = true;
  }
  state.pending = [];
}

function schedulePersist(target) {
  state.target = target;
  if (state.timer !== null) return;
  state.timer = globalThis.setTimeout(() => {
    state.timer = null;
    // Written when the page has a moment, not in the middle of whatever logged the line.
    if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(persistNow, { timeout: 2000 });
    else persistNow();
  }, PERSIST_DELAY);
  state.timer?.unref?.();
}

/** Writes what is waiting now: the page is going away, or someone is about to read storage directly. */
export function flushDiagnostics() {
  if (state.timer !== null) {
    globalThis.clearTimeout(state.timer);
    state.timer = null;
  }
  persistNow();
}

if (typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('pagehide', flushDiagnostics);
  // Another tab wrote or cleared the log: read it again next time.
  globalThis.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY || event.key === null) state.mirrored = null;
  });
}

export function readDiagnostics(storage) {
  return [...entriesFor(storageOrNull(storage))];
}

export function addDiagnostic(entry, storage) {
  const target = storageOrNull(storage);
  const normalized = {
    time: new Date().toISOString(),
    level: ['info', 'warn', 'error'].includes(entry?.level) ? entry.level : 'info',
    scope: cleanString(entry?.scope || 'general'),
    message: cleanString(entry?.message || ''),
    details: sanitizeDiagnostic(entry?.details || {}),
  };
  if (entry && Object.hasOwn(entry, 'fullResponse')) {
    normalized.fullResponse = sanitizeFullResponse(entry.fullResponse);
  }
  // The request sits in the same tier as the response: never in the safe summary, because it carries
  // the prompt, the glossary and the story text.
  if (entry && Object.hasOwn(entry, 'fullRequest')) {
    normalized.fullRequest = sanitizeFullResponse(entry.fullRequest);
  }
  // A reasoning model can spend more characters thinking than translating. It is not the answer and
  // it is not part of the request, so it gets its own tier rather than being folded into either.
  if (entry && typeof entry.reasoning === 'string' && entry.reasoning.trim()) {
    normalized.reasoning = sanitizeFullResponse(entry.reasoning);
  }
  if (Number.isInteger(entry?.floor)) normalized.floor = entry.floor;
  state.entries = [...entriesFor(target), normalized].slice(-MAX_ENTRIES);
  if (target && !state.fallback) {
    state.pending.push(normalized);
    schedulePersist(target);
  }
  return normalized;
}

export function clearDiagnostics(storage) {
  if (state.timer !== null) {
    globalThis.clearTimeout(state.timer);
    state.timer = null;
  }
  state.target = null;
  state.pending = [];
  state.entries = [];
  state.fallback = false;
  state.mirrored = null;
  try {
    storageOrNull(storage)?.removeItem(STORAGE_KEY);
  } catch {
    // Clearing the in-memory copy is still useful in restricted environments.
  }
}

function formatReport(entries, metadata = {}, includeFullResponses = false) {
  const header = {
    generatedAt: new Date().toISOString(),
    reportType: includeFullResponses ? 'full-responses' : 'safe-summary',
    ...sanitizeDiagnostic(metadata),
  };
  const lines = [
    '镜译诊断报告',
    JSON.stringify(header, null, 2),
    '',
  ];
  for (const entry of Array.isArray(entries) ? entries : []) {
    lines.push(`[${entry.time}] ${String(entry.level).toUpperCase()} / ${entry.scope}${Number.isInteger(entry.floor) ? ` / 第 ${entry.floor} 楼` : ''}`);
    lines.push(entry.message || '（无说明）');
    if (entry.details && Object.keys(entry.details).length) lines.push(JSON.stringify(entry.details, null, 2));
    if (includeFullResponses && Object.hasOwn(entry, 'fullRequest')) {
      lines.push('--- 发送给副 API 的完整请求（凭据特征已隐藏）---');
      lines.push(typeof entry.fullRequest === 'string'
        ? entry.fullRequest
        : JSON.stringify(entry.fullRequest, null, 2));
    }
    if (includeFullResponses && typeof entry.reasoning === 'string' && entry.reasoning) {
      lines.push(`--- 副 API 的思考过程（${entry.reasoning.length} 字）---`);
      lines.push(entry.reasoning);
    }
    if (includeFullResponses && Object.hasOwn(entry, 'fullResponse')) {
      lines.push('--- 完整副 API 返回（凭据特征已隐藏）---');
      lines.push(typeof entry.fullResponse === 'string'
        ? entry.fullResponse
        : JSON.stringify(entry.fullResponse, null, 2));
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

export function formatDiagnosticReport(entries, metadata = {}) {
  return formatReport(entries, metadata, false);
}

export function formatFullDiagnosticReport(entries, metadata = {}) {
  return formatReport(entries, metadata, true);
}

export function filterDiagnosticsByFloor(entries, floor) {
  const target = Number(floor);
  if (!Number.isInteger(target)) return [];
  return (Array.isArray(entries) ? entries : []).filter(entry => entry?.floor === target);
}

export function listDiagnosticFloors(entries) {
  const floors = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (Number.isInteger(entry?.floor)) floors.add(entry.floor);
  }
  return [...floors].sort((left, right) => left - right);
}

export const __diagnosticsTesting = Object.freeze({ STORAGE_KEY, MAX_ENTRIES, MAX_STORAGE_CHARACTERS });

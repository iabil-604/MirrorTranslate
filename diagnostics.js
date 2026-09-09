const STORAGE_KEY = 'jingyi-translator.diagnostics.v1';
const MAX_ENTRIES = 100;
const MAX_STORAGE_CHARACTERS = 1_800_000;
const SECRET_KEY_RE = /(?:api.?key|secret|password|authorization|proxy_password|token)/i;

let memoryEntries = [];
let memoryFallbackActive = false;

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
    .slice(0, 2000);
}

function cleanFullString(value) {
  return String(value ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [已隐藏]')
    .replace(/([?&](?:key|token|api_key|access_token)=)[^&#\s]+/gi, '$1[已隐藏]')
    .replace(/((?:api[_-]?key|authorization|token|secret|password)\s*["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, '$1[已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[密钥已隐藏]')
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, '[密钥已隐藏]');
}

export function sanitizeDiagnostic(value, key = '') {
  if (SECRET_KEY_RE.test(key)) return '[已隐藏]';
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
  if (SECRET_KEY_RE.test(key)) return '[已隐藏]';
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
  let serialized = JSON.stringify(fitted);
  while (serialized.length > MAX_STORAGE_CHARACTERS && fitted.length > 1) {
    fitted.shift();
    serialized = JSON.stringify(fitted);
  }
  return { entries: fitted, serialized };
}

export function readDiagnostics(storage) {
  const target = storageOrNull(storage);
  if (!target) return [...memoryEntries];
  if (memoryFallbackActive) return [...memoryEntries];
  try {
    const parsed = JSON.parse(target.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(-MAX_ENTRIES) : [];
  } catch {
    return [];
  }
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
  if (Number.isInteger(entry?.floor)) normalized.floor = entry.floor;
  const fitted = fitEntriesForStorage([...readDiagnostics(target), normalized]);
  memoryEntries = fitted.entries;
  try {
    target?.setItem(STORAGE_KEY, fitted.serialized);
    memoryFallbackActive = !target;
  } catch {
    // Keep the in-memory copy when browser storage is unavailable or full.
    memoryFallbackActive = true;
  }
  return normalized;
}

export function clearDiagnostics(storage) {
  memoryEntries = [];
  memoryFallbackActive = false;
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

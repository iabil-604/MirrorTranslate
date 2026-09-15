// Generated audio lives in the browser's IndexedDB, never in the chat file: a chat that carried its audio
// would grow by megabytes per floor, and every write would go through saveChat alongside translations.
//
// Records are keyed by the cache keys tts.js computes, and each one remembers the floor and text version
// it was made for, so a floor whose text changed can drop what no longer belongs to it. When IndexedDB is
// refused — a sandboxed frame, a private window — the same interface runs in memory for the session.

const DB_NAME = 'jingyi-tts';
const DB_VERSION = 1;
const AUDIO_STORE = 'audio';
const ANALYSIS_STORE = 'analysis';

export const DEFAULT_TTS_CACHE_BYTES = 512 * 1024 * 1024;

/** Keys to delete, least recently used first, until the total fits. */
export function planEviction(entries, maxBytes) {
  const list = Array.isArray(entries) ? entries : [];
  let total = list.reduce((sum, entry) => sum + (Number(entry?.bytes) || 0), 0);
  if (total <= maxBytes) return [];
  const victims = [];
  for (const entry of [...list].sort((left, right) => (left.usedAt || 0) - (right.usedAt || 0))) {
    if (total <= maxBytes) break;
    victims.push(entry.key);
    total -= Number(entry.bytes) || 0;
  }
  return victims;
}

export function recordBytes(record) {
  return (Array.isArray(record?.parts) ? record.parts : [])
    .reduce((sum, part) => sum + (Number(part?.blob?.size) || Number(part?.bytes) || 0), 0);
}

export function createMemoryBackend() {
  const stores = { [AUDIO_STORE]: new Map(), [ANALYSIS_STORE]: new Map() };
  return {
    name: 'memory',
    async get(store, key) { return stores[store].get(key) ?? null; },
    async put(store, record) { stores[store].set(record.key, record); },
    async delete(store, key) { stores[store].delete(key); },
    async all(store) { return [...stores[store].values()]; },
    async byFloor(store, floorId) { return [...stores[store].values()].filter(record => record.floorId === floorId); },
    async clear(store) { stores[store].clear(); },
  };
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 请求失败'));
  });
}

export function createIndexedDbBackend(factory) {
  let opening = null;
  const open = () => {
    opening ??= new Promise((resolve, reject) => {
      let request;
      try {
        request = factory.open(DB_NAME, DB_VERSION);
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of [AUDIO_STORE, ANALYSIS_STORE]) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'key' }).createIndex('floorId', 'floorId');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB 打开失败'));
      request.onblocked = () => reject(new Error('IndexedDB 被其他页面占用'));
    }).catch(error => {
      opening = null;
      throw error;
    });
    return opening;
  };
  const run = async (store, mode, work) => {
    const db = await open();
    const transaction = db.transaction(store, mode);
    const done = new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB 事务中断'));
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB 事务失败'));
    });
    // A failed request fails the transaction too; that rejection is reported through the request.
    done.catch(() => {});
    const result = await promisify(work(transaction.objectStore(store)));
    await done;
    return result;
  };
  return {
    name: 'indexeddb',
    get: async (store, key) => (await run(store, 'readonly', target => target.get(key))) ?? null,
    put: (store, record) => run(store, 'readwrite', target => target.put(record)),
    delete: (store, key) => run(store, 'readwrite', target => target.delete(key)),
    all: (store) => run(store, 'readonly', target => target.getAll()),
    // The index keeps a redraw from reading every cached recording just to tidy up one floor.
    byFloor: (store, floorId) => run(store, 'readonly', target => target.index('floorId').getAll(floorId)),
    clear: (store) => run(store, 'readwrite', target => target.clear()),
  };
}

export function createTtsStore({ indexedDB = globalThis.indexedDB, maxBytes = DEFAULT_TTS_CACHE_BYTES, now = () => Date.now() } = {}) {
  let backend = indexedDB ? createIndexedDbBackend(indexedDB) : createMemoryBackend();
  let note = indexedDB ? '' : '当前环境没有 IndexedDB，朗读缓存只保存在本次会话里。';
  // The first failure switches to memory for the rest of the session instead of retrying on every play.
  const guarded = async (operation, fallbackValue) => {
    try {
      return await operation(backend);
    } catch (error) {
      if (backend.name === 'memory') throw error;
      backend = createMemoryBackend();
      note = `浏览器本地库不可用（${error?.message || error}），朗读缓存改为只保存在本次会话里。`;
      try {
        return await operation(backend);
      } catch {
        return fallbackValue;
      }
    }
  };

  const evict = async () => {
    const records = await guarded(target => target.all(AUDIO_STORE), []);
    const victims = planEviction(records.map(record => ({ key: record.key, bytes: record.bytes, usedAt: record.usedAt })), maxBytes);
    for (const key of victims) await guarded(target => target.delete(AUDIO_STORE, key));
    return victims.length;
  };

  return {
    get backendName() { return backend.name; },
    get note() { return note; },
    async getAudio(key) {
      const record = await guarded(target => target.get(AUDIO_STORE, key), null);
      if (record) {
        record.usedAt = now();
        void guarded(target => target.put(AUDIO_STORE, record)).catch(() => {});
      }
      return record;
    },
    async putAudio(record) {
      const stamped = { ...record, bytes: recordBytes(record), createdAt: record.createdAt ?? now(), usedAt: now() };
      await guarded(target => target.put(AUDIO_STORE, stamped));
      await evict();
      return stamped;
    },
    getAnalysis: key => guarded(target => target.get(ANALYSIS_STORE, key), null),
    async putAnalysis(record) {
      const stamped = { ...record, createdAt: record.createdAt ?? now() };
      await guarded(target => target.put(ANALYSIS_STORE, stamped));
      return stamped;
    },
    deleteAnalysis: key => guarded(target => target.delete(ANALYSIS_STORE, key)),
    /** Every recording of one floor, any text version; the caller keeps the ones for its version. */
    listFloorAudio: floorId => guarded(target => target.byFloor(AUDIO_STORE, floorId), []),
    // The reader's own version of one sentence lives beside the analyses, keyed by floor, text version
    // and sentence, so it outlives the recordings it produced and goes with the text it belonged to.
    getOverride: (floorId, version, segmentId) => guarded(target => target.get(ANALYSIS_STORE, `o:${floorId}|${version}|${segmentId}`), null),
    async putOverride(record) {
      const key = `o:${record.floorId}|${record.version}|${record.segmentId}`;
      const stamped = { ...record, key, kind: 'override', createdAt: record.createdAt ?? now() };
      await guarded(target => target.put(ANALYSIS_STORE, stamped));
      return stamped;
    },
    deleteOverride: (floorId, version, segmentId) => guarded(target => target.delete(ANALYSIS_STORE, `o:${floorId}|${version}|${segmentId}`)),
    async listOverrides(floorId, version) {
      const records = await guarded(target => target.byFloor(ANALYSIS_STORE, floorId), []);
      return records.filter(record => record.kind === 'override' && record.version === version);
    },
    /** Drops every record of a floor made for another text version. */
    async pruneFloor(floorId, keepVersion) {
      let removed = 0;
      for (const store of [AUDIO_STORE, ANALYSIS_STORE]) {
        const records = await guarded(target => target.byFloor(store, floorId), []);
        for (const record of records) {
          if (record.floorId !== floorId || record.version === keepVersion) continue;
          await guarded(target => target.delete(store, record.key));
          removed += 1;
        }
      }
      return removed;
    },
    async clearChat(chatId) {
      let removed = 0;
      const prefix = `${chatId}|`;
      for (const store of [AUDIO_STORE, ANALYSIS_STORE]) {
        const records = await guarded(target => target.all(store), []);
        for (const record of records) {
          if (!String(record.floorId ?? '').startsWith(prefix)) continue;
          await guarded(target => target.delete(store, record.key));
          removed += 1;
        }
      }
      return removed;
    },
    async clear() {
      await guarded(target => target.clear(AUDIO_STORE));
      await guarded(target => target.clear(ANALYSIS_STORE));
    },
    async usage() {
      const records = await guarded(target => target.all(AUDIO_STORE), []);
      return {
        entries: records.length,
        bytes: records.reduce((sum, record) => sum + (Number(record.bytes) || 0), 0),
        backend: backend.name,
      };
    },
  };
}

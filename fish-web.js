export const FISH_WEB_TASK_CHECK = '先到 Fish 管理页查看任务记录，再决定是否重试。';
export const FISH_ANDROID_TASK_CHECK = '先到 Fish Local 查看任务记录，再决定是否重试。';
export const FISH_ANDROID_SETUP = '请在「朗读 → Fish 管理」连接 Fish Local。';
export const DEFAULT_FISH_ANDROID_PORT = 7860;
export const FISH_MANAGED_ROOT = '/api/plugins/mirrortranslate-fish';
export const FISH_SERVICE_MISSING = 'fish_service_missing';

export function missingFishService() {
  return Object.assign(new Error('酒馆未加载 Fish 服务。请查看「朗读 → Fish 管理」。'), {
    status: 404,
    code: FISH_SERVICE_MISSING,
  });
}

const MANAGED_MESSAGES = {
  browser_unavailable: '请打开该账号的 Fish 窗口。',
  fish_login_required: '登录 Fish 后，回这里检查账号。',
  fish_session_expired: 'Fish 登录已过期，请重新登录。',
  fish_verification_required: '请在 Fish 窗口完成验证。',
  fish_session_changed: '登录状态有变，请检查账号。',
  no_available_accounts: '请先登录并启用一个 Fish 账号。',
  upstream_timeout: 'Fish 生成超时。',
  request_cancelled: '已取消排队任务。',
};

export async function fishManagedRequest(path, { method = 'GET', body, signal, headers } = {}) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
  let response;
  try {
    response = await fetch(FISH_MANAGED_ROOT + path, {
      method, signal, headers: requestHeaders, credentials: 'same-origin', mode: 'same-origin',
      redirect: 'error', cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    throw new Error(path === '/speech' ? `Fish 语音连接中断。${FISH_WEB_TASK_CHECK}` : 'Fish 服务连接失败。');
  }
  if (response.ok) return response;
  const failure = (await response.json().catch(() => null))?.error;
  if (response.status === 404 && (path === '/state' || !failure?.code)) throw missingFishService();
  let message = (Object.hasOwn(MANAGED_MESSAGES, failure?.code) ? MANAGED_MESSAGES[failure.code] : failure?.message)
    || `Fish 请求失败（${response.status}）。`;
  if (path === '/speech' && (['unknown', 'accepted'].includes(failure?.submission)
    || failure?.code === 'bridge_error' || (!failure && response.status >= 500))) message += FISH_WEB_TASK_CHECK;
  throw Object.assign(new Error(message), { status: response.status, code: failure?.code });
}

const TAURI_TTS_ROUTE = '/api/openai/custom/generate-voice';
const TAURI_TTS_KEY = 'api_key_custom_openai_tts';
const FISH_ANDROID_KEY_LABEL = '镜译 · Fish Local';
const FISH_ANDROID_UNAVAILABLE = '连不上 Fish Local。请在 App 里启动服务并检查端口。';
const FISH_ANDROID_UPDATE = '请更新到 Fish Local preview.5 或更新版本，并使用 TauriTavern 2.3.0。';
const FISH_ANDROID_KEY_CHANGED = '请在 TauriTavern 的朗读 Key 管理里选回「镜译 · Fish Local」。';

export function isAndroidFishHost(host, browser = globalThis.navigator) {
  return host === 'tauritavern' && /Android/i.test([
    browser?.userAgentData?.platform, browser?.platform, browser?.userAgent,
  ].join(' '));
}

export function fishAndroidPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : 0;
}

async function ensureAndroidDirect() {
  const host = globalThis.__TAURITAVERN__ ?? globalThis.window?.__TAURITAVERN__;
  const readSettings = host?.invoke?.safeInvoke;
  if (typeof readSettings !== 'function') throw new Error(FISH_ANDROID_UPDATE);
  const settings = await readSettings('get_tauritavern_settings').catch(() => null);
  const proxy = settings?.request_proxy;
  if (typeof proxy?.enabled !== 'boolean') throw new Error('无法读取 TauriTavern 的请求代理设置。');
  if (proxy.enabled && !(Array.isArray(proxy.bypass) && proxy.bypass.includes('127.0.0.1'))) {
    throw new Error('请在 TauriTavern 的请求代理绕过列表中加入 127.0.0.1。');
  }
}

function postAndroidHost(path, body, { headers, signal } = {}) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set('Content-Type', 'application/json');
  return fetch(path, {
    method: 'POST', headers: requestHeaders, body: JSON.stringify(body), signal,
    credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store',
  });
}

async function androidHostSecret(action, body, options) {
  const response = await postAndroidHost('/api/secrets/' + action, body, options).catch(() => null);
  options?.signal?.throwIfAborted();
  if (!response?.ok) throw new Error('TauriTavern 无法访问朗读 Key。');
  return response.json().catch(() => { throw new Error('TauriTavern 无法读取朗读 Key。'); });
}

async function activeAndroidKey(options) {
  const state = await androidHostSecret('read', {}, options);
  const entries = state?.[TAURI_TTS_KEY];
  if (entries === null) return null;
  if (!Array.isArray(entries)) throw new Error('TauriTavern 无法读取朗读 Key。');
  const active = entries.find(entry => entry?.active === true);
  if (active && (typeof active.id !== 'string' || !active.id)) throw new Error('TauriTavern 无法读取朗读 Key。');
  return active ? { id: active.id, label: active.label } : null;
}

async function androidMirrorBearer(key) {
  // This host Key can only authenticate to the Android bridge, even if the host's own TTS uses it.
  if (!globalThis.crypto?.subtle) throw new Error(FISH_ANDROID_UPDATE);
  const material = new TextEncoder().encode('mirrortranslate:fish-local:v1:' + key);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', material);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return 'mirror_' + base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function requireAndroidKey({ port, secretId }, options) {
  const safePort = fishAndroidPort(port);
  if (!safePort || !secretId) throw new Error(FISH_ANDROID_SETUP);
  await ensureAndroidDirect();
  options?.signal?.throwIfAborted();
  if ((await activeAndroidKey(options))?.id !== secretId) throw new Error(FISH_ANDROID_KEY_CHANGED);
  return safePort;
}

async function androidTtsRequest(port, path, body, options, { probe = false } = {}) {
  const signal = options?.signal;
  signal?.throwIfAborted();
  let onAbort;
  try {
    const request = postAndroidHost(TAURI_TTS_ROUTE, {
      ...body, provider_endpoint: 'http://127.0.0.1:' + port + '/v1/mirror/' + path, response_format: 'mp3',
    }, options);
    if (!signal) return await request;
    // The native command can keep working after the browser-side request stops.
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    return await Promise.race([request, cancelled]);
  } catch (error) {
    if (signal?.aborted && !(probe && signal.reason?.name === 'TimeoutError')) throw error;
    throw new Error(probe ? FISH_ANDROID_UNAVAILABLE : FISH_ANDROID_UNAVAILABLE + FISH_ANDROID_TASK_CHECK);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

function androidResponseError(response, message, probe = false) {
  if (response.status === 401) return Object.assign(new Error('本地 Key 不正确。请核对 Key 和 Fish Local 版本。'), { status: 401 });
  if (response.status === 404 || response.status === 405) return new Error(FISH_ANDROID_UPDATE);
  if (response.status >= 500) return new Error(probe ? FISH_ANDROID_UNAVAILABLE : FISH_ANDROID_UNAVAILABLE + FISH_ANDROID_TASK_CHECK);
  return new Error(message.trim().slice(0, 240) || FISH_ANDROID_UNAVAILABLE);
}

export async function checkFishAndroid({ port, secretId }, options) {
  const safePort = await requireAndroidKey({ port, secretId }, options);
  const response = await androidTtsRequest(safePort, 'check', { input: '' }, options, { probe: true });
  const message = (await response.text()).trim();
  const profile = /^fish-local-mirror-v1 ([a-z0-9.-]+) ([A-Za-z0-9_-]{8,128})$/.exec(message);
  if (response.status === 400 && profile) return profile.slice(1).join(':');
  if (response.ok) throw new Error('Fish Local 返回了无法识别的连接结果。');
  throw androidResponseError(response, message, true);
}

export async function connectFishAndroid({ port, key, secretId, switchFrom }, { headers } = {}) {
  port = fishAndroidPort(port);
  if (!port) throw new Error('端口请输入 1024–65535。');
  if (key && !/^fish_[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('请粘贴 Fish Local 控制台复制的本地 Key。');
  await ensureAndroidDirect();
  const active = await activeAndroidKey({ headers });
  const occupied = active && active.id !== secretId && active.label !== FISH_ANDROID_KEY_LABEL;
  if (occupied && active.id !== switchFrom) {
    const error = new Error('酒馆已有 OpenAI 兼容朗读 Key。切换后可在酒馆里选回原 Key。');
    throw Object.assign(error, { switchFrom: active.id });
  }
  if (!key && (occupied || !active?.id)) throw new Error('请粘贴 Fish Local 控制台复制的本地 Key。');
  const verify = async id => {
    const connection = { port, secretId: id };
    const profile = await checkFishAndroid(connection, { headers, signal: AbortSignal.timeout(6500) });
    return { ...connection, profile };
  };
  if (active?.id && !occupied) {
    try { return await verify(active.id); }
    catch (error) { if (!key || error.status !== 401) throw error; }
  }
  let addedId;
  try {
    const value = await androidMirrorBearer(key);
    const { id } = await androidHostSecret('write', { key: TAURI_TTS_KEY, value, label: FISH_ANDROID_KEY_LABEL }, { headers });
    if (typeof id !== 'string' || !id) throw new Error('TauriTavern 无法保存朗读 Key。');
    addedId = id;
    return await verify(addedId);
  } catch (error) {
    if (addedId) {
      try {
        const options = { headers, signal: AbortSignal.timeout(3500) };
        if (active?.id && (await activeAndroidKey(options))?.id === addedId) {
          await androidHostSecret('rotate', { key: TAURI_TTS_KEY, id: active.id }, options);
        }
        await androidHostSecret('delete', { key: TAURI_TTS_KEY, id: addedId }, options);
      } catch {
        throw new Error(error.message + ' 请在 TauriTavern 的 Key 管理里检查「镜译 · Fish Local」。');
      }
    }
    throw error;
  }
}

export async function fishAndroidSpeech(body, { port, secretId }, options) {
  const safePort = await requireAndroidKey({ port, secretId }, options);
  const random = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const id = Date.now() + '-' + Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('');
  const response = await androidTtsRequest(safePort, 'speech/' + id, body, options);
  if (response.ok) return response;
  throw androidResponseError(response, await response.text());
}

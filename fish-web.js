import { DEFAULT_FISH_WEB } from './core.js?v=0.51.5';

const CONNECTION_HELP = '外置 Fish 连接失败，可在镜译里切换到内置服务。';
export const FISH_WEB_TASK_CHECK = '先到 Fish 管理页查看任务记录，再决定是否重试。';
export const FISH_MANAGED_ROOT = '/api/plugins/mirrortranslate-fish';

export function fishWebUsesManaged(config) {
  return config?.managed === true || !String(config?.key ?? '').trim();
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
  let message = (Object.hasOwn(MANAGED_MESSAGES, failure?.code) ? MANAGED_MESSAGES[failure.code] : failure?.message)
    || (response.status === 404 ? '请安装镜译内置版并重启酒馆。' : `Fish 请求失败（${response.status}）。`);
  if (path === '/speech' && (['unknown', 'accepted'].includes(failure?.submission)
    || failure?.code === 'bridge_error' || (!failure && response.status >= 500))) message += FISH_WEB_TASK_CHECK;
  throw Object.assign(new Error(message), { status: response.status, code: failure?.code });
}

export function fishWebOrigin(address) {
  const input = String(address ?? '').trim() || DEFAULT_FISH_WEB.baseUrl;
  try {
    const url = new URL(input.includes('://') ? input : `http://${input}`);
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash) return '';
    const path = url.pathname.replace(/\/+$/, '');
    return ['', '/v1/audio/speech', '/audio/speech', '/v1/tts'].includes(path) ? url.origin : '';
  } catch {
    return '';
  }
}

export function fishWebReadyReason(config) {
  if (fishWebUsesManaged(config)) return '';
  if (!fishWebOrigin(config?.baseUrl)) return 'Fish 网页订阅需要本机地址，例如 http://127.0.0.1:7860。';
  return '';
}

export async function fishWebRequest(config, path, { body, signal, headers: hostHeaders } = {}) {
  if (fishWebUsesManaged(config)) {
    if (path !== '/v1/audio/speech') throw new Error('Fish 请求不受支持。');
    return fishManagedRequest('/speech', { method: 'POST', body, signal, headers: hostHeaders });
  }
  const reason = fishWebReadyReason(config);
  if (reason) throw new Error(reason);
  const origin = fishWebOrigin(config.baseUrl);
  const key = String(config.key).trim();
  const headers = path === '/health' ? {} : { Authorization: `Bearer ${key}` };
  const synthesis = body !== undefined;
  if (synthesis) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(origin + path, {
      method: synthesis ? 'POST' : 'GET', headers, signal,
      ...(synthesis ? { body: JSON.stringify(body) } : {}),
      credentials: 'omit', redirect: 'error', cache: 'no-store',
    });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    throw new Error(synthesis ? `Fish 语音连接中断。${FISH_WEB_TASK_CHECK}` : CONNECTION_HELP);
  }
  if (response.ok) return response;
  const failure = (await response.json().catch(() => null))?.error;
  let message = response.status === 401
    ? '本地 Key 不正确，可切换到内置服务。'
    : typeof failure?.message === 'string' ? failure.message.replaceAll(key, '（已隐藏）').slice(0, 280)
      : `本机 Fish 返回了 HTTP ${response.status}。`;
  if (synthesis && (['unknown', 'accepted'].includes(failure?.submission) || (!failure && response.status >= 500))) {
    message += FISH_WEB_TASK_CHECK;
  }
  const error = new Error(message);
  error.status = response.status;
  throw error;
}

export async function probeFishWeb(config, signal, headers) {
  if (fishWebUsesManaged(config)) {
    const state = await (await fishManagedRequest('/state', { signal, headers })).json();
    if (state.service !== 'mirrortranslate-fish' || state.status !== 'running') {
      throw new Error('请在镜译的 Fish 管理页启动服务。');
    }
    const settings = await (await fishManagedRequest('/settings', { signal, headers })).json();
    return { voiceConfigured: Boolean(settings.defaultVoice) };
  }
  const health = await (await fishWebRequest(config, '/health', { signal })).json().catch(() => null);
  if (health?.status !== 'ok' || health?.service !== 'fish-subscription-proxy' || health?.route !== 'web-task') {
    throw new Error('这个地址不是 Fish 网页订阅服务。');
  }
  const models = await (await fishWebRequest(config, '/v1/models', { signal })).json().catch(() => null);
  if (!Array.isArray(models?.data) || !models.data.some(item => item?.id === 'tts-1')) {
    throw new Error('本机 Fish 的语音接口不兼容，请确认正在使用 0.3.1-preview.2 或兼容版本。');
  }
  return { voiceConfigured: health.voiceConfigured === true };
}

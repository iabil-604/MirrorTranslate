export const FISH_WEB_TASK_CHECK = '请到反代端查看任务记录，再决定是否重试。';

export function fishWebEndpoint(address) {
  const input = String(address ?? '').trim();
  if (!input) return '';
  try {
    const url = new URL(input.includes('://') ? input : 'http://' + input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = path.endsWith('/audio/speech') ? path
      : path.endsWith('/v1') ? path + '/audio/speech' : path + '/v1/audio/speech';
    return url.href;
  } catch {
    return '';
  }
}

export function fishWebReadyReason(config) {
  return fishWebEndpoint(config?.baseUrl) ? '' : '请填写反代的语音接口 URL。';
}

export function fishWebGoesDirect(config, host) {
  return config?.viaProxy === false || host === 'tauritavern';
}

export async function fishWebRequest(config, path, { body, signal, headers, host } = {}) {
  const reason = fishWebReadyReason(config);
  if (reason) throw new Error(reason);
  signal?.throwIfAborted();
  const endpoint = fishWebEndpoint(config.baseUrl);
  const base = endpoint.replace(/\/(?:v1\/)?audio\/speech$/, '');
  const target = path === '/speech' ? endpoint : base + path;
  const direct = fishWebGoesDirect(config, host);
  const key = String(config.key ?? '').trim();
  const requestHeaders = new Headers(direct ? undefined : headers);
  if (key) requestHeaders.set(direct ? 'Authorization' : 'X-Api-Key', direct ? 'Bearer ' + key : key);
  if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
  let response;
  try {
    response = await fetch(direct ? target : '/proxy/' + target, {
      method: body === undefined ? 'GET' : 'POST', headers: requestHeaders, signal,
      credentials: direct ? 'omit' : 'same-origin', redirect: 'error', cache: 'no-store',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    throw new Error('反代连接失败，请检查地址和跨域设置。' + (body === undefined ? '' : FISH_WEB_TASK_CHECK));
  }
  if (response.ok) return response;
  const raw = await response.text().catch(() => '');
  let failure;
  try { failure = JSON.parse(raw)?.error; } catch {}
  let message = response.status === 401
    ? '反代 Key 不正确。'
    : typeof failure?.message === 'string' ? failure.message
      : /CORS proxy is disabled/i.test(raw) ? '请开启酒馆的 enableCorsProxy，或关闭「经酒馆代理」。'
        : '反代请求失败（HTTP ' + response.status + '）。';
  if (key) message = message.replaceAll(key, '（已隐藏）');
  message = message.slice(0, 280);
  if (body !== undefined && (['unknown', 'accepted'].includes(failure?.submission) || (!failure && response.status >= 500))) {
    message += FISH_WEB_TASK_CHECK;
  }
  throw Object.assign(new Error(message), { status: response.status, code: failure?.code });
}

export async function probeFishWeb(config, options) {
  const response = await fishWebRequest(config, '/v1/models', options);
  const models = await response.json().catch(() => null);
  if (!Array.isArray(models?.data) || !models.data.some(model => model?.id === 'tts-1')) {
    throw new Error('反代需要提供兼容 OpenAI 的语音接口和 tts-1 模型。');
  }
}

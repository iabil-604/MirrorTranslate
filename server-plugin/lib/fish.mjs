import { createHash } from 'node:crypto';
import { BACKENDS, FORMATS, normalizeToken, voiceId } from './config.mjs';
import { GatewayError, invalid } from './errors.mjs';

const FISH_ORIGIN = 'https://api.fish.audio';
const DEFAULT_ALIASES = new Set(['default', 'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);

// This hash never leaves the process. A successful /user/self response binds
// the exact login + wallet context, not a user-supplied display name or JWT claim.
const fingerprint = headers => createHash('sha256').update(JSON.stringify([
  headers.authorization, headers['x-team-id'] ?? '', headers['x-workspace-id'] ?? '',
])).digest('hex');

export function makeTask(body, config, dialect = 'openai') {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('请求体必须是 JSON 对象。');
  const supported = dialect === 'fish'
    ? ['text', 'reference_id', 'format', 'backend', 'speed', 'latency', 'normalize', 'prosody']
    : ['input', 'model', 'voice', 'response_format', 'speed'];
  if (Object.keys(body).some(field => !supported.includes(field))) throw invalid('请求中包含此订阅适配尚不支持的字段，请参考 README 的接口字段。');
  if (body.prosody !== undefined && (!body.prosody || typeof body.prosody !== 'object' || Array.isArray(body.prosody) || Object.keys(body.prosody).some(field => field !== 'speed'))) throw invalid('prosody 当前只支持 speed。');
  const text = dialect === 'fish' ? body.text : body.input;
  if (typeof text !== 'string' || !text.trim()) throw invalid('请填写要朗读的文字。');
  if ([...text].length > config.maxChars) throw invalid(`单次最多 ${config.maxChars} 个字符，请分段朗读。`);
  const format = (dialect === 'fish' ? body.format : body.response_format) ?? 'mp3';
  if (typeof format !== 'string' || !Object.hasOwn(FORMATS, format)) throw invalid('音频格式支持 mp3、wav、opus、pcm。');
  let selected = (dialect === 'fish' ? body.reference_id : body.voice) ?? 'default';
  if (DEFAULT_ALIASES.has(selected)) selected = config.defaultVoice;
  if (!selected) throw invalid('请先在管理页选择默认声音，或在 voice/reference_id 中填写 Fish 声音 ID。');
  const id = voiceId(selected);
  const requestedBackend = dialect === 'fish' ? body.backend : body.model;
  const backend = !requestedBackend || ['tts-1', 'tts-1-hd', 'fish'].includes(requestedBackend) ? config.backend : requestedBackend;
  if (!BACKENDS.includes(backend)) throw invalid(`模型支持 ${BACKENDS.join('、')}；tts-1 使用管理页所选模型。`);
  const speed = body.speed ?? body.prosody?.speed ?? 1;
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.5 || speed > 2) throw invalid('语速支持 0.5 到 2。');
  // The web editor sends loudness normalization only for the S2 family.
  // Keep the existing adapters unchanged; Drama 3 follows its own web defaults.
  const prosody = backend === 'drama-3' ? { speed, volume: 0 } : { speed, volume: 0, normalize_loudness: true };
  const sampling = backend === 'drama-3' ? { sampler: { temperature: 1, top_p: 0.95 } } : {};
  const latency = body.latency ?? 'balanced';
  if (!['normal', 'balanced'].includes(latency)) throw invalid('latency 支持 normal 或 balanced。');
  if (body.normalize !== undefined && typeof body.normalize !== 'boolean') throw invalid('normalize 必须是布尔值。');
  const parameters = { text, model_id: id, format, prosody, latency, backend, normalize: body.normalize ?? false, ...sampling };
  return { type: 'tts', stream: true, model: id, parameters, format, backend, prosody, latency, ...sampling };
}

export async function readLimited(response, limit = 512 * 1024) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new GatewayError(502, 'upstream_response_too_large', 'Fish 返回的数据超过预期大小。');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function checkResponse(response) {
  if (response.ok) return;
  const raw = (await readLimited(response, 65536)).toString('utf8').toLowerCase();
  let message = 'Fish 拒绝了请求，请检查声音、模型及账号状态。';
  let status = response.status >= 500 ? 502 : response.status;
  let code = 'fish_request_failed';
  if (response.status === 401) { status = 503; code = 'fish_session_expired'; message = 'Fish 登录已失效，请在该账号专用窗口重新登录，再点击“检查”。'; }
  else if (/captcha|turnstile|challenge/.test(raw)) { status = 403; code = 'fish_verification_required'; message = '请在该账号的 Fish 窗口完成网页验证，再点击“检查”。'; }
  else if (response.status === 402) { code = 'fish_quota_exhausted'; message = 'Fish 返回额度不足（402），请检查账号及当前团队的余额。'; }
  else if (response.status === 429) { code = 'fish_rate_limited'; message = 'Fish 请求频率受限，请稍后再试。'; }
  else if (response.status >= 500) { code = 'fish_unavailable'; message = 'Fish 服务暂时不可用，请稍后再试。'; }
  const error = new GatewayError(status, code, message);
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter && /^\d{1,6}$/.test(retryAfter)) error.retryAfter = retryAfter;
  throw error;
}

export class FishClient {
  constructor({ browser, fetchImpl = fetch }) { this.browser = browser; this.fetchImpl = fetchImpl; }
  async credentials(config, signal, verification = false) {
    const context = config.mode === 'browser'
      ? await this.browser.credentials({ signal, verification })
      : { token: config.fishToken, teamId: config.teamId, workspaceId: config.workspaceId };
    const token = normalizeToken(context.token ?? '');
    if (!token) throw new GatewayError(503, 'fish_login_required', '尚未连接 Fish 账号。请在管理页登录或填写网页 Token。');
    const headers = { authorization: `Bearer ${token}`, origin: 'https://fish.audio', referer: 'https://fish.audio/' };
    for (const [key, value] of [['x-team-id', context.teamId], ['x-workspace-id', context.workspaceId], ['user-agent', context.userAgent]]) {
      if (value) {
        if (typeof value !== 'string' || /[\r\n]/.test(value) || value.length > 1024) throw invalid('Fish 登录上下文格式不正确。');
        headers[key] = value;
      }
    }
    return { headers: Object.freeze(headers), recaptcha: context.recaptcha, fingerprint: fingerprint(headers) };
  }
  async request(path, options) {
    try { return await this.fetchImpl(`${FISH_ORIGIN}${path}`, { ...options, redirect: 'error' }); }
    catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      throw new GatewayError(502, 'fish_connection_failed', '无法连接 api.fish.audio，请检查网络连接。');
    }
  }
  async generate(task, config, signal, { expectedFingerprint, onSubmission = () => {} } = {}) {
    let submission = 'not-submitted';
    try {
      const context = await this.credentials(config, signal, true);
      if (expectedFingerprint && context.fingerprint !== expectedFingerprint) {
        throw new GatewayError(503, 'fish_session_changed', '账号或团队已切换，请刷新该账号后再试。');
      }
      signal?.throwIfAborted();
      // Even a 402/401 response alone does not prove the server never created
      // a task. Until an upstream rejection contract is verified, do not replay.
      submission = 'unknown'; onSubmission(submission);
      const response = await this.request('/task', {
        method: 'POST', headers: { ...context.headers, 'content-type': 'application/json' },
        body: JSON.stringify({ ...task, ...(context.recaptcha ? { recaptcha: context.recaptcha } : {}) }), signal,
      });
      await checkResponse(response);
      submission = 'accepted'; onSubmission(submission);
      const contentType = response.headers.get('content-type')?.split(';')[0].trim();
      if (!response.body || (contentType && !contentType.startsWith('audio/') && contentType !== 'application/octet-stream')) {
        await response.body?.cancel();
        throw new GatewayError(502, 'fish_unexpected_response', 'Fish 没有返回音频流，网页接口可能已变更。');
      }
      return response;
    } catch (error) {
      error.submission = submission;
      throw error;
    }
  }
  async getJson(path, config, signal) {
    const { headers } = await this.credentials(config, signal);
    return this.jsonWithHeaders(path, headers, signal);
  }
  async jsonWithHeaders(path, headers, signal) {
    const response = await this.request(path, { method: 'GET', headers, signal });
    await checkResponse(response);
    try { return JSON.parse((await readLimited(response)).toString('utf8')); }
    catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError(502, 'fish_unexpected_response', 'Fish 返回的数据格式发生变化。');
    }
  }
  async inspect(config, signal) {
    const context = await this.credentials(config, signal);
    const raw = await this.jsonWithHeaders('/user/self', context.headers, signal);
    const user = raw?.data ?? raw;
    if (typeof user?._id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(user._id)) {
      throw new GatewayError(502, 'fish_identity_unknown', '无法确认 Fish 账号身份，请刷新账号。');
    }
    let wallet;
    let balanceError = null;
    try { wallet = await this.jsonWithHeaders('/wallet/self/package', context.headers, signal); }
    catch (error) {
      if (signal?.aborted || ['fish_session_expired', 'fish_verification_required'].includes(error.code)) throw error;
      balanceError = error.code ?? 'fish_request_failed';
    }
    const value = wallet?.data ?? wallet;
    return {
      identityKey: `user:${user._id}`, fingerprint: context.fingerprint,
      walletKey: context.headers['x-team-id'] ? `team:${context.headers['x-team-id']}` : `user:${user._id}`,
      type: typeof value?.type === 'string' ? value.type.slice(0, 64) : null,
      balance: typeof value?.balance === 'number' && Number.isFinite(value.balance) ? value.balance : null,
      balanceCheckedAt: balanceError ? null : new Date().toISOString(), balanceError,
    };
  }
  async account(config, signal) {
    const raw = await this.getJson('/wallet/self/package', config, signal);
    const value = raw?.data ?? raw;
    return { type: value?.type ?? null, balance: value?.balance ?? null, expireAt: value?.expire_at ?? value?.expired_at ?? null, route: 'web-task' };
  }
  async voices(query, config, signal) {
    const params = new URLSearchParams({ page_size: '20', page_number: '1' });
    if (query) params.set('title', query.slice(0, 100));
    const raw = await this.getJson(`/model?${params}`, config, signal);
    const items = raw?.items ?? raw?.data?.items;
    if (!Array.isArray(items)) throw new GatewayError(502, 'fish_unexpected_response', 'Fish 声音列表格式发生变化。');
    return items.map(item => ({ id: item._id, name: item.title, languages: item.languages ?? [] }));
  }
}

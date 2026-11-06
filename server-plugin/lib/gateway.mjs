import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FORMATS, BACKENDS, MODELS } from './config.mjs';
import { GatewayError, invalid } from './errors.mjs';
import { makeTask } from './fish.mjs';

const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

function matches(value, expected) {
  if (typeof value !== 'string' || typeof expected !== 'string') return false;
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function loopback(address) { return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address); }

function assertAdmin(req, token) {
  const host = req.headers.host;
  let hostname;
  try { hostname = new URL(`http://${host}`).hostname; } catch { /* reject below */ }
  if (!loopback(req.socket.remoteAddress) || !['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    || (req.headers.origin && req.headers.origin !== `http://${host}`)) {
    throw new GatewayError(403, 'local_admin_only', '管理操作只允许从本机管理页进行。');
  }
  if (!matches(req.headers['x-admin-token'], token)) throw new GatewayError(401, 'admin_auth_required', '请通过启动脚本重新打开管理页。');
}

function assertKey(req, key) {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!matches(bearer, key) && !matches(req.headers['x-api-key'], key)) {
    throw new GatewayError(401, 'invalid_api_key', '缺少或不正确的本地 Key，请使用 Authorization: Bearer <本地 Key>。');
  }
}

function json(res, status, value) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value));
}

async function bodyJson(req, limit = 128 * 1024) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new GatewayError(415, 'json_required', '请使用 Content-Type: application/json。');
  if (Number(req.headers['content-length']) > limit) { req.resume(); throw new GatewayError(413, 'body_too_large', '请求体过大。'); }
  const data = await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', chunk => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) { failed = true; chunks.length = 0; reject(new GatewayError(413, 'body_too_large', '请求体过大。')); }
      else chunks.push(chunk);
    });
    req.once('end', () => { if (!failed) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.once('error', reject);
    req.once('aborted', () => reject(new GatewayError(499, 'client_disconnected', '客户端已断开。')));
  });
  try {
    const value = JSON.parse(data);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw invalid('请求体必须是有效的 JSON 对象。'); }
}

export function createGateway({ store, pool, adminToken, logger = console.log, network, publicDir = new URL('../public/', import.meta.url) }) {
  if (!pool) throw new TypeError('An account pool is required');
  const statistics = { completed: 0, failed: 0, lastTaskId: null };
  const jobs = new Map();
  const firstAccount = () => {
    const account = pool.candidates().find(account => account.enabled && account.status === 'ready') ?? pool.candidates()[0];
    if (!account) throw new GatewayError(503, 'no_available_accounts', '请先添加账号。');
    return account.id;
  };
  const server = createServer({ maxHeaderSize: 16384, requestTimeout: 30000, headersTimeout: 15000 }, async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    const controller = new AbortController();
    let timer;
    const armTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new GatewayError(504, 'upstream_timeout', '请求超时。生成可能已在 Fish 执行，请先查看官网历史，避免重复扣额度。')), store.get().timeoutMs);
    };
    armTimer();
    const closed = () => { if (!res.writableFinished) controller.abort(new GatewayError(499, 'client_disconnected', '客户端已断开。')); };
    res.on('close', closed);
    let generationRequest = false;
    let job;
    try {
      if (network && !network.allows(req.socket.remoteAddress)) throw new GatewayError(403, 'local_network_only', '只允许本机或已开启的同一局域网连接。');
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      const config = store.get();
      const admin = path.startsWith('/admin/');
      const origin = req.headers.origin;
      if (!admin && origin && config.allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-API-Key');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      }
      if (req.method === 'OPTIONS' && !admin) {
        if (!origin || !config.allowedOrigins.includes(origin)) throw new GatewayError(403, 'origin_not_allowed', '这个网页来源没有加入 allowedOrigins。');
        res.writeHead(204); res.end(); return;
      }
      if (req.method === 'GET' && STATIC.has(path)) {
        const [name, type] = STATIC.get(path);
        res.setHeader('Content-Type', type);
        res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src blob:; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        res.end(await readFile(new URL(name, publicDir))); return;
      }
      if (path === '/health' && req.method === 'GET') {
        json(res, 200, { status: 'ok', service: 'fish-subscription-proxy', route: 'web-task', voiceConfigured: !!config.defaultVoice }); return;
      }
      if (path === '/favicon.ico' && req.method === 'GET') { res.writeHead(204); res.end(); return; }
      if (admin) {
        assertAdmin(req, adminToken);
        if (path === '/admin/config' && req.method === 'GET') {
          json(res, 200, {
            mode: config.mode, backend: config.backend, defaultVoice: config.defaultVoice,
            tokenConfigured: !!config.fishToken, teamId: config.teamId, workspaceId: config.workspaceId,
            proxyKey: config.proxyKey, ...(network ? network.status() : { port: server.address().port, host: config.host, lan: false, addresses: [] }),
            maxChars: config.maxChars, models: MODELS,
            statistics: { ...statistics, generating: pool.scheduler.snapshot().active > 0 }, scheduler: pool.scheduler.snapshot(),
          }); return;
        }
        if (path === '/admin/config' && req.method === 'POST') {
          const patch = await bodyJson(req);
          if (Object.keys(patch).some(key => ['port', 'lan'].includes(key))) throw invalid('请通过监听设置接口修改端口和局域网开关。');
          const changesLogin = Object.keys(patch).some(key => ['mode', 'fishToken', 'teamId', 'workspaceId'].includes(key));
          const legacy = pool.candidates().find(account => account.id === 'legacy');
          if (changesLogin && legacy && pool.isBusy('legacy')) throw new GatewayError(409, 'account_busy', '请等待当前账号生成完成。');
          await store.update(patch);
          if (changesLogin && legacy) await pool.refresh('legacy', controller.signal).catch(() => {});
          json(res, 200, { saved: true }); return;
        }
        if (path === '/admin/network' && req.method === 'POST' && network) {
          json(res, 200, await network.configure(await bodyJson(req))); return;
        }
        if (path === '/admin/accounts' && req.method === 'GET') { json(res, 200, pool.snapshot()); return; }
        if (path === '/admin/accounts' && req.method === 'POST') {
          const body = await bodyJson(req);
          if (Object.keys(body).some(key => key !== 'name')) throw invalid('新增账号只接受备注名称。');
          json(res, 201, { account: await pool.add(body.name) }); return;
        }
        if (path === '/admin/accounts/order' && req.method === 'POST') {
          const body = await bodyJson(req);
          if (Object.keys(body).some(key => key !== 'ids')) throw invalid('账号顺序字段不正确。');
          json(res, 200, await pool.reorder(body.ids)); return;
        }
        const accountRoute = path.match(/^\/admin\/accounts\/([A-Za-z0-9-]+)(?:\/(login|refresh))?$/);
        if (accountRoute) {
          const [, id, action] = accountRoute;
          if (!action && req.method === 'PATCH') { json(res, 200, { account: await pool.update(id, await bodyJson(req)) }); return; }
          if (!action && req.method === 'DELETE') { const result = await pool.remove(id); json(res, result.pending ? 202 : 200, result); return; }
          if (action === 'login' && req.method === 'POST') { json(res, 200, await pool.open(id)); return; }
          if (action === 'refresh' && req.method === 'POST') { json(res, 200, { account: await pool.refresh(id, controller.signal) }); return; }
        }
        if (path === '/admin/scheduler' && req.method === 'GET') { json(res, 200, pool.scheduler.snapshot()); return; }
        if (path === '/admin/scheduler' && req.method === 'PATCH') {
          const body = await bodyJson(req);
          if (Object.keys(body).some(key => key !== 'policy')) throw invalid('调度设置字段不正确。');
          json(res, 200, await pool.setPolicy(body.policy)); return;
        }
        if (path === '/admin/voice-access' && req.method === 'GET') { json(res, 200, { voiceAccounts: pool.accounts.snapshot().voiceAccounts ?? {} }); return; }
        if (path === '/admin/voice-access' && req.method === 'POST') {
          const body = await bodyJson(req);
          if (Object.keys(body).some(key => !['voice', 'accountIds'].includes(key))) throw invalid('声音账号范围字段不正确。');
          json(res, 200, { voiceAccounts: await pool.accounts.setVoiceAccounts(body.voice, body.accountIds) }); return;
        }
        if (path === '/admin/tasks' && req.method === 'GET') { json(res, 200, { tasks: [...jobs.values()].map(entry => entry.view).reverse() }); return; }
        const cancelRoute = path.match(/^\/admin\/tasks\/([a-f0-9-]+)$/);
        if (cancelRoute && req.method === 'DELETE') {
          const entry = jobs.get(cancelRoute[1]);
          if (!entry) throw new GatewayError(404, 'task_not_found', '没有这个本地任务。');
          if (entry.view.stage !== 'queued') throw new GatewayError(409, 'task_already_started', '只能取消尚在排队的任务。');
          entry.controller.abort(new GatewayError(409, 'request_cancelled', '排队任务已取消，未提交生成。'));
          json(res, 200, { cancelled: true }); return;
        }
        if (path === '/admin/browser/open' && req.method === 'POST') {
          json(res, 200, await pool.open(firstAccount())); return;
        }
        if (path === '/admin/browser/status' && req.method === 'GET') {
          json(res, 200, await pool.provider(firstAccount()).browser.status()); return;
        }
        if (path === '/admin/shutdown' && req.method === 'POST') {
          json(res, 200, { stopping: true });
          setImmediate(() => {
            if (network) { network.close().catch(() => {}); return; }
            pool.close();
            server.close();
            setTimeout(() => server.closeAllConnections(), config.timeoutMs + 5000).unref();
          });
          return;
        }
        if (path === '/admin/account' && req.method === 'GET') {
          json(res, 200, await pool.refresh(firstAccount(), controller.signal)); return;
        }
        if (path === '/admin/voices' && req.method === 'GET') {
          json(res, 200, { voices: await pool.voices(url.searchParams.get('q') ?? '', controller.signal, url.searchParams.get('accountId')) }); return;
        }
        throw new GatewayError(404, 'not_found', '没有这个管理接口。');
      }
      assertKey(req, config.proxyKey);
      if (path === '/v1/models' && req.method === 'GET') {
        json(res, 200, { object: 'list', data: ['tts-1', ...BACKENDS].map(id => ({ id, object: 'model', owned_by: 'fish-local' })) }); return;
      }
      if (['/v1/voices', '/voices'].includes(path) && req.method === 'GET') {
        json(res, 200, { voices: config.defaultVoice ? [{ voice_id: 'default', name: 'default', fish_id: config.defaultVoice }] : [] }); return;
      }
      if (['/v1/audio/speech', '/audio/speech', '/v1/tts'].includes(path) && req.method === 'POST') {
        const task = makeTask(await bodyJson(req), config, path === '/v1/tts' ? 'fish' : 'openai');
        clearTimeout(timer); // Queue waiting has its own deadline, separate from generation.
        generationRequest = true;
        job = { requestId, accountId: null, backend: task.backend, voice: task.model, inputCharacters: [...task.parameters.text].length,
          createdAt: new Date().toISOString(), stage: 'queued', submission: 'not-submitted', taskId: null, attempts: 0 };
        jobs.set(requestId, { view: job, controller });
        for (const [id, entry] of jobs) if (jobs.size > 100 && entry.view.finishedAt) jobs.delete(id);
        let acquired = false, result, completed = false;
        try {
          result = await pool.generate(task, config, controller.signal, {
            onAcquire: id => { if (!acquired) { armTimer(); acquired = true; } job.accountId = id; job.stage = 'preparing'; job.attempts++; },
            onSubmission: submission => { job.submission = submission; job.stage = submission === 'accepted' ? 'streaming' : 'submitting'; },
          });
          const response = result.response;
          const rawId = response.headers.get('task-id');
          const taskId = rawId && /^[A-Za-z0-9_-]{1,128}$/.test(rawId) ? rawId : null;
          job.taskId = taskId;
          const reader = response.body.getReader();
          try {
            const first = await reader.read();
            if (first.done) throw new GatewayError(502, 'fish_empty_audio', 'Fish 返回了空音频。请检查官网生成历史后再重试。');
            controller.signal.throwIfAborted();
            res.setHeader('Content-Type', FORMATS[task.format]);
            res.setHeader('Content-Disposition', `inline; filename="speech.${task.format}"`);
            res.setHeader('X-Fish-Route', 'web-task');
            if (taskId) res.setHeader('X-Fish-Task-Id', taskId);
            async function* audio() {
              yield first.value;
              while (true) { const chunk = await reader.read(); if (chunk.done) break; yield chunk.value; }
            }
            await pipeline(Readable.from(audio()), res, { signal: controller.signal });
            clearTimeout(timer); completed = true; job.stage = 'completed';
            statistics.completed++;
            statistics.lastTaskId = taskId;
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        } finally { await result?.release(completed); }
        return;
      }
      throw new GatewayError(404, 'not_found', '接口不存在。语音接口为 POST /v1/audio/speech。');
    } catch (original) {
      if (generationRequest) statistics.failed++;
      const error = controller.signal.aborted ? controller.signal.reason : original;
      const status = error instanceof GatewayError ? error.status : 500;
      const code = error instanceof GatewayError ? error.code : 'internal_error';
      const message = error instanceof GatewayError ? error.message : '服务内部错误，请查看本地终端中的请求编号。';
      if (job) { job.stage = ['client_disconnected', 'request_cancelled'].includes(code) ? 'cancelled' : 'failed'; job.errorCode = code; job.errorMessage = message; }
      // Log only a correlation ID and classification: never tokens, text, URLs, or upstream bodies.
      logger(JSON.stringify({ requestId, status, code, ...(job ? { accountId: job.accountId, submission: job.submission } : {}) }));
      if (!res.headersSent && !res.destroyed) {
        if (error.retryAfter) res.setHeader('Retry-After', error.retryAfter);
        if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
        json(res, status, { error: { message, type: code, code, request_id: requestId,
          ...(job ? { submission: job.submission, task_id: job.taskId } : {}) } });
      } else if (!res.writableFinished) res.destroy();
    } finally {
      clearTimeout(timer);
      res.off('close', closed);
      if (job) job.finishedAt = new Date().toISOString();
    }
  });
  server.on('close', () => pool.close());
  return server;
}

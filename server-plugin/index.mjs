import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { request } from 'node:http';
import { basename, dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { outgoingEnvironment, windowsProxy } from './lib/network-proxy.mjs';

export const info = {
  id: 'mirrortranslate-fish',
  name: 'MirrorTranslate Fish',
  description: 'Fish 网页订阅服务',
};

const CHILD = fileURLToPath(new URL('./child.mjs', import.meta.url));
const WINDOWS_NODE = fileURLToPath(new URL('./runtime/node.exe', import.meta.url));
const LOCAL_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const ROUTES = new Map([
  ['GET /settings', '/admin/config'],
  ['POST /settings', '/admin/config'],
  ['GET /accounts', '/admin/accounts'],
  ['POST /accounts', '/admin/accounts'],
  ['POST /accounts/order', '/admin/accounts/order'],
  ['GET /voices', '/admin/voices'],
  ['PATCH /scheduler', '/admin/scheduler'],
  ['GET /tasks', '/admin/tasks'],
  ['POST /speech', '/v1/audio/speech'],
]);

function problem(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function localUserRoot(req) {
  const root = req.user?.directories?.root;
  if (typeof root !== 'string' || !root) throw problem(401, 'login_required', '请登录酒馆。');
  let host;
  let origin;
  try {
    host = new URL(`http://${req.headers.host}`);
    if (req.headers.origin) origin = new URL(req.headers.origin);
  } catch { /* reject below */ }
  if (!host || !LOCAL_ADDRESSES.has(req.socket.remoteAddress) || !LOCAL_HOSTS.has(host.hostname)
    || host.username || host.password || host.pathname !== '/' || host.search || host.hash
    || (req.headers.origin && (!origin || origin.host !== host.host))) {
    throw problem(403, 'local_only', '请用本机地址打开酒馆。');
  }
  // Fish browser profiles belong to one Tavern user but stay outside Tavern's user backup.
  const userDirectory = resolve(root);
  return join(dirname(userDirectory), '.mirrortranslate-fish', basename(userDirectory));
}

function routeFor(method, url) {
  let route = ROUTES.get(`${method} ${url.pathname}`);
  if (!route) {
    const account = url.pathname.match(/^\/accounts\/(?:legacy|[a-f0-9-]{36})(\/(?:login|refresh))?$/);
    const task = url.pathname.match(/^\/tasks\/[a-f0-9-]{36}$/);
    if ((account?.[1] && method === 'POST')
      || (account && !account[1] && ['PATCH', 'DELETE'].includes(method))
      || (task && method === 'DELETE')) route = `/admin${url.pathname}`;
  }
  if (!route) throw problem(404, 'not_found', 'Fish 操作不存在。');
  if (route === '/admin/voices') {
    const query = new URLSearchParams();
    const q = url.searchParams.get('q');
    const accountId = url.searchParams.get('accountId');
    if (q) query.set('q', q.slice(0, 100));
    if (accountId) query.set('accountId', accountId.slice(0, 36));
    if (query.size) route += `?${query}`;
  }
  return route;
}

function requestBody(req, route) {
  if (!['POST', 'PATCH'].includes(req.method)) return undefined;
  const body = req.body ?? {};
  if (typeof body !== 'object' || Array.isArray(body)) throw problem(400, 'invalid_body', 'Fish 设置格式有误。');
  if (route === '/admin/config' && Object.keys(body).some(key => !['backend', 'defaultVoice'].includes(key))) {
    throw problem(400, 'invalid_settings', '这里只能修改 Fish 模型和默认音色。');
  }
  const data = JSON.stringify(body);
  if (Buffer.byteLength(data) > 128 * 1024) throw problem(413, 'body_too_large', '请求太大。');
  return data;
}

export async function launchFish(root) {
  const env = outgoingEnvironment(process.env, await windowsProxy());
  const child = fork(CHILD, [root], {
    execPath: process.platform === 'win32' && existsSync(WINDOWS_NODE) ? WINDOWS_NODE : process.execPath,
    execArgv: [], env, stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true,
  });
  const exited = new Promise(resolveExit => {
    child.once('close', resolveExit);
  });
  const ready = new Promise((resolveReady, reject) => {
    const fail = () => reject(problem(503, 'start_failed', 'Fish 启动失败，请查看酒馆终端。'));
    const timeout = setTimeout(() => {
      fail();
      child.kill();
    }, 25000);
    child.once('error', fail);
    child.once('exit', fail);
    child.once('close', () => {
      clearTimeout(timeout);
      fail();
    });
    child.once('message', message => {
      clearTimeout(timeout);
      if (!Number.isInteger(message?.port) || message.port < 1 || message.port > 65535
        || typeof message.adminToken !== 'string' || typeof message.proxyKey !== 'string') {
        fail();
        child.kill();
        return;
      }
      resolveReady(message);
    });
  });
  return {
    ready, exited,
    async stop() {
      if (child.connected) child.send('stop', () => {});
      const timeout = setTimeout(() => child.kill(), 6000);
      try { await exited; } finally { clearTimeout(timeout); }
    },
  };
}

function privateRequest(service, path, { method, body, signal }) {
  const headers = path === '/v1/audio/speech'
    ? { Authorization: `Bearer ${service.proxyKey}` }
    : { 'X-Admin-Token': service.adminToken };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  return new Promise((resolveResponse, reject) => {
    const outgoing = request({
      host: '127.0.0.1', port: service.port, path, method, headers, signal, agent: false,
    }, resolveResponse);
    outgoing.once('error', reject);
    outgoing.end(body);
  });
}

async function forward(service, route, req, res, send) {
  const body = requestBody(req, route);
  const controller = new AbortController();
  const cancel = () => {
    if (!res.writableFinished) controller.abort();
  };
  res.once('close', cancel);
  try {
    const upstream = await send(service, route, { method: req.method, body, signal: controller.signal });
    if (upstream.statusCode === 401) {
      upstream.resume();
      throw problem(503, 'bridge_auth_failed', '请重启镜译里的 Fish 服务。');
    }
    if (req.method === 'GET' && route === '/admin/config' && upstream.statusCode === 200) {
      const { backend, defaultVoice, models } = JSON.parse(await upstream.setEncoding('utf8').toArray().then(parts => parts.join('')));
      res.json({ backend, defaultVoice, models: models.map(({ id, name }) => ({ id, name })) });
      return;
    }
    res.status(upstream.statusCode);
    for (const header of ['content-type', 'x-fish-task-id', 'x-request-id']) {
      if (upstream.headers[header]) res.set(header, upstream.headers[header]);
    }
    await pipeline(upstream, res, { signal: controller.signal });
  } finally {
    res.off('close', cancel);
  }
}

export function createFishRoutes({ launch = launchFish, send = privateRequest } = {}) {
  const services = new Map();
  let closed = false;

  function start(root) {
    if (closed) throw problem(503, 'shutting_down', '酒馆正在关闭。');
    const current = services.get(root);
    if (current?.stopping) throw problem(409, 'stopping', 'Fish 正在停止。');
    if (current) return current.ready;
    const entry = {};
    services.set(root, entry);
    entry.process = Promise.resolve().then(() => launch(root));
    const forget = () => {
      if (services.get(root) === entry) services.delete(root);
    };
    entry.ready = entry.process.then(async child => {
      void child.exited.then(forget);
      entry.service = await child.ready;
      return entry.service;
    });
    void entry.process.catch(forget);
    return entry.ready;
  }

  function stop(entry) {
    if (!entry) return;
    entry.stopping ??= entry.process.then(child => child.stop(), () => {});
    return entry.stopping;
  }

  return {
    async handle(req, res) {
      res.set('Cache-Control', 'no-store');
      res.set('X-Content-Type-Options', 'nosniff');
      try {
        const root = localUserRoot(req);
        const url = new URL(req.url, 'http://localhost');
        const entry = services.get(root);
        if (req.method === 'GET' && url.pathname === '/state') {
          const status = entry?.stopping ? 'stopping' : entry?.service ? 'running' : entry ? 'starting' : 'stopped';
          return res.json({ service: info.id, status });
        }
        if (req.method === 'POST' && url.pathname === '/service/start') {
          await start(root);
          if (services.get(root)?.stopping) throw problem(409, 'stopping', 'Fish 正在停止。');
          return res.json({ service: info.id, status: 'running' });
        }
        if (req.method === 'POST' && url.pathname === '/service/stop') {
          await stop(entry);
          return res.json({ service: info.id, status: 'stopped' });
        }
        const route = routeFor(req.method, url);
        if (entry?.stopping || !entry?.service) {
          throw problem(503, 'service_stopped', '请在镜译的 Fish 管理页启动服务。');
        }
        await forward(entry.service, route, req, res, send);
      } catch (error) {
        if (res.destroyed) return;
        if (res.headersSent) return res.destroy();
        const status = error.status ?? 502;
        const message = error.status ? error.message : 'Fish 服务连接中断。';
        res.status(status).json({ error: { code: error.code ?? 'bridge_error', message } });
      }
    },
    async close() {
      closed = true;
      await Promise.allSettled([...services.values()].map(stop));
    },
  };
}

const fish = createFishRoutes();
export function init(router) {
  router.use(fish.handle);
}
export function exit() {
  return fish.close();
}

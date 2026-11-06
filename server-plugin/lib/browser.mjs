import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { GatewayError } from './errors.mjs';

const FISH_PAGE = 'https://fish.audio/app/text-to-speech/';
// Public website reCAPTCHA site key, observed in Fish's own frontend on 2026-10-30.
// This runs the ordinary website challenge in the user's browser; failures are not bypassed.
const RECAPTCHA_SITE_KEY = '6LfR4RwqAAAAAEvptRw9zohw7HeDU6NCqtAnJk1i';
const unavailable = () => new GatewayError(503, 'browser_unavailable', '请点击账号旁的“登录”，完成登录并保持专用窗口打开。');

export async function findBrowser() {
  const candidates = [process.env.FISH_BROWSER_PATH,
    process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* next installed browser */ }
  }
  throw new GatewayError(503, 'browser_not_found', '未找到 Edge 或 Chrome，请安装浏览器后重试。');
}

export async function openLocalPage(url) {
  const executable = await findBrowser();
  const child = spawn(executable, [url], { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});
  child.unref();
}

export class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(message.id);
      message.error ? entry.reject(unavailable()) : entry.resolve(message.result);
    });
    socket.addEventListener('close', () => this.failPending());
    socket.addEventListener('error', () => this.failPending());
  }
  failPending() {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(unavailable()); }
    this.pending.clear();
  }
  static async connect(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw unavailable();
    const socket = new WebSocket(url);
    const session = new CdpSession(socket);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(unavailable()); }, 5000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(unavailable()); }, { once: true });
    });
    return session;
  }
  send(method, params = {}, timeout = 20000) {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(unavailable());
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(unavailable()); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, 30000);
    if (result.exceptionDetails) throw new GatewayError(503, 'browser_validation_needed', 'Fish 网页验证未完成。请在专用窗口处理登录或验证提示，再重试。');
    return result.result?.value;
  }
  close() { this.failPending(); this.socket.close(); }
}

export class FishBrowser {
  constructor(dataDir) { this.root = resolve(dataDir); this.profile = join(this.root, 'browser-profile'); this.opening = null; }
  async tabs() {
    try {
      const [portText, expectedBrowserPath] = (await readFile(join(this.profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
      const port = Number(portText);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw unavailable();
      if (!/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(expectedBrowserPath ?? '')) throw unavailable();
      const version = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
      if (!version.ok || new URL((await version.json()).webSocketDebuggerUrl).pathname !== expectedBrowserPath) throw unavailable();
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
      if (!response.ok) throw unavailable();
      return { port, tabs: await response.json() };
    } catch { throw unavailable(); }
  }
  async connect() {
    const { tabs } = await this.tabs();
    const tab = tabs.find(tab => {
      try { return tab.type === 'page' && new URL(tab.url).origin === 'https://fish.audio'; } catch { return false; }
    });
    if (!tab) throw unavailable();
    return CdpSession.connect(tab.webSocketDebuggerUrl);
  }
  async open() {
    if (this.opening) return this.opening;
    this.opening = this.openOnce().finally(() => { this.opening = null; });
    return this.opening;
  }
  async openOnce() {
    try {
      const session = await this.connect();
      try { await session.send('Page.bringToFront'); } finally { session.close(); }
      return;
    } catch { /* start the dedicated profile */ }
    try {
      const { port } = await this.tabs();
      await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(FISH_PAGE)}`, { method: 'PUT', signal: AbortSignal.timeout(5000) });
      return;
    } catch { /* no existing browser */ }
    await mkdir(this.profile, { recursive: true, mode: 0o700 });
    const executable = await findBrowser();
    let spawnError;
    const child = spawn(executable, [
      `--user-data-dir=${this.profile}`, '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--new-window', FISH_PAGE,
    ], { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', error => { spawnError = error; });
    child.unref();
    for (let i = 0; i < 30; i++) {
      if (spawnError) throw unavailable();
      await delay(300);
      try { await this.tabs(); return; } catch { /* browser is starting */ }
    }
    throw unavailable();
  }
  async credentials({ verification = false, signal } = {}) {
    signal?.throwIfAborted();
    const session = await this.connect();
    const abort = () => session.close();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      signal?.throwIfAborted();
      const context = await session.evaluate(`(() => {
        if (location.origin !== 'https://fish.audio') throw new Error('Wrong origin');
        const read = key => localStorage.getItem(key) || document.cookie.split('; ').find(v => v.startsWith(key + '='))?.slice(key.length + 1) || '';
        return { token: read('token'), teamId: read('active_team_id'), workspaceId: read('active_workspace_id'), userAgent: navigator.userAgent };
      })()`);
      if (!context?.token) throw new GatewayError(503, 'fish_login_required', '请先在专用 Fish 窗口登录，再回控制台点击“检查”。');
      if (verification) {
        context.recaptcha = await session.evaluate(`(async () => {
          if (location.origin !== 'https://fish.audio') throw new Error('Wrong origin');
          const key = ${JSON.stringify(RECAPTCHA_SITE_KEY)};
          const ready = async () => {
            if (!window.grecaptcha?.enterprise?.execute) {
              await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                const timer = setTimeout(() => { script.remove(); reject(new Error('Validation load timeout')); }, 10000);
                script.src = 'https://www.recaptcha.net/recaptcha/enterprise.js?render=' + encodeURIComponent(key);
                script.async = true;
                script.onload = () => { clearTimeout(timer); resolve(); };
                script.onerror = () => { clearTimeout(timer); reject(new Error('Validation load failed')); };
                document.head.appendChild(script);
              });
            }
            return await new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('Validation timeout')), 10000);
              window.grecaptcha.enterprise.ready(() => {
                Promise.resolve(window.grecaptcha.enterprise.execute(key, { action: 'playground' }))
                  .then(resolve, reject).finally(() => clearTimeout(timer));
              });
            });
          };
          const result = await ready();
          if (!result || typeof result !== 'string') throw new Error('Validation failed');
          return result;
        })()`);
        const unchanged = await session.evaluate(`(() => {
          if (location.origin !== 'https://fish.audio') return false;
          const read = key => localStorage.getItem(key) || document.cookie.split('; ').find(v => v.startsWith(key + '='))?.slice(key.length + 1) || '';
          return ['token', 'active_team_id', 'active_workspace_id'].map(read);
        })()`);
        if (!Array.isArray(unchanged) || unchanged.some((value, index) => value !== [context.token, context.teamId, context.workspaceId][index])) {
          throw new GatewayError(503, 'fish_session_changed', '登录验证期间账号或团队发生变化，请刷新账号。');
        }
      }
      signal?.throwIfAborted();
      return context;
    } finally {
      signal?.removeEventListener('abort', abort);
      session.close();
    }
  }
  async status() {
    try { await this.credentials(); return { connected: true, loggedIn: true }; }
    catch (error) { return { connected: error.code === 'fish_login_required', loggedIn: false, message: error.message }; }
  }
  async forget() {
    if (this.opening) await this.opening;
    let running = false;
    try { await this.tabs(); running = true; } catch { /* already closed */ }
    if (running) {
      const { port } = await this.tabs();
      const version = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
      const session = await CdpSession.connect((await version.json()).webSocketDebuggerUrl);
      try { await session.send('Browser.close', {}, 2000); } catch { /* close may disconnect before replying */ }
      finally { session.close(); }
      for (let i = 0; i < 30; i++) {
        await delay(100);
        try { await this.tabs(); } catch { running = false; break; }
      }
      if (running) throw new GatewayError(409, 'browser_still_open', '请关闭该账号专用窗口，再删除账号。');
    }
    const target = resolve(this.profile);
    if (target !== join(this.root, 'browser-profile')) throw new Error('Invalid browser profile path');
    await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

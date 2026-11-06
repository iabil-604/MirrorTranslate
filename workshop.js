// 音色工坊：大家把在 Fish Audio 上挑好的音色 ID 存在这里，别人点一下就复制进剪贴板。
//
// 这个模块自己带界面的 HTML（三块：朗读页里的入口栏、工坊页面、盖在窗口上的抽屉和提示），
// 自己管登录、列表、投稿、复制；和 index.js 只有四个接触点，都写在 createWorkshop 的 deps 里：
//   copyText       复制到剪贴板
//   lookupFish     向 Fish 查一个音色（名字、作者、是否私有）
//   addToLibrary   存进本机的「音色库」
//   selectTab      切换到工作区的某一页
//
// 后端是 workshop-worker/ 里的 Cloudflare Worker。部署好以后把它的地址填在下面的 WORKSHOP_API。

// ↓↓↓ 部署完 Worker，把地址填在这里（不带结尾的斜杠），例如 'https://jingyi-voice-workshop.abc.workers.dev'
export const WORKSHOP_API = '';

const SESSION_KEY = 'jingyi.workshop.session.v1';
const API_OVERRIDE_KEY = 'jingyi.workshop.api';   // 调试用：在浏览器控制台 localStorage 里写它，可以临时指向别的后端
const SEEN_KEY = 'jingyi.workshop.seen.v1';
const PAGE_SIZE = 24;
const FISH_ID_RE = /^[A-Za-z0-9_.:@-]{1,128}$/;
const AUTH_VALUE_RE = /^[A-Za-z0-9_-]{32,64}$/;

const LANG_TAGS = { zh: '中', ja: '日', en: 'EN', ko: '韩' };
const FILTERS = [['all', '全部'], ['mine', '我的'], ['zh', '中文'], ['ja', '日语'], ['en', 'English'], ['other', '其他']];
const SUBMIT_LANGS = [['zh', '中文'], ['ja', '日语'], ['en', 'English'], ['ko', '韩语'], ['other', '其他']];

// ───────────────────────── 小工具（不碰 DOM，测试里直接用） ─────────────────────────

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function hash(text) {
  let h = 2166136261;
  for (const char of String(text)) { h ^= char.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 每个音色 ID 一条固定的「声纹」：同一个 ID 永远是同一条波形。
function waveBars(id, count) {
  const random = rng(hash(id));
  let html = '';
  for (let index = 0; index < count; index += 1) {
    const envelope = Math.sin(Math.PI * (index + 0.5) / count);
    const height = 0.2 + 0.8 * Math.pow(random(), 0.75) * (0.4 + 0.6 * envelope);
    html += `<i style="--h:${height.toFixed(2)};--i:${index}"></i>`;
  }
  return `<div class="jy-ws-wave" aria-hidden="true">${html}</div>`;
}

// 没放头像的角色：用名字第一个字做一块色块，颜色由 ID 决定。
function bareCover(name, seed) {
  const random = rng(hash(seed));
  const h1 = Math.floor(random() * 360);
  const h2 = (h1 + 40 + Math.floor(random() * 80)) % 360;
  const char = esc([...String(name || '音')][0] || '音');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 250"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1} 42% 62%)"/><stop offset="1" stop-color="hsl(${h2} 38% 32%)"/></linearGradient></defs><rect width="200" height="250" fill="url(#g)"/><circle cx="${(60 + random() * 80).toFixed(0)}" cy="${(50 + random() * 30).toFixed(0)}" r="${(50 + random() * 30).toFixed(0)}" fill="hsl(${h1} 60% 86%)" opacity=".28"/><text x="100" y="150" font-family="Georgia,serif" font-size="130" text-anchor="middle" fill="#fff" opacity=".5">${char}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// 头像图加载不出来时（Discord 的图床在有些网络下打不开）用名字第一个字画一个。
function avatarFallback(name) {
  const hue = hash(name || '?') % 360;
  const char = esc([...String(name || '?')][0] || '?');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="hsl(${hue} 45% 46%)"/><text x="20" y="27" font-family="system-ui,sans-serif" font-size="20" font-weight="700" text-anchor="middle" fill="#fff">${char}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function formatCount(count) {
  const n = Number(count) || 0;
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
}

function timeAgo(ms, now = Date.now()) {
  const hours = Math.max(0, now - Number(ms)) / 3600000;
  if (hours < 1) return '刚刚';
  if (hours < 24) return `${Math.round(hours)} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

const shortId = id => (String(id).length > 14 ? `${String(id).slice(0, 6)}…${String(id).slice(-4)}` : String(id));

function baseLanguage(code) {
  const base = String(code ?? '').toLowerCase().split(/[-_]/)[0];
  return ['zh', 'ja', 'en', 'ko'].includes(base) ? base : 'other';
}

// 检查音色 ID；返回 { ok, level, text }，level 决定提示的颜色
function judgeVoiceId(value, { fish = null, duplicate = false } = {}) {
  const id = String(value ?? '').trim();
  if (!id) return { ok: false, level: '', text: '填好后可以点「从 Fish 读取」核对。' };
  if (!FISH_ID_RE.test(id)) return { ok: false, level: 'err', text: '只能包含字母、数字和 _ . : @ -' };
  if (duplicate) return { ok: false, level: 'err', text: '工坊里已经有这个音色了，去搜搜看。' };
  if (fish && fish.id === id) {
    if (fish.visibility === 'private') return { ok: false, level: 'err', text: '这个音色在 Fish 上是私有的，别人用不了。' };
    return { ok: true, level: 'ok', text: `✓ 已核对${fish.author ? `：Fish 原作者 ${fish.author}` : ''}` };
  }
  if (!/^[0-9a-f]{32}$/i.test(id)) return { ok: true, level: 'warn', text: '格式可用，但 Fish 的音色 ID 通常是 32 位。' };
  return { ok: true, level: 'ok', text: '✓ 格式正确。可以点「从 Fish 读取」再核对一下。' };
}

function apiBase() {
  let base = WORKSHOP_API;
  try { base = globalThis.localStorage?.getItem(API_OVERRIDE_KEY) || base; } catch { /* 读不了就用默认 */ }
  try {
    const url = new URL(String(base).trim());
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) return '';
    if (url.username || url.password || url.search || url.hash) return '';
    return (url.origin + url.pathname).replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function discordAuthorizeUrl(value, base, state) {
  if (typeof state !== 'string' || !AUTH_VALUE_RE.test(state)) return '';
  try {
    const url = new URL(value);
    return url.origin === 'https://discord.com' && url.pathname === '/oauth2/authorize'
      && !url.username && !url.password && !url.hash && url.searchParams.get('state') === state
      && url.searchParams.get('response_type') === 'code' && url.searchParams.get('scope') === 'identify'
      && url.searchParams.get('redirect_uri') === `${base}/api/auth/callback` ? url.href : '';
  } catch {
    return '';
  }
}

function validSession(value) {
  return typeof value?.token === 'string' && AUTH_VALUE_RE.test(value.token)
    && typeof value.user?.id === 'string' && typeof value.user.name === 'string';
}

function readSession(base = apiBase()) {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(SESSION_KEY) || 'null');
    return base && value?.base === base && validSession(value) ? value : null;
  } catch {
    return null;
  }
}

function writeSession(session) {
  try {
    if (session) globalThis.localStorage?.setItem(SESSION_KEY, JSON.stringify(session));
    else globalThis.localStorage?.removeItem(SESSION_KEY);
  } catch { /* 存不了就只在这次页面里有效 */ }
}

class WorkshopError extends Error {
  constructor(code, message, status = 0, data = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

// ───────────────────────── 界面 HTML ─────────────────────────

const ICON = {
  copy: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></svg>',
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  image: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/></svg>',
  key: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="14" r="4"/><path d="M11 11.5L20 4"/><path d="M16.5 7.5l2.5 2.5"/><path d="M14 10l2 2"/></svg>',
  chat: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H12l-4 3.5V16h-.5A2.5 2.5 0 0 1 5 13.5z"/><path d="M9.5 9.5h.01M14.5 9.5h.01"/></svg>',
};

const entryStack = ['白', '夜', '凛'].map(char => `<img src="${bareCover(char, `entry-${char}`)}" alt="">`).join('');

export const WORKSHOP_ENTRY_MARKUP = `<button type="button" class="jy-ws-entry" data-jy-ws-go="workshop"><span class="jy-ws-stack" aria-hidden="true">${entryStack}</span><span class="jy-ws-entry-text"><strong>进入音色工坊</strong></span></button>`;

export const WORKSHOP_FOLD_MARKUP = `<details class="jy-fold" data-jy-fold="tts-workshop"><summary><h2>音色工坊</h2><span class="jy-ws-new" data-jy-ws-new>NEW</span><span class="jy-fold-summary" data-jy-fold-summary></span></summary><div class="jy-form-body">
${WORKSHOP_ENTRY_MARKUP}

</div></details>`;

export const WORKSHOP_PAGE_MARKUP = `<section class="jy-page jy-ws" data-jy-page="workshop" role="tabpanel" hidden>
<button type="button" class="jy-ws-back" data-jy-ws-go="back">${ICON.back}返回朗读设置</button>
<header class="jy-page-heading jy-ws-headrow"><div><h1>音色工坊</h1></div>
<span class="jy-ws-me-wrap" data-jy-ws-me hidden><button type="button" class="jy-ws-me" data-jy-ws-me-toggle aria-haspopup="true" aria-expanded="false"><img class="jy-ws-av" data-jy-ws-me-avatar data-name="" alt="" referrerpolicy="no-referrer"><span data-jy-ws-me-name></span></button><div class="jy-ws-menu" data-jy-ws-menu hidden><button type="button" data-jy-ws-logout>退出登录</button></div></span></header>
<p class="jy-ws-notice" data-jy-ws-notice hidden></p>
<div data-jy-ws-gate hidden>
<div class="jy-ws-gate-card"><span class="jy-ws-gate-seal" aria-hidden="true">${ICON.key}</span><h2>先登录，再进工坊</h2>
<p class="jy-ws-gate-lead">工坊用 Discord 的 ID、名称和头像确认身份。</p>
<button type="button" class="jy-ws-discord" data-jy-ws-login></button>
<p class="jy-ws-gate-note" data-jy-ws-gate-note></p>
<div class="jy-ws-gate-more" data-jy-ws-gate-more hidden><a data-jy-ws-login-link target="_blank" rel="noopener noreferrer">没弹出页面？点这里打开授权页</a><button type="button" class="jy-text-button" data-jy-ws-login-cancel>取消</button></div></div>
</div>
<div data-jy-ws-main hidden>
<div class="jy-ws-bar"><div class="jy-ws-bar-row"><label class="jy-ws-search">${ICON.search}<input type="search" data-jy-ws-search placeholder="搜角色名、出处、ID" autocomplete="off" spellcheck="false" aria-label="搜索音色"></label><button type="button" class="jy-button jy-button-primary" data-jy-ws-submit-open>${ICON.plus}投稿</button></div>
<div class="jy-ws-chips" data-jy-ws-chips role="group" aria-label="筛选"></div></div>
<div class="jy-ws-meta"><span data-jy-ws-count></span><div class="jy-ws-seg" role="group" aria-label="排序"><button type="button" data-jy-ws-sort="new" aria-pressed="true">最新</button><button type="button" data-jy-ws-sort="hot" aria-pressed="false">最热</button></div></div>
<div data-jy-ws-hero></div>
<div class="jy-ws-grid" data-jy-ws-grid></div>
<div class="jy-ws-more" data-jy-ws-more-row hidden><button type="button" class="jy-button" data-jy-ws-more>加载更多</button></div>
</div>
</section>`;

export const WORKSHOP_LAYER_MARKUP = `<div class="jy-ws-layer" data-jy-ws-layer>
<div class="jy-ws-scrim" data-jy-ws-scrim hidden></div>
<div class="jy-ws-sheet" data-jy-ws-sheet="detail" role="dialog" aria-modal="true" aria-label="音色详情" hidden><div class="jy-ws-grab"></div><div class="jy-ws-sheet-head"><h2>音色详情</h2><button type="button" class="jy-ws-x" data-jy-ws-close aria-label="关闭">×</button></div><div class="jy-ws-sheet-body" data-jy-ws-detail-body></div><div class="jy-ws-sheet-foot" data-jy-ws-detail-foot></div></div>
<div class="jy-ws-sheet" data-jy-ws-sheet="submit" role="dialog" aria-modal="true" aria-label="投稿" hidden><div class="jy-ws-grab"></div>
<div class="jy-ws-sheet-head" data-jy-ws-submit-head><h2>投稿一个声音</h2><button type="button" class="jy-ws-x" data-jy-ws-close aria-label="关闭">×</button></div>
<div class="jy-ws-sheet-body" data-jy-ws-submit-body>
<form class="jy-ws-form" data-jy-ws-form autocomplete="off" novalidate>
<div class="jy-ws-as"><img class="jy-ws-av jy-ws-av-s" data-jy-ws-as-avatar data-name="" alt="" referrerpolicy="no-referrer"><span>以 <b data-jy-ws-as-name></b> 的身份投稿</span></div>
<div class="jy-ws-form-top"><button type="button" class="jy-ws-drop" data-jy-ws-drop aria-label="选择头像"><span data-jy-ws-drop-empty>${ICON.image}选头像<br>（可选）</span><img data-jy-ws-drop-img alt="" hidden></button>
<div><label class="jy-ws-field"><span class="jy-label">角色名</span><input type="text" data-jy-ws-name maxlength="20" placeholder="例如：白露" spellcheck="false"></label>
<label class="jy-ws-field"><span class="jy-label">出处 / 一句话（可选）</span><input type="text" data-jy-ws-src maxlength="30" placeholder="温柔御姐 · 原创" spellcheck="false"></label></div>
<p class="jy-ws-drop-note" data-jy-ws-drop-note></p></div>
<div class="jy-ws-field"><span class="jy-label">语言</span><div class="jy-ws-langs" data-jy-ws-langs role="radiogroup" aria-label="语言"></div></div>
<div class="jy-ws-field"><label class="jy-label" for="jy-ws-voice-id">Fish 音色 ID</label><input type="text" id="jy-ws-voice-id" class="jy-ws-mono" data-jy-ws-voice-id placeholder="Fish 音色页地址栏里那串" spellcheck="false" autocapitalize="off">
<div class="jy-ws-idfoot"><p class="jy-ws-hint" data-jy-ws-hint></p><button type="button" class="jy-ws-linkbtn" data-jy-ws-lookup disabled>从 Fish 读取</button></div></div>
<label class="jy-ws-check"><input type="checkbox" data-jy-ws-confirm><span>我确认这是 Fish 上公开的音色<small>请勿投稿未经同意的真人声音克隆。</small></span></label>
</form><input type="file" accept="image/*" data-jy-ws-file hidden></div>
<div class="jy-ws-sheet-foot" data-jy-ws-submit-foot><button type="button" class="jy-button" data-jy-ws-close>取消</button><button type="button" class="jy-button jy-button-primary" data-jy-ws-submit disabled>发布到工坊</button></div></div>
<div class="jy-ws-toast" data-jy-ws-toast role="status" aria-live="polite"></div>
</div>`;

// ───────────────────────── 控制器 ─────────────────────────

export function createWorkshop(root, deps = {}) {
  const page = root.querySelector('[data-jy-page="workshop"]');
  const layer = root.querySelector('[data-jy-ws-layer]');
  if (!page || !layer) return { cleanup() {}, handleEscape: () => false, activeSheet: () => null, onSelect() {} };

  const $ = selector => root.querySelector(selector);
  const doc = root.ownerDocument;
  const base = apiBase();
  const timers = new Set();
  let disposed = false;

  const state = {
    session: readSession(base),
    filter: 'all', query: '', sort: 'new',
    items: [], hero: null, counts: null, hasMore: false, page: 1,
    status: 'idle', error: '', requestId: 0, loadedAt: 0,
    detail: null, copied: new Set(),
  };
  const login = { controller: null, url: '', wake: null };
  const form = { lang: 'zh', langTouched: false, cover: null, coverKB: 0, fish: null, duplicate: false, busy: false };
  let openSheet = null;
  let lastFocus = null;
  let entryButton = null;

  const later = (fn, ms) => {
    if (disposed) return null;
    const id = setTimeout(() => { timers.delete(id); if (!disposed) fn(); }, ms);
    timers.add(id);
    return id;
  };

  // ── 请求 ──
  async function api(path, { method = 'GET', body, auth = true, signal } = {}) {
    if (!base) throw new WorkshopError('not_configured', '工坊的服务器地址还没有设置。');
    const session = auth ? state.session : null;
    const headers = {};
    if (session) headers.authorization = `Bearer ${session.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response;
    try {
      response = await fetch(base + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store', credentials: 'omit', redirect: 'error', signal,
      });
    } catch (error) {
      const failure = new WorkshopError('network', '连不上工坊服务器，检查网络后再试。');
      failure.cause = error;
      throw failure;
    }
    const data = await response.json().catch(() => null);
    if (response.status === 401 && session && state.session === session && !disposed) dropSession('登录已经失效，请重新登录。');
    if (!response.ok || data?.ok !== true) {
      throw new WorkshopError(data?.error || `http_${response.status}`, data?.message || '工坊服务器没有返回预期的响应。', response.status, data);
    }
    return data;
  }

  // ── 提示 ──
  function toast(message) {
    const element = $('[data-jy-ws-toast]');
    element.textContent = message;
    element.classList.toggle('is-raised', Boolean(openSheet));
    element.classList.add('is-on');
    clearTimeout(toast.timer);
    toast.timer = later(() => element.classList.remove('is-on'), 2300);
  }

  function updateSummary() {
    const target = $('[data-jy-fold="tts-workshop"] [data-jy-fold-summary]');
    if (target) target.textContent = state.session ? `已登录 · ${state.session.user.name}` : base ? '需要 Discord 登录' : '敬请期待';
    const tag = $('[data-jy-ws-new]');
    if (tag) {
      let seen = false;
      try { seen = globalThis.localStorage?.getItem(SEEN_KEY) === '1'; } catch { /* ignore */ }
      tag.hidden = seen;
    }
  }

  // ── 登录 ──
  function dropSession(message) {
    state.session = null;
    writeSession(null);
    state.requestId += 1;
    state.copied.clear();
    state.items = []; state.hero = null; state.counts = null; state.status = 'idle';
    closeSheet(true);
    showView();
    if (message) $('[data-jy-ws-gate-note]').textContent = message;
    updateSummary();
  }

  function gateButton() {
    const button = $('[data-jy-ws-login]');
    button.disabled = Boolean(login.controller) || !base;
    button.innerHTML = login.controller
      ? '<span class="jy-ws-spin"></span><span>等待 Discord 授权…</span>'
      : `${ICON.chat}<span>使用 Discord 登录</span>`;
    $('[data-jy-ws-gate-more]').hidden = !login.controller || !login.url;
    const link = $('[data-jy-ws-login-link]');
    if (login.url) link.href = login.url;
    else link.removeAttribute('href');
  }

  function resetLogin() {
    login.controller?.abort();
    login.controller = null;
    login.url = '';
    login.wake?.();
  }

  function failLogin(message) {
    resetLogin();
    gateButton();
    $('[data-jy-ws-gate-note]').textContent = message;
  }

  function cancelLogin() {
    resetLogin();
    gateButton();
    $('[data-jy-ws-gate-note]').textContent = '请在 Discord 完成授权。';
  }

  async function startLogin() {
    if (login.controller || !base) return;
    const controller = new AbortController();
    const { signal } = controller;
    login.controller = controller;
    $('[data-jy-ws-gate-note]').textContent = '正在连接工坊…';
    gateButton();
    try {
      const start = await api('/api/auth/start', { method: 'POST', auth: false, signal });
      if (signal.aborted) return;
      login.url = discordAuthorizeUrl(start.url, base, start.state);
      if (!login.url) throw new WorkshopError('bad_auth_url', '工坊返回的 Discord 授权地址无效。');
      const deadline = Date.now() + (Number(start.expiresIn) || 600) * 1000;
      gateButton();
      $('[data-jy-ws-gate-note]').textContent = '在新打开的页面里点「授权」，回到这里会自动继续。';
      try { globalThis.open?.(login.url, '_blank', 'noopener,noreferrer'); } catch { /* 使用手动打开链接 */ }
      void pollLogin(start.state, signal, deadline);
    } catch (error) {
      if (!signal.aborted) failLogin(error.message);
    }
  }

  async function pollLogin(current, signal, deadline) {
    let failures = 0;
    while (!signal.aborted && Date.now() < deadline) {
      await new Promise(resolve => {
        const wake = () => {
          clearTimeout(timer);
          timers.delete(timer);
          login.wake = null;
          resolve();
        };
        const timer = later(wake, Math.min(2000, Math.max(0, deadline - Date.now())));
        login.wake = wake;
      });
      if (signal.aborted) return;
      if (Date.now() >= deadline) break;
      try {
        const result = await api(`/api/auth/poll?state=${encodeURIComponent(current)}`, { auth: false, signal });
        if (signal.aborted) return;
        failures = 0;
        if (result.status === 'done') {
          const session = { base, token: result.token, user: result.user };
          if (!validSession(session)) { failLogin('工坊返回的登录凭证无效。'); return; }
          state.session = session;
          writeSession(state.session);
          resetLogin();
          showView(); updateSummary(); void reload();
          toast(`已登录 · ${result.user.name}`);
          return;
        }
      } catch (error) {
        if (signal.aborted) return;
        if (error.status === 410) { failLogin('这次登录超时了，请重新开始。'); return; }
        if (error.status === 403) { failLogin(error.message); return; }
        failures += 1;
        if (failures >= 8) { failLogin('连不上工坊服务器，检查网络后再试。'); return; }
      }
    }
    if (!signal.aborted) failLogin('等得太久了，这次登录已经过期，请重新开始。');
  }

  const onVisible = () => { if (doc.visibilityState === 'visible') login.wake?.(); };
  doc.addEventListener('visibilitychange', onVisible);

  // ── 视图 ──
  function showView() {
    const configured = Boolean(base);
    const notice = $('[data-jy-ws-notice]');
    notice.hidden = configured;
    if (!configured) notice.textContent = '敬请期待';
    const loggedIn = Boolean(state.session);
    $('[data-jy-ws-gate]').hidden = !configured || loggedIn;
    $('[data-jy-ws-main]').hidden = !loggedIn;
    const me = $('[data-jy-ws-me]');
    me.hidden = !loggedIn;
    $('[data-jy-ws-menu]').hidden = true;
    if (loggedIn) {
      const meAvatar = $('[data-jy-ws-me-avatar]');
      meAvatar.dataset.name = state.session.user.name; delete meAvatar.dataset.fallback;
      meAvatar.src = state.session.user.avatar || avatarFallback(state.session.user.name);
      $('[data-jy-ws-me-name]').textContent = state.session.user.name;
    } else {
      gateButton();
      const gateNote = $('[data-jy-ws-gate-note]');
      if (!gateNote.textContent) gateNote.textContent = '请在 Discord 完成授权。';
    }
  }

  // ── 列表 ──
  function query(pageNumber) {
    const params = new URLSearchParams({ sort: state.sort, page: String(pageNumber), limit: String(PAGE_SIZE) });
    if (state.filter === 'mine') params.set('mine', '1');
    else if (state.filter !== 'all') params.set('lang', state.filter);
    if (state.query.trim()) params.set('q', state.query.trim());
    return `/api/voices?${params}`;
  }

  async function reload() {
    if (!state.session) return;
    const id = ++state.requestId;
    state.status = 'loading'; state.error = ''; state.page = 1;
    renderList();
    try {
      const data = await api(query(1));
      if (id !== state.requestId || disposed) return;
      state.items = data.items ?? [];
      state.hero = data.hero ?? null;
      if (data.counts) state.counts = data.counts;
      state.hasMore = Boolean(data.hasMore);
      state.status = 'ready'; state.loadedAt = Date.now();
    } catch (error) {
      if (id !== state.requestId || disposed) return;
      state.status = 'error'; state.error = error.message;
    }
    renderList();
  }

  async function loadMore() {
    if (state.status !== 'ready' || !state.hasMore) return;
    const id = ++state.requestId;
    const button = $('[data-jy-ws-more]');
    button.disabled = true;
    try {
      const data = await api(query(state.page + 1));
      if (id !== state.requestId || disposed) return;
      const seen = new Set(state.items.map(item => item.id));
      state.items.push(...(data.items ?? []).filter(item => !seen.has(item.id)));
      state.page += 1; state.hasMore = Boolean(data.hasMore);
    } catch (error) {
      toast(error.message);
    }
    button.disabled = false;
    renderList();
  }

  function renderChips() {
    const counts = state.counts;
    $('[data-jy-ws-chips]').innerHTML = FILTERS.map(([key, label]) => {
      const number = counts ? counts[key === 'all' ? 'all' : key] : null;
      return `<button type="button" class="jy-ws-chip" data-jy-ws-filter="${key}" aria-pressed="${state.filter === key}">${label}${number == null ? '' : `<small>${number}</small>`}</button>`;
    }).join('');
  }

  function cardHtml(voice, { hero = false, n = 0 } = {}) {
    const cover = esc(voice.cover || bareCover(voice.name, voice.fishId));
    const hidden = voice.status === 'hidden';
    const tags = `<div class="jy-ws-tags"><span class="jy-ws-tag">${LANG_TAGS[voice.lang] || '其'}</span>${hidden ? '<span class="jy-ws-tag is-warn">已隐藏</span>' : (Date.now() - voice.createdAt < 86400000 ? '<span class="jy-ws-tag is-hot">新</span>' : '')}</div>`;
    const media = `<button type="button" class="jy-ws-open jy-ws-media" data-jy-ws-open aria-label="查看 ${esc(voice.name)}"><img src="${cover}" alt="" loading="lazy" data-name="${esc(voice.name)}" data-seed="${esc(voice.fishId)}">${tags}${waveBars(voice.fishId, hero ? 20 : 26)}</button>`;
    const stub = `<button type="button" class="jy-ws-stub" data-jy-ws-copy aria-label="复制 ${esc(voice.name)} 的音色 ID"><code>${esc(shortId(voice.fishId))}</code><span class="jy-ws-copy">${ICON.copy}复制</span></button>`;
    if (hero) {
      return `<article class="jy-ws-card is-hero" data-jy-ws-card="${esc(voice.id)}">${media}<div class="jy-ws-side"><button type="button" class="jy-ws-open jy-ws-body" data-jy-ws-open><span class="jy-ws-eyebrow">最多人复制</span><span class="jy-ws-name">${esc(voice.name)}</span><span class="jy-ws-src">${esc(voice.src)}</span><span class="jy-ws-hot">${ICON.copy}<b data-jy-ws-count-of="${esc(voice.id)}">${formatCount(voice.copies)}</b> 人复制</span></button>${stub}</div></article>`;
    }
    return `<article class="jy-ws-card${hidden ? ' is-hidden' : ''}" data-jy-ws-card="${esc(voice.id)}" style="--n:${Math.min(n, 10)}">${media}<button type="button" class="jy-ws-open jy-ws-body" data-jy-ws-open><span class="jy-ws-name">${esc(voice.name)}</span><span class="jy-ws-src">${esc(voice.src || '')}</span></button>${stub}</article>`;
  }

  function renderList() {
    renderChips();
    const grid = $('[data-jy-ws-grid]');
    const heroBox = $('[data-jy-ws-hero]');
    const moreRow = $('[data-jy-ws-more-row]');
    const count = $('[data-jy-ws-count]');
    moreRow.hidden = true;
    if (state.status === 'loading' && !state.items.length) {
      heroBox.innerHTML = '';
      grid.innerHTML = Array.from({ length: 4 }, () => '<div class="jy-ws-skel" aria-hidden="true"></div>').join('');
      count.textContent = '正在读取…';
      return;
    }
    if (state.status === 'error') {
      heroBox.innerHTML = '';
      grid.innerHTML = `<div class="jy-ws-empty"><strong>读取失败</strong>${esc(state.error)}<br><button type="button" class="jy-button" data-jy-ws-retry>重试</button></div>`;
      count.textContent = '';
      return;
    }
    const hero = state.hero;
    const rest = state.items.filter(item => !hero || item.id !== hero.id);
    heroBox.innerHTML = hero ? cardHtml(hero, { hero: true }) : '';
    if (!rest.length && !hero) {
      const searching = state.query.trim() || !['all'].includes(state.filter);
      const mine = state.filter === 'mine' && !state.query.trim();
      grid.innerHTML = `<div class="jy-ws-empty"><strong>${mine ? '还没有投稿' : searching ? '没有找到' : '工坊还是空的'}</strong><br><button type="button" class="jy-button jy-button-primary" data-jy-ws-submit-open>去投稿</button></div>`;
      count.textContent = '';
      return;
    }
    grid.innerHTML = rest.map((item, index) => cardHtml(item, { n: index })).join('');
    const total = state.counts ? (state.filter === 'all' ? state.counts.all : state.counts[state.filter]) : null;
    count.textContent = `${state.query.trim() && total != null ? state.items.length : (total ?? state.items.length)} 位角色`;
    moreRow.hidden = !state.hasMore;
  }

  // ── 复制 ──
  async function copyId(text) {
    try {
      await deps.copyText(text);
      return true;
    } catch {
      try {
        const area = doc.createElement('textarea');
        area.value = text; area.setAttribute('readonly', '');
        area.style.cssText = 'position:fixed;left:-9999px;top:0;';
        doc.body.appendChild(area); area.select();
        const ok = Boolean(doc.execCommand?.('copy'));
        area.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  function findVoice(id) {
    return state.items.find(item => item.id === id) || (state.hero?.id === id ? state.hero : null) || (state.detail?.id === id ? state.detail : null);
  }

  async function copyVoice(voice, card) {
    const copying = copyId(voice.fishId);        // 同步发起：还在用户这一下点击里
    const ok = await copying;
    if (!ok) { toast('复制没成功，点开详情，长按 ID 手动选择'); return; }
    if (card) {
      card.classList.add('is-copied');
      card.querySelectorAll('.jy-ws-seal').forEach(node => node.remove());
      const seal = doc.createElement('span');
      seal.className = 'jy-ws-seal'; seal.textContent = '已复制';
      card.querySelector('.jy-ws-media')?.appendChild(seal);
      const label = card.querySelector('.jy-ws-copy');
      if (label) label.innerHTML = `${ICON.copy}已复制`;
      clearTimeout(card._jyWsTimer);
      card._jyWsTimer = setTimeout(() => {
        card.classList.remove('is-copied'); seal.remove();
        if (label) label.innerHTML = `${ICON.copy}复制`;
      }, 1700);
      timers.add(card._jyWsTimer);
    }
    toast('已复制，去「音色」里粘贴');
    if (!state.copied.has(voice.id)) {
      state.copied.add(voice.id);
      try {
        const result = await api(`/api/voices/${encodeURIComponent(voice.id)}/copy`, { method: 'POST' });
        voice.copies = result.copies;
        root.querySelectorAll(`[data-jy-ws-count-of="${CSS.escape(voice.id)}"]`).forEach(node => { node.textContent = formatCount(result.copies); });
        const detailCount = $('[data-jy-ws-detail-count]');
        if (detailCount && state.detail?.id === voice.id) detailCount.textContent = formatCount(result.copies);
      } catch { /* 统计失败不影响已经复制好的 ID */ }
    }
  }

  // ── 抽屉 ──
  const activeSheet = () => openSheet ? $(`[data-jy-ws-sheet="${openSheet}"]`) : null;

  function showSheet(name) {
    closeSheet(true);
    lastFocus = root.getRootNode().activeElement ?? doc.activeElement;
    const sheet = $(`[data-jy-ws-sheet="${name}"]`);
    const scrim = $('[data-jy-ws-scrim]');
    sheet.inert = false;
    sheet.hidden = false; scrim.hidden = false;
    void sheet.offsetWidth;
    sheet.classList.add('is-open'); scrim.classList.add('is-open');
    openSheet = name;
    $('[data-jy-ws-toast]').classList.remove('is-on');
    sheet.querySelector('.jy-ws-x, .jy-button-primary')?.focus({ preventScroll: true });
  }

  function closeSheet(immediate = false) {
    if (!openSheet) return false;
    const name = openSheet;
    const sheet = activeSheet();
    const scrim = $('[data-jy-ws-scrim]');
    sheet.classList.remove('is-open'); scrim.classList.remove('is-open');
    sheet.inert = true;
    openSheet = null;
    const done = () => {
      if (openSheet !== name) sheet.hidden = true;
      if (!openSheet) scrim.hidden = true;
    };
    if (immediate) done();
    else later(done, 230);
    $('[data-jy-ws-toast]').classList.remove('is-on');
    if (!immediate && lastFocus?.isConnected) lastFocus.focus?.({ preventScroll: true });
    return true;
  }

  function openDetail(voice) {
    state.detail = voice;
    const cover = esc(voice.cover || bareCover(voice.name, voice.fishId));
    $('[data-jy-ws-detail-body]').innerHTML = `
<div class="jy-ws-d-media"><img src="${cover}" alt="" data-name="${esc(voice.name)}" data-seed="${esc(voice.fishId)}"><div class="jy-ws-tags"><span class="jy-ws-tag">${LANG_TAGS[voice.lang] || '其'}</span></div>${waveBars(voice.fishId, 34)}</div>
<div class="jy-ws-d-head"><h2>${esc(voice.name)}</h2><p>${esc(voice.src || '')}</p></div>
<dl class="jy-ws-facts"><div><dt>投稿人</dt><dd class="jy-ws-by"><img class="jy-ws-av jy-ws-av-s" src="${esc(voice.by?.avatar)}" alt="" referrerpolicy="no-referrer" data-name="${esc(voice.by?.name)}"><span>${esc(voice.by?.name)}</span></dd></div><div><dt>时间</dt><dd>${timeAgo(voice.createdAt)}</dd></div><div><dt>被复制</dt><dd><b data-jy-ws-detail-count>${formatCount(voice.copies)}</b> 人</dd></div></dl>
<div class="jy-ws-idbox"><span class="jy-label">Fish 音色 ID</span><code>${esc(voice.fishId)}</code>${voice.fishBy ? `<span class="jy-ws-fishby">Fish 上的原作者：${esc(voice.fishBy)}</span>` : ''}</div>

<p class="jy-ws-danger">${voice.mine ? '<button type="button" class="jy-text-button" data-jy-ws-delete>删除这条投稿</button>' : '<button type="button" class="jy-text-button" data-jy-ws-report>举报</button>'}</p>`;
    $('[data-jy-ws-detail-foot]').innerHTML = `<button type="button" class="jy-button" data-jy-ws-library>存进音色库</button><button type="button" class="jy-button jy-button-primary" data-jy-ws-detail-copy>${ICON.copy}复制音色 ID</button>`;
    showSheet('detail');
  }

  // ── 投稿 ──
  function fillSubmitHeader() {
    const user = state.session?.user;
    if (!user) return;
    const asAvatar = $('[data-jy-ws-as-avatar]');
    asAvatar.dataset.name = user.name; delete asAvatar.dataset.fallback;
    asAvatar.src = user.avatar || avatarFallback(user.name);
    $('[data-jy-ws-as-name]').textContent = user.name;
  }

  function renderSubmitLangs() {
    $('[data-jy-ws-langs]').innerHTML = SUBMIT_LANGS.map(([key, label]) => `<button type="button" class="jy-ws-chip" role="radio" data-jy-ws-form-lang="${key}" aria-checked="${form.lang === key}">${label}</button>`).join('');
  }

  function submitFields() {
    return {
      name: $('[data-jy-ws-name]'), src: $('[data-jy-ws-src]'), id: $('[data-jy-ws-voice-id]'),
      confirm: $('[data-jy-ws-confirm]'), hint: $('[data-jy-ws-hint]'), lookup: $('[data-jy-ws-lookup]'),
      submit: $('[data-jy-ws-submit]'), drop: $('[data-jy-ws-drop-img]'), dropEmpty: $('[data-jy-ws-drop-empty]'), note: $('[data-jy-ws-drop-note]'),
    };
  }

  function validateSubmit() {
    const f = submitFields();
    const verdict = judgeVoiceId(f.id.value, { fish: form.fish, duplicate: form.duplicate });
    f.hint.dataset.level = verdict.level;
    f.hint.textContent = verdict.text;
    const already = form.fish && form.fish.id === f.id.value.trim();
    f.lookup.disabled = !verdict.ok || Boolean(already) || form.busy;
    f.submit.disabled = form.busy || !(f.name.value.trim() && verdict.ok && f.confirm.checked);
    return verdict;
  }

  function resetSubmit() {
    root.querySelector('[data-jy-ws-done-foot]')?.remove();
    const body = $('[data-jy-ws-submit-body]');
    const formElement = $('[data-jy-ws-form]') || form.element;
    const file = $('[data-jy-ws-file]') || form.file;
    form.element = formElement; form.file = file;
    body.replaceChildren(formElement, file);
    formElement.reset();
    Object.assign(form, { lang: 'zh', langTouched: false, cover: null, coverKB: 0, fish: null, duplicate: false, busy: false });
    const f = submitFields();
    f.drop.hidden = true; f.drop.removeAttribute('src'); f.dropEmpty.hidden = false;
    f.note.textContent = '';
    $('[data-jy-ws-submit-head]').hidden = false;
    $('[data-jy-ws-submit-foot]').hidden = false;
    f.submit.textContent = '发布到工坊';
    renderSubmitLangs(); fillSubmitHeader(); validateSubmit();
  }

  function openSubmit() {
    if (!form.element) { form.element = $('[data-jy-ws-form]'); form.file = $('[data-jy-ws-file]'); resetSubmit(); }
    else if (!form.element.isConnected) resetSubmit();
    fillSubmitHeader();
    showSheet('submit');
  }

  async function compressCover(file) {
    if (!/^image\//.test(file.type)) throw new Error('请选择一张图片。');
    if (file.size > 12 * 1024 * 1024) throw new Error('图片太大了（超过 12 MB），换一张小点的。');
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
      const width = 320; const height = 400; const target = width / height;
      let sw = image.naturalWidth; let sh = image.naturalHeight;
      if (sw / sh > target) sw = sh * target; else sh = sw / target;
      const canvas = doc.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, 0, 0, width, height);
      for (const quality of [0.82, 0.68, 0.5]) {
        let data = canvas.toDataURL('image/webp', quality);
        if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', quality);
        if (data.length * 0.75 <= 90 * 1024) return data;
      }
      throw new Error('这张图压缩后还是太大，换一张简单点的。');
    } catch (error) {
      if (error instanceof Error && error.message) throw error;
      throw new Error('这张图片读不出来，换一张试试。');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function chooseCover(file) {
    const f = submitFields();
    try {
      const data = await compressCover(file);
      form.cover = data; form.coverKB = Math.max(1, Math.round(data.length * 0.75 / 1024));
      f.drop.src = data; f.drop.hidden = false; f.dropEmpty.hidden = true;
      f.note.textContent = `已压缩为 320×400 · 约 ${form.coverKB} KB，点头像可以更换。`;
    } catch (error) {
      f.note.textContent = error.message;
    }
  }

  async function lookupFish() {
    const f = submitFields();
    const id = f.id.value.trim();
    if (form.busy || !deps.lookupFish || !judgeVoiceId(id).ok) return;
    form.busy = true; f.lookup.disabled = true;
    f.hint.dataset.level = ''; f.hint.textContent = '正在向 Fish 查询…';
    try {
      const info = await deps.lookupFish(id);
      if (disposed) return;
      form.busy = false;
      if (f.id.value.trim() !== id) { validateSubmit(); return; }
      form.fish = { id, title: info.title || '', author: info.author || '', visibility: info.visibility || '', languages: info.languages || [] };
      if (form.fish.visibility !== 'private') {
        if (!f.name.value.trim() && form.fish.title) f.name.value = form.fish.title.slice(0, 20);
        if (!form.langTouched && form.fish.languages.length) { form.lang = baseLanguage(form.fish.languages[0]); renderSubmitLangs(); }
      }
    } catch (error) {
      if (disposed) return;
      form.busy = false;
      validateSubmit();
      if (f.id.value.trim() !== id) return;
      f.hint.dataset.level = 'warn';
      f.hint.textContent = `读取失败：${error.message || error}`;
      return;
    }
    form.busy = false;
    validateSubmit();
  }

  async function sendSubmit() {
    const f = submitFields();
    validateSubmit();
    if (f.submit.disabled) return;
    form.busy = true; f.submit.disabled = true; f.submit.textContent = '发布中…';
    const id = f.id.value.trim();
    try {
      const result = await api('/api/voices', {
        method: 'POST',
        body: {
          name: f.name.value.trim(), src: f.src.value.trim(), lang: form.lang, fishId: id,
          fishBy: form.fish && form.fish.id === id ? form.fish.author : '',
          cover: form.cover || undefined,
        },
      });
      form.busy = false;
      state.filter = 'all'; state.query = ''; $('[data-jy-ws-search]').value = '';
      void reload();
      $('[data-jy-ws-submit-body]').innerHTML = `<div class="jy-ws-done"><span class="jy-ws-seal">已发布</span><h2>${esc(result.voice.name)}</h2></div>`;
      $('[data-jy-ws-submit-head]').hidden = true;
      $('[data-jy-ws-submit-foot]').hidden = true;
      const foot = doc.createElement('div');
      foot.className = 'jy-ws-sheet-foot'; foot.dataset.jyWsDoneFoot = '';
      foot.innerHTML = '<button type="button" class="jy-button jy-button-primary" data-jy-ws-close>完成</button>';
      $('[data-jy-ws-sheet="submit"]').appendChild(foot);
    } catch (error) {
      form.busy = false;
      f.submit.textContent = '发布到工坊';
      if (error.code === 'duplicate') {
        form.duplicate = true;
        validateSubmit();
        f.hint.innerHTML = '工坊里已经有这个音色了。<button type="button" class="jy-ws-linkbtn" data-jy-ws-find-existing>去看看</button>';
      } else {
        validateSubmit();
        f.hint.dataset.level = 'err';
        f.hint.textContent = error.message;
      }
    }
  }

  // ── 详情里的操作 ──
  const armed = new WeakMap();
  function twoStep(button, armedLabel, action) {
    if (!armed.get(button)) {
      const original = button.textContent;
      armed.set(button, true);
      button.textContent = armedLabel; button.classList.add('is-armed');
      later(() => { armed.delete(button); if (button.isConnected) { button.textContent = original; button.classList.remove('is-armed'); } }, 3000);
      return;
    }
    action();
  }

  async function deleteVoice(voice) {
    try {
      await api(`/api/voices/${encodeURIComponent(voice.id)}`, { method: 'DELETE' });
      closeSheet();
      state.items = state.items.filter(item => item.id !== voice.id);
      if (state.hero?.id === voice.id) state.hero = null;
      toast('已删除');
      void reload();
    } catch (error) { toast(error.message); }
  }

  async function reportVoice(voice) {
    try {
      const result = await api(`/api/voices/${encodeURIComponent(voice.id)}/report`, { method: 'POST', body: { reason: 'user' } });
      closeSheet();
      toast(result.hidden ? '已举报，这条已被隐藏' : '已举报，谢谢');
      if (result.hidden) { state.items = state.items.filter(item => item.id !== voice.id); if (state.hero?.id === voice.id) state.hero = null; renderList(); }
    } catch (error) { toast(error.message); }
  }

  // ── 事件 ──
  function goTo(target, button) {
    deps.selectTab?.(target);
    if (target === 'workshop') {
      entryButton = button;
      $('[data-jy-ws-go="back"]')?.focus({ preventScroll: true });
    } else if (target === 'back') {
      entryButton?.focus({ preventScroll: true });
      entryButton = null;
    }
  }

  const onClick = event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const closest = selector => target.closest(selector);

    const go = closest('[data-jy-ws-go]');
    if (go) { goTo(go.dataset.jyWsGo, go); return; }
    if (closest('[data-jy-ws-login]')) { void startLogin(); return; }
    if (closest('[data-jy-ws-login-cancel]')) { cancelLogin(); return; }
    if (closest('[data-jy-ws-me-toggle]')) {
      const menu = $('[data-jy-ws-menu]'); menu.hidden = !menu.hidden;
      $('[data-jy-ws-me-toggle]').setAttribute('aria-expanded', String(!menu.hidden));
      return;
    }
    if (!closest('[data-jy-ws-me]')) { const menu = $('[data-jy-ws-menu]'); if (menu && !menu.hidden) menu.hidden = true; }
    if (closest('[data-jy-ws-logout]')) {
      if (state.session) void api('/api/auth/logout', { method: 'POST' }).catch(() => {});
      state.filter = 'all'; state.query = ''; $('[data-jy-ws-search]').value = '';
      dropSession('');
      $('[data-jy-ws-gate-note]').textContent = '请在 Discord 完成授权。';
      return;
    }
    if (closest('[data-jy-ws-retry]')) { void reload(); return; }
    const filter = closest('[data-jy-ws-filter]');
    if (filter) { state.filter = filter.dataset.jyWsFilter; void reload(); return; }
    const sort = closest('[data-jy-ws-sort]');
    if (sort) {
      state.sort = sort.dataset.jyWsSort;
      root.querySelectorAll('[data-jy-ws-sort]').forEach(button => button.setAttribute('aria-pressed', String(button === sort)));
      void reload(); return;
    }
    if (closest('[data-jy-ws-more]')) { void loadMore(); return; }
    if (closest('[data-jy-ws-submit-open]')) { openSubmit(); return; }

    const card = closest('[data-jy-ws-card]');
    if (card) {
      const voice = findVoice(card.dataset.jyWsCard);
      if (!voice) return;
      if (closest('[data-jy-ws-copy]')) void copyVoice(voice, card);
      else if (closest('[data-jy-ws-open]')) openDetail(voice);
      return;
    }
    if (closest('[data-jy-ws-detail-copy]') && state.detail) {
      const voice = state.detail;
      void copyVoice(voice, root.querySelector(`[data-jy-ws-card="${CSS.escape(voice.id)}"]`));
      return;
    }
    if (closest('[data-jy-ws-library]') && state.detail && deps.addToLibrary) {
      const voice = state.detail;
      try {
        const result = deps.addToLibrary({ name: voice.name, voiceId: voice.fishId, lang: voice.lang === 'other' ? '' : voice.lang, title: voice.src || '' });
        toast(result?.added === false ? '音色库里已经有这个音色了' : '已存进音色库');
      } catch (error) { toast(error?.message || '没能存进音色库'); }
      return;
    }
    const del = closest('[data-jy-ws-delete]');
    if (del && state.detail) { twoStep(del, '再点一次，确认删除', () => void deleteVoice(state.detail)); return; }
    const report = closest('[data-jy-ws-report]');
    if (report && state.detail) { twoStep(report, '再点一次，确认举报', () => void reportVoice(state.detail)); return; }

    if (closest('[data-jy-ws-close]') || closest('[data-jy-ws-scrim]')) { closeSheet(); return; }
    const formLang = closest('[data-jy-ws-form-lang]');
    if (formLang) { form.lang = formLang.dataset.jyWsFormLang; form.langTouched = true; renderSubmitLangs(); return; }
    if (closest('[data-jy-ws-drop]')) { $('[data-jy-ws-file]').click(); return; }
    if (closest('[data-jy-ws-lookup]')) { void lookupFish(); return; }
    if (closest('[data-jy-ws-submit]')) { void sendSubmit(); return; }
    if (closest('[data-jy-ws-find-existing]')) {
      const id = submitFields().id.value.trim();
      closeSheet();
      state.filter = 'all'; state.query = id; $('[data-jy-ws-search]').value = id;
      void reload();
    }
  };

  const onInput = event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches('[data-jy-ws-search]')) {
      state.query = target.value;
      clearTimeout(onInput.timer);
      onInput.timer = later(() => void reload(), 300);
      return;
    }
    if (target.matches('[data-jy-ws-form] input')) {
      if (target.matches('[data-jy-ws-voice-id]')) { form.fish = null; form.duplicate = false; }
      validateSubmit();
    }
  };

  const onChange = event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches('[data-jy-ws-file]')) {
      const file = target.files?.[0];
      target.value = '';
      if (file) void chooseCover(file);
    } else if (target.matches('[data-jy-ws-confirm]')) validateSubmit();
  };

  // <img> 的 error 不冒泡，只能在捕获阶段听：头像和封面加载失败时换成本地画的，不留破图。
  const onImageError = event => {
    const image = event.target;
    if (!(image instanceof Element) || image.tagName !== 'IMG' || image.dataset.fallback || !image.dataset.name) return;
    if (!page.contains(image) && !layer.contains(image)) return;
    image.dataset.fallback = '1';
    image.src = image.classList.contains('jy-ws-av') ? avatarFallback(image.dataset.name) : bareCover(image.dataset.name, image.dataset.seed || image.dataset.name);
  };

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('error', onImageError, true);

  renderChips();
  updateSummary();
  showView();

  return {
    // 切到工坊页时：标记看过、读一次列表
    onSelect(target) {
      if (target !== 'workshop') {
        closeSheet(true);
        $('[data-jy-ws-menu]').hidden = true;
        return;
      }
      try { globalThis.localStorage?.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
      updateSummary();
      showView();
      // 隔了一分钟以上再回来就重新读一遍，别人刚投的也能看到
      if (state.session && (state.status === 'idle' || state.status === 'error' || Date.now() - state.loadedAt > 60000)) void reload();
    },
    activeSheet,
    handleEscape() {
      const menu = $('[data-jy-ws-menu]');
      if (openSheet) { closeSheet(); return true; }
      if (menu && !menu.hidden) { menu.hidden = true; return true; }
      return false;
    },
    cleanup() {
      disposed = true;
      resetLogin();
      for (const id of timers) clearTimeout(id);
      timers.clear();
      doc.removeEventListener('visibilitychange', onVisible);
      root.removeEventListener('click', onClick);
      root.removeEventListener('input', onInput);
      root.removeEventListener('change', onChange);
      root.removeEventListener('error', onImageError, true);
    },
  };
}

export const __workshop = { esc, hash, waveBars, bareCover, avatarFallback, formatCount, timeAgo, shortId, baseLanguage, judgeVoiceId, apiBase, readSession, discordAuthorizeUrl };

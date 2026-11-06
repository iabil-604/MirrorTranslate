// 镜译 · 音色工坊后端（Cloudflare Workers + D1）
//
// 一个文件，没有依赖。接口一览（除 cover 外都带 Authorization: Bearer <token>）：
//   POST   /api/auth/start            开始 Discord 登录，返回授权链接和 state
//   GET    /api/auth/callback         Discord 授权完成后回到这里（给浏览器看的页面）
//   GET    /api/auth/poll?state=…     插件轮询：等到授权完成就拿到 token
//   POST   /api/auth/logout           退出登录
//   GET    /api/me                    当前登录的人
//   GET    /api/voices                列表（搜索 / 语言 / 排序 / 我的 / 分页）
//   POST   /api/voices                投稿
//   DELETE /api/voices/:id            删除（本人或管理员）
//   POST   /api/voices/:id/copy       记一次复制（每人每个音色只算一次）
//   POST   /api/voices/:id/report     举报
//   GET    /api/voices/:id/cover      头像图（公开，img 标签直接用）
//   GET    /api/admin/reports         管理员：被举报的音色
//   POST   /api/admin/voices/:id/status   管理员：{ status: "ok" | "hidden" }
//   POST   /api/admin/users/:id/ban       管理员：{ banned: true | false }

const SESSION_MS = 30 * 24 * 3600 * 1000;
const LOGIN_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const MAX_LOGIN_STATES = 5000;
const SUBMITS_PER_DAY = 20;
const REPORTS_PER_DAY = 30;
const VOICES_PER_USER = 200;
const MAX_COVER_BYTES = 100 * 1024;
const BASE_LANGS = ['zh', 'ja', 'en', 'ko', 'de', 'fr', 'es', 'ru', 'it', 'pt', 'nl', 'pl', 'ar', 'other'];
const FISH_ID_RE = /^[A-Za-z0-9_.:@-]{1,128}$/;
const STATE_RE = /^[A-Za-z0-9_-]{32,64}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

// 插件在酒馆页面里跨域访问这里，来源不固定（localhost、局域网地址、自己的域名），
// 认证走 Authorization 头而不是 Cookie，所以允许任意来源是安全的。
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type',
  'access-control-max-age': '86400',
};

class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
});

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof HttpError) return json({ ok: false, error: error.code, message: error.message, ...error.extra }, error.status);
      console.error('workshop error', error);
      return json({ ok: false, error: 'server_error', message: '服务器出错了，稍后再试。' }, 500);
    }
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;
  let m;

  if (path === '/' || path === '/api') return json({ ok: true, service: 'jingyi-voice-workshop' });

  // ── 登录 ──
  if (path === '/api/auth/start' && method === 'POST') return authStart(env);
  if (path === '/api/auth/callback' && method === 'GET') return authCallback(url, env);
  if (path === '/api/auth/poll' && method === 'GET') return authPoll(url, env);

  // ── 头像图是公开的：img 标签发不了 Authorization 头 ──
  if ((m = /^\/api\/voices\/([A-Za-z0-9]{6,32})\/cover$/.exec(path)) && method === 'GET') return serveCover(m[1], env);

  // ── 以下都要先登录 ──
  const user = await authenticate(request, env);
  if (path === '/api/me' && method === 'GET') return json({ ok: true, user: publicUser(user, env) });
  if (path === '/api/auth/logout' && method === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(user.tokenHash).run();
    return json({ ok: true });
  }
  if (path === '/api/voices' && method === 'GET') return listVoices(url, user, env);
  if (path === '/api/voices' && method === 'POST') return createVoice(request, user, env);
  if ((m = /^\/api\/voices\/([A-Za-z0-9]{6,32})$/.exec(path)) && method === 'DELETE') return deleteVoice(m[1], user, env);
  if ((m = /^\/api\/voices\/([A-Za-z0-9]{6,32})\/copy$/.exec(path)) && method === 'POST') return copyVoice(m[1], user, env);
  if ((m = /^\/api\/voices\/([A-Za-z0-9]{6,32})\/report$/.exec(path)) && method === 'POST') return reportVoice(m[1], request, user, env);

  if (path.startsWith('/api/admin/')) {
    if (!user.admin) throw new HttpError(403, 'forbidden', '只有管理员能这么做。');
    if (path === '/api/admin/reports' && method === 'GET') return adminReports(env);
    if ((m = /^\/api\/admin\/voices\/([A-Za-z0-9]{6,32})\/status$/.exec(path)) && method === 'POST') return adminVoiceStatus(m[1], request, env);
    if ((m = /^\/api\/admin\/users\/(\d{5,25})\/ban$/.exec(path)) && method === 'POST') return adminBan(m[1], request, env);
  }
  throw new HttpError(404, 'not_found', '没有这个接口。');
}

// ───────────────────────── 工具 ─────────────────────────

function randomToken(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let text = '';
  for (const byte of buffer) text += String.fromCharCode(byte);
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function randomId() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const buffer = new Uint8Array(12);
  crypto.getRandomValues(buffer);
  return [...buffer].map(byte => alphabet[byte % alphabet.length]).join('');
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function isAdmin(env, id) {
  return String(env.ADMIN_IDS ?? '').split(',').map(item => item.trim()).filter(Boolean).includes(String(id));
}

function avatarUrl(id, hash) {
  if (hash) return `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=64`;
  let index = 0;
  try { index = Number((BigInt(id) >> 22n) % 6n); } catch { index = 0; }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function publicUser(user, env) {
  return { id: user.id, name: user.name, avatar: avatarUrl(user.id, user.avatar), admin: isAdmin(env, user.id) };
}

async function readJson(request, limit = 200 * 1024) {
  const text = await request.text();
  if (text.length > limit) throw new HttpError(413, 'too_large', '内容太大了。');
  try {
    const data = JSON.parse(text || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
    return data;
  } catch {
    throw new HttpError(400, 'bad_json', '请求内容不是有效的 JSON。');
  }
}

function langOf(value) {
  const base = String(value ?? '').toLowerCase().split('-')[0];
  return BASE_LANGS.includes(base) ? base : 'other';
}

// ───────────────────────── 登录 ─────────────────────────

async function authStart(env) {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.PUBLIC_URL) {
    throw new HttpError(503, 'not_configured', '服务器还没配置 Discord 登录。');
  }
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_states WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
  ]);
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_states').first();
  if ((count?.n ?? 0) > MAX_LOGIN_STATES) throw new HttpError(503, 'busy', '登录的人太多了，稍后再试。');
  const state = randomToken(32);
  await env.DB.prepare('INSERT INTO login_states (state, expires_at) VALUES (?, ?)').bind(state, now + LOGIN_MS).run();
  const redirect = `${String(env.PUBLIC_URL).replace(/\/+$/, '')}/api/auth/callback`;
  const authorize = new URL('https://discord.com/oauth2/authorize');
  authorize.searchParams.set('client_id', env.DISCORD_CLIENT_ID);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('redirect_uri', redirect);
  authorize.searchParams.set('scope', 'identify');
  authorize.searchParams.set('state', state);
  return json({ ok: true, state, url: authorize.toString(), expiresIn: LOGIN_MS / 1000 });
}

const htmlPage = (title, message, ok) => new Response(
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>`
  + '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f4ee;color:#22332e;font:16px/1.7 system-ui,"PingFang SC","Microsoft YaHei",sans-serif}'
  + 'main{max-width:340px;padding:32px 26px;text-align:center}h1{margin:.3em 0;font:650 22px Georgia,"Songti SC",serif}'
  + `.s{display:grid;place-items:center;width:64px;height:64px;margin:0 auto;border-radius:50%;background:${ok ? '#255d4e' : '#b54332'};color:#fffef3;font:700 30px Georgia,serif;transform:rotate(-10deg)}p{color:#6b7770;font-size:14px}</style></head>`
  + `<body><main><div class="s">${ok ? '✓' : '!'}</div><h1>${title}</h1><p>${message}</p></main></body></html>`,
  { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } },
);

async function authCallback(url, env) {
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  if (!STATE_RE.test(state)) return htmlPage('链接不对', '回到酒馆，重新点一次「使用 Discord 登录」。', false);
  const claimed = await env.DB.prepare(
    "UPDATE login_states SET error = 'authorizing' WHERE state = ? AND expires_at > ? AND token IS NULL AND error IS NULL",
  ).bind(state, Date.now()).run();
  if (!claimed.meta?.changes) return htmlPage('授权链接已处理或已过期', '回到酒馆查看登录状态。', false);
  if (url.searchParams.get('error') || !code) {
    await env.DB.prepare("UPDATE login_states SET error = 'denied' WHERE state = ?").bind(state).run();
    return htmlPage('没有登录', '你在 Discord 那边取消了授权。想用工坊的话，回到酒馆再试一次。', false);
  }
  try {
    const redirect = `${String(env.PUBLIC_URL).replace(/\/+$/, '')}/api/auth/callback`;
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET ?? '',
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirect,
      }),
    });
    if (!tokenResponse.ok) throw new Error(`token ${tokenResponse.status}`);
    const grant = await tokenResponse.json();
    const meResponse = await fetch('https://discord.com/api/users/@me', { headers: { authorization: `Bearer ${grant.access_token}` } });
    if (!meResponse.ok) throw new Error(`me ${meResponse.status}`);
    const me = await meResponse.json();
    if (!/^\d{5,25}$/.test(String(me.id))) throw new Error('bad user id');
    const name = clean(me.global_name || me.username, 40) || `用户${String(me.id).slice(-4)}`;
    const avatar = /^[a-z0-9_]{6,64}$/i.test(String(me.avatar ?? '')) ? me.avatar : null;
    const now = Date.now();
    await env.DB.prepare(
      'INSERT INTO users (id, name, avatar, banned, created_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar',
    ).bind(String(me.id), name, avatar, now).run();
    const banned = await env.DB.prepare('SELECT banned FROM users WHERE id = ?').bind(String(me.id)).first();
    if (banned?.banned) {
      await env.DB.prepare("UPDATE login_states SET error = 'banned' WHERE state = ?").bind(state).run();
      return htmlPage('不能登录', '这个账号被工坊限制了。', false);
    }
    const token = randomToken(32);
    const [session] = await env.DB.batch([
      env.DB.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at)
        SELECT ?, ?, ? FROM login_states WHERE state = ? AND expires_at > ? AND error = 'authorizing'`)
        .bind(await sha256Hex(token), String(me.id), now + SESSION_MS, state, now),
      env.DB.prepare("UPDATE login_states SET token = ?, user_json = ?, error = NULL WHERE state = ? AND expires_at > ? AND error = 'authorizing'")
        .bind(token, JSON.stringify(publicUser({ id: String(me.id), name, avatar }, env)), state, now),
    ]);
    if (!session.meta?.changes) return htmlPage('链接已过期', '回到酒馆，重新点一次「使用 Discord 登录」。', false);
    return htmlPage('登录成功', '可以关掉这个页面了，回到酒馆，工坊会自动打开。', true);
  } catch (error) {
    console.error('discord login failed', error);
    await env.DB.prepare("UPDATE login_states SET error = 'failed' WHERE state = ? AND error = 'authorizing'").bind(state).run();
    return htmlPage('登录失败', '和 Discord 通信出了问题，回到酒馆再试一次。', false);
  }
}

async function authPoll(url, env) {
  const state = url.searchParams.get('state') ?? '';
  if (!STATE_RE.test(state)) throw new HttpError(400, 'bad_state', '登录标识不对。');
  const row = await env.DB.prepare('SELECT token, user_json, error, expires_at FROM login_states WHERE state = ?').bind(state).first();
  if (!row || row.expires_at <= Date.now()) throw new HttpError(410, 'expired', '这次登录已经过期，请重新开始。');
  if (row.error === 'authorizing' || (!row.error && !row.token)) return json({ ok: true, status: 'pending' });
  const claimed = await env.DB.prepare('DELETE FROM login_states WHERE state = ? AND expires_at > ?').bind(state, Date.now()).run();
  if (!claimed.meta?.changes) throw new HttpError(410, 'expired', '这次登录已经领取或已过期。');
  if (row.error) {
    throw new HttpError(403, row.error, row.error === 'denied' ? '你取消了授权。' : row.error === 'banned' ? '这个账号被工坊限制了。' : '登录没有成功，请重试。');
  }
  return json({ ok: true, status: 'done', token: row.token, user: JSON.parse(row.user_json) });
}

async function authenticate(request, env) {
  const match = /^Bearer\s+(\S+)$/.exec(request.headers.get('authorization') ?? '');
  if (!match || !TOKEN_RE.test(match[1])) throw new HttpError(401, 'unauthorized', '请先用 Discord 登录。');
  const tokenHash = await sha256Hex(match[1]);
  const row = await env.DB.prepare(
    'SELECT u.id, u.name, u.avatar, u.banned FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
  ).bind(tokenHash, Date.now()).first();
  if (!row) throw new HttpError(401, 'unauthorized', '登录已经失效，请重新登录。');
  if (row.banned) throw new HttpError(403, 'banned', '这个账号被工坊限制了。');
  return { id: row.id, name: row.name, avatar: row.avatar, tokenHash, admin: isAdmin(env, row.id) };
}

// ───────────────────────── 音色 ─────────────────────────

const VOICE_SELECT = 'SELECT v.id, v.user_id, v.name, v.src, v.lang, v.fish_id, v.fish_by, v.has_cover, v.copies, v.status, v.created_at, u.name AS by_name, u.avatar AS by_avatar FROM voices v JOIN users u ON u.id = v.user_id';

function shape(row, user, env, origin) {
  const base = String(env.PUBLIC_URL || origin).replace(/\/+$/, '');
  return {
    id: row.id,
    name: row.name,
    src: row.src,
    lang: row.lang,
    fishId: row.fish_id,
    fishBy: row.fish_by,
    copies: row.copies,
    status: row.status,
    createdAt: row.created_at,
    cover: row.has_cover ? `${base}/api/voices/${row.id}/cover` : null,
    by: { id: row.user_id, name: row.by_name, avatar: avatarUrl(row.user_id, row.by_avatar) },
    mine: row.user_id === user.id,
  };
}

const escapeLike = text => text.replace(/[\\%_]/g, char => `\\${char}`);

async function listVoices(url, user, env) {
  const q = clean(url.searchParams.get('q'), 60);
  const langParam = url.searchParams.get('lang') ?? '';
  const mine = url.searchParams.get('mine') === '1';
  const sort = url.searchParams.get('sort') === 'hot' ? 'hot' : 'new';
  const page = Math.max(1, Math.min(500, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1));
  const limit = Math.max(1, Math.min(48, Number.parseInt(url.searchParams.get('limit') ?? '24', 10) || 24));

  const where = [];
  const args = [];
  if (mine) { where.push('v.user_id = ?'); args.push(user.id); } else where.push("v.status = 'ok'");
  if (langParam === 'other') where.push("v.lang NOT IN ('zh', 'ja', 'en')");
  else if (BASE_LANGS.includes(langParam)) { where.push('v.lang = ?'); args.push(langParam); }
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push("(v.name LIKE ? ESCAPE '\\' OR v.src LIKE ? ESCAPE '\\' OR v.fish_id LIKE ? ESCAPE '\\')");
    args.push(like, like, like);
  }
  // created_at has millisecond precision. Use insertion order when two submissions share it.
  const recentOrder = 'v.created_at DESC, v.rowid DESC';
  const order = sort === 'hot' ? `v.copies DESC, ${recentOrder}` : recentOrder;
  const rows = await env.DB.prepare(`${VOICE_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .bind(...args, limit + 1, (page - 1) * limit).all();
  const list = rows.results ?? [];
  const origin = url.origin;
  const body = { ok: true, items: list.slice(0, limit).map(row => shape(row, user, env, origin)), hasMore: list.length > limit, page };

  if (page === 1) {
    const counts = await env.DB.prepare(
      "SELECT COUNT(*) AS total, COALESCE(SUM(lang = 'zh'), 0) AS zh, COALESCE(SUM(lang = 'ja'), 0) AS ja, COALESCE(SUM(lang = 'en'), 0) AS en FROM voices WHERE status = 'ok'",
    ).first();
    const mineCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM voices WHERE user_id = ?').bind(user.id).first();
    body.counts = {
      all: counts?.total ?? 0, zh: counts?.zh ?? 0, ja: counts?.ja ?? 0, en: counts?.en ?? 0,
      other: (counts?.total ?? 0) - (counts?.zh ?? 0) - (counts?.ja ?? 0) - (counts?.en ?? 0),
      mine: mineCount?.n ?? 0,
    };
    body.hero = null;
    if (!mine && !q && !langParam) {
      const hero = await env.DB.prepare(`${VOICE_SELECT} WHERE v.status = 'ok' AND v.copies > 0 ORDER BY v.copies DESC, ${recentOrder} LIMIT 1`).first();
      if (hero) body.hero = shape(hero, user, env, origin);
    }
  }
  return json(body);
}

function decodeCover(dataUrl) {
  const match = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!match) throw new HttpError(400, 'bad_cover', '头像图片格式不对，请重新选一张。');
  let bytes;
  try {
    const raw = atob(match[2]);
    bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  } catch {
    throw new HttpError(400, 'bad_cover', '头像图片读不出来，请重新选一张。');
  }
  if (bytes.length > MAX_COVER_BYTES) throw new HttpError(413, 'cover_too_large', '头像图片太大了（压缩后超过 100 KB）。');
  const head = [...bytes.slice(0, 12)];
  const isWebp = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const claimed = match[1];
  if (!((claimed === 'image/webp' && isWebp) || (claimed === 'image/jpeg' && isJpeg) || (claimed === 'image/png' && isPng))) {
    throw new HttpError(400, 'bad_cover', '头像文件的内容和格式对不上。');
  }
  return { mime: claimed, data: match[2] };
}

async function verifyWithFish(env, fishId) {
  if (!env.FISH_API_KEY) return null;
  let response;
  try {
    response = await fetch(`https://api.fish.audio/model/${encodeURIComponent(fishId)}`, { headers: { authorization: `Bearer ${env.FISH_API_KEY}` } });
  } catch {
    return null;                                    // 核对不了就不拦人
  }
  if (response.status === 404 || response.status === 422) throw new HttpError(400, 'fish_not_found', 'Fish 上找不到这个音色 ID。');
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  if (data?.visibility === 'private') throw new HttpError(400, 'fish_private', '这个音色在 Fish 上是私有的，别人用不了。');
  return { author: clean(data?.author?.nickname, 40) };
}

async function createVoice(request, user, env) {
  const body = await readJson(request, 260 * 1024);
  const name = clean(body.name, 30);
  const src = clean(body.src, 40);
  const fishId = String(body.fishId ?? '').trim();
  if (!name) throw new HttpError(400, 'bad_name', '角色名不能是空的。');
  if (!FISH_ID_RE.test(fishId)) throw new HttpError(400, 'bad_fish_id', 'Fish 音色 ID 的格式不对。');
  const lang = langOf(body.lang);
  const cover = body.cover ? decodeCover(body.cover) : null;
  const now = Date.now();

  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM voices WHERE user_id = ? AND created_at > ?').bind(user.id, now - DAY_MS).first();
  if ((recent?.n ?? 0) >= SUBMITS_PER_DAY) throw new HttpError(429, 'rate_limited', `一天最多投稿 ${SUBMITS_PER_DAY} 个，明天再来。`);
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM voices WHERE user_id = ?').bind(user.id).first();
  if ((total?.n ?? 0) >= VOICES_PER_USER) throw new HttpError(429, 'too_many', `每人最多 ${VOICES_PER_USER} 个投稿，先删掉一些。`);
  const dup = await env.DB.prepare('SELECT id FROM voices WHERE fish_id = ? COLLATE NOCASE').bind(fishId).first();
  if (dup) throw new HttpError(409, 'duplicate', '工坊里已经有这个音色了，去搜搜看。', { existingId: dup.id });

  const verified = await verifyWithFish(env, fishId);
  const fishBy = verified ? verified.author : clean(body.fishBy, 40);
  const id = randomId();
  const statements = [
    env.DB.prepare('INSERT INTO voices (id, user_id, name, src, lang, fish_id, fish_by, has_cover, copies, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
      .bind(id, user.id, name, src, lang, fishId, fishBy, cover ? 1 : 0, 'ok', now),
  ];
  if (cover) statements.push(env.DB.prepare('INSERT INTO covers (voice_id, mime, data) VALUES (?, ?, ?)').bind(id, cover.mime, cover.data));
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (/UNIQUE/i.test(String(error?.message ?? error))) throw new HttpError(409, 'duplicate', '工坊里已经有这个音色了，去搜搜看。');
    throw error;
  }
  const row = await env.DB.prepare(`${VOICE_SELECT} WHERE v.id = ?`).bind(id).first();
  return json({ ok: true, voice: shape(row, user, env, new URL(request.url).origin) }, 201);
}

async function findVoice(id, env) {
  return env.DB.prepare('SELECT id, user_id, status FROM voices WHERE id = ?').bind(id).first();
}

async function deleteVoice(id, user, env) {
  const voice = await findVoice(id, env);
  if (!voice) throw new HttpError(404, 'not_found', '这个投稿不存在，可能已经被删了。');
  if (voice.user_id !== user.id && !user.admin) throw new HttpError(403, 'forbidden', '只能删自己的投稿。');
  await removeVoice(id, env);
  return json({ ok: true });
}

function removeVoice(id, env) {
  return env.DB.batch([
    env.DB.prepare('DELETE FROM covers WHERE voice_id = ?').bind(id),
    env.DB.prepare('DELETE FROM copies WHERE voice_id = ?').bind(id),
    env.DB.prepare('DELETE FROM reports WHERE voice_id = ?').bind(id),
    env.DB.prepare('DELETE FROM voices WHERE id = ?').bind(id),
  ]);
}

async function copyVoice(id, user, env) {
  const voice = await findVoice(id, env);
  if (!voice || (voice.status !== 'ok' && voice.user_id !== user.id)) throw new HttpError(404, 'not_found', '这个投稿不存在，可能已经被删了。');
  let counted = false;
  if (voice.user_id !== user.id) {
    const result = await env.DB.prepare('INSERT OR IGNORE INTO copies (voice_id, user_id, created_at) VALUES (?, ?, ?)').bind(id, user.id, Date.now()).run();
    counted = (result.meta?.changes ?? 0) > 0;
    if (counted) await env.DB.prepare('UPDATE voices SET copies = copies + 1 WHERE id = ?').bind(id).run();
  }
  const row = await env.DB.prepare('SELECT copies FROM voices WHERE id = ?').bind(id).first();
  return json({ ok: true, copies: row?.copies ?? 0, counted });
}

async function reportVoice(id, request, user, env) {
  const voice = await findVoice(id, env);
  if (!voice || voice.status !== 'ok') throw new HttpError(404, 'not_found', '这个投稿不存在，可能已经被处理了。');
  if (voice.user_id === user.id) throw new HttpError(400, 'own', '这是你自己的投稿。');
  const body = await readJson(request, 4 * 1024).catch(() => ({}));
  const today = await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE user_id = ? AND created_at > ?').bind(user.id, Date.now() - DAY_MS).first();
  if ((today?.n ?? 0) >= REPORTS_PER_DAY) throw new HttpError(429, 'rate_limited', '今天举报得太多了，明天再来。');
  await env.DB.prepare('INSERT OR IGNORE INTO reports (voice_id, user_id, reason, created_at) VALUES (?, ?, ?, ?)').bind(id, user.id, clean(body.reason, 80), Date.now()).run();
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE voice_id = ?').bind(id).first();
  const threshold = Math.max(1, Number.parseInt(env.REPORT_HIDE_AT ?? '3', 10) || 3);
  let hidden = false;
  if ((total?.n ?? 0) >= threshold) {
    await env.DB.prepare("UPDATE voices SET status = 'hidden' WHERE id = ?").bind(id).run();
    hidden = true;
  }
  return json({ ok: true, hidden });
}

async function serveCover(id, env) {
  const row = await env.DB.prepare("SELECT c.mime, c.data FROM covers c JOIN voices v ON v.id = c.voice_id WHERE c.voice_id = ? AND v.status = 'ok'").bind(id).first();
  if (!row) return new Response('not found', { status: 404, headers: CORS });
  const raw = atob(row.data);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return new Response(bytes, {
    headers: { 'content-type': row.mime, 'cache-control': 'public, max-age=3600', 'cross-origin-resource-policy': 'cross-origin', 'x-content-type-options': 'nosniff', ...CORS },
  });
}

// ───────────────────────── 管理员 ─────────────────────────

async function adminReports(env) {
  const rows = await env.DB.prepare(
    `SELECT v.id, v.user_id, v.name, v.fish_id, v.status, u.name AS by_name, COUNT(r.user_id) AS report_count
     FROM voices v JOIN users u ON u.id = v.user_id JOIN reports r ON r.voice_id = v.id
     GROUP BY v.id ORDER BY report_count DESC, v.created_at DESC LIMIT 100`,
  ).all();
  return json({
    ok: true,
    items: (rows.results ?? []).map(row => ({
      id: row.id, name: row.name, fishId: row.fish_id, status: row.status, reports: row.report_count,
      by: { id: row.user_id, name: row.by_name },
    })),
  });
}

async function adminVoiceStatus(id, request, env) {
  const body = await readJson(request, 1024);
  if (!['ok', 'hidden'].includes(body.status)) throw new HttpError(400, 'bad_status', 'status 只能是 ok 或 hidden。');
  const result = await env.DB.prepare('UPDATE voices SET status = ? WHERE id = ?').bind(body.status, id).run();
  if (!(result.meta?.changes > 0)) throw new HttpError(404, 'not_found', '没有这个投稿。');
  if (body.status === 'ok') await env.DB.prepare('DELETE FROM reports WHERE voice_id = ?').bind(id).run();
  return json({ ok: true });
}

async function adminBan(id, request, env) {
  const body = await readJson(request, 1024);
  const banned = body.banned === true;
  const result = await env.DB.prepare('UPDATE users SET banned = ? WHERE id = ?').bind(banned ? 1 : 0, id).run();
  if (!(result.meta?.changes > 0)) throw new HttpError(404, 'not_found', '没有这个用户。');
  if (banned) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
      env.DB.prepare("UPDATE voices SET status = 'hidden' WHERE user_id = ?").bind(id),
    ]);
  }
  return json({ ok: true });
}

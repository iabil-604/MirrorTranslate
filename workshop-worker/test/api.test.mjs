import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.js';
import { createD1 } from '../tools/d1-shim.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.join(here, '..', 'schema.sql'), 'utf8');
const BASE = 'https://workshop.example.dev';

function makeEnv(extra = {}) {
  return {
    DB: createD1(schema),
    PUBLIC_URL: BASE,
    DISCORD_CLIENT_ID: '123456789',
    DISCORD_CLIENT_SECRET: 'secret',
    ADMIN_IDS: '900001',
    REPORT_HIDE_AT: '3',
    ...extra,
  };
}

// Discord 和 Fish 都用假的。授权码写成 "user:<id>:<name>"，就能扮演不同的人。
let fishMode = 'ok';
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url ?? input);
  if (url.startsWith('https://discord.com/api/oauth2/token')) {
    const code = new URLSearchParams(String(init.body)).get('code');
    if (code === 'bad') return new Response('nope', { status: 400 });
    return new Response(JSON.stringify({ access_token: `at:${code}` }), { status: 200 });
  }
  if (url.startsWith('https://discord.com/api/users/@me')) {
    const auth = init.headers?.authorization ?? '';
    const [, , id, name] = /^Bearer at:(user):(\d+):(.*)$/.exec(auth) ?? [];
    return new Response(JSON.stringify({ id, username: name, global_name: name, avatar: id === '900001' ? null : 'abc123def456' }), { status: 200 });
  }
  if (url.startsWith('https://api.fish.audio/model/')) {
    if (fishMode === 'missing') return new Response('{}', { status: 404 });
    if (fishMode === 'private') return new Response(JSON.stringify({ title: 'x', visibility: 'private', author: { nickname: 'A' } }), { status: 200 });
    return new Response(JSON.stringify({ title: 'T', visibility: 'public', author: { nickname: 'FishAuthor' } }), { status: 200 });
  }
  throw new Error('Unexpected outbound request in test');
};

const call = (env, method, route, { token, body, raw } = {}) => worker.fetch(new Request(BASE + route, {
  method,
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
  body: raw ?? (body ? JSON.stringify(body) : undefined),
}), env);
// status 是 HTTP 状态码；接口自己的 status 字段（pending / done）在 body 里
const read = async response => { const data = await response.json(); return { ...data, status: response.status, body: data }; };

async function login(env, id, name) {
  const start = await read(await call(env, 'POST', '/api/auth/start'));
  assert.equal(start.ok, true);
  const cb = await worker.fetch(new Request(`${BASE}/api/auth/callback?code=user:${id}:${name}&state=${start.state}`), env);
  assert.equal(cb.status, 200);
  const poll = await read(await call(env, 'GET', `/api/auth/poll?state=${start.state}`));
  assert.equal(poll.status, 200);
  assert.equal(poll.body.status, 'done');
  return { token: poll.token, user: poll.user, state: start.state };
}

const hex = seed => (seed.toString(16).padStart(4, '0')).repeat(8);   // 32 位十六进制
// 最小的合法 webp：RIFF????WEBP 开头
const webpDataUrl = () => {
  const bytes = new Uint8Array(40);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0x20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  return `data:image/webp;base64,${Buffer.from(bytes).toString('base64')}`;
};
const submit = (env, token, over = {}) => call(env, 'POST', '/api/voices', { token, body: { name: '白露', src: '温柔御姐', lang: 'zh', fishId: hex(1), fishBy: 'Amber', ...over } });

test('登录：start → 授权 → poll 只交出一次 token，之后能用它访问', async () => {
  const env = makeEnv();
  const start = await read(await call(env, 'POST', '/api/auth/start'));
  assert.match(start.url, /^https:\/\/discord\.com\/oauth2\/authorize\?/);
  const parsed = new URL(start.url);
  assert.equal(parsed.searchParams.get('scope'), 'identify');
  assert.equal(parsed.searchParams.get('client_id'), '123456789');
  assert.equal(parsed.searchParams.get('redirect_uri'), `${BASE}/api/auth/callback`);
  assert.equal(parsed.searchParams.get('state'), start.state);

  const pending = await read(await call(env, 'GET', `/api/auth/poll?state=${start.state}`));
  assert.equal(pending.status, 200);
  assert.equal(pending.body.status, 'pending');

  const cb = await worker.fetch(new Request(`${BASE}/api/auth/callback?code=user:42424:小雨&state=${start.state}`), env);
  assert.match(await cb.text(), /登录成功/);
  const done = await read(await call(env, 'GET', `/api/auth/poll?state=${start.state}`));
  assert.equal(done.user.name, '小雨');
  assert.match(done.user.avatar, /cdn\.discordapp\.com\/avatars\/42424\/abc123def456\.png/);
  assert.equal(typeof done.token, 'string');

  const again = await read(await call(env, 'GET', `/api/auth/poll?state=${start.state}`));
  assert.equal(again.status, 410);

  const me = await read(await call(env, 'GET', '/api/me', { token: done.token }));
  assert.equal(me.user.id, '42424');
  // 库里只存哈希，不存 token 本身
  const stored = env.DB.raw.prepare('SELECT token_hash FROM sessions').all();
  assert.equal(stored.length, 1);
  assert.notEqual(stored[0].token_hash, done.token);
  assert.equal((await call(env, 'GET', '/api/me')).status, 401);
  assert.equal((await call(env, 'GET', '/api/me', { token: 'x'.repeat(43) })).status, 401);
});

test('同一授权的并发回调只交换一次，多个轮询只交出一个凭证', { timeout: 5000 }, async t => {
  const env = makeEnv();
  const entered = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const mockFetch = globalThis.fetch;
  let exchanges = 0;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (input === 'https://discord.com/api/oauth2/token' && ++exchanges === 1) {
      entered.resolve();
      await resume.promise;
    }
    return mockFetch(input, init);
  });
  const start = await read(await call(env, 'POST', '/api/auth/start'));
  const callback = `/api/auth/callback?code=user:42424:reader&state=${start.state}`;
  const polling = `/api/auth/poll?state=${start.state}`;
  const first = call(env, 'GET', callback);
  await entered.promise;
  try {
    assert.equal((await read(await call(env, 'GET', polling))).body.status, 'pending');
    assert.match(await (await call(env, 'GET', callback)).text(), /授权链接已处理或已过期/);
    assert.equal(exchanges, 1);
  } finally {
    resume.resolve();
  }
  assert.match(await (await first).text(), /登录成功/);
  const results = await Promise.all(Array.from({ length: 4 }, async () => read(await call(env, 'GET', polling))));
  assert.deepEqual(results.map(row => row.status).sort(), [200, 410, 410, 410]);
  assert.equal(results.filter(row => typeof row.token === 'string').length, 1);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
});

test('登录：在 Discord 取消授权、授权码无效、过期', async () => {
  const env = makeEnv();
  const start = await read(await call(env, 'POST', '/api/auth/start'));
  const denied = await worker.fetch(new Request(`${BASE}/api/auth/callback?error=access_denied&state=${start.state}`), env);
  assert.match(await denied.text(), /没有登录/);
  const poll = await read(await call(env, 'GET', `/api/auth/poll?state=${start.state}`));
  assert.equal(poll.status, 403);
  assert.equal(poll.error, 'denied');

  const second = await read(await call(env, 'POST', '/api/auth/start'));
  const failed = await worker.fetch(new Request(`${BASE}/api/auth/callback?code=bad&state=${second.state}`), env);
  assert.match(await failed.text(), /登录失败/);
  assert.equal((await read(await call(env, 'GET', `/api/auth/poll?state=${second.state}`))).error, 'failed');

  const third = await read(await call(env, 'POST', '/api/auth/start'));
  env.DB.raw.prepare('UPDATE login_states SET expires_at = 1 WHERE state = ?').run(third.state);
  assert.equal((await call(env, 'GET', `/api/auth/poll?state=${third.state}`)).status, 410);
  assert.equal((await call(env, 'GET', '/api/auth/poll?state=short')).status, 400);
});

test('登出后 token 立即失效', async () => {
  const env = makeEnv();
  const a = await login(env, '100001', 'A');
  assert.equal((await call(env, 'POST', '/api/auth/logout', { token: a.token })).status, 200);
  assert.equal((await call(env, 'GET', '/api/me', { token: a.token })).status, 401);
});

test('没登录什么都看不了，预检请求带跨域头', async () => {
  const env = makeEnv();
  assert.equal((await call(env, 'GET', '/api/voices')).status, 401);
  const preflight = await worker.fetch(new Request(`${BASE}/api/voices`, { method: 'OPTIONS' }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
  const unauthorized = await call(env, 'GET', '/api/voices');
  assert.equal(unauthorized.headers.get('access-control-allow-origin'), '*');
});

test('投稿：校验字段、头像内容和重复 ID', async () => {
  const env = makeEnv();
  const a = await login(env, '100001', 'A');
  assert.equal((await read(await submit(env, a.token, { name: '  ' }))).error, 'bad_name');
  assert.equal((await read(await submit(env, a.token, { fishId: 'has space' }))).error, 'bad_fish_id');
  assert.equal((await read(await submit(env, a.token, { cover: 'data:image/webp;base64,AAAA' }))).error, 'bad_cover');
  assert.equal((await read(await submit(env, a.token, { cover: 'not a data url' }))).error, 'bad_cover');
  const huge = `data:image/webp;base64,${Buffer.concat([Buffer.from([0x52, 0x49, 0x46, 0x46, 0x20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), Buffer.alloc(120 * 1024)]).toString('base64')}`;
  assert.equal((await read(await submit(env, a.token, { cover: huge }))).error, 'cover_too_large');

  const ok = await read(await submit(env, a.token, { cover: webpDataUrl(), name: '<b>白露</b>' }));
  assert.equal(ok.status, 201);
  assert.equal(ok.voice.name, 'b 白露 /b');            // < > 被清掉，不会变成标签
  assert.equal(ok.voice.mine, true);
  assert.equal(ok.voice.by.name, 'A');
  assert.equal(ok.voice.cover, `${BASE}/api/voices/${ok.voice.id}/cover`);
  assert.equal(ok.voice.fishBy, 'Amber');

  const b = await login(env, '100002', 'B');
  const dup = await read(await submit(env, b.token, { fishId: hex(1).toUpperCase() }));
  assert.equal(dup.status, 409);
  assert.equal(dup.error, 'duplicate');
  assert.equal(dup.existingId, ok.voice.id);
});

test('头像：公开可取，类型和缓存头正确', async () => {
  const env = makeEnv();
  const a = await login(env, '100001', 'A');
  const created = await read(await submit(env, a.token, { cover: webpDataUrl() }));
  const response = await call(env, 'GET', `/api/voices/${created.voice.id}/cover`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.match(response.headers.get('cache-control'), /max-age/);
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.equal((await response.arrayBuffer()).byteLength, 40);
  const none = await read(await submit(env, a.token, { fishId: hex(2), name: '没图' }));
  assert.equal(none.voice.cover, null);
  assert.equal((await call(env, 'GET', `/api/voices/${none.voice.id}/cover`)).status, 404);
});

test('列表：语言、其他、搜索（含通配符转义）、排序、分页、统计', async () => {
  const env = makeEnv();
  const a = await login(env, '100001', 'A');
  const rows = [
    ['白露', 'zh', '温柔御姐', 1], ['夜雀', 'zh', '冷淡少女', 2], ['凛音', 'ja', '', 3],
    ['Marlowe', 'en', 'noir', 4], ['하늘', 'ko', '', 5], ['100% 纯度', 'zh', '', 6],
  ];
  for (const [name, lang, src, seed] of rows) {
    const response = await submit(env, a.token, { name, lang, src, fishId: hex(seed) });
    assert.equal(response.status, 201);
    await new Promise(resolve => setTimeout(resolve, 3));
  }
  const list = async query => read(await call(env, 'GET', `/api/voices${query}`, { token: a.token }));
  const all = await list('');
  assert.equal(all.items.length, 6);
  assert.equal(all.items[0].name, '100% 纯度');            // 最新在前
  assert.deepEqual(all.counts, { all: 6, zh: 3, ja: 1, en: 1, other: 1, mine: 6 });

  assert.deepEqual((await list('?lang=ja')).items.map(item => item.name), ['凛音']);
  assert.deepEqual((await list('?lang=other')).items.map(item => item.name), ['하늘']);
  assert.equal((await list('?lang=zh')).items.length, 3);
  assert.deepEqual((await list('?q=Marlow')).items.map(item => item.name), ['Marlowe']);
  assert.deepEqual((await list('?q=%25')).items.map(item => item.name), ['100% 纯度']);   // % 只匹配字面的 %
  assert.equal((await list('?q=' + hex(3).slice(0, 8))).items.length, 1);                   // 按 ID 搜
  assert.equal((await list('?q=_')).items.length, 0);                                       // _ 不是通配符

  const page1 = await list('?limit=4');
  assert.equal(page1.items.length, 4);
  assert.equal(page1.hasMore, true);
  const page2 = await list('?limit=4&page=2');
  assert.equal(page2.items.length, 2);
  assert.equal(page2.hasMore, false);
  assert.equal(page2.counts, undefined);
  assert.equal(new Set([...page1.items, ...page2.items].map(item => item.id)).size, 6);
});

test('复制：每人每个音色只算一次，自己复制自己的不算，热度排序和 hero', async () => {
  const env = makeEnv();
  const a = await login(env, '100001', 'A');
  const b = await login(env, '100002', 'B');
  const c = await login(env, '100003', 'C');
  const one = await read(await submit(env, a.token, { fishId: hex(1), name: '甲' }));
  const two = await read(await submit(env, a.token, { fishId: hex(2), name: '乙' }));

  const hero0 = await read(await call(env, 'GET', '/api/voices', { token: b.token }));
  assert.equal(hero0.hero, null);                            // 还没人复制，没有 hero

  assert.equal((await read(await call(env, 'POST', `/api/voices/${one.voice.id}/copy`, { token: a.token }))).counted, false);
  const first = await read(await call(env, 'POST', `/api/voices/${one.voice.id}/copy`, { token: b.token }));
  assert.deepEqual([first.counted, first.copies], [true, 1]);
  const repeat = await read(await call(env, 'POST', `/api/voices/${one.voice.id}/copy`, { token: b.token }));
  assert.deepEqual([repeat.counted, repeat.copies], [false, 1]);
  await call(env, 'POST', `/api/voices/${two.voice.id}/copy`, { token: b.token });
  await call(env, 'POST', `/api/voices/${two.voice.id}/copy`, { token: c.token });

  const hot = await read(await call(env, 'GET', '/api/voices?sort=hot', { token: c.token }));
  assert.deepEqual(hot.items.map(item => [item.name, item.copies]), [['乙', 2], ['甲', 1]]);
  assert.equal(hot.hero.name, '乙');
  const filtered = await read(await call(env, 'GET', '/api/voices?lang=zh', { token: c.token }));
  assert.equal(filtered.hero, null);                         // 筛选时不出 hero
  assert.equal((await call(env, 'POST', '/api/voices/nonexistent1/copy', { token: b.token })).status, 404);
});

test('举报：够 3 个人就自动隐藏，本人在「我的」里还看得到', async () => {
  const env = makeEnv();
  const a = await login(env, '100001', 'A');
  const users = [await login(env, '100002', 'B'), await login(env, '100003', 'C'), await login(env, '100004', 'D')];
  const created = await read(await submit(env, a.token, { cover: webpDataUrl() }));
  const id = created.voice.id;
  assert.equal((await read(await call(env, 'POST', `/api/voices/${id}/report`, { token: a.token, body: {} }))).error, 'own');
  const r1 = await read(await call(env, 'POST', `/api/voices/${id}/report`, { token: users[0].token, body: { reason: '真人克隆' } }));
  assert.equal(r1.hidden, false);
  await call(env, 'POST', `/api/voices/${id}/report`, { token: users[0].token, body: {} });        // 重复举报不叠加
  assert.equal((await read(await call(env, 'POST', `/api/voices/${id}/report`, { token: users[1].token, body: {} }))).hidden, false);
  assert.equal((await read(await call(env, 'POST', `/api/voices/${id}/report`, { token: users[2].token, body: {} }))).hidden, true);

  const seen = await read(await call(env, 'GET', '/api/voices', { token: users[0].token }));
  assert.equal(seen.items.length, 0);
  assert.equal(seen.counts.all, 0);
  const mine = await read(await call(env, 'GET', '/api/voices?mine=1', { token: a.token }));
  assert.equal(mine.items.length, 1);
  assert.equal(mine.items[0].status, 'hidden');
  assert.equal((await call(env, 'GET', `/api/voices/${id}/cover`)).status, 404);     // 隐藏后头像也不再提供
});

test('删除：本人可以，别人不行，管理员可以，并清掉关联数据', async () => {
  const env = makeEnv();
  const a = await login(env, '100001', 'A');
  const b = await login(env, '100002', 'B');
  const admin = await login(env, '900001', 'Admin');
  assert.equal(admin.user.admin, true);
  const one = await read(await submit(env, a.token, { cover: webpDataUrl(), fishId: hex(1) }));
  const two = await read(await submit(env, a.token, { fishId: hex(2) }));
  await call(env, 'POST', `/api/voices/${one.voice.id}/copy`, { token: b.token });
  assert.equal((await call(env, 'DELETE', `/api/voices/${one.voice.id}`, { token: b.token })).status, 403);
  assert.equal((await call(env, 'DELETE', `/api/voices/${one.voice.id}`, { token: a.token })).status, 200);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM covers').get().n, 0);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM copies').get().n, 0);
  assert.equal((await call(env, 'DELETE', `/api/voices/${one.voice.id}`, { token: a.token })).status, 404);
  assert.equal((await call(env, 'DELETE', `/api/voices/${two.voice.id}`, { token: admin.token })).status, 200);
  // 删掉以后同一个 ID 可以重新投
  assert.equal((await submit(env, b.token, { fishId: hex(1) })).status, 201);
});

test('限额：一天最多投稿 20 个', async () => {
  const env = makeEnv();
  const a = await login(env, '100001', 'A');
  for (let index = 1; index <= 20; index += 1) assert.equal((await submit(env, a.token, { fishId: hex(index) })).status, 201);
  const over = await read(await submit(env, a.token, { fishId: hex(99) }));
  assert.equal(over.status, 429);
  assert.equal(over.error, 'rate_limited');
});

test('管理员：看举报、隐藏/恢复、封人（封了以后登录失效、投稿隐藏）', async () => {
  const env = makeEnv();
  const a = await login(env, '100001', 'A');
  const b = await login(env, '100002', 'B');
  const admin = await login(env, '900001', 'Admin');
  const created = await read(await submit(env, a.token));
  await call(env, 'POST', `/api/voices/${created.voice.id}/report`, { token: b.token, body: { reason: 'x' } });

  assert.equal((await call(env, 'GET', '/api/admin/reports', { token: b.token })).status, 403);
  const reports = await read(await call(env, 'GET', '/api/admin/reports', { token: admin.token }));
  assert.equal(reports.items[0].reports, 1);
  assert.equal(reports.items[0].by.name, 'A');

  assert.equal((await call(env, 'POST', `/api/admin/voices/${created.voice.id}/status`, { token: admin.token, body: { status: 'hidden' } })).status, 200);
  assert.equal((await read(await call(env, 'GET', '/api/voices', { token: b.token }))).items.length, 0);
  assert.equal((await call(env, 'POST', `/api/admin/voices/${created.voice.id}/status`, { token: admin.token, body: { status: 'ok' } })).status, 200);
  assert.equal((await read(await call(env, 'GET', '/api/voices', { token: b.token }))).items.length, 1);

  assert.equal((await call(env, 'POST', '/api/admin/users/100001/ban', { token: admin.token, body: { banned: true } })).status, 200);
  assert.equal((await call(env, 'GET', '/api/me', { token: a.token })).status, 401);          // 会话被清掉
  assert.equal((await read(await call(env, 'GET', '/api/voices', { token: b.token }))).items.length, 0);
  const retry = await read(await call(env, 'POST', '/api/auth/start'));
  await worker.fetch(new Request(`${BASE}/api/auth/callback?code=user:100001:A&state=${retry.state}`), env);
  const blocked = await read(await call(env, 'GET', `/api/auth/poll?state=${retry.state}`));
  assert.equal(blocked.status, 403);
  assert.equal(blocked.error, 'banned');
});

test('配了 FISH_API_KEY：服务器再核对一次，私有/不存在的拦下，作者以 Fish 为准', async () => {
  const env = makeEnv({ FISH_API_KEY: 'sk-test' });
  const a = await login(env, '100001', 'A');
  fishMode = 'missing';
  assert.equal((await read(await submit(env, a.token))).error, 'fish_not_found');
  fishMode = 'private';
  assert.equal((await read(await submit(env, a.token))).error, 'fish_private');
  fishMode = 'ok';
  const ok = await read(await submit(env, a.token, { fishBy: '我乱写的' }));
  assert.equal(ok.status, 201);
  assert.equal(ok.voice.fishBy, 'FishAuthor');
});

test('没配置 Discord 时明确报错，不乱跑', async () => {
  const env = makeEnv({ DISCORD_CLIENT_ID: '' });
  const response = await read(await call(env, 'POST', '/api/auth/start'));
  assert.equal(response.status, 503);
  assert.equal(response.error, 'not_configured');
});

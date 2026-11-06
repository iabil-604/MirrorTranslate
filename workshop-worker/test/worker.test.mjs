import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.js';
import { createD1 } from '../tools/d1-shim.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.join(here, '..', 'schema.sql'), 'utf8');

// ── 假的 Discord 和 Fish ──
let fishMode = 'ok';
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === 'https://discord.com/api/oauth2/token') {
    const code = new URLSearchParams(String(init.body)).get('code');
    return Response.json({ access_token: `at:${code}` });
  }
  if (url === 'https://discord.com/api/users/@me') {
    const [, id, name] = /^Bearer at:user:(\d+):(.*)$/.exec(init.headers.authorization) ?? [];
    return Response.json({ id, username: `${name}_u`, global_name: name, avatar: id.endsWith('7') ? null : 'abc123def456' });
  }
  if (url.startsWith('https://api.fish.audio/model/')) {
    if (fishMode === 'missing') return new Response('{}', { status: 404 });
    if (fishMode === 'private') return Response.json({ visibility: 'private', author: { nickname: 'X' } });
    return Response.json({ visibility: 'public', title: 'T', author: { nickname: 'Fish原作者' } });
  }
  throw new Error('Unexpected outbound request in test');
};

const ORIGIN = 'https://w.example';
function makeEnv(extra = {}) {
  return { DB: createD1(schema), PUBLIC_URL: ORIGIN, DISCORD_CLIENT_ID: '999', DISCORD_CLIENT_SECRET: 's', ADMIN_IDS: '100100000000000001', ...extra };
}
const call = (env, method, pathname, { token, body } = {}) => worker.fetch(new Request(`${ORIGIN}${pathname}`, {
  method,
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}), env);
const jsonOf = async response => response.json();

async function login(env, id, name) {
  const start = await jsonOf(await call(env, 'POST', '/api/auth/start'));
  assert.equal(start.ok, true);
  const cb = await call(env, 'GET', `/api/auth/callback?code=user:${id}:${name}&state=${start.state}`);
  assert.equal(cb.status, 200);
  const done = await jsonOf(await call(env, 'GET', `/api/auth/poll?state=${start.state}`));
  assert.equal(done.status, 'done');
  return { token: done.token, user: done.user, state: start.state };
}

// 一张真 webp 的开头（RIFF????WEBP）
const webp = b64 => `data:image/webp;base64,${b64}`;
const WEBP_B64 = Buffer.concat([Buffer.from('RIFF'), Buffer.from([10, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(24, 1)]).toString('base64');
const FISH = n => n.toString(16).padStart(32, '0');

test('登录：start → 授权回调 → 轮询拿到 token，token 只交出一次', async () => {
  const env = makeEnv();
  const start = await jsonOf(await call(env, 'POST', '/api/auth/start'));
  const authorize = new URL(start.url);
  assert.equal(authorize.origin + authorize.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(authorize.searchParams.get('scope'), 'identify');
  assert.equal(authorize.searchParams.get('client_id'), '999');
  assert.equal(authorize.searchParams.get('redirect_uri'), `${ORIGIN}/api/auth/callback`);
  assert.equal(authorize.searchParams.get('state'), start.state);

  const pending = await jsonOf(await call(env, 'GET', `/api/auth/poll?state=${start.state}`));
  assert.equal(pending.status, 'pending');

  const page = await call(env, 'GET', `/api/auth/callback?code=user:200100000000000001:小雨&state=${start.state}`);
  assert.match(await page.text(), /登录成功/);
  const done = await jsonOf(await call(env, 'GET', `/api/auth/poll?state=${start.state}`));
  assert.equal(done.status, 'done');
  assert.equal(done.user.name, '小雨');
  assert.equal(done.user.id, '200100000000000001');
  assert.match(done.user.avatar, /cdn\.discordapp\.com\/avatars\/200100000000000001\/abc123def456/);
  const again = await call(env, 'GET', `/api/auth/poll?state=${start.state}`);
  assert.equal(again.status, 410);

  // 数据库里只有哈希，没有明文 token
  const stored = env.DB.raw.prepare('SELECT token_hash FROM sessions').all();
  assert.equal(stored.length, 1);
  assert.notEqual(stored[0].token_hash, done.token);
  assert.equal(stored[0].token_hash.length, 64);

  const me = await jsonOf(await call(env, 'GET', '/api/me', { token: done.token }));
  assert.equal(me.user.name, '小雨');
});

test('登录：没有头像的人用 Discord 默认头像；取消授权时轮询得到 denied；乱写的 state 被拒', async () => {
  const env = makeEnv();
  const a = await login(env, '300700000000000007', '阿七');
  assert.match(a.user.avatar, /embed\/avatars\/\d\.png/);

  const start = await jsonOf(await call(env, 'POST', '/api/auth/start'));
  const denied = await call(env, 'GET', `/api/auth/callback?error=access_denied&state=${start.state}`);
  assert.match(await denied.text(), /没有登录/);
  const poll = await call(env, 'GET', `/api/auth/poll?state=${start.state}`);
  assert.equal(poll.status, 403);
  assert.equal((await jsonOf(poll)).error, 'denied');

  assert.equal((await call(env, 'GET', '/api/auth/poll?state=short')).status, 400);
  assert.equal((await call(env, 'GET', `/api/auth/poll?state=${'a'.repeat(43)}`)).status, 410);
});

test('没登录、token 乱写都是 401；没配置 Discord 时 start 给 503', async () => {
  const env = makeEnv();
  assert.equal((await call(env, 'GET', '/api/voices')).status, 401);
  assert.equal((await call(env, 'GET', '/api/voices', { token: 'x'.repeat(43) })).status, 401);
  assert.equal((await call(makeEnv({ DISCORD_CLIENT_ID: '' }), 'POST', '/api/auth/start')).status, 503);
});

test('CORS：预检通过，响应带跨域头', async () => {
  const env = makeEnv();
  const preflight = await call(env, 'OPTIONS', '/api/voices');
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
  const denied = await call(env, 'GET', '/api/voices');
  assert.equal(denied.headers.get('access-control-allow-origin'), '*');
});

test('投稿：校验、头像、重复（不分大小写）', async () => {
  const env = makeEnv();
  const { token } = await login(env, '200100000000000001', '小雨');
  const post = body => call(env, 'POST', '/api/voices', { token, body });

  assert.equal((await post({ name: '', fishId: FISH(1), lang: 'zh' })).status, 400);
  assert.equal((await post({ name: '白露', fishId: 'bad id!', lang: 'zh' })).status, 400);
  const badMagic = await post({ name: '白露', fishId: FISH(1), lang: 'zh', cover: webp(Buffer.from('not an image at all').toString('base64')) });
  assert.equal(badMagic.status, 400);
  assert.equal((await jsonOf(badMagic)).error, 'bad_cover');
  assert.equal((await post({ name: '白露', fishId: FISH(1), lang: 'zh', cover: 'http://evil/x.png' })).status, 400);
  const huge = webp(Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(120 * 1024)]).toString('base64'));
  assert.equal((await post({ name: '白露', fishId: FISH(1), lang: 'zh', cover: huge })).status, 413);

  const ok = await post({ name: ' 白<b>露</b> ', src: '温柔御姐', lang: 'zh-CN', fishId: FISH(1), fishBy: 'Amber', cover: webp(WEBP_B64) });
  assert.equal(ok.status, 201);
  const voice = (await jsonOf(ok)).voice;
  assert.equal(voice.name, '白 b 露 /b');
  assert.equal(voice.lang, 'zh');
  assert.equal(voice.by.name, '小雨');
  assert.equal(voice.mine, true);
  assert.equal(voice.cover, `${ORIGIN}/api/voices/${voice.id}/cover`);

  const dup = await post({ name: '别名', fishId: FISH(1).toUpperCase(), lang: 'ja' });
  assert.equal(dup.status, 409);
  const dupBody = await jsonOf(dup);
  assert.equal(dupBody.error, 'duplicate');
  assert.equal(dupBody.existingId, voice.id);

  const cover = await realFetchless(env, `/api/voices/${voice.id}/cover`);
  assert.equal(cover.status, 200);
  assert.equal(cover.headers.get('content-type'), 'image/webp');
  assert.equal(Buffer.from(await cover.arrayBuffer()).subarray(0, 4).toString(), 'RIFF');
});
const realFetchless = (env, pathname) => call(env, 'GET', pathname);   // 头像不需要登录

test('列表：语言 / 其他 / 搜索（%_ 当普通字符）/ 排序 / 分页 / 计数 / 我的', async () => {
  const env = makeEnv();
  const a = await login(env, '200100000000000001', '小雨');
  const b = await login(env, '200200000000000002', '阿泽');
  const add = (who, name, lang, n, src = '') => call(env, 'POST', '/api/voices', { token: who.token, body: { name, lang, src, fishId: FISH(n) } });
  await add(a, '白露', 'zh', 1, '温柔御姐');
  await add(a, '凛音', 'ja', 2);
  await add(b, 'Marlowe', 'en', 3, 'noir 100% detective');
  await add(b, '하늘', 'ko', 4);
  await add(b, 'Sable_x', 'en', 5);
  await env.DB.prepare('UPDATE voices SET created_at = ?').bind(Date.now()).run();
  const list = async (query, who = a) => jsonOf(await call(env, 'GET', `/api/voices${query}`, { token: who.token }));

  const all = await list('');
  assert.equal(all.items.length, 5);
  assert.deepEqual(all.counts, { all: 5, zh: 1, ja: 1, en: 2, other: 1, mine: 2 });
  assert.equal(all.hero, null, '还没人复制过，没有大卡');
  assert.deepEqual(all.items.map(item => item.name), ['Sable_x', '하늘', 'Marlowe', '凛音', '白露'], '同一毫秒内提交的投稿也按最新的在前');

  assert.deepEqual((await list('?lang=en')).items.map(item => item.name).sort(), ['Marlowe', 'Sable_x']);
  assert.deepEqual((await list('?lang=other')).items.map(item => item.name), ['하늘']);
  assert.deepEqual((await list('?q=100%25')).items.map(item => item.name), ['Marlowe'], '% 不当通配符');
  assert.deepEqual((await list('?q=able_')).items.map(item => item.name), ['Sable_x'], '_ 不当通配符');
  assert.equal((await list(`?q=${FISH(2).slice(-6)}`)).items[0].name, '凛音', '也能按 ID 搜');
  assert.deepEqual((await list('?mine=1')).items.map(item => item.name).sort(), ['凛音', '白露']);

  const page1 = await list('?limit=2');
  assert.equal(page1.items.length, 2);
  assert.equal(page1.hasMore, true);
  const page3 = await list('?limit=2&page=3');
  assert.equal(page3.items.length, 1);
  assert.equal(page3.hasMore, false);
  assert.equal(page3.counts, undefined, '只有第一页带计数');
});

test('复制：每人每个音色只算一次，自己复制自己的不算；有人复制后出现大卡；热门排序', async () => {
  const env = makeEnv();
  const a = await login(env, '200100000000000001', '小雨');
  const b = await login(env, '200200000000000002', '阿泽');
  const c = await login(env, '200300000000000003', '桂花糕');
  const v1 = (await jsonOf(await call(env, 'POST', '/api/voices', { token: a.token, body: { name: '白露', lang: 'zh', fishId: FISH(1) } }))).voice;
  const v2 = (await jsonOf(await call(env, 'POST', '/api/voices', { token: a.token, body: { name: '凛音', lang: 'ja', fishId: FISH(2) } }))).voice;

  const own = await jsonOf(await call(env, 'POST', `/api/voices/${v1.id}/copy`, { token: a.token }));
  assert.deepEqual([own.copies, own.counted], [0, false]);
  const first = await jsonOf(await call(env, 'POST', `/api/voices/${v1.id}/copy`, { token: b.token }));
  assert.deepEqual([first.copies, first.counted], [1, true]);
  const repeat = await jsonOf(await call(env, 'POST', `/api/voices/${v1.id}/copy`, { token: b.token }));
  assert.deepEqual([repeat.copies, repeat.counted], [1, false]);
  const second = await jsonOf(await call(env, 'POST', `/api/voices/${v1.id}/copy`, { token: c.token }));
  assert.equal(second.copies, 2);
  await call(env, 'POST', `/api/voices/${v2.id}/copy`, { token: c.token });

  const list = await jsonOf(await call(env, 'GET', '/api/voices?sort=hot', { token: b.token }));
  assert.deepEqual(list.items.map(item => [item.name, item.copies]), [['白露', 2], ['凛音', 1]]);
  assert.equal(list.hero.name, '白露');
  assert.equal((await call(env, 'POST', '/api/voices/nonexistent1/copy', { token: b.token })).status, 404);
});

test('举报：三个不同的人举报就自动隐藏；本人在「我的」里还能看到；头像不再公开', async () => {
  const env = makeEnv();
  const owner = await login(env, '200100000000000001', '小雨');
  const voice = (await jsonOf(await call(env, 'POST', '/api/voices', { token: owner.token, body: { name: '白露', lang: 'zh', fishId: FISH(1), cover: webp(WEBP_B64) } }))).voice;
  const users = [await login(env, '200200000000000002', 'b'), await login(env, '200300000000000003', 'c'), await login(env, '200400000000000004', 'd')];

  assert.equal((await call(env, 'POST', `/api/voices/${voice.id}/report`, { token: owner.token, body: { reason: 'x' } })).status, 400, '不能举报自己');
  for (const [index, who] of users.entries()) {
    const result = await jsonOf(await call(env, 'POST', `/api/voices/${voice.id}/report`, { token: who.token, body: { reason: '未经同意的克隆' } }));
    assert.equal(result.hidden, index === 2);
  }
  const visible = await jsonOf(await call(env, 'GET', '/api/voices', { token: users[0].token }));
  assert.equal(visible.items.length, 0);
  const mine = await jsonOf(await call(env, 'GET', '/api/voices?mine=1', { token: owner.token }));
  assert.equal(mine.items[0].status, 'hidden');
  assert.equal((await call(env, 'GET', `/api/voices/${voice.id}/cover`)).status, 404);
});

test('删除：本人可以，别人不行，管理员可以；头像、复制记录一起清掉', async () => {
  const env = makeEnv();
  const owner = await login(env, '200100000000000001', '小雨');
  const other = await login(env, '200200000000000002', '阿泽');
  const admin = await login(env, '100100000000000001', '管理员');
  const mk = async n => (await jsonOf(await call(env, 'POST', '/api/voices', { token: owner.token, body: { name: `v${n}`, lang: 'zh', fishId: FISH(n), cover: webp(WEBP_B64) } }))).voice;
  const v1 = await mk(1);
  const v2 = await mk(2);
  await call(env, 'POST', `/api/voices/${v1.id}/copy`, { token: other.token });

  assert.equal((await call(env, 'DELETE', `/api/voices/${v1.id}`, { token: other.token })).status, 403);
  assert.equal((await call(env, 'DELETE', `/api/voices/${v1.id}`, { token: owner.token })).status, 200);
  assert.equal((await call(env, 'DELETE', `/api/voices/${v1.id}`, { token: owner.token })).status, 404);
  assert.equal((await call(env, 'DELETE', `/api/voices/${v2.id}`, { token: admin.token })).status, 200);
  for (const table of ['voices', 'covers', 'copies']) assert.equal(env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
});

test('限流：一天最多投稿 20 个', async () => {
  const env = makeEnv();
  const a = await login(env, '200100000000000001', '小雨');
  for (let n = 1; n <= 20; n += 1) {
    const response = await call(env, 'POST', '/api/voices', { token: a.token, body: { name: `v${n}`, lang: 'zh', fishId: FISH(n) } });
    assert.equal(response.status, 201, `第 ${n} 个`);
  }
  const over = await call(env, 'POST', '/api/voices', { token: a.token, body: { name: 'v21', lang: 'zh', fishId: FISH(21) } });
  assert.equal(over.status, 429);
});

test('服务器核对 Fish（配了 FISH_API_KEY 才会）：不存在、私有会被拦，原作者以 Fish 为准', async () => {
  const env = makeEnv({ FISH_API_KEY: 'k' });
  const a = await login(env, '200100000000000001', '小雨');
  const post = n => call(env, 'POST', '/api/voices', { token: a.token, body: { name: 'x', lang: 'zh', fishId: FISH(n), fishBy: '我乱填的' } });
  fishMode = 'missing';
  assert.equal((await jsonOf(await post(1))).error, 'fish_not_found');
  fishMode = 'private';
  assert.equal((await jsonOf(await post(2))).error, 'fish_private');
  fishMode = 'ok';
  const ok = await jsonOf(await post(3));
  assert.equal(ok.voice.fishBy, 'Fish原作者');
});

test('管理员：举报列表、隐藏/恢复、封人（封了立刻失效，投稿一并隐藏）；普通人碰不了', async () => {
  const env = makeEnv();
  const admin = await login(env, '100100000000000001', '管理员');
  const owner = await login(env, '200100000000000001', '小雨');
  const other = await login(env, '200200000000000002', '阿泽');
  const voice = (await jsonOf(await call(env, 'POST', '/api/voices', { token: owner.token, body: { name: '白露', lang: 'zh', fishId: FISH(1) } }))).voice;
  await call(env, 'POST', `/api/voices/${voice.id}/report`, { token: other.token, body: { reason: 'r' } });

  assert.equal((await call(env, 'GET', '/api/admin/reports', { token: other.token })).status, 403);
  const reports = await jsonOf(await call(env, 'GET', '/api/admin/reports', { token: admin.token }));
  assert.deepEqual(reports.items.map(item => [item.name, item.reports]), [['白露', 1]]);

  await call(env, 'POST', `/api/admin/voices/${voice.id}/status`, { token: admin.token, body: { status: 'hidden' } });
  assert.equal((await jsonOf(await call(env, 'GET', '/api/voices', { token: other.token }))).items.length, 0);
  await call(env, 'POST', `/api/admin/voices/${voice.id}/status`, { token: admin.token, body: { status: 'ok' } });
  assert.equal((await jsonOf(await call(env, 'GET', '/api/voices', { token: other.token }))).items.length, 1);

  assert.equal((await call(env, 'POST', '/api/admin/users/200100000000000001/ban', { token: admin.token, body: { banned: true } })).status, 200);
  assert.equal((await call(env, 'GET', '/api/me', { token: owner.token })).status, 401, '封了以后会话立刻作废');
  assert.equal((await jsonOf(await call(env, 'GET', '/api/voices', { token: other.token }))).items.length, 0, '投稿被隐藏');
  const again = await jsonOf(await call(env, 'POST', '/api/auth/start'));
  await call(env, 'GET', `/api/auth/callback?code=user:200100000000000001:小雨&state=${again.state}`);
  assert.equal((await call(env, 'GET', `/api/auth/poll?state=${again.state}`)).status, 403, '封了以后登不进来');
});

test('退出登录后 token 作废', async () => {
  const env = makeEnv();
  const a = await login(env, '200100000000000001', '小雨');
  assert.equal((await call(env, 'POST', '/api/auth/logout', { token: a.token })).status, 200);
  assert.equal((await call(env, 'GET', '/api/me', { token: a.token })).status, 401);
});

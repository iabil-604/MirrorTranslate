import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import worker from '../workshop-worker/src/index.js';
import { createD1 } from '../workshop-worker/tools/d1-shim.mjs';

export function createBetaWorkshop(origin) {
  const DB = createD1(readFileSync(new URL('../workshop-worker/schema.sql', import.meta.url), 'utf8'));
  const now = Date.now();
  const reader = { id: '90000001', name: '本地试用用户', avatar: '', admin: false };
  const contributor = '90000002';
  const addUser = DB.raw.prepare('INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)');
  addUser.run(reader.id, reader.name, now);
  addUser.run(contributor, '工坊示例', now);
  const addVoice = DB.raw.prepare(`INSERT INTO voices
    (id, user_id, name, src, lang, fish_id, fish_by, copies, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const [index, name, src, lang, copies] of [
    [1, '雨夜旁白', '低声、舒缓 · 示例', 'zh', 12],
    [2, '晴日来信', '清亮对白 · 示例', 'ja', 8],
    [3, 'Evening Radio', 'Warm narrator · Demo', 'en', 4],
  ]) {
    addVoice.run(`demovoice00${index}`, contributor, name, src, lang, String(index).repeat(32), '模拟音色', copies, now - index * 60000);
  }
  const env = { DB, PUBLIC_URL: origin };
  return async (req, res, pathname) => {
    let reply;
    if (pathname === '/preview/workshop/session' && req.method === 'POST') {
      if (req.headers.origin && req.headers.origin !== origin) {
        reply = Response.json({ ok: false }, { status: 403 });
      } else {
        const token = randomBytes(32).toString('base64url');
        const hash = createHash('sha256').update(token).digest('hex');
        DB.raw.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
          .run(hash, reader.id, Date.now() + 24 * 3600000);
        reply = Response.json({ ok: true, base: origin, token, user: reader });
      }
    } else if (/^\/api\/auth\/(?:start|poll|callback)$/.test(pathname)) {
      reply = Response.json({
        ok: false, error: 'preview_sign_in', message: '这是本地试用。刷新页面即可恢复模拟登录。',
      }, { status: 503 });
    } else if (/^\/api\/(?:auth\/logout|me|voices(?:\/.*)?)$/.test(pathname)) {
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      reply = await worker.fetch(new Request(new URL(req.url, origin), {
        method: req.method,
        headers: req.headers,
        ...(hasBody ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
      }), env);
    } else {
      return false;
    }
    res.writeHead(reply.status, { ...Object.fromEntries(reply.headers), 'Cache-Control': 'no-store' });
    res.end(Buffer.from(await reply.arrayBuffer()));
    return true;
  };
}

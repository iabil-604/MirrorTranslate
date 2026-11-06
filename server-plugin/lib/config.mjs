import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { invalid } from './errors.mjs';

export const MODELS = [
  { id: 'drama-3', name: 'Drama 3', description: '支持自然语言表演指令和局部标签，例如：[轻声安慰]你好，<whisper>欢迎回来。</whisper>。当前接入为单个声音朗读。' },
  { id: 's2.1-pro', name: 'S2.1 Pro（常规朗读推荐）', description: 'Fish 推荐的常规语音模型，支持 [开心]、[whisper] 等方括号情绪指令。' },
  { id: 's2-pro', name: 'S2 Pro', description: '上一代 S2 引擎，支持方括号情绪指令，可与 S2.1 Pro 对比声音效果。' },
  { id: 's1', name: 'S1（旧版，已弃用）', description: '使用 (happy) 等圆括号情绪指令。Fish 已宣布弃用 S1；新接入建议选择 S2.1 Pro 或 Drama 3。' },
];
export const BACKENDS = MODELS.map(model => model.id);
export const FORMATS = { mp3: 'audio/mpeg', wav: 'audio/wav', opus: 'audio/ogg', pcm: 'application/octet-stream' };
export const newKey = () => `fish_${randomBytes(32).toString('base64url')}`;

export function voiceId(value) {
  if (typeof value !== 'string') throw invalid('声音 ID 必须是文字。');
  let id = value.trim();
  if (/^https?:\/\//i.test(id)) {
    let url;
    try { url = new URL(id); } catch { throw invalid('声音链接格式不正确。'); }
    if (url.origin !== 'https://fish.audio') throw invalid('请使用 fish.audio 的声音链接。');
    id = url.pathname.match(/\/(?:m|model)\/([A-Za-z0-9_-]+)\/?$/)?.[1] ?? '';
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw invalid('请填写 Fish 声音 ID，或 https://fish.audio/m/… 链接。');
  return id;
}

function boundedInteger(value, name, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw invalid(`${name} 必须在 ${min} 到 ${max} 之间。`);
  return n;
}

export function normalizeToken(value) {
  if (typeof value !== 'string') throw invalid('登录令牌格式不正确。');
  const token = value.trim().replace(/^Bearer\s+/i, '');
  if (token && (['null', 'undefined'].includes(token) || token.length > 16000 || /\s|[\x00-\x1f\x7f]/.test(token))) throw invalid('登录令牌格式不正确。');
  return token;
}

export function validateConfig(input) {
  const config = { ...input };
  if (!['browser', 'token'].includes(config.mode)) throw invalid('登录方式必须是 browser 或 token。');
  if (!BACKENDS.includes(config.backend)) throw invalid('不支持这个 Fish 模型。');
  if (typeof config.proxyKey !== 'string' || config.proxyKey.length < 24 || /\s/.test(config.proxyKey)) throw invalid('本地 Key 至少需要 24 个字符，且不能有空格。');
  if (!['127.0.0.1', 'localhost', '0.0.0.0'].includes(config.host)) throw invalid('监听范围支持本机或局域网，请使用 127.0.0.1 或 0.0.0.0。');
  config.port = boundedInteger(config.port, '端口', 1, 65535);
  config.lan = config.lan ?? (config.host === '0.0.0.0');
  if (typeof config.lan !== 'boolean') throw invalid('局域网开关必须是布尔值。');
  config.timeoutMs = boundedInteger(config.timeoutMs, '超时时间', 1000, 600000);
  config.maxChars = boundedInteger(config.maxChars, '单次文字上限', 1, 30000);
  config.defaultVoice = config.defaultVoice ? voiceId(config.defaultVoice) : '';
  config.fishToken = normalizeToken(config.fishToken ?? '');
  for (const field of ['teamId', 'workspaceId']) {
    if (typeof config[field] !== 'string' || !/^[A-Za-z0-9_-]{0,128}$/.test(config[field])) throw invalid(`${field} 格式不正确。`);
  }
  if (!Array.isArray(config.allowedOrigins) || config.allowedOrigins.some(origin => {
    try { const u = new URL(origin); return !['http:', 'https:'].includes(u.protocol) || u.origin !== origin; } catch { return true; }
  })) throw invalid('allowedOrigins 必须是完整的 http/https 来源地址数组，不能使用通配符。');
  return config;
}

export async function saveJson(path, value) {
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export async function loadConfig(dataDir, env = process.env) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, 'config.json');
  let stored;
  try { stored = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('data/config.json 无法读取或 JSON 格式损坏；请修复后重启，原文件未覆盖。');
    stored = {
      host: '127.0.0.1', port: 7860, proxyKey: newKey(), mode: 'browser',
      backend: 's2.1-pro', defaultVoice: '', fishToken: '', teamId: '', workspaceId: '',
      timeoutMs: 180000, maxChars: 15000, allowedOrigins: [],
    };
    await saveJson(path, stored);
  }
  const overrides = Object.fromEntries([
    ['port', env.FISH_PROXY_PORT], ['host', env.FISH_PROXY_HOST],
    ['proxyKey', env.FISH_PROXY_KEY], ['fishToken', env.FISH_WEB_TOKEN],
    ['mode', env.FISH_AUTH_MODE], ['defaultVoice', env.FISH_DEFAULT_VOICE],
    ['lan', env.FISH_PROXY_HOST !== undefined ? env.FISH_PROXY_HOST === '0.0.0.0' : undefined],
  ].filter(([, value]) => value !== undefined));
  let current = validateConfig({ ...stored, ...overrides });
  let writing = Promise.resolve();
  return {
    get: () => current,
    async update(patch) {
      const allowed = ['mode', 'backend', 'defaultVoice', 'fishToken', 'teamId', 'workspaceId', 'port', 'lan'];
      if (Object.keys(patch).some(key => !allowed.includes(key))) throw invalid('这个设置不能通过管理页修改。');
      if (Object.keys(patch).some(key => key in overrides)) throw invalid('这个设置由环境变量管理，请修改环境变量并重启。');
      const checked = structuredClone(patch);
      const pending = writing.catch(() => {}).then(async () => {
        const nextStored = validateConfig({ ...stored, ...checked });
        const next = validateConfig({ ...nextStored, ...overrides });
        await saveJson(path, nextStored);
        stored = nextStored; current = next; return current;
      });
      writing = pending; return pending;
    },
  };
}

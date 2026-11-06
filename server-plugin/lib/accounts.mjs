import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { saveJson, voiceId } from './config.mjs';
import { POLICIES } from './scheduler.mjs';
import { GatewayError, invalid } from './errors.mjs';

const validId = id => id === 'legacy' || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
const nameOf = value => {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 64) throw invalid('账号备注需要 1–64 个字符。');
  return value.trim();
};

function validate(value) {
  if (!value || value.version !== 1 || !POLICIES.includes(value.policy) || !Array.isArray(value.accounts)) throw new Error('账号配置格式不正确，原文件未覆盖。');
  if (Object.keys(value).some(key => !['version', 'policy', 'accounts', 'currentAccountId', 'voiceAccounts'].includes(key))) throw new Error('账号配置字段不正确，原文件未覆盖。');
  const ids = new Set();
  for (const account of value.accounts) {
    if (!account || typeof account.id !== 'string' || !validId(account.id) || ids.has(account.id)
      || typeof account.enabled !== 'boolean' || Object.keys(account).some(key => !['id', 'name', 'enabled'].includes(key))) {
      throw new Error('账号配置格式不正确，原文件未覆盖。');
    }
    nameOf(account.name); ids.add(account.id);
  }
  if (value.currentAccountId != null && !ids.has(value.currentAccountId)) throw new Error('顺序账号记录不正确，原文件未覆盖。');
  if (value.voiceAccounts !== undefined) {
    if (!value.voiceAccounts || typeof value.voiceAccounts !== 'object' || Array.isArray(value.voiceAccounts)) throw new Error('声音账号配置不正确。');
    for (const [voice, accounts] of Object.entries(value.voiceAccounts)) {
      voiceId(voice);
      if (!Array.isArray(accounts) || accounts.some(id => !ids.has(id)) || new Set(accounts).size !== accounts.length) throw new Error('声音账号范围不正确。');
    }
  }
  return value;
}

// Metadata only. Legacy credentials remain in their original config/environment;
// new browser sessions live in separate directories owned by their provider.
export async function loadAccounts(dataDir, { migrateLegacy = true } = {}) {
  await mkdir(dataDir, { recursive: true });
  const path = join(dataDir, 'accounts.json');
  let current;
  try { current = validate(JSON.parse(await readFile(path, 'utf8'))); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    current = { version: 1, policy: 'round-robin', accounts: migrateLegacy ? [{ id: 'legacy', name: '原有账号', enabled: true }] : [] };
    await saveJson(path, current);
  }
  let writing = Promise.resolve();
  const commit = operation => {
    const pending = writing.catch(() => {}).then(async () => {
      const next = structuredClone(current);
      const result = operation(next);
      validate(next);
      await saveJson(path, next);
      current = next;
      return structuredClone(result);
    });
    writing = pending;
    return pending;
  };
  const lookup = (next, id) => {
    const account = next.accounts.find(account => account.id === id);
    if (!account) throw new GatewayError(404, 'account_not_found', '没有这个账号。');
    return account;
  };
  return {
    snapshot: () => structuredClone(current),
    profileRoot(id) {
      if (!current.accounts.some(account => account.id === id)) throw new GatewayError(404, 'account_not_found', '没有这个账号。');
      return id === 'legacy' ? dataDir : join(dataDir, 'accounts', id);
    },
    add(name) {
      const checked = nameOf(name);
      return commit(next => {
        const account = { id: randomUUID(), name: checked, enabled: true };
        next.accounts.push(account); return account;
      });
    },
    update(id, patch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length
        || Object.keys(patch).some(key => !['name', 'enabled'].includes(key))) return Promise.reject(invalid('只允许修改账号备注和启用状态。'));
      if ('name' in patch) patch = { ...patch, name: nameOf(patch.name) };
      if ('enabled' in patch && typeof patch.enabled !== 'boolean') return Promise.reject(invalid('启用状态必须是布尔值。'));
      const safePatch = structuredClone(patch);
      return commit(next => Object.assign(lookup(next, id), safePatch));
    },
    reorder(ids) {
      const order = Array.isArray(ids) ? [...ids] : null;
      return commit(next => {
        if (!order || order.length !== next.accounts.length || new Set(order).size !== order.length
          || order.some(id => !next.accounts.some(account => account.id === id))) throw invalid('请提供现有账号的完整且无重复顺序。');
        next.accounts = order.map(id => lookup(next, id)); return next.accounts;
      });
    },
    remove(id) {
      return commit(next => {
        lookup(next, id); next.accounts = next.accounts.filter(account => account.id !== id);
        if (next.currentAccountId === id) next.currentAccountId = null;
        for (const [voice, ids] of Object.entries(next.voiceAccounts ?? {})) next.voiceAccounts[voice] = ids.filter(value => value !== id);
        return { removed: true };
      });
    },
    setPolicy(policy) {
      if (!POLICIES.includes(policy)) return Promise.reject(invalid('调度方式不正确。'));
      return commit(next => { next.policy = policy; return { policy }; });
    },
    setCursor(id) {
      return commit(next => { if (id !== null) lookup(next, id); next.currentAccountId = id; return { currentAccountId: id }; });
    },
    setVoiceAccounts(voice, ids) {
      const checked = voiceId(voice);
      const allowed = ids === null ? null : Array.isArray(ids) ? [...ids] : undefined;
      return commit(next => {
        if (allowed === undefined || (allowed && (new Set(allowed).size !== allowed.length || allowed.some(id => !next.accounts.some(account => account.id === id))))) throw invalid('声音账号范围不正确。');
        next.voiceAccounts ??= {};
        if (allowed === null) delete next.voiceAccounts[checked];
        else next.voiceAccounts[checked] = allowed;
        return next.voiceAccounts;
      });
    },
  };
}

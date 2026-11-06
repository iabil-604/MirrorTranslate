import { GatewayError, invalid } from './errors.mjs';

export const POLICIES = ['round-robin', 'sequential'];
const unavailable = () => new GatewayError(503, 'no_available_accounts', '没有能够处理这段语音的可用账号。');

// Owns account reservations only. The caller holds a lease until its audio stream
// and upstream cleanup finish; aborting a client does not itself free that lease.
export class AccountScheduler {
  constructor({ accounts, policy = 'round-robin', maxQueue = 100, queueTimeoutMs = 120000, currentAccountId = null }) {
    if (typeof accounts !== 'function') throw new TypeError('accounts must be a function');
    if (!POLICIES.includes(policy)) throw invalid('调度方式不正确。');
    if (!Number.isInteger(maxQueue) || maxQueue < 1) throw invalid('队列上限必须是正整数。');
    if (!Number.isFinite(queueTimeoutMs) || queueTimeoutMs <= 0) throw invalid('排队超时必须大于零。');
    this.accounts = accounts;
    this.policy = policy;
    this.pendingPolicy = null;
    this.maxQueue = maxQueue;
    this.queueTimeoutMs = queueTimeoutMs;
    this.queue = [];
    this.busy = new Map();
    this.lastAccount = null;
    this.currentAccount = currentAccountId;
    this.closed = false;
    this.cooldownUntil = 0;
    this.suspended = false;
  }

  snapshot() {
    return {
      policy: this.policy, pendingPolicy: this.pendingPolicy,
      queued: this.queue.length, active: this.busy.size,
      currentAccountId: this.policy === 'sequential' ? this.currentAccount : null,
      activeAccountIds: [...this.busy.values()].map(lease => lease.account.id),
      cooldownUntil: this.cooldownUntil > Date.now() ? new Date(this.cooldownUntil).toISOString() : null,
    };
  }

  cooldown(milliseconds) {
    if (this.closed) return;
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + milliseconds);
    clearTimeout(this.cooldownTimer);
    this.cooldownTimer = setTimeout(() => this.changed(), this.cooldownUntil - Date.now());
    this.cooldownTimer.unref?.();
  }
  suspend() { this.suspended = true; }
  resume() { this.suspended = false; this.changed(); }

  setPolicy(policy) {
    if (!POLICIES.includes(policy)) throw invalid('调度方式不正确。');
    // In-flight requests keep their reservations. Pause new dispatches until
    // all of them finish, so switching into sequential mode is truly strict.
    if (policy === this.policy) this.pendingPolicy = null;
    else if (this.busy.size) this.pendingPolicy = policy;
    else { this.policy = policy; this.pendingPolicy = null; }
    this.changed();
  }

  acquire({ signal, accountIds } = {}) {
    if (this.closed) return Promise.reject(new GatewayError(503, 'service_stopping', '服务正在停止。'));
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (accountIds !== undefined && (!Array.isArray(accountIds) || accountIds.some(id => typeof id !== 'string'))) {
      return Promise.reject(invalid('账号范围格式不正确。'));
    }
    this.changed();
    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(new GatewayError(429, 'queue_full', '等待队列已满，请稍后再试。'));
    }
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal, allowed: accountIds ? new Set(accountIds) : null };
      const fail = error => {
        const index = this.queue.indexOf(entry);
        if (index < 0) return;
        this.queue.splice(index, 1);
        this.cleanup(entry);
        reject(error);
        this.changed();
      };
      entry.abort = () => fail(signal.reason);
      entry.timer = setTimeout(() => fail(new GatewayError(504, 'queue_timeout', '等待可用账号超时，尚未提交生成。')), this.queueTimeoutMs);
      signal?.addEventListener('abort', entry.abort, { once: true });
      this.queue.push(entry);
      this.changed();
    });
  }

  cleanup(entry) {
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.abort);
  }

  changed() {
    if (this.closed || this.suspended) return;
    if (this.cooldownUntil > Date.now()) return;
    if (this.pendingPolicy) {
      if (this.busy.size) return;
      this.policy = this.pendingPolicy;
      this.pendingPolicy = null;
    }
    const accounts = this.accounts();
    const usable = accounts.filter(account => account.enabled !== false && account.status === 'ready');
    const identity = account => account.identityKey || account.id;
    if (this.policy === 'sequential' && !usable.some(account => account.id === this.currentAccount)) {
      const index = accounts.findIndex(account => account.id === this.currentAccount);
      const ordered = [...accounts.slice(index + 1), ...accounts.slice(0, index + 1)];
      this.currentAccount = ordered.find(account => usable.includes(account))?.id ?? null;
    }
    for (let i = 0; i < this.queue.length;) {
      const entry = this.queue[i];
      const eligible = usable.filter(account => !entry.allowed || entry.allowed.has(account.id));
      if (!eligible.length) {
        this.queue.splice(i, 1);
        this.cleanup(entry);
        entry.reject(unavailable());
        continue;
      }
      let account;
      if (this.policy === 'sequential') {
        if (this.busy.size) { i++; continue; }
        account = eligible.find(account => account.id === this.currentAccount) ?? eligible[0];
      } else {
        const last = accounts.findIndex(account => account.id === this.lastAccount);
        const ordered = [...accounts.slice(last + 1), ...accounts.slice(0, last + 1)];
        account = ordered.find(candidate => eligible.includes(candidate) && !this.busy.has(identity(candidate)));
      }
      if (!account) { i++; continue; }
      this.queue.splice(i, 1);
      this.cleanup(entry);
      const key = identity(account);
      let released = false;
      const lease = {
        account: Object.freeze({ ...account }),
        release: () => {
          if (released) return;
          released = true;
          this.busy.delete(key);
          this.changed();
        },
      };
      this.busy.set(key, lease);
      this.lastAccount = account.id;
      entry.resolve(lease);
    }
  }

  close() {
    this.closed = true;
    clearTimeout(this.cooldownTimer);
    for (const entry of this.queue.splice(0)) {
      this.cleanup(entry);
      entry.reject(new GatewayError(503, 'service_stopping', '服务正在停止，排队请求未提交。'));
    }
  }
}

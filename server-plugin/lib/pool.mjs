import { AccountScheduler } from './scheduler.mjs';
import { GatewayError } from './errors.mjs';

const PREFLIGHT_ACCOUNT_ERRORS = new Set([
  'fish_login_required', 'fish_session_expired', 'fish_session_changed',
  'fish_verification_required', 'browser_validation_needed', 'browser_unavailable', 'browser_not_found',
]);
const stateFor = error => {
  if (['fish_login_required', 'fish_session_expired', 'browser_unavailable', 'browser_not_found'].includes(error.code)) return 'login-required';
  if (['fish_verification_required', 'browser_validation_needed'].includes(error.code)) return 'verification-required';
  if (error.code === 'fish_quota_exhausted') return 'quota-exhausted';
  return 'unavailable';
};

// Separates browser containers, authenticated identities, wallet observations,
// and scheduler leases. No credentials are exposed in snapshots or persisted here.
export class AccountPool {
  constructor({ accounts, config, providerFactory, maxQueue, queueTimeoutMs }) {
    this.accounts = accounts; this.config = config; this.providerFactory = providerFactory;
    this.runtime = new Map(); this.providers = new Map(); this.initializing = false;
    const saved = accounts.snapshot();
    this.scheduler = new AccountScheduler({ accounts: () => this.candidates(), policy: saved.policy,
      currentAccountId: saved.currentAccountId ?? null, maxQueue, queueTimeoutMs });
  }
  metadata(id) {
    const value = this.accounts.snapshot().accounts.find(account => account.id === id);
    if (!value) throw new GatewayError(404, 'account_not_found', '没有这个账号。');
    return value;
  }
  state(id) {
    this.metadata(id);
    if (!this.runtime.has(id)) this.runtime.set(id, { status: 'login-required', balance: null, balanceCheckedAt: null, balanceError: null, type: null, errorCode: null });
    return this.runtime.get(id);
  }
  provider(id) {
    this.metadata(id);
    if (!this.providers.has(id)) this.providers.set(id, this.providerFactory(id, this.accounts.profileRoot(id)));
    return this.providers.get(id);
  }
  accountConfig(id, config = this.config.get()) {
    const current = this.config.get();
    return id === 'legacy' ? { ...config, mode: current.mode, fishToken: current.fishToken, teamId: current.teamId, workspaceId: current.workspaceId }
      : { ...config, mode: 'browser', fishToken: '', teamId: '', workspaceId: '' };
  }
  candidates() {
    return this.accounts.snapshot().accounts.map(account => {
      const state = this.state(account.id);
      return { ...account, status: state.deleting || state.refreshing ? 'unavailable' : state.status, identityKey: state.identityKey };
    });
  }
  isBusy(id, includeIdentity = true) {
    const state = this.state(id);
    return [...this.scheduler.busy.values()].some(lease => lease.account.id === id || (includeIdentity && state.identityKey && lease.account.identityKey === state.identityKey));
  }
  changed() { if (!this.initializing) this.scheduler.changed(); }
  snapshot() {
    const identities = new Map(), wallets = new Map();
    return { accounts: this.accounts.snapshot().accounts.map((account, order) => {
      const state = this.state(account.id);
      const duplicateOf = state.identityKey ? identities.get(state.identityKey) ?? null : null;
      const sharesQuotaWith = state.walletKey ? wallets.get(state.walletKey) ?? null : null;
      if (state.identityKey && !duplicateOf) identities.set(state.identityKey, account.id);
      if (state.walletKey && !sharesQuotaWith) wallets.set(state.walletKey, account.id);
      return { ...account, order, status: account.enabled && !state.deleting ? state.status : 'disabled',
        busy: this.isBusy(account.id), refreshing: !!state.refreshing, deleting: !!state.deleting,
        balance: state.balance, balanceCheckedAt: state.balanceCheckedAt, balanceError: state.balanceError,
        type: state.type, errorCode: state.errorCode, duplicateOf, sharesQuotaWith };
    }), scheduler: this.scheduler.snapshot() };
  }
  async initialize() {
    this.initializing = true;
    try { await Promise.allSettled(this.accounts.snapshot().accounts.filter(account => account.enabled).map(account => this.refresh(account.id, AbortSignal.timeout(10000)))); }
    finally { this.initializing = false; this.changed(); }
  }
  async add(name) { const account = await this.accounts.add(name); this.state(account.id); this.changed(); return this.snapshot().accounts.find(value => value.id === account.id); }
  async update(id, patch) {
    if (this.state(id).deleting) throw new GatewayError(409, 'account_deleting', '账号正在删除。');
    await this.accounts.update(id, patch); this.changed(); return this.snapshot().accounts.find(account => account.id === id);
  }
  async reorder(ids) { await this.accounts.reorder(ids); this.changed(); return this.snapshot(); }
  async setPolicy(policy) { await this.accounts.setPolicy(policy); this.scheduler.setPolicy(policy); return this.scheduler.snapshot(); }
  async open(id) {
    const state = this.state(id);
    if (this.isBusy(id) || state.refreshing || state.deleting) throw new GatewayError(409, 'account_busy', '请等待该账号当前操作结束。');
    state.status = 'login-required'; state.fingerprint = null; this.changed();
    await this.provider(id).browser.open();
    return { opened: true };
  }
  async refresh(id, signal) {
    const state = this.state(id);
    if (this.isBusy(id) || state.refreshing || state.deleting) throw new GatewayError(409, 'account_busy', '请等待该账号当前操作结束。');
    state.refreshing = true; this.changed();
    try {
      const observed = await this.provider(id).client.inspect(this.accountConfig(id), signal);
      if (!observed.identityKey || !observed.fingerprint || !observed.walletKey) throw new GatewayError(502, 'fish_identity_unknown', '无法确认账号身份。');
      Object.assign(state, observed, { status: observed.balance === 0 ? 'quota-exhausted' : 'ready', errorCode: null });
      this.shareBalance(id);
    } catch (error) {
      state.status = stateFor(error); state.errorCode = error.code ?? 'account_check_failed';
      throw error;
    } finally { state.refreshing = false; this.changed(); }
    return this.snapshot().accounts.find(account => account.id === id);
  }
  shareBalance(id) {
    const state = this.state(id);
    if (!state.walletKey || state.balanceError) return;
    for (const [otherId, other] of this.runtime) {
      if (otherId === id || other.walletKey !== state.walletKey) continue;
      for (const key of ['balance', 'balanceCheckedAt', 'balanceError', 'type']) other[key] = state[key];
      if (state.balance === 0 && other.status === 'ready') other.status = 'quota-exhausted';
      else if (state.balance > 0 && other.status === 'quota-exhausted') other.status = 'ready';
    }
  }
  markFailure(id, error) {
    const state = this.state(id);
    if (error.code === 'fish_rate_limited') {
      // The website currently supplies no verified scope field. Conservatively
      // cool down the whole service instead of rotating to evade a limit.
      this.scheduler.cooldown(Math.min(600000, Math.max(1000, Number(error.retryAfter || 30) * 1000)));
    } else if (PREFLIGHT_ACCOUNT_ERRORS.has(error.code) || error.code === 'fish_quota_exhausted') {
      state.status = stateFor(error); state.errorCode = error.code;
      if (error.code === 'fish_quota_exhausted' && state.walletKey) {
        for (const other of this.runtime.values()) if (other.walletKey === state.walletKey) { other.status = 'quota-exhausted'; other.errorCode = error.code; }
      }
    }
    // A network failure is not evidence that every saved account is invalid.
    this.changed();
  }
  async generate(task, config, signal, { onAcquire = () => {}, onSubmission = () => {} } = {}) {
    if (this.initializing) throw new GatewayError(503, 'service_initializing', '正在检查账号，请稍后再试。');
    const attempted = new Set();
    const eligible = this.accounts.snapshot().voiceAccounts?.[task.model];
    let lastError;
    while (true) {
      const ids = this.accounts.snapshot().accounts.map(account => account.id).filter(id => !attempted.has(id) && (!eligible || eligible.includes(id)));
      if (!ids.length && lastError) throw lastError;
      let lease;
      try { lease = await this.scheduler.acquire({ signal, accountIds: ids }); }
      catch (error) { if (lastError && error.code === 'no_available_accounts') throw lastError; throw error; }
      const id = lease.account.id;
      attempted.add(id);
      try {
        const state = this.state(id), provider = this.provider(id);
        onAcquire(id);
        const current = this.scheduler.snapshot().currentAccountId;
        if (current && this.accounts.snapshot().currentAccountId !== current) await this.accounts.setCursor(current);
        const response = await provider.client.generate(task, this.accountConfig(id, config), signal, { expectedFingerprint: state.fingerprint, onSubmission });
        let released = false;
        return { response, accountId: id, release: async (completed = false) => {
          if (released) return; released = true;
          try {
            if (completed && !state.deleting && !this.scheduler.closed) {
              try {
                const observed = await provider.client.inspect(this.accountConfig(id, config), AbortSignal.timeout(5000));
                if (observed.fingerprint === state.fingerprint) {
                  Object.assign(state, observed, { status: observed.balance === 0 ? 'quota-exhausted' : 'ready' }); this.shareBalance(id);
                } else { state.status = 'unavailable'; state.errorCode = 'fish_session_changed'; }
              } catch (error) { state.balanceError = error.code ?? 'balance_check_failed'; }
            }
          } finally { lease.release(); this.finishDeletes(); }
        } };
      } catch (error) {
        this.markFailure(id, error); lease.release(); this.finishDeletes();
        if (signal?.aborted || error.submission !== 'not-submitted' || !PREFLIGHT_ACCOUNT_ERRORS.has(error.code)) throw error;
        lastError = error;
      }
    }
  }
  async remove(id) {
    const state = this.state(id);
    if (state.refreshing) throw new GatewayError(409, 'account_busy', '请等待账号检查完成。');
    await this.accounts.update(id, { enabled: false }); state.deleting = true; this.changed();
    if (this.isBusy(id, false)) return { pending: true };
    await this.finishDelete(id); return { removed: true };
  }
  async finishDelete(id) {
    const state = this.state(id);
    if (state.deletion) return state.deletion;
    state.deletion = (async () => {
      await this.provider(id).browser.forget();
      if (id === 'legacy' && this.config.get().fishToken) await this.config.update({ fishToken: '', teamId: '', workspaceId: '' });
      await this.accounts.remove(id); this.providers.delete(id); this.runtime.delete(id); this.changed();
    })().catch(error => { state.errorCode = error.code ?? 'account_delete_failed'; state.deletion = null; throw error; });
    return state.deletion;
  }
  finishDeletes() {
    for (const [id, state] of this.runtime) if (state.deleting && !state.deletion && !this.isBusy(id, false)) this.finishDelete(id).catch(() => {});
  }
  async voices(query, signal, id) {
    const selected = id ? this.metadata(id) : this.candidates().find(account => account.enabled && account.status === 'ready');
    if (!selected) throw new GatewayError(503, 'no_available_accounts', '请先连接一个可用账号。');
    return this.provider(selected.id).client.voices(query, this.accountConfig(selected.id), signal);
  }
  close() { this.scheduler.close(); }
}

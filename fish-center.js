import { FISH_SERVICE_MISSING, fishManagedRequest, missingFishService } from './fish-web.js?v=0.51.5';

export const FISH_CENTER_ENTRY = '<button type="button" class="jy-button" data-jy-action="goto-advanced" data-jy-goto-page="tts" data-jy-open-fold="tts-fish-center">Fish 管理 →</button>';

export const FISH_CENTER_MARKUP = `
<details class="jy-text-scope jy-fold" data-jy-fold="tts-fish-center">
  <summary><h2>Fish 管理</h2></summary>
  <div class="jy-form-body">
  <section class="jy-brief">
    <div class="jy-row-between"><h2>网页订阅</h2><span data-fish-state></span></div>
    <div class="jy-actions">
      <button type="button" class="jy-button" data-fish-action="start" hidden>启动服务</button>
      <button type="button" class="jy-button" data-fish-action="stop" hidden>停止服务</button>
      <button type="button" class="jy-button" data-fish-action="use" hidden>设为朗读来源</button>
      <button type="button" class="jy-text-button" data-fish-action="refresh">刷新</button>
    </div>
    <p class="jy-muted" data-fish-note role="status" hidden></p>
    <a class="jy-text-button" data-fish-install href="https://github.com/iabil-604/MirrorTranslate/releases/latest/download/MirrorTranslate.zip" target="_blank" rel="noopener noreferrer" hidden>下载镜译安装包</a>
  </section>
  <div data-fish-workspace hidden>
    <section class="jy-brief">
      <div class="jy-row-between"><h2>账号</h2><span class="jy-muted" data-fish-ready></span></div>
      <form class="jy-inline-actions" data-fish-form="add">
        <input name="name" aria-label="账号备注" placeholder="账号备注" maxlength="64" required>
        <button class="jy-button" type="submit">添加账号</button>
      </form>
      <label class="jy-inline-field"><span class="jy-label">账号调度</span>
        <select data-fish-policy><option value="round-robin">轮询并行</option><option value="sequential">按顺序用完</option></select>
      </label>
      <ul class="jy-fish-list" data-fish-accounts></ul>
    </section>
    <section class="jy-brief">
      <h2>音色与试听</h2>
      <div class="jy-form-grid jy-form-grid-tight">
        <label><span class="jy-label">合成模型</span><select data-fish-model></select></label>
        <label><span class="jy-label">默认音色</span><input data-fish-voice placeholder="音色 ID 或 Fish 链接" spellcheck="false"></label>
      </div>
      <form class="jy-inline-actions" data-fish-form="search">
        <input name="query" aria-label="音色名称" placeholder="音色名称" maxlength="100">
        <button class="jy-button" type="submit">搜索音色</button>
      </form>
      <div class="jy-actions" data-fish-voices hidden></div>
      <label><span class="jy-label">试听文本</span><textarea data-fish-text rows="2" maxlength="15000">你好，这是镜译的试听。</textarea></label>
      <div class="jy-actions">
        <button type="button" class="jy-button" data-fish-action="save-voice">保存默认音色</button>
        <button type="button" class="jy-button" data-fish-action="preview">生成试听</button>
      </div>
      <div class="jy-actions" data-fish-player hidden>
        <audio controls preload="metadata" aria-label="Fish 试听"></audio>
        <a class="jy-text-button" data-fish-download download="fish-preview.wav">下载音频</a>
      </div>
    </section>
    <section class="jy-brief">
      <div class="jy-row-between"><h2>最近任务</h2><span class="jy-muted" data-fish-queue></span></div>
      <ul class="jy-fish-list" data-fish-tasks></ul>
    </section>
  </div>
  </div>
</details>`;

const SERVICE_STATES = { stopped: '未启动', starting: '启动中…', running: '运行中', stopping: '停止中…' };
const ACCOUNT_STATES = {
  ready: '可用', 'login-required': '待登录', 'verification-required': '待验证',
  'quota-exhausted': '额度用完', unavailable: '不可用', disabled: '已停用',
};
const TASK_STATES = {
  queued: '排队中', preparing: '网页验证', submitting: '提交中',
  streaming: '接收音频', completed: '已完成', failed: '失败', cancelled: '已取消',
};
const MODELS = { 'drama-3': 'Drama 3', 's2.1-pro': 'S2.1 Pro', 's2-pro': 'S2 Pro', s1: 'S1（旧版）' };
const accountPath = id => `/accounts/${encodeURIComponent(id)}`;

export function createFishCenter(root, { headers, selected, use, onSettings }) {
  const page = root.querySelector('[data-jy-page="tts"]');
  const fold = page.querySelector('[data-jy-fold="tts-fish-center"]');
  const field = name => fold.querySelector(`[data-fish-${name}]`);
  const button = action => fold.querySelector(`[data-fish-action="${action}"]`);
  const document = fold.ownerDocument;
  const audio = fold.querySelector('audio');
  let visible;
  let timer;
  let busy = false;
  let refreshing = false;
  let status = '';
  let accounts = [];
  let scheduler = {};
  let tasks = [];
  let audioUrl;
  let settingsLoaded = false;
  let stopArmed = false;
  let accountSignature = '';
  let taskSignature = '';

  const api = (path, options = {}, signal = visible?.signal) => {
    if (!signal) throw new DOMException('Fish 管理页已关闭。', 'AbortError');
    signal.throwIfAborted();
    return fishManagedRequest(path, { ...options, signal, headers: headers() });
  };
  const json = async (path, options, signal) => (await api(path, options, signal)).json();

  function note(message = '', error) {
    field('note').textContent = message;
    field('note').hidden = !message;
    field('note').dataset.state = error ? 'error' : '';
    field('install').hidden = error?.code !== FISH_SERVICE_MISSING;
  }

  function statusView(next) {
    status = next;
    if (next !== 'running') stopArmed = false;
    field('state').textContent = SERVICE_STATES[next] ?? '服务不可用';
    button('start').hidden = next !== 'stopped';
    button('stop').hidden = next !== 'running';
    button('stop').textContent = stopArmed ? '确认停止' : '停止服务';
    button('use').hidden = next !== 'running';
    button('use').disabled = selected();
    button('use').textContent = selected() ? '已用于朗读' : '设为朗读来源';
    field('workspace').hidden = next !== 'running';
  }

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function action(label, handler) {
    const element = node('button', label, 'jy-text-button');
    element.type = 'button';
    element.addEventListener('click', () => void run(element, handler));
    return element;
  }

  async function mutate(path, method, body, message) {
    await json(path, { method, body });
    note(message);
    await loadState({ force: true });
  }

  function renderAccounts(force) {
    const list = field('accounts');
    const currentFocus = page.getRootNode().activeElement;
    const signature = JSON.stringify(accounts);
    if (signature === accountSignature || (!force && list.contains(currentFocus))) return;
    accountSignature = signature;
    list.replaceChildren(...accounts.map((account, index) => {
      const row = node('li', undefined, 'jy-card-row');
      const heading = node('div', undefined, 'jy-card-row-text');
      heading.append(node('strong', account.name), node('p', [
        account.deleting ? '正在移除' : account.refreshing ? '检查中' : ACCOUNT_STATES[account.status] ?? '待检查',
        Number.isFinite(account.balance) ? `额度 ${account.balance}` : '',
        account.duplicateOf ? '重复账号' : account.sharesQuotaWith ? '共享额度' : '',
      ].filter(Boolean).join(' · '), 'jy-muted'));
      const controls = node('div', undefined, 'jy-actions');
      const login = action('登录 / 验证', () => mutate(`${accountPath(account.id)}/login`, 'POST', {},
        '登录后回到镜译点「检查」。朗读时保留 Fish 窗口。'));
      const check = action('检查', () => mutate(`${accountPath(account.id)}/refresh`, 'POST', {}, '账号已检查。'));
      login.disabled = check.disabled = account.busy || account.refreshing || account.deleting;
      controls.append(login, check);
      if (!account.deleting) {
        const edit = node('details');
        edit.append(node('summary', '编辑'));
        const form = node('form', undefined, 'jy-inline-actions');
        const name = node('input');
        name.value = account.name;
        name.maxLength = 64;
        name.required = true;
        name.setAttribute('aria-label', '账号备注');
        const save = node('button', '保存备注', 'jy-button');
        save.type = 'submit';
        form.append(name, save);
        form.addEventListener('submit', event => {
          event.preventDefault();
          void run(save, () => mutate(accountPath(account.id), 'PATCH', { name: name.value.trim() }, '备注已保存。'));
        });
        const move = offset => {
          const ids = accounts.map(item => item.id);
          const position = ids.indexOf(account.id);
          if (position + offset < 0 || position + offset >= ids.length) return;
          [ids[position], ids[position + offset]] = [ids[position + offset], ids[position]];
          return mutate('/accounts/order', 'POST', { ids }, '账号顺序已保存。');
        };
        const up = action('上移', () => move(-1));
        const down = action('下移', () => move(1));
        up.disabled = index === 0;
        down.disabled = index === accounts.length - 1;
        const removeConfirm = node('details');
        removeConfirm.append(node('summary', '移除'), node('p', '移除会清除这个账号在镜译里的登录状态。', 'jy-muted'),
          action('确认移除', () => mutate(accountPath(account.id), 'DELETE', undefined, '移除请求已提交。')));
        edit.append(form, action(account.enabled ? '停用' : '启用', () =>
          mutate(accountPath(account.id), 'PATCH', { enabled: !account.enabled }, '账号状态已保存。')), up, down, removeConfirm);
        controls.append(edit);
      }
      row.append(heading, controls);
      return row;
    }));
  }

  function renderTasks(force) {
    const list = field('tasks');
    const signature = JSON.stringify(tasks);
    if (signature === taskSignature || (!force && list.contains(page.getRootNode().activeElement))) return;
    taskSignature = signature;
    list.replaceChildren(...tasks.map(task => {
      const row = node('li', undefined, 'jy-card-row');
      const time = new Date(task.createdAt).toLocaleTimeString();
      const account = accounts.find(item => item.id === task.accountId)?.name;
      const result = task.stage === 'failed' && ['accepted', 'unknown'].includes(task.submission)
        ? '到 Fish 官网核对' : TASK_STATES[task.stage] ?? task.stage;
      row.append(node('span', [time, account, MODELS[task.backend], `${task.inputCharacters} 字`, result]
        .filter(Boolean).join(' · ')));
      if (task.stage === 'queued') row.append(action('取消', () =>
        mutate(`/tasks/${encodeURIComponent(task.requestId)}`, 'DELETE', undefined, '排队任务已取消。')));
      return row;
    }));
    if (!tasks.length) list.append(node('li', '暂无任务', 'jy-muted'));
  }

  function renderSettings(settings) {
    const model = field('model');
    model.replaceChildren(...settings.models.map(entry => {
      const option = node('option', MODELS[entry.id] ?? entry.name);
      option.value = entry.id;
      return option;
    }));
    model.value = settings.backend;
    field('voice').value = settings.defaultVoice;
    onSettings(settings);
    settingsLoaded = true;
  }

  async function loadState({ force = false, signal = visible?.signal } = {}) {
    signal?.throwIfAborted();
    const state = await json('/state', undefined, signal).catch(error => {
      if (error instanceof SyntaxError) throw missingFishService();
      throw error;
    });
    signal?.throwIfAborted();
    if (state?.service !== 'mirrortranslate-fish') throw missingFishService();
    if (!field('install').hidden) note();
    statusView(state.status);
    if (state.status !== 'running') {
      settingsLoaded = false;
      return;
    }
    const [pool, queue, settings] = await Promise.all([
      json('/accounts', undefined, signal), json('/tasks', undefined, signal),
      settingsLoaded ? null : json('/settings', undefined, signal),
    ]);
    signal?.throwIfAborted();
    accounts = pool.accounts;
    scheduler = pool.scheduler;
    tasks = queue.tasks.slice(0, 15);
    field('ready').textContent = `${accounts.filter(account => account.status === 'ready').length} / ${accounts.length} 可用`;
    field('policy').value = scheduler.pendingPolicy ?? scheduler.policy;
    field('queue').textContent = `生成中 ${scheduler.active} · 排队 ${scheduler.queued}`;
    renderAccounts(force);
    renderTasks(force);
    if (settings) renderSettings(settings);
  }

  async function run(control, handler) {
    if (busy || !visible || control.disabled) return;
    const preview = control === button('preview');
    if (!preview) busy = true;
    const current = visible;
    // Let an in-flight read finish before mutating the same controls.
    control.disabled = true;
    try {
      await refreshing;
      current.signal.throwIfAborted();
      await handler(current.signal);
    } catch (error) {
      if (!current.signal.aborted && (!preview || status === 'running')) note(error.message, error);
    } finally {
      control.disabled = control === button('use') && selected();
      if (!preview) busy = false;
    }
  }

  const voiceValues = () => ({ backend: field('model').value, defaultVoice: field('voice').value.trim() });
  const handlers = {
    start: async () => {
      statusView('starting');
      try { await mutate('/service/start', 'POST', {}, 'Fish 已启动。'); }
      catch (error) { statusView('stopped'); throw error; }
    },
    stop: async () => {
      if ((scheduler.active || scheduler.queued || button('preview').disabled) && !stopArmed) {
        stopArmed = true;
        statusView('running');
        note('停止会中断请求。已提交的任务请到 Fish 官网核对。');
        return;
      }
      statusView('stopping');
      try { await mutate('/service/stop', 'POST', {}, 'Fish 已停止。'); }
      catch (error) { statusView('running'); throw error; }
    },
    use: () => {
      use();
      statusView(status);
      note('已用于朗读。');
    },
    refresh: async () => { await loadState({ force: true }); note('已刷新。'); },
    'save-voice': async () => {
      await json('/settings', { method: 'POST', body: voiceValues() });
      renderSettings(await json('/settings'));
      note('默认音色已保存。');
    },
    preview: async signal => {
      const { backend, defaultVoice } = voiceValues();
      const input = field('text').value.trim();
      if (!input || !defaultVoice) throw new Error('请填写试听文本和音色。');
      note('正在生成试听…');
      const response = await api('/speech', { method: 'POST', body: {
        model: backend, voice: defaultVoice, input, response_format: 'wav', speed: 1,
      } }, AbortSignal.any([signal, AbortSignal.timeout(240000)]));
      const blob = await response.blob();
      signal.throwIfAborted();
      if (!blob.size || !blob.type.startsWith('audio/')) throw new Error('Fish 未返回可播放的音频。');
      releaseAudio();
      audioUrl = URL.createObjectURL(blob);
      audio.src = field('download').href = audioUrl;
      field('player').hidden = false;
      void audio.play().catch(() => {});
      note('试听已生成。');
    },
  };

  fold.addEventListener('click', event => {
    const control = event.target.closest('[data-fish-action]');
    const name = control?.dataset.fishAction;
    if (Object.hasOwn(handlers, name)) void run(control, handlers[name]);
  });
  fold.addEventListener('submit', event => {
    const form = event.target;
    const name = form.dataset.fishForm;
    if (!name) return;
    event.preventDefault();
    void run(form.querySelector('button[type="submit"]'), async () => {
      if (name === 'add') {
        await mutate('/accounts', 'POST', { name: form.elements.name.value.trim() }, '账号已添加。');
        form.reset();
      } else {
        const result = await json(`/voices?q=${encodeURIComponent(form.elements.query.value.trim())}`);
        const list = field('voices');
        list.hidden = false;
        list.replaceChildren(...result.voices.map(voice => action(voice.name || voice.id, () => {
          field('voice').value = voice.id;
          list.hidden = true;
          field('voice').focus();
        })));
        if (!result.voices.length) list.append(node('span', '未找到音色', 'jy-muted'));
      }
    });
  });
  field('policy').addEventListener('change', event => {
    const { value } = event.target;
    void run(event.target, async () => {
      try { await mutate('/scheduler', 'PATCH', { policy: value }, '调度已保存。'); }
      catch (error) { field('policy').value = scheduler.pendingPolicy ?? scheduler.policy; throw error; }
    });
  });

  function releaseAudio() {
    if (!audioUrl) return;
    audio.pause();
    audio.removeAttribute('src');
    field('download').removeAttribute('href');
    field('player').hidden = true;
    URL.revokeObjectURL(audioUrl);
    audioUrl = null;
  }

  function cleanup() {
    visible?.abort();
    visible = undefined;
    stopArmed = false;
    clearInterval(timer);
    releaseAudio();
  }

  function poll(initial = false) {
    if (!visible || busy || refreshing) return;
    const { signal } = visible;
    refreshing = loadState({ signal }).catch(error => {
      if (signal.aborted) return;
      if (initial) statusView('');
      note(error.message, error);
    }).finally(() => { refreshing = false; });
  }

  function syncVisibility() {
    if (page.hidden || page.dataset.jyTtsOff === 'true' || fold.hidden || !fold.open) return cleanup();
    if (visible) return;
    visible = new AbortController();
    settingsLoaded = false;
    statusView('');
    field('state').textContent = '正在读取…';
    note();
    poll(true);
    timer = setInterval(poll, 3000);
  }

  fold.addEventListener('toggle', syncVisibility);
  return {
    onSelect: syncVisibility,
    cleanup() {
      fold.removeEventListener('toggle', syncVisibility);
      cleanup();
    },
  };
}

import { randomUUID } from 'node:crypto';
import { BACKENDS, MODELS, voiceId } from '../server-plugin/lib/config.mjs';

export function createPreviewFish(makeWav) {
  const service = 'mirrortranslate-fish';
  const config = { backend: 's2.1-pro', defaultVoice: '', models: MODELS };
  const voices = [
    { id: '1'.repeat(32), name: '樱井 · 预览音色' },
    { id: '2'.repeat(32), name: '老胡 · 预览音色' },
  ];
  let running = false;
  let policy = 'round-robin';
  let accounts = [];
  let tasks = [];
  const hasLoginWindow = new Set();
  const ok = value => Response.json(value);
  const fail = (status, code, message) => Response.json({ error: { code, message } }, { status });

  return (url, method, body) => {
    const route = url.pathname;
    if (method === 'GET' && route === '/state') return ok({ service, status: running ? 'running' : 'stopped' });
    if (method === 'POST' && route === '/service/start') {
      running = true;
      return ok({ service, status: 'running' });
    }
    if (method === 'POST' && route === '/service/stop') {
      running = false;
      tasks = [];
      return ok({ service, status: 'stopped' });
    }
    if (!running) return fail(503, 'service_stopped', '请先启动 Fish。');
    if (route === '/settings') {
      if (method === 'GET') return ok(config);
      try {
        if (!BACKENDS.includes(body.backend)) throw new Error('请选择模型。');
        const selected = body.defaultVoice ? voiceId(body.defaultVoice) : '';
        Object.assign(config, { backend: body.backend, defaultVoice: selected });
        return ok({ saved: true });
      } catch (error) {
        return fail(400, 'invalid_settings', error.message);
      }
    }
    if (route === '/accounts') {
      if (method === 'GET') return ok({ accounts, scheduler: { policy, queued: 0, active: 0 } });
      const account = { id: randomUUID(), name: body.name, enabled: true, status: 'login-required', balance: null };
      accounts.push(account);
      return ok({ account });
    }
    if (method === 'POST' && route === '/accounts/order') {
      accounts = body.ids.map(id => accounts.find(account => account.id === id)).filter(Boolean);
      return ok({ accounts });
    }
    const accountRoute = route.match(/^\/accounts\/([^/]+)(?:\/(login|refresh))?$/);
    if (accountRoute) {
      const [, id, action] = accountRoute;
      const account = accounts.find(item => item.id === id);
      if (!account) return fail(404, 'account_not_found', '账号不存在。');
      if (action === 'login') {
        hasLoginWindow.add(id);
        return ok({ opened: true });
      }
      if (action === 'refresh') {
        if (!hasLoginWindow.has(id)) return fail(503, 'fish_login_required', '请先登录。');
        Object.assign(account, { status: account.enabled ? 'ready' : 'disabled', balance: 100 });
      } else if (method === 'PATCH') {
        Object.assign(account, body);
        account.status = account.enabled ? (account.balance ? 'ready' : 'login-required') : 'disabled';
      } else if (method === 'DELETE') {
        hasLoginWindow.delete(id);
        accounts = accounts.filter(item => item.id !== id);
        return ok({ removed: true });
      }
      return ok({ account });
    }
    if (method === 'PATCH' && route === '/scheduler') {
      policy = body.policy;
      return ok({ policy });
    }
    if (method === 'GET' && route === '/tasks') return ok({ tasks });
    if (method === 'GET' && route === '/voices') {
      const query = url.searchParams.get('q') ?? '';
      return ok({ voices: voices.filter(voice => voice.name.includes(query)) });
    }
    if (method === 'POST' && route === '/speech') {
      const account = accounts.find(item => item.status === 'ready');
      if (!account) return fail(503, 'no_available_accounts', '请先登录并启用一个 Fish 账号。');
      const voice = body.voice === 'default' ? config.defaultVoice : body.voice;
      if (!voice) return fail(400, 'default_voice_missing', '请先保存默认音色。');
      const input = String(body.input ?? '').trim();
      if (!input) return fail(400, 'invalid_text', '请填写朗读文本。');
      const requestId = randomUUID();
      tasks = [{ requestId, accountId: account.id, backend: body.model === 'tts-1' ? config.backend : body.model,
        inputCharacters: [...input].length, createdAt: new Date().toISOString(), stage: 'completed' }, ...tasks].slice(0, 30);
      return new Response(makeWav(input.slice(0, 120), voice === voices[1].id ? 2 : 1),
        { headers: { 'Content-Type': 'audio/wav', 'X-Fish-Task-Id': requestId } });
    }
    return fail(404, 'not_found', 'Fish 操作不存在。');
  };
}

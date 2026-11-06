export const FISH_WEB_TASK_CHECK = '先到 Fish 管理页查看任务记录，再决定是否重试。';
export const FISH_MANAGED_ROOT = '/api/plugins/mirrortranslate-fish';
export const FISH_SERVICE_MISSING = 'fish_service_missing';

export function missingFishService() {
  return Object.assign(new Error('酒馆未加载 Fish 服务。运行镜译安装包后重启酒馆。'), {
    status: 404,
    code: FISH_SERVICE_MISSING,
  });
}

const MANAGED_MESSAGES = {
  browser_unavailable: '请打开该账号的 Fish 窗口。',
  fish_login_required: '登录 Fish 后，回这里检查账号。',
  fish_session_expired: 'Fish 登录已过期，请重新登录。',
  fish_verification_required: '请在 Fish 窗口完成验证。',
  fish_session_changed: '登录状态有变，请检查账号。',
  no_available_accounts: '请先登录并启用一个 Fish 账号。',
  upstream_timeout: 'Fish 生成超时。',
  request_cancelled: '已取消排队任务。',
};

export async function fishManagedRequest(path, { method = 'GET', body, signal, headers } = {}) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
  let response;
  try {
    response = await fetch(FISH_MANAGED_ROOT + path, {
      method, signal, headers: requestHeaders, credentials: 'same-origin', mode: 'same-origin',
      redirect: 'error', cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    throw new Error(path === '/speech' ? `Fish 语音连接中断。${FISH_WEB_TASK_CHECK}` : 'Fish 服务连接失败。');
  }
  if (response.ok) return response;
  const failure = (await response.json().catch(() => null))?.error;
  if (response.status === 404 && !failure?.code) throw missingFishService();
  let message = (Object.hasOwn(MANAGED_MESSAGES, failure?.code) ? MANAGED_MESSAGES[failure.code] : failure?.message)
    || `Fish 请求失败（${response.status}）。`;
  if (path === '/speech' && (['unknown', 'accepted'].includes(failure?.submission)
    || failure?.code === 'bridge_error' || (!failure && response.status >= 500))) message += FISH_WEB_TASK_CHECK;
  throw Object.assign(new Error(message), { status: response.status, code: failure?.code });
}

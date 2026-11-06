import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export function outgoingEnvironment(env, windows = {}) {
  const next = { ...env, FISH_NETWORK_READY: '1' };
  let address = env.FISH_OUTBOUND_PROXY || env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (env.FISH_OUTBOUND_PROXY === 'direct') return { ...next, NODE_USE_ENV_PROXY: '0' };
  if (!address && windows.enabled && windows.server) {
    const entries = windows.server.split(';');
    address = entries.find(value => value.startsWith('https='))?.slice(6)
      || entries.find(value => value.startsWith('http='))?.slice(5)
      || (entries.length === 1 && !entries[0].includes('=') ? entries[0] : '');
  }
  if (!address) return next;
  let url;
  try { url = new URL(address.includes('://') ? address : `http://${address}`); } catch { throw new Error('系统网络代理格式不正确。'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.pathname !== '/' || url.search || url.hash) throw new Error('目前支持 HTTP / HTTPS 出站代理。');
  next.HTTPS_PROXY = url.href;
  next.HTTP_PROXY ||= url.href;
  next.NO_PROXY = [...new Set([...(env.NO_PROXY || env.no_proxy || '').split(',').filter(Boolean), 'localhost', '127.0.0.1', '::1'])].join(',');
  next.NODE_USE_ENV_PROXY = '1';
  return next;
}

export async function windowsProxy() {
  if (process.platform !== 'win32') return {};
  try {
    const command = "$p = Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; @{enabled=([int]$p.ProxyEnable -eq 1); server=[string]$p.ProxyServer} | ConvertTo-Json -Compress";
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 5000, maxBuffer: 16384 });
    return JSON.parse(stdout);
  } catch { return {}; }
}

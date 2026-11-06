import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { loadAccounts } from './lib/accounts.mjs';
import { FishBrowser } from './lib/browser.mjs';
import { loadConfig } from './lib/config.mjs';
import { FishClient } from './lib/fish.mjs';
import { createGateway } from './lib/gateway.mjs';
import { AccountPool } from './lib/pool.mjs';

let gateway;
let stopping = false;

function stop() {
  if (stopping) return;
  stopping = true;
  if (!gateway?.listening) return;
  gateway.close(() => {
    if (process.connected) process.disconnect();
  });
  setTimeout(() => gateway.closeAllConnections(), 4000).unref();
}

process.once('disconnect', stop);
process.on('message', message => {
  if (message === 'stop') stop();
});

async function start(dataDir) {
  if (!dataDir || !process.send || Number(process.versions.node.split('.')[0]) < 22) {
    throw new Error('Fish 需要 Node.js 22 或更新版本。');
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (process.env.NODE_USE_ENV_PROXY === '1' && (major < 24 || (major === 24 && minor < 5))) {
    throw new Error('使用系统代理时，Fish 需要 Node.js 24.5 或更新版本。');
  }
  const store = await loadConfig(dataDir, {});
  const accounts = await loadAccounts(dataDir, { migrateLegacy: false });
  if (stopping) {
    if (process.connected) process.disconnect();
    return;
  }
  const pool = new AccountPool({ accounts, config: store, providerFactory: (_id, root) => {
    const browser = new FishBrowser(root);
    return { browser, client: new FishClient({ browser }) };
  } });
  await pool.initialize();
  if (stopping) {
    pool.close();
    if (process.connected) process.disconnect();
    return;
  }
  const adminToken = randomBytes(32).toString('base64url');
  gateway = createGateway({ store, pool, adminToken });
  gateway.listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  // A stop can arrive between listen() and its callback.
  if (stopping) {
    stopping = false;
    stop();
    return;
  }
  process.send({ port: gateway.address().port, adminToken, proxyKey: store.get().proxyKey });
}

start(process.argv[2]).catch(error => {
  console.error('[MirrorTranslate Fish]', error.code ?? error.message);
  if (process.connected) {
    process.send({ failed: true }, () => process.disconnect());
  }
  if (gateway?.listening) stop();
  process.exitCode = 1;
});

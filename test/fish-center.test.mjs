import test from 'node:test';
import assert from 'node:assert/strict';
import { basename, dirname, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { FISH_CENTER_PAGE_MARKUP } from '../fish-center.js';
import { FISH_MANAGED_ROOT, fishWebRequest, probeFishWeb } from '../fish-web.js';
import { createFishRoutes } from '../server-plugin/index.mjs';
import { makeTask } from '../server-plugin/lib/fish.mjs';
import { mergeSettings, pagesForMode } from '../core.js';
import { __testing } from '../index.js';
import { encodeWav } from '../tts.js';

const SETTINGS = { backend: 's2.1-pro', defaultVoice: 'a'.repeat(32), models: [{ id: 's2.1-pro', name: 'S2.1 Pro' }] };
const HOST_HEADERS = { 'X-CSRF-Token': 'tavern-fixture' };
const WAV = encodeWav([new Float32Array(8000)], 16000);

class Reply extends Writable {
  headers = {};
  chunks = [];
  statusCode = 200;
  headersSent = false;
  set(name, value) { this.headers[name.toLowerCase()] = value; }
  status(code) { this.statusCode = code; return this; }
  json(body) { this.payload = body; this.end(); }
  _write(chunk, _encoding, done) {
    this.headersSent = true;
    this.chunks.push(Buffer.from(chunk));
    done();
  }
}

const user = resolve('fixture-data', 'default-user');
async function invoke(routes, url, { method = 'GET', body, root = user, origin, address = '127.0.0.1', host = '127.0.0.1:8000' } = {}) {
  const res = new Reply();
  const req = { url, method, body, headers: { host, origin }, socket: { remoteAddress: address }, user: root ? { directories: { root } } : null };
  await routes.handle(req, res);
  return res;
}

function upstream(payload, contentType = 'application/json') {
  const body = Readable.from([contentType === 'application/json' ? JSON.stringify(payload) : Buffer.from(payload)]);
  return Object.assign(body, { statusCode: 200, headers: { 'content-type': contentType } });
}

test('managed Fish has a native page in both modes and no standalone setup fields', () => {
  for (const mode of ['normal', 'advanced']) assert.ok(pagesForMode(mode).includes('fish-center'));
  assert.match(__testing.CONTROL_CENTER_MARKUP, /data-jy-tab="fish-center"/);
  assert.match(__testing.CONTROL_CENTER_MARKUP, /data-jy-page="fish-center"/);
  assert.doesNotMatch(FISH_CENTER_PAGE_MARKUP, /iframe|Fish\.exe|allowedOrigins|API Key/);
});

test('same-origin managed voice sends Tavern CSRF headers and accepts the supplied Fish task schema', async t => {
  const saved = globalThis.fetch;
  t.after(() => { globalThis.fetch = saved; });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(url);
    assert.equal(init.headers.get('x-csrf-token'), 'tavern-fixture');
    assert.equal(init.headers.has('authorization'), false);
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.mode, 'same-origin');
    if (url.endsWith('/state')) return Response.json({ service: 'mirrortranslate-fish', status: 'running' });
    if (url.endsWith('/settings')) return Response.json(SETTINGS);
    assert.equal(url, FISH_MANAGED_ROOT + '/speech');
    assert.equal(init.method, 'POST');
    const task = makeTask(JSON.parse(init.body), { ...SETTINGS, maxChars: 15000 });
    assert.equal(task.model, SETTINGS.defaultVoice);
    assert.equal(task.backend, SETTINGS.backend);
    return new Response(WAV, { headers: { 'content-type': 'audio/wav' } });
  };
  const config = mergeSettings({ tts: { provider: 'fish-web' } }).tts.fishWeb;
  assert.deepEqual(await probeFishWeb(config, undefined, HOST_HEADERS), { voiceConfigured: true });
  const response = await fishWebRequest({ ...config, managed: true, key: 'old-key' }, '/v1/audio/speech', {
    body: { input: '镜译试听。', model: 'tts-1', voice: 'default', response_format: 'wav' }, headers: HOST_HEADERS,
  });
  assert.equal((await response.arrayBuffer()).byteLength, WAV.byteLength);
  assert.deepEqual(calls, ['/state', '/settings', '/speech'].map(route => FISH_MANAGED_ROOT + route));
});

test('the floor reader generates and reuses the managed Fish WAV without an external Key', async t => {
  const oldFetch = globalThis.fetch;
  const oldTavern = globalThis.SillyTavern;
  globalThis.SillyTavern = { getContext: () => ({ getRequestHeaders: () => HOST_HEADERS, chat: [], extensionSettings: {} }) };
  t.after(() => { globalThis.fetch = oldFetch; globalThis.SillyTavern = oldTavern; });
  const speech = [];
  globalThis.fetch = async (url, init) => {
    assert.ok(url.startsWith(FISH_MANAGED_ROOT + '/'));
    assert.equal(init.headers.get('x-csrf-token'), 'tavern-fixture');
    if (url.endsWith('/settings')) return Response.json(SETTINGS);
    assert.ok(url.endsWith('/speech'));
    speech.push(JSON.parse(init.body));
    return new Response(WAV, { headers: { 'content-type': 'audio/wav' } });
  };
  const settings = mergeSettings({ tts: { enabled: true, provider: 'fish-web' } });
  const floor = { floorId: 'managed-fish|7', chatId: 'managed-fish', messageId: 7, version: 'one', side: 'source' };
  const items = [{ segment: { id: 1, lineId: 1, type: 'dialogue', text: '你好。' } }];
  const first = await __testing.ensureTtsRecording(floor, 'line:1', items, settings);
  assert.equal(first.cached, false);
  assert.equal(first.record.provider, 'fish-web');
  assert.equal((await __testing.ensureTtsRecording(floor, 'line:1', items, settings)).cached, true);
  assert.deepEqual(speech, [{ input: '你好。', model: 'tts-1', voice: 'default', response_format: 'wav', speed: 1 }]);
});

test('bridge scopes Fish to the local Tavern user, hides internal credentials and gates every route', async t => {
  const launched = [];
  const forwarded = [];
  const routes = createFishRoutes({
    launch: root => {
      launched.push(root);
      const closed = Promise.withResolvers();
      return {
        ready: Promise.resolve({ port: 9191, adminToken: 'fixture', proxyKey: 'hidden-fixture' }),
        exited: closed.promise,
        stop: () => closed.resolve(),
      };
    },
    send: async (service, route, options) => {
      forwarded.push([route, options.method, options.body]);
      assert.equal(service.adminToken, 'fixture');
      if (route === '/admin/config') return upstream({ ...SETTINGS, proxyKey: 'hidden-fixture', adminToken: 'fixture', teamId: 'hidden' });
      assert.equal(route, '/v1/audio/speech');
      return upstream(WAV, 'audio/wav');
    },
  });
  t.after(() => routes.close());
  assert.equal((await invoke(routes, '/state', { root: '' })).statusCode, 401);
  assert.equal((await invoke(routes, '/state', { address: '192.168.1.10' })).statusCode, 403);
  assert.equal((await invoke(routes, '/state', { host: 'evil.example' })).statusCode, 403);
  assert.equal((await invoke(routes, '/service/start', { method: 'POST', origin: 'https://evil.example' })).statusCode, 403);
  assert.deepEqual((await invoke(routes, '/state')).payload, { service: 'mirrortranslate-fish', status: 'stopped' });
  assert.equal((await invoke(routes, '/speech', { method: 'POST' })).statusCode, 503);
  assert.equal(launched.length, 0);
  await Promise.all([
    invoke(routes, '/service/start', { method: 'POST' }),
    invoke(routes, '/service/start', { method: 'POST' }),
  ]);
  assert.equal(launched.length, 1);
  assert.equal(basename(launched[0]), 'default-user');
  assert.equal(basename(dirname(launched[0])), '.mirrortranslate-fish');
  const other = resolve('fixture-data', 'someone-else');
  assert.equal((await invoke(routes, '/state', { root: other })).payload.status, 'stopped');
  assert.deepEqual((await invoke(routes, '/settings')).payload, SETTINGS);
  assert.equal((await invoke(routes, '/settings', { method: 'POST', body: { fishToken: 'blocked' } })).statusCode, 400);
  assert.equal((await invoke(routes, '/admin/config')).statusCode, 404);
  const speech = await invoke(routes, '/speech', { method: 'POST', body: { input: '一句话' } });
  assert.equal(speech.headers['content-type'], 'audio/wav');
  assert.deepEqual(Buffer.concat(speech.chunks), Buffer.from(WAV));
  assert.deepEqual(forwarded, [['/admin/config', 'GET', undefined], ['/v1/audio/speech', 'POST', '{"input":"一句话"}']]);
  await invoke(routes, '/service/stop', { method: 'POST' });
  assert.equal((await invoke(routes, '/state')).payload.status, 'stopped');
});

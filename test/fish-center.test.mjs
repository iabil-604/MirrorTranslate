import test from 'node:test';
import assert from 'node:assert/strict';
import { basename, dirname, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { setImmediate as nextTick } from 'node:timers/promises';
import { createFishCenter, FISH_CENTER_MARKUP } from '../fish-center.js';
import { FISH_MANAGED_ROOT, fishManagedRequest } from '../fish-web.js';
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

test('Fish management is nested in the original reading page', () => {
  assert.equal(pagesForMode('normal').includes('tts'), false);
  assert.equal(pagesForMode('advanced').includes('tts'), true);
  const markup = __testing.CONTROL_CENTER_MARKUP;
  assert.doesNotMatch(markup, /data-jy-(?:tab|page)="fish-center"/);
  const reading = markup.slice(markup.indexOf('data-jy-page="tts"'), markup.indexOf('</section>\n\n', markup.indexOf('data-jy-page="tts"')));
  assert.match(reading, /class="jy-tts-sources"[\s\S]*data-jy-fold="tts-fish-center"/);
  assert.match(FISH_CENTER_MARKUP, /releases\/latest\/download\/MirrorTranslate\.zip/);
  const installerLink = FISH_CENTER_MARKUP.match(/<a[^>]*data-fish-install-download[^>]*>/)[0];
  assert.match(installerLink, /download="MirrorTranslate\.zip"/);
  assert.doesNotMatch(installerLink, /target=/);
  assert.doesNotMatch(FISH_CENTER_MARKUP, /iframe|Fish\.exe|allowedOrigins|API Key/);
});

test('missing Fish shows a desktop ZIP only on the supported host and device', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, FISH_MANAGED_ROOT + '/state');
    return Response.json({ error: { code: 'not_found' } }, { status: 404 });
  });
  for (const scenario of [
    { host: 'sillytavern', browser: { platform: 'Win32' }, download: true, help: /运行酒馆的电脑/ },
    { host: 'tauritavern', browser: { userAgent: 'Desktop webview' }, download: false, help: /TauriTavern/ },
    { host: 'sillytavern', browser: { userAgentData: { mobile: false, platform: 'Android' } }, download: false, help: /平板本机/ },
    { host: 'sillytavern', browser: { platform: 'MacIntel', maxTouchPoints: 5 }, download: false, help: /平板本机/ },
  ]) {
    const nodes = new Map();
    const fold = {
      open: true, hidden: false, ownerDocument: {},
      querySelector(selector) {
        if (!nodes.has(selector)) nodes.set(selector, { hidden: true, dataset: {}, addEventListener() {} });
        return nodes.get(selector);
      },
      addEventListener() {}, removeEventListener() {},
    };
    const page = { hidden: false, dataset: {}, querySelector: () => fold };
    const controller = createFishCenter({ querySelector: () => page }, {
      host: scenario.host, browser: scenario.browser, headers: () => ({}), selected: () => false,
    });
    try {
      controller.onSelect();
      await nextTick();
      assert.equal(fold.querySelector('[data-fish-install]').hidden, false);
      assert.equal(fold.querySelector('[data-fish-install-download]').hidden, !scenario.download);
      assert.match(fold.querySelector('[data-fish-install-help]').textContent, scenario.help);
      assert.equal(fold.querySelector('[data-fish-action="start"]').hidden, true);
    } finally {
      controller.cleanup();
    }
  }
});

test('Android TauriTavern shows Fish Local in the existing panel and connects through the form', async t => {
  const button = { disabled: false };
  const form = Object.assign(new EventTarget(), { querySelector: () => button });
  const port = { value: '' };
  const key = { value: '' };
  const note = { hidden: true, dataset: {} };
  const desktop = { hidden: false };
  const android = { hidden: true };
  const fold = {
    querySelector: selector => ({
      '[data-fish-desktop]': desktop, '[data-fish-android]': android,
      '[data-fish-android-form]': form, '[data-fish-android-port]': port,
      '[data-fish-android-key]': key, '[data-fish-android-note]': note,
    })[selector],
  };
  const page = { querySelector: () => fold };
  const oldHost = Object.getOwnPropertyDescriptor(globalThis, '__TAURITAVERN__');
  t.after(() => oldHost ? Object.defineProperty(globalThis, '__TAURITAVERN__', oldHost) : delete globalThis.__TAURITAVERN__);
  globalThis.__TAURITAVERN__ = { invoke: { safeInvoke: async () => ({ request_proxy: { enabled: false } }) } };
  const routes = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    routes.push(url);
    assert.equal(init.headers.get('x-csrf-token'), 'tavern-fixture');
    if (url === '/api/secrets/read') return Response.json({
      api_key_custom_openai_tts: [{ id: 'existing-fish', active: true, label: '镜译 · Fish Local' }],
    });
    assert.equal(url, '/api/openai/custom/generate-voice');
    assert.equal(JSON.parse(init.body).input, '');
    return new Response('fish-local-mirror-v1 drama-3 default_voice', { status: 400 });
  });
  const connected = Promise.withResolvers();
  const controller = createFishCenter({ querySelector: () => page }, {
    host: 'tauritavern', browser: { userAgent: 'Android tablet' }, headers: () => HOST_HEADERS,
    selected: () => false, getAndroidConnection: () => ({ port: 7860, secretId: 'existing-fish' }),
    use: connected.resolve,
  });
  t.after(() => controller.cleanup());
  controller.onSelect();
  assert.equal(android.hidden, false);
  assert.equal(desktop.hidden, true);
  assert.equal(port.value, '7860');
  assert.match(note.textContent, /已保存/);
  const submit = new Event('submit', { cancelable: true });
  form.dispatchEvent(submit);
  assert.equal(submit.defaultPrevented, true);
  assert.deepEqual(await connected.promise, { port: 7860, secretId: 'existing-fish', profile: 'drama-3:default_voice' });
  assert.match(note.textContent, /已连接/);
  assert.ok(routes.every(route => !route.startsWith(FISH_MANAGED_ROOT)));
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
  assert.deepEqual(await (await fishManagedRequest('/state', { headers: HOST_HEADERS })).json(), { service: 'mirrortranslate-fish', status: 'running' });
  assert.deepEqual(await (await fishManagedRequest('/settings', { headers: HOST_HEADERS })).json(), SETTINGS);
  const response = await fishManagedRequest('/speech', {
    method: 'POST', body: { input: '镜译试听。', model: 'tts-1', voice: 'default', response_format: 'wav' }, headers: HOST_HEADERS,
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSettings, normalizeTts } from '../core.js';
import {
  FISH_MANAGED_ROOT, FISH_SERVICE_MISSING, connectFishAndroid, fishAndroidSpeech, fishManagedRequest,
} from '../fish-web.js';
import { __testing } from '../index.js';
import { encodeWav } from '../tts.js';

const BASE = 'http://127.0.0.1:7860';
const OFFICIAL_KEY = 'fixture-official-key';
const CONFIG = { baseUrl: BASE, key: 'old-preview-key' };
const SPEECH = FISH_MANAGED_ROOT + '/speech';
const FISH_SETTINGS = FISH_MANAGED_ROOT + '/settings';
const SETTINGS = mergeSettings({ tts: {
  enabled: true, provider: 'fish-web', fishWeb: CONFIG, fish: { key: OFFICIAL_KEY, retries: 5 },
} });
const voice = id => String(id).repeat(32);
const wav = encodeWav([new Float32Array(8000)], 16000);
const waveResponse = () => new Response(wav, { headers: { 'content-type': 'audio/wav' } });
const settingsResponse = () => Response.json({ backend: 'drama-3', defaultVoice: '' });

function globals(t, replacements) {
  for (const [name, value] of Object.entries(replacements)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
}

test.beforeEach(t => {
  const context = { chatId: 'web', chat: [], extensionSettings: {}, characters: [{ name: '样例', avatar: 'sample.png' }], characterId: 0 };
  globals(t, { SillyTavern: { getContext: () => context } });
});

function floor(id) {
  return { floorId: `web|${id}`, chatId: 'web', messageId: id, version: 'one', side: 'source' };
}

const item = (id, text, voiceId = '') => ({ segment: { id, lineId: 1, type: 'dialogue', text }, voiceId });

const ANDROID_KEY_SLOT = 'api_key_custom_openai_tts';
const ANDROID_HOST_TTS = '/api/openai/custom/generate-voice';
const LOCAL_KEY = 'fish_' + 'a'.repeat(43);
const MIRROR_KEY = 'mirror_oBwjd60oKPviulB3juV3oYa7zusvWlO-GOB4NfEAcVk';
const ANDROID_PORT = 7861;
const ANDROID_CONNECTION = { port: ANDROID_PORT, secretId: 'local-key', profile: 'drama-3:default_voice' };
const profileResponse = () => new Response('fish-local-mirror-v1 drama-3 default_voice', { status: 400 });

function androidHost(t, { entries = null, proxy = { enabled: false }, speech = profileResponse } = {}) {
  const calls = [];
  globals(t, {
    navigator: { userAgentData: { platform: 'Android' } },
    __TAURITAVERN__: { invoke: { safeInvoke: async name => {
      assert.equal(name, 'get_tauritavern_settings');
      return { request_proxy: proxy };
    } } },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      assert.equal(init.credentials, 'same-origin');
      assert.equal(init.headers.has('Authorization'), false);
      if (url === '/api/secrets/read') return Response.json({ [ANDROID_KEY_SLOT]: entries });
      if (url === '/api/secrets/write') {
        assert.equal(body.key, ANDROID_KEY_SLOT);
        assert.equal(body.value, MIRROR_KEY);
        assert.equal(body.label, '镜译 · Fish Local');
        entries = (entries ?? []).map(entry => ({ ...entry, active: false }));
        entries.push({ id: 'local-key', label: body.label, active: true });
        return Response.json({ id: 'local-key' });
      }
      if (url === '/api/secrets/delete') {
        assert.deepEqual(body, { key: ANDROID_KEY_SLOT, id: 'local-key' });
        entries = entries.filter(entry => entry.id !== body.id);
        return Response.json({ ok: true });
      }
      if (url === '/api/secrets/rotate') {
        assert.deepEqual(body, { key: ANDROID_KEY_SLOT, id: 'other-key' });
        entries = entries.map(entry => ({ ...entry, active: entry.id === body.id }));
        return Response.json({ ok: true });
      }
      assert.equal(url, ANDROID_HOST_TTS);
      assert.equal(body.response_format, 'mp3');
      assert.ok(body.provider_endpoint.startsWith('http://127.0.0.1:7861/v1/mirror/'));
      assert.ok(entries.some(entry => entry.active && entry.id === 'local-key'));
      return speech(body);
    },
  });
  return calls;
}

test('Android setup verifies the loopback and reuses its host Key without a speech job', async t => {
  const calls = androidHost(t, { proxy: { enabled: true, bypass: ['127.0.0.1'] } });
  const form = { port: String(ANDROID_PORT), key: LOCAL_KEY };
  const connection = await connectFishAndroid(form);
  assert.deepEqual(connection, ANDROID_CONNECTION);
  assert.deepEqual(await connectFishAndroid({ ...form, secretId: connection.secretId }), connection);
  assert.equal(calls.filter(call => call.url === '/api/secrets/write').length, 1);
  assert.deepEqual(calls.filter(call => call.url === ANDROID_HOST_TTS).map(call => call.body), Array(2).fill({
    input: '', provider_endpoint: 'http://127.0.0.1:7861/v1/mirror/check', response_format: 'mp3',
  }));
  const normalized = normalizeTts({ fishAndroid: { ...connection, key: LOCAL_KEY } }).fishAndroid;
  assert.deepEqual(normalized, connection);
  assert.equal(normalizeTts({ fishAndroid: { port: '7860/example.com' } }).fishAndroid.port, 7860);
});

test('Android setup rolls back its provisional Key if Fish Local rejects it', async t => {
  const calls = androidHost(t, { speech: () => new Response('bad key', { status: 401 }) });
  await assert.rejects(connectFishAndroid({ port: ANDROID_PORT, key: LOCAL_KEY }), /本地 Key 不正确/);
  assert.equal(calls.at(-1).url, '/api/secrets/delete');
});

test('a failed Android Key switch reselects the previous host Key before removing the provisional one', async t => {
  const calls = androidHost(t, {
    entries: [{ id: 'other-key', label: 'Other TTS', active: true }],
    speech: () => new Response('bad key', { status: 401 }),
  });
  await assert.rejects(connectFishAndroid({ port: ANDROID_PORT, key: LOCAL_KEY, switchFrom: 'other-key' }), /本地 Key 不正确/);
  assert.deepEqual(calls.slice(-2).map(call => call.url), ['/api/secrets/rotate', '/api/secrets/delete']);
});

test('Android protects the existing TauriTavern Key and refuses a proxied loopback', async t => {
  const proxy = { enabled: false, bypass: [] };
  const calls = androidHost(t, { proxy, entries: [{ id: 'other-key', label: 'Other TTS', active: true }] });
  const form = { port: ANDROID_PORT, key: LOCAL_KEY };
  await assert.rejects(connectFishAndroid(form), { switchFrom: 'other-key' });
  await assert.rejects(fishAndroidSpeech({ input: '不发送' }, ANDROID_CONNECTION), /选回/);
  assert.deepEqual(calls.map(call => call.url), ['/api/secrets/read', '/api/secrets/read']);
  proxy.enabled = true;
  await assert.rejects(fishAndroidSpeech({ input: '不发送' }, ANDROID_CONNECTION), /绕过列表/);
  assert.equal(calls.length, 2);
  proxy.enabled = false;
  assert.deepEqual(await connectFishAndroid({ ...form, switchFrom: 'other-key' }), ANDROID_CONNECTION);
  assert.equal(calls.filter(call => call.url === '/api/secrets/write').length, 1);
  assert.ok(!calls.some(call => call.url === '/api/secrets/delete'));
});

test('the Android floor reader decodes the native MP3, preserves each voice and replays its cache', async t => {
  const mp3 = Uint8Array.of(0xff, 0xfb, 0x90, 0x04);
  const calls = androidHost(t, {
    entries: [{ id: 'local-key', label: '镜译 · Fish Local', active: true }],
    speech: body => body.input ? new Response(mp3, { headers: { 'Content-Type': 'audio/mpeg' } }) : profileResponse(),
  });
  let decoded = 0;
  globals(t, { AudioContext: class {
    async decodeAudioData(raw) {
      assert.deepEqual(new Uint8Array(raw), mp3);
      decoded += 1;
      return {
        sampleRate: 16000, duration: .5, length: 8000, numberOfChannels: 1,
        getChannelData: () => new Float32Array(8000),
      };
    }
    close() {}
  } });
  const settings = mergeSettings({ tts: { enabled: true, provider: 'fish-web', fishAndroid: ANDROID_CONNECTION } });
  const target = floor(81);
  const items = [item(1, '安卓第一句。', voice(1)), item(2, '安卓第二句。')];
  const { record, cached } = await __testing.ensureTtsRecording(target, 'line:1', items, settings);
  assert.equal(cached, false);
  assert.deepEqual(record.parts.map(part => [part.mime, part.duration]), [['audio/wav', .5], ['audio/wav', .5]]);
  const paid = calls.filter(call => call.url === ANDROID_HOST_TTS && call.body.input).map(call => call.body);
  assert.deepEqual(paid.map(({ input, model, voice }) => [input, model, voice]), [
    ['安卓第一句。', 'tts-1', voice(1)], ['安卓第二句。', 'tts-1', 'default'],
  ]);
  assert.match(paid[0].provider_endpoint, /\/speech\/[0-9]{13}-[a-f0-9]{32}$/);
  assert.notEqual(paid[0].provider_endpoint, paid[1].provider_endpoint);
  assert.equal((await __testing.ensureTtsRecording(target, 'line:1', items, settings)).cached, true);
  assert.equal(calls.filter(call => call.url === ANDROID_HOST_TTS && call.body.input).length, 2);
  assert.equal(decoded, 2);
});

test('the Android reader stops when the current Fish task may already have been submitted', async t => {
  const calls = androidHost(t, {
    entries: [{ id: 'local-key', label: '镜译 · Fish Local', active: true }],
    speech: body => body.input ? new Response('Fish Local 已收到这一句。请查看任务记录，再决定是否重试。', { status: 409 }) : profileResponse(),
  });
  const settings = mergeSettings({ tts: { provider: 'fish-web', fishAndroid: ANDROID_CONNECTION, fish: { retries: 5 } } });
  await assert.rejects(__testing.ensureTtsRecording(floor(82), 'line:1', [item(1, '可能已提交。'), item(2, '后一条。')], settings), /查看任务记录/);
  assert.deepEqual(calls.filter(call => call.url === ANDROID_HOST_TTS && call.body.input).map(call => call.body.input), ['可能已提交。']);
});

test('旧网页反代设置迁移到镜译服务，官方 Fish Key 保留', () => {
  const legacy = normalizeTts({ fish: { key: OFFICIAL_KEY } });
  assert.equal(legacy.provider, 'fish');
  assert.equal(SETTINGS.tts.fish.key, OFFICIAL_KEY);
  assert.equal(SETTINGS.tts.provider, 'fish-web');
  assert.equal(Object.hasOwn(SETTINGS.tts, 'fishWeb'), false);
});

test('只在酒馆没有 Fish 接口时提示安装，已有服务的 404 显示自身原因', async t => {
  let loaded = false;
  globals(t, { fetch: async (url, init) => {
    assert.ok([FISH_MANAGED_ROOT + '/state', FISH_MANAGED_ROOT + '/accounts/legacy/refresh'].includes(url));
    assert.equal(init.headers.has('authorization'), false);
    return loaded
      ? Response.json({ error: { code: 'not_found', message: 'Fish 操作不存在。' } }, { status: 404 })
      : new Response('<html>Not Found</html>', { status: 404 });
  } });
  await assert.rejects(fishManagedRequest('/state'), { code: FISH_SERVICE_MISSING });
  loaded = true;
  await assert.rejects(fishManagedRequest('/state'), { code: FISH_SERVICE_MISSING });
  await assert.rejects(fishManagedRequest('/accounts/legacy/refresh', { method: 'POST' }), { code: 'not_found', message: 'Fish 操作不存在。' });
});

test('朗读按原顺序发送每句的 Fish 音色，音频与官方模式分开缓存', async t => {
  const requests = [];
  globals(t, { fetch: async (url, init) => {
    if (url === FISH_SETTINGS) return settingsResponse();
    assert.equal(url, SPEECH);
    assert.equal(init.headers.has('authorization'), false);
    assert.equal(init.credentials, 'same-origin');
    const body = JSON.parse(init.body);
    assert.deepEqual(Object.keys(body).sort(), ['input', 'model', 'response_format', 'speed', 'voice']);
    requests.push(body);
    return waveResponse();
  } });
  const target = floor(71);
  const items = [item(1, '第一句。', voice(1)), item(2, '第二句。', voice(2)), item(3, '第三句。')];
  const { record, cached } = await __testing.ensureTtsRecording(target, 'line:1', items, SETTINGS);
  assert.equal(cached, false);
  assert.equal(record.provider, 'fish-web');
  assert.deepEqual(requests.map(({ input, voice, response_format, model }) => [input, voice, response_format, model]), [
    ['第一句。', voice(1), 'wav', 'tts-1'], ['第二句。', voice(2), 'wav', 'tts-1'], ['第三句。', 'default', 'wav', 'tts-1'],
  ]);
  assert.deepEqual(record.timeline.map(({ id, part, start, end }) => [id, part, start, end]), [[1, 0, 0, .5], [2, 1, 0, .5], [3, 2, 0, .5]]);
  assert.equal((await __testing.ensureTtsRecording(target, 'line:1', items, SETTINGS)).cached, true);
  assert.equal(requests.length, 3);
  const officialWithoutKey = { ...SETTINGS, tts: { ...SETTINGS.tts, provider: 'fish', fish: { key: '' } } };
  await assert.rejects(__testing.ensureTtsRecording(target, 'line:1', items, officialWithoutKey), /Fish API Key/);
  assert.equal(requests.length, 3);
});

test('网页反代返回提交状态不明时，同一请求不重发，即使官方重试设为 5', async t => {
  let count = 0;
  globals(t, { fetch: async url => {
    if (url === FISH_SETTINGS) return settingsResponse();
    assert.equal(url, SPEECH);
    count += 1;
    return Response.json({ error: { code: 'upstream_timeout', message: '语音等待超时。', submission: 'unknown' } }, { status: 504 });
  } });
  await assert.rejects(__testing.ensureTtsRecording(floor(72), 'sentence:1', [item(1, '只提交一次。')], SETTINGS), /查看任务记录/);
  assert.equal(count, 1);
});

test('选用网页订阅后，已有官方 Key 也不会偷偷用于 Fish 边写边读', t => {
  globals(t, { __JINGYI__: undefined, fetch: () => { throw new Error('unexpected fetch'); } });
  __testing.configureForTest({ settings: SETTINGS, initialized: true });
  t.after(() => __testing.configureForTest({ initialized: false }));
  __testing.installPublicApi();
  const api = globalThis.__JINGYI__;
  assert.equal(api.tts.status().provider, 'fish-web');
  assert.equal(api.tts.status().readReady, true);
  assert.equal(api.tts.status().streamReady, false);
  assert.throws(() => api.tts.stream({}), /另选声音来源/);
});

test('播放中第二句失败只送一次，手动补读可用第一句缓存', { timeout: 5000 }, async t => {
  const calls = [];
  const firstPlay = Promise.withResolvers();
  let recovering = false;
  globals(t, {
    __JINGYI__: undefined,
    Audio: class extends EventTarget {
      readyState = 1;
      currentTime = 0;
      duration = .5;
      load() { queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata'))); }
      async play() { firstPlay.resolve(this); }
      pause() {}
      removeAttribute() {}
    },
    fetch: async (url, init) => {
      if (url === FISH_SETTINGS) return settingsResponse();
      assert.equal(url, SPEECH);
      const { input } = JSON.parse(init.body);
      calls.push(input);
      if (input === '第二句。' && !recovering) {
        return Response.json({ error: { submission: 'unknown', message: '连接中断。' } }, { status: 502 });
      }
      return waveResponse();
    },
  });
  __testing.configureForTest({ settings: SETTINGS, initialized: true });
  t.after(() => {
    __testing.stopTts();
    __testing.resetTtsPlayer();
    __testing.configureForTest({ initialized: false });
  });
  __testing.installPublicApi();
  const text = '第一句。第二句。';
  const reading = await globalThis.__JINGYI__.tts.speak({ text });
  const audio = await firstPlay.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['第一句。']);
  audio.dispatchEvent(new Event('ended'));
  await assert.rejects(reading.done, /查看任务记录/);
  assert.deepEqual(calls, ['第一句。', '第二句。']);
  recovering = true;
  const retry = await globalThis.__JINGYI__.tts.speak({ text, play: false });
  await retry.done;
  assert.deepEqual(calls, ['第一句。', '第二句。', '第二句。']);
});

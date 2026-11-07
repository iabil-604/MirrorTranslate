import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSettings, normalizeTts } from '../core.js';
import { fishWebEndpoint, fishWebRequest, probeFishWeb } from '../fish-web.js';
import { __testing } from '../index.js';
import { encodeWav } from '../tts.js';

const BASE = 'https://voice.example/fish';
const OFFICIAL_KEY = 'fixture-official-key';
const CONFIG = { baseUrl: BASE, key: 'fixture-local-key', viaProxy: false };
const SPEECH = BASE + '/v1/audio/speech';
const SETTINGS = mergeSettings({ tts: {
  enabled: true, provider: 'fish-web', fishWeb: CONFIG, fish: { key: OFFICIAL_KEY, retries: 5 },
} });
const voice = id => String(id).repeat(32);
const wav = encodeWav([new Float32Array(8000)], 16000);
const waveResponse = () => new Response(wav, { headers: { 'content-type': 'audio/wav' } });

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
  return { floorId: 'web|' + id, chatId: 'web', messageId: id, version: 'one', side: 'source' };
}

const item = (id, text, voiceId = '') => ({ segment: { id, lineId: 1, type: 'dialogue', text }, voiceId });

test('external Fish settings preserve old URL/Key values and normalize local, LAN and hosted endpoints', () => {
  assert.deepEqual(normalizeTts({ fishWeb: CONFIG }).fishWeb, CONFIG);
  assert.equal(normalizeTts({ fish: { key: OFFICIAL_KEY } }).fish.key, OFFICIAL_KEY);
  for (const address of [BASE, BASE + '/', BASE + '/v1', SPEECH, SPEECH + '/']) {
    assert.equal(fishWebEndpoint(address), SPEECH);
  }
  assert.equal(fishWebEndpoint('127.0.0.1:7860'), 'http://127.0.0.1:7860/v1/audio/speech');
  assert.equal(fishWebEndpoint('http://192.168.1.2:7860/v1'), 'http://192.168.1.2:7860/v1/audio/speech');
  for (const address of ['', 'file:///secret', 'https://user:pass@example.com', BASE + '?key=secret', BASE + '#fragment']) {
    assert.equal(fishWebEndpoint(address), '');
  }
});

test('connection test checks the authenticated model list without submitting speech or Tavern credentials', async t => {
  const calls = [];
  globals(t, { fetch: async (url, init) => {
    calls.push(url);
    assert.equal(url, BASE + '/v1/models');
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.equal(init.headers.get('Authorization'), 'Bearer ' + CONFIG.key);
    assert.equal(init.headers.has('X-CSRF-Token'), false);
    assert.equal(init.headers.has('Cookie'), false);
    assert.equal(init.credentials, 'omit');
    return Response.json({ data: [{ id: 'tts-1' }] });
  } });
  await probeFishWeb(CONFIG, { headers: { 'X-CSRF-Token': 'tavern-fixture', Cookie: 'tavern-session' } });
  assert.equal(calls.length, 1);
  await assert.rejects(probeFishWeb({ ...CONFIG, baseUrl: 'file:///secret' }), /接口 URL/);
  assert.equal(calls.length, 1);
});

test('the existing Tavern proxy carries the local Key separately from host authentication, while Tauri connects directly', async t => {
  const calls = [];
  globals(t, { fetch: async (url, init) => {
    calls.push(url);
    if (url.startsWith('/proxy/')) {
      assert.equal(init.headers.get('X-Api-Key'), CONFIG.key);
      assert.equal(init.headers.get('X-CSRF-Token'), 'tavern-fixture');
      assert.equal(init.headers.has('Authorization'), false);
    } else {
      assert.equal(init.headers.get('Authorization'), 'Bearer ' + CONFIG.key);
      assert.equal(init.headers.has('X-CSRF-Token'), false);
    }
    return Response.json({ data: [{ id: 'tts-1' }] });
  } });
  for (const host of ['sillytavern', 'tauritavern']) {
    await probeFishWeb({ ...CONFIG, viaProxy: true }, { host, headers: { 'X-CSRF-Token': 'tavern-fixture' } });
  }
  assert.deepEqual(calls, ['/proxy/' + BASE + '/v1/models', BASE + '/v1/models']);
});

test('bad credentials and incompatible services show usable errors without echoing the Key', async t => {
  globals(t, { fetch: async () => Response.json({ error: { message: 'bad key ' + CONFIG.key } }, { status: 403 }) });
  await assert.rejects(probeFishWeb(CONFIG), error => !error.message.includes(CONFIG.key) && /已隐藏/.test(error.message));
  globalThis.fetch = async () => Response.json({ error: {} }, { status: 401 });
  await assert.rejects(probeFishWeb(CONFIG), /Key 不正确/);
  globalThis.fetch = async () => Response.json({ data: [{ id: 'chat-model' }] });
  await assert.rejects(probeFishWeb(CONFIG), /tts-1/);
});

test('cancelled speech never reaches the external service', async t => {
  globals(t, { fetch: async () => assert.fail('cancelled request must not be sent') });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fishWebRequest(CONFIG, '/speech', { body: { input: '取消。' }, signal: controller.signal }), { name: 'AbortError' });
});

test('MP3 from an external service is decoded into the existing seekable WAV cache', async t => {
  let submitted = 0;
  let decoded = 0;
  globals(t, {
    fetch: async (url, init) => {
      assert.equal(url, SPEECH);
      assert.equal(JSON.parse(init.body).response_format, 'mp3');
      submitted++;
      return new Response(Uint8Array.of(1, 2, 3), { headers: { 'Content-Type': 'audio/mpeg' } });
    },
    AudioContext: class {
      async decodeAudioData(bytes) {
        assert.deepEqual(new Uint8Array(bytes), Uint8Array.of(1, 2, 3));
        decoded++;
        return { sampleRate: 16000, duration: .5, length: 8000, numberOfChannels: 1, getChannelData: () => new Float32Array(8000) };
      }
      close() {}
    },
  });
  const result = await __testing.ensureTtsRecording(floor(81), 'sentence:1', [item(1, '试读。')], SETTINGS);
  assert.equal(result.record.parts[0].mime, 'audio/wav');
  assert.equal(result.record.parts[0].duration, .5);
  assert.equal((await __testing.ensureTtsRecording(floor(81), 'sentence:1', [item(1, '试读。')], SETTINGS)).cached, true);
  assert.equal(submitted, 1);
  assert.equal(decoded, 1);
});

test('朗读按原顺序发送每句的 Fish 音色，音频与官方模式分开缓存', async t => {
  const requests = [];
  globals(t, { fetch: async (url, init) => {
    assert.equal(url, SPEECH);
    assert.equal(init.headers.get('authorization'), 'Bearer ' + CONFIG.key);
    assert.equal(init.credentials, 'omit');
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
    ['第一句。', voice(1), 'mp3', 'tts-1'], ['第二句。', voice(2), 'mp3', 'tts-1'], ['第三句。', 'default', 'mp3', 'tts-1'],
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

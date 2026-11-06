import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSettings, normalizeTts } from '../core.js';
import { fishWebOrigin, probeFishWeb } from '../fish-web.js';
import { __testing } from '../index.js';
import { encodeWav } from '../tts.js';

const BASE = 'http://127.0.0.1:7860';
const LOCAL_KEY = 'fish_fixture_local_key_0000000000';
const OFFICIAL_KEY = 'fixture-official-key';
const CONFIG = { baseUrl: BASE, key: LOCAL_KEY };
const SETTINGS = mergeSettings({ tts: {
  enabled: true, provider: 'fish-web', fishWeb: CONFIG, fish: { key: OFFICIAL_KEY, retries: 5 },
} });
const voice = id => String(id).repeat(32);
const wav = encodeWav([new Float32Array(8000)], 16000);
const waveResponse = () => new Response(wav, { headers: { 'content-type': 'audio/wav' } });
const healthResponse = voiceConfigured => Response.json({
  status: 'ok', service: 'fish-subscription-proxy', route: 'web-task', voiceConfigured,
});

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

test('现有设置默认继续用官方 Fish，网页 Key 单独保存，地址只接受本机', () => {
  const legacy = normalizeTts({ fish: { key: OFFICIAL_KEY } });
  assert.equal(legacy.provider, 'fish');
  assert.deepEqual(legacy.fishWeb, { baseUrl: BASE, key: '' });
  assert.equal(SETTINGS.tts.fish.key, OFFICIAL_KEY);
  assert.equal(SETTINGS.tts.fishWeb.key, LOCAL_KEY);
  assert.equal(fishWebOrigin('127.0.0.1:7860/v1/audio/speech'), BASE);
  assert.equal(fishWebOrigin('http://localhost:9000/audio/speech/'), 'http://localhost:9000');
  for (const invalid of ['https://outside.example', 'http://127.0.0.1:7860?token=x', 'http://demo@127.0.0.1:7860', 'http://127.0.0.1:7860/admin/config']) {
    assert.equal(fishWebOrigin(invalid), '');
  }
});

test('测试连接先识别本机服务，再用本地 Key 核对模型，不生成语音', async t => {
  const calls = [];
  globals(t, { fetch: async (url, init) => {
    calls.push([url, init.method, init.headers.Authorization, init.redirect]);
    if (url.endsWith('/health')) return healthResponse(false);
    assert.ok(url.endsWith('/v1/models'));
    return Response.json({ object: 'list', data: [{ id: 'tts-1' }] });
  } });
  assert.deepEqual(await __testing.testFishWebConnection(SETTINGS), { voiceConfigured: false });
  assert.deepEqual(calls, [
    [BASE + '/health', 'GET', undefined, 'error'],
    [BASE + '/v1/models', 'GET', `Bearer ${LOCAL_KEY}`, 'error'],
  ]);
});

test('错误地址不发送 Key，错误服务不会收到 Key，反代拒绝 Key 有明确提示', async t => {
  const requests = [];
  let mode = 'unrelated';
  globals(t, { fetch: async (url, init) => {
    requests.push([url, init.headers.Authorization]);
    if (mode === 'unrelated') return Response.json({ status: 'ok', service: 'other' });
    if (url.endsWith('/health')) return healthResponse(true);
    return Response.json({ error: { code: 'invalid_api_key' } }, { status: 401 });
  } });
  await assert.rejects(probeFishWeb({ ...CONFIG, baseUrl: 'https://outside.example' }), /本机地址/);
  assert.deepEqual(requests, []);
  await assert.rejects(probeFishWeb(CONFIG), /不是 Fish 网页订阅服务/);
  assert.deepEqual(requests, [[BASE + '/health', undefined]]);
  mode = 'bad-key';
  await assert.rejects(probeFishWeb(CONFIG), /本地 Key 不正确/);
});

test('朗读按原顺序发送每句的 Fish 音色，音频与官方模式分开缓存', async t => {
  const requests = [];
  globals(t, { fetch: async (url, init) => {
    assert.equal(url, BASE + '/v1/audio/speech');
    assert.equal(init.headers.Authorization, `Bearer ${LOCAL_KEY}`);
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
  globals(t, { fetch: async () => {
    count += 1;
    return Response.json({ error: { code: 'upstream_timeout', message: '语音等待超时。', submission: 'unknown' } }, { status: 504 });
  } });
  await assert.rejects(__testing.ensureTtsRecording(floor(72), 'sentence:1', [item(1, '只提交一次。')], SETTINGS), /查看任务记录/);
  assert.equal(count, 1);
});

test('试听调用反代的默认音色并交给播放器', async t => {
  let played = 0;
  const requests = [];
  globals(t, {
    Audio: class {
      constructor(url) { assert.match(url, /^blob:/); }
      addEventListener(name, handler) { if (name === 'ended') this.ended = handler; }
      pause() {}
      async play() { played += 1; this.ended(); }
    },
    fetch: async (url, init) => {
      requests.push(JSON.parse(init.body));
      assert.equal(url, BASE + '/v1/audio/speech');
      return waveResponse();
    },
  });
  await __testing.auditionFishWeb(SETTINGS);
  assert.equal(played, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].voice, 'default');
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
      assert.equal(url, BASE + '/v1/audio/speech');
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

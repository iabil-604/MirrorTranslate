import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSettings, normalizeTts } from '../core.js';
import { FISH_MANAGED_ROOT, FISH_SERVICE_MISSING, fishManagedRequest } from '../fish-web.js';
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
    assert.equal(url, FISH_MANAGED_ROOT + '/state');
    assert.equal(init.headers.has('authorization'), false);
    return loaded
      ? Response.json({ error: { code: 'not_found', message: 'Fish 操作不存在。' } }, { status: 404 })
      : new Response('<html>Not Found</html>', { status: 404 });
  } });
  await assert.rejects(fishManagedRequest('/state'), { code: FISH_SERVICE_MISSING });
  loaded = true;
  await assert.rejects(fishManagedRequest('/state'), { code: 'not_found', message: 'Fish 操作不存在。' });
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

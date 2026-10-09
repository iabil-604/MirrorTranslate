import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTts } from '../core.js';
import {
  cloudBodyFailure,
  cloudRequestGroups,
  cloudVoiceFor,
  createCloudAudioReader,
  createJsonObjectReader,
  doubaoRequest,
  hexToBytes,
  minimaxRequest,
  parseVoiceMap,
} from '../tts-cloud.js';

const b64 = bytes => Buffer.from(bytes).toString('base64');

test('voices by name: one per line, several names to a line, notes skipped, case ignored', () => {
  const map = parseVoiceMap('樱井=zh_female_a\n# 旧的\n小林、Kobayashi ： voice_b\n旁白: Chinese (Mandarin)_Gentleman\n没有音色的行');
  assert.equal(map.get('樱井'), 'zh_female_a');
  assert.equal(map.get('小林'), 'voice_b');
  assert.equal(map.get('kobayashi'), 'voice_b');
  assert.equal(map.get('旁白'), 'Chinese (Mandarin)_Gentleman', 'a voice id may hold spaces and brackets');
  assert.equal(map.size, 4);
  const config = { voice: 'default_v', voiceMap: '樱井=v1\n旁白=narrator_v' };
  assert.equal(cloudVoiceFor(config, '樱井'), 'v1');
  assert.equal(cloudVoiceFor(config, '路人'), 'default_v', 'a name without a line reads in the default voice');
  assert.equal(cloudVoiceFor(config, '', { narration: true }), 'narrator_v');
  assert.equal(cloudVoiceFor({ voice: 'default_v', voiceMap: '' }, '', { narration: true }), 'default_v');
});

test('sentences in the same voice go as one request, in order; a rewritten one goes as rewritten', () => {
  const config = { voice: 'd', voiceMap: '樱井=s' };
  const item = (speaker, text, type = 'dialogue', override = null) => ({ segment: { speaker, text, type }, ...(override ? { override } : {}) });
  const groups = cloudRequestGroups([
    item('樱井', '你来啦。'),
    item('樱井', '坐吧。'),
    item('', '她笑了笑。', 'narration'),
    item('樱井', '原来的', 'dialogue', { text: '改过的。' }),
    item('樱井', '   '),
  ], config);
  assert.deepEqual(groups, [{ voice: 's', text: '你来啦。\n坐吧。' }, { voice: 'd', text: '她笑了笑。' }, { voice: 's', text: '改过的。' }]);
});

test('a 豆包 request: the new key alone, or the old console pair; PCM when played as it arrives', () => {
  const live = doubaoRequest({ key: 'k1', resourceId: 'seed-tts-2.0', speed: 10, volume: 0 }, { text: '喂？', voice: 'zh_female_vv_uranus_bigtts', live: true, requestId: 'r1', sectionId: 's1' });
  assert.equal(live.url, 'https://openspeech.bytedance.com/api/v3/tts/unidirectional');
  assert.deepEqual(live.headers, { 'Content-Type': 'application/json', 'X-Api-Key': 'k1', 'X-Api-Resource-Id': 'seed-tts-2.0', 'X-Api-Request-Id': 'r1' });
  assert.deepEqual(live.body.req_params.audio_params, { format: 'pcm', sample_rate: 24000, speech_rate: 10, loudness_rate: 0 });
  assert.equal(live.body.req_params.speaker, 'zh_female_vv_uranus_bigtts');
  assert.deepEqual(JSON.parse(live.body.req_params.additions), { max_length_to_filter_parenthesis: 0, section_id: 's1' }, 'additions travel as a JSON string');
  const old = doubaoRequest({ key: 'token', appId: '123', baseUrl: 'https://relay.example/' }, { text: 'x', voice: 'v' });
  assert.equal(old.url, 'https://relay.example/api/v3/tts/unidirectional');
  assert.equal(old.headers['X-Api-App-Id'], '123');
  assert.equal(old.headers['X-Api-Access-Key'], 'token');
  assert.equal(old.headers['X-Api-Key'], undefined);
  assert.equal(old.body.req_params.audio_params.format, 'mp3');
});

test('a MiniMax request: streamed, the repeated whole take asked away, PCM or MP3', () => {
  const live = minimaxRequest({ key: 'k', baseUrl: 'https://api.minimax.io', model: 'speech-2.6-turbo', speed: 1.2 }, { text: '喂？', voice: 'female-shaonv', live: true });
  assert.equal(live.url, 'https://api.minimax.io/v1/t2a_v2');
  assert.equal(live.headers.Authorization, 'Bearer k');
  assert.equal(live.body.stream, true);
  assert.deepEqual(live.body.stream_options, { exclude_aggregated_audio: true });
  assert.deepEqual(live.body.voice_setting, { voice_id: 'female-shaonv', speed: 1.2, vol: 1, pitch: 0 });
  assert.deepEqual(live.body.audio_setting, { format: 'pcm', sample_rate: 24000, channel: 1 });
  assert.equal(minimaxRequest({ key: 'k' }, { text: 'x', voice: 'v' }).body.audio_setting.format, 'mp3');
  assert.equal(minimaxRequest({ key: 'k' }, { text: 'x', voice: 'v' }).url, 'https://api.minimax.cn/v1/t2a_v2');
});

test('JSON objects run together or split anywhere come out whole, once each', () => {
  const seen = [];
  const reader = createJsonObjectReader(object => seen.push(object));
  const text = 'data: {"a":1,"s":"}{\\"x"}\n\n{"b":{"c":[1,2]}}{"d":"end"}';
  for (const character of text) reader.push(character);
  assert.deepEqual(seen, [{ a: 1, s: '}{"x' }, { b: { c: [1, 2] } }, { d: 'end' }]);
});

test('a 豆包 answer: base64 audio as it comes, the end code, a refusal inside the stream', () => {
  const heard = [];
  const reader = createCloudAudioReader('doubao', bytes => heard.push([...bytes]));
  reader.push(`{"code":0,"message":"","data":"${b64([1, 2, 3])}"}\n{"code":0,"data":null,"sentence":{"text":"喂"}}\n{"code":0,"data":"${b64([4])}"}`);
  reader.push('\n{"code":20000000,"message":"ok","data":null}');
  assert.deepEqual(heard, [[1, 2, 3], [4]]);
  assert.equal(reader.received, 2);
  assert.equal(reader.finished, true);
  const refusing = createCloudAudioReader('doubao', () => {});
  assert.throws(() => refusing.push('{"code":45000001,"message":"[Invalid argument] speaker not found"}'), /不认这个音色/);
});

test('a MiniMax answer: hex audio as it comes, the repeated take dropped, a refusal said', () => {
  const heard = [];
  const reader = createCloudAudioReader('minimax', bytes => heard.push([...bytes]));
  reader.push('data: {"data":{"audio":"0102","status":1},"base_resp":{"status_code":0,"status_msg":""}}\n\n');
  reader.push('data: {"data":{"audio":"03","status":1},"base_resp":{"status_code":0}}\n\ndata: {"data":{"audio":"010203","status":2},"extra_info":{"audio_length":100},"base_resp":{"status_code":0}}\n\n');
  assert.deepEqual(heard, [[1, 2], [3]], 'the last event repeats the whole take and is not heard again');
  assert.equal(reader.finished, true);
  const whole = [];
  const once = createCloudAudioReader('minimax', bytes => whole.push([...bytes]));
  once.push('data: {"data":{"audio":"0a0b","status":2},"base_resp":{"status_code":0}}\n\n');
  assert.deepEqual(whole, [[10, 11]], 'a take that came only whole is heard');
  const limited = createCloudAudioReader('minimax', () => {});
  assert.throws(() => limited.push('{"base_resp":{"status_code":1002,"status_msg":"rate limit"}}'), error => error.retryable === true && error.retryAfterMs > 0 && /限流/.test(error.message));
  assert.deepEqual([...hexToBytes('ff00a1')], [255, 0, 161]);
});

test('refusals as whole bodies: a bad key, a disabled proxy, a busy server', () => {
  assert.match(cloudBodyFailure('minimax', { status: 200, body: '{"base_resp":{"status_code":1004,"status_msg":"login fail"}}' }).message, /Key 不对/);
  assert.match(cloudBodyFailure('doubao', { status: 404, body: 'CORS proxy is disabled. Enable it in config.yaml or use the --corsProxy flag.', viaProxy: true }).message, /enableCorsProxy/);
  const busy = cloudBodyFailure('doubao', { status: 500, body: '{"code":55000000,"message":"Request timeout: synthesis processing timeout"}' });
  assert.equal(busy.retryable, true);
  assert.equal(cloudBodyFailure('doubao', { status: 401, body: '{"code":45000000,"message":"unauthorized"}' }).retryable, false);
});

test('the settings keep what the providers take and fall back to what they must have', () => {
  const tts = normalizeTts({ streamVoice: 'minimax', doubao: { key: ' k ', resourceId: 'nope', voice: '', speed: 500 }, minimax: { baseUrl: 'https://evil.example', model: 'speech-2.6-hd' } });
  assert.equal(tts.streamVoice, 'minimax');
  assert.equal(tts.doubao.key, 'k');
  assert.equal(tts.doubao.resourceId, 'seed-tts-2.0');
  assert.equal(tts.doubao.voice, 'zh_female_vv_uranus_bigtts');
  assert.equal(tts.doubao.speed, 100);
  assert.equal(tts.doubao.viaProxy, true);
  assert.equal(tts.minimax.baseUrl, 'https://api.minimax.cn', 'only the two MiniMax sites');
  assert.equal(tts.minimax.model, 'speech-2.6-hd');
  assert.equal(normalizeTts({ streamVoice: 'other' }).streamVoice, 'fish');
  assert.equal(normalizeTts({}).liveAudio, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_GSV,
  followVoiceLibrary,
  gsvVoiceId,
  isGsvVoiceId,
  normalizeGsvSettings,
  normalizeTts,
  normalizeVoiceLibrary,
} from '../core.js';
import {
  buildGsvPayload,
  describeGsvFailure,
  encodeWav,
  gsvEndpoint,
  gsvHeaders,
  gsvTextLang,
  gsvVoiceTag,
  itemIdentity,
  recordingCacheKey,
  scaleWavVolume,
  ttsProvider,
  wavInfo,
} from '../tts.js';

const CLIP = 'D:\\BaiduNetdiskDownload\\海玲（3.23更新）\\HaiLingV2.1\\3.WAV';

test('GPT-SoVITS settings: Fish stays the default, and every field is kept in its range', () => {
  const tts = normalizeTts({});
  assert.equal(tts.provider, 'fish');
  assert.deepEqual(tts.gsv, normalizeGsvSettings({}));
  assert.equal(tts.gsv.baseUrl, DEFAULT_GSV.baseUrl);
  const gsv = normalizeGsvSettings({
    baseUrl: 'http://127.0.0.1:9880///', speed: 9, temperature: 0, topK: 0, repetitionPenalty: 5, splitMethod: 'cut9', promptLang: 'all_ja',
    refAudioPath: `"${CLIP}"`, promptText: '掛け持ちしていた\nバンドを全て辞めてきました', timeoutSec: 1,
  });
  assert.equal(gsv.baseUrl, 'http://127.0.0.1:9880');
  assert.equal(gsv.speed, 1.65);
  assert.equal(gsv.temperature, 0.05);
  assert.equal(gsv.topK, 1);
  assert.equal(gsv.repetitionPenalty, 2);
  assert.equal(gsv.splitMethod, 'cut5');
  assert.equal(gsv.promptLang, 'ja');
  assert.equal(gsv.refAudioPath, CLIP, 'the quotes Explorer\'s 「复制文件地址」 adds are not part of the path');
  assert.equal(gsv.promptText, '掛け持ちしていたバンドを全て辞めてきました', 'a line broken inside Japanese closes up');
  assert.equal(gsv.timeoutSec, 10);
  assert.equal(normalizeGsvSettings({ baseUrl: 'ftp://x' }).baseUrl, DEFAULT_GSV.baseUrl);
  assert.equal(normalizeTts({ provider: 'gsv' }).provider, 'gsv');
  assert.equal(normalizeTts({ provider: 'elevenlabs' }).provider, 'fish');
});

test('a voice library entry heard only through GPT-SoVITS is bound by an id of its own, made from its handle', () => {
  const library = normalizeVoiceLibrary([
    { id: 'voice-umiri', name: '海玲', voiceId: '', lang: 'ja', gsv: { refAudioPath: CLIP, promptText: '掛け持ちしていたバンドを全て辞めてきました', promptLang: 'ja' } },
    { id: 'voice-both', name: '两边', voiceId: 'abcdef0123456789abcdef0123456789', gsv: { refAudioPath: 'D:\\clip.wav' } },
    { id: 'voice-fish', name: '只有 Fish', voiceId: '0123456789abcdef0123456789abcdef' },
    { id: 'voice-gone', name: '空了', voiceId: 'gsv-voice-gone' },
    { id: 'voice-unnamed', voiceId: '', gsv: { refAudioPath: 'D:\\refs\\喵梦 (3).wav' } },
  ]);
  assert.deepEqual(library.map(entry => entry.voiceId), ['gsv-voice-umiri', 'abcdef0123456789abcdef0123456789', '0123456789abcdef0123456789abcdef', 'gsv-voice-unnamed']);
  assert.equal(library[0].gsv.promptLang, 'ja');
  assert.equal(library[1].gsv.refAudioPath, 'D:\\clip.wav', 'an entry may carry a Fish id and a clip both');
  assert.equal('gsv' in library[2], false);
  assert.equal(library[3].name, '喵梦 (3)', 'an entry nobody named is called by its clip');
  assert.equal(gsvVoiceId('voice-umiri'), 'gsv-voice-umiri');
  assert.match(gsvVoiceId('海玲'), /^gsv-[0-9a-z]+$/, 'a handle without a letter of ASCII still makes a usable id');
  assert.equal(gsvVoiceId('海玲'), gsvVoiceId('海玲'));
  assert.ok(isGsvVoiceId('gsv-voice-umiri'));
  assert.ok(!isGsvVoiceId('abcdef0123456789abcdef0123456789'));
});

test('a Fish id taken off an entry with a clip moves its bindings onto the entry\'s own id, and back', () => {
  const fishId = 'abcdef0123456789abcdef0123456789';
  const before = [{ id: 'voice-a', name: '泰罗', voiceId: fishId, gsv: { refAudioPath: 'D:\\taro.wav' } }];
  const after = [{ id: 'voice-a', name: '泰罗', voiceId: '', gsv: { refAudioPath: 'D:\\taro.wav' } }];
  const settings = {
    voiceLibrary: after,
    tts: { narratorVoice: fishId, dialogueVoice: '', narratorVoices: { ja: fishId } },
    ttsVoices: { 'taro.png': [{ name: '泰罗', voiceId: fishId, voices: {}, moods: [{ when: 'laugh', voiceId: fishId }] }] },
  };
  const moved = followVoiceLibrary(before, settings);
  assert.equal(moved.tts.narratorVoice, 'gsv-voice-a');
  assert.equal(moved.tts.narratorVoices.ja, 'gsv-voice-a');
  assert.equal(moved.ttsVoices['taro.png'][0].voiceId, 'gsv-voice-a');
  assert.equal(moved.ttsVoices['taro.png'][0].moods[0].voiceId, 'gsv-voice-a', 'a 情绪音色 bound to the entry moves with it');
  const back = followVoiceLibrary(after, { ...moved, voiceLibrary: before });
  assert.equal(back.tts.narratorVoice, fishId);
});

test('through the tavern\'s proxy a GPT-SoVITS query rides inside the path and survives the route\'s one unescape', () => {
  const path = 'D:\\a b\\海玲+V2.1-e30.ckpt';
  const proxied = gsvEndpoint({ baseUrl: 'http://127.0.0.1:9880' }, '/set_gpt_weights', { query: { weights_path: path } });
  assert.ok(proxied.startsWith('/proxy/http://127.0.0.1:9880/set_gpt_weights%3F'));
  assert.ok(!proxied.includes('?'), 'a bare ? would end the path the route reads');
  // What the route hands on: its path parameter, unescaped once.
  const forwarded = new URL(decodeURIComponent(proxied.slice('/proxy/'.length)));
  assert.equal(forwarded.pathname, '/set_gpt_weights');
  assert.equal(forwarded.searchParams.get('weights_path'), path);
  const direct = gsvEndpoint({ baseUrl: 'http://127.0.0.1:9880', viaProxy: false }, '/set_gpt_weights', { query: { weights_path: path } });
  assert.equal(new URL(direct).searchParams.get('weights_path'), path);
  assert.equal(gsvEndpoint({ baseUrl: 'http://127.0.0.1:9880/' }, '/tts'), '/proxy/http://127.0.0.1:9880/tts');
  assert.equal(gsvEndpoint({ baseUrl: 'http://127.0.0.1:9880' }, '/tts', { host: 'tauritavern' }), 'http://127.0.0.1:9880/tts');
  assert.deepEqual(gsvHeaders({}, { 'X-CSRF-Token': 't' }), { 'X-CSRF-Token': 't', 'Content-Type': 'application/json' });
  assert.deepEqual(gsvHeaders({ viaProxy: false }, { 'X-CSRF-Token': 't' }), { 'Content-Type': 'application/json' }, 'the host\'s token never goes to a third party');
});

function gsvTts(overrides = {}) {
  return normalizeTts({
    provider: 'gsv',
    mode: 'deep',
    gsv: { refAudioPath: 'D:\\refs\\narrator.wav', promptText: '旁白的参考音频。', promptLang: 'zh', gptWeights: 'D:\\base.ckpt', sovitsWeights: 'D:\\base.pth', ...overrides },
  });
}

const LIBRARY = normalizeVoiceLibrary([
  { id: 'voice-taro', name: '泰罗', voiceId: 'voice-taro', gsv: { refAudioPath: 'D:\\refs\\taro.wav', promptText: 'なんで来た？', promptLang: 'ja', gptWeights: 'D:\\taro.ckpt' } },
]);

test('a sentence goes to GPT-SoVITS as its words alone, in its own language, in the voice bound to it', () => {
  const tts = gsvTts();
  const item = {
    segment: { id: 2, type: 'dialogue', speaker: '泰罗', text: '「你怎么来了？」', lang: 'zh', voice: { script: '[惊讶] 你、你怎么来了？！[轻笑]', speed: 'fast' } },
    voiceId: 'voice-taro',
  };
  const { body, spans, voice, weights, volume } = buildGsvPayload([item], tts, { library: LIBRARY });
  assert.equal(body.text, '你、你怎么来了？！', 'the script\'s doubled word stays; its tags go, and leave no gap behind');
  assert.equal(body.text_lang, 'zh');
  assert.equal(body.ref_audio_path, 'D:\\refs\\taro.wav');
  assert.equal(body.prompt_text, 'なんで来た？');
  assert.equal(body.prompt_lang, 'ja');
  assert.equal(body.media_type, 'wav');
  assert.equal(body.streaming_mode, false);
  assert.equal(body.text_split_method, 'cut5');
  assert.equal(body.top_k, 15);
  assert.equal(voice.source, 'library');
  assert.deepEqual(weights, { gpt: 'D:\\taro.ckpt', sovits: 'D:\\base.pth' }, 'an entry\'s own model wins; the one it lacks is the default\'s');
  assert.equal(volume, 0);
  assert.deepEqual(spans, [{ id: 2, text: '你、你怎么来了？！' }]);

  // A voice with no clip in the library reads in the default voice; Japanese is read as Japanese.
  const narration = { segment: { id: 1, type: 'narration', text: '泰羅はカップを置いた。' }, voiceId: '0123456789abcdef0123456789abcdef' };
  const plain = buildGsvPayload([narration], normalizeTts({ ...tts, mode: 'off' }), { library: LIBRARY });
  assert.equal(plain.body.ref_audio_path, 'D:\\refs\\narrator.wav');
  assert.equal(plain.voice.source, 'default');
  assert.equal(plain.body.text_lang, 'ja');
  assert.equal(plain.body.text, '泰羅はカップを置いた。');

  // The reader's own numbers win; a sung line is read in plain words.
  const own = buildGsvPayload([{ ...item, override: { text: '[singing] 好热！', speed: 1.3, volume: 3 } }], tts, { library: LIBRARY });
  assert.equal(own.body.text, '好热！');
  assert.equal(own.body.speed_factor, 1.3);
  assert.equal(own.volume, 3);

  // Nothing to read with: the request says so rather than guessing a clip.
  const none = buildGsvPayload([narration], normalizeTts({ provider: 'gsv' }), { library: [] });
  assert.equal(none.body.ref_audio_path, '');
  assert.equal(none.voice, null);
});

test('GPT-SoVITS reads the reading\'s speed steps on its own speed, and its language codes are its own', () => {
  const tts = gsvTts({ speed: 1.2 });
  const slow = { segment: { id: 1, type: 'dialogue', text: '「嗯。」', voice: { script: '嗯。', speed: 'slow' } }, voiceId: '' };
  assert.equal(buildGsvPayload([slow], tts).body.speed_factor, Number((1.2 * 0.88).toFixed(2)));
  assert.equal(gsvTextLang({ segment: { lang: 'en-GB' } }, 'Hello'), 'en');
  assert.equal(gsvTextLang({ segment: { lang: 'ko' } }, '안녕'), 'ko');
  assert.equal(gsvTextLang({ segment: { lang: 'fr' } }, 'Bonjour'), 'auto');
  assert.equal(gsvTextLang({ segment: {} }, 'こんにちは'), 'ja');
  assert.equal(gsvTextLang({ segment: {} }, '你好'), 'zh');
});

test('a recording knows the clip it was made from: a clip changed behind the same id is another voice, Fish\'s keys stay as they were', async () => {
  const tts = gsvTts();
  const tag = gsvVoiceTag('voice-taro', tts.gsv, LIBRARY);
  const changed = normalizeVoiceLibrary([{ ...LIBRARY[0], gsv: { ...LIBRARY[0].gsv, refAudioPath: 'D:\\refs\\taro-angry.wav' } }]);
  assert.notEqual(gsvVoiceTag('voice-taro', tts.gsv, changed), tag);
  assert.equal(gsvVoiceTag('voice-taro', tts.gsv, LIBRARY), tag);
  assert.equal(ttsProvider('gsv').voiceTag('voice-taro', tts, LIBRARY), tag);
  assert.equal(ttsProvider('fish').voiceTag, undefined);

  const item = { segment: { id: 1, type: 'dialogue', text: '「好热！」', speaker: '泰罗' }, voiceId: 'voice-taro' };
  assert.equal(itemIdentity({ ...item, voiceTag: undefined }), itemIdentity(item), 'an item without a tag is identified exactly as before');
  assert.notEqual(itemIdentity({ ...item, voiceTag: tag }), itemIdentity(item));
  const key = options => recordingCacheKey({ floorId: 'f', version: 'v', unit: 'line:1', maxChars: 1500, fingerprint: {}, ...options });
  assert.equal(await key({ items: [{ ...item, voiceTag: undefined }] }), await key({ items: [item] }));
  assert.notEqual(await key({ items: [{ ...item, voiceTag: tag }] }), await key({ items: [item] }));
  assert.equal(ttsProvider('gsv').fingerprint(tts).provider, 'gsv');
  assert.deepEqual(ttsProvider('gsv').parts([item, item], tts), [[item], [item]], 'every sentence is a request of its own');
  assert.equal(ttsProvider('gsv').mime(), 'audio/wav');
});

test('a wav from GPT-SoVITS is measured from its header, and its volume set without clipping', () => {
  const samples = new Float32Array(32000).map((_, index) => Math.sin(index / 10) * 0.5);
  const wav = encodeWav([samples], 32000);
  const info = wavInfo(wav);
  assert.equal(info.sampleRate, 32000);
  assert.equal(info.channels, 1);
  assert.equal(info.bits, 16);
  assert.equal(info.duration, 1);
  assert.equal(wavInfo(new Uint8Array([1, 2, 3])), null);
  const peak = bytes => {
    const view = new DataView(bytes.buffer, bytes.byteOffset + 44);
    let most = 0;
    for (let at = 0; at + 1 < view.byteLength; at += 2) most = Math.max(most, Math.abs(view.getInt16(at, true)));
    return most;
  };
  const louder = scaleWavVolume(wav, 20);
  assert.ok(peak(louder) <= 32112, 'never past the ceiling');
  assert.ok(peak(louder) > peak(wav) * 1.5);
  const quieter = scaleWavVolume(wav, -6);
  assert.ok(Math.abs(peak(quieter) / peak(wav) - 0.501) < 0.01);
  assert.equal(scaleWavVolume(wav, 0), wav, 'no change, no copy');
  assert.equal(wavInfo(louder).duration, 1);
});

test('GPT-SoVITS failures read plainly: not running, a clip of the wrong length, a missing file, a model that will not load', () => {
  assert.match(describeGsvFailure({ status: 500, body: 'Internal Server Error' }), /连不上 GPT-SoVITS.*api_v2\.py/);
  assert.match(describeGsvFailure({ status: 404, body: 'CORS proxy is disabled. Enable it in config.yaml or use the --corsProxy flag.' }), /enableCorsProxy/);
  assert.match(describeGsvFailure({ status: 400, body: JSON.stringify({ message: 'tts failed', Exception: '参考音频在3~10秒范围外，请更换！' }) }), /太长或太短/);
  assert.match(describeGsvFailure({ status: 400, body: JSON.stringify({ message: 'tts failed', Exception: "Error opening 'D:\\\\x.wav': System error." }) }), /读不到参考音频/);
  assert.match(describeGsvFailure({ status: 400, body: JSON.stringify({ message: 'change gpt weight failed', Exception: 'No such file' }) }), /换模型失败|读不到/);
  assert.match(describeGsvFailure({ status: 400, body: JSON.stringify({ message: 'text_lang: ko is not supported in version v1' }) }), /不认识这个语言/);
  assert.match(describeGsvFailure({ network: true, viaProxy: false }), /经酒馆 CORS 代理/);
  assert.match(describeGsvFailure({ status: 400, body: JSON.stringify({ message: 'tts failed', Exception: 'CUDA out of memory' }) }), /CUDA out of memory/);
});

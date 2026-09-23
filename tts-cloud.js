// Voices besides Fish for what is read while it is written (边写边读, calls): 豆包语音 (Volcengine) and
// MiniMax. A stretch of text goes in; audio comes back as it is made — raw 16-bit PCM when it is to be
// played as it arrives, MP3 otherwise. What each provider is sent, and how its answer is read, lives
// here; index.js does the fetching and the playing.
//
// Pure functions only.

export const CLOUD_VOICE_LABELS = Object.freeze({ doubao: '豆包语音', minimax: 'MiniMax' });

/** A space where a Latin word meets Chinese (「MiniMax 的 Key」), the way the rest of the page writes it. */
export function spacedLatin(text) {
  return String(text ?? '')
    .replace(/([A-Za-z0-9])([一-鿿])/g, '$1 $2')
    .replace(/([一-鿿])([A-Za-z])/g, '$1 $2');
}

// ---------------------------------------------------------------------------------------------
// Who speaks in which voice: 「名字=音色ID」, one per line.
// ---------------------------------------------------------------------------------------------

/**
 * The reader's list of voices by name. A line is 「名字=音色ID」 (＝ ： : also do); several names may share
 * a line (「樱井、小樱=…」); a line starting with # is a note. Names are matched without regard to case.
 */
export function parseVoiceMap(text) {
  const map = new Map();
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(.+?)\s*[=＝:：]\s*(\S.*)$/);
    if (!match) continue;
    const voice = match[2].trim();
    for (const name of match[1].split(/[,，、|/]/)) {
      const key = name.trim().toLowerCase();
      if (key) map.set(key, voice);
    }
  }
  return map;
}

/** The voice a speaker reads in: their own line, else 「旁白」's for narration, else the default voice. */
export function cloudVoiceFor(config, speaker, { narration = false } = {}) {
  const map = parseVoiceMap(config?.voiceMap);
  const name = String(speaker ?? '').trim().toLowerCase();
  if (name && map.has(name)) return map.get(name);
  if (narration && map.has('旁白')) return map.get('旁白');
  return String(config?.voice ?? '').trim();
}

/**
 * Request items (as the reading makes them) as requests: consecutive sentences in the same voice go
 * together, in order; a sentence the reader rewrote is sent as rewritten.
 */
export function cloudRequestGroups(items, config) {
  const groups = [];
  for (const item of Array.isArray(items) ? items : []) {
    const segment = item?.segment ?? {};
    const text = String(item?.override?.text ?? segment.text ?? '').trim();
    if (!text) continue;
    const voice = cloudVoiceFor(config, item?.override?.speaker ?? segment.speaker, { narration: segment.type === 'narration' });
    const last = groups.at(-1);
    if (last && last.voice === voice) last.text += `\n${text}`;
    else groups.push({ voice, text });
  }
  return groups;
}

// ---------------------------------------------------------------------------------------------
// 豆包语音: POST /api/v3/tts/unidirectional, answered with JSON objects one after another, each carrying
// base64 audio, the last one code 20000000.
// ---------------------------------------------------------------------------------------------

export const DOUBAO_RESOURCES = Object.freeze(['seed-tts-2.0', 'seed-icl-2.0', 'seed-tts-1.0']);

/**
 * One 豆包 request. The key goes in X-Api-Key (the new console's single key); with an App ID it is the
 * old console's pair instead, App ID and Access Token. `sectionId` is the same for a whole call, so the
 * voice keeps one manner across it.
 */
export function doubaoRequest(config, { text, voice, live = false, sampleRate = 24000, requestId = '', sectionId = '' }) {
  const base = String(config?.baseUrl || 'https://openspeech.bytedance.com').replace(/\/+$/, '');
  const key = String(config?.key ?? '');
  const appId = String(config?.appId ?? '').trim();
  const additions = {
    // What is sent was cleaned of asides already; nothing more is taken out.
    max_length_to_filter_parenthesis: 0,
    ...(sectionId ? { section_id: sectionId } : {}),
  };
  return {
    url: `${base}/api/v3/tts/unidirectional`,
    headers: {
      'Content-Type': 'application/json',
      ...(appId ? { 'X-Api-App-Id': appId, 'X-Api-Access-Key': key } : { 'X-Api-Key': key }),
      'X-Api-Resource-Id': config?.resourceId || 'seed-tts-2.0',
      'X-Api-Request-Id': requestId,
    },
    body: {
      req_params: {
        text: String(text ?? ''),
        speaker: String(voice ?? ''),
        audio_params: {
          format: live ? 'pcm' : 'mp3',
          sample_rate: sampleRate,
          speech_rate: Number(config?.speed) || 0,
          loudness_rate: Number(config?.volume) || 0,
        },
        additions: JSON.stringify(additions),
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// MiniMax: POST /v1/t2a_v2 with stream on, answered as server-sent events, each carrying hex audio; the
// last (status 2) would repeat the whole take, which is asked away. A refusal comes back as HTTP 200.
// ---------------------------------------------------------------------------------------------

export const MINIMAX_MODELS = Object.freeze(['speech-2.8-turbo', 'speech-2.6-turbo', 'speech-2.8-hd', 'speech-2.6-hd']);
export const MINIMAX_HOSTS = Object.freeze(['https://api.minimax.cn', 'https://api.minimax.io']);

export function minimaxRequest(config, { text, voice, live = false, sampleRate = 24000 }) {
  const base = String(config?.baseUrl || MINIMAX_HOSTS[0]).replace(/\/+$/, '');
  return {
    url: `${base}/v1/t2a_v2`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${String(config?.key ?? '')}` },
    body: {
      model: config?.model || MINIMAX_MODELS[0],
      text: String(text ?? ''),
      stream: true,
      stream_options: { exclude_aggregated_audio: true },
      voice_setting: { voice_id: String(voice ?? ''), speed: Number(config?.speed) || 1, vol: 1, pitch: 0 },
      audio_setting: live ? { format: 'pcm', sample_rate: sampleRate, channel: 1 } : { format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 },
      language_boost: 'auto',
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Reading the answers.
// ---------------------------------------------------------------------------------------------

export function hexToBytes(hex) {
  const text = String(hex ?? '');
  const bytes = new Uint8Array(Math.floor(text.length / 2));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function base64Bytes(value) {
  const binary = globalThis.atob(String(value ?? ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * The JSON objects in a stream that may run them together, one per line or none: each complete object is
 * handed over once, whatever the chunks it came in. Strings are skipped over, braces inside them too.
 */
export function createJsonObjectReader(onObject) {
  let buffer = '';
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let scanned = 0;
  const scan = () => {
    for (let index = scanned; index < buffer.length; index += 1) {
      const character = buffer[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"' && depth > 0) inString = true;
      else if (character === '{') {
        if (depth === 0) start = index;
        depth += 1;
      } else if (character === '}' && depth > 0) {
        depth -= 1;
        if (depth === 0) {
          const text = buffer.slice(start, index + 1);
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = null;
          }
          if (parsed) onObject(parsed);
          buffer = buffer.slice(index + 1);
          index = -1;
          start = -1;
        }
      }
      scanned = index + 1;
    }
    if (depth === 0) {
      // Nothing open: whatever is left (spaces, an SSE 「data: 」 prefix) is not part of any object.
      buffer = '';
      scanned = 0;
    } else {
      scanned = buffer.length;
    }
  };
  return {
    push(text) {
      buffer += String(text ?? '');
      scan();
    },
  };
}

/** A provider's refusal, in words the reader can act on. `retryable` ones pass if asked again later. */
export function cloudFailure(kind, { status = 0, code = null, message = '', viaProxy = false, network = false } = {}) {
  const label = CLOUD_VOICE_LABELS[kind] ?? kind;
  const said = String(message ?? '').slice(0, 300);
  let text = '';
  let retryable = false;
  let wait = 0;
  if (network) {
    text = viaProxy ? `连不上${label}：酒馆的代理没有回应，检查酒馆是否在运行。` : `连不上${label}：网络断了，或者这个地址不让浏览器直接访问。`;
    retryable = true;
  } else if (viaProxy && status === 404 && /CORS proxy is disabled/i.test(said)) {
    text = `酒馆的 CORS 代理没开：在酒馆的 config.yaml 里把 enableCorsProxy 改成 true，重启酒馆。${label}只能经代理访问。`;
  } else if (kind === 'doubao') {
    if (status === 401 || status === 403 || /grant not found|unauthorized|invalid.*(key|token)|access denied/i.test(said) && !/speaker/i.test(said)) {
      text = `${label}的 Key 不对，或者没开通语音合成服务（${said || status}）。`;
    } else if (/speaker not found|invalid speaker|resource ID is mismatched|speaker permission denied/i.test(said)) {
      text = `${label}不认这个音色：音色 ID 写错了，或者它不在你选的资源（Resource ID）里（${said}）。`;
    } else if (/quota exceeded.*lifetime/i.test(said)) {
      text = `${label}的试用额度用完了，要在火山引擎控制台开通正式版。`;
    } else if (/quota exceeded.*concurrency/i.test(said)) {
      text = `${label}同时进行的请求太多了，稍后自动再试。`;
      retryable = true;
      wait = 1500;
    } else if (/timeout/i.test(said) || status >= 500 || Number(code) === 55000000) {
      text = `${label}这次没合成出来（${said || status}）。`;
      retryable = true;
    } else {
      text = `${label}拒绝了这次请求（${code ?? status}${said ? `：${said}` : ''}）。`;
    }
  } else if (kind === 'minimax') {
    const number = Number(code);
    if ([1004, 2049].includes(number) || status === 401) text = `${label}的 Key 不对（${said || number || status}）。国内账号选国内站，海外账号选海外站，两边的 Key 不通用。`;
    else if (number === 1008) text = `${label}余额不足。`;
    else if ([1002, 1039, 1041, 2045, 2056].includes(number) || status === 429) {
      text = `${label}限流了：国内站免费账号每分钟只能请求 10 次，充值后 20 次（${number || status}）。`;
      retryable = true;
      wait = 4000;
    } else if ([2013, 20132].includes(number)) text = `${label}说参数不对，多半是音色 ID 写错了（${said}）。`;
    else if (number === 2042) text = `${label}说你没有这个音色的使用权（${said}）。`;
    else if ([1026, 1027].includes(number)) text = `${label}说这段内容涉敏，不肯读。`;
    else if ([1000, 1001, 1024, 1033].includes(number) || status >= 500) {
      text = `${label}这次没合成出来（${number || status}${said ? `：${said}` : ''}）。`;
      retryable = true;
    } else text = `${label}拒绝了这次请求（${number || status}${said ? `：${said}` : ''}）。`;
  } else {
    text = `${label}：${said || status}`;
  }
  const error = new Error(spacedLatin(text));
  error.status = status;
  error.code = code;
  error.retryable = retryable;
  error.retryAfterMs = wait;
  return error;
}

/**
 * Reads one provider's answer as it arrives. `push` the text as it comes; `onAudio` hears each piece of
 * audio as bytes. A refusal inside the stream throws from `push`. `finished` says whether the provider
 * said it was done; `received` how many pieces of audio came.
 */
export function createCloudAudioReader(kind, onAudio) {
  let received = 0;
  let finished = false;
  const give = bytes => {
    if (!bytes.length) return;
    received += 1;
    onAudio(bytes);
  };
  let pending = null;
  const reader = createJsonObjectReader(object => {
    if (pending) return;
    try {
      if (kind === 'doubao') {
        const code = Number(object.code);
        if (code === 20000000) {
          finished = true;
          return;
        }
        if (code !== 0 && Number.isFinite(code)) throw cloudFailure(kind, { code, message: object.message });
        if (typeof object.data === 'string' && object.data) give(base64Bytes(object.data));
        return;
      }
      const status = Number(object.base_resp?.status_code ?? 0);
      if (status !== 0) throw cloudFailure(kind, { code: status, message: object.base_resp?.status_msg });
      const data = object.data;
      if (!data) return;
      if (Number(data.status) === 2) {
        finished = true;
        // The whole take again, unless it was asked away; heard only when nothing came before it.
        if (!received && typeof data.audio === 'string' && data.audio) give(hexToBytes(data.audio));
        return;
      }
      if (typeof data.audio === 'string' && data.audio) give(hexToBytes(data.audio));
    } catch (error) {
      pending = error;
    }
  });
  return {
    push(text) {
      reader.push(text);
      if (pending) throw pending;
    },
    get received() { return received; },
    get finished() { return finished; },
  };
}

/** A refusal given as a whole body (HTTP error, or MiniMax's HTTP 200 with base_resp): the words for it. */
export function cloudBodyFailure(kind, { status = 0, body = '', viaProxy = false } = {}) {
  let parsed = null;
  try {
    parsed = JSON.parse(String(body ?? ''));
  } catch {
    parsed = null;
  }
  if (kind === 'minimax' && parsed?.base_resp) return cloudFailure(kind, { status, code: parsed.base_resp.status_code, message: parsed.base_resp.status_msg, viaProxy });
  if (kind === 'doubao' && parsed && (parsed.code !== undefined || parsed.message !== undefined)) return cloudFailure(kind, { status, code: parsed.code ?? null, message: parsed.message ?? '', viaProxy });
  return cloudFailure(kind, { status, message: String(body ?? '').slice(0, 300), viaProxy });
}

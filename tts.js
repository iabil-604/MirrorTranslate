import {
  hashText,
  isPlaceholderSpeaker,
  normalizeNewlines,
  parseJsonCandidates,
  splitSpeechParts,
  unifySpeakerNames,
} from './core.js?v=0.17.0';
import { EMOTION_KEYS, EMOTION_STYLES, normalizeEmotion, normalizeIntensity } from './palette.js?v=0.17.0';

// ---------------------------------------------------------------------------------------------
// Reading the translation aloud.
//
// The same split the colouring uses holds here: the model is asked who says a line and in what mood,
// and nothing else. It never hands text back, so it cannot rewrite a line on its way to the voice —
// the text that is read is always the text on the floor. Where the lines are cut, which voice reads
// them, how a mood becomes a provider's markup and where each sentence sits in the audio are all
// computed on this side.
//
// Three layers, so another provider only ever replaces the last one:
//   floor text → utterances (local split) → segments (labels + standard structure) → provider adapter
// ---------------------------------------------------------------------------------------------

export const TTS_DOCUMENT_VERSION = 1;
export const TTS_ANALYSIS_VERSION = 1;
export const NARRATOR = 'narrator';

const INVISIBLE_RE = /[\u200b-\u200f\u2060-\u2064\ufeff]/g;
const ENTITY_MAP = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' });

function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return Object.hasOwn(ENTITY_MAP, body.toLowerCase()) ? ENTITY_MAP[body.toLowerCase()] : whole;
  });
}

// Markup that reached a line is presentation, not speech.
export function plainLineText(text) {
  return decodeEntities(String(text ?? '').replace(INVISIBLE_RE, '').replace(/<[^<>]*>/g, ''))
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Lines inside literal source tags, for floors this extension never translated.
 *
 * A floor written by the translator is read through its own boundaries instead, which work whatever the
 * visible affixes are; this is the fallback for a preset that types `<jy-translation>` itself.
 */
export function linesFromTaggedText(text, tags = []) {
  const source = normalizeNewlines(text);
  const blocks = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    if (!/^[A-Za-z][A-Za-z0-9_:-]*$/.test(String(tag))) continue;
    const name = escapeRegex(tag);
    const pattern = new RegExp(`<${name}(?:\\s[^<>]*)?>([\\s\\S]*?)<\\/${name}\\s*>`, 'gi');
    for (const match of source.matchAll(pattern)) blocks.push({ index: match.index, inner: match[1] });
  }
  blocks.sort((left, right) => left.index - right.index);
  const lines = [];
  for (const block of blocks) {
    for (const raw of block.inner.split('\n')) {
      const text = plainLineText(raw);
      if (/[\p{L}\p{N}]/u.test(text)) lines.push({ lineId: lines.length + 1, text });
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------
// Layer 1: utterances. A line is cut at its quotation marks, and narration again at its full stops,
// so every sentence someone might want to hear twice has a boundary of its own.
// ---------------------------------------------------------------------------------------------

const SENTENCE_STOP_RE = /[。！？!?]/u;
const SENTENCE_TAIL_RE = /[。！？!?…～~」』”’"'）)\]】》]/u;
const EDGE_PUNCTUATION_RE = /^[\s，,、；;：:。．.！!？?）)\]】》」』”’]+/u;
const SPEAKABLE_RE = /[\p{L}\p{N}]/u;
const QUOTE_PAIRS = new Map([['「', '」'], ['『', '』'], ['“', '”'], ['"', '"']]);

export function splitNarrationSentences(text) {
  const characters = [...String(text ?? '')];
  const pieces = [];
  let buffer = '';
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    buffer += character;
    const englishStop = character === '.' && (index + 1 === characters.length || /\s/.test(characters[index + 1]));
    if (!SENTENCE_STOP_RE.test(character) && !englishStop) continue;
    // The marks and closers that finish a sentence belong to it, not to the start of the next one.
    while (index + 1 < characters.length && SENTENCE_TAIL_RE.test(characters[index + 1])) {
      index += 1;
      buffer += characters[index];
    }
    pieces.push(buffer);
    buffer = '';
  }
  if (buffer) pieces.push(buffer);
  return pieces;
}

function unquote(run) {
  const characters = [...run];
  const closer = QUOTE_PAIRS.get(characters[0]);
  if (closer && characters.length >= 2 && characters.at(-1) === closer) return characters.slice(1, -1).join('');
  return run;
}

/**
 * Cuts translated lines into utterances.
 *
 * `anchor` is the run exactly as it stands in the line, quotation marks and leftover commas included,
 * so it can be found again on the rendered floor. `text` is what gets read: the quotes come off a
 * spoken run and a narration run loses the comma it inherited from the quote before it. Nothing else
 * about the words changes.
 */
export function splitUtterances(lines) {
  const utterances = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const lineText = String(line?.text ?? '');
    for (const part of splitSpeechParts(lineText)) {
      const runs = part.spoken ? [part.text] : splitNarrationSentences(part.text);
      for (const run of runs) {
        const text = (part.spoken ? unquote(run) : run).replace(EDGE_PUNCTUATION_RE, '').trim();
        if (!SPEAKABLE_RE.test(text)) continue;
        utterances.push({
          id: utterances.length + 1,
          lineId: line.lineId,
          kind: part.spoken ? 'quoted' : 'narration',
          anchor: run,
          text,
        });
      }
    }
  }
  return utterances;
}

// ---------------------------------------------------------------------------------------------
// Layer 2: labels and the standard structure.
// ---------------------------------------------------------------------------------------------

const DIALOGUE_TYPES = new Set(['dialogue', 'speech', 'spoken', 'line', 'quote', 'quoted', '对白', '对话', '台词']);
const NARRATION_TYPES = new Set(['narration', 'narrator', 'narrative', 'description', 'thought', 'inner', 'monologue', '旁白', '叙述', '描写', '心理']);

function normalizeUtteranceType(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (DIALOGUE_TYPES.has(raw)) return 'dialogue';
  if (NARRATION_TYPES.has(raw)) return 'narration';
  return '';
}

function readTtsLabel(item) {
  if (!item || typeof item !== 'object') return null;
  const label = {};
  const type = normalizeUtteranceType(item.type ?? item.kind ?? item.role);
  if (type) label.type = type;
  const speaker = String(item.speaker ?? item.who ?? item.name ?? item.character ?? '').trim().slice(0, 60);
  if (speaker && !isPlaceholderSpeaker(speaker)) label.speaker = speaker;
  const emotion = normalizeEmotion(item.emotion ?? item.mood ?? item.tone);
  if (emotion) label.emotion = emotion;
  const intensity = Number(item.intensity ?? item.level);
  if (Number.isFinite(intensity)) label.intensity = Math.min(2, Math.max(0, Math.round(intensity)));
  return Object.keys(label).length ? label : null;
}

/**
 * Labels taken from the translation's own per-line annotations: no request, but one speaker per line.
 * A narrated line wears no speaker even when the model gave it one, the same rule the colouring keeps.
 */
export function labelsFromAnnotations(utterances, annotations) {
  const labels = new Map();
  if (!(annotations instanceof Map)) return labels;
  for (const utterance of utterances) {
    if (utterance.kind !== 'quoted') continue;
    const mark = annotations.get(utterance.lineId);
    if (!mark) continue;
    const label = readTtsLabel({ type: 'dialogue', speaker: mark.speaker, emotion: mark.emotion, intensity: mark.intensity });
    if (label) labels.set(utterance.id, label);
  }
  return labels;
}

const EMOTION_GLOSS = EMOTION_KEYS.map(key => `${key}=${EMOTION_STYLES[key].label}`).join('、');

/**
 * The request that asks the model who reads each utterance.
 *
 * The utterances travel with their ids and the model answers with labels keyed by those ids. There is no
 * text field in the answer at all, which is what keeps 「我操好热啊！」 from coming back as something
 * politer: whatever the model thinks of the wording, it has nowhere to write it.
 */
export function buildTtsAnalysisMessages(utterances, { roster = [], characterName = '', userName = '', translations = null } = {}) {
  // Reading the original: the roster holds the names as the translation spells them (樱井), the text
  // says 桜井. Each line's translation rides along so the model can name people the way the voices are
  // registered, and the rule below says so.
  const references = translations instanceof Map
    ? [...translations].filter(([, text]) => String(text ?? '').trim()).map(([line, text]) => ({ line, text: String(text) }))
    : [];
  const system = [
    '你是有声小说的配音导演助手。下面是一楼正文按顺序切好的句子。你只判断每一句由谁念、用什么情绪念，不改写、不复述、不翻译任何句子。',
    '输入的 utterances 每项有 id、kind（quoted 表示原文在引号里，narration 表示不在引号里）和 text。',
    '只输出一个 JSON 对象，不要任何解释：{"labels":[{"id":1,"type":"narration"},{"id":2,"type":"dialogue","speaker":"名字","emotion":"标签","intensity":1}]}',
    '1. type 只能是 dialogue（角色说出口的话）或 narration（旁白、叙述、动作、心理描写）。引号里通常是 dialogue；引号用来标书名、专有名词、强调或引用文字时是 narration。不在引号里、却是角色直接说出的话（例如「泰罗：好热」这种写法）是 dialogue。确实是旁白的 narration 句可以不写。',
    `2. speaker 只给 dialogue。优先从 roster 里逐字照抄名字，不加敬称；roster 里没有的人，写正文里对这个人的称呼。${userName ? `用户扮演的角色叫 ${userName}。` : ''}看不出是谁说的就省略 speaker，不要猜。`,
    `3. emotion 只给 dialogue，只能取下列英文标签之一并逐字照抄：${EMOTION_GLOSS}。依据是这句话本身和紧挨着它的叙述（例如「吼道」「小声说」），不是你对剧情的推测。看不出明显情绪写 neutral。`,
    '4. intensity 0 弱、1 中、2 强，默认 1。只有原文明确写了加强或减弱（感叹号连用、吼、尖叫、低声、颤抖）才写 2 或 0。',
    '5. 每个 id 最多出现一次。不要输出 text，不要输出 id 以外的句子内容。',
    ...(references.length
      ? ['6. 输入里的 translations 是这些原文行（按 line 对应）的译文，只用来帮你认人、理解语气。speaker 按 roster 或译文里的写法写，不要写原文里的名字。']
      : []),
  ].join('\n');
  const input = {
    task: 'label_utterances_for_audiobook',
    ...(characterName ? { character: characterName } : {}),
    ...(userName ? { user: userName } : {}),
    roster: [...new Set((Array.isArray(roster) ? roster : []).map(name => String(name ?? '').trim()).filter(Boolean))].slice(0, 60),
    emotions: EMOTION_KEYS,
    utterances: (Array.isArray(utterances) ? utterances : []).map(item => (references.length
      ? { id: item.id, line: item.lineId, kind: item.kind, text: item.anchor }
      : { id: item.id, kind: item.kind, text: item.anchor })),
    ...(references.length ? { translations: references } : {}),
  };
  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(input) },
  ];
}

export function parseTtsAnalysis(raw, utterances) {
  const ids = new Set((Array.isArray(utterances) ? utterances : []).map(item => item.id));
  const labels = new Map();
  let candidates = 0;
  for (const candidate of parseJsonCandidates(raw)) {
    candidates += 1;
    const items = Array.isArray(candidate)
      ? candidate
      : Array.isArray(candidate?.labels) ? candidate.labels
        : Array.isArray(candidate?.utterances) ? candidate.utterances
          : Array.isArray(candidate?.items) ? candidate.items
            // A reply cut off mid-array still yields its closed objects one by one.
            : candidate && typeof candidate === 'object' && Object.hasOwn(candidate, 'id') ? [candidate] : [];
    for (const item of items) {
      const id = Number(item?.id ?? item?.utterance);
      if (!ids.has(id) || labels.has(id)) continue;
      const label = readTtsLabel(item);
      if (label) labels.set(id, label);
    }
  }
  return { labels, candidates };
}

/**
 * Utterances plus labels, in the provider-neutral shape.
 *
 * Speaker spellings are unified against the names this cast is known by first, so 希尔达夫人 and 希尔达
 * reach the same voice. A label that is missing or invalid costs the utterance its speaker or mood and
 * nothing else; the type falls back to what the quotation marks said.
 */
export function buildSegments(utterances, labels = new Map(), { knownNames = [] } = {}) {
  const reported = [...labels.values()].map(label => label?.speaker).filter(Boolean);
  const names = unifySpeakerNames(reported, knownNames);
  return (Array.isArray(utterances) ? utterances : []).map(utterance => {
    const label = labels.get(utterance.id) ?? {};
    const type = label.type || (utterance.kind === 'quoted' ? 'dialogue' : 'narration');
    const base = { id: utterance.id, lineId: utterance.lineId, type, text: utterance.text, anchor: utterance.anchor };
    if (type === 'narration') return { ...base, speaker: NARRATOR, emotion: null, intensity: null };
    const speaker = label.speaker ? (names.get(label.speaker) ?? label.speaker) : null;
    const emotion = label.emotion && label.emotion !== 'neutral' ? label.emotion : null;
    return { ...base, speaker, emotion, intensity: emotion ? normalizeIntensity(label.intensity) : null };
  });
}

export function segmentsInRange(segments, range = 'all') {
  const list = Array.isArray(segments) ? segments : [];
  if (range === 'dialogue') return list.filter(segment => segment.type === 'dialogue');
  if (range === 'narration') return list.filter(segment => segment.type === 'narration');
  return list;
}

export function toStandardDocument(segments, timeline = null) {
  const times = new Map((Array.isArray(timeline) ? timeline : []).map(item => [item.id, item]));
  return {
    version: TTS_DOCUMENT_VERSION,
    segments: (Array.isArray(segments) ? segments : []).map(segment => ({
      id: `seg_${String(segment.id).padStart(3, '0')}`,
      type: segment.type,
      text: segment.text,
      speaker: segment.type === 'narration' ? NARRATOR : segment.speaker,
      emotion: segment.emotion,
      ...(times.has(segment.id) ? { start: times.get(segment.id).start, end: times.get(segment.id).end } : {}),
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Voices.
// ---------------------------------------------------------------------------------------------

export function voiceRosterNames(voices) {
  return (Array.isArray(voices) ? voices : []).flatMap(item => [item.name, ...(item.aliases ?? [])]).filter(Boolean);
}

/**
 * The voice a segment is read in: the narrator's own voice for narration, the character's mapped voice
 * for dialogue, then the dialogue default. Narration falls back to the dialogue default rather than
 * going silent, and the other way round.
 */
export function resolveSegmentVoice(segment, { voices = [], narratorVoice = '', dialogueVoice = '' } = {}) {
  if (segment?.type === 'narration') return narratorVoice || dialogueVoice || '';
  const name = String(segment?.speaker ?? '');
  if (name) {
    const entry = (Array.isArray(voices) ? voices : []).find(item => item.name === name || item.aliases?.includes(name));
    if (entry?.voiceId) return entry.voiceId;
  }
  return dialogueVoice || narratorVoice || '';
}

export function planVoices(segments, config) {
  const items = [];
  const missing = new Set();
  for (const segment of Array.isArray(segments) ? segments : []) {
    const voiceId = resolveSegmentVoice(segment, config);
    if (!voiceId) missing.add(segment.type === 'narration' ? '旁白' : (segment.speaker || '未知说话人'));
    else items.push({ segment, voiceId });
  }
  return { items, missing: [...missing] };
}

// ---------------------------------------------------------------------------------------------
// Layer 3: the Fish Audio adapter.
// ---------------------------------------------------------------------------------------------

// S2 reads free-form bracket cues; the three steps follow Fish's own intensity table where it has one.
// S1 only knows a fixed parenthesised set, so its column stays inside that set.
const FISH_S2_CUES = Object.freeze({
  happy: ['[satisfied]', '[happy]', '[delighted]'],
  tender: ['[warm]', '[gentle]', '[tender][soft tone]'],
  sad: ['[disappointed]', '[sad]', '[very sad]'],
  angry: ['[frustrated]', '[angry]', '[furious]'],
  fear: ['[nervous]', '[scared]', '[terrified]'],
  shy: ['[shy]', '[embarrassed]', '[very embarrassed]'],
  surprise: ['[slightly surprised]', '[surprised]', '[shocked]'],
  serious: ['[calm]', '[serious]', '[stern]'],
  resolute: ['[confident]', '[determined]', '[very determined]'],
  whisper: ['[soft tone]', '[whispering]', '[whispering]'],
  shout: ['[loud]', '[shouting]', '[screaming]'],
});
const FISH_S1_CUES = Object.freeze({
  happy: ['(satisfied)', '(happy)', '(delighted)'],
  tender: ['(relaxed)', '(soft tone)', '(soft tone)'],
  sad: ['(disappointed)', '(sad)', '(depressed)'],
  angry: ['(frustrated)', '(angry)', '(angry)(shouting)'],
  fear: ['(nervous)', '(scared)', '(scared)'],
  shy: ['(embarrassed)', '(embarrassed)', '(embarrassed)'],
  surprise: ['(surprised)', '(surprised)', '(surprised)'],
  serious: ['(calm)', '(calm)', '(confident)'],
  resolute: ['(determined)', '(determined)', '(determined)'],
  whisper: ['(whispering)', '(whispering)', '(whispering)'],
  shout: ['(shouting)', '(shouting)', '(screaming)'],
});

export function emotionCue(emotion, intensity, model = 's2-pro') {
  const key = normalizeEmotion(emotion);
  if (!key || key === 'neutral') return '';
  const table = model === 's1' ? FISH_S1_CUES : FISH_S2_CUES;
  return table[key]?.[normalizeIntensity(intensity)] ?? '';
}

export function fishSupportsMultiSpeaker(model) {
  return model !== 's1';
}

/**
 * Cuts a floor into requests. A voice change only forces a new request on a model that cannot switch
 * speakers mid-text; the character budget keeps any one request from running into provider limits.
 */
export function planFishParts(items, { model = 's2-pro', maxChars = 1500 } = {}) {
  const multi = fishSupportsMultiSpeaker(model);
  const budget = Math.max(1, Number(maxChars) || 1500);
  const parts = [];
  let current = [];
  let characters = 0;
  let voice = null;
  for (const item of Array.isArray(items) ? items : []) {
    const length = String(item.segment.text).length;
    if (current.length && ((!multi && item.voiceId !== voice) || characters + length > budget)) {
      parts.push(current);
      current = [];
      characters = 0;
    }
    current.push(item);
    characters += length;
    voice = item.voiceId;
  }
  if (current.length) parts.push(current);
  return parts;
}

/**
 * Turns the standard structure into Fish's own request.
 *
 * One voice sends a plain reference id and no speaker tags, which every model accepts. Several voices
 * send the id array and a `<|speaker:N|>` tag wherever the voice changes, N indexing that array. The
 * mood rides as a cue at the start of its sentence, where Fish says sentence-level cues work best.
 */
export function buildFishPayload(items, fish, { emotionCues = true } = {}) {
  const list = Array.isArray(items) ? items : [];
  const voices = [];
  for (const item of list) if (!voices.includes(item.voiceId)) voices.push(item.voiceId);
  const multi = voices.length > 1;
  if (multi && !fishSupportsMultiSpeaker(fish.model)) throw new Error('s1 模型不支持一次请求里用多个音色。');
  let text = '';
  let currentVoice = null;
  list.forEach((item, index) => {
    if (index) text += '\n';
    if (multi && item.voiceId !== currentVoice) text += `<|speaker:${voices.indexOf(item.voiceId)}|>`;
    currentVoice = item.voiceId;
    const cue = emotionCues ? emotionCue(item.segment.emotion, item.segment.intensity, fish.model) : '';
    text += cue ? `${cue} ${item.segment.text}` : item.segment.text;
  });
  const body = {
    text,
    reference_id: multi ? voices : voices[0],
    format: fish.format,
    latency: fish.latency,
    normalize: fish.normalize,
    temperature: fish.temperature,
    top_p: fish.topP,
    prosody: { speed: fish.speed, volume: fish.volume },
  };
  if (fish.format === 'mp3') body.mp3_bitrate = fish.mp3Bitrate;
  return { body, spans: list.map(item => ({ id: item.segment.id, text: item.segment.text })), voices };
}

export const FISH_MIME = Object.freeze({ mp3: 'audio/mpeg', opus: 'audio/ogg', wav: 'audio/wav', pcm: 'audio/L16' });

export function fishEndpoint(fish, path) {
  const base = String(fish?.baseUrl || 'https://api.fish.audio').replace(/\/+$/, '');
  const target = `${base}${path}`;
  // The host's proxy takes the full target URL as its path.
  return fish?.viaProxy === false ? target : `/proxy/${target}`;
}

/**
 * Request headers for one Fish call.
 *
 * Through the proxy the host's own headers go along: the CSRF token is what lets a disabled proxy answer
 * with its own explanation instead of a bare 403, and the proxy strips it before forwarding. A direct
 * call never carries the host's session token to a third party.
 */
export function fishHeaders(fish, hostHeaders = {}) {
  const base = fish?.viaProxy === false ? {} : { ...hostHeaders };
  return {
    ...base,
    'Content-Type': 'application/json',
    Authorization: `Bearer ${fish?.key ?? ''}`,
    model: fish?.model ?? 's2-pro',
  };
}

export function describeFishFailure({ status = 0, body = '', viaProxy = true, network = false } = {}) {
  if (network) {
    return viaProxy
      ? '连不上酒馆的代理接口，检查酒馆是否还在运行。'
      : '浏览器直连失败：api.fish.audio 不允许浏览器跨域访问。改用「经酒馆代理」，或者填一个允许跨域的中转地址。';
  }
  const text = String(body ?? '');
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = null; }
  const message = typeof payload?.message === 'string' ? payload.message : text.replace(/\s+/g, ' ').slice(0, 240);
  // The host proxy rewrites 401 to 400 so the browser keeps its own Basic auth; the body still says 401.
  const upstream = Number(payload?.status) || Number(status) || 0;
  if (Number(status) === 404 && /CORS proxy is disabled/i.test(text)) {
    return '酒馆的 CORS 代理没有打开。在酒馆目录的 config.yaml 里把 enableCorsProxy 改成 true，重启酒馆后再试。';
  }
  if (Number(status) === 403 && /csrf/i.test(text)) return '酒馆拒绝了这次代理请求（CSRF）。刷新酒馆页面后再试。';
  if (upstream === 401 || /api[- ]?key|unauthorized/i.test(message)) return 'Fish API Key 无效或没有填写。';
  if (upstream === 402) return 'Fish API 余额不足。API 额度和网页端的额度分开计算；可以先把模型换成 s2.1-pro-free（免费开发者档），或者去 fish.audio/app/developers 充值。';
  if (upstream === 429) return 'Fish 限流了，请求太频繁。等一会儿再试，免费档的限制更紧。';
  if (upstream === 404) return `Fish 接口地址不对（HTTP 404）：${message || '没有说明'}`;
  if (upstream >= 500) return `Fish 服务端暂时不可用（HTTP ${upstream}）：${message || '没有说明'}`;
  return `Fish 返回错误（HTTP ${upstream || '未知'}）：${message || '没有说明'}`;
}

/**
 * Server-Sent Events, fed as text arrives.
 *
 * Frames split anywhere — mid-line, mid-CRLF, mid-base64 — so the parser keeps its own buffer and only
 * dispatches a frame on its blank line.
 */
export function createSseParser(onEvent) {
  let buffer = '';
  let data = [];
  let eventName = '';
  const dispatch = () => {
    if (data.length) onEvent({ event: eventName || 'message', data: data.join('\n') });
    data = [];
    eventName = '';
  };
  const feedLine = line => {
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') eventName = value;
  };
  return {
    push(text) {
      buffer += String(text ?? '');
      for (;;) {
        const index = buffer.search(/\r\n|\r|\n/);
        if (index < 0) break;
        // A trailing \r may be the first half of \r\n that the next chunk completes.
        if (buffer[index] === '\r' && index === buffer.length - 1) break;
        const width = buffer.startsWith('\r\n', index) ? 2 : 1;
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + width);
        feedLine(line);
      }
    },
    end() {
      if (buffer) feedLine(buffer.replace(/\r$/, ''));
      buffer = '';
      dispatch();
    },
  };
}

/**
 * Audio and alignment from the timestamp stream.
 *
 * Every audio chunk is kept in arrival order. Alignment is a cumulative snapshot per text chunk, so a
 * newer one replaces the older one for the same `chunk_seq` rather than adding to it.
 */
export function createTimestampCollector() {
  const audio = [];
  const alignments = new Map();
  let events = 0;
  return {
    accept(payload) {
      events += 1;
      if (typeof payload?.audio_base64 === 'string' && payload.audio_base64) audio.push(payload.audio_base64);
      const alignment = payload?.alignment;
      if (alignment && Array.isArray(alignment.segments)) {
        const seq = Number.isInteger(payload.chunk_seq) ? payload.chunk_seq : 0;
        alignments.set(seq, {
          offset: Number(payload.chunk_audio_offset_sec) || 0,
          duration: Number(alignment.audio_duration) || 0,
          segments: alignment.segments,
          content: String(payload.content ?? ''),
        });
      }
    },
    result() {
      return { audio, alignments, events };
    },
  };
}

export function base64ToBytes(value) {
  const binary = globalThis.atob(String(value ?? ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function buildGlobalTimeline(alignments) {
  const timeline = [];
  let duration = 0;
  const ordered = [...(alignments instanceof Map ? alignments : new Map())].sort((left, right) => left[0] - right[0]);
  for (const [, chunk] of ordered) {
    for (const segment of Array.isArray(chunk.segments) ? chunk.segments : []) {
      const start = Number(segment?.start);
      const end = Number(segment?.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      timeline.push({ text: String(segment?.text ?? ''), start: start + chunk.offset, end: Math.max(start, end) + chunk.offset });
    }
    duration = Math.max(duration, chunk.offset + chunk.duration, timeline.at(-1)?.end ?? 0);
  }
  return { timeline, duration };
}

// What alignment keeps of a text: letters and digits. Fish drops punctuation from its segments and
// spells apostrophes its own way, so both sides are reduced to the same alphabet before comparing.
function speakableCharacters(text) {
  return [...String(text ?? '').normalize('NFKC').toLowerCase()].filter(character => SPEAKABLE_RE.test(character));
}

/**
 * Where each of our sentences sits in the generated audio.
 *
 * Fish reports words (per character for Chinese) with the punctuation gone, and with number
 * normalisation on it may say 一百二十三 where the text has 123. So this is a character alignment with
 * resynchronisation, not a lookup: matching characters advance both sides, and a mismatch searches a
 * short window on either side for the next run of two that agree. A sentence then spans the first to
 * the last of its characters that found a partner. A sentence with none — all digits that were read out
 * as words, say — takes the gap between its neighbours, so every sentence still has somewhere to seek.
 */
export function alignSpansToTimeline(spans, timeline, { duration = 0, window = 24 } = {}) {
  const target = [];
  (Array.isArray(spans) ? spans : []).forEach((span, spanIndex) => {
    for (const character of speakableCharacters(span.text)) target.push({ character, spanIndex });
  });
  const spoken = [];
  for (const item of Array.isArray(timeline) ? timeline : []) {
    const characters = speakableCharacters(item.text);
    const step = characters.length ? (item.end - item.start) / characters.length : 0;
    characters.forEach((character, index) => {
      spoken.push({ character, start: item.start + step * index, end: item.start + step * (index + 1) });
    });
  }
  const matched = new Array(target.length).fill(-1);
  const agrees = (targetIndex, spokenIndex) => {
    const run = Math.min(2, target.length - targetIndex, spoken.length - spokenIndex);
    if (run <= 0) return false;
    for (let offset = 0; offset < run; offset += 1) {
      if (target[targetIndex + offset].character !== spoken[spokenIndex + offset].character) return false;
    }
    return true;
  };
  let targetIndex = 0;
  let spokenIndex = 0;
  while (targetIndex < target.length && spokenIndex < spoken.length) {
    if (target[targetIndex].character === spoken[spokenIndex].character) {
      matched[targetIndex] = spokenIndex;
      targetIndex += 1;
      spokenIndex += 1;
      continue;
    }
    let found = null;
    for (let distance = 1; distance <= window * 2 && !found; distance += 1) {
      for (let skipTarget = 0; skipTarget <= distance; skipTarget += 1) {
        const skipSpoken = distance - skipTarget;
        if (skipTarget > window || skipSpoken > window) continue;
        if (targetIndex + skipTarget >= target.length || spokenIndex + skipSpoken >= spoken.length) continue;
        if (agrees(targetIndex + skipTarget, spokenIndex + skipSpoken)) {
          found = { skipTarget, skipSpoken };
          break;
        }
      }
    }
    if (!found) {
      targetIndex += 1;
      continue;
    }
    targetIndex += found.skipTarget;
    spokenIndex += found.skipSpoken;
  }

  const results = (Array.isArray(spans) ? spans : []).map(span => ({ id: span.id, start: null, end: null, matched: 0, total: speakableCharacters(span.text).length }));
  target.forEach((item, index) => {
    const partner = matched[index];
    if (partner < 0) return;
    const result = results[item.spanIndex];
    const time = spoken[partner];
    result.start = result.start === null ? time.start : Math.min(result.start, time.start);
    result.end = result.end === null ? time.end : Math.max(result.end, time.end);
    result.matched += 1;
  });
  const total = Math.max(Number(duration) || 0, spoken.at(-1)?.end ?? 0);
  results.forEach((result, index) => {
    if (result.start !== null) return;
    const previous = results.slice(0, index).reverse().find(item => item.end !== null);
    const next = results.slice(index + 1).find(item => item.start !== null);
    result.start = previous?.end ?? 0;
    result.end = Math.max(result.start, next?.start ?? total);
    result.interpolated = true;
  });
  return results.map(result => ({
    id: result.id,
    start: Number(result.start.toFixed(3)),
    end: Number(result.end.toFixed(3)),
    coverage: result.total ? Number((result.matched / result.total).toFixed(3)) : 0,
    ...(result.interpolated ? { interpolated: true } : {}),
  }));
}

/**
 * The stretch of audio to play for one sentence of a whole-floor recording.
 *
 * The aligned span is word-tight, which clips the breath before the first word and the fall of the last
 * one. A little is added on either side, never reaching into the neighbouring sentence.
 */
export function playbackWindow(entries, index, duration = 0) {
  const list = Array.isArray(entries) ? entries : [];
  const entry = list[index];
  if (!entry) return null;
  const previous = list[index - 1];
  const next = list[index + 1];
  const floor = previous && previous.part === entry.part ? previous.end : 0;
  const ceiling = next && next.part === entry.part ? next.start : (Number(duration) || entry.end + 0.6);
  const round = value => Number(value.toFixed(3));
  return {
    part: entry.part ?? 0,
    start: round(Math.max(floor, entry.start - 0.08)),
    end: round(Math.max(entry.start, Math.min(ceiling, entry.end + 0.35))),
  };
}

export function fishFingerprint(fish, { emotionCues = true } = {}) {
  return {
    provider: 'fish',
    model: fish.model,
    format: fish.format,
    mp3Bitrate: fish.format === 'mp3' ? fish.mp3Bitrate : null,
    latency: fish.latency,
    speed: fish.speed,
    volume: fish.volume,
    temperature: fish.temperature,
    topP: fish.topP,
    normalize: fish.normalize,
    emotionCues,
  };
}

// Floor, text version, speaker, voice, mood and every setting that changes the sound. The key and the
// endpoint are left out: they decide whether a request works, not what it sounds like.
export async function sentenceCacheKey({ floorId, segment, voiceId, fingerprint }) {
  return `s:${await hashText(JSON.stringify({
    v: 1, floorId, type: segment.type, text: segment.text, speaker: segment.speaker,
    voiceId, emotion: segment.emotion, intensity: segment.intensity, fingerprint,
  }))}`;
}

export async function floorCacheKey({ floorId, version, range, maxChars, items, fingerprint }) {
  return `f:${await hashText(JSON.stringify({
    v: 1, floorId, version, range, maxChars, fingerprint,
    items: (Array.isArray(items) ? items : []).map(({ segment, voiceId }) => [
      segment.id, segment.type, segment.text, segment.speaker, segment.emotion, segment.intensity, voiceId,
    ]),
  }))}`;
}

export async function analysisCacheKey({ utterances, roster, source, references = null }) {
  return `a:${await hashText(JSON.stringify({
    v: TTS_ANALYSIS_VERSION, source,
    references: references instanceof Map ? [...references] : null,
    roster: [...new Set(roster ?? [])].sort(),
    utterances: (Array.isArray(utterances) ? utterances : []).map(item => [item.id, item.kind, item.anchor]),
  }))}`;
}

// ---------------------------------------------------------------------------------------------
// Finding utterances again on the rendered floor.
//
// The host renders the floor through markdown, wraps quotes in <q>, and the display regex drops every
// invisible boundary, so the only thing the page and the stored text still share is the words. Both
// sides are reduced to the characters markdown cannot change, and utterances are located in order,
// inside their own line first, so a short Chinese line cannot latch onto the Japanese above it.
// ---------------------------------------------------------------------------------------------

const MATCH_SKIP_RE = /[\s\u200b-\u200f\u2060-\u2064\ufeff*_~`]/u;

function matchKey(text) {
  let key = '';
  for (const character of plainLineText(text)) if (!MATCH_SKIP_RE.test(character)) key += character;
  return key;
}

/**
 * Locates each anchor in a sequence of text-node contents.
 *
 * Returns, per anchor, the node and offset just after its last character (`end`) and of its first
 * (`start`), or null when it cannot be found. Offsets are UTF-16 units, ready for a DOM Range.
 */
export function locateAnchors(nodeTexts, lines, anchors) {
  const units = [];
  let stream = '';
  (Array.isArray(nodeTexts) ? nodeTexts : []).forEach((text, node) => {
    let offset = 0;
    for (const character of String(text ?? '')) {
      const start = offset;
      offset += character.length;
      if (MATCH_SKIP_RE.test(character)) continue;
      for (let unit = 0; unit < character.length; unit += 1) units.push({ node, start, end: offset });
      stream += character;
    }
  });
  const result = new Map();
  // Lines first. Each one also records where the last line found before it ended, which is where a
  // search for an unfound line's utterances may start without reaching back into the source above.
  let cursor = 0;
  const lineRanges = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    const key = matchKey(line.text);
    const at = key ? stream.indexOf(key, cursor) : -1;
    if (at < 0) {
      lineRanges.set(line.lineId, { found: false, after: cursor });
      continue;
    }
    lineRanges.set(line.lineId, { found: true, start: at, end: at + key.length, cursor: at });
    cursor = at + key.length;
  }
  let lastEnd = 0;
  const positionAfter = index => ({ node: units[index].node, offset: units[index].end });
  const positionAt = index => ({ node: units[index].node, offset: units[index].start });
  for (const anchor of Array.isArray(anchors) ? anchors : []) {
    const key = matchKey(anchor.text);
    const range = lineRanges.get(anchor.lineId);
    let at = -1;
    if (key && range?.found) {
      at = stream.indexOf(key, range.cursor);
      if (at < 0 || at + key.length > range.end) at = -1;
      else range.cursor = at + key.length;
    } else if (key) {
      at = stream.indexOf(key, Math.max(lastEnd, range?.after ?? 0));
    }
    if (at < 0) {
      result.set(anchor.id, null);
      continue;
    }
    lastEnd = at + key.length;
    result.set(anchor.id, { start: positionAt(at), end: positionAfter(at + key.length - 1) });
  }
  return result;
}

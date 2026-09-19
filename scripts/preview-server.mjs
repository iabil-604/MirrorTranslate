import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
]);
const previewPort = Number(process.env.JINGYI_PREVIEW_PORT) || 8766;
// Bumped through /preview/analysis-round so a second analysis of the same floor answers differently.
let previewAnalysisRound = 0;
let previewUpdateAvailable = true;

// ---------------------------------------------------------------------------------------------
// A stand-in for Fish Audio behind the host's /proxy/ route. It speaks the same wire format — SSE events
// with base64 audio and cumulative per-chunk alignment, per-character for Chinese with punctuation
// dropped, a new text chunk at every speaker change — but the "voice" is a tone per speaker, so every
// part of the pipeline can be watched without a key or a bill.
// ---------------------------------------------------------------------------------------------

const SAMPLE_RATE = 22050;
const CHARACTER_SECONDS = 0.17;
const PAUSE_SECONDS = 0.28;

function readBody(request) {
  return new Promise(resolve => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function spokenChunks(text) {
  const chunks = [];
  let speaker = 0;
  let buffer = '';
  const flush = () => {
    const clean = buffer.replace(/\[[^\]]*\]\s?/g, '').replace(/\([^)]*\)\s?/g, '');
    if (clean.trim()) chunks.push({ speaker, text: clean });
    buffer = '';
  };
  for (const part of String(text ?? '').split(/(<\|speaker:\d+\|>)/)) {
    const tag = part.match(/^<\|speaker:(\d+)\|>$/);
    if (tag) {
      flush();
      speaker = Number(tag[1]);
    } else {
      buffer += part;
    }
  }
  flush();
  return chunks;
}

function synthesizeChunks(chunks) {
  const samples = [];
  const alignments = [];
  for (const chunk of chunks) {
    const offset = samples.length / SAMPLE_RATE;
    const segments = [];
    const frequency = 260 + chunk.speaker * 120;
    for (const character of chunk.text) {
      const at = samples.length / SAMPLE_RATE - offset;
      if (/[\p{L}\p{N}]/u.test(character)) {
        const count = Math.round(CHARACTER_SECONDS * SAMPLE_RATE);
        for (let index = 0; index < count; index += 1) {
          const envelope = Math.sin((Math.PI * index) / count);
          samples.push(Math.round(Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE) * envelope * 9000));
        }
        segments.push({ text: character, start: Number(at.toFixed(3)), end: Number((at + CHARACTER_SECONDS * 0.9).toFixed(3)) });
      } else if (/[。！？!?，,、…\n]/u.test(character)) {
        for (let index = 0; index < Math.round(PAUSE_SECONDS * SAMPLE_RATE); index += 1) samples.push(0);
      }
    }
    alignments.push({ offset: Number(offset.toFixed(6)), duration: samples.length / SAMPLE_RATE - offset, segments, content: chunk.text });
  }
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, index) => data.writeInt16LE(value, index * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return { wav: Buffer.concat([header, data]), alignments };
}

// The host proxy turns 401 into 400 and keeps the body, and so does this.
function fishAuthFailure(request, response) {
  const auth = String(request.headers.authorization ?? '');
  const key = auth.replace(/^Bearer\s*/i, '').trim();
  if (!key) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 401, message: 'this route requires an api-key or Authorization: Bearer <api key> header' }));
    return true;
  }
  if (key === 'sk-no-credit') {
    response.writeHead(402, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 402, message: 'Insufficient API credit.' }));
    return true;
  }
  return false;
}

async function handleFishMock(request, response, target) {
  if (fishAuthFailure(request, response)) return;
  if (request.method === 'GET' && target === '/wallet/self/api-credit') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ credit: '12.500000', has_free_credit: false }));
    return;
  }
  const model = target.match(/^\/model\/([^/]+)$/);
  if (request.method === 'GET' && model) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ _id: model[1], title: `预览音色 ${model[1].slice(0, 4)}`, languages: ['zh'] }));
    return;
  }
  const body = await readBody(request);
  const { wav, alignments } = synthesizeChunks(spokenChunks(body.text));
  if (!alignments.length) alignments.push({ offset: 0, duration: 0, segments: [], content: '' });
  if (request.method === 'POST' && target === '/v1/tts') {
    // Like the real proxy: the audio comes back without a content type.
    response.writeHead(200);
    response.end(wav);
    return;
  }
  if (request.method === 'POST' && target === '/v1/tts/stream/with-timestamp') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
    const pieces = [];
    for (let start = 0; start < wav.length; start += 16384) pieces.push(wav.subarray(start, start + 16384));
    let index = 0;
    const timer = setInterval(() => {
      if (index >= pieces.length) {
        clearInterval(timer);
        response.end();
        return;
      }
      // Alignment arrives as a growing snapshot per chunk: the latest one wins.
      const chunkSeq = Math.min(alignments.length - 1, Math.floor((index / pieces.length) * alignments.length));
      const chunk = alignments[chunkSeq];
      const visible = index === pieces.length - 1 ? chunk.segments.length : Math.max(1, Math.ceil(chunk.segments.length * ((index % 3) + 1) / 3));
      response.write(`event: message\ndata: ${JSON.stringify({
        audio_base64: pieces[index].toString('base64'),
        content: chunk.content,
        alignment: { audio_duration: chunk.duration, segments: chunk.segments.slice(0, visible) },
        chunk_seq: chunkSeq,
        chunk_audio_offset_sec: chunk.offset,
      })}\n\n`);
      // Every chunk's final snapshot is sent before moving on, so no chunk is left half aligned.
      if (index + 1 < pieces.length) {
        const nextSeq = Math.min(alignments.length - 1, Math.floor(((index + 1) / pieces.length) * alignments.length));
        if (nextSeq !== chunkSeq) {
          response.write(`event: message\ndata: ${JSON.stringify({
            audio_base64: '',
            content: chunk.content,
            alignment: { audio_duration: chunk.duration, segments: chunk.segments },
            chunk_seq: chunkSeq,
            chunk_audio_offset_sec: chunk.offset,
          })}\n\n`);
        }
      }
      index += 1;
    }, 120);
    request.on('close', () => clearInterval(timer));
    return;
  }
  response.writeHead(404, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ status: 404, message: 'no route' }));
}

http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const proxied = pathname.match(/^\/proxy\/https?:\/+api\.fish\.audio(\/.*)$/);
  if (proxied) {
    void handleFishMock(request, response, proxied[1]);
    return;
  }
  if (request.method === 'POST' && pathname === '/preview/analysis-round') {
    previewAnalysisRound += 1;
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ round: previewAnalysisRound }));
    return;
  }
  if (request.method === 'POST' && pathname === '/api/backends/chat-completions/status') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ data: [{ id: 'translator-small' }, { id: 'translator-pro' }] }));
    return;
  }
  // A reasoning model, mocked: it thinks for a while before a single character of translation
  // appears. That gap is the only way to look at the thinking panel without a real slow model.
  if (request.method === 'POST' && pathname === '/api/backends/chat-completions/generate') {
    // The readings come through here too, and they are not translations: a floor arrives as
    // paragraphs with every quoted run marked ⟦id⟧, and the answer is the dialogue alone.
    const body = await readBody(request);
    const asked = (() => {
      try {
        return JSON.parse([...(body.messages ?? [])].reverse().find(message => message.role === 'user')?.content ?? '{}');
      } catch {
        return {};
      }
    })();
    if (['sketch_voices_for_audiobook', 'direct_voices_for_audiobook', 'refine_voices_for_audiobook'].includes(asked.task)) {
      const deep = asked.task === 'direct_voices_for_audiobook';
      const moods = ['happy', 'nervous', 'tender', 'angry', 'sad'];
      const voices = [];
      let turn = 0;
      let lastName = (asked.roster ?? [])[0] ?? '樱井';
      for (const line of asked.lines ?? []) {
        const text = String(line.text ?? '');
        const named = (asked.roster ?? []).find(name => text.includes(name));
        if (named) lastName = named;
        for (const match of text.matchAll(/⟦(\d+)⟧/g)) {
          const id = Number(match[1]);
          const speaker = asked.speakers?.[id] ?? lastName;
          const emotion = moods[(turn + Number(previewAnalysisRound)) % moods.length];
          turn += 1;
          voices.push(deep
            ? { id, speaker, emotion, tone: 'soft tone', pauses: [{ after: '、', length: 'short' }], sounds: [{ at: 'end', tag: 'sighing' }] }
            : { id, speaker, emotion });
        }
      }
      for (const item of asked.utterances ?? []) voices.push({ id: item.id, speaker: lastName, emotion: moods[Number(previewAnalysisRound) % moods.length] });
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ voices }) } }] })}\n\n`);
      response.write('data: [DONE]\n\n');
      response.end();
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    const frame = delta => response.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
    const thoughts = [
      '先看这一批要译几段。',
      '第 1 段是对话，说话人应该是女方，语气犹豫，句尾有省略号。',
      '「手続き」这里指医院的各种手续，不是抽象的程序。',
      '第 2 段是旁白，保持叙述距离。',
      '第 3 段又回到对话，同一个说话人，情绪更低。',
      '「吐きそう」是身体反应，不要写成「难受」，要留住那个具体。',
      '专名没有新的，术语表里也没有冲突。',
      '再确认一下编号，1 到 3 都在。',
    ];
    let step = 0;
    const tick = setInterval(() => {
      if (step < thoughts.length) {
        frame({ reasoning_content: `${thoughts[step % thoughts.length]}\n` });
        step += 1;
        return;
      }
      clearInterval(tick);
      const payload = JSON.stringify({
        translations: [
          { id: 1, text: '「我一个人大概搞不懂医院的手续怎么办。」', speaker: '星野爱', emotion: 'fear', intensity: 1 },
          { id: 2, text: '她低下了头。' },
          { id: 3, text: '「……一个人待着，就会像刚才那样想吐。」', speaker: '源律', emotion: 'whisper', intensity: 2 },
        ],
      });
      frame({ content: payload });
      response.write('data: [DONE]\n\n');
      response.end();
    }, 420);
    request.on('close', () => clearInterval(tick));
    return;
  }
  if (request.method === 'GET' && pathname === '/api/extensions/discover') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify([{ name: 'third-party/jingyi', type: 'local' }]));
    return;
  }
  if (request.method === 'POST' && pathname === '/api/extensions/version') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      currentBranchName: 'main',
      currentCommitHash: '1234567890abcdef',
      isUpToDate: !previewUpdateAvailable,
      remoteUrl: 'https://github.com/iabil-604/jingyi',
    }));
    return;
  }
  if (request.method === 'POST' && pathname === '/api/extensions/update') {
    const wasUpToDate = !previewUpdateAvailable;
    previewUpdateAvailable = false;
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ shortCommitHash: 'abcdef0', isUpToDate: wasUpToDate }));
    return;
  }
  const relative = pathname === '/' ? 'preview.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(target, (error, data) => {
    if (error) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime.get(path.extname(target)) || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(data);
  });
}).listen(previewPort, '127.0.0.1', () => {
  console.log(`Jingyi preview: http://127.0.0.1:${previewPort}/`);
});

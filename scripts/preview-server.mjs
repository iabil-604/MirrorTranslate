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
let previewUpdateAvailable = true;

http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  if (request.method === 'POST' && pathname === '/api/backends/chat-completions/status') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ data: [{ id: 'translator-small' }, { id: 'translator-pro' }] }));
    return;
  }
  // A reasoning model, mocked: it thinks for a while before a single character of translation
  // appears. That gap is the only way to look at the thinking panel without a real slow model.
  if (request.method === 'POST' && pathname === '/api/backends/chat-completions/generate') {
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
          { id: 1, text: '「我一个人大概搞不懂医院的手续怎么办。」', speaker: '陆玲', emotion: 'fear', intensity: 1 },
          { id: 2, text: '她低下了头。' },
          { id: 3, text: '「……一个人待着，就会像刚才那样想吐。」', speaker: '陆玲', emotion: 'whisper', intensity: 2 },
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

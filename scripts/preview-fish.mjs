export function createPreviewFish(makeWav) {
  return (url, method, body) => {
    if (method === 'GET' && url.pathname === '/v1/models') {
      return Response.json({ object: 'list', data: [{ id: 'tts-1', object: 'model' }] });
    }
    if (method === 'POST' && url.pathname === '/v1/audio/speech') {
      const input = String(body.input ?? '').trim();
      if (!input) return Response.json({ error: { message: '请填写朗读文本。' } }, { status: 400 });
      return new Response(makeWav(input.slice(0, 120), body.voice === '2'.repeat(32) ? 2 : 1),
        { headers: { 'Content-Type': 'audio/wav' } });
    }
    return Response.json({ error: { message: '接口不存在。' } }, { status: 404 });
  };
}

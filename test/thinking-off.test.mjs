import test from 'node:test';
import assert from 'node:assert/strict';

import { createIndependentRequest, normalizeChannel, thinkingOffFor } from '../core.js';
import { readDiagnostics } from '../diagnostics.js';
import { __testing } from '../index.js';

const FISH = { key: 'sk-test', viaProxy: true };

function sse(parts) {
  const body = new ReadableStream({
    start(controller) {
      for (const delta of parts) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`));
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return { ok: true, status: 200, body, text: async () => '' };
}

function host(t, answer) {
  const before = { host: globalThis.SillyTavern, fetch: globalThis.fetch, toastr: globalThis.toastr };
  t.after(() => {
    globalThis.SillyTavern = before.host;
    globalThis.fetch = before.fetch;
    globalThis.toastr = before.toastr;
  });
  const sent = [];
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes('chat-completions/generate')) return new Response('', { status: 404 });
    const payload = JSON.parse(init.body);
    sent.push(payload);
    return answer(payload, sent.length);
  };
  globalThis.toastr = { success() {}, error() {}, warning() {}, info() {} };
  const context = {
    chat: [], chatId: `thinking-${Math.random()}`, name1: '小林', name2: '樱井', characterId: 0, characters: [{ name: '樱井' }],
    extensionSettings: {}, chatMetadata: {}, eventSource: { on() {}, removeListener() {} }, eventTypes: {},
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }), saveSettingsDebounced() {}, getCurrentChatId() { return this.chatId; },
  };
  globalThis.SillyTavern = { getContext: () => context };
  return sent;
}

function onConnection(model, key = 'k-call') {
  const channel = normalizeChannel({ id: 'c1', name: '通话', url: 'https://relay.example/v1', key, model });
  __testing.configureForTest({ settings: { channels: [channel], selectedChannelId: 'c1', apiMode: 'follow', tts: { enabled: true, callChannelId: 'c1', fish: FISH } }, initialized: true });
}

test('what turns a model\'s thinking off is picked by its name, and nothing for a name not known', () => {
  assert.deepEqual(thinkingOffFor('deepseek-chat').body, { thinking: { type: 'disabled' } });
  assert.deepEqual(thinkingOffFor('DeepSeek-V3.2').body, { thinking: { type: 'disabled' } });
  assert.deepEqual(thinkingOffFor('glm-4.6').body, { thinking: { type: 'disabled' } });
  assert.deepEqual(thinkingOffFor('zai-org/GLM-4.5').body, { thinking: { type: 'disabled' } });
  assert.deepEqual(thinkingOffFor('kimi-k2-0905').body, { thinking: { type: 'disabled' } });
  const qwen = thinkingOffFor('Qwen/Qwen3-235B-A22B');
  assert.deepEqual(qwen.body, { enable_thinking: false });
  assert.equal(qwen.noThink, true);
  assert.deepEqual(thinkingOffFor('gemini-2.5-flash').body, { reasoning_effort: 'none' });
  assert.deepEqual(thinkingOffFor('gpt-5-mini').body, { reasoning_effort: 'minimal' });
  for (const name of ['gpt-5-chat-latest', 'gemini-2.5-pro', 'claude-sonnet-4-5', 'gpt-4o', 'labeler', '']) assert.equal(thinkingOffFor(name), null, name);
});

test('a request with thinking turned off goes out as the custom source, carrying the connection\'s own key', () => {
  const channel = normalizeChannel({ id: 'c1', url: 'https://relay.example/v1/chat/completions', key: 'k-call', model: 'deepseek-chat', reasoningEffort: 'low' });
  const plain = createIndependentRequest(channel, [{ role: 'user', content: '在吗' }]);
  assert.equal(plain.chat_completion_source, 'openai', 'other requests are as they were');
  assert.equal(plain.reasoning_effort, 'low');
  const off = createIndependentRequest(channel, [{ role: 'user', content: '在吗' }], { thinkingOff: true });
  assert.equal(off.chat_completion_source, 'custom');
  assert.equal(off.custom_url, 'https://relay.example/v1');
  assert.deepEqual(JSON.parse(off.custom_include_headers), { Authorization: 'Bearer k-call' });
  assert.deepEqual(JSON.parse(off.custom_include_body), { thinking: { type: 'disabled' } });
  assert.equal('reverse_proxy' in off || 'proxy_password' in off || 'reasoning_effort' in off, false);
  assert.equal(off.thinkingOff.label, 'DeepSeek');
  assert.equal(JSON.stringify(off).includes('thinkingOff'), false, 'the label is not sent');
  const keyless = createIndependentRequest({ ...channel, key: '' }, [{ role: 'user', content: '在吗' }], { thinkingOff: true });
  assert.deepEqual(JSON.parse(keyless.custom_include_headers), { Authorization: '' }, 'no stored key of the host goes to this address');
  const unknown = createIndependentRequest({ ...channel, model: 'labeler' }, [{ role: 'user', content: '在吗' }], { thinkingOff: true });
  assert.equal(unknown.chat_completion_source, 'openai', 'a model not known is sent as before');
});

test('a call asks with thinking off, says so, and asks again without it where the field is refused', async t => {
  let sent = host(t, () => sse([{ content: '在的。' }]));
  onConnection('Qwen3-32B');
  assert.equal(await __testing.apiLlmStream({ messages: [{ role: 'system', content: '打电话。' }, { role: 'user', content: '在吗？' }] }), '在的。');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat_completion_source, 'custom');
  assert.deepEqual(JSON.parse(sent[0].custom_include_body), { enable_thinking: false });
  assert.equal(sent[0].messages.at(-1).content, '在吗？\n/no_think', 'Qwen3 is also told in the conversation');
  assert.match(readDiagnostics().at(-1).message, /已关思考（Qwen）/);

  sent = host(t, (_payload, count) => (count === 1 ? { ok: false, status: 400, body: null, text: async () => 'unknown field: thinking' } : sse([{ content: '喂？' }])));
  onConnection('deepseek-v3.2-exp');
  assert.equal(await __testing.apiLlmStream({ messages: [{ role: 'user', content: '在吗？' }] }), '喂？');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].chat_completion_source, 'openai', 'asked again without the field');
  assert.equal(await __testing.apiLlmStream({ messages: [{ role: 'user', content: '还在吗？' }] }), '喂？');
  assert.equal(sent[2].chat_completion_source, 'openai', 'and not sent it again this session');

  sent = host(t, () => sse([{ reasoning_content: '先想一想对方是谁' }, { content: '嗯。' }]));
  onConnection('gemini-2.5-pro');
  assert.equal(await __testing.apiLlmStream({ messages: [{ role: 'user', content: '在吗？' }] }), '嗯。');
  const line = readDiagnostics().at(-1);
  assert.equal(line.level, 'warn');
  assert.match(line.message, /模型先想了 8 字.*这个模型镜译不知道怎么关思考/, 'thinking that was not turned off is said');
});

test('a 400 that is not about the field (a wrong key) is said as it is, and the field is still sent next time', async t => {
  const sent = host(t, () => ({ ok: false, status: 400, body: null, text: async () => '{"error":"invalid api key"}' }));
  onConnection('glm-4.6', 'wrong-key');
  await assert.rejects(__testing.apiLlmStream({ messages: [{ role: 'user', content: '在吗？' }] }), /invalid api key/);
  assert.equal(sent.length, 2, 'asked once more without the field');
  assert.equal(readDiagnostics().some(entry => /glm-4\.6 不接受关掉思考的参数/.test(entry.message)), false, 'no word of the field being refused');
  await assert.rejects(__testing.apiLlmStream({ messages: [{ role: 'user', content: '在吗？' }] }));
  assert.equal(sent[2].chat_completion_source, 'custom', 'the field is still sent');
});

test('thinking written into the reply itself counts as thinking; an empty block does not', async t => {
  host(t, () => sse([{ content: '<think>他在问我在不在</think>在。' }]));
  onConnection('deepseek-r1');
  await __testing.apiLlmStream({ messages: [{ role: 'user', content: '在吗？' }] });
  assert.match(readDiagnostics().at(-1).message, /模型先想了 7 字.*没关住/);
  host(t, () => sse([{ content: '<think>\n\n</think>在。' }]));
  onConnection('Qwen3-8B');
  await __testing.apiLlmStream({ messages: [{ role: 'user', content: '在吗？' }] });
  assert.match(readDiagnostics().at(-1).message, /已关思考（Qwen）/);
});

import test from 'node:test';
import assert from 'node:assert/strict';

// The generation gate against SillyTavern 1.18's own event order, with an emitter that awaits its
// listeners one by one as the host's does (lib/eventemitter.js). Each 重新生成 below is one way the reply
// used to go untranslated; each must now be handed to automatic translation exactly once.
const toasts = [];
globalThis.document = {
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], visibilityState: 'visible',
  head: null, body: null, documentElement: null, addEventListener() {}, removeEventListener() {},
};
globalThis.toastr = Object.fromEntries(['success', 'error', 'warning', 'info'].map(kind => [kind, message => toasts.push([kind, message])]));

const { onActivate, onDisable, __testing } = await import('../index.js');
const { readDiagnostics, clearDiagnostics } = await import('../diagnostics.js');

class Emitter {
  constructor() { this.events = {}; }
  on(event, listener) { (this.events[event] ??= []).push(listener); }
  removeListener(event, listener) {
    const list = this.events[event];
    if (list && list.includes(listener)) list.splice(list.indexOf(listener), 1);
  }
  async emit(event, ...args) {
    for (const listener of [...(this.events[event] ?? [])]) {
      try { await listener(...args); } catch { /* a listener's own error is not the emitter's */ }
    }
  }
}
const T = {
  GENERATION_STARTED: 'generation_started', GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS', GENERATION_ENDED: 'generation_ended', GENERATION_STOPPED: 'generation_stopped',
  CHARACTER_MESSAGE_RENDERED: 'character_message_rendered', MESSAGE_RECEIVED: 'message_received', MESSAGE_DELETED: 'message_deleted',
  MESSAGE_SWIPED: 'message_swiped', MESSAGE_EDITED: 'message_edited', MESSAGE_UPDATED: 'message_updated', CHAT_CHANGED: 'chat_id_changed',
  MESSAGE_SWIPE_DELETED: 'message_swipe_deleted', MORE_MESSAGES_LOADED: 'more_messages_loaded', STREAM_TOKEN_RECEIVED: 'stream_token_received',
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const eventSource = new Emitter();
const chat = [];
for (let index = 0; index <= 6; index += 1) {
  chat.push({ name: index % 2 ? 'user' : '樱井', is_user: index % 2 === 1, is_system: false, mes: `第${index}楼 こんにちは。`, swipe_id: 0, swipes: [`第${index}楼`], extra: {} });
}
const context = {
  // No page here to put the floating button on.
  chat, chatId: 'gate-chat', extensionSettings: { 'jingyi-translator': { showFloatingButton: false } }, characters: [{ name: '樱井' }], characterId: 0,
  substituteParams: value => String(value ?? ''), saveChat: async () => {}, updateMessageBlock: () => {}, getRequestHeaders: () => ({}),
  saveSettingsDebounced: () => {}, eventTypes: T, eventSource, streamingProcessor: null,
};
globalThis.SillyTavern = { getContext: () => context };
await onActivate();
await eventSource.emit(T.CHAT_CHANGED, 'gate-chat');

const started = floor => readDiagnostics().filter(entry => entry.scope === 'translation.auto' && entry.message.startsWith(`第 ${floor} 楼生成结束，自动翻译开始`)).length;

// The host's start: GENERATION_STARTED, the slash commands, then GENERATION_AFTER_COMMANDS unless a command
// took the send over.
async function begin(type, { command = false } = {}) {
  await eventSource.emit(T.GENERATION_STARTED, type, {}, false);
  if (!command) await eventSource.emit(T.GENERATION_AFTER_COMMANDS, type, {}, false);
}

// A streaming 重新生成 in the host's order: STARTED, the old reply deleted, the new one streamed, then the
// end announced before the awaited MESSAGE_RECEIVED and the typed render.
async function regenerate({ text = null, onDeleted = null, slowReceivedMs = 0, midStream = null, midStreamEnded = 0, beforeReceived = null, after = null } = {}) {
  const extra = [];
  const listen = (event, listener) => { eventSource.on(event, listener); extra.push([event, listener]); };
  if (onDeleted) listen(T.MESSAGE_DELETED, onDeleted);
  if (slowReceivedMs) listen(T.MESSAGE_RECEIVED, () => wait(slowReceivedMs));
  await begin('regenerate');
  const old = chat.pop();
  await eventSource.emit(T.MESSAGE_DELETED, chat.length);
  chat.push({ ...old, mes: text ?? `新的回复 ${chat.length}-${started(6)}` });
  context.streamingProcessor = { isFinished: false, isStopped: false, messageId: chat.length - 1 };
  let finalEnded = true;
  if (midStream) await midStream();
  if (midStreamEnded) {
    // 酒馆助手's generate() gives the send buttons back mid-stream; the real end then says nothing.
    void eventSource.emit(T.GENERATION_ENDED, chat.length);
    finalEnded = false;
    await wait(midStreamEnded);
  }
  context.streamingProcessor.isFinished = true;
  if (finalEnded) void eventSource.emit(T.GENERATION_ENDED, chat.length);
  if (beforeReceived) await beforeReceived();
  await eventSource.emit(T.MESSAGE_RECEIVED, 6, 'regenerate');
  await eventSource.emit(T.CHARACTER_MESSAGE_RENDERED, 6, 'regenerate');
  if (after) await after();
  context.streamingProcessor = null;
  await wait(30);
  for (const [event, listener] of extra) eventSource.removeListener(event, listener);
}

const handedOnce = [
  ['a plain streaming regenerate', () => regenerate()],
  ['listeners of the received message taking 3.5 s', () => regenerate({ slowReceivedMs: 3500 })],
  ['an older floor redrawn without a type when the old reply is deleted', () => regenerate({ onDeleted: () => eventSource.emit(T.CHARACTER_MESSAGE_RENDERED, 2) })],
  ['a script\'s own generation ending mid-stream, the reply streaming 3.2 s more', () => regenerate({ midStreamEnded: 3200 })],
  ['the same chat announced again mid-generation', () => regenerate({ onDeleted: () => eventSource.emit(T.CHAT_CHANGED, 'gate-chat') })],
  ['the streaming floor redrawn without a type', () => regenerate({ midStream: () => eventSource.emit(T.CHARACTER_MESSAGE_RENDERED, 6) })],
  ['the render announced twice', () => regenerate({ after: () => eventSource.emit(T.CHARACTER_MESSAGE_RENDERED, 6, 'regenerate') })],
  ['a script stopping its own generation mid-stream', () => regenerate({ midStream: () => eventSource.emit(T.GENERATION_STOPPED, 'th-gen-1') })],
];

for (const [label, run] of handedOnce) {
  test(`重新生成 is translated once: ${label}`, async () => {
    clearDiagnostics();
    await run();
    assert.equal(started(6), 1);
  });
}

test('a floor a script adds behind the reply does not cost the reply its translation', async () => {
  clearDiagnostics();
  await regenerate({
    beforeReceived: async () => { chat.push({ name: '樱井', is_user: false, is_system: false, mes: '【状态】', swipe_id: 0, swipes: ['【状态】'], extra: {} }); },
  });
  chat.pop();
  assert.equal(started(6), 1);
});

test('what is no reply is not taken: a failed swipe redrawn, a real chat switch', async () => {
  clearDiagnostics();
  await begin('swipe');
  void eventSource.emit(T.GENERATION_ENDED, chat.length);
  await wait(30);
  await eventSource.emit(T.CHARACTER_MESSAGE_RENDERED, 6);
  await wait(30);
  assert.equal(started(6), 0, 'the floor that stood there before is not a reply');

  clearDiagnostics();
  await regenerate({ onDeleted: async () => { context.chatId = 'other-chat'; await eventSource.emit(T.CHAT_CHANGED, 'other-chat'); context.chatId = 'gate-chat'; } });
  assert.equal(started(6), 0, 'a generation left behind in another chat is not this chat\'s');
  await eventSource.emit(T.CHAT_CHANGED, 'gate-chat');

  // A swipe that ended and never rendered is said to be lost once the generation after the next begins:
  // until then its reply may still come.
  clearDiagnostics();
  await begin('swipe');
  void eventSource.emit(T.GENERATION_ENDED, chat.length);
  await wait(30);
  await regenerate();
  assert.equal(started(6), 1);
  assert.equal(readDiagnostics().some(entry => entry.message.includes('没有渲染出回复')), false, 'not yet');
  await regenerate();
  assert.ok(readDiagnostics().some(entry => entry.scope === 'translation.auto-skip' && entry.message.includes('没有渲染出回复')));
});

test('a reply rendered after the reader has already sent again is still translated', async () => {
  clearDiagnostics();
  const held = [];
  const listener = () => new Promise(resolve => held.push(resolve));
  // Floor 6 is regenerated; a script holds its render while the reader sends a new message.
  eventSource.on(T.MESSAGE_RECEIVED, listener);
  await begin('regenerate');
  const old = chat.pop();
  await eventSource.emit(T.MESSAGE_DELETED, chat.length);
  chat.push({ ...old, mes: '晚到的回复' });
  void eventSource.emit(T.GENERATION_ENDED, chat.length);
  const received = eventSource.emit(T.MESSAGE_RECEIVED, 6, 'regenerate');
  await wait(20);
  eventSource.removeListener(T.MESSAGE_RECEIVED, listener);
  chat.push({ name: 'user', is_user: true, is_system: false, mes: '在吗？', swipe_id: 0, swipes: ['在吗？'], extra: {} });
  await begin('normal');
  held.forEach(resolve => resolve());
  await received;
  await eventSource.emit(T.CHARACTER_MESSAGE_RENDERED, 6, 'regenerate');
  chat.push({ name: '樱井', is_user: false, is_system: false, mes: '在的。', swipe_id: 0, swipes: ['在的。'], extra: {} });
  void eventSource.emit(T.GENERATION_ENDED, chat.length);
  await eventSource.emit(T.CHARACTER_MESSAGE_RENDERED, 8, 'normal');
  await wait(30);
  assert.equal(started(6), 1, 'the late reply');
  assert.equal(started(8), 1, 'and the one after it');
  chat.splice(7, 2);
});

test('a message sent as a slash command opens nothing; a stream that failed is not translated', async () => {
  clearDiagnostics();
  await begin('normal', { command: true });
  await eventSource.emit(T.CHARACTER_MESSAGE_RENDERED, 6, 'normal');
  await wait(30);
  assert.equal(started(6), 0, 'the command wrote nothing for a reply');

  clearDiagnostics();
  await begin('regenerate');
  const old = chat.pop();
  await eventSource.emit(T.MESSAGE_DELETED, chat.length);
  chat.push({ ...old, mes: '...' });
  context.streamingProcessor = { isFinished: false, isStopped: true, messageId: chat.length - 1 };
  void eventSource.emit(T.GENERATION_ENDED, chat.length);
  await eventSource.emit(T.CHARACTER_MESSAGE_RENDERED, 6, 'regenerate');
  context.streamingProcessor = null;
  await wait(30);
  assert.equal(started(6), 0);
  assert.ok(readDiagnostics().some(entry => entry.message.includes('生成出错了')));
  chat[6].mes = '第6楼 こんにちは。';
});

test('a regenerate without streaming, with a floor above deleted while it was written, is still translated', async () => {
  clearDiagnostics();
  await begin('regenerate');
  const old = chat.pop();
  await eventSource.emit(T.MESSAGE_DELETED, chat.length);
  // The reader deletes floor 2 while waiting; the reply lands one place higher.
  const removed = chat.splice(2, 1);
  chat.push({ ...old, mes: '新回复' });
  await eventSource.emit(T.GENERATION_ENDED, chat.length);
  await eventSource.emit(T.MESSAGE_RECEIVED, chat.length - 1, 'regenerate');
  await eventSource.emit(T.CHARACTER_MESSAGE_RENDERED, chat.length - 1, 'regenerate');
  await wait(30);
  assert.equal(started(5), 1);
  chat.splice(2, 0, ...removed);
});

test('a reply whose body tag is missing says so on screen, once for the chat', async () => {
  // A chat of its own: the replies above were told about already.
  context.chatId = 'gate-chat-2';
  await eventSource.emit(T.CHAT_CHANGED, 'gate-chat-2');
  toasts.length = 0;
  await regenerate();
  await wait(50);
  await regenerate();
  await wait(50);
  const told = toasts.filter(([kind, message]) => kind === 'warning' && message.includes('正文标签'));
  assert.equal(told.length, 1);
  assert.match(told[0][1], /正文处理/);
});

test('a reply read while it is written ends with the host\'s own stream, and stops only for the reader\'s stop', async t => {
  const otherFetch = globalThis.fetch;
  globalThis.fetch = () => new Promise(() => {});
  const before = __testing.configureForTest().tts;
  __testing.configureForTest({ settings: { tts: { ...before, enabled: true, readWhileWriting: true, liveAudio: false, fish: { ...before?.fish, key: 'k' } } } });
  t.after(() => {
    globalThis.fetch = otherFetch;
    __testing.configureForTest({ settings: { tts: before } });
  });
  const calls = [];
  const watch = () => {
    const session = __testing.ttsStream();
    for (const name of ['end', 'cancel']) {
      const own = session[name];
      session[name] = (...args) => {
        calls.push(name);
        return own.apply(session, args);
      };
    }
    return session;
  };

  await begin('normal', { command: true });
  await eventSource.emit(T.STREAM_TOKEN_RECEIVED, '你好');
  assert.equal(__testing.ttsStream(), null, 'a slash command writes no reply to read');

  await begin('normal');
  context.streamingProcessor = { isFinished: false, isStopped: false, messageId: chat.length - 1 };
  await eventSource.emit(T.STREAM_TOKEN_RECEIVED, '你好');
  const session = watch();
  assert.equal(session.kind, 'reply');
  // 酒馆助手's generate() ending mid-stream: its stop carries an id and its end comes early.
  await eventSource.emit(T.GENERATION_STOPPED, 'th-gen-1');
  void eventSource.emit(T.GENERATION_ENDED, chat.length);
  await wait(50);
  assert.deepEqual(calls, [], 'the host is still writing the reply');
  context.streamingProcessor.isFinished = true;
  await wait(700);
  assert.deepEqual(calls, ['end'], 'what was written is read to its end once the host stops writing');
  context.streamingProcessor = null;

  calls.length = 0;
  await begin('normal', { command: true });
  assert.deepEqual(calls, [], 'a slash command does not end the reading before it');
  await eventSource.emit(T.GENERATION_AFTER_COMMANDS, 'normal', {}, false);
  assert.deepEqual(calls, ['end'], 'a new reply does');
  await eventSource.emit(T.GENERATION_STOPPED);
  assert.deepEqual(calls, ['end', 'cancel'], 'the reader\'s stop wants quiet');
});

test('a call goes on while its chat is only announced again, and ends with the chat', async t => {
  const otherFetch = globalThis.fetch;
  globalThis.fetch = () => new Promise(() => {});
  const before = __testing.configureForTest().tts;
  __testing.configureForTest({ initialized: true, settings: { tts: { ...before, enabled: true, fish: { ...before?.fish, key: 'k' } } } });
  t.after(() => {
    globalThis.fetch = otherFetch;
    __testing.configureForTest({ initialized: false, settings: { tts: before } });
  });
  const call = __testing.callController();
  assert.equal(await call.dial(), true);
  await eventSource.emit(T.CHAT_CHANGED, context.chatId);
  assert.notEqual(call.phase, 'idle', 'a redraw of the same chat is no reason to hang up');
  context.chatId = 'gate-chat-3';
  await eventSource.emit(T.CHAT_CHANGED, 'gate-chat-3');
  assert.equal(call.phase, 'idle');
});

test('a floor heard while it was written is read by itself again once a regenerate writes it anew', async t => {
  const otherFetch = globalThis.fetch;
  // Fish never answers; a request called off says so.
  globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError'))));
  const { tts: before, autoGeneration } = __testing.configureForTest();
  const tts = { ...before, enabled: true, side: 'source', mode: 'off', autoRead: true, readWhileWriting: true, liveAudio: false, fish: { ...before?.fish, key: 'k' } };
  __testing.configureForTest({ settings: { tts, autoGeneration: false } });
  t.after(() => {
    __testing.stopTts();
    globalThis.fetch = otherFetch;
    __testing.configureForTest({ settings: { tts: before, autoGeneration } });
  });
  const text = '<story_scene>「今晚别走。」她说。</story_scene>';
  const readAloud = () => readDiagnostics().filter(entry => entry.scope === 'tts.auto-read' && entry.message === '第 6 楼自动朗读原文。').length;

  clearDiagnostics();
  await regenerate({
    text,
    midStream: async () => {
      await eventSource.emit(T.STREAM_TOKEN_RECEIVED, text);
      assert.equal(__testing.ttsStream()?.kind, 'reply', 'read as it is written');
    },
  });
  await wait(1400);
  assert.equal(readAloud(), 0, 'heard as it was written');
  __testing.stopTts();

  // Written again at the same place, and this time not read as it was written.
  __testing.configureForTest({ settings: { tts: { ...tts, readWhileWriting: false } } });
  clearDiagnostics();
  await regenerate({ text });
  await wait(1400);
  assert.equal(readAloud(), 1, 'the new reply is read by itself');
});

test.after(() => onDisable());

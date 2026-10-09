import test from 'node:test';
import assert from 'node:assert/strict';

// Translation runs while the chat around them changes: reloaded by a script, a floor put in above the one
// being translated, floors above it deleted, another chat opened, 停止 pressed during 全翻. A translation
// lands on the floor it was made for, never on another, and a stopped run asks for nothing more.
globalThis.document = {
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], visibilityState: 'visible',
  head: null, body: null, documentElement: null, addEventListener() {}, removeEventListener() {},
};
const toasts = [];
globalThis.toastr = Object.fromEntries(['success', 'error', 'warning', 'info'].map(kind => [kind, message => toasts.push([kind, message])]));

const { onActivate, __testing } = await import('../index.js');

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
  MESSAGE_SWIPE_DELETED: 'message_swipe_deleted', MORE_MESSAGES_LOADED: 'more_messages_loaded',
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const eventSource = new Emitter();
const chat = [];
// Every request to the model waits until the test answers it.
const calls = [];
const context = {
  chat, chatId: 'moves-chat', extensionSettings: { 'jingyi-translator': { showFloatingButton: false } }, characters: [{ name: '樱井' }], characterId: 0,
  substituteParams: value => String(value ?? ''), saveChat: async () => {}, updateMessageBlock: () => {}, getRequestHeaders: () => ({}),
  saveSettingsDebounced: () => {}, eventTypes: T, eventSource, streamingProcessor: null,
  generateRaw: ({ prompt }) => new Promise(resolve => calls.push({ prompt: JSON.stringify(prompt), answer: resolve })),
};
globalThis.SillyTavern = { getContext: () => context };
await onActivate();
await eventSource.emit(T.CHAT_CHANGED, 'moves-chat');
__testing.configureForTest({ settings: { apiMode: 'follow', streamingWriteback: false, retries: 1, autoGeneration: false } });

const nextCall = async (seen = calls.length) => {
  for (let tries = 0; tries < 500 && calls.length <= seen; tries += 1) await wait(2);
  assert.ok(calls.length > seen, 'the model was asked');
  return calls[seen];
};
const floor = (index, mes, user = false) => ({
  name: user ? 'user' : '樱井', is_user: user, is_system: false, mes: user ? mes : `<story_scene>${mes}</story_scene>`,
  swipe_id: 0, swipes: [user ? mes : `<story_scene>${mes}</story_scene>`], extra: {}, send_date: `2026-10-02T10:00:0${index}.000Z`,
});
const setChat = floors => { chat.length = 0; chat.push(...floors); };
const reload = (change = list => list) => {
  const fresh = change(structuredClone(chat));
  setChat(fresh);
  return eventSource.emit(T.CHAT_CHANGED, 'moves-chat');
};

test('a reload of the chat while a floor is translating lets the translation finish on that floor', { timeout: 10000 }, async () => {
  setChat([floor(0, 'こんにちは', true), floor(1, '雨が降っている。')]);
  const asked = nextCall();
  const running = __testing.startTranslation(1, { quiet: true, force: false });
  const call = await asked;
  // A script reloads the chat: every floor is a new object, nothing else changed.
  await reload();
  call.answer(JSON.stringify([{ id: 1, text: '下雨了。' }]));
  const result = await running;
  assert.equal(result.skipped, false);
  assert.match(chat[1].mes, /下雨了。/, 'written on the floor as it is after the reload');
  assert.equal(calls.length, 1, 'and asked for once');
  calls.length = 0;
});

test('a floor a reload moved down is translated again where it is now, and the floor put in above it is left alone', { timeout: 10000 }, async () => {
  setChat([floor(0, 'こんにちは', true), floor(1, '雨が降っている。')]);
  const asked = nextCall();
  const running = __testing.startTranslation(1, { quiet: true, force: false });
  const first = await asked;
  const again = nextCall(1);
  await reload(list => [list[0], floor(5, '挿入された。'), list[1]]);
  first.answer(JSON.stringify([{ id: 1, text: '下雨了。' }]));
  assert.equal((await running).reason, 'cancelled');
  const second = await again;
  assert.match(second.prompt, /雨が降っている/);
  second.answer(JSON.stringify([{ id: 1, text: '下雨了。' }]));
  for (let tries = 0; tries < 500 && !/下雨了/.test(chat[2].mes); tries += 1) await wait(2);
  assert.match(chat[2].mes, /下雨了。/);
  assert.equal(chat[1].mes, '<story_scene>挿入された。</story_scene>');
  calls.length = 0;
});

test('floors deleted above a floor being translated: the translation goes to that floor where it moved, not to the one now in its old place', { timeout: 10000 }, async () => {
  setChat([floor(0, 'こんにちは', true), floor(1, '風が強い。'), floor(2, 'それで？', true), floor(3, '雨が降っている。'), floor(4, 'うん', true), floor(5, '雪が降る。')]);
  const asked = nextCall();
  const running = __testing.startTranslation(3, { quiet: true, force: false });
  const call = await asked;
  chat.splice(0, 2);
  await eventSource.emit(T.MESSAGE_DELETED, chat.length);
  call.answer(JSON.stringify([{ id: 1, text: '下雨了。' }]));
  const result = await running;
  assert.equal(result.skipped, false);
  assert.match(chat[1].mes, /下雨了。/);
  assert.equal(chat[3].mes, '<story_scene>雪が降る。</story_scene>', 'the floor now at the old place is not touched');
  assert.equal(calls.length, 1, 'nor asked about');
  calls.length = 0;
});

test('a floor deleted while it was being translated takes nothing of it, and the floor that came into its place is not translated in its stead', { timeout: 10000 }, async () => {
  setChat([floor(0, 'こんにちは', true), floor(1, '雨が降っている。'), floor(2, 'うん', true), floor(3, '雪が降る。')]);
  const asked = nextCall();
  const running = __testing.startTranslation(1, { quiet: true, force: false });
  const call = await asked;
  chat.splice(1, 2);
  await eventSource.emit(T.MESSAGE_DELETED, chat.length);
  call.answer(JSON.stringify([{ id: 1, text: '下雨了。' }]));
  await assert.rejects(running, /正文内容发生变化/);
  assert.equal(chat[1].mes, '<story_scene>雪が降る。</story_scene>');
  assert.equal(calls.length, 1, 'the floor in its place was not sent to the model');
  calls.length = 0;
});

const twoAlternatives = () => {
  const swiped = floor(1, '雨が降っている。');
  swiped.swipes = ['<story_scene>雨が降っている。</story_scene>', '<story_scene>雪が降る。</story_scene>'];
  setChat([floor(0, 'こんにちは', true), swiped]);
  return swiped;
};
const turnTo = (message, swipeId) => {
  message.swipe_id = swipeId;
  message.mes = message.swipes[swipeId];
};

test('turning to another alternative while one is being translated calls that translation off, quietly', { timeout: 10000 }, async () => {
  const swiped = twoAlternatives();
  toasts.length = 0;
  const asked = nextCall();
  const running = __testing.startTranslation(1, { quiet: false, force: false });
  const call = await asked;
  turnTo(swiped, 1);
  await eventSource.emit(T.MESSAGE_SWIPED, 1);
  assert.equal((await running).reason, 'cancelled');
  call.answer(JSON.stringify([{ id: 1, text: '下雨了。' }]));
  await wait(20);
  assert.deepEqual(toasts.filter(([kind]) => kind === 'error'), []);
  assert.equal(swiped.mes, '<story_scene>雪が降る。</story_scene>');
  assert.equal(swiped.swipes[0], '<story_scene>雨が降っている。</story_scene>');
  calls.length = 0;
});

test('a translation that finds another alternative showing when it comes to write is not reported as a failure', { timeout: 10000 }, async () => {
  const swiped = twoAlternatives();
  toasts.length = 0;
  const asked = nextCall();
  const running = __testing.startTranslation(1, { quiet: false, force: false });
  const call = await asked;
  // A script turned the floor without the host announcing it.
  turnTo(swiped, 1);
  call.answer(JSON.stringify([{ id: 1, text: '下雨了。' }]));
  assert.equal((await running).reason, 'cancelled');
  assert.deepEqual(toasts.filter(([kind]) => kind === 'error'), []);
  assert.equal(swiped.mes, '<story_scene>雪が降る。</story_scene>');
  calls.length = 0;
});

const threeFloors = () => setChat([
  floor(0, 'こんにちは', true), floor(1, '一つ目。'), floor(2, 'うん', true), floor(3, '二つ目。'), floor(4, 'それで', true), floor(5, '三つ目。'),
]);

test('全翻 goes floor by floor and counts what it translated', { timeout: 10000 }, async () => {
  threeFloors();
  const run = __testing.translateFloorsInTurn([1, 3, 5]);
  for (let seen = 0; seen < 3; seen += 1) (await nextCall(seen)).answer(JSON.stringify([{ id: 1, text: `第${seen + 1}个。` }]));
  assert.deepEqual(await run, { done: 3, total: 3, stopped: false, otherChat: false });
  assert.match(chat[5].mes, /第3个。/);
  calls.length = 0;
});

test('停止 during 全翻 ends the whole run, not only the floor at hand', { timeout: 10000 }, async () => {
  threeFloors();
  const asked = nextCall();
  const run = __testing.translateFloorsInTurn([1, 3, 5]);
  const call = await asked;
  __testing.stopTranslating();
  call.answer(JSON.stringify([{ id: 1, text: '第1个。' }]));
  const result = await run;
  assert.equal(result.stopped, true);
  await wait(30);
  assert.equal(calls.length, 1, 'the floors after it are not asked for');
  assert.equal(chat[3].mes, '<story_scene>二つ目。</story_scene>');
  calls.length = 0;
});

test('another chat opened during 全翻 ends the run: its floor numbers are not asked for in the new chat', { timeout: 10000 }, async () => {
  threeFloors();
  const asked = nextCall();
  const run = __testing.translateFloorsInTurn([1, 3, 5]);
  const call = await asked;
  context.chatId = 'other-chat';
  await eventSource.emit(T.CHAT_CHANGED, 'other-chat');
  call.answer(JSON.stringify([{ id: 1, text: '第1个。' }]));
  const result = await run;
  assert.equal(result.otherChat, true);
  await wait(30);
  assert.equal(calls.length, 1);
  context.chatId = 'moves-chat';
  await eventSource.emit(T.CHAT_CHANGED, 'moves-chat');
  calls.length = 0;
});

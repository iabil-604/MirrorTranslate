import test from 'node:test';
import assert from 'node:assert/strict';

import { TRANSLATION_START } from '../core.js';
import { __testing } from '../index.js';

globalThis.toastr ??= Object.fromEntries(['success', 'error', 'warning', 'info'].map(kind => [kind, () => {}]));

// ---------------------------------------------------------------------------------------------
// __JINGYI__.floor.original: a floor as the main model wrote it, for an extension that reads the chat
// itself and keeps a fingerprint of a floor (a phone's messages tied to the floor they answer).
// ---------------------------------------------------------------------------------------------

// A headless stand-in for the parts of the host a translation touches.
function mockHost(chat, extra = {}) {
  const context = {
    chat,
    chatId: 'floor-original-fixture',
    extensionSettings: {},
    characters: [{ name: '樱井', avatar: 'sakurai.png' }],
    characterId: 0,
    substituteParams: value => String(value ?? ''),
    saveChat: async () => {},
    updateMessageBlock: () => {},
    getRequestHeaders: () => ({}),
    saveSettingsDebounced: () => {},
    eventTypes: {},
    eventSource: { emit: () => {}, on: () => {}, removeListener: () => {} },
    ...extra,
  };
  globalThis.SillyTavern = { getContext: () => context };
  __testing.initializeSettings();
  __testing.installPublicApi();
  return context;
}

const ORIGINAL = '<story_scene>\n雨が降っている。\n\n「傘、持ってる？」と彼女は聞いた。\n</story_scene>';
const REPLY = JSON.stringify({ translations: [{ id: 1, text: '下着雨。' }, { id: 2, text: '「带伞了吗？」她问。' }] });

test('a floor reads the same before and after it is translated, by its number or as the message', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const context = mockHost([], { generateRaw: () => Promise.resolve(REPLY) });
  __testing.configureForTest({ settings: { apiMode: 'follow', streamingWriteback: false, translationOnly: false, retries: 0 }, initialized: true });
  context.chat.push({ name: '樱井', is_user: false, mes: ORIGINAL, swipe_id: 0, swipes: [ORIGINAL], extra: {} });
  const { floor, features } = globalThis.__JINGYI__;
  assert.ok(features.includes('floor.original'));
  assert.equal(floor.original(0), ORIGINAL, 'nothing translated yet');

  await __testing.startTranslation(0, { quiet: true });
  assert.ok(context.chat[0].mes.includes(TRANSLATION_START), 'the translation is written into the floor');
  assert.equal(floor.original(0), ORIGINAL);
  assert.equal(floor.original('0'), ORIGINAL);
  assert.equal(floor.original(context.chat[0]), ORIGINAL);
});

test('a floor with only its translation left in it gives back its original', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const context = mockHost([], { generateRaw: () => Promise.resolve(REPLY) });
  __testing.configureForTest({ settings: { apiMode: 'follow', streamingWriteback: false, translationOnly: true, retries: 0 }, initialized: true });
  // The host keeps a record per swipe; the bilingual text lives there.
  context.chat.push({ name: '樱井', is_user: false, mes: ORIGINAL, swipe_id: 0, swipes: [ORIGINAL], swipe_info: [{ extra: {} }], extra: {} });

  await __testing.startTranslation(0, { quiet: true });
  assert.match(context.chat[0].mes, /带伞了吗/, 'the floor holds the translation');
  assert.doesNotMatch(context.chat[0].mes, /傘/, 'and only the translation');
  assert.equal(globalThis.__JINGYI__.floor.original(0), ORIGINAL);
});

test('no floor, no text', t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  mockHost([{ name: 'user', is_user: true, mes: '在吗？', swipe_id: 0, extra: {} }]);
  const { floor } = globalThis.__JINGYI__;
  assert.equal(floor.original(0), '在吗？', 'a floor 镜译 never wrote to reads as it is');
  assert.equal(floor.original(5), '');
  assert.equal(floor.original(-1), '');
  assert.equal(floor.original(null), '');
  assert.equal(floor.original({}), '');
  assert.equal(floor.original('第一楼'), '');
});

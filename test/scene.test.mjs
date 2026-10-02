import test from 'node:test';
import assert from 'node:assert/strict';

import { MESSAGE_META_KEY, recoverStructuredTranslations } from '../core.js';
import { SCENE_PICTURE, SCENE_TONES, composeSceneSection, mergeScenes, normalizeScene, recoverScene } from '../scene.js';
import { buildTranslationMessages } from '../workflow.js';
import { __testing } from '../index.js';

globalThis.toastr ??= Object.fromEntries(['success', 'error', 'warning', 'info'].map(kind => [kind, () => {}]));

// ---------------------------------------------------------------------------------------------
// The scene a translation writes down about each floor, kept for what is to be built on it.
// ---------------------------------------------------------------------------------------------

const SCENE = { tone: '战斗', place: '演习场', time: '午后', cast: '鸣人、孟空', summary: '鸣人和孟空对练，孟空挡下了全部攻击。' };
const PICTURE = 'two young ninjas sparring on a red dirt training ground, afternoon light';

test('a scene is kept as five strings, the mood one of the listed tones; the picture only when it is switched on', () => {
  assert.equal(SCENE_PICTURE, false);
  assert.deepEqual(normalizeScene(SCENE), SCENE);
  // A picture a model wrote anyway is not kept while pictures are off.
  assert.deepEqual(normalizeScene({ ...SCENE, visual: PICTURE }), SCENE);
  assert.deepEqual(normalizeScene({ ...SCENE, visual: PICTURE }, { picture: true }), { ...SCENE, visual: PICTURE });
  // A list written anyway is joined; runs of whitespace collapse; a mood named among other words is found.
  const loose = normalizeScene({ tone: '大概是 紧张 吧', cast: ['鸣人', '孟空'], summary: '  两人\n对峙。 ', extra: 'ignored' });
  assert.deepEqual(loose, { tone: '紧张', place: '', time: '', cast: '鸣人、孟空', summary: '两人 对峙。' });
  assert.equal(normalizeScene({ tone: '激昂' }), null, 'a mood off the list and nothing else is no scene');
  assert.equal(normalizeScene({ visual: PICTURE }), null, 'nor is a picture alone while pictures are off');
  assert.equal(normalizeScene(null), null);
  assert.equal(normalizeScene(['日常']), null);
  assert.equal(normalizeScene({ summary: '长'.repeat(900) }).summary.length, 320, 'a field that runs on is cut');
  assert.equal(normalizeScene({ visual: 'x'.repeat(900) }, { picture: true }).visual.length, 400);
  assert.ok(SCENE_TONES.includes('日常') && SCENE_TONES.includes('亲密'));
});

test('the scene is read off the reply wherever the model put it, and never taken for a translation', () => {
  const reply = `好的。\n\`\`\`json\n${JSON.stringify({ translations: [{ id: 1, text: '下雨了。' }, { id: 2, text: '风很大。' }], scene: { ...SCENE, cast: ['鸣人', '孟空'], visual: PICTURE } })}\n\`\`\``;
  assert.deepEqual(recoverScene(reply), SCENE);
  assert.deepEqual(recoverScene(reply, { picture: true }), { ...SCENE, visual: PICTURE });
  assert.equal(recoverScene(JSON.stringify([{ id: 1, text: '下雨了。' }])), null);
  // The cast written as a list, and the reply's items without ids: one translation and two names make three
  // items for three lines, and the names must not be read as the two missing translations by position.
  const idless = JSON.stringify({ translations: ['下雨了。'], scene: { tone: '日常', cast: ['鸣人', '孟空'] } });
  const recovered = recoverStructuredTranslations(idless, [{ id: 1, text: '雨。' }, { id: 2, text: '風。' }, { id: 3, text: '雲。' }]);
  assert.equal([...recovered.translations.values()].includes('鸣人'), false);
  assert.equal([...recovered.translations.values()].includes('孟空'), false);
  const full = recoverStructuredTranslations(reply, [{ id: 1, text: '雨。' }, { id: 2, text: '風。' }]);
  assert.deepEqual([...full.translations], [[1, '下雨了。'], [2, '风很大。']]);
});

test('a floor translated in parts gets one scene: the mood, place, time and picture where it ends, everyone named, every sentence in turn', () => {
  const parts = [
    { order: 7, scene: { tone: '战斗', place: '', time: '黄昏', cast: '孟空、鸣人', summary: '孟空反击。', visual: 'a counterattack at dusk' } },
    { order: 1, scene: { tone: '日常', place: '演习场', time: '午后', cast: '鸣人', summary: '鸣人来找孟空练习', visual: 'a quiet training ground' } },
  ];
  const merged = { tone: '战斗', place: '演习场', time: '黄昏', cast: '鸣人、孟空', summary: '鸣人来找孟空练习；孟空反击。' };
  assert.deepEqual(mergeScenes(parts), merged);
  assert.deepEqual(mergeScenes(parts, { picture: true }), { ...merged, visual: 'a counterattack at dusk' });
  assert.equal(mergeScenes([]), null);
  assert.deepEqual(mergeScenes([{ order: 3, scene: SCENE }]), SCENE);
  assert.deepEqual(mergeScenes([{ order: 3, scene: { ...SCENE, visual: PICTURE } }]), SCENE);
});

test('the scene is asked of the pass that first reads a part of the floor, not of a repair or a style repair', () => {
  const settings = __testing.configureForTest({});
  const segments = [{ id: 1, text: '雨が降っている。' }];
  const section = composeSceneSection();
  const has = messages => messages.some(message => message.content === section);
  assert.equal(has(buildTranslationMessages(segments, settings, {}, 'primary', { scene: true })), true);
  assert.equal(has(buildTranslationMessages(segments, settings, {}, 'repair', { scene: true })), false);
  assert.equal(has(buildTranslationMessages(segments, settings, {}, 'style_repair', { scene: true })), false);
  assert.equal(has(buildTranslationMessages(segments, settings, {}, 'primary', {})), false, 'only when asked');
  for (const tone of SCENE_TONES) assert.ok(section.includes(tone));
  // No picture is asked for while pictures are off.
  assert.doesNotMatch(section, /visual|配图|文生图/);
  assert.match(composeSceneSection({ picture: true }), /visual：用英文/);
  assert.match(composeSceneSection({ picture: true }), /"visual":""/);
});

// A headless stand-in for the parts of the host a translation touches.
function mockHost(chat, extra = {}) {
  const context = {
    chat,
    chatId: 'scene-fixture',
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

function sseResponse(frames) {
  const body = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return { ok: true, status: 200, body, text: async () => '' };
}

test('a translated floor keeps its scene, other extensions can read it and hear of it, and later writes keep it', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  // The model wrote a picture anyway: it is neither kept nor handed out.
  let reply = JSON.stringify({ translations: [{ id: 1, text: '下雨了。' }, { id: 2, text: '风很大。' }], scene: { ...SCENE, visual: PICTURE } });
  const asked = [];
  const context = mockHost([], {
    generateRaw: ({ prompt }) => {
      asked.push(prompt);
      return Promise.resolve(reply);
    },
  });
  __testing.configureForTest({ settings: { apiMode: 'follow', streamingWriteback: false, retries: 0 }, initialized: true });
  const mes = '<story_scene>\n雨が降っている。\n\n風が強い。\n</story_scene>';
  context.chat.push({ mes, swipe_id: 0, swipes: [mes], extra: {} });
  const heard = [];
  const stop = globalThis.__JINGYI__.scene.onChange(scene => heard.push(scene));
  t.after(stop);

  await __testing.startTranslation(0, { quiet: true });
  assert.ok(asked[0].some(message => message.content === composeSceneSection()), 'the first pass asks for the scene');
  assert.deepEqual(context.chat[0].extra[MESSAGE_META_KEY].scene, SCENE);
  assert.deepEqual(heard, [{ messageId: 0, ...SCENE }]);
  assert.deepEqual(await globalThis.__JINGYI__.scene.get(0), { messageId: 0, ...SCENE });
  assert.deepEqual(await globalThis.__JINGYI__.scene.list(), [{ messageId: 0, ...SCENE }]);
  assert.equal(await globalThis.__JINGYI__.scene.get(5), null);
  assert.equal(globalThis.__JINGYI__.scene.apiVersion, 1);

  // A paragraph rewritten by hand keeps the floor's scene.
  await __testing.editTranslationSegment(0, 2, '风真大。');
  assert.deepEqual(context.chat[0].extra[MESSAGE_META_KEY].scene, SCENE);
  // So does a translation asked again whose reply left the scene out.
  reply = JSON.stringify({ translations: [{ id: 1, text: '在下雨。' }, { id: 2, text: '风好大。' }] });
  await __testing.startTranslation(0, { quiet: true, force: true });
  assert.match(context.chat[0].mes, /在下雨。/);
  assert.deepEqual(context.chat[0].extra[MESSAGE_META_KEY].scene, SCENE);
  assert.equal(heard.length, 1, 'nothing new was written, nobody is told');

  // A floor whose text changed has no scene to speak of until it is translated again.
  context.chat[0].mes = context.chat[0].mes.replace('雨が降っている。', '晴れている。');
  assert.equal(await globalThis.__JINGYI__.scene.get(0), null);
});

test('the streamed translation keeps the scene of its reply too', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const message = { mes: '<story_scene>\n雨が降っている。\n</story_scene>', swipe_id: 0 };
  mockHost([message]);
  __testing.configureForTest({
    settings: {
      apiMode: 'independent', streamingWriteback: true, includeWorldbook: false, includeCharacterCard: false, includeRecentContext: false, retries: 0,
      channels: [{ id: 'default', name: 'x', url: 'https://example.com/v1', key: '', model: 'translator', models: [], timeoutSec: 30, maxTokens: 4096, temperature: 0.15, tokenSaving: false, reasoningEffort: '', excludeParams: [] }],
      selectedChannelId: 'default',
    },
    initialized: true,
  });
  const payload = JSON.stringify({ translations: [{ id: 1, text: '下雨了。' }], scene: { tone: '日常', place: '窗边', summary: '外面下着雨。' } });
  globalThis.fetch = async () => sseResponse([
    `data: ${JSON.stringify({ choices: [{ delta: { content: payload.slice(0, 30) } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: payload.slice(30) } }] })}\n\n`,
    'data: [DONE]\n\n',
  ]);
  const result = await __testing.startTranslation(0, { quiet: true, force: true });
  assert.equal(result.skipped, false);
  assert.match(message.mes, /下雨了。/);
  assert.deepEqual(message.extra[MESSAGE_META_KEY].scene, { tone: '日常', place: '窗边', time: '', cast: '', summary: '外面下着雨。' });
});

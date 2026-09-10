import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MESSAGE_META_KEY,
  assembleBilingual,
  createTranslationSignature,
  hashText,
  interceptGenerationChat,
  mergeSettings,
  segmentSource,
  stripGeneratedTranslationLines,
} from '../core.js';
import { compileNativeRegex, makeBuiltinReadingProfile, syncNativeRegex } from '../processing.js';
import { __testing } from '../index.js';

// A headless stand-in for the parts of the host these paths actually touch.
function mockHost(chat = [], extra = {}) {
  const context = {
    chat,
    chatId: 'integration-fixture',
    extensionSettings: {},
    characters: [{ name: '樱井', avatar: 'sakurai.png' }],
    characterId: 0,
    substituteParams: value => String(value ?? '').replaceAll('{{char}}', '樱井').replaceAll('{{user}}', '玩家'),
    saveChat: async () => {},
    updateMessageBlock: () => {},
    getRequestHeaders: () => ({}),
    saveSettingsDebounced: () => {},
    eventTypes: { WORLDINFO_FORCE_ACTIVATE: 'worldinfo_force_activate' },
    eventSource: { emit: () => {}, on: () => {}, removeListener: () => {} },
    ...extra,
  };
  globalThis.SillyTavern = { getContext: () => context };
  __testing.initializeSettings();
  return context;
}

async function translatedFloor(source, translations, settings) {
  const segmented = segmentSource(source, settings);
  const mes = `<story_scene>\n${assembleBilingual(segmented.layout, new Map(translations), settings)}\n</story_scene>`;
  const inner = `\n${assembleBilingual(segmented.layout, new Map(translations), settings)}\n`;
  return {
    mes,
    swipe_id: 0,
    extra: {
      [MESSAGE_META_KEY]: {
        schema_version: 4,
        swipe_id: 0,
        complete: true,
        source_hash: await hashText(createTranslationSignature([{
          tagName: 'story_scene',
          segments: segmentSource(inner, settings).segments,
        }])),
        segment_prefix: settings.segmentPrefix ?? '',
        segment_suffix: settings.segmentSuffix ?? '',
        translation_prefix: settings.translationPrefix ?? '{',
        translation_suffix: settings.translationSuffix ?? '}',
        paragraph_per_line: settings.paragraphPerLine ?? false,
      },
    },
  };
}

test('follow mode falls back to the whole-request path instead of throwing on an undefined variable', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const context = mockHost();
  const settings = __testing.configureForTest({ settings: { apiMode: 'follow', streamingWriteback: true } });
  context.chat.push(await translatedFloor('雨が降っている。', [[1, '下雨了。']], settings));
  // Reaching the "already translated" answer proves the fallback ran the whole-request path with the
  // forwarded options; before this it threw ReferenceError: options is not defined.
  const result = await __testing.translateMessageStreaming(0, { quiet: true, force: false });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'already-translated');
});

test('streaming and whole-request paths agree on the already-translated gate', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const context = mockHost();
  const settings = __testing.configureForTest({ settings: { apiMode: 'independent', streamingWriteback: true } });
  context.chat.push(await translatedFloor('雨が降っている。', [[1, '下雨了。']], settings));
  const missing = await __testing.startTranslation(0, { quiet: true, force: false });
  assert.equal(missing.reason, 'already-translated');
  // A forced run must not take the same shortcut; without a channel it fails at the request, which
  // is proof enough that it did NOT stop at the gate.
  await assert.rejects(__testing.startTranslation(0, { quiet: true, force: true }));
});

test('worldbook key matching honours regex, whole words and case, and skips secondary logic', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const context = mockHost();
  const matches = __testing.worldInfoKeyMatches;
  assert.equal(matches('king', 'he was thinking', {}), true);
  assert.equal(matches('king', 'he was thinking', { matchWholeWords: true }), false);
  assert.equal(matches('king', 'the king arrived', { matchWholeWords: true }), true);
  assert.equal(matches('/英梨梨|泽村/', '英梨梨抬起头。', {}), true);
  assert.equal(matches('/英梨梨|泽村/', '别的名字。', {}), false);
  assert.equal(matches('/(unclosed/', '任何文本', {}), false);
  assert.equal(matches('Sakura', 'sakura blooms', {}), true);
  assert.equal(matches('Sakura', 'sakura blooms', { caseSensitive: true }), false);
  assert.equal(matches('樱井', '樱井回头了。', { matchWholeWords: true }), true);

  const emitted = [];
  context.eventSource.emit = (_type, hits) => emitted.push(hits);
  __testing.configureForTest({
    worldInfoEntries: {
      globalLore: [{ world: 'g', uid: 1, key: ['樱井'] }],
      characterLore: [{ world: 'c', uid: 2, key: ['/雨/'] }],
      chatLore: [{ world: 'chat', uid: 3, key: ['伞'] }],
      personaLore: [{ world: 'persona', uid: 4, key: ['玩家'], selective: true, keysecondary: ['夜晚'] }],
    },
  });
  assert.deepEqual(__testing.readableWorldInfoEntries().map(entry => entry.uid), [1, 2, 3, 4]);
  __testing.forceActivateWorldInfoFromText('樱井撑着伞走进雨里，玩家跟在后面。');
  // The persona entry matches its primary key but its secondary condition belongs to the host.
  assert.deepEqual(emitted, [[{ world: 'g', uid: 1 }, { world: 'c', uid: 2 }, { world: 'chat', uid: 3 }]]);
});

test('the token-saving whitelist reads every lore source and expands host macros', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  mockHost();
  __testing.configureForTest({
    settings: { worldInfoWhitelist: { 'sakurai.png': [{ world: 'chat', uid: 3 }, { world: 'persona', uid: 4 }] } },
    worldInfoEntries: {
      globalLore: [{ world: 'g', uid: 1, content: '不该出现。' }],
      chatLore: [{ world: 'chat', uid: 3, content: '{{char}} 称呼 {{user}} 为前辈。' }],
      personaLore: [{ world: 'persona', uid: 4, content: '玩家是摄影社成员。' }],
    },
  });
  const content = __testing.whitelistedWorldbookContent();
  assert.equal(content, '樱井 称呼 玩家 为前辈。\n\n玩家是摄影社成员。');
  assert.doesNotMatch(content, /\{\{char\}\}|\{\{user\}\}|不该出现/);
});

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

function jsonResponse(value) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));
      controller.close();
    },
  });
  return { ok: true, status: 200, body, text: async () => JSON.stringify(value) };
}

const streamingSettings = {
  apiMode: 'independent',
  streamingWriteback: true,
  includeWorldbook: false,
  includeCharacterCard: false,
  includeRecentContext: false,
  retries: 0,
  channels: [{ id: 'default', name: 'x', url: 'https://example.com/v1', key: '', model: 'translator', models: [], timeoutSec: 30, maxTokens: 4096, temperature: 0.15, tokenSaving: false, reasoningEffort: '', excludeParams: [] }],
  selectedChannelId: 'default',
};

test('an SSE stream writes the floor back through the ordinary pipeline', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const message = { mes: '<story_scene>\n雨が降っている。\n</story_scene>', swipe_id: 0 };
  mockHost([message]);
  __testing.configureForTest({ settings: streamingSettings, initialized: true });
  const payload = JSON.stringify([{ id: 1, text: '下雨了。' }]);
  globalThis.fetch = async () => sseResponse([
    `data: ${JSON.stringify({ choices: [{ delta: { content: payload.slice(0, 12) } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: payload.slice(12) } }] })}\n\n`,
    'data: [DONE]\n\n',
  ]);
  const result = await __testing.startTranslation(0, { quiet: true, force: true });
  assert.equal(result.skipped, false);
  assert.equal(result.segments, 1);
  assert.match(message.mes, /下雨了。/);
  assert.equal(message.extra[MESSAGE_META_KEY].complete, true);
});

test('a relay that ignores the stream flag still lands the batch instead of writing nothing', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const message = { mes: '<story_scene>\n雨が降っている。\n</story_scene>', swipe_id: 0 };
  mockHost([message]);
  __testing.configureForTest({ settings: streamingSettings, initialized: true });
  // One ordinary chat-completion body, no SSE framing anywhere.
  globalThis.fetch = async () => jsonResponse({
    choices: [{ message: { content: JSON.stringify([{ id: 1, text: '下雨了。' }]) } }],
    usage: { prompt_tokens: 42 },
  });
  const result = await __testing.startTranslation(0, { quiet: true, force: true });
  assert.equal(result.skipped, false);
  assert.match(message.mes, /下雨了。/);
});

const coloringSettings = {
  ...streamingSettings,
  streamingWriteback: false,
  coloring: {
    speakers: true,
    emotions: true,
    minContrast: 4.5,
    vividness: 0.65,
    // What 取色 would have measured on a dark theme.
    band: {
      direction: 'light',
      luminance: 0.42,
      chromaMax: 0.13,
      minContrast: 4.5,
      lightness: 0.72,
      backgrounds: [{ r: 0.106, g: 0.106, b: 0.133, a: 1 }],
    },
    bandProbedAt: '2026-09-11 10:00:00',
  },
  speakerPalette: {
    'sakurai.png': [
      { name: '英梨梨', aliases: ['泽村'], source: '#f2d16b', from: 'hair' },
      { name: '诗羽', aliases: [], source: '#1f1f24', from: 'hair' },
    ],
  },
};

function completionResponse(items) {
  return {
    ok: true,
    status: 200,
    text: async () => '',
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations: items }) } }] })));
        controller.close();
      },
    }),
  };
}

test('a coloured run paints the floor, keeps the prompt clean and stores the labels', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const message = { mes: '<story_scene>\n「何を考えてるの！」\n\n……わからない。\n</story_scene>', swipe_id: 0 };
  const context = mockHost([message]);
  __testing.configureForTest({ settings: { ...coloringSettings, streamingWriteback: true }, initialized: true });

  let sentMessages = null;
  globalThis.fetch = async (_url, init) => {
    sentMessages = JSON.parse(init.body).messages;
    return completionResponse([
      { id: 1, text: '「你到底在想什么！」', speaker: '英梨梨', emotion: 'angry', intensity: 2 },
      { id: 2, text: '……我不知道。', speaker: '诗羽', emotion: 'whisper', intensity: 1 },
    ]);
  };
  const result = await __testing.startTranslation(0, { quiet: true, force: true });
  assert.equal(result.skipped, false);

  // The roster reached the model as a closed list, which is what keeps the labelling reliable.
  const annotation = sentMessages.find(entry => entry.content.includes('附加标注'));
  assert.ok(annotation);
  assert.match(annotation.content, /英梨梨、泽村、诗羽/);

  // Two speakers, two different colours, and the black-haired one still got one of her own.
  const colors = [...message.mes.matchAll(/color:(#[0-9a-f]{6})/g)].map(match => match[1]);
  assert.equal(colors.length, 2);
  assert.notEqual(colors[0], colors[1]);
  assert.match(message.mes, /class="jy-spk jy-spk-[a-z0-9]+ jy-emo-angry jy-emo-l2"/);
  assert.match(message.mes, /class="jy-spk jy-spk-[a-z0-9]+ jy-emo-whisper jy-emo-l1"/);
  assert.match(message.mes, /title="英梨梨 · 愤怒"/);

  // The main model sees the Japanese original and no markup at all.
  const prompt = [{ mes: message.mes, extra: message.extra }];
  interceptGenerationChat(prompt);
  assert.equal(prompt[0].mes, '<story_scene>\n「何を考えてるの！」\n\n……わからない。\n</story_scene>');

  // Labels are stored so a reload, a restyle or a 补译 keeps the colours.
  const stored = message.extra[MESSAGE_META_KEY].annotations;
  assert.deepEqual(stored['1'], { speaker: '英梨梨', emotion: 'angry', intensity: 2 });
  assert.deepEqual(stored['2'], { speaker: '诗羽', emotion: 'whisper', intensity: 1 });
  const snapshot = await __testing.readMessageSnapshot(0);
  assert.equal(snapshot.translated, true);
  assert.deepEqual(snapshot.existingAnnotations.get(1), { speaker: '英梨梨', emotion: 'angry', intensity: 2 });
  assert.equal(context.chat[0], message);
});

test('colouring off writes exactly the floor the extension has always written', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const items = [{ id: 1, text: '下雨了。', speaker: '英梨梨', emotion: 'angry', intensity: 2 }];
  globalThis.fetch = async () => completionResponse(items);
  const write = async coloring => {
    const message = { mes: '<story_scene>\n雨が降っている。\n</story_scene>', swipe_id: 0 };
    mockHost([message]);
    __testing.configureForTest({ settings: { ...coloringSettings, streamingWriteback: true, coloring }, initialized: true });
    await __testing.startTranslation(0, { quiet: true, force: true });
    return message.mes;
  };
  const painted = await write(coloringSettings.coloring);
  const plain = await write({ ...coloringSettings.coloring, speakers: false, emotions: false });
  assert.match(painted, /jy-spk/);
  assert.doesNotMatch(plain, /jy-spk|<span|color:/);
  assert.equal(stripGeneratedTranslationLines(plain), '<story_scene>\n雨が降っている。\n</story_scene>');
});

test('a floor whose band was never measured is written plain rather than guessed at', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const message = { mes: '<story_scene>\n雨が降っている。\n</story_scene>', swipe_id: 0 };
  mockHost([message]);
  __testing.configureForTest({
    settings: { ...coloringSettings, streamingWriteback: true, coloring: { ...coloringSettings.coloring, band: null } },
    initialized: true,
  });
  globalThis.fetch = async () => completionResponse([{ id: 1, text: '下雨了。', speaker: '英梨梨', emotion: 'angry' }]);
  await __testing.startTranslation(0, { quiet: true, force: true });
  assert.doesNotMatch(message.mes, /jy-spk|color:/);
  assert.match(message.mes, /下雨了。/);
});

// The colour is written into the floor, but what the reader sees is the floor after the host has run
// the built-in beautify regexes over it. Those are generated code too, and the wrapper sits between
// the visible affixes the reading pattern anchors on — so the two have to be checked together.
test('the built-in reading style renders the speaker wrapper instead of eating it', () => {
  const base = mergeSettings({ paragraphPerLine: true });
  const profile = makeBuiltinReadingProfile(base, 'cute');
  const settings = mergeSettings({ ...base, ...profile.settings });
  const display = syncNativeRegex([], profile).filter(rule => !rule.promptOnly && rule.placement.includes(2));

  const doc = segmentSource('坂本竜司であった。\n\n「――っはぁぁぁ！」', settings);
  const translations = new Map(doc.segments.map((segment, index) => [segment.id, index ? '「——哈啊啊！」' : '声音来自坂本龙司。']));
  const styleFor = ids => (ids.includes(2)
    ? { open: '<span class="jy-spk jy-emo-shout" style="color:#cac256;font-weight:800">', close: '</span>' }
    : null);

  const floor = assembleBilingual(doc.layout, translations, { ...settings, styleFor });
  const rendered = display.reduce((text, rule) => text.replace(compileNativeRegex(rule.findRegex), rule.replaceString), floor);

  // The boundary-cleanup rule must run first, or the reading pattern never matches at all.
  assert.equal(display[0].scriptName, '镜译 · 显示边界清理');
  assert.match(rendered, /<div class="jy-reading jy-reading-cute">/);
  assert.match(rendered, /<span class="jy-spk jy-emo-shout" style="color:#cac256;font-weight:800">「——哈啊啊！」<\/span>/);
  // The unlabelled segment keeps the plain shape, so an absent label costs nothing but its colour.
  assert.match(rendered, /<div class="jy-reading-translation">\n\n声音来自坂本龙司。\n\n<\/div>/);
  // And the floor still strips back to the original for the main model.
  assert.equal(stripGeneratedTranslationLines(floor), doc.source);
});

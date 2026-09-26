import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MESSAGE_META_KEY,
  SEGMENTATION_RULES_VERSION,
  assembleBilingual,
  extractGeneratedTranslations,
  createTranslationSignature,
  hashText,
  interceptGenerationChat,
  mergeSettings,
  restyleBilingual,
  segmentSource,
  stripGeneratedTranslationLines,
} from '../core.js';
import { emphasisContour } from '../palette.js';
import { compileNativeRegex, makeBuiltinReadingProfile, syncNativeRegex } from '../processing.js';
import {
  clearDiagnostics,
  formatDiagnosticReport,
  formatFullDiagnosticReport,
  readDiagnostics,
} from '../diagnostics.js';
import { __testing, interceptGeneration } from '../index.js';

// What would be a toast in the host is dropped here rather than printed: the test runner reads this
// process's output, and stray lines in it have broken the report when every file runs at once.
globalThis.toastr ??= Object.fromEntries(['success', 'error', 'warning', 'info'].map(kind => [kind, () => {}]));

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

test('a re-roll on the same floor is translated, not swallowed by the old text\'s run that never answered', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const asked = [];
  const context = mockHost([], {
    // The first request never answers, the way a stuck relay behaves; the next one does.
    generateRaw: ({ prompt }) => {
      asked.push(JSON.stringify(prompt));
      return asked.length === 1 ? new Promise(() => {}) : Promise.resolve(JSON.stringify([{ id: 1, text: '晴天了。' }]));
    },
  });
  __testing.configureForTest({ settings: { apiMode: 'follow', streamingWriteback: false, retries: 0 }, initialized: true });
  context.chat.push({ mes: '<story_scene>\n雨が降っている。\n</story_scene>', swipe_id: 0, swipes: [''], extra: {} });
  const first = __testing.startTranslation(0, { quiet: true });
  await new Promise(resolve => setTimeout(resolve, 50));
  // Regenerated: another reply in the same place, the same swipe.
  context.chat[0] = { mes: '<story_scene>\n晴れている。\n</story_scene>', swipe_id: 0, swipes: [''], extra: {} };
  const second = await __testing.startTranslation(0, { quiet: true });
  assert.equal(asked.length, 2, 'the new text was asked for, not folded into the stuck request');
  assert.match(asked[1], /晴れている/);
  assert.equal(second.skipped, false);
  assert.match(context.chat[0].mes, /晴天了/);
  const old = await first;
  assert.equal(old.reason, 'cancelled', 'the stuck run was called off and says so');
});

test('补译 asks only for the paragraphs that have no translation yet', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const asked = [];
  const context = mockHost([], {
    generateRaw: ({ prompt }) => {
      asked.push(JSON.stringify(prompt));
      return Promise.resolve(JSON.stringify([{ id: 2, text: '风很大。' }]));
    },
  });
  const settings = __testing.configureForTest({ settings: { apiMode: 'follow', streamingWriteback: false, retries: 0 }, initialized: true });
  const source = '雨が降っている。\n\n風が強い。';
  const segmented = segmentSource(source, settings);
  const partial = assembleBilingual(segmented.layout, new Map([[1, '下雨了。']]), { ...settings, allowMissing: true });
  const inner = `\n${partial}\n`;
  context.chat.push({
    mes: `<story_scene>${inner}</story_scene>`,
    swipe_id: 0,
    extra: {
      [MESSAGE_META_KEY]: {
        schema_version: 4, swipe_id: 0, complete: false, missing_ids: [2],
        source_hash: await hashText(createTranslationSignature([{ tagName: 'story_scene', segments: segmentSource(inner, settings).segments }])),
        segment_prefix: settings.segmentPrefix ?? '', segment_suffix: settings.segmentSuffix ?? '',
        translation_prefix: settings.translationPrefix ?? '{', translation_suffix: settings.translationSuffix ?? '}',
        paragraph_per_line: false,
      },
    },
  });
  await __testing.startTranslation(0, { quiet: true, force: false });
  assert.equal(asked.length, 1);
  assert.match(asked[0], /風が強い/);
  assert.doesNotMatch(asked[0], /雨が降っている/, 'the paragraph already translated is not sent again');
  assert.match(context.chat[0].mes, /下雨了。/, 'and its translation is kept');
  assert.match(context.chat[0].mes, /风很大。/);
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

test('a floor already translated under v0.36.0 or older — a <br>-joined card line and a play-time line included — reads back exactly as it did, never re-translated', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const context = mockHost();
  const settings = __testing.configureForTest({ settings: { apiMode: 'independent', streamingWriteback: true } });
  // Neither shape had a built-in rule before v0.36.1: the card's three lines, joined only by <br> with
  // no real newline between them, were sent as one glued paragraph, and the play-time line — digits, so
  // the old "no letters, no digits" preserve check missed it — was sent to be translated as if it were
  // prose.
  const source = 'NOW PLAYING<br>今日の空<br>作词：陽炎\n\n00:42 / 03:15\n\n彼は笑った。';
  const legacy = { ...settings, segmentationVersion: 1 };
  const segmented = segmentSource(source, legacy);
  assert.equal(segmented.segments.length, 3, 'the fixture reflects what v0.36.0 actually did: three paragraphs, all of them sent off');
  const translations = new Map([
    [segmented.segments[0].id, 'NOW PLAYING今日的天空作词：陽炎'],
    [segmented.segments[1].id, '00:42 / 03:15'],
    [segmented.segments[2].id, '他笑了。'],
  ]);
  const bilingual = assembleBilingual(segmented.layout, translations, legacy);
  const inner = `\n${bilingual}\n`;
  context.chat.push({
    mes: `<story_scene>${inner}</story_scene>`,
    swipe_id: 0,
    extra: {
      [MESSAGE_META_KEY]: {
        // No segmentation_version field at all — exactly what a floor translated through v0.36.0 has.
        schema_version: 4, swipe_id: 0, complete: true,
        source_hash: await hashText(createTranslationSignature([{ tagName: 'story_scene', segments: segmentSource(inner, legacy).segments }])),
        segment_prefix: settings.segmentPrefix ?? '', segment_suffix: settings.segmentSuffix ?? '',
        translation_prefix: settings.translationPrefix ?? '{', translation_suffix: settings.translationSuffix ?? '}',
        paragraph_per_line: false,
      },
    },
  });
  const snapshot = await __testing.readMessageSnapshot(0, settings);
  assert.equal(snapshot.segments.length, 3, 'the fresh pass agrees with what is stored: the new <br> and play-time rules did not re-split or re-classify an old floor');
  assert.equal(snapshot.existingTranslations.size, 3, 'every paragraph\'s translation is found, none orphaned by a segment the new rules stopped creating');
  assert.equal(snapshot.translated, true, 'a floor already fully translated under the old rules is not seen as needing anything more');
  const gate = await __testing.startTranslation(0, { quiet: true, force: false });
  assert.equal(gate.reason, 'already-translated', 'nothing is asked for again — the reason the v0.36.1 rules must not touch a floor v0.36.0 already finished');
});

test('a fresh swipe carrying a copy of a translated swipe\'s own `extra` is never pinned to that copy\'s old segmentation rules', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const context = mockHost();
  const settings = __testing.configureForTest({ settings: {} });
  // Swipe 0 was translated under v0.36.0's own rules and carries a real record of it.
  context.chat.push(await translatedFloor('雨が降っている。', [[1, '下雨了。']], settings));
  const message = context.chat[0];
  // The host's own behaviour on a fresh generation: swipe 1 is brand new prose — nothing this extension
  // has ever written to it, no boundary markers of any kind — but its `extra` starts life as a *copy* of
  // swipe 0's, segmentation_version and all (see readFloor's and resolveSegmentationVersion's own notes).
  const card = 'NOW PLAYING<br>今日の空';
  message.swipes = [message.mes, `<story_scene>\n${card}\n</story_scene>`];
  message.swipe_id = 1;
  message.mes = message.swipes[1];
  message.extra = { [MESSAGE_META_KEY]: { ...message.extra[MESSAGE_META_KEY], segmentation_version: 1, swipe_id: 1 } };
  const snapshot = await __testing.readMessageSnapshot(0, settings);
  assert.equal(snapshot.segmentationVersion, SEGMENTATION_RULES_VERSION, 'nothing has translated this text, so a copied record\'s rules are never trusted for it');
  assert.deepEqual(snapshot.segments.map(item => item.text), ['NOW PLAYING\n今日の空'], 'segmented under the latest rules, not glued as the copied v1 record would read it');
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

test('reasoning deltas keep the stream alive without ever reaching the floor', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const message = { mes: '<story_scene>\n雨が降っている。\n</story_scene>', swipe_id: 0 };
  mockHost([message]);
  __testing.configureForTest({ settings: streamingSettings, initialized: true });
  const payload = JSON.stringify([{ id: 1, text: '下雨了。' }]);
  // What a reasoning model actually sends: frame after frame of reasoning_content with content
  // still null, then the answer. Reading only `content` made every one of these invisible, so a
  // model that thought for ten minutes was indistinguishable from a hung request.
  globalThis.fetch = async () => sseResponse([
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '先确认这段是旁白。', content: null } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '译名无需统一。' } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: payload } }] })}\n\n`,
    'data: [DONE]\n\n',
  ]);
  const result = await __testing.startTranslation(0, { quiet: true, force: true });
  assert.equal(result.skipped, false);
  assert.equal(result.segments, 1);
  assert.match(message.mes, /下雨了。/);
  // Thinking is not translation and must never land anywhere near the floor.
  assert.doesNotMatch(message.mes, /旁白/);
  assert.doesNotMatch(message.mes, /译名无需统一/);
});

test('a batch that spends its whole budget thinking is parsed from the reasoning rather than failed', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const message = { mes: '<story_scene>\n雨が降っている。\n</story_scene>', swipe_id: 0 };
  mockHost([message]);
  __testing.configureForTest({ settings: streamingSettings, initialized: true });
  // content never arrives at all: the answer exists only inside the thinking, which is where an
  // overspent max_tokens leaves it. The whole-request path has always recovered this shape.
  globalThis.fetch = async () => sseResponse([
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '先试一版：' } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: JSON.stringify({ translations: [{ id: 1, text: '下雨了。' }] }) } }] })}\n\n`,
    'data: [DONE]\n\n',
  ]);
  const result = await __testing.startTranslation(0, { quiet: true, force: true });
  assert.equal(result.skipped, false);
  assert.match(message.mes, /下雨了。/);
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
  const message = { mes: '<story_scene>\n「何を考えてるの！」\n\n「……わからない。」\n</story_scene>', swipe_id: 0 };
  const context = mockHost([message]);
  __testing.configureForTest({ settings: { ...coloringSettings, streamingWriteback: true }, initialized: true });

  let sentMessages = null;
  globalThis.fetch = async (_url, init) => {
    sentMessages = JSON.parse(init.body).messages;
    return completionResponse([
      { id: 1, text: '「你到底在想什么！」', speaker: '英梨梨', emotion: 'angry', intensity: 2 },
      { id: 2, text: '「……我不知道。」', speaker: '诗羽', emotion: 'whisper', intensity: 1 },
    ]);
  };
  const result = await __testing.startTranslation(0, { quiet: true, force: true });
  assert.equal(result.skipped, false);

  // The roster reached the model as people, each with the other spellings beside the name to write.
  const annotation = sentMessages.find(entry => entry.content.includes('附加标注'));
  assert.ok(annotation);
  assert.match(annotation.content, /英梨梨（又名 泽村）、诗羽/);

  // Two speakers, two different colours, and the black-haired one still got one of her own.
  const colors = [...message.mes.matchAll(/["';]color:(#[0-9a-f]{6})/g)].map(match => match[1]);
  assert.equal(colors.length, 2);
  assert.notEqual(colors[0], colors[1]);
  assert.match(message.mes, /class="jy-spk jy-spk-[a-z0-9]+ jy-emo-angry jy-emo-l2"/);
  assert.match(message.mes, /class="jy-spk jy-spk-[a-z0-9]+ jy-emo-whisper jy-emo-l1"/);
  assert.match(message.mes, /title="英梨梨 · 愤怒"/);

  // Host themes set message text colour with !important, so every declaration has to outrank them.
  for (const declaration of message.mes.matchAll(/style="([^"]*)"/g)) {
    for (const item of declaration[1].split(';')) {
      assert.match(item, /!important$/, `样式没有盖过主题：${item}`);
    }
  }

  // And the colour has to be written twice. `-webkit-text-fill-color` decides the painted glyph in
  // Blink and beats `color` outright, so a theme that sets it for gradient text leaves the text in
  // the theme's colour while getComputedStyle('color') still reports ours — the colour reads as
  // applied and never appears. Verified against a theme rule doing exactly that.
  for (const declaration of message.mes.matchAll(/style="([^"]*)"/g)) {
    const items = declaration[1].split(';');
    const painted = items.filter(item => item.startsWith('color:'));
    const filled = items.filter(item => item.startsWith('-webkit-text-fill-color:'));
    assert.equal(filled.length, painted.length, `颜色只写了一种拼法：${declaration[1]}`);
    if (painted.length) assert.equal(filled[0], `-webkit-text-fill-${painted[0]}`);
  }

  // The main model sees the Japanese original and no markup at all.
  const prompt = [{ mes: message.mes, extra: message.extra }];
  interceptGenerationChat(prompt);
  assert.equal(prompt[0].mes, '<story_scene>\n「何を考えてるの！」\n\n「……わからない。」\n</story_scene>');

  // Labels are stored so a reload, a restyle or a 补译 keeps the colours.
  const stored = message.extra[MESSAGE_META_KEY].annotations;
  assert.deepEqual(stored['1'], { speaker: '英梨梨', emotion: 'angry', intensity: 2 });
  assert.deepEqual(stored['2'], { speaker: '诗羽', emotion: 'whisper', intensity: 1 });
  const snapshot = await __testing.readMessageSnapshot(0);
  assert.equal(snapshot.translated, true);
  assert.deepEqual(snapshot.existingAnnotations.get(1), { speaker: '英梨梨', emotion: 'angry', intensity: 2 });
  assert.equal(context.chat[0], message);
});

test('speaker colour stops at the quote marks and never reaches narration', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  // Two shapes the old code painted identically: narration with one quoted clause inside it, and a
  // line of pure narration the model labelled with a speaker anyway.
  const message = { mes: '<story_scene>\n律は「あ、そう」と呟いた。\n\n雨が降っている。\n</story_scene>', swipe_id: 0 };
  mockHost([message]);
  __testing.configureForTest({ settings: { ...coloringSettings, streamingWriteback: true }, initialized: true });
  globalThis.fetch = async () => completionResponse([
    { id: 1, text: '「啊，这样。」律嘟囔了一句，没等说明念完就挂了电话。', speaker: '英梨梨', emotion: 'neutral' },
    { id: 2, text: '下雨了。', speaker: '英梨梨', emotion: 'neutral' },
  ]);
  const result = await __testing.startTranslation(0, { quiet: true, force: true });
  assert.equal(result.skipped, false);

  const painted = [...message.mes.matchAll(/<span[^>]*color:#[0-9a-f]{6}[^>]*>([\s\S]*?)<\/span>/g)]
    .map(match => match[1].replace(/[\u200b-\u200d\u2063]/g, ''));
  // The quoted clause, and nothing else in either line.
  assert.deepEqual(painted, ['「啊，这样。」']);
  // Both translations still reach the floor whole, colour or no colour.
  assert.match(message.mes, /律嘟囔了一句，没等说明念完就挂了电话。/);
  assert.match(message.mes, /下雨了。/);
  // Read-back is what 补译 and the main model see, and it must not notice any of this.
  assert.equal(
    stripGeneratedTranslationLines(message.mes),
    '<story_scene>\n律は「あ、そう」と呟いた。\n\n雨が降っている。\n</story_scene>',
  );
});

test('a quotation mark never ends up in a different span from its partner', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const message = {
    mes: '<story_scene>\n「副院長を呼び出しました！　今、自宅から車で向かってますから、あと十五分で——」\n</story_scene>',
    swipe_id: 0,
  };
  mockHost([message]);
  __testing.configureForTest({ settings: { ...coloringSettings, streamingWriteback: true }, initialized: true });
  globalThis.fetch = async () => completionResponse([
    {
      id: 1,
      text: '「副院长已经去叫了！他现在正从家里开车赶过来，再过十五分钟就——」',
      speaker: '英梨梨',
      emotion: 'shout',
      intensity: 1,
    },
  ]);
  const result = await __testing.startTranslation(0, { quiet: true, force: true });
  assert.equal(result.skipped, false);

  // The rhythm has to have actually split this line, or the rest of the test proves nothing.
  assert.ok((message.mes.match(/font-size:/g) ?? []).length >= 2, '句内节奏没有切分，这条断言没有意义');

  // Every span inside a quoted run must open and close inside it. SillyTavern wraps 「…」 in its own
  // dialogue tag, and a `</span>` that arrives before its opener truncates that tag in place — the
  // line then renders half in the dialogue colour and half in the narration colour.
  for (const run of message.mes.match(/「[\s\S]*?」/g) ?? []) {
    let depth = 0;
    for (const tag of run.matchAll(/<\/?span\b/g)) {
      depth += tag[0].startsWith('</') ? -1 : 1;
      assert.ok(depth >= 0, `酒馆的对话标签会在这里被截断：${run}`);
    }
    assert.equal(depth, 0, `引号对里的 span 没有闭合：${run}`);
  }

  assert.equal(
    stripGeneratedTranslationLines(message.mes),
    '<story_scene>\n「副院長を呼び出しました！　今、自宅から車で向かってますから、あと十五分で——」\n</story_scene>',
  );
});

test('parallel lanes run side by side and still hand results back in order', async () => {
  const { runInLanes } = __testing;
  let inFlight = 0;
  let peak = 0;
  const finished = [];
  const results = await runInLanes([30, 10, 20, 5], 2, async (delay, index) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise(resolve => setTimeout(resolve, delay));
    inFlight -= 1;
    finished.push(index);
    return index * 10;
  });
  assert.equal(peak, 2);
  assert.deepEqual(results, [0, 10, 20, 30]);
  assert.notDeepEqual(finished, [0, 1, 2, 3]);

  inFlight = 0;
  peak = 0;
  await runInLanes([2, 2, 2], 1, async delay => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise(resolve => setTimeout(resolve, delay));
    inFlight -= 1;
  });
  assert.equal(peak, 1, '一条车道就是原来的逐批发送');
});

test('a streamed floor split across lanes asks again for a line sent back in Japanese', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const lines = ['雨が降っている。', '風が冷たい。', '猫が鳴いた。', '夜が明けた。'];
  const message = { mes: `<story_scene>\n${lines.join('\n\n')}\n</story_scene>`, swipe_id: 0 };
  const repairs = [];
  mockHost([message], {
    ChatCompletionService: {
      async processRequest(payload) {
        const input = JSON.parse(payload.messages.at(-1).content);
        repairs.push(input.segments.map(segment => segment.id));
        return { content: JSON.stringify({ translations: input.segments.map(segment => ({ id: segment.id, text: '猫叫了。' })) }) };
      },
    },
  });
  __testing.configureForTest({
    settings: { ...streamingSettings, retries: 1, channels: [{ ...streamingSettings.channels[0], concurrency: 2 }] },
    initialized: true,
  });
  // Line 3 comes back untouched, the way a small model sometimes returns one.
  const replies = { 1: '下雨了。', 2: '风很冷。', 3: '猫が鳴いた。', 4: '天亮了。' };
  let open = 0;
  let peak = 0;
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(JSON.parse(init.body).messages.at(-1).content);
    open += 1;
    peak = Math.max(peak, open);
    await new Promise(resolve => setTimeout(resolve, 15));
    open -= 1;
    const payload = JSON.stringify({ translations: input.segments.map(segment => ({ id: segment.id, text: replies[segment.id] })) });
    return sseResponse([`data: ${JSON.stringify({ choices: [{ delta: { content: payload } }] })}\n\n`, 'data: [DONE]\n\n']);
  };
  const result = await __testing.startTranslation(0, { quiet: true, force: true });
  assert.equal(result.skipped, false);
  assert.equal(peak, 2, '两批应当同时在途');
  // The Japanese reply was not written down as a translation; only that line went back, and it came home.
  assert.deepEqual(repairs, [[3]]);
  assert.match(message.mes, /猫叫了。/);
  assert.match(message.mes, /下雨了。/);
  assert.match(message.mes, /天亮了。/);
});

test('one character spelled two ways in one floor wears one colour', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const message = { mes: '<story_scene>\n「行こう。」\n\n「待って。」\n</story_scene>', swipe_id: 0 };
  mockHost([message]);
  __testing.configureForTest({ settings: { ...coloringSettings, streamingWriteback: true }, initialized: true });
  globalThis.fetch = async () => completionResponse([
    { id: 1, text: '「走吧。」', speaker: '艾莉丝·伯雷亚斯·格雷拉特', emotion: 'neutral' },
    { id: 2, text: '「等等。」', speaker: '艾莉丝', emotion: 'neutral' },
  ]);
  const result = await __testing.startTranslation(0, { quiet: true, force: true });
  assert.equal(result.skipped, false);
  const slugs = [...message.mes.matchAll(/class="jy-spk (jy-spk-[a-z0-9]+)/g)].map(match => match[1]);
  assert.equal(slugs.length, 2);
  assert.equal(slugs[0], slugs[1], '同一个人不该穿两种颜色');
  assert.doesNotMatch(message.mes, /title="艾莉丝·伯雷亚斯/);
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

// The rhythm writes extra tags *inside* the translation rather than around it, which is the one
// place a display feature could corrupt the text. Each tag is its own marked affix, so the three
// invariants that protect the floor have to still hold exactly.
test('句内节奏 writes inside the translation without disturbing what reads back out', () => {
  const line = '「那个男人是死是活也好，与贝蒂都没有半点瓜葛呀！贝蒂仅仅是为了守护这座禁书库才留守的呢！」';
  const doc = segmentSource(line, {});
  const translations = new Map([[1, line]]);
  const styleFor = () => ({
    open: '<span class="jy-spk" style="color:#c8a2c8 !important">',
    close: '</span>',
    emphasis: text => emphasisContour(text, { emotion: 'angry', intensity: 2 })
      ?.map(piece => ({ text: piece.text, css: `font-size:${piece.scale.toFixed(3)}em !important` })) ?? null,
  });

  const floor = assembleBilingual(doc.layout, translations, { styleFor });
  const plain = assembleBilingual(doc.layout, translations, {});
  assert.ok(floor.match(/font-size:[\d.]+em !important/g).length >= 3, '节奏没有写进楼层');

  // 1. The main model still sees the untouched original.
  assert.equal(stripGeneratedTranslationLines(floor), doc.source);
  assert.equal(stripGeneratedTranslationLines(floor), stripGeneratedTranslationLines(plain));

  // 2. 补译 reads the translation back without a trace of the markup, or the next repair would send
  //    span tags to the model as if they were the draft.
  assert.equal([...extractGeneratedTranslations(floor, {}).values()][0], line);

  // 3. A split that does not reassemble into the exact translation is refused outright, so a broken
  //    contour costs the rhythm and never rewrites a single character of the text.
  const mangled = assembleBilingual(doc.layout, translations, {
    styleFor: () => ({ open: '<span>', close: '</span>', emphasis: () => [{ text: '改写了', css: 'font-size:2em' }, { text: '文本', css: '' }] }),
  });
  assert.equal(stripGeneratedTranslationLines(mangled), doc.source);
  assert.ok(!mangled.includes('改写了'), '拒绝校验失败的拆分');
  assert.ok(mangled.includes(line), '译文必须原样保留');
});

// Stubbed timers rather than real ones: the window has a 10-second floor, and waiting it out twice
// would cost more than the rest of this file put together.
test('the channel window is a total timeout by default and an idle timeout once a stream renews it', async () => {
  const { withAbortTimeout } = __testing;
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const pending = new Map();
  let nextTimerId = 1;
  globalThis.setTimeout = handler => {
    const id = nextTimerId += 1;
    pending.set(id, handler);
    return id;
  };
  globalThis.clearTimeout = id => pending.delete(id);
  const closeWindow = () => {
    for (const [id, handler] of [...pending]) {
      pending.delete(id);
      handler();
    }
  };
  const untilAborted = signal => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });

  try {
    const oneShot = withAbortTimeout(undefined, 240, signal => untilAborted(signal));
    assert.equal(pending.size, 1);
    closeWindow();
    await assert.rejects(oneShot, /请求超时/);

    const streamed = withAbortTimeout(undefined, 240, (signal, renew) => {
      renew();
      renew();
      return untilAborted(signal);
    });
    // Each delta must replace the pending window, never stack a second one behind it.
    assert.equal(pending.size, 1);
    closeWindow();
    await assert.rejects(streamed, /没有新内容/);

    // A stream that finishes before the window closes leaves no timer behind.
    const finished = await withAbortTimeout(undefined, 240, (signal, renew) => {
      renew();
      return Promise.resolve('complete');
    });
    assert.equal(finished, 'complete');
    assert.equal(pending.size, 0);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
});

// The extension imports diagnostics.js with a cache-busting query, so a test that imports it plainly
// gets a second module instance with its own in-memory log. Browser storage is the one thing both
// copies share, which is also the path the real panel reads through.
function sharedLogStorage() {
  const store = new Map();
  return {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: key => { store.delete(key); },
  };
}

test('a batch keeps its thinking where the reader can find it afterwards', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = sharedLogStorage();
  t.after(() => {
    globalThis.SillyTavern = previousHost;
    globalThis.fetch = previousFetch;
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  });
  const message = { mes: '<story_scene>\n雨が降っている。\n</story_scene>', swipe_id: 0 };
  mockHost([message]);
  __testing.configureForTest({ settings: streamingSettings, initialized: true });
  clearDiagnostics();
  const payload = JSON.stringify([{ id: 1, text: '下雨了。' }]);
  globalThis.fetch = async () => sseResponse([
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '「雨が降っている」是旁白，' } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '保持叙述距离，不要加语气。' } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: payload } }] })}\n\n`,
    'data: [DONE]\n\n',
  ]);
  await __testing.startTranslation(0, { quiet: true, force: true });

  // Earlier tests in this file already logged responses of their own, so take the newest rather
  // than the first.
  const response = readDiagnostics().filter(entry => entry.scope === 'translation.raw-response').at(-1);
  assert.ok(response, '没有记下返回');
  assert.equal(response.reasoning, '「雨が降っている」是旁白，保持叙述距离，不要加语气。');
  assert.equal(response.details.reasoningCharacters, response.reasoning.length);
  // The safe summary is what gets shown without asking; the thinking carries story text, so it
  // belongs in the same tier as the request and the response, not in the summary.
  assert.doesNotMatch(JSON.stringify(response.details), /叙述距离/);
  // The full export is where a reader goes to read it.
  const report = formatFullDiagnosticReport([response]);
  assert.match(report, /副 API 的思考过程（\d+ 字）/);
  assert.match(report, /保持叙述距离/);
  assert.doesNotMatch(formatDiagnosticReport([response]), /保持叙述距离/);
});

const speakerColoring = {
  ...streamingSettings,
  coloring: {
    speakers: true,
    emotions: true,
    rhythm: false,
    minContrast: 4.5,
    vividness: 0.65,
    autoSpeakers: true,
    band: {
      direction: 'light',
      luminance: 0.42,
      chromaMax: 0.13,
      minContrast: 4.5,
      lightness: 0.72,
      backgrounds: [{ r: 0.106, g: 0.106, b: 0.133, a: 1 }],
    },
    bandProbedAt: '2026-09-12 18:00:00',
  },
};

function spokenFloor() {
  return { mes: '<story_scene>\n「あ、律？」\n\n「おっそーい！」\n</story_scene>', swipe_id: 0 };
}

function spokenReply(speaker) {
  return sseResponse([
    `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ translations: [
      { id: 1, text: '「啊，律？」', speaker, emotion: 'happy', intensity: 1 },
      { id: 2, text: '「好慢！」', speaker, emotion: 'angry', intensity: 1 },
    ] }) } }] })}\n\n`,
    'data: [DONE]\n\n',
  ]);
}

test('a speaker the palette has never heard of is still painted, not silently left grey', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const message = spokenFloor();
  mockHost([message]);
  // No palette at all: this is the state every user is in before registering anyone, and it used to
  // strip the colour off every line while leaving the emotion weight on, which reads as 掉色.
  __testing.configureForTest({ settings: { ...speakerColoring, speakerPalette: {} }, initialized: true });
  globalThis.fetch = async () => spokenReply('星野爱');
  await __testing.startTranslation(0, { quiet: true, force: true });

  assert.match(message.mes, /color:#[0-9a-f]{6} !important/, '名单外的说话人也要有颜色');
  assert.match(message.mes, /class="jy-spk jy-spk-[a-z0-9]+ jy-emo-happy/);
  assert.match(message.mes, /title="星野爱 · 喜悦"/);
  // The main model still reads the original and nothing else.
  const prompt = [{ mes: message.mes, extra: message.extra }];
  interceptGenerationChat(prompt);
  assert.equal(prompt[0].mes, '<story_scene>\n「あ、律？」\n\n「おっそーい！」\n</story_scene>');
});

test('the same name gets the same colour every time, and two names get different ones', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const paint = async speaker => {
    const message = spokenFloor();
    mockHost([message]);
    __testing.configureForTest({ settings: { ...speakerColoring, speakerPalette: {} }, initialized: true });
    globalThis.fetch = async () => spokenReply(speaker);
    await __testing.startTranslation(0, { quiet: true, force: true });
    return message.mes.match(/color:(#[0-9a-f]{6}) !important/)[1];
  };
  assert.equal(await paint('星野爱'), await paint('星野爱'), '同一个名字必须永远同一个颜色');
  assert.notEqual(await paint('星野爱'), await paint('源律'));
});

test('turning auto-colouring off leaves the emotion but says why the colour is gone', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = sharedLogStorage();
  t.after(() => {
    globalThis.SillyTavern = previousHost;
    globalThis.fetch = previousFetch;
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  });
  const message = spokenFloor();
  mockHost([message]);
  __testing.configureForTest({
    settings: { ...speakerColoring, coloring: { ...speakerColoring.coloring, autoSpeakers: false }, speakerPalette: {} },
    initialized: true,
  });
  globalThis.fetch = async () => spokenReply('星野爱');
  await __testing.startTranslation(0, { quiet: true, force: true });

  // Emotion typography stays; the colour does not. That combination is exactly what the bug report
  // looked like, so it has to be written down rather than left to be guessed at.
  assert.match(message.mes, /jy-emo-happy/);
  assert.doesNotMatch(message.mes, /color:#[0-9a-f]{6} !important/);
  const warned = readDiagnostics().filter(entry => entry.scope === 'coloring.speaker-unpainted').at(-1);
  assert.ok(warned, '没有报出未上色的说话人');
  assert.deepEqual(warned.details.unpainted, ['星野爱（2 段）']);
  assert.equal(warned.details.autoSpeakers, false);
});

test('a registered hair colour overrides the name-derived one', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const paint = async palette => {
    const message = spokenFloor();
    mockHost([message]);
    __testing.configureForTest({ settings: { ...speakerColoring, speakerPalette: palette }, initialized: true });
    globalThis.fetch = async () => spokenReply('星野爱');
    await __testing.startTranslation(0, { quiet: true, force: true });
    return message.mes.match(/color:(#[0-9a-f]{6}) !important/)[1];
  };
  const auto = await paint({});
  const registered = await paint({ 'sakurai.png': [{ name: '星野爱', aliases: [], source: '#8b5ad6', from: 'hair' }] });
  assert.notEqual(auto, registered, '填了发色就该按发色走');
  // An alias resolves to the same entry as the registered name.
  const byAlias = await paint({ 'sakurai.png': [{ name: '爱', aliases: ['星野爱'], source: '#8b5ad6', from: 'hair' }] });
  assert.equal(byAlias, registered);
});

// 「只留译文」: one floor, translated with the switch on, then everything that reads it.
function translationOnlyHost(replies) {
  const asked = [];
  const context = mockHost([], {
    generateRaw: ({ prompt }) => {
      asked.push(JSON.stringify(prompt));
      return Promise.resolve(JSON.stringify(replies[Math.min(asked.length, replies.length) - 1]));
    },
  });
  const settings = __testing.configureForTest({
    settings: { apiMode: 'follow', streamingWriteback: false, retries: 0, translationOnly: true, excludedTags: ['image'], bodyTags: ['story_scene'] },
    initialized: true,
  });
  const original = '<story_scene>\n雨が降っている。\n<image>rain, city</image>\n風が強い。\n</story_scene>\n<status>HP 10</status>';
  context.chat.push({ mes: original, swipe_id: 0, swipes: [original], swipe_info: [{ extra: {} }], extra: {} });
  return { context, settings, asked, original };
}

test('only the translation is left on a finished floor, and everything that reads the floor still finds the original', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const { context, asked, original } = translationOnlyHost([
    [{ id: 1, text: '下雨了。' }, { id: 2, text: '风很大。' }],
    [{ id: 1, text: '在下雨。' }, { id: 2, text: '风很猛。' }],
  ]);
  const message = context.chat[0];
  await __testing.startTranslation(0, { quiet: true });
  const projection = '<story_scene>\n下雨了。\n<image>rain, city</image>\n风很大。\n</story_scene>\n<status>HP 10</status>';
  assert.equal(message.mes, projection, 'the floor holds the translation, the picture and the panel, nothing else');
  assert.equal(message.swipes[0], projection);
  const meta = message.extra[MESSAGE_META_KEY];
  assert.equal(meta.stripped, true);
  assert.equal(stripGeneratedTranslationLines(meta.mirror, meta), original, 'the kept text holds the original');
  assert.equal(message.swipe_info[0].extra[MESSAGE_META_KEY].mirror, meta.mirror, 'and so does the swipe’s own record');

  const snapshot = await __testing.readMessageSnapshot(0);
  assert.equal(snapshot.translated, true);
  assert.equal(snapshot.stripped, true);
  assert.equal((await __testing.startTranslation(0, { quiet: true })).reason, 'already-translated');

  // The main model is shown the original, as for a bilingual floor.
  const prompt = [{ ...message }];
  interceptGeneration(prompt, 8192, () => {}, 'normal');
  assert.equal(prompt[0].mes, original);
  assert.equal(message.mes, projection, 'the floor itself is not touched');

  // Reading the original aloud reads it off the kept text; it is not on the page.
  const source = await __testing.collectTtsFloor(0, undefined, 'source');
  assert.deepEqual(source.lines.map(line => line.text), ['雨が降っている。', '風が強い。']);
  assert.equal(source.offPage, true);
  const translation = await __testing.collectTtsFloor(0, undefined, 'translation');
  assert.deepEqual(translation.lines.map(line => line.text), ['下雨了。', '风很大。']);

  // Translated again from the original, not from the translation.
  await __testing.startTranslation(0, { quiet: true, force: true });
  assert.equal(asked.length, 2);
  assert.match(asked[1], /雨が降っている/);
  assert.doesNotMatch(asked[1], /下雨了/);
  assert.equal(message.mes, '<story_scene>\n在下雨。\n<image>rain, city</image>\n风很猛。\n</story_scene>\n<status>HP 10</status>');
  assert.equal(stripGeneratedTranslationLines(message.extra[MESSAGE_META_KEY].mirror, message.extra[MESSAGE_META_KEY]), original);
});

test('a continued floor is an ordinary floor again, and a floor changed by hand is never translated again', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const { context, asked, original } = translationOnlyHost([
    [{ id: 1, text: '下雨了。' }, { id: 2, text: '风很大。' }],
  ]);
  const message = context.chat[0];
  await __testing.startTranslation(0, { quiet: true });
  const projection = message.mes;
  const mirror = message.extra[MESSAGE_META_KEY].mirror;

  // The host wrote back what the main model was shown, and what it wrote after it.
  message.mes = `${original}\n続き。`;
  const continued = await __testing.readMessageSnapshot(0);
  assert.equal(continued.stripped, false);
  assert.equal(continued.diverged, false);
  assert.equal(continued.translated, false);

  // Changed by hand instead.
  message.mes = projection.replace('下雨了。', '下大雨了。');
  message.swipes[0] = message.mes;
  const edited = await __testing.readMessageSnapshot(0);
  assert.equal(edited.diverged, true);
  assert.equal((await __testing.startTranslation(0, { quiet: true, force: true })).reason, 'diverged');
  await assert.rejects(__testing.editTranslationSegment(0, 1, '别的'), error => error.code === 'JY_FLOOR_DIVERGED');
  assert.equal(asked.length, 1, 'nothing was sent');
  assert.equal(message.extra[MESSAGE_META_KEY].mirror, mirror, 'the kept text is untouched');
  // The main model is shown the floor as it now is; the kept text no longer describes it.
  const prompt = [{ ...message }];
  interceptGeneration(prompt, 8192, () => {}, 'normal');
  assert.equal(prompt[0].mes, message.mes);

  // Put back: the bilingual text, the change lost, and the record gone.
  const result = await __testing.restoreChatOriginals({ ask: () => true });
  assert.deepEqual(result, { restored: 1, edited: 1 });
  assert.equal(message.mes, mirror);
  assert.equal(message.swipes[0], mirror);
  assert.equal(message.extra[MESSAGE_META_KEY].stripped, undefined);
  assert.equal(message.extra[MESSAGE_META_KEY].mirror, undefined);
  assert.equal(message.swipe_info[0].extra[MESSAGE_META_KEY].mirror, undefined);
  const restored = await __testing.readMessageSnapshot(0);
  assert.equal(restored.translated, true, 'a bilingual floor that needs nothing more');
  assert.equal(restored.stripped, false);
});

test('a floor with gaps stays bilingual, and a restyle changes only the text kept for a stripped floor', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const { context, settings } = translationOnlyHost([
    [{ id: 1, text: '下雨了。' }],
    [{ id: 1, text: '下雨了。' }, { id: 2, text: '风很大。' }],
  ]);
  const message = context.chat[0];
  await __testing.startTranslation(0, { quiet: true });
  assert.match(message.mes, /雨が降っている/, 'a partial floor keeps its original beside each gap');
  assert.equal(message.extra[MESSAGE_META_KEY].stripped, undefined);
  await __testing.startTranslation(0, { quiet: true });
  assert.equal(message.extra[MESSAGE_META_KEY].stripped, true, '补译 finishes it, and then only the translation is left');
  const projection = message.mes;

  await __testing.restyleCurrentChat({ ...settings, translationPrefix: '【', translationSuffix: '】' });
  assert.equal(message.mes, projection, 'the floor shows no affix, so it does not change');
  assert.match(message.extra[MESSAGE_META_KEY].mirror, /【/);
  assert.equal(message.extra[MESSAGE_META_KEY].translation_prefix, '【');
  assert.equal((await __testing.readMessageSnapshot(0, { ...settings, translationPrefix: '【', translationSuffix: '】' })).translated, true);
});

test('deleting a swipe before a stripped one keeps its record its own, so a later change is still caught', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const { context } = translationOnlyHost([[{ id: 1, text: '下雨了。' }, { id: 2, text: '风很大。' }]]);
  const message = context.chat[0];
  const original = message.mes;
  // Three swipes, the last one shown and translated.
  message.swipes = ['<story_scene>\n一。\n</story_scene>', '<story_scene>\n二。\n</story_scene>', original];
  message.swipe_info = [{ extra: {} }, { extra: {} }, { extra: {} }];
  message.swipe_id = 2;
  await __testing.startTranslation(0, { quiet: true });
  assert.equal(message.extra[MESSAGE_META_KEY].stripped, true);
  // As after a reload: the shown record and the swipe's record are two objects.
  message.extra = structuredClone(message.extra);
  const mirror = message.extra[MESSAGE_META_KEY].mirror;

  // The host deletes swipe 0 the way it does: the arrays move, nothing inside them is renumbered.
  message.swipes.splice(0, 1);
  message.swipe_info.splice(0, 1);
  message.swipe_id = 1;
  __testing.renumberSwipeRecords({ messageId: 0, swipeId: 0, newSwipeId: 1 });
  assert.equal(message.extra[MESSAGE_META_KEY].swipe_id, 1);
  assert.equal(message.swipe_info[1].extra[MESSAGE_META_KEY].swipe_id, 1);
  assert.equal((await __testing.readMessageSnapshot(0)).translated, true, 'still a finished floor');

  message.mes = message.mes.replace('下雨了。', '下大雨了。');
  message.swipes[1] = message.mes;
  assert.equal((await __testing.readMessageSnapshot(0)).diverged, true, 'a change by hand is still caught');
  const result = await __testing.restoreChatOriginals({ ask: () => true });
  assert.equal(result.restored, 1);
  assert.equal(message.mes, mirror);
  assert.equal(message.swipes[1], mirror);
  assert.equal(message.swipes[0], '<story_scene>\n二。\n</story_scene>', 'the other swipe is left as it was');
});

test('putting the originals back reaches hidden floors, and each swipe gets its own original back', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const { context } = translationOnlyHost([
    [{ id: 1, text: '是的。' }, { id: 2, text: '风很大。' }],
    [{ id: 1, text: '是的。' }, { id: 2, text: '风很大。' }],
  ]);
  const message = context.chat[0];
  // Two swipes whose originals differ and whose translations are the same.
  const first = '<story_scene>\nはい。\n<image>rain, city</image>\n風が強い。\n</story_scene>';
  const second = '<story_scene>\nはい！\n<image>rain, city</image>\n風が強い。\n</story_scene>';
  message.mes = first;
  message.swipes = [first, second];
  message.swipe_info = [{ extra: {} }, { extra: {} }];
  message.swipe_id = 0;
  await __testing.startTranslation(0, { quiet: true });
  // The host moves to swipe 1: the shown record goes into swipe 0's slot, swipe 1's comes out.
  message.swipe_info[0].extra = structuredClone(message.extra);
  message.swipe_id = 1;
  message.mes = second;
  message.extra = structuredClone(message.swipe_info[1].extra);
  await __testing.startTranslation(0, { quiet: true });
  assert.equal(message.swipes[0], message.swipes[1], 'the same translation on both');
  message.is_system = true; // hidden with /hide

  const result = await __testing.restoreChatOriginals({ ask: () => true });
  assert.equal(result.restored, 2);
  assert.equal(stripGeneratedTranslationLines(message.swipes[0], {}), first);
  assert.equal(stripGeneratedTranslationLines(message.swipes[1], {}), second);
  assert.equal(message.mes, message.swipes[1]);
});

test('世界书开关: only the books switched on bring their ticked entries, and a card saved before keeps its picks', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  mockHost();
  const entries = {
    globalLore: [{ world: '杂项', uid: 1, content: '全局的杂七杂八。' }],
    characterLore: [{ world: '角色书', uid: 2, content: '樱井怕黑。' }, { world: '角色书', uid: 3, content: '樱井喜欢猫。' }],
  };
  const picks = [{ world: '杂项', uid: 1 }, { world: '角色书', uid: 2 }];
  // Saved before books could be switched: the books of the ticked entries are on.
  __testing.configureForTest({ settings: { worldInfoWhitelist: { 'sakurai.png': picks }, worldInfoBooks: {} }, worldInfoEntries: entries });
  assert.equal(__testing.whitelistedWorldbookContent(), '全局的杂七杂八。\n\n樱井怕黑。');
  // The global book switched off: its ticks stay, it brings nothing.
  __testing.configureForTest({ settings: { worldInfoWhitelist: { 'sakurai.png': picks }, worldInfoBooks: { 'sakurai.png': ['角色书'] } } });
  assert.equal(__testing.whitelistedWorldbookContent(), '樱井怕黑。');
  // Every book off: nothing at all.
  __testing.configureForTest({ settings: { worldInfoWhitelist: { 'sakurai.png': picks }, worldInfoBooks: { 'sakurai.png': [] } } });
  assert.equal(__testing.whitelistedWorldbookContent(), '');
});

test('a paragraph whose narrated line names nobody still paints its dialogue', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  // No blank line between them, so the two lines are one unit. The request tells the model to leave
  // speaker off a narrated line, and a unit used to be painted only when every line named the same
  // person in the same mood: the dialogue lost its colour exactly when the model did as it was told.
  const message = { mes: '<story_scene>\n英梨梨は顔を上げた。\n「何を考えてるの！」\n</story_scene>', swipe_id: 0 };
  mockHost([message]);
  __testing.configureForTest({ settings: { ...coloringSettings, streamingWriteback: true }, initialized: true });
  globalThis.fetch = async () => completionResponse([
    { id: 1, text: '英梨梨抬起头。', emotion: 'neutral' },
    { id: 2, text: '「你到底在想什么！」', speaker: '英梨梨', emotion: 'angry', intensity: 2 },
  ]);
  const result = await __testing.startTranslation(0, { quiet: true, force: true });
  assert.equal(result.skipped, false);
  const painted = [...message.mes.matchAll(/<span[^>]*color:#[0-9a-f]{6}[^>]*>([\s\S]*?)<\/span>/g)]
    .map(match => match[1].replace(/[\u200b-\u200d\u2063]/g, ''));
  assert.deepEqual(painted, ['「你到底在想什么！」']);
  assert.equal(stripGeneratedTranslationLines(message.mes), '<story_scene>\n英梨梨は顔を上げた。\n「何を考えてるの！」\n</story_scene>');
});

test('two people in one line each wear their own colour', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const message = { mes: '<story_scene>\n「来たの？」と詩羽が言うと、英梨梨は「うん」と頷いた。\n</story_scene>', swipe_id: 0 };
  mockHost([message]);
  __testing.configureForTest({ settings: { ...coloringSettings, streamingWriteback: true }, initialized: true });
  globalThis.fetch = async () => completionResponse([{
    id: 1, text: '「你来了？」诗羽问道，英梨梨点点头：「嗯。」', speaker: '诗羽', emotion: 'curious',
    quotes: [{ head: '你来了', speaker: '诗羽' }, { head: '嗯', speaker: '英梨梨' }],
  }]);
  const result = await __testing.startTranslation(0, { quiet: true, force: true });
  assert.equal(result.skipped, false);
  const runs = [...message.mes.matchAll(/<span[^>]*color:(#[0-9a-f]{6})[^>]*>([\s\S]*?)<\/span>/g)]
    .map(match => [match[2].replace(/[\u200b-\u200d\u2063]/g, ''), match[1]]);
  assert.deepEqual(runs.map(([text]) => text), ['「你来了？」', '「嗯。」']);
  assert.notEqual(runs[0][1], runs[1][1], 'the second speaker used to come out in the first one\'s colour');
});

test('a name auto-coloured on one card joins that card\'s roster and never another card\'s', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const sent = [];
  const reply = items => async (_url, init) => {
    sent.push(JSON.parse(init.body).messages.find(entry => entry.content.includes('附加标注')).content);
    return completionResponse(items);
  };
  const settings = { ...coloringSettings, streamingWriteback: true, tts: { enabled: true } };
  // Card one: the model names somebody the palette has never heard of; the floor paints them.
  const first = { mes: '<story_scene>\n「こんにちは」\n</story_scene>', swipe_id: 0 };
  mockHost([first]);
  __testing.configureForTest({ settings, initialized: true });
  globalThis.fetch = reply([{ id: 1, text: '「你好。」', speaker: '卡米拉', emotion: 'happy' }]);
  await __testing.startTranslation(0, { quiet: true, force: true });
  const again = { mes: '<story_scene>\n「またね」\n</story_scene>', swipe_id: 0 };
  mockHost([again]);
  __testing.configureForTest({ settings, initialized: true });
  globalThis.fetch = reply([{ id: 1, text: '「再见。」', speaker: '卡米拉' }]);
  await __testing.startTranslation(0, { quiet: true, force: true });
  assert.match(sent[1], /已知人物：[^。]*卡米拉/, 'the next floor of the same card knows the name');
  assert.match(sent[1], /名单外的人：写译文里对这个人的称呼/, 'and is still open to a newcomer');
  // Card two: a different cast. The first card's name must not close the list on it.
  const other = { mes: '<story_scene>\n「誰？」\n</story_scene>', swipe_id: 0 };
  mockHost([other], { characters: [{ name: '别的卡', avatar: 'other.png' }] });
  __testing.configureForTest({ settings, initialized: true });
  globalThis.fetch = reply([{ id: 1, text: '「谁？」' }]);
  await __testing.startTranslation(0, { quiet: true, force: true });
  assert.doesNotMatch(sent[2], /卡米拉/);
});

test('a voice row\'s alias is the same person and wears the same colour', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const message = { mes: '<story_scene>\n「行くよ」\n\n「うん」\n</story_scene>', swipe_id: 0 };
  mockHost([message]);
  __testing.configureForTest({
    settings: {
      ...coloringSettings,
      streamingWriteback: true,
      tts: { enabled: true },
      ttsVoices: { 'sakurai.png': [{ name: '卡米拉', aliases: ['卡米'] }] },
    },
    initialized: true,
  });
  let section = '';
  globalThis.fetch = async (_url, init) => {
    section = JSON.parse(init.body).messages.find(entry => entry.content.includes('附加标注')).content;
    return completionResponse([
      { id: 1, text: '「走了。」', speaker: '卡米拉' },
      { id: 2, text: '「嗯。」', speaker: '卡米' },
    ]);
  };
  await __testing.startTranslation(0, { quiet: true, force: true });
  assert.match(section, /卡米拉（又名 卡米）/);
  const colors = [...message.mes.matchAll(/["';]color:(#[0-9a-f]{6})/g)].map(match => match[1]);
  assert.equal(colors.length, 2);
  assert.equal(colors[0], colors[1], 'one person, one colour, whichever spelling the model used');
});

test('a calm line does not cancel the angry one beside it, and a line of narration nobody marked is never dressed in a mood', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  // Two lines of one person's dialogue, one unit: the calm one names no mood of its own.
  const spoken = { mes: '<story_scene>\n「そうなんだ」\n「何を考えてるの！」\n</story_scene>', swipe_id: 0 };
  mockHost([spoken]);
  __testing.configureForTest({ settings: { ...coloringSettings, streamingWriteback: true }, initialized: true });
  globalThis.fetch = async () => completionResponse([
    { id: 1, text: '「这样啊。」', speaker: '英梨梨', emotion: 'neutral' },
    { id: 2, text: '「你到底在想什么！」', speaker: '英梨梨', emotion: 'angry', intensity: 2 },
  ]);
  await __testing.startTranslation(0, { quiet: true, force: true });
  assert.match(spoken.mes, /jy-emo-angry/, 'the anger is still shown');
  // A narrated line and a line of dialogue in one unit: the colour goes on the dialogue, and the
  // typography of the anger does not spill onto words nobody said.
  const narrated = { mes: '<story_scene>\n英梨梨は顔を上げた。\n「何を考えてるの！」\n</story_scene>', swipe_id: 0 };
  mockHost([narrated]);
  __testing.configureForTest({ settings: { ...coloringSettings, streamingWriteback: true }, initialized: true });
  globalThis.fetch = async () => completionResponse([
    { id: 1, text: '英梨梨抬起头。' },
    { id: 2, text: '「你到底在想什么！」', speaker: '英梨梨', emotion: 'angry', intensity: 2 },
  ]);
  await __testing.startTranslation(0, { quiet: true, force: true });
  assert.match(narrated.mes, /color:#[0-9a-f]{6}[^>]*>[^<「]*「你到底在想什么！」/);
  assert.doesNotMatch(narrated.mes, /jy-emo-|font-weight/);
});

test('the roster names the card\'s character and the reader, and a pronoun is nobody\'s name', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const sent = [];
  const reply = items => async (_url, init) => {
    sent.push(JSON.parse(init.body).messages.find(entry => entry.content.includes('附加标注')).content);
    return completionResponse(items);
  };
  const first = { mes: '<story_scene>\n「こんにちは」\n</story_scene>', swipe_id: 0 };
  mockHost([first], { name1: '玩家', name2: '樱井' });
  __testing.configureForTest({ settings: { ...coloringSettings, streamingWriteback: true }, initialized: true });
  globalThis.fetch = reply([{ id: 1, text: '「你好。」', speaker: '你', emotion: 'happy' }]);
  await __testing.startTranslation(0, { quiet: true, force: true });
  assert.match(sent[0], /已知人物：英梨梨（又名 泽村）、诗羽、樱井、玩家[、。]/);
  assert.doesNotMatch(first.mes, /color:#/, 'a pronoun earns no colour');
  const again = { mes: '<story_scene>\n「またね」\n</story_scene>', swipe_id: 0 };
  mockHost([again], { name1: '玩家', name2: '樱井' });
  __testing.configureForTest({ settings: { ...coloringSettings, streamingWriteback: true }, initialized: true });
  globalThis.fetch = reply([{ id: 1, text: '「再见。」' }]);
  await __testing.startTranslation(0, { quiet: true, force: true });
  assert.doesNotMatch(sent[1], /已知人物：[^。]*、你[、。]/, 'and never joins the roster as a person');
});

test('a group chat keeps one cast of its own, apart from every other group', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const sent = [];
  const reply = items => async (_url, init) => {
    sent.push(JSON.parse(init.body).messages.find(entry => entry.content.includes('附加标注')).content);
    return completionResponse(items);
  };
  const settings = { ...coloringSettings, streamingWriteback: true };
  const floor = text => ({ mes: `<story_scene>\n${text}\n</story_scene>`, swipe_id: 0 });
  const inGroup = (groupId, message) => {
    mockHost([message], { groupId, characterId: undefined });
    __testing.configureForTest({ settings, initialized: true });
  };
  inGroup('g1', floor('「こんにちは」'));
  globalThis.fetch = reply([{ id: 1, text: '「你好。」', speaker: '卡米拉', emotion: 'happy' }]);
  await __testing.startTranslation(0, { quiet: true, force: true });
  inGroup('g2', floor('「誰？」'));
  globalThis.fetch = reply([{ id: 1, text: '「谁？」' }]);
  await __testing.startTranslation(0, { quiet: true, force: true });
  assert.doesNotMatch(sent[1], /卡米拉/, 'another group\'s cast is not this one\'s');
  inGroup('g1', floor('「またね」'));
  globalThis.fetch = reply([{ id: 1, text: '「再见。」' }]);
  await __testing.startTranslation(0, { quiet: true, force: true });
  assert.match(sent[2], /已知人物：[^。]*卡米拉/);
});

// One floor translated with colouring on: what went out, and the floor that came back.
async function colouredFloor(source, items, { settings = { ...coloringSettings, streamingWriteback: true }, host = {} } = {}) {
  const message = { mes: `<story_scene>\n${source}\n</story_scene>`, swipe_id: 0 };
  mockHost([message], host);
  __testing.configureForTest({ settings, initialized: true });
  let section = '';
  globalThis.fetch = async (_url, init) => {
    section = JSON.parse(init.body).messages.find(entry => entry.content.includes('附加标注'))?.content ?? '';
    return completionResponse(items);
  };
  await __testing.startTranslation(0, { quiet: true, force: true });
  return { message, section };
}

const paintedRuns = mes => [...mes.matchAll(/<span[^>]*?class="([^"]*)"[^>]*?color:(#[0-9a-f]{6})[^>]*>([\s\S]*?)<\/span>/g)]
  .map(match => [match[3].replace(/<[^>]+>/g, '').replace(/[\u200b-\u200d\u2063]/g, ''), match[2]]);

test('the host\'s default reader name is a person the roster offers and the floor paints', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const { message, section } = await colouredFloor('「こんにちは」\n\n「やあ」', [
    { id: 1, text: '「你好。」', speaker: '英梨梨', emotion: 'happy' },
    { id: 2, text: '「嗨。」', speaker: 'User', emotion: 'happy' },
  ], { host: { name1: 'User', name2: '樱井' } });
  assert.match(section, /已知人物：[^。]*、User[、。]/);
  assert.deepEqual(paintedRuns(message.mes).map(([text]) => text), ['「你好。」', '「嗨。」']);
  // A persona named with a pronoun is never offered as a person: the answer would be thrown away.
  const pronoun = await colouredFloor('「こんにちは」', [{ id: 1, text: '「你好。」' }], { host: { name1: '我', name2: '樱井' } });
  assert.doesNotMatch(pronoun.section, /已知人物：[^。]*、我[、。]/);
});

test('a card named for two people offers neither as one person and never merges them into one colour', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const { message, section } = await colouredFloor('「行くよ」\n\n「うん」', [
    { id: 1, text: '「走了。」', speaker: '卡米拉', emotion: 'happy' },
    { id: 2, text: '「嗯。」', speaker: '露娜', emotion: 'happy' },
  ], { settings: { ...coloringSettings, streamingWriteback: true, speakerPalette: {} }, host: { name1: '玩家', name2: '卡米拉 & 露娜' } });
  assert.doesNotMatch(section, /卡米拉 & 露娜/);
  assert.match(section, /已知人物：玩家[、。]/);
  const colors = paintedRuns(message.mes).map(([, color]) => color);
  assert.equal(colors.length, 2);
  assert.notEqual(colors[0], colors[1]);
});

test('a line nobody painted keeps the colour its original carried, beside a line painted run by run', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const { message } = await colouredFloor('<span style="color:#ff0000">警報が鳴った。</span>\n「逃げて！」', [
    { id: 1, text: '警报响了。' },
    { id: 2, text: '「快逃！」', speaker: '英梨梨', emotion: 'scared' },
  ]);
  assert.match(message.mes.replace(/[\u200b-\u200d\u2060-\u2064\ufeff]/g, ''), /<span style="color:#ff0000">警报响了。<\/span>/);
  assert.deepEqual(paintedRuns(message.mes).map(([text]) => text), ['「快逃！」']);
});

test('changing the translation\'s affixes keeps every run painted in its own speaker\'s colour', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const { message } = await colouredFloor('「来たの？」と詩羽が言うと、英梨梨は「うん」と頷いた。', [{
    id: 1, text: '「你来了？」诗羽问道，英梨梨点点头：「嗯。」', speaker: '诗羽',
    quotes: [{ head: '你来了', speaker: '诗羽' }, { head: '嗯', speaker: '英梨梨' }],
  }]);
  const before = paintedRuns(message.mes);
  assert.equal(before.length, 2);
  const restyled = restyleBilingual(message.mes, { translationPrefix: '【', translationSuffix: '】' }, message.extra[MESSAGE_META_KEY]);
  assert.match(restyled, /【/);
  assert.deepEqual(paintedRuns(restyled), before);
});

test('a floor restyled again and again keeps each run\'s colour, the carried formatting and a record of its affixes', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const { message } = await colouredFloor('<span style="color:#ff0000">警報が鳴った。</span>\n\n「来たの？」と詩羽が言うと、英梨梨は「うん」と頷いた。', [
    { id: 1, text: '警报响了。' },
    { id: 2, text: '「你来了？」诗羽问道，英梨梨点点头：「嗯。」', speaker: '诗羽', quotes: [{ head: '你来了', speaker: '诗羽' }, { head: '嗯', speaker: '英梨梨' }] },
  ]);
  const settings = __testing.configureForTest({});
  const before = paintedRuns(message.mes);
  assert.equal(before.length, 2);
  // The default prefix ends in `{`, which is no reason to keep the record of the affixes before it.
  for (const [prefix, suffix] of [['【', '】'], ['{', '}'], ['<jy-t>', '</jy-t>']]) {
    await __testing.restyleCurrentChat({ ...settings, translationPrefix: prefix, translationSuffix: suffix });
    const meta = message.extra[MESSAGE_META_KEY];
    assert.deepEqual([meta.translation_prefix, meta.translation_suffix], [prefix, suffix]);
    assert.deepEqual(paintedRuns(message.mes), before, `after ${prefix}${suffix}`);
    assert.match(message.mes.replace(/[\u200b-\u200d\u2060-\u2064\ufeff]/g, ''), /<span style="color:#ff0000">警报响了。<\/span>/);
  }
});

test('a segment prefix ending in `{` does not leave an old translation prefix inside the next restyle', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const context = mockHost();
  const settings = __testing.configureForTest({ settings: { segmentPrefix: '{', segmentSuffix: '}', translationPrefix: '', translationSuffix: '' } });
  context.chat.push(await translatedFloor('雨が降っている。', [[1, '下雨了。']], settings));
  const message = context.chat[0];
  for (const [prefix, suffix] of [['<jy-t>', '</jy-t>'], ['【', '】'], ['<jy-u>', '</jy-u>'], ['<jy-v>', '</jy-v>']]) {
    await __testing.restyleCurrentChat({ ...settings, translationPrefix: prefix, translationSuffix: suffix });
    assert.equal(message.extra[MESSAGE_META_KEY].translation_prefix, prefix);
    const shown = message.mes.replace(/[\u200b-\u200d\u2060-\u2064\ufeff]/g, '');
    assert.match(shown, new RegExp(`\n${prefix}下雨了。${suffix}\n`), `after ${prefix}${suffix}`);
  }
});

test('on a host with no record per swipe, another swipe\'s record never puts its affixes inside this one\'s body', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const context = mockHost();
  const settings = __testing.configureForTest({ settings: { translationPrefix: '<jy-t>', translationSuffix: '</jy-t>' } });
  const shown = await translatedFloor('雨が降っている。', [[1, '下雨了。']], settings);
  // The other swipe was translated last, with empty affixes, and the host kept only that record.
  const other = await translatedFloor('風が強い。', [[1, '风很大。']], { ...settings, translationPrefix: '', translationSuffix: '' });
  context.chat.push({ mes: shown.mes, swipe_id: 0, swipes: [shown.mes, other.mes], extra: { [MESSAGE_META_KEY]: { ...other.extra[MESSAGE_META_KEY], swipe_id: 1 } } });
  const message = context.chat[0];
  for (const [prefix, suffix] of [['【', '】'], ['<jy-u>', '</jy-u>']]) {
    await __testing.restyleCurrentChat({ ...settings, translationPrefix: prefix, translationSuffix: suffix });
    const text = message.mes.replace(/[\u200b-\u200d\u2060-\u2064\ufeff]/g, '');
    assert.match(text, new RegExp(`\n${prefix}下雨了。${suffix}\n`), `after ${prefix}${suffix}`);
  }
});

// ---------------------------------------------------------------------------------------------
// A reply with nothing to translate (a gasp, a stammer, a short onomatopoeia) used to be echoed back
// unchanged, read as still-Japanese, dropped, sent to repair, echoed again, and left missing forever —
// 补译缺失段落 then repeated the same failure. See core.js's looksUntranslated/isShortExactEcho and
// index.js's withoutUntranslated/translateOneBatch.
// ---------------------------------------------------------------------------------------------

test('four lines with nothing but a gasp or a stammer in them translate on the first request, never sent to repair', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const asked = [];
  // The model hands every one of these back exactly as it received them, there is nothing in any of
  // them to translate, so the mock simply echoes whatever it was asked for.
  let segments;
  const context = mockHost([], {
    generateRaw: ({ prompt }) => {
      asked.push(JSON.stringify(prompt));
      return Promise.resolve(JSON.stringify(segments.map(item => ({ id: item.id, text: item.text }))));
    },
  });
  const settings = __testing.configureForTest({ settings: { apiMode: 'follow', streamingWriteback: false, retries: 1 }, initialized: true });
  const lines = ['「……っ」', '「……え？」', '「ッ！」', '「……うん。」'];
  const source = lines.join('\n\n');
  segments = segmentSource(source, settings).segments;
  assert.equal(segments.length, 4, 'four separate paragraphs, one per reported line');
  context.chat.push({ mes: `<story_scene>\n${source}\n</story_scene>`, swipe_id: 0, extra: {} });
  const result = await __testing.startTranslation(0, { quiet: true, force: false });
  assert.equal(asked.length, 1, 'the model handing every line back unchanged settles it on the first request, no repair');
  assert.equal(result.skipped, false);
  assert.equal(result.partial, undefined, 'the floor is written back complete');
  const snapshot = await __testing.readMessageSnapshot(0, settings);
  assert.equal(snapshot.translated, true);
  for (const line of lines) {
    const seg = segments.find(item => item.text === line);
    assert.equal(snapshot.existingTranslations.get(seg.id), line, `"${line}" is kept as its own translation`);
  }
});

test('a short katakana onomatopoeia echoed unchanged twice in a row is accepted, not repaired a third time', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const asked = [];
  const context = mockHost([], {
    generateRaw: ({ prompt }) => {
      asked.push(JSON.stringify(prompt));
      return Promise.resolve(JSON.stringify([{ id: 1, text: 'ドキドキ' }]));
    },
  });
  const settings = __testing.configureForTest({ settings: { apiMode: 'follow', streamingWriteback: false, retries: 1 }, initialized: true });
  context.chat.push({ mes: '<story_scene>\nドキドキ\n</story_scene>', swipe_id: 0, extra: {} });
  const result = await __testing.startTranslation(0, { quiet: true, force: false });
  // Primary request, then one repair: the repair's answer matches the primary's, and that second match
  // is what accepts it, never a third request.
  assert.equal(asked.length, 2);
  assert.equal(result.skipped, false);
  assert.equal(result.partial, undefined, 'the floor is written back complete, not left partial');
  const snapshot = await __testing.readMessageSnapshot(0, settings);
  assert.equal(snapshot.translated, true);
  assert.equal(snapshot.existingTranslations.get(1), 'ドキドキ');
});

test('a long segment echoed unchanged twice in a row stays missing, never silently accepted', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const asked = [];
  const longLine = '雨が降っていて、風も強くなってきた。';
  const context = mockHost([], {
    generateRaw: ({ prompt }) => {
      asked.push(JSON.stringify(prompt));
      return Promise.resolve(JSON.stringify([
        { id: 1, text: '天气晴朗。' },
        { id: 2, text: longLine },
      ]));
    },
  });
  const settings = __testing.configureForTest({ settings: { apiMode: 'follow', streamingWriteback: false, retries: 1 }, initialized: true });
  context.chat.push({ mes: `<story_scene>\n天気がいい。\n\n${longLine}\n</story_scene>`, swipe_id: 0, extra: {} });
  const result = await __testing.startTranslation(0, { quiet: true, force: false });
  // Primary request, then the one repair the retry budget allows; over the 8-letter ceiling, a second
  // matching echo is never enough to accept it.
  assert.equal(asked.length, 2);
  assert.equal(result.skipped, false);
  assert.equal(result.partial, true, 'never silently accepted: the floor is written back partial');
  const snapshot = await __testing.readMessageSnapshot(0, settings);
  assert.equal(snapshot.translated, false);
  assert.equal(snapshot.existingTranslations.has(2), false, 'the long segment is not written down as if it were a translation');
  assert.equal(snapshot.existingTranslations.get(1), '天气晴朗。', 'the ordinary paragraph beside it still translated normally');
});

test('补译缺失段落 completes a floor left partial on an echoed interjection, without a second failing request', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const asked = [];
  const context = mockHost([], {
    generateRaw: ({ prompt }) => {
      asked.push(JSON.stringify(prompt));
      return Promise.resolve(JSON.stringify([{ id: 2, text: '「……っ」' }]));
    },
  });
  const settings = __testing.configureForTest({ settings: { apiMode: 'follow', streamingWriteback: false, retries: 1 }, initialized: true });
  const source = '雨が降っている。\n\n「……っ」';
  const segmented = segmentSource(source, settings);
  // What a floor left behind before this fix: the ordinary line translated, the echoed interjection
  // dropped by the old untranslated-echo check and never recovered, so the write-back was partial.
  const partial = assembleBilingual(segmented.layout, new Map([[1, '下雨了。']]), { ...settings, allowMissing: true });
  const inner = `\n${partial}\n`;
  context.chat.push({
    mes: `<story_scene>${inner}</story_scene>`,
    swipe_id: 0,
    extra: {
      [MESSAGE_META_KEY]: {
        schema_version: 4, swipe_id: 0, complete: false, missing_ids: [2],
        source_hash: await hashText(createTranslationSignature([{ tagName: 'story_scene', segments: segmentSource(inner, settings).segments }])),
        segment_prefix: settings.segmentPrefix ?? '', segment_suffix: settings.segmentSuffix ?? '',
        translation_prefix: settings.translationPrefix ?? '{', translation_suffix: settings.translationSuffix ?? '}',
        paragraph_per_line: false,
      },
    },
  });
  // The button itself asks for nothing more than a normal, unforced translate: readMessageSnapshot's
  // own seeding already sends only what has no translation yet (see the "补译 asks only" test above).
  const result = await __testing.startTranslation(0, { quiet: true, force: false });
  assert.equal(asked.length, 1, 'accepted on this one request, no second, failing repair request follows');
  assert.equal(result.skipped, false);
  assert.equal(result.partial, undefined, 'the floor now reports complete');
  assert.match(context.chat[0].mes, /「……っ」/);
  const snapshot = await __testing.readMessageSnapshot(0, settings);
  assert.equal(snapshot.translated, true);
});

// ---------------------------------------------------------------------------------------------
// Reviewer follow-up on the echo fix above: the two-echo rule (core.js's isShortExactEcho) was wide
// enough to accept a real short sentence, name or greeting the model was simply too lazy to translate,
// not only a gasp or an onomatopoeia — and the confirming second request could be starved by a shared
// retry budget, or never sent at all once streaming or retries: 0 were involved. See core.js's
// isShortExactEcho/isTrivialInterjectionSource and index.js's translateOneBatch/translateMessageStreaming.
// ---------------------------------------------------------------------------------------------

test('two real short kana phrases echoed twice in a row are never written down as their own translation', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const asked = [];
  const context = mockHost([], {
    generateRaw: ({ prompt }) => {
      const input = JSON.parse(prompt.at(-1).content);
      asked.push(input.segments.map(segment => segment.id));
      // Line 1 translates normally; ありがとう and ごめんなさい — real, ordinary, kana-only lines with
      // no Han in them, so the old rule's Han check alone did not save them — come back unchanged
      // every time, the way a lazy model answers a short line it could have just translated.
      return Promise.resolve(JSON.stringify(input.segments.map(segment => ({
        id: segment.id,
        text: segment.id === 1 ? '下雨了。' : segment.text,
      }))));
    },
  });
  const settings = __testing.configureForTest({ settings: { apiMode: 'follow', streamingWriteback: false, retries: 1 }, initialized: true });
  context.chat.push({ mes: '<story_scene>\n雨が降っている。\n\nありがとう\n\nごめんなさい\n</story_scene>', swipe_id: 0, extra: {} });
  const result = await __testing.startTranslation(0, { quiet: true, force: false });
  assert.ok(asked.length > 0);
  assert.equal(result.skipped, false);
  assert.equal(result.partial, true, 'a real "thank you" or "sorry" echoed twice is still a translation failure, never accepted as itself');
  const snapshot = await __testing.readMessageSnapshot(0, settings);
  assert.equal(snapshot.translated, false);
  assert.equal(snapshot.existingTranslations.get(1), '下雨了。', 'the ordinary line beside them still translated normally');
  assert.equal(snapshot.existingTranslations.has(2), false, 'ありがとう is never written down as its own translation');
  assert.equal(snapshot.existingTranslations.has(3), false, 'ごめんなさい is never written down as its own translation');
});

test('two onomatopoeia segments split across concurrent lanes are both confirmed, not only whichever lane spent the one shared retry', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const context = mockHost([], {
    generateRaw: ({ prompt }) => {
      const input = JSON.parse(prompt.at(-1).content);
      // Every request is answered with an exact echo of whatever it asked for.
      return Promise.resolve(JSON.stringify(input.segments.map(segment => ({ id: segment.id, text: segment.text }))));
    },
  });
  const settings = __testing.configureForTest({
    settings: {
      apiMode: 'follow', streamingWriteback: false, retries: 1,
      channels: [{ id: 'default', maxTokens: 4096, timeoutSec: 30, concurrency: 2 }],
    },
    initialized: true,
  });
  context.chat.push({ mes: '<story_scene>\nドキドキ\n\nワクワク\n</story_scene>', swipe_id: 0, extra: {} });
  const result = await __testing.startTranslation(0, { quiet: true, force: false });
  assert.equal(result.skipped, false);
  assert.equal(result.partial, undefined, 'both onomatopoeia lines are accepted — the confirming request is free, not charged to the one shared retry');
  const snapshot = await __testing.readMessageSnapshot(0, settings);
  assert.equal(snapshot.translated, true);
  assert.equal(snapshot.existingTranslations.get(1), 'ドキドキ');
  assert.equal(snapshot.existingTranslations.get(2), 'ワクワク');
});

test('an onomatopoeia accepted after two echoes keeps the speaker/emotion mark it was returned with', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const context = mockHost([], {
    generateRaw: ({ prompt }) => {
      const input = JSON.parse(prompt.at(-1).content);
      const items = input.segments.map(segment => (segment.id === 1
        ? { id: 1, text: '天气真好。', speaker: '英梨梨', emotion: 'happy' }
        : { id: segment.id, text: segment.text, speaker: '英梨梨', emotion: 'whisper' }));
      return Promise.resolve(JSON.stringify(items));
    },
  });
  const settings = __testing.configureForTest({
    settings: { ...coloringSettings, apiMode: 'follow', streamingWriteback: false, retries: 1 },
    initialized: true,
  });
  context.chat.push({ mes: '<story_scene>\n天気がいい。\n\nドキドキ\n</story_scene>', swipe_id: 0, extra: {} });
  const result = await __testing.startTranslation(0, { quiet: true, force: false });
  assert.equal(result.skipped, false);
  assert.equal(result.partial, undefined);
  const snapshot = await __testing.readMessageSnapshot(0, settings);
  assert.equal(snapshot.existingAnnotations.get(1)?.speaker, '英梨梨');
  assert.equal(snapshot.existingAnnotations.get(2)?.speaker, '英梨梨', 'the accepted echo keeps the speaker mark it was returned with, not just its text');
  assert.equal(snapshot.existingAnnotations.get(2)?.emotion, 'whisper');
});

test('a run that succeeds by accepting an echoed onomatopoeia leaves no error-level diagnostic behind', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  clearDiagnostics();
  const context = mockHost([], {
    generateRaw: ({ prompt }) => {
      const input = JSON.parse(prompt.at(-1).content);
      return Promise.resolve(JSON.stringify(input.segments.map(segment => ({
        id: segment.id,
        text: segment.id === 1 ? '天气真好。' : segment.text,
      }))));
    },
  });
  const settings = __testing.configureForTest({ settings: { apiMode: 'follow', streamingWriteback: false, retries: 1 }, initialized: true });
  context.chat.push({ mes: '<story_scene>\n天気がいい。\n\nドキドキ\n</story_scene>', swipe_id: 0, extra: {} });
  const result = await __testing.startTranslation(0, { quiet: true, force: false });
  assert.equal(result.skipped, false);
  assert.equal(result.partial, undefined);
  const errors = readDiagnostics().filter(entry => entry.level === 'error');
  assert.deepEqual(errors, [], 'the run succeeded by recognising an echo; nothing in its own log should read as a failure');
});

test('a streamed echo is remembered across the whole-request repair, settling in one repair call instead of two', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const message = { mes: '<story_scene>\n天気がいい。\n\nドキドキ\n</story_scene>', swipe_id: 0 };
  const repairs = [];
  mockHost([message], {
    ChatCompletionService: {
      async processRequest(payload) {
        const input = JSON.parse(payload.messages.at(-1).content);
        repairs.push(input.segments.map(segment => segment.id));
        return { content: JSON.stringify(input.segments.map(segment => ({ id: segment.id, text: 'ドキドキ' }))) };
      },
    },
  });
  __testing.configureForTest({
    settings: { ...streamingSettings, retries: 1, channels: [{ ...streamingSettings.channels[0], concurrency: 1 }] },
    initialized: true,
  });
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(JSON.parse(init.body).messages.at(-1).content);
    const payload = JSON.stringify(input.segments.map(segment => ({
      id: segment.id,
      text: segment.id === 1 ? '天气真好。' : 'ドキドキ',
    })));
    return sseResponse([`data: ${JSON.stringify({ choices: [{ delta: { content: payload } }] })}\n\n`, 'data: [DONE]\n\n']);
  };
  const result = await __testing.startTranslation(0, { quiet: true, force: true });
  assert.equal(result.skipped, false);
  assert.equal(repairs.length, 1, 'the streamed echo already counts as the first sighting, so one whole-request repair confirms it, not a second one');
  assert.match(message.mes, /ドキドキ/);
  assert.equal(message.extra[MESSAGE_META_KEY].complete, true);
});

test('at retries 0, a streamed echo is still confirmed through one free whole-request repair, not left missing forever', async t => {
  const previousHost = globalThis.SillyTavern;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.SillyTavern = previousHost; globalThis.fetch = previousFetch; });
  const message = { mes: '<story_scene>\n天気がいい。\n\nドキドキ\n</story_scene>', swipe_id: 0 };
  const repairs = [];
  mockHost([message], {
    ChatCompletionService: {
      async processRequest(payload) {
        const input = JSON.parse(payload.messages.at(-1).content);
        repairs.push(input.segments.map(segment => segment.id));
        return { content: JSON.stringify(input.segments.map(segment => ({ id: segment.id, text: 'ドキドキ' }))) };
      },
    },
  });
  __testing.configureForTest({
    settings: { ...streamingSettings, retries: 0, channels: [{ ...streamingSettings.channels[0], concurrency: 1 }] },
    initialized: true,
  });
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(JSON.parse(init.body).messages.at(-1).content);
    const payload = JSON.stringify(input.segments.map(segment => ({
      id: segment.id,
      text: segment.id === 1 ? '天气真好。' : 'ドキドキ',
    })));
    return sseResponse([`data: ${JSON.stringify({ choices: [{ delta: { content: payload } }] })}\n\n`, 'data: [DONE]\n\n']);
  };
  const result = await __testing.startTranslation(0, { quiet: true, force: true });
  assert.equal(result.skipped, false);
  assert.equal(repairs.length, 1, 'retries: 0 still allows the one free confirming request — it never spends the (empty) retry budget');
  assert.match(message.mes, /ドキドキ/);
  assert.equal(message.extra[MESSAGE_META_KEY].complete, true, 'no longer stuck partial forever just because retries is 0');
});

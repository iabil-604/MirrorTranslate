import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MESSAGE_META_KEY,
  assembleBilingual,
  assembleTranslationOnly,
  createTranslationSignature,
  hashText,
  hashTextSync,
  segmentSource,
} from '../core.js';
import { __testing } from '../index.js';

// What would be a toast in the host is dropped here rather than printed.
globalThis.toastr ??= Object.fromEntries(['success', 'error', 'warning', 'info'].map(kind => [kind, () => {}]));

function mockHost(chat = []) {
  const context = {
    chat,
    chatId: 'floor-clear-fixture',
    extensionSettings: {},
    characters: [{ name: '樱井', avatar: 'sakurai.png' }],
    characterId: 0,
    substituteParams: value => value,
    saveChat: async () => {},
    updateMessageBlock: () => {},
    getRequestHeaders: () => ({}),
    saveSettingsDebounced: () => {},
    eventTypes: {},
    eventSource: { emit: async () => {}, on: () => {}, removeListener: () => {} },
  };
  globalThis.SillyTavern = { getContext: () => context };
  __testing.initializeSettings();
  return context;
}

async function translatedFloor(source, translations, settings) {
  const segmented = segmentSource(source, settings);
  const inner = `\n${assembleBilingual(segmented.layout, new Map(translations), settings)}\n`;
  const mes = `<story_scene>${inner}</story_scene>`;
  return {
    mes,
    swipe_id: 0,
    swipes: [mes],
    swipe_info: [{ extra: {} }],
    extra: {
      [MESSAGE_META_KEY]: {
        schema_version: 4,
        swipe_id: 0,
        complete: true,
        source_hash: await hashText(createTranslationSignature([{ tagName: 'story_scene', segments: segmentSource(inner, settings).segments }])),
        segment_prefix: settings.segmentPrefix ?? '',
        segment_suffix: settings.segmentSuffix ?? '',
        translation_prefix: settings.translationPrefix ?? '{',
        translation_suffix: settings.translationSuffix ?? '}',
        paragraph_per_line: settings.paragraphPerLine ?? false,
        annotations: {},
      },
    },
  };
}

// A finished 只留译文 floor, built by hand the way core.test.mjs does it — no model call needed.
function strippedFloor(source, translations, settings) {
  const layout = segmentSource(source, settings).layout;
  const map = new Map(translations);
  const mirror = `<story_scene>${assembleBilingual(layout, map, settings)}</story_scene>`;
  const projection = `<story_scene>${assembleTranslationOnly(layout, map, settings)}</story_scene>`;
  const meta = {
    schema_version: 4, swipe_id: 0, complete: true, stripped: true, mirror,
    projection_hash: hashTextSync(projection),
    translation_prefix: settings.translationPrefix ?? '{', translation_suffix: settings.translationSuffix ?? '}',
    annotations: {},
  };
  return { mes: projection, swipe_id: 0, swipes: [projection], swipe_info: [{ extra: { [MESSAGE_META_KEY]: meta } }], extra: { [MESSAGE_META_KEY]: meta } };
}

function restoreGlobals(t) {
  const host = globalThis.SillyTavern;
  const toastrBefore = globalThis.toastr;
  t.after(() => {
    globalThis.SillyTavern = host;
    globalThis.toastr = toastrBefore;
  });
}

test('清除这一楼的译文: a bilingual floor goes back to its plain original, and the swipe’s metadata is gone', async t => {
  restoreGlobals(t);
  const context = mockHost();
  const settings = __testing.configureForTest({ settings: {}, initialized: true });
  const source = '雨が降っている。\n\n「来たんだね」';
  context.chat.push(await translatedFloor(source, [[1, '下着雨。'], [2, '「你来了啊」']], settings));
  const message = context.chat[0];
  assert.match(message.mes, /下着雨/);

  const result = await __testing.clearFloorTranslation(0, { ask: () => true });
  assert.equal(result.cleared, true);
  const plain = `<story_scene>\n${source}\n</story_scene>`;
  assert.equal(message.mes, plain);
  assert.equal(message.swipes[0], plain);
  assert.equal(message.extra[MESSAGE_META_KEY], undefined);
  assert.equal(message.swipe_info[0].extra[MESSAGE_META_KEY], undefined);

  const snapshot = await __testing.readMessageSnapshot(0, settings);
  assert.equal(snapshot.translated, false, 'auto-translate would see a fresh floor, not one with gaps');
  assert.equal(snapshot.existingTranslations.size, 0);
});

test('清除这一楼的译文: a 只留译文 floor is restored from its mirror, not left bilingual', async t => {
  restoreGlobals(t);
  const context = mockHost();
  const settings = __testing.configureForTest({ settings: {}, initialized: true });
  const source = '\n雨が降っている。\n';
  context.chat.push(strippedFloor(source, [[1, '下雨了。']], settings));
  const message = context.chat[0];

  const result = await __testing.clearFloorTranslation(0, { ask: () => true });
  assert.equal(result.cleared, true);
  assert.equal(message.mes, '<story_scene>\n雨が降っている。\n</story_scene>');
  assert.equal(message.extra[MESSAGE_META_KEY], undefined);
  assert.equal(message.swipe_info[0].extra[MESSAGE_META_KEY], undefined);
});

test('清除这一楼的译文: declining the confirm changes nothing, and a never-translated floor is never even asked', async t => {
  restoreGlobals(t);
  const context = mockHost();
  const settings = __testing.configureForTest({ settings: {}, initialized: true });
  context.chat.push(await translatedFloor('雨が降っている。', [[1, '下雨了。']], settings));
  const before = context.chat[0].mes;

  const declined = await __testing.clearFloorTranslation(0, { ask: () => false });
  assert.deepEqual(declined, { cleared: false, cancelled: true, messageId: 0 });
  assert.equal(context.chat[0].mes, before);

  const untouched = '<story_scene>\n雨が降っている。\n</story_scene>';
  context.chat.push({ mes: untouched, swipe_id: 0, swipes: [untouched], swipe_info: [{ extra: {} }], extra: {} });
  let asked = false;
  const result = await __testing.clearFloorTranslation(1, { ask: () => { asked = true; return true; } });
  assert.equal(result.cleared, false);
  assert.equal(asked, false, 'nothing to clear, so the reader is never interrupted for a confirmation');
  assert.equal(context.chat[1].mes, untouched);
});

test('清除这一楼的译文: a floor changed by hand after 只留译文 refuses to clear, the same way it refuses to translate', async t => {
  restoreGlobals(t);
  const context = mockHost();
  const settings = __testing.configureForTest({ settings: {}, initialized: true });
  context.chat.push(strippedFloor('\n雨が降っている。\n', [[1, '下雨了。']], settings));
  const message = context.chat[0];
  message.mes = message.mes.replace('下雨了。', '下大雨了。');
  message.swipes[0] = message.mes;

  await assert.rejects(__testing.clearFloorTranslation(0, { ask: () => true }), /只留了译文.*改过/);
  assert.match(message.mes, /下大雨了/, 'the hand edit is left exactly as it was');
});

test('清除这一楼的译文: a swipe while the confirm is open aborts instead of writing the old page’s original over the new one', async t => {
  restoreGlobals(t);
  const context = mockHost();
  const settings = __testing.configureForTest({ settings: {}, initialized: true });
  // Two independently translated swipes on the same floor — page 0 shown first, page 1 confirmed on.
  const page0 = await translatedFloor('朝だ。', [[1, '早上了。']], settings);
  const page1 = await translatedFloor('雨が降っている。', [[1, '下着雨。']], settings);
  const message = {
    mes: page1.mes,
    swipe_id: 1,
    swipes: [page0.mes, page1.mes],
    swipe_info: [{ extra: { ...page0.extra } }, { extra: { ...page1.extra } }],
    extra: { ...page1.extra },
  };
  context.chat.push(message);
  const beforePage0Mes = message.swipes[0];
  const beforePage0Extra = message.swipe_info[0].extra;

  // The confirm opens on page 1; while it waits for an answer, the reader swipes left to page 0 — the
  // same sequence SillyTavern's own swipe() runs (script.js syncMesToSwipe then syncSwipeToMes), which
  // reaches the floor because the confirm dialog's shadow host does not swallow arrow keys (index.js
  // issue "清除这一楼的译文：确认框开着时按方向键…").
  const ask = async () => {
    message.swipes[1] = message.mes;
    message.swipe_info[1] = { ...message.swipe_info[1], extra: { ...message.extra } };
    message.swipe_id = 0;
    message.mes = message.swipes[0];
    message.extra = { ...message.swipe_info[0].extra };
    return true;
  };

  await assert.rejects(__testing.clearFloorTranslation(0, { ask }), /在确认清除的时候变了/);

  // Page 0 — the one actually showing once the confirm resolved — keeps exactly what the swipe left it:
  // still translated (not overwritten with page 1's plain original) and still carrying its own record.
  assert.equal(message.swipe_id, 0);
  assert.equal(message.mes, beforePage0Mes);
  assert.match(message.mes, /早上了/, 'page 0 stays translated, not replaced by page 1’s original');
  assert.notEqual(message.extra[MESSAGE_META_KEY], undefined, 'page 0’s own translation record survives');
  assert.equal(message.swipes[0], beforePage0Mes);
  assert.deepEqual(message.swipe_info[0].extra, beforePage0Extra);
  // Page 1 (no longer shown) is untouched too — the clear never reached the write phase at all.
  assert.equal(message.swipes[1], page1.mes);
});

test('autoTranslateSuppressed: holds while the cleared text is still on the floor, and steps aside once it changes', async t => {
  restoreGlobals(t);
  const context = mockHost();
  const settings = __testing.configureForTest({ settings: {}, initialized: true });
  context.chat.push(await translatedFloor('雨が降っている。', [[1, '下雨了。']], settings));
  await __testing.clearFloorTranslation(0, { ask: () => true });
  const message = context.chat[0];

  assert.equal(__testing.autoTranslateSuppressed(0), true, 'the text is still exactly what clearing left');
  assert.equal(__testing.autoTranslateSuppressed(0), true, 'checking again does not itself lift the guard');

  message.mes = `${message.mes}\n続き。`;
  assert.equal(__testing.autoTranslateSuppressed(0), false, 'the floor moved on — a continuation, say');
  assert.equal(__testing.autoTranslateSuppressed(0), false, 'the guard let go of the key, so it stays lifted');
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MESSAGE_META_KEY,
  assembleBilingual,
  createTranslationSignature,
  hashText,
  normalizeChannel,
  segmentSource,
} from '../core.js';
import { __testing } from '../index.js';

// The host pieces a floor edit touches, with a chat of its own.
function mockHost(chatId, { processRequest } = {}) {
  const toasts = [];
  globalThis.toastr = Object.fromEntries(['success', 'error', 'warning', 'info'].map(kind => [kind, message => toasts.push([kind, message])]));
  const context = {
    chat: [],
    chatId,
    name1: '玩家',
    name2: '樱井',
    extensionSettings: {},
    characters: [{ name: '樱井', avatar: 'sakurai.png', description: '', personality: '', scenario: '' }],
    characterId: 0,
    substituteParams: value => value,
    saveChat: async () => {},
    updateMessageBlock: () => {},
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    saveSettingsDebounced: () => {},
    eventTypes: {},
    eventSource: { emit: async () => {}, on: () => {}, removeListener: () => {} },
    ChatCompletionService: { processRequest: processRequest ?? (async () => ({ content: '{}' })) },
  };
  globalThis.SillyTavern = { getContext: () => context };
  __testing.initializeSettings();
  return { context, toasts };
}

async function translatedFloor(source, translations, settings) {
  const segmented = segmentSource(source, settings);
  const inner = `\n${assembleBilingual(segmented.layout, new Map(translations), settings)}\n`;
  return {
    mes: `<story_scene>${inner}</story_scene>`,
    swipe_id: 0,
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
        annotations: { 2: { speaker: '樱井', emotion: 'happy', intensity: 1 } },
      },
    },
  };
}

const CHANNEL = normalizeChannel({ id: 'c1', name: 'test', url: 'https://relay.example/v1', key: 'k', model: 'translator' });

function restoreGlobals(t) {
  const host = globalThis.SillyTavern;
  const toastrBefore = globalThis.toastr;
  t.after(() => {
    globalThis.SillyTavern = host;
    globalThis.toastr = toastrBefore;
  });
}

test('one paragraph can be rewritten by hand, and one paragraph can be sent back to the model on its own', async t => {
  restoreGlobals(t);
  const requests = [];
  const { context } = mockHost('floor-edit', {
    async processRequest(payload) {
      const body = JSON.parse(payload.messages.at(-1).content);
      requests.push(body.segments.map(segment => segment.id));
      return { content: `\`\`\`json\n${JSON.stringify({ translations: body.segments.map(segment => ({ id: segment.id, text: `模型译文${segment.id}` })) })}\n\`\`\`` };
    },
  });
  const settings = __testing.configureForTest({ settings: { apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1' }, initialized: true });
  context.chat.push(await translatedFloor('雨が降っている。\n\n「来たんだね」', [[1, '下着雨。'], [2, '「你来了啊」']], settings));

  // A hand edit changes that paragraph and nothing else; the labels stay.
  const written = await __testing.editTranslationSegment(0, 2, '  「你来了呀」  ');
  assert.equal(written.complete, true);
  let snapshot = await __testing.readMessageSnapshot(0, settings);
  assert.deepEqual([...snapshot.existingTranslations], [[1, '下着雨。'], [2, '「你来了呀」']]);
  assert.equal(snapshot.existingAnnotations.get(2)?.speaker, '樱井', 'the label survives the edit');
  assert.equal(snapshot.translated, true);
  await assert.rejects(__testing.editTranslationSegment(0, 2, '   '), /不能是空的/);
  await assert.rejects(__testing.editTranslationSegment(0, 9, '多出来的'), /已经变了/);

  // A finished floor is left alone unless a paragraph is asked for by itself.
  const skipped = await __testing.translateMessage(0, { force: false, quiet: true });
  assert.equal(skipped.skipped, true);
  assert.equal(requests.length, 0);
  const result = await __testing.translateMessage(0, { only: new Set([1]), quiet: true });
  assert.equal(result.skipped, false);
  assert.deepEqual(requests, [[1]], 'only the paragraph asked for went to the model');
  snapshot = await __testing.readMessageSnapshot(0, settings);
  assert.deepEqual([...snapshot.existingTranslations], [[1, '模型译文1'], [2, '「你来了呀」']], 'the hand edit of the other paragraph stays');
});

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
import { mixDialogueFromSource, splitByPairs } from '../tts.js';
import { __testing } from '../index.js';

// ---------------------------------------------------------------------------------------------
// mixDialogueFromSource: the pure text-composition step behind 对白读原文 — narration keeps the
// translation's own words, every quoted run is swapped for the original's run at the same position.
// ---------------------------------------------------------------------------------------------

test('mixDialogueFromSource keeps the narration and swaps only the quoted runs', () => {
  const mixed = mixDialogueFromSource('樱井抬头看着天空，觉得有点晒。「今天真热啊」', '桜井は空を見上げた。「今日は暑いね」');
  assert.equal(mixed, '樱井抬头看着天空，觉得有点晒。「今日は暑いね」');
  // The quoted run keeps the count and order splitByPairs would find on the translation alone: one
  // narration run, one quoted run — the same shape a mark placed on the translation already expects.
  const parts = splitByPairs(mixed);
  assert.deepEqual(parts.map(part => part.kind), ['narration', 'quoted']);
});

test('mixDialogueFromSource leaves a purely narrated line untouched', () => {
  assert.equal(mixDialogueFromSource('外面下着雨。', '外は雨が降っている。'), '外面下着雨。');
});

test('mixDialogueFromSource keeps a straight-quoted English run as the original wrote it', () => {
  const mixed = mixDialogueFromSource('汤姆笑着点了点头，用英语回答。「的确如此。」', '汤姆笑着点头。"Indeed it is."');
  assert.equal(mixed, '汤姆笑着点了点头，用英语回答。"Indeed it is."');
});

test('mixDialogueFromSource falls back to the translation\'s own words where the original has fewer quoted runs', () => {
  // The translator split one line of dialogue into two; the original only has the first.
  const mixed = mixDialogueFromSource('她转过身。「走吧」她又说：「别回头」', '她转过身。「行了，走吧，别回头」');
  const parts = splitByPairs(mixed).filter(part => part.kind === 'quoted');
  assert.equal(parts.length, 2);
  assert.equal(parts[0].text, '「行了，走吧，别回头」', 'the one original run goes to the first quoted run');
  assert.equal(parts[1].text, '「别回头」', 'past the shorter list, the translation keeps its own words rather than guessing');
});

test('mixDialogueFromSource keeps every quoted run when the original has no text at all', () => {
  const mixed = mixDialogueFromSource('她说：「你好」', '');
  assert.equal(mixed, '她说：「你好」');
});

// ---------------------------------------------------------------------------------------------
// Integration: 对白读原文 through collectTtsFloor and prepareTtsSegments.
// ---------------------------------------------------------------------------------------------

function mockHost(chatId) {
  const otherFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes('chat-completions/generate')) return otherFetch ? otherFetch(url, init) : new Response('', { status: 404 });
    return new Response('', { status: 500 });
  };
  const context = {
    chat: [],
    chatId,
    name1: '玩家',
    name2: '桜井',
    extensionSettings: {},
    characters: [{ name: '桜井', avatar: 'sakurai.png', description: '', personality: '', scenario: '' }, { name: '汤姆', avatar: 'tom.png', description: '', personality: '', scenario: '' }],
    characterId: 0,
    substituteParams: value => value,
    saveChat: async () => {},
    updateMessageBlock: () => {},
    getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'host-token' }),
    saveSettingsDebounced: () => {},
    eventTypes: {},
    eventSource: { emit: () => {}, on: () => {}, removeListener: () => {} },
  };
  globalThis.SillyTavern = { getContext: () => context };
  __testing.initializeSettings();
  return { context };
}

function restoreGlobals(t) {
  const host = globalThis.SillyTavern;
  const fetchBefore = globalThis.fetch;
  t.after(() => {
    globalThis.SillyTavern = host;
    globalThis.fetch = fetchBefore;
  });
}

async function translatedFloor(source, translations, settings, annotations = undefined) {
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
        ...(annotations ? { annotations } : {}),
      },
    },
  };
}

const FISH = { key: 'sk-test', viaProxy: true };
const CHANNEL = normalizeChannel({ id: 'c1', name: 'test', url: 'https://relay.example/v1', key: 'k', model: 'labeler' });

// One message, two paragraphs: a Japanese line of dialogue and an English one, each inside narration
// the translation wrote differently from the original — so a passing test can only be reading the
// original's own words inside the quotes, never a coincidence of them matching the translation.
const SOURCE = '桜井は空を見上げた。「今日は暑いね」\n\n汤姆笑着点头。"Indeed it is."';
const TRANSLATIONS = [
  [1, '樱井抬头看着天空，觉得有点晒。「今天真热啊」'],
  [2, '汤姆笑着点了点头，用英语回答。「的确如此。」'],
];
const ANNOTATIONS = {
  1: { speaker: '樱井', quotes: [{ head: '今天', speaker: '樱井', emotion: 'happy' }] },
  2: { speaker: '汤姆', quotes: [{ head: '的确', speaker: '汤姆', emotion: 'calm', pauses: [{ after: '的确', length: 'short' }] }] },
};

test('对白读原文: narration reads the translation, each quoted run reads the original in its own language', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-dialogue-source');
  const settings = __testing.configureForTest({
    settings: {
      apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1',
      tts: { enabled: true, mode: 'off', side: 'dialogue_source', fish: FISH },
    },
  });
  context.chat.push(await translatedFloor(SOURCE, TRANSLATIONS, settings, ANNOTATIONS));

  const floor = await __testing.collectTtsFloor(0, settings);
  assert.equal(floor.side, 'dialogue_source');
  assert.equal(floor.floorId, 'tts-dialogue-source|0|0|dialogue_source');
  // The floor's own lines are already the mixed text: this is what every request unit (floor / line /
  // sentence) and the on-page anchor search both work from downstream, unchanged.
  assert.deepEqual(floor.lines, [
    { lineId: 1, text: '樱井抬头看着天空，觉得有点晒。「今日は暑いね」' },
    { lineId: 2, text: '汤姆笑着点了点头，用英语回答。"Indeed it is."' },
  ]);

  const { segments } = await __testing.prepareTtsSegments(floor, settings);
  // One reading, floor order: narration then dialogue for each paragraph in turn, never all of one
  // language followed by all of the other the way 两种都读 reads its two floors.
  assert.deepEqual(segments.map(item => item.lineId), [1, 1, 2, 2]);
  assert.deepEqual(segments.map(item => [item.type, item.speaker, item.text, item.lang]), [
    ['narration', 'narrator', '樱井抬头看着天空，觉得有点晒。', 'zh'],
    ['dialogue', '樱井', '今日は暑いね', 'ja'],
    ['narration', 'narrator', '汤姆笑着点了点头，用英语回答。', 'zh'],
    ['dialogue', '汤姆', 'Indeed it is.', 'en'],
  ]);
  // Speaker and mood came from the translation's own marks, carried over by deriveLabelsForSide.
  assert.deepEqual(segments.map(item => item.emotion), [null, 'happy', null, 'calm']);
  // A pause names a word of the translation's text ('的确'); it is not sent onto a sentence written in
  // another language, the same rule 两种都读 already keeps for its own secondary side.
  assert.equal(segments[3].voice?.pauses, undefined, 'a word-anchored field of the translation does not ride onto the original\'s sentence');

  // The same pause is not lost for an ordinary reading of the translation: it survives there.
  const translationFloor = await __testing.collectTtsFloor(0, settings, 'translation');
  const translationRead = await __testing.prepareTtsSegments(translationFloor, settings);
  const pausedSegment = translationRead.segments.find(item => item.text.startsWith('的确'));
  assert.deepEqual(pausedSegment?.voice?.pauses, [{ after: '的确', length: 'short' }]);

  // The inspector's reference line resolves too, for the original-text echo beside a sentence.
  const inspected = await __testing.ttsInspect(0, segments[1].id, 'dialogue_source');
  assert.match(inspected.original ?? '', /桜井は空を見上げた/);
});

test('对白读原文 has no floor before the message is translated', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-dialogue-source-untranslated');
  const settings = __testing.configureForTest({
    settings: { tts: { enabled: true, mode: 'off', side: 'dialogue_source', fish: FISH } },
  });
  context.chat.push({ mes: '<story_scene>\n桜井は空を見上げた。\n</story_scene>', swipe_id: 0, extra: {} });
  assert.equal(await __testing.collectTtsFloor(0, settings), null);
});

// A lyric line (v0.37.0) defaults out of every reading, the same as a plain or 读原文 floor already
// skips it (see collectTtsFloor's 'source' and 'translation' branches) — this is the one place the two
// features meet, so it gets its own coverage rather than trusting the two branches agree by accident.
test('对白读原文 skips a lyric line, the same as plain and 读原文 reading already do', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-dialogue-source-lyric');
  const settings = __testing.configureForTest({
    settings: {
      apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1',
      lyricLineRules: 'そらにひびけ',
      tts: { enabled: true, mode: 'off', side: 'dialogue_source', fish: FISH },
    },
  });
  const source = '桜井は空を見上げた。「今日は暑いね」\n\nそらにひびけ\n\n汤姆笑着点头。"Indeed it is."';
  context.chat.push(await translatedFloor(source, [
    [1, '樱井抬头看着天空，觉得有点晒。「今天真热啊」'],
    [2, '响彻天空'],
    [3, '汤姆笑着点了点头，用英语回答。「的确如此。」'],
  ], settings));

  const floor = await __testing.collectTtsFloor(0, settings);
  assert.equal(floor.side, 'dialogue_source');
  assert.deepEqual(floor.lines.map(line => line.lineId), [1, 3], 'the lyric line (id 2) never becomes a reading line');
  assert.deepEqual(floor.lines, [
    { lineId: 1, text: '樱井抬头看着天空，觉得有点晒。「今日は暑いね」' },
    { lineId: 3, text: '汤姆笑着点了点头，用英语回答。"Indeed it is."' },
  ]);
});

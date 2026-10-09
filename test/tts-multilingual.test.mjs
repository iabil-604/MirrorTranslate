import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MESSAGE_META_KEY,
  assembleBilingual,
  createTranslationSignature,
  hashText,
  mergeSettings,
  normalizeChannel,
  segmentSource,
} from '../core.js';
import { audibleSegments, buildSegments, locateAnchors, mixDialogueFromSource, splitByPairs, splitUtterances } from '../tts.js';
import { __testing } from '../index.js';
import { readDiagnostics } from '../diagnostics.js';

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

test('mixDialogueFromSource keeps the translation\'s own line, whole, when the original split or joined the quoted runs differently', () => {
  // The translator split one line of dialogue into two; the original only has one quoted run. Pairing
  // by position would repeat 别回头 — once inside the one original run, once again from the
  // translation's own second run — so the whole line is kept as the translation wrote it instead.
  const mixed = mixDialogueFromSource('她转过身。「走吧。」她停了一下，又说：「别回头。」', '彼女は振り返った。「行こう、振り返るな」');
  assert.equal(mixed, '她转过身。「走吧。」她停了一下，又说：「别回头。」');
});

test('mixDialogueFromSource reports the mismatch it falls back on', () => {
  let report = null;
  mixDialogueFromSource('她转过身。「走吧。」她停了一下，又说：「别回头。」', '彼女は振り返った。「行こう、振り返るな」', {
    onMismatch: info => { report = info; },
  });
  assert.deepEqual(report, { targetCount: 2, sourceCount: 1 });
});

test('mixDialogueFromSource does not report a mismatch, and does not call onMismatch, when the counts agree', () => {
  let called = false;
  mixDialogueFromSource('樱井抬头看着天空，觉得有点晒。「今天真热啊」', '桜井は空を見上げた。「今日は暑いね」', {
    onMismatch: () => { called = true; },
  });
  assert.equal(called, false);
});

test('mixDialogueFromSource folds a title quoted mid-sentence into narration on both sides, rather than pairing it as a line of dialogue', () => {
  // The original quotes a book title with 『』 (the default quote pair) inside the sentence; the
  // translation writes the same title with 《》, which is not a registered quote pair, so on the
  // translation's side it was never a quoted run to begin with. Folding the original's 『星の約束』
  // back into its own narration is what keeps the counts (1 or each side) in agreement, so the real
  // line of dialogue — 「第一章，出发。」 — is the one swapped, not the title.
  const mixed = mixDialogueFromSource(
    '她翻开《星之约》，轻声念道：「第一章，出发。」',
    '彼女は『星の約束』を開き、静かに言った：「第一章、旅立ち」',
  );
  assert.equal(mixed, '她翻开《星之约》，轻声念道：「第一章、旅立ち」');
});

test('mixDialogueFromSource keeps every quoted run when the original has no text at all', () => {
  const mixed = mixDialogueFromSource('她说：「你好」', '');
  assert.equal(mixed, '她说：「你好」');
});

test('mixDialogueFromSource folds an embedded quote — a shop sign, a title — on the narration side, so it is never read as dialogue in the wrong language', () => {
  // Both sides have one genuine line of dialogue and one embedded quote (a shop sign). Without
  // folding, splitByPairs alone would find two quoted runs on each side and pair them positionally,
  // handing the sign's foreign text to the narrator; folding first keeps the sign as narration text —
  // the translation's own words — on both sides, so its language is never even in question.
  const mixed = mixDialogueFromSource(
    '店门口那块“营业中”的牌子在风里晃着。“欢迎光临。”',
    '店の前の「オープン」の札が風に揺れていた。「いらっしゃい」',
  );
  // The swapped run keeps the source's own bracket style — it is the original's words, read as they
  // were written — while the folded sign keeps the translation's own curly quotes untouched.
  assert.equal(mixed, '店门口那块“营业中”的牌子在风里晃着。「いらっしゃい」');
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

// A translated floor's hidden runs (特效字 layer 3: a struck-through or painted-invisible span of the
// original, carried over as the translation's own `runs`) are dropped from what 读译文 hears already;
// 对白读原文's narration is derived from the same translation text and must drop the same words,
// rather than reading back something the reader can see was crossed out.
test('对白读原文 drops a hidden run from its narration, the same as 读译文 already does', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-dialogue-source-hidden-run');
  const settings = __testing.configureForTest({
    settings: {
      apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1',
      tts: { enabled: true, mode: 'off', side: 'dialogue_source', fish: FISH },
    },
  });
  const source = '桜井は<s>本当は怖かった</s>空を見上げた。「今日は暑いね」';
  const translations = [[1, '樱井其实很害怕，抬头看着天空。「今天真热啊」']];
  const annotations = { 1: { speaker: '樱井', runs: ['其实很害怕'] } };
  context.chat.push(await translatedFloor(source, translations, settings, annotations));

  const dialogueFloor = await __testing.collectTtsFloor(0, settings);
  assert.doesNotMatch(dialogueFloor.lines[0].text, /其实很害怕/);

  // The ordinary 读译文 reading already drops it the same way (leaving the same leftover comma,
  // stripHiddenRuns's own known quirk — not what this test is about); both sides now agree.
  const translationFloor = await __testing.collectTtsFloor(0, settings, 'translation');
  assert.doesNotMatch(translationFloor.lines[0].text, /其实很害怕/);
  assert.equal(dialogueFloor.lines[0].text, '樱井，抬头看着天空。「今日は暑いね」');
  assert.equal(translationFloor.lines[0].text, '樱井，抬头看着天空。「今天真热啊」');
});

// A mismatch (mixDialogueFromSource keeping the translation's line whole, see tts.js) is not silent:
// collectTtsFloor leaves a diagnostic naming which lines fell back, so a report of "台词念错了" has
// something to point at.
test('对白读原文 records a diagnostic for a line whose quoted-run counts do not match', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-dialogue-source-mismatch-diagnostic');
  const settings = __testing.configureForTest({
    settings: {
      apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1',
      tts: { enabled: true, mode: 'off', side: 'dialogue_source', fish: FISH },
    },
  });
  const source = '彼女は振り返った。「行こう、振り返るな」';
  const translations = [[1, '她转过身。「走吧。」她停了一下，又说：「别回头。」']];
  context.chat.push(await translatedFloor(source, translations, settings));

  const floor = await __testing.collectTtsFloor(0, settings);
  // Kept whole, exactly as the translation wrote it — never a repeated or dropped line.
  assert.equal(floor.lines[0].text, '她转过身。「走吧。」她停了一下，又说：「别回头。」');

  const entry = readDiagnostics().filter(item => item.scope === 'tts.dialogue-source-mismatch').at(-1);
  assert.ok(entry, 'a diagnostic was recorded');
  assert.deepEqual(entry.details?.lineIds, [1]);
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

// 歌词行 (DESIGN §17.15) are sung in their own words in every reading, 对白读原文 included — this is the
// one place lyrics and the mixed reading meet, so it gets its own coverage. 「朗读时唱出来」 off gives back
// the v0.37.0 behaviour: the line never becomes a reading line at all.
test('对白读原文 sings a lyric line in its own words, and leaves it out with 朗读时唱出来 off', async t => {
  restoreGlobals(t);
  const { context } = mockHost('tts-dialogue-source-lyric');
  const base = {
    apiMode: 'independent', channels: [CHANNEL], selectedChannelId: 'c1',
    lyricLineRules: 'そらにひびけ',
    tts: { enabled: true, mode: 'off', side: 'dialogue_source', fish: FISH },
  };
  const settings = __testing.configureForTest({ settings: base });
  const source = '桜井は空を見上げた。「今日は暑いね」\n\nそらにひびけ\n\n汤姆笑着点头。"Indeed it is."';
  context.chat.push(await translatedFloor(source, [
    [1, '樱井抬头看着天空，觉得有点晒。「今天真热啊」'],
    [2, '响彻天空'],
    [3, '汤姆笑着点了点头，用英语回答。「的确如此。」'],
  ], settings));

  const floor = await __testing.collectTtsFloor(0, settings);
  assert.equal(floor.side, 'dialogue_source');
  assert.deepEqual(floor.lines, [
    { lineId: 1, text: '樱井抬头看着天空，觉得有点晒。「今日は暑いね」' },
    { lineId: 2, text: 'そらにひびけ', sung: true, shown: 'そらにひびけ (响彻天空)' },
    { lineId: 3, text: '汤姆笑着点了点头，用英语回答。"Indeed it is."' },
  ], 'the lyric line is read in the original, never its bracketed translation');

  const off = __testing.configureForTest({ settings: { ...base, lyricSing: false } });
  const plain = await __testing.collectTtsFloor(0, off);
  assert.deepEqual(plain.lines.map(line => line.lineId), [1, 3], 'with 朗读时唱出来 off the lyric line (id 2) never becomes a reading line');
});

// ---------------------------------------------------------------------------------------------
// locateDialogueSourceAnchors: 对白读原文's own two-pass anchor search, for placing buttons and the
// reading highlight on the rendered floor (decorateTtsMessage). Its narration and its quoted runs live
// on two different blocks of the page, which the ordinary single-pass locateAnchors (built for a floor
// whose lines are the block it searches) cannot always reach both halves of.
// ---------------------------------------------------------------------------------------------

test('locateDialogueSourceAnchors finds a quoted run in the original block that sits before the translation block that already matched', () => {
  // The default bilingual layout: the original paragraph, then the translation paragraph, one pair
  // after another — the shape assembleBilingual actually renders (verified separately). The
  // translation shows its own quote marks as it always did; only mixDialogueFromSource's own line.text
  // (what gets read, not what is shown) has the original's words spliced in.
  const nodeTexts = [
    '桜井は空を見上げた。', '「今日は暑いね」',     // 0,1: original, paragraph 1
    '樱井抬头看着天空，觉得有点晒。', '「今天真热啊」', // 2,3: translation, paragraph 1 (its own quote)
    '汤姆笑着点头。', '"Indeed it is."',           // 4,5: original, paragraph 2
    '汤姆笑着点了点头，用英语回答。', '「的确如此。」', // 6,7: translation, paragraph 2 (its own quote)
  ];
  const floor = {
    lines: [
      { lineId: 1, text: '樱井抬头看着天空，觉得有点晒。「今日は暑いね」' },
      { lineId: 2, text: '汤姆笑着点了点头，用英语回答。"Indeed it is."' },
    ],
    sources: new Map([
      [1, '桜井は空を見上げた。「今日は暑いね」'],
      [2, '汤姆笑着点头。"Indeed it is."'],
    ]),
  };
  const utterances = splitUtterances(floor.lines);
  assert.deepEqual(utterances.map(item => item.kind), ['narration', 'quoted', 'narration', 'quoted']);

  // Proof the bug is real: the ordinary single-pass search (what decorateTtsMessage called before this
  // fix — searching floor.lines, the mixed text, for every anchor in one pass) finds both narration
  // sentences but neither quoted run, because the second narration match moves the forward-only cursor
  // past the original block the first quoted run is sitting in.
  const naive = locateAnchors(nodeTexts, floor.lines, utterances.map(item => ({ id: item.id, lineId: item.lineId, text: item.anchor })));
  assert.ok(naive.get(1), 'narration 1 is still found the old way');
  assert.equal(naive.get(2), null, 'the old single-pass search cannot reach back into the original block for the quoted run');
  assert.ok(naive.get(3), 'narration 2 is still found the old way');
  assert.equal(naive.get(4), null, 'nor for the second quoted run');

  const found = __testing.locateDialogueSourceAnchors(nodeTexts, floor, utterances);
  assert.equal(found.size, 4);
  for (const utterance of utterances) assert.ok(found.get(utterance.id), `utterance ${utterance.id} (${utterance.kind}) was located`);
  // The narration lands in the translation block (node 2 and 6); the quoted runs land in the original
  // block (node 1 and 5) — each on its own side of the page, not chasing the other's cursor.
  assert.equal(found.get(1).start.node, 2);
  assert.equal(found.get(2).start.node, 1, 'the quoted run is found in the original block, which sits before the translation block already matched for narration');
  assert.equal(found.get(3).start.node, 6);
  assert.equal(found.get(4).start.node, 5);
});

test('under a built-in beautify, a one-character paragraph is found in its own block, not at the end of the other language above it', () => {
  // 原文折叠 as the host draws it: each paragraph's chip and original, then its translation. The second
  // paragraph is only 「律」, and the translation just above it happens to end on the same character.
  const nodeTexts = [
    '原文', 'それを見届けてから、アクアは冷たい瞳で律を射抜いた。', // 0,1: source block, paragraph 1
    '确认完这一切，阿库亚用冷淡的眼睛钉住了律。', // 2: translation block, paragraph 1
    '原文', '「律」', // 3,4: source block, paragraph 2
    '「律」', // 5: translation block, paragraph 2
  ];
  const sides = ['source', 'source', 'translation', 'source', 'source', 'translation'];
  const sourceLines = [{ lineId: 1, text: 'それを見届けてから、アクアは冷たい瞳で律を射抜いた。' }, { lineId: 2, text: '「律」' }];
  const translationLines = [{ lineId: 1, text: '确认完这一切，阿库亚用冷淡的眼睛钉住了律。' }, { lineId: 2, text: '「律」' }];
  const anchorsOf = lines => splitUtterances(lines).map(item => ({ id: item.id, lineId: item.lineId, text: item.anchor }));
  assert.deepEqual(splitUtterances(sourceLines).map(item => item.lineId), [1, 2]);

  // Searched whole, the original 「律」 lands on the last character of the translation above it, and
  // the translated 「律」 on the original block below that.
  assert.equal(locateAnchors(nodeTexts, sourceLines, anchorsOf(sourceLines)).get(2).start.node, 2);
  assert.equal(locateAnchors(nodeTexts, translationLines, anchorsOf(translationLines)).get(2).start.node, 4);

  const texts = __testing.textsForSides(sides, nodeTexts);
  const source = locateAnchors(texts.source, sourceLines, anchorsOf(sourceLines));
  assert.equal(source.get(1).start.node, 1);
  assert.equal(source.get(2).start.node, 4, 'the original 「律」 is found in its own block');
  const translation = locateAnchors(texts.translation, translationLines, anchorsOf(translationLines));
  assert.equal(translation.get(1).start.node, 2);
  assert.equal(translation.get(2).start.node, 5, 'the translated 「律」 is found in its own block');

  // 对白读原文: narration on the translation's side, each quoted run on the original's.
  const floor = { lines: translationLines, sources: new Map(sourceLines.map(line => [line.lineId, line.text])) };
  const mixed = __testing.locateDialogueSourceAnchors(texts, floor, splitUtterances(floor.lines));
  assert.equal(mixed.get(1).start.node, 2);
  assert.equal(mixed.get(2).start.node, 4);

  // Without both kinds of block (no beautify, or only the translation left on the page) nothing is blanked.
  assert.equal(__testing.textsForSides(['', '', '', '', '', ''], nodeTexts).source, nodeTexts);
  assert.equal(__testing.textsForSides(['translation', 'translation', '', '', '', ''], nodeTexts).translation, nodeTexts);
});

test('readingBlockSide tells the built-in beautify blocks apart, with or without the host prefix', () => {
  const inside = selector => ({ parentElement: { closest: query => (query.split(', ').includes(selector) ? {} : null) } });
  assert.equal(__testing.readingBlockSide(inside('.custom-jy-reading-translation')), 'translation');
  assert.equal(__testing.readingBlockSide(inside('.jy-reading-source')), 'source');
  assert.equal(__testing.readingBlockSide(inside('.custom-jy-reading-original')), 'source', 'the fold chip belongs to the original');
  assert.equal(__testing.readingBlockSide(inside('.mes_text')), '');
  assert.equal(__testing.readingBlockSide({ parentElement: null }), '');
});

test('locateDialogueSourceAnchors still finds narration when a floor has no quoted runs at all', () => {
  const nodeTexts = ['外面下着雨。', '外面下着雨。'];
  const floor = { lines: [{ lineId: 1, text: '外面下着雨。' }], sources: new Map([[1, '外は雨が降っている。']]) };
  const utterances = splitUtterances(floor.lines);
  const found = __testing.locateDialogueSourceAnchors(nodeTexts, floor, utterances);
  assert.equal(found.size, 1);
  assert.ok(found.get(1));
});

// ---------------------------------------------------------------------------------------------
// dialogueSourceLineAnchorIds: which utterance ids a 对白读原文 line's paragraph button (play/redo)
// looks for its anchor among. A hybrid line's narration lives on the translation, found through
// locateDialogueSourceAnchors regardless of what the current reading range actually plays or whether
// 只留译文 leaves the original off the page for the line's quoted run to resolve against — so a
// paragraph button should reach for that narration first, not for whatever planTtsLineButtons was
// left with after the range already filtered `visible` down.
// ---------------------------------------------------------------------------------------------

test('dialogueSourceLineAnchorIds reaches for a hybrid line’s own narration, even once 只读对白 leaves it out of what is actually read', () => {
  const floor = { lines: [{ lineId: 1, text: '樱井回过头，「你来了啊」轻轻笑了一下。' }] };
  const utterances = splitUtterances(floor.lines);
  assert.deepEqual(utterances.map(item => item.kind), ['narration', 'quoted', 'narration'], 'a narration run on each side of the one quoted run');
  const segments = buildSegments(utterances, new Map());
  // 「只读对白」: only the quoted run is actually read; both narration runs are left out of `visible`.
  const visible = audibleSegments(segments, 'dialogue');
  assert.deepEqual(visible.map(item => item.id), [2]);
  const [line] = __testing.planTtsLineButtons(visible);
  assert.deepEqual(line.ids, [2], 'planTtsLineButtons only knows about the one segment the range let through');

  // Proof the bug is real: decorateTtsMessage used to look for narration through a `visible`-built
  // `typeById` instead — nothing is ever typed 'narration' in a `visible` this range already filtered
  // narration out of, so it always fell back to line.ids, the quoted utterance's own anchor, which under
  // 只留译文 is never found (the original is off the page) and the paragraph button went unplaced.
  const naiveTypeById = new Map(visible.map(item => [item.id, item.type]));
  const naiveNarrationIds = line.ids.filter(id => naiveTypeById.get(id) === 'narration');
  assert.deepEqual(naiveNarrationIds, [], 'the old visible-only lookup never finds this line’s narration');

  const ids = __testing.dialogueSourceLineAnchorIds(line, utterances);
  assert.deepEqual(ids, [1, 3], 'the line’s own narration utterances, not the range-filtered quoted id');
});

test('dialogueSourceLineAnchorIds falls back to the line’s own ids once it truly carries no narration', () => {
  const floor = { lines: [{ lineId: 1, text: '「你来了啊」' }] };
  const utterances = splitUtterances(floor.lines);
  assert.deepEqual(utterances.map(item => item.kind), ['quoted']);
  const line = { lineId: 1, ids: [utterances[0].id] };
  assert.deepEqual(__testing.dialogueSourceLineAnchorIds(line, utterances), [utterances[0].id]);
});

// ---------------------------------------------------------------------------------------------
// streamReplyLines (边写边读): the reply as far as it is streamed must agree with what the finished
// floor's own reading (collectTtsFloor) will do with the same text, or the live reading says out loud
// what the recorded floor then silently skips.
// ---------------------------------------------------------------------------------------------

test('streamReplyLines leaves out a 歌词行 the same way the finished floor’s own reading does', () => {
  const settings = mergeSettings({ bodyTags: ['content'], lyricLineRules: '星が降る夜に' });
  const raw = '<content>\n她轻声唱着。\n星が降る夜に\n「你好。」\n</content>';
  const lines = __testing.streamReplyLines(raw, settings);
  // Regression: streamReplyLines used to keep its own copy of the segmentation options, never passing
  // lyricLineRules through and never dropping segmented.lyricIds, so 边写边读 sent the lyric line to
  // Fish and read it aloud even though collectTtsFloor's own reading leaves 歌词行 out by default.
  assert.deepEqual(lines.map(line => line.text), ['她轻声唱着。', '「你好。」'], 'the lyric line is not among the streamed lines');
  assert.ok(!lines.some(line => line.text.includes('星が降る夜に')), 'the lyric text itself is never streamed to Fish');
});

test('streamReplyLines still carries a story’s own speaker marks once the lyric check is added', () => {
  const settings = mergeSettings({ bodyTags: ['content'] });
  const raw = '<content>\n<say who="樱井" mood="开心">「你好」</say>她笑了。\n</content>';
  const [line] = __testing.streamReplyLines(raw, settings);
  assert.deepEqual(line.marks, [{ speaker: '樱井', mood: '开心', open: false }]);
});

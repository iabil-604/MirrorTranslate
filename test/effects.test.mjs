import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AFFIX_END,
  AFFIX_START,
  HIDDEN_END,
  HIDDEN_START,
  MESSAGE_META_KEY,
  MODULE_ID,
  assembleBilingual,
  assembleTranslationOnly,
  hashTextSync,
  interceptGenerationChat,
  lineQuoteFormats,
  inlineFormatRuns,
  lineFormatting,
  normalizeColoring,
  readFloor,
  recoverStructuredTranslations,
  renderReplacePair,
  renderSourceBlock,
  renderTranslationBlock,
  restyleBilingual,
  segmentSource,
  splitPiecesByRuns,
  stripGeneratedTranslationLines,
} from '../core.js';
import { computeSafeBand, contrastRatio, parseCssColor, relativeLuminance, resolveMoveStyle } from '../palette.js';
import { __testing } from '../index.js';

globalThis.toastr ??= Object.fromEntries(['success', 'error', 'warning', 'info'].map(kind => [kind, () => {}]));

function mockHost(chat = [], extra = {}) {
  const context = {
    chat,
    chatId: 'effects-fixture',
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
  return context;
}

// ---------------------------------------------------------------------------------------------
// palette.js — resolveMoveStyle
// ---------------------------------------------------------------------------------------------

test('a move colour clears the band\'s own contrast floor and writes both colour properties important', () => {
  const band = computeSafeBand(['#ffffff']);
  const style = resolveMoveStyle({ element: '火焰', name: '红莲拳', tier: 1, band, vividness: 0.7 });
  assert.ok(style);
  assert.match(style.css, /color:#[0-9a-f]{6} !important/i);
  assert.match(style.css, /-webkit-text-fill-color:#[0-9a-f]{6} !important/i);
  const rgb = parseCssColor(style.hex);
  const ratio = contrastRatio(rgb, parseCssColor('#ffffff'));
  assert.ok(ratio >= band.minContrast, `对比度 ${ratio} 应达到 ${band.minContrast}`);
  assert.equal(style.tier, 1);
  assert.doesNotMatch(style.css, /text-shadow/, '一级招式不发光');
});

test('tier 2 and 3 glow, tier 3 is bold + glow + one size up and never a gradient', () => {
  const band = computeSafeBand(['#101010']);
  const one = resolveMoveStyle({ element: '冰霜', name: '霜针', tier: 1, band });
  const two = resolveMoveStyle({ element: '冰霜', name: '霜针', tier: 2, band });
  const three = resolveMoveStyle({ element: '冰霜', name: '霜针', tier: 3, band });
  assert.equal(one.big, false);
  assert.match(two.css, /text-shadow/);
  assert.equal(three.big, true);
  assert.match(three.css, /text-shadow/);
  assert.doesNotMatch(three.css, /gradient|background-clip/, '三级用加粗+发光+大一号代替渐变');
});

test('an out-of-range tier clamps to 1..3, and null without a band', () => {
  const band = computeSafeBand(['#ffffff']);
  assert.equal(resolveMoveStyle({ element: '雷电', tier: 0, band }).tier, 1);
  assert.equal(resolveMoveStyle({ element: '雷电', tier: 9, band }).tier, 3);
  assert.equal(resolveMoveStyle({ element: '雷电', tier: 1, band: null }), null);
});

test('an unknown element still resolves, from the move\'s own name', () => {
  const band = computeSafeBand(['#ffffff']);
  const style = resolveMoveStyle({ element: '', name: '自创奥义·无中生有', tier: 1, band });
  assert.ok(style);
  assert.match(style.hex, /^#[0-9a-f]{6}$/i);
});

// ---------------------------------------------------------------------------------------------
// core.js — carrying the original's own typesetting (layers 2 and 3, structural half)
// ---------------------------------------------------------------------------------------------

test('a whole line stays layer 1\'s job: lineFormatting still claims it, lineQuoteFormats sees nothing extra', () => {
  const wrapped = '「<b>一整行加粗</b>」';
  assert.ok(lineFormatting(wrapped));
  const formats = lineQuoteFormats(wrapped);
  assert.equal(formats.length, 1);
  // Layer 2 does not duplicate layer 1's own whole-line wrap; it is free to also report it (the two
  // are additive elsewhere), so only length and shape are asserted here.
});

test('two quotes on one line: the wrapped one keeps its wrapper, the plain one is null, narration between them does not confuse the pairing', () => {
  const line = '太郎说：「<b>危险</b>」，花子只是笑着回答：「没关系」。';
  const formats = lineQuoteFormats(line);
  assert.equal(formats.length, 2);
  assert.deepEqual(formats[0], { open: '<b>', close: '</b>' });
  assert.equal(formats[1], null);
});

test('a straight quote inside a tag\'s own attribute (name="甲") is not counted as one of the line\'s speech marks, so the pairing does not shift', () => {
  // Two <say> shells on one line, each with a quoted `name` attribute: the straight quotes around 甲
  // and 乙 are not the story's own quote marks — only the two 「」 pairs are — so this must still read
  // as two quotes, wrapper on the first, nothing on the second, not four quotes with the wrapper
  // landing on 乙's line instead of 甲's.
  const line = '<say name="甲">「<b>行こう</b>」</say><say name="乙">「行かない」</say>';
  const formats = lineQuoteFormats(line);
  assert.equal(formats.length, 2, '两个 「」，不是被属性引号拆成的四个');
  assert.deepEqual(formats[0], { open: '<b>', close: '</b>' }, '包装落在甲说的那一句上');
  assert.equal(formats[1], null, '乙说的那一句没有自己的包装');
});

test('a quoted style attribute inside the quote itself survives untouched, attribute quotes and all', () => {
  const line = '「<span style="color:#c00">危险</span>」';
  const formats = lineQuoteFormats(line);
  assert.equal(formats.length, 1);
  assert.deepEqual(formats[0], { open: '<span style="color:#c00">', close: '</span>' }, '引号内自带的属性引号不会被抹掉');
});

test('an inline fragment mid-line is found without swallowing the rest of the line', () => {
  const line = '他冷冷地说：这半句<b>特别加重</b>，其余照常。';
  const runs = inlineFormatRuns(line);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].text, '特别加重');
  assert.deepEqual(runs[0].format, { open: '<b>', close: '</b>' });
  assert.equal(runs[0].hidden, false);
});

test('a struck-through fragment is reported as hidden; an ordinary one is not', () => {
  const line = '「表面上没事……<s>其实很在意</s>……真的没事。」';
  const runs = inlineFormatRuns(line);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].text, '其实很在意');
  assert.equal(runs[0].hidden, true);
});

test('an inline fragment spanning the whole line is left for layer 1, not reported twice', () => {
  const line = '<b>这一整行都在标签里</b>';
  assert.equal(inlineFormatRuns(line).length, 0, '整行的搬运是 lineFormatting 的职责');
});

test('a whole quote wrapped in a tag inside a <say> shell is also left for layer 1, not carried a second time nested inside itself', () => {
  // sayShellInner keeps the speech quotes on (lineQuoteFormats needs to see every quote), so the tag's
  // own span in `body` sits one character in from the whole unwrapped-line span lineFormatting sees —
  // comparing only against body.trim() never matched this shape, and <big><b> was carried twice.
  const line = '<say name="林浅">「<big><b>来るな！</b></big>」</say>';
  assert.ok(lineFormatting(line), '整行确实是一个可搬运的包装（层一）');
  assert.equal(inlineFormatRuns(line).length, 0, '层三不该再报同一段');
});

test('an inline fragment that is genuinely only part of the line — not the whole quote — is still reported', () => {
  const line = '<say name="林浅">「你看，<big>那边</big>有光！」</say>';
  const runs = inlineFormatRuns(line);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].text, '那边');
});

test('segmentSource carries quoteFormats and fragments on the layout, and fragment text on the segment itself', () => {
  const source = '「<b>危险</b>」\n\n他压低声音：这半句<i>特别轻</i>，其余照常。';
  const segmented = segmentSource(source, {});
  const units = segmented.layout.filter(part => part.type === 'segment');
  assert.equal(units.length, 2);
  assert.deepEqual(units[0].quoteFormats, [[]], '整行已经被 lineFormatting 接管，这里不再用 quoteFormats 重复携带同一个包裹');
  assert.equal(units[1].fragments[0].length, 1);
  assert.equal(units[1].fragments[0][0].text, '特别轻');
  const secondId = units[1].ids[0];
  assert.deepEqual(segmented.segments.find(segment => segment.id === secondId).fragments, ['特别轻']);
  assert.deepEqual(segmented.fragmentsById.get(secondId).map(fragment => fragment.text), ['特别轻']);
});

test('paragraphPerLine carries quoteFormats and fragments the same way the ordinary branch does, so 特效字 is not silently dropped', () => {
  const source = '「<b>危险</b>」\n\n他压低声音：这半句<i>特别轻</i>，其余照常。';
  const segmented = segmentSource(source, { paragraphPerLine: true });
  const units = segmented.layout.filter(part => part.type === 'segment');
  assert.equal(units.length, 2);
  assert.deepEqual(units[0].quoteFormats, [[]], '整行已经被 lineFormatting 接管，这里不再用 quoteFormats 重复携带同一个包裹');
  assert.equal(units[1].fragments[0].length, 1);
  assert.equal(units[1].fragments[0][0].text, '特别轻');
  const secondId = units[1].ids[0];
  assert.deepEqual(segmented.segments.find(segment => segment.id === secondId).fragments, ['特别轻']);
  assert.deepEqual(segmented.fragmentsById.get(secondId).map(fragment => fragment.text), ['特别轻']);
});

// ---------------------------------------------------------------------------------------------
// core.js — splitPiecesByRuns (shared by 招式 colouring and layer 3's carried fragments)
// ---------------------------------------------------------------------------------------------

test('splitPiecesByRuns carves a run out of the middle of a piece, keeping the piece\'s own css on the rest', () => {
  const pieces = [{ text: '他喊出了红莲拳，击碎了岩壁。', css: 'color:#111 !important' }];
  const out = splitPiecesByRuns(pieces, [{ text: '红莲拳', css: 'color:#f97316 !important' }]);
  assert.deepEqual(out.map(piece => piece.text).join(''), pieces[0].text);
  const move = out.find(piece => piece.text === '红莲拳');
  assert.equal(move.css, 'color:#f97316 !important');
  assert.equal(out[0].css, 'color:#111 !important');
  assert.equal(out.at(-1).css, 'color:#111 !important');
});

test('splitPiecesByRuns places the longer run first, so a shorter run inside it is not stolen', () => {
  const pieces = [{ text: '究极·红莲爆碎拳发动了。' }];
  const out = splitPiecesByRuns(pieces, [
    { text: '拳', css: 'color:#000 !important' },
    { text: '红莲爆碎拳', css: 'color:#f97316 !important' },
  ]);
  const long = out.find(piece => piece.text === '红莲爆碎拳');
  assert.equal(long.css, 'color:#f97316 !important', '长的招式名先占位，短的「拳」不会把它拆开');
  assert.equal(out.filter(piece => piece.text === '拳').length, 0);
});

test('splitPiecesByRuns only carves the first occurrence, and rawOpen/rawClose render as literal tags', () => {
  const pieces = [{ text: '他说了两次红莲拳，红莲拳。' }];
  const out = splitPiecesByRuns(pieces, [{ text: '红莲拳', rawOpen: '<b>', rawClose: '</b>' }]);
  assert.equal(out.filter(piece => piece.rawOpen).length, 1);
  const styleFor = () => ({
    open: '<span class="jy-spk">', close: '</span>',
    emphasis: translation => splitPiecesByRuns([{ text: translation }], [{ text: '红莲拳', rawOpen: '<b>', rawClose: '</b>' }]),
  });
  const options = { translationPrefix: '{', translationSuffix: '}', styleFor };
  const floor = assembleBilingual(
    segmentSource('原文。', options).layout,
    new Map([[1, '他说了两次红莲拳，红莲拳。']]),
    options,
  );
  // Tags ride wrapped in their own invisible round-trip markers (markedAffix), so an exact
  // `<b>红莲拳</b>` substring never appears literally — only their relative order does.
  assert.equal((floor.match(/<b>/g) ?? []).length, 1, '只搬运第一次出现的那个');
  assert.equal((floor.match(/<\/b>/g) ?? []).length, 1);
  const openAt = floor.indexOf('<b>');
  const textAt = floor.indexOf('红莲拳');
  const closeAt = floor.indexOf('</b>');
  assert.ok(openAt >= 0 && openAt < textAt && textAt < closeAt, '<b> 在招式名之前、</b> 在其后');
  assert.equal(stripGeneratedTranslationLines(floor), '原文。', '剥离后逐字还原原文，标签不泄漏给主模型');
});

test('a move name that sits inside an already-carried run is still coloured, keeps the run\'s own wrapper, and the wrapper\'s size drop never touches the move\'s colour', () => {
  // The carried run (layer 3, a whole half-sentence) is far longer than the move name inside it, so
  // the old length-only sort carved it first and its `runApplied` flag then hid the move's own text
  // from ever being found — length no longer decides which pass goes first.
  const pieces = [{ text: '他压低声音说道，白虎神拳，天地为证！', css: 'font-size:1.05em !important' }];
  const runs = [
    { text: '白虎神拳，天地为证！', rawOpen: '<big>', rawClose: '</big>', dropSurroundingCss: true },
    { text: '白虎神拳', css: 'color:#f97316 !important;-webkit-text-fill-color:#f97316 !important' },
  ];
  const out = splitPiecesByRuns(pieces, runs);
  assert.equal(out.map(piece => piece.text).join(''), pieces[0].text, '重新拼接必须逐字还原');
  const move = out.find(piece => piece.text === '白虎神拳');
  assert.ok(move, '招式名即使落在已经搬运的半句里，仍然要能被单独切出来上色');
  assert.equal(move.css, runs[1].css, '招式的颜色不受外层「字号二选一」影响');
  assert.equal(move.rawOpen, '<big>', '招式片段仍在被搬运的半句自己的包装里');
  assert.equal(move.rawClose, '</big>');
  // Every other piece the carried run produced keeps its own wrapper and its dropped (size-only) css.
  for (const piece of out) {
    if (piece.text === pieces[0].text || piece.text === move.text) continue;
    if (piece.rawOpen || piece.rawClose) {
      assert.equal(piece.rawOpen, '<big>');
      assert.equal(piece.rawClose, '</big>');
      assert.equal(piece.css, '', '被搬运半句自己的字号必须让位给 <big>，而不是叠加原来的字号');
    }
  }
});

// ---------------------------------------------------------------------------------------------
// core.js — the translator's own answer: readAnnotation reads moves and runs, verbatim-checked
// ---------------------------------------------------------------------------------------------

test('a reported move is read, its tier clamped, and dropped if it has no name', () => {
  const raw = JSON.stringify({ translations: [{
    id: 1, text: '他打出了红莲爆碎拳。',
    moves: [{ name: '红莲爆碎拳', element: '火焰', tier: 9 }, { element: '没有名字' }],
  }] });
  const recovered = recoverStructuredTranslations(raw, [{ id: 1 }]);
  const mark = recovered.annotations.get(1);
  assert.equal(mark.moves.length, 1);
  assert.equal(mark.moves[0].name, '红莲爆碎拳');
  assert.equal(mark.moves[0].tier, 3, '9 被夹到上限 3');
});

test('runs are read back as an ordered plain-text list, blank answers dropped', () => {
  const raw = JSON.stringify({ translations: [{ id: 1, text: '这半句特别加重，其余照常。', runs: ['特别加重', ''] }] });
  const recovered = recoverStructuredTranslations(raw, [{ id: 1 }]);
  assert.deepEqual(recovered.annotations.get(1).runs, ['特别加重', '']);
});

test('an item\'s own runs array is not also read as an id-less extra translation item, so positional recovery still fires for a genuinely id-less item', () => {
  // The bracket scan that recovers a truncated reply also finds `runs`'s own `[...]` as a candidate
  // on its own, each of its bare strings then read as if it were a whole extra `translations` item —
  // which used to inflate `items.length` past `expected.length` and silently turn off the id-less
  // positional fallback for every segment in the batch, this one included.
  const raw = JSON.stringify({ translations: [
    { id: 1, text: '这半句特别加重，其余照常。', runs: ['特别加重'] },
    { text: '第二段没有 id。' },
  ] });
  const recovered = recoverStructuredTranslations(raw, [{ id: 1 }, { id: 2 }]);
  assert.equal(recovered.translations.get(1), '这半句特别加重，其余照常。');
  assert.equal(recovered.translations.get(2), '第二段没有 id。', 'runs 数组不应该被当成额外一项，挤掉按位置恢复');
  assert.equal(recovered.missingIds.length, 0);
});

// ---------------------------------------------------------------------------------------------
// index.js — the per-chat move index, floor-wide tier caps, and the reading's hidden-run strip
// ---------------------------------------------------------------------------------------------

test('the chat-wide move index remembers the first floor\'s own element for a name, in floor order', () => {
  const chat = [
    { extra: { [MESSAGE_META_KEY]: { annotations: { 1: { moves: [{ name: '红莲拳', element: '火焰', tier: 1 }] } } } } },
    { extra: { [MESSAGE_META_KEY]: { annotations: { 5: { moves: [{ name: '红莲拳', element: '冰霜', tier: 2 }] } } } } },
  ];
  mockHost(chat);
  const index = __testing.buildChatMoveIndex();
  assert.equal(index.get('红莲拳').element, '火焰', '第二楼报的属性不同也不改颜色');
});

// Regression: a floor that named the move with no element used to permanently occupy that name in the
// chat-wide index (buildChatMoveIndex only checked `!index.has`), so a later floor's real element was
// discarded and a floor rendered afterwards still fell back to a name-hash hue — two colours for the
// same move (同招同色 broken). The first floor to actually name an element must win instead, regardless
// of which floor came first.
test('a floor that names a move with no element does not block a later floor\'s real element from becoming the chat-wide one', () => {
  const chat = [
    { extra: { [MESSAGE_META_KEY]: { annotations: { 1: { moves: [{ name: '红莲拳', element: '', tier: 1 }] } } } } },
    { extra: { [MESSAGE_META_KEY]: { annotations: { 5: { moves: [{ name: '红莲拳', element: '火焰', tier: 1 }] } } } } },
  ];
  mockHost(chat);
  const index = __testing.buildChatMoveIndex();
  assert.equal(index.get('红莲拳').element, '火焰', '空属性的先出现不该挡住后面楼层真正定下的属性');
});

test('once the chat-wide index has learned an element, a later floor reporting a different one for the same name does not override it', () => {
  const chat = [
    { extra: { [MESSAGE_META_KEY]: { annotations: { 1: { moves: [{ name: '红莲拳', element: '', tier: 1 }] } } } } },
    { extra: { [MESSAGE_META_KEY]: { annotations: { 5: { moves: [{ name: '红莲拳', element: '火焰', tier: 1 }] } } } } },
    { extra: { [MESSAGE_META_KEY]: { annotations: { 9: { moves: [{ name: '红莲拳', element: '冰霜', tier: 1 }] } } } } },
  ];
  mockHost(chat);
  const index = __testing.buildChatMoveIndex();
  assert.equal(index.get('红莲拳').element, '火焰', '第一个真正定下的属性之后不再改');
});

test('resolveMoveElementIndex lets this floor\'s own real element fill a name the chat-wide index only has a placeholder for', () => {
  // chatMoveIndex carries a name with no element yet (an earlier, element-less mention this session has
  // not re-scanned); this floor is the first to actually name one, and it must win, the same as if
  // buildChatMoveIndex itself had already resolved it (see the two tests above).
  const chatMoveIndex = new Map([['红莲拳', { element: '' }]]);
  const annotations = new Map([[1, { moves: [{ name: '红莲拳', element: '火焰', tier: 1 }] }]]);
  const resolved = __testing.resolveMoveElementIndex(annotations, chatMoveIndex);
  assert.equal(resolved.get('红莲拳').element, '火焰');
});

// index.js — knownMovesForRequest: what the translator is reminded of (prompts.js/workflow.js turn this
// into the actual request text; see test/prompts.test.mjs and test/workflow.test.mjs).
test('knownMovesForRequest lists moves with a fixed element, most recently mentioned first, and leaves out ones with none yet', () => {
  const chat = [
    { extra: { [MESSAGE_META_KEY]: { annotations: { 1: { moves: [{ name: '红莲拳', element: '火焰', tier: 1 }] } } } } },
    { extra: { [MESSAGE_META_KEY]: { annotations: { 2: { moves: [{ name: '无属性招', element: '', tier: 1 }] } } } } },
    { extra: { [MESSAGE_META_KEY]: { annotations: { 3: { moves: [{ name: '霜针', element: '冰霜', tier: 1 }] } } } } },
    // Mentioned again later with no new information: the element stays 火焰, but its recency updates.
    { extra: { [MESSAGE_META_KEY]: { annotations: { 4: { moves: [{ name: '红莲拳', element: '', tier: 1 }] } } } } },
  ];
  mockHost(chat);
  const known = __testing.knownMovesForRequest();
  assert.deepEqual(known, [{ name: '红莲拳', element: '火焰' }, { name: '霜针', element: '冰霜' }], '最近提到的在前，没有属性的招式不列入');
});

test('knownMovesForRequest caps at 40, keeping the most recently mentioned ones', () => {
  const chat = Array.from({ length: 45 }, (_, index) => ({
    extra: { [MESSAGE_META_KEY]: { annotations: { 1: { moves: [{ name: `招${index}`, element: '火', tier: 1 }] } } } },
  }));
  mockHost(chat);
  const known = __testing.knownMovesForRequest();
  assert.equal(known.length, 40);
  assert.equal(known[0].name, '招44', '最后一楼提到的招式排在最前');
  assert.ok(!known.some(entry => entry.name === '招0'), '最早的招式被最近的挤出四十条的名额');
});

test('tier caps are counted once per floor: at most one tier 3, and tier 2 caps a few paragraphs down to tier 1', () => {
  const annotations = new Map([
    [1, { moves: [{ name: '招A', element: '火', tier: 3 }] }],
    [2, { moves: [{ name: '招B', element: '冰', tier: 3 }] }],
    [3, { moves: [{ name: '招C', element: '雷', tier: 2 }] }],
    [4, { moves: [{ name: '招D', element: '风', tier: 2 }] }],
    [5, { moves: [{ name: '招E', element: '水', tier: 2 }] }],
    [6, { moves: [{ name: '招F', element: '毒', tier: 2 }] }],
  ]);
  const capped = __testing.capMoveTiersForFloor(annotations);
  assert.equal(capped.get('1:0'), 3, '第一个三级招式保留');
  assert.equal(capped.get('2:0'), 2, '第二个三级招式降为二级，随即参与二级的计数');
  assert.equal(capped.get('3:0'), 2);
  // Three tier-2-or-higher slots are already spent by items 1 (the surviving tier 3), 2 and 3; the
  // fourth one in floor order onward is capped down to plain text.
  assert.equal(capped.get('4:0'), 1, '超出二级上限的招式降为一级');
  assert.equal(capped.get('5:0'), 1);
  assert.equal(capped.get('6:0'), 1);
});

// Regression: a move whose name never turns up in the text it was reported against (a stale mark left
// on a re-translated line, most often) is never drawn at all, but capMoveTiersForFloor used to count it
// anyway — a phantom tier-3 spent the floor's only tier-3 slot, demoting the real tier-3 move right
// after it to tier 2 for nothing.
test('capMoveTiersForFloor does not count a move whose name never turns up in the text it was reported against', () => {
  const annotations = new Map([
    [1, { moves: [{ name: '幻影拳', element: '虚', tier: 3 }] }],
    [2, { moves: [{ name: '招B', element: '冰', tier: 3 }] }],
  ]);
  // Id 1's actual rendered text never mentions 幻影拳 at all (a stale mark); id 2's text does carry 招B.
  const textFor = id => (id === 1 ? '这一段其实没有提到那招。' : '他打出了招B。');
  const capped = __testing.capMoveTiersForFloor(annotations, textFor);
  assert.equal(capped.has('1:0'), false, '找不到文字的招式不占用这一楼的三级名额');
  assert.equal(capped.get('2:0'), 3, '真正会画出来的三级招式因此保住了三级');
});

test('capMoveTiersForFloor keeps counting every occurrence when no textFor is given (old behaviour, still relied on by callers with no text yet)', () => {
  const annotations = new Map([
    [1, { moves: [{ name: '招A', element: '火', tier: 3 }] }],
    [2, { moves: [{ name: '招B', element: '冰', tier: 3 }] }],
  ]);
  const capped = __testing.capMoveTiersForFloor(annotations);
  assert.equal(capped.get('1:0'), 3);
  assert.equal(capped.get('2:0'), 2, '没有 textFor 时两个都照旧参与计数，第二个三级仍会被降级');
});

test('collectTtsFloor\'s reading drops a hidden run\'s own words, keeping the rest of the line', () => {
  const fragments = [{ text: '其实很在意', format: { open: '<s>', close: '</s>' }, hidden: true }];
  const stripped = __testing.stripHiddenRuns('表面上没事……其实很在意……真的没事。', fragments, ['其实很在意']);
  assert.equal(stripped, '表面上没事……' + '……真的没事。');
  assert.doesNotMatch(stripped, /其实很在意/);
});

test('stripHiddenRuns leaves the text untouched when there is nothing hidden to drop', () => {
  assert.equal(__testing.stripHiddenRuns('一切如常。', [], []), '一切如常。');
  assert.equal(__testing.stripHiddenRuns('一切如常。', null, null), '一切如常。');
});

test('stripHiddenRuns does not strip an earlier, unrelated occurrence of the same words as the hidden run', () => {
  // Both fragments translate to the same three characters; only the second is hidden. A plain
  // text.replace(run, '') over the whole line matches the *first* occurrence regardless of which
  // fragment is actually hidden, stripping the visible one and leaving the hidden one to be heard.
  const fragments = [
    { text: '红莲拳', format: null, hidden: false },
    { text: '红莲拳', format: { open: '<s>', close: '</s>' }, hidden: true },
  ];
  const runs = ['红莲拳', '红莲拳'];
  const stripped = __testing.stripHiddenRuns('他先喊出红莲拳试探，随即又是一声红莲拳，终结了战斗。', fragments, runs);
  assert.equal(stripped, '他先喊出红莲拳试探，随即又是一声，终结了战斗。');
});

// ---------------------------------------------------------------------------------------------
// core.js — restyleBilingual recomputes a move's colour on restyle (design: theme/background change)
// ---------------------------------------------------------------------------------------------

test('a restyle recomputes a move span\'s colour against the new band, leaving the rest of the body untouched', () => {
  const oldBand = computeSafeBand(['#ffffff']);
  const newBand = computeSafeBand(['#101010']);
  const oldStyle = resolveMoveStyle({ element: '火焰', name: '红莲拳', tier: 1, band: oldBand, vividness: 0.7 });
  const newStyle = resolveMoveStyle({ element: '火焰', name: '红莲拳', tier: 1, band: newBand, vividness: 0.7 });
  assert.notEqual(oldStyle.hex, newStyle.hex, '两个背景下算出的颜色本身要不同，测试才有意义');
  const moveOpen = `<span data-jy-move-element="火焰" data-jy-move-name="红莲拳" data-jy-move-tier="1" style="${oldStyle.css}">`;
  const body = `他打出了${AFFIX_START}${moveOpen}${AFFIX_END}红莲拳${AFFIX_START}</span>${AFFIX_END}，震碎了地面。`;
  const floor = `${renderSourceBlock('原文。')}\n${renderTranslationBlock(body, { translationPrefix: '{', translationSuffix: '}' })}`;
  const metadata = { schema_version: 4, translation_prefix: '{', translation_suffix: '}' };
  const options = {
    translationPrefix: '【', translationSuffix: '】',
    coloring: { speakers: true, effects: true, band: newBand, vividness: 0.7 },
  };
  const restyled = restyleBilingual(floor, options, metadata);
  assert.ok(restyled.includes(`style="${newStyle.css}"`), '招式的颜色要按新背景重新算出');
  assert.ok(!restyled.includes(oldStyle.css), '旧背景算出的颜色不应该继续留着');
  assert.ok(restyled.includes('data-jy-move-element="火焰"'), '标注属性本身原样保留，供下一次 restyle 使用');
  assert.match(restyled, /他打出了.*红莲拳.*，震碎了地面。/s, '文字本身一个字都没有变');
  // 特效字 off: the span is left exactly as it already read, old colour and all.
  const effectsOff = restyleBilingual(floor, { ...options, coloring: { speakers: true, effects: false, band: newBand } }, metadata);
  assert.ok(effectsOff.includes(oldStyle.css), '特效字关闭时不重新计算，保留原样');
});

// ---------------------------------------------------------------------------------------------
// index.js — buildSegmentStyler: moves paint their own characters, colour wins over speaker's,
// and 『』 marked as a move name is neither speaker-coloured nor read as dialogue.
// ---------------------------------------------------------------------------------------------

test('a move inside a narrated line is coloured on its own, with no speaker mark at all', () => {
  mockHost([]);
  const band = computeSafeBand(['#ffffff']);
  const settings = { coloring: { speakers: true, emotions: true, effects: true, band } };
  const annotations = new Map([[1, { moves: [{ name: '红莲拳', element: '火焰', tier: 1 }] }]]);
  const styleFor = __testing.buildSegmentStyler(settings, annotations);
  assert.ok(styleFor, '旁白里的招式，即使没有 speaker，也要建出装饰器');
  const decoration = styleFor([1], ['他打出了红莲拳，震碎了地面。']);
  assert.ok(decoration, '没有说话人色，但仍要有 emphasis 去切出招式');
  const pieces = decoration.emphasis('他打出了红莲拳，震碎了地面。', 1);
  const move = pieces.find(piece => piece.text === '红莲拳');
  assert.ok(move?.css.includes('-webkit-text-fill-color'), '招式 span 必须自己同时写 color 和 -webkit-text-fill-color');
});

test('a move\'s colour wins only on its own characters inside a speaker-painted quote', () => {
  mockHost([]);
  const band = computeSafeBand(['#ffffff']);
  const settings = { coloring: { speakers: true, emotions: true, effects: true, band } };
  const annotations = new Map([[1, {
    speaker: '太郎', emotion: 'resolute',
    moves: [{ name: '红莲拳', element: '火焰', tier: 1 }],
  }]]);
  const styleFor = __testing.buildSegmentStyler(settings, annotations);
  const decoration = styleFor([1], ['「红莲拳，燃烧吧！」']);
  assert.ok(decoration);
  const pieces = decoration.emphasis('「红莲拳，燃烧吧！」', 1);
  assert.ok(pieces, '整句都是台词、只有一个说话人时，颜色本来在外层，但招式片段仍要能单独切出来');
  const move = pieces.find(piece => piece.text === '红莲拳');
  assert.ok(move, '招式片段被切了出来，即使外层已经是说话人色');
});

// Regression, end to end: buildSegmentStyler's own tier cap must not spend the floor's one tier-3 slot
// on a move whose id's actual translation (the 4th argument, exactly what writeTranslation now passes
// as effectiveTranslations) never mentions it — see the capMoveTiersForFloor tests above for the unit
// version of this same fix.
test('buildSegmentStyler, given the floor\'s real translations, does not let a phantom move demote a real tier-3 one', () => {
  mockHost([]);
  const band = computeSafeBand(['#ffffff']);
  const settings = { coloring: { speakers: true, emotions: true, effects: true, band } };
  const annotations = new Map([
    [1, { moves: [{ name: '幻影拳', element: '虚', tier: 3 }] }],
    [2, { moves: [{ name: '究极奥义', element: '雷', tier: 3 }] }],
  ]);
  // Id 1 was re-translated after the mark was made and no longer says 幻影拳 anywhere; id 2's text does
  // carry 究极奥义.
  const translationsById = new Map([[1, '这一段已经改写，不再提那一招。'], [2, '他使出了究极奥义！']]);
  const styleFor = __testing.buildSegmentStyler(settings, annotations, new Map(), translationsById);
  const secondPieces = styleFor([2], ['他使出了究极奥义！']).emphasis('他使出了究极奥义！', 2);
  const move = secondPieces.find(piece => piece.text === '究极奥义');
  assert.match(move?.css ?? '', /font-size:1\.12em/, '真正会画出来的三级招式没有被幻影招式挤掉，仍然是三级（加粗+发光+大一号）');
});

// ---------------------------------------------------------------------------------------------
// buildSegmentStyler: 特效字 is a sub-switch of 说话人着色 (normalizeColoring's own comment says every
// reader checks `speakers && effects`) — moves, carried runs and the per-quote wrapper must not act on
// a floor whose reader has never turned 特效字 on, even though segmentSource computes that data (and an
// old translation's stored annotations may still carry it) regardless of the setting.
// ---------------------------------------------------------------------------------------------

test('a move stays uncoloured while 特效字 is off, even though its annotation is right there in the floor', () => {
  mockHost([]);
  const band = computeSafeBand(['#ffffff']);
  const settings = { coloring: { speakers: true, emotions: true, effects: false, band } };
  const annotations = new Map([[1, { speaker: '太郎', moves: [{ name: '红莲拳', element: '火焰', tier: 1 }] }]]);
  const styleFor = __testing.buildSegmentStyler(settings, annotations);
  // A narrated line with nobody's speech in it and no emotion of its own: with 特效字 off, there is
  // nothing left for this floor to be styled by, so the decorator itself is nothing to build.
  assert.equal(styleFor([1], ['他打出了红莲拳，震碎了地面。']), null, '特效字 关闭时，招式不再是这一行需要装饰的理由');
});

test('a move stops being coloured the moment 特效字 is turned back off, on the very same annotation', () => {
  mockHost([]);
  const band = computeSafeBand(['#ffffff']);
  const annotations = new Map([[1, { moves: [{ name: '红莲拳', element: '火焰', tier: 1 }] }]]);
  const on = __testing.buildSegmentStyler({ coloring: { speakers: true, emotions: true, effects: true, band } }, annotations);
  assert.ok(on([1], ['他打出了红莲拳，震碎了地面。']).emphasis, '开着的时候，招式确实会被上色（对照组）');
  const off = __testing.buildSegmentStyler({ coloring: { speakers: true, emotions: true, effects: false, band } }, annotations);
  assert.equal(off([1], ['他打出了红莲拳，震碎了地面。']), null, '同一份标注，关掉开关后这一行不再建出装饰');
});

test('a carried per-quote wrapper (layer 2) does not act while 特效字 is off, even with 说话人着色 and carryFormatting both on', () => {
  mockHost([]);
  const band = computeSafeBand(['#ffffff']);
  const settings = { coloring: { speakers: true, emotions: false, effects: false, band } };
  const annotations = new Map([[1, { speaker: '太郎' }]]);
  const styleFor = __testing.buildSegmentStyler(settings, annotations);
  const quoteFormatsByIndex = [[{ open: '<b>', close: '</b>' }]];
  const decoration = styleFor([1], ['太郎说：「危险」'], quoteFormatsByIndex, []);
  assert.ok(decoration, '说话人色本身不受 特效字 影响，装饰器仍然建得出来');
  // The quote is still painted the speaker's colour (层一说话人着色, unaffected by 特效字), but with
  // 特效字 off nothing carries the <b> that quoteFormats offered around it.
  const pieces = decoration.emphasis('太郎说：「危险」', 1);
  assert.ok(pieces, '有说话人色时仍然逐段拆开');
  assert.equal(pieces.some(piece => piece.rawOpen === '<b>'), false, '特效字 关闭时，逐引号的搬运包装不生效');
});

test('the same per-quote wrapper does act once 特效字 is turned on, on the very same input', () => {
  mockHost([]);
  const band = computeSafeBand(['#ffffff']);
  const annotations = new Map([[1, { speaker: '太郎' }]]);
  const quoteFormatsByIndex = [[{ open: '<b>', close: '</b>' }]];
  const styleFor = __testing.buildSegmentStyler({ coloring: { speakers: true, emotions: false, effects: true, band } }, annotations);
  const decoration = styleFor([1], ['太郎说：「危险」'], quoteFormatsByIndex, []);
  assert.ok(decoration.emphasis, '特效字 开着时，同样的 quoteFormats 确实会生效（对照组）');
  const pieces = decoration.emphasis('太郎说：「危险」', 1);
  assert.ok(pieces.some(piece => piece.rawOpen === '<b>'), '引号内的搬运包装被套上了');
});

// ---------------------------------------------------------------------------------------------
// core.js — splitPiecesByRuns: a longer move must not lose its colour to a shorter carried run that
// happens to sit inside it, and a move carved from a fully-invisible carried run must stay invisible.
// ---------------------------------------------------------------------------------------------

test('a short carried run sitting inside a longer move name does not steal the move\'s characters and uncolour it', () => {
  // Regression: carving every carried run first regardless of length let a one-character carried
  // fragment ('雷', a <b>) claim its character out of '雷霆万钧' before the move pass ever ran, leaving
  // no single piece holding the move's full text to find it by.
  const pieces = [{ text: '他喊出雷霆万钧，天空中雷光闪烁。' }];
  const runs = [
    { text: '雷霆万钧', css: 'color:#f97316 !important' },
    { text: '雷', rawOpen: '<b>', rawClose: '</b>' },
  ];
  const out = splitPiecesByRuns(pieces, runs);
  assert.equal(out.map(piece => piece.text).join(''), pieces[0].text, '重新拼接必须逐字还原');
  const move = out.find(piece => piece.text === '雷霆万钧');
  assert.ok(move, '招式名即使后面还有一个更短的搬运片段，也要能整段被切出来上色');
  assert.equal(move.css, runs[0].css);
  assert.equal(out.filter(piece => piece.rawOpen === '<b>').length, 1, '后面那个单字的搬运片段仍然要能被搬运');
  const carried = out.find(piece => piece.rawOpen === '<b>');
  assert.equal(carried.text, '雷', '搬运片段落在自己那个字上，不是招式名里的字');
});

test('a move carved from a fully-invisible carried run (涂黑/删除线) is left uncoloured inside it, staying invisible', () => {
  // Regression: a move carved separately out of an invisible-painted run got its own colour span
  // *inside* the blackout wrapper, which made the redacted move name readable again.
  const pieces = [{ text: '他偷偷用了红莲拳。' }];
  const runs = [
    { text: '他偷偷用了红莲拳', rawOpen: '<span style="background-color:currentColor">', rawClose: '</span>', hidden: true },
    { text: '红莲拳', css: 'color:#b55920 !important;-webkit-text-fill-color:#b55920 !important' },
  ];
  const out = splitPiecesByRuns(pieces, runs);
  assert.equal(out.map(piece => piece.text).join(''), pieces[0].text);
  assert.equal(out.filter(piece => piece.text === '红莲拳').length, 0, '招式名不能从涂黑片段里被单独切出来');
  const blacked = out.find(piece => piece.rawOpen);
  assert.ok(blacked, '涂黑的搬运片段还在');
  assert.equal(blacked.text, '他偷偷用了红莲拳', '整段仍然是一个片段，没有被招式名拆开');
  assert.doesNotMatch(blacked.css ?? '', /#b55920/, '招式颜色不能出现在涂黑的片段上');
});

test('a hidden carried run inside a longer move name still stays hidden, instead of vanishing into the move\'s colour', () => {
  // Regression: the mirror case of the test above. The move's own name ('红莲拳') is longer than the
  // hidden span inside it ('红莲'), so the longest-first pass carved the move first and left no separate
  // occurrence of '红莲' behind for the hidden run to find — the redaction wrapper disappeared entirely
  // and '红莲' rendered in the move's colour.
  const pieces = [{ text: '他使出了红莲拳，转身离开。' }];
  const runs = [
    { text: '红莲', rawOpen: '<span style="background-color:currentColor">', rawClose: '</span>', hidden: true },
    { text: '红莲拳', css: 'color:#b55920 !important;-webkit-text-fill-color:#b55920 !important', moveElement: '火焰', moveName: '红莲拳', moveTier: 1 },
  ];
  const out = splitPiecesByRuns(pieces, runs);
  assert.equal(out.map(piece => piece.text).join(''), pieces[0].text, '重新拼接必须逐字还原');
  const blacked = out.find(piece => piece.rawOpen);
  assert.ok(blacked, '涂黑的搬运片段不能整个消失');
  assert.equal(blacked.text, '红莲', '涂黑片段只盖住自己那两个字');
  assert.doesNotMatch(blacked.css ?? '', /#b55920/, '被涂黑的字不能显出招式颜色');
  assert.equal(blacked.moveElement, undefined, '涂黑片段不能带着招式的 data-jy-move-* 身份，否则换背景重新上色时又会被点亮');
  assert.equal(blacked.moveName, undefined);
  const rest = out.find(piece => piece.text === '拳');
  assert.ok(rest, '招式名里没被涂黑的那个字还在');
  assert.match(rest.css ?? '', /#b55920/, '没被涂黑的字仍然按招式上色');
});

test('dropSurroundingCss only removes font-size, never a speaker\'s own colour, from the piece it sat inside', () => {
  // Regression: dropSurroundingCss used to blank the whole piece.css, which also erased a speaker's
  // colour on a quote (paintSpeech's pieces carry colour only, never font-size) the moment a <big>/
  // <small> fragment landed inside it.
  const pieces = [{ text: '「给我住手！」', css: 'color:#e80036 !important;-webkit-text-fill-color:#e80036 !important' }];
  const out = splitPiecesByRuns(pieces, [
    { text: '住手', rawOpen: '<big>', rawClose: '</big>', dropSurroundingCss: true },
  ]);
  const carried = out.find(piece => piece.rawOpen === '<big>');
  assert.ok(carried);
  assert.equal(carried.text, '住手');
  assert.equal(carried.css, pieces[0].css, '这句台词本来就没有字号，字号二选一不该动到说话人的颜色');
  // A piece that DOES carry a font-size (an emotion's rhythm scale) still loses only that part.
  const sized = splitPiecesByRuns(
    [{ text: '白虎神拳来了', css: 'color:#111 !important;font-size:1.05em !important' }],
    [{ text: '白虎神拳', rawOpen: '<big>', rawClose: '</big>', dropSurroundingCss: true }],
  );
  const move = sized.find(piece => piece.rawOpen === '<big>');
  assert.equal(move.css, 'color:#111 !important', '只丢字号，颜色还在');
});

// ---------------------------------------------------------------------------------------------
// core.js — restyleBilingual also recolours a move inside a replace pair, and a 只留译文 floor's own
// shown text (design: theme/background change should recompute every move on the floor, not just the
// bilingual text kept behind a stripped floor)
// ---------------------------------------------------------------------------------------------

test('a restyle recolours a move inside a replace-tag pair instead of leaving the pair untouched', () => {
  const oldBand = computeSafeBand(['#ffffff']);
  const newBand = computeSafeBand(['#101010']);
  const oldStyle = resolveMoveStyle({ element: '火焰', name: '红莲拳', tier: 1, band: oldBand, vividness: 0.7 });
  const newStyle = resolveMoveStyle({ element: '火焰', name: '红莲拳', tier: 1, band: newBand, vividness: 0.7 });
  const moveOpen = `<span data-jy-move-element="火焰" data-jy-move-name="红莲拳" data-jy-move-tier="1" style="${oldStyle.css}">`;
  const translation = `他打出了${AFFIX_START}${moveOpen}${AFFIX_END}红莲拳${AFFIX_START}</span>${AFFIX_END}，震碎了地面。`;
  const floor = renderReplacePair(translation, '原文。');
  const options = { coloring: { speakers: true, effects: true, band: newBand, vividness: 0.7 } };
  const restyled = restyleBilingual(floor, options, { schema_version: 4 });
  assert.ok(restyled.includes(`style="${newStyle.css}"`), '替换标签里的招式颜色也要按新背景重新算出');
  assert.ok(!restyled.includes(oldStyle.css), '旧背景的颜色不应该继续留着');
  assert.ok(restyled.includes(`${HIDDEN_START}原文。${HIDDEN_END}`), '隐藏的原文原样保留');
});

test('a stripped (只留译文) floor\'s own shown text gets its move recoloured on restyle, with projection_hash kept in step', async () => {
  const context = mockHost([]);
  const oldBand = computeSafeBand(['#ffffff']);
  const newBand = computeSafeBand(['#101010']);
  const oldStyle = resolveMoveStyle({ element: '火焰', name: '红莲拳', tier: 1, band: oldBand, vividness: 0.7 });
  const newStyle = resolveMoveStyle({ element: '火焰', name: '红莲拳', tier: 1, band: newBand, vividness: 0.7 });
  // assembleTranslationOnly writes a move's span directly into the shown text, with no translation
  // markers around it for restyleBilingual's own marker-based passes to find.
  const mes = `他打出了<span data-jy-move-element="火焰" data-jy-move-name="红莲拳" data-jy-move-tier="1" style="${oldStyle.css}">红莲拳</span>，震碎了地面。`;
  const mirror = `${renderSourceBlock('原文。')}\n${renderTranslationBlock('他打出了红莲拳，震碎了地面。', { translationPrefix: '{', translationSuffix: '}' })}`;
  const metadata = {
    schema_version: 4, stripped: true, mirror, projection_hash: hashTextSync(mes),
    translation_prefix: '{', translation_suffix: '}', segment_prefix: '', segment_suffix: '',
  };
  const message = { mes, is_user: false, extra: { [MESSAGE_META_KEY]: metadata } };
  context.chat.push(message);
  const settings = {
    translationPrefix: '{', translationSuffix: '}', segmentPrefix: '', segmentSuffix: '',
    coloring: { speakers: true, effects: true, band: newBand, vividness: 0.7 },
  };
  await __testing.restyleCurrentChat(settings);
  assert.ok(message.mes.includes(newStyle.css), '只留译文楼层显示的文字也要按新背景重新上色');
  assert.ok(!message.mes.includes(oldStyle.css));
  assert.equal(
    message.extra[MESSAGE_META_KEY].projection_hash,
    hashTextSync(message.mes),
    'projection_hash 要跟着新文字一起更新，否则下次读取会把这一楼当成被手改过',
  );
  assert.notEqual(message.extra[MESSAGE_META_KEY].projection_hash, metadata.projection_hash);
});

test('restyleCurrentChat leaves a fresh swipe\'s copied stripped record alone instead of pointing its fingerprint at the new reply', async () => {
  const context = mockHost([]);
  const oldSettings = { translationPrefix: '{', translationSuffix: '}', segmentPrefix: '', segmentSuffix: '' };
  const layout = segmentSource('\n雨が降っている。\n', oldSettings).layout;
  const translations = new Map([[1, '下雨了。']]);
  const mirror = assembleBilingual(layout, translations, oldSettings);
  const projection = assembleTranslationOnly(layout, translations, oldSettings);
  const meta = {
    schema_version: 4, swipe_id: 0, stripped: true, mirror, projection_hash: hashTextSync(projection),
    translation_prefix: '{', translation_suffix: '}', segment_prefix: '', segment_suffix: '',
  };
  // The host starts a freshly generated swipe with a structuredClone of the previous swipe's `extra`
  // (see readFloor's own doc in core.js): both message.extra and swipe_info[1].extra still say
  // `stripped: true` and point at swipe 0's mirror, even though swipe 1 is an untranslated reply that
  // has nothing to do with that record.
  const freshReply = '<story_scene>\nHe threw the Crimson Fist and left.\n</story_scene>';
  const copiedMeta = { ...meta };
  const message = {
    mes: freshReply, is_user: false, swipe_id: 1,
    swipes: [projection, freshReply],
    extra: { [MESSAGE_META_KEY]: copiedMeta },
    swipe_info: [{ extra: { [MESSAGE_META_KEY]: meta } }, { extra: { [MESSAGE_META_KEY]: copiedMeta } }],
  };
  context.chat.push(message);
  assert.deepEqual(readFloor(message), { text: freshReply, stripped: false, diverged: false, metadata: null });

  // An affix-only restyle still restyles swipe 0's real mirror (and so counts as a change worth saving);
  // that must not be the moment the copied record on swipe 1 gets its fingerprint corrupted.
  await __testing.restyleCurrentChat({ ...oldSettings, translationPrefix: '【', translationSuffix: '】' });

  assert.equal(message.mes, freshReply, '这条未翻译的新回复文字不该被改动');
  assert.equal(message.extra[MESSAGE_META_KEY].projection_hash, meta.projection_hash, '复制来的指纹不能被重新指向这条新回复');
  assert.deepEqual(
    readFloor(message), { text: freshReply, stripped: false, diverged: false, metadata: null },
    '换了译文前缀之后，这一楼仍然是没翻译过的普通楼层，不能被读成上一条 swipe 的译文',
  );
});

test('restyleCurrentChat leaves a hand-edited (diverged) stripped floor\'s fingerprint and text alone', async () => {
  const context = mockHost([]);
  const oldSettings = { translationPrefix: '{', translationSuffix: '}', segmentPrefix: '', segmentSuffix: '' };
  const source = '\n夕暮れの教室には、誰もいなかった。\n窓から差し込む光が、机を淡く照らしている。\n';
  const layout = segmentSource(source, oldSettings).layout;
  const translations = new Map([[1, '傍晚的教室里，一个人也没有。'], [2, '从窗外照进来的光，淡淡地照着桌面。']]);
  const mirror = assembleBilingual(layout, translations, oldSettings);
  const projection = assembleTranslationOnly(layout, translations, oldSettings);
  // Changed by hand, but still mostly the translation's own wording: readFloor calls this "diverged",
  // not a fresh untranslated floor, and refuses to let anything translate over it again.
  const edited = projection.replace('一个人也没有', '一个人都没有');
  const meta = {
    schema_version: 4, swipe_id: 0, stripped: true, mirror, projection_hash: hashTextSync(projection),
    translation_prefix: '{', translation_suffix: '}', segment_prefix: '', segment_suffix: '',
  };
  const message = { mes: edited, is_user: false, extra: { [MESSAGE_META_KEY]: meta } };
  context.chat.push(message);
  assert.equal(readFloor(message).diverged, true);

  await __testing.restyleCurrentChat({ ...oldSettings, translationPrefix: '【', translationSuffix: '】' });

  assert.equal(message.mes, edited, '手改过的文字不该被换样式覆盖回旧译文');
  assert.equal(message.extra[MESSAGE_META_KEY].projection_hash, meta.projection_hash, '手改楼层的指纹不该被重新指向手改后的文字');
  const after = readFloor(message);
  assert.equal(after.diverged, true, '手改过的楼层换样式之后仍然算被手改过，重新翻译才不会把它覆盖掉');
  assert.equal(after.text, edited, '读到的仍然是手改的文字，不是回退成旧译文');
});

test('saveSettings schedules a restyle when only coloring (band/vividness/speakers/effects) changes, not only on an affix or regex edit', async t => {
  const context = mockHost([]);
  // saveSettings also syncs the floating button and the speaker stylesheet while runtime.initialized is
  // true; both bail out harmlessly on this bare stub (no floating button shown, no registered speaker).
  globalThis.document = { getElementById: () => null, createElement: () => ({ style: {} }), head: { appendChild: () => {} } };
  t.after(() => {
    delete globalThis.document;
    __testing.configureForTest({ initialized: false });
  });
  __testing.configureForTest({ initialized: true });
  const oldBand = computeSafeBand(['#ffffff']);
  const newBand = computeSafeBand(['#101010']);
  const oldStyle = resolveMoveStyle({ element: '火焰', name: '红莲拳', tier: 1, band: oldBand, vividness: 0.7 });
  const newStyle = resolveMoveStyle({ element: '火焰', name: '红莲拳', tier: 1, band: newBand, vividness: 0.7 });
  const moveOpen = `<span data-jy-move-element="火焰" data-jy-move-name="红莲拳" data-jy-move-tier="1" style="${oldStyle.css}">`;
  const body = `他打出了${AFFIX_START}${moveOpen}${AFFIX_END}红莲拳${AFFIX_START}</span>${AFFIX_END}，震碎了地面。`;
  const floor = `${renderSourceBlock('原文。')}\n${renderTranslationBlock(body, { translationPrefix: '{', translationSuffix: '}' })}`;
  const message = { mes: floor, is_user: false, extra: { [MESSAGE_META_KEY]: { schema_version: 4, translation_prefix: '{', translation_suffix: '}' } } };
  context.chat.push(message);
  const base = __testing.configureForTest({
    settings: {
      translationPrefix: '{', translationSuffix: '}', showFloatingButton: false,
      coloring: { speakers: true, effects: true, band: oldBand, vividness: 0.7 },
    },
  });
  // 取色 only ever touches coloring.band, same as runThemeProbe's own call to saveSettings.
  __testing.saveSettings({ ...base, coloring: { ...base.coloring, band: newBand } });
  await __testing.processingRefresh();
  assert.ok(message.mes.includes(newStyle.css), '仅改背景色也要触发既有译文的重新上色');
  assert.ok(!message.mes.includes(oldStyle.css));
});

test('a 彩度 slider drag still triggers a restyle on save, even though the slider\'s own live preview already wrote the new value into runtime.settings first', async t => {
  const context = mockHost([]);
  globalThis.document = { getElementById: () => null, createElement: () => ({ style: {} }), head: { appendChild: () => {} } };
  t.after(() => {
    delete globalThis.document;
    __testing.configureForTest({ initialized: false });
  });
  __testing.configureForTest({ initialized: true });
  const band = computeSafeBand(['#ffffff']);
  // recolorMoveSpans (core.js) resolves a move's style off `normalizeColoring(options.coloring).band`,
  // not the raw band a caller passed in — going through the same normalization here keeps this test's
  // expected colours byte-identical to what a real restyle actually writes.
  const styleAt = vividness => {
    const normalized = normalizeColoring({ speakers: true, effects: true, band, vividness });
    return resolveMoveStyle({ element: '火焰', name: '红莲拳', tier: 1, band: normalized.band, vividness: normalized.vividness });
  };
  const oldStyle = styleAt(0.7);
  const newStyle = styleAt(0.2);
  const moveOpen = `<span data-jy-move-element="火焰" data-jy-move-name="红莲拳" data-jy-move-tier="1" style="${oldStyle.css}">`;
  const body = `他打出了${AFFIX_START}${moveOpen}${AFFIX_END}红莲拳${AFFIX_START}</span>${AFFIX_END}，震碎了地面。`;
  const floor = `${renderSourceBlock('原文。')}\n${renderTranslationBlock(body, { translationPrefix: '{', translationSuffix: '}' })}`;
  const message = { mes: floor, is_user: false, extra: { [MESSAGE_META_KEY]: { schema_version: 4, translation_prefix: '{', translation_suffix: '}' } } };
  context.chat.push(message);
  const base = __testing.configureForTest({
    settings: {
      translationPrefix: '{', translationSuffix: '}', showFloatingButton: false,
      coloring: { speakers: true, effects: true, band, vividness: 0.7 },
    },
  });
  // A real save already happened once, so context.extensionSettings holds exactly this as "last saved" —
  // exactly like production, where initializeSettings (or an earlier saveSettings) always leaves it there.
  context.extensionSettings[MODULE_ID] = base;

  // The 彩度 slider's own `input` handler (index.js onInput, data-jy-field="coloringVividness") is a live
  // preview: it writes the dragged value straight into runtime.settings on every tick, well before the
  // reader lets go and the blur's `change` handler calls saveSettings(collectSettings(root)) — which then
  // reads that very same already-live-previewed value back off the slider.
  __testing.configureForTest({ settings: { coloring: { ...base.coloring, vividness: 0.2 } } });
  const dragged = __testing.configureForTest({});
  __testing.saveSettings({ ...dragged, coloring: { ...dragged.coloring, vividness: 0.2 } });
  await __testing.processingRefresh();
  assert.ok(message.mes.includes(newStyle.css), '彩度改变也要触发既有译文里招式的重新上色');
  assert.ok(!message.mes.includes(oldStyle.css));
});

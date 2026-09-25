import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MESSAGE_META_KEY,
  assembleBilingual,
  interceptGenerationChat,
  lineQuoteFormats,
  inlineFormatRuns,
  lineFormatting,
  recoverStructuredTranslations,
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

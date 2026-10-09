import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AFFIX_END,
  AFFIX_START,
  MESSAGE_META_KEY,
  MODULE_ID,
  assembleBilingual,
  mergeSettings,
  normalizeColoring,
  normalizeMoveOverride,
  normalizeMoveOverrides,
  recolorMoveSpans,
  renderSourceBlock,
  renderTranslationBlock,
  segmentSource,
} from '../core.js';
import { MOVE_ELEMENT_CHOICES, computeSafeBand, resolveMoveStyle } from '../palette.js';
import { __testing } from '../index.js';

globalThis.toastr ??= Object.fromEntries(['success', 'error', 'warning', 'info'].map(kind => [kind, () => {}]));

// The card every test below chats with: 招式表 keeps its hand settings under this key.
const CARD = 'sakurai.png';

function mockHost(chat = [], extra = {}) {
  const context = {
    chat,
    chatId: 'move-table-fixture',
    extensionSettings: {},
    characters: [{ name: '樱井', avatar: CARD }],
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

const floorWith = moves => ({ extra: { [MESSAGE_META_KEY]: { annotations: { 1: { moves } } } } });

function paintAt(background, overrides = {}) {
  const coloring = normalizeColoring({ speakers: true, effects: true, band: computeSafeBand([background]), vividness: 0.7 });
  return options => resolveMoveStyle({ name: '红莲拳', tier: 1, band: coloring.band, vividness: coloring.vividness, ...overrides, ...options });
}

const moveSpan = extra => `<span data-jy-move-element="火焰" data-jy-move-name="红莲拳" data-jy-move-tier="1"${extra}>`;

// ---------------------------------------------------------------------------------------------
// core.js — what gets saved
// ---------------------------------------------------------------------------------------------

test('招式表 keeps only what was set by hand, one entry per move name', () => {
  assert.equal(normalizeMoveOverride({ name: '红莲拳' }), null, '什么都没改的一行不存');
  assert.equal(normalizeMoveOverride({ name: '  ', element: '火焰' }), null, '没有名字的不存');
  assert.deepEqual(
    normalizeMoveOverride({ name: ' 红莲拳 ', element: '冰霜', tier: '2', color: '#FF8A65', off: false }),
    { name: '红莲拳', element: '冰霜', tier: 2, color: '#ff8a65' },
  );
  assert.deepEqual(
    normalizeMoveOverride({ name: '红莲拳', tier: 7, color: 'red', off: true }),
    { name: '红莲拳', off: true },
    '超出 1–3 的等级、不是 #rrggbb 的颜色都不存',
  );
  const list = normalizeMoveOverrides([
    { name: '红莲拳', element: '火焰' },
    { name: '霜针', tier: 3 },
    { name: '红莲拳', element: '雷电' },
    { name: '白板' },
  ]);
  assert.deepEqual(list, [{ name: '红莲拳', element: '雷电' }, { name: '霜针', tier: 3 }], '同名的以最后一次为准，全自动的不留');
});

test('the hand settings follow the character card through a settings reload, empty cards dropped', () => {
  const merged = mergeSettings({ moveOverrides: {
    [CARD]: [{ name: '红莲拳', off: true }],
    'other.png': [{ name: '霜针' }],
    broken: 'x',
  } });
  assert.deepEqual(merged.moveOverrides, { [CARD]: [{ name: '红莲拳', off: true }] });
  assert.deepEqual(mergeSettings({}).moveOverrides, {});
});

test('the 属性 picker offers one name per colour family, 体术 among them', () => {
  assert.equal(MOVE_ELEMENT_CHOICES[0], '火焰');
  assert.ok(MOVE_ELEMENT_CHOICES.includes('体术'));
  assert.equal(new Set(MOVE_ELEMENT_CHOICES).size, MOVE_ELEMENT_CHOICES.length);
  assert.ok(!MOVE_ELEMENT_CHOICES.includes('火'), '同一个颜色的别名不重复列出');
});

// ---------------------------------------------------------------------------------------------
// core.js — a restyle lays the hand settings over what the span carries
// ---------------------------------------------------------------------------------------------

test('a restyle draws a move by the element, tier and colour set by hand, the span keeping the automatic ones', () => {
  const style = paintAt('#101010');
  const coloring = { speakers: true, effects: true, band: computeSafeBand(['#101010']), vividness: 0.7 };
  const body = `他打出了${moveSpan(` style="${style({ element: '火焰' }).css}"`)}红莲拳</span>。`;
  const iced = recolorMoveSpans(body, { coloring, moveOverrideList: [{ name: '红莲拳', element: '冰霜', tier: 3 }] });
  assert.ok(iced.includes(`style="${style({ element: '冰霜', tier: 3 }).css}"`), '按手动选的属性和等级上色');
  assert.ok(iced.includes('data-jy-move-element="火焰"') && iced.includes('data-jy-move-tier="1"'), '标注里还是自动的属性和等级');
  const picked = recolorMoveSpans(body, { coloring, moveOverrideList: [{ name: '红莲拳', color: '#ff8a65' }] });
  assert.match(picked, /color:#ff8a65 !important/, '深色背景上看得清的自选颜色原样用');
  const unrelated = recolorMoveSpans(body, { coloring, moveOverrideList: [{ name: '霜针', element: '冰霜' }] });
  assert.equal(unrelated, recolorMoveSpans(body, { coloring }), '别的招式的设置不影响这一个');
});

test('a picked colour too faint for the background is pulled until it reads', () => {
  const coloring = { speakers: true, effects: true, band: computeSafeBand(['#ffffff']), vividness: 0.7 };
  const body = `${moveSpan('')}红莲拳</span>`;
  const faint = recolorMoveSpans(body, { coloring, moveOverrideList: [{ name: '红莲拳', color: '#ffe0d0' }] });
  assert.doesNotMatch(faint, /#ffe0d0/, '白底上几乎看不见的浅色不能原样用');
  assert.match(faint, /style="color:#[0-9a-f]{6} !important/);
});

test('不上色 hands the move back what the words around it wear, and turning it back on restores its own colour', () => {
  const style = paintAt('#101010');
  const coloring = { speakers: true, effects: true, band: computeSafeBand(['#101010']), vividness: 0.7 };
  const speaker = 'color:#e80036 !important;-webkit-text-fill-color:#e80036 !important';
  const own = style({ element: '火焰' }).css;
  const quoted = `「${moveSpan(` style="${own}" data-jy-move-base="${speaker}"`)}红莲拳</span>！」`;
  const off = recolorMoveSpans(quoted, { coloring, moveOverrideList: [{ name: '红莲拳', off: true }] });
  assert.ok(off.includes(`style="${speaker}"`), '跟着说话人的颜色走');
  assert.ok(!off.includes(own), '招式自己的颜色和加粗都去掉');
  assert.ok(recolorMoveSpans(off, { coloring }).includes(`style="${own}"`), '勾回来恢复招式自己的颜色');

  const narrated = `他打出了${moveSpan(` style="${own}"`)}红莲拳</span>。`;
  const bare = recolorMoveSpans(narrated, { coloring, moveOverrideList: [{ name: '红莲拳', off: true }] });
  assert.doesNotMatch(bare, /style=/, '旁白里的招式周围没有颜色，就什么都不带');
  assert.equal(recolorMoveSpans(bare, { coloring, moveOverrideList: [{ name: '红莲拳', off: true }] }), bare, '再画一次不变');
  assert.ok(recolorMoveSpans(bare, { coloring }).includes(`style="${own}"`), '没有 style 的招式也能重新上色');
});

// ---------------------------------------------------------------------------------------------
// index.js — first render, the translator's reminder, the table's own list
// ---------------------------------------------------------------------------------------------

test('a move set by hand is drawn that way from its first render, its span keeping the automatic element and tier', () => {
  mockHost([]);
  const coloring = { speakers: true, emotions: false, effects: true, band: computeSafeBand(['#ffffff']) };
  const settings = { coloring, moveOverrides: { [CARD]: [{ name: '红莲拳', element: '冰霜', tier: 3 }] } };
  const annotations = new Map([[1, { moves: [{ name: '红莲拳', element: '火焰', tier: 1 }] }]]);
  const text = '他打出了红莲拳，震碎了地面。';
  const move = __testing.buildSegmentStyler(settings, annotations)([1], [text]).emphasis(text, 1).find(piece => piece.moveName === '红莲拳');
  const normalized = normalizeColoring(coloring);
  assert.equal(move.css, resolveMoveStyle({ element: '冰霜', name: '红莲拳', tier: 3, band: normalized.band, vividness: normalized.vividness }).css);
  assert.equal(move.moveElement, '火焰');
  assert.equal(move.moveTier, 1);
});

test('a move set to 不上色 is still cut out on first render, wearing its speaker\'s colour and remembering it', () => {
  mockHost([]);
  const band = computeSafeBand(['#ffffff']);
  const settings = {
    coloring: { speakers: true, emotions: false, effects: true, band },
    moveOverrides: { [CARD]: [{ name: '红莲拳', off: true }] },
  };
  const annotations = new Map([[1, { speaker: '太郎', moves: [{ name: '红莲拳', element: '火焰', tier: 2 }] }]]);
  const styleFor = __testing.buildSegmentStyler(settings, annotations);
  const text = '太郎喊道：「红莲拳！」';
  const pieces = styleFor([1], [text]).emphasis(text, 1);
  const move = pieces.find(piece => piece.moveName === '红莲拳');
  const around = pieces.find(piece => piece.text.includes('！'));
  assert.ok(move && around);
  assert.match(around.css, /color:#[0-9a-f]{6}/, '前提：这句台词带着说话人的颜色');
  assert.equal(move.css, around.css, '招式和这句台词一个颜色');
  assert.equal(move.moveBaseCss, around.css);
  assert.equal(move.moveElement, '火焰');
  assert.equal(move.moveTier, 2);

  const options = { translationPrefix: '', translationSuffix: '', styleFor };
  const floor = assembleBilingual(segmentSource('原文。', options).layout, new Map([[1, text]]), options);
  assert.match(floor, /data-jy-move-name="红莲拳"/, '招式的 span 还在，之后才能重新上色');
  assert.ok(floor.includes(`data-jy-move-base="${around.css}"`), '记下了周围的颜色');
  const restored = recolorMoveSpans(floor, { coloring: settings.coloring });
  const own = resolveMoveStyle({ element: '火焰', name: '红莲拳', tier: 2, band: normalizeColoring(settings.coloring).band, vividness: normalizeColoring(settings.coloring).vividness });
  assert.ok(restored.includes(`style="${own.css}"`), '勾回来之后按招式自己的属性和等级上色');
});

test('the translator is reminded of the element set by hand, so its next answer agrees with it', () => {
  const chat = [
    floorWith([{ name: '红莲拳', element: '火焰', tier: 1 }]),
    floorWith([{ name: '无属性招', element: '', tier: 1 }]),
  ];
  mockHost(chat);
  const settings = { moveOverrides: { [CARD]: [{ name: '红莲拳', element: '冰霜' }, { name: '无属性招', element: '雷电' }] } };
  assert.deepEqual(
    __testing.knownMovesForRequest(chat, settings),
    [{ name: '无属性招', element: '雷电' }, { name: '红莲拳', element: '冰霜' }],
  );
});

test('the table lists every move the chat has named, the most recently seen first, with the element the chat fixed', () => {
  const chat = [
    floorWith([{ name: '红莲拳', element: '火焰', tier: 1 }]),
    floorWith([{ name: '霜针', element: '', tier: 1 }]),
    floorWith([{ name: '红莲拳', element: '冰霜', tier: 2 }]),
    { is_user: true, extra: { [MESSAGE_META_KEY]: { annotations: { 1: { moves: [{ name: '玩家的招', element: '风' }] } } } } },
  ];
  mockHost(chat);
  assert.deepEqual(__testing.chatMoveTable(chat), [
    { name: '红莲拳', element: '火焰', lastSeen: 2 },
    { name: '霜针', element: '', lastSeen: 1 },
  ]);
  assert.deepEqual(__testing.chatMoveTable([]), []);
});

// ---------------------------------------------------------------------------------------------
// index.js — saving a change repaints what is already written
// ---------------------------------------------------------------------------------------------

function writtenFloor(css) {
  const body = `他打出了${AFFIX_START}${moveSpan(` style="${css}"`)}${AFFIX_END}红莲拳${AFFIX_START}</span>${AFFIX_END}，震碎了地面。`;
  const mes = `${renderSourceBlock('原文。')}\n${renderTranslationBlock(body, { translationPrefix: '{', translationSuffix: '}' })}`;
  return { mes, is_user: false, extra: { [MESSAGE_META_KEY]: { schema_version: 4, translation_prefix: '{', translation_suffix: '}' } } };
}

function startSession(t, context) {
  globalThis.document = { getElementById: () => null, createElement: () => ({ style: {} }), head: { appendChild: () => {} } };
  t.after(() => {
    delete globalThis.document;
    __testing.configureForTest({ initialized: false, inflight: new Map(), settings: { moveOverrides: {} } });
  });
  __testing.configureForTest({ initialized: true });
  const band = computeSafeBand(['#ffffff']);
  const base = __testing.configureForTest({
    settings: {
      translationPrefix: '{', translationSuffix: '}', showFloatingButton: false, moveOverrides: {},
      coloring: { speakers: true, effects: true, band, vividness: 0.7 },
    },
  });
  context.extensionSettings[MODULE_ID] = base;
  return { base, style: paintAt('#ffffff') };
}

test('a 招式表 change repaints the floors it touches at once, redrawing only those and never reloading the chat', async t => {
  let reloads = 0;
  const redrawn = [];
  const context = mockHost([], { reloadCurrentChat: async () => { reloads += 1; }, updateMessageBlock: id => redrawn.push(id) });
  const { base, style } = startSession(t, context);
  const plain = { mes: '普通的一楼。', is_user: false, extra: {} };
  const message = writtenFloor(style({ element: '火焰' }).css);
  context.chat.push(plain, message);

  __testing.saveSettings({ ...base, moveOverrides: { [CARD]: [{ name: '红莲拳', element: '冰霜' }] } });
  await __testing.processingRefresh();
  assert.ok(message.mes.includes(style({ element: '冰霜' }).css), '已经写好的楼层马上按新属性重画');
  assert.equal(reloads, 0, '不重新载入整个聊天');
  assert.deepEqual(redrawn, [1], '只重画改到的那一楼');

  __testing.saveSettings({ ...__testing.configureForTest({}), moveOverrides: {} });
  await __testing.processingRefresh();
  assert.ok(message.mes.includes(style({ element: '火焰' }).css), '恢复自动之后回到原来的颜色');
});

test('a 招式表 change never cancels a translation in flight', async t => {
  const context = mockHost([]);
  const { base, style } = startSession(t, context);
  context.chat.push(writtenFloor(style({ element: '火焰' }).css));
  let aborted = false;
  __testing.configureForTest({
    inflight: new Map([['fake-lock', {
      promise: new Promise(() => {}), controller: { abort: () => { aborted = true; } },
      sourceHash: 'x', messageId: 0, message: null, since: Date.now(),
    }]]),
  });
  __testing.saveSettings({ ...base, moveOverrides: { [CARD]: [{ name: '红莲拳', off: true }] } });
  await __testing.processingRefresh();
  assert.equal(aborted, false, '只改招式的画法，不取消正在翻译的楼层');
  assert.doesNotMatch(context.chat[0].mes, /style="/, '不上色马上生效');
});

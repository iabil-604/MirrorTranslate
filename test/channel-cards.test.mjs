import test from 'node:test';
import assert from 'node:assert/strict';

import { __testing } from '../index.js';

const { renderChannelCards, syncChannelFields, editingChannelId, configureForTest } = __testing;

// A tiny DOM stand-in covering exactly what renderChannelCards touches (createElement/createTextNode,
// appendChild/append/replaceChildren, dataset, className, setAttribute/getAttribute) — same style as
// console-autosave.test.mjs's fake header, just enough surface for a small element tree instead of one node.
// querySelector is a minimal stand-in too: only the plain tag-name lookup syncChannelFields actually
// does on a card node (`.querySelector('h2')`) needs to work here.

function makeElement(tag, doc) {
  const el = {
    tagName: String(tag).toUpperCase(),
    ownerDocument: doc,
    dataset: {},
    attrs: {},
    className: '',
    textContent: '',
    type: '',
    hidden: false,
    checked: false,
    value: '',
    children: [],
    parentNode: null,
    setAttribute(name, value) { el.attrs[name] = String(value); },
    getAttribute(name) { return name in el.attrs ? el.attrs[name] : null; },
    appendChild(node) {
      if (node.parentNode?.children) {
        const at = node.parentNode.children.indexOf(node);
        if (at >= 0) node.parentNode.children.splice(at, 1);
      }
      node.parentNode = el;
      el.children.push(node);
      return node;
    },
    append(...nodes) { for (const node of nodes) el.appendChild(node); },
    replaceChildren(...nodes) {
      for (const child of [...el.children]) child.parentNode = null;
      el.children = [];
      el.append(...nodes);
    },
    querySelector(selector) {
      const tag = String(selector).toUpperCase();
      const search = node => {
        for (const child of node.children) {
          if (child.tagName === tag) return child;
          const found = search(child);
          if (found) return found;
        }
        return null;
      };
      return search(el);
    },
  };
  return el;
}

function makeDoc() {
  const doc = {};
  doc.createElement = tag => makeElement(tag, doc);
  doc.createTextNode = text => ({ nodeType: 3, textContent: text, parentNode: null });
  return doc;
}

function makeChannelPageRoot() {
  const doc = makeDoc();
  const followRow = makeElement('div', doc);
  const host = makeElement('div', doc);
  const detail = makeElement('div', doc);
  const holder = makeElement('div', doc);
  detail.hidden = true;
  holder.hidden = true;
  const root = {
    dataset: {},
    querySelector(selector) {
      if (selector === '[data-jy-channel-use-row="follow"]') return followRow;
      if (selector === '[data-jy-channel-cards]') return host;
      if (selector === '[data-jy-channel-detail]') return detail;
      if (selector === '[data-jy-channel-detail-holder]') return holder;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-jy-channel-card]') return host.children;
      return [];
    },
  };
  return { root, host, detail, holder };
}

function findDescendant(el, predicate) {
  if (!el) return null;
  if (predicate(el)) return el;
  for (const child of el.children || []) {
    const found = findDescendant(child, predicate);
    if (found) return found;
  }
  return null;
}

function testSettings() {
  return {
    apiMode: 'independent',
    selectedChannelId: 'a',
    tts: { deepChannelId: 'follow' },
    channels: [
      { id: 'a', name: 'Chan A', url: 'https://a.example/v1', model: 'model-a', models: [] },
      { id: 'b', name: 'Chan B', url: '', model: '', models: [] },
    ],
  };
}

function cardFor(host, id) {
  return host.children.find(card => card.dataset.jyChannelCard === id);
}

function chevronOf(card) {
  const head = card.children.find(el => el.className === 'jy-channel-card-head');
  return head?.children.find(el => el.className === 'jy-channel-card-chevron');
}

// --- renderChannelCards ---------------------------------------------------------------------------
// Review finding index.js:8763: renderChannelCards moved the one shared detail-editor node into
// whichever card was `editing`; with no card ever allowed to be "the last one open", that always
// found a home. Once the chevron can collapse the last open card too, `editing` can be '' and the
// node must still land somewhere reachable instead of being left inside a card `replaceChildren` just
// discarded.

test('renderChannelCards opens the matching card: detail attached, its chevron expanded, the other collapsed', () => {
  const { root, host, detail, holder } = makeChannelPageRoot();
  renderChannelCards(root, testSettings(), 'a');

  const cardA = cardFor(host, 'a');
  const cardB = cardFor(host, 'b');
  assert.ok(cardA && cardB, 'both channels get a card');
  assert.equal(detail.parentNode, cardA, '打开的连接卡装着共享的编辑表单');
  assert.equal(detail.hidden, false);
  assert.equal(holder.children.length, 0, '有卡展开时holder是空的');

  const chevronA = chevronOf(cardA);
  const chevronB = chevronOf(cardB);
  assert.equal(chevronA.getAttribute('aria-expanded'), 'true');
  assert.equal(chevronA.getAttribute('aria-label'), '收起这条连接', '展开态说的是真能做到的动作');
  assert.equal(chevronA.textContent, '▾');
  assert.equal(chevronB.getAttribute('aria-expanded'), 'false');
  assert.equal(chevronB.getAttribute('aria-label'), '展开这条连接');
  assert.equal(chevronB.textContent, '▸');

  // Review finding index.js:8246: the chevron used to share its toggle's exact data-jy-action/
  // data-jy-channel-id pair, so focusIdentity() (test/console-panel.test.mjs) built the same selector
  // for both and a keyboard Enter on the chevron ended up refocusing the toggle instead.
  const toggleA = cardA.children.find(el => el.className === 'jy-channel-card-head').children[0];
  assert.equal(chevronA.dataset.jyChannelChevron, 'true', '箭头带着自己专属的标记');
  assert.equal(toggleA.dataset.jyChannelChevron, undefined, '展开按钮本身没有这个标记，两者才分得开');
});

test('renderChannelCards with editing === "" collapses every card and parks the detail node in the hidden holder, not losing it', () => {
  const { root, host, detail, holder } = makeChannelPageRoot();
  // First open card 'a' (as a real session would before collapsing it), then collapse.
  renderChannelCards(root, testSettings(), 'a');
  renderChannelCards(root, testSettings(), '');

  const cardA = cardFor(host, 'a');
  const cardB = cardFor(host, 'b');
  assert.equal(detail.parentNode, holder, '没有任何卡展开时，共享表单停在holder里，不会跟着旧卡一起被扔掉');
  assert.equal(detail.hidden, true);
  assert.equal(chevronOf(cardA).getAttribute('aria-expanded'), 'false');
  assert.equal(chevronOf(cardB).getAttribute('aria-expanded'), 'false');
  // The node itself must be the very same object, not a recreated stand-in — this is what "not losing
  // the editor node" means: its identity (and whatever it still holds) survives collapsing.
  assert.equal(holder.children[0], detail);
});

test('renderChannelCards can re-expand a different card after every card was collapsed', () => {
  const { root, host, detail, holder } = makeChannelPageRoot();
  renderChannelCards(root, testSettings(), 'a');
  renderChannelCards(root, testSettings(), '');
  renderChannelCards(root, testSettings(), 'b');

  const cardB = cardFor(host, 'b');
  assert.equal(detail.parentNode, cardB);
  assert.equal(detail.hidden, false);
  assert.equal(holder.children.length, 0);
  assert.equal(chevronOf(cardB).getAttribute('aria-expanded'), 'true');
});

// --- syncChannelFields({ rebuildCards: false }) ---------------------------------------------------
// Review finding index.js:12376: the channel-field autosave used to resync through syncFields(), which
// calls renderChannelCards() and replaces every card's head — including whichever chevron, toggle or
// 用在 checkbox a click is still in flight on (mousedown already fired, its `change`/blur handler ran,
// mouseup has not happened yet) — so that click was dispatched to a node no longer in the DOM and
// silently did nothing. A field settling is not one of renderChannelCards' real structural changes
// (add/delete/switch/collapse), so it must not go through it at all.

test('syncChannelFields({ rebuildCards: false }) updates the open card\'s heading without replacing the card, toggle or chevron nodes', () => {
  const { root, host } = makeChannelPageRoot();
  const settings = testSettings();
  renderChannelCards(root, settings, 'a');
  configureForTest({ editingChannelId: 'a' });

  const cardA = cardFor(host, 'a');
  const headA = cardA.children.find(el => el.className === 'jy-channel-card-head');
  const toggleA = headA.children[0];
  const chevronA = chevronOf(cardA);

  const renamed = { ...settings, channels: settings.channels.map(channel => (channel.id === 'a' ? { ...channel, name: '改名后的连接' } : channel)) };
  syncChannelFields(root, renamed, { rebuildCards: false });

  assert.equal(cardFor(host, 'a'), cardA, '连接卡节点没有被换成新的');
  assert.equal(cardA.children.find(el => el.className === 'jy-channel-card-head'), headA, '卡头节点没有被换掉');
  assert.equal(headA.children[0], toggleA, '展开/收起按钮没有被换掉——一次正在进行中的点击不会被吞掉');
  assert.equal(chevronOf(cardA), chevronA, '箭头按钮没有被换掉');

  const heading = findDescendant(cardA, el => el.tagName === 'H2');
  assert.equal(heading.textContent, '改名后的连接', '卡片标题跟着新名字更新');
  assert.equal(root.dataset.jyEditingChannelId, 'a');
});

test('syncChannelFields() with no options still rebuilds the cards (add/delete/switch/collapse keep going through the full render)', () => {
  const { root, host } = makeChannelPageRoot();
  const settings = testSettings();
  renderChannelCards(root, settings, 'a');
  configureForTest({ editingChannelId: 'a' });
  const cardA = cardFor(host, 'a');

  syncChannelFields(root, settings);

  assert.notEqual(cardFor(host, 'a'), cardA, '默认行为仍然是整体重建，结构性变化（新增/删除/切换/收起）要走这条路');
});

// --- editingChannelId -------------------------------------------------------------------------
// '' is a real, explicit "every card collapsed" state and must not fall back to the translation's
// connection the way `null` (nothing chosen yet) or a deleted channel's id does.

test('editingChannelId returns "" once the cards were explicitly collapsed, not the translation\'s connection', () => {
  configureForTest({ editingChannelId: '' });
  assert.equal(editingChannelId(testSettings()), '');
});

test('editingChannelId still falls back to the translation\'s connection, then the first, when nothing was explicitly collapsed', () => {
  configureForTest({ editingChannelId: null });
  assert.equal(editingChannelId(testSettings()), 'a', '未选择时跟随翻译当前使用的连接');

  configureForTest({ editingChannelId: 'missing' });
  assert.equal(editingChannelId(testSettings()), 'a', '记着的连接已经不存在时同样回退');

  configureForTest({ editingChannelId: 'b' });
  assert.equal(editingChannelId(testSettings()), 'b', '记着的连接仍然存在时就是它');
});

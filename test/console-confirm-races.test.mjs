import test from 'node:test';
import assert from 'node:assert/strict';

// worldInfoCharacterKey() (reached through collectColoringFields, which this stub's all-present
// [data-jy-coloring] makes collectSettings always run) calls getContext(), so this must exist before any
// of these tests run collectSettings/syncFields at all. Set before the import too, but harmless there —
// index.js's own module-level bootstrap only fires once `document` is *also* defined (see below), which
// it deliberately still is not at this point.
globalThis.SillyTavern = { getContext: () => ({ extensionSettings: {}, getRequestHeaders: () => ({}) }) };

const { __testing } = await import('../index.js');

// Only defined *after* the import: index.js's own module-level bootstrap (its last few lines) treats a
// `document` that exists alongside a SillyTavern context with `extensionSettings` as the real host and
// calls the real onActivate() at import time — registerRuntimeEvents, scheduleTtsDecorateAll and the
// rest, none of which this file wants running in the background and erroring out once its mocks are torn
// down after the tests finish. Setting `document` only now, once that check has already run and found it
// absent, gets every function this file actually calls (which all run synchronously within a test, well
// after this point) the same minimal stand-in test/gate.test.mjs already uses for the same purpose,
// without ever satisfying that bootstrap check.
globalThis.document = {
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  visibilityState: 'visible', hidden: false, head: null, body: null, documentElement: null,
  addEventListener() {}, removeEventListener() {},
  createElement: tag => ({ tagName: String(tag).toUpperCase(), value: '', textContent: '' }),
};

const {
  configureForTest, collectSettings, saveSettings, applyConnectionUseChange,
  deleteChannel, deleteProcessingProfile, fetchChannelModels, syncFields,
} = __testing;

// A "black hole" DOM stand-in: every querySelector/querySelectorAll call returns a brand new, fully
// mutable stub element rather than null/[] the way the smaller fixtures in the other console test files
// do. syncFields()'s own sub-syncs dereference a few of their querySelector results unconditionally
// (`root.querySelector('[data-jy-editor-placeholder]').hidden = …`, no `if (element)` guard) — real
// elements from the actual template, never absent there — so a plain null-returning fake root cannot run
// it end to end. This file only needs syncFields (called by deleteChannel/deleteProcessingProfile once
// they finish) to run without throwing; it does not assert anything about what it draws, only that
// settings themselves came out right, which collectSettings on a second, throwaway stub root confirms.
function makeStubDoc() {
  const doc = {};
  const makeEl = () => {
    const el = {
      ownerDocument: doc,
      dataset: {},
      style: {},
      className: '',
      textContent: '',
      // Not '': collectSettings() reads a present [data-jy-field="bodyTags"] as a real, currently-empty
      // 提取标签 field and refuses to save with zero tags — a real page never shows that field with
      // nothing extractable configured. A generic, always-valid tag-shaped placeholder value keeps every
      // such optional field collectSettings might reach through this auto-vivifying stub harmless.
      value: 'x',
      checked: false,
      hidden: false,
      disabled: false,
      type: '',
      children: [],
      parentNode: null,
      attrs: {},
      setAttribute(name, v) { el.attrs[name] = String(v); },
      getAttribute(name) { return name in el.attrs ? el.attrs[name] : null; },
      removeAttribute(name) { delete el.attrs[name]; },
      appendChild(node) { el.children.push(node); if (node && typeof node === 'object') node.parentNode = el; return node; },
      append(...nodes) { for (const node of nodes) el.appendChild(node); },
      remove() {
        if (el.parentNode) {
          const at = el.parentNode.children.indexOf(el);
          if (at >= 0) el.parentNode.children.splice(at, 1);
        }
        el.parentNode = null;
      },
      replaceChildren(...nodes) { el.children = []; el.append(...nodes); },
      replaceWith(...nodes) {
        if (el.parentNode) {
          const at = el.parentNode.children.indexOf(el);
          if (at >= 0) el.parentNode.children.splice(at, 1, ...nodes);
          for (const node of nodes) if (node && typeof node === 'object') node.parentNode = el.parentNode;
        }
        el.parentNode = null;
      },
      insertBefore(node) { return el.appendChild(node); },
      before() {}, after() {}, cloneNode: () => makeEl(),
      contains: node => el.children.includes(node),
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      querySelector: () => makeEl(),
      querySelectorAll: () => [],
      closest: () => null,
      matches: () => false,
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
      focus() {}, setSelectionRange() {}, scrollIntoView() {},
    };
    return el;
  };
  doc.createElement = () => makeEl();
  doc.createTextNode = text => ({ nodeType: 3, textContent: text, parentNode: null });
  return doc;
}

function makeStubRoot() {
  const doc = makeStubDoc();
  const root = doc.createElement();
  root.getRootNode = () => ({ activeElement: null });
  return root;
}

// A root that never crashes syncFields but never actually reads any real field either — used only to
// read `runtime.settings` back out through collectSettings after some action ran.
const readerRoot = makeStubRoot();

test('sanity: syncFields runs to completion against the stub root without throwing', () => {
  configureForTest({});
  assert.doesNotThrow(() => syncFields(makeStubRoot(), collectSettings(readerRoot)));
});

// --- applyConnectionUseChange (DESIGN §17.1; same reasoning as review finding index.js:12386) --------
// collectSettings(root) reads every page at once, so an invalid field left elsewhere (排除标签/提取标签,
// say) can fail this save even though the choice just made is perfectly fine. Only that one picker is put
// back on failure, and syncFields never runs on that path — a full resync would reset whatever the reader
// is still mid-editing on the other page, exactly the thing the 模型连接/翻译规则 autosaves already avoid.

function rootWithBrokenBodyTags() {
  // Empty 提取标签 fails collectSettings with '至少填写一个有效的正文提取标签名称。' (core.js's
  // parseTagNamesWithErrors returns no tags for an empty string, and collectSettings then throws).
  return { dataset: {}, querySelector: selector => (selector === '[data-jy-field="bodyTags"]' ? { value: '' } : null), querySelectorAll: () => [] };
}

// A <select> stand-in fillChannelPicker can refill: options by value, and the chosen value.
function makePicker(use, value) {
  const doc = {
    createElement: () => ({ value: '', textContent: '' }),
  };
  const select = {
    ownerDocument: doc,
    dataset: { jyUsePicker: use },
    value,
    options: [],
    replaceChildren(...options) { this.options = options; },
  };
  return select;
}

test('applyConnectionUseChange puts back only the picker just changed when collectSettings fails on an unrelated field, and never touches the setting', () => {
  configureForTest({ settings: { channels: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], tts: { deepChannelId: 'follow' } } });
  const before = collectSettings(readerRoot).tts.deepChannelId;

  const picker = makePicker('deep', 'b');
  applyConnectionUseChange(rootWithBrokenBodyTags(), picker);

  assert.equal(picker.value, 'follow', '保存失败时把刚改的这个下拉框放回原来的选择');
  assert.equal(collectSettings(readerRoot).tts.deepChannelId, before, '设置本身完全没变——没有被 setConnectionUse 写入 b');
});

test('applyConnectionUseChange saves the use just picked, and only that use', () => {
  configureForTest({ settings: { apiMode: 'independent', selectedChannelId: 'a', channels: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], tts: { deepChannelId: 'follow' } } });
  const picker = makePicker('deep', 'b');
  assert.doesNotThrow(() => applyConnectionUseChange(makeStubRoot(), picker));
  const saved = collectSettings(readerRoot);
  assert.equal(saved.tts.deepChannelId, 'b');
  assert.equal(saved.apiMode, 'independent', '翻译用的连接不跟着动');
  assert.equal(saved.selectedChannelId, 'a');
});

// --- deleteChannel (review finding index.js:11734) --------------------------------------------------
// collectSettings(root) taken before confirmDestructive's await is a snapshot of that instant; the await
// can span whatever else gets saved while the dialog is open (a slow 拉取模型 finishing, another field
// settling elsewhere). Deleting from that stale snapshot afterwards silently discards it, because
// saveSettings always replaces runtime.settings whole. deleteChannel now re-collects once its injected
// `confirm` resolves.

test('deleteChannel does not discard a save that happened while the confirm dialog was open', async () => {
  configureForTest({ settings: { channels: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], selectedChannelId: 'a' }, editingChannelId: 'b', deskExpandedChannelId: null });
  const root = makeStubRoot();

  const ok = await deleteChannel(root, 'b', {
    confirm: async () => {
      // Something else finishes saving while this dialog is still open — a third connection appears.
      const mid = collectSettings(root);
      mid.channels.push({ id: 'c', name: 'C' });
      saveSettings(mid);
      return true;
    },
  });

  assert.equal(ok, true);
  const ids = collectSettings(readerRoot).channels.map(c => c.id);
  assert.deepEqual(ids.sort(), ['a', 'c'], 'b 被删掉了，同时确认框打开期间新增的 c 完好保留');
});

test('deleteChannel changes nothing and returns false when the reader cancels', async () => {
  configureForTest({ settings: { channels: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], selectedChannelId: 'a' } });
  const root = makeStubRoot();
  const before = collectSettings(readerRoot).channels.map(c => c.id);
  const ok = await deleteChannel(root, 'b', { confirm: async () => false });
  assert.equal(ok, false);
  assert.deepEqual(collectSettings(readerRoot).channels.map(c => c.id), before);
});

test('deleteChannel refuses when confirming was the last thing that happened to leave only one connection', async () => {
  configureForTest({ settings: { channels: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], selectedChannelId: 'a' } });
  const root = makeStubRoot();
  await assert.rejects(
    () => deleteChannel(root, 'b', {
      confirm: async () => {
        // Someone else deleted connection 'a' while the dialog was open, leaving only 'b' — the very
        // one about to be deleted here.
        const mid = collectSettings(root);
        mid.channels = mid.channels.filter(c => c.id !== 'a');
        mid.selectedChannelId = 'b';
        saveSettings(mid);
        return true;
      },
    }),
    /至少保留一条连接/,
  );
});

// --- deleteProcessingProfile (review finding index.js:11734, the delete-processing scenario the review
// reproduced directly) --------------------------------------------------------------------------------

test('deleteProcessingProfile does not discard a save that happened while the confirm dialog was open (the reviewer\'s own fetch-models-during-confirm scenario)', async () => {
  configureForTest({ settings: { processingProfiles: [{ id: 'p1', name: 'P1', settings: {}, regexScripts: [] }, { id: 'p2', name: 'P2', settings: {}, regexScripts: [] }], selectedProcessingProfileId: 'p1' } });
  const root = makeStubRoot();

  const ok = await deleteProcessingProfile(root, {
    confirm: async () => {
      // The reviewer's own probe: a slow 拉取模型 (or any other save) lands while this dialog is open.
      const mid = collectSettings(root);
      mid.channels[0].models = ['m1', 'm2'];
      saveSettings(mid);
      return true;
    },
  });

  assert.equal(ok, true);
  const after = collectSettings(readerRoot);
  assert.deepEqual(after.processingProfiles.map(p => p.id), ['p2'], 'p1 被删掉了');
  assert.deepEqual(after.channels[0].models, ['m1', 'm2'], '确认框打开期间保存的模型列表没有被删除操作冲掉');
});

// --- fetchChannelModels (review finding index.js:11734's fetchChannelModels variant) -----------------
// The channel object captured before the request is orphaned the moment anything else saves during the
// request (saveSettings always rebuilds the whole channels array with fresh objects) — writing the
// fetched models onto that captured object then goes nowhere. fetchChannelModels now re-finds the
// connection by id from the live settings once the request resolves.

test('fetchChannelModels writes the fetched models onto the connection as it exists after the request, not the object captured before it', async () => {
  configureForTest({ settings: { channels: [{ id: 'a', name: 'A', url: 'https://a.example/v1', timeoutSec: 30 }], selectedChannelId: 'a' } });
  globalThis.SillyTavern = { getContext: () => ({ extensionSettings: {}, getRequestHeaders: () => ({}) }) };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    // While the request is in flight, something else saves and replaces every channel object — a rename,
    // say — with a brand new one that is no longer the object fetchChannelModels captured at the start.
    const mid = collectSettings(readerRoot);
    mid.channels[0].name = 'Renamed mid-flight';
    saveSettings(mid);
    return { ok: true, json: async () => ({ data: [{ id: 'gpt-x' }, { id: 'gpt-y' }] }) };
  };
  try {
    const models = await fetchChannelModels('a');
    assert.deepEqual(models, ['gpt-x', 'gpt-y']);
    const after = collectSettings(readerRoot);
    assert.equal(after.channels[0].name, 'Renamed mid-flight', '重命名保留了');
    assert.deepEqual(after.channels[0].models, ['gpt-x', 'gpt-y'], '模型列表写到了改名后仍然存在的这条连接上，没有丢');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('fetchChannelModels fails loudly instead of silently going nowhere when its connection was deleted mid-flight', async () => {
  configureForTest({ settings: { channels: [{ id: 'a', name: 'A', url: 'https://a.example/v1', timeoutSec: 30 }, { id: 'b', name: 'B' }], selectedChannelId: 'a' } });
  globalThis.SillyTavern = { getContext: () => ({ extensionSettings: {}, getRequestHeaders: () => ({}) }) };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const mid = collectSettings(readerRoot);
    mid.channels = mid.channels.filter(c => c.id !== 'a');
    mid.selectedChannelId = 'b';
    saveSettings(mid);
    return { ok: true, json: async () => ({ data: [{ id: 'gpt-x' }] }) };
  };
  try {
    await assert.rejects(() => fetchChannelModels('a'), /已经被删除/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { __testing } from '../index.js';

const { syncTtsFeatureVisibility } = __testing;

// A tiny DOM stand-in: exactly the surface syncTtsFeatureVisibility touches, so this needs no browser
// or jsdom dependency (same style as console-autosave.test.mjs's fake header).
function fakeRoot({ tabSelected = false } = {}) {
  const tab = { hidden: false, dataset: { jyTab: 'tts' }, attrs: { 'aria-selected': tabSelected ? 'true' : 'false' } };
  tab.getAttribute = name => tab.attrs[name] ?? null;
  const page = { dataset: {} };
  const shortcut = { hidden: false };
  return {
    tab, page, shortcut,
    querySelector(selector) {
      if (selector === '[data-jy-tab="tts"]') return tab;
      if (selector === '[data-jy-page="tts"]') return page;
      if (selector === '[data-jy-action="open-tts"]') return shortcut;
      return null;
    },
  };
}

test('DESIGN §15.1: normal mode has no 朗读 rail tab, even with reading turned on from 翻译台/微调', () => {
  const root = fakeRoot();
  syncTtsFeatureVisibility(root, { uiMode: 'normal', tts: { enabled: true } });
  assert.equal(root.tab.hidden, true, '正常模式的 rail 始终只有 翻译台·微调·运行记录 三页（DESIGN §15.1）');
});

test('normal mode keeps the tab hidden even while it would otherwise read as the selected tab', () => {
  const root = fakeRoot({ tabSelected: true });
  syncTtsFeatureVisibility(root, { uiMode: 'normal', tts: { enabled: true } });
  assert.equal(root.tab.hidden, true, '误留的 aria-selected 不能在正常模式下把这页带回来');
});

test('advanced mode keeps its pre-existing rule: the tab shows once reading is on, or stays if already selected', () => {
  const off = fakeRoot();
  syncTtsFeatureVisibility(off, { uiMode: 'advanced', tts: { enabled: false } });
  assert.equal(off.tab.hidden, true, '关着朗读时，没有停留在这页，标签收起');

  const onSelected = fakeRoot({ tabSelected: true });
  syncTtsFeatureVisibility(onSelected, { uiMode: 'advanced', tts: { enabled: false } });
  assert.equal(onSelected.tab.hidden, false, '关着朗读但正停留在这页时，标签不消失');

  const on = fakeRoot();
  syncTtsFeatureVisibility(on, { uiMode: 'advanced', tts: { enabled: true } });
  assert.equal(on.tab.hidden, false, '开着朗读时，高级模式的标签照常出现');
});

test('an unknown uiMode reads as advanced, matching pagesForMode\'s own fallback', () => {
  const root = fakeRoot();
  syncTtsFeatureVisibility(root, { uiMode: 'bogus', tts: { enabled: true } });
  assert.equal(root.tab.hidden, false, 'pagesForMode 对未知模式按高级模式处理，这里跟着一致');
});

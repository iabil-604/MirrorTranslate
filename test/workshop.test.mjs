import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setImmediate as flush } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { __testing } from '../index.js';
import { APP_VERSION, MODULE_ID } from '../core.js';

import {
  WORKSHOP_ENTRY_MARKUP,
  WORKSHOP_FOLD_MARKUP,
  WORKSHOP_LAYER_MARKUP,
  WORKSHOP_PAGE_MARKUP,
  createWorkshop,
  __workshop,
} from '../workshop.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

test('音色 ID 的提示：格式、Fish 核对、私有、重复', () => {
  const { judgeVoiceId } = __workshop;
  const good = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  assert.equal(judgeVoiceId('').ok, false);
  assert.equal(judgeVoiceId('has space').level, 'err');
  assert.equal(judgeVoiceId(good).ok, true);
  assert.equal(judgeVoiceId('short_id').level, 'warn');           // 格式可用，但不像 32 位
  assert.equal(judgeVoiceId(good, { duplicate: true }).ok, false);
  assert.match(judgeVoiceId(good, { fish: { id: good, author: 'Amber', visibility: 'public' } }).text, /Amber/);
  assert.equal(judgeVoiceId(good, { fish: { id: good, visibility: 'private' } }).ok, false);
  // 核对的是另一个 ID 时不算数
  assert.equal(judgeVoiceId(good, { fish: { id: 'other', visibility: 'private' } }).ok, true);
});

test('声纹和占位头像：同一个 ID 永远一样，名字里的符号被转义', () => {
  const { waveBars, bareCover, esc, avatarFallback } = __workshop;
  assert.equal(waveBars('abc', 20), waveBars('abc', 20));
  assert.notEqual(waveBars('abc', 20), waveBars('abd', 20));
  assert.equal((waveBars('abc', 20).match(/<i /g) ?? []).length, 20);
  assert.equal(bareCover('白露', 'seed'), bareCover('白露', 'seed'));
  assert.ok(!decodeURIComponent(bareCover('<img onerror=x>', 's')).includes('<img'));
  assert.ok(!decodeURIComponent(avatarFallback('<b>')).includes('<b>'));
  assert.equal(esc(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
});

test('数字、时间、语言的显示', () => {
  const { formatCount, timeAgo, baseLanguage, shortId } = __workshop;
  assert.equal(formatCount(999), '999');
  assert.equal(formatCount(1284), '1.3k');
  assert.equal(formatCount(2000), '2k');
  const now = Date.UTC(2026, 0, 10, 12);
  assert.equal(timeAgo(now - 60000, now), '刚刚');
  assert.equal(timeAgo(now - 5 * 3600000, now), '5 小时前');
  assert.equal(timeAgo(now - 3 * 86400000, now), '3 天前');
  assert.equal(baseLanguage('en-GB'), 'en');
  assert.equal(baseLanguage('ja'), 'ja');
  assert.equal(baseLanguage('de'), 'other');
  assert.equal(shortId('a1b2c3d4e5f60718293a4b5c6d7e8f90'), 'a1b2c3…8f90');
  assert.equal(shortId('short'), 'short');
});

test('没有浏览器存储、没填服务器地址时不会出错', () => {
  assert.equal(__workshop.apiBase(), '');
  assert.equal(__workshop.readSession(), null);
});

test('页面、栏目、抽屉的 HTML 有各自需要的挂点，没有重复的 data-jy-page', () => {
  assert.match(WORKSHOP_FOLD_MARKUP, /data-jy-fold="tts-workshop"/);
  assert.match(WORKSHOP_ENTRY_MARKUP, /data-jy-ws-go="workshop"/);
  assert.match(WORKSHOP_FOLD_MARKUP, /data-jy-ws-go="workshop"/);
  assert.match(WORKSHOP_PAGE_MARKUP, /data-jy-page="workshop"/);
  for (const hook of ['data-jy-ws-gate', 'data-jy-ws-main', 'data-jy-ws-grid', 'data-jy-ws-login', 'data-jy-ws-search', 'data-jy-ws-chips']) {
    assert.ok(WORKSHOP_PAGE_MARKUP.includes(hook), hook);
  }
  for (const hook of ['data-jy-ws-sheet="detail"', 'data-jy-ws-sheet="submit"', 'data-jy-ws-form', 'data-jy-ws-toast', 'data-jy-ws-scrim']) {
    assert.ok(WORKSHOP_LAYER_MARKUP.includes(hook), hook);
  }
  // 抽屉一开始都是收起的，否则会被焦点陷阱当成可聚焦内容
  assert.match(WORKSHOP_LAYER_MARKUP, /data-jy-ws-sheet="detail"[^>]*hidden/);
  assert.match(WORKSHOP_LAYER_MARKUP, /data-jy-ws-sheet="submit"[^>]*hidden/);
  assert.match(WORKSHOP_PAGE_MARKUP, /^<section[^>]*data-jy-page="workshop"[^>]*hidden>/);
});

test('正常模式和高级模式共用一个工坊页面，抽屉覆盖控制中心', () => {
  const start = indexSource.indexOf('const CONTROL_CENTER_MARKUP = `');
  const end = indexSource.indexOf('const FALLBACK_PANEL_CSS');
  const markup = indexSource.slice(start, end);
  for (const name of ['WORKSHOP_ENTRY_MARKUP', 'WORKSHOP_FOLD_MARKUP', 'WORKSHOP_PAGE_MARKUP', 'WORKSHOP_LAYER_MARKUP']) {
    assert.equal(markup.split(`\${${name}}`).length - 1, 1, `${name} 恰好出现一次`);
  }
  const finetune = markup.slice(markup.indexOf('data-jy-page="finetune"'), markup.indexOf('data-jy-page="prompt"'));
  assert.ok(finetune.includes('${WORKSHOP_ENTRY_MARKUP}'));
  assert.ok(markup.indexOf('${WORKSHOP_FOLD_MARKUP}') > markup.indexOf('data-jy-fold="tts-library"'));
  assert.ok(markup.indexOf('${WORKSHOP_FOLD_MARKUP}') < markup.indexOf('data-jy-fold="tts-deep"'));
  // 抽屉层在 <main> 外面（要盖住整个窗口），页面在 <main> 里面
  assert.ok(markup.indexOf('${WORKSHOP_PAGE_MARKUP}') < markup.indexOf('</main>'));
  assert.ok(markup.indexOf('${WORKSHOP_LAYER_MARKUP}') > markup.indexOf('</main>'));
});

test('index.js 的接线：保持入口所在页面的高亮，Esc 先关抽屉', () => {
  assert.ok(indexSource.includes(`from './workshop.js?v=${APP_VERSION}'`));
  assert.match(indexSource, /const litTab = target === 'workshop' \? workshopParentPage\(\) : target;/);
  assert.match(indexSource, /uiMode === 'normal' \? 'finetune' : 'tts'/);
  assert.match(indexSource, /workshop\.onSelect\(target\)/);
  assert.match(indexSource, /escape: \(\) => workshop\.handleEscape\(\)/);
  assert.match(indexSource, /if \(controller\.escape\(\)\) return;/);
  assert.match(indexSource, /workshop\.cleanup\(\);/);
});

test('样式只用现有令牌，且没有把弹层挂在 .jy-workspace 里', () => {
  const block = styleSource.slice(styleSource.indexOf('音色工坊（workshop.js）'));
  const tokens = new Set([...styleSource.matchAll(/(--jy-[a-z0-9-]+)\s*:/g)].map(match => match[1]));
  for (const used of new Set([...block.matchAll(/var\((--jy-[a-z0-9-]+)/g)].map(match => match[1]))) {
    if (used.startsWith('--jy-ws-')) continue;                    // 工坊自己的 --jy-ws-serif
    assert.ok(tokens.has(used), `${used} 在样式里没有定义`);
  }
  assert.match(block, /\.jy-ws-layer \{ position: absolute; inset: 0;/);
});

test('没有工坊的 HTML 时，createWorkshop 什么都不做也不抛错', () => {
  const empty = { querySelector: () => null };
  const workshop = createWorkshop(empty, {});
  assert.equal(workshop.handleEscape(), false);
  workshop.onSelect('workshop');
  workshop.cleanup();
});

const BASE = 'https://workshop.example';
const STATE = 's'.repeat(43);
const TOKEN = 't'.repeat(43);
const USER = { id: '12345', name: '读者' };
const API_OVERRIDE = 'jingyi.workshop.api';
const SESSION = 'jingyi.workshop.session.v1';

function authorize(base = BASE) {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({
    response_type: 'code', scope: 'identify', state: STATE, redirect_uri: `${base}/api/auth/callback`,
  });
  return url.href;
}

function replaceGlobal(t, key, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
}

function fixture(t, { base = BASE, session = null } = {}) {
  const nodes = new Map();
  const handlers = new Map();
  const opened = [];
  const storage = new Map([[API_OVERRIDE, base]]);
  if (session) storage.set(SESSION, JSON.stringify(session));
  class Element {
    dataset = {};
    hidden = false;
    isConnected = true;
    classList = { add() {}, remove() {}, toggle() {} };
    removeAttribute(name) { delete this[name]; }
    setAttribute(name, value) { this[name] = value; }
    focus() { doc.activeElement = this; }
    querySelector = get;
    querySelectorAll() { return []; }
    appendChild() {}
    remove() {}
  }
  function get(selector) {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector);
  }
  const doc = {
    visibilityState: 'visible',
    createElement: () => new Element(),
    addEventListener: (key, handler) => handlers.set(key, handler),
    removeEventListener: key => handlers.delete(key),
  };
  const root = {
    querySelector: get, querySelectorAll: () => [], ownerDocument: doc, getRootNode: () => doc,
    addEventListener: doc.addEventListener, removeEventListener: doc.removeEventListener,
  };
  replaceGlobal(t, 'Element', Element);
  replaceGlobal(t, 'CSS', { escape: value => value });
  replaceGlobal(t, 'open', url => { opened.push(url); });
  replaceGlobal(t, 'localStorage', {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  });
  return {
    root, get, opened, storage,
    visible: () => handlers.get('visibilitychange')(),
    click(selector, dataset = {}, parents = {}) {
      const target = get(selector);
      target.dataset = dataset;
      target.closest = hook => hook === selector || selector.startsWith(`${hook.slice(0, -1)}=`) ? target : (parents[hook] ?? null);
      handlers.get('click')({ target });
    },
  };
}

test('没有工坊地址时禁用登录，旧的未绑定会话不发请求', async t => {
  const view = fixture(t, { base: '', session: { token: TOKEN, user: USER } });
  const network = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected fetch'); });
  const workshop = createWorkshop(view.root);
  t.after(() => workshop.cleanup());
  workshop.onSelect('workshop');
  view.click('[data-jy-ws-login]');
  await flush();
  assert.equal(view.get('[data-jy-ws-login]').disabled, true);
  assert.match(view.get('[data-jy-ws-notice]').textContent, /未配置/);
  assert.equal(network.mock.callCount(), 0);
});

test('工坊的登录和 Bearer 凭证只用于配置时选中的服务', async t => {
  const view = fixture(t, { session: { base: BASE, token: TOKEN, user: USER } });
  assert.equal(__workshop.discordAuthorizeUrl(authorize(), BASE, STATE), authorize());
  assert.equal(__workshop.discordAuthorizeUrl(authorize('https://wrong.example'), BASE, STATE), '');
  assert.equal(__workshop.discordAuthorizeUrl('javascript:alert(1)', BASE, STATE), '');
  const calls = t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true, items: [] }));
  const first = createWorkshop(view.root);
  view.storage.set(API_OVERRIDE, 'https://second.example/');
  first.onSelect('workshop');
  await flush();
  const [url, init] = calls.mock.calls[0].arguments;
  assert.equal(new URL(url).origin, BASE);
  assert.equal(init.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(init.redirect, 'error');
  first.cleanup();
  const second = createWorkshop(view.root);
  t.after(() => second.cleanup());
  second.onSelect('workshop');
  await flush();
  assert.equal(view.get('[data-jy-ws-gate]').hidden, false);
  assert.equal(calls.mock.callCount(), 1);
  view.storage.set(API_OVERRIDE, 'http://example.test');
  assert.equal(__workshop.apiBase(), '');
  view.storage.set(API_OVERRIDE, 'http://localhost:8787/');
  assert.equal(__workshop.apiBase(), 'http://localhost:8787');
});

test('授权取消或面板关闭后，迟到的授权结果不能登录', async t => {
  const view = fixture(t);
  const result = Promise.withResolvers();
  const start = Promise.withResolvers();
  let starts = 0;
  let pollSignal;
  let startSignal;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (new URL(input).pathname === '/api/auth/start') {
      starts += 1;
      startSignal = init.signal;
      return starts === 1 ? Response.json({ ok: true, state: STATE, url: authorize() }) : start.promise;
    }
    assert.equal(new URL(input).pathname, '/api/auth/poll');
    pollSignal = init.signal;
    return result.promise;
  });
  const workshop = createWorkshop(view.root);
  t.after(() => workshop.cleanup());
  view.click('[data-jy-ws-login]');
  await flush();
  assert.deepEqual(view.opened, [authorize()]);
  view.visible();
  await flush();
  view.click('[data-jy-ws-login-cancel]');
  assert.equal(pollSignal.aborted, true);
  result.resolve(Response.json({ ok: true, status: 'done', token: TOKEN, user: USER }));
  await flush();
  assert.equal(view.storage.has(SESSION), false);
  view.click('[data-jy-ws-login]');
  workshop.cleanup();
  assert.equal(startSignal.aborted, true);
  start.resolve(Response.json({ ok: true, state: STATE, url: authorize() }));
  await flush();
  assert.deepEqual(view.opened, [authorize()]);
  assert.equal(view.storage.has(SESSION), false);
});

test('工坊登录后可浏览、复制和存进镜译音色库，退出后清除会话', async t => {
  const view = fixture(t);
  const voice = { id: 'voice001', name: '白露', fishId: 'a'.repeat(32), lang: 'zh', copies: 0, src: '原创' };
  const responses = new Map([
    ['/api/auth/start', { ok: true, state: STATE, url: authorize() }],
    ['/api/auth/poll', { ok: true, status: 'done', token: TOKEN, user: USER }],
    ['/api/voices', { ok: true, items: [voice] }],
    ['/api/voices/voice001/copy', { ok: true, copies: 1 }],
    ['/api/auth/logout', { ok: true }],
  ]);
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const path = new URL(input).pathname;
    seen.push(path);
    assert.ok(responses.has(path));
    if (path === '/api/voices' || path.endsWith('/copy') || path.endsWith('/logout')) {
      assert.equal(init.headers.authorization, `Bearer ${TOKEN}`);
    } else assert.equal(init.headers.authorization, undefined);
    return Response.json(responses.get(path));
  });
  const settings = __testing.configureForTest({ settings: { voiceLibrary: [], translationScope: 'dialogue' } });
  const context = { extensionSettings: { [MODULE_ID]: settings } };
  replaceGlobal(t, 'SillyTavern', { getContext: () => context });
  const copied = [];
  const selected = [];
  const libraryRoot = { querySelector: () => null, querySelectorAll: () => [] };
  const workshop = createWorkshop(view.root, {
    selectTab: target => selected.push(target),
    copyText: async text => { copied.push(text); },
    addToLibrary: entry => __testing.addWorkshopVoiceToLibrary(libraryRoot, entry),
  });
  t.after(() => workshop.cleanup());
  view.click('[data-jy-ws-go="workshop"]', { jyWsGo: 'workshop' });
  workshop.onSelect('workshop');
  view.click('[data-jy-ws-login]');
  await flush();
  view.visible();
  await flush();
  assert.match(view.get('[data-jy-ws-grid]').innerHTML, /白露/);
  assert.equal(JSON.parse(view.storage.get(SESSION)).base, BASE);

  const card = view.get('[data-jy-ws-card]');
  card.dataset.jyWsCard = voice.id;
  view.click('[data-jy-ws-open]', {}, { '[data-jy-ws-card]': card });
  assert.equal(workshop.activeSheet(), view.get('[data-jy-ws-sheet="detail"]'));
  view.click('[data-jy-ws-library]');
  view.click('[data-jy-ws-library]');
  const persisted = context.extensionSettings[MODULE_ID];
  assert.equal(persisted.voiceLibrary.length, 1);
  assert.equal(persisted.voiceLibrary[0].voiceId, voice.fishId);
  assert.equal(persisted.translationScope, 'dialogue');
  view.click('[data-jy-ws-detail-copy]');
  await flush();
  assert.deepEqual(copied, [voice.fishId]);
  assert.equal(workshop.handleEscape(), true);
  assert.equal(workshop.activeSheet(), null);
  view.click('[data-jy-ws-logout]');
  await flush();
  assert.equal(view.storage.has(SESSION), false);
  assert.equal(view.get('[data-jy-ws-gate]').hidden, false);
  view.click('[data-jy-ws-go="back"]', { jyWsGo: 'back' });
  assert.deepEqual(selected, ['workshop', 'back']);
  assert.deepEqual(seen, [...responses.keys()]);
});

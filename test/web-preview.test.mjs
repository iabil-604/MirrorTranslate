import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
const fromPreview = new URL('../preview.html', import.meta.url);
test('web beta can insert during dialogue translation, clear it safely and open both trial pages', async t => {
  const preview = await readFile(fromPreview, 'utf8');
  const script = preview.match(/<script type="module">([\s\S]+?)<\/script>/)[1];
  const extension = await import(new URL('./index.js', fromPreview));
  const elements = new Map();
  function element(selector, props = {}) {
    const handlers = new Map();
    const node = {
      disabled: true, textContent: '', innerHTML: '', addEventListener(type, handler) { handlers.set(type, handler); },
      click() { return handlers.get('click')?.(); }, ...props,
    };
    elements.set(selector, node);
    return node;
  }
  for (const id of ['beta-translate','beta-insert','beta-clear','beta-fish-web-open','beta-workshop-open','beta-entry-status','beta-status','beta-raw']) {
    assert.ok(preview.includes('id="' + id + '"'));
    element('#' + id);
  }
  element('#chat .mes_text');
  let selected;
  let enteredWorkshop = false;
  const fold = { open: false };
  const panel = {
    querySelector(selector) {
      if (selector === '[data-jy-tab="fish-center"]') return { dataset: { jyTab: 'fish-center' }, click() { selected = 'fish-center'; } };
      if (selector.includes('[data-jy-tab="finetune"]')) return { dataset: { jyTab: 'finetune' }, click() { selected = 'finetune'; } };
      if (selector === '[data-jy-page="finetune"] [data-jy-ws-go="workshop"]') return { click() { enteredWorkshop = true; }, closest() { return fold; } };
      return null;
    },
  };
  element('#jingyi-translator-menu-entry');
  element('#jingyi-translator-panel-host', { shadowRoot: panel });
  const globals = ['document', 'location', 'localStorage', 'fetch', 'SillyTavern', 'toastr', '__JINGYI_PREVIEW__'];
  const previous = globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  t.after(() => {
    extension.__testing.configureForTest({ initialized: false });
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  globalThis.document = { querySelector: key => elements.get(key) ?? null, querySelectorAll: () => [], getElementById: () => null };
  globalThis.location = new URL('http://127.0.0.1:8768/');
  globalThis.localStorage = { setItem() {} };
  globalThis.fetch = async url => {
    assert.equal(url, '/preview/workshop/session');
    return Response.json({ ok: true, base: location.origin, token: 'preview', user: {} });
  };
  const prepared = script
    .replace("await extension.onActivate();", "extension.__testing.initializeSettings(); extension.__testing.configureForTest({ initialized: true });")
    .replace(/import\('(\.\/[^']+)'\)/g, (_match, file) => 'import(' + JSON.stringify(new URL(file, fromPreview).href) + ')');
  await import('data:text/javascript;base64,' + Buffer.from(prepared).toString('base64'));
  const { context } = globalThis.__JINGYI_PREVIEW__;
  const get = key => elements.get('#beta-' + key);
  assert.equal(context.extensionSettings['jingyi-translator'].translationScope, 'dialogue');
  assert.equal(context.extensionSettings['jingyi-translator'].tts.enabled, true);
  assert.equal(get('translate').disabled, false);
  assert.equal(get('workshop-open').disabled, false);
  await get('fish-web-open').click();
  assert.equal(selected, 'fish-center');
  await get('workshop-open').click();
  assert.equal(selected, 'finetune');
  assert.ok(fold.open && enteredWorkshop);
  const translating = get('translate').click();
  for (let i = 0; i < 100 && get('insert').disabled; i++) await sleep(5);
  assert.equal(get('insert').disabled, false, get('status').textContent);
  get('insert').click();
  await translating;
  assert.match(get('status').textContent, /翻译完成。标签块完整保留/);
  const tag = '<bbi_image data-preview="late-insert">\n🖼 试用插图「这一段保留原样」。\n</bbi_image>';
  assert.ok(context.chat[0].mes.includes(tag));
  assert.match(context.chat[0].mes, /Will you come again tomorrow/);
  assert.doesNotMatch(context.chat[0].mes, /模拟思考标记|Rain fell outside/);
  assert.equal(get('raw').textContent, context.chat[0].mes);
  await get('clear').click();
  assert.match(get('status').textContent, /译文已清除，插入标签仍在/);
  assert.ok(context.chat[0].mes.includes(tag));
  assert.doesNotMatch(context.chat[0].mes, /Will you come again tomorrow/);
});

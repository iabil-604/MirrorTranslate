import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODULE_ID, MESSAGE_META_KEY, assembleBilingual, segmentSource,
  stripGeneratedTranslationLines, interceptGenerationChat,
} from '../core.js';
import {
  normalizeProcessingSettings, makeBuiltinReadingProfile, selectProcessingProfile,
  syncNativeRegex, compileNativeRegex,
} from '../processing.js';
import { __testing } from '../index.js';

const base = () => normalizeProcessingSettings({ showFloatingButton: false });
const copy = (rule, id, extra = {}) => ({ ...structuredClone(rule), id, scriptName: '重命名的副本', ...extra });
const display = (rules, text) => rules.filter(r => !r.disabled && r.markdownOnly && r.placement.includes(2))
  .reduce((value, r) => value.replace(compileNativeRegex(r.findRegex), r.replaceString), text);
function oldProjection(source, settings) {
  const parts = segmentSource(source, { ...settings, segmentationVersion: 4 });
  return assembleBilingual(parts.layout, new Map(parts.segments.map(part => [part.id, '中文译文。'])), settings);
}
function compatibilityRule(profile) {
  const rule = syncNativeRegex([], profile).find(r => r.id === MODULE_ID + ':display-role-compat');
  assert.ok(rule, 'the native display pipeline includes the old-role compatibility rule');
  return rule;
}

test('applying a builtin disables exact unowned copies while preserving edited and foreign rules', () => {
  const old = makeBuiltinReadingProfile(base(), 'fold');
  const next = makeBuiltinReadingProfile(base(), 'minimal');
  const original = old.regexScripts[0];
  const untouched = copy(original, 'old-copy');
  const edited = [
    copy(original, 'changed-template', { replaceString: original.replaceString + '<!-- mine -->' }),
    copy(original, 'changed-pattern', { findRegex: '/my-source/g' }),
    copy(original, 'changed-placement', { placement: [1, 2] }),
    copy(original, 'changed-stage', { promptOnly: true }),
    copy(original, 'changed-edit', { runOnEdit: false }),
    copy(original, 'changed-depth', { minDepth: 0 }),
    copy(original, 'changed-trim', { trimStrings: ['mine'] }),
    copy(original, 'unknown-future-field', { futureBehavior: true }),
    copy(original, 'other-owner', { jingyi_managed: { owner: 'another-extension' } }),
  ];
  const before = [untouched, ...edited, ...syncNativeRegex([], old)];
  const snapshot = structuredClone(before);
  const after = syncNativeRegex(before, next, { disableBuiltinCopies: true });
  assert.equal(after.find(r => r.id === untouched.id).disabled, true);
  assert.equal(after.find(r => r.id === untouched.id).replaceString, original.replaceString);
  assert.equal(after.find(r => r.id === untouched.id).scriptName, untouched.scriptName);
  for (const rule of edited) assert.deepEqual(after.find(r => r.id === rule.id), rule);
  assert.deepEqual(before, snapshot, 'do not mutate the previous settings object');
  assert.deepEqual(syncNativeRegex(after, next, { disableBuiltinCopies: true }), after, 'reapplying is idempotent');
});

test('ordinary saves and custom profiles leave unowned builtin copies enabled', () => {
  const old = makeBuiltinReadingProfile(base(), 'fold');
  const rule = copy(old.regexScripts[0], 'old-copy');
  const next = makeBuiltinReadingProfile(base(), 'minimal');
  assert.deepEqual(syncNativeRegex([rule], next).find(r => r.id === rule.id), rule);
  const custom = { ...next, settings: { ...next.settings, segmentPrefix: '<my-source>' } };
  assert.deepEqual(syncNativeRegex([rule], custom, { disableBuiltinCopies: true }).find(r => r.id === rule.id), rule);
});

test('an untouched old numbered-capture builtin copy is disabled without deleting it', () => {
  const old = makeBuiltinReadingProfile(base(), 'cute');
  const legacy = copy(old.regexScripts[0], 'legacy-copy', {
    findRegex: '/<jy-source>([\\s\\S]*?)<\\/jy-source>\\n<jy-translation>([\\s\\S]*?)<\\/jy-translation>/g',
    replaceString: old.regexScripts[0].replaceString.replace('$<jySource>', '$1').replace('$<jyTranslation>', '$2'),
  });
  const next = makeBuiltinReadingProfile(base(), 'fold');
  const result = syncNativeRegex([legacy], next, { disableBuiltinCopies: true }).find(r => r.id === legacy.id);
  assert.deepEqual(result, { ...legacy, disabled: true });
});

test('reapplying the active builtin refreshes the chat when only an old copy is disabled', async t => {
  const keys = ['document', 'SillyTavern', 'toastr'];
  const previous = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => {
    __testing.configureForTest({ initialized: false });
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const settings = base();
  const active = makeBuiltinReadingProfile(settings, 'minimal');
  settings.processingProfiles.push(active);
  const selected = selectProcessingProfile(settings, active.id);
  const old = makeBuiltinReadingProfile(settings, 'fold');
  const stale = copy(old.regexScripts[0], 'old-copy');
  const mes = oldProjection('原文。', selected);
  let reloads = 0, saves = 0;
  const context = {
    chatId: 'builtin-reapply', chat: [{ mes, extra: { [MESSAGE_META_KEY]: { schema_version: 4 } } }],
    extensionSettings: { [MODULE_ID]: structuredClone(selected), regex: [stale, ...syncNativeRegex([], active)] },
    saveChat: async () => { saves += 1; }, reloadCurrentChat: async () => { reloads += 1; }, saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => context };
  globalThis.document = { getElementById: () => null, createElement: () => ({ style: {} }), head: { appendChild() {} } };
  globalThis.toastr = Object.fromEntries(['success', 'error', 'warning', 'info'].map(k => [k, () => {}]));
  __testing.configureForTest({ settings: selected, initialized: true, inflight: new Map(), mainGenerationActive: false });
  __testing.saveSettings(structuredClone(selected), { applyBuiltinStyle: true });
  await __testing.processingRefresh();
  assert.equal(context.extensionSettings.regex.find(r => r.id === stale.id).disabled, true);
  assert.equal(reloads, 1, 'a native rule state change also needs an immediate redraw');
  assert.equal(saves, 0);
  assert.equal(context.chat[0].mes, mes);
  assert.match(display(context.extensionSettings.regex, mes), /jy-reading-minimal/);
});

test('old single-role projections put both languages inside the card in either rule order', () => {
  const profile = makeBuiltinReadingProfile(base(), 'fold');
  const source = '<demon name="莉娜" mood="害怕">あの……。</demon>';
  const raw = oldProjection(source, profile.settings);
  const card = { id: 'role-card', scriptName: '角色卡', findRegex: '/<demon\\b[^>]*>([\\s\\S]*?)<\\/demon>/g', replaceString: '<section data-role-card>$1</section>', placement: [2], markdownOnly: true };
  for (const cardFirst of [true, false]) {
    const existing = cardFirst ? [card, ...syncNativeRegex([], profile)] : [...syncNativeRegex([], profile), card];
    const output = display(syncNativeRegex(existing, profile), raw);
    const body = output.match(/<section data-role-card>([\s\S]*?)<\/section>/)?.[1];
    assert.ok(body?.includes('あの……。'));
    assert.ok(body?.includes('中文译文。'));
  }
  assert.equal(stripGeneratedTranslationLines(raw), source);
  const prompt = [{ mes: raw }];
  interceptGenerationChat(prompt);
  assert.equal(prompt[0].mes, source);
  const rule = compatibilityRule(profile);
  assert.equal(rule.markdownOnly, true);
  assert.equal(rule.promptOnly, false);
});

test('display compatibility preserves quoted attributes, case and carried inline markup', () => {
  const profile = makeBuiltinReadingProfile(base(), 'minimal');
  const rule = compatibilityRule(profile);
  const input = '<jy-source>\n<Demon-Card name="莉娜 > 小莉" mood=\'害怕\'><em>あの……。</em></dEmOn-CaRd>\n</jy-source>\n<jy-translation><b>中文译文。</b></jy-translation>';
  const expected = '<Demon-Card name="莉娜 > 小莉" mood=\'害怕\'><jy-source>\n<em>あの……。</em>\n</jy-source>\n<jy-translation><b>中文译文。</b></jy-translation></dEmOn-CaRd>';
  const result = input.replace(compileNativeRegex(rule.findRegex), rule.replaceString);
  assert.equal(result, expected);
  assert.equal(result.replace(compileNativeRegex(rule.findRegex), rule.replaceString), result);
});

test('display compatibility leaves complex, HTML and incomplete old containers alone', () => {
  const profile = makeBuiltinReadingProfile(base(), 'fold');
  const rule = compatibilityRule(profile);
  for (const source of [
    '<demon>日文。<thoughts>思考。</thoughts></demon>',
    '<demon>一。</demon><demon>二。</demon>',
    '<div class="custom">原文。</div>', '<span>原文。</span>',
    '<demon>没有闭合。', '<demon/>原文。</demon>', '<say>「原文。」</say>', '<jy-internal>原文。</jy-internal>',
    '<demon><% const value = 1; %>原文。</demon>', '<demon name="<%= who %>">原文。</demon>',
    '<demon><script>const value = 1;</script>原文。</demon>', '<demon><code>原文。</code></demon>',
  ]) {
    const input = '<jy-source>' + source + '</jy-source>\n<jy-translation>中文译文。</jy-translation>';
    assert.equal(input.replace(compileNativeRegex(rule.findRegex), rule.replaceString), input, source);
  }
  const broken = '<jy-source><demon>未闭合</jy-source>\n<jy-translation>第一段。</jy-translation>';
  const ejsTranslation = '<jy-source><demon>原文。</demon></jy-source>\n<jy-translation><%= value %></jy-translation>';
  assert.equal(ejsTranslation.replace(compileNativeRegex(rule.findRegex), rule.replaceString), ejsTranslation);
  const valid = '<jy-source><demon>原文。</demon></jy-source>\n<jy-translation>第二段。</jy-translation>';
  const output = (broken + '\n' + valid).replace(compileNativeRegex(rule.findRegex), rule.replaceString);
  assert.ok(output.startsWith(broken + '\n'));
  assert.ok(output.endsWith('<demon><jy-source>原文。</jy-source>\n<jy-translation>第二段。</jy-translation></demon>'));
});

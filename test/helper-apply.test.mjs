import test from 'node:test';
import assert from 'node:assert/strict';

import { __testing } from '../index.js';
import { CONSOLE_PRESET_IDS, PRESET_MANAGED_FIELDS, mergeSettings, presetContent } from '../core.js';
import { REGEX_OWNER_KEY, dedupeManagedRegexScripts, getActiveProcessingProfile, normalizeProcessingSettings, planRegexCleanup } from '../processing.js';
import { MODULE_ID } from '../core.js';
import { extractControlCenterKnowledge } from '../helper.js';

const { applyHelperSetSuggestion, helperRegexSnapshot, configureForTest, CONTROL_CENTER_MARKUP } = __testing;

// ---------------------------------------------------------------------------------------------
// applyHelperSetSuggestion — DESIGN §16 item 7's re-validate-then-apply step, factored out of the
// 'helper-apply' click branch so it runs headless. Review finding index.js:12226: the click branch
// called a name (`validateHelperSuggestion`) index.js never imported, so every one of the 16
// whitelisted `set` fields threw a ReferenceError the instant "照这样改" was clicked, and nothing in
// the suite exercised that branch to catch it.
// ---------------------------------------------------------------------------------------------

test('applyHelperSetSuggestion applies an ordinary boolean field without throwing (regression: validateHelperSuggestion must be imported)', () => {
  const current = mergeSettings({ autoGeneration: true });
  const result = applyHelperSetSuggestion(current, { type: 'set', field: 'autoGeneration', value: false });
  assert.equal(result.outcome, 'done');
  assert.equal(result.next.autoGeneration, false);
  assert.equal(current.autoGeneration, true, '原对象不变');
});

test('applyHelperSetSuggestion reports a no-op instead of throwing when the suggestion no longer changes anything', () => {
  const current = mergeSettings({ autoGeneration: false });
  const result = applyHelperSetSuggestion(current, { type: 'set', field: 'autoGeneration', value: false });
  assert.equal(result.outcome, 'noop');
  assert.equal(result.next, undefined);
});

test('applyHelperSetSuggestion reports a no-op for an unknown field or an out-of-whitelist value, never throwing', () => {
  assert.equal(applyHelperSetSuggestion(mergeSettings({}), { type: 'set', field: 'apiKey', value: 'sk-x' }).outcome, 'noop');
  assert.equal(applyHelperSetSuggestion(mergeSettings({}), { type: 'set', field: 'tts', value: { mode: 'deep' } }).outcome, 'noop');
});

test('applyHelperSetSuggestion routes a uiMode suggestion through so the caller can flip the live UI too (review finding index.js:12234)', () => {
  // schemaVersion has to be a real, current one — mergeSettings treats anything <= 12 (the default
  // when it is left out) as an old save and forces uiMode to 'advanced' regardless of what is asked
  // for, which would make this very suggestion a no-op before it even got to applyHelperSetSuggestion.
  const current = mergeSettings({ uiMode: 'normal', schemaVersion: 13 });
  const result = applyHelperSetSuggestion(current, { type: 'set', field: 'uiMode', value: 'advanced' });
  assert.equal(result.outcome, 'done');
  assert.equal(result.next.uiMode, 'advanced');
  // The caller (index.js's click handler) only knows to call applyUiMode when it sees this field name.
  assert.equal(result.field, 'uiMode');
  assert.equal(result.value, 'advanced');
});

test('applyHelperSetSuggestion routes a real preset id through applyPreset, writing the whole package, not just the remembered id (review finding helper.js:517)', () => {
  const current = mergeSettings({ preset: '', coloring: { speakers: false } });
  const result = applyHelperSetSuggestion(current, { type: 'set', field: 'preset', value: 'comfort' });
  assert.equal(result.outcome, 'done');
  assert.equal(result.next.preset, 'comfort');
  const content = presetContent('comfort');
  for (const field of PRESET_MANAGED_FIELDS) {
    const [head, ...rest] = field.path;
    const actual = rest.length ? result.next[head][rest[0]] : result.next[head];
    assert.equal(actual, content[field.key], `套餐字段 ${field.key} 应写入package内容`);
  }
});

test('applyHelperSetSuggestion clearing preset back to \'\' is a plain field write, not routed through applyPreset (nothing to apply)', () => {
  const current = mergeSettings({ preset: CONSOLE_PRESET_IDS[0] });
  const result = applyHelperSetSuggestion(current, { type: 'set', field: 'preset', value: '' });
  assert.equal(result.outcome, 'done');
  assert.equal(result.next.preset, '');
});

// ---------------------------------------------------------------------------------------------
// helperRegexSnapshot — review finding index.js:11806: only the global list's own surplus was
// counted, leaving out character-bound and preset-bound orphaned copies (and how many fixed rules
// are still missing), all of which 「删除多余正则」 itself acts on.
// ---------------------------------------------------------------------------------------------

test('helperRegexSnapshot counts surplus across the global list, character-bound and preset-bound copies, like 「删除多余正则」 itself does', async () => {
  // normalizeProcessingSettings, not bare mergeSettings — that is what actually populates
  // processingProfiles, and it is what runtime.settings holds by the time askHelper ever runs.
  const settings = normalizeProcessingSettings({});
  const profile = getActiveProcessingProfile(settings);
  const clean = { ...profile, regexScripts: dedupeManagedRegexScripts(profile.regexScripts) };
  // The global list already holds exactly what the active profile expects, so the global count of
  // this snapshot is isolated to 0 surplus / 0 missing — only the scoped/preset engine below should
  // move the numbers.
  const { expected } = planRegexCleanup([], clean);
  globalThis.SillyTavern = { getContext: () => ({ extensionSettings: { regex: expected } }) };

  const SCRIPT_TYPES = { SCOPED: 'scoped', PRESET: 'preset' };
  const orphan = suffix => ({ id: `orphan-${suffix}`, [REGEX_OWNER_KEY]: { owner: MODULE_ID } });
  configureForTest({
    regexEngine: {
      SCRIPT_TYPES,
      getScriptsByType: type => {
        if (type === SCRIPT_TYPES.SCOPED) return [orphan('scoped'), { id: 'reader-own-rule' }];
        if (type === SCRIPT_TYPES.PRESET) return [orphan('preset')];
        return [];
      },
    },
  });

  const snapshot = await helperRegexSnapshot(settings);
  assert.equal(snapshot.expected, expected.length);
  assert.equal(snapshot.surplus, 2, '角色绑定 1 条 + 预设绑定 1 条，全局本身没有多余');
  assert.equal(snapshot.toInstall, 0);
  configureForTest({ regexEngine: null });
});

test('helperRegexSnapshot never throws and reports 未知/0 when the host cannot be read at all', async () => {
  globalThis.SillyTavern = undefined;
  configureForTest({ regexEngine: {} });
  const snapshot = await helperRegexSnapshot(mergeSettings({}));
  assert.equal(snapshot.expected, 0);
  assert.equal(snapshot.surplus, 0);
  configureForTest({ regexEngine: null });
});

// ---------------------------------------------------------------------------------------------
// extractControlCenterKnowledge against the real markup — review finding helper.js:254: <h3> card-row
// titles (most individual settings, including 只留译文 and 朗读（有声小说）) and bare <summary> labels
// (节约模式世界书白名单) were never tracked as a heading, so their own description text was filed under
// whatever unrelated <h2> happened to come earlier on the page instead.
// ---------------------------------------------------------------------------------------------

test('extractControlCenterKnowledge files a card-row under its own <h3>, not an earlier unrelated <h2>, against the real control center markup', () => {
  const lines = extractControlCenterKnowledge(CONTROL_CENTER_MARKUP);
  assert.ok(
    lines.some(line => line.startsWith('翻译台 › 只留译文 › ') && line.includes('正文里只留译文')),
    '只留译文的说明应归在「只留译文」这个 h3 底下，而不是前一个 h2「用什么翻」',
  );
  assert.ok(
    !lines.some(line => line.startsWith('翻译台 › 用什么翻 › ') && line.includes('正文里只留译文')),
    '不应该再把只留译文的说明错误地归到「用什么翻」下面',
  );
});

test('extractControlCenterKnowledge files a bare <summary> (no nested <h2>) as its own heading, against the real control center markup', () => {
  const lines = extractControlCenterKnowledge(CONTROL_CENTER_MARKUP);
  assert.ok(
    lines.some(line => line.startsWith('模型连接 › 节约模式世界书白名单 › ') && line.includes('按世界书分组')),
    '节约模式世界书白名单是一个没有嵌套 h2 的纯文字 summary，它自己的说明不该被归到前一个折叠组下面',
  );
});

test('extractControlCenterKnowledge now contributes at least one line for 微调, the page a class-list-only jy-muted paragraph used to shut out entirely', () => {
  const lines = extractControlCenterKnowledge(CONTROL_CENTER_MARKUP);
  assert.ok(lines.some(line => line.startsWith('微调 › ')), '微调页应该至少有一行知识（此前是 0 行）');
});

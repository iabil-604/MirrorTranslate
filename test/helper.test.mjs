import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_HELPER_PROMPT,
  HELPER_CONTEXT_CAP,
  HELPER_QUICK_QUESTIONS,
  HELPER_WHITELIST_ACTIONS,
  HELPER_WHITELIST_FIELDS,
  applyHelperSuggestion,
  availableHelperActionNames,
  availableHelperFieldNames,
  buildFloorSnapshotLines,
  buildHelperContext,
  buildRunLogLines,
  buildSettingsSummaryLines,
  describeHelperSuggestion,
  extractControlCenterKnowledge,
  keyStatus,
  parseHelperReply,
  redactSecrets,
  resolveHelperPrompt,
  urlHost,
  validateHelperSuggestion,
  validateHelperSuggestions,
} from '../helper.js';
import { mergeSettings } from '../core.js';

function baseSettings(overrides = {}) {
  return mergeSettings({
    apiMode: 'independent',
    selectedChannelId: 'c1',
    channels: [{ id: 'c1', name: '连接一', url: 'https://api.example.com/v1', key: 'sk-realkey1234567890abcdef', model: 'gpt-x' }],
    tts: { analysisChannelId: 'c1', fish: { key: 'fishkey-secret-000', model: 's2-pro' } },
    ...overrides,
  });
}

test('resolveHelperPrompt falls back to the default only when the reader\'s own prompt is empty', () => {
  assert.equal(resolveHelperPrompt({ prompt: '' }), DEFAULT_HELPER_PROMPT);
  assert.equal(resolveHelperPrompt({ prompt: '   ' }), DEFAULT_HELPER_PROMPT);
  assert.equal(resolveHelperPrompt(undefined), DEFAULT_HELPER_PROMPT);
  assert.equal(resolveHelperPrompt({ prompt: '自定义提示词' }), '自定义提示词');
});

test('HELPER_QUICK_QUESTIONS is a short, fixed list of plain questions', () => {
  assert.ok(HELPER_QUICK_QUESTIONS.length >= 3);
  for (const question of HELPER_QUICK_QUESTIONS) assert.equal(typeof question, 'string');
});

// --- redaction ---------------------------------------------------------------------------------

test('keyStatus never echoes the value, only whether one is set', () => {
  assert.equal(keyStatus(''), '没填');
  assert.equal(keyStatus('   '), '没填');
  assert.equal(keyStatus(undefined), '没填');
  assert.equal(keyStatus('sk-anything'), '已填');
});

test('urlHost keeps only the host, dropping path, query and any embedded credential', () => {
  assert.equal(urlHost('https://api.example.com/v1?api_key=sk-secret-value-xyz'), 'api.example.com');
  // URL#host never includes userinfo — a credential embedded straight in the address is dropped along
  // with the rest of the URL, not just its query string.
  assert.equal(urlHost('https://user:pass@api.example.com:8443/v1'), 'api.example.com:8443');
  assert.equal(urlHost(''), '');
  // Not a parseable URL: best effort, but never with its query string attached.
  assert.equal(urlHost('api.example.com/v1?token=abc'), 'api.example.com');
});

test('redactSecrets masks Bearer tokens, key-shaped query params, and provider key prefixes wherever they appear', () => {
  const text = [
    'Authorization: Bearer abcd1234.EFGH-5678_ijkl',
    'callback=https://x.test/cb?api_key=sk-plantedsecretvalue1234567890',
    '联系人昵称是 sk-anothersecretvalue1234567890',
    'google 的 AIzaSyPlantedFakeGoogleKeyValue1234',
  ].join('\n');
  const redacted = redactSecrets(text);
  assert.ok(!redacted.includes('abcd1234.EFGH-5678_ijkl'));
  assert.ok(!redacted.includes('sk-plantedsecretvalue1234567890'));
  assert.ok(!redacted.includes('sk-anothersecretvalue1234567890'));
  assert.ok(!redacted.includes('AIzaSyPlantedFakeGoogleKeyValue1234'));
});

test('buildSettingsSummaryLines: a secret planted in every field it could reach never survives, only 已填/没填 and hosts do', () => {
  const plantedChannelKey = 'sk-channel-secret-planted-0001';
  const plantedFishKey = 'fish-secret-planted-0002';
  const plantedInName = 'sk-name-secret-planted-0003';
  const plantedInUrlQuery = 'url-secret-planted-0004';
  const settings = baseSettings({
    channels: [{
      id: 'c1',
      name: `连接一 ${plantedInName}`,
      url: `https://api.example.com/v1?api_key=${plantedInUrlQuery}`,
      key: plantedChannelKey,
      model: 'gpt-x',
    }],
    tts: { analysisChannelId: 'c1', deepChannelId: 'c1', fish: { key: plantedFishKey, model: 's2-pro' } },
    helper: { channelId: 'c1', prompt: '' },
  });
  const lines = buildSettingsSummaryLines(settings).join('\n');
  for (const planted of [plantedChannelKey, plantedFishKey, plantedInName, plantedInUrlQuery]) {
    assert.ok(!lines.includes(planted), `泄露了不该出现的值：${planted}`);
  }
  assert.match(lines, /Fish Audio API Key：已填/);
  assert.match(lines, /连接一/, '连接名字本身（去掉了里面的密钥形状文本）仍然要能看到');
});

test('buildHelperContext redacts a secret planted in a field the summary legitimately displays (name/model), on top of the explicit key masking', () => {
  const plantedInModel = 'sk-model-secret-planted-0005';
  const settings = baseSettings({
    channels: [{ id: 'c1', name: '连接一', url: 'https://api.example.com/v1', key: 'sk-realkey', model: plantedInModel }],
    tts: { analysisChannelId: 'c1', fish: { key: 'fishkey', model: 's2-pro' } },
  });
  const ctx = buildHelperContext({
    versions: { appVersion: '0.38.0' },
    settings,
    floor: null,
    runLog: [],
    regex: { expected: 0, surplus: 0 },
    knowledgeMarkup: '',
    manual: '',
  });
  assert.ok(!ctx.text.includes(plantedInModel));
  assert.ok(!ctx.text.includes('sk-realkey'));
  assert.ok(!ctx.text.includes('fishkey'));
});

// --- floor snapshot ------------------------------------------------------------------------------

test('buildFloorSnapshotLines reports a missing floor plainly, and marks a long preview as truncated', () => {
  assert.deepEqual(buildFloorSnapshotLines(null), ['当前楼层：没有可读取的 AI 回复。']);
  const lines = buildFloorSnapshotLines({
    messageId: 3, role: '角色', swipeLabel: '2/2', segmentCount: 4, translationState: '缺 1 段',
    bodyTagsFound: ['story_scene'], replaceTagsFound: [], excludedTagsFound: [], translationOnly: false,
    errors: ['一个错误'],
    preview: 'a'.repeat(2000),
  }).join('\n');
  assert.match(lines, /第 3 楼/);
  assert.match(lines, /缺 1 段/);
  assert.match(lines, /已截断/);
  assert.match(lines, /一个错误/);
});

// --- run log -------------------------------------------------------------------------------------

test('buildRunLogLines keeps only the last 30 entries and never invents one when there are none', () => {
  assert.deepEqual(buildRunLogLines([]), ['运行记录：暂无记录。']);
  const many = Array.from({ length: 40 }, (_, i) => ({ time: `t${i}`, level: 'info', scope: 's', message: `m${i}` }));
  const lines = buildRunLogLines(many);
  assert.equal(lines.length, 30);
  assert.match(lines[0], /m10/, '只留最近 30 条');
  assert.match(lines.at(-1), /m39/);
});

// --- knowledge extraction --------------------------------------------------------------------------

test('extractControlCenterKnowledge reads "页 › 区 › 文字" lines straight from the markup, grouped by the nearest heading', () => {
  const markup = `
<section class="jy-page" data-jy-page="main" role="tabpanel">
<h1>翻译台</h1>
<h2>你自己的设置</h2>
<p class="jy-muted">提取标签只取每种标签的最后一组完整内容。</p>
<button title="从这里去改">改</button>
</section>
<section class="jy-page" data-jy-page="tts" role="tabpanel" hidden>
<h1>朗读</h1>
<h2>Fish Audio</h2>
<p class="jy-muted">需要 Fish Audio 的 API Key。</p>
</section>`;
  const lines = extractControlCenterKnowledge(markup);
  assert.ok(lines.some(line => line === '翻译台 › 你自己的设置 › 提取标签只取每种标签的最后一组完整内容。'));
  assert.ok(lines.some(line => line === '翻译台 › 你自己的设置 › 从这里去改'));
  assert.ok(lines.some(line => line === '朗读 › Fish Audio › 需要 Fish Audio 的 API Key。'));
});

test('extractControlCenterKnowledge caps how many lines one page can contribute, and never duplicates a line', () => {
  const manyParagraphs = Array.from({ length: 80 }, (_, i) => `<p class="jy-muted">重复说明 ${i % 5}</p>`).join('');
  const markup = `<section class="jy-page" data-jy-page="main"><h1>翻译台</h1>${manyParagraphs}</section>`;
  const lines = extractControlCenterKnowledge(markup);
  assert.ok(lines.length <= 40, `单页不应贡献超过上限的行数，实际 ${lines.length}`);
  assert.equal(new Set(lines).size, lines.length, '不重复同一行');
});

// --- context caps -----------------------------------------------------------------------------

test('buildHelperContext never exceeds its cap, even when every section is oversized', () => {
  const hugeErrors = Array.from({ length: 2000 }, (_, i) => `err-${'x'.repeat(50)}-${i}`);
  const ctx = buildHelperContext({
    settings: baseSettings(),
    floor: { messageId: 1, role: '角色', swipeLabel: '1/1', segmentCount: 1, translationState: '已译', bodyTagsFound: [], replaceTagsFound: [], excludedTagsFound: [], errors: hugeErrors, preview: 'p'.repeat(1200) },
    runLog: Array.from({ length: 500 }, (_, i) => ({ time: 't', level: 'info', scope: 's', message: 'm'.repeat(300) + i })),
    regex: { expected: 0, surplus: 0 },
    knowledgeMarkup: `<section class="jy-page" data-jy-page="main"><h1>翻译台</h1>${Array.from({ length: 200 }, (_, i) => `<p class="jy-muted">${'k'.repeat(150)}${i}</p>`).join('')}</section>`,
    manual: 'm'.repeat(300000),
    cap: HELPER_CONTEXT_CAP,
  });
  assert.ok(ctx.text.length <= HELPER_CONTEXT_CAP, `${ctx.text.length} 超过了上限 ${HELPER_CONTEXT_CAP}`);
});

test('buildHelperContext trims the manual excerpt and knowledge before it ever needs to touch the settings summary', () => {
  const settings = baseSettings();
  const ctxSmallCap = buildHelperContext({
    settings,
    floor: null,
    runLog: [],
    regex: { expected: 0, surplus: 0 },
    knowledgeMarkup: '',
    manual: 'm'.repeat(5000),
    cap: 2000,
  });
  // The settings summary line for 说话人着色/tags/etc. must still be present in full even under a tight cap.
  assert.match(ctxSmallCap.text, /设置摘要/);
  assert.match(ctxSmallCap.text, /Fish Audio API Key：(已填|没填)/);
  assert.equal(ctxSmallCap.truncated.manual, true);
  assert.ok(ctxSmallCap.text.length <= 2000);
});

test('buildHelperContext reports no truncation when everything comfortably fits', () => {
  const ctx = buildHelperContext({
    settings: baseSettings(),
    floor: null,
    runLog: [{ time: 't', level: 'info', scope: 's', message: 'ok' }],
    regex: { expected: 1, surplus: 0 },
    knowledgeMarkup: '<section class="jy-page" data-jy-page="main"><h1>翻译台</h1><p class="jy-muted">说明</p></section>',
    manual: '短短的手册摘录',
  });
  assert.deepEqual(ctx.truncated, { manual: false, knowledge: false, runLog: false });
});

// --- reply parsing --------------------------------------------------------------------------------

test('parseHelperReply strips a trailing jingyi-suggest block and reads its JSON array leniently', () => {
  const reply = '第一步这样做。第二步那样做。\n\n```jingyi-suggest\n[{"type":"set","field":"autoGeneration","value":false,"why":"你不想自动翻"}]\n```';
  const parsed = parseHelperReply(reply);
  assert.equal(parsed.text, '第一步这样做。第二步那样做。');
  assert.equal(parsed.rawSuggestions.length, 1);
  assert.equal(parsed.rawSuggestions[0].field, 'autoGeneration');
});

test('parseHelperReply returns the whole reply with no suggestions when there is no block', () => {
  const parsed = parseHelperReply('只是回答，没有建议。');
  assert.equal(parsed.text, '只是回答，没有建议。');
  assert.deepEqual(parsed.rawSuggestions, []);
});

test('parseHelperReply recovers from a malformed block (trailing comma, stray prose) rather than throwing', () => {
  const reply = '回答。\n```jingyi-suggest\n这里模型多写了几句话\n[{"type":"set","field":"autoSwipe","value":true,"why":"更方便"},]\n```';
  const parsed = parseHelperReply(reply);
  // The trailing comma makes the literal array invalid JSON; parseJsonCandidates still finds the
  // well-formed object inside it as its own fragment, so at minimum nothing throws and nothing bogus
  // is returned as a top-level array match.
  assert.doesNotThrow(() => parseHelperReply(reply));
  assert.equal(parsed.text, '回答。');
});

// --- suggestion whitelist / validation --------------------------------------------------------------

test('availableHelperFieldNames/availableHelperActionNames list exactly the whitelist', () => {
  assert.deepEqual(availableHelperFieldNames(), HELPER_WHITELIST_FIELDS.map(f => f.field));
  assert.deepEqual(availableHelperActionNames(), HELPER_WHITELIST_ACTIONS.map(a => a.action));
});

test('validateHelperSuggestion drops an unknown field or action outright', () => {
  const settings = baseSettings();
  assert.equal(validateHelperSuggestion({ type: 'set', field: 'apiKey', value: 'sk-x' }, settings), null);
  assert.equal(validateHelperSuggestion({ type: 'set', field: 'notAField', value: true }, settings), null);
  assert.equal(validateHelperSuggestion({ type: 'action', action: 'delete-everything' }, settings), null);
  assert.equal(validateHelperSuggestion({ type: 'bogus' }, settings), null);
  assert.equal(validateHelperSuggestion(null, settings), null);
});

test('validateHelperSuggestion drops an invalid value for a field it does recognise', () => {
  const settings = baseSettings();
  assert.equal(validateHelperSuggestion({ type: 'set', field: 'tts.mode', value: 'ultra' }, settings), null, '不在枚举里的分析模式');
  assert.equal(validateHelperSuggestion({ type: 'set', field: 'autoGeneration', value: 'maybe' }, settings), null, '不是布尔值');
  assert.equal(validateHelperSuggestion({ type: 'set', field: 'excludedTags', value: '<>' }, settings), null, '标签名不合法');
  assert.equal(validateHelperSuggestion({ type: 'action', action: 'open-page', value: 'not-a-real-page' }, settings), null);
});

test('validateHelperSuggestion clamps an in-range-but-outside integer to its bounds', () => {
  const settings = mergeSettings({ retries: 1 });
  const high = validateHelperSuggestion({ type: 'set', field: 'retries', value: 99 }, settings);
  assert.equal(high.value, 5);
  const low = validateHelperSuggestion({ type: 'set', field: 'retries', value: -9 }, settings);
  assert.equal(low.value, 0);
});

test('validateHelperSuggestion drops a suggestion that would not change anything (already set)', () => {
  const settings = mergeSettings({ autoGeneration: true, excludedTags: ['thinking'] });
  assert.equal(validateHelperSuggestion({ type: 'set', field: 'autoGeneration', value: true }, settings), null);
  assert.equal(validateHelperSuggestion({ type: 'set', field: 'excludedTags', value: 'thinking' }, settings), null, '同一组标签换个写法仍是空操作');
  const real = validateHelperSuggestion({ type: 'set', field: 'excludedTags', value: 'thinking, status' }, settings);
  assert.ok(real, '真的加了一个标签，不是空操作');
});

test('validateHelperSuggestions caps how many suggestions one reply can carry and preserves order', () => {
  const settings = mergeSettings({ retries: 0 });
  const many = Array.from({ length: 20 }, (_, i) => ({ type: 'set', field: 'retries', value: i + 1 }));
  const result = validateHelperSuggestions(many, settings);
  assert.ok(result.length <= 8);
  assert.equal(result[0].value, 1);
});

test('describeHelperSuggestion reads naturally for every kind', () => {
  const settings = mergeSettings({ autoGeneration: true, retries: 0, tts: { mode: 'off' } });
  const boolSug = validateHelperSuggestion({ type: 'set', field: 'autoGeneration', value: false }, settings);
  assert.equal(describeHelperSuggestion(boolSug), '把「自动接续翻译」改成「关」');
  const enumSug = validateHelperSuggestion({ type: 'set', field: 'tts.mode', value: 'deep' }, settings);
  assert.equal(describeHelperSuggestion(enumSug), '把「分析模式」改成「深度分析」');
  const intSug = validateHelperSuggestion({ type: 'set', field: 'retries', value: 3 }, settings);
  assert.equal(describeHelperSuggestion(intSug), '把「翻译失败后自动重试」改成「3」');
  const actionSug = validateHelperSuggestion({ type: 'action', action: 'inspect-floor' }, settings);
  assert.equal(describeHelperSuggestion(actionSug), '检查当前楼层');
});

test('describeHelperSuggestion reads "未选套餐" rather than empty quotes when a suggestion clears the preset', () => {
  const settings = mergeSettings({ preset: 'light' });
  const suggestion = validateHelperSuggestion({ type: 'set', field: 'preset', value: '' }, settings);
  assert.ok(suggestion, '清空套餐是合法的建议，不该被当成空操作或非法值丢掉');
  assert.equal(describeHelperSuggestion(suggestion), '把「套餐」改成「未选套餐」');
});

// --- applying a suggestion ---------------------------------------------------------------------

test('applyHelperSuggestion writes only the one field, immutably, and ignores an action suggestion', () => {
  const settings = mergeSettings({ autoGeneration: true, autoSwipe: true });
  const suggestion = validateHelperSuggestion({ type: 'set', field: 'autoGeneration', value: false }, settings);
  const next = applyHelperSuggestion(settings, suggestion);
  assert.equal(next.autoGeneration, false);
  assert.equal(settings.autoGeneration, true, '原对象不变');
  assert.equal(next.autoSwipe, true, '没有牵连其他字段');

  const nested = mergeSettings({ coloring: { speakers: false, emotions: true } });
  const nestedSuggestion = validateHelperSuggestion({ type: 'set', field: 'coloring.speakers', value: true }, nested);
  const nestedNext = applyHelperSuggestion(nested, nestedSuggestion);
  assert.equal(nestedNext.coloring.speakers, true);
  assert.equal(nestedNext.coloring.emotions, true, '同一个嵌套对象里的另一个字段不受影响');
  assert.equal(nested.coloring.speakers, false, '原对象不变');

  const actionSuggestion = validateHelperSuggestion({ type: 'action', action: 'inspect-floor' }, settings);
  assert.equal(applyHelperSuggestion(settings, actionSuggestion), settings, 'action 建议不改设置');
});

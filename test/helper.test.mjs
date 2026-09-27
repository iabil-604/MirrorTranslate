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
  buildRegexLines,
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
import { applyPreset, mergeSettings, pagesForMode, presetDrift } from '../core.js';

function baseSettings(overrides = {}) {
  return mergeSettings({
    apiMode: 'independent',
    selectedChannelId: 'c1',
    channels: [{ id: 'c1', name: '连接一', url: 'https://api.example.com/v1', key: 'sk-realkey1234567890abcdef', model: 'gpt-x' }],
    tts: { deepChannelId: 'c1', fish: { key: 'fishkey-secret-000', model: 's2-pro' } },
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
  // No scheme, so URL() throws and the fallback path runs — that fallback used to keep whatever sat
  // in front of the host as if it were part of it (review finding helper.js:98).
  assert.equal(urlHost('user:secretpass@api.example.com/v1'), 'api.example.com', '没写协议头时，回退逻辑也不该把凭据留在 host 前面');
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
    tts: { deepChannelId: 'c1', fish: { key: plantedFishKey, model: 's2-pro' } },
    helper: { channelId: 'c1', prompt: '' },
  });
  const lines = buildSettingsSummaryLines(settings).join('\n');
  for (const planted of [plantedChannelKey, plantedFishKey, plantedInName, plantedInUrlQuery]) {
    assert.ok(!lines.includes(planted), `泄露了不该出现的值：${planted}`);
  }
  assert.match(lines, /Fish Audio API Key：已填/);
  assert.match(lines, /连接一/, '连接名字本身（去掉了里面的密钥形状文本）仍然要能看到');
});

test('buildSettingsSummaryLines uses the markup\'s own wording for the Fish rows, not an invented label (review finding helper.js:155)', () => {
  const settings = baseSettings({ tts: { deepChannelId: 'c1', fish: { key: 'k', model: 's2-pro', viaProxy: true } } });
  const lines = buildSettingsSummaryLines(settings).join('\n');
  assert.match(lines, /Fish Audio › 模型：s2-pro/, '控制中心里这项叫「Fish Audio › 模型」，不是「Fish Audio 模型」');
  assert.match(lines, /经酒馆 CORS 代理发送：开/, '控制中心里这项叫「经酒馆 CORS 代理发送」，不是「Fish 走酒馆代理」');
  assert.doesNotMatch(lines, /Fish 走酒馆代理/);
});

test('buildSettingsSummaryLines names each use\'s connection as a connection, apart from the 分析模式 switch itself', () => {
  const settings = baseSettings({
    channels: [{ id: 'c1', name: '连接一', url: 'https://api.example.com/v1', key: 'k', model: 'gpt-x' }],
    tts: { enabled: true, mode: 'deep', deepChannelId: 'c1' },
  });
  const lines = buildSettingsSummaryLines(settings);
  assert.ok(lines.includes('翻译用的连接：连接一 · gpt-x · api.example.com'));
  assert.ok(lines.includes('分析模式用的连接：连接一 · gpt-x · api.example.com'));
  assert.ok(lines.includes('小助手用的连接：跟随酒馆'));
  assert.ok(lines.includes('分析模式：开'), '开关本身读作开/关，和它用的连接分开');
  assert.equal(lines.some(line => line.startsWith('朗读分析')), false, '没有朗读分析这一项了');
  assert.ok(buildSettingsSummaryLines(baseSettings({ tts: { mode: 'off' } })).includes('分析模式：关'));
});

test('buildSettingsSummaryLines reports how far the settings have drifted from the remembered 套餐 (review finding helper.js:140)', () => {
  const onPackage = applyPreset(baseSettings(), 'light');
  assert.doesNotMatch(buildSettingsSummaryLines(onPackage).join('\n'), /改过/, '套餐原样时不提改动');

  const drifted = { ...onPackage, coloring: { ...onPackage.coloring, speakers: true } };
  const lines = buildSettingsSummaryLines(drifted).join('\n');
  assert.match(lines, /套餐已改过 1 项，不是原样/);
  assert.match(lines, /说话人着色/, '偏离的字段名字应该能在摘要里看到');
});

test('buildHelperContext redacts a secret planted in a field the summary legitimately displays (name/model), on top of the explicit key masking', () => {
  const plantedInModel = 'sk-model-secret-planted-0005';
  const settings = baseSettings({
    channels: [{ id: 'c1', name: '连接一', url: 'https://api.example.com/v1', key: 'sk-realkey', model: plantedInModel }],
    tts: { deepChannelId: 'c1', fish: { key: 'fishkey', model: 's2-pro' } },
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

test('buildHelperContext\'s final redactSecrets pass reaches every input it accepts, not only the settings summary (extends the key-planting coverage past helper.js\'s own settings-only tests — review finding test/helper-apply.test.mjs:1)', () => {
  const plantedInHostVersion = 'sk-hostversion-secret-planted-0012';
  const plantedInFloorPreview = 'sk-floor-preview-secret-planted-0013';
  const plantedInFloorError = 'sk-floor-error-secret-planted-0014';
  const plantedInRunLog = 'sk-runlog-secret-planted-0015';
  const plantedInKnowledge = 'sk-knowledge-secret-planted-0016';
  const plantedInManual = 'sk-manual-secret-planted-0017';
  const ctx = buildHelperContext({
    versions: { appVersion: '0.38.0', hostVersion: `1.18.0 (${plantedInHostVersion})`, mainApi: 'openai', streaming: true },
    settings: baseSettings(),
    floor: {
      messageId: 1, role: '角色', swipeLabel: '1/1', segmentCount: 1, translationState: '已译',
      bodyTagsFound: [], replaceTagsFound: [], excludedTagsFound: [], translationOnly: false,
      errors: [`请求失败：${plantedInFloorError}`],
      preview: `正文开头写着 ${plantedInFloorPreview}`,
    },
    runLog: [{ time: 't', level: 'error', scope: 's', message: `失败：${plantedInRunLog}` }],
    regex: { expected: 1, surplus: 0 },
    knowledgeMarkup: `<section class="jy-page" data-jy-page="main"><h1>翻译台</h1><p class="jy-muted">说明 ${plantedInKnowledge}</p></section>`,
    manual: `手册里写着 ${plantedInManual}`,
  });
  for (const planted of [plantedInHostVersion, plantedInFloorPreview, plantedInFloorError, plantedInRunLog, plantedInKnowledge, plantedInManual]) {
    assert.ok(!ctx.text.includes(planted), `泄露了不该出现的值（来自 buildHelperContext 的某一路输入）：${planted}`);
  }
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

test('buildHelperContext keeps the whole manual when the total comfortably fits the cap, instead of clipping it to a fixed share regardless of how much room is spare (review finding helper.js:335)', () => {
  const tail = '七、出问题了怎么办\n这里是排查步骤，问题往往出在这里。';
  // A realistic manual: tens of thousands of characters, with the troubleshooting section near the
  // end — exactly what the old fixed-30%-of-remaining split cut off even though the whole context
  // came nowhere near the cap (the reviewer's own probe: 24 146 characters against a 40 000 cap).
  const manual = `一、开始之前\n${'这里是使用说明的一段介绍文字。'.repeat(1500)}\n${tail}`;
  const runLog = Array.from({ length: 30 }, (_, i) => ({ time: `t${i}`, level: 'info', scope: 's', message: `第 ${i} 条运行记录` }));
  const ctx = buildHelperContext({
    settings: baseSettings(),
    floor: null,
    runLog,
    regex: { expected: 1, surplus: 0 },
    knowledgeMarkup: '<section class="jy-page" data-jy-page="main"><h1>翻译台</h1><p class="jy-muted">说明</p></section>',
    manual,
    cap: HELPER_CONTEXT_CAP,
  });
  assert.ok(ctx.text.length < HELPER_CONTEXT_CAP, `这个场景应该远低于上限（实际 ${ctx.text.length}）`);
  assert.equal(ctx.truncated.manual, false, '手册整体没超预算时不该被裁掉');
  assert.ok(ctx.text.includes(tail), '排查步骤那一段应该完整出现，而不是被固定比例的预算提前砍掉');
});

test('buildHelperContext trims the manual before ever touching the run log or the control center knowledge, once space genuinely runs out', () => {
  const runLog = Array.from({ length: 10 }, (_, i) => ({ time: `t${i}`, level: 'info', scope: 's', message: `记录 ${i}` }));
  const ctx = buildHelperContext({
    settings: baseSettings(),
    floor: null,
    runLog,
    regex: { expected: 0, surplus: 0 },
    knowledgeMarkup: '<section class="jy-page" data-jy-page="main"><h1>翻译台</h1><p class="jy-muted">控制中心说明文字</p></section>',
    manual: 'm'.repeat(300000),
    cap: HELPER_CONTEXT_CAP,
  });
  assert.equal(ctx.truncated.manual, true);
  assert.equal(ctx.truncated.knowledge, false, '手册被砍的同时，控制中心说明不该跟着被牺牲');
  assert.equal(ctx.truncated.runLog, false, '手册被砍的同时，运行记录不该跟着被牺牲');
  assert.ok(ctx.text.includes('记录 9'), '运行记录应该完整出现');
  assert.ok(ctx.text.includes('控制中心说明文字'), '控制中心说明应该完整出现');
});

test('buildHelperContext never loses 可用建议\'s own tail to the final cap slice, even when trimming genuinely has to happen (review finding helper.js:387)', () => {
  // A manual so large it forces real trimming — the reviewer's own probe used a real 21 358-character
  // manual and a real markup and still hit exactly 40000, ending mid-可用建议 because that section used
  // to sit last; this is the same shape with synthetic data, deterministic and independent of the real
  // 使用手册.md's exact length.
  const runLog = Array.from({ length: 30 }, (_, i) => ({ time: `t${i}`, level: 'error', scope: 's', message: `第 ${i} 条错误记录，正好凑够长度`.repeat(3) }));
  const ctx = buildHelperContext({
    settings: baseSettings(),
    floor: null,
    runLog,
    regex: { expected: 1, surplus: 0 },
    knowledgeMarkup: '<section class="jy-page" data-jy-page="main"><h1>翻译台</h1><p class="jy-muted">说明</p></section>',
    manual: 'm'.repeat(300000),
    cap: HELPER_CONTEXT_CAP,
  });
  assert.equal(ctx.truncated.manual, true, '这个场景应该确实触发了裁切，不然这条测试什么也没验证到');
  assert.ok(
    ctx.text.includes('cleanup-regex（删除多余正则）'),
    '可用建议列出的最后一个动作不该因为最后的 cap 裁切而丢失——模型会因此以为「删除多余正则」这个动作根本不存在',
  );
  assert.ok(ctx.text.length <= HELPER_CONTEXT_CAP);
});

test('buildHelperContext\'s 可用建议 section gives the model the actual value domain for every field, and open-page\'s ids for the reader\'s current 界面模式 (review finding helper.js:322)', () => {
  const advanced = mergeSettings({ uiMode: 'advanced', schemaVersion: 13 });
  const ctx = buildHelperContext({ settings: advanced, floor: null, runLog: [], regex: null, knowledgeMarkup: '', manual: '' });
  assert.match(ctx.text, /tts\.mode（分析模式，可填：off=关、deep=开）/);
  assert.match(ctx.text, /uiMode（界面模式，可填：normal=正常模式、advanced=高级模式）/);
  assert.match(ctx.text, /retries（翻译失败后自动重试，可填：整数 0-5）/);
  assert.match(ctx.text, /open-page（打开页面，value 填：[^；\n]*settings=模型连接/, '高级模式下 open-page 应该带上模型连接页的 id');
  assert.doesNotMatch(ctx.text, /open-page（打开页面，value 填：[^；\n]*finetune=微调/, '高级模式下不该把只在正常模式存在的页面列进可用建议');

  const normal = mergeSettings({ uiMode: 'normal', schemaVersion: 13 });
  const ctxNormal = buildHelperContext({ settings: normal, floor: null, runLog: [], regex: null, knowledgeMarkup: '', manual: '' });
  assert.match(ctxNormal.text, /open-page（打开页面，value 填：[^；\n]*finetune=微调/, '正常模式下 open-page 应该带上微调页的 id');
  assert.doesNotMatch(ctxNormal.text, /open-page（打开页面，value 填：[^；\n]*settings=模型连接/, '正常模式下不该把只在高级模式存在的页面列进可用建议');
});

test('buildRegexLines mentions surplus across every scope and how many fixed rules are missing (review finding index.js:11806)', () => {
  assert.deepEqual(buildRegexLines(null), ['正则：未知。']);
  const lines = buildRegexLines({ expected: 12, surplus: 3, toInstall: 2, nativeRegexInstalled: true }).join('\n');
  assert.match(lines, /12 条应有，多余 3 条/);
  assert.match(lines, /缺 2 条固定正则未装/);
  const linesNoInstall = buildRegexLines({ expected: 12, surplus: 0, toInstall: 0, nativeRegexInstalled: false }).join('\n');
  assert.doesNotMatch(linesNoInstall, /缺 \d+ 条固定正则未装/);
  assert.match(linesNoInstall, /没有接上/);
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

test('parseHelperReply strips a trailing comma before parsing and actually recovers the suggestion, not just avoids throwing (review finding helper.js:533)', () => {
  const reply = '回答。\n```jingyi-suggest\n这里模型多写了几句话\n[{"type":"set","field":"autoSwipe","value":true,"why":"更方便"},]\n```';
  const parsed = parseHelperReply(reply);
  assert.doesNotThrow(() => parseHelperReply(reply));
  assert.equal(parsed.text, '回答。');
  assert.equal(parsed.rawSuggestions.length, 1, '带尾随逗号的数组不该被当成解析失败，应该恢复出这一条建议');
  assert.equal(parsed.rawSuggestions[0].field, 'autoSwipe');
});

test('parseHelperReply wraps a lone suggestion object (not wrapped in an array) into one, rather than dropping it', () => {
  const reply = '回答。\n```jingyi-suggest\n{"type":"set","field":"autoGeneration","value":false,"why":"单个对象，没包数组"}\n```';
  const parsed = parseHelperReply(reply);
  assert.equal(parsed.rawSuggestions.length, 1);
  assert.equal(parsed.rawSuggestions[0].field, 'autoGeneration');
});

test('parseHelperReply matches a block truncated at the reply\'s own end (no closing fence, as a maxTokens cutoff leaves it), and never leaks its raw JSON into the display text', () => {
  const reply = '第一步这样做。\n\n```jingyi-suggest\n[{"type":"set","field":"autoSwipe","value":true,"why":"更方便"}';
  const parsed = parseHelperReply(reply);
  assert.equal(parsed.text, '第一步这样做。', '截断的建议块不该整段原样出现在给读者看的正文里');
  assert.equal(parsed.rawSuggestions.length, 1);
  assert.equal(parsed.rawSuggestions[0].field, 'autoSwipe');
});

test('parseHelperReply unwraps the { content, reasoning } object an independent connection returns, the same way parseJsonCandidates/recoverStructuredTranslations already do (review finding helper.js:616, high)', () => {
  const reply = '这样试试。\n\n```jingyi-suggest\n[{"type":"set","field":"autoGeneration","value":false,"why":"你不想自动翻"}]\n```';
  const parsed = parseHelperReply({ content: reply, reasoning: '模型的思考过程，不该出现在回答里' });
  assert.equal(parsed.text, '这样试试。', '不该是 "[object Object]"');
  assert.equal(parsed.rawSuggestions.length, 1);
  assert.equal(parsed.rawSuggestions[0].field, 'autoGeneration');
});

test('parseHelperReply reads an envelope with blank content as an empty reply: its reasoning is not an answer, nor a suggestion drafted there', () => {
  const parsed = parseHelperReply({ content: '', reasoning: '只想了这些，没有正文。\n```jingyi-suggest\n[{"type":"action","action":"open-page","value":"settings"}]\n```' });
  assert.equal(parsed.text, '');
  assert.deepEqual(parsed.rawSuggestions, []);
});

test('parseHelperReply strips a <think> block outside the suggestion fence, the same way core.js\'s own JSON-candidate extraction already does', () => {
  const parsed = parseHelperReply('<think>这是模型的思考过程</think>这才是回答。');
  assert.equal(parsed.text, '这才是回答。');
});

test('parseHelperReply still reads a plain string reply exactly as before (跟随酒馆\'s generateRaw returns a string, not an envelope)', () => {
  const parsed = parseHelperReply('只是回答，没有建议。');
  assert.equal(parsed.text, '只是回答，没有建议。');
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

test('validateHelperSuggestion accepts tags separated by 、 (顿号) — the settings summary prints them this way and helperFieldValueDomain tells the model it may write them back the same way (review finding helper.js:442)', () => {
  const settings = mergeSettings({ excludedTags: ['thinking'] });
  const suggestion = validateHelperSuggestion({ type: 'set', field: 'excludedTags', value: 'status、mood' }, settings);
  assert.ok(suggestion, '顿号分隔的标签不该被当成一个非法的整段词元丢掉');
  assert.deepEqual(suggestion.value, ['status', 'mood']);
});

test('validateHelperSuggestion rejects an empty bodyTags value instead of promising "（空）" and then silently applying the default list (review finding helper.js:496)', () => {
  const settings = mergeSettings({ bodyTags: ['content'] });
  assert.equal(validateHelperSuggestion({ type: 'set', field: 'bodyTags', value: '' }, settings), null);
  assert.equal(validateHelperSuggestion({ type: 'set', field: 'bodyTags', value: [] }, settings), null);
  // excludedTags/replaceTags have no such refill in mergeSettings and may legitimately be cleared.
  const clearedExcluded = validateHelperSuggestion({ type: 'set', field: 'excludedTags', value: '' }, mergeSettings({ excludedTags: ['thinking'] }));
  assert.ok(clearedExcluded, '排除标签允许真的清空');
  assert.deepEqual(clearedExcluded.value, []);
});

test('validateHelperSuggestion narrows open-page to whatever pages exist in the *current* 界面模式 (review finding index.js:12202)', () => {
  const normal = mergeSettings({ uiMode: 'normal', schemaVersion: 13 });
  const advanced = mergeSettings({ uiMode: 'advanced', schemaVersion: 13 });
  assert.deepEqual(pagesForMode('normal'), ['main', 'finetune', 'helper', 'logs']);
  // 'settings' (模型连接) only exists in 高级模式's rail — suggesting it while 正常模式 is showing would
  // leave no tab looking selected once applied.
  assert.equal(validateHelperSuggestion({ type: 'action', action: 'open-page', value: 'settings' }, normal), null);
  const validInAdvanced = validateHelperSuggestion({ type: 'action', action: 'open-page', value: 'settings' }, advanced);
  assert.ok(validInAdvanced, '同一个页面 id 在高级模式下是合法的');
  assert.equal(validInAdvanced.value, 'settings');
  // 'finetune' (微调) is the other way around: 正常模式 only.
  assert.ok(validateHelperSuggestion({ type: 'action', action: 'open-page', value: 'finetune' }, normal));
  assert.equal(validateHelperSuggestion({ type: 'action', action: 'open-page', value: 'finetune' }, advanced), null);
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
  assert.equal(describeHelperSuggestion(enumSug), '把「分析模式」改成「开」');
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

test('applyHelperSuggestion routes a real preset id through applyPreset — the whole package, not just the remembered id (review finding helper.js:517)', () => {
  const settings = mergeSettings({ preset: '', coloring: { speakers: false, emotions: false } });
  const suggestion = validateHelperSuggestion({ type: 'set', field: 'preset', value: 'comfort' }, settings);
  assert.ok(suggestion);
  const next = applyHelperSuggestion(settings, suggestion);
  assert.equal(next.preset, 'comfort');
  // 看得舒服 (comfort) actually turns speaker colouring on — a bare pathSet(['preset']) would leave
  // this false and only rename the remembered id.
  assert.equal(next.coloring.speakers, true, '套餐建议应该真的套用套餐内容，而不只是改记住的 id');
  assert.deepEqual(presetDrift(next), [], '套用之后不该立刻又显示为偏离');
});

test('applyHelperSuggestion clearing preset back to \'\' is a plain field write (there is no package content to apply)', () => {
  const settings = mergeSettings({ preset: 'light' });
  const suggestion = validateHelperSuggestion({ type: 'set', field: 'preset', value: '' }, settings);
  assert.equal(applyHelperSuggestion(settings, suggestion).preset, '');
});

test('parseHelperReply strips only a leading reasoning block and keeps tags the answer itself talks about', async () => {
  const { parseHelperReply } = await import('../helper.js');
  assert.equal(parseHelperReply('<think>先想想</think>\n1. 去正文处理页。').text, '1. 去正文处理页。');
  assert.equal(parseHelperReply('<thinking>先想想</thinking>1. 好。').text, '1. 好。');
  const quoted = '1. 你的正文包在 <thinking>…</thinking> 里，镜译默认只取 <content>。';
  assert.equal(parseHelperReply(quoted).text, quoted, '正文里提到的标签不能被当成思考块删掉');
  const fenced = '排除标签可以写 <think> 或 <thinking>：\n```\n<thinking>思考</thinking>\n```';
  assert.equal(parseHelperReply(fenced).text, fenced);
  assert.equal(parseHelperReply({ content: '', reasoning: '' }).text, '', '空的回复信封就是空回答');
});

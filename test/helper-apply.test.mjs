import test from 'node:test';
import assert from 'node:assert/strict';

import { __testing } from '../index.js';
import { CONSOLE_PRESET_IDS, PRESET_MANAGED_FIELDS, mergeSettings, presetContent } from '../core.js';
import { REGEX_OWNER_KEY, dedupeManagedRegexScripts, getActiveProcessingProfile, normalizeProcessingSettings, planRegexCleanup } from '../processing.js';
import { MODULE_ID } from '../core.js';
import { extractControlCenterKnowledge } from '../helper.js';
import { clearDiagnostics, readDiagnostics } from '../diagnostics.js';

const {
  applyHelperSetSuggestion,
  helperRegexSnapshot,
  helperVersionsSnapshot,
  helperHistoryTurns,
  helperLiveRoot,
  askHelper,
  configureForTest,
  CONTROL_CENTER_MARKUP,
} = __testing;

// A hand-built DOM stand-in, the same style as console-autosave.test.mjs's ensureAutosaveIndicator
// test and console-panel.test.mjs's fakeDeskField/fakeRoot — no jsdom dependency. Covers exactly the
// surface askHelper/renderHelperConversation touch: querySelector on a root, createElement/
// createTextNode on its ownerDocument, and append/appendChild/replaceChildren/lastElementChild on an
// element.
function fakeElement() {
  const el = {
    className: '',
    dataset: {},
    children: [],
    textContent: '',
    value: '',
    classList: { add() {} },
    setAttribute() {},
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); return node; },
    replaceChildren(...nodes) { this.children = nodes; },
    scrollIntoView() {},
  };
  Object.defineProperty(el, 'lastElementChild', { get() { return this.children.at(-1) ?? null; } });
  return el;
}

function fakeHelperRoot() {
  const doc = {
    createElement: () => fakeElement(),
    createTextNode: text => ({ nodeType: 3, textContent: text }),
  };
  const conversation = fakeElement();
  conversation.ownerDocument = doc;
  const root = {
    querySelector(selector) {
      if (selector === '[data-jy-helper-conversation]') return conversation;
      return null;
    },
  };
  return { root, conversation };
}

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

// ---------------------------------------------------------------------------------------------
// extractControlCenterKnowledge against the real markup — review finding helper.js:286 (v2): a
// checkbox row's own label (流式写回) was still not tracked at all, so its own reason paragraph fell
// through to whatever unrelated <h3> came before it; the shared per-connection edit form has no
// heading of its own, so 连接名称/API 基础地址/API 密钥 were filed under the built-in 跟随酒馆 card, which
// needs none of them; and the 朗读 page's own ~60 real lines were being cut off at a flat 40-per-page
// ceiling even while the overall context budget had room to spare.
// ---------------------------------------------------------------------------------------------

test('extractControlCenterKnowledge files 流式写回\'s own reason line under its own label, not the previous unrelated <h3> (自动接续翻译), against the real control center markup (review finding helper.js:286, v2)', () => {
  const lines = extractControlCenterKnowledge(CONTROL_CENTER_MARKUP);
  assert.ok(
    lines.some(line => line.startsWith('翻译台 › 流式写回') && line.includes('只在独立连接下生效')),
    '流式写回自己的说明应该归在它自己的 label 底下',
  );
  assert.ok(
    !lines.some(line => line.startsWith('翻译台 › 自动接续翻译 › ') && line.includes('只在独立连接下生效')),
    '不该再把流式写回的说明错误地归到前一个不相干的 h3「自动接续翻译」下面',
  );
});

test('extractControlCenterKnowledge does not file the shared per-connection edit form\'s own fields under the built-in 跟随酒馆 card, against the real control center markup (review finding helper.js:286, v2)', () => {
  const lines = extractControlCenterKnowledge(CONTROL_CENTER_MARKUP);
  assert.ok(
    !lines.some(line => line.startsWith('模型连接 › 跟随酒馆 › ') && /连接名称|API 基础地址|API 密钥|当前模型/.test(line)),
    '跟随酒馆不需要连接名称/地址/密钥/模型，这些字段不该被归到它底下——模型连接后会以为跟随酒馆也要填密钥',
  );
  // 请求参数 has its own real <h2> right after the shared form's headerless prefix, and must still be
  // reached — the fix cuts only the headerless prefix, not the whole shared form.
  assert.ok(
    lines.some(line => line.startsWith('模型连接 › 请求参数 › ')),
    '请求参数折叠组自己的说明不该被连带砍掉',
  );
});

test('extractControlCenterKnowledge no longer truncates 朗读 at a flat 40-line-per-page ceiling — 深度分析/单次分析最长等待/默认调音台/副模型提示词 all still get through, against the real control center markup (review finding helper.js:286, v2)', () => {
  const lines = extractControlCenterKnowledge(CONTROL_CENTER_MARKUP);
  const ttsLines = lines.filter(line => line.startsWith('朗读 › '));
  assert.ok(ttsLines.length > 40, `朗读页应该贡献超过旧上限（40）的行数，实际 ${ttsLines.length}`);
  assert.ok(ttsLines.some(line => line.includes('深度分析') || line.startsWith('朗读 › 深度分析')), '深度分析的说明不该被砍掉');
  assert.ok(ttsLines.some(line => line.includes('单次分析最长等待')), '单次分析最长等待不该被砍掉');
  assert.ok(ttsLines.some(line => line.startsWith('朗读 › 默认调音台') || line.includes('默认调音台')), '默认调音台不该被砍掉');
  assert.ok(ttsLines.some(line => line.startsWith('朗读 › 副模型提示词')), '副模型提示词不该被砍掉');
});

// ---------------------------------------------------------------------------------------------
// helperVersionsSnapshot — review finding index.js:11731 (v2): koboldhorde shares Kobold's own
// #streaming_kobold checkbox on the page, but SillyTavern's isStreamingEnabled() (script.js) never
// streams for koboldhorde regardless of that checkbox, so it must be reported 关 directly rather than
// read off a box it does not really own. Also covers the per-main-API checkbox choice itself, the v1
// fix test/helper-apply.test.mjs:1 flagged as never actually exercised.
// ---------------------------------------------------------------------------------------------

test('helperVersionsSnapshot reads the streaming checkbox that matches context.mainApi, reports koboldhorde as 关 without ever reading a checkbox, and 未知 (not a guessed 关) when nothing matches', async () => {
  const boxes = {
    '#stream_toggle': { checked: true },
    '#streaming_textgenerationwebui': { checked: false },
    '#streaming_kobold': { checked: true },
    '#streaming_novel': { checked: false },
  };
  const beforeDocument = globalThis.document;
  const beforeSillyTavern = globalThis.SillyTavern;
  globalThis.document = { querySelector: selector => boxes[selector] ?? null };
  try {
    globalThis.SillyTavern = { getContext: () => ({ mainApi: 'openai' }) };
    assert.equal((await helperVersionsSnapshot()).streaming, true, 'openai 读 #stream_toggle');

    globalThis.SillyTavern = { getContext: () => ({ mainApi: 'textgenerationwebui' }) };
    assert.equal((await helperVersionsSnapshot()).streaming, false, 'textgenerationwebui 读 #streaming_textgenerationwebui');

    globalThis.SillyTavern = { getContext: () => ({ mainApi: 'kobold' }) };
    assert.equal((await helperVersionsSnapshot()).streaming, true, 'kobold 读 #streaming_kobold');

    globalThis.SillyTavern = { getContext: () => ({ mainApi: 'novel' }) };
    assert.equal((await helperVersionsSnapshot()).streaming, false, 'novel 读 #streaming_novel');

    // #streaming_kobold above is ticked (true) — if koboldhorde read that same box like it used to, this
    // would wrongly come back true.
    globalThis.SillyTavern = { getContext: () => ({ mainApi: 'koboldhorde' }) };
    assert.equal((await helperVersionsSnapshot()).streaming, false, 'koboldhorde 永远关，不读任何复选框');

    globalThis.SillyTavern = { getContext: () => ({ mainApi: 'some-future-api' }) };
    assert.equal((await helperVersionsSnapshot()).streaming, null, '没有对应复选框时是未知，不是猜的关');
  } finally {
    globalThis.document = beforeDocument;
    globalThis.SillyTavern = beforeSillyTavern;
  }
});

// ---------------------------------------------------------------------------------------------
// helperHistoryTurns — review finding index.js:11959 / test/helper-apply.test.mjs:1: the filter that
// keeps a reply's own history to only turns that actually answered had no test of its own; deleting it
// left every other test green.
// ---------------------------------------------------------------------------------------------

test('helperHistoryTurns keeps only turns that actually answered, drops errored or answerless ones, and caps at the last 3', () => {
  const turns = [
    { question: 'q1', answer: 'a1', error: '' },
    { question: 'q2', answer: '', error: '请求已取消。' },
    { question: 'q3', answer: 'a3', error: '' },
    { question: 'q4', answer: '', error: '' },
    { question: 'q5', answer: 'a5', error: '' },
    { question: 'q6', answer: 'a6', error: '' },
  ];
  assert.deepEqual(helperHistoryTurns(turns).map(t => t.question), ['q3', 'q5', 'q6']);
});

test('helperHistoryTurns tolerates a non-array input', () => {
  assert.deepEqual(helperHistoryTurns(undefined), []);
  assert.deepEqual(helperHistoryTurns(null), []);
});

// ---------------------------------------------------------------------------------------------
// helperLiveRoot — review finding index.js:11971: askHelper used to render its finished answer into
// the DOM root it captured when the question was asked; closing and reopening the control center
// leaves that root detached, so the reopened panel stayed on 正在想… forever.
// ---------------------------------------------------------------------------------------------

test('helperLiveRoot prefers the currently open panel\'s own root over a fallback, so a finished reply lands in a reopened panel instead of a detached one', () => {
  const fallback = { id: 'fallback' };
  assert.equal(helperLiveRoot(fallback), fallback, '没有打开的面板时用回退值');
  const liveRoot = { id: 'live' };
  configureForTest({ panel: { controller: { root: liveRoot } } });
  try {
    assert.equal(helperLiveRoot(fallback), liveRoot, '面板打开时用面板自己的根节点，不用回退值');
  } finally {
    configureForTest({ panel: null });
  }
});

// ---------------------------------------------------------------------------------------------
// askHelper — the real request path (onChannel + requestSubModelRaw + parseHelperReply +
// validateHelperSuggestions), not just its pieces in isolation. Covers the high-severity unwrap fix
// on the actual independent-connection path it fails on, the abort wiring, and rendering into the
// live panel root — all flagged by review finding test/helper-apply.test.mjs:1 as untested.
// ---------------------------------------------------------------------------------------------

function helperTestSettings(overrides = {}) {
  return mergeSettings({
    channels: [{ id: 'c1', name: '连接一', url: 'https://api.example.com/v1', key: 'sk-x', model: 'gpt-x' }],
    helper: { channelId: 'c1', prompt: '' },
    ...overrides,
  });
}

test('askHelper unwraps the { content, reasoning } object an independent (saved) connection returns before parsing suggestions — the real request path, not just parseHelperReply in isolation (review finding helper.js:616, high)', async () => {
  clearDiagnostics();
  configureForTest({ settings: helperTestSettings(), panel: null, resetHelper: true });
  const reply = '这样试试。\n\n```jingyi-suggest\n[{"type":"set","field":"autoGeneration","value":false,"why":"你不想自动翻"}]\n```';
  const beforeSillyTavern = globalThis.SillyTavern;
  globalThis.SillyTavern = {
    getContext: () => ({
      mainApi: 'openai',
      extensionSettings: { regex: [] },
      ChatCompletionService: { processRequest: async () => ({ content: reply, reasoning: '模型的思考过程，不该出现在回答里' }) },
    }),
  };
  try {
    const { root } = fakeHelperRoot();
    const turn = await askHelper(root, '我怎么没办法翻译？');
    assert.equal(turn.error, '', '独立连接的对象回复不该被当成失败');
    assert.equal(turn.answer, '这样试试。', '应该拿到解包后的文字，而不是 "[object Object]"');
    assert.equal(turn.suggestions.length, 1);
    assert.equal(turn.suggestions[0].field, 'autoGeneration');
    assert.ok(
      readDiagnostics().some(entry => entry.scope === 'helper.ask' && entry.level === 'info'),
      '这次成功的 ask 应该记一条成功的运行记录',
    );
  } finally {
    globalThis.SillyTavern = beforeSillyTavern;
  }
});

test('askHelper honours abort (closing the control center / 清空 mid-ask) — the pending request is cancelled, the turn reads 请求已取消, and a reader cancel is never logged as an ERROR (review findings index.js:11971 abort wiring, index.js:12036)', async () => {
  clearDiagnostics();
  configureForTest({ settings: helperTestSettings(), panel: null, resetHelper: true });
  const beforeSillyTavern = globalThis.SillyTavern;
  globalThis.SillyTavern = {
    getContext: () => ({
      mainApi: 'openai',
      extensionSettings: { regex: [] },
      // Never resolves on its own — only abort ends this request, so the test controls exactly when.
      ChatCompletionService: {
        processRequest: (body, opts, extractData, requestSignal) => new Promise((resolve, reject) => {
          const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          if (requestSignal?.aborted) { onAbort(); return; }
          requestSignal?.addEventListener('abort', onAbort, { once: true });
        }),
      },
    }),
  };
  try {
    const { root } = fakeHelperRoot();
    const before = readDiagnostics().length;
    const askPromise = askHelper(root, '问题');
    // askHelper runs synchronously up to its first `await` (Promise.all for manual/floor/versions/
    // regex), which is where runtime.helper.controller gets set — so it already exists the instant
    // askHelper(...) hands back a pending promise, in this same synchronous tick. Aborting here is
    // exactly what closing the control center or clicking 清空 mid-ask does.
    const controller = __testing.helperController();
    assert.ok(controller, 'askHelper 应该已经同步建立好 AbortController');
    controller.abort();
    const turn = await askPromise;
    assert.equal(turn.error, '请求已取消。');
    assert.equal(turn.answer, '');
    assert.equal(
      readDiagnostics().length,
      before,
      '读者自己取消不该记一条新的运行记录，更不该是 ERROR（会被下一次提问当成这条连接真的出过错）',
    );
    assert.equal(__testing.helperController(), null, '结束后控制器应该清空');
  } finally {
    globalThis.SillyTavern = beforeSillyTavern;
  }
});

test('askHelper renders its finished answer into the currently open panel\'s own root, not the one it started with — a reopened panel must not stay stuck on 正在想… (review finding index.js:11971)', async () => {
  clearDiagnostics();
  const settings = helperTestSettings();
  configureForTest({ settings, panel: null, resetHelper: true });
  const { root: startedRoot, conversation: startedConversation } = fakeHelperRoot();
  const { root: liveRoot, conversation: liveConversation } = fakeHelperRoot();
  // The panel is open with `startedRoot` when the ask begins — the same root askHelper is handed.
  configureForTest({ panel: { controller: { root: startedRoot } } });
  let releaseReply;
  const beforeSillyTavern = globalThis.SillyTavern;
  globalThis.SillyTavern = {
    getContext: () => ({
      mainApi: 'openai',
      extensionSettings: { regex: [] },
      ChatCompletionService: {
        processRequest: () => new Promise(resolve => { releaseReply = resolve; }),
      },
    }),
  };
  try {
    const askPromise = askHelper(startedRoot, '问题');
    // Give the pending request a moment to actually be in flight (past the manual/floor/versions/
    // regex Promise.all), then simulate the reader closing the control center and reopening it —
    // exactly what leaves askHelper holding a `root` argument that is no longer the live one.
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(startedConversation.children.length, 1, '提问时的「正在想…」应该先渲染进当时打开的面板');
    configureForTest({ panel: { controller: { root: liveRoot } } });
    releaseReply({ content: '答案到了。', reasoning: '' });
    await askPromise;
    assert.equal(liveConversation.children.length, 1, '完成的回答应该渲染进当前存活面板的根节点');
    assert.equal(startedConversation.children.length, 1, '旧面板（已关闭、脱离文档）应该还停在「正在想…」，不会再被写入');
  } finally {
    globalThis.SillyTavern = beforeSillyTavern;
    configureForTest({ panel: null });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APP_VERSION,
  TRANSLATION_END,
  TRANSLATION_START,
  SOURCE_END,
  SOURCE_START,
  AFFIX_END,
  AFFIX_START,
  DEFAULT_SETTINGS,
  INVISIBLE_MARKER,
  assembleBilingual,
  assembleReplace,
  assembleTranslationOnly,
  floorText,
  hashTextSync,
  readFloor,
  restoreStrippedForPrompt,
  HIDDEN_START,
  HIDDEN_END,
  MESSAGE_META_KEY,
  renderReplacePair,
  renderSourceBlock,
  renderTranslationBlock,
  estimateRequestTokens,
  extractReplaceTranslations,
  createTranslationSignature,
  detectUnmarkedAffixes,
  createGenerationGate,
  createIndependentRequest,
  extractGeneratedTranslations,
  extractReasoningText,
  extractTaggedRegion,
  extractTaggedRegions,
  interceptGenerationChat,
  planTranslationBatches,
  translationCharBudget,
  inspectTagConfiguration,
  withoutCarriedColor,
  lineFormatting,
  mergeSettings,
  getActiveChannel,
  getActivePromptProfile,
  normalizeOpenAiBaseUrl,
  parseModelListResponse,
  parsePreserveLineRulesWithErrors,
  parseLyricLineRulesWithErrors,
  parseTagNames,
  parseTagNamesWithErrors,
  splitSpeechParts,
  describeSpeechShape,
  liftSplitQuotes,
  parseStructuredTranslations,
  recoverStructuredTranslations,
  rebuildTaggedRegion,
  rebuildTaggedRegions,
  segmentSource,
  restyleBilingual,
  stripGeneratedTranslationLines,
  matchesPreserveLine,
  SEGMENTATION_RULES_VERSION,
  UI_MODES,
  CONSOLE_PRESET_IDS,
  CONTROL_CENTER_PAGES,
  pagesForMode,
  pageExistsInMode,
  resolvePageForMode,
  CONNECTION_USES,
  connectionUseChoice,
  setConnectionUse,
  channelUsesPointingAt,
  reassignConnectionUsesOnDelete,
  PRESET_MANAGED_FIELDS,
  PRESET_LABELS,
  PRESET_TIER_LABELS,
  presetContent,
  applyPreset,
  presetDrift,
  translationChannelChoice,
  resolveFeatureChannel,
  preserveLineRuleCountLabel,
  segmentAffixSummary,
  coloringDetailFoldSummary,
  quoteSymbolFoldSummary,
  fishParamsFoldSummary,
  consoleFoldSummary,
  voiceLibraryFoldSummary,
  channelRequestFoldSummary,
  channelPostscriptFoldSummary,
  DEFAULT_CONSOLE,
} from '../core.js';
import {
  addDiagnostic,
  clearDiagnostics,
  formatDiagnosticReport,
  filterDiagnosticsByFloor,
  formatFullDiagnosticReport,
  listDiagnosticFloors,
  readDiagnostics,
  sanitizeDiagnostic,
} from '../diagnostics.js';
import {
  CORE_TRANSLATION_SPEC,
  PRE_OUTPUT_CHECKLIST,
  PREVIOUS_CORE_TRANSLATION_SPEC,
  PREVIOUS_PRE_OUTPUT_CHECKLIST,
} from '../prompts.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('default settings use story_scene and migrate the legacy single tag', () => {
  assert.deepEqual(DEFAULT_SETTINGS.bodyTags, ['story_scene']);
  assert.deepEqual(mergeSettings({ schemaVersion: 6, bodyTag: ' story_scene ' }).bodyTags, ['story_scene']);
  assert.deepEqual(mergeSettings({ schemaVersion: 6, bodyTag: 'bad tag' }).bodyTags, ['story_scene']);
  assert.deepEqual(mergeSettings({ bodyTags: 'story_scene\nmain_text\nstory_scene', excludedTags: 'status, thinking' }).bodyTags, ['story_scene', 'main_text']);
  assert.deepEqual(mergeSettings({ excludedTags: 'status, thinking' }).excludedTags, ['status', 'thinking']);
  assert.deepEqual(parseTagNames('<story_scene>\nstory_scene'), ['story_scene']);
  assert.deepEqual(parseTagNames('</story_scene>\n<status/>'), ['story_scene', 'status']);
  assert.deepEqual(parseTagNamesWithErrors('story_scene\n<bad tag>').invalid, ['<bad', 'tag>']);
  assert.equal(DEFAULT_SETTINGS.retries, 1);
  assert.equal(DEFAULT_SETTINGS.streamingWriteback, false);
  assert.equal(DEFAULT_SETTINGS.contextMessages, 2);
  assert.equal(DEFAULT_SETTINGS.preserveLineRules, '');
  assert.equal(DEFAULT_SETTINGS.uiMode, 'normal');
  assert.equal(DEFAULT_SETTINGS.preset, '');
});

test('legacy single-channel settings migrate into a saved channel', () => {
  const legacy = mergeSettings({ apiMode: 'profile', profileId: 'old-profile' });
  assert.equal(legacy.apiMode, 'follow');
  assert.equal('profileId' in legacy, false);
  const independent = mergeSettings({
    apiMode: 'independent',
    apiUrl: ' https://example.com/v1/ ',
    apiKey: ' secret ',
    apiModel: ' model-x ',
    timeoutSec: 9999,
  });
  const channel = getActiveChannel(independent);
  assert.equal(channel.url, 'https://example.com/v1/');
  assert.equal(channel.key, 'secret');
  assert.equal(channel.model, 'model-x');
  assert.equal(channel.timeoutSec, 600);
  assert.equal(independent.schemaVersion, 13);
});

test('channel output budget scales with the raised default and no longer flattens above 32768', () => {
  assert.equal(getActiveChannel(mergeSettings({})).maxTokens, 60000);
  assert.equal(getActiveChannel(mergeSettings({})).timeoutSec, 240);
  assert.equal(mergeSettings({ retries: 9 }).retries, 5);
  assert.equal(DEFAULT_SETTINGS.contextMessages, 2);
  const wide = mergeSettings({
    channels: [{ id: 'c1', url: 'https://example.com/v1', key: 'k', model: 'm', maxTokens: 120000 }],
    selectedChannelId: 'c1',
  });
  assert.equal(getActiveChannel(wide).maxTokens, 120000);
});

test('legacy prompt settings migrate into one editable translation profile', () => {
  const migrated = mergeSettings({
    schemaVersion: 5,
    glossary: '桜井 = 樱井',
    translationPrompt: '保留我以前写的特殊翻译规则。',
  });
  const profile = getActivePromptProfile(migrated);
  assert.equal(profile.glossary, '桜井 = 樱井');
  assert.equal(profile.customSections.length, 1);
  assert.equal(profile.customSections[0].title, '从旧版迁移的翻译规则');
  assert.match(profile.customSections[0].content, /特殊翻译规则/);
  for (const key of ['basePrompt', 'translationPrompt', 'referencePrompt', 'reviewPrompt', 'outputPrompt', 'repairPrompt', 'glossary']) {
    assert.equal(key in migrated, false);
  }
});

test('known untouched default prompts upgrade without overwriting user edits', () => {
  const upgraded = mergeSettings({
    schemaVersion: 7,
    promptProfiles: [{
      id: 'old-default',
      name: '旧默认',
      corePrompt: PREVIOUS_CORE_TRANSLATION_SPEC,
      checklistPrompt: PREVIOUS_PRE_OUTPUT_CHECKLIST,
    }],
  });
  assert.equal(upgraded.promptProfiles[0].corePrompt, CORE_TRANSLATION_SPEC);
  assert.equal(upgraded.promptProfiles[0].checklistPrompt, PRE_OUTPUT_CHECKLIST);

  const customized = mergeSettings({
    schemaVersion: 7,
    promptProfiles: [{ id: 'custom', name: '自定义', corePrompt: '保留我的核心规范。', checklistPrompt: '保留我的检查表。' }],
  });
  assert.equal(customized.promptProfiles[0].corePrompt, '保留我的核心规范。');
  assert.equal(customized.promptProfiles[0].checklistPrompt, '保留我的检查表。');
  assert.equal(customized.promptProfiles[0].targetLanguage, '简体中文');
});

test('independent channel request uses an isolated OpenAI-compatible proxy payload', () => {
  assert.equal(normalizeOpenAiBaseUrl('https://example.com'), 'https://example.com/v1');
  assert.equal(normalizeOpenAiBaseUrl('https://example.com/v1/chat/completions'), 'https://example.com/v1');
  // Volcengine Ark keeps its version segment behind a plan prefix. The default /v1 must never be
  // appended over a path that is already there, or the Coding Plan base turns into a 404.
  assert.equal(
    normalizeOpenAiBaseUrl('https://ark.cn-beijing.volces.com/api/coding/v3/'),
    'https://ark.cn-beijing.volces.com/api/coding/v3',
  );
  assert.equal(
    normalizeOpenAiBaseUrl('https://ark.cn-beijing.volces.com/api/v3/chat/completions'),
    'https://ark.cn-beijing.volces.com/api/v3',
  );
  const messages = [{ role: 'user', content: '雨。' }];
  const payload = createIndependentRequest({
    apiUrl: 'https://example.com',
    apiKey: 'key',
    apiModel: 'translator',
    temperature: 0.2,
    maxTokens: 2048,
  }, messages);
  assert.equal(payload.chat_completion_source, 'openai');
  assert.equal(payload.reverse_proxy, 'https://example.com/v1');
  assert.equal(payload.proxy_password, 'key');
  assert.equal(payload.model, 'translator');
  assert.equal(payload.messages, messages);
  assert.throws(() => normalizeOpenAiBaseUrl('file:///tmp/model'), /http/);
  const excluded = createIndependentRequest({
    apiUrl: 'https://example.com',
    apiModel: 'translator',
    excludeParams: ['temperature', 'presence_penalty', 'model'],
  }, messages);
  assert.equal('temperature' in excluded, false);
  assert.equal('presence_penalty' in excluded, false);
  assert.equal(excluded.model, 'translator');
});

test('logs can be exported per floor and carry the request without leaking it into the safe summary', () => {
  clearDiagnostics();
  addDiagnostic({
    level: 'info', scope: 'translation.raw-response', message: '返回', details: { phase: 'primary' }, floor: 42,
    fullRequest: [{ role: 'system', content: '核心规范正文' }, { role: 'user', content: '夕暮れの教室' }],
    fullResponse: '{"translations":[{"id":1,"text":"傍晚的教室"}]}',
  });
  addDiagnostic({ level: 'info', scope: 'translation.raw-response', message: '别楼', details: {}, floor: 41, fullResponse: '别楼返回' });

  const entries = readDiagnostics();
  assert.deepEqual(listDiagnosticFloors(entries), [41, 42]);
  assert.equal(filterDiagnosticsByFloor(entries, 42).length, 1);
  assert.deepEqual(filterDiagnosticsByFloor(entries, 999), []);

  const scoped = formatFullDiagnosticReport(filterDiagnosticsByFloor(entries, 42), { floor: 42 });
  assert.match(scoped, /发送给副 API 的完整请求/);
  assert.match(scoped, /完整副 API 返回/);
  assert.match(scoped, /第 42 楼/);
  assert.doesNotMatch(scoped, /别楼/);

  // The safe summary is what people paste in public, so it must never carry the prompt or the story.
  const safe = formatDiagnosticReport(entries, {});
  assert.doesNotMatch(safe, /核心规范正文|夕暮れの教室/);
  clearDiagnostics();
});

test('long floors are split into batches that fit the channel output budget', () => {
  assert.equal(translationCharBudget(4096), 3277);
  assert.equal(translationCharBudget(256), 400);
  assert.equal(translationCharBudget(32768), 26214);
  assert.equal(translationCharBudget(60000), 48000);
  assert.equal(translationCharBudget(200000), 160000);
  assert.equal(translationCharBudget(1000000), 160000);

  const segments = Array.from({ length: 40 }, (_, index) => ({ id: index + 1, text: 'あ'.repeat(100) }));
  const batches = planTranslationBatches(segments, { maxChars: translationCharBudget(4096) });
  assert.ok(batches.length > 1, '40 段长正文必须拆批');
  assert.deepEqual(batches.flat().map(item => item.id), segments.map(item => item.id));
  for (const batch of batches) {
    assert.ok(batch.reduce((sum, item) => sum + item.text.length, 0) <= 3277 || batch.length === 1);
  }

  const manySmall = Array.from({ length: 300 }, (_, index) => ({ id: index + 1, text: 'あ'.repeat(10) }));
  const singleBatch = planTranslationBatches(manySmall, { maxChars: 5000 });
  assert.equal(singleBatch.length, 1, '300 段小正文在字符预算内必须单批，段数不再设限');
  assert.equal(singleBatch[0].length, 300);

  const short = planTranslationBatches([{ id: 1, text: '短い。' }], { maxChars: 1434 });
  assert.equal(short.length, 1);
  assert.deepEqual(planTranslationBatches([]), []);

  const huge = planTranslationBatches([{ id: 1, text: 'あ'.repeat(9000) }], { maxChars: 1434 });
  assert.equal(huge.length, 1, '超长单段仍然独立成批，不会被丢掉');
});

test('generation gate only consumes the matching real generation', () => {
  const gate = createGenerationGate();
  assert.equal(gate.begin('chat-a', 'quiet'), false);
  assert.equal(gate.begin('chat-a', 'normal', true), false);
  assert.equal(gate.begin('chat-a', 'normal'), true);
  assert.equal(gate.consume('chat-b', 'normal'), false);
  assert.deepEqual(gate.peek(), { chatId: 'chat-a', type: 'normal' });
  assert.equal(gate.consume('chat-a', 'normal'), true);
  assert.equal(gate.peek(), null);
});

test('generation gate follows the types SillyTavern rewrites on the way to the render', () => {
  const gate = createGenerationGate();
  // 重新生成 without streaming: the old reply is deleted, the last message is the user's, and the
  // reply is saved and rendered as 'normal'.
  gate.begin('chat-a', 'regenerate');
  assert.equal(gate.consume('chat-a', 'normal'), true);
  // 继续 without streaming renders as 'appendFinal'.
  gate.begin('chat-a', 'continue');
  assert.equal(gate.consume('chat-a', 'appendFinal'), true);
  // A generation started with no type is SillyTavern's own normal one, and so is its render.
  assert.equal(gate.begin('chat-a', undefined), true);
  assert.deepEqual(gate.peek(), { chatId: 'chat-a', type: 'normal' });
  assert.equal(gate.consume('chat-a', undefined), true);
  // Streaming keeps the type as it started.
  gate.begin('chat-a', 'swipe');
  assert.equal(gate.consume('chat-a', 'swipe'), true);
  // Messages no generation made never take the reply's place.
  gate.begin('chat-a', 'normal');
  assert.equal(gate.consume('chat-a', 'first_message'), false);
  assert.equal(gate.consume('chat-a', 'command'), false);
  assert.equal(gate.consume('chat-a', 'normal'), true);
  // A continuation is not closed by some other 'normal' render.
  gate.begin('chat-a', 'continue');
  assert.equal(gate.consume('chat-a', 'normal'), false);
  assert.equal(gate.consume('chat-a', 'continue'), true);
  // Nor by a render in another chat, whatever its type.
  gate.begin('chat-a', 'regenerate');
  assert.equal(gate.consume('chat-b', 'normal'), false);
});

test('only marked generated translation lines are stripped', () => {
  const text = `日文。\n{普通花括号内容}\n{${INVISIBLE_MARKER}中文。}\n次の文。`;
  assert.equal(stripGeneratedTranslationLines(text), '日文。\n{普通花括号内容}\n次の文。');
});

test('modern multiline and legacy single-line translations can be stripped and recovered', () => {
  const source = '一。\n続き。\n\n二。';
  const layout = segmentSource(source).layout;
  const rendered = assembleBilingual(layout, new Map([[1, '一。'], [2, '继续。'], [3, '二。']]));
  assert.equal(stripGeneratedTranslationLines(rendered), source);
  assert.deepEqual([...extractGeneratedTranslations(rendered)], [[1, '一。'], [2, '继续。'], [3, '二。']]);

  const legacy = `三。\n{${INVISIBLE_MARKER}三。}`;
  assert.equal(stripGeneratedTranslationLines(legacy), '三。');
  assert.deepEqual([...extractGeneratedTranslations(legacy)], [[1, '三。']]);
});

test('generation interceptor mutates prompt copies without touching unrelated shapes', () => {
  const chat = [
    { mes: `日文。\n{${INVISIBLE_MARKER}中文。}`, is_user: false },
    { mes: '用户原文', is_user: true },
    { content: 'not a coreChat item' },
  ];
  assert.equal(interceptGenerationChat(chat), 1);
  assert.equal(chat[0].mes, '日文。');
  assert.equal(chat[1].mes, '用户原文');
});

test('tag extraction and rebuild preserve everything outside story_scene', () => {
  const source = '<meta>x</meta>\n<story_scene mood="quiet">\n一。\n\n二。\n</story_scene>\n<footer>y</footer>';
  const region = extractTaggedRegion(source, 'story_scene');
  assert.match(region.openTag, /^<story_scene/);
  assert.equal(region.inner, '\n一。\n\n二。\n');
  const rebuilt = rebuildTaggedRegion(region, '\n改。\n');
  assert.equal(rebuilt, '<meta>x</meta>\n<story_scene mood="quiet">\n改。\n</story_scene>\n<footer>y</footer>');
});

test('multiple extraction tags select only the last complete group of each tag', () => {
  const source = '<story_scene>旧。</story_scene>\n<meta>保留</meta>\n<story_scene>新。</story_scene>\n<after_story>后记。</after_story>';
  const extraction = extractTaggedRegions(source, ['story_scene', 'after_story', 'missing']);
  assert.deepEqual(extraction.regions.map(region => [region.tagName, region.inner]), [
    ['story_scene', '新。'],
    ['after_story', '后记。'],
  ]);
  assert.deepEqual(extraction.missingTags, ['missing']);
  assert.equal(
    rebuildTaggedRegions(extraction, region => region.tagName === 'story_scene' ? '新译。' : '后记译。'),
    '<story_scene>旧。</story_scene>\n<meta>保留</meta>\n<story_scene>新译。</story_scene>\n<after_story>后记译。</after_story>',
  );
});

test('segmentation and bilingual assembly preserve blank-line layout', () => {
  const segmented = segmentSource('\n一。\n続き。\n\n二。\n');
  assert.deepEqual(segmented.segments, [
    { id: 1, text: '一。' },
    { id: 2, text: '続き。' },
    { id: 3, text: '二。' },
  ]);
  assert.equal(segmented.paragraphs, 2);
  const output = assembleBilingual(segmented.layout, new Map([[1, '一。'], [2, '继续。'], [3, '二。']]));
  assert.equal(output.replace(/[\u200b\u200c\u2060-\u2064]/g, ''), '\n一。\n続き。\n{一。\n继续。}\n\n二。\n{二。}\n');
});

test('custom wrappers surround each blank-line paragraph and are removed before retranslation', () => {
  const wrapped = assembleBilingual(
    segmentSource('一。\n続き。\n\n二。').layout,
    new Map([[1, '一。'], [2, '继续。'], [3, '二。']]),
    { segmentPrefix: '<small>', segmentSuffix: '</small>' },
  );
  assert.equal(wrapped.replace(/[\u200b\u200c\u2060-\u2064]/g, ''), '<small>一。\n続き。</small>\n{一。\n继续。}\n\n<small>二。</small>\n{二。}');
  const segmentedAgain = segmentSource(wrapped, { segmentPrefix: '<small>', segmentSuffix: '</small>' });
  assert.deepEqual(segmentedAgain.segments, [{ id: 1, text: '一。' }, { id: 2, text: '続き。' }, { id: 3, text: '二。' }]);
});

test('translation wrappers stay inside the invisible markers and survive a round trip', () => {
  const options = { translationPrefix: '<font color=#8aa>', translationSuffix: '</font>' };
  const layout = segmentSource('一。\n続き。\n\n二。').layout;
  const map = new Map([[1, '一。'], [2, '继续。'], [3, '二。']]);
  const rendered = assembleBilingual(layout, map, options);

  assert.equal(
    rendered.replace(/[\u200b\u200c\u2060-\u2064]/g, ''),
    '一。\n続き。\n<font color=#8aa>一。\n继续。</font>'
      + '\n\n二。\n<font color=#8aa>二。</font>',
  );
  assert.equal(stripGeneratedTranslationLines(rendered), '一。\n続き。\n\n二。');
  assert.deepEqual([...extractGeneratedTranslations(rendered, options)], [...map]);
});

test('excluded nested tags stay in place but never enter translation segments', () => {
  const source = '\n一行目。\n<status>\nHP: 10\n<meta>secret</meta>\n</status>\n二行目。\n\n三段目。\n';
  const segmented = segmentSource(source, { excludedTags: ['status'] });
  assert.deepEqual(segmented.segments, [
    { id: 1, text: '一行目。' },
    { id: 2, text: '二行目。' },
    { id: 3, text: '三段目。' },
  ]);
  const output = assembleBilingual(segmented.layout, new Map([[1, '第一行。'], [2, '第二行。'], [3, '第三段。']]));
  assert.match(output, /<status>\nHP: 10\n<meta>secret<\/meta>\n<\/status>/);
  assert.match(output.replace(/[\u200b\u200c\u2060-\u2064]/g, ''), /二行目。\n\{第一行。\n第二行。\}/);
  assert.doesNotMatch(segmented.segments[0].text, /HP|secret|status/);
});

test('preserve whitelist supports exact, prefix and regular-expression rules', () => {
  const parsed = parsePreserveLineRulesWithErrors([
    '此时彼刻',
    'prefix:【系统记录】',
    '/^\\s*VIEW:/i',
  ]);
  assert.deepEqual(parsed.errors, []);
  const source = [
    '╔——————╗',
    '此时彼刻',
    '—— · —— · ——',
    '【系统记录】不要翻译',
    'VIEW: KEEP',
    'サイモンズ視点',
    '彼は静かに紅茶を注いだ。',
  ].join('\n');
  const segmented = segmentSource(source, { preserveLineRules: ['此时彼刻', 'prefix:【系统记录】', '/^\\s*VIEW:/i'] });
  assert.deepEqual(segmented.segments, [
    { id: 1, text: 'サイモンズ視点' },
    { id: 2, text: '彼は静かに紅茶を注いだ。' },
  ]);
  assert.equal(segmented.paragraphs, 1);
  assert.equal(segmented.customPreservedLines, 3);
  assert.equal(segmented.builtinPreservedLines, 2);
  const output = assembleBilingual(segmented.layout, new Map([
    [1, '西蒙斯视角'],
    [2, '他静静地斟上红茶。'],
  ]));
  assert.ok(output.indexOf('VIEW: KEEP') < output.indexOf('西蒙斯视角'));
  assert.throws(() => segmentSource('本文。', { preserveLineRules: '/[/' }), /第 1 行正则无效/);
  assert.throws(() => segmentSource('本文。', { preserveLineRules: 'prefix:' }), /prefix 不能为空/);
});

test('a <br> or block edge inside one physical line is a line break, not glue, when sent to be translated', () => {
  // No real newline between them — the three card lines are one physical line, joined only by <br>.
  const card = 'NOW PLAYING<br>今日の空<br>作词：陽炎';
  assert.deepEqual(
    segmentSource(card).segments.map(item => item.text),
    ['NOW PLAYING\n今日の空\n作词：陽炎'],
    'the words on either side of a <br> are not run together',
  );
  assert.deepEqual(
    segmentSource(card, { segmentationVersion: 1 }).segments.map(item => item.text),
    ['NOW PLAYING今日の空作词：陽炎'],
    'a floor already segmented under v0.36.0 or older is re-derived exactly as it read then, glue and all',
  );
  // A block edge behaves the same way as <br>.
  assert.deepEqual(segmentSource('<div>甲</div><div>乙</div>').segments.map(item => item.text), ['甲\n\n乙']);
});

test('two adjacent inline elements with nothing of their own between them keep a separating space, on new floors only', () => {
  const line = '<span>NOW PLAYING</span><span>Evening Glass</span>';
  assert.deepEqual(segmentSource(line).segments.map(item => item.text), ['NOW PLAYING Evening Glass']);
  assert.deepEqual(
    segmentSource(line, { segmentationVersion: 1 }).segments.map(item => item.text),
    ['NOW PLAYINGEvening Glass'],
    'a floor already segmented under v0.36.0 or older keeps reading glued, exactly as it did then',
  );
  // Nesting deeper (an opener followed by markup) and unwinding a nest (two closers in a row) need
  // nothing: there is no run of text on that side for the space to separate anything from.
  assert.deepEqual(segmentSource('<span><b>加粗</b>文字</span>').segments.map(item => item.text), ['加粗文字']);
  assert.deepEqual(segmentSource('<span><b>加粗文字</b></span>').segments.map(item => item.text), ['加粗文字']);
  // A tag next to real text on either side already has that text to stand on its own; no space is added.
  assert.deepEqual(segmentSource('前面<b>加粗</b>后面').segments.map(item => item.text), ['前面加粗后面']);
  // Three siblings in a row: a space at each of the two junctions, never doubled.
  assert.deepEqual(segmentSource('<span>甲</span><span>乙</span><span>丙</span>').segments.map(item => item.text), ['甲 乙 丙']);
});

test('a preserve rule matches past a line-level <say> shell and its indentation, on new floors only', () => {
  const rules = ['NOW PLAYING'];
  const line = '  <say who="旁白">NOW PLAYING</say>';
  const modern = segmentSource(line, { preserveLineRules: rules });
  assert.equal(modern.segments.length, 0, 'an indented, speaker-marked line still hits an exact rule written for the bare text');
  assert.equal(modern.customPreservedLines, 1);
  const legacy = segmentSource(line, { preserveLineRules: rules, segmentationVersion: 1 });
  assert.equal(legacy.segments.length, 1, 'a floor already segmented under v0.36.0 or older is matched exactly as it read then: shell and all, so the rule misses and the line stays translated');
  assert.equal(legacy.customPreservedLines, 0);
  assert.equal(matchesPreserveLine('<say who="A">走开</say>', [{ type: 'exact', text: '走开' }], { modern: true }), true);
  assert.equal(matchesPreserveLine('<say who="A">走开</say>', [{ type: 'exact', text: '走开' }]), false, 'options.modern defaults off, matching every version through v0.36.0');
});

test('looking past a <say> shell only adds matches on new floors, it never takes away what v0.36.0 already matched', () => {
  // An indentation-anchored regex: it can only ever see the untrimmed original, shell or not, so
  // stripping the shell to test a trimmed subject instead would make it miss every line it used to hit.
  const indentRule = [{ type: 'regex', source: '/^\\s{4}/', regex: /^\s{4}/ }];
  assert.equal(matchesPreserveLine('    indented code-like line', indentRule, { modern: true }), true);
  assert.equal(matchesPreserveLine('    <say who="A">indented</say>', indentRule, { modern: true }), true, 'the shell sits after the indentation the rule anchors on');
  // A prefix or exact rule written to include the <say> shell itself: v0.36.0 tested these against the
  // trimmed line, shell and all, so a shell-stripped-only subject must not stop that from matching too.
  const prefixRule = [{ type: 'prefix', text: '<say who="System">' }];
  assert.equal(matchesPreserveLine('<say who="System">Signal lost.</say>', prefixRule, { modern: true }), true);
  const exactRule = [{ type: 'exact', text: '<say who="DJ">NOW PLAYING</say>' }];
  assert.equal(matchesPreserveLine('<say who="DJ">NOW PLAYING</say>', exactRule, { modern: true }), true);
  // End to end: a floor whose preserve rules were written against v0.36.0's own matching keeps matching
  // exactly the same lines once segmentSource runs under the modern rules.
  const body = [
    '    indented code-like line',
    '<say who="System">Signal lost.</say>',
    '',
    'Plain prose here.',
  ].join('\n');
  const rules = ['/^\\s{4}/', '/^<say who="System">/'];
  assert.deepEqual(segmentSource(body, { preserveLineRules: rules }).segments.map(item => item.text), ['Plain prose here.']);
  const prefixRules = ['prefix:<say who="System">', '<say who="DJ">NOW PLAYING</say>'];
  const prefixBody = [
    '<say who="DJ">NOW PLAYING</say>',
    '<say who="System">Signal lost.</say>',
    '',
    'Plain prose here.',
  ].join('\n');
  assert.deepEqual(segmentSource(prefixBody, { preserveLineRules: prefixRules }).segments.map(item => item.text), ['Plain prose here.']);
});

test('a play-time readout or a pseudo waveform line is preserved on new floors, translated as before on old ones', () => {
  const card = ['00:42 / 03:15', 'llllIIIIll', '普通句子。'].join('\n\n');
  const modern = segmentSource(card);
  assert.deepEqual(modern.segments.map(item => item.text), ['普通句子。']);
  assert.equal(modern.builtinPreservedLines, 2);
  const legacy = segmentSource(card, { segmentationVersion: 1 });
  assert.deepEqual(
    legacy.segments.map(item => item.text),
    ['00:42 / 03:15', 'llllIIIIll', '普通句子。'],
    'v0.36.0 had no rule for either shape and sent both off to be translated',
  );
  assert.equal(legacy.builtinPreservedLines, 0);
  assert.deepEqual(segmentSource('▶ 00:42 / 03:15 ◀').segments, [], 'decorations around the two clocks do not stop the rule');
  // Under six characters is too short to be confident it is a waveform rather than a short word.
  assert.equal(segmentSource('IIIII').segments.length, 1);
  // A sentence that happens to end in one clock reading is not two clocks, so it stays prose.
  assert.equal(segmentSource('11:30 に会おう。').segments.length, 1);
});

test('a decorative sub-line stays out of what is translated even when <br> folded it into a prose line\'s own text', () => {
  // All three of the card's lines are joined by <br> with no real newline, so item 2's own <br>-as-break
  // rule turns them into one physical `line` whose translationText carries two embedded \n — a decorative
  // reading built only for a whole, undivided line would never see past those to find them.
  const mixed = '<div class="player">NOW PLAYING<br>ılılıllıılı<br>▶ 01:02 / 03:45</div>';
  const segmented = segmentSource(mixed);
  assert.deepEqual(segmented.segments.map(item => item.text), ['NOW PLAYING'], 'the two decorative sub-lines never reach the translator, only the prose one does');
  // Every sub-line decorative: nothing semantic is left, so the whole physical line is preserved and no
  // segment is created for it at all — the same outcome as when it is written on separate lines.
  const allDecorative = '<div class="player">ılılıllıılı<br>▶ 01:02 / 03:45</div>';
  assert.deepEqual(segmentSource(allDecorative).segments, []);
  // An ordinary multi-line card with no decorative content is completely unaffected: every sub-line and
  // its \n are kept exactly as item 2 alone already produced them.
  const prose = 'NOW PLAYING<br>今日の空<br>作词：陽炎';
  assert.deepEqual(segmentSource(prose).segments.map(item => item.text), ['NOW PLAYING\n今日の空\n作词：陽炎']);
  // On an old floor's own rules, translationText never carries an embedded \n in the first place (see
  // stripStructuralTags), so this filter has nothing to do and the glued legacy reading is untouched.
  assert.deepEqual(
    segmentSource(mixed, { segmentationVersion: 1 }).segments.map(item => item.text),
    ['NOW PLAYINGılılıllıılı▶ 01:02 / 03:45'],
  );
});

test('a segment carries a separate reading text only where it differs from what is translated, with struck-through and redacted words dropped', () => {
  const plain = segmentSource('风停了。');
  assert.equal(plain.reading.size, 0, 'nothing hidden, nothing struck: no entry at all, not even an identical one');
  const struck = segmentSource('他说<del>不</del>要去。');
  assert.equal(struck.segments[0].text, '他说不要去。', 'the translation still sees the retracted word');
  assert.equal(struck.reading.get(struck.segments[0].id), '他说要去。', 'the reading drops it');
  const redacted = segmentSource('前面<span style="background-color:currentColor">涂黑的字</span>后面');
  assert.equal(redacted.segments[0].text, '前面涂黑的字后面', 'unchanged for translation');
  assert.equal(redacted.reading.get(redacted.segments[0].id), '前面后面');
  // A decorative sub-line folded away by <br> is dropped from both the translation and the reading, even
  // on a line that separately carries struck-through text of its own elsewhere in it.
  const both = segmentSource('他说<del>不</del>要去。<br>ılılıllıılı');
  assert.equal(both.segments[0].text, '他说不要去。', 'the waveform sub-line never reaches the translator either');
  assert.equal(both.reading.get(both.segments[0].id), '他说要去。');
});

test('transparent container tags and escaped excluded blocks never enter API segments', () => {
  const source = [
    '\\<parallel_line_drive>',
    '[平行线思考]: 原样保留',
    '\\</parallel_line_drive>',
    '\\<parallel_line>',
    '一方、別の少年が立っていた。',
    '',
    '彼は歩き始めた。',
    '\\</parallel_line>',
  ].join('\n');
  const segmented = segmentSource(source, { excludedTags: ['parallel_line_drive'] });
  assert.deepEqual(segmented.segments, [
    { id: 1, text: '一方、別の少年が立っていた。' },
    { id: 2, text: '彼は歩き始めた。' },
  ]);
  assert.deepEqual(segmented.structuralTags, ['parallel_line']);
  const output = assembleBilingual(segmented.layout, new Map([
    [1, '另一方面，另一个少年站在那里。'],
    [2, '他迈步走去。'],
  ]));
  assert.match(output, /\\<parallel_line_drive>\n\[平行线思考]: 原样保留\n\\<\/parallel_line_drive>/);
  assert.match(output.replace(/[\u200b\u200c\u2060-\u2064]/g, ''), /他迈步走去。\}\n\\<\/parallel_line>/);
  assert.doesNotMatch(segmented.segments.map(item => item.text).join('\n'), /parallel_line|平行线思考/);
});

test('self-closing excluded tags are opaque and semantic signatures ignore excluded insertions', () => {
  const prepare = source => {
    const extraction = extractTaggedRegions(source, ['story_scene']);
    let nextId = 1;
    for (const region of extraction.regions) {
      const segmented = segmentSource(region.inner, { excludedTags: ['image_prompt'], startId: nextId });
      region.layout = segmented.layout;
      region.segments = segmented.segments;
      nextId += segmented.segments.length;
    }
    return extraction;
  };
  const before = prepare('<story_scene>前。后。</story_scene>');
  const after = prepare('<meta>later</meta><story_scene>前。<image_prompt data-id="1"/>后。</story_scene>');
  const changed = prepare('<story_scene>前。真的变了。</story_scene>');
  assert.equal(createTranslationSignature(before.regions), createTranslationSignature(after.regions));
  assert.notEqual(createTranslationSignature(before.regions), createTranslationSignature(changed.regions));
  assert.equal(after.regions[0].segments[0].text, '前。后。');
  assert.match(after.regions[0].layout[0].sourceText, /image_prompt/);
});

test('tag inspection reports last-group selection, excluded blocks and structural errors', () => {
  const report = inspectTagConfiguration(
    '<story_scene>旧。</story_scene>\n<story_scene>新。\n\n二。</story_scene><image_prompt/>',
    ['story_scene'],
    ['image_prompt'],
  );
  assert.deepEqual(report.bodyTags, [{ tag: 'story_scene', count: 2, selected: 2 }]);
  assert.deepEqual(report.excludedTags, [{ tag: 'image_prompt', count: 1 }]);
  assert.equal(report.paragraphs, 2);
  assert.equal(report.translationUnits, 2);
  assert.equal(report.customPreservedLines, 0);
  assert.deepEqual(report.errors, []);
  assert.match(inspectTagConfiguration('<story_scene>未闭合', ['story_scene'], []).errors[0], /没有结束标签/);
});

test('a stray tag no longer discards the complete groups next to it', () => {
  // A preset that emits one extra opener used to fail the whole floor with no way to proceed.
  const strayOpen = extractTaggedRegions('<story_scene>正文。</story_scene>\n<story_scene>', ['story_scene']);
  assert.equal(strayOpen.regions.length, 1);
  assert.equal(strayOpen.regions[0].inner, '正文。');
  assert.equal(strayOpen.unbalanced, 1);

  const strayClose = extractTaggedRegions('</story_scene>\n<story_scene>正文。</story_scene>', ['story_scene']);
  assert.equal(strayClose.regions.length, 1);
  assert.equal(strayClose.regions[0].inner, '正文。');

  // An opener with no partner is read to the end of the message instead of failing outright.
  const unclosed = extractTaggedRegions('<story_scene>还在生成', ['story_scene']);
  assert.equal(unclosed.regions.length, 1);
  assert.equal(unclosed.regions[0].inner, '还在生成');
  assert.equal(unclosed.regions[0].assumedClose, true);
  assert.equal(unclosed.assumedCloses, 1);
  assert.throws(() => extractTaggedRegions('普通文本', ['story_scene']), /没有找到正文标签/);

  const report = inspectTagConfiguration('<story_scene>正文。</story_scene>\n<story_scene>', ['story_scene'], []);
  assert.equal(report.bodyTags[0].count, 1);
  assert.match(report.errors[0], /没有对应的结束标签/);
});

test('one line per paragraph pairs each line with its translation and stays strippable', () => {
  const source = 'a\n\nb\nc\nd';
  const translationsFor = seg => new Map(seg.segments.map(item => [item.id, item.text.toUpperCase()]));
  const visible = text => text.replace(/[⁠-⁤​‌]/g, '');

  const grouped = segmentSource(source);
  const groupedOut = assembleBilingual(grouped.layout, translationsFor(grouped), {});
  assert.equal(grouped.paragraphs, 2);
  assert.match(visible(groupedOut), /b\nc\nd\n\{B\nC\nD\}/);

  const perLine = segmentSource(source, { paragraphPerLine: true });
  const perLineOut = assembleBilingual(perLine.layout, translationsFor(perLine), { paragraphPerLine: true });
  assert.equal(perLine.paragraphs, 4);
  // Every source line is followed by its own translation, with a blank line between the pairs.
  assert.match(visible(perLineOut), /b\n\{B\}\n\nc\n\{C\}\n\nd\n\{D\}/);

  // Those separating blank lines sit inside the boundaries, so the main model still sees the original.
  for (const [rendered, options] of [[groupedOut, {}], [perLineOut, { paragraphPerLine: true }]]) {
    assert.equal(stripGeneratedTranslationLines(rendered), source);
    assert.equal(extractGeneratedTranslations(rendered, options).size, 4);
  }
});

test('structured translations accept string, wrapped string, and parsed object responses', () => {
  const expected = [{ id: 1, text: '雨。' }];
  const payload = { translations: [{ id: 1, chinese: '雨。' }] };
  assert.equal(parseStructuredTranslations(JSON.stringify(payload), expected).get(1), '雨。');
  assert.equal(parseStructuredTranslations({ content: JSON.stringify(payload) }, expected).get(1), '雨。');
  assert.equal(parseStructuredTranslations({ content: payload }, expected).get(1), '雨。');
});

test('structured translations recover harmless formatting noise and unordered ids', () => {
  const expected = [{ id: 1, text: '雨。' }, { id: 2, text: '雪。' }];
  const recovered = parseStructuredTranslations({ translations: [
    { id: 2, translation: '{雪。}' },
    { id: 1, chinese: '下雨。\n还在下。' },
  ] }, expected);
  assert.equal(recovered.get(1), '下雨。 还在下。');
  assert.equal(recovered.get(2), '雪。');
});

test('partial translations are retained so only missing ids need repair', () => {
  const expected = [{ id: 1, text: '雨。' }, { id: 2, text: '雪。' }];
  const recovered = recoverStructuredTranslations('```json\n{"translations":[{"id":2,"text":"雪。"}]}\n```', expected);
  assert.equal(recovered.translations.get(2), '雪。');
  assert.deepEqual(recovered.missingIds, [1]);
  assert.throws(() => parseStructuredTranslations({ translations: [] }, expected), /可恢复/);
});

test('all complete items are recovered from a truncated JSON envelope', () => {
  const expected = [
    { id: 1, text: '雨。' },
    { id: 2, text: '雪。' },
    { id: 3, text: '风。' },
  ];
  const truncated = '{"translations":[{"id":1,"text":"下雨。"},{"id":2,"text":"下雪。"},{"id":3,"text":"起风。"}';
  const recovered = recoverStructuredTranslations({ content: truncated, reasoning: '' }, expected);
  assert.deepEqual([...recovered.translations], [[1, '下雨。'], [2, '下雪。'], [3, '起风。']]);
  assert.deepEqual(recovered.missingIds, []);
  assert.equal(recovered.response.contentCharacters, truncated.length);
  assert.ok(recovered.response.parsedCandidates >= 3);
});

test('partial bilingual assembly keeps untranslated source segments untouched', () => {
  const layout = segmentSource('一。\n\n二。\n\n三。').layout;
  const output = assembleBilingual(layout, new Map([[1, '一。'], [3, '三。']]), { allowMissing: true });
  assert.equal(output.replace(/[\u200b\u200c\u2060-\u2064]/g, ''), '一。\n{一。}\n\n二。\n\n三。\n{三。}');
});

test('reasoning-only compatibility responses can still recover the final JSON', () => {
  const expected = [{ id: 1, text: '雨。' }];
  const raw = { content: '', reasoning: '先检查 {姓名}。\n{"translations":[{"id":1,"text":"雨。"}]}\n完成。' };
  assert.equal(parseStructuredTranslations(raw, expected).get(1), '雨。');
});

test('visible think and thinking blocks are ignored only while parsing final JSON', () => {
  const expected = [{ id: 1, text: '雨。' }];
  for (const tag of ['think', 'thinking']) {
    const raw = `<${tag}>■ ID 1\n- 必须保留：降雨。</${tag}>\n{"translations":[{"id":1,"text":"下着雨。"}]}`;
    assert.equal(parseStructuredTranslations(raw, expected).get(1), '下着雨。');
  }
});

test('model list parser accepts OpenAI objects and string lists', () => {
  assert.deepEqual(parseModelListResponse({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] }), ['a', 'b']);
  assert.deepEqual(parseModelListResponse({ models: ['z', 'y'] }), ['y', 'z']);
});

test('diagnostics redact secrets and produce a copyable report', () => {
  const storage = new Map();
  const adapter = {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  };
  addDiagnostic({
    level: 'error',
    scope: 'channel.test',
    message: 'Bearer abc.def failed',
    details: { apiKey: 'secret-value', status: 500 },
  }, adapter);
  const entries = readDiagnostics(adapter);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].details.apiKey, '[已隐藏]');
  assert.doesNotMatch(entries[0].message, /abc\.def/);
  assert.match(formatDiagnosticReport(entries, { appVersion: APP_VERSION }), /channel\.test/);
  assert.equal(sanitizeDiagnostic({ proxy_password: 'x' }).proxy_password, '[已隐藏]');
});

test('diagnostics preserve complete model content separately from the safe summary', () => {
  const storage = new Map();
  const adapter = {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  };
  const longContent = `{"translations":[{"id":1,"text":"${'译'.repeat(1200)}"}]}`;
  addDiagnostic({
    level: 'info',
    scope: 'translation.raw-response',
    message: '已收到副 API 完整返回。',
    details: { requestedSegments: 1 },
    fullResponse: {
      content: longContent,
      reasoning: '<thinking>完整检查内容</thinking>',
      apiKey: 'must-not-leak',
      echoed: 'authorization: sk-abcdefghijklmnop123456',
    },
  }, adapter);
  const entries = readDiagnostics(adapter);
  assert.equal(entries[0].fullResponse.content, longContent);
  assert.equal(entries[0].fullResponse.reasoning, '<thinking>完整检查内容</thinking>');
  assert.equal(entries[0].fullResponse.apiKey, '[已隐藏]');
  assert.doesNotMatch(formatDiagnosticReport(entries), /完整检查内容|译译译/);
  assert.match(formatFullDiagnosticReport(entries), /完整检查内容/);
  assert.match(formatFullDiagnosticReport(entries), /译{100}/);
  assert.doesNotMatch(formatFullDiagnosticReport(entries), /must-not-leak/);
  assert.doesNotMatch(formatFullDiagnosticReport(entries), /sk-abcdefghijklmnop123456/);
});

test('manifest and entry describe a native extension without TavernHelper calls', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const entry = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  assert.equal(Object.hasOwn(manifest, 'minimum_client_version'), false);
  assert.equal(manifest.version, APP_VERSION);
  assert.equal(manifest.generate_interceptor, 'JingyiTranslator_interceptGeneration');
  assert.equal(manifest.hooks.activate, 'onActivate');
  assert.match(manifest.js, /^index\.js\?v=\d+\.\d+\.\d+$/);
  assert.match(manifest.css, /^host\.css\?v=\d+\.\d+\.\d+$/);
  assert.doesNotMatch(entry, /TavernHelper|getVariables|setChatMessages|script_id/);
  assert.doesNotMatch(entry, /ConnectionManagerRequestService/);
  assert.match(entry, /ChatCompletionService/);
  assert.match(entry, /chat-completions\/status/);
  assert.match(entry, /data-jy-model-select/);
  assert.match(entry, /data-jy-field="preserveLineRules"/);
  assert.match(entry, /parsePreserveLineRulesWithErrors/);
  assert.doesNotMatch(entry, /<datalist[^>]*jy-model-list/);
  assert.doesNotMatch(entry, /channel\.model\s*=\s*models\[0\]/);
  assert.match(entry, /autoSwipe"\], \[data-jy-field="streamingWriteback"/);
  assert.match(entry, /toggle-export-drawer/);
  assert.match(entry, /export-recent/);
  assert.match(entry, /export-all/);
  assert.match(entry, /requestTokens/);
  assert.match(entry, /translation\.raw-response/);
  assert.match(entry, /extensionsMenu/);
  assert.match(entry, /extensions_settings2/);
  assert.match(entry, /api\/extensions\/version/);
  assert.match(entry, /api\/extensions\/update/);
  assert.match(entry, /checkUpdatesSilently/);
  assert.doesNotMatch(entry, /globalThis\.location\.(replace|reload)/);
  assert.match(entry, /invokeWithRetries\(snapshot\.segments/);
  assert.doesNotMatch(entry, /chunkSegments|chunkChars|单批字符预算|单批最多段数/);
  assert.match(entry, /data-jy-standard-prompt-list/);
  assert.match(entry, /add-prompt-section/);
  const hostCss = fs.readFileSync(path.join(root, manifest.css.split('?')[0]), 'utf8');
  assert.doesNotMatch(hostCss, /(^|\n)\s*(?:input|select|textarea|button)\b/m);
});

// DESIGN.md §15.4（常夜灯 2026-09-26 批准）：危险操作是红字文字按钮，放在自己那组的末尾。「删除多余正则」是
// 「绑定正则」组里唯一的破坏性操作，是这一条实际适用的地方（§9.1 的 .jy-text-button 本身只是 --jy-accent）。
test('the "删除多余正则" button is a red text button at the end of its own group, per DESIGN.md §9.1/§15.4', () => {
  const entry = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  const group = entry.match(/<div class="jy-form-section"><span class="jy-label">绑定正则[\s\S]*?<\/details>/)?.[0];
  assert.ok(group, '找到「绑定正则」这一组的标记');
  const button = group.match(/<button[^>]*data-jy-action="dedupe-processing-regex"[^>]*>删除多余正则<\/button>/)?.[0];
  assert.ok(button, '找到「删除多余正则」按钮本身');
  assert.match(button, /class="jy-text-button jy-text-button-danger"/, '无边框的文字按钮，字色走危险色');
  // 组内唯一另一个按钮是「导入正则」；危险操作要排在它之后，也排在正则列表和状态行之后（组的末尾）。
  assert.ok(group.indexOf('导入正则') < group.indexOf('删除多余正则'), '排在「导入正则」之后');
  assert.ok(group.indexOf('data-jy-processing-regex-list') < group.indexOf('删除多余正则'), '排在正则列表之后');
  assert.ok(group.indexOf('data-jy-native-regex-status') < group.indexOf('删除多余正则'), '排在状态行之后，即组的末尾');

  const hostCss = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const rule = hostCss.match(/\.jy-text-button-danger\s*\{[^}]*\}/)?.[0];
  assert.ok(rule, '.jy-text-button-danger 的样式规则存在');
  assert.match(rule, /color:\s*var\(--jy-error\)/, '危险文字按钮的字色是 --jy-error（DESIGN.md §9.1）');
});

test('manifest files, lifecycle exports, and capability snapshot are self-consistent', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const entryPath = manifest.js.split('?')[0];
  const stylePath = manifest.css.split('?')[0];
  const entry = fs.readFileSync(path.join(root, entryPath), 'utf8');
  for (const relative of [entryPath, stylePath]) {
    assert.equal(fs.existsSync(path.join(root, relative)), true, `${relative} must exist`);
  }
  for (const exported of Object.values(manifest.hooks)) {
    assert.match(entry, new RegExp(`export\\s+(?:async\\s+)?function\\s+${exported}\\b`));
  }

  const contract = JSON.parse(fs.readFileSync(path.join(root, 'capability-contract.json'), 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'validation', 'sillytavern-1.18.0.snapshot.json'), 'utf8'));
  assert.equal(contract.minimum.sillytavern, null);
  assert.equal(typeof snapshot.versions.sillytavern, 'string');
  for (const requirement of contract.requirements.filter(item => item.required)) {
    assert.ok(snapshot.symbols.includes(requirement.symbol), `${requirement.symbol} must be observed`);
  }
});

test('replace-tag regions swap translations in and keep originals recoverable', () => {
  const segmented = segmentSource('雨が降っている。\n\n少女は笑った。');
  const map = new Map([[1, '下雨了。'], [2, '少女笑了。']]);
  const swapped = assembleReplace(segmented.layout, map);
  assert.equal(stripGeneratedTranslationLines(swapped, undefined, 'prompt'), '下雨了。\n\n少女笑了。');
  assert.equal(stripGeneratedTranslationLines(swapped, undefined, 'source'), '雨が降っている。\n\n少女は笑った。');
  assert.equal(extractReplaceTranslations(swapped).get(1), '下雨了。');
  assert.equal(extractReplaceTranslations(swapped).get(2), '少女笑了。');
  // A pair next to a bilingual block must never be confused with one.
  const mixed = `${assembleBilingual(segmented.layout, map)}${assembleReplace(segmented.layout, map)}`;
  assert.ok(stripGeneratedTranslationLines(mixed, undefined, 'prompt').includes('下雨了。'));
  const partial = assembleReplace(segmented.layout, new Map([[1, '下雨了。']]), { allowMissing: true });
  assert.ok(partial.includes('少女は笑った。'), '缺译的替换段保持原文原样');
});

test('token-saving channels carry the switch, a reasoning effort and a per-character whitelist', () => {
  const settings = mergeSettings({
    channels: [{
      id: 'c1', url: 'https://example.com/v1', key: 'k', model: 'm',
      maxTokens: 65535, tokenSaving: true, reasoningEffort: 'high',
    }],
    selectedChannelId: 'c1',
    worldInfoWhitelist: {
      'avatar.png': [{ world: '设定集', uid: 3 }, { world: '', uid: 9 }, 'junk'],
    },
  });
  const channel = getActiveChannel(settings);
  assert.equal(channel.tokenSaving, true);
  assert.equal(channel.reasoningEffort, 'high');
  assert.deepEqual(settings.worldInfoWhitelist['avatar.png'], [{ world: '设定集', uid: 3 }]);
  const payload = createIndependentRequest(settings, [{ role: 'user', content: '雨。' }]);
  assert.equal(payload.reasoning_effort, 'high');
  assert.equal(payload.stream, false);
  const withoutEffort = createIndependentRequest({
    apiUrl: 'https://example.com', apiModel: 'translator',
  }, [{ role: 'user', content: '雨。' }]);
  assert.equal('reasoning_effort' in withoutEffort, false);
  const excluded = createIndependentRequest({
    apiUrl: 'https://example.com', apiModel: 'translator', reasoningEffort: 'low',
    excludeParams: ['reasoning_effort'],
  }, [{ role: 'user', content: '雨。' }]);
  assert.equal('reasoning_effort' in excluded, false);
});

test('request tokens are estimated from CJK and non-CJK characters separately', () => {
  const cjk = estimateRequestTokens([{ role: 'user', content: 'あ'.repeat(1000) }]);
  assert.ok(cjk >= 1000 && cjk <= 1100, `纯假名估算应在每字一 token 附近：${cjk}`);
  const latin = estimateRequestTokens([{ role: 'user', content: 'a'.repeat(400) }]);
  assert.ok(latin >= 90 && latin <= 120, `纯拉丁估算应接近四字符一 token：${latin}`);
});

// --- v0.13.4 regressions: the four field reports and the review findings they map to. ---

test('a replace-tag paragraph keeps what is not for translation where the reader and the main model see it', () => {
  const options = { excludedTags: ['image'], preserveLineRules: '' };
  const original = 'Line one.\n<image>a cat</image>\nLine two <image>x</image> end.';
  const { layout } = segmentSource(original, options);
  const floor = assembleReplace(layout, new Map([[1, '第一行。'], [2, '第二行。']]), options);
  const prompt = stripGeneratedTranslationLines(floor, null, 'prompt');
  assert.equal(prompt, '第一行。\n<image>a cat</image>\n第二行。<image>x</image>', 'the picture on its own line and the one inside a line both stay');
  assert.equal(stripGeneratedTranslationLines(floor), original, 'the original comes back whole, nothing twice');
  assert.deepEqual([...extractReplaceTranslations(floor, options)], [[1, '第一行。'], [2, '第二行。']], '补译 reads the translations alone');
  const partial = assembleReplace(layout, new Map([[1, '第一行。']]), { ...options, allowMissing: true });
  assert.deepEqual([...extractReplaceTranslations(partial, options)], [[1, '第一行。']], 'a line not translated yet reads as missing');
  assert.match(stripGeneratedTranslationLines(partial, null, 'prompt'), /<image>a cat<\/image>/);
  // A picture prompt that runs over several lines is one line of the paragraph, not several.
  const long = 'The lamp was low.\n<image>image###[Mage].\nA woman smiles.###</image>\nShe touched its nose <image>x</image> and smiled.';
  const longFloor = assembleReplace(segmentSource(long, options).layout, new Map([[1, '灯光很暗。'], [2, '她摸了摸鼻子，笑了。']]), options);
  assert.deepEqual([...extractReplaceTranslations(longFloor, options)], [[1, '灯光很暗。'], [2, '她摸了摸鼻子，笑了。']]);
  assert.equal(stripGeneratedTranslationLines(longFloor), long);
});

test('a restyle leaves a replace pair as it is and restyles the bilingual blocks around it', () => {
  const pair = renderReplacePair('"你好"她说。', '"Hi," she said.', { stylePrefix: '<span class="jy-spk" style="color:red">', styleSuffix: '</span>' });
  const bilingual = `${renderSourceBlock('Rain.', { segmentPrefix: '<jy-source>', segmentSuffix: '</jy-source>' })}\n${renderTranslationBlock('下雨了。', { translationPrefix: '{', translationSuffix: '}' })}`;
  const floor = `${pair}\n\n${bilingual}`;
  const restyled = restyleBilingual(floor, { segmentPrefix: '<p>', segmentSuffix: '</p>', translationPrefix: '[', translationSuffix: ']' });
  assert.ok(restyled.startsWith(pair), 'the pair is untouched: colours kept, no source prefixes put on the translation');
  assert.match(restyled, /<p>/);
  assert.match(restyled, /\[/);
});

test('a partly translated replace-tag floor seeds 补译 by hidden original, not by position', () => {
  const options = { segmentPrefix: '', segmentSuffix: '', translationPrefix: '', translationSuffix: '' };
  const layout = segmentSource('第一段。\n\n第二段。\n\n第三段。', options).layout;
  const partial = new Map([[2, 'Second.'], [3, 'Third.']]);
  const floor = assembleReplace(layout, partial, { ...options, allowMissing: true });
  // The untranslated first paragraph used to consume the second paragraph's pair, which then
  // overwrote 第一段 with Second. on the next run and left 第三段 unseeded.
  assert.deepEqual([...extractReplaceTranslations(floor, options)], [[2, 'Second.'], [3, 'Third.']]);
  const complete = assembleReplace(layout, new Map([[1, 'First.'], ...partial]), options);
  assert.deepEqual([...extractReplaceTranslations(complete, options)], [[1, 'First.'], [2, 'Second.'], [3, 'Third.']]);
});

test('a tag affix that lost its invisible boundaries is repaired instead of nested twice', () => {
  const style = {
    segmentPrefix: '<jy-source>', segmentSuffix: '</jy-source>',
    translationPrefix: '<jy-translation>', translationSuffix: '</jy-translation>',
  };
  const metadata = {
    schema_version: 4,
    segment_prefix: style.segmentPrefix, segment_suffix: style.segmentSuffix,
    translation_prefix: style.translationPrefix, translation_suffix: style.translationSuffix,
  };
  const source = '雨が降っている。\n\n彼は黙って歩いた。';
  const layout = segmentSource(source, style).layout;
  const floor = assembleBilingual(layout, new Map([[1, '下雨了。'], [2, '他默默地走着。']]), style);
  const damaged = floor.split(AFFIX_START).join('').split(AFFIX_END).join('');
  assert.equal(stripGeneratedTranslationLines(damaged, metadata), source);
  const rewritten = assembleBilingual(
    segmentSource(stripGeneratedTranslationLines(damaged, metadata), style).layout,
    new Map([[1, '下雨了。'], [2, '他默默地走着。']]),
    style,
  );
  assert.equal(rewritten, floor);
  // No second opener before the matching close, i.e. no nested copy of the affix.
  assert.doesNotMatch(rewritten, /<jy-source>(?:(?!<\/jy-source>)[\s\S])*<jy-source>/);
  // The detector runs on the repaired text, so a wrapper this pass already healed is not reported.
  assert.equal(detectUnmarkedAffixes(stripGeneratedTranslationLines(damaged, metadata), metadata), false);
});

test('symbol affixes stay untouched because a scene may legitimately open and close with them', () => {
  const style = { segmentPrefix: '☆{', segmentSuffix: '}', translationPrefix: '{', translationSuffix: '}' };
  const metadata = { schema_version: 4, segment_prefix: '☆{', segment_suffix: '}', translation_prefix: '{', translation_suffix: '}' };
  const source = '☆{原文自带}';
  const floor = assembleBilingual(segmentSource(source, style).layout, new Map([[1, '译文。']]), style);
  assert.equal(stripGeneratedTranslationLines(floor, metadata), source);
  assert.equal(detectUnmarkedAffixes(floor, metadata), false);
});

test('a floor whose mirror boundaries are gone entirely is reported rather than silently re-wrapped', () => {
  const style = {
    segmentPrefix: '<jy-source>', segmentSuffix: '</jy-source>',
    translationPrefix: '<jy-translation>', translationSuffix: '</jy-translation>',
  };
  const metadata = {
    schema_version: 4,
    segment_prefix: style.segmentPrefix, segment_suffix: style.segmentSuffix,
    translation_prefix: style.translationPrefix, translation_suffix: style.translationSuffix,
  };
  const floor = assembleBilingual(segmentSource('雨が降っている。', style).layout, new Map([[1, '下雨了。']]), style);
  const flattened = [AFFIX_START, AFFIX_END, SOURCE_START, SOURCE_END, TRANSLATION_START, TRANSLATION_END]
    .reduce((text, marker) => text.split(marker).join(''), floor);
  assert.equal(detectUnmarkedAffixes(flattened, metadata), true);
});

test('每行单独成段 survives a restyle without moving the closing affix onto its own line', () => {
  const style = { paragraphPerLine: true, translationPrefix: '{', translationSuffix: '}' };
  const layout = segmentSource('第一行。\n第二行。\n第三行。', style).layout;
  const floor = assembleBilingual(layout, new Map([[1, 'One.'], [2, 'Two.'], [3, 'Three.']]), style);
  assert.equal(restyleBilingual(floor, style, { schema_version: 4 }), floor);
  assert.equal(stripGeneratedTranslationLines(floor), '第一行。\n第二行。\n第三行。');
});

test('every layout shape round-trips back to the exact original, fully or partly translated', () => {
  const pieces = ['台词一。', '「引用行」', '', '   ', '---', '<i>斜体</i>', '</status>', '★', '　', '第二句。', '<br>'];
  let seed = 20260911;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (const paragraphPerLine of [false, true]) {
    for (const allowMissing of [false, true]) {
      const options = { paragraphPerLine, allowMissing, translationPrefix: '{', translationSuffix: '}' };
      for (let round = 0; round < 500; round += 1) {
        const source = Array.from({ length: 1 + Math.floor(random() * 6) },
          () => pieces[Math.floor(random() * pieces.length)]).join(random() > 0.5 ? '\n' : '\n\n');
        const segmented = segmentSource(source, options);
        if (!segmented.segments.length) continue;
        const translations = new Map(segmented.segments
          .filter(() => !allowMissing || random() > 0.4)
          .map(segment => [segment.id, `T${segment.id}`]));
        if (!allowMissing && !translations.size) continue;
        const floor = assembleBilingual(segmented.layout, translations, options);
        assert.equal(stripGeneratedTranslationLines(floor), source, JSON.stringify({ source, paragraphPerLine, allowMissing }));
      }
    }
  }
});

test('usage counters survive log redaction while real credentials do not', () => {
  const entry = sanitizeDiagnostic({
    requestTokens: { promptTokens: 1234, basis: 'usage' },
    maxTokens: 60000,
    tokenSaving: true,
    token: 'secret-value',
    access_token: 'secret-value',
    apiKey: 'secret-value',
    proxy_password: 'secret-value',
  });
  assert.equal(entry.requestTokens.promptTokens, 1234);
  assert.equal(entry.requestTokens.basis, 'usage');
  assert.equal(entry.maxTokens, 60000);
  assert.equal(entry.tokenSaving, true);
  assert.equal(entry.token, '[已隐藏]');
  assert.equal(entry.access_token, '[已隐藏]');
  assert.equal(entry.apiKey, '[已隐藏]');
  assert.equal(entry.proxy_password, '[已隐藏]');
});

test('the tag inspector reports replace tags and catches a nesting the run would only hit later', () => {
  const floor = '<story_scene>\n叙事一行。\n<status>HP 100</status>\n</story_scene>';
  const nested = inspectTagConfiguration(floor, ['story_scene'], [], { replaceTags: ['status'] });
  assert.deepEqual(nested.replaceTags, [{ tag: 'status', count: 1 }]);
  assert.ok(nested.errors.some(error => /交叉重叠|嵌套/.test(error)), nested.errors.join(' | '));

  const sibling = '<story_scene>\n叙事一行。\n</story_scene>\n<status>HP 100</status>';
  const flat = inspectTagConfiguration(sibling, ['story_scene'], [], { replaceTags: ['status'] });
  assert.deepEqual(flat.errors, []);
  assert.equal(flat.translationUnits, 2);
});

test('speaker and emotion labels ride alongside the translation without touching it', () => {
  const raw = JSON.stringify({ translations: [
    { id: 1, text: '「你到底在想什么！」', speaker: '英梨梨', emotion: 'angry', intensity: 2 },
    { id: 2, text: '……我不知道。', who: '加藤', mood: 'hesitant' },
    { id: 3, text: '窗外还在下雨。' },
    {
      id: 4, text: '「你来了？」泰罗抬起头，「坐吧。」', speaker: '泰罗', emotion: 'surprised', tone: 'in a hurry tone',
      quotes: [{ head: '你来了', speaker: '樱井', emotion: 'surprised', intensity: 2 }, { head: '坐吧', speaker: '泰罗', emotion: 'calm', tone: '可选' }, 'junk', { head: '无标注' }],
    },
  ] });
  const recovered = recoverStructuredTranslations(raw, [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
  assert.deepEqual([...recovered.translations.values()], ['「你到底在想什么！」', '……我不知道。', '窗外还在下雨。', '「你来了？」泰罗抬起头，「坐吧。」']);
  assert.deepEqual(recovered.annotations.get(1), { speaker: '英梨梨', emotion: 'angry', intensity: 2 });
  assert.deepEqual(recovered.annotations.get(2), { speaker: '加藤', emotion: 'hesitant' });
  assert.equal(recovered.annotations.has(3), false, '没有标注的段落不该凭空得到一条');
  // The reading's marks: a tone, and one mark per quoted run; whatever is not a mark is dropped, and
  // so is a stand-in the request's example showed (可选) and the model copied back.
  assert.deepEqual(recovered.annotations.get(4), {
    speaker: '泰罗', emotion: 'surprised', tone: 'in a hurry tone',
    quotes: [{ head: '你来了', speaker: '樱井', emotion: 'surprised', intensity: 2 }, { head: '坐吧', speaker: '泰罗', emotion: 'calm' }],
  });
  // A run's own mark parses as a fragment of its own; it is no translation and is not reported as one.
  assert.equal(recovered.warnings.some(warning => warning.includes('为空')), false);
  assert.equal(recovered.response.annotatedItems, 3);
  // A model that answers with nothing but text still parses; annotation is strictly optional.
  const plain = recoverStructuredTranslations(JSON.stringify([{ id: 1, text: '只有译文。' }]), [{ id: 1 }]);
  assert.equal(plain.annotations.size, 0);
  assert.equal(plain.translations.get(1), '只有译文。');
});

test('a coloured floor still hands the main model nothing but the original', () => {
  const source = '「你到底在想什么！」\n\n……我不知道。';
  const styleFor = ids => ({ open: `<span class="jy-spk jy-spk-${ids[0]}" style="color:#e2a148">`, close: '</span>' });
  const options = { translationPrefix: '{', translationSuffix: '}', styleFor };
  const floor = assembleBilingual(
    segmentSource(source, options).layout,
    new Map([[1, '「你到底在想什么！」'], [2, '……我不知道。']]),
    options,
  );
  assert.match(floor, /<span class="jy-spk/);
  assert.equal(stripGeneratedTranslationLines(floor), source, '剥离后必须逐字还原原文');
  assert.equal(stripGeneratedTranslationLines(floor, undefined, 'prompt'), source);
  const prompt = [{ mes: floor }];
  interceptGenerationChat(prompt);
  assert.doesNotMatch(prompt[0].mes, /span|jy-spk|color/);

  // Replace-tag regions put the translation where the main model reads it, so the wrapper has to be
  // marked there too, or the markup itself would leak into the prompt.
  const replaced = assembleReplace(segmentSource(source, options).layout, new Map([[1, '译一'], [2, '译二']]), options);
  assert.match(replaced, /<span class="jy-spk/);
  assert.doesNotMatch(stripGeneratedTranslationLines(replaced, undefined, 'prompt'), /span|jy-spk/);
  assert.equal(stripGeneratedTranslationLines(replaced), source);
  assert.deepEqual([...extractReplaceTranslations(replaced, options).values()], ['译一', '译二']);
});

test('changing the visible affixes keeps a floor and its speaker colours intact', () => {
  const styleFor = () => ({ open: '<span class="jy-spk jy-spk-abc" style="color:#84adff">', close: '</span>' });
  const options = { translationPrefix: '{', translationSuffix: '}', styleFor };
  const floor = assembleBilingual(segmentSource('原文一行。', options).layout, new Map([[1, '译文一行。']]), options);
  const restyled = restyleBilingual(floor, { translationPrefix: '【', translationSuffix: '】' }, { schema_version: 4 });
  assert.match(restyled, /<span class="jy-spk jy-spk-abc" style="color:#84adff">/);
  assert.match(restyled, /【/);
  assert.equal(stripGeneratedTranslationLines(restyled), '原文一行。');
  assert.equal(restyleBilingual(restyled, { translationPrefix: '【', translationSuffix: '】' }, { schema_version: 4 }), restyled);
});

test('a painted source line comes back painted instead of losing its colour in translation', () => {
  const source = [
    '<span style="color:#e79">「私、一人じゃたぶん、わかんないし。」</span>',
    '彼女は俯いた。',
    '<font color="#8cf"><b>「……吐きそうになるから」</b></font>',
  ].join('\n');
  const translations = new Map([[1, '「我一个人大概搞不懂。」'], [2, '她低下了头。'], [3, '「……就会想吐。」']]);
  const options = { translationPrefix: '', translationSuffix: '' };
  const floor = assembleBilingual(segmentSource(source, options).layout, translations, options);
  const visible = floor.replace(/[​‌‍﻿⁠-⁤]/g, '');
  // Each line keeps its own wrapper: only the dialogue was painted, so only the dialogue comes back
  // painted, and the narration between them stays plain.
  assert.match(visible, /<span style="color:#e79">「我一个人大概搞不懂。」<\/span>/);
  assert.match(visible, /<font color="#8cf"><b>「……就会想吐。」<\/b><\/font>/);
  assert.match(visible, /\n她低下了头。/);
  assert.doesNotMatch(visible, /<span[^>]*>她低下了头/);
  // The invariant is untouched: the main model still sees exactly the original.
  assert.equal(stripGeneratedTranslationLines(floor), source);
  assert.equal(stripGeneratedTranslationLines(floor, undefined, 'prompt'), source);
  // And 补译 still reads plain translations back out, markup and all stripped.
  assert.deepEqual([...extractGeneratedTranslations(floor, options).values()], [...translations.values()]);

  const off = assembleBilingual(segmentSource(source, options).layout, translations, { ...options, carryFormatting: false });
  assert.doesNotMatch(off.replace(/[​‌‍﻿⁠-⁤]/g, ''), /<span style="color:#e79">「我一个人/);
  assert.equal(stripGeneratedTranslationLines(off), source);
});

test('only a real whole-line wrapper is carried, and only its presentation attributes', () => {
  assert.equal(lineFormatting('普通一行'), null);
  assert.equal(lineFormatting('<br>'), null);
  // Two siblings have no single wrapper to speak of.
  assert.equal(lineFormatting('<span style="color:#f00">甲</span><span style="color:#0f0">乙</span>'), null);
  // Block tags would change the layout, and an anchor would invent a link.
  assert.equal(lineFormatting('<div style="color:#f00">整段</div>'), null);
  assert.equal(lineFormatting('<a href="http://example.com">链接</a>'), null);
  // A wrapper with nothing inside has nothing to carry.
  assert.equal(lineFormatting('<span style="color:#f00"></span>'), null);
  assert.deepEqual(lineFormatting('<i>斜体<b>加粗</b>还有</i>'), { open: '<i>', close: '</i>' });
  assert.deepEqual(lineFormatting('<font color="#8cf"><b>台词</b></font>'), { open: '<font color="#8cf"><b>', close: '</b></font>' });
  // Behaviour and identity never travel; only how the line looks.
  assert.deepEqual(
    lineFormatting('<span onclick="evil()" id="x" data-y="1" style="color:#f0a">台词</span>'),
    { open: '<span style="color:#f0a">', close: '</span>' },
  );
  assert.equal(withoutCarriedColor('<span style="color:#f0a;font-weight:700">'), '<span style="font-weight:700">');
  assert.equal(withoutCarriedColor('<font color="#8cf">'), '<font>');
});

test('formatting is found past a line-level <say> shell and the story quotes wrapping the whole line', () => {
  // The preset's own standard write-up: a speaker mark, then the whole line's quotes, then the tags.
  assert.deepEqual(
    lineFormatting('<say who="樱井" mood="开心">「<big><b>好的呀</b></big>」</say>'),
    { open: '<big><b>', close: '</b></big>' },
    'neither the <say> shell nor the quotes it wraps are part of what carries',
  );
  // The tags may wrap the quotes themselves instead of sitting inside them.
  assert.deepEqual(
    lineFormatting('<say who="樱井"><big>「加粗呀」</big></say>'),
    { open: '<big>', close: '</big>' },
  );
  // A <say> shell with no quotes inside still has its formatting found.
  assert.deepEqual(lineFormatting('<say who="樱井"><i>心里想着</i></say>'), { open: '<i>', close: '</i>' });
  // No <say>, no quotes: behaves exactly as it always has.
  assert.deepEqual(lineFormatting('<i>斜体</i>'), { open: '<i>', close: '</i>' });
  // A self-closing mark is not a shell; it names the run after it rather than enclosing one.
  assert.equal(lineFormatting('<say 樱井/><big>没有外壳</big>'), null);
  // Two speakers on one line: no single wrapper for the <say> shell to reveal.
  assert.equal(lineFormatting('<say who="A">「甲」</say><say who="B">「乙」</say>'), null);
});

test('formatting past a <say> shell is found through indentation and stray whitespace, not just a bare shell', () => {
  const fullWidthSpace = String.fromCharCode(0x3000).repeat(2);
  // An indented, speaker-marked line: the preset's own leading whitespace must not stop the shell from
  // being found, the same way it already does not stop a bare wrapper like <b> from being found.
  assert.deepEqual(
    lineFormatting(`${fullWidthSpace}<say who="A">「<big><b>好。</b></big>」</say>`),
    { open: '<big><b>', close: '</b></big>' },
  );
  assert.deepEqual(lineFormatting(`${fullWidthSpace}<b>「好。」</b>`), { open: '<b>', close: '</b>' }, 'the case this already handled keeps working');
  // Trailing whitespace after </say>.
  assert.deepEqual(
    lineFormatting('<say who="A">「<big><b>好。</b></big>」</say> '),
    { open: '<big><b>', close: '</b></big>' },
  );
  // Whitespace just inside the <say> shell, around the quotes themselves.
  assert.deepEqual(
    lineFormatting('<say who="A"> 「<b>好。</b>」 </say>'),
    { open: '<b>', close: '</b>' },
  );
});

test('speaker colouring wins the colour but the carried weight and slant still apply', () => {
  const source = '<b style="color:#e79">「台词」</b>';
  const options = {
    translationPrefix: '',
    translationSuffix: '',
    styleFor: () => ({ open: '<span class="jy-spk" style="color:#cbaa40 !important">', close: '</span>', paintsColor: true }),
  };
  const floor = assembleBilingual(segmentSource(source, options).layout, new Map([[1, '「译文」']]), options);
  const visible = floor.replace(/[​‌‍﻿⁠-⁤]/g, '');
  assert.match(visible, /<span class="jy-spk" style="color:#cbaa40 !important"><b>「译文」<\/b><\/span>/);
  assert.doesNotMatch(visible, /<b style="color:#e79">「译文」/);
  assert.equal(stripGeneratedTranslationLines(floor), source);
});

test('the model\'s thinking is found wherever a provider decided to put it', () => {
  assert.equal(extractReasoningText({ choices: [{ delta: { reasoning_content: '先看这一批要译几段。' } }] }), '先看这一批要译几段。');
  assert.equal(extractReasoningText({ choices: [{ message: { reasoning: '专名没有冲突。' } }] }), '专名没有冲突。');
  assert.equal(extractReasoningText({ content: '译文', reasoning: '思考' }), '思考');
  assert.equal(extractReasoningText({ thinking: '另一种拼法' }), '另一种拼法');
  // Nothing to report is the common case and must not be confused with an answer.
  assert.equal(extractReasoningText({ choices: [{ message: { content: '只有译文' } }] }), '');
  assert.equal(extractReasoningText('纯字符串返回'), '');
  assert.equal(extractReasoningText(null), '');
  assert.equal(extractReasoningText({ reasoning: '   ' }), '', '空白不算思考');
  // A response that points at itself must not hang the walk.
  const loop = { choices: [] };
  loop.choices.push({ message: loop });
  assert.equal(extractReasoningText(loop), '');
});

test('carried formatting reaches replace-tag regions and stays out of the prompt', () => {
  const source = '<span style="color:#e79">「台词一」</span>\n\n<b>「台词二」</b>';
  const options = { translationPrefix: '', translationSuffix: '' };
  const floor = assembleReplace(segmentSource(source, options).layout, new Map([[1, '「译一」'], [2, '「译二」']]), options);
  const visible = floor.replace(/[​‌‍﻿⁠-⁤]/g, '');
  assert.match(visible, /<span style="color:#e79">「译一」<\/span>/);
  assert.match(visible, /<b>「译二」<\/b>/);
  // Replace regions are what the main model reads, so the carried markup has to vanish there.
  assert.doesNotMatch(stripGeneratedTranslationLines(floor, undefined, 'prompt'), /<span|<b>/);
  assert.equal(stripGeneratedTranslationLines(floor), source);
  assert.deepEqual([...extractReplaceTranslations(floor, options).values()], ['「译一」', '「译二」']);
});

test('carrying formatting is on by default and survives a settings round-trip', () => {
  assert.equal(DEFAULT_SETTINGS.carryFormatting, true);
  assert.equal(mergeSettings({}).carryFormatting, true);
  assert.equal(mergeSettings({ carryFormatting: false }).carryFormatting, false);
  // An older saved settings object has no such key and must not lose the fix by omission.
  assert.equal(mergeSettings({ schemaVersion: 11 }).carryFormatting, true);
});

test('speech is separated from the narration wrapped around it', () => {
  // The reported line: narration with one quoted clause inside it. Speaker colour has to stop at
  // the quote marks, or the narrator ends up wearing whoever was quoted.
  const mixed = splitSpeechParts('「啊，这样。」律嘟囔了一句，没等说明念完就挂了电话。');
  assert.deepEqual(mixed.map(part => part.spoken), [true, false]);
  assert.equal(mixed[0].text, '「啊，这样。」');
  assert.equal(describeSpeechShape(['「啊，这样。」律嘟囔了一句，没等说明念完就挂了电话。']), 'mixed');

  // Nested quotes belong to the outer run: 『』 inside 「」 is still one person speaking.
  const nested = splitSpeechParts('「他说『随便』，然后就走了」');
  assert.equal(nested.length, 1);
  assert.equal(nested[0].spoken, true);

  // An unterminated quote is narration, not a guess: painting a run that never closed would spill
  // the colour over everything after it.
  const dangling = splitSpeechParts('「说到一半就断了');
  assert.deepEqual(dangling.map(part => part.spoken), [false]);
  assert.equal(describeSpeechShape(['「说到一半就断了']), 'narration');

  // Whitespace and stray punctuation around a quoted line do not make it a mixed line.
  assert.equal(describeSpeechShape(['　「我知道了。」 ']), 'spoken');
  assert.equal(describeSpeechShape(['“Fine,” ']), 'spoken');
  assert.equal(describeSpeechShape(['雨下得很大。']), 'narration');
  // A unit is judged whole: one spoken line beside one narrated line is a mixed unit.
  assert.equal(describeSpeechShape(['「走吧。」', '她站了起来。']), 'mixed');
});

test('a run styled across a quotation mark keeps both marks out of the spans', () => {
  // The rhythm splits on punctuation, so it cuts straight through a quoted line. Both marks have to
  // come back out, or SillyTavern's dialogue tag opens in one span and closes in the next.
  const cut = liftSplitQuotes([
    { text: '「副院长已经去叫了！', css: 'font-size:1.06em' },
    { text: '他现在正从家里开车赶过来，', css: 'font-size:0.985em' },
    { text: '再过十五分钟就——」', css: 'font-size:0.955em' },
  ]);
  assert.deepEqual(cut.map(piece => piece.text), [
    '「', '副院长已经去叫了！', '他现在正从家里开车赶过来，', '再过十五分钟就——', '」',
  ]);
  assert.equal(cut[0].css, undefined);
  assert.equal(cut.at(-1).css, undefined);
  assert.equal(cut[1].css, 'font-size:1.06em');

  // A quoted run that already fits inside one piece keeps its marks styled with it, so a run painted
  // in the speaker's colour does not lose its quotes to the narration colour.
  const whole = [{ text: '「啊，这样。」', css: 'color:#ff00aa' }, { text: '律嘟囔了一句。' }];
  assert.equal(liftSplitQuotes(whole), whole);

  // An unterminated mark has no partner to be split from, so it stays where it is.
  const dangling = [{ text: '「说到一半', css: 'font-size:1.1em' }, { text: '就断了', css: '' }];
  assert.equal(liftSplitQuotes(dangling), dangling);

  // Nested marks are judged by their own pair: the inner 『』 sits whole in one piece and stays.
  const nested = liftSplitQuotes([
    { text: '「他说『随便』，', css: 'font-size:1.05em' },
    { text: '然后就走了」', css: 'font-size:0.95em' },
  ]);
  assert.deepEqual(nested.map(piece => piece.text), ['「', '他说『随便』，', '然后就走了', '」']);
});

test('speaker names a model spells differently resolve to the one the palette knows', async () => {
  const { unifySpeakerNames } = await import('../core.js');
  const known = ['艾莉丝', '希尔达', '源律', '菲利普·伯雷亚斯·格雷拉特', '洛琪希'];
  const mapped = unifySpeakerNames(
    ['艾莉丝·伯雷亚斯·格雷拉特', '希尔达夫人', '律', '菲利普', '洛琪希', '保罗'],
    known,
  );
  assert.equal(mapped.get('艾莉丝·伯雷亚斯·格雷拉特'), '艾莉丝');
  assert.equal(mapped.get('希尔达夫人'), '希尔达');
  assert.equal(mapped.get('律'), '源律');
  assert.equal(mapped.get('菲利普'), '菲利普·伯雷亚斯·格雷拉特');
  assert.equal(mapped.get('洛琪希'), '洛琪希');
  // Nobody by that name: left exactly as written.
  assert.equal(mapped.get('保罗'), '保罗');

  // A shared family name matches several people and so matches nobody.
  assert.equal(unifySpeakerNames(['伯雷亚斯'], ['菲利普·伯雷亚斯', '希尔达·伯雷亚斯']).get('伯雷亚斯'), '伯雷亚斯');
  // A longer unknown name that ends in a registered one is not assumed to be that person.
  assert.equal(unifySpeakerNames(['千惠'], ['惠']).get('千惠'), '千惠');
  // A title is only ever stripped to find someone already known.
  assert.equal(unifySpeakerNames(['夏君'], []).get('夏君'), '夏君');

  // With no roster, names reported side by side are unified with each other and the shorter form wins.
  const floor = unifySpeakerNames(['艾莉丝·伯雷亚斯·格雷拉特', '艾莉丝', '艾莉丝酱', '罗罗'], []);
  assert.equal(floor.get('艾莉丝·伯雷亚斯·格雷拉特'), '艾莉丝');
  assert.equal(floor.get('艾莉丝酱'), '艾莉丝');
  assert.equal(floor.get('罗罗'), '罗罗');
});

test('a line handed back in the source language is recognised as untranslated', async () => {
  const { looksUntranslated } = await import('../core.js');
  // Ordinary Chinese, including cries and a name written with a middle dot.
  assert.equal(looksUntranslated('「……唔……呜，啊……」'), false);
  assert.equal(looksUntranslated('哇啊啊啊——！'), false);
  assert.equal(looksUntranslated('艾莉丝·伯雷亚斯把脸埋进我的颈窝。'), false);
  // A name left in katakana inside an otherwise translated line is not a failed line.
  assert.equal(looksUntranslated('我抬头看向ロロ，他正在笑。'), false);
  // Echoed back untouched.
  assert.equal(looksUntranslated('雨が降っている。', '雨が降っている。'), true);
  // Half translated, half left in Japanese.
  assert.equal(looksUntranslated('艾莉丝在毛毯里扑腾，ヒルダ様の腕を押し返した。'), true);
  // Entirely Japanese without being an exact echo.
  assert.equal(looksUntranslated('エリスは泣きながら私の袖を掴んだ。'), true);
});

test('an echo of a source with nothing but a gasp or a stammer in it is not flagged as untranslated', async () => {
  const { looksUntranslated } = await import('../core.js');
  // The four reported lines: quote marks, ellipses and full stops stripped away, each leaves at most
  // two letters and every one of them an interjection kana — there was nothing here to translate.
  assert.equal(looksUntranslated('「……っ」', '「……っ」'), false);
  assert.equal(looksUntranslated('「……え？」', '「……え？」'), false);
  assert.equal(looksUntranslated('「ッ！」', '「ッ！」'), false);
  assert.equal(looksUntranslated('「……うん。」', '「……うん。」'), false);
  // Dropping the untranslatable kana instead of copying it is accepted the same way.
  assert.equal(looksUntranslated('っ', 'あっ'), false);
  // A pure-punctuation source never reaches this at all (segmentSource keeps it out), but a source
  // with a real word beside the gasp still goes back for translation as it always did.
  assert.equal(looksUntranslated('「……っ、待って」', '「……っ、待って」'), true);
  // Three real vowel morae in a row is more than isTrivialInterjectionSource's own one-real-mora
  // ceiling — it is no longer "a gasp or a stammer" — so an echo of it still counts as untranslated.
  assert.equal(looksUntranslated('あああ', 'あああ'), true);
});

test('a gasp built on ー, doubled っ or the は/か consonant rows is recognised the same as a bare vowel, and a real short word is not', async () => {
  const { looksUntranslated } = await import('../core.js');
  // A long-vowel or doubled-stammer gasp: only one real mora once ー, ～/〜, small kana and repeated っ
  // are set aside as filler rather than counted, so these settle in one reply instead of two.
  for (const line of ['あーっ！', 'えーっ！？', 'うーん……', '……っっっ', 'えっっ', 'あ～っ', 'んんっ', 'うぅっ']) {
    assert.equal(looksUntranslated(line, line), false, `${line} is one real mora plus filler, not a word`);
  }
  // The は/か consonant rows are gasps too, not only the five vowels — わ行/さ行 words are not covered
  // by this the way tts.js's own INTERJECTION_CHARS draws the line at は行.
  for (const line of ['はぁ……', 'ひっ', 'くっ', 'きゃっ', 'ふぅ……', 'ヒッ', 'ハァ……']) {
    assert.equal(looksUntranslated(line, line), false, `${line} is a single is-row/ka-row gasp`);
  }
  // Two real morae is always either a real short word or a name once it is not a bare gasp — even
  // when, letter for letter, it is built from the same vowels a gasp is: おい (喂), いえ/いい (不/好),
  // ええ (嗯), あい (愛) and うえ (上) all still need an actual translation, not a shrug.
  for (const line of ['おい！', 'いえ', 'いい', 'ええ', 'あい', 'うえ', 'アイ！', 'イオ']) {
    assert.equal(looksUntranslated(line, line), true, `${line} is a real word or name, not a gasp`);
  }
});

test('a bare mora next to a bare ん needs translation unless the whole shape is a real interjection, a marked moan or a repeated unit', async () => {
  const { looksUntranslated } = await import('../core.js');
  // Letter-for-letter the same shape as うん — one real mora next to a bare ん — but these are short
  // names, not gasps: a model echoing one back untranslated is a real miss, not nothing to say.
  for (const line of ['アン', 'アン！', '「カン。」', 'ケン', 'ラン', 'リン']) {
    assert.equal(looksUntranslated(line, line), true, `${line} is a name, not a gasp — it needs translation`);
  }
  // The real interjections this exact shape is otherwise indistinguishable from still go through on a
  // single sighting, ううん's own two real morae (う, う) included.
  for (const line of ['「……うん。」', 'ううん', 'ウン', 'ふん']) {
    assert.equal(looksUntranslated(line, line), false, `${line} is a real interjection, not a name`);
  }
  // A moan carrying its own extra marker — a stammer, a heart, a drawn-out vowel — or built by
  // repeating the same mora-plus-ん unit is still accepted, even with two real morae in it.
  for (const line of ['あんっ', 'あーん', 'あんあん', 'アンッ♡']) {
    assert.equal(looksUntranslated(line, line), false, `${line} is a marked or repeated moan, not a name`);
  }
});

test('isShortExactEcho tells a short unchanged answer apart from a long one', async () => {
  const { isShortExactEcho } = await import('../core.js');
  // A short katakana onomatopoeia, more than the two-letter interjection ceiling but still short
  // enough that a model insisting on it twice is believed rather than asked a third time.
  assert.equal(isShortExactEcho('ドキドキ', 'ドキドキ'), true);
  // Whitespace-only differences still count as the same answer.
  assert.equal(isShortExactEcho(' ドキドキ ', 'ドキドキ'), true);
  // A real sentence echoed back is long enough (over 8 letters once punctuation is stripped) that it
  // stays a genuine failure instead of ever being tolerated twice.
  assert.equal(isShortExactEcho('雨が降っていて、風も強くなってきた。', '雨が降っていて、風も強くなってきた。'), false);
  // Not an echo at all: no exact match, so this is never in play.
  assert.equal(isShortExactEcho('キラキラ', 'ドキドキ'), false);
  assert.equal(isShortExactEcho('下雨了。', '雨が降っている。'), false);
});

test('isShortExactEcho only forgives a second echo that is still plausibly untranslatable, not just short', async () => {
  const { isShortExactEcho } = await import('../core.js');
  // Real greetings, names, ordinary sentences and a Han-bearing exclamation: every one of these is
  // eight letters or fewer, so the old rule accepted an exact echo of any of them on a second sighting.
  // A model that is simply lazy echoes short lines too, and a lazy echo is not "nothing to translate".
  for (const line of ['ごめんなさい', 'バカ！', 'アリス！', '好きだよ', '待ってください', '大丈夫ですか？', 'ウソでしょ？', 'ありがとう', '行くぞ！']) {
    assert.equal(isShortExactEcho(line, line), false, `${line} is a real line, not an echo worth accepting`);
  }
  // Two more sound-symbolic reduplications, matching ドキドキ's own shape.
  assert.equal(isShortExactEcho('ワクワク', 'ワクワク'), true);
  assert.equal(isShortExactEcho('ゴゴゴ', 'ゴゴゴ'), true);
  // Some of what rule 1 already accepts on a single sighting is naturally also accepted here, on a
  // second one — the two rules were never meant to disagree about the same source.
  assert.equal(isShortExactEcho('はぁ……', 'はぁ……'), true);
});

test('isShortExactEcho draws the same name-versus-interjection line as isTrivialInterjectionSource for a bare mora next to a bare ん, even on a second sighting', async () => {
  const { isShortExactEcho } = await import('../core.js');
  for (const line of ['アン', 'ケン', 'カン']) {
    assert.equal(isShortExactEcho(line, line), false, `${line} is a name, not an echo worth accepting`);
  }
  for (const line of ['ウン', 'ふん', 'あんあん', 'アンッ♡']) {
    assert.equal(isShortExactEcho(line, line), true, `${line} is a real interjection or a marked/repeated moan`);
  }
});

test('a two-mora word or name that happens to carry a bare ん still needs translation even when ー, っ or ～ appear elsewhere in it', async () => {
  const { looksUntranslated } = await import('../core.js');
  // Each of these has two real morae plus a bare ん — the same shape ううん and あんあん are forgiven
  // for, but here nothing repeats and none of them is a fixed real interjection, so the moan-marker and
  // reduplication checks must not wave them through just because ー or っ appears somewhere in the word.
  for (const line of ['オーエン', 'オーエン！', 'ハーケン', 'ホーキン', 'コーエン', 'はっけん！', 'けっこん']) {
    assert.equal(looksUntranslated(line, line), true, `${line} is a two-mora ん word, not a gasp — it needs translation`);
  }
});

test('real ん-interjections and moans not on the short allow-list are still accepted, including katakana フン, doubled vowels, and ♥/❤ as moan markers', async () => {
  const { looksUntranslated, isShortExactEcho } = await import('../core.js');
  // Accepted on the first sighting: a fixed real word (フン, ウウン, ふうん) or a moan carrying its own
  // extra marker — a drawn-out vowel spelled with small kana instead of ー, or a heart.
  for (const line of ['フン！', 'ウウン', 'ふうん', 'ふぅん', 'うぅん', 'あぁん……', 'はぁん', 'あん♥', 'あん❤']) {
    assert.equal(looksUntranslated(line, line), false, `${line} is a real interjection or a marked moan, not a name`);
  }
  // ファン/フィン are yōon names built from the same consonant as フ but a different vowel (a/i, not u),
  // so the drawn-out-vowel check must not mistake them for ふぅ-style gasps.
  for (const line of ['ファン', 'フィン']) {
    assert.equal(looksUntranslated(line, line), true, `${line} is a name, not a gasp — it needs translation`);
  }
  // ああん doubles a full-size vowel instead of marking it with ー or a small kana, so it is not caught
  // on the first sighting the way あぁん is — but a model that repeats it verbatim is still believed.
  assert.equal(looksUntranslated('ああん', 'ああん'), true);
  assert.equal(isShortExactEcho('ああん', 'ああん'), true);
});

test('a drawn-out vowel spelled with a full-size vowel kana or a ゃ/ゅ/ょ glide is recognised the same as ー or a small kana, on a second sighting', async () => {
  const { isShortExactEcho } = await import('../core.js');
  // はあ/ひい/へえ/くう double a full-size vowel kana instead of ー or a small one (ぁぃぅぇぉ) — the same
  // gasp, just spelled a third way. Each of these carries two real morae once the vowel counts as one
  // (は+あ, ひ+い, へ+え, く+う), so — same as ううん's own two real morae — the first sighting still asks
  // for a translation; only a second identical echo is believed.
  for (const line of ['はあん', 'はあん……', 'ひいん', 'へえん', 'くうん']) {
    assert.equal(isShortExactEcho(line, line), true, `${line} is a drawn-out vowel gasp spelled with a full-size vowel kana`);
  }
  // ひゃあ/きゅう elongate a ゃ/ゅ/ょ glide's own vowel (a/u/o) rather than a plain mora's.
  for (const line of ['ひゃあん', 'きゃあん', 'きゅうん']) {
    assert.equal(isShortExactEcho(line, line), true, `${line} draws out a glide's own vowel, same as a plain mora's`);
  }
});

test('on a second sighting, a hiragana-only bare ん beside its own real morae with nothing else decorating it is accepted as a moan, never the katakana name shape', async () => {
  const { isShortExactEcho } = await import('../core.js');
  // A single vowel mora, a glide's own mora, or two real morae touching directly, all hiragana and
  // nothing else beside the ん — no marker needed once the model has said it twice.
  for (const line of ['あん！', 'あん……', '「あん……」', 'ん、あん', 'あんん', 'ひゃん！', 'きゃん！', 'うふん', 'あはん', 'はうん']) {
    assert.equal(isShortExactEcho(line, line), true, `${line} is a hiragana moan, accepted on a second identical echo`);
  }
  // The identical letter-for-letter shape, but a single plain は/か行 mora rather than a vowel or a
  // glide, still reads as an ordinary word (けん, かん, はん, こん…) and is never accepted this way.
  for (const line of ['けん', 'かん', 'はん', 'こん']) {
    assert.equal(isShortExactEcho(line, line), false, `${line} is an ordinary word, not a moan, even hiragana and even on a second sighting`);
  }
});

test('a marker beside one bare ん never forgives an unrelated name or word earlier in the same line', async () => {
  const { isShortExactEcho } = await import('../core.js');
  // ええ/ああ/おお/はぁ/あぁ each carry a marker or a doubled vowel of their own, but it sits beside a
  // comma and an entirely different word — a name's own ん, untouched by any of it — so the line as a
  // whole still needs translation, on a second sighting exactly as much as on a first.
  for (const line of ['ええ、ケン', 'ああ、アン！', 'おお、ケン', 'はぁ、ケン', 'あぁ、アン']) {
    assert.equal(isShortExactEcho(line, line), false, `${line} pairs an unrelated marker with a name's own ん — the marker must not reach across the comma`);
  }
  // オーエン/ハーケン/ホーキン/コーエン and けっこん/はっけん！ all carry ー or っ somewhere in them, but never
  // touching their own ん directly (a real mora always sits between the marker and the ん) — the same
  // reason the reviewer's own two-mora-plus-ん test above already covers on the first sighting; here it
  // must hold on the second sighting too.
  for (const line of ['オーエン', 'ハーケン', 'ホーキン', 'コーエン', 'けっこん', 'はっけん！']) {
    assert.equal(isShortExactEcho(line, line), false, `${line} has no marker directly beside its own ん`);
  }
});

test('a moan marker separated from ん only by punctuation or an ellipsis still counts, on a second sighting', async () => {
  const { isShortExactEcho } = await import('../core.js');
  // アッ、ン / ハァ……ン stammer the marker and the ん as two separate beats instead of writing them
  // touching (アンッ, ハァん) — the marker still belongs to the same moan, not to something else.
  for (const line of ['アッ……ン', 'アッ、ン', 'ハァ……ン', 'ハァ、ン', 'アァ……ン', 'ウゥ……ン', 'はぁっ、ん', 'あーっ、ん']) {
    assert.equal(isShortExactEcho(line, line), true, `${line} still has its own marker beside ん, only punctuation sits between them`);
  }
  // アア……ン doubles the same vowel across the gap instead of a っ/ー/♡ marker -- isDrawnOutVowelPair's
  // own shape, reached the same way once the walk skips the ellipsis.
  assert.equal(isShortExactEcho('アア……ン', 'アア……ン'), true);
  // The line from "a marker beside one bare ん never forgives..." above still must not be reached by
  // walking past a real mora: ケン/アン's own consonant sits directly against the ん (across the comma or
  // not), never a marker, so punctuation between an unrelated word and a name's own ん still forgives
  // nothing.
  for (const line of ['ええ、ケン', 'はぁ、ケン', 'あぁ、アン']) {
    assert.equal(isShortExactEcho(line, line), false, `${line}: the letter right beside ん is still a real mora, not a marker`);
  }
});

test('several short moan beats running together with nothing but punctuation, an ellipsis or a heart between them are accepted as one moan, on a second sighting', async () => {
  const { isShortExactEcho } = await import('../core.js');
  // Each beat read on its own is filler-shaped (あっ, はぁ, くっ, ひゃっ…) or the bare-vowel-plus-ん moan
  // shape (あん) -- flattened together without the punctuation, an earlier beat's own real mora would sit
  // directly in front of the later ん and wrongly block it, the same as a real name's own mora would.
  for (const line of [
    'あっ、あん……', 'あっ……あん', 'ひゃっ……あん……', 'はぁ……あん', 'あ、あっ、あん！', 'くっ、あん……',
    'ひっ、あん', 'あっ♡あん', 'あっ、あっ、あん', 'はぁ、はぁ、あん', 'ああっ、あん', 'あん、あっ',
  ]) {
    assert.equal(isShortExactEcho(line, line), true, `${line} is several moan beats, each filler- or moan-shaped on its own`);
  }
  // A short katakana name as one of the beats still fails on its own beat -- being katakana, never a
  // hiragana moan -- so the line as a whole is still not accepted, comma or not.
  for (const line of ['ええ、ケン', 'ケン、あん']) {
    assert.equal(isShortExactEcho(line, line), false, `${line}: ケン is still a name on its own beat, not a moan`);
  }
});

test('a floor that fits one batch is spread evenly across parallel lanes', () => {
  const segments = Array.from({ length: 10 }, (_, index) => ({ id: index + 1, text: 'あ'.repeat(100) }));
  assert.equal(planTranslationBatches(segments, { maxChars: 48000 }).length, 1);
  const lanes = planTranslationBatches(segments, { maxChars: 48000, parallel: 3 });
  assert.deepEqual(lanes.map(batch => batch.length), [3, 3, 4]);
  assert.deepEqual(lanes.flat().map(item => item.id), segments.map(item => item.id));
  // Never more lanes than segments.
  assert.equal(planTranslationBatches(segments.slice(0, 2), { maxChars: 48000, parallel: 4 }).length, 2);
  // A floor that already needs budget-sized batches keeps them.
  assert.equal(planTranslationBatches(segments, { maxChars: 250, parallel: 2 }).length, 5);
});

test('channel concurrency is clamped, a leaning saved as a style moves to its own item, placeholder speakers are dropped', async () => {
  const { normalizeChannel, normalizePromptProfile, recoverStructuredTranslations, MAX_CHANNEL_CONCURRENCY } = await import('../core.js');
  assert.equal(normalizeChannel({}).concurrency, 1);
  assert.equal(normalizeChannel({ concurrency: 3 }).concurrency, 3);
  assert.equal(normalizeChannel({ concurrency: 99 }).concurrency, MAX_CHANNEL_CONCURRENCY);
  assert.equal(normalizeChannel({ concurrency: 0 }).concurrency, 1);
  // v0.16.0 saved a leaning as the style. It moves to its own item rather than being lost.
  const migrated = normalizePromptProfile({ styleMode: 'korean_web' });
  assert.equal(migrated.styleMode, 'light_novel');
  assert.equal(migrated.leaningMode, 'korean_web');
  // Once both are set explicitly, neither overrides the other.
  const both = normalizePromptProfile({ styleMode: 'plain', leaningMode: 'shonen' });
  assert.equal(both.styleMode, 'plain');
  assert.equal(both.leaningMode, 'shonen');
  assert.equal(normalizePromptProfile({}).leaningMode, 'none');
  assert.equal(normalizePromptProfile({ styleMode: 'no_such_style' }).styleMode, 'light_novel');

  const recovered = recoverStructuredTranslations(JSON.stringify({ translations: [
    { id: 1, text: '下雨了。', speaker: '旁白', emotion: 'neutral' },
    { id: 2, text: '「走吧。」', speaker: '洛琪希' },
  ] }), [{ id: 1, text: '雨。' }, { id: 2, text: '「行こう。」' }]);
  assert.equal(recovered.annotations.get(1)?.speaker, undefined);
  assert.equal(recovered.annotations.get(2)?.speaker, '洛琪希');
});

test('a voice id edited in the library moves every binding that pointed at it', async () => {
  const { followVoiceLibrary } = await import('../core.js');
  const before = [{ id: 'lib-a', name: '少女', voiceId: 'voice-a' }, { id: 'lib-b', name: '老人', voiceId: 'voice-b' }];
  const settings = {
    voiceLibrary: [{ id: 'lib-a', name: '少女', voiceId: 'voice-a2' }, { id: 'lib-b', name: '老人', voiceId: 'voice-b' }],
    tts: { narratorVoice: 'voice-a', narratorTitle: 'Fish says A', dialogueVoice: 'voice-b', dialogueTitle: 'Fish says B', narratorVoices: { en: 'voice-a', ja: 'voice-c' } },
    ttsVoices: { 'card.png': [{ name: '樱井', voiceId: 'voice-a', title: 'A', voices: { en: 'voice-a' } }, { name: '泰罗', voiceId: 'voice-b', voices: {} }] },
    theme: 'day',
  };
  const followed = followVoiceLibrary(before, settings);
  assert.equal(followed.tts.narratorVoice, 'voice-a2');
  assert.equal(followed.tts.narratorTitle, '', 'the provider title belonged to the old id');
  assert.equal(followed.tts.dialogueVoice, 'voice-b', 'an entry that did not move moves nothing');
  assert.equal(followed.tts.dialogueTitle, 'Fish says B');
  assert.deepEqual(followed.tts.narratorVoices, { en: 'voice-a2', ja: 'voice-c' });
  assert.deepEqual(followed.ttsVoices['card.png'].map(row => [row.voiceId, row.title, row.voices.en ?? null]), [['voice-a2', '', 'voice-a2'], ['voice-b', undefined, null]]);
  assert.equal(followed.theme, 'day', 'everything else rides along untouched');
  const same = { ...settings, voiceLibrary: before };
  assert.equal(followVoiceLibrary(before, same), same, 'no move, the same object back');
  // A brand-new entry, or one whose id nobody held, changes nothing either.
  const added = followVoiceLibrary(before, { ...settings, voiceLibrary: [...before, { id: 'lib-c', name: '新', voiceId: 'voice-c' }] });
  assert.equal(added.tts.narratorVoice, 'voice-a');
});

test('the colouring leaves a quote set off inside a sentence uncoloured', async () => {
  const { splitSpeechParts, describeSpeechShape, isEmbeddedQuote, foldEmbeddedQuotes } = await import('../core.js');
  const parts = splitSpeechParts('她刺中了那份关于“想要接近”却又“深怕伤害”的纠结，“还是说，你不想？”');
  assert.deepEqual(parts.map(part => [part.spoken, part.text]), [
    [false, '她刺中了那份关于“想要接近”却又“深怕伤害”的纠结，'],
    [true, '“还是说，你不想？”'],
  ]);
  assert.equal(describeSpeechShape('所谓“朋友”，不过如此。'), 'narration', 'a line with only such quotes wears nobody\'s colour');
  assert.equal(describeSpeechShape('他说：“好。”'), 'mixed');
  assert.equal(describeSpeechShape('“好。”'), 'spoken');
  assert.equal(isEmbeddedQuote('想要接近', '那份关于', '却又'), true);
  assert.equal(isEmbeddedQuote('好', '他说', '。'), false, 'a verb of speech announces speech');
  assert.equal(isEmbeddedQuote('好。', '他点点头', ''), false, 'a sentence of its own is speech');
  assert.equal(isEmbeddedQuote('好', '他点点头，', ''), false, 'punctuation before the quote announces speech');
  assert.equal(isEmbeddedQuote('はい', '彼は', 'と言った'), false, 'the quotative particle announces speech');
  assert.equal(isEmbeddedQuote('友達', 'いわゆる', 'という関係'), true);
  assert.deepEqual(foldEmbeddedQuotes([{ text: '关于', spoken: false }, { text: '“它”', spoken: true }, { text: '的事', spoken: false }]), [{ text: '关于“它”的事', spoken: false }]);
});

test('a connection carries its own last word, and every request on it sends it', async () => {
  const { normalizeChannel } = await import('../core.js');
  const channel = normalizeChannel({ id: 'c1', name: '翻译', url: 'https://relay.example/v1', key: 'k', model: 'm', postscript: ' 不要输出思考过程。 ', postscriptRole: 'system' });
  assert.equal(channel.postscript, ' 不要输出思考过程。 ', 'kept as written; trimmed only when sent');
  assert.equal(channel.postscriptRole, 'system');
  assert.equal(normalizeChannel({ postscriptRole: 'nonsense' }).postscriptRole, 'user');
  const sent = createIndependentRequest({ channels: [channel], selectedChannelId: 'c1' }, [{ role: 'user', content: '正文' }]);
  assert.deepEqual(sent.messages, [{ role: 'user', content: '正文' }, { role: 'system', content: '不要输出思考过程。' }]);
  // A connection without one changes nothing, which is what every existing setup has.
  const bare = normalizeChannel({ id: 'c2', url: 'https://relay.example/v1', key: 'k', model: 'm' });
  assert.equal(createIndependentRequest({ channels: [bare], selectedChannelId: 'c2' }, [{ role: 'user', content: '正文' }]).messages.length, 1);
});

test('只留译文 writes each line as its translation and leaves every picture and preserved line where it stood', () => {
  const settings = { excludedTags: ['image'], carryFormatting: true };
  const inner = '\nLine one.\n<image>a cat\nsitting</image>\nLine two <image>x</image> end.\n***\n<b>Bold line.</b>\n\n![pic](/a.png)\n\nLast.\n';
  const segmented = segmentSource(inner, settings);
  assert.deepEqual(segmented.segments.map(segment => segment.text), ['Line one.', 'Line two  end.', 'Bold line.', 'Last.']);
  const translations = new Map([[1, '第一行。'], [2, '第二行。'], [3, '粗体行。'], [4, '最后。']]);
  const out = assembleTranslationOnly(segmented.layout, translations, settings);
  assert.equal(out, '\n第一行。\n<image>a cat\nsitting</image>\n第二行。<image>x</image>\n***\n<b>粗体行。</b>\n\n![pic](/a.png)\n\n最后。\n');
  assert.doesNotMatch(out, /[\u2060-\u2064\u200b-\u200d\ufeff\uE000-\uF8FF]/u, 'no invisible marker goes in');
  // A line still waiting for its translation keeps its original rather than vanishing.
  assert.equal(assembleTranslationOnly(segmentSource('\nA.\nB.\n', settings).layout, new Map([[1, '甲。']]), settings), '\n甲。\nB.\n');
});

test('只留译文 keeps the speaker colours as plain HTML', () => {
  const layout = segmentSource('\n「こんにちは」\n', {}).layout;
  const styleFor = () => ({ open: '<span class="jy-spk jy-spk-a" style="color:#123456 !important">', close: '</span>' });
  const out = assembleTranslationOnly(layout, new Map([[1, '「你好」']]), { styleFor });
  assert.equal(out, '\n<span class="jy-spk jy-spk-a" style="color:#123456 !important">「你好」</span>\n');
});

test('a floor with only its translation left in it is read from the text kept for it, until something else changes it', () => {
  const settings = { translationPrefix: '{', translationSuffix: '}' };
  const layout = segmentSource('\n雨が降っている。\n', settings).layout;
  const translations = new Map([[1, '下雨了。']]);
  const mirror = `<story_scene>${assembleBilingual(layout, translations, settings)}</story_scene>`;
  const projection = `<story_scene>${assembleTranslationOnly(layout, translations, settings)}</story_scene>`;
  assert.equal(projection, '<story_scene>\n下雨了。\n</story_scene>');
  const meta = { schema_version: 4, swipe_id: 0, complete: true, stripped: true, mirror, projection_hash: hashTextSync(projection), translation_prefix: '{', translation_suffix: '}' };
  const floor = (mes, swipeId = 0, extra = { [MESSAGE_META_KEY]: meta }) => ({ mes, swipe_id: swipeId, extra });
  const read = message => {
    const { text, stripped, diverged } = readFloor(message);
    return { text, stripped, diverged };
  };

  assert.deepEqual(read(floor(projection)), { text: mirror, stripped: true, diverged: false });
  assert.equal(floorText(floor(projection)), mirror);
  // A continue: the main model was shown the original and went on from it.
  const continued = '<story_scene>\n雨が降っている。\n</story_scene>\n風も強い。';
  assert.deepEqual(read(floor(continued)), { text: continued, stripped: false, diverged: false });
  // Changed by hand: its text is what it holds, and it says so.
  const edited = '<story_scene>\n下大雨了。\n</story_scene>';
  assert.deepEqual(read(floor(edited)), { text: edited, stripped: true, diverged: true });
  // The bilingual text put back is an ordinary floor again.
  assert.deepEqual(read(floor(mirror)), { text: mirror, stripped: false, diverged: false });
  // Another swipe is not this record's floor.
  assert.deepEqual(read(floor('<story_scene>\n晴れ。\n</story_scene>', 1)), { text: '<story_scene>\n晴れ。\n</story_scene>', stripped: false, diverged: false });
  // A host that keeps one metadata for every swipe: the swipe's own record is found.
  const shared = { ...floor(projection, 1, { [MESSAGE_META_KEY]: { ...meta, swipe_id: 0 } }), swipe_info: [{}, { extra: { [MESSAGE_META_KEY]: { ...meta, swipe_id: 1 } } }] };
  assert.deepEqual(read(shared), { text: mirror, stripped: true, diverged: false });
  // A replace-tag floor shows the main model the translation, so a longer floor there is a change.
  const replaceMirror = `<story_scene>${renderReplacePair('下雨了。', '雨が降っている。')}</story_scene>`;
  const replaceMeta = { ...meta, mirror: replaceMirror };
  assert.equal(read(floor('<story_scene>下雨了。</story_scene>\n又下了。', 0, { [MESSAGE_META_KEY]: replaceMeta })).diverged, true);
  // The fingerprint is the same text's whatever its line endings.
  assert.equal(hashTextSync('a\r\nb'), hashTextSync('a\nb'));
});

test('the main model is shown the original of a floor with only its translation left in it', () => {
  const settings = { translationPrefix: '{', translationSuffix: '}' };
  const layout = segmentSource('\n雨が降っている。\n', settings).layout;
  const translations = new Map([[1, '下雨了。']]);
  const mirror = `<story_scene>${assembleBilingual(layout, translations, settings)}</story_scene>`;
  const projection = `<story_scene>${assembleTranslationOnly(layout, translations, settings)}</story_scene>`;
  const extra = { [MESSAGE_META_KEY]: { schema_version: 4, swipe_id: 0, stripped: true, mirror, projection_hash: hashTextSync(projection) } };
  const message = { mes: projection, swipe_id: 0, extra };
  // The host renamed the tag in its prompt regexes, put the reasoning before and an attachment after.
  const regexed = value => value.replaceAll('story_scene', 'scene');
  const item = { ...message, mes: `<think>想了想</think>\n${regexed(projection)}\n[附件]` };
  const restored = restoreStrippedForPrompt(item, message, regexed);
  assert.equal(restored.mes, `<think>想了想</think>\n${regexed(mirror)}\n[附件]`);
  const prompt = [{ ...item, mes: restored.mes }];
  interceptGenerationChat(prompt);
  assert.equal(prompt[0].mes, '<think>想了想</think>\n<scene>\n雨が降っている。\n</scene>\n[附件]');
  // Without the host's regexes the floor as written is looked for.
  assert.equal(restoreStrippedForPrompt({ ...message }, message).mes, mirror);
  // Changed past recognition: said so, not guessed at.
  assert.deepEqual(restoreStrippedForPrompt({ ...message, mes: '别的' }, message), { mes: null });
  // Not one of these floors, or one changed by hand since: left alone.
  assert.equal(restoreStrippedForPrompt({ mes: 'x' }, { mes: 'x', swipe_id: 0, extra: {} }), null);
  assert.equal(restoreStrippedForPrompt({ mes: '改过' }, { ...message, mes: '改过' }), null);
});

test('a record is told to be a floor’s by what the floor holds, never by the swipe’s number', () => {
  const settings = { translationPrefix: '{', translationSuffix: '}' };
  const source = '\n夕暮れの教室には、誰もいなかった。\n窓から差し込む光が、机を淡く照らしている。\n';
  const layout = segmentSource(source, settings).layout;
  const translations = new Map([[1, '傍晚的教室里，一个人也没有。'], [2, '从窗外照进来的光，淡淡地照着桌面。']]);
  const mirror = `<story_scene>${assembleBilingual(layout, translations, settings)}</story_scene>`;
  const projection = `<story_scene>${assembleTranslationOnly(layout, translations, settings)}</story_scene>`;
  const meta = { schema_version: 4, stripped: true, mirror, projection_hash: hashTextSync(projection) };
  const record = swipeId => ({ [MESSAGE_META_KEY]: { ...meta, swipe_id: swipeId } });
  const state = message => {
    const { stripped, diverged } = readFloor(message);
    return { stripped, diverged, mirror: readFloor(message).text === mirror };
  };

  // Swipe 1 was stripped and swipe 0 deleted; nothing renumbered its record.
  assert.deepEqual(state({ mes: projection, swipe_id: 0, extra: record(1), swipe_info: [{ extra: record(1) }] }), { stripped: true, diverged: false, mirror: true });
  // A new reply on a copy of the record of the swipe before it, whatever number the copy names.
  const fresh = '<story_scene>\n夕暮れの廊下を、桜井がひとりで歩いていた。\n窓の外では雨が降り始めている。\n</story_scene>';
  for (const copied of [record(0), record(1)]) {
    assert.deepEqual(state({ mes: fresh, swipe_id: 1, extra: copied, swipe_info: [{ extra: record(0) }, { extra: copied }] }), { stripped: false, diverged: false, mirror: false });
  }
  // One word changed by hand, or every line touched: still the translation, so it is protected.
  const oneWord = projection.replace('一个人也没有', '一个人都没有');
  assert.deepEqual(state({ mes: oneWord, swipe_id: 0, extra: record(5) }), { stripped: true, diverged: true, mirror: false });
  const everyLine = projection.replace('一个人也没有。', '一个人也没有！').replace('照着桌面。', '照着桌面！');
  assert.deepEqual(state({ mes: everyLine, swipe_id: 0, extra: record(0) }), { stripped: true, diverged: true, mirror: false });
  // Continued from the translation (the prompt could not be given the original): protected.
  assert.equal(readFloor({ mes: `${projection}\n她叹了口气。`, swipe_id: 0, extra: record(0) }).diverged, true);
  // Continued from the original, with the host's clean-up of spaces at line ends: an ordinary floor.
  const spaced = mirror.replace('いなかった。', 'いなかった。  ');
  const continued = `${stripGeneratedTranslationLines(mirror, meta)}\n桜井が振り返った。`;
  assert.deepEqual(state({ mes: continued, swipe_id: 0, extra: { [MESSAGE_META_KEY]: { ...meta, mirror: spaced, swipe_id: 0 } } }), { stripped: false, diverged: false, mirror: false });
});

test('the gate takes the newest reply only, and a render with no type only after a start with none', () => {
  const gate = createGenerationGate();
  assert.equal(gate.begin('c', 'regenerate'), true);
  assert.equal(gate.consume('c', 'regenerate', { newest: false }), false, 'the floor that stood there before');
  assert.equal(gate.consume('c', undefined), false, 'a script redrawing a floor names no type');
  assert.equal(gate.consume('c', 'regenerate'), true);
  gate.begin('c', undefined);
  assert.equal(gate.consume('c', undefined), true, 'a start with no type is answered by a render with none');
});

test('the world books switched on are kept per card, names only', () => {
  const settings = mergeSettings({ worldInfoBooks: { 'avatar.png': ['设定集', '设定集', '', 3], broken: 'x' } });
  assert.deepEqual(settings.worldInfoBooks, { 'avatar.png': ['设定集', '3'] });
  assert.deepEqual(mergeSettings({}).worldInfoBooks, {});
});

test('each quoted run of a line finds its own mark, and the line\'s speaker only stands in where it can', async () => {
  const { placeQuoteMarks } = await import('../core.js');
  const runs = ['「你来了？」', '「坐吧。」'];
  // By the characters each mark quotes, whatever order the marks came in.
  const byHead = placeQuoteMarks(runs, { speaker: '泰罗', quotes: [{ head: '坐吧', speaker: '泰罗' }, { head: '你来了', speaker: '樱井' }] });
  assert.deepEqual(byHead.map(mark => mark?.speaker), ['樱井', '泰罗']);
  // No heads, equal counts: by order.
  assert.deepEqual(placeQuoteMarks(runs, { quotes: [{ speaker: '樱井' }, { speaker: '泰罗' }] }).map(mark => mark?.speaker), ['樱井', '泰罗']);
  // A run nobody placed is the line's speaker's, said the way the line is said, but never with its
  // sounds: a sound belongs to one moment.
  const loose = placeQuoteMarks(runs, { speaker: '泰罗', emotion: 'happy', tone: 'whispering', sounds: [{ at: 'start', tag: 'sighing' }], quotes: [{ head: '你来了', speaker: '泰罗' }] });
  assert.deepEqual(loose[1], { speaker: '泰罗', emotion: 'happy', tone: 'whispering' });
  // A line that names nobody still says how it is said: every run keeps the mood and the tone.
  const unnamed = placeQuoteMarks(runs, { emotion: 'sad', tone: 'soft tone', sounds: [{ at: 'start', tag: 'sighing' }] });
  assert.deepEqual(unnamed, [{ emotion: 'sad', tone: 'soft tone' }, { emotion: 'sad', tone: 'soft tone' }]);
  // Two people already placed on an unnamed line: the third run is nobody's, mood included.
  const crowd = placeQuoteMarks(['「你来了？」', '「嗯。」', '「坐吧。」'], { emotion: 'happy', quotes: [{ head: '你来了', speaker: '泰罗' }, { head: '嗯', speaker: '樱井' }] });
  assert.equal(crowd[2], null);
  // Once the placed runs show the line's speaker and somebody else, an unplaced run is nobody's.
  const three = ['「你来了？」', '「嗯。」', '「坐吧。」'];
  const mixed = placeQuoteMarks(three, { speaker: '泰罗', quotes: [{ head: '你来了', speaker: '泰罗' }, { head: '嗯', speaker: '樱井' }] });
  assert.deepEqual(mixed.map(mark => mark?.speaker ?? null), ['泰罗', '樱井', null]);
  // A run with a mark that names nobody takes the line's speaker when that is safe.
  assert.equal(placeQuoteMarks(runs, { speaker: '泰罗', quotes: [{ head: '你来了', emotion: 'surprised' }, { head: '坐吧', emotion: 'calm' }] })[0].speaker, '泰罗');
  // A line's only run takes the whole line: tone and sounds included, the run's own fields on top.
  assert.deepEqual(placeQuoteMarks(['「嗯……」'], { speaker: '泰罗', tone: 'whispering', emotion: 'shy', quotes: [{ emotion: 'uncertain' }] })[0], { speaker: '泰罗', tone: 'whispering', emotion: 'uncertain' });
  // No mark at all: nothing.
  assert.deepEqual(placeQuoteMarks(runs, null), [null, null]);
});

test('a stand-in copied back from the request\'s example is not a name or a mood', () => {
  const raw = JSON.stringify({ translations: [
    { id: 1, text: '「走吧。」', speaker: '<人名>', emotion: '<情绪词>', intensity: 1, tone: '<说法>', quotes: [{ head: '<台词开头几个字>', speaker: '名单中的名字', emotion: 'calm' }] },
  ] });
  const recovered = recoverStructuredTranslations(raw, [{ id: 1 }]);
  assert.equal(recovered.translations.get(1), '「走吧。」');
  assert.deepEqual(recovered.annotations.get(1), { quotes: [{ emotion: 'calm' }] });
});

test('a run\'s mark may be nothing but its sound, and a run written with a text of its own is still no translation', () => {
  // The prompt puts a sound on the run and says to leave out whatever else is unsure.
  const soundOnly = recoverStructuredTranslations(JSON.stringify({ translations: [
    { id: 1, text: '她叹了口气：「你来了。」「坐吧。」', speaker: '樱井', quotes: [{ head: '你来了', sounds: [{ at: 'start', tag: 'sighing' }] }] },
  ] }), [{ id: 1 }]);
  assert.deepEqual(soundOnly.annotations.get(1).quotes, [{ head: '你来了', sounds: [{ at: 'start', tag: 'sighing' }] }]);
  // A model that wrote each run as {text, speaker}: the array of them parses as a list of its own, and
  // none of it may count as an item — two items and one expected id would switch off the order fallback.
  const raw = JSON.stringify({ translations: [
    { text: '「你来了？」诗羽问道。', speaker: '诗羽', quotes: [{ text: '你来了？', speaker: '诗羽' }] },
  ] });
  const recovered = recoverStructuredTranslations(raw, [{ id: 4 }]);
  assert.equal(recovered.translations.get(4), '「你来了？」诗羽问道。', 'the one item without an id is placed by position');
  assert.equal(recovered.warnings.some(warning => warning.includes('为空')), false);
  // A pronoun is nobody's name.
  const pronoun = recoverStructuredTranslations(JSON.stringify({ translations: [{ id: 1, text: '「好。」', speaker: '你', emotion: 'happy' }] }), [{ id: 1 }]);
  assert.deepEqual(pronoun.annotations.get(1), { emotion: 'happy' });
});

test('a run nobody placed is said the way its line is, and a run of the line\'s own speaker keeps the line\'s mood', async () => {
  const { placeQuoteMarks } = await import('../core.js');
  // No quotes to place by: each run takes the whole line but its sound. The words a pause or a stress
  // points at are checked against each run's own text where the mark is read.
  const line = {
    speaker: '英梨梨', emotion: 'sad', intensity: 2, direction: '哽咽着，声音发抖',
    pauses: [{ after: '求你', length: 'short' }], stress: ['不想'], sounds: [{ at: 'start', tag: 'sobbing' }],
  };
  const { sounds: _sounds, ...said } = line;
  assert.deepEqual(placeQuoteMarks(['「我不想走。」', '「求你了。」'], line), [said, said]);
  // Both runs placed, both the line's speaker's, neither with a mood: the line's mood on both.
  const same = placeQuoteMarks(['「你真是个笨蛋。」', '「算了，走吧。」'], {
    speaker: '莉莉', emotion: 'happy', intensity: 1, quotes: [{ head: '你真是', speaker: '莉莉' }, { head: '算了', speaker: '莉莉' }],
  });
  assert.deepEqual(same.map(mark => [mark.speaker, mark.emotion, mark.intensity]), [['莉莉', 'happy', 1], ['莉莉', 'happy', 1]]);
  // Two people: the line's mood is its first speaker's, and never the other one's.
  const two = placeQuoteMarks(['「你来了？」', '「嗯。」'], {
    speaker: '诗羽', emotion: 'curious', quotes: [{ head: '你来了', speaker: '诗羽' }, { head: '嗯', speaker: '英梨梨' }],
  });
  assert.deepEqual(two.map(mark => [mark.speaker, mark.emotion]), [['诗羽', 'curious'], ['英梨梨', undefined]]);
});

test('a sign in quotes is counted and stays nobody\'s, so the runs after it are still placed by order', async () => {
  const { placeQuoteMarks, readQuoteMark } = await import('../core.js');
  assert.deepEqual(readQuoteMark({ head: '禁止入内', type: 'narration', speaker: '艾琳' }), { head: '禁止入内', type: 'narration' });
  const raw = JSON.stringify({ translations: [{
    id: 5, text: '「等等！」她指着招牌上的「禁止入内」。莉莉丝答道：「那里很危险哦」', speaker: '艾琳', emotion: 'nervous',
    quotes: [{ head: '等等', speaker: '艾琳', emotion: 'nervous' }, { head: '禁止入内', type: 'narration' }, { head: '那里很危险', speaker: '莉莉丝', emotion: 'worried' }],
  }] });
  const mark = recoverStructuredTranslations(raw, [{ id: 5 }]).annotations.get(5);
  assert.deepEqual(mark.quotes[1], { head: '禁止入内', type: 'narration' });
  // The original's runs: no head matches them, and the counts agree.
  const placed = placeQuoteMarks(['「待って！」', '「立入禁止」', '「そこは危ないよ」'], mark);
  assert.deepEqual(placed.map(own => own?.type === 'narration' ? 'narration' : own?.speaker), ['艾琳', 'narration', '莉莉丝']);
  // A line whose only run is a sign names nobody there.
  assert.deepEqual(placeQuoteMarks(['「禁止入内」'], { speaker: '艾琳', quotes: [{ head: '禁止入内', type: 'narration' }] }), [{ head: '禁止入内', type: 'narration' }]);
});

test('the host\'s default reader name is a person, and a real value wrapped in the example\'s brackets is that value', async () => {
  const { readAnnotationFields, EXAMPLE_STAND_INS } = await import('../core.js');
  assert.equal(readAnnotationFields({ speaker: 'User', emotion: 'happy' })?.speaker, 'User');
  assert.equal(readAnnotationFields({ speaker: '{{user}}', emotion: 'happy' })?.speaker, undefined);
  const { parseTtsAnalysis } = await import('../tts.js');
  const analysed = parseTtsAnalysis(JSON.stringify({ voices: [{ id: 1, speaker: 'User', emotion: 'happy' }] }), [{ id: 1, lineId: 1, kind: 'quoted', text: '嗨。' }]);
  assert.equal(analysed.labels.get(1)?.speaker, 'User', 'the analyses keep the name too, so a voice row called User is used');
  const wrapped = readAnnotationFields({ speaker: '<英梨梨>', emotion: '＜angry＞', tone: '<whispering>', intensity: 2 });
  assert.deepEqual(wrapped, { speaker: '英梨梨', emotion: 'angry', intensity: 2, tone: 'whispering' });
  for (const standIn of EXAMPLE_STAND_INS) assert.equal(readAnnotationFields({ speaker: `<${standIn}>`, emotion: `<${standIn}>` }), null, standIn);
  // A head the model wrapped the same way still places its run.
  const recovered = recoverStructuredTranslations(JSON.stringify({ translations: [
    { id: 1, text: '「走吧。」「好。」', quotes: [{ head: '<走吧>', speaker: '<英梨梨>' }, { head: '<台词开头几个字>', speaker: '诗羽' }] },
  ] }), [{ id: 1 }]);
  assert.deepEqual(recovered.annotations.get(1).quotes, [{ head: '走吧', speaker: '英梨梨' }, { speaker: '诗羽' }]);
});

test('a restyle changes the outer affixes only: the runs painted one by one and the carried formatting stay', () => {
  const run = color => `${AFFIX_START}<span class="jy-spk-x" style="color:${color} !important">${AFFIX_END}`;
  const close = `${AFFIX_START}</span>${AFFIX_END}`;
  const wrapper = '<span class="jy-spk" title="诗羽、英梨梨">';
  const body = `${run('#00fffb')}「你来了？」${close}诗羽问道，英梨梨点点头：${run('#facf36')}「嗯。」${close}\n${AFFIX_START}<b>${AFFIX_END}警报。${AFFIX_START}</b>${AFFIX_END}`;
  const floor = `${renderSourceBlock('原文。')}\n${renderTranslationBlock(body, { translationPrefix: '{', translationSuffix: '}', stylePrefix: wrapper, styleSuffix: '</span>' })}`;
  const metadata = { schema_version: 4, translation_prefix: '{', translation_suffix: '}' };
  const style = { translationPrefix: '【', translationSuffix: '】' };
  const restyled = restyleBilingual(floor, style, metadata);
  assert.ok(restyled.includes(body), 'the body comes back byte for byte');
  assert.ok(restyled.includes(`${AFFIX_START}【${wrapper}${AFFIX_END}`));
  assert.ok(restyled.includes(`${AFFIX_START}</span>】${AFFIX_END}`));
  assert.equal(restyleBilingual(restyled, style, { ...metadata, translation_prefix: '【', translation_suffix: '】' }), restyled);
  assert.deepEqual([...extractGeneratedTranslations(restyled, style).values()], [...extractGeneratedTranslations(floor, { translationPrefix: '{', translationSuffix: '}' }).values()]);
  // Without a record of the affixes the block was written with, the old way: words and wrapper only.
  const plain = restyleBilingual(floor, style, { schema_version: 4 });
  assert.doesNotMatch(plain, /#00fffb|<b>/);
  assert.match(plain, /title="诗羽、英梨梨"/);
  // A body whose tags would no longer pair up is not kept either.
  const broken = floor.replace(`${AFFIX_START}</b>${AFFIX_END}`, '');
  assert.doesNotMatch(restyleBilingual(broken, style, metadata), /<b>/);
});

test('a restyle never keeps inside the body an outer affix its record does not know about', () => {
  const wrapper = '<span class="jy-spk" title="诗羽">';
  const style = { translationPrefix: '【', translationSuffix: '】' };
  // Written with <jy-t>…</jy-t> while the record, not kept up, still says the block has no visible affixes.
  const floor = `${renderSourceBlock('原文。')}\n${renderTranslationBlock('「你来了？」诗羽问道。', { translationPrefix: '<jy-t>', translationSuffix: '</jy-t>', stylePrefix: wrapper, styleSuffix: '</span>' })}`;
  const record = { schema_version: 4, translation_prefix: '', translation_suffix: '' };
  const restyled = restyleBilingual(floor, style, record);
  assert.doesNotMatch(restyled, /jy-t/);
  assert.ok(restyled.includes(`${AFFIX_START}【${wrapper}${AFFIX_END}「你来了？」诗羽问道。${AFFIX_START}</span>】${AFFIX_END}`));
  // A prefix of formatting tags is told apart by the speaker wrapper it sits in front of.
  const bold = floor.replace(/<jy-t>/g, '<b>').replace(/<\/jy-t>/g, '</b>');
  assert.equal((restyleBilingual(bold, style, record).match(/<b>/g) ?? []).length, 0);
  // The original's own formatting at the start of a block written with no visible affixes is the body's.
  const carried = `${AFFIX_START}<span style="color:#ff0000">${AFFIX_END}警报响了。${AFFIX_START}</span>${AFFIX_END}`;
  const bare = `${renderSourceBlock('原文。')}\n${renderTranslationBlock(carried, { translationPrefix: '', translationSuffix: '' })}`;
  assert.ok(restyleBilingual(bare, style, record).includes(`${AFFIX_START}【${AFFIX_END}${carried}${AFFIX_START}】${AFFIX_END}`));
});

test('a head that happens to be one of the example\'s stand-in words still places its run', async () => {
  const { placeQuoteMarks, readQuoteMark, readAnnotationFields } = await import('../core.js');
  const quotes = [{ head: '是吗', speaker: '英梨梨' }, { head: '说法', speaker: '诗羽' }].map(readQuoteMark);
  assert.deepEqual(quotes[1], { head: '说法', speaker: '诗羽' });
  const placed = placeQuoteMarks(['「是吗。」', '「说法都不一样。」', '「算了。」'], { speaker: '英梨梨', quotes });
  assert.deepEqual(placed.slice(0, 2).map(own => own?.speaker), ['英梨梨', '诗羽']);
  // Only the stand-in copied back in the example's brackets is thrown away.
  assert.equal(readQuoteMark({ head: '<说法>', speaker: '<人名>' }), null);
  assert.equal(readAnnotationFields({ speaker: '名单中的名字', emotion: '可选' }), null, 'the older stand-ins were shown bare');
});

test('a run of the line\'s own speaker takes the line\'s mood only when no quote names a mood, and never its tone', async () => {
  const { placeQuoteMarks } = await import('../core.js');
  // The second quote was left without a mood beside one that names its own: it stays without.
  const later = placeQuoteMarks(['「滚出去！」', '「……对不起。」'], {
    speaker: '艾琳', emotion: 'angry', intensity: 2, tone: 'shouting',
    quotes: [{ head: '滚出去', speaker: '艾琳', emotion: 'angry', intensity: 2, tone: 'shouting' }, { head: '对不起', speaker: '艾琳' }],
  });
  assert.deepEqual(later[1], { head: '对不起', speaker: '艾琳' });
  // Quotes that name speakers only: the mood written on the line is theirs, the whisper is not.
  const bare = placeQuoteMarks(['「别动。」', '「好了，你可以走了。」'], {
    speaker: '艾琳', emotion: 'nervous', intensity: 1, tone: 'whispering', quotes: [{ head: '别动', speaker: '艾琳' }, { head: '好了', speaker: '艾琳' }],
  });
  assert.deepEqual(bare.map(own => [own.emotion, own.intensity, own.tone]), [['nervous', 1, undefined], ['nervous', 1, undefined]]);
});

test('the original\'s side places its runs by order without the signs it folded into narration', async () => {
  const { placeQuoteMarks } = await import('../core.js');
  // 看板の「立入禁止」を is narration on the original's side, so it has two runs to the translation's three quotes.
  const mark = { speaker: '艾琳', emotion: 'nervous', quotes: [
    { head: '等等', speaker: '艾琳', emotion: 'nervous' }, { head: '禁止入内', type: 'narration' }, { head: '那里很危险', speaker: '莉莉丝', emotion: 'worried' },
  ] };
  assert.deepEqual(placeQuoteMarks(['「待って！」', '「そこは危ないよ」'], mark).map(own => own?.speaker), ['艾琳', '莉莉丝']);
  // Nothing placed, and the quotes name more than one person: nobody's name goes on a run by guess.
  const unplaced = placeQuoteMarks(['「待って！」', '「そこは危ないよ」'], { speaker: '艾琳', quotes: [
    { head: '等等', speaker: '艾琳' }, { head: '那里很危险', speaker: '莉莉丝' }, { head: '算了', speaker: '千夏' },
  ] });
  assert.deepEqual(unplaced.map(own => own?.speaker ?? null), [null, null]);
});

// ---------------------------------------------------------------------------------------------
// v0.37.0 lyric-line rules, the music-card rule group, and inline pairing.
// Every fixture below is invented text, never a real song's lyrics.
// ---------------------------------------------------------------------------------------------

test('lyric-line rules use the same exact, prefix and regex grammar as preserve rules', () => {
  const parsed = parseLyricLineRulesWithErrors(['夜风轻轻吹过', 'prefix:作词', '/^\\s*献给/']);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.rules.map(rule => rule.type), ['exact', 'prefix', 'regex']);
  assert.match(parseLyricLineRulesWithErrors('/[/').errors[0], /第 1 行正则无效/);
});

test('a lyric line forms its own unit, never joining the narration around it', () => {
  const source = '第一行叙述。\nそらにひびけ\n第二行叙述。';
  const segmented = segmentSource(source, { lyricLineRules: ['そらにひびけ'] });
  assert.equal(segmented.lyricLines, 1);
  assert.equal(segmented.paragraphs, 1, 'still one blank-line-delimited paragraph');
  assert.deepEqual(segmented.segments.map(item => item.text), ['第一行叙述。', 'そらにひびけ', '第二行叙述。']);
  assert.deepEqual([...segmented.lyricIds], [2]);
  const kinds = segmented.layout.filter(part => part.type === 'segment').map(part => Boolean(part.lyric));
  assert.deepEqual(kinds, [false, true, false], 'the lyric line is its own segment, flagged apart from its neighbours');
});

test('a lyric line already written in Chinese is not translated, same as any other preserved line', () => {
  const source = '第一行叙述。\n静静地看着你\n第二行叙述。';
  const segmented = segmentSource(source, { lyricLineRules: ['静静地看着你'] });
  assert.equal(segmented.lyricLines, 1, 'still counted as a lyric-line candidate for the inspector');
  assert.equal(segmented.lyricIds.size, 0, 'but it never becomes a segment to translate or read');
  assert.deepEqual(segmented.segments.map(item => item.text), ['第一行叙述。', '第二行叙述。']);
  const output = assembleBilingual(segmented.layout, new Map([[1, '叙述译文一'], [2, '叙述译文二']]), { allowMissing: true });
  assert.match(output.replace(/[\u200b\u200c\u2060-\u2064]/g, ''), /静静地看着你/);
});

test('the music-card group splits <br>-joined card rows and classifies each on its own', () => {
  const card = 'NOW PLAYING<br>今日は静かな朝<br>作词：风铃<br>もう一度歌おう';
  const segmented = segmentSource(card, { musicCardRules: true });
  // NOW PLAYING is the built-in caption. 今日は静かな朝 and もう一度歌おう have nothing to claim them,
  // so the catch-all makes them lyric lines. 作词：风铃 is also a lyric-line candidate by the same
  // catch-all, but it carries no kana at all, so it is judged already-Chinese and skipped.
  assert.equal(segmented.lyricLines, 3);
  assert.deepEqual(segmented.segments.map(item => item.text), ['今日は静かな朝', 'もう一度歌おう']);
  assert.equal(segmented.segments.length, segmented.lyricIds.size, 'every remaining segment here is a lyric one');
  assert.equal(segmented.cardPreservedLines, 1, 'NOW PLAYING only');
});

test('the waveform row still goes through the older built-in rule, not the music-card catch-all', () => {
  const card = 'NOW PLAYING<br>そらいろの手紙<br>ılılılıllı';
  const segmented = segmentSource(card, { musicCardRules: true });
  assert.deepEqual(segmented.segments.map(item => item.text), ['そらいろの手紙']);
  assert.equal(segmented.cardPreservedLines, 1, 'NOW PLAYING');
  assert.equal(segmented.builtinPreservedLines, 1, 'the waveform row, by the v0.36.1 rule');
  assert.equal(segmented.lyricLines, 1);
});

test('a row already written "原文 (中文)" is preserved untouched by the music-card group', () => {
  const card = 'NOW PLAYING<br>灯りが揺れる (灯光摇曳)<br>次の一行';
  const segmented = segmentSource(card, { musicCardRules: true });
  assert.deepEqual(segmented.segments.map(item => item.text), ['次の一行']);
  assert.equal(segmented.cardPreservedLines, 2, 'NOW PLAYING and the already-bilingual row');
});

test('a reader’s own preserve rule still wins over the music-card catch-all, <br> and all', () => {
  const card = 'NOW PLAYING<br>作词：星野<br>そらいろの手紙';
  const segmented = segmentSource(card, { musicCardRules: true, preserveLineRules: ['prefix:作词'] });
  assert.deepEqual(segmented.segments.map(item => item.text), ['そらいろの手紙']);
  assert.equal(segmented.customPreservedLines, 1);
});

test('a lyric line renders "原文 (译文)" inline in bilingual mode and reads back to the same translation', () => {
  const source = '第一行叙述。\nそらにひびけ\n第二行叙述。';
  const options = { lyricLineRules: ['そらにひびけ'] };
  const segmented = segmentSource(source, options);
  const translations = new Map([[1, '叙述译文一'], [2, '响彻天空'], [3, '叙述译文二']]);
  const rendered = assembleBilingual(segmented.layout, translations, options);
  const visible = rendered.replace(/[\u200b\u200c\u2060-\u2064]/g, '');
  assert.match(visible, /そらにひびけ \(响彻天空\)/);
  assert.doesNotMatch(visible, /\{响彻天空\}/, 'the lyric translation never gets the ordinary {…} affix');
  const recovered = extractGeneratedTranslations(rendered, options);
  assert.deepEqual(new Map(recovered), translations);
  assert.equal(restyleBilingual(rendered, options), rendered, 're-colouring must leave a lyric pair exactly as written');
});

test('a lyric line restores its own <br> after the closing parenthesis, bilingual mode', () => {
  const card = 'NOW PLAYING<br>そらにひびけ<br>作词：风铃';
  const options = { musicCardRules: true };
  const segmented = segmentSource(card, options);
  assert.deepEqual(segmented.segments.map(item => item.text), ['そらにひびけ']);
  const translations = new Map([[segmented.segments[0].id, '响彻天空']]);
  const rendered = assembleBilingual(segmented.layout, translations, options);
  const visible = rendered.replace(/[\u200b\u200c\u2060-\u2064]/g, '');
  assert.match(visible, /そらにひびけ \(响彻天空\)<br>/);
  const restored = stripGeneratedTranslationLines(rendered);
  assert.match(restored, /そらにひびけ<br>/);
  assert.doesNotMatch(restored, /[()]/);
});

test('a lyric row still untranslated (a partial write) keeps its own trailing <br>, and strips back to the exact original', () => {
  // Two lyric rows; only the second (もう一つの行, the last row, no <br> of its own to lose) has come
  // back so far — a real streaming frame's first frame naming only one id, or a row withoutUntranslated
  // dropped. The first row (そらにひびけ) is the one with a <br> to lose if renderLyricPair forgets it.
  const card = 'NOW PLAYING<br>そらにひびけ<br>もう一つの行';
  const options = { musicCardRules: true };
  const segmented = segmentSource(card, options);
  assert.deepEqual(segmented.segments.map(item => item.text), ['そらにひびけ', 'もう一つの行']);
  const translations = new Map([[segmented.segments[1].id, '另一行译文']]);
  const rendered = assembleBilingual(segmented.layout, translations, { ...options, allowMissing: true });
  const visible = rendered.replace(/[\u200b\u200c\u2060-\u2064]/g, '');
  assert.match(visible, /そらにひびけ<br>/, 'the untranslated row\'s own <br> is not lost');
  assert.doesNotMatch(visible, /そらにひびけ \(/, 'no dangling " (" with nothing to close it');
  const restored = stripGeneratedTranslationLines(rendered);
  assert.equal(restored, card, 'a partial write strips back to exactly the original card, both rows and both <br>s intact');
});

test('a lyric line in 只留译文 mode also pairs inline, plain text, no markers needed', () => {
  const source = '第一行叙述。\nそらにひびけ\n第二行叙述。';
  const options = { lyricLineRules: ['そらにひびけ'] };
  const segmented = segmentSource(source, options);
  const translations = new Map([[1, '叙述译文一'], [2, '响彻天空'], [3, '叙述译文二']]);
  const output = assembleTranslationOnly(segmented.layout, translations, options);
  assert.equal(output, '叙述译文一\nそらにひびけ (响彻天空)\n叙述译文二');
});

test('只留译文 keeps only a card row\'s own <br> between it and the narration after it, no extra blank line', () => {
  // "NOW PLAYING<br>作词：风铃" is one physical line split into two preserved rows sharing a unit with the
  // narration lines around it. assembleTranslationOnly used to join every lineParts entry with a fixed
  // '\n' regardless of what actually separated them, so the caption row gained an extra line break after
  // its own <br> — replaceUnitBody already joins with each line's real separator (see the replace-region
  // test above); this is the same fix for the 只留译文 path.
  const source = '她哼起了。\nNOW PLAYING<br>作词：风铃\n彼女は止まった。';
  const options = { musicCardRules: true };
  const segmented = segmentSource(source, options);
  const translations = new Map(segmented.segments.map((segment, index) => [segment.id, `译${index + 1}`]));
  const output = assembleTranslationOnly(segmented.layout, translations, options);
  assert.equal(output, '译1\nNOW PLAYING<br>作词：风铃\n译2', '卡片行自己的 <br> 后面不再多出一个换行，也没有丢掉真正的段内换行');

  // The same card, but with its own row ending its own physical line in <br> (an empty trailing row) —
  // the shape that also caught the replace-region reader off guard.
  const bareBr = '她哼起了。\nNOW PLAYING<br>\n彼女は止まった。';
  const segmentedBareBr = segmentSource(bareBr, options);
  const translationsBareBr = new Map(segmentedBareBr.segments.map((segment, index) => [segment.id, `译${index + 1}`]));
  const outputBareBr = assembleTranslationOnly(segmentedBareBr.layout, translationsBareBr, options);
  assert.equal(outputBareBr, '译1\nNOW PLAYING<br>\n译2', '卡片自己独占一整行的 <br> 也不会被多插一个换行');
});

test('inspectTagConfiguration counts lyric and music-card-preserved lines separately from the rest', () => {
  const card = '<story_scene>NOW PLAYING<br>そらにひびけ<br>もう一つの行</story_scene>';
  const report = inspectTagConfiguration(card, ['story_scene'], [], { musicCardRules: true });
  assert.equal(report.cardPreservedLines, 1);
  assert.equal(report.lyricLines, 2);
  assert.equal(report.translationUnits, 2);
});

test('with the music-card group off, a <br>-joined card is read exactly as v0.36.1 already reads it', () => {
  const card = 'NOW PLAYING<br>今日の空<br>作词：陽炎';
  assert.deepEqual(
    segmentSource(card).segments.map(item => item.text),
    ['NOW PLAYING\n今日の空\n作词：陽炎'],
    'musicCardRules defaults off, so an existing floor segments exactly as it always has',
  );
});

test('v0.40.0: a card\'s first row starts its own unit instead of merging into the narration before it', () => {
  const source = '她哼起了一段旋律。\nNOW PLAYING<br>そらにひびけ<br>作词：风铃';
  const segmented = segmentSource(source, { musicCardRules: true });
  const units = segmented.layout.filter(part => part.type === 'segment');
  assert.equal(units[0].text, '她哼起了一段旋律。');
  assert.equal(units[0].sourceText, '她哼起了一段旋律。', 'the NOW PLAYING row that follows is never folded into this unit');
  assert.deepEqual(segmented.segments.map(item => item.text), ['她哼起了一段旋律。', 'そらにひびけ']);
  // An old floor (segmented before this fix) keeps reading the same text the way it always did — the
  // narration and the card's first row still merge into one unit, so its stored translation still matches.
  const oldFloor = segmentSource(source, { musicCardRules: true, segmentationVersion: 2 });
  const oldUnits = oldFloor.layout.filter(part => part.type === 'segment');
  assert.equal(oldUnits[0].sourceText, '她哼起了一段旋律。\nNOW PLAYING<br>', 'segmentation_version 2 stays on the old, unfixed merge');
});

test('v0.40.0: the music-card catch-all only fires inside an actual card, so plain <br>-separated prose is left as ordinary text', () => {
  const prose = '写着地址的第一行<br>写着地址的第二行<br>写着地址的第三行';
  const segmented = segmentSource(prose, { musicCardRules: true });
  assert.equal(segmented.lyricLines, 0, '没有 NOW PLAYING 字样、双语行或歌词行命中，这里就不该被当成音乐卡片');
  assert.deepEqual(
    segmented.segments.map(item => item.text),
    ['写着地址的第一行\n写着地址的第二行\n写着地址的第三行'],
    '当成普通正文整体翻译，和 musicCardRules 关闭时读法一致',
  );
  // An old floor still runs the broader, unsignalled split — every <br> row becomes its own lyric guess.
  const oldFloor = segmentSource(prose, { musicCardRules: true, segmentationVersion: 2 });
  assert.equal(oldFloor.lyricLines, 3, 'segmentation_version 2 stays on the old catch-all, so a floor already translated that way still matches');
});

test('v0.40.0: the card signal is judged over the whole run of <br>-bearing lines, not each physical line alone', () => {
  // A NOW PLAYING card pretty-printed with every row on its own source line: only the caption's own
  // physical line shows a signal by itself, but the whole run (caption + two lyric rows, each ending in
  // its own <br>) is one card and every row of it must be read as one.
  const pretty = '<div class="player">\n<b>♪ NOW PLAYING ♪</b><br>\nそらにひびけ<br>\nもう一度だけ<br>\n</div>';
  const segmented = segmentSource(pretty, { musicCardRules: true });
  assert.deepEqual([...segmented.lyricIds].length, 2, '两行歌词都被识别，不止判过信号的那一行');
  assert.deepEqual(segmented.segments.map(item => item.text), ['そらにひびけ', 'もう一度だけ']);
  // An old floor already ran the whole run unconditionally (musicCardRules alone was always enough),
  // so it agrees with the fixed v3 reading on this exact shape — nothing here needed a version bump.
  const oldFloor = segmentSource(pretty, { musicCardRules: true, segmentationVersion: 2 });
  assert.deepEqual(oldFloor.segments.map(item => item.text), ['そらにひびけ', 'もう一度だけ']);

  // Plain <br>-separated prose spread one row per physical line still shows no signal anywhere in the
  // run, so it is still left alone under v3 — the run-wide check does not turn ordinary prose into a
  // card just because it happens to end each of its lines in <br>.
  const prose = '写着地址的第一行<br>\n写着地址的第二行<br>\n写着地址的第三行';
  assert.equal(segmentSource(prose, { musicCardRules: true }).lyricLines, 0, '没有信号的一组 <br> 行，逐行拆开也不该被当成卡片');
});

test('v0.40.0: the already-bilingual row check only counts a parenthesised part that is actually Chinese', () => {
  // A bare kana reading has no Han character in the parens at all, so the legacy check never matched
  // it either — this case alone proves nothing about the fix (v2 and v3 always agreed on it).
  const ruby = 'NOW PLAYING<br>星(ほし)<br>もう一つの行';
  const segmented = segmentSource(ruby, { musicCardRules: true });
  assert.equal(segmented.cardPreservedLines, 1, 'NOW PLAYING only — a bare kana reading was never mistaken for our own bilingual pairing, on either version');
  assert.deepEqual(segmented.segments.map(item => item.text), ['星(ほし)', 'もう一つの行']);

  const real = 'NOW PLAYING<br>灯りが揺れる (灯光摇曳)<br>次の一行';
  assert.equal(segmentSource(real, { musicCardRules: true }).cardPreservedLines, 2, '一句真正写好的中文仍然照常识别、保留');

  // The case that actually changed: a parenthetical that mixes kana into its kanji — still untranslated
  // Japanese, not a finished Chinese gloss. The legacy (segmentation_version 2) check only asked for any
  // Han character and took it for one; v3 asks whether the parenthesised part itself reads as Chinese
  // (Han present, no kana) and no longer does.
  const mixed = 'NOW PLAYING<br>そらにひびけ (空に響け)<br>次の一行';
  assert.equal(segmentSource(mixed, { musicCardRules: true }).cardPreservedLines, 1, 'v3：括号里混着假名，不算已经写好的中文译文，照常按歌词处理');
  assert.equal(
    segmentSource(mixed, { musicCardRules: true, segmentationVersion: 2 }).cardPreservedLines, 2,
    '旧楼层（segmentation_version 2）照旧按当时更宽松的判断读，存量译文不会对不上',
  );

  // A known, accepted limit shared with looksAlreadyTranslatedLyric (design §7 item 9): a Japanese gloss
  // written entirely in kanji, with no kana to tell it apart from Chinese, is still misjudged as already
  // translated — this has not changed, and the fix above does not claim otherwise.
  const kanjiGloss = 'NOW PLAYING<br>あんた(貴方)<br>次の一行';
  assert.equal(segmentSource(kanjiGloss, { musicCardRules: true }).cardPreservedLines, 2, '纯汉字注解仍然会被当成已翻译，这是已知的限制，不是这次修复要解决的');
});

test('a lyric line lays out "原文 (译文)" inside a replace region too, its own <br> intact, and reads back translated', () => {
  const card = 'NOW PLAYING<br>そらにひびけ<br>作词：风铃';
  const options = { musicCardRules: true };
  const segmented = segmentSource(card, options);
  const translations = new Map([[segmented.segments[0].id, '响彻天空']]);
  const rendered = assembleReplace(segmented.layout, translations, { ...options, allowMissing: true });
  // 什么是读者真正看到的：隐藏的原文连同它自己的边界一起去掉，剩下的不可见标记也一并去掉（替换对总是把隐藏的那一半留在原始楼层文本里，真正的隐藏由另一套机制完成，这里不模拟它）。
  const visible = rendered
    .replace(new RegExp(`\\n?${HIDDEN_START}[\\s\\S]*?${HIDDEN_END}`, 'g'), '')
    .replace(/[\u200b\u200c\u2060-\u2064]/g, '');
  assert.match(visible, /そらにひびけ \(响彻天空\)<br>/, '替换模式下也排成和双语/只留译文一样的「原文 (译文)」，卡片行自己的 <br> 还在');
  const restored = stripGeneratedTranslationLines(rendered);
  assert.equal(restored, card, '还原时严丝合缝地拿回原文，两个 <br> 都还在');
  // 高优先级部分：替换标签区域里歌词行的译文必须能被 extractReplaceTranslations 读回来（readMessageSnapshot 对替换区域唯一的读法），否则这楼层永远不会被判定成已翻译，每次都会重发。
  const seenAgain = extractReplaceTranslations(rendered, options);
  assert.equal(seenAgain.get(segmented.segments[0].id), '响彻天空', '替换标签区域里的歌词行译文能被读回，楼层不会被判定成没翻译、每次都重发');
  // 中优先级部分：主模型自己的提示词里看到的是译文，不是原文。
  const prompt = stripGeneratedTranslationLines(rendered, undefined, 'prompt');
  assert.equal(prompt, 'NOW PLAYING<br>响彻天空<br>作词：风铃', '主模型在提示词里看到的是译文，不是日文原文');
});

test('a replace-tag lyric line written before this fix (「歌词行」 predates it, v0.37.0) still reads back translated', () => {
  // main 8f76124's assembleReplace had no part.lyric branch at all — a 「歌词行」-matched line inside a
  // replace region went through the same ordinary path as any other segment, its hidden half holding the
  // full source (trailing <br> included, since the ordinary path never strips it). extractReplaceTranslations
  // must still recognise that shape, not only the new renderReplaceLyricPair one.
  const source = '♪ 星の歌\n彼女は歌った。';
  const options = { lyricLineRules: 'prefix:♪' };
  const segmented = segmentSource(source, options);
  assert.ok(segmented.layout.some(part => part.lyric), '这句歌词规则命中的行确实被判成了 lyric，样例才有意义');
  const mainStyleLayout = segmented.layout.map(part => (part.lyric ? { ...part, lyric: false } : part));
  const translations = new Map(segmented.segments.map((segment, index) => [segment.id, `译${index + 1}`]));
  const rendered = assembleReplace(mainStyleLayout, translations, options);
  const seenAgain = extractReplaceTranslations(rendered, options);
  assert.equal(seenAgain.size, segmented.segments.length, '旧写法（main 8f76124）留下的替换标签歌词行，读回时一段都不少');
});

test('a non-lyric card row sharing a unit with narration keeps only its own <br> in a replace region, no extra blank line', () => {
  // "NOW PLAYING<br>作词：风铃" is one physical line split into two preserved rows; 彼女は止まった。 is the
  // next physical line, joined to them by a real newline. Before this fix replaceUnitBody joined every
  // line of the unit with a literal '\n' regardless of what actually separated them, so the caption row
  // gained an extra blank line after its own <br> once rendered.
  const source = '她哼起了。\nNOW PLAYING<br>作词：风铃\n彼女は止まった。';
  const options = { musicCardRules: true };
  const segmented = segmentSource(source, options);
  const translations = new Map(segmented.segments.map((segment, index) => [segment.id, `译${index + 1}`]));
  const rendered = assembleReplace(segmented.layout, translations, options);
  const prompt = stripGeneratedTranslationLines(rendered, undefined, 'prompt');
  assert.equal(prompt, '译1\nNOW PLAYING<br>作词：风铃\n译2', '卡片行自己的 <br> 后面不再多出一个换行，也没有丢掉真正的段内换行');
  const restored = stripGeneratedTranslationLines(rendered);
  assert.equal(restored, source, '原文一字不差地还原');
  const seenAgain = extractReplaceTranslations(rendered, options);
  assert.equal(seenAgain.get(segmented.segments[0].id), '译1');
  assert.equal(seenAgain.get(segmented.segments[1].id), '译2');

  // A floor written before this fix always inserted a real '\n' there regardless — reading it back
  // still has to work, so an already-translated floor is never seen as needing anything more.
  const oldStyleIndex = rendered.indexOf('NOW PLAYING<br>') + 'NOW PLAYING<br>'.length;
  const oldStyle = `${rendered.slice(0, oldStyleIndex)}\n${rendered.slice(oldStyleIndex)}`;
  const seenOldStyle = extractReplaceTranslations(oldStyle, options);
  assert.equal(seenOldStyle.get(segmented.segments[0].id), '译1', '旧写法多出来的换行，读的时候能容忍');
  assert.equal(seenOldStyle.get(segmented.segments[1].id), '译2');
});

test('a card row whose own physical line ends in <br> reads back correctly, one narration line after it', () => {
  // "NOW PLAYING<br>" is a whole physical line ending in its own <br>: splitCardRows leaves an empty
  // trailing row behind it (the row after the last <br>, carrying the physical line's own separator).
  // That empty row used to make readReplaceBodyByLine's old tolerance eat a '\n' that in fact belonged to
  // the *next* boundary, breaking the read one step later. Here the whole card sits in the same unit as
  // the narration that follows it (nothing forces a boundary going from card rows back to plain text), so
  // this empty row and the translated narration share one lineParts array — the exact shape that broke.
  const source = '彼は言った。\nNOW PLAYING<br>\n彼女は答えた。';
  const options = { musicCardRules: true };
  const segmented = segmentSource(source, options);
  const translations = new Map(segmented.segments.map((segment, index) => [segment.id, `译${index + 1}`]));
  const rendered = assembleReplace(segmented.layout, translations, options);
  const restored = stripGeneratedTranslationLines(rendered);
  assert.equal(restored, source, '原文一字不差地还原');
  const seenAgain = extractReplaceTranslations(rendered, options);
  assert.equal(seenAgain.get(segmented.segments[0].id), '译1');
  assert.equal(seenAgain.get(segmented.segments[1].id), '译2', '卡片自己的空行不会被错误吞掉的换行连累，叙述句译文照常读回');
});

test('a trailing excluded block on the last narration line does not make the exact-first pass misread a legacy-joined body\'s stray \\n', () => {
  // Same card-then-narration shape as the two tests above, but the last narration line also carries a
  // trailing excluded block (<image>...</image>). On a legacy ('\n'-joined) body, line.trail's own
  // rest.indexOf used to reach straight across the stray '\n' left at the card row's own '' boundary and
  // land inside what is really the *next* semantic line's text, so the exact-first pass wrongly
  // "succeeded" with segment 2's translation missing and segment 3 holding both -- and the legacy pass,
  // which reads this shape correctly, was never even tried.
  const source = '彼は言った。\nNOW PLAYING<br>\n彼女は答えた。\n彼は笑った。<image>メモ</image>';
  const options = { musicCardRules: true, excludedTags: ['image'] };
  const segmented = segmentSource(source, options);
  const translations = new Map(segmented.segments.map((segment, index) => [segment.id, `译${index + 1}`]));
  const rendered = assembleReplace(segmented.layout, translations, options);
  const restored = stripGeneratedTranslationLines(rendered);
  assert.equal(restored, source, '原文一字不差地还原');
  const seenAgain = extractReplaceTranslations(rendered, options);
  assert.equal(seenAgain.get(segmented.segments[0].id), '译1');
  assert.equal(seenAgain.get(segmented.segments[1].id), '译2');
  assert.equal(seenAgain.get(segmented.segments[2].id), '译3', '带 <image> 尾巴的最后一句译文也能整段读回');

  const oldStyleIndex = rendered.indexOf('NOW PLAYING<br>') + 'NOW PLAYING<br>'.length;
  const oldStyle = `${rendered.slice(0, oldStyleIndex)}\n${rendered.slice(oldStyleIndex)}`;
  const seenOldStyle = extractReplaceTranslations(oldStyle, options);
  assert.equal(seenOldStyle.get(segmented.segments[0].id), '译1');
  assert.equal(seenOldStyle.get(segmented.segments[1].id), '译2', '旧写法多出来的换行不会被排除标签尾巴带偏，第二句译文没有丢');
  assert.equal(seenOldStyle.get(segmented.segments[2].id), '译3', '第三句也没有被第二句的译文挤成一段');
});

test('a card row whose own physical line ends in <br> reads back correctly, two narration lines after it', () => {
  // Same shape as above, but with two narration lines sharing the unit after the card — before the fix
  // this landed on the "two or more ids, line count mismatch" branch and read back nothing at all.
  const source = '彼は言った。\nNOW PLAYING<br>\n彼女は答えた。\n彼はうなずいた。';
  const options = { musicCardRules: true };
  const segmented = segmentSource(source, options);
  const translations = new Map(segmented.segments.map((segment, index) => [segment.id, `译${index + 1}`]));
  const rendered = assembleReplace(segmented.layout, translations, options);
  const restored = stripGeneratedTranslationLines(rendered);
  assert.equal(restored, source, '原文一字不差地还原');
  const seenAgain = extractReplaceTranslations(rendered, options);
  assert.equal(seenAgain.get(segmented.segments[0].id), '译1');
  assert.equal(seenAgain.get(segmented.segments[1].id), '译2', '两句叙述句的译文都能读回，不会因为行数对不上而整段丢失');
  assert.equal(seenAgain.get(segmented.segments[2].id), '译3');
});

// -------------------------------------------------------------------------------------------
// 控制中心 foundation (DESIGN §15): uiMode / preset settings, the rail's page list per mode, the
// one-click packages, and the connection-use helpers behind 「用在」.
// -------------------------------------------------------------------------------------------

test('uiMode migration: fresh install is normal, anything schemaVersion<=12 or missing uiMode is advanced, a current save keeps its own choice', () => {
  assert.equal(mergeSettings({}).uiMode, 'normal');
  assert.equal(mergeSettings(undefined).uiMode, 'normal');
  assert.equal(mergeSettings({ schemaVersion: 12, apiMode: 'follow' }).uiMode, 'advanced');
  assert.equal(mergeSettings({ schemaVersion: 5 }).uiMode, 'advanced');
  assert.equal(mergeSettings({ schemaVersion: 13 }).uiMode, 'advanced', 'schemaVersion 13 but no uiMode at all still reads as an old save');
  assert.equal(mergeSettings({ schemaVersion: 13, uiMode: 'normal' }).uiMode, 'normal');
  assert.equal(mergeSettings({ schemaVersion: 13, uiMode: 'advanced' }).uiMode, 'advanced');
  assert.equal(mergeSettings({ schemaVersion: 13, uiMode: 'bogus' }).uiMode, 'advanced');
  assert.equal(mergeSettings({}).schemaVersion, 13);
});

test('preset remembers the last applied package id, and drops anything unrecognised', () => {
  assert.equal(mergeSettings({}).preset, '');
  for (const id of CONSOLE_PRESET_IDS) assert.equal(mergeSettings({ preset: id }).preset, id);
  assert.equal(mergeSettings({ preset: 'made-up' }).preset, '');
});

test('pagesForMode lists the rail per DESIGN §15.1, and resolvePageForMode falls back to 翻译台', () => {
  assert.deepEqual(pagesForMode('normal'), ['main', 'finetune', 'logs']);
  assert.deepEqual(pagesForMode('advanced'), ['main', 'prompt', 'settings', 'processing', 'tts', 'logs']);
  assert.deepEqual(pagesForMode('bogus'), pagesForMode('advanced'));
  assert.equal(pageExistsInMode('tts', 'normal'), false);
  assert.equal(pageExistsInMode('tts', 'advanced'), true);
  assert.equal(pageExistsInMode('main', 'normal'), true);
  assert.equal(resolvePageForMode('tts', 'normal'), 'main', 'a page not in the new mode returns to 翻译台');
  assert.equal(resolvePageForMode('tts', 'advanced'), 'tts', 'a page that still exists stays put');
  assert.equal(resolvePageForMode('logs', 'normal'), 'logs');
  assert.deepEqual(Object.keys(CONTROL_CENTER_PAGES).sort(), [...UI_MODES].sort());
});

test('connection uses: translation and analysis resolve directly, deep defers to analysis until it has its own choice', () => {
  const settings = mergeSettings({
    apiMode: 'independent',
    channels: [
      { id: 'c1', name: '连接一', url: 'https://a', key: 'k', model: 'm' },
      { id: 'c2', name: '连接二', url: 'https://b', key: 'k', model: 'm' },
    ],
    selectedChannelId: 'c1',
    tts: { analysisChannelId: 'c2', deepChannelId: '' },
  });
  assert.equal(connectionUseChoice(settings, 'translation'), 'c1');
  assert.equal(connectionUseChoice(settings, 'analysis'), 'c2');
  assert.equal(connectionUseChoice(settings, 'deep'), 'c2', 'empty deepChannelId defers to analysis');

  const pinned = setConnectionUse(settings, 'deep', 'c1');
  assert.equal(pinned.tts.deepChannelId, 'c1');
  assert.equal(connectionUseChoice(pinned, 'deep'), 'c1');

  const followingAgain = setConnectionUse(pinned, 'deep', '');
  assert.equal(followingAgain.tts.deepChannelId, '', "setting deep back to '' returns it to following analysis");
  assert.equal(connectionUseChoice(followingAgain, 'deep'), 'c2');

  const movedTranslation = setConnectionUse(settings, 'translation', 'follow');
  assert.equal(movedTranslation.apiMode, 'follow');
  assert.equal(connectionUseChoice(movedTranslation, 'translation'), 'follow');

  const movedAnalysis = setConnectionUse(settings, 'analysis', 'c1');
  assert.equal(movedAnalysis.tts.analysisChannelId, 'c1');

  assert.deepEqual(CONNECTION_USES, ['translation', 'analysis', 'deep']);
  assert.throws(() => connectionUseChoice(settings, 'bogus'));
  assert.throws(() => setConnectionUse(settings, 'bogus', 'c1'));
});

test('channelUsesPointingAt lists every use resolving to a connection, deep included when it only defers there', () => {
  const settings = mergeSettings({
    apiMode: 'independent',
    channels: [{ id: 'c1', name: '连接一', url: 'https://a', key: 'k', model: 'm' }],
    selectedChannelId: 'c1',
    tts: { analysisChannelId: 'c1', deepChannelId: '' },
  });
  assert.deepEqual(channelUsesPointingAt(settings, 'c1'), ['translation', 'analysis', 'deep']);
  assert.deepEqual(channelUsesPointingAt(settings, 'follow'), []);
});

test('reassignConnectionUsesOnDelete moves every use a deleted connection served to 跟随酒馆, leaving a deferring deep still deferring', () => {
  const twoChannels = [
    { id: 'c1', name: '连接一', url: 'https://a', key: 'k', model: 'm' },
    { id: 'c2', name: '连接二', url: 'https://b', key: 'k', model: 'm' },
  ];
  const settings = mergeSettings({
    apiMode: 'independent',
    channels: twoChannels,
    selectedChannelId: 'c1',
    tts: { analysisChannelId: 'c1', deepChannelId: '' },
  });
  const result = reassignConnectionUsesOnDelete(settings, 'c1');
  assert.deepEqual(result.moved, ['translation', 'analysis', 'deep']);
  assert.equal(result.settings.apiMode, 'follow');
  assert.equal(result.settings.tts.analysisChannelId, 'follow');
  assert.equal(result.settings.tts.deepChannelId, '', 'deep never had its own choice, so its field is left untouched');
  assert.equal(connectionUseChoice(result.settings, 'deep'), 'follow');

  const pinnedSettings = mergeSettings({
    apiMode: 'independent',
    channels: twoChannels,
    selectedChannelId: 'c2',
    tts: { analysisChannelId: 'c2', deepChannelId: 'c1' },
  });
  const pinnedResult = reassignConnectionUsesOnDelete(pinnedSettings, 'c1');
  assert.deepEqual(pinnedResult.moved, ['deep']);
  assert.equal(pinnedResult.settings.tts.deepChannelId, 'follow');
  assert.equal(pinnedResult.settings.apiMode, 'independent', 'translation used c2, untouched by deleting c1');

  const untouched = reassignConnectionUsesOnDelete(settings, 'not-a-real-id');
  assert.deepEqual(untouched.moved, []);
  assert.equal(untouched.settings, settings, 'nothing to move returns the very same settings object');
});

test('preset content covers exactly the nine managed fields named in DESIGN §15.2 and nothing else', () => {
  assert.equal(PRESET_MANAGED_FIELDS.length, 9);
  for (const id of CONSOLE_PRESET_IDS) {
    const content = presetContent(id);
    assert.ok(content, `${id} 缺少套餐内容`);
    assert.deepEqual(Object.keys(content).sort(), PRESET_MANAGED_FIELDS.map(field => field.key).sort());
  }
  assert.equal(presetContent(''), null);
  assert.equal(presetContent('not-a-package'), null);
  assert.deepEqual(Object.keys(PRESET_LABELS).sort(), [...CONSOLE_PRESET_IDS].sort());
  for (const id of Object.keys(PRESET_TIER_LABELS)) assert.ok(CONSOLE_PRESET_IDS.includes(id));
  assert.equal(CONSOLE_PRESET_IDS.includes('audiobook') && !Object.hasOwn(PRESET_TIER_LABELS, 'audiobook'), true, '有声小说 carries no 最省/推荐/最费 pill');
});

test('applyPreset writes only the managed fields and remembers the package id; presetDrift reports what a hand edit changed', () => {
  const base = mergeSettings({});
  const audiobook = applyPreset(base, 'audiobook');
  assert.equal(audiobook.preset, 'audiobook');
  assert.equal(audiobook.tts.enabled, true);
  assert.equal(audiobook.tts.mode, 'simple');
  assert.equal(audiobook.tts.autoRead, true);
  assert.equal(audiobook.coloring.speakers, true);
  assert.equal(audiobook.coloring.effects, false, '特效字 only comes with 全都要');
  assert.equal(applyPreset(base, 'comfort').coloring.effects, false);
  assert.equal(applyPreset(base, 'everything').coloring.effects, true);
  // DESIGN §15.2's explicit 「套餐不碰」 list: none of these move.
  assert.equal(audiobook.translationOnly, base.translationOnly);
  assert.equal(audiobook.streamingWriteback, base.streamingWriteback);
  assert.equal(audiobook.theme, base.theme);
  assert.deepEqual(audiobook.channels, base.channels);

  assert.deepEqual(presetDrift(audiobook), []);
  const handEdited = { ...audiobook, coloring: { ...audiobook.coloring, speakers: false } };
  const drift = presetDrift(handEdited);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].key, 'coloringSpeakers');
  assert.equal(drift[0].label, '说话人着色');

  const restored = applyPreset(handEdited, handEdited.preset);
  assert.deepEqual(presetDrift(restored), []);
  assert.equal(restored.coloring.speakers, true);

  assert.deepEqual(presetDrift(mergeSettings({})), [], 'no package remembered means nothing to report as drifted');
  assert.throws(() => applyPreset(base, 'not-a-package'));
});

// DESIGN §15.4 折叠组: "收起时同一行写当前值摘要" — the pure half of each collapsed fold's summary line
// on the 正文处理 / 朗读 advanced pages.
test('preserveLineRuleCountLabel counts usable rules and reads "空" for none', () => {
  assert.equal(preserveLineRuleCountLabel(''), '空');
  assert.equal(preserveLineRuleCountLabel('   \n  '), '空');
  assert.equal(preserveLineRuleCountLabel('此时彼刻'), '1 条');
  assert.equal(preserveLineRuleCountLabel('此时彼刻\nprefix:【系统记录】\n/^foo/'), '3 条');
  // A line that fails to parse (an unterminated /regex/) contributes no rule, not a crash.
  assert.equal(preserveLineRuleCountLabel('/unterminated'), '空');
});

test('segmentAffixSummary reads the default 译文 { } / 原文 无 pair and any custom prefix-suffix pair', () => {
  assert.equal(segmentAffixSummary({ translationPrefix: '{', translationSuffix: '}' }), '原文 无 · 译文 { }');
  assert.equal(segmentAffixSummary({}), '原文 无 · 译文 无');
  assert.equal(
    segmentAffixSummary({ segmentPrefix: '【', segmentSuffix: '】', translationPrefix: '(', translationSuffix: ')' }),
    '原文 【 】 · 译文 ( )',
  );
  // A lone prefix or suffix (no matching other half) still reads as something, not "无".
  assert.equal(segmentAffixSummary({ segmentPrefix: '«' }), '原文 « · 译文 无');
});

test('coloringDetailFoldSummary reports the numbers actually set, falling back to DEFAULT_COLORING for a bare object', () => {
  assert.equal(
    coloringDetailFoldSummary({ minContrast: 4.5, vividness: 0.65 }),
    '对比度目标 4.5 · 彩度 0.65 · 读取当前主题与壁纸',
  );
  assert.equal(
    coloringDetailFoldSummary({}),
    '对比度目标 4.5 · 彩度 0.65 · 读取当前主题与壁纸',
  );
  assert.equal(
    coloringDetailFoldSummary({ minContrast: 7, vividness: 1 }),
    '对比度目标 7 · 彩度 1.00 · 读取当前主题与壁纸',
  );
});

// A collapsed fold used to claim 情绪起伏/名单外自动取色 were on no matter what the switches actually
// said (review finding core.js:946) — each token now only shows up when its own setting is on.
test('coloringDetailFoldSummary only lists 情绪起伏/名单外自动取色 when those switches are actually on', () => {
  assert.equal(
    coloringDetailFoldSummary({ rhythm: true, minContrast: 4.5, vividness: 0.65 }),
    '情绪起伏 · 对比度目标 4.5 · 彩度 0.65 · 读取当前主题与壁纸',
  );
  assert.equal(
    coloringDetailFoldSummary({ autoSpeakers: true, minContrast: 4.5, vividness: 0.65 }),
    '名单外自动取色 · 对比度目标 4.5 · 彩度 0.65 · 读取当前主题与壁纸',
  );
  assert.equal(
    coloringDetailFoldSummary({ rhythm: true, autoSpeakers: true, minContrast: 4.5, vividness: 0.65 }),
    '情绪起伏 · 名单外自动取色 · 对比度目标 4.5 · 彩度 0.65 · 读取当前主题与壁纸',
  );
  assert.equal(
    coloringDetailFoldSummary({ rhythm: false, autoSpeakers: false, minContrast: 4.5, vividness: 0.65 }),
    '对比度目标 4.5 · 彩度 0.65 · 读取当前主题与壁纸',
  );
});

test('quoteSymbolFoldSummary reads the default quote/skip pairs and any custom ones, "空" for no skip pairs', () => {
  assert.equal(quoteSymbolFoldSummary({}), '「」, 『』, “”, "" · 空');
  assert.equal(
    quoteSymbolFoldSummary({ quotePairs: '“”', skipPairs: '** **, （）' }),
    '“” · ** **, （）',
  );
});

test('fishParamsFoldSummary reads format, speed and concurrency', () => {
  assert.equal(fishParamsFoldSummary({ format: 'mp3', speed: 1, concurrency: 2 }), 'mp3 · 语速 1 · 同时生成 2 段');
  assert.equal(fishParamsFoldSummary({ format: 'wav', speed: 0.8, concurrency: 1 }), 'wav · 语速 0.8 · 同时生成 1 段');
});

test('consoleFoldSummary reads "AI 判断" until a slider leaves 50, then counts what moved, plus the mark count', () => {
  assert.equal(consoleFoldSummary(DEFAULT_CONSOLE), 'AI 判断 · 标点情绪标签 0 条');
  assert.equal(consoleFoldSummary({ ...DEFAULT_CONSOLE, pause: 75 }), '1 项已设定 · 标点情绪标签 0 条');
  assert.equal(
    consoleFoldSummary({ ...DEFAULT_CONSOLE, pause: 75, speed: 0, marks: [{ punct: '！！', tag: '加大音量', at: 'head' }] }),
    '2 项已设定 · 标点情绪标签 1 条',
  );
});

test('voiceLibraryFoldSummary counts voices with a usable id and reads "空" for none', () => {
  assert.equal(voiceLibraryFoldSummary(undefined), '空');
  assert.equal(voiceLibraryFoldSummary([]), '空');
  assert.equal(voiceLibraryFoldSummary([{ id: 'a', name: '少女', voiceId: '' }]), '空');
  assert.equal(voiceLibraryFoldSummary([{ id: 'a', name: '少女', voiceId: 'voice-a' }]), '1 个音色');
  assert.equal(
    voiceLibraryFoldSummary([
      { id: 'a', name: '少女', voiceId: 'voice-a' },
      { id: 'b', name: '老人', voiceId: 'voice-b' },
    ]),
    '2 个音色',
  );
});

// --- channelRequestFoldSummary / channelPostscriptFoldSummary ---------------------------------
// DESIGN §15.4: 模型连接 每条连接卡的「请求参数」「后置提示词」became .jy-fold groups, matching every
// other advanced-mode fold's collapsed-row summary (review: they used to be plain <details> with no
// summary at all, so a collapsed card said nothing about what was actually set).

test('channelRequestFoldSummary always reads timeout/limit/temperature, falling back to DEFAULT_CHANNEL for a bare object', () => {
  assert.equal(channelRequestFoldSummary({}), '超时 240s · 上限 60000 tokens · 温度 0.15');
  assert.equal(
    channelRequestFoldSummary({ timeoutSec: 60, maxTokens: 4096, temperature: 1 }),
    '超时 60s · 上限 4096 tokens · 温度 1',
  );
});

test('channelRequestFoldSummary only lists 并发/推理强度/排除参数/节约模式 when actually set', () => {
  assert.equal(
    channelRequestFoldSummary({ timeoutSec: 240, maxTokens: 60000, temperature: 0.15, concurrency: 1 }),
    '超时 240s · 上限 60000 tokens · 温度 0.15',
    '并发批次为 1（默认）时不单独列出',
  );
  assert.equal(
    channelRequestFoldSummary({
      timeoutSec: 240,
      maxTokens: 60000,
      temperature: 0.15,
      concurrency: 3,
      reasoningEffort: 'high',
      excludeParams: ['temperature', 'top_p'],
      tokenSaving: true,
    }),
    '超时 240s · 上限 60000 tokens · 温度 0.15 · 并发 3 · 推理强度 high · 排除 2 项 · 节约 token 模式',
  );
});

test('channelPostscriptFoldSummary reads role and whether the postscript text is set, with its length', () => {
  assert.equal(channelPostscriptFoldSummary({}), 'user · 未设置');
  assert.equal(channelPostscriptFoldSummary({ postscriptRole: 'system', postscript: '  ' }), 'system · 未设置', '只有空白也算未设置');
  assert.equal(
    channelPostscriptFoldSummary({ postscriptRole: 'system', postscript: '直接输出结果，不要输出任何思考过程。' }),
    'system · 已设置（18 字）',
  );
  assert.equal(channelPostscriptFoldSummary({ postscriptRole: 'bogus', postscript: '' }), 'user · 未设置', '未知身份回退到 user');
});

test('a one-beat hiragana moan drawn through a glide into another vowel before ん is accepted on a second echo, names still are not', async () => {
  const { looksUntranslated, isShortExactEcho } = await import('../core.js');
  for (const line of ['ひゃうん', 'きゃうん', 'ひゃいん', 'きゃいん', 'ふぁうん', 'あっ、ひゃうん', 'ひゃ、ひゃうん']) {
    assert.equal(looksUntranslated(line, line), true, `${line} still gets one real translation attempt`);
    assert.equal(isShortExactEcho(line, line), true, `${line} is a moan, accepted on a second identical echo`);
  }
  for (const line of ['アン', 'ケン', 'カン', 'オーエン', 'はっけん', 'けん', 'かん']) {
    assert.equal(isShortExactEcho(line, line), false, `${line} is a name or a word, never accepted as an echo`);
  }
});

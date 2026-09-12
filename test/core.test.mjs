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
  parseTagNames,
  parseTagNamesWithErrors,
  parseStructuredTranslations,
  recoverStructuredTranslations,
  rebuildTaggedRegion,
  rebuildTaggedRegions,
  segmentSource,
  restyleBilingual,
  stripGeneratedTranslationLines,
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
  assert.equal(independent.schemaVersion, 12);
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
  ] });
  const recovered = recoverStructuredTranslations(raw, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.deepEqual([...recovered.translations.values()], ['「你到底在想什么！」', '……我不知道。', '窗外还在下雨。']);
  assert.deepEqual(recovered.annotations.get(1), { speaker: '英梨梨', emotion: 'angry', intensity: 2 });
  assert.deepEqual(recovered.annotations.get(2), { speaker: '加藤', emotion: 'hesitant' });
  assert.equal(recovered.annotations.has(3), false, '没有标注的段落不该凭空得到一条');
  assert.equal(recovered.response.annotatedItems, 2);
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

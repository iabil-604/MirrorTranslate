import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APP_VERSION,
  DEFAULT_SETTINGS,
  INVISIBLE_MARKER,
  assembleBilingual,
  createTranslationSignature,
  createGenerationGate,
  createIndependentRequest,
  extractGeneratedTranslations,
  extractTaggedRegion,
  extractTaggedRegions,
  interceptGenerationChat,
  inspectTagConfiguration,
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
  stripGeneratedTranslationLines,
} from '../core.js';
import {
  addDiagnostic,
  formatDiagnosticReport,
  formatFullDiagnosticReport,
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
  assert.equal(independent.schemaVersion, 11);
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
  assert.match(inspectTagConfiguration('<story_scene>未闭合', ['story_scene'], []).errors[0], /没有对应的结束标签/);
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
  assert.match(entry, /copy-full-logs/);
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

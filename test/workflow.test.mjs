import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS, INVISIBLE_MARKER, mergeSettings } from '../core.js';
import { DEFAULT_PROMPT_PROFILE } from '../prompts.js';
import { buildTranslationMessages, collectTranslationContext } from '../workflow.js';

test('translation context carries display names, active worldbook and clean recent chat', async () => {
  let scanReceived = null;
  const context = {
    name1: '玩家',
    name2: '樱井',
    characterId: 0,
    groupId: null,
    maxContext: 8192,
    characters: [{ name: '樱井', description: '旅行者。' }],
    substituteParams: value => value,
    chat: [
      { is_user: true, name: '玩家', mes: '桜井を呼んだ。' },
      { is_user: false, name: '樱井', mes: `「はい」\n{${INVISIBLE_MARKER}“好。”}` },
      { is_user: false, name: '樱井', mes: '<story_scene>\n桜井は振り返った。\n</story_scene>' },
    ],
    async getWorldInfoPrompt(scan) {
      scanReceived = scan;
      return {
        worldInfoBefore: '桜井的中文写法是樱井。',
        worldInfoAfter: '',
        worldInfoDepth: [{ entries: ['舞台是王都。'] }],
      };
    },
  };
  const snapshot = { context, messageId: 2 };
  const settings = mergeSettings({
    ...DEFAULT_SETTINGS,
    promptProfiles: [{ ...DEFAULT_PROMPT_PROFILE, glossary: '桜井 = 樱井' }],
    contextMessages: 3,
  });
  const packet = await collectTranslationContext(snapshot, settings);

  assert.match(packet.character, /角色显示名：樱井/);
  assert.match(packet.character, /旅行者/);
  assert.match(packet.worldbook, /中文写法是樱井/);
  assert.match(packet.worldbook, /舞台是王都/);
  assert.doesNotMatch(packet.recent, new RegExp(INVISIBLE_MARKER));
  assert.equal(scanReceived[0].startsWith('樱井: <story_scene>'), true);
});

test('translation messages use a compact prelude, specification, checklist and one data packet', () => {
  const settings = mergeSettings({
    promptProfiles: [{
      ...DEFAULT_PROMPT_PROFILE,
      jailbreakPrompt: '用户提供的前置提示词。',
      glossary: '桜井 = 樱井',
    }],
  });
  const messages = buildTranslationMessages(
    [
      { id: 7, text: '桜井は笑った。' },
      { id: 8, text: '窓を開けた。' },
      { id: 9, text: '風が吹いた。' },
    ],
    settings,
    { glossary: '桜井 = 樱井', character: '角色显示名：樱井', worldbook: '王都。', recent: '前文。' },
  );
  assert.equal(messages.length, 4);
  assert.equal(messages[0].content, '用户提供的前置提示词。');
  assert.match(messages[1].content, /# 翻译文风/);
  assert.match(messages[2].content, /<thinking>/);
  assert.match(messages[2].content, /本次启用的自定义规则/);
  assert.match(messages[2].content, /没有对应现象的规则本轮不适用/);
  assert.equal(messages.at(-1).role, 'user');
  const input = JSON.parse(messages.at(-1).content);
  assert.equal(input.mode, 'primary');
  assert.deepEqual(input.segments, [
    { id: 7, text: '桜井は笑った。' },
    { id: 8, text: '窓を開けた。' },
    { id: 9, text: '風が吹いた。' },
  ]);
  assert.deepEqual(Object.keys(input).sort(), ['mode', 'references', 'segments', 'source_language', 'target_language', 'task']);
  assert.equal(input.source_language, 'auto-detect-per-segment');
  assert.equal(input.target_language, '简体中文');
  assert.equal(input.task, 'translate_story_to_target_language');
  assert.equal(input.references.glossary, '桜井 = 樱井');
  assert.equal(input.references.worldbook, '王都。');
  assert.doesNotMatch(`${messages[1].content}\n${messages[2].content}`, /story_scene|排除标签|前后缀|写回楼层|隐藏标记/);
  const withoutPrelude = buildTranslationMessages([{ id: 1, text: '雨。' }], mergeSettings({
    promptProfiles: [{ ...DEFAULT_PROMPT_PROFILE, jailbreakPrompt: '' }],
  }), {});
  assert.equal(withoutPrelude.length, 3);
});

test('profile target language is reflected in all prompt layers and the request packet', () => {
  const settings = mergeSettings({
    promptProfiles: [{
      ...DEFAULT_PROMPT_PROFILE,
      targetLanguage: 'English',
      jailbreakPrompt: 'Translate toward {{target_language}}.',
      checklistPrompt: 'Check {{translation_direction}} before JSON.',
      styleMode: 'custom',
      styleCustom: 'Use concise English prose.',
    }],
  });
  const messages = buildTranslationMessages([{ id: 1, text: '雨が降る。' }], settings);
  assert.equal(messages[0].content, 'Translate toward English.');
  assert.match(messages[1].content, /翻译为 English/);
  assert.match(messages[1].content, /Use concise English prose/);
  assert.equal(messages[2].content, 'Check 原文语言到English before JSON.');
  assert.equal(JSON.parse(messages[3].content).target_language, 'English');
});

test('style repair carries only the draft and phrases needed for one correction', () => {
  const messages = buildTranslationMessages(
    [{ id: 2, text: '彼女は見た。' }],
    mergeSettings(),
    {},
    'style_repair',
    { draftTranslations: [{ id: 2, text: '她眸光一闪。' }], triggeredPhrases: ['眸光'] },
  );
  const input = JSON.parse(messages.at(-1).content);
  assert.equal(input.mode, 'style_repair');
  assert.deepEqual(input.draft_translations, [{ id: 2, text: '她眸光一闪。' }]);
  assert.deepEqual(input.triggered_phrases, ['眸光']);
});

test('postscript rides as the final message when set and stays absent when empty', () => {
  const quiet = buildTranslationMessages([{ id: 1, text: '雨。' }], mergeSettings());
  assert.equal(quiet.at(-1).role, 'user');
  assert.doesNotMatch(quiet.at(-1).content, /记住这些写法/);

  const settings = mergeSettings({
    promptProfiles: [{ ...DEFAULT_PROMPT_PROFILE, postscript: '记住这些写法，译名保持统一。', postscriptRole: 'system' }],
  });
  const messages = buildTranslationMessages([{ id: 1, text: '雨。' }], settings);
  assert.equal(messages.length, 4);
  assert.equal(messages.at(-1).role, 'system');
  assert.equal(messages.at(-1).content, '记住这些写法，译名保持统一。');
});

test('token-saving mode injects only the whitelist and caps recent context at two floors', async () => {
  const context = {
    name1: '玩家', name2: '樱井', characterId: 0, groupId: null,
    characters: [{ name: '樱井', description: '旅行者。' }],
    substituteParams: value => value,
    chat: [
      { is_user: false, name: '樱井', mes: '一楼层。' },
      { is_user: false, name: '樱井', mes: '二楼层。' },
      { is_user: false, name: '樱井', mes: '三楼层。' },
      { is_user: false, name: '樱井', mes: '四楼层。' },
    ],
    async getWorldInfoPrompt() { throw new Error('不应在世界书扫描中出现'); },
  };
  const snapshot = { context, messageId: 4 };
  const settings = mergeSettings({
    ...DEFAULT_SETTINGS,
    channels: [{ id: 'c1', url: 'https://example.com/v1', key: 'k', model: 'm', tokenSaving: true }],
    selectedChannelId: 'c1',
    contextMessages: 6,
  });
  const packet = await collectTranslationContext(snapshot, settings, '白名单世界书内容。');
  assert.equal(packet.worldbook, '白名单世界书内容。');
  assert.doesNotMatch(packet.recent, /一楼层/);
  assert.match(packet.recent, /三楼层/);
  assert.match(packet.recent, /四楼层/);
});

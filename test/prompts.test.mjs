import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePromptProfile } from '../core.js';
import {
  DEFAULT_JAILBREAK_PROMPT,
  DEFAULT_PROMPT_PROFILE,
  PRE_OUTPUT_CHECKLIST,
  composeTranslationSpecification,
  countPromptCharacters,
  findForbiddenPhraseHits,
  isSimplifiedChineseTarget,
  resolvePromptVariables,
} from '../prompts.js';

test('default prompt profile leaves the optional prelude empty and composes one coherent specification', () => {
  const profile = normalizePromptProfile(DEFAULT_PROMPT_PROFILE);
  const prompt = composeTranslationSpecification(profile);
  assert.equal(DEFAULT_JAILBREAK_PROMPT, '');
  assert.equal(profile.jailbreakPrompt, DEFAULT_JAILBREAK_PROMPT);
  assert.match(prompt, /# 任务/);
  assert.match(prompt, /Narrative Translation Specification/);
  assert.match(prompt, /# 翻译文风/);
  assert.match(prompt, /中文轻小说/);
  assert.match(prompt, /# 禁用表达/);
  assert.match(prompt, /"translations"/);
  assert.match(prompt, /<thinking>/);
  assert.match(PRE_OUTPUT_CHECKLIST, /本次启用的自定义规则/);
  assert.match(PRE_OUTPUT_CHECKLIST, /不按 id 逐项写报告/);
  assert.doesNotMatch(prompt, /程序会负责显示格式/);
  assert.doesNotMatch(prompt, /story_scene|排除标签|写回楼层|花括号/);
  assert.ok(countPromptCharacters(profile) >= prompt.length);
});

test('variable sections stay between the core rules and the output protocol anchor', () => {
  const profile = normalizePromptProfile({
    ...DEFAULT_PROMPT_PROFILE,
    customSections: [{ id: 'battle', title: '战斗场景', content: '短句优先。', enabled: true }],
  });
  const prompt = composeTranslationSpecification(profile);
  const outputIndex = prompt.indexOf('# 9. 输出协议');
  assert.ok(outputIndex > 0, '核心规范必须保留 # 9. 输出协议 锚点，否则用户条目会被拼到输出协议之后');
  assert.ok(prompt.indexOf('# 翻译文风') < outputIndex);
  assert.ok(prompt.indexOf('# 战斗场景') < outputIndex);
  assert.ok(prompt.indexOf('# 任务') < prompt.indexOf('# 翻译文风'));
});

test('target-language variables resolve and non-Chinese targets use the generic core plus custom rules', () => {
  const profile = normalizePromptProfile({
    ...DEFAULT_PROMPT_PROFILE,
    targetLanguage: '한국어',
    customSections: [{ id: 'tone', title: '문체', content: '{{target_language}}使用自然对白。', enabled: true }],
  });
  const prompt = composeTranslationSpecification(profile);
  assert.equal(isSimplifiedChineseTarget(profile.targetLanguage), false);
  assert.match(prompt, /翻译为 한국어/);
  assert.match(prompt, /한국어使用自然对白/);
  assert.doesNotMatch(prompt, /中文轻小说|眸光|\{\{target_language\}\}/);
  assert.equal(resolvePromptVariables('{{translation_direction}}', profile), '原文语言到한국어');
});

test('custom options and enabled custom sections are merged in visible order', () => {
  const profile = normalizePromptProfile({
    ...DEFAULT_PROMPT_PROFILE,
    styleMode: 'custom',
    styleCustom: '使用测试文风。',
    customSections: [
      { id: 'a', title: '战斗场景', content: '短句优先。', enabled: true },
      { id: 'b', title: '停用项', content: '不应出现。', enabled: false },
    ],
  });
  const prompt = composeTranslationSpecification(profile);
  assert.match(prompt, /使用测试文风/);
  assert.match(prompt, /# 战斗场景\n短句优先/);
  assert.doesNotMatch(prompt, /不应出现/);
});

test('absolute forbidden phrases are detected per completed segment', () => {
  const profile = normalizePromptProfile({ ...DEFAULT_PROMPT_PROFILE, forbiddenPhrases: '眸光\n涟漪' });
  const hits = findForbiddenPhraseHits(new Map([
    [1, '她的眸光移向窗外。'],
    [2, '他的心中泛起涟漪。'],
    [3, '她看向窗外。'],
  ]), profile);
  assert.deepEqual(hits, [
    { id: 1, phrases: ['眸光'] },
    { id: 2, phrases: ['涟漪'] },
  ]);
});

test('translation leanings are their own item and combine with any style', async () => {
  const { STYLE_PRESETS, LEANING_PRESETS } = await import('../prompts.js');
  assert.deepEqual(Object.keys(STYLE_PRESETS), ['light_novel', 'strict_mirror', 'plain']);
  const labels = Object.values(LEANING_PRESETS).map(preset => preset.label);
  assert.equal(new Set(labels).size, labels.length, '倾向名称不能重复');

  const unset = composeTranslationSpecification(normalizePromptProfile(DEFAULT_PROMPT_PROFILE));
  assert.doesNotMatch(unset, /# 翻译倾向/, '不指定时不应出现倾向栏目');

  for (const key of Object.keys(LEANING_PRESETS).filter(item => item !== 'none')) {
    const profile = normalizePromptProfile({ ...DEFAULT_PROMPT_PROFILE, styleMode: 'plain', leaningMode: key });
    assert.equal(profile.styleMode, 'plain');
    assert.equal(profile.leaningMode, key);
    const spec = composeTranslationSpecification(profile);
    const style = spec.indexOf('# 翻译文风');
    const leaning = spec.indexOf('# 翻译倾向');
    assert.ok(style >= 0 && leaning > style, `${key}：文风和倾向应当同时出现，文风在前`);
    assert.ok(spec.includes(LEANING_PRESETS[key].prompt), `${key} 没有进入规范`);
    assert.ok(leaning < spec.indexOf('# 9. 输出协议'), `${key} 应当排在输出协议之前`);
  }

  const custom = composeTranslationSpecification(normalizePromptProfile({
    ...DEFAULT_PROMPT_PROFILE,
    leaningMode: 'custom',
    leaningCustom: '原文是港漫，粗口保留力度。',
  }));
  assert.match(custom, /# 翻译倾向\n原文是港漫，粗口保留力度。/);
});

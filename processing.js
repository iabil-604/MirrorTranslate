import {
  DEFAULT_SETTINGS, MODULE_ID, SOURCE_START, SOURCE_END, TRANSLATION_START, TRANSLATION_END, AFFIX_START, AFFIX_END, HIDDEN_START, HIDDEN_END,
  deepClone, mergeSettings, parseTagNamesWithErrors, parsePreserveLineRulesWithErrors,
} from './core.js?v=0.13.1';

export const PROCESSING_FIELDS = Object.freeze([
  'bodyTags', 'replaceTags', 'excludedTags', 'preserveLineRules', 'segmentPrefix', 'segmentSuffix',
  'translationPrefix', 'translationSuffix', 'autoEdit', 'showFloatingButton', 'floatingStyle',
]);
export const VISUAL_FIELDS = Object.freeze(['segmentPrefix', 'segmentSuffix', 'translationPrefix', 'translationSuffix']);
export const PROCESSING_FORMAT = 'jingyi-processing-profile';
export const REGEX_OWNER_KEY = 'jingyi_managed';
const MAX_PROFILES = 40;
const MAX_RULES = 100;

export function processingId() {
  return globalThis.crypto?.randomUUID?.() || `jy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function processingSnapshot(settings) {
  return Object.fromEntries(PROCESSING_FIELDS.map(key => [key, deepClone(settings[key] ?? DEFAULT_SETTINGS[key])]));
}

function normalizeProcessingValues(value = {}, strict = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('正文方案的设置格式不正确。');
  const values = {};
  for (const key of PROCESSING_FIELDS) {
    if (!Object.hasOwn(value, key)) continue;
    if (key === 'bodyTags' || key === 'replaceTags' || key === 'excludedTags') {
      const parsed = parseTagNamesWithErrors(value[key]);
      if (strict && (parsed.invalid.length || (key === 'bodyTags' && !parsed.tags.length))) throw new Error(`方案的 ${key} 需要有效标签名。`);
      values[key] = parsed.tags;
    } else {
      if (typeof value[key] !== typeof DEFAULT_SETTINGS[key]) throw new Error(`方案字段格式不正确：${key}`);
      values[key] = value[key];
    }
  }
  if (strict) {
    const errors = parsePreserveLineRulesWithErrors(values.preserveLineRules).errors;
    if (errors.length) throw new Error(errors.join(' '));
    if (values.floatingStyle && !['auto', 'ring', 'pill', 'edge'].includes(values.floatingStyle)) throw new Error('悬浮入口形态无效。');
  }
  return processingSnapshot(mergeSettings({ ...DEFAULT_SETTINGS, ...values }));
}

// Native regex JSON dialect. The fields stay native, including unknown future fields.
// Exact authority: SillyTavern 1.18.0, 8172dcd, extensions/regex/{engine,index}.js.
export function compileNativeRegex(value) {
  const literal = String(value).match(/^\/(.*)\/([dgimsuvy]*)$/s);
  return literal ? new RegExp(literal[1], literal[2]) : new RegExp(value, 'g');
}

export function normalizeNativeRegex(value, { newId = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.scriptName !== 'string' || !value.scriptName.trim()
    || typeof value.findRegex !== 'string' || !value.findRegex
    || typeof value.replaceString !== 'string') throw new Error('请选择酒馆原生导出的正则 JSON（需要名称、查找和替换内容）。');
  try { compileNativeRegex(value.findRegex); } catch { throw new Error(`「${value.scriptName}」的查找正则无效。`); }
  if (!Array.isArray(value.placement) || !value.placement.length || !value.placement.every(Number.isInteger)) throw new Error(`「${value.scriptName}」缺少有效的作用位置。`);
  if (value.trimStrings !== undefined && (!Array.isArray(value.trimStrings) || !value.trimStrings.every(item => typeof item === 'string'))) throw new Error('正则的 trimStrings 必须是文字列表。');
  for (const key of ['disabled', 'markdownOnly', 'promptOnly', 'runOnEdit']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error(`正则字段 ${key} 必须是开关。`);
  }
  for (const key of ['minDepth', 'maxDepth']) {
    if (value[key] != null && (!Number.isInteger(value[key]) || value[key] < -1)) throw new Error(`正则字段 ${key} 无效。`);
  }
  if (value.minDepth >= 0 && value.maxDepth >= 0 && value.minDepth != null && value.maxDepth != null && value.minDepth > value.maxDepth) throw new Error('正则的最小深度不能大于最大深度。');
  const rule = deepClone(value);
  delete rule[REGEX_OWNER_KEY];
  // Avoid importing object-prototype keys while retaining ordinary future regex fields.
  delete rule.__proto__; delete rule.constructor; delete rule.prototype;
  rule.id = newId || typeof rule.id !== 'string' || !rule.id ? processingId() : rule.id;
  return rule;
}

export function importNativeRegex(data) {
  const values = Array.isArray(data) ? data : [data];
  if (!values.length || values.length > MAX_RULES) throw new Error(`一次可以导入 1 至 ${MAX_RULES} 条正则。`);
  return values.map(value => normalizeNativeRegex(value, { newId: true }));
}

export function normalizeProcessingProfile(value, { newId = false, strict = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('正文方案格式不正确。');
  if (value.regexScripts !== undefined && !Array.isArray(value.regexScripts)) throw new Error('方案中的正则需要使用列表格式。');
  if ((value.regexScripts?.length ?? 0) > MAX_RULES) throw new Error(`每套方案最多绑定 ${MAX_RULES} 条正则。`);
  const usedIds = new Set();
  const regexScripts = (value.regexScripts ?? []).map(rule => {
    const next = normalizeNativeRegex(rule, { newId });
    if (usedIds.has(next.id)) next.id = processingId();
    usedIds.add(next.id);
    return next;
  });
  return {
    id: newId || typeof value.id !== 'string' || !value.id ? processingId() : value.id,
    name: String(value.name || '正文方案').trim().slice(0, 80) || '正文方案',
    settings: normalizeProcessingValues(value.settings, strict),
    regexScripts,
  };
}

export function normalizeProcessingSettings(value) {
  const settings = mergeSettings(value);
  const input = Array.isArray(settings.processingProfiles) && settings.processingProfiles.length
    ? settings.processingProfiles
    : [{ id: 'processing-default', name: '默认', settings: processingSnapshot(settings), regexScripts: [] }];
  const ids = new Set();
  if (input.length > MAX_PROFILES) throw new Error(`最多保存 ${MAX_PROFILES} 套正文方案。`);
  settings.processingProfiles = input.map(profile => {
    const next = normalizeProcessingProfile(profile);
    if (ids.has(next.id)) next.id = processingId();
    ids.add(next.id);
    return next;
  });
  if (!ids.has(settings.selectedProcessingProfileId)) settings.selectedProcessingProfileId = settings.processingProfiles[0].id;
  return settings;
}

export function getActiveProcessingProfile(settings) {
  return settings.processingProfiles.find(profile => profile.id === settings.selectedProcessingProfileId) || settings.processingProfiles[0];
}

export function captureProcessingProfile(settings) {
  getActiveProcessingProfile(settings).settings = processingSnapshot(settings);
  return settings;
}

export function selectProcessingProfile(settings, id) {
  const next = normalizeProcessingSettings(settings);
  captureProcessingProfile(next);
  const selected = next.processingProfiles.find(profile => profile.id === id);
  if (!selected) throw new Error('没有找到这个正文方案。');
  next.selectedProcessingProfileId = id;
  Object.assign(next, deepClone(selected.settings));
  return next;
}

export function exportProcessingProfile(profile) {
  const normalized = normalizeProcessingProfile(profile);
  return { format: PROCESSING_FORMAT, version: 1, profile: { name: normalized.name, settings: normalized.settings, regexScripts: normalized.regexScripts } };
}

export function importProcessingProfile(data) {
  if (data?.format !== PROCESSING_FORMAT || data.version !== 1) throw new Error('请选择镜译导出的正文方案文件。');
  return normalizeProcessingProfile(data.profile, { newId: true, strict: true });
}

export function syncNativeRegex(existing, profile) {
  const originals = Array.isArray(existing) ? existing : [];
  const managed = profile ? profile.regexScripts.map(rule => ({
    ...deepClone(rule),
    id: `${MODULE_ID}:${profile.id}:${rule.id}`,
    scriptName: `镜译 · ${profile.name} · ${rule.scriptName}`,
    [REGEX_OWNER_KEY]: { owner: MODULE_ID, profileId: profile.id, ruleId: rule.id },
  })) : [];
  const first = originals.findIndex(rule => rule?.[REGEX_OWNER_KEY]?.owner === MODULE_ID && !rule[REGEX_OWNER_KEY].internal);
  const kept = originals.filter(rule => rule?.[REGEX_OWNER_KEY]?.owner !== MODULE_ID);
  const insertion = first < 0 ? kept.length : originals.slice(0, first).filter(rule => rule?.[REGEX_OWNER_KEY]?.owner !== MODULE_ID).length;
  kept.splice(insertion, 0, ...managed);
  if (profile) kept.unshift({
    id: `${MODULE_ID}:display-boundaries`, scriptName: '镜译 · 显示边界清理',
    findRegex: `/${[SOURCE_START, SOURCE_END, TRANSLATION_START, TRANSLATION_END, AFFIX_START, AFFIX_END].join('|')}/g`,
    replaceString: '', trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false,
    runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null,
    [REGEX_OWNER_KEY]: { owner: MODULE_ID, internal: true },
  }, {
    // Replace-tag regions: the hidden original vanishes from the rendered floor but stays in mes.
    id: `${MODULE_ID}:hidden-source`, scriptName: '镜译 · 隐藏原文块',
    findRegex: `/\\n?${HIDDEN_START}[\\s\\S]*?${HIDDEN_END}/g`,
    replaceString: '', trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false,
    runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null,
    [REGEX_OWNER_KEY]: { owner: MODULE_ID, internal: true },
  });
  return kept;
}

export function readNativeRegexEdits(existing, profile) {
  return (Array.isArray(existing) ? existing : [])
    .filter(rule => rule?.[REGEX_OWNER_KEY]?.owner === MODULE_ID && rule[REGEX_OWNER_KEY].profileId === profile.id)
    .map(rule => {
      const namePrefix = `镜译 · ${profile.name} · `;
      return normalizeNativeRegex({ ...rule, id: rule[REGEX_OWNER_KEY].ruleId,
        scriptName: rule.scriptName.startsWith(namePrefix) ? rule.scriptName.slice(namePrefix.length) : rule.scriptName });
    });
}

const readingPattern = '<jy-source>([\\s\\S]*?)<\\/jy-source>\\n<jy-translation>([\\s\\S]*?)<\\/jy-translation>';
export const BUILTIN_READING_STYLES = Object.freeze([
  { id: 'cute', name: '可爱风', description: '一点桃粉，一枚小花。' },
  { id: 'minimal', name: '极简风', description: '淡化原文，留白分隔。' },
  { id: 'fold', name: '原文折叠', description: '原文可展开，译文缩进。' },
]);

export function makeBuiltinReadingProfile(settings, styleId) {
  const style = BUILTIN_READING_STYLES.find(item => item.id === styleId);
  if (!style) throw new Error('没有找到这个内置美化。');
  const before = styleId === 'fold'
    ? '<details class="jy-reading-original"><summary>原文</summary><div class="jy-reading-source">\n\n$1\n\n</div></details>'
    : '<div class="jy-reading-source">\n\n$1\n\n</div>';
  return normalizeProcessingProfile({
    id: processingId(), name: style.name,
    settings: { ...processingSnapshot(settings), segmentPrefix: '<jy-source>', segmentSuffix: '</jy-source>', translationPrefix: '<jy-translation>', translationSuffix: '</jy-translation>' },
    regexScripts: [{
      id: processingId(), scriptName: style.name,
      findRegex: `/${readingPattern}/g`,
      replaceString: `<div class="jy-reading jy-reading-${styleId}">\n${before}\n<div class="jy-reading-translation">\n\n$2\n\n</div>\n</div>`,
      trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false,
      runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null,
    }],
  });
}

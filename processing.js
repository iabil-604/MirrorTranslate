import {
  DEFAULT_SETTINGS, MODULE_ID, SOURCE_START, SOURCE_END, TRANSLATION_START, TRANSLATION_END, AFFIX_START, AFFIX_END, HIDDEN_START, HIDDEN_END,
  deepClone, mergeSettings, parseTagNamesWithErrors, parsePreserveLineRulesWithErrors, parseLyricLineRulesWithErrors,
} from './core.js?v=0.40.2';

export const PROCESSING_FIELDS = Object.freeze([
  'bodyTags', 'replaceTags', 'excludedTags', 'preserveLineRules', 'segmentPrefix', 'segmentSuffix',
  'translationPrefix', 'translationSuffix', 'autoEdit', 'showFloatingButton', 'floatingStyle',
  'lyricLineRules', 'musicCardRules',
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
    const lyricErrors = parseLyricLineRulesWithErrors(values.lyricLineRules).errors;
    if (lyricErrors.length) throw new Error(lyricErrors.join(' '));
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
    const next = migrateLegacyReadingRule(normalizeNativeRegex(rule, { newId }));
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

// SillyTavern's own regex editor rebuilds a script from its own form fields whenever the reader
// opens one of ours and presses Save, even with nothing changed, and that rebuilt object carries
// none of our unknown fields -- jingyi_managed included (SillyTavern 1.18.0, extensions/regex/
// index.js: the editor's popup builds `newRegexScript` from scratch off the form, and
// saveRegexScript's `array[existingScriptIndex] = regexScript` swaps in the whole new object). The
// id is the one part of that swap the host keeps: the editor reuses `existingId` for a script it
// already knows, so a rule that lost its marker this way still carries the id we minted for it. A
// rule recognised only by the marker, then, is one crash away (any host rewrite that drops unknown
// fields) from being mistaken for the reader's own on the very next sync and getting a second copy
// installed beside it -- which is how "镜译 · 可爱风 2 · 可爱风" ends up six deep in a real global
// list: six times the reader opened it in 酒馆's own editor and saved, six orphaned copies stayed
// behind, unrecognisable, while a fresh one grew beside each. The id prefix is checked first for
// that reason: nothing else could carry it, so it is trusted even where the marker is gone.
function hasManagedRegexId(id) {
  return typeof id === 'string' && id.startsWith(`${MODULE_ID}:`);
}
export function isJingyiRegex(rule) {
  return Boolean(rule) && (rule?.[REGEX_OWNER_KEY]?.owner === MODULE_ID || hasManagedRegexId(rule.id));
}
// A managed rule's id is `${MODULE_ID}:${profileId}:${ruleId}`; a fixed rule's is `${MODULE_ID}:`
// plus one bare word with no colon in it (see the ids below and in speechQuoteRules/speechMarkRule/
// PROMPT_GUARD_RULES). Kept purely as a fallback for readNativeRegexEdits when the marker carrying
// the same pair is gone.
function parseManagedRegexId(id) {
  if (!hasManagedRegexId(id)) return null;
  const rest = id.slice(MODULE_ID.length + 1);
  const sep = rest.indexOf(':');
  return sep < 0 ? null : { profileId: rest.slice(0, sep), ruleId: rest.slice(sep + 1) };
}

export function syncNativeRegex(existing, profile) {
  const originals = Array.isArray(existing) ? existing : [];
  const managed = profile ? profile.regexScripts.map(rule => ({
    ...deepClone(rule),
    id: `${MODULE_ID}:${profile.id}:${rule.id}`,
    scriptName: `镜译 · ${profile.name} · ${rule.scriptName}`,
    [REGEX_OWNER_KEY]: { owner: MODULE_ID, profileId: profile.id, ruleId: rule.id },
  })) : [];
  const fixed = profile ? [{
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
  }, ...speechQuoteRules(), speechMarkRule(), ...PROMPT_GUARD_RULES] : [];
  const fixedIds = new Set(fixed.map(rule => rule.id));
  const isFixed = rule => fixedIds.has(rule?.id) || Boolean(rule?.[REGEX_OWNER_KEY]?.internal);
  const first = originals.findIndex(rule => isJingyiRegex(rule) && !isFixed(rule));
  const kept = originals.filter(rule => !isJingyiRegex(rule));
  const insertion = first < 0 ? kept.length : originals.slice(0, first).filter(rule => !isJingyiRegex(rule)).length;
  kept.splice(insertion, 0, ...managed);
  kept.unshift(...fixed);
  return kept;
}

// A mark encloses one line of dialogue, so the quotation marks inside it belong together. A model that
// opens with 「 and closes with the " it has just been writing in who="" and mood="" leaves 「台词" on
// the floor. Mended where the floor is drawn and where the main model reads its own past replies, so
// it is neither shown nor copied; the floor as saved is not touched. Only the plain case, a quotation
// with nothing else quoted inside it, on one line. These run before the marks are hidden, while the
// marks still say where the line ends. The reading mends its own copy (tts.js mendSpeechQuote).
const SPEECH_QUOTE_PAIRS = Object.freeze([['「', '」'], ['『', '』'], ['“', '”']]);
function speechQuoteRules() {
  return SPEECH_QUOTE_PAIRS.map(([open, close]) => ({
    id: `${MODULE_ID}:speech-quote-${close.codePointAt(0).toString(16)}`,
    scriptName: `镜译 · 说话人标记引号配对 ${open}${close}`,
    // The middle group used to exclude '<' along with the other quote marks, so a line the preset had
    // already painted — <say…>「<big><b>…</b></big>」</say> with no closer before </say> — never matched
    // and kept its dangling quote. Tags carry no quote characters of their own, so letting them through
    // does not risk pairing across a mark this rule was never meant to touch.
    findRegex: `/(<say(?=[\\s/>])[^<>]*>\\s*${open})([^「」『』“”"\\n]*?)[${[...'」』”"“'].filter(mark => mark !== close).join('')}]?(\\s*<\\/say>)/g`,
    replaceString: `$1$2${close}$3`,
    trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: true,
    runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null,
    [REGEX_OWNER_KEY]: { owner: MODULE_ID, internal: true },
  }));
}

// The story's own speaker marks, <say who="…" mood="…">…</say>: the reading reads them, the reader never
// sees them. The host already drops a tag it does not know when it draws a floor and keeps the words
// inside; this does the same for a reader whose host is set to show tags as text. Only the drawing
// loses them — the main model still sees them in its context and keeps writing them, and the words
// between them are shown as always.
// A fresh object every time: the host's regex panel edits rules in place.
function speechMarkRule() {
  return {
    id: `${MODULE_ID}:speech-marks`, scriptName: '镜译 · 隐藏说话人标记',
    findRegex: '/<\\/?say(?=[\\s/>])[^<>]*>/gi',
    replaceString: '', trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false,
    runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null,
    [REGEX_OWNER_KEY]: { owner: MODULE_ID, internal: true },
  };
}

// Third line of defence for the prompt. The generation interceptor is the primary path and the
// prompt events are the fallback, but both are extension hooks that a host can fail to call. These
// are ordinary native prompt rules, so anything the host routes through its own regex layer — the
// main request included — loses the mirror blocks even when no hook of ours ever fires.
// Order matters: the host applies scripts in list order, so whole blocks go before bare boundaries.
const PROMPT_GUARD_RULES = Object.freeze([
  {
    id: `${MODULE_ID}:prompt-translation`, scriptName: '镜译 · 提示词清理 · 译文块',
    findRegex: `/\\n?${TRANSLATION_START}[\\s\\S]*?${TRANSLATION_END}/g`,
    replaceString: '', trimStrings: [], placement: [2], disabled: false, markdownOnly: false, promptOnly: true,
    runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null,
    [REGEX_OWNER_KEY]: { owner: MODULE_ID, internal: true },
  },
  {
    id: `${MODULE_ID}:prompt-hidden`, scriptName: '镜译 · 提示词清理 · 隐藏原文块',
    findRegex: `/\\n?${HIDDEN_START}[\\s\\S]*?${HIDDEN_END}/g`,
    replaceString: '', trimStrings: [], placement: [2], disabled: false, markdownOnly: false, promptOnly: true,
    runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null,
    [REGEX_OWNER_KEY]: { owner: MODULE_ID, internal: true },
  },
  {
    id: `${MODULE_ID}:prompt-affix`, scriptName: '镜译 · 提示词清理 · 装饰前后缀',
    findRegex: `/${AFFIX_START}[\\s\\S]*?${AFFIX_END}/g`,
    replaceString: '', trimStrings: [], placement: [2], disabled: false, markdownOnly: false, promptOnly: true,
    runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null,
    [REGEX_OWNER_KEY]: { owner: MODULE_ID, internal: true },
  },
  {
    id: `${MODULE_ID}:prompt-boundaries`, scriptName: '镜译 · 提示词清理 · 边界字符',
    findRegex: `/${[SOURCE_START, SOURCE_END, TRANSLATION_START, TRANSLATION_END, AFFIX_START, AFFIX_END, HIDDEN_START, HIDDEN_END].join('|')}/g`,
    replaceString: '', trimStrings: [], placement: [2], disabled: false, markdownOnly: false, promptOnly: true,
    runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null,
    [REGEX_OWNER_KEY]: { owner: MODULE_ID, internal: true },
  },
]);

// Content, not identity: two regex objects that would behave the same way regardless of which id or
// scriptName they happen to carry. Used to tell an actual edit apart from a copy that merely lost its
// marker or its id, and to fold byte-identical duplicates back into one without touching anything a
// reader wrote on purpose. minDepth/maxDepth are read through the same NaN-tolerant lens normalizeNativeRegex
// validates against (酒馆's own editor writes parseInt('') = NaN for a blank depth field, never null).
function regexScriptContentKey(rule) {
  const depth = value => (Number.isInteger(value) ? value : null);
  return JSON.stringify({
    scriptName: rule.scriptName, findRegex: rule.findRegex, replaceString: rule.replaceString,
    trimStrings: rule.trimStrings ?? [], placement: [...(rule.placement ?? [])].sort((a, b) => a - b),
    disabled: Boolean(rule.disabled), markdownOnly: Boolean(rule.markdownOnly), promptOnly: Boolean(rule.promptOnly),
    runOnEdit: Boolean(rule.runOnEdit), substituteRegex: rule.substituteRegex ?? 0,
    minDepth: depth(rule.minDepth), maxDepth: depth(rule.maxDepth),
  });
}

// Same scriptName/findRegex/replaceString/placement/flags, whatever id or scriptName prefix each one
// carries: collapses a profile's own regexScripts list back to one entry per distinct rule. Exists for
// the state a reader can already be sitting on from before this file's id-based recognition landed --
// 酒馆's own regex panel assigns a fresh id on every import (see isJingyiRegex above), so a batch
// export-then-reimport of 镜译's rules used to leave the *profile itself* holding N differently-id'd
// copies of what is really one rule; no amount of re-syncing the native mirror converges that away, since
// each of the N ids is, by that point, genuinely something the profile asks for. Order-preserving: the
// first-seen copy of each distinct rule survives.
export function dedupeManagedRegexScripts(regexScripts) {
  const seen = new Set();
  const kept = [];
  for (const rule of regexScripts) {
    const key = regexScriptContentKey(rule);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(rule);
  }
  return kept;
}

export function readNativeRegexEdits(existing, profile) {
  const managedId = ruleId => `${MODULE_ID}:${profile.id}:${ruleId}`;
  const namePrefix = `镜译 · ${profile.name} · `;
  const stripName = name => (name?.startsWith(namePrefix) ? name.slice(namePrefix.length) : name);
  // The marker is read first since a still-marked rule already carries this pair; the id is only parsed
  // when the marker is gone, so an edit the reader made in 酒馆's own editor right before it silently
  // stripped the marker is still picked up instead of quietly lost. A candidate whose own id equals the
  // one 镜译 minted for this ruleId (`sameId`) occupies that one deterministic slot -- an in-place edit
  // keeps this id even once the marker is gone, because 酒馆's editor reuses `existingId` on Save. A
  // candidate under any other id (`variant`) only got here through its marker, which survives 酒馆's own
  // "export, then re-import" (a fresh uuid, everything else including the marker untouched) -- that is a
  // reader's deliberate copy, not an edit of the existing slot.
  const groups = new Map();
  for (const rule of Array.isArray(existing) ? existing : []) {
    const marked = rule?.[REGEX_OWNER_KEY]?.owner === MODULE_ID;
    const pair = marked ? rule[REGEX_OWNER_KEY] : parseManagedRegexId(rule?.id);
    if (!pair || pair.profileId !== profile.id) continue;
    const bucket = groups.get(pair.ruleId) || { sameId: [], variant: [] };
    (rule.id === managedId(pair.ruleId) ? bucket.sameId : bucket.variant).push({ rule, marked });
    groups.set(pair.ruleId, bucket);
  }

  const existingById = new Map(profile.regexScripts.map(rule => [rule.id, rule]));
  // minDepth/maxDepth: 酒馆's own editor writes parseInt(String(value ?? '')) on every Save, which is
  // NaN whenever the field was left blank (every fixed and profile-bound rule ships with minDepth/
  // maxDepth null, so the field always starts blank) -- not null, and never was. Left uncoerced, a rule
  // the reader opened and saved with nothing changed at all fails normalizeNativeRegex's own
  // Number.isInteger check and would otherwise take the whole read down with it.
  const toCandidate = (rule, ruleId) => ({
    ...rule, id: ruleId, scriptName: stripName(rule.scriptName),
    minDepth: Number.isInteger(rule.minDepth) ? rule.minDepth : null,
    maxDepth: Number.isInteger(rule.maxDepth) ? rule.maxDepth : null,
  });
  // 酒馆's own editor can save a copy that fails our validation on its own -- every "Affects" box
  // unchecked, an emptied find pattern -- 酒馆 only warns and saves anyway. `fallback` keeps one bad
  // native copy from failing the whole read: for the one deterministic slot a ruleId already occupies,
  // it is the profile's own already-saved version of that same rule; a variant under a fresh id has no
  // saved version of its own to fall back to, and is simply dropped rather than resurrecting a stale
  // copy of some other rule under its id.
  const tryNormalize = (candidate, fallback) => {
    try { return normalizeNativeRegex(candidate); } catch { return fallback ?? null; }
  };

  const edits = [];
  for (const [ruleId, { sameId, variant }] of groups) {
    if (sameId.length) {
      const markedOne = sameId.find(item => item.marked);
      const baseline = markedOne ? toCandidate(markedOne.rule, ruleId) : existingById.get(ruleId);
      const differing = sameId.find(item => !item.marked
        && (!baseline || regexScriptContentKey(toCandidate(item.rule, ruleId)) !== regexScriptContentKey(baseline)));
      const winner = differing || markedOne || sameId[0];
      const normalized = tryNormalize(toCandidate(winner.rule, ruleId), existingById.get(ruleId));
      if (normalized) edits.push(normalized);
    }
    const seenVariants = new Set();
    for (const item of variant) {
      const candidate = toCandidate(item.rule, processingId());
      const key = regexScriptContentKey(candidate);
      if (seenVariants.has(key)) continue;
      seenVariants.add(key);
      const normalized = tryNormalize(candidate, null);
      if (normalized) edits.push(normalized);
    }
  }
  return edits;
}

// What the "删除多余正则" button needs, split so removal and installation are counted separately: net
// list-length arithmetic (before - after) mixes the two, so an equal number of surplus copies and
// missing fixed rules nets to zero and the button reports nothing to clean, and a reader who has
// deleted more fixed rules than there are surplus copies sees a negative count. `expected` is exactly
// what syncNativeRegex would install for this profile alone (fixed rules plus one native copy per
// regexScripts entry); toRemove counts existing 镜译 rules that are not the one kept copy of an expected
// id; toInstall counts expected ids missing from the native list entirely.
export function planRegexCleanup(existingRegex, profile) {
  const existingJingyi = (Array.isArray(existingRegex) ? existingRegex : []).filter(isJingyiRegex);
  const expected = syncNativeRegex([], profile).filter(isJingyiRegex);
  const expectedIds = new Set(expected.map(rule => rule.id));
  const seen = new Set();
  let toRemove = 0;
  for (const rule of existingJingyi) {
    if (expectedIds.has(rule.id) && !seen.has(rule.id)) { seen.add(rule.id); continue; }
    toRemove++;
  }
  const toInstall = expected.filter(rule => !existingJingyi.some(item => item.id === rule.id)).length;
  return { expected, toRemove, toInstall };
}

// A character's own scoped regex and a preset's own regex are two more places a reader can move a
// 镜译-owned rule with 酒馆's own "移到角色 / 预设" -- and syncNativeRegex only ever writes to the
// global list, so the moved copy is never the one live copy of anything: 镜译 reinstalls a fresh
// global copy on the very next sync regardless of where the reader dragged the old one away to, and
// the moved copy just sits there, orphaned, forever afterwards. Unlike planRegexCleanup there is no
// "expected" set to reconcile against here -- 镜译 never expects a rule of its own in either scope --
// so every rule isJingyiRegex claims in the given list is surplus and is removed outright; anything
// else, id or scriptName lookalikes included, is left exactly as it was.
export function planScopedRegexCleanup(scripts) {
  const list = Array.isArray(scripts) ? scripts : [];
  const kept = list.filter(rule => !isJingyiRegex(rule));
  return { kept, toRemove: list.length - kept.length };
}

// Every block container a card template plausibly uses — the same range the reading's own BREAK_RE
// treats as line-level (tts-sanitizer.js). The source group below only matches when every one of them in
// the block pairs up, tag for same-named tag, with nothing stray left over, so a block whose tags
// briefly slipped out of balance — a translation glitch, a still-streaming reply, a status card built
// from <details>/<section>/<ul> rather than a bare <div> — is shown as it is instead of coming out
// wrapped in a beautify shell nested wrongly around the break. Matched case-insensitively: a model or a
// pasted card writes <DIV> as often as <div>.
const BALANCED_BLOCK_TAGS = '(?:details|summary|section|article|header|footer|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|pre|h[1-6]|dl|dd|dt|div|p)';
// '<' is only "safe" text when it starts neither a block tag nor one of this pattern's own boundaries —
// without the second lookahead a greedy match happily read straight through </jy-source> looking for
// the nearest closing block tag, and one wrap ate two floors' segments whole (source and translation
// swapped in).
const BALANCED_SAFE = `(?:[^<]|<(?!\\/?${BALANCED_BLOCK_TAGS}\\b)(?!\\/?jy-(?:source|translation)\\b))`;
// Nesting is allowed up to three deep — a named group per level (`t1`/`t2`/`t3`) so each open only
// closes on a `</tag>` of that exact same name, never a sibling's. A card nested any deeper is left
// alone entirely, the same as one that is not balanced at all: conservative rather than guessing.
const BALANCED_PAIR_1 = `<(?<t1>${BALANCED_BLOCK_TAGS})\\b[^<>]*>${BALANCED_SAFE}*<\\/\\k<t1>\\s*>`;
const BALANCED_INNER_2 = `(?:${BALANCED_SAFE}|${BALANCED_PAIR_1})`;
const BALANCED_PAIR_2 = `<(?<t2>${BALANCED_BLOCK_TAGS})\\b[^<>]*>${BALANCED_INNER_2}*<\\/\\k<t2>\\s*>`;
const BALANCED_INNER_3 = `(?:${BALANCED_SAFE}|${BALANCED_PAIR_2})`;
const BALANCED_PAIR_3 = `<(?<t3>${BALANCED_BLOCK_TAGS})\\b[^<>]*>${BALANCED_INNER_3}*<\\/\\k<t3>\\s*>`;
const BALANCED_SOURCE = `${BALANCED_SAFE}*(?:${BALANCED_PAIR_3}${BALANCED_SAFE}*)*`;
// Named rather than $1/$2: the nesting groups above (t1/t2/t3) are capturing groups of their own, so the
// two groups the replaceString actually needs are named here and referenced as $<jySource>/$<jyTranslation>
// instead, immune to however many more numbered groups BALANCED_SOURCE ends up defining.
const readingPattern = `<jy-source>(?<jySource>${BALANCED_SOURCE})<\\/jy-source>\\n<jy-translation>(?<jyTranslation>[\\s\\S]*?)<\\/jy-translation>`;
export const BUILTIN_READING_STYLES = Object.freeze([
  { id: 'cute', name: '可爱风', description: '一点桃粉，一枚小花。' },
  { id: 'minimal', name: '极简风', description: '淡化原文，留白分隔。' },
  { id: 'fold', name: '原文折叠', description: '原文可展开，译文缩进。' },
]);

// The one built-in reading rule's replaceString, for a style id — settings-independent, so it also
// serves as the reference migrateLegacyReadingRule compares a saved rule against, without re-deriving a
// whole profile (and risking calling back into normalizeProcessingProfile) just to read this one string.
function builtinReadingReplaceString(styleId) {
  const before = styleId === 'fold'
    ? '<details class="jy-reading-original"><summary>原文</summary><div class="jy-reading-source">\n\n$<jySource>\n\n</div></details>'
    : '<div class="jy-reading-source">\n\n$<jySource>\n\n</div>';
  return `<div class="jy-reading jy-reading-${styleId}">\n${before}\n<div class="jy-reading-translation">\n\n$<jyTranslation>\n\n</div>\n</div>`;
}

// The reverse of makeBuiltinReadingProfile: which built-in style (if any) a profile's own prefixes
// and rule already match — used to show a picker's actually-active choice instead of a fixed default,
// and to tell "already on this style" apart from "switching to a different one" (review finding
// index.js:11796/491: 微调's 内置美化 select never reflected the active profile and could not be told
// to just stay on the style it already showed).
export function detectBuiltinReadingStyle(profile) {
  const values = profile?.settings;
  if (!values || values.segmentPrefix !== '<jy-source>' || values.segmentSuffix !== '</jy-source>'
    || values.translationPrefix !== '<jy-translation>' || values.translationSuffix !== '</jy-translation>') return null;
  const rule = (profile.regexScripts ?? []).find(item => BUILTIN_READING_STYLES.some(style => item.replaceString === builtinReadingReplaceString(style.id)));
  if (!rule) return null;
  return BUILTIN_READING_STYLES.find(style => rule.replaceString === builtinReadingReplaceString(style.id))?.id ?? null;
}

export function makeBuiltinReadingProfile(settings, styleId) {
  const style = BUILTIN_READING_STYLES.find(item => item.id === styleId);
  if (!style) throw new Error('没有找到这个内置美化。');
  return normalizeProcessingProfile({
    id: processingId(), name: style.name,
    settings: { ...processingSnapshot(settings), segmentPrefix: '<jy-source>', segmentSuffix: '</jy-source>', translationPrefix: '<jy-translation>', translationSuffix: '</jy-translation>' },
    regexScripts: [{
      id: processingId(), scriptName: style.name,
      findRegex: `/${readingPattern}/gi`,
      replaceString: builtinReadingReplaceString(styleId),
      trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false,
      runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null,
    }],
  });
}

// v0.36.1 tightened the built-in beautify's findRegex against block tags left unbalanced (BALANCED_SOURCE
// above); a profile saved before that fix still carries the old, unguarded findRegex verbatim; nothing
// else in normalizeProcessingProfile ever rewrites a rule's own regex once it is saved. A rule that reads
// exactly as makeBuiltinReadingProfile used to emit — this findRegex, and a replaceString that is still
// one of the three built-in styles' own template, neither touched since — picks up the new findRegex
// here; a rule the reader edited, in either field, is left exactly as they wrote it.
const LEGACY_READING_FIND_REGEX = '/<jy-source>([\\s\\S]*?)<\\/jy-source>\\n<jy-translation>([\\s\\S]*?)<\\/jy-translation>/g';
function migrateLegacyReadingRule(rule) {
  if (rule.findRegex !== LEGACY_READING_FIND_REGEX) return rule;
  const style = BUILTIN_READING_STYLES.find(item => legacyReadingReplaceString(item.id) === rule.replaceString);
  if (!style) return rule;
  // Both fields move together: the guarded pattern numbers its groups differently, so the old $1/$2
  // would no longer point at the source and the translation.
  return { ...rule, findRegex: `/${readingPattern}/gi`, replaceString: builtinReadingReplaceString(style.id) };
}

// What makeBuiltinReadingProfile wrote before v0.36.1: the same template, reading its two groups by number.
function legacyReadingReplaceString(styleId) {
  return builtinReadingReplaceString(styleId).replace('$<jySource>', '$1').replace('$<jyTranslation>', '$2');
}

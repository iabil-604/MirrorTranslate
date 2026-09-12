import {
  CORE_TRANSLATION_SPEC,
  DEFAULT_PROMPT_PROFILE,
  KNOWN_DEFAULT_CHECKLIST_PROMPTS,
  KNOWN_DEFAULT_CORE_PROMPTS,
  LEGACY_DEFAULT_TRANSLATION_PROMPT,
  PRE_OUTPUT_CHECKLIST,
  normalizeTargetLanguage,
} from './prompts.js?v=0.15.7';

export const MODULE_ID = 'jingyi-translator';
export const APP_NAME = '镜译 · 正文翻译器';
export const APP_VERSION = '0.15.7';
export const MESSAGE_META_KEY = 'jingyi_translation';
export const INVISIBLE_MARKER = '\u2063';
// These boundaries belong to MirrorTranslate; visible affixes never identify a block.
export const SOURCE_START = '\u2063\u2060\u2063';
export const SOURCE_END = '\u2063\u2061\u2063';
export const TRANSLATION_START = '\u2063\u2062\u2063';
export const TRANSLATION_END = '\u2063\u2064\u2063';
export const AFFIX_START = '\u2063\u200b\u2063';
export const AFFIX_END = '\u2063\u200c\u2063';
// Replace-tag regions keep the original inside a hidden block: prompts drop it, display hides it,
// and re-translation restores it, so the swap is reversible without touching swipes.
export const HIDDEN_START = '\u2063\u200d\u2063';
export const HIDDEN_END = '\u2063\ufeff\u2063';
const SOURCE_BLOCK_RE = new RegExp(`${SOURCE_START}([\\s\\S]*?)${SOURCE_END}`, 'g');
const TRANSLATION_BLOCK_RE = new RegExp(`\\n?${TRANSLATION_START}([\\s\\S]*?)${TRANSLATION_END}`, 'g');
const AFFIX_RE = new RegExp(`${AFFIX_START}[\\s\\S]*?${AFFIX_END}`, 'g');
const HIDDEN_BLOCK_RE = new RegExp(`\\n?${HIDDEN_START}[\\s\\S]*?${HIDDEN_END}`, 'g');
// Tempered patterns: the pair's translation payload may not cross a boundary, so a bilingual
// source block can never falsely pair up with a later replace pair's hidden original.
const REPLACE_PAIR_RE = new RegExp(`${SOURCE_START}(?:(?!${SOURCE_START}|${SOURCE_END})[\\s\\S])*?${SOURCE_END}\\n?${HIDDEN_START}([\\s\\S]*?)${HIDDEN_END}`, 'g');
// Both halves at once. Pairing 补译 seeds by the hidden original keeps a partly translated floor from
// handing an untranslated segment the translation that belongs to the next one.
const REPLACE_PAIR_BOTH_RE = new RegExp(`${SOURCE_START}((?:(?!${SOURCE_END})[\\s\\S])*)${SOURCE_END}\\n?${HIDDEN_START}((?:(?!${HIDDEN_END})[\\s\\S])*)${HIDDEN_END}`, 'g');

const GENERATED_BLOCK_RE = new RegExp(`(?:^|\\n)\\{${INVISIBLE_MARKER}([\\s\\S]*?)${INVISIBLE_MARKER}\\}[ \\t]*(?=\\n|$)`, 'g');
const LEGACY_GENERATED_LINE_RE = new RegExp(`^\\{${INVISIBLE_MARKER}[^\\r\\n]*\\}[ \\t]*$`);
// The wrapper speaker/emotion styling is rendered into. Kept here so the restyle pass can recognise
// and carry over a wrapper it did not generate.
export const SPEAKER_CLASS = 'jy-spk';
// Speech marks, and the narration that surrounds them.
//
// Speaker colour used to run across a whole line, so a line like 「あ、そう」と呟き、通話を切った
// wore one speaker's colour over its narration as well. The narration belongs to the narrator no
// matter who is quoted inside it, so the colour has to stop at these boundaries.
const SPEECH_OPENERS = new Map([
  ['「', '」'],
  ['『', '』'],
  ['“', '”'],
  ['"', '"'],
]);

/**
 * Splits a translated line into quoted and unquoted runs.
 *
 * An unterminated quote is reported as narration rather than guessed at: painting a run that was
 * never closed would spill the speaker's colour over the rest of the line, which is the very thing
 * this exists to stop.
 */
export function splitSpeechParts(value) {
  const source = String(value ?? '');
  const parts = [];
  let buffer = '';
  let closer = '';
  let depth = 0;
  const flush = spoken => {
    if (buffer) parts.push({ text: buffer, spoken });
    buffer = '';
  };
  for (const character of source) {
    if (!closer) {
      const pair = SPEECH_OPENERS.get(character);
      if (pair) {
        flush(false);
        buffer = character;
        closer = pair;
        depth = 1;
        continue;
      }
      buffer += character;
      continue;
    }
    buffer += character;
    if (character === closer) {
      depth -= 1;
      if (!depth) {
        flush(true);
        closer = '';
      }
    } else if (SPEECH_OPENERS.get(character) === closer) {
      depth += 1;
    }
  }
  flush(false);
  return parts;
}

/**
 * How a unit of translated lines carries speech: all of it quoted, none of it, or a mix.
 *
 * 'narration' is the case the reader complained about twice over — a line with no quoted span at
 * all should not wear anybody's colour.
 */
export function describeSpeechShape(texts) {
  const lines = (Array.isArray(texts) ? texts : [texts]).map(item => String(item ?? ''));
  let spoken = 0;
  let narrated = 0;
  for (const line of lines) {
    for (const part of splitSpeechParts(line)) {
      if (part.spoken) spoken += 1;
      else if (part.text.trim()) narrated += 1;
    }
  }
  if (!spoken) return 'narration';
  return narrated ? 'mixed' : 'spoken';
}

// SillyTavern rewrites message class names with a custom- prefix when it renders, and an edited
// floor can be saved back in that form, so both spellings have to be recognised here.
const SPEAKER_OPEN_RE = new RegExp(`<span class="(?:custom-)?${SPEAKER_CLASS}(?:[ "][^>]*)?>`);
const VALID_TAG_RE = /^[A-Za-z][A-Za-z0-9_:-]*$/;
const STRUCTURAL_TAG_RE = /\\?<\/?([A-Za-z][A-Za-z0-9_:-]*)(?:\s[^<>]*?)?\s*\/?>/g;
const HTML_ENTITY_RE = /&(?:#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi;
const LEGACY_BUNDLED_PRELUDE_FINGERPRINT = '2921:75ac807f';
// A guard against typos and NaN, not a real output-policy ceiling; providers reject what they reject.
const MAX_OUTPUT_TOKENS_LIMIT = 1000000;

export const DEFAULT_CHANNEL = Object.freeze({
  id: 'default',
  name: '默认副 API',
  url: '',
  key: '',
  model: '',
  models: [],
  timeoutSec: 240,
  maxTokens: 60000,
  temperature: 0.15,
  tokenSaving: false,
  reasoningEffort: '',
  excludeParams: [],
});

// Speaker colouring and emotion typography. The secondary model only ever returns a label; the
// palette, the contrast maths and the typography all live on this side. See palette.js.
export const DEFAULT_COLORING = Object.freeze({
  speakers: false,
  emotions: false,
  // WCAG AA for body text. The theme probe reports what a background can actually reach.
  minContrast: 4.5,
  // 0 keeps a character's own hair colour faithfully, 1 paints everyone at full strength.
  vividness: 0.65,
  // A speaker the model named but the palette has never heard of still gets a colour, derived from
  // the name the way a black-haired character already is. Without this the whole feature silently
  // does nothing until every character has been registered by hand, which is indistinguishable from
  // "翻译把对话的颜色弄掉了".
  autoSpeakers: true,
  // The size contour inside one spoken line, computed from punctuation and the emotion label that
  // already came back. It costs the secondary model nothing, so it rides with 情绪排版.
  rhythm: true,
  // Filled in by 取色: { direction, luminance, chromaMax, minContrast, backgrounds }.
  band: null,
  bandProbedAt: '',
});

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 12,
  coloring: DEFAULT_COLORING,
  speakerPalette: {},
  theme: 'day',
  autoGeneration: true,
  autoSwipe: true,
  autoEdit: false,
  streamingWriteback: false,
  apiMode: 'follow',
  selectedChannelId: DEFAULT_CHANNEL.id,
  channels: [DEFAULT_CHANNEL],
  showFloatingButton: true,
  floatingStyle: 'auto',
  retries: 1,
  bodyTags: Object.freeze(['story_scene']),
  replaceTags: Object.freeze([]),
  excludedTags: Object.freeze([]),
  preserveLineRules: '',
  segmentPrefix: '',
  segmentSuffix: '',
  translationPrefix: '{',
  translationSuffix: '}',
  paragraphPerLine: false,
  // Presentation tags around a source line come back around its translation. Default on: leaving it
  // off is what made a preset that paints dialogue paint only half the floor.
  carryFormatting: true,
  includeWorldbook: true,
  includeCharacterCard: true,
  includeRecentContext: true,
  contextMessages: 2,
  selectedPromptProfileId: DEFAULT_PROMPT_PROFILE.id,
  promptProfiles: [DEFAULT_PROMPT_PROFILE],
});

export const FLOATING_STYLES = Object.freeze(['auto', 'ring', 'pill', 'edge']);

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function parseExcludedParams(value) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(/[\s,，;；]+/);
  return [...new Set(source.map(item => String(item).trim()).filter(Boolean))];
}

function normalizeTagToken(value) {
  let token = String(value ?? '').trim();
  const wrapped = token.match(/^<\s*\/?\s*([A-Za-z][A-Za-z0-9_:-]*)\s*\/?>$/);
  if (wrapped) token = wrapped[1];
  return token;
}

export function parseTagNamesWithErrors(value) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(/[\s,，;；]+/);
  const result = [];
  const invalid = [];
  const seen = new Set();
  for (const item of source) {
    const raw = String(item ?? '').trim();
    if (!raw) continue;
    const tag = normalizeTagToken(raw);
    if (!VALID_TAG_RE.test(tag)) {
      invalid.push(raw);
      continue;
    }
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return { tags: result, invalid };
}

export function parseTagNames(value, fallback = []) {
  const result = parseTagNamesWithErrors(value).tags;
  if (result.length) return result;
  return Array.isArray(fallback) ? [...fallback] : [];
}

function parseRegexRule(raw, lineNumber) {
  const end = raw.lastIndexOf('/');
  if (end <= 0) return { error: `第 ${lineNumber} 行正则缺少结束斜杠。` };
  const pattern = raw.slice(1, end);
  const flags = raw.slice(end + 1);
  if (!/^[dgimsuvy]*$/.test(flags)) return { error: `第 ${lineNumber} 行正则标志无效：${flags || '（空）'}。` };
  try {
    return { type: 'regex', source: raw, regex: new RegExp(pattern, flags.replace(/[gy]/g, '')) };
  } catch (error) {
    return { error: `第 ${lineNumber} 行正则无效：${error.message}` };
  }
}

export function parsePreserveLineRulesWithErrors(value) {
  const lines = Array.isArray(value) ? value : normalizeNewlines(value).split('\n');
  const rules = [];
  const errors = [];
  lines.forEach((item, index) => {
    const raw = String(item ?? '').trim();
    if (!raw) return;
    if (raw.startsWith('/')) {
      const parsed = parseRegexRule(raw, index + 1);
      if (parsed.error) errors.push(parsed.error);
      else rules.push(parsed);
      return;
    }
    if (/^prefix:/i.test(raw)) {
      const text = raw.slice(raw.indexOf(':') + 1).trim();
      if (!text) errors.push(`第 ${index + 1} 行的 prefix 不能为空。`);
      else rules.push({ type: 'prefix', source: raw, text });
      return;
    }
    rules.push({ type: 'exact', source: raw, text: raw });
  });
  return { rules, errors };
}

export function matchesPreserveLine(line, rules) {
  const raw = String(line ?? '');
  const trimmed = raw.trim();
  return (Array.isArray(rules) ? rules : []).some(rule => {
    if (rule.type === 'regex') return rule.regex.test(raw);
    if (rule.type === 'prefix') return trimmed.startsWith(rule.text);
    return trimmed === rule.text;
  });
}

const REASONING_EFFORTS = Object.freeze(['', 'minimal', 'low', 'medium', 'high']);

export function normalizeChannel(value = {}, fallbackId = DEFAULT_CHANNEL.id) {
  const source = value && typeof value === 'object' ? value : {};
  const id = String(source.id || fallbackId).trim() || fallbackId;
  const models = Array.isArray(source.models)
    ? [...new Set(source.models.map(item => String(item).trim()).filter(Boolean))].sort()
    : [];
  return {
    id,
    name: String(source.name || DEFAULT_CHANNEL.name).trim() || DEFAULT_CHANNEL.name,
    url: String(source.url ?? source.apiUrl ?? '').trim(),
    key: String(source.key ?? source.apiKey ?? '').trim(),
    model: String(source.model ?? source.apiModel ?? '').trim(),
    models,
    timeoutSec: clampInteger(source.timeoutSec, 10, 600, DEFAULT_CHANNEL.timeoutSec),
    maxTokens: clampInteger(source.maxTokens, 256, MAX_OUTPUT_TOKENS_LIMIT, DEFAULT_CHANNEL.maxTokens),
    temperature: clampNumber(source.temperature, 0, 2, DEFAULT_CHANNEL.temperature),
    tokenSaving: source.tokenSaving === true,
    reasoningEffort: REASONING_EFFORTS.includes(source.reasoningEffort) ? source.reasoningEffort : '',
    excludeParams: parseExcludedParams(source.excludeParams),
  };
}

export function getActiveChannel(settings) {
  const channels = Array.isArray(settings?.channels) ? settings.channels : [];
  return channels.find(channel => channel.id === settings?.selectedChannelId) || channels[0] || normalizeChannel();
}

function normalizePromptSection(value = {}, fallbackId = 'section-1') {
  const source = value && typeof value === 'object' ? value : {};
  return {
    id: String(source.id || fallbackId).trim() || fallbackId,
    title: String(source.title || '自定义规则').trim() || '自定义规则',
    content: String(source.content ?? ''),
    enabled: source.enabled !== false,
  };
}

function normalizePromptMode(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function promptFingerprint(value) {
  const source = String(value ?? '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${source.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function normalizePromptProfile(value = {}, fallbackId = DEFAULT_PROMPT_PROFILE.id) {
  const source = value && typeof value === 'object' ? value : {};
  const base = deepClone(DEFAULT_PROMPT_PROFILE);
  const profile = { ...base, ...source };
  profile.id = String(source.id || fallbackId).trim() || fallbackId;
  profile.name = String(source.name || base.name).trim() || base.name;
  profile.targetLanguage = normalizeTargetLanguage(source.targetLanguage ?? base.targetLanguage);
  profile.jailbreakPrompt = String(source.jailbreakPrompt ?? base.jailbreakPrompt);
  profile.corePrompt = String(source.corePrompt ?? '').trim() || CORE_TRANSLATION_SPEC;
  profile.checklistPrompt = String(source.checklistPrompt ?? '').trim() || PRE_OUTPUT_CHECKLIST;
  profile.styleMode = normalizePromptMode(source.styleMode, ['light_novel', 'strict_mirror', 'plain', 'custom'], base.styleMode);
  profile.nameMode = normalizePromptMode(source.nameMode, ['contextual', 'keep', 'transliterate', 'custom'], base.nameMode);
  profile.honorificMode = normalizePromptMode(source.honorificMode, ['preserve', 'translate', 'remove', 'custom'], base.honorificMode);
  profile.punctuationMode = normalizePromptMode(source.punctuationMode, ['japanese', 'chinese', 'source', 'custom'], base.punctuationMode);
  for (const key of [
    'styleCustom',
    'nameCustom',
    'honorificCustom',
    'punctuationCustom',
    'avoidPhrases',
    'forbiddenPhrases',
    'glossary',
    'examples',
    'postscript',
  ]) profile[key] = String(source[key] ?? base[key] ?? '');
  profile.postscriptRole = ['system', 'user', 'assistant'].includes(source.postscriptRole)
    ? source.postscriptRole
    : 'user';
  const rawSections = Array.isArray(source.customSections) ? source.customSections.slice(0, 30) : [];
  const usedIds = new Set();
  profile.customSections = rawSections.map((section, index) => {
    let normalized = normalizePromptSection(section, `section-${index + 1}`);
    while (usedIds.has(normalized.id)) normalized = { ...normalized, id: `${normalized.id}-${index + 1}` };
    usedIds.add(normalized.id);
    return normalized;
  });
  return profile;
}

export function getActivePromptProfile(settings) {
  const profiles = Array.isArray(settings?.promptProfiles) ? settings.promptProfiles : [];
  return profiles.find(profile => profile.id === settings?.selectedPromptProfileId)
    || profiles[0]
    || normalizePromptProfile();
}

// A saved band is data the probe wrote, but it also comes back from an imported profile, so every
// field is re-checked rather than trusted.
function normalizeColorBand(value) {
  if (!value || typeof value !== 'object') return null;
  const backgrounds = (Array.isArray(value.backgrounds) ? value.backgrounds : [])
    .map(item => (item && typeof item === 'object'
      ? { r: clampNumber(item.r, 0, 1, 0), g: clampNumber(item.g, 0, 1, 0), b: clampNumber(item.b, 0, 1, 0), a: 1 }
      : null))
    .filter(Boolean);
  if (!backgrounds.length) return null;
  const chromaMax = clampNumber(value.chromaMax, 0, 0.4, 0);
  if (!chromaMax) return null;
  return {
    direction: value.direction === 'dark' ? 'dark' : 'light',
    luminance: clampNumber(value.luminance, 0, 1, 0.5),
    chromaMax,
    minContrast: clampNumber(value.minContrast, 1, 21, 4.5),
    backgrounds,
  };
}

export function normalizeColoring(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    speakers: Boolean(source.speakers),
    emotions: Boolean(source.emotions),
    minContrast: clampNumber(source.minContrast, 1.5, 21, DEFAULT_COLORING.minContrast),
    vividness: clampNumber(source.vividness, 0, 1, DEFAULT_COLORING.vividness),
    autoSpeakers: source.autoSpeakers === undefined ? DEFAULT_COLORING.autoSpeakers : Boolean(source.autoSpeakers),
    rhythm: source.rhythm === undefined ? DEFAULT_COLORING.rhythm : Boolean(source.rhythm),
    band: normalizeColorBand(source.band),
    bandProbedAt: typeof source.bandProbedAt === 'string' ? source.bandProbedAt.slice(0, 40) : '',
  };
}

// One entry per character whose speech gets its own colour. `source` is the declared hair or eye
// colour; the displayed colour is derived from it and the current band, never stored.
export function normalizeSpeakerList(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const name = String(item.name ?? '').trim().slice(0, 60);
      if (!name) return null;
      const aliases = [...new Set((Array.isArray(item.aliases) ? item.aliases : String(item.aliases ?? '').split(/[\s,，、;；]+/))
        .map(alias => String(alias ?? '').trim().slice(0, 60))
        .filter(alias => alias && alias !== name))].slice(0, 8);
      return {
        name,
        aliases,
        source: /^#[0-9a-fA-F]{3,8}$/.test(String(item.source ?? '').trim()) ? String(item.source).trim().toLowerCase() : '',
        from: ['hair', 'eye', 'manual'].includes(item.from) ? item.from : 'hair',
      };
    })
    .filter(item => {
      if (!item || seen.has(item.name)) return false;
      seen.add(item.name);
      return true;
    })
    .slice(0, 40);
}

export function mergeSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const merged = { ...deepClone(DEFAULT_SETTINGS), ...source };
  const sourceSchemaVersion = clampInteger(source.schemaVersion, 0, 999, 0);
  merged.schemaVersion = 12;
  merged.theme = ['day', 'night', 'fresh', 'vampire', 'glass'].includes(source.theme) ? source.theme : 'day';
  delete merged.chunkChars;
  delete merged.chunkSegments;
  merged.retries = clampInteger(merged.retries, 0, 5, DEFAULT_SETTINGS.retries);
  merged.apiMode = ['follow', 'independent'].includes(merged.apiMode) ? merged.apiMode : DEFAULT_SETTINGS.apiMode;
  const hasLegacyChannel = ['apiUrl', 'apiKey', 'apiModel'].some(key => String(source[key] ?? '').trim());
  const legacyChannel = normalizeChannel({
    id: DEFAULT_CHANNEL.id,
    name: hasLegacyChannel ? '迁移的副 API' : DEFAULT_CHANNEL.name,
    apiUrl: source.apiUrl,
    apiKey: source.apiKey,
    apiModel: source.apiModel,
    timeoutSec: source.timeoutSec,
    maxTokens: source.maxTokens,
    temperature: source.temperature,
    excludeParams: source.excludeParams,
  });
  const rawChannels = Array.isArray(source.channels) && source.channels.length ? source.channels : [legacyChannel];
  const usedIds = new Set();
  merged.channels = rawChannels.map((channel, index) => {
    let normalized = normalizeChannel(channel, index ? `channel-${index + 1}` : DEFAULT_CHANNEL.id);
    while (usedIds.has(normalized.id)) normalized = { ...normalized, id: `${normalized.id}-${index + 1}` };
    usedIds.add(normalized.id);
    return normalized;
  });
  merged.selectedChannelId = merged.channels.some(channel => channel.id === source.selectedChannelId)
    ? source.selectedChannelId
    : merged.channels[0].id;
  const legacyBodyTag = typeof source.bodyTag === 'string' ? source.bodyTag : '';
  merged.bodyTags = parseTagNames(
    Array.isArray(source.bodyTags) || typeof source.bodyTags === 'string' ? source.bodyTags : [legacyBodyTag],
    DEFAULT_SETTINGS.bodyTags,
  );
  merged.excludedTags = parseTagNames(source.excludedTags);
  merged.replaceTags = parseTagNames(source.replaceTags);
  merged.preserveLineRules = typeof source.preserveLineRules === 'string'
    ? normalizeNewlines(source.preserveLineRules)
    : '';
  delete merged.bodyTag;
  const oldTranslationPrompt = typeof source.translationPrompt === 'string' ? source.translationPrompt.trim() : '';
  const migratedSections = oldTranslationPrompt && oldTranslationPrompt !== LEGACY_DEFAULT_TRANSLATION_PROMPT.trim()
    ? [{ id: 'migrated-translation-rule', title: '从旧版迁移的翻译规则', content: oldTranslationPrompt, enabled: true }]
    : [];
  const fallbackProfile = normalizePromptProfile({
    ...DEFAULT_PROMPT_PROFILE,
    glossary: typeof source.glossary === 'string' ? source.glossary : '',
    customSections: migratedSections,
  });
  const rawPromptProfiles = Array.isArray(source.promptProfiles) && source.promptProfiles.length
    ? source.promptProfiles
    : [fallbackProfile];
  const needsPromptUpgrade = sourceSchemaVersion < 8;
  const needsBundledPreludeRemoval = sourceSchemaVersion < 10;
  const usedPromptProfileIds = new Set();
  merged.promptProfiles = rawPromptProfiles.slice(0, 20).map((profile, index) => {
    const upgraded = needsPromptUpgrade && profile && typeof profile === 'object' ? { ...profile } : profile;
    if (upgraded && typeof upgraded === 'object') {
      if (KNOWN_DEFAULT_CORE_PROMPTS.some(prompt => normalizeNewlines(upgraded.corePrompt).trim() === normalizeNewlines(prompt).trim())) upgraded.corePrompt = CORE_TRANSLATION_SPEC;
      if (KNOWN_DEFAULT_CHECKLIST_PROMPTS.some(prompt => normalizeNewlines(upgraded.checklistPrompt).trim() === normalizeNewlines(prompt).trim())) upgraded.checklistPrompt = PRE_OUTPUT_CHECKLIST;
      if (needsBundledPreludeRemoval && promptFingerprint(upgraded.jailbreakPrompt) === LEGACY_BUNDLED_PRELUDE_FINGERPRINT) upgraded.jailbreakPrompt = '';
    }
    let normalized = normalizePromptProfile(upgraded, index ? `prompt-profile-${index + 1}` : DEFAULT_PROMPT_PROFILE.id);
    while (usedPromptProfileIds.has(normalized.id)) normalized = { ...normalized, id: `${normalized.id}-${index + 1}` };
    usedPromptProfileIds.add(normalized.id);
    return normalized;
  });
  merged.selectedPromptProfileId = merged.promptProfiles.some(profile => profile.id === source.selectedPromptProfileId)
    ? source.selectedPromptProfileId
    : merged.promptProfiles[0].id;
  merged.segmentPrefix = typeof merged.segmentPrefix === 'string' ? merged.segmentPrefix : '';
  merged.segmentSuffix = typeof merged.segmentSuffix === 'string' ? merged.segmentSuffix : '';
  // 0.12.4 shipped this as a pure affix switch; the intent was always one line per paragraph.
  merged.paragraphPerLine = Boolean(merged.paragraphPerLine ?? merged.affixPerLine);
  merged.carryFormatting = merged.carryFormatting !== false;
  delete merged.affixPerLine;
  merged.translationPrefix = typeof merged.translationPrefix === 'string' ? merged.translationPrefix : '';
  merged.translationSuffix = typeof merged.translationSuffix === 'string' ? merged.translationSuffix : '';
  // Older versions added their braces outside the user's fields. Preserve that appearance once.
  if (sourceSchemaVersion < 11 && Object.keys(source).length) {
    merged.translationPrefix = `{${typeof source.translationPrefix === 'string' ? source.translationPrefix : ''}`;
    merged.translationSuffix = `${typeof source.translationSuffix === 'string' ? source.translationSuffix : ''}}`;
  }
  merged.contextMessages = clampInteger(merged.contextMessages, 1, 20, DEFAULT_SETTINGS.contextMessages);
  // Worldbook whitelist for the token-saving mode, stored per character card so switching
  // characters switches the selection with it.
  merged.worldInfoWhitelist = {};
  const rawWhitelist = source.worldInfoWhitelist && typeof source.worldInfoWhitelist === 'object' ? source.worldInfoWhitelist : {};
  for (const [characterKey, list] of Object.entries(rawWhitelist)) {
    const picks = (Array.isArray(list) ? list : [])
      .filter(item => item && typeof item === 'object' && item.world && Number.isInteger(Number(item.uid)))
      .map(item => ({ world: String(item.world), uid: Number(item.uid) }));
    if (picks.length) merged.worldInfoWhitelist[characterKey] = picks;
  }
  merged.coloring = normalizeColoring(source.coloring);
  // The speaker palette follows the character card, like the worldbook whitelist above.
  merged.speakerPalette = {};
  const rawPalette = source.speakerPalette && typeof source.speakerPalette === 'object' ? source.speakerPalette : {};
  for (const [characterKey, list] of Object.entries(rawPalette)) {
    const speakers = normalizeSpeakerList(list);
    if (speakers.length) merged.speakerPalette[characterKey] = speakers;
  }
  merged.includeWorldbook = Boolean(merged.includeWorldbook);
  merged.includeCharacterCard = Boolean(merged.includeCharacterCard);
  merged.includeRecentContext = Boolean(merged.includeRecentContext);
  merged.autoGeneration = Boolean(merged.autoGeneration);
  merged.autoSwipe = Boolean(merged.autoSwipe);
  merged.autoEdit = Boolean(merged.autoEdit);
  merged.streamingWriteback = Boolean(merged.streamingWriteback);
  merged.showFloatingButton = Boolean(merged.showFloatingButton);
  merged.floatingStyle = FLOATING_STYLES.includes(merged.floatingStyle) ? merged.floatingStyle : DEFAULT_SETTINGS.floatingStyle;
  for (const key of [
    'profileId',
    'apiUrl',
    'apiKey',
    'apiModel',
    'timeoutSec',
    'maxTokens',
    'temperature',
    'excludeParams',
    'glossary',
    'basePrompt',
    'translationPrompt',
    'referencePrompt',
    'reviewPrompt',
    'outputPrompt',
    'repairPrompt',
  ]) {
    delete merged[key];
  }
  return merged;
}

export function normalizeNewlines(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n');
}

// No tokenizer ships with the extension, so request size is estimated: CJK-heavy prompt text runs
// close to one token per character while JSON scaffolding and Latin text average roughly four
// characters per token under common vocabularies.
const CJK_CHAR_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/g;

export function estimateRequestTokens(messages) {
  let text = '';
  for (const message of Array.isArray(messages) ? messages : []) {
    const content = message?.content;
    text += typeof content === 'string' ? content : JSON.stringify(content ?? '');
  }
  const cjk = (text.match(CJK_CHAR_RE) || []).length;
  return Math.round(cjk * 1.05 + (text.length - cjk) / 3.8);
}

export function normalizeOpenAiBaseUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('请填写独立副 API 地址。');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('独立副 API 地址不是有效 URL。');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('独立副 API 地址只支持 http 或 https。');
  url.hash = '';
  let pathname = url.pathname.replace(/\/+$/, '');
  pathname = pathname.replace(/\/chat\/completions$/i, '');
  url.pathname = pathname || '/v1';
  return url.toString().replace(/\/$/, '');
}

export function createIndependentRequest(settings, messages) {
  const channel = Array.isArray(settings?.channels)
    ? getActiveChannel(settings)
    : normalizeChannel(settings);
  const model = String(channel.model ?? '').trim();
  if (!model) throw new Error('请填写独立副 API 模型。');
  if (!Array.isArray(messages) || !messages.length) throw new Error('翻译请求没有消息内容。');
  const payload = {
    stream: false,
    messages,
    model,
    chat_completion_source: 'openai',
    reverse_proxy: normalizeOpenAiBaseUrl(channel.url),
    proxy_password: String(channel.key ?? ''),
    temperature: channel.temperature,
    max_tokens: channel.maxTokens,
    presence_penalty: 0,
    frequency_penalty: 0,
  };
  // Sent only when the channel picks one; stays excludable like the numeric knobs above.
  if (channel.reasoningEffort) payload.reasoning_effort = channel.reasoningEffort;
  const protectedFields = new Set(['stream', 'messages', 'model', 'chat_completion_source', 'reverse_proxy', 'proxy_password']);
  for (const parameter of channel.excludeParams) {
    if (!protectedFields.has(parameter)) delete payload[parameter];
  }
  return payload;
}

export function parseModelListResponse(data) {
  const list = data?.data ?? data?.models ?? [];
  if (!Array.isArray(list)) return [];
  return [...new Set(list
    .map(item => typeof item === 'string' ? item : item?.id)
    .filter(item => typeof item === 'string' && item.trim())
    .map(item => item.trim()))].sort();
}

export function createGenerationGate() {
  let pending = null;
  return Object.freeze({
    begin(chatId, type, dryRun = false) {
      if (!chatId || dryRun || typeof type !== 'string' || ['quiet', 'impersonate'].includes(type)) return false;
      pending = { chatId: String(chatId), type };
      return true;
    },
    consume(chatId, type) {
      const matched = Boolean(pending && pending.chatId === String(chatId) && pending.type === type);
      if (matched) pending = null;
      return matched;
    },
    clear() {
      pending = null;
    },
    peek() {
      return pending ? { ...pending } : null;
    },
  });
}

// Affixes normally travel inside AFFIX_START/AFFIX_END so they can be removed exactly. Editors,
// clipboards and third-party regex rules do sometimes drop the invisible pair while leaving the
// visible text behind; re-rendering then nested a second copy inside the first, which is what
// "双重前后缀标签" looks like.
//
// Only a matching open/close tag pair is repaired. Symbol affixes such as ☆{ … } are indistinguishable
// from ordinary punctuation a scene may legitimately open and close with, and guessing there would
// eat real source text, so those are reported rather than rewritten.
const AFFIX_OPEN_TAG_RE = /^<[A-Za-z][A-Za-z0-9_:-]*(?:\s[^<>]*)?>$/;
const AFFIX_CLOSE_TAG_RE = /^<\/[A-Za-z][A-Za-z0-9_:-]*\s*>$/;

function repairableAffixPair(prefix, suffix) {
  return AFFIX_OPEN_TAG_RE.test(String(prefix ?? '')) && AFFIX_CLOSE_TAG_RE.test(String(suffix ?? ''));
}

function affixLeftoverStripper(metadata) {
  const prefix = String(metadata?.segment_prefix ?? '');
  const suffix = String(metadata?.segment_suffix ?? '');
  if (!repairableAffixPair(prefix, suffix)) return value => value;
  return value => {
    const text = String(value ?? '');
    return text.startsWith(prefix) && text.endsWith(suffix) && text.length >= prefix.length + suffix.length
      ? text.slice(prefix.length, text.length - suffix.length)
      : text;
  };
}

// True when a floor still carries visible tag affixes that have lost their invisible boundaries.
export function detectUnmarkedAffixes(text, metadata) {
  const stripped = normalizeNewlines(String(text ?? ''))
    .replace(TRANSLATION_BLOCK_RE, '')
    .replace(SOURCE_BLOCK_RE, (_match, inner) => inner.replace(AFFIX_RE, ''))
    .replace(HIDDEN_BLOCK_RE, '');
  return [
    [metadata?.segment_prefix, metadata?.segment_suffix],
    [metadata?.translation_prefix, metadata?.translation_suffix],
  ].some(([prefix, suffix]) => repairableAffixPair(prefix, suffix)
    && stripped.includes(String(prefix)) && stripped.includes(String(suffix)));
}

// The source view (default) restores replace-tag regions to their original language for
// re-translation; the prompt view keeps the visible translation and drops the hidden original.
export function stripGeneratedTranslationLines(text, metadata, view = 'source') {
  const upgraded = upgradeLegacyBilingual(text, metadata);
  const stripLeftoverAffix = affixLeftoverStripper(metadata);
  const collapsed = view === 'prompt'
    ? upgraded.replace(HIDDEN_BLOCK_RE, '')
    : upgraded.replace(REPLACE_PAIR_RE, (_match, original) => original);
  return collapsed
    .replace(TRANSLATION_BLOCK_RE, '')
    .replace(SOURCE_BLOCK_RE, (_match, source) => stripLeftoverAffix(source.replace(AFFIX_RE, '')))
    .replace(GENERATED_BLOCK_RE, '')
    .split('\n')
    .filter(line => !LEGACY_GENERATED_LINE_RE.test(line))
    .join('\n');
}

function generatedBlockAfter(value) {
  const current = String(value ?? '');
  const owned = current.match(new RegExp(`^\\n${TRANSLATION_START}([\\s\\S]*?)${TRANSLATION_END}`));
  if (owned) return { full: owned[0], text: owned[1].replace(AFFIX_RE, ''), modern: true, owned: true };
  const modern = current.match(new RegExp(`^\\n\\{${INVISIBLE_MARKER}([\\s\\S]*?)${INVISIBLE_MARKER}\\}(?=\\n|$)`));
  if (modern) return { full: modern[0], text: modern[1], modern: true };
  const legacy = current.match(new RegExp(`^\\n\\{${INVISIBLE_MARKER}([^\\r\\n]*)\\}(?=\\n|$)`));
  return legacy ? { full: legacy[0], text: legacy[1], modern: false } : null;
}

export function translationAffixes(options = {}) {
  return {
    prefix: typeof options.translationPrefix === 'string' ? options.translationPrefix : DEFAULT_SETTINGS.translationPrefix,
    suffix: typeof options.translationSuffix === 'string' ? options.translationSuffix : DEFAULT_SETTINGS.translationSuffix,
  };
}

// The affixes sit inside the invisible markers, so a stored block has to shed them before it is read back.
export function stripTranslationAffixes(text, affixes = {}) {
  let body = String(text ?? '');
  const prefix = String(affixes.prefix ?? '');
  const suffix = String(affixes.suffix ?? '');
  if (prefix && body.startsWith(prefix)) body = body.slice(prefix.length);
  if (suffix && body.endsWith(suffix)) body = body.slice(0, body.length - suffix.length);
  return body;
}

export function extractGeneratedTranslations(text, options = {}) {
  const source = normalizeNewlines(text);
  const segmented = segmentSource(stripGeneratedTranslationLines(source), {
    ...options, legacyWrappers: !source.includes(SOURCE_START) && source.includes(`{${INVISIBLE_MARKER}`),
  });
  const prefix = typeof options.segmentPrefix === 'string' ? options.segmentPrefix : '';
  const suffix = typeof options.segmentSuffix === 'string' ? options.segmentSuffix : '';
  const translations = new Map();
  let cursor = 0;

  for (const layoutPart of segmented.layout.filter(part => part.type === 'segment')) {
    const ids = Array.isArray(layoutPart.ids) && layoutPart.ids.length ? layoutPart.ids : [layoutPart.id];
    const original = layoutPart.sourceText ?? layoutPart.text;
    const ownedSources = new RegExp(SOURCE_BLOCK_RE.source, 'g');
    ownedSources.lastIndex = cursor;
    let match, start = -1, renderedSource = '';
    while ((match = ownedSources.exec(source))) {
      if (match[1].replace(AFFIX_RE, '') !== original) continue;
      start = match.index;
      renderedSource = match[0];
      break;
    }
    if (start < 0) {
      renderedSource = `${prefix}${layoutPart.sourceText ?? layoutPart.text}${suffix}`;
      start = source.indexOf(renderedSource, cursor);
    }
    if (start < 0) continue;
    const end = start + renderedSource.length;
    const generated = generatedBlockAfter(source.slice(end));
    if (generated?.text?.trim()) {
      const body = generated.owned ? generated.text : stripTranslationAffixes(generated.text, {
        prefix: options.translationPrefix ?? '', suffix: options.translationSuffix ?? '',
      });
      const lines = generated.modern ? normalizeNewlines(body).split('\n') : [body];
      if (ids.length === lines.length) {
        ids.forEach((id, index) => {
          const translation = lines[index].trim();
          if (translation) translations.set(id, translation);
        });
      } else if (ids.length === 1) {
        translations.set(ids[0], normalizeNewlines(body).replace(/\n+/g, ' ').trim());
      }
    }
    cursor = end + (generated?.full?.length || 0);
  }
  return translations;
}

export function interceptGenerationChat(chat) {
  if (!Array.isArray(chat)) return 0;
  let changed = 0;
  for (const [index, item] of chat.entries()) {
    if (!item || typeof item.mes !== 'string') continue;
    const stripped = stripGeneratedTranslationLines(item.mes, item.extra?.[MESSAGE_META_KEY], 'prompt');
    if (stripped !== item.mes) {
      // Some hosts pass shallow prompt copies. Never mutate the canonical message object.
      chat[index] = { ...item, mes: stripped };
      changed += 1;
    }
  }
  return changed;
}

// The plain translated text of a floor, used to trigger the host's worldinfo from translations.
export function extractTranslationBlockText(text) {
  const source = normalizeNewlines(String(text ?? ''));
  const chunks = [];
  for (const match of source.matchAll(TRANSLATION_BLOCK_RE)) chunks.push(match[1].replace(AFFIX_RE, ''));
  return chunks.join('\n');
}

function scanTagGroups(source, tagName, options = {}) {
  const tag = String(tagName || '').trim();
  if (!VALID_TAG_RE.test(tag)) throw new Error(`标签名称无效：${tag || '（空）'}`);
  const target = tag.toLowerCase();
  const tokenPattern = /\\?<\/?([A-Za-z][A-Za-z0-9_:-]*)(?:\s[^<>]*?)?\s*\/?>/g;
  const stack = [];
  const groups = [];
  let strayCloses = 0;
  for (const match of source.matchAll(tokenPattern)) {
    if (String(match[1]).toLowerCase() !== target) continue;
    const raw = match[0];
    const closing = /^\\?<\//.test(raw);
    const selfClosing = /\/\s*>$/.test(raw);
    if (selfClosing && !closing) {
      if (options.includeSelfClosing) {
        groups.push({
          tagName: tag,
          openStart: match.index,
          contentStart: match.index + raw.length,
          closeStart: match.index + raw.length,
          closeEnd: match.index + raw.length,
          openTag: raw,
          closeTag: '',
          selfClosing: true,
        });
      }
      continue;
    }
    if (!closing) {
      stack.push({ start: match.index, end: match.index + raw.length, raw });
      continue;
    }
    const open = stack.pop();
    if (!open) {
      strayCloses += 1;
      continue;
    }
    groups.push({
      tagName: tag,
      openStart: open.start,
      contentStart: open.end,
      closeStart: match.index,
      closeEnd: match.index + raw.length,
      openTag: open.raw,
      closeTag: raw,
    });
  }
  groups.sort((left, right) => left.openStart - right.openStart);
  groups.unclosedOpens = stack.length;
  groups.unclosedStack = stack.slice();
  groups.strayCloses = strayCloses;
  return groups;
}

// True when the tag opens but never closes, which is what a half-streamed floor looks like.
export function hasUnclosedTag(text, tagName) {
  const tag = String(tagName || '').trim();
  if (!VALID_TAG_RE.test(tag)) return false;
  const target = tag.toLowerCase();
  const tokenPattern = /\\?<\/?([A-Za-z][A-Za-z0-9_:-]*)(?:\s[^<>]*?)?\s*\/?>/g;
  let depth = 0;
  for (const match of normalizeNewlines(String(text ?? '')).matchAll(tokenPattern)) {
    if (match[1].toLowerCase() !== target) continue;
    const token = match[0];
    if (token.endsWith('/>')) continue;
    if (token.includes('</')) depth = Math.max(0, depth - 1);
    else depth += 1;
  }
  return depth > 0;
}

export function extractTaggedRegions(text, tagNames = DEFAULT_SETTINGS.bodyTags, options = {}) {
  const source = normalizeNewlines(text);
  const tags = parseTagNames(tagNames, DEFAULT_SETTINGS.bodyTags);
  const mode = options.mode === 'replace' ? 'replace' : 'bilingual';
  const regions = [];
  const missingTags = [];
  let unbalanced = 0;
  let assumedCloses = 0;
  for (const tag of tags) {
    const groups = scanTagGroups(source, tag);
    unbalanced += (groups.unclosedOpens || 0) + (groups.strayCloses || 0);
    // Some presets never emit the closing tag at all. A hard failure helps nobody, so an opener with
    // no partner is read as running to the end of the message. Complete groups always win over this.
    if (!groups.length && groups.unclosedStack?.length) {
      const open = groups.unclosedStack.at(-1);
      groups.push({
        tagName: tag,
        openStart: open.start,
        contentStart: open.end,
        closeStart: source.length,
        closeEnd: source.length,
        openTag: open.raw,
        closeTag: '',
        assumedClose: true,
      });
      assumedCloses += 1;
    }
    if (!groups.length) {
      missingTags.push(tag);
      continue;
    }
    const selected = groups.at(-1);
    regions.push({
      ...selected,
      mode,
      inner: source.slice(selected.contentStart, selected.closeStart),
    });
  }
  if (!regions.length) {
    if (mode === 'replace') {
      return { source, regions, missingTags, unbalanced, assumedCloses };
    }
    if (unbalanced) {
      throw new Error(`正文标签没有成对闭合：${tags.map(tag => `<${tag}>`).join('、')}。这一楼可能还在生成，或预设输出的标签不完整。`);
    }
    throw new Error(`当前 AI 回复中没有找到正文标签：${tags.map(tag => `<${tag}>`).join('、')}。`);
  }
  regions.sort((left, right) => left.openStart - right.openStart);
  regions.unbalanced = unbalanced;
  regions.assumedCloses = assumedCloses;
  for (let index = 1; index < regions.length; index += 1) {
    if (regions[index].openStart < regions[index - 1].closeEnd) {
      throw new Error(`正文提取标签发生嵌套：<${regions[index - 1].tagName}> 与 <${regions[index].tagName}>。请只保留外层正文标签。`);
    }
  }
  return { source, regions, missingTags, unbalanced, assumedCloses };
}

// Body and replace regions live in one floor and are rebuilt in a single pass, so they may sit side
// by side but never overlap. Both the runtime path and the tag inspector go through here, which is
// what lets the inspector warn about a nesting the translation would otherwise only hit at run time.
export function mergeExtractedRegions(body, replace) {
  const regions = [...(body?.regions ?? []), ...(replace?.regions ?? [])]
    .sort((left, right) => left.openStart - right.openStart);
  for (let index = 1; index < regions.length; index += 1) {
    if (regions[index].openStart < regions[index - 1].closeEnd) {
      throw new Error(`<${regions[index - 1].tagName}> 与 <${regions[index].tagName}> 的区域交叉重叠，请检查提取标签与替换标签的嵌套。镜译不支持标签嵌套。`);
    }
  }
  return {
    source: String(body?.source ?? replace?.source ?? ''),
    regions,
    missingTags: [...(body?.missingTags ?? []), ...(replace?.missingTags ?? [])],
    unbalanced: (body?.unbalanced || 0) + (replace?.unbalanced || 0),
    assumedCloses: (body?.assumedCloses || 0) + (replace?.assumedCloses || 0),
  };
}

export function inspectTagConfiguration(text, bodyTags, excludedTags, segmentOptions = {}) {
  const source = normalizeNewlines(text);
  const body = parseTagNames(bodyTags, DEFAULT_SETTINGS.bodyTags);
  const excluded = parseTagNames(excludedTags);
  const errors = [];
  const bodyResults = body.map(tag => {
    try {
      const groups = scanTagGroups(source, tag);
      const unclosedOpens = groups.unclosedOpens || 0;
      const strayCloses = groups.strayCloses || 0;
      // Still reported, but no longer fatal: the complete groups above remain usable.
      if (unclosedOpens) {
        errors.push(groups.length
          ? `最后一组 <${tag}> 没有对应的结束标签，已改用前面 ${groups.length} 组完整内容。`
          : `<${tag}> 没有结束标签，已把开标签之后到楼层末尾的内容当作正文。`);
      }
      if (strayCloses) errors.push(`发现 ${strayCloses} 个没有对应开始标签的 </${tag}>，已忽略。`);
      return {
        tag,
        count: groups.length,
        selected: groups.length ? groups.length : null,
        // Only present when something is actually unbalanced, so the common shape stays clean.
        ...(unclosedOpens ? { unclosedOpens } : {}),
        ...(strayCloses ? { strayCloses } : {}),
      };
    } catch (error) {
      errors.push(error.message);
      // A tag that opens but has not closed yet is a floor still being written, not a wrong setting.
      const streaming = hasUnclosedTag(source, tag);
      return { tag, count: 0, selected: null, streaming, error: error.message };
    }
  });
  const excludedResults = excluded.map(tag => {
    try {
      const groups = scanTagGroups(source, tag, { includeSelfClosing: true });
      return { tag, count: groups.length };
    } catch (error) {
      errors.push(error.message);
      return { tag, count: 0, error: error.message };
    }
  });
  // Replace tags used to be absent from this report, so the common
  // <story_scene><status>…</status></story_scene> shape passed the check and only failed once a
  // translation was actually running.
  const replace = parseTagNames(segmentOptions.replaceTags);
  const replaceResults = replace.map(tag => {
    try {
      const groups = scanTagGroups(source, tag);
      return { tag, count: groups.length };
    } catch (error) {
      errors.push(error.message);
      return { tag, count: 0, error: error.message };
    }
  });
  let paragraphs = 0;
  let translationUnits = 0;
  let customPreservedLines = 0;
  let builtinPreservedLines = 0;
  const structuralTags = new Set();
  if (!errors.length && bodyResults.some(result => result.count)) {
    try {
      const extraction = mergeExtractedRegions(
        extractTaggedRegions(source, body),
        replace.length ? extractTaggedRegions(source, replace, { mode: 'replace' }) : null,
      );
      let nextId = 1;
      for (const region of extraction.regions) {
        const segmented = segmentSource(region.inner, { ...segmentOptions, excludedTags: excluded, startId: nextId });
        paragraphs += segmented.paragraphs;
        translationUnits += segmented.segments.length;
        customPreservedLines += segmented.customPreservedLines;
        builtinPreservedLines += segmented.builtinPreservedLines;
        segmented.structuralTags.forEach(tag => structuralTags.add(tag));
        nextId += segmented.segments.length;
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
  return {
    bodyTags: bodyResults,
    excludedTags: excludedResults,
    replaceTags: replaceResults,
    paragraphs,
    translationUnits,
    customPreservedLines,
    builtinPreservedLines,
    structuralTags: [...structuralTags].sort(),
    errors: [...new Set(errors)],
  };
}

export function extractTaggedRegion(text, tagName = DEFAULT_SETTINGS.bodyTags[0]) {
  const extraction = extractTaggedRegions(text, [tagName]);
  const region = extraction.regions[0];
  return {
    ...region,
    before: extraction.source.slice(0, region.openStart),
    after: extraction.source.slice(region.closeEnd),
  };
}

export function rebuildTaggedRegion(region, inner) {
  return `${region.before}${region.openTag}${inner}${region.closeTag}${region.after}`;
}

export function rebuildTaggedRegions(extraction, replacements) {
  const source = String(extraction?.source ?? '');
  const regions = Array.isArray(extraction?.regions) ? extraction.regions : [];
  let output = source;
  for (let index = regions.length - 1; index >= 0; index -= 1) {
    const region = regions[index];
    const replacement = typeof replacements === 'function'
      ? replacements(region, index)
      : Array.isArray(replacements)
        ? replacements[index]
        : replacements?.get?.(region) ?? region.inner;
    output = `${output.slice(0, region.contentStart)}${String(replacement ?? '')}${output.slice(region.closeStart)}`;
  }
  return output;
}

function outermostExcludedRanges(source, tagNames) {
  const ranges = [];
  for (const tag of parseTagNames(tagNames)) {
    for (const group of scanTagGroups(source, tag, { includeSelfClosing: true })) {
      ranges.push({ start: group.openStart, end: group.closeEnd, tagName: tag });
    }
  }
  ranges.sort((left, right) => left.start - right.start || right.end - left.end);
  const outermost = [];
  for (const range of ranges) {
    const previous = outermost.at(-1);
    if (previous && range.start >= previous.start && range.end <= previous.end) continue;
    if (previous && range.start < previous.end) {
      throw new Error(`排除标签交叉重叠：<${previous.tagName}> 与 <${range.tagName}>。`);
    }
    outermost.push(range);
  }
  return outermost;
}

function maskExcludedTags(source, tagNames) {
  const blocks = [];
  let masked = '';
  let cursor = 0;
  for (const [index, range] of outermostExcludedRanges(source, tagNames).entries()) {
    const token = `\uE000JY_EXCLUDED_${index}\uE001`;
    masked += `${source.slice(cursor, range.start)}${token}`;
    blocks.push({ token, text: source.slice(range.start, range.end) });
    cursor = range.end;
  }
  masked += source.slice(cursor);
  return { masked, blocks };
}

function replaceMaskedBlocks(value, blocks, mode) {
  let output = String(value ?? '');
  for (const block of blocks) output = output.split(block.token).join(mode === 'restore' ? block.text : '');
  return output;
}

function stripSegmentWrappers(value, prefix, suffix) {
  let result = String(value ?? '');
  if (prefix && result.startsWith(prefix)) result = result.slice(prefix.length);
  if (suffix && result.endsWith(suffix)) result = result.slice(0, -suffix.length);
  return result;
}

function splitPhysicalLines(value) {
  const lines = String(value ?? '').split('\n');
  return lines.map((text, index) => ({ text, separator: index < lines.length - 1 ? '\n' : '' }));
}

function stripStructuralTags(value, structuralTags) {
  return String(value ?? '').replace(STRUCTURAL_TAG_RE, (_raw, name) => {
    structuralTags?.add(String(name).toLowerCase());
    return '';
  });
}

// Presentation tags a preset puts around a line of dialogue. The translation is sent to the model
// with every tag stripped — it has to be, or the model starts translating markup — and for a long
// time it came back and was written down bare. A preset that paints dialogue therefore painted the
// original and left the translation grey, which reads as "翻译把对话的颜色弄掉了".
//
// Only a wrapper that encloses the whole line is carried, and only these tags: they change how the
// line looks and nothing else. Block tags would change the layout and anchors would give the
// translation a link the original's author never put there.
const CARRYABLE_FORMAT_TAGS = new Set([
  'span', 'font', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins',
  'mark', 'small', 'big', 'sub', 'sup', 'q', 'cite', 'abbr', 'tt',
]);
// Presentation attributes only. Copying an event handler or an id onto a second element would be
// this extension inventing behaviour the floor never had.
const CARRYABLE_FORMAT_ATTRS = new Set(['style', 'color', 'class', 'size', 'face']);
const COLOR_DECLARATION_RE = /^(?:-webkit-text-fill-)?color\s*:/i;

function sanitizeFormatOpenTag(raw, tag) {
  const attributes = [];
  for (const match of raw.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    const name = match[1].toLowerCase();
    if (!CARRYABLE_FORMAT_ATTRS.has(name)) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (/[<>]/.test(value)) continue;
    attributes.push(`${name}="${value.replace(/"/g, '&quot;')}"`);
  }
  return `<${tag}${attributes.length ? ` ${attributes.join(' ')}` : ''}>`;
}

// Used when speaker colouring already painted the line: the carried bold and italic still apply, but
// two colours on one line would just be the outer one losing silently.
export function withoutCarriedColor(openTag) {
  return String(openTag ?? '')
    .replace(/\scolor\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\sstyle\s*=\s*"([^"]*)"/i, (_whole, css) => {
      const kept = css.split(';').map(item => item.trim()).filter(item => item && !COLOR_DECLARATION_RE.test(item));
      return kept.length ? ` style="${kept.join(';')}"` : '';
    });
}

// True when the opening tag at the head of `rest`'s parent closes exactly at the end of the line,
// i.e. it really wraps everything rather than being the first of several siblings.
function wrapperClosesAtEnd(rest, tag) {
  const pattern = new RegExp(`<(/?)${tag}(?:\\s[^<>]*?)?\\s*(/?)>`, 'gi');
  let depth = 1;
  for (const match of rest.matchAll(pattern)) {
    if (match[2] === '/') continue;
    depth += match[1] === '/' ? -1 : 1;
    if (depth > 0) continue;
    return rest.slice(match.index + match[0].length).trim() === ''
      ? { inner: rest.slice(0, match.index) }
      : null;
  }
  return null;
}

/**
 * The presentation wrapper around a whole source line, ready to be re-applied to its translation.
 *
 * Returns null unless the line really is wrapped and really has text inside — a line that is only
 * tags has nothing to carry, and a line with two sibling spans has no single wrapper to speak of.
 */
export function lineFormatting(line) {
  let body = String(line ?? '');
  const opens = [];
  const closes = [];
  for (let depth = 0; depth < 4; depth += 1) {
    const match = body.match(/^\s*<([A-Za-z][A-Za-z0-9]*)(?:\s[^<>]*?)?\s*>/);
    if (!match) break;
    const tag = match[1].toLowerCase();
    if (!CARRYABLE_FORMAT_TAGS.has(tag)) break;
    const closed = wrapperClosesAtEnd(body.slice(match[0].length), tag);
    if (!closed) break;
    opens.push(sanitizeFormatOpenTag(match[0], tag));
    closes.unshift(`</${tag}>`);
    body = closed.inner;
  }
  if (!opens.length || !stripStructuralTags(body).trim()) return null;
  return { open: opens.join(''), close: closes.join('') };
}

function isClosingTagOnlyLine(value) {
  const source = String(value ?? '');
  const tokens = [...source.matchAll(STRUCTURAL_TAG_RE)];
  return tokens.length > 0
    && tokens.every(match => /^\\?<\//.test(match[0]))
    && stripStructuralTags(source).trim() === '';
}

function isBuiltinPreservedLine(value) {
  const visible = stripStructuralTags(value)
    .replace(HTML_ENTITY_RE, '')
    .replace(/\\(?=[\\`*_{}\[\]()#+\-.!|<>])/g, '')
    .trim();
  return Boolean(visible) && !/[\p{L}\p{N}]/u.test(visible);
}

export function segmentSource(text, options = {}) {
  const source = stripGeneratedTranslationLines(text);
  const layout = [];
  const segments = [];
  const prefix = typeof options.segmentPrefix === 'string' ? options.segmentPrefix : '';
  const suffix = typeof options.segmentSuffix === 'string' ? options.segmentSuffix : '';
  const startId = clampInteger(options.startId, 1, Number.MAX_SAFE_INTEGER, 1);
  const parsedRules = parsePreserveLineRulesWithErrors(options.preserveLineRules);
  if (parsedRules.errors.length) throw new Error(parsedRules.errors.join(' '));
  const { masked, blocks } = maskExcludedTags(source, options.excludedTags);
  const structuralTags = new Set();
  let paragraphs = 0;
  let customPreservedLines = 0;
  let builtinPreservedLines = 0;
  let body = masked;
  const leading = body.match(/^(?:[ \t]*\n)+/)?.[0] || '';
  if (leading) {
    layout.push({ type: 'raw', text: replaceMaskedBlocks(leading, blocks, 'restore') });
    body = body.slice(leading.length);
  }
  const trailing = body.match(/(?:\n[ \t]*)+$/)?.[0] || '';
  if (trailing) body = body.slice(0, -trailing.length);

  const appendParagraph = maskedParagraph => {
    if (!maskedParagraph) return;
    const restoredParagraph = replaceMaskedBlocks(maskedParagraph, blocks, 'restore');
    const unwrapped = options.legacyWrappers === true
      ? stripSegmentWrappers(maskedParagraph, prefix, suffix)
      : maskedParagraph;
    const lines = splitPhysicalLines(unwrapped).map(line => {
      const sourceLine = replaceMaskedBlocks(line.text, blocks, 'restore');
      const withoutExcluded = replaceMaskedBlocks(line.text, blocks, 'remove');
      const lineStructuralTags = new Set();
      const translationText = stripStructuralTags(withoutExcluded, lineStructuralTags).trim();
      lineStructuralTags.forEach(tag => structuralTags.add(tag));
      const customPreserved = matchesPreserveLine(sourceLine, parsedRules.rules);
      const builtinPreserved = !customPreserved && (
        isBuiltinPreservedLine(translationText)
        || (!translationText && lineStructuralTags.size > 0)
      );
      if (customPreserved) customPreservedLines += 1;
      if (builtinPreserved) builtinPreservedLines += 1;
      return {
        source: sourceLine,
        separator: line.separator,
        translationText,
        semantic: Boolean(translationText) && !customPreserved && !builtinPreserved,
        closingTagOnly: isClosingTagOnlyLine(withoutExcluded),
        // Read from the masked text so an excluded block inside the line cannot be mistaken for
        // part of the wrapper; the tokens that stand in for it carry no angle brackets.
        format: lineFormatting(line.text),
      };
    });
    const firstSemantic = lines.findIndex(line => line.semantic);
    if (firstSemantic < 0) {
      layout.push({ type: 'raw', text: restoredParagraph });
      return;
    }
    let lastIncluded = lines.length - 1;
    while (lastIncluded > firstSemantic && lines[lastIncluded].closingTagOnly) lastIncluded -= 1;

    const leading = lines.slice(0, firstSemantic).map(line => `${line.source}${line.separator}`).join('');
    if (leading) layout.push({ type: 'raw', text: leading });

    if (options.paragraphPerLine === true) {
      const selected = lines.slice(firstSemantic, lastIncluded + 1);
      const lastSemantic = selected.reduce((last, line, index) => (line.semantic ? index : last), -1);
      let pendingRaw = '';
      selected.forEach((line, index) => {
        const separator = index < selected.length - 1 ? line.separator : '';
        if (!line.semantic) {
          pendingRaw += `${line.source}${separator}`;
          return;
        }
        if (pendingRaw) {
          layout.push({ type: 'raw', text: pendingRaw });
          pendingRaw = '';
        }
        const segment = { id: startId + segments.length, text: line.translationText };
        segments.push(segment);
        layout.push({
          type: 'segment',
          id: segment.id,
          ids: [segment.id],
          text: segment.text,
          sourceText: line.source,
          formats: [line.format ?? null],
          padAfter: index !== lastSemantic,
        });
        paragraphs += 1;
        if (separator) layout.push({ type: 'raw', text: separator });
      });
      if (pendingRaw) layout.push({ type: 'raw', text: pendingRaw });
      const tail = `${lines[lastIncluded].separator}${lines.slice(lastIncluded + 1)
        .map(line => `${line.source}${line.separator}`)
        .join('')}`;
      if (tail) layout.push({ type: 'raw', text: tail });
      return;
    }

    const ids = [];
    const unitTexts = [];
    const unitFormats = [];
    for (let index = firstSemantic; index <= lastIncluded; index += 1) {
      const line = lines[index];
      if (!line.semantic) continue;
      const segment = { id: startId + segments.length, text: line.translationText };
      segments.push(segment);
      ids.push(segment.id);
      unitTexts.push(segment.text);
      unitFormats.push(line.format ?? null);
    }
    const sourceText = lines.slice(firstSemantic, lastIncluded + 1)
      .map((line, index, selected) => `${line.source}${index < selected.length - 1 ? line.separator : ''}`)
      .join('');
    layout.push({
      type: 'segment',
      id: ids[0],
      ids,
      text: unitTexts.join('\n'),
      sourceText,
      formats: unitFormats,
    });
    paragraphs += 1;

    const trailing = `${lines[lastIncluded].separator}${lines.slice(lastIncluded + 1)
      .map(line => `${line.source}${line.separator}`)
      .join('')}`;
    if (trailing) layout.push({ type: 'raw', text: trailing });
  };

  const separatorPattern = /\n(?:[ \t]*\n)+/g;
  let cursor = 0;
  for (const match of body.matchAll(separatorPattern)) {
    appendParagraph(body.slice(cursor, match.index));
    layout.push({ type: 'raw', text: replaceMaskedBlocks(match[0], blocks, 'restore') });
    cursor = match.index + match[0].length;
  }
  appendParagraph(body.slice(cursor));
  if (trailing) layout.push({ type: 'raw', text: replaceMaskedBlocks(trailing, blocks, 'restore') });
  return {
    source,
    layout,
    segments,
    paragraphs,
    customPreservedLines,
    builtinPreservedLines,
    structuralTags: [...structuralTags].sort(),
  };
}

// When the floor's body changed while the API was working, the ids no longer line up, but the
// paragraphs that were not touched still have identical source text. Carrying those across turns a
// total loss into a partial write that 补译 can finish.
export function remapTranslationsBySource(previousSegments, translations, currentSegments) {
  const carried = new Map();
  if (!(translations instanceof Map) || !translations.size) return carried;
  const byText = new Map();
  for (const segment of Array.isArray(previousSegments) ? previousSegments : []) {
    const text = String(segment?.text ?? '');
    if (!translations.has(segment?.id)) continue;
    if (!byText.has(text)) byText.set(text, []);
    byText.get(text).push(segment.id);
  }
  for (const segment of Array.isArray(currentSegments) ? currentSegments : []) {
    const queue = byText.get(String(segment?.text ?? ''));
    if (!queue?.length) continue;
    const sourceId = queue.shift();
    const value = translations.get(sourceId);
    if (value) carried.set(segment.id, value);
  }
  return carried;
}

export function createTranslationSignature(regions) {
  return JSON.stringify((Array.isArray(regions) ? regions : []).map(region => ({
    tag: String(region?.tagName ?? '').toLowerCase(),
    segments: (Array.isArray(region?.segments) ? region.segments : []).map(segment => String(segment?.text ?? '')),
  })));
}

function unwrapResponseContent(raw) {
  let value = raw;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!value || typeof value !== 'object') break;
    const content = value.content;
    if ((typeof content === 'string' && content.trim()) || (content && typeof content === 'object')) {
      value = content;
      continue;
    }
    const reasoning = value.reasoning ?? value.reasoning_content ?? value.thinking;
    if (typeof reasoning === 'string' && reasoning.trim()) {
      value = reasoning;
      continue;
    }
    break;
  }
  return value;
}

/**
 * The model's own thinking, wherever this provider decided to put it.
 *
 * Every provider spells it differently and buries it at a different depth, and none of it is part of
 * the translation — it is only evidence of what the minutes went into. Pulled out separately so a
 * reader who waited through them can see it without the parser ever confusing it with an answer.
 */
export function extractReasoningText(raw) {
  const seen = new Set();
  const walk = (value, depth) => {
    if (!value || typeof value !== 'object' || depth > 4 || seen.has(value)) return '';
    seen.add(value);
    for (const key of ['reasoning_content', 'reasoning', 'thinking', 'thought']) {
      const found = value[key];
      if (typeof found === 'string' && found.trim()) return found;
    }
    for (const key of ['choices', 'message', 'delta', 'content', 'data', '0']) {
      const child = Array.isArray(value) ? value[0] : value[key];
      const found = walk(child, depth + 1);
      if (found) return found;
    }
    return Array.isArray(value) ? walk(value[0], depth + 1) : '';
  };
  return walk(raw, 0);
}

function findJsonFragmentEnd(text, start) {
  const opening = text[start];
  if (opening !== '{' && opening !== '[') return -1;
  const stack = [opening];
  let inString = false;
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{' || character === '[') stack.push(character);
    else if (character === '}' || character === ']') {
      const expected = character === '}' ? '{' : '[';
      if (stack.at(-1) !== expected) return -1;
      stack.pop();
      if (!stack.length) return index;
    }
  }
  return -1;
}

function parseJsonCandidates(raw) {
  const value = unwrapResponseContent(raw);
  if (value && typeof value === 'object') return [value];
  if (typeof value !== 'string') return [];
  const cleaned = value.replace(/<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
  const candidates = [cleaned];
  for (const match of cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(match[1].trim());
  const fragmentStarts = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < cleaned.length; index += 1) {
    const character = cleaned[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{' || character === '[') fragmentStarts.push(index);
  }
  for (const start of fragmentStarts.slice(-240)) {
    const end = findJsonFragmentEnd(cleaned, start);
    if (end > start) candidates.push(cleaned.slice(start, end + 1));
  }

  const parsed = [];
  const seen = new Set();
  for (const candidate of candidates) {
    try {
      const result = JSON.parse(candidate);
      const signature = JSON.stringify(result);
      if (!seen.has(signature)) {
        seen.add(signature);
        parsed.push(result);
      }
    } catch {
      // Try the next recoverable JSON envelope.
    }
  }
  return parsed;
}

function translationItems(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return [];
  for (const key of ['translations', 'items', 'results', 'data']) {
    if (Array.isArray(parsed[key])) return parsed[key];
  }
  const numericEntries = Object.entries(parsed).filter(([key]) => /^\d+$/.test(key));
  if (numericEntries.length) return numericEntries.map(([id, text]) => ({ id: Number(id), text }));
  if (['id', 'segment_id', 'segmentId'].some(key => Object.hasOwn(parsed, key))) return [parsed];
  return [];
}

const TRANSLATION_PLACEHOLDER_RE = /^(?:[<\[(（【]\s*)?(?:none|null|nil|empty|undefined|n\/a|no\s+translation|not?\s+applicable|untranslated)(?:\s*[>\])）】])?$/i;

function normalizeTranslationText(value) {
  if (typeof value !== 'string') return '';
  let text = value.trim().replace(/^```(?:text)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (text.startsWith('{') && text.endsWith('}') && text.length > 2) text = text.slice(1, -1).trim();
  text = text.replaceAll(INVISIBLE_MARKER, '').replace(/\r?\n+/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
  text = text.replace(/^(?:中文|译文|translation)\s*[:：]\s*/i, '').trim();
  // Some models answer a segment they decided not to translate with a placeholder token. Writing that
  // into the floor is worse than reporting the segment as missing, which lets 补译 pick it up.
  if (TRANSLATION_PLACEHOLDER_RE.test(text)) return '';
  return text;
}

// The optional speaker/emotion labels. They are display metadata: a value that is missing, wrong or
// nonsense costs the line its colour and nothing else, so nothing here is allowed to throw or to
// reach the translated text itself.
function readAnnotation(object) {
  if (!object) return null;
  const speaker = String(object.speaker ?? object.who ?? object.name ?? object.character ?? '').trim().slice(0, 60);
  const emotion = String(object.emotion ?? object.emo ?? object.mood ?? object.tone ?? '').trim().slice(0, 40);
  if (!speaker && !emotion) return null;
  const rawIntensity = object.intensity ?? object.level ?? object.strength;
  const intensity = Number(rawIntensity);
  const annotation = {};
  if (speaker) annotation.speaker = speaker;
  if (emotion) annotation.emotion = emotion;
  if (Number.isFinite(intensity)) annotation.intensity = Math.min(2, Math.max(0, Math.round(intensity)));
  return annotation;
}

function lineProtocolItems(raw) {
  const value = unwrapResponseContent(raw);
  if (typeof value !== 'string') return [];
  return normalizeNewlines(value).split('\n').map(line => {
    const match = line.trim().match(/^(?:\[|【)?\s*(\d+)\s*(?:\]|】)?\s*[:：|]\s*(.+)$/);
    return match ? { id: Number(match[1]), text: match[2] } : null;
  }).filter(Boolean);
}

// A whole floor sent as one request is capped by the channel's own output budget, so a long floor
// truncates the JSON and comes back missing most of its ids. Batches are sized from that budget:
// 0.8 chars per token leaves headroom for JSON overhead and thinking; a truncating channel is
// recovered by the repair loop rather than by shrinking every batch up front.
export function translationCharBudget(maxTokens) {
  const tokens = clampInteger(maxTokens, 256, MAX_OUTPUT_TOKENS_LIMIT, DEFAULT_CHANNEL.maxTokens);
  return clampInteger(Math.round(tokens * 0.8), 400, 160000, 1400);
}

export function planTranslationBatches(segments, options = {}) {
  const list = Array.isArray(segments) ? segments.filter(Boolean) : [];
  if (!list.length) return [];
  // The character budget is the only constraint; segment counts never split a batch.
  const maxChars = clampInteger(options.maxChars, 200, 200000, 1400);
  const batches = [];
  let current = [];
  let chars = 0;
  for (const segment of list) {
    const length = String(segment?.text ?? '').length;
    // A single oversized segment still travels alone rather than being dropped or split.
    if (current.length && chars + length > maxChars) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(segment);
    chars += length;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function recoverStructuredTranslations(raw, expectedSegments) {
  const expected = Array.isArray(expectedSegments) ? expectedSegments : [];
  const expectedIds = new Set(expected.map(item => Number(item.id)));
  const parsedCandidates = parseJsonCandidates(raw);
  const items = [];
  const seenItems = new Set();
  for (const parsed of parsedCandidates) {
    for (const item of translationItems(parsed)) {
      const signature = typeof item === 'string' ? `text:${item}` : `json:${JSON.stringify(item)}`;
      if (!seenItems.has(signature)) {
        seenItems.add(signature);
        items.push(item);
      }
    }
  }
  if (!items.length) items.push(...lineProtocolItems(raw));
  const translations = new Map();
  const annotations = new Map();
  const warnings = [];
  const unresolved = [];

  items.forEach((item, index) => {
    const object = item && typeof item === 'object' && !Array.isArray(item) ? item : null;
    const rawText = typeof item === 'string'
      ? item
      : object?.text ?? object?.chinese ?? object?.translation ?? object?.zh ?? object?.cn;
    const text = normalizeTranslationText(rawText);
    const rawId = object?.id ?? object?.segment_id ?? object?.segmentId ?? object?.index;
    const id = Number(rawId);
    const annotation = readAnnotation(object);
    if (!text) {
      warnings.push(`第 ${Number.isInteger(id) ? id : index + 1} 项为空，已留待补译。`);
      return;
    }
    if (Number.isInteger(id) && expectedIds.has(id)) {
      if (!translations.has(id)) {
        translations.set(id, text);
        if (annotation) annotations.set(id, annotation);
      } else warnings.push(`第 ${id} 项重复，已保留第一条。`);
      return;
    }
    unresolved.push({ index, text, annotation });
  });

  if (items.length === expected.length) {
    for (const item of unresolved) {
      const fallbackId = Number(expected[item.index]?.id);
      if (expectedIds.has(fallbackId) && !translations.has(fallbackId)) {
        translations.set(fallbackId, item.text);
        if (item.annotation) annotations.set(fallbackId, item.annotation);
        warnings.push(`第 ${fallbackId} 项缺少有效 id，已按位置恢复。`);
      }
    }
  }

  const missingIds = expected.map(item => Number(item.id)).filter(id => !translations.has(id));
  const unwrapped = unwrapResponseContent(raw);
  let contentCharacters = 0;
  if (typeof unwrapped === 'string') contentCharacters = unwrapped.length;
  else if (unwrapped && typeof unwrapped === 'object') {
    try {
      contentCharacters = JSON.stringify(unwrapped).length;
    } catch {
      contentCharacters = 0;
    }
  }
  const response = {
    envelope: Array.isArray(raw) ? 'array' : raw === null ? 'null' : typeof raw,
    topLevelKeys: raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw).slice(0, 12) : [],
    contentType: Array.isArray(unwrapped) ? 'array' : unwrapped === null ? 'null' : typeof unwrapped,
    contentCharacters,
    parsedCandidates: parsedCandidates.length,
    recoveredItems: items.length,
    annotatedItems: annotations.size,
  };
  return { translations, annotations, missingIds, warnings, parsed: parsedCandidates.length > 0, response };
}

export function parseStructuredTranslations(raw, expectedSegments) {
  const recovered = recoverStructuredTranslations(raw, expectedSegments);
  if (!recovered.translations.size) throw new Error('副模型没有返回可恢复的译文。');
  if (recovered.missingIds.length) throw new Error(`副模型缺少第 ${recovered.missingIds.join('、')} 段译文。`);
  return recovered.translations;
}

export function assembleBilingual(layout, translationMap, options = {}) {
  const allowMissing = options.allowMissing === true;
  const pieces = [];
  for (const part of layout) {
    if (part.type === 'raw' || part.type === 'blank') {
      pieces.push(part.text);
      continue;
    }
    const ids = Array.isArray(part.ids) && part.ids.length ? part.ids : [part.id];
    const missingIds = ids.filter(id => !translationMap.get(id));
    if (missingIds.length && !allowMissing) throw new Error(`缺少第 ${missingIds.join('、')} 段译文。`);
    pieces.push(renderSourceBlock(part.sourceText ?? part.text, options));
    const decoration = segmentDecoration(options.styleFor, ids, ids.map(id => translationMap.get(id)).filter(Boolean));
    const body = translationUnitBody(part, ids, translationMap, options, decoration);
    if (body) {
      pieces.push(`\n${renderTranslationBlock(body, {
        ...options,
        padAfter: part.padAfter === true,
        ...decoration,
        // The body is already shaped line by line above, rhythm and carried formatting included.
        styleBody: null,
      })}`);
    }
  }
  return pieces.join('');
}

function markedAffix(value) {
  return value ? `${AFFIX_START}${value}${AFFIX_END}` : '';
}

/**
 * Builds one unit's translated body, line by line.
 *
 * Two things happen per line rather than per block. The rhythm contour reads one line at a time, and
 * the carried formatting belongs to the line it came from — a paragraph where only the dialogue line
 * is painted has to come back with only that line painted.
 *
 * The carried tags go in as marked affixes, so `AFFIX_RE` strips them on read-back exactly like the
 * speaker wrapper: 补译 still sees the plain translation and the main model still sees the original.
 */
function translationUnitBody(part, ids, translationMap, options, decoration = {}) {
  const carry = options.carryFormatting !== false;
  const formats = Array.isArray(part?.formats) ? part.formats : [];
  const lines = [];
  ids.forEach((id, index) => {
    const translation = translationMap.get(id);
    if (!translation) return;
    const shaped = styledBody(String(translation), decoration.styleBody);
    const format = carry ? formats[index] : null;
    if (!format?.open) {
      lines.push(shaped);
      return;
    }
    // Speaker colouring is an explicit choice about this line's colour, so it wins; the carried
    // weight and slant still apply underneath it.
    const open = decoration.paintsColor ? withoutCarriedColor(format.open) : format.open;
    lines.push(`${markedAffix(open)}${shaped}${markedAffix(format.close)}`);
  });
  return lines.join('\n');
}

// Speaker and emotion styling rides inside the same invisible affix markers the visible prefixes
// use. That is the whole trick: nothing new has to learn how to strip it, the main model's prompt
// never sees it, and a floor written with colouring on reads back identically with it off.
function segmentDecoration(styleFor, ids, texts = []) {
  if (typeof styleFor !== 'function') return {};
  let decoration;
  try {
    decoration = styleFor(ids, texts);
  } catch {
    return {}; // A palette problem must never cost the reader their translation.
  }
  if (!decoration?.open) return {};
  return {
    stylePrefix: String(decoration.open),
    styleSuffix: String(decoration.close ?? ''),
    styleBody: typeof decoration.emphasis === 'function' ? decoration.emphasis : null,
    paintsColor: decoration.paintsColor === true,
  };
}

/**
 * Applies the per-clause rhythm inside one translation.
 *
 * Every tag goes in wrapped as its own marked affix, which is what makes this safe: `AFFIX_RE` is
 * global, so the same read-back that already strips the outer wrapper strips these too. A floor with
 * rhythm therefore still yields the exact translation for 补译 and the exact original for the main
 * model — the invariant is unchanged, there are just more markers inside the block.
 */
function styledBody(translation, styleBody) {
  if (typeof styleBody !== 'function') return translation;
  let pieces;
  try {
    pieces = styleBody(translation);
  } catch {
    return translation; // Rhythm is decoration; it never costs the reader their translation.
  }
  if (!Array.isArray(pieces) || !pieces.length) return translation;
  // Refuse anything that does not reassemble into the exact translation, so a bad split is inert
  // rather than a silent rewrite of the text.
  if (pieces.map(piece => piece?.text ?? '').join('') !== translation) return translation;
  // Reassembly alone does not prove the split was safe: cutting a line that carries its own markup
  // between `style="color:` and the rest still rejoins perfectly while nesting a tag inside another
  // tag's attribute. Anything with markup in it keeps its own structure.
  if (translation.includes('<')) return translation;
  // Nothing to carry means nothing to wrap: a line split into runs that all came back bare is the
  // line itself, and wrapping it would only add markers for a reader to strip later.
  if (!pieces.some(piece => piece?.css || piece?.className)) return translation;
  return pieces
    .map(piece => {
      const attributes = [
        piece.className ? `class="${piece.className}"` : '',
        piece.css ? `style="${piece.css}"` : '',
      ].filter(Boolean).join(' ');
      return attributes
        ? `${markedAffix(`<span ${attributes}>`)}${piece.text}${markedAffix('</span>')}`
        : piece.text;
    })
    .join('');
}

export function renderSourceBlock(source, options = {}) {
  return `${SOURCE_START}${markedAffix(options.segmentPrefix ?? '')}${source}${markedAffix(options.segmentSuffix ?? '')}${SOURCE_END}`;
}

// A replace-tag pair: the translation rides in the source-block position so the host prompt keeps
// it as plain floor text, while the original hides in the trailing block for re-translation.
export function renderReplacePair(translation, source, decoration = {}) {
  const open = markedAffix(decoration.stylePrefix ?? '');
  const close = markedAffix(decoration.styleSuffix ?? '');
  const body = styledBody(String(translation ?? ''), decoration.styleBody);
  return `${SOURCE_START}${open}${body}${close}${SOURCE_END}\n${HIDDEN_START}${String(source ?? '')}${HIDDEN_END}`;
}

export function assembleReplace(layout, translationMap, options = {}) {
  const allowMissing = options.allowMissing === true;
  const pieces = [];
  for (const part of layout) {
    if (part.type === 'raw' || part.type === 'blank') {
      pieces.push(part.text);
      continue;
    }
    const ids = Array.isArray(part.ids) && part.ids.length ? part.ids : [part.id];
    const sourceText = part.sourceText ?? part.text;
    const decoration = segmentDecoration(options.styleFor, ids, ids.map(id => translationMap.get(id)).filter(Boolean));
    const body = translationUnitBody(part, ids, translationMap, options, decoration);
    if (!body) {
      if (!allowMissing) throw new Error(`缺少第 ${ids.join('、')} 段译文。`);
      // Untranslated replace segments stay as their original plain text, ready for 补译.
      pieces.push(sourceText);
      continue;
    }
    pieces.push(renderReplacePair(body, sourceText, { ...decoration, styleBody: null }));
  }
  return pieces.join('');
}

// Seeds for 补译: each replace pair's source block holds that part's translation.
// A partly translated floor has fewer pairs than segments, so the pairs are matched against the
// hidden original rather than consumed by position. Getting that wrong silently shifted every
// remaining translation one segment earlier and overwrote good paragraphs on the next run.
export function extractReplaceTranslations(text, options = {}) {
  const segmented = segmentSource(stripGeneratedTranslationLines(text), { ...options, legacyWrappers: false });
  const pairs = [];
  for (const match of String(text ?? '').matchAll(REPLACE_PAIR_BOTH_RE)) {
    pairs.push({ translation: match[1].replace(AFFIX_RE, ''), original: match[2].replace(AFFIX_RE, '') });
  }
  const translations = new Map();
  let cursor = 0;
  for (const part of segmented.layout.filter(item => item.type === 'segment')) {
    const sourceText = String(part.sourceText ?? part.text ?? '');
    const pair = pairs[cursor];
    // An untranslated segment has no pair of its own; leave the queue where it is for the next one.
    if (!pair || pair.original !== sourceText) continue;
    cursor += 1;
    const body = pair.translation;
    if (typeof body !== 'string' || !body.trim()) continue;
    const ids = Array.isArray(part.ids) && part.ids.length ? part.ids : [part.id];
    const lines = normalizeNewlines(body).split('\n');
    if (ids.length === lines.length) {
      ids.forEach((id, line) => {
        const translation = lines[line].trim();
        if (translation) translations.set(id, translation);
      });
    } else if (ids.length === 1) {
      translations.set(ids[0], normalizeNewlines(body).replace(/\n+/g, ' ').trim());
    }
  }
  return translations;
}

// The blank line that separates one pair from the next lives INSIDE the boundaries, so stripping the
// translation also removes it and the main model still sees the original line structure.
export function renderTranslationBlock(translation, options = {}) {
  const { prefix, suffix } = translationAffixes(options);
  const padding = options.padAfter === true ? '\n' : '';
  // The speaker/emotion wrapper sits inside the visible affixes, so a beautify regex written against
  // <jy-source>…</jy-translation> keeps matching whether or not colouring is on.
  const open = markedAffix(`${prefix}${options.stylePrefix ?? ''}`);
  const close = markedAffix(`${options.styleSuffix ?? ''}${suffix}`);
  const body = styledBody(String(translation ?? ''), options.styleBody);
  return `${TRANSLATION_START}${open}${body}${close}${padding}${TRANSLATION_END}`;
}

// Upgrade only source paragraphs proven by saved metadata AND an adjacent legacy translation.
// Without that provenance, legacy translations still filter, but ordinary source symbols stay.
export function upgradeLegacyBilingual(text, metadata) {
  const source = normalizeNewlines(text);
  if (!metadata || Number(metadata.schema_version) >= 4 || !source.includes(`{${INVISIBLE_MARKER}`)) return source;
  const options = {
    segmentPrefix: metadata.segment_prefix ?? '', segmentSuffix: metadata.segment_suffix ?? '',
    translationPrefix: metadata.translation_prefix ?? '', translationSuffix: metadata.translation_suffix ?? '',
    excludedTags: metadata.excluded_tags ?? [], preserveLineRules: metadata.preserve_line_rules ?? '',
    legacyWrappers: true,
  };
  let extraction;
  try { extraction = extractTaggedRegions(source, metadata.body_tags ?? DEFAULT_SETTINGS.bodyTags); }
  catch { return source; } // An edited legacy wrapper must not block generation or trigger guessed removals.
  return rebuildTaggedRegions(extraction, region => {
    let cursor = 0;
    const parts = [];
    for (const part of segmentSource(region.inner, options).layout) {
      if (part.type !== 'segment') continue;
      const original = part.sourceText ?? part.text;
      const wrapped = `${options.segmentPrefix}${original}${options.segmentSuffix}`;
      const start = region.inner.indexOf(wrapped, cursor);
      if (start < 0) continue;
      const end = start + wrapped.length;
      const generated = generatedBlockAfter(region.inner.slice(end));
      if (!generated || generated.owned) continue;
      const translation = stripTranslationAffixes(generated.text, { prefix: options.translationPrefix, suffix: options.translationSuffix });
      parts.push(region.inner.slice(cursor, start), renderSourceBlock(original, options), '\n', renderTranslationBlock(translation, {
        translationPrefix: `{${options.translationPrefix}`, translationSuffix: `${options.translationSuffix}}`,
      }));
      cursor = end + generated.full.length;
    }
    parts.push(region.inner.slice(cursor));
    return parts.join('');
  });
}

export function restyleBilingual(text, options = {}, metadata) {
  return upgradeLegacyBilingual(text, metadata)
    .replace(SOURCE_BLOCK_RE, (_match, source) => renderSourceBlock(source.replace(AFFIX_RE, ''), options))
    .replace(TRANSLATION_BLOCK_RE, (match, translation) => {
      // The 每行单独成段 separator is a newline stored after the suffix affix. Reading it back as
      // part of the translation moved the closing affix onto its own line, so it is recovered here
      // and re-applied as padding, keeping a restyle byte-identical when nothing else changed.
      const body = translation.replace(AFFIX_RE, '');
      const padAfter = body.endsWith('\n');
      const inner = padAfter ? body.slice(0, -1) : body;
      // Changing the visible affixes must not silently drop a floor's speaker colours; the wrapper
      // is carried across rather than regenerated, because a restyle has no annotations to work from.
      const stylePrefix = translation.match(SPEAKER_OPEN_RE)?.[0] ?? '';
      return `${match.startsWith('\n') ? '\n' : ''}${renderTranslationBlock(inner, {
        ...options, padAfter, stylePrefix, styleSuffix: stylePrefix ? '</span>' : '',
      })}`;
    });
}

export async function hashText(text) {
  const normalized = normalizeNewlines(text);
  try {
    if (globalThis.crypto?.subtle && typeof TextEncoder !== 'undefined') {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
      return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // Non-secure preview/test environments use the deterministic fallback below.
  }
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}-${normalized.length}`;
}

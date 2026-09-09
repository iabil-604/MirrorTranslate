import { getActiveChannel, getActivePromptProfile, stripGeneratedTranslationLines, MESSAGE_META_KEY } from './core.js?v=0.13.0';
import { composeTranslationSpecification, normalizeTargetLanguage, resolvePromptVariables } from './prompts.js?v=0.13.0';

const WORLD_INFO_SCAN_CONTEXT = 65536;

function cleanReferenceText(value, metadata) {
  return stripGeneratedTranslationLines(String(value ?? ''), metadata)
    .replace(/<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function uniqueChunks(chunks) {
  const seen = new Set();
  const result = [];
  for (const chunk of chunks) {
    const text = cleanReferenceText(chunk);
    if (text && !seen.has(text)) {
      seen.add(text);
      result.push(text);
    }
  }
  return result;
}

function worldInfoChunks(result) {
  if (!result || typeof result !== 'object') return [];
  const chunks = [result.worldInfoBefore, result.worldInfoAfter];
  for (const block of result.worldInfoDepth ?? []) {
    for (const entry of block?.entries ?? []) chunks.push(typeof entry === 'string' ? entry : entry?.content);
  }
  for (const key of ['anBefore', 'anAfter', 'worldInfoExamples']) {
    for (const entry of result[key] ?? []) chunks.push(typeof entry === 'string' ? entry : entry?.content);
  }
  return uniqueChunks(chunks);
}

function messageLabel(context, message) {
  if (message?.is_user) return message.name || context.name1 || 'User';
  return message?.name || context.name2 || 'Assistant';
}

function relevantMessages(snapshot, settings, includeTarget = false) {
  const end = includeTarget ? snapshot.messageId : snapshot.messageId - 1;
  if (end < 0) return [];
  const count = Math.max(1, Number(settings.contextMessages) || 6);
  return snapshot.context.chat.slice(0, end + 1).filter(message => message && !message.is_system).slice(-count);
}

function buildRecentContext(snapshot, settings) {
  if (!settings.includeRecentContext) return '';
  return relevantMessages(snapshot, settings).map(message => {
    const text = cleanReferenceText(message.mes, message.extra?.[MESSAGE_META_KEY]);
    return text ? `【${messageLabel(snapshot.context, message)}】\n${text}` : '';
  }).filter(Boolean).join('\n\n');
}

function buildCharacterContext(context, includeDetails) {
  const names = [context.name1 && `用户显示名：${context.name1}`, context.name2 && `角色显示名：${context.name2}`].filter(Boolean);
  if (!includeDetails || context.groupId || context.characterId === undefined || context.characterId === null) return names.join('\n');
  const character = context.characters?.[Number(context.characterId)];
  if (!character) return names.join('\n');
  const substitute = typeof context.substituteParams === 'function' ? context.substituteParams : value => value;
  const fields = [
    ['角色卡名称', character.name],
    ['角色描述', character.description],
    ['性格', character.personality],
    ['情景', character.scenario],
  ];
  for (const [label, raw] of fields) {
    const text = cleanReferenceText(substitute(String(raw ?? '')));
    if (text) names.push(`【${label}】\n${text}`);
  }
  return names.join('\n\n');
}

async function buildWorldbookContext(snapshot, settings) {
  const context = snapshot.context;
  if (!settings.includeWorldbook || typeof context.getWorldInfoPrompt !== 'function') return '';
  const scan = relevantMessages(snapshot, settings, true).map(message => {
    const text = cleanReferenceText(message.mes);
    return `${messageLabel(context, message)}: ${text}`;
  }).filter(Boolean).reverse();
  if (!scan.length) return '';
  try {
    const result = await context.getWorldInfoPrompt(
      scan,
      Math.max(Number(context.maxContext) || 0, WORLD_INFO_SCAN_CONTEXT),
      true,
    );
    return worldInfoChunks(result).join('\n\n');
  } catch (error) {
    console.warn('[镜译 · 正文翻译器] 读取世界书失败，本轮将不带世界书。', error);
    return '';
  }
}

export async function collectTranslationContext(snapshot, settings, whitelistWorldbook = null) {
  const tokenSaving = getActiveChannel(settings).tokenSaving === true;
  const [worldbook, character] = await Promise.all([
    tokenSaving
      ? Promise.resolve(settings.includeWorldbook ? String(whitelistWorldbook ?? '') : '')
      : buildWorldbookContext(snapshot, settings),
    Promise.resolve(buildCharacterContext(snapshot.context, settings.includeCharacterCard)),
  ]);
  // The token-saving mode caps recent-context floors at two; lower user values stay untouched.
  const contextSettings = tokenSaving
    ? { ...settings, contextMessages: Math.min(clampRecentFloors(settings.contextMessages), 2) }
    : settings;
  return {
    glossary: cleanReferenceText(getActivePromptProfile(settings).glossary),
    character: cleanReferenceText(character),
    worldbook: cleanReferenceText(worldbook),
    recent: cleanReferenceText(buildRecentContext(snapshot, contextSettings)),
  };
}

function clampRecentFloors(value) {
  const count = Number.parseInt(value, 10);
  return Number.isFinite(count) ? count : 2;
}

export function buildTranslationMessages(segments, settings, packet = {}, phase = 'primary', requestMeta = {}) {
  const profile = getActivePromptProfile(settings);
  const messages = [];
  const targetLanguage = normalizeTargetLanguage(profile.targetLanguage);
  const jailbreak = resolvePromptVariables(String(profile.jailbreakPrompt ?? '').trim(), profile);
  if (jailbreak) messages.push({ role: 'system', content: jailbreak });
  messages.push({ role: 'system', content: composeTranslationSpecification(profile) });
  messages.push({ role: 'system', content: resolvePromptVariables(String(profile.checklistPrompt ?? '').trim(), profile) });
  const input = {
    task: 'translate_story_to_target_language',
    source_language: 'auto-detect-per-segment',
    target_language: targetLanguage,
    mode: phase,
    references: {
      glossary: packet.glossary || '',
      character: packet.character || '',
      worldbook: packet.worldbook || '',
      recent: packet.recent || '',
    },
    segments,
  };
  if (phase === 'style_repair') {
    input.draft_translations = requestMeta.draftTranslations || [];
    input.triggered_phrases = requestMeta.triggeredPhrases || [];
  }
  messages.push({
    role: 'user',
    content: JSON.stringify(input),
  });
  // The optional postscript rides after every other entry; empty means it is never sent.
  const postscript = resolvePromptVariables(String(profile.postscript ?? '').trim(), profile);
  if (postscript) {
    messages.push({
      role: ['system', 'user', 'assistant'].includes(profile.postscriptRole) ? profile.postscriptRole : 'user',
      content: postscript,
    });
  }
  return messages;
}

export const __workflowTesting = Object.freeze({ cleanReferenceText, worldInfoChunks });

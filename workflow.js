import { extractTaggedRegions, getActiveChannel, getActivePromptProfile, normalizeTts, stripGeneratedTranslationLines, withoutSpeechMarks, MESSAGE_META_KEY } from './core.js?v=0.35.0-beta.5';
import { composeAnnotationSection, composeTranslationSpecification, normalizeTargetLanguage, resolvePromptVariables } from './prompts.js?v=0.35.0-beta.5';
import { EMOTION_KEYS } from './palette.js?v=0.35.0-beta.5';
import { FISH_EMOTIONS, FISH_SOUNDS, FISH_TONES, SOUND_TAGS } from './tts.js?v=0.35.0-beta.5';

const WORLD_INFO_SCAN_CONTEXT = 65536;

function cleanReferenceText(value, metadata) {
  // The worldbook's request for speaker marks, and the marks, are the reading's business: a translator
  // shown them could start marking its own translation.
  return withoutSpeechMarks(stripGeneratedTranslationLines(String(value ?? ''), metadata))
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

/**
 * The part of a floor worth quoting back as context.
 *
 * The reference used to carry each floor whole. Presets that wrap reasoning blocks, status panels,
 * affinity tables and choice lists around the prose turn one floor into thousands of tokens the
 * translator was never meant to read, with the story itself a small part of it. Quote the same
 * region the translation works on, and nothing else.
 *
 * A user's own message carries no extraction tags and is prose already, so it travels as written.
 * An AI floor with no tags has no body to quote — it is a floor this extension could not have
 * translated either — so it contributes nothing rather than dragging its panels along.
 */
function referenceBody(message, settings) {
  const stripped = stripGeneratedTranslationLines(String(message?.mes ?? ''), message?.extra?.[MESSAGE_META_KEY]);
  if (message?.is_user) return stripped;
  const regions = [];
  for (const [tags, mode] of [[settings.bodyTags, 'bilingual'], [settings.replaceTags, 'replace']]) {
    if (!Array.isArray(tags) || !tags.length) continue;
    try {
      regions.push(...extractTaggedRegions(stripped, tags, { mode }).regions);
    } catch {
      // No usable tag pair here. That is an error on the floor being translated and merely an
      // absence on a floor being quoted, so it stays quiet and contributes nothing.
    }
  }
  if (!regions.length) return '';
  return regions
    .sort((left, right) => left.openStart - right.openStart)
    .map(region => region.inner)
    .join('\n\n');
}

function buildRecentContext(snapshot, settings) {
  if (!settings.includeRecentContext) return '';
  return relevantMessages(snapshot, settings).map(message => {
    const text = cleanReferenceText(referenceBody(message, settings));
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
  // Speaker and emotion labelling is a display feature, so it rides as its own message rather than
  // being edited into the user's translation spec. Turning it off removes it from the request whole.
  const annotate = annotationRequest(settings, phase, requestMeta);
  if (annotate) {
    messages.push({ role: 'system', content: composeAnnotationSection(annotate) });
  }
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
  if (annotate) {
    input.annotate = {
      speaker: annotate.speakers,
      emotion: annotate.emotions,
      ...(annotate.speakers && annotate.roster.length ? { roster: annotate.roster } : {}),
      ...(annotate.emotions ? { emotions: annotate.emotionLabels } : {}),
      ...(annotate.voice ? { quotes: true, ...(annotate.directions ? { direction: true } : {}), tones: annotate.tones, sounds: annotate.sounds } : {}),
    };
  }
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

// The style-repair pass rewrites a finished draft; asking for labels again there would only invite
// the model to change them, so annotation is limited to the passes that actually produce text.
//
// The colouring wants a speaker and a palette mood per line. The reading wants more: Fish's own
// emotion words, the tone when the text names one, and a mark per quoted run, so that a floor is
// ready to be read the moment it is translated and the stream never has to ask a model again.
function annotationRequest(settings, phase, requestMeta) {
  if (phase === 'style_repair') return null;
  const coloring = settings?.coloring;
  // Every reading wants the skeleton from the translation, the plain one included: the translation
  // has read the floor already, so who speaks and how comes with it for nothing, and a translated
  // floor reads from those marks whatever the mode. Only the deep one asks how each line should be read.
  // The deep reading reads the original by itself and takes nothing from the translation.
  const reading = settings?.tts?.enabled === true && settings?.tts?.mode !== 'deep';
  // Directions in the reader's own words read badly; the deep reading asks the sub-model in Fish's
  // words instead, so the translation is never asked for them.
  const directions = false;
  const speakers = coloring?.speakers === true || reading;
  const emotions = coloring?.emotions === true || reading;
  if (!speakers && !emotions) return null;
  return {
    speakers,
    emotions,
    roster: Array.isArray(requestMeta?.roster) ? requestMeta.roster.filter(Boolean).slice(0, 40) : [],
    emotionLabels: reading ? FISH_EMOTIONS : EMOTION_KEYS,
    voice: reading,
    tones: reading ? FISH_TONES : [],
    sounds: reading ? (directions ? SOUND_TAGS : FISH_SOUNDS) : [],
    directions,
    quoteMarks: reading ? normalizeTts(settings.tts).quotePairs : [],
    styles: reading && Array.isArray(requestMeta?.styles) ? requestMeta.styles : [],
  };
}

export const __workflowTesting = Object.freeze({ cleanReferenceText, worldInfoChunks });

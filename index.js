import {
  APP_NAME,
  APP_VERSION,
  DEFAULT_CHANNEL,
  INVISIBLE_MARKER,
  MESSAGE_META_KEY,
  MODULE_ID,
  assembleBilingual,
  assembleReplace,
  extractReplaceTranslations,
  createTranslationSignature,
  extractReasoningText,
  detectUnmarkedAffixes,
  DEFAULT_COLORING,
  normalizeColoring,
  normalizeSpeakerList,
  SPEAKER_CLASS,
  describeSpeechShape,
  splitSpeechParts,
  unifySpeakerNames,
  looksUntranslated,
  MAX_CHANNEL_CONCURRENCY,
  createGenerationGate,
  createIndependentRequest,
  clampInteger,
  estimateRequestTokens,
  extractGeneratedTranslations,
  extractTaggedRegions,
  extractTranslationBlockText,
  getActiveChannel,
  getActivePromptProfile,
  resolveFeatureChannel,
  translationChannelChoice,
  hashText,
  interceptGenerationChat,
  planTranslationBatches,
  remapTranslationsBySource,
  translationCharBudget,
  inspectTagConfiguration,
  mergeExtractedRegions,
  mergeSettings,
  normalizeChannel,
  normalizeOpenAiBaseUrl,
  normalizePromptProfile,
  parseModelListResponse,
  parseTagNames,
  parsePreserveLineRulesWithErrors,
  parseTagNamesWithErrors,
  recoverStructuredTranslations,
  rebuildTaggedRegions,
  segmentSource,
  stripGeneratedTranslationLines,
  upgradeLegacyBilingual,
  restyleBilingual,
  normalizeTts,
  normalizeVoiceList,
  normalizeVoiceLibrary,
  followVoiceLibrary,
  normalizeLanguageCode,
  languageLabel,
  formatPairList,
  parsePairList,
  SPEECH_ENTRY_HEAD,
  parseJsonCandidates,
  TTS_LANGUAGES,
  CONSOLE_KEYS,
  DEFAULT_CONSOLE,
  normalizeConsole,
  normalizeConsolePresets,
  readAnnotationFields,
  MARK_TAGS,
  RECOMMENDED_MARKS,
  FLOOR_BUTTON_MODES,
  withoutSpeechMarks,
} from './core.js?v=0.35.0-beta.2';
import {
  FISH_EMOTIONS,
  FISH_MIME,
  FISH_SOUNDS,
  alignSpansToTimeline,
  analysisCacheKey,
  base64ToBytes,
  buildGlobalTimeline,
  buildSegments,
  buildTtsAnalysisMessages,
  buildRefineAnalysisMessages,
  createSseParser,
  createTimestampCollector,
  cueLabel,
  DEFAULT_TTS_PROMPTS,
  deriveLabelsForSide,
  describeFishFailure,
  findCoveringEntry,
  fingerprintKey,
  fishEndpoint,
  fishHeaders,
  groupSegmentsByLine,
  annotationReading,
  linesFromTaggedText,
  locateAnchors,
  mergeWavBuffers,
  encodeWav,
  parseTtsAnalysis,
  parseVoiceAnalysis,
  plainLineText,
  planVoices,
  playbackWindow,
  recordCovers,
  recordingCacheKey,
  itemIdentity,
  ttsProvider,
  resolveSegmentVoice,
  audibleSegments,
  segmentMuted,
  segmentsInRange,
  splitUtterances,
  toStandardDocument,
  voiceRosterNames,
  voiceSummary,
  consoleDirections,
  SOUND_TAGS,
  detectTtsHost,
  recordPredates,
  recordedLines,
  stampLabels,
  unitAnalyzedAt,
  readSpeechLine,
  speechTagReading,
  SPEECH_MOODS,
  SPEECH_TONES,
  settledSpans,
} from './tts.js?v=0.35.0-beta.2';
import { createTtsStore } from './tts-store.js?v=0.35.0-beta.2';
import { SPEAKER_SOURCE_LABELS, pinSpeakers, refineCast, resolveSpeakers, speakerHints, speakersOf } from './tts-speakers.js?v=0.35.0-beta.2';
import { DEEP_PROMPT, DEEP_STATUS, buildDeepAnalysisMessages, deepRequestSettings } from './tts-deep.js?v=0.35.0-beta.2';

// The built-in prompts by name: the deep reading's comes from its own module.
const TTS_PROMPT_DEFAULTS = Object.freeze({ ...DEFAULT_TTS_PROMPTS, deep: DEEP_PROMPT });
import {
  VISUAL_FIELDS, REGEX_OWNER_KEY,
  normalizeProcessingSettings, getActiveProcessingProfile,
  captureProcessingProfile, selectProcessingProfile, exportProcessingProfile, importProcessingProfile,
  importNativeRegex, makeBuiltinReadingProfile, syncNativeRegex, readNativeRegexEdits,
} from './processing.js?v=0.35.0-beta.2';
import {
  CORE_TRANSLATION_SPEC,
  DEFAULT_AVOID_PHRASES,
  DEFAULT_JAILBREAK_PROMPT,
  DEFAULT_PROMPT_PROFILE,
  HONORIFIC_PRESETS,
  NAME_PRESETS,
  PRE_OUTPUT_CHECKLIST,
  PUNCTUATION_PRESETS,
  STYLE_PRESETS,
  LEANING_PRESETS,
  countPromptCharacters,
  findForbiddenPhraseHits,
  isSimplifiedChineseTarget,
  normalizeTargetLanguage,
  promptOptionLabel,
} from './prompts.js?v=0.35.0-beta.2';
import { buildTranslationMessages, collectTranslationContext } from './workflow.js?v=0.35.0-beta.2';
import { mergeStreamText, readableStreamText, takeStreamPieces } from './tts-stream.js?v=0.35.0-beta.2';
import { createCall, createCallHistory } from './call.js?v=0.35.0-beta.2';
import { describeLog, describeRemaining, estimateRemaining, filterLogs, floorRows, floorState, untranslatedFloors } from './mini.js?v=0.35.0-beta.2';
import {
  DEFAULT_MIN_CONTRAST,
  EMOTION_STYLES,
  adaptColorToBand,
  computeSafeBand,
  emphasisContour,
  isNeutralColor,
  oklchToSrgb,
  parseCssColor,
  resolveSegmentStyle,
  spreadHues,
  srgbToOklch,
  toHex,
} from './palette.js?v=0.35.0-beta.2';
import { sampleThemeBackground } from './theme-probe.js?v=0.35.0-beta.2';
import {
  addDiagnostic,
  clearDiagnostics,
  formatFullDiagnosticReport,
  listDiagnosticFloors,
  readDiagnostics,
} from './diagnostics.js?v=0.35.0-beta.2';

const MENU_ENTRY_ID = `${MODULE_ID}-menu-entry`;
const SETTINGS_ID = `${MODULE_ID}-settings`;
const PANEL_HOST_ID = `${MODULE_ID}-panel-host`;
const FLOATING_ID = `${MODULE_ID}-floating-button`;
const FLOATING_POSITION_KEY = `${MODULE_ID}.floating-position.v1`;
const MINI_HOST_ID = `${MODULE_ID}-mini-host`;
const MINI_GAP = 10;
const INTERCEPTOR_NAME = 'JingyiTranslator_interceptGeneration';
const EXTENSION_API_PATHS = Object.freeze({
  discover: '/api/extensions/discover',
  version: '/api/extensions/version',
  update: '/api/extensions/update',
});

const runtime = {
  initialized: false,
  epoch: 0,
  settings: normalizeProcessingSettings(),
  processingRefresh: Promise.resolve(),
  processingRevision: 0,
  nativeRegexInstalled: false,
  mainGenerationActive: false,
  // Bumped by every generation the gate takes, so a late look at the gate can tell a new one apart.
  generationSerial: 0,
  // The generation last stopped by hand, so the render that follows it can say why it is not translated.
  stoppedGeneration: null,
  activeFloor: null,
  interceptorSeen: false,
  interceptorWarned: false,
  promptFallbackStrips: 0,
  task: {
    status: 'idle',
    title: '等待正文',
    message: '主回复结束后会自动检查当前 AI 楼层。',
    progress: 0,
  },
  // What a reasoning model is currently thinking. `text` is the whole thing so the log and the
  // expanded view can show it; the panel only paints the tail while it streams.
  thinking: { text: '', characters: 0, live: false, batch: 0, revision: 0 },
  // Seconds the last few translation batches, readings and audio parts took, for the wait estimates.
  timing: { translation: [], analysis: [], parts: [] },
  // null means "follow the default for this phase"; a click pins it either way until the next batch.
  thinkingOpen: null,
  // Who the model reported on the last floor, and whether the palette could paint each of them.
  speakerCoverage: null,
  // Every auto-coloured name seen this session, so the generated stylesheet covers them too.
  autoSpeakerNames: new Set(),
  subscribers: new Set(),
  diagnosticSubscribers: new Set(),
  update: { status: 'idle', installType: null, details: null },
  inflight: new Map(),
  generationGate: createGenerationGate(),
  eventBindings: [],
  wiEntries: null,
  // Set by 取色 and folded into the settings on the next save, so a measurement is never lost by
  // saving some unrelated field first.
  probedBand: null,
  probedBandAt: '',
  probeReport: null,
  timers: new Set(),
  autoTimers: new Set(),
  menuCleanup: null,
  settingsCleanup: null,
  floatingCleanup: null,
  panel: null,
  mini: null,
  miniOpening: false,
  floatingHold: false,
  floatingHoldTimer: null,
  floatingPlace: null,
  panelCssPromise: null,
  // The saved connection the connection page has open. Opening one there is only editing: it is never
  // what any feature uses.
  editingChannelId: null,
  // Reading aloud. Audio and analyses persist in IndexedDB; everything here is per session.
  tts: {
    store: null,
    // floorId|version → { labels, voices, depth }, so a re-render can place the right buttons without asking again.
    analysis: new Map(),
    // Cache key → in-flight promise, so a double click never pays for the same audio twice.
    jobs: new Map(),
    // What each floor has cost Fish since it was last read, so the log can say it in one line.
    fish: new Map(),
    // One pending 「the floor has closed」 pass per floor: a streamed translation announces the same
    // floor a dozen times and only the last one is worth acting on.
    closing: new Map(),
    // The one thing being read: floor, items, position, state. Panels subscribe to it.
    transport: null,
    subscribers: new Set(),
    // Where the reading is inside a sentence, a few times a second: the clock and the bar only.
    progressSubscribers: new Set(),
    // messageId → { floor, segments, items } from the last preparation, for the inspector.
    floors: new Map(),
    // floorId|version → recordings of that text, and the reader's own sentence versions.
    recordings: new Map(),
    overrides: new Map(),
    fingerprint: null,
    inspect: null,
    // messageId|side → the steps of the last run on that floor, kept so the panel can show them after.
    progress: new Map(),
    // floorId|version already made in the background, so a redraw never starts the same run twice.
    pregenerated: new Set(),
    // Floors a generation just wrote, waiting to be read aloud by themselves; and the texts already
    // read that way, so the passes after a translation lands do not read them again.
    fresh: new Set(),
    autoRead: new Set(),
    // 边写边读: the reading of text still being written, the floors read that way, and the generation
    // they belong to (when it started, so the log can say how long the first word took).
    stream: null,
    streamed: new Set(),
    generationId: 0,
    generationStartedAt: null,
    streamRefused: -1,
    // messageId → the mes last decorated, so a redraw with the same text costs one string compare.
    mesSeen: new Map(),
    viewer: null,
    highlighted: null,
    anchorWarned: new Set(),
    // Floors the reader chose to hear plain when asked; the choice lasts the session.
    plainFloors: new Set(),
    // floorId → the text version already cleaned up after, so a redraw does not tidy the same floor twice.
    pruned: new Map(),
    player: null,
    urls: new Map(),
    ranges: new Map(),
    status: new Map(),
    timers: new Map(),
    observer: null,
    clickCleanup: null,
    preview: null,
  },
};

const CONTROL_CENTER_MARKUP = `
<div class="jy-studio" data-jy-root>
<aside class="jy-rail">
  <div class="jy-identity"><span class="jy-monogram" aria-hidden="true">镜</span><div><strong>镜译</strong><small>正文翻译器</small></div></div>
  <nav class="jy-navigation" role="tablist" aria-label="工作区">
  <button type="button" role="tab" aria-selected="true" data-jy-tab="main"><span aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v14H4z"/><path d="M4 10h16"/><path d="M9 14h6"/></svg></span>翻译台</button><button type="button" role="tab" aria-selected="false" data-jy-tab="prompt"><span aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h9l5 5v11H5z"/><path d="M14 4v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/></svg></span>翻译规则</button><button type="button" role="tab" aria-selected="false" data-jy-tab="settings"><span aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/></svg></span>模型连接</button><button type="button" role="tab" aria-selected="false" data-jy-tab="processing"><span aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v16"/><path d="M15 4v16"/><path d="M4 9h16"/><path d="M4 15h16"/></svg></span>正文处理</button><button type="button" role="tab" aria-selected="false" data-jy-tab="tts"><span aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18.3 6.2a8.2 8.2 0 0 1 0 11.6"/></svg></span>朗读</button><button type="button" role="tab" aria-selected="false" data-jy-tab="logs"><span aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/></svg></span>运行记录</button>
  </nav>
  <details class="jy-theme-picker"><summary><span aria-hidden="true">◐</span> 外观</summary><div class="jy-theme-options"><button type="button" data-jy-action="set-theme" data-jy-theme="day" aria-pressed="false"><i aria-hidden="true"></i>日间</button><button type="button" data-jy-action="set-theme" data-jy-theme="night" aria-pressed="false"><i aria-hidden="true"></i>夜间</button><button type="button" data-jy-action="set-theme" data-jy-theme="fresh" aria-pressed="false"><i aria-hidden="true"></i>护眼小清新</button><button type="button" data-jy-action="set-theme" data-jy-theme="vampire" aria-pressed="false"><i aria-hidden="true"></i>华美吸血鬼</button><button type="button" data-jy-action="set-theme" data-jy-theme="glass" aria-pressed="false"><i aria-hidden="true"></i>极简毛玻璃</button></div></details><div class="jy-rail-bottom"><span class="jy-version">v${APP_VERSION}</span><button type="button" data-jy-action="check-update" class="jy-update-button" hidden aria-label="检查镜译更新">↻ <span data-jy-update-label>检查更新</span></button></div><p class="jy-update-notice" data-jy-update-notice hidden role="status"></p>
</aside>
<main class="jy-workspace">
<section class="jy-page" data-jy-page="main" role="tabpanel">
<header class="jy-page-heading"><div><h1>翻译台</h1><span class="jy-page-context" data-jy-desk-context></span></div><button type="button" class="jy-button" data-jy-action="refresh">刷新楼层</button></header>
<div class="jy-desk">
 <div class="jy-manuscript">
  <div class="jy-run-state" aria-live="polite"><span class="jy-dot" data-jy-task-dot="idle"></span><h2 data-jy-task-title>等待正文</h2><span class="jy-run-count" data-jy-current-state>待读取</span></div>
  <div class="jy-progress" aria-hidden="true"><span data-jy-progress></span></div>
  <p class="jy-muted" data-jy-task-message>打开一段故事，从这里开始翻译。</p>
  <section class="jy-thinking" data-jy-thinking hidden>
   <button type="button" class="jy-thinking-head" data-jy-action="toggle-thinking" aria-expanded="false" aria-controls="jy-thinking-body">
    <span class="jy-thinking-pulse" aria-hidden="true"></span>
    <span class="jy-thinking-label" data-jy-thinking-label>模型正在思考</span>
    <span class="jy-thinking-count" data-jy-thinking-count></span>
    <span class="jy-thinking-caret" aria-hidden="true"></span>
   </button>
   <div class="jy-thinking-body" id="jy-thinking-body" data-jy-thinking-body hidden><pre data-jy-thinking-text></pre></div>
  </section>
  <dl class="jy-desk-facts"><div><dt>当前楼层</dt><dd data-jy-floor>—</dd></div><div><dt>滑动页</dt><dd data-jy-swipe>—</dd></div><div><dt>正文规模</dt><dd data-jy-segments>—</dd></div><div><dt>目标语言</dt><dd data-jy-desk-target>—</dd></div></dl>
  <div class="jy-launch"><button type="button" class="jy-button jy-button-primary" data-jy-action="translate">翻译当前回复</button><button type="button" class="jy-button" data-jy-action="translate-missing">补译缺失段落</button></div>
 </div>
 <aside class="jy-desk-side">
  <div class="jy-brief"><span class="jy-overline">翻译方案</span><h3 data-jy-active-profile>待读取</h3><button type="button" class="jy-button" data-jy-action="open-prompt">编辑规则 →</button></div>
  <div class="jy-brief jy-brief-channel"><span class="jy-overline">翻译用的连接</span><label class="jy-brief-field"><span class="jy-sr-only">翻译用哪条连接</span><select data-jy-translation-channel aria-label="翻译用哪条连接"></select></label><span class="jy-badge" data-jy-channel-mode>主 API</span><p class="jy-muted" data-jy-channel-summary></p><label class="jy-brief-field jy-brief-retry"><span class="jy-label">翻译失败后自动重试</span><input type="number" data-jy-field="retries" min="0" max="5" step="1"></label><p class="jy-muted">只管翻译。朗读分析用哪条在「朗读」页单独选，互不牵连。</p><button type="button" class="jy-button" data-jy-action="open-settings">管理连接（地址、密钥、模型）→</button></div>
  <div class="jy-brief"><span class="jy-overline">参考资料</span><p class="jy-muted" data-jy-context-summary></p></div>
 </aside>
</div>
<div class="jy-automation"><div><h3>自动接续翻译</h3><p class="jy-muted">主回复完成后，自动补上译文。</p></div><label class="jy-switch"><input type="checkbox" data-jy-field="autoGeneration" aria-label="主回复完成后自动翻译"><span></span></label><label class="jy-check"><input type="checkbox" data-jy-field="autoSwipe">切换滑动页时补译</label><label class="jy-check"><input type="checkbox" data-jy-field="streamingWriteback">流式写回（beta，勾选后所有翻译走流式；仅独立模式，跟随模式自动回退整包）</label></div>
<div class="jy-automation" data-jy-tts-desk><div><h3>朗读（有声小说）</h3><p class="jy-muted">把译文或原文念出来，旁白和角色各用各的声音，副模型给每句写中文配音指令。关着就是只翻译，楼层里不加任何东西。需要 Fish Audio 的 API Key。</p></div><label class="jy-switch"><input type="checkbox" data-jy-tts-field="enabled" aria-label="朗读功能"><span></span></label><button type="button" class="jy-text-button" data-jy-action="open-tts" hidden>朗读设置 →</button></div>
</section>

<section class="jy-page" data-jy-page="prompt" role="tabpanel" hidden>
<header class="jy-page-heading"><div><h1>翻译规则</h1><span class="jy-page-context" data-jy-prompt-size>0 字</span></div></header>
<div class="jy-profile-bar">
<label><span class="jy-label">当前方案</span><select data-jy-prompt-profile-select></select></label>
<label><span class="jy-label">方案名称</span><input type="text" data-jy-prompt-profile-name maxlength="60"></label>
<label><span class="jy-label">目标语言</span><input type="text" list="jy-target-language-list" data-jy-profile-field="targetLanguage" maxlength="80" placeholder="简体中文"></label>
<datalist id="jy-target-language-list"><option value="简体中文"></option><option value="繁體中文"></option><option value="English"></option><option value="한국어"></option></datalist>
</div>
<div class="jy-profile-tools"><p class="jy-muted" data-jy-language-support></p><details class="jy-menu"><summary>方案管理</summary><div class="jy-menu-actions"><button type="button" class="jy-button" data-jy-action="export-profile">导出当前方案 JSON</button><button type="button" class="jy-button" data-jy-action="import-profile">导入方案 JSON</button><input type="file" data-jy-profile-import accept=".json,application/json" hidden><button type="button" class="jy-button" data-jy-action="duplicate-prompt-profile">复制新方案</button><button type="button" class="jy-button" data-jy-action="refresh-base-prompts">采用新版规范与清单</button><button type="button" class="jy-button" data-jy-action="reset-prompt-profile">恢复当前方案</button><button type="button" class="jy-button" data-jy-action="delete-prompt-profile">删除当前方案</button></div></details></div>
<div class="jy-rule-workbench">
<aside class="jy-rule-directory"><div class="jy-rule-directory-title">标准条目 <span data-jy-modified-count>全部默认</span></div><div data-jy-standard-prompt-list></div><div class="jy-rule-directory-title">自定义条目<button type="button" class="jy-icon-button" data-jy-action="add-prompt-section" aria-label="添加自定义条目">＋</button></div><div data-jy-custom-prompt-list></div><p class="jy-muted jy-empty-small" data-jy-custom-empty>按 ＋ 添加你的规则</p></aside>
<div class="jy-editor-stage" data-jy-editor-stage><div class="jy-editor-placeholder" data-jy-editor-placeholder><span aria-hidden="true">Aa</span><h2>从左侧选择一项规则</h2><p>文风、译名与措辞，都由你决定。</p></div></div>
</div>
<details class="jy-advanced"><summary>后置提示词（附在请求最末尾）</summary><div class="jy-reference-body"><label><span class="jy-label">身份</span><select data-jy-profile-field="postscriptRole"><option value="user">user</option><option value="system">system</option><option value="assistant">assistant</option></select></label><p class="jy-muted">留空时不发送；填写后作为最后一条消息附在全部条目之后，身份可选。</p></div><label><span class="jy-label">内容</span><textarea rows="4" data-jy-profile-field="postscript" placeholder="留空即不发送"></textarea></label></details>
<details class="jy-reference-settings"><summary>参考资料与上下文</summary><div class="jy-reference-body"><label class="jy-check"><input type="checkbox" data-jy-field="includeWorldbook">世界书</label><label class="jy-check"><input type="checkbox" data-jy-field="includeCharacterCard">角色卡设定</label><label class="jy-check"><input type="checkbox" data-jy-field="includeRecentContext">近期对话</label><label><span class="jy-label">近期对话条数</span><input type="number" data-jy-field="contextMessages" min="1" max="20" step="1"></label></div></details>
<footer class="jy-footer"><span class="jy-save-note" data-jy-prompt-save-note>修改后保存方案</span><button type="button" class="jy-button jy-button-primary" data-jy-action="save-prompt">保存方案</button></footer>
</section>

<section class="jy-page" data-jy-page="settings" role="tabpanel" hidden>
<header class="jy-page-heading"><div><h1>模型连接</h1><span class="jy-page-context" data-jy-channel-context>连接库：只存连接，谁用哪条各自去选</span></div><button type="button" class="jy-button" data-jy-action="test-api">测试这条连接</button></header>
<div class="jy-channel-uses" data-jy-channel-uses></div>
<p class="jy-muted" data-jy-api-help>这一页只存连接：地址、密钥、模型、请求参数、后置提示词。下面「正在编辑」选哪一条，只决定你在改哪一条，不会换掉任何功能正在用的连接。翻译用哪条在「翻译台」选，朗读分析和深度分析用哪条在「朗读」页选；「跟随酒馆」不需要在这里存，那几处的下拉框里直接有。</p>
<div class="jy-connection-form" data-jy-independent-panel>
 <div class="jy-form-section"><div class="jy-section-title"><span>01</span><h2>保存的连接</h2></div><div class="jy-form-body"><label><span class="jy-label">正在编辑</span><select data-jy-edit-channel></select></label><p class="jy-muted" data-jy-channel-usage></p><div class="jy-inline-actions"><button type="button" class="jy-button" data-jy-action="add-channel">＋ 新建连接</button><button type="button" class="jy-button" data-jy-action="delete-channel">删除这条连接</button></div><label><span class="jy-label">连接名称</span><input type="text" data-jy-channel-field="name" placeholder="给这个连接起个名字"></label></div></div>
 <div class="jy-form-section"><div class="jy-section-title"><span>02</span><h2>接口与模型</h2></div><div class="jy-form-body">
 <label><span class="jy-label">API 基础地址</span><input type="url" data-jy-channel-field="url" placeholder="https://example.com/v1" autocomplete="off"></label>
 <label><span class="jy-label">API 密钥</span><input type="password" data-jy-channel-field="key" placeholder="无密钥接口可留空" autocomplete="new-password"></label>
 <div class="jy-model-heading"><label class="jy-label" for="jy-api-model-select">选择模型</label><button type="button" class="jy-button" data-jy-action="fetch-models">拉取模型 ↻</button></div>
 <div class="jy-model-picker"><input type="search" data-jy-model-search aria-label="搜索模型" placeholder="搜索模型名称"><select id="jy-api-model-select" data-jy-model-select aria-describedby="jy-api-model-help"><option value="">先拉取模型列表</option></select></div>
 <label><span class="jy-label">当前模型（也可手动填写）</span><input type="text" data-jy-channel-field="model" placeholder="模型名称" autocomplete="off"></label>
 <p id="jy-api-model-help" class="jy-muted" data-jy-model-help></p>
 </div></div>
 <details class="jy-advanced"><summary>请求参数</summary><div class="jy-form-grid">
 <label><span class="jy-label">超时 / 秒</span><input type="number" data-jy-channel-field="timeoutSec" min="10" max="600" step="1"></label><label><span class="jy-label">最大输出 tokens</span><input type="number" data-jy-channel-field="maxTokens" min="256" max="1000000" step="1"></label><label><span class="jy-label">温度</span><input type="number" data-jy-channel-field="temperature" min="0" max="2" step="0.05"></label><label><span class="jy-label">排除参数</span><input type="text" data-jy-channel-field="excludeParams" placeholder="temperature, presence_penalty"></label><label><span class="jy-label">推理强度</span><select data-jy-channel-field="reasoningEffort"><option value="">不发送</option><option value="minimal">minimal</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label><label title="长楼层拆成几批同时发送。越大越快，也越费 token；批次之间看不到彼此的上下文，名字靠术语表保持一致。"><span class="jy-label">并发批次</span><input type="number" data-jy-channel-field="concurrency" min="1" max="4" step="1"></label><label class="jy-check"><input type="checkbox" data-jy-channel-field="tokenSaving">节约 token 模式（世界书只注入白名单，近期对话最多 2 楼）</label>
 </div></details><details class="jy-advanced"><summary>这条连接的后置提示词（附在每次请求的最末尾）</summary><div class="jy-reference-body"><p class="jy-muted">翻译、朗读分析、深度分析——只要走这条连接，这段话都会加在请求的最后。用来关掉思维链、压住模型的废话最管用。每条连接各写各的，留空就不发。</p><div class="jy-form-grid jy-form-grid-tight"><label><span class="jy-label">身份</span><select data-jy-channel-field="postscriptRole"><option value="user">user</option><option value="system">system</option><option value="assistant">assistant</option></select></label></div><textarea data-jy-channel-field="postscript" rows="3" spellcheck="false" placeholder="比如：直接输出结果，不要输出任何思考过程。"></textarea></div></details><details class="jy-advanced"><summary>节约模式世界书白名单</summary><div class="jy-processing-toolbar"><button type="button" class="jy-button" data-jy-action="refresh-wi-entries">刷新可读条目</button></div><div class="jy-wi-list" data-jy-wi-list></div><p class="jy-muted">列出全局挂载与当前角色卡激活的世界书条目；勾选后节约模式下仅注入这些内容，白名单跟随当前角色卡保存。一个都不勾则节约模式下完全不带世界书。</p></details><div class="jy-actions"><button type="button" class="jy-button jy-button-primary" data-jy-action="save-channel">保存连接</button></div>
</div>
<footer class="jy-footer"><span class="jy-save-note">修改后保存设置</span><button type="button" class="jy-button jy-button-primary" data-jy-action="save-settings">保存设置</button></footer>
</section>

<section class="jy-page" data-jy-page="processing" role="tabpanel" hidden>
<header class="jy-page-heading"><div><h1>正文处理</h1><span class="jy-page-context">决定哪些内容会被送去翻译</span></div><button type="button" class="jy-button" data-jy-action="inspect-tags">检查当前楼层</button></header>
<div class="jy-processing-bar">
<label class="jy-processing-choice"><span>方案</span><select aria-label="正文方案" data-jy-processing-select></select></label>
<button type="button" class="jy-button" data-jy-action="import-processing">导入方案</button><button type="button" class="jy-button" data-jy-action="export-processing">导出方案</button>
<details class="jy-profile-menu"><summary>管理</summary><div class="jy-profile-menu-body"><label><span class="jy-label">方案名称</span><input type="text" maxlength="80" data-jy-processing-name></label><div class="jy-processing-toolbar"><button type="button" class="jy-button" data-jy-action="save-processing">保存</button><button type="button" class="jy-text-button" data-jy-action="delete-processing">删除方案</button></div></div></details>
<input type="file" accept=".json,application/json" data-jy-processing-import hidden>
</div>
<div class="jy-processing-columns">
<div class="jy-text-scope"><span class="jy-overline">送去翻译</span><h2>提取正文</h2><label><span class="jy-label">提取标签</span><textarea rows="4" data-jy-field="bodyTags" placeholder="story_scene" spellcheck="false"></textarea></label><p class="jy-muted">每行一个标签名，只取每种标签的最后一组完整内容。</p><label><span class="jy-label">替换标签（译文直接替换原文）</span><textarea rows="3" data-jy-field="replaceTags" placeholder="replace_scene" spellcheck="false"></textarea></label><p class="jy-muted">该标签内的内容照常翻译，但写回时译文直接顶替原文：显示与主模型都只看到译文，原文隐藏保留在楼层里，点小铅笔可见，重新翻译时自动还原。</p></div>
<div class="jy-text-scope"><span class="jy-overline">保留原样</span><h2>保留原样</h2><label><span class="jy-label">排除标签</span><textarea rows="4" data-jy-field="excludedTags" placeholder="thinking&#10;status" spellcheck="false"></textarea></label><p class="jy-muted">标签及内部内容保留在原位。镜译自己的 <code>&lt;say&gt;</code> 说话人标记不用加在这里：翻译时自动去掉，显示时自动隐藏，朗读时自动读取。</p></div>
</div>
<details class="jy-advanced"><summary>原样保留白名单</summary><label><span class="jy-label">每行一条规则</span><textarea rows="5" data-jy-field="preserveLineRules" spellcheck="false" placeholder="此时彼刻&#10;prefix:【系统记录】"></textarea></label><p class="jy-muted">文字匹配整行，prefix: 匹配行首，/正则/ 匹配整行。纯边框、纯符号与标签行自动保留。</p></details>
<details class="jy-advanced"><summary>段落前后缀</summary><div class="jy-affix-group"><span class="jy-label">原文</span><div class="jy-form-grid"><label><span class="jy-label">原文之前</span><input type="text" data-jy-field="segmentPrefix" placeholder="留空即可不加前缀"></label><label><span class="jy-label">原文之后</span><input type="text" data-jy-field="segmentSuffix" placeholder="留空即可不加后缀"></label></div></div><div class="jy-affix-group"><span class="jy-label">译文</span><div class="jy-form-grid"><label><span class="jy-label">译文之前</span><input type="text" data-jy-field="translationPrefix" placeholder="留空即可不加前缀"></label><label><span class="jy-label">译文之后</span><input type="text" data-jy-field="translationSuffix" placeholder="留空即可不加后缀"></label></div></div><label class="jy-check"><input type="checkbox" data-jy-field="paragraphPerLine">每行单独成段</label><label class="jy-check"><input type="checkbox" data-jy-field="carryFormatting">译文跟随原文格式</label><p class="jy-muted">勾选「跟随原文格式」后，原文某一行整行被 <code>&lt;span&gt;</code>、<code>&lt;font&gt;</code>、<code>&lt;b&gt;</code> 这类标签包着时，译文那一行也会套上同一层（只带 style / color / class / size / face，不复制 id、事件等属性）；预设给对话上的颜色不会只剩原文一半。开了说话人着色时以说话人颜色为准，粗体斜体仍然跟随。改这个开关只影响之后翻译的楼层，已有楼层重翻一次才会跟上。<br>留空即不添加。主模型仅保留原文，过滤镜译添加的装饰与译文。<br>默认按空行分段，整段原文后面跟整段译文。勾选后每一行都独立成段，原文与译文逐行贴在一起，各对之间空一行；用于分隔的空行写在不可见边界内，不会进入主模型。</p></details>
<div class="jy-behaviors"><label class="jy-check"><input type="checkbox" data-jy-field="autoEdit">编辑回复后自动重译</label><label class="jy-check"><input type="checkbox" data-jy-field="showFloatingButton">显示悬浮入口</label><label class="jy-inline-field"><span class="jy-label">悬浮入口形态</span><select data-jy-field="floatingStyle"><option value="auto">自动（空闲圆环，翻译中胶囊，手机贴边）</option><option value="ring">始终圆环</option><option value="pill">始终胶囊</option><option value="edge">始终贴边</option></select></label><label class="jy-inline-field"><span class="jy-label">楼层里的朗读按钮</span><select data-jy-field="floorButtons"><option value="line">每段一个（默认，手机也有）</option><option value="sentence">每段一个，再加每句一个</option><option value="off">不显示，只在悬浮窗里点</option></select></label><label class="jy-check"><input type="checkbox" data-jy-field="leftHanded">左手模式（悬浮窗的主按钮靠左）</label></div>
<details class="jy-advanced"><summary>绑定正则 <span data-jy-processing-regex-count></span></summary><div class="jy-processing-toolbar"><button type="button" class="jy-button" data-jy-action="import-processing-regex">导入正则</button></div><input type="file" accept=".json,application/json" multiple data-jy-processing-regex-import hidden><div class="jy-processing-regex-list" data-jy-processing-regex-list></div><p class="jy-muted" data-jy-native-regex-status hidden></p></details>
<details class="jy-advanced" data-jy-coloring><summary>说话人着色与情绪排版</summary>
<p class="jy-muted">副模型只回答「这段谁在说、什么情绪」，颜色与排版全部由镜译按当前主题算出。先点一次「读取当前主题」，再登记角色。</p>
<div class="jy-behaviors"><label class="jy-check"><input type="checkbox" data-jy-field="coloringSpeakers">说话人着色（按发色 / 瞳色）</label><label class="jy-check"><input type="checkbox" data-jy-field="coloringEmotions">情绪排版（字重 / 斜体 / 字号）</label><label class="jy-check"><input type="checkbox" data-jy-field="coloringRhythm">情绪起伏（句内轻重变化）</label><label class="jy-check"><input type="checkbox" data-jy-field="coloringAutoSpeakers">名单外的说话人按名字自动取色</label></div>
<div class="jy-form-grid"><label><span class="jy-label">对比度目标</span><input type="number" data-jy-field="coloringContrast" min="1.5" max="12" step="0.1"></label><label><span class="jy-label">彩度 <span data-jy-vividness-value></span></span><input type="range" data-jy-field="coloringVividness" min="0" max="100" step="5"></label></div>
<div class="jy-processing-toolbar"><button type="button" class="jy-button jy-button-primary" data-jy-action="probe-theme">读取当前主题与壁纸</button><button type="button" class="jy-button" data-jy-action="add-speaker">添加角色</button></div>
<div class="jy-band-report" data-jy-band-report></div>
<div class="jy-speaker-report" data-jy-speaker-report hidden></div>
<div class="jy-speaker-list" data-jy-speaker-list></div>
<p class="jy-muted">名单外的说话人默认按名字哈希自动取色，同一个名字在任何设备任何聊天里都是同一个颜色；关掉这项，没登记的人就只有情绪排版、没有颜色。<br>黑、白、银不参与着色：这三种是主题自己的文字颜色，认不出说话人。发色是黑白银的角色会按名字分到一个固定色相，同一个名字永远是同一个颜色。改主题或换壁纸后重新点一次「读取当前主题」即可，已翻译楼层重翻或补译后会用新颜色。</p>
</details>
<details class="jy-advanced"><summary>内置美化</summary><div class="jy-processing-toolbar"><select aria-label="内置美化" data-jy-reading-style><option value="cute">可爱风</option><option value="minimal">极简风</option><option value="fold">原文折叠</option></select><button type="button" class="jy-button" data-jy-action="builtin-processing">使用</button></div></details>
<pre class="jy-inspection" data-jy-tag-inspection hidden></pre>
<footer class="jy-footer"><span class="jy-save-note">修改后保存设置</span><button type="button" class="jy-button jy-button-primary" data-jy-action="save-settings">保存设置</button></footer>
</section>

<section class="jy-page" data-jy-page="tts" role="tabpanel" hidden>
<header class="jy-page-heading"><div><h1>朗读</h1><span class="jy-page-context">旁白和每个角色各用各的声音，多国语言各配各的音色，点哪句读哪句</span></div><button type="button" class="jy-button" data-jy-action="tts-test">测试连接</button></header>
<div class="jy-automation" data-jy-tts-master><div><h3>朗读功能</h3><p class="jy-muted">打开后，楼层里每个自然段后面会出现「播放」和「重新生成」两个按钮，楼层开头有一个小的「朗读」；按钮只加在页面上，不写进楼层。关掉就是一般模式：只翻译，这一页收起，后台不做任何事。</p></div><label class="jy-switch"><input type="checkbox" data-jy-tts-field="enabled" aria-label="朗读功能"><span></span></label></div>
<div class="jy-form-grid jy-form-grid-tight"><label><span class="jy-label">分析模式</span><select data-jy-tts-field="mode"><option value="off">不分析：直接读正文，只加你配的标点标签</option><option value="simple">简单分析：谁在说、什么情绪、什么语气</option><option value="deep">深度分析：在骨架上再看一遍，定情绪浓度和表演</option></select></label><label data-jy-tts-ask-field><span class="jy-label">没翻译、没分析过的楼，按播放时</span><select data-jy-tts-field="askAnalysis"><option value="ask">问我一下</option><option value="analyze">先让副模型分析一次再读</option><option value="plain">直接读，程序认人</option></select></label></div>
<p class="jy-muted" data-jy-tts-mode-help></p>
<details class="jy-form-section jy-fold" data-jy-fold="tts-read"><summary class="jy-section-title"><span>01</span><h2>读什么</h2><span class="jy-fold-summary" data-jy-fold-summary></span></summary><div class="jy-form-body">
<div class="jy-form-grid jy-form-grid-tight"><label title="简单分析、「分析这一楼」、按意见改、从角色卡和世界书识别角色，都走这条。和翻译用哪条互不相干。"><span class="jy-label">朗读分析用的连接</span><select data-jy-tts-field="analysisChannelId"><option value="follow">跟随酒馆（酒馆当前的连接和模型）</option></select></label></div>
<p class="jy-muted">翻译和朗读各挑各的连接，谁也不跟着谁：翻译在「翻译台」选，朗读在这里选，深度分析还能在「05 深度分析」里再单挑一条。换翻译的连接不会动这里。连接本身（地址、密钥、模型、后置提示词）存在「模型连接」页——那一页只是个架子，在那里点开哪条都不改变这里的选择。</p>
<div class="jy-form-grid jy-form-grid-tight"><label><span class="jy-label">朗读语言</span><select data-jy-tts-field="side"><option value="translation">译文</option><option value="source">原文</option><option value="both">译文 + 原文（各自生成，点哪个读哪个）</option></select></label><label><span class="jy-label">朗读范围</span><select data-jy-tts-field="range"><option value="all">旁白 + 对白</option><option value="dialogue">只读对白</option><option value="narration">只读旁白</option></select></label><label><span class="jy-label">「保存到本地」保存什么</span><select data-jy-tts-field="downloadScope"><option value="auto">整楼音频（默认）</option><option value="floor">整楼音频</option><option value="current">正在读的那一段</option><option value="sentence">正在读的那一句</option></select></label></div>
<div class="jy-behaviors"><label class="jy-check"><input type="checkbox" data-jy-tts-field="emotionCues">把配音指令一起发给 Fish（关掉只读字）</label><label class="jy-check"><input type="checkbox" data-jy-tts-field="sanitizeHtml">发给 Fish 前去掉正文里的 HTML（颜色、字号这类美化只留在页面上）</label><label class="jy-check"><input type="checkbox" data-jy-tts-field="prosodySplit">按分析出的语速、音量拆分请求（Fish 的语速音量按请求生效）</label><label class="jy-check"><input type="checkbox" data-jy-tts-field="autoGenerate">最新一楼分析完自动生成音频，不播放</label><label class="jy-check"><input type="checkbox" data-jy-tts-field="autoRead">新回复自动朗读（只读最新一楼，写完才读；正在读别的楼时只提醒、不打断）</label><label class="jy-check"><input type="checkbox" data-jy-tts-field="readWhileWriting">边写边读（主模型一边写，一边一句一句读出来；读模型写出的原文，不等翻译）</label><label class="jy-check"><input type="checkbox" data-jy-tts-field="playAfterGenerate">点播放后，做完直接播（关掉就只生成，再点一次才播）</label><label class="jy-check"><input type="checkbox" data-jy-tts-field="tamePunctuation">连续的！！！压成一个，强度交给情绪标签</label></div>
<p class="jy-muted">开着翻译的楼，翻译时就顺手标好了谁在说、什么情绪，不再请求副模型；没翻译的楼只在你按播放、点单句或「朗读」时才请求，整楼一次，走上面选的朗读分析连接；勾了「自动生成音频」才会翻完就做；勾了「新回复自动朗读」，新回复写完（开着翻译就等译文写回）就自己从头读。勾了「边写边读」，主模型一边写，镜译一边按句请求 Fish、按顺序读出来：读的是模型写出的原文，不等翻译，需要酒馆开着流式输出；运行记录里每一楼会记下首字、首句、出声各用了多久。每个自然段后面的「播放」只读这一段，读完就停；「重新生成」丢掉这一段的音频再向 Fish 要一次（同一段文字 Fish 每次读得不一样）；电脑手机都有。想要每句一个按钮，「正文处理」页的「楼层里的朗读按钮」选「每段一个，再加每句一个」。改一句发给 Fish 的内容，仍然在悬浮窗的朗读页。</p>
<div class="jy-form-grid jy-form-grid-tight"><label><span class="jy-label">对白符号（这些符号里的是台词）</span><input type="text" data-jy-tts-field="quotePairs" placeholder="「」, 『』, “”, &quot;&quot;" spellcheck="false"></label><label><span class="jy-label">跳过符号（这些符号里的不读）</span><input type="text" data-jy-tts-field="skipPairs" placeholder="* *, ** **, （）" spellcheck="false"></label></div>
<p class="jy-muted">符号成对写，逗号分隔；开合各一个字符时写在一起（「」），多字符或相同字符之间空一格（** **）。比如预设把动作写在星号里、台词写在引号里：对白符号填 “”，跳过符号填 * *，那么 <code>樱井说：“明天也来吗？” *低头摆弄着衣角*</code> 只读引号里的话，星号里的一句不读也不挂按钮。不同预设的写法不一样，按自己用的预设改。</p>
<label><span class="jy-label">读译文时，楼层没有镜译译文就从这些标签里取文字</span><input type="text" data-jy-tts-field="sourceTags" placeholder="jy-translation" spellcheck="false"></label>
<p class="jy-muted">读原文：按「正文处理」里的提取标签取原文，没翻译过的楼层也能读，思维链、状态栏这些不在提取标签里的内容不会被读。副模型分析时会附上每行的译文帮它认人，说话人按译名写；原文里的写法（比如桜井）可以加进角色的别名。<br>两种模式都给每句写一句中文配音指令：谁在说、基础情绪、情绪怎么变、语气、语速、停顿重读、要不要笑声叹气喘息。S2 系列模型直接读方括号里的中文指令，句内还会插 [重读]、[停顿]、[长停顿] 和声音词，语速音量走 Fish 的参数；S1 读不懂自由文本，退回它认得的英文固定标签。台词本身不经过模型，一个字不改。分析按楼层文本缓存，一楼只请求一次；点句子旁的情绪按钮或悬浮窗的改句面板能看到分析结果和最终发给 Fish 的内容，可以改。</p>
</div></details>
<details class="jy-form-section jy-fold" data-jy-fold="tts-fish"><summary class="jy-section-title"><span>02</span><h2>Fish Audio</h2><span class="jy-fold-summary" data-jy-fold-summary></span></summary><div class="jy-form-body">
<label><span class="jy-label">API Key</span><input type="password" data-jy-tts-fish="key" placeholder="sk-…" autocomplete="new-password" spellcheck="false"></label>
<label><span class="jy-label">模型</span><select data-jy-tts-fish="model"><option value="s2-pro">s2-pro</option><option value="s2.1-pro">s2.1-pro</option><option value="s2.1-pro-free">s2.1-pro-free（免费开发者档）</option><option value="drama-3-preview">drama-3-preview（预览版）</option><option value="s1">s1（旧版，不能一次用多个音色）</option></select></label>
<label class="jy-check"><input type="checkbox" data-jy-tts-fish="viaProxy">经酒馆 CORS 代理发送</label>
<label><span class="jy-label">接口地址</span><input type="url" data-jy-tts-fish="baseUrl" placeholder="https://api.fish.audio" spellcheck="false"></label>
<div class="jy-form-grid jy-form-grid-tight"><label><span class="jy-label">超时 / 秒</span><input type="number" data-jy-tts-fish="timeoutSec" min="10" max="600" step="10"></label><label><span class="jy-label">失败后自动重试次数</span><input type="number" data-jy-tts-fish="retries" min="0" max="5" step="1"></label><label title="整楼拆成几段请求时，几段同时发。越大等得越短，Fish 提示限流（429）就调回 1。"><span class="jy-label">同时生成几段</span><select data-jy-tts-fish="concurrency"><option value="1">1（一段一段来，最稳）</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></label></div>
<p class="jy-muted">超时、重试和并发是这条连接怎么发请求，不影响声音。重试只在超时、断线和 Fish 自己出错（5xx）时发生；Key 不对、余额不足、限流（429）这些一次就停，重试也没用。</p>
<div class="jy-form-grid jy-form-grid-tight"><label title="一次请求交给 Fish 多少内容。整楼一次：这一楼所有人的对白和旁白合成一个请求，各用各的音色，Fish 按一场对话连着读。"><span class="jy-label">一次请求发多少</span><select data-jy-tts-field="requestUnit"><option value="line">每段一次（默认，第一段做好就开始播）</option><option value="floor">整楼一次（所有角色合成一个请求）</option><option value="sentence">每句一次（每句单独请求）</option></select></label></div>
<p class="jy-muted" data-jy-tts-unit-help></p>
<p class="jy-muted" data-jy-tts-proxy-help></p>
</div></details>
<details class="jy-form-section jy-fold" data-jy-fold="tts-voices"><summary class="jy-section-title"><span>03</span><h2>音色</h2><span class="jy-fold-summary" data-jy-fold-summary></span></summary><div class="jy-form-body">
<div class="jy-form-grid jy-form-grid-tight"><label><span class="jy-label">旁白音色 <span class="jy-tts-title" data-jy-tts-title="narrator"></span></span><span class="jy-tts-pick" data-jy-tts-pick-scope data-jy-tts-page-pick><input type="text" data-jy-tts-field="narratorVoice" placeholder="Fish Voice ID，留空用 Fish 默认音色" spellcheck="false"></span></label><label><span class="jy-label">对白默认音色 <span class="jy-tts-title" data-jy-tts-title="dialogue"></span></span><span class="jy-tts-pick" data-jy-tts-pick-scope data-jy-tts-page-pick><input type="text" data-jy-tts-field="dialogueVoice" placeholder="没有专属音色的角色都用这个" spellcheck="false"></span></label><label title="没有在角色表里绑定专属音色的人，是用上面这个默认音色读，还是干脆不读。"><span class="jy-label">没有专属音色的角色</span><select data-jy-tts-field="dialogueFallback"><option value="default">用对白默认音色读</option><option value="skip">跳过，不朗读</option></select></label></div>
<p class="jy-muted">角色表里每一行都可以单独勾「不朗读这个角色的对白」，勾上的人一句都不读、也不生成音频。旁白不受这两项影响，旁白音色单独设。</p>
<div class="jy-tts-lang-block" data-jy-tts-multilang><div class="jy-row-between"><div><h3>多国语言</h3><p class="jy-muted">同一个人读中文、英语、日语可以各用一个音色，英语还分美式和英式（伦敦腔）。这里给旁白加；每个角色行里各有一个「＋ 多国语言音色」按钮。句子的语言由副模型判断，没判断按文字本身。</p></div><button type="button" class="jy-button" data-jy-action="tts-add-narrator-lang">＋ 旁白加一门语言</button></div><div class="jy-tts-lang-list" data-jy-tts-narrator-langs></div></div>
<div class="jy-form-grid jy-form-grid-tight"><label><span class="jy-label">角色表保存范围</span><select data-jy-tts-field="voiceScope"><option value="character">跟着角色卡（这张卡的所有聊天共用一张表）</option><option value="chat">每个聊天单独一份（不同周目各配各的）</option></select></label></div>
<p class="jy-muted" data-jy-tts-scope-note></p>
<div class="jy-processing-toolbar"><button type="button" class="jy-button jy-button-primary" data-jy-action="tts-import-worldbook">从角色卡和世界书识别角色</button><button type="button" class="jy-button" data-jy-action="tts-add-voice">添加角色</button><button type="button" class="jy-button" data-jy-action="tts-import-speakers">导入已知说话人</button><button type="button" class="jy-button" data-jy-action="tts-lookup-voices">查询音色名</button><button type="button" class="jy-text-button" data-jy-action="tts-prune-voices">删掉没绑音色的行</button><button type="button" class="jy-text-button" data-jy-action="tts-clear-voices">清空角色表</button></div>
<div class="jy-tts-voice-list" data-jy-tts-voice-list></div>
<div class="jy-behaviors"><label class="jy-check"><input type="checkbox" data-jy-tts-field="speechMarks">让主模型给台词标上说话人和情绪</label></div>
<p class="jy-muted">打开后，主模型每写一次回复，请求的最末尾（深度 0，系统消息）都会带上一段格式要求，让它把每句台词写成 <code>&lt;say who="名字" mood="情绪"&gt;「……」&lt;/say&gt;</code>。不分析模式靠这个分角色、带情绪读，不请求任何副模型；简单分析碰到整楼都标好的楼也不再请求。标记在楼层里自动隐藏，翻译时自动去掉；台词的引号没配对（比如「……"）时，显示和朗读都会补成一对。名单用下面角色表里的名字，引号用这个故事最近在用的那种，每次生成时现取。只在朗读功能打开时发送，总结、代写这类旁路生成不带；关掉就不再发送。以前点按钮写进世界书的「镜译 · 说话人与情绪标记」条目请自己删掉或关掉——它还在的话，关掉这里主模型也会照样写标记。</p>
<p class="jy-muted">角色表跟着当前角色卡保存。「从角色卡和世界书识别角色」让副模型读一遍角色卡和世界书条目（连同最近几楼正文，好按故事里的写法给名字），把人物名单列出来，你勾选后再导进来（需要副模型能连上，模型没回应就什么都不加）；世界书里没有、只是模型编的名字，群体和身份称呼，还有你自己扮演的角色，都会被程序挡掉，关掉的世界书条目也不读；导进来的角色先跟随对白默认音色，改默认音色它们一起变；给某个角色填了专属 Voice ID（或从音色库选）就锁定，之后改默认音色不影响它，「解除绑定」才会解锁。「＋ 多国语言音色」给同一个角色按语言绑不同音色：读中文译文用一个，读日语原文用另一个，句子的语言由副模型判断，没判断时按文字本身。没登记的角色不会不读，用对白默认音色；连默认音色都没填就用 Fish 的默认音色。</p>
</div></details>
<details class="jy-form-section jy-fold" data-jy-fold="tts-library"><summary class="jy-section-title"><span>04</span><h2>音色库</h2><span class="jy-fold-summary" data-jy-fold-summary></span></summary><div class="jy-form-body">
<div class="jy-processing-toolbar"><button type="button" class="jy-button" data-jy-action="tts-add-library">添加音色</button></div>
<div class="jy-tts-library" data-jy-tts-library></div>
<p class="jy-muted">给常用的 Fish 音色起个自己的名字存起来，全部角色卡共用。之后旁白、对白默认音色、每个角色、每门语言的音色都可以直接从库里选，不用再去翻 32 位的 ID。Voice ID 在 fish.audio 音色页面的地址栏里。</p>
</div></details>
<details class="jy-form-section jy-fold" data-jy-fold="tts-deep"><summary class="jy-section-title"><span>05</span><h2>深度分析</h2><span class="jy-fold-summary" data-jy-fold-summary></span></summary><div class="jy-form-body">
<p class="jy-muted">在简单分析的骨架上，带着角色卡、世界书、前几楼再看一遍，判断每句情绪的因果和浓度，定下情绪、强度、语气、语速、音量、停顿、句内转折和非语言声音，全是 Fish 官方认得的标签；调音台上你推到头的滑杆是它必须守的规则，留在中间的交给它判断。开着翻译时一楼两次调用（翻译一次、深度一次），不开翻译一次做完。这一栏里的东西只属于深度分析，改它不碰别的。</p>
<div class="jy-form-grid jy-form-grid-tight"><label><span class="jy-label">深度分析用的连接</span><select data-jy-tts-field="deepChannelId"><option value="">和朗读分析用同一条</option></select></label><label title="从请求发出去算起，不管模型还在不在写。连接自己的「超时」只管「多久没动静」，思考型模型边想边写就永远不会超时。"><span class="jy-label">单次分析最长等待 / 秒</span><input type="number" data-jy-tts-field="analysisLimitSec" min="20" max="900" step="10"></label></div>
<p class="jy-muted">「单次分析最长等待」是硬上限：到点就停，这一楼先按现有标注读，不会一直等下去。思考型模型嫌慢的话，把那条连接的「推理强度」调低比调大这个数更有用。</p>
<p class="jy-muted">简单分析用的连接在「01 读什么」里选；这里只管深度分析，可以换一个更会读人的模型，不选就和简单分析同一条。</p>
<div class="jy-behaviors"><span class="jy-label">深度分析时附带</span><label class="jy-check"><input type="checkbox" data-jy-tts-context="character">角色卡设定</label><label class="jy-check"><input type="checkbox" data-jy-tts-context="worldbook">世界书</label><label class="jy-check"><input type="checkbox" data-jy-tts-context="recent">前几楼剧情</label><label class="jy-inline-field"><span class="jy-label">楼数</span><input type="number" data-jy-tts-context="floors" min="0" max="10" step="1"></label></div>
</div></details>
<details class="jy-form-section jy-fold" data-jy-fold="tts-call"><summary class="jy-section-title"><span>06</span><h2>实时通话（测试版）</h2><span class="jy-fold-summary" data-jy-fold-summary></span></summary><div class="jy-form-body">
<p class="jy-muted">给小手机这类插件打电话用的接口：边写边读（tts.stream）、语音输入（stt）、流式请求模型（llm.stream），都挂在 <code>window.__JINGYI__</code> 上，插件接上这三个就能边说边听。悬浮窗的「通话测试」页用的也是这三个，可以直接打给当前角色试效果。这一栏和通话测试页只在测试版里有。</p>
<div class="jy-form-grid jy-form-grid-tight"><label title="插件用 llm.stream 请求模型时走这条。选「模型连接」页里存的连接才能一边写一边读；跟随酒馆时要等整段回复写完。"><span class="jy-label">通话用的连接</span><select data-jy-tts-field="callChannelId"><option value="">和朗读分析用同一条</option></select></label><label><span class="jy-label">语音输入</span><select data-jy-tts-field="sttProvider"><option value="cloud">按住说话，云端转写</option><option value="browser">浏览器自带识别</option></select></label></div>
<div class="jy-form-grid jy-form-grid-tight" data-jy-stt-cloud><label><span class="jy-label">转写服务</span><select data-jy-tts-field="sttPreset"><option value="siliconflow">SiliconFlow · SenseVoiceSmall（免费）</option><option value="groq">Groq · whisper-large-v3-turbo</option><option value="openai">OpenAI · gpt-4o-mini-transcribe</option><option value="custom">自定义（OpenAI 兼容）</option></select></label><label><span class="jy-label">转写地址</span><input type="text" data-jy-tts-field="sttUrl" spellcheck="false"></label><label><span class="jy-label">转写 Key</span><input type="password" data-jy-tts-field="sttApiKey" spellcheck="false" autocomplete="off"></label><label><span class="jy-label">转写模型</span><input type="text" data-jy-tts-field="sttModel" spellcheck="false"></label></div>
<div class="jy-form-grid jy-form-grid-tight"><label><span class="jy-label">识别语言</span><input type="text" data-jy-tts-field="sttLang" placeholder="zh / ja / en" spellcheck="false"></label></div>
<div class="jy-processing-toolbar"><button type="button" class="jy-button" data-jy-action="stt-test">试一下语音输入</button><span class="jy-muted" data-jy-stt-test-note></span></div>
<p class="jy-muted">麦克风只能在 https 或本机地址（localhost、127.0.0.1）下打开：手机用 Termux 在本机开酒馆没问题，用局域网地址 http://192.168… 打开时浏览器不给麦克风。浏览器自带识别不用 Key，但只在电脑版 Chrome / Edge 上稳定，声音会交给浏览器厂商的服务转写。</p>
</div></details>
<details class="jy-advanced" open><summary>默认调音台（没单独调过的角色和旁白都用这套）</summary>
<p class="jy-muted">每一项五档，停在哪一档就把哪一句话交给副模型。中间那档是「AI 判断」——这一项不写任何规则，由分析模型按剧情自己定，也是默认值。往两边走才会变成硬性要求，比如「呼吸感明显」「声音克制」。数字本身不发给任何模型。每个角色还能在音色那栏单独调；最下面的自定义规则永远原样交给副模型，那才是最细的一层。</p>
<p class="jy-muted">非语言声音（叹气、笑、抽泣这些）由「声音表现倾向」一项决定用多少；「气息感」只说用哪一种，不会自己加量。两项都停在「AI 判断」时，加不加、加多少由分析模型看着办。</p>
<div class="jy-tts-console" data-jy-tts-console="default"><div class="jy-tts-console-presets" data-jy-console-preset-host></div><label class="jy-tts-console-field"><span>停顿感</span><input type="range" min="0" max="100" step="25" value="50" data-jy-console-key="pause"><output>AI 判断</output></label><label class="jy-tts-console-field"><span>气息感</span><input type="range" min="0" max="100" step="25" value="50" data-jy-console-key="breath"><output>AI 判断</output></label><label class="jy-tts-console-field"><span>口语颗粒度</span><input type="range" min="0" max="100" step="25" value="50" data-jy-console-key="grain"><output>AI 判断</output></label><label class="jy-tts-console-field"><span>情感强度</span><input type="range" min="0" max="100" step="25" value="50" data-jy-console-key="intensity"><output>AI 判断</output></label><label class="jy-tts-console-field"><span>情绪表现幅度</span><input type="range" min="0" max="100" step="25" value="50" data-jy-console-key="range"><output>AI 判断</output></label><label class="jy-tts-console-field"><span>语速倾向</span><input type="range" min="0" max="100" step="25" value="50" data-jy-console-key="speed"><output>AI 判断</output></label><label class="jy-tts-console-field"><span>声音表现倾向</span><input type="range" min="0" max="100" step="25" value="50" data-jy-console-key="expression"><output>AI 判断</output></label><label class="jy-tts-console-rules"><span class="jy-label">自定义配音规则（一行一条，直接交给副模型）</span><textarea rows="3" data-jy-console-rules spellcheck="false" placeholder="比如：害羞时不要过度娇柔；生气时保持克制；不要每句话都加呼吸"></textarea></label></div>
</details>
<details class="jy-advanced"><summary>副模型提示词（高级）</summary>
<p class="jy-muted">留空用内置的。可用占位符：<code>{{user}}</code> 用户扮演的角色，<code>{{sounds}}</code> 声音词表，<code>{{references_rule}}</code> 读原文时关于译文的那条规则。JSON 的输出格式和字段名要照旧，不然解析不出来；深度模式里 skeleton 的省力原则建议留着，那是省时间的关键。</p>
<label><span class="jy-label">深度分析</span><textarea data-jy-tts-prompt="deep" rows="10" spellcheck="false"></textarea></label><div class="jy-processing-toolbar"><button type="button" class="jy-text-button" data-jy-action="tts-fill-prompt" data-prompt="deep">填入内置的再改</button><button type="button" class="jy-text-button" data-jy-action="tts-copy-prompt" data-prompt="deep">复制内置提示词</button><button type="button" class="jy-text-button" data-jy-action="tts-reset-prompt" data-prompt="deep">恢复默认</button></div>
<label><span class="jy-label">简单分析（没翻译标注的楼才用）</span><textarea data-jy-tts-prompt="simple" rows="8" spellcheck="false"></textarea></label><div class="jy-processing-toolbar"><button type="button" class="jy-text-button" data-jy-action="tts-fill-prompt" data-prompt="simple">填入内置的再改</button><button type="button" class="jy-text-button" data-jy-action="tts-copy-prompt" data-prompt="simple">复制内置提示词</button><button type="button" class="jy-text-button" data-jy-action="tts-reset-prompt" data-prompt="simple">恢复默认</button></div>
</details>
<details class="jy-advanced"><summary>声音参数</summary><div class="jy-form-grid">
<label><span class="jy-label">音频格式</span><select data-jy-tts-fish="format"><option value="mp3">mp3（兼容最好）</option><option value="opus">opus（体积小，旧版 Safari 可能播不了）</option><option value="wav">wav（无损，体积大）</option></select></label><label><span class="jy-label">延迟与质量</span><select data-jy-tts-fish="latency"><option value="normal">normal（质量最好）</option><option value="balanced">balanced</option><option value="low">low（最快）</option></select></label>
<label><span class="jy-label">语速（0.5–2）</span><input type="number" data-jy-tts-fish="speed" min="0.5" max="2" step="0.05"></label><label><span class="jy-label">音量调整 / dB</span><input type="number" data-jy-tts-fish="volume" min="-20" max="20" step="1"></label>
<label><span class="jy-label">temperature</span><input type="number" data-jy-tts-fish="temperature" min="0" max="1" step="0.05"></label><label><span class="jy-label">top_p</span><input type="number" data-jy-tts-fish="topP" min="0" max="1" step="0.05"></label>
<label><span class="jy-label">一次请求最多字数（标签一起算，超过就拆）</span><input type="number" data-jy-tts-fish="maxChars" min="200" max="10000" step="100"></label>
<label class="jy-check"><input type="checkbox" data-jy-tts-fish="normalize">数字与符号规范化（中英文读数更稳）</label>
</div><p class="jy-muted">改任何一项声音参数，已经缓存的音频都会按新参数重新生成。超时、重试和并发不算声音参数，改了不会让音频重做，它们在上面「Fish Audio」那一栏。</p></details>
<details class="jy-advanced" data-jy-tts-preview-panel><summary>当前楼层的朗读结构</summary><div class="jy-processing-toolbar"><button type="button" class="jy-button" data-jy-action="tts-preview">分析最新一楼</button><button type="button" class="jy-button" data-jy-action="tts-pregenerate">生成最新一楼的音频（不播放）</button><button type="button" class="jy-button" data-jy-action="tts-copy-structure" hidden>复制朗读结构 JSON</button></div><div class="jy-tts-preview" data-jy-tts-preview></div></details>
<div class="jy-advanced jy-tts-cache"><div class="jy-row-between"><div><h3>缓存</h3><p class="jy-muted" data-jy-tts-usage>正在读取…</p></div><div class="jy-processing-toolbar"><button type="button" class="jy-button" data-jy-action="tts-clear-chat">清空本聊天的朗读缓存</button><button type="button" class="jy-button" data-jy-action="tts-clear-all">清空全部</button></div></div></div>
<footer class="jy-footer"><span class="jy-save-note" data-jy-tts-save-note>修改后保存朗读设置</span><button type="button" class="jy-button jy-button-primary" data-jy-action="save-tts">保存朗读设置</button></footer>
</section>

<section class="jy-page" data-jy-page="logs" role="tabpanel" hidden>
<header class="jy-page-heading"><div><h1>运行记录</h1><span class="jy-page-context" data-jy-log-count>0 条</span></div></header>
<div class="jy-log-toolbar"><button type="button" class="jy-button jy-button-primary" data-jy-action="toggle-export-drawer">导出日志</button><div class="jy-log-tools"><button type="button" class="jy-button" data-jy-action="refresh-logs">刷新</button><button type="button" class="jy-button" data-jy-action="clear-logs">清空</button></div></div>
<div class="jy-export-drawer" data-jy-export-drawer>
  <div class="jy-export-body">
    <p class="jy-muted">导出完整日志（含副 API 请求与返回正文，凭据特征已隐藏）。文件为 TXT，分享前请检查隐私内容。</p>
    <div class="jy-export-controls">
      <label class="jy-export-scope"><span class="jy-label">最近楼数</span><input type="number" data-jy-export-floors min="1" max="999" step="1" value="1"></label>
      <button type="button" class="jy-button jy-button-primary" data-jy-action="export-recent">导出最近楼层</button>
      <button type="button" class="jy-button" data-jy-action="export-all">导出全部日志</button>
    </div>
  </div>
</div>
<p class="jy-muted">展开记录可查看模型完整回复。完整日志含正文，分享前请检查。</p><div class="jy-log-list" data-jy-log-list></div>
</section>
<p class="jy-sr-only" aria-live="polite" data-jy-live></p>
</main>
</div>`;

const FALLBACK_PANEL_CSS = `
  :host{all:initial;font:14px/1.6 system-ui;color:#253a35}
  [hidden]{display:none!important}
  .jy-overlay{position:fixed;inset:0;background:#071b18b3;display:grid;place-items:center;pointer-events:auto;padding:16px}
  .jy-dialog{position:relative;width:min(1100px,100%);height:90dvh;background:#f7f5ef;overflow:auto}
  .jy-close{position:absolute;right:8px;top:8px;z-index:30}
  .jy-studio{display:grid;grid-template-columns:150px 1fr}.jy-rail{background:#173b31;color:white;padding:20px}
  .jy-navigation{display:grid;gap:10px}.jy-workspace{padding:20px;min-width:0}
  input,select,textarea{box-sizing:border-box;width:100%;padding:8px}button{padding:8px}
  .jy-page-heading,.jy-actions,.jy-footer{margin:16px 0}.jy-prompt-item-editor{padding:16px}
  @media(max-width:640px){.jy-studio{display:block}.jy-navigation{display:flex;flex-wrap:wrap}}
`;

function getContext() {
  const context = globalThis.SillyTavern?.getContext?.();
  if (!context) throw new Error('SillyTavern 扩展上下文尚未就绪。');
  return context;
}

function safeError(error) {
  if (error instanceof Error) {
    if (error.cause instanceof Error && error.message === 'API request failed') return error.cause.message;
    return error.message;
  }
  return String(error || '未知错误');
}

function isAbortError(error) {
  return Boolean(error && typeof error === 'object' && error.name === 'AbortError');
}

function sourceChangedError() {
  const error = new Error('翻译期间正文内容发生变化，旧结果没有写回。');
  error.code = 'JY_SOURCE_CHANGED';
  return error;
}

function toast(kind, message) {
  const api = globalThis.toastr;
  if (api && typeof api[kind] === 'function') api[kind](message, APP_NAME);
  else (kind === 'error' ? console.error : console.info)(`[${APP_NAME}] ${message}`);
}

function recordDiagnostic(level, scope, message, details = {}, fullResponse, extra = {}) {
  const entry = addDiagnostic({
    level,
    scope,
    message,
    details,
    ...(arguments.length >= 5 ? { fullResponse } : {}),
    ...(Number.isInteger(runtime.activeFloor) ? { floor: runtime.activeFloor } : {}),
    ...extra,
  });
  for (const subscriber of runtime.diagnosticSubscribers) subscriber(readDiagnostics());
  return entry;
}

// The base URL never carries the credential (that travels as proxy_password), but it is the one
// thing a “换了地址就不通” report always omits. Logging it is what separates a wrong endpoint from a
// wrong model: /api/coding/v3 only serves the Coding Plan roster, /api/v3 serves the ordinary one.
function describeChannelEndpoint(settings = runtime.settings) {
  if (settings?.apiMode !== 'independent') return 'follow-current';
  const raw = String(getActiveChannel(settings).url ?? '').trim();
  if (!raw) return '未填写';
  try {
    return normalizeOpenAiBaseUrl(raw);
  } catch (error) {
    return `${raw}（无法解析：${safeError(error)}）`;
  }
}

function subscribeDiagnostics(subscriber) {
  runtime.diagnosticSubscribers.add(subscriber);
  subscriber(readDiagnostics());
  return () => runtime.diagnosticSubscribers.delete(subscriber);
}

async function copyText(text) {
  if (globalThis.navigator?.clipboard?.writeText) {
    await globalThis.navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.cssText = 'position:fixed;left:-9999px;top:0;';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand?.('copy');
  textarea.remove();
  if (!copied) throw new Error('浏览器没有允许复制，请手动选择日志内容。');
}

function extensionFolderName() {
  try {
    const path = new URL(import.meta.url).pathname;
    const marker = '/third-party/';
    const index = path.indexOf(marker);
    if (index >= 0) {
      const folder = path.slice(index + marker.length).split('/')[0];
      if (folder) return decodeURIComponent(folder);
    }
  } catch {
    // Local preview falls back to the public repository folder name.
  }
  return 'jingyi';
}

function requestHeaders() {
  return getContext().getRequestHeaders?.() || { 'Content-Type': 'application/json' };
}

async function discoverInstallType(folder) {
  const response = await fetch(EXTENSION_API_PATHS.discover, {
    method: 'GET',
    headers: requestHeaders(),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`无法读取扩展安装信息（HTTP ${response.status}）。`);
  const extensions = await response.json();
  const found = Array.isArray(extensions)
    ? extensions.find(item => item?.name === `third-party/${folder}`)
    : null;
  if (!found || !['local', 'global'].includes(found.type)) {
    throw new Error('酒馆没有识别到镜译的 Git 安装目录，请在扩展管理中检查安装状态。');
  }
  return found.type;
}

async function extensionRequest(path, folder, installType) {
  const endpoint = EXTENSION_API_PATHS[path];
  if (!endpoint || path === 'discover') throw new Error('未知的扩展维护操作。');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: requestHeaders(),
    body: JSON.stringify({ extensionName: folder, global: installType === 'global' }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(body || `扩展${path === 'update' ? '更新' : '检查'}失败（HTTP ${response.status}）。`);
  }
  return response.json();
}

function updateButtonState(button) {
  if (!button) return;
  const status = runtime.update.status;
  button.hidden = !['available', 'updating'].includes(status);
  setText(button, '[data-jy-update-label]', status === 'updating' ? '更新中…' : '有更新 · 安装');
  button.disabled = status === 'updating';
  button.dataset.jyUpdateState = status;
}

async function checkUpdatesSilently(button) {
  if (['checking', 'updating', 'updated'].includes(runtime.update.status)) return;
  runtime.update.status = 'checking';
  updateButtonState(button);
  const folder = extensionFolderName();
  try {
    const installType = await discoverInstallType(folder);
    const data = await extensionRequest('version', folder, installType);
    runtime.update.installType = installType;
    runtime.update.details = data;
    runtime.update.status = data.isUpToDate === false ? 'available' : 'current';
  } catch (error) {
    runtime.update.status = 'error';
    recordDiagnostic('warn', 'update.check', safeError(error), { folder });
  } finally { updateButtonState(button); }
}

async function handleUpdateAction(button) {
  if (runtime.update.status !== 'available') return;
  runtime.update.status = 'updating';
  updateButtonState(button);
  try {
    const data = await extensionRequest('update', extensionFolderName(), runtime.update.installType);
    runtime.update.details = data;
    runtime.update.status = 'updated';
    const notice = button.getRootNode().querySelector('[data-jy-update-notice]');
    if (notice) { notice.hidden = false; notice.textContent = '更新完成，请手动刷新酒馆。'; }
    recordDiagnostic('info', 'update', '更新完成，等待用户手动刷新。', { commit: data.shortCommitHash || '' });
    toast('success', '镜译更新完成，请手动刷新酒馆。');
  } catch (error) {
    runtime.update.status = 'available';
    recordDiagnostic('error', 'update', safeError(error));
    toast('error', safeError(error));
  } finally { updateButtonState(button); }
}

function updateTask(patch) {
  const previous = runtime.task.status;
  runtime.task = { ...runtime.task, ...patch };
  if (previous === 'running' && runtime.task.status !== 'running') holdFloatingPill();
  else syncFloatingEntry();
  for (const subscriber of runtime.subscribers) subscriber(runtime.task);
}

// 20000 characters of thinking is normal for these models and re-rendering all of it every second
// is what would make the panel stutter, so the live view keeps a tail and the full text stays in
// memory for the expanded view and the log.
const THINKING_TAIL = 1400;

function updateThinking(patch) {
  runtime.thinking = { ...runtime.thinking, ...patch, revision: runtime.thinking.revision + 1 };
  // Piggy-backs on the task channel: every surface that already redraws on task changes redraws.
  updateTask({});
}

function subscribeTask(subscriber) {
  runtime.subscribers.add(subscriber);
  subscriber(runtime.task);
  return () => runtime.subscribers.delete(subscriber);
}

function initializeSettings() {
  const context = getContext();
  runtime.settings = normalizeProcessingSettings(context.extensionSettings[MODULE_ID]);
  const profile = getActiveProcessingProfile(runtime.settings);
  if (context.extensionSettings.regex?.some(rule => rule?.[REGEX_OWNER_KEY]?.profileId === profile.id && rule[REGEX_OWNER_KEY].owner === MODULE_ID)) {
    profile.regexScripts = readNativeRegexEdits(context.extensionSettings.regex, profile);
  }
  context.extensionSettings.regex = syncNativeRegex(context.extensionSettings.regex, profile);
  runtime.nativeRegexInstalled = true;
  context.extensionSettings[MODULE_ID] = runtime.settings;
  context.saveSettingsDebounced?.();
  syncSpeechPrompt();
  return runtime.settings;
}

function saveSettings(next) {
  const context = getContext();
  const previous = runtime.settings;
  // A voice id edited in the library takes the rows, the narrator and the dialogue default that
  // pointed at the old id along with it: the entry is the voice, the id is where it lives today.
  runtime.settings = followVoiceLibrary(previous.voiceLibrary, captureProcessingProfile(normalizeProcessingSettings(next)));
  const active = getActiveProcessingProfile(runtime.settings);
  const previousRules = getActiveProcessingProfile(previous).regexScripts;
  const visualChanged = VISUAL_FIELDS.some(key => previous[key] !== runtime.settings[key])
    || JSON.stringify(previousRules) !== JSON.stringify(active.regexScripts);
  if (previous.selectedProcessingProfileId !== runtime.settings.selectedProcessingProfileId || visualChanged) cancelPendingWork();
  context.extensionSettings.regex = syncNativeRegex(context.extensionSettings.regex, active);
  context.extensionSettings[MODULE_ID] = runtime.settings;
  context.saveSettingsDebounced?.();
  syncFloatingButton();
  syncSpeakerStylesheet(runtime.settings);
  if (runtime.panel?.host) runtime.panel.host.dataset.theme = runtime.settings.theme || 'day';
  // The desk's picker is the translation's choice. One made in the floating window must show there
  // too, or the next save from the open control centre would put the old choice back.
  const deskPicker = runtime.panel?.shadow?.querySelector?.('[data-jy-translation-channel]');
  if (deskPicker) fillChannelPicker(deskPicker, runtime.settings, translationChannelChoice(runtime.settings));
  if (runtime.mini?.host) {
    runtime.mini.host.dataset.theme = runtime.settings.theme || 'day';
    runtime.mini.syncQuickPickers?.();
    runtime.mini.refreshCall?.();
  }
  const floating = typeof document === 'undefined' ? null : document.getElementById(FLOATING_ID);
  if (floating) floating.dataset.theme = runtime.settings.theme || 'day';
  // Anything the floor buttons depend on — the switch, the mode, the range — redraws them; switching
  // reading aloud off also ends whatever is playing.
  const ttsBefore = JSON.stringify([previous.tts, previous.ttsVoices, previous.voiceLibrary]);
  if (runtime.initialized && ttsBefore !== JSON.stringify([runtime.settings.tts, runtime.settings.ttsVoices, runtime.settings.voiceLibrary])) {
    // Prepared floors were built on the old settings; the next look rebuilds them.
    runtime.tts.floors.clear();
    if (!ttsSettings(runtime.settings).enabled) {
      stopTts();
      unbindTtsDom();
      clearAllTtsDecorations();
    } else {
      bindTtsDom();
      scheduleTtsDecorateAll({ force: true });
    }
    notifyTtsPanels();
  }
  syncSpeechPrompt();
  if (visualChanged) {
    const revision = ++runtime.processingRevision;
    const settings = runtime.settings;
    runtime.processingRefresh = runtime.processingRefresh.catch(() => {}).then(() => {
      if (revision !== runtime.processingRevision || !runtime.initialized) return;
      return restyleCurrentChat(settings);
    });
    runtime.processingRefresh.catch(error => toast('error', `设置已保存，刷新已有译文失败：${safeError(error)}`));
  }
  return runtime.settings;
}

async function restyleCurrentChat(settings) {
  const context = getContext();
  const chat = context.chat;
  const chatId = getCurrentChatId(context);
  if (!Array.isArray(chat)) return;
  const changes = [];
  const updateExtra = (extra, text) => {
    // Keep the original provenance if an edited legacy block could not be migrated.
    // New owned blocks can be read without consulting these visible-affix settings.
    if (text.includes(`{${INVISIBLE_MARKER}`)) return extra;
    return { ...extra, [MESSAGE_META_KEY]: {
      ...extra?.[MESSAGE_META_KEY], schema_version: 4,
      segment_prefix: settings.segmentPrefix, segment_suffix: settings.segmentSuffix,
      translation_prefix: settings.translationPrefix, translation_suffix: settings.translationSuffix,
    } };
  };
  for (const message of chat) {
    if (!message || message.is_user || message.is_system || typeof message.mes !== 'string') continue;
    const next = { mes: restyleBilingual(message.mes, settings, message.extra?.[MESSAGE_META_KEY]), extra: message.extra };
    if (next.mes !== message.mes) next.extra = updateExtra(message.extra, next.mes);
    if (Array.isArray(message.swipes)) {
      next.swipes = [...message.swipes];
      next.swipe_info = message.swipe_info?.map(info => ({ ...info }));
      for (let index = 0; index < next.swipes.length; index += 1) {
        const extra = message.swipe_info?.[index]?.extra;
        const text = index === Number(message.swipe_id ?? 0) ? next.mes : restyleBilingual(next.swipes[index], settings, extra?.[MESSAGE_META_KEY]);
        if (text !== next.swipes[index] && next.swipe_info?.[index]) next.swipe_info[index].extra = updateExtra(extra, text);
        next.swipes[index] = text;
      }
    }
    if (next.mes === message.mes && JSON.stringify(next.swipes) === JSON.stringify(message.swipes)) continue;
    changes.push({ message, before: { mes: message.mes, extra: message.extra, swipes: message.swipes, swipe_info: message.swipe_info }, next });
    Object.assign(message, next);
  }
  try {
    if (changes.length) await context.saveChat();
  } catch (error) {
    for (const { message, before, next } of changes) if (message.mes === next.mes && message.swipes === next.swipes) Object.assign(message, before);
    throw error;
  }
  if (context.chat !== chat || getCurrentChatId(context) !== chatId) return;
  // A real chat reload also lets the native regex manager rebuild its list.
  if (!runtime.mainGenerationActive && typeof context.reloadCurrentChat === 'function') await context.reloadCurrentChat();
  else for (const [id, message] of chat.entries()) context.updateMessageBlock?.(id, message);
}

function getCurrentChatId(context = getContext()) {
  return String(context.chatId ?? context.getCurrentChatId?.() ?? '');
}

function latestAssistantMessageId(context) {
  for (let index = context.chat.length - 1; index >= 0; index -= 1) {
    const message = context.chat[index];
    if (message && !message.is_user && !message.is_system) return index;
  }
  return null;
}

// Body-tag regions translate into bilingual mirrors; replace-tag regions swap in the translation
// and hide the original. One floor can carry both kinds, so both extractions merge by position.
function extractAllRegions(text, settings) {
  const replaceTagList = parseTagNames(settings.replaceTags);
  return mergeExtractedRegions(
    extractTaggedRegions(text, settings.bodyTags),
    replaceTagList.length ? extractTaggedRegions(text, replaceTagList, { mode: 'replace' }) : null,
  );
}

async function readMessageSnapshot(messageId = null, settings = runtime.settings, { quiet = false } = {}) {
  const context = getContext();
  const id = messageId === null ? latestAssistantMessageId(context) : Number(messageId);
  if (!Number.isInteger(id) || id < 0) throw new Error('没有找到可翻译的 AI 回复。');
  const message = context.chat[id];
  if (!message) throw new Error(`没有找到第 ${id} 楼。`);
  if (message.is_user || message.is_system) throw new Error('目标楼层不是普通 AI 回复。');

  const swipeId = Number(message.swipe_id ?? 0);
  const metadata = message.extra?.[MESSAGE_META_KEY];
  const upgraded = upgradeLegacyBilingual(message.mes, metadata);
  const originalExtraction = extractAllRegions(upgraded, settings);
  // Metadata carries the affixes this floor was written with, so a wrapper that lost its invisible
  // boundaries is removed here instead of being re-wrapped on the next write.
  const cleanMessage = stripGeneratedTranslationLines(upgraded, metadata);
  // Reading a floor aloud re-reads it on every render; the warning belongs to translating it.
  if (!quiet && metadata && detectUnmarkedAffixes(cleanMessage, metadata)) {
    recordDiagnostic('warn', 'translation.affix-leftover', '楼层里发现失去不可见边界的前后缀文本，重新翻译前请先清理，否则可能出现重复前后缀。', {
      messageId: id,
      segmentPrefix: metadata.segment_prefix ?? '',
      translationPrefix: metadata.translation_prefix ?? '',
    });
  }
  const extraction = extractAllRegions(cleanMessage, settings);
  const segmentOptions = {
    segmentPrefix: metadata?.segment_prefix ?? settings.segmentPrefix,
    segmentSuffix: metadata?.segment_suffix ?? settings.segmentSuffix,
    translationPrefix: metadata?.translation_prefix ?? settings.translationPrefix,
    translationSuffix: metadata?.translation_suffix ?? settings.translationSuffix,
    paragraphPerLine: metadata?.paragraph_per_line ?? settings.paragraphPerLine,
    excludedTags: settings.excludedTags,
    preserveLineRules: settings.preserveLineRules,
  };
  const segments = [];
  // Segment id → the speaker marks the story wrote into that line, for the reading alone.
  const speech = new Map();
  let paragraphs = 0;
  let nextId = 1;
  for (const region of extraction.regions) {
    const segmented = segmentSource(region.inner, { ...segmentOptions, startId: nextId });
    region.layout = segmented.layout;
    region.segments = segmented.segments;
    region.paragraphs = segmented.paragraphs;
    segments.push(...segmented.segments);
    for (const [id, marked] of segmented.speech ?? []) speech.set(id, marked);
    paragraphs += segmented.paragraphs;
    nextId += segmented.segments.length;
  }
  const sourceHash = await hashText(createTranslationSignature(extraction.regions));
  const messageHash = await hashText(cleanMessage);
  const metadataMatches = Boolean(
    metadata
    && metadata.source_hash === sourceHash
    && Number(metadata.swipe_id ?? 0) === swipeId
  );
  const existingTranslations = new Map();
  if (metadataMatches) {
    nextId = 1;
    for (const region of extraction.regions) {
      const originalRegion = originalExtraction.regions.find(candidate =>
        candidate.tagName.toLowerCase() === region.tagName.toLowerCase() && candidate.mode === region.mode);
      if (originalRegion) {
        const seeds = region.mode === 'replace'
          ? extractReplaceTranslations(originalRegion.inner, { ...segmentOptions, startId: nextId })
          : extractGeneratedTranslations(originalRegion.inner, { ...segmentOptions, startId: nextId });
        for (const [id, translation] of seeds) existingTranslations.set(id, translation);
      }
      nextId += region.segments.length;
    }
  }
  const translated = Boolean(
    metadataMatches
    && metadata.complete !== false
    && existingTranslations.size === segments.length,
  );

  return {
    context,
    chatId: getCurrentChatId(context),
    messageId: id,
    swipeId,
    message,
    source: cleanMessage,
    sourceHash,
    messageHash,
    extraction,
    segments,
    speech,
    paragraphs,
    existingTranslations,
    // Only trusted while the segmentation still matches, which is the same condition that makes the
    // stored translations reusable.
    existingAnnotations: metadataMatches ? readStoredAnnotations(metadata) : new Map(),
    translated,
  };
}

// A reasoning model can spend minutes on one batch, so the plain “超时了” line left the reader with no
// next step. Name the usual cause and the two ways out instead.
function describeTimeout(timeoutSec, idle, who = '独立副 API') {
  return idle
    ? `副 API 已建立流式连接，但超过 ${timeoutSec} 秒没有新内容。`
    : `${who}请求超时（>${timeoutSec} 秒）。思考型模型整包返回常常更久：可在副 API 预设里调大「超时」，或打开流式写回让译文边收边写。`;
}

// The window used to cover the whole call. That is right for a one-shot request and wrong for a
// stream: a run that kept delivering deltas past the channel timeout was cut off mid-translation.
// The optional renew() handed to the task turns the window into an idle timer for whoever calls it,
// and leaves it a total timeout for everyone who does not.
async function withAbortTimeout(externalSignal, timeout, task) {
  // A plain number is the silence window. An object adds a deadline: the whole request, however much
  // the model is writing, ends there — which is the only thing that stops a model that thinks aloud.
  const timeoutSec = typeof timeout === 'object' && timeout ? timeout.seconds : timeout;
  const ceiling = typeof timeout === 'object' && timeout ? Math.max(0, Number(timeout.limitSec) || 0) : 0;
  const controller = new AbortController();
  let timedOut = false;
  let renewed = false;
  let hitLimit = false;
  const onAbort = () => controller.abort();
  if (externalSignal?.aborted) onAbort();
  else externalSignal?.addEventListener('abort', onAbort, { once: true });
  const windowMs = Math.max(10, Number(timeoutSec) || 180) * 1000;
  let timer = null;
  const arm = () => {
    if (timer !== null) globalThis.clearTimeout(timer);
    timer = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, windowMs);
  };
  const renew = () => {
    if (timedOut || controller.signal.aborted) return;
    renewed = true;
    arm();
  };
  arm();
  const wall = ceiling ? globalThis.setTimeout(() => {
    hitLimit = true;
    controller.abort();
  }, ceiling * 1000) : null;
  wall?.unref?.();
  try {
    return await task(controller.signal, renew);
  } catch (error) {
    if (hitLimit) throw new Error(`这次分析写了 ${ceiling} 秒还没写完，已经停下，这一楼先按现有标注读。可以在「05 深度分析」里调大「单次分析最长等待」，或者把那条连接的推理强度调低。`);
    if (timedOut) throw new Error(describeTimeout(timeoutSec, renewed, typeof timeout === 'object' && timeout?.who ? timeout.who : undefined));
    throw error;
  } finally {
    if (wall !== null) globalThis.clearTimeout(wall);
    if (timer !== null) globalThis.clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

// A one-shot request to a reasoning model sits silent for minutes with the bar parked where the last
// step left it, which is exactly what “卡在 7% 然后超时” looks like from the panel. Ticking the
// elapsed seconds costs nothing and tells the difference between slow and hung.
function startWaitTicker(label, timeoutSec) {
  const startedAt = Date.now();
  let timer = null;
  const schedule = () => {
    timer = globalThis.setTimeout(() => {
      runtime.timers.delete(timer);
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      updateTask({ status: 'running', message: `${label}已等待 ${seconds} 秒，本通道超时上限 ${timeoutSec} 秒。` });
      schedule();
    }, 5000);
    runtime.timers.add(timer);
  };
  schedule();
  return () => {
    if (timer === null) return;
    globalThis.clearTimeout(timer);
    runtime.timers.delete(timer);
    timer = null;
  };
}

// Hosts and relays surface failures in wildly different shapes. Keep whatever is there so the full
// log can show it, instead of reducing everything to one opaque line in a toast.
function describeRequestFailure(error) {
  if (!error || typeof error !== 'object') return { value: String(error ?? '') };
  const described = {
    name: error.name ?? null,
    message: typeof error.message === 'string' ? error.message : null,
  };
  for (const key of ['status', 'statusText', 'code', 'body', 'response', 'error', 'data']) {
    if (error[key] !== undefined) described[key] = error[key];
  }
  if (error.cause instanceof Error) described.cause = { name: error.cause.name, message: error.cause.message };
  else if (error.cause !== undefined) described.cause = error.cause;
  return described;
}

// A bare token such as "<none>" tells the user nothing and hides that a full trace was captured.
function enrichRequestError(error) {
  // A request called off is a cancellation, whatever it said; wrapping it made it read as a failure.
  if (isAbortError(error)) return error;
  const raw = safeError(error);
  const opaque = !raw || raw.length <= 24 || /^[<\[(（【][^\s]{0,20}[>\])）】]$/.test(raw.trim());
  if (!opaque) return error;
  const wrapped = new Error(`副 API 没有返回可用内容（${raw || '空响应'}）。完整请求与返回已记入运行记录，可在「运行记录」页用「导出日志」导出排查。`);
  wrapped.cause = error instanceof Error ? error : new Error(raw);
  return wrapped;
}

// Prefer the API's own usage numbers when the channel returns them; otherwise estimate by characters.
function describeRequestTokens(messages, raw) {
  const usage = raw && typeof raw === 'object' ? raw.usage : null;
  const prompt = Number(usage?.prompt_tokens ?? usage?.input_tokens);
  if (Number.isFinite(prompt) && prompt >= 0) {
    return { promptTokens: prompt, basis: 'usage' };
  }
  return { promptTokens: estimateRequestTokens(messages), basis: 'estimated' };
}

// The whitelist follows the character card: avatar is the stable key SillyTavern keeps per card.
function worldInfoCharacterKey() {
  const context = getContext();
  const character = context.characters?.[Number(context.characterId)];
  return String(character?.avatar || character?.name || 'default');
}

// All four lore sources the host reports. Chat-scoped and persona books used to be invisible to both
// the whitelist and the translated-name activation, which is surprising for anyone who keeps their
// per-chat notes there.
const WORLD_INFO_SOURCES = Object.freeze(['globalLore', 'characterLore', 'chatLore', 'personaLore']);

function readableWorldInfoEntries() {
  const lore = runtime.wiEntries;
  if (!lore || typeof lore !== 'object') return [];
  const seen = new Set();
  const entries = [];
  for (const source of WORLD_INFO_SOURCES) {
    for (const entry of Array.isArray(lore[source]) ? lore[source] : []) {
      if (!entry || typeof entry !== 'object') continue;
      const key = `${entry.world}.${entry.uid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }
  return entries;
}

function whitelistedWorldbookContent() {
  const picks = runtime.settings.worldInfoWhitelist?.[worldInfoCharacterKey()];
  if (!picks?.length) return '';
  const wanted = new Set(picks.map(pick => `${pick.world}.${pick.uid}`));
  const context = getContext();
  // The host expands macros before a worldbook entry reaches the main model. Sending {{char}} and
  // friends verbatim to the translator loses exactly the names it needs most.
  const substitute = typeof context.substituteParams === 'function'
    ? value => String(context.substituteParams(value) ?? value)
    : value => value;
  return readableWorldInfoEntries()
    .filter(entry => wanted.has(`${entry.world}.${entry.uid}`))
    .map(entry => substitute(String(entry.content ?? '')).trim())
    .filter(Boolean)
    .join('\n\n');
}

// ---------------------------------------------------------------------------------------------
// Speaker colouring and emotion typography.
//
// The secondary model returns labels; everything visual is decided here. See palette.js for why.
// ---------------------------------------------------------------------------------------------

function activeColoring(settings = runtime.settings) {
  return normalizeColoring(settings?.coloring ?? DEFAULT_COLORING);
}

function coloringEnabled(settings = runtime.settings) {
  const coloring = activeColoring(settings);
  return (coloring.speakers || coloring.emotions) && Boolean(coloring.band);
}

function speakerPaletteFor(settings = runtime.settings) {
  return normalizeSpeakerList(settings?.speakerPalette?.[worldInfoCharacterKey()]);
}

// The roster handed to the model. A closed list turns "who is speaking" from an open-ended naming
// problem into a multiple-choice question, which is the whole reason this stays reliable.
function speakerRoster(settings = runtime.settings) {
  const names = speakerPaletteFor(settings).flatMap(speaker => [speaker.name, ...speaker.aliases]);
  return [...new Set(names.filter(Boolean))];
}

// The names the translation is asked to label speakers with: the colouring's palette, and, with the
// reading on, the cast the voices are registered under, so a label reaches its voice by name.
/**
 * The characters' consoles as sentences: the default one first, under the name every reading knows
 * it by, then each row that was set apart. Nothing goes out for a console left at the middle.
 */
function ttsStyles(settings = runtime.settings) {
  const tts = ttsSettings(settings);
  const styles = [];
  const base = consoleDirections(tts.console);
  if (base.length) styles.push({ name: '默认', rules: base });
  for (const row of ttsVoicesFor(settings)) {
    const own = row.console ? consoleDirections(row.console) : [];
    if (own.length) styles.push({ name: row.name, rules: own });
  }
  return styles;
}

function translationStyles(settings = runtime.settings) {
  return ttsSettings(settings).enabled ? ttsStyles(settings) : [];
}

function annotationRoster(settings = runtime.settings) {
  return ttsSettings(settings).enabled ? ttsKnownNames(settings) : speakerRoster(settings);
}

// Hair colours cluster: two blondes in one cast would otherwise get near-identical speech. Hues are
// pushed apart once, in palette order, so adding a character never reshuffles the existing ones.
/**
 * Every speaker this floor can paint, registered or not.
 *
 * `extraNames` are the names the model actually returned. A name the palette has never heard of used
 * to resolve to nothing, which stripped the colour out and left the line with emotion typography
 * only — the feature looked broken until every character had been entered by hand. Those names now
 * take the same name-derived hue a black-haired character already gets, so it is stable across
 * chats and devices, and registering a real hair colour later simply overrides it.
 *
 * Registered speakers keep their own hue spread; unregistered ones are not folded into it, because
 * a name arriving mid-chat must not repaint everyone who was already on screen.
 */
function resolvedSpeakerColors(settings = runtime.settings, extraNames = []) {
  const palette = speakerPaletteFor(settings);
  const coloring = activeColoring(settings);
  const band = coloring.band;
  if (!band) return new Map();
  const auto = coloring.autoSpeakers !== false
    ? [...new Set(extraNames.map(name => String(name ?? '').trim()).filter(Boolean))]
    : [];
  if (!palette.length && !auto.length) return new Map();
  const hues = palette.map(speaker => {
    const rgb = speaker.source ? parseCssColor(speaker.source) : null;
    const oklch = rgb ? srgbToOklch(rgb) : null;
    return oklch && !isNeutralColor(oklch) ? oklch.h : null;
  });
  const known = hues.map((hue, index) => (hue === null ? null : { hue, index })).filter(Boolean);
  const spread = spreadHues(known.map(item => item.hue));
  known.forEach((item, position) => { hues[item.index] = spread[position]; });

  const resolved = new Map();
  palette.forEach((speaker, index) => {
    const hue = hues[index];
    const adapted = adaptColorToBand(
      hue === null ? '' : toHex(oklchToSrgbSafe(hue, band)),
      band,
      { name: speaker.name, vividness: coloring.vividness },
    );
    const entry = { name: speaker.name, base: adapted.hex, source: speaker.source, derived: hue === null };
    resolved.set(speaker.name, entry);
    for (const alias of speaker.aliases) if (!resolved.has(alias)) resolved.set(alias, entry);
  });
  for (const name of auto) {
    if (resolved.has(name)) continue;
    const adapted = adaptColorToBand('', band, { name, vividness: coloring.vividness });
    resolved.set(name, { name, base: adapted.hex, source: '', derived: true, unregistered: true });
  }
  return resolved;
}

// A hue on its own is not a colour; give it the band's own lightness so adaptColorToBand has
// something well-formed to read the hue back out of.
function oklchToSrgbSafe(hue, band) {
  return oklchToSrgb({ l: band.lightness ?? 0.6, c: Math.max(0.06, band.chromaMax * 0.8), h: hue });
}

// One person, one name. A model that answers 希尔达夫人 on one line and 希尔达 on the next, or spells a
// full name out once, would otherwise split a character across colours. Names that cannot be placed
// are left exactly as written; the stored labels are never rewritten, only read through this.
function canonicalAnnotations(settings, annotations) {
  const quotesOf = mark => (Array.isArray(mark?.quotes) ? mark.quotes : []);
  const reported = [...annotations.values()].flatMap(mark => [mark?.speaker, ...quotesOf(mark).map(quote => quote?.speaker)]).filter(Boolean);
  if (!reported.length) return annotations;
  const names = unifySpeakerNames(reported, [...speakerRoster(settings), ...runtime.autoSpeakerNames]);
  const canonical = speaker => (speaker ? names.get(String(speaker).trim()) ?? speaker : speaker);
  const result = new Map();
  for (const [id, mark] of annotations) {
    const speaker = canonical(mark?.speaker);
    const quotes = quotesOf(mark).map(quote => {
      const own = canonical(quote?.speaker);
      return own === quote?.speaker ? quote : { ...quote, speaker: own };
    });
    const changed = speaker !== mark?.speaker || quotes.some((quote, index) => quote !== mark.quotes[index]);
    result.set(id, changed ? { ...mark, speaker, ...(quotes.length ? { quotes } : {}) } : mark);
  }
  return result;
}

/**
 * Builds the per-segment decorator handed to assembleBilingual / assembleReplace.
 *
 * Returns null when nothing would be painted, so a floor translated with colouring off is written
 * byte-for-byte the way it always was.
 */
function buildSegmentStyler(settings, reportedAnnotations) {
  const coloring = activeColoring(settings);
  const band = coloring.band;
  if (!band || (!coloring.speakers && !coloring.emotions) || !(reportedAnnotations instanceof Map) || !reportedAnnotations.size) return null;
  const annotations = canonicalAnnotations(settings, reportedAnnotations);
  const named = [...annotations.values()].map(mark => mark?.speaker).filter(Boolean);
  const speakers = coloring.speakers ? resolvedSpeakerColors(settings, named) : new Map();
  // Say out loud who the model reported and who the palette recognised. A speaker that resolves to
  // nothing costs the line its colour, and with nothing written down that is invisible.
  reportSpeakerCoverage(named, speakers, coloring);
  return (ids, texts = []) => {
    // A multi-line unit only gets a colour when the whole unit agrees; mixed speakers in one block
    // cannot be painted separately without splitting the block, so it stays neutral.
    const marks = ids.map(id => annotations.get(id)).filter(Boolean);
    if (marks.length !== ids.length || !marks.length) return null;
    const first = marks[0];
    if (marks.some(mark => mark.speaker !== first.speaker || mark.emotion !== first.emotion)) return null;
    const speaker = coloring.speakers ? speakers.get(String(first.speaker ?? '')) : null;
    const emotion = coloring.emotions ? first.emotion : '';
    if (!speaker && !emotion) return null;
    const style = resolveSegmentStyle({
      speakerColor: speaker?.source || speaker?.base || '',
      name: speaker?.name ?? '',
      emotion,
      intensity: first.intensity,
      band,
      vividness: coloring.vividness,
    });
    // Speaker colour belongs to the words someone actually said. A unit with no quoted span in it
    // is narration and wears nobody's colour; a unit that mixes narration with a quoted line paints
    // only the quoted runs. The colour used to cover the whole line, which is how 「あ、そう」と呟き、
    // 通話を切った ended up with its narration in the speaker's pink.
    const shape = speaker ? describeSpeechShape(texts) : 'narration';
    // All-speech units keep the old shape exactly: colour on the wrapper, rhythm inside it.
    const paintsOutside = Boolean(speaker) && shape === 'spoken';
    const paintsInside = Boolean(speaker) && shape === 'mixed';
    // Emotion-only mode leaves the colour alone and changes weight and shape instead.
    const declarations = paintsOutside ? style.declarations : style.declarations.filter(item => !item.startsWith('color:'));
    if (!declarations.length && !paintsInside) return null;
    // Two carriers on purpose. The inline style holds the fully resolved colour, including whatever
    // the emotion did to it. The classes carry the same information through the host's own
    // stylesheet, so a sanitiser that drops style attributes still leaves speakers distinguishable.
    const classes = [SPEAKER_CLASS];
    // The slug class paints through the host stylesheet, so it travels with the colour: on the
    // wrapper for an all-speech unit, on the quoted runs for a mixed one, nowhere for narration.
    const speakerClass = speaker ? `${SPEAKER_CLASS}-${speakerSlug(speaker.name)}` : '';
    if (paintsOutside) classes.push(speakerClass);
    if (style.emotion && style.emotion !== 'neutral' && style.intensity) {
      classes.push(`jy-emo-${style.emotion}`, `jy-emo-l${style.intensity}`);
    }
    const label = [speaker?.name, style.emotion && EMOTION_STYLES[style.emotion]?.label].filter(Boolean).join(' · ');
    // Both spellings of the colour, and both marked important.
    //
    // `-webkit-text-fill-color` decides the painted glyph in every WebKit and Blink browser and wins
    // over `color` outright — themes set it for gradient text. When they do, the glyphs take the
    // theme's colour while getComputedStyle still reports ours, so the colour looks like it is being
    // applied and simply never appears. Writing both is a harmless duplicate when no theme does it.
    const toInline = items => items
      .flatMap(item => (item.startsWith('color:') ? [item, `-webkit-text-fill-${item}`] : [item]))
      .map(item => `${item} !important`)
      .join(';');
    const inline = toInline(declarations);
    // The same colour the wrapper would have carried, ready to ride on the quoted runs instead.
    const speechInline = toInline(style.declarations.filter(item => item.startsWith('color:')));
    // The rhythm rides on inner spans so the outer one keeps the colour and the classes: a size step
    // inherits the speaker's colour instead of restating it, and a sanitiser that drops the inner
    // tags leaves the line whole and coloured.
    const rhythm = translation => {
      const contour = emphasisContour(translation, { emotion, intensity: first.intensity });
      return contour?.map(piece => ({
        text: piece.text,
        css: piece.scale === 1 ? '' : `font-size:${piece.scale.toFixed(3)}em !important`,
      })) ?? null;
    };
    // Mixed lines trade rhythm for getting the colour right: the contour reads a whole line at a
    // time, and a line cut into speech and narration is no longer one line to it.
    const paintSpeech = translation => {
      const parts = splitSpeechParts(translation);
      if (!parts.some(part => part.spoken)) return null;
      return parts.map(part => (part.spoken
        ? { text: part.text, className: speakerClass, css: speechInline }
        : { text: part.text }));
    };
    const emphasis = paintsInside ? paintSpeech : (coloring.rhythm === false ? null : rhythm);
    return {
      open: `<span class="${classes.join(' ')}"${label ? ` title="${escapeAttribute(label)}"` : ''}${inline ? ` style="${escapeAttribute(inline)}"` : ''}>`,
      close: '</span>',
      emphasis,
      // Tells the assembler to drop the colour out of any wrapper carried over from the original
      // line: two colours on one line would only mean the outer one losing without saying so.
      // True for the mixed case as well, where the colour lands inside rather than on the wrapper.
      paintsColor: paintsOutside || paintsInside,
    };
  };
}

/**
 * Records which reported speakers the palette could actually paint.
 *
 * The three interesting cases all look the same on screen — 说话人着色 switched off, a name the
 * palette has never seen, auto-colouring switched off — and all three read as the dialogue having
 * lost its colour. Writing them down is what turns that into something a reader can act on.
 */
function reportSpeakerCoverage(named, speakers, coloring) {
  const counts = new Map();
  for (const name of named) counts.set(name, (counts.get(name) ?? 0) + 1);
  if (!counts.size) {
    runtime.speakerCoverage = null;
    return;
  }
  const registered = new Set(speakerPaletteFor().flatMap(item => [item.name, ...item.aliases]));
  const coverage = {
    reported: [...counts].map(([name, segments]) => ({
      name,
      segments,
      registered: registered.has(name),
      painted: Boolean(coloring.speakers && speakers.get(name)),
    })),
    speakersOff: !coloring.speakers,
    autoOff: coloring.autoSpeakers === false,
  };
  runtime.speakerCoverage = coverage;
  let discovered = false;
  for (const item of coverage.reported) {
    if (!item.painted || item.registered || runtime.autoSpeakerNames.has(item.name)) continue;
    runtime.autoSpeakerNames.add(item.name);
    discovered = true;
  }
  // A name first seen on this floor needs its rule before the floor is painted, or the class-based
  // fallback would be the one thing missing exactly when it is needed.
  if (discovered) syncSpeakerStylesheet();
  const unpainted = coverage.reported.filter(item => !item.painted);
  if (!unpainted.length) return;
  recordDiagnostic('warn', 'coloring.speaker-unpainted', coverage.speakersOff
    ? '副模型报出了说话人，但「说话人着色」没有勾选，本楼只套了情绪排版。'
    : '副模型报出的说话人没有对应颜色，这几段只套了情绪排版。', {
    unpainted: unpainted.map(item => `${item.name}（${item.segments} 段）`),
    registeredPalette: [...registered],
    autoSpeakers: coloring.autoSpeakers !== false,
  });
}

// Speaker names are free text and often CJK; a short stable hash keeps the class name predictable
// and safe to write into both markup and a stylesheet selector.
function speakerSlug(name) {
  let hash = 2166136261;
  for (const character of String(name ?? '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

const SPEAKER_STYLE_ID = `${MODULE_ID}-speaker-palette`;

/**
 * Publishes the speaker colours as a real stylesheet.
 *
 * The inline style on each span is the primary carrier; this is the fallback that keeps working if
 * the host ever strips style attributes from message HTML. It also means a theme change repaints
 * every already-written floor the moment 取色 runs again, without rewriting a single message.
 */
function syncSpeakerStylesheet(settings = runtime.settings) {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(SPEAKER_STYLE_ID);
  const coloring = activeColoring(settings);
  const resolved = coloring.speakers && coloring.band
    ? resolvedSpeakerColors(settings, [...runtime.autoSpeakerNames])
    : new Map();
  if (!resolved.size) {
    existing?.remove();
    return;
  }
  const seen = new Set();
  const rules = [];
  for (const entry of resolved.values()) {
    const slug = speakerSlug(entry.name);
    if (seen.has(slug)) continue;
    seen.add(slug);
    rules.push(`:is(.${SPEAKER_CLASS}-${slug}, .custom-${SPEAKER_CLASS}-${slug}){color:${entry.base} !important;-webkit-text-fill-color:${entry.base} !important}`);
  }
  const element = existing ?? document.createElement('style');
  element.id = SPEAKER_STYLE_ID;
  element.textContent = rules.join('\n');
  if (!existing) document.head.appendChild(element);
}

function escapeAttribute(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Annotations survive a reload, a 补译 and a restyle by living in the floor's own metadata, keyed by
// segment id. That key is only meaningful while the source hash matches, which is exactly the
// condition under which the host reads them back.
function readStoredAnnotations(metadata) {
  const stored = metadata?.annotations;
  const map = new Map();
  if (!stored || typeof stored !== 'object') return map;
  for (const [id, value] of Object.entries(stored)) {
    const key = Number(id);
    if (!Number.isInteger(key) || !value || typeof value !== 'object') continue;
    const annotation = storedMark(value) ?? {};
    // The reading's own marks, one per quoted run of the line, each with the characters that place it.
    const quotes = (Array.isArray(value.quotes) ? value.quotes : []).slice(0, 12).map(entry => {
      const mark = storedMark(entry);
      const head = mark && entry.head ? String(entry.head).slice(0, 20) : '';
      return mark ? { ...(head ? { head } : {}), ...mark } : null;
    }).filter(Boolean);
    if (quotes.length) annotation.quotes = quotes;
    if (Object.keys(annotation).length) map.set(key, annotation);
  }
  return map;
}

// One stored mark, field by field: a speaker or a mood makes it one, the rest rides along.
function storedMark(value) {
  return readAnnotationFields(value);
}

function storedAnnotations(annotations) {
  if (!(annotations instanceof Map) || !annotations.size) return undefined;
  return Object.fromEntries([...annotations].map(([id, value]) => [String(id), value]));
}

/**
 * Reads the background the reader actually has behind the chat and turns it into a usable band.
 *
 * This is the answer to "每个人的主题及壁纸不一样": the palette is not authored against a theme, it
 * is solved against whatever this browser is currently painting.
 */
async function probeThemeBand(settings = runtime.settings) {
  const coloring = activeColoring(settings);
  const probe = await sampleThemeBackground({ document, window: globalThis });
  const band = computeSafeBand(probe.samples, { minContrast: coloring.minContrast || DEFAULT_MIN_CONTRAST });
  recordDiagnostic(band.feasible ? 'info' : 'warn', 'coloring.probe', band.feasible ? '已按当前主题与壁纸算出安全色域。' : '当前主题与壁纸下没有可用的安全色域。', {
    backgrounds: probe.hexes,
    wallpaper: probe.wallpaper ? '有' : '无',
    layers: probe.layers,
    direction: band.direction,
    chromaMax: Number(band.chromaMax.toFixed(4)),
    minContrast: band.minContrast,
    reachableContrast: band.reachableContrast,
    warnings: probe.warnings,
  });
  return { band, probe };
}

function renderWorldInfoList(root) {
  const list = root.querySelector('[data-jy-wi-list]');
  if (!list) return;
  const entries = readableWorldInfoEntries();
  const picks = new Set((runtime.settings.worldInfoWhitelist?.[worldInfoCharacterKey()] ?? [])
    .map(pick => `${pick.world}.${pick.uid}`));
  list.replaceChildren();
  if (!entries.length) {
    const note = document.createElement('p');
    note.className = 'jy-muted';
    note.textContent = '还没有读到世界书条目。点「刷新可读条目」试一次；仍为空就先让酒馆加载完当前聊天再回来。';
    list.appendChild(note);
    return;
  }
  for (const entry of entries) {
    const label = document.createElement('label');
    label.className = 'jy-check jy-wi-entry';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.jyWiPick = '';
    box.dataset.jyWorld = String(entry.world ?? '');
    box.dataset.jyUid = String(entry.uid ?? '');
    box.checked = picks.has(`${entry.world}.${entry.uid}`);
    const text = document.createElement('span');
    text.textContent = `${String(entry.comment || `条目 ${entry.uid}`).trim()}（${entry.world}）`;
    label.append(box, text);
    list.appendChild(label);
  }
}

/**
 * Drops returned lines that are still in the source language, so they count as missing.
 *
 * Only when the target is Chinese and names are not deliberately kept in Japanese: both of those put
 * kana into a correct translation. A dropped line goes back through the same repair path as a line the
 * model never returned at all, instead of being written down looking like a translation.
 */
function withoutUntranslated(recovered, segments, settings, { quiet = false } = {}) {
  const profile = getActivePromptProfile(settings);
  if (profile.nameMode === 'keep') return recovered;
  if (!/中文|汉语|漢語|chinese|^zh/i.test(normalizeTargetLanguage(profile.targetLanguage))) return recovered;
  const sources = new Map(segments.map(segment => [Number(segment.id), segment.text]));
  const dropped = [...recovered.translations]
    .filter(([id, text]) => looksUntranslated(text, sources.get(Number(id))))
    .map(([id]) => id);
  if (!dropped.length) return recovered;
  for (const id of dropped) {
    recovered.translations.delete(id);
    recovered.annotations?.delete(id);
  }
  if (!quiet) {
    recordDiagnostic('warn', 'translation.untranslated', '副 API 有段落原样返回或仍是日文，这几段按缺失处理并重新请求。', {
      ids: dropped,
    });
  }
  return recovered;
}

// One whole-request call to the secondary model, on whichever channel the settings pick. Translation and
// the read-aloud analysis both go through here, so a channel that works for one works for the other.
async function requestSubModelRaw(messages, settings, signal, { limitSec = 0 } = {}) {
  const context = getContext();
  const channel = getActiveChannel(settings);
  if (settings.apiMode === 'independent') {
    const service = context.ChatCompletionService;
    if (!service?.processRequest) throw new Error('当前 SillyTavern 不提供独立聊天补全请求接口。');
    return withAbortTimeout(signal, { seconds: channel.timeoutSec, limitSec }, requestSignal => service.processRequest(
      createIndependentRequest(settings, messages),
      {},
      true,
      requestSignal,
    ));
  }
  if (typeof context.generateRaw !== 'function') throw new Error('当前 SillyTavern 不提供静默生成接口。');
  // The host's quiet generation takes no signal and has no timeout of its own. A request that never
  // answered held this floor's translation lock for good, and every re-roll of the floor after it was
  // swallowed without a word. It now races the same window the independent requests have.
  const ask = () => context.generateRaw({
    prompt: messages,
    responseLength: channel.maxTokens,
    trimNames: false,
  });
  return withAbortTimeout(signal, { seconds: channel.timeoutSec, limitSec, who: '跟随酒馆的副模型' }, requestSignal => new Promise((resolve, reject) => {
    const onAbort = () => reject(Object.assign(new Error('请求已取消。'), { name: 'AbortError' }));
    if (requestSignal.aborted) {
      onAbort();
      return;
    }
    requestSignal.addEventListener('abort', onAbort, { once: true });
    const attempt = again => ask().then(resolve, error => {
      // The host calls off every quiet request when the reader stops the main generation. That is not
      // this request failing, and it is asked once more.
      if (!again && !requestSignal.aborted && /Cancelled by (?:stop event|extension)/i.test(String(error?.message ?? error))) {
        attempt(true);
        return;
      }
      reject(error);
    });
    attempt(false);
  }));
}

async function invokeTranslationBatch(segments, settings, signal, packet = {}, phase = 'primary', requestMeta = {}) {
  const messages = buildTranslationMessages(segments, settings, packet, phase, requestMeta);
  const channel = getActiveChannel(settings);
  let raw;

  const stopTicker = startWaitTicker(
    phase === 'primary' ? '副 API 正在翻译完整正文，' : '副 API 正在补译缺失段落，',
    channel.timeoutSec,
  );
  try {
    raw = await requestSubModelRaw(messages, settings, signal);
  } catch (error) {
    if (!isAbortError(error)) {
      recordDiagnostic('error', 'translation.request-failed', `副 API 请求失败：${safeError(error)}`, {
        phase,
        requestedSegments: segments.length,
        requestedIds: segments.map(segment => segment.id),
        apiMode: settings.apiMode,
        model: channel.model || 'follow-current',
        endpoint: describeChannelEndpoint(settings),
      }, describeRequestFailure(error), { fullRequest: messages });
    }
    throw enrichRequestError(error);
  } finally {
    stopTicker();
  }

  // The whole-request path never streams, so this is the first and only moment its thinking exists.
  const reasoning = extractReasoningText(raw);
  if (reasoning) updateThinking({ text: reasoning, characters: reasoning.length, live: false });
  recordDiagnostic('info', 'translation.raw-response', '已收到副 API 完整返回。', {
    phase,
    requestedSegments: segments.length,
    requestedIds: segments.map(segment => segment.id),
    apiMode: settings.apiMode,
    model: channel.model || 'follow-current',
    endpoint: describeChannelEndpoint(settings),
    requestTokens: describeRequestTokens(messages, raw),
    reasoningCharacters: reasoning.length || undefined,
  }, raw, { fullRequest: messages, reasoning });
  signal?.throwIfAborted?.();
  const recovered = withoutUntranslated(recoverStructuredTranslations(raw, segments), segments, settings);
  if (!recovered.translations.size) {
    recordDiagnostic('error', 'translation.empty-response', '副 API 返回中没有任何可用译文。', {
      phase,
      requestedIds: segments.map(segment => segment.id),
      parserWarnings: recovered.warnings,
      response: recovered.response,
    }, raw, { fullRequest: messages });
  }
  return recovered;
}

function consumeRetry(retryBudget, reason, details = {}) {
  if (!retryBudget || retryBudget.remaining <= 0) return false;
  retryBudget.remaining -= 1;
  recordDiagnostic('warn', 'translation.retry', '翻译任务准备自动重试。', {
    reason,
    remaining: retryBudget.remaining,
    ...details,
  });
  return true;
}

const MAX_TRANSLATION_REQUESTS = 16;

// Repeating an identical request that already truncated truncates again, so a batch that comes back
// with nothing new is halved instead of being resent as-is.
async function translateOneBatch(batch, settings, signal, packet, translations, budget, state, annotations = new Map()) {
  let pending = batch;
  let lastError = null;
  let attempts = 0;
  while (pending.length) {
    if (state.requests >= MAX_TRANSLATION_REQUESTS) {
      recordDiagnostic('warn', 'translation.request-cap', '本次翻译已达到请求次数上限，停止继续补译。', {
        requests: state.requests,
        missingIds: pending.map(item => item.id),
      });
      return lastError;
    }
    try {
      signal?.throwIfAborted?.();
      state.requests += 1;
      const before = translations.size;
      const phase = attempts > 0 || state.seeded ? 'repair' : 'primary';
      attempts += 1;
      const recovered = await invokeTranslationBatch(
        pending,
        settings,
        signal,
        packet,
        phase,
        { roster: state.roster ?? [], styles: state.styles ?? [] },
      );
      for (const [id, text] of recovered.translations) translations.set(id, text);
      for (const [id, mark] of recovered.annotations ?? []) annotations.set(id, mark);
      const progressed = translations.size > before;
      pending = pending.filter(segment => !translations.has(segment.id));
      recordDiagnostic(pending.length ? 'warn' : 'info', 'translation.response', pending.length ? '本批返回不完整，准备补译。' : '本批译文返回完整。', {
        request: state.requests,
        batchSize: batch.length,
        recovered: translations.size,
        missingIds: pending.map(item => item.id),
        parserWarnings: recovered.warnings,
        response: recovered.response,
      });
      // Colouring fails silently by design — a bad label costs a line its colour and nothing else.
      // That silence is wrong when every label is missing at once, which means the model ignored the
      // annotation request entirely. Without this the reader sees plain text and no reason for it.
      if ((coloringEnabled(settings) || ttsSettings(settings).enabled) && !annotations.size) {
        recordDiagnostic('warn', 'translation.no-annotations', '副模型没有返回任何说话人或情绪标注，这一批按普通样式显示；朗读这一楼时简单分析会另外问一次。', {
          request: state.requests,
          returned: translations.size,
          roster: state.roster ?? [],
        });
      }
      if (!pending.length) return null;
      lastError = new Error(`仍缺少第 ${pending.map(item => item.id).join('、')} 段译文。`);
      if (!progressed && pending.length > 1) {
        // Shrinking changes the request, so it is not charged to the retry budget.
        pending = pending.slice(0, Math.ceil(pending.length / 2));
        recordDiagnostic('warn', 'translation.shrink', '本批没有新增译文，改用更小的批次重试。', { nextBatch: pending.length });
        continue;
      }
      if (!consumeRetry(budget, 'missing-translations', { missingIds: pending.map(item => item.id) })) return lastError;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
      if (!consumeRetry(budget, 'request-error', { error: safeError(error) })) return lastError;
    }
  }
  return null;
}

function channelConcurrency(channel) {
  return clampInteger(channel?.concurrency, 1, MAX_CHANNEL_CONCURRENCY, 1);
}

// The batches of the run in progress, counted on the task so the floating window can draw them and
// say how long the rest should take. The seconds each batch took feed the next run's estimate.
function beginBatchProgress(total, lanes) {
  const batches = { total, lanes, done: 0, active: 0, durations: [], startedAt: Date.now(), activeSince: [] };
  updateTask({ batches });
  return batches;
}

async function trackBatch(batches, work) {
  const started = Date.now();
  batches.active += 1;
  batches.activeSince.push(started);
  updateTask({ batches: { ...batches } });
  try {
    return await work();
  } finally {
    const seconds = (Date.now() - started) / 1000;
    batches.active -= 1;
    batches.activeSince = batches.activeSince.filter(stamp => stamp !== started);
    batches.done += 1;
    batches.durations.push(seconds);
    runtime.timing.translation.push(seconds);
    if (runtime.timing.translation.length > 20) runtime.timing.translation.shift();
    updateTask({ batches: { ...batches } });
  }
}

/**
 * Runs `work` over `items` with at most `lanes` in flight; results keep input order.
 *
 * A failure does not tear down lanes already running. They share one translation map, and a batch
 * cancelled halfway would only have its finished answer thrown away. No new item starts after one.
 */
async function runInLanes(items, lanes, work) {
  const results = new Array(items.length);
  let next = 0;
  let failure = null;
  const lane = async () => {
    while (!failure && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await work(items[index], index);
      } catch (error) {
        failure ??= error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(lanes, items.length)) }, lane));
  if (failure) throw failure;
  return results;
}

async function invokeWithRetries(segments, settings, signal, packet = {}, seedTranslations = new Map(), retryBudget = null, seedAnnotations = new Map()) {
  const budget = retryBudget || { remaining: settings.retries };
  const translations = new Map(seedTranslations);
  const annotations = new Map(seedAnnotations);
  const channel = getActiveChannel(settings);
  const lanes = channelConcurrency(channel);
  const batches = planTranslationBatches(segments, { maxChars: translationCharBudget(channel.maxTokens), parallel: lanes });
  // `seeded` is fixed here rather than read off the map later: with lanes running side by side, a
  // batch starting after another one finished would otherwise take itself for a repair.
  const state = { requests: 0, roster: annotationRoster(settings), styles: translationStyles(settings), seeded: translations.size > 0 };
  let lastError;
  recordDiagnostic('info', 'translation.plan', '已按副 API 的输出上限规划本次请求批次。', {
    segments: segments.length,
    batches: batches.length,
    charBudget: translationCharBudget(channel.maxTokens),
    maxTokens: channel.maxTokens,
    concurrency: lanes,
  });
  const batchProgress = beginBatchProgress(batches.length, lanes);
  const failures = await runInLanes(batches, lanes, batch => trackBatch(batchProgress, () => translateOneBatch(batch, settings, signal, packet, translations, budget, state, annotations)));
  for (const failure of failures) if (failure) lastError = failure;
  {
    const pending = segments.filter(segment => !translations.has(segment.id));
    if (!pending.length) return { translations, annotations, missingIds: [], complete: true };
  }
  if (translations.size) {
    const missingIds = segments.filter(segment => !translations.has(segment.id)).map(segment => segment.id);
    recordDiagnostic('warn', 'translation.partial', '补译后仍有缺失，将写回已恢复的安全译文。', {
      expected: segments.length,
      recovered: translations.size,
      missingIds,
      lastError: safeError(lastError),
    });
    return { translations, annotations, missingIds, complete: false };
  }
  throw lastError || new Error('副模型没有返回可恢复的译文。');
}

async function repairForbiddenPhrases(segments, translations, settings, signal, packet) {
  const profile = getActivePromptProfile(settings);
  const hits = findForbiddenPhraseHits(translations, profile);
  if (!hits.length) return translations;
  const hitIds = new Set(hits.map(item => item.id));
  const targets = segments.filter(segment => hitIds.has(segment.id));
  const triggeredPhrases = [...new Set(hits.flatMap(item => item.phrases))];
  recordDiagnostic('warn', 'translation.style', '译文命中绝对禁用表达，准备进行一次定向修正。', {
    ids: [...hitIds],
    phrases: triggeredPhrases,
  });
  try {
    const recovered = await invokeTranslationBatch(targets, settings, signal, packet, 'style_repair', {
      draftTranslations: hits.map(item => ({ id: item.id, text: translations.get(item.id) })),
      triggeredPhrases,
    });
    const corrected = [];
    const unresolved = [];
    for (const hit of hits) {
      const candidate = recovered.translations.get(hit.id);
      if (candidate && !hit.phrases.some(phrase => candidate.includes(phrase))) {
        translations.set(hit.id, candidate);
        corrected.push(hit.id);
      } else {
        unresolved.push(hit.id);
      }
    }
    recordDiagnostic(unresolved.length ? 'warn' : 'info', 'translation.style', unresolved.length ? '禁用表达修正未全部成功，保留可用译文并继续写回。' : '禁用表达已完成定向修正。', {
      corrected,
      unresolved,
      parserWarnings: recovered.warnings,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    recordDiagnostic('warn', 'translation.style', '禁用表达修正请求失败，保留首次完整译文。', {
      error: safeError(error),
      ids: [...hitIds],
    });
  }
  return translations;
}

async function writeTranslation(snapshot, translationMap, epoch, settings, annotations = new Map()) {
  if (!runtime.initialized || runtime.epoch !== epoch) throw new Error('扩展已停用，旧翻译结果没有写回。');
  const latest = await readMessageSnapshot(snapshot.messageId, settings);
  if (latest.chatId !== snapshot.chatId || latest.swipeId !== snapshot.swipeId) {
    throw new Error('翻译期间聊天或滑动页已经变化，旧结果没有写回。');
  }
  let effectiveTranslations = translationMap;
  if (latest.sourceHash !== snapshot.sourceHash) {
    // Salvage the paragraphs whose source text survived the edit instead of discarding the whole run.
    effectiveTranslations = remapTranslationsBySource(snapshot.segments, translationMap, latest.segments);
    if (!effectiveTranslations.size) throw sourceChangedError();
    recordDiagnostic('warn', 'translation.resync', '正文在翻译期间变化，已保留仍然对得上的译文，其余段落留待补译。', {
      messageId: snapshot.messageId,
      before: translationMap.size,
      carried: effectiveTranslations.size,
      segments: latest.segments.length,
    });
  }
  const rebased = latest.messageHash !== snapshot.messageHash;
  if (rebased) {
    recordDiagnostic('info', 'translation.rebase', '检测到排除内容或正文外内容更新，已在最新楼层上安全合并译文。', {
      messageId: snapshot.messageId,
      translatedSegments: translationMap.size,
    });
  }

  const missingIds = latest.segments.filter(segment => !effectiveTranslations.has(segment.id)).map(segment => segment.id);
  const complete = missingIds.length === 0;
  // Labels the model returned this run win over the ones already stored on the floor.
  const effectiveAnnotations = new Map([...latest.existingAnnotations, ...(annotations instanceof Map ? annotations : [])]);
  for (const id of effectiveAnnotations.keys()) if (!effectiveTranslations.has(id)) effectiveAnnotations.delete(id);
  const styleFor = buildSegmentStyler(settings, effectiveAnnotations);
  const bilingual = rebuildTaggedRegions(latest.extraction, region => region.mode === 'replace'
    ? assembleReplace(region.layout, effectiveTranslations, { allowMissing: !complete, styleFor })
    : assembleBilingual(
      region.layout,
      effectiveTranslations,
      { ...settings, allowMissing: !complete, styleFor },
    ));
  const message = latest.message;
  const metadata = {
    schema_version: 4,
    app_version: APP_VERSION,
    source_hash: latest.sourceHash,
    swipe_id: snapshot.swipeId,
    translated_at: new Date().toISOString(),
    segment_prefix: settings.segmentPrefix,
    segment_suffix: settings.segmentSuffix,
    translation_prefix: settings.translationPrefix,
    translation_suffix: settings.translationSuffix,
    paragraph_per_line: settings.paragraphPerLine,
    body_tags: settings.bodyTags,
    replace_tags: settings.replaceTags,
    excluded_tags: settings.excludedTags,
    preserve_line_rules: settings.preserveLineRules,
    complete,
    translated_segments: effectiveTranslations.size,
    total_segments: latest.segments.length,
    total_paragraphs: latest.paragraphs,
    missing_ids: missingIds,
    annotations: storedAnnotations(effectiveAnnotations),
  };

  const previous = {
    mes: message.mes,
    extra: message.extra,
    swipe: Array.isArray(message.swipes) ? message.swipes[snapshot.swipeId] : undefined,
    swipeInfoExtra: Array.isArray(message.swipe_info) ? message.swipe_info[snapshot.swipeId]?.extra : undefined,
  };
  message.mes = bilingual;
  message.extra = { ...(message.extra || {}), [MESSAGE_META_KEY]: metadata };
  if (Array.isArray(message.swipes) && snapshot.swipeId >= 0 && snapshot.swipeId < message.swipes.length) {
    message.swipes[snapshot.swipeId] = bilingual;
  }
  if (Array.isArray(message.swipe_info) && message.swipe_info[snapshot.swipeId]) {
    const info = message.swipe_info[snapshot.swipeId];
    info.extra = { ...(info.extra || {}), [MESSAGE_META_KEY]: metadata };
  }

  try {
    await latest.context.saveChat();
  } catch (error) {
    message.mes = previous.mes;
    message.extra = previous.extra;
    if (Array.isArray(message.swipes) && snapshot.swipeId >= 0 && snapshot.swipeId < message.swipes.length) {
      message.swipes[snapshot.swipeId] = previous.swipe;
    }
    if (Array.isArray(message.swipe_info) && message.swipe_info[snapshot.swipeId]) {
      message.swipe_info[snapshot.swipeId].extra = previous.swipeInfoExtra;
    }
    latest.context.updateMessageBlock(snapshot.messageId, message);
    throw error;
  }
  latest.context.updateMessageBlock(snapshot.messageId, message);
  if (latest.context.eventTypes?.MESSAGE_UPDATED) {
    try {
      await latest.context.eventSource.emit(latest.context.eventTypes.MESSAGE_UPDATED, snapshot.messageId);
    } catch (error) {
      console.warn(`[${APP_NAME}] 其他扩展的 MESSAGE_UPDATED 监听器报错。`, error);
    }
  }
  return { bilingual, complete, missingIds, rebased };
}

async function translateMessage(messageId = null, { force = false, quiet = false, only = null } = {}) {
  runtime.activeFloor = Number.isInteger(Number(messageId)) ? Number(messageId) : null;
  const epoch = runtime.epoch;
  const settings = runtime.settings;
  const targetLanguage = normalizeTargetLanguage(getActivePromptProfile(settings).targetLanguage);
  let snapshot;
  try {
    snapshot = await readMessageSnapshot(messageId, settings);
  } catch (error) {
    if (quiet && /没有找到|不是普通 AI 回复/.test(safeError(error))) return { skipped: true, reason: 'not-translatable' };
    throw error;
  }
  runtime.activeFloor = snapshot.messageId;
  if (!snapshot.segments.length) throw new Error('当前 AI 回复没有可翻译的正文段落。');
  // Paragraphs asked for by themselves are re-requested whatever the floor's state.
  const supersede = force || Boolean(only);
  if (snapshot.translated && !supersede) return { skipped: true, reason: 'already-translated', snapshot };

  const lockKey = `${snapshot.chatId}|${snapshot.messageId}|${snapshot.swipeId}`;
  const existing = runtime.inflight.get(lockKey);
  // A re-roll lands on the same floor and swipe: other text there is not the run in flight, which is
  // called off below, and this text translated.
  const moved = Boolean(existing?.sourceHash && existing.sourceHash !== snapshot.sourceHash);
  if (existing && !supersede && !moved) {
    if (!quiet) toast('info', '该楼层翻译正在进行，已沿用本次任务。');
    return existing.promise;
  }
  // A forced re-translate supersedes the in-flight run so the new settings take effect at once.
  if (existing) existing.controller.abort();
  const controller = new AbortController();

  const work = (async () => {
    updateTask({
      status: 'running',
      title: `正在翻译第 ${snapshot.messageId} 楼`,
      message: `正在把完整正文一次性交给翻译通道，共 ${snapshot.paragraphs} 段、${snapshot.segments.length} 行，目标语言为${targetLanguage}。`,
      progress: 7,
    });
    recordDiagnostic('info', 'translation.start', '开始翻译当前楼层。', {
      messageId: snapshot.messageId,
      segments: snapshot.segments.length,
      paragraphs: snapshot.paragraphs,
      requestMode: 'whole-story',
      apiMode: settings.apiMode,
      model: getActiveChannel(settings).model || 'follow-current',
    });

    const retryBudget = { remaining: settings.retries };
    let result;
    let written;
    while (true) {
      const packet = await collectTranslationContext(
        snapshot,
        settings,
        getActiveChannel(settings).tokenSaving ? whitelistedWorldbookContent() : null,
      );
      updateTask({ status: 'running', message: '副 API 正在翻译完整正文…', progress: 18 });
      const seedTranslations = force ? new Map() : new Map(snapshot.existingTranslations);
      const seedAnnotations = force ? new Map() : new Map(snapshot.existingAnnotations);
      // Dropped from the seeds, a paragraph is asked for again; the rest of the floor stays as it is.
      if (only) {
        for (const id of only) {
          seedTranslations.delete(id);
          seedAnnotations.delete(id);
        }
      }
      // Asked for by themselves, only those paragraphs go out; the seeds carry the rest into the write.
      if (only) {
        const requested = snapshot.segments.filter(segment => only.has(segment.id));
        if (!requested.length) throw new Error('这一段已经变了，刷新后再试。');
        result = await invokeWithRetries(requested, settings, controller.signal, packet, seedTranslations, retryBudget, seedAnnotations);
      } else {
        result = await invokeWithRetries(snapshot.segments, settings, controller.signal, packet, seedTranslations, retryBudget, seedAnnotations);
      }
      await repairForbiddenPhrases(snapshot.segments, result.translations, settings, controller.signal, packet);

      updateTask({ status: 'running', message: '正在核对楼层与滑动页…', progress: 95 });
      try {
        written = await writeTranslation(snapshot, result.translations, epoch, settings, result.annotations);
        break;
      } catch (error) {
        if (error?.code === 'JY_SOURCE_CHANGED') {
          if (!consumeRetry(retryBudget, 'source-changed', { messageId: snapshot.messageId })) throw error;
          snapshot = await readMessageSnapshot(snapshot.messageId, settings);
          if (!snapshot.segments.length) throw new Error('更新后的 AI 回复没有可翻译的正文段落。');
          updateTask({ status: 'running', message: '正文内容已更新，正在按最新正文重新翻译…', progress: 10 });
          continue;
        }
        if (!consumeRetry(retryBudget, 'write-error', { messageId: snapshot.messageId, error: safeError(error) })) throw error;
        updateTask({ status: 'running', message: '写回失败，正在重试保存…', progress: 95 });
        written = await writeTranslation(snapshot, result.translations, epoch, settings, result.annotations);
        break;
      }
    }
    if (!written.complete) {
      updateTask({
        status: 'success',
        title: '已写回部分译文',
        message: `第 ${snapshot.messageId} 楼已写回 ${result.translations.size} / ${snapshot.segments.length} 段；未翻译的原文保持原样，可再点一次继续恢复。`,
        progress: 100,
      });
      if (!quiet) toast('warning', `已写回 ${result.translations.size} / ${snapshot.segments.length} 段，其余保留原文。`);
      recordDiagnostic('warn', 'translation.complete.partial', '可恢复的译文已部分写回。', {
        messageId: snapshot.messageId,
        translated: result.translations.size,
        total: snapshot.segments.length,
        missingIds: written.missingIds,
      });
      return { skipped: false, partial: true, messageId: snapshot.messageId, segments: result.translations.size };
    }
    updateTask({
      status: 'success',
      title: '翻译完成',
      message: `第 ${snapshot.messageId} 楼已追加 ${snapshot.paragraphs} 段${targetLanguage}镜像，并保留段内换行。`,
      progress: 100,
    });
    if (!quiet) toast('success', `第 ${snapshot.messageId} 楼翻译完成。`);
    recordDiagnostic('info', 'translation.complete', '译文已成功写回。', {
      messageId: snapshot.messageId,
      segments: snapshot.segments.length,
    });
    return { skipped: false, messageId: snapshot.messageId, segments: snapshot.segments.length };
  })().catch(error => {
    if (isAbortError(error)) {
      const current = runtime.inflight.get(lockKey);
      if (!current || current.promise === work) updateTask({ status: 'idle', title: '翻译已取消', message: '聊天已切换或任务已停止。', progress: 0 });
      return { skipped: true, reason: 'cancelled' };
    }
    const message = safeError(error);
    updateTask({ status: 'error', title: '翻译未写回', message, progress: 0 });
    recordDiagnostic('error', 'translation.failed', message, {
      messageId: snapshot?.messageId ?? null,
      segments: snapshot?.segments?.length ?? 0,
      apiMode: settings.apiMode,
      model: getActiveChannel(settings).model || 'follow-current',
      endpoint: describeChannelEndpoint(settings),
    });
    if (!quiet) toast('error', message);
    throw error;
  }).finally(() => {
    if (runtime.inflight.get(lockKey)?.promise === work) runtime.inflight.delete(lockKey);
  });

  runtime.inflight.set(lockKey, { promise: work, controller, sourceHash: snapshot.sourceHash });
  return work;
}

// Streaming beta: same request content as the one-shot path, but the SSE deltas are folded into
// the floor as completed JSON items arrive. The final pass reuses the ordinary write pipeline, so
// the finished floor is byte-identical to a non-streaming run.
async function streamTranslationBatch(messages, settings, signal, onDelta = null, onThinking = null, { limitSec = 0 } = {}) {
  const channel = getActiveChannel(settings);
  const payload = { ...createIndependentRequest(settings, messages), stream: true };
  // The whole-request path has always honoured the channel timeout. Without the same wrapper a
  // stalled upstream kept the task "running" forever once the response headers had arrived.
  return withAbortTimeout(signal, { seconds: channel.timeoutSec, limitSec }, async (streamSignal, renew) => {
    const response = await fetch('/api/backends/chat-completions/generate', {
      method: 'POST',
      headers: getContext().getRequestHeaders(),
      body: JSON.stringify(payload),
      signal: streamSignal,
    });
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new Error(`流式请求失败（HTTP ${response.status}）${detail.slice(0, 160) ? `：${detail.slice(0, 160)}` : ''}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let reasoning = '';
    let frames = 0;
    let whole = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Progress, not elapsed time, is what keeps the window open from here on.
      renew();
      const decoded = decoder.decode(value, { stream: true });
      // Kept only until the first SSE frame proves this really is a stream.
      if (!frames && whole.length < 200000) whole += decoded;
      buffer += decoded;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const data = line.trim();
        if (!data.startsWith('data:')) continue;
        frames += 1;
        const body = data.slice(5).trim();
        if (body === '[DONE]') continue;
        try {
          const chunk = JSON.parse(body);
          const choice = chunk.choices?.[0];
          const delta = choice?.delta?.content ?? choice?.text ?? '';
          // A reasoning model spends its first minutes emitting reasoning_content and nothing else.
          // Reading only content left the panel frozen for all of it: every frame proved the request
          // was alive, and nothing on this side could tell. The thinking never becomes translation —
          // it is only evidence that the model is still working.
          const thought = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning ?? '';
          if (thought) {
            reasoning += thought;
            if (onThinking) onThinking(reasoning);
          }
          if (delta) {
            text += delta;
            if (onDelta) onDelta(text);
          }
        } catch { /* keep partial JSON in the buffer for the next frame */ }
      }
    }
    // Relays that quietly ignore `stream: true` answer with one ordinary JSON body. Returning the
    // empty accumulator here read as "the model translated nothing": no error, no fallback, and a
    // floor that keeps its original text. Hand the whole body back so the batch still lands.
    if (!frames) {
      const oneShot = (() => { try { return JSON.parse(whole); } catch { return null; } })();
      if (oneShot !== null) {
        recordDiagnostic('warn', 'translation.stream-not-supported', '副 API 忽略了 stream 参数，本批按整包结果解析。', {
          characters: whole.length,
        });
        const choice = oneShot?.choices?.[0];
        const content = choice?.message?.content ?? choice?.text ?? oneShot?.content;
        return typeof content === 'string' ? content : oneShot;
      }
      throw new Error('副 API 没有返回 SSE 流，也无法按整包解析（可能是反代忽略了 stream 参数）。');
    }
    if (!text.trim()) {
      // The whole-request path already unwraps a {content, reasoning} envelope and falls back to the
      // reasoning field, which is where a model that overspent its budget on thinking leaves the only
      // copy of its answer. Hand the parser the same shape instead of failing the batch outright.
      if (reasoning.trim()) {
        recordDiagnostic('warn', 'translation.stream-thinking-only', '副 API 本批只返回了思考内容，改按思考文本解析。', {
          reasoningCharacters: reasoning.length,
          frames,
        });
        return { content: '', reasoning };
      }
      throw new Error('流式连接建立成功，但没有收到任何正文增量。');
    }
    // `reasoning` rides along even when the content is fine: it is the only record of what the model
    // spent its minutes on, and a reader who waited those minutes should be able to look.
    return reasoning.trim() ? { content: text, reasoning } : text;
  });
}

async function translateMessageStreaming(messageId = null, { quiet = false, force = false } = {}) {
  if (runtime.settings.apiMode !== 'independent') {
    // The follow mode borrows the host generation API, which only returns whole responses.
    recordDiagnostic('warn', 'translation.stream-skip', '跟随模式拿不到流式返回，本次改用整包翻译。', {});
    return translateMessage(messageId, { quiet, force });
  }
  runtime.activeFloor = Number.isInteger(Number(messageId)) ? Number(messageId) : null;
  const epoch = runtime.epoch;
  const settings = runtime.settings;
  const targetLanguage = normalizeTargetLanguage(getActivePromptProfile(settings).targetLanguage);
  let snapshot;
  try {
    snapshot = await readMessageSnapshot(messageId, settings);
  } catch (error) {
    if (quiet && /没有找到|不是普通 AI 回复/.test(safeError(error))) return { skipped: true, reason: 'not-translatable' };
    throw error;
  }
  runtime.activeFloor = snapshot.messageId;
  if (!snapshot.segments.length) throw new Error('当前 AI 回复没有可翻译的正文段落。');
  // Same gate as the whole-request path: without it a finished floor streams nothing and still
  // reports success, which reads as "流式写回没有生效".
  if (snapshot.translated && !force) return { skipped: true, reason: 'already-translated', snapshot };

  const lockKey = `${snapshot.chatId}|${snapshot.messageId}|${snapshot.swipeId}`;
  const existing = runtime.inflight.get(lockKey);
  // A re-roll lands on the same floor and swipe: other text there is not the run in flight.
  const moved = Boolean(existing?.sourceHash && existing.sourceHash !== snapshot.sourceHash);
  if (existing && !force && !moved) {
    if (!quiet) toast('info', '该楼层翻译正在进行，已沿用本次任务。');
    return existing.promise;
  }
  if (existing) existing.controller.abort();
  const controller = new AbortController();

  const work = (async () => {
    updateTask({
      status: 'running',
      title: `正在流式翻译第 ${snapshot.messageId} 楼`,
      message: `共 ${snapshot.paragraphs} 段、${snapshot.segments.length} 行，目标语言为${targetLanguage}。`,
      progress: 7,
    });
    recordDiagnostic('info', 'translation.start', '开始流式翻译当前楼层。', {
      messageId: snapshot.messageId,
      segments: snapshot.segments.length,
      paragraphs: snapshot.paragraphs,
      requestMode: 'stream',
      apiMode: settings.apiMode,
      model: getActiveChannel(settings).model || 'follow-current',
    });
    const channel = getActiveChannel(settings);
    const packet = await collectTranslationContext(
      snapshot,
      settings,
      channel.tokenSaving ? whitelistedWorldbookContent() : null,
    );
    const lanes = channelConcurrency(channel);
    const batches = planTranslationBatches(snapshot.segments, { maxChars: translationCharBudget(channel.maxTokens), parallel: lanes });
    // A forced run re-requests every segment; 补译 seeds with what is already written back.
    const translations = force ? new Map() : new Map(snapshot.existingTranslations);
    const annotations = force ? new Map() : new Map(snapshot.existingAnnotations);
    const seeded = translations.size > 0;
    const roster = annotationRoster(settings);
    const styles = translationStyles(settings);
    const total = snapshot.segments.length;

    // One progressive write at a time. Overlapping runs each snapshot the floor before the other
    // has assigned, so a failing saveChat could roll the floor back over a newer write.
    let progressChain = Promise.resolve();
    const writeProgress = () => {
      progressChain = progressChain.catch(() => {}).then(async () => {
        if (controller.signal.aborted || runtime.epoch !== epoch) return;
        const latest = await readMessageSnapshot(snapshot.messageId, settings).catch(() => null);
        if (!latest) return;
        await writeTranslation(latest, translations, epoch, settings, annotations);
      });
      return progressChain;
    };
    // Rewriting the floor is not free: every progressive write is a saveChat plus a MESSAGE_UPDATED
    // that other extensions listen to. The first updates stay quick so the floor visibly fills in,
    // then the interval backs off, which keeps a 100-segment floor to a handful of writes instead of
    // one every 700ms for the whole run. The end-of-run write is unconditional either way.
    let lastWrite = 0;
    let writes = 0;
    const maybeProgress = () => {
      const now = Date.now();
      if (now - lastWrite < Math.min(4000, 700 * (1 + writes))) return;
      lastWrite = now;
      writes += 1;
      writeProgress().catch(() => {});
    };
    // Chunk-level progress: pull completed JSON items out of the partial stream text so the
    // floor fills in while the model is still generating. The end-of-batch pass stays
    // authoritative, so a messy partial read can never corrupt the final floor.
    // Thinking is not progress on the floor, so it gets its own line rather than moving the bar.
    // Without it a reasoning model looks identical to a hung request for as long as it thinks.
    let lastThinking = 0;
    const reportThinking = reasoning => {
      const text = String(reasoning ?? '');
      const now = Date.now();
      if (now - lastThinking < 1000) return;
      lastThinking = now;
      updateThinking({ text, characters: text.length, live: true });
      updateTask({
        status: 'running',
        message: `副 API 正在思考（已 ${text.length} 字），还没有开始输出译文。`,
      });
    };
    // Throttled per batch. With batches streaming side by side, one shared clock let whichever batch
    // spoke first swallow every other batch's update inside the same window.
    const foldStreamedItems = pending => {
      let lastDelta = 0;
      return accumulated => {
        const now = Date.now();
        if (now - lastDelta < 600) return;
        lastDelta = now;
        try {
          const partial = withoutUntranslated(recoverStructuredTranslations(accumulated, pending), pending, settings, { quiet: true });
          let changed = false;
          for (const [id, value] of partial.translations) {
            if (!translations.has(id)) {
              translations.set(id, value);
              if (partial.annotations.has(id)) annotations.set(id, partial.annotations.get(id));
              changed = true;
            }
          }
          if (changed) {
            updateTask({
              status: 'running',
              message: `已恢复 ${translations.size} / ${total} 段。`,
              progress: 10 + Math.round(80 * translations.size / total),
            });
            maybeProgress();
          }
        } catch { /* partial text may not parse yet */ }
      };
    };

    // Batches running side by side share one thinking panel, so it is cleared once up front rather than
    // wiped by every batch that starts while another is still mid-thought.
    if (lanes > 1) {
      runtime.thinkingOpen = null;
      updateThinking({ text: '', characters: 0, live: false, batch: null });
    }
    const streamBatch = async (batch, batchIndex) => {
      const pending = batch.filter(segment => !translations.has(segment.id));
      if (!pending.length) return;
      const phase = seeded ? 'repair' : 'primary';
      const messages = buildTranslationMessages(pending, settings, packet, phase, { roster, styles });
      // Each batch thinks afresh; carrying the previous batch's thinking into this one would read as
      // the model having already written what it has not started.
      if (lanes === 1) {
        runtime.thinkingOpen = null;
        updateThinking({ text: '', characters: 0, live: false, batch: batchIndex + 1 });
      }
      let raw = '';
      try {
        raw = await streamTranslationBatch(messages, settings, controller.signal, foldStreamedItems(pending), reportThinking);
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) throw error;
        recordDiagnostic('warn', 'translation.stream-fallback', '流式请求中断，自动改用整包请求重试本批。', {
          batch: batchIndex + 1,
          segments: pending.length,
          error: safeError(error),
        });
        const recovered = await invokeTranslationBatch(pending, settings, controller.signal, packet, phase, { roster, styles });
        for (const [id, value] of recovered.translations) translations.set(id, value);
        for (const [id, mark] of recovered.annotations ?? []) annotations.set(id, mark);
        updateTask({
          status: 'running',
          message: `已恢复 ${translations.size} / ${total} 段。`,
          progress: 10 + Math.round(80 * translations.size / total),
        });
        maybeProgress();
        return;
      }
      const recovered = withoutUntranslated(recoverStructuredTranslations(raw, pending), pending, settings);
      for (const [id, value] of recovered.translations) translations.set(id, value);
      for (const [id, mark] of recovered.annotations) annotations.set(id, mark);
      const reasoning = extractReasoningText(raw);
      // The thinking stops being a progress indicator here and becomes a record: the panel folds it
      // away, and the log keeps the whole thing for anyone who wants to know where the minutes went.
      updateThinking({ text: reasoning || runtime.thinking.text, live: false });
      recordDiagnostic('info', 'translation.raw-response', '已收到副 API 流式返回。', {
        phase,
        requestedSegments: pending.length,
        requestedIds: pending.map(segment => segment.id),
        apiMode: settings.apiMode,
        model: channel.model || 'follow-current',
        requestTokens: describeRequestTokens(messages, raw),
        stream: true,
        reasoningCharacters: (reasoning || runtime.thinking.text).length || undefined,
      }, raw, { fullRequest: messages, reasoning: reasoning || runtime.thinking.text });
      updateTask({
        status: 'running',
        message: `已恢复 ${translations.size} / ${total} 段。`,
        progress: 10 + Math.round(80 * translations.size / total),
      });
      maybeProgress();
    };
    const streamProgress = beginBatchProgress(batches.length, lanes);
    await runInLanes(batches, lanes, (batch, index) => trackBatch(streamProgress, () => streamBatch(batch, index)));

    // The whole-request path asks again for whatever a batch left out. Streaming stopped at one attempt
    // per batch, so a line a small model skipped, or sent back still in Japanese, simply stayed missing
    // until someone pressed 补译. Close those gaps through the same repair loop before writing.
    const gaps = snapshot.segments.filter(segment => !translations.has(segment.id));
    if (gaps.length && translations.size && Number(settings.retries) > 0) {
      recordDiagnostic('warn', 'translation.stream-repair', '流式批次有缺失段落，改用整包请求补译。', {
        missingIds: gaps.map(segment => segment.id),
      });
      updateTask({ status: 'running', message: `正在补译缺失的 ${gaps.length} 段…` });
      try {
        const repaired = await invokeWithRetries(gaps, settings, controller.signal, packet, translations, null, annotations);
        for (const [id, value] of repaired.translations) translations.set(id, value);
        for (const [id, mark] of repaired.annotations ?? []) annotations.set(id, mark);
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) throw error;
        recordDiagnostic('warn', 'translation.stream-repair-failed', `流式补译没有成功：${safeError(error)}`, {});
      }
    }

    await repairForbiddenPhrases(snapshot.segments, translations, settings, controller.signal, packet);
    updateTask({ status: 'running', message: '正在写回楼层…', progress: 95 });
    await progressChain.catch(() => {});
    const written = await writeTranslation(snapshot, translations, epoch, settings, annotations);
    if (!written.complete) {
      updateTask({
        status: 'success',
        title: '已写回部分译文',
        message: `第 ${snapshot.messageId} 楼已写回 ${translations.size} / ${total} 段；缺的部分可用「补译缺失段落」继续。`,
        progress: 100,
      });
      if (!quiet) toast('warning', `已写回 ${translations.size} / ${total} 段，其余保留原文。`);
      return { skipped: false, partial: true, messageId: snapshot.messageId, segments: translations.size };
    }
    updateTask({
      status: 'success',
      title: '流式翻译完成',
      message: `第 ${snapshot.messageId} 楼已追加 ${snapshot.paragraphs} 段${targetLanguage}镜像。`,
      progress: 100,
    });
    if (!quiet) toast('success', `第 ${snapshot.messageId} 楼流式翻译完成。`);
    return { skipped: false, messageId: snapshot.messageId, segments: translations.size };
  })().catch(error => {
    if (isAbortError(error)) {
      const current = runtime.inflight.get(lockKey);
      if (!current || current.promise === work) updateTask({ status: 'idle', title: '翻译已取消', message: '聊天已切换或任务已停止。', progress: 0 });
      return { skipped: true, reason: 'cancelled' };
    }
    const message = safeError(error);
    updateTask({ status: 'error', title: '翻译未写回', message, progress: 0 });
    recordDiagnostic('error', 'translation.failed', message, { messageId: snapshot?.messageId ?? null, requestMode: 'stream', endpoint: describeChannelEndpoint(settings) });
    if (!quiet) toast('error', message);
    throw error;
  }).finally(() => {
    if (runtime.inflight.get(lockKey)?.promise === work) runtime.inflight.delete(lockKey);
  });

  runtime.inflight.set(lockKey, { promise: work, controller, sourceHash: snapshot.sourceHash });
  return work;
}

// Single entry point for every translation trigger, so the streaming toggle and the force/quiet
// semantics can never drift apart between the control centre, the mini window and the auto hooks.
function startTranslation(messageId = null, { force = false, quiet = false, only = null } = {}) {
  // A few paragraphs on their own always go the whole-request way: there is nothing to stream.
  return runtime.settings.streamingWriteback && !only
    ? translateMessageStreaming(messageId, { force, quiet })
    : translateMessage(messageId, { force, quiet, only });
}

/**
 * Writes the reader's own wording of one paragraph into the floor. The other translations and the
 * labels stay; the floor is re-rendered the way a translation run renders it.
 */
async function editTranslationSegment(messageId, segmentId, text) {
  const wording = String(text ?? '').trim();
  if (!wording) throw new Error('译文不能是空的。');
  const settings = runtime.settings;
  const snapshot = await readMessageSnapshot(messageId, settings);
  const id = Number(segmentId);
  if (!snapshot.segments.some(segment => segment.id === id)) throw new Error('这一段已经变了，刷新后再改。');
  const translations = new Map(snapshot.existingTranslations);
  translations.set(id, wording);
  const written = await writeTranslation(snapshot, translations, runtime.epoch, settings, snapshot.existingAnnotations);
  recordDiagnostic('info', 'translation.edit', `第 ${snapshot.messageId} 楼第 ${id} 段的译文已按手改写回。`, {
    messageId: snapshot.messageId, segment: id, characters: wording.length, complete: written.complete,
  });
  return written;
}

/**
 * One short request through one connection. From the connection page that is the connection being
 * edited, whoever uses it; without one named, the translation's own.
 */
async function testTranslationChannel({ channelId = null } = {}) {
  const settings = channelId ? onChannel(runtime.settings, channelId) : runtime.settings;
  const name = settings.apiMode === 'independent' ? `连接「${getActiveChannel(settings).name}」` : '酒馆当前连接';
  updateTask({ status: 'running', title: `正在测试${name}`, message: '发送一段最小测试文本。', progress: 25 });
  try {
    let packet = {};
    try {
      packet = await collectTranslationContext(await readMessageSnapshot(), settings);
    } catch {
      // A channel test also works before a translatable story exists.
    }
    const result = await invokeWithRetries([{ id: 1, text: '雨が降っている。' }], settings, undefined, packet);
    const sample = result.translations.get(1);
    updateTask({ status: 'success', title: `${name}可用`, message: `单句连通测试通过：${sample}（不代表长正文不会被截断）`, progress: 100 });
    recordDiagnostic('info', 'channel.test', `${name}测试成功。`, {
      apiMode: settings.apiMode,
      model: settings.apiMode === 'independent' ? getActiveChannel(settings).model : 'follow-current',
      endpoint: describeChannelEndpoint(settings),
    });
    toast('success', `${name}测试成功。`);
    return sample;
  } catch (error) {
    const message = safeError(error);
    updateTask({ status: 'error', title: `${name}测试失败`, message, progress: 0 });
    recordDiagnostic('error', 'channel.test', message, {
      apiMode: settings.apiMode,
      model: settings.apiMode === 'independent' ? getActiveChannel(settings).model : 'follow-current',
      endpoint: describeChannelEndpoint(settings),
    });
    toast('error', message);
    throw error;
  }
}

async function fetchChannelModels(channelId = null) {
  const context = getContext();
  if (typeof context.getRequestHeaders !== 'function') throw new Error('当前 SillyTavern 不提供模型列表请求接口。');
  const channel = runtime.settings.channels.find(item => item.id === channelId) ?? getActiveChannel(runtime.settings);
  if (!channel.url) throw new Error('请先填写这条连接的地址。');
  updateTask({ status: 'running', title: '正在读取模型列表', message: `连接 ${channel.name}…`, progress: 35 });
  try {
    const data = await withAbortTimeout(undefined, channel.timeoutSec, async signal => {
      const response = await fetch('/api/backends/chat-completions/status', {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({
          chat_completion_source: 'openai',
          reverse_proxy: normalizeOpenAiBaseUrl(channel.url),
          proxy_password: channel.key || '',
        }),
        signal,
        cache: 'no-cache',
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`模型列表请求失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 160)}` : ''}`);
      }
      return response.json();
    });
    const models = parseModelListResponse(data);
    if (!models.length) throw new Error('接口已响应，但没有返回可用模型。');
    channel.models = models;
    saveSettings(runtime.settings);
    updateTask({
      status: 'success',
      title: '模型列表已更新',
      message: channel.model
        ? `已读取 ${models.length} 个模型；当前仍使用 ${channel.model}。`
        : `已读取 ${models.length} 个模型，请从完整列表中选择。`,
      progress: 100,
    });
    return models;
  } catch (error) {
    const message = safeError(error);
    updateTask({ status: 'error', title: '模型列表读取失败', message, progress: 0 });
    // Without this the log stayed empty for the one failure that points straight at a wrong base
    // URL: a relay that answers /chat/completions but has no /models under the same path.
    recordDiagnostic('error', 'channel.models', message, {
      channel: channel.name,
      endpoint: describeChannelEndpoint(onChannel(runtime.settings, channel.id)),
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Reading aloud: runtime.
//
// tts.js decides what is read, by whom, in what mood and where each sentence sits in the audio. This
// part moves data between the floor, the secondary model, Fish, the cache and one <audio> element, and
// puts buttons on the rendered floor. It never writes to `mes`: the labels, the provider markup and the
// audio all live beside the story, never inside it.
//
// Audio is made in units — the whole floor, or one paragraph — and every unit's recording remembers
// which sentences it holds in which voice. Playing anything starts by looking for a recording that
// already holds it, whatever unit it was made in, so a floor recorded whole is never paid for again
// sentence by sentence, and a paragraph recorded in the stream is found again by the floor.
// ---------------------------------------------------------------------------------------------

const TTS_ICON_PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5.2 3.3v9.4l7.3-4.7z"/></svg>';
const TTS_ICON_STOP = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="4.2" y="4.2" width="7.6" height="7.6" rx="1.2"/></svg>';
const TTS_ICON_PAUSE = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="4" y="3.6" width="2.9" height="8.8" rx="0.9"/><rect x="9.1" y="3.6" width="2.9" height="8.8" rx="0.9"/></svg>';
const TTS_ICON_REDO = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M13 8a5 5 0 1 1-1.6-3.7" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M12.9 2.6v2.9h-2.9z"/></svg>';
const TTS_ICON_EDIT = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 4.6h10M3 8h10M3 11.4h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/><circle cx="6.2" cy="4.6" r="1.5"/><circle cx="10.4" cy="8" r="1.5"/><circle cx="7.6" cy="11.4" r="1.5"/></svg>';
const TTS_RANGE_LABELS = Object.freeze({ all: '旁白 + 对白', dialogue: '只读对白', narration: '只读旁白' });
const TTS_MODE_LABELS = Object.freeze({ off: '不分析', simple: '简单', deep: '深度' });
const TTS_INLINE_WRAPPERS = new Set(['Q', 'EM', 'STRONG', 'I', 'B', 'U', 'S', 'SPAN', 'FONT', 'SMALL', 'MARK', 'DEL', 'INS', 'SUB', 'SUP', 'CITE']);

function ttsSettings(settings = runtime.settings) {
  return normalizeTts(settings?.tts);
}

function ttsStore() {
  runtime.tts.store ??= createTtsStore({ now: ttsClock });
  return runtime.tts.store;
}

// One clock for everything the reading stamps — the moment an analysis was asked for, the moment a
// recording was made — that never shows the same moment twice. 「Made before the analysis」 is a
// comparison of two of its readings, and a tie inside one millisecond must not decide it.
let ttsClockLast = 0;
function ttsClock() {
  const now = Date.now();
  ttsClockLast = now > ttsClockLast ? now : ttsClockLast + 1;
  return ttsClockLast;
}

// Where this cast's voice table is kept: under the character card, or under this one chat when the
// reader keeps a table per playthrough. A chat that has no table of its own yet reads the card's, and
// the first save in that chat writes its own copy.
function ttsVoicesKey(settings = runtime.settings) {
  const characterKey = worldInfoCharacterKey();
  if (ttsSettings(settings).voiceScope !== 'chat') return characterKey;
  const chatId = getCurrentChatId();
  return chatId ? `${characterKey}|chat|${chatId}` : characterKey;
}

function ttsVoicesFor(settings = runtime.settings) {
  const tables = settings?.ttsVoices ?? {};
  const key = ttsVoicesKey(settings);
  if (Array.isArray(tables[key])) return normalizeVoiceList(tables[key]);
  return normalizeVoiceList(tables[worldInfoCharacterKey()]);
}

// Whether the table shown is this chat's own or borrowed from the card.
function ttsVoicesOwned(settings = runtime.settings) {
  const key = ttsVoicesKey(settings);
  return key === worldInfoCharacterKey() || Array.isArray(settings?.ttsVoices?.[key]);
}

function ttsVoiceConfig(settings = runtime.settings) {
  const tts = ttsSettings(settings);
  return { voices: ttsVoicesFor(settings), narratorVoice: tts.narratorVoice, narratorVoices: tts.narratorVoices, dialogueVoice: tts.dialogueVoice, dialogueFallback: tts.dialogueFallback };
}

// Everyone this cast is known by: voiced characters first, then the colour palette and the names the
// model has already reported this session.
function ttsKnownNames(settings = runtime.settings) {
  return [...new Set([...voiceRosterNames(ttsVoicesFor(settings)), ...speakerRoster(settings), ...runtime.autoSpeakerNames])];
}

/**
 * The people the speaker engine can name, each with the spellings it may meet in the text: the voice
 * table's rows, the colouring's palette, the card's character and the reader, and whoever the model
 * has already named this session. Names only; which voice a name reads in is nobody's business here.
 */
function ttsCast(settings = runtime.settings) {
  const context = getContext();
  const cast = [];
  const add = (name, aliases = []) => {
    const clean = String(name ?? '').trim();
    if (!clean) return;
    const spellings = (Array.isArray(aliases) ? aliases : []).map(alias => String(alias ?? '').trim()).filter(alias => alias && alias !== clean);
    const entry = cast.find(item => item.name === clean);
    if (entry) {
      for (const alias of spellings) if (!entry.aliases.includes(alias)) entry.aliases.push(alias);
      return;
    }
    cast.push({ name: clean, aliases: [...new Set(spellings)] });
  };
  for (const row of ttsVoicesFor(settings)) add(row.name, row.aliases);
  for (const speaker of speakerPaletteFor(settings)) add(speaker.name, speaker.aliases);
  add(context.name2);
  add(context.name1);
  for (const name of runtime.autoSpeakerNames) add(name);
  return cast;
}

/** The cast's names alone, for the reader to pick from. */
function ttsCastNames(settings = runtime.settings) {
  return ttsCast(settings).map(entry => entry.name);
}

/** The speakers the reader set by hand on this floor, by utterance id. */
async function ttsManualSpeakers(floor) {
  const manual = new Map();
  for (const [id, record] of await ttsOverrides(floor)) if (record?.speaker) manual.set(id, record.speaker);
  return manual;
}

/** The provider adapter the reading sends through. Fish is the only one today; the settings name it. */
function ttsProviderFor(settings = runtime.settings) {
  return ttsProvider(ttsSettings(settings).provider ?? 'fish');
}

function ttsUtterances(floor, settings = runtime.settings) {
  const tts = ttsSettings(settings);
  return splitUtterances(floor.lines, { quotePairs: tts.quotePairs, skipPairs: tts.skipPairs });
}

/**
 * The speaker marks the story wrote into a floor, read onto the utterances being prepared: straight
 * off the original's lines, or, for the translation, off the original's and carried over line by line
 * and quote by quote — the translator never saw the marks and its text has none.
 */
function ttsTagReading(floor, utterances, tts) {
  if (floor.lines?.some(line => line.speech)) return speechTagReading(utterances, floor.lines);
  if (!floor.speechSource?.length) return { labels: new Map(), voices: new Map() };
  const originals = splitUtterances(floor.speechSource, { quotePairs: tts.quotePairs, skipPairs: tts.skipPairs });
  const own = speechTagReading(originals, floor.speechSource);
  if (!own.labels.size) return own;
  return deriveLabelsForSide(originals, own.labels, own.voices, utterances);
}

/**
 * The lines one floor would read, with the version they are cached under.
 *
 * A floor this extension translated is read through its own boundaries, which do not care what the
 * visible affixes are. One it never translated falls back to literal source tags such as
 * <jy-translation>, for presets that type them themselves.
 */
// The languages a floor is read in under the current setting, the one the floor bar plays first.
function ttsSides(settings = runtime.settings) {
  const side = ttsSettings(settings).side;
  return side === 'both' ? ['translation', 'source'] : [side];
}

function primaryTtsSide(settings = runtime.settings) {
  return ttsSides(settings)[0];
}

async function collectTtsFloor(messageId, settings = runtime.settings, sideOverride = null) {
  const context = getContext();
  const id = Number(messageId);
  const message = context.chat?.[id];
  if (!Number.isInteger(id) || !message || message.is_user || message.is_system || typeof message.mes !== 'string') return null;
  const chatId = getCurrentChatId(context);
  const swipeId = Number(message.swipe_id ?? 0);
  const requested = sideOverride ?? ttsSettings(settings).side;
  const side = requested === 'both' ? 'translation' : requested;
  let lines = [];
  let annotations = new Map();
  let references = null;
  let source = 'tags';
  let complete = false;
  let sources = null;
  // The original's lines with the speaker marks the story wrote into them, when it wrote any.
  let speechSource = null;
  // The original is readable on any floor whose body tags extract, translated or not; the translation
  // only on a floor this extension wrote, or through the literal source tags below.
  if (side === 'source' || message.extra?.[MESSAGE_META_KEY]) {
    try {
      const snapshot = await readMessageSnapshot(id, settings, { quiet: true });
      annotations = canonicalAnnotations(settings, snapshot.existingAnnotations);
      complete = snapshot.translated === true;
      // A line the story marked with <say> is read off its marks: the words as every line is cleaned,
      // and which run each mark names. A line without marks is taken exactly as it always was.
      const quotePairs = ttsSettings(settings).quotePairs;
      const originalLine = segment => {
        const marked = snapshot.speech?.get(segment.id);
        if (!marked) return { lineId: segment.id, text: plainLineText(segment.text) };
        const read = readSpeechLine(marked, { quotePairs });
        return read.spans.length ? { lineId: segment.id, text: read.text, speech: read.spans } : { lineId: segment.id, text: read.text };
      };
      if (side === 'source') {
        lines = snapshot.segments.map(originalLine).filter(line => line.text);
        references = new Map([...snapshot.existingTranslations].map(([lineId, text]) => [lineId, plainLineText(text)]));
        source = 'source';
      } else {
        lines = snapshot.segments
          .filter(segment => snapshot.existingTranslations.has(segment.id))
          .map(segment => ({ lineId: segment.id, text: plainLineText(snapshot.existingTranslations.get(segment.id)) }))
          .filter(line => line.text);
        sources = new Map(snapshot.segments.map(segment => [segment.id, plainLineText(segment.text)]));
        source = 'translation';
        // The translation carries no marks of its own; the original's are carried over to it, line by
        // line and quote by quote, when the reading is prepared.
        if (snapshot.speech?.size) {
          const original = snapshot.segments.map(originalLine).filter(line => line.text);
          if (original.some(line => line.speech)) speechSource = original;
        }
      }
    } catch {
      lines = [];
    }
  }
  if (!lines.length && side === 'translation') {
    lines = linesFromTaggedText(message.mes, ttsSettings(settings).sourceTags);
    source = 'tags';
  }
  if (!lines.length) return null;
  return {
    chatId,
    messageId: id,
    swipeId,
    side,
    // One floor has two readable texts; each keeps its own audio and its own clean-up.
    floorId: `${chatId}|${id}|${swipeId}|${side}`,
    version: await hashText(JSON.stringify(lines.map(line => line.text))),
    lines,
    annotations,
    references: references?.size ? references : null,
    // The original of each translated line, for the details page of a bilingual reader.
    sources: sources?.size ? sources : null,
    ...(speechSource ? { speechSource } : {}),
    source,
    // Whether the translation this floor reads is finished; the original is always whole.
    complete: side === 'source' || source === 'tags' ? true : complete,
  };
}

function ttsLabelKey(floor) {
  return `${floor.floorId}|${floor.version}`;
}

// One promise per cache key. A second click on something already being generated waits for the same
// request instead of paying for another one; each job has its own controller so a stop can cancel it.
function dedupeTtsJob(key, messageId, work, { onPrefix = null } = {}) {
  const existing = runtime.tts.jobs.get(key);
  if (existing) {
    // A second asker for a reading in progress hears about its batches too, the ones already back at once.
    if (onPrefix) {
      existing.prefixListeners.push(onPrefix);
      if (existing.lastPrefix) onPrefix(existing.lastPrefix);
    }
    return existing.promise;
  }
  const controller = new AbortController();
  const job = { controller, messageId, prefixListeners: onPrefix ? [onPrefix] : [], lastPrefix: null };
  const notify = prefix => {
    job.lastPrefix = prefix;
    for (const listener of job.prefixListeners) listener(prefix);
  };
  const promise = Promise.resolve().then(() => work(controller.signal, notify)).finally(() => {
    if (runtime.tts.jobs.get(key)?.promise === promise) runtime.tts.jobs.delete(key);
  });
  job.promise = promise;
  runtime.tts.jobs.set(key, job);
  return promise;
}

function abortTtsJobs(messageId = null) {
  for (const [key, job] of runtime.tts.jobs) {
    if (messageId !== null && job.messageId !== messageId) continue;
    job.controller.abort();
    runtime.tts.jobs.delete(key);
  }
}

// How deeply a floor is read: the whole-floor mode reads deeply unless told otherwise, the stream
// lightly, and 'annotations' asks the model nothing at all.
function ttsAnalysisDepth(tts) {
  return tts.mode === 'deep' ? 'deep' : tts.mode === 'off' ? 'off' : 'simple';
}

/**
 * What each speaker said last before this floor, with the direction it was read in, off the marks the
 * translations stored: the deep reading's way of knowing whether a mood carries over.
 */
async function ttsPreviousLines(floor, settings = runtime.settings) {
  const context = getContext();
  const chat = Array.isArray(context.chat) ? context.chat : [];
  const seen = new Map();
  for (let id = floor.messageId - 1; id >= 0 && id >= floor.messageId - 6 && seen.size < 8; id -= 1) {
    const message = chat[id];
    if (!message || message.is_user || message.is_system || !message.extra?.[MESSAGE_META_KEY]) continue;
    let snapshot;
    try {
      snapshot = await readMessageSnapshot(id, settings, { quiet: true });
    } catch {
      continue;
    }
    const marks = canonicalAnnotations(settings, snapshot.existingAnnotations);
    for (const segment of [...snapshot.segments].reverse()) {
      const mark = marks.get(segment.id);
      if (!mark) continue;
      const text = plainLineText(snapshot.existingTranslations.get(segment.id) ?? '');
      const quotes = Array.isArray(mark.quotes) && mark.quotes.length ? [...mark.quotes].reverse() : [mark];
      for (const quote of quotes) {
        const speaker = quote?.speaker;
        if (!speaker || seen.has(speaker)) continue;
        const from = quote.head ? text.indexOf(quote.head) : -1;
        const direction = quote.direction || mark.direction || '';
        seen.set(speaker, { speaker, text: (from >= 0 ? text.slice(from) : text).slice(0, 80), ...(direction ? { direction } : {}) });
      }
    }
  }
  return [...seen.values()];
}

// The most of each reference the deep reading is handed. A worldbook runs to tens of thousands of
// characters; the reading needs the gist of the people, not the whole rulebook.
const TTS_CONTEXT_CAPS = Object.freeze({ character: 2500, worldbook: 3000, recent: 3000 });

// What the deep reading may see. The translation's own context builder is reused with the reading's
// switches in place of the translation's, so the worldbook, the card and the recent floors arrive in
// the same shape and the same clean-up the translator gets.
async function ttsContextPacket(floor, settings) {
  const tts = ttsSettings(settings);
  const wants = tts.context;
  if (!wants.character && !wants.worldbook && !wants.recent) return { character: '', worldbook: '', recent: '' };
  try {
    const snapshot = await readMessageSnapshot(floor.messageId, settings, { quiet: true });
    // On the deep reading's own connection, so that connection's token saving is the one that applies.
    const scoped = {
      ...ttsRequestSettings(settings, 'deep'),
      includeCharacterCard: wants.character,
      includeWorldbook: wants.worldbook,
      includeRecentContext: wants.recent && wants.floors > 0,
      contextMessages: Math.max(1, wants.floors),
    };
    const packet = await collectTranslationContext(snapshot, scoped, getActiveChannel(scoped).tokenSaving ? whitelistedWorldbookContent() : null);
    const cap = (value, limit) => {
      const text = String(value ?? '');
      return text.length > limit ? `${text.slice(0, limit)}\n…（已截断）` : text;
    };
    return { character: cap(packet.character, TTS_CONTEXT_CAPS.character), worldbook: cap(packet.worldbook, TTS_CONTEXT_CAPS.worldbook), recent: cap(packet.recent, TTS_CONTEXT_CAPS.recent) };
  } catch (error) {
    recordDiagnostic('warn', 'tts.context', `读取朗读分析的背景资料失败，这一楼只按正文分析：${safeError(error)}`, { floor: floor.floorId });
    return { character: '', worldbook: '', recent: '' };
  }
}

/**
 * Asks the model about one floor, once per text version and depth.
 *
 * The light reading labels speaker and mood; the deep one reads the floor with its context and returns
 * a voice for every sentence that needs one, leaning on the translation's own labels for the rest.
 * Either way the answer is labels keyed by id and never text. `onRequest` is told only when a request
 * actually goes out, so a cached reading never claims to be thinking.
 */
async function analyzeTtsFloor(floor, utterances, settings, depth, { force = false, onRequest = null, onPrefix = null, speakers = null, cacheOnly = false } = {}) {
  const roster = ttsKnownNames(settings);
  const tts = ttsSettings(settings);
  const key = await analysisCacheKey({ utterances, source: 'model', depth, side: floor.side });
  if (!force) {
    const stored = await ttsStore().getAnalysis(key);
    if (Array.isArray(stored?.labels) && stored.labels.length) {
      // Which floor it was asked for: the key is the text alone, and the same words in another chat
      // find the same reading.
      return { labels: new Map(stored.labels), voices: new Map(stored.voices ?? []), depth, cached: true, floorId: stored.floorId ?? '' };
    }
  }
  // Only looking: what the store holds, or nothing. Never a request.
  if (cacheOnly) return null;
  return dedupeTtsJob(key, floor.messageId, async (signal, notifyPrefix) => {
    onRequest?.();
    // The moment this reading was asked for. Every label it returns carries it, and audio made before
    // it — from whatever reading this one replaces — is no longer the audio of those sentences. The
    // moment of asking rather than of answering: paragraphs heard while the answer still streams in
    // were made from this reading, and are its audio.
    const askedAt = ttsClock();
    const request = ttsRequestSettings(settings, depth);
    const packet = depth === 'deep' ? await ttsContextPacket(floor, settings) : null;
    const context = getContext();
    const options = {
      roster, characterName: context.name2 ?? '', userName: context.name1 ?? '', translations: floor.references,
      packet, speakers, styles: ttsStyles(settings), systemPrompt: depth === 'deep' ? tts.prompts.deep : tts.prompts.simple,
    };
    // One request for the whole floor: the paragraphs with their dialogue numbered, the dialogue alone
    // answered. The reply is read as it arrives, and every paragraph whose dialogue is all labelled is
    // handed on, so the floor starts sounding before the model has finished.
    const messages = depth === 'deep' ? buildDeepAnalysisMessages(utterances, options) : buildTtsAnalysisMessages(utterances, options);
    const started = Date.now();
    const paragraphs = groupSegmentsByLine(utterances.map(item => ({ id: item.id, lineId: item.lineId, kind: item.kind })));
    let announced = 0;
    let closed = 0;
    // Frames do not fall on object boundaries, so what is counted is the closing braces seen so far:
    // a new one means another sentence may have arrived, and nothing is parsed twice for nothing.
    const announce = text => {
      if (!notifyPrefix) return;
      const braces = (String(text).match(/}/g) ?? []).length;
      if (braces <= closed) return;
      closed = braces;
      const partial = parseVoiceAnalysis(text, utterances);
      let ready = 0;
      const readyIds = new Set();
      for (const line of paragraphs) {
        if (line.segments.some(item => item.kind === 'quoted' && !partial.labels.has(item.id))) break;
        ready += 1;
        for (const item of line.segments) readyIds.add(item.id);
      }
      if (ready <= announced) return;
      announced = ready;
      try {
        notifyPrefix({ labels: stampLabels(partial.labels, askedAt), voices: partial.voices, readyIds, ready, total: paragraphs.length });
      } catch (error) {
        recordDiagnostic('warn', 'tts.analysis', `边到边读时处理已回的段落出错：${safeError(error)}`, { floor: floor.floorId, ready }, '', { floor: floor.messageId });
      }
    };
    let raw;
    try {
      if (request.apiMode === 'independent') {
        try {
          // A thinking model answers in a wrapper; only what it finally wrote is the analysis.
          const streamed = await streamTranslationBatch(messages, request, signal, announce, null, { limitSec: tts.analysisLimitSec });
          raw = typeof streamed === 'string' ? streamed : String(streamed?.content ?? '');
        } catch (error) {
          // A connection that refuses the stream outright answers in one piece instead; a timeout or
          // a stop is not that, and is not asked a second time.
          if (isAbortError(error) || !/流式请求失败/.test(safeError(error))) throw error;
          recordDiagnostic('warn', 'tts.analysis', `这条连接不支持边收边读，改用整包请求：${safeError(error)}`, {
            floor: floor.floorId, depth, endpoint: describeChannelEndpoint(request),
          }, '', { floor: floor.messageId });
          raw = await requestSubModelRaw(messages, request, signal, { limitSec: tts.analysisLimitSec });
        }
      } else {
        raw = await requestSubModelRaw(messages, request, signal, { limitSec: tts.analysisLimitSec });
      }
    } catch (error) {
      if (!isAbortError(error)) {
        recordDiagnostic('error', 'tts.analysis-failed', `朗读分析请求失败：${safeError(error)}`, {
          floor: floor.floorId,
          depth,
          utterances: utterances.length,
          apiMode: request.apiMode,
          endpoint: describeChannelEndpoint(request),
        }, describeRequestFailure(error), { fullRequest: messages, floor: floor.messageId });
      }
      throw error;
    }
    const parsed = parseVoiceAnalysis(raw, utterances);
    parsed.labels = stampLabels(parsed.labels, askedAt);
    const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
    recordDiagnostic(parsed.labels.size ? 'info' : 'warn', 'tts.analysis', parsed.labels.size
      ? `${depth === 'deep' ? '深度分析' : '简单分析'}给 ${parsed.labels.size} 句对白标了说话人或情绪${parsed.voices.size ? `，${parsed.voices.size} 句带表演` : ''}，用时 ${seconds} 秒。`
      : `副模型没有返回可用的朗读标注，这一楼按引号区分旁白与对白。`, {
      floor: floor.floorId,
      depth,
      utterances: utterances.length,
      labeled: parsed.labels.size,
      voiced: parsed.voices.size,
      apiMode: request.apiMode,
      endpoint: describeChannelEndpoint(request),
      requestTokens: describeRequestTokens(messages, raw),
      contextBytes: packet ? Object.values(packet).reduce((sum, value) => sum + String(value ?? '').length, 0) : undefined,
      seconds,
    }, raw, { fullRequest: messages, floor: floor.messageId });
    // An empty answer is not cached: the next play asks again instead of living with a failed reply.
    if (parsed.labels.size) {
      await ttsStore().putAnalysis({ key, floorId: floor.floorId, version: floor.version, depth, labels: [...parsed.labels], voices: [...parsed.voices], analyzedAt: askedAt });
    }
    return { labels: parsed.labels, voices: parsed.voices, depth, cached: false, analyzedAt: askedAt };
  }, { onPrefix });
}

/**
 * The settings one analysis request goes out under: the same settings with the connection swapped
 * for the one the reading chose on its own page — the host's connection or a saved one — and, for
 * the deep reading, the one chosen in its own section when there is one. The translation's choice
 * never decides where the reading goes.
 */
function ttsRequestSettings(settings = runtime.settings, depth = 'simple') {
  const base = onChannel(settings, ttsSettings(settings).analysisChannelId);
  return depth === 'deep' ? deepRequestSettings(base) : base;
}

/**
 * The same settings, pointed at one connection: 'follow' for the host's own, else a saved one's id.
 * Unknown or empty ids change nothing — the same object comes back, as it does when the connection
 * asked for is the one these settings already point at.
 */
function onChannel(settings, id) {
  const wanted = String(id ?? '').trim();
  if (!wanted) return settings;
  if (wanted === 'follow') return settings?.apiMode === 'follow' ? settings : { ...settings, apiMode: 'follow' };
  const channels = Array.isArray(settings?.channels) ? settings.channels : [];
  if (!channels.some(channel => channel.id === wanted)) return settings;
  if (settings?.apiMode === 'independent' && settings?.selectedChannelId === wanted) return settings;
  return { ...settings, apiMode: 'independent', selectedChannelId: wanted };
}

// A floor of more than this many sentences is read in batches when the connection allows more than
// one request at a time; a batch never cuts a paragraph in half.
const TTS_BATCH_DEFAULT = 12;


// The floor the reading is taken from when both languages are read: the translation, where the cast
// is named the way the voices are registered; the original only when there is no translation.
async function ttsPrimaryFloor(floor, settings) {
  const tts = ttsSettings(settings);
  // The deep reading is made on the text that is heard: its pauses and stresses name words of that
  // text. Only when both languages are read does one side follow the other, and then the original
  // leads, because that is the text the floor closed on.
  if (tts.mode === 'deep') {
    if (tts.side !== 'both' || floor.side !== 'translation') return null;
    return collectTtsFloor(floor.messageId, settings, 'source');
  }
  if (tts.side !== 'both' || floor.side !== 'source') return null;
  const translation = await collectTtsFloor(floor.messageId, settings, 'translation');
  return translation && translation.source !== 'tags' ? translation : null;
}

/**
 * Utterances plus labels for one floor.
 *
 * The translation's own annotations are the starting point and cost nothing. When the model is asked,
 * it is asked once per text version and depth; a failed request falls back to the annotations with a
 * warning rather than refusing to read. When both languages are read, the original is labelled from
 * the translation's reading instead of being read a second time.
 */
async function prepareTtsSegments(floor, settings, { onStatus = null, force = false, onStep = null, onPartial = null, passive = false, analyze = null } = {}) {
  const tts = ttsSettings(settings);
  const utterances = ttsUtterances(floor, settings);
  // What the translation already said about every quoted run: who, in what mood, in Fish's own words.
  const reading = annotationReading(utterances, floor.annotations);
  const annotated = reading.labels.size > 0;
  // What the story marked itself with <say>: its author's word on who says each line and how. It is
  // laid over the translation's, and costs nothing.
  const tagged = ttsTagReading(floor, utterances, tts);
  for (const [id, label] of tagged.labels) reading.labels.set(id, { ...(reading.labels.get(id) ?? {}), ...label });
  for (const [id, voice] of tagged.voices) reading.voices.set(id, { ...(reading.voices.get(id) ?? {}), ...voice });
  const tagSpeakers = speakerHints(tagged.labels);
  // Every line of dialogue marked: nobody needs to be asked who speaks it, or how.
  const fullyTagged = tagged.labels.size > 0 && utterances.every(item => item.kind !== 'quoted' || tagged.labels.has(item.id));
  const marksFrom = annotated && tagged.labels.size ? '翻译时的标注和正文里的说话人标记' : annotated ? '翻译时的标注' : '正文里的说话人标记';
  let labels = reading.labels;
  let voices = reading.voices.size ? reading.voices : null;
  // `analyze` asks for one reading regardless of the mode: the plain reading's own request for a
  // simple analysis of this floor.
  let depth = analyze ?? ttsAnalysisDepth(tts);
  // The reader's word on who speaks holds in every reading. The text's own reading of it belongs to
  // the plain reading alone; the analysed readings name their speakers themselves.
  const manual = await ttsManualSpeakers(floor);
  const cast = ttsCast(settings);
  const host = getContext();
  const protagonists = { character: host.name2 ?? '', user: host.name1 ?? '' };
  let resolved = resolveSpeakers(utterances, { cast, manual, tagged: tagSpeakers, infer: false });
  // Where a label's speaker came from when nobody else named one: the translation's mark or the model.
  let fallback = 'hint';
  const floorKey = ttsLabelKey(floor);
  // A model's reading with the translation's marks under it: the translation's name where the model
  // named nobody, its Fish words under whatever the model added — an id-only answer keeps them whole.
  const adopt = analyzed => {
    const adopted = new Map(analyzed.labels);
    for (const [id, hint] of reading.labels) {
      const label = adopted.get(id);
      if (hint.speaker && label && !label.speaker) adopted.set(id, { ...label, speaker: hint.speaker, speakerSource: 'hint' });
    }
    return { labels: adopted, voices: mergeVoiceMaps(reading.voices, analyzed.voices) };
  };
  // A reading of this very text kept from before — an earlier session, a page reloaded, a reading asked
  // for by hand — is this floor's reading. Finding it asks nobody. Without this a reload forgot every
  // floor's analysis until it was played, so a correction was built on nothing and the audio made
  // from the analysis no longer matched what the floor showed.
  // Where something else speaks for the floor without a model — the plain reading, the translation's
  // marks — only a reading asked for on this very floor outranks it: the store is keyed by the words
  // alone, and a greeting read in one chat must not decide how the same greeting reads in another.
  const stored = async (wanted, { thisFloor = false } = {}) => {
    if (force || !utterances.length) return null;
    const found = await analyzeTtsFloor(floor, utterances, settings, wanted, { cacheOnly: true }).catch(() => null);
    if (!found?.labels?.size || (thisFloor && found.floorId !== floor.floorId)) return null;
    const entry = { ...found, ...adopt(found), depth: wanted };
    runtime.tts.analysis.set(floorKey, entry);
    return entry;
  };
  // A floor the plain reading asked to have analysed once keeps that analysis.
  const plainKept = runtime.tts.plainFloors.has(floorKey);
  let asked = depth === 'off' && !plainKept ? runtime.tts.analysis.get(floorKey) : null;
  const primary = await ttsPrimaryFloor(floor, settings);
  if (!primary && depth === 'off' && !plainKept && !asked) asked = await stored('simple', { thisFloor: true });
  if (primary) {
    const read = await prepareTtsSegments(primary, settings, { onStatus, force, onStep, passive });
    const derived = deriveLabelsForSide(read.utterances, read.labels, read.voices, utterances);
    for (const [id, label] of derived.labels) labels.set(id, { ...(labels.get(id) ?? {}), ...label });
    voices = derived.voices;
    depth = read.depth ?? depth;
    const key = ttsLabelKey(floor);
    runtime.tts.analysis.set(key, { labels, voices, depth, derived: true });
  } else if (asked?.labels?.size) {
    labels = asked.labels;
    voices = asked.voices ?? null;
    depth = asked.depth ?? 'simple';
    fallback = depth === 'annotations' ? 'hint' : 'model';
    onStep?.('analysis', { state: 'done', label: '简单分析', detail: depth === 'annotations' ? '用翻译时的标注' : '这一楼按你的要求分析过' });
  } else if (depth === 'off' && annotated) {
    // Translated with the reading on: the translation marked who speaks and how. That one request
    // was the simple reading already, so the plain reading uses it whole rather than reading the
    // text again on its own.
    depth = 'annotations';
    runtime.tts.analysis.set(floorKey, { labels, voices, depth });
    onStep?.('analysis', { state: 'done', label: '简单分析', detail: `用${marksFrom}，${labels.size} 句` });
  } else if (depth === 'off' || plainKept) {
    // The plain reading: the text as written, no request. Who speaks is read off the text itself — the
    // reader's word first, then the story's own marks, then what the text says outright, then the
    // translation's mark, then what the text suggests. A floor the reader chose to hear plain when
    // asked is the same. Moods come only from the story's own marks, which cost nothing.
    labels = speakersOnly(labels);
    voices = null;
    depth = 'off';
    for (const [id, label] of tagged.labels) if (label.emotion) labels.set(id, { ...(labels.get(id) ?? {}), emotion: label.emotion });
    if (tagged.voices.size) voices = new Map(tagged.voices);
    resolved = resolveSpeakers(utterances, { cast, hints: speakerHints(reading.labels), manual, tagged: tagSpeakers, protagonists });
    onStep?.('analysis', { state: 'done', label: '不分析', detail: tagged.labels.size ? `按正文里的说话人标记读，${tagged.labels.size} 句带标记` : '直接读正文' });
  } else if (depth !== 'annotations' && utterances.length) {
    const key = floorKey;
    let known = force ? null : runtime.tts.analysis.get(key);
    // The store is looked in wherever the rest of this branch would not look: a look at the floor,
    // and a translated floor whose marks would otherwise speak for it — the reader may have asked for
    // a reading of it by hand, and that reading is the one they want to hear.
    if (!known && (passive || (depth === 'simple' && labels.size))) known = await stored(depth, { thisFloor: depth === 'simple' && labels.size > 0 });
    if (known && (known.depth === depth || (depth === 'simple' && ['deep', 'annotations'].includes(known.depth)))) {
      labels = known.labels;
      voices = known.voices;
      depth = known.depth;
      fallback = depth === 'annotations' ? 'hint' : 'model';
      onStep?.('analysis', { state: 'done', label: depth === 'deep' ? '深度分析' : '简单分析', detail: depth === 'annotations' ? '用翻译时的标注' : '已有结果' });
    } else if (passive) {
      // Only looking, not reading: the floor shows what the translation already said and asks nothing.
      depth = labels.size ? 'annotations' : 'pending';
    } else if (depth === 'simple' && (annotated || fullyTagged) && !force) {
      // The translation labelled this floor as it was written, or the story marked every line of its
      // dialogue itself. The simple reading would only ask the same question again, so the floor reads
      // at once and the model hears nothing. A floor marked only here and there is still asked, with
      // the marked speakers handed over as settled.
      depth = 'annotations';
      runtime.tts.analysis.set(key, { labels, voices, depth });
      onStep?.('analysis', { state: 'done', label: '简单分析', detail: `用${marksFrom}，${labels.size} 句` });
      const noteKey = `${key}|annotations`;
      if (!runtime.tts.anchorWarned.has(noteKey)) {
        runtime.tts.anchorWarned.add(noteKey);
        recordDiagnostic('info', 'tts.analysis', `这一楼用${marksFrom}朗读，没有请求副模型：${labels.size} 句带说话人或情绪，${reading.voices.size} 句带 Fish 的情绪词或语气。`, {
          floor: floor.floorId, depth, utterances: utterances.length, labeled: labels.size, voiced: reading.voices.size, tagged: tagged.labels.size,
        }, '', { floor: floor.messageId });
      }
    } else {
      let requested = false;
      try {
        const analyzed = await analyzeTtsFloor(floor, utterances, settings, depth, {
          force,
          speakers: speakersOf(resolved),
          // Each batch that comes back, with the ones before it, becomes segments the floor can start on.
          onPrefix: onPartial ? partial => {
            const partialLabels = new Map(reading.labels);
            for (const [id, label] of partial.labels) partialLabels.set(id, label);
            onStep?.('analysis', { state: 'active', label: depth === 'deep' ? `深度分析（${utterances.length} 句）` : `简单分析（${utterances.length} 句）`, detail: `已回 ${partial.ready}/${partial.total} 段，先读这些` });
            onPartial({
              segments: buildSegments(utterances, pinSpeakers(partialLabels, resolved, { fallback: 'model' }), { knownNames: ttsKnownNames(settings), voices: mergeVoiceMaps(reading.voices, partial.voices) }),
              readyIds: partial.readyIds,
              ready: partial.ready,
              total: partial.total,
            });
          } : null,
          onRequest: () => {
            requested = true;
            onStatus?.(depth === 'deep' ? '正在深度分析…' : '正在简单分析…');
            onStep?.('analysis', { state: 'active', label: depth === 'deep' ? `深度分析（${utterances.length} 句）` : `简单分析（${utterances.length} 句）` });
          },
        });
        if (analyzed.labels.size) {
          // Where the reading named nobody, the translation's own mark still knows who spoke.
          const adopted = adopt(analyzed);
          labels = adopted.labels;
          fallback = 'model';
          voices = adopted.voices;
          runtime.tts.analysis.set(key, { ...analyzed, ...adopted, depth });
          if (runtime.tts.analysis.size > 200) runtime.tts.analysis.delete(runtime.tts.analysis.keys().next().value);
          dropPreparedFloors(floor.messageId);
          onStep?.('analysis', { state: 'done', label: depth === 'deep' ? '深度分析' : '简单分析', detail: analyzed.cached ? '已有结果' : `${labels.size} 句` });
          // Types may have moved: a quoted title is narration, an unquoted order is dialogue.
          scheduleTtsDecorate(floor.messageId, { force: true });
        } else {
          onStep?.('analysis', { state: 'error', label: '分析', detail: '副模型没有返回可用标注' });
        }
      } catch (error) {
        if (isAbortError(error)) {
          onStatus?.('');
          throw error;
        }
        onStep?.('analysis', { state: 'error', label: '分析', detail: safeError(error) });
        toast('warning', `朗读分析失败，这一楼先按翻译时的标注读：${safeError(error)}`);
      }
      // However it went — answered, failed or never asked — the floor is no longer being analysed.
      onStatus?.('');
    }
  }
  // The reader's word, and the plain reading's own naming, are written over whatever the labels say;
  // the labels' own speakers stand where nobody else named one.
  const pinned = pinSpeakers(labels, resolved, { fallback });
  const segments = buildSegments(utterances, pinned, { knownNames: ttsKnownNames(settings), voices });
  return { utterances, labels: pinned, voices, segments, depth, passive };
}

/** The labels with only who speaks left on them: what the plain reading keeps for its voices. */
function speakersOnly(labels) {
  const result = new Map();
  for (const [id, label] of labels ?? []) {
    const kept = {};
    if (label?.type) kept.type = label.type;
    if (label?.speaker) kept.speaker = label.speaker;
    if (Object.keys(kept).length) result.set(id, kept);
  }
  return result;
}

/**
 * The console a sentence reads under: the speaker's own when they have one, else the default. Marks
 * are punctuation conventions, so a character without any takes the default's.
 */
function consoleFor(segment, settings = runtime.settings) {
  const tts = ttsSettings(settings);
  const base = normalizeConsole(tts.console);
  const speaker = segment?.type === 'dialogue' ? String(segment.speaker ?? '').trim() : '';
  if (!speaker) return base;
  const row = ttsVoicesFor(settings).find(candidate => candidate.name === speaker || (candidate.aliases ?? []).includes(speaker));
  if (!row?.console) return base;
  const own = normalizeConsole(row.console);
  return { ...own, marks: own.marks.length ? own.marks : base.marks };
}

// The parts of the consoles that change the audio itself: the marks and the speed lean, per name.
function consoleFingerprint(settings = runtime.settings) {
  const tts = ttsSettings(settings);
  const base = normalizeConsole(tts.console);
  const rows = ttsVoicesFor(settings).filter(row => row.console).map(row => {
    const own = normalizeConsole(row.console);
    return [row.name, own.marks, own.speed];
  });
  return JSON.stringify([base.marks, base.speed, rows]);
}

/**
 * One sentence made again.
 *
 * The sentence is asked for on its own, as a take of its own: the paragraph it sits in keeps its
 * recording for the other sentences, and the next play of this one finds the newer take first. An
 * earlier take of the sentence alone is dropped, so asking twice gives two different readings. A
 * reader who makes audio without playing it gets it made and told so.
 */
async function regenerateTtsSentence(messageId, utteranceId, side = null) {
  const prepared = await ttsPrepared(messageId, side);
  const item = prepared.items.find(candidate => candidate.segment.id === utteranceId);
  if (!item) throw new Error('这一句不在当前的朗读范围里。');
  await dropTtsRecordings(prepared, [item], { paragraph: false });
  const { floor, settings } = prepared;
  setTtsButtonState(messageId, utteranceId, 'busy', floor.side, item.segment.lineId);
  try {
    await ensureTtsRecording(floor, `sentence:${utteranceId}`, [item], settings, text => setTtsStatus(messageId, text, 'busy'), (id, patch) => ttsStep(floor, id, patch));
  } finally {
    setTtsButtonState(messageId, utteranceId, null, floor.side, item.segment.lineId);
  }
  if (!ttsSettings(settings).playAfterGenerate) {
    setTtsStatus(messageId, '这一句已重新生成，再点一次播放', 'idle');
    notifyTtsPanels();
    return;
  }
  await playTtsUtterance(messageId, utteranceId, side);
}

/**
 * The same re-roll for a whole paragraph: Fish reads the same words differently each time it is asked.
 *
 * The new take is made here, as the paragraph's own, before anything plays. Left to the player, a
 * floor sent whole or a sentence at a time would have found its paragraph still covered by the
 * floor's take or the sentences' and played the old reading again; as the newest take of its
 * sentences, this one is what is heard.
 */
async function regenerateTtsParagraph(messageId, lineId, side = null) {
  const prepared = await ttsPrepared(messageId, side);
  const items = prepared.items.filter(candidate => candidate.segment.lineId === lineId);
  if (!items.length) throw new Error('这一段不在当前的朗读范围里。');
  await dropTtsRecordings(prepared, items);
  const { floor, settings } = prepared;
  setTtsLineState(messageId, lineId, 'busy', floor.side);
  try {
    await ensureTtsRecording(floor, `line:${lineId}`, items, settings, text => setTtsStatus(messageId, text, 'busy'), (id, patch) => ttsStep(floor, id, patch));
  } finally {
    setTtsLineState(messageId, lineId, null, floor.side);
  }
  if (!ttsSettings(settings).playAfterGenerate) {
    setTtsStatus(messageId, '这一段已重新生成，再点一次播放', 'idle');
    notifyTtsPanels();
    return;
  }
  setTtsStatus(messageId, '', 'idle');
  await playTtsParagraph(messageId, lineId, side);
}

/**
 * The recordings of these sentences, dropped from the store, from the cache and from what is playing.
 *
 * They are matched by the unit they were made in, not by their text: two paragraphs can hold the same
 * words, and re-rolling one of them must not take the other one's audio away. The object URLs go too —
 * a new take is stored under the same content-addressed key, so a cached URL would replay the old one.
 */
async function dropTtsRecordings(prepared, items, { paragraph = true } = {}) {
  const units = new Set();
  for (const item of items) {
    if (paragraph) units.add(`line:${item.segment.lineId}`);
    units.add(`sentence:${item.segment.id}`);
  }
  const keys = new Set();
  for (const record of await ttsRecordings(prepared.floor)) {
    if (units.has(record.unit)) keys.add(record.key);
  }
  if (!keys.size) return 0;
  for (const key of keys) {
    await ttsStore().deleteAudio(key).catch(() => {});
    dropTtsObjectUrls(key);
  }
  const floorKey = ttsLabelKey(prepared.floor);
  runtime.tts.recordings.set(floorKey, (runtime.tts.recordings.get(floorKey) ?? []).filter(record => !keys.has(record.key)));
  const transport = runtime.tts.transport;
  if (transport?.messageId === prepared.floor.messageId) {
    stopTtsPlayback();
    transport.current = null;
  }
  return keys.size;
}

/** Floors prepared for a look before the analysis landed are rebuilt on the next look. */
function dropPreparedFloors(messageId) {
  for (const key of [...runtime.tts.floors.keys()]) if (key.startsWith(`${messageId}|`)) runtime.tts.floors.delete(key);
}

// The model's voices laid over the translation's. A sentence the model answered keeps the
// translation's words wherever the model said nothing about them, except that a delivery the model
// did set (volume, restraint, tension) retires a tone the translation had guessed.
function mergeVoiceMaps(base, over) {
  const merged = new Map(base instanceof Map ? base : []);
  for (const [id, voice] of over instanceof Map ? over : []) {
    const under = merged.get(id);
    if (!under) {
      merged.set(id, voice);
      continue;
    }
    const combined = { ...under, ...voice };
    if (!voice.tone && ['volume', 'restraint', 'tension'].some(key => key in voice)) delete combined.tone;
    merged.set(id, combined);
  }
  return merged;
}

function requireFishKey(tts) {
  if (!tts.fish.key) throw new Error('还没有填写 Fish API Key。在控制中心的「朗读」页填好后再试。');
}

// A bounded wait. `renew` turns it into an idle timer for a stream that keeps delivering.
async function withTtsTimeout(signal, seconds, task) {
  const controller = new AbortController();
  let timedOut = false;
  let timer = null;
  const onAbort = () => controller.abort();
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const windowMs = Math.max(10, Number(seconds) || 180) * 1000;
  const arm = () => {
    if (timer !== null) globalThis.clearTimeout(timer);
    timer = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, windowMs);
  };
  arm();
  try {
    return await task(controller.signal, () => {
      if (!timedOut) arm();
    });
  } catch (error) {
    if (timedOut) throw new Error(`Fish 超过 ${seconds} 秒没有响应。可以在「朗读」页的声音参数里调大超时。`);
    throw error;
  } finally {
    if (timer !== null) globalThis.clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * One Fish call, asked again when the failure is the kind that passes: a dropped connection, a
 * timeout, or Fish's own 5xx. A refused key, an empty wallet or a rate limit is answered once — asking
 * again would only spend the same refusal.
 */
async function fishRequest(path, fish, options = {}) {
  const attempts = Math.max(0, Number(fish.retries) || 0) + 1;
  let failure = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fishRequestOnce(path, fish, options);
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throw error;
      const status = Number(error.status) || 0;
      const worthRetrying = status === 0 || status >= 500;
      if (!worthRetrying || attempt === attempts - 1) throw error;
      failure = error;
      recordDiagnostic('info', 'tts.retry', `Fish 请求失败，第 ${attempt + 1} 次重试：${safeError(error)}`, { path, status: status || null, attempt: attempt + 1, attempts });
    }
  }
  throw failure;
}

async function fishRequestOnce(path, fish, { method = 'POST', body, signal } = {}) {
  const host = detectTtsHost();
  const viaProxy = fish.viaProxy !== false && host !== 'tauritavern';
  let response;
  try {
    response = await fetch(fishEndpoint(fish, path, { host }), {
      method,
      headers: fishHeaders(fish, viaProxy ? requestHeaders() : {}, { host }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw error;
    const failure = new Error(describeFishFailure({ network: true, viaProxy, host }));
    failure.cause = error;
    throw failure;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const failure = new Error(describeFishFailure({ status: response.status, body: text, viaProxy, host }));
    failure.status = response.status;
    failure.body = text.slice(0, 2000);
    throw failure;
  }
  return response;
}

/**
 * One paragraph's audio, asked again when the answer never came.
 *
 * The retry sits outside the timeout, not inside it: a timed-out request is aborted, and a loop
 * within that window would see an aborted signal, read it as 停止, and stop — which is exactly what
 * made 「失败后自动重试次数」 look like it did nothing. Each attempt opens a window of its own. A
 * refusal (bad key, no credit, rate limit) is answered once; asking again would buy the same answer.
 */
async function streamFishTimestamps(body, fish, signal, { onAttempt = null, onProgress = null } = {}) {
  const attempts = Math.max(0, Number(fish.retries) || 0) + 1;
  let failure = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    onAttempt?.(attempt);
    try {
      return await streamFishTimestampsOnce(body, fish, signal, onProgress);
    } catch (error) {
      // The reader stopped, or this is the last try: the failure is theirs to see.
      if (isAbortError(error) || signal?.aborted || attempt === attempts - 1) throw error;
      const status = Number(error.status) || 0;
      if (status !== 0 && status < 500) throw error;
      failure = error;
      recordDiagnostic('info', 'tts.retry', `Fish 这一段没生成，第 ${attempt + 1} 次重试（共 ${attempts - 1} 次）：${safeError(error)}`, {
        status: status || null, attempt: attempt + 1, attempts, timeoutSec: fish.timeoutSec,
      });
    }
  }
  throw failure;
}

// `onProgress` hears what has come back so far, after every read that brought something: the audio
// and timings of an answer still arriving, for a player that will not wait for the end.
async function streamFishTimestampsOnce(body, fish, signal, onProgress = null) {
  return withTtsTimeout(signal, fish.timeoutSec, async (requestSignal, renew) => {
    const response = await fishRequestOnce('/v1/tts/stream/with-timestamp', fish, { body, signal: requestSignal });
    const collector = createTimestampCollector();
    let unreadable = 0;
    let fresh = false;
    const parser = createSseParser(event => {
      if (!event.data || event.data === '[DONE]') return;
      try {
        collector.accept(JSON.parse(event.data));
        fresh = true;
      } catch {
        unreadable += 1;
      }
    });
    const reader = response.body?.getReader?.();
    const decoder = new TextDecoder();
    if (reader) {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        renew();
        parser.push(decoder.decode(value, { stream: true }));
        if (fresh && onProgress) {
          fresh = false;
          onProgress(collector.result());
        }
      }
      parser.push(decoder.decode());
    } else {
      parser.push(await response.text());
    }
    parser.end();
    const result = collector.result();
    if (!result.audio.length) {
      throw new Error(unreadable ? 'Fish 返回的时间戳流无法解析，完整记录见运行记录。' : 'Fish 没有返回任何音频。');
    }
    return { ...result, unreadable };
  });
}

/** What this floor has cost Fish so far: requests actually sent, paragraphs reused, failures. */
function ttsFishTally(floor) {
  const key = floor.floorId;
  if (!runtime.tts.fish.has(key)) runtime.tts.fish.set(key, { requests: 0, reused: 0, failed: 0 });
  if (runtime.tts.fish.size > 40) runtime.tts.fish.delete(runtime.tts.fish.keys().next().value);
  return runtime.tts.fish.get(key);
}

/** One line per floor when it stops being made, so nobody has to count requests by hand. */
function reportTtsFish(floor) {
  if (!floor) return;
  const tally = runtime.tts.fish.get(floor.floorId);
  if (!tally || !(tally.requests || tally.reused)) return;
  runtime.tts.fish.delete(floor.floorId);
  recordDiagnostic(tally.failed ? 'warn' : 'info', 'tts.recording', `第 ${floor.messageId} 楼${floor.side === 'source' ? '原文' : '译文'}这次朗读向 Fish 发了 ${tally.requests} 次请求，${tally.reused} 段直接用了已有音频${tally.failed ? `，${tally.failed} 段没生成成功` : ''}。`, {
    floor: floor.floorId, requests: tally.requests, reused: tally.reused, failed: tally.failed,
  }, '', { floor: floor.messageId });
}

// Everything that changes the sound, hashed once per distinct settings.
async function ttsFingerprint(settings = runtime.settings) {
  const tts = ttsSettings(settings);
  const fingerprint = ttsProviderFor(settings).fingerprint(tts, { consoles: consoleFingerprint(settings) });
  const json = JSON.stringify(fingerprint);
  if (runtime.tts.fingerprint?.json !== json) runtime.tts.fingerprint = { json, fingerprint, key: await fingerprintKey(fingerprint) };
  return runtime.tts.fingerprint;
}

// The reader's own versions of this floor's sentences, read once per text version.
async function ttsOverrides(floor) {
  const key = ttsLabelKey(floor);
  if (!runtime.tts.overrides.has(key)) {
    const records = await ttsStore().listOverrides(floor.floorId, floor.version).catch(() => []);
    runtime.tts.overrides.set(key, new Map(records.map(record => [record.segmentId, record])));
  }
  return runtime.tts.overrides.get(key);
}

/**
 * The sentences of one floor as request items: each with its voice and, when the reader rewrote it,
 * the override. Names without a voice of their own are noted once per floor, not thrown: a sentence
 * without any voice reads in the provider's default voice rather than not at all.
 */
async function ttsItemsFor(floor, segments, settings, { range = null } = {}) {
  const tts = ttsSettings(settings);
  const inRange = segmentsInRange(segments, range ?? tts.range);
  const plan = planVoices(inRange, ttsVoiceConfig(settings));
  const overrides = await ttsOverrides(floor);
  const dress = item => {
    const override = overrides.get(item.segment.id);
    const carried = { ...item, console: consoleFor(item.segment, settings) };
    return override ? { ...carried, override: { text: override.text, speed: override.speed, volume: override.volume, speaker: override.speaker } } : carried;
  };
  const items = plan.items.map(dress);
  const skipped = plan.skipped.map(dress);
  const warnKey = `${ttsLabelKey(floor)}|voices`;
  if ((plan.unvoiced.length || plan.defaulted.length || plan.muted.length) && !runtime.tts.anchorWarned.has(warnKey)) {
    runtime.tts.anchorWarned.add(warnKey);
    recordDiagnostic('info', 'tts.voices', [
      plan.unvoiced.length ? `${plan.unvoiced.join('、')}没有任何音色，用 Fish 的默认音色读。` : '',
      plan.defaulted.length ? `${plan.defaulted.join('、')}没有登记专属音色，用对白默认音色读。` : '',
      plan.muted.length ? `${plan.muted.join('、')}的对白按设置跳过，共 ${skipped.length} 句不朗读。` : '',
    ].filter(Boolean).join(' '), { floor: floor.floorId, unvoiced: plan.unvoiced, defaulted: plan.defaulted, muted: plan.muted, skipped: skipped.length }, '', { floor: floor.messageId });
  }
  return { items, skipped, unvoiced: plan.unvoiced, defaulted: plan.defaulted };
}

// Recordings of this floor's current text, read from the store once and kept in step with new ones.
async function ttsRecordings(floor) {
  const key = ttsLabelKey(floor);
  if (!runtime.tts.recordings.has(key)) {
    const records = await ttsStore().listFloorAudio(floor.floorId).catch(() => []);
    runtime.tts.recordings.set(key, records.filter(record => record.version === floor.version && Array.isArray(record.timeline)));
  }
  return runtime.tts.recordings.get(key);
}

function rememberRecording(floor, record) {
  const key = ttsLabelKey(floor);
  const list = runtime.tts.recordings.get(key) ?? [];
  runtime.tts.recordings.set(key, [record, ...list.filter(item => item.key !== record.key)]);
}

// Where one sentence can already be heard: the reader's own regeneration first, then any recording of
// this text in this voice with these sound settings, whatever unit it was made in.
async function findTtsEntry(floor, item, settings) {
  const { key: fingerprint } = await ttsFingerprint(settings);
  const records = await ttsRecordings(floor);
  const preferred = item.override?.recordKey ? records.find(record => record.key === item.override.recordKey) : null;
  if (preferred) {
    const index = preferred.timeline.findIndex(entry => entry.id === item.segment.id);
    if (index >= 0) return { record: preferred, index };
  }
  if (item.override?.text) {
    // A rewritten sentence must be heard as rewritten; an older take of the plain text does not count.
    const own = records.filter(record => record.unit === `sentence:${item.segment.id}` && record.fingerprint === fingerprint && record.overrideText === item.override.text);
    if (own.length) return { record: own[0], index: 0 };
    return null;
  }
  // Audio made before this sentence's reading was asked for belongs to the reading it replaced.
  return findCoveringEntry(records, { text: item.segment.text, voiceId: item.voiceId, fingerprint, identity: itemIdentity(item), since: Number(item.segment?.analyzedAt) || 0 });
}

/**
 * One unit — the floor, a paragraph or a single sentence — as a recording with every sentence's place
 * in it. One request per part, usually one for the unit. Fish's word timings are merged into sentence
 * ranges right here, and the record keeps both the audio and the ranges, so playing any sentence
 * afterwards is a seek, never another request.
 *
 * A floor sent whole is also heard while it arrives: `onLive` is handed what has come back so far
 * every time more does (see liveTtsEntry), and so is anyone who joins the job later.
 */
async function ensureTtsRecording(floor, unit, items, settings, onStatus = null, onStep = null, { onLive = null } = {}) {
  const tts = ttsSettings(settings);
  if (!items.length) throw new Error('这一段没有可朗读的句子。');
  const stepId = `record:${unit}`;
  const { fingerprint, key: fingerprintId } = await ttsFingerprint(settings);
  const key = await recordingCacheKey({ floorId: floor.floorId, version: floor.version, unit, maxChars: tts.fish.maxChars, items, fingerprint });
  const cached = await ttsStore().getAudio(key);
  // The same words under the same labels make the same key, so a reading asked for again that came
  // out word for word the same would find the take made before it. That take predates the reading
  // and is made again: a floor analysed afresh is heard afresh.
  const stale = cached && recordPredates(cached, unitAnalyzedAt(items));
  if (cached?.parts?.length && Array.isArray(cached.timeline) && !stale) {
    rememberRecording(floor, cached);
    ttsFishTally(floor).reused += 1;
    onStep?.(stepId, { state: 'done', label: ttsUnitLabel(unit), detail: '已有音频' });
    return { record: cached, cached: true };
  }
  // Replaced under the same key: the urls made from the old take must not play in place of the new one.
  if (stale) dropTtsObjectUrls(key);
  requireFishKey(tts);
  const record = await dedupeTtsJob(key, floor.messageId, async (signal, notify) => {
    const provider = ttsProviderFor(settings);
    const parts = provider.parts(items, tts);
    const label = unit.startsWith('line:') ? '这一段' : unit.startsWith('sentence:') ? '这一句' : unit.startsWith('chunk:') ? `第 ${unit.slice(6)} 批` : '整楼';
    // What Fish has sent of each part so far, where a player can reach it. Only for a floor sent whole,
    // the one wait long enough to matter, and only in mp3, where every stretch from the start plays.
    const live = unit.startsWith('floor:') && tts.fish.format === 'mp3'
      ? { key, unit, mime: provider.mime(tts.fish.format), bitrate: Number(tts.fish.mp3Bitrate) || 128, version: 0, view: null, parts: parts.map(part => emptyLiveTtsPart(part)) }
      : null;
    // Parts go to Fish several at a time when the settings allow; the recording is assembled in part
    // order afterwards, so playback never learns which came back first. The first failure stops the
    // rest, since parts of a recording that will not be kept are not worth paying for.
    const lanes = Math.max(1, Math.min(tts.fish.concurrency, parts.length));
    const group = new AbortController();
    const onAbort = () => group.abort();
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    let finished = 0;
    const report = () => {
      if (parts.length <= 1) {
        onStatus?.(`正在生成${label}音频…`);
        return;
      }
      onStatus?.(`正在生成${label}音频（${finished}/${parts.length} 段已完成${lanes > 1 ? `，${lanes} 路同时` : ''}）…`);
      onStep?.(stepId, { state: 'active', detail: `${finished}/${parts.length} 次请求已完成` });
    };
    onStep?.(stepId, { state: 'active', label: ttsUnitLabel(unit), detail: `${items.length} 句${parts.length > 1 ? `，分 ${parts.length} 次请求${lanes > 1 ? `、${lanes} 路同时` : ''}` : ''}` });
    report();
    let made;
    let failure = null;
    try {
      made = await runInLanes(parts, lanes, async (part, index) => {
        const { body, spans } = provider.payload(part, tts);
        const heard = live?.parts[index] ?? null;
        if (heard) heard.spans = spans;
        let stream;
        try {
          stream = await streamFishTimestamps(body, tts.fish, group.signal, {
            onAttempt: attempt => {
              ttsFishTally(floor).requests += 1;
              // Asked again: what the failed try sent is not this take.
              if (heard && attempt > 0) {
                Object.assign(heard, emptyLiveTtsPart(part), { spans, version: heard.version + 1 });
                live.version += 1;
                notify(live);
              }
            },
            onProgress: heard ? result => {
              feedLiveTtsPart(live, heard, result);
              notify(live);
            } : null,
          });
        } catch (error) {
          if (!isAbortError(error)) {
            failure ??= error;
            recordDiagnostic('error', 'tts.request-failed', safeError(error), {
              floor: floor.floorId, unit, part: index + 1, parts: parts.length, model: tts.fish.model, viaProxy: tts.fish.viaProxy, host: detectTtsHost(), status: error.status ?? null,
            }, { status: error.status ?? null, body: error.body ?? '' }, { fullRequest: body, floor: floor.messageId });
            onStep?.(stepId, { state: 'error', detail: safeError(error) });
            group.abort();
          }
          throw error;
        }
        if (heard) {
          feedLiveTtsPart(live, heard, stream, { done: true });
          notify(live);
        }
        const blob = new Blob(heard ? heard.chunks : stream.audio.map(base64ToBytes), { type: provider.mime(tts.fish.format) });
        const { timeline: spoken, duration } = buildGlobalTimeline(stream.alignments);
        const aligned = alignSpansToTimeline(spans, spoken, { duration });
        finished += 1;
        report();
        const weak = aligned.filter(entry => entry.coverage < 0.5);
        // Only the requests that came back misaligned are worth a line of their own: a floor of
        // thirty paragraphs wrote thirty of these, each carrying its whole request, and pushed
        // everything else — a failed translation above all — out of the log.
        if (weak.length) recordDiagnostic('warn', 'tts.recording', `${label}音频第 ${index + 1} 段有 ${weak.length} 句没能对上时间戳，点这几句时起止位置可能不准。`, {
          floor: floor.floorId,
          unit,
          part: index + 1,
          parts: parts.length,
          lanes,
          sentences: part.length,
          voices: new Set(part.map(item => item.voiceId)).size,
          prosody: body.prosody,
          model: tts.fish.model,
          format: tts.fish.format,
          bytes: blob.size,
          duration: Number(duration.toFixed(2)),
          textChunks: stream.alignments.size,
          events: stream.events,
          weak: weak.map(entry => `${entry.id}（${Math.round(entry.coverage * 100)}%）`),
        }, {
          text: body.text,
          chunks: [...stream.alignments].map(([seq, chunk]) => ({ seq, offset: chunk.offset, duration: chunk.duration, content: chunk.content })),
          sentences: aligned,
        }, { fullRequest: body, floor: floor.messageId });
        return { part, blob, duration, aligned };
      });
    } catch (error) {
      if (!isAbortError(failure ?? error)) ttsFishTally(floor).failed += 1;
      if (live) dropLiveTtsUrls(key);
      // Siblings cancelled by the first failure report as aborted; the failure itself is what is thrown.
      throw failure ?? error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
    const storedParts = [];
    const timeline = [];
    made.forEach((result, index) => {
      for (const entry of recordCovers(result.part, result.aligned)) timeline.push({ ...entry, part: index });
      storedParts.push({ blob: result.blob, mime: result.blob.type, duration: result.duration });
    });
    const stored = await ttsStore().putAudio({
      key, kind: 'recording', unit, floorId: floor.floorId, chatId: floor.chatId, version: floor.version, fingerprint: fingerprintId,
      side: floor.side, parts: storedParts, timeline,
      overrideText: unit.startsWith('sentence:') ? (items[0].override?.text ?? '') : '',
    });
    rememberRecording(floor, stored);
    if (live) dropLiveTtsUrls(key);
    onStep?.(stepId, { state: 'done', detail: `${items.length} 句 · ${storedParts.reduce((sum, part) => sum + (Number(part.duration) || 0), 0).toFixed(1)} 秒` });
    notifyTtsPanels();
    return stored;
  }, { onPrefix: onLive });
  return { record, cached: false };
}

// One part of a recording still coming in, before anything of it has.
function emptyLiveTtsPart(items) {
  return { items, spans: null, source: null, chunks: [], bytes: 0, alignments: new Map(), done: false, version: 0, blob: null, blobVersion: -1 };
}

// What Fish has sent of one part so far, taken in. Audio already decoded is not decoded again; an
// answer that is not the one this part was holding (a try asked again) replaces it whole.
function feedLiveTtsPart(live, part, result, { done = false } = {}) {
  if (result.audio !== part.source) {
    part.source = result.audio;
    part.chunks = [];
    part.bytes = 0;
  }
  while (part.chunks.length < result.audio.length) {
    const bytes = base64ToBytes(result.audio[part.chunks.length]);
    part.chunks.push(bytes);
    part.bytes += bytes.length;
  }
  part.alignments = result.alignments;
  part.done = done;
  part.version += 1;
  live.version += 1;
}

/**
 * A recording still coming in, in the shape the player knows: the sentences whole so far, each part's
 * audio so far as its blob. The audio's length is read off its size — Fish's mp3 has a constant bitrate
 * — so a sentence whose timings came before its sound is not played short.
 */
function liveTtsRecord(live) {
  if (live.view?.version === live.version) return live.view.record;
  const timeline = [];
  const parts = live.parts.map((part, index) => {
    if (!part.chunks.length || !part.spans) return null;
    const audioSeconds = part.done ? Infinity : (part.bytes * 8) / (live.bitrate * 1000);
    // A paragraph at a time: one still arriving is not started, so any wait falls between paragraphs.
    const lines = new Map(part.items.map(item => [item.segment.id, item.segment.lineId]));
    const { entries, ceiling } = settledSpans(part.spans, part.alignments, { audioSeconds, done: part.done, lineOf: id => lines.get(id) });
    for (const entry of recordCovers(part.items, entries)) timeline.push({ ...entry, part: index });
    if (part.blobVersion !== part.version) {
      part.blob = new Blob(part.chunks, { type: live.mime });
      part.blobVersion = part.version;
    }
    return { blob: part.blob, mime: live.mime, duration: ceiling };
  });
  const record = { key: `${live.key}#live${live.version}`, unit: live.unit, live: true, timeline, parts };
  live.view = { version: live.version, record };
  return record;
}

// One sentence of a recording still coming in, once it has come in whole; null until then.
function liveTtsEntry(live, item) {
  const record = liveTtsRecord(live);
  const index = record.timeline.findIndex(entry => entry.id === item.segment.id);
  if (index < 0 || !record.parts[record.timeline[index].part]) return null;
  return { record, index };
}

// The urls made for a recording while it was still coming in, let go once it is whole. The one playing
// is left to finish.
function dropLiveTtsUrls(recordKey) {
  const urls = runtime.tts.urls;
  for (const [key, url] of [...urls]) {
    if (!key.startsWith(`${recordKey}#live`) || url === runtime.tts.player?.url) continue;
    URL.revokeObjectURL(url);
    urls.delete(key);
  }
}

/**
 * The unit a sentence is made in, by the reader's choice of what one request carries.
 *
 * A paragraph by default: one request each, as many at once as Fish allows, so the first one plays
 * while the rest are still being made. The whole floor, every speaker in one request: Fish reads the
 * exchange as one take, with the turns between the voices in it, and nothing sounds until the floor is
 * made — a sentence or a paragraph asked for on its own waits for the floor too, because that is what
 * was chosen. One sentence alone: the most requests, each the shortest. `items` are the floor's, in
 * reading order; `single` is kept for the callers that name it.
 */
function ttsUnitFor(tts, items, item, { single = false } = {}) {
  if (tts?.requestUnit === 'floor') return { unit: 'floor:all', items };
  if (tts?.requestUnit === 'sentence') return { unit: `sentence:${item.segment.id}`, items: [item] };
  const lineId = item.segment.lineId;
  return { unit: `line:${lineId}`, items: items.filter(candidate => candidate.segment.lineId === lineId) };
}

// Every unit a floor is made of, in reading order, for making the whole floor ahead of time.
function ttsUnitsOf(tts, items) {
  if (!items.length) return [];
  if (tts?.requestUnit === 'floor') return [{ unit: 'floor:all', items }];
  if (tts?.requestUnit === 'sentence') return items.map(item => ({ unit: `sentence:${item.segment.id}`, items: [item] }));
  return groupSegmentsByLine(items.map(item => item.segment)).map(line => ({ unit: `line:${line.lineId}`, items: items.filter(item => item.segment.lineId === line.lineId) }));
}

/**
 * Every paragraph still ahead of the one playing, made side by side while it plays: a paragraph
 * already recorded in any unit is skipped, one being made is joined. Called on every turn of the loop
 * and cheap when nothing has changed.
 */
function scheduleTtsAhead(transport) {
  if (transport.single || transport.paragraph) return;
  const key = `${transport.items.length}|${transport.index}`;
  if (transport.aheadKey === key) return;
  transport.aheadKey = key;
  const { floor, settings } = transport;
  const tts = ttsSettings(settings);
  // A floor sent whole is made by the first turn in one piece; there is nothing ahead to make.
  if (tts.requestUnit === 'floor') return;
  const lanes = Math.max(1, Number(tts.fish.concurrency) || 1);
  // The unit being played is made whole by the turn itself; only the ones after it are made here, so
  // its tail is never asked for a second time as a unit of its own.
  const current = transport.items[transport.index];
  const rest = transport.items.slice(transport.index + 1);
  const units = ttsUnitsOf(tts, tts.requestUnit === 'sentence' ? rest : rest.filter(item => item.segment.lineId !== current?.segment.lineId));
  if (!units.length) return;
  void runInLanes(units, lanes, async target => {
    if (!isTtsTransport(transport)) return;
    const covered = await Promise.all(target.items.map(item => findTtsEntry(floor, item, settings)));
    if (covered.every(Boolean)) return;
    await ensureTtsRecording(floor, target.unit, target.items, settings, null, (id, patch) => ttsStep(floor, id, patch)).catch(() => {});
  }).catch(() => {});
}

// What a unit is called on the floor bar and in the progress list.
function ttsUnitLabel(unit) {
  if (unit.startsWith('chunk:')) return `生成第 ${unit.slice(6)} 批音频`;
  if (unit.startsWith('line:')) return `生成第 ${unit.slice(5)} 段`;
  if (unit.startsWith('sentence:')) return `生成第 ${unit.slice(9)} 句`;
  return '生成整楼音频';
}

// ---------------------------------------------------------------------------------------------
// Progress: the steps of the last run on a floor — the reading, then every unit of audio — kept after
// the run so the panel can still show what happened, and replaced by the next run on that floor.
// ---------------------------------------------------------------------------------------------

function ttsProgressKey(messageId, side) {
  return `${messageId}|${side}`;
}

function ttsProgressFor(messageId, side) {
  return runtime.tts.progress.get(ttsProgressKey(messageId, side)) ?? null;
}

function beginTtsProgress(floor, tts = ttsSettings()) {
  const key = ttsProgressKey(floor.messageId, floor.side);
  const record = { messageId: floor.messageId, side: floor.side, version: floor.version, mode: tts.mode, startedAt: Date.now(), steps: [] };
  runtime.tts.progress.set(key, record);
  if (runtime.tts.progress.size > 40) runtime.tts.progress.delete(runtime.tts.progress.keys().next().value);
  notifyTtsPanels();
  return record;
}

function ttsStep(floor, id, patch = {}) {
  const key = ttsProgressKey(floor.messageId, floor.side);
  let record = runtime.tts.progress.get(key);
  if (!record || record.version !== floor.version) record = beginTtsProgress(floor);
  let step = record.steps.find(item => item.id === id);
  if (!step) {
    step = { id, label: id, state: 'pending' };
    record.steps.push(step);
  }
  Object.assign(step, patch);
  if (patch.state === 'active' && !step.since) step.since = Date.now();
  if (patch.state === 'done' && step.since && !step.finishedAt) {
    const bucket = id === 'analysis' ? runtime.timing.analysis : runtime.timing.parts;
    bucket.push((Date.now() - step.since) / 1000);
    if (bucket.length > 20) bucket.shift();
  }
  if (patch.state === 'done' || patch.state === 'error') step.finishedAt = Date.now();
  notifyTtsPanels();
}

/**
 * The recording entry for one item, made if need be. `single` says the item was asked for by itself.
 *
 * `live`: a floor sent whole need not be waited for. The sentence is handed back as soon as it has come
 * in whole, from the audio so far, while the rest keeps arriving (`live: true` and the `job` on the
 * entry). `liveGrace` is how long to give a floor that is nearly done to finish instead, so a short one
 * is still heard as the one take it is.
 */
async function resolveTtsEntry(floor, items, item, settings, onStatus = null, onStep = null, { single = false, unit = null, unitItems = null, live = false, liveGrace = 0 } = {}) {
  const found = await findTtsEntry(floor, item, settings);
  if (found) return { ...found, cached: true };
  const tts = ttsSettings(settings);
  const target = item.override?.text
    ? { unit: `sentence:${item.segment.id}`, items: [item] }
    : unit ? { unit, items: unitItems ?? items } : ttsUnitFor(tts, items, item, { single });
  let making;
  if (live && target.unit.startsWith('floor:') && tts.fish.format === 'mp3') {
    let latest = null;
    let wake = null;
    let finished = false;
    making = ensureTtsRecording(floor, target.unit, target.items, settings, onStatus, onStep, { onLive: state => { latest = state; wake?.(); } });
    const settle = () => { finished = true; wake?.(); };
    making.then(settle, settle);
    while (!finished) {
      const entry = latest ? liveTtsEntry(latest, item) : null;
      if (entry) {
        if (liveGrace > 0) await Promise.race([making.catch(() => {}), new Promise(resolve => { globalThis.setTimeout(resolve, liveGrace); })]);
        if (!finished) return { ...entry, cached: false, live: true, job: making };
        break;
      }
      await new Promise(resolve => { wake = resolve; });
      wake = null;
    }
  } else {
    making = ensureTtsRecording(floor, target.unit, target.items, settings, onStatus, onStep);
  }
  const { record } = await making;
  const index = record.timeline.findIndex(entry => entry.id === item.segment.id);
  if (index < 0) throw new Error('这一句不在生成的音频里。');
  return { record, index, cached: false };
}

function ttsPlayer() {
  if (runtime.tts.player) return runtime.tts.player;
  const audio = new Audio();
  audio.preload = 'auto';
  runtime.tts.player = { audio, token: 0, url: '', cancel: null };
  return runtime.tts.player;
}

// Object URLs for recorded parts. A handful stay alive so replaying a sentence does not re-read the
// blob; the one currently loaded is never revoked from under the player.
/** The urls made from one recording, let go, so the take that replaces it is the one heard. */
function dropTtsObjectUrls(recordKey) {
  const urls = runtime.tts.urls;
  for (const [key, url] of [...urls]) {
    if (key !== recordKey && !key.startsWith(`${recordKey}#`)) continue;
    if (url !== runtime.tts.player?.url) URL.revokeObjectURL(url);
    urls.delete(key);
  }
}

function ttsObjectUrl(key, blob) {
  const urls = runtime.tts.urls;
  if (urls.has(key)) return urls.get(key);
  const url = URL.createObjectURL(blob);
  urls.set(key, url);
  for (const [oldKey, oldUrl] of urls) {
    if (urls.size <= 16) break;
    if (oldKey === key || oldUrl === runtime.tts.player?.url) continue;
    URL.revokeObjectURL(oldUrl);
    urls.delete(oldKey);
  }
  return url;
}

/**
 * Plays `url` from `start`, stopping at `end` when given. Resolves with 'ended', 'stopped' or 'error'.
 *
 * The end is watched on a short interval rather than `timeupdate`, which only fires a few times a second
 * and would let the next sentence's first word slip out. A paused element simply stops advancing; the
 * watch keeps running so resuming needs nothing more than play().
 */
function playTtsAudio(url, { start = 0, end = null, onTime = null } = {}) {
  const player = ttsPlayer();
  player.cancel?.('stopped');
  const token = ++player.token;
  const { audio } = player;
  return new Promise(resolve => {
    let settled = false;
    let interval = null;
    const finish = reason => {
      if (settled) return;
      settled = true;
      if (interval !== null) globalThis.clearInterval(interval);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('loadedmetadata', begin);
      if (player.token === token) audio.pause();
      if (player.cancel === finish) player.cancel = null;
      resolve(reason);
    };
    const onEnded = () => finish('ended');
    const onError = () => finish('error');
    const watch = () => {
      if (player.token !== token) {
        finish('stopped');
        return;
      }
      onTime?.(audio.currentTime, audio.duration);
      if (end !== null && audio.currentTime >= end) finish('ended');
    };
    const begin = () => {
      if (player.token !== token) {
        finish('stopped');
        return;
      }
      try {
        audio.currentTime = Math.max(0, start);
      } catch {
        // Not seekable yet; playing from the top is still better than not playing.
      }
      Promise.resolve(audio.play())
        .then(() => {
          if (!settled) interval = globalThis.setInterval(watch, 30);
        })
        // A page nobody has touched may not start sound on its own; that is a wait, not a failure.
        .catch(error => finish(error?.name === 'NotAllowedError' ? 'blocked' : 'error'));
    };
    player.cancel = finish;
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    if (player.url !== url || audio.readyState < 1) {
      player.url = url;
      audio.addEventListener('loadedmetadata', begin, { once: true });
      audio.src = url;
      audio.load();
    } else {
      begin();
    }
  });
}

function highlightTtsUtterance(messageId, utteranceId, side = null) {
  if (typeof document === 'undefined') return;
  for (const button of document.querySelectorAll('#chat .jy-tts-play[data-state="playing"]')) delete button.dataset.state;
  const registry = globalThis.CSS?.highlights;
  if (utteranceId === null || utteranceId === undefined) {
    runtime.tts.highlighted = null;
    registry?.delete('jy-tts-current');
    return;
  }
  const which = side ?? primaryTtsSide();
  runtime.tts.highlighted = { messageId, utteranceId, side: which };
  const button = ttsButton(messageId, utteranceId, which);
  if (button && !button.dataset.state) button.dataset.state = 'playing';
  // The paragraph's button stays lit for every sentence of its own paragraph.
  const lineButton = ttsLineButton(messageId, ttsLineOfUtterance(messageId, utteranceId), which);
  if (lineButton && !lineButton.dataset.state) lineButton.dataset.state = 'playing';
  const range = runtime.tts.ranges.get(messageId)?.get(`${which}:${utteranceId}`);
  // The Custom Highlight API paints a range without wrapping it, so the floor's DOM stays untouched.
  if (registry && typeof globalThis.Highlight === 'function' && range) registry.set('jy-tts-current', new globalThis.Highlight(range));
  else registry?.delete('jy-tts-current');
}

function ttsButton(messageId, utteranceId, side = null) {
  if (typeof document === 'undefined') return null;
  const which = side ?? primaryTtsSide();
  return document.querySelector(`#chat .mes[mesid="${messageId}"] .jy-tts-play[data-jy-tts-utt="${utteranceId}"][data-jy-tts-side="${which}"]`);
}

function ttsLineButton(messageId, lineId, side = null) {
  if (typeof document === 'undefined' || lineId === null || lineId === undefined) return null;
  const which = side ?? primaryTtsSide();
  return document.querySelector(`#chat .mes[mesid="${messageId}"] .jy-tts-line-play[data-jy-tts-line="${lineId}"][data-jy-tts-side="${which}"]`);
}

/** Which paragraph a sentence of the floor being read belongs to; null when that floor is not the one open. */
function ttsLineOfUtterance(messageId, utteranceId) {
  const transport = runtime.tts.transport;
  if (transport?.messageId !== messageId) return null;
  return transport.items.find(item => item.segment.id === utteranceId)?.segment.lineId ?? null;
}

function setTtsButtonState(messageId, utteranceId, state, side = null, lineId = undefined) {
  // Busy and playing belong to whichever of the two buttons the floor is wearing; both are marked so
  // neither mode has to know about the other. The paragraph is passed in wherever the caller knows it:
  // by the time a request settles the transport may be gone, and a mark nobody can find never clears.
  const line = lineId === undefined ? ttsLineOfUtterance(messageId, utteranceId) : lineId;
  const buttons = [ttsButton(messageId, utteranceId, side), ttsLineButton(messageId, line, side)];
  for (const button of buttons) {
    if (!button) continue;
    if (state) button.dataset.state = state;
    else delete button.dataset.state;
  }
}

function setTtsLineState(messageId, lineId, state, side = null) {
  const button = ttsLineButton(messageId, lineId, side);
  if (!button) return;
  if (state) button.dataset.state = state;
  else delete button.dataset.state;
}

function setTtsStatus(messageId, text = '', state = 'idle') {
  if (text || state !== 'idle') runtime.tts.status.set(messageId, { text, state });
  else runtime.tts.status.delete(messageId);
  const bar = typeof document === 'undefined' ? null : document.querySelector(`#chat .mes[mesid="${messageId}"] .jy-tts-bar`);
  if (bar) {
    bar.dataset.state = state;
    bar.title = text;
    const plays = [...bar.querySelectorAll('[data-jy-tts-action="play-floor"]')];
    const reading = runtime.tts.transport?.messageId === Number(messageId) ? runtime.tts.transport.side : null;
    for (const button of plays) {
      const mine = plays.length === 1 || button.dataset.jyTtsSide === reading;
      const html = ttsBarLabel(mine ? state : 'idle', plays.length > 1 ? button.dataset.jyTtsSide : null);
      if (button.innerHTML !== html) button.innerHTML = html;
      button.dataset.state = mine ? state : 'idle';
    }
  }
  notifyTtsPanels();
}

// ---------------------------------------------------------------------------------------------
// The transport: one thing being read, with a place in it. Pause, resume, the next or previous
// paragraph and saving all act on it; the floor bar and the floating window both draw from it.
// ---------------------------------------------------------------------------------------------

function notifyTtsPanels() {
  for (const subscriber of runtime.tts.subscribers) {
    try {
      subscriber(runtime.tts.transport);
    } catch (error) {
      console.warn(`[${APP_NAME}] 朗读面板刷新失败。`, error);
    }
  }
}

// Where the reading is inside a sentence. Kept apart from notifyTtsPanels, which redraws what the
// reading is — another sentence, another state — so playing does not rebuild the window on every tick.
function notifyTtsProgress() {
  if (typeof document !== 'undefined' && document.hidden) return;
  for (const subscriber of runtime.tts.progressSubscribers) {
    try {
      subscriber(runtime.tts.transport);
    } catch (error) {
      console.warn(`[${APP_NAME}] 朗读进度刷新失败。`, error);
    }
  }
}

function subscribeTtsProgress(subscriber) {
  runtime.tts.progressSubscribers.add(subscriber);
  return () => runtime.tts.progressSubscribers.delete(subscriber);
}

function subscribeTts(subscriber) {
  runtime.tts.subscribers.add(subscriber);
  subscriber(runtime.tts.transport);
  return () => runtime.tts.subscribers.delete(subscriber);
}

function ttsTransportDescription(transport = runtime.tts.transport) {
  if (!transport) return null;
  const item = transport.items[transport.index] ?? null;
  const lines = groupSegmentsByLine(transport.items.map(entry => entry.segment));
  const lineIndex = item ? lines.findIndex(line => line.lineId === item.segment.lineId) : -1;
  return {
    messageId: transport.messageId,
    state: transport.state,
    mode: transport.mode,
    single: transport.single,
    index: transport.index,
    count: transport.items.length,
    lineIndex,
    lineCount: lines.length,
    segment: item?.segment ?? null,
    time: transport.progress.time,
    duration: transport.progress.duration,
    message: transport.message,
    // The floor is collected after the transport exists; the first notice arrives before it.
    floorId: transport.floor?.floorId ?? null,
  };
}

function setTransport(transport, patch) {
  if (runtime.tts.transport !== transport) return;
  Object.assign(transport, patch);
  const label = transport.state === 'loading' ? transport.message
    : transport.state === 'playing' ? `正在朗读 · 第 ${transport.index + 1}/${transport.items.length} 句`
      : transport.state === 'paused' ? `已暂停 · 第 ${transport.index + 1}/${transport.items.length} 句`
        : transport.state === 'error' ? transport.message
          : '';
  const barState = transport.state === 'loading' ? 'busy' : transport.state === 'idle' ? 'idle' : transport.state;
  setTtsStatus(transport.messageId, label, barState);
}

/**
 * The transport for one floor. Every sentence in range is an item; the current one is played from the
 * recording that holds it, and the recordings that hold the ones after it are made while it plays.
 */
/**
 * Whether a play on this floor would be the first simple analysis of it: the simple mode, no analysis
 * known or stored, no skeleton from the translation, and the floor not already chosen to be heard plain.
 */
/**
 * Whether the plain reading should ask what to do with this floor: nobody translated it (a translated
 * floor reads from its marks), nobody analysed it, and the reader has not already chosen to hear it
 * plain. An analysis stored from before is picked up silently on the way. The analysed readings
 * never ask; such a floor is analysed as a matter of course.
 */
async function firstPlainAnalysis(floor, settings = runtime.settings) {
  const tts = ttsSettings(settings);
  if (tts.mode !== 'off' || tts.autoGenerate) return false;
  const key = ttsLabelKey(floor);
  if (runtime.tts.plainFloors.has(key) || runtime.tts.analysis.has(key)) return false;
  const utterances = ttsUtterances(floor, settings);
  if (!utterances.length || annotationReading(utterances, floor.annotations).labels.size) return false;
  const stored = await ttsStore().getAnalysis(await analysisCacheKey({ utterances, source: 'model', depth: 'simple', side: floor.side })).catch(() => null);
  if (Array.isArray(stored?.labels) && stored.labels.length) {
    runtime.tts.analysis.set(key, { labels: new Map(stored.labels), voices: new Map(stored.voices ?? []), depth: 'simple' });
    return false;
  }
  return true;
}

/**
 * The question a play asks on such a floor: analyse it once first, or read the words as written.
 * The answer holds for the floor; ticking the box makes it the setting.
 */
async function askTtsAnalysis(floor, settings = runtime.settings) {
  const tts = ttsSettings(settings);
  if (!(await firstPlainAnalysis(floor, settings))) return 'go';
  let choice = tts.askAnalysis;
  // Nowhere to ask (a headless run): the floor is read as the text says.
  if (choice === 'ask' && typeof document === 'undefined') choice = 'plain';
  if (choice === 'ask') {
    const answer = await askTtsChoice(floor);
    if (answer.choice === 'cancel') return 'cancel';
    choice = answer.choice;
    if (answer.remember) saveSettings({ ...runtime.settings, tts: { ...tts, askAnalysis: choice } });
  }
  if (choice === 'plain') runtime.tts.plainFloors.add(ttsLabelKey(floor));
  // Analysed once, for this floor alone; the mode stays plain.
  else if (choice === 'analyze') await reanalyzeTtsFloor(floor.messageId, floor.side);
  return 'go';
}

/**
 * Puts a dialog where the reader can actually see it.
 *
 * `showModal` hands the card to the browser's top layer: centred against the viewport, above every
 * z-index, and out of reach of whatever the host page has done to its own containing blocks — which
 * on a phone had been pushing the card half off the top of the screen. Where that is missing, the
 * old fixed backdrop still does the job.
 */
function ttsDialogShell(shadow, card, onDismiss) {
  const modal = typeof HTMLDialogElement === 'function' && typeof HTMLDialogElement.prototype.showModal === 'function';
  const shell = document.createElement(modal ? 'dialog' : 'div');
  shell.className = modal ? 'jy-ask-shell' : 'jy-ask-backdrop';
  shell.appendChild(card);
  shadow.appendChild(shell);
  if (modal) {
    shell.addEventListener('cancel', event => {
      event.preventDefault();
      onDismiss();
    });
    try {
      shell.showModal();
    } catch {
      // Already open, or a browser that says it can and cannot: the card is visible either way.
    }
  }
  // A tap on the dark around the card closes it, in both shapes.
  shell.addEventListener('click', event => {
    if (event.target === shell) onDismiss();
  });
  return { shell, modal };
}

async function askTtsChoice(floor) {
  const css = await loadPanelCss();
  return new Promise(resolve => {
    document.getElementById(`${MODULE_ID}-ask`)?.remove();
    const host = document.createElement('div');
    host.id = `${MODULE_ID}-ask`;
    host.style.cssText = `${SHADOW_HOST_BOX}z-index:2147483000;`;
    keepTypingInside(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    const card = document.createElement('div');
    card.innerHTML = `<div class="jy-ask" role="dialog" aria-modal="true" aria-label="要不要先分析">
  <h3>第 ${floor.messageId} 楼没有翻译标注，也没分析过</h3>
  <p>让副模型看一遍这一楼（谁在说、什么情绪）再读，只做这一楼，模式不变，之后这一楼都用它；或者直接读，谁在说由程序按上下文认，只加你配的标点标签。</p>
  <label><input type="checkbox" data-jy-ask-remember>以后都这样，不再问（朗读页里能改回来）</label>
  <div class="jy-ask-actions"><button type="button" class="is-primary" data-jy-ask="analyze">分析一次再读</button><button type="button" data-jy-ask="plain">直接读</button><button type="button" data-jy-ask="cancel">取消</button></div>
</div>`;
    shadow.append(style);
    let done = false;
    const finish = choice => {
      if (done) return;
      done = true;
      const remember = shadow.querySelector('[data-jy-ask-remember]')?.checked === true;
      host.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve({ choice, remember: choice !== 'cancel' && remember });
    };
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); finish('cancel'); }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(host);
    const { shell } = ttsDialogShell(shadow, card, () => finish('cancel'));
    shell.addEventListener('click', event => {
      const button = event.target.closest('[data-jy-ask]');
      if (button) finish(button.dataset.jyAsk);
    });
    shadow.querySelector('[data-jy-ask="analyze"]')?.focus();
  });
}

/**
 * A small dialog in the page's own styling, resolved by whichever control was pressed.
 *
 * The ✕, the backdrop and Escape all answer 'cancel', because a dialog about writing a file has to
 * be as easy to leave as to use. `body.picks`, when given, is a list of ticks shown above the buttons
 * — `{ value, label, note, checked }` — and the answer is then `{ choice, picked }`, the values still
 * ticked when a button was pressed.
 */
async function ttsAskBox(body, { label = '选择' } = {}) {
  const css = await loadPanelCss();
  return new Promise(resolve => {
    document.getElementById(`${MODULE_ID}-save`)?.remove();
    const host = document.createElement('div');
    host.id = `${MODULE_ID}-save`;
    host.style.cssText = `${SHADOW_HOST_BOX}z-index:2147483000;`;
    keepTypingInside(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    const box = document.createElement('div');
    box.className = 'jy-ask';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', label);
    const head = document.createElement('div');
    head.className = 'jy-ask-head';
    const title = document.createElement('h3');
    title.textContent = body.title;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'jy-mini-inspect-close';
    close.dataset.jySave = 'cancel';
    close.title = '关闭';
    close.setAttribute('aria-label', '关闭');
    close.textContent = '×';
    head.append(title, close);
    const text = document.createElement('p');
    text.textContent = body.text;
    const actions = document.createElement('div');
    actions.className = 'jy-ask-actions';
    for (const action of body.actions) {
      const control = document.createElement(action.href ? 'a' : 'button');
      if (action.href) {
        // A real link: the browser acts on the reader's own tap, which is the only kind of tap it
        // will write a file for. The dialog stays open, because removing the link mid-click can
        // cancel the download on its way out.
        control.href = action.href;
        control.setAttribute('download', action.download ?? '');
        control.rel = 'noopener';
      } else {
        control.type = 'button';
        control.disabled = action.disabled === true;
      }
      if (action.primary) control.className = 'is-primary';
      if (action.run) control.addEventListener('click', event => { event.preventDefault(); action.run(); });
      else if (!action.href) control.dataset.jySave = action.value;
      control.textContent = action.label;
      actions.appendChild(control);
    }
    const parts = [head, text];
    if (Array.isArray(body.picks)) {
      const list = document.createElement('div');
      list.className = 'jy-ask-picks';
      for (const pick of body.picks) {
        const row = document.createElement('label');
        const tick = document.createElement('input');
        tick.type = 'checkbox';
        tick.value = String(pick.value);
        tick.checked = pick.checked !== false;
        tick.dataset.jyPick = '';
        const words = document.createElement('span');
        words.textContent = pick.label;
        if (pick.note) {
          const note = document.createElement('small');
          note.textContent = pick.note;
          words.appendChild(note);
        }
        row.append(tick, words);
        list.appendChild(row);
      }
      parts.push(list);
    }
    box.append(...parts, actions);
    shadow.append(style);
    let done = false;
    const finish = choice => {
      if (done) return;
      done = true;
      const picked = [...shadow.querySelectorAll('[data-jy-pick]')].filter(tick => tick.checked).map(tick => tick.value);
      host.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(Array.isArray(body.picks) ? { choice, picked } : choice);
    };
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); finish('cancel'); }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(host);
    const { shell } = ttsDialogShell(shadow, box, () => finish('cancel'));
    shell.addEventListener('click', event => {
      const button = event.target.closest('[data-jy-save]');
      if (button && !button.disabled) finish(button.dataset.jySave);
    });
    shadow.querySelector('.jy-ask-actions button:not([disabled])')?.focus();
  });
}

/**
 * The finished file, handed over on a tap of the reader's own.
 *
 * Everything before this point — the choosing, the asking again, the requests to Fish for whatever
 * was missing — takes long enough that a browser no longer counts the original tap as a gesture, and
 * a download started from code is dropped on the floor. The link below is tapped by the reader, so
 * the browser treats it as theirs. 分享 appears where the phone supports it: a WebView that will not
 * write a blob to disk will still pass it to another app.
 */
async function ttsOfferFile(blob, name, { note = '' } = {}) {
  if (!blob?.size) throw new Error('这段音频是空的，没有东西可以保存。');
  const url = URL.createObjectURL(blob);
  const file = typeof File === 'function' ? new File([blob], name, { type: blob.type || 'audio/mpeg' }) : null;
  const shareable = Boolean(file && navigator.canShare?.({ files: [file] }));
  try {
    await ttsAskBox({
      title: '音频已经做好了',
      text: `${name}（${formatBytes(blob.size)}）${note ? `。${note}` : ''}。点「保存文件」由浏览器下载；有的手机浏览器要长按它再选「下载链接」。`,
      actions: [
        { value: 'save', label: '保存文件', primary: true, href: url, download: name },
        ...(shareable ? [{ value: 'share', label: '分享', run: () => { void navigator.share({ files: [file], title: name }).catch(() => {}); } }] : []),
        { value: 'cancel', label: '关闭' },
      ],
    }, { label: '保存音频' });
  } finally {
    // Let go long after the browser has had its chance; a revoked url is a dead link.
    const timer = globalThis.setTimeout(() => {
      runtime.timers.delete(timer);
      URL.revokeObjectURL(url);
    }, 600000);
    timer?.unref?.();
    runtime.timers.add(timer);
  }
  return { name, bytes: blob.size };
}

/** What to save, and then the same question again, because a file is not a thing to write by accident. */
async function askTtsSave({ messageId, lineIndex = null, lineText = '' }) {
  const where = lineIndex === null ? '' : `第 ${lineIndex + 1} 段`;
  const choice = await ttsAskBox({
    title: `缓存第 ${messageId} 楼的音频`,
    text: where ? `选中的是${where}：${miniShort(lineText, 26)}` : '悬浮窗里还没有选中段落，只能缓存全篇。',
    actions: [
      { value: 'current', label: '缓存当前对白', primary: true, disabled: lineIndex === null },
      { value: 'all', label: '缓存全篇' },
    ],
  }, { label: '缓存音频' });
  if (choice !== 'current' && choice !== 'all') return 'cancel';
  const what = choice === 'current' ? `${where}「${miniShort(lineText, 18)}」` : `第 ${messageId} 楼全篇`;
  const confirmed = await ttsAskBox({
    title: '确认缓存',
    text: `是否缓存${what}？还没生成的句子会先向 Fish 要一次，然后交给浏览器下载。`,
    actions: [{ value: 'yes', label: `确认缓存${choice === 'current' ? '当前对白' : '全篇'}`, primary: true }, { value: 'cancel', label: '再想想' }],
  }, { label: '确认缓存' });
  return confirmed === 'yes' ? choice : 'cancel';
}

async function createTtsTransport(messageId, { single = false, paragraph = false, fromUtterance = null, side = null } = {}) {
  const settings = runtime.settings;
  const tts = ttsSettings(settings);
  requireClosedFloor(messageId);
  // One thing sounds at a time: a reading of text still being written gives way to this one.
  if (runtime.tts.stream && !runtime.tts.stream.done) runtime.tts.stream.cancel();
  // A floor the simple reading has not seen asks first; a cancelled question is no reading at all.
  const asked = await collectTtsFloor(messageId, settings, side ?? primaryTtsSide(settings));
  if (asked && (await askTtsAnalysis(asked, settings)) === 'cancel') return null;
  const previous = runtime.tts.transport;
  if (previous) stopTtsTransport(previous, previous.messageId !== messageId);
  const transport = {
    id: Symbol('tts-transport'),
    messageId,
    side: side ?? primaryTtsSide(settings),
    settings,
    mode: tts.mode,
    single,
    // Only this paragraph, then stop: how a paragraph button reads.
    paragraph,
    // Off: the click makes the audio and stops; the next click on a made sentence plays it.
    generateOnly: !tts.playAfterGenerate,
    state: 'loading',
    message: '准备朗读…',
    floor: null,
    items: [],
    index: 0,
    progress: { time: 0, duration: 0 },
    current: null,
    generation: 0,
    // A long floor arrives in batches: the sentences so far, the batch each belongs to, and whether
    // the rest is still on its way.
    batches: [],
    prepared: false,
    preparing: null,
    wake: null,
  };
  runtime.tts.transport = transport;
  setTransport(transport, {});
  const floor = await collectTtsFloor(messageId, settings, transport.side);
  if (!floor) throw new Error(transport.side === 'source' ? '这一楼没有可朗读的原文。' : '这一楼没有可朗读的译文。');
  transport.floor = floor;
  beginTtsProgress(floor, tts);
  // Whole-floor reading: the first batch of a long reading is enough to start on; the rest keeps
  // arriving while it plays, each batch made and heard as a recording of its own. Not when the floor
  // goes to Fish in one request: that request needs every line of the floor, so it waits for them all.
  const progressive = !single && fromUtterance === null && tts.requestUnit !== 'floor';
  let firstBatch = null;
  const firstReady = new Promise(resolve => { firstBatch = resolve; });
  let chain = Promise.resolve();
  const onPartial = partial => {
    chain = chain.then(async () => {
      if (runtime.tts.transport !== transport) return;
      const { items: everything } = await ttsItemsFor(floor, partial.segments, settings);
      const ready = everything.filter(item => partial.readyIds.has(item.segment.id));
      const known = new Set(transport.items.map(item => item.segment.id));
      const fresh = ready.filter(item => !known.has(item.segment.id));
      if (!fresh.length) return;
      transport.items = ready;
      transport.batches.push({ unit: `chunk:${partial.ready}`, ids: new Set(fresh.map(item => item.segment.id)) });
      setTransport(transport, { message: `分析已回 ${partial.ready}/${partial.total} 段，先读这些…` });
      transport.wake?.();
      firstBatch();
    }).catch(() => {});
  };
  const preparing = prepareTtsSegments(floor, settings, {
    onStatus: text => setTransport(transport, { message: text }),
    onStep: (id, patch) => ttsStep(floor, id, patch),
    onPartial: progressive ? onPartial : null,
  }).then(async result => {
    await chain;
    return result;
  });
  const settled = await Promise.race([firstReady.then(() => null), preparing]);
  if (runtime.tts.transport !== transport) return null;
  if (settled === null) {
    // Started on the first batch; the remaining ones join the list as they arrive.
    transport.preparing = preparing.then(async result => {
      if (runtime.tts.transport !== transport) return result;
      const { items: everything } = await ttsItemsFor(floor, result.segments, settings);
      const covered = new Set(transport.batches.flatMap(batch => [...batch.ids]));
      const rest = everything.filter(item => !covered.has(item.segment.id));
      transport.items = everything;
      if (rest.length) transport.batches.push({ unit: `chunk:${transport.batches.length + 1}`, ids: new Set(rest.map(item => item.segment.id)) });
      runtime.tts.floors.set(ttsPreparedKey(messageId, floor.side), { floor, segments: result.segments, items: everything, settings });
      await announceTtsUnits(floor, everything, settings, tts);
      transport.prepared = true;
      transport.wake?.();
      return result;
    }).catch(error => {
      transport.prepared = true;
      transport.wake?.();
      throw error;
    });
    transport.preparing.catch(() => {});
    if (!transport.items.length) throw new Error('这一楼没有可朗读的句子。');
    return transport;
  }
  const { segments } = settled;
  transport.prepared = true;
  let { items } = await ttsItemsFor(floor, segments, settings);
  if (fromUtterance !== null && !items.some(item => item.segment.id === fromUtterance)) {
    // The sentence clicked sits outside the reading range (the reading may have re-typed it); it is
    // still the one asked for.
    const everything = await ttsItemsFor(floor, segments, settings, { range: 'all' });
    if (!everything.items.some(item => item.segment.id === fromUtterance)) throw new Error('这一句已经变了，等楼层重新渲染后再点。');
    items = everything.items;
  }
  if (!items.length) {
    throw new Error(tts.range === 'dialogue' ? '这一楼没有对白可读。' : tts.range === 'narration' ? '这一楼没有旁白可读。' : '这一楼没有可朗读的句子。');
  }
  transport.items = items;
  runtime.tts.floors.set(ttsPreparedKey(messageId, floor.side), { floor, segments, items, settings });
  if (fromUtterance !== null) transport.index = items.findIndex(item => item.segment.id === fromUtterance);
  // Reading the whole floor: say up front which paragraphs are already made, so what follows reads
  // as 「这几段要做」 rather than 「整楼重做」.
  if (!single && !paragraph && fromUtterance === null) await announceTtsUnits(floor, items, settings, tts);
  return transport;
}

/**
 * A transport built on settings that have since changed is brought up to date before it sounds.
 *
 * Its items are made again from the current voice table and the analysis already in hand — a look at
 * the floor, never a reading, so nothing is asked of the model — and the sentence it was on keeps its
 * place by id. A transport still receiving its batches is left alone; the loop catches up with it
 * once the floor is whole.
 */
async function syncTtsTransport(transport) {
  if (!transport || transport.settings === runtime.settings || !transport.prepared || !transport.floor) return transport;
  const prepared = await ttsPrepared(transport.messageId, transport.side);
  if (runtime.tts.transport !== transport || transport.settings === runtime.settings) return transport;
  const currentId = transport.items[transport.index]?.segment.id ?? null;
  transport.settings = runtime.settings;
  transport.floor = prepared.floor;
  transport.items = prepared.items;
  transport.mode = ttsSettings(runtime.settings).mode;
  transport.aheadKey = '';
  transport.current = null;
  const at = currentId === null ? -1 : prepared.items.findIndex(item => item.segment.id === currentId);
  transport.index = at >= 0 ? at : Math.min(transport.index, Math.max(0, prepared.items.length - 1));
  return transport;
}

function ttsPreparedKey(messageId, side) {
  return `${messageId}|${side}`;
}

function isTtsTransport(transport) {
  return runtime.tts.transport === transport;
}

/**
 * Plays from the transport's current item onward, one part of a recording at a time.
 *
 * Within a part the audio runs on continuously and the current sentence is tracked from the clock;
 * a single-sentence read stops at that sentence's window. Each step first makes sure the sentence
 * exists in some recording, so a stream reads its next paragraph while this one is still playing.
 */
async function runTtsTransport(transport) {
  transport.generation += 1;
  const generation = transport.generation;
  const live = () => isTtsTransport(transport) && transport.generation === generation;
  // The batch a sentence came in, when the floor arrived in batches: it is made as a unit of its own.
  // Paragraphs are the unit whatever batch the reading arrived in.
  const unitOf = () => ({});
  // A floor heard while it arrives: the request it arrives from. Its failure stops the reading at the
  // next sentence rather than sending the floor to Fish a second time.
  transport.liveJob = null;
  transport.liveFailure = null;
  try {
    while (live() && (transport.index < transport.items.length || !transport.prepared)) {
      if (transport.liveFailure) throw transport.liveFailure;
      if (transport.index >= transport.items.length) {
        // The next batch of the reading is still on its way.
        setTransport(transport, { state: 'loading', message: '等副模型的下一批…' });
        await new Promise(resolve => { transport.wake = resolve; });
        transport.wake = null;
        continue;
      }
      // Settings changed since the transport was built: its items are made again from the current
      // voice table before anything more is heard, with nothing asked of the model.
      await syncTtsTransport(transport);
      if (!live()) return;
      if (transport.index >= transport.items.length) continue;
      const { floor, settings } = transport;
      const items = transport.items;
      const item = items[transport.index];
      // A paragraph button reads its paragraph and stops at its end.
      const stopLine = transport.paragraph ? item.segment.lineId : null;
      scheduleTtsAhead(transport);
      setTransport(transport, { state: 'loading', message: '正在准备音频…' });
      setTtsButtonState(transport.messageId, item.segment.id, 'busy', transport.side, item.segment.lineId);
      let entry;
      try {
        entry = await resolveTtsEntry(floor, items, item, settings, text => live() && setTransport(transport, { message: text }), (id, patch) => ttsStep(floor, id, patch), {
          single: transport.single,
          ...unitOf(item),
          // Made-not-played waits for the whole take; played, a floor sent whole starts as it arrives,
          // with a moment's grace at the very start for one that is nearly done anyway.
          live: !transport.generateOnly,
          liveGrace: transport.current ? 0 : 300,
        });
      } finally {
        setTtsButtonState(transport.messageId, item.segment.id, null, transport.side, item.segment.lineId);
      }
      if (!live()) return;
      if (entry.live && transport.liveJob !== entry.job) {
        const job = entry.job;
        transport.liveJob = job;
        job.catch(error => {
          if (transport.liveJob === job && !isAbortError(error)) transport.liveFailure = error;
        });
      }
      if (transport.generateOnly && !entry.cached) {
        // Made, not played: the reader asked for it that way. The next click on it plays.
        setTransport(transport, { state: 'idle', message: '已生成，再点一次播放' });
        notifyTtsReady(transport.messageId);
        return;
      }
      const { record, index } = entry;
      const part = record.timeline[index].part;
      // The stretch of this part that belongs to items still ahead, in order, so the clock can name them.
      // A sentence with a take of its own — rewritten by the reader, or made again alone — is heard
      // from that take, not from the paragraph's older reading of it: the stretch ends before it, and
      // the next turn of the loop plays it on its own before carrying on.
      const ahead = new Map();
      for (let offset = transport.index; offset < items.length; offset += 1) {
        const candidate = items[offset];
        const found = record.timeline.findIndex(candidateEntry => candidateEntry.id === candidate.segment.id && candidateEntry.part === part);
        if (found < 0 || (stopLine !== null && candidate.segment.lineId !== stopLine)) break;
        if (offset > transport.index) {
          const own = await findTtsEntry(floor, candidate, settings);
          if (own && own.record.key !== record.key) break;
        }
        ahead.set(offset, record.timeline[found]);
        if (transport.single) break;
      }
      const lastOffset = [...ahead.keys()].at(-1);
      const window = playbackWindow(record.timeline, index, record.parts[part]?.duration);
      const endWindow = playbackWindow(record.timeline, record.timeline.findIndex(candidateEntry => candidateEntry.id === items[lastOffset].segment.id && candidateEntry.part === part), record.parts[part]?.duration);
      const url = ttsObjectUrl(`${record.key}#${part}`, record.parts[part].blob);
      transport.current = { record, part, url, start: window.start, end: endWindow.end };
      // Prefetch: the recording the next paragraph will need, while this one plays.
      // Read off the transport, not the list this turn started with: a batch that arrived meanwhile is in it.
      // Not while the floor is still arriving: the request making it is making the next one too.
      const next = transport.items[lastOffset + 1];
      if (next && !transport.single && !entry.live) void resolveTtsEntry(floor, transport.items, next, settings, null, null, unitOf(next)).catch(() => {});
      setTransport(transport, { state: 'playing', message: '' });
      highlightTtsUtterance(transport.messageId, item.segment.id, transport.side);
      let beat = -1;
      const outcome = await playTtsAudio(url, {
        start: window.start,
        end: endWindow.end,
        onTime: (time, duration) => {
          if (!live()) return;
          let active = transport.index;
          for (const [offset, candidate] of ahead) if (candidate.start <= time + 0.05) active = offset;
          transport.progress = { time: Math.max(0, time - window.start), duration: Math.max(0, endWindow.end - window.start) || duration || 0 };
          if (active !== transport.index) {
            transport.index = active;
            highlightTtsUtterance(transport.messageId, items[active].segment.id, transport.side);
            setTransport(transport, {});
          } else if (Math.floor(time * 4) !== beat) {
            // Four beats a second is all a clock and a bar need; the audio itself is watched far more often.
            beat = Math.floor(time * 4);
            notifyTtsProgress();
          }
        },
      });
      if (!live()) return;
      if (outcome === 'blocked') {
        // The reading waits where it is; the next tap on a play key runs it from here.
        transport.blocked = true;
        setTransport(transport, { state: 'paused', message: '' });
        toast('info', '浏览器要先点一下才肯出声：点播放键就从这里开始读。');
        return;
      }
      if (outcome === 'error') throw new Error('浏览器播放这段音频失败。换成 mp3 格式通常能解决。');
      if (outcome === 'stopped') return;
      transport.index = lastOffset + 1;
      if (transport.single) break;
      if (stopLine !== null && items[transport.index]?.segment.lineId !== stopLine) break;
    }
    if (live()) {
      transport.index = Math.min(transport.index, transport.items.length - 1);
      finishTtsTransport(transport);
    }
  } catch (error) {
    if (isAbortError(error) || !live()) return;
    setTransport(transport, { state: 'error', message: safeError(error) });
    toast('error', safeError(error));
    highlightTtsUtterance(transport.messageId, null);
  }
}

function finishTtsTransport(transport) {
  if (!isTtsTransport(transport)) return;
  reportTtsFish(transport.floor);
  highlightTtsUtterance(transport.messageId, null);
  setTransport(transport, { state: 'idle', message: '', progress: { time: 0, duration: 0 } });
  // The transport stays around so the panel can still step through, save, or play again.
}

function stopTtsPlayback() {
  const player = runtime.tts.player;
  if (player) {
    player.token += 1;
    player.cancel?.('stopped');
    player.audio.pause();
  }
  if (typeof document !== 'undefined') highlightTtsUtterance(null, null);
}

/** Turns choosing on or off for one floor; the ticks themselves live in the floor's own markup. */
function setTtsPicking(messageId, side) {
  const root = ttsMessageText(messageId);
  if (!root) return;
  if (side) root.dataset.jyTtsPick = side;
  else {
    delete root.dataset.jyTtsPick;
    for (const box of root.querySelectorAll('[data-jy-tts-pick-line]')) box.checked = false;
  }
  syncTtsPicking(messageId);
}

/** What the bar shows while choosing: how many paragraphs are ticked, and the controls for them. */
function syncTtsPicking(messageId) {
  const root = ttsMessageText(messageId);
  const bar = root?.querySelector(':scope > .jy-tts-bar');
  if (!root || !bar) return;
  const side = root.dataset.jyTtsPick ?? '';
  const chosen = ttsPickedLines(messageId, side);
  const count = bar.querySelector('[data-jy-tts-pick-count]');
  if (count) {
    count.hidden = !side;
    count.textContent = chosen.length ? `已选 ${chosen.length} 段` : '勾选要缓存的段落';
  }
  for (const [selector, shown] of [['.jy-tts-bar-pick', !side], ['.jy-tts-bar-pick-save', Boolean(side)], ['.jy-tts-bar-pick-all', Boolean(side)], ['.jy-tts-bar-pick-exit', Boolean(side)]]) {
    const button = bar.querySelector(selector);
    if (button) button.hidden = !shown;
  }
  const save = bar.querySelector('.jy-tts-bar-pick-save');
  if (save) save.disabled = !chosen.length;
}

/** The paragraphs ticked on one floor, in the order they are read. */
function ttsPickedLines(messageId, side) {
  const root = ttsMessageText(messageId);
  if (!root) return [];
  return [...root.querySelectorAll('[data-jy-tts-pick-line]')]
    .filter(box => box.checked && (!side || box.dataset.jyTtsSide === side))
    .map(box => Number(box.dataset.jyTtsPickLine));
}

/** Makes the ticked paragraphs and hands the file over, the same way every other save does. */
async function saveTtsPicked(messageId, side) {
  const lineIds = ttsPickedLines(messageId, side);
  if (!lineIds.length) throw new Error('先勾选要缓存的段落。');
  const answer = await ttsAskBox({
    title: `缓存第 ${messageId} 楼选中的 ${lineIds.length} 段`,
    text: '还没生成的句子会先向 Fish 要一次，然后拼成一个文件交给你保存。',
    actions: [{ value: 'yes', label: `确认缓存这 ${lineIds.length} 段`, primary: true }, { value: 'cancel', label: '再想想' }],
  }, { label: '缓存选中的段落' });
  if (answer !== 'yes') return;
  setTtsStatus(messageId, `正在准备选中的 ${lineIds.length} 段…`, 'busy');
  try {
    const built = await downloadTtsAudio({ messageId, side, lineIds });
    await ttsOfferFile(built.blob, built.name, { note: built.spliced ? '改过和单独重做的句子已按顺序拼在原位置，所以是 wav' : '' });
    setTtsPicking(messageId, null);
  } finally {
    setTtsStatus(messageId, '', 'idle');
  }
}

/** Nothing in a floor is still being made, so nothing in it still says it is. */
function clearTtsBusyMarks(messageId) {
  if (typeof document === 'undefined') return;
  for (const button of document.querySelectorAll(`#chat .mes[mesid="${messageId}"] [data-state="busy"]`)) delete button.dataset.state;
}

function stopTtsTransport(transport, clearStatus = true) {
  if (!transport) return;
  reportTtsFish(transport.floor);
  clearTtsBusyMarks(transport.messageId);
  transport.generation += 1;
  transport.wake?.();
  stopTtsPlayback();
  abortTtsJobs(transport.messageId);
  if (runtime.tts.transport === transport) {
    transport.state = 'idle';
    transport.message = '';
    transport.progress = { time: 0, duration: 0 };
    if (clearStatus) setTtsStatus(transport.messageId, '', 'idle');
  }
}

function stopTts(messageId = null) {
  // A reading of text still being written, on this floor or anywhere when no floor is named.
  const stream = runtime.tts.stream;
  if (stream && !stream.done && (messageId === null || stream.messageId === Number(messageId))) stream.cancel();
  // Whatever was about to be read for this floor is called off with it.
  for (const [id, timer] of runtime.tts.closing) {
    if (messageId !== null && id !== Number(messageId)) continue;
    globalThis.clearTimeout(timer);
    runtime.timers.delete(timer);
    runtime.tts.closing.delete(id);
  }
  const transport = runtime.tts.transport;
  if (transport && (messageId === null || transport.messageId === messageId)) {
    stopTtsTransport(transport);
    runtime.tts.transport = null;
  } else {
    stopTtsPlayback();
    abortTtsJobs(messageId);
  }
  if (messageId !== null) setTtsStatus(messageId, '', 'idle');
  notifyTtsPanels();
}

function pauseTts() {
  const transport = runtime.tts.transport;
  if (!transport || transport.state !== 'playing') return;
  runtime.tts.player?.audio.pause();
  setTransport(transport, { state: 'paused' });
}

function resumeTts() {
  const transport = runtime.tts.transport;
  if (!transport) return;
  // Paused because the browser refused to start: nothing is playing to be resumed, the run starts again.
  if (transport.blocked) transport.blocked = false;
  else if (transport.state === 'paused') {
    const audio = runtime.tts.player?.audio;
    if (audio && audio.src) {
      Promise.resolve(audio.play()).then(() => setTransport(transport, { state: 'playing' })).catch(error => {
        setTransport(transport, { state: 'error', message: safeError(error) });
      });
      return;
    }
  }
  if (['idle', 'error', 'paused'].includes(transport.state)) {
    transport.single = false;
    transport.paragraph = false;
    void runTtsTransport(transport);
  }
}

function toggleTtsPause() {
  const transport = runtime.tts.transport;
  if (!transport) return;
  if (transport.state === 'playing') pauseTts();
  else resumeTts();
}

/**
 * Moves to a point of the stretch being read, as a fraction of it. Playing or paused, the clock is
 * simply set and the highlight follows it; after the end, the sentence at that point is read from.
 */
function seekTts(fraction) {
  const transport = runtime.tts.transport;
  const current = transport?.current;
  if (!current) return;
  const span = Math.max(0, (Number(current.end) || 0) - (Number(current.start) || 0));
  const time = (Number(current.start) || 0) + Math.max(0, Math.min(1, Number(fraction) || 0)) * span;
  const audio = runtime.tts.player?.audio;
  if (['playing', 'paused'].includes(transport.state) && audio?.src) {
    // Paused, the clock stops just short of the end: reaching it would start the next sentence.
    const clock = transport.state === 'paused' ? Math.min(time, Math.max(current.start, current.end - 0.05)) : time;
    try {
      audio.currentTime = clock;
    } catch {
      return;
    }
    transport.progress = { time: Math.max(0, clock - current.start), duration: span };
    notifyTtsPanels();
    return;
  }
  const inPart = current.record.timeline.map((entry, index) => ({ entry, index })).filter(item => item.entry.part === current.part);
  let target = inPart[0];
  for (const item of inPart) if (item.entry.start <= time + 0.05) target = item;
  const index = target ? transport.items.findIndex(item => item.segment.id === target.entry.id) : -1;
  if (index < 0) return;
  transport.generation += 1;
  stopTtsPlayback();
  transport.index = index;
  transport.single = false;
  transport.paragraph = false;
  void runTtsTransport(transport);
}

// Steps to another paragraph and reads on from there, whatever was playing.
// Audio made in the background is ready: a short buzz on a phone, and a word when the window is shut.
function notifyTtsReady(messageId) {
  try {
    if (isCompactViewport()) globalThis.navigator?.vibrate?.(30);
  } catch {
    // Vibration is a nicety.
  }
  if (!runtime.mini?.host?.isConnected) toast('info', `第 ${messageId} 楼的音频好了，点播放。`);
}

function stepTtsParagraph(direction) {
  const transport = runtime.tts.transport;
  if (!transport?.items.length) return;
  const lines = groupSegmentsByLine(transport.items.map(item => item.segment));
  const current = transport.items[transport.index]?.segment.lineId;
  let lineIndex = lines.findIndex(line => line.lineId === current);
  if (lineIndex < 0) lineIndex = 0;
  // Going back within the first moments of a paragraph means the paragraph before it.
  const target = direction < 0
    ? (transport.progress.time > 2 && transport.state === 'playing' ? lineIndex : Math.max(0, lineIndex - 1))
    : Math.min(lines.length - 1, lineIndex + 1);
  if (direction > 0 && lineIndex >= lines.length - 1) return;
  const firstId = lines[target].segments[0].id;
  const index = transport.items.findIndex(item => item.segment.id === firstId);
  transport.generation += 1;
  stopTtsPlayback();
  transport.index = index;
  transport.single = false;
  transport.paragraph = false;
  void runTtsTransport(transport);
}

async function playTtsUtterance(messageId, utteranceId, side = null) {
  const wantedSide = side ?? primaryTtsSide();
  const existing = runtime.tts.transport;
  // The floor already open in the transport, paused or not: a click on one of its sentences is a seek,
  // never a second preparation of the same floor.
  if (existing && existing.messageId === messageId && existing.side === wantedSide && existing.floor && existing.items.length) {
    await syncTtsTransport(existing);
    const index = existing.items.findIndex(item => item.segment.id === utteranceId);
    if (index >= 0) {
      if (existing.state === 'loading' && existing.index === index) return;
      existing.generation += 1;
      stopTtsPlayback();
      existing.index = index;
      existing.single = true;
      existing.paragraph = false;
      existing.generateOnly = !ttsSettings().playAfterGenerate;
      await runTtsTransport(existing);
      return;
    }
  }
  // A second click while the first is still preparing this floor changes nothing.
  if (existing?.state === 'loading' && existing.messageId === messageId && existing.side === wantedSide) return;
  setTtsButtonState(messageId, utteranceId, 'busy', wantedSide);
  try {
    const transport = await createTtsTransport(messageId, { single: true, fromUtterance: utteranceId, side: wantedSide });
    if (!transport) {
      setTtsButtonState(messageId, utteranceId, null, wantedSide);
      return;
    }
    await runTtsTransport(transport);
  } catch (error) {
    if (isAbortError(error)) return;
    const transport = runtime.tts.transport;
    if (transport?.messageId === messageId) setTransport(transport, { state: 'error', message: safeError(error) });
    else setTtsStatus(messageId, safeError(error), 'error');
    toast('error', safeError(error));
  } finally {
    setTtsButtonState(messageId, utteranceId, null, wantedSide);
  }
}

/**
 * Read from the top of one paragraph and keep going.
 *
 * A sentence click stops at the end of its sentence; a paragraph click is how the floor is read from
 * a place, so it leaves `single` off and the reading runs on into the paragraphs below it.
 */
async function playTtsParagraph(messageId, lineId, side = null) {
  const wantedSide = side ?? primaryTtsSide();
  const existing = runtime.tts.transport;
  if (existing && existing.messageId === messageId && existing.side === wantedSide && existing.floor && existing.items.length) {
    await syncTtsTransport(existing);
    const index = existing.items.findIndex(item => item.segment.lineId === lineId);
    if (index >= 0) {
      if (existing.state === 'loading' && existing.index === index) return;
      existing.generation += 1;
      stopTtsPlayback();
      existing.index = index;
      existing.single = false;
      existing.paragraph = true;
      existing.generateOnly = !ttsSettings().playAfterGenerate;
      await runTtsTransport(existing);
      return;
    }
  }
  if (existing?.state === 'loading' && existing.messageId === messageId && existing.side === wantedSide) return;
  setTtsLineState(messageId, lineId, 'busy', wantedSide);
  try {
    const prepared = await ttsPrepared(messageId, wantedSide);
    const first = prepared.items.find(item => item.segment.lineId === lineId);
    if (!first) throw new Error('这一段不在当前的朗读范围里。');
    const transport = await createTtsTransport(messageId, { single: false, paragraph: true, fromUtterance: first.segment.id, side: wantedSide });
    if (!transport) return;
    await runTtsTransport(transport);
  } catch (error) {
    if (isAbortError(error)) return;
    const transport = runtime.tts.transport;
    if (transport?.messageId === messageId) setTransport(transport, { state: 'error', message: safeError(error) });
    else setTtsStatus(messageId, safeError(error), 'error');
    toast('error', safeError(error));
  } finally {
    setTtsLineState(messageId, lineId, null, wantedSide);
  }
}

async function playTtsFloor(messageId, side = null) {
  const wantedSide = side ?? primaryTtsSide();
  try {
    if (!ttsSettings().playAfterGenerate) {
      // Generate-only: the floor is made first; a floor that is already made plays.
      const made = await pregenerateTtsFloor(messageId, { quiet: true, side: wantedSide });
      if (made) {
        setTtsStatus(messageId, `已生成 ${made} 段音频，再点一次「朗读」播放`, 'idle');
        return;
      }
    }
    const transport = await createTtsTransport(messageId, { single: false, side: wantedSide });
    if (!transport) return;
    await runTtsTransport(transport);
  } catch (error) {
    if (isAbortError(error)) return;
    const transport = runtime.tts.transport;
    if (transport?.messageId === messageId) setTransport(transport, { state: 'error', message: safeError(error) });
    else setTtsStatus(messageId, safeError(error), 'error');
    toast('error', safeError(error));
  }
}

/**
 * Makes a floor's audio without playing it: the whole floor as one unit, or paragraph after paragraph
 * in the stream. Nothing is made twice; a floor already recorded returns at once.
 */
async function pregenerateTtsFloor(messageId, { quiet = false, side = null, once = false } = {}) {
  const settings = runtime.settings;
  const tts = ttsSettings(settings);
  // Both languages: one after the other, the translation first.
  if (side === null && tts.side === 'both') {
    let total = 0;
    for (const each of ttsSides(settings)) total += (await pregenerateTtsFloor(messageId, { quiet: true, side: each, once })) ?? 0;
    if (!quiet && total) toast('success', `第 ${messageId} 楼的音频已生成，${total} 段。`);
    return total;
  }
  const floor = await collectTtsFloor(messageId, settings, side);
  if (!floor) return null;
  // Asked for by the floor itself rather than by the reader: this text was made once already.
  if (once && runtime.tts.pregenerated.has(ttsLabelKey(floor))) return 0;
  const key = `${ttsLabelKey(floor)}|pregen`;
  return dedupeTtsJob(key, messageId, async () => {
    try {
      return await pregenerateTtsBody(floor, messageId, settings, tts, quiet);
    } finally {
      // A failure on the way to Fish must not leave 正在生成…音频 pinned under the floor for good.
      if (!['loading', 'playing', 'paused'].includes(runtime.tts.transport?.messageId === messageId ? runtime.tts.transport.state : '')) {
        const status = runtime.tts.status.get(messageId);
        if (status?.state === 'busy') setTtsStatus(messageId, '', 'idle');
      }
    }
  });
}

async function pregenerateTtsBody(floor, messageId, settings, tts, quiet) {
  {
    beginTtsProgress(floor, tts);
    const { segments } = await prepareTtsSegments(floor, settings, {
      onStatus: text => setTtsStatus(messageId, text, text ? 'busy' : 'idle'),
      onStep: (id, patch) => ttsStep(floor, id, patch),
    });
    const { items } = await ttsItemsFor(floor, segments, settings);
    if (!items.length) return null;
    const units = ttsUnitsOf(tts, items);
    // Every paragraph is listed first: what is already made, and what is still to come.
    await announceTtsUnits(floor, items, settings, tts);
    let made = 0;
    // As many paragraphs at once as Fish allows; each one already recorded in any unit is skipped.
    await runInLanes(units, Math.max(1, Number(tts.fish.concurrency) || 1), async (target, index) => {
      const covered = await Promise.all(target.items.map(item => findTtsEntry(floor, item, settings)));
      if (covered.every(Boolean)) {
        ttsStep(floor, `record:${target.unit}`, { state: 'done', detail: '已有音频' });
        return;
      }
      const { cached } = await ensureTtsRecording(floor, target.unit, target.items, settings,
        text => setTtsStatus(messageId, units.length > 1 ? `${text}（${index + 1}/${units.length}）` : text, 'busy'),
        (id, patch) => ttsStep(floor, id, patch));
      if (!cached) made += 1;
    });
    runtime.tts.pregenerated.add(ttsLabelKey(floor));
    // A transport left idle on this floor is no reason to leave 正在生成 under it.
    if (!['loading', 'playing', 'paused'].includes(runtime.tts.transport?.messageId === messageId ? runtime.tts.transport.state : '')) {
      setTtsStatus(messageId, made ? '音频已生成，未播放' : '', 'idle');
    }
    if (made) {
      recordDiagnostic('info', 'tts.recording', `第 ${messageId} 楼${floor.side === 'source' ? '原文' : '译文'}的音频已生成：${units.length} 段里新做了 ${made} 段，${items.length} 句。`, {
        floor: floor.floorId, made, units: units.length, sentences: items.length, model: tts.fish.model, format: tts.fish.format,
      }, '', { floor: messageId });
    }
    if (!quiet && made) toast('success', `第 ${messageId} 楼的音频已生成，${made} 段。`);
    return made;
  }
}

/**
 * The floor's paragraphs, listed before anything is made: the ones already recorded marked 已有音频,
 * the rest pending. Without this the list showed only what was being generated, and a floor that
 * reused fourteen paragraphs out of seventeen looked like it was being made again from nothing.
 */
async function announceTtsUnits(floor, items, settings, tts) {
  for (const target of ttsUnitsOf(tts, items)) {
    const covered = await Promise.all(target.items.map(item => findTtsEntry(floor, item, settings)));
    if (covered.every(Boolean)) {
      ttsFishTally(floor).reused += 1;
      ttsStep(floor, `record:${target.unit}`, { state: 'done', label: ttsUnitLabel(target.unit), detail: '已有音频' });
    } else {
      ttsStep(floor, `record:${target.unit}`, { state: 'pending', label: ttsUnitLabel(target.unit) });
    }
  }
}

/** A floor still being written is read by nobody: the analyses want the whole of it. */
function requireClosedFloor(messageId) {
  if (runtime.mainGenerationActive && latestAssistantMessageId(getContext()) === Number(messageId)) {
    throw new Error('这一楼还在生成，等它写完再读。');
  }
}

/**
 * What happens once a floor's text is whole: the host says the generation finished, the reader
 * swiped or edited, or this extension's translation of it landed.
 *
 * The analysed readings read the original the moment it has closed — the deep one always, the
 * simple one when no translation is on its way to bring its marks — and audio follows when asked
 * for. Nothing here waits for the translation, and nothing here runs while the floor is still being
 * written: a floor read halfway is a floor read wrong and paid for twice.
 */
function ttsFloorClosed(messageId, { translated = false, reason = 'generation' } = {}) {
  const tts = ttsSettings();
  const id = Number(messageId);
  if (!tts.enabled || !Number.isInteger(id) || runtime.mainGenerationActive) return;
  if (latestAssistantMessageId(getContext()) !== id) return;
  // One pass per floor: the previous appointment is cancelled, never queued behind this one.
  const pending = runtime.tts.closing.get(id);
  if (pending !== undefined) {
    globalThis.clearTimeout(pending);
    runtime.timers.delete(pending);
  }
  const timer = globalThis.setTimeout(async () => {
    runtime.tts.closing.delete(id);
    runtime.timers.delete(timer);
    if (runtime.mainGenerationActive) return;
    const settings = runtime.settings;
    const current = ttsSettings(settings);
    const message = getContext().chat?.[id];
    if (!current.enabled || !message || message.is_user || message.is_system) return;
    const reads = ttsSides(settings);
    // A translation is still being written into this floor. The original is untouched by that, so a
    // reading of the original goes ahead now, in parallel; a reading of the translation waits for a
    // text that does not exist yet, and the appointment is simply moved.
    const busy = ttsFloorTranslating(id);
    if (busy && !reads.includes('source')) {
      ttsFloorClosed(id, { translated, reason });
      return;
    }
    // Throwing the prepared floor away under a running analysis would abort it; that tidy-up belongs
    // to the pass that happens once the writing has stopped.
    if (translated && !busy) {
      await forgetChangedTtsItems(id);
      scheduleTtsDecorate(id, { force: true });
    }
    // A translation on its way brings the simple reading's marks with it; its side is read once it lands.
    // Whether one is on its way follows the switch for what happened to the floor, and an alternative
    // that already carries its translation is waiting for nothing.
    const meta = message.extra?.[MESSAGE_META_KEY];
    const carries = meta?.complete === true && Number(meta.swipe_id ?? 0) === Number(message.swipe_id ?? 0);
    const automatic = reason === 'swipe' ? settings.autoSwipe === true : reason === 'edit' ? settings.autoEdit === true : settings.autoGeneration === true;
    const translating = settings.enabled !== false && automatic && !translated && !carries;
    // The original is read: it is there whatever the translation is doing, so every announcement of
    // this floor is a chance to read it. Asking twice costs nothing — the analysis is kept per text
    // version, and the second call finds it. Only the translation is read: it has to exist first, so
    // that one waits until it lands.
    const side = reads.includes('source') ? 'source' : 'translation';
    const readable = side === 'source' || translated || !translating;
    // Read aloud by itself: a floor a generation just wrote, on the side heard first, once that side's
    // text is final. The reading makes its own audio as it goes, so that side is not made beforehand.
    const primary = reads[0];
    const primaryReady = primary === 'source' || translated || carries || !translating;
    // Read while it was written: the original has been heard, and is not analysed, made or read again.
    const streamed = runtime.tts.streamed.has(id);
    const due = current.autoRead && !streamed && runtime.tts.fresh.has(id) && primaryReady && !(primary === 'translation' && busy);
    // A call has the voice: the reply is prepared like any floor not read by itself, and said once.
    const calling = callActive();
    const autoRead = due && !calling;
    if (autoRead || !current.autoRead || (calling && due)) runtime.tts.fresh.delete(id);
    if (calling && due) toast('info', `第 ${id} 楼有新回复：挂断以后点楼层开头的「朗读」就能听。`);
    try {
      // The side read aloud is analysed by the reading itself, as it prepares.
      if (readable && !(autoRead && side === primary) && !(streamed && side === 'source') && (current.mode === 'deep' || (current.mode === 'simple' && !translating))) await analyseTtsFloorNow(id, side, current.mode);
      if (autoRead) void autoReadTtsFloor(id, primary);
      if (current.autoGenerate) {
        let made = 0;
        for (const each of reads) {
          // The translation's own side is made once the translation is there to read.
          if (each === 'translation' && (translating || busy)) continue;
          if (autoRead && each === primary) continue;
          if (streamed && each === 'source') continue;
          made += (await pregenerateTtsFloor(id, { quiet: true, side: each, once: true })) ?? 0;
        }
        // Made in the background with nobody listening: say so, the way a floor made on request does.
        if (made && !autoRead && !current.autoRead) notifyTtsReady(id);
      }
    } catch (error) {
      if (!isAbortError(error)) recordDiagnostic('warn', 'tts.auto', `第 ${id} 楼正文闭合后的自动处理失败：${safeError(error)}`, { floor: id });
    }
    // The original was read while the translation was still coming; the translation's own side, and
    // the tidy-up that goes with it, are what this floor is asked about again once it lands.
    if (busy && reads.includes('translation')) ttsFloorClosed(id, { translated, reason });
  }, translated ? 800 : 1200);
  runtime.tts.closing.set(id, timer);
  runtime.timers.add(timer);
}

/** Whether this extension is writing a translation into this floor right now. */
function ttsFloorTranslating(messageId) {
  const context = getContext();
  const message = context.chat?.[Number(messageId)];
  if (!message) return false;
  return runtime.inflight.has(`${getCurrentChatId(context)}|${Number(messageId)}|${Number(message.swipe_id ?? 0)}`);
}

/** Whether anything is being asked or made for this floor at this moment. */
function ttsJobRunning(messageId) {
  for (const job of runtime.tts.jobs.values()) if (job.messageId === Number(messageId)) return true;
  return false;
}

/** The analysis of one floor, made now on the text that will be heard and kept for both sides. */
async function analyseTtsFloorNow(messageId, side, depth) {
  const settings = runtime.settings;
  const floor = await collectTtsFloor(messageId, settings, side);
  if (!floor) return null;
  beginTtsProgress(floor);
  try {
    await prepareTtsSegments(floor, settings, {
      analyze: depth,
      onStatus: text => setTtsStatus(messageId, text, text ? 'busy' : 'idle'),
      onStep: (id, patch) => ttsStep(floor, id, patch),
    });
  } finally {
    setTtsStatus(messageId, '', 'idle');
    scheduleTtsDecorate(messageId, { force: true });
  }
  return floor;
}

// ---------------------------------------------------------------------------------------------
// Saving audio to a file: the whole floor, or the paragraph being read.
// ---------------------------------------------------------------------------------------------

async function ttsDownloadBlob(records, format) {
  const blobs = [];
  for (const record of records) for (const part of record.parts) blobs.push(part.blob);
  if (!blobs.length) throw new Error('还没有生成音频。');
  if (format === 'wav') {
    const buffers = [];
    for (const blob of blobs) buffers.push(new Uint8Array(await blob.arrayBuffer()));
    return new Blob([mergeWavBuffers(buffers)], { type: 'audio/wav' });
  }
  return new Blob(blobs, { type: blobs[0].type || FISH_MIME[format] || 'audio/mpeg' });
}

/**
 * One stretch of a recording as its own file.
 *
 * The audio is decoded and the samples between the two moments are written out as wav. Cutting mp3 or
 * Ogg bytes at an arbitrary moment gives a file that stutters or will not open, and asking Fish for
 * the sentence again would give a different reading of it — this keeps the take that was heard.
 */
async function sliceAudioToWav(blob, start, end) {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error('这个浏览器剪不出单句音频，改用「缓存当前对白」或「缓存全篇」。');
  const context = new Context();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const from = Math.max(0, Math.floor((Number(start) || 0) * buffer.sampleRate));
    const to = Math.min(buffer.length, Math.ceil((Number.isFinite(end) ? end : buffer.duration) * buffer.sampleRate));
    if (to <= from) throw new Error('算不出这一句在音频里的位置，先保存整段。');
    const channels = [];
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) channels.push(buffer.getChannelData(channel).slice(from, to));
    return new Blob([encodeWav(channels, buffer.sampleRate)], { type: 'audio/wav' });
  } finally {
    void context.close?.();
  }
}

/** One sentence saved on its own, cut out of whatever recording it was read in. */
async function downloadTtsSentence(messageId, utteranceId, side = null) {
  const prepared = await ttsSaveSource({ messageId, side });
  const item = prepared.items.find(candidate => candidate.segment.id === Number(utteranceId));
  if (!item) throw new Error('这一句不在当前的朗读范围里，可能被屏蔽了。');
  const entry = await findTtsEntry(prepared.floor, item, prepared.settings);
  if (!entry) throw new Error('这一句还没有音频，先播一次再保存。');
  const tts = ttsSettings(prepared.settings);
  const { record, index } = entry;
  const line = record.timeline[index];
  const part = record.parts[line.part];
  if (!part?.blob) throw new Error('这一句的音频不在了，重新播一次再保存。');
  // A take made for this sentence alone already is the file; anything else is cut out of its paragraph.
  const alone = record.unit === `sentence:${item.segment.id}` && record.parts.length === 1;
  const blob = alone ? part.blob : await sliceAudioToWav(part.blob, line.start, line.end);
  const format = tts.fish.format === 'opus' ? 'ogg' : tts.fish.format;
  const who = item.segment.type === 'narration' ? '旁白' : (item.segment.speaker || '对白');
  const name = `镜译-第${messageId}楼-${who}-第${item.segment.id}句.${alone ? format : 'wav'}`;
  return { blob, name, bytes: blob.size, cut: !alone };
}

/**
 * The floor a save works on.
 *
 * What is playing, when it is this floor — brought up to date first, because a settings change
 * between the last play and the save would otherwise look for recordings under a fingerprint that
 * no longer matches. Otherwise the floor as the window has it prepared, so saving works on a floor
 * nobody has played yet.
 */
async function ttsSaveSource({ messageId = null, side = null } = {}) {
  const transport = runtime.tts.transport;
  const wanted = Number.isInteger(messageId) ? messageId : transport?.messageId;
  if (!Number.isInteger(wanted)) throw new Error('先选一楼，再保存它的音频。');
  const which = side ?? (transport?.messageId === wanted ? transport.side : primaryTtsSide());
  if (transport && transport.messageId === wanted && transport.side === which && transport.items.length) {
    await syncTtsTransport(transport);
    return { messageId: wanted, side: which, floor: transport.floor, items: transport.items, settings: transport.settings, current: transport.items[transport.index]?.segment ?? null };
  }
  const prepared = await ttsPrepared(wanted, which);
  if (!prepared.items.length) throw new Error('这一楼没有可朗读的句子。');
  return { messageId: wanted, side: which, floor: prepared.floor, items: prepared.items, settings: prepared.settings, current: null };
}

/**
 * Saves a floor's audio, or one paragraph of it: every recording its sentences live in, in reading
 * order, made first when any is missing.
 */
async function downloadTtsAudio(options = null) {
  const { scope = null, messageId = null, side = null, lineId = null, lineIds = null } = typeof options === 'string' ? { scope: options } : (options ?? {});
  const source = await ttsSaveSource({ messageId, side });
  const tts = ttsSettings(source.settings);
  const picked = Array.isArray(lineIds) && lineIds.length ? new Set(lineIds.map(Number)) : null;
  const wanted = picked ? 'picked' : lineId !== null ? 'current' : (scope ?? (tts.downloadScope === 'auto' ? 'floor' : tts.downloadScope));
  const { floor, items, settings } = source;
  const transport = runtime.tts.transport?.messageId === source.messageId ? runtime.tts.transport : null;
  if (wanted === 'sentence') {
    const current = source.current;
    if (!current) throw new Error('先朗读一楼，或者在悬浮窗里选一句，再保存。');
    return downloadTtsSentence(source.messageId, current.id, source.side);
  }
  const lines = groupSegmentsByLine(items.map(item => item.segment));
  let chosen = items;
  let lineIndex = -1;
  if (picked) {
    chosen = items.filter(item => picked.has(item.segment.lineId));
    if (!chosen.length) throw new Error('选中的段落里没有可朗读的句子。');
  } else if (wanted === 'current') {
    const which = lineId ?? source.current?.lineId ?? lines[0]?.lineId;
    lineIndex = lines.findIndex(line => line.lineId === which);
    chosen = items.filter(item => item.segment.lineId === which);
    if (!chosen.length) throw new Error('这一段没有可朗读的句子。');
  }
  const records = [];
  const entries = [];
  try {
    for (const item of chosen) {
      const entry = await resolveTtsEntry(floor, items, item, settings, text => setTtsStatus(source.messageId, text, 'busy'));
      entries.push({ item, entry });
      if (!records.includes(entry.record)) records.push(entry.record);
    }
  } finally {
    // However it ended, this floor is no longer making anything for the save.
    if (!transport || transport.state === 'idle') setTtsStatus(source.messageId, '', 'idle');
  }
  // A sentence with a take of its own inside a paragraph that still serves its neighbours: the takes
  // are cut and joined in reading order, as wav. Otherwise whole recordings follow one another as
  // they are, in the format they were made in.
  const spliced = downloadNeedsSplice(entries);
  const blob = spliced ? await ttsSplicedWav(entries) : await ttsDownloadBlob(records, tts.fish.format);
  const extension = spliced ? 'wav' : (tts.fish.format === 'opus' ? 'ogg' : tts.fish.format);
  const part = picked ? `-选中${picked.size}段` : wanted === 'current' ? `-第${(lineIndex >= 0 ? lineIndex : 0) + 1}段` : '';
  const name = `镜译-第${source.messageId}楼${part}.${extension}`;
  return { blob, name, bytes: blob.size, records: records.length, spliced };
}

/**
 * Whether the chosen sentences can be saved as their whole recordings one after another, or must be
 * cut and joined: the latter when a recording that serves one of them also holds another of them
 * that plays from a take of its own.
 */
function downloadNeedsSplice(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return list.some(({ entry }) => list.some(other => other.entry.record !== entry.record
    && entry.record.timeline.some(line => line.id === other.item.segment.id)));
}

/**
 * The chosen sentences as one wav, each cut from the take it plays from, joined in reading order.
 *
 * This is the save for a floor in which some sentence has a take of its own — rewritten by the
 * reader, or made again alone — inside a paragraph that still serves its neighbours: the paragraph's
 * audio is decoded, the stretch of the replaced sentence left out, and the sentence's own take put
 * in its place. Neighbouring sentences of one take are cut as one stretch, so nothing between them
 * is lost. The result is wav because a cut inside mp3 or Ogg does not give a file that plays.
 */
async function ttsSplicedWav(entries) {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error('这个浏览器拼不了改过的句子，改用「缓存当前对白」，或者把那一句恢复自动。');
  const context = new Context();
  try {
    const decoded = new Map();
    const stretches = [];
    for (const { entry } of Array.isArray(entries) ? entries : []) {
      const { record, index } = entry;
      const line = record.timeline[index];
      const part = record.parts[line.part];
      if (!part?.blob) throw new Error('有一句的音频不在了，重新播一次再保存。');
      const key = `${record.key}#${line.part}`;
      let buffer = decoded.get(key);
      if (!buffer) {
        buffer = await context.decodeAudioData(await part.blob.arrayBuffer());
        decoded.set(key, buffer);
      }
      const window = playbackWindow(record.timeline, index, part.duration);
      const last = stretches.at(-1);
      if (last && last.buffer === buffer && window.start <= last.end + 0.05 && window.end >= last.end) last.end = window.end;
      else stretches.push({ buffer, start: window.start, end: window.end });
    }
    if (!stretches.length) throw new Error('还没有生成音频。');
    const sampleRate = stretches[0].buffer.sampleRate;
    if (stretches.some(stretch => stretch.buffer.sampleRate !== sampleRate)) throw new Error('这些音频的采样率不一样，拼不到一起；改用「缓存当前对白」。');
    const channels = Math.max(...stretches.map(stretch => stretch.buffer.numberOfChannels));
    const chunks = Array.from({ length: channels }, () => []);
    for (const stretch of stretches) {
      const from = Math.max(0, Math.floor(stretch.start * sampleRate));
      const to = Math.min(stretch.buffer.length, Math.ceil(stretch.end * sampleRate));
      if (to <= from) continue;
      for (let channel = 0; channel < channels; channel += 1) {
        const source = stretch.buffer.getChannelData(Math.min(channel, stretch.buffer.numberOfChannels - 1));
        chunks[channel].push(source.slice(from, to));
      }
    }
    const joined = chunks.map(list => {
      const out = new Float32Array(list.reduce((total, piece) => total + piece.length, 0));
      let at = 0;
      for (const piece of list) {
        out.set(piece, at);
        at += piece.length;
      }
      return out;
    });
    return new Blob([encodeWav(joined, sampleRate)], { type: 'audio/wav' });
  } finally {
    void context.close?.();
  }
}

/** A blob handed to the browser as a download, and the url let go once it has had time to take it. */
function saveBlobAsFile(blob, name) {
  // Nothing can be written from an empty blob, and saying 已保存 about one is worse than failing.
  if (!blob?.size) throw new Error('这段音频是空的，没有东西可以保存。');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Long enough for a phone to show its own save box, be left alone, and come back to it.
  const timer = globalThis.setTimeout(() => {
    runtime.timers.delete(timer);
    URL.revokeObjectURL(url);
  }, 600000);
  // In a browser this changes nothing; under a test runner it keeps a ten-minute timer from
  // holding the process open long after the file it was made for was written.
  timer?.unref?.();
  runtime.timers.add(timer);
  // Handed to the browser: whether a file appears is the browser's own save box to decide.
  return { name, bytes: blob.size, handedOff: true };
}

// ---------------------------------------------------------------------------------------------
// The inspector: what one sentence was read as, what is sent for it, and the reader's own version.
// ---------------------------------------------------------------------------------------------

async function ttsPrepared(messageId, side = null, { fresh = false } = {}) {
  const settings = runtime.settings;
  const which = side ?? primaryTtsSide(settings);
  const key = ttsPreparedKey(messageId, which);
  const known = runtime.tts.floors.get(key);
  if (known && !fresh && known.settings === settings) return known;
  const floor = await collectTtsFloor(messageId, settings, which);
  if (!floor) throw new Error(which === 'source' ? '这一楼没有可朗读的原文。' : '这一楼没有可朗读的译文。');
  // A look at the floor never asks the model: the list, the inspector and the overrides show what is
  // known so far; the reading itself is what analyses, and it drops this entry when it lands.
  const { segments, depth, passive } = await prepareTtsSegments(floor, settings, { onStep: (id, patch) => ttsStep(floor, id, patch), passive: true });
  const { items, skipped } = await ttsItemsFor(floor, segments, settings);
  const prepared = { floor, segments, items, skipped, settings, depth, passive };
  runtime.tts.floors.set(key, prepared);
  if (runtime.tts.floors.size > 40) runtime.tts.floors.delete(runtime.tts.floors.keys().next().value);
  return prepared;
}

/** Everything the inspector shows for one sentence. */
async function ttsInspect(messageId, utteranceId, side = null) {
  const prepared = await ttsPrepared(messageId, side);
  const tts = ttsSettings(prepared.settings);
  const provider = ttsProviderFor(prepared.settings);
  const segment = prepared.segments.find(item => item.id === utteranceId);
  if (!segment) throw new Error('这一句已经变了，等楼层重新渲染后再看。');
  const item = prepared.items.find(candidate => candidate.segment.id === utteranceId)
    ?? { segment, voiceId: resolveSegmentVoice(segment, ttsVoiceConfig(prepared.settings)) };
  const analysis = runtime.tts.analysis.get(ttsLabelKey(prepared.floor));
  const automatic = { ...item, override: undefined };
  const entry = await findTtsEntry(prepared.floor, item, prepared.settings);
  return {
    messageId,
    side: prepared.floor.side,
    segment,
    voiceId: item.voiceId,
    voice: segment.voice,
    summary: voiceSummary(segment.voice ?? (segment.emotion ? { emotion: segment.emotion, intensity: segment.intensity } : null)),
    original: prepared.floor.side === 'translation' ? (prepared.floor.sources?.get(segment.lineId) ?? null) : (prepared.floor.references?.get(segment.lineId) ?? null),
    depth: analysis?.depth ?? prepared.depth ?? null,
    derived: analysis?.derived === true,
    text: provider.sentenceText(automatic, tts),
    prosody: provider.prosody(automatic, tts),
    override: item.override ?? null,
    // The reader rewrote the words or the delivery, as against only naming who speaks.
    edited: Boolean(item.override && (item.override.text || item.override.speed !== undefined || item.override.volume !== undefined)),
    manualSpeaker: item.override?.speaker ?? null,
    speakerSource: segment.speakerSource ?? null,
    speakerEvidence: segment.speakerEvidence ?? [],
    cast: ttsCastNames(prepared.settings),
    recorded: Boolean(entry),
    inRange: prepared.items.some(candidate => candidate.segment.id === utteranceId),
  };
}

function forgetTtsItems(messageId) {
  for (const [key, prepared] of [...runtime.tts.floors]) {
    if (!key.startsWith(`${messageId}|`)) continue;
    runtime.tts.overrides.delete(ttsLabelKey(prepared.floor));
    runtime.tts.floors.delete(key);
  }
  const transport = runtime.tts.transport;
  if (transport?.messageId === messageId) {
    stopTtsTransport(transport);
    runtime.tts.transport = null;
  }
}

/**
 * forgetTtsItems, except for a reading of the original whose text did not change: a translation written
 * into the floor beside it changes nothing that reading says, and stopping it lost the reader's place.
 */
async function forgetChangedTtsItems(messageId) {
  const transport = runtime.tts.transport;
  if (transport?.messageId === messageId && transport.side === 'source' && transport.floor) {
    const floor = await collectTtsFloor(messageId, runtime.settings, 'source').catch(() => null);
    if (floor && floor.version === transport.floor.version && runtime.tts.transport === transport) {
      for (const [key, prepared] of [...runtime.tts.floors]) {
        if (!key.startsWith(`${messageId}|`) || prepared.floor.side === 'source') continue;
        runtime.tts.overrides.delete(ttsLabelKey(prepared.floor));
        runtime.tts.floors.delete(key);
      }
      return false;
    }
  }
  forgetTtsItems(messageId);
  return true;
}

/** Whether the floor being read still reads the same at the place it was read from. */
async function ttsReadingStands() {
  const transport = runtime.tts.transport;
  if (!transport?.floor) return true;
  const floor = await collectTtsFloor(transport.messageId, runtime.settings, transport.side).catch(() => null);
  return Boolean(floor) && floor.floorId === transport.floor.floorId && floor.version === transport.floor.version;
}

/**
 * A new reply read aloud by itself. Once per text: the passes that follow a translation landing find
 * it read. Never over a reading already going (the reader is told instead), never on a page in the
 * background, where a browser would refuse to start sound anyway.
 */
async function autoReadTtsFloor(messageId, side) {
  const settings = runtime.settings;
  if (callActive()) return;
  const floor = await collectTtsFloor(messageId, settings, side).catch(() => null);
  if (!floor) return;
  const key = ttsLabelKey(floor);
  if (runtime.tts.autoRead.has(key)) return;
  runtime.tts.autoRead.add(key);
  const current = runtime.tts.transport;
  if (current && ['loading', 'playing', 'paused'].includes(current.state)) {
    toast('info', `第 ${messageId} 楼的新回复可以听了：正在读的这一楼读完后，点「朗读」或者悬浮窗的播放键。`);
    return;
  }
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    recordDiagnostic('info', 'tts.auto-read', `第 ${messageId} 楼写完时页面在后台，没有自动朗读。`, { floor: messageId, side });
    return;
  }
  recordDiagnostic('info', 'tts.auto-read', `第 ${messageId} 楼自动朗读${side === 'source' ? '原文' : '译文'}。`, { floor: messageId, side });
  try {
    const transport = await createTtsTransport(messageId, { single: false, side });
    if (transport) await runTtsTransport(transport);
  } catch (error) {
    if (isAbortError(error)) return;
    setTtsStatus(messageId, safeError(error), 'error');
    toast('error', safeError(error));
  }
}

/**
 * The paragraphs of this floor that have any audio at all, on one side: read off the store, whatever
 * reading the audio was made from. Taken before an analysis moves the labels.
 *
 * This used to be asked of the floor as the reading saw it — which paragraph's sentences a recording
 * matched — and after a reload the reading saw no analysis at all, matched nothing, and a re-analysis
 * went on to remake nothing: 「之前没有生成过音频」 on a floor full of audio.
 */
async function ttsRecordedLines(messageId, side, settings = runtime.settings) {
  try {
    const floor = await collectTtsFloor(messageId, settings, side);
    if (!floor) return new Set();
    return recordedLines(await ttsRecordings(floor), ttsUtterances(floor, settings));
  } catch {
    return new Set();
  }
}

/** Every side a floor is read in, with the one asked about first. */
function ttsSidesWith(side, settings = runtime.settings) {
  return [...new Set([side, ...ttsSides(settings)].filter(Boolean))];
}

/**
 * The paragraphs that had audio, each looked at by time: audio made before its sentences' reading was
 * asked for is made again from that reading, audio made after it is kept.
 *
 * A paragraph no analysis touches — narration the reading does not label — keeps its audio: nothing
 * it is made of has moved. Failures are reported and do not stop the rest; the analysis itself landed,
 * and a paragraph that could not be made now is made when it is played.
 */
async function remakeTtsLines(messageId, side, heard) {
  const summary = { made: 0, kept: 0, failed: 0 };
  if (!heard?.size) return summary;
  const settings = runtime.settings;
  const prepared = await ttsPrepared(messageId, side, { fresh: true });
  const tts = ttsSettings(settings);
  const { floor } = prepared;
  const units = ttsUnitsOf(tts, prepared.items).filter(target => target.items.some(item => heard.has(item.segment.lineId)));
  if (!units.length) return summary;
  for (const target of units) ttsStep(floor, `record:${target.unit}`, { state: 'pending', label: ttsUnitLabel(target.unit) });
  await runInLanes(units, Math.max(1, Number(tts.fish.concurrency) || 1), async (target, index) => {
    const covered = await Promise.all(target.items.map(item => findTtsEntry(floor, item, settings)));
    if (covered.every(Boolean)) {
      summary.kept += 1;
      ttsStep(floor, `record:${target.unit}`, { state: 'done', detail: unitAnalyzedAt(target.items) ? '音频是这次分析之后做的，照用' : '这段不受分析影响，音频照用' });
      return;
    }
    try {
      const { cached } = await ensureTtsRecording(floor, target.unit, target.items, settings,
        text => setTtsStatus(messageId, units.length > 1 ? `${text}（${index + 1}/${units.length}）` : text, 'busy'),
        (id, patch) => ttsStep(floor, id, patch));
      if (cached) summary.kept += 1;
      else summary.made += 1;
    } catch (error) {
      if (isAbortError(error)) throw error;
      summary.failed += 1;
      ttsStep(floor, `record:${target.unit}`, { state: 'error', detail: safeError(error) });
    }
  });
  reportTtsFish(floor);
  return summary;
}

/** What remaking a floor after an analysis came to, in the words the floor bar and the toast use. */
function describeTtsRemake(summary) {
  if (!summary || (!summary.made && !summary.kept && !summary.failed)) return '这一楼之前没有生成过音频，按播放时按新分析生成';
  const parts = [];
  if (summary.made) parts.push(`${summary.made} 段音频已按新分析重做`);
  if (summary.kept) parts.push(`${summary.kept} 段不受影响，照用`);
  if (summary.failed) parts.push(`${summary.failed} 段没做成，播放时会再做`);
  return parts.join('，');
}

/** Remakes the audio of every side of a floor that had any, after its reading changed. */
async function remakeTtsSides(messageId, heard) {
  const total = { made: 0, kept: 0, failed: 0 };
  for (const [side, lines] of heard) {
    const summary = await remakeTtsLines(messageId, side, lines);
    total.made += summary.made;
    total.kept += summary.kept;
    total.failed += summary.failed;
  }
  return total;
}

/** Where a floor was being read when an analysis stopped it, to pick up from afterwards. */
function ttsResumePoint(messageId) {
  const transport = runtime.tts.transport;
  if (!transport || transport.messageId !== Number(messageId) || transport.generateOnly) return null;
  if (!['playing', 'loading'].includes(transport.state)) return null;
  const item = transport.items[transport.index];
  return item ? { messageId: transport.messageId, side: transport.side, lineId: item.segment.lineId } : null;
}

/**
 * The floor read on from the paragraph it was stopped at, once the audio of the new reading is made.
 * Only a reading that was playing is picked up again, and only when nothing else started meanwhile.
 */
async function resumeTtsReading(point) {
  if (!point || runtime.tts.transport || !ttsSettings().playAfterGenerate) return;
  try {
    const prepared = await ttsPrepared(point.messageId, point.side);
    const first = prepared.items.find(item => item.segment.lineId === point.lineId) ?? prepared.items[0];
    if (!first || runtime.tts.transport) return;
    const transport = await createTtsTransport(point.messageId, { single: false, fromUtterance: first.segment.id, side: point.side });
    if (transport) await runTtsTransport(transport);
  } catch (error) {
    if (!isAbortError(error)) setTtsStatus(point.messageId, safeError(error), 'error');
  }
}

/**
 * Throws away the floor's reading and asks the model again, every sentence from scratch — and then
 * makes the audio again, without a second click.
 *
 * Every paragraph that had audio is looked at by time: made before this reading was asked for, it was
 * made from the reading being thrown away, and it is made again from the new one; made after, it
 * stays. A floor nobody generated stays ungenerated until it is played. A reading that was playing
 * picks up where it was.
 */
async function reanalyzeTtsFloor(messageId, side = null) {
  const settings = runtime.settings;
  requireClosedFloor(messageId);
  const which = side ?? primaryTtsSide(settings);
  const floor = await collectTtsFloor(messageId, settings, which);
  if (!floor) throw new Error('这一楼没有可朗读的文字。');
  // Noted before the labels move, on every side the floor is read in: a reading of one language is
  // carried over to the other, and the other side's audio was made from it too.
  const heard = new Map();
  for (const each of ttsSidesWith(which, settings)) heard.set(each, await ttsRecordedLines(messageId, each, settings));
  const resume = ttsResumePoint(messageId);
  forgetTtsItems(messageId);
  runtime.tts.analysis.delete(ttsLabelKey(floor));
  // A floor the reader once chose to hear plain is being asked about now.
  runtime.tts.plainFloors.delete(ttsLabelKey(floor));
  beginTtsProgress(floor);
  try {
    await prepareTtsSegments(floor, settings, {
      force: true,
      // The plain reading has nothing to redo; asked by hand, it gets the simple reading for this floor.
      analyze: ttsSettings(settings).mode === 'off' ? 'simple' : null,
      onStatus: text => setTtsStatus(messageId, text, text ? 'busy' : 'idle'),
      onStep: (id, patch) => ttsStep(floor, id, patch),
    });
  } finally {
    setTtsStatus(messageId, '', 'idle');
    scheduleTtsDecorate(messageId, { force: true });
  }
  const summary = await remakeTtsSides(messageId, heard);
  floor.remade = summary.made;
  floor.remake = summary;
  setTtsStatus(messageId, summary.made || summary.failed ? `重新分析完了，${describeTtsRemake(summary)}` : '', 'idle');
  notifyTtsPanels();
  void resumeTtsReading(resume);
  return floor;
}

/** What the floor is labelled as right now, whatever it came from: the model, the translation, or the split. */
function currentTtsLabels(prepared) {
  return new Map(prepared.segments.map(segment => [segment.id, {
    type: segment.type,
    // A name the reader set, or the story marked, is settled: the correction is told not to move it,
    // and it would be pinned over whatever came back anyway.
    ...(segment.speaker ? { speaker: segment.speaker, ...(['manual', 'tag'].includes(segment.speakerSource) ? { manual: true } : {}) } : {}),
    ...(segment.emotion ? { emotion: segment.emotion, intensity: segment.intensity ?? 1 } : {}),
    ...(segment.voice?.tone ? { tone: segment.voice.tone } : {}),
  }]));
}

/**
 * Ask again about what is already labelled, with what the reader thinks of it.
 *
 * The model is handed last time's answer and the complaint, not the job of reading the floor again,
 * and only the sentences in scope: fixing one line is one short request. Sentences the complaint does
 * not touch come back as a bare id and keep what they had — their label, their voice, and the moment
 * they were read. The ones it changed carry the moment of this request, so their old audio is made
 * again from the correction by itself, and nothing else of the floor's is.
 */
async function refineTtsAnalysis(messageId, { side = null, utteranceId = null, feedback = '' } = {}) {
  const settings = runtime.settings;
  const which = side ?? primaryTtsSide(settings);
  const prepared = await ttsPrepared(messageId, which);
  const { floor } = prepared;
  const heard = new Map();
  for (const each of ttsSidesWith(which, settings)) heard.set(each, await ttsRecordedLines(messageId, each, settings));
  const utterances = ttsUtterances(floor, settings);
  const base = currentTtsLabels(prepared);
  const scope = utteranceId === null ? utterances : utterances.filter(item => item.id === Number(utteranceId));
  if (!scope.length) throw new Error('这一句不在当前的朗读范围里。');
  const key = ttsLabelKey(floor);
  const known = runtime.tts.analysis.get(key);
  // The floor keeps the depth it was read at; a correction is not a shallower reading, and it goes to
  // the connection that reading goes to.
  const depth = known?.depth === 'deep' || (!known && prepared.depth === 'deep') ? 'deep' : 'simple';
  const request = ttsRequestSettings(settings, depth);
  const context = getContext();
  const messages = buildRefineAnalysisMessages(scope, {
    roster: ttsKnownNames(settings),
    characterName: context.name2 ?? '',
    userName: context.name1 ?? '',
    translations: floor.references,
    styles: ttsStyles(settings),
    current: base,
    feedback,
  });
  const started = Date.now();
  // The moment of asking, which every sentence this correction changes will carry.
  const askedAt = ttsClock();
  const raw = await requestSubModelRaw(messages, request, undefined);
  const parsed = parseVoiceAnalysis(raw, scope, { hints: base });
  const answered = [...parsed.labels.keys()].filter(id => !parsed.keptIds.has(id));
  recordDiagnostic(parsed.labels.size ? 'info' : 'warn', 'tts.refine', parsed.labels.size
    ? `按你的意见改了第 ${messageId} 楼的 ${answered.length} 句标注（${scope.length} 句在范围里，${parsed.reused} 句原样保留），用时 ${((Date.now() - started) / 1000).toFixed(1)} 秒。`
    : `副模型没有返回可用的修正，第 ${messageId} 楼的标注保持原样。`, {
    floor: floor.floorId,
    scope: utteranceId === null ? 'floor' : `utterance:${utteranceId}`,
    feedback: String(feedback ?? '').slice(0, 200),
    sentences: scope.length,
    changed: answered.length,
    depth,
    apiMode: request.apiMode,
    endpoint: describeChannelEndpoint(request),
  }, raw, { fullRequest: messages, floor: messageId });
  if (!parsed.labels.size) throw new Error('副模型没有返回可用的修正，标注保持原样。');
  const labels = new Map(known?.labels ?? base);
  const voices = new Map(known?.voices ?? []);
  for (const id of answered) {
    // What the request said about the reader's own naming was for the model; the label keeps the rest,
    // and the language the reading had found, which the correction is not asked about.
    const { manual, ...label } = parsed.labels.get(id);
    const lang = labels.get(id)?.lang;
    labels.set(id, { ...label, ...(lang && !label.lang ? { lang } : {}), at: askedAt });
    // A sentence the model rewrote without a voice of its own loses the old one: it belonged to the old mood.
    if (!parsed.voices.has(id)) voices.delete(id);
  }
  for (const [id, voice] of parsed.voices) voices.set(id, voice);
  // A sentence that came back as it went in keeps its label, its voice and its moment untouched.
  runtime.tts.analysis.set(key, { labels, voices, depth });
  // Kept where the reading looks for it next time, so a reload does not undo the correction.
  await ttsStore().putAnalysis({
    key: await analysisCacheKey({ utterances, source: 'model', depth, side: floor.side }),
    floorId: floor.floorId,
    version: floor.version,
    depth,
    labels: [...labels],
    voices: [...voices],
  }).catch(() => {});
  const resume = ttsResumePoint(messageId);
  dropPreparedFloors(messageId);
  forgetTtsItems(messageId);
  scheduleTtsDecorate(messageId, { force: true });
  // What was changed is heard changed without a second click: its paragraphs' audio predates the
  // correction and is made again; every other paragraph keeps what it had.
  const summary = await remakeTtsSides(messageId, heard);
  notifyTtsPanels();
  void resumeTtsReading(resume);
  return { remade: summary.made, remake: summary, changed: answered.length, kept: parsed.reused, sentences: scope.length };
}

/**
 * What to do about a floor that already has an analysis: build on it, or start over.
 *
 * The choice only exists the second time — a floor nobody has analysed has nothing to build on.
 */
async function askTtsRefine({ messageId, sentence = null }) {
  const css = await loadPanelCss();
  return new Promise(resolve => {
    document.getElementById(`${MODULE_ID}-refine`)?.remove();
    const host = document.createElement('div');
    host.id = `${MODULE_ID}-refine`;
    host.style.cssText = `${SHADOW_HOST_BOX}z-index:2147483000;`;
    keepTypingInside(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    const card = document.createElement('div');
    const short = sentence ? miniShort(sentence.text, 18) : '';
    card.innerHTML = `<div class="jy-ask" role="dialog" aria-modal="true" aria-label="重新分析">
  <h3>重新分析第 ${messageId} 楼</h3>
  <p>${sentence ? '下面先选改哪里：你打开的那一句，还是整楼。' : '这次改的是<strong>整楼</strong>。想只改一句，先在句子列表里点那一句的「详细」，再回来点重新分析。'}按你的意见改已有的分析：副模型不用再通读一遍正文，只看上次的结果和你的意见，快得多。也可以丢掉重来。说话人也可以不问副模型，在详细页的下拉框里直接改。</p>
  <div class="jy-ask-scope" data-jy-refine-scope${sentence ? '' : ' hidden'}>
    <label><input type="radio" name="jy-refine-scope" value="sentence" checked>只改这一句${short ? `：${short}` : ''}</label>
    <label><input type="radio" name="jy-refine-scope" value="floor"${sentence ? '' : ' checked'}>整楼都改</label>
  </div>
  <label class="jy-ask-field"><span>哪里不对（可以不写）</span><textarea data-jy-refine-feedback rows="2" placeholder="比如：说话人不对，这句是樱井说的；情绪不够饱满；语气太平"></textarea></label>
  <div class="jy-ask-chips" data-jy-refine-chips>
    <button type="button" data-chip="说话人不对">说话人不对</button>
    <button type="button" data-chip="情绪不够饱满">情绪不够</button>
    <button type="button" data-chip="情绪太夸张了">情绪太过</button>
    <button type="button" data-chip="语气太平，没起伏">语气太平</button>
    <button type="button" data-chip="非语言声音太多了">声音太多</button>
  </div>
  <div class="jy-ask-actions"><button type="button" class="is-primary" data-jy-refine="refine">按意见改</button><button type="button" data-jy-refine="fresh">丢掉重来（整楼）</button><button type="button" data-jy-refine="cancel">取消</button></div>
</div>`;
    if (!sentence) card.querySelector('[data-jy-refine-scope] label')?.remove();
    shadow.append(style);
    let done = false;
    const finish = choice => {
      if (done) return;
      done = true;
      const scope = shadow.querySelector('[name="jy-refine-scope"]:checked')?.value ?? 'floor';
      const feedback = shadow.querySelector('[data-jy-refine-feedback]')?.value.trim() ?? '';
      host.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve({ choice, scope: sentence ? scope : 'floor', feedback });
    };
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); finish('cancel'); }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(host);
    const { shell } = ttsDialogShell(shadow, card, () => finish('cancel'));
    shell.addEventListener('click', event => {
      const chip = event.target.closest('[data-chip]');
      if (chip) {
        const box = shadow.querySelector('[data-jy-refine-feedback]');
        box.value = box.value.trim() ? `${box.value.trim()}；${chip.dataset.chip}` : chip.dataset.chip;
        box.focus();
        return;
      }
      const button = event.target.closest('[data-jy-refine]');
      if (button) finish(button.dataset.jyRefine);
    });
    shadow.querySelector('[data-jy-refine-feedback]')?.focus();
  });
}

/**
 * Keeps the reader's version of one sentence and makes its audio.
 *
 * The text is sent exactly as written, cues and all; the speed and volume are the request's prosody.
 * The recording is remembered on the override, so playing the sentence — alone or as part of the
 * floor — finds this take rather than the automatic one.
 */
async function saveTtsOverride(messageId, utteranceId, { text, speed, volume }, side = null) {
  const prepared = await ttsPrepared(messageId, side);
  const segment = prepared.segments.find(item => item.id === utteranceId);
  if (!segment) throw new Error('这一句已经变了。');
  const cleaned = String(text ?? '').trim();
  if (!cleaned) throw new Error('发给 Fish 的内容不能为空。');
  const speedValue = Number(speed);
  const volumeValue = Number(volume);
  // A name the reader set on this sentence stays with it through a rewrite of its words.
  const named = (await ttsOverrides(prepared.floor)).get(utteranceId)?.speaker;
  const record = {
    ...(named ? { speaker: named } : {}),
    floorId: prepared.floor.floorId, version: prepared.floor.version, segmentId: utteranceId, text: cleaned,
    ...(Number.isFinite(speedValue) ? { speed: Math.min(2, Math.max(0.5, speedValue)) } : {}),
    ...(Number.isFinite(volumeValue) ? { volume: Math.min(20, Math.max(-20, volumeValue)) } : {}),
  };
  await ttsStore().putOverride(record);
  forgetTtsItems(messageId);
  const fresh = await ttsPrepared(messageId, prepared.floor.side, { fresh: true });
  const item = fresh.items.find(candidate => candidate.segment.id === utteranceId)
    ?? { segment, voiceId: resolveSegmentVoice(segment, ttsVoiceConfig(fresh.settings)), override: { text: cleaned, speed: record.speed, volume: record.volume } };
  const { record: made } = await ensureTtsRecording(fresh.floor, `sentence:${utteranceId}`, [item], fresh.settings,
    text => setTtsStatus(messageId, text, 'busy'), (id, patch) => ttsStep(fresh.floor, id, patch));
  await ttsStore().putOverride({ ...record, recordKey: made.key });
  forgetTtsItems(messageId);
  setTtsStatus(messageId, '', 'idle');
  return made;
}

/**
 * The reader names who says one sentence.
 *
 * The name is an annotation, kept beside the sentence's other overrides; the words do not change and
 * nothing is asked of the model. The take made under the old name is let go, so the next play reads
 * the sentence in the voice the new name has. An empty name hands the sentence back to the engine.
 */
async function saveTtsSpeaker(messageId, utteranceId, speaker, side = null) {
  const prepared = await ttsPrepared(messageId, side);
  const segment = prepared.segments.find(item => item.id === utteranceId);
  if (!segment) throw new Error('这一句已经变了。');
  const name = String(speaker ?? '').trim().slice(0, 60);
  const { floor } = prepared;
  const existing = (await ttsOverrides(floor)).get(utteranceId) ?? null;
  const keepsWords = Boolean(existing && (existing.text || existing.speed !== undefined || existing.volume !== undefined));
  if (name) {
    await ttsStore().putOverride({ ...(existing ?? {}), floorId: floor.floorId, version: floor.version, segmentId: utteranceId, speaker: name });
  } else if (keepsWords) {
    const { speaker: dropped, ...rest } = existing;
    void dropped;
    await ttsStore().putOverride(rest);
  } else if (existing) {
    await ttsStore().deleteOverride(floor.floorId, floor.version, utteranceId);
  }
  const affected = prepared.items.filter(item => item.segment.id === utteranceId);
  if (affected.length) await dropTtsRecordings(prepared, affected);
  forgetTtsItems(messageId);
  scheduleTtsDecorate(messageId, { force: true });
  return name;
}

async function clearTtsOverride(messageId, utteranceId, side = null) {
  const prepared = await ttsPrepared(messageId, side);
  await ttsStore().deleteOverride(prepared.floor.floorId, prepared.floor.version, utteranceId);
  forgetTtsItems(messageId);
}

// ---------------------------------------------------------------------------------------------
// Reading aloud: buttons on the rendered floor.
// ---------------------------------------------------------------------------------------------

function ttsMessageText(messageId) {
  return document.querySelector(`#chat .mes[mesid="${messageId}"] .mes_text`);
}

function clearTtsDecoration(root) {
  if (!root) return;
  for (const node of root.querySelectorAll('.jy-tts-line, .jy-tts-play, .jy-tts-edit, .jy-tts-bar')) node.remove();
  // Inserting the buttons split text nodes; putting them back keeps the floor exactly as the host drew it.
  root.normalize();
  delete root.dataset.jyTts;
}

function isLastMeaningfulChild(node) {
  for (let next = node.nextSibling; next; next = next.nextSibling) {
    if (next.nodeType !== Node.TEXT_NODE || next.data.trim()) return false;
  }
  return true;
}

// The button goes right after the utterance. When the utterance ends where an inline wrapper ends —
// the host's <q> around 「…」 — it goes after the wrapper, so it is not painted as part of the quote.
function insertAfterRange(range, element, root) {
  const container = range.endContainer;
  if (container.nodeType === Node.TEXT_NODE && range.endOffset >= container.data.length) {
    let node = container;
    while (node.parentNode && node.parentNode !== root && TTS_INLINE_WRAPPERS.has(node.parentNode.nodeName) && isLastMeaningfulChild(node)) {
      node = node.parentNode;
    }
    node.parentNode.insertBefore(element, node.nextSibling);
    return;
  }
  const marker = range.cloneRange();
  marker.collapse(false);
  marker.insertNode(element);
}

function makeTtsPlayButton(messageId, segment, side) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'jy-tts-play';
  button.dataset.jyTtsAction = 'play';
  button.dataset.jyTtsMes = String(messageId);
  button.dataset.jyTtsUtt = String(segment.id);
  button.dataset.jyTtsSide = side;
  button.dataset.jyTtsType = segment.type;
  button.setAttribute('contenteditable', 'false');
  const label = `${segment.type === 'narration' ? '朗读这句旁白' : `朗读这句对白${segment.speaker ? `（${segment.speaker}）` : ''}`}${side === 'source' ? '（原文）' : ''}`;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = TTS_ICON_PLAY;
  return button;
}

// Beside every play button, the way in to what the sentence was read as. It opens the floating window's
// reading panel on that sentence, where the cues can be seen, edited and re-made.
function makeTtsEditButton(messageId, segment, side) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'jy-tts-edit';
  button.dataset.jyTtsAction = 'inspect';
  button.dataset.jyTtsMes = String(messageId);
  button.dataset.jyTtsUtt = String(segment.id);
  button.dataset.jyTtsSide = side;
  button.setAttribute('contenteditable', 'false');
  const label = '查看这句的情绪分析，可修改发给 Fish 的内容';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = TTS_ICON_EDIT;
  return button;
}

/**
 * The two buttons at the end of a paragraph: read from here, and make this paragraph again.
 *
 * A paragraph is what one Fish request covers, so the first costs nothing extra, and the second is
 * the answer to Fish reading the same words differently every time — the reader re-rolls a paragraph
 * where they are reading it, without opening the floating window.
 */
function makeTtsLineTools(messageId, line, side) {
  const box = document.createElement('span');
  box.className = 'jy-tts-line';
  box.dataset.jyTtsLine = String(line.lineId);
  box.dataset.jyTtsSide = side;
  box.setAttribute('contenteditable', 'false');
  const suffix = side === 'source' ? '（原文）' : '';
  const pick = document.createElement('label');
  pick.className = 'jy-tts-pick-box';
  pick.title = '选中这一段，一起缓存到本地';
  pick.setAttribute('contenteditable', 'false');
  const tick = document.createElement('input');
  tick.type = 'checkbox';
  tick.dataset.jyTtsPickLine = String(line.lineId);
  tick.dataset.jyTtsSide = side;
  pick.appendChild(tick);
  box.append(
    pick,
    makeTtsLineButton(messageId, line, side, {
      action: 'play-line', className: 'jy-tts-line-play', icon: TTS_ICON_PLAY, text: '播放',
      label: `从这一段读起（${line.ids.length} 句）${suffix}`,
    }),
    makeTtsLineButton(messageId, line, side, {
      action: 'regen-line', className: 'jy-tts-line-regen', icon: TTS_ICON_REDO, text: '重新生成',
      label: `丢掉这一段的音频，再向 Fish 要一次${suffix}`,
    }),
  );
  return box;
}

function makeTtsLineButton(messageId, line, side, { action, className, icon, text, label }) {
  const button = document.createElement('button');
  button.type = 'button';
  // The shared class keeps the busy, playing and beautify styles the sentence buttons already have.
  button.className = `jy-tts-play ${className}`;
  button.dataset.jyTtsAction = action;
  button.dataset.jyTtsMes = String(messageId);
  button.dataset.jyTtsLine = String(line.lineId);
  button.dataset.jyTtsSide = side;
  button.setAttribute('contenteditable', 'false');
  button.setAttribute('aria-label', label);
  button.title = label;
  const caption = document.createElement('span');
  caption.textContent = text;
  button.innerHTML = icon;
  button.appendChild(caption);
  return button;
}

/**
 * The paragraphs of one floor, in reading order: every sentence that will be read, grouped by the
 * paragraph it belongs to. The last id is where the paragraph's buttons hang, the first is where
 * reading starts. With only dialogue read, a paragraph's narration is not in the list, so the buttons
 * sit at the end of what will actually be heard rather than at the end of the printed paragraph.
 */
function planTtsLineButtons(segments) {
  const lines = new Map();
  for (const segment of Array.isArray(segments) ? segments : []) {
    const known = lines.get(segment.lineId);
    if (known) known.ids.push(segment.id);
    else lines.set(segment.lineId, { lineId: segment.lineId, ids: [segment.id] });
  }
  return [...lines.values()];
}

// Which built-in beautify a rendered floor wears. The bar sits after the cards rather than inside one,
// so it is told the style instead of inheriting it.
function readingStyleOf(root) {
  for (const style of ['cute', 'minimal', 'fold']) {
    if (root.querySelector(`.jy-reading-${style}, .custom-jy-reading-${style}`)) return style;
  }
  return '';
}

function makeTtsBar(messageId, tts, count, readingStyle = '', sides = [tts.side]) {
  const bar = document.createElement('div');
  bar.className = 'jy-tts-bar';
  bar.dataset.jyTtsMes = String(messageId);
  if (readingStyle) bar.dataset.jyReading = readingStyle;
  bar.setAttribute('contenteditable', 'false');
  const control = (action, className, html, hidden = false, side = null) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.jyTtsAction = action;
    button.dataset.jyTtsMes = String(messageId);
    if (side) button.dataset.jyTtsSide = side;
    button.hidden = hidden;
    button.innerHTML = html;
    return button;
  };
  const both = sides.length > 1;
  // One small button per side read; its label follows the reading (see ttsBarLabel). Progress, the
  // other paragraph, stop and saving live in the floating window.
  const plays = sides.map(side => {
    const button = control('play-floor', 'jy-tts-bar-play', ttsBarLabel('idle', both ? side : null), false, side);
    button.title = `${side === 'source' ? '读原文' : '读译文'} · ${TTS_MODE_LABELS[tts.mode]}模式 · ${TTS_RANGE_LABELS[tts.range]} · ${count} 句`;
    return button;
  });
  // Choosing happens here rather than in the floating window: reading the original, the window's list
  // is in the original's language, and the translation the reader can actually read is in the chat.
  const pick = control('pick', 'jy-tts-bar-pick', '<span>缓存</span>', false, sides[0]);
  pick.title = '勾选几段对白，一起缓存到本地';
  const picked = document.createElement('span');
  picked.className = 'jy-tts-bar-pick-count';
  picked.dataset.jyTtsPickCount = '';
  picked.hidden = true;
  const save = control('pick-save', 'jy-tts-bar-pick-save', '<span>缓存所选</span>', true, sides[0]);
  const all = control('pick-all', 'jy-tts-bar-pick-all', '<span>全选</span>', true, sides[0]);
  const exit = control('pick-exit', 'jy-tts-bar-pick-exit', '<span>退出选择</span>', true);
  bar.append(...plays, pick, picked, save, all, exit);
  return bar;
}

/** What a floor's play button says: the state of the reading on it, and which side when both are read. */
function ttsBarLabel(state, side = null) {
  const which = side === 'source' ? '原文' : side === 'translation' ? '译文' : '';
  if (state === 'playing') return `${TTS_ICON_PAUSE}<span>暂停</span>`;
  if (state === 'paused') return `${TTS_ICON_PLAY}<span>继续</span>`;
  if (state === 'busy') return `${TTS_ICON_STOP}<span>准备中</span>`;
  return `${TTS_ICON_PLAY}<span>朗读${which}</span>`;
}

/**
 * Puts a play button after every readable utterance of one rendered floor, and a bar under it.
 *
 * Buttons are placed from the stored text, found again in the rendered one, so what is clicked is
 * exactly what gets read. Only the DOM changes; a floor re-rendered by the host simply loses them and
 * gets them back on the next pass.
 */
async function decorateTtsMessage(messageId, { force = false } = {}) {
  if (typeof document === 'undefined') return;
  const root = ttsMessageText(messageId);
  if (!root || root.querySelector('textarea')) return;
  const settings = runtime.settings;
  const tts = ttsSettings(settings);
  if (!runtime.initialized || !tts.enabled) {
    if (root.dataset.jyTts) clearTtsDecoration(root);
    return;
  }
  const context = getContext();
  const message = context.chat?.[messageId];
  const inflight = message ? runtime.inflight.get(`${getCurrentChatId(context)}|${messageId}|${Number(message.swipe_id ?? 0)}`) : null;
  if (inflight) {
    // A floor being translated is rewritten several times; it gets its buttons once the text settles.
    inflight.promise.catch(() => {}).finally(() => scheduleTtsDecorate(messageId, { force: true }));
    return;
  }
  // The same text, the same settings and a bar still in place: nothing to do, and no snapshot taken.
  const muteKey = `${tts.dialogueFallback}|${ttsVoicesFor(settings).filter(row => row.mute).map(row => row.name).join(',')}`;
  const cheapKey = `${Number(message?.swipe_id ?? 0)}|${ttsSides(settings).join('+')}|${tts.mode}|${tts.range}|${tts.quotePairs.join('')}|${tts.skipPairs.join('')}|${floorButtonMode(settings)}|${muteKey}`;
  const seen = runtime.tts.mesSeen.get(messageId);
  if (!force && seen && seen.mes === message?.mes && seen.key === cheapKey && root.dataset.jyTts && root.querySelector(':scope > .jy-tts-bar')) return;
  const floors = [];
  for (const side of ttsSides(settings)) {
    const floor = await collectTtsFloor(messageId, settings, side);
    if (floor) floors.push(floor);
  }
  if (ttsMessageText(messageId) !== root) return;
  if (!floors.length) {
    if (root.dataset.jyTts) clearTtsDecoration(root);
    runtime.tts.mesSeen.set(messageId, { mes: message?.mes ?? '', key: cheapKey });
    return;
  }
  for (const floor of floors) {
    // A floor whose text changed still has recordings and labels of the old text in the store. They can
    // never be played again, so they go the first time the new text is seen.
    if (runtime.tts.pruned.get(floor.floorId) !== floor.version) {
      runtime.tts.pruned.set(floor.floorId, floor.version);
      void ttsStore().pruneFloor(floor.floorId, floor.version).catch(() => {});
      for (const key of [...runtime.tts.recordings.keys(), ...runtime.tts.overrides.keys()]) {
        if (key.startsWith(`${floor.floorId}|`) && key !== ttsLabelKey(floor)) {
          runtime.tts.recordings.delete(key);
          runtime.tts.overrides.delete(key);
        }
      }
      const prepared = runtime.tts.floors.get(ttsPreparedKey(messageId, floor.side));
      if (prepared && prepared.floor.version !== floor.version) runtime.tts.floors.delete(ttsPreparedKey(messageId, floor.side));
    }
  }
  const analyses = floors.map(floor => runtime.tts.analysis.get(ttsLabelKey(floor)) ?? null);
  const signature = `${floors.map((floor, index) => `${floor.side}|${floor.version}|${analyses[index] ? analyses[index].depth : 'plain'}`).join('#')}|${cheapKey}`;
  if (!force && root.dataset.jyTts === signature && root.querySelector(':scope > .jy-tts-bar')) {
    runtime.tts.mesSeen.set(messageId, { mes: message?.mes ?? '', key: cheapKey });
    return;
  }

  clearTtsDecoration(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => (node.parentElement?.closest('.jy-tts-line, .jy-tts-play, .jy-tts-edit, .jy-tts-bar, script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const nodeTexts = nodes.map(node => node.data);
  // Ranges are made before anything is inserted; they are live, so the insertions below move them along.
  const ranges = new Map();
  const buttons = [];
  const lineButtons = [];
  let visibleTotal = 0;
  const unplaced = [];
  const unplacedLines = [];
  floors.forEach((floor, index) => {
    const utterances = ttsUtterances(floor, settings);
    const labels = analyses[index]?.labels ?? annotationReading(utterances, floor.annotations).labels;
    const segments = buildSegments(utterances, labels, { knownNames: ttsKnownNames(settings), voices: analyses[index]?.voices ?? null });
    const visible = audibleSegments(segments, tts.range, ttsVoiceConfig(settings));
    visibleTotal += visible.length;
    const found = locateAnchors(nodeTexts, floor.lines, utterances.map(item => ({ id: item.id, lineId: item.lineId, text: item.anchor })));
    for (const utterance of utterances) {
      const hit = found.get(utterance.id);
      if (!hit) continue;
      const range = document.createRange();
      range.setStart(nodes[hit.start.node], hit.start.offset);
      range.setEnd(nodes[hit.end.node], hit.end.offset);
      ranges.set(`${floor.side}:${utterance.id}`, range);
    }
    for (const segment of visible) {
      const range = ranges.get(`${floor.side}:${segment.id}`);
      if (range) buttons.push({ range, segment, side: floor.side });
      else unplaced.push({ side: floor.side, id: segment.id, text: segment.text.slice(0, 24) });
    }
    // A paragraph hangs its buttons off whichever of its sentences ends last in the rendered floor,
    // which is not always the last one in reading order once a beautify has moved things around.
    for (const line of planTtsLineButtons(visible)) {
      let last = null;
      for (const id of line.ids) {
        const range = ranges.get(`${floor.side}:${id}`);
        if (range && (!last || range.compareBoundaryPoints(Range.END_TO_END, last) > 0)) last = range;
      }
      if (last) lineButtons.push({ range: last, line, side: floor.side });
      else unplacedLines.push({ side: floor.side, lineId: line.lineId });
    }
  });
  // Later ranges first, so an insertion never sits between an earlier range and its own end. Where a
  // paragraph ends on its own last sentence the two share a point, and since each insertion goes in
  // front of the one before it, the paragraph's pair is placed first to end up after the sentence's.
  const placements = [...lineButtons, ...buttons];
  placements.sort((left, right) => right.range.compareBoundaryPoints(Range.END_TO_END, left.range));
  const buttonMode = floorButtonMode(settings);
  for (const placement of placements) {
    if (buttonMode === 'off') break;
    if (placement.line) {
      insertAfterRange(placement.range, makeTtsLineTools(messageId, placement.line, placement.side), root);
    } else if (buttonMode === 'sentence') {
      const play = makeTtsPlayButton(messageId, placement.segment, placement.side);
      insertAfterRange(placement.range, play, root);
      play.after(makeTtsEditButton(messageId, placement.segment, placement.side));
    }
  }
  const bar = makeTtsBar(messageId, tts, visibleTotal, readingStyleOf(root), floors.map(floor => floor.side));
  // No buttons in the floor: the row is still there, hidden, so a redraw of this floor is still noticed.
  if (floorButtonMode(settings) === 'off') bar.hidden = true;
  root.insertBefore(bar, root.firstChild);
  root.dataset.jyTts = signature;
  runtime.tts.mesSeen.set(messageId, { mes: message?.mes ?? '', key: cheapKey });
  runtime.tts.ranges.set(messageId, ranges);
  const status = runtime.tts.status.get(messageId);
  if (status && status.state === 'busy' && !ttsJobRunning(messageId)) runtime.tts.status.delete(messageId);
  else if (status) setTtsStatus(messageId, status.text, status.state);
  // A floor redrawn mid-sentence gets its highlight back on the new text.
  const highlighted = runtime.tts.highlighted;
  if (highlighted?.messageId === messageId && runtime.tts.transport?.messageId === messageId) {
    highlightTtsUtterance(messageId, highlighted.utteranceId, highlighted.side);
  }
  // Only a paragraph none of whose sentences could be located is worth telling the reader about: one
  // lost sentence still leaves the paragraph a button, and in the sentence mode the sentences matter too.
  const missing = buttonMode === 'sentence' ? unplaced.length : unplacedLines.length;
  const warnKey = `${floors.map(floor => floor.floorId).join('+')}|${signature}`;
  if (missing && buttonMode !== 'off' && !runtime.tts.anchorWarned.has(warnKey)) {
    runtime.tts.anchorWarned.add(warnKey);
    recordDiagnostic('warn', 'tts.anchors', `第 ${messageId} 楼有 ${missing} ${buttonMode === 'sentence' ? '句' : '段'}没在渲染后的楼层里找到位置，这几${buttonMode === 'sentence' ? '句' : '段'}后面没有按钮，「朗读」照常能读到。`, {
      floor: floors.map(floor => floor.floorId),
      readable: visibleTotal,
      placed: buttonMode === 'sentence' ? buttons.length : lineButtons.length,
      mode: buttonMode,
      sources: floors.map(floor => floor.source),
      unplaced: (buttonMode === 'sentence' ? unplaced : unplacedLines).slice(0, 5),
    });
  }
}

function scheduleTtsDecorate(messageId, { force = false, delay = 150 } = {}) {
  // Ordinary mode does nothing at all on a redraw, not even schedule a check.
  if (typeof document === 'undefined' || !Number.isInteger(Number(messageId)) || !ttsSettings().enabled) return;
  const id = Number(messageId);
  const timers = runtime.tts.timers;
  const previous = timers.get(id);
  if (previous) globalThis.clearTimeout(previous.timer);
  const timer = globalThis.setTimeout(() => {
    timers.delete(id);
    void decorateTtsMessage(id, { force: force || previous?.force }).catch(error => {
      console.warn(`[${APP_NAME}] 朗读按钮挂载失败。`, error);
    });
  }, delay);
  timers.set(id, { timer, force: force || previous?.force === true });
}

/**
 * Every floor on the page, the ones in view now and the last few at once, the rest when they scroll
 * into view. A long chat has hundreds of floors, and reading every one of them just to put buttons on
 * text nobody is looking at is what made the page stutter.
 */
function scheduleTtsDecorateAll(options = {}) {
  if (typeof document === 'undefined') return;
  const floors = [...document.querySelectorAll('#chat .mes[mesid]')];
  floors.forEach((element, index) => routeTtsDecorate(element, options, index >= floors.length - 3));
}

/**
 * One floor: now when it is on screen, near it, or among the last few, otherwise when it scrolls into
 * view. A pass that must redo the floor (force) is not downgraded by a plain one queued after it.
 */
function routeTtsDecorate(element, options = {}, last = false) {
  const id = Number(element.getAttribute('mesid'));
  const viewer = ttsViewer();
  const height = globalThis.innerHeight || 0;
  const rect = element.getBoundingClientRect?.();
  const near = !viewer || last || (rect && rect.bottom > -height && rect.top < height * 2);
  if (near) {
    scheduleTtsDecorate(id, options);
    return;
  }
  // Out of view: the observer calls when it comes in; a forced pass must still reach it then.
  if (element.dataset.jyTtsPending !== 'force') element.dataset.jyTtsPending = options.force ? 'force' : 'plain';
  viewer.observe(element);
}

function ttsViewer() {
  if (typeof IntersectionObserver !== 'function') return null;
  if (runtime.tts.viewer) return runtime.tts.viewer;
  runtime.tts.viewer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const element = entry.target;
      runtime.tts.viewer.unobserve(element);
      const force = element.dataset.jyTtsPending === 'force';
      delete element.dataset.jyTtsPending;
      if (ttsSettings().enabled) scheduleTtsDecorate(Number(element.getAttribute('mesid')), { force });
    }
  }, { rootMargin: '600px 0px' });
  return runtime.tts.viewer;
}

function clearAllTtsDecorations() {
  if (typeof document === 'undefined') return;
  const roots = new Set(document.querySelectorAll('#chat .mes_text[data-jy-tts]'));
  for (const element of document.querySelectorAll('#chat .jy-tts-bar, #chat .jy-tts-line, #chat .jy-tts-play, #chat .jy-tts-edit')) {
    const root = element.closest('.mes_text');
    if (root) roots.add(root);
  }
  for (const root of roots) clearTtsDecoration(root);
}

/**
 * Wires the floor buttons: one delegated click handler and one observer for re-rendered floors.
 *
 * The host rewrites a floor's HTML on edits, swipes and other extensions' updates, not all of which
 * announce themselves. The observer does not try to reason about mutations: a floor that has lost its
 * bar gets decorated again, and one that still has it is left alone, which also ignores our own inserts.
 */
function bindTtsDom() {
  // Nothing is attached to the chat while reading aloud is switched off.
  if (typeof document === 'undefined' || !runtime.initialized || !ttsSettings().enabled) return;
  if (!runtime.tts.clickCleanup) {
    const onClick = event => {
      const ticked = event.target instanceof Element ? event.target.closest('[data-jy-tts-pick-line]') : null;
      if (ticked?.closest('#chat')) {
        // A tick is its own business: it must not start reading the paragraph it sits beside.
        event.stopPropagation();
        syncTtsPicking(Number(ticked.closest('.mes[mesid]')?.getAttribute('mesid')));
        return;
      }
      const target = event.target instanceof Element ? event.target.closest('[data-jy-tts-action]') : null;
      if (!target || !target.closest('#chat')) return;
      event.preventDefault();
      event.stopPropagation();
      const messageId = Number(target.dataset.jyTtsMes);
      const action = target.dataset.jyTtsAction;
      const side = target.dataset.jyTtsSide || null;
      if (action === 'stop') stopTts(messageId);
      else if (action === 'pause') toggleTtsPause();
      else if (action === 'play-floor' && runtime.tts.stream && !runtime.tts.stream.done && runtime.tts.stream.messageId === messageId) {
        // Read while it is written: pause, carry on, or stop it while it is still getting ready.
        const stream = runtime.tts.stream;
        if (stream.state === 'paused') stream.resume();
        else if (stream.state === 'speaking') stream.pause();
        else stream.cancel();
      }
      else if (action === 'play-floor') {
        const transport = runtime.tts.transport;
        const here = transport?.messageId === messageId && (!side || transport.side === side);
        if (target.dataset.state === 'busy' || (here && transport.state === 'loading')) stopTts(messageId);
        else if (here && transport.state === 'playing') pauseTts();
        else if (here && transport.state === 'paused') resumeTts();
        else void playTtsFloor(messageId, side);
      }
      else if (action === 'panel') void openTtsPanel(messageId, null, side);
      else if (action === 'pick' || action === 'pick-exit') setTtsPicking(messageId, action === 'pick' ? (side ?? primaryTtsSide()) : null);
      else if (action === 'pick-all') {
        const root = ttsMessageText(messageId);
        const boxes = [...(root?.querySelectorAll('[data-jy-tts-pick-line]') ?? [])].filter(box => box.dataset.jyTtsSide === (side ?? primaryTtsSide()));
        const wanted = boxes.some(box => !box.checked);
        for (const box of boxes) box.checked = wanted;
        syncTtsPicking(messageId);
      } else if (action === 'pick-save') {
        void saveTtsPicked(messageId, side ?? primaryTtsSide()).catch(error => {
          if (!isAbortError(error)) toast('error', safeError(error));
        });
      }
      else if (action === 'inspect') void openTtsPanel(messageId, Number(target.dataset.jyTtsUtt), side);
      else if (action === 'play') {
        const utteranceId = Number(target.dataset.jyTtsUtt);
        const transport = runtime.tts.transport;
        if (target.dataset.state === 'playing' && transport?.messageId === messageId && transport.state === 'playing') pauseTts();
        else void playTtsUtterance(messageId, utteranceId, side);
      } else if (action === 'play-line') {
        const lineId = Number(target.dataset.jyTtsLine);
        const transport = runtime.tts.transport;
        const onThisParagraph = transport?.messageId === messageId && transport.side === (side ?? primaryTtsSide())
          && transport.items[transport.index]?.segment.lineId === lineId;
        if (transport?.state === 'playing' && onThisParagraph) pauseTts();
        // Paused inside this paragraph: carry on from there rather than starting it over.
        else if (transport?.state === 'paused' && onThisParagraph) resumeTts();
        else void playTtsParagraph(messageId, lineId, side);
      } else if (action === 'regen-line') {
        void regenerateTtsParagraph(messageId, Number(target.dataset.jyTtsLine), side).catch(error => {
          if (!isAbortError(error)) toast('error', safeError(error));
        });
      }
    };
    document.addEventListener('click', onClick, true);
    runtime.tts.clickCleanup = () => document.removeEventListener('click', onClick, true);
  }
  const chat = document.getElementById('chat');
  if (chat && !runtime.tts.observer && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(records => {
      if (!ttsSettings().enabled) return;
      const ids = new Set();
      for (const record of records) {
        const element = record.target instanceof Element ? record.target : record.target?.parentElement;
        const mes = element?.closest?.('.mes[mesid]');
        if (mes) ids.add(mes.getAttribute('mesid'));
        for (const node of record.addedNodes) {
          if (node instanceof Element && node.matches('.mes[mesid]')) ids.add(node.getAttribute('mesid'));
        }
      }
      const context = getContext();
      const count = Array.isArray(context.chat) ? context.chat.length : 0;
      const writing = runtime.mainGenerationActive ? latestAssistantMessageId(context) : null;
      for (const id of ids) {
        // The floor being written is redrawn by the host on every streamed chunk; it gets its buttons
        // once the reply is rendered whole.
        if (writing !== null && Number(id) === writing) continue;
        const text = ttsMessageText(id);
        const element = text?.closest('.mes[mesid]');
        // A chat opening inserts every floor at once: only the ones near the screen are done now.
        if (element && !text.querySelector(':scope > .jy-tts-bar')) routeTtsDecorate(element, { delay: 400 }, Number(id) >= count - 3);
      }
    });
    observer.observe(chat, { childList: true, subtree: true });
    runtime.tts.observer = observer;
  }
}

function unbindTtsDom() {
  for (const { timer } of runtime.tts.timers.values()) globalThis.clearTimeout(timer);
  runtime.tts.timers.clear();
  runtime.tts.observer?.disconnect();
  runtime.tts.observer = null;
  runtime.tts.viewer?.disconnect();
  runtime.tts.viewer = null;
  runtime.tts.clickCleanup?.();
  runtime.tts.clickCleanup = null;
}

function cleanupTts() {
  stopTts();
  unbindTtsDom();
  clearAllTtsDecorations();
  for (const url of runtime.tts.urls.values()) URL.revokeObjectURL(url);
  runtime.tts.urls.clear();
  runtime.tts.ranges.clear();
  runtime.tts.status.clear();
  for (const timer of runtime.tts.closing.values()) globalThis.clearTimeout(timer);
  runtime.tts.closing.clear();
  runtime.tts.pregenerated.clear();
  runtime.tts.floors.clear();
  runtime.tts.recordings.clear();
  runtime.tts.overrides.clear();
  if (runtime.tts.player) {
    runtime.tts.player.audio.removeAttribute('src');
    runtime.tts.player = null;
  }
}

async function testFishConnection(settings = runtime.settings) {
  const tts = ttsSettings(settings);
  requireFishKey(tts);
  const response = await withTtsTimeout(undefined, Math.min(tts.fish.timeoutSec, 60), signal => fishRequest('/wallet/self/api-credit', tts.fish, { method: 'GET', signal }));
  const data = await response.json().catch(() => null);
  const credit = Number(data?.credit);
  recordDiagnostic('info', 'tts.test', 'Fish 连接测试成功。', {
    viaProxy: tts.fish.viaProxy,
    host: detectTtsHost(),
    baseUrl: tts.fish.baseUrl,
    model: tts.fish.model,
    credit: Number.isFinite(credit) ? credit : null,
  });
  return { credit: Number.isFinite(credit) ? credit : null, freeCredit: data?.has_free_credit === true };
}

async function lookupFishVoiceTitle(voiceId, settings = runtime.settings) {
  const tts = ttsSettings(settings);
  const response = await withTtsTimeout(undefined, 30, signal => fishRequest(`/model/${encodeURIComponent(voiceId)}`, tts.fish, { method: 'GET', signal }));
  const data = await response.json().catch(() => null);
  return String(data?.title ?? '').trim();
}

// Where a shadow host of ours sits: the whole viewport, sized by the viewport, and the box its fixed
// children are placed in. On a phone the host gives <html> a transform and makes <body> fixed, which
// leaves <html> with no height; a host that took its size from inset:0 took that — nothing — and every
// fixed child measured from the bottom landed off screen. The vh line is for browsers without dvh.
const SHADOW_HOST_BOX = 'position:fixed;left:0;top:0;width:100vw;height:100vh;height:100dvh;contain:strict;';

/**
 * A key typed into one of our fields stays ours. The host listens on the document for ←/→ (swipe a
 * reply) and Ctrl+Enter (send, regenerate), and tells a field from the page by document.activeElement
 * — which is our host element whenever the field sits in a shadow root. Escape still goes through.
 */
function keepTypingInside(host) {
  host.addEventListener('keydown', event => {
    if (event.key === 'Escape') return;
    const target = event.composedPath?.()[0];
    if (target instanceof Element && (target.matches('input, textarea, select') || target.isContentEditable)) event.stopPropagation();
  });
}

/** Writes text into an element only when it differs from what is there. */
function putText(element, value) {
  const text = String(value);
  if (element && element.textContent !== text) element.textContent = text;
}

function setText(root, selector, value) {
  const element = root.querySelector(selector);
  const text = String(value);
  // The same text is not written again: panels redraw often, and every write is a mutation.
  if (element && element.textContent !== text) element.textContent = text;
}

function fieldElements(root, name) {
  return [...root.querySelectorAll(`[data-jy-field="${name}"]`)];
}

function setField(root, name, value) {
  for (const element of fieldElements(root, name)) {
    if (element.type === 'radio') element.checked = element.value === String(value);
    else if (element.type === 'checkbox') element.checked = Boolean(value);
    else if (Array.isArray(value) && ['bodyTags', 'excludedTags'].includes(name)) element.value = value.join('\n');
    else element.value = value ?? '';
  }
}

function makePromptTextarea(doc, field, value, rows = 10, placeholder = '') {
  const textarea = doc.createElement('textarea');
  textarea.dataset.jyProfileField = field;
  textarea.value = value ?? '';
  textarea.rows = rows;
  textarea.spellcheck = false;
  if (placeholder) textarea.placeholder = placeholder;
  return textarea;
}

function appendLabeledControl(doc, parent, labelText, control) {
  const label = doc.createElement('label');
  const title = doc.createElement('span');
  title.className = 'jy-label';
  title.textContent = labelText;
  label.append(title, control);
  parent.appendChild(label);
  return control;
}

function makePromptSelect(doc, field, value, presets) {
  const select = doc.createElement('select');
  select.dataset.jyProfileField = field;
  for (const [id, preset] of Object.entries(presets)) {
    const option = doc.createElement('option');
    option.value = id;
    option.textContent = preset.label;
    select.appendChild(option);
  }
  const custom = doc.createElement('option');
  custom.value = 'custom';
  custom.textContent = '自定义';
  select.appendChild(custom);
  select.value = value;
  return select;
}

function makePromptItem(doc, { id, title, badge, promptKey, buildEditor, modified = false }) {
  const item = doc.createElement('article');
  item.className = 'jy-prompt-item';
  item.dataset.jyPromptItem = id;
  if (modified) item.dataset.jyModified = 'true';
  const header = doc.createElement('div');
  header.className = 'jy-prompt-item-head';
  const copy = doc.createElement('div');
  copy.className = 'jy-prompt-item-copy';
  const heading = doc.createElement('h3');
  heading.textContent = title;
  const state = doc.createElement('span');
  state.className = 'jy-badge';
  state.textContent = badge;
  copy.append(heading, state);
  const edit = doc.createElement('button');
  edit.type = 'button';
  edit.className = 'jy-pencil-button';
  edit.dataset.jyAction = 'toggle-prompt-editor';
  edit.dataset.jyPromptEditor = id;
  edit.setAttribute('aria-label', `编辑${title}`);
  edit.setAttribute('aria-expanded', 'false');
  edit.textContent = '✎';
  header.append(copy, edit);
  copy.dataset.jyAction = 'toggle-prompt-editor';
  copy.dataset.jyPromptEditor = id;
  const editor = doc.createElement('div');
  editor.className = 'jy-prompt-item-editor';
  editor.dataset.jyPromptEditorPanel = id;
  editor.hidden = true;
  buildEditor(editor);
  if (promptKey) {
    const actions = doc.createElement('div');
    actions.className = 'jy-actions jy-actions-compact';
    const reset = doc.createElement('button');
    reset.type = 'button';
    reset.className = 'jy-text-button';
    reset.dataset.jyAction = 'reset-prompt-item';
    reset.dataset.jyPromptKey = promptKey;
    reset.textContent = '恢复此项默认';
    actions.appendChild(reset);
    editor.appendChild(actions);
  }
  item.append(header, editor);
  return item;
}

function countNonEmptyLines(value) {
  return String(value ?? '').split(/\r?\n/).filter(line => line.trim()).length;
}

function renderStandardPromptItems(root, profile) {
  const doc = root.ownerDocument;
  const list = root.querySelector('[data-jy-standard-prompt-list]');
  if (!list) return;
  list.replaceChildren();
  let modifiedCount = 0;
  const addTextareaItem = (id, title, field, value, rows, badge, placeholder = '', modified = false) => {
    if (modified) modifiedCount += 1;
    list.appendChild(makePromptItem(doc, {
      id,
      title,
      badge,
      promptKey: id,
      modified,
      buildEditor: editor => appendLabeledControl(doc, editor, title, makePromptTextarea(doc, field, value, rows, placeholder)),
    }));
  };

  addTextareaItem(
    'jailbreak',
    '破限词',
    'jailbreakPrompt',
    profile.jailbreakPrompt,
    12,
    profile.jailbreakPrompt.trim() ? '已填写' : '未填写',
    '在这里修改前置破限词。',
    profile.jailbreakPrompt.trim() !== DEFAULT_JAILBREAK_PROMPT.trim(),
  );
  addTextareaItem(
    'core',
    '核心翻译规范',
    'corePrompt',
    profile.corePrompt,
    18,
    profile.corePrompt === CORE_TRANSLATION_SPEC ? '默认' : '已修改',
    '',
    profile.corePrompt !== CORE_TRANSLATION_SPEC,
  );

  const optionItems = [
    ['style', '翻译文风', 'styleMode', 'styleCustom', STYLE_PRESETS],
    ['leaning', '翻译倾向', 'leaningMode', 'leaningCustom', LEANING_PRESETS],
    ['honorific', '称谓与角色口吻', 'honorificMode', 'honorificCustom', HONORIFIC_PRESETS],
    ['name', '未知姓名与专名', 'nameMode', 'nameCustom', NAME_PRESETS],
    ['punctuation', '对话与标点', 'punctuationMode', 'punctuationCustom', PUNCTUATION_PRESETS],
  ];
  for (const [id, title, modeField, customField, presets] of optionItems) {
    const optionModified = profile[modeField] === 'custom';
    if (optionModified) modifiedCount += 1;
    list.appendChild(makePromptItem(doc, {
      id,
      title,
      badge: promptOptionLabel(presets, profile[modeField]),
      promptKey: id,
      modified: optionModified,
      buildEditor: editor => {
        appendLabeledControl(doc, editor, '采用规则', makePromptSelect(doc, modeField, profile[modeField], presets));
        // What the chosen preset actually tells the model. Picking between 韩系 · 网文韩漫 and
        // 欧美 · 小说奇幻 by label alone is exactly the guessing readers asked to be spared.
        const preview = doc.createElement('p');
        preview.className = 'jy-muted jy-preset-preview';
        preview.dataset.jyPresetPreviewFor = modeField;
        preview.textContent = presets[profile[modeField]]?.prompt ?? '';
        preview.hidden = profile[modeField] === 'custom' || !preview.textContent;
        editor.appendChild(preview);
        const custom = makePromptTextarea(doc, customField, profile[customField], 7, '写下这项自定义规则。');
        custom.dataset.jyCustomFor = modeField;
        appendLabeledControl(doc, editor, '自定义规则', custom);
      },
    }));
  }

  const bannedModified = profile.avoidPhrases.trim() !== DEFAULT_AVOID_PHRASES.trim() || Boolean(profile.forbiddenPhrases.trim());
  if (bannedModified) modifiedCount += 1;
  list.appendChild(makePromptItem(doc, {
    id: 'banned',
    title: '禁用表达 / 杀八股',
    badge: `${countNonEmptyLines(profile.avoidPhrases) + countNonEmptyLines(profile.forbiddenPhrases)} 条`,
    promptKey: 'banned',
    modified: bannedModified,
    buildEditor: editor => {
      appendLabeledControl(doc, editor, '原文没有时禁止擅自添加', makePromptTextarea(doc, 'avoidPhrases', profile.avoidPhrases, 9, '一行一个词或句式'));
      appendLabeledControl(doc, editor, '绝对禁用（命中后尝试修正一次）', makePromptTextarea(doc, 'forbiddenPhrases', profile.forbiddenPhrases, 7, '一行一个词或句式'));
    },
  }));
  addTextareaItem('glossary', '姓名与术语表', 'glossary', profile.glossary, 10, `${countNonEmptyLines(profile.glossary)} 条`, '魔導書 = 魔导书\n王都 = 王都', Boolean(profile.glossary.trim()));
  addTextareaItem('examples', '正例与反例', 'examples', profile.examples, 14, profile.examples.trim() ? '已填写' : '未填写', '放入你认可或不认可的原文与译文对照例子。', Boolean(profile.examples.trim()));
  addTextareaItem('checklist', '输出前思考清单', 'checklistPrompt', profile.checklistPrompt, 16, profile.checklistPrompt === PRE_OUTPUT_CHECKLIST ? '默认' : '已修改', '', profile.checklistPrompt !== PRE_OUTPUT_CHECKLIST);
  setText(root, '[data-jy-modified-count]', modifiedCount ? `${modifiedCount} 处已改` : '全部默认');
}

function renderCustomPromptItems(root, profile) {
  const doc = root.ownerDocument;
  const list = root.querySelector('[data-jy-custom-prompt-list]');
  const empty = root.querySelector('[data-jy-custom-empty]');
  if (!list) return;
  list.replaceChildren();
  if (empty) empty.hidden = profile.customSections.length > 0;
  profile.customSections.forEach((section, index) => {
    const item = makePromptItem(doc, {
      id: `custom-${section.id}`,
      title: section.title,
      badge: section.enabled ? '已启用' : '已停用',
      buildEditor: editor => {
        const name = doc.createElement('input');
        name.type = 'text';
        name.value = section.title;
        name.maxLength = 80;
        name.dataset.jyCustomField = 'title';
        name.dataset.jySectionId = section.id;
        appendLabeledControl(doc, editor, '条目名称', name);
        const content = makePromptTextarea(doc, '', section.content, 10, '写下追加到统一翻译规范中的内容。');
        delete content.dataset.jyProfileField;
        content.dataset.jyCustomField = 'content';
        content.dataset.jySectionId = section.id;
        appendLabeledControl(doc, editor, '提示词内容', content);
        const enabledLabel = doc.createElement('label');
        enabledLabel.className = 'jy-check';
        const enabled = doc.createElement('input');
        enabled.type = 'checkbox';
        enabled.checked = section.enabled;
        enabled.dataset.jyCustomField = 'enabled';
        enabled.dataset.jySectionId = section.id;
        enabledLabel.append(enabled, doc.createTextNode(' 启用这个条目'));
        editor.appendChild(enabledLabel);
        const actions = doc.createElement('div');
        actions.className = 'jy-actions jy-actions-compact';
        for (const [action, label, disabled] of [
          ['move-prompt-section-up', '上移', index === 0],
          ['move-prompt-section-down', '下移', index === profile.customSections.length - 1],
          ['duplicate-prompt-section', '复制', false],
          ['delete-prompt-section', '删除', false],
        ]) {
          const button = doc.createElement('button');
          button.type = 'button';
          button.className = 'jy-text-button';
          button.dataset.jyAction = action;
          button.dataset.jySectionId = section.id;
          button.textContent = label;
          button.disabled = disabled;
          actions.appendChild(button);
        }
        editor.appendChild(actions);
      },
    });
    list.appendChild(item);
  });
}

const PROMPT_OPTION_PRESETS = Object.freeze({
  styleMode: STYLE_PRESETS,
  leaningMode: LEANING_PRESETS,
  honorificMode: HONORIFIC_PRESETS,
  nameMode: NAME_PRESETS,
  punctuationMode: PUNCTUATION_PRESETS,
});

function updatePromptConditionalFields(root) {
  for (const custom of root.querySelectorAll('[data-jy-custom-for]')) {
    const mode = root.querySelector(`[data-jy-profile-field="${custom.dataset.jyCustomFor}"]`)?.value;
    const label = custom.closest('label');
    if (label) label.hidden = mode !== 'custom';
  }
  for (const preview of root.querySelectorAll('[data-jy-preset-preview-for]')) {
    const field = preview.dataset.jyPresetPreviewFor;
    const mode = root.querySelector(`[data-jy-profile-field="${field}"]`)?.value;
    preview.textContent = PROMPT_OPTION_PRESETS[field]?.[mode]?.prompt ?? '';
    preview.hidden = mode === 'custom' || !preview.textContent;
  }
}

function syncPromptFields(root, settings) {
  const select = root.querySelector('[data-jy-prompt-profile-select]');
  if (select) {
    select.replaceChildren(...settings.promptProfiles.map(profile => {
      const option = root.ownerDocument.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name;
      return option;
    }));
    select.value = settings.selectedPromptProfileId;
  }
  const profile = getActivePromptProfile(settings);
  const previouslyOpen = root.dataset.jyOpenEditor;
  root.querySelectorAll('[data-jy-editor-stage] > [data-jy-prompt-editor-panel]').forEach(panel => panel.remove());
  root.dataset.jyEditingPromptProfileId = profile.id;
  const name = root.querySelector('[data-jy-prompt-profile-name]');
  if (name) name.value = profile.name;
  const targetLanguage = root.querySelector('[data-jy-profile-field="targetLanguage"]');
  if (targetLanguage) targetLanguage.value = profile.targetLanguage;
  const postscript = root.querySelector('[data-jy-profile-field="postscript"]');
  if (postscript) postscript.value = profile.postscript ?? '';
  const postscriptRole = root.querySelector('[data-jy-profile-field="postscriptRole"]');
  if (postscriptRole) postscriptRole.value = profile.postscriptRole || 'user';
  renderStandardPromptItems(root, profile);
  renderCustomPromptItems(root, profile);
  const stage = root.querySelector('[data-jy-editor-stage]');
  for (const panel of root.querySelectorAll('[data-jy-prompt-editor-panel]')) stage.appendChild(panel);
  const restored = previouslyOpen && root.querySelector(`[data-jy-prompt-editor-panel="${previouslyOpen}"]`);
  root.querySelector('[data-jy-editor-placeholder]').hidden = Boolean(restored);
  if (restored) {
    restored.hidden = false;
    root.querySelector(`button[data-jy-prompt-editor="${previouslyOpen}"]`)?.setAttribute('aria-expanded', 'true');
  } else delete root.dataset.jyOpenEditor;
  updatePromptConditionalFields(root);
  setText(
    root,
    '[data-jy-language-support]',
    isSimplifiedChineseTarget(profile.targetLanguage)
      ? '简体中文会启用完整内置文风、称谓、专名、标点与杀八股规则。'
      : `${normalizeTargetLanguage(profile.targetLanguage)} 使用通用翻译规范；自定义规则照常生效。`,
  );
  setText(root, '[data-jy-prompt-size]', `${countPromptCharacters(profile).toLocaleString()} 字`);
}

function collectPromptFields(root, settings) {
  const editingId = root.dataset.jyEditingPromptProfileId || settings.selectedPromptProfileId;
  const profile = settings.promptProfiles.find(item => item.id === editingId);
  if (!profile) return settings;
  const name = root.querySelector('[data-jy-prompt-profile-name]')?.value.trim();
  if (name) profile.name = name;
  for (const element of root.querySelectorAll('[data-jy-profile-field]')) {
    profile[element.dataset.jyProfileField] = element.type === 'checkbox' ? element.checked : element.value;
  }
  for (const element of root.querySelectorAll('[data-jy-custom-field][data-jy-section-id]')) {
    const section = profile.customSections.find(item => item.id === element.dataset.jySectionId);
    if (!section) continue;
    section[element.dataset.jyCustomField] = element.type === 'checkbox' ? element.checked : element.value;
  }
  return settings;
}

// ---------------------------------------------------------------------------------------------
// Connections. The connection page is a shelf: it keeps connections and nothing else. Which one is
// being edited there is its own business and nobody else's; each feature names the connection it
// uses where that feature is set up — the translation on the desk (and in the floating window), the
// reading on its own page. A choice is 'follow' for the host's own connection, or a saved one's id.
// ---------------------------------------------------------------------------------------------

/** A connection as the pickers and the page name it; `short` where it sits inside another sentence. */
function channelLabel(settings, choice, { short = false } = {}) {
  if (choice === 'follow') return short ? '跟随酒馆' : '跟随酒馆（酒馆当前的连接和模型）';
  const channel = (Array.isArray(settings?.channels) ? settings.channels : []).find(item => item.id === choice);
  if (!channel) return '（这条连接已经不在了）';
  return channel.model ? `${channel.name} · ${channel.model}` : channel.name;
}

/** A picker offering the host's own connection and every saved one, with an optional entry ahead of them. */
function fillChannelPicker(select, settings, chosen, { lead = null } = {}) {
  const doc = select.ownerDocument;
  const add = (value, text) => {
    const option = doc.createElement('option');
    option.value = value;
    option.textContent = text;
    return option;
  };
  const options = [
    ...(lead ? [add(lead.value, lead.text)] : []),
    add('follow', channelLabel(settings, 'follow')),
    ...(Array.isArray(settings?.channels) ? settings.channels : []).map(channel => add(channel.id, channelLabel(settings, channel.id))),
  ];
  select.replaceChildren(...options);
  select.value = options.some(option => option.value === chosen) ? chosen : (options[0]?.value ?? '');
}

/** The translation's choice written back: the host's own connection, or one saved connection. */
function applyTranslationChoice(settings, choice) {
  if (choice === 'follow') settings.apiMode = 'follow';
  else if ((settings.channels ?? []).some(channel => channel.id === choice)) {
    settings.apiMode = 'independent';
    settings.selectedChannelId = choice;
  }
  return settings;
}

/** Which connection each feature uses right now, and where that is chosen. */
function channelUsers(settings = runtime.settings) {
  const tts = ttsSettings(settings);
  const analysis = resolveFeatureChannel(tts.analysisChannelId, settings);
  return [
    { feature: '翻译', choice: translationChannelChoice(settings), action: 'open-main', where: '翻译台' },
    { feature: '朗读分析', choice: analysis, action: 'open-tts', where: '朗读页', note: tts.enabled ? '' : '朗读没开，眼下不会用到' },
    { feature: '深度分析', choice: tts.deepChannelId || analysis, action: 'open-tts', where: '朗读页', note: tts.deepChannelId ? '' : '和朗读分析同一条' },
  ];
}

/** The connection the page is editing: the one last opened, else the translation's, else the first. */
function editingChannelId(settings = runtime.settings) {
  const channels = Array.isArray(settings?.channels) ? settings.channels : [];
  if (channels.some(channel => channel.id === runtime.editingChannelId)) return runtime.editingChannelId;
  const translation = translationChannelChoice(settings);
  return channels.some(channel => channel.id === translation) ? translation : (channels[0]?.id ?? '');
}

/** The strip at the top of the connection page: who uses what, each with the way to where it is chosen. */
function renderChannelUses(root, settings, editing) {
  const users = channelUsers(settings);
  const box = root.querySelector('[data-jy-channel-uses]');
  if (box) {
    const doc = box.ownerDocument;
    box.replaceChildren(...users.map(user => {
      const card = doc.createElement('div');
      card.className = 'jy-channel-use';
      card.dataset.editing = String(user.choice === editing);
      const label = doc.createElement('span');
      label.className = 'jy-label';
      label.textContent = user.feature;
      const name = doc.createElement('strong');
      name.textContent = channelLabel(settings, user.choice, { short: true });
      const parts = [label, name];
      if (user.note) {
        const note = doc.createElement('small');
        note.textContent = user.note;
        parts.push(note);
      }
      const go = doc.createElement('button');
      go.type = 'button';
      go.className = 'jy-text-button';
      go.dataset.jyAction = user.action;
      go.textContent = `在${user.where}换 →`;
      parts.push(go);
      card.append(...parts);
      return card;
    }));
  }
  const using = users.filter(user => user.choice === editing).map(user => user.feature);
  setText(root, '[data-jy-channel-usage]', using.length
    ? `正在编辑的这条现在给${using.join('、')}用${using.length > 1 ? '，改它这几处都会跟着变' : '，改它就是改这一处用的连接'}。`
    : '正在编辑的这条现在没有功能在用；要用它，去翻译台或朗读页的下拉框里选。');
}

function syncChannelFields(root, settings) {
  const editing = editingChannelId(settings);
  runtime.editingChannelId = editing;
  const select = root.querySelector('[data-jy-edit-channel]');
  if (select) {
    select.replaceChildren(...settings.channels.map(channel => {
      const option = document.createElement('option');
      option.value = channel.id;
      option.textContent = channel.name;
      return option;
    }));
    select.value = editing;
  }
  const translation = root.querySelector('[data-jy-translation-channel]');
  if (translation) fillChannelPicker(translation, settings, translationChannelChoice(settings));
  renderChannelUses(root, settings, editing);
  const channel = settings.channels.find(item => item.id === editing) ?? getActiveChannel(settings);
  root.dataset.jyEditingChannelId = channel.id;
  for (const element of root.querySelectorAll('[data-jy-channel-field]')) {
    const key = element.dataset.jyChannelField;
    if (element.type === 'checkbox') element.checked = channel[key] === true;
    else element.value = key === 'excludeParams' ? channel.excludeParams.join(', ') : channel[key] ?? '';
  }
  const modelSelect = root.querySelector('[data-jy-model-select]');
  if (modelSelect) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = channel.models.length
      ? `已拉取 ${channel.models.length} 个模型，请选择`
      : '先拉取模型列表';
    modelSelect.replaceChildren(placeholder, ...channel.models.map(model => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      return option;
    }));
    modelSelect.value = channel.models.includes(channel.model) ? channel.model : '';
  }
  setText(
    root,
    '[data-jy-model-help]',
    channel.models.length
      ? `共 ${channel.models.length} 个模型。选择后会同步到下方输入框；也可以直接手动填写。`
      : '拉取后会显示完整列表，不会自动替你选择。',
  );
}

function updateSummary(root, settings) {
  const channel = getActiveChannel(settings);
  const promptProfile = getActivePromptProfile(settings);
  const independent = settings.apiMode === 'independent';
  setText(root, '[data-jy-channel-mode]', independent ? '保存的连接' : '酒馆当前连接');
  setText(
    root,
    '[data-jy-channel-summary]',
    independent
      ? `${channel.model || '尚未选择模型'} · 目标：${normalizeTargetLanguage(promptProfile.targetLanguage)} · ${channel.url || '尚未填写地址'}`
      : `用酒馆当前连接的 API 和模型翻译。目标：${normalizeTargetLanguage(promptProfile.targetLanguage)}。`,
  );
  const sources = [
    '当前角色',
    settings.includeWorldbook && '世界书',
    settings.includeCharacterCard && '角色卡详细设定',
    settings.includeRecentContext && `近期 ${settings.contextMessages} 条对话`,
    promptProfile.glossary.trim() && '姓名与术语',
  ].filter(Boolean);
  setText(root, '[data-jy-context-summary]', sources.length ? `当前启用：${sources.join('、')}。` : '当前没有启用额外参考资料。');
}

function syncFields(root, settings) {
  for (const choice of root.querySelectorAll('[data-jy-theme]')) choice.setAttribute('aria-pressed', String(choice.dataset.jyTheme === (settings.theme || 'day')));
  const selectedProfile = getActivePromptProfile(settings);
  setText(root, '[data-jy-active-profile]', `${selectedProfile.name} · ${normalizeTargetLanguage(selectedProfile.targetLanguage)}`);
  const modelSearch = root.querySelector('[data-jy-model-search]');
  if (modelSearch) modelSearch.value = '';

  for (const [name, value] of Object.entries(settings)) setField(root, name, value);
  syncChannelFields(root, settings);
  renderWorldInfoList(root);
  syncPromptFields(root, settings);
  syncProcessingFields(root, settings);
  syncColoringFields(root, settings);
  syncTtsFields(root, settings);
  updateApiPanels(root);
  updateSummary(root, settings);
}

function collectSettings(root) {
  const current = normalizeProcessingSettings(runtime.settings);
  const processing = getActiveProcessingProfile(current);
  if (runtime.nativeRegexInstalled) processing.regexScripts = readNativeRegexEdits(getContext().extensionSettings.regex, processing);
  const processingName = root.querySelector('[data-jy-processing-name]')?.value.trim();
  if (processingName) processing.name = processingName;
  for (const control of root.querySelectorAll('[data-jy-processing-rule]')) {
    const rule = processing.regexScripts.find(item => item.id === control.dataset.jyProcessingRule);
    if (rule) rule.disabled = !control.checked;
  }
  collectPromptFields(root, current);
  // The translation's own choice, from the desk; the connection page only ever edits.
  const translationChoice = root.querySelector('[data-jy-translation-channel]')?.value;
  if (translationChoice) applyTranslationChoice(current, translationChoice);
  for (const name of [
    'autoGeneration',
    'autoSwipe',
    'autoEdit',
    'streamingWriteback',
    'showFloatingButton',
    'leftHanded',
    'paragraphPerLine',
    'carryFormatting',
    'includeWorldbook',
    'includeCharacterCard',
    'includeRecentContext',
  ]) {
    const element = root.querySelector(`[data-jy-field="${name}"]`);
    if (element) current[name] = element.checked;
  }
  for (const name of ['segmentPrefix', 'segmentSuffix', 'translationPrefix', 'translationSuffix', 'preserveLineRules', 'floatingStyle', 'floorButtons']) {
    const element = root.querySelector(`[data-jy-field="${name}"]`);
    if (element) current[name] = element.value;
  }
  const bodyTags = root.querySelector('[data-jy-field="bodyTags"]');
  const excludedTags = root.querySelector('[data-jy-field="excludedTags"]');
  const replaceTags = root.querySelector('[data-jy-field="replaceTags"]');
  if (replaceTags) {
    const parsed = parseTagNamesWithErrors(replaceTags.value);
    if (parsed.invalid.length) throw new Error(`无法识别替换标签：${parsed.invalid.join('、')}。请填写标签名称或完整尖括号标签。`);
    current.replaceTags = parsed.tags;
  }
  if (bodyTags) {
    const parsed = parseTagNamesWithErrors(bodyTags.value);
    if (parsed.invalid.length) throw new Error(`无法识别正文标签：${parsed.invalid.join('、')}。请填写标签名称或完整尖括号标签。`);
    current.bodyTags = parsed.tags;
    if (!current.bodyTags.length) throw new Error('至少填写一个有效的正文提取标签名称。');
  }
  if (excludedTags) {
    const parsed = parseTagNamesWithErrors(excludedTags.value);
    if (parsed.invalid.length) throw new Error(`无法识别排除标签：${parsed.invalid.join('、')}。请填写标签名称或完整尖括号标签。`);
    current.excludedTags = parsed.tags;
  }
  const preserveRules = parsePreserveLineRulesWithErrors(current.preserveLineRules);
  if (preserveRules.errors.length) throw new Error(preserveRules.errors.join(' '));
  for (const name of ['contextMessages', 'retries']) {
    const element = root.querySelector(`[data-jy-field="${name}"]`);
    if (element) current[name] = Number(element.value);
  }
  const editingId = root.dataset.jyEditingChannelId || current.selectedChannelId;
  const editing = current.channels.find(channel => channel.id === editingId);
  if (editing) {
    for (const element of root.querySelectorAll('[data-jy-channel-field]')) {
      const key = element.dataset.jyChannelField;
      if (element.type === 'checkbox') editing[key] = element.checked;
      else if (['timeoutSec', 'maxTokens', 'temperature', 'concurrency'].includes(key)) editing[key] = Number(element.value);
      else if (key === 'excludeParams') editing[key] = element.value;
      else editing[key] = element.value;
    }
  }
  const wiPicks = [...root.querySelectorAll('[data-jy-wi-pick]:checked')]
    .map(element => ({ world: String(element.dataset.jyWorld || ''), uid: Number(element.dataset.jyUid) }))
    .filter(pick => pick.world && Number.isInteger(pick.uid));
  if (root.querySelector('[data-jy-wi-list]')) {
    current.worldInfoWhitelist = { ...(current.worldInfoWhitelist || {}) };
    const characterKey = worldInfoCharacterKey();
    if (wiPicks.length) current.worldInfoWhitelist[characterKey] = wiPicks;
    else delete current.worldInfoWhitelist[characterKey];
  }
  collectColoringFields(root, current);
  collectTtsFields(root, current);
  return captureProcessingProfile(normalizeProcessingSettings(current));
}


// The colouring page. The band itself is never typed by hand: it is whatever 取色 measured, and it
// is carried through every save so a settings change does not silently discard the measurement.
function collectColoringFields(root, current) {
  if (!root.querySelector('[data-jy-coloring]')) return;
  const coloring = { ...normalizeColoring(current.coloring), band: normalizeColoring(current.coloring).band };
  const speakers = root.querySelector('[data-jy-field="coloringSpeakers"]');
  const emotions = root.querySelector('[data-jy-field="coloringEmotions"]');
  const contrast = root.querySelector('[data-jy-field="coloringContrast"]');
  const vividness = root.querySelector('[data-jy-field="coloringVividness"]');
  const rhythm = root.querySelector('[data-jy-field="coloringRhythm"]');
  const autoSpeakers = root.querySelector('[data-jy-field="coloringAutoSpeakers"]');
  if (speakers) coloring.speakers = speakers.checked;
  if (emotions) coloring.emotions = emotions.checked;
  if (rhythm) coloring.rhythm = rhythm.checked;
  if (autoSpeakers) coloring.autoSpeakers = autoSpeakers.checked;
  if (contrast) coloring.minContrast = Number(contrast.value);
  if (vividness) coloring.vividness = Number(vividness.value) / 100;
  if (runtime.probedBand) {
    coloring.band = runtime.probedBand;
    coloring.bandProbedAt = runtime.probedBandAt || coloring.bandProbedAt;
  }
  current.coloring = coloring;

  const rows = [...root.querySelectorAll('[data-jy-speaker-row]')].map(row => ({
    name: row.querySelector('[data-jy-speaker-name]')?.value ?? '',
    aliases: row.querySelector('[data-jy-speaker-aliases]')?.value ?? '',
    source: row.querySelector('[data-jy-speaker-color]')?.value ?? '',
    from: row.querySelector('[data-jy-speaker-from]')?.value ?? 'hair',
  }));
  const palette = normalizeSpeakerList(rows);
  current.speakerPalette = { ...(current.speakerPalette || {}) };
  const characterKey = worldInfoCharacterKey();
  if (palette.length) current.speakerPalette[characterKey] = palette;
  else delete current.speakerPalette[characterKey];
}

function speakerRowElement(doc, speaker) {
  const row = doc.createElement('div');
  row.className = 'jy-speaker-row';
  row.dataset.jySpeakerRow = '';
  const name = doc.createElement('input');
  name.type = 'text';
  name.maxLength = 60;
  name.placeholder = '角色名（与译文中的写法一致）';
  name.dataset.jySpeakerName = '';
  name.value = speaker.name ?? '';
  const aliases = doc.createElement('input');
  aliases.type = 'text';
  aliases.placeholder = '别名，逗号分隔（可留空）';
  aliases.dataset.jySpeakerAliases = '';
  aliases.value = (speaker.aliases ?? []).join('、');
  const from = doc.createElement('select');
  from.dataset.jySpeakerFrom = '';
  for (const [value, label] of [['hair', '发色'], ['eye', '瞳色'], ['manual', '指定']]) {
    const option = doc.createElement('option');
    option.value = value;
    option.textContent = label;
    from.appendChild(option);
  }
  from.value = speaker.from ?? 'hair';
  const color = doc.createElement('input');
  color.type = 'color';
  color.dataset.jySpeakerColor = '';
  color.value = /^#[0-9a-f]{6}$/i.test(speaker.source ?? '') ? speaker.source : '#808080';
  const preview = doc.createElement('span');
  preview.className = 'jy-speaker-preview';
  preview.dataset.jySpeakerPreview = '';
  const remove = doc.createElement('button');
  remove.type = 'button';
  remove.className = 'jy-text-button';
  remove.dataset.jyAction = 'remove-speaker';
  remove.textContent = '移除';
  row.append(name, aliases, from, color, preview, remove);
  return row;
}

function renderSpeakerList(root, settings = runtime.settings) {
  const list = root.querySelector('[data-jy-speaker-list]');
  if (!list) return;
  const doc = list.ownerDocument;
  const palette = normalizeSpeakerList(settings.speakerPalette?.[worldInfoCharacterKey()]);
  list.replaceChildren();
  if (!palette.length) {
    const note = doc.createElement('p');
    note.className = 'jy-muted';
    note.textContent = '还没有登记角色。点「添加角色」，填上译文里用的名字和发色即可。';
    list.appendChild(note);
    return;
  }
  for (const speaker of palette) list.appendChild(speakerRowElement(doc, speaker));
  refreshSpeakerPreviews(root, settings);
}

// Every preview is the real colour the floor would be painted with, resolved against the measured
// band — not an approximation of it, so what the swatch shows is what the chat gets.
function refreshSpeakerPreviews(root, settings = runtime.settings) {
  const coloring = activeColoring(settings);
  const band = runtime.probedBand ?? coloring.band;
  const rows = [...root.querySelectorAll('[data-jy-speaker-row]')];
  if (!rows.length) return;
  const draft = {
    ...settings,
    coloring: { ...coloring, band },
    speakerPalette: {
      ...(settings.speakerPalette || {}),
      [worldInfoCharacterKey()]: normalizeSpeakerList(rows.map(row => ({
        name: row.querySelector('[data-jy-speaker-name]')?.value ?? '',
        aliases: row.querySelector('[data-jy-speaker-aliases]')?.value ?? '',
        source: row.querySelector('[data-jy-speaker-color]')?.value ?? '',
        from: row.querySelector('[data-jy-speaker-from]')?.value ?? 'hair',
      }))),
    },
  };
  const resolved = band ? resolvedSpeakerColors(draft) : new Map();
  const backdrop = band?.backgrounds?.[Math.floor((band.backgrounds.length - 1) / 2)];
  for (const row of rows) {
    const preview = row.querySelector('[data-jy-speaker-preview]');
    if (!preview) continue;
    const name = row.querySelector('[data-jy-speaker-name]')?.value.trim() ?? '';
    const entry = resolved.get(name);
    if (!band) {
      preview.textContent = '先读取主题';
      preview.removeAttribute('style');
      continue;
    }
    if (!entry) {
      preview.textContent = '填个名字';
      preview.removeAttribute('style');
      continue;
    }
    preview.textContent = entry.derived ? '示例（按名字取色）' : '示例文字';
    preview.style.color = entry.base;
    if (backdrop) preview.style.background = toHex(backdrop);
  }
}

function renderBandReport(root, settings = runtime.settings) {
  const target = root.querySelector('[data-jy-band-report]');
  if (!target) return;
  const doc = target.ownerDocument;
  const coloring = activeColoring(settings);
  const band = runtime.probedBand ?? coloring.band;
  target.replaceChildren();
  if (!band) {
    const note = doc.createElement('p');
    note.className = 'jy-muted';
    note.textContent = '还没有读取过主题。着色需要知道文字后面到底是什么颜色，否则在深色主题上算出来的颜色到浅色主题就看不清了。';
    target.appendChild(note);
    return;
  }
  const line = doc.createElement('p');
  line.className = 'jy-muted';
  const report = runtime.probeReport;
  line.textContent = [
    band.direction === 'light' ? '当前背景偏暗，文字取亮色。' : '当前背景偏亮，文字取暗色。',
    `对比度不低于 ${band.minContrast}。`,
    report?.wallpaper ? '已按壁纸实际像素取样。' : '未检测到壁纸，按主题声明的颜色取样。',
    coloring.bandProbedAt ? `上次读取：${coloring.bandProbedAt}` : '',
  ].filter(Boolean).join(' ');
  target.appendChild(line);
  const strip = doc.createElement('div');
  strip.className = 'jy-band-swatches';
  for (const background of band.backgrounds) {
    const chip = doc.createElement('span');
    chip.className = 'jy-band-swatch';
    chip.style.background = toHex(background);
    chip.textContent = toHex(background);
    strip.appendChild(chip);
  }
  target.appendChild(strip);
  for (const warning of runtime.probeReport?.warnings ?? []) {
    const note = doc.createElement('p');
    note.className = 'jy-muted';
    note.textContent = warning;
    target.appendChild(note);
  }
}

function syncColoringFields(root, settings = runtime.settings) {
  if (!root.querySelector('[data-jy-coloring]')) return;
  const coloring = activeColoring(settings);
  setField(root, 'coloringSpeakers', coloring.speakers);
  setField(root, 'coloringEmotions', coloring.emotions);
  setField(root, 'coloringRhythm', coloring.rhythm);
  setField(root, 'coloringAutoSpeakers', coloring.autoSpeakers);
  setField(root, 'coloringContrast', coloring.minContrast);
  setField(root, 'coloringVividness', Math.round(coloring.vividness * 100));
  const value = root.querySelector('[data-jy-vividness-value]');
  if (value) value.textContent = `${Math.round(coloring.vividness * 100)}%`;
  renderBandReport(root, settings);
  renderSpeakerReport(root, settings, true);
  renderSpeakerList(root, settings);
}

/**
 * Who the last translated floor reported, and what happened to each of them.
 *
 * This is the answer to "对话怎么没颜色". Three different causes produce the identical grey line —
 * 说话人着色 off, the name absent from the palette, auto-colouring off — and none of them used to
 * say anything. Naming each one, with the swatch it actually got, turns the guesswork into a click.
 */
// Solving a colour per speaker is not free, and the task channel ticks several times a second while
// a floor streams. The report only needs redrawing when the coverage itself changed.
let renderedCoverage = null;

function renderSpeakerReport(root, settings = runtime.settings, force = false) {
  const target = root.querySelector('[data-jy-speaker-report]');
  if (!target) return;
  const coverage = runtime.speakerCoverage;
  if (!force && coverage === renderedCoverage) return;
  renderedCoverage = coverage;
  target.replaceChildren();
  target.hidden = !coverage?.reported?.length;
  if (target.hidden) return;
  const doc = target.ownerDocument;
  const band = runtime.probedBand ?? activeColoring(settings).band;
  const resolved = band ? resolvedSpeakerColors(settings, coverage.reported.map(item => item.name)) : new Map();

  const head = doc.createElement('p');
  head.className = 'jy-muted';
  head.textContent = '上一楼副模型报出的说话人：';
  target.appendChild(head);

  const list = doc.createElement('div');
  list.className = 'jy-speaker-chips';
  for (const item of coverage.reported) {
    const chip = doc.createElement('span');
    chip.className = 'jy-speaker-chip';
    chip.dataset.painted = item.painted ? 'yes' : 'no';
    const entry = resolved.get(item.name);
    if (item.painted && entry) chip.style.color = entry.base;
    const note = item.registered ? '名单内' : (item.painted ? '自动取色' : '未上色');
    chip.textContent = `${item.name} · ${item.segments} 段 · ${note}`;
    list.appendChild(chip);
  }
  target.appendChild(list);

  const unpainted = coverage.reported.filter(item => !item.painted);
  const unregistered = coverage.reported.filter(item => !item.registered);
  if (unpainted.length) {
    const why = doc.createElement('p');
    why.className = 'jy-muted';
    why.textContent = coverage.speakersOff
      ? '这些段只套了情绪排版，没有颜色：「说话人着色」没有勾选。'
      : coverage.autoOff
        ? '这些段只套了情绪排版，没有颜色：名字不在名单里，而「名单外自动取色」是关的。'
        : '这些段只套了情绪排版，没有颜色。先点一次「读取当前主题」再试。';
    target.appendChild(why);
  }
  if (unregistered.length) {
    const tools = doc.createElement('div');
    tools.className = 'jy-processing-toolbar';
    const add = doc.createElement('button');
    add.type = 'button';
    add.className = 'jy-button';
    add.dataset.jyAction = 'adopt-speakers';
    add.textContent = `把这 ${unregistered.length} 个名字加进名单`;
    tools.appendChild(add);
    target.appendChild(tools);
    const hint = doc.createElement('p');
    hint.className = 'jy-muted';
    hint.textContent = '加进名单后可以填上真实发色或瞳色，颜色会从自动取色换成按发色取色；不填就沿用现在这个。';
    target.appendChild(hint);
  }
}

async function runThemeProbe(root) {
  updateTask({ status: 'running', title: '正在读取当前主题', message: '取样聊天区背景与壁纸…', progress: 40 });
  const { band, probe } = await probeThemeBand(collectSettings(root));
  runtime.probeReport = probe;
  if (!band.feasible) {
    runtime.probedBand = null;
    updateTask({ status: 'error', title: '当前背景无法着色', message: band.note, progress: 0 });
    toast('error', band.note);
    renderBandReport(root, runtime.settings);
    return band;
  }
  runtime.probedBand = {
    direction: band.direction,
    luminance: band.luminance,
    chromaMax: band.chromaMax,
    minContrast: band.minContrast,
    lightness: band.lightness,
    backgrounds: band.backgrounds,
  };
  runtime.probedBandAt = new Date().toLocaleString('zh-CN', { hour12: false });
  saveSettings(collectSettings(root));
  syncColoringFields(root, runtime.settings);
  updateTask({
    status: 'success',
    title: '已读取当前主题',
    message: `背景取样 ${band.backgrounds.length} 处，文字取${band.direction === 'light' ? '亮' : '暗'}色，对比度不低于 ${band.minContrast}。`,
    progress: 100,
  });
  toast('success', '已按当前主题与壁纸定下可用颜色范围。');
  return band;
}

// ---------------------------------------------------------------------------------------------
// Reading aloud: the control-centre page.
// ---------------------------------------------------------------------------------------------

const TTS_NUMERIC_FISH_FIELDS = new Set(['speed', 'volume', 'temperature', 'topP', 'maxChars', 'timeoutSec', 'mp3Bitrate', 'concurrency', 'retries']);

// A picker of the saved voices, placed after a voice id field; choosing one fills the field.
function ttsLibraryPicker(doc, settings = runtime.settings) {
  const select = doc.createElement('select');
  select.dataset.jyTtsPick = '';
  select.setAttribute('aria-label', '从音色库选择');
  const library = normalizeVoiceLibrary(settings?.voiceLibrary);
  const blank = doc.createElement('option');
  blank.value = '';
  blank.textContent = library.length ? '从音色库选…' : '音色库是空的';
  select.appendChild(blank);
  for (const voice of library) {
    const option = doc.createElement('option');
    option.value = voice.voiceId;
    option.textContent = voice.lang ? `${voice.name} · ${languageLabel(voice.lang)}` : voice.name;
    select.appendChild(option);
  }
  select.disabled = !library.length;
  return select;
}

function ttsLanguageSelect(doc, value = '') {
  const select = doc.createElement('select');
  select.dataset.jyTtsLangCode = '';
  select.setAttribute('aria-label', '语言');
  for (const [code, label] of TTS_LANGUAGES) {
    const option = doc.createElement('option');
    option.value = code;
    option.textContent = label;
    select.appendChild(option);
  }
  if (value && !TTS_LANGUAGES.some(([code]) => code === value)) {
    const option = doc.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
  select.value = value || 'zh';
  return select;
}

// One language → voice binding, for a character row or the narrator.
function ttsLanguageRowElement(doc, lang, voiceId, settings = runtime.settings) {
  const row = doc.createElement('div');
  row.className = 'jy-tts-lang-row';
  row.dataset.jyTtsLangRow = '';
  const scope = doc.createElement('span');
  scope.className = 'jy-tts-pick';
  scope.dataset.jyTtsPickScope = '';
  const id = doc.createElement('input');
  id.type = 'text';
  id.placeholder = '这门语言用的 Voice ID';
  id.spellcheck = false;
  id.dataset.jyTtsLangId = '';
  id.value = voiceId ?? '';
  scope.append(id, ttsLibraryPicker(doc, settings));
  const remove = doc.createElement('button');
  remove.type = 'button';
  remove.className = 'jy-text-button';
  remove.dataset.jyAction = 'tts-remove-lang';
  remove.textContent = '×';
  remove.setAttribute('aria-label', '去掉这门语言的音色');
  row.append(ttsLanguageSelect(doc, lang), scope, remove);
  return row;
}

function readLanguageRows(container) {
  const result = {};
  for (const row of container?.querySelectorAll('[data-jy-tts-lang-row]') ?? []) {
    const lang = normalizeLanguageCode(row.querySelector('[data-jy-tts-lang-code]')?.value);
    const voiceId = row.querySelector('[data-jy-tts-lang-id]')?.value.trim() ?? '';
    if (lang && voiceId) result[lang] = voiceId;
  }
  return result;
}

/**
 * One character's row: who they are, then the voice. A row with a voice of its own is locked and says
 * so; one without follows the dialogue default and changes with it. Languages hang under the row.
 */
// The sliders and the rules of one console, as elements; and read back from them.
// What each stop of a console control sends, in the reader's words: the two low bands, the middle
// that writes no rule at all, and the two high ones. They follow consoleDirections' own thresholds,
// so the word shown is always the rule that goes out.
const CONSOLE_STOPS = Object.freeze({
  pause: ['不停顿', '停顿少', 'AI 判断', '停顿多', '停顿很多'],
  breath: ['不要呼吸声', '呼吸声少', 'AI 判断', '呼吸感明显', '呼吸感很重'],
  grain: ['利落', '毛边少', 'AI 判断', '口语感强', '口语感很强'],
  intensity: ['情感极淡', '情感偏淡', 'AI 判断', '情感偏浓', '情感很浓'],
  range: ['起伏极小', '起伏偏小', 'AI 判断', '起伏偏大', '起伏很大'],
  speed: ['很慢', '偏慢', 'AI 判断', '偏快', '很快'],
  expression: ['不要声音', '声音克制', 'AI 判断', '声音外放', '声音很外放'],
});

/** The word a console value sends, by the same thresholds the rules are chosen with. */
function consoleWord(key, value) {
  const stops = CONSOLE_STOPS[key];
  if (!stops) return String(value);
  const number = Number(value);
  if (!Number.isFinite(number)) return stops[2];
  if (number <= 15) return stops[0];
  if (number <= 35) return stops[1];
  if (number >= 85) return stops[4];
  if (number >= 65) return stops[3];
  return stops[2];
}

const CONSOLE_LABELS = Object.freeze({ pause: '停顿感', breath: '气息感', grain: '口语颗粒度', intensity: '情感强度', range: '情绪表现幅度', speed: '语速倾向', expression: '声音表现倾向' });

/** The saved consoles, as a dropdown that remembers nothing until the reader picks. */
function consolePresetRow(doc, settings = runtime.settings) {
  const row = doc.createElement('div');
  row.className = 'jy-tts-console-presets';
  const pick = doc.createElement('select');
  pick.dataset.jyConsolePreset = '';
  pick.title = '保存过的调音台，选一个再点「套用」';
  const first = doc.createElement('option');
  first.value = '';
  first.textContent = '预设…';
  pick.appendChild(first);
  for (const preset of normalizeConsolePresets(settings?.consolePresets)) {
    const option = doc.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name;
    pick.appendChild(option);
  }
  const name = doc.createElement('input');
  name.type = 'text';
  name.maxLength = 40;
  name.placeholder = '起个名字，比如「吵架」「深夜」';
  name.dataset.jyConsolePresetName = '';
  const tools = doc.createElement('span');
  tools.className = 'jy-tts-console-preset-tools';
  for (const [action, label, title] of [
    ['console-preset-apply', '套用', '把选中的预设填进这一套调音台'],
    ['console-preset-save', '存为预设', '把现在这一套存起来；名字和已有的一样就覆盖它'],
    ['console-preset-delete', '删除', '删掉选中的预设'],
  ]) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'jy-text-button';
    button.dataset.jyAction = action;
    button.textContent = label;
    button.title = title;
    tools.appendChild(button);
  }
  row.append(pick, name, tools);
  return row;
}

function consoleFieldsElement(doc, console, { scope = 'row' } = {}) {
  const box = doc.createElement('div');
  box.className = 'jy-tts-console';
  box.dataset.jyTtsConsole = scope;
  box.appendChild(consolePresetRow(doc));
  const values = normalizeConsole(console);
  for (const key of CONSOLE_KEYS) {
    const label = doc.createElement('label');
    label.className = 'jy-tts-console-field';
    const name = doc.createElement('span');
    name.textContent = CONSOLE_LABELS[key];
    const input = doc.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '25';
    input.value = String(values[key]);
    input.dataset.jyConsoleKey = key;
    const output = doc.createElement('output');
    output.textContent = consoleWord(key, values[key]);
    label.append(name, input, output);
    box.appendChild(label);
  }
  const rules = doc.createElement('label');
  rules.className = 'jy-tts-console-rules';
  const rulesLabel = doc.createElement('span');
  rulesLabel.className = 'jy-label';
  rulesLabel.textContent = '这个角色的配音规则（一行一条）';
  const textarea = doc.createElement('textarea');
  textarea.rows = 2;
  textarea.spellcheck = false;
  textarea.dataset.jyConsoleRules = '';
  textarea.placeholder = '比如：害羞时不要过度娇柔；紧张时允许轻微呼吸和迟疑';
  textarea.value = values.rules;
  rules.append(rulesLabel, textarea);
  box.appendChild(rules);
  box.appendChild(marksFoldElement(doc, values.marks));
  return box;
}

const MARK_POSITIONS = Object.freeze([['inline', '原位替换'], ['head', '放在句首']]);

// The punctuation marks of one console: a folded list of rows, each a run of punctuation, a catalogue
// word and where the tag goes, with a button for a blank row and one for the recommended pairs.
function marksFoldElement(doc, marks) {
  const fold = doc.createElement('details');
  fold.className = 'jy-tts-marks-fold';
  const summary = doc.createElement('summary');
  summary.dataset.jyMarksSummary = '';
  summary.textContent = marksSummary(marks);
  fold.appendChild(summary);
  const hint = doc.createElement('p');
  hint.className = 'jy-muted';
  hint.textContent = '正文里出现左边的标点时，发给 Fish 的文本里加上右边的标签。「原位替换」把标点换成标签，适合停顿、叹气这类声音；「放在句首」把标签放到这个标点结尾的那句话前面，适合情绪、音量。发出去的是 Fish 官方认得的英文标签。不分析和简单分析两种模式都生效。';
  fold.appendChild(hint);
  const list = doc.createElement('div');
  list.className = 'jy-tts-marks';
  list.dataset.jyMarks = '';
  for (const mark of marks) list.appendChild(markRowElement(doc, mark));
  fold.appendChild(list);
  const tools = doc.createElement('div');
  tools.className = 'jy-tts-marks-tools';
  const add = doc.createElement('button');
  add.type = 'button';
  add.className = 'jy-text-button';
  add.dataset.jyAction = 'tts-add-mark';
  add.textContent = '加一条';
  const recommend = doc.createElement('button');
  recommend.type = 'button';
  recommend.className = 'jy-text-button';
  recommend.dataset.jyAction = 'tts-recommend-marks';
  recommend.textContent = '填入推荐搭配';
  tools.append(add, recommend);
  fold.appendChild(tools);
  return fold;
}

function marksSummary(marks) {
  const list = Array.isArray(marks) ? marks : [];
  return list.length ? `标点情绪标签 · ${list.map(mark => `${mark.punct}→[${mark.tag}]`).join('，')}` : '标点情绪标签 · 没配';
}

function markRowElement(doc, mark = { punct: '', tag: '停顿', at: 'inline' }) {
  const row = doc.createElement('div');
  row.className = 'jy-tts-mark-row';
  row.dataset.jyMarkRow = '';
  const punct = doc.createElement('input');
  punct.type = 'text';
  punct.maxLength = 8;
  punct.placeholder = '标点，比如 ……';
  punct.value = mark.punct ?? '';
  punct.dataset.jyMarkPunct = '';
  punct.setAttribute('aria-label', '标点');
  const tag = doc.createElement('select');
  tag.dataset.jyMarkTag = '';
  tag.setAttribute('aria-label', '标签');
  for (const item of MARK_TAGS) {
    const option = doc.createElement('option');
    option.value = item.label;
    option.textContent = `[${item.label}]`;
    tag.appendChild(option);
  }
  tag.value = mark.tag ?? '停顿';
  const at = doc.createElement('select');
  at.dataset.jyMarkAt = '';
  at.setAttribute('aria-label', '位置');
  for (const [value, label] of MARK_POSITIONS) {
    const option = doc.createElement('option');
    option.value = value;
    option.textContent = label;
    at.appendChild(option);
  }
  at.value = mark.at === 'head' ? 'head' : 'inline';
  const remove = doc.createElement('button');
  remove.type = 'button';
  remove.className = 'jy-text-button';
  remove.dataset.jyAction = 'tts-remove-mark';
  remove.textContent = '×';
  remove.setAttribute('aria-label', '去掉这条');
  row.append(punct, tag, at, remove);
  return row;
}

function fillConsoleFields(box, console) {
  if (!box) return;
  const values = normalizeConsole(console);
  // The default console is static markup on the page; its marks rows and its preset row are built
  // on the first fill, and the preset row is rebuilt every time so a newly saved name shows up in it.
  if (!box.querySelector('.jy-tts-marks-fold')) box.appendChild(marksFoldElement(box.ownerDocument, values.marks));
  const host = box.querySelector('[data-jy-console-preset-host]');
  if (host) host.replaceWith(consolePresetRow(box.ownerDocument));
  for (const input of box.querySelectorAll('[data-jy-console-key]')) {
    input.value = String(values[input.dataset.jyConsoleKey] ?? 50);
    input.step = '25';
    const output = input.nextElementSibling;
    if (output) output.textContent = consoleWord(input.dataset.jyConsoleKey, input.value);
  }
  const rules = box.querySelector('[data-jy-console-rules]');
  if (rules) rules.value = values.rules;
  const list = box.querySelector('[data-jy-marks]');
  if (list) {
    list.replaceChildren();
    for (const mark of values.marks) list.appendChild(markRowElement(list.ownerDocument, mark));
  }
  const summary = box.querySelector('[data-jy-marks-summary]');
  if (summary) summary.textContent = marksSummary(values.marks);
}

function readConsoleFields(box) {
  if (!box) return null;
  const console = {};
  for (const input of box.querySelectorAll('[data-jy-console-key]')) console[input.dataset.jyConsoleKey] = Number(input.value);
  console.rules = box.querySelector('[data-jy-console-rules]')?.value ?? '';
  console.marks = [...box.querySelectorAll('[data-jy-mark-row]')].map(row => ({
    punct: row.querySelector('[data-jy-mark-punct]')?.value ?? '',
    tag: row.querySelector('[data-jy-mark-tag]')?.value ?? '',
    at: row.querySelector('[data-jy-mark-at]')?.value ?? 'inline',
  }));
  return console;
}

function ttsVoiceRowElement(doc, voice, settings = runtime.settings, { open = false } = {}) {
  const row = doc.createElement('details');
  row.className = 'jy-tts-voice-row';
  row.dataset.jyTtsVoiceRow = '';
  row.open = open;
  // Opening one closes the rest, so a table of a dozen characters never becomes a mile of scrolling.
  row.addEventListener('toggle', () => {
    if (!row.open) return;
    for (const other of row.parentElement?.querySelectorAll('[data-jy-tts-voice-row][open]') ?? []) {
      if (other !== row) other.open = false;
    }
    row.scrollIntoView?.({ block: 'nearest' });
  });
  // The fetched title belongs to one id; a row whose id is edited loses it on the next save.
  row.dataset.voiceId = voice.voiceId ?? '';
  row.dataset.title = voice.title ?? '';
  const name = doc.createElement('input');
  name.type = 'text';
  name.maxLength = 60;
  name.placeholder = '角色名（译文里的写法）';
  name.dataset.jyTtsVoiceName = '';
  name.value = voice.name ?? '';
  const aliases = doc.createElement('input');
  aliases.type = 'text';
  aliases.placeholder = '别名，逗号分隔';
  aliases.dataset.jyTtsVoiceAliases = '';
  aliases.value = (voice.aliases ?? []).join('、');
  const scope = doc.createElement('span');
  scope.className = 'jy-tts-pick';
  scope.dataset.jyTtsPickScope = '';
  const voiceId = doc.createElement('input');
  voiceId.type = 'text';
  voiceId.placeholder = '专属 Voice ID（留空则跟随对白默认音色）';
  voiceId.spellcheck = false;
  voiceId.dataset.jyTtsVoiceId = '';
  voiceId.value = voice.voiceId ?? '';
  scope.append(voiceId, ttsLibraryPicker(doc, settings));
  const title = doc.createElement('span');
  title.className = 'jy-tts-title';
  title.dataset.jyTtsVoiceTitle = '';
  title.textContent = voice.title ? voice.title : '';
  const lock = doc.createElement('span');
  lock.className = 'jy-badge jy-tts-lock';
  lock.dataset.jyTtsVoiceLock = '';
  const own = Boolean(voice.voiceId || Object.keys(voice.voices ?? {}).length);
  const muted = voice.mute === true;
  lock.dataset.locked = String(own);
  lock.dataset.muted = String(muted);
  lock.textContent = muted ? '🔇 不朗读' : own ? '🔒 专属音色' : '跟随默认音色';
  lock.title = muted ? '这个角色的对白不会朗读，也不会生成音频。' : own ? '已绑定专属音色，改默认音色不影响这个角色。' : '没有专属音色，读的时候用对白默认音色；填上 Voice ID 就会锁定。';
  // Not a voice setting but a casting one: whether this character is heard at all.
  const silence = doc.createElement('label');
  silence.className = 'jy-tts-voice-mute';
  const silenceBox = doc.createElement('input');
  silenceBox.type = 'checkbox';
  silenceBox.dataset.jyTtsVoiceMute = '';
  silenceBox.checked = muted;
  const silenceText = doc.createElement('span');
  silenceText.textContent = '不朗读这个角色的对白';
  silence.title = '勾上以后，这个角色说的每一句都跳过：不请求、不生成音频、正文里也不给按钮。';
  silence.append(silenceBox, silenceText);
  const tools = doc.createElement('span');
  tools.className = 'jy-tts-voice-tools';
  const addLang = doc.createElement('button');
  addLang.type = 'button';
  addLang.className = 'jy-button jy-tts-lang-button';
  addLang.dataset.jyAction = 'tts-add-lang';
  addLang.textContent = '＋ 多国语言音色';
  addLang.title = '同一个角色读别的语言时用别的音色：中文一个、日语一个、美式英语一个……';
  const unbind = doc.createElement('button');
  unbind.type = 'button';
  unbind.className = 'jy-text-button';
  unbind.dataset.jyAction = 'tts-unbind-voice';
  unbind.textContent = '解除绑定';
  unbind.hidden = !own;
  const remove = doc.createElement('button');
  remove.type = 'button';
  remove.className = 'jy-text-button';
  remove.dataset.jyAction = 'tts-remove-voice';
  remove.textContent = '移除';
  tools.append(addLang, unbind, remove);
  const langs = doc.createElement('div');
  langs.className = 'jy-tts-lang-list';
  langs.dataset.jyTtsVoiceLangs = '';
  for (const [lang, id] of Object.entries(voice.voices ?? {})) langs.appendChild(ttsLanguageRowElement(doc, lang, id, settings));
  // Folded, a row is one line: the name, whether it has a voice of its own, and what is bound.
  const summary = doc.createElement('summary');
  summary.className = 'jy-tts-voice-summary';
  const summaryName = doc.createElement('span');
  summaryName.className = 'jy-tts-voice-summary-name';
  summaryName.dataset.jyTtsVoiceSummaryName = '';
  summaryName.textContent = voice.name || '（未命名）';
  const summaryMeta = doc.createElement('span');
  summaryMeta.className = 'jy-tts-voice-summary-meta';
  summaryMeta.textContent = ttsVoiceRowMeta(voice, settings);
  summary.append(summaryName, lock, summaryMeta);
  // The character's own console, folded under the row; the default one reads for it until set.
  const consoleFold = doc.createElement('details');
  consoleFold.className = 'jy-tts-console-fold';
  consoleFold.open = Boolean(voice.console);
  const consoleSummary = doc.createElement('summary');
  consoleSummary.textContent = voice.console ? '调音台（已单独设置）' : '调音台（跟着默认）';
  consoleFold.append(consoleSummary, consoleFieldsElement(doc, voice.console ?? DEFAULT_CONSOLE, { scope: 'row' }));
  const body = doc.createElement('div');
  body.className = 'jy-tts-voice-body';
  body.append(name, aliases, scope, title, silence, tools, langs, consoleFold);
  row.append(summary, body);
  return row;
}

// A voice id as a reader knows it: the name it has in the library, else Fish's title, else its head.
function ttsVoiceName(voiceId, settings = runtime.settings, title = '') {
  const id = String(voiceId ?? '');
  if (!id) return '';
  const known = normalizeVoiceLibrary(settings?.voiceLibrary).find(entry => entry.voiceId === id);
  return known?.name || title || `${id.slice(0, 6)}…`;
}

function ttsVoiceRowMeta(voice, settings = runtime.settings) {
  const parts = [];
  if (voice.voiceId) parts.push(ttsVoiceName(voice.voiceId, settings, voice.title));
  const langs = Object.entries(voice.voices ?? {});
  if (langs.length) parts.push(langs.map(([code, id]) => `${languageLabel(code)}：${ttsVoiceName(id, settings)}`).join('、'));
  if ((voice.aliases ?? []).length) parts.push(`别名 ${voice.aliases.length}`);
  return parts.join(' · ');
}

/**
 * A voice field whose id is in the library shows the library's name instead of the id: a chip that
 * stands in for the input until it is clicked, when the input comes back for editing. The input keeps
 * its value the whole time, so saving reads the same thing either way.
 */
function syncKnownVoices(root, settings = runtime.settings) {
  const library = normalizeVoiceLibrary(settings?.voiceLibrary);
  const doc = root.ownerDocument;
  for (const scope of root.querySelectorAll('[data-jy-tts-pick-scope]')) {
    const input = scope.querySelector('input');
    if (!input) continue;
    scope.querySelector('.jy-tts-known')?.remove();
    const known = library.find(entry => entry.voiceId === input.value.trim());
    if (!known) {
      input.hidden = false;
      continue;
    }
    const chip = doc.createElement('button');
    chip.type = 'button';
    chip.className = 'jy-tts-known';
    chip.dataset.jyAction = 'tts-edit-voice';
    chip.title = `${known.voiceId}\n点一下改成填 ID`;
    chip.textContent = known.lang ? `${known.name} · ${languageLabel(known.lang)}` : known.name;
    input.hidden = true;
    scope.insertBefore(chip, input);
  }
}

function renderTtsVoiceList(root, settings = runtime.settings) {
  const list = root.querySelector('[data-jy-tts-voice-list]');
  if (!list) return;
  const doc = list.ownerDocument;
  const voices = ttsVoicesFor(settings);
  // Rows being edited stay open across a redraw.
  const open = new Set([...list.querySelectorAll('[data-jy-tts-voice-row][open]')].map(row => row.querySelector('[data-jy-tts-voice-name]')?.value.trim()).filter(Boolean));
  list.replaceChildren();
  if (!voices.length) {
    const note = doc.createElement('p');
    note.className = 'jy-muted';
    note.textContent = '还没有登记角色。没登记的角色用对白默认音色读，不会不读。可以从角色卡和世界书一键识别角色。';
    list.appendChild(note);
    return;
  }
  for (const voice of voices) list.appendChild(ttsVoiceRowElement(doc, voice, settings, { open: open.has(voice.name) }));
}

// The reading page folds its four sections; which are open is remembered in this browser.
const TTS_FOLD_KEY = `${MODULE_ID}.tts-folds.v1`;

function readTtsFolds() {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(TTS_FOLD_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeTtsFold(id, open) {
  try {
    const folds = readTtsFolds();
    folds[id] = open;
    globalThis.localStorage?.setItem(TTS_FOLD_KEY, JSON.stringify(folds));
  } catch {
    // Storage refused: the folds simply start from their defaults next time.
  }
}

function syncTtsFolds(root, settings = runtime.settings) {
  const tts = ttsSettings(settings);
  const stored = readTtsFolds();
  // Nothing set up yet: the Fish section is what needs filling first; the cast is what gets edited most.
  const defaults = { 'tts-read': false, 'tts-fish': !tts.fish.key, 'tts-voices': true, 'tts-library': false };
  for (const details of root.querySelectorAll('details[data-jy-fold]')) {
    const id = details.dataset.jyFold;
    details.open = typeof stored[id] === 'boolean' ? stored[id] : (defaults[id] ?? true);
  }
  if (!root.dataset.jyTtsFolds) {
    root.dataset.jyTtsFolds = 'bound';
    // toggle does not bubble; a capturing listener on the root still hears every fold.
    root.addEventListener('toggle', event => {
      const details = event.target;
      if (details instanceof Element && details.matches('details[data-jy-fold]')) writeTtsFold(details.dataset.jyFold, details.open);
    }, true);
  }
}

// One line per folded section saying what is in it, so nothing has to be opened to be checked.
function syncTtsFoldSummaries(root, settings = runtime.settings) {
  const tts = ttsSettings(settings);
  const voices = ttsVoicesFor(settings);
  const owned = voices.filter(row => row.voiceId || Object.keys(row.voices ?? {}).length).length;
  const library = normalizeVoiceLibrary(settings?.voiceLibrary);
  const summaries = {
    'tts-read': `${tts.side === 'source' ? '读原文' : '读译文'} · ${TTS_RANGE_LABELS[tts.range]} · ${TTS_MODE_LABELS[tts.mode]}模式`,
    'tts-fish': `${tts.fish.key ? `已填 Key · ${tts.fish.model}` : '还没填 API Key'} · ${{ floor: '整楼一次', line: '每段一次', sentence: '每句一次' }[tts.requestUnit] ?? '每段一次'}`,
    'tts-voices': `旁白${tts.narratorVoice ? '已设' : '未设'} · 对白默认${tts.dialogueVoice ? '已设' : '未设'} · ${voices.length} 个角色（${owned} 个专属）${tts.voiceScope === 'chat' ? ' · 每个聊天一份' : ''}`,
    'tts-library': library.length ? `${library.length} 个音色` : '空',
    'tts-deep': DEEP_STATUS.available ? (tts.deepChannelId ? `走 ${channelLabel(settings, tts.deepChannelId, { short: true })}` : '和朗读分析同一条连接') : DEEP_STATUS.note,
  };
  for (const [id, text] of Object.entries(summaries)) setText(root, `[data-jy-fold="${id}"] [data-jy-fold-summary]`, text);
  setText(root, '[data-jy-tts-scope-note]', tts.voiceScope === 'chat'
    ? (ttsVoicesOwned(settings)
      ? '这张表只属于当前聊天，别的聊天看不到。'
      : '当前聊天还没有自己的表，显示的是角色卡的表；在这里改动并保存后，会成为本聊天自己的一份，角色卡的表不变。')
    : '这张卡的所有聊天共用这张表。同一张卡开了几个周目、各有各的人物，就改成「每个聊天单独一份」。音色库不受这个影响，永远全局共用。');
}

function ttsLibraryRowElement(doc, voice) {
  const row = doc.createElement('div');
  row.className = 'jy-tts-library-row';
  row.dataset.jyTtsLibraryRow = '';
  row.dataset.id = voice.id ?? '';
  row.dataset.voiceId = voice.voiceId ?? '';
  row.dataset.title = voice.title ?? '';
  const name = doc.createElement('input');
  name.type = 'text';
  name.maxLength = 60;
  name.placeholder = '自定义名字，比如「少年·清亮」';
  name.dataset.jyTtsLibraryName = '';
  name.value = voice.name ?? '';
  const id = doc.createElement('input');
  id.type = 'text';
  id.placeholder = 'Fish Voice ID';
  id.spellcheck = false;
  id.dataset.jyTtsLibraryId = '';
  id.value = voice.voiceId ?? '';
  const lang = ttsLanguageSelect(doc, voice.lang || 'zh');
  lang.dataset.jyTtsLibraryLang = '';
  delete lang.dataset.jyTtsLangCode;
  const title = doc.createElement('span');
  title.className = 'jy-tts-title';
  title.textContent = voice.title ?? '';
  const remove = doc.createElement('button');
  remove.type = 'button';
  remove.className = 'jy-text-button';
  remove.dataset.jyAction = 'tts-remove-library';
  remove.textContent = '移除';
  row.append(name, id, lang, title, remove);
  return row;
}

function renderTtsLibrary(root, settings = runtime.settings) {
  const list = root.querySelector('[data-jy-tts-library]');
  if (!list) return;
  const doc = list.ownerDocument;
  const library = normalizeVoiceLibrary(settings?.voiceLibrary);
  list.replaceChildren();
  if (!library.length) {
    const note = doc.createElement('p');
    note.className = 'jy-muted';
    note.textContent = '音色库是空的。把常用的 Voice ID 起个名字存进来，之后给角色、旁白选音色就不用再翻 ID。';
    list.appendChild(note);
    return;
  }
  for (const voice of library) list.appendChild(ttsLibraryRowElement(doc, voice));
}

function renderNarratorLanguages(root, settings = runtime.settings) {
  const list = root.querySelector('[data-jy-tts-narrator-langs]');
  if (!list) return;
  const doc = list.ownerDocument;
  const tts = ttsSettings(settings);
  list.replaceChildren();
  for (const [lang, id] of Object.entries(tts.narratorVoices)) list.appendChild(ttsLanguageRowElement(doc, lang, id, settings));
}

// Fills the pickers next to the narrator and dialogue fields, which are typed in the markup.
function syncTtsPickers(root, settings = runtime.settings) {
  const doc = root.ownerDocument;
  for (const scope of root.querySelectorAll('[data-jy-tts-page-pick]')) {
    scope.querySelector('[data-jy-tts-pick]')?.remove();
    scope.appendChild(ttsLibraryPicker(doc, settings));
  }
}

function updateTtsProxyHelp(root) {
  const proxy = root.querySelector('[data-jy-tts-fish="viaProxy"]');
  const help = root.querySelector('[data-jy-tts-proxy-help]');
  if (!help) return;
  if (detectTtsHost() === 'tauritavern') {
    if (proxy) proxy.disabled = true;
    help.textContent = '你在 TauriTavern 里：它没有酒馆那条 CORS 代理，这个开关不起作用，请求会直接发出去。api.fish.audio 不让网页直接访问，所以「接口地址」要填一个自己的、带跨域头的转发地址（使用手册第六节有现成的 Cloudflare Worker 脚本），或者等 TauriTavern 加上通用代理。Key 只发给你填的那个地址。';
    return;
  }
  if (proxy) proxy.disabled = false;
  help.textContent = proxy?.checked !== false
    ? 'api.fish.audio 不允许浏览器直接访问，请求要经酒馆服务端转发。第一次用之前，在酒馆目录的 config.yaml 里把 enableCorsProxy 改成 true，然后重启酒馆。Key 只发给你自己的酒馆和 Fish。'
    : '直连只适合允许跨域访问的中转地址或本地 fish-speech 服务。填官方地址直连会被浏览器拦下。';
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

async function renderTtsUsage(root) {
  const target = root.querySelector('[data-jy-tts-usage]');
  if (!target) return;
  try {
    const store = ttsStore();
    const usage = await store.usage();
    target.textContent = `已缓存 ${usage.entries} 段音频，共 ${formatBytes(usage.bytes)}。${usage.backend === 'memory' ? `${store.note || '当前只保存在本次会话里。'}` : '保存在这个浏览器里，不进聊天记录，换设备不会跟过去。'}`;
  } catch (error) {
    target.textContent = `读取缓存失败：${safeError(error)}`;
  }
}

function syncTtsFields(root, settings = runtime.settings) {
  if (!root.querySelector('[data-jy-page="tts"]')) return;
  const tts = ttsSettings(settings);
  for (const element of root.querySelectorAll('[data-jy-tts-field]')) {
    const key = element.dataset.jyTtsField;
    const value = key === 'sourceTags' ? tts.sourceTags.join(', ')
      : key === 'quotePairs' || key === 'skipPairs' ? formatPairList(tts[key])
        : tts[key];
    if (element.type === 'radio') element.checked = element.value === String(value);
    else if (element.type === 'checkbox') element.checked = value === true;
    else element.value = value ?? '';
  }
  for (const element of root.querySelectorAll('[data-jy-tts-fish]')) {
    const value = tts.fish[element.dataset.jyTtsFish];
    if (element.type === 'checkbox') element.checked = value === true;
    else element.value = value ?? '';
  }
  for (const element of root.querySelectorAll('[data-jy-tts-context]')) {
    const value = tts.context[element.dataset.jyTtsContext];
    if (element.type === 'checkbox') element.checked = value === true;
    else element.value = value ?? '';
  }
  fillConsoleFields(root.querySelector('[data-jy-tts-console="default"]'), tts.console);
  // The built-in prompt shows as the placeholder, so an empty box means "the default, whatever it is".
  for (const element of root.querySelectorAll('[data-jy-tts-prompt]')) {
    element.value = tts.prompts[element.dataset.jyTtsPrompt] ?? '';
    element.placeholder = TTS_PROMPT_DEFAULTS[element.dataset.jyTtsPrompt] ?? '';
  }
  // The reading's own choice of connection, and the deep reading's: the host's own or a saved one.
  // Nothing here follows the translation; an old 「follow the translation」 was pinned when read.
  const analysisChoice = resolveFeatureChannel(tts.analysisChannelId, settings);
  const analysisSelect = root.querySelector('[data-jy-tts-field="analysisChannelId"]');
  if (analysisSelect) fillChannelPicker(analysisSelect, settings, analysisChoice);
  const deepSelect = root.querySelector('[data-jy-tts-field="deepChannelId"]');
  if (deepSelect) fillChannelPicker(deepSelect, settings, tts.deepChannelId || '', { lead: { value: '', text: `和朗读分析用同一条：${channelLabel(settings, analysisChoice, { short: true })}` } });
  const callSelect = root.querySelector('[data-jy-tts-field="callChannelId"]');
  if (callSelect) fillChannelPicker(callSelect, settings, tts.callChannelId || '', { lead: { value: '', text: `和朗读分析用同一条：${channelLabel(settings, analysisChoice, { short: true })}` } });
  const cloud = root.querySelector('[data-jy-stt-cloud]');
  if (cloud) cloud.hidden = tts.sttProvider !== 'cloud';
  setText(root, '[data-jy-tts-title="narrator"]', tts.narratorTitle ? `· ${tts.narratorTitle}` : '');
  setText(root, '[data-jy-tts-title="dialogue"]', tts.dialogueTitle ? `· ${tts.dialogueTitle}` : '');
  syncTtsPickers(root, settings);
  renderNarratorLanguages(root, settings);
  renderTtsVoiceList(root, settings);
  renderTtsLibrary(root, settings);
  syncTtsFolds(root, settings);
  syncTtsFoldSummaries(root, settings);
  syncKnownVoices(root, settings);
  updateTtsProxyHelp(root);
  updateTtsModeHelp(root);
  updateTtsUnitHelp(root, settings);
  renderTtsPreview(root);
  syncTtsFeatureVisibility(root, settings);
  // The audio store is opened only for someone who reads aloud.
  if (tts.enabled) void renderTtsUsage(root);
}

// The line under 「一次请求发多少」: what the choice buys and what it costs, for the model chosen.
function updateTtsUnitHelp(root, settings = runtime.settings) {
  const help = root.querySelector('[data-jy-tts-unit-help]');
  if (!help) return;
  const tts = ttsSettings(settings);
  const unit = root.querySelector('[data-jy-tts-field="requestUnit"]')?.value ?? tts.requestUnit;
  const model = root.querySelector('[data-jy-tts-fish="model"]')?.value ?? tts.fish.model;
  if (unit === 'floor') {
    help.textContent = [
      '整楼一次：这一楼要读的句子按顺序排好，所有角色连同旁白放进同一个请求，各用各的音色，Fish 当成一场对话连着读，人和人之间的衔接更自然。',
      '音频是 mp3 时不用等整楼做完：Fish 送回来的段落一段收全就先播这一段，后面边收边接上；opus、wav 还是整楼做完才出声。点单句、单段播放，要等那一段收到。',
      '整楼只有一个语速音量：分析给某句的快慢轻重、调音台的语速倾向在这种方式下不单独生效，情绪、语气、停顿、重读这些标签照旧。',
      model === 's1' ? 's1 不能在一个请求里用多个音色，整楼会按说话人拆开，想要一次就换 S2 系列模型。' : '',
      `超过「一次请求最多字数」（声音参数里，现在是 ${tts.fish.maxChars}）才拆。字数按发给 Fish 的原样算：情绪、停顿这些标签，每次换人的说话人标记（一个 13 字），都算；对白来回多的楼，发出去的字能到正文的两倍多。`,
      '要拆只在段落之间拆（一段自己就超过上限，才在这段里面拆）：先挑旁白开头的段落，其次前后情绪一样的地方，情绪正在转折的地方尽量不拆，拆出的几次尽量一样长。想整楼真的一次，就把字数调大，最多 10000（Fish 一次最多收这么多）。',
      '没配音色的句子不能和有音色的混在一个请求里，旁白音色和对白默认音色都填上就不会因为这个被拆。',
      '改了这项，已经做好的音频会按新方式重做。',
    ].filter(Boolean).join('');
    return;
  }
  help.textContent = unit === 'sentence'
    ? '每句一次：每句话单独一个请求，一句做好播一句，请求数最多、每个最短。和「每段一次」做出来的声音共用，切换不会重做。'
    : '每段一次：一段一个请求，几段同时做（上面「同时生成几段」），第一段做好就开始播。一段里有几个人说话，本来就在同一个请求里各用各的音色；想让整楼所有人在一个请求里连着读，选「整楼一次」。';
}

// The line under the mode choice says what the analysis setting comes to in this mode.
function updateTtsModeHelp(root) {
  const help = root.querySelector('[data-jy-tts-mode-help]');
  if (!help) return;
  const mode = root.querySelector('[data-jy-tts-field="mode"]')?.value ?? 'simple';
  // What to do with a floor nobody translated or analysed is the plain reading's question alone: the
  // others analyse such a floor as a matter of course.
  const askField = root.querySelector('[data-jy-tts-ask-field]');
  if (askField) askField.hidden = mode !== 'off';
  if (mode === 'off') {
    help.textContent = '不分析：不额外请求副模型。翻译过的楼直接用翻译时标好的说话人和情绪——翻译那一次请求本身带了分析；正文里带 <say> 说话人标记的楼，按标记分角色、带情绪读（「03 音色」里打开「让主模型给台词标上说话人和情绪」，主模型写的台词就会带标记）；其余的楼由程序按上下文认谁在说，认不出的用对白默认音色。想让副模型认一次，点朗读页的「分析这一楼」，或者在右边选按播放时怎么办。';
    return;
  }
  if (mode === 'simple') {
    help.textContent = '简单分析：开着翻译时，说话人和情绪随翻译一起标好，零次额外调用；不开翻译时，正文一闭合就把原文发给副模型标一次，只回对白的说话人和情绪，快。走「01 读什么」里选的朗读分析连接。';
    return;
  }
  help.textContent = mode === 'deep'
    ? '深度分析：正文一闭合就把原文发给副模型，不等翻译、也不用翻译的标注，一次请求：对白由谁念、什么情绪、一句里情绪在哪里变、哪里停顿重读、哪里有叹气笑声这类声音，全是 Fish 官方认得的标签，旁白不管。带角色资料、世界书和前一楼（在「05 深度分析」栏里勾）。读译文时把结果对到译文上。走「05 深度分析」栏里选的连接。'
    : '简单模式：开着翻译时零次额外调用，翻译时顺手标好的骨架直接转成 Fish 能读的中文指令；不开翻译或没骨架的楼问一次副模型。一段一次 Fish 请求，几段一起发，先到先播。';
}

/**
 * Ordinary mode: the 朗读 tab is not in the rail and the page shows only its own switch.
 *
 * The feature is switched on from the desk, where the other big switch already lives, so the tab only
 * appears for someone who asked for it. A page switched off while it is open stays open with just the
 * switch on it, so turning it back on is one click rather than a trip back to the desk; the tab goes
 * once the reader moves elsewhere.
 */
function syncTtsFeatureVisibility(root, settings = runtime.settings) {
  const enabled = ttsSettings(settings).enabled;
  const tab = root.querySelector('[data-jy-tab="tts"]');
  if (tab) tab.hidden = !enabled && tab.getAttribute('aria-selected') !== 'true';
  const page = root.querySelector('[data-jy-page="tts"]');
  if (page) page.dataset.jyTtsOff = String(!enabled);
  const shortcut = root.querySelector('[data-jy-action="open-tts"]');
  if (shortcut) shortcut.hidden = !enabled;
}

function collectTtsFields(root, current) {
  if (!root.querySelector('[data-jy-page="tts"]')) return;
  const previous = ttsSettings(current);
  const next = { ...previous, fish: { ...previous.fish } };
  for (const element of root.querySelectorAll('[data-jy-tts-field]')) {
    const key = element.dataset.jyTtsField;
    if (element.type === 'radio') {
      if (element.checked) next[key] = element.value;
    } else if (element.type === 'checkbox') {
      next[key] = element.checked;
    } else if (key === 'sourceTags') {
      const parsed = parseTagNamesWithErrors(element.value);
      if (parsed.invalid.length) throw new Error(`无法识别朗读来源标签：${parsed.invalid.join('、')}。`);
      next.sourceTags = parsed.tags;
    } else {
      next[key] = element.value.trim();
    }
  }
  for (const element of root.querySelectorAll('[data-jy-tts-fish]')) {
    const key = element.dataset.jyTtsFish;
    if (element.type === 'checkbox') next.fish[key] = element.checked;
    else if (TTS_NUMERIC_FISH_FIELDS.has(key)) next.fish[key] = Number(element.value);
    else next.fish[key] = element.value.trim();
  }
  next.context = { ...previous.context };
  for (const element of root.querySelectorAll('[data-jy-tts-context]')) {
    const key = element.dataset.jyTtsContext;
    next.context[key] = element.type === 'checkbox' ? element.checked : Number(element.value);
  }
  next.prompts = { ...previous.prompts };
  for (const element of root.querySelectorAll('[data-jy-tts-prompt]')) next.prompts[element.dataset.jyTtsPrompt] = element.value;
  const defaultConsole = root.querySelector('[data-jy-tts-console="default"]');
  if (defaultConsole) next.console = normalizeConsole(readConsoleFields(defaultConsole));
  for (const [field, title] of [['narratorVoice', 'narratorTitle'], ['dialogueVoice', 'dialogueTitle']]) {
    if (next[field] && next[field] !== normalizeTts({ [field]: next[field] })[field]) throw new Error(`「${field === 'narratorVoice' ? '旁白音色' : '对白默认音色'}」不是有效的 Voice ID。`);
    if (next[field] !== previous[field]) next[title] = '';
  }
  next.narratorVoices = readLanguageRows(root.querySelector('[data-jy-tts-narrator-langs]'));
  current.tts = normalizeTts(next);
  const libraryRows = [...root.querySelectorAll('[data-jy-tts-library-row]')].map(row => {
    const voiceId = row.querySelector('[data-jy-tts-library-id]')?.value.trim() ?? '';
    return {
      id: row.dataset.id || `voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: row.querySelector('[data-jy-tts-library-name]')?.value ?? '',
      voiceId,
      lang: row.querySelector('[data-jy-tts-library-lang]')?.value ?? '',
      title: voiceId === row.dataset.voiceId ? row.dataset.title : '',
    };
  });
  if (root.querySelector('[data-jy-tts-library]')) current.voiceLibrary = normalizeVoiceLibrary(libraryRows);
  if (!root.querySelector('[data-jy-tts-voice-list]')) return;
  const rows = [...root.querySelectorAll('[data-jy-tts-voice-row]')].map(row => {
    const voiceId = row.querySelector('[data-jy-tts-voice-id]')?.value.trim() ?? '';
    const voices = readLanguageRows(row.querySelector('[data-jy-tts-voice-langs]'));
    return {
      name: row.querySelector('[data-jy-tts-voice-name]')?.value ?? '',
      aliases: row.querySelector('[data-jy-tts-voice-aliases]')?.value ?? '',
      voiceId,
      voices,
      // Locked exactly when the row has a voice of its own; clearing the ids unlocks it.
      locked: Boolean(voiceId || Object.keys(voices).length),
      mute: row.querySelector('[data-jy-tts-voice-mute]')?.checked === true,
      title: voiceId === row.dataset.voiceId ? row.dataset.title : '',
      console: readConsoleFields(row.querySelector('[data-jy-tts-console="row"]')),
    };
  });
  const list = normalizeVoiceList(rows);
  current.ttsVoices = { ...(current.ttsVoices || {}) };
  const tableKey = ttsVoicesKey(current);
  // A chat-scoped table is written even when empty, so an emptied chat does not fall back to the card.
  if (list.length || tableKey !== worldInfoCharacterKey()) current.ttsVoices[tableKey] = list;
  else delete current.ttsVoices[tableKey];
}

// Where the people of this story are written down, most particular first: this card's own books, this
// chat's, the reader's persona's, then whatever is switched on for every chat. The old order put the
// global books first and cut the list at two hundred entries, so a large global book pushed the
// card's own book out of the request altogether.
const CAST_LORE_ORDER = Object.freeze(['characterLore', 'chatLore', 'personaLore', 'globalLore']);
// How much entry text one request may carry, and how much of any one entry. A title and its keys
// always go; the content is what the budget is spent on, in the order above.
const CAST_CONTENT_BUDGET = 30000;
const CAST_ENTRY_LIMIT = 800;
const CAST_STORY_LIMIT = 4000;

/** The lore entries the cast is read from: in the order above, each once, the ones switched off left out. */
function castLoreEntries() {
  const lore = runtime.wiEntries;
  if (!lore || typeof lore !== 'object') return [];
  const seen = new Set();
  const entries = [];
  for (const source of CAST_LORE_ORDER) {
    for (const entry of Array.isArray(lore[source]) ? lore[source] : []) {
      // An entry the reader switched off is not part of this story, and neither is anyone in it.
      if (!entry || typeof entry !== 'object' || entry.disable === true) continue;
      const key = `${entry.world}.${entry.uid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }
  return entries;
}

/** The cards whose people are in this chat: the character's, or every member's in a group chat. */
function castCards(context) {
  const characters = Array.isArray(context.characters) ? context.characters : [];
  if (context.groupId !== null && context.groupId !== undefined) {
    const group = (Array.isArray(context.groups) ? context.groups : []).find(item => String(item?.id) === String(context.groupId));
    const muted = new Set(Array.isArray(group?.disabled_members) ? group.disabled_members : []);
    return (Array.isArray(group?.members) ? group.members : [])
      .filter(member => !muted.has(member))
      .map(member => characters.find(character => character?.avatar === member))
      .filter(Boolean);
  }
  const character = characters[Number(context.characterId)];
  return character ? [character] : [];
}

/** The last floors of the chat as plain words: how the story itself spells its people. */
function castStorySample(context, limit = CAST_STORY_LIMIT) {
  const chat = Array.isArray(context.chat) ? context.chat : [];
  const parts = [];
  let size = 0;
  for (let index = chat.length - 1; index >= 0 && size < limit; index -= 1) {
    const message = chat[index];
    if (!message || message.is_system || typeof message.mes !== 'string') continue;
    const text = plainLineText(stripGeneratedTranslationLines(message.mes, message.extra?.[MESSAGE_META_KEY])).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const piece = text.slice(-(limit - size));
    parts.unshift(piece);
    size += piece.length;
  }
  return parts.join('\n');
}

/**
 * Finds the cast in the character card and the worldbook.
 *
 * The cards and the entries the host reports go to the secondary model with the question 'who in here
 * is a person', with the last floors of the chat alongside so a name comes back spelled the way the
 * story spells it. The answer is names and aliases only, and every one of them is checked here
 * (`refineCast`): a name that occurs nowhere in the card, the lore or the story is the model's own
 * invention, a crowd or a role is not a character, the reader is not cast, and two spellings of one
 * person are one row. There is deliberately no guess without the model: a worldbook is mostly rules,
 * places and formats, and a list made from its titles is a list of rubbish.
 *
 * Returns `{ cast, dropped, entries }`; each person carries `seen`, whether the story mentions them yet.
 */
async function importCastFromWorldbook(settings = runtime.settings, { signal } = {}) {
  const context = getContext();
  let entries = castLoreEntries();
  if (!entries.length) {
    // The host only reports entries after a scan; a dry scan is enough to make it.
    try { await context.getWorldInfoPrompt?.([''], 8, true); } catch { /* best-effort */ }
    entries = castLoreEntries();
  }
  const substitute = typeof context.substituteParams === 'function' ? value => String(context.substituteParams(value) ?? value) : value => value;
  const flat = value => substitute(String(value ?? '')).replace(/\s+/g, ' ').trim();
  // What the checking step reads: every word of the cards and the entries, whole.
  const sources = [];
  let budget = CAST_CONTENT_BUDGET;
  const digest = [];
  for (const entry of entries.slice(0, 400)) {
    const title = flat(entry.comment).slice(0, 60);
    const keys = (Array.isArray(entry.key) ? entry.key : []).map(key => flat(key).slice(0, 40)).filter(Boolean).slice(0, 8);
    const whole = flat(entry.content);
    const content = whole.slice(0, Math.max(0, Math.min(CAST_ENTRY_LIMIT, budget)));
    budget -= content.length;
    if (!title && !keys.length && !content) continue;
    digest.push({ title, keys, content });
    sources.push(title, ...keys, whole);
  }
  // The cards are a source of people too: their own protagonists, and whoever their text names.
  const cards = castCards(context).map(character => {
    const name = flat(character?.name).slice(0, 60);
    const text = [character?.description, character?.personality, character?.scenario].map(flat).filter(Boolean).join(' ');
    sources.push(name, text);
    return { title: `角色卡：${name}`, keys: name ? [name] : [], content: text.slice(0, 3000) };
  }).filter(card => card.keys.length || card.content);
  if (!digest.length && !cards.length) throw new Error('没有可读的世界书条目，也没有角色卡。先给这个角色启用一本世界书，或者发一条消息让酒馆扫描一次，再来识别。');
  const story = castStorySample(context);
  const cardNames = cards.flatMap(card => card.keys);
  const messages = [
    {
      role: 'system',
      content: [
        '下面是一场角色扮演用到的角色卡和世界书条目（entries：标题、关键词、内容片段），还有最近几楼正文（story，只用来确认名字在故事里怎么写）。请找出其中所有具体的人物角色，也就是剧情里会开口说话的人。',
        '只输出一个 JSON 对象：{"characters":[{"name":"名字","aliases":["别名"],"lang":"zh"}]}',
        '1. 只列具体的一个个人。地点、物品、组织、种族、群体，职业或身份的泛称（村民、店员、士兵们、路人），设定、规则、格式说明、写作指导、状态栏、系统提示，都不是人物；标题像「XX 条目」「XX 设定」「XX 指导」「XX 规则」的条目通常不是人物，除非内容里明确写了一个人。',
        '2. name 写 story 里实际用的称呼；story 里还没出现的人，写条目里最常用、最完整的称呼。aliases 放同一个人的其他写法（原文名、昵称、姓氏、称号），必须是条目、角色卡或 story 里真的出现过的写法，没有就给空数组。不要翻译名字，不要自己造写法。',
        '3. 同一个人只列一次，别的写法都放进 aliases。',
        '4. lang 是这个人主要说的语言代码（zh、en、ja、ko、de、fr……），英语可以细分 en-US / en-GB，看不出就省略。',
        `5. ${context.name1 ? `用户扮演的角色叫 ${context.name1}，不列。` : ''}${cardNames.length ? `标题以「角色卡：」开头的是当前角色卡，主角是 ${cardNames.join('、')}，照常列出。` : ''}`,
        '6. 不要编造条目里没有的人。只在 story 里出现、角色卡和条目里都没有的人不用列。没有人物就输出 {"characters":[]}。',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify({ task: 'list_characters_from_worldbook', entries: [...cards, ...digest], ...(story ? { story } : {}) }) },
  ];
  let raw;
  const request = ttsRequestSettings(settings);
  try {
    raw = await requestSubModelRaw(messages, request, signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    recordDiagnostic('error', 'tts.cast-import', `副模型识别角色失败：${safeError(error)}`, {
      entries: digest.length, cards: cards.length, apiMode: request.apiMode, endpoint: describeChannelEndpoint(request),
    }, describeRequestFailure(error), { fullRequest: messages });
    throw new Error(`识别角色需要副模型，这次没有回应：${safeError(error)} 识别走的是朗读分析用的连接「${channelLabel(settings, resolveFeatureChannel(ttsSettings(settings).analysisChannelId, settings), { short: true })}」，可以在朗读页「01 读什么」里换一条，或者去「模型连接」页检查它。`);
  }
  const answered = [];
  for (const candidate of parseJsonCandidates(raw)) {
    const list = Array.isArray(candidate) ? candidate : Array.isArray(candidate?.characters) ? candidate.characters : [];
    for (const item of list) {
      answered.push({
        name: String(item?.name ?? item ?? '').slice(0, 80),
        aliases: Array.isArray(item?.aliases) ? item.aliases.map(alias => String(alias ?? '').slice(0, 80)) : [],
        lang: normalizeLanguageCode(item?.lang),
      });
    }
    if (answered.length) break;
  }
  const { cast, dropped } = refineCast(answered, {
    sourceText: sources.filter(Boolean).join('\n'),
    storyText: story,
    exclude: [context.name1].filter(Boolean),
  });
  recordDiagnostic(cast.length ? 'info' : 'warn', 'tts.cast-import', cast.length
    ? `副模型从 ${cards.length} 张角色卡和 ${digest.length} 条世界书条目里识别出 ${cast.length} 个角色${dropped.length ? `，另有 ${dropped.length} 个说法没通过核对` : ''}。`
    : `副模型没有从角色卡和 ${digest.length} 条世界书条目里识别出人物${dropped.length ? `（${dropped.length} 个说法没通过核对）` : ''}。`, {
    entries: digest.length,
    cards: cards.length,
    characters: cast.map(person => person.name),
    dropped: dropped.map(item => `${item.name}：${item.reason}`),
  }, raw, { fullRequest: messages });
  return { cast, dropped, source: 'model', entries: digest.length };
}

// ---------------------------------------------------------------------------------------------
// The request for speaker marks. With the switch on, every reply the main model writes goes out with
// a system message at depth 0 — after the last message, the last thing it reads before it writes —
// asking it to wrap each line of dialogue as <say who="名字" mood="情绪">「……」</say>. The reading then
// knows who says each line, and how, from the text itself: several voices with no request to anybody.
// The marks are hidden where the floor is drawn, stripped from what the translator is sent, and kept
// in the main model's own context so it goes on writing them.
// ---------------------------------------------------------------------------------------------

// The host's own numbers for 「in the chat, at a depth」 and 「as the system」: extension_prompt_types.IN_CHAT
// and extension_prompt_roles.SYSTEM, which the context does not hand to extensions.
const SPEECH_PROMPT_KEY = `${MODULE_ID}-speech-marks`;
const SPEECH_PROMPT_IN_CHAT = 1;
const SPEECH_PROMPT_SYSTEM = 0;

/** The names the entry asks the story to mark its dialogue with: the voice table, the palette, the cards. */
function speechRoster(settings = runtime.settings) {
  const context = getContext();
  const names = [];
  const add = name => {
    const clean = String(name ?? '').trim();
    if (clean && clean !== context.name1 && !names.includes(clean)) names.push(clean);
  };
  for (const row of ttsVoicesFor(settings)) add(row.name);
  for (const speaker of speakerPaletteFor(settings)) add(speaker.name);
  for (const card of castCards(context)) add(card?.name);
  return names.slice(0, 40);
}

/**
 * The quotation marks the story has been writing its dialogue in, so the request does not change them.
 * Counted in the prose only: every mark carries four " of its own in who="" and mood="", and so does
 * any styled HTML, and counted with them a floor full of marks would vote for "" every time.
 */
function storyQuotePair(context, settings = runtime.settings) {
  const pairs = parsePairList(ttsSettings(settings).quotePairs);
  const recent = (Array.isArray(context.chat) ? context.chat : []).filter(message => message && !message.is_user && !message.is_system).slice(-4)
    .map(message => withoutSpeechMarks(String(message.mes ?? '')).replace(/<[^<>]*>/g, '')).join('\n');
  let best = null;
  let most = 0;
  for (const pair of pairs) {
    // A pair whose two marks are the same character is seen twice per quotation.
    const seen = recent.split(pair.open).length - 1;
    const count = pair.open === pair.close ? Math.floor(seen / 2) : seen;
    if (count > most) {
      best = pair;
      most = count;
    }
  }
  return best ?? pairs[0] ?? { open: '「', close: '」' };
}

/** The request's words: this cast's names, the story's own quotation marks, the moods the reading understands. */
function speechPromptContent(settings = runtime.settings, context = getContext()) {
  const names = speechRoster(settings);
  const quote = storyQuotePair(context, settings);
  const moods = [...new Set(SPEECH_MOODS.map(([word]) => word))].join('、');
  const tones = SPEECH_TONES.map(([word]) => word).join('、');
  // The " of who="" and mood="" is what a closing quotation mark most often turns into. Said outright,
  // unless the story itself quotes with " and the warning would forbid its own quotation marks.
  const attributeQuotes = quote.open === '"' || quote.close === '"'
    ? ''
    : 'who="" 和 mood="" 里的英文双引号 " 只属于标签，绝不能拿来给台词收尾。';
  return [
    SPEECH_ENTRY_HEAD,
    '这是输出格式要求，写这一轮回复时必须遵守。',
    '正文里角色说出口的每一句台词，都连同它的引号一起放进 <say> 标签，标明是谁说的、带什么情绪。格式固定为：',
    `<say who="说话人" mood="情绪">${quote.open}台词${quote.close}</say>`,
    `1. 引号必须成对：这个故事的台词用 ${quote.open}${quote.close}。标签里以 ${quote.open} 开头、以 ${quote.close} 结尾，${quote.close} 后面紧跟 </say>。${attributeQuotes}`,
    `2. who 写说话人的名字。${names.length ? `这些人照抄这个写法：${names.join('、')}。` : ''}名单外的人写正文里对他的称呼。`,
    `3. mood 从这些词里选一个最贴切的：${moods}。要表现音量或语速，可以再加一个：${tones}，用顿号隔开，比如 mood="生气、大喊"。拿不准就写「平静」。`,
    '4. 只包说出口的台词。旁白、动作、心理描写不包；几个人轮流说话，每一句各包各的；同一个人的话被旁白隔开，前后两截各包各的。',
    '5. 标签只是给朗读程序的记号：不要在正文里提到它，不要因为它改变文风、引号的写法或者台词的多少。',
    `6. 写完逐句核对：每个 <say …> 都有自己的 </say>，每个 </say> 前面紧挨着的都是 ${quote.close}。`,
    `例：{{char}}放下茶杯。<say who="{{char}}" mood="温柔">${quote.open}回来啦？${quote.close}</say>`,
  ].join('\n');
}

/**
 * Puts the request for marks into the main model's next prompt, or takes it out. Called whenever what
 * it says could change — the switch, the voice table, another chat — and once more as each reply
 * starts, with that reply's kind: a summary or an impersonation is not the story and gets no marks.
 * True when the request is in.
 */
function syncSpeechPrompt(type = null) {
  const context = getContext();
  const tts = ttsSettings(runtime.settings);
  const wanted = tts.enabled && tts.speechMarks;
  if (typeof context?.setExtensionPrompt !== 'function') {
    if (wanted && !runtime.speechPromptMissing) {
      runtime.speechPromptMissing = true;
      recordDiagnostic('warn', 'tts.speech-prompt', '这个酒馆版本没有给扩展往提示词里加内容的接口，说话人标记要求发不出去。');
    }
    return false;
  }
  const side = typeof type === 'string' && ['quiet', 'impersonate'].includes(type);
  const content = wanted && !side ? speechPromptContent(runtime.settings, context) : '';
  context.setExtensionPrompt(SPEECH_PROMPT_KEY, content, SPEECH_PROMPT_IN_CHAT, 0, false, SPEECH_PROMPT_SYSTEM);
  // Written down when what goes out changes — switched on, a name added, other quotation marks — and
  // not on every reply.
  if (content && content !== runtime.speechPromptSent) {
    recordDiagnostic('info', 'tts.speech-prompt', '说话人标记要求已放进主模型的请求（深度 0，系统消息）。', { names: speechRoster(runtime.settings) }, content);
  }
  if (!side) runtime.speechPromptSent = content;
  return Boolean(content);
}

function clearSpeechPrompt() {
  try {
    getContext()?.setExtensionPrompt?.(SPEECH_PROMPT_KEY, '', SPEECH_PROMPT_IN_CHAT, 0, false, SPEECH_PROMPT_SYSTEM);
  } catch { /* the host is going away */ }
  runtime.speechPromptSent = '';
}

/**
 * The people found, shown before any of them is added: the ones the story already mentions ticked,
 * the rest there to tick by hand — a large world's book lists far more people than one story meets.
 * Without anyone to show it to, the ticked ones are the answer.
 */
async function askCastPicks(people, { already = 0, dropped = [] } = {}) {
  const anySeen = people.some(person => person.seen);
  const picks = people.map((person, index) => ({
    value: String(index),
    label: person.aliases.length ? `${person.name}（${person.aliases.join('、')}）` : person.name,
    note: person.seen ? '最近的正文里出现过' : '最近的正文里还没出现',
    // A chat that has barely begun mentions nobody yet; then everybody found is offered ticked.
    checked: person.seen || !anySeen,
  }));
  if (typeof document === 'undefined') return people.filter((_, index) => picks[index].checked);
  const notes = [
    already ? `另有 ${already} 个已经在角色表里，没有列出来。` : '',
    dropped.length ? `${dropped.length} 个说法没通过核对（不是具体的人、找不到这个名字、或者就是你自己），没有列出来，运行记录里有明细。` : '',
  ].filter(Boolean).join('');
  const answer = await ttsAskBox({
    title: `识别出 ${people.length} 个角色`,
    text: `勾上的加进角色表，先用对白默认音色读，之后可以逐个绑专属音色。${notes}`,
    picks,
    actions: [{ value: 'add', label: '加入勾选的角色', primary: true }, { value: 'cancel', label: '取消' }],
  }, { label: '识别角色' });
  if (answer?.choice !== 'add') return null;
  return answer.picked.map(value => people[Number(value)]).filter(Boolean);
}

// The structure of the latest floor as it would be read: the type, speaker and mood of every sentence,
// and the voice each one resolves to. It is the same data the audio is made from, so a wrong voice here
// is a wrong voice in the chat, and it can be fixed before anything is paid for.
function renderTtsPreview(root) {
  const target = root.querySelector('[data-jy-tts-preview]');
  if (!target) return;
  const doc = target.ownerDocument;
  const preview = runtime.tts.preview;
  const copy = root.querySelector('[data-jy-action="tts-copy-structure"]');
  if (copy) copy.hidden = !preview;
  target.replaceChildren();
  if (!preview) {
    const note = doc.createElement('p');
    note.className = 'jy-muted';
    note.textContent = '还没有分析过。点「分析最新一楼」，看每一句会被谁、用什么情绪、哪个音色读。';
    target.appendChild(note);
    return;
  }
  const settings = runtime.settings;
  const tts = ttsSettings(settings);
  const config = ttsVoiceConfig(settings);
  const inRange = new Set(audibleSegments(preview.segments, tts.range, ttsVoiceConfig(settings)).map(segment => segment.id));
  const head = doc.createElement('p');
  head.className = 'jy-muted';
  head.textContent = `第 ${preview.messageId} 楼 · ${preview.segments.length} 句 · ${preview.source === 'translation' ? '读的是镜译译文' : preview.source === 'source' ? '读的是原文' : '读的是来源标签里的文字'} · 标注来自${preview.analyzed === 'deep' ? '副模型深度分析' : preview.analyzed === 'simple' ? '副模型简单分析' : preview.analyzed === 'pending' ? '还没分析' : '翻译时的骨架与引号'}`;
  target.appendChild(head);
  const table = doc.createElement('div');
  table.className = 'jy-tts-preview-table';
  for (const segment of preview.segments) {
    const row = doc.createElement('div');
    row.className = 'jy-tts-preview-row';
    row.dataset.type = segment.type;
    if (!inRange.has(segment.id)) row.dataset.skipped = 'true';
    const play = doc.createElement('button');
    play.type = 'button';
    play.className = 'jy-icon-button';
    play.dataset.jyAction = 'tts-preview-play';
    play.dataset.jyTtsMes = String(preview.messageId);
    play.dataset.jyTtsUtt = String(segment.id);
    play.setAttribute('aria-label', '朗读这一句');
    play.textContent = '▶';
    play.disabled = !inRange.has(segment.id);
    const who = doc.createElement('span');
    who.className = 'jy-tts-preview-who';
    who.textContent = segment.type === 'narration' ? '旁白' : (segment.speaker || '未知说话人');
    const mood = doc.createElement('span');
    mood.className = 'jy-badge';
    mood.textContent = segment.emotion
      ? `${cueLabel(segment.emotion)}${segment.intensity === 2 ? ' · 强' : segment.intensity === 0 ? ' · 弱' : ''}${segment.voice?.speed ? ` · 语速${segment.voice.speed === 'fast' ? '快' : '慢'}` : ''}`
      : '—';
    if (segment.lang && segment.lang !== 'zh') mood.textContent += ` · ${languageLabel(segment.lang)}`;
    const voice = doc.createElement('span');
    voice.className = 'jy-tts-preview-voice';
    const voiceId = resolveSegmentVoice(segment, config);
    voice.textContent = voiceId ? voiceId.slice(0, 8) : 'Fish 默认';
    if (!voiceId) voice.dataset.missing = 'true';
    const text = doc.createElement('span');
    text.className = 'jy-tts-preview-text';
    text.textContent = segment.text;
    row.append(play, who, mood, voice, text);
    table.appendChild(row);
  }
  target.appendChild(table);
}

async function runTtsPreview(root) {
  const context = getContext();
  const messageId = latestAssistantMessageId(context);
  if (messageId === null) throw new Error('当前聊天里还没有 AI 楼层。');
  const settings = collectSettings(root);
  const floor = await collectTtsFloor(messageId, settings);
  if (!floor) throw new Error('最新一楼没有可朗读的译文，也没有来源标签。');
  const { segments } = await prepareTtsSegments(floor, settings, {
    onStatus: text => setText(root, '[data-jy-tts-save-note]', text),
  });
  runtime.tts.preview = {
    messageId,
    source: floor.source,
    analyzed: runtime.tts.analysis.get(ttsLabelKey(floor))?.depth ?? '',
    segments,
  };
  setText(root, '[data-jy-tts-save-note]', '修改后保存朗读设置');
  renderTtsPreview(root);
  return runtime.tts.preview;
}

function syncProcessingFields(root, settings) {
  const select = root.querySelector('[data-jy-processing-select]');
  if (!select) return;
  const doc = root.ownerDocument;
  const active = getActiveProcessingProfile(settings);
  select.replaceChildren(...settings.processingProfiles.map(profile => {
    const option = doc.createElement('option'); option.value = profile.id; option.textContent = profile.name; return option;
  }));
  select.value = active.id;
  root.querySelector('[data-jy-processing-name]').value = active.name;
  const list = root.querySelector('[data-jy-processing-regex-list]');
  list.replaceChildren();
  active.regexScripts.forEach((rule, index) => {
    const row = doc.createElement('div'); row.className = 'jy-processing-regex';
    const label = doc.createElement('label'); label.className = 'jy-check';
    const enabled = doc.createElement('input'); enabled.type = 'checkbox'; enabled.checked = !rule.disabled; enabled.dataset.jyProcessingRule = rule.id;
    const name = doc.createElement('span'); name.textContent = rule.scriptName;
    label.append(enabled, name);
    const tools = doc.createElement('div'); tools.className = 'jy-processing-regex-tools';
    for (const [action, text, title, disabled] of [
      ['move-processing-up', '↑', '上移', index === 0],
      ['move-processing-down', '↓', '下移', index === active.regexScripts.length - 1],
      ['remove-processing-regex', '×', '解除绑定', false],
    ]) {
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'jy-icon-button';
      button.textContent = text; button.title = title; button.setAttribute('aria-label', `${title}：${rule.scriptName}`);
      button.dataset.jyAction = action; button.dataset.jyRegexId = rule.id; button.disabled = disabled;
      tools.append(button);
    }
    row.append(label, tools); list.append(row);
  });
  if (!active.regexScripts.length) {
    const empty = doc.createElement('p'); empty.className = 'jy-muted'; empty.textContent = '暂无绑定正则'; list.append(empty);
  }
  setText(root, '[data-jy-processing-regex-count]', `· ${active.regexScripts.length} 条`);
  const nativeStatus = root.querySelector('[data-jy-native-regex-status]');
  nativeStatus.hidden = !getContext().extensionSettings.disabledExtensions?.includes('regex');
  nativeStatus.textContent = nativeStatus.hidden ? '' : '酒馆正则已停用，启用后美化生效。';
}

function downloadProcessingProfile(profile) {
  const file = new Blob([JSON.stringify(exportProcessingProfile(profile), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a'); link.href = url;
  link.download = `${profile.name.replace(/[\\/:*?"<>|]/g, '_')}.json`;
  document.body.append(link); link.click(); link.remove();
  const timer = setTimeout(() => { URL.revokeObjectURL(url); runtime.timers.delete(timer); }, 30000);
  runtime.timers.add(timer);
}

async function persistProcessing(root, settings) {
  saveSettings(settings);
  await runtime.processingRefresh;
  syncFields(root, runtime.settings);
}

function addProcessingProfile(settings, profile) {
  if (settings.processingProfiles.length >= 40) throw new Error('最多保存 40 套正文方案，请先删除不用的方案。');
  const baseName = profile.name;
  let suffix = 2;
  while (settings.processingProfiles.some(item => item.name === profile.name)) profile.name = `${baseName} ${suffix++}`;
  settings.processingProfiles.push(profile);
  return selectProcessingProfile(settings, profile.id);
}

async function readProcessingJson(file) {
  if (file.size > 2 * 1024 * 1024) throw new Error('每个文件不能超过 2 MB。');
  return JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
}

// The saved connections are always there to edit: which one the translation uses is not this page's
// question, so following the host for translating no longer hides the shelf from the reading.
function updateApiPanels(root) {
  const panel = root.querySelector('[data-jy-independent-panel]');
  if (panel) panel.hidden = false;
}

function updateTaskUi(root, task) {
  setText(root, '[data-jy-task-title]', task.title);
  setText(root, '[data-jy-task-message]', task.message);
  setText(root, '[data-jy-live]', `${task.title}。${task.message}`);
  const dot = root.querySelector('[data-jy-task-dot]');
  if (dot) dot.dataset.jyTaskDot = task.status;
  const progress = root.querySelector('[data-jy-progress]');
  if (progress) progress.style.transform = `scaleX(${Math.max(0, Math.min(1, (Number(task.progress) || 0) / 100))})`;
  renderThinking(root);
  renderSpeakerReport(root);
}

/**
 * The model's thinking, while it is happening and after.
 *
 * Open by default while it streams — waiting ten minutes at 7% with no idea whether anything is
 * happening is the thing this exists to fix — and folded to one line once the translation starts, so
 * a finished floor is not buried under twenty thousand characters of deliberation. An explicit click
 * either way is remembered and overrides both defaults until the next batch.
 */
function renderThinking(root) {
  const panel = root.querySelector('[data-jy-thinking]');
  if (!panel) return;
  const thinking = runtime.thinking;
  const text = String(thinking.text ?? '');
  panel.hidden = !text;
  if (!text) return;
  panel.dataset.live = thinking.live ? 'yes' : 'no';
  const open = runtime.thinkingOpen ?? thinking.live;
  setText(root, '[data-jy-thinking-label]', thinking.live ? '模型正在思考' : '本批思考过程');
  setText(root, '[data-jy-thinking-count]', `${text.length.toLocaleString()} 字${thinking.batch ? ` · 第 ${thinking.batch} 批` : ''}`);
  const head = panel.querySelector('[data-jy-thinking-head], .jy-thinking-head');
  head?.setAttribute('aria-expanded', String(open));
  const body = panel.querySelector('[data-jy-thinking-body]');
  if (body) body.hidden = !open;
  if (!open) return;
  const target = panel.querySelector('[data-jy-thinking-text]');
  if (!target) return;
  // While it streams only the tail is painted: twenty thousand characters redrawn every second is
  // what would make the panel stutter, and the tail is the part that is actually moving.
  const tail = thinking.live && text.length > THINKING_TAIL ? `…${text.slice(-THINKING_TAIL)}` : text;
  if (target.textContent !== tail) {
    target.textContent = tail;
    if (thinking.live) body.scrollTop = body.scrollHeight;
  }
}

function stringifyFullResponse(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
}

function diagnosticReportMetadata() {
  const preserveRules = parsePreserveLineRulesWithErrors(runtime.settings.preserveLineRules);
  return {
    appVersion: APP_VERSION,
    updateStatus: runtime.update.status,
    apiMode: runtime.settings.apiMode,
    endpoint: describeChannelEndpoint(),
    model: getActiveChannel(runtime.settings).model || 'follow-current',
    bodyTags: runtime.settings.bodyTags,
    excludedTags: runtime.settings.excludedTags,
    preserveLineRules: preserveRules.rules.length,
    userAgent: globalThis.navigator?.userAgent || '',
  };
}

function downloadLogTxt(entries, scopeLabel) {
  if (!entries.length) throw new Error('所选范围内没有日志。');
  const report = formatFullDiagnosticReport(entries, diagnosticReportMetadata());
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  // The BOM keeps Windows Notepad from reading the UTF-8 text as mojibake.
  const file = new Blob([`\ufeff${report}`], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = `jingyi-log-${stamp}.txt`;
  document.body.appendChild(link); link.click(); link.remove();
  const timer = setTimeout(() => { URL.revokeObjectURL(url); runtime.timers.delete(timer); }, 30000);
  runtime.timers.add(timer);
  toast('success', `已导出${scopeLabel}日志（含请求与返回正文），分享前请检查隐私内容。`);
}

function renderDiagnosticLog(root, entries = readDiagnostics()) {
  setText(root, '[data-jy-log-count]', `${entries.length} 条`);
  const list = root.querySelector('[data-jy-log-list]');
  if (!list) return;
  list.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('article');
    empty.className = 'jy-card jy-log-empty';
    empty.textContent = '还没有日志。完成一次通道测试或翻译后，这里会显示诊断记录。';
    list.appendChild(empty);
    return;
  }
  for (const entry of [...entries].reverse()) {
    const item = document.createElement('article');
    item.className = 'jy-card jy-log-entry';
    item.dataset.level = entry.level;
    const header = document.createElement('div');
    header.className = 'jy-row-between';
    const scope = document.createElement('strong');
    scope.textContent = entry.scope;
    const time = document.createElement('time');
    time.dateTime = entry.time;
    time.textContent = new Date(entry.time).toLocaleString();
    header.append(scope, time);
    const message = document.createElement('p');
    message.textContent = entry.message;
    item.append(header, message);
    if (entry.details?.requestTokens && Number.isFinite(Number(entry.details.requestTokens.promptTokens))) {
      const tokens = document.createElement('p');
      tokens.className = 'jy-log-tokens';
      const info = entry.details.requestTokens;
      tokens.textContent = info.basis === 'usage'
        ? `请求 ${Number(info.promptTokens).toLocaleString()} tokens（接口实测）`
        : `请求 ≈ ${Number(info.promptTokens).toLocaleString()} tokens（字符估算）`;
      item.appendChild(tokens);
    }
    if (entry.details && Object.keys(entry.details).length) {
      const details = document.createElement('pre');
      details.textContent = JSON.stringify(entry.details, null, 2);
      item.appendChild(details);
    }
    // The thinking gets its own disclosure ahead of the raw return: when a model spends twenty
    // thousand characters deliberating, that is the thing a reader came to the log to read, and
    // digging it out of a JSON envelope by hand is not reading it.
    if (typeof entry.reasoning === 'string' && entry.reasoning.trim()) {
      const thought = entry.reasoning;
      const disclosure = document.createElement('details');
      disclosure.className = 'jy-log-full-response jy-log-reasoning';
      const summary = document.createElement('summary');
      summary.textContent = `查看模型思考（${thought.length.toLocaleString()} 字）`;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'jy-button jy-log-copy-button';
      copy.textContent = '复制思考过程';
      copy.addEventListener('click', async () => {
        await copyText(thought);
        toast('success', '思考过程已复制。');
      });
      const body = document.createElement('pre');
      body.textContent = thought;
      disclosure.append(summary, copy, body);
      item.appendChild(disclosure);
    }
    if (Object.hasOwn(entry, 'fullResponse')) {
      const fullText = stringifyFullResponse(entry.fullResponse);
      const disclosure = document.createElement('details');
      disclosure.className = 'jy-log-full-response';
      const summary = document.createElement('summary');
      summary.textContent = `查看完整返回（${fullText.length.toLocaleString()} 字符）`;
      const warning = document.createElement('p');
      warning.className = 'jy-log-privacy-warning';
      warning.textContent = '可能包含正文或模型思考。发送给别人前请先检查。';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'jy-button jy-log-copy-button';
      copy.textContent = '复制本次完整返回';
      copy.addEventListener('click', async () => {
        await copyText(fullText);
        toast('success', '本次完整返回已复制。');
      });
      const full = document.createElement('pre');
      full.textContent = fullText;
      disclosure.append(summary, warning, copy, full);
      item.appendChild(disclosure);
    }
    list.appendChild(item);
  }
}

async function refreshCurrentCard(root) {
  const settings = runtime.settings || mergeSettings({});
  const targetLanguage = normalizeTargetLanguage(getActivePromptProfile(settings).targetLanguage);
  setText(root, '[data-jy-desk-target]', targetLanguage);
  try {
    const snapshot = await readMessageSnapshot();
    const totalSwipes = Array.isArray(snapshot.message.swipes) ? snapshot.message.swipes.length : 1;
    const swipeLabel = `${snapshot.swipeId + 1} / ${Math.max(1, totalSwipes)}`;
    setText(root, '[data-jy-floor]', `第 ${snapshot.messageId} 楼`);
    setText(root, '[data-jy-swipe]', swipeLabel);
    setText(root, '[data-jy-segments]', `${snapshot.paragraphs} 段 / ${snapshot.segments.length} 行`);
    setText(root, '[data-jy-current-state]', snapshot.translated ? '已翻译' : '待翻译');
    setText(root, '[data-jy-desk-context]', `第 ${snapshot.messageId} 楼 · 滑动页 ${swipeLabel}`);
  } catch (error) {
    setText(root, '[data-jy-floor]', '不可翻译');
    setText(root, '[data-jy-swipe]', '—');
    setText(root, '[data-jy-segments]', '—');
    setText(root, '[data-jy-current-state]', safeError(error));
    setText(root, '[data-jy-desk-context]', safeError(error));
  }
}

async function inspectCurrentFloor(root) {
  const settings = collectSettings(root);
  const context = getContext();
  const messageId = latestAssistantMessageId(context);
  if (messageId === null) throw new Error('没有找到可检查的 AI 回复。');
  const message = context.chat[messageId];
  const report = inspectTagConfiguration(
    stripGeneratedTranslationLines(message.mes),
    settings.bodyTags,
    settings.excludedTags,
    {
      segmentPrefix: settings.segmentPrefix,
      segmentSuffix: settings.segmentSuffix,
      preserveLineRules: settings.preserveLineRules,
      paragraphPerLine: settings.paragraphPerLine,
      replaceTags: settings.replaceTags,
    },
  );
  const lines = ['正文标签：'];
  for (const item of report.bodyTags) {
    if (item.count) lines.push(`  <${item.tag}>：${item.count} 组，采用第 ${item.selected} 组`);
    else if (item.streaming) lines.push(`  <${item.tag}>：标签已出现但尚未闭合，这一楼可能还在生成`);
    else lines.push(`  <${item.tag}>：未找到`);
  }
  lines.push('替换标签：');
  if (!report.replaceTags.length) lines.push('  未设置');
  for (const item of report.replaceTags) lines.push(`  <${item.tag}>：${item.count} 组`);
  lines.push('排除标签：');
  if (!report.excludedTags.length) lines.push('  未设置');
  for (const item of report.excludedTags) lines.push(`  <${item.tag}>：${item.count} 组`);
  lines.push(`可翻译内容：${report.paragraphs} 个空行段落，${report.translationUnits} 个实际翻译行`);
  lines.push(`原样保留：白名单 ${report.customPreservedLines} 行，内置结构规则 ${report.builtinPreservedLines} 行`);
  lines.push(`透明结构标签：${report.structuralTags.length ? report.structuralTags.map(tag => `<${tag}>`).join('、') : '未发现'}`);
  if (report.errors.length) {
    lines.push('发现问题：');
    for (const error of report.errors) lines.push(`  - ${error}`);
  } else {
    lines.push('标签结构：正常');
  }
  const output = root.querySelector('[data-jy-tag-inspection]');
  if (output) {
    output.textContent = lines.join('\n');
    output.hidden = false;
  }
  recordDiagnostic(report.errors.length ? 'warn' : 'info', 'tags.inspect', report.errors.length ? '当前楼层标签检查发现问题。' : '当前楼层标签检查完成。', {
    messageId,
    bodyTags: report.bodyTags,
    replaceTags: report.replaceTags,
    excludedTags: report.excludedTags,
    paragraphs: report.paragraphs,
    translationUnits: report.translationUnits,
    customPreservedLines: report.customPreservedLines,
    builtinPreservedLines: report.builtinPreservedLines,
    structuralTags: report.structuralTags,
    errors: report.errors,
  });
  return report;
}

function createLocalId(prefix) {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function togglePromptEditor(root, id) {
  const target = root.querySelector(`[data-jy-prompt-editor-panel="${id}"]`);
  if (!target) return;
  const shouldOpen = target.hidden;
  root.dataset.jyOpenEditor = shouldOpen ? id : '';
  root.querySelector('[data-jy-editor-placeholder]').hidden = shouldOpen;
  for (const panel of root.querySelectorAll('[data-jy-prompt-editor-panel]')) panel.hidden = true;
  for (const button of root.querySelectorAll('[data-jy-action="toggle-prompt-editor"]')) button.setAttribute('aria-expanded', 'false');
  if (shouldOpen) {
    target.hidden = false;
    const button = root.querySelector(`button[data-jy-action="toggle-prompt-editor"][data-jy-prompt-editor="${id}"]`);
    button?.setAttribute('aria-expanded', 'true');
    target.querySelector('textarea,input,select')?.focus?.({ preventScroll: true });
    if (globalThis.innerWidth <= 640) {
      const workspace = root.querySelector('.jy-workspace');
      workspace.scrollTop += target.getBoundingClientRect().top - workspace.getBoundingClientRect().top - 16;
    }
  }
}

function resetPromptItem(profile, key) {
  const defaults = DEFAULT_PROMPT_PROFILE;
  const fields = {
    jailbreak: ['jailbreakPrompt'],
    core: ['corePrompt'],
    style: ['styleMode', 'styleCustom'],
    leaning: ['leaningMode', 'leaningCustom'],
    honorific: ['honorificMode', 'honorificCustom'],
    name: ['nameMode', 'nameCustom'],
    punctuation: ['punctuationMode', 'punctuationCustom'],
    banned: ['avoidPhrases', 'forbiddenPhrases'],
    glossary: ['glossary'],
    examples: ['examples'],
    checklist: ['checklistPrompt'],
  }[key] || [];
  for (const field of fields) profile[field] = deepClonePromptValue(defaults[field]);
}

function deepClonePromptValue(value) {
  return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
}

function createControlCenter(rootDocument = document) {
  const container = rootDocument.createElement('div');
  container.innerHTML = CONTROL_CENTER_MARKUP;
  const root = container.firstElementChild;
  syncFields(root, runtime.settings);
  refreshCurrentCard(root);

  const unsubscribe = subscribeTask(task => {
    updateTaskUi(root, task);
    if (task.status === 'success') refreshCurrentCard(root);
  });
  const unsubscribeDiagnostics = subscribeDiagnostics(entries => renderDiagnosticLog(root, entries));
  const updateButton = root.querySelector('[data-jy-action="check-update"]');
  updateButtonState(updateButton);
  if (runtime.update.status === 'updated') {
    const notice = root.querySelector('[data-jy-update-notice]');
    notice.hidden = false;
    notice.textContent = '更新完成，请手动刷新酒馆。';
  } else void checkUpdatesSilently(updateButton);

  const selectTab = target => {
    for (const tabButton of root.querySelectorAll('[data-jy-tab]')) {
      tabButton.setAttribute('aria-selected', String(tabButton.dataset.jyTab === target));
    }
    for (const page of root.querySelectorAll('[data-jy-page]')) {
      const active = page.dataset.jyPage === target;
      page.hidden = !active;
      page.classList.toggle('is-active', active);
    }
    root.querySelector('.jy-workspace').scrollTop = 0;
    if (target === 'logs') renderDiagnosticLog(root);
    syncTtsFeatureVisibility(root);
    if (target === 'tts' && ttsSettings().enabled) void renderTtsUsage(root);
  };

  const onClick = async event => {
    const tab = event.target.closest('[data-jy-tab]');
    if (tab) {
      selectTab(tab.dataset.jyTab);
      return;
    }

    const button = event.target.closest('[data-jy-action]');
    if (!button) return;
    const action = button.dataset.jyAction;
    if (action === 'import-processing' || action === 'import-processing-regex') {
      root.querySelector(action === 'import-processing' ? '[data-jy-processing-import]' : '[data-jy-processing-regex-import]').click();
      return;
    }
    if (action === 'set-theme') {
      const next = mergeSettings(runtime.settings);
      next.theme = button.dataset.jyTheme;
      saveSettings(next);
      for (const choice of root.querySelectorAll('[data-jy-theme]')) choice.setAttribute('aria-pressed', String(choice.dataset.jyTheme === runtime.settings.theme));
      button.closest('details').open = false;
      return;
    }
    if (action === 'export-profile') {
      try {
        const profile = getActivePromptProfile(collectSettings(root));
        const sharedProfile = Object.fromEntries(Object.keys(DEFAULT_PROMPT_PROFILE).filter(key => key !== 'id').map(key => [key, profile[key]]));
        const file = new Blob([JSON.stringify({ format: 'jingyi-prompt-profile', version: 1, profile: sharedProfile }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = (profile.name || '镜译方案').replace(/[\\\\/:*?"<>|]/g, '_') + '.json';
        document.body.appendChild(link); link.click(); link.remove();
        const timer = setTimeout(() => { URL.revokeObjectURL(url); runtime.timers.delete(timer); }, 30000);
        runtime.timers.add(timer);
        toast('success', '已导出当前方案。文件包含自定义提示词和术语表。');
      } catch (error) { toast('error', safeError(error)); }
      return;
    }
    if (action === 'import-profile') {
      root.querySelector('[data-jy-profile-import]').click();
      return;
    }
    if (action === 'toggle-prompt-editor') {
      togglePromptEditor(root, button.dataset.jyPromptEditor);
      return;
    }
    if (action === 'check-update') {
      await handleUpdateAction(button);
      return;
    }
    button.disabled = true;
    try {
      if (action === 'save-processing') {
        await persistProcessing(root, collectSettings(root));
        root.querySelector('.jy-profile-menu').open = false;
        toast('success', '正文方案及绑定正则已保存。');
      } else if (action === 'export-processing') {
        downloadProcessingProfile(getActiveProcessingProfile(collectSettings(root)));
        toast('success', '已导出正文方案，包含设置和绑定的完整正则。');
      } else if (action === 'delete-processing') {
        const next = collectSettings(root);
        if (next.processingProfiles.length <= 1) throw new Error('至少保留一个正文方案。');
        const removed = next.selectedProcessingProfileId;
        const selected = selectProcessingProfile(next, next.processingProfiles.find(item => item.id !== removed).id);
        selected.processingProfiles = selected.processingProfiles.filter(item => item.id !== removed);
        await persistProcessing(root, selected);
        toast('success', '正文方案已删除。');
      } else if (action === 'adopt-speakers') {
        // Every reported name the palette has not got yet, with no colour of its own. The hue each
        // one already has is name-derived, so nothing on screen moves until a real hair colour is
        // typed in — registering is about being able to edit them, not about changing them now.
        const next = collectSettings(root);
        const characterKey = worldInfoCharacterKey();
        const existing = normalizeSpeakerList(next.speakerPalette?.[characterKey]);
        const known = new Set(existing.flatMap(item => [item.name, ...item.aliases]));
        const added = (runtime.speakerCoverage?.reported ?? [])
          .filter(item => !known.has(item.name))
          .map(item => ({ name: item.name, aliases: [], source: '', from: 'hair' }));
        if (!added.length) throw new Error('报出的说话人都已经在名单里了。');
        next.speakerPalette = { ...(next.speakerPalette || {}), [characterKey]: [...existing, ...added] };
        saveSettings(next);
        syncColoringFields(root, runtime.settings);
        toast('success', `已加入 ${added.length} 个说话人，可以填上发色。`);
      } else if (action === 'toggle-thinking') {
        runtime.thinkingOpen = !(runtime.thinkingOpen ?? runtime.thinking.live);
        renderThinking(root);
      } else if (action === 'probe-theme') {
        await runThemeProbe(root);
      } else if (action === 'add-speaker') {
        const list = root.querySelector('[data-jy-speaker-list]');
        if (list) {
          // A blank row is dropped by normalizeSpeakerList until a name is typed, so an accidental
          // click leaves nothing behind.
          if (list.querySelector('.jy-muted')) list.replaceChildren();
          list.appendChild(speakerRowElement(list.ownerDocument, { name: '', aliases: [], source: '', from: 'hair' }));
          list.querySelector('[data-jy-speaker-row]:last-child [data-jy-speaker-name]')?.focus();
        }
      } else if (action === 'remove-speaker') {
        button.closest('[data-jy-speaker-row]')?.remove();
        saveSettings(collectSettings(root));
        refreshSpeakerPreviews(root, runtime.settings);
      } else if (action === 'builtin-processing') {
        const next = collectSettings(root);
        await persistProcessing(root, addProcessingProfile(next, makeBuiltinReadingProfile(next, root.querySelector('[data-jy-reading-style]').value)));
        toast('success', '已生成美化方案，已有译文同步换好样式。');
      } else if (['move-processing-up', 'move-processing-down', 'remove-processing-regex'].includes(action)) {
        const next = collectSettings(root), rules = getActiveProcessingProfile(next).regexScripts;
        const index = rules.findIndex(rule => rule.id === button.dataset.jyRegexId);
        if (index < 0) throw new Error('没有找到这条绑定正则。');
        if (action === 'remove-processing-regex') rules.splice(index, 1);
        else {
          const target = index + (action === 'move-processing-up' ? -1 : 1);
          if (target >= 0 && target < rules.length) [rules[index], rules[target]] = [rules[target], rules[index]];
        }
        await persistProcessing(root, next);
      } else if (action === 'translate') {
        saveSettings(collectSettings(root));
        await startTranslation(null, { force: true });
      } else if (action === 'translate-missing') {
        // Seeds with whatever is already written back, so only the gaps go to the API.
        saveSettings(collectSettings(root));
        await startTranslation(null, { force: false });
      } else if (action === 'test-api') {
        saveSettings(collectSettings(root));
        // The connection being edited is the one tested, whoever uses it.
        await testTranslationChannel({ channelId: root.dataset.jyEditingChannelId || editingChannelId() });
      } else if (action === 'refresh') {
        await refreshCurrentCard(root);
      } else if (action === 'open-main') {
        selectTab('main');
      } else if (action === 'open-settings') {
        selectTab('settings');
      } else if (action === 'open-prompt') {
        selectTab('prompt');
      } else if (action === 'open-tts') {
        selectTab('tts');
      } else if (action === 'refresh-base-prompts') {
        const next = collectSettings(root);
        const active = getActivePromptProfile(next);
        const backupId = createLocalId('prompt-profile');
        next.promptProfiles.push(normalizePromptProfile({ ...deepClonePromptValue(active), id: backupId, name: `${active.name} · 更新前` }, backupId));
        active.corePrompt = CORE_TRANSLATION_SPEC;
        active.checklistPrompt = PRE_OUTPUT_CHECKLIST;
        saveSettings(next);
        syncFields(root, runtime.settings);
        toast('success', '已采用新版规范与清单，原方案已备份。');
      } else if (action === 'save-prompt') {
        saveSettings(collectSettings(root));
        syncFields(root, runtime.settings);
        toast('success', '当前翻译方案已保存。');
      } else if (action === 'duplicate-prompt-profile') {
        const next = collectSettings(root);
        const active = getActivePromptProfile(next);
        const id = createLocalId('prompt-profile');
        const copy = normalizePromptProfile({ ...deepClonePromptValue(active), id, name: `${active.name} 副本` }, id);
        next.promptProfiles.push(copy);
        next.selectedPromptProfileId = id;
        saveSettings(next);
        syncFields(root, runtime.settings);
        toast('success', '已复制为新的翻译方案。');
      } else if (action === 'delete-prompt-profile') {
        const next = collectSettings(root);
        if (next.promptProfiles.length <= 1) throw new Error('至少保留一个翻译方案。');
        next.promptProfiles = next.promptProfiles.filter(profile => profile.id !== next.selectedPromptProfileId);
        next.selectedPromptProfileId = next.promptProfiles[0].id;
        saveSettings(next);
        syncFields(root, runtime.settings);
        toast('success', '当前翻译方案已删除。');
      } else if (action === 'reset-prompt-profile') {
        const next = collectSettings(root);
        const active = getActivePromptProfile(next);
        const reset = normalizePromptProfile({ ...DEFAULT_PROMPT_PROFILE, id: active.id, name: active.name }, active.id);
        const index = next.promptProfiles.findIndex(profile => profile.id === active.id);
        next.promptProfiles[index] = reset;
        saveSettings(next);
        syncFields(root, runtime.settings);
        toast('success', '当前翻译方案已恢复默认。');
      } else if (action === 'reset-prompt-item') {
        const next = collectSettings(root);
        resetPromptItem(getActivePromptProfile(next), button.dataset.jyPromptKey);
        saveSettings(next);
        syncFields(root, runtime.settings);
        toast('success', '此项已恢复默认。');
      } else if (action === 'add-prompt-section') {
        const next = collectSettings(root);
        const profile = getActivePromptProfile(next);
        const id = createLocalId('prompt-section');
        profile.customSections.push({ id, title: `自定义规则 ${profile.customSections.length + 1}`, content: '', enabled: true });
        saveSettings(next);
        syncFields(root, runtime.settings);
        togglePromptEditor(root, `custom-${id}`);
      } else if (['move-prompt-section-up', 'move-prompt-section-down', 'duplicate-prompt-section', 'delete-prompt-section'].includes(action)) {
        const next = collectSettings(root);
        const profile = getActivePromptProfile(next);
        const sectionId = button.dataset.jySectionId;
        const index = profile.customSections.findIndex(section => section.id === sectionId);
        if (index < 0) throw new Error('没有找到这个自定义条目。');
        if (action === 'move-prompt-section-up' && index > 0) {
          [profile.customSections[index - 1], profile.customSections[index]] = [profile.customSections[index], profile.customSections[index - 1]];
        } else if (action === 'move-prompt-section-down' && index < profile.customSections.length - 1) {
          [profile.customSections[index], profile.customSections[index + 1]] = [profile.customSections[index + 1], profile.customSections[index]];
        } else if (action === 'duplicate-prompt-section') {
          const id = createLocalId('prompt-section');
          const copy = { ...profile.customSections[index], id, title: `${profile.customSections[index].title} 副本` };
          profile.customSections.splice(index + 1, 0, copy);
        } else if (action === 'delete-prompt-section') {
          profile.customSections.splice(index, 1);
        }
        saveSettings(next);
        syncFields(root, runtime.settings);
      } else if (action === 'add-channel') {
        const next = collectSettings(root);
        const id = globalThis.crypto?.randomUUID?.() || `channel-${Date.now()}`;
        next.channels.push(normalizeChannel({ ...DEFAULT_CHANNEL, id, name: `连接 ${next.channels.length + 1}` }, id));
        // Opened for editing, and used by nothing until a feature picks it.
        runtime.editingChannelId = id;
        saveSettings(next);
        syncFields(root, runtime.settings);
        toast('success', '新建了一条连接。填好地址和模型后，在翻译台或朗读页的下拉框里选它才会用上。');
      } else if (action === 'delete-channel') {
        const next = collectSettings(root);
        const id = root.dataset.jyEditingChannelId || editingChannelId(next);
        if (next.channels.length <= 1) throw new Error('至少保留一条连接。');
        // A connection in use is not taken away from under the feature using it: which connection a
        // feature falls back to is the reader's decision, made where that feature is set up.
        const users = channelUsers(next).filter(user => user.choice === id);
        if (users.length) {
          throw new Error(`${users.map(user => user.feature).join('、')}正在用这条连接。先在${[...new Set(users.map(user => user.where))].join('和')}给${users.length > 1 ? '它们' : '它'}换一条，再回来删。`);
        }
        next.channels = next.channels.filter(channel => channel.id !== id);
        // The translation follows the host and only remembers this one; what it remembers must exist.
        if (next.selectedChannelId === id) next.selectedChannelId = next.channels[0].id;
        runtime.editingChannelId = null;
        saveSettings(next);
        syncFields(root, runtime.settings);
        toast('success', '这条连接已删除。');
      } else if (action === 'fetch-models') {
        saveSettings(collectSettings(root));
        const id = root.dataset.jyEditingChannelId || editingChannelId();
        const models = await fetchChannelModels(id);
        syncFields(root, runtime.settings);
        toast('success', `模型列表已更新，共 ${models.length} 个，请选择需要使用的模型。`);
      } else if (action === 'save-channel') {
        saveSettings(collectSettings(root));
        syncFields(root, runtime.settings);
        toast('success', '这条连接已保存。');
      } else if (action === 'save-settings') {
        saveSettings(collectSettings(root));
        await runtime.processingRefresh;
        syncFields(root, runtime.settings);
        setText(root, '[data-jy-save-note]', `已保存于 ${new Date().toLocaleTimeString()}`);
        toast('success', '镜译设置已保存。');
      } else if (action === 'save-tts') {
        saveSettings(collectSettings(root));
        syncTtsFields(root, runtime.settings);
        setText(root, '[data-jy-tts-save-note]', `已保存于 ${new Date().toLocaleTimeString()}`);
        toast('success', '朗读设置已保存。');
      } else if (action === 'tts-test') {
        saveSettings(collectSettings(root));
        const result = await testFishConnection(runtime.settings);
        const credit = result.credit === null ? '' : `API 余额 ${result.credit.toFixed(2)}。`;
        const hint = result.credit === 0 && ttsSettings().fish.model !== 's2.1-pro-free' ? '余额为 0，除了 s2.1-pro-free 以外的模型会返回余额不足。' : '';
        setText(root, '[data-jy-tts-save-note]', `Fish 连接正常。${credit}${hint}`);
        toast(hint ? 'warning' : 'success', `Fish 连接正常。${credit}${hint}`);
      } else if (action === 'tts-add-mark') {
        const list = button.closest('.jy-tts-marks-fold')?.querySelector('[data-jy-marks]');
        if (list) list.appendChild(markRowElement(list.ownerDocument)).querySelector('[data-jy-mark-punct]')?.focus();
      } else if (action === 'tts-recommend-marks') {
        const list = button.closest('.jy-tts-marks-fold')?.querySelector('[data-jy-marks]');
        if (list) {
          const present = new Set([...list.querySelectorAll('[data-jy-mark-punct]')].map(input => input.value.trim()));
          for (const mark of RECOMMENDED_MARKS) if (!present.has(mark.punct)) list.appendChild(markRowElement(list.ownerDocument, mark));
        }
      } else if (action === 'tts-remove-mark') {
        button.closest('[data-jy-mark-row]')?.remove();
      } else if (action === 'tts-add-voice') {
        const list = root.querySelector('[data-jy-tts-voice-list]');
        if (list) {
          if (list.querySelector(':scope > .jy-muted')) list.replaceChildren();
          list.appendChild(ttsVoiceRowElement(list.ownerDocument, { name: '', aliases: [], voiceId: '', voices: {}, title: '' }, runtime.settings, { open: true }));
          list.querySelector('[data-jy-tts-voice-row]:last-child [data-jy-tts-voice-name]')?.focus();
        }
      } else if (action === 'tts-remove-voice') {
        button.closest('[data-jy-tts-voice-row]')?.remove();
        saveSettings(collectSettings(root));
        renderTtsVoiceList(root, runtime.settings);
      } else if (action === 'tts-unbind-voice') {
        const row = button.closest('[data-jy-tts-voice-row]');
        if (row) {
          const input = row.querySelector('[data-jy-tts-voice-id]');
          if (input) input.value = '';
          row.querySelector('[data-jy-tts-voice-langs]')?.replaceChildren();
          saveSettings(collectSettings(root));
          renderTtsVoiceList(root, runtime.settings);
          toast('success', '已解除绑定，这个角色改为跟随对白默认音色。');
        }
      } else if (action.startsWith('console-preset-')) {
        const box = button.closest('[data-jy-tts-console]');
        const pick = box?.querySelector('[data-jy-console-preset]');
        const nameInput = box?.querySelector('[data-jy-console-preset-name]');
        const presets = normalizeConsolePresets(runtime.settings.consolePresets);
        if (action === 'console-preset-apply') {
          const preset = presets.find(item => item.id === pick?.value);
          if (!preset) throw new Error('先在左边选一个预设。');
          for (const input of box.querySelectorAll('[data-jy-console-key]')) {
            input.value = String(preset.console[input.dataset.jyConsoleKey] ?? 50);
            const output = input.parentElement?.querySelector('output');
            if (output) output.textContent = consoleWord(input.dataset.jyConsoleKey, input.value);
          }
          const rules = box.querySelector('[data-jy-console-rules]');
          if (rules) rules.value = preset.console.rules ?? '';
          saveSettings(collectSettings(root));
          toast('success', `已套用「${preset.name}」。`);
        } else if (action === 'console-preset-save') {
          const wanted = String(nameInput?.value ?? '').trim() || presets.find(item => item.id === pick?.value)?.name || '';
          if (!wanted) throw new Error('先给这套调音台起个名字。');
          const current = readConsoleFields(box);
          const next = collectSettings(root);
          const kept = normalizeConsolePresets(next.consolePresets).filter(item => item.name !== wanted);
          next.consolePresets = [...kept, { id: `console-${Date.now().toString(36)}`, name: wanted, console: current }];
          saveSettings(next);
          if (nameInput) nameInput.value = '';
          for (const other of root.querySelectorAll('[data-jy-tts-console]')) {
            const list = other.querySelector('[data-jy-console-preset]');
            const chosen = list?.value;
            other.replaceChild(consolePresetRow(other.ownerDocument), other.firstElementChild);
            const refreshed = other.querySelector('[data-jy-console-preset]');
            if (refreshed && chosen) refreshed.value = chosen;
          }
          toast('success', `已存为预设「${wanted}」，在任何一套调音台上都能套用。`);
        } else {
          const preset = presets.find(item => item.id === pick?.value);
          if (!preset) throw new Error('先在左边选一个预设。');
          const next = collectSettings(root);
          next.consolePresets = presets.filter(item => item.id !== preset.id);
          saveSettings(next);
          for (const other of root.querySelectorAll('[data-jy-tts-console]')) {
            other.replaceChild(consolePresetRow(other.ownerDocument), other.firstElementChild);
          }
          toast('success', `已删掉预设「${preset.name}」。`);
        }
      } else if (action === 'tts-add-lang') {
        const list = button.closest('[data-jy-tts-voice-row]')?.querySelector('[data-jy-tts-voice-langs]');
        if (list) {
          list.appendChild(ttsLanguageRowElement(list.ownerDocument, '', '', runtime.settings));
          list.querySelector('[data-jy-tts-lang-row]:last-child [data-jy-tts-lang-id]')?.focus();
        }
      } else if (action === 'tts-add-narrator-lang') {
        const list = root.querySelector('[data-jy-tts-narrator-langs]');
        if (list) {
          list.appendChild(ttsLanguageRowElement(list.ownerDocument, '', '', runtime.settings));
          list.querySelector('[data-jy-tts-lang-row]:last-child [data-jy-tts-lang-id]')?.focus();
        }
      } else if (action === 'tts-remove-lang') {
        button.closest('[data-jy-tts-lang-row]')?.remove();
        saveSettings(collectSettings(root));
        syncTtsFields(root, runtime.settings);
      } else if (action === 'tts-add-library') {
        const list = root.querySelector('[data-jy-tts-library]');
        if (list) {
          if (list.querySelector(':scope > .jy-muted')) list.replaceChildren();
          list.appendChild(ttsLibraryRowElement(list.ownerDocument, { id: '', name: '', voiceId: '', lang: 'zh', title: '' }));
          list.querySelector('[data-jy-tts-library-row]:last-child [data-jy-tts-library-name]')?.focus();
        }
      } else if (action === 'tts-remove-library') {
        button.closest('[data-jy-tts-library-row]')?.remove();
        saveSettings(collectSettings(root));
        syncTtsFields(root, runtime.settings);
      } else if (action === 'tts-import-worldbook') {
        const next = collectSettings(root);
        setText(root, '[data-jy-tts-save-note]', '正在读角色卡和世界书、识别角色…');
        let found;
        try {
          found = await importCastFromWorldbook(next);
        } finally {
          setText(root, '[data-jy-tts-save-note]', '修改后保存朗读设置');
        }
        const { cast, dropped } = found;
        const characterKey = ttsVoicesKey(next);
        const existing = ttsVoicesFor(next);
        // Somebody already in the table under any spelling is the same somebody: a row is not added
        // for 桜井 next to the 樱井 who has 桜井 among her aliases.
        const known = new Set(voiceRosterNames(existing).map(spelling => spelling.toLowerCase()));
        const fresh = cast.filter(person => ![person.name, ...person.aliases].some(spelling => known.has(spelling.toLowerCase())));
        if (!fresh.length) {
          throw new Error(cast.length
            ? `识别出的 ${cast.length} 个角色都已经在表里了。`
            : `副模型没有从角色卡和世界书里识别出人物角色${dropped.length ? `；它说的 ${dropped.length} 个都没通过核对，运行记录里有明细` : ''}。`);
        }
        const chosen = await askCastPicks(fresh, { already: cast.length - fresh.length, dropped });
        if (!chosen) return;
        if (!chosen.length) throw new Error('一个都没勾，角色表没有变。');
        // Unlocked: no voice of their own, so they read in the dialogue default until given one.
        const added = chosen.map(person => ({ name: person.name, aliases: person.aliases, voiceId: '', voices: {}, locked: false, title: '' }));
        next.ttsVoices = { ...(next.ttsVoices || {}), [characterKey]: [...existing, ...added] };
        saveSettings(next);
        renderTtsVoiceList(root, runtime.settings);
        toast('success', `加入 ${added.length} 个角色。它们先跟随对白默认音色，绑定专属音色后就会锁定。`);
      } else if (action === 'stt-test') {
        saveSettings(collectSettings(root));
        const note = root.querySelector('[data-jy-stt-test-note]');
        const say = text => { if (note) note.textContent = text; };
        try {
          if (runtime.sttTest) {
            const listening = runtime.sttTest;
            runtime.sttTest = null;
            button.textContent = '试一下语音输入';
            say('正在转写…');
            const started = Date.now();
            const heard = await listening.stop();
            say(heard ? `听到：「${heard}」（${((Date.now() - started) / 1000).toFixed(1)} 秒）` : '没听清，再试一次。');
          } else {
            say('正在打开麦克风…');
            runtime.sttTest = await startSpeechInput({ onPartial: text => say(`正在听：${text}`) });
            button.textContent = '说完了，点这里结束';
            say('正在听，说完点一下按钮。');
          }
        } catch (error) {
          say(safeError(error));
          throw error;
        }
      } else if (action === 'tts-clear-voices') {
        const next = collectSettings(root);
        const characterKey = ttsVoicesKey(next);
        const count = ttsVoicesFor(next).length;
        if (!count) throw new Error('角色表已经是空的。');
        if (typeof globalThis.confirm === 'function' && !globalThis.confirm(`清空这张角色表（${count} 行）？音色库和旁白、对白默认音色不受影响。`)) return;
        next.ttsVoices = { ...(next.ttsVoices || {}) };
        if (characterKey === worldInfoCharacterKey()) delete next.ttsVoices[characterKey];
        else next.ttsVoices[characterKey] = [];
        saveSettings(next);
        renderTtsVoiceList(root, runtime.settings);
        syncTtsFoldSummaries(root, runtime.settings);
        toast('success', `已清空 ${count} 行角色表。`);
      } else if (action === 'tts-prune-voices') {
        // Rows that never got a voice of their own: the leftovers of a bad import, most of the time.
        const next = collectSettings(root);
        const characterKey = ttsVoicesKey(next);
        const existing = ttsVoicesFor(next);
        const kept = existing.filter(row => row.voiceId || Object.keys(row.voices ?? {}).length);
        const removed = existing.length - kept.length;
        if (!removed) throw new Error('没有可删的行：每个角色都绑了音色。');
        if (typeof globalThis.confirm === 'function' && !globalThis.confirm(`删掉 ${removed} 个没绑音色的角色，保留 ${kept.length} 个绑了音色的？`)) return;
        next.ttsVoices = { ...(next.ttsVoices || {}), [characterKey]: kept };
        saveSettings(next);
        renderTtsVoiceList(root, runtime.settings);
        syncTtsFoldSummaries(root, runtime.settings);
        toast('success', `删掉了 ${removed} 个没绑音色的角色，留下 ${kept.length} 个。`);
      } else if (action === 'tts-reset-prompt') {
        const textarea = root.querySelector(`[data-jy-tts-prompt="${button.dataset.prompt}"]`);
        if (textarea) textarea.value = '';
        saveSettings(collectSettings(root));
        syncTtsFields(root, runtime.settings);
        toast('success', '已恢复内置提示词。');
      } else if (action === 'tts-copy-prompt') {
        await copyText(TTS_PROMPT_DEFAULTS[button.dataset.prompt] ?? '');
        toast('success', `${button.dataset.prompt === 'deep' ? '深度' : '简单'}分析的内置提示词已复制。`);
      } else if (action === 'tts-fill-prompt') {
        const textarea = root.querySelector(`[data-jy-tts-prompt="${button.dataset.prompt}"]`);
        if (textarea) {
          textarea.value = TTS_PROMPT_DEFAULTS[button.dataset.prompt] ?? '';
          textarea.focus();
        }
        toast('info', '内置提示词已填进去，改完记得保存。');
      } else if (action === 'tts-edit-voice') {
        const scope = button.closest('[data-jy-tts-pick-scope]');
        const input = scope?.querySelector('input');
        button.remove();
        if (input) {
          input.hidden = false;
          input.focus();
        }
      } else if (action === 'tts-pregenerate') {
        saveSettings(collectSettings(root));
        const messageId = latestAssistantMessageId(getContext());
        if (messageId === null) throw new Error('当前聊天里还没有 AI 楼层。');
        setText(root, '[data-jy-tts-save-note]', `正在生成第 ${messageId} 楼的音频…`);
        const made = await pregenerateTtsFloor(messageId, { quiet: true });
        setText(root, '[data-jy-tts-save-note]', '修改后保存朗读设置');
        toast('success', made ? `第 ${messageId} 楼的音频已生成（${made} 段），没有播放。` : `第 ${messageId} 楼的音频早就有了，没有重新生成。`);
        void renderTtsUsage(root);
      } else if (action === 'tts-import-speakers') {
        // Everyone this extension already knows by name: the colour palette, the speakers the model
        // reported while translating, and the ones the last analysis found.
        const next = collectSettings(root);
        const characterKey = ttsVoicesKey(next);
        const existing = ttsVoicesFor(next);
        const known = new Set(voiceRosterNames(existing));
        const candidates = [
          ...speakerPaletteFor(next).map(item => ({ name: item.name, aliases: item.aliases })),
          ...(runtime.speakerCoverage?.reported ?? []).map(item => ({ name: item.name, aliases: [] })),
          ...(runtime.tts.preview?.segments ?? []).filter(item => item.type === 'dialogue' && item.speaker).map(item => ({ name: item.speaker, aliases: [] })),
        ];
        const added = [];
        for (const candidate of candidates) {
          if (known.has(candidate.name)) continue;
          known.add(candidate.name);
          added.push({ name: candidate.name, aliases: candidate.aliases ?? [], voiceId: '', voices: {}, locked: false, title: '' });
        }
        if (!added.length) throw new Error('没有新的说话人可以导入。先翻译一楼、在说话人名单里登记，或者点「分析最新一楼」。');
        next.ttsVoices = { ...(next.ttsVoices || {}), [characterKey]: [...existing, ...added] };
        saveSettings(next);
        renderTtsVoiceList(root, runtime.settings);
        toast('success', `已加入 ${added.length} 个说话人，填上 Voice ID 就能用。`);
      } else if (action === 'tts-lookup-voices') {
        const next = collectSettings(root);
        const tts = ttsSettings(next);
        requireFishKey(tts);
        const ids = [...new Set([
          tts.narratorVoice, tts.dialogueVoice, ...Object.values(tts.narratorVoices),
          ...ttsVoicesFor(next).flatMap(item => [item.voiceId, ...Object.values(item.voices ?? {})]),
          ...normalizeVoiceLibrary(next.voiceLibrary).map(item => item.voiceId),
        ].filter(Boolean))];
        if (!ids.length) throw new Error('还没有填任何 Voice ID。');
        const titles = new Map();
        const failures = [];
        for (const id of ids) {
          try {
            titles.set(id, await lookupFishVoiceTitle(id, next));
          } catch (error) {
            failures.push(`${id.slice(0, 8)}…：${safeError(error)}`);
          }
        }
        next.tts = normalizeTts({
          ...tts,
          narratorTitle: titles.get(tts.narratorVoice) ?? tts.narratorTitle,
          dialogueTitle: titles.get(tts.dialogueVoice) ?? tts.dialogueTitle,
        });
        const voices = ttsVoicesFor(next).map(item => ({ ...item, title: titles.get(item.voiceId) ?? item.title }));
        if (voices.length) next.ttsVoices = { ...(next.ttsVoices || {}), [ttsVoicesKey(next)]: voices };
        saveSettings(next);
        syncTtsFields(root, runtime.settings);
        if (failures.length) toast('warning', `有 ${failures.length} 个音色没查到：${failures.join('；')}`);
        else toast('success', `查到 ${titles.size} 个音色名。`);
      } else if (action === 'tts-preview') {
        saveSettings(collectSettings(root));
        const preview = await runTtsPreview(root);
        toast('success', `第 ${preview.messageId} 楼共 ${preview.segments.length} 句。`);
      } else if (action === 'tts-preview-play') {
        // Not awaited: the button must not stay disabled for as long as the sentence plays.
        void playTtsUtterance(Number(button.dataset.jyTtsMes), Number(button.dataset.jyTtsUtt));
      } else if (action === 'tts-copy-structure') {
        if (!runtime.tts.preview) throw new Error('先分析一楼。');
        await copyText(JSON.stringify(toStandardDocument(runtime.tts.preview.segments), null, 2));
        toast('success', '朗读结构 JSON 已复制。');
      } else if (action === 'tts-clear-chat') {
        stopTts();
        const removed = await ttsStore().clearChat(getCurrentChatId());
        runtime.tts.analysis.clear();
        runtime.tts.recordings.clear();
        runtime.tts.overrides.clear();
        runtime.tts.floors.clear();
        await renderTtsUsage(root);
        toast('success', `已清掉本聊天的 ${removed} 条朗读缓存。`);
      } else if (action === 'tts-clear-all') {
        stopTts();
        await ttsStore().clear();
        runtime.tts.analysis.clear();
        runtime.tts.recordings.clear();
        runtime.tts.overrides.clear();
        runtime.tts.floors.clear();
        await renderTtsUsage(root);
        toast('success', '朗读缓存已全部清空。');
      } else if (action === 'inspect-tags') {
        const report = await inspectCurrentFloor(root);
        if (report.errors.length) toast('warning', '标签检查完成，发现需要处理的问题。');
        else toast('success', `结构检查正常，共 ${report.paragraphs} 个段落、${report.translationUnits} 个翻译行。`);
      } else if (action === 'refresh-logs') {
        renderDiagnosticLog(root);
      } else if (action === 'clear-logs') {
        clearDiagnostics();
        renderDiagnosticLog(root, []);
        toast('success', '本机诊断日志已清空。');
      } else if (action === 'refresh-wi-entries') {
        // A dry scan forces SillyTavern to re-sort lore, which re-emits WORLDINFO_ENTRIES_LOADED.
        try { await getContext().getWorldInfoPrompt([''], 8, true); } catch { /* best-effort cache refresh */ }
        renderWorldInfoList(root);
      } else if (action === 'toggle-export-drawer') {
        const drawer = root.querySelector('[data-jy-export-drawer]');
        if (drawer) drawer.dataset.open = drawer.dataset.open === 'true' ? 'false' : 'true';
      } else if (action === 'export-recent') {
        const input = root.querySelector('[data-jy-export-floors]');
        const count = clampInteger(Number(input?.value), 1, 999, 1);
        const entries = readDiagnostics();
        const floors = listDiagnosticFloors(entries);
        if (!floors.length) throw new Error('日志里还没有带楼层的翻译记录。');
        const selected = new Set(floors.slice(-count));
        const scoped = entries.filter(entry => selected.has(entry.floor));
        downloadLogTxt(scoped, `最近 ${count} 楼`);
      } else if (action === 'export-all') {
        downloadLogTxt(readDiagnostics(), '全部');
      }
      if (['translate', 'translate-missing', 'test-api'].includes(action)) await refreshCurrentCard(root);
    } catch (error) {
      setText(root, '[data-jy-live]', safeError(error));
      toast('error', safeError(error));
    } finally {
      button.disabled = false;
    }
  };

  const onChange = async event => {
    if (event.target.matches('[data-jy-processing-import], [data-jy-processing-regex-import]')) {
      const input = event.target, files = [...(input.files ?? [])];
      if (!files.length) return;
      input.disabled = true;
      try {
        if (files.length > 100) throw new Error('一次最多选择 100 个文件。');
        const data = await Promise.all(files.map(readProcessingJson));
        let next = collectSettings(root);
        if (input.matches('[data-jy-processing-import]')) next = addProcessingProfile(next, importProcessingProfile(data[0]));
        else {
          const rules = data.flatMap(importNativeRegex), active = getActiveProcessingProfile(next);
          if (active.regexScripts.length + rules.length > 100) throw new Error('每个正文方案最多绑定 100 条正则。');
          active.regexScripts.push(...rules);
        }
        await persistProcessing(root, next);
        toast('success', `已导入并绑定，当前方案共 ${getActiveProcessingProfile(runtime.settings).regexScripts.length} 条正则。`);
      } catch (error) { toast('error', `导入失败：${safeError(error)}`); }
      finally { input.value = ''; input.disabled = false; }
      return;
    }
    if (event.target.matches('[data-jy-processing-select], [data-jy-processing-rule]')) {
      try {
        let next = collectSettings(root);
        if (event.target.matches('[data-jy-processing-select]')) next = selectProcessingProfile(next, event.target.value);
        await persistProcessing(root, next);
      } catch (error) { toast('error', safeError(error)); syncFields(root, runtime.settings); }
      return;
    }
    if (event.target.matches('[data-jy-profile-import]')) {
      const input = event.target, file = input.files?.[0];
      if (!file) return;
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error('方案文件不能超过 2 MB。');
        const data = JSON.parse((await file.text()).replace(/^\\uFEFF/, ''));
        if (data?.format !== 'jingyi-prompt-profile' || data.version !== 1 || !data.profile || typeof data.profile !== 'object' || Array.isArray(data.profile)) throw new Error('请选择镜译导出的提示词方案 JSON。');
        const allowed = Object.keys(DEFAULT_PROMPT_PROFILE);
        const clean = {};
        for (const key of allowed) {
          if (!Object.hasOwn(data.profile, key) || key === 'id') continue;
          const value = data.profile[key];
          if (key === 'customSections') {
            if (!Array.isArray(value) || value.length > 100) throw new Error('自定义条目格式不正确。');
            clean[key] = value.map((item, index) => {
              if (!item || typeof item.title !== 'string' || typeof item.content !== 'string') throw new Error('自定义条目需要名称和正文。');
              return { id: createLocalId('section') + '-' + index, title: item.title, content: item.content, enabled: item.enabled !== false };
            });
          } else {
            if (typeof value !== 'string') throw new Error('方案字段格式不正确：' + key);
            clean[key] = value;
          }
        }
        const next = collectSettings(root);
        if (next.promptProfiles.length >= 20) throw new Error('已达到 20 套方案，请先删除不用的方案。');
        const id = createLocalId('prompt-profile');
        const profile = normalizePromptProfile({ ...clean, id }, id);
        if (next.promptProfiles.some(item => item.name === profile.name)) profile.name += ' · 导入';
        next.promptProfiles.push(profile); next.selectedPromptProfileId = id;
        saveSettings(next); syncFields(root, runtime.settings);
        toast('success', '已导入为新方案，原有方案保留。');
      } catch (error) { toast('error', '导入失败：' + safeError(error)); }
      finally { input.value = ''; }
      return;
    }
    if (event.target.matches('[data-jy-prompt-profile-select]')) {
      const next = collectSettings(root);
      if (next.promptProfiles.some(profile => profile.id === event.target.value)) {
        next.selectedPromptProfileId = event.target.value;
        saveSettings(next);
        syncFields(root, runtime.settings);
      }
      return;
    }
    if (event.target.matches('[data-jy-model-select]')) {
      const modelInput = root.querySelector('[data-jy-channel-field="model"]');
      if (modelInput) modelInput.value = event.target.value;
      saveSettings(collectSettings(root));
      syncFields(root, runtime.settings);
      return;
    }
    if (event.target.matches('[data-jy-profile-field="styleMode"], [data-jy-profile-field="leaningMode"], [data-jy-profile-field="honorificMode"], [data-jy-profile-field="nameMode"], [data-jy-profile-field="punctuationMode"]')) {
      updatePromptConditionalFields(root);
    }
    if (event.target.matches('[data-jy-edit-channel]')) {
      // What was typed into the connection being left is kept before another one is opened; opening
      // one changes nothing any feature uses.
      saveSettings(collectSettings(root));
      runtime.editingChannelId = event.target.value;
      syncFields(root, runtime.settings);
      return;
    }
    if (event.target.matches('[data-jy-translation-channel]')) {
      saveSettings(collectSettings(root));
      syncFields(root, runtime.settings);
      toast('success', `翻译改用：${channelLabel(runtime.settings, translationChannelChoice(runtime.settings))}。朗读用的连接不受影响。`);
      return;
    }
    if (event.target.matches('[data-jy-field="floatingStyle"]')) {
      saveSettings(collectSettings(root));
      syncFloatingEntry();
      return;
    }
    if (event.target.matches('[data-jy-field="floorButtons"], [data-jy-field="leftHanded"]')) {
      saveSettings(collectSettings(root));
      scheduleTtsDecorateAll({ force: true });
      runtime.mini?.syncQuickPickers?.();
      return;
    }
    if (event.target.matches('[data-jy-field="autoGeneration"], [data-jy-field="autoSwipe"], [data-jy-field="streamingWriteback"], [data-jy-field="showFloatingButton"], [data-jy-field="includeWorldbook"], [data-jy-field="includeCharacterCard"], [data-jy-field="includeRecentContext"]')) {
      const name = event.target.dataset.jyField;
      for (const twin of fieldElements(root, name)) twin.checked = event.target.checked;
      saveSettings(collectSettings(root));
      syncFields(root, runtime.settings);
    }
    if (event.target.matches('[data-jy-field="coloringSpeakers"], [data-jy-field="coloringEmotions"], [data-jy-field="coloringRhythm"], [data-jy-field="coloringAutoSpeakers"], [data-jy-field="coloringContrast"]')) {
      saveSettings(collectSettings(root));
      syncColoringFields(root, runtime.settings);
    }
    // The reading switches take effect at once, like the translation switches on the desk.
    // A voice picked from the library fills the field beside it; the picker itself shows nothing.
    if (event.target.matches('[data-jy-tts-pick]')) {
      const input = event.target.closest('[data-jy-tts-pick-scope]')?.querySelector('input');
      if (input && event.target.value) {
        input.value = event.target.value;
        event.target.value = '';
        saveSettings(collectSettings(root));
        syncTtsFields(root, runtime.settings);
      }
      return;
    }
    if (event.target.matches('[data-jy-tts-voice-mute]')) {
      // The row list is not rebuilt here: doing so would take the focus off the switch just clicked.
      const row = event.target.closest('[data-jy-tts-voice-row]');
      const badge = row?.querySelector('[data-jy-tts-voice-lock]');
      if (badge) {
        const own = badge.dataset.locked === 'true';
        badge.dataset.muted = String(event.target.checked);
        badge.textContent = event.target.checked ? '🔇 不朗读' : own ? '🔒 专属音色' : '跟随默认音色';
      }
      saveSettings(collectSettings(root));
      syncTtsFoldSummaries(root, runtime.settings);
      return;
    }
    if (event.target.matches('[data-jy-tts-field="enabled"], [data-jy-tts-field="side"], [data-jy-tts-field="mode"], [data-jy-tts-field="range"], [data-jy-tts-field="sanitizeHtml"], [data-jy-tts-field="emotionCues"], [data-jy-tts-field="prosodySplit"], [data-jy-tts-field="autoGenerate"], [data-jy-tts-field="dialogueFallback"], [data-jy-tts-field="speechMarks"], [data-jy-tts-field="analysisChannelId"], [data-jy-tts-field="playAfterGenerate"], [data-jy-tts-field="autoRead"], [data-jy-tts-field="readWhileWriting"], [data-jy-tts-field="callChannelId"], [data-jy-tts-field="sttProvider"], [data-jy-tts-field="sttPreset"], [data-jy-tts-field="tamePunctuation"], [data-jy-tts-field="deepChannelId"], [data-jy-tts-field="requestUnit"], [data-jy-tts-field="downloadScope"], [data-jy-tts-field="voiceScope"], [data-jy-tts-context], [data-jy-tts-fish="model"], [data-jy-tts-fish="viaProxy"], [data-jy-tts-fish="format"], [data-jy-tts-fish="latency"]')) {
      if (event.target.matches('[data-jy-tts-field="sttPreset"]')) {
        const preset = STT_PRESETS[event.target.value];
        if (preset) {
          const url = root.querySelector('[data-jy-tts-field="sttUrl"]');
          const model = root.querySelector('[data-jy-tts-field="sttModel"]');
          if (url) url.value = preset.url;
          if (model) model.value = preset.model;
        }
      }
      // The feature switch lives on two pages; the one just clicked decides, the other follows.
      if (event.target.matches('[data-jy-tts-field="enabled"]')) {
        for (const twin of root.querySelectorAll('[data-jy-tts-field="enabled"]')) twin.checked = event.target.checked;
      }
      try {
        saveSettings(collectSettings(root));
        syncTtsFields(root, runtime.settings);
        // The connection page says who uses what; a choice made here shows there at once.
        if (event.target.matches('[data-jy-tts-field="analysisChannelId"], [data-jy-tts-field="deepChannelId"]')) syncChannelFields(root, runtime.settings);
      } catch (error) {
        toast('error', safeError(error));
      }
      return;
    }
    // Picking a colour must not rebuild the list: a row the user has not named yet would be dropped
    // out from under them mid-edit.
    if (event.target.matches('[data-jy-speaker-color], [data-jy-speaker-from]')) {
      saveSettings(collectSettings(root));
      refreshSpeakerPreviews(root, runtime.settings);
    }
  };

  const onInput = event => {
    // A console slider shows its number beside it as it moves.
    if (event.target.matches('[data-jy-console-key]')) {
      const output = event.target.nextElementSibling;
      if (output) output.textContent = consoleWord(event.target.dataset.jyConsoleKey, event.target.value);
    }
    // A folded character row shows its name; the name typed into it shows up there at once.
    if (event.target.matches('[data-jy-tts-voice-name]')) {
      const label = event.target.closest('[data-jy-tts-voice-row]')?.querySelector('[data-jy-tts-voice-summary-name]');
      if (label) label.textContent = event.target.value.trim() || '（未命名）';
    }
    if (event.target.matches('[data-jy-field="coloringVividness"]')) {
      const percent = Number(event.target.value);
      setText(root, '[data-jy-vividness-value]', `${percent}%`);
      // Live preview only; the value is persisted on the next save like every other field.
      runtime.settings = { ...runtime.settings, coloring: { ...activeColoring(), vividness: percent / 100 } };
      refreshSpeakerPreviews(root, runtime.settings);
      return;
    }
    if (event.target.matches('[data-jy-speaker-name], [data-jy-speaker-aliases]')) {
      refreshSpeakerPreviews(root, runtime.settings);
      return;
    }
    if (event.target.matches('[data-jy-model-search]')) {
      const query = event.target.value.trim().toLowerCase();
      const select = root.querySelector('[data-jy-model-select]');
      for (const option of select.options) {
        option.hidden = Boolean(option.value && !option.selected && !option.textContent.toLowerCase().includes(query));
      }
      return;
    }
    if (!event.target.matches('[data-jy-profile-field], [data-jy-custom-field], [data-jy-prompt-profile-name]')) return;
    const draft = collectSettings(root);
    const profile = getActivePromptProfile(draft);
    setText(root, '[data-jy-prompt-size]', `${countPromptCharacters(profile).toLocaleString()} 字`);
    setText(
      root,
      '[data-jy-language-support]',
      isSimplifiedChineseTarget(profile.targetLanguage)
        ? '简体中文会启用完整内置文风、称谓、专名、标点与杀八股规则。'
        : `${normalizeTargetLanguage(profile.targetLanguage)} 使用通用翻译规范；自定义规则照常生效。`,
    );
  };

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  return {
    root,
    cleanup() {
      unsubscribe();
      unsubscribeDiagnostics();
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      root.removeEventListener('input', onInput);
    },
  };
}

async function loadPanelCss() {
  if (!runtime.panelCssPromise) {
    runtime.panelCssPromise = fetch(new URL('./style.css', import.meta.url))
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .catch(error => {
        console.warn(`[${APP_NAME}] 无法读取完整样式，使用最小样式。`, error);
        return FALLBACK_PANEL_CSS;
      })
      // Kept on the runtime: the small dialogs read it from here, and without it they used to open
      // as bare text over the page — no backdrop, no card, no buttons.
      .then(css => {
        runtime.panelCss = css;
        return css;
      });
  }
  return runtime.panelCssPromise;
}

function closeControlCenter() {
  runtime.panel?.close?.();
}

async function openControlCenter() {
  if (runtime.panel?.host?.isConnected) {
    runtime.panel.closeButton.focus();
    return runtime.panel;
  }
  closeControlCenter();
  document.getElementById(PANEL_HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = PANEL_HOST_ID;
  host.dataset.jingyiVersion = APP_VERSION;
  host.dataset.theme = runtime.settings.theme || 'day';
  host.style.cssText = `${SHADOW_HOST_BOX}z-index:2147483000;pointer-events:none;`;
  keepTypingInside(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = await loadPanelCss();
  const overlay = document.createElement('div');
  overlay.className = 'jy-overlay';
  const dialog = document.createElement('section');
  dialog.className = 'jy-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', APP_NAME);
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'jy-close';
  closeButton.setAttribute('aria-label', '关闭镜译控制中心');
  closeButton.textContent = '×';
  const viewport = document.createElement('div');
  viewport.className = 'jy-viewport';
  const controller = createControlCenter(document);
  viewport.appendChild(controller.root);
  dialog.append(closeButton, viewport);
  overlay.appendChild(dialog);
  shadow.append(style, overlay);

  const previousFocus = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown, true);
    overlay.removeEventListener('click', onBackdropClick);
    closeButton.removeEventListener('click', close);
    controller.cleanup();
    host.remove();
    if (runtime.panel?.host === host) runtime.panel = null;
    if (previousFocus?.isConnected) previousFocus.focus?.();
  };
  const onBackdropClick = event => {
    if (event.target === overlay) close();
  };
  const onKeydown = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...shadow.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')]
      .filter(element => !element.closest('[hidden]') && element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && shadow.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && shadow.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', onBackdropClick);
  document.addEventListener('keydown', onKeydown, true);
  document.body.appendChild(host);
  runtime.panel = { host, shadow, closeButton, controller, close };
  closeButton.focus();
  return runtime.panel;
}

function ensureMenuEntry() {
  const menu = document.getElementById('extensionsMenu');
  if (!menu) return false;
  if (document.getElementById(MENU_ENTRY_ID)) return true;

  const entry = document.createElement('div');
  entry.id = MENU_ENTRY_ID;
  entry.className = 'list-group-item flex-container flexGap5 interactable';
  entry.tabIndex = 0;
  entry.setAttribute('role', 'button');
  entry.setAttribute('aria-label', `打开${APP_NAME}`);
  const icon = document.createElement('i');
  icon.className = 'fa-solid fa-language fa-fw';
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = APP_NAME;
  entry.append(icon, label);

  const activate = event => {
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    openControlCenter().catch(error => toast('error', safeError(error)));
  };
  entry.addEventListener('click', activate);
  entry.addEventListener('keydown', activate);
  menu.appendChild(entry);
  runtime.menuCleanup = () => {
    entry.removeEventListener('click', activate);
    entry.removeEventListener('keydown', activate);
    entry.remove();
  };
  return true;
}

function ensureSettingsEntry() {
  const target = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
  if (!target) return false;
  if (document.getElementById(SETTINGS_ID)) return true;

  const shell = document.createElement('div');
  shell.id = SETTINGS_ID;
  shell.className = 'extension_container';
  shell.dataset.extensionId = MODULE_ID;
  shell.innerHTML = `
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>镜译 · 正文翻译器</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <p>提取所选正文标签中的原文，按空行段落交给翻译通道，再把目标语言镜像写回当前回复。</p>
        <div class="jingyi-entry-row">
          <span class="jingyi-entry-state">v${APP_VERSION} · 支持世界书与固定译名</span>
          <button type="button" class="menu_button jingyi-open-button">打开控制中心</button>
        </div>
      </div>
    </div>`;
  const button = shell.querySelector('.jingyi-open-button');
  const activate = () => openControlCenter().catch(error => toast('error', safeError(error)));
  button.addEventListener('click', activate);
  target.appendChild(shell);
  runtime.settingsCleanup = () => {
    button.removeEventListener('click', activate);
    shell.remove();
  };
  return true;
}


const FLOATING_HOLD_MS = 2200;
const FLOATING_LABELS = Object.freeze({
  idle: '点击打开',
  running: '翻译中',
  success: '已完成',
  error: '未完成',
});

function isCompactViewport() {
  return globalThis.matchMedia?.('(max-width: 767px), (pointer: coarse)')?.matches === true;
}

/**
 * Which buttons a floor wears: one pair per paragraph ('line'), those plus the per-sentence pair
 * ('sentence'), or none ('off'). The paragraph pair is not the device's call any more — a paragraph
 * is the unit the audio is made in, and its buttons are large enough for a thumb.
 */
function floorButtonMode(settings = runtime.settings) {
  const mode = settings?.floorButtons;
  if (FLOOR_BUTTON_MODES.includes(mode)) return mode;
  // Settings written by an older version, in case one reaches here unnormalised.
  return mode === 'on' ? 'sentence' : mode === 'off' ? 'off' : 'line';
}

function floorButtonsOn(settings = runtime.settings) {
  return floorButtonMode(settings) !== 'off';
}

// Shape follows state, not taps: the ring is the quiet form, the pill only appears when there is
// something to report, and the edge tab is the phone form.
function resolveFloatingForm(status) {
  const preference = runtime.settings.floatingStyle || 'auto';
  if (preference !== 'auto') return preference;
  if (isCompactViewport()) return 'edge';
  if (status === 'running' || runtime.floatingHold) return 'pill';
  return 'ring';
}

function syncFloatingEntry() {
  const button = typeof document === 'undefined' ? null : document.getElementById(FLOATING_ID);
  if (!button) return;
  const task = runtime.task;
  const percent = Math.max(0, Math.min(100, Number(task.progress) || 0));
  button.dataset.status = task.status;
  button.dataset.form = resolveFloatingForm(task.status);
  // Only a run in progress draws a partial arc; every other state shows the ring closed in its colour.
  const ratio = task.status === 'running' ? percent / 100 : 1;
  button.style.setProperty('--jy-fab-progress', String(ratio));
  const label = button.querySelector('.jingyi-fab-label');
  const count = button.querySelector('.jingyi-fab-count');
  if (label) label.textContent = FLOATING_LABELS[task.status] || FLOATING_LABELS.idle;
  if (count) count.textContent = task.status === 'running' ? `${Math.round(percent)}%` : '';
  // The entry remembers its own position; reading it back from style.left would hand a docked tab,
  // which has no left, a position of 0 the moment it turns back into a ball.
  runtime.floatingPlace?.();
}

// Keeps the pill open long enough to read, then lets it settle back to the ring. An idle entry has
// nothing to report, so it never expands — an empty pill reads as a broken control.
function holdFloatingPill(duration = FLOATING_HOLD_MS) {
  if (typeof document === 'undefined' || !document.getElementById(FLOATING_ID)) return;
  if (runtime.task.status === 'idle') {
    runtime.floatingHold = false;
    syncFloatingEntry();
    return;
  }
  if (runtime.floatingHoldTimer) {
    clearTimeout(runtime.floatingHoldTimer);
    runtime.timers.delete(runtime.floatingHoldTimer);
  }
  runtime.floatingHold = true;
  syncFloatingEntry();
  const timer = setTimeout(() => {
    runtime.floatingHold = false;
    runtime.floatingHoldTimer = null;
    runtime.timers.delete(timer);
    syncFloatingEntry();
  }, duration);
  runtime.floatingHoldTimer = timer;
  runtime.timers.add(timer);
}

function readFloatingPosition() {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(FLOATING_POSITION_KEY) || 'null');
    if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) return value;
  } catch {
    // Local visual state is optional.
  }
  return { x: Math.max(12, globalThis.innerWidth - 76), y: Math.round(globalThis.innerHeight * 0.62) };
}

function ensureFloatingButton() {
  if (!runtime.settings.showFloatingButton) {
    runtime.floatingCleanup?.();
    runtime.floatingCleanup = null;
    document.getElementById(FLOATING_ID)?.remove();
    return false;
  }
  const existing = document.getElementById(FLOATING_ID);
  if (existing) return true;
  runtime.floatingCleanup?.();

  const button = document.createElement('button');
  button.id = FLOATING_ID;
  button.type = 'button';
  button.className = 'jingyi-floating-button';
  button.dataset.status = runtime.task.status;
  button.dataset.theme = runtime.settings.theme || 'day';
  button.setAttribute('aria-label', `打开${APP_NAME}，可拖动`);
  button.title = '镜译 · 拖动调整位置，点击打开悬浮窗';
  button.innerHTML = `
    <span class="jingyi-fab-core">
      <svg class="jingyi-fab-ring" viewBox="0 0 36 36" aria-hidden="true">
        <circle class="jingyi-fab-track" cx="18" cy="18" r="16" pathLength="100"></circle>
        <circle class="jingyi-fab-value" cx="18" cy="18" r="16" pathLength="100"></circle>
      </svg>
      <span class="jingyi-fab-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 20l4.2-1 10.9-10.9a2 2 0 0 0-2.8-2.8L5.4 16.2 4 20Z"></path><path d="m14.9 6.7 2.8 2.8"></path></svg></span>
    </span>
    <span class="jingyi-fab-detail" aria-hidden="true">
      <span class="jingyi-fab-line"><span class="jingyi-fab-label"></span><span class="jingyi-fab-count"></span></span>
      <span class="jingyi-fab-bar"><i></i></span>
    </span>`;
  const position = readFloatingPosition();
  let pointerId = null;
  let moved = 0;
  let startX = 0;
  let startY = 0;
  let grabX = 0;
  let grabY = 0;
  let suppressClickUntil = 0;

  const place = (x = position.x, y = position.y) => {
    const width = button.offsetWidth || 42;
    const height = button.offsetHeight || 42;
    // clientWidth leaves out a classic scrollbar, which innerWidth counts as room to stand in.
    const viewportWidth = document.documentElement?.clientWidth || globalThis.innerWidth;
    position.y = Math.min(Math.max(8, y), Math.max(8, globalThis.innerHeight - height - 4));
    button.style.top = `${position.y}px`;
    // The edge form is docked to the right rim and only travels vertically. It is docked by the
    // stylesheet rather than by `innerWidth - offsetWidth`: the width animates between forms, and a width
    // measured mid-animation left the tab short of the rim or pushed it past it. The free position is
    // kept untouched, so leaving the edge form puts the ball back where it was.
    if (button.dataset.form === 'edge') {
      button.style.left = '';
      button.style.right = '0px';
      return;
    }
    position.x = Math.min(Math.max(8, x), Math.max(8, viewportWidth - width));
    button.style.right = '';
    button.style.left = `${position.x}px`;
  };
  runtime.floatingPlace = place;
  const savePosition = () => {
    try {
      globalThis.localStorage?.setItem(FLOATING_POSITION_KEY, JSON.stringify(position));
    } catch {
      // Local visual state is optional.
    }
  };
  const onPointerDown = event => {
    if (event.button !== 0) return;
    event.preventDefault();
    pointerId = event.pointerId;
    moved = 0;
    startX = event.clientX;
    startY = event.clientY;
    grabX = event.clientX - position.x;
    grabY = event.clientY - position.y;
    button.classList.add('is-dragging');
    button.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = event => {
    if (event.pointerId !== pointerId) return;
    moved = Math.max(moved, Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY));
    place(event.clientX - grabX, event.clientY - grabY);
  };
  const finishPointer = event => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    button.classList.remove('is-dragging');
    // A tap is handled by the native click that follows; only a real drag swallows it.
    if (moved < 6) return;
    suppressClickUntil = globalThis.performance.now() + 300;
    savePosition();
  };
  const onClick = event => {
    if (globalThis.performance.now() < suppressClickUntil) {
      event.preventDefault();
      return;
    }
    toggleMiniWindow();
  };
  const onKeydown = event => {
    if (!['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    suppressClickUntil = globalThis.performance.now() + 300;
    toggleMiniWindow();
  };
  // Crossing the phone breakpoint changes the form, not just the room: re-resolve the shape first so a
  // window narrowed to phone width becomes a tab now rather than at the next translation update.
  const onResize = () => {
    syncFloatingEntry();
    place();
    savePosition();
  };

  place(position.x, position.y);
  button.addEventListener('pointerdown', onPointerDown);
  button.addEventListener('click', onClick);
  button.addEventListener('keydown', onKeydown);
  globalThis.addEventListener('pointermove', onPointerMove);
  globalThis.addEventListener('pointerup', finishPointer);
  globalThis.addEventListener('pointercancel', finishPointer);
  globalThis.addEventListener('resize', onResize);
  document.body.appendChild(button);
  syncFloatingEntry();
  runtime.floatingCleanup = () => {
    globalThis.removeEventListener('pointermove', onPointerMove);
    globalThis.removeEventListener('pointerup', finishPointer);
    globalThis.removeEventListener('pointercancel', finishPointer);
    globalThis.removeEventListener('resize', onResize);
    runtime.floatingPlace = null;
    button.remove();
  };
  return true;
}


function overlapsRect(spot, width, height, rect) {
  return spot.x < rect.right && spot.x + width > rect.left && spot.y < rect.bottom && spot.y + height > rect.top;
}

// The ball is the anchor the user actually positions, so the window re-hangs off it on every open
// instead of remembering a spot of its own: a stored corner goes stale the moment the ball moves.
// Candidates are tried in order because clamping a near-edge position can otherwise park the window
// right on top of the ball.
function anchorMiniPosition(win) {
  const width = win.offsetWidth || 344;
  const height = win.offsetHeight || 360;
  const maxX = Math.max(8, globalThis.innerWidth - width - 8);
  const maxY = Math.max(8, globalThis.innerHeight - height - 8);
  const ball = document.getElementById(FLOATING_ID)?.getBoundingClientRect();
  if (!ball) return { x: maxX, y: maxY };
  const clampX = value => Math.min(Math.max(8, value), maxX);
  const clampY = value => Math.min(Math.max(8, value), maxY);
  // Line the window up with the ball's right edge, and flip to its left edge when that would clip.
  const alignedX = clampX(ball.right - width < 8 ? ball.left : ball.right - width);
  const alignedY = clampY(ball.top);
  const candidates = [
    { x: alignedX, y: ball.top - MINI_GAP - height },
    { x: alignedX, y: ball.bottom + MINI_GAP },
    { x: ball.left - MINI_GAP - width, y: alignedY },
    { x: ball.right + MINI_GAP, y: alignedY },
  ];
  for (const candidate of candidates) {
    const spot = { x: clampX(candidate.x), y: clampY(candidate.y) };
    if (!overlapsRect(spot, width, height, ball)) return spot;
  }
  return { x: alignedX, y: clampY(ball.bottom + MINI_GAP) };
}

// One-off translation that never touches a chat floor: same profile and channel, glossary only.
async function translateScratchText(text, settings, signal) {
  const source = String(text ?? '').trim();
  if (!source) throw new Error('先粘一段原文进来。');
  const profile = getActivePromptProfile(settings);
  const packet = { glossary: String(profile.glossary ?? ''), character: '', worldbook: '', recent: '' };
  const recovered = await invokeTranslationBatch([{ id: 1, text: source }], settings, signal, packet);
  const result = recovered.translations.get(1);
  if (!result) throw new Error('副模型没有返回可用译文。');
  return result;
}

function closeMiniWindow() {
  runtime.mini?.close?.();
}

const MINI_POSITION_KEY = `${MODULE_ID}-mini-position`;
const MINI_SIZE_KEY = `${MODULE_ID}-mini-size`;
const MINI_ROW_LIMIT = 400;
const MINI_LOG_LIMIT = 80;

function readMiniPosition() {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(MINI_POSITION_KEY) || 'null');
    if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) return { x: value.x, y: value.y };
  } catch {
    // Local visual state is optional.
  }
  return null;
}

function saveMiniPosition(position) {
  try {
    globalThis.localStorage?.setItem(MINI_POSITION_KEY, JSON.stringify({ x: Math.round(position.x), y: Math.round(position.y) }));
  } catch {
    // Local visual state is optional.
  }
}

// A phone opens the window full-size the first time; a reader who shrinks it once is remembered.
function readMiniSize(touch) {
  try {
    const value = globalThis.localStorage?.getItem(MINI_SIZE_KEY);
    if (value === 'max' && touch) return value;
    if (value === 'card' || value === 'compact') return value;
  } catch {
    // Local visual state is optional.
  }
  // The first layer: a small window with the floor's state and the play bar; enlarged, the pages.
  return 'compact';
}

// The sizes in the order the button walks them: the brief window, the card, and on a phone the screen.
function nextMiniSize(size, touch) {
  if (size === 'compact') return 'card';
  if (size === 'card') return touch ? 'max' : 'compact';
  return 'compact';
}

function saveMiniSize(size) {
  try {
    globalThis.localStorage?.setItem(MINI_SIZE_KEY, size);
  } catch {
    // Local visual state is optional.
  }
}

// The assistant floors of the chat, in order, for the window's floor arrows.
function assistantFloorIds(context = getContext()) {
  const chat = Array.isArray(context?.chat) ? context.chat : [];
  const ids = [];
  chat.forEach((message, index) => {
    if (message && !message.is_user && !message.is_system && typeof message.mes === 'string') ids.push(index);
  });
  return ids;
}

function miniClock(seconds) {
  const whole = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function miniShort(text, limit) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

async function openMiniWindow() {
  if (runtime.mini?.host?.isConnected) return runtime.mini;
  document.getElementById(MINI_HOST_ID)?.remove();

  const settings = runtime.settings;
  const touch = isCompactViewport();
  const host = document.createElement('div');
  host.id = MINI_HOST_ID;
  host.dataset.jingyiVersion = APP_VERSION;
  host.dataset.theme = settings.theme || 'day';
  host.style.cssText = `${SHADOW_HOST_BOX}z-index:2147482950;pointer-events:none;`;
  keepTypingInside(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = await loadPanelCss();

  const win = document.createElement('section');
  win.className = 'jy-mini';
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-label', `${APP_NAME} 悬浮窗`);
  win.dataset.touch = touch ? 'true' : 'false';
  win.dataset.hand = settings.leftHanded ? 'left' : 'right';
  // The full-size form belongs to phones; a desktop window is always the card.
  win.dataset.size = readMiniSize(touch);
  win.dataset.miniTab = 'translate';
  win.innerHTML = `
<div class="jy-mini-bar" data-jy-mini-drag>
  <span class="jy-mini-mark" aria-hidden="true">镜</span>
  <span class="jy-mini-name"><span data-jy-mini-title>镜译</span><span class="jy-dot" data-jy-task-dot="idle"></span></span>
  <button type="button" data-jy-action="mini-max" aria-label="展开" title="展开">⤢</button>
  <button type="button" data-jy-action="mini-expand" aria-label="打开控制中心" title="控制中心">⚙</button>
  <button type="button" data-jy-action="mini-collapse" aria-label="收起悬浮窗" title="收起">−</button>
</div>
<div class="jy-mini-brief" data-jy-mini-brief>
  <div class="jy-mini-brief-floor"><span data-jy-mini-brief-title>镜译</span><span class="jy-muted" data-jy-mini-brief-state></span></div>
  <p class="jy-mini-brief-task" data-jy-mini-brief-task hidden></p>
  <button type="button" class="jy-mini-playbar" data-jy-action="mini-goto-reading" data-jy-mini-playbar hidden>
    <span class="jy-mini-playbar-glyph" data-jy-mini-playbar-glyph aria-hidden="true">▶</span>
    <span class="jy-progress" aria-hidden="true"><span data-jy-mini-playbar-fill></span></span>
    <span class="jy-mini-playbar-text" data-jy-mini-playbar-text></span>
  </button>
  <div class="jy-mini-brief-actions">
    <button type="button" class="jy-button jy-button-primary" data-jy-action="mini-translate" hidden>翻译本楼</button>
    <button type="button" class="jy-button jy-mini-danger" data-jy-action="mini-stop" hidden>停止翻译</button>
    <button type="button" class="jy-mini-play jy-mini-play-brief" data-jy-action="tts-toggle" aria-label="播放或暂停" title="播放 / 暂停" hidden>▶</button>
    <button type="button" class="jy-button jy-mini-danger" data-jy-action="tts-stop" data-jy-brief-stop hidden>停止朗读</button>
    <button type="button" class="jy-button" data-jy-action="mini-brief-read">读这一楼</button>
    <button type="button" class="jy-button" data-jy-action="mini-max">展开</button>
  </div>
</div>
<div class="jy-mini-tabs" role="tablist" data-jy-mini-tabs>
  <button type="button" role="tab" aria-selected="true" data-jy-mini-tab="translate">翻译</button>
  <button type="button" role="tab" aria-selected="false" data-jy-mini-tab="reading">朗读</button>
  <button type="button" role="tab" aria-selected="false" data-jy-mini-tab="log">日志</button>
  <button type="button" role="tab" aria-selected="false" data-jy-mini-tab="call">通话测试</button>
</div>
<div class="jy-mini-body jy-mini-translate" data-jy-mini-page="translate">
  <div class="jy-mini-scroll">
  <div class="jy-mini-status">
    <div class="jy-mini-status-top">
      <div class="jy-mini-floor-nav">
        <button type="button" data-jy-action="mini-floor-prev" aria-label="上一楼" title="上一楼">‹</button>
        <strong data-jy-mini-floor-title>等待正文</strong>
        <button type="button" data-jy-action="mini-floor-next" aria-label="下一楼" title="下一楼">›</button>
      </div>
      <span data-jy-mini-floor-state>—</span>
    </div>
    <div class="jy-mini-batches" data-jy-mini-batches hidden></div>
    <p class="jy-muted jy-mini-taskline"><span data-jy-task-message></span><span class="jy-mini-eta" data-jy-mini-eta></span></p>
    <button type="button" class="jy-mini-thinking" data-jy-action="mini-thinking" data-jy-mini-thinking hidden aria-expanded="false"><span class="jy-mini-thinking-mark" aria-hidden="true">◔</span><span class="jy-mini-thinking-text" data-jy-mini-thinking-text></span><span class="jy-mini-thinking-more" data-jy-mini-thinking-more>展开</span></button>
    <pre class="jy-mini-thinking-full" data-jy-mini-thinking-full hidden></pre>
  </div>
  <ol class="jy-mini-rows" data-jy-mini-rows></ol>
  </div>
  <div class="jy-mini-more" data-jy-mini-more hidden>
    <div class="jy-mini-more-head"><strong>更多</strong><button type="button" class="jy-mini-inspect-close" data-jy-action="mini-more-close" aria-label="收起" title="收起">×</button></div>
    <div class="jy-mini-quick">
      <label title="只管翻译走哪条连接，和控制中心「翻译台」里那个是同一个选择。朗读分析在「朗读 → 01 读什么」里另选，互不影响。"><span class="jy-label">翻译模型</span><select data-jy-mini-channel></select></label>
      <label><span class="jy-label">方案</span><select data-jy-mini-profile></select></label>
      <button type="button" class="jy-text-button" data-jy-action="mini-translate-all" data-jy-mini-untranslated hidden></button>
    </div>
    <details class="jy-mini-scratch" data-jy-mini-scratch data-expanded="false">
      <summary class="jy-mini-scratch-top"><strong>随手翻</strong><span data-jy-mini-target>简体中文</span></summary>
      <div class="jy-mini-scratch-drawer">
        <div class="jy-mini-scratch-body">
          <textarea data-jy-mini-input rows="3" spellcheck="false" placeholder="粘一段原文进来，不写回楼层。"></textarea>
          <div class="jy-mini-run">
            <button type="button" class="jy-button jy-button-primary" data-jy-action="mini-scratch">翻译这段</button>
            <p class="jy-muted" data-jy-mini-note>Ctrl + Enter 直接翻</p>
          </div>
          <div class="jy-mini-result" data-jy-mini-result hidden>
            <p data-jy-mini-output></p>
            <div class="jy-mini-result-foot">
              <p class="jy-muted" data-jy-mini-meta></p>
              <button type="button" data-jy-action="mini-copy">复制</button>
            </div>
          </div>
        </div>
      </div>
    </details>
  </div>
  <div class="jy-mini-foot">
    <button type="button" class="jy-mini-playbar" data-jy-action="mini-goto-reading" data-jy-mini-playbar hidden>
      <span class="jy-mini-playbar-glyph" data-jy-mini-playbar-glyph aria-hidden="true">▶</span>
      <span class="jy-progress" aria-hidden="true"><span data-jy-mini-playbar-fill></span></span>
      <span class="jy-mini-playbar-text" data-jy-mini-playbar-text></span>
      <span class="jy-mini-playbar-more" aria-hidden="true">︿</span>
    </button>
    <div class="jy-mini-actions" data-jy-mini-actions>
      <button type="button" class="jy-button jy-button-primary" data-jy-action="mini-translate">翻译本楼</button>
      <button type="button" class="jy-button jy-mini-danger" data-jy-action="mini-stop" hidden>停止</button>
      <button type="button" class="jy-button" data-jy-action="mini-repair" hidden>补译</button>
      <button type="button" class="jy-button" data-jy-action="mini-retranslate" hidden>重翻</button>
      <button type="button" class="jy-button jy-mini-auto" data-jy-action="mini-auto" aria-pressed="true" title="新楼生成完自动翻译">自动 开</button>
      <button type="button" class="jy-button" data-jy-action="mini-more" aria-expanded="false" title="翻译模型、方案、全翻、随手翻">更多</button>
    </div>
  </div>
</div>
<div class="jy-mini-body jy-mini-reading" data-jy-mini-page="reading" hidden>
  <div class="jy-mini-scroll">
  <div class="jy-mini-player-head">
    <div class="jy-mini-status-top"><strong data-jy-tts-title>没有在读</strong><span data-jy-tts-floor>—</span></div>
    <div class="jy-mini-pills" data-jy-tts-pills hidden></div>
    <ul class="jy-mini-steps" data-jy-tts-steps hidden></ul>
  </div>
  <ol class="jy-mini-sentences" data-jy-tts-list hidden></ol>
  <p class="jy-muted jy-mini-sentences-note" data-jy-tts-list-note hidden></p>
  <div class="jy-mini-inspect" data-jy-tts-inspect hidden>
    <div class="jy-mini-inspect-head"><strong data-jy-tts-who>—</strong><select data-jy-tts-speaker aria-label="这一句是谁说的" title="这一句是谁说的。改了就按这个人的音色重新生成，不重新分析" hidden></select><button type="button" class="jy-mini-inspect-close" data-jy-action="tts-inspect-close" aria-label="关闭改句面板" title="关闭">×</button></div>
    <p class="jy-muted jy-mini-inspect-depth" data-jy-tts-depth></p>
    <p class="jy-mini-inspect-source" data-jy-tts-source hidden></p>
    <p class="jy-mini-inspect-text" data-jy-tts-text></p>
    <dl class="jy-mini-inspect-summary" data-jy-tts-summary hidden></dl>
    <label class="jy-mini-inspect-field"><span class="jy-label">发给 Fish 的内容（方括号里是情绪、停顿、强调标签，可以直接改、直接插）</span><textarea data-jy-tts-fish rows="3" spellcheck="false"></textarea></label>
    <div class="jy-mini-inspect-tags" data-jy-tts-tags></div>
    <div class="jy-mini-inspect-custom"><input type="text" data-jy-tts-custom maxlength="40" placeholder="自己写一条指令插到光标处，比如：压低声音"><button type="button" class="jy-text-button" data-jy-action="tts-insert-custom">插入</button></div>
    <div class="jy-mini-inspect-prosody"><label><span class="jy-label">语速</span><input type="number" data-jy-tts-speed min="0.5" max="2" step="0.05"></label><label><span class="jy-label">音量 dB</span><input type="number" data-jy-tts-volume min="-20" max="20" step="1"></label></div>
    <div class="jy-mini-inspect-actions">
      <button type="button" class="jy-button jy-button-primary" data-jy-action="tts-apply" hidden>重新生成并播放</button>
      <button type="button" class="jy-text-button" data-jy-action="tts-refine-sentence" title="说一句哪里不对，让副模型只改这一句的分析">改这一句的分析</button>
      <button type="button" class="jy-text-button" data-jy-action="tts-save-sentence" title="把这一句的音频存到本地，从已经听到的那一条里剪出来">保存这一句</button>
      <button type="button" class="jy-text-button" data-jy-action="tts-reset" hidden>恢复自动</button>
    </div>
    <p class="jy-muted" data-jy-tts-note></p>
  </div>
  </div>
  <div class="jy-mini-more" data-jy-mini-more hidden>
    <div class="jy-mini-more-head"><strong>更多</strong><button type="button" class="jy-mini-inspect-close" data-jy-action="mini-more-close" aria-label="收起" title="收起">×</button></div>
    <div class="jy-mini-links">
      <button type="button" class="jy-text-button" data-jy-action="tts-read-floor" title="从头朗读这一楼">从头读</button>
      <button type="button" class="jy-text-button" data-jy-action="tts-reanalyze" title="按你的意见改这一楼的分析，或者丢掉重来">重新分析</button>
      <button type="button" class="jy-text-button" data-jy-action="tts-download" title="把这段音频保存到本地">保存到本地</button>
      <button type="button" class="jy-text-button" data-jy-action="tts-locate" title="把聊天滚到正在读的句子">定位到正文</button>
      <button type="button" class="jy-text-button" data-jy-action="tts-copy-analysis" title="把这一楼的分析结果复制成 JSON">复制分析</button>
    </div>
  </div>
  <div class="jy-mini-foot jy-mini-player">
    <div class="jy-progress jy-progress-seek" data-jy-tts-seek role="slider" aria-label="播放进度，拖动或点击跳转" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0"><span data-jy-tts-progress></span><i data-jy-tts-knob></i></div>
    <div class="jy-mini-clock"><span data-jy-tts-clock-now>0:00</span><span class="jy-muted" data-jy-tts-message>点播放键读这一楼，或者点上面的某一句。</span><span data-jy-tts-clock-total>0:00</span></div>
    <div class="jy-mini-transport">
      <button type="button" class="jy-button jy-mini-danger" data-jy-action="tts-stop" title="停止朗读" disabled>停止</button>
      <button type="button" class="jy-button" data-jy-action="tts-prev" title="回到上一段">上一段</button>
      <button type="button" class="jy-mini-play" data-jy-action="tts-toggle" aria-label="播放或暂停" title="播放 / 暂停">▶</button>
      <button type="button" class="jy-button" data-jy-action="tts-next" title="快进到下一段">下一段</button>
      <button type="button" class="jy-button" data-jy-action="mini-more" aria-expanded="false" title="从头读、重新分析、保存到本地、定位到正文、复制分析">更多</button>
    </div>
  </div>
</div>
<div class="jy-mini-body jy-mini-logpage" data-jy-mini-page="log" hidden>  <div class="jy-mini-log-filters" data-jy-mini-log-filters>
    <button type="button" class="jy-mini-chip" data-jy-action="log-filter" data-filter="floor" aria-pressed="true">本楼</button>
    <button type="button" class="jy-mini-chip" data-jy-action="log-filter" data-filter="all" aria-pressed="false">全部</button>
    <button type="button" class="jy-mini-chip" data-jy-action="log-filter" data-filter="translation" aria-pressed="false">翻译</button>
    <button type="button" class="jy-mini-chip" data-jy-action="log-filter" data-filter="tts" aria-pressed="false">朗读</button>
    <button type="button" class="jy-mini-chip jy-mini-chip-error" data-jy-action="log-filter" data-filter="errors" aria-pressed="false">只看出错</button>
    <button type="button" class="jy-text-button" data-jy-action="log-copy">复制全部</button>
  </div>
  <div class="jy-mini-scroll">
  <ol class="jy-mini-log" data-jy-mini-log></ol>
  <p class="jy-muted jy-mini-log-empty" data-jy-mini-log-empty hidden>这里还没有记录。</p>
  <div class="jy-mini-log-detail" data-jy-mini-log-detail hidden></div>
  </div>
</div>
<div class="jy-mini-body jy-mini-call" data-jy-mini-page="call" hidden>
  <div class="jy-mini-scroll" data-jy-call-scroll>
  <div class="jy-mini-status">
    <div class="jy-mini-status-top"><strong data-jy-call-peer>通话测试</strong><span data-jy-call-clock>—</span></div>
    <p class="jy-muted jy-mini-taskline"><span data-jy-call-state></span><span class="jy-mini-eta" data-jy-call-wait></span></p>
    <p class="jy-muted" data-jy-call-note hidden></p>
  </div>
  <ol class="jy-mini-sentences" data-jy-call-lines hidden></ol>
  </div>
  <div class="jy-mini-more" data-jy-mini-more hidden>
    <div class="jy-mini-more-head"><strong>往期通话</strong><button type="button" class="jy-mini-inspect-close" data-jy-action="mini-more-close" aria-label="收起" title="收起">×</button></div>
    <ol class="jy-mini-log" data-jy-call-history></ol>
    <p class="jy-muted jy-mini-log-empty" data-jy-call-history-empty hidden>和这个角色还没有通话记录。</p>
    <div class="jy-mini-log-detail" data-jy-call-detail hidden></div>
    <div class="jy-mini-links">
      <button type="button" class="jy-text-button" data-jy-action="call-clear" hidden>清空这个角色的通话记录</button>
      <button type="button" class="jy-text-button" data-jy-action="call-settings" title="语音输入、通话用哪条连接">通话设置</button>
    </div>
  </div>
  <div class="jy-mini-foot">
    <div class="jy-mini-inspect-custom" data-jy-call-typing hidden><input type="text" data-jy-call-input maxlength="500" placeholder="语音输入没开，打字说"><button type="button" class="jy-button jy-button-primary" data-jy-action="call-send">发送</button></div>
    <div class="jy-mini-actions">
      <button type="button" class="jy-button jy-button-primary" data-jy-action="call-dial">拨打</button>
      <button type="button" class="jy-button jy-button-primary jy-mini-call-talk" data-jy-call-talk aria-pressed="false" title="按住说话，说完松开；对方在说时按下会打断" hidden>按住说话</button>
      <button type="button" class="jy-button jy-button-primary" data-jy-action="call-resume" hidden>继续</button>
      <button type="button" class="jy-button jy-mini-danger" data-jy-action="call-interrupt" title="让对方停下，电话不挂" hidden>打断</button>
      <button type="button" class="jy-button jy-mini-danger" data-jy-action="call-hang" hidden>挂断</button>
      <button type="button" class="jy-button" data-jy-action="mini-more" aria-expanded="false" title="往期通话、清空记录、通话设置">更多</button>
    </div>
  </div>
</div>`;
  shadow.append(style, win);
  document.body.appendChild(host);

  const bar = win.querySelector('[data-jy-mini-drag]');
  const input = win.querySelector('[data-jy-mini-input]');
  const resultBox = win.querySelector('[data-jy-mini-result]');
  const output = win.querySelector('[data-jy-mini-output]');
  const scratch = win.querySelector('[data-jy-mini-scratch]');
  const scratchSummary = scratch.querySelector('summary');
  const channelSelect = win.querySelector('[data-jy-mini-channel]');
  const profileSelect = win.querySelector('[data-jy-mini-profile]');
  const rowsList = win.querySelector('[data-jy-mini-rows]');
  const tabs = win.querySelector('[data-jy-mini-tabs]');
  const pages = {
    translate: win.querySelector('[data-jy-mini-page="translate"]'),
    reading: win.querySelector('[data-jy-mini-page="reading"]'),
    log: win.querySelector('[data-jy-mini-page="log"]'),
    call: win.querySelector('[data-jy-mini-page="call"]'),
  };
  const inspectBox = win.querySelector('[data-jy-tts-inspect]');
  const sentenceList = win.querySelector('[data-jy-tts-list]');
  const fishInput = win.querySelector('[data-jy-tts-fish]');
  const speedInput = win.querySelector('[data-jy-tts-speed]');
  const volumeInput = win.querySelector('[data-jy-tts-volume]');
  const speakerSelect = win.querySelector('[data-jy-tts-speaker]');
  const tagBox = win.querySelector('[data-jy-tts-tags]');
  const seekBar = win.querySelector('[data-jy-tts-seek]');
  const logList = win.querySelector('[data-jy-mini-log]');
  const logDetail = win.querySelector('[data-jy-mini-log-detail]');

  let miniTab = 'translate';
  // The floor the translate page shows; the arrows move it, a new run pulls it along.
  let viewFloor = null;
  let viewRows = [];
  let viewState = floorState([]);
  let viewRunning = false;
  let editingRow = null;
  let rowsToken = 0;
  let rowsTimer = null;
  let etaTicker = null;
  let thinkingOpen = false;
  let logFilter = 'floor';
  let logEntries = [];
  let logShown = [];
  // The badge counts errors the reader has not opened the log for; opening it clears them.
  let logSeenErrors = 0;
  let inspecting = null;
  let inspectToken = 0;
  let inspectDirty = false;
  let sentencesToken = 0;
  let sentencesSignature = '';
  let sentencesBusy = false;
  let sentencesAgain = false;
  let sentencesTimer = null;

  // -------------------------------------------------------------------------------------------
  // Pages and the window's shape.
  // -------------------------------------------------------------------------------------------
  let resizeSettle = null;
  const settleResize = () => {
    if (resizeSettle !== null) {
      globalThis.clearTimeout(resizeSettle);
      runtime.timers.delete(resizeSettle);
      resizeSettle = null;
    }
    win.removeEventListener('transitionend', onResizeEnd);
    win.classList.remove('is-resizing');
    win.style.height = '';
    if (win.isConnected) reanchor();
  };
  const onResizeEnd = event => {
    if (event.target === win && event.propertyName === 'height') settleResize();
  };
  const PAGE_ORDER = ['translate', 'reading', 'log', 'call'];
  const selectMiniTab = (name, { animate = true } = {}) => {
    if (!pages[name]) return;
    const from = pages[miniTab];
    const to = pages[name];
    const switching = miniTab !== name && from && to;
    const before = switching && win.dataset.size !== 'max' ? win.offsetHeight : 0;
    const direction = PAGE_ORDER.indexOf(name) > PAGE_ORDER.indexOf(miniTab) ? 'forward' : 'back';
    miniTab = name;
    for (const button of tabs.querySelectorAll('[data-jy-mini-tab]')) button.setAttribute('aria-selected', String(button.dataset.jyMiniTab === name));
    for (const [key, page] of Object.entries(pages)) page.hidden = key !== name;
    win.dataset.miniTab = name;
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    if (switching && animate && !reduced && before) {
      settleResize();
      const after = win.offsetHeight;
      if (after !== before) {
        win.style.height = `${before}px`;
        // Committing the old height first is what gives the transition a starting point.
        void win.offsetHeight;
        win.classList.add('is-resizing');
        win.style.height = `${after}px`;
        win.addEventListener('transitionend', onResizeEnd);
        resizeSettle = globalThis.setTimeout(settleResize, 420);
        runtime.timers.add(resizeSettle);
      }
      to.dataset.direction = direction;
      to.classList.remove('is-entering');
      void to.offsetWidth;
      to.classList.add('is-entering');
    }
    if (name === 'log') {
      logSeenErrors = countLogErrors(logEntries);
      updateLogBadge();
      renderLog();
    }
    if (name === 'reading') void renderSentences();
    if (name === 'call') {
      renderCall();
      renderCallHistory();
    }
    globalThis.requestAnimationFrame?.(() => { if (win.isConnected) reanchor(); });
  };
  const syncMiniTabs = () => {
    const enabled = ttsSettings().enabled;
    const readingTab = tabs.querySelector('[data-jy-mini-tab="reading"]');
    if (readingTab) readingTab.hidden = !enabled;
    if (!enabled && miniTab === 'reading') selectMiniTab('translate');
    win.dataset.hand = runtime.settings.leftHanded ? 'left' : 'right';
    host.dataset.theme = runtime.settings.theme || 'day';
  };
  const onTabClick = event => {
    const tab = event.target.closest('[data-jy-mini-tab]');
    if (tab) selectMiniTab(tab.dataset.jyMiniTab);
  };
  const setSize = (size, { remember = true } = {}) => {
    win.dataset.size = size;
    if (remember) saveMiniSize(size);
    const touchNow = win.dataset.touch === 'true';
    const next = nextMiniSize(size, touchNow);
    const label = next === 'card' ? (size === 'max' ? '缩回卡片' : '展开') : next === 'max' ? '放大到满屏' : '收成小窗';
    for (const button of win.querySelectorAll('[data-jy-action="mini-max"]')) {
      if (button.closest('.jy-mini-bar')) button.textContent = next === 'compact' ? '⤡' : '⤢';
      else button.textContent = label;
      button.setAttribute('aria-label', label);
      button.title = label;
    }
    if (size === 'max') {
      win.style.left = '';
      win.style.top = '';
    } else if (userMoved) {
      place(position.x, position.y);
    } else {
      // Measured as a card, not at the size it had a moment ago.
      const next = anchorMiniPosition(win);
      place(next.x, next.y);
    }
  };
  // The device can change under the window: a desktop browser narrowed to a phone's width, or the
  // pane widened again. The form follows, and the full-size form is only kept on a phone.
  const syncTouch = () => {
    const compact = isCompactViewport();
    win.dataset.touch = compact ? 'true' : 'false';
    if (!compact && win.dataset.size === 'max') setSize('card', { remember: false });
    else setSize(win.dataset.size, { remember: false });
  };

  const syncQuickPickers = () => {
    const current = runtime.settings;
    // The translation's choice, the same one as the desk's: the host's connection or any saved one.
    fillChannelPicker(channelSelect, current, translationChannelChoice(current));
    channelSelect.disabled = false;
    profileSelect.replaceChildren();
    for (const profile of current.promptProfiles) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = `${profile.name} · ${normalizeTargetLanguage(profile.targetLanguage)}`;
      profileSelect.appendChild(option);
    }
    profileSelect.value = current.selectedPromptProfileId;
    setText(win, '[data-jy-mini-target]', normalizeTargetLanguage(getActivePromptProfile(current).targetLanguage));
    const auto = win.querySelector('[data-jy-action="mini-auto"]');
    if (auto) {
      auto.textContent = current.autoGeneration ? '自动 开' : '自动 关';
      auto.setAttribute('aria-pressed', String(Boolean(current.autoGeneration)));
    }
    syncMiniTabs();
  };
  syncQuickPickers();

  // -------------------------------------------------------------------------------------------
  // The translate page: the floor, paragraph by paragraph.
  // -------------------------------------------------------------------------------------------
  const floorLockKey = snapshot => `${snapshot.chatId}|${snapshot.messageId}|${snapshot.swipeId}`;
  const renderRowTags = row => {
    const tags = document.createElement('div');
    tags.className = 'jy-mini-row-tags';
    if (row.speaker) {
      const speaker = document.createElement('span');
      speaker.className = 'jy-mini-pill';
      speaker.textContent = row.speaker;
      tags.appendChild(speaker);
    }
    if (row.emotion) {
      const emotion = document.createElement('span');
      emotion.className = 'jy-mini-pill';
      emotion.textContent = cueLabel(row.emotion);
      tags.appendChild(emotion);
    }
    return tags.childElementCount ? tags : null;
  };
  const rowButton = (label, action, id, { primary = false, danger = false } = {}) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `jy-button jy-mini-row-button${primary ? ' jy-button-primary' : ''}${danger ? ' jy-mini-row-button-danger' : ''}`;
    button.dataset.jyAction = action;
    button.dataset.id = String(id);
    button.textContent = label;
    return button;
  };
  const renderRows = () => {
    rowsList.replaceChildren();
    const reading = ttsSettings().enabled;
    for (const row of viewRows.slice(0, MINI_ROW_LIMIT)) {
      const item = document.createElement('li');
      item.className = 'jy-mini-row';
      item.dataset.id = String(row.id);
      item.dataset.state = row.state;
      const mark = document.createElement('span');
      mark.className = 'jy-mini-row-mark';
      mark.textContent = row.state === 'done' ? '✓' : row.state === 'running' ? '◌' : row.state === 'missing' ? '!' : '·';
      const body = document.createElement('div');
      body.className = 'jy-mini-row-body';
      const source = document.createElement('div');
      source.className = 'jy-mini-row-src';
      source.textContent = row.source;
      body.appendChild(source);
      if (editingRow === row.id) {
        item.dataset.editing = 'true';
        const tags = renderRowTags(row);
        if (tags) body.appendChild(tags);
        const field = document.createElement('textarea');
        field.className = 'jy-mini-row-field';
        field.rows = 3;
        field.spellcheck = false;
        field.dataset.jyRowField = String(row.id);
        field.value = row.translation;
        field.placeholder = row.state === 'done' ? '' : '这一段还没有译文，可以直接写一段。';
        body.appendChild(field);
        const actions = document.createElement('div');
        actions.className = 'jy-mini-row-actions';
        actions.append(rowButton('写回', 'row-write', row.id, { primary: true }), rowButton('重翻这段', 'row-retry', row.id));
        if (reading && row.state === 'done') actions.append(rowButton('试听', 'row-listen', row.id));
        actions.append(rowButton('关闭', 'row-close', row.id));
        body.appendChild(actions);
      } else {
        const target = document.createElement('div');
        target.className = 'jy-mini-row-dst';
        if (row.state === 'done') target.textContent = row.translation;
        else if (row.state === 'running') target.textContent = '翻译中…';
        else if (row.state === 'missing') target.textContent = '缺失';
        else target.textContent = '未译';
        body.appendChild(target);
        const tags = renderRowTags(row);
        if (tags) body.appendChild(tags);
      }
      item.append(mark, body);
      if (editingRow !== row.id && row.state === 'missing' && !viewRunning) {
        const side = document.createElement('div');
        side.className = 'jy-mini-row-side';
        side.appendChild(rowButton('补这段', 'row-fix', row.id, { danger: true }));
        item.appendChild(side);
      }
      rowsList.appendChild(item);
    }
    rowsList.hidden = !viewRows.length;
  };
  const renderFloorActions = () => {
    const running = viewRunning;
    const show = (action, visible) => {
      for (const button of win.querySelectorAll(`[data-jy-action="${action}"]`)) button.hidden = !visible;
    };
    show('mini-stop', running);
    show('mini-translate', !running && viewState.key === 'pending');
    renderBriefActions();
    show('mini-retranslate', !running && ['done', 'missing'].includes(viewState.key));
    show('mini-repair', !running && viewState.key === 'missing');
    const untranslated = untranslatedFloors(getContext().chat, { limit: 50 }).filter(id => id !== viewFloor);
    const all = win.querySelector('[data-jy-mini-untranslated]');
    if (all) {
      all.hidden = !untranslated.length || running;
      all.textContent = `还有 ${untranslated.length} 楼没翻 · 全翻`;
    }
  };
  const setFloorTitle = () => {
    const title = Number.isInteger(viewFloor) ? `第 ${viewFloor} 楼` : '等待正文';
    setText(win, '[data-jy-mini-floor-title]', title);
    setText(win, '[data-jy-mini-floor-state]', Number.isInteger(viewFloor) ? `${viewState.label}${viewState.total ? ` · ${viewState.done}/${viewState.total} 段` : ''}` : '—');
    setText(win, '[data-jy-mini-title]', Number.isInteger(viewFloor) ? `${title} · ${viewState.label}` : '镜译');
    setText(win, '[data-jy-mini-brief-title]', Number.isInteger(viewFloor) ? title : '镜译');
    setText(win, '[data-jy-mini-brief-state]', Number.isInteger(viewFloor) ? viewState.label : '');
    renderBriefActions();
    const ids = assistantFloorIds();
    const at = ids.indexOf(viewFloor);
    const prev = win.querySelector('[data-jy-action="mini-floor-prev"]');
    const next = win.querySelector('[data-jy-action="mini-floor-next"]');
    if (prev) prev.disabled = at <= 0;
    if (next) next.disabled = at < 0 || at >= ids.length - 1;
  };
  // The first layer carries the one button the moment calls for: translate this floor, stop the
  // translation, or play / pause and stop the reading — so stopping never needs the window opened.
  const renderBriefActions = () => {
    const brief = win.querySelector('[data-jy-mini-brief]');
    if (!brief) return;
    const reading = ttsTransportDescription(runtime.tts.transport);
    const streaming = Boolean(runtime.tts.stream && !runtime.tts.stream.done);
    const live = streaming || Boolean(reading && ['loading', 'playing', 'paused'].includes(reading.state));
    const toggle = brief.querySelector('[data-jy-action="tts-toggle"]');
    if (toggle) toggle.hidden = !live;
    const stop = brief.querySelector('[data-jy-brief-stop]');
    if (stop) stop.hidden = !live;
    const read = brief.querySelector('[data-jy-action="mini-brief-read"]');
    if (read) read.hidden = live || !(ttsSettings().enabled && Number.isInteger(viewFloor));
    const reel = win.querySelector('.jy-mini-transport [data-jy-action="tts-stop"]');
    if (reel) reel.disabled = !live;
  };
  // The reading page, redrawn when the floor on screen changes. Bound once that page's pieces exist.
  let refreshReading = () => {};
  const renderFloor = async () => {
    const token = ++rowsToken;
    const context = getContext();
    if (!Number.isInteger(viewFloor)) viewFloor = Number.isInteger(runtime.activeFloor) && runtime.task.status === 'running' ? runtime.activeFloor : latestAssistantMessageId(context);
    let snapshot = null;
    if (Number.isInteger(viewFloor)) {
      try {
        snapshot = await readMessageSnapshot(viewFloor, runtime.settings, { quiet: true });
      } catch {
        snapshot = null;
      }
    }
    if (token !== rowsToken || !win.isConnected) return;
    viewRunning = Boolean(snapshot && runtime.inflight.has(floorLockKey(snapshot)));
    viewRows = snapshot ? floorRows(snapshot, { running: viewRunning }) : [];
    viewState = floorState(viewRows, { running: viewRunning });
    if (!viewRows.some(row => row.id === editingRow)) editingRow = null;
    renderRows();
    renderFloorActions();
    setFloorTitle();
    // A reading that has stopped does not hold the reading page on its floor once this one is shown.
    refreshReading();
    if (win.isConnected) globalThis.requestAnimationFrame?.(() => { if (win.isConnected) reanchor(); });
  };
  const scheduleRows = (delay = 400) => {
    if (rowsTimer !== null) return;
    rowsTimer = globalThis.setTimeout(() => {
      runtime.timers.delete(rowsTimer);
      rowsTimer = null;
      void renderFloor();
    }, delay);
    runtime.timers.add(rowsTimer);
  };
  // A floor the reader walked to stays on screen when a new reply comes; the newest one does not.
  let chosenIn = null;
  const moveFloor = delta => {
    const ids = assistantFloorIds();
    if (!ids.length) return;
    const at = ids.indexOf(viewFloor);
    const next = ids[Math.min(ids.length - 1, Math.max(0, (at < 0 ? ids.length - 1 : at) + delta))];
    if (next === viewFloor) return;
    chosenIn = next !== ids.at(-1) ? getCurrentChatId() : null;
    viewFloor = next;
    editingRow = null;
    void renderFloor();
  };

  // The run in progress: batches as a bar of blocks, the seconds still to go, the model's thinking.
  const renderTaskLine = task => {
    const running = task.status === 'running' && (!Number.isInteger(viewFloor) || runtime.activeFloor === viewFloor);
    setText(win, '[data-jy-task-message]', running || !Number.isInteger(viewFloor) ? task.message : '');
    const briefTask = win.querySelector('[data-jy-mini-brief-task]');
    if (briefTask) {
      briefTask.textContent = running ? task.message : '';
      briefTask.hidden = !running;
    }
    const dot = win.querySelector('[data-jy-task-dot]');
    if (dot) dot.dataset.jyTaskDot = task.status;
    const batchBox = win.querySelector('[data-jy-mini-batches]');
    const batches = running ? task.batches : null;
    if (batchBox) {
      batchBox.replaceChildren();
      if (batches && batches.total > 1) {
        for (let index = 0; index < batches.total; index += 1) {
          const block = document.createElement('i');
          block.dataset.state = index < batches.done ? 'done' : index < batches.done + batches.active ? 'active' : 'pending';
          batchBox.appendChild(block);
        }
      }
      batchBox.hidden = !(batches && batches.total > 1);
    }
    let eta = '';
    if (running && batches && batches.total) {
      const elapsedActive = batches.activeSince?.length ? (Date.now() - Math.min(...batches.activeSince)) / 1000 : 0;
      eta = describeRemaining(estimateRemaining({
        done: batches.done, total: batches.total, active: batches.active, lanes: batches.lanes,
        durations: batches.durations, elapsedActive, history: runtime.timing.translation,
      }));
    }
    setText(win, '[data-jy-mini-eta]', eta);
    if (running && etaTicker === null) {
      etaTicker = globalThis.setInterval(() => {
        if (!win.isConnected) {
          globalThis.clearInterval(etaTicker);
          etaTicker = null;
          return;
        }
        renderTaskLine(runtime.task);
      }, 1000);
    } else if (!running && etaTicker !== null) {
      globalThis.clearInterval(etaTicker);
      etaTicker = null;
    }
    renderThinkingLine();
  };
  const renderThinkingLine = () => {
    const thinking = runtime.thinking;
    const text = String(thinking.text ?? '').trim();
    const line = win.querySelector('[data-jy-mini-thinking]');
    const full = win.querySelector('[data-jy-mini-thinking-full]');
    if (!line || !full) return;
    const relevant = text && (thinking.live || runtime.task.status === 'running');
    line.hidden = !relevant;
    if (!relevant) {
      full.hidden = true;
      return;
    }
    const last = text.split('\n').map(item => item.trim()).filter(Boolean).at(-1) ?? '';
    setText(win, '[data-jy-mini-thinking-text]', `${thinking.live ? '副模型：' : '上一批思考：'}${miniShort(last, 90)}`);
    setText(win, '[data-jy-mini-thinking-more]', thinkingOpen ? '收起' : '展开');
    line.setAttribute('aria-expanded', String(thinkingOpen));
    full.hidden = !thinkingOpen;
    if (thinkingOpen) {
      const tail = text.length > THINKING_TAIL ? `…${text.slice(-THINKING_TAIL)}` : text;
      if (full.textContent !== tail) {
        full.textContent = tail;
        full.scrollTop = full.scrollHeight;
      }
    }
  };

  // A translation in flight or done rewrites the floor; the rows follow with a short delay.
  let lastTaskStatus = runtime.task.status;
  const unsubscribeTask = subscribeTask(task => {
    renderTaskLine(task);
    if (task.status === 'running' && Number.isInteger(runtime.activeFloor) && runtime.activeFloor !== viewFloor && lastTaskStatus !== 'running') {
      // A new run pulls the page onto its floor, the way the reader expects when they pressed translate.
      viewFloor = runtime.activeFloor;
      editingRow = null;
    }
    if (task.status !== lastTaskStatus || task.status === 'running') scheduleRows(task.status === 'running' ? 1200 : 200);
    lastTaskStatus = task.status;
  });

  // -------------------------------------------------------------------------------------------
  // The reading page: the player, the sentences, one sentence laid open.
  // -------------------------------------------------------------------------------------------
  // Cues a finger can drop into the text: the moods Fish lists, then pauses, emphasis and sounds.
  const emotionPicker = document.createElement('select');
  emotionPicker.setAttribute('aria-label', '插入情绪标签');
  const emotionBlank = document.createElement('option');
  emotionBlank.value = '';
  emotionBlank.textContent = '插入情绪…';
  emotionPicker.appendChild(emotionBlank);
  for (const word of FISH_EMOTIONS) {
    const option = document.createElement('option');
    option.value = word;
    option.value = cueLabel(word);
    option.textContent = `${cueLabel(word)} (${word})`;
    emotionPicker.appendChild(option);
  }
  tagBox.appendChild(emotionPicker);
  // The chips insert Fish's own words, the ones its app writes; the S1 models get their brackets and pause names.
  for (const [label, tag] of [['停顿', 'pause'], ['长停顿', 'long pause'], ['重读', 'emphasis'], ['耳语', 'whispering'], ['轻声', 'soft tone'], ['喊', 'shouting'], ['急促', 'in a hurry tone'], ...FISH_SOUNDS.map(sound => [cueLabel(sound), sound])]) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'jy-mini-chip';
    chip.dataset.jyTtsTag = tag;
    chip.textContent = label;
    chip.title = `[${tag}]`;
    tagBox.appendChild(chip);
  }
  const markDirty = () => {
    inspectDirty = true;
    const apply = win.querySelector('[data-jy-action="tts-apply"]');
    if (apply) apply.hidden = false;
  };
  const insertCue = tag => {
    const start = fishInput.selectionStart ?? fishInput.value.length;
    const end = fishInput.selectionEnd ?? start;
    const before = fishInput.value.slice(0, start);
    const after = fishInput.value.slice(end);
    const model = ttsSettings().fish.model;
    const own = model === 's1' ? ({ pause: 'break', 'long pause': 'long-break' }[tag] ?? tag) : tag;
    const wrapped = model === 's1' ? `(${own})` : `[${own}]`;
    const piece = `${before && !/\s$/.test(before) ? ' ' : ''}${wrapped}${after && !/^\s/.test(after) ? ' ' : ''}`;
    fishInput.value = `${before}${piece}${after}`;
    const caret = before.length + piece.length;
    fishInput.focus();
    fishInput.setSelectionRange(caret, caret);
    markDirty();
  };
  // Keeping focus in the textarea across a chip tap is what makes the caret position survive.
  const onTagPointerDown = event => {
    if (event.target.closest('[data-jy-tts-tag]')) event.preventDefault();
  };
  const onTagClick = event => {
    const chip = event.target.closest('[data-jy-tts-tag]');
    if (chip) insertCue(chip.dataset.jyTtsTag);
  };
  const onEmotionPick = () => {
    if (emotionPicker.value) insertCue(emotionPicker.value);
    emotionPicker.value = '';
  };
  const onFishInput = () => markDirty();
  // A phone keyboard takes half the screen: the window shrinks to what is left and the field being
  // typed into scrolls into view, so the text and the buttons under it stay reachable.
  const onViewport = () => {
    const viewport = globalThis.visualViewport;
    if (!viewport || win.dataset.touch !== 'true') return;
    const shrunk = viewport.height < globalThis.innerHeight - 120;
    win.dataset.keyboard = shrunk ? 'true' : 'false';
    win.style.setProperty('--jy-mini-vh', `${Math.round(viewport.height)}px`);
  };
  const onFieldFocus = event => {
    if (win.dataset.touch !== 'true' || !event.target.matches('textarea, input[type="text"], input[type="number"]')) return;
    const field = event.target;
    globalThis.setTimeout(() => { if (field.isConnected) field.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 260);
  };
  const onCustomKey = event => {
    if (event.key === 'Enter' && event.target.matches('[data-jy-tts-custom]')) {
      event.preventDefault();
      win.querySelector('[data-jy-action="tts-insert-custom"]')?.click();
    }
  };
  const showInspector = show => {
    inspectBox.hidden = !show;
    sentenceList.hidden = show || !sentenceList.childElementCount;
    const note = win.querySelector('[data-jy-tts-list-note]');
    if (note && show) note.hidden = true;
  };
  const renderInspector = async (messageId, utteranceId, { pinned = true, side = null } = {}) => {
    const token = ++inspectToken;
    const which = side ?? primaryTtsSide();
    inspecting = { messageId, utteranceId, pinned, side: which };
    inspectDirty = false;
    showInspector(true);
    setText(win, '[data-jy-tts-who]', '读取中…');
    let data;
    try {
      data = await ttsInspect(messageId, utteranceId, which);
    } catch (error) {
      if (token === inspectToken) setText(win, '[data-jy-tts-who]', safeError(error));
      return;
    }
    if (token !== inspectToken || !win.isConnected) return;
    const { segment } = data;
    const voiceName = data.voiceId ? (normalizeVoiceLibrary(runtime.settings.voiceLibrary).find(entry => entry.voiceId === data.voiceId)?.name ?? `${data.voiceId.slice(0, 6)}…`) : '';
    setText(win, '[data-jy-tts-who]', `${segment.type === 'narration' ? '旁白' : (segment.speaker || '未知说话人')}${segment.lang && segment.lang !== 'zh' ? ` · ${languageLabel(segment.lang)}` : ''}`);
    setText(win, '[data-jy-tts-depth]', `第 ${messageId} 楼${which === 'source' ? '（原文）' : ''} · 第 ${utteranceId} 句 · ${data.depth === 'deep' ? '深度' : data.depth === 'simple' ? '简单分析' : data.depth === 'pending' ? '还没分析' : data.depth === 'off' ? '不分析' : ttsSettings().mode === 'deep' ? '翻译骨架（还没细读）' : '翻译骨架'}${data.derived ? '（由译文推出）' : ''}${voiceName ? ` · 音色 ${voiceName}` : ' · Fish 默认音色'}${data.recorded ? ' · 已有音频' : ''}`);
    // Who says it, and how that was decided; the reader can name someone else from the list.
    if (speakerSelect) {
      const dialogue = segment.type === 'dialogue';
      speakerSelect.hidden = !dialogue;
      if (dialogue) {
        const names = [...new Set([...(data.cast ?? []), ...(segment.speaker ? [segment.speaker] : [])])];
        const options = [['', data.manualSpeaker ? '交回自动判断' : '自动判断'], ...names.map(name => [name, name])];
        speakerSelect.replaceChildren(...options.map(([value, label]) => Object.assign(document.createElement('option'), { value, textContent: label })));
        speakerSelect.value = data.manualSpeaker ?? '';
      }
    }
    const depthBox = win.querySelector('[data-jy-tts-depth]');
    if (depthBox && segment.type === 'dialogue') {
      const sourceLabel = SPEAKER_SOURCE_LABELS[data.speakerSource] ?? '副模型';
      // The evidence is what showed the name; a source that is its own evidence is not said twice.
      const why = (data.speakerEvidence ?? []).filter(item => item !== sourceLabel);
      depthBox.textContent += segment.speaker
        ? ` · 说话人：${sourceLabel}${why.length ? `（${why.join('；')}）` : ''}`
        : ' · 说话人：没认出来，用对白默认音色';
    }
    setText(win, '[data-jy-tts-text]', segment.text);
    const sourceLine = win.querySelector('[data-jy-tts-source]');
    if (sourceLine) {
      const showOriginal = ttsSettings().side === 'both' && data.original && data.original !== segment.text;
      sourceLine.hidden = !showOriginal;
      sourceLine.textContent = showOriginal ? `原文：${data.original}` : '';
    }
    const summary = win.querySelector('[data-jy-tts-summary]');
    summary.replaceChildren();
    const lines = [...data.summary];
    if (data.scene) lines.unshift(['场景', data.scene]);
    if (data.character?.state) lines.push(['人物状态', data.character.state]);
    if (data.character?.habit) lines.push(['说话习惯', data.character.habit]);
    for (const [term, value] of lines) {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      summary.append(dt, dd);
    }
    summary.hidden = !lines.length;
    fishInput.value = data.override?.text ?? data.text;
    speedInput.value = data.override?.speed ?? data.prosody.speed;
    volumeInput.value = data.override?.volume ?? data.prosody.volume;
    const reset = win.querySelector('[data-jy-action="tts-reset"]');
    if (reset) reset.hidden = !data.override;
    const apply = win.querySelector('[data-jy-action="tts-apply"]');
    if (apply) apply.hidden = true;
    setText(win, '[data-jy-tts-note]', data.edited
      ? `这句现在用的是你改过的版本${data.manualSpeaker ? `，说话人也是你定的（${data.manualSpeaker}）` : ''}；「恢复自动」回到程序的判断和副模型的分析。`
      : data.manualSpeaker
        ? `说话人是你定的（${data.manualSpeaker}）；上面的下拉框改回「交回自动判断」就恢复。`
        : data.inRange
          ? '改上面的内容、语速或音量，「重新生成并播放」只重做这一句，整楼朗读时也用这个版本。上面的下拉框可以直接改说话人，改了就按那个人的音色重做，不重新分析。'
          : '这句不在当前的朗读范围里，改了也不会读。');
    globalThis.requestAnimationFrame?.(() => { if (win.isConnected) reanchor(); });
  };
  const closeInspector = () => {
    inspectToken += 1;
    inspecting = null;
    inspectDirty = false;
    showInspector(false);
    void renderSentences({ force: true });
  };

  /**
   * The floor the reading page is about: the floor being heard while something is sounding, and the
   * floor on screen once nothing is. A reading left paused or finished on an older floor used to hold
   * the whole page — the list, the player, ▶, 重新分析 — on that floor after the chat had moved two
   * floors on and the window said so in its title. The paused reading is not thrown away: going back
   * to its floor shows it again, and ▶ carries on from where it stopped.
   */
  const readingTarget = () => {
    const transport = runtime.tts.transport;
    if (transport && (['playing', 'loading'].includes(transport.state) || !Number.isInteger(viewFloor) || transport.messageId === viewFloor)) {
      return { messageId: transport.messageId, side: transport.side, transport };
    }
    return { messageId: viewFloor, side: primaryTtsSide(), transport: null };
  };

  // The floor's sentences, each with what the reader can do to it: tap to read from there, 改这句 to open it.
  /** The paragraph a save is about: the sentence named, else the one open, else the one being read. */
  const ttsSaveTarget = async utteranceId => {
    const { transport, messageId: shown } = readingTarget();
    const messageId = inspecting?.messageId ?? shown;
    if (!Number.isInteger(messageId)) return null;
    const side = inspecting?.side ?? (transport?.messageId === messageId ? transport.side : primaryTtsSide());
    const prepared = await ttsPrepared(messageId, side);
    const chosen = utteranceId ?? inspecting?.utteranceId
      ?? (transport?.messageId === messageId ? transport.items[transport.index]?.segment.id : null);
    const lines = groupSegmentsByLine(prepared.items.map(item => item.segment));
    const at = chosen === null || chosen === undefined ? -1 : lines.findIndex(line => line.segments.some(segment => segment.id === Number(chosen)));
    const line = at >= 0 ? lines[at] : null;
    return {
      messageId, side,
      lineId: line?.lineId ?? null,
      lineIndex: at >= 0 ? at : null,
      lineText: line ? line.segments.map(segment => segment.text).join('') : '',
    };
  };

  const askAndSave = async (button, utteranceId = null) => {
    const target = await ttsSaveTarget(utteranceId);
    if (!target) {
      toast('error', '当前聊天里还没有可保存的楼层。');
      return;
    }
    const choice = await askTtsSave(target);
    if (choice === 'cancel') return;
    if (button) button.disabled = true;
    try {
      const built = await downloadTtsAudio({
        scope: choice === 'current' ? 'current' : 'floor',
        messageId: target.messageId,
        side: target.side,
        lineId: choice === 'current' ? target.lineId : null,
      });
      await ttsOfferFile(built.blob, built.name, { note: built.spliced ? '改过和单独重做的句子已按顺序拼在原位置，所以是 wav' : '' });
    } catch (error) {
      if (!isAbortError(error)) toast('error', safeError(error));
    } finally {
      if (button) button.disabled = false;
    }
  };

  const renderSentencesNow = async ({ force = false } = {}) => {
    const enabled = ttsSettings().enabled;
    const { transport, messageId, side } = readingTarget();
    const note = win.querySelector('[data-jy-tts-list-note]');
    if (!enabled || !Number.isInteger(messageId)) {
      sentenceList.hidden = true;
      if (note) note.hidden = true;
      return;
    }
    const progress = ttsProgressFor(messageId, side);
    const signature = `${messageId}|${side}|${progress?.steps.filter(step => step.state === 'done').length ?? 0}|${transport?.state ?? ''}|${runtime.tts.recordings.get(`${messageId}`)?.length ?? ''}`;
    if (!force && signature === sentencesSignature) {
      markCurrentSentence();
      return;
    }
    // Claimed before the awaits: the steps a preparation fires must not start a second preparation.
    sentencesSignature = signature;
    const token = ++sentencesToken;
    let prepared;
    let records = [];
    try {
      prepared = await ttsPrepared(messageId, side);
      records = await ttsRecordings(prepared.floor);
    } catch (error) {
      sentencesSignature = '';
      if (token !== sentencesToken || !win.isConnected) return;
      sentenceList.hidden = true;
      if (note) {
        note.hidden = false;
        note.textContent = safeError(error);
      }
      return;
    }
    if (token !== sentencesToken || !win.isConnected) return;
    const { key: fingerprint } = await ttsFingerprint(prepared.settings);
    sentenceList.replaceChildren();
    const skipped = new Set((prepared.skipped ?? []).map(item => item.segment.id));
    const listed = [...prepared.items, ...(prepared.skipped ?? [])].sort((left, right) => left.segment.id - right.segment.id);
    for (const item of listed) {
      const { segment } = item;
      const muted = skipped.has(segment.id);
      const ready = !muted && Boolean(findCoveringEntry(records, { text: segment.text, voiceId: item.voiceId, fingerprint, identity: itemIdentity(item) }));
      const row = document.createElement('li');
      row.className = 'jy-mini-sentence';
      row.dataset.id = String(segment.id);
      row.dataset.side = side;
      row.dataset.messageId = String(messageId);
      row.dataset.lineId = String(segment.lineId);
      row.dataset.ready = ready ? 'true' : 'false';
      if (muted) row.dataset.muted = 'true';
      const mark = document.createElement('span');
      mark.className = 'jy-mini-sentence-mark';
      mark.textContent = muted ? '⊘' : ready ? '✓' : '·';
      const body = document.createElement('div');
      body.className = 'jy-mini-sentence-body';
      const text = document.createElement('div');
      text.className = 'jy-mini-sentence-text';
      text.textContent = segment.text;
      body.appendChild(text);
      // Reading the original, the list is in the original's language. The translation of that line
      // sits under it, because a reader who cannot read the original cannot choose anything in it.
      const mirror = side === 'source' ? prepared.floor.references?.get(segment.lineId) : '';
      if (mirror) {
        const echo = document.createElement('div');
        echo.className = 'jy-mini-sentence-echo';
        echo.textContent = miniShort(mirror, 60);
        echo.title = mirror;
        body.appendChild(echo);
      }
      const tags = document.createElement('div');
      tags.className = 'jy-mini-row-tags';
      const who = document.createElement('span');
      who.className = 'jy-mini-pill';
      who.textContent = segment.type === 'narration' ? '旁白' : (segment.speaker || '对白');
      tags.appendChild(who);
      if (segment.emotion) {
        const mood = document.createElement('span');
        mood.className = 'jy-mini-pill';
        mood.textContent = cueLabel(segment.emotion);
        tags.appendChild(mood);
      }
      if (item.override?.text) {
        const edited = document.createElement('span');
        edited.className = 'jy-mini-pill jy-mini-pill-edited';
        edited.textContent = '改过';
        tags.appendChild(edited);
      }
      if (muted) {
        const hush = document.createElement('span');
        hush.className = 'jy-mini-pill';
        hush.textContent = item.reason === 'fallback' ? '没有专属音色 · 跳过' : '已屏蔽';
        hush.title = item.reason === 'fallback' ? '「没有专属音色的角色」设成了跳过，这一句不读。' : '这个角色的对白在音色表里设成了不朗读。';
        tags.appendChild(hush);
      }
      body.appendChild(tags);
      const tools = document.createElement('div');
      tools.className = 'jy-mini-sentence-tools';
      const actions = muted
        ? [['sentence-edit', '详细', '看这一句为什么不读']]
        : [['sentence-play', '播放', '从这句读'], ['sentence-regen', '重新生成', '丢掉这句的音频，再向 Fish 要一次'], ['tts-save-pick', '缓存', '缓存这一段或者整篇到本地'], ['sentence-edit', '详细', '看这句发给 Fish 的内容，改了再生成']];
      for (const [action, label, title] of actions) {
        const tool = document.createElement('button');
        tool.type = 'button';
        tool.className = 'jy-text-button jy-mini-sentence-edit';
        tool.dataset.jyAction = action;
        tool.dataset.id = String(segment.id);
        tool.textContent = label;
        tool.title = title;
        tools.appendChild(tool);
      }
      row.append(mark, body, tools);
      sentenceList.appendChild(row);
    }
    sentenceList.hidden = inspectBox.hidden === false || !listed.length;
    if (note) {
      const unread = prepared.passive && prepared.depth !== 'deep' && ttsSettings().mode === 'deep';
      note.hidden = listed.length > 0 && !unread && prepared.depth !== 'pending';
      note.textContent = !listed.length ? '这一楼在当前范围里没有可读的句子。'
        : !prepared.items.length ? '这一楼的对白全部被屏蔽了，没有会朗读的句子。'
        : prepared.depth === 'pending' ? '这一楼还没分析。按播放或「朗读」时才请求副模型，不会自己开始。'
          : unread ? '这一楼还没深度分析，列表里是翻译时的骨架。按播放或「朗读」时才请求副模型，不会自己开始。' : '';
    }
    markCurrentSentence();
    globalThis.requestAnimationFrame?.(() => { if (win.isConnected) reanchor(); });
  };
  const markCurrentSentence = () => {
    const transport = runtime.tts.transport;
    const playing = transport?.items[transport.index]?.segment.id;
    for (const row of sentenceList.querySelectorAll('.jy-mini-sentence')) {
      const on = transport && String(transport.messageId) === row.dataset.messageId && transport.side === row.dataset.side && String(playing) === row.dataset.id && ['playing', 'paused', 'loading'].includes(transport.state);
      const current = on ? 'true' : 'false';
      if (row.dataset.current !== current) row.dataset.current = current;
      const mark = row.querySelector('.jy-mini-sentence-mark');
      const glyph = on ? '♪' : row.dataset.ready === 'true' ? '✓' : '·';
      if (mark && mark.textContent !== glyph) mark.textContent = glyph;
    }
  };
  // One preparation at a time: a run that fires steps while the list is being built asks for one more
  // pass afterwards instead of a pass per step, and a burst of transport notices collapses into one.
  const renderSentences = async ({ force = false } = {}) => {
    if (sentencesBusy) {
      sentencesAgain = true;
      return;
    }
    sentencesBusy = true;
    try {
      await renderSentencesNow({ force });
    } finally {
      sentencesBusy = false;
      if (sentencesAgain) {
        sentencesAgain = false;
        scheduleSentences();
      }
    }
  };
  const scheduleSentences = (delay = 300) => {
    if (sentencesTimer !== null) return;
    sentencesTimer = globalThis.setTimeout(() => {
      runtime.timers.delete(sentencesTimer);
      sentencesTimer = null;
      if (miniTab === 'reading' && win.isConnected) void renderSentences();
    }, delay);
    runtime.timers.add(sentencesTimer);
  };

  // What the run is doing, as three pills: the reading, the audio parts, the connection.
  const renderPills = () => {
    const box = win.querySelector('[data-jy-tts-pills]');
    if (!box) return;
    const target = readingTarget();
    const messageId = target.messageId;
    const side = target.transport ? target.side : (inspecting?.messageId === messageId ? inspecting.side : target.side);
    const record = Number.isInteger(messageId) ? ttsProgressFor(messageId, side) : null;
    // In the plain reading the link asks for this floor's one analysis; elsewhere it redoes one.
    const link = win.querySelector('[data-jy-action="tts-reanalyze"]');
    if (link) {
      const step = record?.steps.find(item => item.id === 'analysis');
      const plain = ttsSettings().mode === 'off' && (!step || step.label === '不分析');
      link.textContent = plain ? '分析这一楼' : '重新分析';
      link.title = plain ? '让副模型把这一楼的说话人和情绪分析一次，只做这一楼，模式不变' : '按你的意见改这一楼的分析，或者丢掉重来';
    }
    const pills = [];
    const pill = (label, state) => pills.push([label, state]);
    if (record?.steps.length) {
      const analysis = record.steps.find(step => step.id === 'analysis');
      if (analysis) {
        const seconds = analysis.state === 'active' ? ` · ${Math.max(0, Math.round((Date.now() - (analysis.since ?? Date.now())) / 1000))} 秒` : '';
        pill(`${analysis.state === 'done' ? '✓ ' : analysis.state === 'active' ? '◌ ' : analysis.state === 'error' ? '! ' : ''}${analysis.label.replace(/（.*）$/, '')}${seconds}`, analysis.state);
      }
      const parts = record.steps.filter(step => step.id !== 'analysis');
      if (parts.length) {
        const done = parts.filter(step => step.state === 'done').length;
        const active = parts.find(step => step.state === 'active');
        const failed = parts.some(step => step.state === 'error');
        pill(`${failed ? '! ' : active ? '◌ ' : done === parts.length ? '✓ ' : ''}生成 ${done}/${parts.length}${active?.detail ? ` · ${active.detail}` : ''}`, failed ? 'error' : active ? 'active' : done === parts.length ? 'done' : 'pending');
      }
      // Named for the reading in force: a deep floor shows the deep connection, not the translation's.
      const request = ttsRequestSettings(runtime.settings, ttsAnalysisDepth(ttsSettings()));
      if (request.apiMode === 'independent') pill(getActiveChannel(request).name, 'plain');
    }
    // This runs on every notice of the reading; the same pills as last time are left where they are.
    const signature = JSON.stringify(pills);
    if (signature === box.dataset.signature) return;
    box.dataset.signature = signature;
    box.replaceChildren(...pills.map(([label, state]) => {
      const span = document.createElement('span');
      span.className = 'jy-mini-pill';
      span.dataset.state = state;
      span.textContent = label;
      return span;
    }));
    box.hidden = !pills.length;
  };
  // Seconds a preparation still needs, from what earlier runs took.
  const readingEta = record => {
    if (!record) return '';
    const analysis = record.steps.find(step => step.id === 'analysis');
    const parts = record.steps.filter(step => step.id !== 'analysis');
    if (analysis?.state === 'active') {
      return describeRemaining(estimateRemaining({ done: 0, total: 1, active: 1, lanes: 1, durations: [], elapsedActive: (Date.now() - (analysis.since ?? Date.now())) / 1000, history: runtime.timing.analysis }));
    }
    const pending = parts.filter(step => step.state !== 'done' && step.state !== 'error');
    const active = parts.filter(step => step.state === 'active');
    if (pending.length) {
      const since = active.length ? Math.min(...active.map(step => step.since ?? Date.now())) : Date.now();
      return describeRemaining(estimateRemaining({ done: parts.length - pending.length, total: parts.length, active: active.length, lanes: Math.max(1, Number(ttsSettings().fish.concurrency) || 1), durations: parts.filter(step => step.state === 'done' && step.since && step.finishedAt).map(step => (step.finishedAt - step.since) / 1000), elapsedActive: (Date.now() - since) / 1000, history: runtime.timing.parts }));
    }
    return '';
  };
  const renderTransport = () => {
    // Only the reading the page is about: one stopped on another floor leaves the player to this one.
    const { transport } = readingTarget();
    const info = transport ? ttsTransportDescription(transport) : null;
    const title = win.querySelector('[data-jy-tts-title]');
    const floorLabel = win.querySelector('[data-jy-tts-floor]');
    const progress = win.querySelector('[data-jy-tts-progress]');
    const message = win.querySelector('[data-jy-tts-message]');
    const toggles = [...win.querySelectorAll('[data-jy-action="tts-toggle"]')];
    const stepButtons = [win.querySelector('[data-jy-action="tts-prev"]'), win.querySelector('[data-jy-action="tts-next"]')];
    const stream = runtime.tts.stream && !runtime.tts.stream.done ? runtime.tts.stream : null;
    if (!info && stream) {
      // Read while it is written: no transport, but something is sounding and can be paused or stopped.
      if (title) putText(title, '边写边读');
      if (floorLabel) putText(floorLabel, Number.isInteger(stream.messageId) ? `第 ${stream.messageId} 楼` : '外部接口');
      if (message) putText(message, stream.state === 'buffering' ? '等第一句写完…' : stream.state === 'paused' ? '已暂停' : '一句写完读一句');
      for (const toggle of toggles) {
        putText(toggle, stream.state === 'speaking' ? '❚❚' : '▶');
        if (toggle.dataset.state !== stream.state) toggle.dataset.state = stream.state;
      }
      for (const button of stepButtons) if (button) button.disabled = true;
      renderBriefActions();
      return;
    }
    if (!info) {
      if (title) putText(title, '没有在读');
      if (floorLabel) putText(floorLabel, Number.isInteger(viewFloor) ? `第 ${viewFloor} 楼` : '—');
      if (progress) setSeek(0);
      if (seekBar) {
        seekBar.setAttribute('aria-valuenow', '0');
        seekBar.dataset.live = 'false';
      }
      setText(win, '[data-jy-tts-clock-now]', '0:00');
      setText(win, '[data-jy-tts-clock-total]', '0:00');
      if (message) putText(message, '点播放键读这一楼，或者点下面的某一句。');
      for (const toggle of toggles) {
        putText(toggle, '▶');
        if (toggle.dataset.state !== 'idle') toggle.dataset.state = 'idle';
      }
      for (const button of stepButtons) if (button) button.disabled = true;
      renderBriefActions();
      renderPills();
      return;
    }
    const speaker = info.segment ? (info.segment.type === 'narration' ? '旁白' : (info.segment.speaker || '对白')) : '';
    if (title) {
      putText(title, info.state === 'loading'
        ? '准备中…'
        : info.state === 'error'
          ? '出错了'
          : info.segment
            ? `${speaker} ·「${miniShort(info.segment.text, 22)}」`
            : (info.state === 'paused' ? '已暂停' : '待播放'));
    }
    if (floorLabel) putText(floorLabel, `第 ${info.messageId} 楼 · 第 ${info.lineIndex + 1}/${info.lineCount} 段 · ${TTS_MODE_LABELS[info.mode]}`);
    const fraction = info.duration ? Math.max(0, Math.min(1, info.time / info.duration)) : 0;
    if (progress && !seekDragging) setSeek(fraction);
    if (seekBar) {
      seekBar.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
      seekBar.dataset.live = transport.current ? 'true' : 'false';
    }
    setText(win, '[data-jy-tts-clock-now]', miniClock(info.time));
    setText(win, '[data-jy-tts-clock-total]', miniClock(info.duration));
    if (message) {
      const eta = info.state === 'loading' ? readingEta(ttsProgressFor(info.messageId, transport.side)) : '';
      putText(message, info.state === 'loading' || info.state === 'error'
        ? `${info.message || ''}${eta ? ` · ${eta}` : ''}`
        : info.state === 'paused'
          ? `已暂停 · 第 ${info.index + 1}/${info.count} 句`
          : `第 ${info.index + 1}/${info.count} 句`);
    }
    for (const toggle of toggles) {
      putText(toggle, info.state === 'playing' ? '❚❚' : '▶');
      if (toggle.dataset.state !== info.state) toggle.dataset.state = info.state;
    }
    for (const button of stepButtons) if (button) button.disabled = false;
    renderBriefActions();
    renderPills();
    // The panel follows the sentence being read unless someone pinned one, or is mid-edit.
    const side = runtime.tts.transport?.side ?? null;
    if (info.segment && inspecting && !inspecting.pinned && !inspectDirty && shadow.activeElement !== fishInput
      && (inspecting.messageId !== info.messageId || inspecting.utteranceId !== info.segment.id || inspecting.side !== side)) {
      void renderInspector(info.messageId, info.segment.id, { pinned: false, side });
    }
  };
  // The steps of the last run on the floor being read, or looked at, or the latest one touched.
  let stepTicker = null;
  const renderSteps = () => {
    const list = win.querySelector('[data-jy-tts-steps]');
    if (!list) return;
    const { transport, messageId: shown, side: shownSide } = readingTarget();
    let record = transport?.floor ? ttsProgressFor(transport.messageId, transport.side) : null;
    if (!record && inspecting) record = ttsProgressFor(inspecting.messageId, inspecting.side);
    if (!record && Number.isInteger(shown)) record = ttsProgressFor(shown, shownSide);
    const active = record?.steps.some(step => step.state === 'active') === true;
    // The detailed list only shows while something is being made; afterwards the pills say it all.
    if (!record?.steps.length || !active) {
      if (list.childElementCount) list.replaceChildren();
      list.dataset.signature = '';
      list.hidden = true;
      if (stepTicker !== null) {
        globalThis.clearInterval(stepTicker);
        stepTicker = null;
      }
      renderPills();
      return;
    }
    list.hidden = false;
    const rows = record.steps.map(step => [step.state, step.label, step.state === 'active'
      ? `${step.detail ? `${step.detail} · ` : ''}${Math.max(0, Math.round((Date.now() - (step.since ?? Date.now())) / 1000))} 秒`
      : (step.detail ?? '')]);
    // Rebuilt only when a step moved or its seconds turned over.
    const signature = JSON.stringify(rows);
    if (signature !== list.dataset.signature) {
      list.dataset.signature = signature;
      list.replaceChildren(...rows.map(([state, labelText, detailText]) => {
        const item = document.createElement('li');
        item.dataset.state = state;
        const mark = document.createElement('span');
        mark.className = 'jy-mini-step-mark';
        const label = document.createElement('span');
        label.className = 'jy-mini-step-label';
        label.textContent = labelText;
        const detail = document.createElement('span');
        detail.className = 'jy-mini-step-detail';
        detail.textContent = detailText;
        item.append(mark, label, detail);
        return item;
      }));
    }
    renderPills();
    if (stepTicker === null) {
      stepTicker = globalThis.setInterval(() => {
        if (!win.isConnected) {
          globalThis.clearInterval(stepTicker);
          stepTicker = null;
          return;
        }
        renderSteps();
        renderTransport();
      }, 1000);
    }
  };
  // The bar at the foot of the translate page while something is being read.
  // Two play bars show the same reading: the brief window's and the translate page's.
  const renderPlaybar = transport => {
    const info = ttsTransportDescription(transport);
    const live = info && ['loading', 'playing', 'paused'].includes(info.state);
    const fraction = live && info.duration ? Math.max(0, Math.min(1, info.time / info.duration)) : 0;
    const speaker = live && info.segment ? (info.segment.type === 'narration' ? '旁白' : (info.segment.speaker || '对白')) : '';
    for (const barButton of win.querySelectorAll('[data-jy-mini-playbar]')) {
      barButton.hidden = !live;
      if (!live) continue;
      const fill = barButton.querySelector('[data-jy-mini-playbar-fill]');
      if (fill) fill.style.transform = `scaleX(${fraction})`;
      setText(barButton, '[data-jy-mini-playbar-glyph]', info.state === 'playing' ? '❚❚' : info.state === 'loading' ? '◌' : '▶');
      setText(barButton, '[data-jy-mini-playbar-text]', info.state === 'loading' ? `第 ${info.messageId} 楼 · 准备中` : `第 ${info.messageId} 楼 · ${speaker} ${info.index + 1}/${info.count}`);
    }
  };
  // The progress bar is a slider: a tap jumps, a drag scrubs, the arrow keys nudge by five percent.
  let seekDragging = false;
  // Where the bar stands, as one number the fill and the knob both read (see .jy-progress-seek).
  const setSeek = fraction => {
    const value = Math.max(0, Math.min(1, Number(fraction) || 0)).toFixed(4);
    if (seekBar && seekBar.style.getPropertyValue('--jy-seek') !== value) seekBar.style.setProperty('--jy-seek', value);
  };
  let seekPointer = null;
  const seekFraction = event => {
    const rect = seekBar.getBoundingClientRect();
    return rect.width ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : 0;
  };
  const onSeekDown = event => {
    if (!runtime.tts.transport?.current || event.button !== 0) return;
    event.preventDefault();
    seekDragging = true;
    seekPointer = event.pointerId;
    try {
      seekBar.setPointerCapture?.(event.pointerId);
    } catch {
      // A pointer the browser does not know (a synthetic event) still seeks, it just cannot be captured.
    }
    const fraction = seekFraction(event);
    setSeek(fraction);
    seekTts(fraction);
  };
  const onSeekMove = event => {
    if (!seekDragging || event.pointerId !== seekPointer) return;
    const fraction = seekFraction(event);
    setSeek(fraction);
    seekTts(fraction);
  };
  const onSeekUp = event => {
    if (event.pointerId !== seekPointer) return;
    seekDragging = false;
    seekPointer = null;
  };
  const onSeekKey = event => {
    const info = ttsTransportDescription();
    if (!info?.duration) return;
    const step = event.key === 'ArrowLeft' ? -0.05 : event.key === 'ArrowRight' ? 0.05 : null;
    if (step === null) return;
    event.preventDefault();
    seekTts(Math.max(0, Math.min(1, info.time / info.duration + step)));
  };
  const unsubscribeTts = subscribeTts(transport => {
    renderTransport();
    renderSteps();
    renderPlaybar(transport);
    if (miniTab === 'reading') scheduleSentences();
  });
  // Between those notices only the clock and the bars move.
  const renderProgress = transport => {
    if (!win.isConnected) return;
    const shown = readingTarget().transport;
    const info = shown ? ttsTransportDescription(shown) : null;
    if (info) {
      const fraction = info.duration ? Math.max(0, Math.min(1, info.time / info.duration)) : 0;
      if (!seekDragging) setSeek(fraction);
      const now = String(Math.round(fraction * 100));
      if (seekBar && seekBar.getAttribute('aria-valuenow') !== now) seekBar.setAttribute('aria-valuenow', now);
      setText(win, '[data-jy-tts-clock-now]', miniClock(info.time));
      setText(win, '[data-jy-tts-clock-total]', miniClock(info.duration));
    }
    const live = transport ? ttsTransportDescription(transport) : null;
    if (!live?.duration) return;
    const scale = `scaleX(${Math.max(0, Math.min(1, live.time / live.duration)).toFixed(3)})`;
    for (const fill of win.querySelectorAll('[data-jy-mini-playbar-fill]')) if (fill.style.transform !== scale) fill.style.transform = scale;
  };
  const unsubscribeProgress = subscribeTtsProgress(renderProgress);
  refreshReading = () => {
    renderTransport();
    renderSteps();
    if (miniTab === 'reading') scheduleSentences();
  };
  const showReading = (messageId, utteranceId = null, side = null) => {
    if (Number.isInteger(messageId) && messageId !== viewFloor) {
      viewFloor = messageId;
      editingRow = null;
      void renderFloor();
    }
    selectMiniTab('reading');
    if (utteranceId !== null && utteranceId !== undefined) {
      void renderInspector(messageId, utteranceId, { pinned: true, side });
      return;
    }
    renderSteps();
  };
  // Where the reading is on the page: the highlighted sentence, else the floor being read.
  const locateReading = () => {
    const highlighted = runtime.tts.highlighted;
    const transport = runtime.tts.transport;
    const messageId = highlighted?.messageId ?? transport?.messageId ?? inspecting?.messageId ?? viewFloor;
    if (!Number.isInteger(messageId)) return false;
    const range = highlighted ? runtime.tts.ranges.get(highlighted.messageId)?.get(`${highlighted.side}:${highlighted.utteranceId}`) : null;
    const target = range?.startContainer?.parentElement ?? document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    if (!target) return false;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  };

  // -------------------------------------------------------------------------------------------
  // The log page: what happened, filtered, one line each, the details a tap away.
  // -------------------------------------------------------------------------------------------
  const renderLog = () => {
    const filtered = filterLogs(logEntries, { filter: logFilter, floor: viewFloor });
    logShown = filtered.slice(0, MINI_LOG_LIMIT);
    for (const chip of win.querySelectorAll('[data-jy-action="log-filter"]')) chip.setAttribute('aria-pressed', String(chip.dataset.filter === logFilter));
    logList.replaceChildren();
    logShown.forEach((entry, index) => {
      const line = describeLog(entry);
      const item = document.createElement('li');
      item.className = 'jy-mini-log-item';
      item.dataset.level = line.level;
      item.dataset.jyAction = 'log-open';
      item.dataset.index = String(index);
      const meta = document.createElement('span');
      meta.className = 'jy-mini-log-meta';
      meta.textContent = `${line.time} · ${line.area}${line.floor !== null ? ` · 第 ${line.floor} 楼` : ''}${line.level === 'error' ? ' · 出错' : line.level === 'warn' ? ' · 提醒' : ''}`;
      const text = document.createElement('span');
      text.className = 'jy-mini-log-text';
      text.textContent = line.message;
      item.append(meta, text);
      logList.appendChild(item);
    });
    const empty = win.querySelector('[data-jy-mini-log-empty]');
    if (empty) {
      empty.hidden = logShown.length > 0;
      empty.textContent = logFilter === 'floor' ? (Number.isInteger(viewFloor) ? `第 ${viewFloor} 楼还没有记录。` : '还没有楼层。') : logFilter === 'errors' ? '没有出错的记录。' : '这里还没有记录。';
    }
    logList.hidden = !logShown.length;
  };
  const stringifyForLog = (value, limit) => {
    let text;
    try {
      text = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
    } catch {
      text = String(value);
    }
    text = String(text ?? '');
    return text.length > limit ? `${text.slice(0, limit)}\n…（已截断，完整内容见控制中心的运行记录）` : text;
  };
  const openLogDetail = entry => {
    const line = describeLog(entry);
    logDetail.replaceChildren();
    const head = document.createElement('div');
    head.className = 'jy-mini-log-detail-head';
    const meta = document.createElement('strong');
    meta.dataset.level = line.level;
    meta.textContent = `${line.time} · ${line.area}${line.floor !== null ? ` · 第 ${line.floor} 楼` : ''}${line.level === 'error' ? ' · 出错' : ''}`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'jy-mini-inspect-close';
    close.dataset.jyAction = 'log-close';
    close.setAttribute('aria-label', '关闭');
    close.textContent = '×';
    head.append(meta, close);
    const message = document.createElement('p');
    message.className = 'jy-mini-log-detail-message';
    message.textContent = line.message;
    const scope = document.createElement('p');
    scope.className = 'jy-muted';
    scope.textContent = entry.scope ?? '';
    logDetail.append(head, message, scope);
    const section = (label, value, open = false) => {
      if (value === undefined || value === null || (typeof value === 'object' && !Object.keys(value).length) || value === '') return;
      const details = document.createElement('details');
      details.className = 'jy-mini-log-section';
      details.open = open;
      const summary = document.createElement('summary');
      summary.textContent = label;
      const pre = document.createElement('pre');
      pre.textContent = stringifyForLog(value, label === '细节' ? 4000 : 12000);
      details.append(summary, pre);
      logDetail.appendChild(details);
    };
    section('细节', entry.details, true);
    section('请求', entry.fullRequest);
    section('返回', entry.fullResponse);
    section('思考', entry.reasoning);
    const actions = document.createElement('div');
    actions.className = 'jy-mini-log-detail-actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'jy-button';
    copy.dataset.jyAction = 'log-copy-one';
    copy.textContent = '复制这条';
    actions.appendChild(copy);
    if (Number.isInteger(line.floor) && line.area === '翻译' && line.level !== 'info') {
      const repair = document.createElement('button');
      repair.type = 'button';
      repair.className = 'jy-button';
      repair.dataset.jyAction = 'log-repair';
      repair.dataset.floor = String(line.floor);
      repair.textContent = '补译这楼';
      actions.appendChild(repair);
    }
    logDetail.appendChild(actions);
    logDetail.dataset.entry = JSON.stringify(entry).slice(0, 400000);
    logDetail.hidden = false;
    logList.hidden = true;
    win.querySelector('[data-jy-mini-log-filters]').hidden = true;
    globalThis.requestAnimationFrame?.(() => { if (win.isConnected) reanchor(); });
  };
  const closeLogDetail = () => {
    logDetail.hidden = true;
    delete logDetail.dataset.entry;
    win.querySelector('[data-jy-mini-log-filters]').hidden = false;
    renderLog();
  };
  const logReport = () => {
    const lines = logShown.slice().reverse().map(entry => {
      const line = describeLog(entry);
      return `[${entry.time ?? ''}] ${line.level} ${entry.scope ?? ''}${line.floor !== null ? ` 第${line.floor}楼` : ''}: ${line.message}${entry.details && Object.keys(entry.details).length ? ` ${stringifyForLog(entry.details, 600).replace(/\s+/g, ' ')}` : ''}`;
    });
    return `${APP_NAME} v${APP_VERSION} · 悬浮窗日志 · ${new Date().toISOString()}\n${lines.join('\n')}`;
  };
  const countLogErrors = entries => entries.filter(entry => entry.level === 'error').length;
  const updateLogBadge = () => {
    const logTab = tabs.querySelector('[data-jy-mini-tab="log"]');
    if (!logTab) return;
    const unseen = Math.max(0, countLogErrors(logEntries) - logSeenErrors);
    logTab.dataset.errors = unseen ? String(Math.min(unseen, 99)) : '';
  };
  const unsubscribeLog = subscribeDiagnostics(entries => {
    logEntries = entries;
    if (miniTab === 'log' && logDetail.hidden) renderLog();
    // Errors that arrive while the log is open are seen as they land.
    if (miniTab === 'log') logSeenErrors = countLogErrors(entries);
    else logSeenErrors = Math.min(logSeenErrors, countLogErrors(entries));
    updateLogBadge();
  });

  // -------------------------------------------------------------------------------------------
  // Placement: hung off the ball the first time, then wherever the reader dragged it.
  // -------------------------------------------------------------------------------------------
  const stored = readMiniPosition();
  const position = stored ?? anchorMiniPosition(win);
  let userMoved = Boolean(stored);
  const place = (x, y) => {
    if (win.dataset.size === 'max') return;
    const width = win.offsetWidth || 344;
    const height = win.offsetHeight || 320;
    position.x = Math.min(Math.max(8, x), Math.max(8, globalThis.innerWidth - width - 8));
    position.y = Math.min(Math.max(8, y), Math.max(8, globalThis.innerHeight - height - 8));
    win.style.left = `${position.x}px`;
    win.style.top = `${position.y}px`;
  };
  // Content lands after the first layout and can add a line, so the window is re-hung once it
  // settles; a window the reader placed only gets clamped back into view.
  const reanchor = () => {
    if (win.dataset.size === 'max') return;
    if (userMoved) {
      place(position.x, position.y);
      return;
    }
    const next = anchorMiniPosition(win);
    place(next.x, next.y);
  };
  setSize(win.dataset.size, { remember: false });
  syncTouch();
  globalThis.requestAnimationFrame?.(() => { if (win.isConnected) reanchor(); });

  let pointerId = null;
  let grabX = 0;
  let grabY = 0;
  const onPointerDown = event => {
    if (event.button !== 0 || event.target.closest('button') || win.dataset.size === 'max') return;
    event.preventDefault();
    pointerId = event.pointerId;
    grabX = event.clientX - position.x;
    grabY = event.clientY - position.y;
    bar.classList.add('is-dragging');
    try {
      bar.setPointerCapture?.(event.pointerId);
    } catch {
      // A pointer the browser does not know still drags.
    }
  };
  const onPointerMove = event => {
    if (event.pointerId !== pointerId) return;
    userMoved = true;
    place(event.clientX - grabX, event.clientY - grabY);
  };
  const finishPointer = event => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    bar.classList.remove('is-dragging');
    if (userMoved) saveMiniPosition(position);
  };
  const onResize = () => {
    syncTouch();
    reanchor();
  };

  // -------------------------------------------------------------------------------------------
  // Closing, keys, and the buttons.
  // -------------------------------------------------------------------------------------------
  let closed = false;
  // -------------------------------------------------------------------------------------------
  // 通话测试（测试版）: the call page. What it shows is the call's own snapshot; the talk button is
  // held, not clicked.
  // -------------------------------------------------------------------------------------------
  const callPage = pages.call;
  const callScroll = callPage.querySelector('[data-jy-call-scroll]');
  const callLines = callPage.querySelector('[data-jy-call-lines]');
  const callTalk = callPage.querySelector('[data-jy-call-talk]');
  const callTyping = callPage.querySelector('[data-jy-call-typing]');
  const callInput = callPage.querySelector('[data-jy-call-input]');
  const callHistoryList = callPage.querySelector('[data-jy-call-history]');
  const callDetail = callPage.querySelector('[data-jy-call-detail]');
  let callView = callController().snapshot;
  let callFrame = null;
  let callTicker = null;
  const callClock = ms => {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const callPeerName = () => {
    try {
      const context = getContext();
      return context.groupId ? '' : String(context.name2 || '').trim();
    } catch {
      return '';
    }
  };
  // The clock and the seconds waited: the only part redrawn while nothing else changes.
  const renderCallClock = () => {
    const view = callView;
    const inCall = view.phase !== 'idle';
    putText(callPage.querySelector('[data-jy-call-clock]'), inCall ? callClock(Date.now() - view.startedAt) : view.ended ? `通话 ${callClock(view.ended.at - view.startedAt)}` : '—');
    const since = view.phase === 'thinking' ? view.askedAt : view.phase === 'listening' ? view.listenedAt : 0;
    putText(callPage.querySelector('[data-jy-call-wait]'), since ? `${Math.floor((Date.now() - since) / 1000)} 秒` : '');
  };
  const renderCallLines = view => {
    const turns = view.turns;
    callLines.hidden = !turns.length;
    const atBottom = callScroll.scrollHeight - callScroll.scrollTop - callScroll.clientHeight < 48;
    while (callLines.children.length > turns.length) callLines.lastElementChild.remove();
    while (callLines.children.length < turns.length) {
      const row = document.createElement('li');
      row.className = 'jy-mini-sentence';
      const mark = document.createElement('span');
      mark.className = 'jy-mini-sentence-mark';
      const body = document.createElement('div');
      body.className = 'jy-mini-sentence-body';
      const who = document.createElement('div');
      who.className = 'jy-mini-sentence-echo';
      const text = document.createElement('div');
      text.className = 'jy-mini-sentence-text';
      body.append(who, text);
      row.append(mark, body);
      callLines.appendChild(row);
    }
    turns.forEach((turn, index) => {
      const row = callLines.children[index];
      const current = turn.live ? 'true' : 'false';
      if (row.dataset.current !== current) row.dataset.current = current;
      putText(row.firstElementChild, turn.live ? (view.phase === 'speaking' ? '♪' : '…') : '·');
      putText(row.querySelector('.jy-mini-sentence-echo'), turn.from === 'user' ? (view.user || '我') : (view.peer || '对方'));
      putText(row.querySelector('.jy-mini-sentence-text'), turn.text ? `${turn.text}${turn.cut ? '……' : ''}` : '…');
    });
    if (atBottom) callScroll.scrollTop = callScroll.scrollHeight;
  };
  const renderCall = () => {
    callFrame = null;
    if (!win.isConnected) return;
    const view = callView;
    const inCall = view.phase !== 'idle';
    const peer = view.peer || callPeerName();
    const stt = sttAvailability();
    putText(callPage.querySelector('[data-jy-call-peer]'), peer ? (inCall ? `和${peer}通话中` : `打给${peer}`) : '通话测试');
    const other = view.peer || '对方';
    const says = {
      thinking: `${other}在想`,
      speaking: `${other}在说`,
      ready: stt.available ? '该你说了：按住下面的按钮说话' : '该你说了：打字发过去',
      listening: view.partial ? `在听：${view.partial}` : '在听，说完松开',
      transcribing: '在转写',
      idle: view.ended ? `通话结束${view.ended.reason ? `（${view.ended.reason}）` : ''}` : '按「拨打」，对方会先开口',
    };
    putText(callPage.querySelector('[data-jy-call-state]'), view.blocked ? '浏览器要先点一下才出声：点「继续」' : view.paused ? '暂停了：点「继续」接着听' : says[view.phase] ?? '');
    const notes = [];
    if (view.error) notes.push(`出错：${view.error}`);
    else if (view.note) notes.push(view.note);
    if (!inCall) {
      try {
        apiTtsSettings();
      } catch (error) {
        if (!view.error) notes.push(`${safeError(error)}（控制中心 → 朗读）`);
      }
    }
    if (inCall && !stt.available) notes.push(`语音输入没开：${stt.reason}`);
    if (callRequestSettings().apiMode !== 'independent') notes.push('通话连接跟随酒馆，要等整段写完才开始读。在「更多 → 通话设置」里给通话选一条自己的连接，就能边写边读。');
    const note = callPage.querySelector('[data-jy-call-note]');
    putText(note, notes.join('\n'));
    note.hidden = !notes.length;
    renderCallLines(view);
    const talking = ['thinking', 'speaking'].includes(view.phase);
    const show = (selector, visible) => {
      const button = callPage.querySelector(selector);
      if (button && button.hidden === visible) button.hidden = !visible;
    };
    show('[data-jy-action="call-dial"]', !inCall);
    show('[data-jy-action="call-hang"]', inCall);
    const held = view.blocked || view.paused;
    show('[data-jy-action="call-interrupt"]', inCall && talking && !held);
    show('[data-jy-action="call-resume"]', inCall && held);
    show('[data-jy-call-talk]', inCall && stt.available);
    if (callTyping.hidden === (inCall && !stt.available)) callTyping.hidden = !(inCall && !stt.available);
    putText(callTalk, view.phase === 'listening' ? '松开发送' : view.phase === 'transcribing' ? '在转写…' : '按住说话');
    callTalk.disabled = view.phase === 'transcribing';
    callTalk.setAttribute('aria-pressed', String(view.phase === 'listening'));
    if (inCall && callTicker === null) callTicker = globalThis.setInterval(renderCallClock, 250);
    if (!inCall && callTicker !== null) {
      globalThis.clearInterval(callTicker);
      callTicker = null;
    }
    renderCallClock();
  };
  const scheduleCall = view => {
    callView = view;
    if (callFrame !== null) return;
    callFrame = globalThis.requestAnimationFrame ? globalThis.requestAnimationFrame(renderCall) : globalThis.setTimeout(renderCall, 16);
  };
  const unsubscribeCall = callController().on(view => {
    scheduleCall(view);
    // A call that ended or a turn that was kept shows up in the list of calls.
    if (view.phase === 'idle' || view.phase === 'ready') renderCallHistory();
  });
  const callWhen = at => new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  function renderCallHistory() {
    let key = '';
    try {
      key = worldInfoCharacterKey();
    } catch {
      // No chat open.
    }
    const calls = key ? callHistory().list(key) : [];
    callHistoryList.replaceChildren(...calls.map(call => {
      const item = document.createElement('li');
      item.className = 'jy-mini-log-item';
      item.dataset.callId = call.id;
      const meta = document.createElement('span');
      meta.className = 'jy-mini-log-meta';
      meta.textContent = `${callWhen(call.startedAt)} · ${call.endedAt ? callClock(call.endedAt - call.startedAt) : '—'} · ${call.turns.length} 句`;
      const text = document.createElement('span');
      text.className = 'jy-mini-log-text';
      const last = [...call.turns].reverse().find(turn => turn.from === 'char') ?? call.turns[call.turns.length - 1];
      text.textContent = last?.text ?? '';
      item.append(meta, text);
      return item;
    }));
    callPage.querySelector('[data-jy-call-history-empty]').hidden = calls.length > 0;
    callPage.querySelector('[data-jy-action="call-clear"]').hidden = !calls.length;
    if (!callDetail.hidden && !calls.some(call => call.id === callDetail.dataset.callId)) {
      callDetail.hidden = true;
      callHistoryList.hidden = false;
    }
  }
  const showCallDetail = id => {
    let key = '';
    try {
      key = worldInfoCharacterKey();
    } catch {
      return;
    }
    const call = callHistory().list(key).find(item => item.id === id);
    if (!call) return;
    const head = document.createElement('div');
    head.className = 'jy-mini-log-detail-head';
    const title = document.createElement('strong');
    title.textContent = `${call.peer || '通话'} · ${callWhen(call.startedAt)}`;
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'jy-mini-inspect-close';
    back.dataset.jyAction = 'call-detail-close';
    back.setAttribute('aria-label', '回到往期通话');
    back.title = '回到往期通话';
    back.textContent = '×';
    head.append(title, back);
    const lines = call.turns.map(turn => {
      const line = document.createElement('p');
      line.className = 'jy-mini-log-detail-message';
      line.textContent = `${turn.from === 'user' ? '我' : (call.peer || '对方')}：${turn.text}${turn.cut ? '……' : ''}`;
      return line;
    });
    callDetail.replaceChildren(head, ...lines);
    callDetail.dataset.callId = call.id;
    callDetail.hidden = false;
    callHistoryList.hidden = true;
  };
  const onTalkDown = event => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    try {
      callTalk.setPointerCapture?.(event.pointerId);
    } catch {
      // The press still counts; only the capture is lost.
    }
    void callController().press();
  };
  const onTalkUp = () => callController().release();
  const onTalkKey = event => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (event.type === 'keyup') callController().release();
    else if (!event.repeat) void callController().press();
  };
  // A long press on a phone would otherwise open the text menu over the button.
  const onTalkMenu = event => event.preventDefault();
  const onCallInputKey = event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    if (callController().send(callInput.value)) callInput.value = '';
  };
  callTalk.addEventListener('pointerdown', onTalkDown);
  callTalk.addEventListener('pointerup', onTalkUp);
  callTalk.addEventListener('pointercancel', onTalkUp);
  callTalk.addEventListener('lostpointercapture', onTalkUp);
  callTalk.addEventListener('keydown', onTalkKey);
  callTalk.addEventListener('keyup', onTalkKey);
  callTalk.addEventListener('contextmenu', onTalkMenu);
  callInput.addEventListener('keydown', onCallInputKey);
  const dropCallPage = () => {
    unsubscribeCall();
    callTalk.removeEventListener('pointerdown', onTalkDown);
    callTalk.removeEventListener('pointerup', onTalkUp);
    callTalk.removeEventListener('pointercancel', onTalkUp);
    callTalk.removeEventListener('lostpointercapture', onTalkUp);
    callTalk.removeEventListener('keydown', onTalkKey);
    callTalk.removeEventListener('keyup', onTalkKey);
    callTalk.removeEventListener('contextmenu', onTalkMenu);
    callInput.removeEventListener('keydown', onCallInputKey);
    if (callTicker !== null) globalThis.clearInterval(callTicker);
    callTicker = null;
    if (callFrame !== null) {
      if (globalThis.cancelAnimationFrame) globalThis.cancelAnimationFrame(callFrame);
      globalThis.clearTimeout(callFrame);
    }
    callFrame = null;
    // The page is the only way to hang up: without it the call ends.
    callController().hangUp('关了悬浮窗');
  };

  renderCall();
  renderCallHistory();

  const close = () => {
    if (closed) return;
    closed = true;
    win.dataset.closing = 'true';
    settleResize();
    globalThis.removeEventListener('pointermove', onPointerMove);
    globalThis.removeEventListener('pointerup', finishPointer);
    globalThis.removeEventListener('pointercancel', finishPointer);
    globalThis.removeEventListener('resize', onResize);
    bar.removeEventListener('pointerdown', onPointerDown);
    win.removeEventListener('click', onClick);
    input.removeEventListener('keydown', onInputKeydown);
    input.removeEventListener('input', onInput);
    scratch.removeEventListener('toggle', onScratchToggle);
    scratchSummary.removeEventListener('click', onSummaryClick);
    document.removeEventListener('keydown', onWindowKeydown, true);
    document.removeEventListener('focusin', onOutsideFocus, true);
    channelSelect.removeEventListener('change', onQuickChange);
    profileSelect.removeEventListener('change', onQuickChange);
    tabs.removeEventListener('click', onTabClick);
    tagBox.removeEventListener('pointerdown', onTagPointerDown);
    tagBox.removeEventListener('click', onTagClick);
    emotionPicker.removeEventListener('change', onEmotionPick);
    fishInput.removeEventListener('input', onFishInput);
  win.removeEventListener('focusin', onFieldFocus);
  win.removeEventListener('keydown', onCustomKey);
  globalThis.visualViewport?.removeEventListener('resize', onViewport);
    speedInput.removeEventListener('input', onFishInput);
    volumeInput.removeEventListener('input', onFishInput);
    unsubscribeTask();
    unsubscribeTts();
    unsubscribeProgress();
    unsubscribeLog();
    dropCallPage();
    seekBar.removeEventListener('pointerdown', onSeekDown);
    seekBar.removeEventListener('pointermove', onSeekMove);
    seekBar.removeEventListener('pointerup', onSeekUp);
    seekBar.removeEventListener('pointercancel', onSeekUp);
    seekBar.removeEventListener('keydown', onSeekKey);
    for (const ticker of [stepTicker, etaTicker]) if (ticker !== null) globalThis.clearInterval(ticker);
    stepTicker = null;
    etaTicker = null;
    for (const pending of [rowsTimer, sentencesTimer]) {
      if (pending !== null) {
        globalThis.clearTimeout(pending);
        runtime.timers.delete(pending);
      }
    }
    rowsTimer = null;
    sentencesTimer = null;
    if (runtime.mini?.host === host) runtime.mini = null;
    holdFloatingPill(1800);
    const timer = setTimeout(() => { host.remove(); runtime.timers.delete(timer); }, 160);
    runtime.timers.add(timer);
  };

  const onInputKeydown = event => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    win.querySelector('[data-jy-action="mini-scratch"]')?.click();
  };
  const typingInside = () => {
    const active = shadow.activeElement;
    return Boolean(active && (active.matches('textarea, input, select') || active.isContentEditable));
  };
  const onWindowKeydown = event => {
    if (!runtime.mini?.host?.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    // The player's keys, when the window has the focus and nobody is typing in it.
    if (win.dataset.touch === 'true' || event.target !== host || typingInside() || event.ctrlKey || event.metaKey || event.altKey) return;
    const info = ttsTransportDescription();
    if (event.key === ' ' && ttsSettings().enabled) {
      event.preventDefault();
      win.querySelector('[data-jy-action="tts-toggle"]')?.click();
    } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && info?.duration && shadow.activeElement !== seekBar) {
      event.preventDefault();
      seekTts(Math.max(0, Math.min(1, info.time / info.duration + (event.key === 'ArrowLeft' ? -0.05 : 0.05))));
    } else if ((event.key === '[' || event.key === ']') && info) {
      event.preventDefault();
      stepTtsParagraph(event.key === '[' ? -1 : 1);
    }
  };
  // A phone's keyboard comes up for the chat box; the window gets out of its way.
  const onOutsideFocus = event => {
    if (win.dataset.touch !== 'true' || event.target === host) return;
    const target = event.target;
    if (target?.matches?.('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), [contenteditable="true"]')) close();
  };
  const onInput = () => {
    const length = input.value.trim().length;
    setText(win, '[data-jy-mini-note]', length ? `${length} 字 · Ctrl + Enter 直接翻` : 'Ctrl + Enter 直接翻');
  };
  const onScratchToggle = () => {
    globalThis.requestAnimationFrame?.(() => { if (win.isConnected) reanchor(); });
  };
  // details would snap shut and take the body out of the layout before it could animate, so the
  // open attribute is held for the length of the collapse and removed at the end.
  const setScratchOpen = open => {
    if (scratch.dataset.expanded === String(open)) return;
    if (open) {
      scratch.open = true;
      void scratch.offsetHeight;
      scratch.dataset.expanded = 'true';
    } else {
      scratch.dataset.expanded = 'false';
      const timer = setTimeout(() => {
        runtime.timers.delete(timer);
        if (scratch.dataset.expanded !== 'true') scratch.open = false;
      }, 330);
      runtime.timers.add(timer);
    }
    const settle = setTimeout(() => {
      runtime.timers.delete(settle);
      if (win.isConnected) reanchor();
    }, 360);
    runtime.timers.add(settle);
  };
  const onSummaryClick = event => {
    event.preventDefault();
    setScratchOpen(scratch.dataset.expanded !== 'true');
  };
  const onQuickChange = event => {
    const next = mergeSettings(runtime.settings);
    if (event.target === channelSelect) applyTranslationChoice(next, channelSelect.value);
    else next.selectedPromptProfileId = profileSelect.value;
    saveSettings(next);
    syncQuickPickers();
  };
  // A tap on a paragraph opens it for editing; a tap on the open one closes it.
  const toggleRow = id => {
    editingRow = editingRow === id ? null : id;
    renderRows();
    if (editingRow !== null) win.querySelector(`[data-jy-row-field="${editingRow}"]`)?.focus();
    globalThis.requestAnimationFrame?.(() => { if (win.isConnected) reanchor(); });
  };
  // The sentence of the reading that starts with this paragraph's translation, played from there.
  const listenRow = async id => {
    const row = viewRows.find(item => item.id === id);
    if (!row?.translation) throw new Error('这一段还没有译文。');
    const prepared = await ttsPrepared(viewFloor, null);
    const wanted = row.translation.split('\n').map(line => line.trim()).find(Boolean) ?? '';
    const line = prepared.floor.lines.find(candidate => candidate.text.trim() === wanted) ?? prepared.floor.lines.find(candidate => wanted && candidate.text.includes(wanted.slice(0, 12)));
    const item = line ? prepared.items.find(candidate => candidate.segment.lineId === line.lineId) : null;
    if (!item) throw new Error('这一段不在当前的朗读范围里。');
    void playTtsParagraph(viewFloor, item.segment.lineId, prepared.floor.side);
    selectMiniTab('reading');
  };

  const onClick = async event => {
    const button = event.target.closest('[data-jy-action]');
    if (!button) {
      const callItem = event.target.closest('[data-call-id]');
      if (callItem) {
        showCallDetail(callItem.dataset.callId);
        return;
      }
      if (event.target.closest('[data-jy-mini-page="call"]')) return;
      const row = event.target.closest('.jy-mini-row');
      if (row && !event.target.closest('textarea, button')) toggleRow(Number(row.dataset.id));
      const sentence = event.target.closest('.jy-mini-sentence');
      if (sentence && !event.target.closest('button')) {
        for (const other of sentenceList.querySelectorAll('.jy-mini-sentence[data-open="true"]')) if (other !== sentence) delete other.dataset.open;
        sentence.dataset.open = 'true';
        void playTtsUtterance(Number(sentence.dataset.messageId), Number(sentence.dataset.id), sentence.dataset.side);
      }
      return;
    }
    const action = button.dataset.jyAction;
    if (action === 'mini-collapse') { close(); return; }
    if (action === 'mini-expand') { close(); openControlCenter().catch(error => toast('error', safeError(error))); return; }
    if (action === 'mini-max') { setSize(nextMiniSize(win.dataset.size, win.dataset.touch === 'true')); return; }
    if (action === 'mini-goto-reading' && win.dataset.size === 'compact') setSize('card');
    if (action === 'mini-goto-reading') { selectMiniTab('reading'); return; }
    if (action === 'mini-thinking') { thinkingOpen = !thinkingOpen; renderThinkingLine(); globalThis.requestAnimationFrame?.(() => { if (win.isConnected) reanchor(); }); return; }
    if (action === 'mini-more' || action === 'mini-more-close') {
      const page = button.closest('[data-jy-mini-page]');
      const sheet = page?.querySelector('[data-jy-mini-more]');
      if (!sheet) return;
      sheet.hidden = action === 'mini-more-close' ? true : !sheet.hidden;
      for (const toggle of page.querySelectorAll('[data-jy-action="mini-more"]')) toggle.setAttribute('aria-expanded', String(!sheet.hidden));
      return;
    }
    if (action && action.startsWith('call-')) {
      const call = callController();
      try {
        if (action === 'call-dial') {
          callDetail.hidden = true;
          callHistoryList.hidden = false;
          await call.dial();
        } else if (action === 'call-hang') {
          call.hangUp();
        } else if (action === 'call-interrupt') {
          call.interrupt();
        } else if (action === 'call-resume') {
          call.resume();
        } else if (action === 'call-send') {
          if (call.send(callInput.value)) callInput.value = '';
        } else if (action === 'call-settings') {
          await openCallSettings();
        } else if (action === 'call-detail-close') {
          callDetail.hidden = true;
          callHistoryList.hidden = false;
        } else if (action === 'call-clear') {
          const key = worldInfoCharacterKey();
          const count = callHistory().list(key).length;
          if (!count) return;
          if (typeof globalThis.confirm === 'function' && !globalThis.confirm(`清空和这个角色的 ${count} 通通话记录？清掉就找不回来了。`)) return;
          callHistory().clear(key);
          renderCallHistory();
          toast('success', `已清空 ${count} 通通话记录。`);
        }
      } catch (error) {
        toast('error', safeError(error));
      }
      return;
    }
    if (action === 'tts-stop') { stopTts(); return; }
    if (action === 'mini-floor-prev') { moveFloor(-1); return; }
    if (action === 'mini-floor-next') { moveFloor(1); return; }
    if (action === 'mini-auto') {
      const next = mergeSettings(runtime.settings);
      next.autoGeneration = !next.autoGeneration;
      saveSettings(next);
      syncQuickPickers();
      toast('info', next.autoGeneration ? '新楼生成完会自动翻译。' : '新楼不再自动翻译，要翻的时候点「翻译本楼」。');
      return;
    }
    if (action === 'row-close') { editingRow = null; renderRows(); return; }
    if (action === 'log-filter') { logFilter = button.dataset.filter; renderLog(); return; }
    if (action === 'log-open') {
      const entry = logShown[Number(button.dataset.index)];
      if (entry) openLogDetail(entry);
      return;
    }
    if (action === 'log-close') { closeLogDetail(); return; }
    if (action === 'sentence-edit') {
      const row = button.closest('.jy-mini-sentence');
      if (row) void renderInspector(Number(row.dataset.messageId), Number(row.dataset.id), { pinned: true, side: row.dataset.side });
      return;
    }
    if (action === 'tts-save-sentence') {
      if (!inspecting) throw new Error('先打开一句的详细页，再保存它。');
      const built = await downloadTtsSentence(inspecting.messageId, inspecting.utteranceId, inspecting.side);
      await ttsOfferFile(built.blob, built.name, { note: built.cut ? '从这一段的音频里剪出来的，wav' : '' });
      return;
    }
    if (action === 'sentence-play' || action === 'sentence-regen') {
      const row = button.closest('.jy-mini-sentence');
      if (!row) return;
      const run = action === 'sentence-play' ? playTtsUtterance : regenerateTtsSentence;
      run(Number(row.dataset.messageId), Number(row.dataset.id), row.dataset.side).catch(error => { if (!isAbortError(error)) toast('error', safeError(error)); });
      return;
    }
    if (action === 'mini-brief-read') {
      if (Number.isInteger(viewFloor)) void playTtsFloor(viewFloor);
      return;
    }
    if (action === 'tts-insert-custom') {
      const input = win.querySelector('[data-jy-tts-custom]');
      const value = input?.value.trim().replace(/^[[(（【]|[\])）】]$/g, '').slice(0, 40);
      if (value) insertCue(value);
      if (input) input.value = '';
      return;
    }
    if (action === 'tts-inspect-close') { closeInspector(); return; }
    if (action === 'mini-copy') {
      try {
        await copyText(output.textContent || '');
        toast('success', '译文已复制。');
      } catch (error) { toast('error', safeError(error)); }
      return;
    }
    // Transport controls act at once and never wait on anything.
    if (action === 'tts-prev') { stepTtsParagraph(-1); return; }
    if (action === 'tts-next') { stepTtsParagraph(1); return; }
    if (action === 'tts-toggle') {
      // ▶ acts on what the player shows: the reading of this floor if there is one, else this floor.
      const target = readingTarget();
      const stream = runtime.tts.stream && !runtime.tts.stream.done ? runtime.tts.stream : null;
      if (target.transport) toggleTtsPause();
      else if (stream) {
        if (stream.state === 'paused') stream.resume();
        else stream.pause();
      }
      else if (inspecting?.pinned) void playTtsUtterance(inspecting.messageId, inspecting.utteranceId, inspecting.side);
      else {
        const messageId = target.messageId ?? latestAssistantMessageId(getContext());
        if (!Number.isInteger(messageId)) toast('error', '当前聊天里还没有 AI 楼层。');
        else void playTtsFloor(messageId, inspecting?.messageId === messageId ? inspecting.side : null);
      }
      return;
    }
    if (action === 'tts-locate') {
      if (!locateReading()) toast('info', '还没有在读的句子。');
      return;
    }
    if (action === 'tts-download') {
      await askAndSave(button);
      return;
    }
    if (action === 'tts-save-pick') {
      await askAndSave(button, Number(button.dataset.id));
      return;
    }
    const original = button.textContent;
    button.disabled = true;
    try {
      if (action === 'tts-read-floor') {
        // The sentence open in the inspector counts only while it belongs to the floor on screen;
        // otherwise this read the floor whose detail happened to be open last.
        const opened = inspecting && (!Number.isInteger(viewFloor) || inspecting.messageId === viewFloor) ? inspecting.messageId : null;
        const messageId = opened ?? viewFloor ?? runtime.tts.transport?.messageId ?? latestAssistantMessageId(getContext());
        if (!Number.isInteger(messageId)) throw new Error('当前聊天里还没有 AI 楼层。');
        void playTtsFloor(messageId, inspecting?.messageId === messageId ? inspecting.side : null);
      } else if (action === 'tts-apply') {
        if (!inspecting) throw new Error('先选一句。');
        button.textContent = '生成中…';
        const { messageId, utteranceId, side } = inspecting;
        await saveTtsOverride(messageId, utteranceId, { text: fishInput.value, speed: speedInput.value, volume: volumeInput.value }, side);
        inspectDirty = false;
        await renderInspector(messageId, utteranceId, { pinned: true, side });
        toast('success', '这一句已按你的版本重新生成。');
        void playTtsUtterance(messageId, utteranceId, side);
      } else if (action === 'tts-reset') {
        if (!inspecting) throw new Error('先选一句。');
        const { messageId, utteranceId, side } = inspecting;
        await clearTtsOverride(messageId, utteranceId, side);
        inspectDirty = false;
        await renderInspector(messageId, utteranceId, { pinned: true, side });
        toast('success', '已恢复为程序的判断和副模型的分析。');
      } else if (action === 'tts-copy-analysis') {
        // The sentence open, else the floor the page shows — never a floor the reading only stopped on.
        const target = readingTarget();
        const messageId = inspecting?.messageId ?? target.messageId ?? latestAssistantMessageId(getContext());
        if (!Number.isInteger(messageId)) throw new Error('当前聊天里还没有 AI 楼层。');
        const prepared = await ttsPrepared(messageId, inspecting?.side ?? target.transport?.side ?? null);
        const analysis = runtime.tts.analysis.get(ttsLabelKey(prepared.floor));
        const payload = {
          floor: messageId,
          side: prepared.floor.side,
          depth: analysis?.depth ?? 'annotations',
          sentences: prepared.segments.map(segment => ({
            id: segment.id, type: segment.type, speaker: segment.speaker, speakerSource: segment.speakerSource ?? null, lang: segment.lang, text: segment.text,
            emotion: segment.emotion, intensity: segment.intensity, voice: segment.voice ?? null,
            fish: ttsProviderFor().sentenceText({ segment, voiceId: '', console: consoleFor(segment) }, ttsSettings()),
          })),
        };
        await copyText(JSON.stringify(payload, null, 2));
        toast('success', `第 ${messageId} 楼的分析已复制（${payload.sentences.length} 句）。`);
      } else if (action === 'tts-reanalyze' || action === 'tts-refine-sentence') {
        const messageId = inspecting?.messageId ?? readingTarget().messageId ?? latestAssistantMessageId(getContext());
        if (!Number.isInteger(messageId)) throw new Error('当前聊天里还没有 AI 楼层。');
        const side = inspecting?.side ?? null;
        // Whichever button was pressed, the sentence the reader has open is one they can ask about.
        const sentenceId = inspecting?.messageId === messageId ? inspecting?.utteranceId ?? null : null;
        const prepared = await ttsPrepared(messageId, side);
        // Nothing to build on: a floor nobody has analysed just gets its first pass. Anything already
        // labelled by the model or by the translation's own skeleton can be corrected; the text's own
        // reading of who speaks is not an analysis.
        // In the plain reading only the model's own analysis counts: the translation's marks are not what
        // the reader is asking to redo, they are asking for the model's word on this floor.
        const plainMode = ttsSettings().mode === 'off';
        const analysed = runtime.tts.analysis.has(ttsLabelKey(prepared.floor))
          || (!plainMode && prepared.segments.some(segment => segment.emotion || ['hint', 'model'].includes(segment.speakerSource)));
        let answer = { choice: 'fresh', scope: 'floor', feedback: '' };
        if (analysed || sentenceId !== null) {
          const sentence = sentenceId === null ? null : prepared.segments.find(segment => segment.id === sentenceId) ?? null;
          answer = await askTtsRefine({ messageId, sentence });
        }
        if (answer.choice === 'cancel') return;
        button.textContent = '分析中…';
        if (answer.choice === 'refine') {
          const result = await refineTtsAnalysis(messageId, { side, utteranceId: answer.scope === 'sentence' ? sentenceId : null, feedback: answer.feedback });
          toast(result.remake?.failed ? 'warning' : 'success', `改了 ${result.changed} 句，${result.kept} 句保持原样；${describeTtsRemake(result.remake)}。`);
        } else {
          const done = await reanalyzeTtsFloor(messageId, side);
          const audio = `，${describeTtsRemake(done.remake)}`;
          toast(done.remake?.failed ? 'warning' : 'success', ttsSettings().mode === 'off'
            ? `第 ${messageId} 楼简单分析完了，这一楼以后按分析结果读${audio}。`
            : `第 ${messageId} 楼重新分析完了${audio}。`);
        }
        if (inspecting?.messageId === messageId) await renderInspector(messageId, inspecting.utteranceId, { pinned: true, side: inspecting.side });
        sentencesSignature = '';
        void renderSentences({ force: true });
      } else if (action === 'mini-translate' || action === 'mini-repair') {
        if (!Number.isInteger(viewFloor)) throw new Error('当前聊天里还没有 AI 楼层。');
        await startTranslation(viewFloor, { force: false });
      } else if (action === 'mini-retranslate') {
        if (!Number.isInteger(viewFloor)) throw new Error('当前聊天里还没有 AI 楼层。');
        await startTranslation(viewFloor, { force: true });
      } else if (action === 'mini-stop') {
        for (const entry of runtime.inflight.values()) entry.controller.abort();
        toast('info', '已请求停止当前翻译。');
      } else if (action === 'mini-translate-all') {
        const floors = untranslatedFloors(getContext().chat, { limit: 20 }).filter(id => id !== viewFloor).reverse();
        let done = 0;
        for (const id of floors) {
          button.textContent = `翻译中 ${done + 1}/${floors.length}`;
          try {
            await startTranslation(id, { force: false, quiet: true });
            done += 1;
          } catch (error) {
            if (isAbortError(error)) break;
          }
        }
        toast(done === floors.length ? 'success' : 'warning', `翻了 ${done}/${floors.length} 楼。`);
      } else if (action === 'row-fix' || action === 'row-retry') {
        const id = Number(button.dataset.id);
        button.textContent = '翻译中…';
        editingRow = null;
        await startTranslation(viewFloor, { only: new Set([id]) });
      } else if (action === 'row-write') {
        const id = Number(button.dataset.id);
        const field = win.querySelector(`[data-jy-row-field="${id}"]`);
        button.textContent = '写回中…';
        await editTranslationSegment(viewFloor, id, field?.value ?? '');
        editingRow = null;
        toast('success', `第 ${id} 段已按你的写法写回。`);
      } else if (action === 'row-listen') {
        await listenRow(Number(button.dataset.id));
      } else if (action === 'log-copy') {
        await copyText(logReport());
        toast('success', `已复制 ${logShown.length} 条记录。`);
      } else if (action === 'log-copy-one') {
        await copyText(logDetail.dataset.entry ?? '');
        toast('success', '这条记录已复制。');
      } else if (action === 'log-repair') {
        const floor = Number(button.dataset.floor);
        closeLogDetail();
        viewFloor = floor;
        selectMiniTab('translate');
        await startTranslation(floor, { force: false });
      } else if (action === 'mini-scratch') {
        button.textContent = '翻译中…';
        const started = globalThis.performance.now();
        const controller = new AbortController();
        const key = `scratch:${started}`;
        runtime.inflight.set(key, { promise: Promise.resolve(), controller });
        try {
          const translated = await translateScratchText(input.value, runtime.settings, controller.signal);
          output.textContent = translated;
          const channel = getActiveChannel(runtime.settings);
          const seconds = ((globalThis.performance.now() - started) / 1000).toFixed(1);
          setText(win, '[data-jy-mini-meta]', `${seconds} 秒 · ${channel.model || '跟随酒馆'}`);
          resultBox.hidden = false;
          setScratchOpen(true);
        } finally {
          runtime.inflight.delete(key);
        }
      }
      if (['mini-translate', 'mini-repair', 'mini-retranslate', 'mini-stop', 'mini-translate-all', 'row-fix', 'row-retry', 'row-write', 'log-repair'].includes(action)) await renderFloor();
    } catch (error) {
      if (!isAbortError(error)) toast('error', safeError(error));
      if (['row-fix', 'row-retry', 'row-write'].includes(action)) await renderFloor();
    } finally {
      if (button.isConnected) {
        button.textContent = original;
        button.disabled = false;
      }
    }
  };

  bar.addEventListener('pointerdown', onPointerDown);
  win.addEventListener('click', onClick);
  input.addEventListener('keydown', onInputKeydown);
  input.addEventListener('input', onInput);
  scratch.addEventListener('toggle', onScratchToggle);
  scratchSummary.addEventListener('click', onSummaryClick);
  input.addEventListener('focus', () => setScratchOpen(true));
  document.addEventListener('keydown', onWindowKeydown, true);
  document.addEventListener('focusin', onOutsideFocus, true);
  channelSelect.addEventListener('change', onQuickChange);
  profileSelect.addEventListener('change', onQuickChange);
  tabs.addEventListener('click', onTabClick);
  tagBox.addEventListener('pointerdown', onTagPointerDown);
  tagBox.addEventListener('click', onTagClick);
  emotionPicker.addEventListener('change', onEmotionPick);
  fishInput.addEventListener('input', onFishInput);
  win.addEventListener('focusin', onFieldFocus);
  win.addEventListener('keydown', onCustomKey);
  globalThis.visualViewport?.addEventListener('resize', onViewport);
  speedInput.addEventListener('input', onFishInput);
  volumeInput.addEventListener('input', onFishInput);
  // Naming who speaks: saved as the reader's word on this sentence, then the sentence is made again in
  // that name's voice and played. The model hears nothing of it.
  speakerSelect?.addEventListener('change', async () => {
    if (!inspecting) return;
    const { messageId, utteranceId, side } = inspecting;
    const name = speakerSelect.value;
    speakerSelect.disabled = true;
    try {
      await saveTtsSpeaker(messageId, utteranceId, name, side);
      await renderInspector(messageId, utteranceId, { pinned: true, side });
      toast('success', name ? `这一句改成${name}说的了，按这个人的音色重做，没有重新分析。` : '这一句交回自动判断了。');
      void playTtsUtterance(messageId, utteranceId, side);
    } catch (error) {
      toast('error', safeError(error));
    } finally {
      speakerSelect.disabled = false;
    }
  });
  seekBar.addEventListener('pointerdown', onSeekDown);
  seekBar.addEventListener('pointermove', onSeekMove);
  seekBar.addEventListener('pointerup', onSeekUp);
  seekBar.addEventListener('pointercancel', onSeekUp);
  seekBar.addEventListener('keydown', onSeekKey);
  globalThis.addEventListener('pointermove', onPointerMove);
  globalThis.addEventListener('pointerup', finishPointer);
  globalThis.addEventListener('pointercancel', finishPointer);
  globalThis.addEventListener('resize', onResize);

  void renderFloor();
  renderTransport();
  renderPlaybar(runtime.tts.transport);

  runtime.mini = {
    host,
    close,
    syncQuickPickers: () => { syncQuickPickers(); void renderFloor(); },
    showReading,
    showFloor: messageId => {
      if (Number.isInteger(messageId)) viewFloor = messageId;
      selectMiniTab('translate');
      void renderFloor();
    },
    refresh: () => { void renderFloor(); },
    refreshCall: () => scheduleCall(callController().snapshot),
    // A new reply: the window moves onto it, unless something is being read or the reader chose a floor.
    followLatest: messageId => {
      if (!Number.isInteger(messageId) || messageId === viewFloor) return;
      if (chosenIn !== null && chosenIn === getCurrentChatId()) return;
      const transport = runtime.tts.transport;
      if (transport && ['loading', 'playing', 'paused'].includes(transport.state)) return;
      viewFloor = messageId;
      editingRow = null;
      void renderFloor();
    },
  };
  return runtime.mini;
}

// The reading panel, opened from a floor: on the sentence whose cue button was pressed, or on whatever
// is being read.
async function openTtsPanel(messageId, utteranceId = null, side = null) {
  if (runtime.miniOpening) return;
  runtime.miniOpening = true;
  try {
    const mini = await openMiniWindow();
    mini.showReading?.(messageId, utteranceId, side);
  } catch (error) {
    toast('error', safeError(error));
  } finally {
    runtime.miniOpening = false;
  }
}

function toggleMiniWindow() {
  // The stylesheet load makes opening async, so a second click must not race the first one open.
  if (runtime.miniOpening) return;
  if (runtime.mini?.host?.isConnected) {
    closeMiniWindow();
    return;
  }
  runtime.miniOpening = true;
  openMiniWindow()
    .catch(error => toast('error', safeError(error)))
    .finally(() => { runtime.miniOpening = false; });
}

function syncFloatingButton() {
  if (!runtime.initialized) return;
  ensureFloatingButton();
}

function scheduleEntries() {
  for (const delay of [0, 300, 1200]) {
    const timer = globalThis.setTimeout(() => {
      runtime.timers.delete(timer);
      ensureMenuEntry();
      ensureSettingsEntry();
      ensureFloatingButton();
      // #chat may not exist yet at activation; binding is idempotent and retried with the entries.
      bindTtsDom();
    }, delay);
    runtime.timers.add(timer);
  }
}

function bindEvent(eventType, handler) {
  if (!eventType) return;
  const context = getContext();
  if (typeof context.eventSource?.on !== 'function') return;
  context.eventSource.on(eventType, handler);
  runtime.eventBindings.push({ source: context.eventSource, eventType, handler });
}

/**
 * A reply the host rendered that no started generation accounts for, written down when automatic
 * translation is on: it is left untranslated, and 「有时候不自动翻译」 is only answerable from the log if
 * the log says which time and why. A greeting and a slash command's insert are no generation's reply
 * and pass without a word.
 */
function noteUntranslatedRender(messageId, type, pending) {
  if (!runtime.settings?.autoGeneration || ['first_message', 'command'].includes(type)) return;
  const message = getContext().chat?.[messageId];
  if (!message || message.is_user || message.is_system) return;
  const stopped = runtime.stoppedGeneration && Date.now() - runtime.stoppedGeneration.at < 10 * 60 * 1000 ? runtime.stoppedGeneration : null;
  runtime.stoppedGeneration = null;
  const why = stopped
    ? '这次生成是手动停下的，停下的回复不自动翻译，需要的话点翻译'
    : pending
      ? `酒馆报的生成类型对不上（开始时是 ${pending.type}，渲染时是 ${type ?? '空'}），没有自动翻译`
      : '没有看到这次回复的生成开始（可能是别的扩展或脚本写进来的），没有自动翻译';
  recordDiagnostic('info', 'translation.auto-skip', `第 ${messageId} 楼渲染完成，${why}。`, {
    floor: messageId, renderType: type ?? null, startedType: pending?.type ?? null, stopped: Boolean(stopped),
  });
}

// What a skipped automatic translation says in the log, by the reason the run gave.
const AUTO_SKIP_REASONS = Object.freeze({
  'already-translated': '这一楼已经翻译过了',
  'not-translatable': '不是可以翻译的 AI 回复',
  cancelled: '翻译被取消了（换了聊天、停用了扩展，或者同一楼开始了新的翻译）',
});

function scheduleAuto(messageId, reason) {
  const timer = globalThis.setTimeout(async () => {
    runtime.autoTimers.delete(timer);
    try {
      const settings = runtime.settings;
      if (reason === 'generation' && !settings.autoGeneration) return;
      if (reason === 'swipe' && !settings.autoSwipe) return;
      if (reason === 'edit' && !settings.autoEdit) return;
      recordDiagnostic('info', 'translation.auto', `第 ${messageId} 楼${reason === 'generation' ? '生成结束' : reason === 'swipe' ? '划动了' : '编辑过'}，自动翻译开始。`, { floor: Number(messageId), reason });
      const result = await startTranslation(Number(messageId), { force: reason === 'edit', quiet: true });
      if (result?.skipped) {
        recordDiagnostic('info', 'translation.auto', `第 ${messageId} 楼自动翻译没有进行：${AUTO_SKIP_REASONS[result.reason] ?? result.reason}。`, { floor: Number(messageId), reason, skipped: result.reason });
      }
    } catch (error) {
      if (isAbortError(error)) return;
      const message = safeError(error);
      const routine = /没有找到|正文标签|已经翻译|不是普通 AI 回复|没有可翻译的正文段落/.test(message);
      recordDiagnostic(routine ? 'info' : 'error', 'translation.auto', `第 ${messageId} 楼自动翻译${routine ? '没有进行' : '失败'}：${message}`, { floor: Number(messageId), reason });
      if (!routine) toast('error', message);
    }
  }, 0);
  runtime.autoTimers.add(timer);
}

function cancelPendingWork() {
  runtime.generationGate.clear();
  for (const timer of runtime.autoTimers) globalThis.clearTimeout(timer);
  runtime.autoTimers.clear();
  for (const entry of runtime.inflight.values()) entry.controller.abort();
  runtime.inflight.clear();
}


// Hosts older than the manifest hook never call generate_interceptor. The mirrored translations then
// stay in the prompt and the main model starts imitating them, which reads as the prose degrading.
function chatCarriesMirrorBlocks() {
  try {
    const chat = getContext().chat;
    if (!Array.isArray(chat)) return false;
    return chat.some(item => typeof item?.mes === 'string' && item.mes.includes(INVISIBLE_MARKER));
  } catch {
    return false;
  }
}

function verifyGenerationInterceptor() {
  if (runtime.interceptorSeen || runtime.interceptorWarned) return;
  // The prompt-event fallback already removed the mirrors, so nothing leaked and nothing to report.
  if (runtime.promptFallbackStrips > 0) return;
  if (!chatCarriesMirrorBlocks()) return;
  runtime.interceptorWarned = true;
  const message = '当前酒馆既没有调用生成拦截器，也没有可用的提示词事件，聊天中的译文会随提示词进入主模型，正文质量会下降。建议升级酒馆，或先关闭「主回复完成后翻译」。';
  recordDiagnostic('error', 'host.interceptor-missing', '宿主未调用生成拦截器，且提示词事件回退也未生效，译文正在泄漏进主模型上下文。', {
    promptEvents: PROMPT_EVENT_NAMES,
  });
  toast('error', message);
  updateTask({ status: 'error', title: '译文可能进入主模型', message, progress: 0 });
}


// Second line of defence for hosts that never call generate_interceptor. These prompt events are much
// older than the manifest hook, and they hand over the outgoing prompt precisely so extensions can
// edit it. Only blocks carrying our own boundaries are removed, so nothing else can be damaged.
const PROMPT_EVENT_NAMES = Object.freeze([
  'CHAT_COMPLETION_PROMPT_READY',
  'GENERATE_BEFORE_COMBINE_PROMPTS',
  'GENERATE_AFTER_COMBINE_PROMPTS',
]);

function stripPromptPayload(payload) {
  if (!payload || typeof payload !== 'object') return 0;
  let stripped = 0;
  const entries = Array.isArray(payload.chat) ? payload.chat : [];
  for (const item of entries) {
    if (typeof item?.content !== 'string') continue;
    // Prompt view, matching the generation interceptor: replace-tag floors keep their visible
    // translation instead of silently reverting to the original on this fallback path only.
    const clean = stripGeneratedTranslationLines(item.content, undefined, 'prompt');
    if (clean !== item.content) {
      item.content = clean;
      stripped += 1;
    }
  }
  if (typeof payload.prompt === 'string') {
    const clean = stripGeneratedTranslationLines(payload.prompt, undefined, 'prompt');
    if (clean !== payload.prompt) {
      payload.prompt = clean;
      stripped += 1;
    }
  }
  return stripped;
}

function registerPromptFallback(eventTypes) {
  for (const name of PROMPT_EVENT_NAMES) {
    const eventType = eventTypes?.[name];
    if (!eventType) continue;
    bindEvent(eventType, payload => {
      const stripped = stripPromptPayload(payload);
      if (!stripped) return;
      runtime.promptFallbackStrips += stripped;
      if (runtime.promptFallbackStrips === stripped) {
        recordDiagnostic('warn', 'host.prompt-fallback', '宿主没有调用生成拦截器，已改用提示词事件移除译文镜像块。', {
          event: name,
          stripped,
        });
      }
    });
  }
}

function registerRuntimeEvents() {
  const eventTypes = getContext().eventTypes ?? {};
  registerPromptFallback(eventTypes);
  bindEvent(eventTypes.GENERATION_STARTED, (type, _options, dryRun) => {
    if (!dryRun && !['quiet', 'impersonate'].includes(type)) runtime.mainGenerationActive = true;
    if (runtime.generationGate.begin(getCurrentChatId(), type, dryRun)) runtime.generationSerial += 1;
  });
  bindEvent(eventTypes.CHARACTER_MESSAGE_RENDERED, (messageId, type) => {
    const pending = runtime.generationGate.peek();
    if (runtime.generationGate.consume(getCurrentChatId(), type)) {
      runtime.mainGenerationActive = false;
      runtime.stoppedGeneration = null;
      // A reply just written, and a whole one: a continue adds to a floor already heard.
      if (!['continue', 'appendFinal'].includes(type)) runtime.tts.fresh.add(Number(messageId));
      runtime.mini?.followLatest?.(Number(messageId));
      verifyGenerationInterceptor();
      scheduleAuto(messageId, 'generation');
      return;
    }
    noteUntranslatedRender(Number(messageId), type, pending);
  });
  bindEvent(eventTypes.GENERATION_STOPPED, () => {
    // Stopped by hand: the reader wants quiet, not the rest of the reading.
    if (runtime.tts.stream?.kind === 'reply' && !runtime.tts.stream.done) runtime.tts.stream.cancel();
    runtime.mainGenerationActive = false;
    // The floor being written was left without buttons while it streamed; a stopped reply may not be
    // rendered again, so it gets them now.
    const latest = latestAssistantMessageId(getContext());
    if (Number.isInteger(latest)) scheduleTtsDecorate(latest, { delay: 400 });
    // A stopped reply is not translated on its own (the reader may still continue or redo it); the
    // render that follows says so in the log rather than nowhere.
    const pending = runtime.generationGate.peek();
    if (pending) runtime.stoppedGeneration = { ...pending, at: Date.now() };
    runtime.generationGate.clear();
  });
  bindEvent(eventTypes.GENERATION_STARTED, (type, _options, dryRun) => {
    if (dryRun || ['quiet', 'impersonate'].includes(type)) return;
    runtime.tts.generationId += 1;
    runtime.tts.generationStartedAt = globalThis.performance?.now?.() ?? Date.now();
    // A new reply is being written: a reading of the one before it reads what it had and ends.
    if (runtime.tts.stream?.kind === 'reply' && !runtime.tts.stream.done) runtime.tts.stream.end();
  });
  // 边写边读: every streamed chunk is stored, and read a stretch at a time from a timer — the host
  // awaits this listener inside its stream loop, so nothing here may take time.
  if (eventTypes.STREAM_TOKEN_RECEIVED) bindEvent(eventTypes.STREAM_TOKEN_RECEIVED, text => onReplyStreaming(text));
  bindEvent(eventTypes.GENERATION_ENDED, () => {
    // However the reply ended, what was written of it is read to its end.
    if (runtime.tts.stream?.kind === 'reply' && !runtime.tts.stream.done) runtime.tts.stream.end();
    // A reply that is rendered takes the gate within a moment of this. One that is still waiting a few
    // seconds later never came — an error, an empty answer — and says so in the log instead of nowhere.
    const serial = runtime.generationSerial;
    const waiting = runtime.generationGate.peek();
    if (waiting) {
      const timer = globalThis.setTimeout(() => {
        runtime.timers.delete(timer);
        const still = runtime.generationGate.peek();
        if (!still || runtime.generationSerial !== serial || still.chatId !== waiting.chatId || still.type !== waiting.type) return;
        runtime.generationGate.clear();
        recordDiagnostic('info', 'translation.auto-skip', `这次生成（${waiting.type}）没有产出回复，可能报错了或被过滤，没有可自动翻译的内容。`, { startedType: waiting.type });
      }, 3000);
      runtime.timers.add(timer);
    }
    if (!runtime.mainGenerationActive) return;
    runtime.mainGenerationActive = false;
    const latest = latestAssistantMessageId(getContext());
    if (Number.isInteger(latest)) scheduleTtsDecorate(latest, { delay: 400 });
  });
  bindEvent(eventTypes.MESSAGE_SWIPED, messageId => {
    // A swipe past the last alternative is a reply about to be generated: the text on the floor is still
    // the old one. The reply is translated when it is rendered; if generating fails, the host puts the
    // floor back on an alternative that was translated already.
    const message = getContext().chat?.[Number(messageId)];
    if (message && Number(message.swipe_id ?? 0) >= (Array.isArray(message.swipes) ? message.swipes.length : 0)) return;
    scheduleAuto(messageId, 'swipe');
  });
  bindEvent(eventTypes.MESSAGE_EDITED, messageId => scheduleAuto(messageId, 'edit'));
  // Floor buttons follow every redraw the host announces; the observer in bindTtsDom catches the rest.
  // The generation finished: the floor is whole, and the analyses may read it.
  bindEvent(eventTypes.CHARACTER_MESSAGE_RENDERED, messageId => {
    scheduleTtsDecorate(Number(messageId));
    ttsFloorClosed(Number(messageId));
  });
  bindEvent(eventTypes.MESSAGE_UPDATED, messageId => {
    const id = Number(messageId);
    // A translation writes this floor paragraph by paragraph. Throwing the reading away on every
    // write aborted analyses and audio that had already been paid for, a dozen times per floor;
    // the appointment below waits for the writing to stop and then does it once.
    if (ttsFloorTranslating(id)) {
      ttsFloorClosed(id, { translated: true });
      return;
    }
    // The text changed under whatever was prepared or playing on this floor — unless it is the
    // original being read, and only a translation was written in beside it.
    void forgetChangedTtsItems(id);
    scheduleTtsDecorate(id, { force: true });
    ttsFloorClosed(id, { translated: true });
  });
  bindEvent(eventTypes.MESSAGE_SWIPED, messageId => {
    if (runtime.tts.transport?.messageId === Number(messageId)) stopTts(Number(messageId));
    forgetTtsItems(Number(messageId));
    // Another alternative is not a new reply; a swipe that generates one is announced as rendered.
    runtime.tts.fresh.delete(Number(messageId));
    runtime.tts.streamed.delete(Number(messageId));
    scheduleTtsDecorate(Number(messageId), { force: true, delay: 300 });
    ttsFloorClosed(Number(messageId), { reason: 'swipe' });
  });
  bindEvent(eventTypes.MESSAGE_EDITED, messageId => ttsFloorClosed(Number(messageId), { reason: 'edit' }));
  bindEvent(eventTypes.MESSAGE_DELETED, () => {
    // The host says how long the chat is now, not which floor went: a reading goes on when its floor
    // still reads the same where it was.
    void ttsReadingStands().then(stands => {
      if (!stands) stopTts();
    }).finally(() => scheduleTtsDecorateAll({ force: true, delay: 300 }));
  });
  bindEvent(eventTypes.MORE_MESSAGES_LOADED, () => scheduleTtsDecorateAll());
  // The readable-entry cache for the token-saving whitelist and the force-activation matcher.
  // SillyTavern emits this whenever it re-sorts lore (chat switch, editor change, every scan).
  if (eventTypes.WORLDINFO_ENTRIES_LOADED) {
    bindEvent(eventTypes.WORLDINFO_ENTRIES_LOADED, lore => {
      if (lore && Array.isArray(lore.globalLore)) runtime.wiEntries = lore;
    });
  }
  bindEvent(eventTypes.CHAT_CHANGED, () => {
    runtime.mainGenerationActive = false;
    runtime.call?.hangUp('换了聊天');
    runtime.stoppedGeneration = null;
    cancelPendingWork();
    scheduleEntries();
    // The speaker palette is per character card, so a different chat may need a different sheet.
    syncSpeakerStylesheet(runtime.settings);
    // So may the names the request for marks lists, and the quotation marks it asks for.
    syncSpeechPrompt();
    if (runtime.panel?.controller?.root) {
      refreshCurrentCard(runtime.panel.controller.root);
      // The voice table may be per chat; the page shows the one that belongs to the chat just opened.
      syncTtsFields(runtime.panel.controller.root, runtime.settings);
    }
    // Message ids restart in another chat; nothing playing or pending can carry over.
    stopTts();
    runtime.tts.ranges.clear();
    runtime.tts.status.clear();
    runtime.tts.floors.clear();
    runtime.tts.recordings.clear();
    runtime.tts.overrides.clear();
    runtime.tts.preview = null;
    runtime.tts.inspect = null;
    runtime.tts.mesSeen.clear();
    runtime.tts.fresh.clear();
    runtime.tts.streamed.clear();
    scheduleTtsDecorateAll();
  });
}

function cleanupRuntime() {
  runtime.processingRevision += 1;
  runtime.call?.hangUp('镜译停用了');
  runtime.epoch += 1;
  cancelPendingWork();
  for (const binding of runtime.eventBindings.splice(0)) {
    binding.source.removeListener(binding.eventType, binding.handler);
  }
  for (const timer of runtime.timers) globalThis.clearTimeout(timer);
  runtime.timers.clear();
  runtime.menuCleanup?.();
  runtime.menuCleanup = null;
  runtime.settingsCleanup?.();
  runtime.settingsCleanup = null;
  runtime.floatingCleanup?.();
  runtime.floatingCleanup = null;
  closeControlCenter();
  closeMiniWindow();
  cleanupTts();
  clearSpeechPrompt();
  if (typeof document !== 'undefined') document.getElementById(SPEAKER_STYLE_ID)?.remove();
  runtime.subscribers.clear();
  runtime.diagnosticSubscribers.clear();
  runtime.initialized = false;
}

export function interceptGeneration(chat, _contextSize, _abort, type) {
  runtime.interceptorSeen = true;
  try {
    syncSpeechPrompt(type);
  } catch (error) {
    recordDiagnostic('warn', 'tts.speech-prompt', `说话人标记要求没能放进这次生成：${safeError(error)}`);
  }
  // The host scans worldinfo AFTER interceptors, using the stripped text, so translated names can
  // never fire entries on their own. Force-activate the entries our translations DO match so the
  // main prompt keeps reacting to translated terms; the one-shot list clears after each scan.
  //
  // Side generations (summaries, impersonation, /gen) are skipped: the host clears the pending list
  // during its own scan, so an activation queued for a run that never scans would surface in the
  // next real reply as an entry nothing in that reply asked for.
  const sideGeneration = typeof type === 'string' && ['quiet', 'impersonate'].includes(type);
  const translations = Array.isArray(chat) && !sideGeneration
    ? chat.map(item => extractTranslationBlockText(item?.mes)).filter(Boolean).join('\n')
    : '';
  if (translations) forceActivateWorldInfoFromText(translations);
  return interceptGenerationChat(chat);
}

// A close-enough rebuild of the host's own key matcher. Forcing an entry the host would never have
// activated is worse than missing one, so regex keys, case sensitivity and whole-word matching are
// honoured, and entries whose activation depends on secondary logic are left to the host entirely.
function worldInfoKeyMatches(key, text, entry) {
  const raw = String(key ?? '').trim();
  if (!raw) return false;
  const literal = raw.match(/^\/(.+)\/([dgimsuvy]*)$/s);
  if (literal) {
    try {
      return new RegExp(literal[1], literal[2].replace(/[gy]/g, '')).test(text);
    } catch {
      return false; // An invalid pattern is the host's problem to report, not ours to guess around.
    }
  }
  const caseSensitive = entry?.caseSensitive === true;
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? raw : raw.toLowerCase();
  if (entry?.matchWholeWords === true && /^\w[\w\s]*\w$|^\w$/.test(needle)) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, caseSensitive ? '' : 'i').test(haystack);
  }
  return haystack.includes(needle);
}

function forceActivateWorldInfoFromText(text) {
  const entries = readableWorldInfoEntries();
  if (!entries.length) return;
  const context = getContext();
  const eventType = context.eventTypes?.WORLDINFO_FORCE_ACTIVATE;
  if (!eventType || typeof context.eventSource?.emit !== 'function') return;
  const hits = [];
  let skippedSelective = 0;
  for (const entry of entries) {
    if (entry?.disable === true || entry?.constant === true || entry?.vectorized === true) continue;
    if (entry?.selective === true && (Array.isArray(entry.keysecondary) ? entry.keysecondary.filter(Boolean).length : 0)) {
      skippedSelective += 1;
      continue;
    }
    const keys = Array.isArray(entry.key) ? entry.key.flat() : [];
    if (keys.some(key => worldInfoKeyMatches(key, text, entry))) {
      hits.push({ world: entry.world, uid: entry.uid });
    }
  }
  if (skippedSelective) {
    recordDiagnostic('info', 'worldinfo.selective-skipped', '带有次要关键词的条目交给酒馆自行判定，译名不强制激活。', {
      skipped: skippedSelective,
    });
  }
  if (hits.length) {
    try { context.eventSource.emit(eventType, hits); } catch (error) {
      console.warn(`[${APP_NAME}] 译名强制激活世界书条目失败。`, error);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The public interface: another extension hands over text and a character, and hears it read.
//
// Everything the reader already configured applies — which voice that character has, their console,
// the punctuation tags, the audio settings, their own Fish key and its quota. The caller never sees
// the key, never touches the chat, and pays nothing of its own. Audio is cached by content, so the
// same greeting said twice is asked for once.
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// Reading while it is written (边写边读). A session takes text as it grows — the main model's reply as it
// streams, or text a caller hands over — cuts off each stretch the moment it is safe to read
// (tts-stream.js), asks Fish for it at once, a few stretches ahead, and plays them in order. Who speaks
// is read the plain way: the story's own speaker marks first, then the text itself; nobody is asked.
// Nothing is stored with the floor: this is the live reading, not the floor's recording.
// ---------------------------------------------------------------------------------------------

// How many stretches before the new one the speaker reading sees: enough to know who was talking.
const STREAM_CONTEXT_LINES = 6;

/** A reply's lines as far as it is written: the body the translator is sent, speaker marks as markers. */
function streamReplyLines(raw, settings = runtime.settings) {
  const readable = readableStreamText(raw, { bodyTags: settings.bodyTags, excludedTags: settings.excludedTags });
  const extraction = extractAllRegions(readable, settings);
  const options = {
    segmentPrefix: settings.segmentPrefix,
    segmentSuffix: settings.segmentSuffix,
    translationPrefix: settings.translationPrefix,
    translationSuffix: settings.translationSuffix,
    paragraphPerLine: settings.paragraphPerLine,
    excludedTags: settings.excludedTags,
    preserveLineRules: settings.preserveLineRules,
  };
  const lines = [];
  let nextId = 1;
  for (const region of extraction.regions) {
    const segmented = segmentSource(region.inner, { ...options, startId: nextId });
    for (const segment of segmented.segments) {
      const marked = segmented.speech?.get(segment.id);
      lines.push(marked ? { lineId: segment.id, text: marked.text, marks: marked.marks } : { lineId: segment.id, text: segment.text });
    }
    nextId += segmented.segments.length;
  }
  // A reply that has just started a new paragraph has finished the one before it.
  if (/\n\s*$/.test(String(raw ?? ''))) lines.push({ lineId: nextId, text: '' });
  return lines;
}

/** Text a caller hands over: a line per line, nothing extracted. */
function streamPlainLines(raw) {
  return String(raw ?? '').split('\n').map((text, index) => ({ lineId: index + 1, text }));
}

/** The plain reading of text being streamed: the story's marks, then who speaks by the text itself. */
function streamSegments(floor, utterances, settings) {
  const tts = ttsSettings(settings);
  const tagged = ttsTagReading(floor, utterances, tts);
  const labels = new Map();
  for (const [id, label] of tagged.labels) if (label.emotion) labels.set(id, { emotion: label.emotion });
  const host = getContext();
  const resolved = resolveSpeakers(utterances, {
    cast: ttsCast(settings), hints: new Map(), manual: new Map(), tagged: speakerHints(tagged.labels),
    protagonists: { character: host.name2 ?? '', user: host.name1 ?? '' },
  });
  return buildSegments(utterances, pinSpeakers(labels, resolved, { fallback: 'hint' }), {
    knownNames: ttsKnownNames(settings), voices: tagged.voices.size ? new Map(tagged.voices) : null,
  });
}

/** How long each first thing took, for the log line a session leaves. */
function streamTimingText(times) {
  const names = [['firstText', '首字'], ['firstPiece', '首句切出'], ['firstRequest', '请求发出'], ['firstAudio', '首段音频到齐'], ['firstSound', '出声']];
  return names.filter(([key]) => times[key] !== undefined).map(([key, label]) => `${label} ${(times[key] / 1000).toFixed(2)} 秒`).join('，') || '没有读出任何一段';
}

/**
 * One reading of text still being written. `toLines` turns the text so far into lines; `speaker`, when
 * a caller names one, speaks all of it in that character's voice. The session object: `set` (the whole
 * text so far), `push` (the whole so far, or what came next), `end`, `cancel`, `pause`, `resume`,
 * `on('state')`, `state`, `done`, and `finished` (a promise).
 */
function createTtsStream({ kind, messageId = null, toLines, speaker = '', lang = '', startedAt = null }) {
  const settings = runtime.settings;
  const tts = ttsSettings(settings);
  requireFishKey(tts);
  const provider = ttsProviderFor(settings);
  const controller = new AbortController();
  const lanes = Math.max(1, Math.min(3, Number(tts.fish.concurrency) || 1));
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  const origin = startedAt ?? now();
  const times = {};
  const mark = name => {
    if (times[name] === undefined) times[name] = Math.round(now() - origin);
  };
  const context = getContext();
  const message = Number.isInteger(messageId) ? context.chat?.[messageId] : null;
  const chatId = Number.isInteger(messageId) ? getCurrentChatId(context) : API_FLOOR_PREFIX;
  const swipeId = Number(message?.swipe_id ?? 0);
  const floorId = Number.isInteger(messageId) ? `${chatId}|${messageId}|${swipeId}|stream` : `${API_FLOOR_PREFIX}|stream`;
  const cut = {};
  const seen = [];
  const queue = [];
  const waiting = [];
  const listeners = new Set();
  let raw = '';
  let final = false;
  let timer = null;
  let running = 0;
  let playing = false;
  let paused = false;
  let audioPaused = false;
  let blocked = false;
  let done = false;
  let pieces = 0;
  let requests = 0;
  let played = 0;
  let failures = 0;
  let settle = null;
  const finished = new Promise(resolve => { settle = resolve; });
  const state = () => (done ? 'idle' : paused ? 'paused' : playing ? 'speaking' : 'buffering');
  const announce = () => {
    const detail = { state: state(), blocked, pieces, played, at: Math.round(now() - origin) };
    for (const listener of listeners) {
      try { listener(detail); } catch { /* a caller's own bug is not ours */ }
    }
    if (Number.isInteger(messageId)) {
      const current = state();
      setTtsStatus(messageId, current === 'idle' ? '' : current === 'paused' ? '边写边读 · 已暂停' : current === 'speaking' ? '边写边读' : '边写边读 · 等第一句', current === 'idle' ? 'idle' : current === 'paused' ? 'paused' : current === 'speaking' ? 'playing' : 'busy');
    } else {
      notifyTtsPanels();
    }
  };
  // A few stretches are asked for ahead of the one being heard, never more than the lanes allow.
  const lane = task => new Promise((resolve, reject) => {
    const run = () => {
      running += 1;
      task().then(resolve, reject).finally(() => {
        running -= 1;
        waiting.shift()?.();
      });
    };
    if (running < lanes) run();
    else waiting.push(run);
  });
  const audioFor = async (floor, lineId) => {
    const utterances = ttsUtterances(floor, settings);
    const own = utterances.filter(item => item.lineId === lineId);
    if (!own.length) return [];
    const segments = speaker
      ? buildSegments(own, apiLabels(own, { speaker, lang }), { knownNames: ttsKnownNames(settings) })
      : streamSegments(floor, utterances, settings).filter(segment => segment.lineId === lineId);
    const { items } = await ttsItemsFor(floor, segments, settings, speaker ? { range: 'all' } : {});
    if (!items.length) return [];
    const blobs = [];
    for (const part of provider.parts(items, tts)) {
      if (controller.signal.aborted) break;
      const { body } = provider.payload(part, tts);
      mark('firstRequest');
      const heard = await streamFishTimestamps(body, tts.fish, controller.signal, { onAttempt: () => { requests += 1; } });
      blobs.push(new Blob(heard.audio.map(base64ToBytes), { type: provider.mime(tts.fish.format) }));
      mark('firstAudio');
    }
    return blobs;
  };
  const enqueue = piece => {
    const read = piece.marks?.length
      ? readSpeechLine({ text: piece.text, marks: piece.marks }, { quotePairs: tts.quotePairs })
      : { text: plainLineText(piece.text), spans: [] };
    if (!read.text.trim()) return;
    const index = pieces;
    pieces += 1;
    mark('firstPiece');
    const line = { lineId: 100000 + index, text: read.text, ...(read.spans.length ? { speech: read.spans } : {}) };
    const floor = {
      chatId, messageId: messageId ?? -1, swipeId, side: 'source', floorId, version: String(index),
      lines: [...seen.slice(-STREAM_CONTEXT_LINES), line],
      annotations: new Map(), references: null, sources: null, source: 'stream', complete: true,
    };
    seen.push(line);
    const job = { index, at: 0, promise: lane(() => audioFor(floor, line.lineId)) };
    job.promise.catch(() => {});
    queue.push(job);
    void pump();
  };
  const finish = (cancelled = false) => {
    if (done) return;
    done = true;
    playing = false;
    paused = false;
    if (runtime.tts.stream === session) runtime.tts.stream = null;
    announce();
    recordDiagnostic('info', 'tts.stream', `${Number.isInteger(messageId) ? `第 ${messageId} 楼` : '外部接口'}边写边读${cancelled ? '停下了' : '读完了'}：${streamTimingText(times)}；切出 ${pieces} 段，读出 ${played} 段，向 Fish 请求 ${requests} 次${failures ? `，${failures} 段没读出来` : ''}。`, {
      floor: messageId, kind, times, pieces, played, requests, failures, cancelled, lanes, model: tts.fish.model,
    }, '', Number.isInteger(messageId) ? { floor: messageId } : {});
    settle({ cancelled, pieces, played, requests, times: { ...times } });
  };
  const pump = async () => {
    if (playing || paused || done) return;
    const job = queue[0];
    if (!job) {
      if (final && timer === null) finish();
      return;
    }
    playing = true;
    announce();
    let blobs = [];
    try {
      blobs = await job.promise;
    } catch (error) {
      if (!isAbortError(error)) {
        failures += 1;
        recordDiagnostic('warn', 'tts.stream', `边写边读有一段没读出来：${safeError(error)}`, { floor: messageId, piece: job.index }, '', Number.isInteger(messageId) ? { floor: messageId } : {});
      }
    }
    for (let at = job.at; at < blobs.length; at += 1) {
      if (done) return;
      if (paused) {
        job.at = at;
        playing = false;
        announce();
        return;
      }
      const url = URL.createObjectURL(blobs[at]);
      mark('firstSound');
      const outcome = await playTtsAudio(url);
      URL.revokeObjectURL(url);
      if (done) return;
      if (outcome === 'blocked') {
        // A page nobody has touched may not start sound on its own: the reading waits here for a tap.
        job.at = at;
        blocked = true;
        paused = true;
        playing = false;
        announce();
        toast('info', callActive() ? '浏览器要先点一下才肯出声：点通话页的「继续」。' : '浏览器要先点一下才肯出声：点播放键就开始读。');
        return;
      }
      if (outcome === 'stopped') {
        finish(true);
        return;
      }
      if (outcome === 'error') failures += 1;
      else played += 1;
    }
    queue.shift();
    playing = false;
    announce();
    void pump();
  };
  const process = () => {
    timer = null;
    if (done) return;
    let lines;
    try {
      lines = toLines(raw);
    } catch {
      return;
    }
    for (const piece of takeStreamPieces(lines, cut, { final, quotePairs: tts.quotePairs })) enqueue(piece);
    if (final) void pump();
  };
  const schedule = () => {
    if (timer === null && !done) timer = globalThis.setTimeout(process, 60);
  };
  const session = {
    kind,
    messageId,
    finished,
    get done() { return done; },
    get state() { return state(); },
    set(text) {
      if (done || final) return;
      raw = String(text ?? '');
      if (raw) mark('firstText');
      schedule();
    },
    push(text) {
      if (done || final) return;
      raw = mergeStreamText(raw, text);
      if (raw) mark('firstText');
      schedule();
    },
    end() {
      if (done || final) return;
      final = true;
      if (timer !== null) globalThis.clearTimeout(timer);
      timer = null;
      process();
    },
    cancel() {
      if (done) return;
      controller.abort();
      if (timer !== null) globalThis.clearTimeout(timer);
      timer = null;
      queue.length = 0;
      waiting.length = 0;
      if (playing || audioPaused) stopTtsPlayback();
      finish(true);
    },
    pause() {
      if (done || paused) return;
      paused = true;
      if (playing) {
        runtime.tts.player?.audio.pause();
        audioPaused = true;
      }
      announce();
    },
    resume() {
      if (done || !paused) return;
      paused = false;
      if (blocked) {
        blocked = false;
        announce();
        void pump();
        return;
      }
      if (audioPaused) {
        audioPaused = false;
        Promise.resolve(runtime.tts.player?.audio.play()).catch(() => {});
        announce();
        return;
      }
      announce();
      void pump();
    },
    on(event, listener) {
      if (event !== 'state' || typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  runtime.tts.stream = session;
  announce();
  return session;
}

// ---------------------------------------------------------------------------------------------
// 语音输入（测试版）. Speech to text for a caller that holds a talk button: the browser's own recogniser,
// or a recording sent to the OpenAI-compatible transcription endpoint the reader chose. Either way the
// caller starts it, then stops it and gets the words.
// ---------------------------------------------------------------------------------------------

const STT_PRESETS = Object.freeze({
  siliconflow: Object.freeze({ url: 'https://api.siliconflow.cn/v1/audio/transcriptions', model: 'FunAudioLLM/SenseVoiceSmall' }),
  groq: Object.freeze({ url: 'https://api.groq.com/openai/v1/audio/transcriptions', model: 'whisper-large-v3-turbo' }),
  openai: Object.freeze({ url: 'https://api.openai.com/v1/audio/transcriptions', model: 'gpt-4o-mini-transcribe' }),
});
// What the browser's recogniser expects for the short language names the reader writes.
const STT_BROWSER_LANGS = Object.freeze({ zh: 'zh-CN', ja: 'ja-JP', en: 'en-US', ko: 'ko-KR', yue: 'zh-HK' });

/** Whether speech can be taken now, and in words the reader can act on when it cannot. */
function sttAvailability(tts = ttsSettings()) {
  if (globalThis.isSecureContext === false) return { available: false, reason: '麦克风只能在 https 或本机地址（localhost、127.0.0.1）下打开。' };
  if (tts.sttProvider === 'browser') {
    const Recognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
    return Recognition ? { available: true, reason: '' } : { available: false, reason: '这个浏览器没有自带语音识别，换成「按住说话，云端转写」。' };
  }
  if (!globalThis.navigator?.mediaDevices?.getUserMedia || typeof globalThis.MediaRecorder !== 'function') return { available: false, reason: '这个浏览器不能录音。' };
  if (!tts.sttUrl) return { available: false, reason: '还没填转写地址（朗读页「06 实时通话」）。' };
  if (!tts.sttApiKey) return { available: false, reason: '还没填转写 Key（朗读页「06 实时通话」）。' };
  return { available: true, reason: '' };
}

/** Starts listening; resolves once the microphone is open, with stop() for the words and cancel(). */
async function startSpeechInput({ lang = '', onPartial = null, signal = null } = {}) {
  const tts = ttsSettings();
  const ready = sttAvailability(tts);
  if (!ready.available) throw new Error(ready.reason);
  const language = String(lang || tts.sttLang || '').trim();
  return tts.sttProvider === 'browser' ? startBrowserSpeech(language, onPartial) : startCloudSpeech(language, tts, signal);
}

function startBrowserSpeech(lang, onPartial) {
  const Recognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
  const recognition = new Recognition();
  recognition.lang = STT_BROWSER_LANGS[lang] ?? (lang || 'zh-CN');
  recognition.continuous = true;
  recognition.interimResults = true;
  let heard = '';
  let failure = null;
  let finish = null;
  const over = new Promise(resolve => { finish = resolve; });
  const began = Date.now();
  recognition.onresult = event => {
    let text = '';
    for (const result of event.results) text += result[0]?.transcript ?? '';
    heard = text;
    onPartial?.(heard);
  };
  recognition.onend = () => finish();
  return new Promise((resolve, reject) => {
    let open = false;
    recognition.onerror = event => {
      if (['no-speech', 'aborted'].includes(event.error)) return;
      failure = new Error(event.error === 'not-allowed' ? '浏览器没有给麦克风权限。' : `浏览器语音识别出错：${event.error}`);
      if (!open) reject(failure);
    };
    recognition.onstart = () => {
      open = true;
      resolve({
        async stop() {
          recognition.stop();
          await over;
          if (failure) throw failure;
          recordDiagnostic('info', 'stt', `语音输入（浏览器识别）：说了 ${((Date.now() - began) / 1000).toFixed(1)} 秒，${heard.trim().length} 字。`);
          return heard.trim();
        },
        cancel() {
          recognition.abort();
        },
      });
    };
    try {
      recognition.start();
    } catch (error) {
      reject(error);
    }
  });
}

async function startCloudSpeech(lang, tts, signal) {
  let stream;
  try {
    stream = await globalThis.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (error) {
    throw new Error(error?.name === 'NotAllowedError' ? '浏览器没有给麦克风权限。' : `打不开麦克风：${safeError(error)}`);
  }
  // What this browser can record: iPhones write mp4, most others webm.
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(candidate => globalThis.MediaRecorder.isTypeSupported?.(candidate)) ?? '';
  const recorder = new globalThis.MediaRecorder(stream, type ? { mimeType: type } : {});
  const chunks = [];
  recorder.ondataavailable = event => {
    if (event.data?.size) chunks.push(event.data);
  };
  const stopped = new Promise(resolve => { recorder.onstop = resolve; });
  const release = () => stream.getTracks().forEach(track => track.stop());
  const began = Date.now();
  let cancelled = false;
  recorder.start();
  return {
    async stop() {
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      release();
      if (cancelled) return '';
      const spoke = Date.now() - began;
      const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' });
      if (blob.size < 800) return '';
      const sent = Date.now();
      const text = await transcribeSpeech(blob, lang, tts, signal);
      recordDiagnostic('info', 'stt', `语音输入（${tts.sttModel}）：说了 ${(spoke / 1000).toFixed(1)} 秒，转写用了 ${((Date.now() - sent) / 1000).toFixed(1)} 秒，${text.length} 字。`, { model: tts.sttModel, bytes: blob.size, type: blob.type });
      return text;
    },
    cancel() {
      cancelled = true;
      if (recorder.state !== 'inactive') recorder.stop();
      release();
    },
  };
}

async function transcribeSpeech(blob, lang, tts, signal) {
  const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  const form = new FormData();
  form.append('file', blob, `speech.${extension}`);
  form.append('model', tts.sttModel);
  // SenseVoice tells the language itself; the Whisper family is told, so a short line is not guessed wrong.
  if (lang && tts.sttPreset !== 'siliconflow') form.append('language', lang);
  const response = await fetch(tts.sttUrl, { method: 'POST', headers: { Authorization: `Bearer ${tts.sttApiKey}` }, body: form, signal });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`转写失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 160)}` : ''}`);
  }
  const data = await response.json().catch(() => null);
  return String(data?.text ?? '').trim();
}

// ---------------------------------------------------------------------------------------------
// 通话请求（测试版）. A caller's own prompt, sent on the connection chosen for calls and streamed back as
// it is written, so the reading can start before the answer is finished.
// ---------------------------------------------------------------------------------------------

function callRequestSettings(settings = runtime.settings) {
  const tts = ttsSettings(settings);
  return tts.callChannelId ? onChannel(settings, tts.callChannelId) : ttsRequestSettings(settings);
}

async function apiLlmStream({ messages, signal = null, onText = null } = {}) {
  if (!Array.isArray(messages) || !messages.length) throw new Error('messages 不能为空。');
  const clean = messages.map(message => ({
    role: ['system', 'user', 'assistant'].includes(message?.role) ? message.role : 'user',
    content: String(message?.content ?? ''),
  }));
  const settings = callRequestSettings();
  const began = globalThis.performance?.now?.() ?? Date.now();
  let first = null;
  let last = '';
  const heard = text => {
    if (first === null && text) first = (globalThis.performance?.now?.() ?? Date.now()) - began;
    last = text;
    try { onText?.(text); } catch { /* a caller's own bug is not ours */ }
  };
  let text;
  if (settings.apiMode === 'independent') {
    const answer = await streamTranslationBatch(clean, settings, signal, heard);
    text = typeof answer === 'string' ? answer : last;
  } else {
    // The host's own connection answers in one piece: the caller hears it all at once.
    const raw = await requestSubModelRaw(clean, settings, signal);
    text = typeof raw === 'string' ? raw : String(raw?.content ?? raw?.choices?.[0]?.message?.content ?? '');
  }
  if (text !== last) heard(text);
  const total = (globalThis.performance?.now?.() ?? Date.now()) - began;
  recordDiagnostic('info', 'llm.stream', `通话请求（${channelLabel(settings, settings.apiMode === 'independent' ? settings.selectedChannelId : 'follow', { short: true })}）：首字 ${first === null ? '—' : `${(first / 1000).toFixed(2)} 秒`}，写完 ${(total / 1000).toFixed(2)} 秒，${text.length} 字${settings.apiMode === 'independent' ? '' : '（跟随酒馆，整段返回）'}。`, {
    streamed: settings.apiMode === 'independent', firstMs: first === null ? null : Math.round(first), totalMs: Math.round(total), characters: text.length,
  });
  return text;
}

// ---------------------------------------------------------------------------------------------
// 通话测试（测试版）. The floating window's call page: the current character on the phone, through the
// same interfaces a phone plugin gets (llm.stream, tts.stream, stt). The call itself is call.js.
// ---------------------------------------------------------------------------------------------

const CALL_RECENT_FLOORS = 6;
const CALL_CONTEXT_CAPS = Object.freeze({ character: 2500, persona: 1200, recent: 3000 });

function callHistory() {
  if (!runtime.callHistory) {
    let storage = null;
    try {
      storage = globalThis.localStorage ?? null;
    } catch {
      // Storage refused: the calls live in memory for this session.
    }
    runtime.callHistory = createCallHistory(storage);
  }
  return runtime.callHistory;
}

/** Who is on the line and what they know, read when the reader dials. */
async function describeCall() {
  apiTtsSettings();
  const context = getContext();
  if (context.groupId) throw new Error('群聊里还不能打，切到单人聊天再试。');
  const character = context.characters?.[Number(context.characterId)];
  if (!character) throw new Error('先打开一个角色的聊天，再拨打。');
  const settings = runtime.settings;
  const char = String(context.name2 || character.name || '').trim() || '对方';
  const user = String(context.name1 || '').trim() || '我';
  // The card and the last floors, cleaned the way the translation's context is, on the call's own
  // connection so that connection's token saving is the one that applies.
  const scoped = { ...callRequestSettings(settings), includeCharacterCard: true, includeWorldbook: false, includeRecentContext: true, contextMessages: CALL_RECENT_FLOORS };
  let gathered = { character: '', recent: '' };
  try {
    gathered = await collectTranslationContext({ context, messageId: context.chat?.length ?? 0 }, scoped);
  } catch (error) {
    recordDiagnostic('warn', 'call', `读取角色卡和最近剧情失败，这通电话只带名字：${safeError(error)}`);
  }
  let persona = String(context.powerUserSettings?.persona_description ?? '').trim();
  try {
    if (persona && typeof context.substituteParams === 'function') persona = String(context.substituteParams(persona)).trim();
  } catch {
    // Macros left as written.
  }
  const head = (text, limit) => (text.length > limit ? `${text.slice(0, limit)}\n…（已截断）` : text);
  // The latest floors matter most: a long stretch loses its beginning.
  const tail = (text, limit) => (text.length > limit ? `…（前面略）\n${text.slice(-limit)}` : text);
  return {
    char,
    user,
    characterKey: worldInfoCharacterKey(),
    chatId: getCurrentChatId(context),
    character: head(String(gathered.character ?? ''), CALL_CONTEXT_CAPS.character),
    persona: head(persona, CALL_CONTEXT_CAPS.persona),
    recent: tail(String(gathered.recent ?? ''), CALL_CONTEXT_CAPS.recent),
  };
}

function callController() {
  if (!runtime.call) {
    runtime.call = createCall({
      describe: describeCall,
      ask: options => apiLlmStream(options),
      speak: ({ speaker }) => apiStream({ speaker }),
      listen: options => startSpeechInput(options),
      history: callHistory(),
      log: (level, message) => recordDiagnostic(level, 'call', message),
    });
  }
  return runtime.call;
}

/** A call is on: the main chat's own readings keep out of its way. */
function callActive() {
  return Boolean(runtime.call && runtime.call.phase !== 'idle');
}

/** The control centre's reading page, open on the call settings. */
async function openCallSettings() {
  writeTtsFold('tts-call', true);
  const panel = await openControlCenter();
  const root = panel?.shadow;
  root?.querySelector('[data-jy-tab="tts"]')?.click();
  const fold = root?.querySelector('[data-jy-fold="tts-call"]');
  if (fold) {
    fold.open = true;
    globalThis.requestAnimationFrame?.(() => fold.scrollIntoView({ block: 'start' }));
  }
}

/** 边写边读 for the main model's reply: the first streamed text of a generation opens a reading of that floor. */
function onReplyStreaming(text) {
  if (!runtime.mainGenerationActive) return;
  // A call has the voice; the chat's reply is read the usual way once it is written.
  if (callActive()) return;
  const tts = ttsSettings();
  if (!tts.enabled || !tts.readWhileWriting) return;
  let session = runtime.tts.stream;
  if (!session || session.done || session.kind !== 'reply') {
    // One try per reply: a missing key is said once, not on every chunk.
    if (runtime.tts.streamRefused === runtime.tts.generationId) return;
    const context = getContext();
    const messageId = (context.chat?.length ?? 0) - 1;
    const message = context.chat?.[messageId];
    if (!message || message.is_user || message.is_system) return;
    try {
      stopTts();
      session = createTtsStream({ kind: 'reply', messageId, toLines: raw => streamReplyLines(raw), startedAt: runtime.tts.generationStartedAt });
    } catch (error) {
      runtime.tts.streamRefused = runtime.tts.generationId;
      recordDiagnostic('warn', 'tts.stream', `第 ${messageId} 楼没有边写边读：${safeError(error)}`, { floor: messageId });
      return;
    }
    runtime.tts.streamed.add(messageId);
    runtime.tts.fresh.delete(messageId);
  }
  session.set(text);
}

const PUBLIC_API_NAME = '__JINGYI__';
const PUBLIC_API_VERSION = 1;
// One synthetic floor id for everything the interface reads: a second call replaces the first.
const API_FLOOR_PREFIX = 'jy-api';

/** Text somebody handed us, shaped as a floor so the whole reading pipeline applies to it unchanged. */
async function apiFloor(text, { speaker = '', lang = '' } = {}) {
  const body = plainLineText(String(text ?? '')).trim();
  if (!body) throw new Error('没有可朗读的文字。');
  if (body.length > 20000) throw new Error('一次最多朗读 20000 字，请分几次。');
  const lines = body.split('\n').map(line => line.trim()).filter(Boolean).map((line, index) => ({ lineId: index + 1, text: line }));
  const version = await hashText(JSON.stringify([lines.map(line => line.text), speaker, lang]));
  return {
    chatId: API_FLOOR_PREFIX,
    messageId: -1,
    swipeId: 0,
    side: 'translation',
    floorId: `${API_FLOOR_PREFIX}|${version}`,
    version,
    lines,
    annotations: new Map(),
    references: null,
    sources: null,
    source: 'api',
    complete: true,
    apiSpeaker: speaker,
    apiLang: lang,
  };
}

/** Who says it: the character the caller named, in the voice the reader registered for them. */
function apiLabels(utterances, { speaker = '', lang = '' } = {}) {
  const named = String(speaker ?? '').trim();
  return new Map(utterances.map(item => [item.id, {
    type: named ? 'dialogue' : 'narration',
    ...(named ? { speaker: named } : {}),
    ...(lang ? { lang } : {}),
  }]));
}

function apiTtsSettings() {
  const settings = runtime.settings;
  const tts = ttsSettings(settings);
  if (!runtime.initialized) throw new Error('镜译还没启动完，稍后再试。');
  if (!tts.enabled) throw new Error('用户没有打开镜译的朗读功能。');
  if (!tts.fish.key) throw new Error('用户还没有在镜译里填 Fish Audio 的 API Key。');
  return { settings, tts };
}

/**
 * Read one piece of text aloud.
 *
 * Resolves as soon as the first paragraph is sounding, with a handle for the rest: what is playing,
 * pause, carry on, stop, and a promise for the end. A long story is cut at its paragraphs and each is
 * one Fish request, the next one made while this one plays.
 */
async function apiSpeak({ text, speaker = '', lang = '', analyze = false, play = true, signal = null } = {}) {
  const { settings, tts } = apiTtsSettings();
  const floor = await apiFloor(text, { speaker, lang });
  const utterances = ttsUtterances(floor, settings);
  if (!utterances.length) throw new Error('没有可朗读的文字。');
  let labels = apiLabels(utterances, { speaker, lang });
  let voices = null;
  if (analyze) {
    // The simple reading only: who is speaking, in what mood, in Fish's own words. One sub-model call.
    const analysed = await analyzeTtsFloor(floor, utterances, settings, 'simple', {});
    for (const [id, label] of analysed.labels) labels.set(id, { ...labels.get(id), ...label });
    voices = analysed.voices;
  }
  const segments = buildSegments(utterances, labels, { knownNames: ttsKnownNames(settings), voices });
  // The reader's 朗读范围 is about their chat, not about what a caller asked for: all of it is read.
  const { items } = await ttsItemsFor(floor, segments, settings, { range: 'all' });
  if (!items.length) throw new Error('没有可朗读的文字。');
  // Only one thing sounds at a time, and a floor being read gives way to what was just asked for.
  // Making audio without playing it disturbs nothing, so it leaves the floor alone.
  if (play) stopTts();
  const session = apiSession(floor, items, settings, { play, signal, speaker });
  await session.started;
  return session.handle;
}

function apiSession(floor, items, settings, { play, signal, speaker = '' }) {
  const state = { index: 0, total: items.length, playing: false, stopped: false, seconds: 0, cached: true };
  // The recordings this reading made, in order and without repeats: what a caller saves afterwards.
  const records = [];
  const listeners = new Set();
  const announce = () => {
    for (const listener of listeners) {
      try { listener({ index: state.index, total: state.total, playing: state.playing, seconds: state.seconds }); } catch { /* a caller's own bug is not ours */ }
    }
  };
  let begin = null;
  let fail = null;
  const started = new Promise((resolve, reject) => { begin = resolve; fail = reject; });
  const run = async () => {
    try {
      let index = 0;
      while (index < items.length && !state.stopped) {
        if (signal?.aborted) break;
        const item = items[index];
        const entry = await resolveTtsEntry(floor, items, item, settings);
        if (!entry.cached) state.cached = false;
        if (!records.includes(entry.record)) records.push(entry.record);
        if (state.stopped || signal?.aborted) break;
        const { record, index: at } = entry;
        const part = record.timeline[at].part;
        // Everything that shares this part plays in one go, the way a paragraph was recorded.
        let last = at;
        let ahead = index;
        for (let offset = index; offset < items.length; offset += 1) {
          const found = record.timeline.findIndex(candidate => candidate.id === items[offset].segment.id && candidate.part === part);
          if (found < 0) break;
          last = found;
          ahead = offset;
        }
        const from = playbackWindow(record.timeline, at, record.parts[part]?.duration);
        const to = playbackWindow(record.timeline, last, record.parts[part]?.duration);
        state.index = index;
        if (!play) {
          state.seconds += Math.max(0, to.end - from.start);
          index = ahead + 1;
          announce();
          continue;
        }
        const url = ttsObjectUrl(`${record.key}#${part}`, record.parts[part].blob);
        // The next paragraph is made while this one is heard.
        const next = items[ahead + 1];
        if (next) void resolveTtsEntry(floor, items, next, settings).catch(() => {});
        state.playing = true;
        begin?.();
        begin = null;
        announce();
        const outcome = await playTtsAudio(url, {
          start: from.start,
          end: to.end,
          onTime: time => {
            state.seconds = Math.max(0, time - from.start);
            announce();
          },
        });
        if (outcome === 'blocked') throw new Error('浏览器要先点一下页面才肯出声。');
        if (outcome === 'error') throw new Error('浏览器播放这段音频失败。换成 mp3 格式通常能解决。');
        if (outcome === 'stopped' || state.stopped) break;
        index = ahead + 1;
      }
      state.playing = false;
      state.index = Math.min(state.index, items.length - 1);
      announce();
    } catch (error) {
      state.playing = false;
      state.stopped = true;
      announce();
      if (begin) fail?.(error);
      throw error;
    } finally {
      begin?.();
      begin = null;
    }
  };
  const done = run();
  // A caller that never looks at the promise must not raise an unhandled rejection in the host page.
  done.catch(() => {});
  const handle = Object.freeze({
    get playing() { return state.playing; },
    get index() { return state.index; },
    get total() { return state.total; },
    get cached() { return state.cached; },
    get format() { return ttsSettings(settings).fish.format; },
    done,
    /** Everything this reading said, as one audio file. Await `done` first, or you get what is ready. */
    async blob() {
      if (!records.length) throw new Error('还没有生成好的音频。');
      return ttsDownloadBlob(records, ttsSettings(settings).fish.format);
    },
    /** The same file, handed to the browser as a download. One line, no plumbing. */
    async download(name = '') {
      const format = ttsSettings(settings).fish.format;
      const extension = format === 'opus' ? 'ogg' : format;
      const blob = await this.blob();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const wanted = String(name ?? '').trim();
      const filename = wanted
        ? (/\.[a-z0-9]{2,4}$/i.test(wanted) ? wanted : `${wanted}.${extension}`)
        : `镜译-朗读${speaker ? `-${speaker}` : ''}-${stamp}.${extension}`;
      return saveBlobAsFile(blob, filename);
    },
    onProgress(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pause() {
      runtime.tts.player?.audio.pause();
      state.playing = false;
      announce();
    },
    resume() {
      void runtime.tts.player?.audio.play().catch(() => {});
      state.playing = true;
      announce();
    },
    stop() {
      state.stopped = true;
      stopTtsPlayback();
      state.playing = false;
      announce();
    },
  });
  return { started: play ? started : done.then(() => {}), handle };
}

/**
 * Read text that is still being written. Hand it over as it grows — the whole so far or just the new
 * part (`push`) — say when it is finished (`end`), or call it off (`cancel`). Each stretch is spoken
 * as soon as it is safe to, in the voice the reader gave the named character, with the reader's own
 * audio settings, Fish key and quota; nothing is written to the chat. `on('state', fn)` hears
 * 'buffering' / 'speaking' / 'paused' / 'idle'; `done` settles when the last stretch has been heard.
 */
function apiStream({ speaker = '', lang = '', signal = null } = {}) {
  apiTtsSettings();
  stopTts();
  const session = createTtsStream({ kind: 'api', toLines: streamPlainLines, speaker, lang });
  if (signal?.aborted) session.cancel();
  else signal?.addEventListener?.('abort', () => session.cancel(), { once: true });
  return Object.freeze({
    push: text => session.push(text),
    end: () => session.end(),
    cancel: () => session.cancel(),
    pause: () => session.pause(),
    resume: () => session.resume(),
    on: (event, listener) => session.on(event, listener),
    get state() { return session.state; },
    done: session.finished,
  });
}

function installPublicApi() {
  if (typeof globalThis === 'undefined') return;
  const api = {
    name: APP_NAME,
    version: APP_VERSION,
    ready: null,
    tts: Object.freeze({
      apiVersion: PUBLIC_API_VERSION,
      /** Whether reading aloud is on and usable right now. Ask this before showing a read button. */
      status() {
        const tts = ttsSettings();
        return {
          enabled: tts.enabled === true,
          provider: 'fish',
          hasKey: Boolean(tts.fish.key),
          model: tts.fish.model,
          voices: ttsVoicesFor().filter(row => row.voiceId).length,
          busy: Boolean(runtime.tts.transport && runtime.tts.transport.state !== 'idle'),
        };
      },
      /** The characters the reader registered a voice for, with the names they are known by. */
      voices() {
        return ttsVoicesFor().map(row => ({
          name: row.name,
          aliases: [...(row.aliases ?? [])],
          hasOwnVoice: Boolean(row.voiceId),
        }));
      },
      speak: options => apiSpeak(options ?? {}),
      read: options => apiSpeak(options ?? {}),
      /** Text still being written, read a stretch at a time as it grows. See apiStream. */
      stream: options => apiStream(options ?? {}),
      /** Whatever this interface is saying, stopped. A floor being read is left alone. */
      stop() {
        if (runtime.tts.stream?.kind === 'api' && !runtime.tts.stream.done) runtime.tts.stream.cancel();
        stopTtsPlayback();
      },
    }),
    // 实时通话（测试版）.
    stt: Object.freeze({
      /** Whether speech can be taken now; `reason` says what to fix when it cannot. */
      status() {
        const tts = ttsSettings();
        const ready = sttAvailability(tts);
        return { provider: tts.sttProvider, available: ready.available, reason: ready.reason, secure: globalThis.isSecureContext !== false };
      },
      /** Open the microphone. Resolves to { stop(): Promise<string>, cancel() } once it is listening. */
      start: options => startSpeechInput(options ?? {}),
    }),
    llm: Object.freeze({
      /** The connection calls are answered on, and whether it streams. */
      status() {
        const settings = callRequestSettings();
        return {
          connection: channelLabel(settings, settings.apiMode === 'independent' ? settings.selectedChannelId : 'follow', { short: true }),
          streams: settings.apiMode === 'independent',
        };
      },
      /** { messages, signal, onText(textSoFar) } → the whole answer. */
      stream: options => apiLlmStream(options ?? {}),
    }),
    features: Object.freeze(['tts.speak', 'tts.stream', 'stt', 'llm.stream']),
    beta: true,
  };
  api.ready = Promise.resolve(api);
  globalThis[PUBLIC_API_NAME] = Object.freeze(api);
}

globalThis[INTERCEPTOR_NAME] = interceptGeneration;

export async function onActivate() {
  if (runtime.initialized) return;
  runtime.epoch += 1;
  globalThis[INTERCEPTOR_NAME] = interceptGeneration;
  initializeSettings();
  runtime.initialized = true;
  installPublicApi();
  syncSpeakerStylesheet(runtime.settings);
  scheduleEntries();
  registerRuntimeEvents();
  // Floors already on screen were rendered before this extension listened for anything.
  scheduleTtsDecorateAll({ delay: 600 });
  recordDiagnostic('info', 'lifecycle', `镜译 v${APP_VERSION} 已启动。`);
  console.info(`[${APP_NAME}] v${APP_VERSION} 已启动。`);
}

export function onDisable() {
  const context = getContext();
  const active = getActiveProcessingProfile(runtime.settings);
  if (runtime.nativeRegexInstalled) active.regexScripts = readNativeRegexEdits(context.extensionSettings.regex, active);
  context.extensionSettings.regex = syncNativeRegex(context.extensionSettings.regex, null);
  runtime.nativeRegexInstalled = false;
  context.saveSettingsDebounced?.();
  cleanupRuntime();
  if (globalThis[INTERCEPTOR_NAME] === interceptGeneration) delete globalThis[INTERCEPTOR_NAME];
}

export function onClean() {
  cleanupRuntime();
  clearDiagnostics();
  try {
    globalThis.localStorage?.removeItem(FLOATING_POSITION_KEY);
  } catch {
    // Restricted storage does not prevent the rest of the cleanup.
  }
  const context = getContext();
  context.extensionSettings.regex = syncNativeRegex(context.extensionSettings.regex, null);
  runtime.nativeRegexInstalled = false;
  delete context.extensionSettings[MODULE_ID];
  context.saveSettingsDebounced?.();
  if (globalThis[INTERCEPTOR_NAME] === interceptGeneration) delete globalThis[INTERCEPTOR_NAME];
}

// SillyTavern 1.14 loads module scripts but has no manifest activate hook.
// 1.18 calls onActivate itself; the deferred fallback is idempotent and checks capabilities, not versions.
if (typeof document !== 'undefined') {
  let attempts = 0;
  const bootstrap = () => {
    if (runtime.initialized) return;
    const context = globalThis.SillyTavern?.getContext?.();
    if (context?.extensionSettings) {
      void onActivate().catch(error => console.error(`[${APP_NAME}] 启动失败：${safeError(error)}`));
      return;
    }
    if (++attempts < 40) {
      const timer = setTimeout(() => { runtime.timers.delete(timer); bootstrap(); }, 250);
      runtime.timers.add(timer);
    }
  };
  const timer = setTimeout(() => { runtime.timers.delete(timer); bootstrap(); }, 0);
  runtime.timers.add(timer);
}

// A test-only seam. `saveSettings` reaches into the DOM for the floating entry and the panel, which
// a headless run has none of, so tests place settings and the lore cache directly.
function configureForTest({ settings, worldInfoEntries, initialized } = {}) {
  if (settings) runtime.settings = { ...runtime.settings, ...settings };
  if (worldInfoEntries !== undefined) runtime.wiEntries = worldInfoEntries;
  if (initialized !== undefined) runtime.initialized = initialized === true;
  return runtime.settings;
}

export const __testing = Object.freeze({
  withAbortTimeout,
  callController,
  describeCall,
  runInLanes,
  buildTranslationMessages,
  latestAssistantMessageId,
  readMessageSnapshot,
  restyleCurrentChat,
  initializeSettings,
  configureForTest,
  startTranslation,
  translateMessageStreaming,
  worldInfoKeyMatches,
  readableWorldInfoEntries,
  whitelistedWorldbookContent,
  forceActivateWorldInfoFromText,
  collectTtsFloor,
  prepareTtsSegments,
  ttsItemsFor,
  ttsVoicesKey,
  ttsVoicesFor,
  ensureTtsRecording,
  resolveTtsEntry,
  findTtsEntry,
  pregenerateTtsFloor,
  ttsInspect,
  saveTtsOverride,
  clearTtsOverride,
  saveTtsSpeaker,
  reanalyzeTtsFloor,
  ttsPrepared,
  saveSettings,
  syncTtsTransport,
  runTtsTransport,
  playTtsUtterance,
  playTtsParagraph,
  resetTtsPlayer: () => { runtime.tts.player = null; runtime.tts.transport = null; },
  playTtsFloor,
  stopTts,
  streamReplyLines,
  onReplyStreaming,
  sttAvailability,
  apiLlmStream,
  ttsStream: () => runtime.tts.stream,
  regenerateTtsSentence,
  regenerateTtsParagraph,
  ttsCast,
  ttsProviderFor,
  importCastFromWorldbook,
  ttsStore,
  editTranslationSegment,
  floorButtonsOn,
  floorButtonMode,
  planTtsLineButtons,
  refineTtsAnalysis,
  downloadTtsSentence,
  downloadTtsAudio,
  downloadNeedsSplice,
  ttsStatusOf: messageId => runtime.tts.status.get(Number(messageId)) ?? null,
  streamFishTimestamps,
  ttsProgressFor,
  ttsSaveSource,
  ttsSplicedWav,
  currentTtsLabels,
  ttsObjectUrl,
  dropTtsObjectUrls,
  apiFloor,
  apiLabels,
  apiSpeak,
  installPublicApi,
  translateMessage,
  createTtsTransport,
  ttsRequestSettings,
  seekTts,
  ttsRecordedLines,
  describeTtsRemake,
  resumeTtsReading,
  applyTranslationChoice,
  channelUsers,
  editingChannelId,
  syncSpeechPrompt,
  speechPromptContent,
  ttsTransport: () => runtime.tts.transport,
  // A page reload as the reading sees it: everything held for the session gone, the store kept.
  forgetTtsSession: () => {
    for (const key of ['analysis', 'floors', 'recordings', 'overrides', 'plainFloors', 'pregenerated', 'progress']) runtime.tts[key].clear();
    runtime.tts.transport = null;
    runtime.tts.player = null;
  },
});

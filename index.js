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
} from './core.js?v=0.17.1';
import {
  FISH_MIME,
  alignSpansToTimeline,
  analysisCacheKey,
  base64ToBytes,
  buildFishPayload,
  buildGlobalTimeline,
  buildSegments,
  buildTtsAnalysisMessages,
  createSseParser,
  createTimestampCollector,
  describeFishFailure,
  fishEndpoint,
  fishFingerprint,
  fishHeaders,
  floorCacheKey,
  labelsFromAnnotations,
  linesFromTaggedText,
  locateAnchors,
  parseTtsAnalysis,
  plainLineText,
  planFishParts,
  planVoices,
  playbackWindow,
  resolveSegmentVoice,
  segmentsInRange,
  sentenceCacheKey,
  splitUtterances,
  toStandardDocument,
  voiceRosterNames,
} from './tts.js?v=0.17.1';
import { createTtsStore } from './tts-store.js?v=0.17.1';
import {
  VISUAL_FIELDS, REGEX_OWNER_KEY,
  normalizeProcessingSettings, getActiveProcessingProfile,
  captureProcessingProfile, selectProcessingProfile, exportProcessingProfile, importProcessingProfile,
  importNativeRegex, makeBuiltinReadingProfile, syncNativeRegex, readNativeRegexEdits,
} from './processing.js?v=0.17.1';
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
} from './prompts.js?v=0.17.1';
import { buildTranslationMessages, collectTranslationContext } from './workflow.js?v=0.17.1';
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
} from './palette.js?v=0.17.1';
import { sampleThemeBackground } from './theme-probe.js?v=0.17.1';
import {
  addDiagnostic,
  clearDiagnostics,
  formatFullDiagnosticReport,
  listDiagnosticFloors,
  readDiagnostics,
} from './diagnostics.js?v=0.17.1';

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
  // Reading aloud. Audio and analyses persist in IndexedDB; everything here is per session.
  tts: {
    store: null,
    // floorId|version → labels, so a re-render can place the right buttons without asking again.
    labels: new Map(),
    // Cache key → in-flight promise, so a double click never pays for the same audio twice.
    jobs: new Map(),
    session: null,
    highlighted: null,
    anchorWarned: new Set(),
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
  <div class="jy-brief"><span class="jy-overline">当前连接</span><h3 data-jy-channel-name>跟随当前连接</h3><span class="jy-badge" data-jy-channel-mode>主 API</span><p class="jy-muted" data-jy-channel-summary></p><button type="button" class="jy-button" data-jy-action="open-settings">管理连接 →</button></div>
  <div class="jy-brief"><span class="jy-overline">参考资料</span><p class="jy-muted" data-jy-context-summary></p></div>
 </aside>
</div>
<div class="jy-automation"><div><h3>自动接续翻译</h3><p class="jy-muted">主回复完成后，自动补上译文。</p></div><label class="jy-switch"><input type="checkbox" data-jy-field="autoGeneration" aria-label="主回复完成后自动翻译"><span></span></label><label class="jy-check"><input type="checkbox" data-jy-field="autoSwipe">切换滑动页时补译</label><label class="jy-check"><input type="checkbox" data-jy-field="streamingWriteback">流式写回（beta，勾选后所有翻译走流式；仅独立模式，跟随模式自动回退整包）</label></div>
<div class="jy-automation" data-jy-tts-desk><div><h3>朗读（有声小说）</h3><p class="jy-muted">把译文或原文念出来，旁白和角色各用各的声音。关着就是只翻译，楼层里不加任何东西。需要 Fish Audio 的 API Key。</p></div><label class="jy-switch"><input type="checkbox" data-jy-tts-field="enabled" aria-label="朗读功能"><span></span></label><button type="button" class="jy-text-button" data-jy-action="open-tts" hidden>朗读设置 →</button></div>
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
<header class="jy-page-heading"><div><h1>模型连接</h1><span class="jy-page-context" data-jy-channel-context></span></div><button type="button" class="jy-button" data-jy-action="test-api">测试连接</button></header>
<div class="jy-connection-choice" role="radiogroup" aria-label="翻译通道"><label><input type="radio" name="jy-api-mode" value="follow" data-jy-field="apiMode"><span><strong>跟随酒馆</strong><small>使用当前连接和模型</small></span></label><label><input type="radio" name="jy-api-mode" value="independent" data-jy-field="apiMode"><span><strong>独立副 API</strong><small>为翻译单独选择模型</small></span></label></div>
<p class="jy-muted" data-jy-api-help></p>
<div class="jy-connection-form" data-jy-independent-panel>
 <div class="jy-form-section"><div class="jy-section-title"><span>01</span><h2>保存的连接</h2></div><div class="jy-form-body"><label><span class="jy-label">选择预设</span><select data-jy-field="selectedChannelId"></select></label><div class="jy-inline-actions"><button type="button" class="jy-button" data-jy-action="add-channel">＋ 新建连接</button><button type="button" class="jy-button" data-jy-action="delete-channel">删除当前连接</button></div><label><span class="jy-label">预设名称</span><input type="text" data-jy-channel-field="name" placeholder="给这个连接起个名字"></label></div></div>
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
 </div></details><details class="jy-advanced"><summary>节约模式世界书白名单</summary><div class="jy-processing-toolbar"><button type="button" class="jy-button" data-jy-action="refresh-wi-entries">刷新可读条目</button></div><div class="jy-wi-list" data-jy-wi-list></div><p class="jy-muted">列出全局挂载与当前角色卡激活的世界书条目；勾选后节约模式下仅注入这些内容，白名单跟随当前角色卡保存。一个都不勾则节约模式下完全不带世界书。</p></details><div class="jy-actions"><button type="button" class="jy-button jy-button-primary" data-jy-action="save-channel">保存连接</button></div>
</div>
<div class="jy-retry-setting"><label><span class="jy-label">失败后自动重试次数</span><input type="number" data-jy-field="retries" min="0" max="5" step="1"></label><p class="jy-muted">适用于当前翻译通道。</p></div>
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
<div class="jy-text-scope"><span class="jy-overline">保留原样</span><h2>保留原样</h2><label><span class="jy-label">排除标签</span><textarea rows="4" data-jy-field="excludedTags" placeholder="thinking&#10;status" spellcheck="false"></textarea></label><p class="jy-muted">标签及内部内容保留在原位。</p></div>
</div>
<details class="jy-advanced"><summary>原样保留白名单</summary><label><span class="jy-label">每行一条规则</span><textarea rows="5" data-jy-field="preserveLineRules" spellcheck="false" placeholder="此时彼刻&#10;prefix:【系统记录】"></textarea></label><p class="jy-muted">文字匹配整行，prefix: 匹配行首，/正则/ 匹配整行。纯边框、纯符号与标签行自动保留。</p></details>
<details class="jy-advanced"><summary>段落前后缀</summary><div class="jy-affix-group"><span class="jy-label">原文</span><div class="jy-form-grid"><label><span class="jy-label">原文之前</span><input type="text" data-jy-field="segmentPrefix" placeholder="留空即可不加前缀"></label><label><span class="jy-label">原文之后</span><input type="text" data-jy-field="segmentSuffix" placeholder="留空即可不加后缀"></label></div></div><div class="jy-affix-group"><span class="jy-label">译文</span><div class="jy-form-grid"><label><span class="jy-label">译文之前</span><input type="text" data-jy-field="translationPrefix" placeholder="留空即可不加前缀"></label><label><span class="jy-label">译文之后</span><input type="text" data-jy-field="translationSuffix" placeholder="留空即可不加后缀"></label></div></div><label class="jy-check"><input type="checkbox" data-jy-field="paragraphPerLine">每行单独成段</label><label class="jy-check"><input type="checkbox" data-jy-field="carryFormatting">译文跟随原文格式</label><p class="jy-muted">勾选「跟随原文格式」后，原文某一行整行被 <code>&lt;span&gt;</code>、<code>&lt;font&gt;</code>、<code>&lt;b&gt;</code> 这类标签包着时，译文那一行也会套上同一层（只带 style / color / class / size / face，不复制 id、事件等属性）；预设给对话上的颜色不会只剩原文一半。开了说话人着色时以说话人颜色为准，粗体斜体仍然跟随。改这个开关只影响之后翻译的楼层，已有楼层重翻一次才会跟上。<br>留空即不添加。主模型仅保留原文，过滤镜译添加的装饰与译文。<br>默认按空行分段，整段原文后面跟整段译文。勾选后每一行都独立成段，原文与译文逐行贴在一起，各对之间空一行；用于分隔的空行写在不可见边界内，不会进入主模型。</p></details>
<div class="jy-behaviors"><label class="jy-check"><input type="checkbox" data-jy-field="autoEdit">编辑回复后自动重译</label><label class="jy-check"><input type="checkbox" data-jy-field="showFloatingButton">显示悬浮入口</label><label class="jy-inline-field"><span class="jy-label">悬浮入口形态</span><select data-jy-field="floatingStyle"><option value="auto">自动（空闲圆环，翻译中胶囊，手机贴边）</option><option value="ring">始终圆环</option><option value="pill">始终胶囊</option><option value="edge">始终贴边</option></select></label></div>
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
<header class="jy-page-heading"><div><h1>朗读</h1><span class="jy-page-context">旁白和每个角色各用各的声音，点哪句读哪句</span></div><button type="button" class="jy-button" data-jy-action="tts-test">测试连接</button></header>
<div class="jy-automation" data-jy-tts-master><div><h3>朗读功能</h3><p class="jy-muted">打开后，楼层里每一句后面会出现播放按钮，底部有「朗读本楼」；按钮只加在页面上，不写进楼层。关掉就是一般模式：只翻译，这一页收起，后台不做任何事。</p></div><label class="jy-switch"><input type="checkbox" data-jy-tts-field="enabled" aria-label="朗读功能"><span></span></label></div>
<div class="jy-connection-choice" role="radiogroup" aria-label="生成方式"><label><input type="radio" name="jy-tts-mode" value="floor" data-jy-tts-field="mode"><span><strong>整篇发送</strong><small>一楼只请求一次，记下每句的时间；点任何一句都是跳到那里播放</small></span></label><label><input type="radio" name="jy-tts-mode" value="sentence" data-jy-tts-field="mode"><span><strong>单句发送</strong><small>点哪句只生成哪句，不为整楼花额度</small></span></label></div>
<div class="jy-form-section"><div class="jy-section-title"><span>01</span><h2>读什么</h2></div><div class="jy-form-body">
<div class="jy-form-grid jy-form-grid-tight"><label><span class="jy-label">朗读语言</span><select data-jy-tts-field="side"><option value="translation">译文</option><option value="source">原文</option></select></label><label><span class="jy-label">朗读范围</span><select data-jy-tts-field="range"><option value="all">旁白 + 对白</option><option value="dialogue">只读对白</option><option value="narration">只读旁白</option></select></label><label><span class="jy-label">谁说的、什么情绪</span><select data-jy-tts-field="analysis"><option value="model">副模型分析</option><option value="annotations">只用翻译标注</option></select></label></div>
<label class="jy-check"><input type="checkbox" data-jy-tts-field="emotionCues">把情绪转成 Fish 的情绪标签一起发送</label>
<label><span class="jy-label">读译文时，楼层没有镜译译文就从这些标签里取文字</span><input type="text" data-jy-tts-field="sourceTags" placeholder="jy-translation" spellcheck="false"></label>
<p class="jy-muted">读原文：按「正文处理」里的提取标签取原文，没翻译过的楼层也能读。适合日语、英语音色直接念原文。副模型分析时会附上每行的译文帮它认人，说话人按译名写；原文里的写法（比如桜井）可以加进角色的别名。<br>副模型分析：每楼第一次朗读前请求一次，只回答每一句由谁念、什么情绪，不返回文字，台词原样送去朗读；结果按楼层缓存。<br>只用翻译标注：不额外请求，用翻译时副模型给的说话人。一行只有一个说话人，一行里两个人说话会用同一个声音。</p>
</div></div>
<div class="jy-form-section"><div class="jy-section-title"><span>02</span><h2>Fish Audio</h2></div><div class="jy-form-body">
<label><span class="jy-label">API Key</span><input type="password" data-jy-tts-fish="key" placeholder="sk-…" autocomplete="new-password" spellcheck="false"></label>
<label><span class="jy-label">模型</span><select data-jy-tts-fish="model"><option value="s2-pro">s2-pro</option><option value="s2.1-pro">s2.1-pro</option><option value="s2.1-pro-free">s2.1-pro-free（免费开发者档）</option><option value="drama-3-preview">drama-3-preview（预览版）</option><option value="s1">s1（旧版，不能一次用多个音色）</option></select></label>
<label class="jy-check"><input type="checkbox" data-jy-tts-fish="viaProxy">经酒馆 CORS 代理发送</label>
<label><span class="jy-label">接口地址</span><input type="url" data-jy-tts-fish="baseUrl" placeholder="https://api.fish.audio" spellcheck="false"></label>
<p class="jy-muted" data-jy-tts-proxy-help></p>
</div></div>
<div class="jy-form-section"><div class="jy-section-title"><span>03</span><h2>音色</h2></div><div class="jy-form-body">
<div class="jy-form-grid jy-form-grid-tight"><label><span class="jy-label">旁白音色 <span class="jy-tts-title" data-jy-tts-title="narrator"></span></span><input type="text" data-jy-tts-field="narratorVoice" placeholder="Fish Voice ID" spellcheck="false"></label><label><span class="jy-label">对白默认音色 <span class="jy-tts-title" data-jy-tts-title="dialogue"></span></span><input type="text" data-jy-tts-field="dialogueVoice" placeholder="没登记的角色用这个" spellcheck="false"></label></div>
<div class="jy-processing-toolbar"><button type="button" class="jy-button" data-jy-action="tts-add-voice">添加角色</button><button type="button" class="jy-button" data-jy-action="tts-import-speakers">导入已知说话人</button><button type="button" class="jy-button" data-jy-action="tts-lookup-voices">查询音色名</button></div>
<div class="jy-tts-voice-list" data-jy-tts-voice-list></div>
<p class="jy-muted">角色音色跟着当前角色卡保存。名字填译文里的写法，别名用逗号分隔。Voice ID 是 fish.audio 音色页面地址里那串 32 位字母数字。</p>
</div></div>
<details class="jy-advanced"><summary>声音参数</summary><div class="jy-form-grid">
<label><span class="jy-label">音频格式</span><select data-jy-tts-fish="format"><option value="mp3">mp3（兼容最好）</option><option value="opus">opus（体积小，旧版 Safari 可能播不了）</option><option value="wav">wav（无损，体积大）</option></select></label><label><span class="jy-label">延迟与质量</span><select data-jy-tts-fish="latency"><option value="normal">normal（质量最好）</option><option value="balanced">balanced</option><option value="low">low（最快）</option></select></label>
<label><span class="jy-label">语速（0.5–2）</span><input type="number" data-jy-tts-fish="speed" min="0.5" max="2" step="0.05"></label><label><span class="jy-label">音量调整 / dB</span><input type="number" data-jy-tts-fish="volume" min="-20" max="20" step="1"></label>
<label><span class="jy-label">temperature</span><input type="number" data-jy-tts-fish="temperature" min="0" max="1" step="0.05"></label><label><span class="jy-label">top_p</span><input type="number" data-jy-tts-fish="topP" min="0" max="1" step="0.05"></label>
<label><span class="jy-label">整篇发送时每次最多字数</span><input type="number" data-jy-tts-fish="maxChars" min="200" max="10000" step="100"></label><label><span class="jy-label">超时 / 秒</span><input type="number" data-jy-tts-fish="timeoutSec" min="10" max="600" step="10"></label>
<label class="jy-check"><input type="checkbox" data-jy-tts-fish="normalize">数字与符号规范化（中英文读数更稳）</label>
</div><p class="jy-muted">改任何一项声音参数，已经缓存的音频都会按新参数重新生成。</p></details>
<details class="jy-advanced" data-jy-tts-preview-panel><summary>当前楼层的朗读结构</summary><div class="jy-processing-toolbar"><button type="button" class="jy-button" data-jy-action="tts-preview">分析最新一楼</button><button type="button" class="jy-button" data-jy-action="tts-copy-structure" hidden>复制朗读结构 JSON</button></div><div class="jy-tts-preview" data-jy-tts-preview></div></details>
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
  return runtime.settings;
}

function saveSettings(next) {
  const context = getContext();
  const previous = runtime.settings;
  runtime.settings = captureProcessingProfile(normalizeProcessingSettings(next));
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
  if (runtime.mini?.host) {
    runtime.mini.host.dataset.theme = runtime.settings.theme || 'day';
    runtime.mini.syncQuickPickers?.();
  }
  const floating = document.getElementById(FLOATING_ID);
  if (floating) floating.dataset.theme = runtime.settings.theme || 'day';
  // Anything the floor buttons depend on — the switch, the mode, the range — redraws them; switching
  // reading aloud off also ends whatever is playing.
  const ttsBefore = JSON.stringify([previous.tts, previous.ttsVoices]);
  if (runtime.initialized && ttsBefore !== JSON.stringify([runtime.settings.tts, runtime.settings.ttsVoices])) {
    if (!ttsSettings(runtime.settings).enabled) {
      stopTts();
      unbindTtsDom();
      clearAllTtsDecorations();
    } else {
      bindTtsDom();
      scheduleTtsDecorateAll({ force: true });
    }
  }
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
  let paragraphs = 0;
  let nextId = 1;
  for (const region of extraction.regions) {
    const segmented = segmentSource(region.inner, { ...segmentOptions, startId: nextId });
    region.layout = segmented.layout;
    region.segments = segmented.segments;
    region.paragraphs = segmented.paragraphs;
    segments.push(...segmented.segments);
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
function describeTimeout(timeoutSec, idle) {
  return idle
    ? `副 API 已建立流式连接，但超过 ${timeoutSec} 秒没有新内容。`
    : `独立副 API 请求超时（>${timeoutSec} 秒）。思考型模型整包返回常常更久：可在副 API 预设里调大「超时」，或打开流式写回让译文边收边写。`;
}

// The window used to cover the whole call. That is right for a one-shot request and wrong for a
// stream: a run that kept delivering deltas past the channel timeout was cut off mid-translation.
// The optional renew() handed to the task turns the window into an idle timer for whoever calls it,
// and leaves it a total timeout for everyone who does not.
async function withAbortTimeout(externalSignal, timeoutSec, task) {
  const controller = new AbortController();
  let timedOut = false;
  let renewed = false;
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
  try {
    return await task(controller.signal, renew);
  } catch (error) {
    if (timedOut) throw new Error(describeTimeout(timeoutSec, renewed));
    throw error;
  } finally {
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
  const reported = [...annotations.values()].map(mark => mark?.speaker).filter(Boolean);
  if (!reported.length) return annotations;
  const names = unifySpeakerNames(reported, [...speakerRoster(settings), ...runtime.autoSpeakerNames]);
  const result = new Map();
  for (const [id, mark] of annotations) {
    const speaker = mark?.speaker ? names.get(String(mark.speaker).trim()) ?? mark.speaker : mark?.speaker;
    result.set(id, speaker === mark?.speaker ? mark : { ...mark, speaker });
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
    const annotation = {};
    if (value.speaker) annotation.speaker = String(value.speaker).slice(0, 60);
    if (value.emotion) annotation.emotion = String(value.emotion).slice(0, 40);
    if (Number.isFinite(Number(value.intensity))) annotation.intensity = Math.min(2, Math.max(0, Math.round(Number(value.intensity))));
    if (annotation.speaker || annotation.emotion) map.set(key, annotation);
  }
  return map;
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
async function requestSubModelRaw(messages, settings, signal) {
  const context = getContext();
  const channel = getActiveChannel(settings);
  if (settings.apiMode === 'independent') {
    const service = context.ChatCompletionService;
    if (!service?.processRequest) throw new Error('当前 SillyTavern 不提供独立聊天补全请求接口。');
    return withAbortTimeout(signal, channel.timeoutSec, requestSignal => service.processRequest(
      createIndependentRequest(settings, messages),
      {},
      true,
      requestSignal,
    ));
  }
  if (typeof context.generateRaw !== 'function') throw new Error('当前 SillyTavern 不提供静默生成接口。');
  return context.generateRaw({
    prompt: messages,
    responseLength: channel.maxTokens,
    trimNames: false,
  });
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
        { roster: state.roster ?? [] },
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
      if (coloringEnabled(settings) && !annotations.size) {
        recordDiagnostic('warn', 'translation.no-annotations', '副模型没有返回任何说话人或情绪标注，这一批按普通样式显示。', {
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
  const state = { requests: 0, roster: speakerRoster(settings), seeded: translations.size > 0 };
  let lastError;
  recordDiagnostic('info', 'translation.plan', '已按副 API 的输出上限规划本次请求批次。', {
    segments: segments.length,
    batches: batches.length,
    charBudget: translationCharBudget(channel.maxTokens),
    maxTokens: channel.maxTokens,
    concurrency: lanes,
  });
  const failures = await runInLanes(batches, lanes, batch => translateOneBatch(batch, settings, signal, packet, translations, budget, state, annotations));
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

async function translateMessage(messageId = null, { force = false, quiet = false } = {}) {
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
  if (snapshot.translated && !force) return { skipped: true, reason: 'already-translated', snapshot };

  const lockKey = `${snapshot.chatId}|${snapshot.messageId}|${snapshot.swipeId}`;
  const existing = runtime.inflight.get(lockKey);
  if (existing && !force) {
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
      const seedTranslations = force ? new Map() : snapshot.existingTranslations;
      const seedAnnotations = force ? new Map() : snapshot.existingAnnotations;
      result = await invokeWithRetries(snapshot.segments, settings, controller.signal, packet, seedTranslations, retryBudget, seedAnnotations);
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
      updateTask({ status: 'idle', title: '翻译已取消', message: '聊天已切换或任务已停止。', progress: 0 });
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

  runtime.inflight.set(lockKey, { promise: work, controller });
  return work;
}

// Streaming beta: same request content as the one-shot path, but the SSE deltas are folded into
// the floor as completed JSON items arrive. The final pass reuses the ordinary write pipeline, so
// the finished floor is byte-identical to a non-streaming run.
async function streamTranslationBatch(messages, settings, signal, onDelta = null, onThinking = null) {
  const channel = getActiveChannel(settings);
  const payload = { ...createIndependentRequest(settings, messages), stream: true };
  // The whole-request path has always honoured the channel timeout. Without the same wrapper a
  // stalled upstream kept the task "running" forever once the response headers had arrived.
  return withAbortTimeout(signal, channel.timeoutSec, async (streamSignal, renew) => {
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
  if (existing && !force) {
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
    const roster = speakerRoster(settings);
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
      const messages = buildTranslationMessages(pending, settings, packet, phase, { roster });
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
        const recovered = await invokeTranslationBatch(pending, settings, controller.signal, packet, phase, { roster });
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
    await runInLanes(batches, lanes, streamBatch);

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
      updateTask({ status: 'idle', title: '翻译已取消', message: '聊天已切换或任务已停止。', progress: 0 });
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

  runtime.inflight.set(lockKey, { promise: work, controller });
  return work;
}

// Single entry point for every translation trigger, so the streaming toggle and the force/quiet
// semantics can never drift apart between the control centre, the mini window and the auto hooks.
function startTranslation(messageId = null, { force = false, quiet = false } = {}) {
  return runtime.settings.streamingWriteback
    ? translateMessageStreaming(messageId, { force, quiet })
    : translateMessage(messageId, { force, quiet });
}

async function testTranslationChannel() {
  updateTask({ status: 'running', title: '正在测试翻译通道', message: '发送一段最小测试文本。', progress: 25 });
  try {
    let packet = {};
    try {
      packet = await collectTranslationContext(await readMessageSnapshot(), runtime.settings);
    } catch {
      // A channel test also works before a translatable story exists.
    }
    const result = await invokeWithRetries([{ id: 1, text: '雨が降っている。' }], runtime.settings, undefined, packet);
    const sample = result.translations.get(1);
    updateTask({ status: 'success', title: '翻译通道可用', message: `单句连通测试通过：${sample}（不代表长正文不会被截断）`, progress: 100 });
    recordDiagnostic('info', 'channel.test', '翻译通道测试成功。', {
      apiMode: runtime.settings.apiMode,
      model: getActiveChannel(runtime.settings).model || 'follow-current',
      endpoint: describeChannelEndpoint(),
    });
    toast('success', '翻译通道测试成功。');
    return sample;
  } catch (error) {
    const message = safeError(error);
    updateTask({ status: 'error', title: '翻译通道测试失败', message, progress: 0 });
    recordDiagnostic('error', 'channel.test', message, {
      apiMode: runtime.settings.apiMode,
      model: getActiveChannel(runtime.settings).model || 'follow-current',
      endpoint: describeChannelEndpoint(),
    });
    toast('error', message);
    throw error;
  }
}

async function fetchChannelModels() {
  const context = getContext();
  if (typeof context.getRequestHeaders !== 'function') throw new Error('当前 SillyTavern 不提供模型列表请求接口。');
  const channel = getActiveChannel(runtime.settings);
  if (!channel.url) throw new Error('请先填写当前副 API 预设的地址。');
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
      apiMode: runtime.settings.apiMode,
      endpoint: describeChannelEndpoint(),
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
// ---------------------------------------------------------------------------------------------

const TTS_ICON_PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5.2 3.3v9.4l7.3-4.7z"/></svg>';
const TTS_ICON_STOP = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="4.2" y="4.2" width="7.6" height="7.6" rx="1.2"/></svg>';
const TTS_RANGE_LABELS = Object.freeze({ all: '旁白 + 对白', dialogue: '只读对白', narration: '只读旁白' });
const TTS_INLINE_WRAPPERS = new Set(['Q', 'EM', 'STRONG', 'I', 'B', 'U', 'S', 'SPAN', 'FONT', 'SMALL', 'MARK', 'DEL', 'INS', 'SUB', 'SUP', 'CITE']);

function ttsSettings(settings = runtime.settings) {
  return normalizeTts(settings?.tts);
}

function ttsStore() {
  runtime.tts.store ??= createTtsStore();
  return runtime.tts.store;
}

function ttsVoicesFor(settings = runtime.settings) {
  return normalizeVoiceList(settings?.ttsVoices?.[worldInfoCharacterKey()]);
}

function ttsVoiceConfig(settings = runtime.settings) {
  const tts = ttsSettings(settings);
  return { voices: ttsVoicesFor(settings), narratorVoice: tts.narratorVoice, dialogueVoice: tts.dialogueVoice };
}

// Everyone this cast is known by: voiced characters first, then the colour palette and the names the
// model has already reported this session.
function ttsKnownNames(settings = runtime.settings) {
  return [...new Set([...voiceRosterNames(ttsVoicesFor(settings)), ...speakerRoster(settings), ...runtime.autoSpeakerNames])];
}

/**
 * The lines one floor would read, with the version they are cached under.
 *
 * A floor this extension translated is read through its own boundaries, which do not care what the
 * visible affixes are. One it never translated falls back to literal source tags such as
 * <jy-translation>, for presets that type them themselves.
 */
async function collectTtsFloor(messageId, settings = runtime.settings) {
  const context = getContext();
  const id = Number(messageId);
  const message = context.chat?.[id];
  if (!Number.isInteger(id) || !message || message.is_user || message.is_system || typeof message.mes !== 'string') return null;
  const chatId = getCurrentChatId(context);
  const swipeId = Number(message.swipe_id ?? 0);
  const side = ttsSettings(settings).side;
  let lines = [];
  let annotations = new Map();
  let references = null;
  let source = 'tags';
  // The original is readable on any floor whose body tags extract, translated or not; the translation
  // only on a floor this extension wrote, or through the literal source tags below.
  if (side === 'source' || message.extra?.[MESSAGE_META_KEY]) {
    try {
      const snapshot = await readMessageSnapshot(id, settings, { quiet: true });
      annotations = canonicalAnnotations(settings, snapshot.existingAnnotations);
      if (side === 'source') {
        lines = snapshot.segments
          .map(segment => ({ lineId: segment.id, text: plainLineText(segment.text) }))
          .filter(line => line.text);
        references = new Map([...snapshot.existingTranslations].map(([lineId, text]) => [lineId, plainLineText(text)]));
        source = 'source';
      } else {
        lines = snapshot.segments
          .filter(segment => snapshot.existingTranslations.has(segment.id))
          .map(segment => ({ lineId: segment.id, text: plainLineText(snapshot.existingTranslations.get(segment.id)) }))
          .filter(line => line.text);
        source = 'translation';
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
    source,
  };
}

function ttsLabelKey(floor) {
  return `${floor.floorId}|${floor.version}`;
}

// One promise per cache key. A second click on something already being generated waits for the same
// request instead of paying for another one; each job has its own controller so a stop can cancel it.
function dedupeTtsJob(key, messageId, work) {
  const existing = runtime.tts.jobs.get(key);
  if (existing) return existing.promise;
  const controller = new AbortController();
  const promise = Promise.resolve().then(() => work(controller.signal)).finally(() => {
    if (runtime.tts.jobs.get(key)?.promise === promise) runtime.tts.jobs.delete(key);
  });
  runtime.tts.jobs.set(key, { promise, controller, messageId });
  return promise;
}

function abortTtsJobs(messageId = null) {
  for (const [key, job] of runtime.tts.jobs) {
    if (messageId !== null && job.messageId !== messageId) continue;
    job.controller.abort();
    runtime.tts.jobs.delete(key);
  }
}

async function analyzeTtsFloor(floor, utterances, settings) {
  const roster = ttsKnownNames(settings);
  const key = await analysisCacheKey({ utterances, roster, source: 'model', references: floor.references });
  const stored = await ttsStore().getAnalysis(key);
  if (Array.isArray(stored?.labels) && stored.labels.length) return new Map(stored.labels);
  return dedupeTtsJob(key, floor.messageId, async signal => {
    const context = getContext();
    const messages = buildTtsAnalysisMessages(utterances, {
      roster,
      characterName: context.name2 ?? '',
      userName: context.name1 ?? '',
      translations: floor.references,
    });
    let raw;
    try {
      raw = await requestSubModelRaw(messages, settings, signal);
    } catch (error) {
      if (!isAbortError(error)) {
        recordDiagnostic('error', 'tts.analysis-failed', `朗读分析请求失败：${safeError(error)}`, {
          floor: floor.floorId,
          utterances: utterances.length,
          apiMode: settings.apiMode,
          endpoint: describeChannelEndpoint(settings),
        }, describeRequestFailure(error), { fullRequest: messages, floor: floor.messageId });
      }
      throw error;
    }
    const { labels } = parseTtsAnalysis(raw, utterances);
    recordDiagnostic(labels.size ? 'info' : 'warn', 'tts.analysis', labels.size
      ? `副模型给 ${labels.size} 句标了类型、说话人或情绪。`
      : '副模型没有返回可用的朗读标注，这一楼按引号区分旁白与对白。', {
      floor: floor.floorId,
      utterances: utterances.length,
      labeled: labels.size,
      apiMode: settings.apiMode,
      requestTokens: describeRequestTokens(messages, raw),
    }, raw, { fullRequest: messages, floor: floor.messageId });
    // An empty answer is not cached: the next play asks again instead of living with a failed reply.
    if (labels.size) await ttsStore().putAnalysis({ key, floorId: floor.floorId, version: floor.version, labels: [...labels] });
    return labels;
  });
}

/**
 * Utterances plus labels for one floor.
 *
 * The translation's own annotations are the starting point and cost nothing. In model mode the secondary
 * model is asked once per text version; a failed request falls back to the annotations with a warning
 * rather than refusing to read.
 */
async function prepareTtsSegments(floor, settings, { onStatus = null } = {}) {
  const tts = ttsSettings(settings);
  const utterances = splitUtterances(floor.lines);
  let labels = labelsFromAnnotations(utterances, floor.annotations);
  if (tts.analysis === 'model' && utterances.length) {
    const known = runtime.tts.labels.get(ttsLabelKey(floor));
    if (known) {
      labels = known;
    } else {
      onStatus?.('正在分析谁在说话…');
      try {
        const analyzed = await analyzeTtsFloor(floor, utterances, settings);
        if (analyzed.size) {
          labels = analyzed;
          runtime.tts.labels.set(ttsLabelKey(floor), analyzed);
          if (runtime.tts.labels.size > 200) runtime.tts.labels.delete(runtime.tts.labels.keys().next().value);
          // Types may have moved: a quoted title is narration, an unquoted order is dialogue.
          scheduleTtsDecorate(floor.messageId, { force: true });
        }
      } catch (error) {
        if (isAbortError(error)) throw error;
        toast('warning', `朗读分析失败，这一楼先按翻译时的标注读：${safeError(error)}`);
      }
    }
  }
  return { utterances, labels, segments: buildSegments(utterances, labels, { knownNames: ttsKnownNames(settings) }) };
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

async function fishRequest(path, fish, { method = 'POST', body, signal } = {}) {
  const viaProxy = fish.viaProxy !== false;
  let response;
  try {
    response = await fetch(fishEndpoint(fish, path), {
      method,
      headers: fishHeaders(fish, viaProxy ? requestHeaders() : {}),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw error;
    const failure = new Error(describeFishFailure({ network: true, viaProxy }));
    failure.cause = error;
    throw failure;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const failure = new Error(describeFishFailure({ status: response.status, body: text, viaProxy }));
    failure.status = response.status;
    failure.body = text.slice(0, 2000);
    throw failure;
  }
  return response;
}

async function streamFishTimestamps(body, fish, signal) {
  return withTtsTimeout(signal, fish.timeoutSec, async (requestSignal, renew) => {
    const response = await fishRequest('/v1/tts/stream/with-timestamp', fish, { body, signal: requestSignal });
    const collector = createTimestampCollector();
    let unreadable = 0;
    const parser = createSseParser(event => {
      if (!event.data || event.data === '[DONE]') return;
      try {
        collector.accept(JSON.parse(event.data));
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

function voiceMissingMessage(segment) {
  return segment.type === 'narration'
    ? '还没有设置旁白音色，也没有对白默认音色。在「朗读」页填一个 Voice ID。'
    : `「${segment.speaker || '这个说话人'}」没有登记音色，也没有设置对白默认音色。`;
}

async function ensureSentenceAudio(floor, segment, settings) {
  const tts = ttsSettings(settings);
  const voiceId = resolveSegmentVoice(segment, ttsVoiceConfig(settings));
  if (!voiceId) throw new Error(voiceMissingMessage(segment));
  const fingerprint = fishFingerprint(tts.fish, { emotionCues: tts.emotionCues });
  const key = await sentenceCacheKey({ floorId: floor.floorId, segment, voiceId, fingerprint });
  const cached = await ttsStore().getAudio(key);
  if (cached?.parts?.[0]?.blob) return { record: cached, cached: true };
  requireFishKey(tts);
  const record = await dedupeTtsJob(key, floor.messageId, async signal => {
    const { body } = buildFishPayload([{ segment, voiceId }], tts.fish, { emotionCues: tts.emotionCues });
    const started = Date.now();
    let bytes;
    try {
      bytes = await withTtsTimeout(signal, tts.fish.timeoutSec, async requestSignal => {
        const response = await fishRequest('/v1/tts', tts.fish, { body, signal: requestSignal });
        return response.arrayBuffer();
      });
    } catch (error) {
      if (!isAbortError(error)) {
        recordDiagnostic('error', 'tts.request-failed', safeError(error), {
          floor: floor.floorId, segment: segment.id, model: tts.fish.model, viaProxy: tts.fish.viaProxy, status: error.status ?? null,
        }, { status: error.status ?? null, body: error.body ?? '' }, { fullRequest: body, floor: floor.messageId });
      }
      throw error;
    }
    if (!bytes.byteLength) throw new Error('Fish 没有返回音频。');
    // The host proxy forwards the body without its content type, so the type is set here.
    const blob = new Blob([bytes], { type: FISH_MIME[tts.fish.format] ?? 'audio/mpeg' });
    recordDiagnostic('info', 'tts.sentence', '已生成单句朗读。', {
      floor: floor.floorId,
      segment: segment.id,
      type: segment.type,
      speaker: segment.speaker,
      emotion: segment.emotion,
      voiceId,
      model: tts.fish.model,
      format: tts.fish.format,
      bytes: bytes.byteLength,
      ms: Date.now() - started,
    }, { mime: blob.type, bytes: bytes.byteLength }, { fullRequest: body, floor: floor.messageId });
    return ttsStore().putAudio({
      key, kind: 'sentence', floorId: floor.floorId, chatId: floor.chatId, version: floor.version,
      segmentId: segment.id, parts: [{ blob, mime: blob.type }],
    });
  });
  return { record, cached: false };
}

/**
 * The whole floor as one recording, with every sentence's place in it.
 *
 * One request per part, usually one for the floor. Fish's word timings are merged into sentence ranges
 * right here, and the record keeps both the audio and the ranges, so clicking any sentence afterwards
 * is a seek, never another request.
 */
async function ensureFloorAudio(floor, segments, settings, onStatus = null) {
  const tts = ttsSettings(settings);
  const inRange = segmentsInRange(segments, tts.range);
  if (!inRange.length) {
    throw new Error(tts.range === 'dialogue' ? '这一楼没有对白可读。' : tts.range === 'narration' ? '这一楼没有旁白可读。' : '这一楼没有可朗读的句子。');
  }
  const plan = planVoices(inRange, ttsVoiceConfig(settings));
  if (plan.missing.length) {
    throw new Error(`这些说话人没有音色：${plan.missing.join('、')}。在「朗读」页填上 Voice ID，或者设置对白默认音色。`);
  }
  const fingerprint = fishFingerprint(tts.fish, { emotionCues: tts.emotionCues });
  const key = await floorCacheKey({
    floorId: floor.floorId, version: floor.version, range: tts.range, maxChars: tts.fish.maxChars, items: plan.items, fingerprint,
  });
  const cached = await ttsStore().getAudio(key);
  if (cached?.parts?.length && Array.isArray(cached.timeline)) return { record: cached, cached: true };
  requireFishKey(tts);
  const record = await dedupeTtsJob(key, floor.messageId, async signal => {
    const parts = planFishParts(plan.items, { model: tts.fish.model, maxChars: tts.fish.maxChars });
    const storedParts = [];
    const timeline = [];
    for (const [index, part] of parts.entries()) {
      onStatus?.(parts.length > 1 ? `正在生成整楼音频（第 ${index + 1}/${parts.length} 段）…` : '正在生成整楼音频…');
      const { body, spans } = buildFishPayload(part, tts.fish, { emotionCues: tts.emotionCues });
      let stream;
      try {
        stream = await streamFishTimestamps(body, tts.fish, signal);
      } catch (error) {
        if (!isAbortError(error)) {
          recordDiagnostic('error', 'tts.request-failed', safeError(error), {
            floor: floor.floorId, part: index + 1, parts: parts.length, model: tts.fish.model, viaProxy: tts.fish.viaProxy, status: error.status ?? null,
          }, { status: error.status ?? null, body: error.body ?? '' }, { fullRequest: body, floor: floor.messageId });
        }
        throw error;
      }
      const blob = new Blob(stream.audio.map(base64ToBytes), { type: FISH_MIME[tts.fish.format] ?? 'audio/mpeg' });
      const { timeline: spoken, duration } = buildGlobalTimeline(stream.alignments);
      const aligned = alignSpansToTimeline(spans, spoken, { duration });
      for (const entry of aligned) timeline.push({ ...entry, part: index });
      storedParts.push({ blob, mime: blob.type, duration });
      const weak = aligned.filter(entry => entry.coverage < 0.5);
      recordDiagnostic(weak.length ? 'warn' : 'info', 'tts.floor-part', weak.length
        ? `整楼音频第 ${index + 1} 段有 ${weak.length} 句没能对上时间戳，点这几句时起止位置可能不准。`
        : `整楼音频第 ${index + 1} 段已生成，每一句都对上了时间戳。`, {
        floor: floor.floorId,
        part: index + 1,
        parts: parts.length,
        sentences: part.length,
        voices: new Set(part.map(item => item.voiceId)).size,
        model: tts.fish.model,
        format: tts.fish.format,
        bytes: blob.size,
        duration: Number(duration.toFixed(2)),
        textChunks: stream.alignments.size,
        events: stream.events,
        weak: weak.map(entry => `${entry.id}（${Math.round(entry.coverage * 100)}%）`),
      }, {
        chunks: [...stream.alignments].map(([seq, chunk]) => ({ seq, offset: chunk.offset, duration: chunk.duration, content: chunk.content })),
        sentences: aligned,
      }, { fullRequest: body, floor: floor.messageId });
    }
    return ttsStore().putAudio({
      key, kind: 'floor', floorId: floor.floorId, chatId: floor.chatId, version: floor.version,
      range: tts.range, parts: storedParts, timeline,
    });
  });
  return { record, cached: false };
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
 * and would let the next sentence's first word slip out.
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
      onTime?.(audio.currentTime);
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
        .catch(() => finish('error'));
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

function highlightTtsUtterance(messageId, utteranceId) {
  for (const button of document.querySelectorAll('#chat .jy-tts-play[data-state="playing"]')) delete button.dataset.state;
  const registry = globalThis.CSS?.highlights;
  if (utteranceId === null || utteranceId === undefined) {
    runtime.tts.highlighted = null;
    registry?.delete('jy-tts-current');
    return;
  }
  runtime.tts.highlighted = { messageId, utteranceId };
  const button = ttsButton(messageId, utteranceId);
  if (button && !button.dataset.state) button.dataset.state = 'playing';
  const range = runtime.tts.ranges.get(messageId)?.get(utteranceId);
  // The Custom Highlight API paints a range without wrapping it, so the floor's DOM stays untouched.
  if (registry && typeof globalThis.Highlight === 'function' && range) registry.set('jy-tts-current', new globalThis.Highlight(range));
  else registry?.delete('jy-tts-current');
}

function ttsButton(messageId, utteranceId) {
  return document.querySelector(`#chat .mes[mesid="${messageId}"] .jy-tts-play[data-jy-tts-utt="${utteranceId}"]`);
}

function setTtsButtonState(messageId, utteranceId, state) {
  const button = ttsButton(messageId, utteranceId);
  if (!button) return;
  if (state) button.dataset.state = state;
  else delete button.dataset.state;
}

function setTtsStatus(messageId, text = '', state = 'idle') {
  if (text || state !== 'idle') runtime.tts.status.set(messageId, { text, state });
  else runtime.tts.status.delete(messageId);
  const bar = document.querySelector(`#chat .mes[mesid="${messageId}"] .jy-tts-bar`);
  if (!bar) return;
  bar.dataset.state = state;
  const label = bar.querySelector('[data-jy-tts-status]');
  if (label) label.textContent = text;
  const stop = bar.querySelector('[data-jy-tts-action="stop"]');
  if (stop) stop.hidden = !['busy', 'playing'].includes(state);
}

// A session is one thing the reader asked to hear. Starting another ends the one before it, which is
// the only way two sentences could otherwise talk over each other.
function startTtsSession(messageId) {
  const previous = runtime.tts.session;
  if (previous) {
    stopTtsPlayback();
    if (previous.messageId !== messageId) setTtsStatus(previous.messageId, '', 'idle');
  }
  const session = { messageId, id: Symbol('tts-session') };
  runtime.tts.session = session;
  return session;
}

function isTtsSession(session) {
  return runtime.tts.session === session;
}

function endTtsSession(session) {
  if (!isTtsSession(session)) return;
  runtime.tts.session = null;
  highlightTtsUtterance(session.messageId, null);
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

function stopTts(messageId = null) {
  const session = runtime.tts.session;
  runtime.tts.session = null;
  stopTtsPlayback();
  abortTtsJobs(messageId);
  if (session) setTtsStatus(session.messageId, '', 'idle');
  if (messageId !== null && messageId !== session?.messageId) setTtsStatus(messageId, '', 'idle');
}

async function playSentenceRecord(session, messageId, utteranceId, record) {
  if (!isTtsSession(session)) return 'stopped';
  highlightTtsUtterance(messageId, utteranceId);
  const url = ttsObjectUrl(`${record.key}#0`, record.parts[0].blob);
  const outcome = await playTtsAudio(url);
  if (outcome === 'error') throw new Error('浏览器播放这段音频失败。换成 mp3 格式通常能解决。');
  return outcome;
}

async function playFloorSentence(session, messageId, record, index) {
  const entry = record.timeline[index];
  const window = playbackWindow(record.timeline, index, record.parts[entry.part]?.duration);
  highlightTtsUtterance(messageId, entry.id);
  const url = ttsObjectUrl(`${record.key}#${entry.part}`, record.parts[entry.part].blob);
  const outcome = await playTtsAudio(url, { start: window.start, end: window.end });
  if (outcome === 'error') throw new Error('浏览器播放这段音频失败。换成 mp3 格式通常能解决。');
  return outcome;
}

async function playFloorFrom(session, messageId, record, fromIndex = 0) {
  const entries = record.timeline;
  const firstPart = entries[fromIndex]?.part ?? 0;
  for (let part = firstPart; part < record.parts.length && isTtsSession(session); part += 1) {
    const inPart = entries.map((entry, index) => ({ entry, index })).filter(item => item.entry.part === part);
    if (!inPart.length) continue;
    const start = part === firstPart ? playbackWindow(entries, fromIndex, record.parts[part].duration).start : 0;
    let current = null;
    const url = ttsObjectUrl(`${record.key}#${part}`, record.parts[part].blob);
    const outcome = await playTtsAudio(url, {
      start,
      onTime: time => {
        let active = inPart[0];
        for (const item of inPart) if (item.entry.start <= time + 0.05) active = item;
        if (active.entry.id === current) return;
        current = active.entry.id;
        highlightTtsUtterance(messageId, current);
        setTtsStatus(messageId, `正在朗读 · 第 ${active.index + 1}/${entries.length} 句`, 'playing');
      },
    });
    if (outcome === 'error') throw new Error('浏览器播放这段音频失败。换成 mp3 格式通常能解决。');
    if (outcome !== 'ended') return outcome;
  }
  return 'ended';
}

async function playTtsUtterance(messageId, utteranceId) {
  const session = startTtsSession(messageId);
  const settings = runtime.settings;
  const tts = ttsSettings(settings);
  setTtsButtonState(messageId, utteranceId, 'busy');
  try {
    const floor = await collectTtsFloor(messageId, settings);
    if (!floor) throw new Error('这一楼没有可朗读的译文。');
    const { segments } = await prepareTtsSegments(floor, settings, {
      onStatus: text => isTtsSession(session) && setTtsStatus(messageId, text, 'busy'),
    });
    if (!isTtsSession(session)) return;
    const segment = segments.find(item => item.id === utteranceId);
    if (!segment) throw new Error('这一句已经变了，等楼层重新渲染后再点。');
    if (tts.mode === 'floor') {
      const { record, cached } = await ensureFloorAudio(floor, segments, settings, text => isTtsSession(session) && setTtsStatus(messageId, text, 'busy'));
      if (!isTtsSession(session)) return;
      const index = record.timeline.findIndex(entry => entry.id === utteranceId);
      if (index < 0) throw new Error('这一句不在当前的朗读范围里。');
      setTtsStatus(messageId, cached ? '整楼音频已缓存' : '整楼音频已生成', 'playing');
      setTtsButtonState(messageId, utteranceId, null);
      await playFloorSentence(session, messageId, record, index);
    } else {
      setTtsStatus(messageId, '正在生成这一句…', 'busy');
      const { record } = await ensureSentenceAudio(floor, segment, settings);
      if (!isTtsSession(session)) return;
      setTtsStatus(messageId, '', 'playing');
      setTtsButtonState(messageId, utteranceId, null);
      await playSentenceRecord(session, messageId, segment.id, record);
    }
    if (isTtsSession(session)) setTtsStatus(messageId, '', 'idle');
  } catch (error) {
    if (isAbortError(error) || !isTtsSession(session)) return;
    setTtsStatus(messageId, safeError(error), 'error');
    toast('error', safeError(error));
  } finally {
    setTtsButtonState(messageId, utteranceId, null);
    endTtsSession(session);
  }
}

async function playTtsFloor(messageId) {
  const session = startTtsSession(messageId);
  const settings = runtime.settings;
  const tts = ttsSettings(settings);
  setTtsStatus(messageId, '准备朗读…', 'busy');
  try {
    const floor = await collectTtsFloor(messageId, settings);
    if (!floor) throw new Error('这一楼没有可朗读的译文。');
    const { segments } = await prepareTtsSegments(floor, settings, {
      onStatus: text => isTtsSession(session) && setTtsStatus(messageId, text, 'busy'),
    });
    if (!isTtsSession(session)) return;
    if (tts.mode === 'floor') {
      const { record } = await ensureFloorAudio(floor, segments, settings, text => isTtsSession(session) && setTtsStatus(messageId, text, 'busy'));
      if (!isTtsSession(session)) return;
      await playFloorFrom(session, messageId, record, 0);
    } else {
      const list = segmentsInRange(segments, tts.range);
      if (!list.length) throw new Error('当前朗读范围里没有句子。');
      for (const [index, segment] of list.entries()) {
        if (!isTtsSession(session)) break;
        setTtsStatus(messageId, `第 ${index + 1}/${list.length} 句 · 生成中…`, 'busy');
        const { record } = await ensureSentenceAudio(floor, segment, settings);
        if (!isTtsSession(session)) break;
        // The next sentence is fetched while this one plays, so a continuous read has no gaps.
        const next = list[index + 1];
        if (next) void ensureSentenceAudio(floor, next, settings).catch(() => {});
        setTtsStatus(messageId, `正在朗读 · 第 ${index + 1}/${list.length} 句`, 'playing');
        const outcome = await playSentenceRecord(session, messageId, segment.id, record);
        if (outcome === 'stopped') break;
      }
    }
    if (isTtsSession(session)) setTtsStatus(messageId, '', 'idle');
  } catch (error) {
    if (isAbortError(error) || !isTtsSession(session)) return;
    setTtsStatus(messageId, safeError(error), 'error');
    toast('error', safeError(error));
  } finally {
    endTtsSession(session);
  }
}

// ---------------------------------------------------------------------------------------------
// Reading aloud: buttons on the rendered floor.
// ---------------------------------------------------------------------------------------------

function ttsMessageText(messageId) {
  return document.querySelector(`#chat .mes[mesid="${messageId}"] .mes_text`);
}

function clearTtsDecoration(root) {
  if (!root) return;
  for (const node of root.querySelectorAll('.jy-tts-play, .jy-tts-bar')) node.remove();
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

function makeTtsPlayButton(messageId, segment) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'jy-tts-play';
  button.dataset.jyTtsAction = 'play';
  button.dataset.jyTtsMes = String(messageId);
  button.dataset.jyTtsUtt = String(segment.id);
  button.dataset.jyTtsType = segment.type;
  button.setAttribute('contenteditable', 'false');
  const label = segment.type === 'narration' ? '朗读这句旁白' : `朗读这句对白${segment.speaker ? `（${segment.speaker}）` : ''}`;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = TTS_ICON_PLAY;
  return button;
}

// Which built-in beautify a rendered floor wears. The bar sits after the cards rather than inside one,
// so it is told the style instead of inheriting it.
function readingStyleOf(root) {
  for (const style of ['cute', 'minimal', 'fold']) {
    if (root.querySelector(`.jy-reading-${style}, .custom-jy-reading-${style}`)) return style;
  }
  return '';
}

function makeTtsBar(messageId, tts, count, readingStyle = '') {
  const bar = document.createElement('div');
  bar.className = 'jy-tts-bar';
  bar.dataset.jyTtsMes = String(messageId);
  if (readingStyle) bar.dataset.jyReading = readingStyle;
  bar.setAttribute('contenteditable', 'false');
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'jy-tts-bar-play';
  play.dataset.jyTtsAction = 'play-floor';
  play.dataset.jyTtsMes = String(messageId);
  play.innerHTML = `${TTS_ICON_PLAY}<span>朗读本楼</span>`;
  const meta = document.createElement('span');
  meta.className = 'jy-tts-bar-meta';
  meta.textContent = `${tts.side === 'source' ? '读原文' : '读译文'} · ${tts.mode === 'floor' ? '整篇发送' : '单句发送'} · ${TTS_RANGE_LABELS[tts.range]} · ${count} 句`;
  const status = document.createElement('span');
  status.className = 'jy-tts-bar-status';
  status.dataset.jyTtsStatus = '';
  status.setAttribute('aria-live', 'polite');
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'jy-tts-bar-stop';
  stop.dataset.jyTtsAction = 'stop';
  stop.dataset.jyTtsMes = String(messageId);
  stop.hidden = true;
  stop.innerHTML = `${TTS_ICON_STOP}<span>停止</span>`;
  bar.append(play, meta, status, stop);
  return bar;
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
  const floor = await collectTtsFloor(messageId, settings);
  if (ttsMessageText(messageId) !== root) return;
  if (!floor) {
    if (root.dataset.jyTts) clearTtsDecoration(root);
    return;
  }
  // A floor whose text changed still has recordings and labels of the old text in the store. They can
  // never be played again, so they go the first time the new text is seen.
  if (runtime.tts.pruned.get(floor.floorId) !== floor.version) {
    runtime.tts.pruned.set(floor.floorId, floor.version);
    void ttsStore().pruneFloor(floor.floorId, floor.version).catch(() => {});
  }
  const labels = runtime.tts.labels.get(ttsLabelKey(floor)) ?? labelsFromAnnotations(splitUtterances(floor.lines), floor.annotations);
  const signature = `${floor.side}|${floor.version}|${tts.mode}|${tts.range}|${runtime.tts.labels.has(ttsLabelKey(floor)) ? 'analyzed' : 'plain'}`;
  if (!force && root.dataset.jyTts === signature && root.querySelector(':scope > .jy-tts-bar')) return;

  clearTtsDecoration(root);
  const utterances = splitUtterances(floor.lines);
  const segments = buildSegments(utterances, labels, { knownNames: ttsKnownNames(settings) });
  const visible = segmentsInRange(segments, tts.range);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => (node.parentElement?.closest('.jy-tts-play, .jy-tts-bar, script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const found = locateAnchors(nodes.map(node => node.data), floor.lines, utterances.map(item => ({ id: item.id, lineId: item.lineId, text: item.anchor })));
  // Ranges are made before anything is inserted; they are live, so the insertions below move them along.
  const ranges = new Map();
  for (const utterance of utterances) {
    const hit = found.get(utterance.id);
    if (!hit) continue;
    const range = document.createRange();
    range.setStart(nodes[hit.start.node], hit.start.offset);
    range.setEnd(nodes[hit.end.node], hit.end.offset);
    ranges.set(utterance.id, range);
  }
  let placed = 0;
  for (const segment of [...visible].reverse()) {
    const range = ranges.get(segment.id);
    if (!range) continue;
    insertAfterRange(range, makeTtsPlayButton(messageId, segment), root);
    placed += 1;
  }
  root.appendChild(makeTtsBar(messageId, tts, visible.length, readingStyleOf(root)));
  root.dataset.jyTts = signature;
  runtime.tts.ranges.set(messageId, ranges);
  const status = runtime.tts.status.get(messageId);
  if (status) setTtsStatus(messageId, status.text, status.state);
  // A floor redrawn mid-sentence gets its highlight back on the new text.
  const highlighted = runtime.tts.highlighted;
  if (highlighted?.messageId === messageId && runtime.tts.session?.messageId === messageId) {
    highlightTtsUtterance(messageId, highlighted.utteranceId);
  }
  const warnKey = `${floor.floorId}|${signature}`;
  if (placed < visible.length && !runtime.tts.anchorWarned.has(warnKey)) {
    runtime.tts.anchorWarned.add(warnKey);
    recordDiagnostic('warn', 'tts.anchors', `第 ${messageId} 楼有 ${visible.length - placed} 句没在渲染后的楼层里找到位置，这几句没有单独的播放按钮，「朗读本楼」照常能读到。`, {
      floor: floor.floorId,
      readable: visible.length,
      placed,
      source: floor.source,
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

function scheduleTtsDecorateAll(options = {}) {
  if (typeof document === 'undefined') return;
  for (const element of document.querySelectorAll('#chat .mes[mesid]')) scheduleTtsDecorate(Number(element.getAttribute('mesid')), options);
}

function clearAllTtsDecorations() {
  if (typeof document === 'undefined') return;
  const roots = new Set(document.querySelectorAll('#chat .mes_text[data-jy-tts]'));
  for (const element of document.querySelectorAll('#chat .jy-tts-bar, #chat .jy-tts-play')) {
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
      const target = event.target instanceof Element ? event.target.closest('[data-jy-tts-action]') : null;
      if (!target || !target.closest('#chat')) return;
      event.preventDefault();
      event.stopPropagation();
      const messageId = Number(target.dataset.jyTtsMes);
      const action = target.dataset.jyTtsAction;
      if (action === 'stop') stopTts(messageId);
      else if (action === 'play-floor') void playTtsFloor(messageId);
      else if (action === 'play') {
        const utteranceId = Number(target.dataset.jyTtsUtt);
        if (target.dataset.state === 'playing' && runtime.tts.session?.messageId === messageId) stopTts(messageId);
        else void playTtsUtterance(messageId, utteranceId);
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
      for (const id of ids) {
        const text = ttsMessageText(id);
        if (text && !text.querySelector(':scope > .jy-tts-bar')) scheduleTtsDecorate(Number(id), { delay: 400 });
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

function setText(root, selector, value) {
  const element = root.querySelector(selector);
  if (element) element.textContent = String(value);
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

function syncChannelFields(root, settings) {
  const select = root.querySelector('[data-jy-field="selectedChannelId"]');
  if (select) {
    select.replaceChildren(...settings.channels.map(channel => {
      const option = document.createElement('option');
      option.value = channel.id;
      option.textContent = channel.name;
      return option;
    }));
    select.value = settings.selectedChannelId;
  }
  const channel = getActiveChannel(settings);
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
  setText(root, '[data-jy-channel-name]', independent ? channel.name : '跟随当前连接');
  setText(root, '[data-jy-channel-mode]', independent ? '副 API' : '主 API');
  setText(
    root,
    '[data-jy-channel-summary]',
    independent
      ? `${channel.model || '尚未选择模型'} · 目标：${normalizeTargetLanguage(promptProfile.targetLanguage)} · ${channel.url || '尚未填写地址'}`
      : `使用酒馆当前连接进行翻译。目标：${normalizeTargetLanguage(promptProfile.targetLanguage)}。`,
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
  const radio = root.querySelector('[data-jy-field="apiMode"]:checked');
  if (radio) current.apiMode = radio.value;
  for (const name of [
    'autoGeneration',
    'autoSwipe',
    'autoEdit',
    'streamingWriteback',
    'showFloatingButton',
    'paragraphPerLine',
    'carryFormatting',
    'includeWorldbook',
    'includeCharacterCard',
    'includeRecentContext',
  ]) {
    const element = root.querySelector(`[data-jy-field="${name}"]`);
    if (element) current[name] = element.checked;
  }
  for (const name of ['segmentPrefix', 'segmentSuffix', 'translationPrefix', 'translationSuffix', 'preserveLineRules', 'floatingStyle']) {
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
  const selected = root.querySelector('[data-jy-field="selectedChannelId"]')?.value;
  if (selected && current.channels.some(channel => channel.id === selected)) current.selectedChannelId = selected;
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

const TTS_NUMERIC_FISH_FIELDS = new Set(['speed', 'volume', 'temperature', 'topP', 'maxChars', 'timeoutSec', 'mp3Bitrate']);

function ttsVoiceRowElement(doc, voice) {
  const row = doc.createElement('div');
  row.className = 'jy-tts-voice-row';
  row.dataset.jyTtsVoiceRow = '';
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
  const voiceId = doc.createElement('input');
  voiceId.type = 'text';
  voiceId.placeholder = 'Voice ID';
  voiceId.spellcheck = false;
  voiceId.dataset.jyTtsVoiceId = '';
  voiceId.value = voice.voiceId ?? '';
  const title = doc.createElement('span');
  title.className = 'jy-tts-title';
  title.dataset.jyTtsVoiceTitle = '';
  title.textContent = voice.title ? voice.title : '';
  const remove = doc.createElement('button');
  remove.type = 'button';
  remove.className = 'jy-text-button';
  remove.dataset.jyAction = 'tts-remove-voice';
  remove.textContent = '移除';
  row.append(name, aliases, voiceId, title, remove);
  return row;
}

function renderTtsVoiceList(root, settings = runtime.settings) {
  const list = root.querySelector('[data-jy-tts-voice-list]');
  if (!list) return;
  const doc = list.ownerDocument;
  const voices = ttsVoicesFor(settings);
  list.replaceChildren();
  if (!voices.length) {
    const note = doc.createElement('p');
    note.className = 'jy-muted';
    note.textContent = '还没有登记角色音色。没登记的角色会用对白默认音色。';
    list.appendChild(note);
    return;
  }
  for (const voice of voices) list.appendChild(ttsVoiceRowElement(doc, voice));
}

function updateTtsProxyHelp(root) {
  const proxy = root.querySelector('[data-jy-tts-fish="viaProxy"]');
  const help = root.querySelector('[data-jy-tts-proxy-help]');
  if (!help) return;
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
    const value = key === 'sourceTags' ? tts.sourceTags.join(', ') : tts[key];
    if (element.type === 'radio') element.checked = element.value === String(value);
    else if (element.type === 'checkbox') element.checked = value === true;
    else element.value = value ?? '';
  }
  for (const element of root.querySelectorAll('[data-jy-tts-fish]')) {
    const value = tts.fish[element.dataset.jyTtsFish];
    if (element.type === 'checkbox') element.checked = value === true;
    else element.value = value ?? '';
  }
  setText(root, '[data-jy-tts-title="narrator"]', tts.narratorTitle ? `· ${tts.narratorTitle}` : '');
  setText(root, '[data-jy-tts-title="dialogue"]', tts.dialogueTitle ? `· ${tts.dialogueTitle}` : '');
  renderTtsVoiceList(root, settings);
  updateTtsProxyHelp(root);
  renderTtsPreview(root);
  syncTtsFeatureVisibility(root, settings);
  // The audio store is opened only for someone who reads aloud.
  if (tts.enabled) void renderTtsUsage(root);
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
  for (const [field, title] of [['narratorVoice', 'narratorTitle'], ['dialogueVoice', 'dialogueTitle']]) {
    if (next[field] && next[field] !== normalizeTts({ [field]: next[field] })[field]) throw new Error(`「${field === 'narratorVoice' ? '旁白音色' : '对白默认音色'}」不是有效的 Voice ID。`);
    if (next[field] !== previous[field]) next[title] = '';
  }
  current.tts = normalizeTts(next);
  if (!root.querySelector('[data-jy-tts-voice-list]')) return;
  const rows = [...root.querySelectorAll('[data-jy-tts-voice-row]')].map(row => {
    const voiceId = row.querySelector('[data-jy-tts-voice-id]')?.value.trim() ?? '';
    return {
      name: row.querySelector('[data-jy-tts-voice-name]')?.value ?? '',
      aliases: row.querySelector('[data-jy-tts-voice-aliases]')?.value ?? '',
      voiceId,
      title: voiceId === row.dataset.voiceId ? row.dataset.title : '',
    };
  });
  const list = normalizeVoiceList(rows);
  current.ttsVoices = { ...(current.ttsVoices || {}) };
  const characterKey = worldInfoCharacterKey();
  if (list.length) current.ttsVoices[characterKey] = list;
  else delete current.ttsVoices[characterKey];
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
  const inRange = new Set(segmentsInRange(preview.segments, tts.range).map(segment => segment.id));
  const head = doc.createElement('p');
  head.className = 'jy-muted';
  head.textContent = `第 ${preview.messageId} 楼 · ${preview.segments.length} 句 · ${preview.source === 'translation' ? '读的是镜译译文' : '读的是来源标签里的文字'} · 标注来自${preview.analyzed ? '副模型分析' : '翻译时的标注与引号'}`;
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
      ? `${EMOTION_STYLES[segment.emotion]?.label ?? segment.emotion}${segment.intensity === 2 ? ' · 强' : segment.intensity === 0 ? ' · 弱' : ''}`
      : '—';
    const voice = doc.createElement('span');
    voice.className = 'jy-tts-preview-voice';
    const voiceId = resolveSegmentVoice(segment, config);
    voice.textContent = voiceId ? voiceId.slice(0, 8) : '没有音色';
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
    analyzed: runtime.tts.labels.has(ttsLabelKey(floor)),
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

function updateApiPanels(root) {
  const mode = root.querySelector('[data-jy-field="apiMode"]:checked')?.value || runtime.settings.apiMode;
  const panel = root.querySelector('[data-jy-independent-panel]');
  if (panel) panel.hidden = mode !== 'independent';
  setText(
    root,
    '[data-jy-api-help]',
    mode === 'independent'
      ? '使用镜译单独保存的 OpenAI 兼容地址、密钥和模型，不改变主聊天连接。'
      : '使用酒馆当前已连接的 API 和模型。',
  );
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
        await testTranslationChannel();
      } else if (action === 'refresh') {
        await refreshCurrentCard(root);
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
        next.channels.push(normalizeChannel({ ...DEFAULT_CHANNEL, id, name: `副 API ${next.channels.length + 1}` }, id));
        next.selectedChannelId = id;
        saveSettings(next);
        syncFields(root, runtime.settings);
        toast('success', '已新增一个副 API 预设。');
      } else if (action === 'delete-channel') {
        const next = collectSettings(root);
        if (next.channels.length <= 1) throw new Error('至少保留一个副 API 预设。');
        next.channels = next.channels.filter(channel => channel.id !== next.selectedChannelId);
        next.selectedChannelId = next.channels[0].id;
        saveSettings(next);
        syncFields(root, runtime.settings);
        toast('success', '当前副 API 预设已删除。');
      } else if (action === 'fetch-models') {
        saveSettings(collectSettings(root));
        await fetchChannelModels();
        syncFields(root, runtime.settings);
        toast('success', `模型列表已更新，共 ${getActiveChannel(runtime.settings).models.length} 个，请选择需要使用的模型。`);
      } else if (action === 'save-channel') {
        saveSettings(collectSettings(root));
        syncFields(root, runtime.settings);
        toast('success', '当前副 API 预设已保存。');
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
      } else if (action === 'tts-add-voice') {
        const list = root.querySelector('[data-jy-tts-voice-list]');
        if (list) {
          if (list.querySelector('.jy-muted')) list.replaceChildren();
          list.appendChild(ttsVoiceRowElement(list.ownerDocument, { name: '', aliases: [], voiceId: '', title: '' }));
          list.querySelector('[data-jy-tts-voice-row]:last-child [data-jy-tts-voice-name]')?.focus();
        }
      } else if (action === 'tts-remove-voice') {
        button.closest('[data-jy-tts-voice-row]')?.remove();
        saveSettings(collectSettings(root));
        renderTtsVoiceList(root, runtime.settings);
      } else if (action === 'tts-import-speakers') {
        // Everyone this extension already knows by name: the colour palette, the speakers the model
        // reported while translating, and the ones the last analysis found.
        const next = collectSettings(root);
        const characterKey = worldInfoCharacterKey();
        const existing = normalizeVoiceList(next.ttsVoices?.[characterKey]);
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
          added.push({ name: candidate.name, aliases: candidate.aliases ?? [], voiceId: '', title: '' });
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
        const ids = [...new Set([tts.narratorVoice, tts.dialogueVoice, ...ttsVoicesFor(next).map(item => item.voiceId)].filter(Boolean))];
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
        if (voices.length) next.ttsVoices = { ...(next.ttsVoices || {}), [worldInfoCharacterKey()]: voices };
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
        const removed = await ttsStore().clearChat(getCurrentChatId());
        runtime.tts.labels.clear();
        await renderTtsUsage(root);
        toast('success', `已清掉本聊天的 ${removed} 条朗读缓存。`);
      } else if (action === 'tts-clear-all') {
        await ttsStore().clear();
        runtime.tts.labels.clear();
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
    if (event.target.matches('[data-jy-field="apiMode"], [data-jy-field="selectedChannelId"]')) {
      saveSettings(collectSettings(root));
      syncFields(root, runtime.settings);
    }
    if (event.target.matches('[data-jy-field="floatingStyle"]')) {
      saveSettings(collectSettings(root));
      syncFloatingEntry();
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
    if (event.target.matches('[data-jy-tts-field="enabled"], [data-jy-tts-field="side"], [data-jy-tts-field="mode"], [data-jy-tts-field="range"], [data-jy-tts-field="analysis"], [data-jy-tts-field="emotionCues"], [data-jy-tts-fish="model"], [data-jy-tts-fish="viaProxy"], [data-jy-tts-fish="format"], [data-jy-tts-fish="latency"]')) {
      // The feature switch lives on two pages; the one just clicked decides, the other follows.
      if (event.target.matches('[data-jy-tts-field="enabled"]')) {
        for (const twin of root.querySelectorAll('[data-jy-tts-field="enabled"]')) twin.checked = event.target.checked;
      }
      try {
        saveSettings(collectSettings(root));
        syncTtsFields(root, runtime.settings);
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
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;';
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

async function openMiniWindow() {
  if (runtime.mini?.host?.isConnected) return runtime.mini;
  document.getElementById(MINI_HOST_ID)?.remove();

  const settings = runtime.settings;
  const host = document.createElement('div');
  host.id = MINI_HOST_ID;
  host.dataset.jingyiVersion = APP_VERSION;
  host.dataset.theme = settings.theme || 'day';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147482950;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = await loadPanelCss();

  const win = document.createElement('section');
  win.className = 'jy-mini';
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-label', `${APP_NAME} 悬浮窗`);
  win.innerHTML = `
<div class="jy-mini-bar" data-jy-mini-drag>
  <span class="jy-mini-mark" aria-hidden="true">镜</span>
  <span class="jy-mini-name">镜译<span class="jy-dot" data-jy-task-dot="idle"></span></span>
  <button type="button" data-jy-action="mini-expand" aria-label="展开控制中心" title="展开控制中心">⤢</button>
  <button type="button" data-jy-action="mini-collapse" aria-label="收起悬浮窗" title="收起">−</button>
</div>
<div class="jy-mini-body">
  <div class="jy-mini-status">
    <div class="jy-mini-status-top"><strong data-jy-task-title>等待正文</strong><span data-jy-mini-floor>—</span></div>
    <div class="jy-progress" aria-hidden="true"><span data-jy-progress></span></div>
    <p class="jy-muted" data-jy-task-message></p>
  </div>
  <div class="jy-mini-actions">
    <button type="button" class="jy-button" data-jy-action="mini-translate">翻译本楼</button>
    <button type="button" class="jy-button" data-jy-action="mini-stop" hidden>停止</button>
    <button type="button" class="jy-button" data-jy-action="mini-refresh">刷新楼层</button>
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
  <div class="jy-mini-quick">
    <label><span class="jy-label">模型</span><select data-jy-mini-channel></select></label>
    <label><span class="jy-label">方案</span><select data-jy-mini-profile></select></label>
  </div>
</div>`;
  shadow.append(style, win);
  document.body.appendChild(host);

  const bar = win.querySelector('[data-jy-mini-drag]');
  const input = win.querySelector('[data-jy-mini-input]');
  const resultBox = win.querySelector('[data-jy-mini-result]');
  const output = win.querySelector('[data-jy-mini-output]');
  const meta = win.querySelector('[data-jy-mini-meta]');
  const scratch = win.querySelector('[data-jy-mini-scratch]');
  const scratchSummary = scratch.querySelector('summary');
  const channelSelect = win.querySelector('[data-jy-mini-channel]');
  const profileSelect = win.querySelector('[data-jy-mini-profile]');

  const syncQuickPickers = () => {
    const current = runtime.settings;
    channelSelect.replaceChildren();
    if (current.apiMode === 'independent') {
      for (const channel of current.channels) {
        const option = document.createElement('option');
        option.value = channel.id;
        option.textContent = channel.model ? `${channel.name} · ${channel.model}` : channel.name;
        channelSelect.appendChild(option);
      }
      channelSelect.value = current.selectedChannelId;
      channelSelect.disabled = false;
    } else {
      const option = document.createElement('option');
      option.value = 'follow';
      option.textContent = '跟随酒馆当前连接';
      channelSelect.appendChild(option);
      channelSelect.value = 'follow';
      channelSelect.disabled = true;
    }
    profileSelect.replaceChildren();
    for (const profile of current.promptProfiles) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = `${profile.name} · ${normalizeTargetLanguage(profile.targetLanguage)}`;
      profileSelect.appendChild(option);
    }
    profileSelect.value = current.selectedPromptProfileId;
    setText(win, '[data-jy-mini-target]', normalizeTargetLanguage(getActivePromptProfile(current).targetLanguage));
  };
  syncQuickPickers();

  const position = anchorMiniPosition(win);
  const place = (x, y) => {
    const width = win.offsetWidth || 344;
    const height = win.offsetHeight || 320;
    position.x = Math.min(Math.max(8, x), Math.max(8, globalThis.innerWidth - width - 8));
    position.y = Math.min(Math.max(8, y), Math.max(8, globalThis.innerHeight - height - 8));
    win.style.left = `${position.x}px`;
    win.style.top = `${position.y}px`;
  };
  place(position.x, position.y);

  let userMoved = false;
  // Status text and the floor label land after the first layout and can add a line, so the window
  // is re-hung once the content settles; a window the user dragged only gets clamped back into view.
  const reanchor = () => {
    if (userMoved) {
      place(position.x, position.y);
      return;
    }
    const next = anchorMiniPosition(win);
    place(next.x, next.y);
  };
  globalThis.requestAnimationFrame?.(() => { if (win.isConnected) reanchor(); });

  let pointerId = null;
  let grabX = 0;
  let grabY = 0;
  const onPointerDown = event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault();
    pointerId = event.pointerId;
    grabX = event.clientX - position.x;
    grabY = event.clientY - position.y;
    bar.classList.add('is-dragging');
    bar.setPointerCapture?.(event.pointerId);
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
  };
  const onResize = () => reanchor();

  const unsubscribe = subscribeTask(task => {
    setText(win, '[data-jy-task-title]', task.title);
    setText(win, '[data-jy-task-message]', task.message);
    const dot = win.querySelector('[data-jy-task-dot]');
    if (dot) dot.dataset.jyTaskDot = task.status;
    const progress = win.querySelector('[data-jy-progress]');
    if (progress) progress.style.transform = `scaleX(${Math.max(0, Math.min(1, (Number(task.progress) || 0) / 100))})`;
    // Only one of the two is ever useful, so they take turns instead of sitting there greyed out.
    const running = task.status === 'running';
    const stop = win.querySelector('[data-jy-action="mini-stop"]');
    const translate = win.querySelector('[data-jy-action="mini-translate"]');
    if (stop) stop.hidden = !running;
    if (translate) translate.hidden = running;
  });

  const refreshFloor = async () => {
    try {
      const snapshot = await readMessageSnapshot();
      setText(win, '[data-jy-mini-floor]', `第 ${snapshot.messageId} 楼 · ${snapshot.segments.length} 行`);
    } catch {
      setText(win, '[data-jy-mini-floor]', '无可译楼层');
    }
    if (win.isConnected) reanchor();
  };
  refreshFloor();

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    win.dataset.closing = 'true';
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
    channelSelect.removeEventListener('change', onQuickChange);
    profileSelect.removeEventListener('change', onQuickChange);
    unsubscribe();
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
  const onWindowKeydown = event => {
    if (event.key !== 'Escape' || !runtime.mini?.host?.isConnected) return;
    event.preventDefault();
    close();
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
      // Reading a layout property commits the collapsed start state; rAF is throttled to nothing in
      // a backgrounded tab and would leave the drawer stuck shut.
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
    if (event.target === channelSelect) next.selectedChannelId = channelSelect.value;
    else next.selectedPromptProfileId = profileSelect.value;
    saveSettings(next);
    syncQuickPickers();
  };

  const onClick = async event => {
    const button = event.target.closest('[data-jy-action]');
    if (!button) return;
    const action = button.dataset.jyAction;
    if (action === 'mini-collapse') { close(); return; }
    if (action === 'mini-expand') { close(); openControlCenter().catch(error => toast('error', safeError(error))); return; }
    if (action === 'mini-copy') {
      try {
        await navigator.clipboard.writeText(output.textContent || '');
        toast('success', '译文已复制。');
      } catch (error) { toast('error', safeError(error)); }
      return;
    }
    const original = button.textContent;
    button.disabled = true;
    try {
      // The mini window used to bypass streaming entirely, so the writeback toggle looked dead
      // whenever a translation was started from the floating entry instead of the control centre.
      if (action === 'mini-translate') await startTranslation(null, { force: true });
      else if (action === 'mini-repair') await startTranslation(null, { force: false });
      else if (action === 'mini-refresh') await refreshFloor();
      else if (action === 'mini-stop') {
        for (const entry of runtime.inflight.values()) entry.controller.abort();
        toast('info', '已请求停止当前翻译。');
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
      if (action === 'mini-translate' || action === 'mini-repair') await refreshFloor();
    } catch (error) {
      toast('error', safeError(error));
    } finally {
      button.textContent = original;
      button.disabled = false;
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
  channelSelect.addEventListener('change', onQuickChange);
  profileSelect.addEventListener('change', onQuickChange);
  globalThis.addEventListener('pointermove', onPointerMove);
  globalThis.addEventListener('pointerup', finishPointer);
  globalThis.addEventListener('pointercancel', finishPointer);
  globalThis.addEventListener('resize', onResize);

  runtime.mini = { host, close, syncQuickPickers };
  return runtime.mini;
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

function scheduleAuto(messageId, reason) {
  const timer = globalThis.setTimeout(async () => {
    runtime.autoTimers.delete(timer);
    try {
      const settings = runtime.settings;
      if (reason === 'generation' && !settings.autoGeneration) return;
      if (reason === 'swipe' && !settings.autoSwipe) return;
      if (reason === 'edit' && !settings.autoEdit) return;
      await startTranslation(Number(messageId), { force: reason === 'edit', quiet: true });
    } catch (error) {
      if (isAbortError(error)) return;
      const message = safeError(error);
      if (!/没有找到|正文标签|已经翻译|不是普通 AI 回复/.test(message)) toast('error', message);
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
    runtime.generationGate.begin(getCurrentChatId(), type, dryRun);
  });
  bindEvent(eventTypes.CHARACTER_MESSAGE_RENDERED, (messageId, type) => {
    if (runtime.generationGate.consume(getCurrentChatId(), type)) {
      runtime.mainGenerationActive = false;
      verifyGenerationInterceptor();
      scheduleAuto(messageId, 'generation');
    }
  });
  bindEvent(eventTypes.GENERATION_STOPPED, () => { runtime.mainGenerationActive = false; runtime.generationGate.clear(); });
  bindEvent(eventTypes.MESSAGE_SWIPED, messageId => scheduleAuto(messageId, 'swipe'));
  bindEvent(eventTypes.MESSAGE_EDITED, messageId => scheduleAuto(messageId, 'edit'));
  // Floor buttons follow every redraw the host announces; the observer in bindTtsDom catches the rest.
  bindEvent(eventTypes.CHARACTER_MESSAGE_RENDERED, messageId => scheduleTtsDecorate(Number(messageId)));
  bindEvent(eventTypes.MESSAGE_UPDATED, messageId => scheduleTtsDecorate(Number(messageId), { force: true }));
  bindEvent(eventTypes.MESSAGE_SWIPED, messageId => {
    if (runtime.tts.session?.messageId === Number(messageId)) stopTts(Number(messageId));
    scheduleTtsDecorate(Number(messageId), { force: true, delay: 300 });
  });
  bindEvent(eventTypes.MESSAGE_DELETED, () => {
    stopTts();
    scheduleTtsDecorateAll({ force: true, delay: 300 });
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
    cancelPendingWork();
    scheduleEntries();
    // The speaker palette is per character card, so a different chat may need a different sheet.
    syncSpeakerStylesheet(runtime.settings);
    if (runtime.panel?.controller?.root) refreshCurrentCard(runtime.panel.controller.root);
    // Message ids restart in another chat; nothing playing or pending can carry over.
    stopTts();
    runtime.tts.ranges.clear();
    runtime.tts.status.clear();
    runtime.tts.preview = null;
    scheduleTtsDecorateAll({ force: true });
  });
}

function cleanupRuntime() {
  runtime.processingRevision += 1;
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
  if (typeof document !== 'undefined') document.getElementById(SPEAKER_STYLE_ID)?.remove();
  runtime.subscribers.clear();
  runtime.diagnosticSubscribers.clear();
  runtime.initialized = false;
}

export function interceptGeneration(chat, _contextSize, _abort, type) {
  runtime.interceptorSeen = true;
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

globalThis[INTERCEPTOR_NAME] = interceptGeneration;

export async function onActivate() {
  if (runtime.initialized) return;
  runtime.epoch += 1;
  globalThis[INTERCEPTOR_NAME] = interceptGeneration;
  initializeSettings();
  runtime.initialized = true;
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
  ensureSentenceAudio,
  ensureFloorAudio,
  ttsStore,
});

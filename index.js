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
} from './core.js?v=0.13.0';
import {
  VISUAL_FIELDS, REGEX_OWNER_KEY,
  normalizeProcessingSettings, getActiveProcessingProfile,
  captureProcessingProfile, selectProcessingProfile, exportProcessingProfile, importProcessingProfile,
  importNativeRegex, makeBuiltinReadingProfile, syncNativeRegex, readNativeRegexEdits,
} from './processing.js?v=0.13.0';
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
  countPromptCharacters,
  findForbiddenPhraseHits,
  isSimplifiedChineseTarget,
  normalizeTargetLanguage,
  promptOptionLabel,
} from './prompts.js?v=0.13.0';
import { buildTranslationMessages, collectTranslationContext } from './workflow.js?v=0.13.0';
import {
  addDiagnostic,
  clearDiagnostics,
  formatFullDiagnosticReport,
  listDiagnosticFloors,
  readDiagnostics,
} from './diagnostics.js?v=0.13.0';

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
  subscribers: new Set(),
  diagnosticSubscribers: new Set(),
  update: { status: 'idle', installType: null, details: null },
  inflight: new Map(),
  generationGate: createGenerationGate(),
  eventBindings: [],
  wiEntries: null,
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
};

const CONTROL_CENTER_MARKUP = `
<div class="jy-studio" data-jy-root>
<aside class="jy-rail">
  <div class="jy-identity"><span class="jy-monogram" aria-hidden="true">镜</span><div><strong>镜译</strong><small>正文翻译器</small></div></div>
  <nav class="jy-navigation" role="tablist" aria-label="工作区">
  <button type="button" role="tab" aria-selected="true" data-jy-tab="main"><span aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v14H4z"/><path d="M4 10h16"/><path d="M9 14h6"/></svg></span>翻译台</button><button type="button" role="tab" aria-selected="false" data-jy-tab="prompt"><span aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h9l5 5v11H5z"/><path d="M14 4v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/></svg></span>翻译规则</button><button type="button" role="tab" aria-selected="false" data-jy-tab="settings"><span aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/></svg></span>模型连接</button><button type="button" role="tab" aria-selected="false" data-jy-tab="processing"><span aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v16"/><path d="M15 4v16"/><path d="M4 9h16"/><path d="M4 15h16"/></svg></span>正文处理</button><button type="button" role="tab" aria-selected="false" data-jy-tab="logs"><span aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/></svg></span>运行记录</button>
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
  <dl class="jy-desk-facts"><div><dt>当前楼层</dt><dd data-jy-floor>—</dd></div><div><dt>滑动页</dt><dd data-jy-swipe>—</dd></div><div><dt>正文规模</dt><dd data-jy-segments>—</dd></div><div><dt>目标语言</dt><dd data-jy-desk-target>—</dd></div></dl>
  <div class="jy-launch"><button type="button" class="jy-button jy-button-primary" data-jy-action="translate">翻译当前回复</button><button type="button" class="jy-button" data-jy-action="translate-missing">补译缺失段落</button><button type="button" class="jy-button" data-jy-action="translate-stream">流式翻译</button></div>
 </div>
 <aside class="jy-desk-side">
  <div class="jy-brief"><span class="jy-overline">翻译方案</span><h3 data-jy-active-profile>待读取</h3><button type="button" class="jy-button" data-jy-action="open-prompt">编辑规则 →</button></div>
  <div class="jy-brief"><span class="jy-overline">当前连接</span><h3 data-jy-channel-name>跟随当前连接</h3><span class="jy-badge" data-jy-channel-mode>主 API</span><p class="jy-muted" data-jy-channel-summary></p><button type="button" class="jy-button" data-jy-action="open-settings">管理连接 →</button></div>
  <div class="jy-brief"><span class="jy-overline">参考资料</span><p class="jy-muted" data-jy-context-summary></p></div>
 </aside>
</div>
<div class="jy-automation"><div><h3>自动接续翻译</h3><p class="jy-muted">主回复完成后，自动补上译文。</p></div><label class="jy-switch"><input type="checkbox" data-jy-field="autoGeneration" aria-label="主回复完成后自动翻译"><span></span></label><label class="jy-check"><input type="checkbox" data-jy-field="autoSwipe">切换滑动页时补译</label></div>
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
 <label><span class="jy-label">超时 / 秒</span><input type="number" data-jy-channel-field="timeoutSec" min="10" max="600" step="1"></label><label><span class="jy-label">最大输出 tokens</span><input type="number" data-jy-channel-field="maxTokens" min="256" max="1000000" step="1"></label><label><span class="jy-label">温度</span><input type="number" data-jy-channel-field="temperature" min="0" max="2" step="0.05"></label><label><span class="jy-label">排除参数</span><input type="text" data-jy-channel-field="excludeParams" placeholder="temperature, presence_penalty"></label><label><span class="jy-label">推理强度</span><select data-jy-channel-field="reasoningEffort"><option value="">不发送</option><option value="minimal">minimal</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label><label class="jy-check"><input type="checkbox" data-jy-channel-field="tokenSaving">节约 token 模式（世界书只注入白名单，近期对话最多 2 楼）</label>
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
<details class="jy-advanced"><summary>段落前后缀</summary><div class="jy-affix-group"><span class="jy-label">原文</span><div class="jy-form-grid"><label><span class="jy-label">原文之前</span><input type="text" data-jy-field="segmentPrefix" placeholder="留空即可不加前缀"></label><label><span class="jy-label">原文之后</span><input type="text" data-jy-field="segmentSuffix" placeholder="留空即可不加后缀"></label></div></div><div class="jy-affix-group"><span class="jy-label">译文</span><div class="jy-form-grid"><label><span class="jy-label">译文之前</span><input type="text" data-jy-field="translationPrefix" placeholder="留空即可不加前缀"></label><label><span class="jy-label">译文之后</span><input type="text" data-jy-field="translationSuffix" placeholder="留空即可不加后缀"></label></div></div><label class="jy-check"><input type="checkbox" data-jy-field="paragraphPerLine">每行单独成段</label><p class="jy-muted">留空即不添加。主模型仅保留原文，过滤镜译添加的装饰与译文。<br>默认按空行分段，整段原文后面跟整段译文。勾选后每一行都独立成段，原文与译文逐行贴在一起，各对之间空一行；用于分隔的空行写在不可见边界内，不会进入主模型。</p></details>
<div class="jy-behaviors"><label class="jy-check"><input type="checkbox" data-jy-field="autoEdit">编辑回复后自动重译</label><label class="jy-check"><input type="checkbox" data-jy-field="showFloatingButton">显示悬浮入口</label><label class="jy-inline-field"><span class="jy-label">悬浮入口形态</span><select data-jy-field="floatingStyle"><option value="auto">自动（空闲圆环，翻译中胶囊，手机贴边）</option><option value="ring">始终圆环</option><option value="pill">始终胶囊</option><option value="edge">始终贴边</option></select></label></div>
<details class="jy-advanced"><summary>绑定正则 <span data-jy-processing-regex-count></span></summary><div class="jy-processing-toolbar"><button type="button" class="jy-button" data-jy-action="import-processing-regex">导入正则</button></div><input type="file" accept=".json,application/json" multiple data-jy-processing-regex-import hidden><div class="jy-processing-regex-list" data-jy-processing-regex-list></div><p class="jy-muted" data-jy-native-regex-status hidden></p></details>
<details class="jy-advanced"><summary>内置美化</summary><div class="jy-processing-toolbar"><select aria-label="内置美化" data-jy-reading-style><option value="cute">可爱风</option><option value="minimal">极简风</option><option value="fold">原文折叠</option></select><button type="button" class="jy-button" data-jy-action="builtin-processing">使用</button></div></details>
<pre class="jy-inspection" data-jy-tag-inspection hidden></pre>
<footer class="jy-footer"><span class="jy-save-note">修改后保存设置</span><button type="button" class="jy-button jy-button-primary" data-jy-action="save-settings">保存设置</button></footer>
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
  if (runtime.panel?.host) runtime.panel.host.dataset.theme = runtime.settings.theme || 'day';
  if (runtime.mini?.host) {
    runtime.mini.host.dataset.theme = runtime.settings.theme || 'day';
    runtime.mini.syncQuickPickers?.();
  }
  const floating = document.getElementById(FLOATING_ID);
  if (floating) floating.dataset.theme = runtime.settings.theme || 'day';
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
  const body = extractTaggedRegions(text, settings.bodyTags);
  const replaceTagList = parseTagNames(settings.replaceTags);
  const replace = replaceTagList.length
    ? extractTaggedRegions(text, replaceTagList, { mode: 'replace' })
    : { regions: [], missingTags: [], unbalanced: 0, assumedCloses: 0 };
  const regions = [...body.regions, ...replace.regions].sort((left, right) => left.openStart - right.openStart);
  for (let index = 1; index < regions.length; index += 1) {
    if (regions[index].openStart < regions[index - 1].closeEnd) {
      throw new Error(`<${regions[index - 1].tagName}> 与 <${regions[index].tagName}> 的区域交叉重叠，请检查提取标签与替换标签的嵌套。`);
    }
  }
  return {
    source: body.source,
    regions,
    missingTags: [...body.missingTags, ...(replace.missingTags ?? [])],
    unbalanced: (body.unbalanced || 0) + (replace.unbalanced || 0),
    assumedCloses: (body.assumedCloses || 0) + (replace.assumedCloses || 0),
  };
}

async function readMessageSnapshot(messageId = null, settings = runtime.settings) {
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
  const cleanMessage = stripGeneratedTranslationLines(upgraded);
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
    translated,
  };
}

async function withAbortTimeout(externalSignal, timeoutSec, task) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (externalSignal?.aborted) onAbort();
  else externalSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(10, Number(timeoutSec) || 180) * 1000);
  try {
    return await task(controller.signal);
  } catch (error) {
    if (timedOut) throw new Error(`独立副 API 请求超时（>${timeoutSec} 秒）。`);
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onAbort);
  }
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

function readableWorldInfoEntries() {
  const lore = runtime.wiEntries;
  if (!lore || !Array.isArray(lore.globalLore)) return [];
  return [...lore.globalLore, ...(Array.isArray(lore.characterLore) ? lore.characterLore : [])];
}

function whitelistedWorldbookContent() {
  const picks = runtime.settings.worldInfoWhitelist?.[worldInfoCharacterKey()];
  if (!picks?.length) return '';
  const wanted = new Set(picks.map(pick => `${pick.world}.${pick.uid}`));
  return readableWorldInfoEntries()
    .filter(entry => wanted.has(`${entry.world}.${entry.uid}`))
    .map(entry => String(entry.content ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
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

async function invokeTranslationBatch(segments, settings, signal, packet = {}, phase = 'primary', requestMeta = {}) {
  const context = getContext();
  const messages = buildTranslationMessages(segments, settings, packet, phase, requestMeta);
  const channel = getActiveChannel(settings);
  let raw;

  try {
    if (settings.apiMode === 'independent') {
      const service = context.ChatCompletionService;
      if (!service?.processRequest) throw new Error('当前 SillyTavern 不提供独立聊天补全请求接口。');
      raw = await withAbortTimeout(signal, channel.timeoutSec, requestSignal => service.processRequest(
        createIndependentRequest(settings, messages),
        {},
        true,
        requestSignal,
      ));
    } else {
      if (typeof context.generateRaw !== 'function') throw new Error('当前 SillyTavern 不提供静默生成接口。');
      raw = await context.generateRaw({
        prompt: messages,
        responseLength: channel.maxTokens,
        trimNames: false,
      });
    }
  } catch (error) {
    if (!isAbortError(error)) {
      recordDiagnostic('error', 'translation.request-failed', `副 API 请求失败：${safeError(error)}`, {
        phase,
        requestedSegments: segments.length,
        requestedIds: segments.map(segment => segment.id),
        apiMode: settings.apiMode,
        model: channel.model || 'follow-current',
      }, describeRequestFailure(error), { fullRequest: messages });
    }
    throw enrichRequestError(error);
  }

  recordDiagnostic('info', 'translation.raw-response', '已收到副 API 完整返回。', {
    phase,
    requestedSegments: segments.length,
    requestedIds: segments.map(segment => segment.id),
    apiMode: settings.apiMode,
    model: channel.model || 'follow-current',
    requestTokens: describeRequestTokens(messages, raw),
  }, raw, { fullRequest: messages });
  signal?.throwIfAborted?.();
  const recovered = recoverStructuredTranslations(raw, segments);
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
async function translateOneBatch(batch, settings, signal, packet, translations, budget, state) {
  let pending = batch;
  let lastError = null;
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
      const recovered = await invokeTranslationBatch(
        pending,
        settings,
        signal,
        packet,
        translations.size ? 'repair' : 'primary',
      );
      for (const [id, text] of recovered.translations) translations.set(id, text);
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

async function invokeWithRetries(segments, settings, signal, packet = {}, seedTranslations = new Map(), retryBudget = null) {
  const budget = retryBudget || { remaining: settings.retries };
  const translations = new Map(seedTranslations);
  const channel = getActiveChannel(settings);
  const batches = planTranslationBatches(segments, { maxChars: translationCharBudget(channel.maxTokens) });
  const state = { requests: 0 };
  let lastError;
  recordDiagnostic('info', 'translation.plan', '已按副 API 的输出上限规划本次请求批次。', {
    segments: segments.length,
    batches: batches.length,
    charBudget: translationCharBudget(channel.maxTokens),
    maxTokens: channel.maxTokens,
  });
  for (const batch of batches) {
    const failure = await translateOneBatch(batch, settings, signal, packet, translations, budget, state);
    if (failure) lastError = failure;
  }
  {
    const pending = segments.filter(segment => !translations.has(segment.id));
    if (!pending.length) return { translations, missingIds: [], complete: true };
  }
  if (translations.size) {
    const missingIds = segments.filter(segment => !translations.has(segment.id)).map(segment => segment.id);
    recordDiagnostic('warn', 'translation.partial', '补译后仍有缺失，将写回已恢复的安全译文。', {
      expected: segments.length,
      recovered: translations.size,
      missingIds,
      lastError: safeError(lastError),
    });
    return { translations, missingIds, complete: false };
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

async function writeTranslation(snapshot, translationMap, epoch, settings) {
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
  const bilingual = rebuildTaggedRegions(latest.extraction, region => region.mode === 'replace'
    ? assembleReplace(region.layout, effectiveTranslations, { allowMissing: !complete })
    : assembleBilingual(
      region.layout,
      effectiveTranslations,
      { ...settings, allowMissing: !complete },
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
      result = await invokeWithRetries(snapshot.segments, settings, controller.signal, packet, seedTranslations, retryBudget);
      await repairForbiddenPhrases(snapshot.segments, result.translations, settings, controller.signal, packet);

      updateTask({ status: 'running', message: '正在核对楼层与滑动页…', progress: 95 });
      try {
        written = await writeTranslation(snapshot, result.translations, epoch, settings);
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
        written = await writeTranslation(snapshot, result.translations, epoch, settings);
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
async function streamTranslationBatch(messages, settings, signal) {
  const payload = { ...createIndependentRequest(settings, messages), stream: true };
  const response = await fetch('/api/backends/chat-completions/generate', {
    method: 'POST',
    headers: getContext().getRequestHeaders(),
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    throw new Error(`流式请求失败（HTTP ${response.status}）${detail.slice(0, 160) ? `：${detail.slice(0, 160)}` : ''}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const data = line.trim();
      if (!data.startsWith('data:')) continue;
      const body = data.slice(5).trim();
      if (body === '[DONE]') continue;
      try {
        const chunk = JSON.parse(body);
        const choice = chunk.choices?.[0];
        const delta = choice?.delta?.content ?? choice?.text ?? '';
        if (delta) text += delta;
      } catch { /* keep partial JSON in the buffer for the next frame */ }
    }
  }
  return text;
}

async function translateMessageStreaming(messageId = null, { quiet = false } = {}) {
  if (runtime.settings.apiMode !== 'independent') throw new Error('流式翻译只在独立模式下可用：跟随模式借用的接口拿不到增量返回。');
  runtime.activeFloor = Number.isInteger(Number(messageId)) ? Number(messageId) : null;
  const epoch = runtime.epoch;
  const settings = runtime.settings;
  const targetLanguage = normalizeTargetLanguage(getActivePromptProfile(settings).targetLanguage);
  let snapshot = await readMessageSnapshot(messageId, settings);
  runtime.activeFloor = snapshot.messageId;
  if (!snapshot.segments.length) throw new Error('当前 AI 回复没有可翻译的正文段落。');

  const lockKey = `${snapshot.chatId}|${snapshot.messageId}|${snapshot.swipeId}`;
  const existing = runtime.inflight.get(lockKey);
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
    const batches = planTranslationBatches(snapshot.segments, { maxChars: translationCharBudget(channel.maxTokens) });
    const translations = new Map(snapshot.existingTranslations);
    const total = snapshot.segments.length;

    const writeProgress = async () => {
      const latest = await readMessageSnapshot(snapshot.messageId, settings).catch(() => null);
      if (!latest) return;
      await writeTranslation(latest, translations, epoch, settings);
    };
    // Rewriting the floor is not free, so throttle progressive updates while items stream in.
    let lastWrite = 0;
    const maybeProgress = () => {
      const now = Date.now();
      if (now - lastWrite < 700) return;
      lastWrite = now;
      writeProgress().catch(() => {});
    };

    for (const [batchIndex, batch] of batches.entries()) {
      const pending = batch.filter(segment => !translations.has(segment.id));
      if (!pending.length) continue;
      const phase = translations.size ? 'repair' : 'primary';
      const messages = buildTranslationMessages(pending, settings, packet, phase);
      let raw = '';
      try {
        raw = await streamTranslationBatch(messages, settings, controller.signal);
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) throw error;
        recordDiagnostic('warn', 'translation.stream-fallback', '流式请求中断，自动改用整包请求重试本批。', {
          batch: batchIndex + 1,
          segments: pending.length,
          error: safeError(error),
        });
        const recovered = await invokeTranslationBatch(pending, settings, controller.signal, packet, phase);
        for (const [id, value] of recovered.translations) translations.set(id, value);
        updateTask({
          status: 'running',
          message: `已恢复 ${translations.size} / ${total} 段。`,
          progress: 10 + Math.round(80 * translations.size / total),
        });
        maybeProgress();
        continue;
      }
      const recovered = recoverStructuredTranslations(raw, pending);
      for (const [id, value] of recovered.translations) translations.set(id, value);
      recordDiagnostic('info', 'translation.raw-response', '已收到副 API 流式返回。', {
        phase,
        requestedSegments: pending.length,
        requestedIds: pending.map(segment => segment.id),
        apiMode: settings.apiMode,
        model: channel.model || 'follow-current',
        requestTokens: describeRequestTokens(messages, raw),
        stream: true,
      }, raw, { fullRequest: messages });
      updateTask({
        status: 'running',
        message: `已恢复 ${translations.size} / ${total} 段。`,
        progress: 10 + Math.round(80 * translations.size / total),
      });
      maybeProgress();
    }

    await repairForbiddenPhrases(snapshot.segments, translations, settings, controller.signal, packet);
    updateTask({ status: 'running', message: '正在写回楼层…', progress: 95 });
    const written = await writeTranslation(snapshot, translations, epoch, settings);
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
    recordDiagnostic('error', 'translation.failed', message, { messageId: snapshot?.messageId ?? null, requestMode: 'stream' });
    if (!quiet) toast('error', message);
    throw error;
  }).finally(() => {
    if (runtime.inflight.get(lockKey)?.promise === work) runtime.inflight.delete(lockKey);
  });

  runtime.inflight.set(lockKey, { promise: work, controller });
  return work;
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
    });
    toast('success', '翻译通道测试成功。');
    return sample;
  } catch (error) {
    const message = safeError(error);
    updateTask({ status: 'error', title: '翻译通道测试失败', message, progress: 0 });
    recordDiagnostic('error', 'channel.test', message, {
      apiMode: runtime.settings.apiMode,
      model: getActiveChannel(runtime.settings).model || 'follow-current',
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
    updateTask({ status: 'error', title: '模型列表读取失败', message: safeError(error), progress: 0 });
    throw error;
  }
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

function updatePromptConditionalFields(root) {
  for (const custom of root.querySelectorAll('[data-jy-custom-for]')) {
    const mode = root.querySelector(`[data-jy-profile-field="${custom.dataset.jyCustomFor}"]`)?.value;
    const label = custom.closest('label');
    if (label) label.hidden = mode !== 'custom';
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
    'showFloatingButton',
    'paragraphPerLine',
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
      else if (['timeoutSec', 'maxTokens', 'temperature'].includes(key)) editing[key] = Number(element.value);
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
  return captureProcessingProfile(normalizeProcessingSettings(current));
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
    },
  );
  const lines = ['正文标签：'];
  for (const item of report.bodyTags) {
    if (item.count) lines.push(`  <${item.tag}>：${item.count} 组，采用第 ${item.selected} 组`);
    else if (item.streaming) lines.push(`  <${item.tag}>：标签已出现但尚未闭合，这一楼可能还在生成`);
    else lines.push(`  <${item.tag}>：未找到`);
  }
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
        await translateMessage(null, { force: true });
      } else if (action === 'translate-missing') {
        // Seeds with whatever is already written back, so only the gaps go to the API.
        saveSettings(collectSettings(root));
        await translateMessage(null, { force: false });
      } else if (action === 'translate-stream') {
        saveSettings(collectSettings(root));
        await translateMessageStreaming(null);
      } else if (action === 'test-api') {
        saveSettings(collectSettings(root));
        await testTranslationChannel();
      } else if (action === 'refresh') {
        await refreshCurrentCard(root);
      } else if (action === 'open-settings') {
        selectTab('settings');
      } else if (action === 'open-prompt') {
        selectTab('prompt');
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
      if (['translate', 'translate-missing', 'translate-stream', 'test-api'].includes(action)) await refreshCurrentCard(root);
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
    if (event.target.matches('[data-jy-profile-field="styleMode"], [data-jy-profile-field="honorificMode"], [data-jy-profile-field="nameMode"], [data-jy-profile-field="punctuationMode"]')) {
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
    if (event.target.matches('[data-jy-field="autoGeneration"], [data-jy-field="autoSwipe"], [data-jy-field="showFloatingButton"], [data-jy-field="includeWorldbook"], [data-jy-field="includeCharacterCard"], [data-jy-field="includeRecentContext"]')) {
      const name = event.target.dataset.jyField;
      for (const twin of fieldElements(root, name)) twin.checked = event.target.checked;
      saveSettings(collectSettings(root));
      syncFields(root, runtime.settings);
    }
  };

  const onInput = event => {
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
  const button = document.getElementById(FLOATING_ID);
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
  runtime.floatingPlace?.(Number.parseFloat(button.style.left) || 0, Number.parseFloat(button.style.top) || 0);
}

// Keeps the pill open long enough to read, then lets it settle back to the ring. An idle entry has
// nothing to report, so it never expands — an empty pill reads as a broken control.
function holdFloatingPill(duration = FLOATING_HOLD_MS) {
  if (!document.getElementById(FLOATING_ID)) return;
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

  const place = (x, y) => {
    const width = button.offsetWidth || 42;
    const height = button.offsetHeight || 42;
    // The edge form is docked to the right rim, so it only travels vertically.
    const docked = button.dataset.form === 'edge';
    const nextX = docked ? globalThis.innerWidth - width : x;
    position.x = Math.min(Math.max(8, nextX), Math.max(8, globalThis.innerWidth - width));
    position.y = Math.min(Math.max(8, y), Math.max(8, globalThis.innerHeight - height - 4));
    button.style.left = `${position.x}px`;
    button.style.top = `${position.y}px`;
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
  const onResize = () => {
    place(position.x, position.y);
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
      if (action === 'mini-translate') await translateMessage(null, { force: true });
      else if (action === 'mini-repair') await translateMessage(null, { force: false });
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
      await translateMessage(Number(messageId), { force: reason === 'edit', quiet: true });
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
    const clean = stripGeneratedTranslationLines(item.content);
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
    if (runtime.panel?.controller?.root) refreshCurrentCard(runtime.panel.controller.root);
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
  runtime.subscribers.clear();
  runtime.diagnosticSubscribers.clear();
  runtime.initialized = false;
}

export function interceptGeneration(chat) {
  runtime.interceptorSeen = true;
  // The host scans worldinfo AFTER interceptors, using the stripped text, so translated names can
  // never fire entries on their own. Force-activate the entries our translations DO match so the
  // main prompt keeps reacting to translated terms; the one-shot list clears after each scan.
  const translations = Array.isArray(chat)
    ? chat.map(item => extractTranslationBlockText(item?.mes)).filter(Boolean).join('\n')
    : '';
  if (translations) forceActivateWorldInfoFromText(translations);
  return interceptGenerationChat(chat);
}

function forceActivateWorldInfoFromText(text) {
  const entries = readableWorldInfoEntries();
  if (!entries.length) return;
  const context = getContext();
  const eventType = context.eventTypes?.WORLDINFO_FORCE_ACTIVATE;
  if (!eventType || typeof context.eventSource?.emit !== 'function') return;
  const haystack = text.toLowerCase();
  const hits = [];
  for (const entry of entries) {
    const keys = (Array.isArray(entry.key) ? entry.key.flat() : [])
      .map(key => String(key ?? '').trim().replace(/^\/+|\/+$/g, ''))
      .filter(Boolean);
    if (keys.some(key => haystack.includes(key.toLowerCase()))) {
      hits.push({ world: entry.world, uid: entry.uid });
    }
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
  scheduleEntries();
  registerRuntimeEvents();
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

export const __testing = Object.freeze({ buildTranslationMessages, latestAssistantMessageId, readMessageSnapshot, restyleCurrentChat });

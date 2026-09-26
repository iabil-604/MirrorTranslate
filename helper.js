// 小助手 (DESIGN.md §16): a read-only helper AI a reader can ask about the current settings, the
// current floor and the run log. It never changes anything on its own — every change it proposes is a
// suggestion the reader clicks through by hand ("照这样改").
//
// Everything in this module is pure: given data, it returns data. Reading live settings off the DOM,
// calling the sub-model, and actually writing a suggestion back into settings all stay in index.js,
// the same split tts-deep.js keeps between its own pure message-building/parsing and the runtime code
// that calls it.
//
// Three jobs live here:
//  - buildHelperContext: turns already-gathered raw data (settings, the current floor, the run log,
//    the regex count, the control center's own markup, the user manual) into the one block of text
//    sent as the request's context, with every secret reported as 已填/没填 and every URL as its host
//    only — and, as a second, generic pass over the whole assembled text, redactSecrets catches
//    anything secret-shaped that slipped in through a field nobody meant to be a credential (a
//    connection named after its own key, say).
//  - the default prompt and HELPER_QUICK_QUESTIONS, the fixed list a reader can click instead of typing.
//  - parseHelperReply / validateHelperSuggestion: reading a reply's trailing ```jingyi-suggest``` block
//    leniently, and keeping only whitelisted, valid, non-no-op suggestions.

import {
  CONNECTION_USES,
  CONSOLE_PRESET_IDS,
  CONTROL_CENTER_PAGES,
  PRESET_LABELS,
  TTS_MODES,
  UI_MODES,
  connectionUseChoice,
  parseJsonCandidates,
  parseTagNamesWithErrors,
  pathGet,
  pathSet,
} from './core.js?v=0.38.0';

// ---------------------------------------------------------------------------------------------
// Default prompt and quick questions
// ---------------------------------------------------------------------------------------------

export const DEFAULT_HELPER_PROMPT = `你是镜译（MirrorTranslate）内置的小助手，只根据这次对话末尾给你的资料（版本、设置、当前楼层、运行记录、正则情况、控制中心自己的说明文字）回答问题，不了解镜译之外的事情，也不知道资料里没写的内容。

规则：
1. 用简体中文回答，尽量简短；需要分步骤时用数字编号列出。
2. 只依据给你的资料作答，资料里没有的就说不确定，不要编造。
3. 提到界面位置时，照资料里给的原样说法，格式是「页 › 卡 › 控件」，不要换一种说法或翻译成别的名字。
4. 不管什么理由都不要向使用者索要 API Key、密钥或其他凭据；资料里的密钥只会写「已填」或「没填」。
5. 如果你想让使用者去改一项设置或做一个操作，在回答最后另起一段，用一个 \`\`\`jingyi-suggest\`\`\` 代码块给出建议，内容是一个 JSON 数组，数组每一项是 {"type":"set","field":"字段名","value":新值,"why":"一句话原因"} 或 {"type":"action","action":"动作名","why":"一句话原因"}；field 和 action 只能用资料里「可用建议」列出的名字，其他名字一律不会生效，没有建议就不要写这个代码块。
6. 建议块之外的正文不要写"点击 xx 按钮"这类操作指令，操作交给建议块，正文只负责说明。`;

export const HELPER_QUICK_QUESTIONS = Object.freeze([
  '我怎么没办法翻译？',
  '朗读要怎么打开？',
  '套餐是什么意思？',
  '「删除多余正则」是做什么的？',
]);

export function resolveHelperPrompt(helper) {
  const custom = String(helper?.prompt ?? '').trim();
  return custom || DEFAULT_HELPER_PROMPT;
}

// The context sent with every ask is capped so one huge floor or a bloated user manual never crowds
// out the settings/floor summary a reply actually needs. Exported so index.js and its tests agree on
// the same number.
export const HELPER_CONTEXT_CAP = 40000;

// ---------------------------------------------------------------------------------------------
// Redaction — the safety net. Explicit fields (a channel's key, Fish's key) are already reported as
// 已填/没找 before they ever reach this text; this is only for anything secret-shaped that reaches the
// context through a field nobody meant to be a credential.
// ---------------------------------------------------------------------------------------------

function redactPass(text) {
  return String(text ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [已隐藏]')
    .replace(/([?&](?:key|token|api_key|access_token|apikey)=)[^&#\s]+/gi, '$1[已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[密钥已隐藏]')
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, '[密钥已隐藏]');
}

/** The final defensive pass over the whole assembled context — see the module note above. */
export function redactSecrets(text) {
  return redactPass(text);
}

/** "已填" / "没填" — never the value itself. */
export function keyStatus(value) {
  return String(value ?? '').trim() ? '已填' : '没填';
}

/** A URL's host only, best-effort; a value that will not parse is not trusted with anything besides
 * that best effort — never returned with its query string or path intact. */
export function urlHost(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).host || raw.replace(/[?#].*$/, '').replace(/\/.*/, '');
  } catch {
    return raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[?#].*$/, '').replace(/\/.*/, '');
  }
}

// ---------------------------------------------------------------------------------------------
// Settings summary
// ---------------------------------------------------------------------------------------------

// Kept apart from index.js's own CONNECTION_USE_LABELS (display text for the connection page's own
// ticks) — this copy is what the context text calls each use, and the two happen to read the same.
const CONNECTION_USE_TEXT_LABELS = Object.freeze({ translation: '翻译', analysis: '朗读分析', deep: '深度分析', helper: '小助手' });

const UI_MODE_LABELS = Object.freeze({ normal: '正常模式', advanced: '高级模式' });
const TTS_MODE_LABELS = Object.freeze({ off: '不分析', simple: '简单分析', deep: '深度分析' });

function boolLabel(value) {
  return value ? '开' : '关';
}

function channelById(settings, id) {
  return (Array.isArray(settings?.channels) ? settings.channels : []).find(channel => channel.id === id) || null;
}

/** One connection use's line: "翻译：连接名 · 模型 · host（跟随酒馆时没有模型/host）". */
function connectionUseLine(settings, use) {
  const choice = connectionUseChoice(settings, use);
  const label = CONNECTION_USE_TEXT_LABELS[use] || use;
  if (choice === 'follow') return `${label}：跟随酒馆`;
  const channel = channelById(settings, choice);
  if (!channel) return `${label}：跟随酒馆`;
  const parts = [channel.name, channel.model, urlHost(channel.url)].filter(Boolean);
  return `${label}：${parts.join(' · ') || '（连接还没有填地址和模型）'}`;
}

/** The settings summary, one line per item, in the UI's own label wording (DESIGN §16 item 5). Every
 * value that could be a secret is reported only through keyStatus/urlHost, never itself. */
export function buildSettingsSummaryLines(settings = {}) {
  const tts = settings.tts || {};
  const coloring = settings.coloring || {};
  const fish = tts.fish || {};
  const lines = [];
  lines.push(`界面模式：${UI_MODE_LABELS[settings.uiMode] || settings.uiMode || '未知'}`);
  lines.push(`套餐：${settings.preset ? (PRESET_LABELS[settings.preset] || settings.preset) : '未选套餐（自己设置的）'}`);
  for (const use of CONNECTION_USES) lines.push(connectionUseLine(settings, use));
  lines.push(`自动接续翻译：${boolLabel(settings.autoGeneration)}`);
  lines.push(`切换滑动页时补译：${boolLabel(settings.autoSwipe)}`);
  lines.push(`提取标签：${(settings.bodyTags || []).join('、') || '（空）'}`);
  lines.push(`替换标签：${(settings.replaceTags || []).join('、') || '（空）'}`);
  lines.push(`排除标签：${(settings.excludedTags || []).join('、') || '（空）'}`);
  lines.push(`只留译文：${boolLabel(settings.translationOnly)}`);
  lines.push(`流式写回：${boolLabel(settings.streamingWriteback)}`);
  lines.push(`翻译失败后自动重试：${Number.isFinite(settings.retries) ? settings.retries : 0} 次`);
  lines.push(`说话人着色：${boolLabel(coloring.speakers)}`);
  lines.push(`情绪排版：${boolLabel(coloring.emotions)}`);
  lines.push(`特效字：${boolLabel(coloring.effects)}`);
  lines.push(`朗读功能：${boolLabel(tts.enabled)}`);
  lines.push(`分析模式：${TTS_MODE_LABELS[tts.mode] || tts.mode || '未知'}`);
  lines.push(`Fish Audio 模型：${fish.model || '未知'}`);
  lines.push(`Fish Audio API Key：${keyStatus(fish.key)}`);
  lines.push(`Fish 走酒馆代理：${boolLabel(fish.viaProxy)}`);
  lines.push(`新回复自动朗读：${boolLabel(tts.autoRead)}`);
  // keyStatus/urlHost above already keep an actual secret field out of these lines; this is the same
  // generic pass buildHelperContext applies to the whole assembled text, run here too so this function
  // is safe to call — and to test — on its own, not only once it is folded into a larger context.
  return lines.map(line => redactPass(line));
}

// ---------------------------------------------------------------------------------------------
// Floor snapshot text — index.js gathers the raw numbers (inspectTagConfiguration's report, the
// segment/translation counts, this floor's own errors from the run log); this only formats them.
// ---------------------------------------------------------------------------------------------

const FLOOR_PREVIEW_LIMIT = 1200;

export function buildFloorSnapshotLines(floor) {
  if (!floor) return ['当前楼层：没有可读取的 AI 回复。'];
  const lines = [];
  lines.push(`第 ${floor.messageId} 楼 · ${floor.role || '角色'} · 滑动页 ${floor.swipeLabel || '—'}`);
  lines.push(`段落：${floor.segmentCount ?? 0} 段 · 翻译状态：${floor.translationState || '未知'}`);
  lines.push(`正文标签：${floor.bodyTagsFound?.length ? floor.bodyTagsFound.join('、') : '未找到'}`);
  lines.push(`替换标签：${floor.replaceTagsFound?.length ? floor.replaceTagsFound.join('、') : '未设置或未找到'}`);
  lines.push(`排除标签：${floor.excludedTagsFound?.length ? floor.excludedTagsFound.join('、') : '未设置或未找到'}`);
  lines.push(`只留译文（这一楼）：${floor.translationOnly ? '是' : '否'}`);
  if (floor.errors?.length) {
    lines.push(`这一楼在运行记录里的问题（最近 ${floor.errors.length} 条）：`);
    for (const line of floor.errors) lines.push(`  - ${line}`);
  } else {
    lines.push('这一楼在运行记录里没有记录到问题。');
  }
  const preview = String(floor.preview ?? '').slice(0, FLOOR_PREVIEW_LIMIT);
  lines.push(`正文开头（前 ${preview.length} 字${preview.length >= FLOOR_PREVIEW_LIMIT ? '，已截断' : ''}）：`);
  lines.push(preview);
  return lines;
}

// ---------------------------------------------------------------------------------------------
// Run log — entries are already the sanitised objects diagnostics.js/readDiagnostics returns.
// ---------------------------------------------------------------------------------------------

export function buildRunLogLines(entries) {
  const list = Array.isArray(entries) ? entries.slice(-30) : [];
  if (!list.length) return ['运行记录：暂无记录。'];
  return list.map(entry => `[${entry.time}] ${String(entry.level ?? 'info').toUpperCase()} / ${entry.scope}${Number.isInteger(entry.floor) ? ` / 第 ${entry.floor} 楼` : ''}：${entry.message || ''}`);
}

// ---------------------------------------------------------------------------------------------
// Regex summary
// ---------------------------------------------------------------------------------------------

export function buildRegexLines(regex) {
  if (!regex) return ['正则：未知。'];
  const lines = [`镜译自己的正则：${regex.expected ?? 0} 条应有，多余 ${regex.surplus ?? 0} 条`];
  if (regex.nativeRegexInstalled === false) lines.push('酒馆自身的正则引擎这次没有接上，「删除多余正则」看不到角色/预设绑定的那部分。');
  return lines;
}

// ---------------------------------------------------------------------------------------------
// Knowledge — the control center's own help text, extracted from its markup (§16 item 5: "always
// current"). Regex over the markup string, in the same spirit as the codebase's own tests that check
// a button's label by matching the markup string directly (test/core.test.mjs).
// ---------------------------------------------------------------------------------------------

const KNOWLEDGE_PAGE_LABELS = Object.freeze({
  main: '翻译台', finetune: '微调', prompt: '翻译规则', settings: '模型连接',
  processing: '正文处理', tts: '朗读', helper: '小助手', logs: '运行记录',
});

function stripTags(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const KNOWLEDGE_LINE_CAP = 220;
const KNOWLEDGE_LINES_PER_PAGE = 40;

/** "页 › 区 › 文字" lines pulled straight from the control center's own markup, so this text is never
 * out of sync with what the reader actually sees on the page. */
export function extractControlCenterKnowledge(markup) {
  const text = String(markup ?? '');
  const lines = [];
  const pageRe = /<section class="jy-page" data-jy-page="([a-z]+)"[^>]*>([\s\S]*?)(?=<section class="jy-page" data-jy-page="|$)/g;
  let pageMatch;
  while ((pageMatch = pageRe.exec(text))) {
    const pageId = pageMatch[1];
    const pageLabel = KNOWLEDGE_PAGE_LABELS[pageId] || pageId;
    const body = pageMatch[2];
    let section = pageLabel;
    let countThisPage = 0;
    const partRe = /<h2[^>]*>([\s\S]*?)<\/h2>|<p class="jy-muted"[^>]*>([\s\S]*?)<\/p>|title="([^"]+)"/g;
    let part;
    while ((part = partRe.exec(body)) && countThisPage < KNOWLEDGE_LINES_PER_PAGE) {
      if (part[1] !== undefined) {
        section = stripTags(part[1]) || section;
        continue;
      }
      const cleaned = stripTags(part[2] ?? part[3]);
      if (!cleaned) continue;
      const line = `${pageLabel} › ${section} › ${cleaned}`;
      lines.push(line.length > KNOWLEDGE_LINE_CAP ? `${line.slice(0, KNOWLEDGE_LINE_CAP)}…` : line);
      countThisPage += 1;
    }
  }
  return [...new Set(lines)];
}

// ---------------------------------------------------------------------------------------------
// Assembling the whole context, capped
// ---------------------------------------------------------------------------------------------

function section(title, lines) {
  return `【${title}】\n${(Array.isArray(lines) ? lines : [lines]).join('\n')}`;
}

/** Lines joined by '\n' up to `budget` characters, whole lines only — a line that would not fit on
 * its own is left out rather than cut mid-word, and a "已截断" marker is appended whenever anything
 * was left out. */
function joinTruncated(lines, budget) {
  const list = Array.isArray(lines) ? lines : [];
  if (budget <= 0) return { text: '', truncated: list.length > 0 };
  let text = '';
  let truncated = false;
  for (const line of list) {
    const next = text ? `${text}\n${line}` : line;
    if (next.length > budget) { truncated = true; break; }
    text = next;
  }
  return { text: truncated ? (text ? `${text}\n…（已截断）` : '…（已截断）') : text, truncated };
}

/**
 * Everything sent as one ask's context, capped at `cap` characters with the user-manual excerpt and
 * the control center's own knowledge lines trimmed first, then the run log. The versions line, the
 * settings summary, the current floor and the regex line are kept in full — each is already small and
 * bounded on its own (the floor preview alone is capped at FLOOR_PREVIEW_LIMIT), and without them a
 * reply cannot say anything grounded at all. Whatever the budget math above does, the final slice
 * below is the one guarantee that matters: the result is never longer than `cap`.
 */
export function buildHelperContext({
  versions = {},
  settings = {},
  floor = null,
  runLog = [],
  regex = null,
  knowledgeMarkup = '',
  manual = '',
  availableFields = [],
  availableActions = [],
  cap = HELPER_CONTEXT_CAP,
} = {}) {
  const versionsLine = `镜译 ${versions.appVersion || '未知版本'} · SillyTavern ${versions.hostVersion || '未知'} · 主 API：${versions.mainApi || '未知'} · 流式：${versions.streaming ? '开' : '关'}`;
  const settingsText = section('设置摘要', buildSettingsSummaryLines(settings));
  const floorText = section('当前楼层', buildFloorSnapshotLines(floor));
  const regexText = section('正则', buildRegexLines(regex));
  const runLogLines = buildRunLogLines(runLog);
  const knowledgeLines = extractControlCenterKnowledge(knowledgeMarkup);
  const manualText = String(manual ?? '');
  const availableText = section('可用建议', [
    availableFields.length ? `可以 set 的字段：${availableFields.join('、')}` : '可以 set 的字段：（无）',
    availableActions.length ? `可以 action 的动作：${availableActions.join('、')}` : '可以 action 的动作：（无）',
  ]);

  const core = [versionsLine, settingsText, floorText, regexText, availableText];
  const coreText = core.join('\n\n');
  let remaining = Math.max(0, cap - coreText.length - 16 /* the extra '\n\n' joins added below */);

  // Trimmed in this order: the manual excerpt and the control center's own knowledge lines first
  // (both are static reference material, not this ask's own state), then the run log. Each gets a
  // share of whatever is left rather than however much it asks for, so one long section never starves
  // the others down to nothing.
  const manualBudget = Math.max(0, Math.floor(remaining * 0.3));
  const manualTrimmed = manualText.length > manualBudget;
  const manualSlice = manualText.slice(0, manualBudget);
  remaining = Math.max(0, remaining - manualSlice.length);

  const knowledgeJoined = joinTruncated(knowledgeLines, Math.max(0, Math.floor(remaining * 0.6)));
  remaining = Math.max(0, remaining - knowledgeJoined.text.length);

  const runLogJoined = joinTruncated(runLogLines, remaining);

  const parts = [
    versionsLine,
    settingsText,
    floorText,
    regexText,
    section('运行记录（最近）', runLogJoined.text || '（无）'),
    section('控制中心说明', knowledgeJoined.text || '（无）'),
    manualSlice ? section('使用手册摘录', manualSlice + (manualTrimmed ? '\n…（已截断）' : '')) : '',
    availableText,
  ].filter(Boolean);

  const text = redactSecrets(parts.join('\n\n')).slice(0, cap);
  return {
    text,
    truncated: {
      manual: manualTrimmed,
      knowledge: knowledgeJoined.truncated,
      runLog: runLogJoined.truncated,
    },
    length: text.length,
  };
}

// ---------------------------------------------------------------------------------------------
// Whitelisted fields and actions
// ---------------------------------------------------------------------------------------------

const ALL_PAGE_IDS = Object.freeze([...new Set([...CONTROL_CENTER_PAGES.normal, ...CONTROL_CENTER_PAGES.advanced])]);

export const HELPER_WHITELIST_FIELDS = Object.freeze([
  { field: 'bodyTags', label: '提取标签', path: Object.freeze(['bodyTags']), kind: 'tags' },
  { field: 'replaceTags', label: '替换标签', path: Object.freeze(['replaceTags']), kind: 'tags' },
  { field: 'excludedTags', label: '排除标签', path: Object.freeze(['excludedTags']), kind: 'tags' },
  { field: 'autoGeneration', label: '自动接续翻译', path: Object.freeze(['autoGeneration']), kind: 'boolean' },
  { field: 'autoSwipe', label: '切换滑动页时补译', path: Object.freeze(['autoSwipe']), kind: 'boolean' },
  { field: 'translationOnly', label: '只留译文', path: Object.freeze(['translationOnly']), kind: 'boolean' },
  { field: 'streamingWriteback', label: '流式写回', path: Object.freeze(['streamingWriteback']), kind: 'boolean' },
  { field: 'retries', label: '翻译失败后自动重试', path: Object.freeze(['retries']), kind: 'integer', min: 0, max: 5 },
  { field: 'coloring.speakers', label: '说话人着色', path: Object.freeze(['coloring', 'speakers']), kind: 'boolean' },
  { field: 'coloring.emotions', label: '情绪排版', path: Object.freeze(['coloring', 'emotions']), kind: 'boolean' },
  { field: 'coloring.effects', label: '特效字', path: Object.freeze(['coloring', 'effects']), kind: 'boolean' },
  { field: 'tts.enabled', label: '朗读功能', path: Object.freeze(['tts', 'enabled']), kind: 'boolean' },
  { field: 'tts.mode', label: '分析模式', path: Object.freeze(['tts', 'mode']), kind: 'enum', options: TTS_MODES, valueLabels: TTS_MODE_LABELS },
  { field: 'tts.autoRead', label: '新回复自动朗读', path: Object.freeze(['tts', 'autoRead']), kind: 'boolean' },
  { field: 'uiMode', label: '界面模式', path: Object.freeze(['uiMode']), kind: 'enum', options: UI_MODES, valueLabels: UI_MODE_LABELS },
  { field: 'preset', label: '套餐', path: Object.freeze(['preset']), kind: 'enum', options: Object.freeze([...CONSOLE_PRESET_IDS, '']), valueLabels: Object.freeze({ ...PRESET_LABELS, '': '未选套餐' }) },
]);

const HELPER_FIELD_BY_KEY = new Map(HELPER_WHITELIST_FIELDS.map(field => [field.field, field]));

export const HELPER_WHITELIST_ACTIONS = Object.freeze([
  { action: 'open-page', label: '打开页面', needsValue: true, options: ALL_PAGE_IDS },
  { action: 'inspect-floor', label: '检查当前楼层', needsValue: false },
  { action: 'detect-cast', label: '从角色卡和世界书识别角色', needsValue: false },
  { action: 'cleanup-regex', label: '删除多余正则', needsValue: false },
]);

const HELPER_ACTION_BY_KEY = new Map(HELPER_WHITELIST_ACTIONS.map(action => [action.action, action]));

/** The names a prompt is allowed to mention, for the "可用建议" section of the context. */
export function availableHelperFieldNames() {
  return HELPER_WHITELIST_FIELDS.map(field => field.field);
}

export function availableHelperActionNames() {
  return HELPER_WHITELIST_ACTIONS.map(action => action.action);
}

function normalizeBooleanValue(value) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1) return true;
  if (value === 'false' || value === 0) return false;
  return undefined;
}

function normalizeEnumValue(field, value) {
  const raw = String(value ?? '').trim();
  return field.options.includes(raw) ? raw : undefined;
}

function normalizeIntegerValue(field, value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(field.max, Math.max(field.min, number));
}

function normalizeTagsValue(value) {
  const parsed = parseTagNamesWithErrors(value);
  if (parsed.invalid.length) return undefined;
  return parsed.tags;
}

function arraysEqualAsSets(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return left === right;
  if (left.length !== right.length) return false;
  const a = [...left].map(item => String(item).toLowerCase()).sort();
  const b = [...right].map(item => String(item).toLowerCase()).sort();
  return a.every((item, index) => item === b[index]);
}

/** "把「提取标签」改成「story_scene」" — the one line a suggestion row shows before its button. */
export function describeHelperSuggestion(suggestion) {
  if (suggestion.type === 'action') return suggestion.actionLabel;
  const valueText = suggestion.kind === 'boolean' ? boolLabel(suggestion.value)
    : suggestion.kind === 'tags' ? (suggestion.value.length ? suggestion.value.join('、') : '（空）')
      : suggestion.kind === 'enum' ? (suggestion.valueLabel ?? String(suggestion.value))
        : String(suggestion.value);
  return `把「${suggestion.label}」改成「${valueText}」`;
}

/**
 * One raw suggestion object from the model, validated against the whitelist and the settings it
 * would apply to. Returns null for anything unknown, invalid, or a no-op (same value already set) —
 * §16 item 7's "drop unknown fields/actions, invalid values, and no-op changes".
 */
export function validateHelperSuggestion(raw, settings) {
  if (!raw || typeof raw !== 'object') return null;
  const why = String(raw.why ?? '').trim().slice(0, 200);
  if (raw.type === 'set') {
    const field = HELPER_FIELD_BY_KEY.get(String(raw.field ?? ''));
    if (!field) return null;
    let value;
    if (field.kind === 'boolean') value = normalizeBooleanValue(raw.value);
    else if (field.kind === 'enum') value = normalizeEnumValue(field, raw.value);
    else if (field.kind === 'integer') value = normalizeIntegerValue(field, raw.value);
    else if (field.kind === 'tags') value = normalizeTagsValue(raw.value);
    if (value === undefined) return null;
    const current = pathGet(settings, field.path);
    const isNoop = field.kind === 'tags' ? arraysEqualAsSets(current, value) : current === value;
    if (isNoop) return null;
    return {
      type: 'set',
      field: field.field,
      label: field.label,
      kind: field.kind,
      path: field.path,
      value,
      valueLabel: field.kind === 'enum' ? (field.valueLabels?.[value] ?? value) : undefined,
      why,
    };
  }
  if (raw.type === 'action') {
    const action = HELPER_ACTION_BY_KEY.get(String(raw.action ?? ''));
    if (!action) return null;
    let value;
    if (action.needsValue) {
      value = String(raw.value ?? '').trim();
      if (!action.options.includes(value)) return null;
    }
    const actionLabel = action.action === 'open-page'
      ? `打开「${KNOWLEDGE_PAGE_LABELS[value] || value}」页`
      : action.label;
    return { type: 'action', action: action.action, actionLabel, value, why };
  }
  return null;
}

const HELPER_MAX_SUGGESTIONS = 8;

export function validateHelperSuggestions(list, settings) {
  const result = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const validated = validateHelperSuggestion(raw, settings);
    if (validated) result.push(validated);
    if (result.length >= HELPER_MAX_SUGGESTIONS) break;
  }
  return result;
}

/** A validated 'set' suggestion applied to settings — pure, for whoever writes it back (index.js)
 * and for testing the write without a DOM. 'action' suggestions are not a settings change and are
 * not handled here. */
export function applyHelperSuggestion(settings, suggestion) {
  if (!suggestion || suggestion.type !== 'set') return settings;
  return pathSet(settings, suggestion.path, suggestion.value);
}

// ---------------------------------------------------------------------------------------------
// Reply parsing — splitting the trailing ```jingyi-suggest``` block off a reply's display text.
// ---------------------------------------------------------------------------------------------

const SUGGEST_BLOCK_RE = /```jingyi-suggest\s*([\s\S]*?)```/i;

/**
 * A reply's display text (the block removed, trimmed) and whatever the model put in its suggestion
 * block, parsed leniently — not yet validated against the whitelist, that is validateHelperSuggestions'
 * job once the current settings are in hand.
 */
export function parseHelperReply(raw) {
  const text = String(raw ?? '');
  const match = text.match(SUGGEST_BLOCK_RE);
  if (!match) return { text: text.trim(), rawSuggestions: [] };
  const display = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`.trim();
  const candidates = parseJsonCandidates(match[1]);
  const arrayCandidate = candidates.find(candidate => Array.isArray(candidate));
  return { text: display, rawSuggestions: Array.isArray(arrayCandidate) ? arrayCandidate : [] };
}

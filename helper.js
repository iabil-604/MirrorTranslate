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
  applyPreset,
  connectionUseChoice,
  pagesForMode,
  parseJsonCandidates,
  parseTagNamesWithErrors,
  pathGet,
  pathSet,
  presetDrift,
  unwrapResponseContent,
} from './core.js?v=0.41.4';

// ---------------------------------------------------------------------------------------------
// Default prompt and quick questions
// ---------------------------------------------------------------------------------------------

export const DEFAULT_HELPER_PROMPT = `你是镜译（MirrorTranslate）内置的小助手，只根据这次对话末尾给你的资料（版本、设置、当前楼层、运行记录、正则情况、控制中心自己的说明文字）回答问题，不了解镜译之外的事情，也不知道资料里没写的内容。

规则：
1. 用简体中文回答，尽量简短；需要分步骤时用数字编号列出。
2. 只依据给你的资料作答，资料里没有的就说不确定，不要编造。
3. 提到界面位置时，照资料里给的原样说法，格式是「页 › 卡 › 控件」，不要换一种说法或翻译成别的名字。
4. 不管什么理由都不要向使用者索要 API Key、密钥或其他凭据；资料里的密钥只会写「已填」或「没填」。
5. 如果你想让使用者去改一项设置或做一个操作，在回答最后另起一段，用一个 \`\`\`jingyi-suggest\`\`\` 代码块给出建议，内容是一个 JSON 数组，数组每一项是 {"type":"set","field":"字段名","value":新值,"why":"一句话原因"} 或 {"type":"action","action":"动作名","value":"需要值的动作才填，比如打开哪个页面","why":"一句话原因"}；field、action 和 value 只能用资料里「可用建议」列出的名字和取值，其他一律不会生效，没有建议就不要写这个代码块。
6. 正文里可以正常给出操作步骤，照资料里的原样说法写清楚「在哪个页 › 哪张卡 › 点哪个控件」，不必回避"点击""填入"这类字眼；只有「可用建议」里列出的那些字段和动作才能同时放进建议块，让使用者一键照改，其余操作只能在正文里说明，由使用者自己动手。`;

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

/** Strips a scheme, query/fragment, path and (review finding helper.js:98) any userinfo sitting in
 * front of the host — the best-effort fallback for a value URL() would not parse as-is, used both
 * when it throws outright and when it parses but comes back with an empty `.host` (an address typed
 * as "user:pass@host/…" with no scheme parses as a URL with that leading word read as its *scheme*
 * and no host at all, so it never throws, and used to reach here with the credential still attached). */
function bestEffortHost(raw) {
  return raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/.*/, '')
    .replace(/^[^@]*@/, '');
}

/** A URL's host only, best-effort; a value that will not parse is not trusted with anything besides
 * that best effort — never returned with its query string or path intact. */
export function urlHost(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).host || bestEffortHost(raw);
  } catch {
    return bestEffortHost(raw);
  }
}

// ---------------------------------------------------------------------------------------------
// Settings summary
// ---------------------------------------------------------------------------------------------

// Kept apart from index.js's own CONNECTION_USE_LABELS (display text for 「各功能用哪条连接」's rows) —
// this copy is what the context text calls each use, and the two happen to read the same.
const CONNECTION_USE_TEXT_LABELS = Object.freeze({ translation: '翻译', deep: '分析模式', helper: '小助手' });

const UI_MODE_LABELS = Object.freeze({ normal: '正常模式', advanced: '高级模式' });
// 分析模式 is one switch on the page (DESIGN §17.2); its two settings values read as that switch does.
const TTS_MODE_LABELS = Object.freeze({ off: '关', deep: '开' });

function boolLabel(value) {
  return value ? '开' : '关';
}

function channelById(settings, id) {
  return (Array.isArray(settings?.channels) ? settings.channels : []).find(channel => channel.id === id) || null;
}

/** One connection use's line: "翻译用的连接：连接名 · 模型 · host（跟随酒馆时没有模型/host）" — named a
 * connection, so 「分析模式用的连接」 never reads like the 分析模式 switch's own line further down. */
function connectionUseLine(settings, use) {
  const choice = connectionUseChoice(settings, use);
  const label = `${CONNECTION_USE_TEXT_LABELS[use] || use}用的连接`;
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
  const drift = presetDrift(settings);
  if (drift.length) lines.push(`套餐已改过 ${drift.length} 项，不是原样：${drift.map(item => item.label).join('、')}`);
  for (const use of CONNECTION_USES) lines.push(connectionUseLine(settings, use));
  lines.push(`自动接续翻译：${boolLabel(settings.autoGeneration)}`);
  lines.push(`切换滑动页时补译：${boolLabel(settings.autoSwipe)}${settings.autoSwipe && !settings.autoGeneration ? '（自动接续翻译关着，这一项不生效）' : ''}`);
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
  lines.push(`Fish Audio › 模型：${fish.model || '未知'}`);
  lines.push(`Fish Audio API Key：${keyStatus(fish.key)}`);
  lines.push(`经酒馆 CORS 代理发送：${boolLabel(fish.viaProxy)}`);
  lines.push(`新回复自动朗读：${boolLabel(tts.autoRead)}`);
  lines.push(`点正文跳到悬浮窗：${boolLabel(settings.segmentJump !== false)}`);
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
  const installClause = regex.toInstall ? `，缺 ${regex.toInstall} 条固定正则未装` : '';
  const lines = [`镜译自己的正则：${regex.expected ?? 0} 条应有，多余 ${regex.surplus ?? 0} 条（含全局、角色绑定与预设绑定）${installClause}`];
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
// A safety ceiling only, not the primary control any more — buildHelperContext's own overall budget
// (joinTruncated against what is actually left of `cap`) is what trims the knowledge section for real.
// This used to be the primary control at 40, which cut 朗读 off after 40 of its ~60 real lines —
// dropping 分析模式 (含单次分析最长等待), 默认调音台 and 副模型提示词 — even when the overall budget had
// room to spare (review finding helper.js:286).
const KNOWLEDGE_LINES_PER_PAGE = 300;

/** "页 › 区 › 文字" lines pulled straight from the control center's own markup, so this text is never
 * out of sync with what the reader actually sees on the page.
 *
 * The markup is walked as a tree, not as a flat run of headings: a heading names the 区 only for the
 * element that contains it. A card's <h2> covers the whole card; a row's own <h3> (自动接续翻译, 只留译文)
 * covers that row and nothing after it; a fold's name — the <h2> inside its <summary>, or the summary's
 * own text when it has none — covers the whole <details>. A description line takes the nearest heading
 * among its own ancestors, so a row title never leaks onto an unrelated row further down the same card.
 *
 * A <label class="jy-check"> is the 区 for the one jy-muted paragraph right after it (流式写回, 特效字,
 * 让主模型给台词标上说话人和情绪) when it is the only checkbox in its own group; a paragraph after a group
 * of several checkboxes is shared by all of them and stays under the card's own heading.
 *
 * Description text is a <p> or <span> carrying jy-muted, a <span class="jy-label">, or any title
 * attribute. */
export function extractControlCenterKnowledge(markup) {
  const text = String(markup ?? '');
  const lines = [];
  const pageRe = /<section class="jy-page" data-jy-page="([a-z]+)"[^>]*>([\s\S]*?)(?=<section class="jy-page" data-jy-page="|$)/g;
  let pageMatch;
  while ((pageMatch = pageRe.exec(text))) {
    const pageId = pageMatch[1];
    const pageLabel = KNOWLEDGE_PAGE_LABELS[pageId] || pageId;
    // The shared per-connection edit form (index.js's single reusable <div data-jy-channel-detail>,
    // moved under whichever channel card is expanded) has no heading of its own until its first fold
    // (请求参数); its 连接名称/API 基础地址/API 密钥/当前模型 fields belong to whichever card it is moved
    // under, which the static markup cannot say. That headerless prefix is left out rather than filed
    // under a label that appears nowhere on the page.
    const body = pageMatch[2].replace(
      /<div\s+class="jy-connection-form"[^>]*data-jy-channel-detail[^>]*>[\s\S]*?(?=<details\s+class="jy-fold"\s+data-jy-fold="channel-request")/,
      '',
    );
    let countThisPage = 0;
    walkKnowledgeMarkup(body, pageLabel, (area, raw) => {
      const cleaned = stripTags(raw);
      if (cleaned.length < 2 || countThisPage >= KNOWLEDGE_LINES_PER_PAGE) return;
      const line = `${pageLabel} › ${area || pageLabel} › ${cleaned}`;
      lines.push(line.length > KNOWLEDGE_LINE_CAP ? `${line.slice(0, KNOWLEDGE_LINE_CAP)}…` : line);
      countThisPage += 1;
    });
  }
  return [...new Set(lines)];
}

const KNOWLEDGE_VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const KNOWLEDGE_TOKEN_RE = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;

function hasClass(attrs, name) {
  const match = /\bclass\s*=\s*"([^"]*)"/.exec(attrs);
  return Boolean(match && match[1].split(/\s+/).includes(name));
}

/** The nearest heading on the frames below index `end` (exclusive) — the ancestors of whatever sits at `end`. */
function headingAbove(stack, end, fallback) {
  for (let index = end - 1; index >= 0; index -= 1) if (stack[index].heading) return stack[index].heading;
  return fallback;
}

/** The tree walk behind extractControlCenterKnowledge: `emit(area, rawText)` once per description line. */
function walkKnowledgeMarkup(body, pageLabel, emit) {
  const stack = [{ tag: '#page', heading: pageLabel, checks: 0 }];
  // What is being read into right now — a heading, a checkbox label or a description element — and
  // the stack index of the element that opened it, so its own closing tag is the one that ends it.
  let capture = null;
  // The one checkbox label that may name the paragraph right after it; any other element opening in
  // between cancels it, and so does its own group turning out to hold more than one checkbox.
  let pendingCheck = null;
  const pattern = new RegExp(KNOWLEDGE_TOKEN_RE.source, 'g');
  let token;
  while ((token = pattern.exec(body))) {
    if (token[0].startsWith('<!--')) continue;
    if (token[4] !== undefined) {
      // Text inside a hidden element (a 「改过」 pill before anything has changed) is not what the page shows.
      if (capture && !stack.slice(capture.at + 1).some(frame => frame.hidden)) capture.text += token[4];
      continue;
    }
    const tag = token[2].toLowerCase();
    const attrs = token[3] || '';
    if (token[1] !== '/') {
      const title = /\btitle\s*=\s*"([^"]+)"/.exec(attrs);
      if (title) emit(headingAbove(stack, stack.length, pageLabel), title[1]);
      if (capture) capture.text += token[0];
      if (KNOWLEDGE_VOID_TAGS.has(tag) || /\/\s*$/.test(attrs)) continue;
      const cls = /\bclass\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? '';
      stack.push({ tag, cls, heading: null, checks: 0, hidden: /(?:^|\s)hidden(?:[\s=]|$)/.test(attrs) });
      if (capture) continue;
      const description = (tag === 'p' || tag === 'span') && hasClass(attrs, 'jy-muted');
      const at = stack.length - 1;
      if (tag === 'h2' || tag === 'h3' || tag === 'summary') capture = { kind: 'heading', at, text: '' };
      else if (tag === 'label' && hasClass(attrs, 'jy-check')) capture = { kind: 'check', at, text: '' };
      else if (description || (tag === 'span' && hasClass(attrs, 'jy-label'))) {
        capture = { kind: 'line', at, text: '', area: description && tag === 'p' && pendingCheck ? pendingCheck.text : null };
      }
      pendingCheck = null;
      continue;
    }
    const at = stack.map(frame => frame.tag).lastIndexOf(tag);
    if (at <= 0) {
      if (capture) capture.text += token[0];
      continue;
    }
    if (capture && at > capture.at) {
      capture.text += token[0];
      stack.length = at;
      continue;
    }
    if (capture) {
      const done = capture;
      capture = null;
      if (done.kind === 'heading') {
        // A heading names the element that holds it. A summary's name — the heading inside it when it
        // has one — names the <details> it opens, so every line anywhere in that fold files under it.
        const inner = tag === 'summary' ? /<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i.exec(done.text) : null;
        const heading = stripTags(inner ? inner[1] : done.text);
        // A wrapper that exists only to lay the heading out beside a pill (jy-card-head) passes it on
        // to the card around it.
        let index = done.at - 1;
        if (stack[index]?.tag === 'summary' || /(?:^|\s)[\w-]+-head(?:\s|$)/.test(stack[index]?.cls ?? '')) index -= 1;
        const owner = stack[index];
        if (heading && owner) owner.heading = heading;
      } else if (done.kind === 'check') {
        const owner = stack[done.at - 1];
        if (owner) owner.checks += 1;
        const label = stripTags(done.text);
        pendingCheck = label && owner ? { text: label, owner } : null;
      } else {
        emit(done.area || headingAbove(stack, done.at, pageLabel), done.text);
      }
    }
    // Closing a group that held more than one checkbox: its last label no longer speaks for what follows.
    for (let index = stack.length - 1; index >= at; index -= 1) {
      if (pendingCheck && pendingCheck.owner === stack[index] && stack[index].checks > 1) pendingCheck = null;
    }
    stack.length = at;
  }
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
 * settings summary, the current floor, the regex line and the 可用建议 whitelist are kept in full —
 * each is already small and bounded on its own (the floor preview alone is capped at
 * FLOOR_PREVIEW_LIMIT), and without them a reply cannot say anything grounded, or propose anything at
 * all. They are placed ahead of every trimmable section for the same reason (review finding
 * helper.js:387): 可用建议 used to sit last, so whenever the total ran even slightly over `cap` — the
 * old budget undercounted the runLog/knowledge/manual sections' own '【…】\n' headers, not just the
 * '\n\n' joins between parts — the final slice cut into its own tail instead of into whichever
 * trimmable section actually still had something to spare. Whatever the budget math below does, the
 * final slice is still the one guarantee that matters: the result is never longer than `cap`.
 */
export function buildHelperContext({
  versions = {},
  settings = {},
  floor = null,
  runLog = [],
  regex = null,
  knowledgeMarkup = '',
  manual = '',
  cap = HELPER_CONTEXT_CAP,
} = {}) {
  const streamingLabel = versions.streaming === true ? '开' : versions.streaming === false ? '关' : '未知';
  const versionsLine = `镜译 ${versions.appVersion || '未知版本'} · SillyTavern ${versions.hostVersion || '未知'} · 主 API：${versions.mainApi || '未知'} · 流式：${streamingLabel}`;
  const settingsText = section('设置摘要', buildSettingsSummaryLines(settings));
  const floorText = section('当前楼层', buildFloorSnapshotLines(floor));
  const regexText = section('正则', buildRegexLines(regex));
  const runLogLines = buildRunLogLines(runLog);
  const knowledgeLines = extractControlCenterKnowledge(knowledgeMarkup);
  const manualText = String(manual ?? '');
  const availableText = section('可用建议', helperAvailabilityLines(settings.uiMode));

  // Never trimmed, and — unlike the old `core`, which was only ever used to size the budget while the
  // final assembly moved 可用建议 to the very end — these are exactly the parts the final `parts` list
  // below leads with, so nothing here can be the thing a `cap` overrun eats into.
  const fixedParts = [versionsLine, settingsText, floorText, regexText, availableText];
  const fixedText = fixedParts.join('\n\n');
  const JOIN = '\n\n';
  const HEADER_RUNLOG = '【运行记录（最近）】\n';
  const HEADER_KNOWLEDGE = '【控制中心说明】\n';
  const HEADER_MANUAL = '【使用手册摘录】\n';

  // What is left for the three trimmable sections, each accounted for by its own real header length
  // and the join that attaches it — not the old flat "16" guess, which counted neither the headers nor
  // the actual number of joins and was exactly what let a small overrun eat into 可用建议's own tail.
  let remaining = Math.max(0, cap - fixedText.length - JOIN.length - HEADER_RUNLOG.length - JOIN.length - HEADER_KNOWLEDGE.length);

  // Each part takes as much of what is left as it actually needs, in this priority order, and only
  // the part that would push the total past `remaining` is the one that gets cut — never a fixed
  // share of the budget regardless of how much room is actually spare (review finding helper.js:335:
  // a manual far smaller than its old 30% "budget" still got clipped, because the split was taken off
  // the top before anyone had checked whether the whole thing even needed trimming). Run log first
  // (freshest, most likely to explain "it just broke"), then the control center's own knowledge, then
  // the static user manual last — the one most likely to still have room to spare.
  const runLogJoined = joinTruncated(runLogLines, remaining);
  remaining = Math.max(0, remaining - runLogJoined.text.length);

  const knowledgeJoined = joinTruncated(knowledgeLines, remaining);
  remaining = Math.max(0, remaining - knowledgeJoined.text.length);

  const manualBudget = Math.max(0, remaining - JOIN.length - HEADER_MANUAL.length);
  const manualTrimmed = manualText.length > manualBudget;
  const manualSlice = manualText.slice(0, manualBudget);

  const parts = [
    ...fixedParts,
    section('运行记录（最近）', runLogJoined.text || '（无）'),
    section('控制中心说明', knowledgeJoined.text || '（无）'),
    manualSlice ? section('使用手册摘录', manualSlice + (manualTrimmed ? '\n…（已截断）' : '')) : '',
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
  // nonEmpty: mergeSettings (core.js) silently refills an empty bodyTags with DEFAULT_SETTINGS.bodyTags
  // rather than keeping it empty — the same "标签名列表" only excludedTags/replaceTags actually allow
  // (review finding helper.js:496: a suggestion clearing bodyTags used to validate and show 「把「提取
  // 标签」改成「（空）」」/✓ 已改, while what actually got saved was the default list, not empty).
  { field: 'bodyTags', label: '提取标签', path: Object.freeze(['bodyTags']), kind: 'tags', nonEmpty: true },
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
  { field: 'segmentJump', label: '点正文跳到悬浮窗', path: Object.freeze(['segmentJump']), kind: 'boolean' },
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

/** A whitelisted field's own value domain, in the model's own suggestion-writing terms — without this
 * the model only ever sees the field's name, never what a legal `value` looks like (review finding
 * helper.js:322: it would write a label such as "开" instead of the value "deep", and the enum ids/整数范围/标签格式 were
 * never given anywhere). */
function helperFieldValueDomain(field) {
  if (field.kind === 'boolean') return 'true / false';
  if (field.kind === 'integer') return `整数 ${field.min}-${field.max}`;
  if (field.kind === 'tags') return '标签名列表，用顿号或逗号分隔';
  if (field.kind === 'enum') return field.options.map(option => `${option}=${field.valueLabels?.[option] ?? option}`).join('、');
  return '';
}

/** An action's own `value` domain, same idea — open-page is the only one that needs one, and its own
 * page ids are narrowed to whatever the reader's current 界面模式 actually shows in its rail, the same
 * restriction validateHelperSuggestion applies, so nothing listed here could produce a suggestion the
 * reader could not actually reach (review finding index.js:12202). */
function helperActionValueDomain(action, uiMode) {
  if (!action.needsValue) return '';
  const options = action.action === 'open-page' ? pagesForMode(uiMode) : action.options;
  return options.map(id => `${id}=${action.action === 'open-page' ? (KNOWLEDGE_PAGE_LABELS[id] || id) : id}`).join('、');
}

/** The whole "可用建议" section's lines: every whitelisted field and action, each with its own label
 * and the values a suggestion for it may actually carry. */
function helperAvailabilityLines(uiMode) {
  const fieldLines = HELPER_WHITELIST_FIELDS
    .map(field => `${field.field}（${field.label}，可填：${helperFieldValueDomain(field)}）`)
    .join('；');
  const actionLines = HELPER_WHITELIST_ACTIONS
    .map(action => (action.needsValue ? `${action.action}（${action.label}，value 填：${helperActionValueDomain(action, uiMode)}）` : `${action.action}（${action.label}）`))
    .join('；');
  return [`可以 set 的字段：${fieldLines}`, `可以 action 的动作：${actionLines}`];
}

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

function normalizeTagsValue(field, value) {
  // The settings summary prints tags joined with 、 (顿号), and helperFieldValueDomain tells the model
  // it may write them back the same way — but parseTagNamesWithErrors' own separator set (core.js)
  // never included it, so a 、-separated suggestion silently validated to null (review finding
  // helper.js:442). Only Array/string inputs reach here; a real array is left untouched.
  const source = Array.isArray(value) ? value : String(value ?? '').replace(/、/g, ',');
  const parsed = parseTagNamesWithErrors(source);
  if (parsed.invalid.length) return undefined;
  // bodyTags never actually saves empty (see the field's own `nonEmpty`, above) — offering a
  // suggestion that promises "（空）" and then silently applies the default list instead is worse than
  // not offering it at all (review finding helper.js:496).
  if (field.nonEmpty && !parsed.tags.length) return undefined;
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
    else if (field.kind === 'tags') value = normalizeTagsValue(field, raw.value);
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
      // open-page is narrowed to whatever page ids exist in the reader's *current* 界面模式 — the
      // model was only ever told about these (helperActionValueDomain above), and a suggestion for a
      // page hidden in this mode would leave no rail tab looking selected once applied (review finding
      // index.js:12202, DESIGN §15.1).
      const options = action.action === 'open-page' ? pagesForMode(settings?.uiMode) : action.options;
      if (!options.includes(value)) return null;
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
 * not handled here. `preset` is special: a real package id has to go through applyPreset so the whole
 * package's own fields actually get written, the same as the 套餐 radio and 「恢复原样」 both do — writing
 * only `preset` itself here would just rename the remembered id without touching what it applies
 * (review finding helper.js:517). Clearing it back to '' has no package content to apply, so it stays
 * a plain pathSet. */
export function applyHelperSuggestion(settings, suggestion) {
  if (!suggestion || suggestion.type !== 'set') return settings;
  if (suggestion.field === 'preset' && suggestion.value) return applyPreset(settings, suggestion.value);
  return pathSet(settings, suggestion.path, suggestion.value);
}

// ---------------------------------------------------------------------------------------------
// Reply parsing — splitting the trailing ```jingyi-suggest``` block off a reply's display text.
// ---------------------------------------------------------------------------------------------

const SUGGEST_BLOCK_RE = /```jingyi-suggest\s*([\s\S]*?)```/i;
// A reply cut off at max tokens never gets its closing fence — without this fallback the whole
// ```jingyi-suggest block, JSON and all, used to fall through untouched into the display text
// (review finding helper.js:533).
const SUGGEST_BLOCK_OPEN_RE = /```jingyi-suggest\s*([\s\S]*)$/i;

// A reasoning model's own <think>/<thinking> block, only where such a block actually sits: at the very
// start of the reply, closed by the same tag it opened with. Anywhere else a tag like this is part of
// the answer itself — explaining 排除标签 or a floor full of <thinking> blocks is exactly what this
// helper is asked about.
const LEADING_THINK_BLOCK_RE = /^\s*<(think|thinking)\b[^>]*>[\s\S]*?<\/\1>\s*/i;

/**
 * A reply's display text (the block removed, trimmed) and whatever the model put in its suggestion
 * block, parsed leniently — not yet validated against the whitelist, that is validateHelperSuggestions'
 * job once the current settings are in hand. Leniency covers three real shapes a model actually
 * produces: a trailing comma before `]`/`}` (stripped before parsing), a single suggestion object
 * instead of a one-item array (wrapped into one), and a block truncated mid-JSON with no closing fence
 * (matched up to the end of the reply instead of not at all).
 *
 * `raw` is whatever requestSubModelRaw hands back — a plain string when the ask followed the host's
 * own connection (generateRaw), or an independent connection's own { content, reasoning, … } envelope
 * (ChatCompletionService.processRequest). unwrapResponseContent is the same unwrap every other reader
 * of a sub-model reply already goes through (parseJsonCandidates, recoverStructuredTranslations); without
 * it here, an independent connection's reply read as the literal text "[object Object]" (review finding
 * helper.js:616).
 */
export function parseHelperReply(raw) {
  // An envelope whose content is blank is an empty reply: cut off by length or a content filter, or a
  // reasoning model that spent its whole budget thinking. Its reasoning is not an answer, and a
  // suggestion block drafted in there was never offered.
  const blankEnvelope = raw && typeof raw === 'object' && typeof raw.content === 'string' && !raw.content.trim();
  const unwrapped = blankEnvelope ? '' : unwrapResponseContent(raw);
  const body = typeof unwrapped === 'string' ? unwrapped : '';
  const text = body.replace(LEADING_THINK_BLOCK_RE, '').trim();
  const match = text.match(SUGGEST_BLOCK_RE) || text.match(SUGGEST_BLOCK_OPEN_RE);
  if (!match) return { text: text.trim(), rawSuggestions: [] };
  const display = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`.trim();
  const cleaned = String(match[1] ?? '').replace(/,(\s*[\]}])/g, '$1');
  const candidates = parseJsonCandidates(cleaned);
  const arrayCandidate = candidates.find(candidate => Array.isArray(candidate));
  const objectCandidate = !arrayCandidate && candidates.find(candidate => candidate && typeof candidate === 'object');
  const rawSuggestions = arrayCandidate || (objectCandidate ? [objectCandidate] : []);
  return { text: display, rawSuggestions };
}

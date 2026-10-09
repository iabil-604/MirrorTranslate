// 通话测试（测试版）: a phone call with the current character.
//
// The reader dials, the character answers first, and from then on the reader holds a button to talk (or
// types, when speech input is not set up). Each answer is asked of a model as a stream and handed to the
// reading engine as it is written, so the first sentence sounds while the rest is still being written.
// Pressing the button while the character talks cuts it off. Calls are kept in the browser, per
// character, and the last one is told to the next call so the character remembers it.
//
// Everything that touches the host, the model, the microphone or the audio is handed in, so the
// behaviour here can be tested without any of them.

export const CALL_LOG_KEY = 'jingyi-translator.call-log.v1';
/** The reader's side of the conversation before the first word: the line is picked up. */
export const CALL_OPENING = '（电话接通了）';

const NAME_SEPARATORS = ['：', ':'];
const QUOTES = /[「」『』“”"]/g;
// An aside the model was told not to write: removed when closed, held back while still open.
const ASIDES = [['（', '）'], ['(', ')'], ['【', '】'], ['[', ']']];

/**
 * What of a reply is said aloud: the model's words without asides, stage directions, reasoning, tags,
 * quote marks or a speaker's name in front. The result only ever grows as the reply grows — anything
 * that might still turn out to be removed (an aside not yet closed, a line that may become a name in
 * front) is held back until it is known — because it is handed to the reading as the text so far.
 * `final` releases what was held back and could not be an aside after all.
 */
export function spokenText(raw, { names = [], final = false } = {}) {
  let text = String(raw ?? '');
  // Reasoning written into the reply, and what follows an unclosed opening of it.
  text = text.replace(/<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi, '');
  const thinking = text.search(/<think(?:ing)?\b/i);
  if (thinking >= 0) text = text.slice(0, thinking);
  // Tags, and a tag still being written at the end. A '<' that cannot open a tag (a sign, a face,
  // a heart) is a character like any other.
  // What counts as a tag is the same whole or half written, so text let through is never taken back.
  text = text.replace(/<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?>|<![^<>]*>/g, '');
  // Where the reasoning was cut the text did not end, so nothing there is a tag being written.
  const tag = thinking >= 0 ? -1 : text.search(/<(?:\/?[A-Za-z][\w-]*(?:\s[^<>]*)?|\/|![^<>]*)?$/);
  if (tag >= 0) text = text.slice(0, tag);
  // Stage directions between asterisks; a lone asterisk may open one not closed yet. At the end it
  // was only an asterisk.
  text = text.replace(/\*[^*\n]*\*/g, '');
  const star = text.indexOf('*');
  if (star >= 0) text = final ? text.replace(/\*/g, '') : text.slice(0, star);
  for (const [open, close] of ASIDES) {
    let out = '';
    let depth = 0;
    for (const char of text) {
      if (char === open) depth += 1;
      else if (char === close && depth > 0) depth -= 1;
      else if (depth === 0) out += char;
    }
    text = out;
  }
  text = text.replace(QUOTES, '');
  const speakers = names.map(name => String(name ?? '').trim()).filter(Boolean);
  const lines = [];
  const rows = text.split('\n');
  for (const [index, line] of rows.entries()) {
    // Only the last line can still grow; a line the model has ended is what it is.
    const growing = !final && index === rows.length - 1;
    let body = line.trim();
    if (!body) continue;
    let named = false;
    for (const name of speakers) {
      for (const separator of NAME_SEPARATORS) {
        const prefix = `${name}${separator}`;
        if (body.startsWith(prefix)) {
          body = body.slice(prefix.length).trim();
          named = true;
          break;
        }
        // Still being written, it may yet become the name in front: held back.
        if (growing && prefix.startsWith(body)) {
          body = '';
          named = true;
          break;
        }
      }
      if (named) break;
    }
    if (body) lines.push(body);
  }
  return lines.join('\n').replace(/[ \t]{2,}/g, ' ').trim();
}

/** The call's instructions to the model: who it is, who is on the line, what happened, how to talk. */
export function callSystemPrompt({ char, user, character = '', persona = '', recent = '', previous = [] }) {
  const parts = [`你是${char}，正在和${user}通电话。下面是你的设定和最近发生的事，用这个身份接这通电话。`];
  if (character) parts.push(`【设定】\n${character}`);
  if (persona) parts.push(`【${user}】\n${persona}`);
  if (recent) parts.push(`【最近的剧情】\n${recent}`);
  const said = previous
    .filter(turn => String(turn?.text ?? '').trim())
    .map(turn => `${turn.from === 'user' ? user : char}：${String(turn.text).trim()}${turn.cut ? '……' : ''}`);
  if (said.length) parts.push(`【你们上一次通话】\n${said.join('\n')}`);
  parts.push([
    '【这通电话怎么说】',
    '- 只说出口的话：不写动作、神态、心理和旁白，不用括号、星号和引号，句首也不写名字。',
    `- 口语，短句，一次说一到三句，说完就停，等${user}开口。`,
    `- 只说${char}自己的话，不替${user}说。`,
    '- 直接开口：不写思考过程、分析或计划，想到什么就说什么。',
  ].join('\n'));
  return parts.join('\n\n');
}

/**
 * The conversation as chat messages. It always opens with the reader picking up, so the character's
 * first words answer a user message, and two turns from the same side in a row become one message.
 */
export function callMessages(system, turns) {
  const messages = [{ role: 'system', content: system }, { role: 'user', content: CALL_OPENING }];
  for (const turn of turns) {
    const text = String(turn?.text ?? '').trim();
    if (!text) continue;
    const role = turn.from === 'user' ? 'user' : 'assistant';
    const content = turn.cut ? `${text}……` : text;
    const last = messages[messages.length - 1];
    if (last.role === role) last.content = `${last.content}\n${content}`;
    else messages.push({ role, content });
  }
  return messages;
}

/**
 * Calls kept per character in one storage entry, newest first. A call saved again replaces itself.
 * When the entry grows past its size the oldest calls go first, whoever they were with. A storage that
 * refuses to write leaves the calls in memory for the rest of the session.
 */
export function createCallHistory(storage, { key = CALL_LOG_KEY, maxCalls = 20, maxTurns = 80, maxCharacters = 1_000_000 } = {}) {
  let memory = null;
  const empty = () => ({ version: 1, calls: {} });
  const read = () => {
    if (memory) return structuredClone(memory);
    try {
      const parsed = JSON.parse(storage?.getItem?.(key) ?? 'null');
      if (parsed && parsed.version === 1 && parsed.calls && typeof parsed.calls === 'object') return parsed;
    } catch {
      // Unreadable: start over.
    }
    return empty();
  };
  const write = data => {
    if (!memory) {
      try {
        storage.setItem(key, JSON.stringify(data));
        return true;
      } catch {
        // Full or refused: the calls stay in memory.
      }
    }
    memory = structuredClone(data);
    return false;
  };
  const oldest = data => {
    let found = null;
    for (const [owner, calls] of Object.entries(data.calls)) {
      const last = calls[calls.length - 1];
      if (last && (!found || Number(last.startedAt) < Number(found.call.startedAt))) found = { owner, call: last };
    }
    return found;
  };
  return {
    list(characterKey) {
      const calls = read().calls[characterKey];
      return Array.isArray(calls) ? calls : [];
    },
    save(characterKey, record) {
      const turns = (record.turns ?? [])
        .filter(turn => String(turn?.text ?? '').trim())
        .slice(-maxTurns)
        .map(turn => ({ from: turn.from === 'user' ? 'user' : 'char', text: String(turn.text).trim(), ...(turn.cut ? { cut: true } : {}) }));
      if (!turns.length) return false;
      const data = read();
      const call = { id: String(record.id), startedAt: Number(record.startedAt) || 0, endedAt: Number(record.endedAt) || null, peer: String(record.peer ?? ''), chatId: String(record.chatId ?? ''), turns };
      const calls = (Array.isArray(data.calls[characterKey]) ? data.calls[characterKey] : []).filter(item => item?.id !== call.id);
      calls.unshift(call);
      data.calls[characterKey] = calls.slice(0, maxCalls);
      while (JSON.stringify(data).length > maxCharacters) {
        const drop = oldest(data);
        if (!drop || (drop.owner === characterKey && data.calls[characterKey].length === 1)) break;
        data.calls[drop.owner].pop();
        if (!data.calls[drop.owner].length) delete data.calls[drop.owner];
      }
      return write(data);
    },
    clear(characterKey) {
      const data = read();
      const count = Array.isArray(data.calls[characterKey]) ? data.calls[characterKey].length : 0;
      delete data.calls[characterKey];
      write(data);
      return count;
    },
  };
}

const messageOf = error => String(error?.message ?? error ?? '出错了').trim() || '出错了';
const isAbort = error => error?.name === 'AbortError';

/**
 * One phone line. `snapshot` is what a screen shows; `on(listener)` hears every change.
 *
 * Phases: idle (no call), thinking (asked, nothing heard yet), speaking, ready (the reader's turn),
 * listening (the talk button is held), transcribing.
 *
 * Handed in:
 *   describe()            → { char, user, characterKey, chatId, character, persona, recent }; throws a
 *                           readable error when no call can be made
 *   ask({ messages, signal, onText(textSoFar) }) → the whole answer
 *   speak({ speaker })    → a reading of text still being written: push, end, cancel, resume, on, done
 *   listen({ onPartial }) → resolves once the microphone is open, to { stop() → words, cancel() }
 *   history               → createCallHistory(...)
 */
export function createCall({ describe, ask, speak, listen, history, now = () => Date.now(), log = () => {}, minHoldMs = 350 }) {
  const listeners = new Set();
  const state = {
    phase: 'idle',
    peer: '',
    user: '',
    turns: [],
    note: '',
    error: '',
    partial: '',
    // The browser would not sound without a tap / the reader paused the voice somewhere else.
    blocked: false,
    paused: false,
    startedAt: 0,
    askedAt: 0,
    listenedAt: 0,
    ended: null,
  };
  let who = null;
  let previous = [];
  let record = null;
  let turn = null;
  let mic = null;
  let serial = 0;
  // A dial waits for the chat to be read; hanging up in the meantime calls it off.
  let dialToken = 0;

  const snapshot = () => ({ ...state, turns: state.turns.map(item => ({ ...item })) });
  const emit = () => {
    const view = snapshot();
    for (const listener of listeners) {
      try {
        listener(view);
      } catch {
        // A screen's own bug is not the call's.
      }
    }
  };
  const inCall = () => state.phase !== 'idle';
  const names = () => [state.peer, state.user];
  const save = () => {
    if (!who || !record) return;
    try {
      history.save(who.characterKey, { ...record, endedAt: now(), turns: state.turns.filter(item => !item.live || item.text) });
    } catch (error) {
      log('warn', `通话记录没存上：${messageOf(error)}`);
    }
  };

  /** Whatever the character is doing, stopped: the request, the reading, and an empty line. */
  const cut = () => {
    if (!turn) return false;
    const { controller, voice, line } = turn;
    turn = null;
    controller.abort();
    try {
      voice?.cancel();
    } catch {
      // Already stopped.
    }
    line.live = false;
    if (!line.text) state.turns.splice(state.turns.indexOf(line), 1);
    else line.cut = true;
    state.blocked = false;
    state.paused = false;
    return true;
  };

  const answer = async userText => {
    cut();
    if (userText) state.turns.push({ from: 'user', text: userText });
    const id = ++serial;
    const controller = new AbortController();
    const line = { from: 'char', text: '', live: true };
    state.turns.push(line);
    state.phase = 'thinking';
    state.askedAt = now();
    state.note = '';
    state.error = '';
    state.blocked = false;
    state.paused = false;
    const mine = () => turn?.id === id;
    // Set once the answer is fully handed over: from then on the reading ending is the turn ending.
    let ending = false;
    let voice;
    try {
      voice = speak({ speaker: who.char });
    } catch (error) {
      state.turns.splice(state.turns.indexOf(line), 1);
      state.phase = 'ready';
      state.error = messageOf(error);
      emit();
      return;
    }
    turn = { id, controller, voice, line };
    voice.on?.('state', detail => {
      if (!mine()) return;
      if (detail?.state === 'speaking') {
        if (state.phase === 'thinking') {
          state.phase = 'speaking';
          log('info', `通话：${who.char} ${((now() - state.askedAt) / 1000).toFixed(2)} 秒后开口。`);
        }
        state.blocked = false;
        state.paused = false;
        emit();
      } else if (detail?.state === 'paused') {
        if (detail.blocked) state.blocked = true;
        else state.paused = true;
        emit();
      } else if (detail?.state === 'idle' && !ending) {
        // Stopped from somewhere else — the window's stop, a floor read aloud — before the answer was
        // all there: the character is cut off, as if the reader had.
        turn = null;
        controller.abort();
        line.live = false;
        if (!line.text) state.turns.splice(state.turns.indexOf(line), 1);
        else line.cut = true;
        state.phase = 'ready';
        state.blocked = false;
        state.paused = false;
        save();
        emit();
      }
    });
    emit();
    const messages = callMessages(callSystemPrompt({ ...who, previous }), state.turns.filter(item => item !== line));
    const hear = raw => {
      const said = spokenText(raw, { names: names() });
      // What was handed over is kept: the reading only takes text that continues it.
      if (said === line.text || !said.startsWith(line.text)) return;
      line.text = said;
      voice.push(said);
      emit();
    };
    let text;
    try {
      text = await ask({ messages, signal: controller.signal, onText: raw => { if (mine()) hear(raw); } });
    } catch (error) {
      if (!mine()) return;
      turn = null;
      try {
        voice.cancel();
      } catch {
        // Already stopped.
      }
      line.live = false;
      if (!line.text) state.turns.splice(state.turns.indexOf(line), 1);
      else line.cut = true;
      state.phase = 'ready';
      if (!isAbort(error)) {
        state.error = messageOf(error);
        log('warn', `通话：${who.char} 没答上来：${state.error}`);
      }
      save();
      emit();
      return;
    }
    if (!mine()) return;
    const said = spokenText(text, { names: names(), final: true });
    if (said.startsWith(line.text) && said !== line.text) {
      line.text = said;
      voice.push(said);
    }
    ending = true;
    voice.end();
    emit();
    await voice.done;
    if (!mine()) return;
    turn = null;
    line.live = false;
    if (!line.text) {
      state.turns.splice(state.turns.indexOf(line), 1);
      state.note = '对方没出声，再说一句试试。';
    }
    state.phase = 'ready';
    state.blocked = false;
    state.paused = false;
    save();
    emit();
  };

  const finishMic = async held => {
    if (held.releasedAt - held.pressedAt < minHoldMs) {
      mic = null;
      held.handle.cancel();
      state.phase = 'ready';
      state.note = '按住说话，说完再松开。';
      emit();
      return;
    }
    state.phase = 'transcribing';
    emit();
    let text = '';
    try {
      text = String(await held.handle.stop() ?? '').trim();
    } catch (error) {
      if (mic !== held) return;
      mic = null;
      state.phase = 'ready';
      state.partial = '';
      state.error = messageOf(error);
      emit();
      return;
    }
    if (mic !== held) return;
    mic = null;
    state.partial = '';
    if (!text) {
      state.phase = 'ready';
      state.note = '没听清，再说一次。';
      emit();
      return;
    }
    void answer(text);
  };

  return {
    get snapshot() { return snapshot(); },
    get phase() { return state.phase; },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async dial() {
      if (inCall()) return false;
      const token = ++dialToken;
      let described;
      try {
        described = await describe();
      } catch (error) {
        if (token !== dialToken) return false;
        state.error = messageOf(error);
        state.ended = null;
        emit();
        return false;
      }
      if (token !== dialToken || inCall()) return false;
      who = described;
      previous = (history.list(who.characterKey)[0]?.turns ?? []).slice(-12);
      state.peer = who.char;
      state.user = who.user;
      state.turns = [];
      state.note = '';
      state.error = '';
      state.partial = '';
      state.ended = null;
      state.startedAt = now();
      record = { id: `call-${state.startedAt}-${serial + 1}`, startedAt: state.startedAt, peer: who.char, chatId: who.chatId };
      log('info', `通话：打给${who.char}。`);
      void answer(null);
      return true;
    },
    /** The talk button is pressed: the character is cut off and the microphone opens. */
    async press() {
      if (!inCall() || mic || state.phase === 'transcribing') return;
      if (cut()) save();
      const held = { pressedAt: now(), releasedAt: null, handle: null };
      mic = held;
      state.phase = 'listening';
      state.listenedAt = held.pressedAt;
      state.note = '';
      state.error = '';
      state.partial = '';
      emit();
      let handle;
      try {
        handle = await listen({ onPartial: text => { if (mic === held) { state.partial = String(text ?? ''); emit(); } } });
      } catch (error) {
        if (mic !== held) return;
        mic = null;
        state.phase = 'ready';
        state.error = messageOf(error);
        emit();
        return;
      }
      if (mic !== held) {
        handle.cancel();
        return;
      }
      held.handle = handle;
      if (held.releasedAt !== null) void finishMic(held);
    },
    /** The talk button is let go: what was said is transcribed and answered. */
    release() {
      const held = mic;
      if (!held || held.releasedAt !== null) return;
      held.releasedAt = now();
      if (held.handle) void finishMic(held);
    },
    /** Typed words, for a reader without speech input. */
    send(text) {
      const words = String(text ?? '').trim();
      if (!inCall() || !words || mic || state.phase === 'transcribing') return false;
      void answer(words);
      return true;
    },
    /** The character stops talking; the call goes on. */
    interrupt() {
      if (!cut()) return;
      state.phase = 'ready';
      save();
      emit();
    },
    /** The browser wanted a tap before it would sound. */
    resume() {
      if (!turn || !(state.blocked || state.paused)) return;
      state.blocked = false;
      state.paused = false;
      turn.voice.resume?.();
      emit();
    },
    hangUp(reason = '') {
      dialToken += 1;
      if (!inCall()) return;
      cut();
      if (mic) {
        const held = mic;
        mic = null;
        held.handle?.cancel();
      }
      state.phase = 'idle';
      state.partial = '';
      state.blocked = false;
      state.paused = false;
      state.ended = { at: now(), reason: String(reason ?? '') };
      save();
      log('info', `通话：和${state.peer}的通话结束${reason ? `（${reason}）` : ''}，${state.turns.length} 句。`);
      emit();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// 已连接的应用（测试版）. Another extension — the 小手机 — says who it is, which characters it may call and
// which interfaces it will use (call.connect), and is told what is still missing for that: each item
// what it is, why it matters and where it is set. What each app said is kept while the page is open,
// together with the speakers its own readings turned out to have.
//
// Only the facts are handed in (index.js reads them off the settings); everything said about them is here.
// ---------------------------------------------------------------------------------------------

/** What an app may ask to have checked: the interfaces a call is made of. */
export const CALL_NEEDS = Object.freeze(['tts.stream', 'stt', 'llm.stream']);

const CALL_APP_NAME_MAX = 40;
const CALL_NAME_MAX = 60;
const CALL_NAMES_MAX = 60;
const CALL_SETTINGS = '镜译 → 朗读 → 更多 → 实时通话（测试版）';
const CALL_KEY_TITLES = Object.freeze({ fish: 'Fish Audio API Key', gsv: 'GPT-SoVITS 接口地址', doubao: '豆包 API Key', minimax: 'MiniMax API Key' });
const CALL_KEY_MISSING = Object.freeze({ fish: '还没填 Fish Audio 的 API Key', gsv: '还没填 GPT-SoVITS 的接口地址', doubao: '还没填豆包语音的 Key', minimax: '还没填 MiniMax 的 Key' });

function callName(value, max = CALL_NAME_MAX) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function callNames(values) {
  const list = typeof values === 'string' ? [values] : Array.isArray(values) ? values : [];
  return [...new Set(list.map(value => callName(value)).filter(Boolean))].slice(0, CALL_NAMES_MAX);
}

/**
 * What an app said when it connected, cleaned: its name (required), the characters it may call, and the
 * needs it named that are known here, in their usual order. Needs left out mean all of them; a need
 * nobody knows is not checked, which the `needs` handed back shows.
 */
export function normalizeCallApp({ app, characters, needs } = {}) {
  const name = callName(app, CALL_APP_NAME_MAX);
  if (!name) throw new Error('call.connect 要写上应用名 app，比如「小手机」。');
  const asked = typeof needs === 'string' ? [needs] : Array.isArray(needs) && needs.length ? needs : CALL_NEEDS;
  const named = asked.map(need => String(need ?? '').trim());
  return { app: name, characters: callNames(characters), needs: CALL_NEEDS.filter(need => named.includes(need)) };
}

/**
 * The apps connected on this page, in the order they first connected. A second connect from the same
 * app replaces what it said before, and forgets the speakers heard for it. `hear` adds speakers that
 * readings turned out to have to every app that reads through tts.stream, and names the apps that
 * learnt someone new. `remind` is true only the first time it is asked about an app.
 */
export function createCallApps() {
  const apps = new Map();
  const reminded = new Set();
  const copy = entry => ({ ...entry, characters: [...entry.characters], needs: [...entry.needs], seen: [...entry.seen] });
  return {
    connect(options) {
      const entry = { ...normalizeCallApp(options), seen: [] };
      apps.set(entry.app, entry);
      return copy(entry);
    },
    hear(names) {
      const heard = callNames(names);
      const changed = [];
      for (const entry of apps.values()) {
        if (!entry.needs.includes('tts.stream')) continue;
        const fresh = heard.filter(name => !entry.characters.includes(name) && !entry.seen.includes(name));
        const room = CALL_NAMES_MAX - entry.seen.length;
        if (!fresh.length || room <= 0) continue;
        entry.seen.push(...fresh.slice(0, room));
        changed.push(entry.app);
      }
      return changed;
    },
    list() {
      return [...apps.values()].map(copy);
    },
    remind(app) {
      if (reminded.has(app)) return false;
      reminded.add(app);
      return true;
    },
  };
}

/**
 * The names an app's character voices are checked for: its own, then the speakers heard since, each once.
 */
export function callAppNames(entry) {
  return [...new Set([...(entry?.characters ?? []), ...(entry?.seen ?? [])])];
}

function voicesItem(tts, voices) {
  const cloud = tts.voice === 'doubao' || tts.voice === 'minimax';
  const gsv = tts.voice === 'gsv';
  const pick = status => voices.filter(item => item.status === status).map(item => item.name);
  const unbound = pick('default');
  const gsvOnly = pick('gsv');
  const voiceless = pick('novoice');
  const muted = pick('muted');
  const skipped = pick('skipped');
  const names = voices.filter(item => item.status !== 'own').map(item => item.name);
  if (!names.length) return null;
  const list = items => items.join('、');
  const parts = [];
  if (unbound.length || gsvOnly.length) {
    const why = [
      unbound.length ? `${list(unbound)}${cloud ? '在「角色音色」里还没配音色' : gsv ? '还没绑 GPT-SoVITS 音色' : '还没绑音色'}` : '',
      gsvOnly.length ? `${list(gsvOnly)}只绑了 GPT-SoVITS 的音色，通话用的 Fish Audio 用不了` : '',
    ].filter(Boolean).join('，');
    parts.push(`${why}，通话里${cloud ? '用默认音色' : gsv ? '用 GPT-SoVITS 卡里的默认音色' : '用对白默认音色'}读`);
  }
  if (voiceless.length) parts.push(`${list(voiceless)}没有 GPT-SoVITS 音色，GPT-SoVITS 卡里也没填默认音色的参考音频，通话里读不出来`);
  if (muted.length) parts.push(`${list(muted)}在角色表里设成了不朗读，通话里不出声`);
  if (skipped.length) parts.push(`${list(skipped)}没有专属音色，「对白默认音色」又设成了跳过，通话里不出声`);
  // Where the first of them is fixed: a voice that is missing where the call's voice looks for it.
  const where = (unbound.length || gsvOnly.length) && cloud ? `${CALL_SETTINGS} → 角色音色` : '镜译 → 朗读 → 音色 → 角色表';
  return { id: 'voices', need: 'tts.stream', title: '角色音色', reason: `${parts.join('；')}。`, where, names };
}

const STT_ITEMS = Object.freeze({
  secure: { reason: '酒馆不是用 https 或本机地址打开的，浏览器不给开麦克风，语音输入用不了。', where: '用 https 或本机地址（localhost、127.0.0.1）打开酒馆' },
  browser: { reason: '这个浏览器没有自带语音识别，语音输入用不了。', where: `${CALL_SETTINGS} → 语音输入：换成「按住说话，云端转写」` },
  recorder: { reason: '这个浏览器不能录音，语音输入用不了。', where: `${CALL_SETTINGS} → 语音输入` },
  url: { reason: '还没填转写地址，语音输入用不了。', where: `${CALL_SETTINGS} → 转写地址` },
  key: { reason: '还没填转写 Key，语音输入用不了。', where: `${CALL_SETTINGS} → 转写 Key` },
});

/**
 * What is still missing for the needs an app named, item by item, in the order they are best fixed. Each
 * item: `id` (tts / key / voices / stt / llm), the `need` it is about, a short `title` (the setting's name
 * on the page), `reason` (what is missing and what that does to a call, to show the reader as it is) and
 * `where` it is set; the voices item also lists the `names` concerned.
 *
 * `facts`, read off the settings by index.js:
 *   tts:    { enabled, voice: 'fish' | 'gsv' | 'doubao' | 'minimax', keyMissing, fishCardHidden }
 *   voices: [{ name, status }], status own / default / gsv (bound to a GPT-SoVITS voice only, the call on Fish) /
 *           novoice (the call on GPT-SoVITS, no clip of its own and none on the card) / muted / skipped
 *   stt:    { available, problem: secure / browser / recorder / url / key }
 *   llm:    { problem: '' / follow / incomplete, connection, sameAsAnalysis }
 */
export function callMissing(needs, facts = {}) {
  const wanted = need => Array.isArray(needs) && needs.includes(need);
  const items = [];
  if (wanted('tts.stream')) {
    const tts = facts.tts ?? {};
    const voice = CALL_KEY_TITLES[tts.voice] ? tts.voice : 'fish';
    if (!tts.enabled) {
      items.push({ id: 'tts', need: 'tts.stream', title: '朗读功能', reason: '朗读功能没打开，镜译读不了通话里的话。', where: '镜译 → 朗读 → 打开朗读' });
    }
    if (tts.keyMissing) {
      const hidden = voice === 'fish' && tts.fishCardHidden === true;
      items.push({
        id: 'key',
        need: 'tts.stream',
        title: CALL_KEY_TITLES[voice],
        reason: `${CALL_KEY_MISSING[voice]}，镜译读不了通话里的话。${hidden ? '声音来源是 GPT-SoVITS 时「Fish Audio」卡不显示：把通话用的声音也换成 GPT-SoVITS，或者把声音来源换成 Fish Audio 填好 Key。' : ''}`,
        where: voice === 'gsv' ? '镜译 → 朗读 →「GPT-SoVITS」→ 接口地址' : voice !== 'fish' ? CALL_SETTINGS : hidden ? `${CALL_SETTINGS} → 边写边读和通话用的声音` : '镜译 → 朗读 →「Fish Audio」',
      });
    }
    const voices = voicesItem({ voice }, Array.isArray(facts.voices) ? facts.voices : []);
    if (voices) items.push(voices);
  }
  if (wanted('stt') && facts.stt && facts.stt.available === false) {
    const known = STT_ITEMS[facts.stt.problem] ?? STT_ITEMS.recorder;
    items.push({ id: 'stt', need: 'stt', title: '语音输入', ...known });
  }
  if (wanted('llm.stream') && facts.llm?.problem) {
    const { problem, connection = '', sameAsAnalysis = false } = facts.llm;
    items.push(problem === 'incomplete'
      ? { id: 'llm', need: 'llm.stream', title: '通话用的连接', reason: `通话用的连接「${connection}」还没填好地址或模型，请求不出去。`, where: '镜译 → 模型连接' }
      : {
        id: 'llm',
        need: 'llm.stream',
        title: '通话用的连接',
        reason: `${sameAsAnalysis ? '通话用的连接留空，和分析模式用同一条，现在是「跟随酒馆」' : '通话用的连接是「跟随酒馆」'}：要等整段回复写完才开始读，通话会慢。`,
        where: `${CALL_SETTINGS} → 通话用的连接：选一条存好的连接`,
      });
  }
  return items;
}

/** The one line under an app's name: everything set, or how many items are still missing. */
export function callAppSummary(missing) {
  return missing?.length ? `还缺 ${missing.length} 项` : '都设好了';
}

/** The reminder an app's first connect with something missing gets, once per page. */
export function callReminder(app, missing) {
  return `${app}连上了镜译，还缺 ${missing.length} 项：${missing.map(item => item.title).join('、')}。到「${CALL_SETTINGS.replace(/^镜译 → /, '')}」看怎么补。`;
}

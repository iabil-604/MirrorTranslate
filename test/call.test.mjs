import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CALL_NEEDS, CALL_OPENING, callAppNames, callAppSummary, callMessages, callMissing, callReminder, callSystemPrompt, createCall, createCallApps, createCallHistory,
  normalizeCallApp, spokenText,
} from '../call.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async () => { for (let i = 0; i < 6; i += 1) await tick(); };

function memoryStorage() {
  const data = new Map();
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    data,
  };
}

function fakeVoice() {
  const listeners = new Set();
  let finish = null;
  const voice = {
    pushed: [],
    ended: false,
    cancelled: false,
    resumed: 0,
    done: new Promise(resolve => { finish = resolve; }),
    push(text) { voice.pushed.push(text); },
    end() { voice.ended = true; },
    cancel() { voice.cancelled = true; finish({ cancelled: true }); },
    resume() { voice.resumed += 1; },
    on(event, listener) { listeners.add(listener); return () => listeners.delete(listener); },
    state(name, extra = {}) { for (const listener of listeners) listener({ state: name, ...extra }); },
    finish() { finish({ cancelled: false }); },
  };
  return voice;
}

function fakeLine({ describe } = {}) {
  let clock = 1000;
  const voices = [];
  const asks = [];
  const mics = [];
  const history = createCallHistory(memoryStorage());
  const call = createCall({
    describe: describe ?? (async () => ({ char: '樱井', user: '小林', characterKey: 'sakurai.png', chatId: 'chat-1', character: '角色显示名：樱井', persona: '', recent: '' })),
    ask: ({ messages, signal, onText }) => new Promise((resolve, reject) => {
      const asked = { messages, signal, onText, resolve, reject };
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      asks.push(asked);
    }),
    speak: ({ speaker }) => {
      const voice = fakeVoice();
      voice.speaker = speaker;
      voices.push(voice);
      return voice;
    },
    listen: () => new Promise((resolve, reject) => {
      const mic = { stopped: false, cancelled: false, words: '在吗？' };
      mic.open = () => resolve({ stop: async () => { mic.stopped = true; return mic.words; }, cancel: () => { mic.cancelled = true; } });
      mic.fail = error => reject(error);
      mics.push(mic);
    }),
    history,
    now: () => clock,
  });
  return { call, voices, asks, mics, history, advance: ms => { clock += ms; } };
}

test('what is said aloud leaves out asides, stage directions, quote marks and a name in front', () => {
  const names = ['樱井', '小林'];
  assert.equal(spokenText('樱井：喂？（笑）是我。', { names }), '喂？是我。');
  assert.equal(spokenText('*叹气*「你终于打来了。」', { names }), '你终于打来了。');
  assert.equal(spokenText('<think>先想想</think>在的。', { names }), '在的。');
  assert.equal(spokenText('在的。<think>还没写完的想法', { names }), '在的。', 'an unclosed reasoning block is left out');
  assert.equal(spokenText('嗯。\n\n小林: 别替我说话', { names, final: true }), '嗯。\n别替我说话', 'a name in front of any line');
  assert.equal(spokenText('樱井', { names, final: true }), '樱井', 'what could have been a name is released at the end');
  assert.equal(spokenText('价格得小于<100，别超过<200，反正得等到>300才划算', { names, final: true }), '价格得小于<100，别超过<200，反正得等到>300才划算', 'a sign is not a tag');
  assert.equal(spokenText('好痛>_<不理你了', { names, final: true }), '好痛>_<不理你了', 'nor is a face');
  assert.equal(spokenText('爱你<3 晚安<br>明天见', { names, final: true }), '爱你<3 晚安明天见', 'a heart stays, a tag goes');
  assert.equal(spokenText('好的<b', { names }), '好的', 'a tag still being written is held back');
});

test('as a reply is written what is said aloud only grows, so it can be handed over as the text so far', () => {
  const names = ['樱井', '小林'];
  const replies = [
    '樱井：喂？（小声）是我呀。你在干嘛？',
    '*轻笑* 樱井：嗯……\n我刚到家（其实早到了）。\n樱花开了哦。',
    '「好啊。」<br>那明天见。[开心] 拜拜！',
    '<think>对方问在不在</think>在，一直都在。',
    '价格得小于<100，别超过<200，反正得等到>300才划算',
    '好痛>_<不理你了，明天再说',
    '爱你<3 晚安啦<br>明天见',
  ];
  for (const reply of replies) {
    let before = '';
    for (let end = 1; end <= reply.length; end += 1) {
      const now = spokenText(reply.slice(0, end), { names });
      assert.ok(now.startsWith(before), `「${reply.slice(0, end)}」: 「${now}」 does not continue 「${before}」`);
      before = now;
    }
    assert.ok(spokenText(reply, { names, final: true }).startsWith(before), 'the end only adds');
  }
});

test('the call is one conversation that opens with the reader picking up', () => {
  const messages = callMessages('系统', [
    { from: 'char', text: '喂？' },
    { from: 'user', text: '在吗？' },
    { from: 'user', text: '听得见吗？' },
    { from: 'char', text: '我在说', cut: true },
    { from: 'char', text: '' },
  ]);
  assert.deepEqual(messages, [
    { role: 'system', content: '系统' },
    { role: 'user', content: CALL_OPENING },
    { role: 'assistant', content: '喂？' },
    { role: 'user', content: '在吗？\n听得见吗？' },
    { role: 'assistant', content: '我在说……' },
  ]);
  const prompt = callSystemPrompt({ char: '樱井', user: '小林', character: '【角色描述】\n同班同学', persona: '转学生', recent: '【樱井】\n放学了。', previous: [{ from: 'user', text: '晚安' }, { from: 'char', text: '晚安啦', cut: true }] });
  for (const part of ['你是樱井，正在和小林通电话', '【设定】\n【角色描述】\n同班同学', '【小林】\n转学生', '【最近的剧情】', '【你们上一次通话】\n小林：晚安\n樱井：晚安啦……', '不替小林说']) {
    assert.ok(prompt.includes(part), part);
  }
});

test('calls are kept per character, newest first, and the oldest go when the entry is full', () => {
  const storage = memoryStorage();
  const history = createCallHistory(storage, { maxCalls: 2, maxCharacters: 700 });
  assert.equal(history.save('a', { id: 1, startedAt: 1, turns: [{ from: 'char', text: '' }] }), false, 'a call where nothing was said is not kept');
  history.save('a', { id: 1, startedAt: 1, turns: [{ from: 'char', text: '一' }] });
  history.save('a', { id: 1, startedAt: 1, turns: [{ from: 'char', text: '一' }, { from: 'user', text: '二' }] });
  assert.equal(history.list('a').length, 1, 'saving a call again replaces it');
  history.save('a', { id: 2, startedAt: 2, turns: [{ from: 'char', text: '三' }] });
  history.save('a', { id: 3, startedAt: 3, turns: [{ from: 'char', text: '四', cut: true }] });
  assert.deepEqual(history.list('a').map(call => call.id), ['3', '2'], 'newest first, at most two');
  assert.deepEqual(history.list('a')[0].turns, [{ from: 'char', text: '四', cut: true }]);
  history.save('b', { id: 4, startedAt: 4, turns: [{ from: 'user', text: '很长'.repeat(300) }] });
  assert.ok(history.list('a').length < 2, 'the oldest call went to make room');
  assert.equal(history.list('b').length, 1, 'the new call stays');
  const left = history.list('a').length;
  assert.equal(history.clear('a'), left, 'clearing reports what was there');
  assert.equal(history.list('a').length, 0);
  assert.equal(history.list('b').length, 1, 'another character\'s calls stay');

  const refusing = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  const kept = createCallHistory(refusing);
  kept.save('a', { id: 1, startedAt: 1, turns: [{ from: 'char', text: '还在' }] });
  assert.equal(kept.list('a')[0].turns[0].text, '还在', 'a storage that refuses leaves the calls in memory');
});

test('a call: the character answers first and is heard while its answer is still being written', async () => {
  const line = fakeLine();
  const seen = [];
  line.call.on(view => seen.push(view.phase));
  assert.equal(await line.call.dial(), true);
  await settle();
  assert.equal(line.asks.length, 1);
  assert.deepEqual(line.asks[0].messages.slice(1), [{ role: 'user', content: CALL_OPENING }]);
  assert.ok(line.asks[0].messages[0].content.startsWith('你是樱井，正在和小林通电话'));
  assert.equal(line.voices[0].speaker, '樱井', 'in the character\'s voice');
  assert.equal(line.call.snapshot.phase, 'thinking');
  line.asks[0].onText('樱井：喂？');
  line.asks[0].onText('樱井：喂？是我（笑）');
  assert.deepEqual(line.voices[0].pushed, ['喂？', '喂？是我'], 'handed over as it is written');
  line.voices[0].state('speaking');
  assert.equal(line.call.snapshot.phase, 'speaking');
  line.asks[0].resolve('樱井：喂？是我（笑）。');
  await settle();
  assert.equal(line.voices[0].ended, true);
  assert.equal(line.call.snapshot.phase, 'speaking', 'still speaking until the reading is heard out');
  line.voices[0].finish();
  await settle();
  assert.equal(line.call.snapshot.phase, 'ready');
  assert.deepEqual(line.call.snapshot.turns.map(turn => [turn.from, turn.text]), [['char', '喂？是我。']]);
  assert.equal(line.history.list('sakurai.png')[0].turns[0].text, '喂？是我。', 'kept after each turn');
  assert.ok(seen.includes('thinking') && seen.includes('speaking') && seen.includes('ready'));
});

test('holding the button cuts the character off, and what the reader said is answered', async () => {
  const line = fakeLine();
  await line.call.dial();
  await settle();
  line.asks[0].onText('我跟你说，今天');
  line.voices[0].state('speaking');
  const pressing = line.call.press();
  assert.equal(line.asks[0].signal.aborted, true, 'the request is stopped');
  assert.equal(line.voices[0].cancelled, true, 'the voice is stopped');
  assert.equal(line.call.snapshot.phase, 'listening');
  line.mics[0].open();
  await pressing;
  line.advance(1200);
  line.call.release();
  await settle();
  assert.equal(line.mics[0].stopped, true);
  assert.equal(line.asks.length, 2);
  assert.deepEqual(line.asks[1].messages.slice(1), [
    { role: 'user', content: CALL_OPENING },
    { role: 'assistant', content: '我跟你说，今天……' },
    { role: 'user', content: '在吗？' },
  ], 'the cut-off line is told as cut off');
  assert.equal(line.call.snapshot.phase, 'thinking');
});

test('a tap is not a sentence, silence is asked again, and a microphone that will not open says why', async () => {
  const line = fakeLine();
  await line.call.dial();
  await settle();
  line.asks[0].resolve('喂？');
  await settle();
  line.voices[0].finish();
  await settle();

  const tap = line.call.press();
  line.mics[0].open();
  await tap;
  line.advance(100);
  line.call.release();
  await settle();
  assert.equal(line.mics[0].cancelled, true);
  assert.equal(line.call.snapshot.note, '按住说话，说完再松开。');
  assert.equal(line.asks.length, 1, 'nothing was asked');

  const quiet = line.call.press();
  line.mics[1].words = '';
  line.call.release();
  line.advance(0);
  line.mics[1].open();
  await quiet;
  await settle();
  assert.equal(line.call.snapshot.note, '按住说话，说完再松开。', 'let go before it opened, at once: still a tap');

  const silent = line.call.press();
  line.mics[2].words = '  ';
  line.mics[2].open();
  await silent;
  line.advance(900);
  line.call.release();
  await settle();
  assert.equal(line.call.snapshot.note, '没听清，再说一次。');

  const refused = line.call.press();
  line.mics[3].fail(new Error('浏览器没有给麦克风权限。'));
  await refused;
  assert.equal(line.call.snapshot.phase, 'ready');
  assert.equal(line.call.snapshot.error, '浏览器没有给麦克风权限。');
  assert.equal(line.asks.length, 1);
});

test('a failed answer is said, a half-heard one is kept, and the call goes on', async () => {
  const line = fakeLine();
  await line.call.dial();
  await settle();
  line.asks[0].reject(new Error('转写失败（HTTP 401）'));
  await settle();
  assert.equal(line.call.snapshot.phase, 'ready');
  assert.equal(line.call.snapshot.error, '转写失败（HTTP 401）');
  assert.equal(line.call.snapshot.turns.length, 0, 'an empty line does not stay');
  assert.equal(line.voices[0].cancelled, true);

  assert.equal(line.call.send('还在吗'), true, 'typing works when speaking does not');
  await settle();
  line.asks[1].onText('在，信号不太');
  line.asks[1].reject(new Error('连接断了'));
  await settle();
  assert.deepEqual(line.call.snapshot.turns.map(turn => [turn.from, turn.text, Boolean(turn.cut)]), [['user', '还在吗', false], ['char', '在，信号不太', true]]);
});

test('hanging up stops everything, keeps the call, and the next call remembers it', async () => {
  const line = fakeLine();
  await line.call.dial();
  await settle();
  line.asks[0].onText('先别挂');
  line.call.hangUp('测试');
  assert.equal(line.asks[0].signal.aborted, true);
  assert.equal(line.voices[0].cancelled, true);
  assert.equal(line.call.snapshot.phase, 'idle');
  assert.equal(line.call.snapshot.ended.reason, '测试');
  assert.equal(line.history.list('sakurai.png')[0].turns[0].text, '先别挂');

  await line.call.dial();
  await settle();
  assert.ok(line.asks[1].messages[0].content.includes('【你们上一次通话】\n樱井：先别挂……'), 'the last call is told to the next one');

  // An open microphone goes with the call.
  line.asks[1].resolve('喂');
  await settle();
  line.voices[1].finish();
  await settle();
  const pressing = line.call.press();
  line.mics[0].open();
  await pressing;
  line.call.hangUp();
  assert.equal(line.mics[0].cancelled, true);
});

test('a dial that cannot be made says why, and hanging up while it is being made calls it off', async () => {
  const refused = fakeLine({ describe: async () => { throw new Error('群聊里还不能打，切到单人聊天再试。'); } });
  assert.equal(await refused.call.dial(), false);
  assert.equal(refused.call.snapshot.error, '群聊里还不能打，切到单人聊天再试。');
  assert.equal(refused.call.snapshot.phase, 'idle');

  let release = null;
  const slow = fakeLine({ describe: () => new Promise(resolve => { release = resolve; }) });
  const dialing = slow.call.dial();
  slow.call.hangUp('关了悬浮窗');
  release({ char: '樱井', user: '小林', characterKey: 'k', chatId: 'c' });
  assert.equal(await dialing, false);
  assert.equal(slow.asks.length, 0, 'no call was started behind the reader\'s back');
});

test('a browser that wants a tap before it sounds is shown, and the tap resumes the voice', async () => {
  const line = fakeLine();
  await line.call.dial();
  await settle();
  line.asks[0].onText('喂？是我。');
  line.voices[0].state('paused', { blocked: true });
  assert.equal(line.call.snapshot.blocked, true);
  line.call.resume();
  assert.equal(line.voices[0].resumed, 1);
  assert.equal(line.call.snapshot.blocked, false);
});

test('a voice paused or stopped from somewhere else: a pause is resumed, a stop cuts the character off', async () => {
  const line = fakeLine();
  await line.call.dial();
  await settle();
  line.asks[0].onText('我跟你讲，');
  line.voices[0].state('speaking');
  line.voices[0].state('paused');
  assert.equal(line.call.snapshot.paused, true, 'paused by the reader, not blocked by the browser');
  assert.equal(line.call.snapshot.blocked, false);
  line.call.resume();
  assert.equal(line.voices[0].resumed, 1);
  assert.equal(line.call.snapshot.paused, false);
  line.voices[0].state('idle');
  assert.equal(line.asks[0].signal.aborted, true, 'the answer is not asked for any longer');
  assert.equal(line.call.snapshot.phase, 'ready');
  assert.deepEqual(line.call.snapshot.turns.map(turn => [turn.text, Boolean(turn.cut)]), [['我跟你讲，', true]]);
  await settle();
  assert.equal(line.call.snapshot.phase, 'ready', 'the aborted request does not bring anything back');

  // The reading ending after the whole answer was handed over is the turn ending, not a stop.
  line.call.send('嗯？');
  await settle();
  line.asks[1].resolve('没事。');
  await settle();
  line.voices[1].state('idle');
  assert.equal(line.asks[1].signal.aborted, false);
  line.voices[1].finish();
  await settle();
  assert.deepEqual(line.call.snapshot.turns.at(-1), { from: 'char', text: '没事。', live: false });
});

// ---------------------------------------------------------------------------------------------
// 已连接的应用: call.connect's pure half.
// ---------------------------------------------------------------------------------------------

test('an app connecting is cleaned: a name it must give, its characters once each, and only the needs known here', () => {
  assert.throws(() => normalizeCallApp({}), /app/);
  assert.throws(() => normalizeCallApp({ app: '   ' }), /app/);
  assert.deepEqual(normalizeCallApp({ app: ' 小手机 ', characters: [' 樱井 ', '樱井', '', null, { name: '对象' }, 7, '老胡'] }), {
    app: '小手机', characters: ['樱井', '7', '老胡'], needs: [...CALL_NEEDS],
  });
  // Needs come back in their usual order; one nobody knows is not checked, and nothing named means all.
  assert.deepEqual(normalizeCallApp({ app: 'a', needs: ['llm.stream', 'tts.steam', 'tts.stream'] }).needs, ['tts.stream', 'llm.stream']);
  assert.deepEqual(normalizeCallApp({ app: 'a', needs: 'stt' }).needs, ['stt']);
  assert.deepEqual(normalizeCallApp({ app: 'a', needs: [] }).needs, [...CALL_NEEDS]);
  assert.deepEqual(normalizeCallApp({ app: 'a', characters: '樱井' }).characters, ['樱井']);
  assert.equal(normalizeCallApp({ app: 'x'.repeat(80) }).app.length, 40);
  assert.equal(normalizeCallApp({ app: 'a', characters: Array.from({ length: 90 }, (_, index) => `角色${index}`) }).characters.length, 60);
});

test('apps on the page: a second connect replaces the first, speakers heard are kept for apps that read, and the reminder comes once', () => {
  const apps = createCallApps();
  apps.connect({ app: '小手机', characters: ['樱井'] });
  apps.connect({ app: '只听', needs: ['stt'] });
  assert.deepEqual(apps.hear(['老胡', '樱井', '老胡', '']), ['小手机'], 'only an app that reads through tts.stream hears anyone');
  assert.deepEqual(apps.list().map(entry => [entry.app, entry.seen]), [['小手机', ['老胡']], ['只听', []]]);
  assert.deepEqual(apps.hear(['老胡']), [], 'nobody new');
  assert.deepEqual(callAppNames(apps.list()[0]), ['樱井', '老胡']);

  const again = apps.connect({ app: '小手机', characters: ['阿星'], needs: ['tts.stream'] });
  assert.deepEqual([again.characters, again.seen, again.needs], [['阿星'], [], ['tts.stream']], 'replaced, and what was heard for it before is gone');
  assert.deepEqual(apps.list().map(entry => entry.app), ['小手机', '只听'], 'it keeps its place');
  apps.list()[0].seen.push('改不到');
  assert.deepEqual(apps.list()[0].seen, [], 'what list hands out is a copy');

  assert.equal(apps.remind('小手机'), true);
  assert.equal(apps.remind('小手机'), false);
  assert.equal(apps.remind('只听'), true);
});

const READY = Object.freeze({
  tts: { enabled: true, voice: 'fish', keyMissing: false, fishCardHidden: false },
  voices: [{ name: '樱井', status: 'own' }],
  stt: { available: true, problem: '' },
  llm: { problem: '', connection: 'DeepSeek · deepseek-chat', sameAsAnalysis: false },
});

test('nothing missing says nothing, and only the needs an app named are looked at', () => {
  assert.deepEqual(callMissing([...CALL_NEEDS], READY), []);
  const broken = {
    tts: { enabled: false, voice: 'fish', keyMissing: true },
    voices: [{ name: '老胡', status: 'default' }],
    stt: { available: false, problem: 'key' },
    llm: { problem: 'follow', connection: '跟随酒馆', sameAsAnalysis: true },
  };
  assert.deepEqual(callMissing([...CALL_NEEDS], broken).map(item => [item.id, item.need, item.title]), [
    ['tts', 'tts.stream', '朗读功能'],
    ['key', 'tts.stream', 'Fish Audio API Key'],
    ['voices', 'tts.stream', '角色音色'],
    ['stt', 'stt', '语音输入'],
    ['llm', 'llm.stream', '通话用的连接'],
  ]);
  assert.deepEqual(callMissing(['tts.stream'], broken).map(item => item.id), ['tts', 'key', 'voices'], 'an app that only reads is not told about speech input');
  assert.deepEqual(callMissing(['stt'], broken).map(item => item.id), ['stt']);
  assert.deepEqual(callMissing([], broken), []);
});

test('each missing item says what is missing, what it does to a call, and where it is set', () => {
  const [off, key] = callMissing(['tts.stream'], { tts: { enabled: false, voice: 'fish', keyMissing: true } });
  assert.equal(off.reason, '朗读功能没打开，镜译读不了通话里的话。');
  assert.equal(off.where, '镜译 → 朗读 → 打开朗读');
  assert.equal(key.reason, '还没填 Fish Audio 的 API Key，镜译读不了通话里的话。');
  assert.equal(key.where, '镜译 → 朗读 →「Fish Audio」');

  // The floors read by GPT-SoVITS: the Fish card is not on the page, and the reason says what to do.
  const [hidden] = callMissing(['tts.stream'], { tts: { enabled: true, voice: 'fish', keyMissing: true, fishCardHidden: true } });
  assert.match(hidden.reason, /声音来源是 GPT-SoVITS/);
  assert.equal(hidden.where, '镜译 → 朗读 → 更多 → 实时通话（测试版） → 边写边读和通话用的声音');

  const [doubao] = callMissing(['tts.stream'], { tts: { enabled: true, voice: 'doubao', keyMissing: true } });
  assert.deepEqual([doubao.title, doubao.reason, doubao.where], ['豆包 API Key', '还没填豆包语音的 Key，镜译读不了通话里的话。', '镜译 → 朗读 → 更多 → 实时通话（测试版）']);
  const [minimax] = callMissing(['tts.stream'], { tts: { enabled: true, voice: 'minimax', keyMissing: true } });
  assert.deepEqual([minimax.title, minimax.reason], ['MiniMax API Key', '还没填 MiniMax 的 Key，镜译读不了通话里的话。']);

  const stt = problem => callMissing(['stt'], { stt: { available: false, problem } })[0];
  assert.match(stt('secure').reason, /https/);
  assert.equal(stt('secure').where, '用 https 或本机地址（localhost、127.0.0.1）打开酒馆');
  assert.equal(stt('url').where, '镜译 → 朗读 → 更多 → 实时通话（测试版） → 转写地址');
  assert.equal(stt('key').reason, '还没填转写 Key，语音输入用不了。');
  assert.match(stt('browser').where, /按住说话，云端转写/);
  assert.equal(stt('whatever').reason, '这个浏览器不能录音，语音输入用不了。');

  const llm = facts => callMissing(['llm.stream'], { llm: facts })[0];
  assert.equal(llm({ problem: 'follow', sameAsAnalysis: false }).reason, '通话用的连接是「跟随酒馆」：要等整段回复写完才开始读，通话会慢。');
  assert.match(llm({ problem: 'follow', sameAsAnalysis: true }).reason, /^通话用的连接留空，和分析模式用同一条，现在是「跟随酒馆」/);
  assert.equal(llm({ problem: 'follow' }).where, '镜译 → 朗读 → 更多 → 实时通话（测试版） → 通话用的连接：选一条存好的连接');
  const incomplete = llm({ problem: 'incomplete', connection: '中转' });
  assert.deepEqual([incomplete.reason, incomplete.where], ['通话用的连接「中转」还没填好地址或模型，请求不出去。', '镜译 → 模型连接']);
});

test('characters without a voice are named, grouped by what the call does with them', () => {
  const voices = [
    { name: '樱井', status: 'own' },
    { name: '老胡', status: 'default' },
    { name: '阿星', status: 'default' },
    { name: '海铃', status: 'gsv' },
    { name: '路人', status: 'muted' },
    { name: '店长', status: 'skipped' },
  ];
  const [item] = callMissing(['tts.stream'], { tts: { enabled: true, voice: 'fish' }, voices });
  assert.deepEqual(item.names, ['老胡', '阿星', '海铃', '路人', '店长']);
  assert.equal(item.reason, '老胡、阿星还没绑音色，海铃只绑了 GPT-SoVITS 的音色，通话用的 Fish Audio 用不了，通话里用对白默认音色读；路人在角色表里设成了不朗读，通话里不出声；店长没有专属音色，「对白默认音色」又设成了跳过，通话里不出声。');
  assert.equal(item.where, '镜译 → 朗读 → 音色 → 角色表');

  // 豆包 and MiniMax look for a voice in their own 「角色音色」; muting is still the character table's.
  const [cloud] = callMissing(['tts.stream'], { tts: { enabled: true, voice: 'minimax' }, voices: voices.slice(0, 2) });
  assert.equal(cloud.reason, '老胡在「角色音色」里还没配音色，通话里用默认音色读。');
  assert.equal(cloud.where, '镜译 → 朗读 → 更多 → 实时通话（测试版） → 角色音色');
  const [muted] = callMissing(['tts.stream'], { tts: { enabled: true, voice: 'doubao' }, voices: [{ name: '路人', status: 'muted' }] });
  assert.equal(muted.where, '镜译 → 朗读 → 音色 → 角色表');

  assert.deepEqual(callMissing(['tts.stream'], { tts: { enabled: true, voice: 'fish' }, voices: [{ name: '樱井', status: 'own' }] }), []);
});

test('what an app is told in one line and in the reminder', () => {
  assert.equal(callAppSummary([]), '都设好了');
  const missing = callMissing([...CALL_NEEDS], { tts: { enabled: true, voice: 'fish', keyMissing: true }, stt: { available: false, problem: 'url' } });
  assert.equal(callAppSummary(missing), '还缺 2 项');
  assert.equal(callReminder('小手机', missing), '小手机连上了镜译，还缺 2 项：Fish Audio API Key、语音输入。到「朗读 → 更多 → 实时通话（测试版）」看怎么补。');
});

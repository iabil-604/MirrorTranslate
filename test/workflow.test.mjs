import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS, INVISIBLE_MARKER, mergeSettings } from '../core.js';
import { DEFAULT_PROMPT_PROFILE } from '../prompts.js';
import { buildTranslationMessages, collectTranslationContext } from '../workflow.js';
import { ANNOTATION_SOUNDS, FISH_EMOTIONS, FISH_EMOTION_GROUPS, FISH_TONES, SOUND_CUES, TONE_CUES } from '../tts.js';

test('translation context carries display names, active worldbook and clean recent chat', async () => {
  let scanReceived = null;
  const context = {
    name1: '玩家',
    name2: '樱井',
    characterId: 0,
    groupId: null,
    maxContext: 8192,
    characters: [{ name: '樱井', description: '旅行者。' }],
    substituteParams: value => value,
    chat: [
      { is_user: true, name: '玩家', mes: '桜井を呼んだ。' },
      { is_user: false, name: '樱井', mes: `「はい」\n{${INVISIBLE_MARKER}“好。”}` },
      { is_user: false, name: '樱井', mes: '<story_scene>\n桜井は振り返った。\n</story_scene>' },
    ],
    async getWorldInfoPrompt(scan) {
      scanReceived = scan;
      return {
        worldInfoBefore: '桜井的中文写法是樱井。',
        worldInfoAfter: '',
        worldInfoDepth: [{ entries: ['舞台是王都。'] }],
      };
    },
  };
  const snapshot = { context, messageId: 2 };
  const settings = mergeSettings({
    ...DEFAULT_SETTINGS,
    promptProfiles: [{ ...DEFAULT_PROMPT_PROFILE, glossary: '桜井 = 樱井' }],
    contextMessages: 3,
  });
  const packet = await collectTranslationContext(snapshot, settings);

  assert.match(packet.character, /角色显示名：樱井/);
  assert.match(packet.character, /旅行者/);
  assert.match(packet.worldbook, /中文写法是樱井/);
  assert.match(packet.worldbook, /舞台是王都/);
  assert.doesNotMatch(packet.recent, new RegExp(INVISIBLE_MARKER));
  assert.equal(scanReceived[0].startsWith('樱井: <story_scene>'), true);
});

test('translation messages use a compact prelude, specification, checklist and one data packet', () => {
  const settings = mergeSettings({
    promptProfiles: [{
      ...DEFAULT_PROMPT_PROFILE,
      jailbreakPrompt: '用户提供的前置提示词。',
      glossary: '桜井 = 樱井',
    }],
  });
  const messages = buildTranslationMessages(
    [
      { id: 7, text: '桜井は笑った。' },
      { id: 8, text: '窓を開けた。' },
      { id: 9, text: '風が吹いた。' },
    ],
    settings,
    { glossary: '桜井 = 樱井', character: '角色显示名：樱井', worldbook: '王都。', recent: '前文。' },
  );
  assert.equal(messages.length, 4);
  assert.equal(messages[0].content, '用户提供的前置提示词。');
  assert.match(messages[1].content, /# 翻译文风/);
  assert.match(messages[2].content, /<thinking>/);
  assert.match(messages[2].content, /本次启用的自定义规则/);
  assert.match(messages[2].content, /没有对应现象的规则本轮不适用/);
  assert.equal(messages.at(-1).role, 'user');
  const input = JSON.parse(messages.at(-1).content);
  assert.equal(input.mode, 'primary');
  assert.deepEqual(input.segments, [
    { id: 7, text: '桜井は笑った。' },
    { id: 8, text: '窓を開けた。' },
    { id: 9, text: '風が吹いた。' },
  ]);
  assert.deepEqual(Object.keys(input).sort(), ['mode', 'references', 'segments', 'source_language', 'target_language', 'task']);
  assert.equal(input.source_language, 'auto-detect-per-segment');
  assert.equal(input.target_language, '简体中文');
  assert.equal(input.task, 'translate_story_to_target_language');
  assert.equal(input.references.glossary, '桜井 = 樱井');
  assert.equal(input.references.worldbook, '王都。');
  assert.doesNotMatch(`${messages[1].content}\n${messages[2].content}`, /story_scene|排除标签|前后缀|写回楼层|隐藏标记/);
  const withoutPrelude = buildTranslationMessages([{ id: 1, text: '雨。' }], mergeSettings({
    promptProfiles: [{ ...DEFAULT_PROMPT_PROFILE, jailbreakPrompt: '' }],
  }), {});
  assert.equal(withoutPrelude.length, 3);
});

test('profile target language is reflected in all prompt layers and the request packet', () => {
  const settings = mergeSettings({
    promptProfiles: [{
      ...DEFAULT_PROMPT_PROFILE,
      targetLanguage: 'English',
      jailbreakPrompt: 'Translate toward {{target_language}}.',
      checklistPrompt: 'Check {{translation_direction}} before JSON.',
      styleMode: 'custom',
      styleCustom: 'Use concise English prose.',
    }],
  });
  const messages = buildTranslationMessages([{ id: 1, text: '雨が降る。' }], settings);
  assert.equal(messages[0].content, 'Translate toward English.');
  assert.match(messages[1].content, /翻译为 English/);
  assert.match(messages[1].content, /Use concise English prose/);
  assert.equal(messages[2].content, 'Check 原文语言到English before JSON.');
  assert.equal(JSON.parse(messages[3].content).target_language, 'English');
});

test('style repair carries only the draft and phrases needed for one correction', () => {
  const messages = buildTranslationMessages(
    [{ id: 2, text: '彼女は見た。' }],
    mergeSettings(),
    {},
    'style_repair',
    { draftTranslations: [{ id: 2, text: '她眸光一闪。' }], triggeredPhrases: ['眸光'] },
  );
  const input = JSON.parse(messages.at(-1).content);
  assert.equal(input.mode, 'style_repair');
  assert.deepEqual(input.draft_translations, [{ id: 2, text: '她眸光一闪。' }]);
  assert.deepEqual(input.triggered_phrases, ['眸光']);
});

test('postscript rides as the final message when set and stays absent when empty', () => {
  const quiet = buildTranslationMessages([{ id: 1, text: '雨。' }], mergeSettings());
  assert.equal(quiet.at(-1).role, 'user');
  assert.doesNotMatch(quiet.at(-1).content, /记住这些写法/);

  const settings = mergeSettings({
    promptProfiles: [{ ...DEFAULT_PROMPT_PROFILE, postscript: '记住这些写法，译名保持统一。', postscriptRole: 'system' }],
  });
  const messages = buildTranslationMessages([{ id: 1, text: '雨。' }], settings);
  assert.equal(messages.length, 4);
  assert.equal(messages.at(-1).role, 'system');
  assert.equal(messages.at(-1).content, '记住这些写法，译名保持统一。');
});

test('token-saving mode injects only the whitelist and caps recent context at two floors', async () => {
  const context = {
    name1: '玩家', name2: '樱井', characterId: 0, groupId: null,
    characters: [{ name: '樱井', description: '旅行者。' }],
    substituteParams: value => value,
    chat: [
      { is_user: false, name: '樱井', mes: '<story_scene>\n一楼层。\n</story_scene>' },
      { is_user: false, name: '樱井', mes: '<story_scene>\n二楼层。\n</story_scene>' },
      { is_user: false, name: '樱井', mes: '<story_scene>\n三楼层。\n</story_scene>' },
      { is_user: false, name: '樱井', mes: '<story_scene>\n四楼层。\n</story_scene>' },
    ],
    async getWorldInfoPrompt() { throw new Error('不应在世界书扫描中出现'); },
  };
  const snapshot = { context, messageId: 4 };
  const settings = mergeSettings({
    ...DEFAULT_SETTINGS,
    channels: [{ id: 'c1', url: 'https://example.com/v1', key: 'k', model: 'm', tokenSaving: true }],
    selectedChannelId: 'c1',
    contextMessages: 6,
  });
  const packet = await collectTranslationContext(snapshot, settings, '白名单世界书内容。');
  assert.equal(packet.worldbook, '白名单世界书内容。');
  assert.doesNotMatch(packet.recent, /一楼层/);
  assert.match(packet.recent, /三楼层/);
  assert.match(packet.recent, /四楼层/);
});

test('the annotation request appears only when colouring is on and never during style repair', () => {
  const base = mergeSettings({});
  const segments = [{ id: 1, text: '雨が降っている。' }];
  const off = buildTranslationMessages(segments, base, {}, 'primary');
  assert.equal(off.some(message => message.content.includes('附加标注')), false);
  assert.equal(JSON.parse(off.at(-1).content).annotate, undefined);

  const on = mergeSettings({ coloring: { speakers: true, emotions: true } });
  const messages = buildTranslationMessages(segments, on, {}, 'primary', { roster: ['英梨梨', '加藤'] });
  const section = messages.find(message => message.content.includes('附加标注'));
  assert.ok(section, '开启后必须带上标注说明');
  assert.match(section.content, /英梨梨、加藤/);
  // "No mood in particular" is asked for by leaving the mood out, so it is not offered as one.
  assert.doesNotMatch(section.content, /\bneutral\b/);
  assert.match(section.content, /看不出明显情绪就不写 emotion/);
  assert.match(section.content, /拿不准的字段直接不写，不要猜/);
  const input = JSON.parse(messages.find(message => message.role === 'user').content);
  assert.deepEqual(input.annotate.roster, ['英梨梨', '加藤']);
  assert.equal(input.annotate.speaker, true);
  assert.equal(input.annotate.emotion, true);
  assert.ok(input.annotate.emotions.includes('angry'));
  assert.equal(input.annotate.emotions.includes('neutral'), false);

  // Style repair rewrites a finished draft; re-asking for labels there only invites churn.
  const repair = buildTranslationMessages(segments, on, {}, 'style_repair', { roster: ['英梨梨'] });
  assert.equal(repair.some(message => message.content.includes('附加标注')), false);
  assert.equal(JSON.parse(repair.find(message => message.role === 'user').content).annotate, undefined);

  // Speaker-only mode must not ask for emotions, and vice versa.
  const speakerOnly = buildTranslationMessages(segments, mergeSettings({ coloring: { speakers: true } }), {}, 'primary', {});
  const speakerSection = speakerOnly.find(message => message.content.includes('附加标注'));
  assert.match(speakerSection.content, /speaker/);
  assert.doesNotMatch(speakerSection.content, /emotion：/);
});

test('the annotation section restates the output shape, because §9 shows an id/text-only example', () => {
  const on = mergeSettings({ coloring: { speakers: true, emotions: true } });
  const messages = buildTranslationMessages([{ id: 1, text: '雨が降っている。' }], on, {}, 'primary', { roster: ['英梨梨'] });
  const spec = messages.find(message => message.content.includes('# 9. 输出协议'));
  const section = messages.find(message => message.content.includes('附加标注'));

  // The spec the user can edit still shows the plain shape; that is exactly why the section has to
  // carry its own, or the model copies the example it was shown and answers without any labels.
  assert.match(spec.content, /\{"translations":\[\{"id":\d+,"text":"[^"]*"\}/);
  const shape = section.content.match(/\{"translations":\[[\s\S]*?\]\}/);
  assert.ok(shape, '标注说明必须自带 JSON 示例');
  const [item] = JSON.parse(shape[0]).translations;
  assert.deepEqual(Object.keys(item), ['id', 'text', 'speaker', 'emotion', 'intensity']);
  assert.match(section.content, /替换输出协议里的 JSON 示例/);

  // Naming a real label in the example biases every segment towards it; the stand-in is one the
  // reader of the answer throws away if it comes back.
  assert.equal(item.emotion, '<情绪词>');
  assert.equal(item.speaker, '<人名>');

  const speakerOnly = buildTranslationMessages([{ id: 1, text: '雨' }], mergeSettings({ coloring: { speakers: true } }), {}, 'primary', {});
  const speakerShape = speakerOnly.find(message => message.content.includes('附加标注')).content.match(/\{"translations":\[[\s\S]*?\]\}/);
  assert.deepEqual(Object.keys(JSON.parse(speakerShape[0]).translations[0]), ['id', 'text', 'speaker']);
});


test('the reading asks the translation for Fish\'s own words and one mark per quoted run, colouring or not', () => {
  const reading = mergeSettings({ tts: { enabled: true } });
  const segments = [{ id: 1, text: '「来たんだね」' }];
  const messages = buildTranslationMessages(segments, reading, {}, 'primary', { roster: ['樱井'] });
  const section = messages.find(message => message.content.includes('附加标注'));
  assert.ok(section, 'the reading alone is reason enough to label');
  assert.match(section.content, /frustrated/);
  assert.match(section.content, /whispering（[^）]+）、soft tone（[^）]+）、shouting（[^）]+）、screaming（[^）]+）、in a hurry tone（[^）]+）/);
  assert.match(section.content, /「」/);
  assert.match(section.content, /不要把标注、情绪词或任何方括号标签写进 text/);
  const example = section.content.split('\n').find(line => line.startsWith('{"translations"'));
  const [item] = JSON.parse(example).translations;
  assert.deepEqual(Object.keys(item), ['id', 'text', 'speaker', 'emotion', 'intensity', 'tone', 'quotes'], 'the simple reading asks for no directions');
  assert.deepEqual(Object.keys(item.quotes[0]), ['head', 'speaker', 'emotion', 'intensity']);
  assert.doesNotMatch(section.content, /direction：一句 20 字左右/);
  // Sounds only where the text writes them out, and never breath or moans.
  assert.match(section.content, /chuckling（轻笑/);
  assert.doesNotMatch(section.content, /moaning|panting|groaning|flirtatious/);
  assert.match(section.content, /喘息、喘气、呻吟、娇喘、闷哼都不写 sounds/);
  // 呼吸声 is what the breath slider calls sighing and gasping: forbidding it would forbid the written sigh.
  assert.doesNotMatch(section.content, /呼吸声都不写/);
  const input = JSON.parse(messages.find(message => message.role === 'user').content);
  assert.equal(input.annotate.quotes, true);
  assert.equal(input.annotate.direction, undefined);
  assert.ok(input.annotate.sounds.includes('sighing'), 'the sounds offered are the ones Fish lists');
  assert.equal(input.annotate.sounds.includes('moaning'), false);
  // The consoles reach the translation as rules under each name.
  const styled = buildTranslationMessages(segments, reading, {}, 'primary', { roster: ['樱井'], styles: [{ name: '樱井', rules: ['气息感明显但自然。'] }] });
  assert.match(styled.find(message => message.content.includes('附加标注')).content, /樱井：气息感明显但自然。/);
  assert.ok(input.annotate.emotions.includes('sarcastic'));
  assert.deepEqual(input.annotate.tones, ['whispering', 'soft tone', 'shouting', 'screaming', 'in a hurry tone']);
  assert.equal(buildTranslationMessages(segments, reading, {}, 'style_repair', {}).some(message => message.content.includes('附加标注')), false);
  // Colouring on its own keeps the palette's twelve and asks for the runs only where one line holds
  // two people.
  const colouring = buildTranslationMessages(segments, mergeSettings({ coloring: { speakers: true, emotions: true } }), {}, 'primary', {});
  const plain = colouring.find(message => message.content.includes('附加标注'));
  assert.match(plain.content, /一项里有两个或更多不同的人说话时，再写 quotes/);
  assert.doesNotMatch(plain.content, /sarcastic/);
  // The deep reading reads the original by itself the moment it closes, so the translation is never
  // asked to mark anything: nothing of this request is its to reuse.
  const deep = buildTranslationMessages(segments, mergeSettings({ tts: { enabled: true, mode: 'deep', deepUnlocked: true } }), {}, 'primary', { roster: ['樱井'] });
  assert.equal(deep.some(message => message.content.includes('附加标注')), false, 'the deep reading costs the translation nothing');
  assert.equal(JSON.parse(deep.find(message => message.role === 'user').content).annotate, undefined);
  // The plain reading takes the marks from the translation: they cost nothing there, and a
  // translated floor reads from them whatever the mode.
  const plainReading = buildTranslationMessages(segments, mergeSettings({ tts: { enabled: true, mode: 'off' } }), {}, 'primary', {});
  assert.equal(plainReading.some(message => message.content.includes('附加标注')), true);
  assert.notEqual(JSON.parse(plainReading.find(message => message.role === 'user').content).annotate.direction, true, 'but never the deep reading\'s directions');
});
test('recent context quotes the extracted body and leaves the surrounding panels behind', async () => {
  // A floor as the presets that prompted this actually build one: the prose is a small part of it,
  // wrapped in reasoning, a status panel and a choice list, all of which used to travel as context.
  const floor = [
    '<story_driver>',
    '【現在の物語の雰囲気】：宴の余韻。',
    '[本文の文字数要件]: 5500文字以上',
    '</story_driver>',
    '<story_scene>',
    '雨が降っている。',
    '</story_scene>',
    '<status>',
    '💰持有金钱: 0',
    '</status>',
    '<selection>',
    'A. 问问希尔达。',
    '</selection>',
  ].join('\n');
  const context = {
    name1: '玩家', name2: '樱井', characterId: null, groupId: null,
    substituteParams: value => value,
    chat: [
      { is_user: false, name: '樱井', mes: floor },
      { is_user: true, name: '玩家', mes: '我抱起艾莉丝。' },
      { is_user: false, name: '樱井', mes: '<story_scene>\n風が冷たい。\n</story_scene>' },
      { is_user: false, name: '樱井', mes: '（这一楼没有正文标签）' },
      { is_user: false, name: '樱井', mes: '<story_scene>\n目标楼层。\n</story_scene>' },
    ],
  };
  const settings = mergeSettings({
    ...DEFAULT_SETTINGS,
    includeWorldbook: false,
    includeCharacterCard: false,
    contextMessages: 6,
  });
  const packet = await collectTranslationContext({ context, messageId: 4 }, settings);

  // The prose from every tagged floor is there.
  assert.match(packet.recent, /雨が降っている。/);
  assert.match(packet.recent, /風が冷たい。/);
  // Everything wrapped around it is not.
  assert.doesNotMatch(packet.recent, /story_driver/);
  assert.doesNotMatch(packet.recent, /5500文字/);
  assert.doesNotMatch(packet.recent, /持有金钱/);
  assert.doesNotMatch(packet.recent, /问问希尔达/);
  // A user's own message is prose already and carries no tags, so it travels whole.
  assert.match(packet.recent, /我抱起艾莉丝。/);
  // An AI floor with no body to quote contributes nothing rather than its panels.
  assert.doesNotMatch(packet.recent, /这一楼没有正文标签/);
});

test('the roster goes out as people, and stays open to anyone a colour or a voice can still be given to', () => {
  const segments = [{ id: 1, text: '「来たんだね」' }];
  const roster = [{ name: '莉莉丝', aliases: ['莉莉', 'Lilith'] }, '艾琳', { name: '艾琳', aliases: ['小艾'] }, { name: '露娜', aliases: ['艾琳'] }];
  const section = settings => buildTranslationMessages(segments, mergeSettings(settings), {}, 'primary', { roster })
    .find(message => message.content.includes('附加标注')).content;
  const open = section({ coloring: { speakers: true } });
  // One entry per person, the other spellings beside the name to write; an alias that is somebody
  // else's own name is dropped rather than sending that person's lines to the wrong one.
  assert.match(open, /已知人物：莉莉丝（又名 莉莉、Lilith）、艾琳（又名 小艾）、露娜。/);
  assert.match(open, /名单外的人：写译文里对这个人的称呼/);
  // Only with auto-colouring off and no reading is a name outside the roster of no use.
  assert.match(section({ coloring: { speakers: true, autoSpeakers: false } }), /名单外的人不写 speaker。/);
  assert.match(section({ coloring: { speakers: true, autoSpeakers: false }, tts: { enabled: true } }), /名单外的人：写译文里对这个人的称呼/);
  // The request body still carries plain names.
  const input = JSON.parse(buildTranslationMessages(segments, mergeSettings({ coloring: { speakers: true } }), {}, 'primary', { roster })
    .find(message => message.role === 'user').content);
  assert.deepEqual(input.annotate.roster, ['莉莉丝', '艾琳', '露娜']);
});

test('the reading\'s mood list is grouped, glossed and free of the words that pull a voice towards breath', () => {
  const messages = buildTranslationMessages([{ id: 1, text: '「好」' }], mergeSettings({ tts: { enabled: true } }), {}, 'primary', {});
  const section = messages.find(message => message.content.includes('附加标注')).content;
  assert.match(section, /^害羞：shy（害羞）、embarrassed（难为情、尴尬）、ashamed（羞愧）$/m);
  // The groups hold every word the reading hears, once; nothing else.
  const grouped = FISH_EMOTION_GROUPS.flatMap(([, words]) => words.map(([word]) => word));
  assert.deepEqual([...grouped].sort(), [...FISH_EMOTIONS].sort());
  assert.equal(new Set(grouped).size, grouped.length);
  for (const word of ['flirtatious', 'moaning', 'panting', 'groaning', 'neutral']) assert.doesNotMatch(section, new RegExp(`\\b${word}\\b`));
  assert.doesNotMatch(section, /撒娇/, 'a coaxing scene is not steered onto a word of its own');
  // Every English word in the section is one the model is asked to copy, or a field name.
  const fields = new Set(['JSON', 'id', 'text', 'speaker', 'emotion', 'intensity', 'tone', 'quotes', 'head', 'sounds', 'at', 'tag', 'start', 'end', 'type', 'narration', 'translations']);
  const offered = new Set([...FISH_EMOTIONS, ...FISH_TONES, ...ANNOTATION_SOUNDS].flatMap(word => word.split(' ')));
  const english = section.replace(/\{"translations"[^\n]*\n/, '').match(/[A-Za-z]+/g) ?? [];
  assert.deepEqual([...new Set(english.filter(word => !fields.has(word) && !offered.has(word)))], [], 'no English beyond the words to copy');
  const input = JSON.parse(messages.find(message => message.role === 'user').content);
  assert.deepEqual(input.annotate.emotions, [...FISH_EMOTIONS]);
});

test('every rule of the annotation section is one a model can check against the page', () => {
  const styles = [{ name: '默认', rules: ['情感强度高：对白句都要给 emotion，不要省略。', '不要非语言声音：sounds 一律不写。'] }];
  const section = buildTranslationMessages([{ id: 1, text: '「来たんだね」' }], mergeSettings({ tts: { enabled: true } }), {}, 'primary', { roster: ['樱井'], styles })
    .find(message => message.content.includes('附加标注')).content;
  // A tone and a sound are asked for by the very words the reading checks a mark against, in either
  // language, and by what the words mean rather than by an exact string the source may not contain.
  for (const tone of FISH_TONES) assert.match(section, new RegExp(`${tone}（${TONE_CUES[tone].join('、')}）`));
  for (const sound of ANNOTATION_SOUNDS) assert.match(section, new RegExp(`${sound}（${SOUND_CUES[sound].join('、')}）`));
  assert.match(section, /看意思，不要求逐字，原文或译文写了都算/);
  assert.doesNotMatch(section, /逐字写了|原文依据逐字/);
  // A sound is the narration's, never the quote's own interjection laid over again.
  assert.match(section, /在引号外写了说这处台词的人发出/);
  assert.match(section, /台词里已经写出这个声音（哈哈、唉、呜呜）/);
  // Who speaks is read off what is written — self-reference and address included — not guessed.
  assert.match(section, /台词里的自称（我、俺、僕、私）、口癖和语尾/);
  assert.match(section, /只有称呼没有名字的人（老师、店长、大小姐这类）照写这个称呼/);
  // The runs are the translation's, since that is where a head is looked for.
  assert.match(section, /head 照抄译文里这处引号里开头 2 到 6 个字/);
  // Strength by triggers that do not overlap without an order, and the ellipsis alone is no trigger.
  assert.match(section, /两边都符合时写 2。省略号、结巴和重复字本身不改变强度/);
  // The reader's sliders decide the leaning; a slider that forbids sounds is obeyed.
  assert.match(section, /和上面的强度条件冲突时以它们为准；tone 和 sounds 仍然必须有原文依据；规则要求少写或不写 sounds、tone 时照做：默认：/);
  assert.match(section, /不要非语言声音：sounds 一律不写/);
  // One silent pass over the whole answer, never a report per id.
  assert.match(section, /输出前整体核对一遍，不写出核对过程/);
  assert.doesNotMatch(section, /逐项核对/);
  // Colouring alone: the heads come from the translation too, and the loud and quiet moods are glossed
  // with the same words as the reading's tones.
  const colouring = buildTranslationMessages([{ id: 1, text: '「来たんだね」' }], mergeSettings({ coloring: { speakers: true, emotions: true } }), {}, 'primary', {})
    .find(message => message.content.includes('附加标注')).content;
  assert.match(colouring, /\{"head":"<译文里这处台词开头 2 到 6 个字>"/);
  assert.match(colouring, new RegExp(`whisper（压低声音说，原文或译文写了${[...TONE_CUES.whispering, ...TONE_CUES['soft tone']].join('、')}这类说法才用）`));
});

test('the translation counts every quote, says where a sound may go and what a line of nothing but 嗯 may wear', async () => {
  const { SOFT_MOODS, SOUND_PLACE_RULE } = await import('../tts.js');
  const section = buildTranslationMessages([{ id: 1, text: '「来たんだね」' }], mergeSettings({ tts: { enabled: true } }), {}, 'primary', { roster: ['樱井'] })
    .find(message => message.content.includes('附加标注')).content;
  // A sign is counted as a quote of its own and marked as the narrator's: on the original's side the
  // runs are placed by order, and a sign left out would shift every run after it.
  assert.match(section, /quotes：译文里每一处引号写一项，按出现顺序，包括不算台词的那几处/);
  assert.match(section, /不算台词的那处只写 head 和 "type":"narration"/);
  // A line whose one quote is a sign still says so, or the sign is read as a line in the narration's mood.
  assert.match(section, /只有一处引号、而且它是台词时可以不写/);
  assert.doesNotMatch(section, /只有一处引号时可以不写/);
  assert.match(section, /只有一处引号时也可以写在外层/);
  assert.match(section, /quotes 的项数不多于译文里这一项的引号数/);
  // A thought in quotes is its thinker's, the way the analyses read it.
  assert.match(section, /这些引号里的话，心里想的话也算/);
  assert.ok(section.includes(SOUND_PLACE_RULE));
  assert.ok(section.includes(`台词只有嗯、啊、哈、唉这类语气词时：emotion 不用 ${SOFT_MOODS.join('、')}，tone 只能写 shouting 或 screaming，不写 sounds。`));
  // Colouring alone names no moods for a reading it does not ask for.
  const colouring = buildTranslationMessages([{ id: 1, text: '「来たんだね」' }], mergeSettings({ coloring: { speakers: true, emotions: true } }), {}, 'primary', {})
    .find(message => message.content.includes('附加标注')).content;
  assert.doesNotMatch(colouring, /台词只有嗯、啊/);
});

test('every stand-in the annotation example shows is thrown away when a model copies it back', async () => {
  const { readAnnotationFields, EXAMPLE_STAND_INS } = await import('../core.js');
  const sections = [
    mergeSettings({ tts: { enabled: true } }),
    mergeSettings({ coloring: { speakers: true, emotions: true } }),
  ].map(settings => buildTranslationMessages([{ id: 1, text: '「来たんだね」' }], settings, {}, 'primary', {}).find(message => message.content.includes('附加标注'))?.content ?? '');
  const shown = new Set(sections.flatMap(section => [...section.matchAll(/"<([^"<>]+)>"/g)].map(match => match[1])));
  assert.ok(shown.size >= 4);
  for (const standIn of shown) {
    assert.ok(EXAMPLE_STAND_INS.includes(standIn), standIn);
    assert.equal(readAnnotationFields({ speaker: `<${standIn}>`, emotion: `<${standIn}>`, tone: `<${standIn}>` }), null, standIn);
  }
});

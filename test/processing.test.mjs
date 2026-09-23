import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, INVISIBLE_MARKER, MESSAGE_META_KEY, SOURCE_START,
  assembleBilingual, segmentSource, stripGeneratedTranslationLines, interceptGenerationChat,
  extractGeneratedTranslations, restyleBilingual, mergeSettings,
} from '../core.js';
import {
  normalizeProcessingSettings, getActiveProcessingProfile, makeBuiltinReadingProfile,
  selectProcessingProfile, captureProcessingProfile, exportProcessingProfile, importProcessingProfile,
  importNativeRegex, syncNativeRegex, readNativeRegexEdits, compileNativeRegex,
} from '../processing.js';
import { __testing } from '../index.js';

const visible = text => text.replace(/[\u200b\u200c\u2060-\u2064]/g, '');

test('restyling updates existing swipe translations together and rolls back if saving fails', async t => {
  const previousHost = globalThis.SillyTavern;
  t.after(() => { globalThis.SillyTavern = previousHost; });
  const render = (original, translation) => assembleBilingual(segmentSource(original).layout, new Map([[1, translation]]));
  const first = render('原文一。', 'One.'), second = render('原文二。', 'Two.');
  const message = {
    mes: first, swipe_id: 0, swipes: [first, second],
    extra: { untouched: 'other extension', [MESSAGE_META_KEY]: { schema_version: 4, source_hash: 'saved-source' } },
    swipe_info: [{ extra: { other: 1 } }, { extra: { other: 2 } }],
  };
  let saves = 0, reloads = 0;
  const context = { chat: [message, { is_user: true, mes: '用户原样保留。' }], chatId: 'local-fixture',
    saveChat: async () => { saves += 1; }, reloadCurrentChat: async () => { reloads += 1; } };
  globalThis.SillyTavern = { getContext: () => context };
  const style = makeBuiltinReadingProfile(normalizeProcessingSettings(), 'fold').settings;
  await __testing.restyleCurrentChat(style);
  assert.equal(saves, 1);
  assert.equal(reloads, 1);
  assert.equal(message.mes, message.swipes[0]);
  assert.deepEqual(message.swipes.map(text => [...extractGeneratedTranslations(text).values()]), [['One.'], ['Two.']]);
  assert.deepEqual(message.swipes.map(text => stripGeneratedTranslationLines(text)), ['原文一。', '原文二。']);
  assert.equal(message.extra.untouched, 'other extension');
  assert.equal(message.extra[MESSAGE_META_KEY].source_hash, 'saved-source');
  assert.equal(message.swipe_info[1].extra.other, 2);
  assert.equal(context.chat[1].mes, '用户原样保留。');
  const saved = structuredClone(message);
  context.saveChat = async () => { throw new Error('local save failure'); };
  await assert.rejects(__testing.restyleCurrentChat({ ...style, translationPrefix: '', translationSuffix: '' }), /local save failure/);
  assert.deepEqual(message, saved);
  assert.equal(reloads, 1);
});

test('empty and custom affixes filter by ownership, retaining identical natural punctuation and canonical history', () => {
  const source = '☆{原文自带的 {花括号}，保留它。}';
  for (const options of [
    { segmentPrefix: '☆{', segmentSuffix: '}', translationPrefix: '【', translationSuffix: '】' },
    { segmentPrefix: '', segmentSuffix: '', translationPrefix: '', translationSuffix: '' },
  ]) {
    const rendered = assembleBilingual(segmentSource(source, options).layout, new Map([[1, '译文 {括号也是内容}。']]), options);
    assert.equal(visible(rendered), `${options.segmentPrefix}${source}${options.segmentSuffix}\n${options.translationPrefix}译文 {括号也是内容}。${options.translationSuffix}`);
    const message = { mes: `<story_scene>${rendered}</story_scene>\n外面也有☆{普通文本}` };
    const prompt = [message];
    assert.equal(interceptGenerationChat(prompt), 1);
    assert.equal(prompt[0].mes, `<story_scene>${source}</story_scene>\n外面也有☆{普通文本}`);
    assert.notEqual(prompt[0], message);
    assert.ok(message.mes.includes('译文'));
    assert.equal(extractGeneratedTranslations(rendered, options).get(1), '译文 {括号也是内容}。');
  }
});

test('legacy wrapper migration requires metadata and an adjacent marked translation', () => {
  const source = '☆{原文自带}';
  const legacy = `<story_scene>\n☆{${source}}\n{${INVISIBLE_MARKER}<b>译文。</b>${INVISIBLE_MARKER}}\n\n☆{没有译文的普通文字}\n</story_scene>`;
  const metadata = { schema_version: 3, body_tags: ['story_scene'], segment_prefix: '☆{', segment_suffix: '}', translation_prefix: '<b>', translation_suffix: '</b>' };
  const clean = `<story_scene>\n${source}\n\n☆{没有译文的普通文字}\n</story_scene>`;
  assert.equal(stripGeneratedTranslationLines(legacy, metadata), clean);
  assert.ok(stripGeneratedTranslationLines(legacy).includes(`☆{${source}}`));
  const restyled = restyleBilingual(legacy, { translationPrefix: '', translationSuffix: '' }, metadata);
  assert.equal(stripGeneratedTranslationLines(restyled), clean);
  assert.ok(restyled.includes(SOURCE_START));
  assert.equal(visible(restyled), `<story_scene>\n${source}\n译文。\n\n☆{没有译文的普通文字}\n</story_scene>`);
  const prompt = [{ mes: legacy, extra: { [MESSAGE_META_KEY]: metadata } }];
  interceptGenerationChat(prompt);
  assert.equal(prompt[0].mes, clean);
});

test('repeated restyling reuses translations and keeps the source and unrelated content unchanged', () => {
  const original = '原文。\n第二行。\n\n后段。';
  const translations = new Map([[1, 'Translation.'], [2, 'Second line.'], [3, 'Last paragraph.']]);
  const message = assembleBilingual(segmentSource(original).layout, translations);
  const style = { segmentPrefix: '<small>', segmentSuffix: '</small>', translationPrefix: '「', translationSuffix: '」' };
  const next = restyleBilingual(message, style);
  assert.equal(restyleBilingual(next, style), next);
  assert.equal(stripGeneratedTranslationLines(next), original);
  assert.deepEqual([...extractGeneratedTranslations(next, style)], [...translations]);
  assert.deepEqual([...extractGeneratedTranslations(next)], [...translations]);
});

test('old visible brace settings migrate once and new explicit empty strings remain empty', () => {
  const migrated = mergeSettings({ schemaVersion: 10, translationPrefix: '<b>', translationSuffix: '</b>' });
  assert.equal(migrated.translationPrefix, '{<b>');
  assert.equal(migrated.translationSuffix, '</b>}');
  assert.equal(mergeSettings(migrated).translationPrefix, '{<b>');
  assert.equal(mergeSettings().translationPrefix, '{');
  assert.equal(mergeSettings({ ...DEFAULT_SETTINGS, translationPrefix: '', translationSuffix: '' }).translationPrefix, '');
});

test('a shared processing profile carries native regex bodies, ordering and flags, without connection settings', () => {
  const settings = normalizeProcessingSettings();
  const active = getActiveProcessingProfile(settings);
  settings.bodyTags = ['custom_story']; settings.autoEdit = true;
  settings.channels[0].key = 'connection-only-fixture';
  active.regexScripts = importNativeRegex([
    { id: 'same', scriptName: 'One', findRegex: '/hello/gi', replaceString: '你好', placement: [2], disabled: false, markdownOnly: true, futureField: 'keep' },
    { id: 'same', scriptName: 'Two', findRegex: 'world', replaceString: '世界', placement: [2], disabled: true, trimStrings: ['!'] },
  ]);
  captureProcessingProfile(settings);
  const exported = exportProcessingProfile(active);
  assert.doesNotMatch(JSON.stringify(exported), /connection-only-fixture|selectedPromptProfileId|channels/);
  const imported = importProcessingProfile(JSON.parse(JSON.stringify(exported)));
  assert.deepEqual(imported.settings, active.settings);
  assert.notEqual(imported.id, active.id);
  assert.deepEqual(imported.regexScripts.map(({ id, ...rule }) => rule), active.regexScripts.map(({ id, ...rule }) => rule));
  assert.notEqual(imported.regexScripts[0].id, imported.regexScripts[1].id);
  assert.equal(imported.regexScripts[0].futureField, 'keep');
  assert.equal(Object.hasOwn(imported.regexScripts[1], 'markdownOnly'), false);
  assert.throws(() => importNativeRegex({ scriptName: 'Broken', findRegex: '/(/', replaceString: '', placement: [2] }), /无效/);
});

test('native registration is isolated, stable across saves and switches, and reads native edits back', () => {
  const settings = normalizeProcessingSettings();
  const cute = makeBuiltinReadingProfile(settings, 'cute');
  const fold = makeBuiltinReadingProfile(settings, 'fold');
  const unrelated = { id: 'user-rule', scriptName: 'User rule', findRegex: 'x', replaceString: 'y', placement: [2] };
  const first = syncNativeRegex([unrelated], cute);
  assert.deepEqual(syncNativeRegex(first, cute), first);
  // Internal rules sit ahead of everything else: display rules (boundary cleanup, hidden replace
  // originals, the quotation marks inside the story's own speaker marks, the marks themselves) and
  // four prompt guards.
  const internal = first.filter(rule => rule.jingyi_managed?.internal);
  assert.equal(internal.length, 10);
  const marks = internal.find(rule => rule.id.endsWith(':speech-marks'));
  const quoteRules = internal.filter(rule => rule.id.includes(':speech-quote-'));
  assert.equal(quoteRules.length, 3);
  assert.ok(quoteRules.every(rule => rule.markdownOnly && rule.promptOnly), 'mended where the floor is drawn and where the main model reads it, never in the saved floor');
  assert.ok(internal.indexOf(quoteRules.at(-1)) < internal.indexOf(marks), 'mended while the marks still say where the line ends');
  const mend = text => quoteRules.reduce((value, rule) => value.replace(compileNativeRegex(rule.findRegex), rule.replaceString), text);
  assert.equal(mend('<say who="樱井" mood="开心">「好。"</say>'), '<say who="樱井" mood="开心">「好。」</say>');
  assert.equal(mend('<say who="樱井">「好。</say>'), '<say who="樱井">「好。」</say>', 'never closed');
  assert.equal(mend('<say who="樱井">“好。"</say>'), '<say who="樱井">“好。”</say>');
  assert.equal(mend('<say who="樱井">『好。”</say>'), '<say who="樱井">『好。』</say>');
  assert.equal(mend('<say who="樱井">「好。」</say>他说。'), '<say who="樱井">「好。」</say>他说。', 'a pair already right is left as it is');
  assert.equal(mend('<say who="樱井">「他说“好”</say>'), '<say who="樱井">「他说“好”</say>', 'a quotation inside it is not guessed at');
  assert.equal(mend('「好。"他说。'), '「好。"他说。', 'nothing outside a mark is touched');
  assert.equal(marks.markdownOnly, true, 'the marks are hidden where the floor is drawn');
  assert.equal(marks.promptOnly, false, 'and kept in what the main model reads, so it keeps writing them');
  assert.equal('樱井笑了。<say who="樱井" mood="开心">「好。」</say><saying>留着</saying>'.replace(compileNativeRegex(marks.findRegex), ''), '樱井笑了。「好。」<saying>留着</saying>');
  assert.equal(first[internal.length], unrelated);
  const nativeRule = first.find(rule => rule.jingyi_managed?.profileId === cute.id);
  nativeRule.replaceString = '<p>edited in native manager</p>';
  assert.equal(readNativeRegexEdits(first, cute)[0].replaceString, nativeRule.replaceString);
  const switched = syncNativeRegex(first, fold);
  assert.equal(switched.filter(rule => rule.jingyi_managed?.profileId === cute.id).length, 0);
  assert.deepEqual(syncNativeRegex(switched, null), [unrelated]);
});

test('built-in styles preserve extraction settings and use display-only native rules with a collapsed original', () => {
  let settings = normalizeProcessingSettings({ ...DEFAULT_SETTINGS, bodyTags: ['custom'], excludedTags: ['status'], preserveLineRules: 'prefix:【提示】', floatingStyle: 'edge' });
  for (const id of ['cute', 'minimal', 'fold']) {
    const profile = makeBuiltinReadingProfile(settings, id);
    assert.deepEqual(profile.settings.bodyTags, ['custom']);
    assert.deepEqual(profile.settings.excludedTags, ['status']);
    assert.equal(profile.settings.floatingStyle, 'edge');
    assert.equal(profile.settings.preserveLineRules, 'prefix:【提示】');
    settings.processingProfiles.push(profile);
    settings = selectProcessingProfile(settings, profile.id);
    let display = assembleBilingual(segmentSource('Original.').layout, new Map([[1, '译文。']]), settings);
    assert.equal(stripGeneratedTranslationLines(display), 'Original.');
    for (const rule of syncNativeRegex([], profile)) {
      // Prompt guards never touch the rendered floor; display rules never touch the prompt. The one
      // exception is mending the quotation marks inside a speaker mark, which is done in both.
      if (rule.id.includes(':speech-quote-')) { assert.equal(rule.markdownOnly && rule.promptOnly, true); continue; }
      if (rule.promptOnly) { assert.equal(rule.markdownOnly, false); continue; }
      assert.equal(rule.markdownOnly, true); assert.equal(rule.promptOnly, false);
      display = display.replace(compileNativeRegex(rule.findRegex), rule.replaceString);
    }
    assert.ok(display.includes(`jy-reading-${id}`));
    assert.doesNotMatch(display, /<jy-source>|<jy-translation>|[\u200b\u200c\u2060-\u2064]/);
    assert.ok(display.includes('Original.') && display.includes('译文。'));
    if (id === 'fold') { assert.match(display, /<details class=/); assert.doesNotMatch(display, /<details[^>]*\bopen\b/); }
  }
});

test('a comment in the body is neither translated nor read, and is written back as it was', () => {
  const body = '\n<!-- plotThink:\n[当前张力]: 7/10\n[本轮节奏倾向]: 清晨\n-->\n\n翌朝の空気は澄み切っていた。\n\n「行ってくる」<!-- 小注 -->彼女は頷いた。\n';
  const segmented = segmentSource(body, { paragraphPerLine: true });
  assert.deepEqual(segmented.segments.map(segment => segment.text), ['翌朝の空気は澄み切っていた。', '「行ってくる」彼女は頷いた。']);
  const rendered = assembleBilingual(segmented.layout, new Map([[1, '第二天早上的空气清澈。'], [2, '「我走了。」她点点头。']]), { paragraphPerLine: true });
  assert.ok(rendered.includes('<!-- plotThink:\n[当前张力]: 7/10\n[本轮节奏倾向]: 清晨\n-->'), 'the comment stays whole');
  assert.ok(rendered.includes('<!-- 小注 -->'));
  assert.ok(rendered.includes('第二天早上的空气清澈。'));
  assert.deepEqual(segmentSource('开头的话。<!-- 没写完的注释\n后面都被它盖住', {}).segments.map(segment => segment.text), ['开头的话。'], 'an unclosed comment hides the rest, as on the page');
  assert.doesNotThrow(() => segmentSource('<!-- <think> -->正文。</think>', { excludedTags: ['think'] }), 'a comment across a tag\'s edge is not an error');
});

test('a picture on a line of its own is left as it is, shown once, and the text around it is still translated', () => {
  const picture = '![正文插图](/user/images/unified-statusbar/story-image_2026-09-23@21h59m33s919ms.png)';
  const rebuilt = out => out.layout.map(item => (item.type === 'segment' ? item.sourceText : item.text)).join('');
  for (const text of [`她推开门。\n\n${picture}\n\n他笑了。`, `她推开门。\n${picture}\n他笑了。`, `她推开门。\n${picture}`, `${picture}\n她推开门。`]) {
    const out = segmentSource(text, {});
    assert.equal(out.segments.some(segment => segment.text.includes('![')), false, text);
    assert.equal(rebuilt(out), text, 'written back exactly as it was');
    const written = assembleBilingual(out.layout, new Map(out.segments.map(segment => [segment.id, `译：${segment.text}`])), {});
    assert.equal(written.split(picture).length - 1, 1, 'the picture shows once');
  }
  assert.deepEqual(segmentSource(`<center>${picture}</center>`, {}).segments, [], 'wrapped in a tag');
  assert.deepEqual(segmentSource('[![a](/b.png)](/c.html)', {}).segments, [], 'a linked picture');
  assert.equal(segmentSource(`${picture}她推开门。`, {}).segments.length, 1, 'a picture beside words is still translated');
  assert.equal(segmentSource('[点这里](/a.html)', {}).segments.length, 1, 'a plain link is words');
  assert.equal(segmentSource(String.raw`\![x](y)`, {}).segments.length, 1, 'an escaped picture is words');
});

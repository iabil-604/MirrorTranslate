import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, INVISIBLE_MARKER, MESSAGE_META_KEY, SOURCE_START, MODULE_ID,
  assembleBilingual, segmentSource, stripGeneratedTranslationLines, interceptGenerationChat,
  extractGeneratedTranslations, restyleBilingual, mergeSettings,
} from '../core.js';
import {
  normalizeProcessingSettings, normalizeProcessingProfile, processingSnapshot, getActiveProcessingProfile, makeBuiltinReadingProfile,
  selectProcessingProfile, captureProcessingProfile, exportProcessingProfile, importProcessingProfile,
  importNativeRegex, syncNativeRegex, readNativeRegexEdits, compileNativeRegex, isJingyiRegex, REGEX_OWNER_KEY,
  dedupeManagedRegexScripts, planRegexCleanup, planScopedRegexCleanup, detectBuiltinReadingStyle,
} from '../processing.js';
import { __testing, onDisable } from '../index.js';

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

test('a processing profile carries lyricLineRules and musicCardRules like any other per-profile field', () => {
  const settings = normalizeProcessingSettings({ ...DEFAULT_SETTINGS, lyricLineRules: 'prefix:作词', musicCardRules: true });
  const active = getActiveProcessingProfile(settings);
  assert.equal(active.settings.lyricLineRules, 'prefix:作词');
  assert.equal(active.settings.musicCardRules, true);
  const exported = exportProcessingProfile(active);
  const imported = importProcessingProfile(JSON.parse(JSON.stringify(exported)));
  assert.equal(imported.settings.lyricLineRules, 'prefix:作词');
  assert.equal(imported.settings.musicCardRules, true);
  const bad = { ...exported, profile: { ...exported.profile, settings: { ...exported.profile.settings, lyricLineRules: '/[/' } } };
  assert.throws(() => importProcessingProfile(JSON.parse(JSON.stringify(bad))), /正则无效/);
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
  assert.equal(
    mend('<say who="樱井" mood="开心">「<big><b>好。</b></big>"</say>'),
    '<say who="樱井" mood="开心">「<big><b>好。</b></big>」</say>',
    'a preset that already painted the line keeps the tags between the quotes from blocking the mend',
  );
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

// 微调's 内置美化 picker used to always show 可爱风 and could not be told to reselect the style already
// active (review finding index.js:11796/491) — detectBuiltinReadingStyle is the reverse lookup that
// fixes both.
test('detectBuiltinReadingStyle recognises each built-in style makeBuiltinReadingProfile produced, and nothing else', () => {
  const settings = normalizeProcessingSettings();
  for (const id of ['cute', 'minimal', 'fold']) {
    assert.equal(detectBuiltinReadingStyle(makeBuiltinReadingProfile(settings, id)), id);
  }
  assert.equal(detectBuiltinReadingStyle(getActiveProcessingProfile(settings)), null, 'the plain 默认 profile matches none of them');
  assert.equal(detectBuiltinReadingStyle(null), null);
  assert.equal(detectBuiltinReadingStyle(undefined), null);
  // A profile with the right prefixes but a hand-edited rule (or none at all) is not mistaken for a
  // style the reader never actually chose from the picker.
  const renamed = makeBuiltinReadingProfile(settings, 'cute');
  renamed.regexScripts[0].replaceString = renamed.regexScripts[0].replaceString.replace('jy-reading-cute', 'jy-reading-cute-mine');
  assert.equal(detectBuiltinReadingStyle(renamed), null);
  const noRule = makeBuiltinReadingProfile(settings, 'cute');
  noRule.regexScripts = [];
  assert.equal(detectBuiltinReadingStyle(noRule), null);
  // Prefixes alone, without the matching rule, are not enough either (a hand-made profile that
  // happens to reuse the same segment markers for its own purposes).
  const active = getActiveProcessingProfile(settings);
  const prefixOnly = {
    ...active,
    settings: { ...active.settings, segmentPrefix: '<jy-source>', segmentSuffix: '</jy-source>', translationPrefix: '<jy-translation>', translationSuffix: '</jy-translation>' },
    regexScripts: [],
  };
  assert.equal(detectBuiltinReadingStyle(prefixOnly), null);
});

test('the built-in beautify never wraps a source block whose own block tags are not balanced', () => {
  const settings = normalizeProcessingSettings();
  const profile = makeBuiltinReadingProfile(settings, 'cute');
  const rule = profile.regexScripts[0];
  const wrap = source => `<jy-source>${source}</jy-source>\n<jy-translation>译文</jy-translation>`
    .replace(compileNativeRegex(rule.findRegex), rule.replaceString);
  const untouched = source => {
    const raw = `<jy-source>${source}</jy-source>\n<jy-translation>译文</jy-translation>`;
    return raw.replace(compileNativeRegex(rule.findRegex), rule.replaceString) === raw;
  };
  assert.match(wrap('一段<div>卡片</div>文字'), /jy-reading-source/, 'flat, balanced div still gets the beautify shell');
  assert.match(wrap('一段<b>加粗</b>文字'), /jy-reading-source/, 'inline tags are not what this guard is about');
  assert.match(wrap('一段<DIV>大写标签</DIV>文字'), /jy-reading-source/, 'a tag name in any case is still recognised');
  assert.ok(untouched('一段<div>卡片文字'), 'an unclosed <div> is left exactly as it was, not nested inside the shell\'s own');
  assert.ok(untouched('一段</div>卡片文字'), 'a stray closing </div> with no open is left alone the same way');
  assert.ok(untouched('<details><summary>Status panel</summary>\nPlace: Old Library'), 'an unclosed <details> is caught too, not just div/p');
  assert.ok(untouched('<section>Place: Old Library'), 'as is an unclosed <section>');
  assert.ok(untouched('<ul><li>one'), 'and an unclosed <ul>');
  // Nesting up to three deep is now recognised and still wrapped, tag for same-named tag.
  assert.match(wrap('一段<div><div>卡片</div>文字</div>更多'), /jy-reading-source/, 'two levels of nesting');
  assert.match(wrap('一段<div><div><div>卡片</div>文字</div>更多</div>末尾'), /jy-reading-source/, 'three levels of nesting');
  assert.match(wrap('<div class="row"><div class="k">Place</div><div class="v">Old Library</div></div>'), /jy-reading-source/, 'a one-line nested status card');
  assert.match(wrap('<details><summary>Status panel</summary>\nPlace: Old Library\n\nHour: Late night\n</details>'), /jy-reading-source/, 'a balanced <details> card');
  // Four levels deep is past the limit: conservatively left alone, the same as an unbalanced block.
  assert.ok(untouched('一段<div><div><div><div>卡片</div>文字</div>更多</div>末尾</div>结束'), 'nesting past the depth limit is left alone too, never wrapped mismatched');
});

test('an existing profile\'s saved built-in beautify rule picks up the balanced-tag guard, but only when untouched', () => {
  // What a profile saved before v0.36.1 carries: the old, unguarded findRegex, and one of the three
  // built-in styles' own replaceString, exactly as makeBuiltinReadingProfile used to write it.
  const legacyFindRegex = '/<jy-source>([\\s\\S]*?)<\\/jy-source>\\n<jy-translation>([\\s\\S]*?)<\\/jy-translation>/g';
  const fresh = makeBuiltinReadingProfile(normalizeProcessingSettings(), 'cute').regexScripts[0];
  // The template as it was saved then: its two groups read by number.
  const cuteReplace = fresh.replaceString.replace('$<jySource>', '$1').replace('$<jyTranslation>', '$2');
  const saved = normalizeProcessingProfile({
    name: '可爱风',
    settings: processingSnapshot(normalizeProcessingSettings()),
    regexScripts: [{ id: 'r1', scriptName: '可爱风', findRegex: legacyFindRegex, replaceString: cuteReplace, placement: [2] }],
  });
  assert.equal(saved.regexScripts[0].findRegex, fresh.findRegex, 'the saved rule is upgraded to the new, guarded pattern');
  assert.equal(saved.regexScripts[0].replaceString, fresh.replaceString, 'and its template with it, since the new pattern numbers its groups differently');
  const rawFor = source => `<jy-source>${source}</jy-source>\n<jy-translation>译文</jy-translation>`;
  const wrap = source => rawFor(source).replace(compileNativeRegex(saved.regexScripts[0].findRegex), saved.regexScripts[0].replaceString);
  assert.match(wrap('一段<div>卡片</div>文字'), /jy-reading-source">\n\n一段<div>卡片<\/div>文字\n\n[\s\S]*jy-reading-translation">\n\n译文\n\n/, 'a balanced div is still wrapped after the migration, source and translation each in its place');
  assert.equal(wrap('一段<div>卡片文字'), rawFor('一段<div>卡片文字'), 'the migrated rule guards against an unbalanced tag exactly like a freshly made one');
  // A rule with the legacy findRegex but a replaceString the reader changed is left exactly as saved.
  const edited = normalizeProcessingProfile({
    name: '自定义',
    settings: processingSnapshot(normalizeProcessingSettings()),
    regexScripts: [{ id: 'r1', scriptName: '自定义', findRegex: legacyFindRegex, replaceString: '$1 / $2', placement: [2] }],
  });
  assert.equal(edited.regexScripts[0].findRegex, legacyFindRegex, 'a replaceString the reader wrote themselves means the rule is theirs, not migrated');
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

// SillyTavern's own regex editor (extensions/regex/index.js), opened on an existing rule and saved
// with nothing changed, rebuilds a whole new object from the form fields and replaces the array entry
// with it outright (saveRegexScript: array[existingScriptIndex] = regexScript); the new object only
// carries fields the editor's own form knows about, so jingyi_managed is gone, wholesale. The id
// survives, since the editor keeps the same existingId for a script it already knows. The fixtures
// below replay exactly that replacement, with the same field set the editor actually builds -- minDepth/
// maxDepth included: the editor fills the field with `existingScript.minDepth ?? ''` (SillyTavern
// 1.18.0, extensions/regex/index.js:788-789) and reads it back with `parseInt(String(...))` on Save
// (index.js:866-867), so a null depth -- every fixed and profile-bound rule 镜译 writes -- round-trips
// as parseInt('') = NaN, never null, whether or not the reader actually touched that field.
function simulateNativeEditorSave(script) {
  return {
    id: script.id, scriptName: script.scriptName, findRegex: script.findRegex, replaceString: script.replaceString,
    trimStrings: script.trimStrings ?? [], placement: script.placement ?? [], disabled: script.disabled ?? false,
    markdownOnly: script.markdownOnly ?? false, promptOnly: script.promptOnly ?? false, runOnEdit: script.runOnEdit ?? false,
    substituteRegex: script.substituteRegex ?? 0,
    minDepth: parseInt(String(script.minDepth ?? '')),
    maxDepth: parseInt(String(script.maxDepth ?? '')),
  };
}

test('a rule that lost its marker exactly the way 酒馆\'s own editor strips it is still recognised by id, so the next sync mends it instead of installing a second copy', () => {
  const settings = normalizeProcessingSettings();
  const profile = makeBuiltinReadingProfile(settings, 'cute');
  let list = syncNativeRegex([], profile);
  const nameFor = () => `镜译 · ${profile.name} · ${profile.regexScripts[0].scriptName}`;
  const index = list.findIndex(rule => rule.scriptName === nameFor());
  assert.ok(index >= 0);

  // The reader opens that rule in 酒馆's editor, changes nothing, clicks Save.
  const stripped = simulateNativeEditorSave(list[index]);
  assert.equal(Object.hasOwn(stripped, 'jingyi_managed'), false, 'the marker is gone, exactly as the host leaves it');
  assert.equal(isJingyiRegex(stripped), true, 'but the id 镜译 minted for it is still there, and is enough on its own');
  list = [...list.slice(0, index), stripped, ...list.slice(index + 1)];

  // Any later 镜译 sync (a settings save, a chat change, a profile switch) must mend it in place, not
  // duplicate it: before the fix this left the stripped copy behind, unrecognised, and installed a
  // second one beside it.
  list = syncNativeRegex(list, profile);
  assert.equal(list.filter(rule => rule.scriptName === nameFor()).length, 1, 'still exactly one copy');
  const mended = list.find(rule => rule.scriptName === nameFor());
  assert.equal(mended.jingyi_managed?.owner, 'jingyi-translator', 'the marker is restored');

  // Uninstalling now removes it cleanly too -- nothing orphaned is left behind for a host disable/clean
  // sweep to miss.
  assert.deepEqual(syncNativeRegex(list, null), []);
});

test('six "open in 酒馆\'s editor, click Save with nothing changed" cycles reproduce the reported six-fold duplicate, and the fix collapses them back to one', () => {
  const settings = normalizeProcessingSettings();
  const profile = makeBuiltinReadingProfile(settings, 'cute');
  const nameFor = () => `镜译 · ${profile.name} · ${profile.regexScripts[0].scriptName}`;
  let list = syncNativeRegex([], profile);

  // Six edit-and-save cycles in 酒馆's own regex panel, exactly as a reader idly checking what a rule
  // does would produce -- the report's own count.
  for (let i = 0; i < 6; i++) {
    const index = list.findIndex(rule => rule.scriptName === nameFor() && isJingyiRegex(rule));
    list[index] = simulateNativeEditorSave(list[index]);
    list = syncNativeRegex(list, profile);
  }
  assert.equal(list.filter(rule => rule.scriptName === nameFor()).length, 1,
    'the fix keeps this at one throughout, unlike the pre-fix code this reproduces against (see the investigation notes)');

  // Simulate the same six cycles against the OLD, marker-only ownership rule to document what the
  // reader actually saw: this is the regression the id-based recognition above closes.
  const legacyIsOwned = rule => rule?.jingyi_managed?.owner === 'jingyi-translator';
  function legacySync(existing, activeProfile) {
    const originals = Array.isArray(existing) ? existing : [];
    const managed = activeProfile ? activeProfile.regexScripts.map(rule => ({
      ...structuredClone(rule), id: `jingyi-translator:${activeProfile.id}:${rule.id}`,
      scriptName: `镜译 · ${activeProfile.name} · ${rule.scriptName}`,
      jingyi_managed: { owner: 'jingyi-translator', profileId: activeProfile.id, ruleId: rule.id },
    })) : [];
    const kept = originals.filter(rule => !legacyIsOwned(rule));
    kept.push(...managed);
    return kept;
  }
  let legacyList = legacySync([], profile);
  for (let i = 0; i < 6; i++) {
    const index = legacyList.findIndex(rule => rule.scriptName === nameFor() && legacyIsOwned(rule));
    legacyList[index] = simulateNativeEditorSave(legacyList[index]);
    legacyList = legacySync(legacyList, profile);
  }
  assert.equal(legacyList.filter(rule => rule.scriptName === nameFor()).length, 7, 'six orphans plus one live copy: the bug as reported');
});

test('an edit made in 酒馆\'s own editor is still read back into the profile even after that same save wiped the marker', () => {
  const settings = normalizeProcessingSettings();
  const profile = makeBuiltinReadingProfile(settings, 'cute');
  let list = syncNativeRegex([], profile);
  const index = list.findIndex(rule => isJingyiRegex(rule) && !rule.jingyi_managed?.internal);
  const edited = simulateNativeEditorSave({ ...list[index], replaceString: '<p>改过，编辑器保存时标记也丢了</p>' });
  list = [...list.slice(0, index), edited, ...list.slice(index + 1)];
  const edits = readNativeRegexEdits(list, profile);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].replaceString, '<p>改过，编辑器保存时标记也丢了</p>');
});

test('isJingyiRegex never matches a rule that is not 镜译\'s own, even one with a similar name or stray fields', () => {
  assert.equal(isJingyiRegex({ id: 'user-rule-1', scriptName: '镜译 · 可爱风 · 可爱风', findRegex: 'x', replaceString: 'y' }), false,
    'a user\'s own rule that merely happens to share the name is left alone');
  assert.equal(isJingyiRegex({ id: 'some-other-extensions-id', scriptName: '随便什么', jingyi_managed: 'not an object' }), false);
  assert.equal(isJingyiRegex({ id: 'jingyi-translator-but-not-quite:abc', scriptName: '不是我们的' }), false,
    'the prefix must be followed by the separator colon, not just start with the same letters');
  assert.equal(isJingyiRegex(null), false);
  assert.equal(isJingyiRegex(undefined), false);
});

test('a reader upgrading straight out of the bug, whose native list already holds six stale orphans plus the one live copy, is healed on the very first sync -- readNativeRegexEdits does not fold the stale duplicates into the profile as if they were distinct rules', () => {
  const settings = normalizeProcessingSettings();
  const profile = makeBuiltinReadingProfile(settings, 'cute');
  const nameFor = () => `镜译 · ${profile.name} · ${profile.regexScripts[0].scriptName}`;

  // Build up exactly the polluted list a reader who has been on the old, unfixed build for a while
  // already has sitting in their extension_settings.regex, using the OLD marker-only sync so the
  // fixture does not depend on the very code under test.
  const legacyIsOwned = rule => rule?.jingyi_managed?.owner === MODULE_ID;
  function legacySync(existing, activeProfile) {
    const originals = Array.isArray(existing) ? existing : [];
    const managed = activeProfile ? activeProfile.regexScripts.map(rule => ({
      ...structuredClone(rule), id: `${MODULE_ID}:${activeProfile.id}:${rule.id}`,
      scriptName: `镜译 · ${activeProfile.name} · ${rule.scriptName}`,
      jingyi_managed: { owner: MODULE_ID, profileId: activeProfile.id, ruleId: rule.id },
    })) : [];
    const kept = originals.filter(rule => !legacyIsOwned(rule));
    kept.push(...managed);
    return kept;
  }
  let stale = legacySync([], profile);
  for (let i = 0; i < 6; i++) {
    const index = stale.findIndex(rule => rule.scriptName === nameFor() && legacyIsOwned(rule));
    stale[index] = simulateNativeEditorSave(stale[index]);
    stale = legacySync(stale, profile);
  }
  assert.equal(stale.filter(rule => rule.scriptName === nameFor()).length, 7, 'the fixture reproduces the reported pollution');

  // This is what index.js' initializeSettings actually does on load: read back any native edits first,
  // and only then sync. All seven stale copies decode to the very same profileId/ruleId pair (the id
  // 镜译 mints is deterministic), so without dedup this would hand the profile seven "edits" for what
  // is really one rule -- baking the duplication permanently into 镜译's own saved data, which no later
  // sync could ever clean up again (syncNativeRegex would keep regenerating one native copy per profile
  // entry, forever).
  const nativeEdits = readNativeRegexEdits(stale, profile);
  assert.equal(nativeEdits.length, 1, 'seven native copies of one rule read back as exactly one edit, not seven');
  const healedProfile = { ...profile, regexScripts: nativeEdits };
  const firstSync = syncNativeRegex(stale, healedProfile);
  assert.equal(firstSync.filter(rule => rule.scriptName === nameFor()).length, 1, 'healed on the very first sync after upgrading');
  const secondSync = syncNativeRegex(firstSync, healedProfile);
  assert.equal(secondSync.filter(rule => rule.scriptName === nameFor()).length, 1, 'stays healed -- idempotent');
});

test('sync collapses a list mixing 镜译 duplicates, a rule from a since-deleted profile, a disabled duplicate, a reader\'s own rule with a look-alike name, and another extension\'s rule -- touching only what is certainly 镜译\'s own, and settles idempotently', () => {
  const settings = normalizeProcessingSettings();
  const profile = makeBuiltinReadingProfile(settings, 'cute');
  const ruleId = profile.regexScripts[0].id;
  const ourName = `镜译 · ${profile.name} · ${profile.regexScripts[0].scriptName}`;
  const shared = {
    findRegex: profile.regexScripts[0].findRegex, replaceString: profile.regexScripts[0].replaceString,
    trimStrings: [], placement: [2], markdownOnly: true, promptOnly: false, runOnEdit: true,
    substituteRegex: 0, minDepth: null, maxDepth: null,
  };

  // Two duplicate copies of the same managed rule, as the marker-loss bug leaves behind: one still
  // enabled, one the reader happened to disable directly in 酒馆's own panel.
  const dup1 = { ...shared, id: `${MODULE_ID}:${profile.id}:${ruleId}`, scriptName: ourName, disabled: false };
  const dup2 = { ...shared, id: `${MODULE_ID}:${profile.id}:${ruleId}`, scriptName: ourName, disabled: true };

  // A rule 镜译 made for a processing profile the reader has since deleted: the marker is intact, so
  // it is unambiguously ours, but no profile with that id exists in this settings object any more.
  const orphanedProfileRule = {
    ...shared, id: `${MODULE_ID}:profile-that-no-longer-exists:some-rule`, scriptName: '镜译 · 已删除的方案 · 旧规则', disabled: false,
    [REGEX_OWNER_KEY]: { owner: MODULE_ID, profileId: 'profile-that-no-longer-exists', ruleId: 'some-rule' },
  };

  // The reader's own rule, named so it merely looks like ours -- no marker, no 镜译 id prefix.
  const lookalike = { ...shared, id: 'user-own-rule-42', scriptName: ourName, findRegex: '/自己写的/g', disabled: false };

  // Another extension's own rule, unrelated in every way.
  const foreign = { ...shared, id: 'some-other-extension:abc', scriptName: '别的扩展的规则', findRegex: '/z/g', disabled: false };

  const mixed = [foreign, lookalike, dup1, orphanedProfileRule, dup2];
  const cleaned = syncNativeRegex(mixed, profile);

  // Filtered by isJingyiRegex, not just by name: the look-alike below shares this exact scriptName on
  // purpose, and must not be counted as one of 镜译's own copies.
  assert.equal(cleaned.filter(rule => rule.scriptName === ourName && isJingyiRegex(rule)).length, 1, 'the duplicate managed copies collapse to one');
  assert.equal(cleaned.some(rule => rule.id === orphanedProfileRule.id), false, 'the deleted profile\'s rule is gone -- nothing asks for it any more');
  assert.deepEqual(cleaned.find(rule => rule.id === 'user-own-rule-42'), lookalike, 'the look-alike user rule is untouched, byte for byte');
  assert.deepEqual(cleaned.find(rule => rule.id === 'some-other-extension:abc'), foreign, 'the other extension\'s rule is untouched, byte for byte');
  // Order: the foreign rules keep their relative order, and the one surviving managed copy lands where
  // the first duplicate it replaced was, among them -- not shoved to the very end of the list.
  const order = cleaned.map(rule => rule.id).filter(id => ['some-other-extension:abc', 'user-own-rule-42', dup1.id].includes(id));
  assert.deepEqual(order, ['some-other-extension:abc', 'user-own-rule-42', dup1.id]);

  const again = syncNativeRegex(cleaned, profile);
  assert.deepEqual(again, cleaned, 'idempotent: syncing an already-clean list changes nothing further');
});

test('a native copy that fails our own validation outright -- every "Affects" checkbox unchecked, exactly what 酒馆 itself only warns about and saves anyway -- falls back to the profile\'s already-saved version of just that one rule, instead of losing every other valid edit alongside it', () => {
  const settings = normalizeProcessingSettings();
  const active = getActiveProcessingProfile(settings);
  active.regexScripts = importNativeRegex([
    { scriptName: '第一条', findRegex: '/one/g', replaceString: '一', placement: [2] },
    { scriptName: '第二条', findRegex: '/two/g', replaceString: '二', placement: [2] },
  ]);
  const [ruleOneId, ruleTwoId] = active.regexScripts.map(rule => rule.id);
  let list = syncNativeRegex([], active);

  // The reader genuinely edits the first rule in 酒馆's own editor...
  const i1 = list.findIndex(rule => rule.scriptName === `镜译 · ${active.name} · 第一条`);
  list[i1] = simulateNativeEditorSave({ ...list[i1], replaceString: '壹' });
  // ...and on the second, unchecks every "Affects" box and saves anyway.
  const i2 = list.findIndex(rule => rule.scriptName === `镜译 · ${active.name} · 第二条`);
  list[i2] = simulateNativeEditorSave({ ...list[i2], placement: [] });

  const edits = readNativeRegexEdits(list, active);
  assert.equal(edits.length, 2, 'both rules still come back -- the broken one is not simply dropped, and does not take the whole read down with it');
  assert.equal(edits.find(rule => rule.id === ruleOneId).replaceString, '壹', 'the valid edit on the other rule survives alongside the broken one');
  assert.deepEqual(edits.find(rule => rule.id === ruleTwoId), active.regexScripts[1], 'the broken copy falls back to the profile\'s own already-saved version of that rule');
});

test('initializeSettings and onDisable do not crash on the copy 酒馆\'s own editor leaves after any "open the rule, click Save" -- even with nothing changed at all, since every fixed and profile-bound rule ships with blank depth fields', () => {
  const previousHost = globalThis.SillyTavern;
  try {
    const settings = normalizeProcessingSettings();
    const profile = makeBuiltinReadingProfile(settings, 'cute');
    settings.processingProfiles = [profile];
    settings.selectedProcessingProfileId = profile.id;
    const list = syncNativeRegex([], profile);
    const index = list.findIndex(rule => rule.scriptName === `镜译 · ${profile.name} · ${profile.regexScripts[0].scriptName}`);
    list[index] = simulateNativeEditorSave(list[index]); // opened, nothing touched, saved
    const context = { extensionSettings: { [MODULE_ID]: settings, regex: list }, saveSettingsDebounced: () => {} };
    globalThis.SillyTavern = { getContext: () => context };
    assert.doesNotThrow(() => __testing.initializeSettings(), '整个扩展不因为一条原生规则读不回来就起不来');
    assert.doesNotThrow(() => onDisable());
  } finally {
    globalThis.SillyTavern = previousHost;
    __testing.configureForTest({ initialized: false });
  }
});

test('readNativeRegexEdits prefers a reader\'s real edit over a merely-regenerated marked copy of the same rule, and only falls back to the marked copy when the two actually agree', () => {
  const settings = normalizeProcessingSettings();
  const profile = makeBuiltinReadingProfile(settings, 'cute');
  const list = syncNativeRegex([], profile);
  const ruleName = `镜译 · ${profile.name} · ${profile.regexScripts[0].scriptName}`;
  const index = list.findIndex(rule => rule.scriptName === ruleName);

  // The old marker-loss bug's own aftermath: the reader's real edit sits in an unmarked copy (酒馆's
  // editor stripped its marker on Save), alongside a stale, still-marked copy the old code kept
  // regenerating from the profile's untouched original.
  const edited = simulateNativeEditorSave({ ...list[index], replaceString: '<p>读者真的改过</p>' });
  const stale = { ...list[index] };
  const mixed = [...list.slice(0, index), edited, stale, ...list.slice(index + 1)];

  const edits = readNativeRegexEdits(mixed, profile);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].replaceString, '<p>读者真的改过</p>', 'the reader\'s real edit wins over the stale marked copy, not the other way around');
});

test('dedupeManagedRegexScripts collapses a profile\'s own regexScripts back to one entry per distinct rule regardless of id -- the state a batch export-then-reimport used to bake permanently into the profile, before native edits were ever read back by id', () => {
  const settings = normalizeProcessingSettings();
  const active = getActiveProcessingProfile(settings);
  const base = { scriptName: '可爱风', findRegex: '/x/g', replaceString: 'y', placement: [2] };
  // 酒馆's own import always mints a fresh id (extensions/regex/index.js:1506), regardless of what the
  // exported JSON's id was -- so N re-imports of the very same exported rule leave N differently-id'd,
  // but otherwise identical, entries sitting in the profile's own regexScripts.
  active.regexScripts = importNativeRegex([base, base, base]);
  assert.equal(active.regexScripts.length, 3);
  assert.notEqual(active.regexScripts[0].id, active.regexScripts[1].id);

  const deduped = dedupeManagedRegexScripts(active.regexScripts);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].id, active.regexScripts[0].id, 'order-preserving: the first copy survives');
});

test('planRegexCleanup counts removal and installation separately, so an equal number of each never nets to a false "nothing to clean" and a reader who deleted more fixed rules than there are surplus copies never sees a negative count', () => {
  const settings = normalizeProcessingSettings();
  const profile = makeBuiltinReadingProfile(settings, 'cute');
  const full = syncNativeRegex([], profile);
  const ruleName = `镜译 · ${profile.name} · ${profile.regexScripts[0].scriptName}`;
  const ruleCopy = full.find(rule => rule.scriptName === ruleName);
  // The reader has deleted two of the fixed rules directly in 酒馆's own panel (its own findIndex(id)
  // picks the first match, so this really does remove the one live copy), and a surplus copy of the
  // profile's own bound rule sits alongside the rest.
  const withoutTwoFixed = full.filter(rule => !([`${MODULE_ID}:prompt-affix`, `${MODULE_ID}:prompt-boundaries`].includes(rule.id)));
  const polluted = [...withoutTwoFixed, { ...ruleCopy }];

  const { expected, toRemove, toInstall } = planRegexCleanup(polluted, profile);
  assert.equal(toRemove, 1, 'the one surplus copy');
  assert.equal(toInstall, 2, 'the two deleted fixed rules');
  assert.equal(expected.length, full.length);

  const oldNetDiff = polluted.filter(isJingyiRegex).length - syncNativeRegex(polluted, profile).filter(isJingyiRegex).length;
  assert.equal(oldNetDiff, -1, 'the before-minus-after arithmetic this replaces would have shown a negative count here');
});

test('a re-imported copy of a bound rule -- 酒馆 mints it a fresh id but leaves the marker\'s profileId/ruleId untouched -- becomes its own new rule in the profile when its content actually differs, instead of silently vanishing', () => {
  const settings = normalizeProcessingSettings();
  const profile = makeBuiltinReadingProfile(settings, 'cute');
  const list = syncNativeRegex([], profile);
  const ruleName = `镜译 · ${profile.name} · ${profile.regexScripts[0].scriptName}`;
  const original = list.find(rule => rule.scriptName === ruleName);
  // The reader exports this rule, hand-edits the exported JSON's colours, and re-imports it: 酒馆's own
  // import (extensions/regex/index.js:1506) assigns a fresh id, but every other field -- the marker
  // included -- survives untouched.
  const variant = { ...original, id: 'reimported-uuid-1234', replaceString: '<p style="color:blue">改过配色</p>' };
  const withVariant = [...list, variant];

  const edits = readNativeRegexEdits(withVariant, profile);
  assert.equal(edits.length, 2, 'the original rule and the reader\'s variant both survive');
  const variantEdit = edits.find(rule => rule.replaceString === '<p style="color:blue">改过配色</p>');
  assert.ok(variantEdit, 'the variant\'s content made it through');
  const originalEdit = edits.find(rule => rule !== variantEdit);
  assert.notEqual(variantEdit.id, originalEdit.id, 'minted as a genuinely new rule, not merged into the original\'s slot');

  // Re-importing the exact same variant a second time collapses back to one copy of it, same as any
  // other content-identical duplicate.
  const edits2 = readNativeRegexEdits([...withVariant, { ...variant, id: 'reimported-uuid-5678' }], profile);
  assert.equal(edits2.length, 2, 'two copies of the same variant still count as one');
});

test('saveSettings reads a reader\'s still-pending native-editor edit into the active profile when this particular save was never going to touch regexScripts itself, but never overwrites a save that changed regexScripts on purpose', () => {
  const previousHost = globalThis.SillyTavern;
  try {
    const settings = normalizeProcessingSettings();
    const profile = makeBuiltinReadingProfile(settings, 'cute');
    settings.processingProfiles = [profile];
    settings.selectedProcessingProfileId = profile.id;
    const context = { extensionSettings: { [MODULE_ID]: settings, regex: [] }, saveSettingsDebounced: () => {} };
    globalThis.SillyTavern = { getContext: () => context };

    __testing.configureForTest({ initialized: false });
    __testing.initializeSettings();
    const ruleName = `镜译 · ${profile.name} · ${profile.regexScripts[0].scriptName}`;
    const index = context.extensionSettings.regex.findIndex(rule => rule.scriptName === ruleName);
    assert.ok(index >= 0);
    context.extensionSettings.regex[index] = simulateNativeEditorSave({ ...context.extensionSettings.regex[index], replaceString: '<p>读者在酒馆里改的样式</p>' });

    // An unrelated save -- a floating-window toggle, a theme switch -- built from the settings exactly as
    // they already stand: it never meant to touch regexScripts at all.
    const before = __testing.configureForTest({});
    __testing.saveSettings({ ...before, showFloatingButton: !before.showFloatingButton });
    const afterIncidental = __testing.configureForTest({});
    const activeAfterIncidental = afterIncidental.processingProfiles.find(item => item.id === afterIncidental.selectedProcessingProfileId);
    assert.equal(activeAfterIncidental.regexScripts[0].replaceString, '<p>读者在酒馆里改的样式</p>',
      'an incidental save picks up the reader\'s pending native edit instead of clobbering it with the old content');

    // A save that DID deliberately change regexScripts (removing a bound rule, the dedupe button, an
    // import) must not be undone by a stray readback of the native list, which has not been resynced yet.
    const current = __testing.configureForTest({});
    const active = current.processingProfiles.find(item => item.id === current.selectedProcessingProfileId);
    const deliberate = { ...active, regexScripts: [] };
    __testing.saveSettings({ ...current, processingProfiles: current.processingProfiles.map(item => (item.id === deliberate.id ? deliberate : item)) });
    const afterDeliberate = __testing.configureForTest({});
    const activeAfterDeliberate = afterDeliberate.processingProfiles.find(item => item.id === afterDeliberate.selectedProcessingProfileId);
    assert.equal(activeAfterDeliberate.regexScripts.length, 0, 'a deliberate regexScripts change is never silently reverted by the readback');
  } finally {
    globalThis.SillyTavern = previousHost;
    __testing.configureForTest({ initialized: false });
  }
});

test('planScopedRegexCleanup removes only rules isJingyiRegex claims from a character-scoped or preset regex list, keeping the reader\'s own rules and their order untouched', () => {
  const settings = normalizeProcessingSettings();
  const profile = makeBuiltinReadingProfile(settings, 'cute');
  const full = syncNativeRegex([], profile);
  // A rule 酒馆's own "移到角色 / 预设" carried out of the global list -- 镜译 never installed it here on
  // purpose, but it is still unmistakably 镜译's own by id prefix.
  const movedBoundRule = { ...full.find(rule => rule.scriptName === `镜译 · ${profile.name} · ${profile.regexScripts[0].scriptName}`) };
  const readerA = { id: 'user-a', scriptName: '读者规则甲', findRegex: '/a/g', replaceString: '' };
  const readerB = { id: 'user-b', scriptName: '读者规则乙', findRegex: '/b/g', replaceString: '' };

  const { kept, toRemove } = planScopedRegexCleanup([readerA, movedBoundRule, readerB]);
  assert.equal(toRemove, 1);
  assert.deepEqual(kept, [readerA, readerB], 'only the 镜译-owned copy is removed; the reader\'s own rules and their relative order survive');
});

test('planScopedRegexCleanup treats a missing or already-clean list as nothing to remove', () => {
  assert.deepEqual(planScopedRegexCleanup(undefined), { kept: [], toRemove: 0 });
  assert.deepEqual(planScopedRegexCleanup([]), { kept: [], toRemove: 0 });
  const readerOnly = [{ id: 'user-a', scriptName: '读者规则', findRegex: '/a/g', replaceString: '' }];
  assert.deepEqual(planScopedRegexCleanup(readerOnly), { kept: readerOnly, toRemove: 0 });
});

test('buildRegexCleanupPlan folds a character-scoped and a preset regex cleanup into the same plan as the global one, reporting how many are removed from each scope', () => {
  const settings = normalizeProcessingSettings();
  const profile = makeBuiltinReadingProfile(settings, 'cute');
  settings.processingProfiles = [profile];
  settings.selectedProcessingProfileId = profile.id;
  const full = syncNativeRegex([], profile); // nothing missing or surplus globally
  const movedBoundRule = { ...full.find(rule => rule.scriptName === `镜译 · ${profile.name} · ${profile.regexScripts[0].scriptName}`) };
  const movedFixedA = { ...full.find(rule => rule.id === `${MODULE_ID}:prompt-affix`) };
  const movedFixedB = { ...full.find(rule => rule.id === `${MODULE_ID}:prompt-boundaries`) };
  const readerScoped = { id: 'user-scoped', scriptName: '角色自己的规则', findRegex: '/z/g', replaceString: '' };

  const engine = {
    SCRIPT_TYPES: { GLOBAL: 0, SCOPED: 1, PRESET: 2 },
    getScriptsByType(type) {
      if (type === 1) return [readerScoped, movedBoundRule];
      if (type === 2) return [movedFixedA, movedFixedB];
      return [];
    },
  };

  const plan = __testing.buildRegexCleanupPlan({ next: settings, currentRegex: full, engine });
  assert.ok(plan, '两个额外范围各有一条需要清理，加上没有任何全局缺口，整体仍然算有事可做');
  assert.equal(plan.toRemove, 0, '全局本身没有多余或缺失');
  assert.equal(plan.toInstall, 0);
  assert.equal(plan.scopedRemove, 1);
  assert.equal(plan.presetRemove, 2);
  assert.equal(plan.totalRemove, 3);
  assert.deepEqual(plan.scopedPlan.kept, [readerScoped], '角色自己的规则不受影响');
  assert.equal(plan.presetPlan.kept.length, 0);
  assert.match(plan.message, /全局 0 条/);
  assert.match(plan.message, /角色绑定 1 条/);
  assert.match(plan.message, /预设绑定 2 条/);
});

test('buildRegexCleanupPlan skips a scope the host cannot give an answer for -- no engine at all, or one scope throwing (no character selected) -- without blocking the other scopes or the global cleanup', () => {
  const settings = normalizeProcessingSettings();
  const profile = makeBuiltinReadingProfile(settings, 'cute');
  settings.processingProfiles = [profile];
  settings.selectedProcessingProfileId = profile.id;
  const full = syncNativeRegex([], profile);
  const ruleName = `镜译 · ${profile.name} · ${profile.regexScripts[0].scriptName}`;
  const ruleCopy = full.find(rule => rule.scriptName === ruleName);
  // A surplus global copy, exactly like the plain planRegexCleanup case, so there is still something
  // for the button to report even with every extra scope unavailable.
  const polluted = [...full, { ...ruleCopy }];

  const planNoEngine = __testing.buildRegexCleanupPlan({ next: settings, currentRegex: polluted, engine: null });
  assert.ok(planNoEngine);
  assert.equal(planNoEngine.toRemove, 1);
  assert.equal(planNoEngine.scopedPlan, null);
  assert.equal(planNoEngine.presetPlan, null);
  assert.equal(planNoEngine.totalRemove, 1);
  assert.doesNotMatch(planNoEngine.message, /角色绑定|预设绑定/, '没有引擎时，弹窗文案和改动前完全一样，不提额外范围');
  assert.match(planNoEngine.message, /^删除 1 条多余的镜译正则/);

  const movedFixed = { ...full.find(rule => rule.id === `${MODULE_ID}:prompt-affix`) };
  const engineScopedUnavailable = {
    SCRIPT_TYPES: { GLOBAL: 0, SCOPED: 1, PRESET: 2 },
    getScriptsByType(type) {
      if (type === 1) throw new Error('没有选中角色'); // 旧宿主 / 未选中角色时的真实行为之一
      if (type === 2) return [movedFixed];
      return [];
    },
  };
  const planPartial = __testing.buildRegexCleanupPlan({ next: settings, currentRegex: polluted, engine: engineScopedUnavailable });
  assert.ok(planPartial);
  assert.equal(planPartial.scopedPlan, null, '读不到的范围被静默跳过，不算作错误');
  assert.equal(planPartial.presetPlan.toRemove, 1);
  assert.equal(planPartial.toRemove, 1, '全局清理不受角色范围失败影响');
  assert.equal(planPartial.totalRemove, 2);
  assert.match(planPartial.message, /预设绑定 1 条/);
  assert.doesNotMatch(planPartial.message, /角色绑定/);
});

test('buildRegexCleanupPlan reports nothing to do when every scope the engine can see is already clean', () => {
  const settings = normalizeProcessingSettings();
  const profile = makeBuiltinReadingProfile(settings, 'cute');
  settings.processingProfiles = [profile];
  settings.selectedProcessingProfileId = profile.id;
  const full = syncNativeRegex([], profile);
  const engine = { SCRIPT_TYPES: { GLOBAL: 0, SCOPED: 1, PRESET: 2 }, getScriptsByType: () => [] };
  assert.equal(__testing.buildRegexCleanupPlan({ next: settings, currentRegex: full, engine }), null);
});

test('applyScopedRegexCleanup saves back only the scopes that actually had something removed, and never touches the host at all when there is no engine', async () => {
  const previousHost = globalThis.SillyTavern;
  const calls = [];
  const engine = {
    SCRIPT_TYPES: { GLOBAL: 0, SCOPED: 1, PRESET: 2 },
    async saveScriptsByType(scripts, type) { calls.push({ scripts, type }); },
  };
  let reloads = 0;
  const context = { reloadCurrentChat: async () => { reloads += 1; } };
  globalThis.SillyTavern = { getContext: () => context };
  try {
    const planBoth = { scopedPlan: { kept: ['a'], toRemove: 1 }, presetPlan: { kept: ['b'], toRemove: 2 } };
    await __testing.applyScopedRegexCleanup(planBoth, engine);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { scripts: ['a'], type: 1 });
    assert.deepEqual(calls[1], { scripts: ['b'], type: 2 });
    assert.equal(reloads, 1, '写完角色/预设范围后重新加载聊天，酒馆自己的正则面板才会跟着重建');

    calls.length = 0; reloads = 0;
    const planScopedOnly = { scopedPlan: { kept: ['a'], toRemove: 1 }, presetPlan: { kept: ['b', 'c'], toRemove: 0 } };
    await __testing.applyScopedRegexCleanup(planScopedOnly, engine);
    assert.equal(calls.length, 1, '没有可删的范围不写回，即使那个范围本身是可用的');
    assert.equal(calls[0].type, 1);
    assert.equal(reloads, 1);

    calls.length = 0; reloads = 0;
    await __testing.applyScopedRegexCleanup(planBoth, null);
    assert.equal(calls.length, 0, '没有引擎就完全不写');
    assert.equal(reloads, 0, '什么都没写，就不用重新加载聊天');
  } finally {
    globalThis.SillyTavern = previousHost;
  }
});

test('buildRegexCleanupPlan leaves the scoped clause out of the message when no character is selected -- getScriptsByType(SCOPED) returns [] rather than throwing, so the scope is not "unavailable", just empty', () => {
  const settings = normalizeProcessingSettings();
  const profile = makeBuiltinReadingProfile(settings, 'cute');
  settings.processingProfiles = [profile];
  settings.selectedProcessingProfileId = profile.id;
  const full = syncNativeRegex([], profile);
  const ruleName = `镜译 · ${profile.name} · ${profile.regexScripts[0].scriptName}`;
  const ruleCopy = full.find(rule => rule.scriptName === ruleName);
  const polluted = [...full, { ...ruleCopy }];
  const movedFixed = { ...full.find(rule => rule.id === `${MODULE_ID}:prompt-affix`) };
  // The real host never throws for "no character selected" -- characters[undefined] is just undefined,
  // so getScriptsByType(SCOPED) returns [] like any other scope with nothing 镜译-owned in it.
  const engine = {
    SCRIPT_TYPES: { GLOBAL: 0, SCOPED: 1, PRESET: 2 },
    getScriptsByType(type) {
      if (type === 1) return [];
      if (type === 2) return [movedFixed];
      return [];
    },
  };
  const plan = __testing.buildRegexCleanupPlan({ next: settings, currentRegex: polluted, engine });
  assert.ok(plan);
  assert.equal(plan.scopedRemove, 0);
  assert.equal(plan.presetRemove, 1);
  assert.doesNotMatch(plan.message, /角色绑定/, '角色范围没有可删的，干脆不提，不写成"角色绑定 0 条"');
  assert.match(plan.message, /预设绑定 1 条/);
});

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
  assert.equal(first[1], unrelated);
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
      assert.equal(rule.markdownOnly, true); assert.equal(rule.promptOnly, false);
      display = display.replace(compileNativeRegex(rule.findRegex), rule.replaceString);
    }
    assert.ok(display.includes(`jy-reading-${id}`));
    assert.doesNotMatch(display, /<jy-source>|<jy-translation>|[\u200b\u200c\u2060-\u2064]/);
    assert.ok(display.includes('Original.') && display.includes('译文。'));
    if (id === 'fold') { assert.match(display, /<details class=/); assert.doesNotMatch(display, /<details[^>]*\bopen\b/); }
  }
});

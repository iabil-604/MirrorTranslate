import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MIN_CONTRAST,
  EMOTION_KEYS,
  MIN_HUE_SEPARATION,
  NEUTRAL_CHROMA,
  adaptColorToBand,
  blendOver,
  computeSafeBand,
  contrastRatio,
  fallbackHue,
  isNeutralColor,
  meetsContrast,
  normalizeEmotion,
  normalizeIntensity,
  oklchToSrgb,
  parseCssColor,
  relativeLuminance,
  resolveSegmentStyle,
  spreadHues,
  srgbToOklch,
  toHex,
} from '../palette.js';

// Circular distance between two hue angles, in degrees.
const hueDelta = (left, right) => Math.abs((((left - right) % 360) + 540) % 360 - 180);

const DARK_THEME = ['#1b1b22'];
const LIGHT_THEME = ['#f4f1ea'];
const BUSY_WALLPAPER = ['#2a3140', '#3d4658', '#1d2430'];
const HAIR = {
  金发: '#f2d16b',
  黑发: '#1f1f24',
  银发: '#c9ccd1',
  蓝发: '#3b6ee0',
  粉发: '#ef7fae',
  棕发: '#5a3b2e',
  红发: '#c1382f',
};

test('colour parsing accepts the shapes a theme actually uses and refuses the rest', () => {
  assert.deepEqual(parseCssColor('#abc'), parseCssColor('#aabbcc'));
  assert.equal(toHex(parseCssColor('rgb(255, 0, 0)')), '#ff0000');
  assert.equal(toHex(parseCssColor('rgba(0 128 255 / 50%)')), '#0080ff');
  assert.equal(parseCssColor('rgba(0, 0, 0, 0.4)').a, 0.4);
  assert.equal(toHex(parseCssColor('silver')), '#c0c0c0');
  assert.equal(parseCssColor('var(--SmartThemeBodyColor)'), null);
  assert.equal(parseCssColor(''), null);
  assert.equal(parseCssColor('not a colour'), null);
});

test('sRGB and Oklch round-trip without visible drift', () => {
  for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#3366cc', '#f5d76e', '#101014', '#ffffff', '#7a7a80']) {
    assert.equal(toHex(oklchToSrgb(srgbToOklch(parseCssColor(hex)))), hex, hex);
  }
});

test('luminance and contrast match the WCAG reference points', () => {
  assert.equal(relativeLuminance(parseCssColor('#ffffff')).toFixed(4), '1.0000');
  assert.equal(relativeLuminance(parseCssColor('#000000')).toFixed(4), '0.0000');
  assert.equal(contrastRatio(parseCssColor('#000'), parseCssColor('#fff')).toFixed(2), '21.00');
  assert.equal(contrastRatio(parseCssColor('#777777'), parseCssColor('#ffffff')).toFixed(2), '4.48');
});

test('a translucent tint composites onto the wallpaper below it', () => {
  const composited = blendOver(parseCssColor('rgba(0, 0, 0, 0.5)'), parseCssColor('#ffffff'));
  assert.equal(toHex(composited), '#808080');
  assert.equal(toHex(blendOver(parseCssColor('rgba(255,0,0,0)'), parseCssColor('#123456'))), '#123456');
});

test('black, white and silver are excluded; every other hair colour is usable', () => {
  assert.equal(isNeutralColor(HAIR.黑发), true);
  assert.equal(isNeutralColor(HAIR.银发), true);
  assert.equal(isNeutralColor('#ffffff'), true);
  assert.equal(isNeutralColor('#808080'), true);
  for (const key of ['金发', '蓝发', '粉发', '棕发', '红发']) {
    assert.equal(isNeutralColor(HAIR[key]), false, key);
  }
});

test('every adapted colour clears the contrast floor on every background sample', () => {
  for (const backgrounds of [DARK_THEME, LIGHT_THEME, BUSY_WALLPAPER]) {
    const band = computeSafeBand(backgrounds);
    assert.equal(band.feasible, true, JSON.stringify(backgrounds));
    for (const [name, source] of Object.entries(HAIR)) {
      const adapted = adaptColorToBand(source, band, { name });
      const rgb = parseCssColor(adapted.hex);
      assert.ok(
        meetsContrast(rgb, band.backgrounds, band.minContrast - 0.05),
        `${name} ${adapted.hex} 在 ${JSON.stringify(backgrounds)} 上对比度不足`,
      );
      assert.ok(adapted.oklch.c >= NEUTRAL_CHROMA * 0.9, `${name} 退化成了灰字：${adapted.hex}`);
    }
  }
});

test('the same character keeps its hue across a light and a dark theme', () => {
  const dark = computeSafeBand(DARK_THEME);
  const light = computeSafeBand(LIGHT_THEME);
  for (const [name, source] of Object.entries(HAIR)) {
    const onDark = adaptColorToBand(source, dark, { name });
    const onLight = adaptColorToBand(source, light, { name });
    assert.ok(hueDelta(onDark.oklch.h, onLight.oklch.h) < 1,
      `${name} 换主题后色相跑了：${onDark.oklch.h} vs ${onLight.oklch.h}`);
  }
  // A dark theme wants light text and a light theme wants dark text; the band picks the direction.
  assert.equal(dark.direction, 'light');
  assert.equal(light.direction, 'dark');
});

test('a neutral-haired character still gets a stable, non-neutral colour of their own', () => {
  const band = computeSafeBand(DARK_THEME);
  const first = adaptColorToBand(HAIR.黑发, band, { name: '诗羽' });
  const again = adaptColorToBand(HAIR.银发, band, { name: '诗羽' });
  assert.equal(first.neutralSource, true);
  assert.equal(first.hex, again.hex, '同一个名字必须永远拿到同一个颜色');
  assert.notEqual(first.hex, adaptColorToBand(HAIR.黑发, band, { name: '加藤' }).hex);
  assert.equal(fallbackHue('诗羽'), fallbackHue('诗羽'));
  assert.notEqual(fallbackHue('诗羽'), fallbackHue('英梨梨'));
});

test('a mid-grey wallpaper is reported as impossible instead of silently producing grey text', () => {
  const band = computeSafeBand(['#7a7a80']);
  assert.equal(band.feasible, false);
  assert.match(band.note, /彩度|对比度/);
  // The note has to name a target that works, and that target has to actually work.
  assert.ok(band.reachableContrast > 1 && band.reachableContrast < DEFAULT_MIN_CONTRAST, String(band.reachableContrast));
  assert.match(band.note, new RegExp(String(band.reachableContrast)));
  const relaxed = computeSafeBand(['#7a7a80'], { minContrast: band.reachableContrast });
  assert.equal(relaxed.feasible, true);
});

test('a wallpaper spanning black to white admits no single readable colour and says so', () => {
  const band = computeSafeBand(['#000000', '#ffffff']);
  assert.equal(band.feasible, false);
  assert.equal(band.reachableContrast, 0);
  assert.match(band.note, /明暗跨度/);
});

test('vividness trades faithfulness to the source colour against visibility', () => {
  const band = computeSafeBand(DARK_THEME);
  const faithful = adaptColorToBand(HAIR.棕发, band, { name: '加藤', vividness: 0 });
  const vivid = adaptColorToBand(HAIR.棕发, band, { name: '加藤', vividness: 1 });
  assert.ok(vivid.oklch.c > faithful.oklch.c);
  assert.equal(Math.round(vivid.oklch.h), Math.round(faithful.oklch.h), '提彩度不应该改色相');
});

test('speakers with neighbouring hair colours are pushed apart', () => {
  const spread = spreadHues([10, 14, 18, 200]);
  for (let index = 0; index < spread.length; index += 1) {
    for (let other = index + 1; other < spread.length; other += 1) {
      assert.ok(hueDelta(spread[index], spread[other]) >= MIN_HUE_SEPARATION - 0.5,
        `${spread[index]} 与 ${spread[other]} 仍然太近`);
    }
  }
  // Order is preserved so a palette does not reshuffle itself when one speaker is added.
  assert.ok(hueDelta(spread[0], 10) < MIN_HUE_SEPARATION);
  assert.deepEqual(spreadHues([120]), [120]);
  assert.deepEqual(spreadHues([]), []);
});

test('emotion labels survive the languages and synonyms a model actually answers with', () => {
  assert.equal(normalizeEmotion('angry'), 'angry');
  assert.equal(normalizeEmotion('愤怒'), 'angry');
  assert.equal(normalizeEmotion('  Furious '), 'angry');
  assert.equal(normalizeEmotion('hesitant'), 'fear');
  assert.equal(normalizeEmotion('犹豫'), 'fear');
  assert.equal(normalizeEmotion('mildly perplexed'), '', '认不出来就当没标注，不猜');
  assert.equal(normalizeEmotion(undefined), '');
  assert.equal(normalizeIntensity('2'), 2);
  assert.equal(normalizeIntensity(9), 2);
  assert.equal(normalizeIntensity(-1), 0);
  assert.equal(normalizeIntensity('高'), 1, '认不出强度就用中间值');
});

test('an emotion label that names a built-in object property is refused like any other nonsense', () => {
  const band = computeSafeBand(['#15171c']);
  for (const probe of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.equal(normalizeEmotion(probe), '', `${probe} 不是情绪标签`);
    const style = resolveSegmentStyle({ speakerColor: '#c0392b', emotion: probe, intensity: 2, band, name: '英梨梨' });
    // The label reaches a class attribute verbatim, so a non-string here would be written into the
    // floor as jy-emo-[object Object] and split into stray class tokens.
    assert.equal(typeof style.emotion, 'string');
    assert.equal(style.emotion, '');
    assert.equal(style.intensity, 0, '认不出的情绪不带强度，等同没标注');
  }
});

test('no emotion at any intensity can push a line below the contrast floor', () => {
  for (const backgrounds of [DARK_THEME, LIGHT_THEME, BUSY_WALLPAPER]) {
    const band = computeSafeBand(backgrounds);
    for (const [name, source] of Object.entries(HAIR)) {
      for (const emotion of EMOTION_KEYS) {
        for (const intensity of [0, 1, 2]) {
          const style = resolveSegmentStyle({ speakerColor: source, emotion, intensity, band, name });
          const color = style.css.match(/color:(#[0-9a-f]{6})/)?.[1];
          assert.ok(color, `${name}/${emotion} 没有生成颜色`);
          assert.ok(
            meetsContrast(parseCssColor(color), band.backgrounds, band.minContrast - 0.05),
            `${name}/${emotion}/${intensity} → ${color} 对比度不足`,
          );
        }
      }
    }
  }
});

test('intensity 0 and an unrecognised emotion both fall back to the plain speaker colour', () => {
  const band = computeSafeBand(DARK_THEME);
  const plain = resolveSegmentStyle({ speakerColor: HAIR.金发, emotion: 'neutral', band, name: '英梨梨' });
  const zero = resolveSegmentStyle({ speakerColor: HAIR.金发, emotion: 'shout', intensity: 0, band, name: '英梨梨' });
  const unknown = resolveSegmentStyle({ speakerColor: HAIR.金发, emotion: '莫名其妙', intensity: 2, band, name: '英梨梨' });
  assert.equal(zero.css, plain.css);
  assert.equal(unknown.css, plain.css);
  assert.equal(unknown.emotion, '');
  assert.doesNotMatch(plain.css, /font-weight|font-style|font-size|letter-spacing/);
});

test('a loud emotion reads louder and a quiet one reads quieter', () => {
  const band = computeSafeBand(DARK_THEME);
  const shout = resolveSegmentStyle({ speakerColor: HAIR.红发, emotion: 'shout', intensity: 2, band, name: '红' });
  const whisper = resolveSegmentStyle({ speakerColor: HAIR.红发, emotion: 'whisper', intensity: 2, band, name: '红' });
  assert.match(shout.css, /font-weight:[89]\d\d/);
  assert.match(shout.css, /font-size:1\.\d+em/);
  assert.match(whisper.css, /font-style:italic/);
  assert.match(whisper.css, /font-size:0\.\d+em/);
  assert.ok(Number(whisper.css.match(/font-weight:(\d+)/)[1]) < 400);
});

test('one speaker’s emotional range stays inside the gap that separates two speakers', () => {
  const band = computeSafeBand(['#1a1520', '#2a2438', '#3a3050']);
  const hues = EMOTION_KEYS.map(emotion => {
    const style = resolveSegmentStyle({ speakerColor: '#f2e750', emotion, intensity: 2, band, name: '坂本竜司' });
    const hex = style.css.match(/color:(#[0-9a-f]{6})/)[1];
    return srgbToOklch(parseCssColor(hex)).h;
  });
  const span = Math.max(...hues) - Math.min(...hues);
  // Unclamped, angry (-10/step) and shy (+12/step) at intensity 2 swung this to 44 degrees — wider
  // than the guaranteed distance to a different character, so the colour identified nobody.
  assert.ok(span < MIN_HUE_SEPARATION, `同一角色的色相跨度 ${span.toFixed(0)} 度，必须小于角色间隔 ${MIN_HUE_SEPARATION} 度`);
});

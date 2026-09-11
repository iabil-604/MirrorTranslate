// Speaker and emotion colouring maths.
//
// The design rule behind this file: the secondary model never chooses a colour. It answers two
// classification questions — who is speaking, and in what emotional register — and everything
// visual is derived here, deterministically, from the character's own hair or eye colour and from
// the background the reader actually has behind the chat.
//
// That matters because a model asked for a hex value has to hold four things at once: recognise the
// speaker, recall that speaker's colour, emit valid markup, and judge readability against a theme it
// cannot see. Only the first is a task models are reliably good at.
//
// Everything in this module is pure. No DOM, no settings, no host access, so it can be tested
// exhaustively and reasoned about without a browser.

// A colour whose chroma sits below this reads as black, white or grey regardless of hue, which the
// palette deliberately excludes: those are the theme's own text colours and carry no speaker identity.
export const NEUTRAL_CHROMA = 0.035;
// sRGB cannot hold much more than this at any hue, so it is the ceiling for a requested chroma.
export const MAX_CHROMA = 0.37;
export const DEFAULT_MIN_CONTRAST = 4.5;
// Two speakers whose hues sit closer than this are hard to tell apart mid-sentence.
export const MIN_HUE_SEPARATION = 24;
// An emotion tints a speaker's colour; it must not walk it into another speaker's hue. Speakers are
// only guaranteed MIN_HUE_SEPARATION apart, so one speaker's whole emotional range has to stay well
// inside that gap — otherwise the colour stops identifying anyone, which is its only job.
export const MAX_EMOTION_HUE_SHIFT = MIN_HUE_SEPARATION / 3;

const CSS_NAMED_COLORS = Object.freeze({
  black: '#000000', silver: '#c0c0c0', gray: '#808080', grey: '#808080', white: '#ffffff',
  maroon: '#800000', red: '#ff0000', purple: '#800080', fuchsia: '#ff00ff', magenta: '#ff00ff',
  green: '#008000', lime: '#00ff00', olive: '#808000', yellow: '#ffff00', navy: '#000080',
  blue: '#0000ff', teal: '#008080', aqua: '#00ffff', cyan: '#00ffff', orange: '#ffa500',
  pink: '#ffc0cb', brown: '#a52a2a', gold: '#ffd700', indigo: '#4b0082', violet: '#ee82ee',
  crimson: '#dc143c', salmon: '#fa8072', khaki: '#f0e68c', lavender: '#e6e6fa', beige: '#f5f5dc',
  transparent: 'rgba(0,0,0,0)',
});

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function clamp01(value) {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

// Accepts #rgb, #rrggbb, #rrggbbaa, rgb()/rgba() in both comma and space syntax, and the handful of
// named colours a theme is likely to use. Returns null for anything else rather than guessing.
export function parseCssColor(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  const named = CSS_NAMED_COLORS[raw];
  if (named) return parseCssColor(named);
  const hex = raw.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const digits = hex[1];
    const expand = digits.length <= 4
      ? [...digits].map(character => character + character).join('')
      : digits;
    if (expand.length !== 6 && expand.length !== 8) return null;
    return {
      r: Number.parseInt(expand.slice(0, 2), 16) / 255,
      g: Number.parseInt(expand.slice(2, 4), 16) / 255,
      b: Number.parseInt(expand.slice(4, 6), 16) / 255,
      a: expand.length === 8 ? Number.parseInt(expand.slice(6, 8), 16) / 255 : 1,
    };
  }
  const functional = raw.match(/^rgba?\(([^)]+)\)$/);
  if (functional) {
    const parts = functional[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = part => (part.endsWith('%') ? Number.parseFloat(part) / 100 : Number.parseFloat(part) / 255);
    const alpha = parts[3] === undefined
      ? 1
      : (parts[3].endsWith('%') ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3]));
    const rgb = { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha };
    return Object.values(rgb).every(Number.isFinite) ? rgb : null;
  }
  return null;
}

export function toHex({ r, g, b }) {
  const channel = value => Math.round(clamp01(value) * 255).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

// Straight alpha compositing, used to fold a theme's translucent chat tint onto the wallpaper below.
export function blendOver(top, bottom) {
  const alpha = clamp01(top.a ?? 1);
  return {
    r: top.r * alpha + bottom.r * (1 - alpha),
    g: top.g * alpha + bottom.g * (1 - alpha),
    b: top.b * alpha + bottom.b * (1 - alpha),
    a: 1,
  };
}

function toLinear(channel) {
  const value = clamp01(channel);
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function fromLinear(channel) {
  const value = clamp01(channel);
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

export function relativeLuminance({ r, g, b }) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(foreground, background) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

// Oklab, per Björn Ottosson's published matrices. Perceptual lightness is what makes "same colour,
// different theme" possible: the hue stays put while only L moves.
export function srgbToOklab({ r, g, b }) {
  const red = toLinear(r);
  const green = toLinear(g);
  const blue = toLinear(b);
  const long = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const medium = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const short = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return {
    L: 0.2104542553 * long + 0.7936177850 * medium - 0.0040720468 * short,
    a: 1.9779984951 * long - 2.4285922050 * medium + 0.4505937099 * short,
    b: 0.0259040371 * long + 0.7827717662 * medium - 0.8086757660 * short,
  };
}

export function oklabToSrgb({ L, a, b }) {
  const long = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return {
    r: fromLinear(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short),
    g: fromLinear(-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short),
    b: fromLinear(-0.0041960863 * long - 0.7034186147 * medium + 1.7076147010 * short),
    a: 1,
  };
}

export function srgbToOklch(rgb) {
  const { L, a, b } = srgbToOklab(rgb);
  const chroma = Math.hypot(a, b);
  const hue = chroma < 1e-6 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l: L, c: chroma, h: hue };
}

export function oklchToSrgb({ l, c, h }) {
  const radians = (h * Math.PI) / 180;
  return oklabToSrgb({ L: l, a: Math.cos(radians) * c, b: Math.sin(radians) * c });
}

// True when converting back out of Oklch needed clipping, i.e. the requested colour does not exist
// in sRGB. Chroma requests are reduced until this stops being true.
export function inSrgbGamut({ l, c, h }, tolerance = 0.002) {
  const radians = (h * Math.PI) / 180;
  const linear = oklabToSrgb({ L: l, a: Math.cos(radians) * c, b: Math.sin(radians) * c });
  const roundTrip = srgbToOklch(linear);
  return Math.abs(roundTrip.c - c) <= tolerance + 0.02 * c && Math.abs(roundTrip.l - l) <= tolerance;
}

export function isNeutralColor(value) {
  const oklch = typeof value === 'string' ? srgbToOklch(parseCssColor(value) ?? { r: 0, g: 0, b: 0 }) : value;
  return !oklch || !Number.isFinite(oklch.c) || oklch.c < NEUTRAL_CHROMA;
}

// A stable hue for a speaker whose hair and eyes are black, white or silver — the three the palette
// refuses to use. The hash is deterministic, so the same name keeps the same colour across chats and
// across devices, which is the only property that actually matters for recognition.
export function fallbackHue(name) {
  let hash = 2166136261;
  for (const character of String(name ?? '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 3600) / 10;
}

function luminanceTargets(backgrounds, minContrast) {
  const luminances = backgrounds.map(relativeLuminance);
  // Text lighter than the background: every sample has to clear the ratio, so the brightest wins.
  const lightFloor = Math.max(...luminances.map(value => minContrast * (value + 0.05) - 0.05));
  // Text darker than the background: the darkest sample sets the ceiling.
  const darkCeiling = Math.min(...luminances.map(value => (value + 0.05) / minContrast - 0.05));
  return { lightFloor, darkCeiling };
}

// Highest Oklch lightness reachable at this hue and chroma inside sRGB, and the luminance it gives.
function luminanceAt(l, c, h) {
  return relativeLuminance(oklchToSrgb({ l, c, h }));
}

// Oklch lightness is monotonic in relative luminance at a fixed hue and chroma, so a bisection
// lands on the exact lightness that meets a luminance target instead of guessing at a band.
function solveLightness(target, chroma, hue, direction) {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 40; step += 1) {
    const middle = (low + high) / 2;
    if (luminanceAt(middle, chroma, hue) < target) low = middle;
    else high = middle;
  }
  return direction === 'light' ? high : low;
}

export function meetsContrast(rgb, backgrounds, minContrast = DEFAULT_MIN_CONTRAST) {
  return backgrounds.every(background => contrastRatio(rgb, background) >= minContrast - 1e-6);
}

// Largest chroma every hue can carry at this luminance while staying in gamut and above the floor.
function chromaCeilingAt(target, direction, samples, minContrast, hueSteps) {
  const hues = Array.from({ length: hueSteps }, (_unused, index) => (index * 360) / hueSteps);
  let best = 0;
  for (let step = 1; step <= 40; step += 1) {
    const chroma = (step / 40) * MAX_CHROMA;
    const usable = hues.every(hue => {
      const lightness = solveLightness(target, chroma, hue, direction);
      if (direction === 'light' ? lightness > 0.999 : lightness < 0.001) return false;
      return inSrgbGamut({ l: lightness, c: chroma, h: hue })
        && meetsContrast(oklchToSrgb({ l: lightness, c: chroma, h: hue }), samples, minContrast);
    });
    if (!usable) break;
    best = chroma;
  }
  return best;
}

/**
 * Works out the range of colours that stay readable on every background sample handed in.
 *
 * `backgrounds` are opaque sRGB colours already composited (wallpaper under tint under blur).
 *
 * Sitting exactly on the contrast floor is legal but ugly: it produces muddy, half-grey text on a
 * dark theme. sRGB also holds far more chroma in the middle of the lightness range than at either
 * end. So the whole feasible range is scanned and the luminance that carries the most chroma wins —
 * chroma is what actually tells one speaker from another.
 */
export function computeSafeBand(backgrounds, { minContrast = DEFAULT_MIN_CONTRAST, hueSteps = 12, steps = 16 } = {}) {
  const samples = (Array.isArray(backgrounds) ? backgrounds : [backgrounds])
    .map(value => (typeof value === 'string' ? parseCssColor(value) : value))
    .filter(Boolean)
    .map(rgb => ({ ...rgb, a: 1 }));
  if (!samples.length) throw new Error('没有可用的背景取样，无法计算安全色域。');
  const best = bestBandFor(samples, minContrast, hueSteps, steps);
  const feasible = best.chromaMax >= NEUTRAL_CHROMA;
  return {
    feasible,
    direction: best.direction,
    minContrast,
    luminance: best.luminance,
    chromaMax: best.chromaMax,
    // A representative lightness for previews; every hue solves its own when a colour is built.
    lightness: solveLightness(best.luminance, Math.min(best.chromaMax, 0.1), 0, best.direction),
    backgrounds: samples,
    // The strictest target this background can actually satisfy. When the requested one is out of
    // reach the UI can name a number that works instead of only saying no.
    reachableContrast: feasible ? minContrast : highestUsableContrast(samples, minContrast, hueSteps, steps),
    note: feasible ? '' : unusableNote(samples, minContrast, hueSteps, steps),
  };
}

// Scans the whole feasible luminance range and keeps the point that carries the most chroma.
function bestBandFor(samples, minContrast, hueSteps, steps) {
  const { lightFloor, darkCeiling } = luminanceTargets(samples, minContrast);
  const candidates = [];
  if (lightFloor <= 1) {
    for (let step = 0; step <= steps; step += 1) {
      candidates.push({ direction: 'light', luminance: lightFloor + ((1 - lightFloor) * step) / steps });
    }
  }
  if (darkCeiling >= 0) {
    for (let step = 0; step <= steps; step += 1) {
      candidates.push({ direction: 'dark', luminance: darkCeiling - (darkCeiling * step) / steps });
    }
  }
  if (!candidates.length) return { direction: 'light', luminance: 1, chromaMax: 0, impossible: true };
  let best = { ...candidates[0], chromaMax: -1 };
  for (const candidate of candidates) {
    const chromaMax = chromaCeilingAt(candidate.luminance, candidate.direction, samples, minContrast, hueSteps);
    if (chromaMax > best.chromaMax) best = { ...candidate, chromaMax };
  }
  return best;
}

const CONTRAST_LADDER = Object.freeze([7, 6, 5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5]);

function highestUsableContrast(samples, requested, hueSteps, steps) {
  for (const target of CONTRAST_LADDER) {
    if (target >= requested) continue;
    if (bestBandFor(samples, target, hueSteps, steps).chromaMax >= NEUTRAL_CHROMA) return target;
  }
  return 0;
}

function unusableNote(samples, minContrast, hueSteps, steps) {
  const reachable = highestUsableContrast(samples, minContrast, hueSteps, steps);
  if (reachable) {
    return `这个背景在对比度 ${minContrast} 下没有可用的彩色区间，着色会退化成灰字。把目标降到 ${reachable} 就可用；或者给聊天区加一层更实的底色。`;
  }
  return '这个背景（多半是壁纸明暗跨度太大）没有任何一种彩色能在全部取样上保持可读。建议给聊天区加一层更实的底色，或换一张对比更平的壁纸。';
}

/**
 * The most saturated readable point for one hue: the lightness at which this hue carries the most
 * chroma while still clearing the contrast floor on every background sample.
 *
 * `band.luminance` is deliberately not used here. That figure is the one lightness the whole hue
 * circle can share, and sharing it is what ruins a hue whose chroma peaks somewhere else — sRGB
 * holds yellow at L≈0.94 and blue at L≈0.45, so a single shared point crushes yellow into khaki
 * even when the raw hair colour already cleared the floor three times over. The floor is the
 * constraint; a common lightness never was one.
 */
function bestPointForHue(hue, band) {
  const luminances = band.backgrounds.map(relativeLuminance);
  // Keep every speaker on the same side of the background as the band decided, so a mid-grey
  // theme does not end up with some names in light text and others in dark.
  const admissible = candidate => (band.direction === 'light'
    ? relativeLuminance(candidate) > Math.max(...luminances)
    : relativeLuminance(candidate) < Math.min(...luminances));
  let best = { l: band.lightness ?? 0.6, c: 0 };
  for (let step = 0; step <= 48; step += 1) {
    const l = 0.08 + (0.9 * step) / 48;
    let low = 0;
    let high = MAX_CHROMA;
    for (let iteration = 0; iteration < 14; iteration += 1) {
      const middle = (low + high) / 2;
      const candidate = { l, c: middle, h: hue };
      const rgb = oklchToSrgb(candidate);
      if (inSrgbGamut(candidate) && admissible(rgb) && meetsContrast(rgb, band.backgrounds, band.minContrast)) low = middle;
      else high = middle;
    }
    if (low > best.c) best = { l, c: low };
  }
  return best;
}

// Solving a hue costs a few hundred gamut probes, and a floor asks for the same handful of speakers
// over and over, so the answer is remembered per hue and per band.
const huePointCache = new Map();

function cachedBestPointForHue(hue, band) {
  const key = `${Math.round(hue)}|${band.direction}|${band.minContrast}|${band.backgrounds.map(toHex).join(',')}`;
  let point = huePointCache.get(key);
  if (!point) {
    point = bestPointForHue(hue, band);
    if (huePointCache.size > 512) huePointCache.clear();
    huePointCache.set(key, point);
  }
  return point;
}

/**
 * Turns a character's declared hair or eye colour into the colour their speech is painted in.
 *
 * Only the hue survives from the source colour: lightness is re-solved against the reader's own
 * background, so one palette works in a light theme and a dark theme without editing.
 */
export function adaptColorToBand(source, band, { chromaScale = 1, lightnessDelta = 0, hueShift = 0, name = '', vividness = 0.65 } = {}) {
  const rgb = typeof source === 'string' ? parseCssColor(source) : source;
  const oklch = rgb ? srgbToOklch(rgb) : null;
  const neutral = !oklch || isNeutralColor(oklch);
  const hue = ((neutral ? fallbackHue(name) : oklch.h) + hueShift + 360) % 360;
  // A brown or a muted teal is a legitimate hair colour but carries so little chroma that it lands
  // back in grey territory once the lightness is re-solved. `vividness` lifts source chroma towards
  // the band ceiling — 0 keeps the source faithful, 1 paints every speaker at full strength.
  const peak = cachedBestPointForHue(hue, band);
  const ceiling = Math.max(peak.c, NEUTRAL_CHROMA);
  const sourceChroma = neutral ? ceiling : Math.min(oklch.c, ceiling);
  const lift = clamp01(vividness);
  const requested = sourceChroma + (ceiling - sourceChroma) * lift;
  let chroma = clamp(requested * chromaScale, Math.min(NEUTRAL_CHROMA, ceiling), ceiling);
  let lightness = peak.l;
  // The peak lightness is only the best point at full chroma. An emotion that cuts chroma pulls the
  // colour towards the grey of that same lightness, and that grey can sit below the floor — so move
  // away from the background first, and only give up chroma once lightness has nowhere left to go.
  const away = band.direction === 'light' ? 0.01 : -0.01;
  for (let guard = 0; guard < 240; guard += 1) {
    const candidate = { l: lightness, c: chroma, h: hue };
    if (inSrgbGamut(candidate) && meetsContrast(oklchToSrgb(candidate), band.backgrounds, band.minContrast)) break;
    const moved = clamp01(lightness + away);
    if (moved !== lightness && inSrgbGamut({ l: moved, c: chroma, h: hue })) lightness = moved;
    else if (chroma > 0) chroma = Math.max(0, chroma - 0.005);
    else break;
  }
  // An emotion may push lightness further away from the background, never towards it.
  if (lightnessDelta) {
    const moved = clamp01(lightness + (band.direction === 'light' ? Math.abs(lightnessDelta) : -Math.abs(lightnessDelta)) * Math.sign(lightnessDelta));
    const candidate = { l: moved, c: chroma, h: hue };
    if (inSrgbGamut(candidate) && meetsContrast(oklchToSrgb(candidate), band.backgrounds, band.minContrast)) lightness = moved;
  }
  return {
    hex: toHex(oklchToSrgb({ l: lightness, c: chroma, h: hue })),
    oklch: { l: lightness, c: chroma, h: hue },
    neutralSource: neutral,
  };
}

/**
 * Nudges hues apart so two characters with similar hair colour do not end up with speech a reader
 * has to compare side by side to tell apart. Order is preserved; the first entry stays put.
 */
export function spreadHues(hues, minSeparation = MIN_HUE_SEPARATION) {
  const list = hues.map((hue, index) => ({ hue: ((Number(hue) % 360) + 360) % 360, index }));
  if (list.length < 2) return list.map(item => item.hue);
  const spacing = Math.min(minSeparation, 360 / list.length);
  const ordered = [...list].sort((left, right) => left.hue - right.hue);
  for (let pass = 0; pass < 8; pass += 1) {
    let moved = false;
    for (let index = 1; index < ordered.length; index += 1) {
      const gap = ordered[index].hue - ordered[index - 1].hue;
      if (gap >= spacing) continue;
      const push = (spacing - gap) / 2;
      ordered[index - 1].hue -= push;
      ordered[index].hue += push;
      moved = true;
    }
    const wrap = ordered[0].hue + 360 - ordered.at(-1).hue;
    if (wrap < spacing) {
      const push = (spacing - wrap) / 2;
      ordered[0].hue += push;
      ordered.at(-1).hue -= push;
      moved = true;
    }
    if (!moved) break;
  }
  const result = new Array(list.length);
  for (const item of ordered) result[item.index] = ((item.hue % 360) + 360) % 360;
  return result;
}

// The emotion vocabulary. Deliberately small and concrete: a classifier picks one of twelve labels
// far more reliably than it invents a description, and every label maps to typography a reader can
// actually perceive at body-text size. Deltas are per intensity step, so intensity 0 is neutral.
export const EMOTION_STYLES = Object.freeze({
  neutral: { label: '平静', weight: 0, size: 0, italic: false, letterSpacing: 0, chromaScale: 0, lightnessDelta: 0, hueShift: 0 },
  happy: { label: '喜悦', weight: 60, size: 0, italic: false, letterSpacing: 0, chromaScale: 0.12, lightnessDelta: 0.02, hueShift: 4 },
  tender: { label: '温柔', weight: -40, size: 0, italic: true, letterSpacing: 0.01, chromaScale: -0.15, lightnessDelta: 0.01, hueShift: 0 },
  sad: { label: '低落', weight: -40, size: 0, italic: true, letterSpacing: 0, chromaScale: -0.25, lightnessDelta: -0.02, hueShift: -6 },
  angry: { label: '愤怒', weight: 160, size: 0.02, italic: false, letterSpacing: -0.005, chromaScale: 0.2, lightnessDelta: 0, hueShift: -10 },
  fear: { label: '恐惧', weight: -20, size: -0.03, italic: true, letterSpacing: 0.03, chromaScale: -0.2, lightnessDelta: -0.02, hueShift: 0 },
  shy: { label: '害羞', weight: 0, size: -0.02, italic: false, letterSpacing: 0.01, chromaScale: 0.1, lightnessDelta: 0.02, hueShift: 12 },
  surprise: { label: '惊讶', weight: 140, size: 0.03, italic: false, letterSpacing: 0, chromaScale: 0.15, lightnessDelta: 0.02, hueShift: 0 },
  serious: { label: '严肃', weight: 100, size: 0, italic: false, letterSpacing: -0.01, chromaScale: -0.1, lightnessDelta: -0.01, hueShift: 0 },
  resolute: { label: '坚定', weight: 140, size: 0, italic: false, letterSpacing: 0, chromaScale: 0.05, lightnessDelta: 0.01, hueShift: 0 },
  whisper: { label: '低语', weight: -60, size: -0.05, italic: true, letterSpacing: 0.02, chromaScale: -0.3, lightnessDelta: -0.03, hueShift: 0 },
  shout: { label: '呼喊', weight: 200, size: 0.06, italic: false, letterSpacing: 0.005, chromaScale: 0.25, lightnessDelta: 0.03, hueShift: 0 },
});

export const EMOTION_KEYS = Object.freeze(Object.keys(EMOTION_STYLES));

// Models answer in whatever language the prompt is in, and they abbreviate. Map the obvious
// synonyms rather than throwing the label away and losing the whole annotation.
const EMOTION_ALIASES = Object.freeze({
  平静: 'neutral', 中性: 'neutral', calm: 'neutral', normal: 'neutral', flat: 'neutral',
  喜悦: 'happy', 高兴: 'happy', 开心: 'happy', joy: 'happy', joyful: 'happy', cheerful: 'happy',
  温柔: 'tender', 柔和: 'tender', gentle: 'tender', warm: 'tender', affectionate: 'tender',
  低落: 'sad', 悲伤: 'sad', 难过: 'sad', sorrow: 'sad', melancholy: 'sad', depressed: 'sad',
  愤怒: 'angry', 生气: 'angry', 恼火: 'angry', rage: 'angry', furious: 'angry', irritated: 'angry',
  恐惧: 'fear', 害怕: 'fear', 不安: 'fear', afraid: 'fear', scared: 'fear', anxious: 'fear', nervous: 'fear',
  害羞: 'shy', 羞涩: 'shy', 娇羞: 'shy', embarrassed: 'shy', bashful: 'shy', flustered: 'shy',
  惊讶: 'surprise', 吃惊: 'surprise', 震惊: 'surprise', shocked: 'surprise', astonished: 'surprise',
  严肃: 'serious', 冷静: 'serious', 郑重: 'serious', stern: 'serious', grave: 'serious',
  坚定: 'resolute', 决然: 'resolute', determined: 'resolute', firm: 'resolute',
  低语: 'whisper', 呢喃: 'whisper', 小声: 'whisper', murmur: 'whisper', quiet: 'whisper',
  呼喊: 'shout', 大喊: 'shout', 呐喊: 'shout', yell: 'shout', scream: 'shout', loud: 'shout',
  犹豫: 'fear', hesitant: 'fear', 迟疑: 'fear',
});

export function normalizeEmotion(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  if (Object.hasOwn(EMOTION_STYLES, raw)) return raw;
  // Own properties only. A plain index would walk the prototype chain and answer `__proto__` or
  // `constructor` with an object, which then reaches a class attribute as "jy-emo-[object Object]".
  return Object.hasOwn(EMOTION_ALIASES, raw) ? EMOTION_ALIASES[raw] : '';
}

export function normalizeIntensity(value) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(Math.round(number), 0, 2) : 1;
}

/**
 * The complete visual treatment for one translated line.
 *
 * `speakerColor` is the character's adapted base colour; the emotion only modulates it, and every
 * modulation is re-checked against the contrast floor inside `adaptColorToBand`, so no emotion can
 * make a line unreadable.
 */
export function resolveSegmentStyle({ speakerColor, emotion, intensity = 1, band, name = '', vividness = 0.65, overrides = {} } = {}) {
  const key = normalizeEmotion(emotion);
  const level = key && key !== 'neutral' ? normalizeIntensity(intensity) : 0;
  const table = { ...EMOTION_STYLES, ...overrides };
  const shape = table[key] ?? EMOTION_STYLES.neutral;
  const scale = level;
  const declarations = [];
  if (band && (speakerColor || name)) {
    const adapted = adaptColorToBand(speakerColor, band, {
      chromaScale: 1 + shape.chromaScale * scale,
      lightnessDelta: shape.lightnessDelta * scale,
      hueShift: clamp(shape.hueShift * scale, -MAX_EMOTION_HUE_SHIFT, MAX_EMOTION_HUE_SHIFT),
      name,
      vividness,
    });
    declarations.push(`color:${adapted.hex}`);
  }
  if (shape.weight * scale) declarations.push(`font-weight:${clamp(400 + Math.round(shape.weight * scale), 200, 900)}`);
  if (shape.italic && scale) declarations.push('font-style:italic');
  if (shape.size * scale) declarations.push(`font-size:${(1 + shape.size * scale).toFixed(3)}em`);
  if (shape.letterSpacing * scale) declarations.push(`letter-spacing:${(shape.letterSpacing * scale).toFixed(3)}em`);
  return { emotion: key, intensity: level, declarations, css: declarations.join(';') };
}

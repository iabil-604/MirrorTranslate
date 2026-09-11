// Reads what is actually behind the chat text: the theme's own layers plus the wallpaper under them.
//
// A theme declares colours, but what the reader sees is those colours composited over a background
// image that the theme knows nothing about. That is exactly why a palette that looks right on one
// setup washes out on another, so this samples the rendered result rather than trusting variables.
//
// The DOM walking lives here; every decision made from the samples lives in palette.js.

import { blendOver, parseCssColor, relativeLuminance, toHex } from './palette.js?v=0.15.2';

const CHAT_SELECTORS = Object.freeze(['#chat .mes_text', '#chat .mes', '#chat', '#sheld', 'body']);
const BACKGROUND_SELECTORS = Object.freeze(['#bg_custom', '#bg1', '#background', 'body']);
// Sampling every pixel of a wallpaper is pointless; a small raster keeps the whole probe under a frame.
const RASTER_WIDTH = 64;
const RASTER_HEIGHT = 36;

function firstElement(doc, selectors) {
  for (const selector of selectors) {
    const element = doc.querySelector(selector);
    if (element) return element;
  }
  return null;
}

function computedStyle(win, element) {
  try {
    return win.getComputedStyle(element);
  } catch {
    return null;
  }
}

function backgroundImageUrl(style) {
  const raw = String(style?.backgroundImage ?? '');
  const match = raw.match(/url\((['"]?)([^'")]+)\1\)/);
  return match ? match[2] : '';
}

/**
 * The stack of paint layers between the chat text and the page, innermost first.
 *
 * Each entry is the element's own background colour (alpha preserved) and, when it has one, the
 * background image URL. Walking stops at the first fully opaque colour: nothing below it shows.
 */
export function collectBackgroundLayers(element, win) {
  const layers = [];
  let node = element;
  while (node && node.nodeType === 1) {
    const style = computedStyle(win, node);
    if (style) {
      const color = parseCssColor(style.backgroundColor);
      const image = backgroundImageUrl(style);
      const opacity = Number.parseFloat(style.opacity);
      if ((color && color.a > 0) || image) {
        layers.push({
          color: color && color.a > 0
            ? { ...color, a: color.a * (Number.isFinite(opacity) ? opacity : 1) }
            : null,
          image,
          selector: node.id ? `#${node.id}` : node.className ? `.${String(node.className).split(/\s+/)[0]}` : node.tagName.toLowerCase(),
        });
        if (color && color.a >= 0.999 && !image) break;
      }
    }
    node = node.parentElement;
  }
  return layers;
}

// A handful of representative colours from a raster: the extremes decide readability, the median
// describes the general feel. Sampling only the average would hide a bright patch that eats text.
export function summarizeRaster(pixels) {
  if (!pixels.length) return [];
  const withLuminance = pixels
    .map(rgb => ({ rgb, luminance: relativeLuminance(rgb) }))
    .sort((left, right) => left.luminance - right.luminance);
  // 2nd and 98th percentile rather than the absolute extremes: one stray pixel should not decide
  // the palette for a whole wallpaper.
  const at = fraction => withLuminance[Math.min(withLuminance.length - 1, Math.max(0, Math.round(fraction * (withLuminance.length - 1))))].rgb;
  return [at(0.02), at(0.5), at(0.98)];
}

async function rasterFromImage(url, win) {
  const doc = win.document;
  const image = new win.Image();
  image.crossOrigin = 'anonymous';
  const loaded = new Promise((resolve, reject) => {
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener('error', () => reject(new Error('壁纸读取失败')), { once: true });
  });
  image.src = url;
  await loaded;
  const canvas = doc.createElement('canvas');
  canvas.width = RASTER_WIDTH;
  canvas.height = RASTER_HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('浏览器没有提供 2D 画布');
  context.drawImage(image, 0, 0, RASTER_WIDTH, RASTER_HEIGHT);
  // A cross-origin wallpaper taints the canvas and this throws; the caller falls back to the
  // theme's declared colours rather than failing the whole probe.
  const { data } = context.getImageData(0, 0, RASTER_WIDTH, RASTER_HEIGHT);
  const pixels = [];
  for (let index = 0; index < data.length; index += 4) {
    pixels.push({ r: data[index] / 255, g: data[index + 1] / 255, b: data[index + 2] / 255, a: 1 });
  }
  return pixels;
}

/**
 * Samples the effective background behind chat text.
 *
 * Returns two or three opaque colours: the wallpaper's dark, median and bright regions folded
 * through every translucent layer the theme puts on top. A palette that clears the contrast floor
 * on all of them clears it everywhere in the chat.
 */
export async function sampleThemeBackground({ document: doc, window: win } = {}) {
  const view = win ?? globalThis.window ?? globalThis;
  const root = doc ?? view.document;
  if (!root?.querySelector) throw new Error('取色需要在酒馆页面里运行。');
  const warnings = [];
  const anchor = firstElement(root, CHAT_SELECTORS);
  if (!anchor) throw new Error('没有找到聊天区域，无法取色。');
  const layers = collectBackgroundLayers(anchor, view);

  // The wallpaper element sits outside the chat's own ancestry in SillyTavern, so it is looked up
  // separately and treated as the bottom-most layer.
  let base = [{ r: 1, g: 1, b: 1, a: 1 }];
  let wallpaper = '';
  const backdrop = firstElement(root, BACKGROUND_SELECTORS);
  const backdropStyle = backdrop ? computedStyle(view, backdrop) : null;
  const backdropColor = parseCssColor(backdropStyle?.backgroundColor ?? '');
  if (backdropColor && backdropColor.a > 0) base = [{ ...backdropColor, a: 1 }];
  wallpaper = backgroundImageUrl(backdropStyle) || layers.map(layer => layer.image).find(Boolean) || '';
  if (wallpaper) {
    try {
      base = summarizeRaster(await rasterFromImage(wallpaper, view));
    } catch (error) {
      warnings.push(`壁纸像素读不到（${error.message}），本次只按主题声明的颜色取样。`);
    }
  }

  // Fold the theme's translucent layers back down onto each wallpaper sample, outermost last.
  const samples = base.map(bottom => {
    let result = { ...bottom, a: 1 };
    for (const layer of [...layers].reverse()) {
      if (layer.color && layer.color.a > 0) result = blendOver(layer.color, result);
    }
    return result;
  });
  const unique = [];
  for (const sample of samples) {
    const hex = toHex(sample);
    if (!unique.some(item => toHex(item) === hex)) unique.push(sample);
  }
  if (!unique.length) throw new Error('没有取到任何背景颜色。');
  return {
    samples: unique,
    hexes: unique.map(toHex),
    wallpaper,
    layers: layers.map(layer => ({ selector: layer.selector, color: layer.color ? toHex(layer.color) : '', alpha: layer.color?.a ?? 0, image: layer.image })),
    warnings,
  };
}

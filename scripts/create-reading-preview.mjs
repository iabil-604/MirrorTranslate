import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleBilingual, segmentSource } from '../core.js';
import { BUILTIN_READING_STYLES, normalizeProcessingSettings, makeBuiltinReadingProfile, syncNativeRegex, compileNativeRegex } from '../processing.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'reading.css'), 'utf8');
const source = '雨上がりの窓辺で、彼女は小さく笑った。\n\n「明日も、ここで会える？」';
const translations = new Map([[1, '雨后的窗边，她轻轻笑了。'], [2, '“明天，也能在这里见到你吗？”']]);
const cards = BUILTIN_READING_STYLES.map((style, index) => {
  const profile = makeBuiltinReadingProfile(normalizeProcessingSettings(), style.id);
  let html = assembleBilingual(segmentSource(source).layout, translations, profile.settings);
  for (const rule of syncNativeRegex([], profile)) html = html.replace(compileNativeRegex(rule.findRegex), rule.replaceString);
  return `<article><div class="card-heading"><span class="number">0${index + 1}</span><div><h2>${style.name}</h2><p>${style.description}</p></div></div><div class="sample">${html}</div></article>`;
}).join('\n');
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>镜译 · 三种阅读心情</title><style>
:root{color-scheme:light;--bg:#f5f3ed;--surface:#fffefa;--text:#35453f;--muted:#7a867e;--line:#e0e4db}
:root[data-theme="dark"]{color-scheme:dark;--bg:#1b2320;--surface:#232e28;--text:#e1e7df;--muted:#9ba89e;--line:#3b483f}
*{box-sizing:border-box}body{margin:0;padding:40px 28px;font:15px/1.7 system-ui,"Microsoft YaHei",sans-serif;color:var(--text);background:var(--bg)}main{max-width:1220px;margin:0 auto}header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:28px;border-bottom:1px solid var(--line)}.brand{letter-spacing:.18em;font-size:12px;color:var(--muted)}.hero{margin:38px 0 32px}h1{font:500 clamp(27px,4vw,39px)/1.4 Georgia,"Noto Serif SC",serif;letter-spacing:.04em;margin:0 0 12px}.hero p{color:var(--muted);margin:0;font-size:14px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}article{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:24px 22px 27px;min-width:0}.card-heading{display:flex;gap:12px;border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:25px;min-height:112px}.number{font:italic 23px Georgia,serif;color:#9da99e}.card-heading h2{font-size:17px;font-weight:600;margin:0 0 8px}.card-heading p{font-size:12px;color:var(--muted);margin:0;line-height:1.8}.sample{font-size:15px}.hint{margin-top:26px;color:var(--muted);font-size:12px}.theme{padding:9px 15px;border:1px solid var(--line);border-radius:20px;background:var(--surface);color:var(--text);font:inherit;font-size:12px;cursor:pointer}.theme:focus-visible{outline:2px solid #9cae99;outline-offset:3px}@media(max-width:850px){.grid{grid-template-columns:1fr}.card-heading{min-height:0}.sample{font-size:16px}body{padding:24px 18px}.hero{margin:28px 0}.card-heading{margin-bottom:16px}article{padding:22px}}
${css}
</style></head><body><main><header><span class="brand">镜译 · MIRROR TRANSLATE</span><button class="theme" type="button" aria-pressed="false">切换为夜间</button></header><div class="hero"><h1>同一段话，三种阅读心情。</h1><p>原文与译文各有位置，故事自然连在一起。</p></div><div class="grid">${cards}</div><p class="hint">点击「原文」可展开折叠内容。三款美化可在正文处理页选择、修改，并连同正则导出。</p></main><script>document.querySelector('.theme').addEventListener('click',function(){const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';this.textContent=dark?'切换为日间':'切换为夜间';this.setAttribute('aria-pressed',String(dark));});</script></body></html>`;
const out = path.resolve(process.argv[2] || path.join(root, 'reading-preview.html'));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(out);

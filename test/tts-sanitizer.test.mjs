import test from 'node:test';
import assert from 'node:assert/strict';

import { decodeHtmlEntities, looksLikeMarkup, sanitizeForTts } from '../tts-sanitizer.js';

test('the voice gets the words of a styled line, never its tags, attributes or entities', () => {
  const styled = '<span style="color:#78B750;font-size:0.85em;" class="custom-dialogue">真的可以……<strong>帮您</strong>吗……？</span>';
  assert.equal(sanitizeForTts(styled), '真的可以……帮您吗……？');
  assert.equal(sanitizeForTts('A &amp; B &lt;C&gt; &quot;D&quot; &#x4e2d;&#25991; &hellip;'), 'A & B <C> "D" 中文 …');
  assert.equal(sanitizeForTts('第一句<br>第二句<br/><br>第三句'), '第一句\n第二句\n\n第三句', 'breaks stay breaks, doubled at most once');
  assert.equal(sanitizeForTts('<p>一段</p><p>两段</p>'), '一段\n\n两段');
  assert.equal(sanitizeForTts('<div class="x"><em>甲</em>乙</div>丙'), '甲乙\n丙');
  assert.equal(sanitizeForTts('看<!-- 注释 -->不见<script>alert(1)</script>脚本<style>.a{}</style>'), '看不见脚本');
  assert.equal(sanitizeForTts('  多个   空格　全角  '), '多个 空格 全角');
  assert.equal(sanitizeForTts('带\u200b隐藏\ufeff字符'), '带隐藏字符');
  assert.equal(sanitizeForTts('3 < 5 and a<b'), '3 < 5 and a<b', 'a bare less-than is not a tag');
  assert.equal(sanitizeForTts(null), '');
});

test('markup detection and entity decoding stand on their own', () => {
  assert.equal(looksLikeMarkup('plain'), false);
  assert.equal(looksLikeMarkup('<b>x</b>'), true);
  assert.equal(looksLikeMarkup('&nbsp;'), true);
  assert.equal(decodeHtmlEntities('&unknown; &amp;'), '&unknown; &');
  assert.equal(decodeHtmlEntities('&#0;&#1114112;'), '&#0;&#1114112;', 'out-of-range codes stay as written');
});

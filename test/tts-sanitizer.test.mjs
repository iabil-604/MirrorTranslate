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

test('struck-through, redacted, arrow and mathematical-alphabet text is never read as written', () => {
  assert.equal(sanitizeForTts('看得见<s>看不见</s>的字'), '看得见的字', 'struck through, with its words');
  assert.equal(sanitizeForTts('看得见<del>看不见</del><strike>也看不见</strike>的字'), '看得见的字');
  assert.equal(
    sanitizeForTts('前面<span style="background-color:currentColor;color:currentColor">涂黑的字</span>后面'),
    '前面后面',
    'painted the same colour as its own background, with the words it hides',
  );
  assert.equal(
    sanitizeForTts("前面<span style='background: currentcolor'>涂黑</span>后面"),
    '前面后面',
    'the shorthand property and single quotes are read the same way',
  );
  assert.equal(
    sanitizeForTts('<span style="color:red">红字不涂黑</span>'),
    '红字不涂黑',
    'a style with no matching background is an ordinary span',
  );
  assert.equal(sanitizeForTts('语气上扬↗然后下降↘还有⤴⤵和〰'), '语气上扬然后下降还有和', 'tone arrows carry no word of their own');
  const bold = String.fromCodePoint(0x1d400, 0x1d401); // MATHEMATICAL BOLD CAPITAL A, B
  const fraktur = String.fromCodePoint(0x1d504, 0x1d505); // MATHEMATICAL FRAKTUR CAPITAL A, B
  assert.equal(sanitizeForTts(bold), 'AB', 'bold letters fold to the plain letters a voice knows');
  assert.equal(sanitizeForTts(fraktur), 'AB', 'fraktur folds the same way');
  // Letterlike Symbols: script, black-letter and double-struck capitals the Mathematical Alphanumeric
  // block never assigned a slot to, so they live at their own, much older code points.
  const letterlike = String.fromCodePoint(0x210c, 0x211c, 0x2124, 0x2102, 0x2115); // black-letter H, R, double-struck Z, C, N
  assert.equal(sanitizeForTts(letterlike), 'HRZCN', 'a letter with no slot in the math block still folds, from Letterlike Symbols');
  const planck = String.fromCodePoint(0x210f); // PLANCK CONSTANT OVER TWO PI
  assert.notEqual(sanitizeForTts(planck), 'h', 'a symbol that folds to a letter with a stroke through it is left alone, not mistaken for h');
});

test('a redaction or strike-through nested inside a same-named tag is removed whole, not truncated at the first closer', () => {
  assert.equal(
    sanitizeForTts('前面<span style="background-color:currentColor;color:currentColor">秘密<span style="font-weight:bold">名字</span>后半</span>后面'),
    '前面后面',
    'the words after the inner </span> are still inside the redaction and must not survive',
  );
  assert.equal(
    sanitizeForTts('前面<span style="background:currentColor"><span>整段</span>藏起来</span>后面'),
    '前面后面',
    'an unstyled span nested first is still inside the outer redaction',
  );
  assert.equal(sanitizeForTts('<s>第一<s>第二</s>第三</s>之后'), '之后', 'nested <s> of the same name is not mistaken for the outer one\'s own closer');
  assert.equal(sanitizeForTts('看得见<s>永远划不掉的字'), '看得见永远划不掉的字', 'a strike never closed is left exactly as it was, nothing guessed');
});

test('a redacted or struck-through block element leaves the line break it stood for, not a glued line', () => {
  assert.equal(
    sanitizeForTts('第一行<div style="background:currentColor">秘密</div>第二行'),
    '第一行\n第二行',
    'removed whole, the block still separates the text on either side of it',
  );
  assert.equal(sanitizeForTts('看得见<s>划掉的字</s>还看得见'), '看得见还看得见', 'an inline strike is not a line break, nothing is inserted for it');
});

test('markup detection and entity decoding stand on their own', () => {
  assert.equal(looksLikeMarkup('plain'), false);
  assert.equal(looksLikeMarkup('<b>x</b>'), true);
  assert.equal(looksLikeMarkup('&nbsp;'), true);
  assert.equal(decodeHtmlEntities('&unknown; &amp;'), '&unknown; &');
  assert.equal(decodeHtmlEntities('&#0;&#1114112;'), '&#0;&#1114112;', 'out-of-range codes stay as written');
});

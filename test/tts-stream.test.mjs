import test from 'node:test';
import assert from 'node:assert/strict';

import { speechMarkedLine } from '../core.js';
import { mergeStreamText, nextStreamCut, readableStreamText, takeStreamPieces } from '../tts-stream.js';

test('the first stretch of a reply may stop at a comma, once something follows it', () => {
  assert.equal(nextStreamCut('夕暮れの教室には', 0, { first: true }), -1, 'nothing safe yet');
  assert.equal(nextStreamCut('夕暮れの教室には、', 0, { first: true }), -1, 'the comma is the last character: more of the run may come');
  assert.equal(nextStreamCut('夕暮れの教室には、誰', 0, { first: true }), 9);
  assert.equal(nextStreamCut('她说，', 0, { first: true, firstMin: 6 }), -1, 'too short to be worth a request');
  assert.equal(nextStreamCut('窗外下着雨，她说', 0, { first: false }), -1, 'after the first stretch a comma is not an end');
});

test('an eager first stretch is cut the moment its sentence ends', () => {
  const eager = { first: true, eager: true };
  assert.equal(nextStreamCut('喂？', 0, eager), 2, 'a short sentence is not held back for firstMin');
  assert.equal(nextStreamCut('喂？！', 0, eager), 3, 'a run of end marks is taken whole');
  assert.equal(nextStreamCut('嗯。你来', 0, eager), 2);
  assert.equal(nextStreamCut('喂…', 0, eager), -1, 'an ellipsis so often runs on');
  assert.equal(nextStreamCut('喂……是我', 0, eager), 3, 'and once something follows it, it ends there');
  assert.equal(nextStreamCut('Wait.', 0, eager), -1, 'a dot too');
  assert.equal(nextStreamCut('喂，小林，', 0, eager), -1, 'a pause still wants firstMin');
  assert.equal(nextStreamCut('喂，是我啊，', 0, eager), 6, 'and then does not wait for what follows');
  assert.equal(nextStreamCut('今天天气不错。', 0, { eager: true }), -1, 'later stretches keep the careful rule');
  assert.equal(nextStreamCut('Mr. Smith is here.', 0, eager), -1, 'a dot is no short end: Mr. is not a sentence');
  assert.equal(nextStreamCut('It is 3.5 km. We', 0, eager), 13, 'a decimal point is not an end');
  assert.equal(nextStreamCut('It is 3.5 km away. We', 0, { minChars: 4 }), 18, 'not for later stretches either');
  assert.equal(nextStreamCut('？？？你', 0, eager), -1, 'end marks alone are not worth a request');
  const state = {};
  const pieces = takeStreamPieces([{ lineId: 1, text: '喂？' }], state, { eager: true });
  assert.deepEqual(pieces.map(piece => piece.text), ['喂？'], 'the first piece goes out at once');
  assert.deepEqual(takeStreamPieces([{ lineId: 1, text: '喂？是我。' }], state, { eager: true }), [], 'the next waits as before');
});

test('a sentence ends only outside quotations and speaker marks, and only once something follows it', () => {
  const text = '樱井推开门，笑着说：「你回来啦？今天好早。」她放下包。';
  assert.equal(nextStreamCut(text.slice(0, 16), 0, { minChars: 4 }), -1, 'inside the quotation');
  assert.equal(nextStreamCut(text, 0, { minChars: 4 }), -1, 'the end of the narration after it, with nothing after it yet');
  assert.equal(nextStreamCut(text, 0, { minChars: 4, final: true }), text.length, 'and once the line is finished');
  assert.equal(nextStreamCut(`${text}她`, 0, { minChars: 4 }), text.length);
  assert.equal(nextStreamCut('好。……', 0, { minChars: 1 }), -1, 'a run of end marks ends where the run does');
  const marked = speechMarkedLine('<say who="樱井" mood="开心">「好。」</say>她笑了。然后');
  assert.equal(nextStreamCut(marked.text, 0, { marks: marked.marks, minChars: 1 }), marked.text.indexOf('然后'), 'a mark that encloses its dialogue is a bracket');
});

test('a finished line is read to its end, however short, and however its quotations stand', () => {
  assert.equal(nextStreamCut('嗯', 0, { final: true }), 1);
  assert.equal(nextStreamCut('「还没说完', 0, { final: true }), 5);
  assert.equal(nextStreamCut('   ', 0, { final: true }), -1, 'nothing but spaces is nothing to read');
});

test('a reply fed a character at a time comes out whole, in order, with nothing twice', () => {
  const reply = [
    '夕暮れの教室には、誰もいなかった。窓から差し込む光が、机を淡く照らしている。',
    '桜井は振り返って、「来たんだね」と小さく笑った。',
    '「明日も、ここで会える？　約束してくれる？」',
    '「……うん。約束する」',
  ].join('\n');
  const state = {};
  const pieces = [];
  for (let length = 1; length <= reply.length; length += 1) {
    const lines = reply.slice(0, length).split('\n').map((text, index) => ({ lineId: index + 1, text }));
    pieces.push(...takeStreamPieces(lines, state));
  }
  const lines = reply.split('\n').map((text, index) => ({ lineId: index + 1, text }));
  pieces.push(...takeStreamPieces(lines, state, { final: true }));
  for (const lineId of [1, 2, 3, 4]) {
    assert.equal(pieces.filter(piece => piece.lineId === lineId).map(piece => piece.text).join(''), lines[lineId - 1].text, `line ${lineId} whole`);
  }
  assert.ok(pieces[0].text.length < 12, `the first stretch comes early: ${pieces[0].text}`);
  assert.ok(pieces.every(piece => !/^[」』”]/.test(piece.text)), 'no stretch starts on a closing mark');
  assert.ok(pieces.filter(piece => piece.lineId === 1).length >= 2, 'a long paragraph is read in stretches, not waited for');
});

test('what can be read of a reply still being written', () => {
  assert.equal(readableStreamText('<story_scene>\n她笑了。', { bodyTags: ['story_scene'] }), '<story_scene>\n她笑了。</story_scene>', 'an open body tag is closed');
  assert.equal(readableStreamText('<story_scene>她笑了。</story_scene><status>HP 10', { bodyTags: ['story_scene'], excludedTags: ['status'] }), '<story_scene>她笑了。</story_scene>', 'an open panel is cut off');
  assert.equal(readableStreamText('她笑了。<sta', {}), '她笑了。', 'half a tag goes');
  assert.equal(readableStreamText('<status>HP 10</status>她笑了。', { excludedTags: ['status'] }), '<status>HP 10</status>她笑了。', 'a closed panel is left to the usual extraction');
});

test('text handed over in chunks or whole comes to the same', () => {
  assert.equal(mergeStreamText('她笑', '她笑了。'), '她笑了。');
  assert.equal(mergeStreamText('她笑', '了。'), '她笑了。');
  assert.equal(mergeStreamText('', '她'), '她');
});

test('a mood or a speaker given for a whole line goes with every stretch cut from it', () => {
  const state = {};
  const pieces = takeStreamPieces([{ lineId: 1, text: '今天也来了啊，我等了很久。你呢？', mood: '高兴', who: '樱井' }], state, { final: true, eager: true });
  assert.ok(pieces.length >= 2, 'the line is cut');
  assert.ok(pieces.every(piece => piece.mood === '高兴' && piece.who === '樱井'));
  assert.equal(pieces.map(piece => piece.text).join(''), '今天也来了啊，我等了很久。你呢？');
  const plain = takeStreamPieces([{ lineId: 1, text: '好。' }], {}, { final: true });
  assert.equal('mood' in plain[0], false, 'a plain line carries nothing extra');
});

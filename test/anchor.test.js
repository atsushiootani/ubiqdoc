const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../extension/lib/anchor.js');

test('buildText と locate: ノードの境目は、始まりなら次のノード、終わりなら前のノードに寄せる', () => {
  const { full, starts } = A.buildText(['abc', 'def', 'gh']);
  assert.equal(full, 'abcdefgh');
  assert.deepEqual(starts, [0, 3, 6]);
  assert.deepEqual(A.locate(starts, 3, false), [1, 0]);
  assert.deepEqual(A.locate(starts, 3, true), [0, 3]);
  assert.deepEqual(A.locate(starts, 7, true), [2, 1]);
  assert.deepEqual(A.locate(starts, 0, false), [0, 0]);
});

test('findAnchor: 1 か所だけならそこ', () => {
  assert.deepEqual(A.findAnchor('更新時は楽観ロックを使う', { exact: '楽観ロック' }), { start: 4, end: 9 });
});

test('findAnchor: 何か所もあれば prefix が合うところ', () => {
  const full = '受注伝票の一覧。受注伝票を締める。';
  assert.deepEqual(A.findAnchor(full, { exact: '受注伝票', prefix: '一覧。' }), { start: 8, end: 12 });
});

test('findAnchor: 何か所もあれば suffix が合うところ', () => {
  const full = '受注伝票の一覧。受注伝票を締める。';
  assert.deepEqual(A.findAnchor(full, { exact: '受注伝票', suffix: 'を締め' }), { start: 8, end: 12 });
});

test('findAnchor: 空白の違い (改行・連続空白) は無視して探す', () => {
  const full = 'これは 楽観\n   ロック です';
  const span = A.findAnchor(full, { exact: '楽観 ロック' });
  assert.equal(full.slice(span.start, span.end), '楽観\n   ロック');
});

test('findAnchor: 無ければ null', () => {
  assert.equal(A.findAnchor('abc', { exact: 'xyz' }), null);
  assert.equal(A.findAnchor('abc', { exact: '' }), null);
  assert.equal(A.findAnchor('abc', null), null);
});

test('quoteAt: 前後 24 文字を取る', () => {
  const full = 'x'.repeat(30) + 'TARGET' + 'y'.repeat(30);
  const q = A.quoteAt(full, 30, 36);
  assert.equal(q.exact, 'TARGET');
  assert.equal(q.prefix, 'x'.repeat(24));
  assert.equal(q.suffix, 'y'.repeat(24));
});

test('overlaps: 接しているだけなら重ならない', () => {
  assert.equal(A.overlaps({ start: 0, end: 5 }, { start: 5, end: 8 }), false);
  assert.equal(A.overlaps({ start: 0, end: 5 }, { start: 4, end: 8 }), true);
  assert.equal(A.overlaps({ start: 2, end: 3 }, { start: 0, end: 8 }), true);
});

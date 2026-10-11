const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAnswer, parseConcepts, TagStream } = require('../core/answer.js');

test('HTML リーダーの形 (popover / section / link / edit) を今までどおり読む', () => {
  const r = parseAnswer('答えです。<ubiqdoc-popover target="selection">短い説明</ubiqdoc-popover>'
    + '<ubiqdoc-section target="受注" prefix="この" title="見出し"><p>本文</p></ubiqdoc-section>'
    + '<ubiqdoc-link target="selection" href="https://example.com/a"></ubiqdoc-link>'
    + '<ubiqdoc-edit exact="古い文" reason="誤り">新しい文</ubiqdoc-edit>');
  assert.equal(r.reply, '答えです。');
  assert.equal(r.annotations.length, 3);
  assert.deepEqual(r.annotations[0].target, 'selection');
  assert.equal(r.annotations[0].body, '短い説明');
  assert.deepEqual(r.annotations[1].target, { exact: '受注', prefix: 'この' });
  assert.equal(r.annotations[1].title, '見出し');
  assert.equal(r.annotations[2].href, 'https://example.com/a');
  assert.deepEqual(r.edits, [{ exact: '古い文', replaceWith: '新しい文', reason: '誤り' }]);
  assert.equal(r.parseError, undefined);
});

test('concept / category / source 属性を読む', () => {
  const r = parseAnswer('<ubiqdoc-popover target="楽観ロック" concept="optimistic-locking" category="personal" source="https://a.example/x  https://b.example/y">説明</ubiqdoc-popover>');
  const a = r.annotations[0];
  assert.deepEqual(a.concept, { key: 'optimistic-locking', category: 'personal' });
  assert.deepEqual(a.sourceUrls, ['https://a.example/x', 'https://b.example/y']);
});

test('category が無い・不正なら work に倒す', () => {
  const a = parseAnswer('<ubiqdoc-popover target="x" concept="k">b</ubiqdoc-popover>').annotations[0];
  assert.equal(a.concept.category, 'work');
  const b = parseAnswer('<ubiqdoc-popover target="x" concept="k" category="hobby">b</ubiqdoc-popover>').annotations[0];
  assert.equal(b.concept.category, 'work');
});

test('source の http(s) 以外は捨てる', () => {
  const a = parseAnswer('<ubiqdoc-popover target="x" source="javascript:alert(1) https://ok.example/">b</ubiqdoc-popover>').annotations[0];
  assert.deepEqual(a.sourceUrls, ['https://ok.example/']);
});

test('閉じていないタグは parseError にする', () => {
  const r = parseAnswer('答え<ubiqdoc-popover target="x">途中で切れた');
  assert.equal(r.annotations.length, 0);
  assert.equal(r.parseError, '閉じていないタグがある');
  assert.equal(r.reply, '答え');
});

test('parseConcepts: key と exact が無いものは捨て、importance は 1..5 に収める', () => {
  const cs = parseConcepts([
    '<ubiqdoc-concept key="optimistic-locking" label="楽観ロック" category="personal" importance="9" exact="楽観ロック" prefix="更新時は"/>',
    '<ubiqdoc-concept label="名前だけ" exact="名前だけ"/>',
    '<ubiqdoc-concept key="sales-order-slip" exact="受注伝票"/>',
  ].join('\n'));
  assert.equal(cs.length, 2);
  assert.deepEqual(cs[0], { key: 'optimistic-locking', label: '楽観ロック', category: 'personal', importance: 5, exact: '楽観ロック', prefix: '更新時は' });
  assert.deepEqual(cs[1], { key: 'sales-order-slip', label: '受注伝票', category: 'work', importance: 3, exact: '受注伝票', prefix: '' });
});

test('TagStream: 分割されて届いたタグを、閉じた時点で 1 回だけ返す', () => {
  const s = new TagStream();
  assert.deepEqual(s.push('<ubiqdoc-popover target="a">説'), []);
  assert.deepEqual(s.push('明</ubiqdoc-popover>\n<ubiqdoc-link target="b" href="https://x.example/"'), ['<ubiqdoc-popover target="a">説明</ubiqdoc-popover>']);
  assert.deepEqual(s.push('></ubiqdoc-link>'), ['<ubiqdoc-link target="b" href="https://x.example/"></ubiqdoc-link>']);
  assert.deepEqual(s.push(''), []);
});

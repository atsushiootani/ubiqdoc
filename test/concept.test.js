const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeKey } = require('../core/concept.js');

test('小文字にし、記号と空白を - にまとめる', () => {
  assert.equal(normalizeKey('Optimistic Locking'), 'optimistic-locking');
  assert.equal(normalizeKey('  optimistic_locking!! '), 'optimistic-locking');
  assert.equal(normalizeKey('optimistic--locking'), 'optimistic-locking');
});

test('全角英数字を半角にする', () => {
  assert.equal(normalizeKey('ＡＰＩ　Ｇａｔｅｗａｙ'), 'api-gateway');
});

test('英単語の末尾の複数形をそろえる', () => {
  assert.equal(normalizeKey('api gateways'), 'api-gateway');
  assert.equal(normalizeKey('policies'), 'policy');
  assert.equal(normalizeKey('databases'), 'database');
  assert.equal(normalizeKey('caches'), 'cache');
});

test('複数形でない語は削らない', () => {
  assert.equal(normalizeKey('status'), 'status');
  assert.equal(normalizeKey('analysis'), 'analysis');
  assert.equal(normalizeKey('class'), 'class');
  assert.equal(normalizeKey('gas'), 'gas');
});

test('日本語はそのまま残す', () => {
  assert.equal(normalizeKey('楽観ロック'), '楽観ロック');
  assert.equal(normalizeKey('受注 伝票'), '受注-伝票');
});

test('空や記号だけなら空文字', () => {
  assert.equal(normalizeKey(''), '');
  assert.equal(normalizeKey(null), '');
  assert.equal(normalizeKey('---'), '');
});

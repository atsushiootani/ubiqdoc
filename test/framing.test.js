const test = require('node:test');
const assert = require('node:assert/strict');
const { encode, Decoder } = require('../host/framing.js');

test('長さはバイト数 (UTF-8) のリトルエンディアン 4 バイト', () => {
  const b = encode({ t: 'あ' });
  assert.equal(b.readUInt32LE(0), Buffer.byteLength('{"t":"あ"}'));
});

test('分割されて届いても、1 通にまとまって届いても読める', () => {
  const got = [];
  const d = new Decoder((m) => got.push(m));
  const all = Buffer.concat([encode({ a: 1 }), encode({ b: '日本語' }), encode({ c: 3 })]);
  d.push(all.subarray(0, 3));
  d.push(all.subarray(3, 15));
  d.push(all.subarray(15));
  assert.deepEqual(got, [{ a: 1 }, { b: '日本語' }, { c: 3 }]);
});

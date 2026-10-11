const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pages, normalizeUrl, pageKey } = require('../host/pages.js');

test('normalizeUrl: # 以降と utm_* / pvs を落とし、ほかのクエリは残す', () => {
  assert.equal(normalizeUrl('https://www.notion.so/Page-abc123?pvs=4#h1'), 'https://www.notion.so/Page-abc123');
  assert.equal(normalizeUrl('https://github.com/o/r/issues/1?utm_source=x&tab=files'), 'https://github.com/o/r/issues/1?tab=files');
});

test('pageKey は 40 桁の hex で、正規化後が同じなら同じ', () => {
  const k = pageKey('https://www.notion.so/Page-abc123?pvs=4');
  assert.match(k, /^[0-9a-f]{40}$/);
  assert.equal(k, pageKey('https://www.notion.so/Page-abc123#x'));
});

test('作って保存し、別のインスタンスから読み直せる。本文も別に持つ', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ubq-pages-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const key = pageKey('https://example.com/a');
  const pages = new Pages(d);
  const p = pages.create(key, 'https://example.com/a', 'A');
  p.annotations.push({ id: 'a_01' });
  pages.save(key);
  pages.writeText(key, '本文');
  const again = new Pages(d);
  assert.equal(again.get(key).annotations.length, 1);
  assert.equal(again.readText(key), '本文');
  assert.equal(again.get(pageKey('https://example.com/none')), null);
});

test('不正なキーは断る', (t) => {
  const pages = new Pages(os.tmpdir());
  assert.throws(() => pages.get('../../etc'), /bad page key/);
});

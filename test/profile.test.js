const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Profile } = require('../host/profile.js');

function dir(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ubq-profile-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

test('足した概念は、キー・表記・別名のどれでも、正規化して照合できる', (t) => {
  const p = new Profile(dir(t)).load();
  p.add({ key: 'optimistic-locking', label: '楽観ロック', category: 'personal', aliases: ['optimistic lock'] });
  assert.equal(p.knows({ key: 'Optimistic Locking' }), true);
  assert.equal(p.knows({ key: 'x', label: '楽観ロック' }), true);
  assert.equal(p.knows({ key: 'optimistic_lock' }), true);
  assert.equal(p.knows({ key: 'pessimistic-locking' }), false);
});

test('区分ごとに別のファイルへ書き、読み直しても残る', (t) => {
  const d = dir(t);
  const p = new Profile(d).load();
  p.add({ key: 'idempotency', label: '冪等性', category: 'personal' });
  p.add({ key: 'sales-order-slip', label: '受注伝票', category: 'work' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'personal.json'), 'utf8')).concepts.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'work.json'), 'utf8')).concepts.length, 1);
  const again = new Profile(d).load();
  assert.equal(again.knows({ key: 'sales-order-slip' }), true);
  assert.deepEqual(again.list().work.map((c) => c.label), ['受注伝票']);
});

test('同じ概念を足し直すと、増やさずに別名を足す', (t) => {
  const p = new Profile(dir(t)).load();
  const a = p.add({ key: 'idempotency', label: '冪等性', category: 'personal' });
  const b = p.add({ key: 'Idempotency', label: 'べき等', category: 'personal' });
  assert.equal(a.id, b.id);
  assert.equal(p.list().personal.length, 1);
  assert.ok(p.list().personal[0].aliases.includes('べき等'));
  assert.equal(p.knows({ label: 'べき等' }), true);
});

test('不正な区分は work に倒す', (t) => {
  const p = new Profile(dir(t)).load();
  const c = p.add({ key: 'k', label: 'K', category: 'hobby' });
  assert.equal(c.category, 'work');
});

test('remove で外すと、照合されなくなる', (t) => {
  const p = new Profile(dir(t)).load();
  const c = p.add({ key: 'idempotency', label: '冪等性', category: 'personal' });
  assert.equal(p.remove(c.id).label, '冪等性');
  assert.equal(p.knows({ key: 'idempotency' }), false);
  assert.equal(p.remove('nope'), null);
});

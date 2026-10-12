const test = require('node:test');
const assert = require('node:assert/strict');
const ops = require('../host/page-ops.js');

const TEXT = '更新時は楽観ロックで競合を検知する。受注伝票は月末に締める。';
const noProfile = { knows: () => false };
const newPage = () => ({ annotations: [], pending: [], dropped: { noSource: 0 } });
const ann = (exact, extra = {}) => ({ turnId: 't_1', origin: 'proactive', kind: 'popover', anchor: { exact, prefix: '' }, body: '説明', sourceUrls: ['https://e.example/'], dependsOn: [], ...extra });

test('addAnnotation: 足すと a_01 から番号が振られ、shown になる', () => {
  const page = newPage();
  const r = ops.addAnnotation(page, TEXT, ann('楽観ロック'), { onConflict: 'skip' });
  assert.equal(r.status, 'added');
  assert.equal(r.annotation.id, 'a_01');
  assert.equal(r.annotation.state, 'shown');
  assert.equal(ops.addAnnotation(page, TEXT, ann('受注伝票'), { onConflict: 'skip' }).annotation.id, 'a_02');
});

test('addAnnotation: 本文に無ければ unanchored', () => {
  assert.equal(ops.addAnnotation(newPage(), TEXT, ann('存在しない語'), { onConflict: 'skip' }).status, 'unanchored');
});

test('addAnnotation: 同じ範囲なら重ねて足す (表示ではまとめて出す)', () => {
  const page = newPage();
  ops.addAnnotation(page, TEXT, ann('楽観ロック'), { onConflict: 'pending' });
  assert.equal(ops.addAnnotation(page, TEXT, ann('楽観ロック', { origin: 'ask' }), { onConflict: 'pending' }).status, 'added');
  assert.equal(page.annotations.length, 2);
});

test('addAnnotation: 一部だけ重なると、pending か skipped', () => {
  const page = newPage();
  ops.addAnnotation(page, TEXT, ann('楽観ロック'), { onConflict: 'pending' });
  const p = ops.addAnnotation(page, TEXT, ann('ロックで競合'), { onConflict: 'pending' });
  assert.equal(p.status, 'pending');
  assert.equal(page.pending[0].conflictWith, 'a_01');
  assert.equal(ops.addAnnotation(page, TEXT, ann('ロックで'), { onConflict: 'skip' }).status, 'skipped');
  assert.equal(page.pending.length, 1);
});

test('selectConcepts: 知ってる・表示中・重複を落とし、importance の高い順に残りの枠だけ取る', () => {
  const page = newPage();
  for (let i = 0; i < 18; i++) page.annotations.push({ id: `a_${i}`, origin: 'proactive', state: 'shown', concept: { key: `k${i}` }, anchor: { exact: 'x' } });
  page.annotations.push({ id: 'a_x', origin: 'proactive', state: 'shown', concept: { key: 'shown-one' }, anchor: { exact: 'x' } });
  const profile = { knows: (c) => c.key === 'known-one' };
  const picked = ops.selectConcepts([
    { key: 'low', importance: 1 },
    { key: 'known-one', importance: 5 },
    { key: 'Shown One', importance: 5 },
    { key: 'high', importance: 4 },
    { key: 'HIGH', importance: 4 },
  ], { page, profile });
  assert.deepEqual(picked.map((c) => c.key), ['high']);
});

test('selectConcepts: 「知ってる」で隠れた先回りの補足は枠に数えない', () => {
  const page = newPage();
  for (let i = 0; i < 20; i++) page.annotations.push({ id: `a_${i}`, origin: 'proactive', state: 'shown', concept: { key: `k${i}` }, anchor: { exact: 'x' } });
  const profile = { knows: (c) => c.key === 'k0' };
  assert.deepEqual(ops.selectConcepts([{ key: 'new', importance: 3 }], { page, profile }).map((c) => c.key), ['new']);
});

test('selectConcepts: ドラッグして聞いた補足は枠に数えない', () => {
  const page = newPage();
  for (let i = 0; i < 20; i++) page.annotations.push({ id: `a_${i}`, origin: 'ask', state: 'shown', anchor: { exact: 'x' } });
  assert.equal(ops.selectConcepts([{ key: 'new', importance: 3 }], { page, profile: noProfile }).length, 1);
});

test('reanchor: 見つからなくなった補足を orphaned にする', () => {
  const page = newPage();
  ops.addAnnotation(page, TEXT, ann('楽観ロック'), { onConflict: 'skip' });
  ops.addAnnotation(page, TEXT, ann('受注伝票'), { onConflict: 'skip' });
  assert.deepEqual(ops.reanchor(page, '更新時は楽観ロックで競合を検知する。'), ['a_02']);
  assert.equal(page.annotations[1].state, 'orphaned');
});

test('undoTurn: その回の補足と承認待ちを消す', () => {
  const page = newPage();
  ops.addAnnotation(page, TEXT, ann('楽観ロック', { turnId: 't_a' }), { onConflict: 'pending' });
  ops.addAnnotation(page, TEXT, ann('受注伝票', { turnId: 't_b' }), { onConflict: 'pending' });
  ops.addAnnotation(page, TEXT, ann('ロックで競合', { turnId: 't_b' }), { onConflict: 'pending' });
  assert.equal(ops.undoTurn(page, 't_b'), 2);
  assert.deepEqual(page.annotations.map((a) => a.id), ['a_01']);
  assert.equal(page.pending.length, 0);
});

test('convert: ポップオーバー → セクション → ポップオーバー → セクションで元の見出しと本文に戻る', () => {
  const page = newPage();
  const { annotation } = ops.addAnnotation(page, TEXT, ann('受注伝票', { kind: 'section', title: '受注伝票とは', body: '<p>締めの<strong>単位</strong></p>' }), { onConflict: 'skip' });
  assert.equal(ops.convert(page, annotation.id, 'popover'), true);
  assert.equal(annotation.kind, 'popover');
  assert.equal(annotation.body, '締めの 単位');
  assert.equal(ops.convert(page, annotation.id, 'section'), true);
  assert.equal(annotation.title, '受注伝票とは');
  assert.equal(annotation.body, '<p>締めの<strong>単位</strong></p>');
  assert.equal(ops.convert(page, annotation.id, 'section'), false);
});

test('convert: 元からポップオーバーなら、語句を見出しにして段落で包む', () => {
  const page = newPage();
  const { annotation } = ops.addAnnotation(page, TEXT, ann('楽観ロック', { body: 'a < b' }), { onConflict: 'skip' });
  ops.convert(page, annotation.id, 'section');
  assert.equal(annotation.title, '楽観ロック');
  assert.equal(annotation.body, '<p>a &lt; b</p>');
});

test('approve: 承認待ちをセクションとして足す / reject は捨てる', () => {
  const page = newPage();
  ops.addAnnotation(page, TEXT, ann('楽観ロック'), { onConflict: 'pending' });
  ops.addAnnotation(page, TEXT, ann('ロックで競合', { body: '説明2' }), { onConflict: 'pending' });
  ops.addAnnotation(page, TEXT, ann('ロックで', { body: '説明3' }), { onConflict: 'pending' });
  const [p1, p2] = page.pending;
  const a = ops.approve(page, p1.id);
  assert.equal(a.kind, 'section');
  assert.equal(a.body, '<p>説明2</p>');
  assert.equal(ops.reject(page, p2.id), true);
  assert.equal(page.pending.length, 0);
  assert.equal(ops.approve(page, 'nope'), null);
});

test('discardOrphan: orphaned だけを消せる', () => {
  const page = newPage();
  ops.addAnnotation(page, TEXT, ann('受注伝票'), { onConflict: 'skip' });
  assert.equal(ops.discardOrphan(page, 'a_01'), false);
  ops.reanchor(page, '別の本文');
  assert.equal(ops.discardOrphan(page, 'a_01'), true);
  assert.equal(page.annotations.length, 0);
});

test('view: 知っている概念の補足には hidden を立て、orphaned は分けて出す', () => {
  const page = { ...newPage(), url: 'u', title: 't', model: 'haiku' };
  ops.addAnnotation(page, TEXT, ann('楽観ロック', { concept: { key: 'optimistic-locking', category: 'personal' } }), { onConflict: 'skip' });
  ops.addAnnotation(page, TEXT, ann('受注伝票'), { onConflict: 'skip' });
  ops.reanchor(page, '更新時は楽観ロックで競合を検知する。');
  const v = ops.view(page, { knows: (c) => c.key === 'optimistic-locking' }, 'k');
  assert.equal(v.annotations.length, 1);
  assert.equal(v.annotations[0].hidden, true);
  assert.equal(v.orphaned.length, 1);
  assert.equal(v.key, 'k');
});

test('conceptOf / view: concept の無い補足は選んだ語句で照合し、知っていれば hidden', () => {
  const page = newPage();
  ops.addAnnotation(page, TEXT, ann('受注伝票', { origin: 'ask', sourceUrls: [] }), { onConflict: 'pending' });
  const a = page.annotations[0];
  assert.equal(a.concept, undefined);
  assert.deepEqual(ops.conceptOf(a), { key: '受注伝票', label: '受注伝票' });
  const profile = { knows: (c) => c.key === '受注伝票' };
  assert.equal(ops.isVisible(a, profile), false);
  assert.equal(ops.view(page, profile, 'k').annotations[0].hidden, true);
  assert.equal(ops.view(page, noProfile, 'k').annotations[0].hidden, false);
  assert.equal(page.annotations[0].concept, undefined);
});

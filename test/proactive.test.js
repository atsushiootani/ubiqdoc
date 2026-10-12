const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pages, pageKey } = require('../host/pages.js');
const { Bases } = require('../host/bases.js');
const { runProactive } = require('../host/proactive.js');

const TEXT = '更新時は楽観ロックで競合を検知する。受注伝票は月末に締める。冪等性も要る。';

function setup(t, { links = [] } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ubq-pro-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const pages = new Pages(d);
  const key = pageKey('https://example.com/p');
  const page = pages.create(key, 'https://example.com/p', 'P');
  page.links = links;
  pages.writeText(key, TEXT);
  pages.save(key);
  return { pages, key };
}

// 呼ばれた引数を残し、プロンプトの種類で答えを返す run
function fakeRun(answers, calls = []) {
  let n = 0;
  return async (args, prompt, { onDelta } = {}) => {
    calls.push({ args, prompt });
    const kind = prompt.startsWith('これから') ? 'base' : prompt.startsWith('[抜き出し]') ? 'extract' : prompt.startsWith('[補足を書く]') ? 'write' : 'other';
    const result = answers[kind] instanceof Error ? (() => { throw answers[kind]; })() : (answers[kind] ?? 'OK');
    if (onDelta) for (let i = 0; i < result.length; i += 7) onDelta(result.slice(i, i + 7));
    n++;
    return { session_id: `s_${n}`, result };
  };
}

const CONCEPTS = [
  '<ubiqdoc-concept key="optimistic-locking" label="楽観ロック" category="personal" importance="4" exact="楽観ロック" prefix="更新時は"/>',
  '<ubiqdoc-concept key="sales-order-slip" label="受注伝票" category="work" importance="5" exact="受注伝票" prefix="。"/>',
  '<ubiqdoc-concept key="idempotency" label="冪等性" category="personal" importance="2" exact="冪等性" prefix="。"/>',
].join('\n');

const WRITES = [
  '<ubiqdoc-popover target="楽観ロック" prefix="更新時は" concept="optimistic-locking" category="personal" source="https://en.wikipedia.org/wiki/Optimistic_concurrency_control">楽観ロックの説明</ubiqdoc-popover>',
  '<ubiqdoc-section target="受注伝票" prefix="。" concept="sales-order-slip" category="work" title="受注伝票とは"><p>説明</p></ubiqdoc-section>',
  '<ubiqdoc-popover target="冪等性" concept="idempotency" category="personal" source="https://en.wikipedia.org/wiki/Idempotence">冪等性の説明</ubiqdoc-popover>',
  '<ubiqdoc-popover target="月末" concept="month-end" category="work" source="https://e.example/">頼んでいない概念</ubiqdoc-popover>',
].join('\n');

test('3 段: 出典のある補足だけを足し、出典の無いものは数え、頼んでいない概念は捨てる', async (t) => {
  const { pages, key } = setup(t);
  const calls = [];
  const bases = new Bases({ pages, run: fakeRun({ extract: CONCEPTS, write: WRITES }, calls) });
  const events = [];
  const r = await runProactive({ key, pages, bases, profile: { knows: () => false }, emit: (e, d) => events.push([e, d]) });
  assert.equal(r.made, 2);
  const page = pages.get(key);
  assert.deepEqual(page.annotations.map((a) => a.anchor.exact), ['楽観ロック', '冪等性']);
  assert.equal(page.annotations[0].concept.category, 'personal');
  assert.equal(page.annotations[0].origin, 'proactive');
  assert.equal(page.dropped.noSource, 1);
  assert.equal(events.filter(([e]) => e === 'annotation').length, 2);
  assert.deepEqual(events.at(-1), ['progress', { stage: 'done', made: 2, total: 3 }]);
  // ベース 1 回、抜き出しと補足書きはどちらも fork
  assert.equal(calls.filter((c) => c.prompt.startsWith('これから')).length, 1);
  assert.ok(calls.filter((c) => !c.prompt.startsWith('これから')).every((c) => c.args.includes('--fork-session')));
});

test('知っている概念は補足書きに回さない', async (t) => {
  const { pages, key } = setup(t);
  const calls = [];
  const bases = new Bases({ pages, run: fakeRun({ extract: CONCEPTS, write: '' }, calls) });
  await runProactive({ key, pages, bases, profile: { knows: (c) => c.key === 'optimistic-locking' }, emit: () => {} });
  const write = calls.find((c) => c.prompt.startsWith('[補足を書く]'));
  assert.ok(!write.prompt.includes('optimistic-locking'));
  assert.ok(write.prompt.includes('sales-order-slip'));
});

test('候補が無ければ補足書きを呼ばない', async (t) => {
  const { pages, key } = setup(t);
  const calls = [];
  const bases = new Bases({ pages, run: fakeRun({ extract: '' }, calls) });
  const r = await runProactive({ key, pages, bases, profile: { knows: () => false }, emit: () => {} });
  assert.equal(r.made, 0);
  assert.equal(calls.some((c) => c.prompt.startsWith('[補足を書く]')), false);
});

test('Bases: 同時に頼まれてもベースは 1 回だけ作り、本文が変わったら作り直す', async (t) => {
  const { pages, key } = setup(t);
  const calls = [];
  const bases = new Bases({ pages, run: fakeRun({}, calls) });
  const [a, b] = await Promise.all([bases.ensure(key), bases.ensure(key)]);
  assert.equal(a, b);
  assert.equal(calls.length, 1);
  assert.equal(await bases.ensure(key), a);
  pages.writeText(key, '別の本文');
  assert.notEqual(await bases.ensure(key), a);
  assert.equal(calls.length, 2);
});

test('Bases: ベースのセッションが消えていたら作り直して 1 回だけやり直す', async (t) => {
  const { pages, key } = setup(t);
  let first = true;
  const calls = [];
  const run = async (args, prompt) => {
    calls.push(prompt.slice(0, 6));
    if (args.includes('--fork-session') && first) { first = false; throw new Error('No conversation found with session ID: s_1'); }
    return { session_id: `s_${calls.length}`, result: 'OK' };
  };
  const bases = new Bases({ pages, run });
  const r = await bases.fork(key, '[抜き出し]\nx');
  assert.equal(r.result, 'OK');
  assert.equal(calls.filter((c) => c.startsWith('これから')).length, 2);
});

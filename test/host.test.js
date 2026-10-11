const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { encode, Decoder } = require('../host/framing.js');

const ROOT = path.join(__dirname, '..');
const FAKE = path.join(__dirname, 'fixtures', 'fake-claude.js');
const URL1 = 'https://www.notion.so/Spec-0123abcd';
const TEXT = '更新時は楽観ロックで競合を検知する。受注伝票は月末に締める。在庫引当は夜間に行う。';
const LINKS = [{ text: '受注の仕様', href: 'https://www.notion.so/Order-spec-99' }];

function startHost(t, dataDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ubq-host-'));
  const dir = dataDir || path.join(tmp, 'data');
  const fakeDir = path.join(tmp, 'fake');
  const child = spawn(process.execPath, [path.join(ROOT, 'host', 'host.js')], {
    env: { ...process.env, UBIQDOC_DATA_DIR: dir, UBIQDOC_CLAUDE_BIN: FAKE, UBIQDOC_FAKE_DIR: fakeDir },
  });
  t.after(() => { child.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });
  const waiting = new Map();
  let seq = 0;
  const dec = new Decoder((m) => {
    const w = waiting.get(m.id);
    if (!w) return;
    if (m.type === 'event') { w.events.push([m.event, m.data]); return; }
    waiting.delete(m.id);
    m.type === 'result' ? w.resolve({ data: m.data, events: w.events }) : w.reject(new Error(m.message));
  });
  child.stdout.on('data', (c) => dec.push(c));
  const req = (type, payload = {}) => new Promise((resolve, reject) => {
    const id = `q${++seq}`;
    waiting.set(id, { resolve, reject, events: [] });
    child.stdin.write(encode({ ...payload, id, type }));
  });
  const calls = () => {
    const f = path.join(fakeDir, 'calls.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map(JSON.parse) : [];
  };
  return { req, calls, dataDir: dir };
}

const open = (h, extra = {}) => h.req('open-page', { url: URL1, title: '仕様', text: TEXT, links: LINKS, model: 'haiku', ...extra });

test('開く → 先回りの補足 → もう一度開いても claude を呼ばない', async (t) => {
  const h = startHost(t);
  assert.equal((await h.req('hello')).data.ok, true);
  const r = await open(h);
  const anns = r.data.view.annotations;
  assert.deepEqual(anns.map((a) => a.anchor.exact).sort(), ['受注伝票', '楽観ロック']);
  assert.equal(anns.find((a) => a.anchor.exact === '受注伝票').sourceUrls[0], LINKS[0].href);
  assert.ok(r.events.some(([e]) => e === 'annotation'));
  assert.ok(r.events.some(([e, d]) => e === 'progress' && d.stage === 'done'));
  const n = h.calls().length;
  const again = await open(h);
  assert.equal(again.data.view.annotations.length, 2);
  assert.equal(h.calls().length, n);
});

test('同時に 2 回開いても、抜き出しは 1 回だけ', async (t) => {
  const h = startHost(t);
  await Promise.all([open(h), open(h)]);
  assert.equal(h.calls().filter((c) => c.head.startsWith('[抜き出し]')).length, 1);
});

test('本文にリンクが無いと、業務用語の補足は出典なしで捨てて数える', async (t) => {
  const h = startHost(t);
  const r = await open(h, { links: [] });
  assert.deepEqual(r.data.view.annotations.map((a) => a.anchor.exact), ['楽観ロック']);
  assert.equal(r.data.view.dropped.noSource, 1);
});

test('知ってる → 隠れる → 戻す → また出る', async (t) => {
  const h = startHost(t);
  const v = (await open(h)).data.view;
  const target = v.annotations.find((a) => a.anchor.exact === '楽観ロック');
  const k = await h.req('mark-known', { url: URL1, annotationId: target.id });
  assert.equal(k.data.view.annotations.find((a) => a.id === target.id).hidden, true);
  assert.equal((await h.req('profile-list')).data.personal.length, 1);
  await h.req('unmark-known', { conceptId: k.data.conceptId });
  const after = (await h.req('page-view', { url: URL1 })).data.view;
  assert.equal(after.annotations.find((a) => a.id === target.id).hidden, false);
});

test('本文が変わると、消えた語句の補足は orphaned になる', async (t) => {
  const h = startHost(t);
  await open(h);
  const r = await open(h, { text: '更新時は楽観ロックで競合を検知する。' });
  assert.deepEqual(r.data.view.orphaned.map((a) => a.anchor.exact), ['受注伝票']);
  assert.deepEqual(r.data.view.annotations.map((a) => a.anchor.exact), ['楽観ロック']);
});

test('ドラッグして聞く → 補足が足される → 取り消す', async (t) => {
  const h = startHost(t);
  await open(h);
  const quote = { exact: '在庫引当', prefix: '月末に締める。', suffix: 'は夜間に' };
  const r = await h.req('ask', { url: URL1, windowId: 'w_1', turnId: 't_ask', selection: '在庫引当', quote, context: TEXT, asides: '', question: '説明して' });
  assert.equal(r.data.reply, '説明です。');
  assert.equal(r.data.added.length, 1);
  assert.equal(r.data.added[0].origin, 'ask');
  assert.ok(r.events.some(([e]) => e === 'delta'));
  const follow = await h.req('ask', { url: URL1, windowId: 'w_1', sessionId: r.data.sessionId, turnId: 't_ask2', selection: '在庫引当', quote, asides: '', question: 'もっと' });
  assert.equal(follow.data.reply, '説明です。');
  const u = await h.req('undo-turn', { url: URL1, turnId: 't_ask' });
  assert.equal(u.data.view.annotations.filter((a) => a.turnId === 't_ask').length, 0);
});

test('セクション ↔ ポップオーバーの変換', async (t) => {
  const h = startHost(t);
  const v = (await open(h)).data.view;
  const sec = v.annotations.find((a) => a.kind === 'section');
  const r = await h.req('convert', { url: URL1, annotationId: sec.id, to: 'popover' });
  assert.equal(r.data.view.annotations.find((a) => a.id === sec.id).kind, 'popover');
});

test('data/ が git の無視対象でなければ、hello が理由を返し、ほかの要求は断る', async (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ubq-host-git-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const h = startHost(t, path.join(repo, 'data'));
  const hello = (await h.req('hello')).data;
  assert.equal(hello.ok, false);
  assert.match(hello.reason, /無視対象/);
  await assert.rejects(open(h), /無視対象/);
});

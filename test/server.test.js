const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 18911;
const base = `http://127.0.0.1:${PORT}`;

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${base}/api/docs`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
}

test('HTML リーダー: 開く → ベース → 聞く → 注釈が返る', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ubq-server-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, UBIQDOC_PORT: String(PORT), UBIQDOC_DATA_DIR: path.join(tmp, 'data'),
      UBIQDOC_CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'), UBIQDOC_FAKE_DIR: path.join(tmp, 'fake') },
    stdio: 'ignore',
  });
  t.after(() => { child.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });
  await waitUp();

  const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const opened = await (await post('/api/open', { path: path.join(__dirname, 'fixtures', 'doc.html') })).json();
  assert.ok(opened.id);

  for (let i = 0; i < 50; i++) {
    const d = await (await fetch(`${base}/api/doc/${opened.id}`)).json();
    if (d.base === 'ready') break;
    await new Promise((r) => setTimeout(r, 100));
  }

  const res = await post('/api/ask', { docId: opened.id, windowId: 'w_test', turnId: 't_test', selection: '楽観ロック', context: '更新時は楽観ロックで競合を検知する。', asides: '', question: '説明して' });
  const text = await res.text();
  const done = text.split('\n\n').find((c) => c.startsWith('event: done'));
  assert.ok(done, text);
  const data = JSON.parse(done.split('\ndata: ')[1]);
  assert.equal(data.reply, '説明です。');
  assert.equal(data.annotations.length, 1);
  assert.equal(data.annotations[0].kind, 'popover');
});

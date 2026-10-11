const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { extensionId } = require('../host/extension-id.js');
const { encode, Decoder } = require('../host/framing.js');

const ROOT = path.join(__dirname, '..');

test('extensionId: 32 文字の a〜p で、同じ鍵なら同じ', () => {
  const key = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8')).key;
  const id = extensionId(key);
  assert.match(id, /^[a-p]{32}$/);
  assert.equal(id, extensionId(key));
});

test('install.sh: 登録ファイルとラッパを作り、ラッパ経由で host が答える', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ubq-install-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const env = {
    ...process.env,
    UBIQDOC_NMH_DIR: path.join(tmp, 'nmh'),
    UBIQDOC_RUN_SH: path.join(tmp, 'run.sh'),
    UBIQDOC_CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'),
    UBIQDOC_DATA_DIR: path.join(tmp, 'data'),
  };
  execFileSync('bash', [path.join(ROOT, 'host', 'install.sh')], { env, stdio: 'pipe' });

  const reg = JSON.parse(fs.readFileSync(path.join(tmp, 'nmh', 'com.atsushiootani.ubiqdoc.json'), 'utf8'));
  const key = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8')).key;
  assert.equal(reg.name, 'com.atsushiootani.ubiqdoc');
  assert.equal(reg.path, path.join(tmp, 'run.sh'));
  assert.deepEqual(reg.allowed_origins, [`chrome-extension://${extensionId(key)}/`]);

  // Chrome と同じく、ログインシェルの PATH を持たない環境から起動する
  const child = spawn(reg.path, [], { env: { HOME: os.homedir(), PATH: '/usr/bin:/bin' } });
  t.after(() => child.kill());
  const got = await new Promise((resolve) => {
    const dec = new Decoder(resolve);
    child.stdout.on('data', (c) => dec.push(c));
    child.stdin.write(encode({ id: 'x', type: 'hello' }));
  });
  assert.deepEqual(got, { id: 'x', type: 'result', data: { ok: true } });
});

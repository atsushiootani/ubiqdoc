// extension/background.js を偽の chrome の上で動かし、先回りの進み具合とバッジを確かめる
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'extension', 'background.js'), 'utf8');

function load(opts = {}) {
  const log = [];
  const on = {};
  const ev = (name) => ({ addListener: (f) => { if (name) on[name] = f; } });
  const ok = () => Promise.resolve();
  const chrome = {
    runtime: {
      connectNative: () => ({ onMessage: ev('host'), onDisconnect: ev(), postMessage: (m) => log.push(['post', m]) }),
      onConnect: ev('connect'), onInstalled: ev(), onStartup: ev(),
      sendMessage: (m) => { log.push(['status', m]); return ok(); },
    },
    action: {
      setBadgeText: (o) => { log.push(['badge', o.text]); return ok(); },
      setBadgeBackgroundColor: (o) => { log.push(['color', o.color]); return ok(); },
      onClicked: ev('clicked'),
    },
    permissions: { onAdded: ev(), onRemoved: ev() },
    storage: { onChanged: ev(), local: { get: async () => ({}) } },
    tabs: { onRemoved: ev(), onUpdated: ev('updated'), query: async () => [], sendMessage: (id, m, o) => { log.push(['tab', m, o || null]); return ok(); } },
    scripting: {
      executeScript: (o) => {
        log.push(['exec', o.files ? { files: true, allFrames: !!o.target.allFrames } : { func: true, allFrames: !!o.target.allFrames }]);
        if (opts.injectFails && o.files) return Promise.reject(new Error('Cannot access contents of the page'));
        return Promise.resolve(o.func ? (opts.frames || []) : []);
      },
    },
    sidePanel: { open: ok },
  };
  vm.runInNewContext(SRC, { chrome, importScripts: () => {}, self: { ubqAllowlist: {} }, console, setTimeout: () => 0, clearTimeout: () => {} });
  const port = { name: 'ubq', sender: { tab: { id: 7 } }, onMessage: { addListener: (f) => { port.send = f; } }, postMessage: (m) => log.push(['reply', m]) };
  on.connect(port);
  return { log, on, port };
}

// vm の中で作られたオブジェクトは prototype が別物なので、JSON に通してから比べる
const plain = (x) => JSON.parse(JSON.stringify(x));

test('先回りが失敗すると、バッジが赤い ! になり、サイドパネルに error が届く。別のページに移るとバッジが消える', async () => {
  const { log, on, port } = load();
  await port.send({ id: 'c1', type: 'open-page', url: 'https://e.example/' });
  const id = log.find((l) => l[0] === 'post')[1].id;
  on.host({ id, type: 'event', event: 'progress', data: { stage: 'write', made: 1, total: 3 } });
  log.length = 0;
  on.host({ id, type: 'error', message: 'claude が落ちました' });
  assert.deepEqual(plain(log.filter((l) => l[0] === 'badge' || l[0] === 'color')), [['badge', '!'], ['color', '#c5221f']]);
  assert.deepEqual(plain(log.find((l) => l[0] === 'status')[1]), { type: 'status', tabId: 7, status: { stage: 'error', message: 'claude が落ちました' } });
  log.length = 0;
  on.updated(7, { url: 'https://e.example/other' });
  assert.deepEqual(plain(log), [['badge', '']]);
});

test('ツールバーのボタンは全フレームに差し込むだけで、先回りの補足は頼まない', async () => {
  const { log, on } = load();
  await on.clicked({ id: 3 });
  assert.deepEqual(plain(log.filter((l) => l[0] === 'exec')), [['exec', { files: true, allFrames: true }]]);
  assert.equal(log.filter((l) => l[0] === 'tab').length, 0);
});

test('「補足を付ける」(run-tab) は、本文がいちばん多いフレームにだけ run を送る', async () => {
  const { log, port } = load({ frames: [{ frameId: 0, result: 120 }, { frameId: 4, result: 9000 }, { frameId: 5, result: -1 }] });
  await port.send({ id: 's1', type: 'run-tab', tabId: 7, force: true });
  assert.deepEqual(plain(log.filter((l) => l[0] === 'tab')), [['tab', { type: 'run', force: true }, { frameId: 4 }]]);
  assert.deepEqual(plain(log.find((l) => l[0] === 'reply')[1]), { id: 's1', type: 'result', data: { frameId: 4 } });
});

test('差し込めないページで run-tab を押すと、ツールバーのボタンを促すエラーを返す', async () => {
  const { log, port } = load({ injectFails: true });
  await port.send({ id: 's1', type: 'run-tab', tabId: 7, force: false });
  const r = plain(log.find((l) => l[0] === 'reply')[1]);
  assert.equal(r.type, 'error');
  assert.match(r.message, /ツールバーの ubiqdoc ボタン/);
});

test('iframe の文書が前の補足を読み込んだら、その URL をタブの文書として返す (tab-doc)', async () => {
  const { log, on, port } = load();
  await port.send({ id: 'c1', type: 'page-view', url: 'http://127.0.0.1:8787/tech/api/article-raw?id=1' });
  const id = log.find((l) => l[0] === 'post')[1].id;
  on.host({ id, type: 'result', data: { view: { annotations: [] } } });
  log.length = 0;
  await port.send({ id: 's1', type: 'tab-doc', tabId: 7 });
  assert.deepEqual(plain(log.find((l) => l[0] === 'reply')[1]), { id: 's1', type: 'result', data: 'http://127.0.0.1:8787/tech/api/article-raw?id=1' });
});

test('別のページに移ったあとに届いた、前のページの進み具合はバッジに出さない', async () => {
  const { log, on, port } = load();
  await port.send({ id: 'c1', type: 'open-page', url: 'https://e.example/a' });
  const id = log.find((l) => l[0] === 'post')[1].id;
  on.updated(7, { url: 'https://e.example/b' });
  log.length = 0;
  on.host({ id, type: 'event', event: 'progress', data: { stage: 'write', made: 2, total: 3 } });
  on.host({ id, type: 'error', message: '前のページの失敗' });
  assert.deepEqual(plain(log.filter((l) => l[0] === 'badge' || l[0] === 'status')), []);
});

test('# だけが変わった遷移では、進み具合を消さない', async () => {
  const { log, on, port } = load();
  await port.send({ id: 'c1', type: 'open-page', url: 'https://e.example/a' });
  const id = log.find((l) => l[0] === 'post')[1].id;
  on.host({ id, type: 'event', event: 'progress', data: { stage: 'write', made: 1, total: 3 } });
  log.length = 0;
  on.updated(7, { url: 'https://e.example/a#heading' });
  assert.deepEqual(plain(log.filter((l) => l[0] === 'badge')), []);
  on.host({ id, type: 'event', event: 'progress', data: { stage: 'write', made: 2, total: 3 } });
  assert.deepEqual(plain(log.filter((l) => l[0] === 'badge')), [['badge', '2/3']]);
});

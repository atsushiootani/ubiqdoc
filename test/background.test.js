// extension/background.js を偽の chrome の上で動かし、先回りの進み具合とバッジを確かめる
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'extension', 'background.js'), 'utf8');

function load() {
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
    tabs: { onRemoved: ev(), onUpdated: ev('updated'), query: async () => [], sendMessage: (id, m) => { log.push(['tab', m]); return ok(); } },
    scripting: { executeScript: ok },
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

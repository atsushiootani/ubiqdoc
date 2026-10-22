// host との接続を 1 本だけ張り、content script とサイドパネルからの要求を中継する。
// 全タブの要求がこの 1 本を通るので host のプロセスは 1 つになり、プロフィールへの書き込みは順に並ぶ
importScripts('lib/allowlist.js');
const { DEFAULT_ALLOWLIST, FALLBACK_ROOT, entryFor } = self.ubqAllowlist;

const HOST = 'com.atsushiootani.ubiqdoc';
const CONTENT_FILES = ['lib/anchor.js', 'lib/allowlist.js', 'content/text.js', 'content/overlay.js', 'content/render.js', 'content/ask.js', 'content/main.js'];
const IDLE_MS = 60 * 1000;
const MUTATIONS = new Set(['mark-known', 'unmark-known', 'profile-remove', 'undo-turn', 'convert', 'approve', 'reject', 'discard-orphan']);
const PROFILE_MUTATIONS = new Set(['mark-known', 'unmark-known', 'profile-remove']);

let nativePort = null;
let seq = 0;
let idleTimer = null;
const waiting = new Map();      // host への要求 id → { clientId, tabId, reply, req }
const tabStatus = new Map();    // tabId → 最後の progress
const tabDoc = new Map();       // tabId → いま開いている文書の URL (# より前)。前のページの進み具合を捨てるのに使う
const docOf = (u) => String(u || '').split('#')[0];

function hostErrorText(err) {
  if (/not found|Specified native messaging host|forbidden/i.test(err)) return 'host が未登録です。ubiqdoc のリポジトリで host/install.sh を実行してください';
  // 起動直後に落ちた。node や claude の場所が変わったときに多い (理由は run.sh が logs/host-launch.log に書く)
  if (/exited/i.test(err)) return 'host が起動できませんでした。ubiqdoc のリポジトリで host/install.sh を実行し直してください (理由は logs/host-launch.log)';
  return err;
}

function connectHost() {
  if (nativePort) return nativePort;
  nativePort = chrome.runtime.connectNative(HOST);
  nativePort.onMessage.addListener(onHostMessage);
  nativePort.onDisconnect.addListener(() => {
    const err = hostErrorText(chrome.runtime.lastError?.message || 'host が終了しました');
    for (const w of waiting.values()) w.reply({ id: w.clientId, type: 'error', message: err });
    waiting.clear();
    nativePort = null;
  });
  return nativePort;
}

// 処理が無いまま IDLE_MS たったら接続を閉じる (host も終わる)。接続中は service worker が止まらない
function scheduleIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!waiting.size && nativePort) { nativePort.disconnect(); nativePort = null; }
  }, IDLE_MS);
}

function updateBadge(tabId, s) {
  const text = s.stage === 'extract' ? '…' : s.stage === 'write' ? `${s.made}/${s.total}` : s.stage === 'error' ? '!' : '';
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: s.stage === 'error' ? '#c5221f' : '#1a73e8' }).catch(() => {});
}

function setTabStatus(tabId, st) {
  tabStatus.set(tabId, st);
  updateBadge(tabId, st);
  chrome.runtime.sendMessage({ type: 'status', tabId, status: st }).catch(() => {});
}

async function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
  for (const t of await chrome.tabs.query({})) chrome.tabs.sendMessage(t.id, msg).catch(() => {});
}

function onHostMessage(msg) {
  const w = waiting.get(msg.id);
  if (!w) return;
  // SPA で別のページに移ったあとに届いた、前のページの進み具合やエラーはバッジに出さない
  const current = w.tabId != null && w.req.type === 'open-page' && tabDoc.get(w.tabId) === docOf(w.req.url);
  if (msg.type === 'event' && msg.event === 'progress' && current) setTabStatus(w.tabId, msg.data);
  // 先回りが途中で失敗したら、バッジとサイドパネルを「作成中」のまま固めずにエラーを出す
  if (msg.type === 'error' && current) setTabStatus(w.tabId, { stage: 'error', message: msg.message });
  w.reply({ ...msg, id: w.clientId });
  if (msg.type !== 'result' && msg.type !== 'error') return;
  waiting.delete(msg.id);
  scheduleIdle();
  if (msg.type !== 'result') return;
  // ページ (iframe を含む) が前に作った補足を読み込んだら、そのフレームの文書をこのタブの文書として覚える。
  // サイドパネルが iframe の中の文書の補足を出せるように
  if (w.req.type === 'page-view' && w.tabId != null && msg.data?.view) tabDoc.set(w.tabId, docOf(w.req.url));
  if (PROFILE_MUTATIONS.has(w.req.type)) broadcast({ type: 'profile-changed' });
  else if (MUTATIONS.has(w.req.type) && msg.data?.view) broadcast({ type: 'page-updated', view: msg.data.view });
}

function sendHost(req, { tabId, reply }) {
  clearTimeout(idleTimer);
  const id = `r${++seq}`;
  waiting.set(id, { clientId: req.id, tabId, reply, req });
  if ((req.type === 'open-page' || req.type === 'ask') && tabId != null && req.url) tabDoc.set(tabId, docOf(req.url));
  try {
    connectHost().postMessage({ ...req, id });
  } catch (e) {
    waiting.delete(id);
    reply({ id: req.id, type: 'error', message: hostErrorText(e.message) });
  }
}

async function settings() {
  const s = await chrome.storage.local.get(['allowlist', 'model']);
  return { allowlist: s.allowlist || DEFAULT_ALLOWLIST, model: s.model || 'haiku' };
}

// サイトの設定は「本文の根」(補足を付ける範囲) だけ。開いただけで補足を作ることはしない
// (先回りの補足は、サイドパネルの「補足を付ける」を押したときだけ作る)
async function configFor(url) {
  const { allowlist } = await settings();
  const entry = entryFor(allowlist, url);
  return { root: entry?.root || FALLBACK_ROOT };
}

// タブの全フレームに content script を差し込む。記事を iframe で描くページ (ダッシュボード等) でも
// 本文のフレームで語句を選べるようにするため。アクセス権の無いフレームには入らない
async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: CONTENT_FILES });
}

// 先回りの補足は、本文がいちばん多いフレーム 1 つだけで作る (全フレームで走らせると二重になる)
async function runTab(tabId, force) {
  try {
    await inject(tabId);
  } catch (e) {
    throw new Error(`このページでは動かせません。ツールバーの ubiqdoc ボタンを押してから、もう一度試してください (${e.message})`);
  }
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      const NS = window.__ubq;
      if (!NS || !NS.text) return -1;
      return NS.text.roots(NS.rootSel || 'main').reduce((n, r) => n + (r.innerText || r.textContent || '').length, 0);
    },
  });
  const best = (results || []).filter((r) => typeof r.result === 'number' && r.result >= 0)
    .sort((a, b) => b.result - a.result)[0];
  if (!best) throw new Error('本文が見つかりませんでした');
  await chrome.tabs.sendMessage(tabId, { type: 'run', force: !!force }, { frameId: best.frameId });
  return { frameId: best.frameId };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ubq') return;
  const senderTab = port.sender?.tab?.id ?? null;
  const reply = (m) => { try { port.postMessage(m); } catch { /* 送り手が閉じた */ } };
  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'config') return reply({ id: msg.id, type: 'result', data: await configFor(msg.url) });
    if (msg.type === 'tab-status') return reply({ id: msg.id, type: 'result', data: tabStatus.get(msg.tabId) || null });
    // サイドパネルが「このタブで補足を付けている文書」の URL を知るため (iframe の中の文書ならその URL)
    if (msg.type === 'tab-doc') return reply({ id: msg.id, type: 'result', data: tabDoc.get(msg.tabId) || null });
    if (msg.type === 'run-tab') {
      try { return reply({ id: msg.id, type: 'result', data: await runTab(msg.tabId, msg.force) }); }
      catch (e) { return reply({ id: msg.id, type: 'error', message: e.message }); }
    }
    const req = msg.type === 'open-page' ? { ...msg, model: (await settings()).model } : msg;
    sendHost(req, { tabId: msg.tabId ?? senderTab, reply });
  });
});

// サイト一覧のうち、アクセス権のあるサイトにだけ content script を登録する。
// 登録しておくと、開いただけで語句の「AI に聞く」が使える (補足は作らない)
async function doSyncContentScripts() {
  const { allowlist } = await settings();
  const granted = [];
  for (const e of allowlist) {
    try { if (await chrome.permissions.contains({ origins: [e.pattern] })) granted.push(e.pattern); } catch { /* 不正なパターンは飛ばす */ }
  }
  await chrome.scripting.unregisterContentScripts({ ids: ['ubq'] }).catch(() => {});
  if (granted.length) {
    await chrome.scripting.registerContentScripts([{ id: 'ubq', matches: granted, js: CONTENT_FILES, runAt: 'document_idle', allFrames: true, persistAcrossSessions: true }]);
  }
}

// 同時に走ると unregister と register が入り混じるので、1 本ずつ順に行う。
// 各回は開始時に storage を読み直すので、最後に積まれた回が必ず最新の一覧を見る
let syncing = Promise.resolve();
function requestSync() {
  syncing = syncing.then(doSyncContentScripts, doSyncContentScripts).catch((e) => console.error('[sync]', e.message));
  return syncing;
}
function syncContentScripts() { return requestSync(); }

chrome.runtime.onInstalled.addListener(async (d) => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  await syncContentScripts();
  if (d.reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(syncContentScripts);
chrome.permissions.onAdded.addListener(syncContentScripts);
chrome.permissions.onRemoved.addListener(syncContentScripts);
chrome.storage.onChanged.addListener((c) => { if (c.allowlist) syncContentScripts(); });
chrome.tabs.onRemoved.addListener((tabId) => { tabStatus.delete(tabId); tabDoc.delete(tabId); });
// 別のページに移ったら、前のページの進み具合とバッジを消す
chrome.tabs.onUpdated.addListener((tabId, info) => {
  // # だけが変わったときは同じ文書なので、進み具合を残す
  if (!info.url || docOf(info.url) === tabDoc.get(tabId)) return;
  tabDoc.set(tabId, docOf(info.url));
  tabStatus.delete(tabId);
  chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
});

// ツールバーのボタン: サイドパネルを開き、全フレームに差し込む (activeTab の権限で)。
// これで「AI に聞く」が使えるようになる。先回りの補足は作らない (サイドパネルの「補足を付ける」で作る)
chrome.action.onClicked.addListener(async (tab) => {
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  try {
    await inject(tab.id);
  } catch (e) {
    chrome.runtime.sendMessage({ type: 'status', tabId: tab.id, status: { stage: 'error', message: `このページでは動かせません: ${e.message}` } }).catch(() => {});
  }
});

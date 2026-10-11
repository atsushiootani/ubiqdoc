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

function hostErrorText(err) {
  return /not found|Specified native messaging host|forbidden/i.test(err)
    ? 'host が未登録です。ubiqdoc のリポジトリで host/install.sh を実行してください'
    : err;
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
  if (msg.type === 'event' && msg.event === 'progress' && w.tabId != null) setTabStatus(w.tabId, msg.data);
  // 先回りが途中で失敗したら、バッジとサイドパネルを「作成中」のまま固めずにエラーを出す
  if (msg.type === 'error' && w.req.type === 'open-page' && w.tabId != null) setTabStatus(w.tabId, { stage: 'error', message: msg.message });
  w.reply({ ...msg, id: w.clientId });
  if (msg.type !== 'result' && msg.type !== 'error') return;
  waiting.delete(msg.id);
  scheduleIdle();
  if (msg.type !== 'result') return;
  if (PROFILE_MUTATIONS.has(w.req.type)) broadcast({ type: 'profile-changed' });
  else if (MUTATIONS.has(w.req.type) && msg.data?.view) broadcast({ type: 'page-updated', view: msg.data.view });
}

function sendHost(req, { tabId, reply }) {
  clearTimeout(idleTimer);
  const id = `r${++seq}`;
  waiting.set(id, { clientId: req.id, tabId, reply, req });
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

async function configFor(url) {
  const { allowlist } = await settings();
  const entry = entryFor(allowlist, url);
  const granted = entry ? await chrome.permissions.contains({ origins: [entry.pattern] }) : false;
  return { root: entry?.root || FALLBACK_ROOT, auto: !!entry && granted };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ubq') return;
  const senderTab = port.sender?.tab?.id ?? null;
  const reply = (m) => { try { port.postMessage(m); } catch { /* 送り手が閉じた */ } };
  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'config') return reply({ id: msg.id, type: 'result', data: await configFor(msg.url) });
    if (msg.type === 'tab-status') return reply({ id: msg.id, type: 'result', data: tabStatus.get(msg.tabId) || null });
    const req = msg.type === 'open-page' ? { ...msg, model: (await settings()).model } : msg;
    sendHost(req, { tabId: msg.tabId ?? senderTab, reply });
  });
});

// 許可リストのうち、アクセス権のあるサイトにだけ content script を登録する
async function doSyncContentScripts() {
  const { allowlist } = await settings();
  const granted = [];
  for (const e of allowlist) {
    try { if (await chrome.permissions.contains({ origins: [e.pattern] })) granted.push(e.pattern); } catch { /* 不正なパターンは飛ばす */ }
  }
  await chrome.scripting.unregisterContentScripts({ ids: ['ubq'] }).catch(() => {});
  if (granted.length) {
    await chrome.scripting.registerContentScripts([{ id: 'ubq', matches: granted, js: CONTENT_FILES, runAt: 'document_idle', persistAcrossSessions: true }]);
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
chrome.tabs.onRemoved.addListener((tabId) => tabStatus.delete(tabId));
// 別のページに移ったら、前のページの進み具合とバッジを消す
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!info.url) return;
  tabStatus.delete(tabId);
  chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
});

// 許可リストに無いページでは、ツールバーのボタンで実行する (activeTab の権限で差し込む)
chrome.action.onClicked.addListener(async (tab) => {
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
    await chrome.tabs.sendMessage(tab.id, { type: 'run', force: true });
  } catch (e) {
    chrome.runtime.sendMessage({ type: 'status', tabId: tab.id, status: { stage: 'error', message: `このページでは動かせません: ${e.message}` } }).catch(() => {});
  }
});

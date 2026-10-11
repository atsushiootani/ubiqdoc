// サイドパネル。開いているタブのページの書き込み履歴・承認待ち・見つからなくなった補足と、知識プロフィール
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KIND = { popover: 'ポップオーバー', section: 'セクション', link: 'リンク' };

let port = null;
let seq = 0;
const pend = new Map();
let current = { tabId: null, url: null };
let lastError = null;

function request(type, payload = {}) {
  if (!port) {
    port = chrome.runtime.connect({ name: 'ubq' });
    port.onMessage.addListener((m) => {
      const p = pend.get(m.id);
      if (!p || m.type === 'event') return;
      pend.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m.data);
    });
    port.onDisconnect.addListener(() => { port = null; });
  }
  const id = `s${++seq}`;
  return new Promise((resolve, reject) => { pend.set(id, { resolve, reject }); port.postMessage({ ...payload, type, id }); });
}

async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}

const sendTab = (msg) => chrome.tabs.sendMessage(current.tabId, msg);

function statusText(st) {
  if (!st) return '';
  if (st.stage === 'extract') return '補足の候補を探しています…';
  if (st.stage === 'write') return `補足を作成中 ${st.made}/${st.total}`;
  if (st.stage === 'done') return `補足を ${st.made} 個作りました`;
  if (st.stage === 'error') return st.message;
  return '';
}

function renderStatus(view, st, err) {
  const box = $('#status');
  const lines = [];
  if (err) {
    lines.push(`<div class="err">${esc(err)}</div>`);
    if (/install\.sh/.test(err)) lines.push('<code>bash host/install.sh</code>');
  }
  if (!view && !err) lines.push('<div class="muted">このページではまだ補足を作っていません。ツールバーの ubiqdoc ボタンで始められます</div>');
  const s = statusText(st);
  if (s && s !== err) lines.push(`<div>${esc(s)}</div>`);
  if (view?.dropped?.noSource) lines.push(`<div class="muted">出典が付けられず捨てた補足: ${view.dropped.noSource} 個</div>`);
  if (view?.truncated) lines.push('<div class="muted">本文が 100KB を超えたので、先頭だけを読ませました</div>');
  if (view) lines.push('<div class="actions"><button id="rerun">やり直す</button></div>');
  box.innerHTML = lines.join('');
  $('#rerun')?.addEventListener('click', () => sendTab({ type: 'run', force: true }).catch(() => {
    lastError = 'このページではまだ動いていません。ツールバーの ubiqdoc ボタンを押してください';
    refresh();
  }));
}

function renderTurns(view) {
  const box = $('#turns');
  const turns = new Map();
  for (const a of view?.annotations || []) {
    if (!turns.has(a.turnId)) turns.set(a.turnId, { label: a.origin === 'proactive' ? '先回りの補足' : `「${a.anchor.exact}」`, rows: [] });
    turns.get(a.turnId).rows.push(a);
  }
  box.innerHTML = turns.size ? '' : '<p class="muted">なし</p>';
  for (const [turnId, info] of [...turns].reverse()) {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `<div class="label">${esc(info.label)}</div>${info.rows.map((a) => {
      const conv = a.kind === 'popover' ? `<button data-conv="section" data-id="${a.id}">→ セクションにする</button>`
        : a.kind === 'section' ? `<button data-conv="popover" data-id="${a.id}">→ ポップオーバーにする</button>` : '';
      return `<div class="row"><span>${esc(KIND[a.kind])} · ${a.id} 「${esc(a.anchor.exact)}」${a.hidden ? ' (知ってる)' : ''}</span>${conv}<button data-jump="${a.id}">見る</button></div>`;
    }).join('')}<div class="actions"><button data-undo>取り消す</button></div>`;
    div.querySelectorAll('[data-conv]').forEach((b) => b.addEventListener('click', () => act('convert', { annotationId: b.dataset.id, to: b.dataset.conv })));
    div.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => sendTab({ type: 'jump', id: b.dataset.jump }).catch(() => {})));
    div.querySelector('[data-undo]').addEventListener('click', () => act('undo-turn', { turnId }));
    box.appendChild(div);
  }
}

function renderPending(view) {
  const box = $('#pending');
  const list = view?.pending || [];
  box.innerHTML = list.length ? '' : '<p class="muted">なし</p>';
  for (const p of list) {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `<div class="label">「${esc(p.label)}」が ${esc(p.conflictWith)} と重なった</div>
      <div class="muted">${esc(String(p.annotation.body || p.annotation.href || '').replace(/<[^>]+>/g, '').slice(0, 120))}</div>
      <div class="actions"><button class="primary" data-a>セクションとして追加</button><button data-r>捨てる</button></div>`;
    div.querySelector('[data-a]').addEventListener('click', () => act('approve', { pid: p.id }));
    div.querySelector('[data-r]').addEventListener('click', () => act('reject', { pid: p.id }));
    box.appendChild(div);
  }
}

function renderOrphans(view) {
  const list = view?.orphaned || [];
  $('#orphanCount').textContent = list.length ? `(${list.length})` : '';
  const box = $('#orphans');
  box.innerHTML = list.length ? '' : '<p class="muted">なし</p>';
  for (const a of list) {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `<div class="label">「${esc(a.anchor.exact)}」</div><div class="muted">${esc(String(a.body || '').replace(/<[^>]+>/g, '').slice(0, 120))}</div>
      <div class="actions"><button data-d>捨てる</button></div>`;
    div.querySelector('[data-d]').addEventListener('click', () => act('discard-orphan', { annotationId: a.id }));
    box.appendChild(div);
  }
}

async function act(type, payload) {
  try { await request(type, { url: current.url, ...payload }); lastError = null; } catch (e) { lastError = e.message; }
  refresh();
}

async function renderProfile() {
  let data;
  try { data = await request('profile-list'); } catch (e) { $('#personal').innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  const q = $('#q').value.trim().toLowerCase();
  for (const cat of ['personal', 'work']) {
    const box = $(`#${cat}`);
    const list = data[cat].filter((c) => !q || [c.label, c.key, ...(c.aliases || [])].some((s) => String(s).toLowerCase().includes(q)));
    box.innerHTML = list.length ? '' : '<p class="muted">なし</p>';
    for (const c of list) {
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML = `<div class="row"><span class="label">${esc(c.label)}</span><span>${esc(c.key)}</span></div>
        ${c.aliases?.length ? `<div class="muted">${esc(c.aliases.join(' / '))}</div>` : ''}
        <div class="actions"><button data-x>戻す (知らないことにする)</button></div>`;
      div.querySelector('[data-x]').addEventListener('click', async () => { await request('profile-remove', { conceptId: c.id }); renderProfile(); });
      box.appendChild(div);
    }
  }
}

async function refresh() {
  const t = await activeTab();
  if (!t) return;
  current = { tabId: t.id, url: t.url };
  if (!$('#profile').hidden) { renderProfile(); return; }
  let view = null;
  let err = lastError;
  try { view = (await request('page-view', { url: t.url })).view; } catch (e) { err = err || e.message; }
  const st = await request('tab-status', { tabId: t.id }).catch(() => null);
  renderStatus(view, st, err);
  renderTurns(view);
  renderPending(view);
  renderOrphans(view);
}

function showTab(name) {
  $('#tab-page').classList.toggle('on', name === 'page');
  $('#tab-profile').classList.toggle('on', name === 'profile');
  $('#page').hidden = name !== 'page';
  $('#profile').hidden = name !== 'profile';
  refresh();
}

$('#tab-page').addEventListener('click', () => showTab('page'));
$('#tab-profile').addEventListener('click', () => showTab('profile'));
$('#q').addEventListener('input', renderProfile);
chrome.runtime.onMessage.addListener((m) => {
  if (m.type === 'status' && m.tabId !== current.tabId) return;
  if (m.type === 'status') lastError = m.status?.stage === 'error' ? m.status.message : null;
  if (['page-updated', 'profile-changed', 'status'].includes(m.type)) refresh();
});
chrome.tabs.onActivated.addListener(() => { lastError = null; refresh(); });
chrome.tabs.onUpdated.addListener((id, info) => { if (id === current.tabId && (info.status === 'complete' || info.url)) refresh(); });
refresh();

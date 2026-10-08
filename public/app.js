// ubiqdoc — 文書の語句をドラッグして、その場の小窓で AI に聞く。答えは文書の中に書き込む。
//
// 書き込みはすべてこのページの JS が行う。JS は単一スレッドなので、複数の小窓の答えは
// 届いた順に 1 件ずつ反映される (= 先着優先)。サーバは claude の実行と保存だけを受け持つ。

const $ = (s) => document.querySelector(s);
const frame = $('#docFrame');

const BLOCK_SEL = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, table, figure, dd, dt, td, th';
const WRAP_SEL = '.aside-pop, .aside-link, .aside-ref, .aside-edit';
const ALLOWED_TAGS = new Set(['H5', 'P', 'UL', 'OL', 'LI', 'CODE', 'PRE', 'STRONG', 'EM', 'B', 'I', 'A', 'BR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'BLOCKQUOTE', 'SPAN']);

const RUNTIME_CSS = `
.aside-pop { position: relative; border-bottom: 1.5px dotted #1a73e8; cursor: help; }
.aside-pop-body {
  display: none; position: absolute; left: 0; top: 100%; z-index: 50; margin-top: 4px;
  width: max-content; max-width: 340px; padding: 8px 10px; border-radius: 8px;
  background: #1f2328; color: #f1f3f4; font-size: 13px; line-height: 1.6; font-weight: normal;
  box-shadow: 0 6px 18px rgba(0,0,0,.25); white-space: pre-line; text-align: left;
  max-height: 320px; overflow: auto;
}
.aside-pop:hover > .aside-pop-body, .aside-pop:focus > .aside-pop-body, .aside-pop:focus-within > .aside-pop-body { display: block; }
.aside-pop-more { display: block; margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.18); }
.aside-link { text-decoration: underline dotted; }
.aside-ref { color: inherit; text-decoration: none; border-bottom: 1.5px solid #e8a71a; }
.aside-section {
  margin: 12px 0 16px; padding: 10px 14px; border-left: 3px solid #e8a71a; border-radius: 0 8px 8px 0;
  background: rgba(232, 167, 26, .08); font-size: .95em;
}
.aside-section > .aside-section-label { font-size: 11px; letter-spacing: .04em; opacity: .65; margin-bottom: 2px; }
.aside-section > h4 { margin: 0 0 6px; font-size: 1em; }
.aside-section > .aside-depends { font-size: 12px; opacity: .75; margin-top: 6px; }
.aside-edit { background: rgba(30, 142, 62, .10); border-radius: 3px; }
@media (prefers-color-scheme: dark) {
  .aside-pop { border-bottom-color: #6fb0f5; }
  .aside-pop-body { background: #e8eaed; color: #1b1e21; }
  .aside-pop-more { border-top-color: rgba(0,0,0,.15); }
}`;

const state = {
  docId: null,
  meta: null,
  prefix: '',        // <html> より前のノード (doctype と frontmatter コメント) をそのまま保存し直す
  pending: [],
  windows: new Map(),
  zTop: 20,
  editing: false,
  version: 0,          // サーバの文書の版。保存のたびに 1 進む。食い違ったら別のタブが先に保存している
  stale: false,
  saveChain: Promise.resolve(),
};

function fdoc() { return frame.contentDocument; }
function rid(p) { return `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}

// ---------- 文書の読み込みと保存 ----------

async function loadDocList(selectId) {
  const docs = await api('/api/docs');
  const sel = $('#docSelect');
  sel.innerHTML = '<option value="">開いた文書…</option>' +
    docs.map((d) => `<option value="${d.id}">${esc(d.title)} (${d.createdAt.slice(5, 16).replace('T', ' ')})</option>`).join('');
  if (selectId) sel.value = selectId;
}

async function openDoc(id) {
  closeAllWindows();
  const { meta, base, pending, sourceChanged } = await api(`/api/doc/${id}`);
  state.docId = id;
  state.meta = meta;
  state.pending = pending;
  state.version = meta.version || 0;
  state.stale = false;
  $('#staleBanner').hidden = true;
  showSourceChanged(sourceChanged);
  $('#modelSelect').value = meta.model;
  $('#docSelect').value = id;
  history.replaceState(null, '', `?doc=${id}`);
  showBase(base, meta);

  // DOMParser で読んだノードは script が「実行済み」扱いになり、iframe に移しても動かない。
  // 文書側の script (mermaid など) に DOM を書き換えられると、その結果まで保存されてしまうので止めておく
  const html = await (await fetch(`/api/doc/${id}/html`, { cache: 'no-store' })).text();
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  retargetAssets(parsed, id);     // 相対 URL の素材を、文書の dir から配り直す
  state.prefix = '';
  for (const n of parsed.childNodes) {
    if (n === parsed.documentElement) break;
    if (n.nodeType === Node.DOCUMENT_TYPE_NODE) state.prefix += `<!DOCTYPE ${n.name}>\n`;
    else if (n.nodeType === Node.COMMENT_NODE) state.prefix += `<!--${n.data}-->\n`;
  }
  await new Promise((resolve) => {
    frame.onload = resolve;
    frame.src = 'about:blank';
  });
  const d = fdoc();
  d.replaceChild(d.importNode(parsed.documentElement, true), d.documentElement);
  d.addEventListener('mouseup', onMouseUp);
  d.addEventListener('click', onDocClick);
  d.addEventListener('input', onDocInput);
  setEditing(state.editing);
  $('#empty').hidden = true;
  renderSide();
  // 読み込み済みのセッションが無い文書 (作り直しで消えた等) は、開いた時点で読ませておく
  if (base === 'none') { await api(`/api/doc/${id}/rebase`, { method: 'POST', body: {} }); showBase('creating', meta); }
  if (base !== 'ready') pollBase();
}

// 素材 (css・画像・フォント) の相対 URL を、文書の dir から配り直す口へ向け直す。
//
// 文書は about:blank の iframe に流し込むので、相対 URL の基準が無い。`href="style.css"`
// は何にも解決できず、**CSS が当たらないまま本文だけが出る**。
//
// `<base>` を置かないのは、本文のリンク (`href="index.html"`) まで巻き込んで、
// 文書の中を辿れなくなるため。**素材の属性だけ**を書き換える。
// 元の値は data-ubiqdoc-* に取っておき、保存の直前に書き戻す (下の serializeDoc)。
const ASSET_ATTRS = [
  ['link', 'href'], ['img', 'src'], ['img', 'srcset'], ['source', 'src'],
  ['source', 'srcset'], ['video', 'src'], ['video', 'poster'], ['audio', 'src'],
  ['script', 'src'], ['embed', 'src'], ['object', 'data'],
];

// 書き換えるのは「同じ dir の中を指す相対 URL」だけ。絶対 URL・data:・#… は触らない
function isRelativeAsset(v) {
  return !!v && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(v.trim());
}

function retargetAssets(doc, docId) {
  const base = `/api/doc/${docId}/asset/`;
  for (const [tag, attr] of ASSET_ATTRS) {
    for (const el of doc.querySelectorAll(`${tag}[${attr}]`)) {
      const v = el.getAttribute(attr);
      // srcset は "a.png 1x, b.png 2x" の並び。URL の部分だけ差し替える
      const next = attr === 'srcset'
        ? v.split(',').map((part) => {
          const [u, ...rest] = part.trim().split(/\s+/);
          return isRelativeAsset(u) ? [base + u, ...rest].join(' ') : part.trim();
        }).join(', ')
        : (isRelativeAsset(v) ? base + v : v);
      if (next === v) continue;
      el.setAttribute(`data-ubiqdoc-${attr}`, v);
      el.setAttribute(attr, next);
    }
  }
}

function serializeDoc() {
  const root = fdoc().documentElement.cloneNode(true);
  root.querySelector('body')?.removeAttribute('contenteditable');
  // **元の相対 URL に戻してから保存する。** こちらの配り口のパスを書き込むと、
  // 文書をブラウザで直接開いたときに素材が全部 404 になる
  for (const [, attr] of ASSET_ATTRS) {
    for (const el of root.querySelectorAll(`[data-ubiqdoc-${attr}]`)) {
      el.setAttribute(attr, el.getAttribute(`data-ubiqdoc-${attr}`));
      el.removeAttribute(`data-ubiqdoc-${attr}`);
    }
  }
  return state.prefix + root.outerHTML + '\n';
}

// 保存は 1 本の列に並べる。同じタブの中で保存が追い越し合うと、版の食い違いを誤検知するため
function enqueueSave(fn) {
  const run = state.saveChain.then(async () => {
    if (state.stale) return null;
    try {
      const r = await fn();
      if (r) state.version = r.version;
      return r;
    } catch (e) {
      if (e.status === 409) markStale();
      else toast(`保存に失敗: ${e.message}`);
      return null;
    }
  });
  state.saveChain = run.catch(() => {});
  return run;
}

function markStale() {
  state.stale = true;
  $('#staleBanner').hidden = false;
}

function saveDoc(turnId, source = 'ai') {
  // 中身は呼ばれた時点で取る。列で待っている間に別の文書へ切り替わっても、取り違えないように
  const docId = state.docId;
  const html = serializeDoc();
  return enqueueSave(async () => {
    if (docId !== state.docId) return null;
    const r = await api(`/api/doc/${docId}/html`, { method: 'PUT', body: { html, turnId, baseVersion: state.version, source } });
    showEditsSinceBase(r.humanEditsSinceBase);
    return r;
  });
}

function savePending() {
  const docId = state.docId;
  const pending = state.pending.slice();
  return enqueueSave(async () => (docId !== state.docId ? null
    : api(`/api/doc/${docId}/pending`, { method: 'PUT', body: { pending, baseVersion: state.version } })));
}

function ensureRuntimeStyle() {
  const d = fdoc();
  let st = d.head.querySelector('style[data-aside-runtime]');
  if (!st) {
    st = d.createElement('style');
    st.setAttribute('data-aside-runtime', '');
    d.head.appendChild(st);
  }
  // 古い版の CSS が入った文書でも、最新の見た目にそろえる
  if (st.textContent !== RUNTIME_CSS) st.textContent = RUNTIME_CSS;
}

function showBase(base, meta) {
  const el = $('#baseStatus');
  if (base === 'ready') el.textContent = `準備完了${meta.baseMs ? ` (読込 ${(meta.baseMs / 1000).toFixed(1)}s)` : ''}`;
  else if (base === 'creating') el.textContent = '文書を読み込み中…';
  else el.textContent = '';
  showEditsSinceBase(base === 'creating' ? 0 : meta.humanEditsSinceBase || 0);
}

// 人が本文を直したのに AI がまだ読み直していないとき、「読み直す」を出す
function showEditsSinceBase(n) {
  state.humanEditsSinceBase = n || 0;
  $('#rebaseBtn').hidden = !n;
}

// 元ファイルを直に開いているとき、そのファイルが外 (エディタ・別のツール) で書き換わった。
// こちらからは読み直さない —— 知らせとボタンだけ出して、焚くかどうかは人が決める
function showSourceChanged(on) {
  state.sourceChanged = !!on;
  $('#sourceBanner').hidden = !on;
}

async function rebase() {
  if (!state.docId) return;
  clearTimeout(onDocInput.timer);
  if (onDocInput.dirty) { onDocInput.dirty = false; await saveDoc(undefined, 'human'); }
  await state.saveChain;
  await api(`/api/doc/${state.docId}/rebase`, { method: 'POST', body: {} });
  showSourceChanged(false);        // 読み直した版が新しい基準になる
  showBase('creating', state.meta);
  pollBase();
}

async function pollBase() {
  const id = state.docId;
  for (let i = 0; i < 60 && id === state.docId; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { meta, base } = await api(`/api/doc/${id}`);
    if (id !== state.docId) return;
    showBase(base, meta);
    if (base === 'ready') return;
  }
}

// ---------- 文書の中の位置 ----------

// 本文のテキストノードを連結して、引用文字列で位置を探す。注釈の中身 (ポップオーバー本文・
// 注釈セクション) は本文ではないので除外する
function textNodes() {
  const d = fdoc();
  const out = [];
  const walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || p.closest('.aside-pop-body, .aside-section, script, style')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n;
  while ((n = walker.nextNode())) out.push(n);
  return out;
}

function findQuote({ exact, prefix }) {
  if (!exact) return null;
  const nodes = textNodes();
  let full = '';
  const starts = [];
  for (const n of nodes) { starts.push(full.length); full += n.data; }
  const hits = [];
  for (let i = full.indexOf(exact); i >= 0; i = full.indexOf(exact, i + 1)) hits.push(i);
  if (!hits.length) return null;
  let at = hits[0];
  if (prefix) {
    const withPrefix = hits.find((h) => full.slice(Math.max(0, h - prefix.length), h).endsWith(prefix.slice(-Math.min(prefix.length, h))));
    if (withPrefix !== undefined) at = withPrefix;
  }
  const locate = (pos, isEnd) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (starts[i] < pos || (!isEnd && starts[i] === pos)) return [nodes[i], pos - starts[i]];
    }
    return [nodes[0], 0];
  };
  const range = fdoc().createRange();
  range.setStart(...locate(at, false));
  range.setEnd(...locate(at + exact.length, true));
  return range;
}

function quoteOf(range) {
  const d = fdoc();
  const before = d.createRange();
  before.setStart(d.body, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const after = d.createRange();
  after.setStart(range.endContainer, range.endOffset);
  after.setEndAfter(d.body.lastChild || d.body);
  return { exact: range.toString(), prefix: before.toString().slice(-24), suffix: after.toString().slice(0, 24) };
}

function blockOf(node) {
  const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return el.closest(BLOCK_SEL) || el.closest('body > *') || el;
}

function plainText(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('.aside-pop-body, .aside-section').forEach((x) => x.remove());
  return c.textContent.replace(/\s+/g, ' ').trim();
}

function contextOf(range) {
  const block = blockOf(range.startContainer);
  let heading = '';
  const all = [...fdoc().querySelectorAll('h1, h2, h3')];
  for (const h of all) {
    if (h.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING || h === block) heading = plainText(h);
  }
  return `${heading ? `(見出し: ${heading})\n` : ''}${plainText(block).slice(0, 1500)}`;
}

function asidesSummary() {
  const seen = new Set();
  const lines = [];
  for (const el of fdoc().querySelectorAll('[data-aside-id]')) {
    const id = el.dataset.asideId;
    if (seen.has(id) || el.classList.contains('aside-ref')) continue;
    seen.add(id);
    const kind = el.dataset.asideKind;
    const body = kind === 'popover' ? el.querySelector('.aside-pop-body')?.textContent
      : kind === 'link' ? el.getAttribute('href')
        : kind === 'section' ? plainText(el) : el.textContent;
    lines.push(`- ${id} ${kind}「${el.dataset.asideLabel}」: ${(body || '').replace(/\s+/g, ' ').slice(0, 80)}`);
  }
  return lines.join('\n');
}

function nextAsideId() {
  let max = 0;
  for (const el of fdoc().querySelectorAll('[data-aside-id]')) {
    const n = parseInt(el.dataset.asideId.slice(2), 10);
    if (n > max) max = n;
  }
  return `a_${String(max + 1).padStart(2, '0')}`;
}

// ---------- 書き込み ----------

function sanitize(html) {
  const d = fdoc();
  const src = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
  const frag = d.createDocumentFragment();
  const copy = (from, to) => {
    for (const n of from.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) { to.appendChild(d.createTextNode(n.data)); continue; }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      // 見出しは注釈セクションの見出し (h4) より下の階層にそろえる
      const tag = /^H[1-6]$/.test(n.tagName) ? 'H5' : n.tagName;
      if (!ALLOWED_TAGS.has(tag)) { copy(n, to); continue; }
      const el = d.createElement(tag.toLowerCase());
      if (n.tagName === 'A') {
        const href = n.getAttribute('href') || '';
        if (/^(https?:|#)/.test(href)) el.setAttribute('href', href);
        if (/^https?:/.test(href)) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
      }
      copy(n, el);
      to.appendChild(el);
    }
  };
  copy(src, frag);
  return frag;
}

function mark(el, a, ctx) {
  el.dataset.asideId = a.id;
  el.dataset.asideTurn = ctx.turnId;
  el.dataset.asideKind = a.kind;
  el.dataset.asideLabel = a.label;
  el.dataset.asideWindow = ctx.windowId;
  return el;
}

function wrapRange(range, el) {
  el.appendChild(range.extractContents());
  range.insertNode(el);
  return el;
}

function overlapping(range) {
  const d = fdoc();
  const anc = range.commonAncestorContainer;
  const up = (anc.nodeType === Node.ELEMENT_NODE ? anc : anc.parentElement).closest(WRAP_SEL);
  if (up) return up;
  return [...d.querySelectorAll(WRAP_SEL)].find((el) => range.intersectsNode(el)) || null;
}

function insertSection(range, a, ctx) {
  const d = fdoc();
  const sec = mark(d.createElement('section'), a, ctx);
  sec.className = 'aside-section';
  sec.id = `aside-${a.id}`;
  const label = d.createElement('div');
  label.className = 'aside-section-label';
  label.textContent = `注釈 · 「${a.label}」`;
  sec.appendChild(label);
  if (a.title) {
    const h = d.createElement('h4');
    h.textContent = a.title;
    sec.appendChild(h);
  }
  sec.appendChild(sanitize(a.body || ''));
  if (a.dependsOn?.length) {
    sec.dataset.asideDepends = a.dependsOn.join(' ');
    const dep = d.createElement('div');
    dep.className = 'aside-depends';
    dep.append('前提: ');
    a.dependsOn.forEach((id, i) => {
      const target = d.querySelector(`[data-aside-id="${id}"]`);
      const link = d.createElement('a');
      link.href = d.getElementById(`aside-${id}`) ? `#aside-${id}` : `#${id}`;
      link.textContent = target ? `「${target.dataset.asideLabel}」の注釈` : id;
      if (i) dep.append('、');
      dep.appendChild(link);
    });
    sec.appendChild(dep);
  }
  // 語句を含むブロックの直後へ。既に注釈セクションが続いていれば、その後ろに並べる
  let block = blockOf(range.startContainer);
  if (block.tagName === 'TD' || block.tagName === 'TH') block = block.closest('table');
  if (block.tagName === 'LI') { block.appendChild(sec); return sec; }
  let after = block;
  while (after.nextElementSibling?.classList.contains('aside-section')) after = after.nextElementSibling;
  after.after(sec);
  return sec;
}

// 1 件の注釈を反映する。戻り値は小窓に出す 1 行
function applyAnnotation(a, ctx, win) {
  const d = fdoc();
  const kind = ['popover', 'section', 'link'].includes(a.kind) ? a.kind : 'popover';
  let range;
  if (!a.target || a.target === 'selection') {
    range = win.range && !win.range.collapsed && win.range.toString() === win.quote.exact ? win.range : findQuote(win.quote);
  } else {
    range = findQuote(a.target);
  }
  if (!range) return { text: `差し込み位置が見つからなかった: 「${a.target?.exact || win.quote.exact}」`, error: true };
  const label = range.toString().trim().slice(0, 40);
  const ann = { ...a, kind, id: nextAsideId(), label };
  const hit = overlapping(range);

  if (kind === 'section') {
    const sec = insertSection(range, ann, ctx);
    if (!hit) {
      const ref = mark(d.createElement('a'), ann, ctx);
      ref.className = 'aside-ref';
      ref.href = `#${sec.id}`;
      wrapRange(range, ref);
    }
    return { text: `セクション「${a.title || label}」を追加 (${ann.id})` };
  }

  if (hit) {
    // 同じ語句のポップオーバーどうしなら、先にあるほうへ追記する (自然にまとまる唯一のケース)
    if (kind === 'popover' && hit.classList.contains('aside-pop') && plainText(hit) === label) {
      const more = d.createElement('span');
      more.className = 'aside-pop-more';
      more.dataset.asideTurn = ctx.turnId;
      more.textContent = a.body || '';
      hit.querySelector('.aside-pop-body').appendChild(more);
      return { text: `既存の ${hit.dataset.asideId} に追記` };
    }
    state.pending.push({
      id: rid('p'), type: 'conflict', turnId: ctx.turnId, windowId: ctx.windowId,
      annotation: { ...a, target: { exact: range.toString(), prefix: quoteOf(range).prefix } },
      conflictWith: hit.dataset.asideId, label,
    });
    return { text: `既存の注釈 ${hit.dataset.asideId} と重なったので承認待ちに回した`, pending: true };
  }

  if (kind === 'link') {
    const href = String(a.href || '');
    if (!/^https?:\/\//.test(href)) return { text: 'リンク先の URL が不正だったので捨てた', error: true };
    const link = mark(d.createElement('a'), ann, ctx);
    link.className = 'aside-link';
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener';
    wrapRange(range, link);
    win.anchorRange = null;
    return { text: `リンクを追加 (${ann.id})` };
  }

  const pop = mark(d.createElement('span'), ann, ctx);
  pop.className = 'aside-pop';
  pop.tabIndex = 0;
  wrapRange(range, pop);
  const body = d.createElement('span');
  body.className = 'aside-pop-body';
  body.setAttribute('role', 'tooltip');
  body.textContent = a.body || '';
  pop.appendChild(body);
  return { text: `ポップオーバーを追加 (${ann.id})` };
}

async function applyAnswer(win, turnId, ans) {
  ensureRuntimeStyle();
  const ctx = { turnId, windowId: win.id };
  const lines = [];
  for (const a of ans.annotations || []) {
    try { lines.push(applyAnnotation(a, ctx, win)); } catch (e) { lines.push({ text: `書き込みに失敗: ${e.message}`, error: true }); }
  }
  for (const e of ans.edits || []) {
    if (!e.exact || !e.replaceWith) continue;
    state.pending.push({ id: rid('p'), type: 'edit', turnId, windowId: win.id, exact: e.exact, replaceWith: e.replaceWith, reason: e.reason || '' });
    lines.push({ text: `書き換えの提案を承認待ちに追加`, pending: true });
  }
  if (lines.some((l) => !l.error && !l.pending) || (ans.annotations || []).length) await saveDoc(turnId);
  if (lines.some((l) => l.pending)) await savePending();
  renderSide();
  return lines;
}

// ---------- 形の切り替え (右ペインから。人の操作なので承認なしで反映) ----------

function popoverToSection(pop) {
  const d = fdoc();
  const body = pop.querySelector(':scope > .aside-pop-body');
  const paras = [''];
  for (const n of body?.childNodes || []) {
    if (n.nodeType === Node.ELEMENT_NODE && n.classList.contains('aside-pop-more')) paras.push(n.textContent);
    else paras[0] += n.textContent;
  }
  body?.remove();
  // 元がセクションだったなら、ポップオーバーにしたときに控えた HTML (見出し・リスト込み) で戻す
  const saved = pop.dataset.asideSectionHtml;
  const ann = {
    id: pop.dataset.asideId, kind: 'section', label: pop.dataset.asideLabel,
    title: saved ? pop.dataset.asideSectionTitle : pop.dataset.asideLabel,
    body: saved || paras.filter((x) => x.trim()).map((x) => `<p>${esc(x.trim())}</p>`).join(''),
  };
  const ctx = { turnId: pop.dataset.asideTurn, windowId: pop.dataset.asideWindow || '' };
  const range = d.createRange();
  range.selectNodeContents(pop);
  const sec = insertSection(range, ann, ctx);
  const ref = mark(d.createElement('a'), ann, ctx);
  ref.className = 'aside-ref';
  ref.href = `#${sec.id}`;
  ref.append(...pop.childNodes);
  pop.replaceWith(ref);
}

function sectionToPopover(sec) {
  const d = fdoc();
  const id = sec.dataset.asideId;
  const ref = d.querySelector(`.aside-ref[data-aside-id="${id}"]`);
  if (!ref) { toast('このセクションには本文側の語句の印が無いので、ポップオーバーにできません'); return false; }
  const clone = sec.cloneNode(true);
  clone.querySelectorAll('.aside-section-label, .aside-depends').forEach((x) => x.remove());
  const text = [...clone.children].map((c) => c.textContent.trim()).filter(Boolean).join('\n');
  const ann = { id, kind: 'popover', label: ref.dataset.asideLabel };
  const pop = mark(d.createElement('span'), ann, { turnId: sec.dataset.asideTurn, windowId: sec.dataset.asideWindow || '' });
  pop.className = 'aside-pop';
  pop.tabIndex = 0;
  const title = clone.querySelector(':scope > h4');
  pop.dataset.asideSectionTitle = title?.textContent || '';
  title?.remove();
  pop.dataset.asideSectionHtml = clone.innerHTML;
  pop.append(...ref.childNodes);
  const body = d.createElement('span');
  body.className = 'aside-pop-body';
  body.setAttribute('role', 'tooltip');
  body.textContent = text;
  pop.appendChild(body);
  ref.replaceWith(pop);
  sec.remove();
  return true;
}

async function convertAside(id, to) {
  ensureRuntimeStyle();
  const d = fdoc();
  const el = d.querySelector(`[data-aside-id="${id}"]:not(.aside-ref)`);
  if (!el) return;
  if (to === 'section' && el.classList.contains('aside-pop')) popoverToSection(el);
  else if (to === 'popover' && el.classList.contains('aside-section')) { if (!sectionToPopover(el)) return; }
  else return;
  await saveDoc();
  renderSide();
  d.querySelector(`[data-aside-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------- 承認と取り消し (人の操作。AI の書き込みより優先) ----------

async function approve(pid) {
  const p = state.pending.find((x) => x.id === pid);
  if (!p) return;
  ensureRuntimeStyle();
  const d = fdoc();
  if (p.type === 'edit') {
    const range = findQuote({ exact: p.exact });
    if (!range) { toast('書き換え元の文が見つかりません (先に別の書き込みで変わった可能性)'); return; }
    const orig = d.createElement('div');
    orig.appendChild(range.cloneContents());
    const span = d.createElement('span');
    span.className = 'aside-edit';
    span.dataset.asideId = nextAsideId();
    span.dataset.asideTurn = p.turnId;
    span.dataset.asideKind = 'edit';
    span.dataset.asideLabel = p.exact.slice(0, 20);
    span.dataset.asideOrig = orig.innerHTML;
    range.deleteContents();
    span.appendChild(sanitize(p.replaceWith));
    range.insertNode(span);
  } else if (p.type === 'conflict') {
    // 重なった注釈はセクションとして足す (セクションは本文を包まないので重ならない)
    const range = findQuote(p.annotation.target);
    if (!range) { toast('差し込み位置が見つかりません'); return; }
    const a = p.annotation;
    const ann = { ...a, kind: 'section', id: nextAsideId(), label: p.label, title: a.title || p.label, body: a.body ? (a.kind === 'popover' ? `<p>${esc(a.body)}</p>` : a.body) : `<p><a href="${esc(a.href || '#')}">${esc(a.href || '')}</a></p>` };
    insertSection(range, ann, { turnId: p.turnId, windowId: p.windowId });
  }
  state.pending = state.pending.filter((x) => x.id !== pid);
  await saveDoc(p.turnId);
  await savePending();
  renderSide();
}

async function reject(pid) {
  state.pending = state.pending.filter((x) => x.id !== pid);
  await savePending();
  renderSide();
}

function unwrap(el) {
  el.querySelectorAll(':scope > .aside-pop-body').forEach((x) => x.remove());
  el.replaceWith(...el.childNodes);
}

async function undoTurn(turnId) {
  const d = fdoc();
  for (const el of [...d.querySelectorAll(`[data-aside-turn="${turnId}"]`)].reverse()) {
    if (!el.isConnected) continue;
    if (el.classList.contains('aside-section') || el.classList.contains('aside-pop-more')) el.remove();
    else if (el.classList.contains('aside-edit')) {
      const tpl = d.createElement('template');
      tpl.innerHTML = el.dataset.asideOrig || '';
      el.replaceWith(tpl.content);
    } else unwrap(el);
  }
  d.body.normalize();
  state.pending = state.pending.filter((p) => p.turnId !== turnId);
  await saveDoc();
  await savePending();
  renderSide();
  toast('取り消しました');
}

function renderSide() {
  const pl = $('#pendingList');
  pl.innerHTML = state.pending.length ? '' : '<p class="muted">なし</p>';
  for (const p of state.pending) {
    const div = document.createElement('div');
    div.className = 'item';
    if (p.type === 'edit') {
      div.innerHTML = `<div class="head"><span class="label">本文の書き換え</span></div>
        <div class="diff"><div><del>${esc(p.exact)}</del></div><div><ins>${esc(p.replaceWith.replace(/<[^>]+>/g, ''))}</ins></div></div>
        ${p.reason ? `<div class="reason">${esc(p.reason)}</div>` : ''}
        <div class="actions"><button class="primary" data-act="approve">承認</button><button data-act="reject">却下</button></div>`;
    } else {
      div.innerHTML = `<div class="head"><span class="label">「${esc(p.label)}」が ${esc(p.conflictWith)} と重なった</span></div>
        <div class="reason">${esc((p.annotation.body || p.annotation.href || '').replace(/<[^>]+>/g, '').slice(0, 120))}</div>
        <div class="actions"><button class="primary" data-act="approve">セクションとして追加</button><button data-act="reject">捨てる</button></div>`;
    }
    div.querySelector('[data-act=approve]').onclick = () => approve(p.id);
    div.querySelector('[data-act=reject]').onclick = () => reject(p.id);
    pl.appendChild(div);
  }

  const turns = new Map();
  for (const el of fdoc().querySelectorAll('[data-aside-turn]')) {
    const t = el.dataset.asideTurn;
    if (!turns.has(t)) turns.set(t, { label: el.dataset.asideLabel || '', rows: [] });
    const info = turns.get(t);
    if (!info.label && el.dataset.asideLabel) info.label = el.dataset.asideLabel;
    if (el.classList.contains('aside-ref')) continue;
    if (el.classList.contains('aside-pop-more')) info.rows.push({ kind: 'more' });
    else if (el.dataset.asideId) {
      info.rows.push({ id: el.dataset.asideId, kind: el.dataset.asideKind, label: el.dataset.asideLabel, hasRef: !!fdoc().querySelector(`.aside-ref[data-aside-id="${el.dataset.asideId}"]`) });
    }
  }
  const tl = $('#turnList');
  tl.innerHTML = turns.size ? '' : '<p class="muted">なし</p>';
  for (const [t, info] of [...turns].reverse()) {
    const div = document.createElement('div');
    div.className = 'item';
    const KIND = { popover: 'ポップオーバー', section: 'セクション', link: 'リンク', edit: '本文の書き換え', more: '既存への追記' };
    const rows = info.rows.map((r) => {
      const conv = r.kind === 'popover' ? `<button data-conv="section" data-id="${r.id}">→ セクションにする</button>`
        : r.kind === 'section' && r.hasRef ? `<button data-conv="popover" data-id="${r.id}">→ ポップオーバーにする</button>` : '';
      return `<div class="row"><span class="kinds">${esc(KIND[r.kind] || r.kind)}${r.id ? ` · ${r.id}` : ''}</span>${conv}</div>`;
    }).join('');
    div.innerHTML = `<div class="head"><span class="label">「${esc(info.label)}」</span></div>${rows}
      <div class="actions"><button data-act="jump">見る</button><button data-act="undo">取り消す</button></div>`;
    div.querySelectorAll('[data-conv]').forEach((b) => { b.onclick = () => convertAside(b.dataset.id, b.dataset.conv); });
    div.querySelector('[data-act=undo]').onclick = () => undoTurn(t);
    div.querySelector('[data-act=jump]').onclick = () => fdoc().querySelector(`[data-aside-turn="${t}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    tl.appendChild(div);
  }
}

// ---------- 小窓 ----------

function onDocClick(e) {
  const a = e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  e.preventDefault();
  if (href.startsWith('#')) fdoc().getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  else if (/^https?:/.test(href)) window.open(href, '_blank', 'noopener');
}

function onMouseUp() {
  setTimeout(() => {
    const sel = frame.contentWindow.getSelection();
    // 選択せずにクリックしただけなら、背景のクリックとみなして小窓を閉じる
    // (返答待ちの窓を閉じても、届いた答えは文書に書き込まれる)
    if (!sel || sel.isCollapsed || !sel.rangeCount) { closeAllWindows(); hideAskButton(); return; }
    const range = sel.getRangeAt(0);
    const text = range.toString().trim();
    if (!text || text.length > 200) return;
    if (blockOf(range.startContainer) !== blockOf(range.endContainer)) { toast('1 つの段落の中で選んでください'); return; }
    if (range.startContainer.parentElement?.closest('.aside-pop-body')) return;
    if (state.editing) { showAskButton(range.cloneRange()); return; }
    openWindow(range.cloneRange());
    sel.removeAllRanges();
  }, 0);
}

// ---------- 本文の編集 (人の操作。AI の書き込みより優先) ----------

function setEditing(on) {
  state.editing = on;
  $('#editToggle').classList.toggle('on', on);
  $('#editToggle').textContent = on ? '編集を終える' : '本文を編集';
  const d = fdoc();
  if (d?.body) {
    if (on) d.body.setAttribute('contenteditable', 'true');
    else d.body.removeAttribute('contenteditable');
  }
  hideAskButton();
}

function onDocInput() {
  hideAskButton();
  clearTimeout(onDocInput.timer);
  $('#baseStatus').dataset.saving = '1';
  onDocInput.dirty = true;
  onDocInput.timer = setTimeout(async () => {
    onDocInput.dirty = false;
    await saveDoc(undefined, 'human');
    delete $('#baseStatus').dataset.saving;
    renderSide();
  }, 800);
}

function showAskButton(range) {
  const btn = $('#askBtn');
  const r = range.getBoundingClientRect();
  const fr = frame.getBoundingClientRect();
  btn.style.left = `${Math.min(fr.left + r.right + 4, window.innerWidth - 90)}px`;
  btn.style.top = `${Math.min(Math.max(fr.top + r.top - 30, fr.top + 4), window.innerHeight - 40)}px`;
  btn.hidden = false;
  btn.onclick = () => { hideAskButton(); openWindow(range); };
}

function hideAskButton() { $('#askBtn').hidden = true; }

function openWindow(range) {
  const id = rid('w');
  const r = range.getBoundingClientRect();
  const fr = frame.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'win';
  let left = Math.min(Math.max(8, fr.left + r.left), window.innerWidth - 390);
  let top = fr.top + r.bottom + 8 + 300 > window.innerHeight ? Math.max(8, fr.top + r.top - 300) : fr.top + r.bottom + 8;
  // 既にある窓に重なるなら、その窓の左か右の空いているところへ逃がす。
  // 返答待ちの窓が隠れると、並列に聞いている様子が見えなくなるため
  ({ left, top } = placeAwayFromWindows(left, top));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  const quote = quoteOf(range);
  el.innerHTML = `
    <div class="win-head"><img class="avatar" src="/avatar-smile.jpg" alt=""><span class="term">${esc(quote.exact.trim())}</span><span class="ms"></span><button title="閉じる">×</button></div>
    <div class="win-log"><div class="sys">この語句について聞けます (Enter で送信 / Shift+Enter で改行)</div></div>
    <div class="win-chips">
      <button data-q="この語句を説明して">説明して</button>
      <button data-q="短くポップオーバーで説明して">ポップオーバーで</button>
      <button data-q="詳しく、子セクションを作って解説して">セクションで</button>
      <button data-q="一次情報へのリンクだけ張って">リンクだけ</button>
    </div>
    <div class="win-input"><textarea rows="1" placeholder="質問を入力"></textarea></div>`;
  $('#windows').appendChild(el);
  const win = { id, el, range, quote, sessionId: null, busy: false };
  state.windows.set(id, win);

  const ta = el.querySelector('textarea');
  el.querySelector('.win-head button').onclick = () => { el.remove(); state.windows.delete(id); };
  el.addEventListener('mousedown', () => { el.style.zIndex = ++state.zTop; });
  el.querySelectorAll('.win-chips button').forEach((b) => { b.onclick = () => ask(win, b.dataset.q); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (ta.value.trim()) { ask(win, ta.value.trim()); ta.value = ''; }
    }
  });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; });
  dragBy(el.querySelector('.win-head'), el);
  el.style.zIndex = ++state.zTop;
  ta.focus();
}

const WIN_W = 380;
const WIN_H = 300;

function placeAwayFromWindows(left, top) {
  const rects = [...state.windows.values()].map((w) => w.el.getBoundingClientRect());
  const overlaps = (x, y) => rects.some((r) => x < r.right && x + WIN_W > r.left && y < r.bottom && y + WIN_H > r.top);
  if (!overlaps(left, top)) return { left, top };
  const fits = (x) => x >= 8 && x + WIN_W <= window.innerWidth - 8;
  for (const r of rects) {
    for (const x of [r.left - WIN_W - 10, r.right + 10]) {
      if (fits(x) && !overlaps(x, top)) return { left: x, top };
    }
  }
  // どこにも空きが無ければ、少しずつずらして重ねる (少なくとも下の窓の見出しは見える)
  while (rects.some((r) => Math.abs(r.left - left) < 30 && Math.abs(r.top - top) < 30)) { left += 36; top += 36; }
  return { left, top };
}

function dragBy(handle, el) {
  handle.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    const sx = e.clientX - el.offsetLeft;
    const sy = e.clientY - el.offsetTop;
    const move = (ev) => { el.style.left = `${ev.clientX - sx}px`; el.style.top = `${ev.clientY - sy}px`; };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

function closeAllWindows() {
  for (const w of state.windows.values()) w.el.remove();
  state.windows.clear();
}

function logLine(win, cls, text) {
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = text;
  const log = win.el.querySelector('.win-log');
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

async function ask(win, question) {
  if (win.busy) { toast('この窓は返答待ちです。別の語句なら同時に聞けます'); return; }
  win.busy = true;
  win.el.classList.add('busy');
  win.el.querySelector('.avatar').src = '/avatar-thinking.jpg';
  logLine(win, 'me', question);
  const out = logLine(win, 'ai', '…');
  const turnId = rid('t');
  const started = performance.now();
  let raw = '';
  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        docId: state.docId, windowId: win.id, sessionId: win.sessionId, turnId,
        selection: win.quote.exact, context: win.sessionId ? undefined : contextOf(win.range.collapsed ? findQuote(win.quote) || win.range : win.range),
        asides: asidesSummary(), question,
      }),
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let done = null;
    while (!done) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = (chunk.match(/^event: (.*)$/m) || [])[1];
        const data = JSON.parse((chunk.match(/^data: (.*)$/m) || [])[1] || '{}');
        if (ev === 'delta') {
          raw += data.text;
          // 書き込み指示のブロックは小窓に出さない
          out.textContent = raw.replace(/<ubiqdoc-[\s\S]*?(<\/ubiqdoc-[a-z]+>|\/>)/g, '').replace(/<(u(b(i(q(d(o(c(-[\s\S]*)?)?)?)?)?)?)?)?$/, '').trim() || '…';
          out.parentElement.scrollTop = out.parentElement.scrollHeight;
        } else if (ev === 'done' || ev === 'error') {
          done = { ev, data };
        }
      }
    }
    if (!done) throw new Error('応答が途中で切れました');
    if (done.ev === 'error') throw new Error(done.data.message);
    const ans = done.data;
    win.sessionId = ans.sessionId;
    out.textContent = ans.reply || '(書き込みだけ行った)';
    const lines = await applyAnswer(win, turnId, ans);
    if (ans.parseError) logLine(win, 'err', `書き込み指示を読めなかった: ${ans.parseError}`);
    for (const l of lines) logLine(win, l.error ? 'err' : 'sys', `✎ ${l.text}`);
    win.el.querySelector('.ms').textContent = `${((performance.now() - started) / 1000).toFixed(1)}s`;
  } catch (e) {
    logLine(win, 'err', `エラー: ${e.message}`);
  } finally {
    win.busy = false;
    win.el.classList.remove('busy');
    win.el.querySelector('.avatar').src = '/avatar-smile.jpg';
  }
}

// ---------- 起動 ----------

// 1 本のファイルを開くところまで。`/api/open` は同じファイルなら前の文書を返すので、
// 返ってきた `reused` をそのまま知らせる (二重に開くこと自体は止めない)
async function openPath(src, { inPlace, model } = {}) {
  const r = await api('/api/open', { method: 'POST', body: { path: src, inPlace: !!inPlace, model: model || $('#modelSelect').value } });
  await loadDocList(r.id);
  await openDoc(r.id);
  if (r.reused) toast(`この文書は既に開いています。前の注釈のまま続けます（${r.title || ''}）`);
  if (r.tooLarge) toast('文書が 100KB を超えています。章ごとにファイルを分けると速く・正確になります');
  return r;
}

$('#openForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await openPath($('#openPath').value.trim(), { inPlace: $('#inPlace').checked });
    $('#openPath').value = '';
  } catch (err) { toast(err.message); }
});

$('#editToggle').addEventListener('click', async () => {
  const leaving = state.editing;
  setEditing(!state.editing);
  // 編集を終えたら、直した本文を AI に読み直させる (以後の質問は直した後の文書が前提になる)
  if (leaving) {
    clearTimeout(onDocInput.timer);
    if (onDocInput.dirty) { onDocInput.dirty = false; await saveDoc(undefined, 'human'); }
    await state.saveChain;
    if (state.humanEditsSinceBase > 0 && !state.stale) rebase();
  }
});

$('#rebaseBtn').addEventListener('click', rebase);
$('#sourceRebaseBtn').addEventListener('click', rebase);

$('#docSelect').addEventListener('change', (e) => { if (e.target.value) openDoc(e.target.value); });

$('#modelSelect').addEventListener('change', async (e) => {
  if (!state.docId) return;
  await api(`/api/doc/${state.docId}`, { method: 'PATCH', body: { model: e.target.value } });
  state.meta.model = e.target.value;
  showBase('creating', state.meta);
  pollBase();
});

(async () => {
  const q = new URLSearchParams(location.search);
  // `?open=<絶対パス>` で、外のツール (エディタ・ファイラ・ダッシュボード) からそのまま開ける。
  // 送り手は ubiqdoc の API も data の形も知らなくてよい
  const src = q.get('open');
  if (src) {
    $('#inPlace').checked = q.get('inPlace') !== '0';
    try {
      const r = await openPath(src, { inPlace: $('#inPlace').checked, model: q.get('model') });
      history.replaceState(null, '', `?doc=${r.id}`);
    } catch (e) { toast(e.message); }
    return;
  }
  const id = q.get('doc');
  await loadDocList(id);
  if (id) openDoc(id).catch((e) => toast(e.message));
})();

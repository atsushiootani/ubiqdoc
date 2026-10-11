// 語句を選ぶと「AI に聞く」ボタンを出し、押すと小窓を開く。答えはストリームで届き、補足は host が足す。
// 選ぶたびに窓を開かないのは、Notion では文字を選ぶのがコピーや装飾のためでもあるから
(() => {
  const NS = window.__ubq;
  if (NS.ask && NS.ask.ready) return;
  const { el } = NS.overlay;
  const WIN_W = 380;
  const WIN_H = 300;
  const KIND = { popover: 'ポップオーバー', section: 'セクション', link: 'リンク' };
  const rid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const windows = new Map();
  let z = 20;
  let renderer = null;
  let btn = null;

  function install(opts) {
    renderer = opts.renderer;
    document.addEventListener('mouseup', onMouseUp, true);
  }

  function onMouseUp(e) {
    if (e.target === NS.overlay.host) return;
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) { hideBtn(); return; }
      const range = sel.getRangeAt(0);
      const text = range.toString().trim();
      if (!text || text.length > 200) { hideBtn(); return; }
      const roots = NS.text.roots(renderer.rootSel);
      if (!roots.some((r) => r.contains(range.commonAncestorContainer))) { hideBtn(); return; }
      showBtn(range.cloneRange());
    }, 0);
  }

  function showBtn(range) {
    hideBtn();
    btn = el('button', 'askbtn');
    btn.textContent = 'AI に聞く';
    const r = range.getBoundingClientRect();
    btn.style.left = `${Math.min(r.right + 4, innerWidth - 90)}px`;
    btn.style.top = `${Math.max(4, r.top - 30)}px`;
    btn.onclick = () => { hideBtn(); openWindow(range); };
    NS.overlay.layer.appendChild(btn);
  }

  function hideBtn() { btn?.remove(); btn = null; }

  function quoteOf(range) {
    const { nodes, built } = renderer.textModel();
    const pos = (node, off) => { const i = nodes.indexOf(node); return i >= 0 ? built.starts[i] + off : -1; };
    const s = pos(range.startContainer, range.startOffset);
    const e = pos(range.endContainer, range.endOffset);
    if (s < 0 || e < s) return { exact: range.toString(), prefix: '', suffix: '' };
    return ubqAnchor.quoteAt(built.full, s, e);
  }

  function contextOf(range) {
    const block = NS.blockOf(range.startContainer);
    let heading = '';
    for (const h of document.querySelectorAll('h1, h2, h3')) {
      if (h === block || (h.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING)) heading = h.textContent.trim();
    }
    const text = (block?.innerText || block?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
    return `${heading ? `(見出し: ${heading})\n` : ''}${text}`;
  }

  function placeAwayFromWindows(left, top) {
    const rects = [...windows.values()].map((w) => w.el.getBoundingClientRect());
    const overlaps = (x, y) => rects.some((r) => x < r.right && x + WIN_W > r.left && y < r.bottom && y + WIN_H > r.top);
    if (!overlaps(left, top)) return { left, top };
    const fits = (x) => x >= 8 && x + WIN_W <= innerWidth - 8;
    for (const r of rects) {
      for (const x of [r.left - WIN_W - 10, r.right + 10]) if (fits(x) && !overlaps(x, top)) return { left: x, top };
    }
    while (rects.some((r) => Math.abs(r.left - left) < 30 && Math.abs(r.top - top) < 30)) { left += 36; top += 36; }
    return { left, top };
  }

  function dragBy(handle, box) {
    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const sx = e.clientX - box.offsetLeft;
      const sy = e.clientY - box.offsetTop;
      const move = (ev) => { box.style.left = `${ev.clientX - sx}px`; box.style.top = `${ev.clientY - sy}px`; };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  function logLine(win, cls, text) {
    const div = el('div', cls);
    div.textContent = text;
    const log = win.el.querySelector('.win-log');
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function openWindow(range) {
    const id = rid('w');
    const r = range.getBoundingClientRect();
    let left = Math.min(Math.max(8, r.left), innerWidth - WIN_W - 10);
    let top = r.bottom + 8 + WIN_H > innerHeight ? Math.max(8, r.top - WIN_H) : r.bottom + 8;
    ({ left, top } = placeAwayFromWindows(left, top));
    const box = el('div', 'win');
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    const quote = quoteOf(range);
    box.innerHTML = `
      <div class="win-head"><span class="term"></span><span class="ms"></span><button title="閉じる">×</button></div>
      <div class="win-log"><div class="sys">この語句について聞けます (Enter で送信 / Shift+Enter で改行)</div></div>
      <div class="win-chips">
        <button data-q="この語句を説明して">説明して</button>
        <button data-q="短くポップオーバーで説明して">ポップオーバーで</button>
        <button data-q="詳しく、子セクションを作って解説して">セクションで</button>
        <button data-q="一次情報へのリンクだけ張って">リンクだけ</button>
      </div>
      <div class="win-input"><textarea rows="1" placeholder="質問を入力"></textarea></div>`;
    box.querySelector('.term').textContent = quote.exact.trim();
    NS.overlay.layer.appendChild(box);
    const win = { id, el: box, quote, context: contextOf(range), sessionId: null, busy: false };
    windows.set(id, win);

    const ta = box.querySelector('textarea');
    box.querySelector('.win-head button').onclick = () => { box.remove(); windows.delete(id); };
    box.addEventListener('mousedown', () => { box.style.zIndex = ++z; });
    box.querySelectorAll('.win-chips button').forEach((b) => { b.onclick = () => ask(win, b.dataset.q); });
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();   // Notion のショートカットに食われないように
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (ta.value.trim()) { ask(win, ta.value.trim()); ta.value = ''; }
      }
    });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; });
    dragBy(box.querySelector('.win-head'), box);
    box.style.zIndex = ++z;
    ta.focus();
  }

  // 書き込み指示のタグは小窓に出さない
  const visibleText = (raw) => raw.replace(/<ubiqdoc-[\s\S]*?(<\/ubiqdoc-[a-z]+>|\/>)/g, '').replace(/<(u(b(i(q(d(o(c(-[\s\S]*)?)?)?)?)?)?)?)?$/, '').trim();

  async function ask(win, question) {
    if (win.busy) { NS.overlay.toast('この窓は返答待ちです。別の語句なら同時に聞けます'); return; }
    win.busy = true;
    win.el.classList.add('busy');
    logLine(win, 'me', question);
    const out = logLine(win, 'ai', '…');
    const started = performance.now();
    // 聞いた時点の表示の持ち主。答えが返るまでにページが遷移したら、補足の表示は更新しない
    const url = renderer.view?.url || location.href;
    let raw = '';
    try {
      const res = await NS.request('ask', {
        url, windowId: win.id, sessionId: win.sessionId, turnId: rid('t'),
        selection: win.quote.exact, quote: win.quote, context: win.sessionId ? undefined : win.context,
        asides: renderer.summary(), question,
      }, (ev, data) => {
        if (ev !== 'delta') return;
        raw += data.text;
        out.textContent = visibleText(raw) || '…';
      });
      win.sessionId = res.sessionId;
      out.textContent = res.reply || '(書き込みだけ行った)';
      if (location.href === url) renderer.setView(res.view);
      for (const a of res.added) logLine(win, 'sys', `✎ ${KIND[a.kind] || a.kind}を追加 (${a.id})`);
      for (const p of res.pending) logLine(win, 'sys', `✎ 既存の補足 ${p.conflictWith} と重なったので承認待ちに回した`);
      if (res.unanchored) logLine(win, 'err', `差し込み位置が見つからなかった: ${res.unanchored} 件`);
      if (res.parseError) logLine(win, 'err', `書き込み指示を読めなかった: ${res.parseError}`);
      win.el.querySelector('.ms').textContent = `${((performance.now() - started) / 1000).toFixed(1)}s`;
    } catch (e) {
      logLine(win, 'err', `エラー: ${e.message}`);
    } finally {
      win.busy = false;
      win.el.classList.remove('busy');
    }
  }

  NS.ask = { install, ready: true };
})();

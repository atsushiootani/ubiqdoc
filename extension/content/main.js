// 起動。許可リストのページなら開いたら自動で、ほかのページではツールバーのボタン ('run') で動く
(() => {
  const NS = window.__ubq;
  if (NS.started) return;
  NS.started = true;

  let port = null;
  let seq = 0;
  const pend = new Map();

  function connect() {
    port = chrome.runtime.connect({ name: 'ubq' });
    port.onMessage.addListener((m) => {
      const p = pend.get(m.id);
      if (!p) return;
      if (m.type === 'event') { p.onEvent?.(m.event, m.data); return; }
      pend.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m.data);
    });
    port.onDisconnect.addListener(() => {
      port = null;
      for (const p of pend.values()) p.reject(new Error('拡張との接続が切れました。ページを再読み込みしてください'));
      pend.clear();
    });
  }

  function request(type, payload = {}, onEvent) {
    if (!port) connect();
    const id = `c${++seq}`;
    return new Promise((resolve, reject) => {
      pend.set(id, { resolve, reject, onEvent });
      port.postMessage({ ...payload, type, id });
    });
  }
  NS.request = request;

  let renderer = null;
  let config = null;
  let running = false;

  // 今の表示が属するページの URL (遷移直後でも、表示中の補足の持ち主を指す)
  const viewUrl = () => renderer?.view?.url || location.href;

  async function refresh() {
    if (!renderer) return;
    const url = viewUrl();
    const r = await request('page-view', { url }).catch(() => null);
    if (r?.view && url === viewUrl()) renderer.setView(r.view);
  }

  async function onKnown(a) {
    try {
      const r = await request('mark-known', { url: viewUrl(), annotationId: a.id });
      renderer.setView(r.view);
      NS.overlay.toast(`「${r.label}」を知ってるにしました`, {
        label: '戻す',
        timeout: 8000,
        onClick: async () => {
          try { await request('unmark-known', { conceptId: r.conceptId }); await refresh(); }
          catch (e) { NS.overlay.toast(`ubiqdoc: ${e.message}`); }
        },
      });
    } catch (e) { NS.overlay.toast(`ubiqdoc: ${e.message}`); }
  }

  let rerun = null; // 実行中に遷移したとき、終わってからもう一度走らせる依頼

  async function start(force) {
    if (running) { rerun = { force: !!force }; return; }
    running = true;
    // このページの URL。途中で SPA が遷移したら、以降の結果は捨てる
    const url = location.href;
    const same = () => url === location.href;
    try {
      config = config || await request('config', { url });
      if (!renderer) {
        renderer = new NS.Renderer({ rootSel: config.root, onKnown });
        NS.ask.install({ renderer });
      }
      renderer.rootSel = config.root;
      await NS.text.waitSettled();
      if (!same()) return;
      const rootEls = NS.text.roots(config.root);
      const r = await request('open-page', {
        url, title: document.title,
        text: NS.text.pageText(rootEls), links: NS.text.pageLinks(rootEls), force: !!force,
      }, (ev, data) => {
        if (!same()) return;
        if (ev === 'view') renderer.setView(data);
        else if (ev === 'annotation') renderer.addAnnotation(data);
      });
      if (same()) renderer.setView(r.view);
    } catch (e) {
      if (same()) NS.overlay.toast(`ubiqdoc: ${e.message}`);
    } finally {
      running = false;
      if (!same() || rerun) {
        const req = rerun;
        rerun = null;
        if (!same()) {
          // 遷移していた: 新しいページの設定を取り直し、自動対象か明示の依頼があれば走らせる
          config = await request('config', { url: location.href }).catch(() => null);
          if (config?.auto || req) start(!!req?.force);
        } else if (req) start(req.force);
      }
    }
  }

  // 先に受け口を作っておく。ツールバーのボタンからは、差し込んだ直後に 'run' が届く
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'run') start(!!msg.force);
    else if (msg.type === 'page-updated' && renderer && msg.view?.url && msg.view.key === renderer.view?.key) renderer.setView(msg.view);
    else if (msg.type === 'profile-changed') refresh();
    else if (msg.type === 'jump') renderer?.jump(msg.id);
  });

  // SPA の遷移 (history.pushState) は新しいページとして扱う
  let lastUrl = location.href;
  setInterval(async () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    renderer?.setView({ annotations: [] });
    if (running) return; // 実行中なら、終わった時点で start() の後始末が新しいページを拾う
    config = await request('config', { url: location.href }).catch(() => null);
    if (config?.auto) start(false);
  }, 500);

  (async () => {
    config = await request('config', { url: location.href }).catch(() => null);
    if (config?.auto) start(false);
  })();
})();

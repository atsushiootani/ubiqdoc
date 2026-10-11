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

  async function refresh() {
    if (!renderer) return;
    const r = await request('page-view', { url: location.href }).catch(() => null);
    if (r?.view) renderer.setView(r.view);
  }

  async function onKnown(a) {
    try {
      const r = await request('mark-known', { url: location.href, annotationId: a.id });
      renderer.setView(r.view);
      NS.overlay.toast(`「${r.label}」を知ってるにしました`, {
        label: '戻す',
        timeout: 8000,
        onClick: async () => { await request('unmark-known', { conceptId: r.conceptId }); refresh(); },
      });
    } catch (e) { NS.overlay.toast(`ubiqdoc: ${e.message}`); }
  }

  async function start(force) {
    if (running) return;
    running = true;
    try {
      config = config || await request('config', { url: location.href });
      if (!renderer) {
        renderer = new NS.Renderer({ rootSel: config.root, onKnown });
        NS.ask.install({ renderer });
      }
      renderer.rootSel = config.root;
      await NS.text.waitSettled();
      const rootEls = NS.text.roots(config.root);
      const r = await request('open-page', {
        url: location.href, title: document.title,
        text: NS.text.pageText(rootEls), links: NS.text.pageLinks(rootEls), force: !!force,
      }, (ev, data) => {
        if (ev === 'view') renderer.setView(data);
        else if (ev === 'annotation') renderer.addAnnotation(data);
      });
      renderer.setView(r.view);
    } catch (e) {
      NS.overlay.toast(`ubiqdoc: ${e.message}`);
    } finally {
      running = false;
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
    config = await request('config', { url: location.href }).catch(() => null);
    if (config?.auto) start(false);
  }, 500);

  (async () => {
    config = await request('config', { url: location.href }).catch(() => null);
    if (config?.auto) start(false);
  })();
})();

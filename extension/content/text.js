// 本文の根・テキストノード・本文・リンクを取る。ページの DOM は読むだけで書き換えない
(() => {
  const NS = (window.__ubq = window.__ubq || {});
  if (NS.text) return;
  const LAYER_TAG = 'ubiqdoc-layer';

  function roots(selector) {
    let els = [];
    try { els = [...document.querySelectorAll(selector)]; } catch { /* 不正なセレクタ */ }
    if (!els.length) els = [document.querySelector('main') || document.body];
    // 入れ子になっているものは外側だけ残す
    return els.filter((el) => !els.some((o) => o !== el && o.contains(el)));
  }

  function textNodes(rootEls) {
    const out = [];
    for (const r of rootEls) {
      const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          const p = n.parentElement;
          if (!p || p.closest(`script, style, noscript, ${LAYER_TAG}`)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let n;
      while ((n = w.nextNode())) out.push(n);
    }
    return out;
  }

  const pageText = (rootEls) => rootEls.map((r) => r.innerText).join('\n\n');

  function pageLinks(rootEls) {
    const seen = new Set();
    const out = [];
    for (const r of rootEls) {
      for (const a of r.querySelectorAll('a[href]')) {
        if (!/^https?:/.test(a.href) || seen.has(a.href)) continue;
        seen.add(a.href);
        out.push({ text: a.textContent.trim().slice(0, 80), href: a.href });
      }
    }
    return out;
  }

  // Notion は描画が遅れて続く。DOM の変化が ms 止まるまで待つ (止まらなくても max で打ち切る)
  function waitSettled(ms = 1500, max = 15000) {
    return new Promise((resolve) => {
      let t;
      const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(done, ms); });
      const cap = setTimeout(done, max);
      function done() { obs.disconnect(); clearTimeout(t); clearTimeout(cap); resolve(); }
      obs.observe(document.body, { subtree: true, childList: true, characterData: true });
      t = setTimeout(done, ms);
    });
  }

  NS.text = { roots, textNodes, pageText, pageLinks, waitSettled, LAYER_TAG };
})();

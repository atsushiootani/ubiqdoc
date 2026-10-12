// 補足を描く。語句の印は CSS Custom Highlight API で付け (DOM は変えない)、ポップオーバーとカードは層に出す
(() => {
  const NS = window.__ubq;
  if (NS.Renderer) return;
  const { el } = NS.overlay;
  const ALLOWED = new Set(['H5', 'P', 'UL', 'OL', 'LI', 'CODE', 'PRE', 'STRONG', 'EM', 'B', 'I', 'A', 'BR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'BLOCKQUOTE', 'SPAN']);
  const BLOCK_SEL = '[data-block-id], p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, dd, dt';
  const NAMES = { popover: 'ubiqdoc-pop', section: 'ubiqdoc-sec', link: 'ubiqdoc-link' };

  // AI の書いた HTML を、許可したタグと http(s) のリンクだけにして写す
  function sanitizeInto(html, parent) {
    const src = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
    const copy = (from, to) => {
      for (const n of from.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) { to.appendChild(document.createTextNode(n.data)); continue; }
        if (n.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = /^H[1-6]$/.test(n.tagName) ? 'H5' : n.tagName;
        if (!ALLOWED.has(tag)) { copy(n, to); continue; }
        const e = document.createElement(tag.toLowerCase());
        if (tag === 'A') {
          const href = n.getAttribute('href') || '';
          if (/^https?:/.test(href)) { e.href = href; e.target = '_blank'; e.rel = 'noopener'; }
        }
        copy(n, e);
        to.appendChild(e);
      }
    };
    copy(src, parent);
  }

  function blockOf(node) {
    const e = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return e?.closest(BLOCK_SEL) || e;
  }

  function makeRange(nodes, built, span) {
    const [si, so] = ubqAnchor.locate(built.starts, span.start, false);
    const [ei, eo] = ubqAnchor.locate(built.starts, span.end, true);
    const r = document.createRange();
    r.setStart(nodes[si], so);
    r.setEnd(nodes[ei], eo);
    return r;
  }

  function inside(rects, x, y) {
    for (const r of rects) if (x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1) return true;
    return false;
  }

  // http(s) 以外 (javascript: など) は URL として扱わない
  function safeUrl(u) { return typeof u === 'string' && /^https?:\/\//.test(u) ? u : ''; }

  function shortUrl(u) {
    try { const x = new URL(u); return x.hostname + (x.pathname.length > 1 ? x.pathname.slice(0, 30) : ''); } catch { return u; }
  }

  class Renderer {
    constructor({ rootSel, onKnown }) {
      this.rootSel = rootSel;
      this.onKnown = onKnown;
      this.view = null;
      this.groups = [];
      this.pop = null;
      this.popGroup = null;
      this.hideTimer = 0;
      this.cards = new Map();
      this.frame = 0;
      this.layoutTimer = 0;
      this.observer = new MutationObserver(() => this.scheduleLayout());
      document.addEventListener('mousemove', (e) => this.onMove(e), { passive: true });
      document.addEventListener('click', (e) => this.onClick(e), true);
      window.addEventListener('scroll', () => this.schedulePlace(), { passive: true, capture: true });
      window.addEventListener('resize', () => this.schedulePlace());
    }

    setView(view) { this.view = view; this.layout(); }

    addAnnotation(a) {
      if (!this.view) this.view = { annotations: [] };
      if (!this.view.annotations.some((x) => x.id === a.id)) this.view.annotations.push({ ...a, hidden: false });
      this.scheduleLayout();
    }

    scheduleLayout() { clearTimeout(this.layoutTimer); this.layoutTimer = setTimeout(() => this.layout(), 300); }

    schedulePlace() {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => { this.frame = 0; this.place(); });
    }

    textModel() {
      const roots = NS.text.roots(this.rootSel);
      const nodes = NS.text.textNodes(roots);
      return { roots, nodes, built: ubqAnchor.buildText(nodes.map((n) => n.data)) };
    }

    // 補足の位置を探し直して印を付け直す。Notion の描き直しでテキストノードが入れ替わっても、これで追いつく
    layout() {
      const { roots, nodes, built } = this.textModel();
      this.observer.disconnect();
      for (const r of roots) this.observer.observe(r, { subtree: true, childList: true, characterData: true });
      const groups = new Map();
      for (const a of (this.view?.annotations || []).filter((x) => !x.hidden)) {
        const span = ubqAnchor.findAnchor(built.full, a.anchor);
        if (!span) continue;
        const k = `${span.start}:${span.end}`;
        if (!groups.has(k)) groups.set(k, { key: k, span, range: makeRange(nodes, built, span), items: [] });
        groups.get(k).items.push(a);
      }
      this.groups = [...groups.values()];
      const sets = { popover: [], section: [], link: [] };
      for (const g of this.groups) {
        g.kind = g.items.some((i) => i.kind === 'section') ? 'section' : g.items.every((i) => i.kind === 'link') ? 'link' : 'popover';
        sets[g.kind].push(g.range);
      }
      for (const [kind, name] of Object.entries(NAMES)) CSS.highlights.set(name, new Highlight(...sets[kind]));
      for (const [k, card] of this.cards) if (!groups.has(k)) { card.remove(); this.cards.delete(k); }
      if (this.popGroup) {
        if (groups.has(this.popGroup.key)) this.popGroup = groups.get(this.popGroup.key);
        else this.hidePop();
      }
      this.place();
    }

    hitGroup(x, y) { return this.groups.find((g) => inside(g.range.getClientRects(), x, y)) || null; }

    onMove(e) {
      if (e.target === NS.overlay.host) { clearTimeout(this.hideTimer); return; }
      const g = this.hitGroup(e.clientX, e.clientY);
      if (g && g.kind !== 'section') {
        clearTimeout(this.hideTimer);
        if (this.popGroup?.key !== g.key) this.showPop(g);
      } else if (this.pop) {
        clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => this.hidePop(), 250);
      }
    }

    onClick(e) {
      if (e.target === NS.overlay.host) return;
      const g = this.hitGroup(e.clientX, e.clientY);
      if (!g) return;
      if (g.kind === 'link') {
        const href = safeUrl(g.items.find((i) => safeUrl(i.href))?.href) || safeUrl(g.items[0].sourceUrls?.find(safeUrl));
        if (href) window.open(href, '_blank', 'noopener');
      } else if (g.kind === 'section') {
        this.toggleCard(g);
      }
    }

    itemEl(a, inCard) {
      const box = el('div', 'item');
      if (inCard) {
        const lab = el('div', 'label');
        lab.textContent = `補足 · 「${a.anchor.exact}」`;
        box.appendChild(lab);
        if (a.title) { const h = el('h4'); h.textContent = a.title; box.appendChild(h); }
      }
      const body = el('div', 'body');
      if (a.kind === 'section') sanitizeInto(a.body || '', body);
      else body.textContent = a.kind === 'link' ? (a.href || '') : (a.body || '');
      box.appendChild(body);
      const urls = [...new Set([...(a.sourceUrls || []), ...(a.kind === 'link' ? [a.href] : [])].filter(safeUrl))];
      if (urls.length) {
        const src = el('div', 'src');
        src.append('出典: ');
        urls.forEach((u, i) => {
          if (i) src.append(' ');
          const l = document.createElement('a');
          l.href = u; l.target = '_blank'; l.rel = 'noopener'; l.textContent = shortUrl(u);
          src.appendChild(l);
        });
        box.appendChild(src);
      }
      const acts = el('div', 'acts');
      const known = el('button');
      known.textContent = '知ってる';
      // ページ側のスクリプトが押した「知ってる」(isTrusted が false) では、プロフィールを書き換えない
      known.onclick = (e) => { if (!e.isTrusted) return; this.hidePop(); this.onKnown(a); };
      acts.appendChild(known);
      box.appendChild(acts);
      return box;
    }

    showPop(g) {
      this.hidePop();
      const pop = el('div', 'pop');
      for (const a of g.items) pop.appendChild(this.itemEl(a, false));
      NS.overlay.layer.appendChild(pop);
      this.pop = pop;
      this.popGroup = g;
      this.place();
    }

    hidePop() { this.pop?.remove(); this.pop = null; this.popGroup = null; }

    toggleCard(g) {
      if (this.cards.has(g.key)) { this.cards.get(g.key).remove(); this.cards.delete(g.key); return; }
      const card = el('div', 'card');
      const close = el('button', 'close');
      close.textContent = '×';
      close.onclick = () => { card.remove(); this.cards.delete(g.key); };
      card.appendChild(close);
      for (const a of g.items) card.appendChild(this.itemEl(a, true));
      NS.overlay.layer.appendChild(card);
      this.cards.set(g.key, card);
      this.place();
    }

    place() {
      if (this.pop && this.popGroup) {
        const r = this.popGroup.range.getBoundingClientRect();
        const h = this.pop.offsetHeight;
        const top = r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - 6 - h) : r.bottom + 6;
        this.pop.style.left = `${Math.min(Math.max(8, r.left), innerWidth - 370)}px`;
        this.pop.style.top = `${top}px`;
      }
      for (const [k, card] of this.cards) {
        const g = this.groups.find((x) => x.key === k);
        if (!g) continue;
        const r = (blockOf(g.range.startContainer) || g.range).getBoundingClientRect();
        card.style.left = `${Math.max(8, r.left)}px`;
        card.style.top = `${r.bottom + 4}px`;
        card.style.width = `${Math.min(640, Math.max(280, r.width))}px`;
      }
    }

    jump(id) {
      const g = this.groups.find((x) => x.items.some((i) => i.id === id));
      g?.range.startContainer.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    summary() {
      return (this.view?.annotations || []).map((a) => `- ${a.id} ${a.kind}「${a.anchor.exact}」: ${String(a.body || a.href || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 80)}`).join('\n');
    }
  }

  NS.Renderer = Renderer;
  NS.blockOf = blockOf;
})();

// 最前面の層。<html> の直下に <ubiqdoc-layer> を 1 つ置き、その Shadow DOM の中にだけ描く。
// 本文の DOM には触らない (Notion は閲覧中も contenteditable なので、包むと本文として保存されるおそれがある)
(() => {
  const NS = window.__ubq;
  if (NS.overlay) return;

  const CSS = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; font: 13px/1.6 -apple-system, "Hiragino Sans", sans-serif; color: #1b1e21; }
.layer > * { pointer-events: auto; }
button { font: inherit; font-size: 12px; padding: 1px 8px; border-radius: 6px; border: 1px solid rgba(127,127,127,.5); background: transparent; color: inherit; cursor: pointer; }
a { color: #1a73e8; }
.pop { position: fixed; max-width: 360px; max-height: 320px; overflow: auto; padding: 8px 10px; border-radius: 8px; background: #1f2328; color: #f1f3f4; box-shadow: 0 6px 18px rgba(0,0,0,.25); white-space: pre-line; }
.pop a { color: #8ab4f8; }
.item + .item { margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(127,127,127,.35); }
.src { font-size: 12px; opacity: .85; margin-top: 4px; white-space: normal; }
.acts { margin-top: 6px; display: flex; gap: 6px; }
.card { position: fixed; max-height: 50vh; overflow: auto; padding: 10px 14px; border-left: 3px solid #e8a71a; border-radius: 0 8px 8px 0; background: #fffaf0; box-shadow: 0 6px 18px rgba(0,0,0,.18); }
.card .label { font-size: 11px; letter-spacing: .04em; opacity: .65; }
.card h4 { margin: 0 0 6px; font-size: 14px; }
.card { padding-right: 30px; }
/* .label の opacity が重なりの文脈を作り、後ろに描かれるラベルが × を覆ってしまうので前に出す */
.card .close { position: absolute; top: 4px; right: 6px; z-index: 1; border: 0; font-size: 14px; }
.toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); padding: 8px 14px; border-radius: 8px; background: #1f2328; color: #fff; display: flex; gap: 12px; align-items: center; }
.toast button { color: #8ab4f8; border-color: #8ab4f8; }
.askbtn { position: fixed; padding: 3px 10px; border-radius: 6px; background: #1a73e8; color: #fff; border: 0; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
.win { position: fixed; width: 380px; max-height: 420px; display: flex; flex-direction: column; background: #15181b; color: #d8dee3; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.35); font: 12.5px/1.55 ui-monospace, "SF Mono", Menlo, monospace; overflow: hidden; }
.win-head { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: rgba(255,255,255,.06); cursor: move; }
.win-head .term { color: #7cc4ff; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.win-head .ms { color: #7d878f; }
.win-head button { border: 0; color: #7d878f; font-size: 14px; padding: 0 2px; }
.win-log { flex: 1; overflow: auto; padding: 8px 10px; white-space: pre-wrap; word-break: break-word; }
.win-log .me { color: #7cc4ff; } .win-log .me::before { content: "› "; }
.win-log .sys { color: #7d878f; } .win-log .err { color: #ff8a80; }
.win-log > div + div { margin-top: 6px; }
.win-chips { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 10px 6px; }
.win-chips button { background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); color: #d8dee3; border-radius: 4px; padding: 1px 6px; font-size: 11.5px; }
.win-input { display: flex; gap: 6px; border-top: 1px solid rgba(255,255,255,.08); padding: 6px 10px; }
.win-input::before { content: "›"; color: #7cc4ff; }
.win-input textarea { flex: 1; resize: none; border: 0; outline: 0; background: transparent; color: #d8dee3; font: inherit; min-height: 1.55em; max-height: 6em; }
.win.busy .win-input textarea { opacity: .5; }
@media (prefers-color-scheme: dark) {
  .layer { color: #e4e8ea; }
  .pop { background: #e8eaed; color: #1b1e21; } .pop a { color: #1a73e8; }
  .card { background: #2a2620; }
}`;

  // 語句の印 (::highlight) の見た目。<head> に置くので本文の DOM は変わらない
  const HIGHLIGHT_CSS = `
::highlight(ubiqdoc-pop) { background-color: rgba(26,115,232,.12); text-decoration: underline dotted 1.5px #1a73e8; }
::highlight(ubiqdoc-sec) { background-color: rgba(232,167,26,.14); text-decoration: underline solid 1.5px #e8a71a; }
::highlight(ubiqdoc-link) { background-color: rgba(24,128,56,.10); text-decoration: underline dotted 1.5px #188038; }`;

  const host = document.createElement(NS.text.LAYER_TAG);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style><div class="layer"></div>`;
  document.documentElement.appendChild(host);
  const layer = root.querySelector('.layer');

  if (!document.getElementById('ubiqdoc-highlight')) {
    const st = document.createElement('style');
    st.id = 'ubiqdoc-highlight';
    st.textContent = HIGHLIGHT_CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  let toastTimer = 0;
  function toast(msg, action) {
    root.querySelector('.toast')?.remove();
    const t = el('div', 'toast');
    const span = el('span');
    span.textContent = msg;
    t.appendChild(span);
    if (action) {
      const b = el('button');
      b.textContent = action.label;
      // ページ側のスクリプトが押した「戻す」などは受け付けない
      b.onclick = (e) => { if (!e.isTrusted) return; t.remove(); action.onClick(); };
      t.appendChild(b);
    }
    layer.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), action?.timeout || 4000);
  }

  NS.overlay = { host, root, layer, el, toast };
})();

// 補足の位置を「本文の文字列 + テキストノードの開始位置の表」で探す。
// DOM に触らない純粋な関数だけにしてあるので、拡張 (content script) と host (Node) の両方で使う
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ubqAnchor = api;
}(typeof self !== 'undefined' ? self : this, () => {
  const CTX = 24;

  function buildText(texts) {
    let full = '';
    const starts = [];
    for (const t of texts) { starts.push(full.length); full += t; }
    return { full, starts };
  }

  // pos がノードの境目のとき、始まり (isEnd=false) は次のノードの 0、終わり (isEnd=true) は前のノードの末尾に寄せる
  function locate(starts, pos, isEnd) {
    for (let i = starts.length - 1; i >= 0; i--) {
      if (starts[i] < pos || (!isEnd && starts[i] === pos)) return [i, pos - starts[i]];
    }
    return [0, 0];
  }

  function commonSuffixLen(a, b) {
    let n = 0;
    while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
    return n;
  }

  function commonPrefixLen(a, b) {
    let n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n++;
    return n;
  }

  // 空白の違い (改行・連続空白) を無視して探す。Notion と innerText で空白の入り方が違うため
  function findLoose(full, exact) {
    const map = [];
    let squashed = '';
    for (let i = 0; i < full.length; i++) {
      const ws = /\s/.test(full[i]);
      if (ws && squashed.endsWith(' ')) continue;
      squashed += ws ? ' ' : full[i];
      map.push(i);
    }
    const ex = exact.replace(/\s+/g, ' ').trim();
    if (!ex) return null;
    const at = squashed.indexOf(ex);
    if (at < 0) return null;
    return { start: map[at], end: map[at + ex.length - 1] + 1 };
  }

  function findAnchor(full, anchor) {
    const exact = anchor && anchor.exact;
    if (!exact) return null;
    const hits = [];
    for (let i = full.indexOf(exact); i >= 0; i = full.indexOf(exact, i + 1)) hits.push(i);
    if (!hits.length) return findLoose(full, exact);
    let best = hits[0];
    let bestScore = -1;
    for (const h of hits) {
      const score = commonSuffixLen(full.slice(Math.max(0, h - CTX), h), anchor.prefix || '')
        + commonPrefixLen(full.slice(h + exact.length, h + exact.length + CTX), anchor.suffix || '');
      if (score > bestScore) { bestScore = score; best = h; }
    }
    return { start: best, end: best + exact.length };
  }

  function quoteAt(full, start, end) {
    return { exact: full.slice(start, end), prefix: full.slice(Math.max(0, start - CTX), start), suffix: full.slice(end, end + CTX) };
  }

  function overlaps(a, b) { return a.start < b.end && b.start < a.end; }

  return { CTX, buildText, locate, findAnchor, quoteAt, overlaps };
}));

// 概念キーの正規化。「知ってる」の照合は、キーと別名をこれで正規化して比べる。
// AI には「Wikipedia 英語版の見出し語に寄せた小文字のキー」を書かせているが、
// 実際には optimistic-locking / Optimistic Locking / optimistic_locking のように揺れる

function singular(w) {
  if (!/^[a-z]+$/.test(w) || w.length < 4) return w;
  if (/(ss|us|is)$/.test(w)) return w;
  if (/ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

function normalizeKey(s) {
  const t = String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  if (!t) return '';
  return t.split('-').map(singular).join('-');
}

module.exports = { normalizeKey };

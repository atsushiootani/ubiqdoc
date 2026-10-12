// 補足の追加・重なり・付け直し・取り消し・変換・承認。page を受け取って書き換える純粋な関数だけを置く。
// 保存は呼び出し側 (host.js / proactive.js) が pages.save で行う
const { findAnchor, overlaps } = require('../extension/lib/anchor.js');
const { normalizeKey } = require('../core/concept.js');

const LIMIT = 20;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stripTags = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const rid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function nextAnnotationId(page) {
  let max = 0;
  for (const a of page.annotations) {
    const n = parseInt(String(a.id).slice(2), 10);
    if (n > max) max = n;
  }
  return `a_${String(max + 1).padStart(2, '0')}`;
}

// 同じ範囲なら重ねて足す (表示ではまとめて 1 つのポップオーバーに出す)。
// 一部だけ重なるなら、ドラッグして聞いたものは承認待ち、先回りのものは捨てる
function addAnnotation(page, text, ann, { onConflict }) {
  const span = findAnchor(text, ann.anchor);
  if (!span) return { status: 'unanchored' };
  for (const other of page.annotations) {
    if (other.state !== 'shown') continue;
    const os = findAnchor(text, other.anchor);
    if (!os || (os.start === span.start && os.end === span.end) || !overlaps(os, span)) continue;
    if (onConflict === 'skip') return { status: 'skipped' };
    const p = { id: rid('p'), type: 'conflict', turnId: ann.turnId, annotation: ann, conflictWith: other.id, label: ann.anchor.exact.slice(0, 40) };
    page.pending.push(p);
    return { status: 'pending', pending: p };
  }
  const a = { ...ann, id: nextAnnotationId(page), state: 'shown', createdAt: new Date().toISOString() };
  page.annotations.push(a);
  return { status: 'added', annotation: a };
}

// 「知ってる」で照合する概念。小窓で聞いた補足には concept が無いことがあるので、
// そのときは選んだ語句そのものを概念として扱う (記録には書き足さない。知ってるはプロフィールにだけ残す)
function conceptOf(a) {
  if (a.concept) return a.concept;
  return a.anchor && a.anchor.exact ? { key: a.anchor.exact, label: a.anchor.exact } : null;
}

function isVisible(a, profile) {
  const c = conceptOf(a);
  return a.state === 'shown' && !(c && profile.knows(c));
}

function selectConcepts(concepts, { page, profile }) {
  const taken = new Set(page.annotations.filter((a) => a.state === 'shown' && a.concept).map((a) => normalizeKey(a.concept.key)));
  const room = LIMIT - page.annotations.filter((a) => a.origin === 'proactive' && isVisible(a, profile)).length;
  if (room <= 0) return [];
  const seen = new Set();
  const out = [];
  for (const c of [...concepts].sort((x, y) => y.importance - x.importance)) {
    const k = normalizeKey(c.key);
    if (!k || seen.has(k) || taken.has(k) || profile.knows(c)) continue;
    seen.add(k);
    out.push(c);
  }
  return out.slice(0, room);
}

function reanchor(page, text) {
  const lost = [];
  for (const a of page.annotations) {
    if (a.state === 'shown' && !findAnchor(text, a.anchor)) { a.state = 'orphaned'; lost.push(a.id); }
  }
  return lost;
}

function undoTurn(page, turnId) {
  const before = page.annotations.length + page.pending.length;
  page.annotations = page.annotations.filter((a) => a.turnId !== turnId);
  page.pending = page.pending.filter((p) => p.turnId !== turnId);
  return before - page.annotations.length - page.pending.length;
}

function convert(page, id, to) {
  const a = page.annotations.find((x) => x.id === id);
  if (!a) return false;
  if (to === 'section' && a.kind === 'popover') {
    if (a.savedSection) {
      a.title = a.savedSection.title;
      a.body = a.savedSection.body;
      delete a.savedSection;
    } else {
      a.title = a.title || a.anchor.exact;
      a.body = `<p>${esc(a.body || '')}</p>`;
    }
    a.kind = 'section';
    return true;
  }
  if (to === 'popover' && a.kind === 'section') {
    a.savedSection = { title: a.title, body: a.body };
    a.body = stripTags(a.body).slice(0, 400);
    a.kind = 'popover';
    return true;
  }
  return false;
}

function approve(page, pid) {
  const p = page.pending.find((x) => x.id === pid);
  if (!p) return null;
  page.pending = page.pending.filter((x) => x.id !== pid);
  const src = p.annotation;
  const body = src.kind === 'popover' ? `<p>${esc(src.body || '')}</p>`
    : src.kind === 'link' ? `<p><a href="${esc(src.href || '')}">${esc(src.href || '')}</a></p>`
      : src.body;
  const a = { ...src, kind: 'section', title: src.title || p.label, body, id: nextAnnotationId(page), state: 'shown', createdAt: new Date().toISOString() };
  page.annotations.push(a);
  return a;
}

function reject(page, pid) {
  const n = page.pending.length;
  page.pending = page.pending.filter((x) => x.id !== pid);
  return n !== page.pending.length;
}

function discardOrphan(page, id) {
  const n = page.annotations.length;
  page.annotations = page.annotations.filter((a) => !(a.id === id && a.state === 'orphaned'));
  return n !== page.annotations.length;
}

// 見えている先回りの補足は LIMIT 個までにする (古い順に残す)。上限は抜き出しのときにも守っているが、
// 「知ってる」→ やり直す → 「戻す」の順に操作すると、隠れていたぶんが戻って上限を超えるため
function withinLimit(list) {
  let n = 0;
  return list.filter((a) => a.origin !== 'proactive' || a.hidden || ++n <= LIMIT);
}

function view(page, profile, key) {
  return {
    key, url: page.url, title: page.title, model: page.model,
    annotations: withinLimit(page.annotations.filter((a) => a.state === 'shown').map((a) => ({ ...a, hidden: !isVisible(a, profile) }))),
    orphaned: page.annotations.filter((a) => a.state === 'orphaned'),
    pending: page.pending,
    dropped: page.dropped,
    truncated: !!page.truncated,
  };
}

module.exports = { LIMIT, addAnnotation, conceptOf, isVisible, selectConcepts, reanchor, undoTurn, convert, approve, reject, discardOrphan, view };

// <ubiqdoc-*> タグを読む。HTML リーダーと拡張で共通。
// 書き込み指示は JSON ではなくタグで書かせている。長い HTML を JSON 文字列に入れさせると、
// Haiku が閉じの " を 」 と書き間違えるなどしてパースが壊れた (2026-10-01 の試験で発生)

function parseAttrs(str) {
  const out = {};
  for (const m of str.matchAll(/([a-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = m[2] ?? m[3];
  return out;
}

const TAG_SRC = '<ubiqdoc-(popover|section|link|edit)\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/ubiqdoc-\\1>)';
const CONCEPT_SRC = '<ubiqdoc-concept\\b([^>]*?)\\/?>';
const tagRe = () => new RegExp(TAG_SRC, 'g');

const category = (v) => (v === 'personal' ? 'personal' : 'work');

function toAnnotation(kind, at, inner) {
  const a = {
    kind,
    target: !at.target || at.target === 'selection' ? 'selection' : { exact: at.target, prefix: at.prefix || '' },
    title: at.title,
    href: /^https?:\/\/\S+$/.test(at.href || '') ? at.href : undefined,
    body: inner.trim(),
    dependsOn: (at.depends || '').split(/[\s,]+/).filter((x) => /^a_\d+$/.test(x)),
    sourceUrls: (at.source || '').split(/\s+/).filter((u) => /^https?:\/\/\S+$/.test(u)),
  };
  if (at.concept) a.concept = { key: at.concept, category: category(at.category) };
  return a;
}

function parseAnswer(text) {
  const annotations = [];
  const edits = [];
  for (const m of text.matchAll(tagRe())) {
    const [, kind, attrStr, inner = ''] = m;
    const at = parseAttrs(attrStr);
    if (kind === 'edit') {
      if (at.exact) edits.push({ exact: at.exact, replaceWith: inner.trim(), reason: at.reason || '' });
      continue;
    }
    annotations.push(toAnnotation(kind, at, inner));
  }
  const reply = text.replace(tagRe(), '').replace(/<ubiqdoc-concept\b[^>]*>/g, '').replace(/<ubiqdoc-[\s\S]*$/, '').trim();
  const broken = !annotations.length && !edits.length && /<ubiqdoc-(popover|section|link|edit)/.test(text);
  return { reply, annotations, edits, parseError: broken ? '閉じていないタグがある' : undefined };
}

function parseConcepts(text) {
  const out = [];
  for (const m of text.matchAll(new RegExp(CONCEPT_SRC, 'g'))) {
    const at = parseAttrs(m[1]);
    if (!at.key || !at.exact) continue;
    const imp = parseInt(at.importance, 10);
    out.push({
      key: at.key,
      label: at.label || at.exact,
      category: category(at.category),
      importance: Number.isFinite(imp) ? Math.min(5, Math.max(1, imp)) : 3,
      exact: at.exact,
      prefix: at.prefix || '',
    });
  }
  return out;
}

// ストリームで届く答えから、閉じたタグを閉じた順に取り出す
class TagStream {
  constructor() { this.buf = ''; this.pos = 0; }
  push(text) {
    this.buf += text;
    const re = tagRe();
    re.lastIndex = this.pos;
    const out = [];
    let m;
    while ((m = re.exec(this.buf))) { out.push(m[0]); this.pos = re.lastIndex; }
    return out;
  }
}

module.exports = { parseAnswer, parseConcepts, TagStream };

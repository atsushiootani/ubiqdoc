// 先回りの 3 段: 抜き出し (fork) → 索引で照合 (LLM なし) → 補足を書く (fork、タグが閉じるたびに足す)
const { extractPrompt, writePrompt } = require('../core/prompts.js');
const { parseConcepts, parseAnswer, TagStream } = require('../core/answer.js');
const { normalizeKey } = require('../core/concept.js');
const ops = require('./page-ops.js');

const rid = () => `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function runProactive({ key, pages, bases, profile, emit }) {
  const page = pages.get(key);
  const text = pages.readText(key);
  const turnId = rid();

  emit('progress', { stage: 'extract', made: 0, total: 0 });
  const r1 = await bases.fork(key, extractPrompt());
  pages.log(key, 'proactive', { at: new Date().toISOString(), turnId, stage: 'extract', result: r1.result });
  const picked = ops.selectConcepts(parseConcepts(r1.result || ''), { page, profile });
  if (!picked.length) {
    emit('progress', { stage: 'done', made: 0, total: 0 });
    return { made: 0 };
  }

  let made = 0;
  emit('progress', { stage: 'write', made, total: picked.length });
  const byKey = new Map(picked.map((c) => [normalizeKey(c.key), c]));
  const take = (raw) => {
    const a = parseAnswer(raw).annotations[0];
    const c = a && a.concept && byKey.get(normalizeKey(a.concept.key));
    if (!c) return;                               // 頼んでいない概念は捨てる
    byKey.delete(normalizeKey(c.key));            // 同じ概念を 2 回書いてきても 1 つだけ
    if (!a.sourceUrls.length) {
      page.dropped.noSource = (page.dropped.noSource || 0) + 1;
      pages.save(key);
      return;
    }
    const anchor = a.target === 'selection' ? { exact: c.exact, prefix: c.prefix } : { exact: a.target.exact, prefix: a.target.prefix || c.prefix };
    const res = ops.addAnnotation(page, text, {
      turnId, origin: 'proactive',
      concept: { key: c.key, label: c.label, category: c.category },
      kind: a.kind, anchor, title: a.title, body: a.body, href: a.href,
      sourceUrls: a.sourceUrls, dependsOn: [],
    }, { onConflict: 'skip' });
    if (res.status !== 'added') return;
    made++;
    pages.save(key);
    emit('annotation', res.annotation);
    emit('progress', { stage: 'write', made, total: picked.length });
  };

  const stream = new TagStream();
  let streamed = false;
  const r3 = await bases.fork(key, writePrompt(picked), { onDelta: (t) => { streamed = true; stream.push(t).forEach(take); } });
  if (!streamed) new TagStream().push(r3.result || '').forEach(take);
  pages.log(key, 'proactive', { at: new Date().toISOString(), turnId, stage: 'write', result: r3.result });
  emit('progress', { stage: 'done', made, total: picked.length });
  return { made };
}

module.exports = { runProactive };

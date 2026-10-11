#!/usr/bin/env node
// ubiqdoc の native messaging host。Chrome の拡張から呼ばれたときだけ起動する。
// stdout は Chrome との通信路なので、ログは必ず stderr に出す
console.log = (...a) => console.error(...a);

const path = require('path');
const { encode, Decoder } = require('./framing.js');
const { checkDataDir } = require('./guard.js');
const { Profile } = require('./profile.js');
const { Pages, pageKey, textHash } = require('./pages.js');
const { Bases } = require('./bases.js');
const { runProactive } = require('./proactive.js');
const ops = require('./page-ops.js');
const { askFirstPrompt, askFollowupPrompt } = require('../core/prompts.js');
const { parseAnswer } = require('../core/answer.js');

const MODELS = ['haiku', 'sonnet', 'opus'];
const MAX_TEXT = 100 * 1024;

function createHost({ dataDir, run } = {}) {
  const guard = checkDataDir(dataDir);
  const profile = new Profile(path.join(dataDir, 'profile'));
  if (guard.ok) profile.load();
  const pages = new Pages(dataDir);
  const bases = new Bases(run ? { pages, run } : { pages });
  const running = new Map();   // key → 先回りの実行中の Promise
  const status = new Map();    // key → 最後の progress

  const viewOf = (key) => ops.view(pages.get(key), profile, key);
  const mustPage = (url) => {
    const key = pageKey(url);
    const page = pages.get(key);
    if (!page) throw new Error('このページはまだ開かれていません');
    return { key, page };
  };
  const mutate = (url, fn) => {
    const { key, page } = mustPage(url);
    fn(page);
    pages.save(key);
    return { view: viewOf(key) };
  };

  const handlers = {
    hello: () => ({ ok: guard.ok, reason: guard.reason }),

    'open-page': async (m, emit) => {
      if (!/^(https?|file):/.test(m.url || '')) throw new Error('対応していない URL です');
      const key = pageKey(m.url);
      const page = pages.get(key) || pages.create(key, m.url, m.title || '');
      page.title = m.title || page.title;
      page.model = MODELS.includes(m.model) ? m.model : 'haiku';
      let text = String(m.text || '');
      page.truncated = text.length > MAX_TEXT;
      if (page.truncated) text = text.slice(0, MAX_TEXT);
      page.links = (m.links || []).filter((l) => /^https?:/.test(l.href || '')).slice(0, 200)
        .map((l) => ({ text: String(l.text || '').slice(0, 80), href: l.href }));
      const changed = page.textHash !== textHash(text);
      if (changed) {
        pages.writeText(key, text);
        ops.reanchor(page, text);
      }
      pages.save(key);
      emit('view', viewOf(key));
      if (changed || m.force || !page.proactiveAt) {
        if (!running.has(key)) {
          const job = runProactive({
            key, pages, bases, profile,
            emit: (ev, d) => { if (ev === 'progress') status.set(key, d); emit(ev, d); },
          }).then((r) => {
            pages.get(key).proactiveAt = new Date().toISOString();
            pages.save(key);
            return r;
          }).finally(() => running.delete(key));
          running.set(key, job);
        }
        await running.get(key);
      }
      return { view: viewOf(key) };
    },

    'page-view': (m) => {
      const key = pageKey(m.url);
      return pages.get(key) ? { view: viewOf(key), status: status.get(key) || null } : { view: null, status: null };
    },

    ask: async (m, emit) => {
      const { key, page } = mustPage(m.url);
      if (!/^w_[a-z0-9]+$/.test(m.windowId || '')) throw new Error('bad windowId');
      const started = Date.now();
      const onDelta = (t) => emit('delta', { text: t });
      const r = m.sessionId
        ? await bases.resume(key, m.sessionId, askFollowupPrompt(m), { onDelta })
        : await bases.fork(key, askFirstPrompt(m), { onDelta });
      const parsed = parseAnswer(r.result || '');
      const text = pages.readText(key);
      const added = [];
      const pending = [];
      let unanchored = 0;
      for (const a of parsed.annotations) {
        if (a.kind === 'link' && !/^https?:\/\//.test(a.href || '')) { unanchored++; continue; }
        const anchor = a.target === 'selection' ? m.quote : { exact: a.target.exact, prefix: a.target.prefix };
        const res = ops.addAnnotation(page, text, {
          turnId: m.turnId, windowId: m.windowId, origin: 'ask',
          concept: a.concept ? { ...a.concept, label: anchor.exact } : undefined,
          kind: a.kind, anchor, title: a.title, body: a.body, href: a.href,
          sourceUrls: a.sourceUrls, dependsOn: a.dependsOn,
        }, { onConflict: 'pending' });
        if (res.status === 'added') added.push(res.annotation);
        else if (res.status === 'pending') pending.push(res.pending);
        else unanchored++;
      }
      pages.save(key);
      const ms = Date.now() - started;
      pages.log(key, m.windowId, { at: new Date().toISOString(), turnId: m.turnId, model: page.model, ms, sessionId: r.session_id, question: m.question, result: r.result });
      return { reply: parsed.reply, added, pending, unanchored, parseError: parsed.parseError, sessionId: r.session_id, ms, view: viewOf(key) };
    },

    'mark-known': (m) => {
      const { key, page } = mustPage(m.url);
      const a = page.annotations.find((x) => x.id === m.annotationId);
      if (!a) throw new Error('補足が見つかりません');
      const concept = ops.conceptOf(a);
      const category = (a.concept && a.concept.category) || 'work';
      const c = profile.add({ key: concept.key, label: concept.label || a.anchor.exact, category, aliases: [a.anchor.exact], fromUrl: page.url });
      return { conceptId: c.id, label: c.label, view: viewOf(key) };
    },
    'unmark-known': (m) => ({ removed: !!profile.remove(m.conceptId) }),
    'profile-list': () => profile.list(),
    // 封筒の id と被るので conceptId で受ける
    'profile-remove': (m) => ({ removed: !!profile.remove(m.conceptId) }),
    'undo-turn': (m) => mutate(m.url, (p) => ops.undoTurn(p, m.turnId)),
    // 要求の封筒の id と被るため、補足の id は annotationId で受ける
    convert: (m) => mutate(m.url, (p) => ops.convert(p, m.annotationId, m.to)),
    approve: (m) => mutate(m.url, (p) => ops.approve(p, m.pid)),
    reject: (m) => mutate(m.url, (p) => ops.reject(p, m.pid)),
    'discard-orphan': (m) => mutate(m.url, (p) => ops.discardOrphan(p, m.annotationId)),
  };

  async function handle(msg, send) {
    const { id, type } = msg;
    const emit = (event, data) => send({ id, type: 'event', event, data });
    try {
      if (!guard.ok && type !== 'hello') throw new Error(guard.reason);
      const h = handlers[type];
      if (!h) throw new Error(`unknown request: ${type}`);
      send({ id, type: 'result', data: await h(msg, emit) });
    } catch (e) {
      console.error(`[${type}]`, e.message);
      send({ id, type: 'error', message: e.message });
    }
  }

  return { handle };
}

if (require.main === module) {
  const dataDir = process.env.UBIQDOC_DATA_DIR || path.join(__dirname, '..', 'data');
  const host = createHost({ dataDir });
  const send = (obj) => process.stdout.write(encode(obj));
  const dec = new Decoder((msg) => { host.handle(msg, send); });
  process.stdin.on('data', (c) => dec.push(c));
  process.stdin.on('end', () => process.exit(0));
}

module.exports = { createHost };

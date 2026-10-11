// ページごとのベースセッション。本文とリンクの一覧を読ませて「OK」とだけ返させたセッションで、
// 抜き出し・補足書き・質問はどれもここから fork する (本文ぶんがプロンプトキャッシュに乗る)
const { runClaude } = require('../core/claude.js');
const { EXT_SYSTEM_PROMPT, basePrompt } = require('../core/prompts.js');
const { textHash } = require('./pages.js');

class Bases {
  constructor({ pages, run = runClaude }) {
    this.pages = pages;
    this.run = run;
    this.creating = new Map();
  }

  opts(extra = {}) { return { systemPrompt: EXT_SYSTEM_PROMPT, ...extra }; }

  ensure(key) {
    const page = this.pages.get(key);
    const text = this.pages.readText(key);
    const hash = textHash(text);
    if (page.baseSessionId && page.baseModel === page.model && page.textHash === hash) return Promise.resolve(page.baseSessionId);
    const ck = `${key}:${hash}:${page.model}`;
    if (this.creating.has(ck)) return this.creating.get(ck);
    const model = page.model;
    const p = this.run(['--model', model], basePrompt(text, page.links), this.opts())
      .then((r) => {
        const pg = this.pages.get(key);
        pg.baseSessionId = r.session_id;
        pg.baseModel = model;
        pg.textHash = hash;
        this.pages.save(key);
        return r.session_id;
      })
      .finally(() => this.creating.delete(ck));
    this.creating.set(ck, p);
    return p;
  }

  async fork(key, prompt, { onDelta } = {}) {
    const go = async (retry) => {
      const base = await this.ensure(key);
      const page = this.pages.get(key);
      try {
        return await this.run(['--model', page.model, '--resume', base, '--fork-session'], prompt, this.opts({ onDelta }));
      } catch (e) {
        if (retry && /No conversation found/i.test(e.message)) {
          page.baseSessionId = null;
          this.pages.save(key);
          return go(false);
        }
        throw e;
      }
    };
    return go(true);
  }

  resume(key, sessionId, prompt, { onDelta } = {}) {
    const page = this.pages.get(key);
    return this.run(['--model', page.model, '--resume', sessionId], prompt, this.opts({ onDelta }));
  }
}

module.exports = { Bases };

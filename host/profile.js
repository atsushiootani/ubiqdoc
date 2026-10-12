// 知識プロフィール。読み手が「知ってる」と返した概念の一覧。
// 正本は personal.json / work.json の concepts。索引 (正規化した表記 → 概念) は起動時にメモリ上で作る
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeKey } = require('../core/concept.js');
const { writeAtomic } = require('./fsutil.js');

const CATS = ['personal', 'work'];

class Profile {
  constructor(dir) {
    this.dir = dir;
    this.data = { personal: { concepts: [] }, work: { concepts: [] } };
    this.index = new Map();
  }

  file(cat) { return path.join(this.dir, `${cat}.json`); }

  load() {
    for (const cat of CATS) {
      const f = this.file(cat);
      this.data[cat] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { concepts: [] };
    }
    this.rebuild();
    return this;
  }

  rebuild() {
    this.index.clear();
    for (const cat of CATS) {
      for (const c of this.data[cat].concepts) {
        for (const k of [c.key, c.label, ...(c.aliases || [])]) {
          const n = normalizeKey(k);
          if (n) this.index.set(n, { cat, id: c.id });
        }
      }
    }
  }

  lookup(concept) {
    for (const k of [concept.key, concept.label, ...(concept.aliases || [])]) {
      const hit = this.index.get(normalizeKey(k));
      if (hit) return hit;
    }
    return null;
  }

  knows(concept) { return !!this.lookup(concept || {}); }

  save(cat) { writeAtomic(this.file(cat), JSON.stringify(this.data[cat], null, 2)); }

  add({ key, label, category, aliases = [], fromUrl = '' }) {
    const hit = this.lookup({ key, label });
    if (hit) {
      const c = this.data[hit.cat].concepts.find((x) => x.id === hit.id);
      for (const a of [label, ...aliases]) if (a && !c.aliases.includes(a) && a !== c.label) c.aliases.push(a);
      this.save(hit.cat);
      this.rebuild();
      return { ...c, category: hit.cat };
    }
    const cat = CATS.includes(category) ? category : 'work';
    const c = {
      id: `c_${crypto.randomBytes(5).toString('hex')}`,
      key,
      label: label || key,
      aliases: [...new Set(aliases.filter((a) => a && a !== label))],
      addedAt: new Date().toISOString(),
      fromUrl,
    };
    this.data[cat].concepts.push(c);
    this.save(cat);
    this.rebuild();
    return { ...c, category: cat };
  }

  remove(id) {
    for (const cat of CATS) {
      const list = this.data[cat].concepts;
      const i = list.findIndex((c) => c.id === id);
      if (i < 0) continue;
      const [c] = list.splice(i, 1);
      this.save(cat);
      this.rebuild();
      return { ...c, category: cat };
    }
    return null;
  }

  list() {
    return { personal: [...this.data.personal.concepts], work: [...this.data.work.concepts] };
  }
}

module.exports = { Profile, CATS };

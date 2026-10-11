// ページごとの補足 (page.json)、ベースに読ませた本文 (text.txt)、ログ (logs/*.jsonl)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeAtomic } = require('./fsutil.js');

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

// # 以降と、追跡用・表示用のクエリ (utm_*、Notion の pvs) を落とす。
// ?pvs= の有無や #見出し へのリンクで、同じページが別のページに割れないようにする
function normalizeUrl(u) {
  const url = new URL(u);
  url.hash = '';
  for (const k of [...url.searchParams.keys()]) {
    if (/^utm_/.test(k) || k === 'pvs') url.searchParams.delete(k);
  }
  // Notion はタイトルの slug が URL に入り、改題で変わる。末尾の 32 桁の id だけを残してキーを保つ
  if (/(^|\.)notion\.(so|site)$/.test(url.hostname)) {
    const m = url.pathname.match(/([0-9a-f]{32})$/i);
    if (m) url.pathname = `/${m[1].toLowerCase()}`;
  }
  return url.toString();
}

const pageKey = (u) => sha1(normalizeUrl(u));
const textHash = (t) => sha1(String(t));

function newPage(url, title) {
  return {
    url, title, model: 'haiku',
    baseSessionId: null, baseModel: null, textHash: null, version: 0,
    links: [], truncated: false, proactiveAt: null,
    annotations: [], pending: [], dropped: { noSource: 0 },
  };
}

class Pages {
  constructor(dataDir) {
    this.root = path.join(dataDir, 'ext', 'pages');
    this.cache = new Map();
  }

  dir(key) {
    if (!/^[0-9a-f]{40}$/.test(key)) throw new Error('bad page key');
    return path.join(this.root, key);
  }

  get(key) {
    if (this.cache.has(key)) return this.cache.get(key);
    const f = path.join(this.dir(key), 'page.json');
    if (!fs.existsSync(f)) return null;
    const p = JSON.parse(fs.readFileSync(f, 'utf8'));
    this.cache.set(key, p);
    return p;
  }

  create(key, url, title) {
    const p = newPage(url, title);
    this.cache.set(key, p);
    this.save(key);
    return p;
  }

  save(key) {
    const p = this.cache.get(key);
    p.version = (p.version || 0) + 1;
    writeAtomic(path.join(this.dir(key), 'page.json'), JSON.stringify(p, null, 2));
  }

  readText(key) {
    const f = path.join(this.dir(key), 'text.txt');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  }

  writeText(key, text) { writeAtomic(path.join(this.dir(key), 'text.txt'), text); }

  log(key, name, obj) {
    if (!/^[a-z0-9_]+$/.test(name)) throw new Error('bad log name');
    const d = path.join(this.dir(key), 'logs');
    fs.mkdirSync(d, { recursive: true });
    fs.appendFileSync(path.join(d, `${name}.jsonl`), JSON.stringify(obj) + '\n');
  }
}

module.exports = { Pages, normalizeUrl, pageKey, textHash, newPage };

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { runClaude } = require('./core/claude.js');
const { SYSTEM_PROMPT, buildFirstPrompt, buildFollowupPrompt } = require('./core/prompts.js');
const { parseAnswer } = require('./core/answer.js');

// PORT は他のプロセスの環境から漏れてくることがあるので、専用の名前を先に見る
// (ダッシュボードの shell が PORT=38766 を持っていて、素で起動すると EADDRINUSE になった)
const PORT = process.env.UBIQDOC_PORT || process.env.PORT || 8910;
// 開いた文書のコピーと会話ログの置き場所。プラグインとして入れたときは、更新で消えない場所を
// UBIQDOC_DATA_DIR で渡す (本体のディレクトリは版ごとに入れ替わるため)
const DATA_DIR = process.env.UBIQDOC_DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MODELS = ['haiku', 'sonnet', 'opus'];

fs.mkdirSync(DATA_DIR, { recursive: true });

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 20 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function docDir(id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('bad doc id');
  return path.join(DATA_DIR, id);
}

function readMeta(id) {
  return JSON.parse(fs.readFileSync(path.join(docDir(id), 'meta.json'), 'utf8'));
}

// 文書の実体がどこにあるか。読み書きは全部ここを通す。
// inPlace なら開いた元のファイルを直に読み書きする (注釈が元の文書に残る)。
// 既定は今までどおり data/<id>/doc.html のコピー
function docFile(id, meta) {
  const m = meta || readMeta(id);
  return m.inPlace ? m.sourcePath : path.join(docDir(id), 'doc.html');
}

// in-place のとき、開いたあとに元ファイルが外で書き換わったか。
// 変わっていてもこちらからは何もしない (ベースの読み直しは人が押す)
function sourceChanged(meta) {
  if (!meta.inPlace || !meta.sourceMtimeMs) return false;
  try {
    return fs.statSync(meta.sourcePath).mtimeMs !== meta.sourceMtimeMs;
  } catch {
    return false;
  }
}

function stampSourceMtime(meta) {
  if (!meta.inPlace) return meta;
  try {
    meta.sourceMtimeMs = fs.statSync(meta.sourcePath).mtimeMs;
  } catch { /* 元ファイルが消えていたら触らない */ }
  return meta;
}

function writeMeta(id, meta) {
  fs.writeFileSync(path.join(docDir(id), 'meta.json'), JSON.stringify(meta, null, 2));
}

function listDocs() {
  return fs.readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(DATA_DIR, d.name, 'meta.json')))
    .map((d) => readMeta(d.name))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ベースに読ませるのは本文だけ。style / script はトークンの無駄なので落とす
function docTextForBase(html) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
}

// ベースセッション: その時点の文書 (注釈・人の編集込み) を読ませた状態。質問のたびにここから fork する。
// 人が本文を直したら読ませ直す (POST /api/doc/:id/rebase)
const basePromises = new Map();
// 読み込み中のものだけ。basePromises には済んだ Promise も残るので、状態の判定はこちらで行う
const creatingBases = new Set();

function createBase(id) {
  const meta = readMeta(id);
  const html = fs.readFileSync(docFile(id, meta), 'utf8');
  // 読み込み中に入った人の編集は、次の読み直しの対象として数え直せるよう、開始時点で 0 にしておく
  meta.baseVersion = meta.version || 0;
  meta.humanEditsSinceBase = 0;
  delete meta.baseSessionId;
  stampSourceMtime(meta);          // いま読んだ版を覚える。以後ここからのズレが「古い」の根拠
  writeMeta(id, meta);
  const prompt = `これからユーザが読む文書です。読み終えたら「OK」とだけ返してください。\n\n${docTextForBase(html)}`;
  const started = Date.now();
  const p = runClaude(['--model', meta.model], prompt, { systemPrompt: SYSTEM_PROMPT }).then((r) => {
    const m = readMeta(id);
    m.baseSessionId = r.session_id;
    m.baseModel = meta.model;
    m.baseMs = Date.now() - started;
    writeMeta(id, m);
    return r.session_id;
  });
  basePromises.set(id, p);
  creatingBases.add(id);
  p.then(() => creatingBases.delete(id), (e) => { console.error(`[base ${id}]`, e.message); basePromises.delete(id); creatingBases.delete(id); });
  return p;
}

function getBase(id) {
  const meta = readMeta(id);
  if (meta.baseSessionId && meta.baseModel === meta.model) return Promise.resolve(meta.baseSessionId);
  if (creatingBases.has(id)) return basePromises.get(id);
  return createBase(id);
}

// 別のタブ・別の端末が先に保存していたら 409 を返す。保存は文書を丸ごと書き込むので、
// 古い画面から保存すると相手の書き込みを消してしまう
function bumpVersion(id, baseVersion, res) {
  const meta = readMeta(id);
  const current = meta.version || 0;
  if (baseVersion !== current) {
    sendJson(res, 409, { error: '別のタブで文書が更新されています。再読み込みしてください', version: current });
    return null;
  }
  meta.version = current + 1;
  return meta;
}

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

// ほかのサイトから叩かれないようにする:
// - Host を見て DNS rebinding を断る
// - 書き込み系は Origin が自分自身であることと、Content-Type が application/json であることを求める
//   (application/json はブラウザが preflight を挟むので、フォームや text/plain での送りつけが通らない)
function rejectForeign(req, res) {
  if (!ALLOWED_HOSTS.has(req.headers.host)) { sendJson(res, 403, { error: 'forbidden host' }); return true; }
  if (req.method === 'GET' || req.method === 'HEAD') return false;
  const origin = req.headers.origin;
  if (origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, ''))) { sendJson(res, 403, { error: 'forbidden origin' }); return true; }
  if (!/^application\/json\b/.test(req.headers['content-type'] || '')) { sendJson(res, 415, { error: 'Content-Type must be application/json' }); return true; }
  return false;
}

async function handleAsk(req, res) {
  const body = await readBody(req);
  const { docId, windowId, sessionId } = body;
  const meta = readMeta(docId);
  if (!/^w_[a-z0-9]+$/.test(windowId || '')) return sendJson(res, 400, { error: 'bad windowId' });

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const started = Date.now();

  const run = async (retry) => {
    let args;
    let prompt;
    if (sessionId) {
      args = ['--model', meta.model, '--resume', sessionId];
      prompt = buildFollowupPrompt(body);
    } else {
      const base = await getBase(docId);
      args = ['--model', meta.model, '--resume', base, '--fork-session'];
      prompt = buildFirstPrompt(body);
    }
    try {
      return { prompt, result: await runClaude(args, prompt, { systemPrompt: SYSTEM_PROMPT, onDelta: (t) => send('delta', { text: t }) }) };
    } catch (e) {
      // ベースのセッションファイルが消えていたら作り直して 1 回だけやり直す
      if (!sessionId && retry && /No conversation found/i.test(e.message)) {
        const m = readMeta(docId);
        delete m.baseSessionId;
        writeMeta(docId, m);
        basePromises.delete(docId);
        return run(false);
      }
      throw e;
    }
  };

  try {
    const { prompt, result } = await run(true);
    const ms = Date.now() - started;
    const parsed = parseAnswer(result.result || '');
    const log = { at: new Date().toISOString(), turnId: body.turnId, model: meta.model, ms, sessionId: result.session_id, prompt, result: result.result };
    fs.mkdirSync(path.join(docDir(docId), 'logs'), { recursive: true });
    fs.appendFileSync(path.join(docDir(docId), 'logs', `${windowId}.jsonl`), JSON.stringify(log) + '\n');
    send('done', { ...parsed, sessionId: result.session_id, ms });
  } catch (e) {
    send('error', { message: e.message });
  }
  res.end();
}

async function handleOpen(req, res) {
  const { path: src, model, inPlace, fresh } = await readBody(req);
  const abs = path.resolve(String(src || '').replace(/^~(?=\/)/, os.homedir()));
  if (!/\.html?$/i.test(abs) || !fs.existsSync(abs)) return sendJson(res, 400, { error: 'HTML ファイルのパスを指定してください' });

  // 同じファイルを開き直したら、前の文書を返す。開くたびに id が増えると data/ が膨らみ、
  // ベースセッションも焚き直しになる。`fresh` を渡せば、それでも新しく作れる (二重に開くのは禁止しない)
  if (!fresh) {
    const found = listDocs().find((m) => m.sourcePath === abs && !!m.inPlace === !!inPlace);
    if (found) {
      return sendJson(res, 200, {
        id: found.id, reused: true, title: found.title,
        sourceChanged: sourceChanged(found), tooLarge: (found.bytes || 0) > 100 * 1024,
      });
    }
  }

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const slug = path.basename(abs).replace(/\.html?$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  const id = `${stamp}-${slug}-${crypto.randomBytes(2).toString('hex')}`;
  fs.mkdirSync(path.join(DATA_DIR, id, 'history'), { recursive: true });
  const html = fs.readFileSync(abs, 'utf8');
  fs.writeFileSync(path.join(DATA_DIR, id, 'source.html'), html);
  // in-place では元のファイルが文書そのもの。コピー (doc.html) は作らない
  if (!inPlace) fs.writeFileSync(path.join(DATA_DIR, id, 'doc.html'), html);
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || path.basename(abs);
  writeMeta(id, { id, title: title.trim(), sourcePath: abs, inPlace: !!inPlace, model: MODELS.includes(model) ? model : 'haiku', bytes: html.length, createdAt: new Date().toISOString() });
  createBase(id);
  sendJson(res, 200, { id, tooLarge: html.length > 100 * 1024 });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.json': 'application/json',
};

// 文書と同じ dir に置かれた素材 (style.css・画像・フォント) を配る。
//
// 文書は iframe の about:blank に流し込んでいるので、`href="style.css"` のような
// **相対 URL が何にも解決できず、CSS が当たらないままレイアウトが崩れる**。
// 元の dir を基準にここから配り直す。
//
// `<base>` を差し込まないのは、本文のリンク (`href="index.html"`) まで巻き込むため。
// 素材だけを書き換えるのは画面側 (`retargetAssets`)。
function sendAsset(res, id, rel) {
  const meta = readMeta(id);
  const root = path.dirname(meta.sourcePath);
  const abs = path.resolve(root, decodeURIComponent(rel));
  // 文書の dir の外へは出さない (`../../.ssh/id_rsa` のような相対パスを断つ)
  if (abs !== root && !abs.startsWith(root + path.sep)) return sendJson(res, 403, { error: 'outside the document folder' });
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    return sendJson(res, 404, { error: 'not found' });
  }
  if (!st.isFile()) return sendJson(res, 404, { error: 'not found' });
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(abs).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  if (rejectForeign(req, res)) return;
  try {
    if (p === '/api/docs' && req.method === 'GET') return sendJson(res, 200, listDocs());
    if (p === '/api/open' && req.method === 'POST') return await handleOpen(req, res);
    if (p === '/api/ask' && req.method === 'POST') return await handleAsk(req, res);

    let m = p.match(/^\/api\/doc\/([a-z0-9-]+)$/);
    if (m && req.method === 'GET') {
      const meta = readMeta(m[1]);
      const base = creatingBases.has(m[1]) ? 'creating' : meta.baseSessionId ? 'ready' : 'none';
      const pendingFile = path.join(docDir(m[1]), 'pending.json');
      const pending = fs.existsSync(pendingFile) ? JSON.parse(fs.readFileSync(pendingFile, 'utf8')) : [];
      return sendJson(res, 200, { meta, base, pending, sourceChanged: sourceChanged(meta) });
    }
    if (m && req.method === 'PATCH') {
      const { model } = await readBody(req);
      if (!MODELS.includes(model)) return sendJson(res, 400, { error: 'bad model' });
      const meta = readMeta(m[1]);
      meta.model = model;
      writeMeta(m[1], meta);
      // モデルを変えたらベースもそのモデルで作り直す (キャッシュはモデルごとに別)
      if (meta.baseModel !== model) { basePromises.delete(m[1]); createBase(m[1]); }
      return sendJson(res, 200, { ok: true });
    }

    m = p.match(/^\/api\/doc\/([a-z0-9-]+)\/rebase$/);
    if (m && req.method === 'POST') {
      basePromises.delete(m[1]);
      createBase(m[1]);
      return sendJson(res, 200, { ok: true });
    }

    m = p.match(/^\/api\/doc\/([a-z0-9-]+)\/asset\/(.+)$/);
    if (m && req.method === 'GET') return sendAsset(res, m[1], m[2]);

    m = p.match(/^\/api\/doc\/([a-z0-9-]+)\/html$/);
    if (m && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(docFile(m[1])));
    }
    if (m && req.method === 'PUT') {
      const { html, turnId, baseVersion, source } = await readBody(req);
      if (typeof html !== 'string' || !html) return sendJson(res, 400, { error: 'empty html' });
      const dir = docDir(m[1]);
      const meta = bumpVersion(m[1], baseVersion, res);
      if (!meta) return;
      if (source === 'human') meta.humanEditsSinceBase = (meta.humanEditsSinceBase || 0) + 1;
      const file = docFile(m[1], meta);
      // 質問 1 回ぶんを書き込む直前の状態を残す (undo の最後の手段)。
      // in-place で元ファイルを上書きするときも、控えは data/ 側に積む
      if (turnId && /^t_[a-z0-9]+$/.test(turnId)) {
        const snap = path.join(dir, 'history', `${turnId}.html`);
        if (!fs.existsSync(snap)) fs.copyFileSync(file, snap);
      }
      fs.writeFileSync(file, html);
      stampSourceMtime(meta);        // 自分が書いた分を「外で変わった」と数えない
      writeMeta(m[1], meta);
      return sendJson(res, 200, { ok: true, version: meta.version, humanEditsSinceBase: meta.humanEditsSinceBase || 0 });
    }

    m = p.match(/^\/api\/doc\/([a-z0-9-]+)\/pending$/);
    if (m && req.method === 'PUT') {
      const { pending, baseVersion } = await readBody(req);
      const meta = bumpVersion(m[1], baseVersion, res);
      if (!meta) return;
      fs.writeFileSync(path.join(docDir(m[1]), 'pending.json'), JSON.stringify(pending || [], null, 2));
      writeMeta(m[1], meta);
      return sendJson(res, 200, { ok: true, version: meta.version });
    }

    if (req.method === 'GET') {
      const file = path.join(PUBLIC_DIR, p === '/' ? 'index.html' : path.normalize(p).replace(/^\/+/, ''));
      if (file.startsWith(PUBLIC_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        return res.end(fs.readFileSync(file));
      }
    }
    sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: e.message });
    else res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`ubiqdoc: http://127.0.0.1:${PORT}/`));

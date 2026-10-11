# ubiqdoc 拡張版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ubiqdoc を Chrome 拡張にして、読み手の知識プロフィールに無い概念へ先回りで補足 (出典付き・1 ページ 20 個まで) を付け、「知ってる」で以後付かなくする。今の HTML リーダーは残す。

**Architecture:** 拡張 (MV3) → background → 自前の native messaging host (Node) → `claude -p`。補足はページの DOM を書き換えず、CSS Custom Highlight API と Shadow DOM の層で描く。補足と知識プロフィールは host が `data/` に JSON で持つ。プロンプトとタグの読み取りは `core/` に切り出し、HTML リーダーと共有する。

**Tech Stack:** Node 18+ (依存なし、テストは `node:test`)、Chrome Manifest V3、`claude` CLI、E2E だけ `playwright-core` (`e2e/` に閉じる)。

**Spec:** `docs/superpowers/specs/2026-10-11-proactive-extension-design.md`

## Global Constraints

- Node 18 以上。本体 (`core/` `host/` `extension/` `server.js`) は依存パッケージを持たない。`playwright-core` は `e2e/package.json` にだけ書く
- 1 ページあたり表示中の先回りの補足は最大 20 個 (`LIMIT = 20`)
- 先回りの補足は出典 URL (`sourceUrls`) が 1 つ以上無ければ表示しない。ドラッグして聞いた補足は出典なしでも表示し、20 個の上限にも数えない
- 区分は `personal` / `work` の 2 つ。未指定・不正な値は `work`
- `data/` はコミットしない。host は起動時に `guard.js` で検査し、外れたら何もしない
- ページの DOM (本文) を書き換えない。足してよいのは `<html>` 直下の層の要素 `<ubiqdoc-layer>` と、`<head>` の `<style id="ubiqdoc-highlight">` だけ
- host は stdout に Chrome との通信 (4 バイト長 + JSON) 以外を書かない。ログは stderr
- `claude` の cwd は `~/.cache/ubiqdoc` に固定する
- native host 名は `com.atsushiootani.ubiqdoc`
- 本文の上限 100 KB (`MAX_TEXT = 100 * 1024`)。超えたぶんは切り、`truncated: true` を立てる
- 文書・UI の文言は日本語。「前者」「後者」を使わない
- 既定のモデルは `haiku`。選べるのは `haiku` / `sonnet` / `opus`

## Review Focus

- **同じ語句がページに何度も出る** (「受注伝票」が 5 回など): 補足は `prefix` / `suffix` が最もよく合う 1 か所にだけ付く。Task 3 の `findAnchor` のテストで、`prefix` と `suffix` それぞれで選び分けるケースを固定する
- **Notion の描き直しでテキストノードが入れ替わる**: 補足は消えずに付け直される。Task 15 の E2E で、段落を同じ文字のクローンに差し替えたあとも印の数が変わらないことを確かめる
- **同じページを 2 つのタブで開く / 先回りの実行中にもう一度開く**: `claude` は 1 回しか走らない。Task 9 の結合テストで、`open-page` を 2 本同時に送っても抜き出しの呼び出しが 1 回であることを確かめる
- **出典の付けられない業務用語** (本文にリンクが無いページ): 補足は出ず、捨てた数がサイドパネルに出る。Task 9 の結合テストで `dropped.noSource` を確かめる
- **`data/` が過去に一度コミットされていた**: `.gitignore` にあっても host は起動しない。Task 4 のテストで固定する

---

## ファイル構成

| パス | 役割 |
|---|---|
| `package.json` | `npm test` = `node --test` |
| `core/claude.js` | `claude -p` の実行 (stream-json の読み取り) |
| `core/prompts.js` | HTML リーダーの system prompt / 質問プロンプト、拡張の system prompt / 各段のプロンプト |
| `core/answer.js` | `<ubiqdoc-*>` タグの読み取り、逐次読み取り (`TagStream`)、`<ubiqdoc-concept>` の読み取り |
| `core/concept.js` | 概念キーの正規化 |
| `extension/lib/anchor.js` | 文字列 + 位置で補足の位置を探す (拡張と host で共有。UMD) |
| `extension/lib/allowlist.js` | 許可リストの照合 (拡張とテストで共有。UMD) |
| `host/fsutil.js` | 一時ファイル + rename の書き込み |
| `host/guard.js` | `data/` がコミット対象になっていないかの検査 |
| `host/profile.js` | 知識プロフィールと索引 |
| `host/pages.js` | ページキー、`page.json` / `text.txt` / ログの読み書き |
| `host/page-ops.js` | 補足の追加・重なり・付け直し・取り消し・変換・承認・表示用の形 (純粋関数) |
| `host/framing.js` | native messaging の枠 |
| `host/bases.js` | ページごとのベースセッションと fork |
| `host/proactive.js` | 先回りの 3 段 |
| `host/host.js` | 要求の振り分けと stdio |
| `host/extension-id.js` | manifest の `key` から拡張 ID を出す |
| `host/install.sh` | ラッパ `run.sh` と登録ファイルを作る |
| `extension/manifest.json` | MV3 |
| `extension/background.js` | host との接続、許可リスト、タブ・サイドパネルとの中継 |
| `extension/content/text.js` | 本文の根・テキストノード・本文・リンク・落ち着くまで待つ |
| `extension/content/overlay.js` | 最前面の層 (Shadow DOM)、ハイライトの見た目、トースト |
| `extension/content/render.js` | 補足の描画 (ハイライト、ポップオーバー、カード、リンク) と「知ってる」 |
| `extension/content/ask.js` | 「AI に聞く」ボタンと小窓 |
| `extension/content/main.js` | 起動、host への要求、SPA の遷移 |
| `extension/sidepanel/*` | サイドパネル |
| `extension/options/*` | オプション画面 |
| `test/*.test.js` | 単体・結合テスト |
| `test/fixtures/fake-claude.js` | テスト用の `claude` の代わり |
| `test/fixtures/doc.html` | HTML リーダーの回帰テスト用 |
| `e2e/*` | 拡張の E2E (Playwright) |

---

### Task 1: core を切り出し、HTML リーダーをそれに載せ替える

**Files:**
- Create: `package.json`, `core/claude.js`, `core/prompts.js`, `core/answer.js`
- Create: `test/answer.test.js`, `test/server.test.js`, `test/fixtures/fake-claude.js`, `test/fixtures/doc.html`
- Modify: `server.js` (1-45 行、115-152 行、220-260 行、171 行、284 行)
- Modify: `.gitignore`

**Interfaces:**
- Produces:
  - `runClaude(args: string[], prompt: string, { systemPrompt: string, onDelta?: (text) => void }) => Promise<{ session_id, result, is_error }>` (`core/claude.js`)。`UBIQDOC_CLAUDE_BIN` があればそれを起動する
  - `CLAUDE_CWD: string` (`core/claude.js`)
  - `SYSTEM_PROMPT`, `buildFirstPrompt({selection, context, asides, question})`, `buildFollowupPrompt({asides, question})` (`core/prompts.js`。HTML リーダー用、文言は今のまま)
  - `EXT_SYSTEM_PROMPT`, `basePrompt(text, links)`, `extractPrompt()`, `writePrompt(concepts)`, `askFirstPrompt(m)`, `askFollowupPrompt(m)` (`core/prompts.js`。拡張用)
  - `parseAnswer(text) => { reply, annotations: Annotation[], edits, parseError? }`。`Annotation = { kind, target: 'selection' | {exact, prefix}, title, href, body, dependsOn: string[], sourceUrls: string[], concept?: { key, category } }`
  - `parseConcepts(text) => { key, label, category, importance: 1..5, exact, prefix }[]`
  - `class TagStream { push(text) => string[] }` (閉じたタグの生文字列を、閉じた順に 1 回ずつ返す)

- [ ] **Step 1: テストの土台を作る**

`package.json`:

```json
{
  "name": "ubiqdoc",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
```

`.gitignore` の末尾に足す:

```
# install.sh が生成するラッパ (node / claude の絶対パス入り)
host/run.sh
# E2E の作業場所
e2e/.out/
```

`test/fixtures/fake-claude.js` (実行権限を付ける: `chmod +x test/fixtures/fake-claude.js`):

```js
#!/usr/bin/env node
// テスト用の claude の代わり。claude -p の stream-json と同じ形で、決まった答えを返す。
// セッションは UBIQDOC_FAKE_DIR/sessions/<id>.txt に「それまでに読ませた文字列」として残し、
// --resume で読み戻す。呼び出しは calls.jsonl に 1 行ずつ残す (テストで回数を数える)
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.UBIQDOC_FAKE_DIR || path.join(os.tmpdir(), 'ubiqdoc-fake');
fs.mkdirSync(path.join(DIR, 'sessions'), { recursive: true });
const args = process.argv.slice(2);
const argOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

const DICT = [
  { key: 'optimistic-locking', label: '楽観ロック', category: 'personal', importance: 4 },
  { key: 'sales-order-slip', label: '受注伝票', category: 'work', importance: 5 },
  { key: 'idempotency', label: '冪等性', category: 'personal', importance: 3 },
];

function out(o) { process.stdout.write(JSON.stringify(o) + '\n'); }

function emit(text, sessionId) {
  const delay = Number(process.env.UBIQDOC_FAKE_DELAY_MS || 0);
  const chunks = [];
  for (let i = 0; i < text.length; i += 20) chunks.push(text.slice(i, i + 20));
  const next = () => {
    const c = chunks.shift();
    if (c === undefined) { out({ type: 'result', is_error: false, result: text, session_id: sessionId }); return; }
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: c } } });
    if (delay) setTimeout(next, delay); else next();
  };
  next();
}

function answer(prompt, context) {
  if (/^これからユーザが読む/.test(prompt)) return 'OK';
  if (prompt.startsWith('[抜き出し]')) {
    const body = context.slice(context.indexOf('[本文]'));
    return DICT.filter((d) => body.includes(d.label)).map((d) => {
      const at = body.indexOf(d.label);
      const prefix = body.slice(Math.max(0, at - 4), at).replace(/["\n]/g, '');
      return `<ubiqdoc-concept key="${d.key}" label="${d.label}" category="${d.category}" importance="${d.importance}" exact="${d.label}" prefix="${prefix}"/>`;
    }).join('\n');
  }
  if (prompt.startsWith('[補足を書く]')) {
    const links = context.slice(context.indexOf('[本文中のリンク]'), context.indexOf('[本文]'));
    const link = (links.match(/ (https?:\/\/\S+)$/m) || [])[1];
    return prompt.split('\n').filter((l) => l.startsWith('- {')).map((l) => JSON.parse(l.slice(2))).map((c) => {
      const src = c.category === 'personal' ? `https://en.wikipedia.org/wiki/${c.key}` : link;
      const attrs = `target="${c.exact}" prefix="${c.prefix}" concept="${c.key}" category="${c.category}"${src ? ` source="${src}"` : ''}`;
      return c.key === 'sales-order-slip'
        ? `<ubiqdoc-section ${attrs} title="${c.label}とは"><p>${c.label}の説明</p></ubiqdoc-section>`
        : `<ubiqdoc-popover ${attrs}>${c.label}の説明</ubiqdoc-popover>`;
    }).join('\n');
  }
  if (prompt.includes('[質問]')) {
    return '説明です。<ubiqdoc-popover target="selection" concept="test-concept" category="personal">選んだ語句の説明</ubiqdoc-popover>';
  }
  return 'OK';
}

let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const resume = argOf('--resume');
  let context = '';
  if (resume) {
    const f = path.join(DIR, 'sessions', `${resume}.txt`);
    if (!fs.existsSync(f)) {
      out({ type: 'result', is_error: true, result: `No conversation found with session ID: ${resume}` });
      process.exit(1);
    }
    context = fs.readFileSync(f, 'utf8');
  }
  const sessionId = resume && !args.includes('--fork-session') ? resume : `s_${crypto.randomBytes(6).toString('hex')}`;
  fs.writeFileSync(path.join(DIR, 'sessions', `${sessionId}.txt`), `${context}\n${input}`);
  fs.appendFileSync(path.join(DIR, 'calls.jsonl'), JSON.stringify({ args, head: input.slice(0, 40) }) + '\n');
  emit(answer(input, context), sessionId);
});
```

`test/fixtures/doc.html`:

```html
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>回帰テスト用の文書</title></head>
<body><h1>見本</h1><p>更新時は楽観ロックで競合を検知する。</p></body></html>
```

- [ ] **Step 2: タグ読み取りの失敗するテストを書く**

`test/answer.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAnswer, parseConcepts, TagStream } = require('../core/answer.js');

test('HTML リーダーの形 (popover / section / link / edit) を今までどおり読む', () => {
  const r = parseAnswer('答えです。<ubiqdoc-popover target="selection">短い説明</ubiqdoc-popover>'
    + '<ubiqdoc-section target="受注" prefix="この" title="見出し"><p>本文</p></ubiqdoc-section>'
    + '<ubiqdoc-link target="selection" href="https://example.com/a"></ubiqdoc-link>'
    + '<ubiqdoc-edit exact="古い文" reason="誤り">新しい文</ubiqdoc-edit>');
  assert.equal(r.reply, '答えです。');
  assert.equal(r.annotations.length, 3);
  assert.deepEqual(r.annotations[0].target, 'selection');
  assert.equal(r.annotations[0].body, '短い説明');
  assert.deepEqual(r.annotations[1].target, { exact: '受注', prefix: 'この' });
  assert.equal(r.annotations[1].title, '見出し');
  assert.equal(r.annotations[2].href, 'https://example.com/a');
  assert.deepEqual(r.edits, [{ exact: '古い文', replaceWith: '新しい文', reason: '誤り' }]);
  assert.equal(r.parseError, undefined);
});

test('concept / category / source 属性を読む', () => {
  const r = parseAnswer('<ubiqdoc-popover target="楽観ロック" concept="optimistic-locking" category="personal" source="https://a.example/x  https://b.example/y">説明</ubiqdoc-popover>');
  const a = r.annotations[0];
  assert.deepEqual(a.concept, { key: 'optimistic-locking', category: 'personal' });
  assert.deepEqual(a.sourceUrls, ['https://a.example/x', 'https://b.example/y']);
});

test('category が無い・不正なら work に倒す', () => {
  const a = parseAnswer('<ubiqdoc-popover target="x" concept="k">b</ubiqdoc-popover>').annotations[0];
  assert.equal(a.concept.category, 'work');
  const b = parseAnswer('<ubiqdoc-popover target="x" concept="k" category="hobby">b</ubiqdoc-popover>').annotations[0];
  assert.equal(b.concept.category, 'work');
});

test('source の http(s) 以外は捨てる', () => {
  const a = parseAnswer('<ubiqdoc-popover target="x" source="javascript:alert(1) https://ok.example/">b</ubiqdoc-popover>').annotations[0];
  assert.deepEqual(a.sourceUrls, ['https://ok.example/']);
});

test('閉じていないタグは parseError にする', () => {
  const r = parseAnswer('答え<ubiqdoc-popover target="x">途中で切れた');
  assert.equal(r.annotations.length, 0);
  assert.equal(r.parseError, '閉じていないタグがある');
  assert.equal(r.reply, '答え');
});

test('parseConcepts: key と exact が無いものは捨て、importance は 1..5 に収める', () => {
  const cs = parseConcepts([
    '<ubiqdoc-concept key="optimistic-locking" label="楽観ロック" category="personal" importance="9" exact="楽観ロック" prefix="更新時は"/>',
    '<ubiqdoc-concept label="名前だけ" exact="名前だけ"/>',
    '<ubiqdoc-concept key="sales-order-slip" exact="受注伝票"/>',
  ].join('\n'));
  assert.equal(cs.length, 2);
  assert.deepEqual(cs[0], { key: 'optimistic-locking', label: '楽観ロック', category: 'personal', importance: 5, exact: '楽観ロック', prefix: '更新時は' });
  assert.deepEqual(cs[1], { key: 'sales-order-slip', label: '受注伝票', category: 'work', importance: 3, exact: '受注伝票', prefix: '' });
});

test('TagStream: 分割されて届いたタグを、閉じた時点で 1 回だけ返す', () => {
  const s = new TagStream();
  assert.deepEqual(s.push('<ubiqdoc-popover target="a">説'), []);
  assert.deepEqual(s.push('明</ubiqdoc-popover>\n<ubiqdoc-link target="b" href="https://x.example/"'), ['<ubiqdoc-popover target="a">説明</ubiqdoc-popover>']);
  assert.deepEqual(s.push('></ubiqdoc-link>'), ['<ubiqdoc-link target="b" href="https://x.example/"></ubiqdoc-link>']);
  assert.deepEqual(s.push(''), []);
});
```

- [ ] **Step 3: 失敗を確かめる**

Run: `npm test`
Expected: FAIL (`Cannot find module '../core/answer.js'`)

- [ ] **Step 4: `core/answer.js` を書く**

```js
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
    href: at.href,
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
```

- [ ] **Step 5: テストが通るのを確かめる**

Run: `npm test`
Expected: `test/answer.test.js` の 7 件が PASS

- [ ] **Step 6: `core/claude.js` と `core/prompts.js` を書く**

`core/claude.js` (中身は今の `server.js` の `runClaude` と同じ。違うのは system prompt を引数で受けることと、`UBIQDOC_CLAUDE_BIN`):

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// claude のセッションは cwd ごとに保存されるので、resume できるよう cwd は固定する。
// 作業中のリポジトリ配下にすると、その CLAUDE.md を拾ってしまうので、どのプロジェクトにも属さない場所に置く
const CLAUDE_CWD = path.join(os.homedir(), '.cache', 'ubiqdoc');

function runClaude(args, prompt, { systemPrompt, onDelta } = {}) {
  fs.mkdirSync(CLAUDE_CWD, { recursive: true });
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const child = spawn(process.env.UBIQDOC_CLAUDE_BIN || 'claude', [
      '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands',
      '--append-system-prompt', systemPrompt,
      ...args,
    ], { cwd: CLAUDE_CWD, env });
    let buf = '';
    let result = null;
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta') {
          onDelta?.(ev.event.delta.text);
        } else if (ev.type === 'result') {
          result = ev;
        }
      }
    });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (result && !result.is_error) return resolve(result);
      reject(new Error((result && result.result) || stderr.trim() || `claude exited with ${code}`));
    });
    child.stdin.end(prompt);
  });
}

module.exports = { runClaude, CLAUDE_CWD };
```

`core/prompts.js`。前半は `server.js` の 26-45 行と 220-231 行を**一字一句そのまま**移したもの (fork 先でプロンプトキャッシュを効かせるため、ベースと fork で同じ文字列である必要がある)。後半が拡張用:

```js
// HTML リーダーと拡張のプロンプト。fork 先でもプロンプトキャッシュを効かせるため、
// ベースと fork で一字一句同じ system prompt を渡すこと

const SYSTEM_PROMPT = `あなたは、ユーザが読んでいる文書に解説を書き込むアシスタントです。
ユーザは文書中の語句を選んで質問します。まず質問への答えを日本語で簡潔に書き (タグだけの返答にしない)、そのあとに文書へ書き込む内容をタグで書いてください。
書き込むものが無ければタグは書きません。

使えるタグ (新しい注釈。自動で反映される):
<ubiqdoc-popover target="selection">短い説明 (プレーンテキスト、200字以内)</ubiqdoc-popover>
<ubiqdoc-section target="selection" title="見出し">HTML 断片 (p ul ol li code pre strong em a table h5 が使える)</ubiqdoc-section>
<ubiqdoc-link target="selection" href="https://..."></ubiqdoc-link>

- target は、ユーザが選んだ語句なら "selection"。別の語句に付けたいときは、文書の本文にそのまま現れる文字列を target に書き、直前の数文字を prefix 属性に書く
- 既にある注釈を前提にした説明なら depends="a_01 a_02" のように注釈の ID を書く
- 属性値の中に " を使わない

kind の選び方: ユーザの指示 (「ポップオーバーで」「セクションで」「リンクだけ」など) があれば必ず従う。
指示が無ければ、短く済む説明は popover、長く重要な説明は section、一次情報の URL を示すだけで足りるなら link にする。
URL は確実に実在すると分かっているものだけを使う。

既にある本文や注釈の書き換え (ユーザの承認後に反映される):
<ubiqdoc-edit exact="書き換える元の文 (本文にそのまま現れる文字列)" reason="理由">新しい文 (HTML 断片可)</ubiqdoc-edit>
本文の誤りや、注釈と合わせて直したほうが読みやすくなる箇所があるときだけ使う。`;

function buildFirstPrompt({ selection, context, asides, question }) {
  return [
    `[選んだ語句]\n${selection}`,
    `[語句の周辺の本文]\n${context}`,
    `[この文書に既に入っている注釈]\n${asides || '(なし)'}`,
    `[質問]\n${question}`,
  ].join('\n\n');
}

function buildFollowupPrompt({ asides, question }) {
  return `[この文書に既に入っている注釈 (最新)]\n${asides || '(なし)'}\n\n[質問]\n${question}`;
}

// ---------- 拡張 ----------

const EXT_SYSTEM_PROMPT = `あなたは、ユーザが読んでいるウェブページに補足を付けるアシスタントです。
読み手は 1 人です。読み手がまだ知らない概念にだけ、短い補足と出典を付けます。
指示は 3 種類あり、プロンプトの先頭の [ ] で分かります。

[抜き出し] 本文から、読み手が説明を必要としそうな概念を最大 60 個、次のタグで書く。タグ以外は書かない。
<ubiqdoc-concept key="英語の小文字キー" label="本文での表記" category="personal か work" importance="1から5" exact="本文にそのまま現れる文字列" prefix="直前の数文字"/>
- key は Wikipedia 英語版の見出し語に寄せ、単語の区切りは - にする。業務に固有の語は、英訳かローマ字で一意になるように書く
- category: 一般的な技術知識なら personal。その会社・その業務に固有の知識なら work。迷ったら work。社外に出せない情報が少しでも含まれるなら work
- importance: 読み手がそこでつまずくと本文全体の理解が止まるものほど高くする
- 同じ概念は 1 回だけ書く

[補足を書く] 指定された概念ごとに、次のどれか 1 つのタグを書く。タグ以外は書かない。
<ubiqdoc-popover target="本文の文字列" prefix="直前の数文字" concept="key" category="personal か work" source="URL URL">短い説明 (プレーンテキスト、200字以内)</ubiqdoc-popover>
<ubiqdoc-section target="本文の文字列" prefix="直前の数文字" concept="key" category="personal か work" source="URL" title="見出し">HTML 断片 (p ul ol li code pre strong em a table h5 が使える)</ubiqdoc-section>
<ubiqdoc-link target="本文の文字列" prefix="直前の数文字" concept="key" category="personal か work" source="URL" href="https://..."></ubiqdoc-link>
- target と prefix は、指定された概念の exact と prefix をそのまま書く
- source には出典の URL を空白区切りで書く。使えるのは (1) [本文中のリンク] にある URL、(2) 実在が確かな一次情報 (公式ドキュメント、仕様書、Wikipedia) だけ。どちらも無ければ source を書かない
- 説明は、読み手がその概念を知らない前提で、このページの文脈に沿って書く

[質問] 読み手が本文中の語句を選んで質問する。まず質問への答えを日本語で簡潔に書き (タグだけの返答にしない)、そのあとに書き込む内容を popover / section / link のタグで書く。選んだ語句に付けるなら target="selection"。concept と category も書く。source は分かれば書く。書き込むものが無ければタグは書かない。

共通:
- 属性値の中に " を使わない
- 形の選び方: 指示 (「ポップオーバーで」「セクションで」「リンクだけ」など) があれば必ず従う。無ければ、短く済む説明は popover、長く重要な説明は section、出典を示すだけで足りるなら link`;

function basePrompt(text, links) {
  const list = (links || []).map((l) => `- ${l.text || '(無題)'} ${l.href}`).join('\n') || '(なし)';
  return `これからユーザが読むページです。読み終えたら「OK」とだけ返してください。\n\n[本文中のリンク]\n${list}\n\n[本文]\n${text}`;
}

function extractPrompt() {
  return '[抜き出し]\nこのページの本文から、読み手が説明を必要としそうな概念を抜き出してください。';
}

function writePrompt(concepts) {
  const lines = concepts.map((c) => `- ${JSON.stringify({ key: c.key, label: c.label, category: c.category, exact: c.exact, prefix: c.prefix })}`);
  return `[補足を書く]\n次の概念に補足を書いてください。\n${lines.join('\n')}`;
}

function askFirstPrompt(m) { return `[質問]\n${buildFirstPrompt(m)}`; }
function askFollowupPrompt(m) { return `[質問]\n${buildFollowupPrompt(m)}`; }

module.exports = {
  SYSTEM_PROMPT, buildFirstPrompt, buildFollowupPrompt,
  EXT_SYSTEM_PROMPT, basePrompt, extractPrompt, writePrompt, askFirstPrompt, askFollowupPrompt,
};
```

(`SYSTEM_PROMPT` / `buildFirstPrompt` / `buildFollowupPrompt` は `server.js` からの文字どおりの移動。一字でも変えると、HTML リーダーの既存のベースセッションとキャッシュが合わなくなる)

- [ ] **Step 7: `server.js` を core に載せ替える**

行番号は編集前のもの。**下の番号から順に**消すとずれない (5 → 4 → 3 → 2 → 1 の順に行い、6・7 は最後に文字列で探して直す)。

1. 6 行目 `const { spawn } = require('child_process');` を消し、5 行目の後ろに足す:

```js
const { runClaude, CLAUDE_CWD } = require('./core/claude.js');
const { SYSTEM_PROMPT, buildFirstPrompt, buildFollowupPrompt } = require('./core/prompts.js');
const { parseAnswer } = require('./core/answer.js');
```

2. 17-20 行目 (`CLAUDE_CWD` の定義と `fs.mkdirSync(CLAUDE_CWD, ...)`) を消す。21 行目 `fs.mkdirSync(DATA_DIR, { recursive: true });` は残す
3. 23-45 行目 (`SYSTEM_PROMPT`) を消す
4. 115-152 行目 (`function runClaude`) を消す
5. 220-260 行目 (`buildFirstPrompt` / `buildFollowupPrompt` / `parseAttrs` / `TAG_RE` / `parseAnswer`) を消す
6. `createBase` の `runClaude(['--model', meta.model], prompt)` を `runClaude(['--model', meta.model], prompt, { systemPrompt: SYSTEM_PROMPT })` にする
7. `handleAsk` の `runClaude(args, prompt, { onDelta: (t) => send('delta', { text: t }) })` を `runClaude(args, prompt, { systemPrompt: SYSTEM_PROMPT, onDelta: (t) => send('delta', { text: t }) })` にする

`CLAUDE_CWD` は `server.js` の中で他に使っていなければ import から外す (`grep -n CLAUDE_CWD server.js` で確かめる)。

- [ ] **Step 8: HTML リーダーの回帰テストを書く**

`test/server.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 18911;
const base = `http://127.0.0.1:${PORT}`;

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${base}/api/docs`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
}

test('HTML リーダー: 開く → ベース → 聞く → 注釈が返る', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ubq-server-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, UBIQDOC_PORT: String(PORT), UBIQDOC_DATA_DIR: path.join(tmp, 'data'),
      UBIQDOC_CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'), UBIQDOC_FAKE_DIR: path.join(tmp, 'fake') },
    stdio: 'ignore',
  });
  t.after(() => { child.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });
  await waitUp();

  const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const opened = await (await post('/api/open', { path: path.join(__dirname, 'fixtures', 'doc.html') })).json();
  assert.ok(opened.id);

  for (let i = 0; i < 50; i++) {
    const d = await (await fetch(`${base}/api/doc/${opened.id}`)).json();
    if (d.base === 'ready') break;
    await new Promise((r) => setTimeout(r, 100));
  }

  const res = await post('/api/ask', { docId: opened.id, windowId: 'w_test', turnId: 't_test', selection: '楽観ロック', context: '更新時は楽観ロックで競合を検知する。', asides: '', question: '説明して' });
  const text = await res.text();
  const done = text.split('\n\n').find((c) => c.startsWith('event: done'));
  assert.ok(done, text);
  const data = JSON.parse(done.split('\ndata: ')[1]);
  assert.equal(data.reply, '説明です。');
  assert.equal(data.annotations.length, 1);
  assert.equal(data.annotations[0].kind, 'popover');
});
```

- [ ] **Step 9: 通るのを確かめる**

Run: `npm test`
Expected: 8 件すべて PASS

- [ ] **Step 10: 手で HTML リーダーを触って確かめる**

Run: `UBIQDOC_PORT=8899 node server.js` を起動し、`http://127.0.0.1:8899/?open=<このリポジトリ>/test/fixtures/doc.html` を開く。語句をドラッグ → 「説明して」で答えとポップオーバーが出る、右ペインの「取り消す」で消える、を確かめて止める (本物の `claude` を使う)

- [ ] **Step 11: Commit**

```bash
git add package.json .gitignore core/ server.js test/
git commit -m "refactor: プロンプトと claude の実行・タグの読み取りを core/ に切り出す"
```

---

### Task 2: 概念キーの正規化

**Files:**
- Create: `core/concept.js`, `test/concept.test.js`

**Interfaces:**
- Produces: `normalizeKey(s: string) => string` (`core/concept.js`)

- [ ] **Step 1: 失敗するテストを書く**

`test/concept.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeKey } = require('../core/concept.js');

test('小文字にし、記号と空白を - にまとめる', () => {
  assert.equal(normalizeKey('Optimistic Locking'), 'optimistic-locking');
  assert.equal(normalizeKey('  optimistic_locking!! '), 'optimistic-locking');
  assert.equal(normalizeKey('optimistic--locking'), 'optimistic-locking');
});

test('全角英数字を半角にする', () => {
  assert.equal(normalizeKey('ＡＰＩ　Ｇａｔｅｗａｙ'), 'api-gateway');
});

test('英単語の末尾の複数形をそろえる', () => {
  assert.equal(normalizeKey('api gateways'), 'api-gateway');
  assert.equal(normalizeKey('policies'), 'policy');
  assert.equal(normalizeKey('databases'), 'database');
  assert.equal(normalizeKey('caches'), 'cache');
});

test('複数形でない語は削らない', () => {
  assert.equal(normalizeKey('status'), 'status');
  assert.equal(normalizeKey('analysis'), 'analysis');
  assert.equal(normalizeKey('class'), 'class');
  assert.equal(normalizeKey('gas'), 'gas');
});

test('日本語はそのまま残す', () => {
  assert.equal(normalizeKey('楽観ロック'), '楽観ロック');
  assert.equal(normalizeKey('受注 伝票'), '受注-伝票');
});

test('空や記号だけなら空文字', () => {
  assert.equal(normalizeKey(''), '');
  assert.equal(normalizeKey(null), '');
  assert.equal(normalizeKey('---'), '');
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test test/concept.test.js`
Expected: FAIL (`Cannot find module`)

- [ ] **Step 3: 実装する**

`core/concept.js`:

```js
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
```

- [ ] **Step 4: 通るのを確かめる**

Run: `node --test test/concept.test.js`
Expected: 6 件 PASS

- [ ] **Step 5: Commit**

```bash
git add core/concept.js test/concept.test.js
git commit -m "feat: 概念キーの正規化"
```

---

### Task 3: 文字列と位置で補足の場所を探す (anchor)

**Files:**
- Create: `extension/lib/anchor.js`, `test/anchor.test.js`

**Interfaces:**
- Produces (Node では `require`、拡張では `self.ubqAnchor`):
  - `CTX = 24`
  - `buildText(texts: string[]) => { full: string, starts: number[] }`
  - `locate(starts, pos, isEnd) => [nodeIndex, offset]`
  - `findAnchor(full, { exact, prefix?, suffix? }) => { start, end } | null`
  - `quoteAt(full, start, end) => { exact, prefix, suffix }`
  - `overlaps(a: {start,end}, b: {start,end}) => boolean`

- [ ] **Step 1: 失敗するテストを書く**

`test/anchor.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../extension/lib/anchor.js');

test('buildText と locate: ノードの境目は、始まりなら次のノード、終わりなら前のノードに寄せる', () => {
  const { full, starts } = A.buildText(['abc', 'def', 'gh']);
  assert.equal(full, 'abcdefgh');
  assert.deepEqual(starts, [0, 3, 6]);
  assert.deepEqual(A.locate(starts, 3, false), [1, 0]);
  assert.deepEqual(A.locate(starts, 3, true), [0, 3]);
  assert.deepEqual(A.locate(starts, 7, true), [2, 1]);
  assert.deepEqual(A.locate(starts, 0, false), [0, 0]);
});

test('findAnchor: 1 か所だけならそこ', () => {
  assert.deepEqual(A.findAnchor('更新時は楽観ロックを使う', { exact: '楽観ロック' }), { start: 4, end: 9 });
});

test('findAnchor: 何か所もあれば prefix が合うところ', () => {
  const full = '受注伝票の一覧。受注伝票を締める。';
  assert.deepEqual(A.findAnchor(full, { exact: '受注伝票', prefix: '一覧。' }), { start: 8, end: 12 });
});

test('findAnchor: 何か所もあれば suffix が合うところ', () => {
  const full = '受注伝票の一覧。受注伝票を締める。';
  assert.deepEqual(A.findAnchor(full, { exact: '受注伝票', suffix: 'を締め' }), { start: 8, end: 12 });
});

test('findAnchor: 空白の違い (改行・連続空白) は無視して探す', () => {
  const full = 'これは 楽観\n   ロック です';
  const span = A.findAnchor(full, { exact: '楽観 ロック' });
  assert.equal(full.slice(span.start, span.end), '楽観\n   ロック');
});

test('findAnchor: 無ければ null', () => {
  assert.equal(A.findAnchor('abc', { exact: 'xyz' }), null);
  assert.equal(A.findAnchor('abc', { exact: '' }), null);
  assert.equal(A.findAnchor('abc', null), null);
});

test('quoteAt: 前後 24 文字を取る', () => {
  const full = 'x'.repeat(30) + 'TARGET' + 'y'.repeat(30);
  const q = A.quoteAt(full, 30, 36);
  assert.equal(q.exact, 'TARGET');
  assert.equal(q.prefix, 'x'.repeat(24));
  assert.equal(q.suffix, 'y'.repeat(24));
});

test('overlaps: 接しているだけなら重ならない', () => {
  assert.equal(A.overlaps({ start: 0, end: 5 }, { start: 5, end: 8 }), false);
  assert.equal(A.overlaps({ start: 0, end: 5 }, { start: 4, end: 8 }), true);
  assert.equal(A.overlaps({ start: 2, end: 3 }, { start: 0, end: 8 }), true);
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test test/anchor.test.js`
Expected: FAIL (`Cannot find module`)

- [ ] **Step 3: 実装する**

`extension/lib/anchor.js`:

```js
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
```

- [ ] **Step 4: 通るのを確かめる**

Run: `node --test test/anchor.test.js`
Expected: 8 件 PASS

- [ ] **Step 5: Commit**

```bash
git add extension/lib/anchor.js test/anchor.test.js
git commit -m "feat: 文字列と位置で補足の場所を探す anchor"
```

---

### Task 4: data/ がコミット対象でないことの検査 (guard)

**Files:**
- Create: `host/guard.js`, `test/guard.test.js`

**Interfaces:**
- Produces: `checkDataDir(dataDir: string) => { ok: true } | { ok: false, reason: string }` (`host/guard.js`)

- [ ] **Step 1: 失敗するテストを書く**

`test/guard.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { checkDataDir } = require('../host/guard.js');

function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubq-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd });

test('git の外なら通す', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubq-guard-out-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(checkDataDir(path.join(dir, 'data')), { ok: true });
});

test('git の中で .gitignore に無ければ止める', (t) => {
  const dir = repo(t);
  const r = checkDataDir(path.join(dir, 'data'));
  assert.equal(r.ok, false);
  assert.match(r.reason, /無視対象/);
});

test('.gitignore に data/ があれば通す', (t) => {
  const dir = repo(t);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'data/\n');
  assert.deepEqual(checkDataDir(path.join(dir, 'data')), { ok: true });
});

test('.gitignore にあっても、過去にコミットされていれば止める', (t) => {
  const dir = repo(t);
  fs.mkdirSync(path.join(dir, 'data', 'profile'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'profile', 'work.json'), '{}');
  git(dir, 'add', 'data');
  git(dir, 'commit', '-qm', 'oops');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'data/\n');
  const r = checkDataDir(path.join(dir, 'data'));
  assert.equal(r.ok, false);
  assert.match(r.reason, /git 管理のファイル/);
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test test/guard.test.js`
Expected: FAIL (`Cannot find module`)

- [ ] **Step 3: 実装する**

`host/guard.js`:

```js
// data/profile/work.json には社外に出せない業務知識が入る。このリポジトリは公開されている。
// .gitignore の data/ だけに頼らず、host の起動のたびに確かめて、外れていたら何もしない
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function git(args, cwd) {
  try {
    return { ok: true, out: execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString() };
  } catch (e) {
    return { ok: false, code: e.status };
  }
}

function checkDataDir(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const inside = git(['rev-parse', '--is-inside-work-tree'], dataDir);
  if (!inside.ok || inside.out.trim() !== 'true') return { ok: true };
  // 先に「過去にコミットされていないか」を見る。git check-ignore は管理下のファイルを
  // 無視対象として報告しないので、順番が逆だと理由を取り違える
  const tracked = git(['ls-files', '--', dataDir], dataDir);
  if (!tracked.ok || tracked.out.trim()) {
    return { ok: false, reason: `${dataDir} の下に git 管理のファイルがあります。git rm --cached で外してください: ${(tracked.out || '').trim().split('\n')[0]}` };
  }
  const probe = path.join(dataDir, 'profile', 'work.json');
  if (!git(['check-ignore', '-q', probe], dataDir).ok) {
    return { ok: false, reason: `${probe} が git の無視対象になっていません。.gitignore に data/ を入れてください` };
  }
  return { ok: true };
}

module.exports = { checkDataDir };
```

- [ ] **Step 4: 通るのを確かめる**

Run: `node --test test/guard.test.js`
Expected: 4 件 PASS

- [ ] **Step 5: Commit**

```bash
git add host/guard.js test/guard.test.js
git commit -m "feat: data/ がコミット対象なら host を止める検査"
```

---

### Task 5: 知識プロフィールと索引

**Files:**
- Create: `host/fsutil.js`, `host/profile.js`, `test/profile.test.js`

**Interfaces:**
- Consumes: `normalizeKey` (Task 2)
- Produces:
  - `writeAtomic(file: string, text: string)` (`host/fsutil.js`)
  - `class Profile` (`host/profile.js`):
    - `new Profile(dir)`、`.load() => this`
    - `.knows({ key?, label?, aliases? }) => boolean`
    - `.add({ key, label, category, aliases?, fromUrl? }) => Concept` (`Concept = { id, key, label, aliases, addedAt, fromUrl, category }`)。同じ概念が既にあれば別名を足して返す
    - `.remove(id) => Concept | null`
    - `.list() => { personal: Concept[], work: Concept[] }`

- [ ] **Step 1: 失敗するテストを書く**

`test/profile.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Profile } = require('../host/profile.js');

function dir(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ubq-profile-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

test('足した概念は、キー・表記・別名のどれでも、正規化して照合できる', (t) => {
  const p = new Profile(dir(t)).load();
  p.add({ key: 'optimistic-locking', label: '楽観ロック', category: 'personal', aliases: ['optimistic lock'] });
  assert.equal(p.knows({ key: 'Optimistic Locking' }), true);
  assert.equal(p.knows({ key: 'x', label: '楽観ロック' }), true);
  assert.equal(p.knows({ key: 'optimistic_lock' }), true);
  assert.equal(p.knows({ key: 'pessimistic-locking' }), false);
});

test('区分ごとに別のファイルへ書き、読み直しても残る', (t) => {
  const d = dir(t);
  const p = new Profile(d).load();
  p.add({ key: 'idempotency', label: '冪等性', category: 'personal' });
  p.add({ key: 'sales-order-slip', label: '受注伝票', category: 'work' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'personal.json'), 'utf8')).concepts.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'work.json'), 'utf8')).concepts.length, 1);
  const again = new Profile(d).load();
  assert.equal(again.knows({ key: 'sales-order-slip' }), true);
  assert.deepEqual(again.list().work.map((c) => c.label), ['受注伝票']);
});

test('同じ概念を足し直すと、増やさずに別名を足す', (t) => {
  const p = new Profile(dir(t)).load();
  const a = p.add({ key: 'idempotency', label: '冪等性', category: 'personal' });
  const b = p.add({ key: 'Idempotency', label: 'べき等', category: 'personal' });
  assert.equal(a.id, b.id);
  assert.equal(p.list().personal.length, 1);
  assert.ok(p.list().personal[0].aliases.includes('べき等'));
  assert.equal(p.knows({ label: 'べき等' }), true);
});

test('不正な区分は work に倒す', (t) => {
  const p = new Profile(dir(t)).load();
  const c = p.add({ key: 'k', label: 'K', category: 'hobby' });
  assert.equal(c.category, 'work');
});

test('remove で外すと、照合されなくなる', (t) => {
  const p = new Profile(dir(t)).load();
  const c = p.add({ key: 'idempotency', label: '冪等性', category: 'personal' });
  assert.equal(p.remove(c.id).label, '冪等性');
  assert.equal(p.knows({ key: 'idempotency' }), false);
  assert.equal(p.remove('nope'), null);
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test test/profile.test.js`
Expected: FAIL (`Cannot find module`)

- [ ] **Step 3: 実装する**

`host/fsutil.js`:

```js
const fs = require('fs');
const path = require('path');

// 途中で落ちても壊れたファイルが残らないよう、一時ファイルに書いてから rename する
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

module.exports = { writeAtomic };
```

`host/profile.js`:

```js
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
```

- [ ] **Step 4: 通るのを確かめる**

Run: `node --test test/profile.test.js`
Expected: 5 件 PASS

- [ ] **Step 5: Commit**

```bash
git add host/fsutil.js host/profile.js test/profile.test.js
git commit -m "feat: 知識プロフィールと索引"
```

---

### Task 6: ページの保存と、補足の操作

**Files:**
- Create: `host/pages.js`, `host/page-ops.js`, `test/pages.test.js`, `test/page-ops.test.js`

**Interfaces:**
- Consumes: `findAnchor`, `overlaps` (Task 3)、`normalizeKey` (Task 2)、`Profile#knows` (Task 5)、`writeAtomic` (Task 5)
- Produces:
  - `normalizeUrl(url) => string`、`pageKey(url) => string (40 桁の hex)`、`textHash(text) => string` (`host/pages.js`)
  - `class Pages` (`host/pages.js`): `new Pages(dataDir)`、`.get(key) => Page | null`、`.create(key, url, title) => Page`、`.save(key)`、`.readText(key) => string`、`.writeText(key, text)`、`.log(key, name, obj)`
  - `Page = { url, title, model, baseSessionId, baseModel, textHash, version, links, truncated, proactiveAt, annotations: Stored[], pending: Pending[], dropped: { noSource } }`
  - `Stored = { id, turnId, windowId?, origin, concept?, kind, anchor: {exact, prefix, suffix?}, title, body, href, sourceUrls, dependsOn, createdAt, state: 'shown'|'orphaned', savedSection? }`
  - `page-ops.js`: `LIMIT`、`addAnnotation(page, text, ann, { onConflict: 'pending'|'skip' }) => { status: 'added'|'pending'|'skipped'|'unanchored', annotation?, pending? }`、`isVisible(a, profile)`、`selectConcepts(concepts, { page, profile }) => concept[]`、`reanchor(page, text) => string[]`、`undoTurn(page, turnId) => number`、`convert(page, id, to) => boolean`、`approve(page, pid) => Stored | null`、`reject(page, pid) => boolean`、`discardOrphan(page, id) => boolean`、`view(page, profile, key) => View`
  - `View = { key, url, title, model, annotations: (Stored & { hidden: boolean })[], orphaned: Stored[], pending, dropped, truncated }`

- [ ] **Step 1: pages の失敗するテストを書く**

`test/pages.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pages, normalizeUrl, pageKey } = require('../host/pages.js');

test('normalizeUrl: # 以降と utm_* / pvs を落とし、ほかのクエリは残す', () => {
  assert.equal(normalizeUrl('https://www.notion.so/Page-abc123?pvs=4#h1'), 'https://www.notion.so/Page-abc123');
  assert.equal(normalizeUrl('https://github.com/o/r/issues/1?utm_source=x&tab=files'), 'https://github.com/o/r/issues/1?tab=files');
});

test('pageKey は 40 桁の hex で、正規化後が同じなら同じ', () => {
  const k = pageKey('https://www.notion.so/Page-abc123?pvs=4');
  assert.match(k, /^[0-9a-f]{40}$/);
  assert.equal(k, pageKey('https://www.notion.so/Page-abc123#x'));
});

test('作って保存し、別のインスタンスから読み直せる。本文も別に持つ', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ubq-pages-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const key = pageKey('https://example.com/a');
  const pages = new Pages(d);
  const p = pages.create(key, 'https://example.com/a', 'A');
  p.annotations.push({ id: 'a_01' });
  pages.save(key);
  pages.writeText(key, '本文');
  const again = new Pages(d);
  assert.equal(again.get(key).annotations.length, 1);
  assert.equal(again.readText(key), '本文');
  assert.equal(again.get(pageKey('https://example.com/none')), null);
});

test('不正なキーは断る', (t) => {
  const pages = new Pages(os.tmpdir());
  assert.throws(() => pages.get('../../etc'), /bad page key/);
});
```

- [ ] **Step 2: page-ops の失敗するテストを書く**

`test/page-ops.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const ops = require('../host/page-ops.js');

const TEXT = '更新時は楽観ロックで競合を検知する。受注伝票は月末に締める。';
const noProfile = { knows: () => false };
const newPage = () => ({ annotations: [], pending: [], dropped: { noSource: 0 } });
const ann = (exact, extra = {}) => ({ turnId: 't_1', origin: 'proactive', kind: 'popover', anchor: { exact, prefix: '' }, body: '説明', sourceUrls: ['https://e.example/'], dependsOn: [], ...extra });

test('addAnnotation: 足すと a_01 から番号が振られ、shown になる', () => {
  const page = newPage();
  const r = ops.addAnnotation(page, TEXT, ann('楽観ロック'), { onConflict: 'skip' });
  assert.equal(r.status, 'added');
  assert.equal(r.annotation.id, 'a_01');
  assert.equal(r.annotation.state, 'shown');
  assert.equal(ops.addAnnotation(page, TEXT, ann('受注伝票'), { onConflict: 'skip' }).annotation.id, 'a_02');
});

test('addAnnotation: 本文に無ければ unanchored', () => {
  assert.equal(ops.addAnnotation(newPage(), TEXT, ann('存在しない語'), { onConflict: 'skip' }).status, 'unanchored');
});

test('addAnnotation: 同じ範囲なら重ねて足す (表示ではまとめて出す)', () => {
  const page = newPage();
  ops.addAnnotation(page, TEXT, ann('楽観ロック'), { onConflict: 'pending' });
  assert.equal(ops.addAnnotation(page, TEXT, ann('楽観ロック', { origin: 'ask' }), { onConflict: 'pending' }).status, 'added');
  assert.equal(page.annotations.length, 2);
});

test('addAnnotation: 一部だけ重なると、pending か skipped', () => {
  const page = newPage();
  ops.addAnnotation(page, TEXT, ann('楽観ロック'), { onConflict: 'pending' });
  const p = ops.addAnnotation(page, TEXT, ann('ロックで競合'), { onConflict: 'pending' });
  assert.equal(p.status, 'pending');
  assert.equal(page.pending[0].conflictWith, 'a_01');
  assert.equal(ops.addAnnotation(page, TEXT, ann('ロックで'), { onConflict: 'skip' }).status, 'skipped');
  assert.equal(page.pending.length, 1);
});

test('selectConcepts: 知ってる・表示中・重複を落とし、importance の高い順に残りの枠だけ取る', () => {
  const page = newPage();
  for (let i = 0; i < 18; i++) page.annotations.push({ id: `a_${i}`, origin: 'proactive', state: 'shown', concept: { key: `k${i}` }, anchor: { exact: 'x' } });
  page.annotations.push({ id: 'a_x', origin: 'proactive', state: 'shown', concept: { key: 'shown-one' }, anchor: { exact: 'x' } });
  const profile = { knows: (c) => c.key === 'known-one' };
  const picked = ops.selectConcepts([
    { key: 'low', importance: 1 },
    { key: 'known-one', importance: 5 },
    { key: 'Shown One', importance: 5 },
    { key: 'high', importance: 4 },
    { key: 'HIGH', importance: 4 },
  ], { page, profile });
  assert.deepEqual(picked.map((c) => c.key), ['high']);
});

test('selectConcepts: 「知ってる」で隠れた先回りの補足は枠に数えない', () => {
  const page = newPage();
  for (let i = 0; i < 20; i++) page.annotations.push({ id: `a_${i}`, origin: 'proactive', state: 'shown', concept: { key: `k${i}` }, anchor: { exact: 'x' } });
  const profile = { knows: (c) => c.key === 'k0' };
  assert.deepEqual(ops.selectConcepts([{ key: 'new', importance: 3 }], { page, profile }).map((c) => c.key), ['new']);
});

test('selectConcepts: ドラッグして聞いた補足は枠に数えない', () => {
  const page = newPage();
  for (let i = 0; i < 20; i++) page.annotations.push({ id: `a_${i}`, origin: 'ask', state: 'shown', anchor: { exact: 'x' } });
  assert.equal(ops.selectConcepts([{ key: 'new', importance: 3 }], { page, profile: noProfile }).length, 1);
});

test('reanchor: 見つからなくなった補足を orphaned にする', () => {
  const page = newPage();
  ops.addAnnotation(page, TEXT, ann('楽観ロック'), { onConflict: 'skip' });
  ops.addAnnotation(page, TEXT, ann('受注伝票'), { onConflict: 'skip' });
  assert.deepEqual(ops.reanchor(page, '更新時は楽観ロックで競合を検知する。'), ['a_02']);
  assert.equal(page.annotations[1].state, 'orphaned');
});

test('undoTurn: その回の補足と承認待ちを消す', () => {
  const page = newPage();
  ops.addAnnotation(page, TEXT, ann('楽観ロック', { turnId: 't_a' }), { onConflict: 'pending' });
  ops.addAnnotation(page, TEXT, ann('受注伝票', { turnId: 't_b' }), { onConflict: 'pending' });
  ops.addAnnotation(page, TEXT, ann('ロックで競合', { turnId: 't_b' }), { onConflict: 'pending' });
  assert.equal(ops.undoTurn(page, 't_b'), 2);
  assert.deepEqual(page.annotations.map((a) => a.id), ['a_01']);
  assert.equal(page.pending.length, 0);
});

test('convert: ポップオーバー → セクション → ポップオーバー → セクションで元の見出しと本文に戻る', () => {
  const page = newPage();
  const { annotation } = ops.addAnnotation(page, TEXT, ann('受注伝票', { kind: 'section', title: '受注伝票とは', body: '<p>締めの<strong>単位</strong></p>' }), { onConflict: 'skip' });
  assert.equal(ops.convert(page, annotation.id, 'popover'), true);
  assert.equal(annotation.kind, 'popover');
  assert.equal(annotation.body, '締めの 単位');
  assert.equal(ops.convert(page, annotation.id, 'section'), true);
  assert.equal(annotation.title, '受注伝票とは');
  assert.equal(annotation.body, '<p>締めの<strong>単位</strong></p>');
  assert.equal(ops.convert(page, annotation.id, 'section'), false);
});

test('convert: 元からポップオーバーなら、語句を見出しにして段落で包む', () => {
  const page = newPage();
  const { annotation } = ops.addAnnotation(page, TEXT, ann('楽観ロック', { body: 'a < b' }), { onConflict: 'skip' });
  ops.convert(page, annotation.id, 'section');
  assert.equal(annotation.title, '楽観ロック');
  assert.equal(annotation.body, '<p>a &lt; b</p>');
});

test('approve: 承認待ちをセクションとして足す / reject は捨てる', () => {
  const page = newPage();
  ops.addAnnotation(page, TEXT, ann('楽観ロック'), { onConflict: 'pending' });
  ops.addAnnotation(page, TEXT, ann('ロックで競合', { body: '説明2' }), { onConflict: 'pending' });
  ops.addAnnotation(page, TEXT, ann('ロックで', { body: '説明3' }), { onConflict: 'pending' });
  const [p1, p2] = page.pending;
  const a = ops.approve(page, p1.id);
  assert.equal(a.kind, 'section');
  assert.equal(a.body, '<p>説明2</p>');
  assert.equal(ops.reject(page, p2.id), true);
  assert.equal(page.pending.length, 0);
  assert.equal(ops.approve(page, 'nope'), null);
});

test('discardOrphan: orphaned だけを消せる', () => {
  const page = newPage();
  ops.addAnnotation(page, TEXT, ann('受注伝票'), { onConflict: 'skip' });
  assert.equal(ops.discardOrphan(page, 'a_01'), false);
  ops.reanchor(page, '別の本文');
  assert.equal(ops.discardOrphan(page, 'a_01'), true);
  assert.equal(page.annotations.length, 0);
});

test('view: 知っている概念の補足には hidden を立て、orphaned は分けて出す', () => {
  const page = { ...newPage(), url: 'u', title: 't', model: 'haiku' };
  ops.addAnnotation(page, TEXT, ann('楽観ロック', { concept: { key: 'optimistic-locking', category: 'personal' } }), { onConflict: 'skip' });
  ops.addAnnotation(page, TEXT, ann('受注伝票'), { onConflict: 'skip' });
  ops.reanchor(page, '更新時は楽観ロックで競合を検知する。');
  const v = ops.view(page, { knows: (c) => c.key === 'optimistic-locking' }, 'k');
  assert.equal(v.annotations.length, 1);
  assert.equal(v.annotations[0].hidden, true);
  assert.equal(v.orphaned.length, 1);
  assert.equal(v.key, 'k');
});
```

- [ ] **Step 3: 失敗を確かめる**

Run: `node --test test/pages.test.js test/page-ops.test.js`
Expected: FAIL (`Cannot find module`)

- [ ] **Step 4: `host/pages.js` を書く**

```js
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
```

- [ ] **Step 5: `host/page-ops.js` を書く**

```js
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

function isVisible(a, profile) {
  return a.state === 'shown' && !(a.concept && profile.knows(a.concept));
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

function view(page, profile, key) {
  return {
    key, url: page.url, title: page.title, model: page.model,
    annotations: page.annotations.filter((a) => a.state === 'shown').map((a) => ({ ...a, hidden: !!(a.concept && profile.knows(a.concept)) })),
    orphaned: page.annotations.filter((a) => a.state === 'orphaned'),
    pending: page.pending,
    dropped: page.dropped,
    truncated: !!page.truncated,
  };
}

module.exports = { LIMIT, addAnnotation, isVisible, selectConcepts, reanchor, undoTurn, convert, approve, reject, discardOrphan, view };
```

- [ ] **Step 6: 通るのを確かめる**

Run: `node --test test/pages.test.js test/page-ops.test.js`
Expected: 4 + 14 件 PASS

- [ ] **Step 7: Commit**

```bash
git add host/pages.js host/page-ops.js test/pages.test.js test/page-ops.test.js
git commit -m "feat: ページの補足の保存と、追加・重なり・付け直し・変換・承認"
```

---

### Task 7: native messaging の枠

**Files:**
- Create: `host/framing.js`, `test/framing.test.js`

**Interfaces:**
- Produces: `encode(obj) => Buffer`、`class Decoder { constructor(onMessage); push(chunk: Buffer) }` (`host/framing.js`)

- [ ] **Step 1: 失敗するテストを書く**

`test/framing.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { encode, Decoder } = require('../host/framing.js');

test('長さはバイト数 (UTF-8) のリトルエンディアン 4 バイト', () => {
  const b = encode({ t: 'あ' });
  assert.equal(b.readUInt32LE(0), Buffer.byteLength('{"t":"あ"}'));
});

test('分割されて届いても、1 通にまとまって届いても読める', () => {
  const got = [];
  const d = new Decoder((m) => got.push(m));
  const all = Buffer.concat([encode({ a: 1 }), encode({ b: '日本語' }), encode({ c: 3 })]);
  d.push(all.subarray(0, 3));
  d.push(all.subarray(3, 15));
  d.push(all.subarray(15));
  assert.deepEqual(got, [{ a: 1 }, { b: '日本語' }, { c: 3 }]);
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test test/framing.test.js`
Expected: FAIL (`Cannot find module`)

- [ ] **Step 3: 実装する**

`host/framing.js`:

```js
// Chrome の native messaging の枠: 4 バイト (ネイティブのバイト順。macOS ではリトルエンディアン) の長さ + UTF-8 の JSON

function encode(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

class Decoder {
  constructor(onMessage) { this.onMessage = onMessage; this.buf = Buffer.alloc(0); }
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 4) {
      const n = this.buf.readUInt32LE(0);
      if (this.buf.length < 4 + n) break;
      const body = this.buf.subarray(4, 4 + n);
      this.buf = this.buf.subarray(4 + n);
      this.onMessage(JSON.parse(body.toString('utf8')));
    }
  }
}

module.exports = { encode, Decoder };
```

- [ ] **Step 4: 通るのを確かめる**

Run: `node --test test/framing.test.js`
Expected: 2 件 PASS

- [ ] **Step 5: Commit**

```bash
git add host/framing.js test/framing.test.js
git commit -m "feat: native messaging の枠"
```

---

### Task 8: ベースセッションと先回りの 3 段

**Files:**
- Create: `host/bases.js`, `host/proactive.js`, `test/proactive.test.js`

**Interfaces:**
- Consumes: `runClaude` / プロンプト (Task 1)、`parseConcepts` / `parseAnswer` / `TagStream` (Task 1)、`Pages` / `textHash` (Task 6)、`page-ops` (Task 6)、`normalizeKey` (Task 2)
- Produces:
  - `class Bases` (`host/bases.js`): `new Bases({ pages, run? })`、`.ensure(key) => Promise<sessionId>`、`.fork(key, prompt, { onDelta? }) => Promise<result>`、`.resume(key, sessionId, prompt, { onDelta? }) => Promise<result>`。ベースは `pages.readText(key)` と `page.links` から作る
  - `runProactive({ key, pages, bases, profile, emit }) => Promise<{ made }>` (`host/proactive.js`)。`emit('progress', { stage: 'extract'|'write'|'done', made, total })`、`emit('annotation', Stored)`

- [ ] **Step 1: 失敗するテストを書く**

`test/proactive.test.js` (`claude` を spawn せず、`run` を差し替えて試す):

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pages, pageKey } = require('../host/pages.js');
const { Bases } = require('../host/bases.js');
const { runProactive } = require('../host/proactive.js');

const TEXT = '更新時は楽観ロックで競合を検知する。受注伝票は月末に締める。冪等性も要る。';

function setup(t, { links = [] } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ubq-pro-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const pages = new Pages(d);
  const key = pageKey('https://example.com/p');
  const page = pages.create(key, 'https://example.com/p', 'P');
  page.links = links;
  pages.writeText(key, TEXT);
  pages.save(key);
  return { pages, key };
}

// 呼ばれた引数を残し、プロンプトの種類で答えを返す run
function fakeRun(answers, calls = []) {
  let n = 0;
  return async (args, prompt, { onDelta } = {}) => {
    calls.push({ args, prompt });
    const kind = prompt.startsWith('これから') ? 'base' : prompt.startsWith('[抜き出し]') ? 'extract' : prompt.startsWith('[補足を書く]') ? 'write' : 'other';
    const result = answers[kind] instanceof Error ? (() => { throw answers[kind]; })() : (answers[kind] ?? 'OK');
    if (onDelta) for (let i = 0; i < result.length; i += 7) onDelta(result.slice(i, i + 7));
    n++;
    return { session_id: `s_${n}`, result };
  };
}

const CONCEPTS = [
  '<ubiqdoc-concept key="optimistic-locking" label="楽観ロック" category="personal" importance="4" exact="楽観ロック" prefix="更新時は"/>',
  '<ubiqdoc-concept key="sales-order-slip" label="受注伝票" category="work" importance="5" exact="受注伝票" prefix="。"/>',
  '<ubiqdoc-concept key="idempotency" label="冪等性" category="personal" importance="2" exact="冪等性" prefix="。"/>',
].join('\n');

const WRITES = [
  '<ubiqdoc-popover target="楽観ロック" prefix="更新時は" concept="optimistic-locking" category="personal" source="https://en.wikipedia.org/wiki/Optimistic_concurrency_control">楽観ロックの説明</ubiqdoc-popover>',
  '<ubiqdoc-section target="受注伝票" prefix="。" concept="sales-order-slip" category="work" title="受注伝票とは"><p>説明</p></ubiqdoc-section>',
  '<ubiqdoc-popover target="冪等性" concept="idempotency" category="personal" source="https://en.wikipedia.org/wiki/Idempotence">冪等性の説明</ubiqdoc-popover>',
  '<ubiqdoc-popover target="月末" concept="month-end" category="work" source="https://e.example/">頼んでいない概念</ubiqdoc-popover>',
].join('\n');

test('3 段: 出典のある補足だけを足し、出典の無いものは数え、頼んでいない概念は捨てる', async (t) => {
  const { pages, key } = setup(t);
  const calls = [];
  const bases = new Bases({ pages, run: fakeRun({ extract: CONCEPTS, write: WRITES }, calls) });
  const events = [];
  const r = await runProactive({ key, pages, bases, profile: { knows: () => false }, emit: (e, d) => events.push([e, d]) });
  assert.equal(r.made, 2);
  const page = pages.get(key);
  assert.deepEqual(page.annotations.map((a) => a.anchor.exact), ['楽観ロック', '冪等性']);
  assert.equal(page.annotations[0].concept.category, 'personal');
  assert.equal(page.annotations[0].origin, 'proactive');
  assert.equal(page.dropped.noSource, 1);
  assert.equal(events.filter(([e]) => e === 'annotation').length, 2);
  assert.deepEqual(events.at(-1), ['progress', { stage: 'done', made: 2, total: 3 }]);
  // ベース 1 回、抜き出しと補足書きはどちらも fork
  assert.equal(calls.filter((c) => c.prompt.startsWith('これから')).length, 1);
  assert.ok(calls.filter((c) => !c.prompt.startsWith('これから')).every((c) => c.args.includes('--fork-session')));
});

test('知っている概念は補足書きに回さない', async (t) => {
  const { pages, key } = setup(t);
  const calls = [];
  const bases = new Bases({ pages, run: fakeRun({ extract: CONCEPTS, write: '' }, calls) });
  await runProactive({ key, pages, bases, profile: { knows: (c) => c.key === 'optimistic-locking' }, emit: () => {} });
  const write = calls.find((c) => c.prompt.startsWith('[補足を書く]'));
  assert.ok(!write.prompt.includes('optimistic-locking'));
  assert.ok(write.prompt.includes('sales-order-slip'));
});

test('候補が無ければ補足書きを呼ばない', async (t) => {
  const { pages, key } = setup(t);
  const calls = [];
  const bases = new Bases({ pages, run: fakeRun({ extract: '' }, calls) });
  const r = await runProactive({ key, pages, bases, profile: { knows: () => false }, emit: () => {} });
  assert.equal(r.made, 0);
  assert.equal(calls.some((c) => c.prompt.startsWith('[補足を書く]')), false);
});

test('Bases: 同時に頼まれてもベースは 1 回だけ作り、本文が変わったら作り直す', async (t) => {
  const { pages, key } = setup(t);
  const calls = [];
  const bases = new Bases({ pages, run: fakeRun({}, calls) });
  const [a, b] = await Promise.all([bases.ensure(key), bases.ensure(key)]);
  assert.equal(a, b);
  assert.equal(calls.length, 1);
  assert.equal(await bases.ensure(key), a);
  pages.writeText(key, '別の本文');
  assert.notEqual(await bases.ensure(key), a);
  assert.equal(calls.length, 2);
});

test('Bases: ベースのセッションが消えていたら作り直して 1 回だけやり直す', async (t) => {
  const { pages, key } = setup(t);
  let first = true;
  const calls = [];
  const run = async (args, prompt) => {
    calls.push(prompt.slice(0, 6));
    if (args.includes('--fork-session') && first) { first = false; throw new Error('No conversation found with session ID: s_1'); }
    return { session_id: `s_${calls.length}`, result: 'OK' };
  };
  const bases = new Bases({ pages, run });
  const r = await bases.fork(key, '[抜き出し]\nx');
  assert.equal(r.result, 'OK');
  assert.equal(calls.filter((c) => c.startsWith('これから')).length, 2);
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test test/proactive.test.js`
Expected: FAIL (`Cannot find module`)

- [ ] **Step 3: `host/bases.js` を書く**

```js
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
```

- [ ] **Step 4: `host/proactive.js` を書く**

```js
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
```

- [ ] **Step 5: 通るのを確かめる**

Run: `node --test test/proactive.test.js`
Expected: 5 件 PASS

- [ ] **Step 6: Commit**

```bash
git add host/bases.js host/proactive.js test/proactive.test.js
git commit -m "feat: ベースセッションと先回りの 3 段"
```

---

### Task 9: host 本体 (要求の振り分けと stdio)

**Files:**
- Create: `host/host.js`, `test/host.test.js`

**Interfaces:**
- Consumes: Task 4〜8 のすべて
- Produces: `createHost({ dataDir, run? }) => { handle(msg, send) }` (`host/host.js`)。`node host/host.js` で stdio の host として動く (`UBIQDOC_DATA_DIR` 既定はリポジトリの `data/`)
- 要求 (`{ id, type, ... }`) と結果:

| type | 入力 | 結果 (`data`) | 途中の event |
|---|---|---|---|
| `hello` | — | `{ ok, reason? }` | — |
| `open-page` | `url, title, text, links, model, force?` | `{ view }` | `view` / `progress` / `annotation` |
| `page-view` | `url` | `{ view: View \| null, status }` | — |
| `ask` | `url, windowId, sessionId?, turnId, selection, quote, context?, asides, question` | `{ reply, added, pending, unanchored, parseError?, sessionId, ms, view }` | `delta` |
| `mark-known` | `url, annotationId` | `{ conceptId, label, view }` | — |
| `unmark-known` | `conceptId` | `{ removed }` | — |
| `profile-list` | — | `{ personal, work }` | — |
| `profile-remove` | `id` | `{ removed }` | — |
| `undo-turn` | `url, turnId` | `{ view }` | — |
| `convert` | `url, id, to` | `{ view }` | — |
| `approve` / `reject` | `url, pid` | `{ view }` | — |
| `discard-orphan` | `url, id` | `{ view }` | — |

- 返信の形: 途中は `{ id, type: 'event', event, data }`、最後に `{ id, type: 'result', data }` か `{ id, type: 'error', message }`

- [ ] **Step 1: 結合テストを書く**

`test/host.test.js` (本物の host を spawn し、`fake-claude.js` を `claude` の代わりにする):

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { encode, Decoder } = require('../host/framing.js');

const ROOT = path.join(__dirname, '..');
const FAKE = path.join(__dirname, 'fixtures', 'fake-claude.js');
const URL1 = 'https://www.notion.so/Spec-0123abcd';
const TEXT = '更新時は楽観ロックで競合を検知する。受注伝票は月末に締める。在庫引当は夜間に行う。';
const LINKS = [{ text: '受注の仕様', href: 'https://www.notion.so/Order-spec-99' }];

function startHost(t, dataDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ubq-host-'));
  const dir = dataDir || path.join(tmp, 'data');
  const fakeDir = path.join(tmp, 'fake');
  const child = spawn(process.execPath, [path.join(ROOT, 'host', 'host.js')], {
    env: { ...process.env, UBIQDOC_DATA_DIR: dir, UBIQDOC_CLAUDE_BIN: FAKE, UBIQDOC_FAKE_DIR: fakeDir },
  });
  t.after(() => { child.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });
  const waiting = new Map();
  let seq = 0;
  const dec = new Decoder((m) => {
    const w = waiting.get(m.id);
    if (!w) return;
    if (m.type === 'event') { w.events.push([m.event, m.data]); return; }
    waiting.delete(m.id);
    m.type === 'result' ? w.resolve({ data: m.data, events: w.events }) : w.reject(new Error(m.message));
  });
  child.stdout.on('data', (c) => dec.push(c));
  const req = (type, payload = {}) => new Promise((resolve, reject) => {
    const id = `q${++seq}`;
    waiting.set(id, { resolve, reject, events: [] });
    child.stdin.write(encode({ ...payload, id, type }));
  });
  const calls = () => {
    const f = path.join(fakeDir, 'calls.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map(JSON.parse) : [];
  };
  return { req, calls, dataDir: dir };
}

const open = (h, extra = {}) => h.req('open-page', { url: URL1, title: '仕様', text: TEXT, links: LINKS, model: 'haiku', ...extra });

test('開く → 先回りの補足 → もう一度開いても claude を呼ばない', async (t) => {
  const h = startHost(t);
  assert.equal((await h.req('hello')).data.ok, true);
  const r = await open(h);
  const anns = r.data.view.annotations;
  assert.deepEqual(anns.map((a) => a.anchor.exact).sort(), ['受注伝票', '楽観ロック']);
  assert.equal(anns.find((a) => a.anchor.exact === '受注伝票').sourceUrls[0], LINKS[0].href);
  assert.ok(r.events.some(([e]) => e === 'annotation'));
  assert.ok(r.events.some(([e, d]) => e === 'progress' && d.stage === 'done'));
  const n = h.calls().length;
  const again = await open(h);
  assert.equal(again.data.view.annotations.length, 2);
  assert.equal(h.calls().length, n);
});

test('同時に 2 回開いても、抜き出しは 1 回だけ', async (t) => {
  const h = startHost(t);
  await Promise.all([open(h), open(h)]);
  assert.equal(h.calls().filter((c) => c.head.startsWith('[抜き出し]')).length, 1);
});

test('本文にリンクが無いと、業務用語の補足は出典なしで捨てて数える', async (t) => {
  const h = startHost(t);
  const r = await open(h, { links: [] });
  assert.deepEqual(r.data.view.annotations.map((a) => a.anchor.exact), ['楽観ロック']);
  assert.equal(r.data.view.dropped.noSource, 1);
});

test('知ってる → 隠れる → 戻す → また出る', async (t) => {
  const h = startHost(t);
  const v = (await open(h)).data.view;
  const target = v.annotations.find((a) => a.anchor.exact === '楽観ロック');
  const k = await h.req('mark-known', { url: URL1, annotationId: target.id });
  assert.equal(k.data.view.annotations.find((a) => a.id === target.id).hidden, true);
  assert.equal((await h.req('profile-list')).data.personal.length, 1);
  await h.req('unmark-known', { conceptId: k.data.conceptId });
  const after = (await h.req('page-view', { url: URL1 })).data.view;
  assert.equal(after.annotations.find((a) => a.id === target.id).hidden, false);
});

test('本文が変わると、消えた語句の補足は orphaned になる', async (t) => {
  const h = startHost(t);
  await open(h);
  const r = await open(h, { text: '更新時は楽観ロックで競合を検知する。' });
  assert.deepEqual(r.data.view.orphaned.map((a) => a.anchor.exact), ['受注伝票']);
  assert.deepEqual(r.data.view.annotations.map((a) => a.anchor.exact), ['楽観ロック']);
});

test('ドラッグして聞く → 補足が足される → 取り消す', async (t) => {
  const h = startHost(t);
  await open(h);
  const quote = { exact: '在庫引当', prefix: '月末に締める。', suffix: 'は夜間に' };
  const r = await h.req('ask', { url: URL1, windowId: 'w_1', turnId: 't_ask', selection: '在庫引当', quote, context: TEXT, asides: '', question: '説明して' });
  assert.equal(r.data.reply, '説明です。');
  assert.equal(r.data.added.length, 1);
  assert.equal(r.data.added[0].origin, 'ask');
  assert.ok(r.events.some(([e]) => e === 'delta'));
  const follow = await h.req('ask', { url: URL1, windowId: 'w_1', sessionId: r.data.sessionId, turnId: 't_ask2', selection: '在庫引当', quote, asides: '', question: 'もっと' });
  assert.equal(follow.data.reply, '説明です。');
  const u = await h.req('undo-turn', { url: URL1, turnId: 't_ask' });
  assert.equal(u.data.view.annotations.filter((a) => a.turnId === 't_ask').length, 0);
});

test('セクション ↔ ポップオーバーの変換', async (t) => {
  const h = startHost(t);
  const v = (await open(h)).data.view;
  const sec = v.annotations.find((a) => a.kind === 'section');
  const r = await h.req('convert', { url: URL1, id: sec.id, to: 'popover' });
  assert.equal(r.data.view.annotations.find((a) => a.id === sec.id).kind, 'popover');
});

test('data/ が git の無視対象でなければ、hello が理由を返し、ほかの要求は断る', async (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ubq-host-git-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const h = startHost(t, path.join(repo, 'data'));
  const hello = (await h.req('hello')).data;
  assert.equal(hello.ok, false);
  assert.match(hello.reason, /無視対象/);
  await assert.rejects(open(h), /無視対象/);
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test test/host.test.js`
Expected: FAIL (host.js が無いので子プロセスが即終了し、要求が返らずにタイムアウト。`node --test --test-timeout=10000 test/host.test.js` で回すと早く落ちる)

- [ ] **Step 3: `host/host.js` を書く**

```js
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
      const concept = a.concept || { key: a.anchor.exact, category: 'work' };
      const c = profile.add({ key: concept.key, label: concept.label || a.anchor.exact, category: concept.category, aliases: [a.anchor.exact], fromUrl: page.url });
      return { conceptId: c.id, label: c.label, view: viewOf(key) };
    },
    'unmark-known': (m) => ({ removed: !!profile.remove(m.conceptId) }),
    'profile-list': () => profile.list(),
    'profile-remove': (m) => ({ removed: !!profile.remove(m.id) }),
    'undo-turn': (m) => mutate(m.url, (p) => ops.undoTurn(p, m.turnId)),
    convert: (m) => mutate(m.url, (p) => ops.convert(p, m.id, m.to)),
    approve: (m) => mutate(m.url, (p) => ops.approve(p, m.pid)),
    reject: (m) => mutate(m.url, (p) => ops.reject(p, m.pid)),
    'discard-orphan': (m) => mutate(m.url, (p) => ops.discardOrphan(p, m.id)),
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
```

- [ ] **Step 4: 通るのを確かめる**

Run: `npm test`
Expected: すべて PASS (host の 8 件を含む)

- [ ] **Step 5: Commit**

```bash
git add host/host.js test/host.test.js
git commit -m "feat: native messaging host 本体"
```

---

### Task 10: 拡張 ID の固定と host のインストール

**Files:**
- Create: `extension/manifest.json`, `host/extension-id.js`, `host/install.sh`, `test/install.test.js`

**Interfaces:**
- Produces:
  - `extensionId(keyBase64) => string` (32 文字、`a`〜`p`) (`host/extension-id.js`)
  - `host/install.sh`: 環境変数 `UBIQDOC_NMH_DIR` (登録ファイルの置き場、既定は Chrome の `NativeMessagingHosts/`)、`UBIQDOC_RUN_SH` (ラッパの出力先、既定は `host/run.sh`)、`UBIQDOC_CLAUDE_BIN` (既定は `command -v claude`)、`UBIQDOC_DATA_DIR` (指定したときだけラッパに焼き込む)

- [ ] **Step 1: 拡張の鍵を作り、manifest を置く**

Run (秘密鍵は保存しない。ID は公開鍵だけで決まり、未パッケージで読み込むので秘密鍵は要らない):

```bash
openssl genrsa 2048 2>/dev/null | openssl rsa -pubout -outform DER 2>/dev/null | base64 | tr -d '\n'
```

`extension/manifest.json` (`<KEY>` に上の出力を貼る。以後この鍵は変えない):

```json
{
  "manifest_version": 3,
  "name": "ubiqdoc",
  "version": "0.1.0",
  "description": "読み手の知識に合わせて、ページに先回りで補足を付ける",
  "key": "<KEY>",
  "minimum_chrome_version": "116",
  "permissions": ["nativeMessaging", "storage", "sidePanel", "scripting", "activeTab", "tabs"],
  "optional_host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js" },
  "action": { "default_title": "ubiqdoc: このページに補足を付ける" },
  "side_panel": { "default_path": "sidepanel/sidepanel.html" },
  "options_page": "options/options.html"
}
```

- [ ] **Step 2: 失敗するテストを書く**

`test/install.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { extensionId } = require('../host/extension-id.js');
const { encode, Decoder } = require('../host/framing.js');

const ROOT = path.join(__dirname, '..');

test('extensionId: 32 文字の a〜p で、同じ鍵なら同じ', () => {
  const key = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8')).key;
  const id = extensionId(key);
  assert.match(id, /^[a-p]{32}$/);
  assert.equal(id, extensionId(key));
});

test('install.sh: 登録ファイルとラッパを作り、ラッパ経由で host が答える', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ubq-install-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const env = {
    ...process.env,
    UBIQDOC_NMH_DIR: path.join(tmp, 'nmh'),
    UBIQDOC_RUN_SH: path.join(tmp, 'run.sh'),
    UBIQDOC_CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'),
    UBIQDOC_DATA_DIR: path.join(tmp, 'data'),
  };
  execFileSync('bash', [path.join(ROOT, 'host', 'install.sh')], { env, stdio: 'pipe' });

  const reg = JSON.parse(fs.readFileSync(path.join(tmp, 'nmh', 'com.atsushiootani.ubiqdoc.json'), 'utf8'));
  const key = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8')).key;
  assert.equal(reg.name, 'com.atsushiootani.ubiqdoc');
  assert.equal(reg.path, path.join(tmp, 'run.sh'));
  assert.deepEqual(reg.allowed_origins, [`chrome-extension://${extensionId(key)}/`]);

  // Chrome と同じく、ログインシェルの PATH を持たない環境から起動する
  const child = spawn(reg.path, [], { env: { HOME: os.homedir(), PATH: '/usr/bin:/bin' } });
  t.after(() => child.kill());
  const got = await new Promise((resolve) => {
    const dec = new Decoder(resolve);
    child.stdout.on('data', (c) => dec.push(c));
    child.stdin.write(encode({ id: 'x', type: 'hello' }));
  });
  assert.deepEqual(got, { id: 'x', type: 'result', data: { ok: true } });
});
```

- [ ] **Step 3: 失敗を確かめる**

Run: `node --test test/install.test.js`
Expected: FAIL (`Cannot find module '../host/extension-id.js'`)

- [ ] **Step 4: 実装する**

`host/extension-id.js`:

```js
// manifest の key (公開鍵の DER を base64 にしたもの) から拡張 ID を出す。
// ID は公開鍵の sha256 の先頭 16 バイトを hex にし、0-f を a-p に置き換えたもの
const crypto = require('crypto');
const fs = require('fs');

function extensionId(keyBase64) {
  const hex = crypto.createHash('sha256').update(Buffer.from(keyBase64, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

if (require.main === module) {
  const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  process.stdout.write(extensionId(manifest.key));
}

module.exports = { extensionId };
```

`host/install.sh` (実行権限を付ける: `chmod +x host/install.sh`):

```bash
#!/bin/bash
# ubiqdoc の native host を Chrome に登録する。一度だけ実行すればよい (node や claude の場所が変わったら再実行)。
#
# Chrome が起動する native host はログインシェルの PATH を持たないので、node と claude が見つからずに落ちる。
# 実行した時点の node と claude の絶対パスを焼き込んだラッパ (run.sh) を作り、それを登録する
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(node -p 'process.execPath')"   # nodenv などの shim ではなく実体を指す
CLAUDE="${UBIQDOC_CLAUDE_BIN:-$(command -v claude || true)}"
if [ -z "$CLAUDE" ]; then
  echo "claude が見つかりません。Claude Code をインストールしてログインしてから実行してください" >&2
  exit 1
fi
RUN_SH="${UBIQDOC_RUN_SH:-$ROOT/host/run.sh}"
NMH_DIR="${UBIQDOC_NMH_DIR:-$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts}"
EXT_ID="$("$NODE" "$ROOT/host/extension-id.js" "$ROOT/extension/manifest.json")"

{
  echo '#!/bin/bash'
  echo "# host/install.sh が生成した。手で直さず、install.sh を実行し直す"
  echo "export PATH=\"$(dirname "$NODE"):$(dirname "$CLAUDE"):/usr/bin:/bin\""
  echo "export UBIQDOC_CLAUDE_BIN=\"$CLAUDE\""
  if [ -n "${UBIQDOC_DATA_DIR:-}" ]; then echo "export UBIQDOC_DATA_DIR=\"$UBIQDOC_DATA_DIR\""; fi
  echo "exec \"$NODE\" \"$ROOT/host/host.js\" \"\$@\""
} > "$RUN_SH"
chmod +x "$RUN_SH"

mkdir -p "$NMH_DIR"
cat > "$NMH_DIR/com.atsushiootani.ubiqdoc.json" <<EOF
{
  "name": "com.atsushiootani.ubiqdoc",
  "description": "ubiqdoc native host",
  "path": "$RUN_SH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF

echo "登録しました: $NMH_DIR/com.atsushiootani.ubiqdoc.json"
echo "拡張 ID: $EXT_ID"
```

- [ ] **Step 5: 通るのを確かめる**

Run: `node --test test/install.test.js`
Expected: 2 件 PASS

- [ ] **Step 6: Commit**

```bash
git add extension/manifest.json host/extension-id.js host/install.sh test/install.test.js
git commit -m "feat: 拡張 ID を固定し、native host をインストールする"
```

---

### Task 11: background とオプション画面

**Files:**
- Create: `extension/lib/allowlist.js`, `test/allowlist.test.js`, `extension/background.js`, `extension/options/options.html`, `extension/options/options.js`

**Interfaces:**
- Produces:
  - `allowlist.js` (Node では `require`、拡張では `self.ubqAllowlist`): `DEFAULT_ALLOWLIST: {pattern, root}[]`、`FALLBACK_ROOT = 'main'`、`matchUrl(pattern, url) => boolean`、`entryFor(list, url) => entry | null`
  - background が content script / サイドパネルから受ける port (`chrome.runtime.connect({ name: 'ubq' })`) のメッセージ: host の要求 (Task 9 の表) に加えて、`config` (`{ url }` → `{ root, auto }`) と `tab-status` (`{ tabId }` → progress)。返信は host と同じ形 (`id` は送り手の id)
  - background → タブ (`chrome.tabs.sendMessage`): `{ type: 'run', force }`、`{ type: 'page-updated', view }`、`{ type: 'profile-changed' }`、`{ type: 'jump', id }` (サイドパネルから)
  - background → サイドパネル (`chrome.runtime.sendMessage`): `{ type: 'page-updated', view }`、`{ type: 'profile-changed' }`、`{ type: 'status', tabId, status }`
  - `CONTENT_FILES` (content script の読み込み順): `lib/anchor.js`, `lib/allowlist.js`, `content/text.js`, `content/overlay.js`, `content/render.js`, `content/ask.js`, `content/main.js`

- [ ] **Step 1: 許可リストの失敗するテストを書く**

`test/allowlist.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { matchUrl, entryFor, DEFAULT_ALLOWLIST } = require('../extension/lib/allowlist.js');

test('Chrome の match pattern と同じく照合する', () => {
  assert.equal(matchUrl('https://www.notion.so/*', 'https://www.notion.so/Spec-0123?pvs=4'), true);
  assert.equal(matchUrl('https://www.notion.so/*', 'https://notion.so/x'), false);
  assert.equal(matchUrl('https://*.notion.site/*', 'https://acme.notion.site/x'), true);
  assert.equal(matchUrl('https://*.notion.site/*', 'https://notion.site/x'), true);
  assert.equal(matchUrl('https://*.notion.site/*', 'https://evil-notion.site/x'), false);
  assert.equal(matchUrl('*://github.com/*', 'http://github.com/o/r'), true);
  assert.equal(matchUrl('http://127.0.0.1/*', 'http://127.0.0.1:8123/a.html'), true);
  assert.equal(matchUrl('file:///*', 'file:///Users/me/a.html'), true);
  assert.equal(matchUrl('not a pattern', 'https://x'), false);
});

test('entryFor: 最初に当たった行を返す', () => {
  assert.equal(entryFor(DEFAULT_ALLOWLIST, 'https://github.com/o/r/issues/1').root, '.markdown-body');
  assert.equal(entryFor(DEFAULT_ALLOWLIST, 'https://example.com/'), null);
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test test/allowlist.test.js`
Expected: FAIL (`Cannot find module`)

- [ ] **Step 3: `extension/lib/allowlist.js` を書く**

```js
// 許可リスト (先回りの補足を自動で走らせるサイト) の照合。Chrome の match pattern と同じ規則
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ubqAllowlist = api;
}(typeof self !== 'undefined' ? self : this, () => {
  const DEFAULT_ALLOWLIST = [
    { pattern: 'https://www.notion.so/*', root: '.notion-page-content' },
    { pattern: 'https://*.notion.site/*', root: '.notion-page-content' },
    { pattern: 'https://github.com/*', root: '.markdown-body' },
  ];
  const FALLBACK_ROOT = 'main';

  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

  function patternToRegExp(pattern) {
    const m = /^(\*|https?|file):\/\/([^/]*)(\/.*)$/.exec(pattern || '');
    if (!m) return null;
    const [, scheme, host, p] = m;
    const sch = scheme === '*' ? 'https?' : scheme;
    let h;
    if (host === '*') h = '[^/]*';
    else if (host.startsWith('*.')) h = `(?:[^/]*\\.)?${esc(host.slice(2))}`;
    else h = esc(host);
    // ポートを書かないパターンは、どのポートにも当たる
    return new RegExp(`^${sch}://${h}${host ? '(?::\\d+)?' : ''}${esc(p).replace(/\*/g, '.*')}$`);
  }

  function matchUrl(pattern, url) {
    const re = patternToRegExp(pattern);
    return !!re && re.test(url);
  }

  function entryFor(list, url) { return (list || []).find((e) => matchUrl(e.pattern, url)) || null; }

  return { DEFAULT_ALLOWLIST, FALLBACK_ROOT, patternToRegExp, matchUrl, entryFor };
}));
```

- [ ] **Step 4: 通るのを確かめる**

Run: `node --test test/allowlist.test.js`
Expected: 2 件 PASS

- [ ] **Step 5: `extension/background.js` を書く**

```js
// host との接続を 1 本だけ張り、content script とサイドパネルからの要求を中継する。
// 全タブの要求がこの 1 本を通るので host のプロセスは 1 つになり、プロフィールへの書き込みは順に並ぶ
importScripts('lib/allowlist.js');
const { DEFAULT_ALLOWLIST, FALLBACK_ROOT, entryFor } = self.ubqAllowlist;

const HOST = 'com.atsushiootani.ubiqdoc';
const CONTENT_FILES = ['lib/anchor.js', 'lib/allowlist.js', 'content/text.js', 'content/overlay.js', 'content/render.js', 'content/ask.js', 'content/main.js'];
const IDLE_MS = 60 * 1000;
const MUTATIONS = new Set(['mark-known', 'unmark-known', 'profile-remove', 'undo-turn', 'convert', 'approve', 'reject', 'discard-orphan']);
const PROFILE_MUTATIONS = new Set(['mark-known', 'unmark-known', 'profile-remove']);

let nativePort = null;
let seq = 0;
let idleTimer = null;
const waiting = new Map();      // host への要求 id → { clientId, tabId, reply, req }
const tabStatus = new Map();    // tabId → 最後の progress

function hostErrorText(err) {
  return /not found|Specified native messaging host|forbidden/i.test(err)
    ? 'host が未登録です。ubiqdoc のリポジトリで host/install.sh を実行してください'
    : err;
}

function connectHost() {
  if (nativePort) return nativePort;
  nativePort = chrome.runtime.connectNative(HOST);
  nativePort.onMessage.addListener(onHostMessage);
  nativePort.onDisconnect.addListener(() => {
    const err = hostErrorText(chrome.runtime.lastError?.message || 'host が終了しました');
    for (const w of waiting.values()) w.reply({ id: w.clientId, type: 'error', message: err });
    waiting.clear();
    nativePort = null;
  });
  return nativePort;
}

// 処理が無いまま IDLE_MS たったら接続を閉じる (host も終わる)。接続中は service worker が止まらない
function scheduleIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!waiting.size && nativePort) { nativePort.disconnect(); nativePort = null; }
  }, IDLE_MS);
}

function updateBadge(tabId, s) {
  const text = s.stage === 'extract' ? '…' : s.stage === 'write' ? `${s.made}/${s.total}` : '';
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#1a73e8' }).catch(() => {});
}

async function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
  for (const t of await chrome.tabs.query({})) chrome.tabs.sendMessage(t.id, msg).catch(() => {});
}

function onHostMessage(msg) {
  const w = waiting.get(msg.id);
  if (!w) return;
  if (msg.type === 'event' && msg.event === 'progress' && w.tabId != null) {
    tabStatus.set(w.tabId, msg.data);
    updateBadge(w.tabId, msg.data);
    chrome.runtime.sendMessage({ type: 'status', tabId: w.tabId, status: msg.data }).catch(() => {});
  }
  w.reply({ ...msg, id: w.clientId });
  if (msg.type !== 'result' && msg.type !== 'error') return;
  waiting.delete(msg.id);
  scheduleIdle();
  if (msg.type !== 'result') return;
  if (PROFILE_MUTATIONS.has(w.req.type)) broadcast({ type: 'profile-changed' });
  else if (MUTATIONS.has(w.req.type) && msg.data?.view) broadcast({ type: 'page-updated', view: msg.data.view });
}

function sendHost(req, { tabId, reply }) {
  clearTimeout(idleTimer);
  const id = `r${++seq}`;
  waiting.set(id, { clientId: req.id, tabId, reply, req });
  try {
    connectHost().postMessage({ ...req, id });
  } catch (e) {
    waiting.delete(id);
    reply({ id: req.id, type: 'error', message: hostErrorText(e.message) });
  }
}

async function settings() {
  const s = await chrome.storage.local.get(['allowlist', 'model']);
  return { allowlist: s.allowlist || DEFAULT_ALLOWLIST, model: s.model || 'haiku' };
}

async function configFor(url) {
  const { allowlist } = await settings();
  const entry = entryFor(allowlist, url);
  const granted = entry ? await chrome.permissions.contains({ origins: [entry.pattern] }) : false;
  return { root: entry?.root || FALLBACK_ROOT, auto: !!entry && granted };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ubq') return;
  const senderTab = port.sender?.tab?.id ?? null;
  const reply = (m) => { try { port.postMessage(m); } catch { /* 送り手が閉じた */ } };
  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'config') return reply({ id: msg.id, type: 'result', data: await configFor(msg.url) });
    if (msg.type === 'tab-status') return reply({ id: msg.id, type: 'result', data: tabStatus.get(msg.tabId) || null });
    const req = msg.type === 'open-page' ? { ...msg, model: (await settings()).model } : msg;
    sendHost(req, { tabId: msg.tabId ?? senderTab, reply });
  });
});

// 許可リストのうち、アクセス権のあるサイトにだけ content script を登録する
async function syncContentScripts() {
  const { allowlist } = await settings();
  const granted = [];
  for (const e of allowlist) {
    try { if (await chrome.permissions.contains({ origins: [e.pattern] })) granted.push(e.pattern); } catch { /* 不正なパターンは飛ばす */ }
  }
  await chrome.scripting.unregisterContentScripts({ ids: ['ubq'] }).catch(() => {});
  if (granted.length) {
    await chrome.scripting.registerContentScripts([{ id: 'ubq', matches: granted, js: CONTENT_FILES, runAt: 'document_idle', persistAcrossSessions: true }]);
  }
}

chrome.runtime.onInstalled.addListener(async (d) => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  await syncContentScripts();
  if (d.reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(syncContentScripts);
chrome.permissions.onAdded.addListener(syncContentScripts);
chrome.permissions.onRemoved.addListener(syncContentScripts);
chrome.storage.onChanged.addListener((c) => { if (c.allowlist) syncContentScripts(); });
chrome.tabs.onRemoved.addListener((tabId) => tabStatus.delete(tabId));

// 許可リストに無いページでは、ツールバーのボタンで実行する (activeTab の権限で差し込む)
chrome.action.onClicked.addListener(async (tab) => {
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
    await chrome.tabs.sendMessage(tab.id, { type: 'run', force: true });
  } catch (e) {
    chrome.runtime.sendMessage({ type: 'status', tabId: tab.id, status: { stage: 'error', message: `このページでは動かせません: ${e.message}` } }).catch(() => {});
  }
});
```

- [ ] **Step 6: オプション画面を書く**

`extension/options/options.html`:

```html
<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>ubiqdoc の設定</title>
<style>
  body { font: 14px/1.6 -apple-system, "Hiragino Sans", sans-serif; max-width: 760px; margin: 24px auto; padding: 0 16px; color: #1b1e21; }
  table { width: 100%; border-collapse: collapse; } td, th { border-bottom: 1px solid #dde1e5; padding: 6px 4px; text-align: left; }
  input[type=text] { width: 100%; box-sizing: border-box; font: inherit; }
  .muted { color: #5b636a; font-size: 12px; } .ng { color: #c5221f; } .ok { color: #1e8e3e; }
  @media (prefers-color-scheme: dark) { body { background: #161a1d; color: #e4e8ea; } td, th { border-color: #333; } }
</style></head>
<body>
  <h1>ubiqdoc の設定</h1>
  <h2>許可リスト</h2>
  <p class="muted">ここに入れたサイトでは、ページを開くと自動で先回りの補足を作ります。ほかのページでは、ツールバーの ubiqdoc ボタンを押したときだけ動きます。「本文の根」は、補足を付ける範囲の CSS セレクタです (サイドバーなどを除くため)。</p>
  <table>
    <thead><tr><th>パターン</th><th>本文の根</th><th>アクセス権</th><th></th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <form id="add">
    <p><input type="text" id="pattern" placeholder="https://example.com/*" required>
       <input type="text" id="root" placeholder="main (省略可)">
       <button>追加</button></p>
  </form>
  <h2>モデル</h2>
  <select id="model"><option>haiku</option><option>sonnet</option><option>opus</option></select>
  <h2>native host</h2>
  <p id="host" class="muted">確かめています…</p>
  <script src="../lib/allowlist.js"></script>
  <script src="options.js"></script>
</body></html>
```

`extension/options/options.js`:

```js
const { DEFAULT_ALLOWLIST, FALLBACK_ROOT } = self.ubqAllowlist;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function load() { return (await chrome.storage.local.get('allowlist')).allowlist || DEFAULT_ALLOWLIST; }
async function save(list) { await chrome.storage.local.set({ allowlist: list }); render(); }

async function render() {
  const list = await load();
  const rows = $('#rows');
  rows.innerHTML = '';
  for (const [i, e] of list.entries()) {
    const granted = await chrome.permissions.contains({ origins: [e.pattern] }).catch(() => false);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${esc(e.pattern)}</td><td>${esc(e.root)}</td>
      <td>${granted ? '<span class="ok">許可済み</span>' : '<button data-act="grant">許可する</button>'}</td>
      <td><button data-act="del">削除</button></td>`;
    tr.querySelector('[data-act=grant]')?.addEventListener('click', async () => {
      await chrome.permissions.request({ origins: [e.pattern] });
      render();
    });
    tr.querySelector('[data-act=del]').addEventListener('click', () => save(list.filter((_, j) => j !== i)));
    rows.appendChild(tr);
  }
}

$('#add').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const pattern = $('#pattern').value.trim();
  const root = $('#root').value.trim() || FALLBACK_ROOT;
  // アクセス権の要求はボタンを押した操作の中でしか出せないので、保存より先に求める
  const ok = await chrome.permissions.request({ origins: [pattern] }).catch((e) => { alert(`パターンが不正です: ${e.message}`); return null; });
  if (ok === null) return;
  await save([...(await load()), { pattern, root }]);
  $('#pattern').value = '';
  $('#root').value = '';
});

$('#model').addEventListener('change', (e) => chrome.storage.local.set({ model: e.target.value }));

(async () => {
  $('#model').value = (await chrome.storage.local.get('model')).model || 'haiku';
  render();
  const port = chrome.runtime.connect({ name: 'ubq' });
  port.onMessage.addListener((m) => {
    if (m.type === 'result') $('#host').innerHTML = m.data.ok ? '<span class="ok">つながっています</span>' : `<span class="ng">${esc(m.data.reason)}</span>`;
    else if (m.type === 'error') $('#host').innerHTML = `<span class="ng">${esc(m.message)}</span>`;
  });
  port.postMessage({ id: 'hello', type: 'hello' });
})();
```

- [ ] **Step 7: 拡張を読み込んで、host とつながるのを確かめる**

1. `bash host/install.sh` を実行する
2. Chrome の `chrome://extensions` でデベロッパーモードを ON にし、「パッケージ化されていない拡張機能を読み込む」で `extension/` を選ぶ
3. 表示された ID が `install.sh` の出した「拡張 ID」と同じことを確かめる
4. オプション画面の「native host」が「つながっています」になることを確かめる
5. 許可リストの Notion の行で「許可する」を押し、許可済みになることを確かめる

(content script はまだ無いので、ページでは何も起きない。`chrome://extensions` の service worker のコンソールにエラーが出ていないことだけ見る)

- [ ] **Step 8: Commit**

```bash
git add extension/lib/allowlist.js test/allowlist.test.js extension/background.js extension/options/
git commit -m "feat: 拡張の background とオプション画面"
```

---

### Task 12: ページに補足を描く (content script)

**Files:**
- Create: `extension/content/text.js`, `extension/content/overlay.js`, `extension/content/render.js`, `extension/content/main.js`
- Create: `extension/content/ask.js` (この Task では空の `NS.ask = { install() {} }` だけ。中身は Task 13)

**Interfaces:**
- Consumes: `ubqAnchor` (Task 3)、background の port と `config` (Task 11)、host の `open-page` / `page-view` / `mark-known` / `unmark-known` (Task 9)
- Produces (content script の中の共有名前空間 `window.__ubq`):
  - `NS.text = { roots(selector), textNodes(rootEls), pageText(rootEls), pageLinks(rootEls), waitSettled(ms?, max?), LAYER_TAG }`
  - `NS.overlay = { host, root, layer, el(tag, cls?), toast(msg, action?) }`。`action = { label, onClick, timeout }`
  - `NS.Renderer`: `new Renderer({ rootSel, onKnown })`、`.setView(view)`、`.addAnnotation(stored)`、`.textModel() => { roots, nodes, built }`、`.summary() => string`、`.jump(id)`、`.rootSel` (書き換え可)
  - `NS.blockOf(node) => Element`
  - `NS.request(type, payload, onEvent?) => Promise<data>`

- [ ] **Step 1: `extension/content/text.js` を書く**

```js
// 本文の根・テキストノード・本文・リンクを取る。ページの DOM は読むだけで書き換えない
(() => {
  const NS = (window.__ubq = window.__ubq || {});
  if (NS.text) return;
  const LAYER_TAG = 'ubiqdoc-layer';

  function roots(selector) {
    let els = [];
    try { els = [...document.querySelectorAll(selector)]; } catch { /* 不正なセレクタ */ }
    if (!els.length) els = [document.querySelector('main') || document.body];
    // 入れ子になっているものは外側だけ残す
    return els.filter((el) => !els.some((o) => o !== el && o.contains(el)));
  }

  function textNodes(rootEls) {
    const out = [];
    for (const r of rootEls) {
      const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          const p = n.parentElement;
          if (!p || p.closest(`script, style, noscript, ${LAYER_TAG}`)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let n;
      while ((n = w.nextNode())) out.push(n);
    }
    return out;
  }

  const pageText = (rootEls) => rootEls.map((r) => r.innerText).join('\n\n');

  function pageLinks(rootEls) {
    const seen = new Set();
    const out = [];
    for (const r of rootEls) {
      for (const a of r.querySelectorAll('a[href]')) {
        if (!/^https?:/.test(a.href) || seen.has(a.href)) continue;
        seen.add(a.href);
        out.push({ text: a.textContent.trim().slice(0, 80), href: a.href });
      }
    }
    return out;
  }

  // Notion は描画が遅れて続く。DOM の変化が ms 止まるまで待つ (止まらなくても max で打ち切る)
  function waitSettled(ms = 1500, max = 15000) {
    return new Promise((resolve) => {
      let t;
      const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(done, ms); });
      const cap = setTimeout(done, max);
      function done() { obs.disconnect(); clearTimeout(t); clearTimeout(cap); resolve(); }
      obs.observe(document.body, { subtree: true, childList: true, characterData: true });
      t = setTimeout(done, ms);
    });
  }

  NS.text = { roots, textNodes, pageText, pageLinks, waitSettled, LAYER_TAG };
})();
```

- [ ] **Step 2: `extension/content/overlay.js` を書く**

```js
// 最前面の層。<html> の直下に <ubiqdoc-layer> を 1 つ置き、その Shadow DOM の中にだけ描く。
// 本文の DOM には触らない (Notion は閲覧中も contenteditable なので、包むと本文として保存されるおそれがある)
(() => {
  const NS = window.__ubq;
  if (NS.overlay) return;

  const CSS = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; font: 13px/1.6 -apple-system, "Hiragino Sans", sans-serif; color: #1b1e21; }
.layer > * { pointer-events: auto; }
button { font: inherit; font-size: 12px; padding: 1px 8px; border-radius: 6px; border: 1px solid rgba(127,127,127,.5); background: transparent; color: inherit; cursor: pointer; }
a { color: #1a73e8; }
.pop { position: fixed; max-width: 360px; max-height: 320px; overflow: auto; padding: 8px 10px; border-radius: 8px; background: #1f2328; color: #f1f3f4; box-shadow: 0 6px 18px rgba(0,0,0,.25); white-space: pre-line; }
.pop a { color: #8ab4f8; }
.item + .item { margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(127,127,127,.35); }
.src { font-size: 12px; opacity: .85; margin-top: 4px; white-space: normal; }
.acts { margin-top: 6px; display: flex; gap: 6px; }
.card { position: fixed; max-height: 50vh; overflow: auto; padding: 10px 14px; border-left: 3px solid #e8a71a; border-radius: 0 8px 8px 0; background: #fffaf0; box-shadow: 0 6px 18px rgba(0,0,0,.18); }
.card .label { font-size: 11px; letter-spacing: .04em; opacity: .65; }
.card h4 { margin: 0 0 6px; font-size: 14px; }
.card .close { position: absolute; top: 4px; right: 6px; border: 0; font-size: 14px; }
.toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); padding: 8px 14px; border-radius: 8px; background: #1f2328; color: #fff; display: flex; gap: 12px; align-items: center; }
.toast button { color: #8ab4f8; border-color: #8ab4f8; }
.askbtn { position: fixed; padding: 3px 10px; border-radius: 6px; background: #1a73e8; color: #fff; border: 0; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
.win { position: fixed; width: 380px; max-height: 420px; display: flex; flex-direction: column; background: #15181b; color: #d8dee3; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.35); font: 12.5px/1.55 ui-monospace, "SF Mono", Menlo, monospace; overflow: hidden; }
.win-head { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: rgba(255,255,255,.06); cursor: move; }
.win-head .term { color: #7cc4ff; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.win-head .ms { color: #7d878f; }
.win-head button { border: 0; color: #7d878f; font-size: 14px; padding: 0 2px; }
.win-log { flex: 1; overflow: auto; padding: 8px 10px; white-space: pre-wrap; word-break: break-word; }
.win-log .me { color: #7cc4ff; } .win-log .me::before { content: "› "; }
.win-log .sys { color: #7d878f; } .win-log .err { color: #ff8a80; }
.win-log > div + div { margin-top: 6px; }
.win-chips { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 10px 6px; }
.win-chips button { background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); color: #d8dee3; border-radius: 4px; padding: 1px 6px; font-size: 11.5px; }
.win-input { display: flex; gap: 6px; border-top: 1px solid rgba(255,255,255,.08); padding: 6px 10px; }
.win-input::before { content: "›"; color: #7cc4ff; }
.win-input textarea { flex: 1; resize: none; border: 0; outline: 0; background: transparent; color: #d8dee3; font: inherit; min-height: 1.55em; max-height: 6em; }
.win.busy .win-input textarea { opacity: .5; }
@media (prefers-color-scheme: dark) {
  .layer { color: #e4e8ea; }
  .pop { background: #e8eaed; color: #1b1e21; } .pop a { color: #1a73e8; }
  .card { background: #2a2620; }
}`;

  // 語句の印 (::highlight) の見た目。<head> に置くので本文の DOM は変わらない
  const HIGHLIGHT_CSS = `
::highlight(ubiqdoc-pop) { background-color: rgba(26,115,232,.12); text-decoration: underline dotted 1.5px #1a73e8; }
::highlight(ubiqdoc-sec) { background-color: rgba(232,167,26,.14); text-decoration: underline solid 1.5px #e8a71a; }
::highlight(ubiqdoc-link) { background-color: rgba(24,128,56,.10); text-decoration: underline dotted 1.5px #188038; }`;

  const host = document.createElement(NS.text.LAYER_TAG);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style><div class="layer"></div>`;
  document.documentElement.appendChild(host);
  const layer = root.querySelector('.layer');

  if (!document.getElementById('ubiqdoc-highlight')) {
    const st = document.createElement('style');
    st.id = 'ubiqdoc-highlight';
    st.textContent = HIGHLIGHT_CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  let toastTimer = 0;
  function toast(msg, action) {
    root.querySelector('.toast')?.remove();
    const t = el('div', 'toast');
    const span = el('span');
    span.textContent = msg;
    t.appendChild(span);
    if (action) {
      const b = el('button');
      b.textContent = action.label;
      b.onclick = () => { t.remove(); action.onClick(); };
      t.appendChild(b);
    }
    layer.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), action?.timeout || 4000);
  }

  NS.overlay = { host, root, layer, el, toast };
})();
```

- [ ] **Step 3: `extension/content/render.js` を書く**

```js
// 補足を描く。語句の印は CSS Custom Highlight API で付け (DOM は変えない)、ポップオーバーとカードは層に出す
(() => {
  const NS = window.__ubq;
  if (NS.Renderer) return;
  const { el } = NS.overlay;
  const ALLOWED = new Set(['H5', 'P', 'UL', 'OL', 'LI', 'CODE', 'PRE', 'STRONG', 'EM', 'B', 'I', 'A', 'BR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'BLOCKQUOTE', 'SPAN']);
  const BLOCK_SEL = '[data-block-id], p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, dd, dt';
  const NAMES = { popover: 'ubiqdoc-pop', section: 'ubiqdoc-sec', link: 'ubiqdoc-link' };

  // AI の書いた HTML を、許可したタグと http(s) のリンクだけにして写す
  function sanitizeInto(html, parent) {
    const src = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
    const copy = (from, to) => {
      for (const n of from.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) { to.appendChild(document.createTextNode(n.data)); continue; }
        if (n.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = /^H[1-6]$/.test(n.tagName) ? 'H5' : n.tagName;
        if (!ALLOWED.has(tag)) { copy(n, to); continue; }
        const e = document.createElement(tag.toLowerCase());
        if (tag === 'A') {
          const href = n.getAttribute('href') || '';
          if (/^https?:/.test(href)) { e.href = href; e.target = '_blank'; e.rel = 'noopener'; }
        }
        copy(n, e);
        to.appendChild(e);
      }
    };
    copy(src, parent);
  }

  function blockOf(node) {
    const e = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return e?.closest(BLOCK_SEL) || e;
  }

  function makeRange(nodes, built, span) {
    const [si, so] = ubqAnchor.locate(built.starts, span.start, false);
    const [ei, eo] = ubqAnchor.locate(built.starts, span.end, true);
    const r = document.createRange();
    r.setStart(nodes[si], so);
    r.setEnd(nodes[ei], eo);
    return r;
  }

  function inside(rects, x, y) {
    for (const r of rects) if (x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1) return true;
    return false;
  }

  function shortUrl(u) {
    try { const x = new URL(u); return x.hostname + (x.pathname.length > 1 ? x.pathname.slice(0, 30) : ''); } catch { return u; }
  }

  class Renderer {
    constructor({ rootSel, onKnown }) {
      this.rootSel = rootSel;
      this.onKnown = onKnown;
      this.view = null;
      this.groups = [];
      this.pop = null;
      this.popGroup = null;
      this.hideTimer = 0;
      this.cards = new Map();
      this.frame = 0;
      this.layoutTimer = 0;
      this.observer = new MutationObserver(() => this.scheduleLayout());
      document.addEventListener('mousemove', (e) => this.onMove(e), { passive: true });
      document.addEventListener('click', (e) => this.onClick(e), true);
      window.addEventListener('scroll', () => this.schedulePlace(), { passive: true, capture: true });
      window.addEventListener('resize', () => this.schedulePlace());
    }

    setView(view) { this.view = view; this.layout(); }

    addAnnotation(a) {
      if (!this.view) this.view = { annotations: [] };
      if (!this.view.annotations.some((x) => x.id === a.id)) this.view.annotations.push({ ...a, hidden: false });
      this.scheduleLayout();
    }

    scheduleLayout() { clearTimeout(this.layoutTimer); this.layoutTimer = setTimeout(() => this.layout(), 300); }

    schedulePlace() {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => { this.frame = 0; this.place(); });
    }

    textModel() {
      const roots = NS.text.roots(this.rootSel);
      const nodes = NS.text.textNodes(roots);
      return { roots, nodes, built: ubqAnchor.buildText(nodes.map((n) => n.data)) };
    }

    // 補足の位置を探し直して印を付け直す。Notion の描き直しでテキストノードが入れ替わっても、これで追いつく
    layout() {
      const { roots, nodes, built } = this.textModel();
      this.observer.disconnect();
      for (const r of roots) this.observer.observe(r, { subtree: true, childList: true, characterData: true });
      const groups = new Map();
      for (const a of (this.view?.annotations || []).filter((x) => !x.hidden)) {
        const span = ubqAnchor.findAnchor(built.full, a.anchor);
        if (!span) continue;
        const k = `${span.start}:${span.end}`;
        if (!groups.has(k)) groups.set(k, { key: k, span, range: makeRange(nodes, built, span), items: [] });
        groups.get(k).items.push(a);
      }
      this.groups = [...groups.values()];
      const sets = { popover: [], section: [], link: [] };
      for (const g of this.groups) {
        g.kind = g.items.some((i) => i.kind === 'section') ? 'section' : g.items.every((i) => i.kind === 'link') ? 'link' : 'popover';
        sets[g.kind].push(g.range);
      }
      for (const [kind, name] of Object.entries(NAMES)) CSS.highlights.set(name, new Highlight(...sets[kind]));
      for (const [k, card] of this.cards) if (!groups.has(k)) { card.remove(); this.cards.delete(k); }
      if (this.popGroup) {
        if (groups.has(this.popGroup.key)) this.popGroup = groups.get(this.popGroup.key);
        else this.hidePop();
      }
      this.place();
    }

    hitGroup(x, y) { return this.groups.find((g) => inside(g.range.getClientRects(), x, y)) || null; }

    onMove(e) {
      if (e.target === NS.overlay.host) { clearTimeout(this.hideTimer); return; }
      const g = this.hitGroup(e.clientX, e.clientY);
      if (g && g.kind !== 'section') {
        clearTimeout(this.hideTimer);
        if (this.popGroup?.key !== g.key) this.showPop(g);
      } else if (this.pop) {
        clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => this.hidePop(), 250);
      }
    }

    onClick(e) {
      if (e.target === NS.overlay.host) return;
      const g = this.hitGroup(e.clientX, e.clientY);
      if (!g) return;
      if (g.kind === 'link') {
        const href = g.items.find((i) => i.href)?.href || g.items[0].sourceUrls?.[0];
        if (href) window.open(href, '_blank', 'noopener');
      } else if (g.kind === 'section') {
        this.toggleCard(g);
      }
    }

    itemEl(a, inCard) {
      const box = el('div', 'item');
      if (inCard) {
        const lab = el('div', 'label');
        lab.textContent = `補足 · 「${a.anchor.exact}」`;
        box.appendChild(lab);
        if (a.title) { const h = el('h4'); h.textContent = a.title; box.appendChild(h); }
      }
      const body = el('div', 'body');
      if (a.kind === 'section') sanitizeInto(a.body || '', body);
      else body.textContent = a.kind === 'link' ? (a.href || '') : (a.body || '');
      box.appendChild(body);
      const urls = [...new Set([...(a.sourceUrls || []), ...(a.kind === 'link' && a.href ? [a.href] : [])])];
      if (urls.length) {
        const src = el('div', 'src');
        src.append('出典: ');
        urls.forEach((u, i) => {
          if (i) src.append(' ');
          const l = document.createElement('a');
          l.href = u; l.target = '_blank'; l.rel = 'noopener'; l.textContent = shortUrl(u);
          src.appendChild(l);
        });
        box.appendChild(src);
      }
      const acts = el('div', 'acts');
      const known = el('button');
      known.textContent = '知ってる';
      known.onclick = () => { this.hidePop(); this.onKnown(a); };
      acts.appendChild(known);
      box.appendChild(acts);
      return box;
    }

    showPop(g) {
      this.hidePop();
      const pop = el('div', 'pop');
      for (const a of g.items) pop.appendChild(this.itemEl(a, false));
      NS.overlay.layer.appendChild(pop);
      this.pop = pop;
      this.popGroup = g;
      this.place();
    }

    hidePop() { this.pop?.remove(); this.pop = null; this.popGroup = null; }

    toggleCard(g) {
      if (this.cards.has(g.key)) { this.cards.get(g.key).remove(); this.cards.delete(g.key); return; }
      const card = el('div', 'card');
      const close = el('button', 'close');
      close.textContent = '×';
      close.onclick = () => { card.remove(); this.cards.delete(g.key); };
      card.appendChild(close);
      for (const a of g.items) card.appendChild(this.itemEl(a, true));
      NS.overlay.layer.appendChild(card);
      this.cards.set(g.key, card);
      this.place();
    }

    place() {
      if (this.pop && this.popGroup) {
        const r = this.popGroup.range.getBoundingClientRect();
        const h = this.pop.offsetHeight;
        const top = r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - 6 - h) : r.bottom + 6;
        this.pop.style.left = `${Math.min(Math.max(8, r.left), innerWidth - 370)}px`;
        this.pop.style.top = `${top}px`;
      }
      for (const [k, card] of this.cards) {
        const g = this.groups.find((x) => x.key === k);
        if (!g) continue;
        const r = (blockOf(g.range.startContainer) || g.range).getBoundingClientRect();
        card.style.left = `${Math.max(8, r.left)}px`;
        card.style.top = `${r.bottom + 4}px`;
        card.style.width = `${Math.min(640, Math.max(280, r.width))}px`;
      }
    }

    jump(id) {
      const g = this.groups.find((x) => x.items.some((i) => i.id === id));
      g?.range.startContainer.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    summary() {
      return (this.view?.annotations || []).map((a) => `- ${a.id} ${a.kind}「${a.anchor.exact}」: ${String(a.body || a.href || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 80)}`).join('\n');
    }
  }

  NS.Renderer = Renderer;
  NS.blockOf = blockOf;
})();
```

- [ ] **Step 4: `extension/content/ask.js` を仮に置く**

```js
// 「AI に聞く」ボタンと小窓 (中身は Task 13)
(() => {
  const NS = window.__ubq;
  if (NS.ask) return;
  NS.ask = { install() {} };
})();
```

- [ ] **Step 5: `extension/content/main.js` を書く**

```js
// 起動。許可リストのページなら開いたら自動で、ほかのページではツールバーのボタン ('run') で動く
(() => {
  const NS = window.__ubq;
  if (NS.started) return;
  NS.started = true;

  let port = null;
  let seq = 0;
  const pend = new Map();

  function connect() {
    port = chrome.runtime.connect({ name: 'ubq' });
    port.onMessage.addListener((m) => {
      const p = pend.get(m.id);
      if (!p) return;
      if (m.type === 'event') { p.onEvent?.(m.event, m.data); return; }
      pend.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m.data);
    });
    port.onDisconnect.addListener(() => {
      port = null;
      for (const p of pend.values()) p.reject(new Error('拡張との接続が切れました。ページを再読み込みしてください'));
      pend.clear();
    });
  }

  function request(type, payload = {}, onEvent) {
    if (!port) connect();
    const id = `c${++seq}`;
    return new Promise((resolve, reject) => {
      pend.set(id, { resolve, reject, onEvent });
      port.postMessage({ ...payload, type, id });
    });
  }
  NS.request = request;

  let renderer = null;
  let config = null;
  let running = false;

  async function refresh() {
    if (!renderer) return;
    const r = await request('page-view', { url: location.href }).catch(() => null);
    if (r?.view) renderer.setView(r.view);
  }

  async function onKnown(a) {
    try {
      const r = await request('mark-known', { url: location.href, annotationId: a.id });
      renderer.setView(r.view);
      NS.overlay.toast(`「${r.label}」を知ってるにしました`, {
        label: '戻す',
        timeout: 8000,
        onClick: async () => { await request('unmark-known', { conceptId: r.conceptId }); refresh(); },
      });
    } catch (e) { NS.overlay.toast(`ubiqdoc: ${e.message}`); }
  }

  async function start(force) {
    if (running) return;
    running = true;
    try {
      config = config || await request('config', { url: location.href });
      if (!renderer) {
        renderer = new NS.Renderer({ rootSel: config.root, onKnown });
        NS.ask.install({ renderer });
      }
      renderer.rootSel = config.root;
      await NS.text.waitSettled();
      const rootEls = NS.text.roots(config.root);
      const r = await request('open-page', {
        url: location.href, title: document.title,
        text: NS.text.pageText(rootEls), links: NS.text.pageLinks(rootEls), force: !!force,
      }, (ev, data) => {
        if (ev === 'view') renderer.setView(data);
        else if (ev === 'annotation') renderer.addAnnotation(data);
      });
      renderer.setView(r.view);
    } catch (e) {
      NS.overlay.toast(`ubiqdoc: ${e.message}`);
    } finally {
      running = false;
    }
  }

  // 先に受け口を作っておく。ツールバーのボタンからは、差し込んだ直後に 'run' が届く
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'run') start(!!msg.force);
    else if (msg.type === 'page-updated' && renderer && msg.view?.url && msg.view.key === renderer.view?.key) renderer.setView(msg.view);
    else if (msg.type === 'profile-changed') refresh();
    else if (msg.type === 'jump') renderer?.jump(msg.id);
  });

  // SPA の遷移 (history.pushState) は新しいページとして扱う
  let lastUrl = location.href;
  setInterval(async () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    renderer?.setView({ annotations: [] });
    config = await request('config', { url: location.href }).catch(() => null);
    if (config?.auto) start(false);
  }, 500);

  (async () => {
    config = await request('config', { url: location.href }).catch(() => null);
    if (config?.auto) start(false);
  })();
})();
```

- [ ] **Step 6: 手で確かめる**

1. `chrome://extensions` で拡張を再読み込みする
2. オプション画面で `file:///*` (本文の根 `body`) を許可リストに足し、拡張の詳細で「ファイルの URL へのアクセスを許可する」を ON にする
3. `test/fixtures/doc.html` を Chrome で開く (本物の `claude` が動く)
4. 数十秒で「楽観ロック」に下線と薄い背景が付くこと、ホバーでポップオーバー (出典付き) が出ること、「知ってる」で印が消えてトーストが出ること、「戻す」で印が戻ることを確かめる
5. DevTools のコンソールで `document.querySelector('p').outerHTML` を見て、本文に拡張の要素が入っていないことを確かめる

- [ ] **Step 7: Commit**

```bash
git add extension/content/
git commit -m "feat: ページの DOM を書き換えずに補足を描く content script"
```

---

### Task 13: 「AI に聞く」ボタンと小窓

**Files:**
- Modify: `extension/content/ask.js` (Task 12 の仮置きを置き換える)

**Interfaces:**
- Consumes: `NS.request` / `NS.Renderer#textModel` / `#summary` / `#setView` / `NS.blockOf` / `NS.overlay` (Task 12)、host の `ask` (Task 9)
- Produces: `NS.ask = { install({ renderer }) }`

- [ ] **Step 1: `extension/content/ask.js` を書く**

```js
// 語句を選ぶと「AI に聞く」ボタンを出し、押すと小窓を開く。答えはストリームで届き、補足は host が足す。
// 選ぶたびに窓を開かないのは、Notion では文字を選ぶのがコピーや装飾のためでもあるから
(() => {
  const NS = window.__ubq;
  if (NS.ask && NS.ask.ready) return;
  const { el } = NS.overlay;
  const WIN_W = 380;
  const WIN_H = 300;
  const KIND = { popover: 'ポップオーバー', section: 'セクション', link: 'リンク' };
  const rid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const windows = new Map();
  let z = 20;
  let renderer = null;
  let btn = null;

  function install(opts) {
    renderer = opts.renderer;
    document.addEventListener('mouseup', onMouseUp, true);
  }

  function onMouseUp(e) {
    if (e.target === NS.overlay.host) return;
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) { hideBtn(); return; }
      const range = sel.getRangeAt(0);
      const text = range.toString().trim();
      if (!text || text.length > 200) { hideBtn(); return; }
      const roots = NS.text.roots(renderer.rootSel);
      if (!roots.some((r) => r.contains(range.commonAncestorContainer))) { hideBtn(); return; }
      showBtn(range.cloneRange());
    }, 0);
  }

  function showBtn(range) {
    hideBtn();
    btn = el('button', 'askbtn');
    btn.textContent = 'AI に聞く';
    const r = range.getBoundingClientRect();
    btn.style.left = `${Math.min(r.right + 4, innerWidth - 90)}px`;
    btn.style.top = `${Math.max(4, r.top - 30)}px`;
    btn.onclick = () => { hideBtn(); openWindow(range); };
    NS.overlay.layer.appendChild(btn);
  }

  function hideBtn() { btn?.remove(); btn = null; }

  function quoteOf(range) {
    const { nodes, built } = renderer.textModel();
    const pos = (node, off) => { const i = nodes.indexOf(node); return i >= 0 ? built.starts[i] + off : -1; };
    const s = pos(range.startContainer, range.startOffset);
    const e = pos(range.endContainer, range.endOffset);
    if (s < 0 || e < s) return { exact: range.toString(), prefix: '', suffix: '' };
    return ubqAnchor.quoteAt(built.full, s, e);
  }

  function contextOf(range) {
    const block = NS.blockOf(range.startContainer);
    let heading = '';
    for (const h of document.querySelectorAll('h1, h2, h3')) {
      if (h === block || (h.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING)) heading = h.textContent.trim();
    }
    const text = (block?.innerText || block?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
    return `${heading ? `(見出し: ${heading})\n` : ''}${text}`;
  }

  function placeAwayFromWindows(left, top) {
    const rects = [...windows.values()].map((w) => w.el.getBoundingClientRect());
    const overlaps = (x, y) => rects.some((r) => x < r.right && x + WIN_W > r.left && y < r.bottom && y + WIN_H > r.top);
    if (!overlaps(left, top)) return { left, top };
    const fits = (x) => x >= 8 && x + WIN_W <= innerWidth - 8;
    for (const r of rects) {
      for (const x of [r.left - WIN_W - 10, r.right + 10]) if (fits(x) && !overlaps(x, top)) return { left: x, top };
    }
    while (rects.some((r) => Math.abs(r.left - left) < 30 && Math.abs(r.top - top) < 30)) { left += 36; top += 36; }
    return { left, top };
  }

  function dragBy(handle, box) {
    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const sx = e.clientX - box.offsetLeft;
      const sy = e.clientY - box.offsetTop;
      const move = (ev) => { box.style.left = `${ev.clientX - sx}px`; box.style.top = `${ev.clientY - sy}px`; };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  function logLine(win, cls, text) {
    const div = el('div', cls);
    div.textContent = text;
    const log = win.el.querySelector('.win-log');
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function openWindow(range) {
    const id = rid('w');
    const r = range.getBoundingClientRect();
    let left = Math.min(Math.max(8, r.left), innerWidth - WIN_W - 10);
    let top = r.bottom + 8 + WIN_H > innerHeight ? Math.max(8, r.top - WIN_H) : r.bottom + 8;
    ({ left, top } = placeAwayFromWindows(left, top));
    const box = el('div', 'win');
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    const quote = quoteOf(range);
    box.innerHTML = `
      <div class="win-head"><span class="term"></span><span class="ms"></span><button title="閉じる">×</button></div>
      <div class="win-log"><div class="sys">この語句について聞けます (Enter で送信 / Shift+Enter で改行)</div></div>
      <div class="win-chips">
        <button data-q="この語句を説明して">説明して</button>
        <button data-q="短くポップオーバーで説明して">ポップオーバーで</button>
        <button data-q="詳しく、子セクションを作って解説して">セクションで</button>
        <button data-q="一次情報へのリンクだけ張って">リンクだけ</button>
      </div>
      <div class="win-input"><textarea rows="1" placeholder="質問を入力"></textarea></div>`;
    box.querySelector('.term').textContent = quote.exact.trim();
    NS.overlay.layer.appendChild(box);
    const win = { id, el: box, quote, context: contextOf(range), sessionId: null, busy: false };
    windows.set(id, win);

    const ta = box.querySelector('textarea');
    box.querySelector('.win-head button').onclick = () => { box.remove(); windows.delete(id); };
    box.addEventListener('mousedown', () => { box.style.zIndex = ++z; });
    box.querySelectorAll('.win-chips button').forEach((b) => { b.onclick = () => ask(win, b.dataset.q); });
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();   // Notion のショートカットに食われないように
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (ta.value.trim()) { ask(win, ta.value.trim()); ta.value = ''; }
      }
    });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; });
    dragBy(box.querySelector('.win-head'), box);
    box.style.zIndex = ++z;
    ta.focus();
  }

  // 書き込み指示のタグは小窓に出さない
  const visibleText = (raw) => raw.replace(/<ubiqdoc-[\s\S]*?(<\/ubiqdoc-[a-z]+>|\/>)/g, '').replace(/<(u(b(i(q(d(o(c(-[\s\S]*)?)?)?)?)?)?)?)?$/, '').trim();

  async function ask(win, question) {
    if (win.busy) { NS.overlay.toast('この窓は返答待ちです。別の語句なら同時に聞けます'); return; }
    win.busy = true;
    win.el.classList.add('busy');
    logLine(win, 'me', question);
    const out = logLine(win, 'ai', '…');
    const started = performance.now();
    let raw = '';
    try {
      const res = await NS.request('ask', {
        url: location.href, windowId: win.id, sessionId: win.sessionId, turnId: rid('t'),
        selection: win.quote.exact, quote: win.quote, context: win.sessionId ? undefined : win.context,
        asides: renderer.summary(), question,
      }, (ev, data) => {
        if (ev !== 'delta') return;
        raw += data.text;
        out.textContent = visibleText(raw) || '…';
      });
      win.sessionId = res.sessionId;
      out.textContent = res.reply || '(書き込みだけ行った)';
      renderer.setView(res.view);
      for (const a of res.added) logLine(win, 'sys', `✎ ${KIND[a.kind] || a.kind}を追加 (${a.id})`);
      for (const p of res.pending) logLine(win, 'sys', `✎ 既存の補足 ${p.conflictWith} と重なったので承認待ちに回した`);
      if (res.unanchored) logLine(win, 'err', `差し込み位置が見つからなかった: ${res.unanchored} 件`);
      if (res.parseError) logLine(win, 'err', `書き込み指示を読めなかった: ${res.parseError}`);
      win.el.querySelector('.ms').textContent = `${((performance.now() - started) / 1000).toFixed(1)}s`;
    } catch (e) {
      logLine(win, 'err', `エラー: ${e.message}`);
    } finally {
      win.busy = false;
      win.el.classList.remove('busy');
    }
  }

  NS.ask = { install, ready: true };
})();
```

- [ ] **Step 2: 手で確かめる**

拡張を再読み込みし、Task 12 の Step 6 と同じページで、語句を選ぶ → 「AI に聞く」→「説明して」。答えがストリームで出ること、補足の印が増えること、窓を 2 つ同時に開いて並行して聞けること、続けて質問すると同じ会話になる (前の答えを踏まえる) ことを確かめる

- [ ] **Step 3: Commit**

```bash
git add extension/content/ask.js
git commit -m "feat: 語句を選んで AI に聞く小窓"
```

---

### Task 14: サイドパネル

**Files:**
- Create: `extension/sidepanel/sidepanel.html`, `extension/sidepanel/sidepanel.css`, `extension/sidepanel/sidepanel.js`

**Interfaces:**
- Consumes: background の port (`page-view` / `tab-status` / `undo-turn` / `convert` / `approve` / `reject` / `discard-orphan` / `profile-list` / `profile-remove`) と、`page-updated` / `profile-changed` / `status` の通知 (Task 11)。タブへの `run` / `jump` (Task 12)

- [ ] **Step 1: `extension/sidepanel/sidepanel.html` と `sidepanel.css` を書く**

```html
<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>ubiqdoc</title>
<link rel="stylesheet" href="sidepanel.css"></head>
<body>
  <nav><button id="tab-page" class="on">このページ</button><button id="tab-profile">プロフィール</button></nav>
  <section id="page">
    <div id="status" class="status"></div>
    <h3>書き込み履歴</h3><div id="turns"></div>
    <h3>承認待ち</h3><div id="pending"></div>
    <details id="orphanBox"><summary>見つからなくなった補足 <span id="orphanCount"></span></summary><div id="orphans"></div></details>
  </section>
  <section id="profile" hidden>
    <input id="q" type="search" placeholder="絞り込む">
    <h3>技術 (個人用)</h3><div id="personal"></div>
    <h3>業務 (仕事用)</h3><div id="work"></div>
  </section>
  <script src="sidepanel.js"></script>
</body></html>
```

```css
body { font: 13px/1.6 -apple-system, "Hiragino Sans", sans-serif; margin: 0; padding: 8px 12px; color: #1b1e21; }
nav { display: flex; gap: 4px; margin-bottom: 8px; }
nav button { flex: 1; padding: 4px; border: 1px solid #dde1e5; background: transparent; border-radius: 6px; cursor: pointer; font: inherit; }
nav button.on { background: #1a73e8; color: #fff; border-color: #1a73e8; }
h3 { font-size: 12px; margin: 14px 0 4px; color: #5b636a; }
.item { border: 1px solid #dde1e5; border-radius: 8px; padding: 6px 8px; margin-bottom: 6px; }
.item .label { font-weight: 600; }
.row { display: flex; gap: 6px; align-items: center; font-size: 12px; color: #5b636a; }
.actions { display: flex; gap: 6px; margin-top: 4px; }
button { font: inherit; font-size: 12px; padding: 1px 8px; border-radius: 6px; border: 1px solid #c3c8cd; background: transparent; cursor: pointer; color: inherit; }
button.primary { background: #1a73e8; color: #fff; border-color: #1a73e8; }
.status { padding: 6px 8px; border-radius: 8px; background: #f4f5f7; }
.status .err { color: #c5221f; }
.status code { display: block; margin-top: 4px; padding: 4px; background: #fff; border-radius: 4px; user-select: all; }
.muted { color: #5b636a; }
input[type=search] { width: 100%; box-sizing: border-box; font: inherit; padding: 4px; }
@media (prefers-color-scheme: dark) {
  body { background: #161a1d; color: #e4e8ea; }
  .item, nav button { border-color: #333; } .status { background: #22272b; } .status code { background: #111; }
}
```

- [ ] **Step 2: `extension/sidepanel/sidepanel.js` を書く**

```js
// サイドパネル。開いているタブのページの書き込み履歴・承認待ち・見つからなくなった補足と、知識プロフィール
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KIND = { popover: 'ポップオーバー', section: 'セクション', link: 'リンク' };

let port = null;
let seq = 0;
const pend = new Map();
let current = { tabId: null, url: null };
let lastError = null;

function request(type, payload = {}) {
  if (!port) {
    port = chrome.runtime.connect({ name: 'ubq' });
    port.onMessage.addListener((m) => {
      const p = pend.get(m.id);
      if (!p || m.type === 'event') return;
      pend.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m.data);
    });
    port.onDisconnect.addListener(() => { port = null; });
  }
  const id = `s${++seq}`;
  return new Promise((resolve, reject) => { pend.set(id, { resolve, reject }); port.postMessage({ ...payload, type, id }); });
}

async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}

const sendTab = (msg) => chrome.tabs.sendMessage(current.tabId, msg);

function statusText(st) {
  if (!st) return '';
  if (st.stage === 'extract') return '補足の候補を探しています…';
  if (st.stage === 'write') return `補足を作成中 ${st.made}/${st.total}`;
  if (st.stage === 'done') return `補足を ${st.made} 個作りました`;
  if (st.stage === 'error') return st.message;
  return '';
}

function renderStatus(view, st, err) {
  const box = $('#status');
  const lines = [];
  if (err) {
    lines.push(`<div class="err">${esc(err)}</div>`);
    if (/install\.sh/.test(err)) lines.push('<code>bash host/install.sh</code>');
  }
  if (!view && !err) lines.push('<div class="muted">このページではまだ補足を作っていません。ツールバーの ubiqdoc ボタンで始められます</div>');
  const s = statusText(st);
  if (s) lines.push(`<div>${esc(s)}</div>`);
  if (view?.dropped?.noSource) lines.push(`<div class="muted">出典が付けられず捨てた補足: ${view.dropped.noSource} 個</div>`);
  if (view?.truncated) lines.push('<div class="muted">本文が 100KB を超えたので、先頭だけを読ませました</div>');
  if (view) lines.push('<div class="actions"><button id="rerun">やり直す</button></div>');
  box.innerHTML = lines.join('');
  $('#rerun')?.addEventListener('click', () => sendTab({ type: 'run', force: true }).catch(() => {
    lastError = 'このページではまだ動いていません。ツールバーの ubiqdoc ボタンを押してください';
    refresh();
  }));
}

function renderTurns(view) {
  const box = $('#turns');
  const turns = new Map();
  for (const a of view?.annotations || []) {
    if (!turns.has(a.turnId)) turns.set(a.turnId, { label: a.origin === 'proactive' ? '先回りの補足' : `「${a.anchor.exact}」`, rows: [] });
    turns.get(a.turnId).rows.push(a);
  }
  box.innerHTML = turns.size ? '' : '<p class="muted">なし</p>';
  for (const [turnId, info] of [...turns].reverse()) {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `<div class="label">${esc(info.label)}</div>${info.rows.map((a) => {
      const conv = a.kind === 'popover' ? `<button data-conv="section" data-id="${a.id}">→ セクションにする</button>`
        : a.kind === 'section' ? `<button data-conv="popover" data-id="${a.id}">→ ポップオーバーにする</button>` : '';
      return `<div class="row"><span>${esc(KIND[a.kind])} · ${a.id} 「${esc(a.anchor.exact)}」${a.hidden ? ' (知ってる)' : ''}</span>${conv}<button data-jump="${a.id}">見る</button></div>`;
    }).join('')}<div class="actions"><button data-undo>取り消す</button></div>`;
    div.querySelectorAll('[data-conv]').forEach((b) => b.addEventListener('click', () => act('convert', { id: b.dataset.id, to: b.dataset.conv })));
    div.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => sendTab({ type: 'jump', id: b.dataset.jump }).catch(() => {})));
    div.querySelector('[data-undo]').addEventListener('click', () => act('undo-turn', { turnId }));
    box.appendChild(div);
  }
}

function renderPending(view) {
  const box = $('#pending');
  const list = view?.pending || [];
  box.innerHTML = list.length ? '' : '<p class="muted">なし</p>';
  for (const p of list) {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `<div class="label">「${esc(p.label)}」が ${esc(p.conflictWith)} と重なった</div>
      <div class="muted">${esc(String(p.annotation.body || p.annotation.href || '').replace(/<[^>]+>/g, '').slice(0, 120))}</div>
      <div class="actions"><button class="primary" data-a>セクションとして追加</button><button data-r>捨てる</button></div>`;
    div.querySelector('[data-a]').addEventListener('click', () => act('approve', { pid: p.id }));
    div.querySelector('[data-r]').addEventListener('click', () => act('reject', { pid: p.id }));
    box.appendChild(div);
  }
}

function renderOrphans(view) {
  const list = view?.orphaned || [];
  $('#orphanCount').textContent = list.length ? `(${list.length})` : '';
  const box = $('#orphans');
  box.innerHTML = list.length ? '' : '<p class="muted">なし</p>';
  for (const a of list) {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `<div class="label">「${esc(a.anchor.exact)}」</div><div class="muted">${esc(String(a.body || '').replace(/<[^>]+>/g, '').slice(0, 120))}</div>
      <div class="actions"><button data-d>捨てる</button></div>`;
    div.querySelector('[data-d]').addEventListener('click', () => act('discard-orphan', { id: a.id }));
    box.appendChild(div);
  }
}

async function act(type, payload) {
  try { await request(type, { url: current.url, ...payload }); lastError = null; } catch (e) { lastError = e.message; }
  refresh();
}

async function renderProfile() {
  let data;
  try { data = await request('profile-list'); } catch (e) { $('#personal').innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  const q = $('#q').value.trim().toLowerCase();
  for (const cat of ['personal', 'work']) {
    const box = $(`#${cat}`);
    const list = data[cat].filter((c) => !q || [c.label, c.key, ...(c.aliases || [])].some((s) => String(s).toLowerCase().includes(q)));
    box.innerHTML = list.length ? '' : '<p class="muted">なし</p>';
    for (const c of list) {
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML = `<div class="row"><span class="label">${esc(c.label)}</span><span>${esc(c.key)}</span></div>
        ${c.aliases?.length ? `<div class="muted">${esc(c.aliases.join(' / '))}</div>` : ''}
        <div class="actions"><button data-x>戻す (知らないことにする)</button></div>`;
      div.querySelector('[data-x]').addEventListener('click', async () => { await request('profile-remove', { id: c.id }); renderProfile(); });
      box.appendChild(div);
    }
  }
}

async function refresh() {
  const t = await activeTab();
  if (!t) return;
  current = { tabId: t.id, url: t.url };
  if (!$('#profile').hidden) { renderProfile(); return; }
  let view = null;
  let err = lastError;
  try { view = (await request('page-view', { url: t.url })).view; } catch (e) { err = err || e.message; }
  const st = await request('tab-status', { tabId: t.id }).catch(() => null);
  renderStatus(view, st, err);
  renderTurns(view);
  renderPending(view);
  renderOrphans(view);
}

function showTab(name) {
  $('#tab-page').classList.toggle('on', name === 'page');
  $('#tab-profile').classList.toggle('on', name === 'profile');
  $('#page').hidden = name !== 'page';
  $('#profile').hidden = name !== 'profile';
  refresh();
}

$('#tab-page').addEventListener('click', () => showTab('page'));
$('#tab-profile').addEventListener('click', () => showTab('profile'));
$('#q').addEventListener('input', renderProfile);
chrome.runtime.onMessage.addListener((m) => {
  if (m.type === 'status' && m.tabId !== current.tabId) return;
  if (m.type === 'status' && m.status?.stage === 'error') lastError = m.status.message;
  if (['page-updated', 'profile-changed', 'status'].includes(m.type)) refresh();
});
chrome.tabs.onActivated.addListener(() => { lastError = null; refresh(); });
chrome.tabs.onUpdated.addListener((id, info) => { if (id === current.tabId && (info.status === 'complete' || info.url)) refresh(); });
refresh();
```

- [ ] **Step 3: 手で確かめる**

拡張を再読み込みし、Task 12 のページで、ツールバーのボタンからサイドパネルを開く。作成中の進み具合が出ること、書き込み履歴の「取り消す」「→ セクションにする」「見る」が効くこと、プロフィールのタブに「知ってる」にした概念が出て「戻す」でページの印が戻ること、host を登録していない別プロファイルの Chrome では `bash host/install.sh` の案内が出ることを確かめる

- [ ] **Step 4: Commit**

```bash
git add extension/sidepanel/
git commit -m "feat: サイドパネル (書き込み履歴・承認待ち・プロフィール)"
```

---

### Task 15: 拡張の E2E

**Files:**
- Create: `e2e/package.json`, `e2e/run.js`, `e2e/fixtures/static.html`, `e2e/fixtures/notion-like.html`

**Interfaces:**
- Consumes: 拡張全体、`host/install.sh` (Task 10)、`test/fixtures/fake-claude.js` (Task 1)

- [ ] **Step 1: 見本ページと土台を置く**

`e2e/package.json`:

```json
{
  "private": true,
  "scripts": { "e2e": "node run.js" },
  "dependencies": { "playwright-core": "^1.48.0" }
}
```

`e2e/fixtures/static.html`:

```html
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>静的な見本</title></head>
<body>
  <nav>サイドバーの楽観ロック</nav>
  <article id="doc">
    <h1>受注の仕様</h1>
    <p>更新時は楽観ロックで競合を検知する。</p>
    <p>受注伝票は月末に締める。詳しくは <a href="https://example.com/order-spec">受注の仕様</a> を見る。</p>
    <p>在庫引当は夜間に行う。</p>
  </article>
</body></html>
```

`e2e/fixtures/notion-like.html` (Notion と同じく本文が `contenteditable`。描き直しを `rerender()` で再現する):

```html
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Notion もどき</title></head>
<body>
  <div class="notion-page-content" contenteditable="true">
    <div data-block-id="b1"><span>更新時は楽観ロックで競合を検知する。</span></div>
    <div data-block-id="b2"><span>受注伝票は月末に締める。</span> <a href="https://example.com/order-spec">受注の仕様</a></div>
  </div>
  <script>
    // Notion の描き直しのまね: 段落を、同じ文字を持つ新しい要素に差し替える
    window.rerender = () => {
      for (const b of document.querySelectorAll('[data-block-id]')) b.replaceWith(b.cloneNode(true));
    };
  </script>
</body></html>
```

Run: `cd e2e && npm install && npx playwright-core install chromium`

- [ ] **Step 2: E2E を書く**

`e2e/run.js`:

```js
// 拡張の E2E。Playwright の Chromium に拡張を読み込み、native host は偽の claude で動かす。
// 実行: cd e2e && npm run e2e
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FAKE = path.join(ROOT, 'test', 'fixtures', 'fake-claude.js');

function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const f = path.join(dir, path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^\/+/, ''));
      if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(f));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const highlightCount = (page) => page.evaluate(() => ['ubiqdoc-pop', 'ubiqdoc-sec', 'ubiqdoc-link'].reduce((n, k) => n + (CSS.highlights.get(k)?.size || 0), 0));

// 本文中の語句の画面上の中心 (main world で Range を作って測る)
const pointOf = (page, text) => page.evaluate((t) => {
  const w = document.createTreeWalker(document.querySelector('#doc, .notion-page-content'), NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const i = n.data.indexOf(t);
    if (i < 0) continue;
    const r = document.createRange();
    r.setStart(n, i);
    r.setEnd(n, i + t.length);
    const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }
  return null;
}, text);

const calls = (dir) => {
  const f = path.join(dir, 'calls.jsonl');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').length : 0;
};

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ubq-e2e-'));
  const fakeDir = path.join(os.tmpdir(), 'ubiqdoc-fake');
  fs.rmSync(path.join(fakeDir, 'calls.jsonl'), { force: true });
  const server = await serve(path.join(__dirname, 'fixtures'));
  const base = `http://127.0.0.1:${server.address().port}`;
  let context;
  try {
    // 1. 拡張をコピーし、テスト用に 127.0.0.1 へのアクセス権を最初から持たせる (許可のダイアログを出さないため)
    const ext = path.join(tmp, 'extension');
    fs.cpSync(path.join(ROOT, 'extension'), ext, { recursive: true });
    const mf = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
    mf.host_permissions = ['http://127.0.0.1/*'];
    fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(mf, null, 2));

    // 2. host を偽の claude で、このテストのプロファイルの NativeMessagingHosts に登録する
    const userData = path.join(tmp, 'profile');
    execFileSync('bash', [path.join(ROOT, 'host', 'install.sh')], {
      env: { ...process.env, UBIQDOC_NMH_DIR: path.join(userData, 'NativeMessagingHosts'), UBIQDOC_RUN_SH: path.join(tmp, 'run.sh'),
        UBIQDOC_CLAUDE_BIN: FAKE, UBIQDOC_DATA_DIR: path.join(tmp, 'data') },
      stdio: 'inherit',
    });

    context = await chromium.launchPersistentContext(userData, {
      headless: false,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    assert.equal(new URL(sw.url()).host, execFileSync(process.execPath, [path.join(ROOT, 'host', 'extension-id.js'), path.join(ext, 'manifest.json')]).toString());
    await sw.evaluate(async () => {
      await chrome.storage.local.set({ allowlist: [{ pattern: 'http://127.0.0.1/*', root: '#doc, .notion-page-content' }] });
      await syncContentScripts();
    });

    // 3. 静的なページ: 自動で補足が付く。サイドバーの「楽観ロック」には付かない
    const page = await context.newPage();
    await page.goto(`${base}/static.html`);
    await page.waitForFunction(() => (CSS.highlights.get('ubiqdoc-pop')?.size || 0) >= 1 && (CSS.highlights.get('ubiqdoc-sec')?.size || 0) >= 1, null, { timeout: 30000 });
    assert.equal(await highlightCount(page), 2);
    console.log('ok 自動で補足が付く');

    // 4. ホバーでポップオーバー、出典付き
    const p1 = await pointOf(page, '楽観ロック');
    await page.mouse.move(p1.x, p1.y);
    const pop = page.locator('ubiqdoc-layer .pop');
    await pop.waitFor();
    assert.match(await pop.innerText(), /楽観ロックの説明/);
    assert.match(await pop.innerText(), /出典: en\.wikipedia\.org/);
    console.log('ok ホバーでポップオーバー');

    // 5. 知ってる → 消える → トーストの「戻す」→ 戻る
    await pop.getByText('知ってる').click();
    await page.locator('ubiqdoc-layer .toast').waitFor();
    assert.match(await page.locator('ubiqdoc-layer .toast').innerText(), /「楽観ロック」を知ってるにしました/);
    await page.waitForFunction(() => (CSS.highlights.get('ubiqdoc-pop')?.size || 0) === 0);
    await page.locator('ubiqdoc-layer .toast button').click();
    await page.waitForFunction(() => (CSS.highlights.get('ubiqdoc-pop')?.size || 0) === 1);
    console.log('ok 知ってる と 戻す');

    // 6. セクションはクリックでカードが開く
    const p2 = await pointOf(page, '受注伝票');
    await page.mouse.click(p2.x, p2.y);
    await page.locator('ubiqdoc-layer .card').waitFor();
    assert.match(await page.locator('ubiqdoc-layer .card').innerText(), /受注伝票とは/);
    console.log('ok セクションのカード');

    // 7. 選んで「AI に聞く」→ 小窓 → 答え → 補足が 1 つ増える
    await page.evaluate(() => {
      const p = [...document.querySelectorAll('#doc p')].find((x) => x.textContent.includes('在庫引当'));
      const r = document.createRange();
      r.setStart(p.firstChild, 0);
      r.setEnd(p.firstChild, 4);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.locator('ubiqdoc-layer .askbtn').click();
    await page.locator('ubiqdoc-layer .win-chips button', { hasText: '説明して' }).click();
    await page.locator('ubiqdoc-layer .win-log .ai', { hasText: '説明です。' }).waitFor({ timeout: 15000 });
    await page.waitForFunction(() => ['ubiqdoc-pop', 'ubiqdoc-sec'].reduce((n, k) => n + (CSS.highlights.get(k)?.size || 0), 0) === 3);
    console.log('ok AI に聞く');

    // 8. 開き直しても claude は呼ばれない
    const before = calls(fakeDir);
    await page.reload();
    await page.waitForFunction(() => (CSS.highlights.get('ubiqdoc-sec')?.size || 0) === 1, null, { timeout: 30000 });
    assert.equal(calls(fakeDir), before);
    console.log('ok 開き直しは保存済みの補足を出す');

    // 9. contenteditable のページ: 本文の DOM は変わらず、描き直しのあとも印が残る
    const np = await context.newPage();
    await np.goto(`${base}/notion-like.html`);
    const htmlBefore = await np.evaluate(() => document.querySelector('.notion-page-content').innerHTML);
    await np.waitForFunction(() => (CSS.highlights.get('ubiqdoc-pop')?.size || 0) + (CSS.highlights.get('ubiqdoc-sec')?.size || 0) === 2, null, { timeout: 30000 });
    assert.equal(await np.evaluate(() => document.querySelector('.notion-page-content').innerHTML), htmlBefore);
    await np.evaluate(() => window.rerender());
    await np.waitForTimeout(800);
    assert.equal(await highlightCount(np), 2);
    const p3 = await pointOf(np, '楽観ロック');
    await np.mouse.move(p3.x, p3.y);
    await np.locator('ubiqdoc-layer .pop').waitFor();
    console.log('ok contenteditable で DOM を書き換えず、描き直しに追いつく');

    console.log('E2E: all passed');
  } finally {
    await context?.close();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: 回して確かめる**

Run: `cd e2e && npm run e2e`
Expected: `ok` が 8 行と `E2E: all passed`

host につながらない (手順 3 で補足が付かずタイムアウトし、拡張のサイドパネル相当のエラーが「host が未登録」) なら、Chromium がプロファイルの `NativeMessagingHosts` を見ていない。`UBIQDOC_NMH_DIR` を `~/Library/Application Support/Google/Chrome for Testing/NativeMessagingHosts` に変えて回し直し、通ったほうを `run.js` に残す (残さなかったほうの登録ファイルは消す)

- [ ] **Step 4: Commit**

```bash
git add e2e/package.json e2e/run.js e2e/fixtures/
git commit -m "test: 拡張の E2E (偽の claude で、描画・知ってる・カード・聞く・contenteditable)"
```

---

### Task 16: README と移行

**Files:**
- Modify: `README.md`
- 手作業: LaunchAgent、作業用コピーの `data/`

- [ ] **Step 1: README に「Chrome 拡張として使う」の節を足す**

「Claude Code のプラグインとして入れる」の節の前に足す:

````markdown
## Chrome 拡張として使う

開いたページのうち、読み手が知らなそうな概念に、聞かれる前に補足 (出典付き) を付けておく拡張です。補足に「知ってる」を返すと、その概念は知識プロフィールに入り、以後どのページでも付きません。語句を選んで「AI に聞く」で、HTML リーダーと同じ小窓も使えます。

1. `bash host/install.sh` を実行する (native host の登録。`node` と `claude` の場所が変わったら再実行)
2. `chrome://extensions` でデベロッパーモードを ON にし、「パッケージ化されていない拡張機能を読み込む」で `extension/` を選ぶ
3. 開いたオプション画面で、自動で動かしたいサイトの「許可する」を押す (Notion と GitHub は最初から入っている)。ほかのページでは、ツールバーの ubiqdoc ボタンで動く

- 補足はページの DOM を書き換えずに重ねて描くので、Notion で編集しても補足が本文に混ざりません
- 知識プロフィールは `data/profile/personal.json` (技術) と `data/profile/work.json` (業務) にあります。**`data/` はコミットされません**。`data/` が git の無視対象でない、または過去にコミットされていると、host は起動を拒否します
- 1 ページあたりの先回りの補足は 20 個までです。出典の付けられない補足は出しません
````

- [ ] **Step 2: 全テストを回す**

Run: `npm test && (cd e2e && npm run e2e)`
Expected: すべて PASS、`E2E: all passed`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: Chrome 拡張としての使い方"
```

- [ ] **Step 4: 移行 (人に確認してから行う)**

ここからはリポジトリの外を触る。各手順の前に、何をするかを人に見せて了承を取る。

1. 作業用コピー (`~/PROGRAM/quickmemo/tech-blog/apps/ubiqdoc/`) の `data/` を、このリポジトリの `data/` に移す:

```bash
rsync -a ~/PROGRAM/quickmemo/tech-blog/apps/ubiqdoc/data/ ~/PROGRAM/public/ubiqdoc/data/
```

2. `~/Library/LaunchAgents/com.atsushi.ubiqdoc.dashboard.plist` の `WorkingDirectory` と、`StandardOutPath` / `StandardErrorPath` の `apps/ubiqdoc` を `~/PROGRAM/public/ubiqdoc` (絶対パス) に書き換え、`logs/` を作ってから読み込み直す:

```bash
mkdir -p ~/PROGRAM/public/ubiqdoc/logs
launchctl unload ~/Library/LaunchAgents/com.atsushi.ubiqdoc.dashboard.plist
launchctl load ~/Library/LaunchAgents/com.atsushi.ubiqdoc.dashboard.plist
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8910/
```

Expected: `200`。以前に開いた文書が一覧に出ること

3. 作業用コピーを畳む (`rm -rf` は使わず、ゴミ箱へ移す):

```bash
mv ~/PROGRAM/quickmemo/tech-blog/apps/ubiqdoc ~/.Trash/ubiqdoc-apps-$(date +%Y%m%d)
```

4. アイデアの frontmatter の `app:` を新しい場所に向ける (`ideas/mup1iiu245c02c.md` と `ideas/mv36n5kdda7bc2.md`)。ダッシュボードのファイラが `apps/` 以外を開けるかを先に確かめ、開けなければ人に相談する

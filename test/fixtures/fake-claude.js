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
  if (prompt.includes('[質問]') && prompt.includes('概念なしで')) {
    return '説明です。<ubiqdoc-popover target="selection">選んだ語句の説明</ubiqdoc-popover>';
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

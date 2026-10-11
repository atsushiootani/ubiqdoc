// data/profile/work.json には社外に出せない業務知識が入る。このリポジトリは公開されている。
// .gitignore の data/ だけに頼らず、host の起動のたびに確かめて、外れていたら何もしない
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// git の出力を英語に固定する (stderr の文言で「リポジトリの外」を判定するため)
function git(args, cwd) {
  try {
    const out = execFileSync('git', args, {
      cwd,
      env: { ...process.env, LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    return { ok: true, out, stderr: '', code: 0 };
  } catch (e) {
    return { ok: false, out: '', stderr: e.stderr ? e.stderr.toString() : '', code: e.code ?? e.status };
  }
}

// rev-parse の結果を 'inside' | 'outside' | 'error' に分ける。
// 「外」と言えるのは git が無い (ENOENT) か、「not a git repository」と出たときだけ。
// それ以外の失敗 (dubious ownership など) は外とみなさず止める
function classifyRevParse({ ok, out, stderr, code }) {
  if (code === 'ENOENT') return 'outside';
  if (ok) return (out || '').trim() === 'true' ? 'inside' : 'error';
  if (/not a git repository/.test(stderr || '')) return 'outside';
  return 'error';
}

function checkDataDir(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const inside = git(['rev-parse', '--is-inside-work-tree'], dataDir);
  const state = classifyRevParse(inside);
  if (state === 'outside') return { ok: true };
  if (state === 'error') {
    const first = (inside.stderr || '').trim().split('\n')[0] || `終了コード ${inside.code}`;
    return { ok: false, reason: `git の状態を確かめられませんでした: ${first}` };
  }
  // 先に「過去にコミットされていないか」を見る。git check-ignore は管理下のファイルを
  // 無視対象として報告しないので、順番が逆だと理由を取り違える
  const tracked = git(['ls-files', '--', dataDir], dataDir);
  if (!tracked.ok || tracked.out.trim()) {
    const first = (tracked.out || '').trim().split('\n')[0];
    return { ok: false, reason: `${dataDir} の下に git 管理のファイルがあります。git rm --cached で外してください: ${first}` };
  }
  // プロフィールのほかに、ページ本文 (data/ext/pages) も業務情報なので両方を確かめる
  const probes = [
    path.join(dataDir, 'profile', 'work.json'),
    path.join(dataDir, 'ext', 'pages', '0'.repeat(40), 'page.json'),
  ];
  for (const probe of probes) {
    if (!git(['check-ignore', '-q', probe], dataDir).ok) {
      return { ok: false, reason: `${probe} が git の無視対象になっていません。.gitignore に data/ を入れてください` };
    }
  }
  return { ok: true };
}

module.exports = { checkDataDir, classifyRevParse };

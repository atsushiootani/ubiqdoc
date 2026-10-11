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

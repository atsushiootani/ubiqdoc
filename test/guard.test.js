const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { checkDataDir, classifyRevParse } = require('../host/guard.js');

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

test('.gitignore が data/profile/work.json だけなら、ページ本文の置き場が無視されていないので止める', (t) => {
  const dir = repo(t);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'data/profile/work.json\n');
  const r = checkDataDir(path.join(dir, 'data'));
  assert.equal(r.ok, false);
  assert.match(r.reason, /無視対象/);
});

test('classifyRevParse: 外・error・内の判定', () => {
  assert.equal(classifyRevParse({ ok: false, out: '', stderr: '', code: 'ENOENT' }), 'outside');
  assert.equal(classifyRevParse({ ok: false, out: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git\n', code: 128 }), 'outside');
  assert.equal(classifyRevParse({ ok: false, out: '', stderr: "fatal: detected dubious ownership in repository at '/x'\n", code: 128 }), 'error');
  assert.equal(classifyRevParse({ ok: true, out: 'true\n', stderr: '', code: 0 }), 'inside');
});

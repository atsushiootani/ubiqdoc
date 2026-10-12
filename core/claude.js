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

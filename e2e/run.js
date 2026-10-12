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
  // 偽の claude の記録はこのテストの作業場所に置く (Chrome の環境変数が native host にそのまま渡る)
  const fakeDir = path.join(tmp, 'fake');
  const server = await serve(path.join(__dirname, 'fixtures'));
  const base = `http://127.0.0.1:${server.address().port}`;
  let context;
  const log = [];
  let failed = false;
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
    // host の stderr を作業場所に残す (失敗したときに出す)
    const hostErr = path.join(tmp, 'host-stderr.log');
    const runSh = path.join(tmp, 'run.sh');
    fs.writeFileSync(runSh, fs.readFileSync(runSh, 'utf8').replace(/"\$@"\n?$/, `"$@" 2>>"${hostErr}"\n`));

    context = await chromium.launchPersistentContext(userData, {
      headless: false,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
      env: { ...process.env, UBIQDOC_FAKE_DIR: fakeDir },
    });
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    sw.on('console', (m) => log.push(`[sw ${m.type()}] ${m.text()}`));
    context.on('page', (p) => {
      p.on('console', (m) => log.push(`[page ${m.type()}] ${m.text()}`));
      p.on('pageerror', (e) => log.push(`[page 例外] ${e.message}`));
    });
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
    // × は見出しのラベルに隠れずに押せる (隠れていると Playwright が「別の要素が受ける」で待ち続けて落ちる)
    await page.locator('ubiqdoc-layer .card .close').click({ timeout: 5000 });
    await page.locator('ubiqdoc-layer .card').waitFor({ state: 'detached' });
    console.log('ok セクションのカード (× で閉じる)');

    // 7. 選んで「AI に聞く」→ 小窓 → 答え → 補足が 1 つ増える
    // 拡張は偽のイベント (isTrusted が false) を無視するので、本物のマウスでドラッグして選ぶ
    const ends = await page.evaluate(() => {
      const p = [...document.querySelectorAll('#doc p')].find((x) => x.textContent.includes('在庫引当'));
      const i = p.firstChild.data.indexOf('在庫引当');
      const r = document.createRange();
      r.setStart(p.firstChild, i);
      r.setEnd(p.firstChild, i + 4);
      const b = r.getBoundingClientRect();
      return { x1: b.left + 1, x2: b.right - 1, y: b.top + b.height / 2 };
    });
    // ページ側のスクリプトが作った選択と偽の mouseup では、ボタンが出ない
    // 直前の本物のクリックの mouseup の後始末 (setTimeout) が済むのを待ってから試す
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const p = [...document.querySelectorAll('#doc p')].find((x) => x.textContent.includes('在庫引当'));
      const r = document.createRange();
      r.setStart(p.firstChild, 0);
      r.setEnd(p.firstChild, 4);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('ubiqdoc-layer .askbtn').count(), 0);
    await page.evaluate(() => getSelection().removeAllRanges());
    await page.mouse.move(ends.x1, ends.y);
    await page.mouse.down();
    await page.mouse.move(ends.x2, ends.y, { steps: 8 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => getSelection().toString()), '在庫引当');
    await page.locator('ubiqdoc-layer .askbtn').click();
    await page.locator('ubiqdoc-layer .win-chips button', { hasText: '説明して' }).click();
    await page.locator('ubiqdoc-layer .win-log .ai', { hasText: '説明です。' }).waitFor({ timeout: 15000 });
    await page.waitForFunction(() => ['ubiqdoc-pop', 'ubiqdoc-sec'].reduce((n, k) => n + (CSS.highlights.get(k)?.size || 0), 0) === 3);
    console.log('ok AI に聞く (偽の mouseup は無視)');

    // 8. 開き直しても claude は呼ばれない
    const before = calls(fakeDir);
    assert.ok(before >= 3, `偽の claude が呼ばれていない (${before} 回)`);
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
  } catch (e) {
    failed = true;
    throw e;
  } finally {
    if (failed || process.env.UBQ_E2E_VERBOSE) {
      console.error('--- ブラウザのログ ---\n' + log.join('\n'));
      const f = path.join(tmp, 'host-stderr.log');
      if (fs.existsSync(f)) console.error('--- host の stderr ---\n' + fs.readFileSync(f, 'utf8'));
    }
    await context?.close();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });

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

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

test('既定の許可リストは app.notion.com の Notion も含む', () => {
  const e = entryFor(DEFAULT_ALLOWLIST, 'https://app.notion.com/p/acme/Spec-0123456789abcdef0123456789abcdef');
  assert.ok(e);
  assert.equal(e.root, '.notion-page-content');
});

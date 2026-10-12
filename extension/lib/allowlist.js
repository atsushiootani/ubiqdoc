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

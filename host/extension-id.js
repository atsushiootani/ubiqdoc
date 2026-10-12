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

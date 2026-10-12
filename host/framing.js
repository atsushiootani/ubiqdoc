// Chrome の native messaging の枠: 4 バイト (ネイティブのバイト順。macOS ではリトルエンディアン) の長さ + UTF-8 の JSON

function encode(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

class Decoder {
  constructor(onMessage) { this.onMessage = onMessage; this.buf = Buffer.alloc(0); }
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 4) {
      const n = this.buf.readUInt32LE(0);
      if (this.buf.length < 4 + n) break;
      const body = this.buf.subarray(4, 4 + n);
      this.buf = this.buf.subarray(4 + n);
      this.onMessage(JSON.parse(body.toString('utf8')));
    }
  }
}

module.exports = { encode, Decoder };

const fs = require('fs');
const path = require('path');

// 途中で落ちても壊れたファイルが残らないよう、一時ファイルに書いてから rename する
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

module.exports = { writeAtomic };

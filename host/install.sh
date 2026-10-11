#!/bin/bash
# ubiqdoc の native host を Chrome に登録する。一度だけ実行すればよい (node や claude の場所が変わったら再実行)。
#
# Chrome が起動する native host はログインシェルの PATH を持たないので、node と claude が見つからずに落ちる。
# 実行した時点の node と claude の絶対パスを焼き込んだラッパ (run.sh) を作り、それを登録する
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(node -p 'process.execPath')"   # nodenv などの shim ではなく実体を指す
CLAUDE="${UBIQDOC_CLAUDE_BIN:-$(command -v claude || true)}"
if [ -z "$CLAUDE" ]; then
  echo "claude が見つかりません。Claude Code をインストールしてログインしてから実行してください" >&2
  exit 1
fi
RUN_SH="${UBIQDOC_RUN_SH:-$ROOT/host/run.sh}"
NMH_DIR="${UBIQDOC_NMH_DIR:-$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts}"
EXT_ID="$("$NODE" "$ROOT/host/extension-id.js" "$ROOT/extension/manifest.json")"

{
  echo '#!/bin/bash'
  echo "# host/install.sh が生成した。手で直さず、install.sh を実行し直す"
  echo "export PATH=\"$(dirname "$NODE"):$(dirname "$CLAUDE"):/usr/bin:/bin\""
  echo "export UBIQDOC_CLAUDE_BIN=\"$CLAUDE\""
  if [ -n "${UBIQDOC_DATA_DIR:-}" ]; then echo "export UBIQDOC_DATA_DIR=\"$UBIQDOC_DATA_DIR\""; fi
  echo "exec \"$NODE\" \"$ROOT/host/host.js\" \"\$@\""
} > "$RUN_SH"
chmod +x "$RUN_SH"

mkdir -p "$NMH_DIR"
cat > "$NMH_DIR/com.atsushiootani.ubiqdoc.json" <<JSON
{
  "name": "com.atsushiootani.ubiqdoc",
  "description": "ubiqdoc native host",
  "path": "$RUN_SH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
JSON

echo "登録しました: $NMH_DIR/com.atsushiootani.ubiqdoc.json"
echo "拡張 ID: $EXT_ID"

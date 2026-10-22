#!/bin/bash
# ubiqdoc の native host を Chrome に登録する。一度だけ実行すればよい (node や claude の場所が変わったら再実行)。
#
# Chrome が起動する native host はログインシェルの PATH を持たないので、node と claude が見つからずに落ちる。
# 実行した時点の node と claude の絶対パスを書いたラッパ (run.sh) を作り、それを登録する。
# 書いたパスは nodenv などで版を消すと無くなるので、run.sh は起動のたびに確かめ、無ければユーザーのシェルに聞き直す
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
LOG="${UBIQDOC_LAUNCH_LOG:-$ROOT/logs/host-launch.log}"

{
  echo '#!/bin/bash'
  echo "# host/install.sh が生成した。手で直さず、install.sh を実行し直す"
  echo "# 下の値は install.sh を実行した時点のもの。node と claude は起動のたびに確かめる"
  printf 'ROOT=%q\nNODE=%q\nCLAUDE=%q\nLOG=%q\n' "$ROOT" "$NODE" "$CLAUDE" "$LOG"
  if [ -n "${UBIQDOC_DATA_DIR:-}" ]; then printf 'export UBIQDOC_DATA_DIR=%q\n' "$UBIQDOC_DATA_DIR"; fi
  cat <<'RUN'
if [ -n "${UBIQDOC_NODE:-}" ]; then NODE="$UBIQDOC_NODE"; fi
# 書いたパスが消えていたら (nodenv で版を消した等)、ユーザーのシェルに聞き直す。
# -i で .zshrc も読ませる (anyenv / nodenv の初期化はたいていそこにある)。stdin は Chrome との通信路なので渡さない
if [ ! -x "$NODE" ] || [ ! -x "$CLAUDE" ]; then
  found="$("${SHELL:-/bin/zsh}" -ilc 'command -v node >/dev/null && echo "UBQ_NODE=$(node -p process.execPath)"; echo "UBQ_CLAUDE=$(command -v claude)"' </dev/null 2>/dev/null || true)"
  [ -x "$NODE" ] || NODE="$(printf '%s\n' "$found" | sed -n 's/^UBQ_NODE=//p' | tail -1)"
  [ -x "$CLAUDE" ] || CLAUDE="$(printf '%s\n' "$found" | sed -n 's/^UBQ_CLAUDE=//p' | tail -1)"
fi
if [ ! -x "$NODE" ] || [ ! -x "$CLAUDE" ]; then
  # Chrome には「Native host has exited」としか出ないので、理由はログに残す
  mkdir -p "$(dirname "$LOG")"
  echo "$(date '+%F %T') node か claude が見つかりません (node=${NODE:-なし} claude=${CLAUDE:-なし})。リポジトリで bash host/install.sh を実行し直してください" | tee -a "$LOG" >&2
  exit 1
fi
export PATH="$(dirname "$NODE"):$(dirname "$CLAUDE"):/usr/bin:/bin"
export UBIQDOC_CLAUDE_BIN="$CLAUDE"
exec "$NODE" "$ROOT/host/host.js" "$@"
RUN
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

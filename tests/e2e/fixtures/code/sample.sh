#!/usr/bin/env bash
# Shell: variables, tests, loops, functions, heredoc.
set -euo pipefail

VAULT="${1:-$HOME/vault}"
count=0

install() {
  local dst="$VAULT/.obsidian/plugins/native-file-editor"
  mkdir -p "$dst"
  for f in main.js manifest.json styles.css; do
    cp "native-file-editor/$f" "$dst/$f" && count=$((count + 1))
  done
}

if [[ -d "$VAULT/.obsidian" ]]; then
  install
  echo "copied $count files to $VAULT"
else
  cat <<MSG >&2
$VAULT is not a vault
MSG
  exit 1
fi

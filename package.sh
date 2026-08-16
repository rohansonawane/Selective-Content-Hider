#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist"
STORE="$ROOT/store"
ICONS="$ROOT/icons"

mkdir -p "$DIST" "$STORE" "$ICONS"

rsvg-convert -w 16 -h 16 "$ICONS/icon.svg" -o "$ICONS/icon16.png"
rsvg-convert -w 32 -h 32 "$ICONS/icon.svg" -o "$ICONS/icon32.png"
rsvg-convert -w 48 -h 48 "$ICONS/icon.svg" -o "$ICONS/icon48.png"
rsvg-convert -w 128 -h 128 "$ICONS/icon.svg" -o "$ICONS/icon128.png"
rsvg-convert -w 512 -h 512 "$ICONS/icon.svg" -o "$ICONS/icon512.png"
cp "$ICONS/icon128.png" "$ROOT/icon.png"

ZIP="$DIST/selective-content-hider.zip"
rm -f "$ZIP"
(
  cd "$ROOT"
  zip -q -r "$ZIP" \
    manifest.json \
    background.js content.js content.css \
    popup.html popup.css popup.js \
    options.html options.css options.js \
    icons/icon.svg icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png \
    icon.png \
    privacy.html PRIVACY.md LICENSE README.md
)

echo "Wrote $ZIP"
unzip -l "$ZIP" | tail -n 5

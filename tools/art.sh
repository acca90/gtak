#!/bin/sh
# Art pipeline.
#   tools/art.sh            export art/*.aseprite -> assets/*.png + assets/atlas.js
#   tools/art.sh generate   create missing art/*.aseprite from the procedural seed, then export
#   tools/art.sh regenerate overwrite ALL art/*.aseprite with the seed (loses hand edits!), then export
set -e
cd "$(dirname "$0")/.."

if [ -z "$ASEPRITE" ]; then
  ASEPRITE=$(command -v aseprite || true)
  [ -z "$ASEPRITE" ] && ASEPRITE="$HOME/.local/share/Steam/steamapps/common/Aseprite/aseprite"
fi
[ -x "$ASEPRITE" ] || { echo "Aseprite not found; set ASEPRITE=/path/to/aseprite" >&2; exit 1; }

case "$1" in
  generate)   "$ASEPRITE" -b --script-param root="$PWD" --script tools/generate-art.lua ;;
  regenerate) "$ASEPRITE" -b --script-param root="$PWD" --script-param force=1 --script tools/generate-art.lua ;;
esac
"$ASEPRITE" -b --script-param root="$PWD" --script tools/export-art.lua

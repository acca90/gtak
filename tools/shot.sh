#!/bin/sh
# Headless screenshot of the game (or any page) for visual checks.
#
#   tools/shot.sh out.png                          title screen
#   tools/shot.sh out.png 'demo&drive=60&time=2'   a #demo scenario (see README "Testing hook")
#   tools/shot.sh out.png 'demo' gallery.html      another page
#
# Uses a throwaway Firefox profile so it works while your normal Firefox is open.
# Runtime errors are drawn on the page (index.html catches them), so look at the image.
set -e
cd "$(dirname "$0")/.."
out=${1:?usage: tools/shot.sh out.png [hash] [page]}
hash=${2:-}
page=${3:-index.html}
size=${SHOT_SIZE:-1280,720}
profile=$(mktemp -d)
trap 'rm -rf "$profile"' EXIT
url="file://$PWD/$page"
[ -n "$hash" ] && url="$url#$hash"
timeout 90 firefox --headless --no-remote --profile "$profile" --window-size="$size" --screenshot "$(realpath -m "$out")" "$url" >/dev/null 2>&1
[ -s "$out" ] && echo "wrote $out" || { echo "screenshot failed" >&2; exit 1; }

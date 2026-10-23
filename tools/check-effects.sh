#!/bin/bash
# Compares each built effect with Core Image's render of the same frame (tools/ci.js ref).
# Chrome's fake camera shows .cache/fx/frame.mjpeg; the "normal" grab is the frame both sides start from.
# The face effects run in a second pass on a portrait (FACE=<1080×720 png>, default .cache/faces/frame.png; skipped if
# it can't be made) and Core Image gets the parameters the page drew with, so that pass checks the drawing, not the
# tracking. The default portrait is Jessica Watkins' official NASA portrait (public domain, Wikimedia Commons), its
# 1280×1600 version cropped to 1200×800 at (80, 60) from the top left and scaled to 1080×720; it's downloaded into
# .cache/faces/ the first time.
# usage: tools/check-effects.sh [frame.png=a 1080×720 crop of The Beach]   (needs the dev server on :8765 or URL=)
set -euo pipefail
cd "$(dirname "$0")/.."
D=.cache/fx
mkdir -p "$D"
if [[ -n ${1:-} ]]; then cp "$1" "$D/frame.png"; else
  sips -s format png --resampleWidth 1080 public/assets/wallpapers/the-beach.jpg --out "$D/big.png" >/dev/null
  sips --cropToHeightWidth 720 1080 "$D/big.png" --out "$D/frame.png" >/dev/null
fi
fail=0
# pass <frame.png> <JS run first> <id:ci.js effect> …  (ids and effects spell spaces as -)
pass() {
  local frame=$1 pre=$2
  shift 2
  sips -s format jpeg -s formatOptions 100 "$frame" --out "$D/frame.jpg" >/dev/null
  mv "$D/frame.jpg" "$D/frame.mjpeg"
  rm -f "$D"/params-*.json
  FAKE_VIDEO="$D/frame.mjpeg" JSON="$D/grabs.json" node tools/shot.mjs "$D/shot.png" "$pre$(cat tools/check-effects.js)" >/dev/null
  node -e '
const fs = require("fs"), d = process.argv[1], g = JSON.parse(fs.readFileSync(d + "/grabs.json"));
if (!g) process.exit(1);
const name = (id) => id.replaceAll(" ", "-");
for (const [id, url] of Object.entries(g)) if (id !== "used") fs.writeFileSync(`${d}/ours-${name(id)}.png`, Buffer.from(url.split(",")[1], "base64"));
for (const [id, p] of Object.entries(g.used)) if (p) fs.writeFileSync(`${d}/params-${name(id)}.json`, JSON.stringify(p));' "$D"
  for pair in "$@"; do
    local id=${pair%%:*} fx=${pair#*:} params=
    [[ -f $D/params-$id.json ]] && params=$D/params-$id.json
    osascript -l JavaScript tools/ci.js ref "$D/ref-$id.png" "${fx//-/ }" "$D/ours-normal.png" $params >/dev/null
    local d mean ok
    d=$(osascript -l JavaScript tools/ci.js diff "$D/ours-$id.png" "$D/ref-$id.png")
    mean=$(echo "$d" | awk '{print ($2 > $3 ? ($2 > $4 ? $2 : $4) : ($3 > $4 ? $3 : $4))}')
    ok=$(awk -v m="$mean" 'BEGIN { print (m <= 3 ? "ok" : "FAIL") }')
    [[ $ok == ok ]] || fail=1
    printf '%-14s %s  %s\n' "$id" "$ok" "$d"
  done
}
# Our ids → tools/ci.js effect names.
pass "$D/frame.png" '' sepia:sepia blackandwhite:bw plasticcamera:plasticcamera comicbook:comicbook colorpencil:colorpencil glow:glow \
  thermalcamera:thermal xray:xray bulge:bulge dent:dent twirl:twirl squeeze:squeeze lighttunnel:lighttunnel mirror:mirror fisheye:fisheye stretch:stretch
FACE=${FACE:-.cache/faces/frame.png}
if [[ ! -f $FACE && $FACE == .cache/faces/frame.png ]]; then
  mkdir -p .cache/faces
  curl -sSfL -A 'larp-macos check-effects' -o .cache/faces/watkins.jpg 'https://commons.wikimedia.org/wiki/Special:FilePath/Jessica_Watkins_official_portrait.jpg?width=1200' &&
    osascript -l JavaScript tools/ci.js crop .cache/faces/watkins.jpg "$FACE" 80 60 1200 800 1080 720 >/dev/null || true
fi
if [[ -f $FACE ]]; then
  pass "$FACE" 'const PAGES = [[0, ["normal", "space alien", "nose twirl", "chipmunk", "lovestruck", "dizzy", "blockhead", "bug out", "frog"]]];' \
    space-alien:space-alien nose-twirl:nose-twirl chipmunk:chipmunk lovestruck:lovestruck dizzy:dizzy blockhead:blockhead bug-out:bug-out frog:frog
else
  echo "face effects skipped: no $FACE"
fi
exit $fail

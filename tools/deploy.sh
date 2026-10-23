#!/bin/bash
# Deploy public/ to Cloudflare Pages, then run the Chrome checks against the deployed site.
# main goes to production (https://larpmacos.pages.dev); any other branch gets a preview at
# https://<branch>.larpmacos.pages.dev. Apple's assets aren't in git, so deploys run from a Mac that has
# public/assets/ (tools/extract-assets.sh makes them), never from Cloudflare's git builds.
# Needs `npx wrangler login` once. SKIP_CHECKS=1 skips the checks.
set -euo pipefail
cd "$(dirname "$0")/.."

branch=$(git branch --show-current)
[[ -n $branch ]] || { echo "error: detached HEAD; check out a branch" >&2; exit 1; }
if [[ $branch == main && -n $(git status --porcelain) ]]; then
  echo "error: uncommitted changes; production deploys a committed main" >&2; exit 1
fi
# Every asset the manifest lists must be on disk, or the site ships with holes.
node -e '
  const fs = require("fs"), m = JSON.parse(fs.readFileSync("public/assets/manifest.json"));
  const miss = m.assets.filter((a) => !fs.existsSync("public/assets/" + a.output));
  if (miss.length) { console.error("error: missing assets (run tools/extract-assets.sh):", miss.map((a) => a.output).join(" ")); process.exit(1); }
' || exit 1

npx wrangler pages deploy public --project-name larpmacos --branch "$branch" \
  --commit-hash "$(git rev-parse HEAD)" --commit-message "$(git log -1 --format=%s)" --commit-dirty=true

if [[ $branch == main ]]; then url=https://larpmacos.pages.dev/
else url="https://$(echo "$branch" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | cut -c1-28 | sed 's/-*$//').larpmacos.pages.dev/"; fi
echo "deployed: $url"
[[ -n ${SKIP_CHECKS:-} ]] && exit 0

sleep 5   # let the new deployment reach the alias
mkdir -p .cache
URL=$url node tools/shot.mjs .cache/deploy-photobooth.png "$(cat tools/check-photobooth.js)"
URL=$url node tools/shot.mjs .cache/deploy-shell.png "$(cat tools/check-shell.js)"
echo "checks passed: $url"

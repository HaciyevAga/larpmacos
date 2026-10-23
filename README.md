# LARP macOS

A fake macOS desktop in the browser, with a working Photo Booth. Open it on any desktop computer (Windows, Linux, ChromeOS), go full screen, and take that "first photo on my new Mac".

**Live:** https://larpmacos.pages.dev

- Menu bar, Dock, windows you can drag, focus and full-screen, the desktop's right-click menu, and a wallpaper picker.
- Photo Booth: live mirrored camera, still / 4-up / video, the 3-2-1 countdown, flash, sounds, the photo tray with photofall, and save.
- All 24 effects that Photo Booth 13.1 loads, using its exact parameters. The 16 image effects are WebGL ports of Core Image's maths, checked against Core Image renders. The 8 face effects (Bug Out, Lovestruck, Dizzy…) run on self-hosted MediaPipe face tracking.
- Private by design: frames never leave the browser, the camera starts only when Photo Booth opens, and a `connect-src 'self'` CSP blocks other hosts.

Photo Booth's behaviour was reverse engineered from the app binary and its resources. The notes are in [`docs/photobooth-findings.md`](docs/photobooth-findings.md).

## Run it

Apple's assets (wallpapers, icons, SF Pro, Photo Booth's images and sounds) are **not in this repo**. Extract them from your own Mac:

```sh
tools/extract-assets.sh   # writes public/assets/; macOS 15
python3 -m http.server 8765 -d public
```

Then open http://localhost:8765. No build step: plain ES modules in `public/`.

## Checks

With the server running, these drive headless Chrome and Firefox with fake cameras:

```sh
node tools/shot.mjs out.png "$(cat tools/check-photobooth.js)"
node tools/shot.mjs out.png "$(cat tools/check-shell.js)"
node tools/shot-firefox.mjs out.png "$(cat tools/check-photobooth.js)"
tools/check-effects.sh   # compares each effect with Core Image's render (macOS)
```

Prefix any of them with `URL=https://…/` to test another host.

## Deploy

The site is static and hosted on Cloudflare Pages. Apple's assets aren't in git, so deploys go from a Mac that has `public/assets/`, not from Cloudflare's git builds. Run `npx wrangler login` once.

```sh
git switch dev                 # work here; tools/deploy.sh gives a preview at https://dev.larpmacos.pages.dev
tools/deploy.sh

git switch main && git merge --ff-only dev && git push
tools/deploy.sh                # production: https://larpmacos.pages.dev
```

`tools/deploy.sh` checks that every asset is present, uploads `public/`, then runs the Chrome checks against the deployed URL (`SKIP_CHECKS=1` to skip them). On `main` it refuses uncommitted changes.

## Credits

Face tracking: [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) (Apache 2.0), vendored in `public/vendor/mediapipe/` with its usage logger disabled. macOS, Photo Booth and SF Pro are Apple's. This is a fan project, not affiliated with Apple.

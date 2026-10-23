# LARP macOS — Build Handoff

## Prompt for the next agent (paste this into the new chat)

> You are continuing **LARP macOS** in `/Users/agahaciyev/larpmacos` (a fake macOS desktop + Photo Booth website). Read `HANDOFF.md` in full first, starting with this prompt and the last two progress-log entries, then `docs/photobooth-findings.md` (sections "Effects browser", Q11 "Photofall", Q8 "Full-screen transition", "Face effects", "Core Image's own maths", and the Q6 class map).
>
> **State:** Phases 0–5 are built. All 24 effects Photo Booth 13.1 loads use its exact values (16 match Core Image renders; the 8 face effects run on self-hosted MediaPipe in `public/vendor/mediapipe/`, their drawing matches Core Image given the same face points). **Phase 6 polish is done** except sound timing: windows fade, the desktop right-click menu, the effects browser's page slide and mosaic zoom (decoded with REA), photofall (new photos drop into the tray, decoded from `photofall2.dae`), the full-screen transition (Photo Booth has none of its own; the build mimics macOS's), and SF Pro as a 2.75 MB WOFF2. **Deployed** to https://larpmacos.pages.dev (Cloudflare Pages, direct upload). The owner accepted all effects and animations on 2026-10-23.
>
> **Rules**
> - Stack: plain ES modules in `public/`, no build step. Serve with `python3 -m http.server 8765 -d public`. Test with `node tools/shot.mjs <png> "$(cat tools/check-photobooth.js)"`, then `tools/check-shell.js` (Chrome only: its drag test uses synthetic pointers Firefox rejects), then `tools/shot-firefox.mjs` with `check-photobooth.js`, then `tools/check-effects.sh` (16 effects on The Beach, then a face pass on a public-domain NASA portrait it downloads into `.cache/faces/` once). Run them one at a time; all take `URL=`.
> - **Effects pipeline:** `public/js/effects.js` entries are a GLSL body or a list of passes (`{glsl, lut, out}` / `{blur, sigma, out}`); `photobooth.js` runs them, also for the browser tiles (`uPreview` = 1 there). Face effects: `public/js/faces.js` tracks faces and ports each `processFace:forImage:` to JS, handing the shader `uFace[]` / `uCount` (bumps, twirls, or sprite transforms from a runtime atlas bound as `lut: 'sprites'`).
> - **Core Image's maths:** kernel sources: `python3 -I tools/cikernel.py _name …`. Parameter mappings: measure with `osascript -l JavaScript tools/ciprobe.js '<expr>' x,y …`. JXA quirks: a CGColorSpace inside an options dictionary crashes; a general `CIKernel` with a sampler renders garbled (use a `CIWarpKernel`); an infinite-extent sampler fails (crop first).
> - **Privacy:** MediaPipe's bundle has a usage logger that posts to `odml.pa.googleapis.com` (no opt-out in its API). `public/vendor/mediapipe/vision_bundle.mjs` is patched (`flush(t,e){if(this.error)` → `flush(t,e){this.i=[];if(this.error)`, and the source-map comment removed); redo that if the package is ever upgraded. `index.html` sets `Content-Security-Policy: connect-src 'self'`; keep it.
> - **REA:** Hopper provider on a copy of the binary (`cp "/System/Applications/Photo Booth.app/Contents/MacOS/Photo Booth" <your tmp>/PhotoBooth`, sha256 `73ed6688…`). Prefer `docs/study/pb-strings.tsv` / `pb-procedures.tsv` over string searches. Pseudocode drops float arguments: use `procedure_assembly` + `read_bytes`. For bulk reading, dump `otool -arch arm64e -tV <copy>` to a file once and read it with a small Python helper (stripped: use the procedure table for ranges; resolve `adrp` + `ldr d` pairs from the file at offset 819200 + (address − 0x100000000); find callers by grepping `bl <selector stub>`, where stubs are the `auth_sel_*` rows). A selector whose selref is referenced only from a method list has no caller. Hopper can go unreachable mid-batch: `close_binary`, reopen, retry. Run `close_binary` when done.
> - **Core Animation timing** can be measured from JXA: a CALayer only gets implicit actions inside a layer tree with a context (add it to an offscreen `NSWindow`'s layer-backed content view, flush, then change it in a `CATransaction`).
> - **Public repo, private assets:** the repo is public on GitHub for the owner's portfolio, so `public/assets/` and `docs/study/` are gitignored and never committed (SF Pro and SF Symbols forbid redistribution). They stay on disk; `tools/extract-assets.sh` rebuilds the assets. The old history that carries them is the local-only branch `private-history`: never push it, and never `git push --all`.
> - **Deploy** with `tools/deploy.sh` from a checkout that has `public/assets/`: work on `dev` (preview at https://dev.larpmacos.pages.dev), then `git switch main && git merge --ff-only dev && git push` and run it again for production. It checks the assets, uploads (classic Pages; never pass `--force`), and runs the two Chrome checks against the deployed URL. Run Firefox and `check-effects.sh` by hand with `URL=` when effects or the camera change.
> - In a background job the shell guard rejects `cd` outside the worktree, `git -C`, loops that run commands from variables, awk programs with `|`, and inline heredocs fed to interpreters: write helper scripts with Write and run them by absolute path.
> - Record every finding in `docs/photobooth-findings.md` as observed / inferred / unknown, with Evidence IDs.
> - **Git:** commit after each finished chunk. When context gets heavy, stop at a clean point, add a progress entry here, and give the owner a fresh prompt for a new chat.
>
> **Tasks, in order**
> 1. If `main` doesn't have session 7 yet, the owner runs the command block in the session 7 progress entry (it keeps `private-history`, moves `main` to the clean history, and publishes the repo). Don't run `git push` yourself unless the owner asks.
> 2. **The owner accepted everything (2026-10-23):** don't ask for side-by-side feedback again and don't tune anything unless the owner reports a problem.
> 3. Optional, if the owner wants it: a custom domain on the Pages project, and a screenshot or GIF in `README.md` for the portfolio (take it with `tools/shot.mjs`; it must not be Apple-only content like a bare wallpaper).
> 4. Optional, REA first: sound timing (Phase 6 polish), the effects browser's full-screen page transition (`-[VideoLayer _fullScreenGoToPage:animate:]`, not decoded; the build uses the window slide in full screen too).

---

## 1. What this is, and why

A website that turns any desktop browser (Windows, Linux, ChromeOS, Mac) into a convincing fake Mac. There's a trend where people who just bought a Mac open Photo Booth first and post the photo. LARP macOS lets anyone take that "first photo on my new Mac" from any computer.

**What success looks like:** someone on a Windows laptop opens the site and the browser goes full screen. At a glance, the screen can't be told apart from real macOS. They open Photo Booth, take a photo with the real countdown, flash, sound and effects, and save it. The saved photo, or a phone picture of the screen, passes as a real Mac.

## 2. What the owner decided

- **Desktop only.** Small or touch-only screens get a "Grab a computer" screen instead.
- **Everything looks like macOS, but only Photo Booth works.** The one other working feature is **changing the wallpaper** (System Settings → Wallpaper).
- **Photo Booth opens as a normal macOS window** that can be dragged by its title bar. The green traffic light toggles full screen.
- **Use the real Apple assets** (app icons, wallpapers, Photo Booth's own images, sounds, effect definitions), extracted from the owner's Mac. The owner accepts the risk.
- **REA must be used** to pull out and understand Photo Booth's behaviour and effects. The goal is "get all the things in my Photo Booth app and add it to the new site."
- **Visual reference:** the design spike at https://claude.ai/artifact/NuWW88hxNxtSkaJ5idx62H (private to the owner). Its source is in `docs/reference/design-canvas.dc.html`. It uses look-alike icons and gradient wallpapers on purpose; the real build swaps in the real assets. Reuse its interaction model: window dragging, focus and z-order, menu bar that follows the front app, running-app dots, the Wallpaper window, the 3‑2‑1 countdown, flash, and filmstrip.

## 3. Goals, non-goals, anti-goals

**Goals**
1. A pixel-faithful macOS desktop: menu bar, Dock, wallpaper, windows, cursor, font.
2. A faithful Photo Booth: live mirrored camera, still / 4-up / video modes, countdown, flash, sounds, filmstrip, view and save, and **all 40 effects** in `EffectsOrdering.plist`.
3. A wallpaper picker using the real wallpapers.
4. Works in current Chrome, Edge and Firefox on Windows and macOS. Safari is a bonus.

**Non-goals.** Don't build these:
- Any other working app (Finder windows, Safari, etc.)
- Mobile or touch support
- Accounts, a backend, uploads, analytics
- About This Mac, Spotlight, Notification Center
- Multiple desktops

**Anti-goals.** Any of these counts as failure even if the site technically works:
- Anything that breaks the illusion at a glance: visible browser chrome, the Windows cursor, a non-SF font, placeholder icons, janky dragging, or a camera that drops below about 24 fps on a mid-range laptop.
- **Camera frames or photos leaving the browser.** No network request ever carries media. The camera starts only when Photo Booth opens, not on page load.

## 4. Environment facts (verified 2026-10-21 on the owner's Mac)

- **macOS 15.6.1 (Sequoia).** Photo Booth **13.1** is at `/System/Applications/Photo Booth.app`, with its executable at `Contents/MacOS/Photo Booth`.
- **REA:** `rea-agents` 6.7.0 runs through `npx`. It is **not registered with Claude Code** (the doctor reports `registration:claude_code` as missing).
  - **Hopper is installed** at `/Users/agahaciyev/Applications/Hopper Disassembler.app`, and that's enough to start.
  - Ghidra and IDA aren't configured. Don't install them unless Hopper can't answer something.
  - The skill directory `~/.claude/skills/reverse-engineer-anything` is a **symlink**, so setup must pass `--skill=false`.
- **Frameworks Photo Booth links** (from `otool -L`) hint at how it works: Vision (face tracking for face effects), Metal and OpenCL, SceneKit (`photofall.dae`), Quartz / Quartz Composer (`.qtz`), AudioToolbox and CoreAudio (sounds).
- **Photo Booth `Contents/Resources`** has 98 entries. The important ones:
  - Sound: `action.aif` (the only audio file in the bundle; its purpose is unknown).
  - Countdown art: `countdown-4up-{1,2,3}.tiff`, `countdown-cam.tiff`, `countdown-cam_dim.tiff`, `countdown-video.tiff`, `countdown-video_dim.tiff`.
  - Buttons: `shutterBtn_red_norm.tiff`, `movieBtn_red_norm.tiff`, `tools-button{Fill,Left,Right}-N.tiff`, `PB_share.tiff`, `PB_video.tiff`, `PB_video_sm.tiff`, `iconBtn_{iChat,iPhoto,Mail}.png`.
  - Effects: `EffectsOrdering.plist` (the 40 effect names, listed below), `Effect.qtz`, `Normal.qtz`, `fisheye.cikernel`, `mirroredge.cikernel`, `stretch.cikernel`, `thermalMap.png`, `xrayMap.png`.
  - Sprites: `bird{Small,Medium,Large}{0-3}.png` (Dizzy), `{small,medium,large}Heart.png` (Lovestruck).
  - Other: `silhouette.pdf`, `static.png`, `photofall.dae`, `photofall2.dae`, `Printings/`.
  - Strings: `Localizable.loctable`, `MainMenu.loctable`, `InfoPlist.loctable`, `LibraryChooser.loctable`, `ProfileSheet.loctable`, `Migration.loctable`. These are binary plists keyed by locale; take `en`.
  - Interface files: `Base.lproj/MainMenu.nib` and the other nibs.
  - `Assets.car` contains: `AppIcon`, `closeBtn`, `movieBtn`, `PhotoBoothLibrary`, `shutterBtn`, `stopBtn`.
  - There is **no `.icns` file**. The app icon exists only inside `Assets.car`; use the icon exporter below.
- **Effect order** (`EffectsOrdering.plist`): space alien, nose twirl, chipmunk, lovestruck, dizzy, blockhead, bug out, frog, sepia, blackandwhite, plasticcamera, comicbook, colorpencil, glow, thermalcamera, xray, bulge, dent, twirl, squeeze, mirror, lighttunnel, fisheye, stretch, cloakingdevice, popart, hologram, eiffel tower, fish, rollercoaster, sunset, yosemite, user backdrop 1–8.
- **Backdrop media** (eiffel tower, fish, rollercoaster, sunset, yosemite) is **not** in the bundle. Phase 2 must find where it lives.
- **Wallpapers** are in `/System/Library/Desktop Pictures/`:
  - Most entries are `.madesktop` stubs that point to downloadable assets.
  - Full `.heic` images on disk: `Sonoma.heic`, `Radial Sky Blue.heic`, and `iMac {Blue,Green,Orange,Pink,Purple,Silver,Yellow}.heic`.
  - Low-res previews (134 files) are in `.thumbnails/`.
  - The catalog of 71 downloadable wallpapers, with Apple CDN base URLs, is at `/System/Library/AssetsV2/com_apple_MobileAsset_DesktopPicture/com_apple_MobileAsset_DesktopPicture.xml`.
  - Downloaded ones land in `~/Library/Application Support/com.apple.mobileAssetDesktop/`, which is currently empty.
  - Easiest route: the owner opens System Settings → Wallpaper and clicks the ones they want, and macOS downloads them. Otherwise, fetch them from the catalog URLs.
- **App icons:** 36 apps in `/System/Applications` have `AppIcon.icns`. Some, like Photo Booth, keep the icon only in `Assets.car`. The **exporter below handles both** (tested: it produced a correct 256×256 Photo Booth icon).

### Tested icon exporter (JXA, macOS built-ins only)

```js
// tools/icon.js — usage: osascript -l JavaScript tools/icon.js <app-or-file-path> <out.png> [px=256]
ObjC.import('AppKit');
function run(argv) {
  const [path, out, px] = argv, size = Number(px || 256);
  const src = $.NSWorkspace.sharedWorkspace.iconForFile(path);
  const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, size, size, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
  $.NSGraphicsContext.saveGraphicsState;
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep));
  src.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, size, size), $.NSZeroRect, $.NSCompositingOperationCopy, 1);
  $.NSGraphicsContext.restoreGraphicsState;
  rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $()).writeToFileAtomically(out, true);
}
```

The same draw-into-bitmap approach should work for **SF Symbols**, via `$.NSImage.imageWithSystemSymbolNameAccessibilityDescription('wifi', null)`, and for the **macOS cursor**, via `$.NSCursor.arrowCursor.image` plus `.hotSpot`. This hasn't been tested yet; check the output.

---

## 5. Phases

### Phase 0: Get REA online (owner approval required)

1. Show the owner this command and what it changes: it adds an REA MCP entry to `~/.claude.json` and makes a backup first. Get a yes.
   ```bash
   npx -y rea-agents@latest setup --client claude_code --skill=false --dry-run --json
   npx -y rea-agents@latest setup --client claude_code --skill=false --yes
   ```
2. The owner restarts Claude Code.
3. Check that REA tools appear and that `binary_session {}` returns Hopper as available.

**Done when:** `binary_session` lists Hopper and `open_binary` is callable. If the tools still don't appear, look at the MCP launch error instead of re-running setup.

### Phase 1: Extract the assets

Write one idempotent script, `tools/extract-assets.sh`, that uses only macOS built-ins: `sips`, `iconutil`, `osascript` (JXA, with the exporter above), `plutil`, `afconvert`, `afinfo`, `assetutil` and `cp`. It writes to `public/assets/` and creates `public/assets/manifest.json`. Each manifest entry records the source path, the output path and the pixel size.

1. **Dock icons** as 256px PNGs, using the Sequoia default Dock:
   - Finder: `/System/Library/CoreServices/Finder.app`
   - Launchpad, Safari (`/Applications/Safari.app`), Messages, Mail, Maps, Photos, FaceTime, Calendar, Contacts, Reminders, Notes, Freeform, TV, Music, App Store, System Settings, iPhone Mirroring
   - **Photo Booth**
   - After the divider: the Downloads stack and Trash (empty and full). Find these in `/System/Library/CoreServices/Dock.app/Contents/Resources/`, or use the exporter on `~/.Trash`.
   - If an app is missing on this Mac, skip it and log it.
2. **Wallpapers:** convert `.heic` to JPEG with `sips -s format jpeg -s formatOptions 82 --resampleWidth 2880`, plus 320px thumbnails. For dynamic HEICs, the primary image is fine.
   - Default wallpaper: the Sequoia default if it can be obtained, otherwise Sonoma.
   - Ask the owner which others to include.
3. **Photo Booth resources:**
   - Convert TIFF and PDF images to PNG with `sips`.
   - Convert `action.aif` to AAC `.m4a` with `afconvert -f m4af -d aac`.
   - Convert `EffectsOrdering.plist` and the `en` part of each `.loctable` to JSON with `plutil -convert json`.
   - Copy the `.cikernel` files as text.
   - Convert the `.qtz` files to XML with `plutil -convert xml1` for study only; don't ship them.
   - Copy the sprites and map images as they are.
4. **Font:** copy `/System/Library/Fonts/SFNS.ttf` (variable SF Pro) and serve it through `@font-face`. It also gives the Apple logo glyph U+F8FF used in the menu bar.
5. **Menu-bar status icons:** render the SF Symbols `apple.logo`, `wifi`, `battery.100percent`, `switch.2` and `magnifyingglass` at 2× as PNG masks. Tint them in CSS with `mask-image`.
6. **Cursor:** export the arrow cursor at 1× and 2× with its hotspot, for CSS `cursor: image-set(...)`.

**Done when:**
- The script runs twice with no errors and no changes the second time.
- Every manifest entry exists with the expected size.
- The owner has looked at the icons and said they look right.

### Phase 2: Investigate Photo Booth with REA (mandatory)

- **Target:** `/System/Applications/Photo Booth.app/Contents/MacOS/Photo Booth` with the Hopper provider, via `open_binary`. Look at the resource files with format-aware tools (`plutil`, `afinfo`, text) next to the code.
- **Method:** follow the REA skill. Start with the overview or inventory, look for strings, selectors and functions, and follow each question from where it starts to where it ends.
  - Mark every conclusion as **observed**, **inferred** or **unknown**, and cite Evidence IDs.
  - Static analysis can't tell you how something feels, like countdown pacing. For those, ask the owner to run the real Photo Booth and confirm, or screen-record it.
  - Run `close_binary` when you're done.

Questions to answer, written into `docs/photobooth-findings.md`:

| # | Question |
|---|----------|
| Q1 | Countdown: how many ticks, how long each lasts, any sound per tick, which `countdown-*.tiff` is shown when, and how long and bright the screen flash is (including the "Enable Screen Flash" setting). |
| Q2 | Shutter: which sound file plays (`action.aif`? a system sound in `/System/Library/Components/CoreAudio.component/.../SystemSounds/`?) and at what moment. |
| Q3 | 4-up: the gap between the four shots, the layout of the combined image, and the output size. |
| Q4 | Video: maximum length (if any), the recording indicator, and how the stop button (`stopBtn`) behaves. |
| Q5 | Mirroring: the preview is mirrored, but are saved items? What's the default for "Auto Flip New Items"? |
| Q6 | **Every one of the 40 effects:** its kind (colour, distortion, face-tracked, backdrop, user backdrop) and how it's built. That means Core Image filter names with exact parameter values, which `.cikernel` it uses, how `thermalMap`/`xrayMap` are applied, how sprites are placed and animated, and which Vision face landmarks anchor it. Also the effects browser layout: a 3×3 grid with Normal in the centre, how many pages, and the page controls. |
| Q7 | Backdrops: where the eiffel tower / fish / rollercoaster / sunset / yosemite media lives, and how the "step out of the frame" flow works (`silhouette.pdf`, `static.png`). |
| Q8 | Window: default and minimum size, the preview's aspect ratio, toolbar and filmstrip sizes, and what changes in full screen. |
| Q9 | Menus: every menu title and item (`MainMenu.loctable` + `MainMenu.nib`). |
| Q10 | Saved photo: format, resolution and filename pattern (e.g. "Photo on 21-10-2026 at 14.32.jpg"). |
| Q11 | What `photofall.dae` / `photofall2.dae` animate (probably the photo dropping into the filmstrip). |
| Q12 | Any user-visible strings for errors such as no camera or permission denied (`Localizable.loctable`). |

**Done when:** every question is marked answered, partly answered or unresolved, with evidence, and the effects table has all 40 rows.

### Phase 3: Desktop shell

- **Stack:** Vite + vanilla JavaScript (ES modules), with no UI framework. Keep the file count small. Port the interaction model from `docs/reference/design-canvas.dc.html`.
- **Full screen:** on the first click anywhere, call `document.documentElement.requestFullscreen()` so the browser's own interface disappears. Before that click, set the tab title to "Photo Booth".
- **Menu bar:** Sequoia style (translucent and blurred, about 24px tall, SF Pro 13px). The Apple logo comes from the font or the symbol.
  - The app menus switch to whichever app is in front. Clicking a menu opens a real-looking dropdown with the real item names from the strings files.
  - Items do nothing, except Photo Booth → Quit Photo Booth, which closes the window.
  - Status items show the real symbols. The clock is live and formatted for the browser's locale using `Intl`.
- **Dock:** real icons and labels on hover. **No magnification**, which matches the macOS default. Icons darken while pressed, like real macOS. Clicking an app that doesn't work does nothing visible. Running dots appear under Finder and any open apps.
- **Windows:**
  - Drag by the title bar; windows can't go above the menu bar.
  - Clicking a window brings it to the front.
  - Traffic lights show their glyphs on hover. Red or yellow closes the window; green toggles full screen.
  - Photo Booth full screen covers the menu bar and Dock. The menu bar reappears when the pointer touches the top edge.
- **Wallpaper:** the System Settings Dock icon opens a System Settings window on the Wallpaper pane. Its sidebar is visible but only Wallpaper works, with a grid of the extracted wallpapers. The choice is saved in `localStorage` inside try/catch.
- **Cursor and font:** the macOS arrow cursor everywhere (macOS uses the arrow on buttons too), and SF Pro everywhere.
- **Gate:** if the viewport is narrower than 1024px or shorter than 640px, or the only pointer is coarse, show the "Grab a computer" screen.

**Done when:**
- In Chrome on Windows (or a Windows VM), in full screen, the owner can't spot a giveaway at a glance.
- Dragging, focus and z-order, and the traffic lights all behave.
- The wallpaper choice survives a reload.

### Phase 4: Photo Booth core

- **Camera:** `getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } })`, called when Photo Booth opens. Show the real Photo Booth error text (Q12) if permission is denied or there's no camera. Stop the camera tracks when the window closes.
- **Rendering:** video → WebGL canvas, mirrored. This pipeline is what makes effects possible in Phase 5.
- **Still photo:** countdown (Q1), flash, sound (Q2), then capture at the camera's full resolution from the effect canvas, and drop it into the filmstrip (Q11).
- **4-up** (Q3) and **video** with `MediaRecorder` (Q4). Video is WebM or MP4, whichever the browser supports.
- **Viewing and saving:** clicking a thumbnail shows it large in the preview area. The Share button **downloads** the file using the real naming (Q10). Going back returns to the live camera.
- **Library:** kept for the session only, in memory.

**Done when:**
- All three modes work in Chrome, Edge and Firefox.
- No network request carries media (check DevTools).
- A smoke run passes with Chrome's fake camera: `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`.

### Phase 5: All 40 effects

- **Effects browser:** the Effects button opens a 3×3 grid of live previews with Normal in the centre, with the paging from Q6. Render the tiles from one downscaled frame per tick to keep it fast.
- **Tier A, colour and stylize:** sepia, black & white, plastic camera, comic book, colour pencil, glow, thermal (`thermalMap.png` as a lookup), x-ray (`xrayMap.png`), pop art, cloaking device, hologram. These are GLSL shaders that recreate the filter chains found in Q6.
- **Tier B, distortion:** bulge, dent, twirl, squeeze, mirror (`mirroredge.cikernel`), light tunnel, fisheye (`fisheye.cikernel`), stretch (`stretch.cikernel`). Core Image's kernel language is close to GLSL, so port the kernels directly.
- **Tier C, face-tracked:** space alien, nose twirl, chipmunk, lovestruck (hearts), dizzy (birds), blockhead, bug out, frog. Use MediaPipe Face Landmarker (`@mediapipe/tasks-vision`), self-hosted with no CDN at runtime. Map the Vision landmarks from Q6 to MediaPipe's landmark indices.
- **Tier D, backdrops:** the five built-in backdrops (media from Q7) plus user backdrops 1–8, filled by dragging an image onto a slot. Use MediaPipe's selfie image segmenter instead of "step out of the frame". Keep that message only if the real flow needs it.

**Done when:**
- The owner compares each effect side by side with the real Photo Booth and accepts it.
- Tiers A and B hold at least 24 fps and tiers C and D at least 15 fps on a mid-range laptop.

### Phase 6: Polish and deploy

- **Polish:** open and close animations for windows, the full-screen transition, a right-click menu on the desktop with "Change Wallpaper…", and sound timing.
- **Repo:** public on GitHub, code only (session 7 changed this: the extracted assets are gitignored, not committed).
- **Deploy:** Cloudflare Pages, https://larpmacos.pages.dev, by direct upload of `public/`.

---

## 6. Calls made by the planner (the owner can override any of these)

1. The **Sequoia look** (macOS 15), because those are the assets actually on this Mac. A Tahoe / macOS 26+ look would need assets that aren't on this machine.
2. **Vite + vanilla JS** with no framework.
3. **Real browser full screen** on the first click, to hide the browser's interface. There's no fake boot screen.
4. **No Dock magnification** and no reaction when clicking apps that don't work.
5. Photos are **session-only** and saved by **downloading**.
6. **MediaPipe** handles face tracking and segmentation, self-hosted.
7. Assets are **committed** to the repo.

## 7. Testing

- Each phase's "Done when" list is the acceptance test. The owner signs off on the visual checks.
- One automated smoke test, only if it stays small: Playwright with the fake camera flags opens Photo Booth, takes a photo, and checks that the filmstrip has one item and the download starts.
- The asset script checks its own output against `manifest.json`.

---

## 8. Progress log

### 2026-10-21 — Phases 0 and 1

**Phase 0: done except the restart.** The owner approved setup. `~/.claude.json` now has `mcpServers.rea` (`npx -y rea-agents@6.7.0 mcp`, env `HOPPER_LAUNCHER_PATH`). Backup: `~/.claude.json.rea.backup.b9a1f4ff….recovery`. `doctor --client claude_code` reports the registration healthy and Hopper available. **The owner must restart Claude Code**; then check that `binary_session {}` lists Hopper before starting Phase 2.

**Phase 1: done. The owner signed off on the icons on 2026-10-21.**
- `tools/extract-assets.sh` writes 125 assets to `public/assets/` plus `manifest.json` (fields: `source`, `output`, `width`/`height` for images, and `name`, `default`, `scale`, `locale`, `hotspot` where relevant). It runs twice with no changes the second time and ends by checking every entry against the files on disk.
- `tools/img.js` is the JXA renderer (modes `icon`, `file`, `named`, `symbol`, `cursor`). It supersedes the `tools/icon.js` snippet in section 4.
- Wallpaper downloads are cached in `.cache/` (gitignored, about 560 MB). The JPEGs are what ship.

**Phase 1 facts the later phases need:**
- **Default wallpaper is Sequoia Sunrise** (`/System/Library/Desktop Pictures/.wallpapers/Sequoia Sunrise/`, 3840×2160), the owner's choice. The abstract "macOS Sequoia" wallpaper is drawn live by `WallpaperSequoiaExtension.appex` (Metal plus `.usdc` meshes) and has only 214×130 thumbnails on disk, so it isn't shipped.
- Wallpapers shipped: Sequoia Sunrise, Sonoma Horizon, Sonoma, Radial Sky Blue, iMac ×7, plus 10 from Apple's catalog: Big Sur, Monterey Graphic, Ventura Graphic, Catalina, The Beach, Peak, Dome, Iridescence, hello Blue, Studio Color. Most are square (2880×2880), so use `background-size: cover`.
- **The Calendar icon is static ("JUL 17").** The real Dock draws today's date, so Phase 3 must cover it with the live month and day.
- **`iconForFile` on an `.icns` returns the generic "ICNS" document icon.** `img.js` loads `.icns` contents directly. Trash and Downloads come from `CoreTypes.bundle` (`TrashIcon`, `FullTrashIcon`, `DownloadsFolder`).
- **Only `Localizable` and `InfoPlist` loctables have an `en` key.** `MainMenu`, `LibraryChooser`, `Migration` and `ProfileSheet` were exported as `en_GB`, which uses British spelling (e.g. "Minimise"). The US base strings are inside the `Base.lproj/*.nib` files, which are in `NIBArchive` format, not bplist. Q9 must get the menu titles from the nib.
- `MainMenu` `en_GB` already shows these items: Take Photo, Show Effects, Next/Previous Page of Effects, Reset Effect, Show Last Effect, Show Photo, Auto Flip New Items, Flip Photo, Start Slideshow, Trim Movie…, Export…, Export Original..., Delete All…, Enter Full Screen, and a `Camera` menu. The view labels are `CountDown`, `QTMovieCountDown`, `MovieRecording`, `LiveVideo` and `Still`.
- The Photo Booth TIFFs have 1× and 2× reps in varying order. `img.js` exports the 2× rep (`tools-button*` only has 1×).
- `Printings/1`, `Printings/2` are HTML print templates. They aren't shipped.
- The `.qtz` files were converted to XML for study in `docs/study/`; they aren't shipped.
- Arrow cursor: 17×23 pt, hotspot (4, 4).

### 2026-10-21 — Phase 2 (in progress, stopped at usage limit)

- REA is connected: `binary_session` lists Hopper as available. Photo Booth was opened with Hopper and the session was closed at the end.
- `docs/photobooth-findings.md` exists. **Answered:** Q1 countdown/flash and Q2 shutter = `system/Grab.aif`, system sound 24. **Partly answered:** Q3, Q4 and Q10. **Started:** Q6 has the class map. **Unresolved:** Q5, Q7, Q8, Q9, Q11 and Q12.
- Raw notes, the full procedure list and the string list are in `docs/study/phase2-ledger.md`, `pb-procedures.tsv` and `pb-strings.tsv`. Use them to grep addresses instead of re-dumping.
- Next: decompile each effect's `outputImage`/`processFace:` (addresses in `pb-procedures.tsv`), `_Create4UpImageFromImageArray`, `decode_interface_builder` for menus and window, then Q5/Q7/Q11/Q12. **Phase 3 not started.**
- Phase 4 notes: the countdown beep is a DLS-synth MIDI note (program 35, note 80, velocity 115, 0.4 s), so render it to an audio file. Add `Grab.aif` to `extract-assets.sh`.

### 2026-10-21 — Phase 2 continued (stopped again)

- **The REA MCP session is wedged.** Reopening Photo Booth timed out waiting for Hopper ("bridge readiness"). After that, `close_binary` and `open_binary` both fail with `cleanup_incomplete`.
  - The Hopper instance REA had launched (it had been running about 2.5 h) ignored Quit, so it was terminated with SIGTERM.
  - **Fix:** reconnect the `rea` MCP server (`/mcp` → rea → Reconnect, or restart Claude Code). Then check that `binary_session {}` shows nothing open before calling `open_binary`.
  - If Hopper shows a demo or license dialog, dismiss it.
  - The stale runtime dir `/tmp/rea-eV7zh7` (a temp copy of the Photo Booth binary) has already been deleted.
- **Fallback that works without the MCP:** the REA CLI. For example, `npx -y rea-agents@6.7.0 decode-interface-builder "/System/Applications/Photo Booth.app" --format json --full-output`. `rea decompile <path> <address> --snapshot <file>` should also work for Hopper decompiles.
- New answers in `docs/photobooth-findings.md`:
  - Q12 is answered.
  - Q8: the window is 720×540 (from the nib).
  - Q9: 9 menus and 51 items, but their order is still unknown.
  - Loading the nib with AppKit from JXA crashed (exit 139).
- **Next:**
  1. Q6: decompile each effect's `outputImage` / `processFace:forImage:`. Addresses are in `docs/study/pb-procedures.tsv`; start with `0x10003c1a4` Sepia, `0x10003c508` BW, `0x10003d33c` Plastic.
  2. Q3: `_Create4UpImageFromImageArray`.
  3. Q5, Q7, Q11, and the Q9 menu order.
  4. Then Phase 3.

### 2026-10-21 — Phase 3: desktop shell built (waiting on owner checks)

**Decision (owner asked why Vite):** no build step. The site is plain ES modules in `public/`, served as-is.
- Dev: `python3 -m http.server 8765 -d public`, then open http://localhost:8765. `localhost` is a secure origin, so the camera will work in Phase 4.
- Deploy: upload the `public/` folder.
- This overrides call #2 in section 6.

**Files**
- `public/index.html`
- `public/css/macos.css`: every look-and-feel value is a CSS variable at the top (`--dock-tile`, `--accent`, …) so it can be tuned against a real Mac.
- `public/js/app.js`
- `public/js/menus.js`

**What works**
- Gate (narrower than 1024 px, shorter than 640 px, or no fine pointer).
- Real browser full screen on the first click, re-entered after Esc. Chrome also locks Esc, so it has to be held to leave.
- Right-click is blocked.
- Live clock formatted with `Intl` in the browser's locale.
- Menu bar text turns white or black depending on the wallpaper behind it.
- Menu bar menus for Finder, Photo Booth and System Settings, plus the Apple menu. Click to open, hover to switch, Esc or a click outside to close, and the chosen item blinks.
  - Only "Quit Photo Booth" and Apple menu → "System Settings…" do anything.
- Windows: drag by the title bar (stops at the menu bar), click to bring to front, active and inactive styles.
  - Traffic lights show glyphs on hover. Red and yellow close the window. Green toggles Photo Booth full screen.
  - In full screen the menu bar and title bar slide in from the top edge, and the Dock is hidden.
- Dock: the real icons. A label shows on hover, the icon darkens while pressed, and running dots appear under Finder and open apps.
  - Photo Booth and System Settings bounce when they launch; the other icons do nothing.
  - The Calendar icon is repainted with today's month and day.
- System Settings: a Sequoia-style sidebar with the **real pane icons** (26 icons pulled from `/System/Library/ExtensionKit/Extensions/*.appex`; General and Battery are drawn from SF Symbols).
  - The Wallpaper pane works, and the choice is saved in `localStorage` (wrapped in try/catch).

**Asset script additions**
- `settings/*.png` (sidebar icons)
- New SF Symbols
- `photobooth/shutter.m4a` (Grab.aif, the real shutter sound)
- Safari's icon is now taken from the real path, so it no longer has an alias arrow.
- 156 assets; the script still runs twice with no changes.

**Check:** `node tools/shot.mjs .cache/check.png "$(cat tools/check-shell.js)"` drives headless Chrome over CDP. It covers opening a window, dragging it into the menu bar (stops at 24 px), Quit, running dots, and saving and applying a wallpaper. It passes.

**Inferred (owner please compare with a real Mac)**
- New-Mac defaults: Light appearance, Dock tile 48 px.
  - Owner's own Mac: Dark, 66 px, magnification on.
- Menu and selection colours, corner radii, and spacing.
- Finder and System Settings menu contents.
- Wallpaper section split ("Dynamic Wallpapers" vs "Pictures").
- Photo Booth window chrome is dark.

**Still open for Phase 3 "Done when"**
- Owner checks it in Chrome on Windows in full screen.
- The 8 MB `SFNS.ttf` should become WOFF2 in Phase 6.

### 2026-10-21 — Phase 4 built, Phase 5 started (waiting on owner checks)

Session rule from the owner: **no binary analysis** (no Hopper, REA decompiling or disassembly). Everything new came from `docs/study/*.qtz.xml`, the `.cikernel` files, the strings, `docs/study/pb-nibs.rea.json` and the extracted images. New facts are in `docs/photobooth-findings.md` (Q1, Q3–Q6, Q8, Q12), labelled observed / inferred / unknown. Highlights: the full toolbar and tray geometry from the nib, the mode-button SF Symbols, Effect.qtz decoded (it's a host: `Flip` = true, slider and X/Y default 0.5), Normal.qtz = identity, the Core Image filters each effect names, and a 40-row effects table.

**Files**
- New: `public/js/photobooth.js` (all of Photo Booth), `public/js/effects.js` (effects as GLSL snippets plus display names), `tools/check-photobooth.js`, `tools/shot-firefox.mjs` (headless Firefox over WebDriver BiDi).
- Changed: `public/index.html` (Photo Booth markup and script tag), `public/css/macos.css` (Photo Booth section), `public/js/app.js` (File → Take Photo), `tools/shot.mjs` (fake camera and mic, the JS runs as a user gesture, page errors are printed, `FAKE_VIDEO=<file.mjpeg>` feeds an image as the camera), `tools/extract-assets.sh` (6 more SF Symbols; 162 assets, a second run changes nothing).

**What works (Phase 4)**
- The camera starts on the window's `open` event and stops on `close`; the toolbar stays disabled until frames arrive. Errors show the real strings (Q12).
- Preview: video → WebGL texture → effect shader. Mirrored, and cropped to the nib's 3:2 preview at full camera height (1280×720 → 1080×720). Photos are taken from that canvas, so they carry the effect.
- Modes 4-up / still / movie. Countdown with the real timing (0.5 s lead-in, beeps and numerals at 0.5, 1.3 and 2.1 s, shot at 2.9 s; the check measures it). Option skips the countdown, Shift skips the flash.
- Flash: full-screen white, 0.04 s in, 0.2 s hold, 0.24 s out. Shutter `shutter.m4a` (Grab.aif). Movies play `action.m4a`, then record.
- **Countdown beep is a stand-in**: Web Audio additive synth at MIDI note 80 for 0.4 s, not the DLS Fretless Bass sample (see Q1).
- 4-up: four shots 0.24 s apart, the countdown disc fills by quarters, then a 2×2 JPEG the size of one frame.
- Movie: `MediaRecorder` on the canvas plus the mic (asked for when movie mode is picked). The stop button is locked for 3 s without dimming, and a `00:00:00` timer runs.
- Tray over the bottom 62 px of the preview. Clicking a thumbnail shows it (movies play) and swaps Effects for Share; clicking it again or Esc goes back to live. Share downloads it under the real name (`Photo on … at ….jpg`, `4-up on …`, `Movie on … .mov` for MP4 or `.webm` in Firefox, with ` #2` on repeats). The library lasts for the session.
- File → Take Photo, plus ⌘↩ / Ctrl+↩.

**Phase 5 started**
- Effects button → a 3×3 browser of live tiles, Normal in the centre, 8 effects per page in `EffectsOrdering.plist` order (5 pages), with arrows and page dots in the toolbar. Tiles for effects that aren't built are dimmed and can't be clicked.
- Built: **Normal**, plus **Fish Eye**, **Stretch** and **Mirror** ported from the `.cikernel` files. Their parameter values live in the binary, so the ones used are stand-ins (findings Q6).
- Everything else on the list needs values from the binary, or tuning by eye against the real app. Thermal and X-ray are the closest to defined (a `CIColorMap` with `thermalMap.png` / `xrayMap.png`).

**Checks** (server: `python3 -m http.server 8765 -d public`)
- `node tools/shot.mjs .cache/check-pb.png "$(cat tools/check-photobooth.js)"`: **passes in Chrome.**
- `node tools/shot-firefox.mjs .cache/check-pb-ff.png "$(cat tools/check-photobooth.js)"`: **passes in Firefox 157.**
- The check covers: no camera before opening; the camera starting; the shot at 2.9 s; the flash; the tray; view and back; the download name; 4-up size; the movie's 3 s lock and name; the effects browser page 3; tracks stopped on close; closing mid-countdown cancelling the shot; nothing loaded from another host; no page errors.
- `check-shell.js` still passes.
- Edge isn't installed (it's Chromium, like Chrome), so it's untested. Safari is untested.
- Run the two `shot` tools one at a time: each uses a fixed debugging port.

**Owner, please compare with the real Photo Booth** (all inferred):
- Countdown look: font size, spacing, icon size.
- The 4-up gap (0.24 s; it may really be 0.72 s if the flash call blocks; knob `SHUTTER_DELAY`).
- Flash curve.
- Stop-button look.
- Thumbnail size and selection ring.
- Effects button style, browser gaps and labels, and where the page dots sit.
- Whether real saved photos are mirrored (Q5).
- The 3:2 crop.
- Headless runs can't hear anything, so listen to all three sounds.

**Next**
1. Owner checks the above, plus the Phase 3 checks still open.
2. Phase 5: decide whether a later session may decompile `outputImage` / `processFace:` for parameter values. Otherwise tune by eye.
3. Phase 6: the full-screen `fs-*` UI, page-slide animation, photofall.

### 2026-10-21 — Session end: decisions, real-app measurements, cursors (nothing else built)

- **The owner's decisions.**
  - Effects: build the easy-by-name ones directly; use REA for exact values and the hard ones.
  - Version control: done. `git init` on `main`, with one initial commit of everything.
  - The owner wants a new-chat prompt whenever context gets heavy.
- **Asset script:** it now exports the macOS 15 window-resize cursors (`NSCursor frameResizeCursorFromPosition:inDirections:`) as `cursor/resize-{ew,ns,nwse,nesw}.png` plus `@2x`, hotspot (9, 9). There are 170 assets, and a second run changes nothing. `tools/img.js` takes `cursor <out> <scale> <position>`.
- **The real Photo Booth, observed from the owner's screenshot** (`~/Desktop/Screenshots/Screenshot 2026-10-21 at 22.56.16.png`; window resized to about 956×723 pt):
  - Geometry:
    - The preview stays **3:2** when resized (956×637 pt). Toolbar 60 pt, tray 62 pt over the preview's bottom edge.
    - Thumbnails are about **89×59 pt** (they fill the tray height), with square corners and no ring.
    - The tray is **right-aligned**: one item sat about 19 pt from the right edge.
    - A movie thumbnail shows the video badge bottom-left and its length **"00:07"** bottom-right, in white.
  - Colours, sampled in screenshot space; compare against `Screenshot … 22.55.41.png` of our site, which went through the same pipeline:

    | Element | Real | Ours |
    |---|---|---|
    | Title bar | `#3b3d3e` | `#2d2d2d` |
    | Toolbar (flat in the real app, no gradient) | `~#2f2f2f` | `#232325` |
    | Effects button | `#71716f` | `#4d4d4f` |
    | Selected segment | `#767a78` | `#6d6d6e` |
    | Segment background | `#3a3c3a` | `#3a3a3c` |
    | Shutter | `#ec5d4e` | `#eb4e3d` (same asset) |

    The real shutter is lighter; how `PBShutterButton` draws it is unknown, so ask REA.
  - Still unknown: thumbnail spacing, whether the tray shows when empty, and the minimum window size.
- **Seen in a headed-Chrome test:** if WebGL is unavailable, `photobooth.js` crashes at load (`gl` is null); task 1 fixes this. A window under 1024×640 shows the "Grab a computer" gate, which is expected.

### 2026-10-21 — Session 2: window tasks done, real chrome matched, effect values pulled (no effects built)

Work happened in the worktree branch `worktree-pb-resize-effects` (4 commits on top of `ffdf448`). Merge it into `main` from the main checkout with `git merge worktree-pb-resize-effects`.

**Built**
- **Full screen on `click`** (not `pointerdown`). Without WebGL, opening Photo Booth shows "Photo Booth can’t start / Turn on hardware acceleration in your browser’s settings." (our text; Apple has none) and never asks for the camera. Checked with Chrome's `--disable-3d-apis`.
- **Resizable Photo Booth** (`app.js`): document-level hit test (the window clips its children), 4 px grab zone either side of the border, 12 px corners, the macOS 15 resize cursors (`html[data-resize]`), height = width / 1.5 + 88, min width 480 (inferred), opposite edge anchored, the top can't go under the menu bar. `check-shell.js` covers corner, left edge, top edge at the menu bar, min width and no cursor inside.
- **Real chrome** (REA + the owner's screenshot, details in findings Q8):
  - The toolbar is a behind-window blur of the desktop (`PBTextureView` = NSVisualEffectView, material 21). The window is transparent behind it, the bar uses `backdrop-filter`, and the tint `rgba(46,46,46,.82)` was fitted by eye.
  - The tray is a within-window blur; thumbnails are 88×58, 3 px apart, right-aligned 19 px from the edge, with square corners. Movies show their length ("00:07") bottom-right.
  - The shutter is drawn, not a bitmap: a 50 px `#ff4f44` disc with a white Assets.car glyph 2 px above centre. It turns grey (with a ring) while viewing an item, white with a red stop glyph while recording, and goes 50 % darker when pressed.
  - Title bar `#3b3d3e` with a hairline; segments and Effects button sizes and alphas measured; Share uses `NSShareTemplate` (new asset; `img.js` gained a `system` mode; 171 assets, a second run changes nothing).
  - The window drags by its toolbar (`movableByWindowBackground`).
- Shot tools take `URL=`; `check-photobooth.js` checks resources against `location.origin`.

**Checks:** `check-photobooth.js` passes in Chrome and Firefox; `check-shell.js` passes in Chrome (all run against the worktree on port 8766).

**Pulled from the binary, not built yet** (findings, "Effect parameters from code"): exact CI chains and numbers for Sepia, B&W, Glow, Thermal, X-Ray, Bulge, Dent, Twirl, Squeeze, Light Tunnel; `sliderRadius` = slider × diagonal; slider default 0.5; every distortion first runs mirroredge over the frame. The `CIColorControls` numbers only make sense with Core Image's own maths, hence the LUT-bake plan in the prompt.

**Notes**
- REA lock: another, older Claude session (CLI PID 93519, its REA server node PID 93649) still holds the Hopper lock on Photo Booth's path. It was left alone; the copy-the-binary workaround is in the prompt.
- A Hopper process (PID 62350) was still running at the end; it may belong to another session, so it was left running.
- **Owner, please compare with the real app:** toolbar tint over a few wallpapers, the Share icon size (13×16, inferred), the selection ring on a tray thumbnail (unknown), and the minimum window size (480 wide, inferred).

### 2026-10-22 — Session 3: 15 effects match Core Image, slider and centre point built

**Built** (commits `74f00be`, `b398a27`, `7e34e22`, `2cc0120` on `main`)
- **Effects pipeline:** `effects.js` entries can be multi-pass (`{glsl, lut, out}`, `{blur, sigma, out}`); `photobooth.js` gained LUT textures (`public/assets/photobooth/lut/*.png`, loaded when Photo Booth opens), render targets per size, and a Gaussian blur (k×k block average, then a separable Gaussian at 1/k size) in linear light with transparent edges like Core Image. Distortions use `edge()` = `mirroredge.cikernel`.
- **Effects:** Sepia, Black And White (LUT + Core Image's `_vignette`), Glow (LUTs + gloom/bloom passes; buffers hold (linear + 0.1α)/2.6 because Core Image doesn't clamp), Thermal Camera, X-Ray (blur mix + LUT), Bulge, Dent, Twirl, Squeeze, Light Tunnel, plus exact values for Mirror (`CIKaleidoscope` count 1), Fish Eye and Stretch.
- **Slider** (`.pb-slider`): Photo Booth's 240×49 pill with the dots, shown on pointer move over the live preview for the five slider effects and hidden 1 s after the pointer stops; dragging on the preview moves the effect centre; View → Reset Effect resets both. Each effect keeps its own values (inferred).
- **Tools:** `tools/ci.js` (lut / ref / diff), `tools/check-effects.sh` + `.js`, `tools/cikernel.py`; `shot.mjs` takes `JSON=<file>` to save the script's return value. 177 assets; the asset script still runs twice with no changes.

**Checks:** `check-photobooth.js` (now also the colour page and the slider) passes in Chrome and Firefox; `check-shell.js` passes; `check-effects.sh` passes for all 14 effects (mean error per channel 0.12–1.94 out of 255; Glow is the largest).

**How the exact maths was found:** Core Image's kernel sources are plain strings in the dyld shared cache (`tools/cikernel.py`); the parameter mapping was measured with JXA (findings, "Core Image's own maths").

**Owner, please compare with the real Photo Booth**
- Whether the effect runs on the mirrored frame: the build mirrors first, so Twirl turns one way and Mirror keeps the left half *of the preview*. If the real app mirrors after the effect, both flip.
- The slider's look (accent-blue fill and white knob are inferred) and its fade.
- X-Ray's blur strength (5 px assumed on a 720-line frame).


### 2026-10-22 — Session 4: Plastic Camera, Comic Book, Color Pencil built; the real effect list is 24

Work is on branch `worktree-effects-s4` (commits `bf3f41d`, `6adbff3`, `3e2e177`, `586fa85`, plus this handoff) on top of `5d6d8e3`. Merge it into `main` from the main checkout.

**Built** (every value from REA; each checked against a Core Image render with `tools/check-effects.sh`)
- **Plastic Camera** (mean 0.05/255): one closed-form pass. Measured: `CISpotLight` passes normalize(position − pointsAt), colour × brightness and 1/concentration to `_spotLight`; `CIColorMatrix` unpremultiplies, keeps alpha unclamped (the cyan bias makes alpha 1.25, which brightens the result by 1.25); **`CIColorControls` is plain affine maths in linear light** (Rec. 709 luma).
- **Comic Book** (mean 0.19): `_posterizedImage` (CIHighlightShadowAdjust 19 / 1.5 / 1 → CIColorControls 1.7 / 0.2 / 1.5 → CIColorPosterize 12), `_monoHalftone` (CIColorMonochrome → CISpotColor → CIDotScreen, width 10 × H/720, or 15 in the browser), `_monoOutline` (CIUnsharpMask 6.283 → CIColorControls 0 / 0.8792 / 2.54 → CISpotColor step), combined by blend-with-mask × overlay. Two blur passes plus one shader. CIHighlightShadowAdjust = `_highlightsAndShadows2` with the image's own Gaussian blur (sigma = radius) and the shadow amount clamped to 1.
- **Color Pencil** (mean 0.42): colorize (CISpotColor dodged over CIColorControls) × pencil shading, then CIColorControls 0.7 / 0.2995 / 2.131. The shading (static.png tiled, CIMotionBlur 17 at 33°, greyed) never sees the camera, so `tools/ci.js lut … pencil` bakes one 640×480 period with Apple's filters (`lut/pencil.png`; 178 assets, a second run of the asset script changes nothing).
- **Effects browser = 24 effects, 3 pages.** `-[RendererController effectList]` is the face, colour and distortion classes only. Pop Art, Cloaking Device, Hologram and the five backdrops (and user backdrops) are never loaded; no compositions or media for them exist on this Mac; `EffectsOrdering.plist` is a leftover the binary never names. The build dropped them (Q6, Q7 in the findings).
- `photobooth.js`: `uPreview` uniform (1 for browser tiles). `effects.js`: entries for the three new effects; dead backdrop names removed.

**Tools:** `tools/ciprobe.js` reads Core Image's raw working-space values at pixels (how every mapping above was measured); `tools/ci.js` gained `comicbook`, `colorpencil` references and the `pencil` bake.

**Checks:** `check-effects.sh` passes for all 16 effects (mean 0.12–1.94/255; Comic Book and Color Pencil have isolated pixels where a threshold flips); `check-photobooth.js` passes in Chrome and Firefox and now checks 3 pages; `check-shell.js` passes; the asset script is idempotent.

**Owner, please compare with the real Photo Booth**
- Plastic Camera, Comic Book (dot size on a 720-line frame; the browser tile uses the bigger preview dots) and Color Pencil, side by side.
- That the real effects browser has 3 pages.
- Plastic Camera's 1.25 × brightening follows from Core Image keeping alpha 1.25 and Effect.qtz's `multiplyEffect` keeping the premultiplied colour; whether the live view does the same wasn't traced.

**Notes:** Hopper went unreachable once after a long `search_strings`; `close_binary` + reopen fixed it. The REA session was closed at the end.

### 2026-10-22 — Session 5: the 8 face effects decoded and built; Phase 6 started

Work is on branch `worktree-face-effects-s5` (commits `452cc1b`, `e369d8d`, `8643384`, `ec1985c`, plus this handoff) on top of `b40b966`. Merge it into `main` from the main checkout. (Session 4's branch was already in `main`.)

**Decoded with REA** (findings, "Face effects"): Vision `VNTrackLegacyFaceCoreObjectRequest`, up to 3 faces; PBFace keeps FaceCore's points normalized, radius = half the box width ÷ image width, angle from the eye line, eyeAmount = 1.2 × radius; `PBEffectSmoothener` (a dead band, then a linear catch-up over 50 ms for most values; eyes snap in 20 px steps); every effect's exact maths: Space Alien (eyes 0.5, mouth −0.6), Nose Twirl (a CITwirlDistortion, not a bump), Chipmunk and Blockhead (eye bumps moved to the cheeks / forehead by blocks), Bug Out, Frog (+ chin bump), Lovestruck (12 hearts per face, waves, re-drawn start points) and Dizzy (7 birds on an ellipse, `_verticalDevs`).

**Built**
- `public/js/faces.js`: MediaPipe Face Landmarker (`@mediapipe/tasks-vision` 1.1.0, model `face_landmarker.task` float16 v1), self-hosted in `public/vendor/mediapipe/` (16 MB, 13 MB of it wasm), loaded on first use (GPU delegate, CPU fallback), run once per new camera frame while a face effect or the browser's first page shows. The eight `processFace:` ports, PBFace's smoothers, and a sprite atlas built at runtime from the bundle's hearts and birds.
- `effects.js`: a bump-chain shader (5 effects), a twirl shader, a sprite-compositing shader. `photobooth.js`: `uFace` / `uCount` uniforms, face tracking in the frame loop, the atlas uploaded premultiplied.
- **Privacy:** MediaPipe's usage logger posts to `odml.pa.googleapis.com/v1/log` every 60 s; the vendored bundle is patched so it never sends, and `index.html` now has `Content-Security-Policy: connect-src 'self'`.
- **Phase 6:** windows fade and scale in and out (CSS `@starting-style` + `transition-behavior: allow-discrete`; Firefox doesn't transition `display`, so there a window closes at once); right-clicking the desktop shows Finder's desktop menu, and Change Wallpaper… opens System Settings.
- Tools: `check-effects.sh` has a face pass (it downloads Jessica Watkins' public-domain NASA portrait into `.cache/faces/` and crops it with the new `ci.js crop`); `ci.js ref` takes the parameters the page drew with for face effects; `check-shell.js` checks the fade and the desktop menu.

**Checks:** `check-effects.sh` passes for all 24 effects (face effects mean 0.01–0.08 / 255 against Core Image's chain from the same parameters); `check-photobooth.js` passes in Chrome and Firefox; `check-shell.js` passes in Chrome. Headless Chrome: 45–50 fps with a face effect, 50 fps with the 8 face tiles. MediaPipe also tracks in headless Firefox (fed a still through a canvas; Firefox's fake camera has no face).

**Not done:** SFNS.ttf → WOFF2 (`fonttools` lacks `brotli`), browser page-slide and mosaic animations, photofall, full-screen transition, deploy.

**Owner, please compare with the real Photo Booth**
- All eight face effects side by side, with your own face: bump sizes (Space Alien's eyes and mouth, Bug Out, Frog's chin, Chipmunk's cheeks, Blockhead's forehead), Nose Twirl's direction, the hearts' and birds' height above the head and size.
- Whether hearts briefly appear at the bottom-left corner when Lovestruck starts: the decoded code starts each heart at (0, 0) until its first 1.3 s cycle wraps, and the build does the same.
- The window open and close fade, and the desktop right-click menu's items (taken from memory of macOS 15).

### 2026-10-22 — Session 6: effects-browser motion, photofall, full-screen transition, WOFF2

Session 5's branch was fast-forwarded into `main` first (`0209106`). This session's work is on branch `worktree-phase6-s6` (commits `0a01376`, `7761141`, `2bc3315`, `a89c7b3`, plus this handoff) on top of `0209106`. Merge it into `main` from the main checkout. No face-effect feedback had come in, so `faces.js` is unchanged.

**Decoded with REA** (findings: "Effects browser", Q11, Q8 "Full-screen transition")
- **Browser:** `PageLayer` margins and gaps are all 3; pages sit side by side and slide by `sublayerTransform` (ease-in-out, 0.6 s + 0.25 s per extra page); opening / closing zooms the effect's tile between its slot and the whole view in 0.25 s while the others fade (Core Animation's default timing = CSS `ease`, measured from JXA); Shift doubles every duration; the arrows wrap and are never disabled; a sideways scroll turns a page; labels are system 18 pt, white, no shadow, 10 px up, top of a 50 px box.
- **Photofall:** `-[PBTrayView appendNewAsset:]` hides the new cell; 0.2 s later `_do3DAnimation:` plays `photofall2.dae` (51 keys of the photo's Z only, so a straight drop with two bounces) in an SCNLayer over the cell, and shows the cell again at 1.75 s. `photofall.dae` is behind a hidden default; `_do2DAnimation:` and `startFlyingAnimationForImage:duration:` are dead code.
- **Full screen:** Photo Booth uses AppKit's stock animation (no custom-window hooks; `+fullScreenTransitionDuration` unused); it only drops the shadow and loosens its size constraints.

**Built**
- `photobooth.js` / `macos.css`: 27 tiles placed with PageLayer's maths in CSS `calc()`, the slide and zoom as CSS transitions, `drawTiles()` following each button's animated box and opacity (constant-alpha blend); wheel paging; photofall (`fall()`, Web Animations) replacing the inferred fade.
- `app.js`: the full-screen transition (window FLIP from its frame, desktop sliding left over black; 0.5 s, judged). The Dock no longer vanishes in full screen (the window covers it).
- `SFNS.woff2` (2.75 MB) replaces `SFNS.ttf` (8.3 MB); `extract-assets.sh` makes it with `PY=<python with fonttools + brotli>` when missing; 178 assets, a second run changes nothing.
- Checks: `check-photobooth.js` covers tile geometry, the zoom, wrapping arrows and photofall; `check-shell.js` the full-screen transition; `check-effects.js` waits for the animations.

**Checks:** `check-photobooth.js` passes in Chrome and Firefox; `check-shell.js` passes in Chrome; `check-effects.sh` passes for all 24 effects (unchanged numbers).

**Owner, please compare with the real Photo Booth**
- Effects browser: the zoom when opening and closing, the page slide, and especially the **label height** (the build puts the text about 60 px above a tile's bottom, from CATextLayer's top-aligned drawing).
- Photofall: a new photo dropping into the tray with two small bounces.
- The green button: how long the real full-screen animation takes and whether the desktop slides left as the build shows.

**Notes:** Hopper went unreachable once mid-batch; `close_binary` + reopen fixed it. The REA session was closed at the end.

### 2026-10-23 — Session 7: deployed; public, code-only repo

Session 6 was fast-forwarded into `main` first (`1d18c5f`).

**Owner's calls:** the repo goes **public** on GitHub for a portfolio, **code only**; the site is hosted on **Cloudflare Pages** on the free subdomain.

**Repo**
- `.gitignore` now drops `public/assets/` and `docs/study/`; `README.md` added (what it is, the live link, how to extract the assets and run the checks, credits).
- Because every earlier commit carries the assets, the public history starts fresh: branch `public-main` is one parentless commit (`0992006`) with the same code and no assets (27 files). This session's work is on branch `worktree-public-repo` on top of it.
- **The owner runs this from the main checkout** (it moves nothing on disk; the assets stay, now untracked and ignored):
  ```sh
  git branch private-history main          # old history with the assets, local only
  git reset --mixed worktree-public-repo   # main = clean history + session 7
  git checkout -- .gitignore README.md HANDOFF.md tools/check-shell.js
  git status --short                       # expect nothing (.claude/ is ignored now)
  gh repo create larpmacos --public --source . --remote origin --push
  ```

**Deploy**
- Pages project `larpmacos` (account of agha.hajiyev@yahoo.com), created with `--force` because wrangler 4.152 now tries to move Pages projects to Workers and that path failed. Uploaded `public/` (190 files, 45 MB): https://larpmacos.pages.dev.
- Live: HTTPS, `.wasm` as `application/wasm`, the CSP meta tag intact, the font as `font/woff2`.

**Checks against the live site:** `check-photobooth.js` passes in Chrome and Firefox; `check-shell.js` passes in Chrome; `check-effects.sh` passes for all 24 effects. `check-shell.js` first failed at "wallpaper choice saved": the choice is saved after the 1.8 MB wallpaper decodes, which took longer than its fixed 0.8 s wait off localhost. It now polls for up to 10 s. The app is unchanged.

**Later the same day:** the owner published the repo (`origin` = `git@github.com:HaciyevAga/larpmacos.git`, `main` at `13fbf50`, `private-history` kept locally). Added `tools/deploy.sh` (above) and a Deploy section in `README.md`; `.wrangler/` is ignored. Tested with a preview deploy of this branch: both checks passed at https://worktree-public-repo.larpmacos.pages.dev.

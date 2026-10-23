# Photo Booth findings (Phase 2, REA + Hopper)

Target: `/System/Applications/Photo Booth.app/Contents/MacOS/Photo Booth` (Photo Booth 13.1, macOS 15.6.1), arm64 slice, sha256 `73ed6688519d0336d391a34016ce81842f63b30b7aac158a7bca561c30576028`. REA 6.7.0, provider Hopper (Ghidra/IDA not configured).
Base evidence: overview `ev_82cf204a…` (7273 procedures, 4395 strings), strings `ev_73373653…`, procedure list `ev_1993885f…`.

Labels: **observed** = read directly from code/constants/resources; **inferred** = reasoned from observed code; **unknown** = not established. Static analysis does not show how things feel at runtime; items marked "confirm" need the owner to watch the real app.

## Status

| Q | Status |
|---|--------|
| Q1 Countdown + flash | **answered** (flash curve semantics inferred) |
| Q2 Shutter sound | **answered** |
| Q3 4-up | **partly answered**: timing and file output known; layout and size of the combined image not traced yet |
| Q4 Video | **partly answered**: start sound, container and stop-button lock known; recording indicator visuals not traced |
| Q5 Mirroring / Auto Flip | **partly answered**: Effect.qtz mirrors with `Flip` = true by default; whether saved items are flipped and the `AutoFlipPhoto` default are unknown |
| Q6 40 effects | **mostly answered**: Photo Booth 13.1 loads only **24** effects (8 face, 8 colour, 8 distortion; session 4). All 16 colour/distortion effects are built with exact values and checked against Core Image. Pop Art, Cloaking Device, Hologram and the backdrops are never loaded. Face effects decoded and built (session 5); browser layout and motion decoded (session 6) |
| Q7 Backdrops | **answered (negative)**: not loaded by Photo Booth 13.1 and no backdrop media on this Mac (session 4) |
| Q8 Window | **mostly answered**: nib frames, toolbar and tray materials, tray cell layout, shutter drawing, 3:2 sizing rule; min size and full-screen layout unknown |
| Q9 Menus | **answered** for titles and shortcuts; order within menus inferred |
| Q10 Saved photo | **answered** for filename and format; pixel size not traced |
| Q11 photofall.dae | **answered** (session 6): the new tray cell drops in with `photofall2.dae` |
| Q12 Error strings | **answered** |

## Q1 Countdown: observed

Evidence: `ev_0561e9fe…` (decompiled countdown/flash classes), `ev_f589db15…` (asm `-[PBCountdownController delayCountDownStart]`), `ev_fbced4bb…` (asm `start`), `ev_175d6266…` + `ev_1b91b260…` (double constants), `ev_f729d6db…` + `ev_354e3327…` (`PBNotePlayer`), `ev_a2e11a30…` (`takeSnapshot:` / `recordWithCountdown:`).

- `+[PBCountdownController countdownStepCount]` returns **3**.
- `start` posts `PBCountdownControllerCountdownWillBeginNotification`, resets the view (counter 4, so nothing is lit), prepares the note player, then calls `delayCountDownStart` after **0.5 s**.
- `delayCountDownStart` lights **"3"** right away. With T = the moment it runs:
  - Beeps start at **T+0, T+0.8, T+1.6 s** and each lasts **0.4 s** (constants `0x10006da38`=0.8, `0x10006d880`=0.4).
  - The highlight moves to **"2" at T+0.8** and **"1" at T+1.6**. At **T+2.4** the camera icon lights (counter 0) and `countdownFinished` fires, which triggers the capture.
  - Measured from the click: lead-in 0.5 s, first beep at 0.5 s, shot at **2.9 s**.
- **The beep isn't a sound file.** `PBNotePlayer` drives the Apple DLS MIDI synth (`aumu`/`dls `) into the default output (`auou`/`sys `). It sends bank 0, **program 0x23 (GM 35, 0-based)**, **note 80.0 (G#5)** and **velocity 115**. Phase 4 should render this note offline with AVAudioEngine and the DLS synth and ship it as `countdown-beep.m4a` (inferred approach).
  - **Phase 4 ships a stand-in instead**: `beep()` in `public/js/photobooth.js` synthesises the note with Web Audio (830.6 Hz, sine plus 2nd–4th harmonics, bass-like decay, 0.4 s then release). It is *not* the DLS sample; replace it with a rendered file if one is made on the Mac.
- **Countdown art (observed from the images):** `countdown-4up-1/2/3` are the camera disc with 1, 2 and 3 quarters lit. *Inferred:* during the four 4-up shots the view shows `countdown-cam` for shot 1, then `countdown-4up-1…3`, i.e. one quarter per shot taken.
- Countdown view (`PBCountdownView`): it draws the three localized numerals "3", "2", "1" with the system font. The current one uses the normal attributes and the others use the dim attributes. It shows `countdown-cam` when counter is 0 and `countdown-cam_dim` otherwise. Video mode swaps in `countdown-video` (`-[PBQTMovieController countdownCameraImageName]`, `ev_1aa34eec…`). In 4-up, `setCameraFrame:` steps through frames, which presumably maps to `countdown-4up-{1,2,3}` (inferred; not traced).
- Modifiers, from `-[PBApplicationControl takeSnapshot:]`: **Option** (`0x80000`) takes the shot immediately with no countdown. **Shift** (`0x20000`) skips the flash.
- Cancel: `-[PBCountdownController cancel]` invalidates every timer, stops the note and posts `…CountdownCancelledNotification`.

**Flash**
- `+[PBCameraFlash defaultFlash]` is `initWithParameter:(0.04, 0.2, 0.24, 1.0)` (`ev_a3250372…`, `ev_47fc979e…`, `ev_8d5819cb…`).
- `-flash` calls the private `CGDisplayVisualBell(0.04f, 0.2f, 0.24f, 1.0f)`. Before that it sets **every display to maximum brightness** (DisplayServices), and it restores brightness afterwards.
- *Inferred* curve: fade-in 0.04 s, hold 0.2 s, fade-out 0.24 s, full white, about 0.48 s in total. Confirm by eye.
- "Enable Screen Flash" uses the defaults key `EnableFlashScreen`. When it's off, `skipFlash` is set (`ev_5ba941d7…`). Default value: unknown (not traced).

## Q2 Shutter sound: observed

- `-[PBPhotoController record:]` (`ev_a2e11a30…`) runs in this order:
  1. Pause the video.
  2. **Grab the frame** (`snapshotWithOriginal:YES`). The frame is captured *before* the flash.
  3. Set maximum brightness.
  4. Flash.
  5. **`AudioServicesPlaySystemSound(0x18)`**.
  6. Restore brightness.
  7. Hand the image to the delegate.
- System sound **24** maps to `…/CoreAudio.component/Contents/SharedSupport/SystemSounds/system/Grab.aif`. Source: the jump table at `0x10000c744` in `/usr/sbin/systemsoundserverd`, where index 23 is `Grab.aif`. This was decoded with `otool -tV` plus a Python script, **not REA**.
- `Grab.aif` is byte-identical to `Shutter.aif` (same md5). It's 0.49 s, 44.1 kHz stereo.
- `action.aif` (0.057 s) is **not** the shutter. It's the movie-start sound (Q4).

## Q3 4-up: partly answered

From `-[PBAnimationController _save]` (`ev_cac91106…`, `ev_a3f9b5a4…`):
- **Four shots.** Each shot does: snapshot, flash, Grab sound.
- Gap between shots is `shutterDelay`, which equals 0.04 + 0.2 = **0.24 s** with the flash on and **0 s** with it off. That's on top of the time the flash and sound calls take (unknown; confirm by eye).
- In full screen, each shot also schedules a 0.35 s `dispatch_after` block (purpose not traced).
- After the 4th shot, `stopRecording:` runs.

**Output**
- Each frame is written as its own JPEG (plus an "original" copy).
- The asset also has a compiled image named `"%@ (compiled)"`.
- Combined layout and size: **unknown**. Trace `_Create4UpImageFromImageArray` next (the string is at `0x10006ec15`). The build composes a 2×2 grid at the size of one frame (inferred).

## Q4 Video: partly answered

From `-[PBQTMovieController record:]` and friends (`ev_1aa34eec…`, `ev_937de034…`, `ev_e9351e7d…`, `ev_80220530…`, `ev_07abf0b9…`):

**Start**
- Plays `NSSound soundNamed:@"action"`, which is **action.aif**.
- Recording starts in `sound:didFinishPlaying:` with no delay. If the sound fails to play, recording starts immediately.

**File and length**
- Recorder: `AVAssetWriter` with `AVFileTypeQuickTimeMovie` (`.mov`), recording video and audio.
- Maximum length: **none found** (bounded search: strings `maxim`, `limit`).

**Stop button and timer**
- `+[PBQTMovieAsset minimumRecordingDuration]` = **3.0 s**.
- When the MovieRecording view is entered, the stop button is disabled without dimming and is re-enabled after 3.0 s.
- Elapsed-time label: positional `NSDateComponentsFormatter` with zero padding, system font 22 pt, `secondaryLabelColor`. Exact visual layout: unknown.
  - *Inferred* format `HH:MM:SS` (`00:00:05`): the ledger notes hours wrap at 100, so hours are shown with two digits.
- Whether the movie countdown beeps and whether a movie has a flash: **inferred** yes (same `PBCountdownController`) and no (`-[PBQTMovieController record:]` only plays `action`).
- **Browser note (observed in testing, not Photo Booth):** in headless Firefox with a microphone open, the 0.057 s `action` sound reports `ended` about 3.8 s late, so the build starts recording at `ended` or after 0.25 s, whichever comes first.

## Q5 Mirroring: partly answered

- The defaults key `AutoFlipPhoto` exists (strings near `0x10007227b`).
- `-[NSImage flippedImageHorizontally:accountForBackingScale:]` exists.
- **Observed (`docs/study/Effect.qtz.xml`):** the host composition's `Flip` input defaults to **true** and is applied by `ImageTransform` patches with `ScaleX = −1` (patches 4–7). Those patches sit on the backdrop paths; on the plain-effect path `InputImage` reaches the effect unflipped, so for ordinary effects the mirroring happens outside the composition (where: **unknown**).
- **Unknown:** whether saved items are mirrored and the `AutoFlipPhoto` default. The build saves exactly what the preview shows (mirrored); owner, please compare with a photo from the real app.

## Q6 Effects: started (class map, observed from the procedure list `ev_1993885f…`)

| Group | Classes (each has `outputImage` or `processFace:forImage:`) |
|-------|------|
| Colour (`+[PBEffectColor effects]`) | Sepia, BW, Plastic (`_orangeTint`/`_cyanTint`), ComicBook (`_posterizedImage`/`_monoHalftone`/`_monoOutline`), Pencil (`_colorizedImage`/`_pencilShading`), Glow, Thermal, Xray |
| Distortion (`+[PBEffectDistortion effects]`) | Bulge, Dent, Twirl, Squeeze, LightTunnel (these have a slider), Mirror, FishEye, Stretch |
| Face (`+[PBEffectFace effects]`, Vision `VNTrackLegacyFaceCoreObjectRequest`) | SpaceAlien, NoseTwirl, Chipmunk, Blockhead, BugOut, Frog (all use `applyBump:forCenter:radiusScale:scale:`), Lovestruck (`_PBLovestruckSprite`), Dizzy (`_PBEffectDizzyPositioner`, ellipse around the face) |
| No class found | pop art, cloaking device, hologram, the backdrops: not loaded by Photo Booth 13.1 at all (session 4, "The effect list …") |

`PBFace` exposes smoothed values: left eye, right eye, mouth, centre, radius, angle and eye amount (`PBEffectSmoothener`). Next step: `batch_decompile` every `outputImage` / `processFace:` address listed in the procedure list. Addresses are in the session ledger.

### Effect.qtz and Normal.qtz (observed, `docs/study/*.qtz.xml`)

- **Effect.qtz is a host, not an effect.** It loads the chosen effect composition through a `QCPatchRenderer` whose `inputPath` is the effect identifier (e.g. `/sepia`), and feeds it `_protocolInput_Image`, `_protocolInput_X` / `_Y` and `masterParameter`.
  - Published inputs and defaults: `Composition`, `Capture` false, `InputImage`, `HasCaptured` false, `SliderValue` 0.5 (→ `masterParameter`), `Flip` true, `inputBackgroundImage`, `inputForegroundImage`, `XPosition` 0.5, `YPosition` 0.5, `DebugComposition` 0, `ShowBackgroundMotion` false, `localizedStrings`. Outputs: `FinishedCapture`, `SnapshotImage`.
  - Output selector: `!hasIdent ? 0 : ((capturing&&replaceBg) ? 2 : ((!captured&&replaceBg) ? 0 : 1))` (0 = raw camera, 1 = effect, 2 = backdrop capture). The backdrop branch (`Patch_3`) has `!capturing && capture` and `showMotion && capturing` expressions, a `CIColorControls`, `CIConstantColorGenerator`, `CICrop`, `CIMultiplyCompositing`, `CISourceOverCompositing` and `CIMaskToAlpha` (Q7, structure only).
  - Three `CIGammaAdjust` with power **0.8181**, all **bypassed** by default (`Splitter_15` = true).
  - Last stage: a kernel `multiplyEffect` that only sets alpha to 1.0, then a `Billboard` (scale 2) over a black `Clear`.
- **Normal.qtz** (protocol `image-filter`): a single `CIColorControls` with brightness 0, contrast 1, saturation 1, i.e. the identity. **Normal = unmodified camera.**

### Core Image kernels (observed, `public/assets/photobooth/*.cikernel`)

- `fisheye.cikernel` `fishEye(image, center, factor)`: `d' = 0.6·d / (1 − d²/factor²)` around `center`.
- `stretch.cikernel` `funHouse(image, center, param1, param2, param3)`: per-axis smoothstep falloff over `param1`, displacement `param2·sin_((p − center.y)/param3)`. It uses `center.y` for both axes (as written). `sin_` is Core Image's fast sine for [−π, π].
- `mirroredge.cikernel` `CIMirrorEdge v3.0`: a warp kernel that folds coordinates back into a box of size `sZ` (reflect-tiling).
- Parameter values: see "Effect parameters from code" below (all observed in session 2–3).

### Effect parameters from code (REA + Hopper, session 2) — observed

Constant NSNumbers live in `__DATA` as 16-byte records (isa, double) or 24-byte records (isa, encoding, integer); the CI key GOT slots are `0x100089110` angle, `…120` brightness, `…128` center, `…138` contrast, `…140` image, `…148` intensity, `…158` radius, `…160` saturation, `…168` scale (inferred from use; consistent across every effect).
- **Base `-[PBEffect]`** (`ev_2e4ed531…`): `init` sets `sliderValue` 0.5 and `renderMode` 2. `outputImage` returns the input, except for distortion effects, which first run **`mirroredge.cikernel`** over it with `sZ` = the frame size (reflect-tiling past the edges). `imageXY` = `inputXY` scaled into the frame. Each distortion then crops its result back to the frame.
- **`-[PBEffectDistortion sliderRadius]`** (`ev_07fa29f8…`) = `sliderValue` × the frame's diagonal.
- **Bulge** (`ev_d4383097…`, `ev_e5069f20…`): `CIBumpDistortion` center `imageXY`, radius 0.75 × sliderRadius, scale **0.5**.
- **Dent** (`ev_b742e0bc…`, `ev_f69661f2…`, `ev_73a61fed…`): `CIBumpDistortion`, radius 0.425 × sliderRadius, scale **−1**.
- **Twirl** (`ev_421b4c19…`): `CITwirlDistortion`, radius 0.35 × sliderRadius, angle = sliderValue × 180 × π/180 (= sliderValue·π rad).
- **Squeeze** (`ev_3df70fa3…`): `CIPinchDistortion`, radius 0.215 × sliderRadius, scale = sliderValue × 1.413.
- **Light Tunnel** (`ev_97e5fd22…`): `CICircleSplashDistortion`, radius 0.336 × sliderRadius.
- **Sepia** (`ev_5058099d…`, `ev_91125982…`, `ev_3024bf5d…`, `ev_e609f71c…`, `ev_99869c39…`): `CITemperatureAndTint` neutral (6500, 500) → target neutral (1000, 300); `CIColorControls` saturation 0, brightness 0.15, contrast 1.3; `CISepiaTone` intensity 0.8.
- **Black And White** (`ev_d20225cb…`, `ev_07a9914d…`): the same two first stages, then `CIVignette` intensity 0.7, radius 1.5.
- **Glow** (`ev_ef45dcd5…`, `ev_da6e9937…`, `ev_740ac8f6…`, `ev_7f51b382…`, `ev_0ae26fd5…`): `CIColorControls` saturation 1, brightness 0.6491, contrast 2.407 → `CIGloom` radius 0.03 × diagonal × 0.5, intensity 1 → `CIBloom` radius 0.0485 × diagonal × 0.5, intensity 0.5794 → `CIColorControls` saturation 1, brightness 0.1, contrast 1.25 → crop to the input.
- **Thermal Camera** (`ev_7c72ce84…`, `ev_19934e16…`, `ev_03f60a52…`): the Sepia `CITemperatureAndTint` → `CIColorControls` saturation 0, brightness 0.7863, contrast 2.676 → `CIColorMap` with `thermalMap.png` (`inputGradientImage`; skipped if the map failed to load) → `CIColorControls` saturation 1, brightness 0.25, contrast 1.5.
- **X-Ray** (`ev_a18b53af…`, `ev_8008767c…`, `ev_18b65151…`, `ev_1ae59d5a…`): `CIColorInvert` → `CIGaussianBlur` radius 5 → faded to alpha 0.5 (`fadeImage:alpha:`) → `CISourceOverCompositing` over the un-blurred inverted image → `CIColorControls` saturation 0, brightness −1, contrast 2.45 → `CIColorMap` with `xrayMap.png` → crop.
- **Superseded (session 4):** `CIColorControls` turned out to be plain affine maths in **linear** light (see "Core Image's own maths"); the session-2 doubt came from trying it on sRGB values. The LUTs already built stay (they match); new chains can be ported in closed form.
- **Mirror** (`ev_3bef2fc2…`, asm `ev_702d3434…`, NSNumbers `ev_21bc38e1…` = integer 1, `ev_a4aadd39…` = 0x3ff921fb54442d18 = π/2, key string `ev_49c53345…` = "inputCount"): `CIKaleidoscope` on the mirroredge'd frame with inputCenter = (0.5 × width, 0.5 × height), **inputCount 1**, **inputAngle π/2**, cropped to the frame. Core Image's `_kaleida` kernel (shared cache `@0xc930eea`) with one segment only folds across the line through the centre; measured: the left half stays and the right half is its reflection.
- **Fish Eye** (`ev_d7d1309c…`, constant `ev_f2e8e9f8…` = 1.69; `-[PBEffect imageCenter]` `ev_f90b8b72…`): `fisheye.cikernel` with center = **the frame's centre** (imageCenter = inputImage extent size × 0.5, not inputXY) and factor = **1.69 × sliderRadius**; `-[PBEffectFishEye sliderValue]` returns 0.5, so factor = 0.845 × diagonal.
- **Stretch** (`ev_8f8f061c…`, constants `ev_c39a9109…` = 0.1, `ev_2713fca7…` = 0.15): `stretch.cikernel` with center = the frame's centre, **param1 = 0.5 × height, param2 = 0.1 × height, param3 = 0.15 × height**, then `cropToReference:`. Core Image's `sin_` equals `sin` over −8 … 8 on macOS 15 (measured), and Stretch's argument reaches about ±5.
- Built and checked against Core Image (`tools/check-effects.sh`): Mirror 0.68, Fish Eye 0.59, Stretch 0.44 mean |difference|. (From JXA, a general `CIKernel` with a sampler argument renders garbled, so the reference runs the two kernels' maths as warp kernels.)

- **Plastic Camera** (session 3; pseudocode `ev_a25fdeca…`, asm `ev_9fe631a0…` `_orangeTint`, `ev_45477c32…` `_cyanTint`, `ev_69392491…` `outputImage`; constants `ev_c1219ff0…` (0.02, 1.85, 0.4), `ev_c3f3286e…` (−0.15), `ev_32769464…` + `ev_9a3ae7f6…` (integer 10), `ev_03f60a52…` (1.5, 0.1533, 0.3234, 1.1, 0.25); key strings `ev_9cac634c…` / `ev_2e7b6c6e…` (inputConcentration, inputLightPointsAt, inputLightPosition), `ev_42649b31…` / `ev_c8bb0d20…` (inputR/G/B/A/BiasVector)). W, H = the input extent's size:
  - `_orangeTint`: `CISpotLight` on a grey fill (`imageWithFillColor: grayColor`) with inputBrightness **10** (integer), inputColor white, inputConcentration **0.1533**, inputLightPosition **(0.4W, −0.15W, 0.4W)**, inputLightPointsAt **(0.4W, 2H, 0)** → `CIBlendWithMask` (inputImage = the frame, background = black fill, mask = the spotlight cropped to the frame) → `CIColorMatrix` R (2, 0, 0, 0.1), G (0, 2, 0, 0), B (0, 0, 1, 0), A (0, 0, 0, 1), bias (0.02, 0.02, 0, 0).
  - `_cyanTint`: the same with inputConcentration **0.3234**, inputLightPosition **(0.75W, 0.75W, 0.5H)**, inputLightPointsAt **(0.75W, 0.5H, 0)**; matrix R (1.5, 0, 0, 0), G (0, 2, 0, 0), B (0, 0, 0, 0), A (0, 0, 0, 1), bias (0.1, 0.5, 0.5, 0.25).
  - `outputImage`: `CIMultiplyCompositing` (orange over cyan) → `CIColorControls` saturation **1.1**, brightness **0.25**, contrast **1.5** → crop.
  - Kernels (shared cache): `_spotLight` `@0xc95e37b` (src × lightColor × pow(clamp(dot(normalize(lightPos − (p, 0)), lightPointsAt), 0, 1), concentration) × that vector's z), `_blendWithMask` `@0xc901887` (mix(background, image, mask.g) on premultiplied values, so the alpha follows the mask), `_multiply` `@0xc8fd7fd` (src × dst, alpha too).
  - Session 4: the colour class is **`CIColor`** (`_orangeTint` asm `ev_9fe631a0…` loads the class ref `0x100089098` = `_OBJC_CLASS_$_CIColor`, `ev_1c4051e3…`), so the fill is sRGB 0.5 grey = **0.2140 linear** (measured). `-[PBEffectColor imageWithFillColor:]` (`ev_e2fa3137…`) = `CIConstantColorGenerator` with that colour, `cropToReference:`.
  - **Built** as one closed-form GLSL pass (no LUT) from the maps in "Core Image's own maths": mask = 2.140 × r.z × clamp(dot(r, normalize(position − pointsAt)))^(1/concentration); orange = (2r·m + 0.12, 2g·m + 0.02, b·m); cyan = (1.5r·m + 0.1, 2g·m + 0.5, 0.5) with alpha 1.25; product → saturation 1.1 → (x − 0.5) × 1.5 + 0.75 → × 1.25 (the cyan alpha, kept by `multiplyEffect`). `tools/check-effects.sh`: mean 0.02–0.05 / 255, max 1.
  - **Inferred:** the 1.25 × brightening assumes Photo Booth shows the premultiplied colour the way `ci.js ref` does (composited over black; Effect.qtz's `multiplyEffect` sets alpha to 1 and keeps rgb). Whether PBEffect output really goes through Effect.qtz, or is clamped to alpha 1 and unpremultiplied elsewhere, is not traced.

- **Comic Book** (session 4, REA + Hopper on the `73ed6688…` copy). Constants: NSNumber records `ev_151772117…`, `ev_7fb96908…`, `ev_46059aeb…`, `ev_0cdd897e…`, `ev_49648194…`, `ev_0ae26fd5…`, `ev_1765f2cb…`; doubles `ev_2ef6cb4f…` (0.3), `ev_77e776f4…` (0.7), `ev_1b91b260…` (0.8), `ev_1775933d…` (0.99); key strings `ev_0d958ee5…`, `ev_bb675c93…` via CFStrings `ev_2291ea8d…`, `ev_dac88212…`; GOT `0x100089170` = kCIInputSharpnessKey (`ev_5858dfa1…`), `0x100089180` = kCIInputWidthKey (`ev_787b82aa…`).
  - `_posterizedImage` (`0x10003d5e8`; `ev_ace4fca2…`, asm `ev_4ab49921…`): `CIHighlightShadowAdjust` inputRadius **19** (integer), inputShadowAmount **1.5**, inputHighlightAmount **1.0** → `CIColorControls` saturation **1.7**, brightness **0.2**, contrast **1.5** → `CIColorPosterize` inputLevels **12** (integer).
  - `_monoHalftone` (`0x10003d884`; `ev_a1527355…`, asm `ev_b8fa7d4b…`): `CIColorMonochrome` color white, intensity **1** → `CISpotColor` centre/replacement/closeness/contrast: 1 = grey 0.3 → black, **0.4368**, **0**; 2 = grey 0.7 → grey 0.8, **0.4147**, **0.7932**; 3 = white → white, **0**, **0** (colours from `CIColor colorWithRed:green:blue:`) → `CIDotScreen` inputCenter **(0, 0)**, inputAngle **−0.40107666** rad, inputSharpness **0.7**, inputWidth = (previewMode ? **15** : **10**) × imageScale.
  - `-[PBEffect imageScale]` (`ev_b5ee39a3…`) = input extent height ÷ **720** (`0x10006da40`, `ev_a72b6ab6…`). `previewMode` is set by `-[EffectLayer onZoomedIn]` to NO (`ev_025b95ff…`) and by `onZoomedOut` (`ev_c49e3e0c…`; inferred YES), so the live view uses width 10 × H/720 and the effects browser 15 × h/720.
  - `_monoOutline` (`0x10003dd70`; `ev_7a38d829…`, asm `ev_370f82ed…`): `CIUnsharpMask` radius **6.283**, intensity **1.0** → `CIColorControls` saturation **0**, brightness **0.8792**, contrast **2.54** → `CISpotColor`: 1 = black → black, **0.5**, **1**; 2 = grey 0.7 → grey **0.99**, **0.45**, **1**; 3 = grey 0.7 → white, **0**, **1**.
  - `outputImage` (`0x10003e1a8`; `ev_65f1209c…`, asm `ev_496bd9d0…`): `CIBlendWithMask` (inputImage = white fill, background = posterized, mask = halftone) → `CIMultiplyCompositing` with background `CIOverlayBlendMode` (inputImage = outline, background = posterized).
  - **Built** (closed form, two blur passes + one shader) and checked: mean 0.12–0.19 / 255 against `tools/ci.js ref … comicbook`; a few isolated pixels differ fully where a posterize or outline threshold flips.
- **Color Pencil** (session 4, REA + Hopper). Constants: `ev_fc44cb74…` (0.3471, 1.609, 0.2656), `ev_383132d7…` (0.5759586531581288 = 33°), `ev_3ccc4613…` (integers 17, 2), `ev_3f849e7f…` (0.2995, 2.131), plus 0.5 (`ev_1765f2cb…`), 0.7 (`ev_151772117…`), 0 and 1 (`ev_49648194…`, `ev_0ae26fd5…`).
  - `init` (`0x10003e4d4`, `ev_c6da56be…`): `_staticImage` = `CIImage imageWithContentsOfURL:` of the bundle's `static.png` (640×480 grey noise, untagged, so read as sRGB).
  - `_colorizedImage` (`0x10003e5e4`; `ev_7be63842…`, asm `ev_2300bb3f…`): `CIColorDodgeBlendMode` with inputImage = `CISpotColor` of the frame (1 = black → black, closeness **0.5**, contrast **1**; 2 = grey 0.7 → white, **0.5**, **0.2656**; 3 = white → white, **0**, **0**) and background = `CIColorControls` of the frame (saturation **1**, brightness **0.3471**, contrast **1.609**).
  - `_pencilShading` (`0x10003ea08`; `ev_6b9bb317…`, asm `ev_dad1b29d…`): `NSAffineTransform` scaled by **(1, 1)** → `CIAffineTile` of `_staticImage` → `CIMotionBlur` inputRadius **17** (integer), inputAngle **0.57596 rad = 33°** → `CIColorControls` saturation **0**, brightness **0.5**, contrast **2** (integer) → `cropToReference:`.
  - `outputImage` (`0x10003ece0`; `ev_a33e0f64…`, asm `ev_b3c07ce6…`): `CIMultiplyCompositing` (colorized over shading) → `CIColorControls` saturation **0.7**, brightness **0.2995**, contrast **2.131**.
  - **Built:** the shading branch doesn't depend on the camera and repeats every 640×480, so `tools/ci.js lut … pencil` bakes it with Apple's filters (`public/assets/photobooth/lut/pencil.png`, half value); the rest is closed form (`CIColorDodgeBlendMode` = its kernel in linear light, Cb / max(1 − Cs, 1e-7) clamped to 0–1, measured). Check: mean 0.36–0.42 / 255.
  - **Inferred:** the tile is anchored at the frame's bottom-left corner (`CIAffineTile` with an identity transform anchors at the image's origin, and the camera frame's extent starts at 0, 0).

### Core Image's own maths (session 3) — observed

Core Image's built-in kernels ship as CI-kernel-language source strings inside the dyld shared cache (`/System/Volumes/Preboot/Cryptexes/OS/System/Library/dyld/dyld_shared_cache_arm64e`, macOS 15.6.1, sha256 `c2ef6966687b008f…`). Found with `grep -a` and a Python reader (not REA); offsets are into that file. How each filter packs its inputs into the kernel's parameters isn't in the strings, so it was **measured** by running the filter from JXA on images that encode their own pixel coordinates (or on flat greys / step edges) and reading the result back; every fit below reproduces the measurement to ≤ 0.01 px or 0.001.
- `_bumpDistortion` (`@0xc902d64`): source = c + (p − c)·(1 + y·smoothstep(clamp(1 − x·|p − c|))). **CIBumpDistortion:** x = 1/radius, y = −scale.
- `_twirl` (`@0xc95fc61`): r = min(|d|·z, 1), rotate d by −w·smoothstep(1 − r), identity for r ≥ 1. **CITwirlDistortion:** z = 1/radius, w = angle.
- `_pinchDistortionScaleLT1` / `GE1` (`@0xc944d56`, `@0xc944e29`): r = |d|·y; source = mix(p, c + d/√r, z); GE1 uses c + d·r^w past r = 1. **CIPinchDistortion:** y = 1/radius, z = scale, w = −scale/2. Below scale 1 the pinch has no radius cut-off: it reaches the whole frame.
- `_circleSplash` (`@0xc904644`): source = c + normalize(d)·min(|d|, radius) (inputs used as is).
- `_vignette` (`@0xc9609e9`): multiplies **linear** light by (1 − |p − c|²·w)^z. **CIVignette:** z = 2 × intensity; at radius 1.5, 1/√w = 1.25 × the image's shorter side (the radius mapping isn't linear: at radius 0.75 it is 1.64×, so only Photo Booth's 1.5 was pinned). c = the extent's centre.
- `_gloom` / `_bloom` (`@0xc901b43`, `@0xc901af3`): mix(s, min(s, blur), k) / mix(s, max(s, blur), k) on premultiplied values. The blur is **CIGaussianBlur with the same radius**, and CIGaussianBlur's sigma = its radius (fitted from step edges at radius 10 and 30).
- Blurs of a finite image treat the outside as transparent: CIGaussianBlur / CIGloom leave alpha < 1 near the edges (measured), and Effect.qtz's `multiplyEffect` sets alpha to 1, so Glow gets a dark border (inferred; the reference render shows it).
- `CIColorInvert` inverts **linear** light (sRGB 0.5 → 0.8993 = enc(1 − lin(0.5))).
- Core Image doesn't clamp between filters: Glow's first `CIColorControls` spans −0.06 … 2.35 in linear light (measured over the whole colour cube). Clamping it changes Glow by about 7/255 on average.
- **Session 4, measured with `tools/ciprobe.js`** (raw working-space values: linear, premultiplied, unclamped, ±1e-4):
  - `CIColorMatrix` (`_ci_colormatrix` `@0xc974b05`): unpremultiply (alpha floor 1e-5) → R' = dot(s, inputRVector) … A' = dot(s, inputAVector), + bias → premultiply. Nothing is clamped: alpha 1 with A bias 0.25 gives alpha 1.25 (flat (0.2, 0.4, 0.6, 0.5) through the cyan matrix → (0.525, 1.575, 0.375, 0.75), as predicted).
  - `CISpotLight` → `_spotLight` (`@0xc95e37b`): lightpos = inputLightPosition; **lightpointsat = normalize(inputLightPosition − inputLightPointsAt)**; **lightcolor = (inputColor.rgb × inputBrightness, inputColor.a)**; **parms.x = 1 / inputConcentration** (fitted exponent 6.51–6.53 vs 1/0.1533 = 6.523 and 3.07–3.10 vs 1/0.3234 = 3.092 over 11 pixels). Output = src × r.z × k × lightcolor, alpha included (a grey fill gives alpha = r.z·k).
  - `CIBlendWithMask` = `_blendWithMask` mix(background, image, mask.g) on premultiplied values; mask.g = 1.7 is not clamped.
  - `CIMultiplyCompositing` = `_multiply` src × dst on premultiplied values, alpha too (1.25 × 1 = 1.25).
  - **`CIColorControls`** is affine in linear light: unpremultiply → c = mix(luma, c, saturation) with luma = dot(c, (0.2125, 0.7154, 0.0721)) → (c − 0.5) × contrast + 0.5 + brightness → premultiply; unclamped (grey 8 at contrast 1.5, brightness 0.25 → 12.0; (2, −0.3, 5) → (3.2145, −0.5805, 8.1643)). The `_colorControls` kernel string in the cache is a threshold kernel, not this.
  - Effect.qtz's `multiplyEffect` (`docs/study/Effect.qtz.xml` line 7162) is `c.a = 1.0` on the sampled (premultiplied) colour.
  - `CIColorPosterize` (`_colorPosterize` `@0xc9078eb`): floor(x × (levels − 1) + 0.5) / (levels − 1) in linear light, unclamped (12 levels: 0.05 → 1/11, 1.4 → 15/11).
  - `CIColorMonochrome` (`_colorMonochrome` `@0xc906444`): the kernel as written in linear light (luma (0.2125, 0.7154, 0.0721); white, intensity 1 gives 2·luma below 0.5, else 1).
  - `CISpotColor` (`_spotColor` `@0xc9088fd`): **kernel contrast = 1 / (1 − inputContrast)** (0 → 1, 3 → −0.5, 1 → a hard step), closeness as is, CIColor centres and replacements **linearised** (sRGB 0.5 → 0.2140); distances in linear light. The result is the three replacements composited over **white**; the source only enters through the distances.
  - `CIDotScreen` (`_dotscreen` `@0xc929e92`): params = (centre, **1 / (1 − sharpness)**), mtx = (cos θ, sin θ, −sin θ, cos θ) / width, so u = (x·cos θ + y·sin θ)/w + cx, v = (−x·sin θ + y·cos θ)/w + cy around the centre; destCoord at pixel centres; luma in linear light (11 pixels within 2e-4).
  - `CIUnsharpMask` (`_unsharpmask` `@0xc95fdd5`): blur sigma = radius (step edge, 5e-4), linear; the kernel divides the blur by its alpha, so frame edges don't darken.
  - `CIOverlayBlendMode` (`_overlayBlendMode` `@0xc8fde86`): the kernel as written in linear light, result clamped to 0–1.
  - **`CIHighlightShadowAdjust`** = `_highlightsAndShadows2` (`@0xc92a514`) in linear light with **blur = CIGaussianBlur of the image's own rgb, sigma = inputRadius** (step-edge fit: 19 ± 0, error 2e-4) and **params = (min(inputShadowAmount, 1), inputHighlightAmount, 0, 1)**: shadow 1.5 behaves as 1 (from the mid-contrast term at grey 1.5 → 1.6002; six greys and three colours fit within 3e-4). Past the frame the blur doesn't go dark (a flat frame stays flat at its edges): edge-normalised or clamped, which isn't distinguished; the build normalises.
- `mirroredge.cikernel` with sZ = the frame is not quite the identity inside the frame: it samples (p − 0.5)·(sZ − 1)/sZ + 0.5, up to a pixel off at the far edges.

### What the build does with it (session 3)

- **Colour chains are baked**, not ported: `tools/ci.js lut` runs the exact chain with Apple's filters over a 64³ identity LUT (512×512 PNG, sRGB in and out) → `public/assets/photobooth/lut/{sepia,bw,thermal,xray,glow1,glow2}.png` via `tools/extract-assets.sh`. The identity chain round-trips exactly.
- Spatial stages are GLSL passes in `effects.js` (vignette, Gaussian blur in linear light with transparent edges, gloom, bloom); distortions use the kernels above with `edge()` = mirroredge.
- **Check:** `tools/check-effects.sh` grabs each effect from headless Chrome (fake camera fed The Beach at 1080×720) and diffs it with `tools/ci.js ref` on the same grabbed frame. Mean |difference| per channel (0–255): Sepia 0.16, B&W 0.12, Plastic Camera 0.05, Comic Book 0.19, Color Pencil 0.42, Thermal 0.21, X-Ray 0.21, Glow 1.94, Bulge 0.46, Dent 0.42, Twirl 0.45, Squeeze 0.58, Light Tunnel 0.76 (the check fails above 3).
- **Inferred / unknown:** X-Ray's 5 px blur is applied on a 720-line frame (the camera size Photo Booth runs at is unknown); Glow's negatives below −0.1 clip; whether Photo Booth mirrors before or after the effect (matters for Twirl's direction) is unknown, the build mirrors first.

### Slider and centre point (REA + Hopper, session 3) — observed

From a byte-identical copy of the binary (`73ed6688…`). Pseudocode `ev_c2bd08fb…`, `ev_c20a0aa4…`, `ev_84579306…`, `ev_2aedbca8…`; assembly `ev_cab3e335…` (`_initSliderView`), `ev_b87dfafa…` (`-[PBTransparentSlider initWithFrame:]`), `ev_468b515b…` (`drawRect:`), `ev_7d4f4030…` (`mouseMoved:`), `ev_e660dc0e…` (`_hideSlider:`), `ev_fb77f6ee…` (`-[EffectLayer onMouseDragged:]`), `ev_e4fdaec3…` (Reset Effect block); constants `ev_fd793804…` (49, 142), `ev_c39a9109…` (0.1), `ev_9fbc2875…` (±71), `ev_77e776f4…` (0.7).
- **Which effects:** `-[PBEffect wantsSlider]` = NO; `PBEffectBulge/Dent/Twirl/Squeeze/LightTunnel wantsSlider` = YES. `-[QCComposition wantsSlider]` = its attributes contain `masterParameter`.
- **View:** `PBTransparentSlider` is 240×49 with an `NSSlider` at (49, −2.5, 142, 49), value 0.5, min **0.1**, max 1.0. `_initSliderView` centres it horizontally in the PBView with its bottom at `trayHeight`, hidden, autoresizing flexible left/right margins.
- **Drawing:** rounded rect over the bounds, radius 5, `colorWithCalibratedWhite:0.1 alpha:0.7`; white ovals 13 pt at (w/2 + 71 + 6, h/2 − 6.5) and 7 pt at (w/2 − 71 − 6 − 7, h/2 − 3.5) (swapped for right-to-left). While shown, its layer has a background `gaussianBlur` filter, radius 20.
- **Showing:** `-[PBView mouseMoved:]` calls `_updateSlider`: in viewMode 3 (inferred: live view) the slider is shown when the effect wants one and the pointer is inside the PBView, hidden otherwise; any other mode hides it. Then, if visible, `_autoHideSlider:` runs after **1.0 s** and hides it if the pointer is still where it was. Show and hide go through `animator setHidden:` (a fade; duration not in the code).
- **Value:** the slider's action `_takeValueFrom:` sets the effect renderer's `sliderValue`.
- **Centre:** `-[EffectLayer onMouseDragged:]` sets `inputXY` = drag position ÷ layer bounds; `-[PBEffect setInputXY:]` clamps each to 0–1. No `onMouseDown:` on EffectLayer, so a click without a drag doesn't move it (bounded search over procedure names).
- **Reset Effect** (`-[PBView resetEffect:]`, async block): inputXY (0.5, 0.5), sliderValue 0.5, slider 0.5.
- `-[PBEffectFishEye sliderValue]` always returns 0.5.
- **Inferred:** each effect keeps its own values (one renderer per effect); the NSSlider's look on the dark pill (accent fill, white knob) is drawn from macOS 15's slider, not traced.

### Filters each effect names (strings, `docs/study/pb-strings.tsv` 0x10006e0a1–0x100070544)

Each effect's identifier, its Core Image filters and its display name sit together in the string table, so the grouping below is **inferred** from string order; the names themselves are **observed**. No parameter values.

| # | Identifier | Name in UI | Kind | Filters / resources named | In the build |
|---|---|---|---|---|---|
| 1 | space alien | Space Alien (obs.) | face | `applyBump:` ×3 (eyes, mouth) | **yes**, exact values (session 5); drawing matches Core Image given the same points; tracking by MediaPipe (inferred mapping) |
| 2 | nose twirl | Nose Twirl (obs.) | face | `CITwirlDistortion` (session 5; no bump) | **yes**, as above |
| 3 | chipmunk | Chipmunk (obs.) | face | `applyBump:` ×2 (cheeks) | **yes**, as above |
| 4 | lovestruck | Lovestruck (obs.) | face, sprites | `small/medium/largeHeart.png`, `CIAffineTransform` | **yes**, as above |
| 5 | dizzy | Dizzy (obs.) | face, sprites | `bird%@%lu.png`, `CIAffineTransform` | **yes**, as above |
| 6 | blockhead | Blockhead (obs.) | face | `applyBump:` ×2 (forehead) | **yes**, as above |
| 7 | bug out | Bug Out (obs.) | face | `applyBump:` ×2 (eyes) | **yes**, as above |
| 8 | frog | Frog (obs.) | face | `applyBump:` ×3 (eyes, chin) | **yes**, as above |
| 9 | sepia | Sepia (obs.) | colour | `CITemperatureAndTint` (`inputNeutral`, `inputTargetNeutral`), `CIColorControls`, `CISepiaTone` | **yes**, exact values; matches Core Image (session 3) |
| 10 | blackandwhite | Black And White (obs.) | colour | `CIVignette` (+ inferred desaturation) | **yes**, exact values; matches Core Image (session 3) |
| 11 | plasticcamera | Plastic Camera (obs.) | colour | `CISpotLight` (`inputConcentration`, `inputLightPointsAt`, `inputLightPosition`), `CIBlendWithMask`, `CIMultiplyCompositing`, `_orangeTint` / `_cyanTint` | **yes**, exact values, closed form; matches Core Image (session 4) |
| 12 | comicbook | Comic Book (obs.) | colour | `CIHighlightShadowAdjust`, `CIColorPosterize`, `CIColorMonochrome`, `CISpotColor` (3 centre/replacement colours), `CIDotScreen`, `CIUnsharpMask`, `CIOverlayBlendMode` | **yes**, exact values, closed form; matches Core Image (session 4) |
| 13 | colorpencil | Color Pencil (obs.) | colour | `static.png`, `CIColorDodgeBlendMode`, `CIAffineTile`, `CIMotionBlur` | **yes**, exact values (shading baked with Apple's filters); matches Core Image (session 4) |
| 14 | glow | Glow (obs.) | colour | `CIGloom`, `CIBloom` | **yes**, exact values; matches Core Image (session 3) |
| 15 | thermalcamera | Thermal Camera (obs.) | colour | `thermalMap.png`, `CIColorMap` (`inputGradientImage`) | **yes**, exact values; matches Core Image (session 3) |
| 16 | xray | X-Ray (obs.) | colour | `xrayMap.png`, `CIColorInvert`, `CIGaussianBlur`, `CISourceOverCompositing` (+ inferred `CIColorMap`) | **yes**, exact values; matches Core Image (session 3) |
| 17 | bulge | Bulge (obs.) | distortion, slider | `CIBumpDistortion` | **yes**, exact values; matches Core Image (session 3) |
| 18 | dent | Dent (obs.) | distortion, slider | `CIBumpDistortion` (inferred: negative scale) | **yes**, exact values; matches Core Image (session 3) |
| 19 | twirl | Twirl (obs.) | distortion, slider | `CITwirlDistortion` | **yes**, exact values; matches Core Image (session 3) |
| 20 | squeeze | Squeeze (obs.) | distortion, slider | `CIPinchDistortion` | **yes**, exact values; matches Core Image (session 3) |
| 21 | mirror | Mirror (obs.) | distortion | `CIKaleidoscope` (`inputCount`); `mirroredge.cikernel` (inferred) | **yes**, exact values; matches Core Image (session 3) |
| 22 | lighttunnel | Light Tunnel (obs.) | distortion, slider | `CICircleSplashDistortion` | **yes**, exact values; matches Core Image (session 3) |
| 23 | fisheye | Fish Eye (obs.) | distortion | `fisheye.cikernel` | **yes**, exact values; matches Core Image (session 3) |
| 24 | stretch | Stretch (obs.) | distortion | `stretch.cikernel` ("strech") | **yes**, exact values; matches Core Image (session 3) |
| 25–40 | cloakingdevice, popart, hologram, the 5 backdrops, user backdrop 1–8 | — | **not in Photo Booth 13.1** (session 4, below) | — | dropped from the browser |

### The effect list, Pop Art / Cloaking Device / Hologram and the backdrops (REA + Hopper, session 4) — observed

- `-[RendererController effectList]` (`0x1000477f8`, `ev_49c7f4c3…`) is built once as `+[PBEffectFace effects]` + `+[PBEffectColor effects]` + `+[PBEffectDistortion effects]`, and nothing else:
  - Face (`0x100055fb8`, `ev_d1e7b0d7…`): PBSpaceAlien, PBNoseTwirl, PBChipmunk, PBEffectLovestruck, PBEffectDizzy, PBBlockhead, PBBugOut, PBFrog.
  - Colour (`0x10003bee4`, `ev_da3f49f5…`): Sepia, BW, Plastic, ComicBook, Pencil, Glow, Thermal, Xray.
  - Distortion (`0x10001c494`, `ev_273b81b5…`, array order from the asm `ev_f07b2eac…`): Bulge, Dent, Twirl, Squeeze, Mirror, LightTunnel, FishEye, Stretch.
- `-[VideoLayer _loadEffects]` (`0x1000315bc`, `ev_c54c9815…`): pages = ⌈effectList.count / 8⌉ = **3**; each page is 9 effect layers filled in order with **Normal in the 5th slot** (the centre).
- So `EffectsOrdering.plist` (40 ids) is a leftover: the string "EffectsOrdering" doesn't occur in the binary (byte search). The same 40 ids sit in `/System/Library/Compositions/DefaultOrder.plist`, but that folder has no Pop Art, Cloaking Device, Hologram or backdrop compositions (64 files listed), nothing under `/System/Library`, `/System/Applications` or `/Library` is named after them, the dyld shared cache doesn't contain the names, and `~/Library/Compositions` (Photo Booth's container links to it) and `/Library/Compositions` are empty. (Filesystem searches, not REA; bounded to those places.)
- The QC host code is still in the binary (`QCCompositionLayer`, `-[QCComposition backgroundContentPath]`, composition attributes `isBackdrop`, `backdropsForegroundPath`, `backdropsBackgroundPath`, `UserBackdropsPrefs`), but with this effect list it has nothing to load. **Inferred:** backdrops and the three QC effects were removed from Photo Booth before 13.1, leaving this code and the two plists.
- **The build** now shows the same 24 effects on 3 pages (`check-photobooth.js` checks the page count).

### Face effects (REA + Hopper, session 5) — observed

From the `73ed6688…` copy. Pseudocode: `ev_0fdd1fd6…` (shared), `ev_094df3bb…` (the six bump effects), `ev_14ad44eb…` / `ev_31f4ee1e…` (PBFace, smoother), `ev_f125e361…` (RendererController), `ev_153c9644…` (Lovestruck), `ev_f2fb7913…` (Dizzy). Assembly: `ev_84c17587…` radiusForScale, `ev_84ef3d7c…` applyBump, `ev_c0c6b693…` Space Alien, `ev_abebaa18…` / `ev_d6b4b55f…` Nose Twirl + init, `ev_81690d3c…` Chipmunk (blocks `ev_23cdacb5…`, `ev_eabd9a6c…`), `ev_d3ecd439…` Blockhead (blocks `ev_a4c64d47…`, `ev_86fcba52…`), `ev_3eb3ec61…` Bug Out, `ev_873891be…` Frog, `ev_2771405d…` leftEyeXSm, `ev_6c5fa069…` the Vision point block, `ev_f8e4bb15…` Lovestruck, `ev_3550f73d…` Dizzy. `_verticalDevs`: `ev_5c72d593…`, `ev_e37ffccd…`, `ev_63ce6dd0…`. The other smoother getters, `-[PBEffectSmoothener value:forTime:]`, `-[PBFace eyeAmount]`, the wave generator, the sprite helpers and the Dizzy positioner were read from `otool -tV` of the same copy (stripped; ranges from `docs/study/pb-procedures.tsv`), and every float constant straight from the file (`__TEXT` = slice offset 819200).

**Tracking.**
- `-[RendererController _runFaceDetectionForFrame:atTime:]`: Vision `VNTrackLegacyFaceCoreObjectRequest` (FaceCore Kalman filter on, tracking level 1) seeded with the previous observation, run by a `VNSequenceRequestHandler` on the frame. No result → every face is dropped (the effect shows the plain frame and the next face starts fresh).
- `_processFaceObservations:forFrame:atTime:`: at most **3 faces**, matched by FaceCore `trackID`; each is a `PBFace` updated with the frame's extent as image size. `-[PBEffectFace outputImage]` runs `processFace:forImage:` for each face in turn on the previous result, then crops to the frame. No mirroredge for face effects (PBEffectFace isn't a distortion).
- `-[PBFace updateWithVisionResult:imageSize:time:]`: FaceCore's points are pixels; a block divides them by the image size (`ev_6c5fa069…`), so PBFace keeps **normalized** values (origin bottom-left): `center` = the bounding box's mid point, `leftEye`, `rightEye`, `mouth`, `radius` = **0.5 × box width ÷ image width**, `angle` = **atan2(rightEye.y − leftEye.y, rightEye.x − leftEye.x)** (0 when the x's are equal), plus trackID, trackDuration and time.
- Accessors: `center`, `leftEye`, `rightEye`, `mouth` return the raw values. `radius`, `angle` and `eyeAmount` (= **1.2 × radius**) are smoothed; `centerForImageSize:`, `mouthForImageSize:` and `left/rightEyeForImageSize:withAdjustmentBlock:` run the optional block on the **normalized** point, scale it to pixels (`imagePointFromNormalizedPoint:` = point × size), then smooth x and y separately in pixels.
- `PBEffectSmoothener value:v forTime:t` (t in seconds, duration in ms, state `last`, `lastTime`, both start at 0): if |v − last| ≤ tolerance, keep `last` (lastTime = t); else if lastTime < t < lastTime + duration/1000, v = f·v + (1 − f)·last with f = 1000·(t − lastTime)/duration; store and return v. Durations / tolerances: eyes 50 ms / **20 px**, mouth 50 / **5 px**, centre 10 / 10 px, radius 50 / 0.05, angle 50 / 0.05, eyeAmount 50 / 0.1.

**Shared.** `radiusForScale:s` = s × the frame's diagonal. `applyBump:image forCenter:c radiusScale:k scale:s` = `CIBumpDistortion` centre c, **radius 0.75 × k × diagonal**, scale s. W, H = frame size; L, R, M = the smoothed pixel eye / mouth points.

| Effect | `processFace:forImage:` |
|---|---|
| Space Alien | bump(L, radius, 0.5) → bump(R, radius, 0.5) → bump(M, **0.3, −0.6**) |
| Nose Twirl | `CITwirlDistortion` at the smoothed centre c: radius **0.35 × diagonal × radius + 0.1 × c.y** (as compiled), angle **±(25 + 180 × radius)°** (+ when c.x < W/2), smoothed by the effect's own smoother (500 ms, tolerance 0.05) |
| Chipmunk | bump(L′, eyeAmount, 0.5) → bump(R′, eyeAmount, 0.5); the blocks move the normalized eye points by k = radius/8 and d = \|mid(eyes) − mouth\| / 1.5 (raw points), with (s, c) = sincosf(angle): left (x − k·c − d·s, y − d·c + k·s), right (x + k·c − d·s, y − d·c + k·s) — the right block reuses the left's y term |
| Blockhead | as Chipmunk, both blocks (x + 0.5·d·s, y + 0.5·d·c) |
| Bug Out | bump(L, eyeAmount, 0.5) → bump(R, eyeAmount, 0.5) |
| Frog | Bug Out, then bump((M.x, **0.7 × M.y**), **0.2186**, 0.5) |

**Lovestruck** (`_PBLovestruckSprite`, 12 per face trackID). Sprite init: phase and rotationPhase uniform in [−180, 180) (arc4random). Heart = smallHeart if radius ≤ **0.4**, mediumHeart if ≤ **0.6**, else largeHeart (41×39, 51×48, 72×68 px). For sprite i, with (cx, cy) = raw centre, r = radius, k = 0.06r/0.17, t = effect time:
- base = (cx − r·sin a, cy + r·cos a), a = (i/11 − 0.5) × **100°**
- w1 = frac(t/**1.3** + phase/360), w2 = 1 − w1 (`generateWaveType` 2 and 3, amplitude 0.5, offset 0.5), rot = **15° × sin(2π(t/3 + rotationPhase/360))**
- `pulseValuesWithSeed:w1 x y maxDev:2k`: when w1 wraps (w1 ≤ 0.5 after > 0.5) the point becomes (x + 2k·(2·rand − 1), y + 2k·w1) and stays until the next wrap (it starts at (0, 0))
- position = (p.x ∓ k·w1, p.y + 2k·w1) (outwards: − when p.x < cx), in pixels, plus (0, r·H); `NSAffineTransform` translate → scale **3.5·r·(H/720)/0.17 × sin(2.433·w1)** → rotate by rot; the heart faded to alpha w2 (`fadeImage:alpha:` = `CIColorMatrix` A vector (0, 0, 0, α)); `CIAffineTransform`, composited over the frame, sprite after sprite.

**Dizzy** (`_PBEffectDizzyPositioner` per trackID, `_verticalDevs` = **0.01, 0.03, 0.025, 0.02, 0.028, 0.015, 0.023** → 7 birds). Ellipse centre = raw centre + 1.85·radius·(sin φ, cos φ), φ = angle, smoothed in normalized units (500 ms, tolerance 0.02). Birds = small if radius < **0.13**, medium if < **0.2**, else large (4 wing frames each: 55×40, 65×47, 100×72). For bird i, θ-phase q = ⌊360(i + 1)/7⌋°:
- frame = clamp(round(3 sin(2π(t/0.3 + q/360)) + 0.5), 0, 3); S, C = sin, cos(2π(t/3.5 + q/360))
- u = a·C, v = b·S − dev_i·sin(2πt/5), a = 0.4r/0.3295, b = 0.075r/0.3295; position = E + (u cos φ − v sin φ, −u sin φ − v cos φ), in pixels, plus (0, r·H)
- translate → scale (±s, 0.83 s), s = 9·(r + 0.05896·S + 0.03104)·(H/720), negative x when S ≤ 0 → rotate by (S ≤ 0 ? 1.1 : −1.1)·φ radians; `CIAffineTransform`, composited over, bird after bird (no depth order).

**Inferred:** MediaPipe Face Landmarker stands in for FaceCore, so the points are approximations: FaceCore's box (its width drives `radius`) and centre aren't the same as any landmark set. "leftEye" is the eye with the smaller x in the frame the effect sees (with the other one the angle would be ≈ π and Chipmunk's cheeks would land on the forehead).

**The build (session 5).** `public/js/faces.js`: MediaPipe Face Landmarker (`@mediapipe/tasks-vision` 1.1.0, `face_landmarker.task` float16 v1, sha256 `64184e22…`) self-hosted in `public/vendor/mediapipe/`, loaded on first use, GPU delegate with a CPU fallback, up to 3 faces, run once per new camera frame while a face effect shows. Its usage logger (it posts to `odml.pa.googleapis.com/v1/log` every 60 s, no opt-out in the API) is patched to drop its events, and `index.html` sets `Content-Security-Policy: connect-src 'self'`, so nothing the page fetches or sends can leave its origin. Mapping: box = the landmarks' extent (centre, radius = half its width), eyes = iris centres 468 / 473 sorted by x, mouth = midpoint of inner-lip points 13 / 14. The smoothers, blocks, waves and sprite maths are the decoded ones; each effect (and each effects-browser tile) keeps its own smoothers, since the tiles draw at their own pixel size (Photo Booth shares one PBFace). Faces are matched by index and all state resets when the face count changes (FaceCore matches trackIDs). Bumps and twirls are GLSL warp chains like the distortions; hearts and birds are composited in the shader from a runtime sprite atlas (premultiplied, bilinear, in linear light). `tools/check-effects.sh` runs a second pass on a public-domain portrait and renders Core Image's chain from the parameters the page drew with: mean 0.01–0.08 / 255 for all eight. Headless Chrome: 45–50 fps with a face effect, 50 fps with the 8 face tiles; MediaPipe also tracks in headless Firefox.

### Effects browser (REA + Hopper, session 6) — observed

From the `73ed6688…` copy. Pseudocode: `ev_a747a049…` (`_windowGoToPage:animate:`, `_fullScreenGoToPage:animate:`, `goToPage:animate:fullScreen:`, `slideLeftToNewPage:`, `zoomIn` / `zoomOut`, `switchToEffect:animate:`, `switchFromEffect:animate:`, `_mosaicTransitionStopped:`), `ev_3004ff44…` (`sub_100007524`, the three `actionForKey:`, PageLayer layout, `textLabel`, the zoom-stop handlers), `ev_ca4d1694…` (`-[PBView _updateLayersFromViewMode:toMode:animate:]`, `setPageIndex:`, `goToPreviousNextEffectPage:`, `-[VideoLayer onMouseUp:]`, `effectsButtonClicked:`, `setViewMode:animate:`), `ev_5cbc4c8c…` (`-[PBView scrollWheel:]`, `goPreviousNextPage:`, `pageClicked:`), `ev_bad681f5…` (EffectLayer `setFrame:` / init, ShadowedTextLayer). Float constants from `otool -tV` of the same copy.
- **Layout** (`+[PageLayer rectForEffectOnPage:atIndex:givenCurrentPage:withSize:]` `0x10000e5ac`): `xMargin` = `yMargin` = `interspace` = **3**. Tile = ((W − 2·3 − 2·3)/3, (H − 12)/3); column i mod 3, row ⌊i/3⌋ counted from the top (y = 3 + (2 − row)·(h + 3) in the unflipped layer); x is shifted by (page − currentPage)·W. Every page has its own Normal in slot 4. EffectLayers are sized to their tile (no scaling transform); `relayoutEffectLayers` sets `CGRectIntegral` frames.
- **Turning a page, window** (`_windowGoToPage:animate:` `0x100031e54`): the page layers sit side by side at x = index·W; a `CABasicAnimation` on the VideoLayer's `sublayerTransform` goes from the presentation value to a translation of −W·page, **duration 0.6 + 0.25·(|Δpage| − 1) s**, `kCAMediaTimingFunctionEaseInEaseOut`; animate NO → duration 0. The live video is paused only while the new page's renderers draw their first images (waits ≤ 2 s).
- **Full screen** (`_fullScreenGoToPage:animate:` `0x100032404`) is a different transition (contents rects, bounds, shadows and label opacity of the new page's layers, ease-in-out, direction from `slideLeftToNewPage:`, which treats last → first as a forward step); not decoded further, the build uses the window slide in both.
- **Shift:** `sub_100007524(d)` returns 2·d when Shift (`0x20000`) is held, else d. Every browser duration goes through it.
- **Paging input:** both arrows go through `goPreviousNextPage:` (via the PBView's `goToPreviousNextEffectPage:`), which **wraps** (next on the last page → first, previous on the first → last); `updateArrowButtonsState` (`0x10001746c`) is a bare `ret`, so the arrows are never disabled. A dot's tag − 1 is its page; clicking the current one does nothing. `-[PBView scrollWheel:]` in view mode 4 (the browser), at the start of a gesture (`phase` = began) with a mostly sideways delta: next page when scrollingDeltaX < 0, else previous (the comparison of the deltas is inferred from `fccmp`). `swipeWithEvent:` pages too (not traced).
- **Opening** (`effectsButtonClicked:` → `switchToMosaic` → view mode 4 → `_updateLayersFromViewMode:toMode:animate:` → `-[VideoLayer switchFromEffect:animate:]` `0x100017f84`): the current effect's layer goes on top of its page, the other pages are removed, then in one transaction of **0.25 s**: the other tiles un-hide, the effect's label goes to opacity **1**, and its frame goes from the whole view to its tile (`rectForEffectOnPage:` with its own page; Normal, effect index 4, uses the current page). The page shown is whatever `pageIndex` was (inferred: the last page viewed).
- **Closing** (tile click: `-[VideoLayer onMouseUp:]` → `setLastEffect:notifyDelegate:` → `switchToEffect:animate:` `0x100019af4`; the Effects button again → `switchToLastEffect`): the tile's frame is first set to its slot without animation, then in **0.25 s** the other tiles hide, its label goes to opacity **0** and its frame grows to the page bounds; when that ends the VideoLayer is removed and the effect's renderer leaves preview mode (`onZoomedIn`). Clicks are ignored while `transitioning`.
- **Timing of the zoom:** the transaction sets only a duration, so the layers' implicit actions run. **Measured** (JXA, a CALayer in an offscreen window's layer tree, `CATransaction` with only `setAnimationDuration:`): frame changes become `position` / `bounds` `CABasicAnimation`s, `opacity` one too, all with **`kCAMediaTimingFunctionDefault`** (= CSS `ease`, control points (0.25, 0.1), (0.25, 1)); `hidden` becomes a `CATransition` (fade) of the same duration and timing. `actionForKey:` overrides only turn off `sublayers` (VideoLayer, PageLayer) and `contents` (EffectLayer).
- **Label** (`-[EffectLayer textLabel]` `0x100025a0c`): a `ShadowedTextLayer` (a CATextLayer) with bounds 720 × 50, `systemFontOfSize: 18`, centred, truncating at the end, constrained to its tile's MinY + **10** and MidX. Nothing sets its shadow, so it keeps `ShadowedTextLayer init`'s black, offset 0, blur 0 (no visible shadow); the text colour is CATextLayer's default white. CATextLayer draws the line at the top of its bounds, so the text sits about 60 px above the tile's bottom (inferred from CATextLayer's behaviour, not traced).
- Strings: `arrowtriangle.left.fill`, `arrowtriangle.right.fill`, `circle.fill`, `Page %1$ld of %2$ld pages`, `Next Effects`, `Previous Effects`.
- **Unknown:** the page indicator's exact drawing; the tile selection ring (the build draws an accent ring on the current effect, inferred).
- **The build (session 6):** 27 tile buttons (3 pages × 9) placed with PageLayer's maths in CSS `calc()`; the grid slides with `transform` (ease-in-out, 0.6 s + 0.25 s per extra page); `.full` / `.zoom` classes run the zoom (left/top/width/height/opacity, 0.25 s `ease`); Shift doubles all of them; arrows wrap; a sideways wheel turns one page per gesture (300 ms of quiet starts a new one, since browsers have no gesture phase). `drawTiles()` draws each effect into its button's animated box, fading with the button's computed opacity (constant-alpha blend), the zooming tile last.

## Q10 Saved photo: answered (pixel size unknown)

From `+[PBAsset generateAssetFilenameForAssetClass:]` (`ev_cac91106…`):
- The filename is `"<template><ext>"`. The templates are `Photo on %@ at %@`, `4-up on %@ at %@` and `Movie on %@ at %@`.
- The date uses `NSDateFormatter` short date style and the time uses short time style, both in the user's locale. In the result, `/` becomes `-` and `:` becomes `.`.
  - Example with en_GB: `Photo on 21-10-2026 at 14.32.jpg`
  - Example with en_US: `Photo on 10-21-26 at 2.32 PM.jpg`
- Collisions get ` #2`, ` #3`, ….
- Encoding: JPEG (`representationUsingType:3`) for photos and `.mov` for movies.
- Phase 4 can reproduce this with `Intl.DateTimeFormat(undefined, {dateStyle:'short'})` and `{timeStyle:'short'}` and the same replacements (inferred).

## Q8 Window: partly answered

Source: REA CLI `decode-interface-builder` on the app bundle, evidence `ev_a99d30358becf30443afcd1c6788c87ce73bfc25cae86be3a179f733d7adc08e`. All 4 nibs decoded; MainMenu connections are partial (7 unresolved).
- Main window (`MainMenu.nib` object 6, class `PBMainWindow`): content rect **720×540 (4:3)**. Style mask 271 = titled, closable, miniaturizable, resizable, plus bit 8 (textured/unified). Autosave name "Main Window". **Observed.**
- No min size in the nib, so it's probably set in code (inferred). Full-screen layout: unknown (the strings name `fs-red-button-*`, `fs-brass-button*`, `fs-tray-*`, `fs-timer-*` images that aren't among the extracted resources or the `Assets.car` names listed in HANDOFF section 4).
- **Observed view tree** (AppKit frames, origin bottom-left; `docs/study/pb-nibs.rea.json`):
  - `PBMainView` 720×540 → `PBView` at (0, 60), **720×480** (the preview). Inside it, at its bottom, a 720×62 view holding `PBOverlayScrollView` → `PBClipView` → `PBTrayView` (the **tray, 62 px, over the preview**) and an `NSVisualEffectView` 720×62 behind it. A second `NSVisualEffectView` 720×480 covers the preview (purpose unknown).
  - `PBTextureView` 720×60 at the bottom → `PBTabViewWithGradientBackground` 720×60, tabs **LiveVideo** (selected at load), **Still**, **CountDown**, **MovieRecording**, **QTMovieCountDown**.
  - LiveVideo: `PBRecordingRadioButton` (`NSSegmentedControl`, rounded) 104×24 at (17, 18), segments 32/30/30 wide, tags 0/1/2, **segment 1 selected**; `PBShutterButton` at (360, 30) with size 0 (sized in code); `PBEffectsToggleButton` 110×34 at (598, 12), rounded bezel, title **"Effects"**.
  - Still: `PBShutterButton` 51×52 at (335, 4), image `shutterBtn_red_norm`; the segmented control 98×24 at (0, −3); an untitled rounded `NSButton` 51×33 at (656, 12) (inferred: Share, `PB_share`).
  - CountDown: `PBCountdownView` 600×60.
  - MovieRecording: `PBShutterButton` 51×52 at (335, 4), image `stopBtn`; `PBRecordingTimerView` 120×32 at (17, 11).
  - QTMovieCountDown: `PBQTMovieCountdownView` 721×61 at (0, −1); a hidden 38×38 `PBShutterButton` (`stopBtn`) at (341, 8); a hidden 244×29 text field "<TIMER>" at (467, 16).
  - Every toolbar control has `NSEnabled = NO` in the nib (enabled in code once the camera runs, inferred).
- **Mode segments:** the strings give `person.crop.rectangle`, `rectangle.grid.2x2` and `video` (SF Symbols), and the tooltips "Take four quick pictures", "Take a still picture", "Record a movie clip". *Inferred* mapping: tag 0 = 4-up = `rectangle.grid.2x2`, tag 1 = still = `person.crop.rectangle`, tag 2 = movie = `video`.
- **Unknown:** the countdown view's layout and fill colour, the Effects button's exact look (`-[PBEffectsToggleButton _image:]` may use `tools-button{Left,Fill,Right}-N`).

### Window chrome from code (REA + Hopper, 2026-10-21 session 2) — observed

Analysed from a byte-identical copy of the binary (`sha256 73ed6688…`), because another, older Claude session's REA server still held the Hopper lock on the original path.
- **Toolbar** (`ev_32912766…`): `PBTextureView` is an `NSVisualEffectView`; `-viewDidMoveToWindow` sets `blendingMode 0` (**behind-window**) and `material 0x15` (21, **underWindowBackground**). So the toolbar shows the blurred desktop behind the window, which is why it varied from green-grey to red-brown across the owner's screenshot. `-[PBTabViewWithGradientBackground drawRect:]` is empty (`ev_68b36524…`). The `fs-wood-*` / `fs-curtain-*` / spotlight drawing in `PBTextureView` is the old full-screen theme (images not shipped in 13.1).
- **Tray** (`ev_c0288e4a…`): `-[PBView awakeFromNib]` sets `_trayBlendedView` to `blendingMode 1` (within-window), `material 0` (appearance-based). `PBTrayView` (an `IKImageBrowserView`, `ev_a44cf34b…`, `ev_561b2251…`): `cellSize` **90×60**, layout margin **(10, 1)**, `intercellSpacing` **(1, 1)**, layout alignment 3 when left-to-right, clear background, overlay scroller.
- **Window** (`ev_18cd1f82…`): `movableByWindowBackground` YES; content view layer black; Share button image `NSImageNameShareTemplate`, image only; `backgroundView` (the 720×480 effect view) is within-window, material 2 (dark), hidden except in some view modes and never in full screen (`updateBackgroundVisibility`, `ev_34a3f9ef…`); the toolbar view is ordered below the video view, the countdown view above it; max height = screen visible frame minus the menu bar (`+maxHeight`).
- **Aspect** (`ev_ce298b1b…`, `ev_0beef67d…`): `-[PBMainWindow _windowWidthForHeight:]` = (h − 61) × 1.5, i.e. 3:2 video. `windowWillResize:toSize:` passes the size through (constraints do the work); min size: still unknown.
- **Shutter** (`ev_66900fd7…`, `ev_f98fcae1…`, `ev_db8f5ae3…`, `ev_aaf80767…`): drawn, not a bitmap. `awakeFromNib`: disc = oval (5.5, 5.5, 50, 50), line width 1; press overlay = oval inset −0.5, black at alpha 0.5; the `shutterBtn` glyph is copied into a canvas 4 pt taller, drawn at y = 4 (so it sits 2 pt above centre). `setImageForType:colorType:` — type 0/1/2 = shutter / movie / stop glyph; colour 1 = `systemRedColor` fill and ring, white glyph; 0 = `controlBackgroundColor` fill, template glyph, `secondaryLabelColor` ring; 2 = white fill, `systemRedColor` glyph, `secondaryLabelColor` ring. `-[PBApplicationControl setRecordingOption:]` gives the live shutter colour 1 (movie glyph in movie mode); `_updateStillShutterButton` gives the viewing-tab shutter colour 0; the stop button is type 2, colour 2.

### The owner's screenshot of the real app, measured (pixels ÷ 2; Display P3, greys equal in sRGB) — observed

- Title bar `#3b3d3e` with a 1-px black hairline under it; the preview is exactly 3:2 of the window width; no line between the tray and the toolbar.
- Tray 62 pt; thumbnail 88×58 pt, 2 pt from the tray's top and bottom, 19 pt from the window's right edge.
- Movie thumbnail: video badge ≈ 11.5×7.5 pt at 4 pt from the left and bottom; "00:07" ≈ 11 pt type, 4 pt from the right and bottom (baseline).
- Effects button 96×20 pt, 20 pt below the toolbar top, 17 pt from the right; mode control 100×22 pt at (20, 19), selected segment ≈ 31.5 pt; shutter disc 50 pt, vertically centred.
- Shutter red = `#ff4f44` in sRGB (P3 `#ec5d4e`); controls read as white at ≈ 7 % (segment background) and ≈ 33 % (selected segment, Effects) over the toolbar.

### Full-screen transition (REA + Hopper, session 6) — observed

Pseudocode `ev_1188879b…` (`+[PBMainWindow fullScreenTransitionDuration]` `0x10000f98c`, `windowWillEnterFullScreen:` `0x1000108cc`, `windowDidEnterFullScreen:`, `windowWillExitFullScreen:` `0x100019ef4`, `window:startCustomAnimationToExitFullScreenWithDuration:`, `windowDidExitFullScreen:`, `fullScreenFrame`, `_enablePillarAndLetterboxing:`); selector xrefs `ev_94c4da42…`, `ev_af74be76…`, `ev_5c8626af…`, `ev_dd8c3be1…`.
- Photo Booth uses **AppKit's standard full-screen animation**: `customWindowsToEnterFullScreenForWindow:` / `…ToExit…` exist only as names in the NSWindowDelegate protocol list (their selector refs have no code references) and PBMainWindow implements neither, so AppKit never calls its `window:startCustomAnimationToExitFullScreenWithDuration:` (which just invokes a block ivar).
- Entering: `_isAnimating` = YES, the content view drops its max-height constraint, the window loses its shadow, and the width / height restriction constraints come off (pillar- and letterboxing allowed). Leaving: the reverse, plus any slideshow stops; the shadow comes back. `fullScreenFrame` = the screen's frame.
- `+fullScreenTransitionDuration` (the `NSFullScreenTransitionDuration` default, else **1.0 s**) is referenced only by its method list: unused (inferred).
- **Not in the binary:** the stock animation's own timing. **The build (session 6):** the window grows from its frame to the screen while the wallpaper, Dock and other windows slide one screen width left over black (the new Space); leaving reverses it; 0.5 s, `cubic-bezier(.4, 0, .2, 1)` — both judged, not measured. The owner should compare with the real green button.

## Q9 Menus: partly answered

- The MainMenu.nib graph (`ev_a99d3035…`, saved as `docs/study/pb-nibs.rea.json`) has **9 `NSMenu` and 51 `NSMenuItem`**. Titles are `NSLocalizableString` objects with US base text. Each item's parent menu, title and key equivalent are **observed**:
  - **Photo Booth:** About Photo Booth · Hide Photo Booth ⌘H · Hide Others ⌥⌘H · Show All · Quit Photo Booth ⌘Q (2 separators)
  - **File:** Take Photo ⌘↩ · Export... · Export Original... · Print… ⌘P (2 separators)
  - **Edit:** Undo ⌘Z · Redo ⇧⌘Z · Cut ⌘X · Copy ⌘C · Paste ⌘V · Delete ⌘⌫ · Select All ⌘A · Auto Flip New Items · Flip Photo ⌘F · Trim Movie… ⌘T · Delete All… (2 separators)
  - **View:** Show Photo ⌘1 · Show Effects ⌘2 · Show Last Effect ⌘3 · Next Page of Effects ⌘→ · Previous Page of Effects ⌘← · Reset Effect ⇧⌘R · Start Slideshow · Enter Full Screen ⌃⌘F (3 separators)
  - **Camera:** filled at runtime (`-[CameraController menuNeedsUpdate:]`)
  - **Window:** Minimize ⌘M · Close ⌘W (1 separator; macOS adds the rest)
  - **Help:** Photo Booth Help ⌘?
  - A separate context menu: Export... · Export Original... · Delete
- **Inferred:** the order inside each menu (the graph doesn't keep the `NSMenuItems` array order; loading the nib through AppKit crashed), which items are greyed out at idle, and the items macOS adds itself (Services, AutoFill, Window tiling). The result is in `public/js/menus.js`.

## Q12 Error strings: answered (observed from `Localizable.loctable` `en`, extracted in Phase 1)

| Situation | String |
|-----------|--------|
| No camera | "No Camera Available", "There is no connected camera." |
| Camera busy / off | "The camera is busy.", "The camera is off." |
| Paused | "Suspended", "Click Photo Booth to resume", "Move mouse to resume" |
| Save failure | "Photo Booth couldn’t save your photos" / "Photo Booth encountered an error when trying to save your photos. Your photos cannot be saved at this time." |
| Backdrop flow (Q7) | "Please step out of the frame.", "Background detected.", "Too much motion in background.", "Drag Backdrop Here", "Drag an image or movie onto the Background." |
| Effects browser | "Effects", "Normal", "Next Effects", "Previous Effects", "Page %1$d of %2$d pages" |
| Mode tooltips | "Take a still picture", "Take four quick pictures", "Record a movie clip" |

There's no separate "permission denied" string. Which string the camera-denied case shows hasn't been traced (inferred: "The camera is off." or "No Camera Available"). The build shows "The camera is off." for a denied permission (inferred).

## Q7: answered (negative, session 4)

Photo Booth 13.1 has no backdrops: see "The effect list, Pop Art / Cloaking Device / Hologram and the backdrops". `static.png` is Color Pencil's texture (`-[PBEffectPencil init]`), not a backdrop asset. `silhouette.pdf`'s use wasn't traced.

## Q11 Photofall: answered (REA + Hopper, session 6) — observed

From the `73ed6688…` copy. Pseudocode `ev_a18396e5…` (`-[PBTrayView _do3DAnimation:]` `0x100016978`, `_do2DAnimation:` `0x10002c7e4`, `appendNewAsset:` `0x100015d6c`), `ev_f90a53ba…` (the completion block `0x10002cd00`); selector xrefs `ev_e7b2f5b7…`, `ev_053baa6e…`; constants from `otool -tV`. The scenes were read as COLLADA text (`photofall2.dae`, `photofall.dae` in `Contents/Resources`).
- **When:** `-[PBTrayView appendNewAsset:]` (from `-[PBApplicationControl recordingController:recordedImageWithOriginal:]`, `-[PBView checkInsert:]` and one more path): marks the tray "developing", appends the asset, scrolls the last item into view **animated**, hides the new cell, and calls `_do3DAnimation:` after **0.2 s** (`performSelector:withObject:afterDelay:`).
- **`_do3DAnimation:`**: scrolls to the last item again without animation, renders the cell (IKImageBrowser's own cell drawing, all components) into an image of the cell's size, keeps the cell hidden, and adds an `SCNLayer` (zPosition **2**) to the tray's layer (which now masks to bounds) with frame = `CGRectInset((cell.x, 0, cell.w, cell.h), −10, −12)`. Scene: `photofall2.dae` unless the user default **`useAlternatePhotoAnimation`** is YES (then `photofall.dae`), loaded with `SCNSceneSourceAnimationLoadingModePlayUsingSceneTime`, not looping. The node `photo` gets the cell image as its diffuse contents (mip filter off) and scale (k·max(w/h, 1), k·max(h/w, 1), 1) with k = **0.72** (0.852 for the alternate); camera `Camera01` gets yFov = its xFov and xFov = 0 (so the scene's 45° becomes the vertical FOV). After **1.75 s** (2.5 s for the alternate) a block un-hides the real cell without animation, redraws the tray, clears "developing", posts a notification, and removes the layer.
- **`photofall2.dae`** (3ds Max 2010, "ipadLike_AR", 2011): a flat 100 × 100 photo mesh at 120.73 units from the camera (exactly the vertical view at 45°: 2·120.73·tan 22.5° = 100), facing it, plus a white ambient light. Its only animation is the photo's **translation Z** (up on screen): 51 linear keys, one per 1/30 s over 1.667 s: 89.93 → 39.40 at 1.0 s (slowing), then faster to 0 at 1.167 s, bounces of 7.47 and 2.88 units, at rest from 1.5 s. The plane stays parallel to the image plane at a fixed depth, so on screen this is a pure vertical drop: offset = Z × layer height / 100 px. With the 0.72 scale and the 24 px of vertical margin the photo is about the cell's size (for a 58 px cell: 0.72 × 82 = 59 px).
- **`photofall.dae`** (the alternate): 61 keys of `photo`, `Box01` and `Sphere01` matrices plus a morph weight bending the photo; not built (only reachable through the hidden default).
- `_do2DAnimation:` (a CALayer version) and `-[PBView startFlyingAnimationForImage:duration:]` have no callers in the code (the latter's selector is referenced only by its method list): dead code (inferred).
- **Inferred:** the photo renders unlit (the ambient light is white and the material's ambient and diffuse are white); the drop is centred on the cell (the code places the layer at y = 0 of the tray, which may shift it by a couple of pixels).
- **The build (session 6):** `fall()` in `photobooth.js` hides the new thumbnail, then 0.2 s later drops a copy of it with the 51 keys (Web Animations, linear) inside a clip of the cell ± 10 px by the tray's height, and shows the real thumbnail at 1.75 s. This replaces the inferred 0.6 s fade.

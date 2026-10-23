#!/bin/bash
# Extract real macOS assets for LARP macOS into public/assets/ and write public/assets/manifest.json.
# Idempotent: existing outputs are kept, and the manifest is rewritten only when it changes.
# Ends by checking every manifest entry against the files on disk.
# macOS built-ins only (sips, osascript (tools/img.js), plutil, afconvert, cp, curl, unzip), except the font's WOFF2
# step, which needs PY=<a Python with fonttools and brotli> when public/assets/fonts/SFNS.woff2 is missing.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=public/assets
CACHE=.cache/wallpapers   # downloaded wallpaper originals, not shipped
STUDY=docs/study          # converted files for the Phase 2 notes, not shipped
PB="/System/Applications/Photo Booth.app"
PBR="$PB/Contents/Resources"
DP="/System/Library/Desktop Pictures"
CATALOG=/System/Library/AssetsV2/com_apple_MobileAsset_DesktopPicture/com_apple_MobileAsset_DesktopPicture.xml
entries=()

img() { osascript -l JavaScript tools/img.js "$@" >/dev/null; }
slug() { echo "$1" | sed 's/ & / and /g' | tr '[:upper:]' '[:lower:]' | tr ' ' '-'; }
pixels() { sips -g pixelWidth -g pixelHeight "$1" 2>/dev/null | awk '/pixelWidth: [0-9]/{w=$2} /pixelHeight: [0-9]/{h=$2} END{if (w) print w, h}'; }  # non-images report <nil>

# gen <out> <source> <command...>: unless <out> exists, run the command with {} replaced by a temp
# path, then move it into place. Records the entry either way; $EXTRA adds JSON fields, $WANT a
# glob the "WxH" pixel size must match.
gen() {
  local out=$1 src=$2 a args=() w h tmp="${1%.*}.part.${1##*.}"   # keep the extension; sips checks it
  shift 2
  if [[ ! -s $out ]]; then
    for a in "$@"; do args+=("${a//\{\}/$tmp}"); done
    mkdir -p "$(dirname "$out")"
    "${args[@]}"
    mv "$tmp" "$out"
    echo "made ${out#$OUT/}"
  fi
  read -r w h < <(pixels "$out") || true
  if [[ -n ${WANT:-} && "${w}x${h}" != $WANT ]]; then echo "error: $out is ${w}x${h}, want $WANT" >&2; exit 1; fi
  entries+=("{\"source\": \"$src\", \"output\": \"${out#$OUT/}\"${w:+, \"width\": $w, \"height\": $h}${EXTRA:+, $EXTRA}}")
}

# Conversions; each writes its first argument.
jpeg() { sips -s format jpeg -s formatOptions 82 --resampleWidth "$3" "$2" --out "$1" >/dev/null; }
m4a() { afconvert -f m4af -d aac "$2" "$1"; }
loc_json() { plutil -extract "$3" json -o "$1" "$2"; }
cdn_heic() { # <out> <name>: fetch a wallpaper from Apple's MobileAsset catalog
  local n i url zip="$CACHE/$2.zip"
  n=$(plutil -extract Assets raw "$CATALOG")
  for ((i = 0; i < n; i++)); do
    [[ $(plutil -extract "Assets.$i.DesktopPictureID" raw "$CATALOG") == "$2" ]] || continue
    url=$(plutil -extract "Assets.$i.__BaseURL" raw "$CATALOG")$(plutil -extract "Assets.$i.__RelativePath" raw "$CATALOG")
    echo "downloading $2" >&2
    curl -fsSL --retry 3 -o "$zip" "$url"
    unzip -p "$zip" "AssetData/$2.heic" > "$1"
    rm "$zip"
    return
  done
  echo "error: $2 not in catalog" >&2; return 1
}

# 1. Dock icons (Sequoia default Dock, plus Photo Booth).
for app in /System/Library/CoreServices/Finder.app /System/Applications/Launchpad.app /Applications/Safari.app \
  /System/Applications/{Messages,Mail,Maps,Photos,FaceTime,Calendar,Contacts,Reminders,Notes,Freeform,TV,Music}.app \
  "/System/Applications/App Store.app" "/System/Applications/System Settings.app" \
  "/System/Applications/iPhone Mirroring.app" "$PB"; do
  if [[ ! -e $app ]]; then echo "skip: $app missing" >&2; continue; fi
  name=$(basename "$app" .app)
  real=$(realpath "$app")   # Safari.app is a symlink into the Cryptex; its icon would get an alias arrow
  EXTRA="\"name\": \"$name\"" WANT=256x256 gen "$OUT/icons/$(slug "$name").png" "$app" img icon {} "$real" 256
done
CT=/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources
EXTRA='"name": "Downloads"' WANT=256x256 gen "$OUT/icons/downloads.png" "$CT/DownloadsFolder.icns" img icon {} "$CT/DownloadsFolder.icns" 256
EXTRA='"name": "Trash"' WANT=256x256 gen "$OUT/icons/trash-empty.png" "$CT/TrashIcon.icns" img icon {} "$CT/TrashIcon.icns" 256
EXTRA='"name": "Trash"' WANT=256x256 gen "$OUT/icons/trash-full.png" "$CT/FullTrashIcon.icns" img icon {} "$CT/FullTrashIcon.icns" 256

# 2. Wallpapers: full size (2880 wide) and 320px thumbnails. Sequoia Sunrise is the Sequoia default.
wallpaper() { # <name> <heic-source> [cdn]
  local s full src=$2
  s=$(slug "$1"); full="$OUT/wallpapers/$s.jpg"
  if [[ ${3:-} == cdn ]]; then
    src="$CATALOG#$1"
    [[ -s $full || -s "$CACHE/$1.heic" ]] || { mkdir -p "$CACHE"; cdn_heic "$CACHE/$1.heic.part" "$1"; mv "$CACHE/$1.heic.part" "$CACHE/$1.heic"; }
    set -- "$1" "$CACHE/$1.heic"
  fi
  EXTRA="\"name\": \"$1\"${DEFAULT:+, \"default\": true}" WANT='2880x*' gen "$full" "$src" jpeg {} "$2" 2880
  EXTRA="\"name\": \"$1\"" WANT='320x*' gen "$OUT/wallpapers/thumbs/$s.jpg" "$src" jpeg {} "$full" 320
}
DEFAULT=1 wallpaper "Sequoia Sunrise" "$DP/.wallpapers/Sequoia Sunrise/Sequoia Sunrise.heic"
wallpaper "Sonoma Horizon" "$DP/.wallpapers/Sonoma Horizon/Sonoma Horizon.heic"
for name in Sonoma "Radial Sky Blue" "iMac Blue" "iMac Green" "iMac Orange" "iMac Pink" "iMac Purple" "iMac Silver" "iMac Yellow"; do
  wallpaper "$name" "$DP/$name.heic"
done
for name in "Big Sur" "Monterey Graphic" "Ventura Graphic" Catalina "The Beach" Peak Dome Iridescence "hello Blue" "Studio Color"; do
  wallpaper "$name" "" cdn
done

# 3. Photo Booth resources.
P=$OUT/photobooth
for f in "$PBR"/*.tiff "$PBR/silhouette.pdf"; do
  base=$(basename "${f%.*}")
  scale=2; [[ $base == tools-button* ]] && scale=1   # these TIFFs only have a 1x rep
  EXTRA="\"scale\": $scale" gen "$P/$base.png" "$f" img file {} "$f" $scale
done
for name in closeBtn movieBtn shutterBtn stopBtn PhotoBoothLibrary; do   # Assets.car images
  EXTRA='"scale": 2' gen "$P/$name.png" "$PBR/Assets.car#$name" img named {} "$PB" "$name" 2
done
for f in "$PBR"/{bird,small,medium,large}*.png "$PBR"/{static,thermalMap,xrayMap}.png "$PBR"/iconBtn_*.png "$PBR"/*.cikernel; do
  gen "$P/$(basename "$f")" "$f" cp "$f" {}
done
# Colour effects: each pointwise Core Image chain baked into a 64³ LUT with Apple's own filters (tools/ci.js).
lut() { osascript -l JavaScript tools/ci.js lut "$@" >/dev/null; }
for c in sepia bw thermal xray glow1 glow2; do
  WANT=512x512 gen "$P/lut/$c.png" "tools/ci.js#$c" lut {} $c
done
# Color Pencil's shading (static.png tiled, motion-blurred, greyed) doesn't depend on the camera: baked once.
WANT=640x480 gen "$P/lut/pencil.png" "tools/ci.js#pencil" lut {} pencil
gen "$P/action.m4a" "$PBR/action.aif" m4a {} "$PBR/action.aif"
# Shutter: Photo Booth plays system sound 24, which systemsoundserverd maps to Grab.aif (Phase 2, Q2).
GRAB=/System/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds/system/Grab.aif
gen "$P/shutter.m4a" "$GRAB" m4a {} "$GRAB"
gen "$P/EffectsOrdering.json" "$PBR/EffectsOrdering.plist" plutil -convert json -o {} "$PBR/EffectsOrdering.plist"
for f in "$PBR"/*.loctable; do
  # English base strings live in the Base.lproj nibs; tables without "en" fall back to en_GB.
  loc=en; plutil -extract en raw "$f" >/dev/null 2>&1 || loc=en_GB
  EXTRA="\"locale\": \"$loc\"" gen "$P/strings/$(basename "$f" .loctable).json" "$f" loc_json {} "$f" $loc
done
mkdir -p "$STUDY"
for f in "$PBR"/*.qtz; do
  [[ -s $STUDY/$(basename "$f").xml ]] || plutil -convert xml1 -o "$STUDY/$(basename "$f").xml" "$f"
done

# 4. Font (variable SF Pro; includes the Apple logo at U+F8FF), as WOFF2: 8 MB → about a third.
# The one step that isn't a built-in: PY must be a Python with fonttools and brotli (pip install fonttools brotli).
gen "$OUT/fonts/SFNS.woff2" /System/Library/Fonts/SFNS.ttf "${PY:-python3}" -m fontTools.ttLib.woff2 compress -o {} /System/Library/Fonts/SFNS.ttf

# 5. SF Symbols: black masks at 15pt, 2x, tinted in CSS with mask-image (menu bar, Settings chrome).
#    The last six are the ones Photo Booth names in its strings: mode buttons and effects paging (Phase 4/5).
for s in apple.logo wifi battery.100percent switch.2 magnifyingglass gearshape.fill person.crop.circle.fill chevron.left chevron.right \
  rectangle.grid.2x2 person.crop.rectangle video arrowtriangle.left.fill arrowtriangle.right.fill circle.fill; do
  EXTRA='"scale": 2' gen "$OUT/symbols/$s.png" "SF Symbols:$s" img symbol {} "$s" 15 2
done
# Photo Booth's Share button image is AppKit's NSImageNameShareTemplate (-[PBMainWindow awakeFromNib]).
EXTRA='"scale": 2' gen "$OUT/symbols/NSShareTemplate.png" "AppKit:NSShareTemplate" img system {} NSShareTemplate 2

# 7. System Settings sidebar icons: each pane extension's own icon, 40px (20pt at 2x).
#    General and Battery have no extractable icon; the page draws those from symbols.
EXT=/System/Library/ExtensionKit/Extensions
while IFS='|' read -r name appex; do
  EXTRA="\"name\": \"$name\"" WANT=40x40 gen "$OUT/settings/$(slug "$name").png" "$EXT/$appex.appex" img icon {} "$EXT/$appex.appex" 40
done <<'EOF'
Wi-Fi|Wi-Fi
Bluetooth|Bluetooth
Network|Network
Accessibility|AccessibilitySettingsExtension
Appearance|Appearance
Apple Intelligence & Siri|SiriPreferenceExtension
Control Center|ControlCenterSettings
Desktop & Dock|DesktopSettings
Displays|DisplaysExt
Screen Saver|Screen Saver
Spotlight|SpotlightPreferenceExtension
Wallpaper|Wallpaper
Notifications|NotificationsSettings
Sound|Sound
Focus|FocusSettingsExtension
Screen Time|ScreenTimePreferencesExtension
Lock Screen|LockScreen
Privacy & Security|SecurityPrivacyExtension
Touch ID & Password|Touch ID & Password
Users & Groups|UsersGroups
Internet Accounts|InternetAccountsSettingsExtension
Game Center|GameCenterMacOSSettingsExtension
Wallet & Apple Pay|WalletSettingsExtension
Keyboard|KeyboardSettings
Trackpad|TrackpadExtension
Printers & Scanners|PrinterScannerSettings
EOF

# 6. Cursors at 1x and 2x, with their hotspots in points: the arrow, and the window-resize cursors
#    (NSCursor frameResizeCursorFromPosition:inDirections:, macOS 15: Right 8, Bottom 4, TopLeft 3, TopRight 9).
probe=$(mktemp -d)
for c in arrow:NSCursor.arrowCursor: resize-ew:NSCursor.frameResize:8 resize-ns:NSCursor.frameResize:4 \
  resize-nwse:NSCursor.frameResize:3 resize-nesw:NSCursor.frameResize:9; do
  IFS=: read -r name src pos <<< "$c"
  [[ $src == NSCursor.frameResize ]] && src="$src:$pos"
  hotspot=$(osascript -l JavaScript tools/img.js cursor "$probe/c.png" 1 $pos | sed -E 's/.*hotspot ([0-9.]+),([0-9.]+)$/[\1, \2]/')
  EXTRA="\"scale\": 1, \"hotspot\": $hotspot" gen "$OUT/cursor/$name.png" "$src" img cursor {} 1 $pos
  EXTRA="\"scale\": 2, \"hotspot\": $hotspot" gen "$OUT/cursor/$name@2x.png" "$src" img cursor {} 2 $pos
done
rm -r "$probe"

# Manifest: rewrite only on change.
tmp=$(mktemp)
{
  printf '{\n  "assets": [\n'
  for i in "${!entries[@]}"; do
    ((i)) && printf ',\n'
    printf '    %s' "${entries[$i]}"
  done
  printf '\n  ]\n}\n'
} > "$tmp"
plutil -extract assets raw "$tmp" >/dev/null || { echo "error: bad manifest JSON in $tmp" >&2; exit 1; }
if cmp -s "$tmp" "$OUT/manifest.json"; then rm "$tmp"; else mv "$tmp" "$OUT/manifest.json"; chmod 644 "$OUT/manifest.json"; echo "manifest updated"; fi

# Self-check: every manifest entry exists with its recorded pixel size.
m=$OUT/manifest.json
n=$(plutil -extract assets raw "$m")
for ((i = 0; i < n; i++)); do
  f=$OUT/$(plutil -extract "assets.$i.output" raw "$m")
  [[ -s $f ]] || { echo "check failed: $f missing" >&2; exit 1; }
  w=$(plutil -extract "assets.$i.width" raw "$m" 2>/dev/null) || continue
  h=$(plutil -extract "assets.$i.height" raw "$m")
  [[ $(pixels "$f") == "$w $h" ]] || { echo "check failed: $f is not ${w}x$h" >&2; exit 1; }
done
echo "ok: $n assets match manifest"

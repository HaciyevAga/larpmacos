// Grabs the live preview for each effect, run inside the page by tools/shot.mjs (see tools/check-effects.sh).
// Returns { id: PNG data URL, used: { id: face-effect parameters } }; "normal" is the frame the others are compared
// against. PAGES (set by check-effects.sh for the face pass) overrides the pages and effects grabbed.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pb = document.querySelector('#photobooth'), $ = (s) => pb.querySelector(s);
const errors = [];
addEventListener('error', (e) => errors.push(e.message));
document.querySelector('[data-icon=photo-booth]').click();
for (let t = 0; $('.pb-shutter').disabled; t++) { if (t > 250) throw new Error('camera never started'); await wait(20); }
await wait(1500);   // LUTs load
const { used, FACES } = await import('/js/faces.js');
// The preview canvas has no preserveDrawingBuffer: read it in the frame callback right after Photo Booth draws, with
// the parameters of that same draw.
const grab = (id) => new Promise((r) => requestAnimationFrame(() => r([$('.pb-live').toDataURL('image/png'), used[id]])));
const out = { used: {} };
const pages = typeof PAGES !== 'undefined' ? PAGES : [[1, ['normal', 'sepia', 'blackandwhite', 'plasticcamera', 'comicbook', 'colorpencil', 'glow', 'thermalcamera', 'xray']], [2, ['bulge', 'dent', 'twirl', 'squeeze', 'lighttunnel', 'mirror', 'fisheye', 'stretch']]];
let shown = 0;
for (const [page, ids] of pages) {
  for (const id of ids) {
    $('.pb-effects').click();
    await wait(300);   // the browser zooms out
    $(`.pb-pages [data-page="${page}"]`).click();
    if (page !== shown) await wait(900);   // the pages slide
    shown = page;
    $(`.pb-grid [data-id="${id}"]`).click();
    await wait(400);
    // Face effects: wait for the tracker (MediaPipe loads on first use) and the smoothers to settle.
    for (let t = 0; FACES.has(id) && !used[id]?.length; t++) { if (t > 300) throw new Error('no face found for ' + id); await wait(50); }
    if (FACES.has(id)) await wait(1000);
    [out[id], out.used[id]] = await grab(id);
  }
}
if (errors.length) throw new Error('page errors: ' + errors);
return out;

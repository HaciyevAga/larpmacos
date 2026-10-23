// Phase 4 smoke check with Chrome's fake camera, run inside the page by tools/shot.mjs:
//   python3 -m http.server 8765 -d public &   node tools/shot.mjs .cache/check-pb.png "$(cat tools/check-photobooth.js)"
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { if (!c) throw new Error('FAIL ' + m); };
const until = async (f, ms, m) => { const t = performance.now(); while (!f()) { ok(performance.now() - t < ms, m); await wait(20); } };
const pb = document.querySelector('#photobooth'), $ = (s) => pb.querySelector(s);
const tab = () => $('.pb-bar').dataset.tab, items = () => $('.pb-strip').children.length;
const altClick = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));   // Option: no countdown
let stops = 0, saved = '';
const errors = [];
addEventListener('error', (e) => errors.push(e.message));   // e.g. a shader that fails to compile
const stop = MediaStreamTrack.prototype.stop;
MediaStreamTrack.prototype.stop = function () { stops++; return stop.call(this); };
HTMLAnchorElement.prototype.click = function () { saved = this.download; };   // catch the download instead of saving

ok($('.pb-shutter').disabled, 'no camera before Photo Booth opens');
document.querySelector('[data-icon=photo-booth]').click();
await until(() => !$('.pb-shutter').disabled, 5000, 'camera starts when the window opens');

// Still, with the countdown: the shot lands 2.9 s after the click.
const t0 = performance.now();
$('.pb-shutter').click();
await wait(100);
ok(tab() === 'countdown', 'countdown replaces the toolbar');
await until(() => items() === 1, 5000, 'photo lands in the tray');
const dt = performance.now() - t0;
ok(dt > 2850 && dt < 3400, 'shot at 2.9 s, got ' + Math.round(dt) + ' ms');
ok(document.getElementById('pb-flash').getAnimations().length === 1, 'the screen flashes');
ok(tab() === 'live', 'back to live after the shot');
ok($('.pb-thumb').style.visibility === 'hidden', 'photofall: the new cell hides while its picture drops in');
await until(() => $('.pb-fall'), 500, 'photofall starts 0.2 s after the photo lands');
await until(() => !$('.pb-fall') && !$('.pb-thumb').style.visibility, 2200, 'photofall hands over to the real cell at 1.75 s');

$('.pb-thumb').click();
ok(tab() === 'still' && !$('img.pb-item').hidden, 'clicking a thumbnail shows it');
$('.pb-share').click();
ok(/^Photo on .+ at .+\.jpg$/.test(saved), 'download uses the real name, got ' + saved);
$('.pb-thumb').click();
ok(tab() === 'live' && $('img.pb-item').hidden, 'clicking it again returns to the camera');

// 4-up.
$('[data-mode="4up"]').click();
altClick($('.pb-shutter'));
await until(() => items() === 2, 3000, '4-up lands in the tray');
const four = $('.pb-strip').lastElementChild.querySelector('img');
await four.decode();
ok(four.naturalWidth === $('.pb-live').width, '4-up is one frame in size');

// Movie: the stop button unlocks after 3 s.
$('[data-mode="movie"]').click();
altClick($('.pb-shutter'));
await until(() => tab() === 'recording', 3000, 'recording starts after the action sound');
await wait(1000);
ok($('.pb-shutter').disabled, 'stop is locked for the first 3 s');
await until(() => !$('.pb-shutter').disabled, 2500, 'stop unlocks');
$('.pb-shutter').click();
await until(() => items() === 3, 3000, 'movie lands in the tray');
$('.pb-strip').lastElementChild.click();
$('.pb-share').click();
ok(/^Movie on .+ at .+\.(mov|webm)$/.test(saved), 'movie name, got ' + saved);
$('.pb-strip').lastElementChild.click();
$('[data-mode="still"]').click();

// Effects browser: page 3 holds the ported kernels; picking one applies it to the live view.
$('.pb-effects').click();
ok(tab() === 'effects' && !$('.pb-grid').hidden, 'Effects opens the browser');
const full = $('.pb-grid .full, .pb-grid .top').getBoundingClientRect(), view = $('.pb-view').getBoundingClientRect();
ok(full.width > view.width / 2, 'the current effect starts over the whole view and shrinks into its slot');
await wait(300);
const cell = $('.pb-grid [data-id="normal"]').getBoundingClientRect();
ok(Math.abs(cell.width - (view.width - 12) / 3) < 0.6 && Math.abs(cell.left - view.left - (view.width - 12) / 3 - 6) < 0.6, 'PageLayer: margins and gaps of 3, got ' + [cell.left - view.left, cell.width]);
$('.pb-pages [data-page="1"]').click();   // the colour effects: LUTs and blur passes compile and draw
await wait(700);
$('.pb-pages [data-page="2"]').click();
const tiles = [...$('.pb-grid').children].slice(18).map((t) => t.dataset.id);
ok(tiles[4] === 'normal' && tiles[7] === 'fisheye', 'page 3 has Normal in the centre, got ' + tiles);
ok($('.pb-pages .dot:last-child').dataset.page === '2', '3 pages: the 24 effects -[RendererController effectList] loads');
await wait(700);
$('.pb-pages [data-step="1"]').click();
ok($('.pb-pages .dot.on').dataset.page === '0', 'the next arrow wraps from the last page to the first');
await wait(1000);   // 0.6 + 0.25 s back across page 2
$('.pb-pages [data-step="-1"]').click();   // wraps back to page 3
await wait(1000);
$('.pb-grid [data-id="mirror"]').click();
ok(tab() === 'effects', 'the picked tile zooms in first');
await wait(300);
ok(tab() === 'live' && $('.pb-grid').hidden, 'picking an effect returns to the camera');
await wait(300);
const sliderOff = () => $('.pb-slider').classList.contains('off'), move = () => $('.pb-view').dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
move();
ok(sliderOff(), 'no slider for Mirror');
// Slider (REA): shows over the live preview for an effect that wants one, hides 1 s after the pointer stops.
$('.pb-effects').click();
await wait(300);
$('.pb-grid [data-id="bulge"]').click();
await wait(300);
move();
ok(!sliderOff(), 'slider shows for Bulge');
const range = $('.pb-slider input');
range.value = 0.9;
range.dispatchEvent(new Event('input'));
await wait(1150);
ok(sliderOff(), 'slider hides 1 s after the pointer stops');
pb.dispatchEvent(new Event('reset'));
ok(range.value === '0.5', 'Reset Effect puts the slider back to 0.5, got ' + range.value);
$('.pb-effects').click();
await wait(300);
$('.pb-grid [data-id="normal"]').click();
await wait(300);

ok(performance.getEntriesByType('resource').every((e) => e.name.replace(/^blob:/, '').startsWith(location.origin + '/')), 'nothing loads from another host');
// Closing mid-countdown stops the camera and cancels the shot; the tray lives for the session.
$('.pb-shutter').click();
await wait(800);
pb.querySelector('.close').click();
ok(stops >= 1, 'camera tracks stop when the window closes');
await wait(2500);
document.querySelector('[data-icon=photo-booth]').click();
await until(() => !$('.pb-shutter').disabled, 5000, 'camera restarts on reopen');
ok(items() === 3 && tab() === 'live', 'no shot after closing mid-countdown; tray kept');
ok(!errors.length, 'no page errors: ' + errors);

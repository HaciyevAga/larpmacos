// Phase 3 smoke check, run inside the page by tools/shot.mjs:
//   python3 -m http.server 8765 -d public &   node tools/shot.mjs .cache/check.png "$(cat tools/check-shell.js)"
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { if (!c) throw new Error('FAIL ' + m); };
const dot = (icon) => document.querySelector(`[data-icon=${icon}]`).classList.contains('running');

document.querySelector('[data-icon=photo-booth]').click(); await wait(900);
const pb = document.querySelector('#photobooth');
ok(!pb.hidden && dot('photo-booth'), 'Photo Booth opens with a running dot');
ok(!dot('safari'), 'apps that are not running have no dot');

const bar = pb.querySelector('.titlebar'), r = bar.getBoundingClientRect();
bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: r.left + 300, clientY: r.top + 10, pointerId: 1 }));
bar.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + 300, clientY: -200, pointerId: 1 }));
bar.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
ok(pb.offsetTop === 24, 'drag stops at the menu bar, got ' + pb.offsetTop);

// Resize from an edge or corner: the preview stays 3:2 (height = width / 1.5 + 88) and the opposite edge stays put.
const html = document.documentElement, box = () => [pb.offsetLeft, pb.offsetTop, pb.offsetWidth, pb.offsetHeight];
const resize = (x0, y0, x1, y1) => {   // returns the cursor shown over the grab point
  const t = document.elementFromPoint(x0, y0), ev = (type, x, y, el = t) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }));
  ev('pointermove', x0, y0);
  const cursor = html.dataset.resize;
  ev('pointerdown', x0, y0); ev('pointermove', x1, y1, html); ev('pointerup', x1, y1, html);
  return cursor;
};
let [L, T, W, H] = box();
ok(resize(L + W + 2, T + H + 2, L + W + 122, T + H + 2) === 'nwse', 'corner shows the nwse cursor, 2 px outside the border');
ok(String(box()) === String([L, T, 840, 648]), 'corner drag keeps 3:2 and the top-left, got ' + box());
[L, T, W, H] = box();
ok(resize(L + 1, T + 300, L - 59, T + 300) === 'ew', 'left edge shows the ew cursor');
ok(String(box()) === String([L - 60, T, 900, 688]), 'left edge drag anchors the right edge, got ' + box());
[L, T, W, H] = box();
ok(resize(L + 400, T + 2, L + 400, T - 300) === 'ns', 'top edge shows the ns cursor');
ok(String(box()) === String([L, 24, W, H]), 'top edge cannot pull the window under the menu bar, got ' + box());
[L, T, W, H] = box();
resize(L + W, T + 300, 0, T + 300);
ok(String(box()) === String([L, T, 480, 408]), 'minimum width 480, got ' + box());
ok(resize(L + 200, T + 200, L + 200, T + 200) === undefined, 'no resize cursor inside the window');

// Full screen: the window grows from its frame while the desktop slides away left (macOS's own transition).
pb.querySelector('.lights .zoom').click(); await wait(250);
const mid = pb.getBoundingClientRect(), wp = document.querySelector('#wallpaper').getBoundingClientRect();
ok(mid.width > 480 && mid.width < innerWidth - 1 && wp.right < innerWidth && wp.right > 0, 'mid-transition: window growing, desktop sliding, got ' + [mid.width, wp.right]);
await wait(350);
ok(String(Object.values(pb.getBoundingClientRect().toJSON()).slice(0, 4)) === String([0, 0, innerWidth, innerHeight]), 'full screen covers the screen');
pb.querySelector('.lights .zoom').click(); await wait(600);
ok(String(box()) === String([L, T, 480, 408]), 'leaving full screen restores the frame, got ' + box());

document.querySelector('#menus button.app').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
[...document.querySelectorAll('.menu .item')].find((i) => i.textContent.startsWith('Quit')).click(); await wait(300);
ok(pb.hidden && !dot('photo-booth'), 'Quit Photo Booth closes the window and clears the dot');
ok(document.querySelector('#menus button.app').textContent === 'Finder', 'menu bar falls back to Finder');

document.querySelector('[data-icon=system-settings]').click(); await wait(900);
document.querySelector('#settings .grid img[title=Peak]').click();
for (let t = 0; t < 100 && localStorage.getItem('wallpaper') !== 'Peak'; t++) await wait(100);  // saved once the full image decodes, slower off localhost
ok(localStorage.getItem('wallpaper') === 'Peak', 'wallpaper choice saved');
ok(document.querySelector('#wallpaper').style.backgroundImage.includes('peak.jpg'), 'wallpaper applied');
localStorage.removeItem('wallpaper');

const st = document.querySelector('#settings');
st.querySelector('.close').click();
ok(st.hidden && getComputedStyle(st).display !== 'none', 'a closed window fades out before it disappears');
await wait(300);
ok(getComputedStyle(st).display === 'none', 'the faded window is gone after 0.2 s');
document.querySelector('#wallpaper').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 }));
const change = [...document.querySelectorAll('.menu .item')].find((i) => i.textContent === 'Change Wallpaper…');
ok(change, 'right-clicking the desktop shows Change Wallpaper…');
change.click(); await wait(300);
ok(!st.hidden && !document.querySelector('.menu'), 'Change Wallpaper… opens System Settings');

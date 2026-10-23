// LARP macOS desktop shell: gate, full screen, menu bar, Dock, windows, System Settings → Wallpaper.
import { MENUS, parseItem } from './menus.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const MENUBAR_H = 24;

// SF Symbol masks (see .sym in macos.css).
function sym(name, w, h_) { const i = h('i', 'sym'); i.dataset.sym = name; i.style.cssText = `--w:${w}px;--h:${h_}px`; paintSym(i); return i; }
function paintSym(i) { i.style.webkitMaskImage = i.style.maskImage = `url(assets/symbols/${i.dataset.sym}.png)`; }
$$('[data-sym]').forEach(paintSym);

// ---------- Gate: desktop browsers only ----------
function gate() {
  const small = innerWidth < 1024 || innerHeight < 640;
  document.body.classList.toggle('gated', small || !matchMedia('(any-pointer: fine)').matches);
}
addEventListener('resize', gate); gate();

// ---------- Real full screen on the first click (and again after Esc) ----------
// On click, not pointerdown: the full-screen resize moves things under the pointer before pointerup, which ate the
// first Dock click.
document.addEventListener('click', () => {
  if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    .then(() => navigator.keyboard?.lock?.(['Escape'])).catch(() => {});   // Chrome: Esc must be held to leave
}, true);
// Right-click: Finder's desktop menu on the desktop (items as in macOS 15, inferred), nothing elsewhere.
const DESKTOP_MENU = ['New Folder', '---', 'Get Info', '---', 'Change Wallpaper…', 'Edit Widgets…', '---', 'Use Stacks', 'Sort By ▸', 'Clean Up', 'Clean Up By ▸', 'Show View Options'];
addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (e.target.id === 'wallpaper' || e.target.id === 'desktop') showMenu(DESKTOP_MENU, null, e.clientX, e.clientY);
});

// ---------- Clock ----------
const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
function tick() {
  const now = new Date(), [d, t] = $$('#clock span');
  d.textContent = dateFmt.format(now).replace(/,/g, '');
  t.textContent = timeFmt.format(now);
  setTimeout(tick, 60000 - (now % 60000) + 20);
}
tick();

// ---------- Menu bar ----------
const menusEl = $('#menus');
let openMenu = null;   // { button, el }
const ACTIONS = {
  'Quit Photo Booth': () => closeWin('photobooth'),
  'Take Photo': () => wins.photobooth.dispatchEvent(new Event('shoot')),   // handled in photobooth.js
  'Reset Effect': () => wins.photobooth.dispatchEvent(new Event('reset')),
  'System Settings…': () => openWin('settings'),
  'Change Wallpaper…': () => openWin('settings'),
};
const APPLE_MENU = ['About This Mac', '---', 'System Settings…', 'App Store…', '---', 'Recent Items ▸', '---', 'Force Quit…\t⌥⌘⎋', '---', 'Sleep', 'Restart…', 'Shut Down…', '---', 'Lock Screen\t⌃⌘Q', 'Log Out…\t⇧⌘Q'];

function renderMenubar(app) {
  closeMenu();
  menusEl.replaceChildren();
  const apple = h('button', 'apple'); apple.append(sym('apple.logo', 14, 17)); apple.items = APPLE_MENU;
  menusEl.append(apple);
  MENUS[app].forEach(([title, items], i) => {
    const b = h('button', i === 0 ? 'app' : '', title); b.items = items;
    menusEl.append(b);
  });
}

// A menu under a menu-bar button, or (button = null) a context menu at (x, y).
function showMenu(items, button, x, y) {
  closeMenu();
  const el = h('div', 'menu');
  if (button?.textContent === 'Help') {
    const s = h('div', 'help-search'); s.append(h('div', '', 'Search'), h('span')); el.append(s);
  }
  for (const raw of items) {
    const it = parseItem(raw);
    if (it.sep) { el.append(h('div', 'sep')); continue; }
    const row = h('div', 'item' + (it.disabled ? ' off' : '') + (it.checked ? ' check' : ''));
    row.append(h('span', '', it.title));
    if (it.key) row.append(h('span', 'key', it.key));
    if (it.sub) row.append(sym('chevron.right', 6, 10));
    if (!it.disabled && !it.sub) row.addEventListener('click', () => choose(row, it.title));
    el.append(row);
  }
  document.body.append(el);
  if (button) {
    const r = button.getBoundingClientRect();
    [x, y] = [r.left, r.bottom + 1];
    button.classList.add('open');
  }
  el.style.left = Math.min(x, innerWidth - el.offsetWidth - 4) + 'px';
  el.style.top = Math.min(y, innerHeight - el.offsetHeight - 4) + 'px';
  openMenu = { button, el };
}

function closeMenu() {
  if (!openMenu) return;
  openMenu.button?.classList.remove('open');
  openMenu.el.remove();
  openMenu = null;
}

// macOS flashes the chosen item once before the menu closes.
function choose(row, title) {
  row.classList.add('blinkoff');
  setTimeout(() => row.classList.replace('blinkoff', 'blink'), 70);
  setTimeout(() => { closeMenu(); ACTIONS[title]?.(); }, 140);
}

menusEl.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  openMenu?.button === b ? closeMenu() : showMenu(b.items, b);
});
menusEl.addEventListener('pointerover', (e) => {
  const b = e.target.closest('button');
  if (b && openMenu?.button && openMenu.button !== b) showMenu(b.items, b);
});
document.addEventListener('pointerdown', (e) => { if (openMenu && !e.target.closest('.menu, #menus')) closeMenu(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

// ---------- Windows ----------
const wins = { settings: $('#settings'), photobooth: $('#photobooth') };
let front = null;   // null = Finder (desktop)
let z = 10;

function activate(id) {
  front = id;
  for (const [k, w] of Object.entries(wins)) w.classList.toggle('active', k === id);
  if (id) wins[id].style.zIndex = ++z;
  renderMenubar(id ?? 'finder');
}

function openWin(id) {
  const w = wins[id];
  if (w.hidden) {
    w.hidden = false;
    if (!w.style.left) {   // first open: centred, a little above the middle
      w.style.left = Math.round((innerWidth - w.offsetWidth) / 2) + (id === 'settings' ? 40 : 0) + 'px';
      w.style.top = Math.max(MENUBAR_H + 12, Math.round((innerHeight - w.offsetHeight) * 0.35)) + 'px';
    }
    w.dispatchEvent(new Event('open'));   // Photo Booth starts its camera on this
  }
  activate(id);
  renderDock();
}

function closeWin(id) {
  const w = wins[id];
  if (w.hidden) return;
  if (w.classList.contains('fullscreen')) toggleFullscreen(id);
  w.hidden = true;
  w.dispatchEvent(new Event('close'));    // ...and stops it on this
  const next = Object.keys(wins).filter((k) => !wins[k].hidden).sort((a, b) => wins[b].style.zIndex - wins[a].style.zIndex)[0];
  activate(front === id ? next ?? null : front);
  renderDock();
}

// macOS's own full-screen transition: Photo Booth adds none (REA: no customWindowsToEnterFullScreenForWindow:, and its
// +fullScreenTransitionDuration is never called). The window grows to fill the screen while the desktop slides away
// left into the new Space; leaving reverses it. ponytail: duration and easing judged from macOS, not measured.
const FS = { duration: 500, easing: 'cubic-bezier(.4, 0, .2, 1)' };
function toggleFullscreen(id) {
  const w = wins[id], a = w.getBoundingClientRect();
  const on = w.classList.toggle('fullscreen');
  document.body.classList.toggle('fs', on);
  document.body.classList.remove('reveal');
  const b = w.getBoundingClientRect();
  w.animate({ transformOrigin: ['0 0', '0 0'], transform: [`translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`, 'none'] }, FS);
  const away = ['translateX(0)', 'translateX(-100vw)'];
  for (const el of [$('#wallpaper'), $('#dock'), ...Object.values(wins).filter((x) => x !== w && !x.hidden)]) el.animate({ transform: on ? away : away.reverse() }, FS);
}

// In full screen the menu bar (and the window's title bar) slide in when the pointer touches the top edge.
document.addEventListener('pointermove', (e) => {
  const b = document.body;
  if (!b.classList.contains('fs')) return;
  if (e.clientY <= 2) b.classList.add('reveal');
  else if (e.clientY > MENUBAR_H + 40 && !openMenu) b.classList.remove('reveal');
});

for (const [id, w] of Object.entries(wins)) {
  w.addEventListener('pointerdown', () => { if (front !== id) activate(id); });
  w.querySelector('.close').addEventListener('click', () => closeWin(id));
  w.querySelector('.min').addEventListener('click', () => closeWin(id));
  const zoom = w.querySelector('.zoom');
  if (!zoom.hasAttribute('data-off')) zoom.addEventListener('click', () => toggleFullscreen(id));

  // Drag by the title bar / toolbar (Photo Booth: movableByWindowBackground, so its control bar too); never above the menu bar.
  for (const bar of $$('.titlebar, .pb-bar', w)) {
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.lights, button') || w.classList.contains('fullscreen')) return;
      const sx = e.clientX - w.offsetLeft, sy = e.clientY - w.offsetTop;
      bar.setPointerCapture(e.pointerId);
      const move = (ev) => {
        w.style.left = Math.min(innerWidth - 80, Math.max(80 - w.offsetWidth, ev.clientX - sx)) + 'px';
        w.style.top = Math.min(innerHeight - 40, Math.max(MENUBAR_H, ev.clientY - sy)) + 'px';
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', () => bar.removeEventListener('pointermove', move), { once: true });
    });
  }
}
$('#wallpaper').addEventListener('pointerdown', () => activate(null));

// Photo Booth resizes from any edge or corner. The preview stays 3:2 (observed in the real app) between the 28 px
// title bar and the 60 px toolbar; the opposite edge stays put. Hit-tested here because the window clips its children.
// ponytail: grab zone 4 px either side of the border, 12 px along each edge for corners, min width 480: all inferred.
const PB = wins.photobooth, PB_CHROME = 88, PB_ASPECT = 1.5, PB_MIN_W = 480, GRAB = 4, CORNER = 12;
const CURSOR = { n: 'ns', s: 'ns', e: 'ew', w: 'ew', ne: 'nesw', sw: 'nesw', nw: 'nwse', se: 'nwse' };
let sizing = null;

function edgeAt(e) {
  if (PB.hidden || PB.classList.contains('fullscreen') || e.target.closest?.('#menubar, #dock, .menu')) return '';
  const over = e.target.closest?.('.window');
  if (over && over !== PB && +over.style.zIndex > +PB.style.zIndex) return '';   // another window is in front here
  const r = PB.getBoundingClientRect(), x = e.clientX, y = e.clientY;
  if (x < r.left - GRAB || x > r.right + GRAB || y < r.top - GRAB || y > r.bottom + GRAB) return '';
  const n = y <= r.top + GRAB, s = y >= r.bottom - GRAB, w = x <= r.left + GRAB, ee = x >= r.right - GRAB;
  const nc = y <= r.top + CORNER, sc = y >= r.bottom - CORNER, wc = x <= r.left + CORNER, ec = x >= r.right - CORNER;
  return (n || (nc && (w || ee)) ? 'n' : s || (sc && (w || ee)) ? 's' : '') + (w || (wc && (n || s)) ? 'w' : ee || (ec && (n || s)) ? 'e' : '');
}

function resizeTo(width, edge, start) {
  const maxW = Math.min(innerWidth, edge.includes('n') ? (start.bottom - MENUBAR_H - PB_CHROME) * PB_ASPECT : Infinity);
  const w = Math.round(Math.max(PB_MIN_W, Math.min(maxW, width))), hh = Math.round(w / PB_ASPECT) + PB_CHROME;
  PB.style.width = w + 'px';
  PB.style.height = hh + 'px';
  PB.style.left = (edge.includes('w') ? start.right - w : start.left) + 'px';
  PB.style.top = (edge.includes('n') ? start.bottom - hh : start.top) + 'px';
}

addEventListener('pointermove', (e) => {
  if (sizing) {
    const { edge, start, x, y } = sizing;
    const dx = (e.clientX - x) * (edge.includes('w') ? -1 : 1), dy = (e.clientY - y) * (edge.includes('n') ? -1 : 1);
    const byX = /[ew]/.test(edge) ? start.width + dx : 0, byY = /[ns]/.test(edge) ? (start.height + dy - PB_CHROME) * PB_ASPECT : 0;
    return resizeTo(Math.max(byX, byY), edge, start);
  }
  const edge = edgeAt(e);
  if (edge) document.documentElement.dataset.resize = CURSOR[edge]; else delete document.documentElement.dataset.resize;
});

addEventListener('pointerdown', (e) => {
  const edge = e.button === 0 && edgeAt(e);
  if (!edge) return;
  e.preventDefault();
  e.stopPropagation();   // not a title-bar drag or a click on what's under the border
  closeMenu();
  activate('photobooth');
  const start = { left: PB.offsetLeft, top: PB.offsetTop, width: PB.offsetWidth, height: PB.offsetHeight };
  sizing = { edge, x: e.clientX, y: e.clientY, start: { ...start, right: start.left + start.width, bottom: start.top + start.height } };
  document.documentElement.setPointerCapture(e.pointerId);
}, true);

for (const t of ['pointerup', 'pointercancel']) addEventListener(t, () => { sizing = null; });

// ---------- Dock ----------
const DOCK = [
  ['finder', 'Finder'], ['launchpad', 'Launchpad'], ['safari', 'Safari'], ['messages', 'Messages'], ['mail', 'Mail'],
  ['maps', 'Maps'], ['photos', 'Photos'], ['facetime', 'FaceTime'], ['calendar', 'Calendar'], ['contacts', 'Contacts'],
  ['reminders', 'Reminders'], ['notes', 'Notes'], ['freeform', 'Freeform'], ['tv', 'TV'], ['music', 'Music'],
  ['app-store', 'App Store'], ['system-settings', 'System Settings'], ['iphone-mirroring', 'iPhone Mirroring'],
  ['photo-booth', 'Photo Booth'], null, ['downloads', 'Downloads'], ['trash-empty', 'Trash'],
];
const LAUNCH = { 'system-settings': 'settings', 'photo-booth': 'photobooth' };
const dockNav = $('#dock nav');
for (const entry of DOCK) {
  if (!entry) { dockNav.append(h('div', 'dock-sep')); continue; }
  const [icon, name] = entry, item = h('div', 'dock-item'), img = h('img');
  img.src = `assets/icons/${icon}.png`; img.alt = ''; img.draggable = false;
  img.onerror = () => item.remove();   // app missing on the source Mac
  item.dataset.icon = icon;
  item.append(img, h('span', 'label', name));
  item.addEventListener('click', () => launch(item));
  dockNav.append(item);
  if (icon === 'calendar') liveCalendar(img);
}

function launch(item) {
  const icon = item.dataset.icon, id = LAUNCH[icon];
  if (icon === 'finder') return activate(null);
  if (!id) return;   // the rest of the Dock is for show
  if (!wins[id].hidden) return activate(id);
  item.classList.add('bounce');
  setTimeout(() => openWin(id), 450);
  setTimeout(() => item.classList.remove('bounce'), 1100);
}

function renderDock() {
  for (const item of $$('.dock-item', dockNav)) {
    const id = LAUNCH[item.dataset.icon];
    item.classList.toggle('running', item.dataset.icon === 'finder' || Boolean(id && !wins[id].hidden));
  }
}

// The extracted Calendar icon shows a fixed date; repaint the month and day like the real Dock does.
async function liveCalendar(img) {
  const now = new Date();
  await document.fonts.load('600 42px "SF Pro"');
  const base = new Image(); base.src = 'assets/icons/calendar.png'; await base.decode();
  const c = h('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.drawImage(base, 0, 0);
  g.drawImage(c, 70, 36, 1, 52, 80, 36, 96, 52);     // stretch a clean column of the red band over "JUL"
  g.drawImage(c, 60, 100, 1, 110, 60, 100, 136, 110); // and of the white page over "17"
  g.textAlign = 'center';
  g.fillStyle = '#fff'; g.font = '600 42px "SF Pro"';
  g.fillText(now.toLocaleDateString(undefined, { month: 'short' }).replace('.', '').toUpperCase(), 128, 73);
  g.fillStyle = 'rgb(50,50,50)'; g.font = '300 128px "SF Pro"';
  g.fillText(now.getDate(), 127, 200);
  img.src = c.toDataURL();
  const midnight = new Date(now); midnight.setHours(24, 0, 5, 0);
  setTimeout(() => liveCalendar(img), midnight - now);
}

// ---------- System Settings → Wallpaper ----------
const SIDEBAR = [
  ['Wi-Fi', 'Bluetooth', 'Network', ['Battery', 'battery.100percent', '#34c759', 14, 7]],
  [['General', 'gearshape.fill', 'linear-gradient(#a2a2a7, #7e7e83)', 13, 13], 'Accessibility', 'Appearance', 'Apple Intelligence & Siri', 'Control Center', 'Desktop & Dock', 'Displays', 'Screen Saver', 'Spotlight', 'Wallpaper'],
  ['Notifications', 'Sound', 'Focus', 'Screen Time'],
  ['Lock Screen', 'Privacy & Security', 'Touch ID & Password', 'Users & Groups'],
  ['Internet Accounts', 'Game Center', 'Wallet & Apple Pay'],
  ['Keyboard', 'Trackpad', 'Printers & Scanners'],
];
const slug = (s) => s.replace(/ & /g, ' and ').toLowerCase().replace(/ /g, '-');
const sbList = $('#settings .sb-list');
const account = h('div', 'account'), who = h('div');
who.append(h('b', '', 'Sign in'), h('small', '', 'with your Apple Account'));
account.append(sym('person.crop.circle.fill', 30, 30), who);
sbList.append(account);
for (const group of SIDEBAR) {
  sbList.append(h('div', 'gap'));
  for (const entry of group) {
    const row = h('div', 'row');
    if (Array.isArray(entry)) {   // no extractable icon: SF Symbol on a coloured tile
      const [name, symbol, bg, w, hh] = entry, tile = h('span', 'tile');
      tile.style.setProperty('--bg', bg); tile.append(sym(symbol, w, hh));
      row.append(tile, h('span', '', name));
    } else {
      const img = h('img'); img.src = `assets/settings/${slug(entry)}.png`; img.alt = ''; img.draggable = false;
      row.append(img, h('span', '', entry));
      if (entry === 'Wallpaper') row.classList.add('sel');
    }
    sbList.append(row);
  }
}

// Wallpapers come from the asset manifest; the section split is a guess at Sequoia's grouping.
const DYNAMIC = ['Sequoia Sunrise', 'Sonoma Horizon', 'Sonoma', 'Big Sur', 'Catalina'];
const wallEl = $('#wallpaper'), mb = $('#menubar');
let walls = [];

async function setWallpaper(w, save = true) {
  const full = new Image(); full.src = w.full;
  await full.decode().catch(() => {});
  wallEl.style.backgroundImage = `url("${w.full}")`;
  mb.dataset.tone = await tone(w.thumb);
  $('#settings .current img').src = w.thumb;
  $('#settings .current .name').textContent = w.name;
  for (const t of $$('#settings .grid img')) t.classList.toggle('sel', t.title === w.name);
  if (save) store.set('wallpaper', w.name);
}

// Menu bar text follows the wallpaper behind it: white on dark, black on light.
async function tone(src) {
  const img = new Image(); img.src = src; await img.decode().catch(() => {});
  const c = h('canvas'); c.width = 32; c.height = 2;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight * .06, 0, 0, 32, 2);
  const d = g.getImageData(0, 0, 32, 2).data;
  let sum = 0; for (let i = 0; i < d.length; i += 4) sum += .2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2];
  return sum / (d.length / 4) / 255 > .6 ? 'light' : 'dark';
}

mb.dataset.tone = 'dark';
fetch('assets/manifest.json').then((r) => r.json()).then(({ assets }) => {
  walls = assets.filter((a) => /^wallpapers\/[^/]+$/.test(a.output))
    .map((a) => ({ name: a.name, full: 'assets/' + a.output, thumb: 'assets/' + a.output.replace('wallpapers/', 'wallpapers/thumbs/'), default: a.default }));
  const box = $('#settings .walls');
  for (const [title, list] of [['Dynamic Wallpapers', walls.filter((w) => DYNAMIC.includes(w.name))], ['Pictures', walls.filter((w) => !DYNAMIC.includes(w.name))]]) {
    const grid = h('div', 'grid');
    for (const w of list) {
      const t = h('img'); t.src = w.thumb; t.title = w.name; t.alt = w.name; t.draggable = false;
      t.addEventListener('click', () => setWallpaper(w));
      grid.append(t);
    }
    box.append(h('h3', '', title), grid);
  }
  const saved = store.get('wallpaper');
  setWallpaper(walls.find((w) => w.name === saved) ?? walls.find((w) => w.default) ?? walls[0], false);
});

activate(null);
renderDock();

// Photo Booth: camera → mirrored WebGL preview; still, 4-up and movie capture with the real countdown,
// flash and sounds; the tray (filmstrip); viewing and downloading. Media never leaves the page.
// Timings, names and strings come from docs/photobooth-findings.md (Q1–Q4, Q10, Q12).
import { EFFECTS, NAMES, SLIDER } from './effects.js';
import { FACES, track, faceUniforms, atlas } from './faces.js';

const $ = (s, el = document) => el.querySelector(s);
const win = $('#photobooth'), view = $('.pb-view', win), bar = $('.pb-bar', win);
const canvas = $('.pb-live', view), still = $('img.pb-item', view), player = $('video.pb-item', view);
const msg = $('.pb-msg', view), tray = $('.pb-tray', view), strip = $('.pb-strip', tray);
const shutter = $('.pb-shutter', bar), count = $('.pb-count', bar), timer = $('.pb-timer', bar);
const grid = $('.pb-grid', view), pages = $('.pb-pages', bar), effectsBtn = $('.pb-effects', bar);
const A = 'assets/photobooth/';

// Findings Q1: 0.5 s lead-in, then three 0.8 s ticks, each with a 0.4 s note; the shot is taken at 2.9 s.
const LEAD_IN = 0.5, TICK = 0.8, NOTE = 0.4;
// +[PBCameraFlash defaultFlash] = CGDisplayVisualBell(0.04, 0.2, 0.24, 1.0); read as fade in, hold, fade out (inferred).
const FLASH = [0.04, 0.2, 0.24];
// 4-up: -[PBAnimationController _save] waits shutterDelay (= 0.04 + 0.2) between shots, 0 with the flash off.
// ponytail: assumes the flash call returns at once; if the real gap looks longer, add the flash's 0.48 s here.
const SHUTTER_DELAY = FLASH[0] + FLASH[1];
const MIN_MOVIE = 3;                 // +[PBQTMovieAsset minimumRecordingDuration]
const ASPECT = 720 / 480;            // PBView's frame in MainMenu.nib; frames are cropped to it (inferred)
const QUALITY = 0.9;                 // JPEG compression Photo Booth uses: unknown

// ---------- Camera ----------
const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
let stream = null, mic = null, session = 0, raf = 0;

win.addEventListener('open', async () => {
  const id = ++session;
  if (!gl) return fail({ name: 'NoWebGL' });   // no point asking for the camera
  loadLuts();
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
    if (id !== session) return s.getTracks().forEach((t) => t.stop());   // window closed while the prompt was up
    stream = s;
    s.getVideoTracks()[0].onended = () => fail({});
    video.srcObject = s;
    await video.play();
    size();
    msg.hidden = true;
    enable(true);
    raf = requestAnimationFrame(frame);
  } catch (e) {
    if (id === session) fail(e);
  }
});

win.addEventListener('close', () => {
  session++;
  cancelAnimationFrame(raf);
  cancel();
  showLive();
  browse(false);
  for (const s of [stream, mic]) s?.getTracks().forEach((t) => t.stop());
  stream = mic = null;
  video.srcObject = null;
  enable(false);
});

// The toolbar is disabled until the camera runs (NSEnabled = NO in the nib).
function enable(on) {
  for (const b of bar.querySelectorAll('button')) b.disabled = !on;
}

// Strings from Localizable.loctable (Q12). Photo Booth has no "permission denied" text; "The camera is off." is a guess.
function fail(e) {
  const [title, detail] = {
    NotAllowedError: ['The camera is off.', ''],
    NotReadableError: ['The camera is busy.', ''],
    NoWebGL: ['Photo Booth can’t start', 'Turn on hardware acceleration in your browser’s settings.'],   // ours: a Mac never lacks a GPU
  }[e.name]
    ?? ['No Camera Available', 'There is no connected camera.'];
  $('b', msg).textContent = title;
  $('span', msg).textContent = detail;
  msg.hidden = false;
  enable(false);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

// ---------- Rendering: video → texture → effect shader, mirrored ----------
const gl = canvas.getContext('webgl', { alpha: false, antialias: false });   // null without WebGL: open shows an error
const VS = 'attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }';
const COLOR = `precision highp float;
vec3 lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 enc(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
`;
const HEAD = COLOR + `uniform sampler2D uTex, uLut, uA, uB, uC, uD; uniform vec2 uSize, uOrigin, uPoint; uniform vec4 uMap; uniform float uParam, uPreview;
uniform vec4 uFace[108]; uniform float uCount;
vec4 src(vec2 q) { return texture2D(uTex, uMap.xy + q / uSize * uMap.zw); }
vec4 buf(sampler2D s, vec2 q) { return texture2D(s, q / uSize); }
vec2 edge(vec2 q) { vec2 d = 1.0 - abs(2.0 * fract(0.5 * (q - 0.5) / uSize) - 1.0); return d * (uSize - 1.0) + 0.5; }
// 64³ LUT in a 512×512 texture: 8×8 tiles of 64×64, blue = tile, red/green = position in the tile (tools/ci.js).
vec4 lut(vec4 c) {
  vec3 v = clamp(c.rgb, 0.0, 1.0) * 63.0;
  float b0 = floor(v.b), b1 = min(b0 + 1.0, 63.0);
  vec2 rg = (v.rg + 0.5) / 512.0;
  vec3 lo = texture2D(uLut, vec2(mod(b0, 8.0), floor(b0 / 8.0)) / 8.0 + rg).rgb;
  vec3 hi = texture2D(uLut, vec2(mod(b1, 8.0), floor(b1 / 8.0)) / 8.0 + rg).rgb;
  return vec4(mix(lo, hi, v.b - b0), 1.0);
}
vec4 effect(vec2 p) {`;
const MAIN = '}\nvoid main() { gl_FragColor = effect(gl_FragCoord.xy - uOrigin); }';
// Blur in two steps: average blocks of about k×k pixels, then a separable Gaussian (two passes) at 1/k size with
// sigma/k ≤ 3.
// Values are premultiplied linear light, stored sRGB-encoded; past the edges counts as transparent (Core Image).
const DOWN = COLOR + `uniform sampler2D uIn; uniform vec4 uInMap; uniform vec2 uInSize, uK; uniform float uN;
void main() {
  vec2 o = floor(gl_FragCoord.xy) * uK;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 24; i++) {
    if (float(i) >= uN) break;
    for (int j = 0; j < 24; j++) {
      if (float(j) >= uN) break;
      vec4 t = texture2D(uIn, uInMap.xy + (o + (vec2(i, j) + 0.5) * uK / uN) / uInSize * uInMap.zw);
      acc += vec4(lin(t.rgb), t.a);
    }
  }
  acc /= uN * uN;
  gl_FragColor = vec4(enc(acc.rgb), acc.a);
}`;
const GAUSS = COLOR + `uniform sampler2D uIn; uniform vec2 uDir, uOut; uniform float uSigma;
void main() {
  vec2 uv = gl_FragCoord.xy / uOut;
  vec4 acc = vec4(0.0);
  float sum = 0.0;
  for (int i = -10; i <= 10; i++) {
    float t = float(i), w = exp(-0.5 * t * t / (uSigma * uSigma));
    vec2 q = uv + t * uDir / uOut;
    sum += w;
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) continue;
    vec4 c = texture2D(uIn, q);
    acc += w * vec4(lin(c.rgb), c.a);
  }
  acc /= sum;
  gl_FragColor = vec4(enc(acc.rgb), acc.a);
}`;
const UNIFORMS = ['uSize', 'uOrigin', 'uPoint', 'uMap', 'uParam', 'uPreview', 'uFace', 'uCount','uIn', 'uInMap', 'uInSize', 'uK', 'uN', 'uDir', 'uOut', 'uSigma'];
// Texture units: 0 camera, 1 LUT, then one per buffer.
const UNITS = { src: 0, a: 2, b: 3, c: 4, d: 5, t1: 6, t2: 7 };
const programs = {}, luts = {}, buffers = new Map();
let effect = 'normal', crop = [0, 0, 1, 1];
// Each effect keeps its own slider value and centre, as each has its own PBEffect renderer (inferred). Defaults:
// -[PBEffect init] sliderValue 0.5; inputXY 0.5, 0.5 (Effect.qtz; -[PBView resetEffect:] sets the same three).
const state = {};
const fx = (name = effect) => (state[name] ??= { slider: 0.5, x: 0.5, y: 0.5 });
const passes = (e) => (Array.isArray(e) ? e : [typeof e === 'string' ? { glsl: e } : e]);

function texture(unit) {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  return t;
}

if (gl) {
  texture(0);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);   // bottom-left origin, like Core Image
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}

// The LUTs load once, when Photo Booth first opens; until then their effects draw black. 'sprites' is the face
// effects' sprite atlas (faces.js), uploaded premultiplied.
function loadLuts() {
  for (const e of Object.values(EFFECTS)) for (const { lut } of passes(e)) {
    if (!lut || luts[lut]) continue;
    luts[lut] = texture(1);
    const upload = (img) => {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, luts[lut]);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);   // the PNG's values are the table
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, lut === 'sprites');
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    };
    if (lut === 'sprites') atlas(A).then(upload);
    else Object.assign(new Image(), { onload: (e) => upload(e.target), src: `${A}lut/${lut}.png` });
  }
}

function program(key, fragment) {
  if (programs[key]) return programs[key];
  const p = gl.createProgram();
  for (const [type, text] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fragment]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, text);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${key}: ${gl.getShaderInfoLog(s)}`);
    gl.attachShader(p, s);
  }
  gl.bindAttribLocation(p, 0, 'a');
  gl.linkProgram(p);
  gl.useProgram(p);
  for (const [k, unit] of [['uTex', 0], ['uLut', 1], ['uA', 2], ['uB', 3], ['uC', 4], ['uD', 5]]) gl.uniform1i(gl.getUniformLocation(p, k), unit);
  const u = {};
  for (const k of UNIFORMS) u[k] = gl.getUniformLocation(p, k);
  return (programs[key] = { p, u });
}

// A w×h render target, bound to its buffer's texture unit.
// ponytail: one set per size, dropped wholesale past 48 (window resizes make new tile sizes).
function buffer(name, w, h) {
  const key = `${name} ${w}x${h}`;
  if (!buffers.has(key)) {
    if (buffers.size > 48) {
      for (const b of buffers.values()) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fb); }
      buffers.clear();
    }
    const tex = texture(UNITS[name]), fb = gl.createFramebuffer();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    buffers.set(key, { tex, fb });
  }
  const b = buffers.get(key);
  gl.activeTexture(gl.TEXTURE0 + UNITS[name]);
  gl.bindTexture(gl.TEXTURE_2D, b.tex);
  return b;
}

function target(b, w, h) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb);
  gl.viewport(0, 0, w, h);
}

// Gaussian blur of `from` (a w×h buffer, or the camera frame) into buffer `out`, at about 1/k size.
function blur(from, out, sigma, w, h) {
  const k = Math.max(1, Math.ceil(sigma / 3)), bw = Math.max(1, Math.round(w / k)), bh = Math.max(1, Math.round(h / k));
  let { p, u } = program('down', DOWN);
  const t1 = buffer('t1', bw, bh);
  if (from !== 'src') buffer(from, w, h);   // rebind it: another size may have taken its unit
  target(t1, bw, bh);
  gl.useProgram(p);
  gl.uniform1i(u.uIn, UNITS[from]);
  gl.uniform4fv(u.uInMap, from === 'src' ? crop : [0, 0, 1, 1]);
  gl.uniform2f(u.uInSize, w, h);
  gl.uniform2f(u.uK, w / bw, h / bh);
  gl.uniform1f(u.uN, Math.ceil(Math.max(w / bw, h / bh)));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  ({ p, u } = program('gauss', GAUSS));
  gl.useProgram(p);
  gl.uniform2f(u.uOut, bw, bh);
  gl.uniform1f(u.uSigma, Math.max(sigma / k, 0.01));
  for (const [src, dst, dir] of [['t1', 't2', [1, 0]], ['t2', out, [0, 1]]]) {
    const b = buffer(dst, bw, bh);
    target(b, bw, bh);
    gl.uniform1i(u.uIn, UNITS[src]);
    gl.uniform2fv(u.uDir, dir);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

// Crop the camera frame to the preview's aspect at full camera resolution, and mirror it (Effect.qtz: ScaleX −1).
function size() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const w = Math.min(vw, Math.round(vh * ASPECT)), h = Math.min(vh, Math.round(vw / ASPECT));
  canvas.width = w;
  canvas.height = h;
  const cw = w / vw, ch = h / vh;
  crop = [(1 + cw) / 2, (1 - ch) / 2, -cw, ch];   // u runs right to left: mirrored
}

// Runs an effect's passes at w×h; the last one draws into the canvas at (x, y), faded to alpha over what's there.
// preview: an effects-browser tile.
function draw(name = effect, x = 0, y = 0, w = canvas.width, h = canvas.height, preview = false, alpha = 1) {
  passes(EFFECTS[name]).forEach((s, i, all) => {
    if (s.blur) return blur(s.blur, s.out, s.sigma(w, h), w, h);
    const last = i === all.length - 1;
    if (last) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(x, y, w, h);
    } else target(buffer(s.out, w, h), w, h);
    const { p, u } = program(`${name} ${i}`, HEAD + s.glsl + MAIN);
    gl.useProgram(p);
    if (s.lut) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, luts[s.lut]);
    }
    gl.uniform2f(u.uSize, w, h);
    gl.uniform2f(u.uOrigin, last ? x : 0, last ? y : 0);
    const { slider: amount, x: px, y: py } = fx(name);
    gl.uniform2f(u.uPoint, px, py);
    gl.uniform4fv(u.uMap, crop);
    gl.uniform1f(u.uParam, amount);
    gl.uniform1f(u.uPreview, preview ? 1 : 0);
    if (FACES.has(name)) {
      const [data, n] = faceUniforms(name, w, h, preview ? 'tile ' + name : name);
      gl.uniform4fv(u.uFace, data);
      gl.uniform1f(u.uCount, n);
    }
    if (last && alpha < 1) {
      gl.enable(gl.BLEND);
      gl.blendColor(0, 0, 0, alpha);
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  });
}

function upload() {
  gl.activeTexture(gl.TEXTURE0);
  if (video.readyState >= 2) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
}

function frame() {
  if (!stream) return;
  upload();
  // Faces are tracked only while a face effect shows (the first page of the browser holds all eight).
  if (browsing ? page === 0 || moving() : FACES.has(effect)) track(video, crop);
  if (browsing) drawTiles(); else draw();
  raf = requestAnimationFrame(frame);
}

// The frame as shown (mirrored, with the effect) at camera resolution. Drawn now, so the WebGL buffer is fresh.
function snap() {
  const c = Object.assign(document.createElement('canvas'), { width: canvas.width, height: canvas.height });
  upload();
  draw();
  c.getContext('2d').drawImage(canvas, 0, 0);
  return c;
}

// ---------- Sound ----------
const SHUTTER = new Audio(A + 'shutter.m4a');   // system sound 24 = Grab.aif (Q2)
const ACTION = new Audio(A + 'action.m4a');     // NSSound "action", played before a movie starts (Q4)
let ac = null, wave = null;

function play(sound, then) {
  const a = sound.cloneNode();
  if (then) a.onended = a.onerror = then;
  a.play().catch(() => then?.());   // Photo Booth starts recording at once if the sound can't play
}

// Stand-in for PBNotePlayer, which plays the DLS synth: GM program 35 (Fretless Bass), note 80, velocity 115, 0.4 s.
// The real beep is that synth's sample; this is a rough additive approximation of a soft bass pluck.
function beep(t) {
  ac ??= new AudioContext();
  ac.resume();
  wave ??= ac.createPeriodicWave(new Float32Array(5), new Float32Array([0, 1, 0.4, 0.15, 0.05]));
  const o = ac.createOscillator(), g = ac.createGain(), v = 0.5 * (115 / 127) ** 2;
  o.setPeriodicWave(wave);
  o.frequency.value = 440 * 2 ** ((80 - 69) / 12);   // MIDI 80 = G#5, 830.6 Hz
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + 0.008);
  g.gain.exponentialRampToValueAtTime(v * 0.35, t + NOTE);
  g.gain.setTargetAtTime(0, t + NOTE, 0.04);          // note off, then release
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + NOTE + 0.3);
  return g;
}

// ---------- Flash: CGDisplayVisualBell whitens the whole screen ----------
const flashEl = Object.assign(document.createElement('div'), { id: 'pb-flash' });
document.body.append(flashEl);
function flash() {
  const [i, hold, o] = FLASH, t = i + hold + o;
  flashEl.animate([{ opacity: 0 }, { opacity: 1, offset: i / t }, { opacity: 1, offset: (i + hold) / t }, { opacity: 0 }], t * 1000);
}

// ---------- Toolbar tabs (the nib's NSTabView items) ----------
const TABS = {
  live: '.pb-modes, .pb-shutter, .pb-effects',    // LiveVideo
  still: '.pb-modes, .pb-shutter, .pb-share',     // Still: viewing a photo or movie
  countdown: '.pb-count',                         // CountDown / QTMovieCountDown
  recording: '.pb-shutter, .pb-timer',            // MovieRecording
  effects: '.pb-modes, .pb-pages, .pb-effects',   // effects browser ("mosaic"); page indicator in the shutter's place is inferred
};
function tab(name) {
  bar.dataset.tab = name;
  for (const el of bar.children) el.hidden = !el.matches(TABS[name]);
}
tab('live');

// ---------- Effects browser ("mosaic"): pages of 3×3 live tiles, Normal in each centre ----------
// -[RendererController effectList] (REA) = +[PBEffectFace effects] + Color + Distortion, in this order: 24 effects, 3 pages.
// EffectsOrdering.plist's other 16 (Quartz Composer effects, backdrops) are never loaded; the binary doesn't name the file.
// Motion (REA, findings "Effects browser"): the pages sit side by side and slide together (ease-in-out, 0.6 s plus
// 0.25 s per extra page); opening and closing zooms the effect's tile between its slot and the whole view while the
// other tiles fade (0.25 s, Core Animation's default timing = CSS ease). Holding Shift doubles every duration.
// CSS runs the motion (PageLayer's maths in macos.css); drawTiles() draws each effect into its button's moving box.
const order = ['space alien', 'nose twirl', 'chipmunk', 'lovestruck', 'dizzy', 'blockhead', 'bug out', 'frog',
  'sepia', 'blackandwhite', 'plasticcamera', 'comicbook', 'colorpencil', 'glow', 'thermalcamera', 'xray',
  'bulge', 'dent', 'twirl', 'squeeze', 'mirror', 'lighttunnel', 'fisheye', 'stretch'];
const PAGES = order.length / 8, dots = pages.children[1];
let page = 0, browsing = false, settled = 0, closing = 0;
for (let p = 0; p < PAGES; p++) {
  const ids = order.slice(p * 8, p * 8 + 8);
  ids.splice(4, 0, 'normal');
  ids.forEach((id, i) => {
    const t = Object.assign(document.createElement('button'), { innerHTML: `<span>${NAMES[id]}</span>` });
    t.dataset.id = id;
    t.style.cssText = `--p:${p};--c:${i % 3};--r:${Math.floor(i / 3)}`;
    grid.append(t);
  });
  const d = Object.assign(document.createElement('button'), { className: 'dot', title: `Page ${p + 1} of ${PAGES} pages` });
  d.dataset.page = p;
  dots.append(d);
}
const slow = (e) => (e?.shiftKey ? 2 : 1);              // sub_100007524: Shift held → twice as long
const moving = () => performance.now() < settled;      // -[VideoLayer transitioning]: clicks wait
const hold = (s) => (settled = Math.max(settled, performance.now() + s * 1000));
const tileOf = (id) => (id === 'normal' ? grid.children[page * 9 + 4] : grid.querySelector(`[data-id="${id}"]`));

effectsBtn.addEventListener('click', (e) => moving() || browse(!browsing, slow(e)));
grid.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t || moving()) return;
  effect = t.dataset.id;
  setRange();
  browse(false, slow(e));
});
// Arrows wrap around (-[PBEffectPageIndicatorView goPreviousNextPage:]); a dot goes to its page (pageClicked:).
pages.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) turn(b.dataset.step ? page + Number(b.dataset.step) : Number(b.dataset.page), slow(e));
});
// -[PBView scrollWheel:]: in the browser, a sideways scroll turns one page when the gesture begins.
// ponytail: browsers report no gesture phase, so a scroll after 300 ms of quiet counts as a new gesture.
let wheelAt = -1e9;
grid.addEventListener('wheel', (e) => {
  const fresh = e.timeStamp - wheelAt > 300;
  wheelAt = e.timeStamp;
  if (fresh && Math.abs(e.deltaX) > Math.abs(e.deltaY)) turn(page + Math.sign(e.deltaX), slow(e));
}, { passive: true });

// k scales the animation; 0 jumps (closing the window, taking a picture).
function browse(on, k = 0) {
  clearTimeout(closing);
  if (on) {
    if (busy || viewing) return;
    browsing = true;
    showSlider(false);
    view.classList.add('browsing');
    effectsBtn.classList.add('on');
    tray.hidden = true;
    grid.hidden = false;
    tab('effects');
    turn(page, 0);
    for (const t of grid.children) t.classList.toggle('sel', t.dataset.id === effect);
    // -[VideoLayer switchFromEffect:animate:]: the effect's tile starts over the whole view and shrinks into place.
    const t = tileOf(effect);
    zoom(t, true, 0);
    grid.offsetWidth;   // commit the start state so the change below transitions
    zoom(t, false, k);
  } else if (browsing && k) {
    // -[VideoLayer switchToEffect:animate:]: the picked tile grows over the whole view, then the live view takes over.
    zoom(tileOf(effect), true, k);
    closing = setTimeout(browse, 250 * k, false);
  } else {
    browsing = false;
    view.classList.remove('browsing');
    effectsBtn.classList.remove('on');
    grid.hidden = true;
    tray.hidden = !strip.children.length;
    if (!busy) tab('live');
  }
}

function zoom(tile, full, k) {
  grid.style.setProperty('--k', k);
  grid.classList.toggle('zoom', full);
  for (const t of grid.children) {
    t.classList.toggle('full', full && t === tile);
    t.classList.toggle('top', t === tile);
  }
  hold(0.25 * k);
}

// -[VideoLayer _windowGoToPage:animate:]
function turn(n, k = 1) {
  n = (n + PAGES) % PAGES;
  if (n !== page && k) hold(k * (0.6 + 0.25 * (Math.abs(n - page) - 1)));
  grid.style.setProperty('--slide', n === page ? '0s' : k * (0.6 + 0.25 * (Math.abs(n - page) - 1)) + 's');
  grid.style.setProperty('--page', page = n);
  [...dots.children].forEach((d, i) => d.classList.toggle('on', i === n));
}

// Each tile renders its effect live into the canvas rectangle under its button, faded with it; the zooming one last.
function drawTiles() {
  const box = canvas.getBoundingClientRect(), kx = canvas.width / box.width, ky = canvas.height / box.height;
  const top = grid.querySelector('.top'), tiles = [...grid.children].filter((t) => t !== top);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT);
  for (const t of top ? [...tiles, top] : tiles) {
    const r = t.getBoundingClientRect(), a = Number(getComputedStyle(t).opacity);
    if (!a || r.right <= box.left || r.left >= box.right) continue;
    draw(t.dataset.id, Math.round((r.left - box.left) * kx), Math.round((box.bottom - r.bottom) * ky), Math.round(r.width * kx), Math.round(r.height * ky), true, a);
  }
}

// ---------- Slider and centre point (REA: PBView, PBTransparentSlider, EffectLayer) ----------
// -[PBView mouseMoved:] → _updateSlider: in the live view (viewMode 3, inferred) the slider shows while the pointer is
// over the preview and the effect wants one, and hides when it leaves; after each move, _autoHideSlider: hides it
// 1.0 s later if the pointer hasn't moved. The slider's action (_takeValueFrom:) sets the renderer's sliderValue.
const slider = $('.pb-slider', view), range = $('input', slider);
let hideTimer = 0;
const live = () => stream && !browsing && !viewing;
const showSlider = (on) => slider.classList.toggle('off', !on);
function setRange() {
  range.value = fx().slider;
  range.style.setProperty('--f', (range.value - range.min) / (range.max - range.min));
}
view.addEventListener('pointermove', () => {
  clearTimeout(hideTimer);
  const on = live() && SLIDER.has(effect);
  showSlider(on);
  // ponytail: not while the knob is held (the real one would hide if held still for a second).
  if (on) hideTimer = setTimeout(() => range.matches(':active') || showSlider(false), 1000);
});
view.addEventListener('pointerleave', () => { clearTimeout(hideTimer); showSlider(false); });
range.addEventListener('input', () => { fx().slider = Number(range.value); setRange(); });

// -[EffectLayer onMouseDragged:]: dragging (not clicking) on the preview sets inputXY = point / bounds, clamped to 0–1
// by -[PBEffect setInputXY:]. The point is taken on the picture as drawn (object-fit: cover), origin bottom-left.
let dragging = false;
canvas.addEventListener('pointerdown', (e) => (dragging = e.button === 0 && live()));
addEventListener('pointerup', () => (dragging = false));
addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const r = canvas.getBoundingClientRect(), k = Math.max(r.width / canvas.width, r.height / canvas.height);
  const w = canvas.width * k, h = canvas.height * k, clamp = (v) => Math.min(1, Math.max(0, v)), p = fx();
  p.x = clamp((e.clientX - r.left - (r.width - w) / 2) / w);
  p.y = clamp((r.bottom - (r.height - h) / 2 - e.clientY) / h);
});
win.addEventListener('reset', () => {   // View → Reset Effect
  Object.assign(fx(), { slider: 0.5, x: 0.5, y: 0.5 });
  setRange();
});
setRange();

// counter 3, 2, 1 lights that numeral; 0 lights the camera; 4 lights nothing (PBCountdownView).
function light(n, icon) {
  [...count.children].forEach((el, i) => el.classList.toggle('on', 3 - i === n));
  count.lastElementChild.src = A + icon + '.png';
}

// ---------- Capture ----------
let mode = 'still', busy = false, timers = [], notes = [], recorder = null;
const later = (s, fn) => timers.push(setTimeout(fn, s * 1000));

for (const b of bar.querySelectorAll('[data-mode]')) {
  b.addEventListener('click', () => {
    if (busy) return;
    mode = bar.dataset.mode = b.dataset.mode;
    for (const o of bar.querySelectorAll('[data-mode]')) o.classList.toggle('on', o === b);
    // Ask for the microphone now, so the prompt doesn't land in the middle of a recording.
    if (mode === 'movie' && !mic) navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => (stream ? (mic = s) : s.getTracks().forEach((t) => t.stop())), () => {});
  });
}
bar.dataset.mode = mode;

shutter.addEventListener('click', (e) => (recorder ? stopMovie() : shoot(e)));
win.addEventListener('shoot', () => shoot());   // File → Take Photo
addEventListener('keydown', (e) => {
  if (!win.classList.contains('active')) return;
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) shoot(e);
  if (e.key === 'Escape' && viewing) showLive();
});

// -[PBApplicationControl takeSnapshot:]: Option skips the countdown, Shift skips the flash.
function shoot(e = {}) {
  if (!stream || busy) return;
  showLive();
  browse(false);
  busy = true;
  const noFlash = e.shiftKey, go = { still: () => takeStill(noFlash), '4up': () => take4up(noFlash), movie: startMovie }[mode];
  if (e.altKey) return go();
  const icon = mode === 'movie' ? 'countdown-video' : 'countdown-cam';
  tab('countdown');
  light(4, icon + '_dim');
  const t0 = (ac ??= new AudioContext()).currentTime + LEAD_IN;
  for (let i = 0; i < 3; i++) {
    later(LEAD_IN + i * TICK, () => light(3 - i, icon + '_dim'));
    notes.push(beep(t0 + i * TICK));
  }
  later(LEAD_IN + 3 * TICK, () => { light(0, icon); go(); });
}

function fire(noFlash) {   // -[PBPhotoController record:]: frame first, then flash and sound
  if (!noFlash) flash();
  play(SHUTTER);   // whether Shift also silences the shutter is unknown
}

function takeStill(noFlash) {
  const c = snap();
  fire(noFlash);
  c.toBlob((b) => add('photo', b), 'image/jpeg', QUALITY);
  done();
}

// Four shots; the countdown camera fills a quarter per shot taken (countdown-4up-1…3, mapping inferred).
function take4up(noFlash) {
  const frames = [];
  tab('countdown');
  light(0, 'countdown-cam');
  const shot = () => {
    count.lastElementChild.src = A + (frames.length ? `countdown-4up-${frames.length}` : 'countdown-cam') + '.png';
    frames.push(snap());
    fire(noFlash);
    if (frames.length < 4) return later(noFlash ? 0 : SHUTTER_DELAY, shot);
    // The combined "(compiled)" image: 2×2 at the size of one frame. Real layout and size are unknown (Q3).
    const c = Object.assign(document.createElement('canvas'), { width: frames[0].width, height: frames[0].height }), g = c.getContext('2d');
    frames.forEach((f, i) => g.drawImage(f, (i % 2) * c.width / 2, (i >> 1) * c.height / 2, c.width / 2, c.height / 2));
    c.toBlob((b) => add('4up', b), 'image/jpeg', QUALITY);
    done();
  };
  shot();
}

const MIME = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => window.MediaRecorder?.isTypeSupported(t));

function startMovie() {
  let started = false;
  // Recording starts when the 0.057 s action sound ends. Some audio stacks report "ended" seconds late
  // (headless Firefox with a mic open: ~3.8 s), so don't wait longer than 0.25 s.
  later(0.25, begin);
  play(ACTION, begin);
  function begin() {
    if (started || !busy) return;
    started = true;
    const out = canvas.captureStream(30), chunks = [], poster = snap();
    mic?.getAudioTracks().forEach((t) => out.addTrack(t));
    const rec = (recorder = new MediaRecorder(out, MIME && { mimeType: MIME }));
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      out.getVideoTracks().forEach((t) => t.stop());
      if (rec.keep) add('movie', new Blob(chunks, { type: rec.mimeType }), poster, Math.round((performance.now() - t0) / 1000));
    };
    rec.start();
    tab('recording');
    // The stop button stays disabled (but not dimmed) for the minimum duration.
    shutter.disabled = true;
    later(MIN_MOVIE, () => (shutter.disabled = false));
    const t0 = performance.now(), pad = (n) => String(n).padStart(2, '0');
    const tick = () => {
      const s = Math.floor((performance.now() - t0) / 1000);
      timer.textContent = `${pad(Math.floor(s / 3600) % 100)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
    };
    tick();
    timers.push(setInterval(tick, 250));
  }
}

function stopMovie() {
  recorder.keep = true;
  recorder.stop();
  recorder = null;
  done();
}

function done() {
  timers.forEach(clearTimeout);   // clearTimeout also clears intervals
  timers = [];
  notes = [];
  busy = false;
  tab(viewing ? 'still' : 'live');
}

function cancel() {
  notes.forEach((g) => g.disconnect());
  recorder?.stop();   // not kept
  recorder = null;
  done();
}

// ---------- Tray (session-only library) ----------
const used = {};
let viewing = null;

// +[PBAsset generateAssetFilenameForAssetClass:] (Q10): short date and short time in the user's locale,
// then "/" → "-" and ":" → "."; repeats get " #2", " #3", …
function filename(kind, ext) {
  const now = new Date(), f = (o) => new Intl.DateTimeFormat(undefined, o).format(now);
  const base = `${{ photo: 'Photo', '4up': '4-up', movie: 'Movie' }[kind]} on ${f({ dateStyle: 'short' })} at ${f({ timeStyle: 'short' })}`
    .replaceAll('/', '-').replaceAll(':', '.');
  used[base] = (used[base] ?? 0) + 1;
  return base + (used[base] > 1 ? ` #${used[base]}` : '') + ext;
}

function add(kind, blob, poster, seconds) {
  // ponytail: Photo Booth writes .mov; an MP4 recording keeps that name (QuickTime reads it), WebM can't.
  const item = { kind, url: URL.createObjectURL(blob), name: filename(kind, kind !== 'movie' ? '.jpg' : /mp4/.test(blob.type) ? '.mov' : '.webm') };
  const thumb = Object.assign(document.createElement('button'), { className: 'pb-thumb ' + kind, title: item.name });
  thumb.append(Object.assign(new Image(), { src: poster ? poster.toDataURL('image/jpeg', 0.8) : item.url, alt: '' }));
  // Movies show their length bottom-right, e.g. "00:07" (observed in the real app; rounding inferred).
  if (seconds != null) thumb.append(Object.assign(document.createElement('span'), { className: 'dur', textContent: `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` }));
  thumb.addEventListener('click', () => (viewing === item ? showLive() : show(item, thumb)));
  item.thumb = thumb;
  strip.append(thumb);
  tray.hidden = false;
  strip.scrollTo({ left: strip.scrollWidth, behavior: 'smooth' });
  fall(thumb);
}

// Photofall (Q11, REA): -[PBTrayView appendNewAsset:] hides the new cell and scrolls to it; 0.2 s later _do3DAnimation:
// drops a picture of the cell into place with photofall2.dae (photofall.dae only with the hidden default
// useAlternatePhotoAnimation). That scene moves the photo plane only along Z, parallel to the camera at a fixed depth,
// so on screen it's a straight drop with bounces. Its SceneKit layer is the cell plus 10 / 12 px margins and 100 scene
// units high (45° vertical FOV at 120.73); the photo is 0.72 of that. At 1.75 s the real cell shows again.
// photofall2.dae, node-photo translation.Z: one key every 1/30 s, linear.
const FALL = [89.93, 84.8, 80.53, 77.07, 74.32, 72.15, 70.21, 68.77, 67.45, 66.18, 64.92, 63.68, 62.44, 61.2, 59.97, 58.73,
  57.5, 56.26, 55.02, 53.77, 52.52, 51.27, 50, 48.73, 47.45, 46.15, 44.84, 43.52, 42.17, 40.8, 39.4, 35.91, 31.08, 24.74,
  15.99, 0, 4.02, 6.45, 7.47, 6.53, 3.99, 0, 1.86, 2.88, 1.88, 0, 0, 0, 0, 0, 0];
function fall(thumb) {
  thumb.style.visibility = 'hidden';
  setTimeout(() => {
    strip.scrollLeft = strip.scrollWidth;   // scrollLastItemToVisibleWithAnimation:NO
    const r = thumb.getBoundingClientRect(), t = tray.getBoundingClientRect(), u = (r.height + 24) / 100;   // px per unit
    const clip = Object.assign(document.createElement('div'), { className: 'pb-fall' });
    clip.style.cssText = `left:${r.left - t.left - 10}px;width:${r.width + 20}px`;
    const img = Object.assign(new Image(), { src: thumb.firstChild.src, alt: '' });
    img.style.cssText = `left:10px;top:${r.top - t.top}px;width:${r.width}px;height:${r.height}px;scale:${(72 * u) / r.height}`;
    clip.append(img);
    tray.append(clip);
    img.animate(FALL.map((z) => ({ translate: `0 ${-z * u}px` })), (FALL.length - 1) / 30 * 1000);
    setTimeout(() => {
      thumb.style.visibility = '';
      clip.remove();
    }, 1750);
  }, 200);
}

function show(item, thumb) {
  if (busy) return;
  viewing = item;
  for (const t of strip.children) t.classList.toggle('sel', t === thumb);
  const movie = item.kind === 'movie';
  still.hidden = movie;
  player.hidden = !movie;
  if (movie) { player.src = item.url; player.play().catch(() => {}); } else still.src = item.url;
  tab('still');
}

function showLive() {
  if (!viewing) return;
  viewing.thumb.classList.remove('sel');
  viewing = null;
  still.hidden = player.hidden = true;
  player.pause();
  player.removeAttribute('src');
  tab('live');
}

player.addEventListener('click', () => (player.paused ? player.play() : player.pause()));

// Share downloads the file under Photo Booth's own name.
$('.pb-share', bar).addEventListener('click', () => {
  if (!viewing) return;
  const a = Object.assign(document.createElement('a'), { href: viewing.url, download: viewing.name });
  document.body.append(a);   // Firefox only downloads from an attached link
  a.click();
  a.remove();
});

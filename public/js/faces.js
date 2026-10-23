// Face tracking and Photo Booth's eight face effects (docs/photobooth-findings.md, "Face effects").
// MediaPipe Face Landmarker stands in for Vision's FaceCore tracker. It runs in the page from vendor/mediapipe/
// (@mediapipe/tasks-vision 1.1.0 + face_landmarker.task float16 v1; its usage logger is patched to never send), so
// frames never leave the browser. Each effect's -processFace:forImage: is ported to JS and turns the faces into
// uniforms for effects.js: bump / twirl parameters, or one transform per heart or bird sprite.

// ---------- Tracking ----------
const V = 'vendor/mediapipe/';
let landmarker = null, loading = null, lastFrame = -1;
let tracked = [];   // raw faces, like -[PBFace updateWithVisionResult:…]: normalized, origin bottom-left

function load() {
  const create = (delegate) => import('../vendor/mediapipe/vision_bundle.mjs').then(({ FaceLandmarker }) =>
    FaceLandmarker.createFromOptions({ wasmLoaderPath: V + 'vision_wasm_internal.js', wasmBinaryPath: V + 'vision_wasm_internal.wasm' },
      { baseOptions: { modelAssetPath: V + 'face_landmarker.task', delegate }, runningMode: 'VIDEO', numFaces: 3 }));
  loading ??= create('GPU').catch(() => create('CPU')).then((l) => (landmarker = l), (e) => console.error('face tracking unavailable:', e));
}

// Tracks the faces in the current video frame. crop = the texture rectangle the effect frame shows (photobooth.js),
// which maps a frame point (x, y) to the video at (crop[0] + x·crop[2], 1 − (crop[1] + y·crop[3])).
export function track(video, crop) {
  if (!landmarker) return load();
  if (video.currentTime === lastFrame) return;   // the same camera frame again
  lastFrame = video.currentTime;
  const at = ([u, v]) => [(u - crop[0]) / crop[2], (1 - v - crop[1]) / crop[3]];
  tracked = landmarker.detectForVideo(video, performance.now()).faceLandmarks.map((lm) => {
    const pt = (i) => at([lm[i].x, lm[i].y]);
    const xs = lm.map((p) => at([p.x, p.y]));
    const x0 = Math.min(...xs.map((p) => p[0])), x1 = Math.max(...xs.map((p) => p[0]));
    const y0 = Math.min(...xs.map((p) => p[1])), y1 = Math.max(...xs.map((p) => p[1]));
    // ponytail: FaceCore's box is approximated by the landmarks' extent, its eye points by the irises (468, 473) and
    // its mouth by the inner lips' midpoint (13, 14); "leftEye" is the one with the smaller x, so the angle is ≈ 0.
    const eyes = [pt(468), pt(473)].sort((a, b) => a[0] - b[0]);
    const mouth = pt(13).map((v, k) => (v + pt(14)[k]) / 2);
    return { center: [(x0 + x1) / 2, (y0 + y1) / 2], radius: 0.5 * (x1 - x0), le: eyes[0], re: eyes[1], mouth,
      angle: eyes[1][0] !== eyes[0][0] ? Math.atan2(eyes[1][1] - eyes[0][1], eyes[1][0] - eyes[0][0]) : 0 };
  });
}

// ---------- PBFace ----------
// -[PBEffectSmoothener value:forTime:]: holds the last value while the input stays within the tolerance; otherwise
// eases towards it over `ms` (t in seconds).
class Smoother {
  constructor(ms, tol) { Object.assign(this, { ms, tol, v: 0, t: 0 }); }
  value(v, t) {
    if (Math.abs(v - this.v) <= this.tol) { this.t = t; return this.v; }
    if (this.t < t && this.t + this.ms / 1000 > t) {
      const f = (1000 * (t - this.t)) / this.ms;
      v = f * v + (1 - f) * this.v;
    }
    Object.assign(this, { v, t });
    return v;
  }
}
const sm = (ms, tol) => new Smoother(ms, tol);

// Smoothed accessors. Points: the optional block runs on the normalized point, then x and y are smoothed in pixels.
class Face {
  s = { lx: sm(50, 20), ly: sm(50, 20), rx: sm(50, 20), ry: sm(50, 20), mx: sm(50, 5), my: sm(50, 5), cx: sm(10, 10), cy: sm(10, 10),
    radius: sm(50, 0.05), angle: sm(50, 0.05), eye: sm(50, 0.1) };
  radius() { return this.s.radius.value(this.raw.radius, this.t); }
  angle() { return this.s.angle.value(this.raw.angle, this.t); }
  eyeAmount() { return this.s.eye.value(1.2 * this.radius(), this.t); }
  at(p, x, y, W, H, block = (q) => q) { const q = block(p); return [this.s[x].value(q[0] * W, this.t), this.s[y].value(q[1] * H, this.t)]; }
  leftEye(W, H, block) { return this.at(this.raw.le, 'lx', 'ly', W, H, block); }
  rightEye(W, H, block) { return this.at(this.raw.re, 'rx', 'ry', W, H, block); }
  mouth(W, H) { return this.at(this.raw.mouth, 'mx', 'my', W, H); }
  center(W, H) { return this.at(this.raw.center, 'cx', 'cy', W, H); }
}

// ---------- The effects ----------
// applyBump:forCenter:radiusScale:scale: = CIBumpDistortion with radius 0.75 × radiusScale × the frame's diagonal.
const bump = (out, W, H, [x, y], k, scale) => out.push(x, y, 0.75 * k * Math.hypot(W, H), scale);
// Chipmunk and Blockhead: d = |mid(eyes) − mouth| / 1.5 on the raw points, and the angle's sine and cosine.
const pose = (f) => {
  const { le, re, mouth } = f.raw, d = Math.hypot((le[0] + re[0]) / 2 - mouth[0], (le[1] + re[1]) / 2 - mouth[1]) / 1.5;
  const amount = f.eyeAmount(), a = f.angle();
  return [d, amount, Math.sin(a), Math.cos(a)];
};
// +[PBEffectUtil generateWaveType:time:phase:period:amplitude:offset:]: 0 sin, 1 cos, 2 rising saw, 3 falling saw.
function wave(type, t, phase, period, amplitude, offset) {
  const u = (period > 0 ? t / period : 0) + phase / 360, f = u - Math.floor(u);
  return [Math.sin(2 * Math.PI * u), Math.cos(2 * Math.PI * u), 2 * f - 1, 1 - 2 * f][type] * amplitude + offset;
}
const random = () => Math.random() * 360 - 180;   // arc4random() × 360 / 2³² − 180

// Sprite atlas: 0–2 small / medium / large heart, then 4 wing frames each of the small, medium and large bird.
const SPRITES = ['smallHeart', 'mediumHeart', 'largeHeart', ...['Small', 'Medium', 'Large'].flatMap((s) => [0, 1, 2, 3].map((i) => `bird${s}${i}`))];
const CELL = [104, 76], ATLAS = [4 * CELL[0], 4 * CELL[1]], rects = [];
// A sprite drawn with NSAffineTransform translate (x, y) → scale (sx, sy) → rotate (radians), its bottom-left corner at
// the origin: packs the inverse transform, the position, the alpha, the sprite and its atlas rectangle (3 vec4).
function sprite(out, id, x, y, sx, sy, rot, alpha) {
  if (Math.abs(sx * sy) < 1e-9 || !rects[id]) return;   // no size, or the atlas hasn't loaded
  const c = Math.cos(rot), s = Math.sin(rot);
  out.push(c / sx, s / sy, -s / sx, c / sy, x, y, alpha, id, ...rects[id]);
}
const DEVS = [0.01, 0.03, 0.025, 0.02, 0.028, 0.015, 0.023];   // -[PBEffectDizzy init] _verticalDevs

// -[PB… processFace:forImage:] for one face, in call order (the smoothers depend on it). out: bumps are (x, y, radius,
// scale), Nose Twirl's twirls (x, y, radius, angle), sprites 3 vec4 each. st = this effect's own state.
const PROCESS = {
  'space alien'(f, W, H, out) {
    const r = f.radius();
    bump(out, W, H, f.leftEye(W, H), r, 0.5);
    bump(out, W, H, f.rightEye(W, H), r, 0.5);
    bump(out, W, H, f.mouth(W, H), 0.3, -0.6);
  },
  'nose twirl'(f, W, H, out, st, t) {
    const c = f.center(W, H), r = f.radius();
    const radius = 0.35 * Math.hypot(W, H) * r + 0.1 * c[1];   // as compiled: + 0.1 × the centre's y
    const a = ((180 * r + 25) * Math.PI) / 180;
    out.push(...c, radius, (st.twirl ??= sm(500, 0.05)).value(c[0] < 0.5 * W ? a : -a, t));
  },
  chipmunk(f, W, H, out) {
    const [d, amount, s, c] = pose(f), k = f.radius() * 0.125;
    bump(out, W, H, f.leftEye(W, H, ([x, y]) => [x - k * c - d * s, y - d * c + k * s]), amount, 0.5);
    bump(out, W, H, f.rightEye(W, H, ([x, y]) => [x + k * c - d * s, y - d * c + k * s]), amount, 0.5);
  },
  blockhead(f, W, H, out) {
    const [d, amount, s, c] = pose(f), up = ([x, y]) => [x + 0.5 * d * s, y + 0.5 * d * c];
    bump(out, W, H, f.leftEye(W, H, up), amount, 0.5);
    bump(out, W, H, f.rightEye(W, H, up), amount, 0.5);
  },
  'bug out'(f, W, H, out) {
    const amount = f.eyeAmount();
    bump(out, W, H, f.leftEye(W, H), amount, 0.5);
    bump(out, W, H, f.rightEye(W, H), amount, 0.5);
  },
  frog(f, W, H, out) {
    PROCESS['bug out'](f, W, H, out);
    const [x, y] = f.mouth(W, H);
    bump(out, W, H, [x, 0.7 * y], 0.2186, 0.5);
  },
  // 12 hearts per face on a ±50° arc of radius r above the face centre, each drifting outwards and up, growing and
  // fading over a 1.3 s cycle and rocking ±15° over 3 s; a heart's start point is re-drawn when its cycle wraps.
  lovestruck(f, W, H, out, st, t, id) {
    const [cx, cy] = f.raw.center, r = f.radius(), k = (0.06 * r) / 0.17, scale = (3.5 * r * (H / 720)) / 0.17;
    const heart = r <= 0.4 ? 0 : r <= 0.6 ? 1 : 2;
    (st.hearts[id] ??= Array.from({ length: 12 }, () => ({ phase: random(), rotation: random(), seed: 0, at: [0, 0] }))).forEach((h, i) => {
      const a = ((i / 11 - 0.5) * 100 * Math.PI) / 180, x = cx - r * Math.sin(a), y = cy + r * Math.cos(a);
      const w1 = wave(2, t, h.phase, 1.3, 0.5, 0.5), w2 = wave(3, t, h.phase, 1.3, 0.5, 0.5), rot = wave(0, t, h.rotation, 3, 15, 0);
      if (w1 <= 0.5 && h.seed > 0.5) h.at = [x + 2 * k * (2 * Math.random() - 1), y + 2 * k * w1];   // pulseValuesWithSeed:
      h.seed = w1;
      const px = h.at[0] < cx ? h.at[0] - k * w1 : h.at[0] + k * w1, py = h.at[1] + 2 * k * w1;
      const s = scale * Math.sin(2.433 * w1);
      sprite(out, heart, px * W, py * H + r * H, s, s, (rot * Math.PI) / 180, w2);
    });
  },
  // 7 birds circling an ellipse above the head (3.5 s a lap), flapping (0.3 s), bobbing by _verticalDevs over 5 s,
  // smaller and mirrored on the far side.
  dizzy(f, W, H, out, st, t, id) {
    const pos = (st.birds[id] ??= [sm(500, 0.02), sm(500, 0.02)]);
    const [cx, cy] = f.raw.center, r0 = f.radius(), phi0 = f.angle();   // _elipsisCenterForFace:
    const ex = pos[0].value(cx + 1.85 * r0 * Math.sin(phi0), t), ey = pos[1].value(cy + 1.85 * r0 * Math.cos(phi0), t);
    const r = f.radius(), set = r < 0.13 ? 3 : r < 0.2 ? 7 : 11, a = (0.4 * r) / 0.3295, b = (0.075 * r) / 0.3295;
    DEVS.forEach((dev, i) => {
      const q = Math.floor((360 * (i + 1)) / DEVS.length);
      const frame = Math.min(3, Math.max(0, Math.round(wave(0, t, q, 0.3, 3, 0.5))));
      const S = wave(0, t, q, 3.5, 1, 0), C = wave(1, t, q, 3.5, 1, 0), phi = f.angle();
      const u = a * C, v = b * S - wave(0, t, 0, 5, dev, 0);
      const x = ex + u * Math.cos(phi) - v * Math.sin(phi), y = ey - u * Math.sin(phi) - v * Math.cos(phi);
      const s = 9 * (r + 0.05896 * S + 0.03104) * (H / 720);
      sprite(out, set + frame, x * W, y * H + r * H, S <= 0 ? -s : s, 0.83 * s, (S <= 0 ? 1.1 : -1.1) * phi, 1);
    });
  },
};
export const FACES = new Set(Object.keys(PROCESS));

// Uniforms for one draw of a face effect at W×H: [vec4 data, count]. key: one state per effect and place (the live
// view, or its effects-browser tile), since the smoothers work in that drawing's pixels.
// ponytail: faces are matched by index and all state resets when the count changes (FaceCore matches trackIDs).
const states = {}, data = new Float32Array(108 * 4);
export const used = {};   // the last draw's parameters per key, for tools/check-effects.js
export function faceUniforms(name, W, H, key) {
  let st = states[key];
  if (!st || st.n !== tracked.length) st = states[key] = { n: tracked.length, faces: [], hearts: {}, birds: {} };
  const out = [], t = performance.now() / 1000;
  tracked.forEach((raw, i) => {
    const f = (st.faces[i] ??= new Face());
    Object.assign(f, { raw, t });
    PROCESS[name](f, W, H, out, st, t, i);
  });
  data.fill(0).set(out.slice(0, data.length));
  used[key] = out.slice(0, data.length);
  return [data, Math.min(out.length, data.length) / (name === 'lovestruck' || name === 'dizzy' ? 12 : 4)];
}

// The sprite atlas, as a canvas: CELL-sized cells, 4 per row, each image at (2, 2) in its cell so bilinear sampling
// fades to transparent at its edges. rects[] = (x, y, w, h) in texture pixels, origin bottom-left (textures are
// uploaded flipped).
export async function atlas(dir) {
  const imgs = await Promise.all(SPRITES.map((n) => new Promise((ok, no) => Object.assign(new Image(), { onload: (e) => ok(e.target), onerror: no, src: `${dir}${n}.png` }))));
  const c = Object.assign(document.createElement('canvas'), { width: ATLAS[0], height: ATLAS[1] }), g = c.getContext('2d');
  imgs.forEach((img, i) => {
    const x = (i % 4) * CELL[0] + 2, y = (i >> 2) * CELL[1] + 2;
    g.drawImage(img, x, y);
    rects[i] = [x, ATLAS[1] - y - img.height, img.width, img.height];
  });
  return c;
}

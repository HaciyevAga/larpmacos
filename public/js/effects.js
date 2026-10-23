// Photo Booth effects as GLSL. An entry is the body of `vec4 effect(vec2 p)`, or a list of passes run in order:
//   { glsl, lut, out }    a shader pass. `out` names the buffer it renders into (the last pass draws to the screen);
//                         `lut` names the baked Core Image LUT that lut(c) reads (assets/photobooth/lut/<lut>.png,
//                         made by tools/ci.js from the chains in docs/photobooth-findings.md).
//   { blur, sigma, out }  a Gaussian blur of buffer `blur` ('src' = the camera frame) in linear light, sigma(w, h) in
//                         pixels. Like Core Image's blur of a finite image, past the edges counts as transparent, so
//                         blurred buffers are premultiplied (sRGB-encoded premultiplied linear colour, plus alpha).
// p is the output pixel (origin bottom-left, like Core Image's destCoord()) and src(q) samples the mirrored camera
// frame at pixel q, so Core Image kernels port almost line for line; buf(uA, p) … buf(uD, p) read buffers a … d.
// Helpers: lin()/enc() convert sRGB ↔ linear; edge(q) folds q back into the frame (mirroredge.cikernel, which
// -[PBEffect outputImage] runs before every distortion). Uniforms (see photobooth.js):
//   uSize   output size in pixels
//   uParam  slider value, 0–1 (-[PBEffect init] sliderValue 0.5)
//   uPoint  effect centre, 0–1 (inputXY; default 0.5, 0.5)
//   uPreview 1 in an effects-browser tile (-[PBEffect previewMode], set while the browser is zoomed out), else 0
//   uFace, uCount  face effects only: what faces.js computed for this frame
// An effect missing here shows as unavailable in the effects browser. Formulas: Core Image's own kernel sources
// (findings, "Core Image kernels"), with the filter → kernel parameter mapping measured by tools/ci.js.

// -[PBEffectDistortion sliderRadius] = slider × the frame's diagonal; each distortion uses a fraction of it.
const SETUP = (k) => `vec2 c = uPoint * uSize, d = p - c; float R = ${k.toFixed(4)} * uParam * length(uSize);`;

// CIBumpDistortion = Core Image's _bumpDistortion: scale by 1 − scale × smoothstep(1 − d/R) towards the centre.
const bump = (k, scale) => `${SETUP(k)}
    float t = clamp(1.0 - length(d) / R, 0.0, 1.0);
    return src(edge(c + d * (1.0 - ${scale.toFixed(4)} * t * t * (3.0 - 2.0 * t))));`;

// Face effects (findings, "Face effects"): faces.js runs each -processFace:forImage: port, face after face, and hands
// the shader uFace[0 … uCount − 1]. Outside the frame Core Image's image is transparent, which shows as black.
const OUTSIDE = 'return q == clamp(q, vec2(0.0), uSize) ? src(q) : vec4(0.0, 0.0, 0.0, 1.0);';
// A chain of CIBumpDistortions, uFace[i] = (centre, radius, scale): bump i + 1 warps bump i's result, so the last one
// is undone first.
const BUMPS = `
    vec2 q = p;
    for (int i = 8; i >= 0; i--) {
      if (float(i) >= uCount) continue;
      vec4 b = uFace[i];
      vec2 d = q - b.xy;
      float t = clamp(1.0 - length(d) / max(b.z, 1e-3), 0.0, 1.0);
      q = b.xy + d * (1.0 - b.w * t * t * (3.0 - 2.0 * t));
    }
    ${OUTSIDE}`;
// Sprites (hearts, birds) composited over the frame in linear light, in order. Per sprite, 3 vec4: the inverse of its
// affine transform's linear part, (position, alpha, 0), and its rectangle in the atlas faces.js builds (416×304,
// premultiplied), sampled bilinearly like CIAffineTransform.
const SPRITES = {
  lut: 'sprites',
  glsl: `
    vec4 c = vec4(lin(src(p).rgb), 1.0);
    for (int i = 0; i < 36; i++) {
      if (float(i) >= uCount) break;
      vec4 m = uFace[3 * i], o = uFace[3 * i + 1], r = uFace[3 * i + 2];
      vec2 q = mat2(m.xz, m.yw) * (p - o.xy);
      if (q.x < -1.0 || q.y < -1.0 || q.x > r.z + 1.0 || q.y > r.w + 1.0) continue;
      vec4 s = texture2D(uLut, (r.xy + q) / vec2(416.0, 304.0));
      s = vec4(lin(s.rgb / max(s.a, 1e-5)), 1.0) * s.a * o.z;
      c = s + c * (1.0 - s.a);
    }
    return vec4(enc(c.rgb), 1.0);`,
};

export const EFFECTS = {
  // Normal.qtz: one CIColorControls with brightness 0, contrast 1, saturation 1, i.e. the identity (observed).
  normal: 'return src(p);',

  'space alien': BUMPS,
  // CITwirlDistortion per face, uFace[i] = (centre, radius, angle), the same _twirl kernel as Twirl.
  'nose twirl': `
    vec2 q = p;
    for (int i = 2; i >= 0; i--) {
      if (float(i) >= uCount) continue;
      vec4 w = uFace[i];
      vec2 d = q - w.xy;
      float r = length(d) / max(w.z, 1e-3);
      if (r >= 1.0) continue;
      float t = 1.0 - r, a = w.w * t * t * (3.0 - 2.0 * t), cs = cos(a), sn = sin(a);
      q = w.xy + vec2(dot(d, vec2(cs, sn)), dot(d, vec2(-sn, cs)));
    }
    ${OUTSIDE}`,
  chipmunk: BUMPS,
  lovestruck: SPRITES,
  dizzy: SPRITES,
  blockhead: BUMPS,
  'bug out': BUMPS,
  frog: BUMPS,

  // CITemperatureAndTint → CIColorControls → CISepiaTone, all pointwise: one baked LUT.
  sepia: { lut: 'sepia', glsl: 'return lut(src(p));' },

  // The Sepia first two stages, then CIVignette intensity 0.7, radius 1.5. Core Image's _vignette kernel multiplies
  // linear light by (1 − d²·w)^z; measured: z = 2 × intensity and 1/√w = 1.25 × the frame's short side at radius 1.5.
  blackandwhite: {
    lut: 'bw',
    glsl: `
    vec2 d = p - 0.5 * uSize;
    float r = 1.25 * min(uSize.x, uSize.y);
    return vec4(enc(lin(lut(src(p)).rgb) * pow(max(1.0 - dot(d, d) / (r * r), 0.0), 1.4)), 1.0);`,
  },

  // -[PBEffectPlastic outputImage] (REA): two tinted copies of the frame, multiplied, then CIColorControls (1.1, 0.25,
  // 1.5). Each tint: CISpotLight on a CIColor grayColor fill (linear 0.2140), brightness 10 → CIBlendWithMask (frame
  // over black by mask.g) → CIColorMatrix. All of it is closed-form in linear light (measured with tools/ciprobe.js):
  //   _spotLight: mask = grey × brightness × r.z × clamp(dot(r, normalize(position − pointsAt)))^(1/concentration),
  //               r = normalize(position − (p, 0));
  //   CIColorMatrix: unpremultiply, affine, premultiply; the cyan matrix's alpha bias 0.25 makes alpha 1.25, unclamped;
  //   CIColorControls: unpremultiply, mix(Rec. 709 luma, c, saturation), (x − 0.5) × contrast + 0.5 + brightness,
  //               premultiply.
  // Effect.qtz's multiplyEffect then sets alpha to 1 and keeps the premultiplied colour, so the result is 1.25×.
  plasticcamera: `
    vec3 f = lin(src(p).rgb), P = vec3(p, 0.0);
    vec3 lo = vec3(0.4, -0.15, 0.4) * uSize.x, ro = normalize(lo - P);
    float mo = 2.140411 * ro.z * pow(clamp(dot(ro, normalize(lo - vec3(0.4 * uSize.x, 2.0 * uSize.y, 0.0))), 0.0, 1.0), 1.0 / 0.1533);
    vec3 lc = vec3(0.75 * uSize.x, 0.75 * uSize.x, 0.5 * uSize.y), rc = normalize(lc - P);
    float mc = 2.140411 * rc.z * pow(clamp(dot(rc, normalize(lc - vec3(0.75 * uSize.x, 0.5 * uSize.y, 0.0))), 0.0, 1.0), 1.0 / 0.3234);
    vec3 m = (vec3(2.0, 2.0, 1.0) * f * mo + vec3(0.12, 0.02, 0.0)) * (vec3(1.5, 2.0, 0.0) * f * mc + vec3(0.1, 0.5, 0.5));
    m = mix(vec3(dot(m, vec3(0.2125, 0.7154, 0.0721))), m, 1.1);
    return vec4(enc(1.25 * ((m - 0.5) * 1.5 + 0.75)), 1.0);`,

  // -[PBEffectComicBook outputImage] (REA): mix(posterized, white, halftone) × overlay(outline over posterized). Each
  // stage in closed form in linear light, from Core Image's kernels with the mappings measured by tools/ciprobe.js:
  //   posterized: CIHighlightShadowAdjust (radius 19, shadow 1.5 → clamped to 1, highlight 1; _highlightsAndShadows2
  //               with the image's own Gaussian blur, sigma = radius) → CIColorControls (1.7, 0.2, 1.5) →
  //               CIColorPosterize 12 (floor(x × 11 + 0.5) / 11, unclamped)
  //   halftone:   CIColorMonochrome white → CISpotColor (kernel contrast = 1 / (1 − contrast), colours linearised) →
  //               CIDotScreen at (0, 0), angle −0.40108, width 10 × height / 720 (15 in the effects browser),
  //               sharpness 0.7 (kernel z = 1 / (1 − sharpness))
  //   outline:    CIUnsharpMask (6.283, 1) → CIColorControls (0, 0.8792, 2.54) → CISpotColor with contrast 1 (a step)
  comicbook: [
    { blur: 'src', sigma: () => 19, out: 'a' },
    { blur: 'src', sigma: () => 6.283, out: 'b' },
    {
      glsl: `
    const vec3 LUMA = vec3(0.2125, 0.7154, 0.0721);
    vec3 f = lin(src(p).rgb);
    vec4 a = buf(uA, p), b = buf(uB, p);
    vec3 B = lin(a.rgb) / max(a.a, 1e-4), U = 2.0 * f - lin(b.rgb) / max(b.a, 1e-4);
    float L2 = max(0.0, max(B.r, max(B.g, B.b))), L = sqrt(L2);
    vec3 e = exp2(-1.0 - B);
    vec3 ycc = mat3(0.299, 0.596, 0.212, 0.587, -0.2755, -0.523, 0.114, -0.321, 0.311) * f;
    float Y = 2.0 * pow(max(ycc.x, 0.0), e.r);
    vec3 r = mix(4.0 * pow(max(f, 0.0), e), Y * vec3(1.00048, 0.999864, 0.999446) + ycc.y * vec3(0.955558, -0.271545, -1.10803) + ycc.z * vec3(0.619549, -0.646786, 1.70542), 0.35);
    r = mix(mix(mix(f, r, smoothstep(0.0, 1.1, sqrt(L))), f, L), f, min(L, 1.0));
    Y = dot(r, vec3(0.299, 0.587, 0.114));
    r = mix(r, mix(vec3(0.5), r, 1.1), min(max(max(-2.6 * Y * Y - 2.6 * Y + 0.98, -6.25 * Y * Y - 6.25 * Y + 0.5965), 1.0), 30.0 * L2));
    r = max(r, 0.0) + min(f, 0.0);
    vec3 P = floor(((mix(vec3(dot(r, LUMA)), r, 1.7) - 0.5) * 1.5 + 0.7) * 11.0 + 0.5) / 11.0;

    float c1 = dot(f, LUMA), m = c1 < 0.5 ? 2.0 * c1 : 1.0, v = 1.0;
    v = mix(v, 0.0, clamp(0.9368 - 1.7320508 * abs(m - 0.073239), 0.0, 1.0));
    v = mix(v, 0.6038273, clamp((0.4147 - 1.7320508 * abs(m - 0.4479884)) * 4.83559 + 0.5, 0.0, 1.0));
    v = mix(v, 1.0, clamp(0.5 - 1.7320508 * abs(m - 1.0), 0.0, 1.0));
    vec2 t = fract(vec2(dot(p, vec2(0.920641, -0.390410)), dot(p, vec2(0.390410, 0.920641))) / ((uPreview > 0.5 ? 15.0 : 10.0) * uSize.y / 720.0)) * 6.2831853;
    float T = clamp((v - (sin(t.x) + sin(t.y)) * 0.25 * 0.695 - 0.5) / 0.3 + 0.5, 0.0, 1.0);

    float K = (dot(U, LUMA) - 0.5) * 2.54 + 1.3792;
    float o = 1.7320508 * abs(K - 0.4479884) < 0.45 ? 0.9774019 : (1.7320508 * abs(K) < 0.5 ? 0.0 : 1.0);
    vec3 ov = clamp(mix(2.0 * o * P, 2.0 * (o + P - o * P) - 1.0, step(0.5, P)), 0.0, 1.0);
    return vec4(enc((P + (1.0 - P) * T) * ov), 1.0);`,
    },
  ],

  // -[PBEffectPencil outputImage] (REA): CIColorControls (0.7, 0.2995, 2.131) of colorized × shading.
  //   colorized: CIColorDodgeBlendMode of CISpotColor (black → black 0.5/1, grey 0.7 → white 0.5/0.2656, white → white
  //              0/0) over CIColorControls (1, 0.3471, 1.609) of the frame; closed form in linear light, as Comic Book.
  //   shading:   static.png tiled, CIMotionBlur 17 at 33°, CIColorControls (0, 0.5, 2): camera-independent, so baked
  //              by tools/ci.js into lut/pencil.png (one 640×480 period at half value) and sampled here, not a LUT.
  colorpencil: {
    lut: 'pencil',
    glsl: `
    vec3 f = lin(src(p).rgb);
    float v = length(f) < 0.5 ? 0.0 : 1.0;
    v = mix(v, 1.0, clamp((0.5 - length(f - 0.4479884)) * 1.361656 + 0.5, 0.0, 1.0));
    v = mix(v, 1.0, clamp(0.5 - length(f - 1.0), 0.0, 1.0));
    vec3 m = clamp(((f - 0.5) * 1.609 + 0.8471) / max(1.0 - v, 1e-7), 0.0, 1.0) * 2.0 * lin(texture2D(uLut, fract(p / vec2(640.0, 480.0))).rgb).r;
    m = mix(vec3(dot(m, vec3(0.2125, 0.7154, 0.0721))), m, 0.7);
    return vec4(enc((m - 0.5) * 2.131 + 0.7995), 1.0);`,
  },

  // CIColorControls → CIGloom (radius 0.03 × diagonal × 0.5, intensity 1) → CIBloom (0.0485 × diagonal × 0.5,
  // intensity 0.5794) → CIColorControls. _gloom = mix(s, min(s, blur), k), _bloom = mix(s, max(s, blur), k), on
  // premultiplied values; the Gaussian's sigma = its radius (measured). Core Image doesn't clamp between filters and
  // the first stage spans −0.06 … 2.35 in linear light, so the glow1 LUT and the buffers after it hold
  // (linear + 0.1 × alpha) / 2.6, which blurs like linear light.
  glow: [
    { lut: 'glow1', glsl: 'return lut(src(p));', out: 'a' },
    { blur: 'a', sigma: (w, h) => 0.015 * Math.hypot(w, h), out: 'b' },
    {
      out: 'c',
      glsl: `
    vec4 a = buf(uA, p), b = buf(uB, p);
    vec3 m = min(2.6 * lin(a.rgb) - 0.1, 2.6 * lin(b.rgb) - 0.1 * b.a);
    return vec4(enc((m + 0.1 * b.a) / 2.6), b.a);`,
    },
    { blur: 'c', sigma: (w, h) => 0.02425 * Math.hypot(w, h), out: 'd' },
    {
      lut: 'glow2',
      // CIColorControls works on unpremultiplied colour. Effect.qtz's last kernel (multiplyEffect) sets alpha to 1,
      // so the frame's transparent edges (from the blurs) show as a dark border, as in a Core Image render.
      glsl: `
    vec4 s = buf(uC, p), b = buf(uD, p);
    s.rgb = 2.6 * lin(s.rgb) - 0.1 * s.a;
    b.rgb = 2.6 * lin(b.rgb) - 0.1 * b.a;
    vec4 m = mix(s, max(s, b), 0.5794);
    return vec4(enc(lin(lut(vec4(enc(m.rgb / max(m.a, 1e-5)), 1.0)).rgb) * m.a), 1.0);`,
    },
  ],

  // CITemperatureAndTint → CIColorControls → CIColorMap (thermalMap.png) → CIColorControls: one LUT.
  thermalcamera: { lut: 'thermal', glsl: 'return lut(src(p));' },

  // CIColorInvert → CIGaussianBlur 5 → alpha 0.5 → source over the unblurred inverted frame → CIColorControls →
  // CIColorMap (xrayMap.png). Core Image inverts linear light (1 − x), which commutes with the blur and the mix, so the
  // blur and mix run on the camera frame and the LUT starts with the invert. Transparent past the edges, so there the
  // blur's weight b.a is below 1.
  // ponytail: sigma assumes Photo Booth's 5 px are on a 720-line frame; the camera's real size is unknown.
  xray: [
    { blur: 'src', sigma: (w, h) => (5 * h) / 720, out: 'a' },
    {
      lut: 'xray',
      glsl: `
    vec4 b = buf(uA, p);
    return lut(vec4(enc(lin(src(p).rgb) * (1.0 - 0.5 * b.a) + 0.5 * lin(b.rgb)), 1.0));`,
    },
  ],

  // CIBumpDistortion, radius 0.75 × sliderRadius, scale 0.5.
  bulge: bump(0.75, 0.5),
  // CIBumpDistortion, radius 0.425 × sliderRadius, scale −1.
  dent: bump(0.425, -1.0),

  // CITwirlDistortion, radius 0.35 × sliderRadius, angle slider × π. Core Image's _twirl kernel rotates by
  // −angle × smoothstep(1 − d/R).
  twirl: `${SETUP(0.35)}
    float r = length(d) / R;
    if (r >= 1.0) return src(edge(p));
    float t = 1.0 - r, a = uParam * 3.14159265 * t * t * (3.0 - 2.0 * t), cs = cos(a), sn = sin(a);
    return src(edge(c + vec2(dot(d, vec2(cs, sn)), dot(d, vec2(-sn, cs)))));`,

  // CIPinchDistortion, radius 0.215 × sliderRadius, scale slider × 1.413. Core Image's _pinchDistortionScaleLT1 /
  // ScaleGE1 kernels: mix(p, c + d/√(d/R), scale), and past the radius c + d·(d/R)^(−scale/2) once scale ≥ 1.
  squeeze: `${SETUP(0.215)}
    float s = 1.413 * uParam, r = length(d) / R + 1e-6;
    vec2 q = mix(p, c + d * inversesqrt(r), s);
    if (s >= 1.0 && r > 1.0) q = c + d * pow(r, -0.5 * s);
    return src(edge(q));`,

  // CICircleSplashDistortion, radius 0.336 × sliderRadius: past the radius, Core Image's _circleSplash kernel samples
  // the circle's edge along the same ray.
  lighttunnel: `${SETUP(0.336)}
    float l = length(d);
    return src(edge(c + d * (min(l, R) / max(l, 1e-6))));`,

  // -[PBEffectMirror outputImage] (REA): CIKaleidoscope, inputCount 1, inputAngle π/2, centre = the frame's centre, then
  // cropped. With one segment Core Image's _kaleida kernel only folds across the line through the centre: the left
  // half stays and the right half shows it reflected (measured).
  mirror: `
    vec2 q = p;
    if (q.x > 0.5 * uSize.x) q.x = uSize.x - q.x;
    return src(edge(q));`,

  // fisheye.cikernel (observed) as -[PBEffectFishEye outputImage] runs it (REA): centre = the frame's centre (imageCenter,
  // not inputXY), factor = 1.69 × sliderRadius, and its sliderValue is fixed at 0.5, so factor = 0.845 × diagonal.
  // d' * normalize(v) is folded into one scale so the centre pixel can't be NaN.
  fisheye: `
    vec2 c = 0.5 * uSize, v = p - c;
    float f = 0.845 * length(uSize), d = length(v);
    return src(edge(c + v * (0.6 / (1.0 - (d * d) / (f * f)))));`,

  // stretch.cikernel "funHouse" (observed), including its (p - center.y) for both axes, as -[PBEffectStretch outputImage]
  // runs it (REA): centre = the frame's centre, param1 = 0.5 × height, param2 = 0.1 × height, param3 = 0.15 × height.
  // Core Image's sin_ ("fast sin for [−π, π]") matches sin over −8 … 8 on macOS 15 (measured), and gets up to ±5 here.
  stretch: `
    vec2 c = 0.5 * uSize;
    float param1 = 0.5 * uSize.y, param2 = 0.1 * uSize.y, param3 = 0.15 * uSize.y;
    vec2 g = smoothstep(0.0, 1.0, 1.0 - clamp(abs(p - c) / param1, 0.0, 1.0));
    vec2 f = param2 * sin((p - c.y) / param3);
    return src(edge(p - f * g));`,
};

// Effects with a slider: the PBEffect subclasses whose -wantsSlider returns YES (REA). The base class returns NO;
// a Quartz Composer effect wants one when its attributes have "masterParameter".
export const SLIDER = new Set(['bulge', 'dent', 'twirl', 'squeeze', 'lighttunnel']);

// Display names: the binary's strings (observed) except where marked.
export const NAMES = {
  normal: 'Normal', 'space alien': 'Space Alien', 'nose twirl': 'Nose Twirl', chipmunk: 'Chipmunk', lovestruck: 'Lovestruck',
  dizzy: 'Dizzy', blockhead: 'Blockhead', 'bug out': 'Bug Out', frog: 'Frog', sepia: 'Sepia', blackandwhite: 'Black And White',
  plasticcamera: 'Plastic Camera', comicbook: 'Comic Book', colorpencil: 'Color Pencil', glow: 'Glow',
  thermalcamera: 'Thermal Camera', xray: 'X-Ray', bulge: 'Bulge', dent: 'Dent', twirl: 'Twirl', squeeze: 'Squeeze',
  mirror: 'Mirror', lighttunnel: 'Light Tunnel', fisheye: 'Fish Eye', stretch: 'Stretch',
};

// tools/ci.js — run Photo Booth's Core Image chains (docs/photobooth-findings.md, "Effect parameters from code")
// with Apple's own filters, so the site doesn't have to guess Core Image's maths. macOS built-ins only.
// usage: osascript -l JavaScript tools/ci.js <mode> ...
//   lut  <out.png> <chain|bake>          bake a pointwise chain into a 64³ LUT: 512×512, 8×8 tiles of 64×64,
//                                        blue = tile (row-major from the bottom-left), red = x, green = y in the tile
//                                        — or a camera-independent texture from BAKES (pencil: 640×480)
//   ref  <out.png> <effect> <in.png> [params.json]
//                                        reference render of a whole effect at slider 0.5 (the input is taken as sRGB);
//                                        face effects take the parameters the page drew with
//   diff <a.png> <b.png>                 mean and max absolute difference per channel, in 0–255 steps
//   crop <in> <out.png> <x> <y> <w> <h> <outW> <outH>   crop (y from the top) and scale, for test frames
// LUT inputs and outputs are sRGB-encoded, like the camera frame in WebGL. Prints "<width>x<height>" for lut/ref.
ObjC.import('CoreImage');
ObjC.import('AppKit');

const SRGB = $.CGColorSpaceCreateWithName($.kCGColorSpaceSRGB);
const ctx = $.CIContext.contextWithOptions($());
const MAPS = 'public/assets/photobooth/';
// Raw values (no colour management), or with sRGB = true read as sRGB whatever the file says.
// (A CGColorSpace inside an options dictionary crashes the bridge, hence the two steps.)
const load = (path, srgb = true) => {
  const img = $.CIImage.imageWithContentsOfURLOptions($.NSURL.fileURLWithPath(path), $({ CIImageColorSpace: $.NSNull.null }));
  if (!img || img.isNil()) throw new Error('cannot read ' + path);
  return srgb ? img.imageByColorMatchingColorSpaceToWorkingSpace(SRGB) : img;
};

function filter(name, image, params = {}) {
  const f = $.CIFilter.filterWithName(name);
  if (!f || f.isNil()) throw new Error('no filter ' + name);
  if (image) f.setValueForKey(image, 'inputImage');
  for (const [k, v] of Object.entries(params)) f.setValueForKey(Array.isArray(v) ? $.CIVector.vectorWithXY(...v) : typeof v === 'number' ? $(v) : v, k);
  return f.outputImage;
}

// Pointwise stages, named as in the findings.
const tt = (i) => filter('CITemperatureAndTint', i, { inputNeutral: [6500, 500], inputTargetNeutral: [1000, 300] });
const cc = (s, b, c) => (i) => filter('CIColorControls', i, { inputSaturation: s, inputBrightness: b, inputContrast: c });
const map = (png) => (i) => filter('CIColorMap', i, { inputGradientImage: load(MAPS + png) });
const CHAINS = {
  identity: [],
  sepia: [tt, cc(0, 0.15, 1.3), (i) => filter('CISepiaTone', i, { inputIntensity: 0.8 })],
  bw: [tt, cc(0, 0.15, 1.3)],                                                   // then CIVignette
  thermal: [tt, cc(0, 0.7863, 2.676), map('thermalMap.png'), cc(1, 0.25, 1.5)],
  xray: [(i) => filter('CIColorInvert', i), cc(0, -1, 2.45), map('xrayMap.png')],   // input: the frame mixed with its blur
  // Core Image keeps this stage's linear output (−0.06 … 2.35) unclamped; the LUT stores (linear + 0.1) / 2.6.
  glow1: [cc(1, 0.6491, 2.407), (i) => filter('CIColorMatrix', i, { inputRVector: $.CIVector.vectorWithXYZW(1 / 2.6, 0, 0, 0), inputGVector: $.CIVector.vectorWithXYZW(0, 1 / 2.6, 0, 0), inputBVector: $.CIVector.vectorWithXYZW(0, 0, 1 / 2.6, 0), inputBiasVector: $.CIVector.vectorWithXYZW(0.1 / 2.6, 0.1 / 2.6, 0.1 / 2.6, 0) })],
  glow2: [cc(1, 0.1, 1.25)],
};
const chain = (name, img) => {
  if (!CHAINS[name]) throw new Error('no chain ' + name);
  return CHAINS[name].reduce((i, f) => f(i), img);
};

// Plastic Camera (findings): two spotlit, colour-matrixed copies of the frame multiplied, then CIColorControls.
const v4 = (...v) => $.CIVector.vectorWithXYZW(...v), v3 = (...v) => $.CIVector.vectorWithXYZ(...v);
const fill = (color, w, h) => filter('CIConstantColorGenerator', null, { inputColor: color }).imageByCroppingToRect($.NSMakeRect(0, 0, w, h));
function tint(i, w, h, spot, m) {
  // spot = null: a mask of 1 everywhere, for the LUT
  const mask = spot ? filter('CISpotLight', fill($.CIColor.grayColor, w, h), { inputBrightness: 10, inputColor: $.CIColor.whiteColor, inputConcentration: spot[0], inputLightPosition: v3(...spot[1]), inputLightPointsAt: v3(...spot[2]) }).imageByCroppingToRect($.NSMakeRect(0, 0, w, h)) : fill($.CIColor.whiteColor, w, h);
  const blend = filter('CIBlendWithMask', i, { inputBackgroundImage: fill($.CIColor.blackColor, w, h), inputMaskImage: mask });
  return filter('CIColorMatrix', blend, { inputRVector: v4(...m[0]), inputGVector: v4(...m[1]), inputBVector: v4(...m[2]), inputAVector: v4(0, 0, 0, 1), inputBiasVector: v4(...m[3]) });
}
function plastic(i, w, h, spots = true) {
  const orange = tint(i, w, h, spots && [0.1533, [0.4 * w, -0.15 * w, 0.4 * w], [0.4 * w, 2 * h, 0]], [[2, 0, 0, 0.1], [0, 2, 0, 0], [0, 0, 1, 0], [0.02, 0.02, 0, 0]]);
  const cyan = tint(i, w, h, spots && [0.3234, [0.75 * w, 0.75 * w, 0.5 * h], [0.75 * w, 0.5 * h, 0]], [[1.5, 0, 0, 0], [0, 2, 0, 0], [0, 0, 0, 0], [0.1, 0.5, 0.5, 0.25]]);
  return cc(1.1, 0.25, 1.5)(filter('CIMultiplyCompositing', orange, { inputBackgroundImage: cyan }));
}

// Comic Book (findings): mix(posterized, white, halftone) × overlay(outline over posterized), at the live view's dot size.
const grey = (v) => $.CIColor.colorWithRedGreenBlue(v, v, v), WHITE = $.CIColor.whiteColor, BLACK = $.CIColor.blackColor;
const spotColor = (i, stages) => filter('CISpotColor', i, Object.fromEntries(stages.flatMap(([c, r, close, con], n) =>
  [[`inputCenterColor${n + 1}`, c], [`inputReplacementColor${n + 1}`, r], [`inputCloseness${n + 1}`, close], [`inputContrast${n + 1}`, con]])));
function comic(i, w, h) {
  const post = filter('CIColorPosterize', cc(1.7, 0.2, 1.5)(filter('CIHighlightShadowAdjust', i, { inputRadius: 19, inputShadowAmount: 1.5, inputHighlightAmount: 1 })), { inputLevels: 12 });
  const mono = filter('CIColorMonochrome', i, { inputColor: WHITE, inputIntensity: 1 });
  const half = filter('CIDotScreen', spotColor(mono, [[grey(0.3), BLACK, 0.4368, 0], [grey(0.7), grey(0.8), 0.4147, 0.7932], [WHITE, WHITE, 0, 0]]),
    { inputCenter: [0, 0], inputAngle: -0.40107666210829696, inputWidth: (10 * h) / 720, inputSharpness: 0.7 });
  const outline = spotColor(cc(0, 0.8792, 2.54)(filter('CIUnsharpMask', i, { inputRadius: 6.283, inputIntensity: 1 })),
    [[BLACK, BLACK, 0.5, 1], [grey(0.7), grey(0.99), 0.45, 1], [grey(0.7), WHITE, 0, 1]]);
  const blend = filter('CIBlendWithMask', fill(WHITE, w, h), { inputBackgroundImage: post, inputMaskImage: half });
  return filter('CIMultiplyCompositing', blend, { inputBackgroundImage: filter('CIOverlayBlendMode', outline, { inputBackgroundImage: post }) });
}

// Color Pencil (findings). Its shading never sees the camera: static.png (loaded the way -[PBEffectPencil init] loads
// it) tiled from the origin, CIMotionBlur 17 at 33°, then CIColorControls (0, 0.5, 2) = 2 × luma. It repeats every
// 640×480, so `lut <out> pencil` bakes one period, at half value so it fits in 0–1.
const pencilShading = () => cc(0, 0.5, 2)(filter('CIMotionBlur',
  filter('CIAffineTile', $.CIImage.imageWithContentsOfURL($.NSURL.fileURLWithPath(MAPS + 'static.png')), { inputTransform: $.NSAffineTransform.transform }),
  { inputRadius: 17, inputAngle: 0.5759586531581288 }));
const BAKES = { pencil: [640, 480, () => filter('CIColorMatrix', pencilShading(), { inputRVector: v4(0.5, 0, 0, 0), inputGVector: v4(0, 0.5, 0, 0), inputBVector: v4(0, 0, 0.5, 0) })] };
function pencil(i) {
  const colorized = filter('CIColorDodgeBlendMode', spotColor(i, [[BLACK, BLACK, 0.5, 1], [grey(0.7), WHITE, 0.5, 0.2656], [WHITE, WHITE, 0, 0]]),
    { inputBackgroundImage: cc(1, 0.3471, 1.609)(i) });
  return cc(0.7, 0.2995, 2.131)(filter('CIMultiplyCompositing', colorized, { inputBackgroundImage: pencilShading().imageByCroppingToRect(i.extent) }));
}

// Whole effects, for reference renders, at slider 0.5 with the centre in the middle of the frame.
const SLIDER = 0.5;
// -[PBEffectDistortion sliderRadius] = slider × the frame's diagonal; each distortion takes a fraction of it.
const dist = (name, k, extra = {}) => (i, w, h) => filter(name, i, { inputCenter: [w / 2, h / 2], inputRadius: k * SLIDER * Math.hypot(w, h), ...extra });
const DISTORTIONS = {
  bulge: dist('CIBumpDistortion', 0.75, { inputScale: 0.5 }),
  dent: dist('CIBumpDistortion', 0.425, { inputScale: -1 }),
  twirl: dist('CITwirlDistortion', 0.35, { inputAngle: SLIDER * Math.PI }),
  squeeze: dist('CIPinchDistortion', 0.215, { inputScale: SLIDER * 1.413 }),
  lighttunnel: dist('CICircleSplashDistortion', 0.336),
  mirror: (i, w, h) => filter('CIKaleidoscope', i, { inputCenter: [w / 2, h / 2], inputCount: 1, inputAngle: Math.PI / 2 }),
  // Photo Booth's own kernels, with the arguments -[PBEffectFishEye/Stretch outputImage] pass (findings).
  fisheye: (i, w, h) => kernel('fisheye', i, w, h, [$.CIVector.vectorWithXY(w / 2, h / 2), $(1.69 * 0.5 * Math.hypot(w, h))]),
  stretch: (i, w, h) => kernel('stretch', i, w, h, [$.CIVector.vectorWithXY(w / 2, h / 2), $(0.5 * h), $(0.1 * h), $(0.15 * h)]),
};
const EFFECTS = {
  ...DISTORTIONS,
  sepia: (i) => chain('sepia', i),
  bw: (i) => filter('CIVignette', chain('bw', i), { inputIntensity: 0.7, inputRadius: 1.5 }),
  thermal: (i) => chain('thermal', i),
  plasticcamera: (i, w, h) => plastic(i, w, h),
  comicbook: (i, w, h) => comic(i, w, h),
  colorpencil: (i) => pencil(i),
  xray: (i) => {
    const inv = filter('CIColorInvert', i);
    const blur = filter('CIColorMatrix', filter('CIGaussianBlur', inv, { inputRadius: 5 }), { inputAVector: $.CIVector.vectorWithXYZW(0, 0, 0, 0.5) });
    const mixed = filter('CISourceOverCompositing', blur, { inputBackgroundImage: inv });
    return CHAINS.xray.slice(1).reduce((j, f) => f(j), mixed);
  },
  glow: (i, w, h) => {
    const d = Math.hypot(w, h);
    let g = CHAINS.glow1[0](i);
    g = filter('CIGloom', g, { inputRadius: 0.03 * d * 0.5, inputIntensity: 1 });
    g = filter('CIBloom', g, { inputRadius: 0.0485 * d * 0.5, inputIntensity: 0.5794 });
    return chain('glow2', g);
  },
};

// Face effects, from the parameters the page drew with (faces.js `used`, saved by tools/check-effects.js): a chain of
// CIBumpDistortions (x, y, radius, scale), CITwirlDistortions (x, y, radius, angle), or sprites, each faded with
// CIColorMatrix, placed with CIAffineTransform (translate → scale → rotate, recovered from the inverse faces.js packs)
// and composited over the frame.
let PARAMS = [];
const groups = (n) => Array.from({ length: PARAMS.length / n }, (_, k) => PARAMS.slice(k * n, k * n + n));
const bumps = (i) => groups(4).reduce((j, [x, y, r, s]) => filter('CIBumpDistortion', j, { inputCenter: [x, y], inputRadius: r, inputScale: s }), i);
const SPRITE_FILES = ['smallHeart', 'mediumHeart', 'largeHeart', ...['Small', 'Medium', 'Large'].flatMap((s) => [0, 1, 2, 3].map((n) => `bird${s}${n}`))];
const sprites = (i) => groups(12).reduce((j, [a, b, c, d, x, y, alpha, id]) => {
  const rot = Math.atan2(b, d), sy = 1 / Math.hypot(b, d), sx = Math.abs(a) > Math.abs(c) ? Math.cos(rot) / a : -Math.sin(rot) / c;
  const t = $.NSAffineTransform.transform;
  t.translateXByYBy(x, y);
  t.scaleXByYBy(sx, sy);
  t.rotateByRadians(rot);
  const img = filter('CIColorMatrix', load(MAPS + SPRITE_FILES[id] + '.png'), { inputAVector: v4(0, 0, 0, alpha) });
  return filter('CISourceOverCompositing', filter('CIAffineTransform', img, { inputTransform: t }), { inputBackgroundImage: j });
}, i);
Object.assign(EFFECTS, {
  'space alien': bumps, chipmunk: bumps, blockhead: bumps, 'bug out': bumps, frog: bumps,
  'nose twirl': (i) => groups(4).reduce((j, [x, y, r, a]) => filter('CITwirlDistortion', j, { inputCenter: [x, y], inputRadius: r, inputAngle: a }), i),
  lovestruck: sprites, dizzy: sprites,
});

// fisheye.cikernel and stretch.cikernel as warp kernels (same maths, returning the coordinate they sample): run as
// general kernels from JXA their sampler comes out garbled.
const WARPS = {
  fisheye: 'kernel vec2 fishEye(vec2 center, float factor) { vec2 v = destCoord() - center; float d = length(v); vec2 uv = normalize(v); d = 0.6 * d / (1.0 - (d * d) / (factor * factor)); return center + d * uv; }',
  stretch: 'kernel vec2 funHouse(vec2 center, float param1, float param2, float param3) { vec2 p = destCoord(); vec2 g = 1.0 - clamp(abs(p - center) / param1, 0.0, 1.0); g = smoothstep(0.0, 1.0, g); vec2 f = param2 * sin_((p - center.y) / param3); return p - f * g; }',
};
function kernel(name, img, w, h, args) {
  const roi = $.NSMakeRect(-w / 2, -h / 2, 2 * w, 2 * h);
  return $.CIWarpKernel.kernelWithString(WARPS[name]).applyWithExtentRoiCallbackInputImageArguments($.NSMakeRect(0, 0, w, h), () => roi, img, $(args));
}

// mirroredge.cikernel with sZ = the frame, as -[PBEffect outputImage] runs it before every distortion: reflect-tiles
// the frame (and shrinks it by (sZ − 1)/sZ, i.e. up to a pixel at the far edges).
function reflect(img, w, h) {
  const k = $.CIWarpKernel.kernelWithString($.NSString.stringWithContentsOfFileEncodingError(MAPS + 'mirroredge.cikernel', $.NSUTF8StringEncoding, null));
  const ext = img.extent;
  return k.applyWithExtentRoiCallbackInputImageArguments($.NSMakeRect(-1e5, -1e5, 2e5, 2e5), () => ext, img, $([$.CIVector.vectorWithXY(w, h)]));
}

function write(img, out, rect) {
  const data = ctx.PNGRepresentationOfImageFormatColorSpaceOptions(img.imageByCroppingToRect(rect), $.kCIFormatRGBA8, SRGB, $());
  if (!data || data.isNil() || !data.writeToFileAtomically(out, true)) throw new Error('write failed: ' + out);
  return `${rect.size.width}x${rect.size.height}`;
}

function run(argv) {
  const [mode, a, b, c, d] = argv;
  switch (mode) {
    case 'lut': {
      if (BAKES[b]) {
        const [w, h, img] = BAKES[b];
        return write(img(), a, $.NSMakeRect(0, 0, w, h));
      }
      const id = $.CIColorKernel.kernelWithString(
        'kernel vec4 identity() { vec2 d = destCoord() - 0.5; return vec4(mod(d.x, 64.0), mod(d.y, 64.0), floor(d.x / 64.0) + 8.0 * floor(d.y / 64.0), 63.0) / 63.0; }');
      const rect = $.NSMakeRect(0, 0, 512, 512);
      // The kernel's values are sRGB-encoded; match them into the (linear) working space like any sRGB image.
      return write(chain(b, id.applyWithExtentArguments(rect, $([])).imageByColorMatchingColorSpaceToWorkingSpace(SRGB)), a, rect);
    }
    case 'ref': {
      const img = load(c), rect = img.extent, w = rect.size.width, h = rect.size.height;
      if (!EFFECTS[b]) throw new Error('no effect ' + b);
      if (d) PARAMS = JSON.parse($.NSString.stringWithContentsOfFileEncodingError(d, $.NSUTF8StringEncoding, null).js);
      const out = EFFECTS[b](DISTORTIONS[b] ? reflect(img, w, h) : img, w, h);
      // Effect.qtz's last kernel (multiplyEffect) sets alpha to 1, so anything transparent shows as black.
      const black = filter('CIConstantColorGenerator', null, { inputColor: $.CIColor.colorWithRedGreenBlue(0, 0, 0) });
      return write(filter('CISourceOverCompositing', out, { inputBackgroundImage: black }), a, rect);
    }
    case 'crop': {   // the face pass's test frame: x, y from the top left, w, h, then scaled to outW × outH
      const img = load(a), [x, y, w, hh, ow, oh] = argv.slice(3).map(Number), top = img.extent.size.height - y - hh;
      return write(img.imageByCroppingToRect($.NSMakeRect(x, top, w, hh)).imageByApplyingTransform($.CGAffineTransformMake(ow / w, 0, 0, oh / hh, (-x * ow) / w, (-top * oh) / hh)), b, $.NSMakeRect(0, 0, ow, oh));
    }
    case 'diff': {
      // Raw values, no colour management: |a − b| averaged and maxed over the image.
      const rctx = $.CIContext.contextWithOptions($({ working_color_space: $.NSNull.null }));
      const x = load(a, false), y = load(b, false);
      const d = filter('CIDifferenceBlendMode', x, { inputBackgroundImage: y });
      const ext = $.CIVector.vectorWithCGRect(x.extent);
      const px = (f) => {
        const out = filter(f, d, { inputExtent: ext }).imageByCroppingToRect($.NSMakeRect(0, 0, 1, 1));
        const rep = $.NSBitmapImageRep.imageRepWithData(rctx.PNGRepresentationOfImageFormatColorSpaceOptions(out, $.kCIFormatRGBA16, SRGB, $()));
        const col = rep.colorAtXY(0, 0);
        return [col.redComponent, col.greenComponent, col.blueComponent].map((v) => (v * 255).toFixed(2)).join(' ');
      };
      return `mean ${px('CIAreaAverage')}  max ${px('CIAreaMaximum')}`;
    }
  }
  throw new Error('bad mode: ' + mode);
}

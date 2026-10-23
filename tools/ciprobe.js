// tools/ciprobe.js — read Core Image's raw working-space values (linear, premultiplied, unclamped) at pixels, for
// measuring how a filter maps onto its kernel (docs/photobooth-findings.md, "Core Image's own maths").
// usage: osascript -l JavaScript tools/ciprobe.js '<JS expression giving a CIImage>' x,y [x,y ...]
// The expression can use: filter(name, image, params), flat(r, g, b, a) (a constant in working-space values),
// v3/v4 (CIVector), $ (the bridge). Prints "x,y: r g b a" per point.
ObjC.import('CoreImage');
ObjC.import('AppKit');

const LIN = $.CGColorSpaceCreateWithName($.kCGColorSpaceLinearSRGB);
const ctx = $.CIContext.contextWithOptions($());
const v3 = (...v) => $.CIVector.vectorWithXYZ(...v), v4 = (...v) => $.CIVector.vectorWithXYZW(...v);
function filter(name, image, params = {}) {
  const f = $.CIFilter.filterWithName(name);
  if (!f || f.isNil()) throw new Error('no filter ' + name);
  if (image) f.setValueForKey(image, 'inputImage');
  for (const [k, v] of Object.entries(params)) f.setValueForKey(Array.isArray(v) ? $.CIVector.vectorWithXY(...v) : typeof v === 'number' ? $(v) : v, k);
  return f.outputImage;
}
const flat = (r, g, b, a = 1) => $.CIColorKernel.kernelWithString('kernel vec4 k(vec4 v) { return v; }')
  .applyWithExtentArguments($.NSMakeRect(-1e4, -1e4, 2e4, 2e4), $([v4(r, g, b, a)]));

// Values pass through (v + 8) / 32 into 16-bit linear PNG pixels with alpha 1, one channel set at a time.
// ponytail: range −8 … 24 at 5e-4 steps; widen OFF/SCALE if a filter goes past it.
const OFF = 8, SCALE = 32;
const read = $.CIColorKernel.kernelWithString(`kernel vec4 rd(__sample s, float o, float k, float alpha) {
  return alpha > 0.5 ? vec4((s.a + o) / k, 0.0, 0.0, 1.0) : vec4((s.rgb + o) / k, 1.0); }`);
function px(img, x, y) {
  const out = [];
  for (const alpha of [0, 1]) {
    const one = read.applyWithExtentArguments($.NSMakeRect(x, y, 1, 1), $([img, $(OFF), $(SCALE), $(alpha)]));
    const rep = $.NSBitmapImageRep.imageRepWithData(ctx.PNGRepresentationOfImageFormatColorSpaceOptions(one, $.kCIFormatRGBA16, LIN, $()));
    const c = rep.colorAtXY(0, 0);
    out.push(...(alpha ? [c.redComponent] : [c.redComponent, c.greenComponent, c.blueComponent]));
  }
  return out.map((v) => v * SCALE - OFF);
}

function run([expr, ...points]) {
  const img = eval(expr);
  return points.map((p) => {
    const [x, y] = p.split(',').map(Number);
    return `${p}: ${px(img, x, y).map((v) => v.toFixed(4)).join(' ')}`;
  }).join('\n');
}

// tools/img.js — render macOS images to PNG with AppKit (macOS built-ins only).
// usage: osascript -l JavaScript tools/img.js <mode> <out.png> ...
//   icon   <out> <app-or-icns-path> [px=256]      app icon (also Assets.car-only apps) or .icns contents
//   file   <out> <image-path> [scale=2]           TIFF/PDF/PNG at point size × scale (picks best rep)
//   named  <out> <bundle-path> <name> [scale=2]   image from a bundle's Assets.car
//   symbol <out> <sf-symbol-name> [pt=16] [scale=2] black template mask
//   system <out> <NSImageName> [scale=2]          AppKit named image, e.g. NSShareTemplate
//   cursor <out> [scale=2] [pos]                  arrow cursor, or with pos a macOS 15 window-resize cursor
//                                                 (NSCursorFrameResizePosition: Top 1, Left 2, Bottom 4, Right 8); prints hotspot
// Prints "<width>x<height>" (pixels) on success.
ObjC.import('AppKit');
$.NSApplication.sharedApplication; // NSCursor images are nil without an app instance

function render(img, w, h, out) {
  const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, w, h, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
  $.NSGraphicsContext.saveGraphicsState;
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep));
  img.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, w, h), $.NSZeroRect, $.NSCompositingOperationCopy, 1);
  $.NSGraphicsContext.restoreGraphicsState;
  if (!rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $()).writeToFileAtomically(out, true)) throw new Error('write failed: ' + out);
  return `${w}x${h}`;
}

function scaled(img, scale, out) {
  if (!img || img.isNil()) throw new Error('image not found');
  const s = img.size;
  return render(img, Math.round(s.width * scale), Math.round(s.height * scale), out);
}

function run([mode, out, a, b, c]) {
  switch (mode) {
    case 'icon': {
      const px = Number(b || 256);
      // iconForFile on an .icns gives the generic "ICNS" document icon, so load its contents instead.
      const src = a.endsWith('.icns') ? $.NSImage.alloc.initWithContentsOfFile(a) : $.NSWorkspace.sharedWorkspace.iconForFile(a);
      return render(src, px, px, out);
    }
    case 'file': return scaled($.NSImage.alloc.initWithContentsOfFile(a), Number(b || 2), out);
    case 'named': return scaled($.NSBundle.bundleWithPath(a).imageForResource(b), Number(c || 2), out);
    case 'system': return scaled($.NSImage.imageNamed(a), Number(b || 2), out);
    case 'symbol': {
      const cfg = $.NSImageSymbolConfiguration.configurationWithPointSizeWeightScale(Number(b || 16), 0, 2); // regular weight, medium scale (constants unbridged in JXA)
      const img = $.NSImage.imageWithSystemSymbolNameAccessibilityDescription(a, a);
      if (!img || img.isNil()) throw new Error('no symbol: ' + a);
      return scaled(img.imageWithSymbolConfiguration(cfg), Number(c || 2), out);
    }
    case 'cursor': {
      const cur = b ? $.NSCursor.frameResizeCursorFromPositionInDirections(Number(b), 3) : $.NSCursor.arrowCursor, hs = cur.hotSpot;   // 3 = both directions
      return scaled(cur.image, Number(a || 2), out) + ` hotspot ${hs.x},${hs.y}`;
    }
  }
  throw new Error('bad mode: ' + mode);
}

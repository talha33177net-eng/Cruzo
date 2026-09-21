/**
 * Generates Cruzo's launcher icons.
 *
 * Written by hand rather than pulled from an image library so the project
 * gains no build-time dependency for something it does once. Shapes are
 * rasterised at 4x and box-filtered down, which gives clean edges without
 * needing an anti-aliasing routine.
 *
 * Run with `npm run icons`.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ORANGE = [0xff, 0x5c, 0x1a, 0xff];
const DARK = [0x1a, 0x0a, 0x02, 0xff];
const WHITE = [0xff, 0xff, 0xff, 0xff];
const CLEAR = [0, 0, 0, 0];

const SS = 4; // supersampling factor

// --- tiny PNG writer -------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function writePng(file, width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

// --- drawing ---------------------------------------------------------------

function canvas(size, fill) {
  const buffer = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    buffer[i * 4] = fill[0];
    buffer[i * 4 + 1] = fill[1];
    buffer[i * 4 + 2] = fill[2];
    buffer[i * 4 + 3] = fill[3];
  }
  return buffer;
}

/** Fills a rounded rectangle, coordinates in pixels on the supersampled grid. */
function roundedRect(buffer, size, x, y, w, h, radius, colour) {
  const r = Math.min(radius, w / 2, h / 2);

  for (let py = Math.max(0, Math.floor(y)); py < Math.min(size, Math.ceil(y + h)); py += 1) {
    for (let px = Math.max(0, Math.floor(x)); px < Math.min(size, Math.ceil(x + w)); px += 1) {
      // Distance into the corner region, so only corners get rounded.
      const dx = Math.max(x + r - px - 0.5, 0, px + 0.5 - (x + w - r));
      const dy = Math.max(y + r - py - 0.5, 0, py + 0.5 - (y + h - r));
      if (dx * dx + dy * dy > r * r) continue;

      const i = (py * size + px) * 4;
      buffer[i] = colour[0];
      buffer[i + 1] = colour[1];
      buffer[i + 2] = colour[2];
      buffer[i + 3] = colour[3];
    }
  }
}


/** Filled circle. */
function disc(buffer, size, cx, cy, r, colour) {
  for (let py = Math.max(0, Math.floor(cy - r)); py < Math.min(size, Math.ceil(cy + r)); py += 1) {
    for (let px = Math.max(0, Math.floor(cx - r)); px < Math.min(size, Math.ceil(cx + r)); px += 1) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      if (dx * dx + dy * dy > r * r) continue;
      const i = (py * size + px) * 4;
      buffer[i] = colour[0]; buffer[i+1] = colour[1]; buffer[i+2] = colour[2]; buffer[i+3] = colour[3];
    }
  }
}

/** Annulus — a wheel. */
function ring(buffer, size, cx, cy, rOuter, rInner, colour) {
  for (let py = Math.max(0, Math.floor(cy - rOuter)); py < Math.min(size, Math.ceil(cy + rOuter)); py += 1) {
    for (let px = Math.max(0, Math.floor(cx - rOuter)); px < Math.min(size, Math.ceil(cx + rOuter)); px += 1) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > rOuter * rOuter || d2 < rInner * rInner) continue;
      const i = (py * size + px) * 4;
      buffer[i] = colour[0]; buffer[i+1] = colour[1]; buffer[i+2] = colour[2]; buffer[i+3] = colour[3];
    }
  }
}

/** Thick line with rounded ends: the frame members. */
function capsule(buffer, size, x1, y1, x2, y2, thickness, colour) {
  const r = thickness / 2;
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - r));
  const maxX = Math.min(size, Math.ceil(Math.max(x1, x2) + r));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - r));
  const maxY = Math.min(size, Math.ceil(Math.max(y1, y2) + r));
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  for (let py = minY; py < maxY; py += 1) {
    for (let px = minX; px < maxX; px += 1) {
      const ux = px + 0.5 - x1;
      const uy = py + 0.5 - y1;
      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (ux * dx + uy * dy) / lenSq));
      const ex = ux - dx * t;
      const ey = uy - dy * t;
      if (ex * ex + ey * ey > r * r) continue;
      const i = (py * size + px) * 4;
      buffer[i] = colour[0]; buffer[i+1] = colour[1]; buffer[i+2] = colour[2]; buffer[i+3] = colour[3];
    }
  }
}

/**
 * Draws a smooth path as overlapping capsules.
 *
 * Sampling a quadratic bezier and joining the samples gives a curve with
 * round joins for far less code than a real stroker, and at icon sizes the
 * difference is invisible.
 */
function curve(buffer, size, a, b, c, thickStart, thickEnd, colour, steps = 36) {
  let prev = a;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const inv = 1 - t;
    const x = inv * inv * a[0] + 2 * inv * t * b[0] + t * t * c[0];
    const y = inv * inv * a[1] + 2 * inv * t * b[1] + t * t * c[1];
    // Narrowing as it goes gives the road depth instead of reading as a bar.
    const w = thickStart + (thickEnd - thickStart) * t;
    capsule(buffer, size, prev[0], prev[1], x, y, w, colour);
    prev = [x, y];
  }
}

/** Filled triangle, used for the tapered tail of a map pin. */
function triangle(buffer, size, ax, ay, bx, by, cx, cy, colour) {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(size, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(size, Math.ceil(Math.max(ay, by, cy)));
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (area === 0) return;

  for (let py = minY; py < maxY; py += 1) {
    for (let px = minX; px < maxX; px += 1) {
      const x = px + 0.5;
      const y = py + 0.5;
      // Barycentric sign test: inside when all three weights share a sign.
      const w0 = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / area;
      const w1 = ((cx - bx) * (y - by) - (cy - by) * (x - bx)) / area;
      const w2 = ((ax - cx) * (y - cy) - (ay - cy) * (x - cx)) / area;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const i = (py * size + px) * 4;
      buffer[i] = colour[0]; buffer[i+1] = colour[1]; buffer[i+2] = colour[2]; buffer[i+3] = colour[3];
    }
  }
}

/** Box-filters the supersampled buffer down to the final size. */
function downsample(buffer, bigSize, size) {
  const out = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const i = ((y * SS + sy) * bigSize + (x * SS + sx)) * 4;
          const alpha = buffer[i + 3];
          // Weight colour by alpha so transparent pixels do not darken edges.
          r += buffer[i] * alpha;
          g += buffer[i + 1] * alpha;
          b += buffer[i + 2] * alpha;
          a += alpha;
        }
      }

      const o = (y * size + x) * 4;
      const n = SS * SS;
      out[o] = a === 0 ? 0 : Math.round(r / a);
      out[o + 1] = a === 0 ? 0 : Math.round(g / a);
      out[o + 2] = a === 0 ? 0 : Math.round(b / a);
      out[o + 3] = Math.round(a / n);
    }
  }

  return out;
}

/**
 * Draws the Cruzo mark: three map pins clustered on a route.
 *
 * This says what the app is in one glance — several people, located, on a
 * map — which a vehicle silhouette never did. The near pin is the rider
 * holding the phone; the smaller one further up the road is the rest of the
 * party.
 *
 * Coordinates are normalised to a 0..1 box so the same geometry scales to any
 * icon size.
 */
function drawMark(buffer, bigSize, colour, scale) {
  const span = bigSize * scale;
  const ox = (bigSize - span) / 2;
  const oy = (bigSize - span) / 2;
  // The road carries weight low in the frame, so the whole mark is nudged up
  // to sit optically centred rather than mathematically centred.
  const LIFT = -0.043;
  const X = (u) => ox + u * span;
  const Y = (v) => oy + (v + LIFT) * span;
  const S = (u) => u * span;

  /**
   * One teardrop pin: a ring for the head and a triangle for the tail.
   *
   * The head is hollow so overlapping pins stay distinct, and so the shape
   * still reads at launcher size instead of turning into a blob.
   */
  const pin = (cx, cy, r) => {
    ring(buffer, bigSize, X(cx), Y(cy), S(r), S(r * 0.42), colour);
    triangle(
      buffer,
      bigSize,
      X(cx - r * 0.74),
      Y(cy + r * 0.60),
      X(cx + r * 0.74),
      Y(cy + r * 0.60),
      X(cx),
      Y(cy + r * 2.15),
      colour,
    );
  };

  // A road winding away into the distance, drawn first so the pins stand on
  // it. It is an S rather than a single arc, and narrows as it recedes: a
  // symmetric sagging curve reads as a smile and turns the icon into a face.
  curve(buffer, bigSize, [X(0.06), Y(0.95)], [X(0.34), Y(0.88)], [X(0.46), Y(0.66)], S(0.078), S(0.056), colour);
  curve(buffer, bigSize, [X(0.46), Y(0.66)], [X(0.58), Y(0.47)], [X(0.93), Y(0.395)], S(0.056), S(0.030), colour);

  // Each pin tip rests on the top edge of the road rather than in the middle
  // of it: sunk into the road the two shapes fuse into one blob at small
  // sizes, and the pin stops reading as a pin.
  pin(0.735, 0.200, 0.103);
  pin(0.300, 0.442, 0.160);
}

function render(file, size, background, markColour, scale) {
  const big = size * SS;
  const buffer = canvas(big, background);
  drawMark(buffer, big, markColour, scale);
  writePng(file, size, size, downsample(buffer, big, size));
  console.log(`  ${path.basename(file)}  ${size}x${size}`);
}

// --- outputs ---------------------------------------------------------------

const assets = path.join(__dirname, "..", "assets");

console.log("\ngenerating Cruzo icons");
// Full-bleed: both Android and iOS apply their own mask to this one.
render(path.join(assets, "icon.png"), 1024, ORANGE, DARK, 0.56);
// Adaptive foreground sits on the orange background set in app.json, and must
// stay well inside the safe zone.
render(path.join(assets, "android-icon-foreground.png"), 1024, CLEAR, DARK, 0.42);
// Themed icons are tinted by the launcher; only the alpha channel matters.
render(path.join(assets, "android-icon-monochrome.png"), 1024, CLEAR, WHITE, 0.42);
// Splash art shows on the dark launch background.
render(path.join(assets, "splash-icon.png"), 1024, CLEAR, ORANGE, 0.5);
render(path.join(assets, "favicon.png"), 64, ORANGE, DARK, 0.56);
console.log("done\n");

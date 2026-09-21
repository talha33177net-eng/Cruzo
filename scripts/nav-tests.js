/**
 * Behavioural checks for the navigation engine.
 *
 * These run against a real Valhalla response captured from the public FOSSGIS
 * instance (`scripts/fixtures/route-dhaka.json`), so the maths is exercised
 * against genuine road geometry rather than a synthetic straight line.
 */

const fs = require("fs");
const path = require("path");

const { decodePolyline } = require("../.test-build/polyline.js");
const nav = require("../.test-build/navigation.js");
const motion = require("../.test-build/motion.js");

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "route-dhaka.json"), "utf8"),
);

const M_PER_DEG = 111320;

let failures = 0;

function check(label, actual, expected, tolerance = 0) {
  const ok =
    typeof expected === "number" && typeof actual === "number"
      ? Math.abs(actual - expected) <= tolerance
      : JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "  ok  " : " FAIL "} ${label}` +
      (ok ? "" : `\n         got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`),
  );
}

// --- Build a Route the way routing.ts does -------------------------------
const leg = fixture.trip.legs[0];
const route = {
  shape: decodePolyline(leg.shape, 6),
  maneuvers: leg.maneuvers.map((m) => ({
    type: m.type,
    instruction: m.instruction ?? "Continue",
    verbalAlert: m.verbal_transition_alert_instruction ?? null,
    verbalPre: m.verbal_pre_transition_instruction ?? null,
    streetNames: m.street_names ?? [],
    beginIndex: m.begin_shape_index,
    endIndex: m.end_shape_index,
    distanceM: m.length * 1000,
    durationS: m.time,
  })),
  distanceM: fixture.trip.summary.length * 1000,
  durationS: fixture.trip.summary.time,
  bounds: [0, 0, 0, 0],
};

const index = nav.buildRouteIndex(route);

console.log("\nroute index");
check("shape decoded", route.shape.length, 189);
// Our own cumulative sum should agree with Valhalla's reported trip length.
check(
  "computed length matches Valhalla's (7176 m)",
  index.totalM,
  route.distanceM,
  60,
);
check("cumulative starts at zero", index.cumulative[0], 0, 1e-9);
check("cumulative is monotonic", index.cumulative.every((v, i, a) => i === 0 || v >= a[i - 1]), true);
check("one entry per maneuver", index.maneuverAtM.length, route.maneuvers.length);

console.log("\nlocating on route");
const atStart = nav.locateOnRoute(route, index, route.shape[0], null);
check("start snaps with no deviation", atStart.deviationM, 0, 0.5);
check("start distance along is zero", atStart.distanceAlongM, 0, 0.5);
check("start remaining is full length", atStart.remainingM, index.totalM, 1);
check("start has not arrived", atStart.arrived, false);

const last = route.shape[route.shape.length - 1];
const atEnd = nav.locateOnRoute(route, index, last, null);
check("end deviation is zero", atEnd.deviationM, 0, 0.5);
check("end remaining is zero", atEnd.remainingM, 0, 1);
check("end reports arrival", atEnd.arrived, true);

// A point 20 m short of the destination still counts as arrived.
const nearEnd = offsetMetres(last, 20, 0);
check("20 m out counts as arrived", nav.locateOnRoute(route, index, nearEnd, null).arrived, true);
// 200 m short does not.
const farFromEnd = offsetMetres(last, 200, 0);
check("200 m out is not arrival", nav.locateOnRoute(route, index, farFromEnd, null).arrived, false);

console.log("\ndeviation measurement");
// Offset a midpoint perpendicular to its own segment by a known distance.
const seg = 60;
const perp = perpendicularOffset(route.shape[seg], route.shape[seg + 1], 100);
const off = nav.locateOnRoute(route, index, perp, null);
check("100 m perpendicular reads as ~100 m", off.deviationM, 100, 8);
const perp30 = perpendicularOffset(route.shape[seg], route.shape[seg + 1], 30);
check("30 m perpendicular reads as ~30 m", nav.locateOnRoute(route, index, perp30, null).deviationM, 30, 5);

console.log("\nsimulated ride along the route");
let previous = null;
let lastAlong = -1;
let lastRemainingS = Infinity;
let monotonic = true;
let timeMonotonic = true;
let maxDeviation = 0;
const upcomingSeen = [];

for (let i = 0; i < route.shape.length; i += 1) {
  const p = nav.locateOnRoute(route, index, route.shape[i], previous);
  previous = p.segmentIndex;

  if (p.distanceAlongM < lastAlong - 0.5) monotonic = false;
  if (p.remainingS > lastRemainingS + 0.5) timeMonotonic = false;
  lastAlong = p.distanceAlongM;
  lastRemainingS = p.remainingS;
  maxDeviation = Math.max(maxDeviation, p.deviationM);

  if (upcomingSeen[upcomingSeen.length - 1] !== p.upcomingIndex) {
    upcomingSeen.push(p.upcomingIndex);
  }
}

check("distance along never goes backwards", monotonic, true);
check("remaining time never increases", timeMonotonic, true);
check("riding the shape stays on the line", maxDeviation < 0.5, true);
check("final remaining distance is zero", lastAlong, index.totalM, 1);
// The banner must walk forward through the turns, never skip or bounce.
check("upcoming maneuver advances in order", upcomingSeen.every((v, i, a) => i === 0 || v > a[i - 1]), true);
check("every maneuver is surfaced", upcomingSeen.length >= route.maneuvers.length - 1, true);

console.log("\nwindowed search agrees with a full scan");
// The window exists for speed; it must not change the answer.
let mismatches = 0;
previous = null;
for (let i = 0; i < route.shape.length; i += 3) {
  const nudged = offsetMetres(route.shape[i], 8, 41);
  const windowed = nav.locateOnRoute(route, index, nudged, previous);
  const fresh = nav.locateOnRoute(route, index, nudged, null);
  previous = windowed.segmentIndex;
  if (Math.abs(windowed.distanceAlongM - fresh.distanceAlongM) > 1) mismatches += 1;
}
check("windowed and full scans agree", mismatches, 0);

// After a jump far away, the window must be abandoned rather than trusted.
const farAway = offsetMetres(route.shape[5], 4000, 90);
const recovered = nav.locateOnRoute(route, index, farAway, 150);
const truth = nav.locateOnRoute(route, index, farAway, null);
check("a big jump falls back to a full scan", recovered.segmentIndex, truth.segmentIndex);

console.log("\noff-route decision");
check("on the line is not off-route", nav.isOffRoute(5, 5, 40), false);
check("far off the line is off-route", nav.isOffRoute(120, 5, 40), true);
// A poor GPS fix must widen the threshold, not trigger a reroute.
check("noise with a 35 m accuracy radius is tolerated", nav.isOffRoute(60, 35, 40), false);
check("a real departure still fires despite poor accuracy", nav.isOffRoute(200, 35, 40), true);
check("accuracy slack is capped at 40 m", nav.isOffRoute(85, 500, 40), true);
check("null accuracy uses the base threshold", nav.isOffRoute(45, null, 40), true);

// A parallel street 25 m away never crosses the distance line on its own.
check("a close parallel road alone is not off-route", nav.isOffRoute(25, 5, 40), false);
check("riding it the wrong way is off-route", nav.isOffRoute(25, 5, 40, 90), true);
check("a small course wobble on the route is not", nav.isOffRoute(25, 5, 40, 30), false);
check("heading alone never fires when on the line", nav.isOffRoute(8, 5, 40, 180), false);

console.log("\nroute direction and remaining stops");
const midAlong = index.cumulative[seg];
const pt = nav.pointAlong(route, index, midAlong, 0);
check("pointAlong lands on the shape point", pt[0], route.shape[seg][0], 1e-6);
check("pointAlong clamps before the start", nav.pointAlong(route, index, -50)[0], route.shape[0][0], 1e-9);
check("pointAlong clamps past the end", nav.pointAlong(route, index, index.totalM + 50)[1], last[1], 1e-9);
// The route direction must agree with the direction a rider riding it takes.
let bearingMisses = 0;
for (let i = 10; i < route.shape.length - 10; i += 7) {
  const at = nav.locateOnRoute(route, index, route.shape[i], null);
  const b = nav.routeBearingAt(route, index, at.distanceAlongM, at.segmentIndex);
  const ahead = nav.pointAlong(route, index, at.distanceAlongM + 20, at.segmentIndex);
  const expected = bearingBetween(route.shape[i], ahead);
  const diff = Math.abs(((((b - expected) % 360) + 540) % 360) - 180);
  if (diff > 45) bearingMisses += 1;
}
check("route bearing follows the road", bearingMisses, 0);

const multi = { ...route, stopIndices: [100, 200] };
check("all stops ahead at the start", nav.remainingStops(["a", "b", "end"], multi, 5), ["a", "b", "end"]);
check("a passed stop is dropped", nav.remainingStops(["a", "b", "end"], multi, 150), ["b", "end"]);
check("the destination is always kept", nav.remainingStops(["a", "b", "end"], multi, 999), ["end"]);
check("a single stop is untouched", nav.remainingStops(["end"], route, 999), ["end"]);

console.log("\nmotion smoothing");
check("heading smoothing takes the short way past north", motion.smoothHeading(350, 10, 0.5), 0, 1e-9);
check("full weight lands on the reading", motion.smoothHeading(90, 180, 1), 180, 1e-9);

// A parked bike with fixes wandering ±5 m should barely move.
const parked = new motion.PositionFilter();
const home = route.shape[0];
let worst = 0;
for (let i = 0; i < 60; i += 1) {
  const noisy = offsetMetres(home, 5, (i * 137) % 360);
  const out = parked.update(noisy, 8, 1000 * (i + 1), 0.2, null);
  worst = Math.max(worst, geoDistance(out, home));
}
check("a parked bike stays within 6 m", worst < 6, true);

// A bike at 15 m/s must not be dragged behind by the smoothing.
const riding = new motion.PositionFilter();
let lagM = 0;
for (let i = 0; i < 30; i += 1) {
  const truthAt = offsetMetres(home, 15 * i, 45);
  const out = riding.update(truthAt, 5, 1000 * (i + 1), 15, 45);
  if (i > 5) lagM = Math.max(lagM, geoDistance(out, truthAt));
}
check("a moving bike is tracked within 3 m", lagM < 3, true);

console.log("\nformatting");
check("under 30 m says Now", nav.formatManeuverDistance(12), "Now");
check("metres round to 10", nav.formatManeuverDistance(447), "450 m");
check("kilometres get a decimal", nav.formatManeuverDistance(1540), "1.5 km");
check("sub-minute duration", nav.formatDuration(30), "<1 min");
check("minutes", nav.formatDuration(600), "10 min");
check("hours and minutes", nav.formatDuration(3900), "1 h 5 min");
check("negative duration is placeholder", nav.formatDuration(-5), "--");

console.log(
  failures === 0
    ? "\nAll navigation checks passed.\n"
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);

// --- helpers --------------------------------------------------------------

/** Moves a point `metres` along `bearing` degrees clockwise from north. */
function offsetMetres(point, metres, bearing) {
  const rad = (bearing * Math.PI) / 180;
  const dLat = (metres * Math.cos(rad)) / M_PER_DEG;
  const dLng =
    (metres * Math.sin(rad)) / (M_PER_DEG * Math.cos((point[1] * Math.PI) / 180));
  return [point[0] + dLng, point[1] + dLat];
}

/** Offsets the midpoint of a segment at right angles to it. */
function perpendicularOffset(a, b, metres) {
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const kx = M_PER_DEG * Math.cos((mid[1] * Math.PI) / 180);
  const dx = (b[0] - a[0]) * kx;
  const dy = (b[1] - a[1]) * M_PER_DEG;
  const length = Math.hypot(dx, dy) || 1;
  // Rotate the unit direction vector by 90 degrees.
  const nx = -dy / length;
  const ny = dx / length;
  return [mid[0] + (nx * metres) / kx, mid[1] + (ny * metres) / M_PER_DEG];
}

function bearingBetween(a, b) {
  const kx = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return ((Math.atan2((b[0] - a[0]) * kx, b[1] - a[1]) * 180) / Math.PI + 360) % 360;
}

function geoDistance(a, b) {
  const kx = M_PER_DEG * Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * M_PER_DEG);
}

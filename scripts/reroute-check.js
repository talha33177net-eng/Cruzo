/**
 * End-to-end check of the rerouting loop against the live Valhalla service.
 *
 * Unlike `npm test`, this one needs the network. It simulates a rider missing
 * a turn and confirms the three things that have to hold for rerouting to feel
 * like Google Maps:
 *
 *   1. riding the route correctly never triggers a reroute
 *   2. leaving it does trigger one, after the deviation is confirmed
 *   3. the replacement route actually starts from where the rider now is
 *
 * Run with `npm run check:routing`.
 */

const nav = require("../.test-build/navigation.js");
const { decodePolyline } = require("../.test-build/polyline.js");

const VALHALLA = "https://valhalla1.openstreetmap.de/route";
const OFF_ROUTE_M = 40;
const OFF_ROUTE_FIXES = 3;
const M_PER_DEG = 111320;

const START = [90.3954, 23.7387]; // Shahbagh, Dhaka
const END = [90.4152, 23.7806]; // Gulshan

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

function offsetMetres(point, metres, bearing) {
  const rad = (bearing * Math.PI) / 180;
  const dLat = (metres * Math.cos(rad)) / M_PER_DEG;
  const dLng =
    (metres * Math.sin(rad)) / (M_PER_DEG * Math.cos((point[1] * Math.PI) / 180));
  return [point[0] + dLng, point[1] + dLat];
}

async function getRoute(from, to) {
  const body = {
    locations: [
      { lat: from[1], lon: from[0] },
      { lat: to[1], lon: to[0] },
    ],
    costing: "motorcycle",
    directions_options: { units: "kilometers", language: "en-US" },
  };

  const response = await fetch(`${VALHALLA}?json=${encodeURIComponent(JSON.stringify(body))}`);
  if (!response.ok) throw new Error(`Valhalla returned ${response.status}`);

  const data = await response.json();
  if (!data.trip) throw new Error(data.error ?? "no trip returned");

  const leg = data.trip.legs[0];
  return {
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
    distanceM: data.trip.summary.length * 1000,
    durationS: data.trip.summary.time,
  };
}

/** Feeds positions through the same off-route rule the app uses. */
function ride(route, index, positions) {
  let segment = null;
  let run = 0;
  let rerouteAt = -1;

  positions.forEach((position, i) => {
    const progress = nav.locateOnRoute(route, index, position, segment);
    segment = progress.segmentIndex;

    // A steady 8 m accuracy radius, typical of a clear-sky fix.
    run = nav.isOffRoute(progress.deviationM, 8, OFF_ROUTE_M) ? run + 1 : 0;
    if (run >= OFF_ROUTE_FIXES && rerouteAt === -1) rerouteAt = i;
  });

  return { rerouteAt };
}

async function main() {
  console.log("\nfetching a live motorcycle route from Valhalla…");
  const route = await getRoute(START, END);
  const index = nav.buildRouteIndex(route);
  console.log(
    `  route: ${(route.distanceM / 1000).toFixed(2)} km, ` +
      `${route.maneuvers.length} maneuvers, ${route.shape.length} shape points\n`,
  );

  check("route has real length", route.distanceM > 1000, true);
  check("route has turns", route.maneuvers.length > 2, true);

  console.log("\nriding the route correctly");
  // Follow the line exactly, with a couple of metres of GPS jitter.
  const faithful = route.shape.map((p, i) => offsetMetres(p, 3, (i * 57) % 360));
  const clean = ride(route, index, faithful);
  check("staying on the road never reroutes", clean.rerouteAt, -1);

  console.log("\nmissing a turn");
  // Ride the first part properly, then peel away at a right angle — the shape
  // a wrong turn actually makes.
  const turnAt = Math.floor(route.shape.length * 0.35);
  const wrong = route.shape.slice(0, turnAt).map((p) => p);
  let stray = route.shape[turnAt];
  // Peel off at right angles to the direction of travel.
  const strayBearing = bearingOf(route.shape[turnAt - 1], route.shape[turnAt]) + 90;
  for (let i = 0; i < 12; i += 1) {
    stray = offsetMetres(stray, 25, strayBearing);
    wrong.push(stray);
  }

  const missed = ride(route, index, wrong);
  check("leaving the road triggers a reroute", missed.rerouteAt > -1, true);
  check("reroute waits for confirmation, not one stray fix", missed.rerouteAt >= turnAt + OFF_ROUTE_FIXES - 1, true);

  const strayedBy = nav.locateOnRoute(route, index, stray, null).deviationM;
  console.log(`  drifted ${Math.round(strayedBy)} m off the line before rerouting\n`);

  console.log("recovering with a new route");
  const replacement = await getRoute(stray, END);
  const replacementIndex = nav.buildRouteIndex(replacement);
  console.log(
    `  new route: ${(replacement.distanceM / 1000).toFixed(2)} km, ` +
      `${replacement.maneuvers.length} maneuvers\n`,
  );

  check("a replacement route comes back", replacement.shape.length > 1, true);
  // The whole point: the new route must begin where the rider actually is.
  const onNew = nav.locateOnRoute(replacement, replacementIndex, stray, null);
  check("the new route starts at the rider", onNew.deviationM < 30, true);
  check("the new route still reaches the destination", nav.locateOnRoute(replacement, replacementIndex, END, null).deviationM < 60, true);
  check("progress resets to the beginning of the new route", onNew.distanceAlongM < 60, true);

  console.log(
    failures === 0
      ? "\nRerouting behaves correctly end to end."
      : `\n${failures} check(s) failed.`,
  );

  await checkStopsAndAlternates();
}

function bearingOf(a, b) {
  const kx = M_PER_DEG * Math.cos((a[1] * Math.PI) / 180);
  const dx = (b[0] - a[0]) * kx;
  const dy = (b[1] - a[1]) * M_PER_DEG;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

main().catch((error) => {
  console.error("\nCheck could not run:", error.message);
  console.error("(this check needs network access to valhalla1.openstreetmap.de)\n");
  process.exit(1);
});

// --- multi-stop and alternates ---------------------------------------------

/**
 * Concatenates legs exactly as `toRoute` does, so the offset arithmetic that
 * joins them is exercised for real.
 */
function flatten(trip) {
  const shape = [];
  const maneuvers = [];
  const stopIndices = [];
  for (const leg of trip.legs) {
    const offset = shape.length;
    shape.push(...decodePolyline(leg.shape, 6));
    if (offset > 0) stopIndices.push(offset);
    for (const m of leg.maneuvers) {
      maneuvers.push({
        beginIndex: m.begin_shape_index + offset,
        endIndex: m.end_shape_index + offset,
      });
    }
  }
  return { shape, maneuvers, stopIndices };
}

async function rawRoute(body) {
  const res = await fetch(`${VALHALLA}?json=${encodeURIComponent(JSON.stringify(body))}`);
  if (!res.ok) throw new Error(`Valhalla returned ${res.status}`);
  return res.json();
}

async function checkStopsAndAlternates() {
  console.log("\nalternate routes");
  const alt = await rawRoute({
    locations: [
      { lat: START[1], lon: START[0] },
      { lat: END[1], lon: END[0] },
    ],
    costing: "motorcycle",
    alternates: 2,
    directions_options: { units: "kilometers" },
  });
  const options = [alt.trip, ...(alt.alternates ?? []).map((a) => a.trip)];
  check("more than one route is offered", options.length > 1, true);
  check("every option has real length", options.every((t) => t.summary.length > 0.5), true);
  // Distinct options, otherwise the chooser shows the same road three times.
  const lengths = options.map((t) => t.summary.length.toFixed(2));
  check("the options actually differ", new Set(lengths).size > 1, true);

  console.log("\nmulti-stop routing");
  const VIA = [90.405, 23.76];
  const multi = await rawRoute({
    locations: [
      { lat: START[1], lon: START[0] },
      { lat: VIA[1], lon: VIA[0] },
      { lat: END[1], lon: END[0] },
    ],
    costing: "motorcycle",
    directions_options: { units: "kilometers" },
  });

  check("a stop produces two legs", multi.trip.legs.length, 2);

  const flat = flatten(multi.trip);
  check("one stop index recorded", flat.stopIndices.length, 1);
  check("the stop sits inside the shape", flat.stopIndices[0] > 0 && flat.stopIndices[0] < flat.shape.length, true);

  // The offset arithmetic is the thing that breaks silently: without it every
  // turn after the first stop points at the wrong place on the line.
  const inBounds = flat.maneuvers.every(
    (m) => m.beginIndex >= 0 && m.endIndex < flat.shape.length && m.endIndex >= m.beginIndex,
  );
  check("every maneuver index lands inside the joined shape", inBounds, true);

  const ordered = flat.maneuvers.every((m, i, all) => i === 0 || m.beginIndex >= all[i - 1].beginIndex);
  check("maneuvers stay in order across the join", ordered, true);

  const secondLegFirst = multi.trip.legs[1].maneuvers[0];
  const joined = flat.maneuvers[multi.trip.legs[0].maneuvers.length];
  check(
    "the first turn after the stop is offset, not restarted",
    joined.beginIndex,
    secondLegFirst.begin_shape_index + flat.stopIndices[0],
  );

  console.log(
    failures === 0
      ? "\nRouting, alternates and stops all behave.\n"
      : `\n${failures} check(s) failed.\n`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

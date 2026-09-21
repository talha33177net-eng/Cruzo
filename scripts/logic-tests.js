/**
 * Behavioural checks for Cruzo's pure logic — the geo maths and the ride-code
 * parsing that the UI depends on but cannot easily exercise on a device.
 *
 * Run with `npm test`, which compiles the modules under test first.
 */

const geo = require("../.test-build/geo.js");
const rc = require("../.test-build/rideCode.js");

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

console.log("\ngeo — distance and bearing");
// One degree of latitude is ~111.19 km anywhere on the globe.
check("1 degree of latitude is ~111.2 km", geo.distanceMeters([0, 0], [0, 1]), 111195, 100);
check("identical points are 0 m apart", geo.distanceMeters([90.4, 23.8], [90.4, 23.8]), 0, 1e-9);
check("distance is symmetric", geo.distanceMeters([90, 23], [91, 24]), geo.distanceMeters([91, 24], [90, 23]), 1e-6);
check("due north is 0 degrees", geo.bearingDegrees([90, 23], [90, 24]), 0, 0.5);
check("due east is 90 degrees", geo.bearingDegrees([90, 0], [91, 0]), 90, 0.5);
check("due south is 180 degrees", geo.bearingDegrees([90, 24], [90, 23]), 180, 0.5);
check("bearing never returns negative", geo.bearingDegrees([90, 0], [89, 0]) >= 0, true);

console.log("\ngeo — compass and formatting");
check("0 is N", geo.compassPoint(0), "N");
check("91 is E", geo.compassPoint(91), "E");
check("315 is NW", geo.compassPoint(315), "NW");
check("360 wraps to N", geo.compassPoint(360), "N");
check("metres below 1 km", geo.formatDistance(450), "450 m");
check("one decimal below 10 km", geo.formatDistance(1500), "1.5 km");
check("whole km above 10 km", geo.formatDistance(24000), "24 km");
check("non-finite distance is placeholder", geo.formatDistance(NaN), "--");
check("10 m/s is 36 km/h", geo.formatSpeed(10), "36");
check("null speed is placeholder", geo.formatSpeed(null), "--");
check("negative speed clamps to 0", geo.formatSpeed(-5), "0");

console.log("\ngeo — bounds");
check("no points gives null", geo.boundsOf([]), null);
const single = geo.boundsOf([[90.4, 23.8]]);
// A zero-extent box cannot be fitted by MapLibre, so one rider must still
// produce a real span.
check("one point still spans east-west", single[2] > single[0], true);
check("one point still spans north-south", single[3] > single[1], true);
check("one point stays centred", (single[0] + single[2]) / 2, 90.4, 1e-9);
const pair = geo.boundsOf([[90, 23], [91, 24]], 0);
check("bounds west edge", pair[0], 90, 1e-9);
check("bounds south edge", pair[1], 23, 1e-9);
check("bounds east edge", pair[2], 91, 1e-9);
check("bounds north edge", pair[3], 24, 1e-9);
const padded = geo.boundsOf([[90, 23], [91, 24]], 0.25);
check("padding widens the box", padded[0] < 90 && padded[2] > 91, true);

console.log("\nride codes");
check("generated codes are valid", rc.isValidRideCode(rc.generateRideCode()), true);
check("lowercase input is accepted", rc.normalizeRideCode("7kp2qx"), "7KP2QX");
check("confusable characters are dropped, never remapped", rc.normalizeRideCode("0O1IL"), "");
check("short codes are invalid", rc.isValidRideCode("ABC"), false);
check("codes containing O are invalid", rc.isValidRideCode("ABCDEO"), false);

console.log("\nQR payloads");
check("query link", rc.parseScannedPayload("cruzo://join?code=7KP2QX"), "7KP2QX");
check("path link", rc.parseScannedPayload("cruzo://join/7KP2QX"), "7KP2QX");
check("bare lowercase code", rc.parseScannedPayload("  7kp2qx "), "7KP2QX");
check("link round-trips", rc.parseScannedPayload(rc.rideCodeToLink("ABCDEF")), "ABCDEF");
// A foreign QR must be rejected outright rather than having letters scraped
// out of it into a plausible-looking code.
check("arbitrary URL is rejected", rc.parseScannedPayload("https://example.com/hello"), null);
check("short URL is rejected", rc.parseScannedPayload("https://youtube.com"), null);
check("wifi QR is rejected", rc.parseScannedPayload("WIFI:S:MyNet;T:WPA;P:pw;;"), null);
check("over-long code is rejected", rc.parseScannedPayload("ABCDEFGH"), null);
check("empty payload is rejected", rc.parseScannedPayload(""), null);

console.log("\ngroup destination");
const gt = require("../.test-build/groupTrip.js");

const HATIRJHEEL = { lngLat: [90.4035, 23.7589], label: "Hatirjheel" };
const FUEL = { lngLat: [90.39, 23.75], label: "Fuel" };
const ASHULIA = { lngLat: [90.29, 23.9], label: "Ashulia" };

const riderAt = (id, trip, extra = {}) => ({
  id,
  name: id,
  bike: "",
  isHost: false,
  lng: 90.4,
  lat: 23.8,
  heading: null,
  speed: null,
  accuracy: null,
  sos: false,
  navigating: trip !== null,
  trip,
  updatedAt: 0,
  ...extra,
});

check("nobody navigating offers nothing", gt.pickGroupTrip([riderAt("a", null), riderAt("b", null)], "a"), null);
check("your own trip is never offered back to you", gt.pickGroupTrip([riderAt("me", [HATIRJHEEL])], "me"), null);

const offered = gt.pickGroupTrip([riderAt("me", null), riderAt("x", [FUEL, HATIRJHEEL])], "me");
check("another rider's trip is offered", offered?.leader.id, "x");
// Stops are shared, not the route: the follower plans their own way there.
check("the whole trip is offered, via stops included", offered?.stops.map((s) => s.label), ["Fuel", "Hatirjheel"]);

const hostWins = gt.pickGroupTrip(
  [
    riderAt("a", [ASHULIA]),
    riderAt("b", [ASHULIA]),
    riderAt("z", [HATIRJHEEL], { isHost: true }),
  ],
  "me",
);
check("the host's trip outranks a bigger crowd", hostWins?.leader.id, "z");

const crowd = gt.pickGroupTrip(
  [riderAt("a", [HATIRJHEEL]), riderAt("b", [ASHULIA]), riderAt("c", [ASHULIA])],
  "me",
);
check("without the host, the most popular destination wins", crowd?.stops[0].label, "Ashulia");
check("riders already going are counted", crowd?.alsoGoing, 1);

const tieA = gt.pickGroupTrip([riderAt("m", [HATIRJHEEL]), riderAt("k", [ASHULIA])], "me");
const tieB = gt.pickGroupTrip([riderAt("k", [ASHULIA]), riderAt("m", [HATIRJHEEL])], "me");
check("a tie resolves the same way whatever the roster order", tieA?.leader.id, tieB?.leader.id);

const nearby = { lngLat: [90.4038, 23.759], label: "Hatirjheel gate" };
check("a pin 40 m away is the same destination", gt.sameDestination([nearby], [HATIRJHEEL]), true);
check("a different town is not", gt.sameDestination([HATIRJHEEL], [ASHULIA]), false);
check("only the final stop decides", gt.sameDestination([FUEL, HATIRJHEEL], [HATIRJHEEL]), true);
check("an empty trip matches nothing", gt.sameDestination([], [HATIRJHEEL]), false);

// Presence is whatever a peer chose to send; a bad trip is dropped whole.
check("a trip with a non-numeric coordinate is dropped", gt.sanitizeTrip([{ lngLat: ["90", 23], label: "x" }]), null);
check("an off-planet coordinate is dropped", gt.sanitizeTrip([{ lngLat: [500, 23], label: "x" }]), null);
check("a non-array trip is dropped", gt.sanitizeTrip("Hatirjheel"), null);
check("an oversized trip is dropped", gt.sanitizeTrip(new Array(50).fill(HATIRJHEEL)), null);
check("a missing label gets a placeholder", gt.sanitizeTrip([{ lngLat: [90, 23] }])?.[0].label, "Destination");
check(
  "a garbage trip from a peer is never offered",
  gt.pickGroupTrip([riderAt("x", [{ lngLat: [NaN, 1], label: "x" }])], "me"),
  null,
);
check("a rider who stopped navigating has no destination", gt.destinationOf(riderAt("x", [HATIRJHEEL], { navigating: false })), null);

const moved = gt.pickGroupTrip([riderAt("x", [ASHULIA])], "me");
check("a new destination makes a new suggestion", moved?.key !== offered?.key, true);

console.log("\nchat");
const chat = require("../.test-build/chat.js");

const msg = (id, at, text = "hi") => ({ id, from: "a", name: "A", text, at });

const merged = chat.mergeMessages([msg("1", 10)], [msg("3", 30), msg("2", 20)]);
check("messages are ordered by time", merged.map((m) => m.id), ["1", "2", "3"]);
// The same message arrives live and again inside a history hand-over.
check("a repeated message is kept once", chat.mergeMessages(merged, [msg("2", 20)]).length, 3);
const unchanged = chat.mergeMessages(merged, [msg("2", 20)]);
check("nothing new returns the same array", unchanged === merged, true);
check("malformed messages are dropped", chat.mergeMessages([], [null, { id: 1 }, "hello", msg("x", NaN)]).length, 0);
check("blank messages are dropped", chat.mergeMessages([], [msg("x", 1, "   ")]).length, 0);
const many = Array.from({ length: 150 }, (_, i) => msg(String(i), i));
const capped = chat.mergeMessages([], many);
check("history is capped", capped.length, chat.MAX_CHAT_HISTORY);
check("the newest messages survive the cap", capped[capped.length - 1].id, "149");
check("long text is truncated", chat.cleanChatText("x".repeat(1000)).length, chat.MAX_CHAT_LENGTH);
check("whitespace is collapsed", chat.cleanChatText("  fuel \n\n stop "), "fuel stop");

check("the lowest id coordinates", chat.isCoordinator("a", ["a", "b", "c"]), true);
check("anyone else does not", chat.isCoordinator("b", ["a", "b", "c"]), false);
check("alone, you coordinate", chat.isCoordinator("b", ["b"]), true);
check("before the roster syncs, you coordinate", chat.isCoordinator("b", []), true);
// History requests exclude the newcomer, who has nothing to give.
check("a newcomer's own id is set aside", chat.isCoordinator("b", ["a", "b"].filter((id) => id !== "a")), true);

console.log("\nvoice call");
const voice = require("../.test-build/voice.js");

// Exactly one side of each pair opens the connection, or offers cross in flight.
check("the lower id offers", voice.shouldOffer("a", "b"), true);
check("the higher id waits", voice.shouldOffer("b", "a"), false);
const callIds = ["r_k2", "r_a9", "r_zz", "r_m1"];
check(
  "every pair in a group has exactly one offerer",
  callIds.every((x) =>
    callIds.every((y) => x === y || voice.shouldOffer(x, y) !== voice.shouldOffer(y, x)),
  ),
  true,
);
// A rider who rejoins gets a fresh connection, never the stale one.
check(
  "a rejoin is a different peer",
  voice.peerKey({ id: "a", session: "1" }) !== voice.peerKey({ id: "a", session: "2" }),
  true,
);
check("two sessions never share an id", voice.createSessionId() !== voice.createSessionId(), true);

const signal = { kind: "offer", from: "a", fromSession: "1", to: "b", toSession: "2", sdp: "v=0" };
check("a well-formed offer is accepted", voice.parseSignal(signal)?.kind, "offer");
check("an unknown kind is dropped", voice.parseSignal({ ...signal, kind: "candidate" }), null);
check("a signal without a target is dropped", voice.parseSignal({ ...signal, to: "" }), null);
check("an oversized SDP is dropped", voice.parseSignal({ ...signal, sdp: "x".repeat(30000) }), null);
check("junk is dropped", voice.parseSignal("hello"), null);
check("a member without a session is dropped", voice.asVoiceMember({ id: "a" }), null);
check("muted defaults to false", voice.asVoiceMember({ id: "a", session: "1" })?.muted, false);

console.log(
  failures === 0
    ? "\nAll logic checks passed.\n"
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);

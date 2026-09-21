/**
 * End-to-end check of the group-ride mechanism against the real project.
 *
 * Simulates two phones joining the same party and confirms each one sees the
 * other's live position — which is the single behaviour the whole app exists
 * for, and the one thing that cannot be verified with an HTTP request.
 *
 * Reads credentials from .env. Run with `npm run check:realtime`.
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// --- credentials -----------------------------------------------------------

const envPath = path.join(__dirname, "..", ".env");
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!URL || !KEY) {
  console.error("\n.env is missing EXPO_PUBLIC_SUPABASE_URL or _ANON_KEY\n");
  process.exit(1);
}

const CODE = `PROBE${Date.now() % 10}`;
const CHANNEL = `ride:${CODE}`;

let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "  ok  " : " FAIL "} ${label}` +
      (ok ? "" : `\n         got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`),
  );
}

/** Joins the party channel the way `useRideChannel` does. */
function joinAs(rider) {
  const client = createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });

  const channel = client.channel(CHANNEL, {
    // Without `enabled` this client never receives anyone else's presence.
    config: { presence: { key: rider.id, enabled: true } },
  });

  const seen = () => {
    const state = channel.presenceState();
    return Object.values(state)
      .map((entries) => entries[entries.length - 1])
      .filter(Boolean);
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${rider.name} could not subscribe within 20s`)),
      20000,
    );

    channel.on("presence", { event: "sync" }, () => {});

    channel.subscribe(async (status, err) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        await channel.track(rider);
        resolve({ client, channel, seen });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        reject(err ?? new Error(`${rider.name}: ${status}`));
      }
    });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Joins the party's chat channel the way `useRideChat` does. */
function joinChat(client) {
  const channel = client.channel(`chat:${CODE}`, {
    config: { broadcast: { self: false } },
  });
  const received = [];
  for (const event of ["msg", "history"]) {
    channel.on("broadcast", { event }, ({ payload }) => received.push({ event, payload }));
  }
  const got = (event) => received.filter((r) => r.event === event).map((r) => r.payload);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("chat could not subscribe within 20s")), 20000);
    channel.subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve({ channel, got });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        reject(err ?? new Error(`chat: ${status}`));
      }
    });
  });
}

const ALICE = {
  id: "probe-alice",
  name: "Alice",
  bike: "R15",
  isHost: true,
  sos: false,
  lng: 90.3954,
  lat: 23.7387,
  heading: 45,
  speed: 12,
  accuracy: 8,
  updatedAt: Date.now(),
};

const BOB = {
  id: "probe-bob",
  name: "Bob",
  bike: "Duke 390",
  isHost: false,
  sos: false,
  lng: 90.4152,
  lat: 23.7806,
  heading: 210,
  speed: 9,
  accuracy: 6,
  updatedAt: Date.now(),
};

async function main() {
  console.log(`\njoining party channel "${CHANNEL}" as two riders…\n`);

  const alice = await joinAs(ALICE);
  const bob = await joinAs(BOB);

  // Presence propagates through the server; give it a moment to settle.
  await wait(3000);

  const aliceSees = alice.seen();
  const bobSees = bob.seen();

  check("Alice sees two riders", aliceSees.length, 2);
  check("Bob sees two riders", bobSees.length, 2);

  const bobViaAlice = aliceSees.find((r) => r.id === "probe-bob");
  const aliceViaBob = bobSees.find((r) => r.id === "probe-alice");

  check("Alice sees Bob", Boolean(bobViaAlice), true);
  check("Bob sees Alice", Boolean(aliceViaBob), true);

  if (bobViaAlice) {
    check("Bob's name arrived intact", bobViaAlice.name, "Bob");
    check("Bob's bike arrived intact", bobViaAlice.bike, "Duke 390");
    check("Bob's longitude is exact", bobViaAlice.lng, BOB.lng);
    check("Bob's latitude is exact", bobViaAlice.lat, BOB.lat);
    check("Bob's heading survived", bobViaAlice.heading, BOB.heading);
  }
  if (aliceViaBob) {
    check("Alice is flagged as host", aliceViaBob.isHost, true);
  }

  // Moving must propagate, not just the initial join.
  console.log("\n  Bob rides on…");
  await bob.channel.track({ ...BOB, lng: 90.42, lat: 23.79, updatedAt: Date.now() });
  await wait(2500);

  const moved = alice.seen().find((r) => r.id === "probe-bob");
  check("Alice sees Bob's new position", moved?.lng, 90.42);


  // SOS must reach the rest of the party immediately, because it rides on
  // presence rather than a separate event.
  console.log("\n  Bob raises an SOS…");
  await bob.channel.track({ ...BOB, lng: 90.42, lat: 23.79, sos: true, updatedAt: Date.now() });
  await wait(2500);

  const inTrouble = alice.seen().find((r) => r.id === "probe-bob");
  check("Alice sees Bob's SOS", inTrouble?.sos, true);
  check("Alice herself is not flagged", alice.seen().find((r) => r.id === "probe-alice")?.sos, false);

  console.log("  Bob stands down…");
  await bob.channel.track({ ...BOB, lng: 90.42, lat: 23.79, sos: false, updatedAt: Date.now() });
  await wait(2500);
  check("the SOS clears again", alice.seen().find((r) => r.id === "probe-bob")?.sos, false);

  // A journey's destination rides on presence, so everyone else can be offered
  // the same place and plan their own route to it.
  console.log("\n  Alice sets off for Hatirjheel…");
  const trip = [{ lngLat: [90.4035, 23.7589], label: "Hatirjheel" }];
  await alice.channel.track({ ...ALICE, navigating: true, trip, updatedAt: Date.now() });
  await wait(2500);
  const leader = bob.seen().find((r) => r.id === "probe-alice");
  check("Bob sees Alice's destination", leader?.trip?.[0]?.label, "Hatirjheel");
  check("the coordinates arrive exact", leader?.trip?.[0]?.lngLat, trip[0].lngLat);

  // Chat is broadcast only: it must reach the other rider live, and a rider
  // arriving late must be handed the conversation by someone already there.
  console.log("\n  Alice and Bob open the chat…");
  const chatAlice = await joinChat(alice.client);
  const chatBob = await joinChat(bob.client);
  await chatAlice.channel.send({
    type: "broadcast",
    event: "msg",
    payload: { id: "probe-1", from: "probe-alice", name: "Alice", text: "Fuel stop", at: Date.now() },
  });
  await wait(2000);
  check("Bob receives Alice's message", chatBob.got("msg").map((p) => p.text), ["Fuel stop"]);
  check("Alice is not echoed her own message", chatAlice.got("msg").length, 0);

  chatAlice.channel.on("broadcast", { event: "history_request" }, () => {
    void chatAlice.channel.send({
      type: "broadcast",
      event: "history",
      payload: { to: "probe-bob", messages: [{ id: "probe-1", text: "Fuel stop" }] },
    });
  });
  await chatBob.channel.send({ type: "broadcast", event: "history_request", payload: { from: "probe-bob" } });
  await wait(2000);
  check("a late joiner is handed the history", chatBob.got("history")[0]?.messages?.[0]?.text, "Fuel stop");

  await alice.client.removeChannel(chatAlice.channel);
  await bob.client.removeChannel(chatBob.channel);

  // Leaving must remove the rider, which is what keeps a stale bike off the map.
  console.log("\n  Bob leaves…");
  await bob.channel.untrack();
  await bob.client.removeChannel(bob.channel);
  await wait(3000);

  check("Alice is alone again", alice.seen().length, 1);

  await alice.channel.untrack();
  await alice.client.removeChannel(alice.channel);

  console.log(
    failures === 0
      ? "\nGroup riding works end to end on this project.\n"
      : `\n${failures} check(s) failed.\n`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error("\nCheck could not run:", error.message ?? error);
  process.exitCode = 1;
});

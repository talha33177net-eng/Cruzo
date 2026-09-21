/**
 * Rides a simulated motorcycle through an Android emulator's GPS.
 *
 * Fetches a real motorcycle route from Valhalla and plays it into the
 * emulator one fix per second as NMEA sentences. NMEA rather than
 * `geo fix` because it carries ground speed and course, which is what the app
 * uses to point the marker, turn the driving view and spot a wrong turn.
 *
 *   node scripts/sim-ride.js --from 90.3954,23.7387 --to 90.4152,23.7806
 *   node scripts/sim-ride.js --from ... --to ... --via 90.40,23.75 --kmh 35
 *   node scripts/sim-ride.js --from ... --to ... --serial emulator-5556
 *   node scripts/sim-ride.js --park 90.4125,23.7806   # hold still, with GPS noise
 *
 * To test rerouting, start navigation in the app to one place and ride the
 * simulator somewhere else with --via: the rider leaves the planned route.
 *
 * Coordinates are longitude,latitude. Needs the emulator running and network
 * access to the public Valhalla instance.
 */

const { execFileSync } = require("child_process");
const path = require("path");

const VALHALLA = "https://valhalla1.openstreetmap.de/route";
const ADB = path.join(process.env.ANDROID_HOME || "", "platform-tools", "adb");
const M_PER_DEG = 111320;

const args = parseArgs(process.argv.slice(2));
const serial = args.serial || "emulator-5554";
const kmh = Number(args.kmh || 30);
const noiseM = Number(args.noise ?? 3);

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].startsWith("--")) {
      const key = list[i].slice(2);
      const next = list[i + 1];
      out[key] = next && !next.startsWith("--") ? (i++, next) : true;
    }
  }
  return out;
}

const point = (text) => text.split(",").map(Number);

function adbEmu(...command) {
  execFileSync(ADB, ["-s", serial, "emu", ...command], { stdio: "ignore" });
}

// --- NMEA ------------------------------------------------------------------

function checksum(body) {
  let sum = 0;
  for (const ch of body) sum ^= ch.charCodeAt(0);
  return sum.toString(16).toUpperCase().padStart(2, "0");
}

function nmeaCoord(value, isLat) {
  const hemi = isLat ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minutes = (abs - deg) * 60;
  const degText = String(deg).padStart(isLat ? 2 : 3, "0");
  return [`${degText}${minutes.toFixed(4).padStart(7, "0")}`, hemi];
}

function send([lng, lat], speedMs, course) {
  const now = new Date();
  const time =
    String(now.getUTCHours()).padStart(2, "0") +
    String(now.getUTCMinutes()).padStart(2, "0") +
    String(now.getUTCSeconds()).padStart(2, "0") +
    ".00";
  const date =
    String(now.getUTCDate()).padStart(2, "0") +
    String(now.getUTCMonth() + 1).padStart(2, "0") +
    String(now.getUTCFullYear() % 100).padStart(2, "0");
  const [latText, ns] = nmeaCoord(lat, true);
  const [lngText, ew] = nmeaCoord(lng, false);
  const knots = (speedMs * 1.943844).toFixed(1);
  const gga = `GPGGA,${time},${latText},${ns},${lngText},${ew},1,10,0.8,10.0,M,0.0,M,,`;
  const rmc = `GPRMC,${time},A,${latText},${ns},${lngText},${ew},${knots},${course.toFixed(1)},${date},,`;
  adbEmu("geo", "nmea", `$${gga}*${checksum(gga)}`);
  adbEmu("geo", "nmea", `$${rmc}*${checksum(rmc)}`);
}

// --- geometry --------------------------------------------------------------

function metres(a, b) {
  const kx = M_PER_DEG * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * M_PER_DEG);
}

function bearing(a, b) {
  const kx = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return ((Math.atan2((b[0] - a[0]) * kx, b[1] - a[1]) * 180) / Math.PI + 360) % 360;
}

function jitter([lng, lat], m) {
  if (m <= 0) return [lng, lat];
  const r = m * Math.sqrt(Math.random());
  const t = Math.random() * 2 * Math.PI;
  const kx = M_PER_DEG * Math.cos((lat * Math.PI) / 180);
  return [lng + (r * Math.sin(t)) / kx, lat + (r * Math.cos(t)) / M_PER_DEG];
}

function decode(encoded, precision = 6) {
  const factor = 10 ** precision;
  const coords = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const which of [0, 1]) {
      let shift = 0;
      let result = 0;
      let byte;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lng += delta;
    }
    coords.push([lng / factor, lat / factor]);
  }
  return coords;
}

async function route(stops) {
  const body = {
    locations: stops.map(([lon, lat]) => ({ lat, lon })),
    costing: "motorcycle",
  };
  const res = await fetch(`${VALHALLA}?json=${encodeURIComponent(JSON.stringify(body))}`);
  const data = await res.json();
  if (!data.trip) throw new Error(data.error || "No route");
  return data.trip.legs.flatMap((leg) => decode(leg.shape));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- main ------------------------------------------------------------------

async function park(at) {
  console.log(`Parked at ${at.join(",")} on ${serial}, ±${noiseM} m noise. Ctrl+C to stop.`);
  for (;;) {
    send(jitter(at, noiseM), 0, 0);
    await sleep(1000);
  }
}

async function ride() {
  const stops = [point(args.from)];
  if (args.via) for (const v of String(args.via).split(";")) stops.push(point(v));
  stops.push(point(args.to));

  const shape = await route(stops);
  const speed = kmh / 3.6;
  let total = 0;
  for (let i = 1; i < shape.length; i += 1) total += metres(shape[i - 1], shape[i]);
  console.log(
    `Riding ${(total / 1000).toFixed(1)} km at ${kmh} km/h on ${serial} (~${Math.round(total / speed / 60)} min).`,
  );

  let seg = 0;
  let along = 0; // metres into segment `seg`
  let last = Date.now();
  while (seg < shape.length - 1) {
    const a = shape[seg];
    const b = shape[seg + 1];
    const len = metres(a, b);
    if (along >= len) {
      along -= len;
      seg += 1;
      continue;
    }
    const t = len > 0 ? along / len : 0;
    const here = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    send(jitter(here, noiseM), speed, bearing(a, b));

    await sleep(1000);
    const now = Date.now();
    along += (speed * (now - last)) / 1000;
    last = now;
  }
  const end = shape[shape.length - 1];
  send(end, 0, 0);
  console.log("Arrived. Holding position; Ctrl+C to stop.");
  await park(end);
}

(args.park ? park(point(args.park)) : ride()).catch((e) => {
  console.error(e.message);
  process.exit(1);
});

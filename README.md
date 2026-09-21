# Cruzo

A group-riding app for motorcyclists. One rider hosts a party, the rest join by
scanning a QR or typing a six-character code, and everyone sees every bike in
the group moving live on a real road map — with turn-by-turn navigation that
reroutes the moment you miss a turn.

Built to run at **zero cost**: no Google Maps, no paid tiles, no paid backend,
no API keys for anything on the map.

---

## How it works

| Concern | Choice | Why it's free |
| --- | --- | --- |
| Map rendering | [MapLibre Native](https://maplibre.org) | Open source fork of Mapbox GL, no token |
| Map tiles | [OpenFreeMap](https://openfreemap.org) | Full-planet OpenStreetMap vector tiles, no API key, no quota |
| Routing | [Valhalla](https://valhalla.openstreetmap.de) (FOSSGIS) | Free public instance, no key, with a real `motorcycle` profile |
| Place search | [Photon](https://photon.komoot.io) | Free OpenStreetMap geocoder, no key |
| Voice guidance | `expo-speech` | On-device text to speech, nothing sent anywhere |
| Live positions | Supabase Realtime **Presence** | Free tier; positions are ephemeral, never stored |
| Party lobby | Supabase Postgres (one table) | Free tier; a few rows per ride |

Rider positions never touch the database. They travel over a presence channel
and disappear the moment a rider disconnects, so a ride leaves no location
history behind and storage stays at essentially zero.

---

## Navigation

Tap **Where to?**, or press and hold anywhere on the map to drop a pin. You can
also navigate straight to another rider in your party — which is the thing a
general mapping app cannot do for you.

While navigating you get:

- a **turn card** at the top with the distance, the instruction, and what comes
  after it
- **voice guidance**, announced twice per turn — once at 400 m, once at 80 m
- **arrival time, time left and distance left**
- a **speed readout**
- the route drawn ahead in orange, with the part already ridden dimmed behind
  you
- a **course-up, tilted camera** that follows you, and hands itself back
  automatically ten seconds after you stop panning

### Rerouting

If you leave the route, Cruzo builds a new one from wherever you actually are.

Getting this to feel instant without being twitchy is the whole trick, so three
guards sit in front of it:

- the off-route threshold **widens with your GPS accuracy radius**, so a poor
  fix in an urban canyon does not look like a wrong turn
- the deviation must **persist across consecutive fixes**, not appear once
- reroutes are **rate limited**, so a genuinely lost rider cannot hammer a free
  community service

In practice a whole ride makes a handful of routing requests, not hundreds.
`npm run check:routing` exercises this end to end against the live service.

### Map accuracy

Several things work together here, because "the map is accurate" is mostly
about not showing lies:

- fixes are requested at `BestForNavigation`, and **1 Hz while navigating**
- fixes with an **accuracy radius worse than 50 m are dropped** — Android
  interleaves coarse network positions with real satellite ones, and drawing
  those makes a parked bike teleport
- **physically impossible jumps are rejected** (nothing moves at 90 m/s)
- your position is **snapped to the road** you are riding while on route, so
  the marker stops drifting into the pavement
- **heading is held below walking pace**, because the GPS course reading spins
  randomly when you are stopped

---

## Setup

### 1. Create a Supabase project

Sign up at [supabase.com](https://supabase.com) and create a project. The free
tier needs no card.

### 2. Create the table

Open **SQL Editor** in your project, paste the whole of
[`supabase/schema.sql`](supabase/schema.sql), and press Run. That creates the
`parties` table, locks it down with row level security and column grants, and
installs the `end_party` function.

Group riding does not work until this is done, and it cannot be automated: a
publishable key is not allowed to create tables, by design.

### 3. Add your credentials

Copy `.env.example` to `.env` and fill in the two values from
**Project Settings → API**:

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Both are safe to ship inside the app. The anon key is a public client key —
`supabase/schema.sql` is what actually constrains access.

The map, routing and search services take no keys at all.

### 4. Voice calls (optional, free)

Voice audio goes directly between phones. When a mobile carrier blocks that
direct path, which is common on mobile data, a relay (TURN) server has to
carry it. The relay address and password never ship inside the app: a small
Supabase function hands them only to riders in a live party.

The default is [ExpressTURN](https://www.expressturn.com)'s free plan (1,000 GB a
month, no payment method). A three-hour call between two relayed riders is
roughly 80 MB.

1. Sign up at expressturn.com. The dashboard shows a server address, a
   username and a password.
2. Store them as Supabase secrets and deploy the function:

   ```bash
   npx supabase login
   npx supabase link --project-ref your-project-ref
   npx supabase secrets set TURN_URLS=turn:<server>:3478 TURN_USERNAME=<username> TURN_PASSWORD=<password>
   npx supabase functions deploy turn-credentials --no-verify-jwt
   ```

   `--no-verify-jwt` is required: Cruzo has no sign-in, and the function
   checks the caller is in a live party instead.

Cloudflare TURN also works (`CLOUDFLARE_TURN_KEY_ID` and
`CLOUDFLARE_TURN_API_TOKEN`), but it asks for a payment method. Set both
providers and phones try every server offered.

Without a relay, calls still work, but only between riders whose networks
allow a direct connection. The call bar says so when the relay is missing.

### 5. Build and run

MapLibre is a native module, so Cruzo cannot run in Expo Go. Build it once and
the dev server attaches to that build from then on.

```bash
npm install
npm run android        # builds, installs and launches on a connected device
```

You need Android Studio's SDK and a device with USB debugging on, or an
emulator. After the first build, `npm start` is enough.

---

## Releasing

The release build is signed with Cruzo's own key, not the Android debug key.

```bash
cd android && ./gradlew assembleRelease
# android/app/build/outputs/apk/release/app-release.apk
```

The resulting APK is self-contained: it bundles its own JavaScript and needs no
dev server, so it can be copied to any Android phone and installed directly.

### Signing key — back this up

`credentials/` holds the release keystore and its password. Both are
gitignored.

**Back up that folder somewhere safe.** Android identifies an app by its
signing key: lose it and you can never publish an update to the same listing,
and anyone who installed the old build has to uninstall before they can install
a new one. There is no recovery process.

The keystore deliberately lives outside `android/`, because that directory is
generated and `expo prebuild --clean` deletes everything in it. Signing is
wired up by [`plugins/withReleaseSigning.js`](plugins/withReleaseSigning.js)
for the same reason — a hand edit to `android/app/build.gradle` would be lost
on the next prebuild, and the build would quietly fall back to the debug key.

If `credentials/keystore.properties` is missing (a fresh clone, or CI without
secrets) the build still works, falling back to the debug key.

### Icons

Launcher icons are generated, not hand-drawn:

```bash
npm run icons          # writes assets/*.png
npx expo prebuild --platform android --clean
```

[`scripts/make-icons.js`](scripts/make-icons.js) rasterises the Cruzo mark at
4x and box-filters it down, so there is no image-library dependency. Change the
colours or geometry there and re-run.

Note that icons are baked into `android/` at prebuild time, so regenerating the
PNGs alone is not enough — you have to prebuild afterwards.

---

## Using it

**Hosting.** Enter your name, tap *Host a ride*, give it a name. You get a code
and a QR. Share either, then tap *Open the map*.

**Joining.** Tap *Join a ride*, then scan the host's QR or type the code.

**On the map.** Every rider is a coloured disc with their initials; a cone shows
which way they are pointing when moving. Your own marker is filled in. Tap the
bottom strip to expand the rider list, which shows each rider's distance,
compass bearing and speed relative to you. Tapping a rider centres the map on
them.

The three buttons on the right:

- **◎** — follow your own position
- **⤢** — zoom out to fit every rider, and the destination, on screen
- **Day/Night/Vivid/Minimal** — cycle the basemap

The map stays awake while the ride screen is open, so mount the phone and go.

- **Chat** — group chat with one-tap quick replies. Messages are never stored:
  they live on the riders' phones and disappear when the ride ends.
- **SOS** — one tap alerts the whole party; tap again to cancel.

When a rider starts navigating, everyone else is offered the same destination
and gets their own route to it from wherever they are.

A party closes itself about 10 minutes after the last rider leaves. The host can
end it straight away with the *End* button, which also sends everyone home.
Closed parties are deleted, not archived.

---

## Project layout

```
app/                     screens (expo-router, file-based)
  index.tsx              name entry, host or join
  host.tsx               create a party, show code + QR
  join.tsx               type a code, or accept one from a scan/deep link
  scan.tsx               QR scanner
  ride/[code].tsx        the live map and navigation screen
src/
  components/            UI kit, rider marker, rider list, turn card,
                         trip panel, destination search
  hooks/
    useLiveLocation.ts   GPS watcher with noise rejection
    useNavigation.ts     routing, progress, rerouting, voice
    useRideChannel.ts    Supabase presence — publishes and receives positions
  lib/
    config.ts            env, tile and routing URLs, timing constants
    geo.ts               distance, bearing, bounds, formatting
    geocode.ts           place search and reverse geocoding
    navigation.ts        snapping, progress, off-route detection
    party.ts             party lookup, creation, ending
    polyline.ts          encoded polyline decoding
    rideCode.ts          code alphabet, validation, QR payload parsing
    routing.ts           Valhalla client and maneuver mapping
  theme.ts               design tokens
supabase/schema.sql      run this once in the SQL editor
scripts/                 test suites and fixtures
```

## Checks

```bash
npm test               # 78 offline assertions: geo maths, code parsing,
                       # route snapping, progress, off-route rules
npm run check:routing  # end-to-end reroute check against the live service
npm run check:realtime # two simulated riders join a party and see each other
npm run typecheck
```

`npm run check:realtime` is the one that proves the app's whole reason for
existing. It opens two Supabase clients against the project in `.env`, has them
join the same party channel, and asserts that each sees the other's position,
that movement propagates, and that leaving removes a rider from the roster.
Worth running after any change to `useRideChannel.ts`, because presence
failures are invisible until you have two phones in your hands.

`npm test` runs the navigation maths against a **real captured Valhalla
response** (`scripts/fixtures/route-dhaka.json`) rather than a synthetic
straight line, so the snapping and progress logic is exercised on genuine road
geometry.

---

## Known limits

These are deliberate boundaries, not oversights.

- **Foreground only.** Positions are shared and navigation runs while the ride
  screen is open. Background location on Android needs a persistent foreground
  service and a Play Store justification; the app keeps the screen awake
  instead.
- **Anyone with the code can join.** There is no approval step. A six-character
  code from a 30-character alphabet is ~729 million combinations, so guessing
  one is impractical, but treat the code as the only gate.
- **Routing depends on a free community service.** FOSSGIS's Valhalla instance
  has no quota but does have a fair-use policy. Cruzo is deliberately frugal
  with it. If you ever ship this at scale, self-host Valhalla or move to a
  keyed free tier such as [OpenRouteService](https://openrouteservice.org) or
  [GraphHopper](https://www.graphhopper.com) — `src/lib/routing.ts` is the only
  file that would change.
- **No live traffic.** Arrival times come from road speeds, not conditions.
  No free provider offers traffic data.
- **Each rider navigates independently.** There is no shared party destination
  yet; every rider picks their own, and can pick another rider.
- **iOS is not built.** The code is cross-platform React Native, but shipping
  to a real iPhone needs a Mac and a paid Apple Developer account.
- **Free-tier pause.** A Supabase free project pauses after a week with no
  traffic. Opening the dashboard resumes it.

## Attribution

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright)
contributors. Tiles by [OpenFreeMap](https://openfreemap.org), rendering by
[MapLibre](https://maplibre.org), routing by
[Valhalla](https://valhalla.openstreetmap.de) hosted by FOSSGIS, place search by
[Photon](https://photon.komoot.io).

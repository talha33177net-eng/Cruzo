# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Cruzo

Group-riding app for motorcyclists: one rider hosts a party, others join by QR
or a six-character code, everyone sees each other live on a map, and each rider
gets turn-by-turn navigation that reroutes when they leave the road.

## Hard constraint: zero running cost

Every dependency must be free at the scale this app runs at. Do not introduce
Google Maps, Mapbox, a paid tile host, a paid routing API, or a metered
backend. Nothing on the map requires an API key today — keep it that way.

Current free services, all keyless:

- **Tiles** — OpenFreeMap (`src/lib/config.ts`)
- **Routing** — FOSSGIS Valhalla, `motorcycle` costing (`src/lib/routing.ts`)
- **Geocoding** — Photon (`src/lib/geocode.ts`)
- **Voice** — `expo-speech`, on-device

One exception, chosen deliberately: **voice-call relay (TURN)** is a free-tier
service, ExpressTURN by default (1,000 GB/month, no payment method), with
Cloudflare as an alternative. Its credentials live only in the
`turn-credentials` Supabase function, never in the app. Calls fall back to
direct-only if it is missing.

Valhalla and Photon are community services under fair-use policies. The
reroute guards in `src/lib/config.ts` (`OFF_ROUTE_FIXES`, `REROUTE_COOLDOWN_MS`)
and the search debounce exist to keep request volume low. Do not loosen them
without a reason.

## Stack notes that are easy to get wrong

- **MapLibre React Native v11 renamed things.** It is `Map` (not `MapView`),
  `GeoJSONSource` (not `ShapeSource`), and a single `Layer` component taking
  style-spec `type`/`paint`/`layout` props rather than `CircleLayer` /
  `SymbolLayer`. Older tutorials target v10 and will not compile. Check
  `node_modules/@maplibre/maplibre-react-native/src/index.ts` for the real
  export list.
- **Valhalla maneuver type codes are positional and easy to misread.** 9 is
  "bear right", 10 "turn right", 15 "turn left", 24 "keep left", 26/27
  roundabout, 4–6 destination. The table in `routing.ts` was verified against a
  live response; do not rewrite it from memory.
- **Valhalla encodes shapes at precision 6**, not the usual 5. Decoding at the
  wrong precision shifts the whole route by a factor of ten.
- **Positions are never stored.** They ride on Supabase Realtime Presence and
  vanish on disconnect. Do not "improve" this by writing positions to a table —
  it would add storage cost, create a location history, and lose the automatic
  drop-on-disconnect behaviour.
- **Chat is never stored either.** It is Realtime broadcast on `chat:<code>`,
  held in memory on each phone; a late joiner is handed history by the
  lowest-id rider (`isCoordinator`). Do not add a messages table.
- **Parties close themselves.** One rider calls `touch_party` every
  `PARTY_HEARTBEAT_MS`; the server deletes parties idle for 10 minutes. Ended
  parties are deleted, not flagged.
- **Voice is a WebRTC mesh; Supabase only introduces the phones.** Audio never
  touches Supabase. Offers carry all ICE candidates (no trickle) because
  Realtime rate-limits broadcasts. The lower rider id always offers
  (`shouldOffer`). Relay credentials come from the `turn-credentials` Edge
  Function; they must never ship in the app. `InCallManager` runs in `video` mode on purpose: `audio` mode routes
  to the earpiece and enables the proximity sensor, which blanks a
  handlebar-mounted screen.
- **Presence needs `enabled: true`** in the channel config for a client to
  *receive* the roster. Without it you only ever see yourself.
- **Cannot run in Expo Go** — MapLibre is native. Use `npm run android`.
- **React is pinned to 19.2.3** by SDK 57; `react-dom` is pinned to match via
  an `overrides` entry. Removing that override breaks `npm install`.
- **Installing a native module invalidates the APK.** Expo autolinking runs at
  Gradle configure time, so a module added after a build started will silently
  be missing from it. After `npx expo install <native-module>`, rebuild — and
  verify with:
  `unzip -p app-debug.apk 'classes*.dex' > /tmp/d && grep -a expo.modules.<name> /tmp/d`
  (listing APK entries does **not** work: Kotlin-only modules live inside the
  dex, not as separate files.)

## Before finishing any change

```bash
npm run typecheck
npm test                 # offline; must stay green
npm run check:routing    # needs network; exercises rerouting for real
```

Rules the tests encode that are worth keeping in mind:

- `normalizeRideCode` **drops** confusable characters rather than remapping
  them. Remapping would silently resolve a typo to a different real party.
- `parseScannedPayload` validates a candidate whole. It must never filter
  arbitrary text down to six characters, or every QR code in the world becomes
  a plausible ride code.
- `locateOnRoute` searches a window around the previous segment for speed, but
  **must** agree with a full scan, and **must** fall back to one after a jump.
  There is a test for exactly this.
- `isOffRoute` widens its threshold with the GPS accuracy radius. Rerouting on
  a single noisy fix is the failure mode to avoid.

/**
 * Runtime configuration.
 *
 * Supabase credentials come from `EXPO_PUBLIC_*` env vars, which Metro inlines
 * at build time. The anon key is designed to ship inside clients — row level
 * security in `supabase/schema.sql` is what actually protects the data.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabaseUrl = url;
export const supabaseAnonKey = anonKey;

/** False when `.env` has not been filled in yet, so the UI can explain why. */
export const isBackendConfigured = url.length > 0 && anonKey.length > 0;

/**
 * Basemap tiles come from OpenFreeMap — an OpenStreetMap-derived vector tile
 * host that is free, needs no API key and sets no request quota. How they are
 * painted is Cruzo's own style (see `mapTheme.ts`).
 *
 * @see https://openfreemap.org
 */

/** How often each rider publishes a position to the party. */
export const LOCATION_INTERVAL_MS = 3000;

/** Minimum metres travelled before a new position is published. */
export const LOCATION_DISTANCE_M = 5;

/**
 * While navigating, positions are sampled far more aggressively: a turn
 * announcement that arrives three seconds late has already been missed.
 */
export const NAV_LOCATION_INTERVAL_MS = 1000;
export const NAV_LOCATION_DISTANCE_M = 2;

/**
 * How often a live position is broadcast to the party, riding and parked.
 *
 * Positions go over Realtime broadcast, not presence (see `useRideChannel`).
 * Every message is delivered to every other rider, and the free tier allows
 * 100 a second across the project, so a party of ten riding at one message
 * every two seconds uses under half of it. Markers glide between updates, so
 * this reads as smooth movement rather than jumps.
 */
export const NAV_POSITION_SEND_MS = 2000;
export const POSITION_SEND_MS = 4000;

/**
 * A parked bike produces no GPS fixes at all, so the last one is re-sent this
 * often — otherwise a rider waiting at the meeting point looks disconnected.
 */
export const POSITION_KEEPALIVE_MS = 10000;

/**
 * Closest together two presence updates may be.
 *
 * The free tier allows each client 5 presence calls per 30 seconds and
 * throttles anyone over it; 8 seconds keeps a phone at 4 at most.
 */
export const PRESENCE_MIN_GAP_MS = 8000;

/** Presence is refreshed this often anyway, so late joiners see a recent spot. */
export const PRESENCE_REFRESH_MS = 30000;

/**
 * How often one rider tells the server the party is still occupied.
 *
 * The server deletes a party after 10 minutes without one (see
 * `touch_party` in `supabase/schema.sql`), so this leaves room for two missed
 * beats — a stretch of highway with no signal — before a live ride is closed.
 * It is a single tiny write per party, not per rider.
 */
export const PARTY_HEARTBEAT_MS = 3 * 60 * 1000;

/** A rider with no update for this long is shown as stale. */
export const STALE_AFTER_MS = 20000;

/**
 * Fixes worse than this accuracy radius are dropped rather than drawn.
 *
 * Android occasionally emits a coarse network-derived fix between satellite
 * fixes; plotting those makes a stationary bike appear to jump across town.
 */
export const MAX_ACCURACY_M = 50;

/** Below this speed the GPS course reading is noise, so heading is held. */
export const MIN_SPEED_FOR_HEADING = 1.5;

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/**
 * FOSSGIS's public Valhalla instance: free, no API key, and it supports the
 * `motorcycle` costing profile.
 *
 * It is a community service under a fair-use policy, so Cruzo reroutes only on
 * a sustained deviation and never more often than `REROUTE_COOLDOWN_MS`. A
 * typical ride makes a handful of requests, not hundreds.
 *
 * @see https://valhalla.openstreetmap.de
 */
export const valhallaUrl = "https://valhalla1.openstreetmap.de/route";

/** Photon: free OpenStreetMap geocoding, also no API key. */
export const photonUrl = "https://photon.komoot.io/api";

/**
 * Bounding box for Bangladesh, as `[west, south, east, north]`.
 *
 * Cruzo is built for riding here, so place search is restricted to this box
 * first. Without it a search for a common road name returns results from
 * across the world ranked above the one down the street, which is useless on a
 * bike. A second, unrestricted pass runs only if this one finds nothing, so
 * searching abroad still works.
 */
export const BANGLADESH_BBOX = [88.0, 20.55, 92.68, 26.64] as const;

export const ROUTE_TIMEOUT_MS = 12000;

/** Base distance from the route line that counts as having left it. */
export const OFF_ROUTE_M = 40;

/** Consecutive off-route fixes required before a reroute is triggered. */
export const OFF_ROUTE_FIXES = 3;

/** Never reroute more often than this, however lost the rider gets. */
export const REROUTE_COOLDOWN_MS = 8000;

/** Distance at which the upcoming turn is announced early. */
export const ANNOUNCE_FAR_M = 400;

/** Distance at which the turn is announced again, immediately before it. */
export const ANNOUNCE_NEAR_M = 80;

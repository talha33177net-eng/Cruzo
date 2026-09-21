import type { LngLat, LngLatBounds } from "@maplibre/maplibre-react-native";

/** A single GPS fix from this device. */
export type Fix = {
  lngLat: LngLat;
  /** Direction of travel in degrees from north, or `null` when stationary. */
  heading: number | null;
  /** Ground speed in metres per second. */
  speed: number | null;
  /** Horizontal accuracy radius in metres. */
  accuracy: number | null;
  timestamp: number;
};

/** What every rider publishes into the party channel. */
export type RiderState = {
  id: string;
  name: string;
  bike: string;
  isHost: boolean;
  lng: number;
  lat: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  /**
   * True while this rider has an SOS raised.
   *
   * Carried on presence rather than sent as a one-off event so that it is
   * self-healing: a rider who joins mid-emergency sees it immediately, and it
   * clears automatically if the rider in trouble drops off the network.
   */
  sos: boolean;
  /** True while this rider has a journey under way. */
  navigating: boolean;
  /**
   * Where this rider's journey goes, while `navigating`.
   *
   * Shared so everyone else can ride to the same place along their own route
   * (see `groupTrip.ts`). Carried on presence for the same reason as `sos`: a
   * rider who joins after the group set off still gets it. Optional because
   * older builds never send it, and untrusted because any peer can.
   */
  trip?: Destination[] | null;
  /** Sender clock, used only to show relative freshness. */
  updatedAt: number;
};

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

// ---------------------------------------------------------------------------
// Routing
//
// These live here rather than in `routing.ts` so that the navigation maths can
// depend on the shape of a route without pulling in the network client (and,
// through it, runtime configuration).
// ---------------------------------------------------------------------------

/**
 * One instruction along a route.
 *
 * Valhalla hands back three phrasings of every turn. We keep them apart
 * because they are spoken at different moments: the alert goes out while the
 * turn is still ahead, the primary text lands as it arrives.
 */
export type Maneuver = {
  /** Valhalla maneuver type, mapped to an arrow by `maneuverGlyph`. */
  type: number;
  /** Text shown on screen, e.g. "Turn left onto Airport Road". */
  instruction: string;
  /** Spoken early, while the turn is still some distance away. */
  verbalAlert: string | null;
  /** Spoken as the turn arrives. */
  verbalPre: string | null;
  streetNames: string[];
  /** Index into `Route.shape` where this maneuver begins. */
  beginIndex: number;
  endIndex: number;
  distanceM: number;
  durationS: number;
};

export type Route = {
  shape: LngLat[];
  maneuvers: Maneuver[];
  /**
   * Shape indices where each intermediate stop sits.
   *
   * Empty for a straight A-to-B trip; one entry per stop between the start
   * and the final destination.
   */
  stopIndices: number[];
  distanceM: number;
  durationS: number;
  bounds: LngLatBounds;
};

/** A place the party is riding to. */
export type Destination = {
  lngLat: LngLat;
  label: string;
};

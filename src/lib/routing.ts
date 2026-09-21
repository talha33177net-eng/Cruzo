import type { LngLat } from "@maplibre/maplibre-react-native";

import { ROUTE_TIMEOUT_MS, valhallaUrl } from "./config";
import { decodePolyline } from "./polyline";
import type { Maneuver, Route } from "./types";

export type { Maneuver, Route } from "./types";

export type RouteResult =
  | { status: "ok"; routes: Route[] }
  | { status: "no_route" }
  | { status: "error"; message: string };

type ValhallaManeuver = {
  type: number;
  instruction?: string;
  verbal_transition_alert_instruction?: string;
  verbal_pre_transition_instruction?: string;
  street_names?: string[];
  begin_shape_index: number;
  end_shape_index: number;
  length: number;
  time: number;
};

type ValhallaTrip = {
  legs: { shape: string; maneuvers: ValhallaManeuver[] }[];
  summary: {
    length: number;
    time: number;
    min_lat: number;
    min_lon: number;
    max_lat: number;
    max_lon: number;
  };
};

type ValhallaResponse = {
  trip?: ValhallaTrip;
  alternates?: { trip: ValhallaTrip }[];
  error?: string;
  error_code?: number;
};

/**
 * Asks Valhalla for motorcycle routes through a list of stops.
 *
 * `motorcycle` costing is not the same as `auto`: it prefers roads a bike can
 * actually use and is willing to take narrower ways, which matters a lot on
 * the kind of back roads a group ride goes looking for.
 *
 * Alternates are only requested for a simple start-to-finish trip. Valhalla
 * does not offer them once there are intermediate stops, so asking anyway
 * would spend a request against a free community service for nothing.
 *
 * Pass a signal to cancel an in-flight request — during a reroute the previous
 * one is always abandoned rather than raced.
 */
export async function fetchRoutes(
  stops: LngLat[],
  signal?: AbortSignal,
): Promise<RouteResult> {
  if (stops.length < 2) {
    return { status: "error", message: "A route needs a start and a destination." };
  }

  const body: Record<string, unknown> = {
    locations: stops.map(([lon, lat]) => ({ lat, lon })),
    costing: "motorcycle",
    directions_options: { units: "kilometers", language: "en-US" },
  };
  if (stops.length === 2) body.alternates = 2;

  // The public instance is a shared community service; give it a hard ceiling
  // so a slow reply cannot wedge the navigation loop.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), ROUTE_TIMEOUT_MS);
  const onOuterAbort = () => timeout.abort();
  signal?.addEventListener("abort", onOuterAbort);

  try {
    const url = `${valhallaUrl}?json=${encodeURIComponent(JSON.stringify(body))}`;
    const response = await fetch(url, { signal: timeout.signal });

    if (!response.ok) {
      return {
        status: "error",
        message: `Routing service returned ${response.status}.`,
      };
    }

    const data = (await response.json()) as ValhallaResponse;

    if (data.error || !data.trip) {
      // 442 is Valhalla's "no path between these points".
      if (data.error_code === 442) return { status: "no_route" };
      return { status: "error", message: data.error ?? "Could not build a route." };
    }

    const trips = [data.trip, ...(data.alternates ?? []).map((a) => a.trip)];
    return { status: "ok", routes: trips.map(toRoute) };
  } catch (caught) {
    if (caught instanceof Error && caught.name === "AbortError") {
      return { status: "error", message: "Routing timed out." };
    }
    return {
      status: "error",
      message: caught instanceof Error ? caught.message : "Routing failed.",
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

/**
 * Flattens a Valhalla trip into one shape and one maneuver list.
 *
 * A multi-stop trip arrives as one leg per stop, each with its own shape and
 * shape-relative maneuver indices. Concatenating them means offsetting those
 * indices, or every turn after the first stop would point at the wrong place
 * on the line.
 */
function toRoute(trip: ValhallaTrip): Route {
  const shape: LngLat[] = [];
  const maneuvers: Maneuver[] = [];
  const stopIndices: number[] = [];

  for (const leg of trip.legs) {
    const offset = shape.length;
    shape.push(...decodePolyline(leg.shape, 6));
    // Where one leg ends the next begins, which is exactly where a stop is.
    if (offset > 0) stopIndices.push(offset);

    for (const m of leg.maneuvers) {
      maneuvers.push({
        type: m.type,
        instruction: m.instruction ?? "Continue",
        verbalAlert: m.verbal_transition_alert_instruction ?? null,
        verbalPre: m.verbal_pre_transition_instruction ?? m.instruction ?? null,
        streetNames: m.street_names ?? [],
        beginIndex: m.begin_shape_index + offset,
        endIndex: m.end_shape_index + offset,
        distanceM: m.length * 1000,
        durationS: m.time,
      });
    }
  }

  return {
    shape,
    maneuvers,
    stopIndices,
    distanceM: trip.summary.length * 1000,
    durationS: trip.summary.time,
    bounds: [
      trip.summary.min_lon,
      trip.summary.min_lat,
      trip.summary.max_lon,
      trip.summary.max_lat,
    ],
  };
}

/**
 * Valhalla maneuver type to an arrow glyph.
 *
 * The numbering is positional and easy to get wrong by a few places, so it is
 * written out here rather than grouped into ranges. Verified against live
 * responses: 9 is "bear right", 10 "turn right", 15 "turn left", 24 "keep
 * left", 26/27 roundabout, 4-6 destination.
 *
 * @see https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/#maneuver-types
 */
const GLYPHS: Record<number, string> = {
  0: "↑", // none
  1: "↑", // start
  2: "↑", // start right
  3: "↑", // start left
  4: "◉", // destination
  5: "◉", // destination right
  6: "◉", // destination left
  7: "↑", // becomes
  8: "↑", // continue
  9: "↗", // slight right
  10: "↱", // right
  11: "↳", // sharp right
  12: "↷", // u-turn right
  13: "↶", // u-turn left
  14: "↲", // sharp left
  15: "↰", // left
  16: "↖", // slight left
  17: "↑", // ramp straight
  18: "↗", // ramp right
  19: "↖", // ramp left
  20: "↗", // exit right
  21: "↖", // exit left
  22: "↑", // stay straight
  23: "↗", // stay right
  24: "↖", // stay left
  25: "↗", // merge
  26: "↻", // roundabout enter
  27: "↻", // roundabout exit
  28: "↑", // ferry enter
  29: "↑", // ferry exit
};

export function maneuverGlyph(type: number): string {
  return GLYPHS[type] ?? "↑";
}

/** True when this maneuver ends the route, so the UI can say "arrive". */
export function isArrival(type: number): boolean {
  return type >= 4 && type <= 6;
}

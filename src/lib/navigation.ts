import type { LngLat } from "@maplibre/maplibre-react-native";

import type { Route } from "./types";

const M_PER_DEG = 111320;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Cumulative distances along a route's shape, computed once when the route
 * arrives so that every later position fix is cheap to place.
 */
export type RouteIndex = {
  /** `cumulative[i]` is the distance in metres from the start to `shape[i]`. */
  cumulative: number[];
  totalM: number;
  /** Distance from the start to each maneuver's first shape point. */
  maneuverAtM: number[];
};

export function buildRouteIndex(route: Route): RouteIndex {
  const { shape } = route;
  const cumulative = new Array<number>(shape.length).fill(0);

  for (let i = 1; i < shape.length; i += 1) {
    cumulative[i] = cumulative[i - 1] + metresBetween(shape[i - 1], shape[i]);
  }

  const total = cumulative[cumulative.length - 1] ?? 0;
  const maneuverAtM = route.maneuvers.map((m) => cumulative[clamp(m.beginIndex, 0, cumulative.length - 1)] ?? 0);

  return { cumulative, totalM: total, maneuverAtM };
}

export type RouteProgress = {
  /** Shape segment the rider is on: the segment from `shape[i]` to `shape[i+1]`. */
  segmentIndex: number;
  /** The rider's position projected onto the route line. */
  snapped: LngLat;
  /** Perpendicular distance from the route, in metres. */
  deviationM: number;
  distanceAlongM: number;
  remainingM: number;
  remainingS: number;
  /** Index of the maneuver the rider is approaching. */
  upcomingIndex: number;
  /** Distance to that maneuver, in metres. */
  distanceToManeuverM: number;
  /** True once the rider is within arrival range of the destination. */
  arrived: boolean;
};

/** Arrival is declared inside this radius of the final shape point. */
export const ARRIVAL_RADIUS_M = 35;

/**
 * Places a position on the route.
 *
 * Searching a window around the previous segment keeps this O(1) per fix and,
 * more importantly, stops a route that doubles back on itself from snapping
 * the rider onto the wrong pass. When nothing in the window fits — the first
 * fix, or after a reroute — it falls back to scanning the whole shape.
 */
export function locateOnRoute(
  route: Route,
  index: RouteIndex,
  position: LngLat,
  previousSegment: number | null,
): RouteProgress {
  const { shape } = route;

  if (shape.length < 2) {
    return {
      segmentIndex: 0,
      snapped: shape[0] ?? position,
      deviationM: 0,
      distanceAlongM: 0,
      remainingM: 0,
      remainingS: 0,
      upcomingIndex: 0,
      distanceToManeuverM: 0,
      arrived: true,
    };
  }

  const WINDOW_BACK = 10;
  const WINDOW_FORWARD = 120;
  /** Beyond this, the windowed guess is not trustworthy and we rescan. */
  const WINDOW_TRUST_M = 120;

  let best = previousSegment == null
    ? scan(shape, position, 0, shape.length - 2)
    : scan(
        shape,
        position,
        clamp(previousSegment - WINDOW_BACK, 0, shape.length - 2),
        clamp(previousSegment + WINDOW_FORWARD, 0, shape.length - 2),
      );

  if (previousSegment != null && best.distanceM > WINDOW_TRUST_M) {
    const full = scan(shape, position, 0, shape.length - 2);
    if (full.distanceM < best.distanceM) best = full;
  }

  const segmentLength =
    index.cumulative[best.segment + 1] - index.cumulative[best.segment];
  const distanceAlongM = index.cumulative[best.segment] + best.t * segmentLength;
  const remainingM = Math.max(0, index.totalM - distanceAlongM);

  const upcomingIndex = nextManeuverIndex(index.maneuverAtM, distanceAlongM);
  const distanceToManeuverM = Math.max(
    0,
    (index.maneuverAtM[upcomingIndex] ?? index.totalM) - distanceAlongM,
  );

  return {
    segmentIndex: best.segment,
    snapped: best.point,
    deviationM: best.distanceM,
    distanceAlongM,
    remainingM,
    remainingS: remainingSeconds(route, index, distanceAlongM),
    upcomingIndex,
    distanceToManeuverM,
    arrived:
      metresBetween(position, shape[shape.length - 1]) <= ARRIVAL_RADIUS_M,
  };
}

/**
 * The maneuver the rider is heading towards: the first one still ahead.
 *
 * A small tolerance stops the banner flickering back to a turn the rider is
 * sitting exactly on top of.
 */
function nextManeuverIndex(maneuverAtM: number[], distanceAlongM: number): number {
  const TOLERANCE_M = 2;
  for (let i = 0; i < maneuverAtM.length; i += 1) {
    if (maneuverAtM[i] > distanceAlongM + TOLERANCE_M) return i;
  }
  return Math.max(0, maneuverAtM.length - 1);
}

/**
 * Time left, accumulated per maneuver rather than scaled from total distance.
 *
 * Distance-proportional estimates go badly wrong on a route that mixes a
 * motorway with town streets, because the remaining kilometres are not all
 * ridden at the same speed.
 */
function remainingSeconds(
  route: Route,
  index: RouteIndex,
  distanceAlongM: number,
): number {
  let seconds = 0;

  for (let i = 0; i < route.maneuvers.length; i += 1) {
    const startM = index.maneuverAtM[i];
    const endM = index.maneuverAtM[i + 1] ?? index.totalM;
    const spanM = endM - startM;

    if (endM <= distanceAlongM) continue;

    if (startM >= distanceAlongM || spanM <= 0) {
      seconds += route.maneuvers[i].durationS;
    } else {
      // Part-way through this maneuver: keep the share still ahead.
      const fractionLeft = (endM - distanceAlongM) / spanM;
      seconds += route.maneuvers[i].durationS * fractionLeft;
    }
  }

  return seconds;
}

type ScanHit = { segment: number; t: number; point: LngLat; distanceM: number };

function scan(
  shape: LngLat[],
  position: LngLat,
  from: number,
  to: number,
): ScanHit {
  let best: ScanHit = { segment: from, t: 0, point: shape[from], distanceM: Infinity };

  for (let i = from; i <= to; i += 1) {
    const hit = projectOnSegment(position, shape[i], shape[i + 1], i);
    if (hit.distanceM < best.distanceM) best = hit;
  }

  return best;
}

/**
 * Projects a point onto a segment using a local equirectangular frame.
 *
 * Over the tens of metres a route segment spans, treating latitude and
 * longitude as a flat grid scaled by `cos(latitude)` is accurate to well under
 * a metre, and avoids trigonometry on every fix.
 */
function projectOnSegment(
  point: LngLat,
  a: LngLat,
  b: LngLat,
  segment: number,
): ScanHit {
  const lat0 = toRad(a[1]);
  const kx = M_PER_DEG * Math.cos(lat0);
  const ky = M_PER_DEG;

  const ax = a[0] * kx;
  const ay = a[1] * ky;
  const bx = b[0] * kx;
  const by = b[1] * ky;
  const px = point[0] * kx;
  const py = point[1] * ky;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;

  // A zero-length segment (duplicate shape points) projects to its own start.
  const t = lengthSq === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1);

  const snapped: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const ex = px - (ax + dx * t);
  const ey = py - (ay + dy * t);

  return {
    segment,
    t,
    point: snapped,
    distanceM: Math.sqrt(ex * ex + ey * ey),
  };
}

/** Straight-line distance in metres, good to ~0.2% at riding scales. */
function metresBetween(a: LngLat, b: LngLat): number {
  const kx = M_PER_DEG * Math.cos(toRad((a[1] + b[1]) / 2));
  const dx = (a[0] - b[0]) * kx;
  const dy = (a[1] - b[1]) * M_PER_DEG;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Decides whether the rider has actually left the route.
 *
 * Two guards keep this from firing on noise, which is what makes the
 * difference between a reroute that feels instant and one that feels twitchy:
 * the threshold grows with the GPS accuracy radius, and the deviation has to
 * persist across consecutive fixes before it counts.
 */
export function isOffRoute(
  deviationM: number,
  accuracyM: number | null,
  baseThresholdM: number,
  headingErrorDeg: number | null = null,
): boolean {
  const slack = accuracyM != null && accuracyM > 0 ? Math.min(accuracyM, 40) : 0;
  if (deviationM > baseThresholdM + slack) return true;

  // Riding a road that runs close beside the route — common in a dense city
  // — never gets far enough away to cross the distance line. Travelling in a
  // clearly different direction from the route at that point gives it away,
  // so a heading that disagrees halves the distance needed. The caller only
  // passes a heading error when the bike is moving fast enough for its GPS
  // course to mean something.
  return (
    headingErrorDeg != null &&
    headingErrorDeg > WRONG_WAY_DEG &&
    deviationM > (baseThresholdM + slack) / 2
  );
}

/** A course further than this from the route's direction is not following it. */
export const WRONG_WAY_DEG = 60;

/**
 * The point `distanceM` along the route from its start.
 *
 * `fromSegment` is a hint where to begin looking; the answer is the same
 * without it, only slower.
 */
export function pointAlong(
  route: Route,
  index: RouteIndex,
  distanceM: number,
  fromSegment = 0,
): LngLat {
  const { shape } = route;
  const { cumulative } = index;
  if (shape.length === 0) return [0, 0];
  if (distanceM <= 0) return shape[0];
  if (distanceM >= index.totalM) return shape[shape.length - 1];

  let i = clamp(fromSegment, 0, shape.length - 2);
  while (i > 0 && cumulative[i] > distanceM) i -= 1;
  while (i < shape.length - 2 && cumulative[i + 1] < distanceM) i += 1;

  const span = cumulative[i + 1] - cumulative[i];
  const t = span > 0 ? (distanceM - cumulative[i]) / span : 0;
  const a = shape[i];
  const b = shape[i + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * The direction the route runs at a point along it, in degrees from north.
 *
 * Measured across a stretch either side rather than along a single shape
 * segment: segments on a curve can be a metre long and point anywhere, where
 * the road as a whole does not.
 */
export function routeBearingAt(
  route: Route,
  index: RouteIndex,
  distanceAlongM: number,
  segmentHint = 0,
  behindM = 10,
  aheadM = 20,
): number | null {
  if (route.shape.length < 2) return null;
  const from = pointAlong(route, index, distanceAlongM - behindM, segmentHint);
  const to = pointAlong(route, index, distanceAlongM + aheadM, segmentHint);
  if (metresBetween(from, to) < 1) return null;
  return bearing(from, to);
}

/**
 * The stops still ahead of a rider at `segmentIndex` on `route`.
 *
 * A reroute plans again from where the rider is; sending the old stop list
 * would turn them back to a fuel stop they have already left.
 */
export function remainingStops<T>(stops: T[], route: Route, segmentIndex: number): T[] {
  if (stops.length <= 1) return stops;
  const ahead: T[] = [];
  for (let i = 0; i < stops.length - 1; i += 1) {
    const at = route.stopIndices[i];
    // An unknown position keeps the stop: skipping one wrongly is worse.
    if (at == null || segmentIndex < at) ahead.push(stops[i]);
  }
  ahead.push(stops[stops.length - 1]);
  return ahead;
}

function bearing(a: LngLat, b: LngLat): number {
  const kx = Math.cos(toRad((a[1] + b[1]) / 2));
  const dx = (b[0] - a[0]) * kx;
  const dy = b[1] - a[1];
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/** Spoken and displayed distance, rounded the way a rider expects to hear it. */
export function formatManeuverDistance(meters: number): string {
  if (meters < 30) return "Now";
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--";
  // Tested before rounding: 30 seconds rounds up to a whole minute, which
  // would otherwise report "1 min" and never reach the sub-minute case.
  if (seconds < 60) return "<1 min";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

/** Clock time of arrival, e.g. "3:42 pm". */
export function formatEta(seconds: number, now: Date = new Date()): string {
  const arrival = new Date(now.getTime() + seconds * 1000);
  return arrival.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

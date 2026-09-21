import { distanceMeters } from "./geo";
import type { Destination, RiderState } from "./types";

/**
 * Two final stops closer than this are the same place.
 *
 * Generous on purpose: one rider dropping a pin on the petrol pump and another
 * picking it from search land a few dozen metres apart, and they are still
 * going to the same place.
 */
export const SAME_PLACE_M = 75;

/** Longest stop label carried over presence; the rest is never read at speed. */
export const MAX_STOP_LABEL = 80;

/** More stops than anyone plans on a ride, and a cap on what a peer can send. */
export const MAX_TRIP_STOPS = 8;

/** Where another rider in the party is heading, offered to everyone else. */
export type GroupTrip = {
  leader: RiderState;
  stops: Destination[];
  /** Other riders (not the leader, not you) already heading to the same place. */
  alsoGoing: number;
  /** Changes whenever the leader or the place changes, so a dismissal is per trip. */
  key: string;
};

/**
 * Validates a trip received from another phone.
 *
 * Presence payloads are whatever a peer chose to send, so nothing is trusted:
 * a malformed trip is dropped whole rather than partially used.
 */
export function sanitizeTrip(raw: unknown): Destination[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TRIP_STOPS) {
    return null;
  }

  const stops: Destination[] = [];
  for (const item of raw) {
    const lngLat = (item as { lngLat?: unknown } | null)?.lngLat;
    const label = (item as { label?: unknown } | null)?.label;
    if (!Array.isArray(lngLat) || lngLat.length !== 2) return null;

    const [lng, lat] = lngLat;
    if (typeof lng !== "number" || typeof lat !== "number") return null;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;

    stops.push({
      lngLat: [lng, lat],
      label:
        typeof label === "string" && label.trim()
          ? label.trim().slice(0, MAX_STOP_LABEL)
          : "Destination",
    });
  }
  return stops;
}

/** Trims a trip down to what is worth sending over presence. */
export function tripForPresence(stops: Destination[]): Destination[] {
  return stops.slice(-MAX_TRIP_STOPS).map((s) => ({
    lngLat: s.lngLat,
    label: s.label.slice(0, MAX_STOP_LABEL),
  }));
}

/** True when both trips end at the same place, whatever they pass on the way. */
export function sameDestination(a: Destination[], b: Destination[]): boolean {
  const endA = a[a.length - 1];
  const endB = b[b.length - 1];
  if (!endA || !endB) return false;
  return distanceMeters(endA.lngLat, endB.lngLat) <= SAME_PLACE_M;
}

/** Where a rider is heading, if they have a journey under way. */
export function destinationOf(rider: RiderState): Destination | null {
  if (!rider.navigating) return null;
  const stops = sanitizeTrip(rider.trip);
  return stops ? stops[stops.length - 1] : null;
}

/**
 * Picks the one trip to offer this rider.
 *
 * The host's trip wins outright: on a group ride the host is the one leading,
 * and two competing suggestions would split the group. Without the host
 * navigating, the destination most riders already share wins, so a suggestion
 * pulls the group together rather than apart. Ties fall to rider id, which is
 * arbitrary but identical on every phone.
 */
export function pickGroupTrip(riders: RiderState[], selfId: string): GroupTrip | null {
  const candidates = riders
    .filter((r) => r.id !== selfId && r.navigating)
    .map((r) => ({ rider: r, stops: sanitizeTrip(r.trip) }))
    .filter((c): c is { rider: RiderState; stops: Destination[] } => c.stops !== null);

  if (candidates.length === 0) return null;

  const heading = (stops: Destination[]) =>
    candidates.filter((c) => sameDestination(c.stops, stops)).length;

  const ranked = [...candidates].sort((a, b) => {
    if (a.rider.isHost !== b.rider.isHost) return a.rider.isHost ? -1 : 1;
    const crowd = heading(b.stops) - heading(a.stops);
    if (crowd !== 0) return crowd;
    return a.rider.id < b.rider.id ? -1 : a.rider.id > b.rider.id ? 1 : 0;
  });

  const best = ranked[0];
  const end = best.stops[best.stops.length - 1].lngLat;

  return {
    leader: best.rider,
    stops: best.stops,
    alsoGoing: heading(best.stops) - 1,
    key: `${best.rider.id}@${end[0].toFixed(4)},${end[1].toFixed(4)}`,
  };
}

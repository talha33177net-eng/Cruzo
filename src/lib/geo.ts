import type { LngLat, LngLatBounds } from "@maplibre/maplibre-react-native";

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in metres. */
export function distanceMeters(a: LngLat, b: LngLat): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, in degrees clockwise from north. */
export function bearingDegrees(a: LngLat, b: LngLat): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export function compassPoint(bearing: number): string {
  return COMPASS[Math.round(bearing / 45) % 8];
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return "--";
  if (meters < 1000) return `${Math.round(meters)} m`;
  if (meters < 10000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

/** Converts metres/second, as reported by GPS, to km/h. */
export function formatSpeed(metersPerSecond: number | null): string {
  if (metersPerSecond == null || !Number.isFinite(metersPerSecond)) return "--";
  const kmh = Math.max(0, metersPerSecond) * 3.6;
  return `${Math.round(kmh)}`;
}

export function formatAgo(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 5) return "live";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/**
 * Bounding box enclosing every point, expanded by `padRatio` so markers near an
 * edge are not clipped by the map frame. Returns `null` for an empty list.
 *
 * A single point has zero extent, which MapLibre cannot fit, so it is given a
 * small fixed span instead.
 */
export function boundsOf(points: LngLat[], padRatio = 0.25): LngLatBounds | null {
  if (points.length === 0) return null;

  let west = points[0][0];
  let east = points[0][0];
  let south = points[0][1];
  let north = points[0][1];

  for (const [lng, lat] of points) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }

  const MIN_SPAN = 0.004; // ~450 m, a sane zoom for a single rider
  const lngSpan = Math.max(east - west, MIN_SPAN);
  const latSpan = Math.max(north - south, MIN_SPAN);
  const lngPad = lngSpan * padRatio;
  const latPad = latSpan * padRatio;
  const lngMid = (west + east) / 2;
  const latMid = (south + north) / 2;

  return [
    lngMid - lngSpan / 2 - lngPad,
    latMid - latSpan / 2 - latPad,
    lngMid + lngSpan / 2 + lngPad,
    latMid + latSpan / 2 + latPad,
  ];
}

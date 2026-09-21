import type { LngLat } from "@maplibre/maplibre-react-native";

import { BANGLADESH_BBOX, photonUrl, ROUTE_TIMEOUT_MS } from "./config";

export type Place = {
  /** Stable key for list rendering. */
  id: string;
  /** Headline, e.g. "Gulshan Circle 1". */
  name: string;
  /** Supporting line, e.g. "Road 63, Gulshan, Dhaka". */
  context: string;
  lngLat: LngLat;
};

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id?: number;
    osm_type?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    locality?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    postcode?: string;
    type?: string;
  };
};

/**
 * Builds the two display lines for a result.
 *
 * Photon returns a loose bag of administrative fields that varies by country
 * and by how the place is tagged in OpenStreetMap, so the name falls back
 * through progressively coarser fields rather than assuming `name` is set —
 * a plain street address has no `name` at all.
 */
function describe(feature: PhotonFeature): { name: string; context: string } {
  const p = feature.properties;
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");

  const name = p.name || street || p.locality || p.district || p.city || "Dropped pin";

  const context = [
    name !== street ? street : null,
    p.district || p.locality,
    p.city || p.county,
    p.state,
    p.country,
  ]
    .filter(Boolean)
    // The same word often appears in several fields (district and city both
    // reading "Dhaka"), which reads as a stutter in the list.
    .filter((part, i, all) => all.indexOf(part) === i)
    .slice(0, 3)
    .join(", ");

  return { name, context };
}

function toPlace(feature: PhotonFeature, i: number): Place {
  const { name, context } = describe(feature);
  const p = feature.properties;
  return {
    id: p.osm_type && p.osm_id ? `${p.osm_type}${p.osm_id}` : `f${i}`,
    name,
    context,
    lngLat: [feature.geometry.coordinates[0], feature.geometry.coordinates[1]],
  };
}

async function request(url: string, signal?: AbortSignal): Promise<PhotonFeature[]> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), ROUTE_TIMEOUT_MS);
  const onOuterAbort = () => timeout.abort();
  signal?.addEventListener("abort", onOuterAbort);

  try {
    const response = await fetch(url, { signal: timeout.signal });
    if (!response.ok) return [];
    const data = (await response.json()) as { features?: PhotonFeature[] };
    return data.features ?? [];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

/**
 * Moves Bangladeshi results above everything else, keeping Photon's own
 * relevance order within each group.
 *
 * The bounding box alone is not enough: any rectangle around Bangladesh also
 * contains West Bengal, Tripura and part of Myanmar, so a search for a common
 * name like "New Market" still returns Indian results. A country check is the
 * only way to express the border.
 */
function rankBangladeshFirst(features: PhotonFeature[]): PhotonFeature[] {
  const isBd = (f: PhotonFeature) =>
    (f.properties.country ?? "").toLowerCase() === "bangladesh";
  return [...features.filter(isBd), ...features.filter((f) => !isBd(f))];
}

/**
 * Searches for a place by name.
 *
 * `near` biases results towards the rider, which matters enormously for short
 * queries — "station" should mean the one down the road, not one on another
 * continent.
 */
export async function searchPlaces(
  query: string,
  near: LngLat | null,
  signal?: AbortSignal,
): Promise<Place[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const build = (restrictToBangladesh: boolean) => {
    const params = new URLSearchParams({ q: trimmed, limit: "8" });
    if (near) {
      params.set("lon", near[0].toFixed(5));
      params.set("lat", near[1].toFixed(5));
    }
    if (restrictToBangladesh) {
      params.set("bbox", BANGLADESH_BBOX.join(","));
    }
    return `${photonUrl}?${params.toString()}`;
  };

  try {
    // Bangladesh first: a road name searched here should mean the one down the
    // street, not a same-named road on another continent.
    const local = await request(build(true), signal);
    if (local.length > 0) return rankBangladeshFirst(local).map(toPlace);

    // Nothing nearby — fall back to a worldwide search so riding abroad, or
    // looking up somewhere far away, still works.
    const worldwide = await request(build(false), signal);
    return rankBangladeshFirst(worldwide).map(toPlace);
  } catch {
    // A failed or cancelled lookup simply yields no suggestions; the caller
    // keeps whatever it was already showing.
    return [];
  }
}

/** Names a point the rider picked straight off the map. */
export async function reverseGeocode(
  lngLat: LngLat,
  signal?: AbortSignal,
): Promise<Place | null> {
  const params = new URLSearchParams({
    lon: lngLat[0].toFixed(5),
    lat: lngLat[1].toFixed(5),
  });

  try {
    const features = await request(
      `${photonUrl.replace("/api", "/reverse")}?${params.toString()}`,
      signal,
    );
    if (features.length === 0) return null;
    // Keep the coordinates the rider actually chose, not the centroid of
    // whatever feature happened to match.
    return { ...toPlace(features[0], 0), lngLat };
  } catch {
    return null;
  }
}

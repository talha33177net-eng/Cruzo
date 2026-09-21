import type { LngLat } from "@maplibre/maplibre-react-native";

/**
 * Decodes an encoded polyline into `[lng, lat]` pairs.
 *
 * Valhalla encodes route shapes at precision 6 (Google's original format uses
 * 5), so the caller must pass the precision the producer used — decoding at
 * the wrong one silently shifts the whole line by a factor of ten.
 */
export function decodePolyline(encoded: string, precision = 6): LngLat[] {
  const factor = 10 ** precision;
  const points: LngLat[] = [];

  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 1;
    let shift = 0;
    let byte: number;

    // Latitude delta, then longitude delta: each is a zig-zag encoded varint
    // spread over 5-bit chunks with a continuation bit.
    do {
      byte = encoded.charCodeAt(index++) - 63 - 1;
      result += byte << shift;
      shift += 5;
    } while (byte >= 0x1f);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 1;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63 - 1;
      result += byte << shift;
      shift += 5;
    } while (byte >= 0x1f);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lng / factor, lat / factor]);
  }

  return points;
}

import { riderPalette } from "../theme";

/**
 * Maps a rider id onto a palette slot.
 *
 * Hashing the id (rather than using the rider's index in the roster) keeps a
 * rider's colour identical on every phone in the party and stable as others
 * join or drop out mid-ride.
 */
export function colorForRider(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return riderPalette[Math.abs(hash) % riderPalette.length];
}

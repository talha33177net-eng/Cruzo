import type { LngLat } from "@maplibre/maplibre-react-native";

const M_PER_DEG = 111320;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Shortest signed difference between two bearings, in degrees (-180, 180]. */
export function angleDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** Normalises any angle into [0, 360). */
export function wrapDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Moves `previous` a fraction `alpha` of the way towards `next`, the short
 * way round the circle.
 *
 * A plain average of 350° and 10° gives 180°, which is why headings need
 * their own smoothing.
 */
export function smoothHeading(previous: number | null, next: number, alpha: number): number {
  if (previous == null) return wrapDegrees(next);
  return wrapDegrees(previous + angleDelta(previous, next) * alpha);
}

/** Below this ground speed a bike is treated as standing still. */
export const STILL_SPEED_MS = 0.8;

/**
 * A small Kalman filter over GPS fixes.
 *
 * Raw fixes wander by several metres even on a parked bike, and each one used
 * to move the marker and the camera. This blends every fix with a prediction
 * — the previous estimate carried forward along the course at the reported
 * speed — weighted by how much each can be trusted: a vague fix barely moves
 * the estimate, a sharp one moves it a lot.
 *
 * Predicting forward is what keeps it from lagging: a filter that only
 * averaged positions would trail a bike at 60 km/h by tens of metres.
 *
 * Standing still, fixes that land inside the noise radius are absorbed
 * without moving the estimate at all, which is what finally stops the marker
 * shivering at a red light.
 */
export class PositionFilter {
  private estimate: LngLat | null = null;
  /** Variance of the estimate, in square metres. */
  private variance = 0;
  private timestamp = 0;

  reset(): void {
    this.estimate = null;
  }

  /**
   * Feeds one fix and returns the filtered position.
   *
   * `course` is degrees from north, `speed` metres per second; either may be
   * unknown, in which case no forward prediction is made.
   */
  update(
    position: LngLat,
    accuracyM: number | null,
    timestamp: number,
    speed: number | null,
    course: number | null,
  ): LngLat {
    const accuracy = Math.max(3, accuracyM ?? 15);

    if (!this.estimate || timestamp <= this.timestamp) {
      this.estimate = position;
      this.variance = accuracy * accuracy;
      this.timestamp = timestamp;
      return position;
    }

    const dt = Math.min(10, (timestamp - this.timestamp) / 1000);
    this.timestamp = timestamp;

    const kx = M_PER_DEG * Math.cos(toRad(this.estimate[1]));
    const moving = speed != null && speed >= STILL_SPEED_MS;

    // --- predict ------------------------------------------------------
    let predicted = this.estimate;
    if (moving && course != null) {
      const travelled = speed * dt;
      predicted = [
        predicted[0] + (travelled * Math.sin(toRad(course))) / kx,
        predicted[1] + (travelled * Math.cos(toRad(course))) / M_PER_DEG,
      ];
    }

    // How far a bike can plausibly surprise the prediction per second: a
    // little when parked, more at speed where braking and turning add up.
    const agility = moving ? 2 + 0.4 * (speed ?? 0) : 1;
    this.variance += dt * agility * agility;

    // --- hold still ---------------------------------------------------
    const dxM = (position[0] - predicted[0]) * kx;
    const dyM = (position[1] - predicted[1]) * M_PER_DEG;
    const offsetM = Math.hypot(dxM, dyM);

    if (!moving && offsetM < Math.max(6, accuracy * 0.8)) {
      this.estimate = predicted;
      // Still learn from the fix, so a genuine slow creep eventually shows.
      this.variance = Math.max(1, this.variance * 0.9);
      return predicted;
    }

    // --- correct ------------------------------------------------------
    const gain = this.variance / (this.variance + accuracy * accuracy);
    this.estimate = [
      predicted[0] + (position[0] - predicted[0]) * gain,
      predicted[1] + (position[1] - predicted[1]) * gain,
    ];
    this.variance = (1 - gain) * this.variance;
    return this.estimate;
  }
}

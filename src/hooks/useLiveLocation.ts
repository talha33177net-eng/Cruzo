import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";

import {
  LOCATION_DISTANCE_M,
  LOCATION_INTERVAL_MS,
  MAX_ACCURACY_M,
  MIN_SPEED_FOR_HEADING,
  NAV_LOCATION_DISTANCE_M,
  NAV_LOCATION_INTERVAL_MS,
} from "../lib/config";
import type { Fix } from "../lib/types";

export type LocationPermission = "pending" | "granted" | "denied";

export type LiveLocation = {
  permission: LocationPermission;
  /** True when location services are switched off at the OS level. */
  servicesDisabled: boolean;
  fix: Fix | null;
  /**
   * The direction the rider is facing, in degrees from north.
   *
   * Updates far more often than `fix`, because it comes from the compass while
   * stationary. This is what the map marker and the camera should use.
   */
  heading: number | null;
  error: string | null;
  retry: () => void;
};

/** Faster than any motorcycle; anything above this is a bad fix, not a bike. */
const IMPLAUSIBLE_SPEED_MS = 90;

const M_PER_DEG = 111320;

function metresBetween(a: Fix["lngLat"], b: Fix["lngLat"]): number {
  const kx = M_PER_DEG * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  const dx = (a[0] - b[0]) * kx;
  const dy = (a[1] - b[1]) * M_PER_DEG;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Shortest signed difference between two bearings, in degrees. */
function angleDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/**
 * Streams GPS fixes and a usable facing direction.
 *
 * Two filters keep the map honest. Position: Android interleaves coarse
 * network fixes with real satellite ones, so anything vaguer than
 * `MAX_ACCURACY_M`, or implying an impossible speed, is dropped rather than
 * drawn — otherwise a parked bike teleports.
 *
 * Direction: the GPS course is only meaningful while actually moving, so below
 * `MIN_SPEED_FOR_HEADING` the magnetometer takes over. That is what lets the
 * marker point the right way while the rider sits at a junction, which the
 * course reading alone can never do.
 *
 * Cruzo watches only in the foreground. Background location on Android needs a
 * persistent foreground service and a Play Store justification; the ride screen
 * keeps the display awake instead.
 */
export function useLiveLocation(enabled: boolean, navigating = false): LiveLocation {
  const [permission, setPermission] = useState<LocationPermission>("pending");
  const [servicesDisabled, setServicesDisabled] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const positionSub = useRef<Location.LocationSubscription | null>(null);
  const headingSub = useRef<Location.LocationSubscription | null>(null);
  const lastAcceptedRef = useRef<Fix | null>(null);
  const courseRef = useRef<number | null>(null);
  const shownHeadingRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    /**
     * Publishes a heading, ignoring changes too small to see.
     *
     * The magnetometer jitters by a degree or two constantly; without this the
     * marker shivers and every frame re-renders for nothing.
     */
    const publishHeading = (next: number) => {
      const current = shownHeadingRef.current;
      if (current != null && Math.abs(angleDelta(current, next)) < 3) return;
      shownHeadingRef.current = next;
      setHeading(next);
    };

    const start = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;

        if (status !== "granted") {
          setPermission("denied");
          return;
        }
        setPermission("granted");

        const servicesOn = await Location.hasServicesEnabledAsync();
        if (cancelled) return;
        setServicesDisabled(!servicesOn);
        if (!servicesOn) return;

        positionSub.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: navigating ? NAV_LOCATION_INTERVAL_MS : LOCATION_INTERVAL_MS,
            distanceInterval: navigating ? NAV_LOCATION_DISTANCE_M : LOCATION_DISTANCE_M,
          },
          (position) => {
            const { coords, timestamp } = position;
            const candidate: Fix["lngLat"] = [coords.longitude, coords.latitude];
            const accuracy = coords.accuracy ?? null;
            const previous = lastAcceptedRef.current;

            // Drop vague fixes, but never the very first one — without it the
            // map has nowhere to open and the rider sees an empty world.
            if (previous && accuracy != null && accuracy > MAX_ACCURACY_M) return;

            // Drop physically impossible jumps.
            if (previous) {
              const elapsed = Math.max(0.001, (timestamp - previous.timestamp) / 1000);
              const impliedSpeed = metresBetween(previous.lngLat, candidate) / elapsed;
              if (impliedSpeed > IMPLAUSIBLE_SPEED_MS) return;
            }

            const speed = coords.speed ?? null;
            const course =
              coords.heading != null && coords.heading >= 0 ? coords.heading : null;

            // Once moving, the course over ground beats the compass: it is not
            // thrown off by the bike's own magnetic field or a phone mount.
            if (course != null && speed != null && speed >= MIN_SPEED_FOR_HEADING) {
              courseRef.current = course;
              publishHeading(course);
            } else if (speed != null && speed < MIN_SPEED_FOR_HEADING) {
              courseRef.current = null;
            }

            const next: Fix = {
              lngLat: candidate,
              heading: course ?? shownHeadingRef.current,
              speed,
              accuracy,
              timestamp,
            };

            lastAcceptedRef.current = next;
            setError(null);
            setFix(next);
          },
        );

        // The compass carries the direction whenever the rider is too slow for
        // the GPS course to mean anything — including standing still.
        headingSub.current = await Location.watchHeadingAsync((reading) => {
          if (courseRef.current != null) return; // moving: GPS course wins
          const value =
            reading.trueHeading >= 0 ? reading.trueHeading : reading.magHeading;
          if (value >= 0) publishHeading(value);
        });
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Location failed.");
      }
    };

    void start();

    return () => {
      cancelled = true;
      positionSub.current?.remove();
      positionSub.current = null;
      headingSub.current?.remove();
      headingSub.current = null;
    };
  }, [enabled, navigating, attempt]);

  return {
    permission,
    servicesDisabled,
    fix,
    heading,
    error,
    retry: () => setAttempt((value) => value + 1),
  };
}

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
import { angleDelta, PositionFilter, smoothHeading } from "../lib/motion";
import type { Fix } from "../lib/types";

export type LocationPermission = "pending" | "granted" | "denied";

export type LiveLocation = {
  permission: LocationPermission;
  /** True when location services are switched off at the OS level. */
  servicesDisabled: boolean;
  /** The latest fix, already smoothed (see `PositionFilter`). */
  fix: Fix | null;
  /**
   * The direction the rider is facing, in degrees from north.
   *
   * Updates far more often than `fix`, because it comes from the compass while
   * stationary. This is what a parked rider's view cone should use.
   */
  heading: number | null;
  /**
   * The last direction of travel from GPS, held while the bike is stopped.
   *
   * Unlike `heading` it never falls back to the compass, so a map turned by
   * it does not spin at a red light when the magnetometer is thrown off by
   * the engine.
   */
  course: number | null;
  error: string | null;
  retry: () => void;
};

/** Faster than any motorcycle; anything above this is a bad fix, not a bike. */
const IMPLAUSIBLE_SPEED_MS = 90;

/**
 * Compass changes smaller than this are ignored.
 *
 * A phone on a handlebar sits next to an engine and a steel frame; its
 * magnetometer swings by several degrees on its own. Below this the marker
 * would shiver for nothing.
 */
const COMPASS_DEADBAND_DEG = 6;

/** How far each compass reading pulls the shown heading, 0–1. */
const COMPASS_SMOOTHING = 0.25;

/** GPS course is far steadier, so it is followed more closely. */
const COURSE_SMOOTHING = 0.6;

const M_PER_DEG = 111320;

function metresBetween(a: Fix["lngLat"], b: Fix["lngLat"]): number {
  const kx = M_PER_DEG * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  const dx = (a[0] - b[0]) * kx;
  const dy = (a[1] - b[1]) * M_PER_DEG;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Streams GPS fixes and a usable facing direction.
 *
 * Three filters keep the map honest. Position: Android interleaves coarse
 * network fixes with real satellite ones, so anything vaguer than
 * `MAX_ACCURACY_M`, or implying an impossible speed, is dropped rather than
 * drawn — otherwise a parked bike teleports. What survives goes through a
 * Kalman filter, which takes out the few metres of wander every fix has.
 *
 * Direction: the GPS course is only meaningful while actually moving, so below
 * `MIN_SPEED_FOR_HEADING` the magnetometer takes over. That is what lets the
 * marker point the right way while the rider sits at a junction, which the
 * course reading alone can never do. Both are smoothed on the circle, and the
 * compass has a dead band, because it is noisy next to an engine.
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
  const [course, setCourse] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const positionSub = useRef<Location.LocationSubscription | null>(null);
  const headingSub = useRef<Location.LocationSubscription | null>(null);
  const lastRawRef = useRef<Fix | null>(null);
  const courseRef = useRef<number | null>(null);
  const smoothCourseRef = useRef<number | null>(null);
  const smoothHeadingRef = useRef<number | null>(null);
  const shownHeadingRef = useRef<number | null>(null);
  const filterRef = useRef(new PositionFilter());

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    /**
     * Smooths a reading into the shown heading, and publishes it only once it
     * has moved far enough to see — every publish re-renders the map screen.
     */
    const publishHeading = (reading: number, alpha: number, deadband: number) => {
      const next = smoothHeading(smoothHeadingRef.current, reading, alpha);
      smoothHeadingRef.current = next;
      const current = shownHeadingRef.current;
      if (current != null && Math.abs(angleDelta(current, next)) < deadband) return;
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
            const previous = lastRawRef.current;

            // Drop vague fixes, but never the very first one — without it the
            // map has nowhere to open and the rider sees an empty world.
            if (previous && accuracy != null && accuracy > MAX_ACCURACY_M) return;

            // Drop physically impossible jumps. Judged against the last raw
            // fix, not the smoothed one, which deliberately trails a little.
            if (previous) {
              const elapsed = Math.max(0.001, (timestamp - previous.timestamp) / 1000);
              const impliedSpeed = metresBetween(previous.lngLat, candidate) / elapsed;
              if (impliedSpeed > IMPLAUSIBLE_SPEED_MS) return;
            }

            const speed = coords.speed ?? null;
            const rawCourse =
              coords.heading != null && coords.heading >= 0 ? coords.heading : null;

            // Once moving, the course over ground beats the compass: it is not
            // thrown off by the bike's own magnetic field or a phone mount.
            const moving =
              rawCourse != null && speed != null && speed >= MIN_SPEED_FOR_HEADING;
            if (moving) {
              courseRef.current = rawCourse;
              publishHeading(rawCourse, COURSE_SMOOTHING, 2);
              const nextCourse = smoothHeading(
                smoothCourseRef.current,
                rawCourse,
                COURSE_SMOOTHING,
              );
              if (
                smoothCourseRef.current == null ||
                Math.abs(angleDelta(smoothCourseRef.current, nextCourse)) >= 2
              ) {
                smoothCourseRef.current = nextCourse;
                setCourse(nextCourse);
              }
            } else if (speed != null && speed < MIN_SPEED_FOR_HEADING) {
              // Hand the heading back to the compass, but keep `course`: it is
              // still the way the bike is pointing.
              courseRef.current = null;
            }

            lastRawRef.current = {
              lngLat: candidate,
              heading: rawCourse,
              speed,
              accuracy,
              timestamp,
            };

            const next: Fix = {
              lngLat: filterRef.current.update(
                candidate,
                accuracy,
                timestamp,
                speed,
                moving ? rawCourse : null,
              ),
              heading: moving ? smoothCourseRef.current : shownHeadingRef.current,
              speed,
              accuracy,
              timestamp,
            };

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
          if (value >= 0) publishHeading(value, COMPASS_SMOOTHING, COMPASS_DEADBAND_DEG);
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
    course,
    error,
    retry: () => setAttempt((value) => value + 1),
  };
}

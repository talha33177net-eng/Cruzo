import type { LngLat } from "@maplibre/maplibre-react-native";
import { useEffect, useRef, useState } from "react";

/** Frame budget for a glide; the marker is a native view, not a GL layer. */
const FRAME_MS = 33;

/** Jumps longer than this are a new place, not movement: no glide. */
const TELEPORT_DEG = 0.01; // about a kilometre

/**
 * Slides a map position from where it was to where it now is.
 *
 * A marker set straight to each new fix hops a few metres every second, and
 * while the camera eases smoothly behind it the two visibly disagree — that
 * was most of the "jiggle". Gliding linearly over the same duration the
 * camera uses (with `easing: "linear"`) keeps marker and map moving together.
 *
 * Only the component that calls this re-renders per frame, so each marker is
 * its own small component.
 */
export function useGlide(target: LngLat | null, durationMs: number): LngLat | null {
  const [shown, setShown] = useState<LngLat | null>(target);
  const shownRef = useRef<LngLat | null>(target);
  const frameRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lng = target?.[0];
  const lat = target?.[1];

  useEffect(() => {
    if (lng == null || lat == null) {
      shownRef.current = null;
      setShown(null);
      return;
    }

    const from = shownRef.current;
    const to: LngLat = [lng, lat];

    if (
      !from ||
      durationMs <= 0 ||
      Math.abs(from[0] - to[0]) > TELEPORT_DEG ||
      Math.abs(from[1] - to[1]) > TELEPORT_DEG
    ) {
      shownRef.current = to;
      setShown(to);
      return;
    }

    const started = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - started) / durationMs);
      const next: LngLat = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
      shownRef.current = next;
      setShown(next);
      if (t < 1) frameRef.current = setTimeout(step, FRAME_MS);
    };
    step();

    return () => {
      if (frameRef.current) clearTimeout(frameRef.current);
      frameRef.current = null;
    };
  }, [lng, lat, durationMs]);

  return shown;
}

import type { LngLat } from "@maplibre/maplibre-react-native";
import * as Speech from "expo-speech";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ANNOUNCE_FAR_M,
  ANNOUNCE_NEAR_M,
  OFF_ROUTE_FIXES,
  OFF_ROUTE_M,
  REROUTE_COOLDOWN_MS,
} from "../lib/config";
import { angleDelta } from "../lib/motion";
import {
  buildRouteIndex,
  isOffRoute,
  locateOnRoute,
  remainingStops,
  routeBearingAt,
  type RouteIndex,
  type RouteProgress,
} from "../lib/navigation";
import { fetchRoutes } from "../lib/routing";
import type { Destination, Fix, Route } from "../lib/types";

export type NavStatus =
  | "idle"
  /** Waiting on the routing service. */
  | "routing"
  /** Routes are on screen and the rider is choosing; nothing has started. */
  | "preview"
  | "navigating"
  | "rerouting"
  | "arrived"
  | "error";

export type Navigation = {
  /** Where the ride is going: one or more stops, in order. */
  stops: Destination[];
  /** Every route offered for the current stops. */
  routes: Route[];
  selectedIndex: number;
  /** The route being followed, or the one highlighted in preview. */
  route: Route | null;
  progress: RouteProgress | null;
  /**
   * Which way the route runs where the rider is, in degrees from north.
   *
   * Far steadier than any sensor, so the driving camera turns with this
   * whenever the rider is on the line.
   */
  routeBearing: number | null;
  status: NavStatus;
  error: string | null;
  /** How many times the route has been rebuilt since the journey began. */
  rerouteCount: number;
  voiceEnabled: boolean;
  setVoiceEnabled: (enabled: boolean) => void;

  /** Fetch routes to these stops and show them for review. */
  plan: (stops: Destination[]) => void;
  /** Add a stop before the final destination and re-plan. */
  addStop: (stop: Destination) => void;
  removeStop: (index: number) => void;
  selectRoute: (index: number) => void;
  /** Commit to the highlighted route and begin the journey. */
  begin: () => void;
  stop: () => void;
  /** Force a fresh route from where the rider is now. */
  recalculate: () => void;
};

type Announced = { far: boolean; near: boolean };

/** Below this speed the GPS course is too noisy to judge direction by. */
const COURSE_TRUST_SPEED_MS = 3;

/**
 * Turn-by-turn navigation on top of the live GPS feed.
 *
 * Routing and navigating are deliberately separate steps. Fetching a route
 * puts the app in `preview`, where the alternatives are on screen and nothing
 * is being announced; only `begin()` starts the journey. That mirrors how
 * every mapping app works, and it matters more on a group ride, where the
 * point of looking at three routes is to agree on one before setting off.
 *
 * The rerouting behaviour is the other half. Rather than recomputing on every
 * stray fix, a reroute needs the rider to be convincingly off the line: past a
 * threshold that widens with GPS uncertainty, for several consecutive fixes,
 * and no more often than the cooldown allows. That is what separates "it
 * instantly found me a new way" from a route that thrashes whenever the signal
 * bounces off a building.
 */
export function useNavigation(fix: Fix | null): Navigation {
  const [stops, setStops] = useState<Destination[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [progress, setProgress] = useState<RouteProgress | null>(null);
  const [routeBearing, setRouteBearing] = useState<number | null>(null);
  const [status, setStatus] = useState<NavStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [rerouteCount, setRerouteCount] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  const indexRef = useRef<RouteIndex | null>(null);
  const segmentRef = useRef<number | null>(null);
  const offRouteRunRef = useRef(0);
  const lastRerouteRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const announcedRef = useRef<Map<number, Announced>>(new Map());
  const arrivalSpokenRef = useRef(false);

  // Read inside callbacks that must not re-run when the rider moves.
  const fixRef = useRef<Fix | null>(fix);
  fixRef.current = fix;
  const voiceRef = useRef(voiceEnabled);
  voiceRef.current = voiceEnabled;
  const stopsRef = useRef(stops);
  stopsRef.current = stops;

  const route = routes[selectedIndex] ?? null;

  const speak = useCallback((text: string | null) => {
    if (!text || !voiceRef.current) return;
    // Interrupt rather than queue: a stale instruction spoken over the next
    // turn is worse than saying nothing.
    Speech.stop();
    Speech.speak(text, { language: "en-US", rate: 1.0 });
  }, []);

  const resetTracking = useCallback(() => {
    segmentRef.current = null;
    offRouteRunRef.current = 0;
    announcedRef.current.clear();
    arrivalSpokenRef.current = false;
  }, []);

  /**
   * Requests routes from the rider's current position through `next`.
   *
   * `isReroute` changes both how it is reported and what happens afterwards:
   * a reroute keeps the old line on screen while the new one is fetched and
   * resumes navigating immediately, where a fresh plan stops to let the rider
   * choose.
   */
  const request = useCallback(
    async (next: Destination[], isReroute: boolean) => {
      const from = fixRef.current?.lngLat;
      if (!from) {
        setStatus("error");
        setError("Waiting for a GPS fix before routing.");
        return;
      }
      if (next.length === 0) return;

      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;

      setStatus(isReroute ? "rerouting" : "routing");
      setError(null);
      lastRerouteRef.current = Date.now();

      // Only a rolling bike has a direction worth routing from; standing
      // still, the rider may well want to turn round.
      const moving = fixRef.current;
      const heading =
        isReroute && moving?.heading != null && (moving.speed ?? 0) >= COURSE_TRUST_SPEED_MS
          ? moving.heading
          : null;

      const waypoints: LngLat[] = [from, ...next.map((s) => s.lngLat)];
      const result = await fetchRoutes(waypoints, controller.signal, {
        heading,
        // A reroute takes the best way from here; alternatives are only worth
        // a request when the rider is choosing.
        alternates: !isReroute,
      });
      if (controller.signal.aborted) return;
      if (requestRef.current === controller) requestRef.current = null;

      if (isReroute && (result.status !== "ok" || result.routes.length === 0)) {
        // A failed reroute must not end the journey: a phone on a bike loses
        // signal all the time. Carry on along the old line, which still
        // shows where to go, and let the off-route check try again once the
        // cooldown has passed.
        lastRerouteRef.current = Date.now();
        setStatus("navigating");
        return;
      }

      if (result.status !== "ok" || result.routes.length === 0) {
        setStatus("error");
        setError(
          result.status === "no_route"
            ? "No road route to that place."
            : result.status === "error"
              ? result.message
              : "Could not build a route.",
        );
        return;
      }

      setStops(next);
      setRoutes(result.routes);
      setSelectedIndex(0);
      indexRef.current = buildRouteIndex(result.routes[0]);
      resetTracking();
      setProgress(null);

      if (isReroute) {
        setStatus("navigating");
        setRerouteCount((n) => n + 1);
        speak("Rerouting.");
      } else {
        // Stop here and let the rider pick before anything is announced.
        setStatus("preview");
      }
    },
    [resetTracking, speak],
  );

  const plan = useCallback(
    (next: Destination[]) => {
      setStops(next);
      setRoutes([]);
      setSelectedIndex(0);
      setProgress(null);
      indexRef.current = null;
      resetTracking();
      setRerouteCount(0);
      void request(next, false);
    },
    [request, resetTracking],
  );

  const addStop = useCallback(
    (extra: Destination) => {
      // Inserted before the final destination, so "add a stop on the way"
      // means what it says rather than silently changing where the ride ends.
      const current = stopsRef.current;
      const next =
        current.length === 0
          ? [extra]
          : [...current.slice(0, -1), extra, current[current.length - 1]];
      plan(next);
    },
    [plan],
  );

  const removeStop = useCallback(
    (at: number) => {
      const next = stopsRef.current.filter((_, i) => i !== at);
      if (next.length === 0) return;
      plan(next);
    },
    [plan],
  );

  const selectRoute = useCallback(
    (at: number) => {
      setSelectedIndex((current) => {
        if (at === current || at < 0) return current;
        return at;
      });
    },
    [],
  );

  // Keep the cached distance index aligned with whichever route is selected.
  useEffect(() => {
    const chosen = routes[selectedIndex];
    if (!chosen) return;
    indexRef.current = buildRouteIndex(chosen);
    resetTracking();
    setProgress(null);
  }, [routes, selectedIndex, resetTracking]);

  const begin = useCallback(() => {
    if (!routes[selectedIndex]) return;
    resetTracking();
    setRerouteCount(0);
    setStatus("navigating");
  }, [routes, selectedIndex, resetTracking]);

  const stopNavigation = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    Speech.stop();
    indexRef.current = null;
    resetTracking();
    setStops([]);
    setRoutes([]);
    setSelectedIndex(0);
    setProgress(null);
    setRouteBearing(null);
    setStatus("idle");
    setError(null);
    setRerouteCount(0);
  }, [resetTracking]);

  const recalculate = useCallback(() => {
    if (stopsRef.current.length > 0) void request(stopsRef.current, true);
  }, [request]);

  // Advance along the route each time a new fix lands. Only while actually
  // navigating: in preview nothing is announced and nothing is tracked.
  useEffect(() => {
    const active = status === "navigating" || status === "rerouting";
    if (!active || !fix || !route || !indexRef.current) return;

    const next = locateOnRoute(route, indexRef.current, fix.lngLat, segmentRef.current);
    segmentRef.current = next.segmentIndex;
    setProgress(next);

    const along = routeBearingAt(route, indexRef.current, next.distanceAlongM, next.segmentIndex);
    setRouteBearing(along);

    if (next.arrived) {
      if (!arrivalSpokenRef.current) {
        arrivalSpokenRef.current = true;
        speak("You have arrived.");
        setStatus("arrived");
      }
      return;
    }

    // --- voice guidance -----------------------------------------------
    const maneuver = route.maneuvers[next.upcomingIndex];
    if (maneuver) {
      const seen = announcedRef.current.get(next.upcomingIndex) ?? {
        far: false,
        near: false,
      };

      if (!seen.near && next.distanceToManeuverM <= ANNOUNCE_NEAR_M) {
        seen.near = true;
        seen.far = true; // never fall back to the early phrasing afterwards
        speak(maneuver.verbalPre ?? maneuver.instruction);
      } else if (!seen.far && next.distanceToManeuverM <= ANNOUNCE_FAR_M) {
        seen.far = true;
        speak(maneuver.verbalAlert ?? maneuver.instruction);
      }

      announcedRef.current.set(next.upcomingIndex, seen);
    }

    // --- off-route detection ------------------------------------------
    const headingError =
      along != null && fix.heading != null && (fix.speed ?? 0) >= COURSE_TRUST_SPEED_MS
        ? Math.abs(angleDelta(along, fix.heading))
        : null;

    if (isOffRoute(next.deviationM, fix.accuracy, OFF_ROUTE_M, headingError)) {
      offRouteRunRef.current += 1;
    } else {
      offRouteRunRef.current = 0;
    }

    // Never start a second reroute while one is in flight: on a slow reply
    // each new request used to abort the last, and none ever finished.
    const readyToReroute =
      status !== "rerouting" &&
      offRouteRunRef.current >= OFF_ROUTE_FIXES &&
      Date.now() - lastRerouteRef.current > REROUTE_COOLDOWN_MS;

    if (readyToReroute) {
      offRouteRunRef.current = 0;
      void request(remainingStops(stopsRef.current, route, next.segmentIndex), true);
    }
  }, [fix, route, status, request, speak]);

  // Cancel any in-flight request and silence the voice on unmount.
  useEffect(
    () => () => {
      requestRef.current?.abort();
      Speech.stop();
    },
    [],
  );

  return {
    stops,
    routes,
    selectedIndex,
    route,
    progress,
    routeBearing,
    status,
    error,
    rerouteCount,
    voiceEnabled,
    setVoiceEnabled: (enabled: boolean) => {
      setVoiceEnabled(enabled);
      if (!enabled) Speech.stop();
    },
    plan,
    addStop,
    removeStop,
    selectRoute,
    begin,
    stop: stopNavigation,
    recalculate,
  };
}

import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  type PressEvent,
  type ViewStateChangeEvent,
} from "@maplibre/maplibre-react-native";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { useKeepAwake } from "expo-keep-awake";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  type NativeSyntheticEvent,
  Pressable,
  Share,
  StyleSheet,
  Text,
  Vibration,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChatSheet } from "../../src/components/ChatSheet";
import { ChatToast } from "../../src/components/ChatToast";
import { ChromeProvider, chromeFor, useChrome } from "../../src/components/ChromeTheme";
import { DestinationSearch } from "../../src/components/DestinationSearch";
import { GroupTripCard } from "../../src/components/GroupTripCard";
import { ManeuverBanner } from "../../src/components/ManeuverBanner";
import { RiderMarker } from "../../src/components/RiderMarker";
import { useRider } from "../../src/components/RiderProvider";
import { RiderSheet } from "../../src/components/RiderSheet";
import { RoutePreview } from "../../src/components/RoutePreview";
import { SosAlarm } from "../../src/components/SosAlarm";
import { TripPanel } from "../../src/components/TripPanel";
import { VoiceBar } from "../../src/components/VoiceBar";
import { useLiveLocation } from "../../src/hooks/useLiveLocation";
import { useNavigation } from "../../src/hooks/useNavigation";
import { useRideChannel } from "../../src/hooks/useRideChannel";
import { useRideChat } from "../../src/hooks/useRideChat";
import { useVoiceCall } from "../../src/hooks/useVoiceCall";
import { type ChatMessage, isCoordinator } from "../../src/lib/chat";
import {
  mapStyleLabels,
  mapStyleOrder,
  mapStyles,
  PARTY_HEARTBEAT_MS,
  STALE_AFTER_MS,
  type MapStyleName,
} from "../../src/lib/config";
import {
  bearingDegrees,
  boundsOf,
  compassPoint,
  distanceMeters,
  formatSpeed,
} from "../../src/lib/geo";
import { reverseGeocode } from "../../src/lib/geocode";
import { pickGroupTrip, sameDestination, tripForPresence } from "../../src/lib/groupTrip";
import { initialsOf } from "../../src/lib/identity";
import { endParty, findParty, type Party, touchParty } from "../../src/lib/party";
import { colorForRider } from "../../src/lib/riderColor";
import { normalizeRideCode, rideCodeToLink } from "../../src/lib/rideCode";
import type { Destination, RiderState } from "../../src/lib/types";
import { font, type Palette, radius, space } from "../../src/theme";

/**
 * How the camera behaves as new positions arrive.
 *
 * `preview` is the brief look at the whole route when one arrives. It is a
 * distinct mode rather than reusing `overview` because overview continuously
 * re-fits to the riders, which would drag the camera away from the route and
 * never let go.
 */
type FollowMode = "follow" | "overview" | "preview" | "free";

const FOLLOW_ZOOM = 16;
/** Closer and tilted while navigating, so the next turn fills the screen. */
const NAV_ZOOM = 17.2;
const NAV_PITCH = 55;

const OVERVIEW_PADDING = { top: 180, right: 70, bottom: 280, left: 70 };

/** How long the camera stays where the rider left it before following again. */
const RESUME_FOLLOW_MS = 10000;

/** How long the whole route is shown before diving into the driving view. */
const ROUTE_PREVIEW_MS = 2600;

export default function RideScreen() {
  const [styleName, setStyleName] = useState<MapStyleName>("liberty");
  const palette = chromeFor(styleName);

  return (
    <ChromeProvider palette={palette}>
      <RideScreenInner styleName={styleName} setStyleName={setStyleName} />
    </ChromeProvider>
  );
}

function RideScreenInner({
  styleName,
  setStyleName,
}: {
  styleName: MapStyleName;
  setStyleName: (next: MapStyleName) => void;
}) {
  useKeepAwake();

  const params = useLocalSearchParams<{ code: string }>();
  const code = normalizeRideCode(params.code ?? "");
  const { rider, ready } = useRider();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraRef>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const c = useChrome();
  const styles = useMemo(() => makeStyles(c), [c]);

  const [party, setParty] = useState<Party | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [followMode, setFollowMode] = useState<FollowMode>("follow");
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  /** Whether the open search will append a stop rather than start a new plan. */
  const [addingStop, setAddingStop] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [sosActive, setSosActive] = useState(false);
  // Riders whose alarm this device has silenced; their marker stays red.
  const [silenced, setSilenced] = useState<string[]>([]);
  /** Set once the host has ended the ride and the party is confirmed gone. */
  const [ended, setEnded] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [toast, setToast] = useState<ChatMessage | null>(null);
  /** The group-trip suggestion this rider waved away; a new trip asks again. */
  const [dismissedTrip, setDismissedTrip] = useState<string | null>(null);
  /** Whose destination this rider last accepted, to word a change of plan. */
  const [followedLeader, setFollowedLeader] = useState<string | null>(null);

  // Both of these mirror navigation state that is only known further down the
  // hook order: the GPS watcher and the presence payload have to be told
  // before `useNavigation` has run and produced the status that justifies it.
  const [highRate, setHighRate] = useState(false);
  const [riding, setRiding] = useState(false);

  const isHost = Boolean(party && rider && party.hostId === rider.id);

  const location = useLiveLocation(ready, highRate);
  const nav = useNavigation(location.fix);

  /** Where this rider is going, shared so the rest of the party can follow. */
  const trip = useMemo(
    () => (riding && nav.stops.length > 0 ? tripForPresence(nav.stops) : null),
    [riding, nav.stops],
  );

  const profile = useMemo(
    () => ({
      id: rider?.id ?? "",
      name: rider?.name ?? "Rider",
      bike: rider?.bike ?? "",
      isHost,
      sos: sosActive,
      navigating: riding,
      trip,
    }),
    [rider?.id, rider?.name, rider?.bike, isHost, sosActive, riding, trip],
  );

  const connected = ready && Boolean(rider?.id) && !ended;
  const channel = useRideChannel(code, profile, connected);
  const { publish, republish, riders, endedSignal, announceEnd } = channel;

  const riderIds = useMemo(() => riders.map((r) => r.id), [riders]);
  const chat = useRideChat(
    code,
    { id: rider?.id ?? "", name: rider?.name || "Rider" },
    riderIds,
    connected,
    chatOpen,
  );
  const voice = useVoiceCall(code, { id: rider?.id ?? "", name: rider?.name || "Rider" }, connected);
  const inCall = voice.state === "live";
  const othersInCall = voice.members.filter((m) => m.id !== rider?.id).length;

  const navigating =
    nav.status === "navigating" ||
    nav.status === "rerouting" ||
    nav.status === "arrived";

  /** Routes are on screen and the rider is choosing; the ride has not begun. */
  const choosing = nav.status === "preview";

  useEffect(() => {
    setHighRate(nav.status === "navigating" || nav.status === "rerouting");
    setRiding(navigating);
  }, [nav.status, navigating]);

  // Tell the party as soon as the journey starts, ends or changes destination,
  // so everyone's marker and suggestion update without waiting for a GPS tick.
  useEffect(() => {
    republish();
  }, [riding, trip, republish]);

  /**
   * Where this rider is drawn.
   *
   * While navigating and demonstrably on the route, the snapped point is used
   * instead of the raw fix. GPS wanders a few metres either side of the
   * carriageway; snapping keeps the marker on the road the rider is actually
   * riding, which is most of what makes a map feel accurate.
   */
  const displayPosition = useMemo(() => {
    if (nav.progress && navigating && nav.progress.deviationM < 25) {
      return nav.progress.snapped;
    }
    return location.fix?.lngLat ?? null;
  }, [nav.progress, navigating, location.fix]);

  // Confirm the party exists and pick up its name and host.
  useEffect(() => {
    if (!code) return;
    let cancelled = false;

    void findParty(code).then((result) => {
      if (cancelled) return;
      if (result.status === "ok") {
        setParty(result.party);
        return;
      }
      setLookupError(
        result.status === "error"
          ? result.message
          : "This ride is no longer available.",
      );
    });

    return () => {
      cancelled = true;
    };
  }, [code]);

  /**
   * Keeps the party open while anyone is in it.
   *
   * Every rider refreshes it once on arrival — a newcomer should never find a
   * party that is about to lapse — and after that only the coordinator does,
   * so a party costs one tiny write every few minutes however big it is. When
   * everyone has gone the beats stop and the server closes the party itself.
   */
  const coordinatorRef = useRef(false);
  coordinatorRef.current = Boolean(rider?.id) && isCoordinator(rider?.id ?? "", riderIds);

  useEffect(() => {
    if (!party || ended) return;
    void touchParty(code);
    const timer = setInterval(() => {
      if (coordinatorRef.current) void touchParty(code);
    }, PARTY_HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [party, ended, code]);

  /**
   * The host has announced the end of the ride.
   *
   * Anyone in the channel could send that event, so it is only believed once
   * the party is confirmed deleted — which only the host's secret can do.
   */
  const stopNavigation = nav.stop;
  useEffect(() => {
    if (!endedSignal || isHost) return;
    let cancelled = false;

    void findParty(code).then((result) => {
      if (cancelled || result.status !== "not_found") return;
      stopNavigation();
      setSosActive(false);
      setEnded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [endedSignal, isHost, code, stopNavigation]);

  // Slow tick so the "live / 20s ago" labels stay truthful between updates.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (location.fix) publish(location.fix);
  }, [location.fix, publish]);

  const fitEveryone = useCallback(
    (duration: number) => {
      const points = riders.map((r) => [r.lng, r.lat] as [number, number]);
      for (const stop of nav.stops) points.push(stop.lngLat);
      const bounds = boundsOf(points);
      if (!bounds) return false;
      cameraRef.current?.fitBounds(bounds, {
        padding: OVERVIEW_PADDING,
        duration,
        pitch: 0,
      });
      return true;
    },
    [riders, nav.stops],
  );

  const recenter = useCallback(() => {
    if (!displayPosition) return;
    setFollowMode("follow");
    cameraRef.current?.easeTo({
      center: displayPosition,
      zoom: navigating ? NAV_ZOOM : FOLLOW_ZOOM,
      pitch: navigating ? NAV_PITCH : 0,
      bearing: navigating ? (location.heading ?? 0) : 0,
      duration: 600,
    });
  }, [displayPosition, navigating, location.heading]);

  const showEveryone = useCallback(() => {
    if (fitEveryone(700)) setFollowMode("overview");
  }, [fitEveryone]);

  const focusRider = useCallback((target: RiderState) => {
    setFollowMode("free");
    cameraRef.current?.flyTo({
      center: [target.lng, target.lat],
      zoom: FOLLOW_ZOOM,
      duration: 700,
    });
  }, []);

  /**
   * Follow-mode camera.
   *
   * Navigating swings the map to course-up and tilts it, which is what makes
   * the 3D buildings in the basemap readable and tells the rider which way
   * they are pointing without reading anything. Otherwise it stays north-up
   * and flat, which is easier for comparing where the group is.
   */
  useEffect(() => {
    if (followMode !== "follow" || !displayPosition) return;

    cameraRef.current?.easeTo({
      center: displayPosition,
      zoom: navigating ? NAV_ZOOM : FOLLOW_ZOOM,
      pitch: navigating ? NAV_PITCH : 0,
      bearing: navigating ? (location.heading ?? 0) : 0,
      duration: navigating ? 700 : 1000,
    });
  }, [followMode, displayPosition, navigating, location.heading]);

  useEffect(() => {
    if (followMode !== "overview") return;
    fitEveryone(900);
  }, [followMode, fitEveryone]);

  /**
   * While choosing, frame whichever route is highlighted so the rider can see
   * what they are picking. The camera stays put — nothing is under way yet.
   */
  useEffect(() => {
    if (!choosing || !nav.route) return;

    setFollowMode("preview");
    cameraRef.current?.fitBounds(nav.route.bounds, {
      padding: OVERVIEW_PADDING,
      duration: 700,
      pitch: 0,
    });
  }, [choosing, nav.route]);

  /**
   * Pressing Start dives into the driving view.
   *
   * The hand-back to follow mode is the important half: leaving the camera
   * framed on the whole route would mean the rider never gets the tilted,
   * course-up view they actually ride with.
   */
  useEffect(() => {
    if (nav.status !== "navigating" || nav.rerouteCount > 0) return;
    setFollowMode("follow");
  }, [nav.status, nav.rerouteCount]);

  /**
   * A drag or pinch releases the camera. Programmatic moves raise this same
   * event, so `userInteraction` is what separates the two.
   *
   * Each interaction restarts an idle timer that hands the camera back: a
   * rider who pans ahead should not have to remember to press recentre before
   * the next turn.
   */
  const onRegionChange = (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
    if (!event.nativeEvent.userInteraction) return;

    setFollowMode("free");
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => setFollowMode("follow"), RESUME_FOLLOW_MS);
  };

  useEffect(() => {
    if (followMode === "free") return;
    if (resumeTimer.current) {
      clearTimeout(resumeTimer.current);
      resumeTimer.current = null;
    }
  }, [followMode]);

  useEffect(
    () => () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    },
    [],
  );

  /** Press and hold anywhere to ride there. */
  const onLongPress = async (event: NativeSyntheticEvent<PressEvent>) => {
    const { lngLat } = event.nativeEvent;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const place = await reverseGeocode(lngLat);
    const dropped: Destination = { lngLat, label: place?.name ?? "Dropped pin" };
    if (addingStop) nav.addStop(dropped);
    else nav.plan([dropped]);
    setAddingStop(false);
  };

  const pickDestination = (destination: Destination) => {
    setSearchOpen(false);
    // The same picker serves both jobs; which one depends on how it was opened.
    if (addingStop) nav.addStop(destination);
    else nav.plan([destination]);
    setAddingStop(false);
  };

  const cycleStyle = () => {
    const index = mapStyleOrder.indexOf(styleName);
    setStyleName(mapStyleOrder[(index + 1) % mapStyleOrder.length]);
  };

  const leave = () => {
    if (!isHost) {
      router.replace("/");
      return;
    }

    Alert.alert(
      "End this ride?",
      "Ending the party closes it for everyone. Leaving on your own keeps it open for the rest of the group.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Just leave", onPress: () => router.replace("/") },
        {
          text: "End ride",
          style: "destructive",
          onPress: async () => {
            // Awaited before leaving: navigating away closes the channel, and
            // the announcement has to be out of the door first.
            const closed = await endParty(code);
            if (closed) await announceEnd().catch(() => undefined);
            router.replace("/");
            if (!closed) {
              Alert.alert(
                "Could not end the ride",
                "This device no longer holds the host key for this party, so it stays open. You have been taken out of it.",
              );
            }
          },
        },
      ],
    );
  };

  // Raising or clearing an SOS must reach the party now, not on the next GPS
  // tick, so the state is pushed the moment it changes.
  useEffect(() => {
    republish();
  }, [sosActive, republish]);

  /** Riders other than this one who currently have an SOS raised. */
  const distressed = useMemo(
    () => riders.filter((r) => r.sos && r.id !== rider?.id),
    [riders, rider?.id],
  );

  /** The one we should be shouting about: raised, and not silenced here. */
  const alert = distressed.find((r) => !silenced.includes(r.id)) ?? null;

  // Drop anyone from the silenced list once their SOS clears, so a second
  // emergency from the same rider alarms again.
  useEffect(() => {
    setSilenced((current) =>
      current.filter((id) => distressed.some((r) => r.id === id)),
    );
  }, [distressed]);

  /**
   * The alarm itself: a repeating vibration plus a spoken announcement.
   *
   * Speech rather than a siren because it names who is in trouble, and
   * because riders with a helmet intercom get it piped straight into their
   * ear — a tone in a tank bag would never be heard at road speed.
   */
  const alertId = alert?.id ?? null;
  const alertName = alert?.name ?? "";
  useEffect(() => {
    if (!alertId) return;

    Vibration.vibrate([0, 700, 400, 700, 400, 700], true);
    const say = () => {
      Speech.stop();
      Speech.speak(`S O S. ${alertName || "A rider"} needs help.`, {
        language: "en-US",
      });
    };
    say();
    const timer = setInterval(say, 7000);

    return () => {
      clearInterval(timer);
      Vibration.cancel();
      Speech.stop();
    };
  }, [alertId, alertName]);

  /**
   * One tap raises it, with no confirmation: a rider who needs it may not
   * manage a second tap. A mistaken SOS is cancelled with one more press,
   * which clears it for everyone at once.
   */
  const raiseSos = () => {
    if (sosActive) {
      setSosActive(false);
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setSosActive(true);
  };

  // --- group destination --------------------------------------------------

  const groupTrip = useMemo(
    () => (rider?.id ? pickGroupTrip(riders, rider.id) : null),
    [riders, rider?.id],
  );

  /** This rider is already heading to (or planning) the group's destination. */
  const onGroupTrip = Boolean(
    groupTrip && nav.stops.length > 0 && sameDestination(nav.stops, groupTrip.stops),
  );

  // Hidden while a route is being built or chosen: the rider is mid-decision,
  // and the panel below already has their full attention.
  const suggestion =
    groupTrip &&
    !onGroupTrip &&
    groupTrip.key !== dismissedTrip &&
    nav.status !== "routing" &&
    !choosing
      ? groupTrip
      : null;

  const suggestionChanged = Boolean(
    suggestion && followedLeader === suggestion.leader.id && nav.stops.length > 0,
  );

  // A nudge when a new suggestion appears. Spoken only mid-ride, where the
  // rider will not be looking; parked, the card and a buzz are enough.
  const suggestionKey = suggestion?.key ?? null;
  const voiceOn = nav.voiceEnabled;
  useEffect(() => {
    if (!suggestion) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (navigating && voiceOn && !alertId) {
      const place = suggestion.stops[suggestion.stops.length - 1].label;
      Speech.speak(
        suggestionChanged
          ? `${suggestion.leader.name || "The leader"} changed destination to ${place}.`
          : `${suggestion.leader.name || "A rider"} is heading to ${place}.`,
        { language: "en-US" },
      );
    }
    // Only a new suggestion should announce itself, not every position update.
  }, [suggestionKey]);

  const acceptGroupTrip = () => {
    if (!groupTrip) return;
    setFollowedLeader(groupTrip.leader.id);
    // A fresh plan from where this rider is, through the leader's stops: same
    // place, this rider's own road there.
    nav.plan(groupTrip.stops);
  };

  // --- chat -----------------------------------------------------------------

  const { latest: latestMessage, markRead } = chat;

  useEffect(() => {
    if (chatOpen) {
      markRead();
      setToast(null);
    }
  }, [chatOpen, markRead, chat.unread]);

  // Preview each new message over the map, and read it out mid-ride.
  useEffect(() => {
    if (!latestMessage || chatOpen) return;
    setToast(latestMessage);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (navigating && voiceOn && !alertId) {
      Speech.speak(`${latestMessage.name} says: ${latestMessage.text}`, { language: "en-US" });
    }
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
    // Keyed on the message, so a toast is not replayed when anything else moves.
  }, [latestMessage?.id]);

  const shareInvite = async () => {
    await Share.share({
      message: `Join my ride on Cruzo.\n\nCode: ${code}\n${rideCodeToLink(code)}`,
    });
  };

  /**
   * The route split at the rider's current position, so the road already
   * covered can be drawn dimmed and the road ahead bright.
   */
  const routeLines = useMemo(() => {
    if (!nav.route) return null;
    const { shape } = nav.route;
    const progress = nav.progress;

    if (!progress) return { travelled: null, ahead: shape };

    const cut = Math.min(progress.segmentIndex + 1, shape.length);
    return {
      travelled: [...shape.slice(0, cut), progress.snapped],
      ahead: [progress.snapped, ...shape.slice(cut)],
    };
  }, [nav.route, nav.progress]);

  const riderOptions = useMemo(
    () =>
      riders
        .filter((r) => r.id !== rider?.id)
        .map((r) => ({
          id: r.id,
          name: r.name || "Rider",
          lngLat: [r.lng, r.lat] as [number, number],
          color: colorForRider(r.id),
        })),
    [riders, rider?.id],
  );

  const selfInRoster = riders.some((r) => r.id === rider?.id);

  if (lookupError || ended) {
    return (
      <View style={[styles.errorRoot, { paddingTop: insets.top + space.xxl }]}>
        <Text style={styles.errorTitle}>{ended ? "Ride ended" : "Ride unavailable"}</Text>
        <Text style={styles.errorBody}>
          {ended
            ? `${party?.hostName ?? "The host"} has ended the ride. The party and its chat are closed.`
            : lookupError}
        </Text>
        <Pressable
          onPress={() => router.replace("/")}
          accessibilityRole="button"
          style={styles.errorButton}
        >
          <Text style={styles.errorButtonText}>Back to start</Text>
        </Pressable>
      </View>
    );
  }

  const statusLabel =
    channel.status === "connected"
      ? location.fix
        ? "Live"
        : "Waiting for GPS"
      : channel.status === "connecting"
        ? "Connecting"
        : channel.status === "reconnecting"
          ? "Reconnecting"
          : channel.status === "error"
            ? "Offline"
            : "Idle";

  const statusColor =
    channel.status === "connected" && location.fix
      ? c.success
      : channel.status === "error"
        ? c.danger
        : c.warning;

  const upcoming =
    nav.route && nav.progress
      ? (nav.route.maneuvers[nav.progress.upcomingIndex] ?? null)
      : null;
  const following =
    nav.route && nav.progress
      ? (nav.route.maneuvers[nav.progress.upcomingIndex + 1] ?? null)
      : null;

  return (
    <View style={styles.root}>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={mapStyles[styleName]}
        onRegionDidChange={onRegionChange}
        onLongPress={onLongPress}
        logo={false}
        attribution
        attributionPosition={{ bottom: 6, left: 6 }}
        compass
        // Kept on the left: the right edge is a column of controls, and the
        // compass used to land on top of the follow button.
        compassPosition={{ top: insets.top + (navigating ? 168 : 112), left: 12 }}
        compassHiddenFacingNorth
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ center: [90.4125, 23.8103], zoom: 11 }}
        />

        {/* Unselected alternatives, drawn underneath and muted so the chosen
            one stays obvious. Only shown while choosing. */}
        {choosing && nav.routes.length > 1
          ? nav.routes.map((r, i) =>
              i === nav.selectedIndex || r.shape.length < 2 ? null : (
                <GeoJSONSource
                  key={`alt-${i}`}
                  id={`cruzo-route-alt-${i}`}
                  data={{
                    type: "Feature",
                    properties: {},
                    geometry: { type: "LineString", coordinates: r.shape },
                  }}
                >
                  <Layer
                    id={`cruzo-route-alt-casing-${i}`}
                    type="line"
                    layout={{ "line-cap": "round", "line-join": "round" }}
                    paint={{
                      "line-color": "#FFFFFF",
                      "line-width": 11,
                      "line-opacity": 0.9,
                    }}
                  />
                  <Layer
                    id={`cruzo-route-alt-line-${i}`}
                    type="line"
                    layout={{ "line-cap": "round", "line-join": "round" }}
                    paint={{
                      "line-color": "#8B96A5",
                      "line-width": 6,
                    }}
                  />
                </GeoJSONSource>
              ),
            )
          : null}

        {routeLines ? (
          <>
            {routeLines.travelled && routeLines.travelled.length > 1 ? (
              <GeoJSONSource
                id="cruzo-route-travelled"
                data={{
                  type: "Feature",
                  properties: {},
                  geometry: { type: "LineString", coordinates: routeLines.travelled },
                }}
              >
                <Layer
                  id="cruzo-route-travelled-line"
                  type="line"
                  layout={{ "line-cap": "round", "line-join": "round" }}
                  paint={{
                    "line-color": "#7A8797",
                    "line-width": 7,
                    "line-opacity": 0.5,
                  }}
                />
              </GeoJSONSource>
            ) : null}

            {routeLines.ahead.length > 1 ? (
              <GeoJSONSource
                id="cruzo-route-ahead"
                data={{
                  type: "Feature",
                  properties: {},
                  geometry: { type: "LineString", coordinates: routeLines.ahead },
                }}
              >
                {/* Dark casing first, so the bright line reads on any basemap. */}
                <Layer
                  id="cruzo-route-casing"
                  type="line"
                  layout={{ "line-cap": "round", "line-join": "round" }}
                  paint={{
                    "line-color": "#0B0E13",
                    "line-width": 13,
                    "line-opacity": 0.85,
                  }}
                />
                <Layer
                  id="cruzo-route-line"
                  type="line"
                  layout={{ "line-cap": "round", "line-join": "round" }}
                  paint={{ "line-color": "#FF5C1A", "line-width": 7 }}
                />
              </GeoJSONSource>
            ) : null}
          </>
        ) : null}

        {/* Every stop on the trip. Intermediate ones are numbered so the order
            is readable straight off the map. */}
        {nav.stops.map((s, i) => {
          const last = i === nav.stops.length - 1;
          return (
            <Marker key={`stop-${i}-${s.label}`} lngLat={s.lngLat} anchor="bottom">
              <View style={styles.destPin} pointerEvents="none">
                <View style={[styles.destPinHead, !last && styles.destPinHeadVia]}>
                  <Text style={styles.destPinGlyph}>{last ? "◉" : String(i + 1)}</Text>
                </View>
                <View style={styles.destPinStem} />
              </View>
            </Marker>
          );
        })}

        {/* Where the group is heading, when this rider is not going there yet:
            a flag in the leader's colour, so "where is everyone going?" is
            answered by the map itself. */}
        {groupTrip && !onGroupTrip ? (
          <Marker
            key={`group-${groupTrip.key}`}
            lngLat={groupTrip.stops[groupTrip.stops.length - 1].lngLat}
            anchor="bottom"
          >
            <View style={styles.destPin} pointerEvents="none">
              <Text style={styles.groupPinLabel} numberOfLines={1}>
                {groupTrip.stops[groupTrip.stops.length - 1].label}
              </Text>
              <View
                style={[
                  styles.destPinHead,
                  styles.groupPinHead,
                  { borderColor: colorForRider(groupTrip.leader.id) },
                ]}
              >
                <Text
                  style={[styles.groupPinGlyph, { color: colorForRider(groupTrip.leader.id) }]}
                >
                  ⚑
                </Text>
              </View>
              <View style={styles.destPinStem} />
            </View>
          </Marker>
        ) : null}

        {/* Own marker, drawn from the snapped position and the live compass. */}
        {!selfInRoster && displayPosition ? (
          <Marker lngLat={displayPosition} anchor="center">
            <RiderMarker
              initials={initialsOf(rider?.name || "Me")}
              name="You"
              color={colorForRider(rider?.id ?? "me")}
              heading={location.heading}
              isSelf
              isHost={isHost}
              isStale={false}
              isSos={sosActive}
              isNavigating={navigating}
            />
          </Marker>
        ) : null}

        {riders.map((entry) => {
          const isSelf = entry.id === rider?.id;
          const at: [number, number] =
            isSelf && displayPosition ? displayPosition : [entry.lng, entry.lat];

          return (
            <Marker key={entry.id} lngLat={at} anchor="center">
              <RiderMarker
                initials={initialsOf(entry.name)}
                name={entry.name || "Rider"}
                color={colorForRider(entry.id)}
                heading={isSelf ? location.heading : entry.heading}
                isSelf={isSelf}
                isHost={entry.isHost}
                isStale={now - entry.updatedAt > STALE_AFTER_MS}
                isSos={entry.sos}
                isNavigating={entry.navigating}
              />
            </Marker>
          );
        })}
      </Map>

      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        {alert ? (
          <SosAlarm
            name={alert.name || "A rider"}
            distanceM={
              displayPosition
                ? distanceMeters(displayPosition, [alert.lng, alert.lat])
                : null
            }
            bearing={
              displayPosition
                ? compassPoint(bearingDegrees(displayPosition, [alert.lng, alert.lat]))
                : null
            }
            onShow={() => {
              setFollowMode("free");
              cameraRef.current?.flyTo({
                center: [alert.lng, alert.lat],
                zoom: FOLLOW_ZOOM,
                duration: 700,
              });
            }}
            onDismiss={() => setSilenced((current) => [...current, alert.id])}
          />
        ) : navigating ? (
          <ManeuverBanner
            maneuver={upcoming}
            distanceM={nav.progress?.distanceToManeuverM ?? 0}
            thenInstruction={following?.instruction ?? null}
            rerouting={nav.status === "rerouting"}
            arrived={nav.status === "arrived"}
          />
        ) : (
          <View style={styles.headerCard}>
            <View style={styles.headerMain}>
              <Text style={styles.rideName} numberOfLines={1}>
                {party?.name ?? "Group ride"}
              </Text>
              <View style={styles.statusLine}>
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <Text style={styles.statusText}>{statusLabel}</Text>
                {/* The code is the only way anyone joins, so it doubles as the
                    share button rather than hiding that on another screen. */}
                <Pressable
                  onPress={() => void shareInvite()}
                  accessibilityRole="button"
                  accessibilityLabel={`Ride code ${code.split("").join(" ")}. Tap to share.`}
                  hitSlop={8}
                >
                  <Text style={styles.codeChip}>{code} ↗</Text>
                </Pressable>
              </View>
            </View>

            <Pressable
              onPress={leave}
              accessibilityRole="button"
              accessibilityLabel={isHost ? "End or leave this ride" : "Leave this ride"}
              style={({ pressed }) => [styles.leave, pressed && styles.leavePressed]}
            >
              <Text style={styles.leaveText}>{isHost ? "End" : "Leave"}</Text>
            </Pressable>
          </View>
        )}
      </View>

      <View style={[styles.controls, { top: insets.top + (navigating ? 168 : 112) }]}>
        <ControlButton
          label="◎"
          active={followMode === "follow"}
          onPress={recenter}
          accessibilityLabel="Follow my position"
          palette={c}
        />
        <ControlButton
          label="⤢"
          active={followMode === "overview"}
          onPress={showEveryone}
          accessibilityLabel="Fit every rider on screen"
          palette={c}
        />
        <ControlButton
          label={mapStyleLabels[styleName]}
          small
          onPress={cycleStyle}
          accessibilityLabel={`Map style ${mapStyleLabels[styleName]}. Tap to change.`}
          palette={c}
        />
        {/* Out of a call this joins one; in a call it is the quick mute, which
            is what a rider reaches for mid-ride far more than hanging up. */}
        <ControlButton
          label={inCall ? (voice.muted ? "Muted" : "Mute") : "Voice"}
          small
          active={inCall && !voice.muted}
          badge={inCall ? 0 : othersInCall}
          onPress={() => (inCall ? voice.toggleMute() : void voice.join())}
          accessibilityLabel={
            inCall
              ? voice.muted
                ? "Unmute your microphone"
                : "Mute your microphone"
              : othersInCall > 0
                ? `Join the voice call, ${othersInCall} talking`
                : "Start a voice call"
          }
          palette={c}
        />
        <ControlButton
          label="Chat"
          small
          active={chatOpen}
          badge={chat.unread}
          onPress={() => setChatOpen(true)}
          accessibilityLabel={
            chat.unread > 0
              ? `Open ride chat, ${chat.unread} unread`
              : "Open ride chat"
          }
          palette={c}
        />

        {/* Kept with the other controls so it is always in the same place,
            rather than appearing only in some states. */}
        <Pressable
          onPress={raiseSos}
          accessibilityRole="button"
          accessibilityLabel={
            sosActive ? "Cancel your SOS" : "Send an SOS to the party"
          }
          style={({ pressed }) => [
            styles.control,
            styles.sosButton,
            sosActive && styles.sosButtonActive,
            pressed && styles.controlPressed,
          ]}
        >
          <Text style={[styles.sosButtonText, sosActive && styles.sosButtonTextActive]}>
            {sosActive ? "✕" : "SOS"}
          </Text>
        </Pressable>
      </View>

      {toast && !chatOpen ? (
        <ChatToast
          message={toast}
          color={colorForRider(toast.from)}
          top={insets.top + (navigating ? 168 : 112)}
          onOpen={() => setChatOpen(true)}
        />
      ) : null}

      {nav.status === "routing" ? (
        <Banner text="Building your route…" bottomOffset={insets.bottom} palette={c} />
      ) : nav.status === "error" && nav.error ? (
        <Banner
          text={nav.error}
          actionLabel="Retry"
          onAction={nav.recalculate}
          bottomOffset={insets.bottom}
          palette={c}
          warn
        />
      ) : location.permission === "denied" ? (
        <Banner
          text="Location permission is off, so other riders cannot see you."
          actionLabel="Retry"
          onAction={location.retry}
          bottomOffset={insets.bottom}
          palette={c}
          warn
        />
      ) : location.servicesDisabled ? (
        <Banner
          text="Turn on location services to share your position."
          actionLabel="Retry"
          onAction={location.retry}
          bottomOffset={insets.bottom}
          palette={c}
          warn
        />
      ) : null}

      {navigating && location.fix ? (
        <View style={[styles.speedPill, { bottom: insets.bottom + 188 }]} pointerEvents="none">
          <Text style={styles.speedValue}>{formatSpeed(location.fix.speed)}</Text>
          <Text style={styles.speedUnit}>km/h</Text>
        </View>
      ) : null}

      <View style={[styles.bottom, { paddingBottom: insets.bottom }]}>
        {/* Riding alone is almost always "nobody has joined yet" rather than a
            deliberate choice, so the fix is offered right where it is noticed
            instead of leaving an empty rider list to explain itself. */}
        {riders.length <= 1 && !navigating && !choosing ? (
          <Pressable
            onPress={() => void shareInvite()}
            accessibilityRole="button"
            accessibilityLabel="Share the ride code to invite riders"
            style={({ pressed }) => [styles.invite, pressed && styles.pressed]}
          >
            <View style={styles.inviteBody}>
              <Text style={styles.inviteTitle}>Nobody else has joined yet</Text>
              <Text style={styles.inviteSub}>
                Send the code {code} to your group
              </Text>
            </View>
            <Text style={styles.inviteAction}>Share</Text>
          </Pressable>
        ) : null}

        {voice.state !== "idle" || othersInCall > 0 || voice.error ? (
          <VoiceBar
            selfId={rider?.id ?? ""}
            members={voice.members}
            inCall={inCall}
            joining={voice.state === "joining"}
            muted={voice.muted}
            speaking={voice.speaking}
            linked={voice.linked}
            relayed={voice.relayed}
            error={voice.error}
            colorFor={colorForRider}
            onJoin={() => void voice.join()}
            onLeave={voice.leave}
            onToggleMute={voice.toggleMute}
          />
        ) : null}

        {suggestion ? (
          <GroupTripCard
            leaderName={suggestion.leader.name || "A rider"}
            leaderColor={colorForRider(suggestion.leader.id)}
            leaderIsHost={suggestion.leader.isHost}
            destinationLabel={suggestion.stops[suggestion.stops.length - 1].label}
            viaCount={suggestion.stops.length - 1}
            alsoGoing={suggestion.alsoGoing}
            distanceM={
              displayPosition
                ? distanceMeters(
                    displayPosition,
                    suggestion.stops[suggestion.stops.length - 1].lngLat,
                  )
                : null
            }
            switching={navigating}
            changed={suggestionChanged}
            onAccept={acceptGroupTrip}
            onDismiss={() => setDismissedTrip(suggestion.key)}
          />
        ) : null}

        {choosing ? (
          <RoutePreview
            routes={nav.routes}
            selectedIndex={nav.selectedIndex}
            stops={nav.stops}
            onSelect={nav.selectRoute}
            onAddStop={() => {
              setAddingStop(true);
              setSearchOpen(true);
            }}
            onRemoveStop={nav.removeStop}
            onStart={nav.begin}
            onCancel={nav.stop}
          />
        ) : navigating && nav.progress && nav.stops.length > 0 ? (
          <TripPanel
            remainingM={nav.progress.remainingM}
            remainingS={nav.progress.remainingS}
            destinationLabel={nav.stops[nav.stops.length - 1].label}
            voiceEnabled={nav.voiceEnabled}
            onToggleVoice={() => nav.setVoiceEnabled(!nav.voiceEnabled)}
            onStop={nav.stop}
          />
        ) : (
          <Pressable
            onPress={() => setSearchOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Choose a destination"
            style={({ pressed }) => [styles.searchBar, pressed && styles.pressed]}
          >
            <Text style={styles.searchGlyph}>◎</Text>
            <Text style={styles.searchText}>Where to?</Text>
            <Text style={styles.searchHint}>or hold the map</Text>
          </Pressable>
        )}

        <RiderSheet
          riders={riders}
          selfId={rider?.id ?? ""}
          selfPosition={displayPosition}
          colorFor={colorForRider}
          expanded={sheetExpanded}
          onToggle={() => setSheetExpanded((value) => !value)}
          onFocusRider={focusRider}
          now={now}
        />
      </View>

      <DestinationSearch
        visible={searchOpen}
        near={displayPosition}
        onClose={() => setSearchOpen(false)}
        onPick={(place) => pickDestination({ lngLat: place.lngLat, label: place.name })}
        riderOptions={riderOptions}
      />

      <ChatSheet
        visible={chatOpen}
        messages={chat.messages}
        selfId={rider?.id ?? ""}
        colorFor={colorForRider}
        onSend={chat.send}
        onClose={() => setChatOpen(false)}
      />
    </View>
  );
}

function ControlButton({
  label,
  onPress,
  active = false,
  small = false,
  badge = 0,
  accessibilityLabel,
  palette,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  small?: boolean;
  /** Count shown in a corner dot, e.g. unread messages. Hidden at zero. */
  badge?: number;
  accessibilityLabel: string;
  palette: Palette;
}) {
  const styles = useMemo(() => makeStyles(palette), [palette]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.control,
        active && styles.controlActive,
        pressed && styles.controlPressed,
      ]}
    >
      <Text
        style={[
          styles.controlText,
          small && styles.controlTextSmall,
          active && styles.controlTextActive,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {badge > 0 ? (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText}>{badge > 9 ? "9+" : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function Banner({
  text,
  actionLabel,
  onAction,
  bottomOffset,
  palette,
  warn = false,
}: {
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  bottomOffset: number;
  palette: Palette;
  warn?: boolean;
}) {
  const styles = useMemo(() => makeStyles(palette), [palette]);

  return (
    <View
      style={[
        styles.banner,
        { bottom: bottomOffset + 170 },
        warn && { borderColor: palette.warning },
      ]}
    >
      <Text style={styles.bannerText}>{text}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.bannerAction}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },

    header: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      paddingHorizontal: space.md,
    },
    headerCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.md,
      backgroundColor: c.scrim,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.lg,
      paddingVertical: space.md,
      paddingHorizontal: space.lg,
      elevation: 4,
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    headerMain: { flex: 1, gap: 3 },
    rideName: { color: c.text, fontSize: 17, fontWeight: "800" },
    statusLine: { flexDirection: "row", alignItems: "center", gap: space.sm },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    statusText: { color: c.textDim, fontSize: 12, fontWeight: "600" },
    codeChip: {
      color: c.accent,
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 2,
      fontFamily: font.mono,
    },
    leave: {
      paddingHorizontal: space.lg,
      paddingVertical: space.sm + 2,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.danger,
    },
    leavePressed: { backgroundColor: "rgba(198, 40, 40, 0.15)" },
    leaveText: { color: c.danger, fontWeight: "800", fontSize: 13 },

    controls: { position: "absolute", right: space.md, gap: space.sm },
    control: {
      width: 46,
      height: 46,
      borderRadius: radius.md,
      backgroundColor: c.scrim,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 2,
      elevation: 3,
      shadowColor: "#000",
      shadowOpacity: 0.15,
      shadowRadius: 5,
      shadowOffset: { width: 0, height: 2 },
    },
    controlActive: { borderColor: c.accent, backgroundColor: c.accentWash },
    badge: {
      position: "absolute",
      top: -6,
      right: -6,
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: 4,
      backgroundColor: c.accent,
      borderWidth: 2,
      borderColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeText: { color: c.onAccent, fontSize: 10, fontWeight: "900" },
    controlPressed: { opacity: 0.7 },

    sosButton: { borderColor: "#D32029", borderWidth: 2 },
    sosButtonActive: { backgroundColor: "#D32029" },
    sosButtonText: { color: "#D32029", fontSize: 13, fontWeight: "900" },
    sosButtonTextActive: { color: "#FFFFFF", fontSize: 18 },

    invite: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.md,
      marginHorizontal: space.md,
      marginBottom: space.sm,
      backgroundColor: c.accentWash,
      borderWidth: 1,
      borderColor: c.accentDim,
      borderRadius: radius.md,
      paddingVertical: space.md,
      paddingHorizontal: space.lg,
    },
    inviteBody: { flex: 1, gap: 2 },
    inviteTitle: { color: c.text, fontSize: 14, fontWeight: "800" },
    inviteSub: { color: c.textDim, fontSize: 12 },
    inviteAction: { color: c.accent, fontSize: 14, fontWeight: "900" },
    controlText: { color: c.text, fontSize: 20, fontWeight: "700" },
    controlTextSmall: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
    controlTextActive: { color: c.accent },

    destPin: { alignItems: "center" },
    destPinHead: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: "#FF5C1A",
      borderWidth: 3,
      borderColor: "#FFFFFF",
      alignItems: "center",
      justifyContent: "center",
      elevation: 6,
    },
    destPinHeadVia: { backgroundColor: "#FFFFFF", borderColor: "#FF5C1A" },
    groupPinHead: { backgroundColor: "#FFFFFF" },
    groupPinGlyph: { fontSize: 16, fontWeight: "900" },
    groupPinLabel: {
      maxWidth: 160,
      color: "#0C1420",
      backgroundColor: "rgba(255,255,255,0.94)",
      fontSize: 11,
      fontWeight: "800",
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      overflow: "hidden",
      marginBottom: 3,
    },
    destPinGlyph: { color: "#1A0A02", fontSize: 15, fontWeight: "900" },
    destPinStem: {
      width: 3,
      height: 12,
      backgroundColor: "#FFFFFF",
      marginTop: -2,
      borderRadius: 2,
    },

    banner: {
      position: "absolute",
      left: space.md,
      right: space.md,
      flexDirection: "row",
      alignItems: "center",
      gap: space.md,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingVertical: space.md,
      paddingHorizontal: space.lg,
      elevation: 3,
    },
    bannerText: { flex: 1, color: c.text, fontSize: 13, lineHeight: 18 },
    bannerAction: { color: c.accent, fontWeight: "800", fontSize: 13 },

    speedPill: {
      position: "absolute",
      left: space.md,
      width: 74,
      height: 74,
      borderRadius: 37,
      backgroundColor: c.scrim,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
      elevation: 3,
    },
    speedValue: { color: c.text, fontSize: 26, fontWeight: "900" },
    speedUnit: { color: c.textFaint, fontSize: 10, marginTop: -3 },

    bottom: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: c.surface,
    },
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.md,
      marginHorizontal: space.md,
      marginBottom: space.sm,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.pill,
      paddingVertical: space.md,
      paddingHorizontal: space.lg,
    },
    pressed: { opacity: 0.75 },
    searchGlyph: { color: c.accent, fontSize: 16 },
    searchText: { flex: 1, color: c.text, fontSize: 15, fontWeight: "700" },
    searchHint: { color: c.textFaint, fontSize: 11 },

    errorRoot: {
      flex: 1,
      backgroundColor: c.bg,
      paddingHorizontal: space.xl,
      gap: space.md,
    },
    errorTitle: { color: c.text, fontSize: 24, fontWeight: "800" },
    errorBody: { color: c.textDim, fontSize: 15, lineHeight: 22 },
    errorButton: {
      marginTop: space.lg,
      backgroundColor: c.accent,
      borderRadius: radius.lg,
      paddingVertical: space.lg,
      alignItems: "center",
    },
    errorButtonText: { color: c.onAccent, fontWeight: "800", fontSize: 16 },
  });

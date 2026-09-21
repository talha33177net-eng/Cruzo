import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "../lib/supabase";
import type { ConnectionStatus, Destination, Fix, RiderState } from "../lib/types";

type Profile = {
  id: string;
  name: string;
  bike: string;
  isHost: boolean;
  sos: boolean;
  navigating: boolean;
  trip: Destination[] | null;
};

export type RideChannel = {
  status: ConnectionStatus;
  riders: RiderState[];
  error: string | null;
  publish: (fix: Fix) => void;
  /**
   * Re-sends this rider's state without waiting for the next GPS fix.
   *
   * Raising an SOS must reach the party now, not in three seconds.
   */
  republish: () => void;
  /**
   * Bumped when someone announces the ride is over.
   *
   * Only a hint: anyone in the channel can send it, so the ride screen checks
   * the party is really gone before acting on it.
   */
  endedSignal: number;
  /** Tells everyone in the party the ride is over. Host only. */
  announceEnd: () => Promise<void>;
};

type PresenceEntry = RiderState & { presence_ref: string };

/**
 * Joins the realtime channel for a party and keeps the rider roster in sync.
 *
 * Positions ride on Supabase Presence rather than database rows: presence is
 * ephemeral, costs no storage, and the server drops a rider automatically when
 * their connection goes away — which is exactly the semantics we want when a
 * bike rides out of coverage. Nothing about a ride is ever persisted.
 */
export function useRideChannel(
  code: string,
  profile: Profile,
  enabled: boolean,
): RideChannel {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [riders, setRiders] = useState<RiderState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [endedSignal, setEndedSignal] = useState(0);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastFixRef = useRef<Fix | null>(null);

  // Read inside `publish` so a name change never re-creates the channel.
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const sendTrack = useCallback((fix: Fix) => {
    const channel = channelRef.current;
    if (!channel) return;

    const { id, name, bike, isHost, sos, navigating, trip } = profileRef.current;
    const payload: RiderState = {
      id,
      name,
      bike,
      isHost,
      sos,
      navigating,
      trip: navigating ? trip : null,
      lng: fix.lngLat[0],
      lat: fix.lngLat[1],
      heading: fix.heading,
      speed: fix.speed,
      accuracy: fix.accuracy,
      updatedAt: Date.now(),
    };

    void channel.track(payload);
  }, []);

  const publish = useCallback(
    (fix: Fix) => {
      lastFixRef.current = fix;
      sendTrack(fix);
    },
    [sendTrack],
  );

  useEffect(() => {
    if (!enabled || !code) return;

    setStatus("connecting");
    setError(null);

    const channel = supabase.channel(`ride:${code}`, {
      config: {
        // `enabled` is what lets this client *receive* the roster; without it
        // presence events never fire and we would only ever see ourselves.
        presence: { key: profile.id, enabled: true },
      },
    });
    channelRef.current = channel;

    const syncRoster = () => {
      const state = channel.presenceState<PresenceEntry>();
      const next = Object.values(state)
        .map((entries) => entries[entries.length - 1])
        .filter((entry): entry is PresenceEntry => Boolean(entry?.id));
      setRiders(next);
    };

    channel
      .on("presence", { event: "sync" }, syncRoster)
      .on("presence", { event: "join" }, syncRoster)
      .on("presence", { event: "leave" }, syncRoster)
      .on("broadcast", { event: "ended" }, () => setEndedSignal((n) => n + 1))
      .subscribe((subscribeStatus, err) => {
        if (subscribeStatus === "SUBSCRIBED") {
          setStatus("connected");
          setError(null);
          // Re-announce immediately so a reconnect does not leave this rider
          // invisible until their next GPS fix arrives.
          if (lastFixRef.current) sendTrack(lastFixRef.current);
          return;
        }

        if (subscribeStatus === "CHANNEL_ERROR" || subscribeStatus === "TIMED_OUT") {
          setStatus("error");
          setError(err?.message ?? "Lost contact with the party.");
          return;
        }

        if (subscribeStatus === "CLOSED") {
          setStatus("reconnecting");
        }
      });

    return () => {
      channelRef.current = null;
      void channel.untrack();
      void supabase.removeChannel(channel);
      setRiders([]);
      setStatus("idle");
    };
  }, [code, profile.id, enabled, sendTrack]);

  const republish = useCallback(() => {
    if (lastFixRef.current) sendTrack(lastFixRef.current);
  }, [sendTrack]);

  const announceEnd = useCallback(async () => {
    const channel = channelRef.current;
    if (!channel) return;
    await channel.send({ type: "broadcast", event: "ended", payload: {} });
  }, []);

  return { status, riders, error, publish, republish, endedSignal, announceEnd };
}

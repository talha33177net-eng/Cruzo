import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "cruzo.recentRides";

/** How many rides are remembered, newest first. */
const MAX_RIDES = 3;

/**
 * How long a ride stays worth offering. A party idle for 10 minutes is closed
 * by the server anyway; this only stops a long-dead code being looked up.
 */
const REMEMBER_MS = 12 * 60 * 60 * 1000;

/**
 * A ride this phone was in, so it can be rejoined with one tap.
 *
 * Only the code and a label: positions and chat are never stored, and this is
 * not a history — it forgets rides after half a day, and a ride found to be
 * over is removed on sight.
 */
export type RecentRide = {
  code: string;
  hostName: string;
  lastSeenAt: number;
};

export async function loadRecentRides(now = Date.now()): Promise<RecentRide[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r): r is RecentRide =>
          typeof r?.code === "string" &&
          typeof r?.hostName === "string" &&
          typeof r?.lastSeenAt === "number" &&
          now - r.lastSeenAt < REMEMBER_MS,
      )
      .slice(0, MAX_RIDES);
  } catch {
    return [];
  }
}

async function save(rides: RecentRide[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(rides.slice(0, MAX_RIDES)));
  } catch {
    // Losing the shortcut is harmless; the code still works by hand.
  }
}

/** Records (or refreshes) a ride this rider is in. */
export async function rememberRide(code: string, hostName: string): Promise<void> {
  const rides = await loadRecentRides();
  await save([
    { code, hostName, lastSeenAt: Date.now() },
    ...rides.filter((r) => r.code !== code),
  ]);
}

export async function forgetRide(code: string): Promise<void> {
  const rides = await loadRecentRides();
  await save(rides.filter((r) => r.code !== code));
}

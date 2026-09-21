import AsyncStorage from "@react-native-async-storage/async-storage";

import { generateRideCode } from "./rideCode";
import { supabase } from "./supabase";

/** Every column the `anon` role is allowed to read (see `supabase/schema.sql`). */
const PUBLIC_COLUMNS = "code, host_id, host_name";

export type Party = {
  code: string;
  /** Derived, not stored: every party is simply "<host>'s ride". */
  name: string;
  hostId: string;
  hostName: string;
};

type PartyRow = {
  code: string;
  host_id: string;
  host_name: string;
};

function toParty(row: PartyRow): Party {
  return {
    code: row.code,
    name: `${row.host_name}'s ride`,
    hostId: row.host_id,
    hostName: row.host_name,
  };
}

const secretKey = (code: string) => `cruzo.host.${code}`;

/**
 * The host's proof that they opened a party.
 *
 * It is written once at creation and never leaves the device, because the
 * column is excluded from the anon SELECT grant. Ending a ride is therefore
 * something only the hosting phone can do, rather than something any client
 * could do by sending a different `host_id`.
 */
function createHostSecret(): string {
  const chunk = () => Math.random().toString(36).slice(2, 12);
  return `${chunk()}${chunk()}${chunk()}`;
}

export async function loadHostSecret(code: string): Promise<string | null> {
  return AsyncStorage.getItem(secretKey(code));
}

/**
 * A party that has ended, or that everyone left, is deleted rather than kept
 * with a flag — so "not found" covers all three, and the lookup cannot tell
 * them apart.
 */
export type LookupResult =
  | { status: "ok"; party: Party }
  | { status: "not_found" }
  | { status: "error"; message: string };

export async function findParty(code: string): Promise<LookupResult> {
  const { data, error } = await supabase
    .from("parties")
    .select(PUBLIC_COLUMNS)
    .eq("code", code)
    .maybeSingle();

  if (error) return { status: "error", message: error.message };
  if (!data) return { status: "not_found" };
  return { status: "ok", party: toParty(data as PartyRow) };
}

export type CreateResult =
  | { status: "ok"; party: Party }
  | { status: "error"; message: string };

/**
 * Opens a party under a freshly generated code.
 *
 * `code` is the primary key, so colliding with a live party surfaces as a
 * unique violation (23505) rather than silently merging two groups onto one
 * map. We roll a new code and retry.
 */
export async function createParty(
  hostId: string,
  hostName: string,
): Promise<CreateResult> {
  const MAX_ATTEMPTS = 5;
  const secret = createHostSecret();

  // Named after the host rather than typed in: asking someone to invent a name
  // for a ride they are about to start earns nothing, because everyone joining
  // already knows whose ride it is.
  const host = hostName.trim() || "Host";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const code = generateRideCode();

    const { data, error } = await supabase
      .from("parties")
      .insert({
        code,
        host_id: hostId,
        host_name: host,
        host_secret: secret,
      })
      .select(PUBLIC_COLUMNS)
      .single();

    if (!error && data) {
      // Persist before returning: without the secret the host could never
      // close their own party.
      await AsyncStorage.setItem(secretKey(code), secret);
      return { status: "ok", party: toParty(data as PartyRow) };
    }

    if (error && error.code !== "23505") {
      return { status: "error", message: error.message };
    }
  }

  return {
    status: "error",
    message: "Could not allocate a free ride code. Please try again.",
  };
}

/**
 * Tells the server someone is still in this party.
 *
 * Without it the party is deleted after 10 minutes of silence, which is how a
 * ride everyone has left closes itself. Also sweeps away other abandoned
 * parties, so the table never holds more than the rides under way.
 *
 * Returns false once the party is gone. Riders already in it can carry on —
 * the live map runs on Realtime, not on this row — but nobody new can join.
 */
export async function touchParty(code: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("touch_party", { p_code: code });
  if (error) return true; // a network blip is not evidence the party is gone
  return data === true;
}

/**
 * Ends a party by deleting it.
 *
 * Authorisation happens inside the `end_party` database function, which
 * compares the stored secret. A device without the secret cannot close
 * someone else's ride, and the call simply returns false. The secret itself
 * is forgotten too, since the party it proved is gone.
 */
export async function endParty(code: string): Promise<boolean> {
  const secret = await loadHostSecret(code);
  if (!secret) return false;

  const { data, error } = await supabase.rpc("end_party", {
    p_code: code,
    p_secret: secret,
  });

  if (error) return false;
  if (data === true) await AsyncStorage.removeItem(secretKey(code));
  return data === true;
}

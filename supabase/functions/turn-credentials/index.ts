// Cruzo — relay (TURN) credentials for voice calls.
//
// Voice audio goes phone to phone. When a mobile carrier blocks that direct
// path, the audio has to be relayed through a TURN server. No relay address
// or password ships inside the app: the app asks this function, which hands
// them only to riders in a live party.
//
// Two free providers are supported; configure one (or both, and phones try
// every server offered):
//
//   Static credentials — e.g. ExpressTURN's free plan, 1,000 GB a month, no
//   payment method. The password never expires, which is why it is kept here
//   rather than in the app: if it leaks, change it in the provider's dashboard
//   and update the secret, with no app release needed.
//     TURN_URLS      comma-separated, e.g. turn:relay1.expressturn.com:3478
//     TURN_USERNAME
//     TURN_PASSWORD
//
//   Cloudflare — short-lived credentials minted per call (free to 1,000 GB a
//   month, but Cloudflare asks for a payment method).
//     CLOUDFLARE_TURN_KEY_ID
//     CLOUDFLARE_TURN_API_TOKEN
//
// Deploy:  npx supabase functions deploy turn-credentials --no-verify-jwt
//
// `--no-verify-jwt` is required: Cruzo has no sign-in, and the project's
// `sb_publishable_` key is not a JWT, so the default check would refuse every
// call. The party check below is what gates access instead.

const STATIC_URLS = (Deno.env.get("TURN_URLS") ?? "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
const STATIC_USERNAME = Deno.env.get("TURN_USERNAME") ?? "";
const STATIC_PASSWORD = Deno.env.get("TURN_PASSWORD") ?? "";

const CF_KEY_ID = Deno.env.get("CLOUDFLARE_TURN_KEY_ID") ?? "";
const CF_API_TOKEN = Deno.env.get("CLOUDFLARE_TURN_API_TOKEN") ?? "";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

/** Long enough for a full day's ride; a call outliving it rejoins for fresh ones. */
const TTL_SECONDS = 12 * 60 * 60;

/** Same alphabet as `src/lib/rideCode.ts`. */
const RIDE_CODE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/;

type IceServer = { urls: string | string[]; username?: string; credential?: string };

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function cloudflareServers(): Promise<IceServer[]> {
  if (!CF_KEY_ID || !CF_API_TOKEN) return [];
  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${CF_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
    },
  ).catch(() => null);
  if (!res?.ok) return [];
  const body = await res.json().catch(() => null);
  return Array.isArray(body?.iceServers) ? body.iceServers : [];
}

function staticServers(): IceServer[] {
  if (STATIC_URLS.length === 0 || !STATIC_USERNAME || !STATIC_PASSWORD) return [];
  return [{ urls: STATIC_URLS, username: STATIC_USERNAME, credential: STATIC_PASSWORD }];
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405, { error: "POST only" });

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code : "";
  if (!RIDE_CODE.test(code)) return reply(400, { error: "Invalid ride code" });

  // Looked up with the caller's own publishable key, so the row-level security
  // that hides ended and abandoned parties from the app applies here too.
  const apikey = req.headers.get("apikey") ?? "";
  const party = await fetch(
    `${SUPABASE_URL}/rest/v1/parties?select=code&code=eq.${code}`,
    { headers: { apikey } },
  );
  if (!party.ok) return reply(401, { error: "Could not verify the party" });
  const rows = await party.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return reply(404, { error: "No live party with that code" });
  }

  const iceServers = [...staticServers(), ...(await cloudflareServers())];
  if (iceServers.length === 0) return reply(503, { error: "No relay is configured" });

  return reply(200, { iceServers });
});

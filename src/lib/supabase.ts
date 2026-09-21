import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

import { isBackendConfigured, supabaseAnonKey, supabaseUrl } from "./config";

/**
 * Cruzo does not sign users in — a rider is identified by a device-local id
 * (see `identity.ts`). The client therefore disables session handling but
 * still wires up AsyncStorage so a future auth upgrade is a one-line change.
 *
 * Only the party lobby and live positions go through here. The map, routing,
 * search and voice guidance need no backend at all.
 */
export const supabase = createClient(
  isBackendConfigured ? supabaseUrl : "https://placeholder.supabase.co",
  isBackendConfigured ? supabaseAnonKey : "placeholder-key",
  {
    auth: {
      storage: AsyncStorage,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: {
      // Comfortably above our ~1 message every 3 seconds per rider.
      params: { eventsPerSecond: 20 },
    },
  },
);

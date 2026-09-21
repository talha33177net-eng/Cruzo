import AsyncStorage from "@react-native-async-storage/async-storage";

const ID_KEY = "cruzo.rider.id";
const NAME_KEY = "cruzo.rider.name";
/** Where older builds kept a bike name; cleared on the next save. */
const LEGACY_BIKE_KEY = "cruzo.rider.bike";

export type RiderIdentity = {
  id: string;
  name: string;
};

/**
 * Cruzo has no accounts. A rider is whoever holds this device-local id, which
 * is enough to tell markers apart inside a party and keeps the app free of
 * signup friction. It is a random handle, not a secret, so `Math.random` is an
 * appropriate source here.
 */
function createRiderId(): string {
  const random = () => Math.random().toString(36).slice(2, 10);
  return `r_${Date.now().toString(36)}${random()}${random()}`;
}

export async function loadIdentity(): Promise<RiderIdentity> {
  const [[, storedId], [, storedName]] = await AsyncStorage.multiGet([ID_KEY, NAME_KEY]);

  let id = storedId;
  if (!id) {
    id = createRiderId();
    await AsyncStorage.setItem(ID_KEY, id);
  }

  return {
    id,
    name: storedName ?? "",
  };
}

export async function saveRiderProfile(name: string): Promise<void> {
  await AsyncStorage.setItem(NAME_KEY, name.trim());
  await AsyncStorage.removeItem(LEGACY_BIKE_KEY);
}

/** Two-character badge drawn inside a rider's map marker. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

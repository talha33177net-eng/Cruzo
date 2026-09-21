import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { loadIdentity, type RiderIdentity, saveRiderProfile } from "../lib/identity";

type RiderContextValue = {
  rider: RiderIdentity | null;
  ready: boolean;
  updateProfile: (name: string, bike: string) => Promise<void>;
};

const RiderContext = createContext<RiderContextValue | null>(null);

/** Loads the device's rider identity once and shares it across all screens. */
export function RiderProvider({ children }: { children: ReactNode }) {
  const [rider, setRider] = useState<RiderIdentity | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void loadIdentity().then((identity) => {
      if (cancelled) return;
      setRider(identity);
      setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const updateProfile = useCallback(async (name: string, bike: string) => {
    await saveRiderProfile(name, bike);
    setRider((current) =>
      current ? { ...current, name: name.trim(), bike: bike.trim() } : current,
    );
  }, []);

  const value = useMemo(
    () => ({ rider, ready, updateProfile }),
    [rider, ready, updateProfile],
  );

  return <RiderContext.Provider value={value}>{children}</RiderContext.Provider>;
}

export function useRider(): RiderContextValue {
  const value = useContext(RiderContext);
  if (!value) throw new Error("useRider must be used inside a RiderProvider");
  return value;
}

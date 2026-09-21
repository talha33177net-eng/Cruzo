import { createContext, type ReactNode, useContext } from "react";

import { darkPalette, lightPalette, type Palette } from "../theme";
import type { MapTheme } from "../lib/mapTheme";

const ChromeContext = createContext<Palette>(darkPalette);

/**
 * Which chrome palette suits each basemap.
 *
 * Tied to the map rather than exposed as a separate setting: a rider switching
 * to the night basemap wants the whole screen to stop glowing, and one control
 * doing both is one less thing to find with gloves on.
 */
export function chromeFor(theme: MapTheme): Palette {
  return theme === "night" ? darkPalette : lightPalette;
}

export function ChromeProvider({
  palette,
  children,
}: {
  palette: Palette;
  children: ReactNode;
}) {
  return <ChromeContext.Provider value={palette}>{children}</ChromeContext.Provider>;
}

/** The palette for anything drawn on top of the map. */
export function useChrome(): Palette {
  return useContext(ChromeContext);
}

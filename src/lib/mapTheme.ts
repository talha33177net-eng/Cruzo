import type {
  ExpressionSpecification,
  LayerSpecification,
  StyleSpecification,
} from "@maplibre/maplibre-gl-style-spec";

/**
 * Cruzo's own basemaps, in the spirit of Google Maps.
 *
 * The stock OpenFreeMap styles are general-purpose cartography: busy, muddy
 * colours, every landuse polygon drawn. A rider glancing at a handlebar needs
 * the opposite — calm land, roads that stand out ranked by size, highways in
 * warm yellow, water and parks in clear colour, and few labels.
 *
 * Only the *styling* is ours. Tiles, fonts and icons still come from
 * OpenFreeMap, free and keyless, exactly as before; a style is just a JSON
 * document describing how to paint them. Layers follow the OpenMapTiles
 * schema that OpenFreeMap serves.
 */

export type MapTheme = "day" | "night";

type Palette = {
  land: string;
  residential: string;
  park: string;
  wood: string;
  grass: string;
  sand: string;
  hospital: string;
  school: string;
  water: string;
  waterLabel: string;
  building: string;
  buildingOutline: string;
  building3d: string;

  motorway: string;
  motorwayCasing: string;
  primary: string;
  primaryCasing: string;
  road: string;
  roadCasing: string;
  minorCasing: string;
  path: string;
  rail: string;
  runway: string;
  boundary: string;

  roadLabel: string;
  roadLabelHalo: string;
  majorRoadLabel: string;
  placeLabel: string;
  minorPlaceLabel: string;
  labelHalo: string;

  poi: {
    food: string;
    shop: string;
    health: string;
    nature: string;
    lodging: string;
    transit: string;
    fuel: string;
    other: string;
  };
  /** The sprite's icons are black; they vanish on a dark map. */
  poiIcons: boolean;
};

const DAY: Palette = {
  land: "#F3F4F6",
  residential: "#ECEEF1",
  park: "#C5E8C5",
  wood: "#CFEACB",
  grass: "#DAF0D5",
  sand: "#F8F1DC",
  hospital: "#FBE3E5",
  school: "#ECE9F6",
  water: "#9FD3F7",
  waterLabel: "#3F7EB5",
  building: "#E6E8EC",
  buildingOutline: "#D7DAE0",
  building3d: "#ECEDF0",

  motorway: "#FCD378",
  motorwayCasing: "#E0A93E",
  primary: "#FFE8A8",
  primaryCasing: "#EBC576",
  road: "#FFFFFF",
  roadCasing: "#D3D6DC",
  minorCasing: "#DDE0E5",
  path: "#C4C8CE",
  rail: "#BEC2C8",
  runway: "#DADCE0",
  boundary: "#9AA0A6",

  roadLabel: "#5F6368",
  roadLabelHalo: "#FFFFFF",
  majorRoadLabel: "#4A4E54",
  placeLabel: "#3C4043",
  minorPlaceLabel: "#70757A",
  labelHalo: "#FFFFFF",

  poi: {
    food: "#D56E0C",
    shop: "#1A73E8",
    health: "#D93025",
    nature: "#188038",
    lodging: "#C5186D",
    transit: "#1967D2",
    fuel: "#1A73E8",
    other: "#70757A",
  },
  poiIcons: true,
};

/** After Google's night palette: blue-grey land, warm roads, low glare. */
const NIGHT: Palette = {
  land: "#1F2733",
  residential: "#222B38",
  park: "#20363A",
  wood: "#21393A",
  grass: "#223834",
  sand: "#2A2E30",
  hospital: "#33262D",
  school: "#282838",
  water: "#0E1C30",
  waterLabel: "#56708F",
  building: "#27303E",
  buildingOutline: "#323C4D",
  building3d: "#2A3341",

  motorway: "#8A7552",
  motorwayCasing: "#2A2A28",
  primary: "#5E5A4D",
  primaryCasing: "#252A33",
  road: "#4A5567",
  roadCasing: "#1B222C",
  minorCasing: "#1D242E",
  path: "#3A4452",
  rail: "#3B4656",
  runway: "#39414E",
  boundary: "#6B7584",

  roadLabel: "#A2ACBA",
  roadLabelHalo: "#1B222C",
  majorRoadLabel: "#F0D6A6",
  placeLabel: "#E0A873",
  minorPlaceLabel: "#9AA3AF",
  labelHalo: "#16202B",

  poi: {
    food: "#F2A45A",
    shop: "#8AB4F8",
    health: "#F28B82",
    nature: "#81C995",
    lodging: "#F48FB1",
    transit: "#8AB4F8",
    fuel: "#8AB4F8",
    other: "#9AA3AF",
  },
  poiIcons: false,
};

/** Colours for Cruzo's own route line, matched to each basemap. */
export const routeColors: Record<
  MapTheme,
  { line: string; casing: string; travelled: string; alt: string; altCasing: string }
> = {
  day: {
    line: "#1A73E8",
    casing: "#1557B0",
    travelled: "#9AA0A6",
    alt: "#A8C7FA",
    altCasing: "#6E9BE0",
  },
  night: {
    line: "#4C8DF6",
    casing: "#0F2F5C",
    travelled: "#5F6773",
    alt: "#3C5B8A",
    altCasing: "#22385A",
  },
};

const SOURCE = "openmaptiles";

/** English where the map has it, then any Latin spelling, then the local name. */
const NAME: ExpressionSpecification = [
  "coalesce",
  ["get", "name_en"],
  ["get", "name:latin"],
  ["get", "name"],
];

const FONT = ["Noto Sans Regular"];
const FONT_BOLD = ["Noto Sans Bold"];
const FONT_ITALIC = ["Noto Sans Italic"];

/**
 * A zoom-scaled line width. `add` widens every stop, which is how a casing is
 * made a fixed amount wider than its road — expressions cannot add to a zoom
 * curve after the fact.
 */
function width(stops: [number, number][], add = 0): ExpressionSpecification {
  return [
    "interpolate",
    ["exponential", 1.5],
    ["zoom"],
    ...stops.flatMap(([z, w]) => [z, w + (w >= 1 ? add : add * w)]),
  ] as ExpressionSpecification;
}

const W_MOTORWAY: [number, number][] = [[5, 0.6], [9, 1.6], [12, 3.5], [14, 7], [16, 12], [18, 26]];
const W_PRIMARY: [number, number][] = [[7, 0.5], [10, 1.4], [12, 3], [14, 6], [16, 11], [18, 22]];
const W_SECONDARY: [number, number][] = [[9, 0.4], [11, 1], [13, 2.6], [14, 4.5], [16, 9], [18, 18]];
const W_MINOR: [number, number][] = [[12, 0.4], [13, 1], [14, 2.6], [16, 6.5], [18, 14]];
const W_SERVICE: [number, number][] = [[14, 0.5], [15, 1.2], [16, 2.6], [18, 7]];

const isLine: ExpressionSpecification = [
  "match",
  ["geometry-type"],
  ["LineString", "MultiLineString"],
  true,
  false,
];

function roadFilter(classes: string[]): ExpressionSpecification {
  return ["all", isLine, ["match", ["get", "class"], classes, true, false]];
}

/** Each road class: which classes, where it starts, how wide, what colours. */
type RoadClass = {
  id: string;
  classes: string[];
  minzoom: number;
  widths: [number, number][];
  fill: (p: Palette) => string;
  casing: (p: Palette) => string;
};

/** Least important first, so bigger roads are painted over smaller ones. */
const ROADS: RoadClass[] = [
  {
    id: "service",
    classes: ["service", "track"],
    minzoom: 14,
    widths: W_SERVICE,
    fill: (p) => p.road,
    casing: (p) => p.minorCasing,
  },
  {
    id: "minor",
    classes: ["minor"],
    minzoom: 12,
    widths: W_MINOR,
    fill: (p) => p.road,
    casing: (p) => p.minorCasing,
  },
  {
    id: "secondary",
    classes: ["secondary", "tertiary"],
    minzoom: 9,
    widths: W_SECONDARY,
    fill: (p) => p.road,
    casing: (p) => p.roadCasing,
  },
  {
    id: "primary",
    classes: ["primary", "trunk"],
    minzoom: 6,
    widths: W_PRIMARY,
    fill: (p) => p.primary,
    casing: (p) => p.primaryCasing,
  },
  {
    id: "motorway",
    classes: ["motorway"],
    minzoom: 5,
    widths: W_MOTORWAY,
    fill: (p) => p.motorway,
    casing: (p) => p.motorwayCasing,
  },
];

/** POI classes grouped the way Google colours them. */
const POI_GROUPS: Record<keyof Palette["poi"], string[]> = {
  food: ["restaurant", "fast_food", "cafe", "bar", "beer", "ice_cream", "bakery", "alcohol_shop"],
  shop: ["shop", "grocery", "clothing_store", "commercial", "gift", "florist", "furniture", "butcher", "laundry", "hairdresser"],
  health: ["hospital", "pharmacy", "doctors", "dentist", "veterinary"],
  nature: ["park", "garden", "campsite", "zoo", "playground", "pitch", "stadium", "golf", "picnic_site"],
  lodging: ["lodging"],
  transit: ["bus", "railway", "airport", "ferry_terminal", "harbor"],
  fuel: ["fuel"],
  other: [],
};

function poiColor(p: Palette): ExpressionSpecification {
  const branches: (string | string[])[] = [];
  for (const [group, classes] of Object.entries(POI_GROUPS)) {
    if (classes.length === 0) continue;
    branches.push(classes, p.poi[group as keyof Palette["poi"]]);
  }
  return ["match", ["get", "class"], ...branches, p.poi.other] as unknown as ExpressionSpecification;
}

function build(p: Palette): StyleSpecification {
  const layers: LayerSpecification[] = [
    { id: "background", type: "background", paint: { "background-color": p.land } },

    // --- land ---------------------------------------------------------------
    {
      id: "residential",
      type: "fill",
      source: SOURCE,
      "source-layer": "landuse",
      minzoom: 10,
      filter: ["match", ["get", "class"], ["residential", "suburb", "neighbourhood"], true, false],
      paint: { "fill-color": p.residential },
    },
    {
      id: "wood",
      type: "fill",
      source: SOURCE,
      "source-layer": "landcover",
      filter: ["==", ["get", "class"], "wood"],
      paint: { "fill-color": p.wood },
    },
    {
      id: "grass",
      type: "fill",
      source: SOURCE,
      "source-layer": "landcover",
      filter: ["==", ["get", "class"], "grass"],
      paint: { "fill-color": p.grass },
    },
    {
      id: "sand",
      type: "fill",
      source: SOURCE,
      "source-layer": "landcover",
      filter: ["==", ["get", "class"], "sand"],
      paint: { "fill-color": p.sand },
    },
    {
      id: "park",
      type: "fill",
      source: SOURCE,
      "source-layer": "park",
      paint: { "fill-color": p.park },
    },
    {
      id: "hospital",
      type: "fill",
      source: SOURCE,
      "source-layer": "landuse",
      minzoom: 12,
      filter: ["==", ["get", "class"], "hospital"],
      paint: { "fill-color": p.hospital },
    },
    {
      id: "school",
      type: "fill",
      source: SOURCE,
      "source-layer": "landuse",
      minzoom: 12,
      filter: ["match", ["get", "class"], ["school", "university", "college"], true, false],
      paint: { "fill-color": p.school },
    },
    {
      id: "pitch",
      type: "fill",
      source: SOURCE,
      "source-layer": "landuse",
      minzoom: 13,
      filter: ["match", ["get", "class"], ["pitch", "stadium", "cemetery"], true, false],
      paint: { "fill-color": p.grass },
    },

    // --- water --------------------------------------------------------------
    {
      id: "water",
      type: "fill",
      source: SOURCE,
      "source-layer": "water",
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      paint: { "fill-color": p.water },
    },
    {
      id: "waterway",
      type: "line",
      source: SOURCE,
      "source-layer": "waterway",
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      layout: { "line-cap": "round" },
      paint: {
        "line-color": p.water,
        "line-width": [
          "interpolate",
          ["exponential", 1.4],
          ["zoom"],
          8,
          ["match", ["get", "class"], "river", 1, 0.3],
          18,
          ["match", ["get", "class"], "river", 14, 4],
        ],
      },
    },

    // --- airports -----------------------------------------------------------
    {
      id: "aeroway",
      type: "fill",
      source: SOURCE,
      "source-layer": "aeroway",
      minzoom: 11,
      filter: ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false],
      paint: { "fill-color": p.residential },
    },
    {
      id: "runway",
      type: "line",
      source: SOURCE,
      "source-layer": "aeroway",
      minzoom: 11,
      filter: ["all", isLine, ["match", ["get", "class"], ["runway", "taxiway"], true, false]],
      paint: {
        "line-color": p.runway,
        "line-width": width([[11, 1], [14, 8], [18, 50]]),
      },
    },

    // --- flat buildings (fade out as the 3D ones take over) -----------------
    {
      id: "building",
      type: "fill",
      source: SOURCE,
      "source-layer": "building",
      minzoom: 14,
      paint: {
        "fill-color": p.building,
        "fill-outline-color": p.buildingOutline,
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0, 14.5, 1, 16.3, 1, 16.8, 0],
      },
    },

    // --- roads: casings, then fills -----------------------------------------
    {
      id: "path",
      type: "line",
      source: SOURCE,
      "source-layer": "transportation",
      minzoom: 15,
      filter: roadFilter(["path", "pedestrian"]),
      paint: {
        "line-color": p.path,
        "line-width": width([[15, 1], [18, 2.5]]),
        "line-dasharray": [2, 1.5],
      },
    },
    {
      id: "rail",
      type: "line",
      source: SOURCE,
      "source-layer": "transportation",
      minzoom: 11,
      filter: roadFilter(["rail", "transit"]),
      paint: {
        "line-color": p.rail,
        "line-width": width([[11, 0.6], [16, 2], [18, 3]]),
      },
    },
    {
      id: "ferry",
      type: "line",
      source: SOURCE,
      "source-layer": "transportation",
      minzoom: 10,
      filter: roadFilter(["ferry"]),
      paint: {
        "line-color": p.waterLabel,
        "line-width": 1.2,
        "line-dasharray": [3, 2],
        "line-opacity": 0.7,
      },
    },
    ...ROADS.map(
      (r): LayerSpecification => ({
        id: `road-${r.id}-casing`,
        type: "line",
        source: SOURCE,
        "source-layer": "transportation",
        minzoom: r.minzoom + 1,
        filter: roadFilter(r.classes),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": r.casing(p), "line-width": width(r.widths, 2) },
      }),
    ),
    ...ROADS.map(
      (r): LayerSpecification => ({
        id: `road-${r.id}`,
        type: "line",
        source: SOURCE,
        "source-layer": "transportation",
        minzoom: r.minzoom,
        filter: roadFilter(r.classes),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": r.fill(p),
          "line-width": width(r.widths),
          // Tunnels drawn faint, so a road under a river is not mistaken
          // for a bridge over it.
          "line-opacity": ["match", ["get", "brunnel"], "tunnel", 0.45, 1],
        },
      }),
    ),
    {
      id: "oneway",
      type: "symbol",
      source: SOURCE,
      "source-layer": "transportation",
      minzoom: 16,
      filter: ["all", isLine, ["==", ["get", "oneway"], 1]],
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 120,
        "icon-image": "arrow",
        "icon-size": 0.7,
        "icon-rotation-alignment": "map",
      },
      paint: { "icon-opacity": p.poiIcons ? 0.35 : 0.2 },
    },

    // --- boundaries ---------------------------------------------------------
    {
      id: "boundary",
      type: "line",
      source: SOURCE,
      "source-layer": "boundary",
      filter: [
        "all",
        ["<=", ["get", "admin_level"], 4],
        ["!=", ["get", "maritime"], 1],
      ],
      paint: {
        "line-color": p.boundary,
        "line-width": ["match", ["get", "admin_level"], 2, 1.2, 0.8],
        "line-dasharray": [3, 2],
        "line-opacity": 0.7,
      },
    },

    // --- 3D buildings, seen when the driving view tilts -----------------------
    {
      id: "building-3d",
      type: "fill-extrusion",
      source: SOURCE,
      "source-layer": "building",
      minzoom: 16,
      paint: {
        "fill-extrusion-color": p.building3d,
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        // Light and see-through: in the tilted driving view the street is
        // what matters, and solid blocks hid it.
        "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 16, 0, 16.8, 0.55],
      },
    },

    // --- labels -------------------------------------------------------------
    waterLabel(p, "water-label-line", "line"),
    waterLabel(p, "water-label-point", "point"),
    {
      id: "road-label-minor",
      type: "symbol",
      source: SOURCE,
      "source-layer": "transportation_name",
      minzoom: 15,
      filter: ["match", ["get", "class"], ["minor", "service", "track"], true, false],
      layout: {
        "symbol-placement": "line",
        "text-field": NAME,
        "text-font": FONT,
        "text-size": 11,
        "text-rotation-alignment": "map",
        "text-pitch-alignment": "viewport",
      },
      paint: {
        "text-color": p.roadLabel,
        "text-halo-color": p.roadLabelHalo,
        "text-halo-width": 1.5,
      },
    },
    {
      id: "road-label-major",
      type: "symbol",
      source: SOURCE,
      "source-layer": "transportation_name",
      minzoom: 12,
      filter: [
        "match",
        ["get", "class"],
        ["motorway", "trunk", "primary", "secondary", "tertiary"],
        true,
        false,
      ],
      layout: {
        "symbol-placement": "line",
        "text-field": NAME,
        "text-font": FONT,
        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 11, 16, 13],
        "text-rotation-alignment": "map",
        "text-pitch-alignment": "viewport",
      },
      paint: {
        "text-color": p.majorRoadLabel,
        "text-halo-color": p.roadLabelHalo,
        "text-halo-width": 1.5,
      },
    },
    {
      // National highway numbers (N1, N2…) on a small shield, as Google does.
      id: "road-shield",
      type: "symbol",
      source: SOURCE,
      "source-layer": "transportation_name",
      minzoom: 8,
      filter: [
        "all",
        isLine,
        ["has", "ref"],
        ["<=", ["get", "ref_length"], 6],
        ["match", ["get", "class"], ["motorway", "trunk", "primary"], true, false],
      ],
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 400,
        "icon-image": ["concat", "road_", ["get", "ref_length"]],
        "icon-rotation-alignment": "viewport",
        "text-field": ["get", "ref"],
        "text-font": FONT_BOLD,
        "text-size": 10,
        "text-rotation-alignment": "viewport",
      },
      paint: { "text-color": "#3C4043" },
    },

    // Points of interest: fuel first and earliest, because on a bike it is
    // the one that matters; then everything else by importance.
    poiLayer(p, "poi-fuel", 13, ["==", ["get", "class"], "fuel"]),
    poiLayer(p, "poi-major", 15.5, ["<", ["get", "rank"], 5]),
    poiLayer(p, "poi-minor", 17.5, [">=", ["get", "rank"], 5]),

    placeLabel(p, "place-neighbourhood", ["neighbourhood", "quarter", "hamlet", "isolated_dwelling"], 13, 11, 13, true),
    placeLabel(p, "place-suburb", ["suburb"], 11, 12, 14, true),
    placeLabel(p, "place-village", ["village"], 10, 11, 14, false),
    placeLabel(p, "place-town", ["town"], 8, 12, 16, false),
    placeLabel(p, "place-city", ["city"], 4, 13, 20, false, true),
    placeLabel(p, "place-state", ["state"], 5, 11, 14, true),
    {
      id: "place-country",
      type: "symbol",
      source: SOURCE,
      "source-layer": "place",
      maxzoom: 8,
      filter: ["==", ["get", "class"], "country"],
      layout: {
        "text-field": NAME,
        "text-font": FONT_BOLD,
        "text-size": ["interpolate", ["linear"], ["zoom"], 2, 11, 6, 15],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.1,
      },
      paint: {
        "text-color": p.minorPlaceLabel,
        "text-halo-color": p.labelHalo,
        "text-halo-width": 1.5,
      },
    },
  ];

  return {
    version: 8,
    name: "Cruzo",
    sources: {
      [SOURCE]: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
    },
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sprite: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
    layers,
  };
}

function waterLabel(p: Palette, id: string, placement: "line" | "point"): LayerSpecification {
  const lines = placement === "line";
  return {
    id,
    type: "symbol",
    source: SOURCE,
    "source-layer": "water_name",
    filter: [
      "match",
      ["geometry-type"],
      lines ? ["LineString", "MultiLineString"] : ["Point", "MultiPoint"],
      true,
      false,
    ],
    layout: {
      "text-field": NAME,
      "text-font": FONT_ITALIC,
      "text-size": 13,
      "symbol-placement": placement,
      "text-letter-spacing": 0.1,
      "text-max-width": 6,
    },
    paint: {
      "text-color": p.waterLabel,
      "text-halo-color": p.labelHalo,
      "text-halo-width": 1,
    },
  };
}

function poiLayer(
  p: Palette,
  id: string,
  minzoom: number,
  extra: ExpressionSpecification,
): LayerSpecification {
  return {
    id,
    type: "symbol",
    source: SOURCE,
    "source-layer": "poi",
    minzoom,
    filter: [
      "all",
      ["match", ["geometry-type"], ["Point", "MultiPoint"], true, false],
      ["has", "name"],
      extra,
    ],
    layout: {
      "text-field": NAME,
      "text-font": FONT,
      "text-size": 11,
      "text-max-width": 8,
      ...(p.poiIcons
        ? {
            "icon-image": [
              "match",
              ["get", "subclass"],
              ["florist", "furniture"],
              ["get", "subclass"],
              ["get", "class"],
            ] as ExpressionSpecification,
            "text-anchor": "left" as const,
            "text-offset": [0.9, 0] as [number, number],
            "text-optional": true,
          }
        : {}),
    },
    paint: {
      "text-color": poiColor(p),
      "text-halo-color": p.labelHalo,
      "text-halo-width": 1.3,
    },
  };
}

function placeLabel(
  p: Palette,
  id: string,
  classes: string[],
  minzoom: number,
  sizeLow: number,
  sizeHigh: number,
  minor: boolean,
  bold = false,
): LayerSpecification {
  return {
    id,
    type: "symbol",
    source: SOURCE,
    "source-layer": "place",
    minzoom,
    filter: ["match", ["get", "class"], classes, true, false],
    layout: {
      "text-field": NAME,
      "text-font": bold ? FONT_BOLD : FONT,
      "text-size": ["interpolate", ["linear"], ["zoom"], minzoom, sizeLow, 16, sizeHigh],
      "text-max-width": 8,
      ...(minor ? { "text-transform": "uppercase" as const, "text-letter-spacing": 0.08 } : {}),
    },
    paint: {
      "text-color": minor ? p.minorPlaceLabel : p.placeLabel,
      "text-halo-color": p.labelHalo,
      "text-halo-width": 1.5,
    },
  };
}

/**
 * Cruzo's route lines are inserted just below this layer: above roads and 3D
 * buildings, below every label, so street names stay readable on the route
 * the way they do in Google Maps.
 */
export const OVERLAY_BEFORE_LAYER = "water-label-line";

/** Built once each: the style is a large object and never changes. */
export const mapStyleFor: Record<MapTheme, StyleSpecification> = {
  day: build(DAY),
  night: build(NIGHT),
};

/**
 * Night between 6 pm and 6 am, local time.
 *
 * A glaring white map at night ruins a rider's dark adaptation; a dark one at
 * noon is unreadable in the sun. The rider can still flip it by hand.
 */
export function themeForHour(hour: number): MapTheme {
  return hour >= 18 || hour < 6 ? "night" : "day";
}

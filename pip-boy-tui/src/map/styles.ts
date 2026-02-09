/**
 * Pip-Boy map style definition
 *
 * A Mapbox GL-compatible style with a Pip-Boy colour palette.
 * Uses distinct hues to differentiate feature types while maintaining
 * the retro-terminal aesthetic:
 *   - Roads: bright green / lime (primary navigation features)
 *   - Water: teal / dark cyan (distinct from land)
 *   - Buildings: amber / dark yellow (urban fill)
 *   - Parks/woods: olive / forest green (natural areas)
 *   - Labels: bright colours per category
 *   - Rail: dim magenta (utility)
 *   - Admin: dim grey-green (borders)
 *
 * Compatible with osm2vectortiles and OpenMapTiles source-layer names.
 */

import { hex2xterm } from "./utils.ts";

// ── Pip-Boy colour palette ──────────────────────────────────

export const COLORS = {
  background:    "#0a0a0a",

  // Water — teal / dark cyan
  water:         "#0a4040",
  waterFill:     "#082e2e",
  waterLabel:    "#1a8888",

  // Land use — olive / muted green
  landuse:       "#0d1a00",
  park:          "#1a3300",
  wood:          "#143800",

  // Buildings — amber / brown
  building:      "#4a3800",
  buildingFill:  "#2a2000",

  // Roads — green spectrum (main feature)
  road:          "#00cc00",
  roadMajor:     "#00ff00",
  roadMinor:     "#338833",
  roadLabel:     "#55aa55",

  // Rail — dim magenta
  rail:          "#553355",

  // Admin borders — grey-green
  admin:         "#336633",
  adminMajor:    "#44aa44",

  // Place labels — bright green/yellow spectrum
  placeCity:     "#ffff00",
  placeTown:     "#ccdd00",
  placeVillage:  "#88bb00",
  placeOther:    "#669900",

  // POI — orange-ish
  poi:           "#cc8800",

  // Marine — dark teal
  marine:        "#1a6666",

  // Country labels — bright
  country:       "#ffff00",

  // Markers
  gpsMarker:     "#ff0000",
  waypoint:      "#ff8800",

  // Route overlay
  route:         "#ff00ff",
  routeStart:    "#00ff00",
  routeEnd:      "#ff0000",
} as const;

// Pre-computed xterm-256 indices for rendering performance
export const XTERM = Object.fromEntries(
  Object.entries(COLORS).map(([k, v]) => [k, hex2xterm(v)]),
) as Record<keyof typeof COLORS, number>;

// ── Style filter types ──────────────────────────────────────

export type FilterOp = "==" | "!=" | "in" | "!in" | "has" | "!has" | ">" | ">=" | "<" | "<=" | "all" | "any" | "none";

export interface StyleLayer {
  id: string;
  type: "fill" | "line" | "symbol" | "background";
  "source-layer"?: string;
  paint: Record<string, string | number | Record<string, unknown>>;
  filter?: unknown[];
  minzoom?: number;
  maxzoom?: number;
}

// ── Pip-Boy style definition ────────────────────────────────

export const pipBoyStyle: { name: string; layers: StyleLayer[] } = {
  name: "pip-boy-green",
  layers: [
    // Background
    {
      id: "background",
      type: "background",
      paint: { "background-color": COLORS.background },
    },

    // ── Land use fills ────────────────────────────────
    {
      id: "landuse_park",
      type: "fill",
      "source-layer": "landuse",
      paint: { "fill-color": COLORS.park },
      filter: ["==", "class", "park"],
    },
    {
      id: "landuse_wood",
      type: "line",
      "source-layer": "landuse",
      paint: { "line-color": COLORS.park },
      filter: ["==", "class", "wood"],
    },
    {
      id: "landuse_hospital",
      type: "line",
      "source-layer": "landuse",
      paint: { "line-color": COLORS.poi },
      filter: ["==", "class", "hospital"],
    },

    // ── Water ─────────────────────────────────────────
    {
      id: "waterway",
      type: "line",
      "source-layer": "waterway",
      paint: { "line-color": COLORS.water },
    },
    {
      id: "water",
      type: "fill",
      "source-layer": "water",
      paint: { "fill-color": COLORS.water },
    },

    // ── Buildings ─────────────────────────────────────
    {
      id: "building",
      type: "line",
      "source-layer": "building",
      paint: { "line-color": COLORS.building },
    },

    // ── Roads ─────────────────────────────────────────
    {
      id: "road_path",
      type: "line",
      "source-layer": "road",
      paint: { "line-color": COLORS.roadMinor, "line-width": 1 },
      filter: ["in", "class", "path", "pedestrian"],
    },
    {
      id: "road_service",
      type: "line",
      "source-layer": "road",
      paint: { "line-color": COLORS.roadMinor, "line-width": 1 },
      filter: ["in", "class", "service", "track"],
    },
    {
      id: "road_street",
      type: "line",
      "source-layer": "road",
      paint: { "line-color": COLORS.road, "line-width": 1 },
      filter: ["in", "class", "street", "street_limited"],
    },
    {
      id: "road_secondary",
      type: "line",
      "source-layer": "road",
      paint: { "line-color": COLORS.road, "line-width": 1 },
      filter: ["in", "class", "secondary", "tertiary"],
    },
    {
      id: "road_primary",
      type: "line",
      "source-layer": "road",
      paint: { "line-color": COLORS.roadMajor, "line-width": 2 },
      filter: ["in", "class", "trunk", "primary"],
    },
    {
      id: "road_motorway",
      type: "line",
      "source-layer": "road",
      paint: { "line-color": COLORS.roadMajor, "line-width": 2 },
      filter: ["==", "class", "motorway"],
      minzoom: 5,
    },
    {
      id: "road_motorway_link",
      type: "line",
      "source-layer": "road",
      paint: { "line-color": COLORS.road, "line-width": 1 },
      filter: ["==", "class", "motorway_link"],
      minzoom: 12,
    },
    {
      id: "road_link",
      type: "line",
      "source-layer": "road",
      paint: { "line-color": COLORS.roadMinor, "line-width": 1 },
      filter: ["==", "class", "link"],
      minzoom: 13,
    },

    // ── Rail ──────────────────────────────────────────
    {
      id: "rail",
      type: "line",
      "source-layer": "road",
      paint: { "line-color": COLORS.rail, "line-width": 1 },
      filter: ["in", "class", "major_rail", "minor_rail"],
    },

    // ── Admin boundaries ──────────────────────────────
    {
      id: "admin_country",
      type: "line",
      "source-layer": "admin",
      paint: { "line-color": COLORS.adminMajor },
      filter: ["all", ["==", "admin_level", 2], ["==", "maritime", 0]],
    },
    {
      id: "admin_state",
      type: "line",
      "source-layer": "admin",
      paint: { "line-color": COLORS.admin },
      filter: ["all", [">=", "admin_level", 3], ["==", "maritime", 0]],
    },

    // ── Labels: water ─────────────────────────────────
    {
      id: "water_label",
      type: "symbol",
      "source-layer": "water_label",
      paint: { "text-color": COLORS.waterLabel },
      filter: ["==", "$type", "Point"],
    },

    // ── Labels: marine ────────────────────────────────
    {
      id: "marine_label",
      type: "symbol",
      "source-layer": "marine_label",
      paint: { "text-color": COLORS.marine },
    },

    // ── Labels: POI ───────────────────────────────────
    {
      id: "poi_label",
      type: "symbol",
      "source-layer": "poi_label",
      paint: { "text-color": COLORS.poi },
      filter: ["==", "$type", "Point"],
      minzoom: 13,
    },

    // ── Labels: road ──────────────────────────────────
    {
      id: "road_label",
      type: "symbol",
      "source-layer": "road_label",
      paint: { "text-color": COLORS.roadLabel },
      minzoom: 15,
    },

    // ── Labels: places ────────────────────────────────
    {
      id: "place_label_city",
      type: "symbol",
      "source-layer": "place_label",
      paint: { "text-color": COLORS.placeCity },
      filter: ["==", "type", "city"],
    },
    {
      id: "place_label_town",
      type: "symbol",
      "source-layer": "place_label",
      paint: { "text-color": COLORS.placeTown },
      filter: ["==", "type", "town"],
    },
    {
      id: "place_label_village",
      type: "symbol",
      "source-layer": "place_label",
      paint: { "text-color": COLORS.placeVillage },
      filter: ["==", "type", "village"],
    },
    {
      id: "place_label_other",
      type: "symbol",
      "source-layer": "place_label",
      paint: { "text-color": COLORS.placeOther },
      filter: ["in", "type", "hamlet", "suburb", "neighbourhood"],
    },

    // ── Labels: country ───────────────────────────────
    {
      id: "country_label",
      type: "symbol",
      "source-layer": "country_label",
      paint: { "text-color": COLORS.country },
    },

    // ── Labels: state ─────────────────────────────────
    {
      id: "state_label",
      type: "symbol",
      "source-layer": "state_label",
      paint: { "text-color": COLORS.admin },
    },
  ],
};

// ── Compiled style for fast lookup ──────────────────────────

export interface CompiledStyle {
  id: string;
  type: "fill" | "line" | "symbol" | "background";
  sourceLayer?: string;
  color: number; // xterm-256
  colorHex: string; // original hex colour for TUI rendering
  lineWidth: number;
  minzoom: number;
  maxzoom: number;
  appliesTo: (feature: { properties: Record<string, unknown> }) => boolean;
}

/** Compile a filter expression into a predicate function */
function compileFilter(
  filter?: unknown[],
): (feature: { properties: Record<string, unknown> }) => boolean {
  if (!filter || filter.length === 0) return () => true;

  const op = filter[0] as string;

  switch (op) {
    case "all": {
      const subs = (filter.slice(1) as unknown[][]).map(compileFilter);
      return (f) => subs.every((fn) => fn(f));
    }
    case "any": {
      const subs = (filter.slice(1) as unknown[][]).map(compileFilter);
      return (f) => subs.some((fn) => fn(f));
    }
    case "none": {
      const subs = (filter.slice(1) as unknown[][]).map(compileFilter);
      return (f) => !subs.some((fn) => fn(f));
    }
    case "==":
      return (f) => f.properties[filter[1] as string] === filter[2];
    case "!=":
      return (f) => f.properties[filter[1] as string] !== filter[2];
    case "in": {
      const values = filter.slice(2);
      return (f) => values.includes(f.properties[filter[1] as string]);
    }
    case "!in": {
      const values = filter.slice(2);
      return (f) => !values.includes(f.properties[filter[1] as string]);
    }
    case "has":
      return (f) => filter[1] as string in f.properties;
    case "!has":
      return (f) => !(filter[1] as string in f.properties);
    case ">":
      return (f) => (f.properties[filter[1] as string] as number) > (filter[2] as number);
    case ">=":
      return (f) => (f.properties[filter[1] as string] as number) >= (filter[2] as number);
    case "<":
      return (f) => (f.properties[filter[1] as string] as number) < (filter[2] as number);
    case "<=":
      return (f) => (f.properties[filter[1] as string] as number) <= (filter[2] as number);
    default:
      return () => true;
  }
}

/** Compile the style into fast lookup structures */
export function compileStyle(
  style = pipBoyStyle,
): { byId: Map<string, CompiledStyle>; byLayer: Map<string, CompiledStyle[]> } {
  const byId = new Map<string, CompiledStyle>();
  const byLayer = new Map<string, CompiledStyle[]>();

  for (const layer of style.layers) {
    const colorHex =
      (layer.paint["line-color"] as string) ||
      (layer.paint["fill-color"] as string) ||
      (layer.paint["text-color"] as string) ||
      (layer.paint["background-color"] as string) ||
      COLORS.road;

    let lineWidth = 1;
    if (layer.paint["line-width"]) {
      const w = layer.paint["line-width"];
      lineWidth = typeof w === "number" ? w : 1;
    }

    const compiled: CompiledStyle = {
      id: layer.id,
      type: layer.type,
      sourceLayer: layer["source-layer"],
      color: hex2xterm(colorHex),
      colorHex,
      lineWidth,
      minzoom: layer.minzoom ?? 0,
      maxzoom: layer.maxzoom ?? 24,
      appliesTo: compileFilter(layer.filter),
    };

    byId.set(layer.id, compiled);

    if (layer["source-layer"]) {
      const existing = byLayer.get(layer["source-layer"]) || [];
      existing.push(compiled);
      byLayer.set(layer["source-layer"], existing);
    }
  }

  return { byId, byLayer };
}

/** Get the draw order for layers at a given zoom */
export function getDrawOrder(zoom: number): string[] {
  if (zoom < 2) {
    return ["admin", "water", "country_label", "marine_label"];
  }
  return [
    "landuse",
    "water",
    "marine_label",
    "building",
    "road",
    "admin",
    "country_label",
    "state_label",
    "water_label",
    "place_label",
    "rail_station_label",
    "poi_label",
    "road_label",
    "housenum_label",
  ];
}

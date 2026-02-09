/**
 * Map utility functions — coordinate transforms, Web Mercator math, haversine, bearing
 *
 * Uses standard Web Mercator (EPSG:3857) projection, same as OSM / Google Maps.
 */

export const EARTH_RADIUS = 6378137; // metres
export const TILE_SIZE = 256; // standard tile pixel size

export interface LatLon {
  lat: number;
  lon: number;
}

export interface TileCoord {
  x: number;
  y: number;
  z: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Clamp a number between min and max */
export function clamp(num: number, min: number, max: number): number {
  return num <= min ? min : num >= max ? max : num;
}

/** Degrees to radians */
export function deg2rad(angle: number): number {
  return angle * 0.017453292519943295;
}

/** Radians to degrees */
export function rad2deg(angle: number): number {
  return angle * 57.29577951308232;
}

/** Convert lat/lon to fractional tile coordinates at a given zoom level */
export function ll2tile(lon: number, lat: number, zoom: number): TileCoord {
  const n = Math.pow(2, zoom);
  return {
    x: ((lon + 180) / 360) * n,
    y:
      ((1 -
        Math.log(
          Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180),
        ) /
          Math.PI) /
        2) *
      n,
    z: zoom,
  };
}

/** Convert tile coordinates back to lat/lon */
export function tile2ll(x: number, y: number, zoom: number): LatLon {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, zoom);
  return {
    lon: (x / Math.pow(2, zoom)) * 360 - 180,
    lat: rad2deg(Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))),
  };
}

/** Get the integer base zoom level (floor, clamped to tileRange) */
export function baseZoom(zoom: number, maxZoom = 14): number {
  return Math.min(maxZoom, Math.max(0, Math.floor(zoom)));
}

/** Get the effective tile pixel size at a given (possibly fractional) zoom level */
export function tileSizeAtZoom(zoom: number): number {
  return TILE_SIZE * Math.pow(2, zoom - baseZoom(zoom));
}

/** Metres per pixel at a given zoom and latitude */
export function metersPerPixel(zoom: number, lat = 0): number {
  return (
    (Math.cos((lat * Math.PI) / 180) * 2 * Math.PI * EARTH_RADIUS) /
    (256 * Math.pow(2, zoom))
  );
}

/** Normalise longitude to [-180, 180] and clamp latitude to Mercator limits */
export function normalize(ll: LatLon): LatLon {
  let { lon, lat } = ll;
  if (lon < -180) lon += 360;
  if (lon > 180) lon -= 360;
  lat = clamp(lat, -85.0511, 85.0511);
  return { lon, lat };
}

/** Convert hex colour string to [r, g, b] */
export function hex2rgb(color: string): [number, number, number] {
  if (typeof color !== "string") return [255, 0, 0];
  color = color.replace("#", "");
  if (color.length === 3) {
    const r = parseInt(color[0]! + color[0]!, 16);
    const g = parseInt(color[1]! + color[1]!, 16);
    const b = parseInt(color[2]! + color[2]!, 16);
    return [r, g, b];
  }
  const decimal = parseInt(color, 16);
  return [(decimal >> 16) & 255, (decimal >> 8) & 255, decimal & 255];
}

/**
 * Convert RGB to closest xterm-256 colour index.
 * Uses the 6x6x6 colour cube (indices 16–231) plus the greyscale ramp (232–255).
 */
export function rgb2xterm(r: number, g: number, b: number): number {
  // Check if it's close to a greyscale
  if (r === g && g === b) {
    if (r < 8) return 16; // black
    if (r > 248) return 231; // white
    return Math.round((r - 8) / 247 * 23) + 232;
  }

  // Map to the 6x6x6 colour cube
  const ri = Math.round(r / 255 * 5);
  const gi = Math.round(g / 255 * 5);
  const bi = Math.round(b / 255 * 5);
  return 16 + 36 * ri + 6 * gi + bi;
}

/** Convert hex colour to xterm-256 index */
export function hex2xterm(hex: string): number {
  const [r, g, b] = hex2rgb(hex);
  return rgb2xterm(r, g, b);
}

/**
 * Convert xterm-256 colour index back to hex string.
 * Indices 0–15: standard colours (approximated).
 * Indices 16–231: 6×6×6 colour cube.
 * Indices 232–255: greyscale ramp.
 */
export function xterm2hex(index: number): string {
  if (index < 0 || index > 255) return "#000000";

  // Standard 16 colours (approximate)
  if (index < 16) {
    const basic = [
      "#000000", "#800000", "#008000", "#808000",
      "#000080", "#800080", "#008080", "#c0c0c0",
      "#808080", "#ff0000", "#00ff00", "#ffff00",
      "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
    ];
    return basic[index]!;
  }

  // 6×6×6 colour cube (16–231)
  if (index < 232) {
    const i = index - 16;
    const r = Math.floor(i / 36);
    const g = Math.floor((i % 36) / 6);
    const b = i % 6;
    const toHex = (v: number) => (v === 0 ? 0 : 55 + v * 40).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  // Greyscale ramp (232–255)
  const grey = 8 + (index - 232) * 10;
  const h = grey.toString(16).padStart(2, "0");
  return `#${h}${h}${h}`;
}

/** Haversine distance between two points in metres */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = deg2rad(b.lat - a.lat);
  const dLon = deg2rad(b.lon - a.lon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(deg2rad(a.lat)) * Math.cos(deg2rad(b.lat)) * sinLon * sinLon;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
}

/** Bearing from point a to point b in degrees (0 = north, 90 = east) */
export function bearing(a: LatLon, b: LatLon): number {
  const dLon = deg2rad(b.lon - a.lon);
  const lat1 = deg2rad(a.lat);
  const lat2 = deg2rad(b.lat);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((rad2deg(Math.atan2(y, x)) + 360) % 360);
}

/** Format distance in human-readable form */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

/** Format bearing as compass direction */
export function bearingToCompass(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(deg / 45) % 8;
  return dirs[idx]!;
}

/** Population count (number of set bits) */
export function population(val: number): number {
  let bits = 0;
  while (val > 0) {
    bits += val & 1;
    val >>= 1;
  }
  return bits;
}

/**
 * Router — get driving/walking routes between two points using road network
 *
 * Uses the OSRM (Open Source Routing Machine) public demo server.
 * Free, no API key required. Returns route geometry as lat/lon coordinates.
 *
 * Note: The public OSRM demo server is rate-limited. For production use,
 * consider running your own OSRM instance.
 */

import type { LatLon } from "./utils.ts";
import { formatDistance } from "./utils.ts";

export interface RouteStep {
  /** Maneuver instruction */
  instruction: string;
  /** Distance in meters for this step */
  distance: number;
  /** Duration in seconds for this step */
  duration: number;
  /** Road name */
  name: string;
}

export interface Route {
  /** Route geometry as array of lat/lon points */
  geometry: LatLon[];
  /** Total distance in meters */
  distance: number;
  /** Total duration in seconds */
  duration: number;
  /** Human-readable summary */
  summary: string;
  /** Turn-by-turn steps */
  steps: RouteStep[];
}

const OSRM_URL = "https://router.project-osrm.org";
const USER_AGENT = "PipBoy3000-TUI/0.1 (personal-project)";

/**
 * Decode an OSRM polyline (Google encoded polyline format) to lat/lon array.
 * OSRM uses precision 5 (divide by 1e5) for the encoded polyline.
 */
function decodePolyline(encoded: string, precision = 5): LatLon[] {
  const factor = Math.pow(10, precision);
  const points: LatLon[] = [];
  let lat = 0;
  let lon = 0;
  let i = 0;

  while (i < encoded.length) {
    // Decode latitude
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(i++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    // Decode longitude
    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(i++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / factor, lon: lon / factor });
  }

  return points;
}

/**
 * Get a driving route between two points using OSRM.
 * Returns the route with geometry, distance, duration, and steps.
 */
export async function getRoute(
  from: LatLon,
  to: LatLon,
  profile: "driving" | "walking" | "cycling" = "driving",
): Promise<Route | null> {
  // OSRM expects coordinates as lon,lat (not lat,lon)
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url = `${OSRM_URL}/route/v1/${profile}/${coords}?overview=full&geometries=polyline&steps=true`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`OSRM error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    code: string;
    routes?: Array<{
      geometry: string;
      distance: number;
      duration: number;
      legs?: Array<{
        summary: string;
        steps?: Array<{
          maneuver: { type: string; modifier?: string };
          distance: number;
          duration: number;
          name: string;
        }>;
      }>;
    }>;
  };

  if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
    return null;
  }

  const osrmRoute = data.routes[0]!;
  const geometry = decodePolyline(osrmRoute.geometry);

  // Extract steps from legs
  const steps: RouteStep[] = [];
  if (osrmRoute.legs) {
    for (const leg of osrmRoute.legs) {
      if (leg.steps) {
        for (const step of leg.steps) {
          const modifier = step.maneuver.modifier ? ` ${step.maneuver.modifier}` : "";
          steps.push({
            instruction: `${step.maneuver.type}${modifier}`,
            distance: step.distance,
            duration: step.duration,
            name: step.name || "unnamed road",
          });
        }
      }
    }
  }

  // Build summary
  const distStr = formatDistance(osrmRoute.distance);
  const durMin = Math.round(osrmRoute.duration / 60);
  const durStr = durMin >= 60
    ? `${Math.floor(durMin / 60)}h ${durMin % 60}m`
    : `${durMin} min`;
  const legSummary = osrmRoute.legs?.[0]?.summary || "";
  const summary = `${distStr} | ${durStr}${legSummary ? ` via ${legSummary}` : ""}`;

  return {
    geometry,
    distance: osrmRoute.distance,
    duration: osrmRoute.duration,
    summary,
    steps,
  };
}

/**
 * Format route duration as human-readable string.
 */
export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

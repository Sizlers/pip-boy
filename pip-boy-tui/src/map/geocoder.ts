/**
 * Geocoder — resolve addresses/place names to lat/lon coordinates
 *
 * Uses OpenStreetMap Nominatim (free, no API key required).
 * Respects Nominatim usage policy: max 1 req/sec, meaningful User-Agent.
 *
 * Smart fallback strategy when a query fails:
 *   1. Try the full query as-is
 *   2. Extract the city/region (last recognisable place name), geocode it
 *   3. Retry the landmark part bounded to that city's area
 *   4. Ask the local LLM "what real place near {city} did they mean?" and retry
 */

import type { LatLon } from "./utils.ts";
import type { Message } from "../ai/llm-client.ts";

export interface GeocodingResult {
  lat: number;
  lon: number;
  displayName: string;
  /** Bounding box [south, north, west, east] */
  boundingBox?: [number, number, number, number];
  /** OSM type: node, way, relation */
  type?: string;
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "PipBoy3000-TUI/0.1 (personal-project)";
const LLM_URL = "http://127.0.0.1:8080";

/** Rate limiter: enforce 1 request per second */
let lastRequestTime = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 1100) {
    await new Promise((resolve) => setTimeout(resolve, 1100 - elapsed));
  }
  lastRequestTime = Date.now();
}

// ── Low-level Nominatim call ────────────────────────────────

interface NominatimOptions {
  /** Bias results to this bounding box [south, north, west, east] */
  viewbox?: [number, number, number, number];
  /** Return multiple results for picking */
  limit?: number;
}

/**
 * Raw Nominatim search. Returns all results (up to limit).
 */
async function nominatimSearch(
  query: string,
  options: NominatimOptions = {},
): Promise<GeocodingResult[]> {
  await rateLimit();

  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: String(options.limit ?? 5),
    addressdetails: "1",
  });

  if (options.viewbox) {
    const [south, north, west, east] = options.viewbox;
    // Nominatim viewbox format: west,south,east,north (lon,lat,lon,lat)
    params.set("viewbox", `${west},${south},${east},${north}`);
    params.set("bounded", "1");
  }

  const response = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Nominatim error: ${response.status} ${response.statusText}`);
  }

  const raw = (await response.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
    boundingbox?: string[];
    osm_type?: string;
  }>;

  return (raw || []).map((r) => {
    const result: GeocodingResult = {
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      displayName: r.display_name,
    };
    if (r.boundingbox && r.boundingbox.length === 4) {
      result.boundingBox = [
        parseFloat(r.boundingbox[0]!),
        parseFloat(r.boundingbox[1]!),
        parseFloat(r.boundingbox[2]!),
        parseFloat(r.boundingbox[3]!),
      ];
    }
    if (r.osm_type) result.type = r.osm_type;
    return result;
  });
}

// ── City/region extraction ──────────────────────────────────

/**
 * Try to split a query into [landmark, city/region] by testing
 * progressively from the last word backwards.
 *
 * "bellum tower liverpool"  → tries "liverpool" (hit!) → ["bellum tower", "liverpool"]
 * "5 savannah close bedford" → tries "bedford" (hit!) → ["5 savannah close", "bedford"]
 * "big ben london"          → tries "london" (hit!) → ["big ben", "london"]
 * "eiffel tower"            → tries "tower" (miss) → null
 */
async function splitCityFromQuery(
  query: string,
): Promise<{ landmark: string; city: GeocodingResult } | null> {
  const words = query.trim().split(/\s+/);
  if (words.length < 2) return null;

  // Try last 1 word, then last 2 words, up to half the query
  const maxCityWords = Math.min(3, Math.floor(words.length / 2));

  for (let n = 1; n <= maxCityWords; n++) {
    const cityPart = words.slice(-n).join(" ");
    const landmarkPart = words.slice(0, -n).join(" ");

    if (!landmarkPart) continue;

    const results = await nominatimSearch(cityPart, { limit: 1 });
    if (results.length > 0) {
      const city = results[0]!;
      // Only accept if it looks like a real city/region (has a bounding box
      // wider than a single building)
      if (city.boundingBox) {
        const [south, north, west, east] = city.boundingBox;
        const span = Math.max(Math.abs(north - south), Math.abs(east - west));
        if (span > 0.01) {
          // This is a city/region, not a single building
          return { landmark: landmarkPart, city };
        }
      }
    }
  }

  return null;
}

// ── LLM place name correction ───────────────────────────────

/**
 * Ask the LLM what real place the user probably meant,
 * given a mangled landmark name and a known city.
 */
async function llmSuggestPlace(
  mangledLandmark: string,
  cityName: string,
): Promise<string[]> {
  try {
    const messages: Message[] = [
      {
        role: "system",
        content: `You fix misheard place names. Given a mangled landmark name and a city, suggest what the user probably meant.

Rules:
- Return ONLY the corrected place names, one per line
- Return up to 3 suggestions, most likely first
- Include the city name after each suggestion
- No explanations, no numbering, no punctuation
- If you're not sure, still guess based on what sounds similar

Example:
Input: "bellum tower" near "liverpool"
Output:
belem tower liverpool
belém tower liverpool
bell tower liverpool`,
      },
      {
        role: "user",
        content: `"${mangledLandmark}" near "${cityName}"`,
      },
    ];

    const response = await fetch(`${LLM_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        max_tokens: 150,
        temperature: 0.3,
        stream: false,
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return [];

    // Parse suggestions (one per line)
    return content
      .split("\n")
      .map((line) =>
        line
          .replace(/^\d+[\.\)]\s*/, "") // strip "1. " or "1) "
          .replace(/^[-•]\s*/, "") // strip "- " or "• "
          .trim(),
      )
      .filter((line) => line.length > 0 && line.length < 100);
  } catch {
    return [];
  }
}

// ── Phonetic / Whisper mishearing corrections ───────────────

/**
 * Common sound-alike substitutions that Whisper produces.
 * Each pair: [what Whisper might say, what was likely meant]
 */
const PHONETIC_SUBS: Array<[RegExp, string]> = [
  // vowel confusions
  [/bellum/gi, "belem"],
  [/bellem/gi, "belem"],
  [/bellam/gi, "belem"],
  [/ballem/gi, "belem"],
  // common consonant swaps
  [/ph/gi, "f"],    // "phountain" → "fountain"
  [/ck\b/g, "c"],   // "clockc" → "clock"
  // dropped/added letters
  [/\bsaint\b/gi, "st"],
  [/\bst\b/gi, "saint"],
  // common Whisper hallucinations
  [/\bthe\s+/gi, ""],  // spurious "the"
  [/\ba\s+/gi, ""],    // spurious "a"
];

/**
 * Generate phonetic variants of a landmark name by applying
 * common Whisper STT mishearing corrections.
 * Returns only variants that differ from the original.
 */
function generatePhoneticVariants(landmark: string): string[] {
  const variants = new Set<string>();
  const lower = landmark.toLowerCase();

  for (const [pattern, replacement] of PHONETIC_SUBS) {
    const variant = lower.replace(pattern, replacement).replace(/\s+/g, " ").trim();
    if (variant && variant !== lower) {
      variants.add(variant);
    }
  }

  return [...variants];
}

// ── Public API ──────────────────────────────────────────────

/**
 * Smart geocode: tries multiple strategies to resolve a query.
 *
 * Strategy:
 *   1. Try the full query directly
 *   2. If that fails, extract the city/region part and geocode it
 *   3. Retry the landmark within the city's bounding box
 *   4. If still failing, ask the LLM to suggest corrections and try each
 *   5. As a last resort, return the city itself
 */
export async function geocode(query: string): Promise<GeocodingResult | null> {
  // ── Strategy 1: try full query as-is ──
  const directResults = await nominatimSearch(query, { limit: 1 });
  if (directResults.length > 0) {
    return directResults[0]!;
  }

  // ── Strategy 2+3: split off city, search landmark within city bounds ──
  const split = await splitCityFromQuery(query);
  if (!split) {
    // Couldn't identify a city — nothing more we can do
    return null;
  }

  const { landmark, city } = split;

  // Try landmark within city bounding box
  if (city.boundingBox) {
    // Expand the bounding box slightly (20%) to catch places on edges
    const [south, north, west, east] = city.boundingBox;
    const latPad = (north - south) * 0.2;
    const lonPad = (east - west) * 0.2;
    const expandedBox: [number, number, number, number] = [
      south - latPad,
      north + latPad,
      west - lonPad,
      east + lonPad,
    ];

    const boundedResults = await nominatimSearch(landmark, {
      viewbox: expandedBox,
      limit: 3,
    });
    if (boundedResults.length > 0) {
      return boundedResults[0]!;
    }

    // Also try "landmark city" as a combined query (no viewbox)
    const combinedResults = await nominatimSearch(`${landmark} ${city.displayName.split(",")[0]}`, {
      limit: 1,
    });
    if (combinedResults.length > 0) {
      return combinedResults[0]!;
    }
  }

  // ── Strategy 3.5: phonetic / common Whisper mishearing substitutions ──
  if (city.boundingBox) {
    const [south, north, west, east] = city.boundingBox;
    const latPad = (north - south) * 0.2;
    const lonPad = (east - west) * 0.2;
    const phoneticBox: [number, number, number, number] = [
      south - latPad, north + latPad, west - lonPad, east + lonPad,
    ];
    const variants = generatePhoneticVariants(landmark);
    for (const variant of variants) {
      const results = await nominatimSearch(variant, { viewbox: phoneticBox, limit: 1 });
      if (results.length > 0) return results[0]!;
      // Also try with city name appended
      const withCity = await nominatimSearch(`${variant} ${city.displayName.split(",")[0]}`, { limit: 1 });
      if (withCity.length > 0) return withCity[0]!;
    }
  }

  // ── Strategy 4: ask LLM for corrections ──
  const cityShortName = city.displayName.split(",")[0] || "";
  const suggestions = await llmSuggestPlace(landmark, cityShortName);

  for (const suggestion of suggestions) {
    // Try the suggestion as-is
    const results = await nominatimSearch(suggestion, { limit: 1 });
    if (results.length > 0) {
      return results[0]!;
    }
    // Also try the corrected landmark within the city bounding box
    if (city.boundingBox) {
      const [south, north, west, east] = city.boundingBox;
      const latPad = (north - south) * 0.2;
      const lonPad = (east - west) * 0.2;
      const boundedResults = await nominatimSearch(
        suggestion.replace(new RegExp(`\\s*${cityShortName}\\s*$`, "i"), ""),
        {
          viewbox: [south - latPad, north + latPad, west - lonPad, east + lonPad],
          limit: 3,
        },
      );
      if (boundedResults.length > 0) {
        return boundedResults[0]!;
      }
    }
  }

  // ── Strategy 5: last resort — return the city itself ──
  // At least the user sees the right area on the map
  return city;
}

/**
 * Geocode and return as a LatLon, or null if not found.
 */
export async function geocodeToLatLon(query: string): Promise<LatLon | null> {
  const result = await geocode(query);
  if (!result) return null;
  return { lat: result.lat, lon: result.lon };
}

/**
 * Suggest a good zoom level based on a geocoding result.
 * Uses the bounding box size if available, otherwise defaults.
 */
export function suggestZoom(result: GeocodingResult): number {
  if (!result.boundingBox) {
    // Default zooms by type
    if (result.type === "node") return 17; // specific address/POI
    return 14;
  }

  const [south, north, west, east] = result.boundingBox;
  const latSpan = Math.abs(north - south);
  const lonSpan = Math.abs(east - west);
  const span = Math.max(latSpan, lonSpan);

  // Rough heuristic: map span to zoom level
  if (span < 0.001) return 18;   // building level
  if (span < 0.005) return 17;   // street level
  if (span < 0.01) return 16;    // block level
  if (span < 0.05) return 14;    // neighbourhood
  if (span < 0.1) return 13;     // district
  if (span < 0.5) return 11;     // city
  if (span < 2) return 9;        // region
  if (span < 10) return 7;       // country
  return 5;                       // continent
}

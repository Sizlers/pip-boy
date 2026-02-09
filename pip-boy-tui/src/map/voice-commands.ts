/**
 * Voice command parser for map control
 *
 * Parses natural speech transcriptions into map actions:
 * - "where is <place>" → FIND: zoom to a location
 * - "navigate/direct/go from <place A> to <place B>" → ROUTE: show route
 * - "navigate/direct/go to <place>" → ROUTE from current position to place
 * - "clear route" / "cancel" → CLEAR: remove route overlay
 * - "zoom in/out" → ZOOM
 * - Unrecognised → UNKNOWN
 */

export type MapVoiceCommand =
  | { type: "find"; query: string }
  | { type: "route"; from: string | null; to: string }
  | { type: "clear" }
  | { type: "zoom"; direction: "in" | "out" }
  | { type: "unknown"; raw: string };

/**
 * Parse a voice transcription into a map command.
 *
 * Whisper sometimes capitalises inconsistently and may add punctuation,
 * so we normalise before matching.
 */
export function parseMapVoiceCommand(raw: string): MapVoiceCommand {
  // Normalise: lowercase, strip punctuation, collapse whitespace
  const text = raw
    .toLowerCase()
    .replace(/[.,!?;:'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return { type: "unknown", raw };
  }

  // ── Clear / Cancel ──
  if (
    text === "clear route" ||
    text === "clear" ||
    text === "cancel route" ||
    text === "cancel navigation" ||
    text === "stop navigation" ||
    text === "remove route"
  ) {
    return { type: "clear" };
  }

  // ── Zoom ──
  if (text === "zoom in" || text === "zoom closer") {
    return { type: "zoom", direction: "in" };
  }
  if (text === "zoom out" || text === "zoom away") {
    return { type: "zoom", direction: "out" };
  }

  // ── Route: "from X to Y" patterns ──
  // Patterns: "navigate from X to Y", "direct me from X to Y",
  //           "directions from X to Y", "go from X to Y",
  //           "route from X to Y", "take me from X to Y"
  const fromToPatterns = [
    /^(?:navigate|direct\s+me|give\s+me\s+directions|directions|go|route|take\s+me|get\s+me|drive|walk|cycle)\s+from\s+(.+?)\s+to\s+(.+)$/,
    /^from\s+(.+?)\s+to\s+(.+)$/,
  ];

  for (const pattern of fromToPatterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        type: "route",
        from: match[1]!.trim(),
        to: match[2]!.trim(),
      };
    }
  }

  // ── Route: "to Y" patterns (from current position) ──
  // Patterns: "navigate to X", "direct me to X", "go to X", "take me to X"
  const toPatterns = [
    /^(?:navigate|direct\s+me|take\s+me|go|drive|walk|cycle|route)\s+to\s+(.+)$/,
    /^(?:directions|get\s+directions)\s+to\s+(.+)$/,
  ];

  for (const pattern of toPatterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        type: "route",
        from: null, // use current map center
        to: match[1]!.trim(),
      };
    }
  }

  // ── Find / Where is ──
  // Patterns: "where is X", "find X", "show me X", "locate X",
  //           "search for X", "look up X", "go to X" (already handled above)
  const findPatterns = [
    /^(?:where\s+is|where's)\s+(.+)$/,
    /^(?:find|locate|search\s+for|search|look\s+up|show\s+me|show)\s+(.+)$/,
    /^(?:what\s+is\s+at|what's\s+at)\s+(.+)$/,
  ];

  for (const pattern of findPatterns) {
    const match = text.match(pattern);
    if (match) {
      return { type: "find", query: match[1]!.trim() };
    }
  }

  // ── Fallback: if it looks like an address or place name, treat as find ──
  // Heuristic: if it contains a number followed by words (likely an address),
  // or if it's just a place name with no action verb
  if (/^\d+\s/.test(text) || text.split(" ").length >= 2) {
    return { type: "find", query: text };
  }

  return { type: "unknown", raw };
}

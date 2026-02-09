/**
 * Voice transcript preprocessor — uses the local LLM to clean up
 * Whisper transcription errors before geocoding.
 *
 * Whisper often mangles place names, street names, and addresses:
 *   - "savannah close" → "savaner clothes"
 *   - "belem tower" → "bell em tower"
 *   - "bedford" → "bed ford"
 *
 * This module sends the raw transcript through the LLM with a focused
 * prompt to correct place names while preserving the command structure.
 * Falls back to the raw text if the LLM is unavailable.
 */

import type { Message } from "../ai/llm-client.ts";

const LLM_URL = "http://127.0.0.1:8080";

const SYSTEM_PROMPT = `You are a voice transcript corrector for a map navigation system.
You receive raw speech-to-text output that may contain errors, especially in place names, street names, and addresses.

Your ONLY job: fix the place names and addresses so they can be geocoded. Preserve the command structure exactly.

Rules:
- Output ONLY the corrected transcript, nothing else
- Keep the same command words (where is, navigate, from, to, etc.)
- Fix misspelled/misheard place names, street names, cities, landmarks
- Fix number/word confusion (e.g. "to" → "2", "for" → "4" when clearly a house number)
- Keep it as a single line
- Do NOT add punctuation, quotes, or formatting
- Do NOT explain your changes
- If the transcript looks correct already, return it unchanged

Examples:
Input: where is five savaner clothes bed ford
Output: where is 5 savannah close bedford

Input: navigate from bell em tower liver pool to big ben london
Output: navigate from belem tower liverpool to big ben london

Input: find the eye fell tower paris
Output: find the eiffel tower paris

Input: go to times square new york
Output: go to times square new york`;

/**
 * Send the raw transcript through the LLM to fix place names.
 * Returns the corrected text, or the original if the LLM is unavailable.
 *
 * Uses low temperature (0.1) for deterministic corrections and
 * short max_tokens since the output should be roughly the same length.
 */
export async function preprocessTranscript(raw: string): Promise<string> {
  try {
    const messages: Message[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: raw },
    ];

    const response = await fetch(`${LLM_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        max_tokens: 200,
        temperature: 0.1,
        stream: false,
      }),
      // Short timeout — don't block the UI for too long
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      // LLM server not running or errored — fall back to raw
      return raw;
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string };
      }>;
    };

    const corrected = data.choices?.[0]?.message?.content?.trim();

    if (!corrected) {
      return raw;
    }

    // Sanity check: if the LLM returned something wildly different in length
    // or added explanation text, fall back to raw
    if (corrected.length > raw.length * 3 || corrected.includes("\n")) {
      return raw;
    }

    return corrected;
  } catch {
    // Network error, timeout, LLM not running — fall back silently
    return raw;
  }
}

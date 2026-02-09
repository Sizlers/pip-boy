/**
 * Braille art responsive scaling.
 *
 * Stores the full-resolution Vault Boy as a source, decodes it to a pixel
 * grid once, then re-encodes at any target size on demand.
 *
 * Each braille character (U+2800–U+28FF) encodes a 2-wide × 4-tall dot grid:
 *
 *   bit 0 (0x01): row 0, col 0    bit 3 (0x08): row 0, col 1
 *   bit 1 (0x02): row 1, col 0    bit 4 (0x10): row 1, col 1
 *   bit 2 (0x04): row 2, col 0    bit 5 (0x20): row 2, col 1
 *   bit 6 (0x40): row 3, col 0    bit 7 (0x80): row 3, col 1
 */

// ── Constants ───────────────────────────────────────────────

const BRAILLE_BASE = 0x2800;

/** Bit definitions: [pixelRow, pixelCol, bitmask] */
const DOT_BITS: readonly [number, number, number][] = [
  [0, 0, 0x01],
  [1, 0, 0x02],
  [2, 0, 0x04],
  [0, 1, 0x08],
  [1, 1, 0x10],
  [2, 1, 0x20],
  [3, 0, 0x40],
  [3, 1, 0x80],
];

// ── Full-size Vault Boy braille art (50 chars × 22 lines) ───

const VAULT_BOY_SOURCE: readonly string[] = [
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⡿⠛⢶⣦⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣦⠀⣠⡾⠛⠙⠛⠋⠀⠀⠀⠈⠉⠛⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢾⡇⠙⠛⠋⢀⣤⣀⠀⣀⣤⣤⡀⠀⠀⠀⠈⠻⣦⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣼⣧⡀⢀⡤⠋⠀⠈⠉⠉⠀⠉⠳⠤⠤⠴⢦⡄⠸⣷⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣀⡿⠿⠾⠀⠀⠀⠀⠀⢴⣦⡀⠀⠀⠀⣠⠟⠀⢹⡇⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣸⡟⠀⣴⡄⠀⢀⡄⠀⠀⣦⡈⠃⠀⠀⡾⣳⣄⠀⣼⡇⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⣠⡶⠟⠻⠶⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡿⠀⠀⠿⠁⢀⡞⠁⠀⠀⣿⠗⠀⠀⠀⣟⢮⣿⣆⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⢸⠏⠀⠀⠀⣰⡏⠀⠀⠀⠀⠀⠀⠀⠀⠀⢰⡇⠀⠀⠀⠰⣯⡀⠀⠀⠀⠀⠀⠀⠀⠀⠪⣳⡵⡿⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⢸⡀⠀⠀⢰⡟⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⣇⠀⣦⣀⠀⠈⠉⢀⣀⣰⣦⡀⠀⠀⠀⠀⠈⠉⣷⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠘⣷⠀⠀⠘⢷⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢿⡆⠻⠦⣌⣉⣉⣁⡤⠔⠻⡇⠀⠀⠀⣀⣠⣼⠏⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⢠⡾⠛⠉⠙⠛⠲⢦⣄⠀⠙⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢿⣄⠀⠀⠲⠇⠀⠀⠀⠀⠀⠀⢀⣴⢏⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⢸⣇⣀⣀⣀⡀⠀⠀⠈⣧⠀⠈⣿⣦⣄⡀⠀⠀⠀⠀⠀⠀⢀⣻⣦⣄⠀⠀⠀⠀⠀⠀⡠⠔⣿⠓⢶⣤⣄⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⢸⠟⠁⠀⠈⠉⠙⠳⢴⡏⠀⠀⣿⡇⠈⠙⠻⠶⠤⠴⠶⠛⠋⠹⡀⠈⠻⣶⣤⠤⠄⣀⣠⠞⠁⠀⢸⠀⠈⠙⠳⢦⣄⠀⠀⠀⠀⠀⠀⠀",
  "⠸⣧⣤⣤⣤⣤⣀⡀⠀⣷⢀⣼⠃⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⢦⣀⠀⠉⠉⠉⠉⠀⠀⢀⣴⠏⠀⠀⠀⠀⠀⠉⠻⣦⣄⠀⠀⠀⠀",
  "⢰⡏⠀⢠⠀⠀⠈⠉⢺⠁⢈⡞⢀⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠛⠒⢦⠀⠀⠀⢸⠋⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⢷⡄⠀⠀",
  "⠀⠻⣦⣈⠙⠶⠤⠴⢞⣠⠞⢀⡞⠀⠀⠀⠀⠀⠀⠀⠀⢀⣦⠀⠀⠀⠀⠀⠀⢸⠀⠀⠀⠈⡆⠀⠀⠀⢰⠀⠀⠀⠀⠀⠀⠀⠈⠻⣆⠀",
  "⠀⠀⠈⠉⠉⠛⠛⠛⠯⢤⣤⣎⣀⠀⠀⠀⢀⣀⣠⣤⣾⠛⠁⠀⠀⠀⠀⠀⠀⠀⡇⠀⠀⠀⢻⠀⠀⠀⠈⡆⠀⠀⡀⠀⠀⠀⠀⠀⠙⣇",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠙⠛⠛⠛⠛⠉⠉⠠⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⢇⠀⠀⠀⠀⡇⠀⠀⠀⡇⠀⣰⠏⠀⠀⠀⠀⠀⠀⡿",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢿⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⠀⠀⠀⠀⢃⠀⠀⠀⢸⣰⠁⠀⠀⠀⠀⠀⠀⣸⠇",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⡄⠀⠀⠀⠀⠀⠀⠀⠀⢸⡄⠀⠀⠀⢸⠀⠀⢀⣸⡇⠀⠀⠀⠀⠀⠀⣰⠏⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⠛⠢⣄⡀⠀⠀⠀⠀⠀⢸⡇⠀⠀⠀⠸⣤⠴⠛⠁⣿⠤⢤⡀⠀⢀⡼⠏⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠛⠒⠚⠛⠛⠛⠒⠶⠶⠞⠁⠀⠀⠀⠀⠙⠒⠒⠒⠻⠤⠤⠼⠶⠛⠀⠀⠀⠀",
];

// ── Pixel grid (decoded once at module load) ────────────────

interface PixelGrid {
  width: number;
  height: number;
  data: Uint8Array; // 1 byte per pixel (0 or 1)
}

function decodeBraille(lines: readonly string[]): PixelGrid {
  // Count characters in the first line (handles multi-byte correctly)
  const charCols = [...lines[0]!].length;
  const charRows = lines.length;
  const width = charCols * 2;
  const height = charRows * 4;
  const data = new Uint8Array(width * height);

  for (let row = 0; row < charRows; row++) {
    const chars = [...lines[row]!];
    for (let col = 0; col < chars.length; col++) {
      const code = chars[col]!.codePointAt(0)! - BRAILLE_BASE;
      if (code <= 0) continue;
      for (const [dy, dx, bit] of DOT_BITS) {
        if (code & bit) {
          const px = col * 2 + dx;
          const py = row * 4 + dy;
          data[py * width + px] = 1;
        }
      }
    }
  }

  return { width, height, data };
}

/** The source pixel grid — decoded once. 100px wide × 88px tall. */
const SOURCE = decodeBraille(VAULT_BOY_SOURCE);

// ── Scaling & encoding ──────────────────────────────────────

/**
 * Downscale a pixel grid by an arbitrary factor using area sampling (OR).
 * If any source pixel in the block is set, the output pixel is set.
 */
function downscale(src: PixelGrid, factor: number): PixelGrid {
  const width = Math.floor(src.width / factor);
  const height = Math.floor(src.height / factor);
  const data = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Sample the source block
      const sx0 = Math.floor(x * factor);
      const sy0 = Math.floor(y * factor);
      const sx1 = Math.min(Math.floor((x + 1) * factor), src.width);
      const sy1 = Math.min(Math.floor((y + 1) * factor), src.height);

      let found = false;
      for (let sy = sy0; sy < sy1 && !found; sy++) {
        for (let sx = sx0; sx < sx1 && !found; sx++) {
          if (src.data[sy * src.width + sx]) {
            found = true;
          }
        }
      }
      if (found) {
        data[y * width + x] = 1;
      }
    }
  }

  return { width, height, data };
}

/** Encode a pixel grid back to braille character lines. */
function encodeBraille(grid: PixelGrid): string[] {
  // Braille chars are 2 wide × 4 tall
  const charW = Math.floor(grid.width / 2);
  const charH = Math.floor(grid.height / 4);
  const lines: string[] = [];

  for (let cy = 0; cy < charH; cy++) {
    const chars: string[] = [];
    for (let cx = 0; cx < charW; cx++) {
      let code = 0;
      for (const [dy, dx, bit] of DOT_BITS) {
        const px = cx * 2 + dx;
        const py = cy * 4 + dy;
        if (px < grid.width && py < grid.height && grid.data[py * grid.width + px]) {
          code |= bit;
        }
      }
      chars.push(String.fromCodePoint(BRAILLE_BASE + code));
    }
    lines.push(chars.join(""));
  }

  return lines;
}

// ── Cache ───────────────────────────────────────────────────

let cachedLines: string[] | null = null;
let cachedMaxCols = -1;
let cachedMaxRows = -1;

// ── Public API ──────────────────────────────────────────────

/**
 * Get the Vault Boy art scaled to fit within the given character dimensions.
 *
 * @param maxCols  Maximum character columns available
 * @param maxRows  Maximum character rows available
 * @returns Array of braille strings, one per line
 */
export function getScaledArt(maxCols: number, maxRows: number): string[] {
  // Return cached result if dimensions haven't changed
  if (cachedLines && cachedMaxCols === maxCols && cachedMaxRows === maxRows) {
    return cachedLines;
  }

  // Source dimensions in characters
  const srcCharW = SOURCE.width / 2;  // 50
  const srcCharH = SOURCE.height / 4; // 22

  // If the source fits, return it directly
  if (srcCharW <= maxCols && srcCharH <= maxRows) {
    cachedLines = encodeBraille(SOURCE);
    cachedMaxCols = maxCols;
    cachedMaxRows = maxRows;
    return cachedLines;
  }

  // Calculate scale factor needed to fit
  // Target pixel dimensions (each braille char = 2px wide × 4px tall)
  const targetPixelW = maxCols * 2;
  const targetPixelH = maxRows * 4;

  const scaleX = SOURCE.width / targetPixelW;
  const scaleY = SOURCE.height / targetPixelH;
  const factor = Math.max(scaleX, scaleY);

  const scaled = downscale(SOURCE, factor);
  cachedLines = encodeBraille(scaled);
  cachedMaxCols = maxCols;
  cachedMaxRows = maxRows;
  return cachedLines;
}

/** Source dimensions in characters (for reference). */
export const SOURCE_CHAR_WIDTH = 50;
export const SOURCE_CHAR_HEIGHT = 22;

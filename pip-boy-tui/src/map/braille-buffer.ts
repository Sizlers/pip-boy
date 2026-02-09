/**
 * BrailleBuffer — pixel buffer to Unicode braille character conversion
 *
 * Each braille character (U+2800–U+28FF) represents a 2x4 dot grid,
 * giving us 2x horizontal and 4x vertical resolution over regular characters.
 *
 * Dot positions mapped to bit values:
 *   [0] [3]     bit 0x01  bit 0x08
 *   [1] [4]     bit 0x02  bit 0x10
 *   [2] [5]     bit 0x04  bit 0x20
 *   [6] [7]     bit 0x40  bit 0x80
 *
 * Ported from MapSCII's BrailleBuffer (MIT license)
 */

import { xterm2hex } from "./utils.ts";

const BRAILLE_OFFSET = 0x2800;

// Map pixel position within a 2x4 cell to its braille bit
// brailleMap[row][col] = bit mask
const BRAILLE_MAP: number[][] = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

export class BrailleBuffer {
  readonly width: number; // pixel width
  readonly height: number; // pixel height
  readonly charWidth: number; // character columns (width / 2)
  readonly charHeight: number; // character rows (height / 4)

  private pixelBuffer: Uint8Array; // braille dot bits per cell
  private foregroundBuffer: Uint8Array; // xterm-256 foreground colour per cell
  private backgroundBuffer: Uint8Array; // xterm-256 background colour per cell
  private charBuffer: (string | null)[]; // override character per cell (for text labels)

  globalBackground: number = 0;

  constructor(width: number, height: number) {
    // Round to braille cell boundaries
    this.width = width - (width % 2);
    this.height = height - (height % 4);
    this.charWidth = this.width >> 1;
    this.charHeight = this.height >> 2;

    const cellCount = this.charWidth * this.charHeight;
    this.pixelBuffer = new Uint8Array(cellCount);
    this.foregroundBuffer = new Uint8Array(cellCount);
    this.backgroundBuffer = new Uint8Array(cellCount);
    this.charBuffer = new Array(cellCount).fill(null);
  }

  clear(): void {
    this.pixelBuffer.fill(0);
    this.foregroundBuffer.fill(0);
    this.backgroundBuffer.fill(0);
    this.charBuffer.fill(null);
  }

  setPixel(x: number, y: number, color: number): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const idx = this._cellIndex(x, y);
    const row = BRAILLE_MAP[y & 3];
    if (!row) return;
    const mask = row[x & 1];
    if (mask === undefined) return;
    this.pixelBuffer[idx]! |= mask;
    this.foregroundBuffer[idx] = color;
  }

  unsetPixel(x: number, y: number): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const idx = this._cellIndex(x, y);
    const row = BRAILLE_MAP[y & 3];
    if (!row) return;
    const mask = row[x & 1];
    if (mask === undefined) return;
    this.pixelBuffer[idx]! &= ~mask;
  }

  setBackground(x: number, y: number, color: number): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const idx = this._cellIndex(x, y);
    this.backgroundBuffer[idx] = color;
  }

  setChar(char: string, x: number, y: number, color: number): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const idx = this._cellIndex(x, y);
    this.charBuffer[idx] = char;
    this.foregroundBuffer[idx] = color;
  }

  writeText(text: string, x: number, y: number, color: number, center = true): void {
    if (center) {
      x -= Math.floor(text.length) + 1;
    }
    for (let i = 0; i < text.length; i++) {
      this.setChar(text.charAt(i), x + i * 2, y, color);
    }
  }

  /** Render the buffer to an array of strings (one per row of characters) */
  toLines(): string[] {
    const lines: string[] = [];
    let currentColor: string | null = null;
    const termReset = "\x1B[39;49m";

    for (let cy = 0; cy < this.charHeight; cy++) {
      const parts: string[] = [];
      let skip = 0;

      for (let cx = 0; cx < this.charWidth; cx++) {
        const idx = cy * this.charWidth + cx;

        const colorCode = this._termColor(
          this.foregroundBuffer[idx]!,
          this.backgroundBuffer[idx]!,
        );
        if (currentColor !== colorCode) {
          parts.push((currentColor = colorCode));
        }

        const char = this.charBuffer[idx] ?? null;
        if (char !== null && char !== undefined) {
          if (skip > 0) {
            skip--;
          } else {
            parts.push(char);
            // Multi-width chars take extra columns
            const w = char.length > 1 ? char.length - 1 : 0;
            skip += w;
          }
        } else {
          if (skip > 0) {
            skip--;
          } else {
            parts.push(
              String.fromCharCode(BRAILLE_OFFSET + this.pixelBuffer[idx]!),
            );
          }
        }
      }

      parts.push(termReset);
      lines.push(parts.join(""));
    }

    return lines;
  }

  /** Render entire buffer to a single string with newlines */
  frame(): string {
    return this.toLines().join("\n");
  }

  /** Render buffer as plain braille text (no ANSI codes) for use with external styling */
  toPlainLines(): string[] {
    const lines: string[] = [];

    for (let cy = 0; cy < this.charHeight; cy++) {
      const parts: string[] = [];
      let skip = 0;

      for (let cx = 0; cx < this.charWidth; cx++) {
        const idx = cy * this.charWidth + cx;

        const char = this.charBuffer[idx] ?? null;
        if (char !== null && char !== undefined) {
          if (skip > 0) {
            skip--;
          } else {
            parts.push(char);
            const w = char.length > 1 ? char.length - 1 : 0;
            skip += w;
          }
        } else {
          if (skip > 0) {
            skip--;
          } else {
            parts.push(
              String.fromCharCode(BRAILLE_OFFSET + (this.pixelBuffer[idx] ?? 0)),
            );
          }
        }
      }

      lines.push(parts.join(""));
    }

    return lines;
  }

  /** Render buffer as rows of cells with per-cell colour info for TUI styling */
  toColoredCells(): Array<Array<{ char: string; fgHex: string }>> {
    const rows: Array<Array<{ char: string; fgHex: string }>> = [];

    for (let cy = 0; cy < this.charHeight; cy++) {
      const row: Array<{ char: string; fgHex: string }> = [];
      let skip = 0;

      for (let cx = 0; cx < this.charWidth; cx++) {
        const idx = cy * this.charWidth + cx;
        const fgColor = this.foregroundBuffer[idx]!;
        const fgHex = fgColor ? xterm2hex(fgColor) : "#000000";

        const char = this.charBuffer[idx] ?? null;
        if (char !== null && char !== undefined) {
          if (skip > 0) {
            skip--;
          } else {
            row.push({ char, fgHex });
            const w = char.length > 1 ? char.length - 1 : 0;
            skip += w;
          }
        } else {
          if (skip > 0) {
            skip--;
          } else {
            row.push({
              char: String.fromCharCode(BRAILLE_OFFSET + (this.pixelBuffer[idx] ?? 0)),
              fgHex,
            });
          }
        }
      }

      rows.push(row);
    }

    return rows;
  }

  private _cellIndex(x: number, y: number): number {
    return (x >> 1) + this.charWidth * (y >> 2);
  }

  private _termColor(fg: number, bg: number): string {
    const effectiveBg = bg || this.globalBackground;
    if (fg && effectiveBg) {
      return `\x1B[38;5;${fg};48;5;${effectiveBg}m`;
    } else if (fg) {
      return `\x1B[49;38;5;${fg}m`;
    } else if (effectiveBg) {
      return `\x1B[39;48;5;${effectiveBg}m`;
    } else {
      return "\x1B[39;49m";
    }
  }
}

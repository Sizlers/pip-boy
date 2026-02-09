/**
 * LabelBuffer — spatial label collision avoidance
 *
 * Uses RBush (2D spatial index) to track placed labels and prevent overlapping.
 * Only places a label if there's sufficient space in the viewport.
 *
 * Ported from MapSCII's LabelBuffer (MIT license)
 */

import RBush from "rbush";

interface LabelEntry {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  text: string;
  feature?: unknown;
}

export class LabelBuffer {
  private tree: RBush<LabelEntry>;
  private defaultMargin: number;

  constructor(margin = 5) {
    this.tree = new RBush<LabelEntry>();
    this.defaultMargin = margin;
  }

  clear(): void {
    this.tree.clear();
  }

  /**
   * Try to place a label. Returns true if placed, false if collision detected.
   * Coordinates are in pixel space (braille pixels).
   */
  writeIfPossible(
    text: string,
    x: number,
    y: number,
    feature?: unknown,
    margin?: number,
  ): boolean {
    margin = margin ?? this.defaultMargin;

    // Project pixel coords to character coords for collision
    const cx = Math.floor(x / 2);
    const cy = Math.floor(y / 4);

    if (this._hasSpace(text, cx, cy, margin)) {
      const area = this._calculateArea(text, cx, cy, margin);
      area.text = text;
      area.feature = feature;
      this.tree.insert(area);
      return true;
    }
    return false;
  }

  /** Check what features are at a character position */
  featuresAt(x: number, y: number): LabelEntry[] {
    return this.tree.search({ minX: x, maxX: x, minY: y, maxY: y });
  }

  private _hasSpace(text: string, x: number, y: number, margin: number): boolean {
    return !this.tree.collides(this._calculateArea(text, x, y, margin));
  }

  private _calculateArea(
    text: string,
    x: number,
    y: number,
    margin = 0,
  ): LabelEntry {
    return {
      minX: x - margin,
      minY: y - Math.floor(margin / 2),
      maxX: x + margin + text.length,
      maxY: y + Math.floor(margin / 2),
      text: "",
    };
  }
}

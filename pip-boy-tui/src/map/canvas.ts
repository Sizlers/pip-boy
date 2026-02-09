/**
 * Canvas — drawing primitives on top of BrailleBuffer
 *
 * Provides line (Bresenham), polyline, polygon (earcut triangulation),
 * filled triangle, and text rendering.
 *
 * Ported from MapSCII's Canvas (MIT license)
 */

import earcut from "earcut";
import { BrailleBuffer } from "./braille-buffer.ts";

export interface Point {
  x: number;
  y: number;
}

export class Canvas {
  readonly width: number;
  readonly height: number;
  readonly buffer: BrailleBuffer;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.buffer = new BrailleBuffer(width, height);
  }

  frame(): string {
    return this.buffer.frame();
  }

  toLines(): string[] {
    return this.buffer.toLines();
  }

  toPlainLines(): string[] {
    return this.buffer.toPlainLines();
  }

  toColoredCells(): Array<Array<{ char: string; fgHex: string }>> {
    return this.buffer.toColoredCells();
  }

  clear(): void {
    this.buffer.clear();
  }

  setBackground(color: number): void {
    this.buffer.globalBackground = color;
  }

  background(x: number, y: number, color: number): void {
    this.buffer.setBackground(x, y, color);
  }

  text(text: string, x: number, y: number, color: number, center = false): void {
    this.buffer.writeText(text, x, y, color, center);
  }

  /** Draw a single pixel */
  pixel(x: number, y: number, color: number): void {
    this.buffer.setPixel(x, y, color);
  }

  /** Draw a line between two points using Bresenham's algorithm */
  line(from: Point, to: Point, color: number, width = 1): void {
    this._line(from.x, from.y, to.x, to.y, color, width);
  }

  /** Draw a connected series of line segments */
  polyline(points: Point[], color: number, width = 1): void {
    for (let i = 1; i < points.length; i++) {
      this._line(
        points[i - 1]!.x, points[i - 1]!.y,
        points[i]!.x, points[i]!.y,
        color, width,
      );
    }
  }

  /** Draw a filled polygon (supports holes via multiple rings) */
  polygon(rings: Point[][], color: number): boolean {
    const vertices: number[] = [];
    const holes: number[] = [];

    for (const ring of rings) {
      if (vertices.length) {
        if (ring.length < 3) continue;
        holes.push(vertices.length / 2);
      } else {
        if (ring.length < 3) return false;
      }
      for (const point of ring) {
        vertices.push(point.x);
        vertices.push(point.y);
      }
    }

    let triangles: number[];
    try {
      triangles = earcut(vertices, holes.length ? holes : undefined);
    } catch {
      return false;
    }

    for (let i = 0; i < triangles.length; i += 3) {
      const pa = this._extractVertex(vertices, triangles[i]!);
      const pb = this._extractVertex(vertices, triangles[i + 1]!);
      const pc = this._extractVertex(vertices, triangles[i + 2]!);
      this._filledTriangle(pa, pb, pc, color);
    }
    return true;
  }

  /** Draw a marker (small cross) at a point */
  marker(x: number, y: number, color: number, size = 3): void {
    for (let i = -size; i <= size; i++) {
      this.buffer.setPixel(x + i, y, color);
      this.buffer.setPixel(x, y + i, color);
    }
    // Corner dots for visibility
    this.buffer.setPixel(x - 1, y - 1, color);
    this.buffer.setPixel(x + 1, y - 1, color);
    this.buffer.setPixel(x - 1, y + 1, color);
    this.buffer.setPixel(x + 1, y + 1, color);
  }

  // ── Private drawing methods ──────────────────────────────────

  private _extractVertex(vertices: number[], idx: number): [number, number] {
    return [vertices[idx * 2]!, vertices[idx * 2 + 1]!];
  }

  /**
   * Bresenham line with variable width.
   * Based on Alois Zingl's "The Beauty of Bresenham's Algorithm"
   */
  private _line(
    x0: number, y0: number,
    x1: number, y1: number,
    color: number, width: number,
  ): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);

    // Simple Bresenham for width <= 1
    if (width <= 1) {
      this._bresenhamLine(x0, y0, x1, y1, color);
      return;
    }

    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    const ed = dx + dy === 0 ? 1 : Math.sqrt(dx * dx + dy * dy);
    const wd = (width + 1) / 2;

    for (;;) {
      this.buffer.setPixel(x0, y0, color);
      let e2 = err;
      let x2 = x0;

      if (2 * e2 >= -dx) {
        e2 += dy;
        let y2 = y0;
        while (e2 < ed * wd && (y1 !== y2 || dx > dy)) {
          this.buffer.setPixel(x0, (y2 += sy), color);
          e2 += dx;
        }
        if (x0 === x1) break;
        e2 = err;
        err -= dy;
        x0 += sx;
      }
      if (2 * e2 <= dy) {
        e2 = dx - e2;
        while (e2 < ed * wd && (x1 !== x2 || dx < dy)) {
          this.buffer.setPixel((x2 += sx), y0, color);
          e2 += dy;
        }
        if (y0 === y1) break;
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Simple Bresenham line (width = 1) */
  private _bresenhamLine(
    x0: number, y0: number,
    x1: number, y1: number,
    color: number,
  ): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    for (;;) {
      this.buffer.setPixel(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Bresenham points between two vertices (for triangle fill) */
  private _bresenhamPoints(
    ax: number, ay: number,
    bx: number, by: number,
  ): Point[] {
    const points: Point[] = [];
    const dx = Math.abs(bx - ax);
    const dy = Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let err = dx - dy;
    let x = ax, y = ay;

    for (;;) {
      points.push({ x, y });
      if (x === bx && y === by) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
    return points;
  }

  /** Draw a filled triangle using scanline fill */
  private _filledTriangle(
    pa: [number, number],
    pb: [number, number],
    pc: [number, number],
    color: number,
  ): void {
    const edgeA = this._bresenhamPoints(pb[0], pb[1], pc[0], pc[1]);
    const edgeB = this._bresenhamPoints(pa[0], pa[1], pc[0], pc[1]);
    const edgeC = this._bresenhamPoints(pa[0], pa[1], pb[0], pb[1]);

    const allPoints = edgeA
      .concat(edgeB)
      .concat(edgeC)
      .filter((p) => p.y >= 0 && p.y < this.height)
      .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));

    for (let i = 0; i < allPoints.length; i++) {
      const point = allPoints[i]!;
      const next = allPoints[i + 1];

      if (next && point.y === next.y) {
        const left = Math.max(0, point.x);
        const right = Math.min(this.width - 1, next.x);
        for (let x = left; x <= right; x++) {
          this.buffer.setPixel(x, point.y, color);
        }
      } else {
        this.buffer.setPixel(point.x, point.y, color);
      }

      if (!next) break;
    }
  }
}

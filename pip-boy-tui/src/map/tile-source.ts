/**
 * TileSource — read vector tiles from .mbtiles (Bun SQLite), HTTP, or cache
 *
 * Supports:
 *   - Local .mbtiles files via Bun's built-in bun:sqlite (no native deps)
 *   - Remote HTTP tile servers (e.g., mapscii.me)
 *   - LRU tile cache to avoid redundant parsing
 *
 * Ported from MapSCII's TileSource (MIT license)
 */

import { Database } from "bun:sqlite";
import { parseTile, type ParsedTile } from "./tile-parser.ts";
import { compileStyle, type CompiledStyle } from "./styles.ts";

// ── Types ───────────────────────────────────────────────────

export type SourceMode = "mbtiles" | "http";

export interface TileSourceOptions {
  /** Path to .mbtiles file, or HTTP URL */
  source: string;
  /** Max tiles to keep in cache */
  cacheSize?: number;
  /** Language for label extraction */
  language?: string;
}

// ── TileSource ──────────────────────────────────────────────

export class TileSource {
  private mode: SourceMode;
  private source: string;
  private db: Database | null = null;
  private cache = new Map<string, ParsedTile>();
  private cacheOrder: string[] = [];
  private cacheSize: number;
  private language: string;
  private byLayer: Map<string, CompiledStyle[]>;

  constructor(options: TileSourceOptions) {
    this.source = options.source;
    this.cacheSize = options.cacheSize ?? 32;
    this.language = options.language ?? "en";

    const { byLayer } = compileStyle();
    this.byLayer = byLayer;

    if (this.source.startsWith("http")) {
      this.mode = "http";
    } else if (this.source.endsWith(".mbtiles")) {
      this.mode = "mbtiles";
      this._openMBTiles();
    } else {
      throw new Error(`Unsupported tile source: ${this.source}`);
    }
  }

  /** Get a parsed tile at z/x/y */
  async getTile(z: number, x: number, y: number): Promise<ParsedTile> {
    const key = `${z}-${x}-${y}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    let buffer: Buffer | Uint8Array;

    switch (this.mode) {
      case "mbtiles":
        buffer = this._getMBTile(z, x, y);
        break;
      case "http":
        buffer = await this._getHTTP(z, x, y);
        break;
    }

    const parsed = parseTile(buffer, this.byLayer, this.language);
    this._cacheSet(key, parsed);
    return parsed;
  }

  /** Get metadata from the MBTiles file */
  getMetadata(): Record<string, string> {
    if (!this.db) return {};
    const rows = this.db.query("SELECT name, value FROM metadata").all() as Array<{
      name: string;
      value: string;
    }>;
    return Object.fromEntries(rows.map((r) => [r.name, r.value]));
  }

  /** Close the database connection */
  close(): void {
    this.db?.close();
    this.db = null;
  }

  // ── MBTiles ─────────────────────────────────────────────

  private _openMBTiles(): void {
    try {
      this.db = new Database(this.source, { readonly: true });
    } catch (err) {
      throw new Error(`Failed to open MBTiles file: ${this.source}: ${err}`);
    }
  }

  private _getMBTile(z: number, x: number, y: number): Buffer {
    if (!this.db) throw new Error("MBTiles database not open");

    // MBTiles uses TMS y-coordinate (flipped)
    const tmsY = (1 << z) - 1 - y;

    const row = this.db
      .query("SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?")
      .get(z, x, tmsY) as { tile_data: Buffer } | null;

    if (!row) {
      // Return empty tile
      return Buffer.alloc(0);
    }

    return row.tile_data;
  }

  // ── HTTP ────────────────────────────────────────────────

  private async _getHTTP(z: number, x: number, y: number): Promise<Buffer> {
    const url = `${this.source}${z}/${x}/${y}.pbf`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        return Buffer.alloc(0);
      }
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch {
      return Buffer.alloc(0);
    }
  }

  // ── Cache ───────────────────────────────────────────────

  private _cacheSet(key: string, tile: ParsedTile): void {
    this.cache.set(key, tile);
    this.cacheOrder.push(key);

    // Evict oldest entries if over capacity
    while (this.cacheOrder.length > this.cacheSize) {
      const evict = this.cacheOrder.shift();
      if (evict) this.cache.delete(evict);
    }
  }
}

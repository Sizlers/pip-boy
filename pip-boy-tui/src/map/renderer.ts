/**
 * MapRenderer — orchestrate tile loading, parsing, styling, and braille rendering
 *
 * This is the main entry point for the map system. It:
 *   1. Determines which tiles are visible at the current viewport
 *   2. Loads and parses them via TileSource
 *   3. Queries spatial indices for features in view
 *   4. Renders features (lines, polygons, symbols) to the Canvas
 *   5. Returns braille character lines for the TUI
 *
 * Ported from MapSCII's Renderer (MIT license), heavily adapted for
 * TypeScript and the Pip-Boy TUI integration.
 */

import { Canvas, type Point } from "./canvas.ts";
import { LabelBuffer } from "./label-buffer.ts";
import { TileSource, type TileSourceOptions } from "./tile-source.ts";
import { compileStyle, getDrawOrder, XTERM, type CompiledStyle } from "./styles.ts";
import type { ParsedTile, TileFeature } from "./tile-parser.ts";
import {
  ll2tile,
  tile2ll,
  baseZoom,
  tileSizeAtZoom,
  normalize,
  metersPerPixel,
  formatDistance,
  type LatLon,
  type TileCoord,
} from "./utils.ts";

// ── Types ───────────────────────────────────────────────────

export interface MapState {
  center: LatLon;
  zoom: number;
}

interface VisibleTile {
  xyz: TileCoord;
  zoom: number;
  position: Point;
  size: number;
  data?: ParsedTile;
  layers?: Record<string, {
    scale: number;
    features: TileFeature[];
  }>;
}

export interface ColoredCell {
  char: string;
  fgHex: string;
}

export interface RenderResult {
  /** Lines with embedded ANSI colour codes (for raw terminal output) */
  lines: string[];
  /** Plain braille lines without ANSI codes (for use with external styling like OpenTUI) */
  plainLines: string[];
  /** Per-cell colour data for TUI styling (rows of cells with hex colour) */
  coloredCells: ColoredCell[][];
  center: LatLon;
  zoom: number;
  scale: string;
}

// ── Config ──────────────────────────────────────────────────

const MAX_ZOOM = 18;
const MIN_ZOOM = 0;
const ZOOM_STEP = 0.5;
const PAN_PIXELS = 32;
const TILE_PADDING = 64;
const SIMPLIFY_POLYLINES = false;
const POI_MARKER = "\u25C9"; // ◉
const LABEL_MARGIN = 5;

// ── MapRenderer ─────────────────────────────────────────────

export class MapRenderer {
  private tileSource: TileSource;
  private canvas: Canvas;
  private labelBuffer: LabelBuffer;
  private styleById: Map<string, CompiledStyle>;
  private styleByLayer: Map<string, CompiledStyle[]>;

  private width: number;
  private height: number;
  private isDrawing = false;

  state: MapState;

  // GPS marker position (null if no fix)
  gpsPosition: LatLon | null = null;

  // Waypoint (null if not set)
  waypoint: LatLon | null = null;

  // Route overlay (null if no route)
  route: LatLon[] | null = null;
  routeStart: LatLon | null = null;
  routeEnd: LatLon | null = null;

  constructor(
    width: number,
    height: number,
    tileSourceOptions: TileSourceOptions,
    initialState?: Partial<MapState>,
  ) {
    this.width = width;
    this.height = height;

    this.canvas = new Canvas(width, height);
    this.labelBuffer = new LabelBuffer(LABEL_MARGIN);
    this.tileSource = new TileSource(tileSourceOptions);

    const { byId, byLayer } = compileStyle();
    this.styleById = byId;
    this.styleByLayer = byLayer;

    this.state = {
      center: initialState?.center ?? { lat: 53.3498, lon: -6.2603 }, // Dublin default
      zoom: initialState?.zoom ?? 12,
    };
  }

  // ── Public API ────────────────────────────────────────────

  /** Render the current view and return lines of braille text */
  async draw(): Promise<RenderResult> {
    if (this.isDrawing) {
      return {
        lines: this.canvas.toLines(),
        plainLines: this.canvas.toPlainLines(),
        coloredCells: this.canvas.toColoredCells(),
        center: this.state.center,
        zoom: this.state.zoom,
        scale: this._scaleBar(),
      };
    }

    this.isDrawing = true;
    this.labelBuffer.clear();

    // Set background
    const bgStyle = this.styleById.get("background");
    if (bgStyle) {
      this.canvas.setBackground(bgStyle.color);
    }
    this.canvas.clear();

    try {
      // Get visible tiles
      const tiles = this._visibleTiles();

      // Load tile data in parallel
      await Promise.all(
        tiles.map(async (tile) => {
          try {
            tile.data = await this.tileSource.getTile(
              tile.xyz.z, tile.xyz.x, tile.xyz.y,
            );
          } catch {
            // Skip tiles that fail to load
          }
        }),
      );

      // Extract features visible in viewport
      for (const tile of tiles) {
        if (tile.data) {
          this._extractTileFeatures(tile);
        }
      }

      // Render features in draw order
      this._renderTiles(tiles);

      // Draw GPS marker if available
      if (this.gpsPosition) {
        this._drawGpsMarker();
      }

      // Draw waypoint if set
      if (this.waypoint) {
        this._drawWaypoint();
      }

      // Draw route overlay if set
      if (this.route) {
        this._drawRoute();
      }

      return {
        lines: this.canvas.toLines(),
        plainLines: this.canvas.toPlainLines(),
        coloredCells: this.canvas.toColoredCells(),
        center: this.state.center,
        zoom: this.state.zoom,
        scale: this._scaleBar(),
      };
    } finally {
      this.isDrawing = false;
    }
  }

  /** Resize the rendering viewport */
  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.canvas = new Canvas(width, height);
  }

  /** Pan by a number of pixels in screen space */
  pan(dx: number, dy: number): void {
    const z = baseZoom(this.state.zoom);
    const tileSize = tileSizeAtZoom(this.state.zoom);
    const center = ll2tile(this.state.center.lon, this.state.center.lat, z);

    center.x += dx / tileSize;
    center.y += dy / tileSize;

    const ll = tile2ll(center.x, center.y, z);
    this.state.center = normalize(ll);
  }

  panLeft(): void { this.pan(-PAN_PIXELS, 0); }
  panRight(): void { this.pan(PAN_PIXELS, 0); }
  panUp(): void { this.pan(0, -PAN_PIXELS); }
  panDown(): void { this.pan(0, PAN_PIXELS); }

  zoomIn(): void {
    this.state.zoom = Math.min(MAX_ZOOM, this.state.zoom + ZOOM_STEP);
  }

  zoomOut(): void {
    this.state.zoom = Math.max(MIN_ZOOM, this.state.zoom - ZOOM_STEP);
  }

  /** Centre on a lat/lon position */
  centerOn(ll: LatLon): void {
    this.state.center = normalize(ll);
  }

  /** Centre on the GPS position (if available) */
  centerOnGps(): void {
    if (this.gpsPosition) {
      this.centerOn(this.gpsPosition);
    }
  }

  /** Set a waypoint */
  setWaypoint(ll: LatLon): void {
    this.waypoint = normalize(ll);
  }

  clearWaypoint(): void {
    this.waypoint = null;
  }

  /** Set a route overlay to draw on the map */
  setRoute(geometry: LatLon[], start: LatLon, end: LatLon): void {
    this.route = geometry;
    this.routeStart = start;
    this.routeEnd = end;
  }

  /** Clear the route overlay */
  clearRoute(): void {
    this.route = null;
    this.routeStart = null;
    this.routeEnd = null;
  }

  /** Fit the view to show the entire route (or two points) */
  fitBounds(points: LatLon[], padding = 0.2): void {
    if (points.length === 0) return;

    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;

    for (const p of points) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }

    // Center on midpoint
    this.state.center = normalize({
      lat: (minLat + maxLat) / 2,
      lon: (minLon + maxLon) / 2,
    });

    // Compute zoom to fit bounds
    const latSpan = (maxLat - minLat) * (1 + padding);
    const lonSpan = (maxLon - minLon) * (1 + padding);
    const span = Math.max(latSpan, lonSpan);

    if (span < 0.001) this.state.zoom = 17;
    else if (span < 0.005) this.state.zoom = 16;
    else if (span < 0.01) this.state.zoom = 15;
    else if (span < 0.05) this.state.zoom = 13;
    else if (span < 0.1) this.state.zoom = 12;
    else if (span < 0.5) this.state.zoom = 10;
    else if (span < 1) this.state.zoom = 9;
    else if (span < 2) this.state.zoom = 8;
    else if (span < 5) this.state.zoom = 7;
    else if (span < 10) this.state.zoom = 6;
    else this.state.zoom = 5;
  }

  close(): void {
    this.tileSource.close();
  }

  // ── Tile visibility ───────────────────────────────────────

  private _visibleTiles(): VisibleTile[] {
    const z = baseZoom(this.state.zoom);
    const center = ll2tile(this.state.center.lon, this.state.center.lat, z);
    const tileSize = tileSizeAtZoom(this.state.zoom);
    const gridSize = Math.pow(2, z);

    const tiles: VisibleTile[] = [];

    // Check a 3x3 grid of tiles around the centre
    for (let ty = Math.floor(center.y) - 1; ty <= Math.floor(center.y) + 1; ty++) {
      for (let tx = Math.floor(center.x) - 1; tx <= Math.floor(center.x) + 1; tx++) {
        const position: Point = {
          x: this.width / 2 - (center.x - tx) * tileSize,
          y: this.height / 2 - (center.y - ty) * tileSize,
        };

        let wrappedX = tx % gridSize;
        if (wrappedX < 0) wrappedX = z === 0 ? 0 : wrappedX + gridSize;

        // Skip tiles outside valid range or outside viewport
        if (
          ty < 0 || ty >= gridSize ||
          position.x + tileSize < 0 || position.y + tileSize < 0 ||
          position.x > this.width || position.y > this.height
        ) {
          continue;
        }

        tiles.push({
          xyz: { x: wrappedX, y: ty, z },
          zoom: this.state.zoom,
          position,
          size: tileSize,
        });
      }
    }

    return tiles;
  }

  // ── Feature extraction ────────────────────────────────────

  private _extractTileFeatures(tile: VisibleTile): void {
    if (!tile.data) return;

    const position = tile.position;
    const layers: Record<string, { scale: number; features: TileFeature[] }> = {};
    const drawOrder = getDrawOrder(tile.xyz.z);

    for (const layerId of drawOrder) {
      const layer = tile.data.layers[layerId];
      if (!layer) continue;

      const scale = layer.extent / tileSizeAtZoom(tile.zoom);
      layers[layerId] = {
        scale,
        features: layer.tree.search({
          minX: -position.x * scale,
          minY: -position.y * scale,
          maxX: (this.width - position.x) * scale,
          maxY: (this.height - position.y) * scale,
        }),
      };
    }

    tile.layers = layers;
  }

  // ── Rendering ─────────────────────────────────────────────

  private _renderTiles(tiles: VisibleTile[]): void {
    if (tiles.length === 0) return;

    const labels: Array<{ tile: VisibleTile; feature: TileFeature; scale: number }> = [];
    const drawOrder = getDrawOrder(tiles[0]!.xyz.z);

    // Draw non-label features first
    for (const layerId of drawOrder) {
      for (const tile of tiles) {
        const layer = tile.layers?.[layerId];
        if (!layer) continue;

        for (const feature of layer.features) {
          if (layerId.match(/label/)) {
            labels.push({ tile, feature, scale: layer.scale });
          } else {
            this._drawFeature(tile, feature, layer.scale);
          }
        }
      }
    }

    // Sort and draw labels on top
    labels.sort((a, b) => a.feature.sort - b.feature.sort);
    for (const label of labels) {
      this._drawFeature(label.tile, label.feature, label.scale);
    }
  }

  private _drawFeature(
    tile: VisibleTile,
    feature: TileFeature,
    scale: number,
  ): void {
    const style = feature.style;
    if (style.minzoom && tile.zoom < style.minzoom) return;
    if (style.maxzoom && tile.zoom > style.maxzoom) return;

    switch (style.type) {
      case "line": {
        const points = this._scalePoints(tile, feature.points as Point[], scale);
        if (points.length >= 2) {
          this.canvas.polyline(points, feature.color, style.lineWidth);
        }
        break;
      }
      case "fill": {
        const rings = (feature.points as Point[][]).map((ring) =>
          this._scalePoints(tile, ring, scale),
        );
        if (rings.length > 0 && rings[0]!.length >= 3) {
          this.canvas.polygon(rings, feature.color);
        }
        break;
      }
      case "symbol": {
        const text = feature.label || POI_MARKER;
        const pointsOfInterest = this._scalePoints(
          tile,
          feature.points as Point[],
          scale,
        );

        for (const point of pointsOfInterest) {
          const labelX = point.x - text.length;
          if (
            this.labelBuffer.writeIfPossible(
              text, labelX, point.y, feature, LABEL_MARGIN,
            )
          ) {
            this.canvas.text(text, labelX, point.y, feature.color);
            break;
          }
        }
        break;
      }
    }
  }

  /** Transform tile-local coordinates to viewport pixel coordinates */
  private _scalePoints(
    tile: VisibleTile,
    points: Point[],
    scale: number,
  ): Point[] {
    const result: Point[] = [];
    let lastX = -1;
    let lastY = -1;

    for (const point of points) {
      const x = Math.floor(tile.position.x + point.x / scale);
      const y = Math.floor(tile.position.y + point.y / scale);

      // Deduplicate consecutive identical points
      if (x === lastX && y === lastY) continue;
      lastX = x;
      lastY = y;

      // Skip points way outside the viewport
      if (
        x < -TILE_PADDING || x > this.width + TILE_PADDING ||
        y < -TILE_PADDING || y > this.height + TILE_PADDING
      ) {
        continue;
      }

      result.push({ x, y });
    }

    return result;
  }

  // ── GPS & Waypoint markers ────────────────────────────────

  private _drawGpsMarker(): void {
    if (!this.gpsPosition) return;
    const pos = this._llToScreen(this.gpsPosition);
    if (!pos) return;
    this.canvas.marker(pos.x, pos.y, XTERM.gpsMarker, 4);
  }

  private _drawWaypoint(): void {
    if (!this.waypoint) return;
    const pos = this._llToScreen(this.waypoint);
    if (!pos) return;

    // Draw a diamond shape
    const s = 3;
    const color = XTERM.waypoint;
    for (let i = 0; i <= s; i++) {
      this.canvas.buffer.setPixel(pos.x + i, pos.y - s + i, color);
      this.canvas.buffer.setPixel(pos.x - i, pos.y - s + i, color);
      this.canvas.buffer.setPixel(pos.x + i, pos.y + s - i, color);
      this.canvas.buffer.setPixel(pos.x - i, pos.y + s - i, color);
    }
    // Label
    this.canvas.text("WPT", pos.x + s + 2, pos.y, color);
  }

  /** Convert lat/lon to screen pixel coordinates */
  private _llToScreen(ll: LatLon): Point | null {
    const z = baseZoom(this.state.zoom);
    const tileSize = tileSizeAtZoom(this.state.zoom);
    const center = ll2tile(this.state.center.lon, this.state.center.lat, z);
    const target = ll2tile(ll.lon, ll.lat, z);

    const x = Math.floor(this.width / 2 + (target.x - center.x) * tileSize);
    const y = Math.floor(this.height / 2 + (target.y - center.y) * tileSize);

    // Check if on screen (with padding)
    if (x < -20 || x > this.width + 20 || y < -20 || y > this.height + 20) {
      return null;
    }

    return { x, y };
  }

  // ── Route overlay ──────────────────────────────────────────

  private _drawRoute(): void {
    if (!this.route || this.route.length < 2) return;

    const routeColor = XTERM.route;

    // Convert route points to screen coordinates and draw polyline
    const screenPoints: { x: number; y: number }[] = [];
    for (const ll of this.route) {
      const pos = this._llToScreen(ll);
      if (pos) {
        screenPoints.push(pos);
      }
    }

    // Draw route polyline (thick line for visibility)
    if (screenPoints.length >= 2) {
      this.canvas.polyline(screenPoints, routeColor, 2);
    }

    // Draw start marker (green diamond)
    if (this.routeStart) {
      const startPos = this._llToScreen(this.routeStart);
      if (startPos) {
        const s = 4;
        const color = XTERM.routeStart;
        for (let i = 0; i <= s; i++) {
          this.canvas.buffer.setPixel(startPos.x + i, startPos.y - s + i, color);
          this.canvas.buffer.setPixel(startPos.x - i, startPos.y - s + i, color);
          this.canvas.buffer.setPixel(startPos.x + i, startPos.y + s - i, color);
          this.canvas.buffer.setPixel(startPos.x - i, startPos.y + s - i, color);
        }
        this.canvas.text("A", startPos.x + s + 2, startPos.y, color);
      }
    }

    // Draw end marker (red diamond)
    if (this.routeEnd) {
      const endPos = this._llToScreen(this.routeEnd);
      if (endPos) {
        const s = 4;
        const color = XTERM.routeEnd;
        for (let i = 0; i <= s; i++) {
          this.canvas.buffer.setPixel(endPos.x + i, endPos.y - s + i, color);
          this.canvas.buffer.setPixel(endPos.x - i, endPos.y - s + i, color);
          this.canvas.buffer.setPixel(endPos.x + i, endPos.y + s - i, color);
          this.canvas.buffer.setPixel(endPos.x - i, endPos.y + s - i, color);
        }
        this.canvas.text("B", endPos.x + s + 2, endPos.y, color);
      }
    }
  }

  // ── Scale bar ─────────────────────────────────────────────

  private _scaleBar(): string {
    const mpp = metersPerPixel(this.state.zoom, this.state.center.lat);
    // Scale bar ~20 chars wide = 40 braille pixels
    const scaleMeters = mpp * 40;
    return formatDistance(scaleMeters);
  }
}

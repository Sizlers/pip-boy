/**
 * TileParser — parse Mapbox Vector Tile protobuf data and build spatial index
 *
 * Decodes .mvt protobuf tiles using @mapbox/vector-tile + pbf,
 * applies style filters, and indexes features with RBush for
 * efficient viewport queries.
 *
 * Ported from MapSCII's Tile.js (MIT license)
 */

import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import RBush from "rbush";
import { gunzipSync } from "zlib";
import type { CompiledStyle } from "./styles.ts";
import { hex2xterm } from "./utils.ts";

// ── Types ───────────────────────────────────────────────────

export interface TileFeature {
  layer: string;
  style: CompiledStyle;
  label?: string;
  sort: number;
  points: Array<{ x: number; y: number }> | Array<Array<{ x: number; y: number }>>;
  color: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ParsedLayer {
  extent: number;
  tree: RBush<TileFeature>;
}

export interface ParsedTile {
  layers: Record<string, ParsedLayer>;
}

// ── Parser ──────────────────────────────────────────────────

/**
 * Parse a raw vector tile buffer into styled, spatially-indexed features.
 *
 * @param buffer   Raw tile data (may be gzipped)
 * @param byLayer  Compiled style lookup by source-layer name
 * @param language Language code for label extraction (default: "en")
 */
export function parseTile(
  buffer: Buffer | Uint8Array,
  byLayer: Map<string, CompiledStyle[]>,
  language = "en",
): ParsedTile {
  // Decompress if gzipped
  const data = isGzipped(buffer) ? gunzipSync(buffer) : buffer;
  const tile = new VectorTile(new Pbf(data));

  const layers: Record<string, ParsedLayer> = {};

  for (const name in tile.layers) {
    const layer = tile.layers[name]!;
    const styles = byLayer.get(name);
    if (!styles || styles.length === 0) continue;

    const nodes: TileFeature[] = [];

    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);

      // Add $type property for style filtering
      const featureType = ["", "Point", "LineString", "Polygon"][feature.type] || "";
      const props: Record<string, unknown> = {
        ...feature.properties,
        $type: featureType,
      };

      // Find matching style
      let matchedStyle: CompiledStyle | undefined;
      for (const style of styles) {
        if (style.appliesTo({ properties: props })) {
          matchedStyle = style;
          break;
        }
      }
      if (!matchedStyle) continue;

      // Get geometry
      const geometries = feature.loadGeometry();

      // Extract label for symbol layers
      let label: string | undefined;
      if (matchedStyle.type === "symbol") {
        label =
          (props[`name_${language}`] as string) ||
          (props["name_en"] as string) ||
          (props["name"] as string) ||
          (props["house_num"] as string | undefined);
      }

      const sort = (props["localrank"] as number) || (props["scalerank"] as number) || 0;

      if (matchedStyle.type === "fill") {
        // Polygons: points is array of rings
        const rings = geometries.map((ring) =>
          ring.map((p) => ({ x: p.x, y: p.y })),
        );
        nodes.push(addBoundaries(true, {
          layer: name,
          style: matchedStyle,
          label,
          sort,
          points: rings,
          color: matchedStyle.color,
          minX: 0, maxX: 0, minY: 0, maxY: 0,
        }));
      } else {
        // Lines and symbols: each geometry is separate
        for (const geom of geometries) {
          const pts = geom.map((p) => ({ x: p.x, y: p.y }));
          nodes.push(addBoundaries(false, {
            layer: name,
            style: matchedStyle,
            label,
            sort,
            points: pts,
            color: matchedStyle.color,
            minX: 0, maxX: 0, minY: 0, maxY: 0,
          }));
        }
      }
    }

    const tree = new RBush<TileFeature>(18);
    tree.load(nodes);
    layers[name] = { extent: layer.extent, tree };
  }

  return { layers };
}

// ── Helpers ─────────────────────────────────────────────────

function isGzipped(buffer: Buffer | Uint8Array): boolean {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

function addBoundaries(deep: boolean, data: TileFeature): TileFeature {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const points = deep
    ? (data.points as Array<Array<{ x: number; y: number }>>)[0]!
    : (data.points as Array<{ x: number; y: number }>);

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  data.minX = minX;
  data.maxX = maxX;
  data.minY = minY;
  data.maxY = maxY;
  return data;
}

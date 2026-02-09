# Pip-Boy MAP Tab — Offline Navigation Plan

## Goal

A TUI-based offline map that works like a terminal Google Maps. Pan, zoom, see roads/buildings/water/POIs, show the user's live GPS position, set waypoints, and get distance/bearing — all without internet.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    MAP TAB (TUI)                        │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │         Braille/ASCII Map Renderer              │    │
│  │   (vector tiles → rasterise → braille chars)    │    │
│  └──────────────────┬──────────────────────────────┘    │
│                     │                                   │
│  ┌──────────────────▼──────────────────────────────┐    │
│  │          Vector Tile Reader                     │    │
│  │   (reads .mbtiles or .pmtiles from disk)        │    │
│  └──────────────────┬──────────────────────────────┘    │
│                     │                                   │
│  ┌──────────────────▼──────────────────────────────┐    │
│  │       Offline Tile Archive (on SD/NVMe)         │    │
│  │   Regional OSM extract — vector tiles           │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │         GPS Module (UART)                       │    │
│  │   NMEA sentences → lat/lon/alt/speed/heading    │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Key Open Source Projects

### 2a. MapSCII — The Foundation

**Repo:** https://github.com/rastapasta/mapscii
**Stars:** ~9k | **License:** MIT | **Language:** JavaScript (Node.js)

MapSCII is a complete vector-tile-to-braille map renderer for the terminal. It is exactly what we need. Key features:

- Renders OpenStreetMap vector tiles as **braille characters** (2x4 pixel grid per character = 8x resolution boost)
- Supports **panning** (arrow keys), **zooming** (a/z keys), **mouse drag + scroll**
- Reads from remote tile servers OR **local MBTiles files** (offline mode)
- Uses Mapbox Vector Tile spec + Mapbox GL style definitions
- Renders roads, buildings, water, land use, POI labels
- 100% JavaScript — runs on Node.js

**How it works internally:**
1. Fetches vector tiles (Protobuf-encoded Mapbox Vector Tile format)
2. Parses geometry (points, lines, polygons) per layer
3. Transforms lat/lon → screen coordinates
4. Rasterises to a pixel buffer using Bresenham (lines) and Earcut (polygon triangulation)
5. Maps pixel buffer to Unicode braille characters (U+2800–U+28FF)
6. Outputs ANSI colour codes for xterm-256 colour support

**Key libraries MapSCII uses:**
| Library | Purpose |
|---|---|
| `@mapbox/vector-tile` | Parse .mvt vector tile protobuf |
| `pbf` | Protobuf decoding |
| `earcut` | Polygon triangulation for filling |
| `bresenham` | Line rasterisation |
| `rbush` | 2D spatial index for viewport queries |
| `simplify-js` | Polyline simplification |
| `x256` | RGB → xterm-256 colour conversion |
| `mbtiles` | Read local .mbtiles SQLite archives |

**Our approach:** Fork or extract MapSCII's rendering pipeline into our TypeScript codebase. The renderer itself is ~1500 lines of JS. We can either:
- **(A) Use MapSCII as a subprocess** — spawn it, capture output, pipe into our TUI
- **(B) Port the rendering logic to TypeScript** — extract the BrailleBuffer, Canvas, Tile parser, and Renderer classes. Rewrite in TS for direct integration with OpenTUI.
- **(C) Use MapSCII's core as a library** — import the modules directly (they're plain JS, compatible with Bun)

**Recommendation: Option C first, then B if we need tighter integration.** MapSCII's code is modular enough to import the renderer and tile source directly.

### 2b. Tile Data Sources

#### MBTiles (SQLite-based)
- Standard format for bundling map tiles into a single file
- SQLite database with tiles indexed by z/x/y
- MapSCII already supports reading MBTiles natively via `node-mbtiles`
- Can contain raster OR vector tiles

#### PMTiles (modern alternative)
- **Repo:** https://github.com/protomaps/PMTiles
- Single-file archive optimised for HTTP range requests
- Smaller and simpler than MBTiles for our use case
- Has a JS reader library (`pmtiles` npm package)
- MapSCII doesn't support PMTiles natively, but adding support is straightforward

#### How to get offline tile data

| Tool | What it does | Output |
|---|---|---|
| **Protomaps** (protomaps.com/extracts) | Web UI — draw a bounding box, download vector tiles for that region | `.pmtiles` |
| **Planetiler** (github.com/onthegomap/planetiler) | Converts .osm.pbf extracts to tiles. Fast, runs on Pi 5 | `.mbtiles` or `.pmtiles` |
| **Tilemaker** (tilemaker.org) | Converts .osm.pbf to vector MBTiles. Customisable layer mapping | `.mbtiles` |
| **Geofabrik** (download.geofabrik.de) | Pre-built .osm.pbf extracts by country/region | `.osm.pbf` (input for above tools) |

#### Storage estimates (vector tiles, zoom 0–14)

| Region | Approx Size |
|---|---|
| Single city (e.g., Dublin) | 50–150 MB |
| Small country (e.g., Ireland) | 200–500 MB |
| Large country (e.g., UK) | 1–3 GB |
| Continental (e.g., Europe) | 10–30 GB |

For a wearable Pip-Boy, we'd download the user's region (country-level) and store it on the NVMe or SD card. A 64GB SD card can hold multiple countries with room to spare.

### 2c. GPS Integration

- **Module:** u-blox NEO-6M or NEO-M8N (UART, 9600 baud default)
- **Protocol:** NMEA 0183 sentences over serial
- **NPM:** `serialport` for UART + `nmea-simple` or custom parser for NMEA
- **Key sentences:**
  - `$GPGGA` — position fix (lat, lon, altitude, satellite count, fix quality)
  - `$GPRMC` — recommended minimum (lat, lon, speed, heading, date/time)
  - `$GPGSV` — satellites in view

---

## 3. Feature Roadmap

### Phase 1: Static Map Viewer
- [x] Extract MapSCII rendering pipeline into our TS project
- [x] Load a local .mbtiles file (test with a city extract)
- [x] Render map in the MAP tab's content area using braille characters
- [x] Arrow keys to pan, +/- to zoom
- [x] Display current zoom level and centre coordinates in the status area
- [x] Green-on-black colour scheme to match Pip-Boy theme

### Phase 2: GPS Integration
- [ ] Read NMEA data from GPS module via `serialport`
- [ ] Parse GPGGA and GPRMC sentences
- [ ] Display live position on the map (centred marker)
- [ ] Show lat/lon, altitude, speed, heading, satellite count in the sidebar
- [ ] Auto-centre map on current position (toggle with a key)
- [ ] Trail/breadcrumb — draw recent path on the map

### Phase 3: Waypoints & Navigation
- [ ] Set a waypoint (enter lat/lon manually or mark current position)
- [ ] Save/load waypoints to a JSON file
- [ ] Calculate distance and bearing from current position to waypoint
- [ ] Display compass arrow pointing to waypoint
- [ ] Distance countdown as you approach

### Phase 4: Search & POI
- [ ] Search for place names in the tile data (POI labels)
- [ ] Highlight results on the map
- [ ] "Nearby" feature — list POIs within a radius of current position

### Phase 5: Polish
- [ ] Custom Pip-Boy map style (green roads, dark background, minimal labels)
- [ ] Minimap or overview inset
- [ ] Coordinate grid overlay
- [ ] Distance scale bar
- [ ] Export current view as text/image

---

## 4. Technical Decisions

### Rendering approach

MapSCII's BrailleBuffer gives us 2x horizontal and 4x vertical resolution:
- A 80-column terminal = 160 braille pixels wide
- A 40-row content area = 160 braille pixels tall
- Effective resolution: **160 x 160 pixels** for the map viewport

This is low but functional — braille rendering makes roads, coastlines, and building outlines legible. MapSCII proves this works at the city/street level.

### Coordinate system

Standard Web Mercator (EPSG:3857) — same as Google Maps and OSM. MapSCII already uses this.

Conversion formulas:
```
lat/lon → tile x,y at zoom z:
  x = floor((lon + 180) / 360 * 2^z)
  y = floor((1 - ln(tan(lat_rad) + 1/cos(lat_rad)) / pi) / 2 * 2^z)
```

### Colour scheme

Override MapSCII's default style with a Pip-Boy theme:
- Background: black (#0a0a0a)
- Roads: bright green (#00ff00)
- Buildings: dim green (#007700)
- Water: dark green (#003300)
- Labels: bright green, bold
- GPS marker: inverse green (blinking)
- Waypoint: bright green, pulsing

### Performance on Pi 5

MapSCII was designed for remote servers — it already runs smoothly on low-power hardware. On a Pi 5:
- Vector tile parsing: <50ms per tile
- Braille rendering: <20ms for a full screen
- GPS NMEA parsing: negligible (text parsing at 1Hz)
- Bottleneck: initial tile load from SD card (~100ms), negligible from NVMe

---

## 5. File Layout

```
pip-boy-tui/
  src/
    map/
      renderer.ts        — braille map renderer (ported from MapSCII)
      tile-source.ts     — reads .mbtiles/.pmtiles files
      tile-parser.ts     — vector tile protobuf parsing
      braille-buffer.ts  — pixel → braille character conversion
      canvas.ts          — drawing primitives (line, polygon, text)
      gps.ts             — NMEA parser + serial port interface
      waypoints.ts       — waypoint storage and navigation math
      styles.ts          — Pip-Boy green map style definition
      utils.ts           — coordinate transforms, haversine, bearing
    index.ts             — main TUI (MAP tab uses the above)
```

---

## 6. Dependencies to Add

```json
{
  "@mapbox/vector-tile": "^2.0.3",
  "pbf": "^4.0.1",
  "earcut": "^3.0.0",
  "rbush": "^4.0.1",
  "bresenham": "^1.0.0",
  "simplify-js": "^1.2.4",
  "mbtiles": "^0.12.1",
  "serialport": "^12.0.0",
  "nmea-simple": "^3.0.0"
}
```

Note: `mbtiles` uses `better-sqlite3` which has native bindings. Need to test under Bun on ARM64. Fallback: use `bun:sqlite` (Bun's built-in SQLite) to read MBTiles directly — it's just a SQLite database with a known schema.

---

## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| MapSCII code too coupled to extract cleanly | Medium | It's MIT licensed and modular — worst case we rewrite the ~1500 lines |
| `mbtiles` npm package doesn't work under Bun | Medium | Use Bun's built-in `bun:sqlite` to query the MBTiles SQLite DB directly |
| Braille resolution too low for useful navigation | Low | MapSCII proves it works; we can also add a text-mode fallback |
| Large tile files slow on SD card | Low | Use NVMe, or pre-cache frequently used zoom levels in RAM |
| GPS module doesn't get fix indoors/urban | Medium | Normal for GPS — show "ACQUIRING" status, cache last known position |

---

## 8. Open Questions

- [ ] Should we support PMTiles in addition to MBTiles? (PMTiles is simpler but MapSCII only supports MBTiles out of the box)
- [ ] What zoom levels should we pre-download? (0–14 covers street level; 0–12 is enough for navigation)
- [ ] Should the map auto-rotate to heading-up, or always north-up?
- [ ] Do we want offline routing (turn-by-turn)? This is significantly more complex — needs OSRM or similar. Probably a stretch goal.
- [ ] Should the trail/breadcrumb persist across reboots? (write GPS track to a GPX file?)

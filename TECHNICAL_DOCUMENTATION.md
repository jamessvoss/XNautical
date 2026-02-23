# S-57 Nautical Chart Viewer - Technical Documentation

## Overview

This React Native application displays official NOAA S-57 electronic navigational charts (ENCs) offline on mobile devices. Charts are converted server-side into MBTiles vector tiles, downloaded per-district, and rendered with MapLibre GL using ECDIS-style chart quilting, cross-scale feature suppression, and proper nautical symbology.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Cloud Run (Server-Side)                      │
│                                                                  │
│  S-57 (.000) ──► ogr2ogr ──► GeoJSON ──► compose_job.py         │
│                                              │                   │
│                                   ┌──────────┼──────────┐        │
│                                   ▼          ▼          ▼        │
│                              per-scale   points.mbtiles          │
│                              .mbtiles    (nav aids +             │
│                              (charts)     soundings)             │
│                                   │          │                   │
│                                   ▼          ▼                   │
│                             Firebase Storage (per-district)      │
└─────────────────────────────────────────────────────────────────┘
                                    │
                              download on demand
                                    │
┌─────────────────────────────────────────────────────────────────┐
│                     React Native App (Client)                    │
│                                                                  │
│  LocalTileServer (native) ──► MapLibre GL layers                 │
│  ├── charts layer (lines/polygons/areas)                         │
│  ├── points layer (nav aids, soundings)                          │
│  └── arcs layer (sector light arcs)                              │
│                                                                  │
│  App-side filtering:                                             │
│  ├── _scaleNum + coverage_boundaries → ECDIS usage band rules   │
│  ├── SCAMIN → zoom-based feature visibility                      │
│  └── OBJL-based symbology (colors, icons, labels)                │
└─────────────────────────────────────────────────────────────────┘
```

## Conversion Pipeline

### Source Data

NOAA provides free S-57 ENCs organized by Coast Guard District (01-17). Each chart has a scale prefix (US1-US6) indicating its detail level:

| Scale | Name     | Zoom Range | Typical Use          |
|-------|----------|------------|----------------------|
| US1   | Overview | z0-8       | Ocean crossing       |
| US2   | General  | z0-10      | Coastal transit       |
| US3   | Coastal  | z4-13      | Nearshore navigation |
| US4   | Approach | z6-15      | Harbor approaches    |
| US5   | Harbour  | z6-15      | Port entry           |
| US6   | Berthing | z6-15      | Docking              |

### Per-Chart Conversion (`convert.py`)

1. **S-57 → GeoJSON** via `ogr2ogr` — extracts all geometry layers, adds `_chartId` property, generates light sector arc geometries, splits SOUNDG MultiPoint into individual depth points, assigns correct OBJL codes from layer names.
2. **GeoJSON uploaded** to Firebase Storage as cached chart-geojson (persistent across runs).

### Compose Job (`compose_job.py`)

A single Cloud Run Job that reads all per-chart GeoJSON for a district and produces unified MBTiles. Key processing steps:

#### Deduplication

When the same real-world feature appears in multiple overlapping charts, the compose job deduplicates by keeping the version from the highest-scale (most detailed) chart. Dedup covers:
- **Physical objects**: rocks, wrecks, obstructions
- **Hydrographic features**: depth areas, depth contours
- **Line features**: cables, pipelines, coastlines
- **Regulatory zones**: restricted areas, military areas, caution areas

#### M_COVR Authority Clipping (Non-Point Features)

Per ECDIS standard, when a higher-scale chart covers an area, ALL lower-scale line/polygon/area features in that area are suppressed. The compose job uses M_COVR (coverage) polygons from each chart to clip:

- **Fully inside** higher-scale coverage → feature removed entirely
- **Partially overlapping** → geometry trimmed via `OGR Difference()`
- **Fully outside** → feature kept as-is

Clipping is cascading per-scale-pair: each scale is clipped only against the immediately next higher scale, not the union of all higher scales.

**Gap protection** — two types of zoom gaps are prevented:

1. **Tile-level gap**: Higher-scale tiles don't exist at low zooms (e.g. US4 floor z6). An unclipped copy of the clipped feature is emitted for zoom levels below the higher scale's floor, respecting the feature's SCAMIN minzoom.

2. **SCAMIN gap**: Higher-scale tiles exist but the replacement feature has a tighter SCAMIN (e.g. US4 cable with SCAMIN z8 is clipped by US5, but US5's cable has SCAMIN z10 — gap at z8-9). A "SCAMIN filler" copy is emitted that stays visible until the higher scale's replacement feature turns on. For partially-trimmed features, the filler uses only the intersection geometry (the clipped-away inside portion) to avoid doubling.

#### Point Extraction and Coverage Suppression

All Point geometry features are diverted to a separate `points.mbtiles` (not included in per-scale chart tiles). Points are NOT geometrically clipped. Instead, **nav aids** (buoys, lights, beacons, wrecks, etc.) get a `tippecanoe.maxzoom` cap based on M_COVR spatial coverage — if a higher-scale chart covers the point's location, its maxzoom is capped so it yields when the higher-scale data takes over.

The nav aid suppression finds the **most detailed** (highest) scale covering the point and caps maxzoom to that scale's floor minus one. This avoids cascading suppression gaps: e.g. a US2 light in an area covered by both US3 and US4 yields at `US4_floor - 1 = z5` (not `US3_floor - 1 = z3`), keeping it visible through intermediate zooms.

**Soundings and hazards are exempt** from coverage suppression. Because these features use density thinning (`--drop-densest-as-needed`), suppressing lower-scale versions creates voids where all lower-scale features are removed but the replacement scale's features are thinned to near-zero at its floor zoom. Instead, they keep their full native zoom range and tippecanoe's density algorithm naturally balances the mix across scales.

#### Density Thinning (Soundings & Hazards)

Points are split three ways for separate tippecanoe processing:

- **Nav aids** (buoys, lights, beacons, etc.): processed with `-r1 --no-feature-limit --no-tile-size-limit` — every feature preserved at every zoom level from its minzoom to maxzoom.
- **Soundings** (OBJL 129): processed with `--drop-densest-as-needed -M 2000` — tippecanoe auto-thins at low zoom to keep tile sizes under 2KB, progressively increasing density as zoom increases.
- **Hazards** (rocks, obstructions, wrecks): processed with `--drop-densest-as-needed -M 2000` — same density thinning as soundings. Too numerous for `-r1` at low zoom (creates unreadable black blobs), but full density is preserved at high zoom where precise positions matter.

All three use layer name `points` and are merged via `tile-join` into a single `points.mbtiles`. The app needs no special handling — density-thinned features are simply sparser at overview zooms and denser as you zoom in.

#### Tippecanoe Tile Generation

Per-scale GeoJSON is processed by tippecanoe workers (parallel Cloud Run Jobs):
- Each feature has `tippecanoe.minzoom`, `tippecanoe.maxzoom`, and `tippecanoe.layer` set by the compose job
- `-r1 --no-feature-limit --no-tile-size-limit --no-line-simplification` preserves every chart feature exactly
- High-zoom scales (maxzoom > 14) are split into zoom bands for parallel processing
- Workers upload per-band `.mbtiles` which are merged via `tile-join` into unified scale packs

#### Metadata Injection

The compose job embeds two metadata entries into `points.mbtiles`:

- **`sector_lights`**: JSON index of all sector light features (coordinates, sectors, colors, ranges) for the app's sector light arc rendering.
- **`coverage_boundaries`**: Simplified M_COVR polygons per scale. The app uses these client-side for ECDIS usage band filtering — suppressing lower-scale point features in areas covered by higher-scale charts.

### Storage Layout (Firebase Storage)

```
{district}cgd/enc-source/{chartId}/{chartId}.000      — S-57 source files
{district}cgd/chart-geojson/{chartId}/{chartId}.geojson — Cached per-chart GeoJSON
{district}cgd/chart-geojson/_manifest.json            — Valid chart list for compose
{district}cgd/charts/{US1-US6}.mbtiles                — Per-scale chart tile packs
{district}cgd/charts/points.mbtiles                   — All point features (nav aids + soundings)
{district}cgd/charts/manifest.json                    — Pack metadata for the app
{district}cgd/charts/conversion-report.json           — Detailed conversion report
```

## App Consumption

### Tile Serving

The app downloads `.mbtiles` files per-district and serves them locally via a native `LocalTileServer` (Swift/Kotlin). The server handles:
- Per-scale chart tile requests (`/tiles/{scale}/{z}/{x}/{y}.pbf`)
- Point tile requests from `points.mbtiles`
- Composite tile quilting (merging multiple scales into a single response)

### MapLibre GL Layers

Three vector tile layers are rendered:

| Layer    | Content                          | Source        |
|----------|----------------------------------|---------------|
| `charts` | Depth areas, contours, coastline, land, cables, pipelines, restricted areas, fairways, etc. | Per-scale .mbtiles |
| `points` | Nav aids (buoys, lights, beacons, wrecks), soundings | points.mbtiles |
| `arcs`   | Sector light arc geometries      | Per-scale .mbtiles |

### ECDIS Usage Band Filtering (App-Side)

For point features, the app implements client-side ECDIS usage band rules using:
- `_scaleNum` property on each feature (which scale's chart it came from)
- `coverage_boundaries` metadata from `points.mbtiles` (M_COVR polygons per scale)
- Current zoom level and map viewport

At a given zoom/location, the app determines which scale "owns" that area and hides point features from lower scales. This complements the server-side maxzoom capping — the server handles the common case, the app handles edge cases at tile boundaries.

### SCAMIN-Based Visibility

Features with SCAMIN (Scale Minimum) attributes are filtered by zoom level. The compose job converts SCAMIN values to tippecanoe minzoom:

```
zoom ≈ log₂(559,082,264 / SCAMIN)
```

Features don't appear until the map zoom reaches their SCAMIN-derived minimum, preventing clutter at overview zooms.

### Feature Inspector

Tapping any feature shows an info panel with:
- Feature type and name (OBJNAM)
- Source chart (`_chartId`) and scale (`_scaleNum`)
- Depth values (DRVAL1/DRVAL2 for areas, DEPTH for soundings)
- All relevant S-57 attributes

## Key Properties on Features

| Property    | Set By  | Purpose |
|-------------|---------|---------|
| `OBJL`      | Server  | S-57 object class code (determines symbology) |
| `_scaleNum` | Server  | Scale band (1-6) of source chart |
| `_chartId`  | Server  | Source chart ID (e.g. `US4AK4KM`) |
| `SCAMIN`    | Server  | Scale minimum for visibility filtering |
| `DEPTH`     | Server  | Sounding depth in meters |
| `DRVAL1/2`  | Server  | Depth range for depth areas |

## References

- [IHO S-57 Standard](https://iho.int/en/s-57-standard)
- [IHO S-52 Presentation Library](https://iho.int/en/s-52-standard)
- [NOAA ENC Direct](https://charts.noaa.gov/ENCs/ENCs.shtml)
- [GDAL/OGR S-57 Driver](https://gdal.org/drivers/vector/s57.html)
- [tippecanoe](https://github.com/felt/tippecanoe)
- [MapLibre GL](https://maplibre.org/)

# XNautical Chart Pipeline & App Rendering — Technical Reference

## Overview

The system has two phases:

1. **Cloud Conversion Pipeline** (`compose_job.py`, `convert.py`): Transforms S-57 ENC source files into unified MBTiles vector tiles with deduplication, M_COVR authority clipping, and SCAMIN-driven zoom filtering.
2. **Mobile App Rendering** (`DynamicChartViewer.native.tsx`): Loads MBTiles via a local tile server, renders 60+ chart layers through a single unified VectorSource with `_scaleNum`-based scale filtering and SCAMIN-based feature visibility.

### Output Files

The pipeline produces two MBTiles files per district:

| File | Contents | Tile Layer | Zoom Range |
|------|----------|------------|------------|
| `d{NN}_charts.mbtiles` | All polygon/line features (DEPARE, LNDARE, DEPCNT, COALNE, etc.) | `charts` | z0–15 |
| `points.mbtiles` | All point features (soundings, lights, buoys, beacons, wrecks, etc.) | `points` | z0–15 |

---

## Phase 1: Per-Chart Conversion (`convert.py`)

Each S-57 `.000` file is converted independently to GeoJSON.

### Process

1. **GDAL extraction**: `ogr.Open()` reads all non-metadata layers (excludes `DS*`, `M_*`)
2. **Feature enrichment**: Each feature gets:
   - `OBJL`: Integer object class code from layer name (e.g., LIGHTS → 75)
   - `_scaleNum`: Scale number from chart ID (e.g., `US4AK4PH` → 4)
   - `_chartId` / `CHART_ID`: Source chart identifier
3. **Coordinate rounding**: 7 decimal places (~1.1cm precision)
4. **Special processing**:
   - **LIGHTS**: Sector arcs generated as LineString features in `arcs` layer
   - **SOUNDG**: MultiPoint split into individual Point features with `DEPTH` from Z coordinate

### Output

Individual GeoJSON uploaded to `{district}/chart-geojson/{chartId}/{chartId}.geojson`.

---

## Phase 2: Compose Pipeline (`compose_job.py`)

Merges all per-chart GeoJSON into unified district MBTiles.

### Key Constants

```python
SCALE_ZOOM_RANGES = {
    1: (0, 8),    # US1 Overview
    2: (0, 10),   # US2 General
    3: (4, 13),   # US3 Coastal
    4: (6, 15),   # US4 Approach
    5: (6, 15),   # US5 Harbor
    6: (6, 15),   # US6 Berthing
}

SCAMIN_HEADROOM = 2  # Pipeline generates tiles 2 zooms earlier than base SCAMIN threshold

SKIN_OF_EARTH_OBJLS = {30, 42, 43, 69, 71}  # COALNE, DEPARE, DEPCNT, LAKARE, LNDARE

MCOVR_CLIP_OBJLS = {42, 43, 30, 71, 129}    # DEPARE, DEPCNT, COALNE, LNDARE, SOUNDG
```

### SCAMIN → Minzoom Formula

```python
def scamin_to_minzoom(scamin_val, native_lo):
    z = 28 - SCAMIN_HEADROOM - math.log2(scamin)
    return max(native_lo, round(z))
```

- **SKIN_OF_EARTH features bypass SCAMIN entirely** — they always get `minzoom = native_lo`
- `SCAMIN_HEADROOM = 2` provides buffer so the app's `chartDetail=ultra` (offset=2) can show features at lower zooms than the base formula

### Two-Pass Processing

#### Pass 1: Build Dedup Index

Streams all chart GeoJSON to build:
- **Dedup index**: For each unique feature key, records which chart/scale wins (highest `_scaleNum`)
- **SCAMIN index**: For each point feature key, tracks the most permissive (largest) SCAMIN across all copies
- **Scale membership**: Which scales contain each dedup key (used for zoom partitioning)

**Dedup key generation**:
- Named points: `{OBJL}:{OBJNAM}:{lon_4dp}:{lat_4dp}` (~11m tolerance)
- Unnamed points: `{OBJL}:{lon_5dp}:{lat_5dp}` (~1.1m tolerance)
- Lines/polygons: `{OBJL}:{OBJNAM}:{md5_of_sorted_coords}`

**Dedup categories** (~30 OBJL codes across 4 groups):
- Physical objects: LIGHTS, buoys, beacons, landmarks, wrecks, obstructions, etc.
- Regulatory zones: RESARE, CTNARE, MIPARE, ACHARE, FAIRWY, etc.
- Line features: BRIDGE, CBLSUB, CBLOHD, PIPSOL, SLCONS, CAUSWY
- Hydrographic: DEPCNT, DEPARE, COALNE, LNDARE, SOUNDG

#### Pass 2: Write Features with Zoom Slicing

Each feature is processed through this pipeline:

```
Is it a dedup loser? → skip
Is it a Point? → extract to points.geojson (with best SCAMIN)
Is it in MCOVR_CLIP_OBJLS? → M_COVR clipping (see below)
Does it exist in multiple scales? → zoom-partitioned write
Otherwise → single-scale write with SCAMIN-derived minzoom
```

### M_COVR Authority Clipping

**Purpose**: Where a higher-scale chart provides M_COVR coverage (CATCOV=1), it is authoritative. Lower-scale skin-of-earth features must be removed to prevent cross-scale duplicates.

**Cascading strategy**: Each scale is clipped only against the **next higher scale** with coverage — not the union of all higher scales. This prevents zoom gaps.

```
US2 clipped by US3's M_COVR
US3 clipped by US4's M_COVR
US4 clipped by US5's M_COVR
```

**Three outcomes per feature**:

| Spatial Relationship | Main Feature | Gap Copy |
|---------------------|-------------|----------|
| Entirely within higher M_COVR | Removed | Written at `[native_lo, higher_lo - 1]` |
| Partially intersecting | Geometry clipped (`Difference`) | Unclipped copy at `[native_lo, higher_lo - 1]` |
| No intersection | Written normally | None |

**Gap copy example**: US3 LNDARE (native z4–13) entirely within US4's M_COVR (native z6–15):
- Gap copy: `tippecanoe = {minzoom: 4, maxzoom: 5}` — covers z4–5 before US4 starts
- Main feature: removed (US4's native LNDARE takes over at z6)

**Cascading coverage for a point inside both US3 and US4 M_COVR**:
- z0–3: US2 gap copy (US2 clipped by US3, `gap_maxz = 4 - 1 = 3`)
- z4–5: US3 gap copy (US3 clipped by US4, `gap_maxz = 6 - 1 = 5`)
- z6+: US4 native features

### Zoom Ownership Partitioning

When a dedup winner exists in multiple scales, `compute_zoom_ownership()` assigns non-overlapping zoom slices:

```python
def compute_zoom_ownership(scales: set) -> dict:
    """For each zoom 0-15, highest scale whose native range covers it wins."""
    # Example: scales={3, 4} → {3: (4, 5), 4: (6, 15)}
```

Each scale gets a copy of the feature with its zoom slice as `tippecanoe.minzoom`/`maxzoom`.

### Points Extraction

All Point geometries are diverted to a separate `points.geojson`:
- Deduplicated by coordinate key
- Best (most permissive/largest) SCAMIN used across all copies
- Metadata stripped (RCID, PRIM, GRUP, etc.)
- `tippecanoe.minzoom` from SCAMIN formula; no maxzoom (visible to z15)
- Layer: `points`

### Tippecanoe Execution

Per-scale GeoJSON is processed by parallel tippecanoe workers:
- High-zoom scales (maxzoom > 14) split into zoom bands: `[native_lo, 14]` + individual z15
- All workers use: `--no-feature-limit --no-tile-size-limit --no-line-simplification -r1`
- Output MBTiles merged via `tile-join` in a binary tree (TreeMerger)

### Final Output

```
{district}/charts/
  d{NN}_charts.mbtiles        # Unified chart pack
  d{NN}_charts.mbtiles.zip    # Compressed for download
  points.mbtiles               # All point features
  points.mbtiles.zip
  manifest.json                # Pack metadata + bounds
```

Firestore document updated with composition metadata, bounds, checksums, dedup stats.

---

## App: Chart Loading (`DynamicChartViewer.native.tsx`, `useChartLoading.ts`)

### Startup Flow

1. **Directory setup**: `${FileSystem.documentDirectory}mbtiles`
2. **Manifest loading**: Read `manifest.json` if present; otherwise scan directory for `.mbtiles` files
3. **Special file detection**: GNIS names, basemap, satellite, ocean, terrain tile sets
4. **Tile server start**: `tileServer.startTileServer({ mbtilesDir })` → `http://127.0.0.1:8765`
5. **Unified pack detection**: Find `*_charts.mbtiles` → single VectorSource z0–15
6. **Points pack detection**: Find `points-*.mbtiles` → separate VectorSource
7. **Sector light index**: Load from `points.mbtiles` metadata field `sector_lights`

### VectorSource Configuration

```typescript
// Unified chart source — single source, all scales, all zooms
{
  sourceId: 'charts-unified',
  packId: 'd07_charts',       // example
  tileUrl: 'http://127.0.0.1:8765/tiles/d07_charts/{z}/{x}/{y}.pbf',
  minZoom: 0,
  maxZoom: 15,
}

// Points source — separate for soundings, nav-aids, hazards
{
  tileUrl: 'http://127.0.0.1:8765/tiles/points-d07/{z}/{x}/{y}.pbf',
}
```

---

## App: Scale Filtering

Scale transitions within the unified tileset are controlled by MapLibre filter expressions on the `_scaleNum` property.

### Background Fill Scale Filter

Applied to: **DEPARE** (42), **LNDARE** (71), **LAKARE** (69)

```typescript
const bgFillScaleFilter = ['any',
  ['!', ['has', '_scaleNum']],                                        // No scale → pass
  ['all', ['<=', ['get', '_scaleNum'], 2], ['<', ['zoom'], 11]],     // US1-2: z0–10
  ['all', ['==', ['get', '_scaleNum'], 3], ['>=', ['zoom'], 4]],     // US3: z4+
  ['all', ['==', ['get', '_scaleNum'], 4], ['>=', ['zoom'], 6]],     // US4: z6+
  ['all', ['>=', ['get', '_scaleNum'], 5], ['>=', ['zoom'], 6]],     // US5+: z6+
];
```

### Contour Scale Filter

Applied to: **DEPCNT** (43)

Identical to `bgFillScaleFilter`. M_COVR clipping in the pipeline ensures no cross-scale geometry overlap, so overlapping display bands are safe.

### Visibility by Zoom

| Zoom | US1 | US2 | US3 | US4 | US5+ |
|------|-----|-----|-----|-----|------|
| z0–3 | ✓ | ✓ | — | — | — |
| z4–5 | ✓ | ✓ | ✓ | — | — |
| z6–10 | ✓ | ✓ | ✓ | ✓ | ✓ |
| z11–15 | — | — | ✓ | ✓ | ✓ |

At zoom boundaries where multiple scales are visible, higher-scale features render last (from tile-join merge order) and take visual priority.

### COALNE (Coastline)

No scale filter. Rendered from z2+ with just `['==', ['get', 'OBJL'], 30]`. Coastline from all scales renders simultaneously — M_COVR clipping prevents duplicates.

---

## App: SCAMIN Filtering

### Formula

```typescript
const chartDetailOffsets = { low: -1, medium: 0, high: 1, ultra: 2, max: 4 };
const scaminOffset = chartDetailOffsets[displaySettings.chartDetail] ?? 1;

// MapLibre expression: feature visible when zoom >= 28 - scaminOffset - log2(SCAMIN)
const scaminFilter = ['any',
  ['!', ['has', 'SCAMIN']],        // No SCAMIN → always visible
  ['>=', ['zoom'], ['-', 28 - scaminOffset,
    ['/', ['ln', ['to-number', ['get', 'SCAMIN']]], ['ln', 2]]
  ]]
];
```

### Pipeline–App Alignment

| Aspect | Pipeline | App |
|--------|----------|-----|
| Base formula | `28 - log2(SCAMIN)` | `28 - log2(SCAMIN)` |
| Offset | `SCAMIN_HEADROOM = 2` | `scaminOffset` (varies by chartDetail) |
| Rounding | `round()` | Continuous float comparison |
| Skin-of-earth bypass | Yes (SCAMIN ignored) | Yes (uses `bgFillScaleFilter` instead of `scaminFilter`) |

The pipeline's `SCAMIN_HEADROOM = 2` ensures tiles are generated 2 zooms earlier than the base threshold, so `chartDetail=ultra` (offset=2) can show features earlier without missing tiles.

### Which Layers Use Which Filter

| Filter | OBJL Codes |
|--------|-----------|
| `bgFillScaleFilter` | DEPARE (42), LNDARE (71), LAKARE (69) |
| `contourScaleFilter` | DEPCNT (43) |
| `scaminFilter` | Everything else: DRGARE, FAIRWY, CBLARE, PIPARE, RESARE, CTNARE, MIPARE, ACHARE, MARCUL, TSSLPT, CANALS, SBDARE, BRIDGE, BUISGL, MORFAC, SLCONS, CAUSWY, PONTON, HULKES, NAVLNE, RECTRC, TSELNE, LNDELV, CBLSUB, CBLOHD, PIPSOL, SEAARE, LNDRGN, all point symbols |
| No filter | COALNE (30) |

---

## App: Layer Rendering Order

Layers render in S-52 order (bottom to top):

1. **Opaque background fills**: DEPARE → DEPARE outlines → LNDARE
2. **Semi-transparent area fills**: DRGARE, FAIRWY, CBLARE, PIPARE, RESARE, CTNARE, MIPARE, ACHARE, MARCUL, TSSLPT, LAKARE, CANALS
3. **Area outlines**: LNDARE outline, DRGARE outline, FAIRWY outline, etc.
4. **Structures**: BRIDGE, BUISGL, MORFAC, SLCONS, CAUSWY, PONTON, HULKES
5. **Line features**: DEPCNT (halo + main), COALNE (halo + main), NAVLNE, RECTRC, TSELNE, LNDELV, CBLSUB, CBLOHD, PIPSOL
6. **Labels**: SEAARE names, LNDRGN names, cable/pipeline labels, contour labels
7. **Point symbols** (from `points` source): SOUNDG, SBDARE, UWTROC, OBSTRN, WATTUR, WRECKS, beacons, buoys, fog signals, pilot stations, rescue stations, landmarks, LIGHTS, anchorages
8. **Sector arcs** (from ShapeSource): Generated in JavaScript, rendered as LineLayer

---

## App: Sector Arc Generation

Sector light arcs are generated client-side from an index embedded in `points.mbtiles` metadata.

### Process

1. On map idle at z6+, read viewport bounds
2. Filter sector lights by viewport + SCAMIN visibility
3. For each visible sector light:
   - Convert S-57 bearings from "toward light" to "from light" (+180°)
   - Generate arc as LineString with adaptive point count (8–32 points based on arc span)
   - Arc radius: screen-constant ~60 pixels (converted to degrees via dp-to-degrees ratio)
   - Generate leg lines from light center to arc start/end
4. Set as GeoJSON FeatureCollection on ShapeSource

### SCAMIN Check (JavaScript)

```typescript
const scaminVisible = (scamin: number) => {
  if (!scamin || !isFinite(scamin)) return true;
  const minZoom = 28 - scaminOffset - Math.log2(scamin);
  return zoom >= minZoom;
};
```

Same formula as the MapLibre filter expression, evaluated in JavaScript for the sector light index.

---

## Feature Flow Examples

### LNDARE at z5 (US3 feature inside US4's M_COVR)

**Pipeline**:
1. US3 LNDARE (OBJL 71) detected in Pass 1
2. In Pass 2, OBJL 71 ∈ MCOVR_CLIP_OBJLS and US3 has higher coverage from US4
3. Feature entirely within US4's M_COVR → write gap copy: `{minzoom: 4, maxzoom: 5}`
4. Main feature removed (US4's native LNDARE takes over at z6)

**App at z5**:
- Unified VectorSource serves z5 tile containing the gap copy with `_scaleNum=3`
- `bgFillScaleFilter`: `_scaleNum == 3` and `zoom >= 4` → **visible** ✓
- LNDARE renders with `s52Colors.LANDA` fill

### LIGHTS at z10 (dedup winner from US4, SCAMIN=50000)

**Pipeline**:
1. LIGHTS (OBJL 75) appears in US3 and US4 → US4 wins dedup (higher scale)
2. Extracted to points.geojson with best SCAMIN
3. `scamin_to_minzoom(50000, 0)` = `round(28 - 2 - 15.61)` = `round(10.39)` = 10
4. Written with `tippecanoe = {minzoom: 10, layer: 'points'}`

**App at z10 (chartDetail=high, offset=1)**:
- Points VectorSource serves z10 tile containing the light
- `scaminFilter`: `zoom >= 28 - 1 - log2(50000)` = `zoom >= 12.39` → 10 < 12.39 → **not visible**
- Visible at z13+ with this chartDetail setting
- At `chartDetail=ultra` (offset=2): `zoom >= 11.39` → visible at z12+

### DEPARE at z11 (US2 → US3 transition)

**Pipeline**:
- US2 DEPARE has `tippecanoe = {minzoom: 0, maxzoom: 10}` (SKIN_OF_EARTH, native range)
- US3 DEPARE has `tippecanoe = {minzoom: 4, maxzoom: 13}`

**App at z11**:
- `bgFillScaleFilter` for `_scaleNum ≤ 2`: `zoom < 11` → 11 < 11 is **false** → US2 hidden
- `bgFillScaleFilter` for `_scaleNum == 3`: `zoom >= 4` → **visible** ✓
- US3 DEPARE takes over seamlessly

---

## Validation Gates (Pipeline)

| Gate | Location | Check |
|------|----------|-------|
| Gate 2 | GeoJSON download | Non-empty files, valid JSON bookends, ≥80% charts valid |
| Gate 3A | Tippecanoe output | Valid SQLite, tiles table has rows, no "Skipping this tile" warnings |
| Gate 4 | Merged MBTiles | File ≥1 MB, valid zoom range, tile count > 0 |
| Gate 5 | Upload verification | Blob exists in Cloud Storage, size matches local |

---

## Storage Layout

### Cloud (Firebase Storage)

```
{district}cgd/
  enc-source/{chartId}/{chartId}.000           # S-57 source files
  chart-geojson/{chartId}/{chartId}.geojson    # Cached per-chart GeoJSON
  chart-geojson/_manifest.json                 # Valid chart list for compose
  charts/temp/compose/                          # Tippecanoe fan-out artifacts (cleaned up)
  charts/d{NN}_charts.mbtiles                  # Unified chart pack
  charts/d{NN}_charts.mbtiles.zip              # Compressed for download
  charts/points.mbtiles                         # Point features
  charts/points.mbtiles.zip
  charts/manifest.json                          # Pack metadata for the app
```

### Mobile Device

```
${DocumentDirectory}/mbtiles/
  d{NN}_charts.mbtiles          # Downloaded unified chart pack
  points-d{NN}.mbtiles          # Downloaded point features
  manifest.json                  # Pack metadata
  basemap*.mbtiles              # Vector basemap tiles
  satellite_z{N}.mbtiles        # Satellite imagery tiles
  ocean_z{N}.mbtiles            # Ocean bathymetry tiles
  terrain_z{N}.mbtiles          # Terrain/hillshade tiles
  gnis_names.mbtiles            # USGS place names
```

# MBTiles Conversion Pipeline

## Overview

This document describes the cloud-based pipeline for converting NOAA S-57 Electronic Navigational Chart (ENC) files into unified MBTiles vector tiles for the XNautical mobile app. The pipeline runs entirely on Google Cloud Run and produces one unified `.mbtiles` file per USCG Coast Guard District.

### Architecture Summary

```
S-57 ENC (.000) files in Firebase Storage
         │
         ▼
┌─────────────────────────────────────────────┐
│  /convert-district-parallel  (orchestrator) │
│  Cloud Run Service (server.py)              │
└───────┬─────────────────────────────────────┘
        │  Fans out to 20-80 parallel instances
        ▼
┌──────────────────────────────┐
│  /convert-batch  (workers)   │  × N batches (10 charts each)
│  S-57 → GeoJSON (via GDAL)  │
│  Compress & upload to temp   │
└──────────┬───────────────────┘
           │  All batches complete
           ▼
┌────────────────────────────────────────────────────────┐
│  Compose Job  (Cloud Run Job, compose_job.py)          │
│  1. Download all per-chart GeoJSON                     │
│  2. Coordinate-based deduplication across chart scales  │
│  3. Tippecanoe per scale → per-scale MBTiles           │
│  4. tile-join → unified MBTiles                        │
│  5. MVT scale-priority post-processing (ECDIS logic)   │
│  6. Zip & upload to Firebase Storage                   │
│  7. Trigger metadata regeneration                      │
└───────┬────────────────────────────────────────────────┘
        │  POST /generateMetadata
        ▼
┌────────────────────────────────────────────────────────┐
│  District Metadata Service  (district-metadata)        │
│  Reads actual file sizes from Storage, writes          │
│  {districtId}/download-metadata.json                   │
└────────────────────────────────────────────────────────┘
```

### Conversion Philosophy

**Extract everything, control visibility in the app.**

All S-57 data is preserved in the MBTiles. The app controls what is displayed through layer toggles, styling, and SCAMIN-based visibility filtering. This approach:
- Avoids needing to reconvert when adding new layer support
- Ensures no data is accidentally omitted
- Allows users to toggle layers on/off as needed

### Design Principles

1. **Unified MBTiles**: One file per district containing all chart scales (US1–US6), not separate files per scale or per chart
2. **ECDIS-quality display**: Tile-level scale priority filtering ensures only the most detailed chart's hydrographic features render at any location, mimicking real ECDIS chart selection
3. **Additive SCAMIN**: The standard S-52 SCAMIN filter is additive (once visible, stays visible at higher zoom) — the data-level dedup and scale priority handle overlap
4. **Common layer name**: All features go into a single `charts` layer with OBJL codes for filtering, enabling efficient Mapbox/MapLibre rendering

---

## GCP Infrastructure

| Resource | Details |
|----------|---------|
| **Project** | `xnautical-8a296` |
| **Region** | `us-central1` |
| **Storage bucket** | `xnautical-8a296.firebasestorage.app` |
| **Cloud Run Service** | `enc-converter` (Flask via gunicorn) |
| **Cloud Run Job** | `enc-converter-merge` (compose + legacy merge) |
| **Service image** | `gcr.io/xnautical-8a296/enc-converter:latest` |
| **Base image** | `gcr.io/xnautical-8a296/enc-converter-base:latest` |
| **District Metadata Service** | `generate-district-metadata` (regenerates download-metadata.json) |
| **Job resources** | 32Gi memory, 8 vCPU, 2-hour timeout |

### Valid Districts

| District | Prefix | Region |
|----------|--------|--------|
| 01cgd | d01 | Northeast US |
| 05cgd | d05 | Mid-Atlantic |
| 07cgd | d07 | Southeast US / Caribbean |
| 08cgd | d08 | Gulf of Mexico |
| 09cgd | d09 | Great Lakes |
| 11cgd | d11 | Southern California |
| 13cgd | d13 | Pacific Northwest |
| 14cgd | d14 | Hawaii / Pacific Islands |
| 17cgd | alaska | Alaska |

### Firebase Storage Layout

```
{district}cgd/
├── enc-source/
│   ├── US4FL3KR/
│   │   ├── US4FL3KR.000        ← S-57 source file
│   │   ├── US4FL3KR.001        ← S-57 update files
│   │   └── ...
│   └── US5FL3NS/
│       └── ...
├── charts/
│   ├── temp/                    ← Per-chart GeoJSON during conversion (cleaned up)
│   │   ├── batch_001/
│   │   │   ├── US4FL3KR.geojson.gz
│   │   │   └── ...
│   │   └── batch_002/
│   │       └── ...
│   ├── {prefix}_charts.mbtiles      ← Unified MBTiles (raw)
│   ├── {prefix}_charts.mbtiles.zip  ← Unified MBTiles (zipped for app download)
│   ├── manifest.json                ← Pack metadata for the app (legacy)
│   └── conversion-report.json       ← Detailed conversion report
└── ...
```

Where `{prefix}` is the district prefix (e.g., `d07`, `alaska`).

---

## Pipeline Stages in Detail

### Stage 1: Orchestration (`/convert-district-parallel`)

**File**: `server.py`, endpoint `/convert-district-parallel`

The orchestrator handles the entire conversion lifecycle:

1. **Discovery**: Lists all `.000` files in `{district}cgd/enc-source/` and groups them by scale (US1–US6)
2. **Batching**: Splits chart IDs into batches of 10 (configurable via `batchSize`)
3. **Parallel dispatch**: Fires up to 20 concurrent HTTP requests to `/convert-batch` (configurable via `maxParallel`), with exponential backoff retry (up to 8 retries) for 429/500/502/503 errors
4. **Compose launch**: After all batches complete, launches the Cloud Run Job with `JOB_TYPE=compose`
5. **Polling**: Polls Firestore for compose completion (checks `chartData.composedAt` timestamp)
6. **Reporting**: Uploads a comprehensive conversion report to Storage and updates Firestore

**Triggering a conversion:**

```bash
# Via curl (requires authentication)
curl -X POST https://enc-converter-653355603694.us-central1.run.app/convert-district-parallel \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -H "Content-Type: application/json" \
  -d '{"districtId": "07"}'

# With custom options
curl -X POST ... \
  -d '{"districtId": "07", "batchSize": 10, "maxParallel": 80}'
```

### Stage 2: Batch Conversion (`/convert-batch`)

**File**: `server.py`, endpoint `/convert-batch`

Each batch worker processes 5–10 charts:

1. **Download**: Downloads S-57 source files (`.000` + update files) from Firebase Storage
2. **Convert**: Runs `convert_s57_to_geojson()` from `convert.py` for each chart using `ProcessPoolExecutor` (4 workers per instance)
3. **Compress**: Gzip-compresses each GeoJSON output
4. **Upload**: Uploads compressed GeoJSON to `{district}/charts/temp/{batchId}/{chartId}.geojson.gz`

Note: The batch endpoint does NOT run tippecanoe. That happens in the compose job, which allows cross-chart deduplication before tile generation.

### Stage 3: Single-Chart Conversion (`convert.py`)

**File**: `convert.py`

Converts a single S-57 ENC file to GeoJSON using GDAL Python bindings (`osgeo.ogr`):

#### Layer Discovery
Reads all layers from the S-57 file, excluding:
- `DS*` layers (dataset metadata)
- `M_*` layers (coverage/quality metadata — not for display)

#### Feature Processing

For each feature, the converter:

1. **Assigns OBJL code** from the S-57 layer name using the `S57_OBJL` lookup table
2. **Sets `_chartId`** and **`_scaleNum`** properties (extracted from the chart ID, e.g., `US4AK4PH` → `_scaleNum: 4`)
3. **Preserves SCAMIN** (Scale Minimum) — the S-57 attribute controlling minimum display scale
4. **Rounds coordinates** to 6 decimal places

#### Special Feature Handling

**Light Sector Arcs** (OBJL 75, LIGHTS):
- For lights with `SECTR1`/`SECTR2` attributes, generates synthetic LineString arc features
- Arc radius: 0.15 nautical miles, 32 points per arc
- Bearings converted from "toward light" (S-57 spec) to "from light" (chart display) by adding 180°
- `COLOUR` attribute normalized from GDAL IntegerList string to integer
- Light orientation (`_ORIENT`) calculated from sector midpoint

**Soundings** (OBJL 129, SOUNDG):
- Extracts depth from Z coordinate: `[lon, lat, depth]` → `DEPTH` property
- Splits `MultiPoint` geometries into individual `Point` features
- Removes Z coordinate (Mapbox/MapLibre doesn't use it)

**Navigation Aids** (LIGHTS, buoys, beacons, WRECKS, UWTROC, OBSTRN):
- Get `tippecanoe: {minzoom: 0, maxzoom: 17}` — visible at all zoom levels

**Safety Areas** (RESARE, CTNARE, MIPARE, ACHARE, ACHBRT, MARCUL):
- Also forced to all zoom levels
- Charts containing safety areas have their min zoom extended to 0 regardless of scale

### Stage 4: Compose Job (`compose_job.py`)

**File**: `compose_job.py`, launched as Cloud Run Job with `JOB_TYPE=compose`

The compose job is the core of the unified pipeline. It takes all per-chart GeoJSON files and produces a single deduplicated, scale-prioritized MBTiles.

#### 4a. Download Per-Chart GeoJSON

Downloads all `.geojson.gz` files from `{district}/charts/temp/` in parallel (up to 16 workers).

#### 4b. Pass 1 — Deduplication Index

Builds an in-memory index of all features that need deduplication. For each feature in `ALL_DEDUP_OBJLS`, a dedup key is generated:

- **Points**: `"{OBJL}:{OBJNAM}:{round(lon,4)}:{round(lat,4)}"` (or without OBJNAM)
- **Lines/Polygons**: `"{OBJL}:{OBJNAM}:{md5(sorted_rounded_coords)[:12]}"` (or without OBJNAM)

When multiple charts contain the same feature (same dedup key), only the one with the highest `_scaleNum` is kept. The other charts' scales are tracked for zoom range extension.

**Deduplication Categories:**

| Category | OBJL Codes | Description |
|----------|-----------|-------------|
| **Physical Objects** | 75 (LIGHTS), 17/14/18/19/16 (buoys), 7/9/5/6/8 (beacons), 74 (LNDMRK), 159 (WRECKS), 153 (UWTROC), 86 (OBSTRN), 90 (PILPNT), 58 (FOGSIG), 111 (RSCSTA), 39 (DAYMAR), 144 (TOPMAR), 65 (HULKES), 95 (PONTON), 84 (MORFAC) | Fixed objects that appear on multiple overlapping charts |
| **Infrastructure** | 11 (BRIDGE), 21 (CBLOHD), 22 (CBLSUB), 94 (PIPSOL), 122 (SLCONS), 26 (CAUSWY) | Linear infrastructure features |
| **Regulatory Zones** | 112 (RESARE), 27 (CTNARE), 83 (MIPARE), 4 (ACHARE), 3 (ACHBRT), 82 (MARCUL), 20 (CBLARE), 92 (PIPARE), 51 (FAIRWY), 109 (RECTRC), 145 (TSELNE), 148 (TSSLPT), 85 (NAVLNE), 46 (DRGARE) | Navigational and regulatory zones |
| **Hydrographic** | 43 (DEPCNT), 42 (DEPARE), 129 (SOUNDG), 30 (COALNE), 71 (LNDARE) | Depth contours, depth areas, soundings, coastline, land |

#### 4c. Pass 2 — Write Deduplicated GeoJSON (Per-Scale Split)

Writes surviving features to per-scale GeoJSON files (`scale_1.geojson` through `scale_6.geojson`). Each feature gets `tippecanoe` zoom directives:

- **Non-deduped features**: Get the zoom range for their scale (e.g., US4 → z6–z16)
- **Deduped features found on multiple charts**: Get an extended zoom range spanning all scales that contained the feature (e.g., a light on both US3 and US5 → z4–z18)
- **Nav aids / safety areas**: Keep their pre-set `minzoom: 0` from the conversion step

#### 4d. Tippecanoe — Per-Scale GeoJSON → Per-Scale MBTiles

Runs `tippecanoe` once per scale to generate per-scale MBTiles:

| Scale | Zoom Range | Tippecanoe Flags |
|-------|-----------|------------------|
| US1 | z0–z8 | `--no-feature-limit --no-tile-size-limit --no-line-simplification -r1` |
| US2 | z0–z10 | `--no-feature-limit --no-tile-size-limit --no-line-simplification -r1` |
| US3 | z4–z13 | `--no-feature-limit --no-tile-size-limit --no-line-simplification -r1` |
| US4 | z6–z16 | `--no-feature-limit --no-tile-size-limit --no-line-simplification -r1` |
| US5 | z8–z18 | `--no-feature-limit --no-tile-size-limit --no-line-simplification --no-tiny-polygon-reduction -r1` |
| US6 | z6–z18 | `--no-feature-limit --no-tile-size-limit --no-line-simplification --no-tiny-polygon-reduction -r1` |

Key flags explained:
- `--no-feature-limit`: Don't drop features to meet tile count limits
- `--no-tile-size-limit`: Allow tiles to be any size (preserves all features)
- `--no-line-simplification`: Keep line geometry exact (critical for contours and coastline)
- `--no-tiny-polygon-reduction`: Preserve small polygons at US5/US6 (harbor-detail features)
- `-r1`: Drop rate 1 — no density-based feature dropping between zoom levels
- `-l charts`: Common layer name for all features (enables compositing)

After each tippecanoe run, the GeoJSON is deleted to free disk space.

#### 4e. tile-join — Merge Per-Scale MBTiles

Merges all per-scale MBTiles into a single unified file:

```bash
tile-join -o unified.mbtiles --no-tile-size-limit --force scale_1.mbtiles scale_2.mbtiles ...
```

The `--no-tile-size-limit` flag is **critical** — without it, tile-join silently drops tiles that exceed 500KB, causing navigation features to vanish at low zoom levels.

After the join, per-scale MBTiles are deleted to free disk space.

#### 4f. MVT Scale-Priority Post-Processing (ECDIS Logic)

**This is the key innovation for professional ECDIS-quality display.**

After tile-join, the unified MBTiles contains features from all chart scales in overlapping areas. For hydrographic features (contours, depth areas, coastline, land), having multiple scales visible simultaneously causes visual doubling (overlapping contour lines, etc.).

The `postprocess_scale_priority()` function iterates every tile in the MBTiles database:

1. **Decode**: Decompress (gzip) and decode the MVT protobuf using `mapbox-vector-tile`
2. **Analyze**: For each tile, find the highest `_scaleNum` per OBJL in `SCALE_PRIORITY_OBJLS`
3. **Filter**: If multiple scales contribute features for the same OBJL, keep only the highest `_scaleNum`
4. **Re-encode**: If features were removed, re-encode the MVT, gzip compress, and write back

**Scale Priority OBJLs** (features that get filtered):
| OBJL | Name | Why |
|------|------|-----|
| 43 | DEPCNT | Depth contours — overlapping contour lines from multiple scales |
| 42 | DEPARE | Depth areas — overlapping polygons cause rendering artifacts |
| 30 | COALNE | Coastline — doubled coastlines visible as thick/blurry lines |
| 71 | LNDARE | Land areas — overlapping land polygons cause z-fighting |

**Features that stay additive** (NOT filtered by scale priority):
- **Soundings (129)**: More depth values at higher zoom is correct ECDIS behavior
- **Navigation aids**: Lights, buoys, beacons should always be visible regardless of chart scale
- **Regulatory zones**: Restrictions visible from all chart scales

**Why tile-level processing works**: Tippecanoe clips line and polygon features to tile boundaries during tile generation. A contour line crossing a chart coverage boundary is split across tiles. Each tile is evaluated independently, giving approximately 1 km precision at z14 — more than adequate for seamless chart display.

**Processing**: Tiles are processed in batches of 5,000 with SQLite batch updates. Progress is logged every 20,000 tiles.

**Example output** (07cgd, 352 charts):
```
Scale priority complete: 30,299/2,048,758 tiles modified, 119,576 features removed
```

#### 4g. Upload & Finalize

1. **Raw MBTiles**: Uploaded to `{district}/charts/{prefix}_charts.mbtiles`
2. **Zipped MBTiles**: Created with `ZIP_DEFLATED` compression, uploaded to `{district}/charts/{prefix}_charts.mbtiles.zip`
3. **Firestore**: Updates `districts/{district}` document with:
   - `chartData.composedAt`, `totalCharts`, `totalSizeMB`, `zipSizeMB`
   - `chartData.dedupStats` (input/output/removed counts by category)
   - `chartData.scalePriorityStats` (tiles scanned/modified, features removed)
   - `chartData.md5Checksum`, `bounds`, zoom ranges
4. **Metadata regeneration**: Calls the district-metadata service (`POST /generateMetadata`) to regenerate `{districtId}/download-metadata.json` in Storage. This ensures the app sees correct download file sizes immediately after conversion. The metadata service reads actual file sizes from Storage blobs for all pack types (charts, basemap, ocean, terrain, satellite, predictions, GNIS). Requires `METADATA_GENERATOR_URL` env var — passed from the enc-converter service to the compose job via Cloud Run Job container overrides. If the metadata service is unavailable, the compose job logs a warning and continues without failing.
5. **Cleanup**: Deletes all temp GeoJSON from Storage and local working directory

---

## Scale System

Charts are organized by NOAA scale prefix. Each scale has a tile generation range and a display range (used by the app for layer switching):

| Scale | Type | Tile Zoom Range | Display Range | Description |
|-------|------|----------------|---------------|-------------|
| US1 | Overview | z0–z8 | z0–z9 | Continental view |
| US2 | General | z0–z10 | z8–z11 | Regional planning |
| US3 | Coastal | z4–z13 | z10–z13 | Coastal navigation |
| US4 | Approach | z6–z16 | z12–z15 | Harbor approaches |
| US5 | Harbor | z8–z18 | z14–z17 | Harbor detail |
| US6 | Berthing | z6–z18 | z16–z22 | Berth-level detail |

The tile zoom ranges are extended beyond the display ranges to support the app's user-selectable detail level feature (low/medium/high), which shifts the SCAMIN offset to show more or less detail at each zoom.

---

## Feature Identification: OBJL Codes

Features are identified using **S-57 OBJL codes** (Object Class numeric codes), not layer names. This is the standard S-57 numeric identifier for each feature type.

### Why OBJL Codes?

1. **Standard**: OBJL is the official S-57 standard; layer names can vary between tools
2. **Reliable**: The converter always outputs OBJL from the authoritative `S57_OBJL` table
3. **Efficient**: Numeric comparison is faster than string comparison in Mapbox/MapLibre filters
4. **Consistent**: Works across all conversion pipelines and tools

### OBJL Code Reference

| OBJL | Name | Description |
|------|------|-------------|
| 2 | ACHARE | Anchorage Area |
| 3 | ACHBRT | Anchor Berth |
| 5 | BCNCAR | Cardinal Beacon |
| 6 | BCNISD | Isolated Danger Beacon |
| 7 | BCNLAT | Lateral Beacon |
| 8 | BCNSAW | Safe Water Beacon |
| 9 | BCNSPP | Special Purpose Beacon |
| 11 | BRIDGE | Bridge |
| 14 | BOYCAR | Cardinal Buoy |
| 15 | BOYINB | Installation Buoy |
| 16 | BOYISD | Isolated Danger Buoy |
| 17 | BOYLAT | Lateral Buoy |
| 18 | BOYSAW | Safe Water Buoy |
| 19 | BOYSPP | Special Purpose Buoy |
| 20 | CBLARE | Cable Area |
| 21 | CBLOHD | Overhead Cable |
| 22 | CBLSUB | Submarine Cable |
| 26 | CAUSWY | Causeway |
| 27 | CTNARE | Caution Area |
| 30 | COALNE | Coastline |
| 39 | DAYMAR | Daymark |
| 42 | DEPARE | Depth Area |
| 43 | DEPCNT | Depth Contour |
| 46 | DRGARE | Dredged Area |
| 51 | FAIRWY | Fairway |
| 58 | FOGSIG | Fog Signal |
| 65 | HULKES | Hulk |
| 71 | LNDARE | Land Area |
| 74 | LNDMRK | Landmark |
| 75 | LIGHTS | Light (Point = light symbol, LineString = sector arc) |
| 82 | MARCUL | Marine Farm/Culture |
| 83 | MIPARE | Military Practice Area |
| 84 | MORFAC | Mooring Facility |
| 85 | NAVLNE | Navigation Line |
| 86 | OBSTRN | Obstruction |
| 90 | PILPNT | Pilot Boarding Point |
| 92 | PIPARE | Pipeline Area |
| 94 | PIPSOL | Pipeline (Solid) |
| 95 | PONTON | Pontoon |
| 109 | RECTRC | Recommended Track |
| 111 | RSCSTA | Rescue Station |
| 112 | RESARE | Restricted Area |
| 121 | SBDARE | Seabed Area |
| 122 | SLCONS | Shoreline Construction |
| 129 | SOUNDG | Sounding |
| 144 | TOPMAR | Topmark |
| 145 | TSELNE | Traffic Separation Lane |
| 148 | TSSLPT | Traffic Separation Scheme |
| 153 | UWTROC | Underwater Rock |
| 156 | WATTUR | Water Turbulence |
| 159 | WRECKS | Wreck |

### Using OBJL in MapLibre Filters

```javascript
// Filter for depth areas (DEPARE)
filter={['==', ['get', 'OBJL'], 42]}

// Filter for all buoy types
filter={['in', ['get', 'OBJL'], ['literal', [14, 15, 16, 17, 18, 19]]]}

// Filter for light sectors (LIGHTS with LineString geometry)
filter={['all',
  ['==', ['get', 'OBJL'], 75],
  ['==', ['geometry-type'], 'LineString']
]}

// SCAMIN visibility filter (additive — once visible, stays visible at higher zoom)
const scaminFilter = ['any',
  ['!', ['has', 'SCAMIN']],
  ['>=', ['floor', ['zoom']], ['floor', ['-', 28 - scaminOffset,
    ['/', ['ln', ['get', 'SCAMIN']], ['ln', 2]]]]]
];
```

---

## Build & Deploy

### Docker Images

The converter uses a two-layer Docker image strategy:

**Base image** (`Dockerfile.base`): Contains heavy system dependencies (built infrequently):
- Ubuntu 22.04
- GDAL (`gdal-bin`, `libgdal-dev`)
- Tippecanoe (built from source)
- Google Cloud SDK
- Python packages: Flask, gunicorn, google-cloud-storage, google-cloud-firestore, google-cloud-run, GDAL Python bindings, mapbox-vector-tile, aiohttp, requests

**App image** (`Dockerfile`): Contains just the Python scripts (built on every code change):
- `convert.py`, `compose_job.py`, `server.py`, `merge_job.py`, `merge_utils.py`, `batch_convert.py`

### Build Commands

```bash
cd cloud-functions/enc-converter

# Rebuild base image (only when dependencies change: tippecanoe, GDAL, requirements.txt)
gcloud builds submit --config=cloudbuild-base.yaml --project=xnautical-8a296

# Build and push app image (~30s)
gcloud builds submit --config=cloudbuild.yaml --project=xnautical-8a296

# Deploy updated image to Cloud Run Service
gcloud run services update enc-converter \
  --image=gcr.io/xnautical-8a296/enc-converter:latest \
  --region=us-central1 --project=xnautical-8a296

# Deploy updated image to Cloud Run Job
gcloud run jobs update enc-converter-merge \
  --image=gcr.io/xnautical-8a296/enc-converter:latest \
  --region=us-central1 --project=xnautical-8a296
```

### Environment Variables

The enc-converter service requires the following env var for automatic metadata regeneration after conversion:

```bash
# Set on the enc-converter Cloud Run Service (one-time)
gcloud run services update enc-converter \
  --set-env-vars METADATA_GENERATOR_URL=https://generate-district-metadata-f2plukcj3a-uc.a.run.app \
  --region us-central1 --project xnautical-8a296
```

The orchestrator in `server.py` passes this to the compose job via Cloud Run Job container overrides, so no separate configuration is needed on the job itself.

### Running a Conversion

```bash
# Trigger parallel conversion for a district
curl -X POST https://enc-converter-653355603694.us-central1.run.app/convert-district-parallel \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -H "Content-Type: application/json" \
  -d '{"districtId": "07"}'

# Check conversion status
curl https://enc-converter-653355603694.us-central1.run.app/status?districtId=07 \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)"

# Manually run just the compose job (if temp GeoJSON already exists)
gcloud run jobs update enc-converter-merge \
  --update-env-vars DISTRICT_ID=07,DISTRICT_LABEL=07cgd,JOB_TYPE=compose,BUCKET_NAME=xnautical-8a296.firebasestorage.app \
  --region=us-central1 --project=xnautical-8a296

gcloud run jobs execute enc-converter-merge \
  --region=us-central1 --project=xnautical-8a296
```

### Regenerating Download Metadata

If download sizes in the app are stale (e.g., after a pipeline change or manual Storage upload), regenerate the `download-metadata.json` files:

```bash
# All districts
./scripts/regenerate-metadata.sh

# Specific district(s)
./scripts/regenerate-metadata.sh 05cgd 17cgd
```

This calls the district-metadata service to read actual file sizes from Storage and update both `{districtId}/download-metadata.json` in Storage and the `downloadPacks` field in Firestore.

### Local Single-Chart Conversion

For local development and testing (requires `gdal` and `tippecanoe` installed):

```bash
# Convert a single chart
python3 cloud-functions/enc-converter/convert.py /path/to/US4AK4PH.000 /tmp/output

# Output: /tmp/output/US4AK4PH.mbtiles
```

---

## App-Side Integration

### File Naming Convention

The app's manifest generator scans for files matching these patterns in the device's `mbtiles/` directory:

- `{prefix}_charts.mbtiles` — Unified charts (e.g., `d07_charts.mbtiles`, `alaska_charts.mbtiles`)
- `{prefix}_US{N}.mbtiles` — Per-scale packs (legacy, e.g., `d07_US4.mbtiles`)
- `gnis_names.mbtiles` — Geographic place names
- `basemap_ne.mbtiles` — Natural Earth basemap

### SCAMIN Visibility

The app uses an additive SCAMIN filter for all features. The standard S-52 SCAMIN behavior is: once a feature becomes visible (zoom >= SCAMIN threshold), it stays visible at all higher zoom levels. The data-level scale priority filtering ensures that only the most detailed chart's hydrographic features exist in each tile, so the additive filter produces clean, professional results.

The SCAMIN offset is configurable via the app's detail level setting (low/medium/high), which shifts the visibility threshold to show more or less detail at each zoom.

### Pushing MBTiles to Android Device

```bash
# Push unified charts for a district
CHART="d07_charts.mbtiles"
adb push /path/to/${CHART} /sdcard/Download/${CHART}
adb shell "cat /sdcard/Download/${CHART} | run-as com.xnautical.app tee /data/data/com.xnautical.app/files/mbtiles/${CHART} > /dev/null"
adb shell "rm /sdcard/Download/${CHART}"

# Verify on device
adb shell "run-as com.xnautical.app ls -lh /data/data/com.xnautical.app/files/mbtiles/"
```

---

## Verifying Output

### Quick Check

```bash
# Check file size
ls -lh unified.mbtiles

# Check metadata
sqlite3 unified.mbtiles "SELECT name, value FROM metadata;"

# Check tile distribution by zoom level
sqlite3 unified.mbtiles "SELECT zoom_level, COUNT(*) FROM tiles GROUP BY zoom_level ORDER BY zoom_level;"
```

### Inspect Tile Contents

```bash
# Decode a specific tile to see features
tippecanoe-decode unified.mbtiles 14 4567 8901

# Check for specific OBJL codes
tippecanoe-decode unified.mbtiles | grep '"OBJL":43' | head -5

# Visual inspection
npm install -g @mapbox/mbview
export MAPBOX_ACCESS_TOKEN="your_token"
mbview unified.mbtiles
```

---

## Troubleshooting

### "Missing tiles at low zoom levels" (tile-join)

**Symptom**: Charts don't show at z1–z3; large areas are blank.

**Cause**: `tile-join` has a default 500KB tile size limit. Low-zoom tiles cover huge geographic areas and often exceed this. `tile-join` **silently drops** these tiles.

**Fix**: Always use `--no-tile-size-limit` on ALL `tile-join` commands. The compose job and merge_utils both enforce this, and check stderr for "Skipping this tile" — any dropped tiles cause a hard failure.

### "Overlapping contour lines"

**Symptom**: Contour lines from multiple chart scales visible simultaneously, causing thick/blurry contours.

**Cause**: Multiple chart scales contribute DEPCNT features to the same tiles without scale priority filtering.

**Fix**: The `postprocess_scale_priority()` in `compose_job.py` handles this. If you see overlapping contours, verify the compose job ran with the scale priority step.

### "Compose job fails — no temp GeoJSON"

**Symptom**: Compose job exits with "No GeoJSON files found in temp storage."

**Cause**: Temp files were already cleaned up by a previous compose run, or batch conversion didn't complete.

**Fix**: Re-run the full pipeline via `/convert-district-parallel` to regenerate the temp GeoJSON files.

### "Navigation aids disappear at low zoom"

**Symptom**: Lights, buoys, beacons not visible when zoomed out.

**Cause**: Features lack `tippecanoe` zoom hints.

**Fix**: Verify `convert.py` sets `{minzoom: 0, maxzoom: 17}` for `NAVIGATION_AIDS` and `SAFETY_AREAS`.

### "Light sectors not showing"

**Symptom**: Directional lights show point but no arc.

**Cause**: MBTiles was created before sector arc generation was added.

**Fix**: Reconvert with current `convert.py`.

### "gcloud run jobs execute fails with priorityTier error"

**Symptom**: `INVALID_ARGUMENT: Invalid JSON payload received. Unknown name "priorityTier"`.

**Workaround**: Set env vars on the job definition first, then execute without overrides:
```bash
gcloud run jobs update enc-converter-merge \
  --update-env-vars DISTRICT_ID=07,JOB_TYPE=compose,... \
  --region=us-central1 --project=xnautical-8a296

gcloud run jobs execute enc-converter-merge \
  --region=us-central1 --project=xnautical-8a296
```

---

## Version History

| Date | Change |
|------|--------|
| 2026-02-16 | Compose job now auto-triggers metadata regeneration after conversion |
| 2026-02-16 | Added `scripts/regenerate-metadata.sh` for manual metadata refresh |
| 2026-02-16 | MVT scale-priority post-processing for ECDIS-quality contour display |
| 2026-02-16 | Hydrographic feature deduplication (DEPCNT, DEPARE, SOUNDG, COALNE, LNDARE) |
| 2026-02-16 | Unified MBTiles compose pipeline (compose_job.py) |
| 2026-02-16 | Complete documentation rewrite for cloud pipeline |
| 2026-01-29 | Updated zoom ranges for user-selectable detail level feature |
| 2026-01-30 | Removed `_layer` property; use S-57 OBJL codes for all filtering |
| 2026-01-25 | Added light sector arc generation (OBJL=75 LineString) |
| 2026-01-25 | Fixed layer discovery to handle all ogrinfo output formats |
| 2026-01-25 | Updated documentation for automated conversion script |

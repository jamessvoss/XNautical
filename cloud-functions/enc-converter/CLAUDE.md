# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ENC Converter is a Cloud Run service that converts S-57 Electronic Navigational Chart (ENC) source files into MBTiles vector tiles, organized into per-scale packs by USCG Coast Guard District. It is part of the XNautical platform.

## Build & Deploy

```bash
# Build and push app image (~30s, uses pre-built base image)
gcloud builds submit --config=cloudbuild.yaml --project=xnautical-8a296

# Rebuild base image (only when dependencies change: tippecanoe, GDAL, requirements.txt)
gcloud builds submit --config=cloudbuild-base.yaml --project=xnautical-8a296

# Deploy service and merge job after image rebuild
gcloud run services update enc-converter --image=gcr.io/xnautical-8a296/enc-converter:latest --region=us-central1 --project=xnautical-8a296
gcloud run jobs update enc-converter-merge --image=gcr.io/xnautical-8a296/enc-converter:latest --region=us-central1 --project=xnautical-8a296

# Local conversion of a single chart (requires gdal, tippecanoe installed locally)
python3 convert.py <input.000> [output_dir]

# Local batch conversion with dashboard
python3 batch_convert.py /path/to/ENC_ROOT /path/to/output --parallel 4
```

There are no tests in this project.

## Architecture

The system has two runtime modes sharing one Docker image:

**Cloud Run Service** (`server.py` via gunicorn) — Flask HTTP server with three conversion endpoints:
- `/convert` — Monolithic single-instance conversion (download → convert → merge → upload)
- `/convert-batch` — Converts a small batch of charts (5-10), used by parallel workers
- `/convert-district-parallel` — Orchestrator that splits a district into batches, fans out to `/convert-batch` across many Cloud Run instances, then launches Cloud Run Jobs for merging

**Cloud Run Job** (`merge_job.py`) — Standalone job that downloads per-chart MBTiles from temp storage, merges them with `tile-join` into a single scale pack, and uploads the result. One job execution per scale (US1-US6). Launched by the parallel orchestrator.

### Conversion Pipeline (per chart)

`convert.py` handles single-chart conversion in two steps:
1. **S-57 → GeoJSON** via `ogr2ogr` — Extracts all geometry layers, adds CHART_ID properties, generates light sector arc geometries, splits SOUNDG MultiPoint into individual depth points, sets correct OBJL codes from layer names
2. **GeoJSON → MBTiles** via `tippecanoe` — Scale-appropriate zoom ranges (US1: z0-8 through US6: z6-15), all scales use `--no-feature-limit --no-tile-size-limit --no-line-simplification -r1` to preserve every feature exactly

### Key Design Decisions

- **MVT layer names**: Features use per-feature `tippecanoe.layer` property. Standard features go to `charts` layer, light sector arc geometries go to `arcs` layer (separate layer avoids MapLibre mixed geometry bugs). Source chart tracked via `_chartId` property.
- **Navigation aids forced to all zooms**: LIGHTS, buoys, beacons, wrecks, obstructions get `tippecanoe.minzoom=0` so they appear at every zoom level.
- **Safety areas extend min zoom**: Charts containing RESARE, MIPARE, etc. have their min zoom extended to 0 regardless of scale.
- **Zoom-band parallel tippecanoe**: The compose job writes per-scale GeoJSON with `tippecanoe.minzoom`/`maxzoom` directives, then fans out to parallel Cloud Run Job workers. Scales with maxzoom > 14 are split into zoom bands (z_lo..14 + one worker per zoom 15+). Workers upload .mbtiles which are incrementally tile-joined into a single unified.mbtiles.
- **Skipped tile detection**: tippecanoe output is checked for "Skipping this tile" warnings — any dropped tiles cause a hard failure since missing navigation features is unacceptable.

### Scale System

Charts are organized by NOAA scale prefix: US1 (overview) through US6 (berthing). Each scale has defined zoom ranges for tile generation and display ranges for the app's layer switching.

### Storage Layout (Firebase Storage)

```
{district}cgd/enc-source/{chartId}/{chartId}.000      — S-57 source files
{district}cgd/chart-geojson/{chartId}/{chartId}.geojson — Cached per-chart GeoJSON (persistent)
{district}cgd/chart-geojson/_manifest.json            — Valid chart list for compose (transient)
{district}cgd/charts/temp/compose/                     — Tippecanoe fan-out artifacts (cleaned up)
{district}cgd/charts/{US1-US6}.mbtiles                 — Final merged scale packs
{district}cgd/charts/manifest.json                     — Pack metadata for the app
{district}cgd/charts/conversion-report.json            — Detailed conversion report
{district}/marine-zones/{zoneId}.geojson               — Marine zone geometry (GeoJSON)
```

Sub-region storage paths use the Firestore ID as prefix (e.g., `17cgd-Juneau/charts/...`).

### GCP Configuration

- **Project**: `xnautical-8a296`
- **Region**: `us-central1`
- **Storage bucket**: `xnautical-8a296.firebasestorage.app`
- **Service image**: `gcr.io/xnautical-8a296/enc-converter:latest`
- **Merge job name**: `enc-converter-merge`
- Valid districts: 01, 05, 07, 08, 09, 11, 13, 14, 17
- Alaska sub-regions: 17cgd-Juneau, 17cgd-Anchorage, 17cgd-Kodiak, 17cgd-DutchHarbor, 17cgd-Nome, 17cgd-Barrow
- Special sub-regions: 07cgd-wflorida (Tampa Bay area)
- Total regions: 17 (9 standard CGDs + 6 Alaska sub-regions + 1 Florida sub-region + 1 test)

### Shared Generator Modules

All four imagery/tile generators (basemap, ocean, terrain, satellite) share common code via `generators-base/`:

```
cloud-functions/generators-base/
├── config.py       # Region bounds, zoom packs, district prefixes (single source of truth)
└── tile_utils.py   # Tile math, coastal filtering, download, MBTiles packaging
```

The `build-generator.sh` script copies these shared modules into each generator's directory before Docker build, then cleans up after. It includes trap-based cleanup on interrupt.

```bash
# Build and deploy a specific generator
./build-generator.sh satellite-generator
./build-generator.sh terrain-generator
./build-generator.sh ocean-generator
./build-generator.sh basemap-orchestrator
```

Master region config lives at `config/regions.json` — this is the canonical source for all region definitions including bounds, prefixes, GNIS filenames, and display metadata.

### Batch Provisioning

`create_alaska_regions.py` provisions multiple regions in parallel. Each region gets its own thread that spawns `create_test_district.py`, which fires off independent Cloud Run instances. Region definitions are loaded from `config/regions.json`.

```bash
python3 create_alaska_regions.py                           # Alaska sub-regions only (6 in parallel)
python3 create_alaska_regions.py --all                     # ALL 15+ regions in parallel
python3 create_alaska_regions.py --districts 01cgd 07cgd   # Specific districts
python3 create_alaska_regions.py --region 17cgd-Juneau     # Single region
python3 create_alaska_regions.py --dry-run                 # Discovery only
python3 create_alaska_regions.py --skip-provisioning       # Re-run discovery + metadata only
```

Key reliability features in `create_test_district.py`:
- **Retry with exponential backoff**: `call_service()` retries transient HTTP errors (429, 500, 502, 503, 504)
- **Auth token refresh**: Thread-safe token caching with 45-minute auto-refresh
- **Parallel execution**: Setup tasks (chart copy, GNIS, Firestore doc) run in parallel; generators (ENC, imagery, predictions) run in parallel
- **NOAA rate stagger**: `--prediction-delay` flag staggers prediction requests across districts
- **Resume capability**: `--resume` flag skips already-completed phases; state tracked in `.pipeline-state-*.json`
- **Exit code propagation**: Non-zero exit on any phase failure

### Memory and Large Dataset Constraints

**Cloud Run's `/tmp` is tmpfs (RAM-backed).** Every file written to `/tmp` consumes memory, not disk. There is no real disk available. This is critical when working with large datasets:

- **Never accumulate large intermediate files.** If a pipeline produces multi-GB artifacts, process them incrementally — download one, process it, delete it before downloading the next. Do not download all files and then process them.
- **tile-join working set**: tile-join needs the input files + output file simultaneously. When merging into an accumulator, the working set is: accumulator + one input + temp output ≈ 2× accumulator + input. Plan for this.
- **Stream, don't batch.** Prefer streaming/incremental approaches over loading entire datasets. This applies to GeoJSON processing, mbtiles merging, and any multi-GB pipeline step.
- **32 Gi total budget.** The job runs with 32Gi memory. This must cover the OS, Python, all loaded data, AND all files in `/tmp`. Keep peak `/tmp` usage well under 20 GB to leave headroom.

The job is deployed with 32Gi/8CPU. The `server.py` orchestrator defines `memory_by_scale`/`cpu_by_scale` dicts but **cannot apply per-execution overrides** — the Cloud Run v2 API `ContainerOverride` does not support resource fields.

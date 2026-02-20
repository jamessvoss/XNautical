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
```

### GCP Configuration

- **Project**: `xnautical-8a296`
- **Region**: `us-central1`
- **Storage bucket**: `xnautical-8a296.firebasestorage.app`
- **Service image**: `gcr.io/xnautical-8a296/enc-converter:latest`
- **Merge job name**: `enc-converter-merge`
- Valid districts: 01, 05, 07, 08, 09, 11, 13, 14, 17

### Memory and Large Dataset Constraints

**Cloud Run's `/tmp` is tmpfs (RAM-backed).** Every file written to `/tmp` consumes memory, not disk. There is no real disk available. This is critical when working with large datasets:

- **Never accumulate large intermediate files.** If a pipeline produces multi-GB artifacts, process them incrementally — download one, process it, delete it before downloading the next. Do not download all files and then process them.
- **tile-join working set**: tile-join needs the input files + output file simultaneously. When merging into an accumulator, the working set is: accumulator + one input + temp output ≈ 2× accumulator + input. Plan for this.
- **Stream, don't batch.** Prefer streaming/incremental approaches over loading entire datasets. This applies to GeoJSON processing, mbtiles merging, and any multi-GB pipeline step.
- **32 Gi total budget.** The job runs with 32Gi memory. This must cover the OS, Python, all loaded data, AND all files in `/tmp`. Keep peak `/tmp` usage well under 20 GB to leave headroom.

The job is deployed with 32Gi/8CPU. The `server.py` orchestrator defines `memory_by_scale`/`cpu_by_scale` dicts but **cannot apply per-execution overrides** — the Cloud Run v2 API `ContainerOverride` does not support resource fields.

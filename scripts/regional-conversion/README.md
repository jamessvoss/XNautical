# Regional Chart Conversion Pipeline

Converts S-57 ENC charts into optimized regional MBTiles packs for mobile use.

## Overview

Instead of one massive file or thousands of individual chart files, this creates
a tiered system of regional packs:

| Pack | Contents | Size | Required |
|------|----------|------|----------|
| `alaska_overview.mbtiles` | US1+US2, z0-10 | ~50MB | Yes |
| `southeast_alaska.mbtiles` | US3-6, z8-18 | ~400MB | No |
| `southcentral_alaska.mbtiles` | US3-6, z8-18 | ~600MB | No |
| `southwest_alaska.mbtiles` | US3-6, z8-18 | ~300MB | No |
| `western_alaska.mbtiles` | US3-6, z8-18 | ~200MB | No |
| `northern_alaska.mbtiles` | US3-6, z8-18 | ~150MB | No |

**Total if all downloaded: ~1.7GB** (vs ~8GB with individual files)

## Usage

```bash
# Make executable
chmod +x run_conversion.sh

# Run conversion
./run_conversion.sh /path/to/ENC_ROOT /path/to/output

# Or run specific region only
python3 convert_regional.py /path/to/ENC_ROOT /path/to/output --region southeast
```

## How It Works

1. **Scans** all S-57 .000 files
2. **Converts** each to GeoJSON with zoom-level metadata
3. **Assigns** charts to regions based on bounds
4. **Runs tippecanoe** to create optimized MBTiles per region
5. **Creates** `regions.json` index for the app

## Zoom Ranges by Scale

Features from different chart scales appear at different zoom levels:

| Scale | Chart Type | Zoom Range |
|-------|------------|------------|
| US1 | Overview | z0-8 |
| US2 | General | z6-10 |
| US3 | Coastal | z8-13 |
| US4 | Approach | z11-16 |
| US5 | Harbor | z14-18 |
| US6 | Berthing | z16-22 |

Navigation aids (lights, buoys) are always visible regardless of scale.

## App Integration

The app loads `regions.json` and:
1. Always uses `alaska_overview.mbtiles` for z0-10
2. Uses regional packs (if downloaded) for z10+
3. Shows "Download Pack" prompt for areas without local data

## File Structure

```
regional_packs/
├── alaska_overview.mbtiles      # Required, always installed
├── southeast_alaska.mbtiles     # Optional
├── southcentral_alaska.mbtiles  # Optional
├── southwest_alaska.mbtiles     # Optional
├── western_alaska.mbtiles       # Optional
├── northern_alaska.mbtiles      # Optional
└── regions.json                 # Index of available regions
```

## Requirements

- Python 3.8+
- GDAL (ogr2ogr)
- tippecanoe
- ~20GB temp disk space during conversion
- ~2 hours for full conversion

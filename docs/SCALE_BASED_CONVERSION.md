# Scale-Based Chart Conversion Settings

## Overview

The conversion pipeline uses **per-scale regional packs** to enable clean chart rendering at each zoom level without overlap issues.

## Architecture v2.0: Per-Scale Packs

```
┌─────────────────────────────────────────────────────────────────┐
│                    PER-SCALE ARCHITECTURE                        │
│                                                                  │
│   Build time (conversion):                                       │
│     alaska_US1.mbtiles  ← Only US1 (overview) charts            │
│     alaska_US2.mbtiles  ← Only US2 (general) charts             │
│     alaska_US3.mbtiles  ← Only US3 (coastal) charts             │
│     alaska_US4.mbtiles  ← Only US4 (approach) charts            │
│     alaska_US5.mbtiles  ← Only US5 (harbor) charts              │
│     alaska_US6.mbtiles  ← Only US6 (berthing) charts            │
│                                                                  │
│   Runtime (server):                                              │
│     Request for z10 tile → Server selects US3 pack              │
│                          → Returns US3 features only            │
│                          → NO overlap with other scales!        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Benefits:**
1. **No overlap** - Each pack contains only ONE scale band
2. **Clean rendering** - No duplicate soundings or labels
3. **Flexible** - Server can serve any scale combination
4. **User preference** - Detail level adjusts which scale to show at each zoom

## Server Scale Selection

The server selects ONE scale per zoom level:

| Zoom (Low Detail) | Zoom (Med Detail) | Zoom (High Detail) | Scale |
|-------------------|-------------------|---------------------|-------|
| z0-7              | z0-5              | z0-3                | US1   |
| z8-9              | z6-7              | z4-5                | US2   |
| z10-11            | z8-9              | z6-7                | US3   |
| z12-13            | z10-11            | z8-9                | US4   |
| z14-15            | z12-13            | z10-11              | US5   |
| z16+              | z14+              | z12+                | US6   |

## Zoom Ranges in MBTiles

Each scale's pack contains tiles across a wide zoom range to support the detail level feature:

| Scale | Chart Type | Tile Zoom Range | Display Zoom Range |
|-------|------------|-----------------|-------------------|
| **US1** | Overview | z0-8 | z0-9 |
| **US2** | General | z0-10 | z8-11 |
| **US3** | Coastal | z4-13 | z10-13 |
| **US4** | Approach | z6-16 | z12-15 |
| **US5** | Harbor | z8-18 | z14-17 |
| **US6** | Berthing | z6-18 | z16+ |

## Tippecanoe Settings

All charts use these flags to preserve features:

```bash
--no-feature-limit      # Don't drop features to meet tile count limits
--no-tile-size-limit    # Allow tiles to be any size
--no-line-simplification # Keep line geometry exact
-r1                      # Drop rate 1 = no density-based dropping
```

US5 and US6 additionally use:
```bash
--no-tiny-polygon-reduction  # Preserve small polygons (berths, piers)
```

### Implementation

```python
def get_tippecanoe_settings(chart_id: str) -> tuple:
    """Returns: (max_zoom, min_zoom, additional_flags)"""
    
    if chart_id.startswith('US1'):
        return (8, 0, ['--no-feature-limit', '--no-tile-size-limit', 
                       '--no-line-simplification', '-r1'])
    
    elif chart_id.startswith('US2'):
        return (10, 0, ['--no-feature-limit', '--no-tile-size-limit',
                        '--no-line-simplification', '-r1'])
    
    elif chart_id.startswith('US3'):
        return (13, 4, ['--no-feature-limit', '--no-tile-size-limit',
                        '--no-line-simplification', '-r1'])
    
    elif chart_id.startswith('US4'):
        return (16, 6, ['--no-feature-limit', '--no-tile-size-limit',
                        '--no-line-simplification', '-r1'])
    
    elif chart_id.startswith('US5'):
        return (18, 8, ['--no-feature-limit', '--no-tile-size-limit',
                        '--no-line-simplification', '--no-tiny-polygon-reduction', '-r1'])
    
    elif chart_id.startswith('US6'):
        return (18, 10, ['--no-feature-limit', '--no-tile-size-limit',
                         '--no-line-simplification', '--no-tiny-polygon-reduction', '-r1'])
```

## Running Conversions

### Single Chart

```bash
# Convert one chart (settings auto-detected from chart ID)
python3 cloud-functions/enc-converter/convert.py \
    /path/to/ENC_ROOT/US5AK5SI/US5AK5SI.000 \
    /tmp/output
```

### Batch Conversion

```bash
# Convert all Alaska charts with parallel workers
python3 scripts/convert_alaska.py --parallel 8

# Convert specific scale bands only
python3 scripts/convert_alaska.py --scale-bands US3,US4,US5

# Rebuild regional packs from existing per-chart files
python3 scripts/convert_alaska.py --regional-only
```

### Output Structure

```
charts/converted/
├── per_chart/
│   ├── US1AK90M/
│   │   └── US1AK90M.mbtiles
│   ├── US5AK5SI/
│   │   └── US5AK5SI.mbtiles
│   └── ...
├── regional/
│   ├── alaska_overview.mbtiles    (US1+US2)
│   ├── southeast_alaska.mbtiles   (US3-US6 for SE Alaska)
│   ├── southcentral_alaska.mbtiles
│   └── alaska_full.mbtiles        (all charts merged)
└── temp/
```

## Verification

### Check Zoom Range in MBTiles

```bash
sqlite3 US5AK5SI.mbtiles "SELECT name, value FROM metadata WHERE name IN ('minzoom', 'maxzoom');"
# Expected: minzoom=8, maxzoom=18
```

### Check Tiles Exist at Expected Zooms

```bash
sqlite3 US5AK5SI.mbtiles "SELECT zoom_level, COUNT(*) FROM tiles GROUP BY zoom_level ORDER BY zoom_level;"
# Should show tiles from z8 through z18
```

### Decode and Inspect Features

```bash
tippecanoe-decode US5AK5SI.mbtiles 12/1024/1456 | head -50
```

## Navigation Safety

Critical navigation features (lights, buoys, wrecks, obstructions) get tippecanoe zoom hints during conversion to ensure they appear at ALL zoom levels within the chart's range:

```python
NAVIGATION_AIDS = {
    'LIGHTS', 'BOYLAT', 'BOYCAR', 'BOYSAW', 'BOYSPP', 'BOYISD',
    'BCNLAT', 'BCNSPP', 'BCNCAR', 'BCNISD', 'BCNSAW',
    'WRECKS', 'UWTROC', 'OBSTRN',
}
# These get: {'tippecanoe': {'minzoom': 0}}
```

## Version History

| Date | Change |
|------|--------|
| 2026-01-29 | Consolidated to single conversion pipeline (convert.py + convert_alaska.py) |
| 2026-01-29 | Updated zoom ranges for user-selectable detail level feature |
| 2026-01-29 | Removed deprecated batch_convert.py and regional-conversion scripts |
| 2026-01-27 | Implemented scale-based settings to solve US2 GB-file issue |
| 2026-01-26 | Added SCAMIN preservation for soundings |
| 2026-01-25 | Added light sector arc generation |

## References

- Single chart converter: [`cloud-functions/enc-converter/convert.py`](../cloud-functions/enc-converter/convert.py)
- Batch converter: [`scripts/convert_alaska.py`](../scripts/convert_alaska.py)
- Feature identification: [`docs/MBTILES_CONVERSION.md`](MBTILES_CONVERSION.md) (OBJL codes)
- Tippecanoe docs: https://github.com/felt/tippecanoe

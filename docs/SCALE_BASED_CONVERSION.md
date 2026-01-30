# Scale-Based Chart Conversion Settings

## Overview

The conversion pipeline uses **scale-appropriate** tippecanoe settings to optimize file size while preserving maximum detail where it matters most for navigation.

## Conversion Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SINGLE SOURCE OF TRUTH                        │
│                                                                  │
│     cloud-functions/enc-converter/convert.py                     │
│         └── get_tippecanoe_settings(chart_id)                   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│     scripts/convert_alaska.py                                    │
│         └── Calls convert.py as subprocess                       │
│         └── Creates regional packs via tile-join                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

All zoom ranges and tippecanoe flags are defined in `get_tippecanoe_settings()`. There is no other conversion script - `convert_alaska.py` is the batch converter that calls `convert.py` for each chart.

## Zoom Ranges by Scale

| Scale | Chart Type | Zoom Range | Use Case |
|-------|------------|------------|----------|
| **US1** | Overview | z0-8 | Continental view, route planning |
| **US2** | General | z0-10 | Regional planning (Gulf of Alaska) |
| **US3** | Coastal | z4-13 | Coastal navigation (Cook Inlet) |
| **US4** | Approach | z6-16 | Channel approaches |
| **US5** | Harbor | z8-18 | Harbor navigation |
| **US6** | Berthing | z10-18 | Docking, berthing |

### Extended Min Zoom for Detail Level Feature

The min zoom for US3-US6 charts has been extended 4 zoom levels earlier than standard to support the app's **user-selectable detail level** feature:

- **Low detail**: Charts appear at their standard zoom (e.g., US5 at z12)
- **Medium detail**: Charts appear 2 zooms earlier (e.g., US5 at z10)
- **High detail**: Charts appear 4 zooms earlier (e.g., US5 at z8)

This means a US5 harbor chart contains tiles from z8-z18, but the app controls when it starts displaying based on user preference.

## Chart Quilting: Zoom Level Overlap

At any given zoom level, multiple chart scales may have data available. The app's quilting logic selects which chart to display based on geographic coverage and user detail preference.

| Zoom | US1 | US2 | US3 | US4 | US5 | US6 |
|------|-----|-----|-----|-----|-----|-----|
| z0-3 | ✓ | ✓ | | | | |
| z4-5 | ✓ | ✓ | ✓ | | | |
| z6-7 | ✓ | ✓ | ✓ | ✓ | | |
| z8 | ✓ | ✓ | ✓ | ✓ | ✓ | |
| z9 | | ✓ | ✓ | ✓ | ✓ | |
| z10 | | ✓ | ✓ | ✓ | ✓ | ✓ |
| z11-13 | | | ✓ | ✓ | ✓ | ✓ |
| z14-16 | | | | ✓ | ✓ | ✓ |
| z17-18 | | | | | ✓ | ✓ |

**Key points:**
- Charts at different scales cover **different geographic areas** (US1 covers all of Alaska, US5 covers just a harbor)
- At z8, tiles may contain features from US1, US2, US3, US4, and US5 - but each covers its respective area
- The `_chartId` property on each feature allows the app to filter which chart to display
- Smooth transitions: each scale starts before the previous one ends

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

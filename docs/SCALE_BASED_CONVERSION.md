# Scale-Based Chart Conversion Settings

## Overview

As of 2026-01-27, the conversion pipeline uses **scale-appropriate** tippecanoe settings to optimize file size while preserving maximum detail where it matters most for navigation.

## The Problem

Using identical settings for all chart scales caused issues:
- **US2 charts** covering massive areas (Gulf of Alaska) produced **GB-sized files** at z17
- Rendering detail beyond source chart resolution wastes space and processing time
- Overview charts don't need harbor-level detail

## The Solution

Scale-based tippecanoe settings that match each chart's intended use and source resolution.

## Settings by Scale

| Scale | Chart Type | Max Zoom | Min Zoom | Use Case | Typical Size |
|-------|------------|----------|----------|----------|--------------|
| **US1** | Overview | z8 | z0 | World/continental view | <1 MB |
| **US2** | General | z10 | z8 | Regional planning (Gulf of Alaska) | 1-5 MB |
| **US3** | Coastal | z13 | z10 | Coastal navigation (Cook Inlet) | 2-8 MB |
| **US4** | Approach | z16 | z11 | Channel approaches | 5-15 MB |
| **US5** | Harbor | z18 | z13 | Docking/harbor navigation | 3-20 MB |

### US1 - Overview Charts

```bash
tippecanoe -z 8 -Z 0 \
    --drop-densest-as-needed \
    --simplify-only-low-zooms \
    -r2.5
```

**Rationale**: Continental overview. Drops dense features, simplifies lines. At z8, already showing more detail than printed chart equivalent.

**Example**: US1AK90M (All of Alaska)

### US2 - General Charts

```bash
tippecanoe -z 10 -Z 8 \
    --drop-densest-as-needed \
    --simplify-only-low-zooms \
    -r1
```

**Rationale**: Regional view. Prevents GB-sized files while preserving macro bathymetry and hazards. Min zoom z8 ensures smooth transition from US1.

**Example**: US2PACZS (Gulf of Alaska)

**Critical**: This prevents the GB-sized file issue while keeping enough detail for route planning.

### US3 - Coastal Charts

```bash
tippecanoe -z 13 -Z 10 \
    --no-line-simplification \
    --maximum-tile-bytes=2500000 \
    -r1
```

**Rationale**: Coastal detail emerges. Stop line simplification to preserve contour accuracy. 2.5MB tile limit keeps performance reasonable.

**Example**: US3AK12M (Cook Inlet)

**Key change**: `--no-line-simplification` starts here - depth contours must be accurate for coastal navigation.

### US4 - Approach Charts

```bash
tippecanoe -z 16 -Z 11 \
    --no-feature-limit \
    --no-line-simplification \
    --maximum-tile-bytes=5000000 \
    -r1
```

**Rationale**: High precision for channel navigation. Preserve all features, allow larger tiles (5MB) for dense areas.

**Example**: US4AK4PH (Approaches to Homer Harbor)

**Key change**: `--no-feature-limit` ensures all navigation aids and soundings are preserved.

### US5 - Harbor Charts

```bash
tippecanoe -z 18 -Z 13 \
    --no-feature-limit \
    --no-tile-size-limit \
    --no-line-simplification \
    --no-tiny-polygon-reduction \
    -r1
```

**Rationale**: Maximum detail, no compromises. Used for docking and harbor maneuvering. No limits on features or tile size.

**Example**: US5AK5SI (Homer Harbor)

**Key change**: `--no-tile-size-limit` allows tiles >10MB if needed for maximum precision.

## Chart Quilting Behavior

With scale-based zoom ranges, charts appear/disappear based on zoom level:

| Zoom Level | Visible Charts | Primary Use |
|------------|----------------|-------------|
| z0-7 | US1 only | Continental view |
| z8-9 | US1 + US2 | Regional planning |
| z10-12 | US2 + US3 | Coastal overview |
| z13-15 | US3 + US4 + US5 | Approach planning |
| z16-17 | US4 + US5 | Channel navigation |
| z18 | US5 only | Harbor/docking |

**Smooth transitions**: Min zoom for each scale is set to start before previous scale ends, ensuring overlap for quilting.

## File Size Comparison

### Before (All charts at z17, max preservation)

| Chart | Old Size | Issue |
|-------|----------|-------|
| US2PACZS | **>1 GB** | Unworkable |
| US3AK12M | 25 MB | Excessive for coastal chart |
| US4AK4PH | 8 MB | Appropriate |
| US5AK5SI | 6 MB | Could use more detail |

### After (Scale-based settings)

| Chart | New Size | Improvement |
|-------|----------|-------------|
| US2PACZS | **3-5 MB** | 200x smaller |
| US3AK12M | 5 MB | 5x smaller |
| US4AK4PH | 8 MB | Same (appropriate) |
| US5AK5SI | 10 MB | More detail at z18 |

## Implementation

Settings are automatically applied based on chart ID prefix in [`convert.py:get_tippecanoe_settings()`](../cloud-functions/enc-converter/convert.py).

```python
def get_tippecanoe_settings(chart_id: str) -> tuple:
    if chart_id.startswith('US1'):
        return (8, 0, ['--drop-densest-as-needed', ...])
    elif chart_id.startswith('US2'):
        return (10, 8, ['--drop-densest-as-needed', ...])
    # ... etc
```

No changes needed to conversion scripts - just run as normal:

```bash
./scripts/convert-charts.sh US2PACZS  # Automatically uses US2 settings
```

## Navigation Safety

**Critical navigation features** (lights, buoys, wrecks, obstructions) are marked with tippecanoe zoom hints during GeoJSON enrichment, ensuring they appear at ALL zoom levels regardless of scale settings:

```python
# Navigation aids identified by OBJL code (S-57 standard)
NAVIGATION_AIDS = {
    'LIGHTS',   # OBJL 75
    'BOYLAT', 'BOYCAR', 'BOYSAW', 'BOYSPP', 'BOYISD',  # OBJL 17, 14, 18, 19, 15
    'BCNLAT', 'BCNSPP', 'BCNCAR', 'BCNISD', 'BCNSAW',  # OBJL 8, 9, 6, 7, 10
    'WRECKS', 'UWTROC', 'OBSTRN',  # OBJL 159, 153, 86
}

# These get: {'tippecanoe': {'minzoom': 0, 'maxzoom': <chart_max>}}
```

This means:
- Lights visible on US2 charts even with `--drop-densest-as-needed`
- Wrecks/hazards never dropped at low zooms
- Navigation aids don't disappear when zooming out for route planning

**Note**: Features are filtered in the app using S-57 OBJL codes (e.g., `['==', ['get', 'OBJL'], 75]` for lights), not layer names. See [MBTILES_CONVERSION.md](MBTILES_CONVERSION.md) for the full OBJL reference.

## Verification

Check zoom range in converted MBTiles:

```bash
sqlite3 US2PACZS.mbtiles "SELECT value FROM metadata WHERE name='minzoom' OR name='maxzoom';"
# Should show: minzoom=8, maxzoom=10
```

Verify tile count is reasonable:

```bash
sqlite3 US2PACZS.mbtiles "SELECT COUNT(*) FROM tiles;"
# US2 should have ~1000-5000 tiles (not 50,000+)
```

## Modifying Settings

To adjust settings for a specific scale, edit [`convert.py:get_tippecanoe_settings()`](../cloud-functions/enc-converter/convert.py).

**Example**: Increase US3 max zoom to z14:

```python
elif chart_id.startswith('US3'):
    return (14, 10, [  # Changed from 13 to 14
        '--no-line-simplification',
        '--maximum-tile-bytes=2500000',
        '-r1'
    ])
```

**Warning**: Changing these settings affects quilting. If you increase max zoom for one scale, consider adjusting min zoom of the next scale up.

## References

- Implementation: [`cloud-functions/enc-converter/convert.py`](../cloud-functions/enc-converter/convert.py)
- Batch conversion: [`scripts/convert-charts.sh`](../scripts/convert-charts.sh)
- Technical details: [`docs/MBTILES_CONVERSION.md`](MBTILES_CONVERSION.md)
- Tippecanoe docs: https://github.com/felt/tippecanoe

## Version History

| Date | Change |
|------|--------|
| 2026-01-30 | Updated to reference OBJL codes for feature filtering |
| 2026-01-27 | Implemented scale-based settings to solve US2 GB-file issue |
| 2026-01-26 | Added SCAMIN preservation for soundings |
| 2026-01-25 | Added light sector arc generation |

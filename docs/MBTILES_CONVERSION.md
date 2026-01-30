# MBTiles Conversion Guide

## Overview

This document describes how to convert NOAA S-57 ENC files to MBTiles vector tiles for use in the XNautical mobile app.

### Conversion Philosophy

**Extract everything, control visibility in the app.**

We use minimal restrictions during conversion so that all S-57 data is preserved in the MBTiles. The app controls what is displayed through layer toggles and styling. This approach:
- Avoids needing to reconvert when adding new layer support
- Ensures no data is accidentally omitted
- Allows users to toggle layers on/off as needed

## Prerequisites

- **GDAL** (for ogr2ogr): `brew install gdal`
- **Tippecanoe**: `brew install tippecanoe`
- **Python 3.x**

## Conversion Pipeline

```
S-57 ENC (.000)  →  GeoJSON  →  MBTiles
     ↓                ↓            ↓
   ogr2ogr      combine +       tippecanoe
              enrich layers
```

### What the Conversion Does

1. **Extracts ALL layers** from the S-57 file (except metadata layers `GRUP=2`)
2. **Uses S-57 OBJL codes** for feature identification in Mapbox filters (e.g., DEPARE=42, LIGHTS=75)
3. **Generates synthetic features**:
   - Light sector arcs: LineString geometry for directional lights (OBJL=75 with `SECTR1`/`SECTR2`)
4. **Extracts depth from soundings**: Converts 3D coordinates `[lon, lat, depth]` to 2D with `DEPTH` property
5. **Adds zoom hints** for navigation aids to prevent tippecanoe from dropping them at low zooms

## Quick Start: Single Chart Conversion

```bash
# Convert a single S-57 chart (settings auto-detected from chart scale)
python3 cloud-functions/enc-converter/convert.py \
    /path/to/ENC_ROOT/US4AK4PH/US4AK4PH.000 \
    /tmp/mbtiles-output

# Output will use appropriate settings for US4 (approach chart):
# - Max zoom: z16
# - Min zoom: z11  
# - High precision settings for channel navigation

# Push to Android device
adb push /tmp/mbtiles-output/US4AK4PH.mbtiles /sdcard/Download/
adb shell "cat /sdcard/Download/US4AK4PH.mbtiles | run-as com.xnautical.app tee /data/data/com.xnautical.app/files/mbtiles/US4AK4PH.mbtiles > /dev/null"
adb shell "rm /sdcard/Download/US4AK4PH.mbtiles"
```

**New in 2026-01-27**: Tippecanoe settings are automatically selected based on chart scale (US1/US2/US3/US4/US5). See [`SCALE_BASED_CONVERSION.md`](SCALE_BASED_CONVERSION.md) for details.

## Batch Conversion: Multiple Charts

```bash
#!/bin/bash
# batch_convert.sh - Convert all charts in a directory

ENC_ROOT="/path/to/All_Alaska_ENC_ROOT"
OUTPUT_DIR="/tmp/mbtiles-output"
CONVERTER="cloud-functions/enc-converter/convert.py"

mkdir -p "$OUTPUT_DIR"

# Find all .000 files and convert
find "$ENC_ROOT" -name "*.000" | while read s57_file; do
    chart_id=$(basename "$s57_file" .000)
    echo "Converting $chart_id..."
    python3 "$CONVERTER" "$s57_file" "$OUTPUT_DIR" 2>&1 | tee -a conversion.log
done

echo "Conversion complete. Output in $OUTPUT_DIR"
```

## Conversion Script Details

### Location

`cloud-functions/enc-converter/convert.py`

### Usage

```bash
python3 convert.py <input.000> <output_dir>
```

### Key Features

#### 1. Automatic Layer Discovery

The script automatically discovers all layers in the S-57 file using `ogrinfo`. It extracts everything except:
- `DS*` layers (dataset metadata)
- `M_*` layers (coverage/quality metadata - not for display)

#### 2. Light Sector Arc Generation

For lights with `SECTR1` and `SECTR2` attributes (directional lights), the script generates synthetic arc features:

```
Light point (OBJL=75, Point)   →  Light symbol
SECTR1=24°, SECTR2=119°        →  Arc from 24° to 119° (OBJL=75, LineString)
```

Light sectors share OBJL=75 with LIGHTS but are distinguished by geometry type (LineString vs Point).

Arc parameters:
- **Radius**: 0.25 nautical miles (configurable)
- **Resolution**: 32 points per arc
- **Color**: Inherited from light's `COLOUR` attribute

#### 3. Sounding Depth Extraction

S-57 soundings store depth as the Z coordinate: `[longitude, latitude, depth]`

The script:
- Extracts depth to a `DEPTH` property
- Converts MultiPoint to individual Point features
- Removes Z coordinate (Mapbox doesn't use it)

#### 4. Navigation Aid Zoom Hints

Critical navigation features get `tippecanoe` hints to appear at all zoom levels:

```python
NAVIGATION_AIDS = {
    'LIGHTS', 'BOYLAT', 'BOYCAR', 'BOYSAW', 'BOYSPP', 'BOYISD',
    'BCNLAT', 'BCNSPP', 'BCNCAR', 'BCNISD', 'BCNSAW',
    'WRECKS', 'UWTROC', 'OBSTRN',
}
```

These features get: `{'tippecanoe': {'minzoom': 0, 'maxzoom': 17}}`

### Tippecanoe Settings

**IMPORTANT**: Tippecanoe settings are **automatically selected based on chart scale**. See [`docs/SCALE_BASED_CONVERSION.md`](SCALE_BASED_CONVERSION.md) for complete details.

| Scale | Zoom Range | Rationale |
|-------|------------|-----------|
| US1 | z0-8 | Overview - continental view |
| US2 | z0-10 | General - regional planning |
| US3 | z4-13 | Coastal - extended for detail level feature |
| US4 | z6-16 | Approach - extended for detail level feature |
| US5 | z8-18 | Harbor - extended for detail level feature |
| US6 | z10-18 | Berthing - extended for detail level feature |

The script [`convert.py`](../cloud-functions/enc-converter/convert.py) automatically detects chart scale from the filename and applies appropriate settings via `get_tippecanoe_settings()`.

**Why scale-based settings**:
- US2 charts were producing GB-sized files with uniform z17 settings
- Cartographic correctness: don't show detail beyond source resolution
- Optimized file sizes while preserving maximum detail where needed

## Feature Identification: OBJL Codes

Features are identified using **S-57 OBJL codes** (Object Class codes), not layer names. This is the standard S-57 numeric identifier for each feature type.

### Why OBJL Codes Instead of Layer Names?

1. **Standard**: OBJL is the official S-57 standard; layer names can vary between tools
2. **Reliable**: ogr2ogr always outputs OBJL; other properties like `_layer` may be empty
3. **Efficient**: Numeric comparison is faster than string comparison in Mapbox filters
4. **Consistent**: Works across all conversion pipelines and tools

### OBJL Code Reference

| OBJL | Layer Name | Description |
|------|------------|-------------|
| 2 | ACHARE | Anchorage Area |
| 3 | ACHBRT | Anchor Berth |
| 6 | BCNCAR | Cardinal Beacon |
| 7 | BCNISD | Isolated Danger Beacon |
| 8 | BCNLAT | Lateral Beacon |
| 9 | BCNSPP | Special Purpose Beacon |
| 10 | BCNSAW | Safe Water Beacon |
| 14 | BOYCAR | Cardinal Buoy |
| 15 | BOYISD | Isolated Danger Buoy |
| 16 | BOYINB | Installation Buoy |
| 17 | BOYLAT | Lateral Buoy |
| 18 | BOYSAW | Safe Water Buoy |
| 19 | BOYSPP | Special Purpose Buoy |
| 21 | CBLARE | Cable Area |
| 22 | CBLSUB | Submarine Cable |
| 23 | CBLOHD | Overhead Cable |
| 30 | COALNE | Coastline |
| 33 | CTNARE | Caution Area |
| 42 | DEPARE | Depth Area |
| 43 | DEPCNT | Depth Contour |
| 46 | DRGARE | Dredged Area |
| 57 | FAIRWY | Fairway |
| 71 | LNDARE | Land Area |
| 74 | LNDMRK | Landmark |
| 75 | LIGHTS | Light (Point=light symbol, LineString=sector arc) |
| 79 | MARCUL | Marine Farm/Culture |
| 83 | MIPARE | Military Practice Area |
| 86 | OBSTRN | Obstruction |
| 97 | PIPARE | Pipeline Area |
| 98 | PIPSOL | Pipeline (Solid) |
| 112 | RESARE | Restricted Area |
| 114 | SBDARE | Seabed Area |
| 129 | SOUNDG | Sounding |
| 153 | UWTROC | Underwater Rock |
| 156 | WATTUR | Water Turbulence |
| 159 | WRECKS | Wreck |

### Using OBJL in Mapbox Filters

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
```

## S-57 Layer Reference

### Core Navigation Layers

| Layer | Description | Geometry | OBJL Code |
|-------|-------------|----------|-----------|
| DEPARE | Depth areas | Polygon | 42 |
| DEPCNT | Depth contours | LineString | 43 |
| SOUNDG | Soundings (depth points) | Point | 129 |
| LIGHTS | Navigation lights | Point | 75 |
| LIGHTS (sector) | Light visibility arcs (synthetic) | LineString | 75 |

### Buoys

| Layer | Description | Geometry | App Toggle |
|-------|-------------|----------|------------|
| BOYLAT | Lateral buoys | Point | Buoys |
| BOYCAR | Cardinal buoys | Point | Buoys |
| BOYSAW | Safe water buoys | Point | Buoys |
| BOYSPP | Special purpose buoys | Point | Buoys |
| BOYISD | Isolated danger buoys | Point | Buoys |

### Beacons

| Layer | Description | Geometry | App Toggle |
|-------|-------------|----------|------------|
| BCNLAT | Lateral beacons | Point | Beacons |
| BCNSPP | Special purpose beacons | Point | Beacons |
| BCNCAR | Cardinal beacons | Point | Beacons |
| BCNISD | Isolated danger beacons | Point | Beacons |
| BCNSAW | Safe water beacons | Point | Beacons |

### Hazards

| Layer | Description | Geometry | App Toggle |
|-------|-------------|----------|------------|
| WRECKS | Wrecks | Point | Hazards |
| UWTROC | Underwater rocks | Point | Hazards |
| OBSTRN | Obstructions | Point/Area | Hazards |

### Land & Shoreline

| Layer | Description | Geometry | App Toggle |
|-------|-------------|----------|------------|
| LNDARE | Land areas | Polygon | Land |
| COALNE | Coastline | LineString | Coastline |
| LNDMRK | Landmarks | Point | Landmarks |
| SLCONS | Shoreline constructions | Line/Area | (not implemented) |

### Infrastructure

| Layer | Description | Geometry | App Toggle |
|-------|-------------|----------|------------|
| CBLARE | Cable areas | Polygon | Cables |
| CBLSUB | Submarine cables | LineString | Cables |
| PIPARE | Pipeline areas | Polygon | Pipelines |
| PIPSOL | Pipelines (solid) | LineString | Pipelines |
| FAIRWY | Fairways | Polygon/Line | (not implemented) |
| DRGARE | Dredged areas | Polygon | (not implemented) |

### Seabed

| Layer | Description | Geometry | App Toggle |
|-------|-------------|----------|------------|
| SBDARE | Seabed areas | Point/Area | Seabed |

### Other Common Layers

| Layer | Description | Geometry |
|-------|-------------|----------|
| DAYMAR | Daymarks | Point |
| PILPNT | Pilot boarding points | Point |
| RDOSTA | Radio stations | Point |
| MORFAC | Mooring facilities | Point/Area |
| LAKARE | Lake areas | Polygon |
| RIVERS | Rivers | Polygon/Line |
| SEAARE | Sea areas | Polygon |

## Verifying the Output

### Quick Check

```bash
# Check file was created and has reasonable size
ls -lh /tmp/mbtiles-output/*.mbtiles

# Check metadata
sqlite3 /tmp/mbtiles-output/US4AK4PH.mbtiles "SELECT name, value FROM metadata;"
```

### Verify Layer Contents

```bash
# List all feature types in the MBTiles
sqlite3 /tmp/mbtiles-output/US4AK4PH.mbtiles \
    "SELECT value FROM metadata WHERE name='json';" | \
    python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d, indent=2))"
```

### Visual Inspection with mbview

```bash
npm install -g @mapbox/mbview
export MAPBOX_ACCESS_TOKEN="your_token_here"
mbview /tmp/mbtiles-output/US4AK4PH.mbtiles
# Open http://localhost:3000
```

## Pushing to Device

### Single Chart

```bash
CHART_ID="US4AK4PH"
adb push /tmp/mbtiles-output/${CHART_ID}.mbtiles /sdcard/Download/${CHART_ID}.mbtiles
adb shell "cat /sdcard/Download/${CHART_ID}.mbtiles | run-as com.xnautical.app tee /data/data/com.xnautical.app/files/mbtiles/${CHART_ID}.mbtiles > /dev/null"
adb shell "rm /sdcard/Download/${CHART_ID}.mbtiles"
```

### Batch Push

```bash
for mbtiles in /tmp/mbtiles-output/*.mbtiles; do
    chart_id=$(basename "$mbtiles" .mbtiles)
    echo "Pushing $chart_id..."
    adb push "$mbtiles" /sdcard/Download/${chart_id}.mbtiles
    adb shell "cat /sdcard/Download/${chart_id}.mbtiles | run-as com.xnautical.app tee /data/data/com.xnautical.app/files/mbtiles/${chart_id}.mbtiles > /dev/null"
    adb shell "rm /sdcard/Download/${chart_id}.mbtiles"
done
```

### Verify on Device

```bash
adb shell "run-as com.xnautical.app ls -lh /data/data/com.xnautical.app/files/mbtiles/"
```

## Troubleshooting

### "Missing layers in output"

**Symptom**: Expected layers (DEPARE, DEPCNT, etc.) not in MBTiles

**Cause**: Layer discovery failed (older script versions had a bug with `ogrinfo` output parsing)

**Fix**: Use the current `convert.py` which handles both `"1: DEPARE (Polygon)"` and `"1: DEPARE"` formats

**Verify**:
```bash
ogrinfo -so -q /path/to/chart.000 | head -20
```

### "Light sectors not showing"

**Symptom**: Directional lights show point but no arc

**Cause**: MBTiles was created before sector arc generation was added

**Fix**: Reconvert the chart with current `convert.py`

**Verify**:
```bash
# Check if light sector arcs exist (OBJL=75 with LineString geometry)
tippecanoe-decode output.mbtiles | grep -A 5 '"OBJL":75' | grep LineString
```

### "Soundings missing depth values"

**Symptom**: Sounding points show but no depth labels

**Cause**: Depth wasn't extracted from Z coordinate

**Fix**: Reconvert with current script

**Verify**:
```bash
# Should show DEPTH property on SOUNDG features
```

### "Navigation aids disappear at low zoom"

**Symptom**: Lights/buoys/beacons not visible when zoomed out

**Cause**: Features lack `tippecanoe` zoom hints

**Fix**: Reconvert with current script (adds `minzoom: 0` to navigation aids)

### "Features don't match between adjacent charts"

**Cause**: Charts were processed with different tippecanoe settings

**Fix**: Reconvert ALL charts with identical settings

### "Tile size too large" error

**Symptom**: tippecanoe fails with tile size error

**Fix**: Add `--no-tile-size-limit` flag (use sparingly - large tiles impact performance)

### "Missing tiles at low zoom levels" (tile-join)

**Symptom**: Charts don't show at z1-z3, but appear at higher zooms. Large areas of the map are blank.

**Cause**: `tile-join` has a default 500KB tile size limit. At low zoom levels (z1-z3), tiles cover huge geographic areas and often exceed this limit. `tile-join` **silently drops** these tiles with only a stderr message: "%.1f%% of tile /z/x/y%.0f%.0f%.0f%.0f%.0f%.0f is > 500KB; skipping this tile"

**Example**: Alaska at z3/0/2 contains data from dozens of charts and exceeded 500KB, causing all of Alaska to be invisible at that zoom.

**Fix**: Add `--no-tile-size-limit` to ALL `tile-join` commands:

```bash
tile-join --no-tile-size-limit -o output.mbtiles input1.mbtiles input2.mbtiles
```

**Detection**: After running `tile-join`, check stderr for "skipping this tile" messages. The conversion scripts now fail loudly if any tiles are skipped.

**Verification**:
```bash
# Check that low-zoom tiles exist
sqlite3 output.mbtiles "SELECT zoom_level, COUNT(*) FROM tiles GROUP BY zoom_level ORDER BY zoom_level;"
# Should show tiles at z1, z2, z3, etc.
```

## Version History

| Date | Change |
|------|--------|
| 2026-01-29 | Updated zoom ranges for user-selectable detail level feature |
| 2026-01-30 | Removed `_layer` property; use S-57 OBJL codes for all filtering |
| 2026-01-25 | Added light sector arc generation (OBJL=75 LineString) |
| 2026-01-25 | Fixed layer discovery to handle all ogrinfo output formats |
| 2026-01-25 | Updated documentation for automated conversion script |

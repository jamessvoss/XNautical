# Fix for Zoom-Dependent Chart Visibility Issue

## Problem Summary

Charts (especially US1 Overview charts) were appearing at different zoom levels unexpectedly:
- Zoom 3: Only US1GLBEA shows
- Zoom 5: US1GLBDD and US1GLBDA appear
- Zoom 6.8: Part of US1GLBDC shows
- Zoom 7.0+: More charts progressively appear

All 16 US1 charts should be visible at z0-8, but were appearing progressively only at higher zooms.

## Root Cause Analysis

### The Problem: Tile Overlap with Single-Chart Selection

At low zoom levels, vector tiles cover large geographic areas:
- At z0: ONE tile covers the entire world
- At z2: Tile `0/2` contains data from **15 of the 16 US1 charts**

The quilting logic in `LocalTileServerModule.java` picks **ONE chart per tile** based on:
1. Highest detail level (all US1 charts are level 1 - tied)
2. First in iteration order (undefined with ConcurrentHashMap)

Since all US1 charts have the same level, the sort has no effect, and only ONE chart's data is served per tile.

### Why Charts Appear Progressively at Higher Zoom

At z0-5, tiles are large enough that many charts' bounds overlap the same tile. Only one chart is selected, so most data is hidden.

At z6+, tiles become small enough that they fall within only ONE chart's geographic bounds, so that chart's data finally appears.

### Evidence

All 16 US1 charts have tile data at z0/0/0:
```
US1AK90M: 74KB    US1GLBDA: 87KB    US1GLBDC: 83KB
US1GLBDD: 82KB    US1GLBEA: 84KB    US1WC04M: 94KB
... (all 16 have data)
```

But only ONE of these tiles was being served (whichever chart came first in HashMap iteration).

## Solution: Pre-Composite Charts

The recommended fix is to merge all charts of the same scale into a single composite MBTiles file using `tile-join` (part of tippecanoe). This combines all features from overlapping tiles into unified tiles.

### Create Composite

```bash
# Run the merge script
./scripts/merge-us1-charts.sh /path/to/charts /path/to/output US1
```

This creates `US1_composite.mbtiles` containing:
- All features from all 16 US1 charts
- Properly merged tiles where data overlaps
- z0 tile: 692KB (vs ~74-94KB for individual charts)

### Results

| Metric | Individual Charts | Composite |
|--------|------------------|-----------|
| z0 tile size | 74-94KB (each) | 692KB (combined) |
| Features visible at z0 | 1 chart only | All 16 charts |
| Files to manage | 16 | 1 |

### Deployment Steps

1. Create composite:
   ```bash
   ./scripts/merge-us1-charts.sh
   ```

2. Copy to device:
   ```bash
   adb push /path/to/US1_composite.mbtiles /path/on/device/
   ```

3. Update `chart_index.json` to reference the composite instead of individual charts

4. Remove individual US1*.mbtiles from device (optional, saves space)

## Code Changes Made

### LocalTileServerModule.java

Two changes were made to improve the quilting logic:

1. **Deterministic sorting**: Added alphabetical tiebreaker when chart levels are equal
   ```java
   // Before: undefined order when levels equal
   return b.level - a.level;
   
   // After: alphabetical tiebreaker
   int levelDiff = b.level - a.level;
   if (levelDiff != 0) return levelDiff;
   return a.chartId.compareTo(b.chartId);
   ```

2. **Try all candidates**: New method `findChartsForTile()` returns ALL matching charts, and `handleCompositeTileRequest()` tries each until finding one with data.

**Note**: These changes make behavior more predictable but don't fully solve the overlap issue. The pre-composite approach is still required for complete visibility at low zoom.

## Alternative: Runtime MVT Merging (Not Implemented)

An alternative would be to merge MVT (Mapbox Vector Tile) data at runtime in the Android server. This would require:
1. Getting tiles from ALL matching charts
2. Decompressing gzipped PBF data
3. Parsing and merging MVT protocol buffers
4. Re-encoding and re-compressing

This is significantly more complex and would add dependencies. The pre-composite approach is simpler and more efficient.

## Files Modified

- `android/app/src/main/java/com/xnautical/app/LocalTileServerModule.java` - Improved quilting logic
- `scripts/merge-us1-charts.sh` - New script to create composite MBTiles

## Testing

After creating and deploying the composite:

1. Clear tile cache on device
2. Verify all charts visible at z0:
   - Should see features from all 16 US1 charts
   - Tile requests should show `X-Chart-Source: US1_composite`
3. Check logcat for quilting decisions:
   ```
   adb logcat -s LocalTileServer
   ```

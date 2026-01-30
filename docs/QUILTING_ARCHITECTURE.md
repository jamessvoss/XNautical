# Nautical Chart Quilting Architecture

## The Problem

Vector tile boundaries are fixed by the Web Mercator grid. NOAA chart boundaries are based on geographic coverage. They don't align.

At low zoom, a single vector tile can span multiple chart boundaries, causing features from adjacent charts to be split across different MBTiles files. The quilting logic picks ONE file per tile, losing features from the others.

## Solution: Hybrid Compositing + Cascading Fallback

### Layer 1: Scale-Level Composites (for large-tile zoom ranges)

```
US1_composite.mbtiles  ← All 16 US1 charts merged (z0-8)
US2_composite.mbtiles  ← All 28 US2 charts merged (z8-10)  
US3_composite.mbtiles  ← All 37 US3 charts merged (z10-13)
```

At these zoom levels, tiles are large enough to cross chart boundaries. Compositing ensures all features are in the correct tiles.

### Layer 2: Individual Charts (for small-tile zoom ranges)

```
US4/*.mbtiles  ← 768 individual charts (z13-16)
US5/*.mbtiles  ← 366 individual charts (z16-18)
US6/*.mbtiles  ← 1 chart (z18+)
```

At z13+, tiles are small enough (~5km) to fit within individual charts. The boundary-crossing problem is minimal.

### The Quilting Algorithm

```
For each tile request (z, x, y):

1. Find the most detailed scale that EXISTS for this area:
   - Check US6 bounds → US5 bounds → US4 bounds → US3 → US2 → US1

2. Get tile from the most detailed available source:
   
   if (z >= 16 && US5/US6 chart covers tile):
       return tile from US5/US6 individual chart
   
   else if (z >= 13 && US4 chart covers tile):
       return tile from US4 individual chart
   
   else if (z >= 10):
       return tile from US3_composite (has z10-13 data)
   
   else if (z >= 8):
       return tile from US2_composite (has z8-10 data)
   
   else:
       return tile from US1_composite (has z0-8 data)

3. If selected source has no data at this tile, cascade down:
   US5 miss → try US4 → try US3_composite → try US2_composite → try US1_composite
```

## Handling Gaps

At detailed scales (US4, US5), there are intentional gaps - not every area has detailed survey data.

When viewing a harbor with US5 coverage surrounded by open water:
- Harbor tiles: Served from US5 chart (detailed)
- Adjacent water tiles: Cascade to US3 or US2 composite (less detail)
- Far offshore tiles: Fall back to US1 composite (overview)

This is the expected behavior - you see maximum available detail for each area.

## Implementation

### Step 1: Create Composites

```bash
# Create scale-level composites
./scripts/merge-us1-charts.sh /path/to/charts /path/to/output US1
./scripts/merge-us1-charts.sh /path/to/charts /path/to/output US2
./scripts/merge-us1-charts.sh /path/to/charts /path/to/output US3
```

### Step 2: Update Chart Index

```json
{
  "charts": {
    "US1_composite": { "level": 1, "minZoom": 0, "maxZoom": 8, "bounds": [...] },
    "US2_composite": { "level": 2, "minZoom": 8, "maxZoom": 10, "bounds": [...] },
    "US3_composite": { "level": 3, "minZoom": 10, "maxZoom": 13, "bounds": [...] },
    "US4AK1234": { "level": 4, "minZoom": 13, "maxZoom": 16, "bounds": [...] },
    // ... individual US4/US5/US6 charts ...
  }
}
```

### Step 3: Update Quilting Logic

The Android tile server's `findChartsForTile()` function needs to:
1. Sort by level descending (US5 > US4 > US3 > US2 > US1)
2. Filter by zoom visibility
3. Try each chart until finding one with tile data

## File Organization

```
charts/
├── composites/
│   ├── US1_composite.mbtiles    (29MB - z0-8 everywhere)
│   ├── US2_composite.mbtiles    (~70MB - z8-10)
│   └── US3_composite.mbtiles    (~300MB - z10-13)
├── US4/
│   ├── US4AK1234.mbtiles        (individual approach charts)
│   └── ...
├── US5/
│   ├── US5AK1234.mbtiles        (individual harbor charts)
│   └── ...
└── manifest.json                  (chart pack metadata)
```

## Why Not Composite Everything?

US4 (768 charts, 5.6GB) and US5 (366 charts, 2.5GB) are too large for practical mobile compositing. But at z13+, tiles are small enough that the boundary problem is minimal - most tiles fall entirely within a single chart's coverage.

The hybrid approach gives us:
- ✅ Correct tile coverage at all zoom levels
- ✅ Reasonable file sizes for mobile
- ✅ Cascading fallback for gaps
- ✅ Maximum detail where available

## Feature Identification

All features in composited tiles are identified by their **S-57 OBJL code** (a numeric identifier), not by layer name. This ensures consistent filtering across all sources:

```javascript
// Filter for depth areas (OBJL=42)
filter={['==', ['get', 'OBJL'], 42]}

// Filter for lights (OBJL=75)
filter={['==', ['get', 'OBJL'], 75]}
```

See [MBTILES_CONVERSION.md](MBTILES_CONVERSION.md) for the complete OBJL code reference.

## tile-join Considerations

When merging charts with `tile-join`, use `--no-tile-size-limit` to prevent tiles from being silently dropped at low zoom levels where they exceed the default 500KB limit:

```bash
tile-join --no-tile-size-limit -o US1_composite.mbtiles US1*.mbtiles
```

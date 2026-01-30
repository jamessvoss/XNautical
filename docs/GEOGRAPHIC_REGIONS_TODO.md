# Geographic Regional Packs - TODO

## Status: Deferred

The scale-based packs are complete. This document captures the plan for building true geographic regional packs.

## Current State

**Scale Packs (Complete):**
- `alaska_overview.mbtiles` - 110 MB (US1+US2 scale bands)
- `alaska_coastal.mbtiles` - 423 MB (US3 scale band)
- `alaska_detail.mbtiles` - 10 GB (US4+US5+US6 scale bands)
- `alaska_full.mbtiles` - 11 GB (all charts combined)

**Per-Chart Files (Complete):**
- 1,216 individual chart MBTiles in `/charts/converted/per_chart/`

## Geographic Regions (6 Total)

Six regions with intentionally overlapping boundaries to ensure no coverage gaps:

| Region | South | North | West | East | Description |
|--------|-------|-------|------|------|-------------|
| Southeast Alaska | 54.5° | 61° | -145.5° | -130° | Inside Passage: Ketchikan to Katalla |
| Southcentral Alaska | 56° | 62° | -157° | -140° | PWS, Cook Inlet, Kodiak, Anchorage |
| Southwest Alaska | 54° | 60° | -168° | -150° | Alaska Peninsula, Bristol Bay, Kodiak |
| Aleutians | 51° | 60° | -180° | -164° | Aleutian Islands & Pribilofs (St. Paul) |
| Western Alaska | 59° | 67° | -176° | -158° | Norton Sound, St. Matthew, Nome area |
| Arctic Alaska | 65° | 72° | -170° | -140° | North of Bering Strait |

### Key Design Decisions

**Intentional Overlaps:**
- **Southeast ↔ Southcentral**: Overlap near Katalla/Cordova area
- **Southcentral ↔ Southwest**: Both include Kodiak Island
- **Southwest ↔ Aleutians**: Overlap in Alaska Peninsula area
- **Aleutians ↔ Western**: Overlap zone 59°-60°N, -176° to -164°W
- **Western ↔ Arctic**: Overlap at ~65°N latitude

**Island Coverage:**
- **St. Paul Island (Pribilofs)** at 57°N, -170°W → Covered by **Aleutians**
- **St. Matthew Island** at 60.4°N, -172.7°W → Covered by **Western Alaska**
- **Kodiak Island** → Covered by both **Southcentral** and **Southwest**

**Dateline Considerations:**
- Aleutians region extends to -180° (dateline)
- Some NOAA charts (US1BS02M, etc.) wrap around the dateline
- Attu Island is technically in the Eastern Hemisphere (~173°E)

## Handling Overlapping Regions in the App

When a user has two regional packs that overlap, duplicate features exist in the overlap area.

**Recommended approach: Just let it overlap**
- Same features render on top of each other - visually identical
- Works fine for geometry (coastlines, depth areas, rocks, buoys)
- Use collision detection for labels

**Mapbox GL configuration:**
```javascript
// Load multiple sources
map.addSource('southeast', { type: 'vector', url: 'mbtiles://southeast_alaska.mbtiles' });
map.addSource('southcentral', { type: 'vector', url: 'mbtiles://southcentral_alaska.mbtiles' });

// Filter features using OBJL codes (not layer names)
// Example: depth areas (OBJL=42)
filter: ['==', ['get', 'OBJL'], 42]

// For symbol layers, enable collision detection to prevent double labels
{
  'icon-allow-overlap': false,
  'text-allow-overlap': false,
  'symbol-avoid-edges': true
}
```

**If deduplication is needed (usually overkill):**
- Every feature has a unique `LNAM` attribute
- App could track rendered LNAMs and skip duplicates
- Not recommended unless you see actual issues

## tile-join Considerations

When building regional packs with `tile-join`, always use `--no-tile-size-limit`:

```bash
tile-join --no-tile-size-limit -o southeast_alaska.mbtiles chart1.mbtiles chart2.mbtiles ...
```

Without this flag, tiles exceeding 500KB (common at low zoom levels where tiles cover large areas) are **silently dropped**, causing missing coverage.

## Preview Map

Interactive map showing boundaries with city markers:

```bash
open /Users/jvoss/Documents/XNautical/alaska_regions_preview.html
```

Features:
- Pan/zoom to inspect boundaries
- Click regions to see descriptions
- Major cities labeled for reference

## Implementation Plan

### 1. Add Region Definitions to Script

Add to `scripts/convert_alaska.py`:

```python
GEOGRAPHIC_REGIONS = {
    'southeast_alaska': {
        'bounds': (54.5, -145.5, 61, -130),  # (south, west, north, east)
        'description': 'Inside Passage: Ketchikan to Katalla'
    },
    'southcentral_alaska': {
        'bounds': (56, -157, 62, -140),
        'description': 'Prince William Sound, Cook Inlet, Kodiak, Anchorage'
    },
    'southwest_alaska': {
        'bounds': (54, -168, 60, -150),
        'description': 'Alaska Peninsula, Bristol Bay, Kodiak'
    },
    'aleutians': {
        'bounds': (51, -180, 60, -164),
        'description': 'Aleutian Islands and Pribilofs (St. Paul)'
    },
    'western_alaska': {
        'bounds': (59, -176, 67, -158),
        'description': 'Norton Sound, St. Matthew Island, Nome area'
    },
    'arctic_alaska': {
        'bounds': (65, -170, 72, -140),
        'description': 'North of Bering Strait'
    },
}
```

### 2. Get Chart Bounds Function

Extract bounds from each per-chart MBTiles:

```python
def get_chart_bounds(mbtiles_path):
    """Extract bounds from MBTiles metadata."""
    import sqlite3
    conn = sqlite3.connect(mbtiles_path)
    cursor = conn.execute("SELECT value FROM metadata WHERE name='bounds'")
    row = cursor.fetchone()
    conn.close()
    if row:
        west, south, east, north = map(float, row[0].split(','))
        return (south, west, north, east)
    return None
```

### 3. Check Region Intersection

```python
def intersects_region(chart_bounds, region_bounds):
    """Check if chart intersects region."""
    c_south, c_west, c_north, c_east = chart_bounds
    r_south, r_west, r_north, r_east = region_bounds
    
    # Check for no overlap
    if c_north < r_south or c_south > r_north:
        return False
    if c_east < r_west or c_west > r_east:
        return False
    return True
```

### 4. Build Process

```bash
# Build all geographic regions
python3 scripts/convert_alaska.py --geographic-regions

# Or build specific region
python3 scripts/convert_alaska.py --region southeast_alaska
```

### 5. Parallel Execution

Build all 6 regions in parallel (CPU load is low during tile-join, so this is efficient):

```python
from concurrent.futures import ProcessPoolExecutor

with ProcessPoolExecutor(max_workers=6) as executor:
    futures = {
        executor.submit(build_geographic_region, name, config): name
        for name, config in GEOGRAPHIC_REGIONS.items()
    }
```

## Expected Output

```
/charts/converted/geographic/
├── southeast_alaska.mbtiles    (~2-3 GB estimated)
├── southcentral_alaska.mbtiles (~3-4 GB estimated)
├── southwest_alaska.mbtiles    (~2-3 GB estimated)
├── aleutians.mbtiles           (~1-2 GB estimated)
├── western_alaska.mbtiles      (~1 GB estimated)
└── arctic_alaska.mbtiles       (~500 MB estimated)
```

## Product Lineup

**Full Alaska** ($$$)
- `alaska_full.mbtiles` - 11 GB, all 1,216 charts, all zoom levels

**Geographic Regions** ($$)
- 6 regional packs
- Each is self-contained with all zoom levels for that area
- Users can buy just the region(s) they need

**Pricing Strategy:**
- Full Alaska = premium price
- Individual regions = lower price
- Buying 3+ regions might approach full Alaska price (consider bundle)

## To Resume This Work

1. Review/adjust region boundaries in `alaska_regions_preview.html`
2. Implement `--geographic-regions` flag in `convert_alaska.py`
3. Run `python3 scripts/convert_alaska.py --geographic-regions`
4. Verify each region covers expected islands/areas
5. Test loading multiple overlapping regions in app
6. Verify collision detection handles duplicate labels

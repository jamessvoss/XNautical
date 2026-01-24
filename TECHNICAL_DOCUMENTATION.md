# S-57 Nautical Chart Viewer - Technical Documentation

## Overview

This React Native application displays official NOAA S-57 electronic navigational charts (ENCs) offline on mobile devices. It implements professional ECDIS-style chart quilting, SCAMIN-based feature visibility, and proper nautical symbology.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        React Native App                          │
├─────────────────────────────────────────────────────────────────┤
│  ChartViewer.native.tsx                                          │
│  ├── Mapbox GL Native (@rnmapbox/maps)                          │
│  ├── GeoJSON Data Layers                                         │
│  │   ├── DEPARE (Depth Areas) - Polygons                        │
│  │   ├── DEPCNT (Depth Contours) - Lines                        │
│  │   ├── SOUNDG (Soundings) - Points                            │
│  │   └── LNDARE (Land Areas) - Polygons                         │
│  └── Debug Overlay                                               │
├─────────────────────────────────────────────────────────────────┤
│  assets/Maps/                                                    │
│  ├── US4AK4PH_*.json (Approach scale)                           │
│  ├── US5AK5SI_*.json (Homer Harbor)                             │
│  ├── US5AK5QG_*.json (Seldovia Harbor)                          │
│  └── US5AK5SJ_*.json (Approach Detail)                          │
└─────────────────────────────────────────────────────────────────┘
```

## Data Pipeline

### Source Data: S-57 Format

S-57 is the IHO (International Hydrographic Organization) standard for electronic navigational charts. NOAA provides free S-57 ENCs for US waters.

**Chart Files Used:**
| Chart ID | Name | Scale Type | Coverage |
|----------|------|------------|----------|
| US4AK4PH | Approaches to Homer Harbor | Approach (1:120,000) | Kachemak Bay |
| US5AK5SI | Homer Harbor | Harbor (1:18,000) | Homer Spit |
| US5AK5QG | Seldovia Harbor | Harbor (1:18,000) | Seldovia |
| US5AK5SJ | Approaches Detail | Approach Detail (1:30,000) | Eastern approaches |

### Extraction Process

S-57 data is converted to GeoJSON using GDAL/OGR:

```bash
# Extract depth contours
ogr2ogr -f GeoJSON US5AK5SI_depcnt.json US5AK5SI.000 DEPCNT

# Extract depth areas
ogr2ogr -f GeoJSON US5AK5SI_depare.json US5AK5SI.000 DEPARE

# Extract soundings
ogr2ogr -f GeoJSON US5AK5SI_soundg.json US5AK5SI.000 SOUNDG

# Extract land areas
ogr2ogr -f GeoJSON US5AK5SI_lndare.json US5AK5SI.000 LNDARE
```

### Sounding Processing

S-57 stores soundings as 3D MultiPoint geometries where depth is the Z coordinate. We "explode" these into individual Point features with a DEPTH property:

```
Original: MultiPoint with 701 coordinates, depth in Z
Processed: 701 Point features, each with DEPTH property
```

**Total Soundings Extracted:**
- US4AK4PH: 1,234 soundings
- US5AK5SI: 701 soundings
- US5AK5QG: 308 soundings
- US5AK5SJ: 235 soundings
- **Total: 2,478 soundings**

## Chart Quilting

### Concept

"Quilting" is how professional ECDIS systems display multiple overlapping charts. Charts are rendered in order from least to most detailed, with detailed charts overlaying less detailed ones.

```
Render Order (bottom to top):
1. US4AK4PH (Approach) - Base layer, always visible
2. US5AK5SJ (Approach Detail) - Overlays approach
3. US5AK5SI (Homer Harbor) - Overlays where it has coverage
4. US5AK5QG (Seldovia Harbor) - Overlays where it has coverage
```

### Implementation

```typescript
const CHART_RENDER_ORDER: ChartKey[] = [
  'US4AK4PH',  // Least detailed (bottom)
  'US5AK5SJ',
  'US5AK5SI',
  'US5AK5QG'   // Most detailed (top)
];
```

Each layer is rendered for all charts in order, ensuring proper z-ordering.

## SCAMIN (Scale Minimum) Filtering

### What is SCAMIN?

SCAMIN is an S-57 attribute that specifies the minimum display scale for a feature. It prevents clutter at small scales by hiding features that would be too dense.

**SCAMIN Values in Our Data:**

| Feature Type | US4AK4PH | US5AK5SI | US5AK5QG | US5AK5SJ |
|--------------|----------|----------|----------|----------|
| Contours (DEPCNT) | 179,999 / 349,999 | 21,999 / 44,999 | 21,999 / 44,999 | 44,999 / 89,999 |
| Soundings (SOUNDG) | 119,999 | 17,999 | 17,999 | 29,999 |
| Depth Areas (DEPARE) | None | None | None | None |

### SCAMIN to Zoom Level Conversion

```
zoom ≈ log₂(559,082,264 / scale)

SCAMIN 17,999  → zoom ~15
SCAMIN 29,999  → zoom ~14
SCAMIN 44,999  → zoom ~13.5
SCAMIN 119,999 → zoom ~12
SCAMIN 179,999 → zoom ~11.5
```

### Contour Filtering (Mutually Exclusive)

Contours use mutually exclusive zoom bands to prevent crossing lines from different chart scales:

```typescript
filter={[
  'any',
  // Harbor (SCAMIN <= 50000) -> zoom 15+ ONLY
  ['all', ['<=', ['get', 'SCAMIN'], 50000], ['>=', ['zoom'], 15]],
  // Detail (50000 < SCAMIN <= 100000) -> zoom 13-14 ONLY
  ['all', ['>', ['get', 'SCAMIN'], 50000], ['<=', ['get', 'SCAMIN'], 100000], 
   ['>=', ['zoom'], 13], ['<', ['zoom'], 15]],
  // Approach (SCAMIN > 100000) -> zoom 11-12 ONLY
  ['all', ['>', ['get', 'SCAMIN'], 100000], 
   ['>=', ['zoom'], 11], ['<', ['zoom'], 13]],
]}
```

### Sounding Filtering (Additive)

Soundings use additive filtering - more soundings appear as you zoom in:

```typescript
filter={[
  'any',
  // Harbor (SCAMIN <= 20000) -> zoom 14+
  ['all', ['<=', ['get', 'SCAMIN'], 20000], ['>=', ['zoom'], 14]],
  // Detail (20000 < SCAMIN <= 30000) -> zoom 13+
  ['all', ['>', ['get', 'SCAMIN'], 20000], ['<=', ['get', 'SCAMIN'], 30000], 
   ['>=', ['zoom'], 13]],
  // Approach (SCAMIN > 30000) -> zoom 12+
  ['all', ['>', ['get', 'SCAMIN'], 30000], ['>=', ['zoom'], 12]],
]}
```

## Layer Rendering

### Depth Areas (DEPARE)

Polygons representing depth zones, colored by depth range:

```typescript
fillColor: [
  'step', ['get', 'DRVAL2'],
  '#A5D6FF',  // 0-2m: Very light blue
  2, '#8ECCFF',  // 2-5m
  5, '#6BB8E8',  // 5-10m
  10, '#4A9FD8', // 10-20m
  20, '#B8D4E8', // 20m+
]
```

### Depth Contours (DEPCNT)

Lines at specific depths, color-coded by chart source (debug mode):

| Chart | Debug Color |
|-------|-------------|
| US4AK4PH | Orange |
| US5AK5SJ | Purple |
| US5AK5SI | Green |
| US5AK5QG | Red |

### Soundings (SOUNDG)

Individual depth values with priority-based display:

- **Depth-based coloring**: Red (<5m), Blue (5-20m), Gray (>20m)
- **Priority sorting**: `symbolSortKey: ['get', 'DEPTH']` - shallower soundings shown first
- **Collision detection**: Non-overlapping text with depth priority

### Land Areas (LNDARE)

Filled polygons in tan/sand color (#E8D4A0).

## Debug Features

The app includes comprehensive debugging tools:

### Debug Info Panel
- Current zoom level
- Active SCAMIN band indicator
- Chart activity status with color coding

### Chart Boundary Outlines
- Dashed lines showing each chart's coverage area
- Color-coded to match chart debug colors
- Toggle on/off

### Feature Inspector (Tap-to-Inspect)
- Tap any feature to see its properties
- Shows SCAMIN, depth values, source chart
- Displays all S-57 attributes

### Feature Counts
- Total contours and soundings per chart
- Visibility based on current zoom

## File Structure

```
MapTest/
├── src/
│   └── components/
│       ├── ChartViewer.native.tsx  # Main map component
│       ├── ChartViewer.web.tsx     # Web version
│       └── ChartViewer.tsx         # Platform selector
├── assets/
│   └── Maps/
│       ├── US4AK4PH_ENC_ROOT/      # Original S-57 files
│       ├── US4AK4PH_depare.json    # Extracted GeoJSON
│       ├── US4AK4PH_depcnt.json
│       ├── US4AK4PH_soundg.json
│       ├── US4AK4PH_lndare.json
│       └── ... (similar for other charts)
├── App.tsx                          # Entry point
├── app.json                         # Expo config
└── .env                             # Mapbox token (not in repo)
```

## Key Dependencies

- `@rnmapbox/maps`: React Native Mapbox GL
- `expo`: React Native framework
- `react-native`: Mobile UI framework

## Environment Setup

1. Create `.env` file with Mapbox token:
```
EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.your_token_here
```

2. Install dependencies:
```bash
npm install
```

3. Run on Android:
```bash
npx expo run:android
```

## Performance Considerations

### Data Size
- Total GeoJSON: ~4MB bundled with app
- Larger datasets may need lazy loading to avoid Hermes VM compilation limits

### Rendering Optimization
- `minZoomLevel` on ShapeSources prevents rendering at inappropriate scales
- SCAMIN filtering reduces feature count at low zoom
- Symbol collision detection managed by Mapbox GL

## Future Enhancements

1. **Navigation Features**: Add lights, buoys, beacons, hazards (data extracted but not yet displayed due to bundle size constraints)

2. **Lazy Loading**: Load GeoJSON from asset files at runtime instead of bundling

3. **Additional Charts**: Support for more chart coverage areas

4. **Offline Tiles**: Pre-cached base map tiles for true offline operation

## References

- [IHO S-57 Standard](https://iho.int/en/s-57-standard)
- [IHO S-52 Presentation Library](https://iho.int/en/s-52-standard)
- [NOAA ENC Direct](https://charts.noaa.gov/ENCs/ENCs.shtml)
- [GDAL/OGR S-57 Driver](https://gdal.org/drivers/vector/s57.html)
- [Mapbox GL JS Expressions](https://docs.mapbox.com/mapbox-gl-js/style-spec/expressions/)

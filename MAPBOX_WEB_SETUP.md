# Using Mapbox GL JS for Web - Setup Guide

## Overview

The web version now uses **Mapbox GL JS** with extracted vector tiles, matching the same technology used on iOS/Android. The chart data is served as static files for true offline operation.

## One-Time Setup (Already Done)

The following has been completed:

1. **Installed Mapbox GL JS**
   ```bash
   npm install mapbox-gl
   ```

2. **Extracted Vector Tiles**
   ```bash
   mb-util --image_format=pbf assets/Maps/homer_chart.mbtiles public/tiles
   ```
   
   This created `public/tiles/` with the following structure:
   ```
   public/tiles/
   ├── 10/          # Zoom level 10
   ├── 11/          # Zoom level 11
   ├── 12/          # Zoom level 12
   ├── 13/          # Zoom level 13
   ├── 14/          # Zoom level 14
   ├── 15/          # Zoom level 15
   ├── 16/          # Zoom level 16
   └── metadata.json
   ```

## Running the App

Simply run:
```bash
npm run web
```

The tiles in `public/tiles/` are served by Expo as static files - no separate tile server needed!

## How It Works Offline

1. **Vector tiles** are pre-extracted into `public/tiles/` as static `.pbf` files
2. **Expo/Metro** serves them like any other static asset (images, CSS, etc.)
3. **Mapbox GL JS** loads tiles from the local `/tiles/` path
4. **No internet required** - all chart data is local!

## Architecture

```
Web App
  ├── Mapbox GL JS (map library)
  ├── Vector tiles from /tiles/{z}/{x}/{y}.pbf
  └── Layers:
      ├── Land areas (lndare)
      ├── Depth areas (depare) - colored zones
      ├── Depth contours (depcnt) - lines
      └── Soundings (soundg) - depth labels
```

## Adding More Charts

To add additional chart areas:

1. **Convert S-57 to GeoJSON** (per layer):
   ```bash
   ogr2ogr -f GeoJSON chart2_depare.geojson CHART2.000 DEPARE
   ogr2ogr -f GeoJSON chart2_depcnt.geojson CHART2.000 DEPCNT
   ogr2ogr -f GeoJSON chart2_soundg.geojson CHART2.000 SOUNDG
   ogr2ogr -f GeoJSON chart2_lndare.geojson CHART2.000 LNDARE
   ```

2. **Create vector tiles**:
   ```bash
   tippecanoe -o chart2.mbtiles -Z10 -z16 \
     --layer=depare chart2_depare.geojson \
     --layer=depcnt chart2_depcnt.geojson \
     --layer=soundg chart2_soundg.geojson \
     --layer=lndare chart2_lndare.geojson \
     --force
   ```

3. **Extract tiles**:
   ```bash
   mb-util --image_format=pbf chart2.mbtiles public/tiles-chart2
   ```

4. **Update the map** to load from the new tiles directory or merge charts.

## Technology Stack

**Web:**
- Mapbox GL JS (map rendering)
- Vector tiles (.pbf format)
- Static file serving via Expo

**iOS/Android:**
- @rnmapbox/maps (React Native Mapbox)
- MBTiles file (homer_chart.mbtiles)
- Same vector tile data

**Benefits of using Mapbox GL JS:**
- ✅ Consistent technology across all platforms
- ✅ Better performance with vector tiles
- ✅ Smoother rendering and interactions
- ✅ Professional map styling with Mapbox GL style spec
- ✅ True offline capability

## Troubleshooting

### Tiles not loading
- Check that `public/tiles/` directory exists and contains zoom folders (10-16)
- Verify tiles are being served: navigate to `http://localhost:8081/tiles/13/1234/5678.pbf` (adjust coordinates)
- Check browser console for network errors

### Map is blank
- Ensure Mapbox access token is set in `.env`
- Check zoom level (10-16 supported)
- Verify you're looking at Homer Harbor coordinates (59.635°N, 151.490°W)

### Soundings not showing
- Vector tiles may need DEPTH property - check source GeoJSON
- Try adjusting zoom level (soundings appear at higher zoom)

## File Sizes

- **Vector tiles** (public/tiles/): ~1-2MB extracted
- **Mapbox GL JS**: ~500KB gzipped
- **Total web bundle**: Smaller than loading individual GeoJSON files

## Comparison: Leaflet vs Mapbox GL JS

| Feature | Leaflet (old) | Mapbox GL JS (new) |
|---------|---------------|-------------------|
| Data format | GeoJSON | Vector tiles (.pbf) |
| File size | 620KB (4 files) | ~1-2MB tiles |
| Performance | Good | Excellent |
| Rendering | Basic | GPU-accelerated |
| Platform consistency | Web only | Matches iOS/Android |
| Styling | CSS-like | GL style spec |
| Offline | ✅ Yes | ✅ Yes |

The switch to Mapbox GL JS provides better performance and consistency with the native mobile apps!

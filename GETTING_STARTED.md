# 🚢 XNautical - NOAA ENC Chart Viewer - Complete Setup Guide

Welcome! This guide will help you get your NOAA Electronic Navigational Chart viewer up and running.

## 📋 What You Have

Your project is a React Native app that displays professional-quality nautical charts using S-57 ENC data rendered with Mapbox.

### Core App
- ✅ React Native with Expo framework
- ✅ TypeScript for type safety
- ✅ iOS and Android support (Mapbox native)
- ✅ High-performance vector map rendering
- ✅ S-52 standard symbology

### Chart Data
- ✅ Multiple NOAA ENC charts for Cook Inlet / Kachemak Bay, Alaska
- ✅ Chart quilting (multi-scale display)
- ✅ Automated GeoJSON extraction from S-57 format
- ✅ 25+ feature types supported

### Features
- ✅ Depth areas with gradient coloring
- ✅ Depth contours with labels
- ✅ Soundings (individual depth measurements)
- ✅ Navigation lights with sector arcs
- ✅ Buoys and beacons with proper symbology
- ✅ Hazards (wrecks, rocks, obstructions)
- ✅ Submarine cables and pipelines
- ✅ Shoreline constructions (piers, jetties)
- ✅ Sea area names
- ✅ Interactive feature inspector
- ✅ Layer toggle controls

## 🎯 Quick Start

### Prerequisites

1. **Node.js** (v18+)
2. **GDAL/OGR** tools for S-57 extraction:
   ```bash
   # macOS
   brew install gdal
   
   # Ubuntu/Debian
   sudo apt install gdal-bin
   
   # Verify installation
   ogr2ogr --version
   ```
3. **Mapbox Access Token** (get one at https://mapbox.com)

### Setup

```bash
# Install dependencies
npm install --legacy-peer-deps

# Copy environment template
cp .env.example .env

# Edit .env and add your Mapbox token:
# EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.your_token_here

# Prebuild for native
npx expo prebuild

# Run on iOS
npm run ios

# Run on Android
npm run android
```

## 🗺️ Adding New Charts

### Step 1: Download ENC Data

1. Visit https://nauticalcharts.noaa.gov/charts/noaa-enc.html
2. Find your area of interest
3. Download the ENC file (will be a ZIP containing `*_ENC_ROOT` folder)
4. Extract to `assets/Maps/`

### Step 2: Extract Features

Use the extraction script to convert S-57 data to GeoJSON:

```bash
# Extract from a single chart
python3 scripts/extract-enc-features.py assets/Maps/US4AK4PG_ENC_ROOT

# Extract from ALL charts in the Maps directory
python3 scripts/extract-enc-features.py assets/Maps --all

# See all available options
python3 scripts/extract-enc-features.py --help

# List all extractable feature types
python3 scripts/extract-enc-features.py --list-features

# Dry run (see what would be extracted without writing files)
python3 scripts/extract-enc-features.py assets/Maps --all --dry-run

# Verbose output
python3 scripts/extract-enc-features.py assets/Maps --all --verbose
```

The script extracts these feature types:

| Feature | S-57 Layers | Description |
|---------|-------------|-------------|
| depare | DEPARE | Depth areas (polygons with depth ranges) |
| depcnt | DEPCNT | Depth contours (lines) |
| soundg | SOUNDG | Soundings (individual depths) |
| lndare | LNDARE | Land areas |
| coalne | COALNE | Coastline |
| lights | LIGHTS | Navigation lights |
| buoys | BOYLAT, BOYCAR, etc. | All buoy types |
| beacons | BCNLAT, BCNCAR, etc. | All beacon types |
| landmarks | LNDMRK | Landmarks (towers, etc.) |
| daymar | DAYMAR | Daymarks/daybeacons |
| wrecks | WRECKS | Shipwrecks |
| uwtroc | UWTROC | Underwater rocks |
| obstrn | OBSTRN | Obstructions |
| slcons | SLCONS | Shoreline constructions |
| cblare | CBLARE, CBLSUB | Cable areas and submarine cables |
| pipsol | PIPSOL | Pipelines |
| sbdare | SBDARE | Seabed areas (bottom type) |
| seaare | SEAARE | Named sea areas |
| pilpnt | PILPNT | Pilot boarding points |
| anchrg | ACHARE, ACHBRT | Anchorage areas |
| fairwy | FAIRWY | Fairways/channels |
| drgare | DRGARE | Dredged areas |
| resare | RESARE | Restricted areas |
| rivers | RIVERS | Rivers |
| lndrgn | LNDRGN | Named land regions |

### Step 3: Configure the Chart in App

Edit `src/components/ChartViewer.native.tsx`:

1. Import the GeoJSON files:
```typescript
import depareData_NEW from '../../assets/Maps/US4NEW_depare.json';
import depcntData_NEW from '../../assets/Maps/US4NEW_depcnt.json';
// ... import all feature types
```

2. Add to the `CHARTS` configuration:
```typescript
US4NEW: {
  name: 'Your Chart Name',
  shortName: 'Short Name',
  center: [-152.0, 59.5],  // Chart center [lon, lat]
  scaleType: 'approach',    // 'general', 'approach', or 'harbor'
  scale: 1,                 // Rendering order (higher = on top)
  minZoom: 0,
  scaminContour: 179999,    // SCAMIN for contours
  scaminSounding: 119999,   // SCAMIN for soundings
  bounds: [-152.4, 59.4, -151.8, 59.7],  // [minLon, minLat, maxLon, maxLat]
  data: {
    depare: depareData_NEW,
    depcnt: depcntData_NEW,
    soundg: soundgData_NEW,
    lndare: lndareData_NEW,
    lights: lightsData_NEW,
    buoys: buoysData_NEW,
    beacons: beaconsData_NEW,
    landmarks: landmarksData_NEW,
    wrecks: wrecksData_NEW,
    uwtroc: uwtrocData_NEW,
    obstrn: obstrnData_NEW,
    slcons: slconsData_NEW,
    cblare: cblareData_NEW,
    sbdare: sbdareData_NEW,
    seaare: seaareData_NEW,
    pipsol: pipsolData_NEW,
  },
},
```

3. Add to `CHART_RENDER_ORDER` (from largest scale to smallest):
```typescript
const CHART_RENDER_ORDER = ['US3LARGE', 'US4NEW', 'US5DETAIL'];
```

## 📁 Project Structure

```
XNautical/
├── App.tsx                         ← App entry point
├── src/
│   ├── components/
│   │   └── ChartViewer.native.tsx  ← Main chart display (Mapbox)
│   └── types/
│       └── s57.ts                  ← Type definitions
├── assets/
│   ├── Maps/
│   │   ├── extraction_manifest.json ← Extraction summary
│   │   ├── US5AK5SI_ENC_ROOT/       ← Raw ENC data
│   │   ├── US5AK5SI_depare.json     ← Extracted depth areas
│   │   ├── US5AK5SI_depcnt.json     ← Extracted contours
│   │   └── ...                      ← Other extracted features
│   └── symbols/
│       └── png/                     ← S-52 navigation symbols
├── scripts/
│   ├── extract-enc-features.py     ← Main extraction script
│   └── convert-symbols.js          ← SVG to PNG converter
└── [documentation files]
```

## 🔧 Customization

### Depth Area Colors

In `ChartViewer.native.tsx`, find the `fillColor` expression in the depth areas layer:

```typescript
fillColor: [
  'step',
  ['get', 'DRVAL2'],
  '#B8E4F0',    // 0-5m (very shallow)
  5, '#A5D6E8',  // 5-10m
  10, '#8DC9E0', // 10-20m
  20, '#75BCD8', // 20-50m
  50, '#5DAFD0', // 50-100m
  100, '#4BA2C8', // 100m+
],
```

### Layer Visibility

Toggle layers on/off using the UI buttons or by modifying the default state:

```typescript
const [showLand, setShowLand] = useState(true);
const [showDepthAreas, setShowDepthAreas] = useState(true);
const [showContours, setShowContours] = useState(true);
// ... etc.
```

### Chart Center and Zoom

Modify the initial camera position:

```typescript
<Mapbox.Camera
  centerCoordinate={[-151.4900, 59.6350]}
  zoomLevel={11}
/>
```

## 🐛 Troubleshooting

### Extraction Issues

**"ogr2ogr: command not found"**
```bash
# Install GDAL
brew install gdal  # macOS
sudo apt install gdal-bin  # Ubuntu
```

**"FillBucket: adding non-polygon geometry" warnings**
- These occur when a layer has mixed geometry types
- The app handles this automatically by filtering geometries
- Warnings are cosmetic and don't affect functionality

### Build Issues

**"Cannot find module" errors**
```bash
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
npx expo prebuild --clean
```

**Mapbox token issues**
- Ensure token is in `.env` file
- Token must have the right scopes enabled in Mapbox dashboard
- Check for typos in `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`

### Runtime Issues

**Chart not showing data**
1. Check the extraction manifest: `assets/Maps/extraction_manifest.json`
2. Verify GeoJSON files exist and have features
3. Check console for errors
4. Ensure chart is in `CHART_RENDER_ORDER`

**Missing features on one side of chart**
- Check if features are being quilted out
- Verify chart bounds are correct
- Check SCAMIN values aren't too restrictive

## 📚 Resources

- **S-57 Standard**: https://iho.int/en/s-57-edition-3-1
- **S-52 Presentation Library**: https://iho.int/en/s-52-main
- **NOAA ENC Charts**: https://nauticalcharts.noaa.gov
- **Mapbox Documentation**: https://docs.mapbox.com
- **Expo Documentation**: https://docs.expo.dev

## 🎉 Success Checklist

- [ ] App builds and runs without errors
- [ ] Charts display with depth areas colored
- [ ] Depth contours visible when zoomed in
- [ ] Soundings appear at high zoom levels
- [ ] Navigation lights show with correct colors
- [ ] Feature inspector works when tapping features
- [ ] Layer toggles hide/show features correctly
- [ ] Multiple charts quilt together properly

---

**Created**: January 24, 2026  
**Version**: 1.2.0  
**See Also**: README.md, PROJECT_SUMMARY.md

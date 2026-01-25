# S-57 Nautical Chart Viewer - Proof of Concept

A React Native application demonstrating offline display of official NOAA S-57 electronic navigational charts (ENCs) on mobile devices. This proof of concept validates the feasibility of integrating S-57/S-52 chart rendering into existing mobile applications.

## Project Status

**Proof of Concept** - Successfully demonstrates:
- S-57 data extraction and rendering
- S-52 symbology implementation
- Professional ECDIS-style chart quilting
- Navigation aid display with proper symbology
- Light sector visualization
- Offline-first architecture suitable for integration

## Features

### Chart Display
- **Offline Chart Display**: All chart data bundled with the app - no internet required
- **Multi-Chart Quilting**: 4 overlapping charts rendered in proper z-order
- **SCAMIN Filtering**: Official S-57 scale-minimum visibility control

### Bathymetry
- **Depth Areas (DEPARE)**: Color-coded by depth range
- **Depth Contours (DEPCNT)**: Labeled isobaths with SCAMIN filtering
- **Soundings (SOUNDG)**: 2,478 individual depth measurements
- **Depth-Priority Display**: Shallower depths rendered with higher priority

### Navigation Aids (NEW)
- **Lights**: S-52 light flare symbols with color-coded display
- **Light Sectors**: Arc visualization showing visible/obscured zones
- **Buoys**: Shape-based symbols (conical, can, pillar, spar, etc.)
- **Beacons**: Shape-based symbols (stake, tower, lattice, etc.)
- **Landmarks**: Category-based symbols (tower, chimney, monument, etc.)

### Feature Inspector
- **Tap-to-Inspect**: Tap any feature to view S-57 attributes
- **Light Details**: Full chart label (e.g., "Fl G 4s 8m 5M"), characteristic, period, range, sector info
- **Navigation Aid Details**: Shape, category, color, status, LNAM identifier
- **S-57 Attribute Decoding**: Human-readable translations of coded values

### Debug Tools
- Zoom level display
- SCAMIN band indicator
- Chart boundary visualization
- Color-coded contours by chart
- Feature counts per chart

## Charts Included

| Chart | Name | Scale | Soundings |
|-------|------|-------|-----------|
| US4AK4PH | Approaches to Homer Harbor | 1:120,000 | 1,234 |
| US5AK5SJ | Approaches Detail | 1:30,000 | 235 |
| US5AK5SI | Homer Harbor | 1:18,000 | 701 |
| US5AK5QG | Seldovia Harbor | 1:18,000 | 308 |

## Quick Start

### Prerequisites
- Node.js v18+
- Android Studio (for Android) or Xcode (for iOS)
- Mapbox account (free tier works)

### Installation

```bash
# Clone the repository
git clone https://github.com/jamessvoss/XNautical.git
cd XNautical

# Install dependencies
npm install

# Create .env file with your Mapbox token
echo "EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.your_token_here" > .env

# Run on Android
npx expo run:android

# Or run on iOS
npx expo run:ios
```

## How It Works

### Chart Quilting

Charts are rendered from least to most detailed (bottom to top):
1. **US4AK4PH** (Approach) - Base layer, always visible
2. **US5AK5SJ** (Approach Detail) - Overlays approach chart
3. **US5AK5SI** (Homer Harbor) - Overlays where it has coverage
4. **US5AK5QG** (Seldovia Harbor) - Overlays where it has coverage

More detailed charts automatically cover less detailed ones - this is called "quilting."

### SCAMIN (Scale Minimum)

NOAA embeds SCAMIN values in S-57 data to control when features appear:

**Contours** (mutually exclusive - prevents crossing lines):
- Zoom 11-12: Approach contours only
- Zoom 13-14: Approach Detail contours only
- Zoom 15+: Harbor contours only

**Soundings** (additive - more appear as you zoom):
- Zoom 12+: Approach soundings
- Zoom 13+: + Detail soundings
- Zoom 14+: + Harbor soundings (all 2,478 visible)

### Data Pipeline

```
S-57 (.000 files)  →  ogr2ogr  →  GeoJSON  →  React Native/Mapbox
```

## Documentation

See [TECHNICAL_DOCUMENTATION.md](TECHNICAL_DOCUMENTATION.md) for detailed information on:
- S-57 data format and extraction
- SCAMIN filtering implementation
- Chart quilting architecture
- Layer rendering details
- Debug features

## Project Structure

```
XNautical/
├── src/components/
│   └── ChartViewer.native.tsx   # Main map component (1,900+ lines)
├── assets/
│   ├── Maps/
│   │   ├── US4AK4PH_*.json      # Approach chart data
│   │   ├── US5AK5SI_*.json      # Homer Harbor data
│   │   ├── US5AK5QG_*.json      # Seldovia Harbor data
│   │   └── US5AK5SJ_*.json      # Approach Detail data
│   └── symbols/
│       ├── point/               # S-52 SVG source symbols
│       ├── line/                # S-52 line patterns
│       └── png/                 # Converted PNG symbols (1x/2x/3x)
├── scripts/
│   └── convert-symbols.js       # SVG to PNG conversion script
├── TECHNICAL_DOCUMENTATION.md   # Detailed technical docs
├── ARCHITECTURE.md              # System architecture
└── README.md                    # This file
```

## S-52 Symbology

The app uses official S-52 presentation library symbols converted to PNG format:

| Category | Symbols |
|----------|---------|
| **Lights** | Light flares (white, red, green, yellow) |
| **Buoys** | Conical, can, spherical, pillar, spar, barrel, super-buoy |
| **Beacons** | Stake, withy, tower, lattice, cairn |
| **Landmarks** | Tower, chimney, monument, flagpole, mast, windmill, church |

Symbols are rendered at 1x/2x/3x resolutions for device pixel density support.

## Debug Mode

The app includes built-in debugging tools:

- **Zoom Level Display**: Current map zoom
- **SCAMIN Band Indicator**: Which scale range is active
- **Chart Boundaries**: Dashed outlines showing coverage areas
- **Color-Coded Contours**: Each chart has a unique color
- **Tap-to-Inspect**: Tap any feature to see its S-57 attributes
- **Feature Counts**: Contours and soundings per chart

## Technologies

- **React Native** + **Expo**: Cross-platform mobile framework
- **@rnmapbox/maps**: Native map rendering with symbol layers
- **GDAL/OGR**: S-57 to GeoJSON conversion
- **sharp**: SVG to PNG symbol conversion
- **TypeScript**: Type-safe development

## Data Pipeline

```
S-57 ENC (.000)  →  ogr2ogr  →  GeoJSON  →  React Native/Mapbox
                      ↓
S-52 Symbols (SVG)  →  sharp  →  PNG (1x/2x/3x)  →  Mapbox.Images
```

### Extracted S-57 Object Classes
| Class | Description | Status |
|-------|-------------|--------|
| DEPARE | Depth areas | ✅ Implemented |
| DEPCNT | Depth contours | ✅ Implemented |
| SOUNDG | Soundings | ✅ Implemented |
| LNDARE | Land areas | ✅ Implemented |
| LIGHTS | Navigation lights | ✅ Implemented |
| BOYLAT | Lateral buoys | ✅ Implemented |
| BCNLAT | Lateral beacons | ✅ Implemented |
| LNDMRK | Landmarks | ✅ Implemented |
| WRECKS | Wrecks | Extracted, not displayed |
| OBSTRN | Obstructions | Extracted, not displayed |
| UWTROC | Underwater rocks | Extracted, not displayed |
| SLCONS | Shoreline construction | Not yet extracted |

## Integration Notes

This proof of concept is designed for eventual integration into a larger mobile application. Key considerations:

### What Can Be Reused
- **ChartViewer component**: Self-contained, can be adapted as a feature module
- **S-57 attribute decoders**: Lookup tables for COLOUR, LITCHR, BOYSHP, BCNSHP, etc.
- **Sector arc generation**: Algorithm for computing light sector geometries
- **Symbol assets**: PNG symbols at multiple resolutions
- **Data pipeline**: ogr2ogr scripts for extracting additional charts

### Integration Requirements
- Mapbox GL Native SDK and access token
- GeoJSON chart data (converted from S-57)
- PNG symbol assets
- Approximately 2MB per chart (GeoJSON + symbols)

### Recommended Approach
1. Extract the rendering logic from `ChartViewer.native.tsx`
2. Create a chart data service for managing multiple chart regions
3. Implement chart download/caching for offline use
4. Add to existing app as a "Chart View" feature

## Data Sources

- **NOAA Office of Coast Survey**: [NOAA ENC Direct](https://charts.noaa.gov/ENCs/ENCs.shtml)
- **S-52 Symbols**: [Esri Nautical Solution](https://github.com/ArcGIS/s52-symbol-repository) (Apache 2.0 license)
- Charts are official US government products, freely available

## License

Private - All rights reserved

## References

- [IHO S-57 Standard](https://iho.int/en/s-57-standard)
- [IHO S-52 Presentation Library](https://iho.int/en/s-52-presentation-library)
- [NOAA ENC Viewer](https://nauticalcharts.noaa.gov/enconline/enconline.html)
- [Mapbox GL Documentation](https://docs.mapbox.com/)

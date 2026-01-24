# S-57 Nautical Chart Viewer

A React Native application for displaying official NOAA S-57 electronic navigational charts (ENCs) offline on mobile devices. Implements professional ECDIS-style chart quilting with multiple overlapping chart scales.

## Features

- **Offline Chart Display**: All chart data bundled with the app - no internet required
- **Multi-Chart Quilting**: 4 overlapping charts rendered in proper z-order
- **SCAMIN Filtering**: Official S-57 scale-minimum visibility control
- **Depth Visualization**:
  - Color-coded depth areas (DEPARE)
  - Depth contours with labels (DEPCNT)
  - 2,478 individual soundings (SOUNDG)
  - Depth-priority display (shallower = more important)
- **Debug Tools**: Zoom level, SCAMIN status, chart boundaries, tap-to-inspect

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
git clone https://github.com/jamessvoss/MapTest.git
cd MapTest

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
MapTest/
├── src/components/
│   └── ChartViewer.native.tsx   # Main map component
├── assets/Maps/
│   ├── US4AK4PH_*.json          # Approach chart data
│   ├── US5AK5SI_*.json          # Homer Harbor data
│   ├── US5AK5QG_*.json          # Seldovia Harbor data
│   └── US5AK5SJ_*.json          # Approach Detail data
├── TECHNICAL_DOCUMENTATION.md   # Detailed technical docs
└── README.md                    # This file
```

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
- **@rnmapbox/maps**: Native map rendering
- **GDAL/OGR**: S-57 to GeoJSON conversion
- **TypeScript**: Type-safe development

## Data Sources

- **NOAA Office of Coast Survey**: [NOAA ENC Direct](https://charts.noaa.gov/ENCs/ENCs.shtml)
- Charts are official US government products, freely available

## License

Private - All rights reserved

## References

- [IHO S-57 Standard](https://iho.int/en/s-57-standard)
- [NOAA Chart Viewer](https://www.charts.noaa.gov/)
- [Mapbox GL Documentation](https://docs.mapbox.com/)

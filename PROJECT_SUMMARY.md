# XNautical - NOAA ENC Chart Viewer Project Summary

## Overview

XNautical is a **proof of concept** React Native mobile application demonstrating the feasibility of displaying NOAA Electronic Navigational Charts (ENC) in S-57 format with S-52 symbology. The implementation covers the Homer Harbor, Alaska area with 4 overlapping charts demonstrating chart quilting, navigation aid rendering, and light sector visualization.

**Goal**: Validate the technical approach for integrating S-57/S-52 chart capabilities into an existing mobile application as a feature module.

## Technology Stack

### Core Framework
- **React Native 0.81.5**: Cross-platform mobile development
- **Expo ~54.0.32**: Development tools and build system
- **TypeScript 5.9.2**: Type-safe development
- **React 19.1.0**: UI library

### Key Dependencies
- **react-native-maps 1.26.20**: Map visualization
- **expo-location 19.0.8**: GPS and positioning
- **expo-file-system 19.0.21**: Asset file access
- **react-native-web 0.21.2**: Web platform support
- **react-dom 19.1.0**: Web rendering

### Platform Support
- ✅ iOS (requires Google Maps API key)
- ✅ Android (requires Google Maps API key)
- ✅ Web (no API key required)

## Project Structure

```
XNautical/
├── assets/
│   ├── Maps/
│   │   └── US5AK5SI_ENC_ROOT/          # NOAA ENC Dataset
│   │       ├── CATALOG.031             # Exchange set catalog
│   │       ├── README.TXT              # Chart information
│   │       ├── USERAGREEMENT.TXT       # NOAA license
│   │       └── US5AK5SI/
│   │           ├── US5AK5SI.000        # Main chart data (binary S-57)
│   │           ├── US209SIA.TXT        # Chart notes
│   │           └── US209SIB.TXT        # Chart warnings
│   ├── icon.png
│   ├── splash-icon.png
│   ├── adaptive-icon.png
│   └── favicon.png
├── src/
│   ├── components/
│   │   └── ChartViewer.tsx             # Main chart display component
│   ├── types/
│   │   └── s57.ts                      # S-57 type definitions
│   └── utils/
│       └── s57Parser.ts                # ENC data parser
├── App.tsx                             # Application entry point
├── index.ts                            # Expo entry point
├── app.json                            # Expo configuration
├── package.json                        # Dependencies
├── tsconfig.json                       # TypeScript config
├── .npmrc                              # NPM configuration
├── .gitignore                          # Git ignore rules
├── README.md                           # Main documentation
├── CHART_CONFIG.md                     # Chart configuration guide
├── QUICKSTART.md                       # Quick start guide
└── PROJECT_SUMMARY.md                  # This file
```

## Features Implemented

### Chart Display (ChartViewer.native.tsx)
- ✅ Mapbox GL Native rendering (high performance)
- ✅ 4 charts with proper quilting (z-order overlay)
- ✅ SCAMIN-based feature visibility filtering
- ✅ Toggle controls for all layer types
- ✅ Satellite/Light base map toggle
- ✅ Offline operation (all data bundled)

### Bathymetric Visualization
- ✅ Color-coded depth areas (DEPARE) by depth range
- ✅ Depth contours (DEPCNT) with labels
- ✅ 2,478 individual soundings (SOUNDG)
- ✅ SCAMIN filtering (mutually exclusive for contours, additive for soundings)
- ✅ Depth-priority display (shallower = higher priority)

### Navigation Lights
- ✅ S-52 Light_Flare symbols (white, red, green, yellow)
- ✅ Color-based symbol selection from S-57 COLOUR attribute
- ✅ Light characteristic decoding (Fl, Oc, Iso, Q, etc.)
- ✅ **Light Sector Arcs**: Dashed arc showing visible sector with gap for obscured zone
- ✅ Sector bearing interpretation (S-57 "from seaward" + 180° offset)
- ✅ Enhanced inspector with chart label format (e.g., "Fl G 4s 8m 5M")

### Buoys and Beacons
- ✅ Shape-based S-52 symbols (7 buoy types, 6 beacon types)
- ✅ BOYSHP/BCNSHP attribute decoding
- ✅ CATLAM (lateral category) display
- ✅ Proper iconAnchor alignment with lights

### Landmarks
- ✅ Category-based S-52 symbols (tower, chimney, monument, etc.)
- ✅ CATLMK attribute decoding
- ✅ FUNCTN (function) attribute display
- ✅ Conspicuousness indicator

### Feature Inspector (Tap-to-Inspect)
- ✅ Lights: Chart label, color, characteristic, period, sequence, height, range, sector, category, exhibition, status, LNAM
- ✅ Buoys: Name, shape, category, color, status
- ✅ Beacons: Name, shape, category, color, additional info
- ✅ Landmarks: Name, category, function, visibility, color
- ✅ Raw S-57 attributes (limited display)

### S-52 Symbol System
- ✅ SVG to PNG conversion script (sharp)
- ✅ Multi-resolution output (1x/2x/3x for device density)
- ✅ Mapbox.Images preloading for efficient rendering
- ✅ 30+ navigation aid symbols implemented

### Debug Tools
- ✅ Zoom level display
- ✅ SCAMIN band indicator (Approach/Detail/Harbor)
- ✅ Active chart list
- ✅ Chart boundary visualization (toggle)
- ✅ Feature counts per chart

## Chart Data

### Homer Harbor Chart (US5AK5SI)
- **Official Name**: Homer Harbor
- **Cell Name**: US5AK5SI
- **Edition**: 1
- **Update Date**: October 3, 2024
- **Issue Date**: October 3, 2024
- **Location**: Homer Spit, Alaska
- **Authority**: NOAA
- **Format**: S-57 (ISO 8211 binary)

### Geographic Coverage
- **Min Latitude**: 59.60°N
- **Max Latitude**: 59.65°N
- **Min Longitude**: 151.52°W
- **Max Longitude**: 151.40°W
- **Type**: Harbor/Approach Chart

## Configuration Requirements

### Required for iOS/Android
- Google Maps API key from Google Cloud Console
- API key must be added to `app.json`:
  ```json
  "ios": {
    "config": {
      "googleMapsApiKey": "YOUR_KEY"
    }
  },
  "android": {
    "config": {
      "googleMaps": {
        "apiKey": "YOUR_KEY"
      }
    }
  }
  ```

### Required APIs to Enable
- Maps SDK for Android
- Maps SDK for iOS

### Web Platform
- No API key required
- Uses browser's native map rendering

## Commands

### Development
```bash
npm start          # Start Expo dev server
npm run ios        # Run on iOS simulator
npm run android    # Run on Android emulator
npm run web        # Run in web browser
```

### Testing
```bash
npx tsc --noEmit   # Type checking
```

### Installation
```bash
npm install --legacy-peer-deps
```

## Current Limitations & Future Enhancements

### Current Limitations
1. **Limited Object Classes**: Only 8 of 100+ S-57 object classes implemented
2. **No SLCONS**: Shoreline constructions (piers, breakwaters) not extracted
3. **Static Data**: ENC update files (.001, .002, etc.) not processed
4. **Single Region**: Only Homer Harbor area (4 charts)
5. **No GPS Integration**: Position tracking not implemented
6. **Web Platform**: Currently native-only (iOS/Android)

### What's Working Well (Proof of Concept Success)
- ✅ **S-57 Data Pipeline**: ogr2ogr extraction to GeoJSON works reliably
- ✅ **S-52 Symbology**: Symbol conversion and Mapbox rendering successful
- ✅ **Chart Quilting**: Multi-scale overlay with proper z-ordering
- ✅ **SCAMIN Filtering**: Official visibility thresholds implemented
- ✅ **Light Sectors**: Complex bearing calculations verified against NOAA charts
- ✅ **Offline Operation**: All data bundled, no network required
- ✅ **Performance**: Smooth rendering on mobile devices

### For Integration into Target App

#### Recommended Next Steps
1. **Extract Additional Object Classes**:
   - SLCONS (piers, breakwaters)
   - RESARE (restricted areas)
   - ACHARE (anchorage areas)
   - DRGARE (dredged areas)
   - FAIRWY (fairways)
   
2. **Chart Region Expansion**:
   - Create extraction scripts for new regions
   - Build chart catalog/download system
   
3. **Feature Module Architecture**:
   - Package as standalone React Native module
   - Define clear API for host app integration
   - Implement chart data service

#### Future Enhancements (Post-Integration)
- [ ] GPS position tracking overlay
- [ ] Route planning and waypoints
- [ ] Distance/bearing measurements
- [ ] Night mode (red lighting)
- [ ] AIS vessel tracking
- [ ] Tide/current predictions
- [ ] Fog signals (FOGSIG) display
- [ ] Chart notes and cautions

## Technical Challenges

### S-57 Parsing
- **Format Complexity**: ISO 8211 is a complex binary format
- **Libraries**: Limited JavaScript/TypeScript libraries available
- **Options**:
  1. Port existing C++ libraries to JavaScript
  2. Use WebAssembly compilation of C++ parser
  3. Build custom JavaScript parser
  4. Use server-side parsing with API

### S-52 Presentation
- **Symbol Rendering**: S-52 symbols are in HPGL or CIM format
- **Conversion**: Need to convert to SVG or React Native compatible format
- **Rule Engine**: Complex display rules based on scale and feature priority

### Performance
- **Large Datasets**: ENC files can contain thousands of features
- **Mobile Constraints**: Limited memory and CPU on mobile devices
- **Solution**: Implement tile-based rendering and level-of-detail

### Coordinate Systems
- **Projections**: Handle various coordinate reference systems
- **Transformations**: Convert between WGS84 and local datums
- **Accuracy**: Maintain precision for navigation safety

## Resources

### Documentation
- [IHO S-57 Standard](https://iho.int/en/s-57-edition-3-1)
- [IHO S-52 Presentation Library](https://iho.int/en/s-52-presentation-library)
- [NOAA ENC Data](https://www.nauticalcharts.noaa.gov/data/enc.html)
- [React Native Maps Docs](https://github.com/react-native-maps/react-native-maps)
- [Expo Documentation](https://docs.expo.dev/)

### Related Projects
- [OpenCPN](https://opencpn.org/) - Open source chartplotter (C++)
- [s57-tiler](https://github.com/wdantuma/s57-tiler) - Go-based S-57 to vector tiles
- [GDAL](https://gdal.org/) - Geospatial data library with S-57 support

## License & Legal

### Chart Data
- NOAA ENC data is official government data
- Subject to NOAA usage agreement (see USERAGREEMENT.TXT)
- Free for use including navigation
- Must include disclaimer and reference to NOAA

### Code
- Private project
- All rights reserved (or choose a license)

## Contact & Support

For questions or contributions, see the project repository or contact the development team.

---

**Last Updated**: January 24, 2026
**Version**: 1.2.0
**Status**: Proof of Concept - **Successfully Validated**

### Milestone Summary
| Milestone | Status |
|-----------|--------|
| S-57 Data Extraction | ✅ Complete |
| Bathymetric Display | ✅ Complete |
| Chart Quilting | ✅ Complete |
| SCAMIN Filtering | ✅ Complete |
| Navigation Lights | ✅ Complete |
| Light Sectors | ✅ Complete |
| Buoys & Beacons | ✅ Complete |
| Landmarks | ✅ Complete |
| S-52 Symbology | ✅ Complete |
| Feature Inspector | ✅ Complete |
| Integration Ready | ✅ Ready for planning |

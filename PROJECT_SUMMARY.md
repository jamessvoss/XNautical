# MapTest - NOAA ENC Chart Viewer Project Summary

## Overview

MapTest is a React Native mobile application built with Expo that displays NOAA Electronic Navigational Charts (ENC) in S-57 format. The initial implementation focuses on the Homer Harbor, Alaska chart (US5AK5SI) as a proof of concept for rendering hydrographic data including depth contours, soundings, and navigation aids.

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
MapTest/
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

### Chart Display (ChartViewer.tsx)
- ✅ Interactive map with satellite imagery
- ✅ Centered on Homer Harbor, Alaska (59.635°N, 151.490°W)
- ✅ Platform-specific map provider (Google Maps for Android, Apple Maps for iOS)
- ✅ Responsive header with chart information
- ✅ Loading state with spinner and chart name

### Bathymetric Visualization
- ✅ Color-coded depth contours (5m, 10m, 20m)
- ✅ Individual depth soundings with labels
- ✅ Depth-based color scheme:
  - Light Blue (#B3E5FC): 0-5 meters
  - Medium Blue (#4FC3F7): 5-10 meters
  - Deep Blue (#0288D1): 10-20 meters
  - Dark Blue (#01579B): 20+ meters
- ✅ Interactive legend showing depth ranges

### Navigation Features
- ✅ Navigation aid markers (buoys and lights)
- ✅ Marker details (name, type, description)
- ✅ Color-coded by type (yellow for lights, green for buoys)
- ✅ Toggle controls for depth labels and nav aids
- ✅ Pan and zoom functionality

### Data Layer (s57Parser.ts)
- ✅ S-57 parser class structure
- ✅ Chart metadata extraction
- ✅ Depth contour data structures
- ✅ Sounding point definitions
- ✅ Navigation aid types
- ✅ Mock data for development/testing
- ⚠️ Full binary S-57 parsing (future enhancement)

### Type System (s57.ts)
- ✅ S57Dataset interface
- ✅ GeographicBounds interface
- ✅ DepthContour interface
- ✅ Coordinate interface
- ✅ SoundingPoint interface
- ✅ NavigationAid interface
- ✅ S57Feature interface
- ✅ ChartMetadata interface
- ✅ Homer Harbor metadata constants

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
1. **Mock Data**: Currently using mock depth contours and soundings
2. **Binary Parsing**: S-57 .000 file not yet parsed (binary ISO 8211 format)
3. **Limited Features**: Only displaying basic bathymetry
4. **Single Chart**: Only Homer Harbor chart loaded
5. **No Updates**: ENC update files (.001, .002, etc.) not processed
6. **No S-52 Symbols**: Using simplified markers instead of official symbols

### Planned Enhancements

#### Phase 1: Core Parsing (Priority)
- [ ] Implement ISO 8211 binary format parser
- [ ] Extract real depth contours from .000 file
- [ ] Parse all S-57 feature types (DEPARE, SOUNDG, BOYCAR, etc.)
- [ ] Implement coordinate transformations

#### Phase 2: Full Chart Display
- [ ] S-52 presentation library integration
- [ ] Official nautical chart symbols
- [ ] Coastline and shoreline rendering
- [ ] Anchorage areas
- [ ] Restricted zones
- [ ] Fairways and channels
- [ ] Overhead cables and bridges

#### Phase 3: Navigation Features
- [ ] GPS position tracking
- [ ] Route planning and waypoints
- [ ] Distance and bearing measurements
- [ ] Compass overlay
- [ ] Speed and course display

#### Phase 4: Advanced Features
- [ ] Multiple chart support with seamless chart switching
- [ ] Chart catalog browser
- [ ] ENC update application (.001, .002 files)
- [ ] Tide and current predictions
- [ ] AIS vessel tracking integration
- [ ] Chart notes and cautions display
- [ ] Night mode with red lighting

#### Phase 5: Performance & Polish
- [ ] Tile-based rendering for large charts
- [ ] Caching and offline support
- [ ] Chart downloading and management
- [ ] Settings and preferences
- [ ] Help and tutorial system

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
**Version**: 1.0.0
**Status**: Initial Development - Proof of Concept

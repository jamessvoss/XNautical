# NOAA ENC Chart Configuration Guide

## Google Maps API Key Setup

To display maps on iOS and Android, you'll need a Google Maps API key.

### 1. Get a Google Maps API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the following APIs:
   - Maps SDK for Android
   - Maps SDK for iOS
4. Go to "Credentials" and create an API key
5. (Optional but recommended) Restrict the API key to your app's bundle ID

### 2. Add the API Key to Your Project

Open `app.json` and replace `YOUR_GOOGLE_MAPS_API_KEY` with your actual API key:

```json
"ios": {
  "config": {
    "googleMapsApiKey": "AIzaSy..."
  }
},
"android": {
  "config": {
    "googleMaps": {
      "apiKey": "AIzaSy..."
    }
  }
}
```

### 3. For Web

Web doesn't require a Google Maps API key for react-native-maps as it uses the native browser implementation.

## S-57 ENC Data

The project includes a sample NOAA ENC chart for Homer Harbor, Alaska (US5AK5SI).

### Chart Location
- **Directory**: `assets/Maps/US5AK5SI_ENC_ROOT/`
- **Chart File**: `US5AK5SI/US5AK5SI.000`
- **Area**: Homer Spit, Alaska
- **Edition**: 1 (Updated: 2024-10-03)

### Chart Features

The app displays:
- **Depth Contours**: Lines showing equal depths (isobaths)
- **Soundings**: Individual depth measurements in meters
- **Navigation Aids**: Buoys, lights, and markers
- **Bathymetric Data**: Color-coded depth information

### Depth Color Scheme
- Light Blue: 0-5 meters (shallow water)
- Medium Blue: 5-10 meters
- Deep Blue: 10-20 meters
- Dark Blue: 20+ meters (deep water)

## Current Implementation Status

### ✅ Completed
- Basic map display with satellite imagery
- Depth contour rendering
- Sounding point markers
- Navigation aid markers
- Color-coded bathymetry legend
- Toggle controls for layers

### 🚧 In Progress / Future
- Full S-57 binary format parsing
- Real-time data from .000 file
- S-52 presentation library symbols
- More chart layers (coastline, anchorages, etc.)
- Tide and current information
- Route planning
- AIS vessel tracking

## Understanding S-57 Format

S-57 is the IHO (International Hydrographic Organization) standard for Electronic Navigational Charts (ENCs).

### File Structure
- `.000` - Main chart data (binary ISO 8211 format)
- `.TXT` - Readme and warning files
- `CATALOG.031` - Exchange set catalog

### Key Features in S-57
- **Vector data** (not raster images)
- **Object-oriented** (coastlines, buoys, depth areas as discrete objects)
- **Scalable** (can be displayed at various zoom levels)
- **Layered** (separate layers for different feature types)

### Parsing Challenges
- Binary ISO 8211 format (complex to parse in JavaScript)
- Requires understanding of S-57 object catalog
- S-52 presentation library needed for proper symbol rendering
- Coordinate transformations and projections

## Next Steps for Full Implementation

1. **Binary Parser**: Implement ISO 8211 parser for .000 files
2. **Feature Extraction**: Parse S-57 objects (DEPARE, SOUNDG, BOYCAR, etc.)
3. **Symbol Library**: Implement S-52 symbol rendering
4. **Performance**: Optimize for mobile with tile-based rendering
5. **Updates**: Implement ENC update (ER file) application

## Resources

- [IHO S-57 Standard](https://iho.int/en/s-57-edition-3-1)
- [NOAA ENC Data](https://www.nauticalcharts.noaa.gov/data/enc.html)
- [S-52 Presentation Library](https://iho.int/en/s-52-presentation-library)
- [React Native Maps Documentation](https://github.com/react-native-maps/react-native-maps)

## Testing the App

1. Start the app: `npm start`
2. Run on iOS: `npm run ios`
3. Run on Android: `npm run android`
4. Run on Web: `npm run web`

The map will center on Homer Harbor, Alaska, showing the chart data.

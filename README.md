# MapTest - NOAA ENC Chart Viewer

A cross-platform mobile application built with React Native and Expo for displaying NOAA Electronic Navigational Charts (ENC). This app demonstrates rendering S-57 format hydrographic data, specifically the Homer Harbor, Alaska chart (US5AK5SI).

## 🗺️ Features

- **ENC Chart Display**: View NOAA nautical charts with depth information
- **Bathymetric Data**: Color-coded depth contours and soundings
- **Navigation Aids**: Display of buoys, lights, and markers
- **Multi-Platform**: Runs on iOS, Android, and Web
- **Interactive Controls**: Toggle depth labels and navigation aids
- **S-57 Support**: Framework for parsing S-57 ENC data

## 🚀 Tech Stack

- **React Native** (0.81.5) - Cross-platform mobile framework
- **Expo** (~54.0.32) - Development platform and tooling
- **Leaflet + react-leaflet** - Web map rendering with GeoJSON
- **@rnmapbox/maps** - Native iOS/Android map rendering with MBTiles
- **TypeScript** - Type-safe development
- **S-57 Parser** - Electronic Navigational Chart data handling
- **Expo Location** - GPS and positioning services
- **GeoJSON** - Chart data format for web (bundled offline)
- **MBTiles** - Vector tiles for native platforms (bundled offline)

## 📋 Prerequisites

- Node.js (v20.19.6 or higher)
- npm or yarn
- For iOS development: macOS with Xcode
- For Android development: Android Studio and Android SDK
- Expo Go app (for testing on physical devices)

## 🛠️ Installation

1. **Clone or navigate to the project directory**

2. **Install dependencies**:
```bash
npm install --legacy-peer-deps
```

3. **Configure Mapbox** (required for native platforms only):
   - Get a free Mapbox access token from [mapbox.com](https://account.mapbox.com/)
   - Create a download token with `DOWNLOADS:READ` scope
   - Add to `.env` file:
     ```
     EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=your_public_token_here
     RNMAPBOX_MAPS_DOWNLOAD_TOKEN=your_download_token_here
     ```
   - The web platform uses Leaflet and doesn't require Mapbox

4. **Run the app** (see below)

## 🏃 Running the App

### Start the development server
```bash
npm start
```

This will open the Expo Developer Tools in your browser. From there, you can:

### Run on iOS Simulator
```bash
npm run ios
```

### Run on Android Emulator
```bash
npm run android
```

### Run on Web Browser
```bash
npm run web
```

### Run on Physical Device
1. Install the **Expo Go** app on your iOS or Android device
2. Run `npm start`
3. Scan the QR code with:
   - **iOS**: Camera app
   - **Android**: Expo Go app

## 📁 Project Structure

```
MapTest/
├── assets/
│   ├── Maps/
│   │   ├── homer_chart.mbtiles      # Vector tiles (for native)
│   │   ├── depare.geojson           # Depth areas (for web)
│   │   ├── depcnt.geojson           # Depth contours (for web)
│   │   ├── soundg.geojson           # Soundings (for web)
│   │   ├── lndare.geojson           # Land areas (for web)
│   │   └── US5AK5SI_ENC_ROOT/       # Original S-57 data
│   ├── icon.png
│   └── ...
├── src/
│   ├── components/
│   │   ├── ChartViewer.web.tsx      # Web viewer (Leaflet + GeoJSON)
│   │   └── ChartViewer.native.tsx   # Native viewer (Mapbox + MBTiles)
│   ├── types/
│   │   └── s57.ts                   # S-57 type definitions
│   └── utils/
│       └── s57Parser.ts             # ENC data parser
├── App.tsx                          # Application entry point
├── app.json                         # Expo configuration
├── .env                             # Environment variables (Mapbox tokens)
└── README.md
```

## 🗺️ Chart Data

### Current Chart
- **Name**: Homer Harbor, Alaska
- **Cell**: US5AK5SI
- **Edition**: 1 (October 2024)
- **Location**: Homer Spit, Alaska (59.635°N, 151.490°W)
- **Type**: Harbor/Approach Chart

### Chart Features Displayed
- Depth areas with ECDIS-style color coding
- Depth contours (isobaths) with labels
- Individual soundings (depth measurements)
- Land areas and coastlines
- Satellite imagery overlay (optional, requires internet)
- Layer toggles for all chart elements

**Architecture:**
- **Web**: Leaflet with GeoJSON files (bundled in app, fully offline)
- **Native (iOS/Android)**: Mapbox GL Native with MBTiles (bundled in app, fully offline)

**Why Different Libraries?**
- Web uses Leaflet because it's simpler and works great with GeoJSON files
- Native uses Mapbox because it has excellent performance with MBTiles
- Both provide the same user experience and full offline functionality
- GeoJSON files for web are small enough to bundle directly (~600KB total)
- MBTiles for native is more efficient for mobile apps (~890KB single file)

## 🔧 Configuration

### App Configuration (`app.json`)
- App name, version, and description
- Platform-specific settings (iOS, Android, Web)
- Icons and splash screens
- Permissions and capabilities

### TypeScript Configuration (`tsconfig.json`)
- Strict type checking enabled
- React Native and Expo path mappings

## 📱 Platform-Specific Features

### iOS
- Supports both iPhone and iPad
- Configured in `app.json` under `ios` section
- Uses Mapbox GL Native with MBTiles for offline charts

### Android
- Edge-to-edge display enabled
- Adaptive icon configured
- Configured in `app.json` under `android` section
- Uses Mapbox GL Native with MBTiles for offline charts

### Web
- Responsive design support
- Custom favicon
- Configured in `app.json` under `web` section
- Uses Leaflet with GeoJSON for offline charts (no external servers needed)

## 🗺️ Adding New Chart Areas

To add a new chart area to the app:

### For Web Platform:
1. Convert S-57 data to GeoJSON using `ogr2ogr`:
   ```bash
   ogr2ogr -f GeoJSON depare.geojson ENC_ROOT/CATALOG.031 DEPARE
   ogr2ogr -f GeoJSON depcnt.geojson ENC_ROOT/CATALOG.031 DEPCNT  
   ogr2ogr -f GeoJSON soundg.geojson ENC_ROOT/CATALOG.031 SOUNDG
   ogr2ogr -f GeoJSON lndare.geojson ENC_ROOT/CATALOG.031 LNDARE
   ```
2. Place GeoJSON files in `assets/Maps/`
3. Update `ChartViewer.web.tsx` to import and display the new files

### For Native Platforms (iOS/Android):
1. Convert GeoJSON to MBTiles using `tippecanoe`:
   ```bash
   tippecanoe -o chart.mbtiles -Z10 -z16 \
     --layer=depare --layer=depcnt --layer=soundg --layer=lndare \
     --force depare.geojson depcnt.geojson soundg.geojson lndare.geojson
   ```
2. Place MBTiles file in `assets/Maps/`
3. Update `ChartViewer.native.tsx` to reference the new MBTiles file

## 🧪 Development Tips

1. **Hot Reloading**: Changes are automatically reflected in the app
2. **Developer Menu**: 
   - iOS Simulator: Cmd + D
   - Android Emulator: Cmd/Ctrl + M
   - Physical Device: Shake the device
3. **Console Logs**: Use `console.log()` - output appears in the terminal

## 🚢 Building for Production

### Build for iOS
```bash
expo build:ios
```

### Build for Android
```bash
expo build:android
```

### Build for Web
```bash
expo build:web
```

For more detailed build instructions, see the [Expo documentation](https://docs.expo.dev/distribution/building-standalone-apps/).

## 📚 Resources

- [Expo Documentation](https://docs.expo.dev/)
- [React Native Documentation](https://reactnative.dev/)
- [React Documentation](https://react.dev/)
- [TypeScript Documentation](https://www.typescriptlang.org/)

## 🐛 Troubleshooting

### Metro Bundler Issues
```bash
npm start --clear
```

### Dependency Issues
```bash
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
```

### iOS Simulator Not Opening
Ensure Xcode is installed and updated to the latest version.

### Android Emulator Not Starting
Ensure Android Studio is installed and at least one AVD (Android Virtual Device) is configured.

## 📝 License

Private - All rights reserved

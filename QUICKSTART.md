# Quick Start Guide - XNautical NOAA Chart Viewer

## 🚀 Getting Started in 5 Minutes

### Step 1: Install Dependencies (if not already done)
```bash
npm install --legacy-peer-deps
```

### Step 2: Get Google Maps API Key (iOS/Android only)

1. Visit [Google Cloud Console](https://console.cloud.google.com/)
2. Create/select a project
3. Enable "Maps SDK for iOS" and "Maps SDK for Android"
4. Create an API key in Credentials

### Step 3: Add API Key to app.json

Open `app.json` and replace `YOUR_GOOGLE_MAPS_API_KEY` in two places:

```json
"ios": {
  "config": {
    "googleMapsApiKey": "YOUR_KEY_HERE"
  }
},
"android": {
  "config": {
    "googleMaps": {
      "apiKey": "YOUR_KEY_HERE"
    }
  }
}
```

**Note**: Web version works without an API key!

### Step 4: Run the App

**Try Web First (no API key needed):**
```bash
npm run web
```

**Or run on mobile:**
```bash
npm start
# Then press 'w' for web, 'i' for iOS, or 'a' for Android
```

## 🎯 What You'll See

The app will display:
- A map centered on Homer Harbor, Alaska
- Color-coded depth contours showing water depths
- Individual depth soundings (numbers showing meters)
- Navigation aids (buoys and lights)
- Interactive controls to toggle layers

## 🎮 Controls

- **Depths Button**: Toggle depth sounding labels on/off
- **Nav Aids Button**: Toggle navigation aid markers on/off
- **Pinch/Zoom**: Zoom in and out on the map
- **Pan**: Drag to move around the chart

## 🗺️ Chart Details

- **Location**: Homer Spit, Alaska (59.635°N, 151.490°W)
- **Chart**: NOAA US5AK5SI - Homer Harbor
- **Format**: S-57 Electronic Navigational Chart (ENC)
- **Edition**: 1, Updated October 2024

## 📊 Depth Legend

- **Light Blue**: 0-5 meters (shallow water)
- **Medium Blue**: 5-10 meters
- **Deep Blue**: 10-20 meters
- **Dark Blue**: 20+ meters (deep water)

## 🐛 Troubleshooting

### "Unable to resolve module react-native-maps"
```bash
npm install --legacy-peer-deps
npm start --clear
```

### Map shows but no depth data
- The app is using mock data for demonstration
- Full S-57 parsing is a future enhancement
- The framework is in place to add real data parsing

### iOS: Map not showing
- Make sure you added the Google Maps API key to `app.json`
- Try running on web first to verify the app structure works

### Android: Build errors
- Make sure Android Studio is installed
- Verify you have an Android emulator set up
- Try: `npm run android` after emulator is running

## 📚 Next Steps

1. Explore `src/components/ChartViewer.tsx` - Main chart display
2. Check `src/utils/s57Parser.ts` - Data parsing logic
3. Read `CHART_CONFIG.md` - Detailed configuration guide
4. Add more charts to `assets/Maps/` directory

## 🎨 Customization Ideas

- Add more chart layers (anchorages, restricted areas)
- Implement route planning
- Add GPS tracking
- Display tide and current information
- Support multiple charts with chart selection
- Add AIS vessel tracking
- Implement distance measuring tools

## 📖 More Information

- Full README: `README.md`
- Chart Configuration: `CHART_CONFIG.md`
- S-57 Format: [IHO S-57 Standard](https://iho.int/en/s-57-edition-3-1)
- NOAA Charts: [nauticalcharts.noaa.gov](https://nauticalcharts.noaa.gov)

Enjoy exploring nautical charts! 🛥️⚓

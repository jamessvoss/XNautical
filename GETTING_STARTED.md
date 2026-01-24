# 🚢 MapTest - NOAA ENC Chart Viewer - Complete Setup Guide

Welcome! This guide will help you get your NOAA Electronic Navigational Chart viewer up and running.

## 📋 What You Have

Your project is now set up as a React Native app that displays nautical charts. Here's what's included:

### Core App
- ✅ React Native with Expo framework
- ✅ TypeScript for type safety
- ✅ Cross-platform support (iOS, Android, Web)
- ✅ Interactive map display
- ✅ Chart viewer component

### Chart Data
- ✅ NOAA ENC data for Homer Harbor, Alaska (US5AK5SI)
- ✅ S-57 format hydrographic data
- ✅ Chart located at: `assets/Maps/US5AK5SI_ENC_ROOT/`

### Features
- ✅ Depth contours with color coding
- ✅ Sounding markers (depth measurements)
- ✅ Navigation aids (buoys, lights)
- ✅ Interactive legend
- ✅ Layer toggle controls
- ✅ Satellite imagery overlay

## 🎯 Quick Start (5 Minutes)

### Option 1: Run on Web (Easiest - No Setup Required!)

```bash
npm run web
```

That's it! The app will open in your browser showing the Homer Harbor chart.

### Option 2: Run on iOS/Android (Requires API Key)

#### Step 1: Get Google Maps API Key

1. Visit https://console.cloud.google.com/
2. Create a new project (or select existing)
3. Enable these APIs:
   - "Maps SDK for iOS"
   - "Maps SDK for Android"
4. Go to "Credentials" → "Create Credentials" → "API Key"
5. Copy your API key

#### Step 2: Add API Key to Project

Open `app.json` and find these two sections:

```json
"ios": {
  "config": {
    "googleMapsApiKey": "YOUR_GOOGLE_MAPS_API_KEY"  ← Replace this
  }
},
"android": {
  "config": {
    "googleMaps": {
      "apiKey": "YOUR_GOOGLE_MAPS_API_KEY"  ← Replace this
    }
  }
}
```

#### Step 3: Run the App

```bash
# Start Expo dev server
npm start

# Then press:
# - 'i' for iOS simulator
# - 'a' for Android emulator
# - 'w' for web browser
```

Or run directly:
```bash
npm run ios        # iOS
npm run android    # Android
npm run web        # Web
```

## 🗺️ What You'll See

The app displays Homer Harbor near the Homer Spit in Alaska:

- **Location**: 59.635°N, 151.490°W
- **Chart Type**: Harbor/Approach Chart
- **Data Source**: NOAA US5AK5SI
- **Edition**: 1 (October 2024)

### Map Features

1. **Depth Contours** (colored lines):
   - Light Blue: Shallow water (0-5 meters)
   - Medium Blue: 5-10 meters
   - Deep Blue: 10-20 meters
   - Dark Blue: Deep water (20+ meters)

2. **Depth Numbers**: Individual soundings showing exact depths in meters

3. **Navigation Aids**:
   - Yellow pins: Lights
   - Green pins: Buoys

4. **Controls** (bottom of screen):
   - Toggle depth labels on/off
   - Toggle navigation aids on/off

## 📁 Project Structure

```
MapTest/
├── App.tsx                         ← App entry point
├── src/
│   ├── components/
│   │   └── ChartViewer.tsx         ← Main chart display
│   ├── types/
│   │   └── s57.ts                  ← Type definitions
│   └── utils/
│       ├── s57Parser.ts            ← Data parser
│       └── s57BinaryParser.ts      ← Future binary parser
├── assets/
│   └── Maps/
│       └── US5AK5SI_ENC_ROOT/      ← Chart data
│           └── US5AK5SI/
│               └── US5AK5SI.000    ← Binary chart file
└── [documentation files]
```

## 📚 Documentation

Your project includes comprehensive documentation:

1. **README.md** - Main project documentation
2. **QUICKSTART.md** - Quick start guide (you're reading a better version!)
3. **CHART_CONFIG.md** - Detailed chart configuration
4. **PROJECT_SUMMARY.md** - Technical overview and roadmap

## 🔧 Customization

### Change Map Type

In `src/components/ChartViewer.tsx`, find:
```typescript
mapType="satellite"
```

Options: `"standard"`, `"satellite"`, `"hybrid"`, `"terrain"`

### Adjust Initial View

Find `HOMER_HARBOR_CENTER` in `ChartViewer.tsx`:
```typescript
const HOMER_HARBOR_CENTER = {
  latitude: 59.6350,
  longitude: -151.4900,
  latitudeDelta: 0.05,    // Zoom level (smaller = more zoomed in)
  longitudeDelta: 0.05,
};
```

### Change Depth Colors

Find `DEPTH_COLORS` in `ChartViewer.tsx`:
```typescript
const DEPTH_COLORS = {
  shallow: '#B3E5FC',    // Change these hex colors
  medium: '#4FC3F7',
  deep: '#0288D1',
  veryDeep: '#01579B',
};
```

## 🚀 Next Steps

### Immediate Tasks
1. Get the app running on at least one platform
2. Explore the chart by zooming and panning
3. Toggle the layer controls to see different data

### Development Ideas
1. **Add More Charts**: Download more NOAA ENCs from nauticalcharts.noaa.gov
2. **Real Data**: Implement actual S-57 binary parsing (see `s57BinaryParser.ts`)
3. **GPS Tracking**: Add your current position on the map
4. **Route Planning**: Add waypoints and route lines
5. **Offline Mode**: Cache charts for offline use

### Learning Resources
- **S-57 Format**: https://iho.int/en/s-57-edition-3-1
- **NOAA Charts**: https://nauticalcharts.noaa.gov
- **React Native Maps**: https://github.com/react-native-maps/react-native-maps
- **Expo Docs**: https://docs.expo.dev

## 🐛 Troubleshooting

### "Cannot find module" errors
```bash
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
npm start --clear
```

### Map not showing on iOS/Android
- Verify you added the Google Maps API key to `app.json`
- Check the API key is valid and APIs are enabled
- Try running on web first to verify the app works

### "Unable to resolve react-native-maps"
```bash
npm install --legacy-peer-deps
```

### Expo dev tools not opening
```bash
npm start --clear
# Then manually open: http://localhost:8081
```

### TypeScript errors
```bash
npx tsc --noEmit
```
This checks for type errors without building.

## 💡 Tips

1. **Start with Web**: Web is easiest to test - no API key needed
2. **Mock Data**: Current app uses mock depth data for demonstration
3. **Learn by Doing**: Modify colors, positions, or text to see changes
4. **Check the Console**: Use `console.log()` to debug - output shows in terminal
5. **Hot Reload**: Save files and see changes instantly in the app

## 🎓 Understanding the Code

### Main Flow
1. `App.tsx` → Renders `ChartViewer` component
2. `ChartViewer.tsx` → Loads chart data and displays map
3. `s57Parser.ts` → Provides mock chart data (depth contours, soundings, etc.)
4. React Native Maps → Displays the interactive map

### Key Components
- **MapView**: The map itself
- **Polyline**: Draws depth contour lines
- **Marker**: Places pins for soundings and nav aids

### Data Flow
```
s57Parser.ts (mock data)
    ↓
ChartViewer.tsx (state management)
    ↓
MapView (rendering)
    ↓
User sees interactive chart
```

## 📞 Need Help?

1. Check the documentation files in the project
2. Review the inline code comments
3. Search for error messages online
4. Check React Native Maps GitHub issues
5. Review Expo documentation

## 🎉 Success!

If you can see a map with blue depth contours and markers, congratulations! You have a working NOAA chart viewer.

The foundation is built. Now you can:
- Add more features
- Load additional charts
- Implement real S-57 parsing
- Build navigation tools
- Share with others

Happy charting! ⚓🗺️

---

**Created**: January 24, 2026  
**Version**: 1.0.0  
**Next**: See PROJECT_SUMMARY.md for development roadmap

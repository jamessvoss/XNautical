# XNautical Architecture

## Overview

XNautical is a cross-platform React Native application for displaying NOAA Electronic Navigational Charts (ENC). The app uses a **platform-specific approach** to optimize for each target platform while maintaining consistent user experience.

## Architecture Decision

### Why Platform-Specific Libraries?

We use different mapping libraries for web vs native platforms:

- **Web Platform**: Leaflet + GeoJSON
- **Native Platforms (iOS/Android)**: Mapbox GL Native + MBTiles

This approach provides:
1. **Simplicity**: Each platform uses its best-suited technology
2. **True Offline**: No external servers or APIs needed (except optional satellite imagery)
3. **Performance**: Optimized data formats for each platform
4. **Maintainability**: Simpler codebases with fewer dependencies per platform

## Platform Implementations

### Web Platform

**Technology Stack:**
- `react-leaflet` - React bindings for Leaflet
- `leaflet` - Open-source web mapping library
- GeoJSON files - Chart data format

**Data Flow:**
```
S-57 ENC Data
    ↓ (ogr2ogr conversion)
GeoJSON Files (depare.json, depcnt.json, soundg.json, lndare.json)
    ↓ (bundled in assets/)
Leaflet Map Component
    ↓
Rendered in Browser
```

**File Locations:**
- Component: `src/components/ChartViewer.web.tsx`
- Data: `assets/Maps/*.geojson` (~600KB total)

**Advantages:**
- No tile server needed
- GeoJSON files small enough to bundle directly
- Works completely offline
- Simple to understand and maintain
- Easy to add new chart areas

### Native Platforms (iOS/Android)

**Technology Stack:**
- `@rnmapbox/maps` - React Native wrapper for Mapbox GL Native
- Mapbox GL Native - High-performance native mapping library
- MBTiles - Compressed vector tile format

**Data Flow:**
```
S-57 ENC Data
    ↓ (ogr2ogr conversion)
GeoJSON Files
    ↓ (tippecanoe conversion)
MBTiles File (homer_chart.mbtiles)
    ↓ (copied to device on first launch)
Mapbox Native Map Component
    ↓
Rendered on Device
```

**File Locations:**
- Component: `src/components/ChartViewer.native.tsx`
- Data: `assets/Maps/homer_chart.mbtiles` (~890KB)

**Advantages:**
- Efficient vector tile format
- High performance on mobile devices
- Single file for entire chart area
- Native rendering (smooth zooming/panning)

## Component Structure

### App.tsx (Main Entry Point)

```typescript
import ChartViewer from './src/components/ChartViewer';

// React Native automatically resolves to:
// - ChartViewer.web.tsx on web
// - ChartViewer.native.tsx on iOS/Android
```

### ChartViewer.web.tsx (Web Implementation)

**Key Features:**
- Loads GeoJSON files via `require()` (Metro bundles them)
- Uses Leaflet `<MapContainer>` for base map
- Renders layers using `<GeoJSON>` components
- ECDIS-style color coding for depth areas
- Layer toggles (depth areas, contours, soundings, land)
- Optional satellite overlay (requires internet)

**Layer Rendering:**
```typescript
<GeoJSON
  data={depareGeoJSON}
  style={(feature) => ({
    fillColor: getDepthColor(feature?.properties?.DRVAL2 || 0),
    fillOpacity: 0.6,
  })}
/>
```

### ChartViewer.native.tsx (Native Implementation)

**Key Features:**
- Copies MBTiles from bundle to device on first launch
- Uses Mapbox GL style specification
- Vector source references local MBTiles file
- Layer definitions match S-57 layer names
- Same visual style as web (ECDIS colors)
- Same layer toggles and controls

**Layer Rendering:**
```typescript
<Mapbox.FillLayer
  id="depth-areas"
  sourceID="homer-tiles"
  sourceLayerID="depare"
  style={{
    fillColor: [
      'step',
      ['get', 'DRVAL2'],
      '#A5D6FF', // 0-2m
      2, '#8ECCFF', // 2-5m
      // ...
    ],
  }}
/>
```

## Data Processing Pipeline

### Step 1: S-57 to GeoJSON

Use GDAL's `ogr2ogr` to extract layers from S-57 ENC data:

```bash
# Extract each layer separately
ogr2ogr -f GeoJSON depare.geojson US5AK5SI_ENC_ROOT/US5AK5SI/CATALOG.031 DEPARE
ogr2ogr -f GeoJSON depcnt.geojson US5AK5SI_ENC_ROOT/US5AK5SI/CATALOG.031 DEPCNT
ogr2ogr -f GeoJSON soundg.geojson US5AK5SI_ENC_ROOT/US5AK5SI/CATALOG.031 SOUNDG
ogr2ogr -f GeoJSON lndare.geojson US5AK5SI_ENC_ROOT/US5AK5SI/CATALOG.031 LNDARE
```

### Step 2: GeoJSON to MBTiles (Native Only)

Use `tippecanoe` to create vector tiles:

```bash
tippecanoe -o homer_chart.mbtiles \
  -Z10 -z16 \
  --layer=depare --layer=depcnt --layer=soundg --layer=lndare \
  --force \
  depare.geojson depcnt.geojson soundg.geojson lndare.geojson
```

## Offline Functionality

### Web Platform
- All GeoJSON files bundled with the app
- Metro bundler includes them in the JavaScript bundle
- No network requests for chart data
- Optional satellite overlay requires internet

### Native Platforms
- MBTiles file bundled with the app
- Copied to device documents directory on first launch
- Mapbox reads tiles from local file
- No network requests for chart data
- Optional satellite overlay requires internet

## Development Workflow

### Adding New Chart Areas

1. **Obtain S-57 ENC Data** from NOAA or other source
2. **Convert to GeoJSON** using ogr2ogr
3. **For Web**: Place GeoJSON files in `assets/Maps/`
4. **For Native**: Convert GeoJSON to MBTiles using tippecanoe
5. **Update Components**: Modify import statements and file references
6. **Update Center Coordinates**: Set appropriate lat/lng for new area

### Testing

```bash
# Test web
npm run web

# Test iOS
npm run ios

# Test Android  
npm run android
```

## Dependencies

### Core Dependencies
- `expo` - Development platform
- `react-native` - Cross-platform framework
- `typescript` - Type safety

### Web-Specific
- `leaflet` - Map library
- `react-leaflet` - React bindings
- `@types/leaflet` - TypeScript types

### Native-Specific
- `@rnmapbox/maps` - Mapbox wrapper
- `react-native-fs` - File system access
- `expo-file-system` - Expo file utilities

### Shared
- `expo-location` - GPS/positioning
- `expo-status-bar` - Status bar styling
- `react-dom` / `react-native-web` - Web platform support

## Configuration Files

### metro.config.js
- Adds `.geojson` to asset extensions
- Allows Metro to bundle GeoJSON files

### app.json
- Expo configuration
- Mapbox plugin setup for native platforms
- Platform-specific settings

### .env
- `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` - Public token for runtime
- `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` - Download token for builds

## Performance Considerations

### Web
- GeoJSON files: ~600KB total (acceptable for web bundle)
- Leaflet renders vectors on-demand (good performance)
- Filtering soundings (show every 5th) reduces clutter

### Native
- MBTiles: ~890KB (efficient single file)
- Vector tiles load only visible area (memory efficient)
- Native rendering (60fps smooth performance)

## Future Enhancements

Potential improvements:
1. Add more chart areas (multiple ENC cells)
2. Implement chart selection UI
3. Add route planning features
4. Integrate AIS (ship tracking) data
5. Add weather overlay layers
6. Implement chart updates mechanism

## Troubleshooting

### Web Platform Issues
- Clear browser cache if changes don't appear
- Restart Metro with `npm start -- --clear`
- Check browser console for JavaScript errors

### Native Platform Issues
- Clean build: `npx expo prebuild --clean`
- Verify Mapbox tokens in `.env`
- Check device storage for MBTiles file
- Review native logs in Xcode/Android Studio

## References

- [Leaflet Documentation](https://leafletjs.com/)
- [react-leaflet Documentation](https://react-leaflet.js.org/)
- [Mapbox GL Native Documentation](https://docs.mapbox.com/)
- [S-57 Standard (IHO)](https://iho.int/en/s-57-edition-3-1)
- [GDAL/OGR Documentation](https://gdal.org/)
- [Tippecanoe Documentation](https://github.com/felt/tippecanoe)

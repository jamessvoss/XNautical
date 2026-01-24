# Offline Vector Tile Chart Solution - Implementation Guide

## ✅ What We've Created

You now have a complete offline nautical chart solution using:

1. **Vector Tiles (MBTiles)**: `homer_chart.mbtiles` (913KB) - contains all S-57 data
2. **React Native Mapbox**: Professional mapping library with offline support
3. **Extracted Layers**:
   - `depare` - Depth areas (colored zones)
   - `depcnt` - Depth contours (lines)
   - `soundg` - Soundings (depth points)
   - `lndare` - Land areas

## 📁 File Structure

```
assets/Maps/
├── homer_chart.mbtiles          # Vector tiles (OFFLINE DATA)
├── depare.geojson              # Source: depth areas
├── depcnt.geojson              # Source: depth contours
├── soundg.geojson              # Source: soundings
└── lndare.geojson              # Source: land areas
```

## 🚀 How Offline Works

### For Mobile (iOS/Android):
1. **Bundle MBTiles with app** - Include in app assets
2. **Copy to device** - On first launch, copy to app's document directory
3. **Load offline** - Mapbox reads tiles directly from device storage
4. **No internet needed** - All chart data is local

### For Web:
- Use TileServer-GL or mbview to serve tiles locally
- Or convert to GeoJSON and render with Leaflet (current approach)

## 📱 React Native Mapbox Setup

### Android Configuration

Add to `android/build.gradle`:

```gradle
allprojects {
    repositories {
        maven {
            url 'https://api.mapbox.com/downloads/v2/releases/maven'
            authentication {
                basic(BasicAuthentication)
            }
            credentials {
                username = "mapbox"
                password = project.properties['MAPBOX_DOWNLOADS_TOKEN'] ?: ""
            }
        }
    }
}
```

### iOS Configuration

Add to `ios/Podfile`:

```ruby
pre_install do |installer|
  $RNMapboxMaps.pre_install(installer)
end

post_install do |installer|
  $RNMapboxMaps.post_install(installer)
end
```

## 🔑 Mapbox Access Token

You'll need a Mapbox access token (free tier available):

1. Sign up at https://mapbox.com
2. Get your access token
3. Add to your app configuration

**Note**: The token is only for base maps. Your nautical chart tiles work offline without a token!

## 💾 Offline Tile Loading

### Method 1: Bundle with App (Recommended for single chart)

```javascript
import Mapbox from '@rnmapbox/maps';
import RNFS from 'react-native-fs';

// Copy MBTiles to app directory on first launch
const setupOfflineChart = async () => {
  const source = RNFS.MainBundlePath + '/assets/Maps/homer_chart.mbtiles';
  const dest = RNFS.DocumentDirectoryPath + '/homer_chart.mbtiles';
  
  if (!(await RNFS.exists(dest))) {
    await RNFS.copyFile(source, dest);
  }
  
  return dest;
};

// Use in your map
<Mapbox.MapView>
  <Mapbox.VectorSource 
    id="homer-chart"
    url={`file://${tileFilePath}`}
  >
    {/* Layers here */}
  </Mapbox.VectorSource>
</Mapbox.MapView>
```

### Method 2: Pre-downloaded Tiles

For multiple charts or large datasets:
- Store MBTiles on device storage
- Load dynamically based on user's location
- Update charts without app updates

## 🎨 Styling Layers

### Depth Areas (DEPARE)

```javascript
<Mapbox.FillLayer
  id="depth-areas"
  sourceID="homer-chart"
  sourceLayerID="depare"
  style={{
    fillColor: [
      'step',
      ['get', 'DRVAL2'],
      '#A5D6FF', // 0-2m
      2, '#8ECCFF', // 2-5m
      5, '#6BB8E8', // 5-10m
      10, '#4A9FD8', // 10-20m
      20, '#B8D4E8'  // 20m+
    ],
    fillOpacity: 0.6,
  }}
/>
```

### Depth Contours (DEPCNT)

```javascript
<Mapbox.LineLayer
  id="depth-contours"
  sourceID="homer-chart"
  sourceLayerID="depcnt"
  style={{
    lineColor: [
      'step',
      ['get', 'VALDCO'],
      '#0066CC',
      5, '#0052A3',
      10, '#003D7A',
      20, '#002952'
    ],
    lineWidth: 2,
  }}
/>
```

### Soundings (SOUNDG)

```javascript
<Mapbox.SymbolLayer
  id="soundings"
  sourceID="homer-chart"
  sourceLayerID="soundg"
  style={{
    textField: ['get', 'DEPTH'],
    textSize: 10,
    textColor: '#0066CC',
    textHaloColor: '#FFFFFF',
    textHaloWidth: 1,
  }}
/>
```

### Land Areas (LNDARE)

```javascript
<Mapbox.FillLayer
  id="land"
  sourceID="homer-chart"
  sourceLayerID="lndare"
  style={{
    fillColor: '#E8D4A0',
    fillOpacity: 0.8,
  }}
/>
```

## 🔄 Adding More Charts

To add additional chart areas:

```bash
# 1. Convert S-57 to GeoJSON
ogr2ogr -f GeoJSON chart2_depare.geojson CHART2.000 DEPARE

# 2. Create vector tiles
tippecanoe -o chart2.mbtiles -Z10 -z16 \
  --layer=depare chart2_depare.geojson \
  --layer=depcnt chart2_depcnt.geojson

# 3. Load in app
<Mapbox.VectorSource id="chart2" url="file://chart2.mbtiles" />
```

## 📊 File Sizes

Estimated sizes for different coverage areas:

- **Single harbor** (like Homer): ~1MB
- **Coastal region** (50km): ~5-10MB
- **Large area** (200km): ~20-50MB
- **Entire US coastline**: ~500MB-1GB

## ⚡ Performance

Vector tiles are highly efficient:

- **Fast rendering**: GPU-accelerated
- **Smooth zoom**: Re-rendered at each zoom level
- **Small file size**: Compressed binary format
- **Selective loading**: Only loads visible tiles

## 🎯 Production Checklist

- [ ] Bundle MBTiles with app assets
- [ ] Implement first-launch tile copy
- [ ] Add Mapbox access token
- [ ] Style all chart layers
- [ ] Add layer toggle controls
- [ ] Test offline functionality
- [ ] Optimize tile zoom levels
- [ ] Add chart update mechanism
- [ ] Implement chart switching (if multiple charts)
- [ ] Add GPS location overlay

## 🆚 Comparison: This vs NOAA Viewer

| Feature | Your App | NOAA Viewer |
|---------|----------|-------------|
| Offline | ✅ Full | ❌ Requires internet |
| Data | Same S-57 | Same S-57 |
| Styling | Customizable | Fixed ECDIS style |
| Performance | Native (fast) | Web (slower) |
| Updates | Manual | Automatic |
| Platform | iOS/Android/Web | Web only |

## 📚 Resources

- **Tippecanoe**: https://github.com/felt/tippecanoe
- **React Native Mapbox**: https://rnmapbox.github.io/
- **MBTiles Spec**: https://github.com/mapbox/mbtiles-spec
- **Mapbox GL Style**: https://docs.mapbox.com/style-spec/

## 🔧 Troubleshooting

### Issue: Tiles don't load
- Check file path is correct
- Verify MBTiles file exists
- Check zoom levels (Z10-Z16)

### Issue: Layers not visible
- Check sourceLayerID matches tippecanoe layers
- Verify style expressions are correct
- Check zoom level visibility

### Issue: App size too large
- Reduce zoom levels (fewer tiles)
- Split into downloadable chart packs
- Use compression

---

**Next Steps**: I'll now create the React Native Mapbox component for you!

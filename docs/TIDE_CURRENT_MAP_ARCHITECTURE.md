# Tide and Current Station Map Display Architecture

This document explains the methodology used to display tide and current station locations on the map in the XNautical application.

## Overview

The system uses a **multi-layered architecture** combining Cloud Functions, local storage, and MapLibre GL rendering to display 1,515 station locations (578 tide + 937 current) efficiently with minimal storage (~50KB) and instant offline access.

## Architecture Overview

**Data Flow:**
1. User triggers "Refresh Tide Data" in Settings Screen
2. stationService.ts calls Cloud Function `getStationLocations()`
3. Cloud Function queries Firestore with field selection (name, lat, lng, type)
4. Returns ~50KB JSON to device
5. stationService persists to AsyncStorage and updates in-memory cache
6. On app launch, data loads from AsyncStorage → Memory → DynamicChartViewer
7. Map component creates GeoJSON and renders with MapLibre
8. Display shows blue circles (tide) and magenta circles (current)

## Component Breakdown

### 1. Data Fetching (Cloud Function)

**Location:** `functions/src/index.ts` - `getStationLocations()`

**Purpose:** Efficiently fetch all station metadata from Firestore in a single optimized call.

**Key Features:**
- Uses Firestore `.select('name', 'lat', 'lng', 'type')` to fetch **only metadata fields**
- Excludes massive `predictions` field (~200MB) to avoid memory errors
- Processes 578 tide + 937 current stations in parallel
- Returns compact ~50KB JSON response
- 512MB memory allocation prevents server-side OOM errors

**Code:**
```typescript
export const getStationLocations = functions
  .runWith({
    memory: '512MB',
    timeoutSeconds: 60,
  })
  .https.onCall(async (data, context) => {
    const [tideSnapshot, currentSnapshot] = await Promise.all([
      db.collection('tidal-stations')
        .select('name', 'lat', 'lng', 'type')
        .get(),
      db.collection('current-stations-packed')
        .select('name', 'lat', 'lng', 'bin')
        .get(),
    ]);
    
    // Extract and return only needed fields
    return { tideStations, currentStations, timestamp };
  });
```

### 2. Local Persistence (AsyncStorage)

**Location:** `src/services/stationService.ts`

**Purpose:** Persist station data on device for offline access and instant app startup.

**Storage Keys:**
- `@XNautical:tideStations` - 578 tide station locations
- `@XNautical:currentStations` - 937 current station locations
- `@XNautical:stationsTimestamp` - Download timestamp

**Storage Size:** ~50KB total (vs ~200MB if predictions were included)

**Lifecycle:**
1. **On Refresh:** Cloud Function → Parse JSON → Save to AsyncStorage
2. **On Startup:** Load from AsyncStorage → Hydrate memory cache
3. **On Clear:** Remove all three keys from storage

**Benefits:**
- Data persists across app restarts
- Instant loading (no network call needed)
- Works completely offline after first download
- Minimal storage footprint

### 3. Map Rendering (MapLibre GL JS)

**Location:** `src/components/DynamicChartViewer.native.tsx` lines 4839-4931

**Purpose:** Render station locations as interactive map features using MapLibre GL.

#### Tide Stations (Blue Circles)

```typescript
<MapLibre.ShapeSource
  id="tide-stations-source"
  shape={{
    type: 'FeatureCollection',
    features: tideStations.map(station => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [station.lng, station.lat]
      },
      properties: {
        id: station.id,
        name: station.name,
        type: station.type
      }
    }))
  }}
>
  {/* Circle markers visible at all zoom levels */}
  <MapLibre.CircleLayer
    id="tide-stations-circle"
    style={{
      circleRadius: 8,
      circleColor: '#0066CC',      // Ocean blue
      circleStrokeWidth: 2,
      circleStrokeColor: '#FFFFFF',
      circleOpacity: 0.9
    }}
  />
  
  {/* Labels visible only at zoom 10+ */}
  <MapLibre.SymbolLayer
    id="tide-stations-label"
    minZoomLevel={10}
    style={{
      textField: ['get', 'name'],
      textFont: ['Noto Sans Regular'],
      textSize: 11,
      textColor: '#0066CC',
      textHaloColor: '#FFFFFF',
      textHaloWidth: 2,
      textOffset: [0, 1.5],
      textAnchor: 'top'
    }}
  />
</MapLibre.ShapeSource>
```

#### Current Stations (Magenta Circles)

Same structure as tide stations but with:
- Color: `#CC0066` (Magenta/pink)
- Distinct from all other chart features
- 8px radius circles with white stroke

### MapLibre Layer Structure

**Three-layer approach per station type:**

1. **ShapeSource** - GeoJSON data source containing all station points
   - Type: FeatureCollection
   - Geometry: Point (lat/lng coordinates)
   - Properties: id, name, type/bin

2. **CircleLayer** - Renders the colored circles
   - Visible at all zoom levels
   - 8px radius with 2px white stroke
   - 90% opacity for slight transparency

3. **SymbolLayer** - Renders station names
   - Only visible at zoom ≥10 (prevents clutter)
   - White text halo for readability on any background
   - Positioned above the circle

## Data Flow Sequence

**First Time Setup:**
1. User presses "Refresh Tide Data" in Settings Screen
2. Settings calls stationService.clearCache() + fetch()
3. stationService invokes Cloud Function getStationLocations()
4. Cloud Function returns 578 tide + 937 current stations
5. stationService saves to AsyncStorage (~50KB) and caches in memory
6. User navigates to Map Component
7. Map calls fetchTideStations() → returns cached data
8. Map creates GeoJSON + MapLibre Layers
9. MapLibre displays circles to user

**Subsequent App Launch:**
1. Map Component calls fetchTideStations()
2. stationService loads from AsyncStorage
3. AsyncStorage returns persisted data to stationService
4. stationService returns data to Map
5. Map creates GeoJSON + MapLibre Layers
6. MapLibre displays circles instantly (no network call)

## User Interaction

### Visibility Controls

**Quick Toggle Buttons:**
- **TID** - Toggle tide stations on/off
- **CUR** - Toggle current stations on/off

**State Management:**
- `showTideStations` - Boolean controlling tide layer visibility
- `showCurrentStations` - Boolean controlling current layer visibility

**Conditional Rendering:**
```typescript
{showTideStations && tideStations.length > 0 && (
  <MapLibre.ShapeSource>...</MapLibre.ShapeSource>
)}
```

### Refresh Workflow

1. User navigates to Settings
2. Scrolls to "Tides & Currents" section
3. Presses "Refresh Tide Data" button
4. Cloud Function fetches latest data
5. Data saved to AsyncStorage with timestamp
6. Console logs verify storage:
   ```
   === STORAGE VERIFICATION ===
   Tide Stations in storage: 578 stations
   Current Stations in storage: 937 stations
   Saved at: 2026-02-02T...
   Total size: 50.3 KB
   ===========================
   ```
7. User returns to map → stations appear within seconds

## Visual Design

### Tide Stations (Blue)
- **Color:** `#0066CC` (Ocean blue)
- **Purpose:** Marks locations with high/low tide predictions
- **Size:** 8px circles with 2px white border
- **Labels:** Visible at zoom 10+
- **Rationale:** Blue color intuitively represents water/tides

### Current Stations (Magenta)
- **Color:** `#CC0066` (Magenta/pink)
- **Purpose:** Marks locations with flood/ebb/slack current predictions
- **Size:** 8px circles with 2px white border
- **Labels:** Visible at zoom 10+
- **Rationale:** Magenta is distinct from all other chart features (depth areas, land, hazards)

### Design Principles
- **High Contrast:** White stroke ensures visibility on any background
- **Distinct Colors:** Blue vs magenta prevents confusion between types
- **Zoom-based Labels:** Names only show at zoom 10+ to prevent clutter
- **Consistent Sizing:** 8px circles are large enough to tap but not overwhelming

## Performance Optimizations

### 1. Single Cloud Function Call
- Both tide and current stations fetched together
- Eliminates need for 1,515+ individual Firestore reads
- Reduces network overhead and Firebase costs

### 2. Field Selection
- Only 4-5 fields per document: id, name, lat, lng, type/bin
- Excludes massive `predictions` field (~200MB total)
- Reduces response size from ~200MB to ~50KB (4000x reduction)

### 3. Offline-First Architecture
- Data loads from AsyncStorage instantly
- No network call required after initial download
- Works completely offline
- Improves perceived performance

### 4. No Polling
- Loads once on startup
- Updates only when user explicitly refreshes
- Eliminates unnecessary CPU/battery usage
- Reduces background network activity

### 5. MapLibre Native Rendering
- GeoJSON is native to MapLibre GL
- Hardware-accelerated rendering
- Efficiently handles 1,500 points
- No custom rendering code needed

## Technical Details

### Data Structures

**TideStation Interface:**
```typescript
interface TideStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: 'R' | 'S';  // Reference or Subordinate
  predictions?: Record<string, TideEvent[]>;  // Not loaded for map display
}
```

**CurrentStation Interface:**
```typescript
interface CurrentStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  bin: number;
  predictions?: Record<string, CurrentEvent[]>;  // Not loaded for map display
}
```

### GeoJSON Format

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [-151.23, 59.45]
      },
      "properties": {
        "id": "9455920",
        "name": "Homer Spit",
        "type": "R"
      }
    }
  ]
}
```

### Memory Management

**In-Memory Cache:**
- `cachedTideStations: TideStation[] | null`
- `cachedCurrentStations: CurrentStation[] | null`
- Populated on first fetch/load
- Cleared only when user explicitly refreshes

**Shared Cache Strategy:**
- Single `fetchAllStations()` internal function
- Both `fetchTideStations()` and `fetchCurrentStations()` use same data
- Prevents duplicate Cloud Function calls
- Ensures consistency between tide and current data

## Future Enhancements

### Potential Improvements

1. **On-Demand Predictions**
   - Tap station marker → fetch predictions for that specific station
   - Show tide graph or current predictions in popup
   - Only load predictions when user needs them

2. **Clustering**
   - Group nearby stations at low zoom levels
   - Expand to individual markers at high zoom
   - Improves performance in dense areas

3. **Station Types**
   - Different icons for Reference vs Subordinate stations
   - Visual indication of data quality/reliability

4. **Status Indicators**
   - Show if station has active predictions
   - Indicate data age or staleness
   - Warning if predictions are outdated

5. **Filtering**
   - Show only stations with specific characteristics
   - Filter by name/location
   - Show only nearby stations

## Related Documentation

- **Storage Details:** `TIDE_CURRENT_STORAGE.md`
- **Cloud Functions:** `functions/src/index.ts`
- **Station Service:** `src/services/stationService.ts`
- **Map Component:** `src/components/DynamicChartViewer.native.tsx`

## Troubleshooting

### Stations Not Appearing

1. **Check storage:** Press "Refresh Tide Data" in Settings
2. **Verify logs:** Look for "Loaded X tide stations and Y current stations from storage"
3. **Check toggles:** Ensure TID/CUR buttons are highlighted (active)
4. **Zoom level:** Station names only appear at zoom 10+, but circles should always be visible

### Performance Issues

1. **First load slow:** Normal - Cloud Function fetches 1,515 stations
2. **Subsequent loads instant:** Data loads from AsyncStorage
3. **Map lag:** Unlikely with only 1,515 points - check other layers

### Storage Verification

Run in Settings screen after refresh to verify storage:
```
=== STORAGE VERIFICATION ===
Tide Stations in storage: 578 stations
Current Stations in storage: 937 stations
Saved at: 2026-02-02T08:26:15.000Z
Total size: 50.3 KB
===========================
```

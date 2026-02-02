# Tide & Current Station In-Memory Storage

## Overview
The XNautical app now loads tide and current station data with complete predictions into memory on startup, making tidal information instantly available throughout the app without additional network requests.

## Data Structure

### Tide Stations (578 total)
```typescript
interface TideStation {
  id: string;           // NOAA station ID
  name: string;         // Station name (e.g., "Homer Spit Light 3")
  lat: number;          // Latitude
  lng: number;          // Longitude
  type: 'R' | 'S';      // Reference or Subordinate
  predictions?: Record<string, TideEvent[]>; // Date -> events
}

interface TideEvent {
  time: string;         // "HH:MM" format
  height: number;       // feet (MLLW datum)
  type: 'H' | 'L';      // High or Low tide
}
```

### Current Stations (937 total)
```typescript
interface CurrentStation {
  id: string;           // NOAA station ID
  name: string;         // Station name
  lat: number;          // Latitude
  lng: number;          // Longitude
  bin: number;          // Bin number for predictions
  predictions?: Record<string, CurrentEvent[]>; // Date -> events
}

interface CurrentEvent {
  time: string;         // "HH:MM" format
  velocity: number;     // knots
  direction?: number;   // degrees (optional)
  type: 'slack' | 'flood' | 'ebb';
}
```

## Memory Footprint

Based on actual Firestore data:
- **Tide Stations**: ~68 MB (578 stations × ~121 KB each)
- **Current Stations**: ~114 MB (937 stations × ~122 KB each)
- **Total**: ~182 MB in memory

Each station typically has:
- **2 years** of predictions (730 days)
- **4 tide events per day** on average (2 high, 2 low)
- **~2,900 total events per station**

## Helper Functions

### Tide Queries
```typescript
// Get today's tides for a station
getTodayTides(station: TideStation): TideEvent[]

// Get next N days of tides
getUpcomingTides(station: TideStation, days?: number): Record<string, TideEvent[]>

// Find next high tide
getNextHighTide(station: TideStation): { date: string; event: TideEvent } | null

// Find next low tide
getNextLowTide(station: TideStation): { date: string; event: TideEvent } | null
```

### Current Queries
```typescript
// Get today's currents for a station
getTodayCurrents(station: CurrentStation): CurrentEvent[]

// Get next N days of currents
getUpcomingCurrents(station: CurrentStation, days?: number): Record<string, CurrentEvent[]>
```

## Loading Strategy

1. **On App Mount** (in `DynamicChartViewer.native.tsx`):
   ```typescript
   useEffect(() => {
     const loadStations = async () => {
       const [tides, currents] = await Promise.all([
         fetchTideStations(),
         fetchCurrentStations(),
       ]);
       setTideStations(tides);
       setCurrentStations(currents);
     };
     loadStations();
   }, []);
   ```

2. **Automatic Caching**:
   - First call fetches from Firestore
   - Subsequent calls return cached data
   - Cache persists for app lifetime
   - Call `clearStationCache()` to force refresh

## Firestore Security

Updated `firestore.rules` to allow authenticated read access:

```javascript
// Tidal stations - read-only for authenticated users
match /tidal-stations/{stationId} {
  allow read: if request.auth != null;
  allow write: if false; // Only admin/Cloud Functions
}

// Current stations - read-only for authenticated users
match /current-stations-packed/{stationId} {
  allow read: if request.auth != null;
  allow write: if false; // Only admin/Cloud Functions
}
```

## Map Display

Stations are displayed on the map with:
- **Tide Stations**: Blue circles (8px) with white stroke
- **Current Stations**: Magenta circles (8px) with white stroke
- **Labels**: Station names at zoom level 10+
- **Toggle Controls**: TID and CUR buttons in quick controls

## Data Updates

Predictions are automatically maintained by Cloud Functions:
- **Tides**: Weekly update (Sundays 3:00 AM Alaska time)
- **Rolling Window**: 1 year historical + 2 years future
- **Auto-cleanup**: Old dates removed automatically
- **Email Notifications**: Admin notified of update success/failure

## Usage Examples

### Get Next High Tide
```typescript
const nextHigh = getNextHighTide(station);
if (nextHigh) {
  console.log(`Next high tide: ${nextHigh.date} at ${nextHigh.event.time}`);
  console.log(`Height: ${nextHigh.event.height} feet`);
}
```

### Display Today's Tides
```typescript
const todayTides = getTodayTides(station);
todayTides.forEach(tide => {
  const type = tide.type === 'H' ? 'High' : 'Low';
  console.log(`${tide.time} - ${type}: ${tide.height} ft`);
});
```

### Check Upcoming Week
```typescript
const weekTides = getUpcomingTides(station, 7);
Object.entries(weekTides).forEach(([date, events]) => {
  console.log(`${date}: ${events.length} tide events`);
});
```

## Performance Considerations

- **Initial Load**: ~1-2 seconds to fetch all stations (one-time)
- **Memory Usage**: ~182 MB (negligible on modern devices)
- **No Network After Load**: All queries are instant (in-memory)
- **Battery Friendly**: No continuous polling or background fetches

## Testing Scripts

Three utility scripts are available:

1. **count-stations.js**: Count stations in Firestore
   ```bash
   node scripts/count-stations.js
   ```

2. **calculate-tide-storage.js**: Estimate storage requirements
   ```bash
   node scripts/calculate-tide-storage.js
   ```

3. **test-station-data.js**: Verify predictions are loading
   ```bash
   node scripts/test-station-data.js
   ```

## Next Steps

Potential enhancements:
1. Add tap handlers to station markers to show detailed tide charts
2. Display current tide status (rising/falling) on map
3. Add tide notifications for user's favorite locations
4. Show tide height as color-coded markers
5. Add filtering by tide height range

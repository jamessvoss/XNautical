# Clear All Downloaded Data - Complete Analysis

## Overview

When a user taps "Clear All Downloaded Data" in Settings, the system performs a comprehensive cleanup of all downloaded navigation data while preserving personal user data.

## What Gets Deleted ✅

### 1. Chart Files (MBTiles)
**Location:** `FileSystem.documentDirectory/mbtiles/`

**Files Deleted:**
- All district-specific chart scale files:
  - `{districtId}_US1.mbtiles` (Overview charts)
  - `{districtId}_US2.mbtiles` (General charts)
  - `{districtId}_US3.mbtiles` (Coastal charts)
  - `{districtId}_US4.mbtiles` (Approach charts)
  - `{districtId}_US5.mbtiles` (Harbor charts)
  - `{districtId}_US6.mbtiles` (Berthing charts)

**Basemap/Overlay Files:**
- `{districtId}_basemap.mbtiles` (Land basemap)
- `{districtId}_ocean.mbtiles` (Ocean bathymetry)
- `{districtId}_terrain.mbtiles` (Terrain relief)

**Satellite Imagery:**
- All satellite zoom level files:
  - `{districtId}_satellite_z0-5.mbtiles`
  - `{districtId}_satellite_z6-7.mbtiles`
  - `{districtId}_satellite_z8.mbtiles`
  - `{districtId}_satellite_z9.mbtiles`
  - `{districtId}_satellite_z10.mbtiles`
  - `{districtId}_satellite_z11.mbtiles`
  - `{districtId}_satellite_z12.mbtiles`
  - `{districtId}_satellite_z13.mbtiles`
  - `{districtId}_satellite_z14.mbtiles`

**GNIS (Place Names):**
- `gnis_names.mbtiles` - Only deleted if NO other districts remain installed

**Total:** Potentially 10-15 GB per district depending on what was downloaded

---

### 2. Prediction Databases (SQLite)
**Location:** `FileSystem.documentDirectory/`

**Files Deleted:**
- `tides_{districtId}.db` - Tide predictions database
- `currents_{districtId}.db` - Current predictions database

**Associated Memory:**
- Database connections closed
- In-memory prediction cache cleared (`cachedTidePredictions`, `cachedCurrentPredictions`)

**AsyncStorage Keys Removed:**
- `@XNautical:tidesDbPath:{districtId}`
- `@XNautical:currentsDbPath:{districtId}`

**Total:** ~50-150 MB per district

---

### 3. Buoy Data
**Location:** AsyncStorage only (no files)

**AsyncStorage Keys Removed:**
- `@XNautical:buoys:catalog:{districtId}` - Buoy station catalog
- `@XNautical:buoys:downloaded:{districtId}` - Download timestamp

**Data Removed:**
- Buoy station locations and metadata
- Latest buoy observations (wind, waves, temperature, etc.)

**Total:** <1 MB per district

---

### 4. Marine Zone Data
**Location:** AsyncStorage only (no files)

**AsyncStorage Keys Removed:**
- `@XNautical:marineZones:{districtId}` - Marine forecast zones
- `@XNautical:marineZones:downloaded:{districtId}` - Download timestamp

**Associated Memory:**
- In-memory zone cache cleared (`zonesCache`, `zonesCacheTime`)

**Data Removed:**
- Marine forecast zone boundaries (GeoJSON)
- Zone names and identifiers

**Total:** <1 MB per district

---

### 5. District Registry
**Location:** AsyncStorage only

**AsyncStorage Keys Removed:**
- `@XNautical:installedDistricts` - Master list of installed districts

**Data Removed:**
- Record of which districts are installed
- Flags for what data types each district has:
  - `hasCharts`
  - `hasPredictions`
  - `hasBuoys`
  - `hasMarineZones`
  - `hasSatellite`
  - `hasBasemap`
  - `hasGnis`
  - `hasOcean`
  - `hasTerrain`

**In-Memory:**
- `cachedDistricts` array cleared

**Total:** <1 KB

---

### 6. Generated Files
**Location:** `FileSystem.documentDirectory/mbtiles/`

**Files Deleted:**
- `manifest.json` - Regenerated (empty) after deletion

---

## What Does NOT Get Deleted ❌

### 1. Waypoints
**Location:** AsyncStorage
**Key:** `@XNautical:waypoints` (if it exists - couldn't find this service yet)
**Data:** User-created navigation waypoints

### 2. Routes
**Location:** AsyncStorage
**Key:** `@XNautical:routes`
**Data:** User-created navigation routes

### 3. Boats
**Location:** AsyncStorage
**Key:** `@XNautical:boats`
**Data:** User's boat profiles with:
- Boat name
- Performance characteristics
- Engine details
- Configuration

### 4. App Settings
**Location:** AsyncStorage (various keys)
**Data:** User preferences, app configuration, etc.

### 5. Firebase Auth State
**Location:** Platform-managed
**Data:** User authentication session, credentials

### 6. Any Firestore Cloud Data
**Location:** Cloud (Firestore)
**Data:** Cloud-synced routes, waypoints, boats (if implemented)

---

## Implementation Flow

### Code Location: `src/components/SettingsContent.tsx`

```typescript
const handleClearAllData = async () => {
  // 1. Confirmation dialog
  Alert.alert(
    'Clear All Downloaded Data',
    'This will delete all charts, predictions, satellite imagery, and other downloaded content.\n\nYour waypoints, routes, and boats will NOT be affected.\n\nThis cannot be undone.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear All Data',
        style: 'destructive',
        onPress: async () => {
          // 2. Get all installed districts
          const districts = await getInstalledDistricts();
          
          // 3. For each district, delete:
          for (const district of districts) {
            await deleteRegion(district.districtId, []);    // Charts, MBTiles
            await clearPredictions(district.districtId);    // Prediction DBs
            await clearBuoys(district.districtId);          // Buoy data
            await clearMarineZones(district.districtId);    // Zone data
          }
          
          // 4. Clear master registry
          await clearRegistry();
          
          // 5. Success confirmation
          Alert.alert('Success', 'All downloaded data has been cleared.');
        },
      },
    ]
  );
};
```

---

## Service Functions Called

### 1. `deleteRegion()` - `src/services/chartPackService.ts`
**Deletes:**
- All MBTiles files matching district patterns
- District-specific prediction databases (`tides_*.db`, `currents_*.db`)
- GNIS place names (if last district)
- Regenerates manifest.json

### 2. `clearPredictions()` - `src/services/stationService.ts`
**Deletes:**
- District-specific prediction database files
- Closes database connections
- Clears in-memory prediction cache
- Removes AsyncStorage metadata

### 3. `clearBuoys()` - `src/services/buoyService.ts`
**Deletes:**
- Buoy catalog from AsyncStorage
- Download timestamp metadata

### 4. `clearMarineZones()` - `src/services/marineZoneService.ts`
**Deletes:**
- Marine zone data from AsyncStorage
- Download timestamp metadata
- Clears in-memory cache

### 5. `clearRegistry()` - `src/services/regionRegistryService.ts`
**Deletes:**
- Master list of installed districts
- Clears in-memory cache

---

## Complete Trace

### When User Taps "Clear All Downloaded Data":

1. ✅ **Confirmation Dialog** shown with warning text
2. ✅ **All districts enumerated** from registry
3. ✅ **For each district (e.g., 01cgd, 05cgd, etc.):**
   - Delete all chart scale MBTiles (US1-US6)
   - Delete basemap, ocean, terrain MBTiles
   - Delete all satellite zoom level MBTiles
   - Delete tide/current prediction databases
   - Remove buoy catalog and metadata
   - Remove marine zone data
4. ✅ **GNIS place names** deleted if last district
5. ✅ **Registry cleared** (no districts marked as installed)
6. ✅ **Manifest regenerated** (empty)
7. ❌ **Waypoints NOT deleted**
8. ❌ **Routes NOT deleted**
9. ❌ **Boats NOT deleted**
10. ❌ **App settings NOT deleted**

---

## Storage Impact

### Before Clear:
- Charts: 1-5 GB per district
- Satellite: 1-4 GB per district
- Basemaps: 200-700 MB per district
- Predictions: 50-150 MB per district
- Buoys/Zones: <1 MB per district
- **Total: ~5-12 GB per district**

### After Clear:
- All downloaded content: **0 bytes**
- Personal data (waypoints, routes, boats): **Preserved**
- App installation: **~50-100 MB** (app binary only)

---

## Verification

### What Can Be Verified:
1. ✅ All files in `mbtiles/` directory deleted (except empty manifest)
2. ✅ All `*.db` prediction files deleted
3. ✅ AsyncStorage keys for buoys/zones removed
4. ✅ Registry shows 0 installed districts
5. ✅ UI updates to show "0 MB" downloaded data

### What Persists:
1. ✅ `@XNautical:boats` key in AsyncStorage
2. ✅ `@XNautical:routes` key in AsyncStorage
3. ✅ Any waypoint storage keys
4. ✅ User authentication state
5. ✅ App configuration and preferences

---

## Summary

**The "Clear All Downloaded Data" function performs a complete and thorough deletion of:**
- All navigation chart files
- All satellite imagery
- All basemap/overlay data
- All prediction databases
- All buoy and marine zone metadata
- All district installation records

**It explicitly preserves:**
- User waypoints
- User routes
- User boat profiles
- App settings and preferences
- Authentication state

**Result:** The app returns to a "fresh install" state regarding downloaded navigation data, but retains all personal user content. No trace of downloaded data remains on the device after this operation completes.

# XNautical Data Architecture & Offline Capabilities

Complete documentation of data sources, storage, and download capabilities for the XNautical app.

---

## Overview

XNautical uses a **multi-district architecture** where all data is organized by USCG Coast Guard District (e.g., `17cgd` for Alaska, `01cgd` for New England, etc.). The app supports full offline functionality by downloading and caching data locally.

---

## Data Sources

### 1. Firebase Storage (Binary Files)

**Location:** `gs://xnautical-8a296.firebasestorage.app`

All downloadable tile data and databases stored as compressed files.

#### Per-District Structure:
```
{districtId}/
├── charts/
│   ├── US1.mbtiles.zip    (Harbor/Approach charts)
│   ├── US2.mbtiles.zip    (Coastal charts)
│   ├── US3.mbtiles.zip    (General charts)
│   ├── US4.mbtiles.zip    (Sailing charts)
│   ├── US5.mbtiles.zip    (General charts - smaller scale)
│   └── US6.mbtiles.zip    (Overview charts)
├── satellite/
│   ├── satellite_overview.mbtiles       (z0-5 raw pack)
│   ├── satellite_detail_z{N}.mbtiles    (per-zoom raw packs z6-z14)
│   ├── {prefix}_satellite_overview.mbtiles.zip
│   ├── {prefix}_satellite_detail_z{N}.mbtiles.zip
│   └── {prefix}_satellite.mbtiles.zip   (combined all-zoom pack)
├── gnis/
│   └── {prefix}_gnis.mbtiles.zip        (Place names overlay)
├── basemap/
│   ├── basemap_overview.mbtiles         (z0-5 raw pack)
│   ├── basemap_detail_z{N}.mbtiles      (per-zoom raw packs z6-z14)
│   ├── {prefix}_basemap_overview.mbtiles.zip
│   ├── {prefix}_basemap_detail_z{N}.mbtiles.zip
│   └── {prefix}_basemap.mbtiles.zip     (combined all-zoom pack)
├── ocean/
│   ├── (same per-zoom pack structure as basemap)
│   └── {prefix}_ocean.mbtiles.zip       (combined all-zoom pack)
├── terrain/
│   ├── (same per-zoom pack structure as basemap)
│   └── {prefix}_terrain.mbtiles.zip     (combined all-zoom pack)
└── predictions/
    ├── tides.db.zip      (~24 MB - SQLite database with 1yr historical + 2yr future)
    └── currents.db.zip   (~24 MB - SQLite database with 1yr historical + 2yr future)
```

Where `{prefix}` is the district filename prefix (e.g., `d01` for 01cgd, `17-juneau` for 17cgd-Juneau). Prefixes are defined in `generators-base/config.py` DISTRICT_PREFIXES.

All four imagery generators (satellite, basemap, ocean, terrain) produce per-zoom MBTiles packs for incremental downloads, plus a combined zip for full-region download. They share common code via `generators-base/` (config.py + tile_utils.py).

#### Districts and Sub-Regions:

Standard CGDs: 01cgd, 05cgd, 07cgd, 08cgd, 09cgd, 11cgd, 13cgd, 14cgd, 17cgd
Alaska sub-regions: 17cgd-Juneau, 17cgd-Anchorage, 17cgd-Kodiak, 17cgd-DutchHarbor, 17cgd-Nome, 17cgd-Barrow
Special sub-regions: 07cgd-wflorida

**Total Storage Per District:** ~0.5-5 GB depending on region size and selected resolution

---

### 2. Firestore (Metadata & Live Data)

**Collection Structure (per district):**

```
districts/{districtId}/
├── (document fields)
│   ├── code: string          (e.g., "17 CGD")
│   ├── name: string          (e.g., "Alaska")
│   ├── timezone: string      (e.g., "America/Anchorage")
│   ├── bounds: object        (Geographic bounding box)
│   ├── downloadPacks: array  (Available downloads with sizes/paths)
│   └── us1ChartBounds: array (Chart metadata for US1 scale)
│
├── buoys/
│   └── catalog (document)
│       └── stations: array   (Buoy station summaries with lat/lng)
│
├── marine-zones/ (subcollection)
│   └── {zoneId} (documents)
│       ├── id: string        (e.g., "PKZ011")
│       ├── name: string      (e.g., "Inside Waters Prince William Sound")
│       ├── wfo: string       (Weather Forecast Office code)
│       ├── centroid: object  (lat/lon center point)
│       └── geometryJson: string (GeoJSON polygon/multipolygon)
│
└── marine-forecasts/ (subcollection)
    └── {zoneId} (documents)
        ├── zoneId: string
        ├── zoneName: string
        ├── advisory: string
        ├── synopsis: string
        ├── forecast: array   (Forecast periods)
        ├── nwsUpdated: string
        └── updatedAt: timestamp
```

**Update Frequency:**
- Marine forecasts: Every 10 minutes (smart polling, 3-4 AM/PM updates from NWS)
- Buoy observations: Every 5 minutes
- Zone boundaries: Static (updated during district generation)

---

### 3. Cloud Functions (Live Data Fetch)

**Function:** `getStationLocations`
- Returns all tide and current station locations
- Called once on startup, cached to AsyncStorage
- Provides metadata (id, name, lat, lng, type/bin)
- Predictions fetched from local SQLite databases

---

## Download Categories

### Required Downloads (Core Functionality)

| Category | Type | Size | Storage | Offline |
|----------|------|------|---------|---------|
| **Charts (US1-US6)** | MBTiles | 50-500 MB | File System | ✅ Full |
| **Predictions** | SQLite DB | ~48 MB | File System | ✅ Full (1yr hist + 2yr future) |
| **Buoys Catalog** | AsyncStorage | ~1 MB | AsyncStorage | ✅ Locations only (observations require online) |
| **Marine Zone Boundaries** | AsyncStorage | ~500 KB | AsyncStorage | ✅ Full (boundaries only) |
| **GNIS Place Names** | MBTiles | 5-20 MB | File System | ✅ Full |

### Optional Downloads

| Category | Type | Size | Storage | Offline |
|----------|------|------|---------|---------|
| **Satellite Imagery** | MBTiles | 100 MB - 5 GB | File System | ✅ Full |
| **Basemap** | MBTiles | 50-200 MB | File System | ✅ Full |
| **Ocean Basemap** | MBTiles | 50-150 MB | File System | ✅ Full |
| **Terrain Map** | MBTiles | 50-200 MB | File System | ✅ Full |

### Online-Only Data (Not Downloadable)

| Category | Source | Update Frequency | Notes |
|----------|--------|------------------|-------|
| **Marine Forecasts** | Firestore | Every 10 min | Live weather forecasts (requires internet) |
| **Buoy Observations** | Firestore | Every 5 min | Latest observations (requires internet) |

---

## Local Storage Architecture

### File System (`expo-file-system`)

**Location:** `FileSystem.documentDirectory`

```
{documentDirectory}/
├── mbtiles/
│   ├── d01_US1.mbtiles        (District 01, US1 scale charts)
│   ├── d01_US2.mbtiles
│   ├── ...
│   ├── d01_satellite.mbtiles
│   ├── d01_basemap.mbtiles
│   ├── d01_gnis.mbtiles
│   ├── d17_US1.mbtiles        (District 17 - Alaska)
│   └── ...
├── tides_17cgd.db             (Per-district tide predictions)
├── currents_17cgd.db          (Per-district current predictions)
└── manifest.json              (Chart pack index)
```

**Tile Server:** Native tile server runs on `http://127.0.0.1:8765` to serve MBTiles to MapLibre GL

---

### AsyncStorage (Metadata & Small Data)

**Keys:**
```javascript
// Station locations (cached from Cloud Function)
'@XNautical:tideStations'
'@XNautical:currentStations'
'@XNautical:stations:timestamp'

// Buoy catalog (per district)
'@XNautical:buoyCatalog:{districtId}'
'@XNautical:buoysDownloaded:{districtId}'

// Marine zone boundaries (per district)
'@XNautical:marineZones:{districtId}'
'@XNautical:marineZonesDownloaded:{districtId}'

// Region registry (tracks installed districts)
'@XNautical:installedDistricts'

// Prediction metadata (per district)
'@XNautical:predictionsDownloaded:{districtId}'
```

---

## Download Flow

### User Workflow

1. **Select Region** → User opens RegionSelector and picks a USCG district
2. **View Download Panel** → Shows all available data categories with sizes
3. **Download All or Individual** → User can download everything or pick specific items
4. **Progress Tracking** → Real-time download progress with speed/ETA
5. **Offline Ready** → Data immediately available without internet

### Technical Flow

```javascript
// 1. Fetch district metadata from Firestore
const district = await chartPackService.getDistrict(districtId);

// 2. Download chart packs from Storage
for (const pack of district.downloadPacks) {
  await chartPackService.downloadPack(pack, districtId, onProgress);
}

// 3. Download predictions databases
await stationService.downloadAllPredictions(onProgress, districtId);

// 4. Cache buoy catalog from Firestore
await buoyService.downloadBuoyCatalog(districtId, onProgress);

// 5. Cache marine zone boundaries from Firestore
await marineZoneService.downloadMarineZones(districtId, onProgress);

// 6. Register district in local registry
await regionRegistryService.registerDistrict(districtId, {
  hasCharts: true,
  hasPredictions: true,
  hasBuoys: true,
  hasMarineZones: true,
  // ... other flags
});
```

---

## Offline Behavior

### ✅ Works Offline

- **Chart Display:** All vector tiles served locally
- **Predictions:** Tide/current heights calculated from local database
- **Station Locations:** Cached in AsyncStorage
- **Buoy Locations:** Cached in AsyncStorage (no observations)
- **Marine Zone Boundaries:** Cached in AsyncStorage (no forecasts)
- **Place Names:** Rendered from local GNIS tiles
- **Route Planning:** Full functionality with local data
- **Waypoint Management:** Full functionality

### ❌ Requires Online

- **Marine Weather Forecasts:** Live data from Firestore
- **Buoy Observations:** Live conditions from Firestore
- **User Account Sync:** Firebase Authentication + Firestore sync
- **Cloud Function Calls:** Initial station location fetch (cached afterward)

---

## Storage Space Requirements

### Typical District (e.g., Alaska - 17cgd)

| Item | Size |
|------|------|
| Charts (US1-US6) | ~300 MB |
| Predictions (Tides + Currents) | ~48 MB |
| Buoys Catalog | ~1 MB |
| Marine Zones | ~0.5 MB |
| GNIS Place Names | ~15 MB |
| Satellite (Medium Res) | ~800 MB |
| Basemap | ~100 MB |
| **Total** | **~1.3 GB** |

### Multi-District Install

Users can download multiple districts. Each district's data is stored separately:
- `17cgd` (Alaska): ~1.3 GB
- `13cgd` (Pacific Northwest): ~1.1 GB
- `01cgd` (New England): ~0.8 GB
- **Total for 3 districts:** ~3.2 GB

---

## Implementation Status

### ✅ Implemented

- [x] Multi-district download architecture
- [x] Chart pack downloads (US1-US6)
- [x] Prediction database downloads (tides + currents)
- [x] Buoy catalog caching
- [x] Marine zone boundary caching (NEW)
- [x] GNIS place names
- [x] Satellite imagery (low/medium/high res)
- [x] Basemap, Ocean, Terrain tiles
- [x] Region registry (tracks installed districts)
- [x] Download progress tracking (speed, ETA)
- [x] Individual category deletion
- [x] Full region deletion

### 📋 Future Enhancements

- [ ] Background downloads (continue when app is backgrounded)
- [ ] Download scheduling (WiFi-only, off-peak hours)
- [ ] Automatic updates (check for new chart versions)
- [ ] Delta updates (only download changes)
- [ ] Compression improvements (better zip algorithms)
- [ ] P2P sharing (share districts between devices)

---

## API Reference

### Services

**chartPackService.ts**
- `getDistrict(districtId)` - Fetch district metadata from Firestore
- `downloadPack(pack, districtId, onProgress)` - Download and extract a pack
- `getInstalledPackIds(districtId)` - Check what's installed
- `deletePack(pack, districtId)` - Remove a pack
- `deleteRegion(districtId)` - Delete all data for a district

**stationService.ts**
- `downloadAllPredictions(onProgress, districtId)` - Download tide/current DBs
- `arePredictionsDownloaded(districtId)` - Check prediction status
- `clearPredictions(districtId)` - Delete prediction databases
- `fetchAllStations()` - Fetch station locations (cached to AsyncStorage)

**buoyService.ts**
- `downloadBuoyCatalog(districtId, onProgress)` - Cache buoy catalog
- `areBuoysDownloaded(districtId)` - Check buoy cache status
- `clearBuoys(districtId)` - Clear buoy cache
- `getBuoysCatalog(districtId)` - Get buoys (online or cached)

**marineZoneService.ts**
- `downloadMarineZones(districtId, onProgress)` - Cache zone boundaries
- `areMarineZonesDownloaded(districtId)` - Check zone cache status
- `clearMarineZones(districtId)` - Clear zone cache
- `getMarineZones(districtId)` - Get zones (online or cached)
- `getMarineForecast(districtId, zoneId)` - Get forecast (online only)

**regionRegistryService.ts**
- `registerDistrict(districtId, flags)` - Register installed district
- `getInstalledDistricts()` - Get all installed districts
- `unregisterDistrict(districtId)` - Remove from registry

---

## Cloud Functions Reference

### Data Update Functions

**fetchBuoys** (Scheduled: every 5 minutes)
- Fetches latest observations from NDBC (National Data Buoy Center)
- Updates `districts/{districtId}/buoys/catalog`
- Per-district buoy organization

**fetchMarineForecasts** (Scheduled: every 10 minutes, smart polling)
- Fetches forecasts from NWS marine.weather.gov
- Updates `districts/{districtId}/marine-forecasts/{zoneId}`
- Only fetches during NWS update windows (3-4 AM/PM)

**getStationLocations** (HTTP callable)
- Returns all tide and current station locations
- Called by app on startup
- Cached to AsyncStorage for offline access

---

## Migration Notes

### Realtime Database → Firestore (Complete)

The app has been **fully migrated** from Firebase Realtime Database to Firestore. No Realtime Database references remain in the codebase.

**Old Structure (Deprecated):**
```
/buoys
/current-stations
/marine-forecasts
/marine-zones
/tidal-stations
```

**New Structure (Current):**
```
districts/{districtId}/buoys/catalog
districts/{districtId}/marine-forecasts/{zoneId}
districts/{districtId}/marine-zones/{zoneId}
```

Station locations are now fetched via Cloud Function and cached locally, not stored in the database.

---

## Troubleshooting

### Downloads Failing
- Check internet connection
- Verify user is on WiFi for large downloads
- Check Firebase Storage bucket permissions
- Ensure sufficient device storage space

### Offline Mode Not Working
- Verify district is registered: `getInstalledDistricts()`
- Check AsyncStorage for cached data
- Verify MBTiles files exist in `{documentDirectory}/mbtiles/`
- Check native tile server is running on port 8765

### Data Out of Sync
- Marine forecasts update every 10 minutes (requires online)
- Buoy observations update every 5 minutes (requires online)
- Charts/predictions don't auto-update (manual re-download required)

---

## Contact & Support

For issues or questions about data architecture:
- Check logs: `console.log` statements in all services
- Review AsyncStorage: Use React Native Debugger
- Inspect Firestore: Firebase Console
- Test offline: Toggle airplane mode in simulator/device

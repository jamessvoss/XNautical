# Marine Zone Forecast System

## Overview

XNautical provides marine weather forecasts by integrating with NOAA's National Weather Service (NWS) marine forecast system. The system displays weather forecasts for specific marine zones on a map, showing polygon boundaries for each zone along with detailed forecast information.

## Data Sources

### 1. Marine Zone Boundaries (Shapefiles)

**Source:** NOAA National Weather Service GIS Data Portal  
**URL:** https://www.weather.gov/gis/MarineZones

**Available Shapefiles:**

| Type | Description | URL | Records |
|------|-------------|-----|---------|
| Coastal Marine Zones | Coastal waters including Great Lakes | https://www.weather.gov/source/gis/Shapefiles/WSOM/mz03mr26.zip | 569 zones |
| Offshore Marine Zones | Offshore waters | https://www.weather.gov/source/gis/Shapefiles/WSOM/oz03mr26.zip | 130 zones |
| High Seas Zones | International waters | https://www.weather.gov/source/gis/Shapefiles/WSOM/hz20fe25.zip | 6 zones |

**Update Frequency:** Shapefiles are updated periodically (roughly quarterly) with naming convention: `mzDDMMYY.zip` where DDMMYY = day-month-year.

**Shapefile Attributes:**

```
ID       - Marine Zone Identifier (e.g., "PKZ722", "GMZ750")
NAME     - Name of Marine Zone (e.g., "Waters from Kodiak to Prince William Sound")
WFO      - Weather Forecast Office code (e.g., "AFC" for Anchorage)
GL_WFO   - Great Lakes WFO (for zones with open lake forecasts)
LON      - Longitude of zone centroid [decimal degrees]
LAT      - Latitude of zone centroid [decimal degrees]
Geometry - Polygon boundary (shapefile format)
```

**NWS Specification:** Marine zones follow NWSI 10-302 specifications.

### 2. Marine Forecast Data (Text Forecasts)

**Source:** NOAA Marine Weather Website  
**Base URL:** `https://marine.weather.gov/MapClick.php?zoneid={ZONE_ID}`

**Example:** https://marine.weather.gov/MapClick.php?zoneid=pkz722

**Forecast Content Includes:**
- **Advisory** - Active warnings or advisories (e.g., Small Craft Advisory)
- **Synopsis** - General weather pattern overview
- **Forecast Periods** - Detailed forecasts for each time period (Today, Tonight, etc.)
  - Period name (e.g., "Today", "Tonight", "Monday")
  - Detailed forecast text (wind, seas, weather)
  - Start and end times

**Update Schedule:** NOAA updates marine forecasts twice daily:
- **Morning update:** ~5:00 AM local time
- **Afternoon update:** ~3:00 PM local time

Updates may occur more frequently during severe weather.

## Current Architecture (Alaska-Only)

### Firestore Structure

```
marine-zones/              # Flat collection (Alaska zones only)
  PKZ722/
    id: "PKZ722"
    name: "Waters from Kodiak to Prince William Sound"
    wfo: "AFC"
    centroid: { lat: 57.5, lon: -152.3 }
    geometryJson: "{...}"  # Stringified GeoJSON polygon
    
marine-forecasts/          # Flat collection
  PKZ722/
    zoneId: "PKZ722"
    zoneName: "Waters from Kodiak to Prince William Sound"
    advisory: "...SMALL CRAFT ADVISORY IN EFFECT..."
    synopsis: "Low pressure system moving..."
    forecast: [
      { number: 1, name: "Today", detailedForecast: "..." },
      { number: 2, name: "Tonight", detailedForecast: "..." },
      ...
    ]
    nwsUpdated: "Last Update: 5:15 AM AKST"
    updatedAt: Timestamp
```

### Cloud Functions

**Location:** `functions/src/index.ts` (lines 3802-4168)

**Scheduled Function:** `fetchMarineForecasts`
- **Schedule:** Every 10 minutes
- **Timezone:** America/Anchorage (Alaska)
- **Smart Polling:** Only fetches when within NOAA update windows (5-6 AM, 3-4 PM Alaska time)
- **Logic:**
  1. Reads all zones from `marine-zones` collection
  2. For each zone, fetches forecast from `marine.weather.gov`
  3. Parses HTML using cheerio
  4. Saves to `marine-forecasts` collection
  5. Updates metadata: `system/marine-forecast-meta`

**Manual Refresh Function:** `refreshMarineForecasts`
- HTTP-triggered endpoint
- Bypasses smart polling to immediately refresh all forecasts

**Daily Summary Function:** `dailyMarineForecastSummary`
- Runs at midnight Alaska time
- Checks for forecast fetch failures from previous day
- Sends email alerts if issues occurred

### App Service

**Location:** `src/services/marineZoneService.ts`

**Functions:**
- `getMarineZones()` - Fetches all zones with full geometry
- `getMarineZoneSummaries()` - Fetches zone metadata without geometry
- `getMarineZone(zoneId)` - Fetches single zone
- `getMarineForecast(zoneId)` - Fetches forecast for a zone

**Caching:** Zone data is cached in memory for 1 hour to reduce Firestore reads.

### UI

**Location:** `src/screens/WeatherScreen.tsx`

**Display:**
- Map with marine zone polygons
- Labels at zone centroids showing zone IDs
- Tap zone to view detailed forecast
- Color-coding for active advisories

## Limitations (Current System)

1. **Single Region:** Only supports Alaska (District 17)
2. **Flat Collections:** No multi-district organization
3. **Hardcoded Timezone:** Alaska time only
4. **No District Scoping:** Cannot easily add other USCG districts

## Planned Architecture (Multi-District)

### Firestore Structure (Proposed)

```
marine-forecast-districts/
  17cgd/                          # Alaska
    marine-zones/                 # Subcollection
      PKZ722/
        id: "PKZ722"
        name: "..."
        wfo: "AFC"
        centroid: { lat, lon }
        geometryJson: "{...}"
        districtId: "17cgd"
    marine-forecasts/             # Subcollection
      PKZ722/
        zoneId: "PKZ722"
        forecast: [...]
        updatedAt: Timestamp
        
  07cgd/                          # Southeast
    marine-zones/
      GMZ750/                     # Southeast zone example
        id: "GMZ750"
        name: "..."
        wfo: "MLB"
        centroid: { lat, lon }
        geometryJson: "{...}"
        districtId: "07cgd"
    marine-forecasts/
      GMZ750/
        zoneId: "GMZ750"
        forecast: [...]
        updatedAt: Timestamp
```

### Cloud Functions (Proposed)

**Per-district scheduled functions:**
- `fetchMarineForecasts17cgd` - Alaska (America/Anchorage)
- `fetchMarineForecasts07cgd` - Southeast (America/New_York)
- `fetchMarineForecasts11cgd` - Southwest (America/Los_Angeles)
- ... (one per district)

**Shared helpers:**
- `fetchZoneForecast(zoneId)` - Fetch single zone (unchanged)
- `fetchForecastsForDistrict(districtId, config)` - Fetch all zones for a district
- `saveForecastsForDistrict(districtId, forecasts)` - Save to district subcollection

**District configuration:**
```typescript
const DISTRICT_CONFIGS = {
  '17cgd': { name: 'Alaska', timezone: 'America/Anchorage', updateHours: [5, 15] },
  '07cgd': { name: 'Southeast', timezone: 'America/New_York', updateHours: [6, 16] },
  '11cgd': { name: 'Southwest', timezone: 'America/Los_Angeles', updateHours: [6, 15] },
  // ...
};
```

## Data Population Process

### Initial Setup (Alaska - Completed)

1. Downloaded NOAA coastal marine zone shapefile for Alaska zones
2. Extracted zone polygons and metadata
3. Imported to FishTopia Firebase project
4. Migrated to XNautical project via `scripts/copy-firestore-collections.js`

### Multi-District Setup (Planned)

**Script:** `scripts/discover-marine-zones.js`

**Process:**
1. Download NOAA shapefiles:
   - Coastal zones: `mz03mr26.zip`
   - Offshore zones: `oz03mr26.zip`
2. Extract and read shapefiles using `pyshp` library
3. For each zone:
   - Read attributes: ID, NAME, WFO, LON, LAT, geometry
   - Convert geometry to GeoJSON
   - Determine which USCG district(s) contain the zone:
     - Compare zone centroid to district bounds from `src/config/regionData.ts`
     - A zone may belong to multiple districts if it spans boundaries
4. Write to Firestore:
   - Path: `marine-forecast-districts/{districtId}/marine-zones/{zoneId}`
   - Include: id, name, wfo, centroid, geometryJson, districtId

## Technical Notes

### Forecast HTML Parsing

NOAA marine forecasts are HTML pages without a JSON API. The cloud function uses **cheerio** to parse:
- Zone name from `<h1>` tag
- Advisory from text patterns (e.g., `...ADVISORY TEXT...`)
- Synopsis from "Synopsis:" section
- Forecast periods from `.row-forecast` elements
- Update time from "Last Update:" text

### Error Handling

- Zones that fail to fetch are logged but don't block other zones
- Daily summary emails alert administrators to persistent issues
- Smart polling reduces unnecessary fetches (respects NOAA update schedule)

### Performance Optimizations

- **Client-side caching:** Zone data cached for 1 hour in memory
- **Geometry optimization:** Zone polygons can be heavy (~1KB-50KB per zone)
  - Summary queries fetch metadata only (no geometry)
  - Full geometry loaded only when displaying map
- **Batched writes:** Cloud function uses batches to write forecasts efficiently

## References

- **NOAA Marine Zones:** https://www.weather.gov/gis/MarineZones
- **NOAA Marine Forecasts:** https://www.weather.gov/marine/
- **NWS Spec NWSI 10-302:** https://www.weather.gov/media/directives/010_pdfs/pd01003002curr.pdf
- **Shapefile Change History:** https://www.weather.gov/source/gis/Shapefiles/WSOM/mz_ch_log.txt

## Changelog

| Date | Change |
|------|--------|
| 2025 | Initial implementation for Alaska (District 17) |
| 2026-02 | Documented system architecture and multi-district plan |

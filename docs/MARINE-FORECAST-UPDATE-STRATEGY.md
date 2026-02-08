# Marine Forecast Update Strategy

## Overview

The XNautical app fetches marine zone forecasts from NOAA's National Weather Service (NWS) using an intelligent polling strategy that aligns with NWS's twice-daily update schedule.

## NWS Update Schedule

NWS updates marine forecasts **twice daily** in each region's **local timezone**:
- **Morning Window**: 3:00 AM - 4:00 AM
- **Evening Window**: 3:00 PM - 4:00 PM

## XNautical Polling Strategy

### Schedule
- **Frequency**: Every 15 minutes
- **Polling Windows**: 3:30 AM - 4:30 AM and 3:30 PM - 4:30 PM (local time)
- **Start Time**: 30 minutes after NWS window begins (to allow NWS time to publish)
- **End Time**: 30 minutes after NWS window ends (to ensure we catch delayed updates)

### Smart Stop Logic

The system **stops polling early** when either:
1. **All zones successfully retrieved**: If we fetch 100% of marine zones for a district, we stop checking until the next update window
2. **Window expires**: At 4:30 AM/PM local time, we stop checking regardless of completion status

### Benefits
- **Reduces API calls**: No polling outside update windows or after successful completion
- **Respects NWS resources**: Waits 30 minutes before first check, gives NWS time to publish
- **Handles delays gracefully**: Continues checking for up to 60 minutes if forecasts aren't ready immediately
- **Multi-district support**: Each district's polling is based on its own local timezone

## Implementation Details

### Cloud Function: `fetchMarineForecasts`
- Runs every 15 minutes (Cloud Scheduler)
- Checks all active districts (`17cgd`, `07cgd`, etc.)
- For each district:
  1. Calculate current time in district's timezone
  2. Check if within polling window (3:30-4:30 AM/PM)
  3. Check Firestore metadata for last update status
  4. If all zones already retrieved in current window → skip
  5. If partial/failed → retry after 15 minutes
  6. If outside window → skip

### Metadata Tracking

Stored in `marine-forecast-districts/{districtId}/system/marine-forecast-meta`:
```typescript
{
  lastUpdatedAt: Timestamp,
  zonesUpdated: number,    // Count of successfully updated zones
  totalZones: number,      // Total zones in district
  windowHour: number       // 3 or 15 (start hour of update window)
}
```

### District Timezones

| District | Region | Timezone |
|----------|--------|----------|
| 01cgd | Northeast | America/New_York |
| 05cgd | East | America/New_York |
| 07cgd | Southeast | America/New_York |
| 08cgd | Heartland | America/Chicago |
| 09cgd | Great Lakes | America/Chicago |
| 11cgd | Southwest | America/Los_Angeles |
| 13cgd | Northwest | America/Los_Angeles |
| 14cgd | Oceania | Pacific/Honolulu |
| 17cgd | Arctic (Alaska) | America/Anchorage |

## Example: Alaska (17cgd) Update Flow

**Scenario: Morning Update on February 8, 2026**

| Time (Alaska) | Action | Result |
|---------------|--------|--------|
| 3:00 AM | NWS begins publishing forecasts | (System not polling yet) |
| 3:30 AM | First poll attempt | Fetches 0/112 zones (NWS not ready) |
| 3:45 AM | Second poll attempt | Fetches 45/112 zones (partial) |
| 4:00 AM | Third poll attempt | Fetches 112/112 zones ✓ |
| 4:15 AM | Scheduled check | Skips (all zones already retrieved) |
| 4:30 AM | Scheduled check | Skips (all zones already retrieved) |
| 4:45 AM | Scheduled check | Skips (outside window) |
| ... | No more polling until 3:30 PM | |

## Manual Refresh

The `refreshMarineForecasts` HTTP endpoint bypasses the smart polling logic for testing/debugging:

```bash
# Refresh single district
curl "https://us-central1-xnautical-8a296.cloudfunctions.net/refreshMarineForecasts?district=07cgd"

# Refresh all districts
curl "https://us-central1-xnautical-8a296.cloudfunctions.net/refreshMarineForecasts"
```

## Future Enhancements

- [ ] Add webhook notifications when all zones are successfully updated
- [ ] Implement exponential backoff for districts with repeated failures
- [ ] Add district-specific polling windows (some regions may update at different times)
- [ ] Monitor NWS API rate limits and implement adaptive throttling

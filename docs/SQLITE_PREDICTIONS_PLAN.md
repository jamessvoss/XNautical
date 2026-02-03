# Tide & Current Predictions - SQLite Implementation Plan

## Overview
Generate SQLite database in Cloud Function, download to device, query on-demand.

## SQLite Schema

```sql
-- Station metadata
CREATE TABLE stations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'tide' or 'current'
  lat REAL NOT NULL,
  lng REAL NOT NULL
);

CREATE INDEX idx_stations_type ON stations(type);
CREATE INDEX idx_stations_location ON stations(lat, lng);

-- Tide predictions (High/Low events)
CREATE TABLE tide_predictions (
  station_id TEXT NOT NULL,
  date TEXT NOT NULL, -- YYYY-MM-DD
  time TEXT NOT NULL, -- HH:MM
  type TEXT NOT NULL, -- 'H' or 'L'
  height REAL NOT NULL,
  PRIMARY KEY (station_id, date, time),
  FOREIGN KEY (station_id) REFERENCES stations(id)
);

CREATE INDEX idx_tide_date ON tide_predictions(station_id, date);

-- Current predictions (Slack/Max events)
CREATE TABLE current_predictions (
  station_id TEXT NOT NULL,
  date TEXT NOT NULL, -- YYYY-MM-DD
  time TEXT NOT NULL, -- HH:MM
  type TEXT NOT NULL, -- 'slack', 'flood', 'ebb'
  velocity REAL NOT NULL,
  direction REAL, -- degrees (null for slack)
  PRIMARY KEY (station_id, date, time),
  FOREIGN KEY (station_id) REFERENCES stations(id)
);

CREATE INDEX idx_current_date ON current_predictions(station_id, date);

-- Metadata
CREATE TABLE metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO metadata VALUES 
  ('version', '1.0'),
  ('generated', datetime('now')),
  ('tide_stations', '0'),
  ('current_stations', '0'),
  ('tide_events', '0'),
  ('current_events', '0');
```

## Cloud Function Implementation

**Package needed**: `better-sqlite3` (synchronous SQLite for Node.js)

```bash
cd functions
npm install better-sqlite3 @types/better-sqlite3
```

## Benefits

1. **Memory Efficient**: Download streams directly to disk (~100 MB)
2. **Fast Queries**: Indexed lookups for specific station/date
3. **No Parsing**: Database is ready to use immediately
4. **Compact**: SQLite is very space-efficient
5. **Familiar**: Already using expo-sqlite for mbtiles

## Expected Sizes

- **JSON**: ~122 MB
- **SQLite**: ~80-90 MB (more compact due to binary format & indexes)
- **Compressed**: ~25-30 MB (for download)

## Download Strategy

```typescript
// Download compressed .db.gz
// Decompress to .db
// Open with expo-sqlite
// Query on-demand
```

## Query Examples

```sql
-- Get tide events for a station on a specific date
SELECT time, type, height 
FROM tide_predictions 
WHERE station_id = ? AND date = ?
ORDER BY time;

-- Get current events for date range
SELECT date, time, type, velocity, direction
FROM current_predictions 
WHERE station_id = ? 
  AND date BETWEEN ? AND ?
ORDER BY date, time;

-- Get station info
SELECT * FROM stations WHERE id = ?;
```

## Next Steps

1. Install better-sqlite3 in functions/
2. Update generatePredictionsBundle to create .db file
3. Update client to download and query SQLite
4. Test with one station first

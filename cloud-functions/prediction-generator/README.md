# Prediction Generator - Cloud Run Service

Generates NOAA tide and current predictions for Coast Guard districts, builds SQLite databases, and uploads to Firebase Storage with readable JSON inspection files.

## Architecture

### Pipeline (Optimized for Firestore Cost Reduction)

1. **Fetch from NOAA** - Collect predictions in memory
2. **Write Metadata to Firestore** - Lightweight station metadata only (for `getStationLocations` cloud function)
3. **Write JSON to Storage** - Raw predictions + station summaries (for inspection)
4. **Build SQLite from Memory** - No Firestore round-trip
5. **Upload .db.zip to Storage** - Compressed databases for app download

### What's Stored Where

**Firestore** (lightweight metadata only):
```
districts/{regionId}/tidal-stations/{stationId}
  - id, name, lat, lng, type, predictionRange, eventCount, dayCount
  
districts/{regionId}/current-stations/{stationId}
  - id, name, lat, lng, bin, noaaType, weakAndVariable, depth, 
    depthType, predictionRange, monthsAvailable
```

**Firebase Storage** (large files):
```
{regionId}/predictions/
  tides_{regionId}.db.zip              # SQLite for app (compressed)
  currents_{regionId}.db.zip           # SQLite for app (compressed)
  tide_stations.json                   # Station metadata summary (inspection)
  current_stations.json                # Station metadata summary (inspection)
  tides_raw.json                       # Full raw tide predictions (inspection)
  currents_raw.json                    # Full raw current predictions (inspection)
```

## Deployment

### Build and Deploy

```bash
# Build Docker image
cd cloud-functions/prediction-generator
gcloud builds submit --tag gcr.io/xnautical-8a296/prediction-generator:latest .

# Deploy to Cloud Run
gcloud run deploy prediction-generator \
  --image gcr.io/xnautical-8a296/prediction-generator:latest \
  --region us-central1 \
  --platform managed \
  --memory 2Gi \
  --timeout 3600 \
  --no-allow-unauthenticated
```

### Service URL
```
https://prediction-generator-653355603694.us-central1.run.app
```

## Usage

### Recommended: Split Runs (Tides → Currents)

For large regions, trigger tides and currents **separately** to avoid timeout:

```bash
# Use the helper script
./trigger-predictions.sh 07cgd

# Or manually:
# 1. Tides (~40-50 minutes for large regions)
./trigger-predictions.sh 07cgd tides

# 2. Wait for completion, then currents (~20-25 minutes)
./trigger-predictions.sh 07cgd currents
```

### Alternative: Combined Run (Small Regions Only)

For small regions (< 400 stations total):

```bash
./trigger-predictions.sh 07cgd all
```

⚠️ **Warning**: Combined runs can exceed the 60-minute Cloud Run timeout for large regions.

### Check Status

```bash
./trigger-predictions.sh 07cgd status
```

## API Endpoints

### POST /generate

Generate predictions for a region.

**Request:**
```json
{
  "regionId": "07cgd",
  "type": "tides",        // required: "tides", "currents", or "all"
  "yearsBack": 1,         // optional, default 1
  "yearsForward": 2,      // optional, default 2
  "maxStations": 10       // optional: limit stations for testing (omit for full generation)
}
```

**Testing with Limited Stations:**

For quick pipeline verification without waiting 45+ minutes, use `maxStations`:

```bash
# Test with just 10 stations (~2-3 minutes)
curl -X POST https://prediction-generator-xxx.run.app/generate \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -H "Content-Type: application/json" \
  -d '{"regionId": "07cgd", "type": "tides", "maxStations": 10}'
```

This will process only the first 10 stations, completing in ~2-3 minutes instead of ~45 minutes.

**Response:**
```json
{
  "status": "success",
  "regionId": "07cgd",
  "type": "tides",
  "dateRange": {
    "begin": "2025-02-09",
    "end": "2028-02-09"
  },
  "tides": {
    "stationsProcessed": 848,
    "totalEvents": 3445098,
    "stationsFailed": 1
  },
  "tideDbSizeMB": 75.2,
  "durationSeconds": 2456.3
}
```

**Error Responses:**

**409 Conflict** - Generation already in progress:
```json
{
  "error": "Generation already in progress",
  "currentState": "fetching_tides",
  "startedAt": "2026-02-09T06:31:20Z",
  "message": "A fetching_tides job is already running for 07cgd. Wait for completion or use /status to check progress."
}
```

**Note:** The service uses request deduplication to prevent multiple concurrent generations for the same region. If a generation is already running (states: `generating`, `fetching_tides`, `fetching_currents`, `building_databases`, `uploading`, `cooldown`), new requests will be rejected with a 409 error. Stale locks (>2 hours old) are automatically cleared and allow new requests.

### GET /status?regionId={regionId}

Get generation status for a region.

**Response:**
```json
{
  "regionId": "07cgd",
  "predictionStatus": {
    "state": "fetching_tides",
    "message": "Fetching tides: 849 stations...",
    "startedAt": "2026-02-09T04:13:56Z"
  },
  "predictionData": {
    "lastGenerated": "2026-02-08T23:20:52Z",
    "tides": {
      "stationCount": 848,
      "dbSizeMB": 75.2,
      "storagePath": "07cgd/predictions/tides_07cgd.db.zip"
    }
  }
}
```

### GET /

Health check endpoint.

## Valid Regions

- `01cgd` - First Coast Guard District
- `05cgd` - Fifth Coast Guard District  
- `07cgd` - Seventh Coast Guard District
- `08cgd` - Eighth Coast Guard District
- `09cgd` - Ninth Coast Guard District
- `11cgd` - Eleventh Coast Guard District
- `13cgd` - Thirteenth Coast Guard District
- `14cgd` - Fourteenth Coast Guard District
- `17cgd` - Seventeenth Coast Guard District

## Configuration

### Environment Variables

- `PORT` - HTTP port (default: 8080, set by Cloud Run)
- `BUCKET_NAME` - Firebase Storage bucket (default: `xnautical-8a296.firebasestorage.app`)

### NOAA Rate Limiting

- **Concurrent chunks**: 3 simultaneous date range requests per station
- **Inter-request delay**: 0.1 seconds between chunks
- **Cooldown**: 60 seconds between tide and current phases

### Timeouts

- **Request timeout**: 3600 seconds (60 minutes)
- **NOAA request timeout**: 30 seconds per chunk

### Memory Limits

- **Configured limit**: 4 GB (4096 MiB)
- **Peak usage**: ~2.5-3 GB for regions with 800+ stations
- **Optimization**: Automatic garbage collection clears data after each phase (tides/currents) to minimize peak memory usage

## Typical Processing Times

| Region | Tide Stations | Current Stations | Tides Duration | Currents Duration | Total |
|--------|--------------|------------------|----------------|-------------------|-------|
| 17cgd  | 849          | 416              | ~45 min        | ~23 min           | ~70 min |
| 07cgd  | 849          | 416              | ~45 min        | ~23 min           | ~70 min |
| 01cgd  | ~600         | ~300             | ~32 min        | ~17 min           | ~50 min |

⚠️ **Timeout Risk**: Regions with 800+ stations may exceed 60-minute timeout in combined runs. Use split runs.

## Monitoring

### View Logs

```bash
# Real-time logs
gcloud logging tail "resource.type=cloud_run_revision AND resource.labels.service_name=prediction-generator" --format=json

# Recent logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=prediction-generator AND timestamp>\"2026-02-09T00:00:00Z\"" --limit 100
```

### Common Log Patterns

**Tide processing:**
```
INFO [38/849] South Dewees Island: 4235 events, 1096 days
```

**Current processing:**
```
INFO [680/724] Dimond Reef: 37 months
```

**Completion:**
```
INFO Tides complete: 848 stations, 3445098 events, 1 failed (2456s)
INFO Current DB: 401 stations (14 weak & variable), 2847291 events
```

## Troubleshooting

### Timeout During Generation

**Solution**: Use split runs (tides then currents separately)

### NOAA API Errors

**Symptom**: `No data: Station Name (stationId)`

**Causes**:
- NOAA API temporarily down
- Station discontinued
- Rate limit exceeded

**Solution**: Retry after 5-10 minutes

### Firestore Permission Errors

**Check**: Service account has Firestore write permissions
```bash
gcloud projects get-iam-policy xnautical-8a296 --flatten="bindings[].members" --filter="bindings.members:serviceAccount"
```

### Storage Upload Failures

**Check**: Service account has Storage write permissions and bucket exists
```bash
gsutil ls gs://xnautical-8a296.firebasestorage.app/
```

### Memory Limit Exceeded

**Symptom**: 
```
Memory limit of 4096 MiB exceeded with 4200 MiB used
[INFO] Handling signal: term
```

**Causes**:
- Very large regions (1000+ stations)
- Combined run (`type="all"`) holding both tide and current data in memory simultaneously

**Solutions**:
1. **Use split runs** (recommended): Run tides and currents separately
   ```bash
   ./trigger-predictions.sh 07cgd tides
   ./trigger-predictions.sh 07cgd currents
   ```
   Each run only holds one dataset in memory at a time.

2. **Increase memory limit** (if necessary):
   ```bash
   gcloud run services update prediction-generator --region=us-central1 --memory=8Gi
   ```
   Note: Current limit is 4GB, which handles regions up to ~1000 stations per type.

**Current optimization**: The service automatically clears data from memory after building each database (tide/current) using Python's garbage collector.

## Cost Optimization

### Before Optimization (Old Architecture)
- ✗ Raw predictions written to Firestore (~500-1000 documents per station)
- ✗ All predictions read back from Firestore to build SQLite
- ✗ Cost: $$$$ per region (Firestore read/write costs)

### After Optimization (Current Architecture)
- ✓ Raw predictions kept in memory during generation
- ✓ Only lightweight metadata written to Firestore (~1 document per station)
- ✓ Raw predictions uploaded to Storage as JSON (cheaper than Firestore)
- ✓ SQLite built directly from memory (no Firestore round-trip)
- ✓ Cost: ~90% reduction

### Estimated Savings
- **Firestore writes**: Reduced by ~95% (only metadata, no raw predictions)
- **Firestore reads**: Eliminated 100% (no read-back during SQLite build)
- **Storage**: Added minimal JSON files (~5-10 MB per region)
- **Net savings**: ~$50-100 per region per generation

## Development

### Local Testing

```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables
export PORT=8080
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json

# Run locally
python server.py

# Test endpoint
curl -X POST http://localhost:8080/generate \
  -H "Content-Type: application/json" \
  -d '{"regionId": "17cgd", "type": "tides"}'
```

### Code Structure

```
server.py
├── NOAA Fetch Functions
│   ├── fetch_tide_chunk()         - Fetch tide data from NOAA API
│   └── fetch_current_chunk()      - Fetch current data from NOAA API
│
├── Processing Functions
│   ├── process_all_tide_stations()    - Fetch tides, write metadata to Firestore, collect in memory
│   └── process_all_current_stations() - Fetch currents, write metadata to Firestore, collect in memory
│
├── SQLite Builders
│   ├── build_tide_database()      - Build SQLite from in-memory tide data
│   └── build_current_database()   - Build SQLite from in-memory current data
│
├── Storage Helpers
│   ├── write_tide_json_files()    - Write tide JSON to Storage
│   ├── write_current_json_files() - Write current JSON to Storage
│   ├── upload_json_to_storage()   - Upload JSON to Storage
│   └── compress_and_upload()      - Compress SQLite and upload
│
└── API Endpoints
    ├── /generate (POST)           - Main generation endpoint
    ├── /status (GET)              - Get generation status
    └── / (GET)                    - Health check
```

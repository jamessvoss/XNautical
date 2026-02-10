# NOAA Tide & Current Predictions System

## Overview

This system fetches tide and current predictions from NOAA's CO-OPS API for all Coast Guard districts, processes them into SQLite databases, and stores them in Firebase for offline use in the mobile app.

## Architecture

### Components

1. **Cloud Run Service** (`prediction-generator`)
   - HTTP endpoints for generation, status checks, and lock management
   - Runs synchronously (blocks until completion)
   - Enforces atomic locking via Firestore transactions
   - Concurrency limited to 1 request at a time

2. **Cloud Run Job** (`prediction-generator-job`)
   - Wrapper that calls the Service's `/generate` endpoint
   - Can be cancelled at any time via gcloud CLI
   - Runs with 8GB memory, 2 CPU, 1 hour timeout
   - No auto-retry on failure

3. **Firestore** (`districts` collection)
   - `predictionConfig`: Station lists (tideStations, currentStations)
   - `predictionStatus`: Current generation state (lock mechanism)
   - `predictionData`: Metadata about generated predictions

4. **Firebase Storage**
   - Raw JSON files: `{regionId}/predictions/tide_stations_raw.json`, `current_stations_raw.json`
   - Station metadata: `tide_stations.json`, `current_stations.json`
   - SQLite databases: `tides_{regionId}.db.zip`, `currents_{regionId}.db.zip`

5. **Queue Script** (`queue-all-regions.sh`)
   - Processes all regions sequentially (smallest to largest)
   - Runs tides first, then currents for each region
   - Polls for completion every 60 seconds
   - Refreshes auth tokens hourly

## Data Flow

### 1. Discovery Phase (One-time Setup)
```
scripts/discover-noaa-stations.js
  → Queries NOAA metadata API
  → Assigns stations to districts based on geographic bounds
  → Writes to Firestore: districts/{regionId}.predictionConfig
    - tideStations: [{ id, name, lat, lng }, ...]
    - currentStations: [{ id, name, lat, lng }, ...]
```

### 2. Generation Phase (Recurring)

```
Trigger → Cloud Run Job
  ↓
Job calls Service /generate endpoint
  ↓
Service: Atomic Lock Acquisition (Firestore Transaction)
  ↓
Service: Fetch Predictions from NOAA
  - Parallel requests (8 concurrent chunks per station)
  - Rate limiting: 0.2s delay between requests
  - Retry logic: 3 attempts with exponential backoff
  - Data collected in memory
  ↓
Service: Write Raw JSON to Storage
  - tide_stations_raw.json (all predictions)
  - current_stations_raw.json (all predictions)
  - Station metadata files
  ↓
Service: Build SQLite Databases
  - In-memory construction
  - Optimize with indices
  - Compress to .db.zip
  ↓
Service: Upload to Storage
  - tides_{regionId}.db.zip
  - currents_{regionId}.db.zip
  ↓
Service: Update Firestore
  - predictionData: { tides: {...}, currents: {...} }
  - predictionStatus: { state: 'complete' }
  ↓
Service: Release Lock & Return Response
```

### 3. Mobile App Usage

```
App downloads .db.zip from Storage
  ↓
Extract to local filesystem
  ↓
Query SQLite for predictions
  - SELECT * FROM tides WHERE stationId=? AND date=?
  - SELECT * FROM currents WHERE stationId=? AND datetime BETWEEN ? AND ?
```

## Region Processing Order

Regions are processed smallest to largest by total station count:

| Region | Stations | Est. Time | Description |
|--------|----------|-----------|-------------|
| 14cgd  | 65       | ~10 min   | Hawaii & Pacific Islands |
| 11cgd  | 266      | ~25 min   | Southern California |
| 08cgd  | 338      | ~30 min   | Gulf Coast |
| 13cgd  | 592      | ~40 min   | Pacific Northwest |
| 05cgd  | 971      | ~55 min   | Mid-Atlantic |
| 01cgd  | 1196     | ~60 min   | New England |
| 17cgd  | 1216     | ~60 min   | Alaska |
| 07cgd  | 1265     | ~60 min   | Southeast |

**Total Time (Sequential):** ~8-9 hours for all regions

## Usage

### Running a Single Region

```bash
# Via Cloud Run Job (recommended - can be cancelled)
gcloud run jobs execute prediction-generator-job \
  --region=us-central1 \
  --update-env-vars="REGION_ID=14cgd,GEN_TYPE=tides"

# Via Service directly (use for testing)
./trigger-predictions.sh 14cgd tides
```

### Running All Regions Sequentially

```bash
cd cloud-functions/prediction-generator
./queue-all-regions.sh
```

The queue will:
1. Process regions from smallest (14cgd) to largest (07cgd)
2. For each region: run tides first, then currents
3. Wait for completion before starting the next
4. Refresh auth tokens every hour
5. Handle 409 Conflict errors (generation already in progress)

### Monitoring Progress

```bash
# Check status of a region
./trigger-predictions.sh 07cgd status

# Or via curl
curl -s "https://prediction-generator-653355603694.us-central1.run.app/status?regionId=07cgd" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" | jq

# Watch Cloud Run logs
gcloud logging tail "resource.type=cloud_run_revision AND resource.labels.service_name=prediction-generator" \
  --format=default --project=xnautical-8a296

# List running job executions
gcloud run jobs executions list --job=prediction-generator-job --region=us-central1
```

### Cancelling a Job

```bash
# List running executions
gcloud run jobs executions list --job=prediction-generator-job --region=us-central1

# Cancel specific execution
gcloud run jobs executions cancel <execution-name> --region=us-central1

# Example
gcloud run jobs executions cancel prediction-generator-job-abc123 --region=us-central1
```

### Clearing a Stuck Lock

If a job crashes and leaves the lock in an invalid state:

```bash
./trigger-predictions.sh 07cgd clear-lock
```

This forces the `predictionStatus.state` to `'failed'`, allowing new jobs to start.

## Lock Mechanism

The system uses **Firestore transactions** to ensure only one generation runs per region at a time.

### Lock States

| State | Meaning |
|-------|---------|
| `generating` | Initial state when job starts |
| `fetching_tides` | Fetching tide predictions from NOAA |
| `fetching_currents` | Fetching current predictions from NOAA |
| `building_databases` | Building SQLite databases |
| `uploading` | Uploading files to Storage |
| `complete` | Generation finished successfully |
| `failed` | Generation encountered an error |

### Automatic Lock Clearing

The lock automatically clears if:
1. **Stale with `completedAt`**: Lock has a `completedAt` timestamp but state isn't `'complete'` (crashed after completion)
2. **Idle for 10 minutes**: `lastUpdated` hasn't changed in 10+ minutes (stuck/crashed during processing)
3. **Started 75 minutes ago**: `startedAt` is older than 75 minutes (exceeded Cloud Run 60-min timeout + buffer)

### Atomic Lock Acquisition

```python
@firestore.transactional
def acquire_lock(transaction, doc_ref):
    snapshot = doc_ref.get(transaction=transaction)
    status = snapshot.to_dict().get('predictionStatus', {})
    
    # Check if lock is available or stale
    if status in active_states and not_stale(status):
        raise RuntimeError("Already in progress")
    
    # Atomically acquire lock
    transaction.update(doc_ref, {
        'predictionStatus': {
            'state': 'generating',
            'startedAt': now(),
            'lastUpdated': now()
        }
    })
```

This ensures two concurrent requests **cannot** both acquire the lock.

## Configuration

### Environment Variables

**Cloud Run Service:**
- `PORT`: HTTP port (default: 8080)
- `GOOGLE_CLOUD_PROJECT`: GCP project ID (auto-set)

**Cloud Run Job:**
- `REGION_ID`: Required - District ID (e.g., "07cgd")
- `GEN_TYPE`: Required - "tides", "currents", or "all"
- `YEARS_BACK`: Optional - Years of historical data (default: 1)
- `YEARS_FORWARD`: Optional - Years of future data (default: 2)
- `MAX_STATIONS`: Optional - Limit for testing (e.g., 10)
- `SERVICE_URL`: Service endpoint (default: https://prediction-generator-653355603694.us-central1.run.app)

### Cloud Run Service Settings

```yaml
Memory: 8 GiB
CPU: 2 cores
Concurrency: 1 (only 1 request at a time)
Timeout: 3600 seconds (1 hour)
Min Instances: 0 (scales to zero)
Max Instances: 1 (only 1 instance)
```

### Cloud Run Job Settings

```yaml
Memory: 8 GiB
CPU: 2 cores
Max Retries: 0 (fail once and stop)
Task Timeout: 3600 seconds (1 hour)
```

### NOAA API Rate Limits

```python
NOAA_CONCURRENT_CHUNKS = 8  # Parallel requests per station
NOAA_INTER_REQUEST_DELAY = 0.2  # 200ms between requests
```

**Effective rate:** ~40 requests/second across all stations

## Data Schema

### Firestore: `districts/{regionId}`

```json
{
  "predictionConfig": {
    "tideStations": [
      { "id": "8723214", "name": "Virginia Key", "lat": 25.73, "lng": -80.16 }
    ],
    "currentStations": [
      { "id": "ACT4996", "name": "Miami Harbor", "lat": 25.76, "lng": -80.13 }
    ]
  },
  "predictionStatus": {
    "state": "complete",
    "message": "Prediction generation (tides) complete for 07cgd",
    "startedAt": "2026-02-09T20:00:00Z",
    "lastUpdated": "2026-02-09T20:45:00Z",
    "completedAt": "2026-02-09T20:45:00Z"
  },
  "predictionData": {
    "dateRange": {
      "begin": "2025-02-09",
      "end": "2028-02-09",
      "yearsBack": 1,
      "yearsForward": 2
    },
    "tides": {
      "stationCount": 849,
      "stationsFailed": 0,
      "totalEvents": 3598964,
      "dbSizeBytes": 95234567,
      "dbSizeMB": 90.8,
      "storagePath": "07cgd/predictions/tides_07cgd.db.zip"
    },
    "currents": {
      "stationCount": 416,
      "stationsFailed": 0,
      "stationsWeakAndVariable": 12,
      "totalMonths": 14952,
      "dbSizeBytes": 48123456,
      "dbSizeMB": 45.9,
      "storagePath": "07cgd/predictions/currents_07cgd.db.zip"
    }
  }
}
```

### SQLite: Tides Database Schema

```sql
CREATE TABLE tides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stationId TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    type TEXT NOT NULL,  -- 'H' or 'L'
    height REAL NOT NULL,
    UNIQUE(stationId, date, time)
);

CREATE INDEX idx_tides_station ON tides(stationId);
CREATE INDEX idx_tides_date ON tides(date);
```

### SQLite: Currents Database Schema

```sql
CREATE TABLE currents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stationId TEXT NOT NULL,
    datetime TEXT NOT NULL,
    velocity REAL NOT NULL,
    direction REAL,  -- degrees, NULL for weak & variable
    UNIQUE(stationId, datetime)
);

CREATE INDEX idx_currents_station ON currents(stationId);
CREATE INDEX idx_currents_datetime ON currents(datetime);
```

## Troubleshooting

### Problem: 409 Conflict - Generation Already in Progress

**Cause:** Another process is currently generating predictions for this region.

**Solutions:**
1. Wait for the current job to complete (~60 min max)
2. Check if it's actually running: `./trigger-predictions.sh <region> status`
3. If stuck/crashed: `./trigger-predictions.sh <region> clear-lock`

### Problem: Memory Limit Exceeded

**Symptom:** Logs show "Memory limit of 8192 MiB exceeded"

**Solutions:**
1. This shouldn't happen with current settings (8GB + memory cleanup)
2. If it does, the job will fail and can be retried
3. Contact admin to increase memory limit

### Problem: Job Takes Forever / Timeout

**Cause:** 
- Region has many stations (07cgd, 17cgd, 01cgd)
- NOAA API is slow or rate-limiting

**Solutions:**
1. Jobs auto-timeout after 60 minutes
2. Rerun after timeout - atomic lock prevents duplicates
3. Consider running tides and currents separately: `GEN_TYPE=tides` then `GEN_TYPE=currents`

### Problem: Auth Token Expired

**Symptom:** HTTP 401 errors after ~60 minutes in queue script

**Cause:** Google Cloud auth tokens expire after 1 hour

**Solution:** Already fixed - queue script refreshes tokens before each request

### Problem: Duplicate Jobs Running

**Symptom:** Logs show same station being processed twice simultaneously

**Cause:** Race condition in lock acquisition (should be impossible with atomic transactions)

**Solutions:**
1. Cancel all running jobs
2. Verify Service has `concurrency=1`: `gcloud run services describe prediction-generator --region=us-central1`
3. Re-deploy Service if needed

### Problem: Can't Cancel Job

**Symptom:** `gcloud run jobs executions cancel` says "not running"

**Cause:** Job already completed or failed

**Solution:** 
1. Check status: `gcloud run jobs executions list --job=prediction-generator-job --region=us-central1`
2. If you need to stop an active generation, clear the lock: `./trigger-predictions.sh <region> clear-lock`

## Files & Directory Structure

```
cloud-functions/prediction-generator/
├── server.py                    # Main Flask app (Service endpoints)
├── job.py                       # Job wrapper (calls Service)
├── requirements.txt             # Python dependencies
├── Dockerfile                   # Service container
├── Dockerfile.job               # Job container
├── cloudbuild.yaml              # Service build config
├── cloudbuild-job.yaml          # Job build config
├── trigger-predictions.sh       # Helper script for single region
├── queue-all-regions.sh         # Automated queue for all regions
├── clear-lock.js                # (Deprecated) Manual lock clearing
└── README.md                    # This file
```

## API Endpoints

### POST /generate

**Trigger prediction generation**

Request:
```json
{
  "regionId": "07cgd",
  "type": "tides",
  "yearsBack": 1,
  "yearsForward": 2,
  "maxStations": 10
}
```

Response (200):
```json
{
  "status": "success",
  "regionId": "07cgd",
  "type": "tides",
  "tides": { "stationCount": 849, "totalEvents": 3598964 },
  "currents": { "stationCount": 0 },
  "tideDbSizeMB": 90.8,
  "durationSeconds": 2567.3
}
```

Response (409 Conflict):
```json
{
  "error": "Generation already in progress",
  "currentState": "fetching_tides",
  "startedAt": "2026-02-09T20:00:00Z",
  "elapsedSeconds": 1234.5,
  "message": "A fetching_tides job is already running for 07cgd. Started 20.6 minutes ago."
}
```

### GET /status?regionId={region}

**Check generation status**

Response:
```json
{
  "regionId": "07cgd",
  "predictionStatus": {
    "state": "complete",
    "message": "Prediction generation (tides) complete for 07cgd",
    "startedAt": "2026-02-09T20:00:00Z",
    "completedAt": "2026-02-09T20:45:00Z"
  },
  "predictionData": { /* ... */ },
  "predictionConfig": {
    "tideStationCount": 849,
    "currentStationCount": 416
  }
}
```

### POST /clear-lock

**Manually clear a stuck lock**

Request:
```json
{
  "regionId": "07cgd"
}
```

Response:
```json
{
  "success": true,
  "regionId": "07cgd",
  "message": "Lock cleared for 07cgd",
  "previousState": "fetching_tides",
  "newState": "failed"
}
```

## Deployment

### Deploy Service

```bash
cd cloud-functions/prediction-generator

# Build image
gcloud builds submit --tag gcr.io/xnautical-8a296/prediction-generator

# Deploy
gcloud run deploy prediction-generator \
  --image gcr.io/xnautical-8a296/prediction-generator \
  --region us-central1 \
  --memory=8Gi \
  --cpu=2 \
  --concurrency=1 \
  --min-instances=0 \
  --max-instances=1 \
  --timeout=3600 \
  --no-allow-unauthenticated
```

### Deploy Job

```bash
cd cloud-functions/prediction-generator

# Build image
gcloud builds submit --config=cloudbuild-job.yaml

# Create/update job
gcloud run jobs deploy prediction-generator-job \
  --image gcr.io/xnautical-8a296/prediction-generator-job \
  --region us-central1 \
  --memory=8Gi \
  --cpu=2 \
  --max-retries=0 \
  --task-timeout=3600
```

### Grant Permissions

```bash
# Allow Job to invoke Service
gcloud run services add-iam-policy-binding prediction-generator \
  --region=us-central1 \
  --member="serviceAccount:653355603694-compute@developer.gserviceaccount.com" \
  --role="roles/run.invoker"
```

## Performance Metrics

### Typical Timings (07cgd - Largest Region)

| Phase | Duration | Memory Usage |
|-------|----------|--------------|
| Lock Acquisition | <1s | Minimal |
| Fetch Tides (849 stations) | ~35 min | 2-3 GB |
| Build Tide Database | ~3 min | 4-5 GB |
| Upload Tide DB | ~30s | 3 GB |
| Fetch Currents (416 stations) | ~18 min | 2-3 GB |
| Build Current Database | ~2 min | 4-5 GB |
| Upload Current DB | ~20s | 2 GB |
| **Total** | **~60 min** | **Peak: 5 GB** |

### Costs (Estimated)

- **Cloud Run Service:** $0.10/hour × 1 hour × 8 regions = **~$0.80** per full run
- **Cloud Run Job:** $0.10/hour × 1 hour × 8 regions = **~$0.80** per full run
- **Cloud Storage:** $0.026/GB × ~5 GB total = **~$0.13/month**
- **Firestore:** Negligible (small documents, few writes)
- **Cloud Build:** $0.003/build-minute × 2 min/build = **~$0.01** per deployment

**Total per full regeneration: ~$1.60**

## Maintenance

### Updating Station Lists

Stations are discovered once and stored in Firestore. To update:

```bash
cd scripts
node discover-noaa-stations.js --apply
```

This queries NOAA's metadata API and updates `predictionConfig` for all regions.

### Regeneration Schedule

Predictions should be regenerated:
- **Monthly:** To keep data fresh (predictions extend 2 years forward)
- **After NOAA updates:** When NOAA adds/removes stations or updates constituents
- **On demand:** When users report missing/incorrect data

### Monitoring

Set up alerts for:
- Job failures (exit code != 0)
- Long-running jobs (>75 minutes)
- Memory usage >90%
- HTTP 5xx errors on Service

## Support

For issues or questions:
1. Check logs: `gcloud logging tail` (see Monitoring section)
2. Verify lock state: `./trigger-predictions.sh <region> status`
3. Clear stuck lock if needed: `./trigger-predictions.sh <region> clear-lock`
4. Review this documentation
5. Contact: jamessvoss@gmail.com

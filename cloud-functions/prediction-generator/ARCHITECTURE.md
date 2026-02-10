# Prediction Generator Architecture

## Overview

The prediction generation system is designed to fetch tide and current predictions from NOAA CO-OPS API, process them, and store them in Firebase Storage. The system is built on Google Cloud Run and uses a **separate job architecture** for tides and currents to avoid timeout limitations.

## Key Design Principles

### 1. **Separate Tides and Currents Jobs**

**Problem**: Running both tides and currents in a single execution can exceed the 1-hour Cloud Run timeout for large regions (800+ stations).

**Solution**: Tides and currents run as **completely independent Cloud Run Jobs**:
- Each job fetches data, exports metadata, compresses, and uploads
- No dependency or waiting between tides and currents
- Each job can take up to 1 hour without blocking the other
- Jobs can be run in parallel (though typically run sequentially)

**Implementation**:
- `server.py`: Core generation logic that supports `gen_type="tides"` or `gen_type="currents"` (NOT "all")
- `job.py`: Cloud Run Job entry point
- Jobs are executed via: `gcloud run jobs execute prediction-generator-job --update-env-vars REGION_ID=07cgd,GEN_TYPE=tides`

### 2. **Memory-Efficient SQLite Streaming**

**Problem**: Previous architecture held all prediction data in memory before building databases, causing "Memory limit exceeded" errors even at 8GB.

**Solution**: **Stream data directly to SQLite** as it's fetched from NOAA:

1. **Initialize empty databases** at the start of generation:
   ```python
   tide_db_path = init_tide_database(region_id, work_dir)
   current_db_path = init_current_database(region_id, work_dir)
   ```

2. **Write each station immediately** after fetching:
   ```python
   # Fetch station data
   all_predictions = await fetch_tide_predictions(...)
   
   # Write to database immediately
   write_station_to_tide_db(db_path, station_id, name, lat, lng, all_predictions)
   
   # Clear from memory
   all_predictions.clear()
   all_predictions = None
   ```

3. **Finalize databases** after all stations processed:
   ```python
   finalize_tide_database(db_path, station_count, event_count)
   finalize_current_database(db_path, station_count, weak_count, event_count)
   ```

**Benefits**:
- Memory usage remains constant regardless of region size
- No large data structures held in memory
- Can handle regions with 1000+ stations within 4GB memory limit

### 3. **Atomic Lock with Firestore**

**Problem**: Multiple job executions could start for the same region simultaneously.

**Solution**: Firestore-based atomic lock using `@firestore.transactional`:

```python
@firestore.transactional
def acquire_lock(transaction, doc_ref):
    snapshot = doc_ref.get(transaction=transaction)
    # Check if lock exists and is fresh
    # Acquire lock atomically
    transaction.update(doc_ref, {...})
```

**Features**:
- Heartbeat-based stale lock detection (locks expire after 10 minutes of inactivity)
- Prevents concurrent runs for the same region
- Automatically releases lock on completion or failure

## Cloud Run Architecture

### Service vs. Job

**Cloud Run Service** (`prediction-generator`):
- HTTP endpoints: `/generate`, `/status`, `/clear-lock`
- Used for status checks and manual lock clearing
- Can be called via HTTP (with authentication)
- **NOT used for actual prediction generation** (jobs are used instead)

**Cloud Run Job** (`prediction-generator-job`):
- Entry point: `job.py`
- Reads parameters from environment variables
- Calls `run_prediction_generation()` from `server.py`
- Cancellable at any time: `gcloud run jobs executions cancel`
- **Primary execution method** for prediction generation

**Configuration**:
- Memory: 8 GiB (streaming architecture keeps usage low)
- CPU: 2 vCPU
- Timeout: 3600s (1 hour)
- Concurrency: 1 (Service only; Jobs don't have concurrency)
- Max retries: 0 (Jobs only; manual re-execution if needed)

## Data Flow

```
1. Execute Job
   └─> job.py reads REGION_ID, GEN_TYPE from env vars
       └─> Calls run_prediction_generation(region_id, gen_type)

2. Acquire Lock
   └─> Firestore transaction checks and acquires atomic lock

3. Discover Stations
   └─> Fetch station list from NOAA based on region bounds

4. Initialize Database
   └─> Create empty SQLite database (tides_*.db or currents_*.db)

5. Fetch & Stream Data
   ├─> For each station:
   │   ├─> Fetch predictions from NOAA API
   │   ├─> Write station metadata and predictions to SQLite
   │   └─> Clear data from memory
   └─> (Repeat for all stations)

6. Finalize Database
   └─> Update metadata, run VACUUM/ANALYZE

7. Export JSON
   └─> Read station summaries from SQLite
   └─> Write tide_stations.json / current_stations.json
   └─> Write tides_raw.json / currents_raw.json

8. Compress & Upload
   └─> Compress database to .zip
   └─> Upload to Firebase Storage:
       • {region_id}/predictions/tides_{region_id}.db.zip
       • {region_id}/predictions/tide_stations.json
       • {region_id}/predictions/tides_raw.json

9. Release Lock
   └─> Update Firestore status to 'complete'
```

## Helper Scripts

### `trigger-predictions.sh`

Single-region trigger script (uses Cloud Run Jobs).

**Usage**:
```bash
./trigger-predictions.sh 07cgd tides              # Generate tides
./trigger-predictions.sh 07cgd currents           # Generate currents
./trigger-predictions.sh 07cgd tides 10           # Test with 10 stations
./trigger-predictions.sh 07cgd clear-lock         # Clear stale lock
```

**Note**: No "all" support - tides and currents must be run separately.

### `queue-all-regions.sh`

Automated batch processing of all regions (uses Cloud Run Jobs).

**Usage**:
```bash
./queue-all-regions.sh                            # Process all regions
./queue-all-regions.sh --skip 07cgd               # Skip regions already done
./queue-all-regions.sh --regions "01cgd 05cgd"    # Only specific regions
```

**Process**:
- Runs tides job, waits for completion
- Then runs currents job, waits for completion
- Moves to next region
- Ordered from smallest to largest by station count

## Testing

### Small Region Test (5 stations)

```bash
gcloud run jobs execute prediction-generator-job \
  --region us-central1 \
  --update-env-vars REGION_ID=14cgd,GEN_TYPE=tides,MAX_STATIONS=5
```

**Expected**: Completes in ~15 seconds, generates ~0.4 MB database

### Medium Region Test (65 stations)

```bash
./trigger-predictions.sh 14cgd tides   # Full region, no MAX_STATIONS limit
```

**Expected**: Completes in ~5-10 minutes

### Large Region Test (1196 stations)

```bash
./trigger-predictions.sh 01cgd tides   # Largest region
```

**Expected**: Completes in ~40-50 minutes, memory stays under 4 GB

## Error Handling

### Flask Context Error (Expected)

When `job.py` calls `run_prediction_generation()`, the generation completes successfully but raises a `RuntimeError: Working outside of application context` when trying to return a Flask response. This is **expected and handled** in `job.py`:

```python
except RuntimeError as e:
    if "application context" in str(e):
        logger.info('Job completed successfully (Flask context error is expected)')
        sys.exit(0)
```

### Common Issues

**Auth token expiration**: Tokens expire after 1 hour. Scripts automatically refresh tokens for each request.

**Memory exceeded**: Should no longer occur with streaming architecture. If it does, check:
- Is `all_predictions.clear()` being called after each station?
- Is data being written to SQLite immediately?

**Lock conflicts**: If a job crashes, the lock will auto-expire after 10 minutes. Or manually clear: `./trigger-predictions.sh <region> clear-lock`

## File Structure

```
cloud-functions/prediction-generator/
├── server.py                  # Core generation logic + Flask endpoints
├── job.py                     # Cloud Run Job entry point
├── Dockerfile                 # Service image
├── Dockerfile.job             # Job image
├── cloudbuild.yaml            # Service build config
├── cloudbuild-job.yaml        # Job build config
├── requirements.txt           # Python dependencies
├── trigger-predictions.sh     # Single-region trigger (Jobs)
├── queue-all-regions.sh       # Batch processing (Jobs)
├── DOCUMENTATION.md           # Detailed technical docs
└── ARCHITECTURE.md            # This file
```

## Deployment

### Build and Deploy Service

```bash
cd cloud-functions/prediction-generator
gcloud builds submit --config cloudbuild.yaml
gcloud run deploy prediction-generator \
  --image gcr.io/xnautical-8a296/prediction-generator:latest \
  --region us-central1 \
  --memory 8Gi \
  --cpu 2 \
  --concurrency 1 \
  --timeout 3600
```

### Build and Deploy Job

```bash
gcloud builds submit --config cloudbuild-job.yaml
gcloud run jobs update prediction-generator-job \
  --region us-central1 \
  --image gcr.io/xnautical-8a296/prediction-generator-job:latest
```

## Next Steps

1. Test with full 14cgd region (65 tide stations)
2. Test with large 01cgd region (1196 stations total)
3. Monitor memory usage during large region processing
4. Consider further optimizations if needed:
   - Increase CPU for faster processing
   - Adjust NOAA_CONCURRENT_CHUNKS for faster fetching
   - Optimize SQLite write batching

## Performance Metrics

| Region | Tide Stations | Current Stations | Est. Tide Time | Est. Current Time | Total Time |
|--------|---------------|------------------|----------------|-------------------|------------|
| 14cgd  | 35            | 30               | ~10 min        | ~8 min            | ~18 min    |
| 11cgd  | 57            | 41               | ~15 min        | ~12 min           | ~27 min    |
| 08cgd  | 83            | 61               | ~20 min        | ~18 min           | ~38 min    |
| 13cgd  | 73            | 75               | ~20 min        | ~20 min           | ~40 min    |
| 05cgd  | 226           | 75               | ~35 min        | ~20 min           | ~55 min    |
| 01cgd  | 1196          | 217              | ~45 min        | ~25 min           | ~70 min    |
| 17cgd  | 374           | 841              | ~40 min        | ~55 min           | ~95 min    |
| 07cgd  | 1150          | 405              | ~45 min        | ~35 min           | ~80 min    |

**Note**: Times are estimates based on NOAA API rate limiting and network conditions.

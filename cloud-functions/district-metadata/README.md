# Download Metadata Generation System

Replaces hardcoded size estimates with real file sizes from Firebase Storage.

## How It Works

1. **Pre-Generation**: After data is generated (charts, satellite, etc.), a metadata file is created
2. **Storage**: Metadata saved to `{districtId}/download-metadata.json` in Firebase Storage
3. **App Fetch**: App downloads one small JSON file (~10 KB) instead of querying Storage/Firestore multiple times
4. **Fast Display**: Download sizes are instantly available without any computation

## Architecture

```
Data Generation (Charts/Satellite/etc.)
          ↓
district-metadata Cloud Run Service
          ↓
Scans Firebase Storage for actual file sizes
          ↓
Generates download-metadata.json
          ↓
Saves to Storage: {districtId}/download-metadata.json
          ↓
Updates Firestore: districts/{districtId}.downloadPacks
          ↓
App fetches pre-generated metadata (fast!)
```

## Metadata File Format

```json
{
  "districtId": "17cgd",
  "name": "Alaska",
  "code": "17 CGD",
  "downloadPacks": [
    {
      "id": "charts-US4",
      "type": "charts",
      "band": "US4",
      "name": "Approach Charts (US4)",
      "description": "Scales 1:50,001 to 1:150,000 - Harbor approach",
      "storagePath": "17cgd/charts/US4.mbtiles.zip",
      "sizeBytes": 3567831326,
      "sizeMB": 3402.5,
      "required": true
    },
    ...
  ],
  "metadata": {
    "buoyCount": 145,
    "marineZoneCount": 23,
    "predictionSizes": {
      "tides": 24567890,
      "currents": 23456789
    },
    "predictionSizeMB": {
      "tides": 23.4,
      "currents": 22.4
    }
  },
  "totalSizeBytes": 10234567890,
  "totalSizeMB": 9760.5,
  "totalSizeGB": 9.53,
  "generatedAt": "2026-02-10T19:30:00Z"
}
```

## Deployment

### 1. Deploy the Service

```bash
cd cloud-functions/district-metadata
chmod +x deploy.sh
./deploy.sh
```

### 2. Generate Metadata for All Districts

```bash
# Update the SERVICE_URL in the script first
node scripts/generate-download-metadata.js
```

### 3. Generate for Specific District

```bash
node scripts/generate-download-metadata.js 17cgd
```

## Auto-Trigger from Data Generators

Add this to the end of each data generation script:

### ENC Converter (server.py)

```python
# After successful chart conversion
import requests

metadata_service_url = 'https://generate-district-metadata-XXXX.run.app/generateMetadata'
try:
    response = requests.post(metadata_service_url, json={'districtId': district_id})
    if response.ok:
        logger.info(f'Generated download metadata for {district_id}')
    else:
        logger.warning(f'Failed to generate metadata: {response.text}')
except Exception as e:
    logger.warning(f'Could not trigger metadata generation: {e}')
```

### Satellite Generator (server.py)

```python
# After successful satellite generation
import requests

metadata_service_url = 'https://generate-district-metadata-XXXX.run.app/generateMetadata'
try:
    response = requests.post(metadata_service_url, json={'districtId': region_id})
    logger.info(f'Triggered metadata regeneration for {region_id}')
except:
    logger.warning('Could not trigger metadata generation')
```

Same pattern for:
- Basemap generator
- Ocean generator
- Terrain generator
- Prediction generator

## App Implementation

The app automatically:
1. Tries to load `{districtId}/download-metadata.json` from Storage
2. Falls back to Firestore `districts/{districtId}` if metadata doesn't exist
3. Displays real sizes instantly (no estimates!)

See `src/services/chartPackService.ts` → `getDistrict()`

## Benefits

### Before (Hardcoded)
- ❌ Sizes are estimates/guesses
- ❌ Must update app code when files change
- ❌ Different estimates for satellite resolutions
- ❌ No way to know actual total size

### After (Pre-Generated)
- ✅ Real file sizes from Storage
- ✅ Automatically updated when files change
- ✅ Accurate total download size
- ✅ Includes metadata counts (buoys, zones)
- ✅ One fast fetch (~10 KB JSON)
- ✅ No computation in app

## Maintenance

### When to Regenerate Metadata

Regenerate after:
- Converting new charts
- Generating satellite imagery
- Creating basemaps
- Updating GNIS data
- Any file size changes

### Manual Regeneration

```bash
# For one district
node scripts/generate-download-metadata.js 17cgd

# For all districts
node scripts/generate-download-metadata.js
```

### Automatic Regeneration

The metadata service should be called at the end of each data generation Cloud Run service.

## Monitoring

Check logs:
```bash
gcloud run services logs read generate-district-metadata --region us-central1
```

Check metadata file:
```bash
gsutil cat gs://xnautical-8a296.firebasestorage.app/17cgd/download-metadata.json | jq
```

## Cost

- **Storage**: ~10 KB per district = negligible
- **Cloud Run**: Only runs on-demand when triggered = minimal
- **Bandwidth**: App downloads one small JSON file = ~10 KB
- **Total**: < $0.01/month for typical usage

## Troubleshooting

### Metadata file not found
- Check if it was generated: `gsutil ls gs://xnautical-8a296.firebasestorage.app/{districtId}/`
- Manually trigger: `node scripts/generate-download-metadata.js {districtId}`

### Wrong sizes displayed
- Regenerate metadata: `node scripts/generate-download-metadata.js {districtId}`
- Check Storage bucket name in deploy script

### Service not responding
- Check deployment: `gcloud run services describe generate-district-metadata --region us-central1`
- Check logs: `gcloud run services logs read generate-district-metadata --region us-central1`

# Firestore Collection Migration Guide

This guide explains how to copy the `marine-zones` and `buoys` collections from FishTopia to XNautical Firebase projects.

## Prerequisites

1. **Firebase Admin SDK** - Already installed in the project
2. **Service Account Keys** - You need JSON keys from both Firebase projects

## Step 1: Get Service Account Keys

### FishTopia Service Account:
1. Open [FishTopia Firebase Console](https://console.firebase.google.com/project/alaska-fishtopia/settings/serviceaccounts/adminsdk)
2. Click **"Generate new private key"**
3. Save the downloaded JSON file as: `scripts/fishtopia-service-account.json`

### XNautical Service Account:
1. Open XNautical Firebase Console → Project Settings → Service Accounts
2. Click **"Generate new private key"**
3. Save the downloaded JSON file as: `scripts/xnautical-service-account.json`

**⚠️ Security Note:** These files contain sensitive credentials. They are already in `.gitignore` and should NEVER be committed to git.

## Step 2: Run Migration Script

```bash
cd /Users/jvoss/Documents/XNautical
node scripts/copy-firestore-collections.js
```

The script will:
- Connect to both Firebase projects
- Copy all documents from `marine-zones` collection
- Copy all documents from `buoys` collection
- Show progress and summary

## Step 3: Verify Data

1. Open [XNautical Firebase Console](https://console.firebase.google.com)
2. Navigate to **Firestore Database**
3. Verify collections exist:
   - `marine-zones` - Should contain Alaska zone documents (PKZ722, etc.)
   - `buoys` - Should contain `catalog` document + individual buoy docs

## Step 4: Update Security Rules

Add these rules to your Firestore Security Rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // ... existing rules ...
    
    // Weather data - read access for authenticated users
    match /marine-zones/{zoneId} {
      allow read: if request.auth != null;
    }
    
    match /marine-forecasts/{zoneId} {
      allow read: if request.auth != null;
    }
    
    match /buoys/{buoyId} {
      allow read: if request.auth != null;
    }
  }
}
```

## Step 5: Deploy Cloud Functions

```bash
cd functions
npm install
firebase deploy --only functions
```

This deploys the functions that update marine forecasts and buoy data.

## Step 6: Test Weather Tab

1. Open XNautical app on your device/emulator
2. Navigate to **Weather** tab
3. Verify:
   - Zones view shows Alaska marine zones
   - Buoys view shows NOAA buoys
   - Wind view loads Windy.com map
   - Cams view loads FAA weather cameras

## Troubleshooting

### Error: Service account key not found
- Make sure JSON files are in the correct location: `scripts/fishtopia-service-account.json` and `scripts/xnautical-service-account.json`

### Error: Permission denied
- Verify service account keys have correct permissions
- Check that you downloaded the keys from the correct projects

### No documents found
- Verify FishTopia collections exist and have data
- Check that you're using the correct project ID

### App shows "No zones available"
- Verify data was copied successfully in Firebase Console
- Check Firestore Security Rules allow read access
- Verify app is authenticated

## Data Structure

### marine-zones
Each document contains:
- `id` - Zone ID (e.g., "PKZ722")
- `name` - Zone name
- `wfo` - Weather Forecast Office
- `centroid` - `{ lat: number, lon: number }`
- `geometryJson` - Stringified GeoJSON polygon

### buoys
- `catalog` document with `stations` array
- Individual buoy documents with:
  - `id`, `name`, `latitude`, `longitude`, `type`
  - `latestObservation` - Current data
  - `lastUpdated` - Timestamp

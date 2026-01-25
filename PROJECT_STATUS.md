# XNautical Project Status

**Last Updated:** January 25, 2026

## Project Overview

XNautical is a React Native mobile app for displaying NOAA Electronic Navigational Charts (ENC) with offline capability. It extracts S-57 chart data, stores it in Firebase, and allows users to download chart regions for offline use.

## Recent Changes (This Session)

### 1. Project Renamed from MapTest to XNautical
- Directory: `/Users/jvoss/Documents/XNautical`
- Package name: `com.xnautical.app` (both iOS and Android)
- GitHub repo still needs renaming: https://github.com/jamessvoss/MapTest → XNautical

### 2. New Firebase Project Created
- **Project ID:** `xnautical-8a296`
- **Project URL:** https://console.firebase.google.com/project/xnautical-8a296
- Apps registered:
  - Android: `com.xnautical.app`
  - iOS: `com.xnautical.app`
  - Web: (needs web appId added to .env)

### 3. Firebase Config Files (gitignored, stored locally)
- `/Users/jvoss/Documents/XNautical/google-services.json` - Android config
- `/Users/jvoss/Documents/XNautical/GoogleService-Info.plist` - iOS config
- `/Users/jvoss/Documents/XNautical/google-services-webapp.json` - Additional Android config

### 4. Security Fix Applied
- Firebase credentials moved from hardcoded values to `.env` file
- Old Alaska Fishtopia API key was exposed on GitHub (should be regenerated there)

### 5. Sounding Display Improved
- Implemented SCAMIN-based progressive disclosure instead of RCID-based filtering
- Soundings now appear based on their intended display scale, not random sampling

### 6. Static Chart Viewer Removed
- Deleted `ChartViewerStatic.native.tsx` and `ChartViewer.native.tsx`
- App now uses only `DynamicChartViewer.native.tsx` for native platforms

## Outstanding Tasks

### Immediate (Before Running App)

1. **Get Web App ID from Firebase Console**
   - Go to Firebase Console > Project Settings > Your Apps > Web app
   - Copy the `appId` value
   - Update `.env`: `EXPO_PUBLIC_FIREBASE_APP_ID=<your_web_app_id>`

2. **Regenerate Native Projects**
   ```bash
   cd /Users/jvoss/Documents/XNautical
   npx expo prebuild --clean
   npx expo run:android  # or npx expo run:ios
   ```

3. **Rename GitHub Repository**
   - Go to https://github.com/jamessvoss/MapTest/settings
   - Change repository name to "XNautical"
   - Update local remote:
     ```bash
     git remote set-url origin https://github.com/jamessvoss/XNautical.git
     ```

### Firebase Setup Required

1. **Enable Authentication**
   - Go to Firebase Console > Authentication > Sign-in method
   - Enable Email/Password authentication

2. **Set Up Firestore**
   - Go to Firebase Console > Firestore Database
   - Create database (start in test mode or configure rules)
   - Expected collections: `charts`, `regions`

3. **Set Up Storage**
   - Go to Firebase Console > Storage
   - Create default bucket
   - Configure rules for authenticated access

4. **Deploy Cloud Run Service (Optional)**
   - The chart processing service may need redeployment to new project
   - Previous service was in Alaska Fishtopia project

## Architecture Overview

```
XNautical/
├── src/
│   ├── components/
│   │   └── DynamicChartViewer.native.tsx  # Main map viewer
│   ├── screens/
│   │   ├── LoginScreen.tsx                 # Firebase auth
│   │   ├── MapSelectionScreen.tsx          # Chart download UI
│   │   └── SettingsScreen.tsx
│   ├── services/
│   │   ├── chartService.ts                 # Firebase data fetching
│   │   ├── chartCacheService.ts            # Local storage
│   │   └── chartLoader.ts                  # GeoJSON loading
│   └── config/
│       └── firebase.ts                     # Firebase initialization
├── app.json                                # Expo config
├── .env                                    # API keys (gitignored)
└── .env.example                            # Template for .env
```

## Key Technologies

- **React Native + Expo** - Cross-platform mobile framework
- **Mapbox GL** (`@rnmapbox/maps`) - Map rendering
- **Firebase** - Auth, Firestore, Storage
- **S-57/S-52** - NOAA chart format and symbology standards

## Data Flow

1. **Chart Processing** (Cloud Run - needs setup in new project)
   - Downloads charts from NOAA
   - Extracts S-57 features to GeoJSON
   - Uploads compressed `.json.gz` files to Firebase Storage
   - Stores metadata in Firestore

2. **Mobile App**
   - User authenticates via Firebase Auth
   - User selects chart regions on map interface
   - App downloads GeoJSON files from Firebase Storage
   - Stores locally for offline use
   - Renders with Mapbox using S-52 symbology

## Environment Variables (.env)

```
# Mapbox
EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=<mapbox_public_token>
RNMAPBOX_MAPS_DOWNLOAD_TOKEN=<mapbox_secret_token>

# Firebase (XNautical project)
EXPO_PUBLIC_FIREBASE_API_KEY=AIzaSyC41D83BdBdl4jLR0pu-GA64hhWukoTUIk
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=xnautical-8a296.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=xnautical-8a296
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=xnautical-8a296.firebasestorage.app
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=653355603694
EXPO_PUBLIC_FIREBASE_APP_ID=<needs_web_app_id>
```

## Chart Features Implemented

- Depth areas (DEPARE) with color shading
- Depth contours (DEPCNT)
- Soundings (SOUNDG) with SCAMIN-based progressive disclosure
- Navigation lights with sector arcs
- Buoys and beacons
- Landmarks
- Wrecks, rocks, obstructions
- Submarine cables
- Shoreline constructions
- Sea area names
- Seabed composition

## Notes for Next Session

1. The app was previously using Alaska Fishtopia's Firebase - now switching to dedicated XNautical project
2. Chart data in Alaska Fishtopia's storage may need to be migrated or re-processed
3. Cloud Run chart processor service needs to be deployed to new project
4. User authentication will need new accounts in XNautical Firebase project

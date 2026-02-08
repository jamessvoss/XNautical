#!/usr/bin/env node
/**
 * Populate Firestore `regions` collection with all configuration data.
 *
 * This creates the single source of truth for:
 *   - App UI (region selector, download panel)
 *   - satellite-generator Cloud Run service
 *   - enc-converter Cloud Run service
 *   - enc-downloader Cloud Run service
 *
 * Usage:
 *   node scripts/populate-region-config.js
 *   node scripts/populate-region-config.js --dry-run    # preview without writing
 *
 * Firestore path: regions/{regionId}  (e.g., regions/11cgd)
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin with service account
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.resolve(__dirname, '..', 'xnautical-service-account.json');

let credential;
try {
  const serviceAccount = require(serviceAccountPath);
  credential = admin.credential.cert(serviceAccount);
} catch (e) {
  console.error(`Could not load service account from: ${serviceAccountPath}`);
  console.error('Place xnautical-service-account.json in the project root,');
  console.error('or set GOOGLE_APPLICATION_CREDENTIALS env var.');
  process.exit(1);
}

admin.initializeApp({
  credential,
  storageBucket: 'xnautical-8a296.firebasestorage.app',
});

const db = admin.firestore();
const dryRun = process.argv.includes('--dry-run');

// ============================================================================
// Region Configuration Data
// ============================================================================

const regions = [
  {
    regionId: '17cgd',
    appId: 'arctic',
    name: 'Arctic',
    description: 'Alaska & Arctic',
    formerDistrict: 17,
    formerDistrictLabel: '17 CGD',
    color: '#06b6d4',
    status: 'converted',

    // App display
    center: { lat: 62.0, lon: -153.0 },
    mapBounds: { west: -180, south: 48, east: -130, north: 72 },

    // Cloud function: satellite tile generation bounds
    satelliteBounds: [
      { west: -180, south: 50, east: -129, north: 72 },
      { west: 170, south: 50, east: 180, north: 65 },
    ],

    // Cloud function: satellite generation config
    satelliteConfig: {
      bufferNm: 25,
      coastalFilterMinZoom: 6,
      resolutions: {
        low:    { minZoom: 0, maxZoom: 5,  filename: 'satellite-low.mbtiles' },
        medium: { minZoom: 0, maxZoom: 9,  filename: 'satellite-medium.mbtiles' },
        high:   { minZoom: 0, maxZoom: 14, filename: 'satellite-high.mbtiles' },
      },
    },

    // Cloud function: ENC conversion config
    encConfig: {
      scaleZoomMapping: {
        US1: { minZoom: 0, maxZoom: 8, displayFrom: 0, displayTo: 9 },
        US2: { minZoom: 0, maxZoom: 10, displayFrom: 8, displayTo: 11 },
        US3: { minZoom: 4, maxZoom: 13, displayFrom: 10, displayTo: 13 },
        US4: { minZoom: 6, maxZoom: 16, displayFrom: 12, displayTo: 15 },
        US5: { minZoom: 8, maxZoom: 18, displayFrom: 14, displayTo: 17 },
        US6: { minZoom: 6, maxZoom: 18, displayFrom: 16, displayTo: 22 },
      },
      noaaSourceUrl: 'https://charts.noaa.gov/ENCs/ENCProdCat_17_Coast_Guard_District.xml',
    },

    // Download size estimates (MB) - updated after actual generation
    estimatedSizes: {
      chartsMB: 350,
      satelliteLowMB: 30,
      satelliteMediumMB: 120,
      satelliteHighMB: 800,
    },

    // Pre-extracted US1 chart bounding boxes (for app map display)
    us1Charts: [
      { name: 'US1AK90M', west: -179.527153, south: 64.348743, east: -133.484583, north: 74.580426 },
      { name: 'US1BS01M', west: -180.0, south: 48.059052, east: -160.401899, north: 61.169882 },
      { name: 'US1BS02M', west: 165.193533, south: 48.386984, east: 180.0, north: 60.950538 },
      { name: 'US1BS03M', west: -180.0, south: 58.284858, east: -159.56905, north: 68.180998 },
      { name: 'US1BS04M', west: 166.335469, south: 58.297091, east: 180.0, north: 68.149012 },
      { name: 'US1EEZ1M', west: 138.835426, south: 8.953691, east: 173.227561, north: 24.761043 },
      { name: 'US1GLBDA', west: -180.0, south: 38.4, east: -153.6, north: 62.4 },
      { name: 'US1GLBDC', west: -153.6, south: 38.4, east: -134.4, north: 62.4 },
      { name: 'US1GLBDD', west: -134.4, south: 38.4, east: -116.333333, north: 61.25 },
      { name: 'US1GLBDS', west: 165.666667, south: 48.5, east: 180.0, north: 62.4 },
      { name: 'US1GLBEA', west: -180.0, south: 62.4, east: -134.00015, north: 73.99999 },
      { name: 'US1GLBES', west: 166.75, south: 62.4, east: 180.0, north: 68.0 },
      { name: 'US1PO02M', west: -162.57242, south: 11.407873, east: -113.555523, north: 67.801099 },
      { name: 'US1WC01M', west: -138.741336, south: 30.71236, east: -115.317922, north: 56.201147 },
      { name: 'US1WC04M', west: -166.181536, south: 49.186154, east: -131.988681, north: 61.535556 },
      { name: 'US1WC07M', west: -180.0, south: 17.540943, east: -116.045281, north: 60.691936 },
    ],

    // Firebase Storage paths
    storagePaths: {
      encSource: '17cgd/enc-source/',
      charts: '17cgd/charts/',
      satellite: '17cgd/satellite/',
      basemap: '17cgd/basemap/',
      ocean: '17cgd/ocean/',
      terrain: '17cgd/terrain/',
      predictions: '17cgd/predictions/',
    },
  },

  {
    regionId: '14cgd',
    appId: 'oceania',
    name: 'Oceania',
    description: 'Hawaii & Pacific Islands',
    formerDistrict: 14,
    formerDistrictLabel: '14 CGD',
    color: '#a855f7',
    status: 'pending',

    center: { lat: 21.0, lon: -157.5 },
    mapBounds: { west: -162, south: 17, east: -153, north: 23 },

    satelliteBounds: [
      { west: -162, south: 17, east: -153, north: 24 },
    ],

    satelliteConfig: {
      bufferNm: 25,
      coastalFilterMinZoom: 6,
      resolutions: {
        low:    { minZoom: 0, maxZoom: 5,  filename: 'satellite-low.mbtiles' },
        medium: { minZoom: 0, maxZoom: 9,  filename: 'satellite-medium.mbtiles' },
        high:   { minZoom: 0, maxZoom: 14, filename: 'satellite-high.mbtiles' },
      },
    },

    encConfig: {
      scaleZoomMapping: {
        US1: { minZoom: 0, maxZoom: 8, displayFrom: 0, displayTo: 9 },
        US2: { minZoom: 0, maxZoom: 10, displayFrom: 8, displayTo: 11 },
        US3: { minZoom: 4, maxZoom: 13, displayFrom: 10, displayTo: 13 },
        US4: { minZoom: 6, maxZoom: 16, displayFrom: 12, displayTo: 15 },
        US5: { minZoom: 8, maxZoom: 18, displayFrom: 14, displayTo: 17 },
        US6: { minZoom: 6, maxZoom: 18, displayFrom: 16, displayTo: 22 },
      },
      noaaSourceUrl: 'https://charts.noaa.gov/ENCs/ENCProdCat_14_Coast_Guard_District.xml',
    },

    estimatedSizes: {
      chartsMB: 140,
      satelliteLowMB: 30,
      satelliteMediumMB: 120,
      satelliteHighMB: 800,
    },

    us1Charts: [],

    storagePaths: {
      encSource: '14cgd/enc-source/',
      charts: '14cgd/charts/',
      satellite: '14cgd/satellite/',
      basemap: '14cgd/basemap/',
      ocean: '14cgd/ocean/',
      terrain: '14cgd/terrain/',
      predictions: '14cgd/predictions/',
    },
  },

  {
    regionId: '13cgd',
    appId: 'northwest',
    name: 'Northwest',
    description: 'WA, OR, Northern CA',
    formerDistrict: 13,
    formerDistrictLabel: '13 CGD',
    color: '#22c55e',
    status: 'pending',

    center: { lat: 43.0, lon: -124.5 },
    mapBounds: { west: -128, south: 34, east: -120, north: 49 },

    satelliteBounds: [
      { west: -130, south: 33, east: -119, north: 50 },
    ],

    satelliteConfig: {
      bufferNm: 25,
      coastalFilterMinZoom: 6,
      resolutions: {
        low:    { minZoom: 0, maxZoom: 5,  filename: 'satellite-low.mbtiles' },
        medium: { minZoom: 0, maxZoom: 9,  filename: 'satellite-medium.mbtiles' },
        high:   { minZoom: 0, maxZoom: 14, filename: 'satellite-high.mbtiles' },
      },
    },

    encConfig: {
      scaleZoomMapping: {
        US1: { minZoom: 0, maxZoom: 8, displayFrom: 0, displayTo: 9 },
        US2: { minZoom: 0, maxZoom: 10, displayFrom: 8, displayTo: 11 },
        US3: { minZoom: 4, maxZoom: 13, displayFrom: 10, displayTo: 13 },
        US4: { minZoom: 6, maxZoom: 16, displayFrom: 12, displayTo: 15 },
        US5: { minZoom: 8, maxZoom: 18, displayFrom: 14, displayTo: 17 },
        US6: { minZoom: 6, maxZoom: 18, displayFrom: 16, displayTo: 22 },
      },
      noaaSourceUrl: 'https://charts.noaa.gov/ENCs/ENCProdCat_13_Coast_Guard_District.xml',
    },

    estimatedSizes: {
      chartsMB: 150,
      satelliteLowMB: 30,
      satelliteMediumMB: 120,
      satelliteHighMB: 800,
    },

    us1Charts: [],

    storagePaths: {
      encSource: '13cgd/enc-source/',
      charts: '13cgd/charts/',
      satellite: '13cgd/satellite/',
      basemap: '13cgd/basemap/',
      ocean: '13cgd/ocean/',
      terrain: '13cgd/terrain/',
      predictions: '13cgd/predictions/',
    },
  },

  {
    regionId: '11cgd',
    appId: 'southwest',
    name: 'Southwest',
    description: 'Southern CA, AZ, NV',
    formerDistrict: 11,
    formerDistrictLabel: '11 CGD',
    color: '#eab308',
    status: 'converted',

    center: { lat: 33.5, lon: -119.0 },
    mapBounds: { west: -125, south: 30, east: -115, north: 38 },

    satelliteBounds: [
      { west: -126, south: 30, east: -114, north: 39 },
    ],

    satelliteConfig: {
      bufferNm: 25,
      coastalFilterMinZoom: 6,
      resolutions: {
        low:    { minZoom: 0, maxZoom: 5,  filename: 'satellite-low.mbtiles' },
        medium: { minZoom: 0, maxZoom: 9,  filename: 'satellite-medium.mbtiles' },
        high:   { minZoom: 0, maxZoom: 14, filename: 'satellite-high.mbtiles' },
      },
    },

    encConfig: {
      scaleZoomMapping: {
        US1: { minZoom: 0, maxZoom: 8, displayFrom: 0, displayTo: 9 },
        US2: { minZoom: 0, maxZoom: 10, displayFrom: 8, displayTo: 11 },
        US3: { minZoom: 4, maxZoom: 13, displayFrom: 10, displayTo: 13 },
        US4: { minZoom: 6, maxZoom: 16, displayFrom: 12, displayTo: 15 },
        US5: { minZoom: 8, maxZoom: 18, displayFrom: 14, displayTo: 17 },
        US6: { minZoom: 6, maxZoom: 18, displayFrom: 16, displayTo: 22 },
      },
      noaaSourceUrl: 'https://charts.noaa.gov/ENCs/ENCProdCat_11_Coast_Guard_District.xml',
    },

    estimatedSizes: {
      chartsMB: 135,
      satelliteLowMB: 30,
      satelliteMediumMB: 120,
      satelliteHighMB: 800,
    },

    us1Charts: [
      { name: 'US1GLBDC', west: -153.6, south: 38.4, east: -134.4, north: 62.4 },
      { name: 'US1GLBDD', west: -134.4, south: 38.4, east: -116.333333, north: 61.25 },
      { name: 'US1PO02M', west: -162.57242, south: 11.407873, east: -113.555523, north: 67.801099 },
      { name: 'US1WC01M', west: -138.741336, south: 30.71236, east: -115.317922, north: 56.201147 },
      { name: 'US1WC07M', west: -180.0, south: 17.540943, east: -116.045281, north: 60.691936 },
    ],

    storagePaths: {
      encSource: '11cgd/enc-source/',
      charts: '11cgd/charts/',
      satellite: '11cgd/satellite/',
      basemap: '11cgd/basemap/',
      ocean: '11cgd/ocean/',
      terrain: '11cgd/terrain/',
      predictions: '11cgd/predictions/',
    },
  },

  {
    regionId: '08cgd',
    appId: 'heartland',
    name: 'Heartland',
    description: 'Gulf Coast & Inland Rivers',
    formerDistrict: 8,
    formerDistrictLabel: '8 CGD',
    color: '#f97316',
    status: 'pending',

    center: { lat: 28.0, lon: -91.0 },
    mapBounds: { west: -98, south: 24, east: -82, north: 32 },

    satelliteBounds: [
      { west: -100, south: 23, east: -80, north: 33 },
    ],

    satelliteConfig: {
      bufferNm: 25,
      coastalFilterMinZoom: 6,
      resolutions: {
        low:    { minZoom: 0, maxZoom: 5,  filename: 'satellite-low.mbtiles' },
        medium: { minZoom: 0, maxZoom: 9,  filename: 'satellite-medium.mbtiles' },
        high:   { minZoom: 0, maxZoom: 14, filename: 'satellite-high.mbtiles' },
      },
    },

    encConfig: {
      scaleZoomMapping: {
        US1: { minZoom: 0, maxZoom: 8, displayFrom: 0, displayTo: 9 },
        US2: { minZoom: 0, maxZoom: 10, displayFrom: 8, displayTo: 11 },
        US3: { minZoom: 4, maxZoom: 13, displayFrom: 10, displayTo: 13 },
        US4: { minZoom: 6, maxZoom: 16, displayFrom: 12, displayTo: 15 },
        US5: { minZoom: 8, maxZoom: 18, displayFrom: 14, displayTo: 17 },
        US6: { minZoom: 6, maxZoom: 18, displayFrom: 16, displayTo: 22 },
      },
      noaaSourceUrl: 'https://charts.noaa.gov/ENCs/ENCProdCat_8_Coast_Guard_District.xml',
    },

    estimatedSizes: {
      chartsMB: 190,
      satelliteLowMB: 30,
      satelliteMediumMB: 120,
      satelliteHighMB: 800,
    },

    us1Charts: [
      { name: 'US1GC09M', west: -98.453131, south: 17.373274, east: -75.654643, north: 34.044929 },
    ],

    storagePaths: {
      encSource: '08cgd/enc-source/',
      charts: '08cgd/charts/',
      satellite: '08cgd/satellite/',
      basemap: '08cgd/basemap/',
      ocean: '08cgd/ocean/',
      terrain: '08cgd/terrain/',
      predictions: '08cgd/predictions/',
    },
  },

  {
    regionId: '09cgd',
    appId: 'great_lakes',
    name: 'Great Lakes',
    description: 'Great Lakes States',
    formerDistrict: 9,
    formerDistrictLabel: '9 CGD',
    color: '#3b82f6',
    status: 'pending',

    center: { lat: 44.0, lon: -84.0 },
    mapBounds: { west: -93, south: 41, east: -76, north: 49 },

    satelliteBounds: [
      { west: -94, south: 40, east: -75, north: 50 },
    ],

    satelliteConfig: {
      bufferNm: 25,
      coastalFilterMinZoom: 6,
      resolutions: {
        low:    { minZoom: 0, maxZoom: 5,  filename: 'satellite-low.mbtiles' },
        medium: { minZoom: 0, maxZoom: 9,  filename: 'satellite-medium.mbtiles' },
        high:   { minZoom: 0, maxZoom: 14, filename: 'satellite-high.mbtiles' },
      },
    },

    encConfig: {
      scaleZoomMapping: {
        US1: { minZoom: 0, maxZoom: 8, displayFrom: 0, displayTo: 9 },
        US2: { minZoom: 0, maxZoom: 10, displayFrom: 8, displayTo: 11 },
        US3: { minZoom: 4, maxZoom: 13, displayFrom: 10, displayTo: 13 },
        US4: { minZoom: 6, maxZoom: 16, displayFrom: 12, displayTo: 15 },
        US5: { minZoom: 8, maxZoom: 18, displayFrom: 14, displayTo: 17 },
        US6: { minZoom: 6, maxZoom: 18, displayFrom: 16, displayTo: 22 },
      },
      noaaSourceUrl: 'https://charts.noaa.gov/ENCs/ENCProdCat_9_Coast_Guard_District.xml',
    },

    estimatedSizes: {
      chartsMB: 150,
      satelliteLowMB: 30,
      satelliteMediumMB: 120,
      satelliteHighMB: 800,
    },

    us1Charts: [],

    storagePaths: {
      encSource: '09cgd/enc-source/',
      charts: '09cgd/charts/',
      satellite: '09cgd/satellite/',
      basemap: '09cgd/basemap/',
      ocean: '09cgd/ocean/',
      terrain: '09cgd/terrain/',
      predictions: '09cgd/predictions/',
    },
  },

  {
    regionId: '01cgd',
    appId: 'northeast',
    name: 'Northeast',
    description: 'New England',
    formerDistrict: 1,
    formerDistrictLabel: '1 CGD',
    color: '#ef4444',
    status: 'pending',

    center: { lat: 42.0, lon: -70.0 },
    mapBounds: { west: -74, south: 40, east: -66, north: 48 },

    satelliteBounds: [
      { west: -76, south: 39, east: -65, north: 48 },
    ],

    satelliteConfig: {
      bufferNm: 25,
      coastalFilterMinZoom: 6,
      resolutions: {
        low:    { minZoom: 0, maxZoom: 5,  filename: 'satellite-low.mbtiles' },
        medium: { minZoom: 0, maxZoom: 9,  filename: 'satellite-medium.mbtiles' },
        high:   { minZoom: 0, maxZoom: 14, filename: 'satellite-high.mbtiles' },
      },
    },

    encConfig: {
      scaleZoomMapping: {
        US1: { minZoom: 0, maxZoom: 8, displayFrom: 0, displayTo: 9 },
        US2: { minZoom: 0, maxZoom: 10, displayFrom: 8, displayTo: 11 },
        US3: { minZoom: 4, maxZoom: 13, displayFrom: 10, displayTo: 13 },
        US4: { minZoom: 6, maxZoom: 16, displayFrom: 12, displayTo: 15 },
        US5: { minZoom: 8, maxZoom: 18, displayFrom: 14, displayTo: 17 },
        US6: { minZoom: 6, maxZoom: 18, displayFrom: 16, displayTo: 22 },
      },
      noaaSourceUrl: 'https://charts.noaa.gov/ENCs/ENCProdCat_1_Coast_Guard_District.xml',
    },

    estimatedSizes: {
      chartsMB: 190,
      satelliteLowMB: 30,
      satelliteMediumMB: 120,
      satelliteHighMB: 800,
    },

    us1Charts: [],

    storagePaths: {
      encSource: '01cgd/enc-source/',
      charts: '01cgd/charts/',
      satellite: '01cgd/satellite/',
      basemap: '01cgd/basemap/',
      ocean: '01cgd/ocean/',
      terrain: '01cgd/terrain/',
      predictions: '01cgd/predictions/',
    },
  },

  {
    regionId: '05cgd',
    appId: 'east',
    name: 'East',
    description: 'Mid-Atlantic',
    formerDistrict: 5,
    formerDistrictLabel: '5 CGD',
    color: '#8b5cf6',
    status: 'pending',

    center: { lat: 37.5, lon: -75.5 },
    mapBounds: { west: -80, south: 33, east: -73, north: 41 },

    satelliteBounds: [
      { west: -82, south: 32, east: -72, north: 42 },
    ],

    satelliteConfig: {
      bufferNm: 25,
      coastalFilterMinZoom: 6,
      resolutions: {
        low:    { minZoom: 0, maxZoom: 5,  filename: 'satellite-low.mbtiles' },
        medium: { minZoom: 0, maxZoom: 9,  filename: 'satellite-medium.mbtiles' },
        high:   { minZoom: 0, maxZoom: 14, filename: 'satellite-high.mbtiles' },
      },
    },

    encConfig: {
      scaleZoomMapping: {
        US1: { minZoom: 0, maxZoom: 8, displayFrom: 0, displayTo: 9 },
        US2: { minZoom: 0, maxZoom: 10, displayFrom: 8, displayTo: 11 },
        US3: { minZoom: 4, maxZoom: 13, displayFrom: 10, displayTo: 13 },
        US4: { minZoom: 6, maxZoom: 16, displayFrom: 12, displayTo: 15 },
        US5: { minZoom: 8, maxZoom: 18, displayFrom: 14, displayTo: 17 },
        US6: { minZoom: 6, maxZoom: 18, displayFrom: 16, displayTo: 22 },
      },
      noaaSourceUrl: 'https://charts.noaa.gov/ENCs/ENCProdCat_5_Coast_Guard_District.xml',
    },

    estimatedSizes: {
      chartsMB: 175,
      satelliteLowMB: 30,
      satelliteMediumMB: 120,
      satelliteHighMB: 800,
    },

    us1Charts: [],

    storagePaths: {
      encSource: '05cgd/enc-source/',
      charts: '05cgd/charts/',
      satellite: '05cgd/satellite/',
      basemap: '05cgd/basemap/',
      ocean: '05cgd/ocean/',
      terrain: '05cgd/terrain/',
      predictions: '05cgd/predictions/',
    },
  },

  {
    regionId: '07cgd',
    appId: 'southeast',
    name: 'Southeast',
    description: 'SE Coast & Caribbean',
    formerDistrict: 7,
    formerDistrictLabel: '7 CGD',
    color: '#ec4899',
    status: 'pending',

    center: { lat: 27.0, lon: -78.0 },
    mapBounds: { west: -84, south: 24, east: -64, north: 34 },

    satelliteBounds: [
      { west: -85, south: 23, east: -63, north: 35 },
    ],

    satelliteConfig: {
      bufferNm: 25,
      coastalFilterMinZoom: 6,
      resolutions: {
        low:    { minZoom: 0, maxZoom: 5,  filename: 'satellite-low.mbtiles' },
        medium: { minZoom: 0, maxZoom: 9,  filename: 'satellite-medium.mbtiles' },
        high:   { minZoom: 0, maxZoom: 14, filename: 'satellite-high.mbtiles' },
      },
    },

    encConfig: {
      scaleZoomMapping: {
        US1: { minZoom: 0, maxZoom: 8, displayFrom: 0, displayTo: 9 },
        US2: { minZoom: 0, maxZoom: 10, displayFrom: 8, displayTo: 11 },
        US3: { minZoom: 4, maxZoom: 13, displayFrom: 10, displayTo: 13 },
        US4: { minZoom: 6, maxZoom: 16, displayFrom: 12, displayTo: 15 },
        US5: { minZoom: 8, maxZoom: 18, displayFrom: 14, displayTo: 17 },
        US6: { minZoom: 6, maxZoom: 18, displayFrom: 16, displayTo: 22 },
      },
      noaaSourceUrl: 'https://charts.noaa.gov/ENCs/ENCProdCat_7_Coast_Guard_District.xml',
    },

    estimatedSizes: {
      chartsMB: 180,
      satelliteLowMB: 30,
      satelliteMediumMB: 120,
      satelliteHighMB: 800,
    },

    us1Charts: [],

    storagePaths: {
      encSource: '07cgd/enc-source/',
      charts: '07cgd/charts/',
      satellite: '07cgd/satellite/',
      basemap: '07cgd/basemap/',
      ocean: '07cgd/ocean/',
      terrain: '07cgd/terrain/',
      predictions: '07cgd/predictions/',
    },
  },
];


// ============================================================================
// Populate Firestore
// ============================================================================

async function main() {
  console.log(`\n=== Populate Firestore regions collection ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log(`Regions: ${regions.length}\n`);

  for (const region of regions) {
    const docId = region.regionId;
    const docRef = db.collection('regions').doc(docId);

    // Add metadata timestamps
    const doc = {
      ...region,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (dryRun) {
      console.log(`[DRY RUN] Would write regions/${docId}:`);
      console.log(`  name: ${region.name}`);
      console.log(`  description: ${region.description}`);
      console.log(`  status: ${region.status}`);
      console.log(`  satelliteBounds: ${region.satelliteBounds.length} box(es)`);
      console.log(`  us1Charts: ${region.us1Charts.length} charts`);
      console.log(`  estimatedSizes: charts=${region.estimatedSizes.chartsMB}MB`);
      console.log('');
    } else {
      await docRef.set(doc, { merge: true });
      console.log(`  Written: regions/${docId} (${region.name})`);
    }
  }

  console.log(`\n${dryRun ? 'Dry run complete.' : 'All regions written to Firestore.'}`);
  console.log(`Collection: regions/`);
  console.log(`Documents: ${regions.map(r => r.regionId).join(', ')}\n`);

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

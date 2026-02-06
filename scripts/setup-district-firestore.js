#!/usr/bin/env node
/**
 * setup-district-firestore.js
 * 
 * Creates or updates the Firestore district document with download pack metadata.
 * This allows the app's Downloads modal to show what's available for download.
 * 
 * Usage:
 *   node scripts/setup-district-firestore.js
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin with service account
const serviceAccountPath = path.join(__dirname, 'service-accounts', 'xnautical-key.json');
admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
  storageBucket: 'xnautical-8a296.firebasestorage.app',
});

const db = admin.firestore();

// District 17 - Alaska configuration
const district17cgd = {
  // Basic info
  code: '17 CGD',
  name: 'Alaska',
  timezone: 'America/Anchorage',
  
  // Map defaults
  defaultCenter: [-152.0, 61.0], // [lng, lat]
  bounds: {
    west: -180.0,
    east: -130.0,
    south: 51.0,
    north: 71.5,
  },
  
  // States included
  states: ['AK'],
  
  // Download packs with actual sizes from compressed files
  downloadPacks: [
    // Chart Scale Packs
    {
      id: 'charts-US1',
      type: 'charts',
      band: 'US1',
      name: 'Overview Charts (US1)',
      description: 'Scales 1:1,500,001 and smaller - Ocean planning',
      storagePath: '17cgd/charts/US1.mbtiles.zip',
      sizeBytes: 28831178,
      required: false,
    },
    {
      id: 'charts-US2',
      type: 'charts',
      band: 'US2',
      name: 'General Charts (US2)',
      description: 'Scales 1:600,001 to 1:1,500,000 - Offshore navigation',
      storagePath: '17cgd/charts/US2.mbtiles.zip',
      sizeBytes: 63200406,
      required: false,
    },
    {
      id: 'charts-US3',
      type: 'charts',
      band: 'US3',
      name: 'Coastal Charts (US3)',
      description: 'Scales 1:150,001 to 1:600,000 - Coastal approach',
      storagePath: '17cgd/charts/US3.mbtiles.zip',
      sizeBytes: 292318680,
      required: false,
    },
    {
      id: 'charts-US4',
      type: 'charts',
      band: 'US4',
      name: 'Approach Charts (US4)',
      description: 'Scales 1:50,001 to 1:150,000 - Harbor approach',
      storagePath: '17cgd/charts/US4.mbtiles.zip',
      sizeBytes: 3567831326,
      required: true,
    },
    {
      id: 'charts-US5',
      type: 'charts',
      band: 'US5',
      name: 'Harbor Charts (US5)',
      description: 'Scales 1:12,001 to 1:50,000 - Harbors and anchorages',
      storagePath: '17cgd/charts/US5.mbtiles.zip',
      sizeBytes: 1553767834,
      required: true,
    },
    {
      id: 'charts-US6',
      type: 'charts',
      band: 'US6',
      name: 'Berthing Charts (US6)',
      description: 'Scales 1:12,000 and larger - Detailed berthing',
      storagePath: '17cgd/charts/US6.mbtiles.zip',
      sizeBytes: 806854,
      required: false,
    },
    
    // Supporting Data
    {
      id: 'gnis',
      type: 'gnis',
      name: 'Place Names (GNIS)',
      description: 'Geographic place names overlay',
      storagePath: '17cgd/gnis/gnis_names.mbtiles.zip',
      sizeBytes: 62968287,
      required: false,
    },
    {
      id: 'basemap',
      type: 'basemap',
      name: 'Land Basemap',
      description: 'Terrain and land features',
      storagePath: '17cgd/basemaps/basemap.mbtiles.zip',
      sizeBytes: 759682407,
      required: false,
    },
    
    // Satellite imagery by zoom level
    {
      id: 'satellite-z0-5',
      type: 'satellite',
      name: 'Satellite (Overview)',
      description: 'Zoom levels 0-5 - Global to regional view',
      storagePath: '17cgd/satellite/satellite_z0-5.mbtiles.zip',
      sizeBytes: 10054626,
      required: false,
    },
    {
      id: 'satellite-z6-7',
      type: 'satellite',
      name: 'Satellite (State)',
      description: 'Zoom levels 6-7 - State-wide view',
      storagePath: '17cgd/satellite/satellite_z6-7.mbtiles.zip',
      sizeBytes: 8391846,
      required: false,
    },
    {
      id: 'satellite-z8',
      type: 'satellite',
      name: 'Satellite (Region)',
      description: 'Zoom level 8 - Regional view',
      storagePath: '17cgd/satellite/satellite_z8.mbtiles.zip',
      sizeBytes: 9459630,
      required: false,
    },
    {
      id: 'satellite-z9',
      type: 'satellite',
      name: 'Satellite (Area)',
      description: 'Zoom level 9 - Area view',
      storagePath: '17cgd/satellite/satellite_z9.mbtiles.zip',
      sizeBytes: 9246626,
      required: false,
    },
    {
      id: 'satellite-z10',
      type: 'satellite',
      name: 'Satellite (City)',
      description: 'Zoom level 10 - City-scale view',
      storagePath: '17cgd/satellite/satellite_z10.mbtiles.zip',
      sizeBytes: 25500758,
      required: false,
    },
    {
      id: 'satellite-z11',
      type: 'satellite',
      name: 'Satellite (Town)',
      description: 'Zoom level 11 - Town-scale view',
      storagePath: '17cgd/satellite/satellite_z11.mbtiles.zip',
      sizeBytes: 79446153,
      required: false,
    },
    {
      id: 'satellite-z12',
      type: 'satellite',
      name: 'Satellite (Neighborhood)',
      description: 'Zoom level 12 - Neighborhood view',
      storagePath: '17cgd/satellite/satellite_z12.mbtiles.zip',
      sizeBytes: 270885966,
      required: false,
    },
    {
      id: 'satellite-z13',
      type: 'satellite',
      name: 'Satellite (Street)',
      description: 'Zoom level 13 - Street-level view',
      storagePath: '17cgd/satellite/satellite_z13.mbtiles.zip',
      sizeBytes: 984924749,
      required: false,
    },
    {
      id: 'satellite-z14',
      type: 'satellite',
      name: 'Satellite (Detail)',
      description: 'Zoom level 14 - High detail view',
      storagePath: '17cgd/satellite/satellite_z14.mbtiles.zip',
      sizeBytes: 3711341052,
      required: false,
    },
  ],
  
  // Timestamps
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
};

async function setupDistrict() {
  console.log('Setting up district: 17cgd (Alaska)...');
  
  try {
    // Create or update the district document
    await db.collection('districts').doc('17cgd').set(district17cgd, { merge: true });
    console.log('✓ District document created/updated: districts/17cgd');
    
    // Log summary
    console.log('\nDownload packs configured:');
    for (const pack of district17cgd.downloadPacks) {
      const sizeMB = (pack.sizeBytes / 1024 / 1024).toFixed(1);
      const sizeGB = pack.sizeBytes > 1024 * 1024 * 1024 
        ? ` (${(pack.sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB)` 
        : '';
      console.log(`  - ${pack.name}: ${sizeMB} MB${sizeGB}${pack.required ? ' [required]' : ''}`);
    }
    
    const totalSize = district17cgd.downloadPacks.reduce((sum, p) => sum + p.sizeBytes, 0);
    console.log(`\nTotal download size: ${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB`);
    
    console.log('\n✓ Setup complete!');
    console.log('  The app should now show these packs in the Downloads modal.');
    
  } catch (error) {
    console.error('Error setting up district:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

setupDistrict();

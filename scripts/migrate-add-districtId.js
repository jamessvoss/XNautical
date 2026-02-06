#!/usr/bin/env node
/**
 * migrate-add-districtId.js
 * 
 * Adds districtId field to existing Firestore documents for multi-district support.
 * 
 * Usage:
 *   node scripts/migrate-add-districtId.js --dry-run    # Preview changes
 *   node scripts/migrate-add-districtId.js              # Apply changes
 * 
 * Prerequisites:
 *   - Firebase Admin SDK credentials (GOOGLE_APPLICATION_CREDENTIALS)
 *   - Or run with: firebase emulators:exec --only firestore "node scripts/migrate-add-districtId.js"
 */

const admin = require('firebase-admin');
const path = require('path');

// Configuration
const DISTRICT_ID = '17cgd';  // Alaska - all existing data belongs to District 17
const TIMEZONE = 'America/Anchorage';

const COLLECTIONS_TO_MIGRATE = [
  'tidal-stations',
  'current-stations-packed',
  'chart-metadata',
  'marine-zones',
  'buoys',
];

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

// Initialize Firebase Admin with service account
const serviceAccountPath = path.join(__dirname, 'service-accounts', 'xnautical-key.json');
try {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'xnautical-8a296',
  });
} catch (error) {
  console.error('Error loading service account:', error.message);
  console.error('\nMake sure you have the service account key at:');
  console.error(serviceAccountPath);
  process.exit(1);
}
const db = admin.firestore();

/**
 * Migrate a single collection by adding districtId to all documents
 */
async function migrateCollection(collectionName) {
  console.log(`\n📁 Processing collection: ${collectionName}`);
  
  const collectionRef = db.collection(collectionName);
  const snapshot = await collectionRef.get();
  
  if (snapshot.empty) {
    console.log(`   ⚠️  Collection is empty`);
    return { total: 0, updated: 0, skipped: 0, errors: 0 };
  }
  
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  
  // Process individually to avoid transaction size limits (station docs have large prediction arrays)
  for (const doc of snapshot.docs) {
    const data = doc.data();
    
    // Skip catalog documents
    if (doc.id === 'catalog') {
      console.log(`   ⏭️  Skipping catalog document`);
      skipped++;
      continue;
    }
    
    // Skip if districtId already exists
    if (data.districtId) {
      skipped++;
      continue;
    }
    
    // Prepare update data
    const updateData = {
      districtId: DISTRICT_ID,
    };
    
    // Add timezone for station collections
    if (collectionName === 'tidal-stations' || collectionName === 'current-stations-packed') {
      if (!data.timezone) {
        updateData.timezone = TIMEZONE;
      }
    }
    
    if (DRY_RUN) {
      console.log(`   [DRY RUN] Would update: ${doc.id}`);
      updated++;
    } else {
      try {
        await doc.ref.update(updateData);
        updated++;
        
        // Progress indicator every 100 docs
        if (updated % 100 === 0) {
          console.log(`   ✓ Updated ${updated} documents...`);
        }
      } catch (error) {
        console.error(`   ✗ Error updating ${doc.id}: ${error.message}`);
        errors++;
      }
    }
  }
  
  const total = snapshot.size;
  console.log(`   📊 Total: ${total}, Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);
  
  return { total, updated, skipped, errors };
}

/**
 * Create the districts collection with the 17cgd document
 */
async function createDistrictDocument() {
  console.log(`\n📁 Creating district document: districts/${DISTRICT_ID}`);
  
  const districtRef = db.collection('districts').doc(DISTRICT_ID);
  const existingDoc = await districtRef.get();
  
  if (existingDoc.exists) {
    console.log(`   ⏭️  District document already exists`);
    return false;
  }
  
  const districtData = {
    code: '17 CGD',
    name: 'Alaska',
    timezone: TIMEZONE,
    defaultCenter: [-151.55, 59.64],  // Homer, Alaska
    bounds: {
      west: -180,
      east: -130,
      south: 51,
      north: 72,
    },
    states: ['AK'],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    
    // Download packs available for this district
    downloadPacks: [
      {
        id: 'charts-US1',
        type: 'charts',
        band: 'US1',
        name: 'Overview Charts (US1)',
        description: 'Continental view charts',
        storagePath: '17cgd/charts/US1.mbtiles.zip',
        sizeBytes: 28835840,  // ~27.5 MB compressed
        required: true,
      },
      {
        id: 'charts-US2',
        type: 'charts',
        band: 'US2',
        name: 'General Charts (US2)',
        description: 'Regional planning charts',
        storagePath: '17cgd/charts/US2.mbtiles.zip',
        sizeBytes: 63238144,  // ~60.3 MB compressed
        required: true,
      },
      {
        id: 'charts-US3',
        type: 'charts',
        band: 'US3',
        name: 'Coastal Charts (US3)',
        description: 'Coastal navigation charts',
        storagePath: '17cgd/charts/US3.mbtiles.zip',
        sizeBytes: 292355686,  // ~278.8 MB compressed
        required: true,
      },
      {
        id: 'charts-US4',
        type: 'charts',
        band: 'US4',
        name: 'Approach Charts (US4)',
        description: 'Channel approach charts',
        storagePath: '17cgd/charts/US4.mbtiles.zip',
        sizeBytes: 3565158400,  // ~3.32 GB compressed
        required: false,
      },
      {
        id: 'charts-US5',
        type: 'charts',
        band: 'US5',
        name: 'Harbor Charts (US5)',
        description: 'Harbor navigation charts',
        storagePath: '17cgd/charts/US5.mbtiles.zip',
        sizeBytes: 1546188800,  // ~1.44 GB compressed
        required: false,
      },
      {
        id: 'charts-US6',
        type: 'charts',
        band: 'US6',
        name: 'Berthing Charts (US6)',
        description: 'Docking detail charts',
        storagePath: '17cgd/charts/US6.mbtiles.zip',
        sizeBytes: 806912,  // ~788 KB compressed
        required: false,
      },
      {
        id: 'basemap',
        type: 'basemap',
        name: 'ESRI Basemap',
        description: 'Land/terrain base layer',
        storagePath: '17cgd/basemaps/basemap.mbtiles.zip',
        sizeBytes: 759644160,  // ~724.5 MB compressed
        required: false,
      },
      {
        id: 'gnis',
        type: 'gnis',
        name: 'Place Names',
        description: 'Geographic place names (GNIS)',
        storagePath: '17cgd/gnis/gnis_names.mbtiles.zip',
        sizeBytes: 62976000,  // ~60 MB compressed
        required: false,
      },
    ],
  };
  
  if (DRY_RUN) {
    console.log(`   [DRY RUN] Would create district document with:`);
    console.log(`   - Name: ${districtData.name}`);
    console.log(`   - Timezone: ${districtData.timezone}`);
    console.log(`   - Download packs: ${districtData.downloadPacks.length}`);
    return true;
  }
  
  await districtRef.set(districtData);
  console.log(`   ✓ Created district document`);
  return true;
}

/**
 * Main migration function
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  XNautical Firestore Migration: Add districtId                ║');
  console.log('║  Target District: Alaska (17cgd)                              ║');
  if (DRY_RUN) {
    console.log('║  MODE: DRY RUN (no changes will be made)                      ║');
  }
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  
  const results = {
    total: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };
  
  // Create districts collection
  await createDistrictDocument();
  
  // Migrate each collection
  for (const collection of COLLECTIONS_TO_MIGRATE) {
    const result = await migrateCollection(collection);
    results.total += result.total;
    results.updated += result.updated;
    results.skipped += result.skipped;
    results.errors += result.errors;
  }
  
  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                        MIGRATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total documents processed: ${results.total}`);
  console.log(`  Documents updated:         ${results.updated}`);
  console.log(`  Documents skipped:         ${results.skipped}`);
  console.log(`  Errors:                    ${results.errors}`);
  
  if (DRY_RUN) {
    console.log('\n⚠️  This was a dry run. No changes were made.');
    console.log('   Run without --dry-run to apply changes.');
  } else {
    console.log('\n✓ Migration complete!');
    console.log('\nNext steps:');
    console.log('  1. Deploy Firestore indexes: firebase deploy --only firestore:indexes');
    console.log('  2. Deploy storage rules: firebase deploy --only storage');
    console.log('  3. Update app code to use districtId in queries');
  }
}

// Run migration
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });

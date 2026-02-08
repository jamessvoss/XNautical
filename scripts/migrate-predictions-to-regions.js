#!/usr/bin/env node
/**
 * Migrate Tide & Current Predictions to Region-Scoped Collections
 *
 * This script migrates tide and current prediction data from flat collections
 * (tidal-stations, current-stations-packed) to region-scoped subcollections
 * (regions/{regionId}/tidal-stations, regions/{regionId}/current-stations).
 *
 * For 17cgd: Copies from flat collections (where districtId == '17cgd')
 * For 07cgd: Verifies data already exists from prediction-generator
 *
 * Usage:
 *   node scripts/migrate-predictions-to-regions.js               # migrate all
 *   node scripts/migrate-predictions-to-regions.js --dry-run     # preview only
 *   node scripts/migrate-predictions-to-regions.js --region 17cgd # single region
 */

const admin = require('firebase-admin');
const path = require('path');

// ============================================================================
// Firebase init
// ============================================================================

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

// ============================================================================
// CLI flags
// ============================================================================

const dryRun = process.argv.includes('--dry-run');
const regionFilter = (() => {
  const idx = process.argv.indexOf('--region');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

console.log('='.repeat(60));
console.log('Migrate Predictions to Region-Scoped Collections');
console.log('='.repeat(60));
if (dryRun) console.log('🔍 DRY RUN MODE - No changes will be made\n');

// ============================================================================
// Helper functions
// ============================================================================

async function migrateTideStations(regionId) {
  console.log(`\n[${regionId}] Migrating tide stations...`);
  
  // Query flat collection for this district
  const flatQuery = db.collection('tidal-stations')
    .where('districtId', '==', regionId);
  
  const snapshot = await flatQuery.get();
  console.log(`  Found ${snapshot.size} tide stations in flat collection`);
  
  if (snapshot.empty) {
    console.log(`  ℹ️  No tide stations found for ${regionId} in flat collection`);
    return 0;
  }
  
  let migratedCount = 0;
  
  // Process in smaller batches to avoid memory issues and payload size limits
  const BATCH_SIZE = 10; // Small batch due to large prediction data per station
  const docs = snapshot.docs;
  
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    const writeBatch = db.batch();
    
    for (const doc of batch) {
      const data = doc.data();
      const targetRef = db.collection('regions')
        .doc(regionId)
        .collection('tidal-stations')
        .doc(doc.id);
      
      if (!dryRun) {
        writeBatch.set(targetRef, data);
      }
      
      migratedCount++;
    }
    
    if (!dryRun) {
      await writeBatch.commit();
      console.log(`    Committed batch: ${Math.min(i + BATCH_SIZE, docs.length)}/${docs.length} stations`);
    }
    
    // Give garbage collector a chance
    if (i % 200 === 0 && i > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  console.log(`  ✓ ${dryRun ? 'Would migrate' : 'Migrated'} ${migratedCount} tide stations`);
  return migratedCount;
}

async function migrateCurrentStations(regionId) {
  console.log(`\n[${regionId}] Migrating current stations...`);
  
  // Query flat collection for this district (excluding catalog)
  const flatQuery = db.collection('current-stations-packed')
    .where('districtId', '==', regionId);
  
  const snapshot = await flatQuery.get();
  console.log(`  Found ${snapshot.size} current stations in flat collection`);
  
  if (snapshot.empty) {
    console.log(`  ℹ️  No current stations found for ${regionId} in flat collection`);
    return 0;
  }
  
  let migratedCount = 0;
  const docs = snapshot.docs;
  
  for (const doc of docs) {
    const data = doc.data();
    const targetRef = db.collection('regions')
      .doc(regionId)
      .collection('current-stations')
      .doc(doc.id);
    
    if (!dryRun) {
      // Copy main document
      await targetRef.set(data);
      
      // Copy predictions subcollection if it exists
      const monthsAvailable = data.monthsAvailable || [];
      
      if (monthsAvailable.length > 0) {
        // Process predictions in batches
        const PRED_BATCH_SIZE = 20;
        for (let i = 0; i < monthsAvailable.length; i += PRED_BATCH_SIZE) {
          const monthBatch = monthsAvailable.slice(i, i + PRED_BATCH_SIZE);
          const writeBatch = db.batch();
          
          for (const month of monthBatch) {
            try {
              const predDoc = await db.collection('current-stations-packed')
                .doc(doc.id)
                .collection('predictions')
                .doc(month)
                .get();
              
              if (predDoc.exists) {
                const predData = predDoc.data();
                const predTargetRef = targetRef.collection('predictions').doc(month);
                writeBatch.set(predTargetRef, predData);
              }
            } catch (err) {
              console.warn(`    Error fetching ${doc.id}/${month}:`, err.message);
            }
          }
          
          await writeBatch.commit();
        }
        
        console.log(`    Copied ${monthsAvailable.length} prediction months for station ${doc.id}`);
      }
    }
    
    migratedCount++;
    
    // Progress indicator
    if (migratedCount % 10 === 0) {
      console.log(`    Progress: ${migratedCount}/${docs.length} stations`);
    }
    
    // Give garbage collector a chance
    if (migratedCount % 50 === 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  console.log(`  ✓ ${dryRun ? 'Would migrate' : 'Migrated'} ${migratedCount} current stations`);
  return migratedCount;
}

async function verifyRegionData(regionId) {
  console.log(`\n[${regionId}] Verifying region-scoped data...`);
  
  const tideSnapshot = await db.collection('regions')
    .doc(regionId)
    .collection('tidal-stations')
    .limit(1)
    .get();
  
  const currentSnapshot = await db.collection('regions')
    .doc(regionId)
    .collection('current-stations')
    .limit(1)
    .get();
  
  console.log(`  Tide stations: ${tideSnapshot.empty ? '❌ NOT FOUND' : '✓ EXISTS'}`);
  console.log(`  Current stations: ${currentSnapshot.empty ? '❌ NOT FOUND' : '✓ EXISTS'}`);
  
  return !tideSnapshot.empty || !currentSnapshot.empty;
}

// ============================================================================
// Main migration
// ============================================================================

async function main() {
  const regionsToMigrate = regionFilter ? [regionFilter] : ['17cgd', '07cgd'];
  
  console.log(`Regions to process: ${regionsToMigrate.join(', ')}\n`);
  
  for (const regionId of regionsToMigrate) {
    console.log('━'.repeat(60));
    console.log(`Processing region: ${regionId}`);
    console.log('━'.repeat(60));
    
    // Check if region already has data
    const hasData = await verifyRegionData(regionId);
    
    if (hasData && !dryRun) {
      console.log(`\n⚠️  Region ${regionId} already has data in region-scoped collections`);
      console.log('   Skipping migration to avoid duplicates.');
      console.log('   If you want to re-migrate, delete the existing region-scoped data first.\n');
      continue;
    }
    
    // Migrate tide stations
    const tideCount = await migrateTideStations(regionId);
    
    // Migrate current stations
    const currentCount = await migrateCurrentStations(regionId);
    
    console.log(`\n[${regionId}] Summary:`);
    console.log(`  Tide stations: ${tideCount}`);
    console.log(`  Current stations: ${currentCount}`);
    console.log(`  Total: ${tideCount + currentCount}`);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('Migration complete!');
  console.log('='.repeat(60));
  
  if (dryRun) {
    console.log('\n💡 Run without --dry-run to perform the migration');
  } else {
    console.log('\n✓ Data successfully migrated to region-scoped collections');
    console.log('\nNext steps:');
    console.log('  1. Update firestore.rules to add security rules for region-scoped collections');
    console.log('  2. Deploy cloud functions with updated getStationLocations/Predictions');
    console.log('  3. Test app with region-scoped data');
    console.log('  4. After verification, archive flat collections (tidal-stations, current-stations-packed)');
  }
  
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

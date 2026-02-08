#!/usr/bin/env node
/**
 * Move Marine Forecast Data to Districts Collection
 *
 * Moves marine zones, forecasts, and system metadata from
 * marine-forecast-districts/{districtId}/* to districts/{districtId}/*
 *
 * Usage:
 *   node scripts/move-marine-data-to-districts.js               # move all
 *   node scripts/move-marine-data-to-districts.js --dry-run     # preview only
 *   node scripts/move-marine-data-to-districts.js --district 17cgd # single district
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
const districtFilter = (() => {
  const idx = process.argv.indexOf('--district');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

console.log('='.repeat(60));
console.log('Move Marine Forecast Data to Districts Collection');
console.log('='.repeat(60));
if (dryRun) console.log('🔍 DRY RUN MODE - No changes will be made\n');

// ============================================================================
// Helper functions
// ============================================================================

async function moveSubcollection(sourceParent, targetParent, subcollectionName) {
  console.log(`  Moving ${subcollectionName}...`);
  
  const sourceRef = sourceParent.collection(subcollectionName);
  const snapshot = await sourceRef.get();
  
  if (snapshot.empty) {
    console.log(`    No documents found in ${subcollectionName}`);
    return 0;
  }
  
  console.log(`    Found ${snapshot.size} documents`);
  
  if (!dryRun) {
    const batch = db.batch();
    let count = 0;
    
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const targetRef = targetParent.collection(subcollectionName).doc(doc.id);
      batch.set(targetRef, data);
      count++;
      
      // Commit every 500 docs
      if (count >= 500) {
        await batch.commit();
        console.log(`      Committed batch of ${count} documents`);
        count = 0;
      }
    }
    
    // Commit remaining
    if (count > 0) {
      await batch.commit();
      console.log(`      Committed final batch of ${count} documents`);
    }
  }
  
  console.log(`    ✓ ${dryRun ? 'Would move' : 'Moved'} ${snapshot.size} documents`);
  return snapshot.size;
}

async function moveDistrict(districtId) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Processing district: ${districtId}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  
  const sourceParent = db.collection('marine-forecast-districts').doc(districtId);
  const targetParent = db.collection('districts').doc(districtId);
  
  // Check if source exists
  const sourceDoc = await sourceParent.get();
  if (!sourceDoc.exists) {
    console.log(`  ⚠️  Source district not found in marine-forecast-districts`);
    return { zones: 0, forecasts: 0, system: 0 };
  }
  
  // Move subcollections
  const zones = await moveSubcollection(sourceParent, targetParent, 'marine-zones');
  const forecasts = await moveSubcollection(sourceParent, targetParent, 'marine-forecasts');
  const system = await moveSubcollection(sourceParent, targetParent, 'system');
  
  console.log(`\n  Summary for ${districtId}:`);
  console.log(`    Marine zones: ${zones}`);
  console.log(`    Marine forecasts: ${forecasts}`);
  console.log(`    System docs: ${system}`);
  
  return { zones, forecasts, system };
}

// ============================================================================
// Main migration
// ============================================================================

async function main() {
  let districtsToMove = [];
  
  if (districtFilter) {
    districtsToMove = [districtFilter];
  } else {
    // Get all districts from marine-forecast-districts
    const snapshot = await db.collection('marine-forecast-districts').get();
    districtsToMove = snapshot.docs.map(doc => doc.id);
  }
  
  console.log(`Districts to process: ${districtsToMove.join(', ')}\n`);
  
  const totals = { zones: 0, forecasts: 0, system: 0 };
  
  for (const districtId of districtsToMove) {
    const result = await moveDistrict(districtId);
    totals.zones += result.zones;
    totals.forecasts += result.forecasts;
    totals.system += result.system;
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('Migration complete!');
  console.log('='.repeat(60));
  console.log(`\nTotal documents ${dryRun ? 'that would be' : ''} moved:`);
  console.log(`  Marine zones: ${totals.zones}`);
  console.log(`  Marine forecasts: ${totals.forecasts}`);
  console.log(`  System docs: ${totals.system}`);
  console.log(`  Grand total: ${totals.zones + totals.forecasts + totals.system}`);
  
  if (dryRun) {
    console.log('\n💡 Run without --dry-run to perform the migration');
  } else {
    console.log('\n✓ Data successfully moved to districts collection');
    console.log('\nNext steps:');
    console.log('  1. Verify data in districts/{districtId}/ collections');
    console.log('  2. Test app with new structure');
    console.log('  3. After verification, delete marine-forecast-districts collection');
  }
  
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

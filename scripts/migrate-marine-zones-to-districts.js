#!/usr/bin/env node
/**
 * migrate-marine-zones-to-districts.js
 * 
 * Migrates marine-zones and marine-forecasts from flat collections to 
 * district-scoped subcollections under marine-forecast-districts/{districtId}/.
 * 
 * This maintains data structure consistency with tidal-stations, 
 * current-stations-packed, and other district-scoped collections.
 * 
 * Usage:
 *   node scripts/migrate-marine-zones-to-districts.js --dry-run    # Preview
 *   node scripts/migrate-marine-zones-to-districts.js              # Execute
 * 
 * Prerequisites:
 *   - Service account key at scripts/service-accounts/xnautical-key.json
 *   - Or set GOOGLE_APPLICATION_CREDENTIALS environment variable
 */

const admin = require('firebase-admin');
const path = require('path');

// Configuration
const DISTRICT_ID = '17cgd';  // Alaska - all existing marine data belongs to District 17

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

// Initialize Firebase Admin
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
  console.error('\nOr set GOOGLE_APPLICATION_CREDENTIALS environment variable');
  process.exit(1);
}
const db = admin.firestore();

/**
 * Migrate marine-zones collection to marine-forecast-districts/{districtId}/marine-zones/
 */
async function migrateMarineZones() {
  console.log(`\n📁 Processing: marine-zones → marine-forecast-districts/${DISTRICT_ID}/marine-zones/`);
  
  const sourceRef = db.collection('marine-zones');
  const snapshot = await sourceRef.get();
  
  if (snapshot.empty) {
    console.log(`   ⚠️  Source collection is empty`);
    return { total: 0, migrated: 0, errors: 0 };
  }
  
  console.log(`   Found ${snapshot.size} zone documents`);
  
  let migrated = 0;
  let errors = 0;
  
  // Target: subcollection under marine-forecast-districts/{districtId}/
  const targetCollection = db.collection('marine-forecast-districts').doc(DISTRICT_ID).collection('marine-zones');
  
  for (const doc of snapshot.docs) {
    const data = doc.data();
    
    // Add districtId to the document
    const newData = {
      ...data,
      districtId: DISTRICT_ID,
    };
    
    if (DRY_RUN) {
      console.log(`   [DRY RUN] Would migrate: ${doc.id} (${data.name || 'unnamed'})`);
      migrated++;
    } else {
      try {
        await targetCollection.doc(doc.id).set(newData);
        migrated++;
        
        if (migrated % 50 === 0) {
          console.log(`   ✓ Migrated ${migrated} zones...`);
        }
      } catch (error) {
        console.error(`   ✗ Error migrating ${doc.id}: ${error.message}`);
        errors++;
      }
    }
  }
  
  console.log(`   📊 Total: ${snapshot.size}, Migrated: ${migrated}, Errors: ${errors}`);
  
  return { total: snapshot.size, migrated, errors };
}

/**
 * Migrate marine-forecasts collection to marine-forecast-districts/{districtId}/marine-forecasts/
 */
async function migrateMarineForecasts() {
  console.log(`\n📁 Processing: marine-forecasts → marine-forecast-districts/${DISTRICT_ID}/marine-forecasts/`);
  
  const sourceRef = db.collection('marine-forecasts');
  const snapshot = await sourceRef.get();
  
  if (snapshot.empty) {
    console.log(`   ⚠️  Source collection is empty`);
    return { total: 0, migrated: 0, errors: 0 };
  }
  
  console.log(`   Found ${snapshot.size} forecast documents`);
  
  let migrated = 0;
  let errors = 0;
  
  // Target: subcollection under marine-forecast-districts/{districtId}/
  const targetCollection = db.collection('marine-forecast-districts').doc(DISTRICT_ID).collection('marine-forecasts');
  
  for (const doc of snapshot.docs) {
    const data = doc.data();
    
    // Add districtId to the document
    const newData = {
      ...data,
      districtId: DISTRICT_ID,
    };
    
    if (DRY_RUN) {
      console.log(`   [DRY RUN] Would migrate: ${doc.id} (${data.zoneName || 'unnamed'})`);
      migrated++;
    } else {
      try {
        await targetCollection.doc(doc.id).set(newData);
        migrated++;
        
        if (migrated % 50 === 0) {
          console.log(`   ✓ Migrated ${migrated} forecasts...`);
        }
      } catch (error) {
        console.error(`   ✗ Error migrating ${doc.id}: ${error.message}`);
        errors++;
      }
    }
  }
  
  console.log(`   📊 Total: ${snapshot.size}, Migrated: ${migrated}, Errors: ${errors}`);
  
  return { total: snapshot.size, migrated, errors };
}

/**
 * Main migration function
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  Marine Zones Migration: Flat → District Subcollections      ║');
  console.log('║  Target District: Alaska (17cgd)                              ║');
  if (DRY_RUN) {
    console.log('║  MODE: DRY RUN (no changes will be made)                      ║');
  }
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  
  const startTime = Date.now();
  
  try {
    // Migrate marine-zones
    const zonesResult = await migrateMarineZones();
    
    // Migrate marine-forecasts
    const forecastsResult = await migrateMarineForecasts();
    
    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('                        MIGRATION SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Zones migrated:        ${zonesResult.migrated}/${zonesResult.total}`);
    console.log(`  Forecasts migrated:    ${forecastsResult.migrated}/${forecastsResult.total}`);
    console.log(`  Total errors:          ${zonesResult.errors + forecastsResult.errors}`);
    console.log(`  Duration:              ${duration}s`);
    
    if (DRY_RUN) {
      console.log('\n⚠️  This was a dry run. No changes were made.');
      console.log('   Run without --dry-run to apply changes.');
    } else {
      console.log('\n✓ Migration complete!');
      console.log('\nNext steps:');
      console.log('  1. Update app code to use new paths (marineZoneService.ts)');
      console.log('  2. Update cloud functions to use new paths (functions/src/index.ts)');
      console.log('  3. Test Weather screen in app');
      console.log('  4. After verifying, delete old collections:');
      console.log('     - marine-zones');
      console.log('     - marine-forecasts');
    }
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

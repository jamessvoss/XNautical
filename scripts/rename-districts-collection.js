#!/usr/bin/env node
/**
 * rename-districts-collection.js
 * 
 * Renames the top-level 'districts' collection to 'marine-forecast-districts'
 * for all marine zone and forecast data.
 * 
 * This migration:
 *   1. Copies all documents from districts/{districtId}/marine-zones → marine-forecast-districts/{districtId}/marine-zones
 *   2. Copies all documents from districts/{districtId}/marine-forecasts → marine-forecast-districts/{districtId}/marine-forecasts
 *   3. Copies metadata from districts/{districtId}/system → marine-forecast-districts/{districtId}/system
 * 
 * Usage:
 *   node scripts/rename-districts-collection.js --dry-run    # Preview
 *   node scripts/rename-districts-collection.js              # Execute
 * 
 * Prerequisites:
 *   - Service account key at scripts/service-accounts/xnautical-key.json
 */

const admin = require('firebase-admin');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

// Districts to migrate
const DISTRICTS = ['17cgd', '07cgd'];  // Alaska and Southeast

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
  process.exit(1);
}
const db = admin.firestore();

/**
 * Copy a subcollection from old to new location
 */
async function copySubcollection(districtId, subcollectionName) {
  const oldPath = `districts/${districtId}/${subcollectionName}`;
  const newPath = `marine-forecast-districts/${districtId}/${subcollectionName}`;
  
  console.log(`\n📁 Copying: ${oldPath} → ${newPath}`);
  
  const sourceRef = db.collection('districts').doc(districtId).collection(subcollectionName);
  const snapshot = await sourceRef.get();
  
  if (snapshot.empty) {
    console.log(`   ⚠️  No documents found`);
    return { total: 0, copied: 0, errors: 0 };
  }
  
  console.log(`   Found ${snapshot.size} documents`);
  
  let copied = 0;
  let errors = 0;
  
  const targetRef = db.collection('marine-forecast-districts').doc(districtId).collection(subcollectionName);
  
  for (const doc of snapshot.docs) {
    const data = doc.data();
    
    if (DRY_RUN) {
      console.log(`   [DRY RUN] Would copy: ${doc.id}`);
      copied++;
    } else {
      try {
        await targetRef.doc(doc.id).set(data);
        copied++;
        
        if (copied % 50 === 0) {
          console.log(`   ✓ Copied ${copied} documents...`);
        }
      } catch (error) {
        console.error(`   ✗ Error copying ${doc.id}: ${error.message}`);
        errors++;
      }
    }
  }
  
  console.log(`   📊 Total: ${snapshot.size}, Copied: ${copied}, Errors: ${errors}`);
  
  return { total: snapshot.size, copied, errors };
}

/**
 * Main migration function
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  Rename Collection: districts → marine-forecast-districts    ║');
  if (DRY_RUN) {
    console.log('║  MODE: DRY RUN (no changes will be made)                      ║');
  }
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  
  const startTime = Date.now();
  const results = {
    zones: { total: 0, copied: 0, errors: 0 },
    forecasts: { total: 0, copied: 0, errors: 0 },
    system: { total: 0, copied: 0, errors: 0 }
  };
  
  try {
    for (const districtId of DISTRICTS) {
      console.log(`\n═══ District: ${districtId} ═══`);
      
      // Copy marine-zones
      const zonesResult = await copySubcollection(districtId, 'marine-zones');
      results.zones.total += zonesResult.total;
      results.zones.copied += zonesResult.copied;
      results.zones.errors += zonesResult.errors;
      
      // Copy marine-forecasts
      const forecastsResult = await copySubcollection(districtId, 'marine-forecasts');
      results.forecasts.total += forecastsResult.total;
      results.forecasts.copied += forecastsResult.copied;
      results.forecasts.errors += forecastsResult.errors;
      
      // Copy system metadata
      const systemResult = await copySubcollection(districtId, 'system');
      results.system.total += systemResult.total;
      results.system.copied += systemResult.copied;
      results.system.errors += systemResult.errors;
    }
    
    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('                      MIGRATION SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Marine Zones:      ${results.zones.copied}/${results.zones.total} copied`);
    console.log(`  Marine Forecasts:  ${results.forecasts.copied}/${results.forecasts.total} copied`);
    console.log(`  System Metadata:   ${results.system.copied}/${results.system.total} copied`);
    console.log(`  Total Errors:      ${results.zones.errors + results.forecasts.errors + results.system.errors}`);
    console.log(`  Duration:          ${duration}s`);
    
    if (DRY_RUN) {
      console.log('\n⚠️  This was a dry run. No changes were made.');
      console.log('   Run without --dry-run to apply changes.');
    } else {
      console.log('\n✓ Migration complete!');
      console.log('\nNext steps:');
      console.log('  1. Deploy updated cloud functions (npm run deploy in functions/)');
      console.log('  2. Test marine forecasts in app');
      console.log('  3. After verifying, delete old districts/ collection:');
      console.log('     - districts/17cgd/marine-zones');
      console.log('     - districts/17cgd/marine-forecasts');
      console.log('     - districts/17cgd/system');
      console.log('     - districts/07cgd/marine-zones');
      console.log('     - districts/07cgd/marine-forecasts');
      console.log('     - districts/07cgd/system');
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

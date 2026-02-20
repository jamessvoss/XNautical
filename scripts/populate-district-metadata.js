#!/usr/bin/env node
/**
 * populate-district-metadata.js
 * 
 * Populates missing district metadata (code, bounds) in Firestore.
 * This is a one-time fix for districts created before the shared config existed.
 * 
 * Usage:
 *   node scripts/populate-district-metadata.js --dry-run    # Preview changes
 *   node scripts/populate-district-metadata.js              # Apply changes
 * 
 * Prerequisites:
 *   - Service account key at xnautical-service-account.json
 */

const admin = require('firebase-admin');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

// Initialize Firebase Admin
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.resolve(__dirname, '..', 'xnautical-service-account.json');

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

// ============================================================================
// District Configuration (Single Source of Truth)
// ============================================================================

const DISTRICT_CONFIG = {
  '01cgd': {
    name: 'Northeast',
    code: '01 CGD',
    bounds: { west: -76, south: 39, east: -65, north: 48 }
  },
  '05cgd': {
    name: 'East',
    code: '05 CGD',
    bounds: { west: -82, south: 32, east: -72, north: 42 }
  },
  '07cgd': {
    name: 'Southeast',
    code: '07 CGD',
    bounds: { west: -85, south: 23, east: -63, north: 35 }
  },
  '08cgd': {
    name: 'Heartland',
    code: '08 CGD',
    bounds: { west: -100, south: 23, east: -80, north: 33 }
  },
  '09cgd': {
    name: 'Great Lakes',
    code: '09 CGD',
    bounds: { west: -94, south: 40, east: -75, north: 50 }
  },
  '11cgd': {
    name: 'Southwest',
    code: '11 CGD',
    bounds: { west: -126, south: 30, east: -114, north: 39 }
  },
  '13cgd': {
    name: 'Northwest',
    code: '13 CGD',
    bounds: { west: -130, south: 33, east: -119, north: 50 }
  },
  '14cgd': {
    name: 'Oceania',
    code: '14 CGD',
    bounds: { west: -162, south: 17, east: -153, north: 24 }
  },
  '17cgd': {
    name: 'Arctic',
    code: '17 CGD',
    // Alaska has multiple bounding boxes (handle dateline crossing)
    // Using primary bounds - full bounds in shared config
    bounds: { west: -180, south: 50, east: -129, north: 72 }
  },
};

// ============================================================================
// Main Function
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║              POPULATE DISTRICT METADATA (CODE & BOUNDS)                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  const results = {
    updated: 0,
    created: 0,
    errors: 0,
    skipped: 0,
  };

  for (const [districtId, config] of Object.entries(DISTRICT_CONFIG)) {
    console.log(`\n📍 Processing ${districtId} (${config.name})...`);

    try {
      // Check if district exists
      const districtRef = db.collection('districts').doc(districtId);
      const districtSnap = await districtRef.get();

      if (!districtSnap.exists) {
        console.log('   ⚠️  District document does not exist');
        
        if (DRY_RUN) {
          console.log('   [DRY RUN] Would create district document with:');
          console.log(`     - name: ${config.name}`);
          console.log(`     - code: ${config.code}`);
          console.log(`     - bounds: ${JSON.stringify(config.bounds)}`);
        } else {
          await districtRef.set({
            name: config.name,
            code: config.code,
            bounds: config.bounds,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log('   ✅ Created district document');
          results.created++;
        }
      } else {
        const data = districtSnap.data();
        const needsUpdate = !data.code || !data.bounds;

        if (!needsUpdate) {
          console.log('   ✓ Already has code and bounds, skipping');
          results.skipped++;
          continue;
        }

        console.log('   📝 Missing fields:');
        if (!data.code) console.log('     - code');
        if (!data.bounds) console.log('     - bounds');

        if (DRY_RUN) {
          console.log('   [DRY RUN] Would update with:');
          if (!data.code) console.log(`     - code: ${config.code}`);
          if (!data.bounds) console.log(`     - bounds: ${JSON.stringify(config.bounds)}`);
        } else {
          const updateData = {
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          if (!data.code) updateData.code = config.code;
          if (!data.bounds) updateData.bounds = config.bounds;

          await districtRef.set(updateData, { merge: true });
          console.log('   ✅ Updated district document');
          results.updated++;
        }
      }
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
      results.errors++;
    }
  }

  // Summary
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                              SUMMARY                                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');
  console.log(`  Districts processed: ${Object.keys(DISTRICT_CONFIG).length}`);
  console.log(`  Created: ${results.created}`);
  console.log(`  Updated: ${results.updated}`);
  console.log(`  Skipped (already complete): ${results.skipped}`);
  console.log(`  Errors: ${results.errors}\n`);

  if (DRY_RUN) {
    console.log('🔍 This was a DRY RUN - no changes were made');
    console.log('   Run without --dry-run to apply changes\n');
  } else if (results.errors === 0) {
    console.log('✅ All districts updated successfully!');
    console.log('   Run verify-firestore-structure.js to confirm\n');
  } else {
    console.log('⚠️  Some errors occurred. Review output above.\n');
  }

  process.exit(results.errors > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * migrate-buoys-to-districts.js
 * 
 * Migrates buoy data from the legacy top-level `buoys/` collection
 * to district-scoped `districts/{districtId}/buoys/` subcollections.
 * 
 * What it does:
 *   1. Reads `buoys/catalog` to get all stations (each has a districtId field)
 *   2. Groups stations by districtId
 *   3. Creates `districts/{districtId}/buoys/catalog` for each district
 *   4. Copies each individual buoy doc from `buoys/{buoyId}` to
 *      `districts/{districtId}/buoys/{buoyId}`
 * 
 * Usage:
 *   node scripts/migrate-buoys-to-districts.js --dry-run    # Preview changes
 *   node scripts/migrate-buoys-to-districts.js              # Apply changes
 * 
 * Prerequisites:
 *   - Service account key at scripts/service-accounts/xnautical-key.json
 */

const admin = require('firebase-admin');
const path = require('path');

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
  process.exit(1);
}
const db = admin.firestore();

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  Migrate Buoys from buoys/ to districts/{id}/buoys/          ║');
  if (DRY_RUN) {
    console.log('║  MODE: DRY RUN (no changes will be made)                     ║');
  } else {
    console.log('║  MODE: LIVE (changes will be written to Firestore)           ║');
  }
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  // Step 1: Read the legacy catalog
  console.log('\n📁 Reading legacy buoys/catalog...');
  const catalogDoc = await db.collection('buoys').doc('catalog').get();

  if (!catalogDoc.exists) {
    console.error('   ✗ No buoys/catalog document found. Nothing to migrate.');
    process.exit(1);
  }

  const catalogData = catalogDoc.data();
  const stations = catalogData.stations || [];
  console.log(`   Found ${stations.length} stations in legacy catalog`);

  // Step 2: Determine districtId for each station
  // The catalog entries may not have districtId, but individual buoy docs might.
  // Default to '17cgd' for existing stations (all currently Alaska).
  const DEFAULT_DISTRICT = '17cgd';
  console.log(`\n📊 Resolving districtId for each station (default: ${DEFAULT_DISTRICT})...`);
  const byDistrict = {};

  for (const station of stations) {
    let districtId = station.districtId;

    // If catalog entry doesn't have districtId, check the individual buoy doc
    if (!districtId) {
      const buoyDoc = await db.collection('buoys').doc(station.id).get();
      if (buoyDoc.exists) {
        districtId = buoyDoc.data().districtId;
      }
    }

    // Fall back to default
    if (!districtId) {
      districtId = DEFAULT_DISTRICT;
    }

    // Add districtId to station object for the new catalog
    station.districtId = districtId;

    if (!byDistrict[districtId]) {
      byDistrict[districtId] = [];
    }
    byDistrict[districtId].push(station);
  }

  for (const [districtId, districtStations] of Object.entries(byDistrict)) {
    console.log(`   ${districtId}: ${districtStations.length} stations`);
  }

  // Step 3: Create district catalogs and copy individual buoy docs
  let totalCopied = 0;
  let totalErrors = 0;

  for (const [districtId, districtStations] of Object.entries(byDistrict)) {
    console.log(`\n📦 Processing district: ${districtId} (${districtStations.length} stations)...`);

    // Check that the district document exists
    const districtDoc = await db.collection('districts').doc(districtId).get();
    if (!districtDoc.exists) {
      console.log(`   ⚠️  District document districts/${districtId} does not exist, skipping`);
      continue;
    }

    // Create the district catalog
    const districtCatalog = {
      stations: districtStations,
      lastUpdated: catalogData.lastUpdated || new Date().toISOString(),
      migratedAt: new Date().toISOString(),
      stationCount: districtStations.length,
    };

    if (DRY_RUN) {
      console.log(`   [DRY RUN] Would write districts/${districtId}/buoys/catalog with ${districtStations.length} stations`);
    } else {
      await db.collection('districts').doc(districtId)
        .collection('buoys').doc('catalog').set(districtCatalog);
      console.log(`   ✓ Created districts/${districtId}/buoys/catalog`);
    }

    // Copy individual buoy documents
    let copied = 0;
    let errors = 0;

    for (const station of districtStations) {
      try {
        const sourceDoc = await db.collection('buoys').doc(station.id).get();

        if (!sourceDoc.exists) {
          console.log(`   ⚠️  buoys/${station.id} does not exist, creating from catalog data`);
          // Create a basic doc from catalog data
          const basicDoc = {
            id: station.id,
            name: station.name,
            latitude: station.latitude,
            longitude: station.longitude,
            type: station.type || 'buoy',
            owner: station.owner || '',
            districtId: districtId,
          };

          if (DRY_RUN) {
            console.log(`   [DRY RUN] Would create districts/${districtId}/buoys/${station.id} (from catalog)`);
          } else {
            await db.collection('districts').doc(districtId)
              .collection('buoys').doc(station.id).set(basicDoc);
          }
          copied++;
          continue;
        }

        const sourceData = sourceDoc.data();

        if (DRY_RUN) {
          console.log(`   [DRY RUN] Would copy buoys/${station.id} → districts/${districtId}/buoys/${station.id}`);
        } else {
          await db.collection('districts').doc(districtId)
            .collection('buoys').doc(station.id).set({
              ...sourceData,
              districtId: districtId, // Ensure districtId is set
            });
        }
        copied++;
      } catch (err) {
        console.error(`   ✗ Error copying ${station.id}: ${err.message}`);
        errors++;
      }
    }

    totalCopied += copied;
    totalErrors += errors;
    console.log(`   ${DRY_RUN ? '[DRY RUN] Would copy' : 'Copied'} ${copied} buoy docs, ${errors} errors`);
  }

  // Summary
  console.log('\n════════════════════════════════════════════════════');
  console.log('  Migration Summary');
  console.log('════════════════════════════════════════════════════');
  console.log(`  Districts processed: ${Object.keys(byDistrict).length}`);
  console.log(`  Buoy docs ${DRY_RUN ? 'to copy' : 'copied'}: ${totalCopied}`);
  console.log(`  Errors: ${totalErrors}`);
  console.log(`  Default district applied: ${DEFAULT_DISTRICT}`);
  if (DRY_RUN) {
    console.log('\n  Run without --dry-run to apply changes.');
  }
}

main().then(() => {
  console.log('\nDone.');
  process.exit(0);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

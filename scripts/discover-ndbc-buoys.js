#!/usr/bin/env node
/**
 * discover-ndbc-buoys.js
 * 
 * Discovers all active NDBC buoy stations from the NOAA NDBC activestations.xml API
 * and assigns them to USCG districts based on geographic bounds.
 * 
 * What it does:
 *   1. Fetches activestations.xml from NDBC
 *   2. Parses XML to extract active buoy metadata
 *   3. Filters to stations with meteorological data
 *   4. Assigns each buoy to a district based on geographic bounds
 *   5. Writes to Firestore:
 *      - districts/{districtId}/buoys/catalog (catalog document)
 *      - districts/{districtId}/buoys/{buoyId} (individual buoy documents)
 * 
 * Usage:
 *   node scripts/discover-ndbc-buoys.js --dry-run    # Preview changes
 *   node scripts/discover-ndbc-buoys.js              # Apply changes
 * 
 * Prerequisites:
 *   - Service account key at xnautical-service-account.json
 */

const admin = require('firebase-admin');
const https = require('https');
const http = require('http');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

// NDBC API
const NDBC_ACTIVE_STATIONS_URL = 'https://www.ndbc.noaa.gov/activestations.xml';

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
// Region Bounds (from regionData.ts)
// ============================================================================

const REGION_BOUNDS = {
  '17cgd': { name: 'Arctic', mapBounds: [-180, 48, -130, 72] },
  '14cgd': { name: 'Oceania', mapBounds: [-162, 17, -153, 23] },
  '13cgd': { name: 'Northwest', mapBounds: [-128, 34, -120, 49] },
  '11cgd': { name: 'Southwest', mapBounds: [-125, 30, -115, 38] },
  '08cgd': { name: 'Heartland', mapBounds: [-98, 24, -82, 32] },
  '09cgd': { name: 'Great Lakes', mapBounds: [-93, 41, -76, 49] },
  '01cgd': { name: 'Northeast', mapBounds: [-74, 40, -66, 48] },
  '05cgd': { name: 'East', mapBounds: [-80, 33, -73, 41] },
  '07cgd': { name: 'Southeast', mapBounds: [-84, 24, -64, 34] },
};

// ============================================================================
// Utilities
// ============================================================================

/**
 * Check if coordinates fall within a bounding box
 */
function isWithinBounds(lat, lng, bounds) {
  const [west, south, east, north] = bounds;
  
  // Handle international date line for Alaska
  if (west > east) {
    // Split bounds: west to 180, and -180 to east
    return (
      lat >= south && lat <= north &&
      (lng >= west || lng <= east)
    );
  }
  
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

/**
 * Find which district a buoy belongs to
 */
function assignDistrict(lat, lng) {
  for (const [districtId, config] of Object.entries(REGION_BOUNDS)) {
    if (isWithinBounds(lat, lng, config.mapBounds)) {
      return districtId;
    }
  }
  return null; // Outside all defined regions
}

/**
 * Fetch XML from NDBC (handle SSL issues)
 */
function fetchXML(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    
    const options = {
      rejectUnauthorized: false, // Handle SSL cert issues
    };
    
    client.get(url, options, (res) => {
      let data = '';
      
      res.on('data', chunk => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        } else {
          resolve(data);
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  NDBC Buoy Discovery & District Assignment                   ║');
  if (DRY_RUN) {
    console.log('║  MODE: DRY RUN (no changes will be made)                     ║');
  } else {
    console.log('║  MODE: LIVE (changes will be written to Firestore)           ║');
  }
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  // Step 1: Fetch activestations.xml
  console.log('\n📡 Fetching NDBC activestations.xml...');
  let xmlData;
  try {
    xmlData = await fetchXML(NDBC_ACTIVE_STATIONS_URL);
    console.log('   ✓ Downloaded successfully');
  } catch (error) {
    console.error('   ✗ Failed to fetch:', error.message);
    process.exit(1);
  }

  // Step 2: Parse XML
  console.log('\n🔍 Parsing XML data...');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  
  let parsedData;
  try {
    parsedData = parser.parse(xmlData);
  } catch (error) {
    console.error('   ✗ Failed to parse XML:', error.message);
    process.exit(1);
  }

  // Extract stations
  const stations = parsedData.stations?.station || [];
  console.log(`   Found ${stations.length} total stations`);

  // Step 3: Filter and assign to districts
  console.log('\n📊 Filtering and assigning stations to districts...');
  console.log('   Filters:');
  console.log('   - Has meteorological data (met="y")');
  console.log('   - Falls within a defined district boundary');
  console.log('');

  const byDistrict = {};
  const outsideRegions = [];
  let filteredCount = 0;

  for (const station of stations) {
    const id = station['@_id'];
    const lat = parseFloat(station['@_lat']);
    const lng = parseFloat(station['@_lon']);
    const name = station['@_name'] || '';
    const owner = station['@_owner'] || '';
    const type = station['@_type'] || 'buoy';
    const met = station['@_met']; // 'y' or 'n'

    // Filter: must have meteorological data
    if (met !== 'y') {
      continue;
    }

    // Assign to district
    const districtId = assignDistrict(lat, lng);
    
    if (!districtId) {
      outsideRegions.push({ id, name, lat, lng });
      continue;
    }

    if (!byDistrict[districtId]) {
      byDistrict[districtId] = [];
    }

    byDistrict[districtId].push({
      id,
      name,
      latitude: lat,
      longitude: lng,
      type,
      owner,
      districtId,
    });

    filteredCount++;
  }

  // Summary
  console.log(`   Assigned ${filteredCount} buoys to ${Object.keys(byDistrict).length} districts:`);
  for (const [districtId, districtStations] of Object.entries(byDistrict)) {
    const regionName = REGION_BOUNDS[districtId]?.name || districtId;
    console.log(`     ${districtId} (${regionName}): ${districtStations.length} buoys`);
  }

  if (outsideRegions.length > 0) {
    console.log(`\n   ⚠️  ${outsideRegions.length} buoys outside defined regions (will be skipped):`);
    outsideRegions.slice(0, 5).forEach(s => {
      console.log(`      ${s.id}: ${s.name} (${s.lat}, ${s.lng})`);
    });
    if (outsideRegions.length > 5) {
      console.log(`      ... and ${outsideRegions.length - 5} more`);
    }
  }

  // Step 4: Write to Firestore
  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would write the following to Firestore:');
    for (const [districtId, districtStations] of Object.entries(byDistrict)) {
      console.log(`\n  districts/${districtId}/buoys/catalog:`);
      console.log(`    - stations: ${districtStations.length} entries`);
      console.log(`    - stationCount: ${districtStations.length}`);
      console.log(`    - lastUpdated: ${new Date().toISOString()}`);
      
      console.log(`\n  districts/${districtId}/buoys/{buoyId}: (${districtStations.length} documents)`);
      districtStations.slice(0, 3).forEach(s => {
        console.log(`    - ${s.id}: ${s.name}`);
      });
      if (districtStations.length > 3) {
        console.log(`    - ... and ${districtStations.length - 3} more`);
      }
    }
    
    console.log('\n✓ DRY RUN complete. Run without --dry-run to apply changes.\n');
    process.exit(0);
  }

  // Actually write to Firestore
  console.log('\n💾 Writing to Firestore...\n');
  
  let totalCatalogWrites = 0;
  let totalBuoyWrites = 0;
  let totalErrors = 0;

  for (const [districtId, districtStations] of Object.entries(byDistrict)) {
    console.log(`📦 Processing ${districtId} (${districtStations.length} buoys)...`);
    
    // Check that district document exists
    const districtDoc = await db.collection('districts').doc(districtId).get();
    if (!districtDoc.exists) {
      console.log(`   ⚠️  District document not found, skipping`);
      continue;
    }

    // Write catalog
    const catalogData = {
      stations: districtStations,
      lastUpdated: new Date().toISOString(),
      stationCount: districtStations.length,
      generatedBy: 'discover-ndbc-buoys.js',
      generatedAt: new Date().toISOString(),
    };

    try {
      await db.collection('districts').doc(districtId)
        .collection('buoys').doc('catalog').set(catalogData);
      console.log(`   ✓ Wrote catalog (${districtStations.length} stations)`);
      totalCatalogWrites++;
    } catch (error) {
      console.error(`   ✗ Error writing catalog: ${error.message}`);
      totalErrors++;
      continue;
    }

    // Write individual buoy documents
    let successCount = 0;
    let errorCount = 0;

    for (const station of districtStations) {
      try {
        await db.collection('districts').doc(districtId)
          .collection('buoys').doc(station.id).set({
            ...station,
            // No latestObservation yet - will be populated by updateBuoyData Cloud Function
          });
        successCount++;
      } catch (error) {
        console.error(`   ✗ Error writing ${station.id}: ${error.message}`);
        errorCount++;
      }
    }

    totalBuoyWrites += successCount;
    totalErrors += errorCount;
    console.log(`   ✓ Wrote ${successCount} buoy documents, ${errorCount} errors\n`);
  }

  // Final Summary
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  Discovery Complete');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`  Districts processed: ${Object.keys(byDistrict).length}`);
  console.log(`  Catalogs written: ${totalCatalogWrites}`);
  console.log(`  Buoy documents written: ${totalBuoyWrites}`);
  console.log(`  Errors: ${totalErrors}`);
  console.log(`  Stations outside regions: ${outsideRegions.length}`);
  console.log('════════════════════════════════════════════════════════════════\n');
  console.log('✅ Next step: Trigger Cloud Function to fetch initial observations');
  console.log('   Run: gcloud functions call triggerBuoyUpdate --project xnautical-8a296\n');
}

main().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});

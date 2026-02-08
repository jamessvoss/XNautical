#!/usr/bin/env node
/**
 * Discover NOAA Stations & Assign to Regions
 *
 * Queries the NOAA CO-OPS metadata API for all US tide prediction and
 * tidal current prediction stations, assigns each to a geographic region
 * by checking lat/lng against the satelliteBounds stored in the Firestore
 * `regions` collection, then writes a `predictionConfig` object to each
 * region document.
 *
 * predictionConfig shape:
 *   {
 *     tideStations: [{ id, name, lat, lng }],
 *     currentStations: [{ id, name, lat, lng, bin, depth, depthType }],
 *     lastDiscovered: Timestamp,
 *   }
 *
 * Usage:
 *   node scripts/discover-noaa-stations.js               # live write
 *   node scripts/discover-noaa-stations.js --dry-run      # preview only
 *   node scripts/discover-noaa-stations.js --region 11cgd # single region
 */

const admin = require('firebase-admin');
const path = require('path');
const https = require('https');

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

// ============================================================================
// NOAA metadata API
// ============================================================================

const NOAA_METADATA_BASE = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi';

/**
 * Fetch JSON from a URL via https.get (no external deps needed).
 */
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        res.resume();
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Fetch all tide prediction stations from NOAA metadata API.
 * Returns array of { id, name, lat, lng }.
 */
async function fetchTideStations() {
  console.log('Fetching tide prediction stations from NOAA...');
  const url = `${NOAA_METADATA_BASE}/stations.json?type=tidepredictions&units=english`;
  const data = await fetchJSON(url);

  const stations = (data.stations || []).map((s) => ({
    id: String(s.id),
    name: s.name || '',
    lat: parseFloat(s.lat),
    lng: parseFloat(s.lng),
  })).filter((s) => !isNaN(s.lat) && !isNaN(s.lng));

  console.log(`  Found ${stations.length} tide prediction stations`);
  return stations;
}

/**
 * Fetch all current prediction stations from NOAA metadata API.
 * Returns array of { id, name, lat, lng, bin, depth, depthType, noaaType }.
 *
 * NOAA station types:
 *   H = Harmonic (reference station with full predictions)
 *   S = Subordinate (predictions derived from a reference station)
 *   W = Weak and Variable (currents too weak/variable for predictions)
 *
 * Many current stations have multiple bins (depth levels). We keep only
 * the surface bin (bin 1) or the single bin if there's only one, to avoid
 * duplicating the station. The full bin list can be fetched later if needed.
 */
async function fetchCurrentStations() {
  console.log('Fetching current prediction stations from NOAA...');
  const url = `${NOAA_METADATA_BASE}/stations.json?type=currentpredictions&units=english`;
  const data = await fetchJSON(url);

  const raw = (data.stations || data.currentPredictionStations || []);

  // Group by base station ID (strip bin suffix like _1, _2)
  // NOAA current stations have IDs like "ACT1116_1" where _1 is the bin
  const stationMap = new Map();
  let weakCount = 0;

  for (const s of raw) {
    const id = String(s.id);
    const name = s.name || '';
    const lat = parseFloat(s.lat);
    const lng = parseFloat(s.lng);

    if (isNaN(lat) || isNaN(lng)) continue;

    // Extract bin number from the station record
    const bin = parseInt(s.bin || s.currbin || '1', 10) || 1;
    const depth = s.depth ? parseFloat(s.depth) : null;
    const depthType = s.depthType || s.depth_type || 'surface';

    // NOAA type: H=Harmonic, S=Subordinate, W=Weak and Variable
    const noaaType = s.type || 'S';

    // Use the station ID as-is (includes bin suffix)
    // But prefer bin 1 (surface) when grouping
    const baseId = id.replace(/_\d+$/, '');

    if (!stationMap.has(baseId)) {
      stationMap.set(baseId, {
        id: id,
        name: name,
        lat: lat,
        lng: lng,
        bin: bin,
        depth: depth,
        depthType: depthType,
        noaaType: noaaType,
      });
      if (noaaType === 'W') weakCount++;
    } else {
      // Keep the surface bin (lowest bin number)
      const existing = stationMap.get(baseId);
      if (bin < existing.bin) {
        stationMap.set(baseId, {
          id: id,
          name: name,
          lat: lat,
          lng: lng,
          bin: bin,
          depth: depth,
          depthType: depthType,
          noaaType: noaaType,
        });
      }
    }
  }

  const stations = Array.from(stationMap.values());
  console.log(`  Found ${raw.length} raw current entries → ${stations.length} unique stations (surface bins)`);
  console.log(`  Of which ${weakCount} are type W (weak and variable)`);
  return stations;
}

// ============================================================================
// Geographic assignment
// ============================================================================

/**
 * Check if a point (lat, lng) falls within any of the bounding boxes.
 * Handles antimeridian crossing for regions like 17cgd (Alaska).
 */
function pointInBounds(lat, lng, boundsArray) {
  for (const b of boundsArray) {
    const { west, south, east, north } = b;

    if (lat < south || lat > north) continue;

    // Normal case (no antimeridian crossing)
    if (west <= east) {
      if (lng >= west && lng <= east) return true;
    } else {
      // Antimeridian crossing: west > east (e.g., 170 to -129)
      if (lng >= west || lng <= east) return true;
    }
  }
  return false;
}

/**
 * Assign stations to regions based on satelliteBounds.
 * Returns a Map<regionId, { tideStations, currentStations }>.
 */
function assignStationsToRegions(tideStations, currentStations, regions) {
  const assignments = new Map();

  // Initialize each region
  for (const region of regions) {
    assignments.set(region.regionId, {
      regionId: region.regionId,
      regionName: region.name,
      tideStations: [],
      currentStations: [],
    });
  }

  // Sort regions so that smaller (more specific) regions are checked first
  // This handles overlap (e.g., 01cgd overlaps with 05cgd at the boundary)
  const sortedRegions = [...regions].sort((a, b) => {
    const areaA = a.satelliteBounds.reduce((sum, bb) =>
      sum + (bb.east - bb.west) * (bb.north - bb.south), 0);
    const areaB = b.satelliteBounds.reduce((sum, bb) =>
      sum + (bb.east - bb.west) * (bb.north - bb.south), 0);
    return areaA - areaB; // Smaller regions first
  });

  let tideAssigned = 0;
  let tideUnassigned = 0;
  let currentAssigned = 0;
  let currentUnassigned = 0;

  // Assign tide stations
  for (const station of tideStations) {
    let assigned = false;
    for (const region of sortedRegions) {
      if (pointInBounds(station.lat, station.lng, region.satelliteBounds)) {
        assignments.get(region.regionId).tideStations.push({
          id: station.id,
          name: station.name,
          lat: station.lat,
          lng: station.lng,
        });
        assigned = true;
        tideAssigned++;
        break; // Assign to first matching (smallest) region
      }
    }
    if (!assigned) tideUnassigned++;
  }

  // Assign current stations
  let weakAssigned = 0;
  for (const station of currentStations) {
    let assigned = false;
    for (const region of sortedRegions) {
      if (pointInBounds(station.lat, station.lng, region.satelliteBounds)) {
        assignments.get(region.regionId).currentStations.push({
          id: station.id,
          name: station.name,
          lat: station.lat,
          lng: station.lng,
          bin: station.bin,
          depth: station.depth,
          depthType: station.depthType,
          noaaType: station.noaaType,  // H=Harmonic, S=Subordinate, W=Weak and Variable
        });
        assigned = true;
        currentAssigned++;
        if (station.noaaType === 'W') weakAssigned++;
        break;
      }
    }
    if (!assigned) currentUnassigned++;
  }

  console.log(`\nAssignment summary:`);
  console.log(`  Tide:    ${tideAssigned} assigned, ${tideUnassigned} outside all regions`);
  console.log(`  Current: ${currentAssigned} assigned, ${currentUnassigned} outside all regions`);
  console.log(`           (${weakAssigned} of assigned are type W = weak and variable)`);

  return assignments;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`\n=== NOAA Station Discovery & Region Assignment ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
  if (regionFilter) console.log(`Region filter: ${regionFilter}`);
  console.log('');

  // 1. Load regions from Firestore
  console.log('Loading regions from Firestore...');
  const regionsSnapshot = await db.collection('districts').get();
  const regions = [];

  regionsSnapshot.forEach((doc) => {
    const data = doc.data();
    if (!data.satelliteBounds || !Array.isArray(data.satelliteBounds)) {
      console.warn(`  Skipping ${doc.id}: no satelliteBounds`);
      return;
    }
    if (regionFilter && doc.id !== regionFilter) return;

    regions.push({
      regionId: doc.id,
      name: data.name,
      satelliteBounds: data.satelliteBounds,
    });
  });

  console.log(`  Loaded ${regions.length} region(s)\n`);

  if (regions.length === 0) {
    console.error('No regions found. Run populate-region-config.js first.');
    process.exit(1);
  }

  // 2. Fetch all NOAA stations
  const tideStations = await fetchTideStations();
  const currentStations = await fetchCurrentStations();

  // 3. Assign to regions
  console.log('\nAssigning stations to regions...');
  const assignments = assignStationsToRegions(tideStations, currentStations, regions);

  // 4. Display results
  console.log('\n--- Results ---\n');

  for (const [regionId, assignment] of assignments) {
    const tideCount = assignment.tideStations.length;
    const currentCount = assignment.currentStations.length;
    const weakCount = assignment.currentStations.filter(s => s.noaaType === 'W').length;
    const predictableCount = currentCount - weakCount;

    console.log(`${regionId} (${assignment.regionName}):`);
    console.log(`  Tide stations:    ${tideCount}`);
    console.log(`  Current stations: ${currentCount}${weakCount > 0 ? ` (${predictableCount} predictable, ${weakCount} weak & variable)` : ''}`);

    if (tideCount > 0) {
      console.log(`  Sample tides: ${assignment.tideStations.slice(0, 3).map(s => s.name).join(', ')}...`);
    }
    if (currentCount > 0) {
      console.log(`  Sample currents: ${assignment.currentStations.slice(0, 3).map(s => s.name).join(', ')}...`);
    }
    if (weakCount > 0) {
      console.log(`  Weak & variable: ${assignment.currentStations.filter(s => s.noaaType === 'W').map(s => s.name).join(', ')}`);
    }
    console.log('');
  }

  // 5. Write to Firestore
  if (!dryRun) {
    console.log('Writing predictionConfig to Firestore...\n');

    for (const [regionId, assignment] of assignments) {
      const docRef = db.collection('districts').doc(regionId);

      const weakStations = assignment.currentStations.filter(s => s.noaaType === 'W');
      const predictionConfig = {
        tideStations: assignment.tideStations,
        currentStations: assignment.currentStations,
        lastDiscovered: admin.firestore.FieldValue.serverTimestamp(),
        tideStationCount: assignment.tideStations.length,
        currentStationCount: assignment.currentStations.length,
        currentStationWeakCount: weakStations.length,
      };

      await docRef.set({ predictionConfig }, { merge: true });
      console.log(`  Written: regions/${regionId}/predictionConfig (${assignment.tideStations.length} tide, ${assignment.currentStations.length} current)`);
    }

    console.log('\nAll predictionConfig documents written successfully.');
  } else {
    console.log('[DRY RUN] No writes performed. Remove --dry-run to write to Firestore.');
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

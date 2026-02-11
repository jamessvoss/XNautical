#!/usr/bin/env node
/**
 * trigger-buoy-update.js
 * 
 * Manually triggers the triggerBuoyUpdate Cloud Function to fetch latest observations
 * for all buoys from NDBC.
 * 
 * Usage:
 *   node scripts/trigger-buoy-update.js              # Update all districts
 *   node scripts/trigger-buoy-update.js --district 17cgd   # Update specific district
 */

const admin = require('firebase-admin');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const districtIdArg = args.indexOf('--district');
const districtId = districtIdArg !== -1 ? args[districtIdArg + 1] : null;

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
// Fetch Buoy Observation (matches Cloud Function logic)
// ============================================================================

async function fetchBuoyObservation(stationId) {
  const idsToTry = [stationId, stationId.toUpperCase(), stationId.toLowerCase()];
  const uniqueIds = [...new Set(idsToTry)];
  
  // Try realtime2 format first (standard buoys)
  for (const id of uniqueIds) {
    try {
      const url = `https://www.ndbc.noaa.gov/data/realtime2/${id}.txt`;
      const response = await fetch(url);
      
      if (!response.ok) continue;
      
      const text = await response.text();
      if (text.includes('<!DOCTYPE')) continue;
      
      const lines = text.split('\n');
      if (lines.length < 3) continue;
      
      const headers = lines[0].replace('#', '').trim().split(/\s+/);
      const dataLine = lines[2].trim().split(/\s+/);
      
      if (dataLine.length < 5) continue;
      
      const getValue = (header) => {
        const idx = headers.indexOf(header);
        if (idx === -1 || idx >= dataLine.length) return undefined;
        const val = parseFloat(dataLine[idx]);
        return isNaN(val) || val === 99 || val === 999 || val === 9999 ? undefined : val;
      };
      
      // Build timestamp from date components
      const year = dataLine[0];
      const month = dataLine[1];
      const day = dataLine[2];
      const hour = dataLine[3];
      const minute = dataLine[4];
      const timestamp = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00Z`;
      
      // Build observation object, filtering out undefined values
      const observation = { timestamp };
      
      // Only add defined values
      const windDirection = getValue('WDIR');
      if (windDirection !== undefined) observation.windDirection = windDirection;
      
      const windSpeed = getValue('WSPD');
      if (windSpeed !== undefined) observation.windSpeed = windSpeed;
      
      const windGust = getValue('GST');
      if (windGust !== undefined) observation.windGust = windGust;
      
      const waveHeight = getValue('WVHT');
      if (waveHeight !== undefined) observation.waveHeight = waveHeight;
      
      const dominantWavePeriod = getValue('DPD');
      if (dominantWavePeriod !== undefined) observation.dominantWavePeriod = dominantWavePeriod;
      
      const averageWavePeriod = getValue('APD');
      if (averageWavePeriod !== undefined) observation.averageWavePeriod = averageWavePeriod;
      
      const meanWaveDirection = getValue('MWD');
      if (meanWaveDirection !== undefined) observation.meanWaveDirection = meanWaveDirection;
      
      const pressure = getValue('PRES');
      if (pressure !== undefined) observation.pressure = pressure;
      
      const airTemp = getValue('ATMP');
      if (airTemp !== undefined) observation.airTemp = airTemp;
      
      const waterTemp = getValue('WTMP');
      if (waterTemp !== undefined) observation.waterTemp = waterTemp;
      
      const dewPoint = getValue('DEWP');
      if (dewPoint !== undefined) observation.dewPoint = dewPoint;
      
      const visibility = getValue('VIS');
      if (visibility !== undefined) observation.visibility = visibility;
      
      const pressureTendency = getValue('PTDY');
      if (pressureTendency !== undefined) observation.pressureTendency = pressureTendency;
      
      const tide = getValue('TIDE');
      if (tide !== undefined) observation.tide = tide;
      
      return observation;
    } catch (error) {
      // Continue to next attempt
    }
  }
  
  // Try latest_obs format as fallback
  for (const id of uniqueIds) {
    try {
      const url = `https://www.ndbc.noaa.gov/data/latest_obs/${id}.txt`;
      const response = await fetch(url);
      
      if (!response.ok) continue;
      
      const text = await response.text();
      if (text.includes('<!DOCTYPE')) continue;
      
      const lines = text.split('\n');
      const data = {};
      
      for (const line of lines) {
        const match = line.match(/^([^:]+):\s*(.+)$/);
        if (match) {
          data[match[1].trim()] = match[2].trim();
        }
      }
      
      if (Object.keys(data).length < 3) continue;
      
      const parseValue = (str) => {
        if (!str) return undefined;
        const num = parseFloat(str.split(' ')[0]);
        return isNaN(num) ? undefined : num;
      };
      
      // Build observation object, filtering out undefined values
      const observation = {
        timestamp: new Date().toISOString(),
      };
      
      // Only add defined values
      const windSpeed = parseValue(data['Wind']);
      if (windSpeed !== undefined) observation.windSpeed = windSpeed;
      
      const windGust = parseValue(data['Gust']);
      if (windGust !== undefined) observation.windGust = windGust;
      
      const waveHeight = parseValue(data['Wave Height']);
      if (waveHeight !== undefined) observation.waveHeight = waveHeight;
      
      const dominantWavePeriod = parseValue(data['Dominant Wave Period']);
      if (dominantWavePeriod !== undefined) observation.dominantWavePeriod = dominantWavePeriod;
      
      const pressure = parseValue(data['Pressure']);
      if (pressure !== undefined) observation.pressure = pressure;
      
      const airTemp = parseValue(data['Air Temp']);
      if (airTemp !== undefined) observation.airTemp = airTemp;
      
      const waterTemp = parseValue(data['Water Temp']);
      if (waterTemp !== undefined) observation.waterTemp = waterTemp;
      
      return observation;
    } catch (error) {
      // Continue to next attempt
    }
  }
  
  return null;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  Trigger Buoy Update                                          ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  if (districtId) {
    console.log(`Target: ${districtId}\n`);
  } else {
    console.log('Target: All districts\n');
  }

  console.log('📡 Fetching district catalogs...\n');

  // Get districts to process
  const districtIds = [];
  if (districtId) {
    districtIds.push(districtId);
  } else {
    const districtsSnap = await db.collection('districts').get();
    districtsSnap.forEach(doc => districtIds.push(doc.id));
  }

  let totalStations = 0;
  let totalSuccess = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const district of districtIds) {
    console.log(`📦 Processing ${district}...`);
    
    const catalogDoc = await db.collection('districts').doc(district)
      .collection('buoys').doc('catalog').get();
    
    if (!catalogDoc.exists) {
      console.log(`   ⚠️  No catalog found, skipping\n`);
      continue;
    }

    const catalog = catalogDoc.data();
    const stations = catalog.stations || [];
    
    if (stations.length === 0) {
      console.log(`   ⚠️  No stations in catalog, skipping\n`);
      continue;
    }

    console.log(`   Found ${stations.length} buoys in catalog`);
    totalStations += stations.length;

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    // Fetch observations for each station
    for (const station of stations) {
      try {
        const observation = await fetchBuoyObservation(station.id);
        
        if (!observation) {
          skipCount++;
          continue;
        }

        // Update buoy document
        await db.collection('districts').doc(district)
          .collection('buoys').doc(station.id).set({
            ...station,
            latestObservation: observation,
            lastUpdated: new Date().toISOString(),
          }, { merge: true });

        successCount++;
      } catch (error) {
        errorCount++;
      }
    }

    totalSuccess += successCount;
    totalSkipped += skipCount;
    totalErrors += errorCount;

    console.log(`   ✓ Updated ${successCount} buoys, ${skipCount} skipped, ${errorCount} errors\n`);
  }

  // Summary
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  Update Complete');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`  Districts processed: ${districtIds.length}`);
  console.log(`  Total stations: ${totalStations}`);
  console.log(`  Successfully updated: ${totalSuccess}`);
  console.log(`  Skipped: ${totalSkipped}`);
  console.log(`  Errors: ${totalErrors}`);
  console.log('════════════════════════════════════════════════════════════════\n');
}

main().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});

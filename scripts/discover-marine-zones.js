#!/usr/bin/env node
/**
 * discover-marine-zones.js
 * 
 * Downloads NOAA marine zone shapefiles and populates Firestore with zones
 * for specified USCG Coast Guard Districts.
 * 
 * Process:
 *   1. Downloads coastal and offshore marine zone shapefiles from NOAA
 *   2. Reads shapefiles and extracts zone metadata
 *   3. Maps zones to districts based on centroid location
 *   4. Uploads to Firestore: marine-forecast-districts/{districtId}/marine-zones/
 * 
 * Usage:
 *   node scripts/discover-marine-zones.js --district 07cgd    # Single district
 *   node scripts/discover-marine-zones.js --all               # All districts
 *   node scripts/discover-marine-zones.js --dry-run           # Preview only
 * 
 * Prerequisites:
 *   npm install firebase-admin adm-zip shapefile
 */

const admin = require('firebase-admin');
const https = require('https');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const shapefile = require('shapefile');

// NOAA Marine Zone Shapefile URLs (March 2026 versions)
const COASTAL_ZONES_URL = 'https://www.weather.gov/source/gis/Shapefiles/WSOM/mz03mr26.zip';
const OFFSHORE_ZONES_URL = 'https://www.weather.gov/source/gis/Shapefiles/WSOM/oz03mr26.zip';

// USCG Coast Guard District bounds (from regionData.ts)
const DISTRICT_BOUNDS = {
  '01cgd': { name: 'Northeast', bounds: [{ west: -76, south: 39, east: -65, north: 48 }] },
  '05cgd': { name: 'East', bounds: [{ west: -82, south: 32, east: -72, north: 42 }] },
  '07cgd': { name: 'Southeast', bounds: [{ west: -85, south: 23, east: -63, north: 35 }] },
  '08cgd': { name: 'Heartland', bounds: [{ west: -100, south: 23, east: -80, north: 33 }] },
  '09cgd': { name: 'Great Lakes', bounds: [{ west: -94, south: 40, east: -75, north: 50 }] },
  '11cgd': { name: 'Southwest', bounds: [{ west: -126, south: 30, east: -114, north: 39 }] },
  '13cgd': { name: 'Northwest', bounds: [{ west: -130, south: 33, east: -119, north: 50 }] },
  '14cgd': { name: 'Oceania', bounds: [{ west: -162, south: 17, east: -153, north: 24 }] },
  '17cgd': { name: 'Arctic', bounds: [
    { west: -180, south: 50, east: -129, north: 72 },
    { west: 170, south: 50, east: 180, north: 65 }
  ]},
};

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ALL_DISTRICTS = args.includes('--all');
const districtArg = args.find(a => a.startsWith('--district='));
const TARGET_DISTRICT = districtArg ? districtArg.split('=')[1] : null;

if (!ALL_DISTRICTS && !TARGET_DISTRICT) {
  console.error('Usage:');
  console.error('  node scripts/discover-marine-zones.js --district=07cgd');
  console.error('  node scripts/discover-marine-zones.js --all');
  console.error('  node scripts/discover-marine-zones.js --district=07cgd --dry-run');
  process.exit(1);
}

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
 * Download a file from URL
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`  Downloading ${path.basename(dest)}...`);
    const file = fs.createWriteStream(dest);
    
    const doDownload = (downloadUrl) => {
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      };
      
      https.get(downloadUrl, options, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Follow redirect
          file.close();
          fs.unlinkSync(dest);
          doDownload(response.headers.location);
        } else if (response.statusCode === 200) {
          response.pipe(file);
          file.on('finish', () => {
            file.close(() => resolve());
          });
          file.on('error', (err) => {
            fs.unlinkSync(dest);
            reject(err);
          });
        } else {
          file.close();
          fs.unlinkSync(dest);
          reject(new Error(`HTTP ${response.statusCode}`));
        }
      }).on('error', (err) => {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(err);
      });
    };
    
    doDownload(url);
  });
}

/**
 * Extract shapefile from zip
 */
function extractShapefile(zipPath, extractDir) {
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(extractDir, true);
  
  // Find the .shp file
  const files = fs.readdirSync(extractDir);
  const shpFile = files.find(f => f.endsWith('.shp'));
  
  if (!shpFile) {
    throw new Error('No .shp file found in zip');
  }
  
  return path.join(extractDir, shpFile);
}

/**
 * Check if a point is within any of the district's bounds
 */
function isPointInDistrict(lon, lat, district) {
  const bounds = DISTRICT_BOUNDS[district].bounds;
  
  for (const b of bounds) {
    if (lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north) {
      return true;
    }
  }
  
  return false;
}

/**
 * Read shapefile and extract zones for target districts
 */
async function readZonesFromShapefile(shpPath, targetDistricts) {
  console.log(`  Reading shapefile: ${path.basename(shpPath)}`);
  
  const zones = [];
  const source = await shapefile.open(shpPath);
  
  let result = await source.read();
  while (!result.done) {
    const feature = result.value;
    const props = feature.properties;
    const geometry = feature.geometry;
    
    // Extract centroid from properties (LON, LAT fields)
    const lon = parseFloat(props.LON);
    const lat = parseFloat(props.LAT);
    
    if (isNaN(lon) || isNaN(lat)) {
      result = await source.read();
      continue;
    }
    
    // Determine which districts this zone belongs to
    const districts = [];
    for (const districtId of targetDistricts) {
      if (isPointInDistrict(lon, lat, districtId)) {
        districts.push(districtId);
      }
    }
    
    if (districts.length > 0) {
      zones.push({
        id: props.ID,
        name: props.NAME || props.Name || props.id,  // Try different attribute names
        wfo: props.WFO || '',
        centroid: { lon, lat },
        geometry,
        districts,
      });
    }
    
    result = await source.read();
  }
  
  console.log(`  Found ${zones.length} zones in target districts`);
  return zones;
}

/**
 * Upload zones to Firestore
 */
async function uploadZonesToFirestore(zones, targetDistricts) {
  console.log(`\n📤 Uploading zones to Firestore...`);
  
  const stats = {};
  for (const districtId of targetDistricts) {
    stats[districtId] = { uploaded: 0, errors: 0 };
  }
  
  for (const zone of zones) {
    for (const districtId of zone.districts) {
      const docRef = db.collection('districts').doc(districtId)
        .collection('marine-zones').doc(zone.id);
      
      const data = {
        id: zone.id,
        name: zone.name,
        wfo: zone.wfo,
        centroid: zone.centroid,
        geometryJson: JSON.stringify(zone.geometry),
        districtId: districtId,
      };
      
      if (DRY_RUN) {
        console.log(`   [DRY RUN] Would upload: ${districtId}/${zone.id} (${zone.name})`);
        stats[districtId].uploaded++;
      } else {
        try {
          await docRef.set(data);
          stats[districtId].uploaded++;
          
          const total = Object.values(stats).reduce((sum, s) => sum + s.uploaded, 0);
          if (total % 25 === 0) {
            console.log(`   ✓ Uploaded ${total} zones...`);
          }
        } catch (error) {
          console.error(`   ✗ Error uploading ${districtId}/${zone.id}: ${error.message}`);
          stats[districtId].errors++;
        }
      }
    }
  }
  
  return stats;
}

/**
 * Main function
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  Marine Zones Discovery: NOAA Shapefiles → Firestore         ║');
  if (DRY_RUN) {
    console.log('║  MODE: DRY RUN (no changes will be made)                      ║');
  }
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  
  const startTime = Date.now();
  const tempDir = path.join(__dirname, '.temp-marine-zones');
  
  // Determine target districts
  const targetDistricts = ALL_DISTRICTS 
    ? Object.keys(DISTRICT_BOUNDS)
    : [TARGET_DISTRICT];
  
  console.log(`\n📍 Target districts: ${targetDistricts.join(', ')}`);
  
  try {
    // Create temp directory
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    console.log('\n📥 Downloading NOAA shapefiles...');
    
    // Download coastal zones
    const coastalZip = path.join(tempDir, 'mz03mr26.zip');
    await downloadFile(COASTAL_ZONES_URL, coastalZip);
    
    // Download offshore zones
    const offshoreZip = path.join(tempDir, 'oz03mr26.zip');
    await downloadFile(OFFSHORE_ZONES_URL, offshoreZip);
    
    console.log('\n📦 Extracting shapefiles...');
    
    // Extract coastal zones
    const coastalDir = path.join(tempDir, 'coastal');
    fs.mkdirSync(coastalDir, { recursive: true });
    const coastalShp = extractShapefile(coastalZip, coastalDir);
    console.log(`  ✓ Extracted: ${path.basename(coastalShp)}`);
    
    // Extract offshore zones
    const offshoreDir = path.join(tempDir, 'offshore');
    fs.mkdirSync(offshoreDir, { recursive: true });
    const offshoreShp = extractShapefile(offshoreZip, offshoreDir);
    console.log(`  ✓ Extracted: ${path.basename(offshoreShp)}`);
    
    console.log('\n🔍 Reading and mapping zones to districts...');
    
    // Read zones from both shapefiles
    const coastalZones = await readZonesFromShapefile(coastalShp, targetDistricts);
    const offshoreZones = await readZonesFromShapefile(offshoreShp, targetDistricts);
    
    const allZones = [...coastalZones, ...offshoreZones];
    console.log(`\n  Total zones found: ${allZones.length}`);
    
    // Count by district
    const districtCounts = {};
    for (const districtId of targetDistricts) {
      const count = allZones.filter(z => z.districts.includes(districtId)).length;
      districtCounts[districtId] = count;
      console.log(`    ${districtId} (${DISTRICT_BOUNDS[districtId].name}): ${count} zones`);
    }
    
    // Upload to Firestore
    const uploadStats = await uploadZonesToFirestore(allZones, targetDistricts);
    
    // Clean up temp directory
    console.log('\n🧹 Cleaning up...');
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('                      DISCOVERY SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    
    for (const districtId of targetDistricts) {
      const stats = uploadStats[districtId];
      console.log(`  ${districtId}: ${stats.uploaded} uploaded, ${stats.errors} errors`);
    }
    
    console.log(`  Duration: ${duration}s`);
    
    if (DRY_RUN) {
      console.log('\n⚠️  This was a dry run. No changes were made.');
      console.log('   Run without --dry-run to apply changes.');
    } else {
      console.log('\n✓ Discovery and upload complete!');
      console.log('\nNext steps:');
      console.log('  1. Update cloud functions to fetch forecasts for new districts');
      console.log('  2. Test Weather screen with new districts');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

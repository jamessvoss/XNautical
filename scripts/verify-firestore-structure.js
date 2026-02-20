#!/usr/bin/env node
/**
 * Verify Firestore District Data
 * 
 * Checks that all expected collections and documents exist in Firestore
 * for each Coast Guard district.
 * 
 * Expected structure per district:
 * districts/{districtId}
 *   - Basic district info (name, code, bounds, etc.)
 *   - /buoys/catalog (buoy stations catalog)
 *   - /buoys/{buoyId} (individual buoy documents)
 *   - /marine-zones/{zoneId} (marine forecast zones)
 */

const admin = require('firebase-admin');
const path = require('path');

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
  console.error('  xnautical-service-account.json');
  process.exit(1);
}

const db = admin.firestore();

// District IDs to check
const DISTRICT_IDS = [
  '01cgd', // 1st District - Northeast (Boston)
  '05cgd', // 5th District - Mid-Atlantic (Portsmouth)
  '07cgd', // 7th District - Southeast (Miami)
  '08cgd', // 8th District - Gulf Coast (New Orleans)
  '09cgd', // 9th District - Great Lakes (Cleveland)
  '11cgd', // 11th District - Pacific (Alameda)
  '13cgd', // 13th District - Pacific Northwest (Seattle)
  '14cgd', // 14th District - Pacific Islands (Honolulu)
  '17cgd', // 17th District - Alaska (Juneau)
];

async function checkDistrict(districtId) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Checking District: ${districtId}`);
  console.log('='.repeat(80));

  const results = {
    districtId,
    districtDoc: null,
    buoys: { catalog: null, stations: [] },
    marineZones: [],
    issues: [],
    warnings: []
  };

  // Check district document
  console.log('\n📄 DISTRICT DOCUMENT:');
  try {
    const districtRef = db.collection('districts').doc(districtId);
    const districtSnap = await districtRef.get();
    
    if (districtSnap.exists) {
      const data = districtSnap.data();
      results.districtDoc = data;
      console.log(`  ✅ District document exists`);
      console.log(`     Name: ${data.name || 'N/A'}`);
      console.log(`     Code: ${data.code || 'N/A'}`);
      console.log(`     Bounds: ${data.bounds ? 'Present' : 'Missing'}`);
      
      if (!data.name || !data.code) {
        results.warnings.push('District document missing name or code');
      }
      if (!data.bounds) {
        results.warnings.push('District document missing bounds');
      }
    } else {
      console.log(`  ❌ District document MISSING`);
      results.issues.push('District document does not exist');
    }
  } catch (error) {
    console.log(`  ❌ Error checking district document: ${error.message}`);
    results.issues.push(`Error reading district: ${error.message}`);
  }

  // Check buoys
  console.log('\n🔴 BUOYS:');
  try {
    // Check catalog
    const catalogRef = db.collection('districts').doc(districtId).collection('buoys').doc('catalog');
    const catalogSnap = await catalogRef.get();
    
    if (catalogSnap.exists) {
      const catalogData = catalogSnap.data();
      const stations = catalogData.stations || [];
      results.buoys.catalog = catalogData;
      results.buoys.stations = stations;
      
      console.log(`  ✅ Buoy catalog exists`);
      console.log(`     Stations: ${stations.length}`);
      console.log(`     Last updated: ${catalogData.lastUpdated || 'N/A'}`);
      
      if (stations.length === 0) {
        results.warnings.push('Buoy catalog exists but has 0 stations');
      }
      
      // Sample a few individual buoy documents
      if (stations.length > 0) {
        const sampleSize = Math.min(3, stations.length);
        const sampleStations = stations.slice(0, sampleSize);
        
        console.log(`     Checking ${sampleSize} sample buoy documents...`);
        for (const station of sampleStations) {
          const buoyRef = db.collection('districts').doc(districtId).collection('buoys').doc(station.id);
          const buoySnap = await buoyRef.get();
          
          if (buoySnap.exists) {
            console.log(`       ✅ ${station.id}: Present`);
          } else {
            console.log(`       ⚠️  ${station.id}: Missing`);
            results.warnings.push(`Buoy document missing for ${station.id}`);
          }
        }
      }
    } else {
      console.log(`  ❌ Buoy catalog MISSING`);
      results.issues.push('Buoy catalog does not exist');
    }
  } catch (error) {
    console.log(`  ❌ Error checking buoys: ${error.message}`);
    results.issues.push(`Error reading buoys: ${error.message}`);
  }

  // Check marine zones
  console.log('\n🌊 MARINE ZONES:');
  try {
    const zonesRef = db.collection('districts').doc(districtId).collection('marine-zones');
    const zonesSnap = await zonesRef.get();
    
    if (!zonesSnap.empty) {
      results.marineZones = zonesSnap.docs.map(doc => ({
        id: doc.id,
        data: doc.data()
      }));
      
      console.log(`  ✅ Marine zones collection exists`);
      console.log(`     Zones: ${zonesSnap.size}`);
      
      // Sample a few zones
      const sampleSize = Math.min(3, zonesSnap.size);
      console.log(`     Sample zones:`);
      zonesSnap.docs.slice(0, sampleSize).forEach(doc => {
        const data = doc.data();
        console.log(`       ✅ ${doc.id}: ${data.name || 'N/A'}`);
      });
      
      if (zonesSnap.size === 0) {
        results.warnings.push('Marine zones collection empty');
      }
    } else {
      console.log(`  ⚠️  Marine zones collection EMPTY or MISSING`);
      results.warnings.push('No marine zones found');
    }
  } catch (error) {
    console.log(`  ❌ Error checking marine zones: ${error.message}`);
    results.issues.push(`Error reading marine zones: ${error.message}`);
  }

  // Summary
  console.log('\n' + '─'.repeat(80));
  console.log('SUMMARY:');
  console.log(`  Issues: ${results.issues.length}`);
  console.log(`  Warnings: ${results.warnings.length}`);
  
  if (results.issues.length > 0) {
    console.log('\n❌ ISSUES (Critical data missing):');
    results.issues.forEach(issue => console.log(`  - ${issue}`));
  }
  
  if (results.warnings.length > 0) {
    console.log('\n⚠️  WARNINGS (Data incomplete):');
    results.warnings.forEach(warning => console.log(`  - ${warning}`));
  }
  
  if (results.issues.length === 0 && results.warnings.length === 0) {
    console.log('  ✅ All Firestore data present!');
  }

  return results;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    FIRESTORE DISTRICT DATA VERIFICATION                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');

  const allResults = [];

  for (const districtId of DISTRICT_IDS) {
    const result = await checkDistrict(districtId);
    allResults.push(result);
  }

  // Overall summary
  console.log('\n\n');
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                            OVERALL SUMMARY                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  const totalIssues = allResults.reduce((sum, r) => sum + r.issues.length, 0);
  const totalWarnings = allResults.reduce((sum, r) => sum + r.warnings.length, 0);

  console.log(`Districts checked: ${DISTRICT_IDS.length}`);
  console.log(`Total issues: ${totalIssues}`);
  console.log(`Total warnings: ${totalWarnings}`);

  console.log('\n📊 District Status:');
  allResults.forEach(result => {
    const status = result.issues.length === 0 ? '✅' : '❌';
    const warnIcon = result.warnings.length > 0 ? '⚠️' : '';
    const buoyCount = result.buoys.stations.length;
    const zoneCount = result.marineZones.length;
    console.log(`  ${status} ${warnIcon} ${result.districtId}: ${buoyCount} buoys, ${zoneCount} zones`);
  });

  console.log('\n📈 Total Counts:');
  const totalBuoys = allResults.reduce((sum, r) => sum + r.buoys.stations.length, 0);
  const totalZones = allResults.reduce((sum, r) => sum + r.marineZones.length, 0);
  console.log(`  Total buoys: ${totalBuoys}`);
  console.log(`  Total marine zones: ${totalZones}`);

  if (totalIssues === 0 && totalWarnings === 0) {
    console.log('\n🎉 All Firestore data complete!');
  } else if (totalIssues === 0) {
    console.log('\n✅ No critical issues. Some data incomplete.');
  } else {
    console.log('\n❌ Some critical data is missing. Review issues above.');
  }

  process.exit(totalIssues > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});

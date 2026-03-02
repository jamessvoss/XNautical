#!/usr/bin/env node
/**
 * test-district-config.js
 * 
 * Test that the shared district-config module works correctly
 * and that ensureDistrictExists() properly creates/updates district documents.
 */

const admin = require('firebase-admin');
const path = require('path');
const { 
  DISTRICTS, 
  ensureDistrictExists, 
  getDistrictConfig, 
  getAllDistrictIds,
  isWithinDistrict,
  findDistrictsForCoordinates
} = require('./lib/district-config');

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
  process.exit(1);
}

const db = admin.firestore();

async function runTests() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    DISTRICT CONFIG MODULE TESTS                            ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  let passed = 0;
  let failed = 0;

  // Test 1: DISTRICTS object is populated (9 standard + 6 Alaska sub-regions + W. Florida + test = 17)
  console.log('Test 1: DISTRICTS object contains all regions');
  const districtIds = Object.keys(DISTRICTS);
  if (districtIds.length >= 9 && districtIds.includes('01cgd') && districtIds.includes('17cgd')) {
    console.log(`  ✅ PASS: ${districtIds.length} districts found`);
    console.log(`     ${districtIds.join(', ')}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: Expected at least 9 districts, found ${districtIds.length}`);
    failed++;
  }

  // Test 2: All districts have required fields
  console.log('\nTest 2: All districts have required fields (name, code, bounds)');
  let allHaveFields = true;
  for (const [id, config] of Object.entries(DISTRICTS)) {
    if (!config.name || !config.code || !config.bounds) {
      console.log(`  ❌ District ${id} missing required fields`);
      allHaveFields = false;
    }
  }
  if (allHaveFields) {
    console.log('  ✅ PASS: All districts have required fields');
    passed++;
  } else {
    failed++;
  }

  // Test 3: getAllDistrictIds()
  console.log('\nTest 3: getAllDistrictIds() returns correct array');
  const allIds = getAllDistrictIds();
  if (allIds.length >= 9 && allIds.includes('01cgd') && allIds.includes('17cgd') && allIds.includes('17cgd-Juneau')) {
    console.log(`  ✅ PASS: getAllDistrictIds() returns ${allIds.length} districts`);
    passed++;
  } else {
    console.log('  ❌ FAIL: getAllDistrictIds() returned incorrect result');
    failed++;
  }

  // Test 4: getDistrictConfig()
  console.log('\nTest 4: getDistrictConfig() retrieves district data');
  const config = getDistrictConfig('17cgd');
  if (config && config.name === 'All Alaska' && config.code === '17 CGD') {
    console.log('  ✅ PASS: getDistrictConfig() works correctly');
    console.log(`     17cgd: ${config.name} (${config.code})`);
    passed++;
  } else {
    console.log('  ❌ FAIL: getDistrictConfig() returned incorrect data');
    failed++;
  }

  // Test 5: isWithinDistrict()
  console.log('\nTest 5: isWithinDistrict() correctly identifies coordinates');
  // Test Boston coordinates (should be in 01cgd - Northeast)
  const bostonLat = 42.36;
  const bostonLng = -71.06;
  if (isWithinDistrict(bostonLat, bostonLng, '01cgd')) {
    console.log('  ✅ PASS: Boston (42.36, -71.06) correctly in 01cgd');
    passed++;
  } else {
    console.log('  ❌ FAIL: Boston should be in 01cgd');
    failed++;
  }

  // Test 6: findDistrictsForCoordinates()
  console.log('\nTest 6: findDistrictsForCoordinates() finds correct district(s)');
  const districts = findDistrictsForCoordinates(bostonLat, bostonLng);
  if (districts.length > 0 && districts.includes('01cgd')) {
    console.log(`  ✅ PASS: Found districts: ${districts.join(', ')}`);
    passed++;
  } else {
    console.log('  ❌ FAIL: Should find at least 01cgd for Boston');
    failed++;
  }

  // Test 7: ensureDistrictExists() creates/updates district
  console.log('\nTest 7: ensureDistrictExists() creates/updates district document');
  try {
    // Test with 01cgd
    await ensureDistrictExists(db, '01cgd', { silent: true });
    
    // Verify district was created/updated
    const districtRef = db.collection('districts').doc('01cgd');
    const districtSnap = await districtRef.get();
    
    if (districtSnap.exists) {
      const data = districtSnap.data();
      if (data.name === 'Northeast' && data.code === '01 CGD' && data.bounds) {
        console.log('  ✅ PASS: District document created/updated correctly');
        console.log(`     Name: ${data.name}`);
        console.log(`     Code: ${data.code}`);
        console.log(`     Bounds: ${JSON.stringify(data.bounds)}`);
        passed++;
      } else {
        console.log('  ❌ FAIL: District missing required fields');
        failed++;
      }
    } else {
      console.log('  ❌ FAIL: District document was not created');
      failed++;
    }
  } catch (error) {
    console.log(`  ❌ FAIL: Error in ensureDistrictExists: ${error.message}`);
    failed++;
  }

  // Summary
  console.log('\n' + '═'.repeat(80));
  console.log('TEST SUMMARY');
  console.log('═'.repeat(80));
  console.log(`  Total tests: ${passed + failed}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed! The shared district-config module is working correctly.\n');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed. Review output above.\n');
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});

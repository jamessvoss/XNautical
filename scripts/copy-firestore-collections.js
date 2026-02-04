/**
 * Firestore Collection Migration Script
 * 
 * Copies marine-zones and buoys collections from FishTopia to XNautical Firebase projects
 * 
 * Prerequisites:
 * 1. Get service account JSON keys from both Firebase projects:
 *    - FishTopia: Console → Project Settings → Service Accounts → Generate new private key
 *    - XNautical: Console → Project Settings → Service Accounts → Generate new private key
 * 
 * 2. Place keys in this directory:
 *    - scripts/fishtopia-service-account.json
 *    - scripts/xnautical-service-account.json
 * 
 * 3. Install firebase-admin if not already installed:
 *    npm install firebase-admin --save-dev
 * 
 * Usage:
 *    node scripts/copy-firestore-collections.js
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Check if service account files exist
const fishTopiaKeyPath = path.join(__dirname, 'fishtopia-service-account.json');
const xnauticalKeyPath = path.join(__dirname, 'xnautical-service-account.json');

if (!fs.existsSync(fishTopiaKeyPath)) {
  console.error('❌ Error: FishTopia service account key not found!');
  console.error(`   Expected at: ${fishTopiaKeyPath}`);
  console.error('\n📖 How to get it:');
  console.error('   1. Open https://console.firebase.google.com/project/alaska-fishtopia/settings/serviceaccounts/adminsdk');
  console.error('   2. Click "Generate new private key"');
  console.error(`   3. Save as: ${fishTopiaKeyPath}`);
  process.exit(1);
}

if (!fs.existsSync(xnauticalKeyPath)) {
  console.error('❌ Error: XNautical service account key not found!');
  console.error(`   Expected at: ${xnauticalKeyPath}`);
  console.error('\n📖 How to get it:');
  console.error('   1. Open Firebase Console → XNautical Project → Settings → Service Accounts');
  console.error('   2. Click "Generate new private key"');
  console.error(`   3. Save as: ${xnauticalKeyPath}`);
  process.exit(1);
}

// Initialize source (FishTopia)
console.log('🔧 Initializing FishTopia connection...');
const sourceApp = admin.initializeApp({
  credential: admin.credential.cert(require(fishTopiaKeyPath)),
}, 'source');

// Initialize target (XNautical)
console.log('🔧 Initializing XNautical connection...');
const targetApp = admin.initializeApp({
  credential: admin.credential.cert(require(xnauticalKeyPath)),
}, 'target');

const sourceDb = sourceApp.firestore();
const targetDb = targetApp.firestore();

/**
 * Copy a single collection from source to target
 */
async function copyCollection(collectionName) {
  console.log(`\n📦 Copying collection: ${collectionName}`);
  console.log('   Fetching documents from source...');
  
  try {
    const snapshot = await sourceDb.collection(collectionName).get();
    const totalDocs = snapshot.docs.length;
    
    if (totalDocs === 0) {
      console.log('   ⚠️  No documents found in source collection');
      return;
    }
    
    console.log(`   Found ${totalDocs} documents`);
    console.log('   Writing to target...');
    
    let batch = targetDb.batch();
    let batchCount = 0;
    let totalWritten = 0;
    const batchSize = 500; // Firestore batch limit
    
    for (const doc of snapshot.docs) {
      const targetRef = targetDb.collection(collectionName).doc(doc.id);
      batch.set(targetRef, doc.data());
      batchCount++;
      
      // Commit batch when we hit the limit
      if (batchCount === batchSize) {
        await batch.commit();
        totalWritten += batchCount;
        console.log(`   ✓ Written ${totalWritten}/${totalDocs} documents`);
        batch = targetDb.batch();
        batchCount = 0;
      }
    }
    
    // Commit remaining documents
    if (batchCount > 0) {
      await batch.commit();
      totalWritten += batchCount;
      console.log(`   ✓ Written ${totalWritten}/${totalDocs} documents`);
    }
    
    console.log(`   ✅ Completed: ${collectionName}`);
    
    // Return summary
    return {
      collection: collectionName,
      documents: totalDocs,
      success: true
    };
  } catch (error) {
    console.error(`   ❌ Error copying ${collectionName}:`, error.message);
    return {
      collection: collectionName,
      documents: 0,
      success: false,
      error: error.message
    };
  }
}

/**
 * Main migration function
 */
async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║   Firestore Collection Migration: FishTopia → XNautical   ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  const startTime = Date.now();
  const results = [];
  
  try {
    // Copy marine-zones collection
    const marineZonesResult = await copyCollection('marine-zones');
    results.push(marineZonesResult);
    
    // Copy buoys collection
    const buoysResult = await copyCollection('buoys');
    results.push(buoysResult);
    
    // Print summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                     Migration Summary                      ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    
    results.forEach(result => {
      const status = result.success ? '✅' : '❌';
      console.log(`${status} ${result.collection}: ${result.documents} documents`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    });
    
    console.log(`\n⏱️  Total time: ${duration}s`);
    
    const allSuccess = results.every(r => r.success);
    if (allSuccess) {
      console.log('\n✅ Migration completed successfully!');
      console.log('\n📋 Next steps:');
      console.log('   1. Verify data in Firebase Console (Firestore Database)');
      console.log('   2. Update Firestore Security Rules to allow read access');
      console.log('   3. Deploy cloud functions: cd functions && firebase deploy --only functions');
      console.log('   4. Test Weather tab in XNautical app\n');
      process.exit(0);
    } else {
      console.log('\n⚠️  Migration completed with errors. Check the logs above.');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Fatal error during migration:', error);
    process.exit(1);
  }
}

// Run migration
main();

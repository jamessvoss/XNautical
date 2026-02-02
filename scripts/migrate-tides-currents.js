#!/usr/bin/env node
/**
 * Migrate Tides and Currents Data
 * 
 * This script copies the tidal-stations and current-stations-packed collections
 * from Alaska FishTopia Firebase to XNautical Firebase.
 * 
 * Prerequisites:
 * 1. Download service account keys for both projects:
 *    - alaska-fishtopia: Firebase Console > Project Settings > Service Accounts > Generate new private key
 *    - xnautical-8a296: Same process
 * 
 * 2. Save them as:
 *    - ./service-accounts/alaska-fishtopia-key.json
 *    - ./service-accounts/xnautical-key.json
 * 
 * Usage:
 *   node scripts/migrate-tides-currents.js [--dry-run] [--tides-only] [--currents-only]
 * 
 * Options:
 *   --dry-run       Show what would be migrated without actually writing
 *   --tides-only    Only migrate tidal-stations collection
 *   --currents-only Only migrate current-stations-packed collection
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const TIDES_ONLY = args.includes('--tides-only');
const CURRENTS_ONLY = args.includes('--currents-only');

// Service account paths
const SOURCE_KEY_PATH = path.join(__dirname, 'service-accounts', 'alaska-fishtopia-key.json');
const TARGET_KEY_PATH = path.join(__dirname, 'service-accounts', 'xnautical-key.json');

// Verify service account files exist
function checkServiceAccounts() {
  const errors = [];
  
  if (!fs.existsSync(SOURCE_KEY_PATH)) {
    errors.push(`Source service account key not found: ${SOURCE_KEY_PATH}`);
  }
  
  if (!fs.existsSync(TARGET_KEY_PATH)) {
    errors.push(`Target service account key not found: ${TARGET_KEY_PATH}`);
  }
  
  if (errors.length > 0) {
    console.error('\n❌ Missing service account keys:\n');
    errors.forEach(e => console.error(`   ${e}`));
    console.error('\n📋 To get service account keys:');
    console.error('   1. Go to Firebase Console > Project Settings > Service Accounts');
    console.error('   2. Click "Generate new private key"');
    console.error('   3. Save the files to:');
    console.error(`      - ${SOURCE_KEY_PATH}`);
    console.error(`      - ${TARGET_KEY_PATH}`);
    console.error('');
    process.exit(1);
  }
}

// Initialize Firebase apps
let sourceApp, targetApp, sourceDb, targetDb;

function initializeApps() {
  console.log('🔧 Initializing Firebase apps...');
  
  const sourceServiceAccount = require(SOURCE_KEY_PATH);
  const targetServiceAccount = require(TARGET_KEY_PATH);
  
  sourceApp = admin.initializeApp({
    credential: admin.credential.cert(sourceServiceAccount),
  }, 'source');
  
  targetApp = admin.initializeApp({
    credential: admin.credential.cert(targetServiceAccount),
  }, 'target');
  
  sourceDb = sourceApp.firestore();
  targetDb = targetApp.firestore();
  
  console.log(`   Source: ${sourceServiceAccount.project_id}`);
  console.log(`   Target: ${targetServiceAccount.project_id}`);
}

/**
 * Migrate a collection (including all documents)
 */
async function migrateCollection(collectionName, includeSubcollections = []) {
  console.log(`\n📦 Migrating collection: ${collectionName}`);
  
  const snapshot = await sourceDb.collection(collectionName).get();
  
  if (snapshot.empty) {
    console.log(`   ⚠️  No documents found in ${collectionName}`);
    return { documents: 0, subcollections: 0 };
  }
  
  console.log(`   Found ${snapshot.size} documents`);
  
  let documentCount = 0;
  let subcollectionCount = 0;
  
  for (const doc of snapshot.docs) {
    const docData = doc.data();
    
    if (DRY_RUN) {
      console.log(`   [DRY RUN] Would copy: ${collectionName}/${doc.id}`);
    } else {
      await targetDb.collection(collectionName).doc(doc.id).set(docData);
      console.log(`   ✓ Copied: ${collectionName}/${doc.id}`);
    }
    documentCount++;
    
    // Migrate subcollections if specified
    for (const subName of includeSubcollections) {
      const subSnapshot = await sourceDb
        .collection(collectionName)
        .doc(doc.id)
        .collection(subName)
        .get();
      
      if (!subSnapshot.empty) {
        console.log(`     📁 Subcollection ${subName}: ${subSnapshot.size} documents`);
        
        for (const subDoc of subSnapshot.docs) {
          const subData = subDoc.data();
          
          if (DRY_RUN) {
            console.log(`     [DRY RUN] Would copy: ${collectionName}/${doc.id}/${subName}/${subDoc.id}`);
          } else {
            await targetDb
              .collection(collectionName)
              .doc(doc.id)
              .collection(subName)
              .doc(subDoc.id)
              .set(subData);
          }
          subcollectionCount++;
        }
      }
    }
  }
  
  return { documents: documentCount, subcollections: subcollectionCount };
}

/**
 * Main migration function
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('       TIDES & CURRENTS DATA MIGRATION');
  console.log('       Alaska FishTopia → XNautical');
  console.log('═══════════════════════════════════════════════════════════════');
  
  if (DRY_RUN) {
    console.log('\n🔍 DRY RUN MODE - No data will be written\n');
  }
  
  checkServiceAccounts();
  initializeApps();
  
  const results = {
    tidalStations: { documents: 0, subcollections: 0 },
    currentStations: { documents: 0, subcollections: 0 },
  };
  
  try {
    // Migrate tidal-stations
    if (!CURRENTS_ONLY) {
      results.tidalStations = await migrateCollection('tidal-stations');
    }
    
    // Migrate current-stations-packed (with predictions subcollection)
    if (!TIDES_ONLY) {
      results.currentStations = await migrateCollection('current-stations-packed', ['predictions']);
    }
    
    // Summary
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('                     MIGRATION SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    
    if (!CURRENTS_ONLY) {
      console.log(`\n📊 tidal-stations:`);
      console.log(`   Documents: ${results.tidalStations.documents}`);
    }
    
    if (!TIDES_ONLY) {
      console.log(`\n📊 current-stations-packed:`);
      console.log(`   Documents: ${results.currentStations.documents}`);
      console.log(`   Prediction subcollections: ${results.currentStations.subcollections}`);
    }
    
    const totalDocs = results.tidalStations.documents + results.currentStations.documents;
    const totalSubs = results.tidalStations.subcollections + results.currentStations.subcollections;
    
    console.log(`\n📈 Total: ${totalDocs} documents, ${totalSubs} subcollection documents`);
    
    if (DRY_RUN) {
      console.log('\n✅ Dry run complete. Run without --dry-run to perform actual migration.');
    } else {
      console.log('\n✅ Migration complete!');
    }
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    // Cleanup
    await sourceApp.delete();
    await targetApp.delete();
  }
}

// Run the migration
main().catch(console.error);

#!/usr/bin/env node
/**
 * Firestore Migration Script (Admin SDK)
 * 
 * Migrates collections from Alaska Fishtopia to XNautical using Firebase Admin SDK.
 * Admin SDK bypasses security rules and has full database access.
 * 
 * Usage:
 *   node scripts/migrate-firestore-admin.js
 */

const admin = require('firebase-admin');
const path = require('path');

// Collections to migrate
const COLLECTIONS_TO_MIGRATE = [
  'chart-metadata',
  'chart-regions', 
  'chart-update-log',
  'chart-versions'
];

// Service account paths
const SOURCE_SERVICE_ACCOUNT = '/Users/jvoss/Documents/FishTopia/mobile/alaska-fishtopia-firebase-adminsdk-1waxi-6a9dca5398.json';
const DEST_SERVICE_ACCOUNT = process.env.XNAUTICAL_SERVICE_ACCOUNT || '/Users/jvoss/Documents/XNautical/xnautical-service-account.json';

async function migrateCollection(sourceDb, destDb, collectionName) {
  console.log(`\nMigrating collection: ${collectionName}`);
  
  try {
    // Read all documents from source
    const snapshot = await sourceDb.collection(collectionName).get();
    
    if (snapshot.empty) {
      console.log(`  No documents found in ${collectionName}`);
      return { collection: collectionName, count: 0, status: 'empty' };
    }
    
    console.log(`  Found ${snapshot.size} documents`);
    
    // Write to destination in batches (Firestore limit is 500 per batch)
    const BATCH_SIZE = 400;
    let processed = 0;
    let batch = destDb.batch();
    let batchCount = 0;
    
    for (const docSnap of snapshot.docs) {
      const destRef = destDb.collection(collectionName).doc(docSnap.id);
      batch.set(destRef, docSnap.data());
      batchCount++;
      
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        processed += batchCount;
        console.log(`  Committed ${processed}/${snapshot.size} documents`);
        batch = destDb.batch();
        batchCount = 0;
      }
    }
    
    // Commit remaining
    if (batchCount > 0) {
      await batch.commit();
      processed += batchCount;
    }
    
    console.log(`  ✓ Migrated ${processed} documents`);
    return { collection: collectionName, count: processed, status: 'success' };
    
  } catch (error) {
    console.error(`  ✗ Error migrating ${collectionName}:`, error.message);
    return { collection: collectionName, count: 0, status: 'error', error: error.message };
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Firestore Migration: Alaska Fishtopia → XNautical');
  console.log('Using Firebase Admin SDK');
  console.log('='.repeat(60));
  
  // Check for service account files
  const fs = require('fs');
  
  if (!fs.existsSync(SOURCE_SERVICE_ACCOUNT)) {
    console.error(`\nSource service account not found: ${SOURCE_SERVICE_ACCOUNT}`);
    process.exit(1);
  }
  
  if (!fs.existsSync(DEST_SERVICE_ACCOUNT)) {
    console.error(`\nDestination service account not found: ${DEST_SERVICE_ACCOUNT}`);
    console.error('\nTo create one:');
    console.error('1. Go to https://console.firebase.google.com/project/xnautical-8a296/settings/serviceaccounts/adminsdk');
    console.error('2. Click "Generate new private key"');
    console.error('3. Save as: /Users/jvoss/Documents/XNautical/xnautical-service-account.json');
    process.exit(1);
  }
  
  // Initialize source (Alaska Fishtopia)
  const sourceApp = admin.initializeApp({
    credential: admin.credential.cert(require(SOURCE_SERVICE_ACCOUNT)),
    projectId: 'alaska-fishtopia'
  }, 'source');
  
  // Initialize destination (XNautical)  
  const destApp = admin.initializeApp({
    credential: admin.credential.cert(require(DEST_SERVICE_ACCOUNT)),
    projectId: 'xnautical-8a296'
  }, 'destination');
  
  const sourceDb = sourceApp.firestore();
  const destDb = destApp.firestore();
  
  console.log('\nSource Project: alaska-fishtopia');
  console.log('Destination Project: xnautical-8a296');
  console.log(`Collections to migrate: ${COLLECTIONS_TO_MIGRATE.join(', ')}`);
  console.log('\nConnected to both projects via Admin SDK');
  
  // Migrate each collection
  const results = [];
  for (const collectionName of COLLECTIONS_TO_MIGRATE) {
    const result = await migrateCollection(sourceDb, destDb, collectionName);
    results.push(result);
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION SUMMARY');
  console.log('='.repeat(60));
  
  let totalDocs = 0;
  for (const result of results) {
    const status = result.status === 'success' ? '✓' : 
                   result.status === 'empty' ? '-' : '✗';
    console.log(`  ${status} ${result.collection}: ${result.count} documents`);
    totalDocs += result.count;
  }
  
  console.log(`\nTotal: ${totalDocs} documents migrated`);
  
  const errors = results.filter(r => r.status === 'error');
  if (errors.length > 0) {
    console.log('\nErrors occurred during migration. Please check the logs above.');
    process.exit(1);
  }
  
  console.log('\n✓ Migration complete!');
  
  // Clean up
  await sourceApp.delete();
  await destApp.delete();
}

main().catch(console.error);

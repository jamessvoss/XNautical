#!/usr/bin/env node
/**
 * Firestore Migration Script
 * 
 * Migrates collections from Alaska Fishtopia to XNautical Firebase project.
 * 
 * Usage:
 *   1. Set environment variables for source project (Alaska Fishtopia)
 *   2. Run: node scripts/migrate-firestore.js
 * 
 * Required environment variables:
 *   SOURCE_FIREBASE_API_KEY
 *   SOURCE_FIREBASE_AUTH_DOMAIN
 *   SOURCE_FIREBASE_PROJECT_ID
 *   SOURCE_FIREBASE_STORAGE_BUCKET
 *   SOURCE_FIREBASE_MESSAGING_SENDER_ID
 *   SOURCE_FIREBASE_APP_ID
 */

const { initializeApp } = require('firebase/app');
const { 
  getFirestore, 
  collection, 
  getDocs, 
  doc, 
  setDoc,
  writeBatch 
} = require('firebase/firestore');

// Collections to migrate
const COLLECTIONS_TO_MIGRATE = [
  'chart-metadata',
  'chart-regions', 
  'chart-update-log',
  'chart-versions'
];

// Source: Alaska Fishtopia
const sourceConfig = {
  apiKey: process.env.SOURCE_FIREBASE_API_KEY,
  authDomain: process.env.SOURCE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.SOURCE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.SOURCE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.SOURCE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.SOURCE_FIREBASE_APP_ID,
};

// Destination: XNautical (from .env)
const destConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// Validate config
function validateConfig(config, name) {
  const missing = Object.entries(config)
    .filter(([key, value]) => !value)
    .map(([key]) => key);
  
  if (missing.length > 0) {
    console.error(`Missing ${name} config: ${missing.join(', ')}`);
    return false;
  }
  return true;
}

async function migrateCollection(sourceDb, destDb, collectionName) {
  console.log(`\nMigrating collection: ${collectionName}`);
  
  try {
    // Read all documents from source
    const sourceRef = collection(sourceDb, collectionName);
    const snapshot = await getDocs(sourceRef);
    
    if (snapshot.empty) {
      console.log(`  No documents found in ${collectionName}`);
      return { collection: collectionName, count: 0, status: 'empty' };
    }
    
    console.log(`  Found ${snapshot.size} documents`);
    
    // Write to destination in batches (Firestore limit is 500 per batch)
    const BATCH_SIZE = 400;
    let processed = 0;
    let batch = writeBatch(destDb);
    let batchCount = 0;
    
    for (const docSnap of snapshot.docs) {
      const destRef = doc(destDb, collectionName, docSnap.id);
      batch.set(destRef, docSnap.data());
      batchCount++;
      
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        processed += batchCount;
        console.log(`  Committed ${processed}/${snapshot.size} documents`);
        batch = writeBatch(destDb);
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
  console.log('='.repeat(60));
  
  // Validate configs
  if (!validateConfig(sourceConfig, 'Source (Alaska Fishtopia)')) {
    console.error('\nPlease set SOURCE_FIREBASE_* environment variables');
    console.error('You can find these in the Alaska Fishtopia Firebase Console');
    process.exit(1);
  }
  
  if (!validateConfig(destConfig, 'Destination (XNautical)')) {
    console.error('\nPlease ensure EXPO_PUBLIC_FIREBASE_* variables are set in .env');
    process.exit(1);
  }
  
  console.log(`\nSource Project: ${sourceConfig.projectId}`);
  console.log(`Destination Project: ${destConfig.projectId}`);
  console.log(`Collections to migrate: ${COLLECTIONS_TO_MIGRATE.join(', ')}`);
  
  // Initialize Firebase apps
  console.log('\nInitializing Firebase connections...');
  const sourceApp = initializeApp(sourceConfig, 'source');
  const destApp = initializeApp(destConfig, 'destination');
  
  const sourceDb = getFirestore(sourceApp);
  const destDb = getFirestore(destApp);
  
  console.log('Connected to both projects');
  
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
}

main().catch(console.error);

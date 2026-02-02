#!/usr/bin/env node
/**
 * Firebase Storage Migration Script
 * 
 * Migrates chart files from Alaska Fishtopia Storage to XNautical Storage.
 * 
 * Usage:
 *   node scripts/migrate-storage.js
 *   node scripts/migrate-storage.js --dry-run    # List files without copying
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Service account paths
const SOURCE_SERVICE_ACCOUNT = '/Users/jvoss/Documents/FishTopia/mobile/alaska-fishtopia-firebase-adminsdk-1waxi-6a9dca5398.json';
const DEST_SERVICE_ACCOUNT = process.env.XNAUTICAL_SERVICE_ACCOUNT || '/Users/jvoss/Documents/XNautical/xnautical-service-account.json';

// Storage bucket names
const SOURCE_BUCKET = 'alaska-fishtopia.firebasestorage.app';
const DEST_BUCKET = 'xnautical-8a296.firebasestorage.app';

// Folder to migrate
const CHARTS_FOLDER = 'charts/';

const isDryRun = process.argv.includes('--dry-run');

async function listAllFiles(bucket, prefix) {
  const [files] = await bucket.getFiles({ prefix });
  return files;
}

async function copyFile(sourceFile, destBucket, destPath) {
  try {
    // Download from source
    const [contents] = await sourceFile.download();
    
    // Upload to destination
    const destFile = destBucket.file(destPath);
    await destFile.save(contents, {
      metadata: {
        contentType: sourceFile.metadata.contentType,
      },
    });
    
    return true;
  } catch (error) {
    console.error(`  Error copying ${sourceFile.name}:`, error.message);
    return false;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Firebase Storage Migration: Alaska Fishtopia → XNautical');
  if (isDryRun) {
    console.log('*** DRY RUN - No files will be copied ***');
  }
  console.log('='.repeat(60));
  
  // Check for service account files
  if (!fs.existsSync(SOURCE_SERVICE_ACCOUNT)) {
    console.error(`\nSource service account not found: ${SOURCE_SERVICE_ACCOUNT}`);
    process.exit(1);
  }
  
  if (!fs.existsSync(DEST_SERVICE_ACCOUNT)) {
    console.error(`\nDestination service account not found: ${DEST_SERVICE_ACCOUNT}`);
    process.exit(1);
  }
  
  // Initialize source (Alaska Fishtopia)
  const sourceApp = admin.initializeApp({
    credential: admin.credential.cert(require(SOURCE_SERVICE_ACCOUNT)),
    storageBucket: SOURCE_BUCKET,
  }, 'source');
  
  // Initialize destination (XNautical)  
  const destApp = admin.initializeApp({
    credential: admin.credential.cert(require(DEST_SERVICE_ACCOUNT)),
    storageBucket: DEST_BUCKET,
  }, 'destination');
  
  const sourceBucket = sourceApp.storage().bucket();
  const destBucket = destApp.storage().bucket();
  
  console.log(`\nSource Bucket: ${SOURCE_BUCKET}`);
  console.log(`Destination Bucket: ${DEST_BUCKET}`);
  console.log(`Folder to migrate: ${CHARTS_FOLDER}`);
  
  // List all files in charts folder
  console.log('\nScanning source bucket...');
  const files = await listAllFiles(sourceBucket, CHARTS_FOLDER);
  
  if (files.length === 0) {
    console.log('No files found in charts/ folder');
    process.exit(0);
  }
  
  console.log(`Found ${files.length} files to migrate`);
  
  // Calculate total size
  let totalSize = 0;
  for (const file of files) {
    totalSize += parseInt(file.metadata.size || 0);
  }
  console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  
  if (isDryRun) {
    console.log('\nFiles that would be copied:');
    for (const file of files) {
      const size = parseInt(file.metadata.size || 0);
      console.log(`  ${file.name} (${(size / 1024).toFixed(1)} KB)`);
    }
    console.log('\nRun without --dry-run to actually copy files.');
    process.exit(0);
  }
  
  // Copy files
  console.log('\nCopying files...');
  let copied = 0;
  let failed = 0;
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const progress = `[${i + 1}/${files.length}]`;
    
    process.stdout.write(`${progress} Copying ${file.name}... `);
    
    const success = await copyFile(file, destBucket, file.name);
    
    if (success) {
      copied++;
      console.log('✓');
    } else {
      failed++;
      console.log('✗');
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Total files: ${files.length}`);
  console.log(`  Copied: ${copied}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  
  if (failed > 0) {
    console.log('\nSome files failed to copy. Please check the errors above.');
    process.exit(1);
  }
  
  console.log('\n✓ Storage migration complete!');
  
  // Clean up
  await sourceApp.delete();
  await destApp.delete();
}

main().catch(console.error);

#!/usr/bin/env node
/**
 * Cleanup Script - Delete incorrectly created flat files at region level
 * 
 * These files were created by a bug in the bundle script:
 *   charts/{region}/{chartId}_*.json.gz  (WRONG - should be in subfolders)
 * 
 * Usage:
 *   node scripts/cleanup-flat-files.js --dry-run    # See what would be deleted
 *   node scripts/cleanup-flat-files.js              # Actually delete
 */

const admin = require('firebase-admin');

const SERVICE_ACCOUNT = process.env.XNAUTICAL_SERVICE_ACCOUNT || '/Users/jvoss/Documents/XNautical/xnautical-service-account.json';
const BUCKET_NAME = 'xnautical-8a296.firebasestorage.app';

const isDryRun = process.argv.includes('--dry-run');

async function main() {
  console.log('='.repeat(60));
  console.log('Cleanup Flat Files at Region Level');
  if (isDryRun) {
    console.log('*** DRY RUN - No files will be deleted ***');
  }
  console.log('='.repeat(60));
  
  const fs = require('fs');
  if (!fs.existsSync(SERVICE_ACCOUNT)) {
    console.error(`Service account not found: ${SERVICE_ACCOUNT}`);
    process.exit(1);
  }
  
  admin.initializeApp({
    credential: admin.credential.cert(require(SERVICE_ACCOUNT)),
    storageBucket: BUCKET_NAME,
  });
  
  const bucket = admin.storage().bucket();
  
  console.log('Scanning for flat files at region level...');
  
  const [files] = await bucket.getFiles({ prefix: 'charts/' });
  
  // Find flat files: charts/{region}/{chartId}_{something}.json.gz (3 parts, with underscore)
  const flatFiles = [];
  
  for (const file of files) {
    const parts = file.name.split('/');
    // Flat files have 3 parts and filename contains underscore
    if (parts.length === 3 && parts[0] === 'charts') {
      const filename = parts[2];
      // Match pattern like US4AK5FL_beacons.json.gz or US4AK5FL_bundle.json.gz
      if (filename.match(/^[A-Z0-9]+_[a-z]+\.json\.gz$/)) {
        flatFiles.push(file);
      }
    }
  }
  
  console.log(`Found ${flatFiles.length} flat files to delete`);
  
  if (flatFiles.length === 0) {
    console.log('Nothing to clean up!');
    await admin.app().delete();
    return;
  }
  
  // Group by region for summary
  const byRegion = {};
  for (const file of flatFiles) {
    const region = file.name.split('/')[1];
    byRegion[region] = (byRegion[region] || 0) + 1;
  }
  
  console.log('\nFiles by region:');
  for (const [region, count] of Object.entries(byRegion)) {
    console.log(`  ${region}: ${count} files`);
  }
  
  if (isDryRun) {
    console.log('\nSample files that would be deleted:');
    flatFiles.slice(0, 20).forEach(f => console.log(`  ${f.name}`));
    if (flatFiles.length > 20) {
      console.log(`  ... and ${flatFiles.length - 20} more`);
    }
    console.log('\nRun without --dry-run to actually delete these files.');
  } else {
    console.log('\nDeleting files...');
    let deleted = 0;
    let failed = 0;
    
    for (let i = 0; i < flatFiles.length; i++) {
      const file = flatFiles[i];
      try {
        await file.delete();
        deleted++;
        if ((i + 1) % 100 === 0 || i === flatFiles.length - 1) {
          console.log(`  Deleted ${i + 1}/${flatFiles.length} files...`);
        }
      } catch (error) {
        console.error(`  Failed to delete ${file.name}: ${error.message}`);
        failed++;
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('CLEANUP COMPLETE');
    console.log('='.repeat(60));
    console.log(`  Deleted: ${deleted}`);
    console.log(`  Failed: ${failed}`);
  }
  
  await admin.app().delete();
}

main().catch(console.error);

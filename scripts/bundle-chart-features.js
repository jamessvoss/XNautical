#!/usr/bin/env node
/**
 * Bundle Chart Features Script
 * 
 * Combines all feature files for each chart into a single bundled file.
 * This reduces the number of HTTP requests needed from 17 per chart to 1.
 * 
 * Structure:
 *   Input:  charts/{region}/{chartId}/{featureType}.json.gz (17 files)
 *   Output: charts/{region}/{chartId}/bundle.json.gz (1 file)
 * 
 * Bundle format:
 *   {
 *     "chartId": "US4AK4PH",
 *     "region": "southeast", 
 *     "createdAt": "2024-01-20T...",
 *     "features": {
 *       "depare": { ...geojson... },
 *       "soundg": { ...geojson... },
 *       ...
 *     }
 *   }
 * 
 * Usage:
 *   node scripts/bundle-chart-features.js
 *   node scripts/bundle-chart-features.js --dry-run
 *   node scripts/bundle-chart-features.js --region southeast
 */

const admin = require('firebase-admin');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Service account
const SERVICE_ACCOUNT = process.env.XNAUTICAL_SERVICE_ACCOUNT || '/Users/jvoss/Documents/XNautical/xnautical-service-account.json';
const BUCKET_NAME = 'xnautical-8a296.firebasestorage.app';

// Feature types to bundle
const FEATURE_TYPES = [
  'depare', 'depcnt', 'soundg', 'lndare', 'coalne',
  'lights', 'buoys', 'beacons', 'landmarks', 'daymar',
  'wrecks', 'uwtroc', 'obstrn', 'slcons', 'cblare',
  'pipsol', 'sbdare', 'seaare', 'pilpnt', 'anchrg',
  'fairwy', 'drgare', 'resare', 'rivers', 'lndrgn'
];

// Parse command line args
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const regionIdx = args.indexOf('--region');
const regionFilter = args.find(a => a.startsWith('--region='))?.split('=')[1] || 
                     (regionIdx !== -1 ? args[regionIdx + 1] : null);

async function downloadAndDecompress(bucket, filePath) {
  try {
    const file = bucket.file(filePath);
    const [exists] = await file.exists();
    if (!exists) return null;
    
    const [buffer] = await file.download();
    const decompressed = await gunzip(buffer);
    return JSON.parse(decompressed.toString());
  } catch (error) {
    // File doesn't exist or can't be read
    return null;
  }
}

async function uploadCompressed(bucket, filePath, data) {
  const jsonString = JSON.stringify(data);
  const compressed = await gzip(jsonString);
  
  const file = bucket.file(filePath);
  await file.save(compressed, {
    metadata: {
      contentType: 'application/gzip',
      contentEncoding: 'gzip',
    },
  });
  
  return {
    originalSize: jsonString.length,
    compressedSize: compressed.length,
  };
}

async function findAllCharts(bucket) {
  console.log('Scanning for charts...');
  
  const [files] = await bucket.getFiles({ prefix: 'charts/' });
  
  // Extract unique chart paths: charts/{region}/{chartId}/ (subfolder structure)
  const chartPaths = new Map();
  
  for (const file of files) {
    const parts = file.name.split('/');
    // Expect: charts/{region}/{chartId}/{featureType}.json.gz (4 parts)
    if (parts.length >= 4 && parts[0] === 'charts') {
      const region = parts[1];
      const chartId = parts[2];
      const chartPath = `charts/${region}/${chartId}`;
      
      if (!chartPaths.has(chartPath)) {
        chartPaths.set(chartPath, { region, chartId, path: chartPath });
      }
    }
  }
  
  return Array.from(chartPaths.values());
}

async function bundleChart(bucket, chartInfo, dryRun) {
  const { path, region, chartId } = chartInfo;
  // Subfolder structure: bundle at charts/{region}/{chartId}/bundle.json.gz
  const bundlePath = `${path}/bundle.json.gz`;
  
  // Check if bundle already exists
  const bundleFile = bucket.file(bundlePath);
  const [bundleExists] = await bundleFile.exists();
  
  if (bundleExists) {
    return { status: 'skipped', reason: 'bundle exists' };
  }
  
  // Download all feature files (subfolder structure: {featureType}.json.gz)
  const features = {};
  let featureCount = 0;
  let totalOriginalSize = 0;
  
  for (const featureType of FEATURE_TYPES) {
    const featurePath = `${path}/${featureType}.json.gz`;
    const data = await downloadAndDecompress(bucket, featurePath);
    
    if (data && data.features && data.features.length > 0) {
      features[featureType] = data;
      featureCount++;
      totalOriginalSize += JSON.stringify(data).length;
    }
  }
  
  if (featureCount === 0) {
    return { status: 'skipped', reason: 'no features' };
  }
  
  // Create bundle
  const bundle = {
    chartId,
    region,
    createdAt: new Date().toISOString(),
    featureCount,
    features,
  };
  
  if (dryRun) {
    return {
      status: 'would-create',
      featureCount,
      estimatedSize: totalOriginalSize,
    };
  }
  
  // Upload bundle
  const { originalSize, compressedSize } = await uploadCompressed(bucket, bundlePath, bundle);
  
  return {
    status: 'created',
    featureCount,
    originalSize,
    compressedSize,
    compressionRatio: ((1 - compressedSize / originalSize) * 100).toFixed(1),
  };
}

async function main() {
  console.log('='.repeat(60));
  console.log('Chart Feature Bundler');
  if (isDryRun) {
    console.log('*** DRY RUN - No files will be created ***');
  }
  if (regionFilter) {
    console.log(`*** Filtering to region: ${regionFilter} ***`);
  }
  console.log('='.repeat(60));
  
  // Check for service account
  const fs = require('fs');
  if (!fs.existsSync(SERVICE_ACCOUNT)) {
    console.error(`Service account not found: ${SERVICE_ACCOUNT}`);
    process.exit(1);
  }
  
  // Initialize Firebase
  admin.initializeApp({
    credential: admin.credential.cert(require(SERVICE_ACCOUNT)),
    storageBucket: BUCKET_NAME,
  });
  
  const bucket = admin.storage().bucket();
  
  // Find all charts
  let charts = await findAllCharts(bucket);
  console.log(`Found ${charts.length} charts total`);
  
  // Filter by region if specified
  if (regionFilter) {
    charts = charts.filter(c => c.region === regionFilter);
    console.log(`Filtered to ${charts.length} charts in ${regionFilter}`);
  }
  
  // Process each chart
  const stats = {
    created: 0,
    skipped: 0,
    wouldCreate: 0,
    totalCompressedSize: 0,
  };
  
  for (let i = 0; i < charts.length; i++) {
    const chart = charts[i];
    const progress = `[${i + 1}/${charts.length}]`;
    
    process.stdout.write(`${progress} ${chart.chartId}... `);
    
    try {
      const result = await bundleChart(bucket, chart, isDryRun);
      
      if (result.status === 'created') {
        stats.created++;
        stats.totalCompressedSize += result.compressedSize;
        console.log(`✓ Created (${result.featureCount} features, ${(result.compressedSize / 1024).toFixed(1)}KB, ${result.compressionRatio}% compression)`);
      } else if (result.status === 'would-create') {
        stats.wouldCreate++;
        console.log(`Would create (${result.featureCount} features)`);
      } else {
        stats.skipped++;
        console.log(`Skipped (${result.reason})`);
      }
    } catch (error) {
      console.log(`✗ Error: ${error.message}`);
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  
  if (isDryRun) {
    console.log(`Would create: ${stats.wouldCreate} bundles`);
    console.log(`Skipped: ${stats.skipped}`);
  } else {
    console.log(`Created: ${stats.created} bundles`);
    console.log(`Skipped: ${stats.skipped}`);
    console.log(`Total bundle size: ${(stats.totalCompressedSize / 1024 / 1024).toFixed(2)} MB`);
  }
  
  await admin.app().delete();
}

main().catch(console.error);

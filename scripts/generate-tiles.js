#!/usr/bin/env node
/**
 * Vector Tile Generator
 * 
 * Converts GeoJSON chart data to vector tiles using tippecanoe.
 * 
 * Usage:
 *   node generate-tiles.js --chart US4AK1AM --region southcentral
 *   node generate-tiles.js --region southcentral --all
 *   node generate-tiles.js --local /path/to/chart/folder
 * 
 * Output structure:
 *   output/tiles/{chartId}/
 *     metadata.json
 *     {z}/{x}/{y}.pbf
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { initializeApp, cert } = require('firebase-admin/app');
const { getStorage } = require('firebase-admin/storage');

// Configuration
const OUTPUT_DIR = path.join(__dirname, '..', 'output', 'tiles');
const TEMP_DIR = path.join(__dirname, '..', 'temp');
const MIN_ZOOM = 0;
const MAX_ZOOM = 14;

// Feature types that should be converted to tiles
const FEATURE_TYPES = [
  'depare',   // Depth Areas
  'depcnt',   // Depth Contours
  'soundg',   // Soundings
  'lndare',   // Land Areas
  'coalne',   // Coastline
  'lights',   // Navigation Lights
  'buoys',    // Buoys
  'beacons',  // Beacons
  'landmarks',// Landmarks
  'wrecks',   // Wrecks
  'uwtroc',   // Underwater Rocks
  'obstrn',   // Obstructions
  'slcons',   // Shoreline Constructions
  'cblare',   // Cable Areas
  'sbdare',   // Seabed Areas
  'seaare',   // Sea Areas
  'pipsol',   // Pipelines
];

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    chart: null,
    region: null,
    all: false,
    local: null,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--chart':
        options.chart = args[++i];
        break;
      case '--region':
        options.region = args[++i];
        break;
      case '--all':
        options.all = true;
        break;
      case '--local':
        options.local = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Vector Tile Generator

Usage:
  node generate-tiles.js [options]

Options:
  --chart <chartId>     Generate tiles for a specific chart
  --region <region>     Specify region (arctic, overview, southcentral, southeast, southwest, western)
  --all                 Generate tiles for all charts in a region
  --local <path>        Use local GeoJSON files instead of Firebase
  --dry-run             Show what would be done without executing
  --help, -h            Show this help message

Examples:
  # Generate tiles for a single chart from Firebase
  node generate-tiles.js --chart US4AK1AM --region southcentral

  # Generate tiles for all charts in a region
  node generate-tiles.js --region southcentral --all

  # Generate from local cached files
  node generate-tiles.js --local ./cached-charts/US4AK1AM
`);
}

// Initialize Firebase Admin SDK
let firebaseInitialized = false;
function initFirebase() {
  if (firebaseInitialized) return;
  
  // Try multiple possible service account key file names
  const possiblePaths = [
    path.join(__dirname, '..', 'serviceAccountKey.json'),
    path.join(__dirname, '..', 'xnautical-service-account.json'),
  ];
  
  const serviceAccountPath = possiblePaths.find(p => fs.existsSync(p));
  if (!serviceAccountPath) {
    throw new Error(`Firebase service account key not found. Tried: ${possiblePaths.join(', ')}`);
  }
  console.log(`Using service account: ${serviceAccountPath}`);
  
  initializeApp({
    credential: cert(serviceAccountPath),
    storageBucket: 'xnautical-8a296.firebasestorage.app',
  });
  
  firebaseInitialized = true;
}

// Download GeoJSON from Firebase Storage
async function downloadFromFirebase(chartId, region) {
  initFirebase();
  const storage = getStorage();
  const bucket = storage.bucket();
  
  const chartDir = path.join(TEMP_DIR, chartId);
  if (!fs.existsSync(chartDir)) {
    fs.mkdirSync(chartDir, { recursive: true });
  }
  
  const downloadedFiles = [];
  
  // Try to download bundle first
  const bundlePath = `charts/${region}/${chartId}/bundle.json.gz`;
  try {
    const [bundleExists] = await bucket.file(bundlePath).exists();
    if (bundleExists) {
      console.log(`  Downloading bundle for ${chartId}...`);
      const [bundleContent] = await bucket.file(bundlePath).download();
      const zlib = require('zlib');
      const decompressed = zlib.gunzipSync(bundleContent);
      const bundle = JSON.parse(decompressed.toString());
      
      // Split bundle into individual feature files
      for (const featureType of FEATURE_TYPES) {
        if (bundle[featureType] && bundle[featureType].features?.length > 0) {
          const filePath = path.join(chartDir, `${featureType}.json`);
          fs.writeFileSync(filePath, JSON.stringify(bundle[featureType]));
          downloadedFiles.push({ featureType, path: filePath });
        }
      }
      
      return downloadedFiles;
    }
  } catch (err) {
    console.log(`  No bundle found, downloading individual files...`);
  }
  
  // Download individual feature files
  for (const featureType of FEATURE_TYPES) {
    const remotePath = `charts/${region}/${chartId}/${featureType}.json.gz`;
    const localPath = path.join(chartDir, `${featureType}.json`);
    
    try {
      const [exists] = await bucket.file(remotePath).exists();
      if (exists) {
        const [content] = await bucket.file(remotePath).download();
        const zlib = require('zlib');
        let data;
        try {
          data = zlib.gunzipSync(content);
        } catch {
          // File might not be gzipped
          data = content;
        }
        fs.writeFileSync(localPath, data);
        downloadedFiles.push({ featureType, path: localPath });
        console.log(`  Downloaded ${featureType}`);
      }
    } catch (err) {
      // Feature type doesn't exist for this chart
    }
  }
  
  return downloadedFiles;
}

// Load GeoJSON from local cache
function loadLocalGeoJSON(chartDir) {
  const files = [];
  
  for (const featureType of FEATURE_TYPES) {
    const filePath = path.join(chartDir, `${featureType}.json`);
    if (fs.existsSync(filePath)) {
      files.push({ featureType, path: filePath });
    }
  }
  
  return files;
}

// Generate vector tiles using tippecanoe
function generateTiles(chartId, featureFiles, dryRun = false) {
  const outputDir = path.join(OUTPUT_DIR, chartId);
  
  if (featureFiles.length === 0) {
    console.log(`  No feature files found for ${chartId}`);
    return false;
  }
  
  // Build tippecanoe command
  const layerArgs = featureFiles.map(f => 
    `--named-layer=${f.featureType}:${f.path}`
  );
  
  const cmd = [
    'tippecanoe',
    `--output-to-directory=${outputDir}`,
    `--minimum-zoom=${MIN_ZOOM}`,
    `--maximum-zoom=${MAX_ZOOM}`,
    '--no-tile-compression',  // Serve uncompressed for simplicity
    '--force',                // Overwrite existing
    '--no-feature-limit',     // Don't drop features
    '--no-tile-size-limit',   // Don't limit tile size
    ...layerArgs,
  ].join(' ');
  
  console.log(`\n  Running tippecanoe for ${chartId}...`);
  
  if (dryRun) {
    console.log(`  [DRY RUN] Would execute:\n  ${cmd}`);
    return true;
  }
  
  try {
    execSync(cmd, { stdio: 'inherit' });
    
    // Generate metadata file
    const metadata = {
      chartId,
      generatedAt: new Date().toISOString(),
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      layers: featureFiles.map(f => f.featureType),
      format: 'pbf',
    };
    
    // Calculate bounds from GeoJSON files
    let bounds = [180, 90, -180, -90]; // [minLon, minLat, maxLon, maxLat]
    for (const file of featureFiles) {
      try {
        const geojson = JSON.parse(fs.readFileSync(file.path, 'utf8'));
        for (const feature of geojson.features || []) {
          const coords = extractCoordinates(feature.geometry);
          for (const [lon, lat] of coords) {
            bounds[0] = Math.min(bounds[0], lon);
            bounds[1] = Math.min(bounds[1], lat);
            bounds[2] = Math.max(bounds[2], lon);
            bounds[3] = Math.max(bounds[3], lat);
          }
        }
      } catch (err) {
        // Skip file on error
      }
    }
    
    if (bounds[0] < 180) {
      metadata.bounds = bounds;
    }
    
    fs.writeFileSync(
      path.join(outputDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    );
    
    console.log(`  Generated tiles at ${outputDir}`);
    return true;
  } catch (err) {
    console.error(`  Error generating tiles: ${err.message}`);
    return false;
  }
}

// Extract all coordinates from a geometry
function extractCoordinates(geometry) {
  if (!geometry) return [];
  
  const coords = [];
  const type = geometry.type;
  
  if (type === 'Point') {
    coords.push(geometry.coordinates);
  } else if (type === 'LineString' || type === 'MultiPoint') {
    coords.push(...geometry.coordinates);
  } else if (type === 'Polygon' || type === 'MultiLineString') {
    for (const ring of geometry.coordinates) {
      coords.push(...ring);
    }
  } else if (type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        coords.push(...ring);
      }
    }
  }
  
  return coords;
}

// List all charts in a region from Firebase
async function listChartsInRegion(region) {
  initFirebase();
  const storage = getStorage();
  const bucket = storage.bucket();
  
  const prefix = `charts/${region}/`;
  const [files] = await bucket.getFiles({ prefix });
  
  const chartIds = new Set();
  for (const file of files) {
    // Extract chartId from path like charts/region/chartId/feature.json.gz
    const parts = file.name.split('/');
    if (parts.length >= 3 && parts[2]) {
      chartIds.add(parts[2]);
    }
  }
  
  return Array.from(chartIds).sort();
}

// Clean up temp directory
function cleanup() {
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true });
  }
}

// Main execution
async function main() {
  const options = parseArgs();
  
  if (options.help) {
    printHelp();
    return;
  }
  
  // Ensure directories exist
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
  
  try {
    if (options.local) {
      // Generate from local files
      const chartId = path.basename(options.local);
      console.log(`\nProcessing local chart: ${chartId}`);
      const files = loadLocalGeoJSON(options.local);
      console.log(`  Found ${files.length} feature files`);
      generateTiles(chartId, files, options.dryRun);
    } else if (options.chart && options.region) {
      // Generate single chart from Firebase
      console.log(`\nProcessing chart: ${options.chart} (region: ${options.region})`);
      const files = await downloadFromFirebase(options.chart, options.region);
      console.log(`  Downloaded ${files.length} feature files`);
      generateTiles(options.chart, files, options.dryRun);
    } else if (options.region && options.all) {
      // Generate all charts in region
      console.log(`\nListing charts in region: ${options.region}`);
      const chartIds = await listChartsInRegion(options.region);
      console.log(`Found ${chartIds.length} charts`);
      
      let success = 0;
      let failed = 0;
      
      for (const chartId of chartIds) {
        console.log(`\nProcessing chart: ${chartId} (${success + failed + 1}/${chartIds.length})`);
        try {
          const files = await downloadFromFirebase(chartId, options.region);
          if (generateTiles(chartId, files, options.dryRun)) {
            success++;
          } else {
            failed++;
          }
        } catch (err) {
          console.error(`  Error: ${err.message}`);
          failed++;
        }
      }
      
      console.log(`\nComplete: ${success} succeeded, ${failed} failed`);
    } else {
      console.error('Error: Missing required arguments');
      printHelp();
      process.exit(1);
    }
  } finally {
    cleanup();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

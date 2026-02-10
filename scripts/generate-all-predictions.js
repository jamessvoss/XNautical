#!/usr/bin/env node
/**
 * Orchestration Script for Prediction Generation
 *
 * Triggers the Cloud Run prediction-generator service for all regions
 * sequentially, with separate tide and current runs to avoid timeouts.
 *
 * Usage:
 *   node scripts/generate-all-predictions.js
 *   node scripts/generate-all-predictions.js --region 11cgd  # single region
 *   node scripts/generate-all-predictions.js --resume        # resume from state file
 *   node scripts/generate-all-predictions.js --dry-run       # preview only
 */

const admin = require('firebase-admin');
const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Configuration
// ============================================================================

const CLOUD_RUN_URL = 'https://prediction-generator-f2plukcj3a-uc.a.run.app';
const STATE_FILE = path.join(__dirname, '..', 'prediction-generation-state.json');
const POLL_INTERVAL_MS = 60000; // 1 minute
const MAX_POLL_ATTEMPTS = 120; // 2 hours max per generation type

// Regions to process (excluding 09cgd which has 0 stations, and completed ones)
const ALL_REGIONS = ['11cgd', '14cgd', '13cgd', '08cgd', '01cgd', '05cgd'];

// CLI flags
const dryRun = process.argv.includes('--dry-run');
const resume = process.argv.includes('--resume');
const regionFilter = (() => {
  const idx = process.argv.indexOf('--region');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

// ============================================================================
// Firebase Admin Setup
// ============================================================================

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.resolve(__dirname, '..', 'xnautical-service-account.json');

let credential;
try {
  const serviceAccount = require(serviceAccountPath);
  credential = admin.credential.cert(serviceAccount);
} catch (e) {
  console.error(`Could not load service account from: ${serviceAccountPath}`);
  console.error('Place xnautical-service-account.json in the project root,');
  console.error('or set GOOGLE_APPLICATION_CREDENTIALS env var.');
  process.exit(1);
}

admin.initializeApp({
  credential,
  storageBucket: 'xnautical-8a296.firebasestorage.app',
});

const db = admin.firestore();

// ============================================================================
// State Management
// ============================================================================

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      console.warn(`Failed to load state file: ${e.message}`);
    }
  }
  return {
    startedAt: new Date().toISOString(),
    regions: {},
  };
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error(`Failed to save state: ${e.message}`);
  }
}

// ============================================================================
// Cloud Run API Calls
// ============================================================================

/**
 * Get an auth token from gcloud for authenticating to Cloud Run.
 * Uses the active gcloud user credentials.
 */
async function getIdToken() {
  try {
    const token = execSync('gcloud auth print-identity-token', { encoding: 'utf8' }).trim();
    return token;
  } catch (e) {
    console.error('Failed to get identity token from gcloud:', e.message);
    console.error('Make sure you are logged in: gcloud auth login');
    throw e;
  }
}

/**
 * Make an authenticated request to the Cloud Run service.
 * For POST /generate, set a very long timeout since generation can take 30-60 minutes.
 */
function makeRequest(method, path, body = null, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, CLOUD_RUN_URL);
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      // Set timeout to 2 hours for POST (generation), 30s for GET (status)
      timeout: method === 'POST' ? 2 * 60 * 60 * 1000 : 30000,
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({ raw: data });
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * Trigger prediction generation for a region and type.
 * The Cloud Run /generate endpoint is synchronous and returns when complete.
 */
async function triggerGeneration(regionId, type, token) {
  console.log(`  Triggering ${type} generation...`);
  const body = { regionId, type };
  
  if (dryRun) {
    console.log(`  [DRY RUN] Would POST /generate with:`, body);
    return { success: true, dryRun: true };
  }

  try {
    const startTime = Date.now();
    const result = await makeRequest('POST', '/generate', body, token);
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    console.log(`  ✓ Generation complete (${elapsed}s)`);
    return result;
  } catch (e) {
    console.error(`  ✗ Failed:`, e.message);
    throw e;
  }
}

/**
 * Poll the status endpoint until generation completes or times out.
 */
async function pollStatus(regionId, type, token, maxAttempts = MAX_POLL_ATTEMPTS) {
  console.log(`  Polling status (max ${maxAttempts} attempts)...`);

  if (dryRun) {
    console.log(`  [DRY RUN] Would poll /status?regionId=${regionId}`);
    return { state: 'complete', dryRun: true };
  }

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const status = await makeRequest('GET', `/status?regionId=${regionId}`, null, token);
      const predStatus = status.predictionStatus || {};
      const state = predStatus.state || 'unknown';
      const message = predStatus.message || '';

      if (state === 'complete') {
        console.log(`  ✓ ${type} generation complete!`);
        return status;
      } else if (state === 'error' || state === 'failed') {
        console.error(`  ✗ Generation failed: ${message}`);
        throw new Error(`Generation failed: ${message}`);
      } else {
        // Still in progress
        const elapsed = Math.floor(i * POLL_INTERVAL_MS / 60000);
        console.log(`  [${elapsed}m] State: ${state} - ${message}`);
      }
    } catch (e) {
      console.warn(`  Poll attempt ${i + 1} failed: ${e.message}`);
    }

    // Wait before next poll
    if (i < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  throw new Error(`Polling timed out after ${maxAttempts} attempts`);
}

// ============================================================================
// Region Processing
// ============================================================================

/**
 * Process a single region: tides then currents.
 */
async function processRegion(regionId, state, token) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing ${regionId}`);
  console.log('='.repeat(60));

  // Check if region has predictionConfig
  const doc = await db.collection('districts').doc(regionId).get();
  if (!doc.exists) {
    console.warn(`  Region ${regionId} not found in Firestore, skipping.`);
    return;
  }

  const data = doc.data();
  const predConfig = data.predictionConfig || {};
  const tideCount = predConfig.tideStationCount || 0;
  const currentCount = predConfig.currentStationCount || 0;

  console.log(`  Tide stations: ${tideCount}`);
  console.log(`  Current stations: ${currentCount}`);

  if (tideCount === 0 && currentCount === 0) {
    console.log(`  No stations found, skipping.`);
    state.regions[regionId] = { skipped: true, reason: 'no stations' };
    saveState(state);
    return;
  }

  // Initialize region state
  if (!state.regions[regionId]) {
    state.regions[regionId] = { tides: null, currents: null };
  }

  // Process tides
  if (tideCount > 0 && !state.regions[regionId].tides) {
    console.log(`\n--- Tides (${tideCount} stations) ---`);
    try {
      await triggerGeneration(regionId, 'tides', token);
      state.regions[regionId].tides = { status: 'complete', completedAt: new Date().toISOString() };
      saveState(state);
    } catch (e) {
      console.error(`  Failed to complete tides: ${e.message}`);
      state.regions[regionId].tides = { status: 'error', error: e.message };
      saveState(state);
      throw e; // Stop processing this region
    }
  } else if (state.regions[regionId].tides) {
    console.log(`\n--- Tides: Already completed ---`);
  } else {
    console.log(`\n--- Tides: Skipped (0 stations) ---`);
  }

  // Cooldown between tides and currents
  if (tideCount > 0 && currentCount > 0 && !dryRun) {
    const cooldown = 60; // seconds
    console.log(`\n--- Cooldown: waiting ${cooldown}s before currents ---`);
    await new Promise(resolve => setTimeout(resolve, cooldown * 1000));
  }

  // Process currents
  if (currentCount > 0 && !state.regions[regionId].currents) {
    console.log(`\n--- Currents (${currentCount} stations) ---`);
    try {
      await triggerGeneration(regionId, 'currents', token);
      state.regions[regionId].currents = { status: 'complete', completedAt: new Date().toISOString() };
      saveState(state);
    } catch (e) {
      console.error(`  Failed to complete currents: ${e.message}`);
      state.regions[regionId].currents = { status: 'error', error: e.message };
      saveState(state);
      throw e;
    }
  } else if (state.regions[regionId].currents) {
    console.log(`\n--- Currents: Already completed ---`);
  } else {
    console.log(`\n--- Currents: Skipped (0 stations) ---`);
  }

  console.log(`\n✓ ${regionId} complete!`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('Prediction Generation Orchestrator');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Cloud Run URL: ${CLOUD_RUN_URL}`);
  
  if (regionFilter) {
    console.log(`Region filter: ${regionFilter}`);
  }
  if (resume) {
    console.log(`Resume: Loading previous state`);
  }
  console.log('');

  // Load state
  const state = resume ? loadState() : {
    startedAt: new Date().toISOString(),
    regions: {},
  };

  // Get auth token
  console.log('Authenticating...');
  const token = await getIdToken();
  console.log('✓ Authentication successful\n');

  // Determine which regions to process
  const regionsToProcess = regionFilter ? [regionFilter] : ALL_REGIONS;

  console.log(`Regions to process: ${regionsToProcess.join(', ')}\n`);

  // Process each region
  let successCount = 0;
  let errorCount = 0;

  for (const regionId of regionsToProcess) {
    try {
      await processRegion(regionId, state, token);
      successCount++;
    } catch (e) {
      console.error(`\n✗ ${regionId} failed: ${e.message}\n`);
      errorCount++;
      
      // Continue to next region instead of stopping
      console.log('Continuing to next region...\n');
    }
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`Total regions: ${regionsToProcess.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
  
  if (dryRun) {
    console.log('\n[DRY RUN] No actual changes made.');
  }

  console.log('\nState saved to:', STATE_FILE);
  console.log('\nDone.');
  process.exit(errorCount > 0 ? 1 : 0);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nReceived SIGINT, shutting down gracefully...');
  console.log('State has been saved to:', STATE_FILE);
  console.log('Use --resume to continue from this point.\n');
  process.exit(1);
});

// Run
main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});

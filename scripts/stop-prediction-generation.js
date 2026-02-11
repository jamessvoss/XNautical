#!/usr/bin/env node
/**
 * Stop Prediction Generation Script
 *
 * Sets a termination flag in Firestore that the prediction-generator
 * service checks periodically. This allows graceful stopping of long-running
 * prediction generation jobs.
 *
 * Usage:
 *   node scripts/stop-prediction-generation.js 01cgd        # Stop 01cgd generation
 *   node scripts/stop-prediction-generation.js --all        # Stop all regions
 *   node scripts/stop-prediction-generation.js --clear 01cgd # Clear termination flag
 */

const admin = require('firebase-admin');
const path = require('path');

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
  databaseURL: 'https://xnautical-8a296.firebaseio.com'
});

const db = admin.firestore();

// ============================================================================
// CLI Parsing
// ============================================================================

const ALL_REGIONS = ['11cgd', '14cgd', '13cgd', '08cgd', '01cgd', '05cgd', '07cgd', '17cgd'];

const args = process.argv.slice(2);
const clear = args.includes('--clear');
const all = args.includes('--all');
const regionArg = args.find(arg => !arg.startsWith('--'));

if (!regionArg && !all) {
  console.error('Usage:');
  console.error('  node scripts/stop-prediction-generation.js <regionId>     # Stop specific region');
  console.error('  node scripts/stop-prediction-generation.js --all          # Stop all regions');
  console.error('  node scripts/stop-prediction-generation.js --clear <regionId>  # Clear flag');
  console.error('');
  console.error('Example: node scripts/stop-prediction-generation.js 01cgd');
  process.exit(1);
}

const regions = all ? ALL_REGIONS : [regionArg];

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(clear ? 'Clear Termination Flags' : 'Stop Prediction Generation');
  console.log('='.repeat(60));
  console.log(`Regions: ${regions.join(', ')}\n`);

  for (const regionId of regions) {
    const docRef = db.collection('districts').doc(regionId);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      console.log(`⚠️  ${regionId}: Region not found`);
      continue;
    }

    if (clear) {
      // Clear the termination flag
      await docRef.set({
        predictionStatus: {
          terminate: false,
          terminateRequestedAt: admin.firestore.FieldValue.delete(),
        }
      }, { merge: true });
      console.log(`✓ ${regionId}: Termination flag cleared`);
    } else {
      // Set the termination flag
      await docRef.set({
        predictionStatus: {
          terminate: true,
          terminateRequestedAt: admin.firestore.Timestamp.now(),
        }
      }, { merge: true });
      console.log(`✓ ${regionId}: Termination flag set`);
      console.log(`   The service will stop at the next check (every 10 stations)`);
    }
  }

  console.log('\n✅ Done!\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});

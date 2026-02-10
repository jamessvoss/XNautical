#!/usr/bin/env node
/**
 * Clear a stale lock by marking the prediction status as 'failed'
 * Usage: node clear-lock.js <regionId>
 */

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function clearLock(regionId) {
  const docRef = db.collection('districts').doc(regionId);
  
  await docRef.update({
    'predictionStatus.state': 'failed',
    'predictionStatus.message': 'Manual intervention: cleared stale lock after crash'
  });
  
  console.log(`✓ Cleared lock for ${regionId}`);
}

const regionId = process.argv[2];
if (!regionId) {
  console.error('Usage: node clear-lock.js <regionId>');
  process.exit(1);
}

clearLock(regionId)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });

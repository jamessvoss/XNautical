#!/usr/bin/env node
/**
 * Inspect actual Firestore document structure
 */

const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = path.join(__dirname, 'service-accounts', 'xnautical-key.json');
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function inspectDocuments() {
  console.log('Inspecting Firestore document structure...\n');
  
  // Get first tide station
  const tideSnapshot = await db.collection('tidal-stations').limit(1).get();
  if (!tideSnapshot.empty) {
    const doc = tideSnapshot.docs[0];
    console.log('=== TIDE STATION SAMPLE ===');
    console.log('Document ID:', doc.id);
    console.log('All fields:', Object.keys(doc.data()));
    console.log('Full data:', JSON.stringify(doc.data(), null, 2).substring(0, 500));
    console.log('');
  }
  
  // Get first current station
  const currentSnapshot = await db.collection('current-stations-packed').limit(1).get();
  if (!currentSnapshot.empty) {
    const doc = currentSnapshot.docs[0];
    console.log('=== CURRENT STATION SAMPLE ===');
    console.log('Document ID:', doc.id);
    console.log('All fields:', Object.keys(doc.data()));
    console.log('Full data:', JSON.stringify(doc.data(), null, 2).substring(0, 500));
  }
  
  await admin.app().delete();
}

inspectDocuments().catch(console.error);

#!/usr/bin/env node
/**
 * Count stations in Firestore
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin with XNautical credentials
const serviceAccountPath = path.join(__dirname, 'service-accounts', 'xnautical-key.json');

try {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'xnautical-8a296',
  });
} catch (error) {
  console.error('Error loading service account:', error.message);
  console.error('\nMake sure you have the service account key at:');
  console.error(serviceAccountPath);
  process.exit(1);
}

const db = admin.firestore();

async function countStations() {
  try {
    console.log('\n📊 Counting stations in Firestore...\n');
    
    // Count tidal stations
    const tidalSnapshot = await db.collection('tidal-stations').count().get();
    const tidalCount = tidalSnapshot.data().count;
    
    // Count current stations
    const currentSnapshot = await db.collection('current-stations-packed').count().get();
    const currentCount = currentSnapshot.data().count;
    
    console.log(`🌊 Tidal Stations: ${tidalCount}`);
    console.log(`🌀 Current Stations: ${currentCount}`);
    console.log(`\n📍 Total Stations: ${tidalCount + currentCount}\n`);
    
  } catch (error) {
    console.error('Error counting stations:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

countStations();

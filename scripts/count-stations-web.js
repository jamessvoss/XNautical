#!/usr/bin/env node
/**
 * Count stations in Firestore using Web SDK
 */

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
require('dotenv').config();

// Load from environment or use defaults
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'xnautical-8a296',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID,
};

console.log('Using Firebase project:', firebaseConfig.projectId);

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function countStations() {
  try {
    console.log('\n📊 Counting stations in Firestore...\n');
    
    // Get all tidal stations
    console.log('Fetching tidal stations...');
    const tidalSnapshot = await getDocs(collection(db, 'tidal-stations'));
    const tidalCount = tidalSnapshot.size;
    
    // Get all current stations
    console.log('Fetching current stations...');
    const currentSnapshot = await getDocs(collection(db, 'current-stations-packed'));
    const currentCount = currentSnapshot.size;
    
    console.log('\n═══════════════════════════════════════');
    console.log(`🌊 Tidal Stations: ${tidalCount}`);
    console.log(`🌀 Current Stations: ${currentCount}`);
    console.log(`📍 Total Stations: ${tidalCount + currentCount}`);
    console.log('═══════════════════════════════════════\n');
    
    // Show a few sample station names
    if (tidalCount > 0) {
      console.log('Sample Tidal Stations:');
      tidalSnapshot.docs.slice(0, 3).forEach(doc => {
        const data = doc.data();
        console.log(`  - ${data.name} (${data.lat}, ${data.lng})`);
      });
      if (tidalCount > 3) console.log(`  ... and ${tidalCount - 3} more`);
      console.log('');
    }
    
    if (currentCount > 0) {
      console.log('Sample Current Stations:');
      currentSnapshot.docs.slice(0, 3).forEach(doc => {
        const data = doc.data();
        console.log(`  - ${data.name} (${data.lat}, ${data.lng})`);
      });
      if (currentCount > 3) console.log(`  ... and ${currentCount - 3} more`);
      console.log('');
    }
    
  } catch (error) {
    console.error('Error counting stations:', error.message);
    console.error('\nMake sure your .env file has the correct Firebase credentials.');
    process.exit(1);
  }
  
  process.exit(0);
}

countStations();

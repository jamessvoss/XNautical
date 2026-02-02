#!/usr/bin/env node
/**
 * Test loading tide/current stations with predictions
 */

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
require('dotenv').config();

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'xnautical-8a296',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function testStationData() {
  console.log('\n📊 Testing Station Data Loading...\n');
  
  try {
    // Test loading a single tide station
    console.log('🌊 Loading tide station sample...');
    const tideSnapshot = await getDocs(collection(db, 'tidal-stations'));
    const firstTide = tideSnapshot.docs[0];
    
    if (firstTide) {
      const data = firstTide.data();
      console.log(`\nStation: ${data.name}`);
      console.log(`ID: ${firstTide.id}`);
      console.log(`Location: ${data.lat}, ${data.lng}`);
      console.log(`Type: ${data.type === 'R' ? 'Reference' : 'Subordinate'}`);
      
      if (data.predictions) {
        const dateKeys = Object.keys(data.predictions);
        console.log(`\nPredictions: ${dateKeys.length} days`);
        
        if (dateKeys.length > 0) {
          // Show today's predictions if available
          const now = new Date();
          const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
          
          if (data.predictions[todayKey]) {
            console.log(`\nToday's Tides (${todayKey}):`);
            data.predictions[todayKey].forEach(event => {
              const type = event.type === 'H' ? 'High' : 'Low';
              console.log(`  ${event.time} - ${type} tide: ${event.height.toFixed(2)} ft`);
            });
          } else {
            // Show first available date
            const firstDate = dateKeys.sort()[0];
            console.log(`\nSample Tides (${firstDate}):`);
            data.predictions[firstDate].forEach(event => {
              const type = event.type === 'H' ? 'High' : 'Low';
              console.log(`  ${event.time} - ${type} tide: ${event.height.toFixed(2)} ft`);
            });
          }
          
          console.log(`\nDate Range: ${dateKeys.sort()[0]} to ${dateKeys.sort()[dateKeys.length - 1]}`);
        }
      } else {
        console.log('\n⚠️  No predictions found for this station');
      }
    }
    
    // Test loading a single current station
    console.log('\n\n🌀 Loading current station sample...');
    const currentSnapshot = await getDocs(collection(db, 'current-stations-packed'));
    const firstCurrent = currentSnapshot.docs[0];
    
    if (firstCurrent) {
      const data = firstCurrent.data();
      console.log(`\nStation: ${data.name}`);
      console.log(`ID: ${firstCurrent.id}`);
      console.log(`Location: ${data.lat}, ${data.lng}`);
      console.log(`Bin: ${data.bin}`);
      
      if (data.predictions) {
        const dateKeys = Object.keys(data.predictions);
        console.log(`\nPredictions: ${dateKeys.length} days`);
        
        if (dateKeys.length > 0) {
          const firstDate = dateKeys.sort()[0];
          console.log(`\nSample Currents (${firstDate}):`);
          const events = data.predictions[firstDate].slice(0, 3); // First 3 events
          events.forEach(event => {
            console.log(`  ${event.time} - ${event.type}: ${event.velocity?.toFixed(2) || 'N/A'} kts`);
          });
          
          console.log(`\nDate Range: ${dateKeys.sort()[0]} to ${dateKeys.sort()[dateKeys.length - 1]}`);
        }
      } else {
        console.log('\n⚠️  No predictions found for this station');
      }
    }
    
    // Calculate total data size
    console.log('\n\n📦 Calculating total data size...');
    let totalTideBytes = 0;
    tideSnapshot.docs.forEach(doc => {
      const jsonStr = JSON.stringify(doc.data());
      totalTideBytes += jsonStr.length;
    });
    
    let totalCurrentBytes = 0;
    currentSnapshot.docs.forEach(doc => {
      const jsonStr = JSON.stringify(doc.data());
      totalCurrentBytes += jsonStr.length;
    });
    
    console.log(`\nTide Data:`);
    console.log(`  Stations: ${tideSnapshot.size}`);
    console.log(`  Size: ${(totalTideBytes / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  Avg per station: ${(totalTideBytes / tideSnapshot.size / 1024).toFixed(2)} KB`);
    
    console.log(`\nCurrent Data:`);
    console.log(`  Stations: ${currentSnapshot.size}`);
    console.log(`  Size: ${(totalCurrentBytes / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  Avg per station: ${(totalCurrentBytes / currentSnapshot.size / 1024).toFixed(2)} KB`);
    
    console.log(`\n📊 Total in-memory storage: ${((totalTideBytes + totalCurrentBytes) / (1024 * 1024)).toFixed(2)} MB\n`);
    
  } catch (error) {
    console.error('Error testing station data:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

testStationData();

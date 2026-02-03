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
  console.log('Inspecting predictions structure...\n');
  
  // Get first tide station with predictions
  const tideSnapshot = await db.collection('tidal-stations').limit(1).get();
  if (!tideSnapshot.empty) {
    const doc = tideSnapshot.docs[0];
    const data = doc.data();
    console.log('=== TIDE STATION SAMPLE ===');
    console.log('Document ID:', doc.id);
    console.log('All fields:', Object.keys(data));
    console.log('');
    
    if (data.predictions) {
      const predictionDates = Object.keys(data.predictions);
      console.log('Predictions field exists!');
      console.log(`Number of dates: ${predictionDates.length}`);
      console.log('Date range:', predictionDates[0], 'to', predictionDates[predictionDates.length - 1]);
      console.log('Sample date:', predictionDates[0]);
      console.log('Sample events:', JSON.stringify(data.predictions[predictionDates[0]], null, 2));
      console.log('');
    } else {
      console.log('No predictions field found!');
      console.log('');
    }
  }
  
  // Get catalog document for current stations
  const catalogDoc = await db.collection('current-stations-packed').doc('catalog').get();
  if (catalogDoc.exists) {
    const data = catalogDoc.data();
    console.log('=== CURRENT STATIONS CATALOG ===');
    console.log('All fields:', Object.keys(data));
    console.log('Number of locations:', data.locations?.length || 0);
    
    if (data.locations && data.locations.length > 0) {
      console.log('\nSample location:', JSON.stringify(data.locations[0], null, 2).substring(0, 300));
    }
    console.log('');
  }
  
  // Check if individual current station docs have predictions
  const currentSnapshot = await db.collection('current-stations-packed')
    .where(admin.firestore.FieldPath.documentId(), '!=', 'catalog')
    .limit(1)
    .get();
  
  if (!currentSnapshot.empty) {
    const doc = currentSnapshot.docs[0];
    const data = doc.data();
    console.log('=== INDIVIDUAL CURRENT STATION ===');
    console.log('Document ID:', doc.id);
    console.log('All fields:', Object.keys(data));
    console.log('Months available:', data.monthsAvailable);
    console.log('');
    
    // Check for monthly prediction documents
    if (data.monthsAvailable && data.monthsAvailable.length > 0) {
      const sampleMonth = data.monthsAvailable[0];
      console.log(`Checking for predictions subcollection: ${doc.id}/predictions/${sampleMonth}`);
      
      const predDoc = await db.collection('current-stations-packed')
        .doc(doc.id)
        .collection('predictions')
        .doc(sampleMonth)
        .get();
      
      if (predDoc.exists) {
        const predData = predDoc.data();
        console.log('Monthly predictions document found!');
        console.log('Fields:', Object.keys(predData));
        console.log('Sample:', JSON.stringify(predData, null, 2).substring(0, 500));
      } else {
        console.log('No predictions subcollection found');
      }
    }
  }
  
  await admin.app().delete();
}

inspectDocuments().catch(console.error);

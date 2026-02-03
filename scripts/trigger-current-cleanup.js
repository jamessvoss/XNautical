#!/usr/bin/env node
/**
 * Manually trigger current predictions cleanup
 */

const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = path.join(__dirname, 'service-accounts', 'xnautical-key.json');
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const functions = require('firebase-functions-test')({
  projectId: 'xnautical-8a296',
}, serviceAccountPath);

async function triggerCleanup() {
  console.log('Triggering current predictions cleanup...\n');
  
  try {
    // Use Firebase Admin SDK to call the function
    const { getFunctions, httpsCallable } = require('firebase-admin/functions');
    
    // Or use HTTP request directly
    const https = require('https');
    const options = {
      hostname: 'us-central1-xnautical-8a296.cloudfunctions.net',
      path: '/triggerCurrentPredictionsCleanup',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        console.log('Response:', data);
        process.exit(0);
      });
    });
    
    req.on('error', (error) => {
      console.error('Error:', error);
      process.exit(1);
    });
    
    req.write(JSON.stringify({ data: {} }));
    req.end();
    
  } catch (error) {
    console.error('Error triggering cleanup:', error);
    process.exit(1);
  }
}

triggerCleanup();

#!/usr/bin/env node
/**
 * Manually trigger bundle generation via HTTP
 */

const https = require('https');

const url = 'https://us-central1-xnautical-8a296.cloudfunctions.net/triggerBundleGeneration';

console.log('Triggering predictions bundle generation...');
console.log('URL:', url);
console.log('This will take several minutes (fetching, compressing, uploading)...');
console.log('');

const postData = JSON.stringify({ data: {} });

const options = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': postData.length,
  },
};

const req = https.request(url, options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log('');
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Response:');
    try {
      const parsed = JSON.parse(data);
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      console.log(data);
    }
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
  process.exit(1);
});

req.write(postData);
req.end();

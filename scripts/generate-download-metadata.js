#!/usr/bin/env node
/**
 * Generate Download Metadata for Districts
 * 
 * Triggers the district-metadata Cloud Run service to generate
 * pre-computed metadata files for all or specific districts.
 * 
 * Usage:
 *   node scripts/generate-download-metadata.js [districtId]
 *   
 * Examples:
 *   node scripts/generate-download-metadata.js         # All districts
 *   node scripts/generate-download-metadata.js 17cgd   # Just Alaska
 */

const https = require('https');

// Cloud Run service URL (update after deployment)
const SERVICE_URL = 'https://generate-district-metadata-653355603694.us-central1.run.app';

const DISTRICTS = [
  '01cgd', '05cgd', '07cgd', '08cgd', '09cgd',
  '11cgd', '13cgd', '14cgd', '17cgd'
];

async function generateMetadata(districtId) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ districtId });
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    
    console.log(`\nGenerating metadata for ${districtId}...`);
    
    const req = https.request(`${SERVICE_URL}/generateMetadata`, options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (res.statusCode === 200) {
            console.log(`  ✓ Success: ${result.packCount} packs, ${result.totalSizeGB} GB`);
            console.log(`  Saved to: ${result.metadataPath}`);
            resolve(result);
          } else {
            console.error(`  ✗ Error: ${result.error}`);
            reject(new Error(result.error));
          }
        } catch (parseError) {
          console.error(`  ✗ Parse error:`, data);
          reject(parseError);
        }
      });
    });
    
    req.on('error', (error) => {
      console.error(`  ✗ Request failed:`, error.message);
      reject(error);
    });
    
    req.write(postData);
    req.end();
  });
}

async function main() {
  const targetDistrict = process.argv[2];
  
  if (SERVICE_URL.includes('XXXXXXXX')) {
    console.error('Error: Please update SERVICE_URL in this script with your actual Cloud Run service URL');
    console.error('Deploy the service first with: cd cloud-functions/district-metadata && ./deploy.sh');
    process.exit(1);
  }
  
  if (targetDistrict) {
    // Generate for specific district
    console.log(`Generating metadata for district: ${targetDistrict}`);
    await generateMetadata(targetDistrict);
  } else {
    // Generate for all districts
    console.log(`Generating metadata for ${DISTRICTS.length} districts...`);
    for (const districtId of DISTRICTS) {
      try {
        await generateMetadata(districtId);
      } catch (error) {
        console.error(`Failed for ${districtId}, continuing...`);
      }
    }
  }
  
  console.log('\n✓ Metadata generation complete!');
  console.log('The app will now load real file sizes from these pre-generated metadata files.');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

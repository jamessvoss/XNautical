#!/usr/bin/env node
/**
 * Backfill regionBoundary from manifest.json files in Storage.
 * For districts where chartData.scales doesn't have bounds,
 * falls back to reading the manifest.json from Firebase Storage.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=xnautical-service-account.json node scripts/backfill-region-boundary-from-manifest.js
 */

const admin = require('firebase-admin');
const { Storage } = require('@google-cloud/storage');

admin.initializeApp({ projectId: 'xnautical-8a296' });
const db = admin.firestore();
const storage = new Storage();
const bucket = storage.bucket('xnautical-8a296.firebasestorage.app');

const DISTRICTS = [
  '01cgd', '05cgd', '07cgd', '08cgd', '09cgd',
  '11cgd', '13cgd', '14cgd', '17cgd',
];

async function backfillFromManifest(districtId) {
  // First check if regionBoundary already exists
  const doc = await db.collection('districts').doc(districtId).get();
  if (doc.exists && doc.data().regionBoundary) {
    console.log(`  ${districtId}: regionBoundary already exists, skipping`);
    return;
  }

  // Try to read manifest.json from Storage
  try {
    const [content] = await bucket.file(`${districtId}/charts/manifest.json`).download();
    const manifest = JSON.parse(content.toString());

    let west = 180, south = 90, east = -180, north = -90;
    let found = false;

    for (const pack of manifest.packs || []) {
      const b = pack.bounds;
      if (!b) continue;
      if (b.west === -180 && b.east === 180) continue;
      found = true;
      west = Math.min(west, b.west);
      south = Math.min(south, b.south);
      east = Math.max(east, b.east);
      north = Math.max(north, b.north);
      console.log(`  ${districtId} ${pack.scale}: [${b.west}, ${b.south}, ${b.east}, ${b.north}]`);
    }

    if (found) {
      const boundary = { west, south, east, north };
      console.log(`  ${districtId} UNION: [${west}, ${south}, ${east}, ${north}]`);
      await db.collection('districts').doc(districtId).set(
        { regionBoundary: boundary },
        { merge: true }
      );
      console.log(`  ${districtId}: WRITTEN\n`);
    } else {
      console.log(`  ${districtId}: no valid bounds in manifest\n`);
    }
  } catch (e) {
    console.log(`  ${districtId}: ${e.message}\n`);
  }
}

async function main() {
  console.log('Backfilling regionBoundary from manifest.json...\n');

  for (const districtId of DISTRICTS) {
    await backfillFromManifest(districtId);
  }

  console.log('Done.');
}

main().catch(console.error);

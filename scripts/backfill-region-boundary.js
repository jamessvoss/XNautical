#!/usr/bin/env node
/**
 * Backfill regionBoundary for all districts.
 *
 * Reads chartData.scales from each district document in Firestore,
 * computes the union bounding box across all scales, and writes it
 * back as the regionBoundary field.
 *
 * Usage:
 *   node scripts/backfill-region-boundary.js           # all districts
 *   node scripts/backfill-region-boundary.js 05cgd     # single district
 */

const admin = require('firebase-admin');

admin.initializeApp({ projectId: 'xnautical-8a296' });
const db = admin.firestore();

const DISTRICTS = [
  '01cgd', '05cgd', '07cgd', '08cgd', '09cgd',
  '11cgd', '13cgd', '14cgd', '17cgd',
];

async function computeRegionBoundary(districtId) {
  const doc = await db.collection('districts').doc(districtId).get();
  if (!doc.exists) {
    console.log(`  ${districtId}: document not found, skipping`);
    return null;
  }

  const data = doc.data();
  const scales = data?.chartData?.scales || {};

  let west = 180, south = 90, east = -180, north = -90;
  let found = false;

  for (const [scale, info] of Object.entries(scales)) {
    const b = info.bounds;
    if (!b) continue;
    // Skip default/fallback bounds
    if (b.west === -180 && b.east === 180) continue;
    found = true;
    west = Math.min(west, b.west);
    south = Math.min(south, b.south);
    east = Math.max(east, b.east);
    north = Math.max(north, b.north);
    console.log(`  ${districtId} ${scale}: [${b.west}, ${b.south}, ${b.east}, ${b.north}]`);
  }

  if (!found) {
    console.log(`  ${districtId}: no valid scale bounds found`);
    return null;
  }

  const boundary = { west, south, east, north };
  console.log(`  ${districtId} UNION: [${west}, ${south}, ${east}, ${north}]`);
  return boundary;
}

async function main() {
  const target = process.argv[2];
  const districts = target ? [target] : DISTRICTS;

  console.log(`Backfilling regionBoundary for ${districts.length} district(s)...\n`);

  for (const districtId of districts) {
    const boundary = await computeRegionBoundary(districtId);
    if (boundary) {
      await db.collection('districts').doc(districtId).set(
        { regionBoundary: boundary },
        { merge: true }
      );
      console.log(`  ${districtId}: WRITTEN\n`);
    } else {
      console.log(`  ${districtId}: SKIPPED (no bounds)\n`);
    }
  }

  console.log('Done.');
}

main().catch(console.error);

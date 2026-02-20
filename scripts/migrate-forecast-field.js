#!/usr/bin/env node
/**
 * Migrate marine forecast documents: rename "forecast" field to "periods"
 *
 * The Cloud Function originally saved the periods array as "forecast",
 * which is confusing since the entire document is a forecast.
 * This script renames it to "periods" for clarity.
 *
 * Usage:
 *   node scripts/migrate-forecast-field.js
 *   node scripts/migrate-forecast-field.js --dry-run
 */

const admin = require('firebase-admin');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');

const serviceAccountPath = path.join(__dirname, 'service-accounts', 'xnautical-key.json');
const serviceAccount = require(serviceAccountPath);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'xnautical-8a296',
});
const db = admin.firestore();

const DISTRICTS = ['01cgd', '05cgd', '07cgd', '08cgd', '09cgd', '11cgd', '13cgd', '14cgd', '17cgd'];

async function migrate() {
  let totalMigrated = 0;
  let totalSkipped = 0;

  for (const districtId of DISTRICTS) {
    const snap = await db.collection('districts').doc(districtId)
      .collection('marine-forecasts').get();

    let migrated = 0;
    let skipped = 0;

    for (const doc of snap.docs) {
      const data = doc.data();

      // Already migrated (has "periods", no "forecast")
      if (data.periods && !data.forecast) {
        skipped++;
        continue;
      }

      // Has old "forecast" field that needs renaming
      if (data.forecast && Array.isArray(data.forecast)) {
        if (DRY_RUN) {
          console.log(`  [dry-run] Would migrate ${districtId}/${doc.id}: forecast(${data.forecast.length} periods) → periods`);
        } else {
          await doc.ref.update({
            periods: data.forecast,
            forecast: admin.firestore.FieldValue.delete(),
          });
        }
        migrated++;
      } else {
        skipped++;
      }
    }

    console.log(`${districtId}: ${migrated} migrated, ${skipped} skipped (total ${snap.size})`);
    totalMigrated += migrated;
    totalSkipped += skipped;
  }

  console.log(`\nDone${DRY_RUN ? ' (dry-run)' : ''}. Migrated: ${totalMigrated}, Skipped: ${totalSkipped}`);
}

migrate().then(() => process.exit(0)).catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

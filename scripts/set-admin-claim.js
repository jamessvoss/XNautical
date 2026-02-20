#!/usr/bin/env node
/**
 * Set admin custom claim on a Firebase Auth user.
 *
 * Usage:
 *   node scripts/set-admin-claim.js <user-uid-or-email>
 *
 * Requires:
 *   - GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service account key, OR
 *   - Running on a machine with gcloud auth configured for the xnautical-8a296 project
 */

const admin = require('firebase-admin');

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/set-admin-claim.js <user-uid-or-email>');
  process.exit(1);
}

admin.initializeApp({
  projectId: 'xnautical-8a296',
});

async function main() {
  let user;
  if (target.includes('@')) {
    user = await admin.auth().getUserByEmail(target);
  } else {
    user = await admin.auth().getUser(target);
  }

  console.log(`Setting admin claim on user: ${user.email || user.uid}`);
  await admin.auth().setCustomUserClaims(user.uid, { admin: true });
  console.log('Done! Admin claim set. The user needs to sign out and back in for it to take effect.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

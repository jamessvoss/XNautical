/**
 * district-config.js
 *
 * Single source of truth for USCG Coast Guard District metadata.
 * Reads from config/regions.json (the master config) and provides
 * helper functions for all data discovery and processing scripts.
 *
 * This module provides:
 *   - Canonical district definitions (name, code, bounds)
 *   - Helper function to ensure districts exist in Firestore with complete metadata
 *   - Prevents data divergence between different scripts
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Load Master Config
// ============================================================================

const MASTER_CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'regions.json');

let masterConfig;
try {
  masterConfig = JSON.parse(fs.readFileSync(MASTER_CONFIG_PATH, 'utf-8'));
} catch (error) {
  console.error(`Failed to load master config from ${MASTER_CONFIG_PATH}: ${error.message}`);
  process.exit(1);
}

// Build DISTRICTS from master config (same shape as before for backward compat)
const DISTRICTS = {};
for (const [id, region] of Object.entries(masterConfig.regions)) {
  DISTRICTS[id] = {
    name: region.name,
    code: region.code,
    bounds: region.bounds,
    description: region.description,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Ensure a district document exists in Firestore with complete metadata.
 * Creates or updates the district with name, code, and bounds.
 *
 * @param {admin.firestore.Firestore} db - Firestore instance
 * @param {string} districtId - District ID (e.g., '01cgd')
 * @param {Object} options - Options
 * @param {boolean} options.silent - If true, suppress console output
 * @returns {Promise<void>}
 * @throws {Error} If districtId is not in DISTRICTS
 */
async function ensureDistrictExists(db, districtId, options = {}) {
  const { silent = false } = options;

  const config = DISTRICTS[districtId];
  if (!config) {
    throw new Error(`Unknown district ID: ${districtId}. Valid districts: ${Object.keys(DISTRICTS).join(', ')}`);
  }

  try {
    const districtRef = db.collection('districts').doc(districtId);
    const districtSnap = await districtRef.get();

    const districtData = {
      name: config.name,
      code: config.code,
      bounds: config.bounds,
      description: config.description,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (!districtSnap.exists) {
      // Create new district document
      districtData.createdAt = admin.firestore.FieldValue.serverTimestamp();
      await districtRef.set(districtData);
      if (!silent) {
        console.log(`   ✓ Created district document: ${districtId} (${config.name})`);
      }
    } else {
      // Update existing district (merge to preserve other fields)
      await districtRef.set(districtData, { merge: true });
      if (!silent) {
        console.log(`   ✓ Updated district metadata: ${districtId} (${config.name})`);
      }
    }
  } catch (error) {
    console.error(`   ✗ Error ensuring district ${districtId} exists: ${error.message}`);
    throw error;
  }
}

/**
 * Get district configuration by ID.
 *
 * @param {string} districtId - District ID (e.g., '01cgd')
 * @returns {Object|null} District config or null if not found
 */
function getDistrictConfig(districtId) {
  return DISTRICTS[districtId] || null;
}

/**
 * Get full region config (all fields) by ID.
 *
 * @param {string} regionId - Region ID (e.g., '01cgd', '17cgd-Juneau')
 * @returns {Object|null} Full region config or null if not found
 */
function getRegionConfig(regionId) {
  return masterConfig.regions[regionId] || null;
}

/**
 * Get all district IDs.
 *
 * @returns {string[]} Array of district IDs
 */
function getAllDistrictIds() {
  return Object.keys(DISTRICTS);
}

/**
 * Check if coordinates fall within a district's bounds.
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {string} districtId - District ID to check
 * @returns {boolean} True if coordinates are within bounds
 */
function isWithinDistrict(lat, lng, districtId) {
  const config = DISTRICTS[districtId];
  if (!config) return false;

  const { bounds } = config;

  // Normalize to array (some regions like 17cgd use array of bounds for antimeridian crossing)
  const boundsList = Array.isArray(bounds) ? bounds : [bounds];

  return boundsList.some(b => {
    if (b.west > b.east) {
      // District crosses dateline (e.g., Alaska)
      return lat >= b.south && lat <= b.north &&
             (lng >= b.west || lng <= b.east);
    }
    // Normal bounds
    return lat >= b.south && lat <= b.north &&
           lng >= b.west && lng <= b.east;
  });
}

/**
 * Find which district(s) contain the given coordinates.
 * Some coordinates may fall in multiple overlapping districts.
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {string[]} Array of district IDs containing the coordinates
 */
function findDistrictsForCoordinates(lat, lng) {
  return Object.keys(DISTRICTS).filter(districtId =>
    isWithinDistrict(lat, lng, districtId)
  );
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  DISTRICTS,
  ensureDistrictExists,
  getDistrictConfig,
  getRegionConfig,
  getAllDistrictIds,
  isWithinDistrict,
  findDistrictsForCoordinates,
};

/**
 * district-config.js
 * 
 * Single source of truth for USCG Coast Guard District metadata.
 * Used by all data discovery and processing scripts to ensure consistency.
 * 
 * This module provides:
 *   - Canonical district definitions (name, code, bounds)
 *   - Helper function to ensure districts exist in Firestore with complete metadata
 *   - Prevents data divergence between different scripts
 */

const admin = require('firebase-admin');

// ============================================================================
// District Configuration (Single Source of Truth)
// ============================================================================

const DISTRICTS = {
  '01cgd': {
    name: 'Northeast',
    code: '01 CGD',
    bounds: { west: -76, south: 39, east: -65, north: 48 },
    description: 'New England and Northern Mid-Atlantic',
  },
  '05cgd': {
    name: 'East',
    code: '05 CGD',
    bounds: { west: -82, south: 32, east: -72, north: 42 },
    description: 'Mid-Atlantic',
  },
  '07cgd': {
    name: 'Southeast',
    code: '07 CGD',
    bounds: { west: -85, south: 23, east: -63, north: 35 },
    description: 'Florida, Georgia, South Carolina, Puerto Rico, USVI',
  },
  '08cgd': {
    name: 'Heartland',
    code: '08 CGD',
    bounds: { west: -100, south: 23, east: -80, north: 33 },
    description: 'Gulf Coast',
  },
  '09cgd': {
    name: 'Great Lakes',
    code: '09 CGD',
    bounds: { west: -94, south: 40, east: -75, north: 50 },
    description: 'Great Lakes region',
  },
  '11cgd': {
    name: 'Southwest',
    code: '11 CGD',
    bounds: { west: -126, south: 30, east: -114, north: 39 },
    description: 'Southern California',
  },
  '13cgd': {
    name: 'Northwest',
    code: '13 CGD',
    bounds: { west: -130, south: 33, east: -119, north: 50 },
    description: 'Pacific Northwest',
  },
  '14cgd': {
    name: 'Oceania',
    code: '14 CGD',
    bounds: { west: -162, south: 17, east: -153, north: 24 },
    description: 'Hawaii and Pacific Islands',
  },
  '17cgd': {
    name: 'Arctic',
    code: '17 CGD',
    // Alaska spans the dateline, so it has multiple bounds regions
    // Using primary bounds here - scripts can handle multiple bounds if needed
    bounds: { west: -180, south: 50, east: -129, north: 72 },
    // Full bounds including dateline crossing:
    // [{ west: -180, south: 50, east: -129, north: 72 }, { west: 170, south: 50, east: 180, north: 65 }]
    description: 'Alaska and Arctic',
  },
};

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
  
  // Handle longitude wrapping (dateline crossing)
  if (bounds.west > bounds.east) {
    // District crosses dateline (e.g., Alaska)
    return lat >= bounds.south && lat <= bounds.north &&
           (lng >= bounds.west || lng <= bounds.east);
  } else {
    // Normal bounds
    return lat >= bounds.south && lat <= bounds.north &&
           lng >= bounds.west && lng <= bounds.east;
  }
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
  getAllDistrictIds,
  isWithinDistrict,
  findDistrictsForCoordinates,
};

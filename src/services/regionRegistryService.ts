/**
 * Region Registry Service
 *
 * Tracks which districts/regions are installed on the device and what
 * data categories each has (charts, predictions, buoys, satellite, etc.).
 * Backed by AsyncStorage for persistence across app restarts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ============================================
// Types
// ============================================

export interface InstalledDistrictRecord {
  districtId: string;       // e.g., '17cgd'
  installedAt: number;      // timestamp (Date.now())
  hasCharts: boolean;
  hasPredictions: boolean;
  hasBuoys: boolean;
  hasMarineZones: boolean;
  hasSatellite: boolean;
  hasBasemap: boolean;
  hasGnis: boolean;
  hasOcean: boolean;
  hasTerrain: boolean;
}

// ============================================
// Constants
// ============================================

const STORAGE_KEY = '@XNautical:installedDistricts';

// ============================================
// In-memory cache
// ============================================

let cachedDistricts: InstalledDistrictRecord[] | null = null;

// ============================================
// Core Functions
// ============================================

/**
 * Get all installed district records.
 * Returns an empty array if none are installed.
 */
export async function getInstalledDistricts(): Promise<InstalledDistrictRecord[]> {
  if (cachedDistricts !== null) {
    return cachedDistricts;
  }

  try {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    if (json) {
      cachedDistricts = JSON.parse(json) as InstalledDistrictRecord[];
      return cachedDistricts;
    }
  } catch (error) {
    console.error('[RegionRegistry] Error reading installed districts:', error);
  }

  cachedDistricts = [];
  return cachedDistricts;
}

/**
 * Get a single installed district record by ID.
 * Returns null if not found.
 */
export async function getInstalledDistrict(districtId: string): Promise<InstalledDistrictRecord | null> {
  const districts = await getInstalledDistricts();
  return districts.find(d => d.districtId === districtId) || null;
}

/**
 * Get just the district IDs of all installed districts.
 */
export async function getInstalledDistrictIds(): Promise<string[]> {
  const districts = await getInstalledDistricts();
  return districts.map(d => d.districtId);
}

/**
 * Register a new district or update an existing one.
 * If the district already exists, it will be updated (merged).
 */
export async function registerDistrict(
  districtId: string,
  data?: Partial<Omit<InstalledDistrictRecord, 'districtId'>>
): Promise<void> {
  const districts = await getInstalledDistricts();
  const existingIndex = districts.findIndex(d => d.districtId === districtId);

  const defaults: InstalledDistrictRecord = {
    districtId,
    installedAt: Date.now(),
    hasCharts: false,
    hasPredictions: false,
    hasBuoys: false,
    hasMarineZones: false,
    hasSatellite: false,
    hasBasemap: false,
    hasGnis: false,
    hasOcean: false,
    hasTerrain: false,
  };

  if (existingIndex >= 0) {
    // Merge with existing record
    districts[existingIndex] = {
      ...districts[existingIndex],
      ...data,
    };
  } else {
    // Add new record
    districts.push({
      ...defaults,
      ...data,
    });
  }

  await saveDistricts(districts);
  console.log(`[RegionRegistry] Registered district ${districtId}`, data);
}

/**
 * Update specific fields of an installed district record.
 * Does nothing if the district is not installed.
 */
export async function updateDistrictRecord(
  districtId: string,
  updates: Partial<Omit<InstalledDistrictRecord, 'districtId'>>
): Promise<void> {
  const districts = await getInstalledDistricts();
  const index = districts.findIndex(d => d.districtId === districtId);

  if (index < 0) {
    console.warn(`[RegionRegistry] Cannot update - district ${districtId} not found`);
    return;
  }

  districts[index] = {
    ...districts[index],
    ...updates,
  };

  await saveDistricts(districts);
  console.log(`[RegionRegistry] Updated district ${districtId}`, updates);
}

/**
 * Unregister (remove) a district from the registry.
 * Returns true if the district was found and removed.
 */
export async function unregisterDistrict(districtId: string): Promise<boolean> {
  const districts = await getInstalledDistricts();
  const index = districts.findIndex(d => d.districtId === districtId);

  if (index < 0) {
    console.warn(`[RegionRegistry] Cannot unregister - district ${districtId} not found`);
    return false;
  }

  districts.splice(index, 1);
  await saveDistricts(districts);
  console.log(`[RegionRegistry] Unregistered district ${districtId}`);
  return true;
}

/**
 * Check if a specific district is installed.
 */
export async function isDistrictInstalled(districtId: string): Promise<boolean> {
  const districts = await getInstalledDistricts();
  return districts.some(d => d.districtId === districtId);
}

/**
 * Check if any districts are installed.
 */
export async function hasAnyInstalledDistricts(): Promise<boolean> {
  const districts = await getInstalledDistricts();
  return districts.length > 0;
}

/**
 * Clear all installed districts (for debugging/reset).
 */
export async function clearRegistry(): Promise<void> {
  cachedDistricts = [];
  await AsyncStorage.removeItem(STORAGE_KEY);
  console.log('[RegionRegistry] Registry cleared');
}

/**
 * Invalidate the in-memory cache so the next read goes to AsyncStorage.
 */
export function invalidateCache(): void {
  cachedDistricts = null;
}

// ============================================
// Internal Helpers
// ============================================

async function saveDistricts(districts: InstalledDistrictRecord[]): Promise<void> {
  cachedDistricts = districts;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(districts));
  } catch (error) {
    console.error('[RegionRegistry] Error saving installed districts:', error);
    throw error;
  }
}

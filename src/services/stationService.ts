import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../config/firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { unzip } from 'react-native-zip-archive';
import * as SQLite from 'expo-sqlite';

// Initialize Firebase Functions
const functions = getFunctions(app);

console.log('Using Cloud Function for station locations (single optimized call)');

const STORAGE_KEY_TIDE_STATIONS = '@XNautical:tideStations';
const STORAGE_KEY_CURRENT_STATIONS = '@XNautical:currentStations';
const STORAGE_KEY_STATIONS_TIMESTAMP = '@XNautical:stationsTimestamp';

// Prediction storage keys
const STORAGE_KEY_TIDE_PREDICTIONS = '@XNautical:tidePredictions';
const STORAGE_KEY_CURRENT_PREDICTIONS = '@XNautical:currentPredictions';
const STORAGE_KEY_PREDICTIONS_TIMESTAMP = '@XNautical:predictionsTimestamp';
const STORAGE_KEY_PREDICTIONS_STATS = '@XNautical:predictionsStats';

export interface TideEvent {
  time: string;      // "HH:MM"
  height: number;    // feet
  type: 'H' | 'L';   // High or Low
}

export interface TideStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: 'R' | 'S'; // Reference or Subordinate
  predictions?: Record<string, TideEvent[]>; // Date key -> tide events
}

export interface CurrentEvent {
  time: string;      // "HH:MM"
  velocity: number;  // knots
  direction?: number; // degrees (optional)
  type: 'slack' | 'flood' | 'ebb';
}

export interface CurrentStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  bin: number;
  predictions?: Record<string, CurrentEvent[]>; // Date key -> current events
}

let cachedTideStations: TideStation[] | null = null;
let cachedCurrentStations: CurrentStation[] | null = null;
let fetchPromise: Promise<void> | null = null;
let loadedFromStorage = false;

// In-memory cache for predictions (loaded from AsyncStorage)
let cachedTidePredictions: Record<string, Record<string, TideEvent[]>> = {};
let cachedCurrentPredictions: Record<string, Record<string, any>> = {};
let predictionsLoaded = false;

/**
 * Load stations from AsyncStorage
 * This is called on app startup and when returning from prediction downloads
 */
export async function loadFromStorage(): Promise<void> {
  if (loadedFromStorage) return;
  
  try {
    console.log('Loading stations from AsyncStorage...');
    const [tidesJson, currentsJson, timestamp] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY_TIDE_STATIONS),
      AsyncStorage.getItem(STORAGE_KEY_CURRENT_STATIONS),
      AsyncStorage.getItem(STORAGE_KEY_STATIONS_TIMESTAMP),
    ]);
    
    if (tidesJson && currentsJson) {
      cachedTideStations = JSON.parse(tidesJson);
      cachedCurrentStations = JSON.parse(currentsJson);
      console.log(`Loaded ${cachedTideStations?.length || 0} tide stations and ${cachedCurrentStations?.length || 0} current stations from storage`);
      
      if (timestamp) {
        const age = Date.now() - parseInt(timestamp);
        console.log(`Station data is ${Math.round(age / 1000 / 60 / 60)} hours old`);
      }
    } else {
      console.log('No stations found in storage');
    }
  } catch (error) {
    console.error('Error loading stations from storage:', error);
  } finally {
    loadedFromStorage = true;
  }
}

/**
 * Save stations to AsyncStorage
 */
async function saveToStorage(): Promise<void> {
  if (!cachedTideStations || !cachedCurrentStations) return;
  
  try {
    console.log('Saving stations to AsyncStorage...');
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEY_TIDE_STATIONS, JSON.stringify(cachedTideStations)),
      AsyncStorage.setItem(STORAGE_KEY_CURRENT_STATIONS, JSON.stringify(cachedCurrentStations)),
      AsyncStorage.setItem(STORAGE_KEY_STATIONS_TIMESTAMP, Date.now().toString()),
    ]);
    console.log(`Saved ${cachedTideStations.length} tide stations and ${cachedCurrentStations.length} current stations to storage`);
  } catch (error) {
    console.error('Error saving stations to storage:', error);
  }
}

/**
 * Internal function to fetch both tide and current stations from Cloud Function
 * This is called by both fetchTideStations and fetchCurrentStations to ensure
 * they share the same data and only make one Cloud Function call
 */
async function fetchAllStations(): Promise<void> {
  // First, try loading from storage
  await loadFromStorage();
  
  // If already in memory cache, return immediately
  if (cachedTideStations && cachedCurrentStations) {
    return Promise.resolve();
  }

  // If already fetching, wait for that to complete
  if (fetchPromise) {
    return fetchPromise;
  }

  // Create the fetch promise
  fetchPromise = (async () => {
    try {
      console.log('Calling getStationLocations Cloud Function...');
      const getLocations = httpsCallable(functions, 'getStationLocations');
      const result = await getLocations({});
      const data = result.data as any;
      
      console.log(`Received ${data.tideStations.length} tide stations and ${data.currentStations.length} current stations from Cloud Function`);
      
      // Cache tide stations
      cachedTideStations = data.tideStations.map((station: any) => ({
        id: station.id,
        name: station.name,
        lat: station.lat,
        lng: station.lng,
        type: station.type,
        predictions: undefined,
      }));
      
      // Cache current stations
      cachedCurrentStations = data.currentStations.map((station: any) => ({
        id: station.id,
        name: station.name,
        lat: station.lat,
        lng: station.lng,
        bin: station.bin,
        predictions: undefined,
      }));
      
      console.log(`Cached ${cachedTideStations?.length || 0} tide stations and ${cachedCurrentStations?.length || 0} current stations in memory`);
      
      // Save to AsyncStorage for persistence
      await saveToStorage();
    } catch (error) {
      console.error('Error fetching station locations:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      throw error;
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

/**
 * Get cached tide stations without fetching
 */
export function getCachedTideStations(): TideStation[] {
  return cachedTideStations || [];
}

/**
 * Get cached current stations without fetching
 */
export function getCachedCurrentStations(): CurrentStation[] {
  return cachedCurrentStations || [];
}

/**
 * Fetch all tide and current station locations from Cloud Function
 * Single optimized call returns both collections
 */
export async function fetchTideStations(includePredictions: boolean = false): Promise<TideStation[]> {
  await fetchAllStations();
  return cachedTideStations || [];
}

/**
 * Fetch all current station locations from Cloud Function
 * Single optimized call returns both collections
 */
export async function fetchCurrentStations(includePredictions: boolean = false): Promise<CurrentStation[]> {
  await fetchAllStations();
  return cachedCurrentStations || [];
}

/**
 * Clear cached stations (useful for testing/refresh)
 */
export function clearStationCache() {
  console.log('Clearing station cache from memory and storage...');
  cachedTideStations = null;
  cachedCurrentStations = null;
  loadedFromStorage = false;
  
  // Also clear from AsyncStorage
  AsyncStorage.multiRemove([
    STORAGE_KEY_TIDE_STATIONS,
    STORAGE_KEY_CURRENT_STATIONS,
    STORAGE_KEY_STATIONS_TIMESTAMP,
  ]).catch(error => {
    console.error('Error clearing station cache from storage:', error);
  });
}

/**
 * Get today's date key in YYYY-MM-DD format
 */
function getTodayDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get date key for a specific offset from today
 */
function getDateKey(daysOffset: number = 0): string {
  const now = new Date();
  now.setDate(now.getDate() + daysOffset);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get today's tide predictions for a station
 */
export function getTodayTides(station: TideStation): TideEvent[] {
  if (!station.predictions) return [];
  const todayKey = getTodayDateKey();
  return station.predictions[todayKey] || [];
}

/**
 * Get next N days of tide predictions for a station
 */
export function getUpcomingTides(station: TideStation, days: number = 7): Record<string, TideEvent[]> {
  if (!station.predictions) return {};
  
  const result: Record<string, TideEvent[]> = {};
  for (let i = 0; i < days; i++) {
    const dateKey = getDateKey(i);
    if (station.predictions[dateKey]) {
      result[dateKey] = station.predictions[dateKey];
    }
  }
  return result;
}

/**
 * Get next high tide for a station
 */
export function getNextHighTide(station: TideStation): { date: string; event: TideEvent } | null {
  if (!station.predictions) return null;
  
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  
  // Check today first
  const todayKey = getTodayDateKey();
  const todayEvents = station.predictions[todayKey] || [];
  
  for (const event of todayEvents) {
    if (event.type === 'H' && event.time > currentTime) {
      return { date: todayKey, event };
    }
  }
  
  // Check next 7 days
  for (let i = 1; i <= 7; i++) {
    const dateKey = getDateKey(i);
    const events = station.predictions[dateKey] || [];
    const highTide = events.find(e => e.type === 'H');
    if (highTide) {
      return { date: dateKey, event: highTide };
    }
  }
  
  return null;
}

/**
 * Get next low tide for a station
 */
export function getNextLowTide(station: TideStation): { date: string; event: TideEvent } | null {
  if (!station.predictions) return null;
  
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  
  // Check today first
  const todayKey = getTodayDateKey();
  const todayEvents = station.predictions[todayKey] || [];
  
  for (const event of todayEvents) {
    if (event.type === 'L' && event.time > currentTime) {
      return { date: todayKey, event };
    }
  }
  
  // Check next 7 days
  for (let i = 1; i <= 7; i++) {
    const dateKey = getDateKey(i);
    const events = station.predictions[dateKey] || [];
    const lowTide = events.find(e => e.type === 'L');
    if (lowTide) {
      return { date: dateKey, event: lowTide };
    }
  }
  
  return null;
}

/**
 * Get today's current predictions for a station
 */
export function getTodayCurrents(station: CurrentStation): CurrentEvent[] {
  if (!station.predictions) return [];
  const todayKey = getTodayDateKey();
  return station.predictions[todayKey] || [];
}

/**
 * Get next N days of current predictions for a station
 */
export function getUpcomingCurrents(station: CurrentStation, days: number = 7): Record<string, CurrentEvent[]> {
  if (!station.predictions) return {};
  
  const result: Record<string, CurrentEvent[]> = {};
  for (let i = 0; i < days; i++) {
    const dateKey = getDateKey(i);
    if (station.predictions[dateKey]) {
      result[dateKey] = station.predictions[dateKey];
    }
  }
  return result;
}

// ============================================================================
// PREDICTION DOWNLOAD AND MANAGEMENT
// ============================================================================

/**
 * Unpack current predictions from packed string format
 * Format: "HH:MM,f|e|s,velocity,direction|..."
 */
function unpackCurrentPredictions(packedDays: Record<number, string>): Record<string, CurrentEvent[]> {
  const result: Record<string, CurrentEvent[]> = {};
  
  for (const [dayNum, packedString] of Object.entries(packedDays)) {
    if (!packedString) continue;
    
    const events: CurrentEvent[] = [];
    const eventStrings = packedString.split('|');
    
    for (const eventStr of eventStrings) {
      const [time, typeChar, velocityStr, directionStr] = eventStr.split(',');
      if (!time || !typeChar) continue;
      
      const type = typeChar === 'f' ? 'flood' : typeChar === 'e' ? 'ebb' : 'slack';
      const velocity = parseFloat(velocityStr) || 0;
      const direction = directionStr ? parseInt(directionStr) : undefined;
      
      events.push({ time, velocity, direction, type });
    }
    
    // Store by day number (will be combined with month below)
    result[dayNum] = events;
  }
  
  return result;
}

/**
 * Get metadata for prediction databases (file sizes) before downloading
 */
export async function getPredictionDatabaseMetadata(districtId: string = '17cgd'): Promise<{
  tidesSize: number;
  currentsSize: number;
  totalSize: number;
  totalSizeMB: number;
}> {
  try {
    const { storage } = await import('../config/firebase');
    const { ref, getMetadata } = await import('firebase/storage');
    
    // Get metadata for both files (per-district naming)
    const tidesRef = ref(storage, `${districtId}/predictions/tides_${districtId}.db.zip`);
    const currentsRef = ref(storage, `${districtId}/predictions/currents_${districtId}.db.zip`);
    
    const [tidesMetadata, currentsMetadata] = await Promise.all([
      getMetadata(tidesRef),
      getMetadata(currentsRef),
    ]);
    
    const tidesSize = tidesMetadata.size || 0;
    const currentsSize = currentsMetadata.size || 0;
    const totalSize = tidesSize + currentsSize;
    
    return {
      tidesSize,
      currentsSize,
      totalSize,
      totalSizeMB: totalSize / 1024 / 1024,
    };
  } catch (error: any) {
    console.error('[PREDICTIONS] Error getting metadata:', error);
    throw error;
  }
}

/**
 * Helper function to download and extract a single database file
 */
async function downloadAndExtractDatabase(
  storagePath: string,
  localDbName: string,
  onProgress?: (percent: number) => void
): Promise<{ success: boolean; size: number; error?: string }> {
  const { storage } = await import('../config/firebase');
  const { ref, getDownloadURL } = await import('firebase/storage');
  
  const compressedPath = `${FileSystem.cacheDirectory}${localDbName}.zip`;
  const dbPath = `${FileSystem.documentDirectory}${localDbName}`;
  
  try {
    // Get download URL
    const storageRef = ref(storage, storagePath);
    const downloadUrl = await getDownloadURL(storageRef);
    
    // Download
    const downloadResumable = FileSystem.createDownloadResumable(
      downloadUrl,
      compressedPath,
      {},
      (downloadProgress) => {
        const { totalBytesWritten, totalBytesExpectedToWrite } = downloadProgress;
        if (totalBytesExpectedToWrite > 0) {
          const percent = Math.round((totalBytesWritten / totalBytesExpectedToWrite) * 100);
          onProgress?.(percent);
        }
      }
    );
    
    const result = await downloadResumable.downloadAsync();
    if (!result) {
      throw new Error('Download failed - no result returned');
    }
    
    // Extract
    const targetDirectory = FileSystem.documentDirectory;
    if (!targetDirectory) {
      throw new Error('Document directory not available');
    }
    await unzip(compressedPath, targetDirectory);
    
    // Clean up compressed file
    await FileSystem.deleteAsync(compressedPath, { idempotent: true });
    
    // Verify extraction
    const dbInfo = await FileSystem.getInfoAsync(dbPath);
    if (!dbInfo.exists) {
      throw new Error(`Extracted database file not found: ${dbPath}`);
    }
    
    return { success: true, size: dbInfo.size || 0 };
  } catch (error: any) {
    return { success: false, size: 0, error: error.message };
  }
}

/**
 * Download ALL tide and current predictions (separate databases)
 * Downloads tides.db.zip and currents.db.zip in parallel
 */
export async function downloadAllPredictions(
  onProgress?: (message: string, percent: number) => void,
  districtId: string = '17cgd'
): Promise<{ success: boolean; error?: string; stats?: any }> {
  try {
    const startTime = Date.now();
    let tidesProgress = 0;
    let currentsProgress = 0;
    
    const updateProgress = () => {
      const combinedProgress = Math.round((tidesProgress + currentsProgress) / 2);
      const uiPercent = 10 + Math.round(combinedProgress * 0.8); // 10-90%
      onProgress?.(`Downloading... Tides: ${tidesProgress}%, Currents: ${currentsProgress}%`, uiPercent);
    };
    
    onProgress?.('Downloading prediction databases...', 10);
    
    // Download both databases in parallel using district-specific paths and filenames
    const [tidesResult, currentsResult] = await Promise.all([
      downloadAndExtractDatabase(
        `${districtId}/predictions/tides_${districtId}.db.zip`,
        `tides_${districtId}.db`,
        (p) => { tidesProgress = p; updateProgress(); }
      ),
      downloadAndExtractDatabase(
        `${districtId}/predictions/currents_${districtId}.db.zip`,
        `currents_${districtId}.db`,
        (p) => { currentsProgress = p; updateProgress(); }
      ),
    ]);
    
    // Check results
    if (!tidesResult.success) {
      throw new Error(`Tides download failed: ${tidesResult.error}`);
    }
    if (!currentsResult.success) {
      throw new Error(`Currents download failed: ${currentsResult.error}`);
    }
    
    onProgress?.('Saving metadata...', 90);
    
    // Save metadata
    const totalSize = tidesResult.size + currentsResult.size;
    const stats = {
      tidesDbSize: tidesResult.size,
      currentsDbSize: currentsResult.size,
      totalSize: totalSize,
      bundleVersion: '2.0', // New version for split databases
      generated: new Date().toISOString(),
      format: 'sqlite-split',
    };
    
    await AsyncStorage.multiSet([
      [STORAGE_KEY_PREDICTIONS_TIMESTAMP, Date.now().toString()],
      [STORAGE_KEY_PREDICTIONS_STATS, JSON.stringify(stats)],
      [`@XNautical:tidesDbPath:${districtId}`, `${FileSystem.documentDirectory}tides_${districtId}.db`],
      [`@XNautical:currentsDbPath:${districtId}`, `${FileSystem.documentDirectory}currents_${districtId}.db`],
    ]);
    
    predictionsLoaded = true;
    
    // Fetch station metadata now that predictions are downloaded
    onProgress?.('Loading station locations...', 95);
    try {
      await fetchAllStations();
      console.log('[PREDICTIONS] Station metadata loaded successfully');
    } catch (error) {
      console.warn('[PREDICTIONS] Failed to load station metadata:', error);
      // Don't fail the whole download if station metadata fetch fails
    }
    
    const totalTime = Date.now() - startTime;
    
    onProgress?.('Download complete!', 100);
    
    return {
      success: true,
      stats: {
        ...stats,
        totalSizeMB: totalSize / 1024 / 1024,
        downloadTimeSec: Math.round(totalTime / 1000),
      },
    };
  } catch (error: any) {
    console.error('[PREDICTIONS] ========================================');
    console.error('[PREDICTIONS] ❌ ERROR OCCURRED!');
    console.error('[PREDICTIONS] ========================================');
    console.error('[PREDICTIONS] Error:', error.message);
    console.error('[PREDICTIONS] ========================================');
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Load predictions from AsyncStorage into memory
 * Called on app startup
 */
export async function loadPredictionsFromStorage(): Promise<boolean> {
  if (predictionsLoaded) return true;
  
  try {
    console.log('Loading predictions from AsyncStorage...');
    const [tidesJson, currentsJson, timestamp] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY_TIDE_PREDICTIONS),
      AsyncStorage.getItem(STORAGE_KEY_CURRENT_PREDICTIONS),
      AsyncStorage.getItem(STORAGE_KEY_PREDICTIONS_TIMESTAMP),
    ]);
    
    if (tidesJson && currentsJson) {
      cachedTidePredictions = JSON.parse(tidesJson);
      cachedCurrentPredictions = JSON.parse(currentsJson);
      predictionsLoaded = true;
      
      const tideStationCount = Object.keys(cachedTidePredictions).length;
      const currentStationCount = Object.keys(cachedCurrentPredictions).length;
      
      console.log(`Loaded predictions for ${tideStationCount} tide stations and ${currentStationCount} current stations`);
      
      if (timestamp) {
        const age = Date.now() - parseInt(timestamp);
        console.log(`Predictions are ${Math.round(age / 1000 / 60 / 60)} hours old`);
      }
      
      return true;
    } else {
      console.log('No predictions found in storage');
      return false;
    }
  } catch (error) {
    console.error('Error loading predictions from storage:', error);
    return false;
  }
}

/**
 * Get predictions stats (size, timestamp, etc)
 */
export async function getPredictionsStats(): Promise<any> {
  try {
    const [statsJson, timestamp] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY_PREDICTIONS_STATS),
      AsyncStorage.getItem(STORAGE_KEY_PREDICTIONS_TIMESTAMP),
    ]);
    
    if (statsJson && timestamp) {
      return {
        ...JSON.parse(statsJson),
        downloadedAt: new Date(parseInt(timestamp)).toISOString(),
        ageHours: Math.round((Date.now() - parseInt(timestamp)) / 1000 / 60 / 60),
      };
    }
    
    // Fallback: check if database file exists even if metadata is missing
    const dbPath = `${FileSystem.documentDirectory}predictions.db`;
    const dbInfo = await FileSystem.getInfoAsync(dbPath);
    
    if (dbInfo.exists && dbInfo.size) {
      return {
        totalSizeMB: dbInfo.size / 1024 / 1024,
        downloadedAt: new Date(dbInfo.modificationTime || 0).toISOString(),
        ageHours: dbInfo.modificationTime ? Math.round((Date.now() - dbInfo.modificationTime) / 1000 / 60 / 60) : 0,
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error getting predictions stats:', error);
    return null;
  }
}

/**
 * Check if predictions are downloaded for a specific district.
 * Uses per-district database filenames: tides_{districtId}.db, currents_{districtId}.db
 */
export async function arePredictionsDownloaded(districtId: string = '17cgd'): Promise<boolean> {
  try {
    console.log(`[PREDICTIONS] Checking if predictions are downloaded for ${districtId}...`);
    
    // Check for per-district databases
    const tidesDbPath = `${FileSystem.documentDirectory}tides_${districtId}.db`;
    const currentsDbPath = `${FileSystem.documentDirectory}currents_${districtId}.db`;
    
    const [tidesInfo, currentsInfo] = await Promise.all([
      FileSystem.getInfoAsync(tidesDbPath),
      FileSystem.getInfoAsync(currentsDbPath),
    ]);
    
    // Both per-district databases must exist
    if (tidesInfo.exists && currentsInfo.exists) {
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('[PREDICTIONS] Error checking if downloaded:', error);
    return false;
  }
}

/**
 * Clear predictions for a specific district (or all if no districtId).
 * Closes database connections, deletes files, and clears metadata.
 */
export async function clearPredictions(districtId?: string): Promise<void> {
  console.log(`Clearing predictions from memory and storage${districtId ? ` for ${districtId}` : ' (all)'}...`);
  cachedTidePredictions = {};
  cachedCurrentPredictions = {};
  predictionsLoaded = false;
  
  if (districtId) {
    // Close specific district's database connections
    const tideConn = tideDbMap.get(districtId);
    if (tideConn) {
      try { await tideConn.closeAsync(); } catch (e) {}
      tideDbMap.delete(districtId);
    }
    const currentConn = currentDbMap.get(districtId);
    if (currentConn) {
      try { await currentConn.closeAsync(); } catch (e) {}
      currentDbMap.delete(districtId);
    }
    
    // Delete this district's database files
    const dbPaths = [
      `${FileSystem.documentDirectory}tides_${districtId}.db`,
      `${FileSystem.documentDirectory}currents_${districtId}.db`,
    ];
    
    for (const dbPath of dbPaths) {
      try {
        const dbInfo = await FileSystem.getInfoAsync(dbPath);
        if (dbInfo.exists) {
          console.log('[PREDICTIONS] Deleting database file:', dbPath);
          await FileSystem.deleteAsync(dbPath);
        }
      } catch (error) {
        console.error('[PREDICTIONS] Error deleting database file:', dbPath, error);
      }
    }
    
    // Clear district-specific AsyncStorage metadata
    await AsyncStorage.multiRemove([
      `@XNautical:tidesDbPath:${districtId}`,
      `@XNautical:currentsDbPath:${districtId}`,
    ]);
  } else {
    // Close ALL database connections
    for (const [id, conn] of tideDbMap) {
      try { await conn.closeAsync(); } catch (e) {}
    }
    tideDbMap.clear();
    for (const [id, conn] of currentDbMap) {
      try { await conn.closeAsync(); } catch (e) {}
    }
    currentDbMap.clear();
    if (db) {
      try { await db.closeAsync(); } catch (e) {}
      db = null;
    }
    
    // Delete ALL prediction database files (per-district + legacy)
    const docDir = FileSystem.documentDirectory;
    if (docDir) {
      try {
        const files = await FileSystem.readDirectoryAsync(docDir);
        for (const file of files) {
          if (file.startsWith('tides_') && file.endsWith('.db') ||
              file.startsWith('currents_') && file.endsWith('.db') ||
              file === 'tides.db' || file === 'currents.db' || file === 'predictions.db') {
            const filePath = `${docDir}${file}`;
            console.log('[PREDICTIONS] Deleting database file:', filePath);
            await FileSystem.deleteAsync(filePath, { idempotent: true });
          }
        }
      } catch (error) {
        console.error('[PREDICTIONS] Error scanning/deleting database files:', error);
      }
    }
    
    // Clear ALL AsyncStorage metadata
    await AsyncStorage.multiRemove([
      STORAGE_KEY_TIDE_PREDICTIONS,
      STORAGE_KEY_CURRENT_PREDICTIONS,
      STORAGE_KEY_PREDICTIONS_TIMESTAMP,
      STORAGE_KEY_PREDICTIONS_STATS,
      '@XNautical:tidesDbPath',
      '@XNautical:currentsDbPath',
      '@XNautical:predictionsDbPath',
    ]);
  }
}

/**
 * Get tide predictions for a specific station and date
 */
export function getTidePredictionsForDate(stationId: string, date: string): TideEvent[] {
  return cachedTidePredictions[stationId]?.[date] || [];
}

/**
 * Get current predictions for a specific station and date
 */
export function getCurrentPredictionsForDate(stationId: string, date: string): CurrentEvent[] {
  return cachedCurrentPredictions[stationId]?.[date] || [];
}

// ============================================================================
// SQLITE DATABASE QUERIES (Per-District Tide and Current Databases)
// ============================================================================

// Per-district database connections: Map<districtId, SQLiteDatabase>
const tideDbMap: Map<string, SQLite.SQLiteDatabase> = new Map();
const currentDbMap: Map<string, SQLite.SQLiteDatabase> = new Map();

// Legacy combined database (for backward compatibility)
let db: SQLite.SQLiteDatabase | null = null;

// Mutex promises to prevent race conditions when opening databases
const tideDbPromiseMap: Map<string, Promise<SQLite.SQLiteDatabase>> = new Map();
const currentDbPromiseMap: Map<string, Promise<SQLite.SQLiteDatabase>> = new Map();

// Track if we've initialized (to detect hot reloads)
let isInitialized = false;

/**
 * Reset database connections (called on app startup/reload)
 * This prevents stale connection errors when hot reloading
 */
function resetDatabaseConnections() {
  console.log('[SQLITE] Resetting database connections...');
  tideDbMap.clear();
  currentDbMap.clear();
  db = null;
  tideDbPromiseMap.clear();
  currentDbPromiseMap.clear();
  isInitialized = true;
}

// Reset connections on module load (handles hot reload)
resetDatabaseConnections();

/**
 * One-time migration: rename legacy global tides.db / currents.db to per-district files.
 * This handles users who already have the old global files from the Alaska (17cgd) download.
 * Should be called once at app startup before any prediction queries.
 */
export async function migrateLegacyPredictionDatabases(): Promise<void> {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) return;
  
  try {
    const legacyTidesPath = `${docDir}tides.db`;
    const legacyCurrentsPath = `${docDir}currents.db`;
    const newTidesPath = `${docDir}tides_17cgd.db`;
    const newCurrentsPath = `${docDir}currents_17cgd.db`;
    
    const [legacyTidesInfo, legacyCurrentsInfo, newTidesInfo, newCurrentsInfo] = await Promise.all([
      FileSystem.getInfoAsync(legacyTidesPath),
      FileSystem.getInfoAsync(legacyCurrentsPath),
      FileSystem.getInfoAsync(newTidesPath),
      FileSystem.getInfoAsync(newCurrentsPath),
    ]);
    
    // Only migrate if legacy files exist and new per-district files don't
    if (legacyTidesInfo.exists && !newTidesInfo.exists) {
      console.log('[PREDICTIONS] Migrating legacy tides.db -> tides_17cgd.db');
      await FileSystem.moveAsync({ from: legacyTidesPath, to: newTidesPath });
    }
    
    if (legacyCurrentsInfo.exists && !newCurrentsInfo.exists) {
      console.log('[PREDICTIONS] Migrating legacy currents.db -> currents_17cgd.db');
      await FileSystem.moveAsync({ from: legacyCurrentsPath, to: newCurrentsPath });
    }
    
    // Also clean up legacy combined database
    const legacyPredictionsPath = `${docDir}predictions.db`;
    const legacyPredInfo = await FileSystem.getInfoAsync(legacyPredictionsPath);
    if (legacyPredInfo.exists) {
      console.log('[PREDICTIONS] Removing legacy predictions.db');
      await FileSystem.deleteAsync(legacyPredictionsPath, { idempotent: true });
    }
    
    // Migrate AsyncStorage keys
    const [oldTidesDbPath, oldCurrentsDbPath] = await Promise.all([
      AsyncStorage.getItem('@XNautical:tidesDbPath'),
      AsyncStorage.getItem('@XNautical:currentsDbPath'),
    ]);
    
    if (oldTidesDbPath || oldCurrentsDbPath) {
      console.log('[PREDICTIONS] Migrating legacy AsyncStorage keys to per-district format');
      const updates: [string, string][] = [];
      if (oldTidesDbPath) {
        updates.push([`@XNautical:tidesDbPath:17cgd`, newTidesPath]);
      }
      if (oldCurrentsDbPath) {
        updates.push([`@XNautical:currentsDbPath:17cgd`, newCurrentsPath]);
      }
      await AsyncStorage.multiSet(updates);
      await AsyncStorage.multiRemove(['@XNautical:tidesDbPath', '@XNautical:currentsDbPath']);
    }
    
    console.log('[PREDICTIONS] Legacy migration check complete');
  } catch (error) {
    console.error('[PREDICTIONS] Error during legacy migration:', error);
  }
}

/**
 * Open the TIDE predictions database for a specific district (with mutex)
 */
async function openTideDatabase(districtId: string): Promise<SQLite.SQLiteDatabase> {
  // Return existing connection if available
  const existing = tideDbMap.get(districtId);
  if (existing) return existing;
  
  // If another call is already opening this database, wait for it
  const pendingPromise = tideDbPromiseMap.get(districtId);
  if (pendingPromise) return pendingPromise;
  
  const dbPath = `${FileSystem.documentDirectory}tides_${districtId}.db`;
  
  // Create a promise that will be shared by all concurrent callers
  const promise = (async () => {
    console.log(`[SQLITE] Opening tide database for ${districtId}:`, dbPath);
    const newDb = await SQLite.openDatabaseAsync(dbPath);
    console.log(`[SQLITE] Tide database for ${districtId} opened successfully`);
    tideDbMap.set(districtId, newDb);
    return newDb;
  })();
  
  tideDbPromiseMap.set(districtId, promise);
  
  try {
    const result = await promise;
    return result;
  } finally {
    tideDbPromiseMap.delete(districtId);
  }
}

/**
 * Open the CURRENT predictions database for a specific district (with mutex)
 */
async function openCurrentDatabase(districtId: string): Promise<SQLite.SQLiteDatabase> {
  // Return existing connection if available
  const existing = currentDbMap.get(districtId);
  if (existing) return existing;
  
  // If another call is already opening this database, wait for it
  const pendingPromise = currentDbPromiseMap.get(districtId);
  if (pendingPromise) return pendingPromise;
  
  const dbPath = `${FileSystem.documentDirectory}currents_${districtId}.db`;
  
  // Create a promise that will be shared by all concurrent callers
  const promise = (async () => {
    console.log(`[SQLITE] Opening current database for ${districtId}:`, dbPath);
    const newDb = await SQLite.openDatabaseAsync(dbPath);
    console.log(`[SQLITE] Current database for ${districtId} opened successfully`);
    currentDbMap.set(districtId, newDb);
    return newDb;
  })();
  
  currentDbPromiseMap.set(districtId, promise);
  
  try {
    const result = await promise;
    return result;
  } finally {
    currentDbPromiseMap.delete(districtId);
  }
}

/**
 * Find all installed prediction database district IDs by scanning the filesystem.
 * Looks for files matching tides_{districtId}.db pattern.
 */
async function findInstalledPredictionDistricts(): Promise<string[]> {
  try {
    const docDir = FileSystem.documentDirectory;
    if (!docDir) return [];
    
    const files = await FileSystem.readDirectoryAsync(docDir);
    const districtIds: string[] = [];
    
    for (const file of files) {
      const match = file.match(/^tides_(.+)\.db$/);
      if (match) {
        districtIds.push(match[1]);
      }
    }
    
    return districtIds;
  } catch (error) {
    console.error('[SQLITE] Error scanning for prediction databases:', error);
    return [];
  }
}

/**
 * Open a tide database by trying all installed districts until we find the station.
 * Returns the database and districtId, or null if not found.
 */
async function findTideDatabaseForStation(stationId: string): Promise<{ db: SQLite.SQLiteDatabase; districtId: string } | null> {
  const districts = await findInstalledPredictionDistricts();
  
  for (const districtId of districts) {
    try {
      const database = await openTideDatabase(districtId);
      const station = await database.getFirstAsync(
        'SELECT id FROM stations WHERE id = ?',
        [stationId]
      );
      if (station) {
        return { db: database, districtId };
      }
    } catch (error) {
      // Database might not have stations table or other issue - skip
      continue;
    }
  }
  
  return null;
}

/**
 * Open a current database by trying all installed districts until we find the station.
 * Returns the database and districtId, or null if not found.
 */
async function findCurrentDatabaseForStation(stationId: string): Promise<{ db: SQLite.SQLiteDatabase; districtId: string } | null> {
  const districts = await findInstalledPredictionDistricts();
  
  for (const districtId of districts) {
    try {
      const database = await openCurrentDatabase(districtId);
      const station = await database.getFirstAsync(
        'SELECT id FROM stations WHERE id = ?',
        [stationId]
      );
      if (station) {
        return { db: database, districtId };
      }
    } catch (error) {
      // Database might not have stations table or other issue - skip
      continue;
    }
  }
  
  return null;
}

/**
 * Open the legacy combined SQLite database (backward compatibility)
 */
async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  
  // Use the full path to the extracted database file
  const dbPath = `${FileSystem.documentDirectory}predictions.db`;
  
  console.log('[SQLITE] Opening database:', dbPath);
  db = await SQLite.openDatabaseAsync(dbPath);
  console.log('[SQLITE] Database opened successfully');
  
  return db;
}

/**
 * Calculate distance between two points using Haversine formula
 * Returns distance in kilometers
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Find the nearest tide station to a given location
 * Returns station info with distance
 */
export function findNearestTideStation(
  lat: number, 
  lng: number, 
  stations: TideStation[]
): { station: TideStation; distance: number } | null {
  if (!stations || stations.length === 0) return null;
  
  let nearest: TideStation | null = null;
  let minDistance = Infinity;
  
  for (const station of stations) {
    if (station.lat && station.lng) {
      const distance = haversineDistance(lat, lng, station.lat, station.lng);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = station;
      }
    }
  }
  
  return nearest ? { station: nearest, distance: minDistance } : null;
}

/**
 * Find the nearest current station to a given location
 * Returns station info with distance
 */
export function findNearestCurrentStation(
  lat: number, 
  lng: number, 
  stations: CurrentStation[]
): { station: CurrentStation; distance: number } | null {
  if (!stations || stations.length === 0) return null;
  
  let nearest: CurrentStation | null = null;
  let minDistance = Infinity;
  
  for (const station of stations) {
    if (station.lat && station.lng) {
      const distance = haversineDistance(lat, lng, station.lat, station.lng);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = station;
      }
    }
  }
  
  return nearest ? { station: nearest, distance: minDistance } : null;
}

/**
 * Get predictions for a station for a specific date range (for chart rendering)
 * Returns array of predictions sorted by date/time
 */
export async function getStationPredictionsForRange(
  stationId: string, 
  stationType: 'tide' | 'current',
  startDate: Date,
  endDate: Date
): Promise<any[]> {
  try {
    // Find which district's database contains this station
    const result = stationType === 'tide'
      ? await findTideDatabaseForStation(stationId)
      : await findCurrentDatabaseForStation(stationId);
    
    if (!result) {
      // Station not found in any installed database - return empty silently
      return [];
    }
    
    const { db: database } = result;
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    const tableName = stationType === 'tide' ? 'tide_predictions' : 'current_predictions';
    
    return await database.getAllAsync(
      `SELECT * FROM ${tableName} 
       WHERE station_id = ? AND date >= ? AND date <= ? 
       ORDER BY date, time`,
      [stationId, startDateStr, endDateStr]
    );
  } catch (error: any) {
    // Check if this is a "shared object released" error (stale connection after hot reload)
    if (error?.message?.includes('shared object') || 
        error?.message?.includes('already released') ||
        error?.message?.includes('Cannot convert provided JavaScriptObject')) {
      console.warn('[PREDICTIONS] Detected stale connection, resetting and retrying...');
      
      // Reset all connections for this type
      if (stationType === 'tide') {
        tideDbMap.clear();
        tideDbPromiseMap.clear();
      } else {
        currentDbMap.clear();
        currentDbPromiseMap.clear();
      }
      
      // Retry once with fresh connections
      try {
        const result = stationType === 'tide'
          ? await findTideDatabaseForStation(stationId)
          : await findCurrentDatabaseForStation(stationId);
        
        if (!result) return [];
        
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];
        const tableName = stationType === 'tide' ? 'tide_predictions' : 'current_predictions';
        
        return await result.db.getAllAsync(
          `SELECT * FROM ${tableName} 
           WHERE station_id = ? AND date >= ? AND date <= ? 
           ORDER BY date, time`,
          [stationId, startDateStr, endDateStr]
        );
      } catch (retryError) {
        console.error(`[PREDICTIONS] Retry failed:`, retryError);
        return [];
      }
    }
    
    console.error(`[PREDICTIONS] Error getting predictions for range:`, error);
    return [];
  }
}

/**
 * Get station info and predictions for today
 */
export async function getStationPredictions(stationId: string, stationType: 'tide' | 'current') {
  try {
    // Find which district's database contains this station
    const result = stationType === 'tide'
      ? await findTideDatabaseForStation(stationId)
      : await findCurrentDatabaseForStation(stationId);
    
    if (!result) {
      // Station not found in any installed database - return null silently
      return null;
    }
    
    const database = result.db;
    
    // Get station info (stations table exists in both split databases)
    const station = await database.getFirstAsync(
      'SELECT * FROM stations WHERE id = ?',
      [stationId]
    );
    
    if (!station) {
      throw new Error(`Station ${stationId} not found`);
    }
    
    // Get today's date
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    
    let predictions = [];
    
    if (stationType === 'tide') {
      // Query tide predictions for today
      predictions = await database.getAllAsync(
        'SELECT * FROM tide_predictions WHERE station_id = ? AND date = ? ORDER BY time',
        [stationId, dateStr]
      );
    } else {
      // Query current predictions for today
      predictions = await database.getAllAsync(
        'SELECT * FROM current_predictions WHERE station_id = ? AND date = ? ORDER BY time',
        [stationId, dateStr]
      );
    }
    
    console.log(`[SQLITE] Found ${predictions.length} predictions for ${(station as any).name} on ${dateStr}`);
    
    return {
      station,
      predictions,
      date: dateStr,
    };
  } catch (error: any) {
    // Check if this is a "shared object released" error (stale connection after hot reload)
    if (error?.message?.includes('shared object') || 
        error?.message?.includes('already released') ||
        error?.message?.includes('Cannot convert provided JavaScriptObject')) {
      console.warn('[SQLITE] Detected stale connection, resetting and retrying...');
      
      // Reset connections for this type
      if (stationType === 'tide') {
        tideDbMap.clear();
        tideDbPromiseMap.clear();
      } else {
        currentDbMap.clear();
        currentDbPromiseMap.clear();
      }
      
      // Retry once with fresh connections
      try {
        const retryResult = stationType === 'tide'
          ? await findTideDatabaseForStation(stationId)
          : await findCurrentDatabaseForStation(stationId);
        
        if (!retryResult) {
          throw new Error(`Station ${stationId} not found in any database`);
        }
        
        const station = await retryResult.db.getFirstAsync(
          'SELECT * FROM stations WHERE id = ?',
          [stationId]
        );
        
        if (!station) {
          throw new Error(`Station ${stationId} not found`);
        }
        
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];
        const tableName = stationType === 'tide' ? 'tide_predictions' : 'current_predictions';
        
        const predictions = await retryResult.db.getAllAsync(
          `SELECT * FROM ${tableName} WHERE station_id = ? AND date = ? ORDER BY time`,
          [stationId, dateStr]
        );
        
        return {
          station,
          predictions,
          date: dateStr,
        };
      } catch (retryError) {
        console.error('[SQLITE] Retry failed:', retryError);
        throw retryError;
      }
    }
    
    console.error('[SQLITE] Error querying station:', error);
    throw error;
  }
}

/**
 * Get accurate stats from the SQLite prediction databases
 */
export interface PredictionDatabaseStats {
  tideStations: number;
  currentStations: number;
  tideDateRange: { start: string; end: string } | null;
  currentDateRange: { start: string; end: string } | null;
  totalTidePredictions: number;
  totalCurrentPredictions: number;
  tidesDbSizeMB: number;
  currentsDbSizeMB: number;
}

export async function getPredictionDatabaseStats(districtId?: string): Promise<PredictionDatabaseStats | null> {
  try {
    // If a specific district is provided, check just that one
    // Otherwise, aggregate across all installed prediction districts
    const districtIds = districtId 
      ? [districtId] 
      : await findInstalledPredictionDistricts();
    
    if (districtIds.length === 0) return null;
    
    const stats: PredictionDatabaseStats = {
      tideStations: 0,
      currentStations: 0,
      tideDateRange: null,
      currentDateRange: null,
      totalTidePredictions: 0,
      totalCurrentPredictions: 0,
      tidesDbSizeMB: 0,
      currentsDbSizeMB: 0,
    };
    
    for (const dId of districtIds) {
      const tidesDbPath = `${FileSystem.documentDirectory}tides_${dId}.db`;
      const currentsDbPath = `${FileSystem.documentDirectory}currents_${dId}.db`;
      
      const [tidesInfo, currentsInfo] = await Promise.all([
        FileSystem.getInfoAsync(tidesDbPath),
        FileSystem.getInfoAsync(currentsDbPath),
      ]);
      
      // Query tide database
      if (tidesInfo.exists) {
        stats.tidesDbSizeMB += ('size' in tidesInfo ? tidesInfo.size / (1024 * 1024) : 0);
        try {
          const freshTideDb = tideDbMap.get(dId) || await openTideDatabase(dId);
          
          const tideTableCheck = await freshTideDb.getFirstAsync<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='tide_predictions'"
          );
          if (!tideTableCheck) {
            console.warn(`[STATS] tide_predictions table not found in tides_${dId}.db`);
            continue;
          }
          
          const tideStationCount = await freshTideDb.getFirstAsync<{ count: number }>(
            'SELECT COUNT(*) as count FROM stations'
          );
          stats.tideStations += tideStationCount?.count || 0;
          
          const tideDateRange = await freshTideDb.getFirstAsync<{ min_date: string; max_date: string }>(
            'SELECT MIN(date) as min_date, MAX(date) as max_date FROM tide_predictions'
          );
          if (tideDateRange?.min_date && tideDateRange?.max_date) {
            if (!stats.tideDateRange) {
              stats.tideDateRange = { start: tideDateRange.min_date, end: tideDateRange.max_date };
            } else {
              if (tideDateRange.min_date < stats.tideDateRange.start) stats.tideDateRange.start = tideDateRange.min_date;
              if (tideDateRange.max_date > stats.tideDateRange.end) stats.tideDateRange.end = tideDateRange.max_date;
            }
          }
          
          const tidePredictionCount = await freshTideDb.getFirstAsync<{ count: number }>(
            'SELECT COUNT(*) as count FROM tide_predictions'
          );
          stats.totalTidePredictions += tidePredictionCount?.count || 0;
        } catch (error) {
          console.error(`[STATS] Error querying tide database for ${dId}:`, error);
        }
      }
      
      // Query currents database
      if (currentsInfo.exists) {
        stats.currentsDbSizeMB += ('size' in currentsInfo ? currentsInfo.size / (1024 * 1024) : 0);
        try {
          const freshCurrentDb = currentDbMap.get(dId) || await openCurrentDatabase(dId);
          
          const currentTableCheck = await freshCurrentDb.getFirstAsync<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='current_predictions'"
          );
          if (!currentTableCheck) {
            console.warn(`[STATS] current_predictions table not found in currents_${dId}.db`);
            continue;
          }
          
          const currentStationCount = await freshCurrentDb.getFirstAsync<{ count: number }>(
            'SELECT COUNT(*) as count FROM stations'
          );
          stats.currentStations += currentStationCount?.count || 0;
          
          const currentDateRange = await freshCurrentDb.getFirstAsync<{ min_date: string; max_date: string }>(
            'SELECT MIN(date) as min_date, MAX(date) as max_date FROM current_predictions'
          );
          if (currentDateRange?.min_date && currentDateRange?.max_date) {
            if (!stats.currentDateRange) {
              stats.currentDateRange = { start: currentDateRange.min_date, end: currentDateRange.max_date };
            } else {
              if (currentDateRange.min_date < stats.currentDateRange.start) stats.currentDateRange.start = currentDateRange.min_date;
              if (currentDateRange.max_date > stats.currentDateRange.end) stats.currentDateRange.end = currentDateRange.max_date;
            }
          }
          
          const currentPredictionCount = await freshCurrentDb.getFirstAsync<{ count: number }>(
            'SELECT COUNT(*) as count FROM current_predictions'
          );
          stats.totalCurrentPredictions += currentPredictionCount?.count || 0;
        } catch (error) {
          console.error(`[STATS] Error querying currents database for ${dId}:`, error);
        }
      }
    }
    
    return (stats.tideStations > 0 || stats.currentStations > 0) ? stats : null;
  } catch (error) {
    console.error('[STATS] Error getting database stats:', error);
    return null;
  }
}

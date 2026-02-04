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
 */
async function loadFromStorage(): Promise<void> {
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
  onProgress?: (message: string, percent: number) => void
): Promise<{ success: boolean; error?: string; stats?: any }> {
  try {
    console.log('[PREDICTIONS] ========================================');
    console.log('[PREDICTIONS] Starting parallel database downloads...');
    console.log('[PREDICTIONS] ========================================');
    
    const startTime = Date.now();
    let tidesProgress = 0;
    let currentsProgress = 0;
    
    const updateProgress = () => {
      const combinedProgress = Math.round((tidesProgress + currentsProgress) / 2);
      const uiPercent = 10 + Math.round(combinedProgress * 0.8); // 10-90%
      onProgress?.(`Downloading... Tides: ${tidesProgress}%, Currents: ${currentsProgress}%`, uiPercent);
    };
    
    onProgress?.('Downloading prediction databases...', 10);
    
    // Download both databases in parallel
    console.log('[PREDICTIONS] Starting parallel downloads: tides.db.zip and currents.db.zip');
    
    const [tidesResult, currentsResult] = await Promise.all([
      downloadAndExtractDatabase(
        'predictions/tides.db.zip',
        'tides.db',
        (p) => { tidesProgress = p; updateProgress(); }
      ),
      downloadAndExtractDatabase(
        'predictions/currents.db.zip',
        'currents.db',
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
    
    console.log('[PREDICTIONS] ✅ Both downloads complete!');
    console.log(`[PREDICTIONS] Tides database size: ${(tidesResult.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`[PREDICTIONS] Currents database size: ${(currentsResult.size / 1024 / 1024).toFixed(2)} MB`);
    
    onProgress?.('Saving metadata...', 95);
    
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
      ['@XNautical:tidesDbPath', `${FileSystem.documentDirectory}tides.db`],
      ['@XNautical:currentsDbPath', `${FileSystem.documentDirectory}currents.db`],
    ]);
    
    predictionsLoaded = true;
    
    const totalTime = Date.now() - startTime;
    console.log('[PREDICTIONS] ========================================');
    console.log('[PREDICTIONS] 🎉 DOWNLOAD COMPLETE!');
    console.log('[PREDICTIONS] ========================================');
    console.log(`[PREDICTIONS] Total time: ${(totalTime/1000).toFixed(1)}s`);
    console.log(`[PREDICTIONS] Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
    console.log('[PREDICTIONS] Ready to query with expo-sqlite!');
    console.log('[PREDICTIONS] ========================================');
    
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
      console.log('[PREDICTIONS] Database exists but metadata missing, using file info');
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
 * Check if predictions are downloaded
 */
export async function arePredictionsDownloaded(): Promise<boolean> {
  try {
    console.log('[PREDICTIONS] Checking if predictions are downloaded...');
    
    // Check for new split databases (tides.db and currents.db)
    const tidesDbPath = `${FileSystem.documentDirectory}tides.db`;
    const currentsDbPath = `${FileSystem.documentDirectory}currents.db`;
    
    const [tidesInfo, currentsInfo] = await Promise.all([
      FileSystem.getInfoAsync(tidesDbPath),
      FileSystem.getInfoAsync(currentsDbPath),
    ]);
    
    // If both new databases exist, we're good
    if (tidesInfo.exists && currentsInfo.exists) {
      console.log('[PREDICTIONS] ✅ Both split databases exist');
      console.log(`[PREDICTIONS] Tides: ${((tidesInfo.size || 0) / 1024 / 1024).toFixed(2)} MB`);
      console.log(`[PREDICTIONS] Currents: ${((currentsInfo.size || 0) / 1024 / 1024).toFixed(2)} MB`);
      return true;
    }
    
    // Fallback: check for legacy combined database
    const legacyDbPath = `${FileSystem.documentDirectory}predictions.db`;
    const legacyInfo = await FileSystem.getInfoAsync(legacyDbPath);
    
    if (legacyInfo.exists) {
      console.log('[PREDICTIONS] ⚠️ Legacy combined database exists (needs re-download for split format)');
      console.log(`[PREDICTIONS] Legacy size: ${((legacyInfo.size || 0) / 1024 / 1024).toFixed(2)} MB`);
      // Return false to trigger re-download with new split format
      return false;
    }
    
    console.log('[PREDICTIONS] No database files found');
    return false;
  } catch (error) {
    console.error('[PREDICTIONS] Error checking if downloaded:', error);
    return false;
  }
}

/**
 * Clear predictions from storage
 */
export async function clearPredictions(): Promise<void> {
  console.log('Clearing predictions from memory and storage...');
  cachedTidePredictions = {};
  cachedCurrentPredictions = {};
  predictionsLoaded = false;
  
  // Close any open database connections
  if (tideDb) {
    try { await tideDb.closeAsync(); } catch (e) {}
    tideDb = null;
  }
  if (currentDb) {
    try { await currentDb.closeAsync(); } catch (e) {}
    currentDb = null;
  }
  if (db) {
    try { await db.closeAsync(); } catch (e) {}
    db = null;
  }
  
  // Delete all database files (split and legacy)
  const dbPaths = [
    `${FileSystem.documentDirectory}tides.db`,
    `${FileSystem.documentDirectory}currents.db`,
    `${FileSystem.documentDirectory}predictions.db`, // Legacy
  ];
  
  for (const dbPath of dbPaths) {
    try {
      const dbInfo = await FileSystem.getInfoAsync(dbPath);
      if (dbInfo.exists) {
        console.log('[PREDICTIONS] Deleting database file:', dbPath);
        await FileSystem.deleteAsync(dbPath);
        console.log('[PREDICTIONS] Database file deleted');
      }
    } catch (error) {
      console.error('[PREDICTIONS] Error deleting database file:', dbPath, error);
    }
  }
  
  // Clear AsyncStorage metadata
  await AsyncStorage.multiRemove([
    STORAGE_KEY_TIDE_PREDICTIONS,
    STORAGE_KEY_CURRENT_PREDICTIONS,
    STORAGE_KEY_PREDICTIONS_TIMESTAMP,
    STORAGE_KEY_PREDICTIONS_STATS,
    '@XNautical:tidesDbPath',
    '@XNautical:currentsDbPath',
    '@XNautical:predictionsDbPath',
  ]);
  
  console.log('[PREDICTIONS] Predictions cleared successfully');
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
// SQLITE DATABASE QUERIES (Separate Tide and Current Databases)
// ============================================================================

let tideDb: SQLite.SQLiteDatabase | null = null;
let currentDb: SQLite.SQLiteDatabase | null = null;
// Legacy combined database (for backward compatibility)
let db: SQLite.SQLiteDatabase | null = null;

// Mutex promises to prevent race conditions when opening databases
let tideDbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let currentDbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Open the TIDE predictions database (with mutex to prevent race conditions)
 */
async function openTideDatabase(): Promise<SQLite.SQLiteDatabase> {
  // Return existing connection if available
  if (tideDb) return tideDb;
  
  // If another call is already opening the database, wait for it
  if (tideDbPromise) return tideDbPromise;
  
  const dbPath = `${FileSystem.documentDirectory}tides.db`;
  
  // Create a promise that will be shared by all concurrent callers
  tideDbPromise = (async () => {
    console.log('[SQLITE] Opening tide database:', dbPath);
    const newDb = await SQLite.openDatabaseAsync(dbPath);
    console.log('[SQLITE] Tide database opened successfully');
    tideDb = newDb;
    return newDb;
  })();
  
  try {
    const result = await tideDbPromise;
    return result;
  } finally {
    tideDbPromise = null;
  }
}

/**
 * Open the CURRENT predictions database (with mutex to prevent race conditions)
 */
async function openCurrentDatabase(): Promise<SQLite.SQLiteDatabase> {
  // Return existing connection if available
  if (currentDb) return currentDb;
  
  // If another call is already opening the database, wait for it
  if (currentDbPromise) return currentDbPromise;
  
  const dbPath = `${FileSystem.documentDirectory}currents.db`;
  
  // Create a promise that will be shared by all concurrent callers
  currentDbPromise = (async () => {
    console.log('[SQLITE] Opening current database:', dbPath);
    const newDb = await SQLite.openDatabaseAsync(dbPath);
    console.log('[SQLITE] Current database opened successfully');
    currentDb = newDb;
    return newDb;
  })();
  
  try {
    const result = await currentDbPromise;
    return result;
  } finally {
    currentDbPromise = null;
  }
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
    // Check if the database file exists before trying to open it
    const dbPath = stationType === 'tide' 
      ? `${FileSystem.documentDirectory}tides.db`
      : `${FileSystem.documentDirectory}currents.db`;
    
    const dbInfo = await FileSystem.getInfoAsync(dbPath);
    if (!dbInfo.exists) {
      // Database not downloaded yet - return empty array silently
      return [];
    }
    
    // Use the appropriate database based on station type
    const database = stationType === 'tide' 
      ? await openTideDatabase() 
      : await openCurrentDatabase();
    
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    let predictions: any[] = [];
    
    if (stationType === 'tide') {
      predictions = await database.getAllAsync(
        `SELECT * FROM tide_predictions 
         WHERE station_id = ? AND date >= ? AND date <= ? 
         ORDER BY date, time`,
        [stationId, startDateStr, endDateStr]
      );
    } else {
      predictions = await database.getAllAsync(
        `SELECT * FROM current_predictions 
         WHERE station_id = ? AND date >= ? AND date <= ? 
         ORDER BY date, time`,
        [stationId, startDateStr, endDateStr]
      );
    }
    
    return predictions;
  } catch (error) {
    console.error(`[PREDICTIONS] Error getting predictions for range:`, error);
    return [];
  }
}

/**
 * Get station info and predictions for today
 */
export async function getStationPredictions(stationId: string, stationType: 'tide' | 'current') {
  try {
    // Check if the database file exists before trying to open it
    const dbPath = stationType === 'tide' 
      ? `${FileSystem.documentDirectory}tides.db`
      : `${FileSystem.documentDirectory}currents.db`;
    
    const dbInfo = await FileSystem.getInfoAsync(dbPath);
    if (!dbInfo.exists) {
      // Database not downloaded yet - return null silently
      return null;
    }
    
    // Use the appropriate database based on station type
    const database = stationType === 'tide' 
      ? await openTideDatabase() 
      : await openCurrentDatabase();
    
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

export async function getPredictionDatabaseStats(): Promise<PredictionDatabaseStats | null> {
  try {
    const tidesDbPath = `${FileSystem.documentDirectory}tides.db`;
    const currentsDbPath = `${FileSystem.documentDirectory}currents.db`;
    
    // Check if databases exist
    const [tidesInfo, currentsInfo] = await Promise.all([
      FileSystem.getInfoAsync(tidesDbPath),
      FileSystem.getInfoAsync(currentsDbPath),
    ]);
    
    if (!tidesInfo.exists && !currentsInfo.exists) {
      return null;
    }
    
    const stats: PredictionDatabaseStats = {
      tideStations: 0,
      currentStations: 0,
      tideDateRange: null,
      currentDateRange: null,
      totalTidePredictions: 0,
      totalCurrentPredictions: 0,
      tidesDbSizeMB: tidesInfo.exists && 'size' in tidesInfo ? tidesInfo.size / (1024 * 1024) : 0,
      currentsDbSizeMB: currentsInfo.exists && 'size' in currentsInfo ? currentsInfo.size / (1024 * 1024) : 0,
    };
    
    // Query tide database - open fresh connection to avoid stale cache
    if (tidesInfo.exists) {
      let freshTideDb: SQLite.SQLiteDatabase | null = null;
      try {
        console.log('[STATS] Opening fresh tide database connection...');
        // Reset cached connection and promise if they exist
        if (tideDb) {
          try { await tideDb.closeAsync(); } catch (e) { /* ignore */ }
          tideDb = null;
        }
        tideDbPromise = null;
        freshTideDb = await SQLite.openDatabaseAsync(tidesDbPath);
        tideDb = freshTideDb; // Update cache
        
        // Verify table exists
        const tideTableCheck = await freshTideDb.getFirstAsync<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='tide_predictions'"
        );
        if (!tideTableCheck) {
          console.warn('[STATS] tide_predictions table not found in tides.db');
          throw new Error('tide_predictions table not found');
        }
        
        // Count unique stations with predictions
        const tideStationCount = await freshTideDb.getFirstAsync<{ count: number }>(
          'SELECT COUNT(DISTINCT station_id) as count FROM tide_predictions'
        );
        stats.tideStations = tideStationCount?.count || 0;
        
        // Get date range
        const tideDateRange = await freshTideDb.getFirstAsync<{ min_date: string; max_date: string }>(
          'SELECT MIN(date) as min_date, MAX(date) as max_date FROM tide_predictions'
        );
        if (tideDateRange?.min_date && tideDateRange?.max_date) {
          stats.tideDateRange = { start: tideDateRange.min_date, end: tideDateRange.max_date };
        }
        
        // Count total predictions
        const tidePredictionCount = await freshTideDb.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) as count FROM tide_predictions'
        );
        stats.totalTidePredictions = tidePredictionCount?.count || 0;
        
        console.log('[STATS] Tide database stats retrieved successfully');
      } catch (error) {
        console.error('[STATS] Error querying tide database:', error);
        // Reset connection on error
        if (freshTideDb) {
          try { await freshTideDb.closeAsync(); } catch (e) { /* ignore */ }
        }
        tideDb = null;
        tideDbPromise = null;
      }
    }
    
    // Query currents database - open fresh connection to avoid stale cache
    if (currentsInfo.exists) {
      let freshCurrentDb: SQLite.SQLiteDatabase | null = null;
      try {
        console.log('[STATS] Opening fresh currents database connection...');
        // Reset cached connection and promise if they exist
        if (currentDb) {
          try { await currentDb.closeAsync(); } catch (e) { /* ignore */ }
          currentDb = null;
        }
        currentDbPromise = null;
        freshCurrentDb = await SQLite.openDatabaseAsync(currentsDbPath);
        currentDb = freshCurrentDb; // Update cache
        
        // Verify table exists
        const currentTableCheck = await freshCurrentDb.getFirstAsync<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='current_predictions'"
        );
        if (!currentTableCheck) {
          console.warn('[STATS] current_predictions table not found in currents.db');
          throw new Error('current_predictions table not found');
        }
        
        // Count unique stations with predictions
        const currentStationCount = await freshCurrentDb.getFirstAsync<{ count: number }>(
          'SELECT COUNT(DISTINCT station_id) as count FROM current_predictions'
        );
        stats.currentStations = currentStationCount?.count || 0;
        
        // Get date range
        const currentDateRange = await freshCurrentDb.getFirstAsync<{ min_date: string; max_date: string }>(
          'SELECT MIN(date) as min_date, MAX(date) as max_date FROM current_predictions'
        );
        if (currentDateRange?.min_date && currentDateRange?.max_date) {
          stats.currentDateRange = { start: currentDateRange.min_date, end: currentDateRange.max_date };
        }
        
        // Count total predictions
        const currentPredictionCount = await freshCurrentDb.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) as count FROM current_predictions'
        );
        stats.totalCurrentPredictions = currentPredictionCount?.count || 0;
        
        console.log('[STATS] Currents database stats retrieved successfully');
      } catch (error) {
        console.error('[STATS] Error querying currents database:', error);
        // Reset connection on error
        if (freshCurrentDb) {
          try { await freshCurrentDb.closeAsync(); } catch (e) { /* ignore */ }
        }
        currentDb = null;
        currentDbPromise = null;
      }
    }
    
    console.log('[STATS] Database stats:', stats);
    return stats;
  } catch (error) {
    console.error('[STATS] Error getting database stats:', error);
    return null;
  }
}

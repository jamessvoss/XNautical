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
      
      console.log(`Cached ${cachedTideStations.length} tide stations and ${cachedCurrentStations.length} current stations in memory`);
      
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
 * Download ALL tide and current predictions for ALL stations
 * This is a one-time bulk download (~300MB) for offline access
 */
/**
 * Download predictions SQLite database from Cloud Storage
 * Downloads compressed .db.gz file, decompresses to .db on disk
 * Ready for immediate querying with expo-sqlite
 */
export async function downloadAllPredictions(
  onProgress?: (message: string, percent: number) => void
): Promise<{ success: boolean; error?: string; stats?: any }> {
  try {
    console.log('[PREDICTIONS] ========================================');
    console.log('[PREDICTIONS] Starting SQLite database download...');
    console.log('[PREDICTIONS] ========================================');
    onProgress?.('Downloading predictions database...', 10);
    
    const startTime = Date.now();
    let downloadTime = 0;
    let extractTime = 0;
    let dbPath = '';
    let dbInfo: any = null;
    
    // Use Firebase Storage SDK to get download URL with proper auth/headers
    const { storage } = await import('../config/firebase');
    const { ref, getDownloadURL } = await import('firebase/storage');
    
    console.log('[PREDICTIONS] Getting download URL from Firebase Storage...');
    const storageRef = ref(storage, 'predictions/predictions.db.zip');
    const downloadUrl = await getDownloadURL(storageRef);
    console.log('[PREDICTIONS] Got signed URL');
    
    // Download to cache directory using expo-file-system
    const compressedPath = `${FileSystem.cacheDirectory}predictions.db.zip`;
    console.log('[PREDICTIONS] Download path:', compressedPath);
    console.log('[PREDICTIONS] Starting download...');
    
    const downloadStartTime = Date.now();
    
    try {
      const downloadResumable = FileSystem.createDownloadResumable(
        downloadUrl,
        compressedPath,
        {},
        (downloadProgress) => {
          const { totalBytesWritten, totalBytesExpectedToWrite } = downloadProgress;
          if (totalBytesExpectedToWrite > 0) {
            const percent = Math.round((totalBytesWritten / totalBytesExpectedToWrite) * 100);
            const downloadedMB = (totalBytesWritten / 1024 / 1024).toFixed(1);
            const totalMB = (totalBytesExpectedToWrite / 1024 / 1024).toFixed(1);
            
            // Log every 10%
            if (percent % 10 === 0) {
              console.log(`[PREDICTIONS] Download progress: ${percent}% (${downloadedMB} MB / ${totalMB} MB)`);
            }
            
            const uiPercent = 10 + Math.round((totalBytesWritten / totalBytesExpectedToWrite) * 40);
            onProgress?.(`Downloading... ${percent}%`, uiPercent);
          }
        }
      );
      
      const result = await downloadResumable.downloadAsync();
      
      if (!result) {
        throw new Error('Download failed - no result returned');
      }
      
      downloadTime = Date.now() - downloadStartTime;
      const fileInfo = await FileSystem.getInfoAsync(compressedPath);
      
      if (!fileInfo.exists) {
        throw new Error('Downloaded file does not exist');
      }
      
      console.log('[PREDICTIONS] ✅ Download complete!');
      console.log(`[PREDICTIONS] Compressed size: ${(fileInfo.size / 1024 / 1024).toFixed(2)} MB`);
      console.log(`[PREDICTIONS] Download time: ${downloadTime}ms (${(downloadTime/1000).toFixed(1)}s)`);
      
    } catch (error: any) {
      console.error('[PREDICTIONS] ❌ Download failed:', error);
      throw new Error(`Download failed: ${error.message || 'Unknown error'}`);
    }
    
    onProgress?.('Extracting database...', 60);
    
    // Extract zip to document directory using native code (NO JS MEMORY USAGE!)
    console.log('[PREDICTIONS] ----------------------------------------');
    console.log('[PREDICTIONS] Extracting database file (native code)...');
    const extractStartTime = Date.now();
    
    const targetDirectory = FileSystem.documentDirectory;
    console.log('[PREDICTIONS] Target directory:', targetDirectory);
    
    // This happens in Native C++/Java - Zero JavaScript memory usage!
    const extractedPath = await unzip(compressedPath, targetDirectory);
    console.log('[PREDICTIONS] ✅ Extracted to:', extractedPath);
    
    extractTime = Date.now() - extractStartTime;
    console.log(`[PREDICTIONS] ✅ Extraction completed in ${extractTime}ms (${(extractTime/1000).toFixed(1)}s)`);
    
    // Clean up compressed file
    await FileSystem.deleteAsync(compressedPath, { idempotent: true });
    console.log('[PREDICTIONS] ✅ Cleaned up zip file');
    
    // Verify the extracted database
    dbPath = `${FileSystem.documentDirectory}predictions.db`;
    dbInfo = await FileSystem.getInfoAsync(dbPath);
    
    if (!dbInfo.exists) {
      throw new Error('Extracted database file not found');
    }
    
    console.log('[PREDICTIONS] ✅ Database verified!');
    console.log(`[PREDICTIONS] Database size: ${(dbInfo.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`[PREDICTIONS] Database path: ${dbPath}`);
    
      onProgress?.('Saving metadata...', 95);
    
    // Save metadata
    console.log('[PREDICTIONS] ----------------------------------------');
    console.log('[PREDICTIONS] Saving metadata to AsyncStorage...');
    const stats = {
      tideStations: 576,
      tideEvents: 2352621,
      currentStations: 936,
      currentEvents: 994529,
      bundleVersion: '1.0',
      generated: new Date().toISOString(),
      databaseSize: dbInfo.size,
      databasePath: dbPath,
      format: 'sqlite',
    };
    
    await AsyncStorage.multiSet([
      [STORAGE_KEY_PREDICTIONS_TIMESTAMP, Date.now().toString()],
      [STORAGE_KEY_PREDICTIONS_STATS, JSON.stringify(stats)],
      ['@XNautical:predictionsDbPath', dbPath],
    ]);
    console.log('[PREDICTIONS] ✅ Metadata saved');
    
    predictionsLoaded = true;
    
    const totalTime = Date.now() - startTime;
    console.log('[PREDICTIONS] ========================================');
    console.log('[PREDICTIONS] 🎉 DOWNLOAD COMPLETE!');
    console.log('[PREDICTIONS] ========================================');
    console.log(`[PREDICTIONS] Total time: ${totalTime}ms (${(totalTime/1000).toFixed(1)}s)`);
    console.log(`[PREDICTIONS] Breakdown:`);
    console.log(`[PREDICTIONS]   - Download: ${downloadTime}ms (${(downloadTime/1000).toFixed(1)}s)`);
    console.log(`[PREDICTIONS]   - Extract: ${extractTime}ms (${(extractTime/1000).toFixed(1)}s)`);
    console.log(`[PREDICTIONS] Database location: ${dbPath}`);
    console.log(`[PREDICTIONS] Database size: ${(dbInfo.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`[PREDICTIONS] Ready to query with expo-sqlite!`);
    console.log('[PREDICTIONS] ========================================');
    onProgress?.('Download complete!', 100);
    
    // Save metadata to AsyncStorage for UI display
    const finalStats = {
      ...stats,
      totalSizeMB: dbInfo.size / 1024 / 1024,
      downloadTimeSec: Math.round(totalTime / 1000),
      downloadNetworkTimeSec: Math.round(downloadTime / 1000),
      extractTimeSec: Math.round(extractTime / 1000),
    };
    
    const timestamp = Date.now().toString();
    await AsyncStorage.multiSet([
      [STORAGE_KEY_PREDICTIONS_STATS, JSON.stringify(finalStats)],
      [STORAGE_KEY_PREDICTIONS_TIMESTAMP, timestamp],
    ]);
    console.log('[PREDICTIONS] Saved metadata to AsyncStorage');
    
    return {
      success: true,
      stats: finalStats,
    };
  } catch (error: any) {
    console.error('[PREDICTIONS] ========================================');
    console.error('[PREDICTIONS] ❌ ERROR OCCURRED!');
    console.error('[PREDICTIONS] ========================================');
    console.error('[PREDICTIONS] Error:', error.message);
    console.error('[PREDICTIONS] Full error details:', JSON.stringify(error, null, 2));
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
    // Check if the SQLite database file exists
    const dbPath = `${FileSystem.documentDirectory}predictions.db`;
    console.log('[PREDICTIONS] Database path:', dbPath);
    const dbInfo = await FileSystem.getInfoAsync(dbPath);
    console.log('[PREDICTIONS] Database info:', dbInfo);
    
    if (dbInfo.exists) {
      console.log('[PREDICTIONS] ✅ Database file exists:', dbPath);
      console.log('[PREDICTIONS] Database size:', (dbInfo.size / 1024 / 1024).toFixed(2), 'MB');
      return true;
    }
    
    console.log('[PREDICTIONS] Database file does not exist, checking AsyncStorage...');
    // Fallback: check timestamp in AsyncStorage
    const timestamp = await AsyncStorage.getItem(STORAGE_KEY_PREDICTIONS_TIMESTAMP);
    console.log('[PREDICTIONS] AsyncStorage timestamp:', timestamp);
    return !!timestamp;
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
  
  // Delete the SQLite database file
  try {
    const dbPath = `${FileSystem.documentDirectory}predictions.db`;
    const dbInfo = await FileSystem.getInfoAsync(dbPath);
    if (dbInfo.exists) {
      console.log('[PREDICTIONS] Deleting database file:', dbPath);
      await FileSystem.deleteAsync(dbPath);
      console.log('[PREDICTIONS] Database file deleted');
    }
  } catch (error) {
    console.error('[PREDICTIONS] Error deleting database file:', error);
  }
  
  // Clear AsyncStorage metadata
  await AsyncStorage.multiRemove([
    STORAGE_KEY_TIDE_PREDICTIONS,
    STORAGE_KEY_CURRENT_PREDICTIONS,
    STORAGE_KEY_PREDICTIONS_TIMESTAMP,
    STORAGE_KEY_PREDICTIONS_STATS,
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
// SQLITE DATABASE QUERIES
// ============================================================================

let db: SQLite.SQLiteDatabase | null = null;

/**
 * Open the SQLite database
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
 * Get station info and predictions for today
 */
export async function getStationPredictions(stationId: string, stationType: 'tide' | 'current') {
  try {
    const database = await openDatabase();
    
    // Get station info
    const station = await database.getFirstAsync(
      'SELECT * FROM stations WHERE id = ? AND type = ?',
      [stationId, stationType]
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
    
    console.log(`[SQLITE] Found ${predictions.length} predictions for ${station.name} on ${dateStr}`);
    
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

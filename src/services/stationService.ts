import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../config/firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Initialize Firebase Functions
const functions = getFunctions(app);

console.log('Using Cloud Function for station locations (single optimized call)');

const STORAGE_KEY_TIDE_STATIONS = '@XNautical:tideStations';
const STORAGE_KEY_CURRENT_STATIONS = '@XNautical:currentStations';
const STORAGE_KEY_STATIONS_TIMESTAMP = '@XNautical:stationsTimestamp';

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

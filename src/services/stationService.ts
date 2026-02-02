import { collection, getDocs } from 'firebase/firestore';
import { firestore } from '../config/firebase';
import { Platform } from 'react-native';

// Native Firestore SDK (React Native only)
let nativeFirestore: any = null;
if (Platform.OS !== 'web') {
  try {
    nativeFirestore = require('@react-native-firebase/firestore').default();
  } catch (e) {
    console.log('Native Firestore not available, using JS SDK');
  }
}

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

/**
 * Fetch all tidal stations with predictions from Firestore
 */
export async function fetchTideStations(): Promise<TideStation[]> {
  if (cachedTideStations) {
    return cachedTideStations;
  }

  try {
    const stations: TideStation[] = [];
    
    // Use native Firestore SDK on React Native for proper authentication
    if (nativeFirestore) {
      const querySnapshot = await nativeFirestore.collection('tidal-stations').get();
      
      querySnapshot.forEach((doc: any) => {
        const data = doc.data();
        stations.push({
          id: doc.id,
          name: data.name || 'Unknown',
          lat: data.lat || 0,
          lng: data.lng || 0,
          type: data.type || 'S',
          predictions: data.predictions || {}, // Include all predictions
        });
      });
    } else {
      // Fallback to JS SDK (web)
      const querySnapshot = await getDocs(collection(firestore, 'tidal-stations'));
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        stations.push({
          id: doc.id,
          name: data.name || 'Unknown',
          lat: data.lat || 0,
          lng: data.lng || 0,
          type: data.type || 'S',
          predictions: data.predictions || {}, // Include all predictions
        });
      });
    }
    
    cachedTideStations = stations;
    console.log(`Loaded ${stations.length} tide stations with predictions from Firestore`);
    
    // Log prediction data stats
    const stationsWithData = stations.filter(s => s.predictions && Object.keys(s.predictions).length > 0);
    console.log(`  - Stations with prediction data: ${stationsWithData.length}`);
    if (stationsWithData.length > 0) {
      const sampleStation = stationsWithData[0];
      const dateCount = Object.keys(sampleStation.predictions!).length;
      console.log(`  - Sample station has ${dateCount} days of predictions`);
    }
    
    return stations;
  } catch (error) {
    console.error('Error fetching tide stations:', error);
    return [];
  }
}

/**
 * Fetch all current stations with predictions from Firestore
 */
export async function fetchCurrentStations(): Promise<CurrentStation[]> {
  if (cachedCurrentStations) {
    return cachedCurrentStations;
  }

  try {
    const stations: CurrentStation[] = [];
    
    // Use native Firestore SDK on React Native for proper authentication
    if (nativeFirestore) {
      const querySnapshot = await nativeFirestore.collection('current-stations-packed').get();
      
      querySnapshot.forEach((doc: any) => {
        const data = doc.data();
        stations.push({
          id: doc.id,
          name: data.name || 'Unknown',
          lat: data.lat || 0,
          lng: data.lng || 0,
          bin: data.bin || 0,
          predictions: data.predictions || {}, // Include all predictions
        });
      });
    } else {
      // Fallback to JS SDK (web)
      const querySnapshot = await getDocs(collection(firestore, 'current-stations-packed'));
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        stations.push({
          id: doc.id,
          name: data.name || 'Unknown',
          lat: data.lat || 0,
          lng: data.lng || 0,
          bin: data.bin || 0,
          predictions: data.predictions || {}, // Include all predictions
        });
      });
    }
    
    cachedCurrentStations = stations;
    console.log(`Loaded ${stations.length} current stations with predictions from Firestore`);
    
    // Log prediction data stats
    const stationsWithData = stations.filter(s => s.predictions && Object.keys(s.predictions).length > 0);
    console.log(`  - Stations with prediction data: ${stationsWithData.length}`);
    if (stationsWithData.length > 0) {
      const sampleStation = stationsWithData[0];
      const dateCount = Object.keys(sampleStation.predictions!).length;
      console.log(`  - Sample station has ${dateCount} days of predictions`);
    }
    
    return stations;
  } catch (error) {
    console.error('Error fetching current stations:', error);
    return [];
  }
}

/**
 * Clear cached stations (useful for testing/refresh)
 */
export function clearStationCache() {
  cachedTideStations = null;
  cachedCurrentStations = null;
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

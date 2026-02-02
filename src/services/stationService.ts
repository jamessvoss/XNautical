import { collection, getDocs } from 'firebase/firestore';
import { firestore } from '../config/firebase';

export interface TideStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: 'R' | 'S'; // Reference or Subordinate
}

export interface CurrentStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  bin: number;
}

let cachedTideStations: TideStation[] | null = null;
let cachedCurrentStations: CurrentStation[] | null = null;

/**
 * Fetch all tidal stations from Firestore
 */
export async function fetchTideStations(): Promise<TideStation[]> {
  if (cachedTideStations) {
    return cachedTideStations;
  }

  try {
    const querySnapshot = await getDocs(collection(firestore, 'tidal-stations'));
    const stations: TideStation[] = [];
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      stations.push({
        id: doc.id,
        name: data.name || 'Unknown',
        lat: data.lat || 0,
        lng: data.lng || 0,
        type: data.type || 'S',
      });
    });
    
    cachedTideStations = stations;
    console.log(`Loaded ${stations.length} tide stations from Firestore`);
    return stations;
  } catch (error) {
    console.error('Error fetching tide stations:', error);
    return [];
  }
}

/**
 * Fetch all current stations from Firestore
 */
export async function fetchCurrentStations(): Promise<CurrentStation[]> {
  if (cachedCurrentStations) {
    return cachedCurrentStations;
  }

  try {
    const querySnapshot = await getDocs(collection(firestore, 'current-stations-packed'));
    const stations: CurrentStation[] = [];
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      stations.push({
        id: doc.id,
        name: data.name || 'Unknown',
        lat: data.lat || 0,
        lng: data.lng || 0,
        bin: data.bin || 0,
      });
    });
    
    cachedCurrentStations = stations;
    console.log(`Loaded ${stations.length} current stations from Firestore`);
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

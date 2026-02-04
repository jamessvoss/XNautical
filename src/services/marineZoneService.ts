/**
 * Marine Zone Service
 * Fetches marine zone boundaries and forecasts from Firebase
 */

import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { firestore } from '../config/firebase';

export interface MarineZone {
  id: string;
  name: string;
  wfo: string;
  centroid: {
    lat: number;
    lon: number;
  };
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

export interface MarineZoneSummary {
  id: string;
  name: string;
  wfo: string;
  centroid: {
    lat: number;
    lon: number;
  };
}

export interface ForecastPeriod {
  number: number;
  name: string;
  startTime: string;
  endTime: string;
  detailedForecast: string;
}

export interface MarineForecast {
  zoneId: string;
  zoneName: string;
  advisory: string;
  synopsis: string;
  forecast: ForecastPeriod[];
  nwsUpdated: string;
  updatedAt: any;
}

// Cache for zone data
let zonesCache: MarineZone[] | null = null;
let zonesCacheTime: number = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

/**
 * Get all marine zones (summaries without full geometry)
 */
export async function getMarineZoneSummaries(): Promise<MarineZoneSummary[]> {
  try {
    const zonesRef = collection(firestore, 'marine-zones');
    const snapshot = await getDocs(zonesRef);
    
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: data.id,
        name: data.name,
        wfo: data.wfo,
        centroid: data.centroid
      };
    });
  } catch (error) {
    console.error('Error fetching marine zone summaries:', error);
    return [];
  }
}

/**
 * Get all marine zones with full geometry
 */
export async function getMarineZones(): Promise<MarineZone[]> {
  // Check cache
  if (zonesCache && Date.now() - zonesCacheTime < CACHE_DURATION) {
    return zonesCache;
  }
  
  try {
    const zonesRef = collection(firestore, 'marine-zones');
    const snapshot = await getDocs(zonesRef);
    
    const zones = snapshot.docs.map(doc => {
      const data = doc.data();
      // Parse geometry from JSON string
      const geometry = JSON.parse(data.geometryJson);
      
      return {
        id: data.id,
        name: data.name,
        wfo: data.wfo,
        centroid: data.centroid,
        geometry
      };
    });
    
    // Update cache
    zonesCache = zones;
    zonesCacheTime = Date.now();
    
    return zones;
  } catch (error) {
    console.error('Error fetching marine zones:', error);
    return [];
  }
}

/**
 * Get a single marine zone by ID
 */
export async function getMarineZone(zoneId: string): Promise<MarineZone | null> {
  try {
    const docRef = doc(firestore, 'marine-zones', zoneId);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      return null;
    }
    
    const data = docSnap.data();
    const geometry = JSON.parse(data.geometryJson);
    
    return {
      id: data.id,
      name: data.name,
      wfo: data.wfo,
      centroid: data.centroid,
      geometry
    };
  } catch (error) {
    console.error('Error fetching marine zone:', error);
    return null;
  }
}

/**
 * Get forecast for a specific zone
 */
export async function getMarineForecast(zoneId: string): Promise<MarineForecast | null> {
  try {
    const docRef = doc(firestore, 'marine-forecasts', zoneId);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      return null;
    }
    
    return docSnap.data() as MarineForecast;
  } catch (error: any) {
    if (!error?.message?.includes('offline')) {
      console.log('[Marine] Error fetching forecast:', error?.message || error);
    }
    return null;
  }
}

/**
 * Get WFO name from code
 */
export function getWfoName(wfo: string): string {
  const wfoNames: Record<string, string> = {
    'AFC': 'Anchorage',
    'AFG': 'Fairbanks',
    'AJK': 'Juneau'
  };
  return wfoNames[wfo] || wfo;
}

/**
 * Format forecast update time
 */
export function formatForecastTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    });
  } catch {
    return isoString;
  }
}

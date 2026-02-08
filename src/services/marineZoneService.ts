/**
 * Marine Zone Service
 * Fetches marine zone boundaries and forecasts from Firebase
 * 
 * Now supports multi-district architecture:
 * - Zones are stored under districts/{districtId}/marine-zones
 * - Forecasts are stored under districts/{districtId}/marine-forecasts
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
  districtId?: string;
}

export interface MarineZoneSummary {
  id: string;
  name: string;
  wfo: string;
  centroid: {
    lat: number;
    lon: number;
  };
  districtId?: string;
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
  districtId?: string;
}

// Cache for zone data (per district)
const zonesCache: Record<string, MarineZone[]> = {};
const zonesCacheTime: Record<string, number> = {};
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

/**
 * Get all marine zones (summaries without full geometry) for a district
 * @param districtId District ID (e.g., '17cgd', '07cgd')
 */
export async function getMarineZoneSummaries(districtId: string): Promise<MarineZoneSummary[]> {
  try {
    const zonesRef = collection(firestore, 'marine-forecast-districts', districtId, 'marine-zones');
    const snapshot = await getDocs(zonesRef);
    
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: data.id,
        name: data.name,
        wfo: data.wfo,
        centroid: data.centroid,
        districtId: districtId
      };
    });
  } catch (error) {
    console.error(`Error fetching marine zone summaries for ${districtId}:`, error);
    return [];
  }
}

/**
 * Get all marine zones with full geometry for a district
 * @param districtId District ID (e.g., '17cgd', '07cgd')
 */
export async function getMarineZones(districtId: string): Promise<MarineZone[]> {
  // Check cache
  if (zonesCache[districtId] && Date.now() - (zonesCacheTime[districtId] || 0) < CACHE_DURATION) {
    return zonesCache[districtId];
  }
  
  try {
    const zonesRef = collection(firestore, 'marine-forecast-districts', districtId, 'marine-zones');
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
        geometry,
        districtId: districtId
      };
    });
    
    // Update cache
    zonesCache[districtId] = zones;
    zonesCacheTime[districtId] = Date.now();
    
    return zones;
  } catch (error) {
    console.error(`Error fetching marine zones for ${districtId}:`, error);
    return [];
  }
}

/**
 * Get a single marine zone by ID for a district
 * @param districtId District ID (e.g., '17cgd', '07cgd')
 * @param zoneId Zone ID (e.g., 'PKZ011', 'AMZ651')
 */
export async function getMarineZone(districtId: string, zoneId: string): Promise<MarineZone | null> {
  try {
    const docRef = doc(firestore, 'marine-forecast-districts', districtId, 'marine-zones', zoneId);
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
      geometry,
      districtId: districtId
    };
  } catch (error) {
    console.error(`Error fetching marine zone ${zoneId} for ${districtId}:`, error);
    return null;
  }
}

/**
 * Get forecast for a specific zone in a district
 * @param districtId District ID (e.g., '17cgd', '07cgd')
 * @param zoneId Zone ID (e.g., 'PKZ011', 'AMZ651')
 */
export async function getMarineForecast(districtId: string, zoneId: string): Promise<MarineForecast | null> {
  try {
    console.log(`[Marine] Fetching forecast for district ${districtId}, zone:`, zoneId);
    const docRef = doc(firestore, 'marine-forecast-districts', districtId, 'marine-forecasts', zoneId);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      console.log(`[Marine] No forecast document found for district ${districtId}, zone:`, zoneId);
      return null;
    }
    
    console.log(`[Marine] Forecast found for district ${districtId}, zone:`, zoneId);
    return { ...docSnap.data(), districtId: districtId } as MarineForecast;
  } catch (error: any) {
    console.error(`[Marine] Error fetching forecast for ${districtId}/${zoneId}:`, error?.message || error);
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

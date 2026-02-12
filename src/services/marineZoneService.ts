/**
 * Marine Zone Service
 * Fetches marine zone boundaries and forecasts from Firebase
 * 
 * Multi-district architecture:
 * - Zones are stored under districts/{districtId}/marine-zones
 * - Forecasts are stored under districts/{districtId}/marine-forecasts
 * 
 * Offline support:
 * - Zone boundaries cached in AsyncStorage per district
 * - Forecasts require online access (live data)
 */

import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { firestore } from '../config/firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

// AsyncStorage keys
const MARINE_ZONES_KEY = (districtId: string) => `@XNautical:marineZones:${districtId}`;
const MARINE_ZONES_DOWNLOADED_KEY = (districtId: string) => `@XNautical:marineZonesDownloaded:${districtId}`;

// Cache for zone data (per district) - in-memory
const zonesCache: Record<string, MarineZone[]> = {};
const zonesCacheTime: Record<string, number> = {};
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

/**
 * Get all marine zones (summaries without full geometry) for a district
 * @param districtId District ID (e.g., '17cgd', '07cgd')
 */
export async function getMarineZoneSummaries(districtId: string): Promise<MarineZoneSummary[]> {
  try {
    const zonesRef = collection(firestore, 'districts', districtId, 'marine-zones');
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
 * Tries AsyncStorage cache first, then Firestore if online
 * @param districtId District ID (e.g., '17cgd', '07cgd')
 */
export async function getMarineZones(districtId: string): Promise<MarineZone[]> {
  // Check in-memory cache first
  if (zonesCache[districtId] && Date.now() - (zonesCacheTime[districtId] || 0) < CACHE_DURATION) {
    return zonesCache[districtId];
  }
  
  // Try loading from AsyncStorage (offline support)
  try {
    const cachedData = await AsyncStorage.getItem(MARINE_ZONES_KEY(districtId));
    if (cachedData) {
      const zones: MarineZone[] = JSON.parse(cachedData);
      console.log(`[Marine] Loaded ${zones.length} zones from AsyncStorage for ${districtId}`);
      
      // Update in-memory cache
      zonesCache[districtId] = zones;
      zonesCacheTime[districtId] = Date.now();
      
      return zones;
    }
  } catch (error) {
    console.warn(`[Marine] Error loading zones from AsyncStorage for ${districtId}:`, error);
  }
  
  // Fetch from Firestore if not cached
  try {
    const zonesRef = collection(firestore, 'districts', districtId, 'marine-zones');
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
    
    console.log(`[Marine] Fetched ${zones.length} zones from Firestore for ${districtId}`);
    
    // Update both caches
    zonesCache[districtId] = zones;
    zonesCacheTime[districtId] = Date.now();
    
    // Save to AsyncStorage for offline access
    try {
      await AsyncStorage.setItem(MARINE_ZONES_KEY(districtId), JSON.stringify(zones));
      console.log(`[Marine] Saved ${zones.length} zones to AsyncStorage for ${districtId}`);
    } catch (storageError) {
      console.warn(`[Marine] Could not save zones to AsyncStorage:`, storageError);
    }
    
    return zones;
  } catch (error) {
    console.error(`[Marine] Error fetching marine zones for ${districtId}:`, error);
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
    const docRef = doc(firestore, 'districts', districtId, 'marine-zones', zoneId);
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
    const docRef = doc(firestore, 'districts', districtId, 'marine-forecasts', zoneId);
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

// ============================================
// Download & Cache Functions
// ============================================

/**
 * Download and cache marine zone boundaries for a district.
 * Fetches all zone data from Firestore and stores in AsyncStorage.
 * Called during the district download flow.
 */
export async function downloadMarineZones(
  districtId: string,
  onProgress?: (message: string, percent: number) => void
): Promise<{ success: boolean; zoneCount: number; error?: string }> {
  try {
    onProgress?.('Fetching marine zone boundaries...', 10);

    // Fetch zones from Firestore
    const zonesRef = collection(firestore, 'districts', districtId, 'marine-zones');
    const snapshot = await getDocs(zonesRef);

    if (snapshot.empty) {
      // No zones for this district - still mark as downloaded (empty)
      await AsyncStorage.setItem(MARINE_ZONES_KEY(districtId), JSON.stringify([]));
      await AsyncStorage.setItem(MARINE_ZONES_DOWNLOADED_KEY(districtId), JSON.stringify({
        downloadedAt: new Date().toISOString(),
        zoneCount: 0,
      }));
      onProgress?.('No marine zones found for this district', 100);
      return { success: true, zoneCount: 0 };
    }

    onProgress?.(`Processing ${snapshot.size} marine zones...`, 40);

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

    onProgress?.(`Caching ${zones.length} marine zone boundaries...`, 70);

    // Cache to AsyncStorage
    await AsyncStorage.setItem(MARINE_ZONES_KEY(districtId), JSON.stringify(zones));
    await AsyncStorage.setItem(MARINE_ZONES_DOWNLOADED_KEY(districtId), JSON.stringify({
      downloadedAt: new Date().toISOString(),
      zoneCount: zones.length,
    }));

    // Update in-memory cache
    zonesCache[districtId] = zones;
    zonesCacheTime[districtId] = Date.now();

    onProgress?.(`${zones.length} marine zones cached`, 100);
    return { success: true, zoneCount: zones.length };
  } catch (error: any) {
    console.error(`[Marine] Error downloading zones for ${districtId}:`, error);
    return { success: false, zoneCount: 0, error: error.message || 'Download failed' };
  }
}

/**
 * Check if marine zones are downloaded for a district
 */
export async function areMarineZonesDownloaded(districtId: string): Promise<boolean> {
  try {
    const metadata = await AsyncStorage.getItem(MARINE_ZONES_DOWNLOADED_KEY(districtId));
    return metadata !== null;
  } catch (error) {
    console.error(`[Marine] Error checking zones download status for ${districtId}:`, error);
    return false;
  }
}

/**
 * Clear cached marine zones for a district
 */
export async function clearMarineZones(districtId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(MARINE_ZONES_KEY(districtId));
    await AsyncStorage.removeItem(MARINE_ZONES_DOWNLOADED_KEY(districtId));
    
    // Clear in-memory cache
    delete zonesCache[districtId];
    delete zonesCacheTime[districtId];
    
    console.log(`[Marine] Cleared marine zones for ${districtId}`);
  } catch (error) {
    console.error(`[Marine] Error clearing zones for ${districtId}:`, error);
    throw error;
  }
}

/**
 * Get metadata about downloaded marine zones
 */
export async function getMarineZoneMetadata(districtId: string): Promise<{
  downloadedAt: string;
  zoneCount: number;
} | null> {
  try {
    const metadata = await AsyncStorage.getItem(MARINE_ZONES_DOWNLOADED_KEY(districtId));
    if (!metadata) return null;
    return JSON.parse(metadata);
  } catch (error) {
    console.error(`[Marine] Error getting zone metadata for ${districtId}:`, error);
    return null;
  }
}

/**
 * Marine Zone Service
 * Fetches marine zone boundaries and forecasts from Firebase
 * 
 * Multi-district architecture:
 * - Zones are stored under districts/{districtId}/marine-zones
 * - Forecasts are stored under districts/{districtId}/marine-forecasts
 * 
 * Offline support:
 * - Zone boundaries cached as JSON files per district (too large for AsyncStorage)
 * - Forecasts require online access (live data)
 */

import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { firestore } from '../config/firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

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
  periods: ForecastPeriod[];
  nwsUpdated: string;
  updatedAt: any;
  districtId?: string;
}

// Zone geometry stored as files (too large for AsyncStorage on Android)
const MARINE_ZONES_FILE = (districtId: string) =>
  `${FileSystem.documentDirectory}marine-zones-${districtId}.json`;
// Small metadata stays in AsyncStorage
const MARINE_ZONES_DOWNLOADED_KEY = (districtId: string) => `@XNautical:marineZonesDownloaded:${districtId}`;
// Legacy key — used for migration only
const LEGACY_ZONES_KEY = (districtId: string) => `@XNautical:marineZones:${districtId}`;

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
  
  // Try loading from file (offline support)
  try {
    const filePath = MARINE_ZONES_FILE(districtId);
    const fileInfo = await FileSystem.getInfoAsync(filePath);
    if (fileInfo.exists) {
      const data = await FileSystem.readAsStringAsync(filePath);
      const zones: MarineZone[] = JSON.parse(data);
      console.log(`[Marine] Loaded ${zones.length} zones from file for ${districtId}`);
      zonesCache[districtId] = zones;
      zonesCacheTime[districtId] = Date.now();
      return zones;
    }
  } catch (error) {
    console.warn(`[Marine] Error loading zones from file for ${districtId}:`, error);
  }
  
  // Fetch from Firestore if not cached
  try {
    const zonesRef = collection(firestore, 'districts', districtId, 'marine-zones');
    const snapshot = await getDocs(zonesRef);

    const zones: MarineZone[] = [];
    for (const d of snapshot.docs) {
      const data = d.data();
      let geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null = null;
      if (data.geometryJson) {
        try {
          geometry = JSON.parse(data.geometryJson);
        } catch {
          console.warn(`[Marine] Invalid geometryJson for zone ${d.id} in ${districtId}`);
          continue;
        }
      }
      if (!geometry) continue;
      zones.push({
        id: data.id || d.id,
        name: data.name || d.id,
        wfo: data.wfo || '',
        centroid: data.centroid,
        geometry,
        districtId: districtId,
      });
    }

    console.log(`[Marine] Fetched ${zones.length} zones from Firestore for ${districtId}`);
    
    // Update both caches
    zonesCache[districtId] = zones;
    zonesCacheTime[districtId] = Date.now();
    
    // Save to file for offline access
    try {
      await FileSystem.writeAsStringAsync(MARINE_ZONES_FILE(districtId), JSON.stringify(zones));
      console.log(`[Marine] Saved ${zones.length} zones to file for ${districtId}`);
    } catch (fileError) {
      console.warn(`[Marine] Could not save zones to file:`, fileError);
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
    let geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null = null;
    if (data.geometryJson) {
      try {
        geometry = JSON.parse(data.geometryJson);
      } catch {
        console.warn(`[Marine] Invalid geometryJson for zone ${zoneId} in ${districtId}`);
      }
    }

    return {
      id: data.id || zoneId,
      name: data.name || zoneId,
      wfo: data.wfo || '',
      centroid: data.centroid,
      geometry: geometry!,
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
      await FileSystem.writeAsStringAsync(MARINE_ZONES_FILE(districtId), JSON.stringify([]));
      await AsyncStorage.setItem(MARINE_ZONES_DOWNLOADED_KEY(districtId), JSON.stringify({
        downloadedAt: new Date().toISOString(),
        zoneCount: 0,
      }));
      onProgress?.('No marine zones found for this district', 100);
      return { success: true, zoneCount: 0 };
    }

    onProgress?.(`Processing ${snapshot.size} marine zones...`, 40);

    const zones: MarineZone[] = [];
    for (const d of snapshot.docs) {
      const data = d.data();
      let geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null = null;
      if (data.geometryJson) {
        try {
          geometry = JSON.parse(data.geometryJson);
        } catch {
          console.warn(`[Marine] Invalid geometryJson for zone ${d.id} in ${districtId}, skipping`);
          continue;
        }
      }
      if (!geometry) continue;
      zones.push({
        id: data.id || d.id,
        name: data.name || d.id,
        wfo: data.wfo || '',
        centroid: data.centroid,
        geometry,
        districtId: districtId,
      });
    }

    onProgress?.(`Caching ${zones.length} marine zone boundaries...`, 70);

    // Cache to file (too large for AsyncStorage on Android)
    await FileSystem.writeAsStringAsync(MARINE_ZONES_FILE(districtId), JSON.stringify(zones));
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
    await FileSystem.deleteAsync(MARINE_ZONES_FILE(districtId), { idempotent: true });
    await AsyncStorage.removeItem(MARINE_ZONES_DOWNLOADED_KEY(districtId));
    // Clean up legacy AsyncStorage key if present
    await AsyncStorage.removeItem(LEGACY_ZONES_KEY(districtId)).catch(() => {});

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

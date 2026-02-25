/**
 * Buoy Service
 * 
 * Fetches live buoy data from Firestore with local caching for offline use.
 * 
 * When a district is downloaded, the buoy catalog is cached locally via AsyncStorage.
 * The map loads from cache first and falls back to Firestore when online.
 */

import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { firestore } from '../config/firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as unitFormat from './unitFormatService';

// AsyncStorage keys
const BUOY_CATALOG_KEY = (districtId: string) => `@XNautical:buoyCatalog:${districtId}`;
const BUOY_DOWNLOADED_KEY = (districtId: string) => `@XNautical:buoysDownloaded:${districtId}`;

export interface BuoyObservation {
  timestamp: string;
  // Temperature
  waterTemp?: number;      // Celsius
  airTemp?: number;        // Celsius
  dewPoint?: number;       // Celsius
  // Wind
  windSpeed?: number;      // m/s
  windDirection?: number;  // degrees
  windGust?: number;       // m/s
  // Combined waves
  waveHeight?: number;     // meters (significant wave height)
  dominantWavePeriod?: number; // seconds
  averageWavePeriod?: number;  // seconds
  meanWaveDirection?: number;  // degrees
  // Swell (long period waves from distant storms)
  swellHeight?: number;    // meters
  swellPeriod?: number;    // seconds
  swellDirection?: number; // degrees
  // Wind waves (short period, locally generated)
  windWaveHeight?: number; // meters
  windWavePeriod?: number; // seconds
  windWaveDirection?: number; // degrees
  steepness?: string;      // wave steepness category
  // Atmospheric
  pressure?: number;       // hPa
  pressureTendency?: number; // hPa change (positive = rising)
  visibility?: number;     // nautical miles
  tide?: number;           // feet
  // Ocean data
  oceanData?: {
    depth?: number;
    oceanTemp?: number;
    salinity?: number;
    conductivity?: number;
    oxygenPercent?: number;
    oxygenPPM?: number;
    chlorophyll?: number;
    turbidity?: number;
    ph?: number;
  };
}

export interface Buoy {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  type: string;
  owner: string;
  districtId?: string;  // USCG district (e.g., '17cgd', '07cgd') - transitional field for region-scoped migration
  latestObservation?: BuoyObservation;
  lastUpdated?: string;
}

export interface BuoySummary {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  type: string;
  districtId?: string;  // USCG district (e.g., '17cgd', '07cgd') - transitional field for region-scoped migration
}

/**
 * Fetch the catalog of all buoys
 * @param districtId - Optional USCG district ID (e.g., '17cgd', '07cgd'). If provided, returns only buoys for that district.
 * 
 * When called without districtId, tries district-scoped catalogs first,
 * then falls back to the legacy top-level buoys/catalog collection.
 */
export async function getBuoysCatalog(districtId?: string): Promise<BuoySummary[]> {
  try {
    if (districtId) {
      // Fetch from district-scoped collection
      const catalogRef = doc(firestore, 'districts', districtId, 'buoys', 'catalog');
      const catalogSnap = await getDoc(catalogRef);
      
      if (!catalogSnap.exists()) {
        console.log(`[Buoy] Catalog not found for district ${districtId}`);
        return [];
      }
      
      const data = catalogSnap.data();
      return data.stations || [];
    } else {
      // Try district-scoped catalogs first
      const allBuoys: BuoySummary[] = [];
      const districtsRef = collection(firestore, 'districts');
      const districtsSnap = await getDocs(districtsRef);
      
      for (const districtDoc of districtsSnap.docs) {
        const catalogRef = doc(firestore, 'districts', districtDoc.id, 'buoys', 'catalog');
        const catalogSnap = await getDoc(catalogRef);
        
        if (catalogSnap.exists()) {
          const data = catalogSnap.data();
          const stations = data.stations || [];
          allBuoys.push(...stations);
        }
      }
      
      if (allBuoys.length > 0) {
        return allBuoys;
      }

      // Fallback: read from legacy top-level buoys/catalog
      console.log('[Buoy] No district catalogs found, trying legacy buoys/catalog...');
      const legacyCatalogRef = doc(firestore, 'buoys', 'catalog');
      const legacyCatalogSnap = await getDoc(legacyCatalogRef);

      if (legacyCatalogSnap.exists()) {
        const data = legacyCatalogSnap.data();
        const stations = data.stations || [];
        console.log(`[Buoy] Loaded ${stations.length} buoys from legacy catalog`);
        return stations;
      }

      return [];
    }
  } catch (error: any) {
    if (!error?.message?.includes('offline')) {
      console.log('[Buoy] Error fetching catalog:', error?.message || error);
    }
    return [];
  }
}

/**
 * Fetch a specific buoy with its latest observation
 * @param buoyId - The buoy ID (e.g., '46060')
 * @param districtId - Optional USCG district ID. If not provided, searches all districts then legacy collection.
 */
export async function getBuoy(buoyId: string, districtId?: string): Promise<Buoy | null> {
  try {
    if (districtId) {
      // Fetch from specific district
      const buoyRef = doc(firestore, 'districts', districtId, 'buoys', buoyId);
      const buoySnap = await getDoc(buoyRef);
      
      if (buoySnap.exists()) {
        return buoySnap.data() as Buoy;
      }

      // Fallback: try legacy top-level buoys collection
      const legacyRef = doc(firestore, 'buoys', buoyId);
      const legacySnap = await getDoc(legacyRef);
      if (legacySnap.exists()) {
        return legacySnap.data() as Buoy;
      }

      console.log(`[Buoy] ${buoyId} not found in district ${districtId} or legacy`);
      return null;
    } else {
      // Search all districts
      const districtsRef = collection(firestore, 'districts');
      const districtsSnap = await getDocs(districtsRef);
      
      for (const districtDoc of districtsSnap.docs) {
        const buoyRef = doc(firestore, 'districts', districtDoc.id, 'buoys', buoyId);
        const buoySnap = await getDoc(buoyRef);
        
        if (buoySnap.exists()) {
          return buoySnap.data() as Buoy;
        }
      }

      // Fallback: try legacy top-level buoys collection
      const legacyRef = doc(firestore, 'buoys', buoyId);
      const legacySnap = await getDoc(legacyRef);
      if (legacySnap.exists()) {
        return legacySnap.data() as Buoy;
      }
      
      console.log(`[Buoy] ${buoyId} not found in any district or legacy`);
      return null;
    }
  } catch (error: any) {
    if (!error?.message?.includes('offline')) {
      console.log(`[Buoy] Error fetching ${buoyId}:`, error?.message || error);
    }
    return null;
  }
}

// ============================================
// Download & Cache Functions
// ============================================

/**
 * Download and cache the buoy catalog for a district.
 * Fetches all buoy summaries from Firestore and stores them in AsyncStorage.
 * Called during the district download flow.
 */
export async function downloadBuoyCatalog(
  districtId: string,
  onProgress?: (message: string, percent: number) => void
): Promise<{ success: boolean; stationCount: number; error?: string }> {
  try {
    onProgress?.('Fetching buoy catalog...', 10);

    // Fetch catalog from Firestore
    const catalogRef = doc(firestore, 'districts', districtId, 'buoys', 'catalog');
    const catalogSnap = await getDoc(catalogRef);

    if (!catalogSnap.exists()) {
      // No buoys for this district - still mark as downloaded (empty)
      await AsyncStorage.setItem(BUOY_CATALOG_KEY(districtId), JSON.stringify([]));
      await AsyncStorage.setItem(BUOY_DOWNLOADED_KEY(districtId), JSON.stringify({
        downloadedAt: new Date().toISOString(),
        stationCount: 0,
      }));
      onProgress?.('No buoys found for this district', 100);
      return { success: true, stationCount: 0 };
    }

    const data = catalogSnap.data();
    const stations: BuoySummary[] = data.stations || [];

    onProgress?.(`Caching ${stations.length} buoy stations...`, 60);

    // Cache to AsyncStorage
    await AsyncStorage.setItem(BUOY_CATALOG_KEY(districtId), JSON.stringify(stations));
    await AsyncStorage.setItem(BUOY_DOWNLOADED_KEY(districtId), JSON.stringify({
      downloadedAt: new Date().toISOString(),
      stationCount: stations.length,
    }));

    onProgress?.(`${stations.length} buoys cached`, 100);
    return { success: true, stationCount: stations.length };
  } catch (error: any) {
    console.error(`[Buoy] Error downloading catalog for ${districtId}:`, error);
    return { success: false, stationCount: 0, error: error.message || 'Download failed' };
  }
}

/**
 * Get the cached buoy catalog for a district.
 * Returns cached data from AsyncStorage, or falls back to Firestore if not cached.
 */
export async function getCachedBuoyCatalog(districtId: string): Promise<BuoySummary[]> {
  try {
    // Try local cache first
    const cached = await AsyncStorage.getItem(BUOY_CATALOG_KEY(districtId));
    if (cached) {
      const stations = JSON.parse(cached) as BuoySummary[];
      return stations;
    }

    // Fall back to Firestore
    return await getBuoysCatalog(districtId);
  } catch (error: any) {
    console.log(`[Buoy] Error reading cached catalog for ${districtId}:`, error?.message);
    // Last resort: try Firestore
    return await getBuoysCatalog(districtId);
  }
}

/**
 * Check if buoy data has been downloaded for a district.
 */
export async function areBuoysDownloaded(districtId: string): Promise<boolean> {
  try {
    const meta = await AsyncStorage.getItem(BUOY_DOWNLOADED_KEY(districtId));
    return meta !== null;
  } catch {
    return false;
  }
}

/**
 * Get buoy download metadata for a district (station count, download time).
 */
export async function getBuoyDownloadMetadata(districtId: string): Promise<{
  downloadedAt: string;
  stationCount: number;
} | null> {
  try {
    const meta = await AsyncStorage.getItem(BUOY_DOWNLOADED_KEY(districtId));
    return meta ? JSON.parse(meta) : null;
  } catch {
    return null;
  }
}

/**
 * Clear cached buoy data for a district.
 */
export async function clearBuoys(districtId: string): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      BUOY_CATALOG_KEY(districtId),
      BUOY_DOWNLOADED_KEY(districtId),
    ]);
  } catch (error: any) {
    console.error(`[Buoy] Error clearing buoys for ${districtId}:`, error);
  }
}

// ============================================
// Formatting Utilities
// ============================================

/**
 * Format temperature for display (Celsius → user's unit)
 */
export function formatTemp(celsius: number | undefined): string {
  return unitFormat.formatTemp(celsius);
}

/**
 * Format wave height for display (meters → user's depth unit)
 */
export function formatWaveHeight(meters: number | undefined): string {
  return unitFormat.formatWaveHeight(meters);
}

/**
 * Format wind speed for display (m/s → user's speed unit)
 */
export function formatWindSpeed(ms: number | undefined): string {
  return unitFormat.formatWindSpeed(ms);
}

/**
 * Get wind direction as compass point
 */
export function formatWindDirection(degrees: number | undefined): string {
  if (degrees === undefined) return '--';
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 
                      'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}

/**
 * Format wave period for display
 */
export function formatWavePeriod(seconds: number | undefined): string {
  if (seconds === undefined) return '--';
  return `${seconds.toFixed(0)}s`;
}

/**
 * Format pressure for display
 */
export function formatPressure(hPa: number | undefined): string {
  if (hPa === undefined) return '--';
  return `${hPa.toFixed(1)} mb`;
}

/**
 * Format air temp for display (Celsius → user's unit)
 */
export function formatAirTemp(celsius: number | undefined): string {
  return unitFormat.formatTemp(celsius);
}

/**
 * Format pressure tendency for display
 */
export function formatPressureTendency(hPa: number | undefined): string {
  if (hPa === undefined) return '--';
  const sign = hPa >= 0 ? '+' : '';
  const trend = hPa > 0.5 ? '↑' : hPa < -0.5 ? '↓' : '→';
  return `${sign}${hPa.toFixed(1)} ${trend}`;
}

/**
 * Format timestamp for display
 */
export function formatBuoyTimestamp(isoString: string | undefined): string {
  if (!isoString) return '--';
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
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

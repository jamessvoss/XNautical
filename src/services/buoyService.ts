/**
 * Buoy Service
 * 
 * Fetches live buoy data from Firestore
 */

import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { firestore } from '../config/firebase';

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
 */
export async function getBuoysCatalog(districtId?: string): Promise<BuoySummary[]> {
  try {
    if (districtId) {
      // Fetch from district-scoped collection
      const catalogRef = doc(firestore, 'districts', districtId, 'buoys', 'catalog');
      const catalogSnap = await getDoc(catalogRef);
      
      if (!catalogSnap.exists()) {
        console.log(`Buoys catalog not found for district ${districtId}`);
        return [];
      }
      
      const data = catalogSnap.data();
      return data.stations || [];
    } else {
      // Fetch from all districts
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
      
      return allBuoys;
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
 * @param districtId - Optional USCG district ID. If not provided, searches all districts.
 */
export async function getBuoy(buoyId: string, districtId?: string): Promise<Buoy | null> {
  try {
    if (districtId) {
      // Fetch from specific district
      const buoyRef = doc(firestore, 'districts', districtId, 'buoys', buoyId);
      const buoySnap = await getDoc(buoyRef);
      
      if (!buoySnap.exists()) {
        console.log(`Buoy ${buoyId} not found in district ${districtId}`);
        return null;
      }
      
      return buoySnap.data() as Buoy;
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
      
      console.log(`Buoy ${buoyId} not found in any district`);
      return null;
    }
  } catch (error: any) {
    if (!error?.message?.includes('offline')) {
      console.log(`[Buoy] Error fetching ${buoyId}:`, error?.message || error);
    }
    return null;
  }
}

/**
 * Format temperature for display (Celsius to Fahrenheit)
 */
export function formatTemp(celsius: number | undefined): string {
  if (celsius === undefined) return '--';
  const fahrenheit = (celsius * 9/5) + 32;
  return `${fahrenheit.toFixed(0)}°F`;
}

/**
 * Format wave height for display (meters to feet)
 */
export function formatWaveHeight(meters: number | undefined): string {
  if (meters === undefined) return '--';
  const feet = meters * 3.28084;
  return `${feet.toFixed(1)} ft`;
}

/**
 * Format wind speed for display (m/s to knots)
 */
export function formatWindSpeed(ms: number | undefined): string {
  if (ms === undefined) return '--';
  const knots = ms * 1.94384;
  return `${knots.toFixed(0)} kts`;
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
 * Format air temp for display
 */
export function formatAirTemp(celsius: number | undefined): string {
  if (celsius === undefined) return '--';
  const fahrenheit = (celsius * 9/5) + 32;
  return `${fahrenheit.toFixed(0)}°F`;
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

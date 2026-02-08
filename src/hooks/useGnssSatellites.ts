import { useEffect, useState, useRef } from 'react';
import { NativeModules, NativeEventEmitter, Platform, PermissionsAndroid } from 'react-native';

const { GnssSatelliteTracker } = NativeModules;

/**
 * GNSS Satellite data structure (Android)
 */
export interface GnssSatellite {
  svid: number;                // Satellite Vehicle ID (PRN number)
  cn0DbHz: number;             // C/N0 signal strength in dB-Hz (15-50 typical)
  constellation: string;       // "GPS", "GLONASS", "Galileo", "BeiDou", "QZSS", "SBAS"
  constellationType: number;   // Raw constellation type integer
  azimuth: number;             // Azimuth in degrees (0-360)
  elevation: number;           // Elevation in degrees (0-90)
  usedInFix: boolean;          // True if satellite was used in the most recent fix
  hasAlmanac: boolean;         // True if satellite has almanac data
  hasEphemeris: boolean;       // True if satellite has ephemeris data
}

/**
 * GNSS Satellite update data
 */
export interface GnssSatelliteData {
  satellites: GnssSatellite[]; // Array of satellite data (empty on iOS)
  timestamp: number;           // Timestamp in milliseconds
  satelliteCount?: number;     // Estimated satellite count (iOS only)
  accuracy?: number;           // Horizontal accuracy in meters (iOS only)
  isLimitedData?: boolean;     // True if iOS (limited data available)
}

/**
 * Hook return type
 */
export interface UseGnssSatellitesReturn {
  data: GnssSatelliteData | null;     // Latest satellite data
  isTracking: boolean;                // True if currently tracking
  isAvailable: boolean;               // True if native module is available
  error: string | null;               // Error message if any
  startTracking: () => Promise<void>; // Start satellite tracking
  stopTracking: () => Promise<void>;  // Stop satellite tracking
}

/**
 * React hook for accessing real-time GNSS satellite data
 * 
 * **Android (Full Support):**
 * - Returns individual satellite data with C/N0, PRN, constellation, azimuth, elevation
 * - Requires Android 7.0+ (API 24)
 * - Requires ACCESS_FINE_LOCATION permission
 * 
 * **iOS (Limited Support):**
 * - Returns estimated satellite count only
 * - Individual satellite data NOT available (iOS API limitation)
 * - For full satellite visualization, use Android or continue with estimation
 * 
 * **Usage:**
 * ```tsx
 * const { data, isTracking, startTracking, stopTracking } = useGnssSatellites();
 * 
 * useEffect(() => {
 *   startTracking();
 *   return () => stopTracking();
 * }, []);
 * 
 * if (data?.satellites) {
 *   // Android: render real satellite bar chart
 *   data.satellites.forEach(sat => {
 *     console.log(`${sat.constellation} ${sat.svid}: ${sat.cn0DbHz} dB-Hz`);
 *   });
 * } else if (data?.isLimitedData) {
 *   // iOS: use estimation or show satelliteCount
 *   console.log(`Estimated satellites: ${data.satelliteCount}`);
 * }
 * ```
 */
export function useGnssSatellites(): UseGnssSatellitesReturn {
  const [data, setData] = useState<GnssSatelliteData | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventEmitterRef = useRef<NativeEventEmitter | null>(null);
  const subscriptionRef = useRef<any>(null);

  // Check if native module is available
  const isAvailable = !!GnssSatelliteTracker;

  /**
   * Request location permission (Android only)
   */
  const requestPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;

    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'This app needs access to your location to display real-time satellite data.',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) {
      console.warn('[useGnssSatellites] Permission request error:', err);
      return false;
    }
  };

  /**
   * Start tracking satellites
   */
  const startTracking = async () => {
    if (!isAvailable) {
      setError('GNSS satellite tracking not available');
      return;
    }

    try {
      // Request permission on Android
      if (Platform.OS === 'android') {
        const hasPermission = await requestPermission();
        if (!hasPermission) {
          setError('Location permission denied');
          return;
        }
      }

      // Start native tracking
      await GnssSatelliteTracker.startTracking();
      setIsTracking(true);
      setError(null);

      // Set up event listener
      if (!eventEmitterRef.current) {
        eventEmitterRef.current = new NativeEventEmitter(GnssSatelliteTracker);
      }

      subscriptionRef.current = eventEmitterRef.current.addListener(
        'onSatelliteUpdate',
        (updateData: GnssSatelliteData) => {
          setData(updateData);
        }
      );

      console.log('[useGnssSatellites] Tracking started');
    } catch (err: any) {
      console.error('[useGnssSatellites] Failed to start tracking:', err);
      setError(err.message || 'Failed to start tracking');
      setIsTracking(false);
    }
  };

  /**
   * Stop tracking satellites
   */
  const stopTracking = async () => {
    if (!isAvailable) return;

    try {
      await GnssSatelliteTracker.stopTracking();
      setIsTracking(false);

      // Remove event listener
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }

      console.log('[useGnssSatellites] Tracking stopped');
    } catch (err: any) {
      console.error('[useGnssSatellites] Failed to stop tracking:', err);
      setError(err.message || 'Failed to stop tracking');
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
      }
    };
  }, []);

  return {
    data,
    isTracking,
    isAvailable,
    error,
    startTracking,
    stopTracking,
  };
}

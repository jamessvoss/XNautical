/**
 * useGPS Hook - Manages GPS location tracking
 *
 * Provides:
 * - Current position (lat/lon)
 * - Speed (from GPS)
 * - Course Over Ground (COG) - direction of travel
 * - Accuracy
 *
 * GPS data is stored in a ref (gpsDataRef) for real-time reads without
 * triggering React re-renders. A separate gpsData state is synced every
 * 2 seconds for display components that need to re-render (nav bar, etc.).
 *
 * This two-tier approach prevents GPS updates (~1-2/sec) from re-rendering
 * the heavy DynamicChartViewer component, which caused MapLibre to reset
 * zoom gestures mid-animation.
 *
 * NOTE: Device heading (compass) is now handled by useDeviceHeading hook
 * which uses sensor fusion for smoother updates.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import * as Location from 'expo-location';

export interface GPSData {
  // Position
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;

  // Movement
  speed: number | null;        // m/s from GPS
  speedKnots: number | null;   // converted to knots
  course: number | null;       // Course Over Ground (COG) - direction of travel

  // Device orientation (now managed externally by useDeviceHeading)
  heading: number | null;      // Kept for backwards compatibility

  // Accuracy
  accuracy: number | null;     // meters

  // Timestamp
  timestamp: number | null;

  // Status
  isTracking: boolean;
  hasPermission: boolean;
  error: string | null;
}

interface UseGPSOptions {
  // Update frequency
  distanceInterval?: number;   // meters - minimum distance before update
  timeInterval?: number;       // ms - minimum time between updates
}

const MS_TO_KNOTS = 1.94384;

const INITIAL_GPS_DATA: GPSData = {
  latitude: null,
  longitude: null,
  altitude: null,
  speed: null,
  speedKnots: null,
  course: null,
  heading: null,
  accuracy: null,
  timestamp: null,
  isTracking: false,
  hasPermission: false,
  error: null,
};

// How often to sync ref → state for display updates (ms).
// Kept slow to avoid interrupting MapLibre gestures with re-renders.
const DISPLAY_SYNC_INTERVAL = 2000;

export function useGPS(options: UseGPSOptions = {}) {
  const {
    distanceInterval = 5,      // Update every 5 meters
    timeInterval = 1000,       // Or every 1 second
  } = options;

  // Primary store — always up-to-date, never triggers re-renders.
  // Consumers that need the latest GPS data without re-rendering (e.g.
  // Camera centerCoordinate, overlay context) should read gpsDataRef.current.
  const gpsDataRef = useRef<GPSData>({ ...INITIAL_GPS_DATA });

  // Display-only state — synced from ref on a slow timer.
  // Only used by components that need to re-render on GPS changes
  // (nav bar speed/heading, GPS marker position).
  const [gpsData, setGpsData] = useState<GPSData>({ ...INITIAL_GPS_DATA });

  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const previousPosition = useRef<{ lat: number; lon: number; time: number } | null>(null);
  const lastPositionUpdate = useRef<{ lat: number; lon: number } | null>(null);
  const MIN_POSITION_CHANGE_M = 1;

  // Sync ref → state on a slow timer for display updates
  useEffect(() => {
    const interval = setInterval(() => {
      setGpsData({ ...gpsDataRef.current });
    }, DISPLAY_SYNC_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  // Helper: update the ref (no re-render)
  const updateRef = useCallback((updater: (prev: GPSData) => GPSData) => {
    gpsDataRef.current = updater(gpsDataRef.current);
  }, []);

  // Calculate bearing between two points (for COG when GPS doesn't provide it)
  const calculateBearing = useCallback((lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;

    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
  }, []);

  // Calculate distance between two points in meters (Haversine formula)
  const calculateDistance = useCallback((lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }, []);

  // Request permissions
  const requestPermissions = useCallback(async (): Promise<boolean> => {
    try {
      const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();

      if (foregroundStatus !== 'granted') {
        updateRef(prev => ({
          ...prev,
          hasPermission: false,
          error: 'Location permission denied',
        }));
        return false;
      }

      updateRef(prev => ({
        ...prev,
        hasPermission: true,
        error: null,
      }));
      return true;
    } catch (error) {
      updateRef(prev => ({
        ...prev,
        hasPermission: false,
        error: 'Failed to request location permissions',
      }));
      return false;
    }
  }, [updateRef]);

  // Update heading from external source (useDeviceHeading)
  const updateHeading = useCallback((heading: number | null) => {
    updateRef(prev => ({
      ...prev,
      heading,
    }));
  }, [updateRef]);

  // Start tracking
  const startTracking = useCallback(async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    try {
      // Start location updates
      locationSubscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval,
          timeInterval,
        },
        (location) => {
          const { latitude, longitude, altitude, speed, heading, accuracy } = location.coords;
          const timestamp = location.timestamp;

          // Track whether position changed enough for COG calculation
          let positionChanged = true;
          if (lastPositionUpdate.current) {
            const distance = calculateDistance(
              lastPositionUpdate.current.lat,
              lastPositionUpdate.current.lon,
              latitude,
              longitude
            );
            positionChanged = distance >= MIN_POSITION_CHANGE_M;
          }

          // Calculate COG from movement if not provided by GPS
          let course = heading;
          if (course === null || course === -1) {
            if (positionChanged && previousPosition.current) {
              const timeDiff = timestamp - previousPosition.current.time;
              if (timeDiff > 0 && timeDiff < 10000) {
                course = calculateBearing(
                  previousPosition.current.lat,
                  previousPosition.current.lon,
                  latitude,
                  longitude
                );
              }
            }
          }

          // Update previous position for COG calculation
          if (positionChanged) {
            previousPosition.current = { lat: latitude, lon: longitude, time: timestamp };
            lastPositionUpdate.current = { lat: latitude, lon: longitude };
          }

          const speedVal = speed ?? null;
          const courseVal = course ?? null;

          // Update ref immediately — no React re-render
          updateRef(prev => ({
            ...prev,
            latitude,
            longitude,
            altitude,
            speed: speedVal,
            speedKnots: speedVal !== null ? speedVal * MS_TO_KNOTS : null,
            course: courseVal,
            accuracy,
            timestamp,
            isTracking: true,
            error: null,
          }));
        }
      );

      updateRef(prev => ({ ...prev, isTracking: true }));
      // Immediate sync so UI shows tracking started
      setGpsData({ ...gpsDataRef.current });
    } catch (error) {
      updateRef(prev => ({
        ...prev,
        isTracking: false,
        error: 'Failed to start location tracking',
      }));
      setGpsData({ ...gpsDataRef.current });
    }
  }, [requestPermissions, distanceInterval, timeInterval, calculateBearing, calculateDistance, updateRef]);

  // Stop tracking
  const stopTracking = useCallback(() => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
    previousPosition.current = null;
    lastPositionUpdate.current = null;

    updateRef(prev => ({
      ...prev,
      isTracking: false,
    }));
    setGpsData({ ...gpsDataRef.current });
  }, [updateRef]);

  // Toggle tracking
  const toggleTracking = useCallback(() => {
    if (gpsDataRef.current.isTracking) {
      stopTracking();
    } else {
      startTracking();
    }
  }, [startTracking, stopTracking]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (locationSubscription.current) {
        locationSubscription.current.remove();
      }
    };
  }, []);

  return {
    gpsData,        // Display state — synced every 2s, safe for rendering
    gpsDataRef,     // Live ref — always current, no re-renders
    startTracking,
    stopTracking,
    toggleTracking,
    requestPermissions,
    updateHeading,
  };
}

// Utility functions for formatting GPS data
export function formatSpeed(speedKnots: number | null): string {
  if (speedKnots === null) return '--';
  return `${speedKnots.toFixed(1)} kn`;
}

export function formatHeading(heading: number | null): string {
  if (heading === null) return '--°';
  return `${Math.round(heading)}°`;
}

export function formatCourse(course: number | null): string {
  if (course === null) return '--°';
  return `${Math.round(course)}°`;
}

export function formatAccuracy(accuracy: number | null): string {
  if (accuracy === null) return '--';
  if (accuracy < 10) return `${accuracy.toFixed(1)}m`;
  return `${Math.round(accuracy)}m`;
}

export function formatCoordinate(value: number | null, isLatitude: boolean): string {
  if (value === null) return '--';
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  const dir = isLatitude ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
  return `${deg}°${min.toFixed(3)}'${dir}`;
}

/**
 * useGPS Hook - Manages GPS location tracking
 * 
 * Provides:
 * - Current position (lat/lon)
 * - Speed (from GPS)
 * - Course Over Ground (COG) - direction of travel
 * - Accuracy
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

export function useGPS(options: UseGPSOptions = {}) {
  const {
    distanceInterval = 5,      // Update every 5 meters
    timeInterval = 1000,       // Or every 1 second
  } = options;

  const [gpsData, setGpsData] = useState<GPSData>({
    latitude: null,
    longitude: null,
    altitude: null,
    speed: null,
    speedKnots: null,
    course: null,
    heading: null,  // Now set externally
    accuracy: null,
    timestamp: null,
    isTracking: false,
    hasPermission: false,
    error: null,
  });

  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const previousPosition = useRef<{ lat: number; lon: number; time: number } | null>(null);
  const lastPositionUpdate = useRef<{ lat: number; lon: number } | null>(null);
  const MIN_POSITION_CHANGE_M = 1; // Minimum meters change to trigger position update

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
        setGpsData(prev => ({
          ...prev,
          hasPermission: false,
          error: 'Location permission denied',
        }));
        return false;
      }

      setGpsData(prev => ({
        ...prev,
        hasPermission: true,
        error: null,
      }));
      return true;
    } catch (error) {
      setGpsData(prev => ({
        ...prev,
        hasPermission: false,
        error: 'Failed to request location permissions',
      }));
      return false;
    }
  }, []);

  // Update heading from external source (useDeviceHeading)
  const updateHeading = useCallback((heading: number | null) => {
    setGpsData(prev => ({
      ...prev,
      heading,
    }));
  }, []);

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

          // Check if position changed enough to warrant an update
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

          // Skip update if position hasn't changed significantly
          if (!positionChanged) return;

          // Calculate COG from movement if not provided by GPS
          let course = heading;
          if (course === null || course === -1) {
            if (previousPosition.current) {
              const timeDiff = timestamp - previousPosition.current.time;
              if (timeDiff > 0 && timeDiff < 10000) { // Within 10 seconds
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
          previousPosition.current = { lat: latitude, lon: longitude, time: timestamp };
          lastPositionUpdate.current = { lat: latitude, lon: longitude };

          setGpsData(prev => ({
            ...prev,
            latitude,
            longitude,
            altitude,
            speed: speed ?? null,
            speedKnots: speed !== null ? speed * MS_TO_KNOTS : null,
            course: course ?? null,
            accuracy,
            timestamp,
            isTracking: true,
            error: null,
          }));
        }
      );

      setGpsData(prev => ({ ...prev, isTracking: true }));
    } catch (error) {
      setGpsData(prev => ({
        ...prev,
        isTracking: false,
        error: 'Failed to start location tracking',
      }));
    }
  }, [requestPermissions, distanceInterval, timeInterval, calculateBearing, calculateDistance]);

  // Stop tracking
  const stopTracking = useCallback(() => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
    previousPosition.current = null;
    lastPositionUpdate.current = null;

    setGpsData(prev => ({
      ...prev,
      isTracking: false,
    }));
  }, []);

  // Toggle tracking
  const toggleTracking = useCallback(() => {
    if (gpsData.isTracking) {
      stopTracking();
    } else {
      startTracking();
    }
  }, [gpsData.isTracking, startTracking, stopTracking]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (locationSubscription.current) {
        locationSubscription.current.remove();
      }
    };
  }, []);

  return {
    gpsData,
    startTracking,
    stopTracking,
    toggleTracking,
    requestPermissions,
    updateHeading,  // Allow external heading updates
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

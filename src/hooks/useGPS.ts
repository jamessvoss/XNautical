/**
 * useGPS Hook - Manages GPS location and device heading tracking
 * 
 * Provides:
 * - Current position (lat/lon)
 * - Speed (from GPS)
 * - Course Over Ground (COG) - direction of travel
 * - Heading (from device magnetometer)
 * - Accuracy
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
  
  // Device orientation
  heading: number | null;      // Magnetic heading from device compass
  
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
  enableHeading?: boolean;     // Whether to track device heading
}

const MS_TO_KNOTS = 1.94384;

export function useGPS(options: UseGPSOptions = {}) {
  const {
    distanceInterval = 5,      // Update every 5 meters
    timeInterval = 1000,       // Or every 1 second
    enableHeading = true,
  } = options;

  const [gpsData, setGpsData] = useState<GPSData>({
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
  });

  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const headingSubscription = useRef<Location.LocationSubscription | null>(null);
  const previousPosition = useRef<{ lat: number; lon: number; time: number } | null>(null);
  const lastHeadingUpdate = useRef<number>(0);
  const HEADING_THROTTLE_MS = 200; // Limit heading updates to 5 times per second

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

      // Start heading updates (magnetometer) - throttled
      if (enableHeading) {
        headingSubscription.current = await Location.watchHeadingAsync((headingData) => {
          const now = Date.now();
          // Throttle updates to reduce jitter
          if (now - lastHeadingUpdate.current >= HEADING_THROTTLE_MS) {
            lastHeadingUpdate.current = now;
            setGpsData(prev => ({
              ...prev,
              heading: headingData.magHeading, // Magnetic heading
            }));
          }
        });
      }

      setGpsData(prev => ({ ...prev, isTracking: true }));
    } catch (error) {
      setGpsData(prev => ({
        ...prev,
        isTracking: false,
        error: 'Failed to start location tracking',
      }));
    }
  }, [requestPermissions, distanceInterval, timeInterval, enableHeading, calculateBearing]);

  // Stop tracking
  const stopTracking = useCallback(() => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
    if (headingSubscription.current) {
      headingSubscription.current.remove();
      headingSubscription.current = null;
    }
    previousPosition.current = null;

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
      if (headingSubscription.current) {
        headingSubscription.current.remove();
      }
    };
  }, []);

  return {
    gpsData,
    startTracking,
    stopTracking,
    toggleTracking,
    requestPermissions,
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

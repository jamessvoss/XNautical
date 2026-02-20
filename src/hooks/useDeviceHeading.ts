/**
 * useDeviceHeading Hook - Smooth compass heading using sensor fusion
 * 
 * Uses expo-sensors DeviceMotion API which provides fused orientation:
 * - iOS: CoreMotion's CMDeviceMotion (gyro + accel + mag fusion)
 * - Android: TYPE_ROTATION_VECTOR (hardware sensor fusion)
 * 
 * Features:
 * - 60Hz update rate for smooth animation
 * - Shortest-path rotation (handles 359° → 1° wrap-around)
 * - Lightweight LERP smoothing (removes micro-jitter without lag)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { DeviceMotion, DeviceMotionMeasurement } from 'expo-sensors';
import { Platform } from 'react-native';

export interface DeviceHeadingData {
  heading: number | null;           // Smoothed magnetic heading (0-360°)
  rawHeading: number | null;        // Unsmoothed heading for debugging
  accuracy: 'high' | 'medium' | 'low' | 'unknown';
  isAvailable: boolean;
  error: string | null;
}

interface UseDeviceHeadingOptions {
  updateInterval?: number;  // ms between updates (default: 16ms = ~60Hz)
  lerpFactor?: number;      // Smoothing factor 0-1 (default: 0.2)
  enabled?: boolean;        // Whether to subscribe to sensor updates
}

// Default 60Hz for smooth UI updates
const DEFAULT_UPDATE_INTERVAL = 16;

// LERP factor: 0.2 gives good balance of smooth vs responsive
// Lower = smoother but laggier, Higher = more responsive but jittery
const DEFAULT_LERP_FACTOR = 0.2;

/**
 * Calculate the shortest rotation path between two angles.
 * Handles the 359° → 1° wrap-around case.
 * 
 * @param from Current angle in degrees
 * @param to Target angle in degrees
 * @returns Adjusted target that takes the shortest path
 */
function shortestRotationTarget(from: number, to: number): number {
  // Normalize delta to -180 to +180 range
  let delta = ((to - from + 540) % 360) - 180;
  return from + delta;
}

/**
 * Linear interpolation with shortest-path rotation handling.
 * 
 * @param current Current smoothed value
 * @param target Raw target value
 * @param factor Interpolation factor (0-1)
 * @returns Smoothed value
 */
function lerpHeading(current: number, target: number, factor: number): number {
  const adjustedTarget = shortestRotationTarget(current, target);
  const result = current + (adjustedTarget - current) * factor;
  // Normalize back to 0-360 range
  return ((result % 360) + 360) % 360;
}

/**
 * Convert DeviceMotion rotation to compass heading.
 * 
 * DeviceMotion provides rotation in device frame:
 * - alpha: rotation around Z axis (yaw) - this is our heading
 * - beta: rotation around X axis (pitch)
 * - gamma: rotation around Y axis (roll)
 * 
 * On iOS, alpha is relative to true north when available.
 * On Android, alpha is relative to magnetic north.
 */
function rotationToHeading(rotation: DeviceMotionMeasurement['rotation']): number {
  if (!rotation) return 0;
  
  // Alpha is in radians, represents yaw/heading
  // Convert to degrees and normalize to 0-360
  let heading = rotation.alpha * (180 / Math.PI);
  
  // DeviceMotion alpha is typically the compass heading directly
  // but may need platform-specific adjustments
  if (Platform.OS === 'ios') {
    // iOS: alpha is clockwise from north
    heading = (360 - heading) % 360;
  } else {
    // Android: alpha may already be correct, normalize just in case
    heading = ((heading % 360) + 360) % 360;
  }
  
  return heading;
}

export function useDeviceHeading(options: UseDeviceHeadingOptions = {}) {
  const {
    updateInterval = DEFAULT_UPDATE_INTERVAL,
    lerpFactor = DEFAULT_LERP_FACTOR,
    enabled = true,
  } = options;

  const [headingData, setHeadingData] = useState<DeviceHeadingData>({
    heading: null,
    rawHeading: null,
    accuracy: 'unknown',
    isAvailable: false,
    error: null,
  });

  // Refs for smoothing state (don't trigger re-renders)
  const smoothedHeadingRef = useRef<number | null>(null);
  const subscriptionRef = useRef<{ remove: () => void } | null>(null);
  const isFirstReadingRef = useRef(true);



  // Check availability on mount
  useEffect(() => {
    let mounted = true;
    
    DeviceMotion.isAvailableAsync().then((available) => {
      if (mounted) {
        setHeadingData(prev => ({
          ...prev,
          isAvailable: available,
          error: available ? null : 'DeviceMotion not available on this device',
        }));
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  // Subscribe to DeviceMotion updates
  useEffect(() => {
    if (!enabled || !headingData.isAvailable) {
      return;
    }

    // Set update interval for ~60Hz
    DeviceMotion.setUpdateInterval(updateInterval);

    // Subscribe to sensor updates
    subscriptionRef.current = DeviceMotion.addListener((data: DeviceMotionMeasurement) => {
      if (!data.rotation) {
        return;
      }

      const rawHeading = rotationToHeading(data.rotation);

      // Apply LERP smoothing
      let smoothedHeading: number;
      if (isFirstReadingRef.current || smoothedHeadingRef.current === null) {
        // First reading: use raw value directly
        smoothedHeading = rawHeading;
        isFirstReadingRef.current = false;
      } else {
        // Subsequent readings: LERP towards new value
        smoothedHeading = lerpHeading(
          smoothedHeadingRef.current,
          rawHeading,
          lerpFactor
        );
      }

      smoothedHeadingRef.current = smoothedHeading;


      // Update state (this triggers re-render in consuming component)
      setHeadingData(prev => ({
        ...prev,
        heading: Math.round(smoothedHeading * 10) / 10, // Round to 1 decimal
        rawHeading: Math.round(rawHeading * 10) / 10,
        accuracy: 'high', // Sensor fusion typically provides high accuracy
      }));
    });

    // Cleanup subscription
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }
    };
  }, [enabled, headingData.isAvailable, updateInterval, lerpFactor]);

  // Reset smoothing state when disabled
  useEffect(() => {
    if (!enabled) {
      smoothedHeadingRef.current = null;
      isFirstReadingRef.current = true;
    }
  }, [enabled]);

  // Manual refresh/calibration hint
  const resetSmoothing = useCallback(() => {
    smoothedHeadingRef.current = null;
    isFirstReadingRef.current = true;
  }, []);

  return {
    ...headingData,
    resetSmoothing,
  };
}

// Re-export types for convenience
export type { UseDeviceHeadingOptions };

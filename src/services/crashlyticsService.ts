/**
 * Crashlytics Service
 * Wrapper for Firebase Crashlytics to handle platform differences
 * Uses the modular API (React Native Firebase v22+)
 * 
 * Note: v22 modular API requires passing crashlytics instance as first param
 */

import { Platform } from 'react-native';

// Crashlytics instance (required as first param for modular API)
let crashlyticsInstance: any = null;

// Modular API imports (functions take crashlytics instance as first param)
let crashlyticsModule: {
  log: (crashlytics: any, message: string) => void;
  recordError: (crashlytics: any, error: Error) => void;
  setAttribute: (crashlytics: any, key: string, value: string) => void;
  setAttributes: (crashlytics: any, attributes: Record<string, string>) => void;
  setUserId: (crashlytics: any, userId: string) => void;
  crash: (crashlytics: any) => void;
} | null = null;

if (Platform.OS !== 'web') {
  try {
    // Import the modular functions directly
    const rnfbCrashlytics = require('@react-native-firebase/crashlytics');
    crashlyticsInstance = rnfbCrashlytics.getCrashlytics();
    crashlyticsModule = {
      log: rnfbCrashlytics.log,
      recordError: rnfbCrashlytics.recordError,
      setAttribute: rnfbCrashlytics.setAttribute,
      setAttributes: rnfbCrashlytics.setAttributes,
      setUserId: rnfbCrashlytics.setUserId,
      crash: rnfbCrashlytics.crash,
    };
  } catch (e) {
    console.log('Crashlytics not available');
  }
}

/**
 * Log a message to Crashlytics (shows in crash reports)
 */
export function log(message: string): void {
  if (crashlyticsModule && crashlyticsInstance) {
    crashlyticsModule.log(crashlyticsInstance, message);
  }
  // Also log to console in development
  if (__DEV__) {
    console.log('[Crashlytics]', message);
  }
}

/**
 * Record a non-fatal error
 */
export function recordError(error: Error, context?: string): void {
  if (crashlyticsModule && crashlyticsInstance) {
    if (context) {
      crashlyticsModule.log(crashlyticsInstance, context);
    }
    crashlyticsModule.recordError(crashlyticsInstance, error);
  }
  console.error('[Crashlytics Error]', context || '', error);
}

/**
 * Set a custom key-value pair for crash reports
 */
export function setAttribute(key: string, value: string): void {
  if (crashlyticsModule && crashlyticsInstance) {
    crashlyticsModule.setAttribute(crashlyticsInstance, key, value);
  }
}

/**
 * Set multiple attributes at once
 */
export function setAttributes(attributes: Record<string, string>): void {
  if (crashlyticsModule && crashlyticsInstance) {
    crashlyticsModule.setAttributes(crashlyticsInstance, attributes);
  }
}

/**
 * Set the user ID for crash attribution
 */
export function setUserId(userId: string): void {
  if (crashlyticsModule && crashlyticsInstance) {
    crashlyticsModule.setUserId(crashlyticsInstance, userId);
  }
}

/**
 * Force a crash (for testing - use only in development!)
 */
export function testCrash(): void {
  if (crashlyticsModule && crashlyticsInstance && __DEV__) {
    console.warn('Forcing test crash...');
    crashlyticsModule.crash(crashlyticsInstance);
  }
}

/**
 * Check if Crashlytics is available
 */
export function isAvailable(): boolean {
  return crashlyticsModule !== null && crashlyticsInstance !== null;
}

export default {
  log,
  recordError,
  setAttribute,
  setAttributes,
  setUserId,
  testCrash,
  isAvailable,
};

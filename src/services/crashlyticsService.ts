/**
 * Crashlytics Service
 * Wrapper for Firebase Crashlytics to handle platform differences
 */

import { Platform } from 'react-native';

let crashlytics: any = null;

if (Platform.OS !== 'web') {
  try {
    crashlytics = require('@react-native-firebase/crashlytics').default;
  } catch (e) {
    console.log('Crashlytics not available');
  }
}

/**
 * Log a message to Crashlytics (shows in crash reports)
 */
export function log(message: string): void {
  if (crashlytics) {
    crashlytics().log(message);
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
  if (crashlytics) {
    if (context) {
      crashlytics().log(context);
    }
    crashlytics().recordError(error);
  }
  console.error('[Crashlytics Error]', context || '', error);
}

/**
 * Set a custom key-value pair for crash reports
 */
export function setAttribute(key: string, value: string): void {
  if (crashlytics) {
    crashlytics().setAttribute(key, value);
  }
}

/**
 * Set multiple attributes at once
 */
export function setAttributes(attributes: Record<string, string>): void {
  if (crashlytics) {
    crashlytics().setAttributes(attributes);
  }
}

/**
 * Set the user ID for crash attribution
 */
export function setUserId(userId: string): void {
  if (crashlytics) {
    crashlytics().setUserId(userId);
  }
}

/**
 * Force a crash (for testing - use only in development!)
 */
export function testCrash(): void {
  if (crashlytics && __DEV__) {
    console.warn('Forcing test crash...');
    crashlytics().crash();
  }
}

/**
 * Check if Crashlytics is available
 */
export function isAvailable(): boolean {
  return crashlytics !== null;
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

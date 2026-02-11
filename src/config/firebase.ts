import { initializeApp } from 'firebase/app';
import { getStorage } from 'firebase/storage';
import { getFirestore } from 'firebase/firestore';
// @ts-ignore getReactNativePersistence exists at runtime but may be missing from types
import { initializeAuth, getReactNativePersistence, getAuth as getExistingAuth } from 'firebase/auth';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// XNautical Firebase configuration
// Values loaded from environment variables (.env file)
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase JS SDK (for Storage - still needed for file downloads)
const app = initializeApp(firebaseConfig);

// Initialize JS SDK Auth with AsyncStorage persistence FIRST (before Storage/Firestore)
// This ensures auth is initialized with persistence before anything else touches it
let jsAuth;
try {
  jsAuth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage)
  });
  console.log('[FIREBASE] Auth initialized with AsyncStorage persistence');
} catch (error: any) {
  if (error.code === 'auth/already-initialized') {
    console.log('[FIREBASE] Auth already initialized, using existing instance');
    jsAuth = getExistingAuth(app);
  } else {
    console.error('[FIREBASE] Auth initialization error:', error);
    throw error;
  }
}

// Initialize Storage for chart GeoJSON files
const storage = getStorage(app);

// Initialize Firestore for tide/current data
const firestore = getFirestore(app);

// Native Firebase Auth - modular API (React Native Firebase v22+)
let nativeAuthInstance: any = null;
let onAuthStateChangedFn: ((auth: any, callback: (user: any) => void) => () => void) | null = null;

if (Platform.OS !== 'web') {
  try {
    const rnfbAuth = require('@react-native-firebase/auth');
    nativeAuthInstance = rnfbAuth.getAuth();
    onAuthStateChangedFn = rnfbAuth.onAuthStateChanged;
    
    // Sync native auth state to JS SDK auth for Firestore
    onAuthStateChangedFn!(nativeAuthInstance, async (user: any) => {
      if (user) {
        console.log('Native auth user detected, syncing to JS SDK...');
        try {
          // Get the ID token using the modular API
          const token = await rnfbAuth.getIdToken(user);
          console.log('User authenticated in native SDK:', user.email);
        } catch (e) {
          console.error('Error syncing auth:', e);
        }
      }
    });
  } catch (e) {
    console.log('Native Firebase Auth not available');
  }
}

// Keep nativeAuth for backward compatibility
const nativeAuth = nativeAuthInstance ? { currentUser: nativeAuthInstance.currentUser } : null;

// Type for Firebase User from native SDK
export interface NativeFirebaseUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  phoneNumber: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}

/**
 * Get current user from native auth
 */
export function getCurrentUser(): NativeFirebaseUser | null {
  if (nativeAuthInstance) {
    return nativeAuthInstance.currentUser;
  }
  return null;
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  if (nativeAuthInstance) {
    return nativeAuthInstance.currentUser !== null;
  }
  return false;
}

/**
 * Wait for auth to be ready
 */
export function waitForAuth(): Promise<NativeFirebaseUser | null> {
  console.log('waitForAuth called');
  
  if (!nativeAuthInstance || !onAuthStateChangedFn) {
    console.log('Native auth not available');
    return Promise.resolve(null);
  }
  
  const currentUser = nativeAuthInstance.currentUser;
  if (currentUser) {
    console.log('waitForAuth: Already authenticated as', currentUser.email);
    return Promise.resolve(currentUser);
  }
  
  // Wait for the auth state to be determined
  return new Promise((resolve) => {
    console.log('waitForAuth: Waiting for auth state...');
    
    const unsubscribe = onAuthStateChangedFn!(nativeAuthInstance, (user: NativeFirebaseUser | null) => {
      console.log('waitForAuth: Auth state changed to:', user?.email || 'null');
      unsubscribe();
      resolve(user);
    });
    
    // Timeout after 5 seconds
    setTimeout(() => {
      console.log('waitForAuth: Timeout, resolving with current user');
      unsubscribe();
      resolve(nativeAuthInstance.currentUser);
    }, 5000);
  });
}

/**
 * Get the native auth instance
 */
export function getAuth() {
  if (!nativeAuthInstance) {
    throw new Error('Native Firebase Auth not available');
  }
  return nativeAuthInstance;
}

export { app, storage, firestore, jsAuth, nativeAuth };

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { Platform } from 'react-native';

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

// Initialize Firebase JS SDK (for Firestore and Storage)
const app = initializeApp(firebaseConfig);

// Initialize Firestore for chart metadata
const db = getFirestore(app);

// Initialize Storage for chart GeoJSON files
const storage = getStorage(app);

// Native Firebase Auth (only on native platforms)
let nativeAuth: any = null;
if (Platform.OS !== 'web') {
  try {
    nativeAuth = require('@react-native-firebase/auth').default;
  } catch (e) {
    console.log('Native Firebase Auth not available');
  }
}

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
  if (nativeAuth) {
    return nativeAuth().currentUser;
  }
  return null;
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  if (nativeAuth) {
    return nativeAuth().currentUser !== null;
  }
  return false;
}

/**
 * Wait for auth to be ready
 */
export function waitForAuth(): Promise<NativeFirebaseUser | null> {
  console.log('waitForAuth called');
  
  if (!nativeAuth) {
    console.log('Native auth not available');
    return Promise.resolve(null);
  }
  
  const currentUser = nativeAuth().currentUser;
  if (currentUser) {
    console.log('waitForAuth: Already authenticated as', currentUser.email);
    return Promise.resolve(currentUser);
  }
  
  // Wait for the auth state to be determined
  return new Promise((resolve) => {
    console.log('waitForAuth: Waiting for auth state...');
    
    const unsubscribe = nativeAuth().onAuthStateChanged((user: NativeFirebaseUser | null) => {
      console.log('waitForAuth: Auth state changed to:', user?.email || 'null');
      unsubscribe();
      resolve(user);
    });
    
    // Timeout after 5 seconds
    setTimeout(() => {
      console.log('waitForAuth: Timeout, resolving with current user');
      unsubscribe();
      resolve(nativeAuth().currentUser);
    }, 5000);
  });
}

/**
 * Get the native auth instance
 */
export function getAuth() {
  if (!nativeAuth) {
    throw new Error('Native Firebase Auth not available');
  }
  return nativeAuth();
}

export { app, db, storage, nativeAuth };

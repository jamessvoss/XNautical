import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { onAuthStateChanged, User } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Import React Native specific auth functions
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { initializeAuth, getReactNativePersistence } = require('@firebase/auth/dist/rn/index.js');

// Alaska Fishtopia Firebase configuration (shared with FishTopia app)
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

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Auth with AsyncStorage persistence
const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage)
});

// Initialize Firestore for chart metadata
const db = getFirestore(app);

// Initialize Storage for chart GeoJSON files
const storage = getStorage(app);

// Auth state tracking
let currentUser: User | null = null;
let authResolvers: Array<(user: User | null) => void> = [];

// Listen for auth state changes
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  console.log('Auth state changed:', user ? `Logged in as ${user.email} (uid: ${user.uid})` : 'Logged out');
  
  // Resolve any waiting promises
  authResolvers.forEach(resolve => resolve(user));
  authResolvers = [];
});

/**
 * Get current user (throws if not authenticated)
 */
export function getCurrentUser(): User {
  if (!currentUser) {
    throw new Error('User not authenticated');
  }
  return currentUser;
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return currentUser !== null;
}

/**
 * Wait for auth to be ready (waits for first auth state)
 */
export function waitForAuth(): Promise<User | null> {
  console.log('waitForAuth called, currentUser:', currentUser?.email || 'null');
  
  // If we already have a user, return immediately
  if (currentUser !== null) {
    console.log('waitForAuth: Already authenticated as', currentUser.email);
    return Promise.resolve(currentUser);
  }
  
  // Check auth.currentUser directly as backup
  const directUser = auth.currentUser;
  if (directUser) {
    console.log('waitForAuth: Found user via auth.currentUser:', directUser.email);
    currentUser = directUser;
    return Promise.resolve(directUser);
  }
  
  // Wait for the next auth state change
  return new Promise((resolve) => {
    console.log('waitForAuth: Waiting for auth state change...');
    
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log('waitForAuth: Auth state changed to:', user?.email || 'null');
      unsubscribe();
      currentUser = user;
      resolve(user);
    });
    
    // Timeout after 5 seconds
    setTimeout(() => {
      console.log('waitForAuth: Timeout, resolving with:', currentUser?.email || auth.currentUser?.email || 'null');
      unsubscribe();
      resolve(currentUser || auth.currentUser);
    }, 5000);
  });
}

export { app, auth, db, storage };

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { onAuthStateChanged, User } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Import React Native specific auth functions
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { initializeAuth, getReactNativePersistence } = require('@firebase/auth/dist/rn/index.js');

// Alaska Fishtopia Firebase configuration (shared with FishTopia app)
const firebaseConfig = {
  apiKey: "AIzaSyAUouZuXj1TpVpldvG4YlD1diPZZRwhYzM",
  authDomain: "alaska-fishtopia.firebaseapp.com",
  databaseURL: "https://alaska-fishtopia-default-rtdb.firebaseio.com",
  projectId: "alaska-fishtopia",
  storageBucket: "alaska-fishtopia.firebasestorage.app",
  messagingSenderId: "411186688461",
  appId: "1:411186688461:web:0f38f22eb9454a21bb9484",
  measurementId: "G-W3L0R35PX6"
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

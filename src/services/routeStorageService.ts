/**
 * Route Storage Service
 * 
 * Manages route persistence with dual storage strategy:
 * - Firestore: users/{userId}/routes/{routeId} for cloud-synced routes
 * - AsyncStorage: @XNautical:routes for local-only routes
 * 
 * Features:
 * - Supports both cloud and local storage based on route preferences
 * - Automatic offline persistence (Firestore native SDK + AsyncStorage)
 * - Real-time sync via onSnapshot for cloud routes
 * - Conflict resolution (last-write-wins with timestamp)
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Route, RouteCreateData } from '../types/route';

// Native Firestore SDK (same pattern as waypointService)
let firestoreDb: any = null;
let firestoreFns: {
  collection: (db: any, ...pathSegments: string[]) => any;
  doc: (db: any | any, ...pathSegments: string[]) => any;
  setDoc: (docRef: any, data: any, options?: any) => Promise<void>;
  deleteDoc: (docRef: any) => Promise<void>;
  onSnapshot: (query: any, callback: (snapshot: any) => void, errorCallback?: (error: any) => void) => () => void;
  writeBatch: (db: any) => any;
  orderBy: (field: string, direction?: string) => any;
  query: (collectionRef: any, ...constraints: any[]) => any;
} | null = null;

if (Platform.OS !== 'web') {
  try {
    const rnfbFirestore = require('@react-native-firebase/firestore');
    firestoreDb = rnfbFirestore.getFirestore();
    firestoreFns = {
      collection: rnfbFirestore.collection,
      doc: rnfbFirestore.doc,
      setDoc: rnfbFirestore.setDoc,
      deleteDoc: rnfbFirestore.deleteDoc,
      onSnapshot: rnfbFirestore.onSnapshot,
      writeBatch: rnfbFirestore.writeBatch,
      orderBy: rnfbFirestore.orderBy,
      query: rnfbFirestore.query,
    };
  } catch (e) {
    console.warn('[RouteStorageService] Native Firestore not available');
  }
}

const LOCAL_ROUTES_KEY = '@XNautical:routes';

/**
 * Generate a unique route ID
 */
export function generateRouteId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `route_${timestamp}_${random}`;
}

/**
 * Get the routes collection reference for a user (Firestore)
 */
function getRoutesCollection(userId: string) {
  if (!firestoreDb || !firestoreFns) {
    throw new Error('Firestore not available');
  }
  return firestoreFns.collection(firestoreDb, 'users', userId, 'routes');
}

/**
 * Get a route document reference (Firestore)
 */
function getRouteDoc(userId: string, routeId: string) {
  if (!firestoreDb || !firestoreFns) {
    throw new Error('Firestore not available');
  }
  return firestoreFns.doc(firestoreDb, 'users', userId, 'routes', routeId);
}

// ========== FIRESTORE (CLOUD) OPERATIONS ==========

/**
 * Subscribe to real-time route updates for a user (cloud routes only).
 * Returns an unsubscribe function.
 */
export function subscribeToCloudRoutes(
  userId: string,
  callback: (routes: Route[]) => void,
  onError?: (error: any) => void,
): () => void {
  if (!firestoreDb || !firestoreFns) {
    console.warn('[RouteStorageService] Firestore not available');
    callback([]);
    return () => {};
  }

  try {
    const collectionRef = getRoutesCollection(userId);
    const q = firestoreFns.query(
      collectionRef,
      firestoreFns.orderBy('updatedAt', 'desc')
    );

    const unsubscribe = firestoreFns.onSnapshot(
      q,
      (snapshot: any) => {
        const routes: Route[] = [];
        snapshot.forEach((doc: any) => {
          const data = doc.data();
          if (data) {
            routes.push({
              id: doc.id,
              ...data,
            } as Route);
          }
        });
        callback(routes);
      },
      (error: any) => {
        console.error('[RouteStorageService] Snapshot error:', error);
        if (onError) onError(error);
      }
    );

    return unsubscribe;
  } catch (error) {
    console.error('[RouteStorageService] Subscribe error:', error);
    if (onError) onError(error);
    return () => {};
  }
}

/**
 * Save route to Firestore (cloud)
 */
export async function saveRouteToCloud(userId: string, route: Route): Promise<void> {
  if (!firestoreDb || !firestoreFns) {
    throw new Error('Firestore not available - cannot save to cloud');
  }

  try {
    const docRef = getRouteDoc(userId, route.id);
    await firestoreFns.setDoc(docRef, {
      ...route,
      updatedAt: new Date().toISOString(),
    });
    console.log(`[RouteStorageService] Saved route ${route.id} to cloud`);
  } catch (error) {
    console.error('[RouteStorageService] Error saving to cloud:', error);
    throw error;
  }
}

/**
 * Delete route from Firestore (cloud)
 */
export async function deleteRouteFromCloud(userId: string, routeId: string): Promise<void> {
  if (!firestoreDb || !firestoreFns) {
    throw new Error('Firestore not available - cannot delete from cloud');
  }

  try {
    const docRef = getRouteDoc(userId, routeId);
    await firestoreFns.deleteDoc(docRef);
    console.log(`[RouteStorageService] Deleted route ${routeId} from cloud`);
  } catch (error) {
    console.error('[RouteStorageService] Error deleting from cloud:', error);
    throw error;
  }
}

// ========== ASYNC STORAGE (LOCAL) OPERATIONS ==========

/**
 * Get all local routes from AsyncStorage
 */
export async function getLocalRoutes(): Promise<Route[]> {
  try {
    const json = await AsyncStorage.getItem(LOCAL_ROUTES_KEY);
    if (!json) return [];
    
    const routes = JSON.parse(json) as Route[];
    return routes.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  } catch (error) {
    console.error('[RouteStorageService] Error reading local routes:', error);
    return [];
  }
}

/**
 * Save route to AsyncStorage (local)
 */
export async function saveRouteToLocal(route: Route): Promise<void> {
  try {
    const routes = await getLocalRoutes();
    
    // Update existing or add new
    const existingIndex = routes.findIndex(r => r.id === route.id);
    if (existingIndex >= 0) {
      routes[existingIndex] = {
        ...route,
        updatedAt: new Date().toISOString(),
      };
    } else {
      routes.push({
        ...route,
        updatedAt: new Date().toISOString(),
      });
    }

    await AsyncStorage.setItem(LOCAL_ROUTES_KEY, JSON.stringify(routes));
    console.log(`[RouteStorageService] Saved route ${route.id} to local storage`);
  } catch (error) {
    console.error('[RouteStorageService] Error saving to local:', error);
    throw error;
  }
}

/**
 * Delete route from AsyncStorage (local)
 */
export async function deleteRouteFromLocal(routeId: string): Promise<void> {
  try {
    const routes = await getLocalRoutes();
    const filtered = routes.filter(r => r.id !== routeId);
    await AsyncStorage.setItem(LOCAL_ROUTES_KEY, JSON.stringify(filtered));
    console.log(`[RouteStorageService] Deleted route ${routeId} from local storage`);
  } catch (error) {
    console.error('[RouteStorageService] Error deleting from local:', error);
    throw error;
  }
}

/**
 * Clear all local routes (use with caution)
 */
export async function clearLocalRoutes(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LOCAL_ROUTES_KEY);
    console.log('[RouteStorageService] Cleared all local routes');
  } catch (error) {
    console.error('[RouteStorageService] Error clearing local routes:', error);
    throw error;
  }
}

// ========== UNIFIED OPERATIONS (HANDLES BOTH STORAGE TYPES) ==========

/**
 * Save route based on its storageType preference
 */
export async function saveRoute(userId: string, route: Route): Promise<void> {
  const { storageType } = route;

  if (storageType === 'cloud' || storageType === 'both') {
    await saveRouteToCloud(userId, route);
  }

  if (storageType === 'local' || storageType === 'both') {
    await saveRouteToLocal(route);
  }
}

/**
 * Delete route from appropriate storage(s)
 */
export async function deleteRoute(userId: string, route: Route): Promise<void> {
  const { storageType, id } = route;

  if (storageType === 'cloud' || storageType === 'both') {
    await deleteRouteFromCloud(userId, id);
  }

  if (storageType === 'local' || storageType === 'both') {
    await deleteRouteFromLocal(id);
  }
}

/**
 * Get all routes (both cloud and local)
 * Note: Cloud routes should be managed via subscribeToCloudRoutes
 * This is a one-time fetch, mainly for local routes.
 */
export async function getAllRoutes(userId: string): Promise<Route[]> {
  const localRoutes = await getLocalRoutes();
  
  // For cloud routes, recommend using subscribeToCloudRoutes instead
  // This is just a fallback for one-time reads
  const cloudRoutes: Route[] = [];
  
  return [...cloudRoutes, ...localRoutes];
}

/**
 * Migrate a route from one storage type to another
 */
export async function migrateRoute(
  userId: string,
  route: Route,
  newStorageType: 'cloud' | 'local' | 'both'
): Promise<Route> {
  const oldStorageType = route.storageType;
  const updatedRoute = {
    ...route,
    storageType: newStorageType,
    updatedAt: new Date().toISOString(),
  };

  // Save to new storage
  await saveRoute(userId, updatedRoute);

  // Remove from old storage if needed
  if (oldStorageType === 'cloud' && newStorageType === 'local') {
    await deleteRouteFromCloud(userId, route.id);
  } else if (oldStorageType === 'local' && newStorageType === 'cloud') {
    await deleteRouteFromLocal(route.id);
  }

  return updatedRoute;
}

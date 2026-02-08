/**
 * Waypoint Service
 * 
 * Manages waypoint CRUD operations using the React Native Firebase native SDK.
 * Data stored at: users/{userId}/waypoints/{waypointId}
 * 
 * Features:
 * - Automatic offline persistence (native SDK caches to device SQLite)
 * - Real-time sync via onSnapshot
 * - In-memory cache for fast synchronous reads
 * - Batch operations for bulk delete
 */

import { Platform } from 'react-native';
import { Waypoint, WaypointCreateData } from '../types/waypoint';

// Native Firestore SDK (same pattern as chartService.ts)
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
    console.log('[WaypointService] Native Firestore SDK initialized');
  } catch (e) {
    console.log('[WaypointService] Native Firestore not available');
  }
}

// In-memory cache populated by onSnapshot listener
let cachedWaypoints: Waypoint[] = [];

/**
 * Generate a unique waypoint ID
 */
export function generateId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `wp_${timestamp}_${random}`;
}

/**
 * Get the waypoints collection reference for a user
 */
function getWaypointsCollection(userId: string) {
  if (!firestoreDb || !firestoreFns) {
    throw new Error('Firestore not available');
  }
  return firestoreFns.collection(firestoreDb, 'users', userId, 'waypoints');
}

/**
 * Get a waypoint document reference
 */
function getWaypointDoc(userId: string, waypointId: string) {
  if (!firestoreDb || !firestoreFns) {
    throw new Error('Firestore not available');
  }
  return firestoreFns.doc(firestoreDb, 'users', userId, 'waypoints', waypointId);
}

/**
 * Subscribe to real-time waypoint updates for a user.
 * Returns an unsubscribe function.
 * 
 * The onSnapshot listener:
 * - Fires immediately with cached data (even offline)
 * - Updates when connectivity restores and server data changes
 * - Populates the in-memory cache
 */
export function subscribeToWaypoints(
  userId: string,
  callback: (waypoints: Waypoint[]) => void,
): () => void {
  if (!firestoreDb || !firestoreFns) {
    console.warn('[WaypointService] Firestore not available, returning empty');
    callback([]);
    return () => {};
  }

  const collectionRef = getWaypointsCollection(userId);
  const q = firestoreFns.query(collectionRef, firestoreFns.orderBy('createdAt', 'desc'));

  const unsubscribe = firestoreFns.onSnapshot(
    q,
    (snapshot: any) => {
      const waypoints: Waypoint[] = [];
      snapshot.forEach((doc: any) => {
        const data = doc.data();
        waypoints.push({
          id: doc.id,
          name: data.name || '',
          latitude: data.latitude || 0,
          longitude: data.longitude || 0,
          category: data.category || 'general',
          color: data.color || '#4FC3F7',
          notes: data.notes || '',
          photos: data.photos || [],
          createdAt: data.createdAt || new Date().toISOString(),
          updatedAt: data.updatedAt || new Date().toISOString(),
        });
      });

      cachedWaypoints = waypoints;
      console.log(`[WaypointService] Snapshot: ${waypoints.length} waypoints`);
      callback(waypoints);
    },
    (error: any) => {
      console.error('[WaypointService] Snapshot error:', error);
    },
  );

  return unsubscribe;
}

/**
 * Get cached waypoints (synchronous, from last snapshot)
 */
export function getCachedWaypoints(): Waypoint[] {
  return cachedWaypoints;
}

/**
 * Add a new waypoint
 */
export async function addWaypoint(userId: string, data: WaypointCreateData): Promise<Waypoint> {
  if (!firestoreFns) {
    throw new Error('Firestore not available');
  }

  const now = new Date().toISOString();
  const id = generateId();
  const waypoint: Waypoint = {
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = getWaypointDoc(userId, id);
  await firestoreFns.setDoc(docRef, waypoint);
  console.log(`[WaypointService] Added waypoint: ${waypoint.name} (${id})`);
  return waypoint;
}

/**
 * Update an existing waypoint
 */
export async function updateWaypoint(userId: string, waypoint: Waypoint): Promise<void> {
  if (!firestoreFns) {
    throw new Error('Firestore not available');
  }

  const updated: Waypoint = {
    ...waypoint,
    updatedAt: new Date().toISOString(),
  };

  const docRef = getWaypointDoc(userId, waypoint.id);
  await firestoreFns.setDoc(docRef, updated);
  console.log(`[WaypointService] Updated waypoint: ${waypoint.name} (${waypoint.id})`);
}

/**
 * Delete a single waypoint
 */
export async function deleteWaypoint(userId: string, waypointId: string): Promise<void> {
  if (!firestoreFns) {
    throw new Error('Firestore not available');
  }

  const docRef = getWaypointDoc(userId, waypointId);
  await firestoreFns.deleteDoc(docRef);
  console.log(`[WaypointService] Deleted waypoint: ${waypointId}`);
}

/**
 * Delete multiple waypoints in a batch (atomic operation)
 */
export async function deleteWaypoints(userId: string, waypointIds: string[]): Promise<void> {
  if (!firestoreDb || !firestoreFns) {
    throw new Error('Firestore not available');
  }

  if (waypointIds.length === 0) return;

  // Firestore batches support up to 500 operations
  const batchSize = 500;
  for (let i = 0; i < waypointIds.length; i += batchSize) {
    const chunk = waypointIds.slice(i, i + batchSize);
    const batch = firestoreFns.writeBatch(firestoreDb);

    for (const id of chunk) {
      const docRef = getWaypointDoc(userId, id);
      batch.delete(docRef);
    }

    await batch.commit();
  }

  console.log(`[WaypointService] Batch deleted ${waypointIds.length} waypoints`);
}

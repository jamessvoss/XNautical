/**
 * Boat Storage Service
 * 
 * Manages boat persistence with dual storage strategy:
 * - Firestore: users/{userId}/boats/{boatId} for cloud-synced boats
 * - AsyncStorage: @XNautical:boats for local-only boats
 * 
 * Features:
 * - Supports both cloud and local storage based on boat preferences
 * - Automatic offline persistence (Firestore native SDK + AsyncStorage)
 * - Real-time sync via onSnapshot for cloud boats
 * - Conflict resolution (last-write-wins with timestamp)
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Boat, Engine, MaintenanceRecord, PerformancePoint } from '../types/boat';

// Native Firestore SDK (same pattern as routeStorageService)
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
    console.warn('[BoatStorageService] Native Firestore not available:', e);
  }
}

const LOCAL_BOATS_KEY = '@XNautical:boats';

/**
 * Recursively strip undefined values from an object.
 * Firestore does not accept undefined — this converts them to null or removes them.
 */
function stripUndefined(obj: any): any {
  if (obj === undefined) return null;
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripUndefined);
  
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = stripUndefined(value);
    }
  }
  return cleaned;
}

/**
 * Generate a unique boat ID
 */
export function generateBoatId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `boat_${timestamp}_${random}`;
}

/**
 * Get the boats collection reference for a user (Firestore)
 */
function getBoatsCollection(userId: string) {
  if (!firestoreDb || !firestoreFns) {
    throw new Error('Firestore not available');
  }
  return firestoreFns.collection(firestoreDb, 'users', userId, 'boats');
}

/**
 * Get a boat document reference (Firestore)
 */
function getBoatDoc(userId: string, boatId: string) {
  if (!firestoreDb || !firestoreFns) {
    throw new Error('Firestore not available');
  }
  return firestoreFns.doc(firestoreDb, 'users', userId, 'boats', boatId);
}

// ========== FIRESTORE (CLOUD) OPERATIONS ==========

/**
 * Subscribe to real-time boat updates for a user (cloud boats only).
 * Returns an unsubscribe function.
 */
export function subscribeToCloudBoats(
  userId: string,
  callback: (boats: Boat[]) => void,
  onError?: (error: any) => void,
): () => void {
  if (!firestoreDb || !firestoreFns) {
    console.warn('[BoatStorageService] Firestore not available');
    callback([]);
    return () => {};
  }

  try {
    const collectionRef = getBoatsCollection(userId);
    const q = firestoreFns.query(
      collectionRef,
      firestoreFns.orderBy('updatedAt', 'desc')
    );

    const unsubscribe = firestoreFns.onSnapshot(
      q,
      (snapshot: any) => {
        const boats: Boat[] = [];
        snapshot.forEach((doc: any) => {
          const data = doc.data();
          if (data) {
            boats.push({
              id: doc.id,
              ...data,
            } as Boat);
          }
        });
        callback(boats);
      },
      (error: any) => {
        console.error('[BoatStorageService] Snapshot error:', error);
        if (onError) onError(error);
      }
    );

    return unsubscribe;
  } catch (error) {
    console.error('[BoatStorageService] Subscribe error:', error);
    if (onError) onError(error);
    return () => {};
  }
}

/**
 * Save boat to Firestore (cloud)
 */
export async function saveBoatToCloud(userId: string, boat: Boat): Promise<void> {
  if (!firestoreDb || !firestoreFns) {
    throw new Error('Firestore not available - cannot save to cloud');
  }

  try {
    const docRef = getBoatDoc(userId, boat.id);
    const cleanedBoat = stripUndefined({
      ...boat,
      updatedAt: new Date().toISOString(),
    });
    await firestoreFns.setDoc(docRef, cleanedBoat);
    console.log(`[BoatStorageService] Saved boat ${boat.id} to cloud`);
  } catch (error) {
    console.error('[BoatStorageService] Error saving to cloud:', error);
    throw error;
  }
}

/**
 * Delete boat from Firestore (cloud)
 */
export async function deleteBoatFromCloud(userId: string, boatId: string): Promise<void> {
  if (!firestoreDb || !firestoreFns) {
    throw new Error('Firestore not available - cannot delete from cloud');
  }

  try {
    const docRef = getBoatDoc(userId, boatId);
    await firestoreFns.deleteDoc(docRef);
    console.log(`[BoatStorageService] Deleted boat ${boatId} from cloud`);
  } catch (error) {
    console.error('[BoatStorageService] Error deleting from cloud:', error);
    throw error;
  }
}

// ========== ASYNC STORAGE (LOCAL) OPERATIONS ==========

/**
 * Get all local boats from AsyncStorage
 */
export async function getLocalBoats(): Promise<Boat[]> {
  try {
    const json = await AsyncStorage.getItem(LOCAL_BOATS_KEY);
    if (!json) return [];
    
    const boats = JSON.parse(json) as Boat[];
    return boats.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  } catch (error) {
    console.error('[BoatStorageService] Error reading local boats:', error);
    return [];
  }
}

/**
 * Save boat to AsyncStorage (local)
 */
export async function saveBoatToLocal(boat: Boat): Promise<void> {
  try {
    const boats = await getLocalBoats();
    
    // Update existing or add new
    const existingIndex = boats.findIndex(b => b.id === boat.id);
    if (existingIndex >= 0) {
      boats[existingIndex] = {
        ...boat,
        updatedAt: new Date().toISOString(),
      };
    } else {
      boats.push({
        ...boat,
        updatedAt: new Date().toISOString(),
      });
    }

    await AsyncStorage.setItem(LOCAL_BOATS_KEY, JSON.stringify(boats));
    console.log(`[BoatStorageService] Saved boat ${boat.id} to local storage`);
  } catch (error) {
    console.error('[BoatStorageService] Error saving to local:', error);
    throw error;
  }
}

/**
 * Delete boat from AsyncStorage (local)
 */
export async function deleteBoatFromLocal(boatId: string): Promise<void> {
  try {
    const boats = await getLocalBoats();
    const filtered = boats.filter(b => b.id !== boatId);
    await AsyncStorage.setItem(LOCAL_BOATS_KEY, JSON.stringify(filtered));
    console.log(`[BoatStorageService] Deleted boat ${boatId} from local storage`);
  } catch (error) {
    console.error('[BoatStorageService] Error deleting from local:', error);
    throw error;
  }
}

/**
 * Clear all local boats (use with caution)
 */
export async function clearLocalBoats(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LOCAL_BOATS_KEY);
    console.log('[BoatStorageService] Cleared all local boats');
  } catch (error) {
    console.error('[BoatStorageService] Error clearing local boats:', error);
    throw error;
  }
}

// ========== UNIFIED OPERATIONS (HANDLES BOTH STORAGE TYPES) ==========

/**
 * Save boat based on its storageType preference
 */
export async function saveBoat(userId: string, boat: Boat): Promise<void> {
  const storageType = boat.storageType || 'both'; // Default to 'both' if not specified
  const boatToSave: Boat = { ...boat, storageType: 'both' as const }; // Ensure storageType is always set

  if (storageType === 'cloud' || storageType === 'both') {
    try {
      await saveBoatToCloud(userId, boatToSave);
    } catch (error) {
      console.error('[BoatStorageService] Cloud save failed:', error);
      // If cloud fails and storageType is 'cloud', fall back to local
      if (storageType === 'cloud') {
        console.log('[BoatStorageService] Falling back to local storage');
        await saveBoatToLocal(boatToSave);
        return;
      }
      // If storageType is 'both', continue to save locally
    }
  }

  if (storageType === 'local' || storageType === 'both') {
    await saveBoatToLocal(boatToSave);
  }
}

/**
 * Delete boat from appropriate storage(s)
 */
export async function deleteBoat(userId: string, boat: Boat): Promise<void> {
  const storageType = boat.storageType || 'both'; // Default to 'both' if not specified
  const { id } = boat;

  if (storageType === 'cloud' || storageType === 'both') {
    await deleteBoatFromCloud(userId, id);
  }

  if (storageType === 'local' || storageType === 'both') {
    await deleteBoatFromLocal(id);
  }
}

/**
 * Get all boats (both cloud and local)
 * Note: Cloud boats should be managed via subscribeToCloudBoats
 * This is a one-time fetch, mainly for local boats.
 */
export async function getAllBoats(userId: string): Promise<Boat[]> {
  const localBoats = await getLocalBoats();
  
  // For cloud boats, recommend using subscribeToCloudBoats instead
  // This is just a fallback for one-time reads
  const cloudBoats: Boat[] = [];
  
  return [...cloudBoats, ...localBoats];
}

// ========== BOAT-SPECIFIC OPERATIONS ==========

/**
 * Update engine hours for a specific engine
 */
export async function updateBoatEngineHours(
  userId: string,
  boat: Boat,
  engineId: string,
  hours: number
): Promise<void> {
  const updatedBoat = {
    ...boat,
    engines: boat.engines.map(engine =>
      engine.id === engineId ? { ...engine, hours } : engine
    ),
    updatedAt: new Date().toISOString(),
  };

  await saveBoat(userId, updatedBoat);
}

/**
 * Add a maintenance record to a boat
 */
export async function addMaintenanceRecord(
  userId: string,
  boat: Boat,
  record: MaintenanceRecord
): Promise<void> {
  const updatedBoat = {
    ...boat,
    maintenanceLog: [record, ...boat.maintenanceLog],
    updatedAt: new Date().toISOString(),
  };

  await saveBoat(userId, updatedBoat);
}

/**
 * Update maintenance record
 */
export async function updateMaintenanceRecord(
  userId: string,
  boat: Boat,
  recordId: string,
  updates: Partial<MaintenanceRecord>
): Promise<void> {
  const updatedBoat = {
    ...boat,
    maintenanceLog: boat.maintenanceLog.map(record =>
      record.id === recordId ? { ...record, ...updates } : record
    ),
    updatedAt: new Date().toISOString(),
  };

  await saveBoat(userId, updatedBoat);
}

/**
 * Delete maintenance record
 */
export async function deleteMaintenanceRecord(
  userId: string,
  boat: Boat,
  recordId: string
): Promise<void> {
  const updatedBoat = {
    ...boat,
    maintenanceLog: boat.maintenanceLog.filter(record => record.id !== recordId),
    updatedAt: new Date().toISOString(),
  };

  await saveBoat(userId, updatedBoat);
}

/**
 * Update performance data for a boat (boat-level, not per-engine)
 */
export async function updatePerformanceData(
  userId: string,
  boat: Boat,
  performanceData: PerformancePoint[]
): Promise<void> {
  const updatedBoat = {
    ...boat,
    performanceData,
    updatedAt: new Date().toISOString(),
  };

  await saveBoat(userId, updatedBoat);
}

/**
 * Add or update an engine
 */
export async function saveEngine(
  userId: string,
  boat: Boat,
  engine: Engine
): Promise<void> {
  const existingIndex = boat.engines.findIndex(e => e.id === engine.id);
  
  const updatedBoat = {
    ...boat,
    engines: existingIndex >= 0
      ? boat.engines.map(e => e.id === engine.id ? engine : e)
      : [...boat.engines, engine],
    updatedAt: new Date().toISOString(),
  };

  await saveBoat(userId, updatedBoat);
}

/**
 * Delete an engine
 */
export async function deleteEngine(
  userId: string,
  boat: Boat,
  engineId: string
): Promise<void> {
  const updatedBoat = {
    ...boat,
    engines: boat.engines.filter(e => e.id !== engineId),
    updatedAt: new Date().toISOString(),
  };

  await saveBoat(userId, updatedBoat);
}

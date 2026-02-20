/**
 * WaypointContext
 * 
 * Global state management for waypoints.
 * Sets up a Firestore onSnapshot listener when authenticated,
 * provides CRUD operations, and manages creation/edit modal state.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo, ReactNode } from 'react';
import { Platform } from 'react-native';
import { Waypoint, WaypointCategory, WaypointCreateData, WaypointPhoto } from '../types/waypoint';
import * as waypointService from '../services/waypointService';
import * as waypointPhotoService from '../services/waypointPhotoService';
import { getDefaultColor } from '../components/WaypointIcons';

// Auth helpers
let getCurrentUser: (() => any) | null = null;
let waitForAuth: (() => Promise<any>) | null = null;
if (Platform.OS !== 'web') {
  try {
    const firebase = require('../config/firebase');
    getCurrentUser = firebase.getCurrentUser;
    waitForAuth = firebase.waitForAuth;
  } catch (e) {
    console.log('[WaypointContext] Firebase config not available');
  }
}

interface WaypointContextType {
  /** All waypoints from real-time listener */
  waypoints: Waypoint[];
  /** Loading state */
  loading: boolean;
  /** Add a new waypoint */
  addWaypoint: (data: WaypointCreateData) => Promise<Waypoint | null>;
  /** Update an existing waypoint */
  updateWaypoint: (waypoint: Waypoint) => Promise<void>;
  /** Delete a single waypoint */
  deleteWaypoint: (id: string) => Promise<void>;
  /** Delete multiple waypoints */
  deleteWaypoints: (ids: string[]) => Promise<void>;
  
  // Creation modal state
  /** Whether the creation/edit modal is visible */
  showCreationModal: boolean;
  /** Open creation modal for a new waypoint at given coordinates */
  openCreationModal: (longitude: number, latitude: number) => void;
  /** Open creation modal in edit mode for an existing waypoint */
  openEditModal: (waypoint: Waypoint) => void;
  /** Close the creation/edit modal */
  closeCreationModal: () => void;
  /** Coordinates from long-press (for new waypoints) */
  pendingCoordinate: [number, number] | null; // [lng, lat]
  /** Waypoint being edited (null for new waypoints) */
  editingWaypoint: Waypoint | null;

  // Photo helpers
  /** Pick a photo from library and add to a waypoint */
  pickPhotoForWaypoint: (waypointId: string) => Promise<WaypointPhoto | null>;
  /** Take a photo and add to a waypoint */
  takePhotoForWaypoint: (waypointId: string) => Promise<WaypointPhoto | null>;
}

const WaypointContext = createContext<WaypointContextType>({
  waypoints: [],
  loading: true,
  addWaypoint: async () => null,
  updateWaypoint: async () => {},
  deleteWaypoint: async () => {},
  deleteWaypoints: async () => {},
  showCreationModal: false,
  openCreationModal: () => {},
  openEditModal: () => {},
  closeCreationModal: () => {},
  pendingCoordinate: null,
  editingWaypoint: null,
  pickPhotoForWaypoint: async () => null,
  takePhotoForWaypoint: async () => null,
});

interface WaypointProviderProps {
  children: ReactNode;
}

export function WaypointProvider({ children }: WaypointProviderProps) {
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreationModal, setShowCreationModal] = useState(false);
  const [pendingCoordinate, setPendingCoordinate] = useState<[number, number] | null>(null);
  const [editingWaypoint, setEditingWaypoint] = useState<Waypoint | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const userIdRef = useRef<string | null>(null);

  // Set up Firestore listener (waits for auth, retries on permission-denied)
  useEffect(() => {
    if (Platform.OS === 'web') {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let retryCount = 0;
    const MAX_RETRIES = 3;

    const setupListener = async () => {
      try {
        // Wait for auth to be fully ready instead of a fixed timeout
        const user = waitForAuth ? await waitForAuth() : getCurrentUser?.();

        if (cancelled) return;

        if (!user?.uid) {
          console.log('[WaypointContext] No authenticated user after waiting for auth');
          setLoading(false);
          return;
        }

        // Already listening for this user
        if (userIdRef.current === user.uid && unsubscribeRef.current) {
          return;
        }

        // Clean up previous listener
        if (unsubscribeRef.current) {
          unsubscribeRef.current();
        }

        userIdRef.current = user.uid;
        console.log(`[WaypointContext] Setting up listener for user: ${user.uid}`);

        unsubscribeRef.current = waypointService.subscribeToWaypoints(
          user.uid,
          (updatedWaypoints) => {
            setWaypoints(updatedWaypoints);
            setLoading(false);
            retryCount = 0; // Reset retry count on success
          },
          (error: any) => {
            // Retry on permission-denied (auth token may not be ready yet)
            if (cancelled) return;
            const errorCode = error?.code || error?.message || '';
            const isPermissionDenied = String(errorCode).includes('permission-denied');

            if (isPermissionDenied && retryCount < MAX_RETRIES) {
              retryCount++;
              console.log(`[WaypointContext] Permission denied, retrying (${retryCount}/${MAX_RETRIES})...`);
              if (unsubscribeRef.current) {
                unsubscribeRef.current();
                unsubscribeRef.current = null;
              }
              setTimeout(setupListener, 2000 * retryCount);
            } else if (isPermissionDenied) {
              console.error(`[WaypointContext] Permission denied after ${MAX_RETRIES} retries, giving up`);
              setLoading(false);
            }
          },
        );
      } catch (e) {
        console.error('[WaypointContext] Error setting up listener:', e);
        setLoading(false);
      }
    };

    setupListener();

    return () => {
      cancelled = true;
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, []);

  const getUserId = useCallback((): string | null => {
    const user = getCurrentUser?.();
    return user?.uid || null;
  }, []);

  const addWaypoint = useCallback(async (data: WaypointCreateData): Promise<Waypoint | null> => {
    const userId = getUserId();
    if (!userId) {
      console.warn('[WaypointContext] Cannot add waypoint: no user');
      return null;
    }

    try {
      const waypoint = await waypointService.addWaypoint(userId, data);
      
      // Background upload any photos
      if (data.photos && data.photos.length > 0) {
        waypointPhotoService.uploadPendingPhotos(userId, waypoint.id, data.photos)
          .then(async (uploadedPhotos) => {
            // Update waypoint with uploaded photo URLs
            const hasUploads = uploadedPhotos.some(p => p.uploaded);
            if (hasUploads) {
              await waypointService.updateWaypoint(userId, {
                ...waypoint,
                photos: uploadedPhotos,
              });
            }
          })
          .catch(e => console.warn('[WaypointContext] Photo upload failed:', e));
      }

      return waypoint;
    } catch (error) {
      console.error('[WaypointContext] Failed to add waypoint:', error);
      return null;
    }
  }, [getUserId]);

  const updateWaypointFn = useCallback(async (waypoint: Waypoint): Promise<void> => {
    const userId = getUserId();
    if (!userId) return;

    try {
      await waypointService.updateWaypoint(userId, waypoint);

      // Background upload any pending photos
      const pendingPhotos = waypoint.photos.filter(p => !p.uploaded);
      if (pendingPhotos.length > 0) {
        waypointPhotoService.uploadPendingPhotos(userId, waypoint.id, waypoint.photos)
          .then(async (uploadedPhotos) => {
            const hasNewUploads = uploadedPhotos.some((p, i) => p.uploaded !== waypoint.photos[i]?.uploaded);
            if (hasNewUploads) {
              await waypointService.updateWaypoint(userId, {
                ...waypoint,
                photos: uploadedPhotos,
              });
            }
          })
          .catch(e => console.warn('[WaypointContext] Photo upload failed:', e));
      }
    } catch (error) {
      console.error('[WaypointContext] Failed to update waypoint:', error);
    }
  }, [getUserId]);

  const deleteWaypointFn = useCallback(async (id: string): Promise<void> => {
    const userId = getUserId();
    if (!userId) return;

    try {
      // Delete photos first
      const wp = waypoints.find(w => w.id === id);
      if (wp && wp.photos.length > 0) {
        await waypointPhotoService.deleteAllPhotos(userId, id, wp.photos);
      }
      await waypointService.deleteWaypoint(userId, id);
    } catch (error) {
      console.error('[WaypointContext] Failed to delete waypoint:', error);
    }
  }, [getUserId, waypoints]);

  const deleteWaypointsFn = useCallback(async (ids: string[]): Promise<void> => {
    const userId = getUserId();
    if (!userId) return;

    try {
      // Delete photos for each waypoint
      for (const id of ids) {
        const wp = waypoints.find(w => w.id === id);
        if (wp && wp.photos.length > 0) {
          await waypointPhotoService.deleteAllPhotos(userId, id, wp.photos);
        }
      }
      await waypointService.deleteWaypoints(userId, ids);
    } catch (error) {
      console.error('[WaypointContext] Failed to batch delete waypoints:', error);
    }
  }, [getUserId, waypoints]);

  const openCreationModal = useCallback((longitude: number, latitude: number) => {
    setPendingCoordinate([longitude, latitude]);
    setEditingWaypoint(null);
    setShowCreationModal(true);
  }, []);

  const openEditModal = useCallback((waypoint: Waypoint) => {
    setPendingCoordinate(null);
    setEditingWaypoint(waypoint);
    setShowCreationModal(true);
  }, []);

  const closeCreationModal = useCallback(() => {
    setShowCreationModal(false);
    setPendingCoordinate(null);
    setEditingWaypoint(null);
  }, []);

  const pickPhotoForWaypoint = useCallback(async (waypointId: string): Promise<WaypointPhoto | null> => {
    return waypointPhotoService.pickPhoto(waypointId);
  }, []);

  const takePhotoForWaypoint = useCallback(async (waypointId: string): Promise<WaypointPhoto | null> => {
    return waypointPhotoService.takePhoto(waypointId);
  }, []);


  const value: WaypointContextType = useMemo(() => ({
    waypoints,
    loading,
    addWaypoint,
    updateWaypoint: updateWaypointFn,
    deleteWaypoint: deleteWaypointFn,
    deleteWaypoints: deleteWaypointsFn,
    showCreationModal,
    openCreationModal,
    openEditModal,
    closeCreationModal,
    pendingCoordinate,
    editingWaypoint,
    pickPhotoForWaypoint,
    takePhotoForWaypoint,
  }), [
    waypoints, loading,
    addWaypoint, updateWaypointFn, deleteWaypointFn, deleteWaypointsFn,
    showCreationModal, openCreationModal, openEditModal, closeCreationModal,
    pendingCoordinate, editingWaypoint,
    pickPhotoForWaypoint, takePhotoForWaypoint,
  ]);

  return (
    <WaypointContext.Provider value={value}>
      {children}
    </WaypointContext.Provider>
  );
}

export function useWaypoints() {
  return useContext(WaypointContext);
}

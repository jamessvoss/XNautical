/**
 * RouteContext
 * 
 * Global state management for navigation routes.
 * Manages both cloud-synced and local-only routes, provides CRUD operations,
 * and handles active navigation state.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { Platform } from 'react-native';
import { Route, RouteCreateData, RoutePoint, Position, ActiveNavigation, DEFAULT_CRUISING_SPEED, DEFAULT_ARRIVAL_RADIUS } from '../types/route';
import * as routeService from '../services/routeService';
import * as routeStorageService from '../services/routeStorageService';

// Auth helpers
let getCurrentUser: (() => any) | null = null;
let waitForAuth: (() => Promise<any>) | null = null;
if (Platform.OS !== 'web') {
  try {
    const firebase = require('../config/firebase');
    getCurrentUser = firebase.getCurrentUser;
    waitForAuth = firebase.waitForAuth;
  } catch (e) {
    console.log('[RouteContext] Firebase config not available');
  }
}

interface RouteContextType {
  // Route collection state
  /** Cloud-synced routes from Firestore */
  cloudRoutes: Route[];
  /** Local-only routes from AsyncStorage */
  localRoutes: Route[];
  /** All routes (cloud + local) */
  allRoutes: Route[];
  /** Loading state */
  loading: boolean;

  // CRUD operations
  /** Create a new route */
  createRoute: (data: RouteCreateData) => Promise<Route | null>;
  /** Update an existing route */
  updateRoute: (route: Route) => Promise<void>;
  /** Delete a route */
  deleteRoute: (route: Route) => Promise<void>;
  /** Duplicate a route */
  duplicateRoute: (route: Route, newName?: string) => Promise<Route | null>;

  // Active route state (for creation/editing)
  /** Route currently being created or edited */
  activeRoute: Route | null;
  /** Start creating a new route */
  startNewRoute: (name: string) => void;
  /** Load an existing route for editing */
  loadRoute: (route: Route) => void;
  /** Update active route metadata (name, settings, etc.) */
  updateActiveRouteMetadata: (updates: Partial<Route>) => void;
  /** Add a point to the active route */
  addPointToActiveRoute: (position: Position, options?: { name?: string; waypointRef?: string }) => void;
  /** Remove a point from the active route */
  removePointFromActiveRoute: (pointId: string) => void;
  /** Update a point in the active route */
  updatePointInActiveRoute: (pointId: string, updates: Partial<RoutePoint>) => void;
  /** Reorder points in the active route */
  reorderActiveRoutePoints: (fromIndex: number, toIndex: number) => void;
  /** Save the active route */
  saveActiveRoute: () => Promise<void>;
  /** Clear the active route */
  clearActiveRoute: () => void;

  // Navigation state
  /** Active navigation session */
  navigation: ActiveNavigation | null;
  /** Start navigation on a route */
  startNavigation: (routeId: string, cruisingSpeed?: number) => void;
  /** Stop navigation */
  stopNavigation: () => void;
  /** Advance to next waypoint */
  advanceToNextPoint: () => void;
  /** Skip to a specific point index */
  skipToPoint: (pointIndex: number) => void;
  /** Update navigation settings */
  updateNavigationSettings: (settings: Partial<Pick<ActiveNavigation, 'cruisingSpeed' | 'arrivalRadius' | 'autoAdvance'>>) => void;

  // UI state
  /** Whether routes modal is visible */
  showRoutesModal: boolean;
  /** Open routes modal */
  openRoutesModal: () => void;
  /** Close routes modal */
  closeRoutesModal: () => void;
}

const RouteContext = createContext<RouteContextType>({
  cloudRoutes: [],
  localRoutes: [],
  allRoutes: [],
  loading: true,
  createRoute: async () => null,
  updateRoute: async () => {},
  deleteRoute: async () => {},
  duplicateRoute: async () => null,
  activeRoute: null,
  startNewRoute: () => {},
  loadRoute: () => {},
  updateActiveRouteMetadata: () => {},
  addPointToActiveRoute: () => {},
  removePointFromActiveRoute: () => {},
  updatePointInActiveRoute: () => {},
  reorderActiveRoutePoints: () => {},
  saveActiveRoute: async () => {},
  clearActiveRoute: () => {},
  navigation: null,
  startNavigation: () => {},
  stopNavigation: () => {},
  advanceToNextPoint: () => {},
  skipToPoint: () => {},
  updateNavigationSettings: () => {},
  showRoutesModal: false,
  openRoutesModal: () => {},
  closeRoutesModal: () => {},
});

interface RouteProviderProps {
  children: ReactNode;
}

export function RouteProvider({ children }: RouteProviderProps) {
  const [cloudRoutes, setCloudRoutes] = useState<Route[]>([]);
  const [localRoutes, setLocalRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRoute, setActiveRoute] = useState<Route | null>(null);
  const [navigation, setNavigation] = useState<ActiveNavigation | null>(null);
  const [showRoutesModal, setShowRoutesModal] = useState(false);

  const unsubscribeRef = useRef<(() => void) | null>(null);
  const userIdRef = useRef<string | null>(null);
  const cruisingSpeedRef = useRef<number>(DEFAULT_CRUISING_SPEED);

  // All routes (cloud + local)
  const allRoutes = [...cloudRoutes, ...localRoutes];

  // Set up Firestore listener for cloud routes
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
        const user = waitForAuth ? await waitForAuth() : getCurrentUser?.();

        if (cancelled) return;

        if (!user?.uid) {
          console.log('[RouteContext] No authenticated user');
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
        console.log(`[RouteContext] Setting up listener for user: ${user.uid}`);

        unsubscribeRef.current = routeStorageService.subscribeToCloudRoutes(
          user.uid,
          (updatedRoutes) => {
            setCloudRoutes(updatedRoutes);
            setLoading(false);
            retryCount = 0;
          },
          (error: any) => {
            if (cancelled) return;
            const errorCode = error?.code || error?.message || '';
            const isPermissionDenied = String(errorCode).includes('permission-denied');

            if (isPermissionDenied && retryCount < MAX_RETRIES) {
              retryCount++;
              console.log(`[RouteContext] Permission denied, retrying (${retryCount}/${MAX_RETRIES})...`);
              if (unsubscribeRef.current) {
                unsubscribeRef.current();
                unsubscribeRef.current = null;
              }
              setTimeout(() => !cancelled && setupListener(), 1000 * retryCount);
            } else {
              console.error('[RouteContext] Listener error:', error);
              setLoading(false);
            }
          }
        );
      } catch (error) {
        console.error('[RouteContext] Setup error:', error);
        setLoading(false);
      }
    };

    setupListener();

    return () => {
      cancelled = true;
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  // Load local routes on mount
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const loadLocalRoutes = async () => {
      try {
        const routes = await routeStorageService.getLocalRoutes();
        setLocalRoutes(routes);
      } catch (error) {
        console.error('[RouteContext] Error loading local routes:', error);
      }
    };

    loadLocalRoutes();
  }, []);

  // Create a new route
  const createRoute = useCallback(async (data: RouteCreateData): Promise<Route | null> => {
    try {
      const user = getCurrentUser?.();
      if (!user?.uid) {
        throw new Error('User not authenticated');
      }

      const newRoute = routeService.createRoute(data, cruisingSpeedRef.current);
      await routeStorageService.saveRoute(user.uid, newRoute);

      // Update local state if local-only
      if (newRoute.storageType === 'local') {
        setLocalRoutes(prev => [newRoute, ...prev]);
      }

      console.log(`[RouteContext] Created route: ${newRoute.id}`);
      return newRoute;
    } catch (error) {
      console.error('[RouteContext] Error creating route:', error);
      return null;
    }
  }, []);

  // Update an existing route
  const updateRoute = useCallback(async (route: Route): Promise<void> => {
    try {
      const user = getCurrentUser?.();
      if (!user?.uid) {
        throw new Error('User not authenticated');
      }

      await routeStorageService.saveRoute(user.uid, route);

      // Update local state if local-only
      if (route.storageType === 'local') {
        setLocalRoutes(prev =>
          prev.map(r => (r.id === route.id ? route : r))
        );
      }

      console.log(`[RouteContext] Updated route: ${route.id}`);
    } catch (error) {
      console.error('[RouteContext] Error updating route:', error);
      throw error;
    }
  }, []);

  // Delete a route
  const deleteRoute = useCallback(async (route: Route): Promise<void> => {
    try {
      const user = getCurrentUser?.();
      if (!user?.uid) {
        throw new Error('User not authenticated');
      }

      await routeStorageService.deleteRoute(user.uid, route);

      // Update local state if local-only
      if (route.storageType === 'local') {
        setLocalRoutes(prev => prev.filter(r => r.id !== route.id));
      }

      // Clear active route if it was deleted
      if (activeRoute?.id === route.id) {
        setActiveRoute(null);
      }

      // Stop navigation if navigating this route
      if (navigation?.routeId === route.id) {
        setNavigation(null);
      }

      console.log(`[RouteContext] Deleted route: ${route.id}`);
    } catch (error) {
      console.error('[RouteContext] Error deleting route:', error);
      throw error;
    }
  }, [activeRoute, navigation]);

  // Duplicate a route
  const duplicateRoute = useCallback(async (route: Route, newName?: string): Promise<Route | null> => {
    try {
      const user = getCurrentUser?.();
      if (!user?.uid) {
        throw new Error('User not authenticated');
      }

      const duplicated = routeService.duplicateRoute(route, newName, cruisingSpeedRef.current);
      await routeStorageService.saveRoute(user.uid, duplicated);

      // Update local state if local-only
      if (duplicated.storageType === 'local') {
        setLocalRoutes(prev => [duplicated, ...prev]);
      }

      console.log(`[RouteContext] Duplicated route: ${duplicated.id}`);
      return duplicated;
    } catch (error) {
      console.error('[RouteContext] Error duplicating route:', error);
      return null;
    }
  }, []);

  // Start creating a new route
  const startNewRoute = useCallback((name: string) => {
    const newRoute = routeService.createRoute({
      name,
      routePoints: [],
      color: undefined,
      notes: '',
      storageType: 'cloud', // Default to cloud
      estimatedDuration: null,
      totalDistance: 0,
      performanceMethod: 'speed',
      cruisingSpeed: DEFAULT_CRUISING_SPEED,
      cruisingRPM: null,
      boatProfileId: null,
      fuelBurnRate: 2.5, // Default gallons per hour
      estimatedFuel: 0,
    }, cruisingSpeedRef.current);

    setActiveRoute(newRoute);
    console.log('[RouteContext] Started new route');
  }, []);

  // Load an existing route for editing
  const loadRoute = useCallback((route: Route) => {
    setActiveRoute(route);
    console.log(`[RouteContext] Loaded route for editing: ${route.id}`);
  }, []);

  // Update active route metadata
  const updateActiveRouteMetadata = useCallback((updates: Partial<Route>) => {
    if (!activeRoute) return;
    
    const updatedRoute = {
      ...activeRoute,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    
    // Recalculate if performance settings changed
    if (updates.cruisingSpeed || updates.fuelBurnRate) {
      const speed = updates.cruisingSpeed || activeRoute.cruisingSpeed;
      const fuelRate = updates.fuelBurnRate || activeRoute.fuelBurnRate;
      const duration = (activeRoute.totalDistance / speed) * 60; // hours to minutes
      const fuel = (duration / 60) * fuelRate;
      
      updatedRoute.estimatedDuration = duration;
      updatedRoute.estimatedFuel = fuel;
    }
    
    setActiveRoute(updatedRoute);
  }, [activeRoute]);

  // Add a point to the active route
  const addPointToActiveRoute = useCallback((
    position: Position,
    options?: { name?: string; waypointRef?: string }
  ) => {
    if (!activeRoute) return;

    const newPoint = routeService.createRoutePoint(
      position,
      activeRoute.routePoints.length,
      options
    );

    const updatedRoute = routeService.addPointToRoute(
      activeRoute,
      newPoint,
      undefined,
      cruisingSpeedRef.current
    );

    setActiveRoute(updatedRoute);
  }, [activeRoute]);

  // Remove a point from the active route
  const removePointFromActiveRoute = useCallback((pointId: string) => {
    if (!activeRoute) return;

    const updatedRoute = routeService.removePointFromRoute(
      activeRoute,
      pointId,
      cruisingSpeedRef.current
    );

    setActiveRoute(updatedRoute);
  }, [activeRoute]);

  // Update a point in the active route
  const updatePointInActiveRoute = useCallback((pointId: string, updates: Partial<RoutePoint>) => {
    if (!activeRoute) return;

    const updatedRoute = routeService.updatePointInRoute(
      activeRoute,
      pointId,
      updates,
      cruisingSpeedRef.current
    );

    setActiveRoute(updatedRoute);
  }, [activeRoute]);

  // Reorder points in the active route
  const reorderActiveRoutePoints = useCallback((fromIndex: number, toIndex: number) => {
    if (!activeRoute) return;

    const updatedRoute = routeService.reorderRoutePoints(
      activeRoute,
      fromIndex,
      toIndex,
      cruisingSpeedRef.current
    );

    setActiveRoute(updatedRoute);
  }, [activeRoute]);

  // Save the active route
  const saveActiveRoute = useCallback(async () => {
    if (!activeRoute) return;

    const validation = routeService.validateRoute(activeRoute);
    if (!validation.isValid) {
      console.error('[RouteContext] Cannot save invalid route:', validation.errors);
      throw new Error(`Invalid route: ${validation.errors.join(', ')}`);
    }

    // If route exists, update it; otherwise create new
    const existingRoute = allRoutes.find(r => r.id === activeRoute.id);
    if (existingRoute) {
      await updateRoute(activeRoute);
    } else {
      const user = getCurrentUser?.();
      if (!user?.uid) {
        throw new Error('User not authenticated');
      }
      await routeStorageService.saveRoute(user.uid, activeRoute);

      // Update local state if local-only
      if (activeRoute.storageType === 'local') {
        setLocalRoutes(prev => [activeRoute, ...prev]);
      }
    }

    console.log(`[RouteContext] Saved active route: ${activeRoute.id}`);
  }, [activeRoute, allRoutes, updateRoute]);

  // Clear the active route
  const clearActiveRoute = useCallback(() => {
    setActiveRoute(null);
    console.log('[RouteContext] Cleared active route');
  }, []);

  // Start navigation
  const startNavigation = useCallback((routeId: string, cruisingSpeed?: number) => {
    const route = allRoutes.find(r => r.id === routeId);
    if (!route) {
      console.error('[RouteContext] Route not found:', routeId);
      return;
    }

    if (route.routePoints.length < 2) {
      console.error('[RouteContext] Cannot navigate route with < 2 points');
      return;
    }

    const speed = cruisingSpeed || cruisingSpeedRef.current;
    cruisingSpeedRef.current = speed;

    setNavigation({
      routeId,
      currentPointIndex: 1, // Navigate to second point (first is starting point)
      isActive: true,
      cruisingSpeed: speed,
      arrivalRadius: DEFAULT_ARRIVAL_RADIUS,
      autoAdvance: true,
      startedAt: new Date().toISOString(),
    });

    console.log(`[RouteContext] Started navigation on route: ${routeId}`);
  }, [allRoutes]);

  // Stop navigation
  const stopNavigation = useCallback(() => {
    setNavigation(null);
    console.log('[RouteContext] Stopped navigation');
  }, []);

  // Advance to next waypoint
  const advanceToNextPoint = useCallback(() => {
    if (!navigation) return;

    const route = allRoutes.find(r => r.id === navigation.routeId);
    if (!route) return;

    const nextIndex = navigation.currentPointIndex + 1;
    if (nextIndex >= route.routePoints.length) {
      console.log('[RouteContext] Reached end of route');
      stopNavigation();
      return;
    }

    setNavigation(prev => prev ? { ...prev, currentPointIndex: nextIndex } : null);
    console.log(`[RouteContext] Advanced to point ${nextIndex}`);
  }, [navigation, allRoutes, stopNavigation]);

  // Skip to a specific point
  const skipToPoint = useCallback((pointIndex: number) => {
    if (!navigation) return;

    const route = allRoutes.find(r => r.id === navigation.routeId);
    if (!route || pointIndex < 0 || pointIndex >= route.routePoints.length) {
      console.error('[RouteContext] Invalid point index:', pointIndex);
      return;
    }

    setNavigation(prev => prev ? { ...prev, currentPointIndex: pointIndex } : null);
    console.log(`[RouteContext] Skipped to point ${pointIndex}`);
  }, [navigation, allRoutes]);

  // Update navigation settings
  const updateNavigationSettings = useCallback((
    settings: Partial<Pick<ActiveNavigation, 'cruisingSpeed' | 'arrivalRadius' | 'autoAdvance'>>
  ) => {
    if (!navigation) return;

    setNavigation(prev => prev ? { ...prev, ...settings } : null);

    if (settings.cruisingSpeed !== undefined) {
      cruisingSpeedRef.current = settings.cruisingSpeed;
    }

    console.log('[RouteContext] Updated navigation settings:', settings);
  }, [navigation]);

  // UI helpers
  const openRoutesModal = useCallback(() => {
    setShowRoutesModal(true);
  }, []);

  const closeRoutesModal = useCallback(() => {
    setShowRoutesModal(false);
  }, []);

  const value: RouteContextType = {
    cloudRoutes,
    localRoutes,
    allRoutes,
    loading,
    createRoute,
    updateRoute,
    deleteRoute,
    duplicateRoute,
    activeRoute,
    startNewRoute,
    loadRoute,
    updateActiveRouteMetadata,
    addPointToActiveRoute,
    removePointFromActiveRoute,
    updatePointInActiveRoute,
    reorderActiveRoutePoints,
    saveActiveRoute,
    clearActiveRoute,
    navigation,
    startNavigation,
    stopNavigation,
    advanceToNextPoint,
    skipToPoint,
    updateNavigationSettings,
    showRoutesModal,
    openRoutesModal,
    closeRoutesModal,
  };

  return <RouteContext.Provider value={value}>{children}</RouteContext.Provider>;
}

export function useRoutes() {
  const context = useContext(RouteContext);
  if (!context) {
    throw new Error('useRoutes must be used within a RouteProvider');
  }
  return context;
}

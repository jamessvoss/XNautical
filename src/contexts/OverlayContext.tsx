/**
 * Overlay Context - Manages compass and GPS panel state
 *
 * This context allows the overlays to be rendered outside the MapLibre
 * view hierarchy to avoid native view conflicts on Android.
 *
 * IMPORTANT: Device heading (useDeviceHeading) lives in OverlayRenderer
 * (App.tsx), NOT here. Putting 60Hz heading updates in the context value
 * caused cascading re-renders of DynamicChartViewer and MapLibre snap-back.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, ReactNode } from 'react';
import { GPSData } from '../hooks/useGPS';
import { CompassMode, getNextCompassMode } from '../utils/compassUtils';

interface OverlayState {
  compassMode: CompassMode;
  /** @deprecated Use compassMode !== 'off' instead */
  showCompass: boolean;
  showGPSPanel: boolean;
  showMorePanel: boolean;
  showDownloads: boolean;
  showTideDetails: boolean;
  showCurrentDetails: boolean;
  showDebugMap: boolean;
  showNavData: boolean;
  heading: number | null;
  course: number | null;
  gpsData: GPSData | null;
}

interface OverlayContextType extends OverlayState {
  setCompassMode: (mode: CompassMode) => void;
  cycleCompassMode: () => void;
  /** @deprecated Use setCompassMode instead */
  setShowCompass: (show: boolean) => void;
  setShowGPSPanel: (show: boolean) => void;
  setShowMorePanel: (show: boolean) => void;
  toggleMorePanel: () => void;
  setShowDownloads: (show: boolean) => void;
  openDownloads: () => void;
  handleMorePanelClosed: () => void;
  setShowTideDetails: (show: boolean) => void;
  setShowCurrentDetails: (show: boolean) => void;
  setShowDebugMap: (show: boolean) => void;
  setShowNavData: (show: boolean) => void;
  updateGPSData: (data: GPSData) => void;
}

const defaultGPSData: GPSData = {
  latitude: null,
  longitude: null,
  altitude: null,
  speed: null,
  speedKnots: null,
  course: null,
  heading: null,
  accuracy: null,
  timestamp: null,
  isTracking: false,
  hasPermission: false,
  error: null,
};

const OverlayContext = createContext<OverlayContextType>({
  compassMode: 'off',
  showCompass: false,
  showGPSPanel: false,
  showMorePanel: false,
  showDownloads: false,
  showTideDetails: false,
  showCurrentDetails: false,
  showDebugMap: false,
  showNavData: false,
  heading: null,
  course: null,
  gpsData: null,
  setCompassMode: () => {},
  cycleCompassMode: () => {},
  setShowCompass: () => {},
  setShowGPSPanel: () => {},
  setShowMorePanel: () => {},
  toggleMorePanel: () => {},
  setShowDownloads: () => {},
  openDownloads: () => {},
  handleMorePanelClosed: () => {},
  setShowTideDetails: () => {},
  setShowCurrentDetails: () => {},
  setShowDebugMap: () => {},
  setShowNavData: () => {},
  updateGPSData: () => {},
});

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [compassMode, setCompassMode] = useState<CompassMode>('off');
  const [showGPSPanel, setShowGPSPanel] = useState(false);
  const [showMorePanel, setShowMorePanel] = useState(false);
  const [showDownloads, setShowDownloads] = useState(false);
  const [showTideDetails, setShowTideDetails] = useState(false);
  const [showCurrentDetails, setShowCurrentDetails] = useState(false);
  const [showDebugMap, setShowDebugMap] = useState(false);
  const [showNavData, setShowNavData] = useState(false);
  // GPS data stored in a REF, not state.  Updates arrive ~every second from
  // the useGPS hook in DynamicChartViewer.  Using state here would cause the
  // entire OverlayContext value to change on every GPS tick, triggering
  // cascading re-renders of AppNavigator, ViewerTab, DynamicChartViewer, and
  // every other context consumer — a severe performance issue that can make
  // MapLibre lose gesture state and cause map snap-back.
  //
  // With a ref the context value stays stable.  Components that render GPS
  // data (GPSInfoModal, compass overlays) will pick up the latest ref value
  // whenever they re-render for other reasons.  The compass overlays already
  // re-render at 60 Hz via the separate fusedHeading state.
  const gpsDataRef = useRef<GPSData>(defaultGPSData);

  // Derived boolean for backward compat
  const showCompass = compassMode !== 'off';

  // Convenience: cycle through compass modes
  const cycleCompassMode = useCallback(() => {
    setCompassMode(prev => {
      const next = getNextCompassMode(prev);
      return next;
    });
  }, []);

  // Legacy setter: maps boolean to mode
  const setShowCompass = useCallback((show: boolean) => {
    setCompassMode(show ? 'full' : 'off');
  }, []);

  // Toggle the More panel open/closed
  const toggleMorePanel = useCallback(() => {
    setShowMorePanel(prev => {
      console.log('[OverlayContext] toggleMorePanel:', !prev, '(was', prev, ')');
      return !prev;
    });
  }, []);

  // Pending action to run after MorePanel close animation completes
  const pendingActionRef = useRef<(() => void) | null>(null);

  // Open Downloads: close the MorePanel first, then open RegionSelector
  // after the close animation finishes (via handleMorePanelClosed callback)
  const openDownloads = useCallback(() => {
    console.log('[OverlayContext] openDownloads() called');
    setShowMorePanel(false);
    pendingActionRef.current = () => setShowDownloads(true);
  }, []);

  // Called by MorePanel when its close animation completes
  const handleMorePanelClosed = useCallback(() => {
    if (pendingActionRef.current) {
      pendingActionRef.current();
      pendingActionRef.current = null;
    }
  }, []);

  const updateGPSData = useCallback((data: GPSData) => {
    gpsDataRef.current = data;
  }, []);

  const value: OverlayContextType = useMemo(() => ({
    compassMode,
    showCompass,
    showGPSPanel,
    showMorePanel,
    showDownloads,
    showTideDetails,
    showCurrentDetails,
    showDebugMap,
    showNavData,
    // heading from GPS ref (not fusedHeading) — stable, no 60Hz re-renders.
    // Fused heading for compass overlays lives in OverlayRenderer (App.tsx).
    heading: gpsDataRef.current.heading,
    course: gpsDataRef.current.course,
    // gpsData from ref — reads latest value at memo-creation time.
    // Does NOT cause re-renders on GPS updates (that's the point).
    gpsData: gpsDataRef.current,
    setCompassMode,
    cycleCompassMode,
    setShowCompass,
    setShowGPSPanel,
    setShowMorePanel,
    toggleMorePanel,
    setShowDownloads,
    openDownloads,
    handleMorePanelClosed,
    setShowTideDetails,
    setShowCurrentDetails,
    setShowDebugMap,
    setShowNavData,
    updateGPSData,
  }), [
    compassMode,
    showCompass,
    showGPSPanel,
    showMorePanel,
    showDownloads,
    showTideDetails,
    showCurrentDetails,
    showDebugMap,
    showNavData,
    // gpsData intentionally excluded — stored in ref to avoid cascade re-renders
    // fusedHeading moved to OverlayRenderer — 60Hz updates through context caused
    // cascading re-renders of DynamicChartViewer (same issue as GPS data, see above)
    setCompassMode,
    cycleCompassMode,
    setShowCompass,
    setShowGPSPanel,
    setShowMorePanel,
    toggleMorePanel,
    setShowDownloads,
    openDownloads,
    handleMorePanelClosed,
    setShowTideDetails,
    setShowCurrentDetails,
    setShowDebugMap,
    setShowNavData,
    updateGPSData,
  ]);


  return (
    <OverlayContext.Provider value={value}>
      {children}
    </OverlayContext.Provider>
  );
}

export function useOverlay() {
  return useContext(OverlayContext);
}

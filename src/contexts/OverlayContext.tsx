/**
 * Overlay Context - Manages compass and GPS panel state
 * 
 * This context allows the overlays to be rendered outside the MapLibre
 * view hierarchy to avoid native view conflicts on Android.
 * 
 * Compass heading now uses sensor fusion via useDeviceHeading hook
 * for butter-smooth 60Hz updates.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, ReactNode } from 'react';
import { GPSData } from '../hooks/useGPS';
import { useDeviceHeading } from '../hooks/useDeviceHeading';
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
  // Heading sensor status
  headingAccuracy: 'high' | 'medium' | 'low' | 'unknown';
  headingSensorAvailable: boolean;
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
  headingAccuracy: 'unknown',
  headingSensorAvailable: false,
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
  const [gpsData, setGPSData] = useState<GPSData>(defaultGPSData);

  // Derived boolean for backward compat
  const showCompass = compassMode !== 'off';

  // Convenience: cycle through compass modes
  const cycleCompassMode = useCallback(() => {
    setCompassMode(prev => getNextCompassMode(prev));
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

  // Use sensor fusion for smooth compass heading
  // Only enable when compass is visible to save battery
  const { 
    heading: fusedHeading, 
    accuracy: headingAccuracy,
    isAvailable: headingSensorAvailable,
  } = useDeviceHeading({
    enabled: showCompass,
    updateInterval: 16,    // 60Hz
    lerpFactor: 0.2,       // Smooth but responsive
  });

  const updateGPSData = useCallback((data: GPSData) => {
    setGPSData(data);
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
    // Use fused heading from sensor fusion when available, fall back to GPS data
    heading: fusedHeading ?? gpsData.heading,
    course: gpsData.course,
    gpsData,
    headingAccuracy,
    headingSensorAvailable,
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
    fusedHeading,
    gpsData,
    headingAccuracy,
    headingSensorAvailable,
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

/**
 * Overlay Context - Manages compass and GPS panel state
 * 
 * This context allows the overlays to be rendered outside the MapLibre
 * view hierarchy to avoid native view conflicts on Android.
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { GPSData } from '../hooks/useGPS';

interface OverlayState {
  showCompass: boolean;
  showGPSPanel: boolean;
  heading: number | null;
  course: number | null;
  gpsData: GPSData | null;
}

interface OverlayContextType extends OverlayState {
  setShowCompass: (show: boolean) => void;
  setShowGPSPanel: (show: boolean) => void;
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
  showCompass: false,
  showGPSPanel: false,
  heading: null,
  course: null,
  gpsData: null,
  setShowCompass: () => {},
  setShowGPSPanel: () => {},
  updateGPSData: () => {},
});

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [showCompass, setShowCompass] = useState(false);
  const [showGPSPanel, setShowGPSPanel] = useState(false);
  const [gpsData, setGPSData] = useState<GPSData>(defaultGPSData);

  const updateGPSData = useCallback((data: GPSData) => {
    setGPSData(data);
  }, []);

  const value: OverlayContextType = {
    showCompass,
    showGPSPanel,
    heading: gpsData.heading,
    course: gpsData.course,
    gpsData,
    setShowCompass,
    setShowGPSPanel,
    updateGPSData,
  };

  return (
    <OverlayContext.Provider value={value}>
      {children}
    </OverlayContext.Provider>
  );
}

export function useOverlay() {
  return useContext(OverlayContext);
}

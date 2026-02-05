/**
 * Overlay Context - Manages compass and GPS panel state
 * 
 * This context allows the overlays to be rendered outside the MapLibre
 * view hierarchy to avoid native view conflicts on Android.
 * 
 * Compass heading now uses sensor fusion via useDeviceHeading hook
 * for butter-smooth 60Hz updates.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { GPSData } from '../hooks/useGPS';
import { useDeviceHeading } from '../hooks/useDeviceHeading';

interface OverlayState {
  showCompass: boolean;
  showGPSPanel: boolean;
  showTideDetails: boolean;
  showCurrentDetails: boolean;
  heading: number | null;
  course: number | null;
  gpsData: GPSData | null;
  // Heading sensor status
  headingAccuracy: 'high' | 'medium' | 'low' | 'unknown';
  headingSensorAvailable: boolean;
}

interface OverlayContextType extends OverlayState {
  setShowCompass: (show: boolean) => void;
  setShowGPSPanel: (show: boolean) => void;
  setShowTideDetails: (show: boolean) => void;
  setShowCurrentDetails: (show: boolean) => void;
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
  showTideDetails: false,
  showCurrentDetails: false,
  heading: null,
  course: null,
  gpsData: null,
  headingAccuracy: 'unknown',
  headingSensorAvailable: false,
  setShowCompass: () => {},
  setShowGPSPanel: () => {},
  setShowTideDetails: () => {},
  setShowCurrentDetails: () => {},
  updateGPSData: () => {},
});

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [showCompass, setShowCompass] = useState(false);
  const [showGPSPanel, setShowGPSPanel] = useState(false);
  const [showTideDetails, setShowTideDetails] = useState(false);
  const [showCurrentDetails, setShowCurrentDetails] = useState(false);
  const [gpsData, setGPSData] = useState<GPSData>(defaultGPSData);

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

  // Sync fused heading back to GPS data for components that read it from there
  useEffect(() => {
    if (fusedHeading !== null) {
      setGPSData(prev => ({
        ...prev,
        heading: fusedHeading,
      }));
    }
  }, [fusedHeading]);

  const value: OverlayContextType = {
    showCompass,
    showGPSPanel,
    showTideDetails,
    showCurrentDetails,
    // Use fused heading from sensor fusion when available, fall back to GPS data
    heading: fusedHeading ?? gpsData.heading,
    course: gpsData.course,
    gpsData,
    headingAccuracy,
    headingSensorAvailable,
    setShowCompass,
    setShowGPSPanel,
    setShowTideDetails,
    setShowCurrentDetails,
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

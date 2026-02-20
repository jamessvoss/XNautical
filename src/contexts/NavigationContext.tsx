/**
 * NavigationContext
 * 
 * Manages the context-sensitive tab state across the app.
 * The context tab changes its name and content based on selections from the More menu.
 */

import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';

// Available views that can be shown in the context tab
export type ContextView = 'stats' | 'scratchpad' | 'waypoints' | 'gpssensors' | 'boatperformance' | 'settings';

interface NavigationContextState {
  /** Current name displayed on the context tab */
  contextTabName: string;
  
  /** Current view identifier */
  contextTabView: ContextView;
  
  /** Set the context tab to a new view */
  setContextView: (view: ContextView) => void;
  
  /** Navigation reference for programmatic navigation */
  navigationRef: any;
  
  /** Set the navigation reference */
  setNavigationRef: (ref: any) => void;
}

const NavigationContext = createContext<NavigationContextState | undefined>(undefined);

// Map view identifiers to display names
const VIEW_NAMES: Record<ContextView, string> = {
  stats: 'Stats',
  scratchpad: 'Scratch Pad',
  waypoints: 'Waypoints',
  gpssensors: 'GPS & Sensors',
  boatperformance: 'Boat Performance',
  settings: 'Settings',
};

interface NavigationProviderProps {
  children: ReactNode;
}

export function NavigationProvider({ children }: NavigationProviderProps) {
  console.log('[NavigationProvider] Initializing...');
  const [contextTabView, setContextTabView] = useState<ContextView>('stats');
  const [navigationRef, setNavigationRef] = useState<any>(null);
  
  const contextTabName = VIEW_NAMES[contextTabView];
  console.log('[NavigationProvider] contextTabName:', contextTabName);
  
  const setContextView = useCallback((view: ContextView) => {
    console.log('[NavigationProvider] setContextView called with:', view);
    setContextTabView(view);
    
    // Navigate to the context tab after setting the view
    if (navigationRef) {
      // Small delay to ensure state is updated before navigation
      setTimeout(() => {
        console.log('[NavigationProvider] Navigating to Context tab');
        navigationRef.navigate('Context');
      }, 50);
    }
  }, [navigationRef]);
  
  // Memoize the context value to prevent unnecessary re-renders of consumers.
  // Without this, every NavigationProvider render creates a new value object,
  // causing ALL useContextNav() consumers (AppNavigator, etc.) to re-render.
  const value = useMemo(() => ({
    contextTabName,
    contextTabView,
    setContextView,
    navigationRef,
    setNavigationRef,
  }), [contextTabName, contextTabView, setContextView, navigationRef, setNavigationRef]);

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useContextNav() {
  const context = useContext(NavigationContext);
  if (context === undefined) {
    throw new Error('useContextNav must be used within a NavigationProvider');
  }
  return context;
}

export default NavigationContext;

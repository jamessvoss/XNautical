/**
 * Type definitions for DynamicChartViewer
 */

import type { FeatureType, GeoJSONFeatureCollection } from '../../types/chart';
import type { DisplaySettings } from '../../services/displaySettingsService';

export interface Props {
  onNavigateToDownloads?: () => void;
}

export interface FeatureInfo {
  type: string;
  properties: Record<string, unknown>;
}

export interface LoadedChartData {
  chartId: string;
  features: Partial<Record<FeatureType, GeoJSONFeatureCollection>>;
}

export interface LoadedMBTilesChart {
  chartId: string;
  path: string;
}

export interface LoadedRasterChart {
  chartId: string;
  path: string;
}

// Display feature configuration for the Display Settings tab
export interface DisplayFeatureConfig {
  id: string;
  label: string;
  type: 'text' | 'line' | 'area';
  fontSizeKey?: keyof DisplaySettings;
  haloKey?: keyof DisplaySettings;  // For text halo/stroke
  strokeKey?: keyof DisplaySettings;  // For line width or area border
  opacityKey?: keyof DisplaySettings;
}

// Symbol feature configuration for the Symbols tab
export interface SymbolFeatureConfig {
  id: string;
  label: string;
  sizeKey: keyof DisplaySettings;
  haloKey: keyof DisplaySettings;
  opacityKey: keyof DisplaySettings;
  color: string;  // S-52 compliant color for visual identification
  hasHalo: boolean;  // Whether this symbol type supports halos
  // Optional text settings for symbols that have associated labels
  hasText?: boolean;
  textSizeKey?: keyof DisplaySettings;
  textHaloKey?: keyof DisplaySettings;
  textOpacityKey?: keyof DisplaySettings;
}

// Layer visibility state - consolidated for performance
export interface LayerVisibility {
  depthAreas: boolean;
  depthContours: boolean;
  soundings: boolean;
  land: boolean;
  coastline: boolean;
  lights: boolean;
  buoys: boolean;
  beacons: boolean;
  landmarks: boolean;
  hazards: boolean;
  sectors: boolean;
  cables: boolean;
  seabed: boolean;
  pipelines: boolean;
  bathymetry: boolean;
  restrictedAreas: boolean;
  cautionAreas: boolean;
  militaryAreas: boolean;
  anchorages: boolean;
  anchorBerths: boolean;
  marineFarms: boolean;
  trafficRoutes: boolean;  // Fairways, TSS lanes
  // Infrastructure layers
  bridges: boolean;
  buildings: boolean;
  moorings: boolean;
  shorelineConstruction: boolean;
  seaAreaNames: boolean;
  landRegions: boolean;
  gnisNames: boolean;  // Master toggle for all GNIS place names
  tideStations: boolean;  // Tide station markers
  currentStations: boolean;  // Current station markers
  liveBuoys: boolean;  // Live weather buoy markers
  tideDetails: boolean;  // Tide detail chart at bottom
  currentDetails: boolean;  // Current detail chart at bottom
  waypoints: boolean;  // User waypoint markers
}

export type LayerVisibilityAction =
  | { type: 'TOGGLE'; layer: keyof LayerVisibility }
  | { type: 'SET'; layer: keyof LayerVisibility; value: boolean }
  | { type: 'SET_ALL'; value: boolean };

export type MapStyleOption = 'satellite' | 'light' | 'dark' | 'street' | 'ocean' | 'terrain';

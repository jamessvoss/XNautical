/**
 * Type definitions for DynamicChartViewer
 */

import { FeatureType, GeoJSONFeatureCollection } from '../../types/chart';

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
  // Additional layers
  bridges: boolean;
  buildings: boolean;
  moorings: boolean;
  shorelineConstruction: boolean;
  seaAreaNames: boolean;
  landRegions: boolean;
  gnisNames: boolean;
  tideStations: boolean;
  currentStations: boolean;
  liveBuoys: boolean;
  tideDetails: boolean;
  currentDetails: boolean;
}

export type LayerVisibilityAction = 
  | { type: 'TOGGLE'; layer: keyof LayerVisibility }
  | { type: 'SET'; layer: keyof LayerVisibility; value: boolean }
  | { type: 'SET_ALL'; value: boolean };

export type MapStyleOption = 'light' | 'dark' | 'satellite' | 'outdoors' | 'local';

/**
 * Layer visibility state management
 */

import { LayerVisibility, LayerVisibilityAction } from './types';

export const initialLayerVisibility: LayerVisibility = {
  depthAreas: true,
  depthContours: true,
  soundings: true,
  land: false,
  coastline: true,
  lights: true,
  buoys: true,
  beacons: true,
  landmarks: true,
  hazards: true,
  sectors: true,
  cables: true,
  seabed: true,
  pipelines: true,
  bathymetry: true,
  restrictedAreas: true,
  cautionAreas: false,
  militaryAreas: true,
  anchorages: true,
  anchorBerths: true,
  marineFarms: true,
  // Additional layers
  bridges: true,
  buildings: true,
  moorings: true,
  shorelineConstruction: true,
  seaAreaNames: true,
  landRegions: true,
  gnisNames: true,  // Master toggle for all GNIS place names
  tideStations: true,  // Show tide stations by default
  currentStations: true,  // Show current stations by default
  liveBuoys: true,  // Show live buoys by default
  tideDetails: false,  // Tide detail chart hidden by default
  currentDetails: false,  // Current detail chart hidden by default
  waypoints: true,  // Show user waypoints by default
};

export function layerVisibilityReducer(state: LayerVisibility, action: LayerVisibilityAction): LayerVisibility {
  switch (action.type) {
    case 'TOGGLE':
      return { ...state, [action.layer]: !state[action.layer] };
    case 'SET':
      return { ...state, [action.layer]: action.value };
    case 'SET_ALL':
      const newState: LayerVisibility = {} as LayerVisibility;
      for (const key of Object.keys(state) as (keyof LayerVisibility)[]) {
        newState[key] = action.value;
      }
      return newState;
    default:
      return state;
  }
}

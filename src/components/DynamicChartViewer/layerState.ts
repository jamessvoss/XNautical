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
  cautionAreas: true,
  militaryAreas: true,
  anchorages: true,
  anchorBerths: true,
  marineFarms: true,
  // Additional layers
  bridges: true,
  buildings: true,
  moorings: true,
  shorelineConstruction: true,
  seaAreaNames: false,
  landRegions: false,
  gnisNames: false,
  tideStations: true,
  currentStations: true,
  liveBuoys: true,
  tideDetails: false,
  currentDetails: false,
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

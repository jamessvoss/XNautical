/**
 * Constants and configuration for DynamicChartViewer
 */

// Symbol images for navigation features
export const NAV_SYMBOLS: Record<string, any> = {
  // Lights - use flare style for major visibility
  'light-major': require('../../../assets/symbols/png/light-flare-magenta.png'),
  'light-minor': require('../../../assets/symbols/png/light-point-magenta.png'),
  'light-white': require('../../../assets/symbols/png/light-flare-white.png'),
  'light-red': require('../../../assets/symbols/png/light-flare-red.png'),
  'light-green': require('../../../assets/symbols/png/light-flare-green.png'),
  'lighted-beacon': require('../../../assets/symbols/png/lighted-beacon.png'),
  // Buoys
  'buoy-can': require('../../../assets/symbols/png/buoy-can.png'),
  'buoy-conical': require('../../../assets/symbols/png/buoy-conical.png'),
  'buoy-spherical': require('../../../assets/symbols/png/buoy-spherical.png'),
  'buoy-pillar': require('../../../assets/symbols/png/buoy-pillar.png'),
  'buoy-spar': require('../../../assets/symbols/png/buoy-spar.png'),
  'buoy-barrel': require('../../../assets/symbols/png/buoy-barrel.png'),
  'buoy-super': require('../../../assets/symbols/png/buoy-super.png'),
  // Beacons
  'beacon-stake': require('../../../assets/symbols/png/beacon-stake.png'),
  'beacon-tower': require('../../../assets/symbols/png/beacon-tower.png'),
  'beacon-generic': require('../../../assets/symbols/png/beacon-generic.png'),
  'beacon-lattice': require('../../../assets/symbols/png/beacon-lattice.png'),
  'beacon-withy': require('../../../assets/symbols/png/beacon-withy.png'),
  'beacon-cairn': require('../../../assets/symbols/png/beacon-cairn.png'),
  // Wrecks
  'wreck-danger': require('../../../assets/symbols/png/wreck-danger.png'),
  'wreck-submerged': require('../../../assets/symbols/png/wreck-submerged.png'),
  'wreck-hull': require('../../../assets/symbols/png/wreck-hull.png'),
  'wreck-safe': require('../../../assets/symbols/png/wreck-safe.png'),
  'wreck-uncovers': require('../../../assets/symbols/png/wreck-uncovers.png'),
  // Rocks
  'rock-submerged': require('../../../assets/symbols/png/rock-submerged.png'),
  'rock-awash': require('../../../assets/symbols/png/rock-awash.png'),
  'rock-above-water': require('../../../assets/symbols/png/rock-above-water.png'),
  'rock-uncovers': require('../../../assets/symbols/png/rock-uncovers.png'),
  // Other hazards
  'obstruction': require('../../../assets/symbols/png/obstruction.png'),
  'foul-ground': require('../../../assets/symbols/png/foul-ground.png'),
  // Landmarks
  'landmark-tower': require('../../../assets/symbols/png/landmark-tower.png'),
  'landmark-chimney': require('../../../assets/symbols/png/landmark-chimney.png'),
  'landmark-monument': require('../../../assets/symbols/png/landmark-monument.png'),
  'landmark-flagpole': require('../../../assets/symbols/png/landmark-flagpole.png'),
  'landmark-mast': require('../../../assets/symbols/png/landmark-mast.png'),
  'landmark-radio-tower': require('../../../assets/symbols/png/landmark-radio-tower.png'),
  'landmark-windmill': require('../../../assets/symbols/png/landmark-windmill.png'),
  'landmark-church': require('../../../assets/symbols/png/landmark-church.png'),
};

// Feature lookup optimization constants
// Priority map for O(1) lookup instead of O(n) indexOf
export const NAUTICAL_LAYER_PRIORITIES: Map<string, number> = new Map([
  ['LIGHTS', 100], ['LIGHTS_SECTOR', 99],
  ['BOYLAT', 98], ['BOYCAR', 97], ['BOYSAW', 96], ['BOYSPP', 95], ['BOYISD', 94],
  ['BCNLAT', 93], ['BCNSPP', 92], ['BCNCAR', 91], ['BCNISD', 90], ['BCNSAW', 89],
  ['WRECKS', 88], ['UWTROC', 87], ['OBSTRN', 86],
  ['RESARE', 85], ['CTNARE', 84], ['MIPARE', 83],
  ['ACHARE', 82], ['ACHBRT', 81], ['MARCUL', 80],
  ['LNDMRK', 79], ['CBLSUB', 78], ['CBLARE', 77], ['PIPSOL', 76], ['PIPARE', 75],
  ['SOUNDG', 74], ['DEPARE', 73], ['DEPCNT', 72], ['SBDARE', 71],
  ['DRGARE', 70], ['FAIRWY', 69],
]);

// Layer name to friendly display name mapping
export const LAYER_DISPLAY_NAMES: Record<string, string> = {
  'LIGHTS': 'Light',
  'LIGHTS_SECTOR': 'Light Sector',
  'BOYLAT': 'Lateral Buoy',
  'BOYCAR': 'Cardinal Buoy',
  'BOYSAW': 'Safe Water Buoy',
  'BOYSPP': 'Special Purpose Buoy',
  'BOYISD': 'Isolated Danger Buoy',
  'BCNLAT': 'Lateral Beacon',
  'BCNSPP': 'Special Purpose Beacon',
  'BCNCAR': 'Cardinal Beacon',
  'BCNISD': 'Isolated Danger Beacon',
  'BCNSAW': 'Safe Water Beacon',
  'WRECKS': 'Wreck',
  'UWTROC': 'Underwater Rock',
  'OBSTRN': 'Obstruction',
  'LNDMRK': 'Landmark',
  'CBLSUB': 'Submarine Cable',
  'CBLARE': 'Cable Area',
  'PIPSOL': 'Pipeline',
  'PIPARE': 'Pipeline Area',
  'SOUNDG': 'Sounding',
  'DEPARE': 'Depth Area',
  'DEPCNT': 'Depth Contour',
  'SBDARE': 'Seabed Area',
  'DRGARE': 'Dredged Area',
  'FAIRWAY': 'Fairway',
  'COALNE': 'Coastline',
  'LNDARE': 'Land Area',
  'RESARE': 'Restricted Area',
  'CTNARE': 'Caution Area',
  'MIPARE': 'Military Practice Area',
  'ACHARE': 'Anchorage Area',
  'ACHBRT': 'Anchor Berth',
  'MARCUL': 'Marine Farm/Aquaculture',
};

// Chart scale max zoom levels (from convert.py tippecanoe settings)
// US1: z0-8, US2: z8-12, US3: z10-13, US4: z11-16, US5: z13-18
export const CHART_MAX_ZOOM_LEVELS: Record<number, number> = {
  1: 8,   // US1 Overview
  2: 12,  // US2 General  
  3: 13,  // US3 Coastal
  4: 16,  // US4 Approach
  5: 18,  // US5 Harbor
};

// Default max zoom when no scale number is found
export const DEFAULT_MAX_ZOOM = 18;

// Performance constants
export const PROGRESSIVE_LOADING_BATCH_SIZE = 8;
export const CAMERA_THROTTLE_MS = 100;

// Local offline style for basemap
export const LOCAL_OFFLINE_STYLE = {
  version: 8,
  name: 'Local Offline',
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#f0ede9' } // Light tan/beige for land
    }
  ]
};

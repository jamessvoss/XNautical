/**
 * Constants and configuration for DynamicChartViewer
 */

import type { DisplayFeatureConfig, SymbolFeatureConfig } from './types';

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
  // Beacon halos (white versions for visibility)
  'beacon-tower-halo': require('../../../assets/symbols/png/beacon-tower-halo.png'),
  'beacon-generic-halo': require('../../../assets/symbols/png/beacon-generic-halo.png'),
  'beacon-stake-halo': require('../../../assets/symbols/png/beacon-stake-halo.png'),
  'beacon-lattice-halo': require('../../../assets/symbols/png/beacon-lattice-halo.png'),
  'beacon-withy-halo': require('../../../assets/symbols/png/beacon-withy-halo.png'),
  'beacon-cairn-halo': require('../../../assets/symbols/png/beacon-cairn-halo.png'),
  // Landmark halos (white versions for visibility)
  'landmark-tower-halo': require('../../../assets/symbols/png/landmark-tower-halo.png'),
  'landmark-chimney-halo': require('../../../assets/symbols/png/landmark-chimney-halo.png'),
  'landmark-church-halo': require('../../../assets/symbols/png/landmark-church-halo.png'),
  'landmark-flagpole-halo': require('../../../assets/symbols/png/landmark-flagpole-halo.png'),
  'landmark-mast-halo': require('../../../assets/symbols/png/landmark-mast-halo.png'),
  'landmark-monument-halo': require('../../../assets/symbols/png/landmark-monument-halo.png'),
  'landmark-radio-tower-halo': require('../../../assets/symbols/png/landmark-radio-tower-halo.png'),
  'landmark-windmill-halo': require('../../../assets/symbols/png/landmark-windmill-halo.png'),
  // Buoy halos (white versions for visibility)
  'buoy-pillar-halo': require('../../../assets/symbols/png/buoy-pillar-halo.png'),
  'buoy-spherical-halo': require('../../../assets/symbols/png/buoy-spherical-halo.png'),
  'buoy-super-halo': require('../../../assets/symbols/png/buoy-super-halo.png'),
  'buoy-conical-halo': require('../../../assets/symbols/png/buoy-conical-halo.png'),
  'buoy-can-halo': require('../../../assets/symbols/png/buoy-can-halo.png'),
  'buoy-spar-halo': require('../../../assets/symbols/png/buoy-spar-halo.png'),
  'buoy-barrel-halo': require('../../../assets/symbols/png/buoy-barrel-halo.png'),
  // Hazard halos (white versions for visibility)
  'tide-rips-halo': require('../../../assets/symbols/png/riptide-halo.png'),
  'foul-ground-halo': require('../../../assets/symbols/png/foul-ground-halo.png'),
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
  'tide-rips': require('../../../assets/symbols/png/riptide.png'),
  // Landmarks
  'landmark-tower': require('../../../assets/symbols/png/landmark-tower.png'),
  'landmark-chimney': require('../../../assets/symbols/png/landmark-chimney.png'),
  'landmark-monument': require('../../../assets/symbols/png/landmark-monument.png'),
  'landmark-flagpole': require('../../../assets/symbols/png/landmark-flagpole.png'),
  'landmark-mast': require('../../../assets/symbols/png/landmark-mast.png'),
  'landmark-radio-tower': require('../../../assets/symbols/png/landmark-radio-tower.png'),
  'landmark-windmill': require('../../../assets/symbols/png/landmark-windmill.png'),
  'landmark-church': require('../../../assets/symbols/png/landmark-church.png'),
  // Tide station icons (6 fill levels, rotation handled by MapLibre)
  'tide-0': require('../../../assets/symbols/png/tide-0.png'),
  'tide-20': require('../../../assets/symbols/png/tide-20.png'),
  'tide-40': require('../../../assets/symbols/png/tide-40.png'),
  'tide-60': require('../../../assets/symbols/png/tide-60.png'),
  'tide-80': require('../../../assets/symbols/png/tide-80.png'),
  'tide-100': require('../../../assets/symbols/png/tide-100.png'),
  // Current station icons (6 fill levels, rotation handled by MapLibre)
  'current-0': require('../../../assets/symbols/png/current-0.png'),
  'current-20': require('../../../assets/symbols/png/current-20.png'),
  'current-40': require('../../../assets/symbols/png/current-40.png'),
  'current-60': require('../../../assets/symbols/png/current-60.png'),
  'current-80': require('../../../assets/symbols/png/current-80.png'),
  'current-100': require('../../../assets/symbols/png/current-100.png'),
  // Shared halo for tide and current icons
  'arrow-halo': require('../../../assets/symbols/png/arrow-halo.png'),
  // Live Buoys
  'livebuoy': require('../../../assets/symbols/Custom Symbols/LiveBuoy.png'),
  'livebuoy-halo': require('../../../assets/symbols/Custom Symbols/LiveBuoy-halo.png'),
};

export const getDepthUnitSuffix = (unit: 'meters' | 'feet' | 'fathoms'): string => {
  switch (unit) {
    case 'feet': return 'ft';
    case 'fathoms': return 'fm';
    default: return 'm';
  }
};

export const DISPLAY_FEATURES: DisplayFeatureConfig[] = [
  // Text features (font size + halo + opacity)
  { id: 'soundings', label: 'Soundings', type: 'text', fontSizeKey: 'soundingsFontScale', haloKey: 'soundingsHaloScale', opacityKey: 'soundingsOpacityScale' },
  { id: 'gnis', label: 'Place Names (GNIS)', type: 'text', fontSizeKey: 'gnisFontScale', haloKey: 'gnisHaloScale', opacityKey: 'gnisOpacityScale' },
  { id: 'landRegions', label: 'Land Regions', type: 'text', fontSizeKey: 'landRegionsFontScale', haloKey: 'landRegionsHaloScale', opacityKey: 'landRegionsOpacityScale' },
  { id: 'seaAreaNames', label: 'Sea Area Names', type: 'text', fontSizeKey: 'seaAreaNamesFontScale', haloKey: 'seaAreaNamesHaloScale', opacityKey: 'seaAreaNamesOpacityScale' },
  { id: 'depthContourLabels', label: 'Depth Contour Labels', type: 'text', fontSizeKey: 'depthContourFontScale', haloKey: 'depthContourLabelHaloScale', opacityKey: 'depthContourLabelOpacityScale' },
  { id: 'chartLabels', label: 'Chart Labels', type: 'text', fontSizeKey: 'chartLabelsFontScale', haloKey: 'chartLabelsHaloScale', opacityKey: 'chartLabelsOpacityScale' },
  { id: 'seabedNames', label: 'Seabed Names', type: 'text', fontSizeKey: 'seabedNamesFontScale', haloKey: 'seabedNamesHaloScale', opacityKey: 'seabedNamesOpacityScale' },
  // Line features (thickness + halo + opacity)
  { id: 'depthContourLines', label: 'Depth Contour Lines', type: 'line', strokeKey: 'depthContourLineScale', haloKey: 'depthContourLineHaloScale', opacityKey: 'depthContourLineOpacityScale' },
  { id: 'coastline', label: 'Coastline', type: 'line', strokeKey: 'coastlineLineScale', haloKey: 'coastlineHaloScale', opacityKey: 'coastlineOpacityScale' },
  { id: 'cables', label: 'Cables', type: 'line', strokeKey: 'cableLineScale', haloKey: 'cableLineHaloScale', opacityKey: 'cableLineOpacityScale' },
  { id: 'pipelines', label: 'Pipelines', type: 'line', strokeKey: 'pipelineLineScale', haloKey: 'pipelineLineHaloScale', opacityKey: 'pipelineLineOpacityScale' },
  { id: 'bridges', label: 'Bridges', type: 'line', strokeKey: 'bridgeLineScale', haloKey: 'bridgeLineHaloScale', opacityKey: 'bridgeOpacityScale' },
  { id: 'moorings', label: 'Moorings', type: 'line', strokeKey: 'mooringLineScale', haloKey: 'mooringLineHaloScale', opacityKey: 'mooringOpacityScale' },
  { id: 'shorelineConstruction', label: 'Shoreline Construction', type: 'line', strokeKey: 'shorelineConstructionLineScale', haloKey: 'shorelineConstructionHaloScale', opacityKey: 'shorelineConstructionOpacityScale' },
  // Area features (fill opacity + stroke width)
  { id: 'depthAreas', label: 'Depth Areas', type: 'area', opacityKey: 'depthAreaOpacityScale', strokeKey: 'depthAreaStrokeScale' },
  { id: 'restrictedAreas', label: 'Restricted Areas', type: 'area', opacityKey: 'restrictedAreaOpacityScale', strokeKey: 'restrictedAreaStrokeScale' },
  { id: 'cautionAreas', label: 'Caution Areas', type: 'area', opacityKey: 'cautionAreaOpacityScale', strokeKey: 'cautionAreaStrokeScale' },
  { id: 'militaryAreas', label: 'Military Areas', type: 'area', opacityKey: 'militaryAreaOpacityScale', strokeKey: 'militaryAreaStrokeScale' },
  { id: 'anchorages', label: 'Anchorages', type: 'area', opacityKey: 'anchorageOpacityScale', strokeKey: 'anchorageStrokeScale' },
  { id: 'marineFarms', label: 'Marine Farms', type: 'area', opacityKey: 'marineFarmOpacityScale', strokeKey: 'marineFarmStrokeScale' },
  { id: 'cableAreas', label: 'Cable Areas', type: 'area', opacityKey: 'cableAreaOpacityScale', strokeKey: 'cableAreaStrokeScale' },
  { id: 'pipelineAreas', label: 'Pipeline Areas', type: 'area', opacityKey: 'pipelineAreaOpacityScale', strokeKey: 'pipelineAreaStrokeScale' },
  { id: 'fairways', label: 'Fairways', type: 'area', opacityKey: 'fairwayOpacityScale', strokeKey: 'fairwayStrokeScale' },
  { id: 'dredgedAreas', label: 'Dredged Areas', type: 'area', opacityKey: 'dredgedAreaOpacityScale', strokeKey: 'dredgedAreaStrokeScale' },
];

// Symbol features configuration for the Symbols tab
// Colors based on S-52 standard presentation library
export const SYMBOL_FEATURES: SymbolFeatureConfig[] = [
  { id: 'lights', label: 'Lights', sizeKey: 'lightSymbolSizeScale', haloKey: 'lightSymbolHaloScale', opacityKey: 'lightSymbolOpacityScale', color: '#FF00FF', hasHalo: false },
  { id: 'buoys', label: 'Buoys', sizeKey: 'buoySymbolSizeScale', haloKey: 'buoySymbolHaloScale', opacityKey: 'buoySymbolOpacityScale', color: '#FF0000', hasHalo: true },
  { id: 'beacons', label: 'Beacons', sizeKey: 'beaconSymbolSizeScale', haloKey: 'beaconSymbolHaloScale', opacityKey: 'beaconSymbolOpacityScale', color: '#00AA00', hasHalo: true },
  { id: 'wrecks', label: 'Wrecks', sizeKey: 'wreckSymbolSizeScale', haloKey: 'wreckSymbolHaloScale', opacityKey: 'wreckSymbolOpacityScale', color: '#000000', hasHalo: false },
  { id: 'rocks', label: 'Rocks', sizeKey: 'rockSymbolSizeScale', haloKey: 'rockSymbolHaloScale', opacityKey: 'rockSymbolOpacityScale', color: '#000000', hasHalo: false },
  { id: 'hazards', label: 'Hazards', sizeKey: 'hazardSymbolSizeScale', haloKey: 'hazardSymbolHaloScale', opacityKey: 'hazardSymbolOpacityScale', color: '#000000', hasHalo: true },
  { id: 'landmarks', label: 'Landmarks', sizeKey: 'landmarkSymbolSizeScale', haloKey: 'landmarkSymbolHaloScale', opacityKey: 'landmarkSymbolOpacityScale', color: '#8B4513', hasHalo: true },
  { id: 'moorings', label: 'Moorings', sizeKey: 'mooringSymbolSizeScale', haloKey: 'mooringSymbolHaloScale', opacityKey: 'mooringSymbolOpacityScale', color: '#800080', hasHalo: false },
  { id: 'anchors', label: 'Anchors', sizeKey: 'anchorSymbolSizeScale', haloKey: 'anchorSymbolHaloScale', opacityKey: 'anchorSymbolOpacityScale', color: '#800080', hasHalo: false },
  { id: 'tideRips', label: 'Tide Rips', sizeKey: 'tideRipsSymbolSizeScale', haloKey: 'tideRipsSymbolHaloScale', opacityKey: 'tideRipsSymbolOpacityScale', color: '#00CED1', hasHalo: true },
  { id: 'tideStations', label: 'Tide Stations', sizeKey: 'tideStationSymbolSizeScale', haloKey: 'tideStationSymbolHaloScale', opacityKey: 'tideStationSymbolOpacityScale', color: '#0066CC', hasHalo: true, hasText: true, textSizeKey: 'tideStationTextSizeScale', textHaloKey: 'tideStationTextHaloScale', textOpacityKey: 'tideStationTextOpacityScale' },
  { id: 'currentStations', label: 'Current Stations', sizeKey: 'currentStationSymbolSizeScale', haloKey: 'currentStationSymbolHaloScale', opacityKey: 'currentStationSymbolOpacityScale', color: '#CC0066', hasHalo: true, hasText: true, textSizeKey: 'currentStationTextSizeScale', textHaloKey: 'currentStationTextHaloScale', textOpacityKey: 'currentStationTextOpacityScale' },
  { id: 'liveBuoys', label: 'Live Buoys', sizeKey: 'liveBuoySymbolSizeScale', haloKey: 'liveBuoySymbolHaloScale', opacityKey: 'liveBuoySymbolOpacityScale', color: '#FF8C00', hasHalo: true, hasText: true, textSizeKey: 'liveBuoyTextSizeScale', textHaloKey: 'liveBuoyTextHaloScale', textOpacityKey: 'liveBuoyTextOpacityScale' },
];

// OBJL code to layer name mapping (S-57 standard)
// Source: GDAL s57objectclasses.csv (IHO S-57 Edition 3.1)
export const OBJL_NAMES: Record<number, string> = {
  3: 'ACHBRT', 4: 'ACHARE',
  5: 'BCNCAR', 6: 'BCNISD', 7: 'BCNLAT', 8: 'BCNSAW', 9: 'BCNSPP',
  11: 'BRIDGE', 12: 'BUISGL',
  14: 'BOYCAR', 15: 'BOYINB', 16: 'BOYISD', 17: 'BOYLAT', 18: 'BOYSAW', 19: 'BOYSPP',
  20: 'CBLARE', 21: 'CBLOHD', 22: 'CBLSUB',
  27: 'CTNARE', 30: 'COALNE',
  39: 'DAYMAR', 42: 'DEPARE', 43: 'DEPCNT', 46: 'DRGARE',
  51: 'FAIRWY', 58: 'FOGSIG', 65: 'HULKES', 69: 'LAKARE',
  71: 'LNDARE', 72: 'LNDELV', 73: 'LNDRGN', 74: 'LNDMRK', 75: 'LIGHTS',
  82: 'MARCUL', 83: 'MIPARE', 84: 'MORFAC', 85: 'NAVLNE', 86: 'OBSTRN',
  90: 'PILPNT', 92: 'PIPARE', 94: 'PIPSOL', 95: 'PONTON',
  109: 'RECTRC', 112: 'RESARE', 114: 'RIVERS',
  119: 'SEAARE', 121: 'SBDARE', 122: 'SLCONS',
  129: 'SOUNDG', 144: 'TOPMAR', 145: 'TSELNE', 148: 'TSSLPT',
  153: 'UWTROC', 156: 'WATTUR', 159: 'WRECKS',
};

// Helper to get layer name from OBJL code
export const getLayerName = (props: any): string => {
  const objl = props?.OBJL;
  return objl ? (OBJL_NAMES[objl] || `OBJL_${objl}`) : 'Unknown';
};

// Priority map for O(1) lookup - using OBJL codes for reliability
// OBJL codes per IHO S-57 Edition 3.1
export const OBJL_PRIORITIES: Map<number, number> = new Map([
  [75, 100],   // LIGHTS
  [17, 98], [14, 97], [18, 96], [19, 95], [16, 94], [15, 93],  // Buoys
  [7, 92], [9, 91], [5, 90], [6, 89], [8, 88],  // Beacons
  [159, 87], [153, 86], [86, 85],  // WRECKS, UWTROC, OBSTRN
  [112, 84], [27, 83], [83, 82],   // RESARE, CTNARE, MIPARE
  [4, 81], [3, 80], [82, 79],      // ACHARE, ACHBRT, MARCUL
  [74, 78],  // LNDMRK
  [84, 77],  // MORFAC (Mooring Facility)
  [22, 76], [20, 75], [94, 74], [92, 73],  // Cables and pipes
  [12, 72],  // BRIDGE
  [129, 71], [42, 70], [43, 69], [114, 68], [121, 68],  // SOUNDG, DEPARE, DEPCNT, SBDARE
  [46, 67], [57, 66],  // DRGARE, FAIRWY
  [122, 65], // SLCONS (Shoreline Construction)
  [20, 64],  // BUISGL (Building)
  [73, 63],  // LNDRGN (Land Region)
  [119, 62], // SEAARE (Sea Area names)
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
  'WATTUR': 'Water Turbulence',
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
  'FAIRWY': 'Fairway',
  'COALNE': 'Coastline',
  'LNDARE': 'Land Area',
  'RESARE': 'Restricted Area',
  'CTNARE': 'Caution Area',
  'MIPARE': 'Military Practice Area',
  'ACHARE': 'Anchorage Area',
  'ACHBRT': 'Anchor Berth',
  'MARCUL': 'Marine Farm/Aquaculture',
  'BRIDGE': 'Bridge',
  'BUISGL': 'Building',
  'MORFAC': 'Mooring Facility',
  'SLCONS': 'Shoreline Construction',
  'SEAARE': 'Sea Area',
  'LNDRGN': 'Land Region',
};

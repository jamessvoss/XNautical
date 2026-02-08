/**
 * Dynamic Chart Viewer - Renders downloaded charts from local cache
 * Full-featured viewer with all navigation layers
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, useReducer, startTransition, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  InteractionManager,
  Dimensions,
  Switch,
  Modal,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapLibre from '@maplibre/maplibre-react-native';
import {
  FeatureType,
  GeoJSONFeatureCollection,
  ALL_FEATURE_TYPES,
} from '../types/chart';
import * as chartCacheService from '../services/chartCacheService';
import * as chartPackService from '../services/chartPackService';
import * as tileServer from '../services/tileServer';
import {
  DEPTH_COLORS,
  SECTOR_COLOURS,
  extractSectorFeatures,
  formatLightInfo,
  formatBuoyInfo,
  formatBeaconInfo,
  formatLandmarkInfo,
  formatSeabedInfo,
  formatCableInfo,
  formatDepthInfo,
} from '../utils/chartRendering';
import ChartDebugOverlay from './ChartDebugOverlay';
import { useGPS } from '../hooks/useGPS';
import { useOverlay } from '../contexts/OverlayContext';
import { getCompassModeLabel } from '../utils/compassUtils';
import * as displaySettingsService from '../services/displaySettingsService';
import type { DisplaySettings } from '../services/displaySettingsService';
import { logger, LogCategory } from '../services/loggingService';
import { performanceTracker, StartupPhase, RuntimeMetric } from '../services/performanceTracker';
import { stateReporter } from '../services/stateReporter';
import * as themeService from '../services/themeService';
import type { S52DisplayMode } from '../services/themeService';
import { fetchTideStations, fetchCurrentStations, getCachedTideStations, getCachedCurrentStations, loadFromStorage, TideStation, CurrentStation } from '../services/stationService';
import { calculateAllStationStates, TideStationState, CurrentStationState, createIconNameMap } from '../services/stationStateService';
import { getBuoysCatalog, getBuoy, BuoySummary, Buoy } from '../services/buoyService';
import StationInfoModal from './StationInfoModal';
import TideDetailChart from './TideDetailChart';
import CurrentDetailChart from './CurrentDetailChart';
import BuoyDetailModal from './BuoyDetailModal';
import { Ionicons } from '@expo/vector-icons';
import { useWaypoints } from '../contexts/WaypointContext';
import { WaypointMapPin } from './WaypointIcons';

// MapLibre doesn't require an access token

// Symbol images for navigation features
const NAV_SYMBOLS: Record<string, any> = {
  // Lights - use flare style for major visibility
  'light-major': require('../../assets/symbols/png/light-flare-magenta.png'),
  'light-minor': require('../../assets/symbols/png/light-point-magenta.png'),
  'light-white': require('../../assets/symbols/png/light-flare-white.png'),
  'light-red': require('../../assets/symbols/png/light-flare-red.png'),
  'light-green': require('../../assets/symbols/png/light-flare-green.png'),
  'lighted-beacon': require('../../assets/symbols/png/lighted-beacon.png'),
  // Buoys
  'buoy-can': require('../../assets/symbols/png/buoy-can.png'),
  'buoy-conical': require('../../assets/symbols/png/buoy-conical.png'),
  'buoy-spherical': require('../../assets/symbols/png/buoy-spherical.png'),
  'buoy-pillar': require('../../assets/symbols/png/buoy-pillar.png'),
  'buoy-spar': require('../../assets/symbols/png/buoy-spar.png'),
  'buoy-barrel': require('../../assets/symbols/png/buoy-barrel.png'),
  'buoy-super': require('../../assets/symbols/png/buoy-super.png'),
  // Beacons
  'beacon-stake': require('../../assets/symbols/png/beacon-stake.png'),
  'beacon-tower': require('../../assets/symbols/png/beacon-tower.png'),
  'beacon-generic': require('../../assets/symbols/png/beacon-generic.png'),
  'beacon-lattice': require('../../assets/symbols/png/beacon-lattice.png'),
  'beacon-withy': require('../../assets/symbols/png/beacon-withy.png'),
  'beacon-cairn': require('../../assets/symbols/png/beacon-cairn.png'),
  // Beacon halos (white versions for visibility)
  'beacon-tower-halo': require('../../assets/symbols/png/beacon-tower-halo.png'),
  'beacon-generic-halo': require('../../assets/symbols/png/beacon-generic-halo.png'),
  'beacon-stake-halo': require('../../assets/symbols/png/beacon-stake-halo.png'),
  'beacon-lattice-halo': require('../../assets/symbols/png/beacon-lattice-halo.png'),
  'beacon-withy-halo': require('../../assets/symbols/png/beacon-withy-halo.png'),
  'beacon-cairn-halo': require('../../assets/symbols/png/beacon-cairn-halo.png'),
  // Landmark halos (white versions for visibility)
  'landmark-tower-halo': require('../../assets/symbols/png/landmark-tower-halo.png'),
  'landmark-chimney-halo': require('../../assets/symbols/png/landmark-chimney-halo.png'),
  'landmark-church-halo': require('../../assets/symbols/png/landmark-church-halo.png'),
  'landmark-flagpole-halo': require('../../assets/symbols/png/landmark-flagpole-halo.png'),
  'landmark-mast-halo': require('../../assets/symbols/png/landmark-mast-halo.png'),
  'landmark-monument-halo': require('../../assets/symbols/png/landmark-monument-halo.png'),
  'landmark-radio-tower-halo': require('../../assets/symbols/png/landmark-radio-tower-halo.png'),
  'landmark-windmill-halo': require('../../assets/symbols/png/landmark-windmill-halo.png'),
  // Buoy halos (white versions for visibility)
  'buoy-pillar-halo': require('../../assets/symbols/png/buoy-pillar-halo.png'),
  'buoy-spherical-halo': require('../../assets/symbols/png/buoy-spherical-halo.png'),
  'buoy-super-halo': require('../../assets/symbols/png/buoy-super-halo.png'),
  'buoy-conical-halo': require('../../assets/symbols/png/buoy-conical-halo.png'),
  'buoy-can-halo': require('../../assets/symbols/png/buoy-can-halo.png'),
  'buoy-spar-halo': require('../../assets/symbols/png/buoy-spar-halo.png'),
  'buoy-barrel-halo': require('../../assets/symbols/png/buoy-barrel-halo.png'),
  // Hazard halos (white versions for visibility)
  'tide-rips-halo': require('../../assets/symbols/png/riptide-halo.png'),
  'foul-ground-halo': require('../../assets/symbols/png/foul-ground-halo.png'),
  // Wrecks
  'wreck-danger': require('../../assets/symbols/png/wreck-danger.png'),
  'wreck-submerged': require('../../assets/symbols/png/wreck-submerged.png'),
  'wreck-hull': require('../../assets/symbols/png/wreck-hull.png'),
  'wreck-safe': require('../../assets/symbols/png/wreck-safe.png'),
  'wreck-uncovers': require('../../assets/symbols/png/wreck-uncovers.png'),
  // Rocks
  'rock-submerged': require('../../assets/symbols/png/rock-submerged.png'),
  'rock-awash': require('../../assets/symbols/png/rock-awash.png'),
  'rock-above-water': require('../../assets/symbols/png/rock-above-water.png'),
  'rock-uncovers': require('../../assets/symbols/png/rock-uncovers.png'),
  // Other hazards
  'obstruction': require('../../assets/symbols/png/obstruction.png'),
  'foul-ground': require('../../assets/symbols/png/foul-ground.png'),
  'tide-rips': require('../../assets/symbols/png/riptide.png'),
  // Landmarks
  'landmark-tower': require('../../assets/symbols/png/landmark-tower.png'),
  'landmark-chimney': require('../../assets/symbols/png/landmark-chimney.png'),
  'landmark-monument': require('../../assets/symbols/png/landmark-monument.png'),
  'landmark-flagpole': require('../../assets/symbols/png/landmark-flagpole.png'),
  'landmark-mast': require('../../assets/symbols/png/landmark-mast.png'),
  'landmark-radio-tower': require('../../assets/symbols/png/landmark-radio-tower.png'),
  'landmark-windmill': require('../../assets/symbols/png/landmark-windmill.png'),
  'landmark-church': require('../../assets/symbols/png/landmark-church.png'),
  // Tide station icons (6 fill levels, rotation handled by MapLibre)
  'tide-0': require('../../assets/symbols/png/tide-0.png'),
  'tide-20': require('../../assets/symbols/png/tide-20.png'),
  'tide-40': require('../../assets/symbols/png/tide-40.png'),
  'tide-60': require('../../assets/symbols/png/tide-60.png'),
  'tide-80': require('../../assets/symbols/png/tide-80.png'),
  'tide-100': require('../../assets/symbols/png/tide-100.png'),
  // Current station icons (6 fill levels, rotation handled by MapLibre)
  'current-0': require('../../assets/symbols/png/current-0.png'),
  'current-20': require('../../assets/symbols/png/current-20.png'),
  'current-40': require('../../assets/symbols/png/current-40.png'),
  'current-60': require('../../assets/symbols/png/current-60.png'),
  'current-80': require('../../assets/symbols/png/current-80.png'),
  'current-100': require('../../assets/symbols/png/current-100.png'),
  // Shared halo for tide and current icons
  'arrow-halo': require('../../assets/symbols/png/arrow-halo.png'),
  // Live Buoys
  'livebuoy': require('../../assets/symbols/Custom Symbols/LiveBuoy.png'),
  'livebuoy-halo': require('../../assets/symbols/Custom Symbols/LiveBuoy-halo.png'),
};

// Display feature configuration for the Display Settings tab
interface DisplayFeatureConfig {
  id: string;
  label: string;
  type: 'text' | 'line' | 'area';
  fontSizeKey?: keyof DisplaySettings;
  haloKey?: keyof DisplaySettings;  // For text halo/stroke
  strokeKey?: keyof DisplaySettings;  // For line width or area border
  opacityKey?: keyof DisplaySettings;
}

// Symbol feature configuration for the Symbols tab
interface SymbolFeatureConfig {
  id: string;
  label: string;
  sizeKey: keyof DisplaySettings;
  haloKey: keyof DisplaySettings;
  opacityKey: keyof DisplaySettings;
  color: string;  // S-52 compliant color for visual identification
  hasHalo: boolean;  // Whether this symbol type supports halos (complex shapes like beacons don't)
  // Optional text settings for symbols that have associated labels
  hasText?: boolean;
  textSizeKey?: keyof DisplaySettings;
  textHaloKey?: keyof DisplaySettings;
  textOpacityKey?: keyof DisplaySettings;
}

// Depth unit conversion helpers
const METERS_TO_FEET = 3.28084;
const METERS_TO_FATHOMS = 0.546807;

const convertDepth = (meters: number, unit: 'meters' | 'feet' | 'fathoms'): number => {
  switch (unit) {
    case 'feet': return meters * METERS_TO_FEET;
    case 'fathoms': return meters * METERS_TO_FATHOMS;
    default: return meters;
  }
};

const getDepthUnitSuffix = (unit: 'meters' | 'feet' | 'fathoms'): string => {
  switch (unit) {
    case 'feet': return 'ft';
    case 'fathoms': return 'fm';
    default: return 'm';
  }
};

const DISPLAY_FEATURES: DisplayFeatureConfig[] = [
  // Text features (font size + halo + opacity)
  { id: 'soundings', label: 'Soundings', type: 'text', fontSizeKey: 'soundingsFontScale', haloKey: 'soundingsHaloScale', opacityKey: 'soundingsOpacityScale' },
  { id: 'gnis', label: 'Place Names (GNIS)', type: 'text', fontSizeKey: 'gnisFontScale', haloKey: 'gnisHaloScale', opacityKey: 'gnisOpacityScale' },
  { id: 'depthContourLabels', label: 'Depth Contour Labels', type: 'text', fontSizeKey: 'depthContourFontScale', haloKey: 'depthContourLabelHaloScale', opacityKey: 'depthContourLabelOpacityScale' },
  { id: 'chartLabels', label: 'Chart Labels', type: 'text', fontSizeKey: 'chartLabelsFontScale', haloKey: 'chartLabelsHaloScale', opacityKey: 'chartLabelsOpacityScale' },
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
// Note: Halos disabled for all symbols - will implement with white symbol versions later
const SYMBOL_FEATURES: SymbolFeatureConfig[] = [
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
  { id: 'liveBuoys', label: 'Live Buoys', sizeKey: 'liveBuoySymbolSizeScale', haloKey: 'liveBuoySymbolHaloScale', opacityKey: 'liveBuoySymbolOpacityScale', color: '#FF8C00', hasHalo: true },
];

// Feature lookup optimization constants (moved outside component for performance)
// OBJL code to layer name mapping (S-57 standard)
// Source: GDAL s57objectclasses.csv (IHO S-57 Edition 3.1)
const OBJL_NAMES: Record<number, string> = {
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
const getLayerName = (props: any): string => {
  const objl = props?.OBJL;
  return objl ? (OBJL_NAMES[objl] || `OBJL_${objl}`) : 'Unknown';
};

// Priority map for O(1) lookup - using OBJL codes for reliability
// OBJL codes per IHO S-57 Edition 3.1
const OBJL_PRIORITIES: Map<number, number> = new Map([
  [75, 100],   // LIGHTS
  [17, 98], [14, 97], [18, 96], [19, 95], [16, 94], [15, 93],  // Buoys (BOYLAT=17, BOYCAR=14, BOYSAW=18, BOYSPP=19, BOYISD=16, BOYINB=15)
  [7, 92], [9, 91], [5, 90], [6, 89], [8, 88],  // Beacons (BCNLAT=7, BCNSPP=9, BCNCAR=5, BCNISD=6, BCNSAW=8)
  [159, 87], [153, 86], [86, 85],  // WRECKS, UWTROC, OBSTRN
  [112, 84], [27, 83], [83, 82],   // RESARE, CTNARE=27, MIPARE
  [4, 81], [3, 80], [82, 79],      // ACHARE=4, ACHBRT=3, MARCUL=82
  [74, 78],  // LNDMRK
  [84, 77],  // MORFAC (Mooring Facility)
  [22, 76], [20, 75], [94, 74], [92, 73],  // Cables and pipes (CBLSUB=22, CBLARE=20, PIPSOL=94, PIPARE=92)
  [12, 72],  // BRIDGE
  [129, 71], [42, 70], [43, 69], [114, 68], [121, 68],  // SOUNDG, DEPARE, DEPCNT, SBDARE
  [46, 67], [57, 66],  // DRGARE, FAIRWY
  [122, 65], // SLCONS (Shoreline Construction)
  [20, 64],  // BUISGL (Building)
  [73, 63],  // LNDRGN (Land Region)
  [119, 62], // SEAARE (Sea Area names)
]);

// Layer name to friendly display name mapping
const LAYER_DISPLAY_NAMES: Record<string, string> = {
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

interface Props {
  onNavigateToDownloads?: () => void;
}

interface FeatureInfo {
  type: string;
  properties: Record<string, unknown>;
}

interface LoadedChartData {
  chartId: string;
  features: Partial<Record<FeatureType, GeoJSONFeatureCollection>>;
}

interface LoadedMBTilesChart {
  chartId: string;
  path: string;
}

interface LoadedRasterChart {
  chartId: string;
  path: string;
}

// Layer visibility state - consolidated for performance
interface LayerVisibility {
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
  // New infrastructure layers
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

type LayerVisibilityAction = 
  | { type: 'TOGGLE'; layer: keyof LayerVisibility }
  | { type: 'SET'; layer: keyof LayerVisibility; value: boolean }
  | { type: 'SET_ALL'; value: boolean };

const initialLayerVisibility: LayerVisibility = {
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
  // New infrastructure layers
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

function layerVisibilityReducer(state: LayerVisibility, action: LayerVisibilityAction): LayerVisibility {
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

export default function DynamicChartViewer({ onNavigateToDownloads }: Props = {}) {
  // Waypoint context
  const { waypoints: userWaypoints, openCreationModal: openWaypointCreation, openEditModal: openWaypointEdit } = useWaypoints();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  
  // Throttle refs for camera change handler (100ms throttle)
  const lastCameraUpdateRef = useRef<number>(0);
  const pendingCameraStateRef = useRef<any>(null);
  const throttleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Loaded chart data
  const [loading, setLoading] = useState(true);
  const [charts, setCharts] = useState<LoadedChartData[]>([]);
  const [mbtilesCharts, setMbtilesCharts] = useState<LoadedMBTilesChart[]>([]);
  const [chartsToRender, setChartsToRender] = useState<string[]>([]); // Chart IDs to render (progressive loading)
  const [loadingPhase, setLoadingPhase] = useState<'us1' | 'tier1' | 'complete'>('us1');
  const [chartLoadingProgress, setChartLoadingProgress] = useState<{ current: number; total: number; phase: string } | null>(null);
  const [rasterCharts, setRasterCharts] = useState<LoadedRasterChart[]>([]);
  const [tileServerReady, setTileServerReady] = useState(false);
  const [storageUsed, setStorageUsed] = useState<{ total: number; vector: number; raster: number }>({ total: 0, vector: 0, raster: 0 });
  
  // Data source toggles
  const [useMBTiles, setUseMBTiles] = useState(true);
  
  // Composite tile mode - single VectorSource with server-side quilting
  // Per-chart mode has been removed - composite is now the only mode
  const useCompositeTiles = true;
  
  // Layer visibility - consolidated into single reducer for performance (fewer re-renders)
  const [layers, dispatchLayers] = useReducer(layerVisibilityReducer, initialLayerVisibility);
  
  // Helper function for toggle callbacks
  const toggleLayer = useCallback((layer: keyof LayerVisibility) => {
    dispatchLayers({ type: 'TOGGLE', layer });
  }, []);
  
  // Memoized callback for closing feature inspector
  const closeFeatureInspector = useCallback(() => {
    setSelectedFeature(null);
  }, []);
  
  // Destructure for backward compatibility with existing code
  const {
    depthAreas: showDepthAreas,
    depthContours: showDepthContours,
    soundings: showSoundings,
    land: showLand,
    coastline: showCoastline,
    lights: showLights,
    buoys: showBuoys,
    beacons: showBeacons,
    landmarks: showLandmarks,
    hazards: showHazards,
    sectors: showSectors,
    cables: showCables,
    seabed: showSeabed,
    pipelines: showPipelines,
    bathymetry: showBathymetry,
    restrictedAreas: showRestrictedAreas,
    cautionAreas: showCautionAreas,
    militaryAreas: showMilitaryAreas,
    anchorages: showAnchorages,
    anchorBerths: showAnchorBerths,
    marineFarms: showMarineFarms,
    // New infrastructure layers
    bridges: showBridges,
    buildings: showBuildings,
    moorings: showMoorings,
    shorelineConstruction: showShorelineConstruction,
    seaAreaNames: showSeaAreaNames,
    landRegions: showLandRegions,
    gnisNames: showGNISNames,
    tideStations: showTideStations,
    currentStations: showCurrentStations,
    liveBuoys: showLiveBuoys,
    tideDetails: showTideDetails,
    currentDetails: showCurrentDetails,
    waypoints: showWaypoints,
  } = layers;
  
  // GNIS Place Names layer toggles
  const [gnisAvailable, setGnisAvailable] = useState(false);
  const [showPlaceNames, setShowPlaceNames] = useState(true);
  const [showWaterNames, setShowWaterNames] = useState(true);      // Bays, channels, sounds
  const [showCoastalNames, setShowCoastalNames] = useState(true);  // Capes, islands, beaches
  const [showLandmarkNames, setShowLandmarkNames] = useState(true); // Summits, glaciers
  
  // Tide and Current station data
  const [tideStations, setTideStations] = useState<TideStation[]>([]);
  const [currentStations, setCurrentStations] = useState<CurrentStation[]>([]);
  
  // Live Buoy data
  const [liveBuoys, setLiveBuoys] = useState<BuoySummary[]>([]);
  const [selectedBuoy, setSelectedBuoy] = useState<Buoy | null>(null);
  const [loadingBuoyDetail, setLoadingBuoyDetail] = useState(false);
  
  // Station icon states (calculated every 15 minutes)
  const [tideIconMap, setTideIconMap] = useState<Map<string, { iconName: string; rotation: number; currentHeight: number | null; targetHeight: number | null }>>(new Map());
  const [currentIconMap, setCurrentIconMap] = useState<Map<string, { iconName: string; rotation: number; currentVelocity: number | null; targetVelocity: number | null; nextSlackTime: string | null }>>(new Map());
  
  // Station modal state
  const [selectedStation, setSelectedStation] = useState<{
    type: 'tide' | 'current';
    id: string;
    name: string;
  } | null>(null);
  
  // State for detail chart station selection (separate from modal selection)
  const [detailChartTideStationId, setDetailChartTideStationId] = useState<string | null>(null);
  const [detailChartCurrentStationId, setDetailChartCurrentStationId] = useState<string | null>(null);
  
  // Handler for buoy clicks - load and display buoy detail
  const handleBuoyClick = async (buoyId: string) => {
    console.log('[BUOY] Clicked:', buoyId);
    setLoadingBuoyDetail(true);
    try {
      const detail = await getBuoy(buoyId);
      setSelectedBuoy(detail);
      console.log('[BUOY] Loaded detail:', detail?.name);
    } catch (error) {
      console.error('[BUOY] Error loading detail:', error);
      setSelectedBuoy(null);
    } finally {
      setLoadingBuoyDetail(false);
    }
  };

  // Handler for selecting a special feature (tide/current station, live buoy) from the picker
  const handleSpecialFeatureSelect = (feature: FeatureInfo) => {
    const specialType = feature.properties?._specialType;
    const id = feature.properties?.id;
    if (!id) return;
    
    switch (specialType) {
      case 'tideStation':
        console.log('[TIDE PIN SELECT] Station:', id);
        setDetailChartTideStationId(id);
        dispatchLayers({ type: 'SET', layer: 'tideDetails', value: true });
        break;
      case 'currentStation':
        console.log('[CURRENT PIN SELECT] Station:', id);
        setDetailChartCurrentStationId(id);
        dispatchLayers({ type: 'SET', layer: 'currentDetails', value: true });
        break;
      case 'liveBuoy':
        console.log('[BUOY PIN SELECT] Buoy:', id);
        handleBuoyClick(id);
        break;
    }
  };
  
  const [showPopulatedNames, setShowPopulatedNames] = useState(true); // Towns, ports
  const [showStreamNames, setShowStreamNames] = useState(false);    // Rivers, creeks (off by default - too many)
  const [showLakeNames, setShowLakeNames] = useState(false);        // Lakes (off by default)
  const [showTerrainNames, setShowTerrainNames] = useState(false);  // Valleys, basins (off by default)
  
  // Display settings (font scales, line widths, area opacities)
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>({
    // Font sizes (1.5 = nominal 100%, range 1.0-3.0)
    soundingsFontScale: 1.5,
    gnisFontScale: 1.5,
    depthContourFontScale: 1.5,
    chartLabelsFontScale: 1.5,
    // Text halo/stroke
    soundingsHaloScale: 1.0,
    gnisHaloScale: 1.0,
    depthContourLabelHaloScale: 1.0,
    chartLabelsHaloScale: 1.0,
    // Text opacities
    soundingsOpacityScale: 1.0,
    gnisOpacityScale: 1.0,
    depthContourLabelOpacityScale: 1.0,
    chartLabelsOpacityScale: 1.0,
    // Line widths
    depthContourLineScale: 1.0,
    coastlineLineScale: 1.0,
    cableLineScale: 1.0,
    pipelineLineScale: 1.0,
    bridgeLineScale: 1.0,
    mooringLineScale: 1.0,
    shorelineConstructionLineScale: 1.0,
    // Line halos - temporarily disabled to debug crash
    depthContourLineHaloScale: 0,
    coastlineHaloScale: 0,
    cableLineHaloScale: 0,
    pipelineLineHaloScale: 0,
    bridgeLineHaloScale: 0,
    mooringLineHaloScale: 0,
    shorelineConstructionHaloScale: 0,
    // Line opacities
    depthContourLineOpacityScale: 1.0,
    coastlineOpacityScale: 1.0,
    cableLineOpacityScale: 1.0,
    pipelineLineOpacityScale: 1.0,
    bridgeOpacityScale: 1.0,
    mooringOpacityScale: 1.0,
    shorelineConstructionOpacityScale: 1.0,
    // Area opacities
    depthAreaOpacityScale: 1.0,
    restrictedAreaOpacityScale: 1.0,
    cautionAreaOpacityScale: 1.0,
    militaryAreaOpacityScale: 1.0,
    anchorageOpacityScale: 1.0,
    marineFarmOpacityScale: 1.0,
    cableAreaOpacityScale: 1.0,
    pipelineAreaOpacityScale: 1.0,
    fairwayOpacityScale: 1.0,
    dredgedAreaOpacityScale: 1.0,
    // Area strokes
    depthAreaStrokeScale: 1.0,
    restrictedAreaStrokeScale: 1.0,
    cautionAreaStrokeScale: 1.0,
    militaryAreaStrokeScale: 1.0,
    anchorageStrokeScale: 1.0,
    marineFarmStrokeScale: 1.0,
    cableAreaStrokeScale: 1.0,
    pipelineAreaStrokeScale: 1.0,
    fairwayStrokeScale: 1.0,
    dredgedAreaStrokeScale: 1.0,
    // Symbol sizes (nominal values based on S-52 standard visibility)
    lightSymbolSizeScale: 2.0,    // 200% nominal
    buoySymbolSizeScale: 2.0,     // 200% nominal
    beaconSymbolSizeScale: 1.5,   // 150% nominal
    wreckSymbolSizeScale: 1.5,    // 150% nominal
    rockSymbolSizeScale: 1.5,     // 150% nominal
    hazardSymbolSizeScale: 1.5,   // 150% nominal
    landmarkSymbolSizeScale: 1.5, // 150% nominal
    mooringSymbolSizeScale: 1.5,  // 150% nominal
    anchorSymbolSizeScale: 1.5,   // 150% nominal
    tideRipsSymbolSizeScale: 1.5, // 150% nominal
    // Symbol halos (white background for visibility per S-52)
    lightSymbolHaloScale: 0.1,
    buoySymbolHaloScale: 0.1,
    beaconSymbolHaloScale: 0.1,
    wreckSymbolHaloScale: 0.1,
    rockSymbolHaloScale: 0.1,
    hazardSymbolHaloScale: 0.1,
    landmarkSymbolHaloScale: 0.1,
    mooringSymbolHaloScale: 0.1,
    anchorSymbolHaloScale: 0.1,
    tideRipsSymbolHaloScale: 0.1,
    tideStationSymbolSizeScale: 1.0,
    currentStationSymbolSizeScale: 1.0,
    tideStationSymbolHaloScale: 0.1,
    currentStationSymbolHaloScale: 0.1,
    // Symbol opacities
    lightSymbolOpacityScale: 1.0,
    buoySymbolOpacityScale: 1.0,
    beaconSymbolOpacityScale: 1.0,
    wreckSymbolOpacityScale: 1.0,
    rockSymbolOpacityScale: 1.0,
    hazardSymbolOpacityScale: 1.0,
    landmarkSymbolOpacityScale: 1.0,
    mooringSymbolOpacityScale: 1.0,
    anchorSymbolOpacityScale: 1.0,
    tideRipsSymbolOpacityScale: 1.0,
    tideStationSymbolOpacityScale: 1.0,
    currentStationSymbolOpacityScale: 1.0,
    // Live Buoy symbol
    liveBuoySymbolSizeScale: 1.0,
    liveBuoySymbolHaloScale: 0.05,
    liveBuoySymbolOpacityScale: 1.0,
    // Tide station text
    tideStationTextSizeScale: 1.0,
    tideStationTextHaloScale: 0.05,  // 5% default, max 25%
    tideStationTextOpacityScale: 1.0,
    // Current station text
    currentStationTextSizeScale: 1.0,
    currentStationTextHaloScale: 0.05, // 5% default, max 25%
    currentStationTextOpacityScale: 1.0,
    // Other settings
    dayNightMode: 'day',
    orientationMode: 'north-up',
    depthUnits: 'meters',
  });

  // Memoized depth text field expression based on unit setting
  const depthTextFieldExpression = useMemo(() => {
    const unit = displaySettings.depthUnits;
    if (unit === 'feet') {
      // Convert meters to feet: depth * 3.28084
      return ['to-string', ['round', ['*', ['get', 'DEPTH'], 3.28084]]];
    } else if (unit === 'fathoms') {
      // Convert meters to fathoms: depth * 0.546807
      return ['to-string', ['round', ['*', ['get', 'DEPTH'], 0.546807]]];
    }
    // Default: meters
    return ['to-string', ['round', ['get', 'DEPTH']]];
  }, [displaySettings.depthUnits]);

  // Memoized scaled font sizes for performance
  const scaledSoundingsFontSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    4, Math.round(6 * displaySettings.soundingsFontScale),
    8, Math.round(7 * displaySettings.soundingsFontScale),
    10, Math.round(8 * displaySettings.soundingsFontScale),
    12, Math.round(9 * displaySettings.soundingsFontScale),
    14, Math.round(11 * displaySettings.soundingsFontScale),
    18, Math.round(14 * displaySettings.soundingsFontScale),
  ], [displaySettings.soundingsFontScale]);

  const scaledDepthContourFontSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    12, Math.round(11 * displaySettings.depthContourFontScale),
    14, Math.round(13 * displaySettings.depthContourFontScale),
    16, Math.round(15 * displaySettings.depthContourFontScale),
  ], [displaySettings.depthContourFontScale]);

  const scaledGnisFontSizes = useMemo(() => ({
    water: [
      'interpolate', ['linear'], ['zoom'],
      6, Math.round(11 * displaySettings.gnisFontScale),
      7, Math.round(12 * displaySettings.gnisFontScale),
      10, Math.round(14 * displaySettings.gnisFontScale),
      14, Math.round(16 * displaySettings.gnisFontScale),
    ],
    coastal: [
      'interpolate', ['linear'], ['zoom'],
      6, Math.round(10 * displaySettings.gnisFontScale),
      7, Math.round(11 * displaySettings.gnisFontScale),
      10, Math.round(13 * displaySettings.gnisFontScale),
      14, Math.round(15 * displaySettings.gnisFontScale),
    ],
    landmark: [
      'interpolate', ['linear'], ['zoom'],
      8, Math.round(10 * displaySettings.gnisFontScale),
      9, Math.round(11 * displaySettings.gnisFontScale),
      14, Math.round(14 * displaySettings.gnisFontScale),
    ],
    populated: [
      'interpolate', ['linear'], ['zoom'],
      6, Math.round(11 * displaySettings.gnisFontScale),
      7, Math.round(12 * displaySettings.gnisFontScale),
      10, Math.round(14 * displaySettings.gnisFontScale),
      14, Math.round(16 * displaySettings.gnisFontScale),
    ],
    stream: [
      'interpolate', ['linear'], ['zoom'],
      9, Math.round(10 * displaySettings.gnisFontScale),
      10, Math.round(10 * displaySettings.gnisFontScale),
      14, Math.round(12 * displaySettings.gnisFontScale),
    ],
    lake: [
      'interpolate', ['linear'], ['zoom'],
      9, Math.round(10 * displaySettings.gnisFontScale),
      10, Math.round(10 * displaySettings.gnisFontScale),
      14, Math.round(12 * displaySettings.gnisFontScale),
    ],
    terrain: [
      'interpolate', ['linear'], ['zoom'],
      10, Math.round(10 * displaySettings.gnisFontScale),
      11, Math.round(10 * displaySettings.gnisFontScale),
      14, Math.round(12 * displaySettings.gnisFontScale),
    ],
  }), [displaySettings.gnisFontScale]);

  // Memoized scaled text halo widths
  const scaledSoundingsHalo = useMemo(() => 
    1.0 * displaySettings.soundingsHaloScale,
    [displaySettings.soundingsHaloScale]
  );

  const scaledGnisHalo = useMemo(() => 
    0.8 * displaySettings.gnisHaloScale,
    [displaySettings.gnisHaloScale]
  );

  const scaledDepthContourLabelHalo = useMemo(() => 
    0.7 * displaySettings.depthContourLabelHaloScale,
    [displaySettings.depthContourLabelHaloScale]
  );

  const scaledChartLabelsHalo = useMemo(() => 
    1.5 * displaySettings.chartLabelsHaloScale,
    [displaySettings.chartLabelsHaloScale]
  );

  // Memoized scaled text opacities (clamped to 0-1 range)
  const scaledSoundingsOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.soundingsOpacityScale)),
    [displaySettings.soundingsOpacityScale]
  );

  const scaledGnisOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.gnisOpacityScale)),
    [displaySettings.gnisOpacityScale]
  );

  const scaledDepthContourLabelOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.depthContourLabelOpacityScale)),
    [displaySettings.depthContourLabelOpacityScale]
  );

  const scaledChartLabelsOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.chartLabelsOpacityScale)),
    [displaySettings.chartLabelsOpacityScale]
  );

  // Memoized scaled line widths
  const scaledDepthContourLineWidth = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.3 * displaySettings.depthContourLineScale,
    12, 0.7 * displaySettings.depthContourLineScale,
    16, 1.0 * displaySettings.depthContourLineScale,
  ], [displaySettings.depthContourLineScale]);

  const scaledCoastlineLineWidth = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.5 * displaySettings.coastlineLineScale,
    12, 1.0 * displaySettings.coastlineLineScale,
    16, 1.5 * displaySettings.coastlineLineScale,
  ], [displaySettings.coastlineLineScale]);

  const scaledCableLineWidth = useMemo(() => 
    1.5 * displaySettings.cableLineScale,
    [displaySettings.cableLineScale]
  );

  const scaledPipelineLineWidth = useMemo(() => 
    2 * displaySettings.pipelineLineScale,
    [displaySettings.pipelineLineScale]
  );

  const scaledBridgeLineWidth = useMemo(() => 
    3 * displaySettings.bridgeLineScale,
    [displaySettings.bridgeLineScale]
  );

  const scaledMooringLineWidth = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    12, 1.5 * displaySettings.mooringLineScale,
    14, 2.5 * displaySettings.mooringLineScale,
    18, 4 * displaySettings.mooringLineScale,
  ], [displaySettings.mooringLineScale]);

  const scaledShorelineConstructionLineWidth = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    12, 1.5 * displaySettings.shorelineConstructionLineScale,
    14, 2.5 * displaySettings.shorelineConstructionLineScale,
    18, 4 * displaySettings.shorelineConstructionLineScale,
  ], [displaySettings.shorelineConstructionLineScale]);

  // Memoized scaled line halo widths (for shadow layers behind lines)
  const scaledDepthContourLineHalo = useMemo(() => {
    const val = 2.0 * (displaySettings.depthContourLineHaloScale ?? 1.0);
    if (isNaN(val)) logger.warn(LogCategory.SETTINGS, 'scaledDepthContourLineHalo is NaN', { value: displaySettings.depthContourLineHaloScale });
    return val;
  }, [displaySettings.depthContourLineHaloScale]);

  const scaledCoastlineHalo = useMemo(() => {
    const val = 3.0 * (displaySettings.coastlineHaloScale ?? 1.0);
    if (isNaN(val)) logger.warn(LogCategory.SETTINGS, 'scaledCoastlineHalo is NaN', { value: displaySettings.coastlineHaloScale });
    return val;
  }, [displaySettings.coastlineHaloScale]);

  const scaledCableLineHalo = useMemo(() => {
    const val = 2.5 * (displaySettings.cableLineHaloScale ?? 1.0);
    if (isNaN(val)) logger.warn(LogCategory.SETTINGS, 'scaledCableLineHalo is NaN', { value: displaySettings.cableLineHaloScale });
    return val;
  }, [displaySettings.cableLineHaloScale]);

  const scaledPipelineLineHalo = useMemo(() => {
    const val = 3.0 * (displaySettings.pipelineLineHaloScale ?? 1.0);
    if (isNaN(val)) logger.warn(LogCategory.SETTINGS, 'scaledPipelineLineHalo is NaN', { value: displaySettings.pipelineLineHaloScale });
    return val;
  }, [displaySettings.pipelineLineHaloScale]);

  const scaledBridgeLineHalo = useMemo(() => {
    const val = 4.0 * (displaySettings.bridgeLineHaloScale ?? 1.0);
    if (isNaN(val)) logger.warn(LogCategory.SETTINGS, 'scaledBridgeLineHalo is NaN', { value: displaySettings.bridgeLineHaloScale });
    return val;
  }, [displaySettings.bridgeLineHaloScale]);

  const scaledMooringLineHalo = useMemo(() => {
    const val = 3.0 * (displaySettings.mooringLineHaloScale ?? 1.0);
    if (isNaN(val)) logger.warn(LogCategory.SETTINGS, 'scaledMooringLineHalo is NaN', { value: displaySettings.mooringLineHaloScale });
    return val;
  }, [displaySettings.mooringLineHaloScale]);

  const scaledShorelineConstructionHalo = useMemo(() => {
    const val = 3.0 * (displaySettings.shorelineConstructionHaloScale ?? 1.0);
    if (isNaN(val)) logger.warn(LogCategory.SETTINGS, 'scaledShorelineConstructionHalo is NaN', { value: displaySettings.shorelineConstructionHaloScale });
    return val;
  }, [displaySettings.shorelineConstructionHaloScale]);

  // Memoized halo widths for interpolated line layers (mooring, shoreline construction)
  const scaledMooringLineHaloWidth = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    12, (1.5 * displaySettings.mooringLineScale) + scaledMooringLineHalo,
    14, (2.5 * displaySettings.mooringLineScale) + scaledMooringLineHalo,
    18, (4 * displaySettings.mooringLineScale) + scaledMooringLineHalo,
  ], [displaySettings.mooringLineScale, scaledMooringLineHalo]);

  const scaledShorelineConstructionHaloWidth = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    12, (1.5 * displaySettings.shorelineConstructionLineScale) + scaledShorelineConstructionHalo,
    14, (2.5 * displaySettings.shorelineConstructionLineScale) + scaledShorelineConstructionHalo,
    18, (4 * displaySettings.shorelineConstructionLineScale) + scaledShorelineConstructionHalo,
  ], [displaySettings.shorelineConstructionLineScale, scaledShorelineConstructionHalo]);

  // Halo widths for interpolated line widths (depth contours, coastline)
  const scaledDepthContourLineHaloWidth = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    8, (0.3 * displaySettings.depthContourLineScale) + scaledDepthContourLineHalo,
    12, (0.7 * displaySettings.depthContourLineScale) + scaledDepthContourLineHalo,
    16, (1.0 * displaySettings.depthContourLineScale) + scaledDepthContourLineHalo,
  ], [displaySettings.depthContourLineScale, scaledDepthContourLineHalo]);

  const scaledCoastlineHaloWidth = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    8, (0.5 * displaySettings.coastlineLineScale) + scaledCoastlineHalo,
    12, (1.0 * displaySettings.coastlineLineScale) + scaledCoastlineHalo,
    16, (1.5 * displaySettings.coastlineLineScale) + scaledCoastlineHalo,
  ], [displaySettings.coastlineLineScale, scaledCoastlineHalo]);

  // Memoized scaled line opacities (clamped to 0-1 range)
  const scaledDepthContourLineOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.depthContourLineOpacityScale)),
    [displaySettings.depthContourLineOpacityScale]
  );

  const scaledCoastlineOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.coastlineOpacityScale)),
    [displaySettings.coastlineOpacityScale]
  );

  const scaledCableLineOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.cableLineOpacityScale)),
    [displaySettings.cableLineOpacityScale]
  );

  const scaledPipelineLineOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.pipelineLineOpacityScale)),
    [displaySettings.pipelineLineOpacityScale]
  );

  const scaledBridgeOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.bridgeOpacityScale)),
    [displaySettings.bridgeOpacityScale]
  );

  const scaledMooringOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.mooringOpacityScale)),
    [displaySettings.mooringOpacityScale]
  );

  const scaledShorelineConstructionOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.shorelineConstructionOpacityScale)),
    [displaySettings.shorelineConstructionOpacityScale]
  );

  // Memoized scaled area opacities (clamped to 0-1 range)
  const scaledDepthAreaOpacity = useMemo(() => 
    Math.min(1, Math.max(0, 1.0 * displaySettings.depthAreaOpacityScale)),
    [displaySettings.depthAreaOpacityScale]
  );

  const scaledDepthAreaOpacitySatellite = useMemo(() => 
    Math.min(1, Math.max(0, 0.3 * displaySettings.depthAreaOpacityScale)),
    [displaySettings.depthAreaOpacityScale]
  );

  const scaledRestrictedAreaOpacity = useMemo(() => 
    Math.min(1, Math.max(0, 0.2 * displaySettings.restrictedAreaOpacityScale)),
    [displaySettings.restrictedAreaOpacityScale]
  );

  const scaledCautionAreaOpacity = useMemo(() => 
    Math.min(1, Math.max(0, 0.2 * displaySettings.cautionAreaOpacityScale)),
    [displaySettings.cautionAreaOpacityScale]
  );

  const scaledMilitaryAreaOpacity = useMemo(() => 
    Math.min(1, Math.max(0, 0.15 * displaySettings.militaryAreaOpacityScale)),
    [displaySettings.militaryAreaOpacityScale]
  );

  const scaledAnchorageOpacity = useMemo(() => 
    Math.min(1, Math.max(0, 0.15 * displaySettings.anchorageOpacityScale)),
    [displaySettings.anchorageOpacityScale]
  );

  const scaledMarineFarmOpacity = useMemo(() => 
    Math.min(1, Math.max(0, 0.2 * displaySettings.marineFarmOpacityScale)),
    [displaySettings.marineFarmOpacityScale]
  );

  const scaledCableAreaOpacity = useMemo(() => 
    Math.min(1, Math.max(0, 0.15 * displaySettings.cableAreaOpacityScale)),
    [displaySettings.cableAreaOpacityScale]
  );

  const scaledPipelineAreaOpacity = useMemo(() => 
    Math.min(1, Math.max(0, 0.15 * displaySettings.pipelineAreaOpacityScale)),
    [displaySettings.pipelineAreaOpacityScale]
  );

  const scaledFairwayOpacity = useMemo(() => 
    Math.min(1, Math.max(0, 0.3 * displaySettings.fairwayOpacityScale)),
    [displaySettings.fairwayOpacityScale]
  );

  const scaledDredgedAreaOpacity = useMemo(() => 
    Math.min(1, Math.max(0, 0.4 * displaySettings.dredgedAreaOpacityScale)),
    [displaySettings.dredgedAreaOpacityScale]
  );

  // Memoized scaled symbol/icon sizes
  const scaledLightIconSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.3 * displaySettings.lightSymbolSizeScale,
    12, 0.5 * displaySettings.lightSymbolSizeScale,
    16, 0.8 * displaySettings.lightSymbolSizeScale,
  ], [displaySettings.lightSymbolSizeScale]);

  const scaledBuoyIconSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.25 * displaySettings.buoySymbolSizeScale,
    12, 0.4 * displaySettings.buoySymbolSizeScale,
    16, 0.6 * displaySettings.buoySymbolSizeScale,
  ], [displaySettings.buoySymbolSizeScale]);

  const scaledBuoyHaloSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.25 * displaySettings.buoySymbolSizeScale * (1.0 + displaySettings.buoySymbolHaloScale),
    12, 0.4 * displaySettings.buoySymbolSizeScale * (1.0 + displaySettings.buoySymbolHaloScale),
    16, 0.6 * displaySettings.buoySymbolSizeScale * (1.0 + displaySettings.buoySymbolHaloScale),
  ], [displaySettings.buoySymbolSizeScale, displaySettings.buoySymbolHaloScale]);

  const scaledBeaconIconSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.08 * displaySettings.beaconSymbolSizeScale,   // Much smaller at low zoom
    10, 0.15 * displaySettings.beaconSymbolSizeScale,
    12, 0.3 * displaySettings.beaconSymbolSizeScale,
    14, 0.45 * displaySettings.beaconSymbolSizeScale,
    16, 0.6 * displaySettings.beaconSymbolSizeScale,
  ], [displaySettings.beaconSymbolSizeScale]);

  const scaledBeaconHaloSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.08 * displaySettings.beaconSymbolSizeScale * (1.0 + displaySettings.beaconSymbolHaloScale),
    10, 0.15 * displaySettings.beaconSymbolSizeScale * (1.0 + displaySettings.beaconSymbolHaloScale),
    12, 0.3 * displaySettings.beaconSymbolSizeScale * (1.0 + displaySettings.beaconSymbolHaloScale),
    14, 0.45 * displaySettings.beaconSymbolSizeScale * (1.0 + displaySettings.beaconSymbolHaloScale),
    16, 0.6 * displaySettings.beaconSymbolSizeScale * (1.0 + displaySettings.beaconSymbolHaloScale),
  ], [displaySettings.beaconSymbolSizeScale, displaySettings.beaconSymbolHaloScale]);

  const scaledWreckIconSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.3 * displaySettings.wreckSymbolSizeScale,
    12, 0.5 * displaySettings.wreckSymbolSizeScale,
    16, 0.7 * displaySettings.wreckSymbolSizeScale,
  ], [displaySettings.wreckSymbolSizeScale]);

  const scaledRockIconSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.25 * displaySettings.rockSymbolSizeScale,
    12, 0.4 * displaySettings.rockSymbolSizeScale,
    16, 0.6 * displaySettings.rockSymbolSizeScale,
  ], [displaySettings.rockSymbolSizeScale]);

  const scaledHazardIconSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.25 * displaySettings.hazardSymbolSizeScale,
    12, 0.4 * displaySettings.hazardSymbolSizeScale,
    16, 0.6 * displaySettings.hazardSymbolSizeScale,
  ], [displaySettings.hazardSymbolSizeScale]);

  const scaledHazardHaloSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.25 * displaySettings.hazardSymbolSizeScale * (1.0 + displaySettings.hazardSymbolHaloScale),
    12, 0.4 * displaySettings.hazardSymbolSizeScale * (1.0 + displaySettings.hazardSymbolHaloScale),
    16, 0.6 * displaySettings.hazardSymbolSizeScale * (1.0 + displaySettings.hazardSymbolHaloScale),
  ], [displaySettings.hazardSymbolSizeScale, displaySettings.hazardSymbolHaloScale]);

  const scaledLandmarkIconSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.2 * displaySettings.landmarkSymbolSizeScale,
    10, 0.4 * displaySettings.landmarkSymbolSizeScale,
    12, 0.65 * displaySettings.landmarkSymbolSizeScale,
    14, 0.9 * displaySettings.landmarkSymbolSizeScale,
    16, 1.2 * displaySettings.landmarkSymbolSizeScale,
  ], [displaySettings.landmarkSymbolSizeScale]);

  const scaledLandmarkHaloSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.2 * displaySettings.landmarkSymbolSizeScale * (1.0 + displaySettings.landmarkSymbolHaloScale),
    10, 0.4 * displaySettings.landmarkSymbolSizeScale * (1.0 + displaySettings.landmarkSymbolHaloScale),
    12, 0.65 * displaySettings.landmarkSymbolSizeScale * (1.0 + displaySettings.landmarkSymbolHaloScale),
    14, 0.9 * displaySettings.landmarkSymbolSizeScale * (1.0 + displaySettings.landmarkSymbolHaloScale),
    16, 1.2 * displaySettings.landmarkSymbolSizeScale * (1.0 + displaySettings.landmarkSymbolHaloScale),
  ], [displaySettings.landmarkSymbolSizeScale, displaySettings.landmarkSymbolHaloScale]);

  const scaledMooringIconSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.2 * displaySettings.mooringSymbolSizeScale,
    12, 0.35 * displaySettings.mooringSymbolSizeScale,
    16, 0.5 * displaySettings.mooringSymbolSizeScale,
  ], [displaySettings.mooringSymbolSizeScale]);

  const scaledAnchorIconSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.25 * displaySettings.anchorSymbolSizeScale,
    12, 0.4 * displaySettings.anchorSymbolSizeScale,
    16, 0.6 * displaySettings.anchorSymbolSizeScale,
  ], [displaySettings.anchorSymbolSizeScale]);

  const scaledTideRipsIconSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.25 * (displaySettings.tideRipsSymbolSizeScale ?? 1.5),
    12, 0.4 * (displaySettings.tideRipsSymbolSizeScale ?? 1.5),
    16, 0.6 * (displaySettings.tideRipsSymbolSizeScale ?? 1.5),
  ], [displaySettings.tideRipsSymbolSizeScale]);

  const scaledTideRipsHaloSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.25 * (displaySettings.tideRipsSymbolSizeScale ?? 1.5) * (1.0 + (displaySettings.tideRipsSymbolHaloScale ?? 0.1)),
    12, 0.4 * (displaySettings.tideRipsSymbolSizeScale ?? 1.5) * (1.0 + (displaySettings.tideRipsSymbolHaloScale ?? 0.1)),
    16, 0.6 * (displaySettings.tideRipsSymbolSizeScale ?? 1.5) * (1.0 + (displaySettings.tideRipsSymbolHaloScale ?? 0.1)),
  ], [displaySettings.tideRipsSymbolSizeScale, displaySettings.tideRipsSymbolHaloScale]);

  // Memoized scaled symbol/icon opacities (clamped to 0-1 range)
  const scaledLightSymbolOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.lightSymbolOpacityScale)),
    [displaySettings.lightSymbolOpacityScale]
  );

  const scaledBuoySymbolOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.buoySymbolOpacityScale)),
    [displaySettings.buoySymbolOpacityScale]
  );

  const scaledBeaconSymbolOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.beaconSymbolOpacityScale)),
    [displaySettings.beaconSymbolOpacityScale]
  );

  const scaledWreckSymbolOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.wreckSymbolOpacityScale)),
    [displaySettings.wreckSymbolOpacityScale]
  );

  const scaledRockSymbolOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.rockSymbolOpacityScale)),
    [displaySettings.rockSymbolOpacityScale]
  );

  const scaledHazardSymbolOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.hazardSymbolOpacityScale)),
    [displaySettings.hazardSymbolOpacityScale]
  );

  const scaledTideRipsSymbolOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.tideRipsSymbolOpacityScale ?? 1.0)),
    [displaySettings.tideRipsSymbolOpacityScale]
  );

  const scaledLandmarkSymbolOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.landmarkSymbolOpacityScale)),
    [displaySettings.landmarkSymbolOpacityScale]
  );

  const scaledMooringSymbolOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.mooringSymbolOpacityScale)),
    [displaySettings.mooringSymbolOpacityScale]
  );

  const scaledAnchorSymbolOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.anchorSymbolOpacityScale)),
    [displaySettings.anchorSymbolOpacityScale]
  );

  // Tide station symbol scaling (base zoom interpolation with user scale applied)
  const scaledTideStationIconSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    7, 0.3 * (displaySettings.tideStationSymbolSizeScale ?? 1.0),
    12, 1.0 * (displaySettings.tideStationSymbolSizeScale ?? 1.0),
  ], [displaySettings.tideStationSymbolSizeScale]);

  const scaledTideStationHaloSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    7, 0.3 * (displaySettings.tideStationSymbolSizeScale ?? 1.0) * (1.0 + (displaySettings.tideStationSymbolHaloScale ?? 0.1)),
    12, 1.0 * (displaySettings.tideStationSymbolSizeScale ?? 1.0) * (1.0 + (displaySettings.tideStationSymbolHaloScale ?? 0.1)),
  ], [displaySettings.tideStationSymbolSizeScale, displaySettings.tideStationSymbolHaloScale]);

  const scaledTideStationSymbolOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.tideStationSymbolOpacityScale ?? 1.0)),
    [displaySettings.tideStationSymbolOpacityScale]
  );

  // Current station symbol scaling (base zoom interpolation with user scale applied)
  const scaledCurrentStationIconSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    7, 0.3 * (displaySettings.currentStationSymbolSizeScale ?? 1.0),
    12, 1.0 * (displaySettings.currentStationSymbolSizeScale ?? 1.0),
  ], [displaySettings.currentStationSymbolSizeScale]);

  const scaledCurrentStationHaloSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    7, 0.3 * (displaySettings.currentStationSymbolSizeScale ?? 1.0) * (1.0 + (displaySettings.currentStationSymbolHaloScale ?? 0.1)),
    12, 1.0 * (displaySettings.currentStationSymbolSizeScale ?? 1.0) * (1.0 + (displaySettings.currentStationSymbolHaloScale ?? 0.1)),
  ], [displaySettings.currentStationSymbolSizeScale, displaySettings.currentStationSymbolHaloScale]);

  const scaledCurrentStationSymbolOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.currentStationSymbolOpacityScale ?? 1.0)),
    [displaySettings.currentStationSymbolOpacityScale]
  );

  // Tide station text scaling - scales with zoom so em-based offsets scale proportionally
  const scaledTideStationTextSize = useMemo(() => {
    const baseSize = 14 * (displaySettings.tideStationTextSizeScale ?? 1.0);
    return [
      'interpolate', ['linear'], ['zoom'],
      10, baseSize * 0.5,  // 50% at z10
      13, baseSize         // 100% at z13
    ];
  }, [displaySettings.tideStationTextSizeScale]);

  // Slightly larger version for station name labels
  const scaledTideStationLabelSize = useMemo(() => {
    const baseSize = 15 * (displaySettings.tideStationTextSizeScale ?? 1.0);
    return [
      'interpolate', ['linear'], ['zoom'],
      10, baseSize * 0.5,  // 50% at z10
      13, baseSize         // 100% at z13
    ];
  }, [displaySettings.tideStationTextSizeScale]);

  const scaledTideStationTextHalo = useMemo(() => 
    15 * (displaySettings.tideStationTextHaloScale ?? 0.05),
    [displaySettings.tideStationTextHaloScale]
  );

  const scaledTideStationTextOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.tideStationTextOpacityScale ?? 1.0)),
    [displaySettings.tideStationTextOpacityScale]
  );

  // Current station text scaling - scales with zoom so em-based offsets scale proportionally
  const scaledCurrentStationTextSize = useMemo(() => {
    const baseSize = 14 * (displaySettings.currentStationTextSizeScale ?? 1.0);
    return [
      'interpolate', ['linear'], ['zoom'],
      10, baseSize * 0.5,  // 50% at z10
      13, baseSize         // 100% at z13
    ];
  }, [displaySettings.currentStationTextSizeScale]);

  // Slightly larger version for station name labels (1.1x)
  const scaledCurrentStationLabelSize = useMemo(() => {
    const baseSize = 15 * (displaySettings.currentStationTextSizeScale ?? 1.0);
    return [
      'interpolate', ['linear'], ['zoom'],
      10, baseSize * 0.5,  // 50% at z10
      13, baseSize         // 100% at z13
    ];
  }, [displaySettings.currentStationTextSizeScale]);

  const scaledCurrentStationTextHalo = useMemo(() => 
    15 * (displaySettings.currentStationTextHaloScale ?? 0.05),
    [displaySettings.currentStationTextHaloScale]
  );

  const scaledCurrentStationTextOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.currentStationTextOpacityScale ?? 1.0)),
    [displaySettings.currentStationTextOpacityScale]
  );

  // Live buoy symbol scaling
  const scaledLiveBuoyIconSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    5, 0.2 * (displaySettings.liveBuoySymbolSizeScale ?? 1.0),
    10, 0.5 * (displaySettings.liveBuoySymbolSizeScale ?? 1.0),
    14, 1.0 * (displaySettings.liveBuoySymbolSizeScale ?? 1.0),
  ], [displaySettings.liveBuoySymbolSizeScale]);

  const scaledLiveBuoyHaloSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    5, 0.2 * (displaySettings.liveBuoySymbolSizeScale ?? 1.0) * (1.0 + (displaySettings.liveBuoySymbolHaloScale ?? 0.05)),
    10, 0.5 * (displaySettings.liveBuoySymbolSizeScale ?? 1.0) * (1.0 + (displaySettings.liveBuoySymbolHaloScale ?? 0.05)),
    14, 1.0 * (displaySettings.liveBuoySymbolSizeScale ?? 1.0) * (1.0 + (displaySettings.liveBuoySymbolHaloScale ?? 0.05)),
  ], [displaySettings.liveBuoySymbolSizeScale, displaySettings.liveBuoySymbolHaloScale]);

  const scaledLiveBuoySymbolOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.liveBuoySymbolOpacityScale ?? 1.0)),
    [displaySettings.liveBuoySymbolOpacityScale]
  );

  // Note: Symbol halos disabled - will implement with white symbol versions later
  // The halo settings are preserved in DisplaySettings for future use
  
  // UI state
  const [currentZoom, setCurrentZoom] = useState(8);
  const [centerCoord, setCenterCoord] = useState<[number, number]>([-151.55, 59.64]);
  const [selectedFeature, setSelectedFeature] = useState<FeatureInfo | null>(null);
  const [featureChoices, setFeatureChoices] = useState<FeatureInfo[] | null>(null); // Multiple features to choose from
  const [showControls, setShowControls] = useState(false);
  const [showLayerSelector, setShowLayerSelector] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  
  // Control panel tabs
  type ControlPanelTab = 'display' | 'symbols' | 'other';
  const [activeTab, setActiveTab] = useState<ControlPanelTab>('display');
  const [selectedDisplayFeature, setSelectedDisplayFeature] = useState<string>('soundings');
  const [selectedSymbolFeature, setSelectedSymbolFeature] = useState<string>('lights');
  const [symbolEditMode, setSymbolEditMode] = useState<'symbol' | 'text'>('symbol');
  
  // Layers sub-tabs
  type LayersSubTab = 'chart' | 'names' | 'sources';
  const [layersSubTab, setLayersSubTab] = useState<LayersSubTab>('chart');
  
  // Debug: Force VectorSource reload
  const [sourceReloadKey, setSourceReloadKey] = useState(0);
  
  // Track tap start time for end-to-end performance measurement
  const tapStartTimeRef = useRef<number>(0);
  
  // === STYLE SWITCH PERFORMANCE TRACKING ===
  const styleSwitchStartRef = useRef<number>(0);
  const styleSwitchFromRef = useRef<string>('');
  const styleSwitchToRef = useRef<string>('');
  const styleSwitchRenderCountRef = useRef<number>(0);
  
  // S-52 Display Mode (Day/Dusk/Night)
  const [s52Mode, setS52ModeInternal] = useState<S52DisplayMode>('dusk');
  const [uiTheme, setUITheme] = useState(themeService.getUITheme('dusk'));
  
  // Map style options
  type MapStyleOption = 'satellite' | 'light' | 'dark' | 'nautical' | 'street' | 'ocean' | 'terrain';
  const [mapStyle, setMapStyleInternal] = useState<MapStyleOption>('satellite');
  
  // Which styles use the vector basemap tiles (Light/Dark/Nautical/Street all share one download)
  const VECTOR_BASEMAP_STYLES: MapStyleOption[] = ['light', 'dark', 'nautical', 'street'];
  const isVectorStyle = VECTOR_BASEMAP_STYLES.includes(mapStyle);
  
  // Local basemap availability
  const [hasLocalBasemap, setHasLocalBasemap] = useState(false);
  
  // Ocean and Terrain tile sets - per-zoom MBTiles (same pattern as satellite)
  interface TileSet { id: string; minZoom: number; maxZoom: number; }
  const [oceanTileSets, setOceanTileSets] = useState<TileSet[]>([]);
  const [terrainTileSets, setTerrainTileSets] = useState<TileSet[]>([]);
  const hasLocalOcean = oceanTileSets.length > 0;
  const hasLocalTerrain = terrainTileSets.length > 0;
  
  // Basemap tile sets - per-zoom vector MBTiles
  const [basemapTileSets, setBasemapTileSets] = useState<TileSet[]>([]);
  
  // Debug map overrides - toggle individual map sources on/off
  // Keys: 'satellite', 'charts', 'bathymetry', 'gnis', 'basemap', 'ocean', 'terrain'
  const [debugHiddenSources, setDebugHiddenSources] = useState<Set<string>>(new Set());
  const debugIsSourceVisible = useCallback((sourceId: string) => {
    return !debugHiddenSources.has(sourceId);
  }, [debugHiddenSources]);
  const debugToggleSource = useCallback((sourceId: string) => {
    setDebugHiddenSources(prev => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  }, []);
  
  // Set S-52 display mode and update theme
  const setS52Mode = useCallback(async (mode: S52DisplayMode) => {
    await themeService.setDisplayMode(mode);
    setS52ModeInternal(mode);
    setUITheme(themeService.getUITheme(mode));
  }, []);
  
  // Dynamic themed styles - overrides for theme-aware UI
  const themedStyles = useMemo(() => ({
    // Control panel backgrounds
    controlPanel: {
      backgroundColor: uiTheme.panelBackgroundSolid,
      borderColor: uiTheme.border,
    },
    // Tab bar
    tabBar: {
      backgroundColor: uiTheme.cardBackground,
      borderBottomColor: uiTheme.divider,
    },
    tabButton: {
      backgroundColor: uiTheme.tabBackground,
    },
    tabButtonActive: {
      backgroundColor: uiTheme.tabBackgroundActive,
    },
    tabButtonText: {
      color: uiTheme.tabText,
    },
    tabButtonTextActive: {
      color: uiTheme.tabTextActive,
    },
    // Section titles and text
    panelSectionTitle: {
      color: uiTheme.textPrimary,
    },
    // Basemap option buttons
    basemapOption: {
      backgroundColor: uiTheme.buttonBackground,
      borderColor: uiTheme.border,
    },
    basemapOptionActive: {
      backgroundColor: uiTheme.buttonBackgroundActive,
      borderColor: uiTheme.accentPrimary,
    },
    basemapOptionText: {
      color: uiTheme.buttonText,
    },
    basemapOptionTextActive: {
      color: uiTheme.buttonTextActive,
    },
    // Dividers
    panelDivider: {
      backgroundColor: uiTheme.divider,
    },
    // Toggle labels
    toggleLabel: {
      color: uiTheme.textPrimary,
    },
    // Slider
    sliderTrack: {
      color: uiTheme.sliderTrack,
    },
    sliderTrackActive: {
      color: uiTheme.sliderTrackActive,
    },
    sliderThumb: {
      color: uiTheme.sliderThumb,
    },
    // Sub-tabs (layers)
    subTabBar: {
      backgroundColor: uiTheme.cardBackground,
      borderBottomColor: uiTheme.divider,
    },
    subTabButtonText: {
      color: uiTheme.tabText,
    },
    subTabButtonTextActive: {
      color: uiTheme.tabTextActive,
    },
    // Chart info
    activeChartText: {
      color: uiTheme.textPrimary,
    },
    activeChartSubtext: {
      color: uiTheme.textSecondary,
    },
    chartScaleLabel: {
      color: uiTheme.accentPrimary,
    },
    chartScaleCount: {
      color: uiTheme.textSecondary,
    },
    // Scroll content
    tabScrollContent: {
      flex: 1,
      backgroundColor: uiTheme.panelBackgroundSolid,
    },
    // Layer rows
    layerRow: {
      borderBottomColor: uiTheme.divider,
    },
    layerName: {
      color: uiTheme.textPrimary,
    },
    // Symbol items
    symbolItem: {
      borderBottomColor: uiTheme.divider,
    },
    symbolName: {
      color: uiTheme.textPrimary,
    },
    symbolRow: {
      borderBottomColor: uiTheme.divider,
    },
    // GPS button
    centerButton: {
      backgroundColor: uiTheme.panelBackground,
      borderColor: uiTheme.border,
    },
    centerButtonActive: {
      backgroundColor: uiTheme.accentPrimary,
    },
    // Loading overlay
    chartLoadingContainer: {
      backgroundColor: uiTheme.overlayBackground,
    },
    chartLoadingText: {
      color: uiTheme.textPrimary,
    },
    chartLoadingProgress: {
      color: uiTheme.textSecondary,
    },
    // Feature popup
    featurePopup: {
      backgroundColor: uiTheme.panelBackground,
      borderColor: uiTheme.border,
    },
    featurePopupTitle: {
      color: uiTheme.textPrimary,
    },
    featurePopupText: {
      color: uiTheme.textSecondary,
    },
    // Layers tab
    layersColumnTitle: {
      color: uiTheme.textPrimary,
    },
    dataInfoLabel: {
      color: uiTheme.textMuted,
    },
    dataInfoValue: {
      color: uiTheme.textPrimary,
    },
    // Display/Symbols tab
    displayFeatureName: {
      color: uiTheme.textPrimary,
    },
    sliderLabel: {
      color: uiTheme.textSecondary,
    },
    sliderValueText: {
      color: uiTheme.textPrimary,
    },
    // Feature list items
    featureItem: {
      borderBottomColor: uiTheme.divider,
    },
    featureItemSelected: {
      backgroundColor: uiTheme.tabBackgroundActive,
    },
    featureItemText: {
      color: uiTheme.textPrimary,
    },
    featureItemTextSelected: {
      color: uiTheme.tabTextActive,
    },
    // FFToggle
    ffToggleLabel: {
      color: uiTheme.textPrimary,
    },
    // Control rows (Display/Symbols tabs)
    controlRowLabel: {
      color: uiTheme.textSecondary,
    },
    sliderMinMaxLabel: {
      color: uiTheme.textMuted,
    },
    sliderValueCompact: {
      color: uiTheme.textPrimary,
    },
    legendText: {
      color: uiTheme.textSecondary,
    },
    // Feature selector chips
    featureSelectorChipText: {
      color: uiTheme.textSecondary,
    },
    featureSelectorChipTextActive: {
      color: uiTheme.textPrimary,
    },
    // Segmented controls (Other tab)
    segmentOption: {
      borderColor: uiTheme.border,
    },
    segmentOptionActive: {
      backgroundColor: uiTheme.accentPrimary,
    },
    segmentOptionText: {
      color: uiTheme.textSecondary,
    },
    segmentOptionTextActive: {
      color: uiTheme.textOnAccent,
    },
    settingNote: {
      color: uiTheme.textMuted,
    },
  }), [uiTheme, s52Mode]);
  
  // Satellite tile sets - each file covers specific zoom levels
  // Format: satellite_z8.mbtiles, satellite_z0-5.mbtiles, etc.
  const [satelliteTileSets, setSatelliteTileSets] = useState<TileSet[]>([]);
  
  // Wrapper for setMapStyle with timing logs
  const setMapStyle = useCallback((newStyle: MapStyleOption) => {
    const now = Date.now();
    logger.info(LogCategory.UI, `Style switch: "${mapStyle}" → "${newStyle}"`);
    performanceTracker.recordMetric(RuntimeMetric.STYLE_SWITCH);
    
    styleSwitchStartRef.current = now;
    styleSwitchFromRef.current = mapStyle;
    styleSwitchToRef.current = newStyle;
    styleSwitchRenderCountRef.current = 0;
    
    setMapStyleInternal(newStyle);
  }, [mapStyle]);
  
  // Glyphs URL for local font serving (Noto Sans fonts bundled in assets)
  const glyphsUrl = 'http://127.0.0.1:8765/fonts/{fontstack}/{range}.pbf';
  
  // Get S-52 colors for current mode
  const s52Colors = useMemo(() => themeService.getS52ColorTable(s52Mode), [s52Mode]);
  
  // Basemap color palettes - one palette per vector style, driven by S-52 mode
  // These are used by the shared VectorSource layers to render Light/Dark/Nautical/Street
  const basemapPalette = useMemo(() => {
    const palettes = {
      light: {
        bg: '#f5f5f5',
        water: '#aadaff',
        waterway: '#aadaff',
        ice: '#ffffff',
        grass: '#d8e8c8',
        wood: '#c5ddb0',
        wetland: '#d0e8d8',
        residential: '#eee8e0',
        industrial: '#e8e0d8',
        park: '#c8e6c9',
        building: '#e0d8d0',
        road: '#ffffff',
        roadCasing: '#cccccc',
        text: '#333333',
        textHalo: '#ffffff',
        grid: '#c8c8c8',
        waterText: '#5d8cae',
        landcoverOpacity: 0.6,
        buildingOpacity: 0.8,
        parkOpacity: 0.4,
        roadNightDim: 1,
      },
      dark: {
        bg: '#1a1a2e',
        water: '#1a3a5c',
        waterway: '#1a3a5c',
        ice: '#303040',
        grass: '#1a2818',
        wood: '#142014',
        wetland: '#152818',
        residential: '#252028',
        industrial: '#201c24',
        park: '#152018',
        building: '#302830',
        road: '#444444',
        roadCasing: '#222222',
        text: '#cccccc',
        textHalo: '#1a1a2e',
        grid: '#404050',
        waterText: '#4a6a8a',
        landcoverOpacity: 0.4,
        buildingOpacity: 0.5,
        parkOpacity: 0.3,
        roadNightDim: 0.6,
      },
      nautical: {
        bg: s52Colors.LANDA,
        water: s52Colors.WATRW,
        waterway: s52Colors.WATRW,
        ice: s52Mode === 'day' ? '#ffffff' : s52Mode === 'dusk' ? '#404050' : '#202028',
        grass: s52Mode === 'day' ? '#d8e8c8' : s52Mode === 'dusk' ? '#2a3a28' : '#181c18',
        wood: s52Mode === 'day' ? '#c5ddb0' : s52Mode === 'dusk' ? '#283820' : '#141c14',
        wetland: s52Mode === 'day' ? '#d0e8d8' : s52Mode === 'dusk' ? '#203830' : '#101814',
        residential: s52Colors.CHBRN,
        industrial: s52Colors.CHBRN,
        park: s52Mode === 'day' ? '#c8e6c9' : s52Mode === 'dusk' ? '#203828' : '#101810',
        building: s52Colors.CHBRN,
        road: s52Colors.ROADF,
        roadCasing: s52Colors.ROADC,
        text: s52Colors.CHBLK,
        textHalo: s52Mode === 'day' ? '#FFFFFF' : s52Colors.LANDA,
        grid: s52Colors.CHGRD,
        waterText: s52Mode === 'day' ? '#5d8cae' : s52Mode === 'dusk' ? '#6080a0' : '#304050',
        landcoverOpacity: s52Mode === 'day' ? 0.6 : s52Mode === 'dusk' ? 0.3 : 0.1,
        buildingOpacity: s52Mode === 'day' ? 0.8 : s52Mode === 'dusk' ? 0.4 : 0.15,
        parkOpacity: s52Mode === 'day' ? 0.4 : s52Mode === 'dusk' ? 0.2 : 0.08,
        roadNightDim: s52Mode === 'night' ? 0.3 : s52Mode === 'dusk' ? 0.7 : 1,
      },
      street: {
        bg: '#f0ede8',
        water: '#aadaff',
        waterway: '#aadaff',
        ice: '#f0f0f0',
        grass: '#cde6b8',
        wood: '#b8d8a0',
        wetland: '#c0dcc8',
        residential: '#f0e8e0',
        industrial: '#e8dcd0',
        park: '#b8d8a0',
        building: '#d8d0c0',
        road: '#fff5c0',
        roadCasing: '#c8b870',
        text: '#333333',
        textHalo: '#ffffff',
        grid: '#c8c8c8',
        waterText: '#5d8cae',
        landcoverOpacity: 0.7,
        buildingOpacity: 0.85,
        parkOpacity: 0.5,
        roadNightDim: 1,
      },
    };
    // Only return palette for vector styles; raster styles don't need one
    if (mapStyle === 'light' || mapStyle === 'dark' || mapStyle === 'nautical' || mapStyle === 'street') {
      return palettes[mapStyle];
    }
    return palettes.light; // fallback
  }, [mapStyle, s52Colors, s52Mode]);

  // MapLibre background styles per mode
  const mapStyleUrls = useMemo<Record<MapStyleOption, object>>(() => ({
    satellite: { version: 8, glyphs: glyphsUrl, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': s52Colors.DEPDW } }] },
    light: { version: 8, glyphs: glyphsUrl, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f5f5f5' } }] },
    dark: { version: 8, glyphs: glyphsUrl, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#1a1a2e' } }] },
    nautical: { version: 8, glyphs: glyphsUrl, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': s52Colors.LANDA } }] },
    street: { version: 8, glyphs: glyphsUrl, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f0ede8' } }] },
    ocean: { version: 8, glyphs: glyphsUrl, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#1a3a5c' } }] },
    terrain: { version: 8, glyphs: glyphsUrl, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dfe6e9' } }] },
  }), [s52Colors, glyphsUrl]);

  // Debug state
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [showDebug, setShowDebug] = useState(false);
  const [showChartDebug, setShowChartDebug] = useState(false);

  // Debug Map diagnostics - collected on demand
  const [debugDiagnostics, setDebugDiagnostics] = useState<{
    timestamp: string;
    mapStyle: string;
    s52Mode: string;
    tileServerReady: boolean;
    hasLocalBasemap: boolean;
    hasLocalOcean: boolean;
    hasLocalTerrain: boolean;
    gnisAvailable: boolean;
    useMBTiles: boolean;
    useCompositeTiles: boolean;
    tileServerUrl: string;
    styleJSON: string;
    gates: { label: string; expression: string; pass: boolean }[];
    mapLibreSources: { id: string; type: string; urls?: string[] }[];
    mapLibreLayers: { id: string; type: string; source?: string; sourceLayer?: string; visibility?: string }[];
    styleError?: string;
  } | null>(null);

  const runDiagnostics = useCallback(async () => {
    const serverUrl = tileServer.getTileServerUrl();
    const currentStyleJSON = JSON.stringify(mapStyleUrls[mapStyle]);

    // Render gate checks
    const gates = [
      {
        label: 'Vector basemap renders',
        expression: `tileServerReady(${tileServerReady}) && hasLocalBasemap(${hasLocalBasemap}) && isVectorStyle(${isVectorStyle})`,
        pass: tileServerReady && hasLocalBasemap && isVectorStyle,
      },
      {
        label: 'Ocean source renders',
        expression: `tileServerReady(${tileServerReady}) && oceanTileSets.length(${oceanTileSets.length}) > 0 && mapStyle === 'ocean'`,
        pass: tileServerReady && oceanTileSets.length > 0 && mapStyle === 'ocean',
      },
      {
        label: 'Terrain source renders',
        expression: `tileServerReady(${tileServerReady}) && terrainTileSets.length(${terrainTileSets.length}) > 0 && mapStyle === 'terrain'`,
        pass: tileServerReady && terrainTileSets.length > 0 && mapStyle === 'terrain',
      },
      {
        label: 'Charts source renders',
        expression: `useMBTiles(${useMBTiles}) && tileServerReady(${tileServerReady}) && useCompositeTiles(${useCompositeTiles})`,
        pass: useMBTiles && tileServerReady && useCompositeTiles,
      },
      {
        label: 'Satellite source renders',
        expression: `tileServerReady(${tileServerReady}) && satelliteTileSets.length(${satelliteTileSets.length}) > 0`,
        pass: tileServerReady && satelliteTileSets.length > 0,
      },
      {
        label: 'GNIS source renders',
        expression: `tileServerReady(${tileServerReady}) && gnisAvailable(${gnisAvailable}) && showGNISNames(${showGNISNames}) && showPlaceNames(${showPlaceNames})`,
        pass: tileServerReady && gnisAvailable && showGNISNames && showPlaceNames,
      },
    ];

    // Query MapLibre for the live style
    let mapLibreSources: { id: string; type: string; urls?: string[] }[] = [];
    let mapLibreLayers: { id: string; type: string; source?: string; sourceLayer?: string; visibility?: string }[] = [];
    let styleError: string | undefined;

    try {
      if (mapRef.current) {
        // getStyle() returns the current computed style from the native map
        const style = await mapRef.current.getStyle();
        if (style) {
          // Extract sources
          if (style.sources) {
            mapLibreSources = Object.entries(style.sources).map(([id, src]: [string, any]) => ({
              id,
              type: src.type || 'unknown',
              urls: src.tiles || src.url ? [...(src.tiles || []), ...(src.url ? [src.url] : [])] : undefined,
            }));
          }
          // Extract layers in render order
          if (style.layers && Array.isArray(style.layers)) {
            mapLibreLayers = style.layers.map((layer: any) => ({
              id: layer.id || '?',
              type: layer.type || '?',
              source: layer.source,
              sourceLayer: layer['source-layer'],
              visibility: layer.layout?.visibility || 'visible',
            }));
          }
        } else {
          styleError = 'getStyle() returned null/undefined';
        }
      } else {
        styleError = 'mapRef.current is null';
      }
    } catch (e: any) {
      styleError = `getStyle() error: ${e.message || e}`;
    }

    setDebugDiagnostics({
      timestamp: new Date().toISOString(),
      mapStyle,
      s52Mode,
      tileServerReady,
      hasLocalBasemap,
      hasLocalOcean,
      hasLocalTerrain,
      gnisAvailable,
      useMBTiles,
      useCompositeTiles,
      tileServerUrl: serverUrl,
      styleJSON: currentStyleJSON.length > 300 ? currentStyleJSON.substring(0, 300) + '...' : currentStyleJSON,
      gates,
      mapLibreSources,
      mapLibreLayers,
      styleError,
    });
  }, [mapStyle, s52Mode, tileServerReady, hasLocalBasemap, hasLocalOcean, hasLocalTerrain, isVectorStyle, gnisAvailable, useMBTiles, useCompositeTiles, satelliteTileSets, oceanTileSets, terrainTileSets, showGNISNames, showPlaceNames, mapStyleUrls]);
  
  // GPS and Navigation state - overlay visibility from context (rendered in App.tsx)
  const { showGPSPanel, setShowGPSPanel, showCompass, compassMode, cycleCompassMode, updateGPSData, setShowTideDetails: setContextTideDetails, setShowCurrentDetails: setContextCurrentDetails, showDebugMap, setShowDebugMap, showNavData, setShowNavData } = useOverlay();
  const [followGPS, setFollowGPS] = useState(false); // Follow mode - center map on position
  const followGPSRef = useRef(false); // Ref for immediate follow mode check (avoids race condition)
  const pendingCameraMoveTimeout = useRef<NodeJS.Timeout | null>(null); // Track pending camera moves
  const isProgrammaticCameraMove = useRef(false); // Flag to distinguish programmatic vs user camera moves
  const { gpsData, startTracking, stopTracking, toggleTracking } = useGPS();
  
  // Memoize composite tile URL to prevent constant VectorSource re-renders
  const compositeTileUrl = useMemo(() => {
    return `${tileServer.getTileServerUrl()}/tiles/{z}/{x}/{y}.pbf`;
  }, [tileServerReady]); // Only recalculate if server restarts
  
  // Update overlay context with GPS data
  useEffect(() => {
    updateGPSData(gpsData);
  }, [gpsData, updateGPSData]);
  
  // Sync detail chart visibility with overlay context (for compass positioning)
  useEffect(() => {
    setContextTideDetails(showTideDetails);
  }, [showTideDetails, setContextTideDetails]);
  
  useEffect(() => {
    setContextCurrentDetails(showCurrentDetails);
  }, [showCurrentDetails, setContextCurrentDetails]);
  
  // Zoom limiting - constrain zoom to available chart detail
  const [limitZoomToCharts, setLimitZoomToCharts] = useState(true);
  const [isAtMaxZoom, setIsAtMaxZoom] = useState(false);
  
  
  // Calculate max zoom based on most detailed chart available
  // Chart scale max zoom levels (from convert.py tippecanoe settings):
  // US1: z0-8, US2: z8-12, US3: z10-13, US4: z11-16, US5: z13-18
  const getChartMaxZoom = useCallback((chartId: string): number => {
    const match = chartId.match(/^US(\d)/);
    if (!match) return 18; // Non-US charts, allow full zoom
    const scaleNum = parseInt(match[1], 10);
    
    switch (scaleNum) {
      case 1: return 8;   // US1 Overview
      case 2: return 12;  // US2 General  
      case 3: return 13;  // US3 Coastal
      case 4: return 16;  // US4 Approach
      case 5: return 18;  // US5 Harbor
      default: return 18;
    }
  }, []);
  
  // Find the maximum zoom level across all loaded charts
  const maxAvailableZoom = useMemo(() => {
    if (mbtilesCharts.length === 0) return 18;
    
    const maxZoom = mbtilesCharts.reduce((max, chart) => {
      const chartMax = getChartMaxZoom(chart.chartId);
      return Math.max(max, chartMax);
    }, 0);
    
    return maxZoom;
  }, [mbtilesCharts, getChartMaxZoom]);
  
  // Effective max zoom (either limited by charts or unlimited)
  const effectiveMaxZoom = limitZoomToCharts ? maxAvailableZoom : 22;
  
  // Cache buster to force Mapbox to re-fetch tiles
  const [cacheBuster, setCacheBuster] = useState(0);

  // ============================================================
  // DEBUG BUTTON HANDLERS - For diagnosing tile loading issues
  // ============================================================
  
  // Convert lon/lat/zoom to tile coordinates
  const lonLatToTile = useCallback((lon: number, lat: number, zoom: number) => {
    const z = Math.floor(zoom);
    const x = Math.floor((lon + 180) / 360 * Math.pow(2, z));
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, z));
    return { z, x, y };
  }, []);

  // Button 1: Fetch a tile directly from the server
  const debugFetchTile = useCallback(async () => {
    const tile = lonLatToTile(centerCoord[0], centerCoord[1], currentZoom);
    const url = `http://127.0.0.1:8765/tiles/${tile.z}/${tile.x}/${tile.y}.pbf`;
    
    logger.info(LogCategory.TILES, `Fetching tile z${tile.z}/${tile.x}/${tile.y}`);
    
    try {
      const start = Date.now();
      const response = await fetch(url);
      const elapsed = Date.now() - start;
      
      if (response.ok) {
        const blob = await response.blob();
        logger.info(LogCategory.TILES, `Tile fetched: ${blob.size} bytes in ${elapsed}ms`, {
          chartSource: response.headers.get('X-Chart-Source'),
          chartsTried: response.headers.get('X-Charts-Tried'),
        });
      } else {
        logger.warn(LogCategory.TILES, `Tile fetch failed: ${response.status}`);
      }
    } catch (error) {
      logger.error(LogCategory.TILES, 'Tile fetch error', error as Error);
    }
  }, [centerCoord, currentZoom, lonLatToTile]);

  // Button 2: Fetch the TileJSON metadata
  const debugFetchTileJSON = useCallback(async () => {
    const url = 'http://127.0.0.1:8765/tiles.json';
    logger.info(LogCategory.TILES, 'Fetching TileJSON...');
    
    try {
      const response = await fetch(url);
      if (response.ok) {
        const json = await response.json();
        logger.info(LogCategory.TILES, 'TileJSON contents', {
          name: json.name,
          minzoom: json.minzoom,
          maxzoom: json.maxzoom,
          bounds: json.bounds,
          tiles: json.tiles,
        });
      } else {
        logger.warn(LogCategory.TILES, `Failed to fetch TileJSON: ${response.status}`);
      }
    } catch (error) {
      logger.error(LogCategory.TILES, 'TileJSON fetch error', error as Error);
    }
  }, []);

  // Button 3: Log current map state - uses stateReporter.dumpState()
  const debugLogMapState = useCallback(async () => {
    // Use the state reporter for comprehensive state dump
    await stateReporter.dumpState();
  }, []);

  // Button 4: Force reload the VectorSource
  const debugForceReload = useCallback(() => {
    logger.info(LogCategory.CHARTS, `Force reload: key ${sourceReloadKey} → ${sourceReloadKey + 1}`);
    setSourceReloadKey(sourceReloadKey + 1);
  }, [sourceReloadKey]);

  // Button 5: Scan files on device - list all files with sizes
  const debugScanFiles = useCallback(async () => {
    const FileSystem = require('expo-file-system/legacy');
    const mbtilesDir = `${FileSystem.documentDirectory}mbtiles`;
    
    logger.info(LogCategory.CHARTS, `Scanning files in ${mbtilesDir}`);
    
    try {
      const dirInfo = await FileSystem.getInfoAsync(mbtilesDir);
      if (!dirInfo.exists) {
        logger.warn(LogCategory.CHARTS, 'Directory does not exist');
        return;
      }
      
      const files = await FileSystem.readDirectoryAsync(mbtilesDir);
      let totalSize = 0;
      const fileList: { name: string; sizeMB: string }[] = [];
      
      for (const filename of files) {
        const filePath = `${mbtilesDir}/${filename}`;
        try {
          const fileInfo = await FileSystem.getInfoAsync(filePath, { size: true });
          const size = fileInfo.size || 0;
          totalSize += size;
          fileList.push({ name: filename, sizeMB: (size / 1024 / 1024).toFixed(2) });
        } catch (e) {
          fileList.push({ name: filename, sizeMB: 'error' });
        }
      }
      
      logger.info(LogCategory.CHARTS, `Scan complete: ${files.length} files, ${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB total`);
      
      // Check for manifest.json
      const manifestPath = `${mbtilesDir}/manifest.json`;
      const manifestInfo = await FileSystem.getInfoAsync(manifestPath);
      if (manifestInfo.exists) {
        const content = await FileSystem.readAsStringAsync(manifestPath);
        const manifest = JSON.parse(content);
        logger.info(LogCategory.CHARTS, 'Manifest found', {
          packs: manifest.packs?.length || 0,
          basePacks: manifest.basePacks?.length || 0,
        });
      }
      
    } catch (error) {
      logger.error(LogCategory.CHARTS, 'Scan error', error as Error);
    }
  }, []);

  // Track last manifest modification time to detect downloads
  const lastManifestTimeRef = useRef<number>(0);
  const lastStationsTimeRef = useRef<number>(0);
  
  // Load cached charts
  useEffect(() => {
    loadCharts();
    
    // Cleanup on unmount
    return () => {
      tileServer.stopTileServer();
    };
  }, []);
  
  // Check if any data was downloaded and reload when returning to map screen
  useFocusEffect(
    useCallback(() => {
      const checkChangesAndReload = async () => {
        try {
          const FileSystem = require('expo-file-system/legacy');
          const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
          const mbtilesDir = `${FileSystem.documentDirectory}mbtiles`;
          
          let needsFullReload = false;
          
          // Check for manifest changes (chart downloads)
          const manifestPath = `${mbtilesDir}/manifest.json`;
          const manifestInfo = await FileSystem.getInfoAsync(manifestPath);
          if (manifestInfo.exists && manifestInfo.modificationTime) {
            const currentTime = manifestInfo.modificationTime;
            if (lastManifestTimeRef.current > 0 && currentTime > lastManifestTimeRef.current) {
              logger.info(LogCategory.CHARTS, 'Manifest updated - will reload charts');
              needsFullReload = true;
            }
            lastManifestTimeRef.current = currentTime;
          }
          
          // Check for new tile files by scanning directory
          if (!needsFullReload) {
            try {
              const dirInfo = await FileSystem.getInfoAsync(mbtilesDir);
              if (dirInfo.exists) {
                const files = await FileSystem.readDirectoryAsync(mbtilesDir);
                const currentSatelliteCount = files.filter((f: string) => f.startsWith('satellite_z') && f.endsWith('.mbtiles')).length;
                const currentBasemapCount = files.filter((f: string) => f.startsWith('basemap_z') && f.endsWith('.mbtiles')).length;
                const currentOceanCount = files.filter((f: string) => f.startsWith('ocean_z') && f.endsWith('.mbtiles')).length;
                const currentTerrainCount = files.filter((f: string) => f.startsWith('terrain_z') && f.endsWith('.mbtiles')).length;
                const hasGnis = files.some((f: string) => f.startsWith('gnis_names'));
                const hasBasemap = currentBasemapCount > 0 || files.some((f: string) => f.startsWith('basemap') && f.endsWith('.mbtiles'));
                
                // Compare with current state
                if (currentSatelliteCount !== satelliteTileSets.length) {
                  logger.info(LogCategory.CHARTS, `Satellite files changed: ${satelliteTileSets.length} -> ${currentSatelliteCount}`);
                  needsFullReload = true;
                }
                if (currentBasemapCount !== basemapTileSets.length) {
                  logger.info(LogCategory.CHARTS, `Basemap files changed: ${basemapTileSets.length} -> ${currentBasemapCount}`);
                  needsFullReload = true;
                }
                if (currentOceanCount !== oceanTileSets.length) {
                  logger.info(LogCategory.CHARTS, `Ocean files changed: ${oceanTileSets.length} -> ${currentOceanCount}`);
                  needsFullReload = true;
                }
                if (currentTerrainCount !== terrainTileSets.length) {
                  logger.info(LogCategory.CHARTS, `Terrain files changed: ${terrainTileSets.length} -> ${currentTerrainCount}`);
                  needsFullReload = true;
                }
                if (hasGnis !== gnisAvailable) {
                  logger.info(LogCategory.CHARTS, `GNIS status changed: ${gnisAvailable} -> ${hasGnis}`);
                  needsFullReload = true;
                }
                if (hasBasemap !== hasLocalBasemap) {
                  logger.info(LogCategory.CHARTS, `Basemap status changed: ${hasLocalBasemap} -> ${hasBasemap}`);
                  needsFullReload = true;
                }
              }
            } catch (e) {
              // Ignore scan errors
            }
          }
          
          // Full reload: stop tile server and reload everything
          if (needsFullReload) {
            logger.info(LogCategory.CHARTS, 'Data changed - reloading charts and restarting tile server');
            await tileServer.stopTileServer();
            await loadCharts();
          }
          
          // Check for station changes (prediction downloads)
          const stationsTimestamp = await AsyncStorage.getItem('@XNautical:stationsTimestamp');
          if (stationsTimestamp) {
            const currentStationsTime = parseInt(stationsTimestamp);
            
            if (lastStationsTimeRef.current > 0 && currentStationsTime > lastStationsTimeRef.current) {
              logger.info(LogCategory.CHARTS, 'Station metadata updated - reloading stations');
              
              await loadFromStorage();
              const tides = getCachedTideStations();
              const currents = getCachedCurrentStations();
              
              console.log(`[MAP] Reloaded ${tides.length} tide stations and ${currents.length} current stations after prediction download`);
              
              // Filter current stations (highest bin only)
              const filteredCurrents = (() => {
                const stationsByLocation = new Map<string, CurrentStation[]>();
                
                for (const station of currents) {
                  const locationKey = `${station.lat.toFixed(4)},${station.lng.toFixed(4)}`;
                  if (!stationsByLocation.has(locationKey)) {
                    stationsByLocation.set(locationKey, []);
                  }
                  stationsByLocation.get(locationKey)!.push(station);
                }
                
                const result: CurrentStation[] = [];
                for (const stations of stationsByLocation.values()) {
                  if (stations.length === 1) {
                    result.push(stations[0]);
                  } else {
                    const highestBin = Math.max(...stations.map(s => s.bin || 0));
                    const preferredStation = stations.find(s => s.bin === highestBin);
                    if (preferredStation) {
                      result.push(preferredStation);
                    }
                  }
                }
                
                return result;
              })();
              
              setTideStations(tides);
              setCurrentStations(filteredCurrents);
              
              console.log(`[MAP] Filtered ${currents.length} current stations to ${filteredCurrents.length} (highest bin per location)`);
            }
            
            lastStationsTimeRef.current = currentStationsTime;
          }
        } catch (error) {
          logger.warn(LogCategory.CHARTS, 'Failed to check for updates', { error: (error as Error).message });
        }
      };
      
      checkChangesAndReload();
    }, [satelliteTileSets.length, basemapTileSets.length, oceanTileSets.length, terrainTileSets.length, hasLocalBasemap, gnisAvailable])
  );

  // Load tide and current stations from AsyncStorage on startup
  // Stations are only loaded AFTER predictions are downloaded
  // This prevents showing empty station icons before data is available
  useEffect(() => {
    const loadStations = async () => {
      try {
        console.log('[MAP] Loading stations from AsyncStorage (if available)...');
        // Load from AsyncStorage without fetching from cloud
        // Station metadata is saved when predictions are downloaded
        await loadFromStorage();
        
        const tides = getCachedTideStations();
        const currents = getCachedCurrentStations();
        
        // Only show stations if we actually have data
        if (tides.length === 0 && currents.length === 0) {
          console.log('[MAP] No station metadata found - download predictions to see stations');
          setTideStations([]);
          setCurrentStations([]);
          return;
        }
        
        console.log(`[MAP] Loaded ${tides.length} tide stations and ${currents.length} current stations from AsyncStorage`);
        
        // Filter current stations to only show the highest bin for each station
        // Higher bin numbers are closer to the surface
        const filteredCurrents = (() => {
          // Group stations by base name (location)
          const stationsByLocation = new Map<string, CurrentStation[]>();
          
          for (const station of currents) {
            // Extract base station identifier - stations at same location share lat/lng
            // Use lat/lng as key since station names may vary slightly
            const locationKey = `${station.lat.toFixed(4)},${station.lng.toFixed(4)}`;
            
            if (!stationsByLocation.has(locationKey)) {
              stationsByLocation.set(locationKey, []);
            }
            stationsByLocation.get(locationKey)!.push(station);
          }
          
          // For each location, keep only the station with the highest bin number
          const result: CurrentStation[] = [];
          for (const stations of stationsByLocation.values()) {
            // Find station with highest bin (closest to surface)
            const highestBinStation = stations.reduce((best, current) => 
              current.bin > best.bin ? current : best
            );
            result.push(highestBinStation);
          }
          
          console.log(`[MAP] Filtered ${currents.length} current stations to ${result.length} (highest bin per location)`);
          return result;
        })();
        
        if (tides.length > 0 || filteredCurrents.length > 0) {
          logger.info(LogCategory.DATA, `Loaded ${tides.length} tide stations and ${filteredCurrents.length} current stations (highest bin only) from storage`);
          
          // Log sample coordinates to verify
          if (tides.length > 0) {
            console.log('[MAP] Sample tide station:', { 
              id: tides[0].id, 
              name: tides[0].name, 
              lat: tides[0].lat, 
              lng: tides[0].lng 
            });
          }
          if (filteredCurrents.length > 0) {
            console.log('[MAP] Sample current station:', { 
              id: filteredCurrents[0].id, 
              name: filteredCurrents[0].name, 
              lat: filteredCurrents[0].lat, 
              lng: filteredCurrents[0].lng,
              bin: filteredCurrents[0].bin
            });
          }
          
          setTideStations(tides);
          setCurrentStations(filteredCurrents);
          console.log(`[MAP] Successfully set ${tides.length} tide stations and ${filteredCurrents.length} current stations into state`);
        } else {
          console.log('[MAP] No stations in storage - user needs to press "Refresh Tide Data" in Settings');
        }
      } catch (error) {
        logger.error(LogCategory.DATA, 'Error loading stations', error as Error);
        console.error('[MAP] Error loading stations:', error);
      }
    };
    
    // Load once on mount
    loadStations();
  }, []);

  // Calculate station icon states (runs every 15 minutes)
  useEffect(() => {
    // Don't run if no stations loaded
    if (tideStations.length === 0 && currentStations.length === 0) {
      return;
    }
    
    const updateStationStates = async () => {
      try {
        console.log('[MAP] Calculating station icon states...');
        const states = await calculateAllStationStates(tideStations, currentStations);
        const iconMaps = createIconNameMap(states);
        
        setTideIconMap(iconMaps.tides);
        setCurrentIconMap(iconMaps.currents);
        
        console.log(`[MAP] Updated icon states: ${iconMaps.tides.size} tide, ${iconMaps.currents.size} current`);
      } catch (error) {
        console.error('[MAP] Error calculating station states:', error);
      }
    };
    
    // Calculate immediately
    updateStationStates();
    
    // Set up 15-minute interval
    const intervalId = setInterval(updateStationStates, 15 * 60 * 1000);
    
    return () => {
      clearInterval(intervalId);
    };
  }, [tideStations, currentStations]);

  // Load live buoys catalog - try local cache first, fall back to Firestore
  useEffect(() => {
    const loadBuoys = async () => {
      try {
        console.log('[MAP] Loading live buoys catalog...');
        // Load buoys from all districts (cache-first, falls back to Firestore)
        const allBuoys = await getBuoysCatalog();
        setLiveBuoys(allBuoys);
        console.log(`[MAP] Loaded ${allBuoys.length} live buoys`);
      } catch (error) {
        console.warn('[MAP] Error loading buoys:', error);
      }
    };
    
    loadBuoys();
  }, []);

  // Load and subscribe to display settings
  useEffect(() => {
    const loadDisplaySettings = async () => {
      performanceTracker.startPhase(StartupPhase.DISPLAY_SETTINGS);
      const settings = await displaySettingsService.loadSettings();
      performanceTracker.endPhase(StartupPhase.DISPLAY_SETTINGS);
      logger.debug(LogCategory.SETTINGS, 'Display settings loaded');
      setDisplaySettings(settings);
    };
    loadDisplaySettings();
    
    // Load saved S-52 theme mode
    const loadThemeMode = async () => {
      const savedMode = await themeService.loadSavedMode();
      setS52ModeInternal(savedMode);
      setUITheme(themeService.getUITheme(savedMode));
      logger.debug(LogCategory.SETTINGS, `S-52 display mode loaded: ${savedMode}`);
    };
    loadThemeMode();
    
    // Subscribe to changes from Settings screen
    const unsubscribe = displaySettingsService.subscribe((settings) => {
      logger.debug(LogCategory.SETTINGS, 'Display settings updated via subscription');
      setDisplaySettings(settings);
    });
    
    // Subscribe to theme mode changes
    const unsubscribeTheme = themeService.subscribeToModeChanges((mode) => {
      setS52ModeInternal(mode);
      setUITheme(themeService.getUITheme(mode));
      logger.debug(LogCategory.SETTINGS, `S-52 display mode changed: ${mode}`);
    });
    
    return () => {
      unsubscribe();
      unsubscribeTheme();
    };
  }, []);
  
  // === STYLE SWITCH TRACKING: Log when mapStyle state actually updates ===
  useEffect(() => {
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      logger.debug(LogCategory.UI, `Style switch: React state updated to "${mapStyle}" (${elapsed}ms)`);
    }
  }, [mapStyle]);
  
  // === STYLE SWITCH TRACKING: Log when React commits the render (useLayoutEffect runs sync after DOM mutations) ===
  useLayoutEffect(() => {
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      logger.debug(LogCategory.UI, `Style switch: render committed (${elapsed}ms)`);
    }
  }, [mapStyle]);
  
  // Ref to track if progressive loading is in progress (prevents duplicate runs)
  const progressiveLoadingRef = useRef<boolean>(false);
  
  // Helper: Add charts in batches with yields to keep UI responsive
  const addChartsBatched = useCallback(async (
    currentCharts: string[],
    newCharts: string[],
    batchSize: number = 8,
    phaseName: string
  ): Promise<string[]> => {
    let accumulated = [...currentCharts];
    const total = newCharts.length;
    
    for (let i = 0; i < newCharts.length; i += batchSize) {
      const batch = newCharts.slice(i, i + batchSize);
      accumulated = [...accumulated, ...batch];
      
      // Update progress indicator
      setChartLoadingProgress({
        current: Math.min(i + batchSize, total),
        total,
        phase: phaseName,
      });
      
      // Use startTransition to mark this as a non-urgent update
      startTransition(() => {
        setChartsToRender([...accumulated]);
      });
      
      // Yield to main thread between batches - allows UI to stay responsive
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    return accumulated;
  }, []);
  
  // Progressive loading: Add more charts after initial render
  // Uses InteractionManager, batching, and startTransition for responsiveness
  // SKIPPED when composite mode is enabled (not needed - single VectorSource)
  useEffect(() => {
    // Skip progressive loading in composite mode - not needed
    if (useCompositeTiles) {
      logger.debug(LogCategory.CHARTS, 'Progressive loading skipped - using composite tile mode');
      setLoadingPhase('complete');
      return;
    }
    
    logger.debug(LogCategory.CHARTS, `Progressive effect: phase=${loadingPhase}, serverReady=${tileServerReady}, charts=${mbtilesCharts.length}`);
    
    if (loadingPhase === 'us1' && tileServerReady && mbtilesCharts.length > 0) {
      // Prevent duplicate runs
      if (progressiveLoadingRef.current) {
        return;
      }
      progressiveLoadingRef.current = true;
      
      logger.debug(LogCategory.CHARTS, 'Progressive loading: scheduling Phase 2...');
      
      // Wait for any pending interactions/animations to complete
      const interactionHandle = InteractionManager.runAfterInteractions(async () => {
        logger.debug(LogCategory.CHARTS, 'Progressive loading: Phase 2 starting');
        
        // Get US1 charts (already rendered)
        const us1Charts = mbtilesCharts
          .filter(m => m.chartId.startsWith('US1'))
          .map(m => m.chartId);
        
        // Get US2+US3 charts to add
        const us2us3Charts = mbtilesCharts
          .filter(m => m.chartId.match(/^US[23]/))
          .map(m => m.chartId);
        
        logger.perf(LogCategory.CHARTS, `Phase 2: Adding ${us2us3Charts.length} US2+US3 charts`);
        
        // Add US2+US3 charts in batches
        const tier1All = await addChartsBatched(us1Charts, us2us3Charts, 8, 'Loading coastal charts');
        
        // Clear progress and move to next phase
        setChartLoadingProgress(null);
        setLoadingPhase('tier1');
        
        // Phase 3: Add US4 charts after a brief delay
        setTimeout(async () => {
          const us4Charts = mbtilesCharts
            .filter(m => m.chartId.startsWith('US4'))
            .map(m => m.chartId)
            .slice(0, 100 - tier1All.length); // Fill up to 100
          
          let phase3Total = tier1All;
          if (us4Charts.length > 0) {
            logger.perf(LogCategory.CHARTS, `Phase 3: Adding ${us4Charts.length} US4 charts`);
            phase3Total = await addChartsBatched(tier1All, us4Charts, 10, 'Loading approach charts');
          }
          
          setChartLoadingProgress(null);
          
          // Phase 4: Add US5/US6 charts (harbor/berthing detail)
          setTimeout(async () => {
            const us5us6Charts = mbtilesCharts
              .filter(m => m.chartId.match(/^US[56]/))
              .map(m => m.chartId)
              .slice(0, 150 - phase3Total.length); // Fill up to 150 total
            
            if (us5us6Charts.length > 0) {
              logger.perf(LogCategory.CHARTS, `Phase 4: Adding ${us5us6Charts.length} US5/US6 charts`);
              await addChartsBatched(phase3Total, us5us6Charts, 15, 'Loading harbor charts');
            }
            
            setChartLoadingProgress(null);
            setLoadingPhase('complete');
            progressiveLoadingRef.current = false;
            logger.info(LogCategory.CHARTS, 'Progressive loading: all phases complete');
          }, 150);
        }, 200);
      });
      
      return () => {
        interactionHandle.cancel();
        progressiveLoadingRef.current = false;
      };
    }
  }, [loadingPhase, tileServerReady, mbtilesCharts, addChartsBatched, useCompositeTiles]);
  
  // Auto-start GPS tracking when map loads - always show user's location
  useEffect(() => {
    startTracking();
    // Don't stop tracking on unmount - let the hook handle cleanup
  }, []);
  
  // NOTE: This effect is now REDUNDANT - the button handler already centers the map.
  // Keeping it disabled to avoid duplicate setCamera calls.
  // The button handler at line ~4443 handles the initial center.
  // useEffect(() => {
  //   if (followGPS && gpsData.latitude !== null && gpsData.longitude !== null) {
  //     console.log('[GPS-FOLLOW] Follow mode enabled, initial center');
  //     isProgrammaticCameraMove.current = true;
  //     cameraRef.current?.setCamera({
  //       centerCoordinate: [gpsData.longitude, gpsData.latitude],
  //       animationDuration: 0,
  //     });
  //     setTimeout(() => {
  //       isProgrammaticCameraMove.current = false;
  //     }, 100);
  //   }
  // }, [followGPS]);
  
  // GPS centering is now handled by the Camera component's centerCoordinate prop
  // When followGPS is true, the prop is set to GPS coords; when false, it's undefined
  // This means we don't need to call any camera methods for GPS following
  
  // Sync ref with state for UI updates
  useEffect(() => {
    followGPSRef.current = followGPS;
  }, [followGPS]);

  const loadCharts = async () => {
    // Start performance tracking
    performanceTracker.beginStartup();
    logger.setStartupParam('storagePath', 'file:///storage/emulated/0/Android/data/com.xnautical.app/files/mbtiles');
    
    try {
      setLoading(true);
      
      const FileSystem = require('expo-file-system/legacy');
      
      // === PHASE 1: mbtiles directory - use internal storage (always writable) ===
      performanceTracker.startPhase(StartupPhase.DIRECTORY_SETUP);
      const mbtilesDir = `${FileSystem.documentDirectory}mbtiles`;
      let mbtilesDirectoryReady = false;
      
      // Ensure directory exists
      try {
        const dirInfo = await FileSystem.getInfoAsync(mbtilesDir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(mbtilesDir, { intermediates: true });
          logger.debug(LogCategory.STARTUP, 'Created mbtiles directory');
        }
        mbtilesDirectoryReady = true;
      } catch (e) {
        logger.warn(LogCategory.STARTUP, 'Could not create mbtiles directory - charts will need to be downloaded', { error: e });
        // Continue anyway - user can still download charts through the Downloads modal
      }
      performanceTracker.endPhase(StartupPhase.DIRECTORY_SETUP, { path: mbtilesDir, ready: mbtilesDirectoryReady });
      
      // === PHASE 2: Load manifest.json (chart pack index) ===
      performanceTracker.startPhase(StartupPhase.MANIFEST_LOAD);
      let manifest: { packs?: { id: string; minZoom: number; maxZoom: number; fileSize?: number }[]; basePacks?: { id: string }[] } | null = null;
      let chartPacks: string[] = [];
      
      try {
        const manifestPath = `${mbtilesDir}/manifest.json`;
        const manifestInfo = await FileSystem.getInfoAsync(manifestPath);
        if (manifestInfo.exists) {
          const content = await FileSystem.readAsStringAsync(manifestPath);
          manifest = JSON.parse(content);
          chartPacks = (manifest?.packs || []).map(p => p.id);
          logger.info(LogCategory.CHARTS, `Loaded manifest.json with ${chartPacks.length} chart packs`);
          logger.setStartupParam('manifestLoaded', true);
        } else {
          logger.info(LogCategory.CHARTS, 'No manifest.json found - will scan directory');
          logger.setStartupParam('manifestLoaded', false);
        }
      } catch (e) {
        logger.warn(LogCategory.CHARTS, 'Error loading manifest.json', { error: e });
      }
      performanceTracker.endPhase(StartupPhase.MANIFEST_LOAD, { packsCount: chartPacks.length });
      
      // Legacy variables kept for compatibility
      let tier1ChartIds: string[] = [];
      let tier2ChartIds: string[] = [];
      let totalChartCount = chartPacks.length;
      
      // === PHASE 3: Check for special files (GNIS, satellite, basemap, ocean, terrain) ===
      performanceTracker.startPhase(StartupPhase.SPECIAL_FILES);
      const gnisInfo = await FileSystem.getInfoAsync(`${mbtilesDir}/gnis_names_ak.mbtiles`);
      
      const gnisFound = gnisInfo.exists;
      
      setGnisAvailable(gnisFound);
      
      // Helper: scan for per-zoom MBTiles files matching a prefix pattern
      // Returns sorted TileSet[] parsed from filenames like prefix_z8.mbtiles or prefix_z0-5.mbtiles
      const scanTileSets = (filesInDir: string[], prefix: string): TileSet[] => {
        const sets: TileSet[] = [];
        const pattern = new RegExp(`^${prefix}_z(\\d+)(?:-(\\d+))?\\.mbtiles$`);
        for (const filename of filesInDir) {
          const match = filename.match(pattern);
          if (match) {
            const minZoom = parseInt(match[1], 10);
            const maxZoom = match[2] ? parseInt(match[2], 10) : minZoom;
            sets.push({ id: filename.replace('.mbtiles', ''), minZoom, maxZoom });
          }
        }
        return sets.sort((a, b) => a.minZoom - b.minZoom);
      };
      
      // Scan directory for all tile set types
      let foundSatelliteSets: TileSet[] = [];
      let foundBasemapSets: TileSet[] = [];
      let foundOceanSets: TileSet[] = [];
      let foundTerrainSets: TileSet[] = [];
      let basemapFound = false;
      
      try {
        const filesInDir = await FileSystem.readDirectoryAsync(mbtilesDir);
        
        foundSatelliteSets = scanTileSets(filesInDir, 'satellite');
        foundBasemapSets = scanTileSets(filesInDir, 'basemap');
        foundOceanSets = scanTileSets(filesInDir, 'ocean');
        foundTerrainSets = scanTileSets(filesInDir, 'terrain');
        
        // Also check for legacy monolithic basemap file
        if (foundBasemapSets.length === 0) {
          basemapFound = filesInDir.some(f => f.startsWith('basemap') && f.endsWith('.mbtiles'));
        } else {
          basemapFound = true;
        }
      } catch (e) {
        logger.warn(LogCategory.STARTUP, 'Error scanning for tile files', { error: e });
      }
      
      setSatelliteTileSets(foundSatelliteSets);
      setBasemapTileSets(foundBasemapSets);
      setOceanTileSets(foundOceanSets);
      setTerrainTileSets(foundTerrainSets);
      setHasLocalBasemap(basemapFound);
      
      // Store special files info
      logger.setStartupParam('specialFiles', {
        gnis: gnisFound,
        satellite: foundSatelliteSets.length,
        basemap: foundBasemapSets.length,
        ocean: foundOceanSets.length,
        terrain: foundTerrainSets.length,
      });
      performanceTracker.endPhase(StartupPhase.SPECIAL_FILES, {
        gnis: gnisFound,
        satelliteCount: foundSatelliteSets.length,
        basemapCount: foundBasemapSets.length,
        oceanCount: foundOceanSets.length,
        terrainCount: foundTerrainSets.length,
      });
      
      // === PHASE 4: Build chart list from manifest.json or directory scan ===
      performanceTracker.startPhase(StartupPhase.CHART_DISCOVERY);
      const loadedMbtiles: LoadedMBTilesChart[] = [];
      const loadedRasters: LoadedRasterChart[] = [];
      
      if (manifest && chartPacks.length > 0) {
        // Using manifest.json for pack-based loading
        logger.info(LogCategory.CHARTS, `Using manifest.json with ${chartPacks.length} chart packs`);
        
        // Add chart packs to loaded list (only if file exists)
        for (const pack of manifest.packs || []) {
          const packPath = `${mbtilesDir}/${pack.id}.mbtiles`;
          const packInfo = await FileSystem.getInfoAsync(packPath);
          if (packInfo.exists) {
            loadedMbtiles.push({ 
              chartId: pack.id, 
              path: packPath 
            });
          } else {
            logger.debug(LogCategory.CHARTS, `Skipping ${pack.id} - file not found`);
          }
        }
        
        // Also scan for raster files (BATHY_*) if directory is accessible
        if (mbtilesDirectoryReady) {
          try {
            const filesInDir = await FileSystem.readDirectoryAsync(mbtilesDir);
            for (const filename of filesInDir) {
              if (filename.startsWith('BATHY_') && filename.endsWith('.mbtiles')) {
                const chartId = filename.replace('.mbtiles', '');
                loadedRasters.push({ chartId, path: `${mbtilesDir}/${filename}` });
              }
            }
          } catch (e) {
            // Ignore scan errors for raster files
          }
        }
        
        logger.perf(LogCategory.CHARTS, `Built chart list from manifest.json`, { packs: loadedMbtiles.length });
      } else {
        // No manifest - scan directory for any mbtiles files
        if (mbtilesDirectoryReady) {
          logger.info(LogCategory.CHARTS, 'Scanning directory for mbtiles files...');
          let hasChartPacks = false;
          try {
            const filesInDir = await FileSystem.readDirectoryAsync(mbtilesDir);
            for (const filename of filesInDir) {
              if (filename.endsWith('.mbtiles') && !filename.startsWith('._')) {
                const chartId = filename.replace('.mbtiles', '');
                const path = `${mbtilesDir}/${filename}`;
                
                // Skip special files (GNIS, basemap, satellite)
                if (chartId.startsWith('gnis_names_') || chartId.startsWith('basemap_') || chartId.startsWith('satellite_')) {
                  continue;
                }
                
                if (chartId.startsWith('BATHY_')) {
                  loadedRasters.push({ chartId, path });
                } else {
                  loadedMbtiles.push({ chartId, path });
                  // Track if we found chart pack files (alaska_US*)
                  if (chartId.match(/^[a-z]+_US\d/)) {
                    hasChartPacks = true;
                  }
                }
              }
            }
            
            // If we found chart packs but no manifest, generate one for the native tile server
            if (hasChartPacks) {
              logger.info(LogCategory.CHARTS, 'Found chart packs without manifest - generating manifest.json for tile server');
              await chartPackService.generateManifest('17cgd');
              
              // Re-read the manifest so the JS side also knows about it
              const manifestPath = `${mbtilesDir}/manifest.json`;
              const newManifestInfo = await FileSystem.getInfoAsync(manifestPath);
              if (newManifestInfo.exists) {
                const content = await FileSystem.readAsStringAsync(manifestPath);
                manifest = JSON.parse(content);
                chartPacks = (manifest?.packs || []).map((p: any) => p.id);
                logger.info(LogCategory.CHARTS, `Generated manifest.json with ${chartPacks.length} packs`);
              }
            }
          } catch (e) {
            logger.warn(LogCategory.CHARTS, 'Directory scan failed - no charts loaded', { error: (e as Error).message });
          }
        } else {
          logger.info(LogCategory.CHARTS, 'Directory not ready - skipping scan (download charts from More > Downloads)');
        }
        logger.perf(LogCategory.CHARTS, `Directory scan complete`, { charts: loadedMbtiles.length });
      }
      
      // End chart discovery phase
      performanceTracker.endPhase(StartupPhase.CHART_DISCOVERY, { 
        mode: manifest ? 'manifest' : 'scan', 
        chartsFound: loadedMbtiles.length,
        rastersFound: loadedRasters.length 
      });
      
      // Log chart/pack inventory
      logger.info(LogCategory.CHARTS, '========== CHART INVENTORY ==========');
      if (manifest && chartPacks.length > 0) {
        logger.info(LogCategory.CHARTS, `Mode: Chart Packs (from manifest.json)`);
        logger.info(LogCategory.CHARTS, `Chart packs: ${chartPacks.length}`);
        for (const pack of manifest.packs || []) {
          const sizeMB = pack.fileSize ? Math.round(pack.fileSize / 1024 / 1024) : 0;
          const zoomRange = `z${pack.minZoom}-${pack.maxZoom}`;
          logger.debug(LogCategory.CHARTS, `  - ${pack.id}: ${sizeMB}MB ${zoomRange}`);
        }
      } else {
        logger.info(LogCategory.CHARTS, `Mode: Directory scan`);
        logger.info(LogCategory.CHARTS, `Total charts: ${loadedMbtiles.length}`);
      }
      logger.info(LogCategory.CHARTS, '=======================================');
      
      setMbtilesCharts(loadedMbtiles);
      
      // Render all loaded charts - tile server handles quilting/compositing
      const allChartIds = loadedMbtiles.map(m => m.chartId);
      setChartsToRender(allChartIds);
      setLoadingPhase('complete');
      logger.info(LogCategory.CHARTS, `Rendering ${allChartIds.length} charts`);
      
      // Store chart info for state reporting
      logger.setStartupParam('chartsLoaded', loadedMbtiles.length);
      logger.setStartupParam('chartTypes', { mbtiles: loadedMbtiles.length, raster: loadedRasters.length });
      
      setRasterCharts(loadedRasters);
      
      // Skip storage calculation for large collections
      if (loadedMbtiles.length > 200) {
        setStorageUsed({ total: 0, vector: 0, raster: 0 });
      }
      
      // === PHASE 5: Start tile server ===
      if (loadedMbtiles.length > 0 || loadedRasters.length > 0) {
        performanceTracker.startPhase(StartupPhase.TILE_SERVER_START);
        
        try {
          const serverUrl = await tileServer.startTileServer({ mbtilesDir });
          performanceTracker.endPhase(StartupPhase.TILE_SERVER_START, { url: serverUrl });
          
          if (serverUrl) {
            setTileServerReady(true);
            logger.setStartupParam('tileServerPort', 8765);
            logger.setStartupParam('tileServerStatus', 'running');
            
            // Diagnostic: test tile server connectivity from JS
            try {
              const healthUrl = `${serverUrl}/health`;
              console.log(`[TILE-DIAG] Testing tile server at ${healthUrl}`);
              const healthResp = await fetch(healthUrl);
              console.log(`[TILE-DIAG] Health check: ${healthResp.status} ${healthResp.statusText}`);
              
              // Test an actual composite tile
              const testTileUrl = `${serverUrl}/tiles/5/2/9.pbf`;
              console.log(`[TILE-DIAG] Testing composite tile at ${testTileUrl}`);
              const tileResp = await fetch(testTileUrl);
              console.log(`[TILE-DIAG] Tile response: status=${tileResp.status}, size=${tileResp.headers.get('content-length') || 'unknown'}, type=${tileResp.headers.get('content-type')}`);
              
              // Test TileJSON endpoint
              const tileJsonUrl = `${serverUrl}/tiles.json`;
              console.log(`[TILE-DIAG] Testing TileJSON at ${tileJsonUrl}`);
              const tileJsonResp = await fetch(tileJsonUrl);
              const tileJson = await tileJsonResp.json();
              console.log(`[TILE-DIAG] TileJSON: minzoom=${tileJson.minzoom}, maxzoom=${tileJson.maxzoom}, bounds=${JSON.stringify(tileJson.bounds)}, tiles=${JSON.stringify(tileJson.tiles)}`);
              console.log(`[TILE-DIAG] TileJSON vector_layers: ${JSON.stringify(tileJson.vector_layers?.map((l: any) => l.id))}`);
              
              // Log the full tileUrl that MapLibre will use
              const compositeTileUrl = `${serverUrl}/tiles/{z}/{x}/{y}.pbf`;
              console.log(`[TILE-DIAG] MapLibre will use tileUrlTemplate: ${compositeTileUrl}`);
              console.log(`[TILE-DIAG] getTileServerUrl() returns: ${tileServer.getTileServerUrl()}`);
            } catch (diagErr) {
              console.error(`[TILE-DIAG] Connectivity test FAILED:`, diagErr);
            }
            
            const chartSummary = `${loadedMbtiles.length} charts`;
            setDebugInfo(`Server: ${serverUrl}\nCharts: ${chartSummary}\nDir: ${mbtilesDir}`);
          } else {
            logger.warn(LogCategory.TILES, 'Failed to start tile server');
            logger.setStartupParam('tileServerStatus', 'failed');
            setDebugInfo(`Failed to start tile server\nDir: ${mbtilesDir}`);
          }
        } catch (e) {
          logger.error(LogCategory.TILES, 'Tile server error', e as Error);
          logger.setStartupParam('tileServerStatus', 'error');
          setDebugInfo(`Tile server error: ${e}`);
        }
      } else {
        setDebugInfo(`No MBTiles files found.\n\nPut .mbtiles files in:\n${mbtilesDir}\n\nOr download via Charts screen.`);
      }
      
      // === PHASE 6: Load legacy GeoJSON (if any) ===
      performanceTracker.startPhase(StartupPhase.GEOJSON_LOAD);
      const downloadedIds = await chartCacheService.getDownloadedChartIds();
      const loadedCharts: LoadedChartData[] = [];
      
      for (const chartId of downloadedIds) {
        if (loadedMbtiles.some(m => m.chartId === chartId)) continue;
        
        const features = await chartCacheService.loadChart(chartId);
        if (Object.keys(features).length > 0) {
          loadedCharts.push({ chartId, features });
        }
      }
      
      if (loadedCharts.length > 0) {
        performanceTracker.endPhase(StartupPhase.GEOJSON_LOAD, { charts: loadedCharts.length });
      } else {
        performanceTracker.endPhase(StartupPhase.GEOJSON_LOAD, { charts: 0 });
      }
      setCharts(loadedCharts);
      
      // === FINAL SUMMARY ===
      const totalTime = performanceTracker.completeStartup();
      logger.info(LogCategory.STARTUP, `Tile mode: COMPOSITE (server-side quilting, ~20 layers)`);
      logger.info(LogCategory.STARTUP, `Special files: GNIS=${gnisFound}, Basemap=${foundBasemapSets.length} sets, Ocean=${foundOceanSets.length} sets, Terrain=${foundTerrainSets.length} sets`);
      
    } catch (error) {
      logger.error(LogCategory.STARTUP, 'STARTUP ERROR', error as Error);
      Alert.alert('Error', 'Failed to load cached charts');
    } finally {
      setLoading(false);
    }
  };

  // Combine features from all charts
  const combinedFeatures = useMemo(() => {
    if (charts.length > 0) {
      logger.debug(LogCategory.CHARTS, `Combining features from ${charts.length} charts`);
    }
    const combined: Partial<Record<FeatureType, GeoJSONFeatureCollection>> = {};
    
    for (const featureType of ALL_FEATURE_TYPES) {
      const allFeatures: any[] = [];
      
      for (const chart of charts) {
        const data = chart.features[featureType];
        if (data?.features) {
          // Tag features with chart ID
          const tagged = data.features.map(f => ({
            ...f,
            properties: { ...f.properties, _chartId: chart.chartId },
          }));
          allFeatures.push(...tagged);
        }
      }
      
      if (allFeatures.length > 0) {
        combined[featureType] = {
          type: 'FeatureCollection',
          features: allFeatures,
        } as GeoJSONFeatureCollection;
      }
    }
    
    if (Object.keys(combined).length > 0) {
      logger.debug(LogCategory.CHARTS, `Combined feature types: ${Object.keys(combined).join(', ')}`);
    }
    
    return combined;
  }, [charts]);

  // Extract sector features from lights
  const sectorFeatures = useMemo(() => {
    if (!combinedFeatures.lights) {
      return { type: 'FeatureCollection', features: [] } as GeoJSONFeatureCollection;
    }
    return extractSectorFeatures(combinedFeatures.lights);
  }, [combinedFeatures.lights]);

  // Filter polygon vs point/line features for proper rendering
  const deparePolygons = useMemo(() => {
    if (!combinedFeatures.depare) return null;
    const polygons = combinedFeatures.depare.features.filter(
      f => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'
    );
    return polygons.length > 0 ? { type: 'FeatureCollection' as const, features: polygons } : null;
  }, [combinedFeatures.depare]);

  const lndarePolygons = useMemo(() => {
    if (!combinedFeatures.lndare) return null;
    const polygons = combinedFeatures.lndare.features.filter(
      f => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'
    );
    return polygons.length > 0 ? { type: 'FeatureCollection' as const, features: polygons } : null;
  }, [combinedFeatures.lndare]);

  // Track if we've done the query warm-up
  const queryWarmupDoneRef = useRef(false);
  
  // Handle map events
  const handleMapIdle = useCallback((state: any) => {
    // === STYLE SWITCH: Log map idle during style switch ===
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      logger.perf(LogCategory.UI, `Style switch complete: ${elapsed}ms`);
      performanceTracker.recordMetric(RuntimeMetric.STYLE_SWITCH, elapsed);
      // Reset tracking
      styleSwitchStartRef.current = 0;
    }
    
    if (state?.properties?.zoom !== undefined) {
      setCurrentZoom(Math.round(state.properties.zoom * 10) / 10);
    }
    if (state?.properties?.center) {
      setCenterCoord(state.properties.center);
    }
    
    // Warm up the query cache on first idle (makes first tap fast)
    if (!queryWarmupDoneRef.current && mapRef.current) {
      queryWarmupDoneRef.current = true;
      // Run a small query in the background to warm up Mapbox's spatial index
      logger.debug(LogCategory.STARTUP, 'Warming up query cache...');
      const warmupStart = Date.now();
      mapRef.current.queryRenderedFeaturesAtPoint([100, 100], undefined, [])
        .then(() => {
          logger.perf(LogCategory.STARTUP, `Query cache warmed up in ${Date.now() - warmupStart}ms`);
        })
        .catch(() => {
          // Ignore errors - this is just a warmup
        });
    }
  }, []);

  // Process camera state updates (extracted for throttling)
  // MapLibre sends a GeoJSON Feature with geometry.coordinates for center
  // and properties.zoomLevel for zoom
  const processCameraState = useCallback((feature: any) => {
    // MapLibre sends: { type: 'Feature', geometry: { coordinates: [lng, lat] }, properties: { zoomLevel, ... } }
    if (feature?.geometry?.coordinates) {
      const [lng, lat] = feature.geometry.coordinates;
      setCenterCoord([lng, lat]);
    }
    // MapLibre uses 'zoomLevel' in properties
    const zoom = feature?.properties?.zoomLevel ?? feature?.properties?.zoom;
    if (zoom !== undefined) {
      const roundedZoom = Math.round(zoom * 10) / 10;
      setCurrentZoom(roundedZoom);
      // Check if we're at the max zoom limit
      setIsAtMaxZoom(limitZoomToCharts && roundedZoom >= effectiveMaxZoom - 0.1);
    }
  }, [limitZoomToCharts, effectiveMaxZoom]);
  
  // Detect when user starts panning (region will change)
  // This serves as a backup to the touch capture handlers
  const handleRegionWillChange = useCallback(() => {
    // Skip if this is a programmatic camera move (GPS centering)
    if (isProgrammaticCameraMove.current) {
      return;
    }
    // Disable follow mode if user is panning
    if (followGPSRef.current) {
      followGPSRef.current = false;
      setFollowGPS(false);
    }
  }, []);

  // Handle camera changes - throttled to max once per 100ms to reduce re-renders during pan/zoom
  // MapLibre uses onRegionDidChange/onRegionIsChanging which sends a GeoJSON Feature
  const handleCameraChanged = useCallback((feature: any) => {
    const THROTTLE_MS = 100;
    const now = Date.now();
    
    // Always store the latest feature
    pendingCameraStateRef.current = feature;
    
    // If enough time has passed, process immediately
    if (now - lastCameraUpdateRef.current >= THROTTLE_MS) {
      lastCameraUpdateRef.current = now;
      processCameraState(feature);
      pendingCameraStateRef.current = null;
      
      // Clear any pending timeout since we just processed
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
        throttleTimeoutRef.current = null;
      }
    } else if (!throttleTimeoutRef.current) {
      // Schedule a trailing call to ensure we don't miss the final state
      const remainingTime = THROTTLE_MS - (now - lastCameraUpdateRef.current);
      throttleTimeoutRef.current = setTimeout(() => {
        if (pendingCameraStateRef.current) {
          lastCameraUpdateRef.current = Date.now();
          processCameraState(pendingCameraStateRef.current);
          pendingCameraStateRef.current = null;
        }
        throttleTimeoutRef.current = null;
      }, remainingTime);
    }
  }, [processCameraState]);
  
  // Cleanup throttle timeout on unmount
  useEffect(() => {
    return () => {
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
      }
    };
  }, []);
  

  const handleFeaturePress = useCallback((layerType: string) => (e: any) => {
    const feature = e.features?.[0];
    if (feature) {
      setSelectedFeature({
        type: layerType,
        properties: feature.properties || {},
      });
    }
  }, []);

  // All charts to render (from progressive loading)
  const allChartsToRender = useMemo(() => {
    return [...new Set(chartsToRender)]; // Remove any duplicates
  }, [chartsToRender]);

  // Helper to check if a chart is rendered at current zoom
  // Returns true if chart's zoom range overlaps with current view
  const isChartVisibleAtZoom = useCallback((chartId: string, zoom: number): boolean => {
    // Match US scale number - can be prefixed (alaska_US1) or standalone (US1)
    const match = chartId.match(/US(\d)/);
    if (!match) return true; // Include unknown charts
    const scale = parseInt(match[1], 10);
    
    // Chart zoom ranges (from tippecanoe settings in convert.py)
    // US1: z0-8, US2: z8-10, US3: z10-13, US4: z13-15, US5: z15-17, US6: z17-18
    // Include ±2 zoom buffer for overzoom tolerance
    switch (scale) {
      case 1: return zoom <= 10;  // US1: z0-8, buffer to z10
      case 2: return zoom >= 6 && zoom <= 12;  // US2: z8-10, buffer ±2
      case 3: return zoom >= 8 && zoom <= 15;  // US3: z10-13, buffer ±2
      case 4: return zoom >= 11;  // US4: z13-15, buffer to z11+
      case 5: return zoom >= 13;  // US5: z15-17, buffer to z13+
      default: return zoom >= 15; // US6+: z17-18, buffer to z15+
    }
  }, []);

  // Scale bar calculation based on current zoom level and latitude
  const scaleBarData = useMemo(() => {
    // Ground resolution in meters per pixel at given zoom & latitude
    // Formula: 156543.03392 * cos(lat) / 2^zoom
    const lat = centerCoord[1];
    const metersPerPixel = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, currentZoom);
    
    // We want a scale bar that's roughly 80-150 pixels wide
    // Pick a "nice" distance in nautical miles and compute bar width
    const METERS_PER_NM = 1852;
    const targetWidthPx = 100;
    const targetDistanceM = metersPerPixel * targetWidthPx;
    const targetDistanceNM = targetDistanceM / METERS_PER_NM;
    
    // Nice round numbers for nautical miles
    const niceValues = [
      0.01, 0.02, 0.05,
      0.1, 0.2, 0.5,
      1, 2, 5,
      10, 20, 50,
      100, 200, 500,
      1000, 2000, 5000,
    ];
    
    // Find the nice value closest to our target
    let bestNM = niceValues[0];
    let bestDiff = Math.abs(Math.log(targetDistanceNM) - Math.log(niceValues[0]));
    for (const v of niceValues) {
      const diff = Math.abs(Math.log(targetDistanceNM) - Math.log(v));
      if (diff < bestDiff) {
        bestDiff = diff;
        bestNM = v;
      }
    }
    
    const barWidthPx = (bestNM * METERS_PER_NM) / metersPerPixel;
    
    // Format the label
    let label: string;
    if (bestNM >= 1) {
      label = `${bestNM} nm`;
    } else {
      // Show in feet for very small distances (< 0.05 nm ≈ 300 ft)
      if (bestNM < 0.05) {
        const feet = Math.round(bestNM * METERS_PER_NM * 3.28084);
        label = `${feet} ft`;
      } else {
        label = `${bestNM} nm`;
      }
    }
    
    return { barWidthPx: Math.round(barWidthPx), label };
  }, [currentZoom, centerCoord]);

  // Charts visible at current zoom level - for display and debugging
  const chartsAtZoom = useMemo(() => {
    return allChartsToRender
      .filter(chartId => isChartVisibleAtZoom(chartId, currentZoom))
      .map(chartId => ({ chartId }));
  }, [allChartsToRender, currentZoom, isChartVisibleAtZoom]);

  // Build list of queryable layer IDs from loaded charts
  // OPTIMIZED: Only query tappable features at current zoom level
  // Skip large background fills, labels, and charts not rendered at this zoom
  const queryableLayerIds = useMemo(() => {
    // Only include layers that are useful to tap on
    // Exclude: large fills (depare, lndare, fairwy, drgare), labels, outlines
    const layerTypes: { type: string; visible: boolean }[] = [
      // Point features - always useful to identify
      { type: 'lights', visible: showLights },
      { type: 'buoys', visible: showBuoys },
      { type: 'beacons', visible: showBeacons },
      { type: 'wrecks', visible: showHazards },
      { type: 'uwtroc', visible: showHazards },
      { type: 'obstrn', visible: showHazards },
      { type: 'lndmrk', visible: showLandmarks },
      { type: 'soundg', visible: showSoundings },
      // Line features - useful for identification
      { type: 'cblsub', visible: showCables },
      { type: 'pipsol', visible: showPipelines },
      { type: 'depcnt', visible: showDepthContours },
      { type: 'coalne', visible: showCoastline },
      // Area features - smaller/important areas worth tapping
      { type: 'resare', visible: showRestrictedAreas },
      { type: 'ctnare', visible: showCautionAreas },
      { type: 'mipare', visible: showMilitaryAreas },
      { type: 'achare', visible: showAnchorages },
      { type: 'achbrt', visible: showAnchorages },
      { type: 'marcul', visible: showMarineFarms },
      { type: 'cblare', visible: showCables },
      { type: 'pipare', visible: showPipelines },
      { type: 'sbdare', visible: showSeabed },
      // New infrastructure layers
      { type: 'bridge', visible: showBridges },
      { type: 'buisgl', visible: showBuildings },
      { type: 'morfac', visible: showMoorings },
      { type: 'slcons', visible: showShorelineConstruction },
      { type: 'seaare', visible: showSeaAreaNames },
      { type: 'lndrgn', visible: showLandRegions },
    ];
    
    const ids: string[] = [];
    // Only include visible layers
    const visibleTypes = layerTypes.filter(l => l.visible).map(l => l.type);
    
    // Use component-level chartsAtZoom (already filtered by zoom)
    for (const chart of chartsAtZoom) {
      for (const layerType of visibleTypes) {
        ids.push(`mbtiles-${layerType}-${chart.chartId}`);
      }
    }
    return ids;
  }, [allChartsToRender, chartsAtZoom, currentZoom,
      showLights, showBuoys, showBeacons, showHazards, showLandmarks, showSoundings,
      showCables, showPipelines, showDepthContours, showCoastline,
      showRestrictedAreas, showCautionAreas, showMilitaryAreas, showAnchorages,
      showMarineFarms, showSeabed, showBridges, showBuildings, showMoorings,
      showShorelineConstruction, showSeaAreaNames, showLandRegions]);

  // Handle map press - query features at tap location from MBTiles vector layers
  // Optimized: uses constant Maps for O(1) lookups, minimal logging
  const handleMapPress = useCallback(async (e: any) => {
    const perfStart = Date.now();
    tapStartTimeRef.current = perfStart;  // Track for end-to-end timing
    const endTapMetric = performanceTracker.startMetric(RuntimeMetric.MAP_TAP);
    
    // Clear any previous selection/choices
    setFeatureChoices(null);
    setSelectedFeature(null);
    
    if (!mapRef.current) {
      return;
    }
    
    const { geometry } = e;
    if (!geometry?.coordinates) {
      return;
    }
    
    const [longitude, latitude] = geometry.coordinates;
    logger.debug(LogCategory.UI, `Map tap at: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
    
    // Round screen coordinates to integers
    const screenX = Math.round(e.properties?.screenPointX || 0);
    const screenY = Math.round(e.properties?.screenPointY || 0);
    
    try {
      // Query features in a rectangle around the tap point (22px tolerance for finger taps)
      const tolerance = 22; // pixels (~10mm finger tap radius)
      const bbox: [number, number, number, number] = [
        screenY - tolerance,  // top
        screenX + tolerance,  // right  
        screenY + tolerance,  // bottom
        screenX - tolerance,  // left
      ];
      
      // Query ALL rendered features (no layer filter) - faster than specifying 1000+ layer IDs
      const queryStart = Date.now();
      
      const allFeatures = await mapRef.current.queryRenderedFeaturesInRect(
        bbox,
        undefined,  // No filter expression
        []     // Empty array = query all layers (much faster than specifying 1000+ IDs)
      );
      
      const queryTime = Date.now() - queryStart;
      logger.debug(LogCategory.UI, `Feature query: ${queryTime}ms (${allFeatures?.features?.length || 0} raw features)`);
      
      // FIRST: Check for tide/current station clicks (these take priority)
      // Since ShapeSource features don't have layer.id, we identify them by properties
      // Collect special features (tide stations, current stations, live buoys) into unified list
      // Deduplicate by ID since queryRenderedFeaturesInRect returns features from
      // multiple sublayers (halo, icon, label) for the same source feature
      const specialFeatures: FeatureInfo[] = [];
      const seenSpecialIds = new Set<string>();
      
      if (allFeatures?.features) {
        for (const feature of allFeatures.features) {
          const props = feature.properties;
          
          // Check for current station click (has 'bin' property)
          if (props?.bin !== undefined && props?.id && props?.name) {
            const key = `current-${props.id}`;
            if (!seenSpecialIds.has(key)) {
              seenSpecialIds.add(key);
              specialFeatures.push({
                type: 'Current Station',
                properties: {
                  ...props,
                  _specialType: 'currentStation',
                  _tapCoordinates: `${latitude.toFixed(5)}°, ${longitude.toFixed(5)}°`,
                },
              });
            }
          }
          
          // Check for tide station click (has type: 'tide_prediction' or similar)
          else if (props?.type === 'tide_prediction' && props?.id && props?.name) {
            const key = `tide-${props.id}`;
            if (!seenSpecialIds.has(key)) {
              seenSpecialIds.add(key);
              specialFeatures.push({
                type: 'Tide Station',
                properties: {
                  ...props,
                  _specialType: 'tideStation',
                  OBJNAM: props.name,
                  _tapCoordinates: `${latitude.toFixed(5)}°, ${longitude.toFixed(5)}°`,
                },
              });
            }
          }
          
          // Check for live buoy click (has isLiveBuoy flag)
          else if (props?.isLiveBuoy && props?.id) {
            const key = `buoy-${props.id}`;
            if (!seenSpecialIds.has(key)) {
              seenSpecialIds.add(key);
              specialFeatures.push({
                type: 'Live Buoy',
                properties: {
                  ...props,
                  _specialType: 'liveBuoy',
                  OBJNAM: props.name,
                  _tapCoordinates: `${latitude.toFixed(5)}°, ${longitude.toFixed(5)}°`,
                },
              });
            }
          }
        }
      }
      
      // Filter to nautical features from ACTIVE/VISIBLE layers only
      const filterStart = Date.now();
      
      // Map OBJL codes to their visibility state
      const objlVisibility: Record<number, boolean> = {
        // Lights
        75: showLights,
        // Buoys (BOYCAR, BOYINB, BOYISD, BOYLAT, BOYSAW, BOYSPP)
        14: showBuoys, 15: showBuoys, 16: showBuoys, 17: showBuoys, 18: showBuoys, 19: showBuoys,
        // Beacons (BCNSAW, BCNSPP, BCNISD, BCNLAT, BCNCAR)
        8: showBeacons, 9: showBeacons, 6: showBeacons, 7: showBeacons, 5: showBeacons,
        // Hazards (WRECKS, UWTROC, OBSTRN)
        159: showHazards, 153: showHazards, 86: showHazards,
        // Landmarks
        74: showLandmarks,
        // Soundings - EXCLUDED from click-to-identify (too numerous and not useful)
        129: false,
        // Cables (CBLSUB, CBLOHD, CBLARE)
        22: showCables, 21: showCables, 20: showCables,
        // Pipelines (PIPSOL, PIPARE)
        94: showPipelines, 92: showPipelines,
        // Depth contours - EXCLUDED from click-to-identify (not useful)
        43: false,
        // Coastline
        30: showCoastline,
        // Restricted areas
        112: showRestrictedAreas,
        // Caution areas
        27: showCautionAreas,
        // Military areas
        83: showMilitaryAreas,
        // Anchorages (ACHARE, ACHBRT)
        4: showAnchorages, 3: showAnchorages,
        // Marine farms
        82: showMarineFarms,
        // Seabed
        114: showSeabed,
        // Bridges
        11: showBridges,
        // Buildings
        12: showBuildings,
        // Moorings
        84: showMoorings,
        // Shoreline construction
        122: showShorelineConstruction,
        // Depth areas - EXCLUDED from click-to-identify (not useful)
        42: false,
        // Land areas (always queryable for context)
        71: showLand,
      };
      
      // Filter to features from visible layers only
      const features = {
        features: (allFeatures?.features || []).filter((f: any) => {
          const objl = f.properties?.OBJL;
          if (!objl) return false;
          
          // ALWAYS exclude soundings (OBJL 129) - too numerous and obvious
          if (objl === 129) return false;
          
          // ALWAYS exclude depth contours (OBJL 43) - not useful for identification
          if (objl === 43) return false;
          
          // Include if layer is visible, or if we don't have visibility info for this OBJL (include by default)
          return objlVisibility[objl] !== false;
        })
      };
      const filterEnd = Date.now();
      
      if (features?.features?.length > 0) {
        // Group features by layer type (OBJL) and deduplicate
        const priorityStart = Date.now();
        const featuresByType = new Map<number, any>();
        
        for (const feature of features.features) {
          const props = feature.properties || {};
          const objl = props.OBJL;
          
          // Skip if no OBJL (metadata features)
          if (!objl) continue;
          
          // Keep only the best feature of each type (prefer points, then by priority)
          const existing = featuresByType.get(objl);
          if (!existing) {
            featuresByType.set(objl, feature);
          } else {
            // Prefer point geometry over line/polygon
            const existingIsPoint = existing.geometry?.type === 'Point';
            const newIsPoint = feature.geometry?.type === 'Point';
            if (newIsPoint && !existingIsPoint) {
              featuresByType.set(objl, feature);
            }
          }
        }
        
        // Convert to array of FeatureInfo objects
        const uniqueFeatures: FeatureInfo[] = [];
        for (const [objl, feature] of featuresByType) {
          const props = feature.properties || {};
          const layer = getLayerName(props);
          uniqueFeatures.push({
            type: LAYER_DISPLAY_NAMES[layer] || layer,
            properties: {
              ...props,
              _tapCoordinates: `${latitude.toFixed(5)}°, ${longitude.toFixed(5)}°`,
            },
          });
        }
        
        // Sort by priority (highest first)
        uniqueFeatures.sort((a, b) => {
          const objlA = a.properties?.OBJL || 0;
          const objlB = b.properties?.OBJL || 0;
          const prioA = OBJL_PRIORITIES.get(objlA) || 0;
          const prioB = OBJL_PRIORITIES.get(objlB) || 0;
          return prioB - prioA;
        });
        
        // Merge special features (tide/current stations, live buoys) with chart features
        // Special features go first since they have highest interaction priority
        const allTapFeatures = [...specialFeatures, ...uniqueFeatures];
        
        const priorityEnd = Date.now();
        logger.debug(LogCategory.UI, `Grouped ${features.features.length} chart + ${specialFeatures.length} special → ${allTapFeatures.length} total (${priorityEnd - priorityStart}ms)`);
        
        if (allTapFeatures.length === 1) {
          // Single feature - handle directly
          const feature = allTapFeatures[0];
          if (feature.properties?._specialType) {
            handleSpecialFeatureSelect(feature);
          } else {
            startTransition(() => {
              setFeatureChoices(null);
              setSelectedFeature(feature);
            });
          }
        } else if (allTapFeatures.length > 1) {
          // Multiple features - let user choose
          startTransition(() => {
            setSelectedFeature(null);
            setFeatureChoices(allTapFeatures);
          });
        }
      } else if (specialFeatures.length > 0) {
        // No chart features but we have special features
        if (specialFeatures.length === 1) {
          handleSpecialFeatureSelect(specialFeatures[0]);
        } else {
          startTransition(() => {
            setSelectedFeature(null);
            setFeatureChoices(specialFeatures);
          });
        }
      }
    } catch (error) {
      logger.error(LogCategory.UI, 'Error querying features', error as Error);
    }
    
    const totalTime = endTapMetric();
  }, [queryableLayerIds, showLights, showBuoys, showBeacons, showHazards, showLandmarks, 
      showSoundings, showCables, showPipelines, showDepthContours, showCoastline,
      showRestrictedAreas, showCautionAreas, showMilitaryAreas, showAnchorages,
      showMarineFarms, showSeabed, showBridges, showBuildings, showMoorings,
      showShorelineConstruction, showDepthAreas, showLand]);

  // Handle map long press - create a waypoint at the pressed location
  const handleMapLongPress = useCallback((e: any) => {
    const { geometry } = e;
    if (!geometry?.coordinates) return;
    
    const [longitude, latitude] = geometry.coordinates;
    console.log(`[DynamicChartViewer] Long press at: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
    openWaypointCreation(longitude, latitude);
  }, [openWaypointCreation]);

  // Calculate initial center from loaded charts (prefer MBTiles if available)
  const initialCenter = useMemo(() => {
    // If we have MBTiles charts, use appropriate center
    if (mbtilesCharts.length > 0) {
      // Check for US4AK4PH (Homer/Kachemak Bay)
      const hasUS4AK4PH = mbtilesCharts.some(c => c.chartId === 'US4AK4PH');
      if (hasUS4AK4PH) {
        // Homer, Alaska - center of US4AK4PH chart
        return [-151.55, 59.64] as [number, number];
      }
      // Check for US3AK12M (Cook Inlet Southern Part)
      const hasUS3AK12M = mbtilesCharts.some(c => c.chartId === 'US3AK12M');
      if (hasUS3AK12M) {
        return [-153.32, 59.34] as [number, number];
      }
      // Default MBTiles center (Kachemak Bay area)
      return [-151.5, 59.55] as [number, number];
    }
    
    if (charts.length === 0) {
      return [-152, 61] as [number, number];
    }
    
    // Try to find center from first GeoJSON chart's features
    const firstChart = charts[0];
    
    // Try depare first, then other polygon features
    const polygonFeatures = firstChart.features.depare || firstChart.features.lndare;
    
    if (polygonFeatures?.features?.[0]?.geometry) {
      const geom = polygonFeatures.features[0].geometry as any;
      if (geom.type === 'Polygon' && geom.coordinates?.[0]) {
        const coords = geom.coordinates[0];
        const lons = coords.map((c: number[]) => c[0]);
        const lats = coords.map((c: number[]) => c[1]);
        const center = [
          (Math.min(...lons) + Math.max(...lons)) / 2,
          (Math.min(...lats) + Math.max(...lats)) / 2,
        ] as [number, number];
        return center;
      }
    }
    
    // Fallback: try to use any Point feature
    for (const [type, data] of Object.entries(firstChart.features)) {
      if (data?.features?.[0]?.geometry) {
        const geom = data.features[0].geometry as any;
        if (geom.type === 'Point' && geom.coordinates) {
          return geom.coordinates as [number, number];
        }
      }
    }
    
    logger.debug(LogCategory.CHARTS, 'Could not calculate center, using default');
    return [-152, 61] as [number, number];
  }, [charts, mbtilesCharts]);

  // Memoize formatted feature properties to avoid recalculation on every render
  // NOTE: Must be before early returns to comply with Rules of Hooks
  const formattedFeatureProps = useMemo(() => {
    if (!selectedFeature) return null;
    const result = formatFeatureProperties(selectedFeature, displaySettings.depthUnits);
    const entries = Object.entries(result);
    return entries;
  }, [selectedFeature]);
  
  // Log when info box actually renders (after React commit phase)
  useEffect(() => {
    if (selectedFeature && tapStartTimeRef.current > 0) {
      tapStartTimeRef.current = 0; // Reset for next tap
    }
  }, [selectedFeature]);

  // === STYLE SWITCH: Additional Mapbox event handlers for detailed timing ===
  // NOTE: These must be BEFORE early returns to comply with Rules of Hooks
  const handleWillStartLoadingMap = useCallback(() => {
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      logger.debug(LogCategory.UI, `Style switch: onWillStartLoadingMap (${elapsed}ms)`);
    }
  }, []);
  
  const handleDidFinishLoadingMap = useCallback(() => {
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      logger.debug(LogCategory.UI, `Style switch: onDidFinishLoadingMap (${elapsed}ms)`);
    }
  }, []);
  
  const handleDidFailLoadingMap = useCallback((error: any) => {
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      logger.error(LogCategory.UI, `Style switch failed (${elapsed}ms)`, error);
    }
  }, []);
  
  const handleDidFinishLoadingStyle = useCallback(() => {
    try {
      if (styleSwitchStartRef.current > 0) {
        const elapsed = Date.now() - styleSwitchStartRef.current;
        logger.debug(LogCategory.UI, `Style switch: onDidFinishLoadingStyle (${elapsed}ms)`);
      }
    } catch (error) {
      logger.error(LogCategory.UI, 'Error in handleDidFinishLoadingStyle callback', error as Error);
    }
  }, [displaySettings, scaledCableLineWidth, scaledCableLineHalo, scaledDepthContourLineHalo, scaledCoastlineHalo]);
  
  // Track first render frame after style switch
  const styleRenderFrameCountRef = useRef<number>(0);
  const handleDidFinishRenderingFrame = useCallback((state: any) => {
    if (styleSwitchStartRef.current > 0) {
      styleRenderFrameCountRef.current++;
      // Only log first few frames to avoid spam
      if (styleRenderFrameCountRef.current <= 3) {
        const elapsed = Date.now() - styleSwitchStartRef.current;
        logger.debug(LogCategory.UI, `Style switch: render frame #${styleRenderFrameCountRef.current} (${elapsed}ms)`);
      }
    }
  }, []);
  
  const handleDidFinishRenderingFrameFully = useCallback(() => {
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      logger.debug(LogCategory.UI, `Style switch: fully rendered (${elapsed}ms)`);
      // Reset refs to prevent repeated logging
      styleSwitchStartRef.current = 0;
      styleRenderFrameCountRef.current = 0;
    }
  }, []);

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading charts...</Text>
        </View>
      </View>
    );
  }

  if (charts.length === 0 && mbtilesCharts.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>No Charts Downloaded</Text>
          <Text style={styles.emptyText}>Download charts to view them</Text>
          <TouchableOpacity 
            style={styles.downloadBtn} 
            onPress={() => {
              if (onNavigateToDownloads) {
                onNavigateToDownloads();
              } else {
                navigation.navigate('Charts');
              }
            }}
          >
            <Text style={styles.downloadBtnText}>Download Charts</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Map section wrapper - takes remaining space */}
      <View style={styles.mapSection}>
      <View 
        style={styles.mapTouchWrapper}
        onStartShouldSetResponderCapture={() => {
          // Capture phase - fires BEFORE MapView processes the touch
          if (followGPSRef.current) {
            followGPSRef.current = false;
            setFollowGPS(false);
            isProgrammaticCameraMove.current = false;
          }
          return false; // Don't capture - let MapView handle the touch
        }}
        onMoveShouldSetResponderCapture={() => {
          // Also check on move in case start was missed
          if (followGPSRef.current) {
            followGPSRef.current = false;
            isProgrammaticCameraMove.current = false;
            setFollowGPS(false);
          }
          return false; // Don't capture - let MapView handle the touch
        }}
      >
      <MapLibre.MapView
        key={`map-${mapStyle}-${s52Mode}`}
        ref={mapRef}
        style={styles.map}
        // Always use styleJSON - passing styleURL={undefined} causes MapLibre to
        // fall back to its default demo tiles (colorful world map), which bleeds
        // through under all modes. By omitting styleURL entirely and only using
        // styleJSON, MapLibre renders just our minimal background style.
        styleJSON={JSON.stringify(mapStyleUrls[mapStyle])}
        onMapIdle={handleMapIdle}
        onRegionWillChange={handleRegionWillChange}
        onRegionDidChange={handleCameraChanged}
        onRegionIsChanging={handleCameraChanged}
        onPress={handleMapPress}
        onLongPress={handleMapLongPress}
        // @ts-ignore - MapLibre callback types may differ slightly
        onWillStartLoadingMap={handleWillStartLoadingMap}
        onDidFinishLoadingMap={handleDidFinishLoadingMap}
        // @ts-ignore - MapLibre callback types may differ slightly
        onDidFailLoadingMap={handleDidFailLoadingMap}
        // @ts-ignore - MapLibre callback types may differ slightly
        onDidFinishLoadingStyle={handleDidFinishLoadingStyle}
        // @ts-ignore - MapLibre callback types may differ slightly
        onDidFinishRenderingFrame={handleDidFinishRenderingFrame}
        onDidFinishRenderingFrameFully={handleDidFinishRenderingFrameFully}
        scaleBarEnabled={false}
        logoEnabled={false}
        attributionEnabled={false}
      >
        <MapLibre.Camera
          ref={cameraRef}
          defaultSettings={{
            zoomLevel: 8,  // Start at z8 where US1 overview charts are visible
            centerCoordinate: [-151.55, 59.64],  // HARDCODED: Homer, Alaska
          }}
          // CONTROLLED centerCoordinate: only set when following GPS, undefined otherwise
          // This lets the user pan freely when not following
          centerCoordinate={
            followGPS && gpsData.latitude !== null && gpsData.longitude !== null
              ? [gpsData.longitude, gpsData.latitude]
              : undefined
          }
          animationDuration={0}
          maxZoomLevel={effectiveMaxZoom}
          minZoomLevel={0}
        />

        <MapLibre.Images images={NAV_SYMBOLS} />

        {/* Satellite Imagery - renders at very bottom when available */}
        {/* Each satellite_z*.mbtiles file is loaded as a separate source with its zoom range */}
        {tileServerReady && satelliteTileSets.length > 0 && satelliteTileSets.map((tileSet) => {
          const satelliteVisible = (mapStyle === 'satellite' && debugIsSourceVisible('satellite')) ? 1 : 0;
          // Log satellite visibility during style switch
          if (styleSwitchStartRef.current > 0 && mapStyle === 'satellite' && tileSet.minZoom === 0) {
          }
          return (
            <MapLibre.RasterSource
              key={`satellite-src-${tileSet.id}`}
              id={`satellite-src-${tileSet.id}`}
              tileUrlTemplates={[`${tileServer.getTileServerUrl()}/tiles/${tileSet.id}/{z}/{x}/{y}.jpg`]}
              tileSize={256}
              minZoomLevel={tileSet.minZoom}
              maxZoomLevel={tileSet.maxZoom}
            >
              <MapLibre.RasterLayer
                id={`satellite-layer-${tileSet.id}`}
                style={{
                  rasterOpacity: satelliteVisible,
                }}
              />
            </MapLibre.RasterSource>
          );
        })}

        {/* Raster Bathymetry Sources - renders BELOW vector chart data */}
        {tileServerReady && rasterCharts.map((chart) => {
          const rasterTileUrl = tileServer.getRasterTileUrlTemplate(chart.chartId);
          
          return (
            <MapLibre.RasterSource
              key={`raster-src-${chart.chartId}-${cacheBuster}`}
              id={`raster-src-${chart.chartId}`}
              tileUrlTemplates={[rasterTileUrl]}
              tileSize={256}
              minZoomLevel={6}
              maxZoomLevel={14}
            >
              <MapLibre.RasterLayer
                id={`raster-layer-${chart.chartId}`}
                style={{
                  rasterOpacity: (showBathymetry && debugIsSourceVisible('bathymetry')) ? 0.7 : 0,
                }}
              />
            </MapLibre.RasterSource>
          );
        })}

        {/* ================================================================== */}
        {/* OCEAN BASEMAP - ESRI Ocean raster tiles (per zoom level)           */}
        {/* Same pattern as satellite: one RasterSource per ocean_z*.mbtiles   */}
        {/* ================================================================== */}
        {tileServerReady && oceanTileSets.length > 0 && oceanTileSets.map((tileSet) => {
          const oceanVisible = (mapStyle === 'ocean' && debugIsSourceVisible('ocean')) ? 1 : 0;
          return (
            <MapLibre.RasterSource
              key={`ocean-src-${tileSet.id}`}
              id={`ocean-src-${tileSet.id}`}
              tileUrlTemplates={[`${tileServer.getTileServerUrl()}/tiles/${tileSet.id}/{z}/{x}/{y}.png`]}
              tileSize={256}
              minZoomLevel={tileSet.minZoom}
              maxZoomLevel={tileSet.maxZoom}
            >
              <MapLibre.RasterLayer
                id={`ocean-layer-${tileSet.id}`}
                style={{ rasterOpacity: oceanVisible }}
              />
            </MapLibre.RasterSource>
          );
        })}

        {/* ================================================================== */}
        {/* TERRAIN BASEMAP - OpenTopoMap raster tiles (per zoom level)        */}
        {/* Same pattern as satellite: one RasterSource per terrain_z*.mbtiles */}
        {/* ================================================================== */}
        {tileServerReady && terrainTileSets.length > 0 && terrainTileSets.map((tileSet) => {
          const terrainVisible = (mapStyle === 'terrain' && debugIsSourceVisible('terrain')) ? 1 : 0;
          return (
            <MapLibre.RasterSource
              key={`terrain-src-${tileSet.id}`}
              id={`terrain-src-${tileSet.id}`}
              tileUrlTemplates={[`${tileServer.getTileServerUrl()}/tiles/${tileSet.id}/{z}/{x}/{y}.png`]}
              tileSize={256}
              minZoomLevel={tileSet.minZoom}
              maxZoomLevel={tileSet.maxZoom}
            >
              <MapLibre.RasterLayer
                id={`terrain-layer-${tileSet.id}`}
                style={{ rasterOpacity: terrainVisible }}
              />
            </MapLibre.RasterSource>
          );
        })}

        {/* ================================================================== */}
        {/* VECTOR BASEMAP (BACKGROUND) - water, landcover, landuse, parks     */}
        {/* Powers: Light, Dark, Nautical, Street modes from one download      */}
        {/* Colors are driven by basemapPalette (changes per selected style)   */}
        {/* Foreground layers (roads, labels) are in BASEMAP OVERLAY below     */}
        {/* ================================================================== */}
        {tileServerReady && hasLocalBasemap && isVectorStyle && debugIsSourceVisible('basemap') && (() => {
          const p = basemapPalette;
          const vis = 'visible';
          // Use per-zoom basemap tile sets if available, otherwise fall back to legacy monolithic file
          const basemapTileUrl = basemapTileSets.length > 0
            ? `${tileServer.getTileServerUrl()}/tiles/${basemapTileSets[0].id}/{z}/{x}/{y}.pbf`
            : `${tileServer.getTileServerUrl()}/tiles/basemap_alaska/{z}/{x}/{y}.pbf`;
          return (
          <MapLibre.VectorSource
            key={`basemap-bg-${mapStyle}-${s52Mode}`}
            id="basemap-bg-source"
            tileUrlTemplates={[basemapTileUrl]}
            minZoomLevel={0}
            maxZoomLevel={14}
          >
            {/* Water */}
            <MapLibre.FillLayer id="basemap-water" sourceLayerID="water"
              style={{ fillColor: p.water, fillOpacity: 1, visibility: vis }} />
            <MapLibre.LineLayer id="basemap-waterway" sourceLayerID="waterway"
              style={{ lineColor: p.waterway, lineWidth: ['interpolate', ['linear'], ['zoom'], 8, 0.5, 12, 1.5, 14, 3], visibility: vis }} />
            {/* Land Cover */}
            <MapLibre.FillLayer id="basemap-landcover-ice" sourceLayerID="landcover"
              filter={['==', ['get', 'class'], 'ice']}
              style={{ fillColor: p.ice, fillOpacity: p.landcoverOpacity, visibility: vis }} />
            <MapLibre.FillLayer id="basemap-landcover-grass" sourceLayerID="landcover"
              filter={['==', ['get', 'class'], 'grass']}
              style={{ fillColor: p.grass, fillOpacity: p.landcoverOpacity, visibility: vis }} />
            <MapLibre.FillLayer id="basemap-landcover-wood" sourceLayerID="landcover"
              filter={['any', ['==', ['get', 'class'], 'wood'], ['==', ['get', 'class'], 'forest']]}
              style={{ fillColor: p.wood, fillOpacity: p.landcoverOpacity, visibility: vis }} />
            <MapLibre.FillLayer id="basemap-landcover-wetland" sourceLayerID="landcover"
              filter={['==', ['get', 'class'], 'wetland']}
              style={{ fillColor: p.wetland, fillOpacity: p.landcoverOpacity, visibility: vis }} />
            {/* Land Use */}
            <MapLibre.FillLayer id="basemap-landuse-residential" sourceLayerID="landuse"
              filter={['==', ['get', 'class'], 'residential']} minZoomLevel={10}
              style={{ fillColor: p.residential, fillOpacity: p.landcoverOpacity * 0.8, visibility: vis }} />
            <MapLibre.FillLayer id="basemap-landuse-industrial" sourceLayerID="landuse"
              filter={['any', ['==', ['get', 'class'], 'industrial'], ['==', ['get', 'class'], 'commercial']]}
              minZoomLevel={10}
              style={{ fillColor: p.industrial, fillOpacity: p.landcoverOpacity * 0.6, visibility: vis }} />
            {/* Parks */}
            <MapLibre.FillLayer id="basemap-park" sourceLayerID="park"
              style={{ fillColor: p.park, fillOpacity: p.parkOpacity, visibility: vis }} />
          </MapLibre.VectorSource>
          );
        })()}

        {/* ================================================================== */}
        {/* COMPOSITE TILE MODE - Single VectorSource with server-side quilting */}
        {/* Uses ~20 layers instead of 3000+ for massive performance improvement */}
        {/* Requires mbtiles converted with sourceLayerID="charts" */}
        {/* ================================================================== */}
        {useMBTiles && tileServerReady && useCompositeTiles && debugIsSourceVisible('charts') && (
          <MapLibre.VectorSource
            key={`composite-charts-${s52Mode}`}
            id="composite-charts"
            tileUrlTemplates={[compositeTileUrl]}
            minZoomLevel={0}
            maxZoomLevel={18}
            // @ts-ignore - undocumented but useful for debugging
            onMapboxError={(e: any) => logger.error(LogCategory.TILES, 'VectorSource error', e)}
          >
            {/* ============================================== */}
            {/* S-52 LAYER ORDER: Opaque Background Fills First */}
            {/* ============================================== */}
            
            {/* DEPARE - Depth Areas (S-52: Opaque background, themed by mode) */}
            <MapLibre.FillLayer
              id="composite-depare"
              sourceLayerID="charts"
              minZoomLevel={0}
              filter={['==', ['get', 'OBJL'], 42]}
              style={{
                fillColor: [
                  'step',
                  ['coalesce', ['get', 'DRVAL1'], 0],
                  s52Colors.DEPIT,       // < 0m - Drying/intertidal
                  0, s52Colors.DEPVS,    // 0-2m - very shallow
                  2, s52Colors.DEPMS,    // 2-5m - medium shallow
                  5, s52Colors.DEPMD,    // 5-10m - medium deep
                  10, s52Colors.DEPDW,   // 10m+ - deep water
                ],
                fillOpacity: mapStyle === 'satellite' ? scaledDepthAreaOpacitySatellite : scaledDepthAreaOpacity,
                visibility: (showDepthAreas && mapStyle !== 'satellite') ? 'visible' : 'none',
              }}
            />
            
            {/* LNDARE - Land Areas (S-52: Opaque background - must be after DEPARE) */}
            <MapLibre.FillLayer
              id="composite-lndare"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 71]}
              style={{
                fillColor: s52Colors.LANDA,
                fillOpacity: mapStyle === 'satellite' ? 0.2 : 1,
                visibility: (showLand && mapStyle !== 'satellite') ? 'visible' : 'none',
              }}
            />
            
            {/* ============================================== */}
            {/* S-52 LAYER ORDER: Semi-transparent Area Fills  */}
            {/* ============================================== */}
            
            {/* DRGARE - Dredged Areas (US6 only at z12+) */}
            <MapLibre.FillLayer
              id="composite-drgare"
              sourceLayerID="charts"
              minZoomLevel={12}
              filter={['==', ['get', 'OBJL'], 46]}
              style={{
                fillColor: '#87CEEB',
                fillOpacity: scaledDredgedAreaOpacity,
              }}
            />
            
            {/* FAIRWY - Fairways */}
            <MapLibre.FillLayer
              id="composite-fairwy"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 51]}
              style={{
                fillColor: '#E6E6FA',
                fillOpacity: scaledFairwayOpacity,
              }}
            />
            
            {/* CBLARE - Cable Areas */}
            <MapLibre.FillLayer
              id="composite-cblare"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 20]}
              style={{
                fillColor: '#800080',
                fillOpacity: scaledCableAreaOpacity,
                visibility: showCables ? 'visible' : 'none',
              }}
            />
            
            {/* PIPARE - Pipeline Areas */}
            <MapLibre.FillLayer
              id="composite-pipare"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 92]}
              style={{
                fillColor: '#008000',
                fillOpacity: scaledPipelineAreaOpacity,
                visibility: showPipelines ? 'visible' : 'none',
              }}
            />
            
            {/* RESARE - Restricted Areas */}
            <MapLibre.FillLayer
              id="composite-resare"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 112]}
              style={{
                fillColor: [
                  'match',
                  ['get', 'CATREA'],
                  14, '#FF0000',
                  12, '#FF0000',
                  4, '#00AA00',
                  7, '#00AA00',
                  8, '#00AA00',
                  9, '#00AA00',
                  '#FF00FF',
                ],
                fillOpacity: scaledRestrictedAreaOpacity,
                visibility: showRestrictedAreas ? 'visible' : 'none',
              }}
            />
            
            {/* CTNARE - Caution Areas */}
            <MapLibre.FillLayer
              id="composite-ctnare"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 27]}
              style={{
                fillColor: '#FFD700',
                fillOpacity: scaledCautionAreaOpacity,
                visibility: showCautionAreas ? 'visible' : 'none',
              }}
            />
            
            {/* MIPARE - Military Practice Areas */}
            <MapLibre.FillLayer
              id="composite-mipare"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 83]}
              style={{
                fillColor: '#FF0000',
                fillOpacity: scaledMilitaryAreaOpacity,
                visibility: showMilitaryAreas ? 'visible' : 'none',
              }}
            />
            
            {/* ACHARE - Anchorage Areas */}
            <MapLibre.FillLayer
              id="composite-achare"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 4]}
              style={{
                fillColor: '#4169E1',
                fillOpacity: scaledAnchorageOpacity,
                visibility: showAnchorages ? 'visible' : 'none',
              }}
            />
            
            {/* MARCUL - Marine Farms */}
            <MapLibre.FillLayer
              id="composite-marcul"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 82]}
              style={{
                fillColor: '#228B22',
                fillOpacity: scaledMarineFarmOpacity,
                visibility: showMarineFarms ? 'visible' : 'none',
              }}
            />
            
            {/* SEAARE - Sea Area (named water bodies) */}
            <MapLibre.SymbolLayer
              id="composite-seaare"
              sourceLayerID="charts"
              minZoomLevel={8}
              filter={['all',
                ['==', ['get', 'OBJL'], 119],
                ['has', 'OBJNAM']
              ]}
              style={{
                textField: ['get', 'OBJNAM'],
                textSize: ['interpolate', ['linear'], ['zoom'], 8, 10, 12, 14],
                textColor: '#4169E1',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1.5,
                textFont: ['Noto Sans Italic'],
                textAllowOverlap: false,
                symbolSpacing: 500,
                visibility: showSeaAreaNames ? 'visible' : 'none',
              }}
            />
            
            {/* LNDRGN - Land Region names */}
            <MapLibre.SymbolLayer
              id="composite-lndrgn"
              sourceLayerID="charts"
              minZoomLevel={10}
              filter={['all',
                ['==', ['get', 'OBJL'], 73],
                ['has', 'OBJNAM']
              ]}
              style={{
                textField: ['get', 'OBJNAM'],
                textSize: 11,
                textColor: '#654321',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1.5,
                textFont: ['Noto Sans Regular'],
                textAllowOverlap: false,
                visibility: showLandRegions ? 'visible' : 'none',
              }}
            />
            
            {/* ============================================== */}
            {/* S-52 LAYER ORDER: Structures & Construction    */}
            {/* ============================================== */}
            
            {/* BRIDGE - Bridges (line) */}
            {/* BRIDGE - Bridges (lines) Halo */}
            <MapLibre.LineLayer
              id="composite-bridge-halo"
              sourceLayerID="charts"
              minZoomLevel={12}
              filter={['all',
                ['==', ['get', 'OBJL'], 11],
                ['==', ['geometry-type'], 'LineString']
              ]}
              style={{
                lineColor: '#FFFFFF',
                lineWidth: scaledBridgeLineWidth + scaledBridgeLineHalo,
                lineOpacity: scaledBridgeLineHalo > 0 ? scaledBridgeOpacity * 0.8 : 0,
                visibility: showBridges ? 'visible' : 'none',
              }}
            />
            
            <MapLibre.LineLayer
              id="composite-bridge"
              sourceLayerID="charts"
              minZoomLevel={12}
              filter={['all',
                ['==', ['get', 'OBJL'], 11],
                ['==', ['geometry-type'], 'LineString']
              ]}
              style={{
                lineColor: '#696969',
                lineWidth: scaledBridgeLineWidth,
                lineOpacity: scaledBridgeOpacity,
                visibility: showBridges ? 'visible' : 'none',
              }}
            />
            
            {/* BRIDGE - Bridges (polygon fill) */}
            <MapLibre.FillLayer
              id="composite-bridge-fill"
              sourceLayerID="charts"
              minZoomLevel={12}
              filter={['all',
                ['==', ['get', 'OBJL'], 11],
                ['==', ['geometry-type'], 'Polygon']
              ]}
              style={{
                fillColor: '#A9A9A9',
                fillOpacity: 0.6,
                visibility: showBridges ? 'visible' : 'none',
              }}
            />
            
            {/* BUISGL - Buildings */}
            <MapLibre.FillLayer
              id="composite-buisgl"
              sourceLayerID="charts"
              minZoomLevel={12}
              filter={['==', ['get', 'OBJL'], 12]}
              style={{
                fillColor: '#8B4513',
                fillOpacity: 0.4,
                visibility: showBuildings ? 'visible' : 'none',
              }}
            />
            
            {/* MORFAC - Mooring Facilities */}
            <MapLibre.SymbolLayer
              id="composite-morfac"
              sourceLayerID="charts"
              minZoomLevel={12}
              filter={['all',
                ['==', ['get', 'OBJL'], 84],
                ['==', ['geometry-type'], 'Point']
              ]}
              style={{
                iconImage: 'mooring-buoy',
                iconSize: scaledMooringIconSize,
                iconOpacity: scaledMooringSymbolOpacity,
                iconAllowOverlap: true,
                visibility: showMoorings ? 'visible' : 'none',
              }}
            />
            
            {/* MORFAC - Mooring Facilities (line - dolphins, piers) */}
            {/* MORFAC - Mooring Facilities (lines) Halo */}
            <MapLibre.LineLayer
              id="composite-morfac-line-halo"
              sourceLayerID="charts"
              minZoomLevel={12}
              filter={['all',
                ['==', ['get', 'OBJL'], 84],
                ['==', ['geometry-type'], 'LineString']
              ]}
              style={{
                lineColor: '#FFFFFF',
                lineWidth: scaledMooringLineHaloWidth,
                lineOpacity: scaledMooringLineHalo > 0 ? scaledMooringOpacity * 0.8 : 0,
                visibility: showMoorings ? 'visible' : 'none',
              }}
            />
            
            <MapLibre.LineLayer
              id="composite-morfac-line"
              sourceLayerID="charts"
              minZoomLevel={12}
              filter={['all',
                ['==', ['get', 'OBJL'], 84],
                ['==', ['geometry-type'], 'LineString']
              ]}
              style={{
                lineColor: '#4B0082',
                lineWidth: scaledMooringLineWidth,
                lineOpacity: scaledMooringOpacity,
                visibility: showMoorings ? 'visible' : 'none',
              }}
            />
            
            {/* MORFAC - Mooring Facilities (polygon - piers, jetties) */}
            <MapLibre.FillLayer
              id="composite-morfac-fill"
              sourceLayerID="charts"
              minZoomLevel={12}
              filter={['all',
                ['==', ['get', 'OBJL'], 84],
                ['==', ['geometry-type'], 'Polygon']
              ]}
              style={{
                fillColor: '#4B0082',
                fillOpacity: 0.4,
                visibility: showMoorings ? 'visible' : 'none',
              }}
            />
            
            {/* SLCONS - Shoreline Construction (seawalls, breakwaters, etc) Halo */}
            <MapLibre.LineLayer
              id="composite-slcons-halo"
              sourceLayerID="charts"
              minZoomLevel={12}
              filter={['all',
                ['==', ['get', 'OBJL'], 122],
                ['==', ['geometry-type'], 'LineString']
              ]}
              style={{
                lineColor: '#FFFFFF',
                lineWidth: scaledShorelineConstructionHaloWidth,
                lineOpacity: scaledShorelineConstructionHalo > 0 ? scaledShorelineConstructionOpacity * 0.8 : 0,
                visibility: showShorelineConstruction ? 'visible' : 'none',
              }}
            />
            
            {/* SLCONS - Shoreline Construction (seawalls, breakwaters, etc) */}
            <MapLibre.LineLayer
              id="composite-slcons"
              sourceLayerID="charts"
              minZoomLevel={12}
              filter={['all',
                ['==', ['get', 'OBJL'], 122],
                ['==', ['geometry-type'], 'LineString']
              ]}
              style={{
                lineColor: '#5C4033',
                lineWidth: scaledShorelineConstructionLineWidth,
                lineOpacity: scaledShorelineConstructionOpacity,
                visibility: showShorelineConstruction ? 'visible' : 'none',
              }}
            />
            
            {/* SLCONS - Shoreline Construction (points - rip-rap, etc) */}
            <MapLibre.CircleLayer
              id="composite-slcons-point"
              sourceLayerID="charts"
              minZoomLevel={12}
              filter={['all',
                ['==', ['get', 'OBJL'], 122],
                ['==', ['geometry-type'], 'Point']
              ]}
              style={{
                circleColor: '#5C4033',
                circleRadius: ['interpolate', ['linear'], ['zoom'], 12, 3, 14, 4, 18, 6],
                circleStrokeColor: '#FFFFFF',
                circleStrokeWidth: 1,
                visibility: showShorelineConstruction ? 'visible' : 'none',
              }}
            />
            
            {/* SLCONS - Shoreline Construction (polygon) */}
            <MapLibre.FillLayer
              id="composite-slcons-fill"
              sourceLayerID="charts"
              filter={['all',
                ['==', ['get', 'OBJL'], 122],
                ['==', ['geometry-type'], 'Polygon']
              ]}
              style={{
                fillColor: '#808080',
                fillOpacity: 0.5,
                visibility: showShorelineConstruction ? 'visible' : 'none',
              }}
            />
            
            {/* ============================================== */}
            {/* S-52 LAYER ORDER: Line Features               */}
            {/* ============================================== */}
            
            {/* DEPCNT - Depth Contours Halo */}
            <MapLibre.LineLayer
              id="composite-depcnt-halo"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 43]}
              style={{
                lineColor: s52Mode === 'day' ? '#FFFFFF' : s52Colors.DEPDW,
                lineWidth: scaledDepthContourLineHaloWidth,
                lineOpacity: scaledDepthContourLineHalo > 0 ? 0.5 * scaledDepthContourLineOpacity : 0,
                visibility: showDepthContours ? 'visible' : 'none',
              }}
            />
            
            {/* DEPCNT - Depth Contours */}
            <MapLibre.LineLayer
              id="composite-depcnt"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 43]}
              style={{
                lineColor: s52Colors.CHGRD,
                lineWidth: scaledDepthContourLineWidth,
                lineOpacity: 0.7 * scaledDepthContourLineOpacity,
                visibility: showDepthContours ? 'visible' : 'none',
              }}
            />
            
            {/* COALNE - Coastline Halo */}
            <MapLibre.LineLayer
              id="composite-coalne-halo"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 30]}
              style={{
                lineColor: s52Mode === 'day' ? '#FFFFFF' : s52Colors.DEPDW,
                lineWidth: scaledCoastlineHaloWidth,
                lineOpacity: scaledCoastlineHalo > 0 ? scaledCoastlineOpacity * 0.8 : 0,
              }}
            />
            
            {/* COALNE - Coastline */}
            <MapLibre.LineLayer
              id="composite-coalne"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 30]}
              style={{
                lineColor: s52Colors.CSTLN,
                lineWidth: scaledCoastlineLineWidth,
                lineOpacity: scaledCoastlineOpacity,
              }}
            />
            
            {/* CBLSUB/CBLOHD - Cables Halo */}
            <MapLibre.LineLayer
              id="composite-cables-halo"
              sourceLayerID="charts"
              filter={['any',
                ['==', ['get', 'OBJL'], 22],
                ['==', ['get', 'OBJL'], 21]
              ]}
              style={{
                lineColor: '#FFFFFF',
                lineWidth: scaledCableLineWidth + scaledCableLineHalo,
                lineOpacity: scaledCableLineHalo > 0 ? scaledCableLineOpacity * 0.8 : 0,
                visibility: showCables ? 'visible' : 'none',
              }}
            />
            
            {/* CBLSUB/CBLOHD - Cables */}
            <MapLibre.LineLayer
              id="composite-cables"
              sourceLayerID="charts"
              filter={['any',
                ['==', ['get', 'OBJL'], 22],
                ['==', ['get', 'OBJL'], 21]
              ]}
              style={{
                lineColor: '#800080',
                lineWidth: scaledCableLineWidth,
                lineDasharray: [3, 2],
                lineOpacity: scaledCableLineOpacity,
                visibility: showCables ? 'visible' : 'none',
              }}
            />
            
            {/* PIPSOL - Pipelines Halo */}
            <MapLibre.LineLayer
              id="composite-pipsol-halo"
              sourceLayerID="charts"
              filter={['in', ['get', 'OBJL'], ['literal', [94, 98]]]}
              style={{
                lineColor: '#FFFFFF',
                lineWidth: scaledPipelineLineWidth + scaledPipelineLineHalo,
                lineOpacity: scaledPipelineLineHalo > 0 ? scaledPipelineLineOpacity * 0.8 : 0,
                visibility: showPipelines ? 'visible' : 'none',
              }}
            />
            
            {/* PIPSOL - Pipelines */}
            <MapLibre.LineLayer
              id="composite-pipsol"
              sourceLayerID="charts"
              filter={['in', ['get', 'OBJL'], ['literal', [94, 98]]]}
              style={{
                lineColor: '#008000',
                lineWidth: scaledPipelineLineWidth,
                lineDasharray: [5, 3],
                lineOpacity: scaledPipelineLineOpacity,
                visibility: showPipelines ? 'visible' : 'none',
              }}
            />
            
            {/* ============================================== */}
            {/* S-52 LAYER ORDER: Soundings & Seabed          */}
            {/* ============================================== */}
            
            {/* SOUNDG - Soundings filtered by SCAMIN (S-57 scale-based visibility) */}
            {/* SCAMIN is a scale denominator - larger values = show at more zoomed out levels */}
            {/* Zoom to scale: z4≈10M, z6≈2.5M, z8≈1M, z10≈250K, z12≈60K, z14≈15K */}
            <MapLibre.SymbolLayer
              id="composite-soundg"
              sourceLayerID="charts"
              minZoomLevel={4}
              filter={['all',
                ['==', ['get', 'OBJL'], 129],
                ['==', ['geometry-type'], 'Point']
              ]}
              style={{
                textField: depthTextFieldExpression,
                textSize: scaledSoundingsFontSize,
                textColor: '#000080',
                textHaloColor: '#FFFFFF',
                textHaloWidth: scaledSoundingsHalo,
                textOpacity: scaledSoundingsOpacity,
                textAllowOverlap: false,
                textPadding: [
                  'interpolate', ['linear'], ['zoom'],
                  6, 15,
                  8, 10,
                  10, 5,
                  12, 2,
                ],
                visibility: showSoundings ? 'visible' : 'none',
              }}
            />
            
            {/* SBDARE - Seabed composition (text only per S-52) 
                Note: NOAA charts use OBJL 121 for SBDARE, not the standard 114 */}
            <MapLibre.SymbolLayer
              id="composite-sbdare"
              sourceLayerID="charts"
              minZoomLevel={10}
              filter={['all',
                ['in', ['get', 'OBJL'], ['literal', [114, 121]]],
                ['==', ['geometry-type'], 'Point'],
                ['has', 'NATSUR']
              ]}
              style={{
                textField: [
                  'case',
                  ['in', '11', ['to-string', ['get', 'NATSUR']]], 'Co',  // Coral
                  ['in', '14', ['to-string', ['get', 'NATSUR']]], 'Sh',  // Shells
                  ['in', '"1"', ['to-string', ['get', 'NATSUR']]], 'M',  // Mud
                  ['in', '"2"', ['to-string', ['get', 'NATSUR']]], 'Cy', // Clay
                  ['in', '"3"', ['to-string', ['get', 'NATSUR']]], 'Si', // Silt
                  ['in', '"4"', ['to-string', ['get', 'NATSUR']]], 'S',  // Sand
                  ['in', '"5"', ['to-string', ['get', 'NATSUR']]], 'St', // Stone
                  ['in', '"6"', ['to-string', ['get', 'NATSUR']]], 'G',  // Gravel
                  ['in', '"7"', ['to-string', ['get', 'NATSUR']]], 'P',  // Pebbles
                  ['in', '"8"', ['to-string', ['get', 'NATSUR']]], 'Cb', // Cobbles
                  ['in', '"9"', ['to-string', ['get', 'NATSUR']]], 'R',  // Rock
                  '',
                ],
                textSize: 10,
                textColor: '#6B4423',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1.5,
                textFont: ['Noto Sans Italic'],
                textAllowOverlap: false,
                visibility: showSeabed ? 'visible' : 'none',
              }}
            />
            
            {/* ============================================== */}
            {/* S-52 LAYER ORDER: Hazards (Safety Critical)   */}
            {/* ============================================== */}
            
            {/* UWTROC - Underwater Rocks 
                WATLEV values: 1=partly submerged, 2=always dry, 3=always submerged, 
                4=covers/uncovers, 5=awash, 6=flooding, 7=floating */}
            <MapLibre.SymbolLayer
              id="composite-uwtroc"
              sourceLayerID="charts"
              filter={['all',
                ['==', ['get', 'OBJL'], 153],
                ['==', ['geometry-type'], 'Point']
              ]}
              style={{
                iconImage: [
                  'case',
                  ['==', ['coalesce', ['get', 'WATLEV'], 3], 2], 'rock-above-water',  // Always dry
                  ['==', ['coalesce', ['get', 'WATLEV'], 3], 3], 'rock-submerged',    // Always submerged
                  ['==', ['coalesce', ['get', 'WATLEV'], 3], 4], 'rock-uncovers',     // Covers and uncovers
                  ['==', ['coalesce', ['get', 'WATLEV'], 3], 5], 'rock-awash',        // Awash
                  'rock-submerged',  // Default for any other value (including 1, 6, 7, null)
                ],
                iconSize: scaledRockIconSize,
                iconOpacity: scaledRockSymbolOpacity,
                iconAllowOverlap: true,
                visibility: showHazards ? 'visible' : 'none',
              }}
            />
            
            {/* WRECKS - Wrecks */}
            <MapLibre.SymbolLayer
              id="composite-wrecks"
              sourceLayerID="charts"
              filter={['all',
                ['==', ['get', 'OBJL'], 159],
                ['==', ['geometry-type'], 'Point']
              ]}
              style={{
                iconImage: [
                  'match',
                  ['get', 'CATWRK'],
                  1, 'wreck-danger',
                  2, 'wreck-submerged',
                  3, 'wreck-hull',
                  4, 'wreck-safe',
                  5, 'wreck-uncovers',
                  'wreck-submerged',
                ],
                iconSize: scaledWreckIconSize,
                iconOpacity: scaledWreckSymbolOpacity,
                iconAllowOverlap: true,
                visibility: showHazards ? 'visible' : 'none',
              }}
            />
            
            {/* OBSTRN - Obstructions */}
            <MapLibre.SymbolLayer
              id="composite-obstrn"
              sourceLayerID="charts"
              filter={['all',
                ['==', ['get', 'OBJL'], 86],
                ['==', ['geometry-type'], 'Point']
              ]}
              style={{
                iconImage: 'obstruction',
                iconSize: scaledHazardIconSize,
                iconOpacity: scaledHazardSymbolOpacity,
                iconAllowOverlap: true,
                visibility: showHazards ? 'visible' : 'none',
              }}
            />
            
            {/* WATTUR halo - Water Turbulence (tide rips) */}
            <MapLibre.SymbolLayer
              id="composite-wattur-halo"
              sourceLayerID="charts"
              minZoomLevel={8}
              filter={['all',
                ['==', ['get', 'OBJL'], 156],
                ['==', ['geometry-type'], 'Point']
              ]}
              style={{
                iconImage: 'tide-rips-halo',
                iconSize: scaledTideRipsHaloSize,
                iconOpacity: scaledTideRipsSymbolOpacity,
                iconAllowOverlap: true,
                visibility: showHazards ? 'visible' : 'none',
              }}
            />
            
            {/* WATTUR - Water Turbulence (breakers, eddies, overfalls, rips) */}
            <MapLibre.SymbolLayer
              id="composite-wattur"
              sourceLayerID="charts"
              minZoomLevel={8}
              filter={['all',
                ['==', ['get', 'OBJL'], 156],
                ['==', ['geometry-type'], 'Point']
              ]}
              style={{
                iconImage: 'tide-rips',
                iconSize: scaledTideRipsIconSize,
                iconOpacity: scaledTideRipsSymbolOpacity,
                iconAllowOverlap: true,
                visibility: showHazards ? 'visible' : 'none',
              }}
            />
            
            {/* ============================================== */}
            {/* S-52 LAYER ORDER: Aids to Navigation (AtoN)   */}
            {/* Most prominent - near top of draw order       */}
            {/* ============================================== */}
            
            {/* Buoy halos - white background for visibility */}
            <MapLibre.SymbolLayer
              id="composite-buoys-halo"
              sourceLayerID="charts"
              filter={['any',
                ['==', ['get', 'OBJL'], 17],
                ['==', ['get', 'OBJL'], 14],
                ['==', ['get', 'OBJL'], 18],
                ['==', ['get', 'OBJL'], 19],
                ['==', ['get', 'OBJL'], 16],
                ['==', ['get', 'OBJL'], 15]
              ]}
              style={{
                iconImage: [
                  'match',
                  ['get', 'BOYSHP'],
                  1, 'buoy-conical-halo',    // Conical buoy
                  2, 'buoy-can-halo',        // Can buoy
                  3, 'buoy-spherical-halo',  // Spherical buoy
                  4, 'buoy-pillar-halo',     // Pillar buoy
                  5, 'buoy-spar-halo',       // Spar buoy
                  6, 'buoy-barrel-halo',     // Barrel buoy
                  7, 'buoy-super-halo',      // Super buoy
                  'buoy-pillar-halo',        // Default
                ],
                iconSize: scaledBuoyHaloSize,
                iconOpacity: scaledBuoySymbolOpacity,
                iconAllowOverlap: true,
                visibility: showBuoys ? 'visible' : 'none',
              }}
            />
            
            {/* Buoys - BOYLAT, BOYCAR, etc. */}
            <MapLibre.SymbolLayer
              id="composite-buoys"
              sourceLayerID="charts"
              filter={['any',
                ['==', ['get', 'OBJL'], 17],
                ['==', ['get', 'OBJL'], 14],
                ['==', ['get', 'OBJL'], 18],
                ['==', ['get', 'OBJL'], 19],
                ['==', ['get', 'OBJL'], 16],
                ['==', ['get', 'OBJL'], 15]
              ]}
              style={{
                iconImage: [
                  'match',
                  ['get', 'BOYSHP'],
                  1, 'buoy-conical',
                  2, 'buoy-can',
                  3, 'buoy-spherical',
                  4, 'buoy-pillar',
                  5, 'buoy-spar',
                  6, 'buoy-barrel',
                  7, 'buoy-super',
                  'buoy-pillar',
                ],
                iconSize: scaledBuoyIconSize,
                iconOpacity: scaledBuoySymbolOpacity,
                iconAllowOverlap: true,
                visibility: showBuoys ? 'visible' : 'none',
              }}
            />
            
            {/* Beacon halos - white background for visibility */}
            <MapLibre.SymbolLayer
              id="composite-beacons-halo"
              sourceLayerID="charts"
              filter={['any',
                ['==', ['get', 'OBJL'], 7],
                ['==', ['get', 'OBJL'], 5],
                ['==', ['get', 'OBJL'], 8],
                ['==', ['get', 'OBJL'], 9],
                ['==', ['get', 'OBJL'], 6]
              ]}
              style={{
                iconImage: [
                  'match',
                  ['get', 'BCNSHP'],
                  1, 'beacon-stake-halo',      // Stake beacon
                  2, 'beacon-withy-halo',      // Withy beacon
                  3, 'beacon-tower-halo',      // Tower beacon
                  4, 'beacon-lattice-halo',    // Lattice beacon
                  5, 'beacon-cairn-halo',      // Cairn beacon
                  'beacon-generic-halo',       // Default/generic beacon
                ],
                iconSize: scaledBeaconHaloSize,
                iconOpacity: scaledBeaconSymbolOpacity,
                iconAllowOverlap: true,
                visibility: showBeacons ? 'visible' : 'none',
              }}
            />
            
            {/* Beacons - BCNLAT, BCNCAR, etc. */}
            <MapLibre.SymbolLayer
              id="composite-beacons"
              sourceLayerID="charts"
              filter={['any',
                ['==', ['get', 'OBJL'], 7],
                ['==', ['get', 'OBJL'], 5],
                ['==', ['get', 'OBJL'], 8],
                ['==', ['get', 'OBJL'], 9],
                ['==', ['get', 'OBJL'], 6]
              ]}
              style={{
                iconImage: [
                  'match',
                  ['get', 'BCNSHP'],
                  1, 'beacon-stake',
                  2, 'beacon-withy',
                  3, 'beacon-tower',
                  4, 'beacon-lattice',
                  5, 'beacon-cairn',
                  'beacon-generic',
                ],
                iconSize: scaledBeaconIconSize,
                iconOpacity: scaledBeaconSymbolOpacity,
                iconAllowOverlap: true,
                visibility: showBeacons ? 'visible' : 'none',
              }}
            />
            
            {/* Light Sector arcs - background outline (renders BEFORE light symbols) */}
            <MapLibre.LineLayer
              id="composite-lights-sector-outline"
              sourceLayerID="charts"
              minZoomLevel={10}
              filter={['all',
                ['==', ['get', 'OBJL'], 75],
                ['==', ['geometry-type'], 'LineString']
              ]}
              style={{
                lineColor: '#000000',
                lineWidth: 7,
                lineOpacity: 0.7,
                visibility: showLights ? 'visible' : 'none',
              }}
            />
            
            {/* Colored sector arcs (on top of outline) */}
            <MapLibre.LineLayer
              id="composite-lights-sector"
              sourceLayerID="charts"
              minZoomLevel={10}
              filter={['all',
                ['==', ['get', 'OBJL'], 75],
                ['==', ['geometry-type'], 'LineString']
              ]}
              style={{
                lineColor: [
                  'match',
                  ['to-string', ['get', 'COLOUR']],
                  '1', '#FFFFFF',        // White
                  '3', '#FF0000',        // Red
                  '4', '#00FF00',        // Green
                  '6', '#FFFF00',        // Yellow
                  '11', '#FFA500',       // Orange
                  '#FF00FF',             // Default magenta (makes missing obvious)
                ],
                lineWidth: 4,
                lineOpacity: 1.0,
                visibility: showLights ? 'visible' : 'none',
              }}
            />
            
            {/* LIGHTS - symbols (on top of sector arcs) */}
            <MapLibre.SymbolLayer
              id="composite-lights"
              sourceLayerID="charts"
              filter={['all',
                ['==', ['get', 'OBJL'], 75],
                ['==', ['geometry-type'], 'Point']
              ]}
              style={{
                iconImage: [
                  'match',
                  ['get', 'COLOUR'],
                  1, 'light-white',
                  3, 'light-red',
                  4, 'light-green',
                  'light-major',
                ],
                iconSize: scaledLightIconSize,
                iconOpacity: scaledLightSymbolOpacity,
                iconRotate: ['coalesce', ['get', '_ORIENT'], 135],
                iconRotationAlignment: 'map',
                iconAnchor: 'bottom',
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
                visibility: showLights ? 'visible' : 'none',
              }}
            />
            
            {/* Landmark halos - white background for visibility */}
            <MapLibre.SymbolLayer
              id="composite-lndmrk-halo"
              sourceLayerID="charts"
              filter={['all',
                ['==', ['get', 'OBJL'], 74],
                ['==', ['geometry-type'], 'Point']
              ]}
              style={{
                iconImage: [
                  'match',
                  ['get', 'CATLMK'],
                  3, 'landmark-chimney-halo',     // Chimney
                  5, 'landmark-flagpole-halo',    // Flagpole
                  7, 'landmark-mast-halo',        // Mast
                  9, 'landmark-monument-halo',    // Monument
                  10, 'landmark-monument-halo',   // Column/memorial
                  12, 'landmark-monument-halo',   // Obelisk
                  13, 'landmark-monument-halo',   // Statue
                  14, 'landmark-church-halo',     // Church/Chapel
                  17, 'landmark-tower-halo',      // Tower
                  18, 'landmark-windmill-halo',   // Windmill
                  19, 'landmark-windmill-halo',   // Windmotor
                  20, 'landmark-church-halo',     // Temple
                  28, 'landmark-radio-tower-halo', // Radio/TV tower
                  'landmark-tower-halo',          // Default
                ],
                iconSize: scaledLandmarkHaloSize,
                iconOpacity: scaledLandmarkSymbolOpacity,
                iconAllowOverlap: true,
                visibility: showLandmarks ? 'visible' : 'none',
              }}
            />
            
            {/* LNDMRK - Landmarks */}
            <MapLibre.SymbolLayer
              id="composite-lndmrk"
              sourceLayerID="charts"
              filter={['all',
                ['==', ['get', 'OBJL'], 74],
                ['==', ['geometry-type'], 'Point']
              ]}
              style={{
                iconImage: [
                  'match',
                  ['get', 'CATLMK'],
                  3, 'landmark-chimney',
                  5, 'landmark-flagpole',
                  7, 'landmark-mast',
                  9, 'landmark-monument',
                  10, 'landmark-monument',
                  12, 'landmark-monument',
                  13, 'landmark-monument',
                  14, 'landmark-church',
                  17, 'landmark-tower',
                  18, 'landmark-windmill',
                  19, 'landmark-windmill',
                  20, 'landmark-church',
                  28, 'landmark-radio-tower',
                  'landmark-tower',
                ],
                iconSize: scaledLandmarkIconSize,
                iconOpacity: scaledLandmarkSymbolOpacity,
                iconAllowOverlap: true,
                visibility: showLandmarks ? 'visible' : 'none',
              }}
            />
            
            {/* LNDMRK Label */}
            <MapLibre.SymbolLayer
              id="composite-lndmrk-label"
              sourceLayerID="charts"
              minZoomLevel={11}
              filter={['all',
                ['==', ['get', 'OBJL'], 74],
                ['==', ['geometry-type'], 'Point']
              ]}
              style={{
                textField: [
                  'case',
                  ['has', 'OBJNAM'], ['get', 'OBJNAM'],
                  ['==', ['get', 'CATLMK'], 3], 'Chy',
                  ['==', ['get', 'CATLMK'], 7], 'Mast',
                  ['==', ['get', 'CATLMK'], 9], 'Mon',
                  ['==', ['get', 'CATLMK'], 13], 'Statue',
                  ['==', ['get', 'CATLMK'], 14], 'Cross',
                  ['==', ['get', 'CATLMK'], 17], 'Tr',
                  ['==', ['get', 'CATLMK'], 18], 'Windmill',
                  ['==', ['get', 'CATLMK'], 20], 'Spire',
                  '',
                ],
                textSize: 10,
                textColor: '#333333',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1.5,
                textOffset: [0, 1.3],
                textAllowOverlap: false,
                visibility: showLandmarks ? 'visible' : 'none',
              }}
            />
            
            {/* ============================================== */}
            {/* S-52 LAYER ORDER: Labels & Text (on top)      */}
            {/* ============================================== */}
            
            {/* ACHBRT - Anchor Berths (specific anchorage positions) */}
            <MapLibre.SymbolLayer
              id="composite-achbrt"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 3]}
              style={{
                iconImage: 'anchor',
                iconSize: scaledAnchorIconSize,
                iconOpacity: scaledAnchorSymbolOpacity,
                iconAllowOverlap: true,
                visibility: showAnchorBerths ? 'visible' : 'none',
              }}
            />
            
            {/* ACHBRT Label */}
            <MapLibre.SymbolLayer
              id="composite-achbrt-label"
              sourceLayerID="charts"
              minZoomLevel={10}
              filter={['==', ['get', 'OBJL'], 3]}
              style={{
                textField: ['coalesce', ['get', 'OBJNAM'], 'Anchorage'],
                textSize: 10,
                textColor: '#9400D3',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1.5,
                textOffset: [0, 1.5],
                textAllowOverlap: false,
                visibility: showAnchorBerths ? 'visible' : 'none',
              }}
            />
            
            {/* CBLSUB - Submarine Cables Halo */}
            <MapLibre.LineLayer
              id="composite-cblsub-halo"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 22]}
              style={{
                lineColor: '#FFFFFF',
                lineWidth: (scaledCableLineWidth * 1.33) + scaledCableLineHalo,
                lineCap: 'round',
                lineOpacity: scaledCableLineHalo > 0 ? scaledCableLineOpacity * 0.8 : 0,
                visibility: showCables ? 'visible' : 'none',
              }}
            />
            
            {/* CBLSUB - Submarine Cables (separate from combined cables layer) */}
            <MapLibre.LineLayer
              id="composite-cblsub"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 22]}
              style={{
                lineColor: '#800080',
                lineWidth: scaledCableLineWidth * 1.33,
                lineDasharray: [4, 2],
                lineCap: 'round',
                lineOpacity: scaledCableLineOpacity,
                visibility: showCables ? 'visible' : 'none',
              }}
            />
            
            {/* CBLSUB Label */}
            <MapLibre.SymbolLayer
              id="composite-cblsub-label"
              sourceLayerID="charts"
              minZoomLevel={12}
              filter={['==', ['get', 'OBJL'], 22]}
              style={{
                textField: 'Cable',
                textSize: 9,
                textColor: '#800080',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1.5,
                symbolPlacement: 'line',
                symbolSpacing: 400,
                visibility: showCables ? 'visible' : 'none',
              }}
            />
            
            {/* PIPSOL Label */}
            <MapLibre.SymbolLayer
              id="composite-pipsol-label"
              sourceLayerID="charts"
              minZoomLevel={12}
              filter={['in', ['get', 'OBJL'], ['literal', [94, 98]]]}
              style={{
                textField: [
                  'case',
                  ['==', ['get', 'CATPIP'], 1], 'Oil',
                  ['==', ['get', 'CATPIP'], 2], 'Gas',
                  ['==', ['get', 'CATPIP'], 3], 'Water',
                  ['==', ['get', 'CATPIP'], 4], 'Sewer',
                  'Pipe',
                ],
                textSize: 9,
                textColor: '#006400',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1.5,
                symbolPlacement: 'line',
                symbolSpacing: 400,
                visibility: showPipelines ? 'visible' : 'none',
              }}
            />
            
            {/* UWTROC Label */}
            <MapLibre.SymbolLayer
              id="composite-uwtroc-label"
              sourceLayerID="charts"
              minZoomLevel={12}
              filter={['all',
                ['==', ['get', 'OBJL'], 153],
                ['==', ['geometry-type'], 'Point'],
                ['has', 'VALSOU']
              ]}
              style={{
                textField: ['to-string', ['round', ['get', 'VALSOU']]],
                textSize: 9,
                textColor: '#000000',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1.5,
                textOffset: [0, 1.3],
                visibility: showHazards ? 'visible' : 'none',
              }}
            />
            
            {/* DEPCNT Labels */}
            <MapLibre.SymbolLayer
              id="composite-depcnt-labels"
              sourceLayerID="charts"
              minZoomLevel={12}
              filter={['==', ['get', 'OBJL'], 43]}
              style={{
                textField: ['to-string', ['coalesce', ['get', 'VALDCO'], '']],
                textSize: scaledDepthContourFontSize,
                textColor: '#1E3A5F',
                textHaloColor: '#FFFFFF',
                textHaloWidth: scaledDepthContourLabelHalo,
                textOpacity: scaledDepthContourLabelOpacity,
                symbolPlacement: 'line',
                symbolSpacing: 300,
                textFont: ['Noto Sans Regular'],
                textMaxAngle: 30,
                textAllowOverlap: false,
                visibility: showDepthContours ? 'visible' : 'none',
              }}
            />
            
            {/* ============================================== */}
            {/* S-52 LAYER ORDER: Area Outlines (top of fills)*/}
            {/* These go on top so boundaries are visible     */}
            {/* ============================================== */}
            
            {/* LNDARE outline */}
            <MapLibre.LineLayer
              id="composite-lndare-outline"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 71]}
              style={{
                lineColor: '#8B7355',
                lineWidth: 1,
                visibility: showLand ? 'visible' : 'none',
              }}
            />
            
            {/* DRGARE outline */}
            <MapLibre.LineLayer
              id="composite-drgare-outline"
              sourceLayerID="charts"
              minZoomLevel={12}
              filter={['==', ['get', 'OBJL'], 46]}
              style={{
                lineColor: '#4682B4',
                lineWidth: 1.5,
                lineDasharray: [4, 2],
              }}
            />
            
            {/* FAIRWY outline */}
            <MapLibre.LineLayer
              id="composite-fairwy-outline"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 51]}
              style={{
                lineColor: '#9370DB',
                lineWidth: 2,
                lineDasharray: [8, 4],
              }}
            />
            
            {/* CBLARE outline */}
            <MapLibre.LineLayer
              id="composite-cblare-outline"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 20]}
              style={{
                lineColor: '#800080',
                lineWidth: scaledCableLineWidth,
                lineDasharray: [4, 2],
                lineOpacity: scaledCableLineOpacity,
                visibility: showCables ? 'visible' : 'none',
              }}
            />
            
            {/* PIPARE outline */}
            <MapLibre.LineLayer
              id="composite-pipare-outline"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 92]}
              style={{
                lineColor: '#008000',
                lineWidth: scaledPipelineLineWidth * 0.75,
                lineDasharray: [6, 3],
                lineOpacity: scaledPipelineLineOpacity,
                visibility: showPipelines ? 'visible' : 'none',
              }}
            />
            
            {/* RESARE outline */}
            <MapLibre.LineLayer
              id="composite-resare-outline"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 112]}
              style={{
                lineColor: [
                  'match',
                  ['get', 'CATREA'],
                  14, '#FF0000',
                  12, '#FF0000',
                  4, '#00AA00',
                  7, '#00AA00',
                  8, '#00AA00',
                  9, '#00AA00',
                  '#FF00FF',
                ],
                lineWidth: 2,
                lineDasharray: [6, 3],
                visibility: showRestrictedAreas ? 'visible' : 'none',
              }}
            />
            
            {/* CTNARE outline */}
            <MapLibre.LineLayer
              id="composite-ctnare-outline"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 27]}
              style={{
                lineColor: '#FFA500',
                lineWidth: 2,
                lineDasharray: [6, 3],
                visibility: showCautionAreas ? 'visible' : 'none',
              }}
            />
            
            {/* MIPARE outline */}
            <MapLibre.LineLayer
              id="composite-mipare-outline"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 83]}
              style={{
                lineColor: '#FF0000',
                lineWidth: 2,
                lineDasharray: [4, 2],
                visibility: showMilitaryAreas ? 'visible' : 'none',
              }}
            />
            
            {/* ACHARE outline */}
            <MapLibre.LineLayer
              id="composite-achare-outline"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 4]}
              style={{
                lineColor: '#9400D3',
                lineWidth: 2,
                lineDasharray: [8, 4],
                visibility: showAnchorages ? 'visible' : 'none',
              }}
            />
            
            {/* MARCUL outline */}
            <MapLibre.LineLayer
              id="composite-marcul-outline"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 82]}
              style={{
                lineColor: '#8B4513',
                lineWidth: 2,
                lineDasharray: [4, 2],
                visibility: showMarineFarms ? 'visible' : 'none',
              }}
            />
          </MapLibre.VectorSource>
        )}

        {/* ================================================================== */}
        {/* BASEMAP OVERLAY - Roads, buildings, labels rendered ABOVE charts   */}
        {/* Uses a separate VectorSource so these land-context features appear */}
        {/* on top of the opaque chart fills (DEPARE, LNDARE)                 */}
        {/* ================================================================== */}
        {tileServerReady && hasLocalBasemap && isVectorStyle && debugIsSourceVisible('basemap') && (() => {
          const p = basemapPalette;
          const vis = 'visible';
          const basemapTileUrl = basemapTileSets.length > 0
            ? `${tileServer.getTileServerUrl()}/tiles/${basemapTileSets[0].id}/{z}/{x}/{y}.pbf`
            : `${tileServer.getTileServerUrl()}/tiles/basemap_alaska/{z}/{x}/{y}.pbf`;
          return (
          <MapLibre.VectorSource
            key={`basemap-overlay-${mapStyle}-${s52Mode}`}
            id="basemap-overlay-source"
            tileUrlTemplates={[basemapTileUrl]}
            minZoomLevel={0}
            maxZoomLevel={14}
          >
            {/* Buildings */}
            <MapLibre.FillLayer id="basemap-building" sourceLayerID="building" minZoomLevel={13}
              style={{ fillColor: p.building, fillOpacity: p.buildingOpacity, visibility: vis }} />
            {/* Boundaries */}
            <MapLibre.LineLayer id="basemap-boundary-state" sourceLayerID="boundary"
              filter={['==', ['get', 'admin_level'], 4]}
              style={{ lineColor: p.grid, lineWidth: 1, lineDasharray: [3, 2], lineOpacity: p.roadNightDim * 0.6, visibility: vis }} />
            {/* Roads */}
            <MapLibre.LineLayer id="basemap-roads-motorway-casing" sourceLayerID="transportation"
              filter={['==', ['get', 'class'], 'motorway']}
              style={{ lineColor: p.roadCasing, lineWidth: ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 3, 14, 6], lineOpacity: p.roadNightDim, visibility: vis }} />
            <MapLibre.LineLayer id="basemap-roads-motorway" sourceLayerID="transportation"
              filter={['==', ['get', 'class'], 'motorway']}
              style={{ lineColor: p.road, lineWidth: ['interpolate', ['linear'], ['zoom'], 6, 0.5, 10, 2, 14, 4], lineOpacity: p.roadNightDim, visibility: vis }} />
            <MapLibre.LineLayer id="basemap-roads-trunk" sourceLayerID="transportation"
              filter={['==', ['get', 'class'], 'trunk']}
              style={{ lineColor: p.road, lineWidth: ['interpolate', ['linear'], ['zoom'], 6, 0.4, 10, 1.5, 14, 3], lineOpacity: p.roadNightDim * 0.8, visibility: vis }} />
            <MapLibre.LineLayer id="basemap-roads-primary" sourceLayerID="transportation"
              filter={['==', ['get', 'class'], 'primary']}
              style={{ lineColor: p.road, lineWidth: ['interpolate', ['linear'], ['zoom'], 6, 0.3, 10, 1, 14, 2.5], lineOpacity: p.roadNightDim * 0.7, visibility: vis }} />
            <MapLibre.LineLayer id="basemap-roads-secondary" sourceLayerID="transportation"
              filter={['==', ['get', 'class'], 'secondary']} minZoomLevel={9}
              style={{ lineColor: p.road, lineWidth: ['interpolate', ['linear'], ['zoom'], 9, 0.5, 14, 2], lineOpacity: p.roadNightDim * 0.6, visibility: vis }} />
            <MapLibre.LineLayer id="basemap-roads-minor" sourceLayerID="transportation"
              filter={['any', ['==', ['get', 'class'], 'tertiary'], ['==', ['get', 'class'], 'minor'], ['==', ['get', 'class'], 'service']]}
              minZoomLevel={11}
              style={{ lineColor: p.road, lineWidth: 1, lineOpacity: p.roadNightDim * 0.5, visibility: vis }} />
            {/* Airports */}
            <MapLibre.FillLayer id="basemap-aeroway-area" sourceLayerID="aeroway"
              filter={['==', ['geometry-type'], 'Polygon']} minZoomLevel={10}
              style={{ fillColor: p.building, fillOpacity: p.buildingOpacity * 0.7, visibility: vis }} />
            <MapLibre.LineLayer id="basemap-aeroway-runway" sourceLayerID="aeroway"
              filter={['==', ['get', 'class'], 'runway']} minZoomLevel={10}
              style={{ lineColor: p.grid, lineWidth: ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 8], lineOpacity: p.roadNightDim, visibility: vis }} />
            {/* Labels */}
            <MapLibre.SymbolLayer id="basemap-place-city" sourceLayerID="place"
              filter={['==', ['get', 'class'], 'city']}
              style={{ textField: ['get', 'name'], textSize: ['interpolate', ['linear'], ['zoom'], 4, 12, 10, 20],
                textColor: p.text, textHaloColor: p.textHalo, textHaloWidth: 2,
                textFont: ['Noto Sans Bold'], textTransform: 'uppercase', textLetterSpacing: 0.1, visibility: vis }} />
            <MapLibre.SymbolLayer id="basemap-place-town" sourceLayerID="place"
              filter={['==', ['get', 'class'], 'town']} minZoomLevel={6}
              style={{ textField: ['get', 'name'], textSize: ['interpolate', ['linear'], ['zoom'], 6, 10, 12, 14],
                textColor: p.text, textHaloColor: p.textHalo, textHaloWidth: 1.5,
                textFont: ['Noto Sans Bold'], visibility: vis }} />
            <MapLibre.SymbolLayer id="basemap-place-village" sourceLayerID="place"
              filter={['==', ['get', 'class'], 'village']} minZoomLevel={9}
              style={{ textField: ['get', 'name'], textSize: ['interpolate', ['linear'], ['zoom'], 9, 9, 14, 12],
                textColor: p.text, textHaloColor: p.textHalo, textHaloWidth: 1,
                textFont: ['Noto Sans Regular'], visibility: vis }} />
            <MapLibre.SymbolLayer id="basemap-water-name" sourceLayerID="water_name" minZoomLevel={8}
              style={{ textField: ['get', 'name'], textSize: 11, textColor: p.waterText,
                textHaloColor: p.textHalo, textHaloWidth: 1, textFont: ['Noto Sans Italic'], visibility: vis }} />
            <MapLibre.SymbolLayer id="basemap-road-label" sourceLayerID="transportation_name" minZoomLevel={12}
              style={{ textField: ['get', 'name'], textSize: 10, symbolPlacement: 'line',
                textColor: p.text, textHaloColor: p.textHalo, textHaloWidth: 1,
                textFont: ['Noto Sans Regular'], visibility: vis }} />
          </MapLibre.VectorSource>
          );
        })()}

        {/* Marker layer to establish z-order boundary between charts and labels */}
        {/* Uses an empty ShapeSource with a CircleLayer as the anchor point */}
        {/* GNIS layers reference this to ensure they render above ALL chart content */}
        {tileServerReady && (
          <MapLibre.ShapeSource
            id="layer-order-marker-source"
            shape={{ type: 'FeatureCollection', features: [] }}
          >
            <MapLibre.CircleLayer
              id="chart-top-marker"
              style={{ circleRadius: 0, circleOpacity: 0 }}
            />
          </MapLibre.ShapeSource>
        )}

        {/* Tide Stations Layer - Rendered BEFORE GNIS so names appear on top */}
        {showTideStations && tideStations.length > 0 && (
          <>
            <MapLibre.ShapeSource
            id="tide-stations-source"
            shape={{
              type: 'FeatureCollection',
              features: tideStations.map(station => {
                const state = tideIconMap.get(station.id);
                const heightStr = state?.currentHeight != null 
                  ? state?.targetHeight != null
                    ? `${state.currentHeight.toFixed(1)} ft / ${state.targetHeight.toFixed(1)} ft`
                    : `${state.currentHeight.toFixed(1)} ft`
                  : '';
                return {
                  type: 'Feature',
                  geometry: {
                    type: 'Point',
                    coordinates: [station.lng, station.lat],
                  },
                  properties: {
                    id: station.id,
                    name: station.name,
                    type: station.type,
                    iconName: state?.iconName || 'tide-40',
                    rotation: state?.rotation || 0,
                    heightLabel: heightStr,
                  },
                };
              }),
            }}
          >
            {/* Tide station halo - white background for visibility */}
            <MapLibre.SymbolLayer
              id="tide-stations-halo"
              minZoomLevel={7}
              style={{
                iconImage: 'arrow-halo',
                iconRotate: ['get', 'rotation'],
                iconSize: scaledTideStationHaloSize,
                iconOpacity: scaledTideStationSymbolOpacity,
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
              }}
            />
            <MapLibre.SymbolLayer
              id="tide-stations-icon"
              minZoomLevel={7}
              style={{
                iconImage: ['get', 'iconName'],
                iconRotate: ['get', 'rotation'],
                iconSize: scaledTideStationIconSize,
                iconOpacity: scaledTideStationSymbolOpacity,
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
              }}
            />
            {/* Tide station name - at arrow head */}
            <MapLibre.SymbolLayer
              id="tide-stations-label"
              minZoomLevel={10}
              style={{
                textField: ['get', 'name'],
                textFont: ['Noto Sans Regular'],
                textSize: scaledTideStationLabelSize,
                textColor: '#0066CC',
                textHaloColor: '#FFFFFF',
                textHaloWidth: scaledTideStationTextHalo * 1.33,
                textOpacity: scaledTideStationTextOpacity,
                // Always at arrow head: flip offset direction when arrow points down (falling tide)
                textOffset: [
                  'case',
                  ['==', ['get', 'rotation'], 180],
                    ['literal', [0, 3.5]],   // Arrow down (falling): text below symbol (at head)
                  ['literal', [0, -3.5]]     // Arrow up (rising): text above symbol (at head)
                ],
                textAnchor: 'center',
                textAllowOverlap: true,
              }}
            />
            {/* Tide height value label - further out from arrow head */}
            <MapLibre.SymbolLayer
              id="tide-stations-value"
              minZoomLevel={10}
              style={{
                textField: ['get', 'heightLabel'],
                textFont: ['Noto Sans Regular'],
                textSize: scaledTideStationLabelSize,
                textColor: '#0066CC',
                textHaloColor: '#FFFFFF',
                textHaloWidth: scaledTideStationTextHalo,
                textOpacity: scaledTideStationTextOpacity,
                // Further from head than station name
                textOffset: [
                  'case',
                  ['==', ['get', 'rotation'], 180],
                    ['literal', [0, 5.5]],   // Arrow down (falling): text further below
                  ['literal', [0, -5.5]]     // Arrow up (rising): text further above
                ],
                textAnchor: 'center',
                textAllowOverlap: true,
              }}
            />
          </MapLibre.ShapeSource>
          </>
        )}

        {/* Current Stations Layer */}
        {showCurrentStations && currentStations.length > 0 && (
          <>
            <MapLibre.ShapeSource
            id="current-stations-source"
            shape={{
              type: 'FeatureCollection',
              features: currentStations.map(station => {
                const state = currentIconMap.get(station.id);
                let velocityStr = '';
                if (state?.currentVelocity != null) {
                  const curVel = `${Math.abs(state.currentVelocity).toFixed(1)} kn`;
                  const maxVel = state?.targetVelocity != null 
                    ? ` / ${Math.abs(state.targetVelocity).toFixed(1)} kn` 
                    : '';
                  const slackStr = state?.nextSlackTime 
                    ? ` / Next Slack: ${state.nextSlackTime}` 
                    : '';
                  velocityStr = `${curVel}${maxVel}${slackStr}`;
                }
                const rotation = state?.rotation || 0;
                // Pre-calculate label offset to position at tail of arrow
                const rotationRad = rotation * Math.PI / 180;
                const labelOffsetX = -2.5 * Math.sin(rotationRad);
                const labelOffsetY = 2.5 * Math.cos(rotationRad);
                return {
                  type: 'Feature',
                  geometry: {
                    type: 'Point',
                    coordinates: [station.lng, station.lat],
                  },
                  properties: {
                    id: station.id,
                    name: station.name,
                    bin: station.bin,
                    iconName: state?.iconName || 'current-0',
                    rotation: rotation,
                    velocityLabel: velocityStr,
                    labelOffsetX: labelOffsetX,
                    labelOffsetY: labelOffsetY,
                  },
                };
              }),
            }}
          >
            {/* Current station halo - white background for visibility */}
            <MapLibre.SymbolLayer
              id="current-stations-halo"
              minZoomLevel={7}
              style={{
                iconImage: 'arrow-halo',
                iconRotate: ['get', 'rotation'],
                iconSize: scaledCurrentStationHaloSize,
                iconOpacity: scaledCurrentStationSymbolOpacity,
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
              }}
            />
            <MapLibre.SymbolLayer
              id="current-stations-icon"
              minZoomLevel={7}
              style={{
                iconImage: ['get', 'iconName'],
                iconRotate: ['get', 'rotation'],
                iconSize: scaledCurrentStationIconSize,
                iconOpacity: scaledCurrentStationSymbolOpacity,
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
              }}
            />
            {/* Current station name - at arrow head */}
            <MapLibre.SymbolLayer
              id="current-stations-label"
              minZoomLevel={10}
              style={{
                textField: ['get', 'name'],
                textFont: ['Noto Sans Regular'],
                textSize: scaledCurrentStationLabelSize,
                textColor: '#CC0066',
                textHaloColor: '#FFFFFF',
                textHaloWidth: scaledCurrentStationTextHalo * 1.33,
                textOpacity: scaledCurrentStationTextOpacity,
                // Always at arrow head: flip offset direction when arrow points down
                textOffset: [
                  'case',
                  ['all', ['>=', ['get', 'rotation'], 90], ['<', ['get', 'rotation'], 270]],
                    ['literal', [0, 3.5]],   // Arrow down: text below symbol (at head)
                  ['literal', [0, -3.5]]     // Arrow up: text above symbol (at head)
                ],
                textAnchor: 'center',
                textAllowOverlap: true,
              }}
            />
            {/* Current velocity label - further out from arrow head */}
            <MapLibre.SymbolLayer
              id="current-stations-value"
              minZoomLevel={10}
              style={{
                textField: ['get', 'velocityLabel'],
                textFont: ['Noto Sans Regular'],
                textSize: scaledCurrentStationLabelSize,
                textColor: '#CC0066',
                textHaloColor: '#FFFFFF',
                textHaloWidth: scaledCurrentStationTextHalo,
                textOpacity: scaledCurrentStationTextOpacity,
                textMaxWidth: 50,  // Prevent line wrapping (50 ems is very wide)
                // Further from head than station name
                textOffset: [
                  'case',
                  ['all', ['>=', ['get', 'rotation'], 90], ['<', ['get', 'rotation'], 270]],
                    ['literal', [0, 5.5]],   // Arrow down: text further below
                  ['literal', [0, -5.5]]     // Arrow up: text further above
                ],
                textAnchor: 'center',
                textAllowOverlap: true,
              }}
            />
          </MapLibre.ShapeSource>
          </>
        )}

        {/* Live Buoys Layer */}
        {showLiveBuoys && liveBuoys.length > 0 && (
          <>
            <MapLibre.ShapeSource
              id="live-buoys-source"
              shape={{
                type: 'FeatureCollection',
                features: liveBuoys.map((buoy) => {
                  return {
                    type: 'Feature',
                    geometry: {
                      type: 'Point',
                      coordinates: [buoy.longitude, buoy.latitude],
                    },
                    properties: {
                      id: buoy.id,
                      name: buoy.name,
                      buoyType: buoy.type,
                      isLiveBuoy: true,
                    },
                  };
                }),
              }}
            >
              {/* Live buoy halo - white background for visibility */}
              <MapLibre.SymbolLayer
                id="live-buoys-halo"
                minZoomLevel={5}
                style={{
                  iconImage: 'livebuoy-halo',
                  iconSize: scaledLiveBuoyHaloSize,
                  iconOpacity: scaledLiveBuoySymbolOpacity,
                  iconAllowOverlap: true,
                  iconIgnorePlacement: true,
                }}
              />
              {/* Live buoy icon */}
              <MapLibre.SymbolLayer
                id="live-buoys-icon"
                minZoomLevel={5}
                style={{
                  iconImage: 'livebuoy',
                  iconSize: scaledLiveBuoyIconSize,
                  iconOpacity: scaledLiveBuoySymbolOpacity,
                  iconAllowOverlap: true,
                  iconIgnorePlacement: true,
                }}
              />
              {/* Live buoy name label */}
              <MapLibre.SymbolLayer
                id="live-buoys-label"
                minZoomLevel={8}
                style={{
                  textField: ['get', 'name'],
                  textFont: ['Noto Sans Regular'],
                  textSize: 12,
                  textColor: '#FF8C00',
                  textHaloColor: '#FFFFFF',
                  textHaloWidth: 2,
                  textOpacity: 1.0,
                  textOffset: [0, 2],
                  textAnchor: 'top',
                  textAllowOverlap: false,
                }}
              />
            </MapLibre.ShapeSource>
          </>
        )}

        {/* ===== GNIS NAMES MOVED HERE TO RENDER ON TOP ===== */}

        {/* GNIS Place Names Layer - Reference data from USGS */}
        {/* IMPORTANT: Rendered AFTER tide/current stations so names appear on top */}
        {tileServerReady && gnisAvailable && showGNISNames && showPlaceNames && debugIsSourceVisible('gnis') && (
          <MapLibre.VectorSource
            id="gnis-names-source"
            tileUrlTemplates={[`${tileServer.getTileServerUrl()}/tiles/gnis_names_ak/{z}/{x}/{y}.pbf`]}
            maxZoomLevel={14}
          >
            {/* Water features - Bays, channels, sounds */}
            <MapLibre.SymbolLayer
              id="gnis-water-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'water']}
              minZoomLevel={6}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Regular'],
                textSize: scaledGnisFontSizes.water,
                textColor: '#0066CC',
                textHaloColor: '#FFFFFF',
                textHaloWidth: scaledGnisHalo,
                textOpacity: scaledGnisOpacity,
                textAllowOverlap: false,
                textIgnorePlacement: false,
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 10,
                symbolSortKey: ['get', 'PRIORITY'],
                visibility: showWaterNames ? 'visible' : 'none',
              }}
            />
            
            <MapLibre.SymbolLayer
              id="gnis-coastal-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'coastal']}
              minZoomLevel={6}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Regular'],
                textSize: scaledGnisFontSizes.coastal,
                textColor: '#5D4037',
                textHaloColor: '#FFFFFF',
                textHaloWidth: scaledGnisHalo,
                textOpacity: scaledGnisOpacity,
                textAllowOverlap: false,
                textIgnorePlacement: false,
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 10,
                symbolSortKey: ['get', 'PRIORITY'],
                visibility: showCoastalNames ? 'visible' : 'none',
              }}
            />
            
            <MapLibre.SymbolLayer
              id="gnis-landmark-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'landmark']}
              minZoomLevel={8}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Regular'], // Changed from Italic to Regular
                textSize: scaledGnisFontSizes.landmark,
                textColor: '#666666',
                textHaloColor: '#FFFFFF',
                textHaloWidth: scaledGnisHalo,
                textOpacity: scaledGnisOpacity,
                textAllowOverlap: false,
                textIgnorePlacement: false,
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 10,
                symbolSortKey: ['get', 'PRIORITY'],
                visibility: showLandmarkNames ? 'visible' : 'none',
              }}
            />
            
            <MapLibre.SymbolLayer
              id="gnis-populated-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'populated']}
              minZoomLevel={6}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Regular'], // Changed from Bold to Regular
                textSize: scaledGnisFontSizes.populated,
                textColor: '#CC0000',
                textHaloColor: '#FFFFFF',
                textHaloWidth: scaledGnisHalo * 1.25,
                textOpacity: scaledGnisOpacity,
                textAllowOverlap: false,
                textIgnorePlacement: false,
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 10,
                symbolSortKey: ['get', 'PRIORITY'],
                visibility: showPopulatedNames ? 'visible' : 'none',
              }}
            />
            
            <MapLibre.SymbolLayer
              id="gnis-stream-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'stream']}
              minZoomLevel={9}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Regular'], // Changed from Italic to Regular
                textSize: scaledGnisFontSizes.stream,
                textColor: '#3399FF',
                textHaloColor: '#FFFFFF',
                textHaloWidth: scaledGnisHalo * 0.875,
                textOpacity: scaledGnisOpacity,
                textAllowOverlap: false,
                textIgnorePlacement: false,
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 10,
                symbolSortKey: ['get', 'PRIORITY'],
                visibility: showStreamNames ? 'visible' : 'none',
              }}
            />
            
            <MapLibre.SymbolLayer
              id="gnis-lake-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'lake']}
              minZoomLevel={9}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Regular'], // Changed from Italic to Regular
                textSize: scaledGnisFontSizes.lake,
                textColor: '#66CCFF',
                textHaloColor: '#FFFFFF',
                textHaloWidth: scaledGnisHalo * 0.875,
                textOpacity: scaledGnisOpacity,
                textAllowOverlap: false,
                textIgnorePlacement: false,
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 10,
                symbolSortKey: ['get', 'PRIORITY'],
                visibility: showLakeNames ? 'visible' : 'none',
              }}
            />
            
            <MapLibre.SymbolLayer
              id="gnis-terrain-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'terrain']}
              minZoomLevel={10}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Regular'],
                textSize: scaledGnisFontSizes.terrain,
                textColor: '#999966',
                textHaloColor: '#FFFFFF',
                textHaloWidth: scaledGnisHalo * 0.875,
                textOpacity: scaledGnisOpacity,
                textAllowOverlap: false,
                textIgnorePlacement: false,
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 10,
                symbolSortKey: ['get', 'PRIORITY'],
                visibility: showTerrainNames ? 'visible' : 'none',
              }}
            />
          </MapLibre.VectorSource>
        )}

        {/* User Waypoint Markers */}
        {showWaypoints && userWaypoints.map((wp) => (
          <MapLibre.MarkerView
            key={wp.id}
            coordinate={[wp.longitude, wp.latitude]}
            anchor={{ x: 0.5, y: 1.0 }}
          >
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => openWaypointEdit(wp)}
            >
              <WaypointMapPin category={wp.category} color={wp.color} size={32} />
            </TouchableOpacity>
          </MapLibre.MarkerView>
        ))}

        {/* GPS Position Marker - always show when GPS available */}
        {gpsData.latitude !== null && gpsData.longitude !== null && (
          <MapLibre.MarkerView
            coordinate={[gpsData.longitude, gpsData.latitude]}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.shipMarker}>
              {/* Always show ship icon - conditional rendering inside MarkerView causes crashes */}
              <View 
                style={[
                  styles.shipIcon,
                  gpsData.heading !== null && { 
                    transform: [{ rotate: `${gpsData.heading}deg` }] 
                  }
                ]}
              >
                <View style={styles.shipBow} />
                <View style={styles.shipBody} />
              </View>
            </View>
          </MapLibre.MarkerView>
        )}

      </MapLibre.MapView>

      </View>

      {/* Chart Loading Progress Indicator - shows during background chart loading */}
      {chartLoadingProgress && (
        <View style={styles.chartLoadingOverlay}>
          <View style={styles.chartLoadingContainer}>
            <ActivityIndicator size="small" color="#007AFF" />
            <Text style={styles.chartLoadingText}>
              {chartLoadingProgress.phase}
            </Text>
            <Text style={styles.chartLoadingProgress}>
              {chartLoadingProgress.current} / {chartLoadingProgress.total}
            </Text>
          </View>
        </View>
      )}

      {/* ===== FOREFLIGHT-STYLE UI LAYOUT ===== */}
      
      {/* Top Menu Bar - horizontal strip with main controls */}
      <View style={[styles.topMenuBar, { top: insets.top + 8 }]}>
        {/* Layers button - opens layer selector */}
        <TouchableOpacity 
          style={[styles.topMenuBtn, showLayerSelector && styles.topMenuBtnActive]}
          onPress={() => {
            setShowLayerSelector(!showLayerSelector);
            setShowSettingsPanel(false);
          }}
        >
          <View style={styles.layerStackIcon}>
            <View style={[styles.layerStackLine, { top: 0, left: 0 }]} />
            <View style={[styles.layerStackLine, { top: 7, left: 2 }]} />
            <View style={[styles.layerStackLine, { top: 14, left: 4 }]} />
          </View>
        </TouchableOpacity>
        <View style={styles.topMenuDivider} />
        
        {/* Settings button - opens settings panel */}
        <TouchableOpacity 
          style={[styles.topMenuBtn, showSettingsPanel && styles.topMenuBtnActive]}
          onPress={() => {
            setShowSettingsPanel(!showSettingsPanel);
            setShowLayerSelector(false);
          }}
        >
          <Text style={styles.topMenuBtnText}>⚙️</Text>
        </TouchableOpacity>
        <View style={styles.topMenuDivider} />
        
        {/* Compass button - cycles through modes: Off -> Full -> Arc -> Tape -> Mini -> Off */}
        <TouchableOpacity 
          style={[styles.topMenuBtn, showCompass && styles.topMenuBtnActive]}
          onPress={() => {
            console.log(`[DynamicChartViewer] Cycling compass mode: ${compassMode}`);
            cycleCompassMode();
          }}
        >
          <Text style={styles.topMenuBtnText}>🧭</Text>
          {showCompass && (
            <Text style={{ fontSize: 8, color: '#4FC3F7', marginTop: -2 }}>
              {getCompassModeLabel(compassMode)}
            </Text>
          )}
        </TouchableOpacity>
        <View style={styles.topMenuDivider} />
        
        {/* Nav Data button - toggles navigation data displays */}
        <TouchableOpacity 
          style={[styles.topMenuBtn, showNavData && styles.topMenuBtnActive]}
          onPress={() => setShowNavData(!showNavData)}
        >
          <Ionicons 
            name={showNavData ? "speedometer" : "speedometer-outline"} 
            size={24} 
            color="#fff" 
          />
        </TouchableOpacity>
      </View>

      {/* Scale Bar - centered below top menu bar */}
      <View style={[styles.scaleBarContainer, { top: insets.top + 58 }]} pointerEvents="none">
        <View style={styles.scaleBarInner}>
          <View style={[styles.scaleBarLine, { width: scaleBarData.barWidthPx }]}>
            <View style={styles.scaleBarEndCapLeft} />
            <View style={styles.scaleBarEndCapRight} />
          </View>
          <Text style={styles.scaleBarLabel}>{scaleBarData.label}</Text>
        </View>
      </View>

      {/* Layer Selector Panel - ForeFlight-style multi-column overlay */}
      {showLayerSelector && (
        <View style={[styles.layerSelectorOverlay, { top: insets.top + 52 }]}>
          <ScrollView style={styles.layerSelectorScroll} showsVerticalScrollIndicator={true}>
            <View style={styles.layerSelectorContent}>
              {/* Column 1 */}
              <View style={styles.layerSelectorColumn}>
                {/* Base Map - Imagery */}
                <Text style={styles.layerSectionHeader}>Imagery</Text>
                <TouchableOpacity style={[styles.layerToggleRow, mapStyle === 'satellite' && styles.layerToggleRowActive]} onPress={() => setMapStyle('satellite')}>
                  <Text style={styles.layerToggleText}>Satellite</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.layerToggleRow, mapStyle === 'ocean' && styles.layerToggleRowActive, !hasLocalOcean && { opacity: 0.4 }]}
                  onPress={() => hasLocalOcean && setMapStyle('ocean')}
                  disabled={!hasLocalOcean}
                >
                  <Text style={styles.layerToggleText}>Ocean{!hasLocalOcean ? ' ⬇' : ''}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.layerToggleRow, mapStyle === 'terrain' && styles.layerToggleRowActive, !hasLocalTerrain && { opacity: 0.4 }]}
                  onPress={() => hasLocalTerrain && setMapStyle('terrain')}
                  disabled={!hasLocalTerrain}
                >
                  <Text style={styles.layerToggleText}>Terrain{!hasLocalTerrain ? ' ⬇' : ''}</Text>
                </TouchableOpacity>

                {/* Base Map - Map Styles */}
                <Text style={styles.layerSectionHeader}>Map</Text>
                <TouchableOpacity
                  style={[styles.layerToggleRow, mapStyle === 'light' && styles.layerToggleRowActive, !hasLocalBasemap && { opacity: 0.4 }]}
                  onPress={() => hasLocalBasemap ? setMapStyle('light') : setMapStyle('light')}
                >
                  <Text style={styles.layerToggleText}>Light{!hasLocalBasemap ? ' ⬇' : ''}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.layerToggleRow, mapStyle === 'dark' && styles.layerToggleRowActive, !hasLocalBasemap && { opacity: 0.4 }]}
                  onPress={() => hasLocalBasemap ? setMapStyle('dark') : setMapStyle('dark')}
                >
                  <Text style={styles.layerToggleText}>Dark{!hasLocalBasemap ? ' ⬇' : ''}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.layerToggleRow, mapStyle === 'street' && styles.layerToggleRowActive, !hasLocalBasemap && { opacity: 0.4 }]}
                  onPress={() => hasLocalBasemap ? setMapStyle('street') : setMapStyle('street')}
                >
                  <Text style={styles.layerToggleText}>Street{!hasLocalBasemap ? ' ⬇' : ''}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.layerToggleRow, mapStyle === 'nautical' && styles.layerToggleRowActive, !hasLocalBasemap && { opacity: 0.4 }]}
                  onPress={() => hasLocalBasemap ? setMapStyle('nautical') : setMapStyle('nautical')}
                >
                  <Text style={styles.layerToggleText}>Nautical{!hasLocalBasemap ? ' ⬇' : ''}</Text>
                </TouchableOpacity>

                {/* Display Mode Section */}
                <Text style={styles.layerSectionHeader}>Display Mode</Text>
                <TouchableOpacity style={[styles.layerToggleRow, s52Mode === 'day' && styles.layerToggleRowActive]} onPress={() => setS52Mode('day')}>
                  <Text style={styles.layerToggleText}>Day</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, s52Mode === 'dusk' && styles.layerToggleRowActive]} onPress={() => setS52Mode('dusk')}>
                  <Text style={styles.layerToggleText}>Dusk</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, s52Mode === 'night' && styles.layerToggleRowActive]} onPress={() => setS52Mode('night')}>
                  <Text style={styles.layerToggleText}>Night</Text>
                </TouchableOpacity>

                {/* Depth Section */}
                <Text style={styles.layerSectionHeader}>Depth</Text>
                <TouchableOpacity style={[styles.layerToggleRow, showDepthAreas && styles.layerToggleRowActive]} onPress={() => toggleLayer('depthAreas')}>
                  <Text style={styles.layerToggleText}>Depth Areas</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showDepthContours && styles.layerToggleRowActive]} onPress={() => toggleLayer('depthContours')}>
                  <Text style={styles.layerToggleText}>Depth Contours</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showSoundings && styles.layerToggleRowActive]} onPress={() => toggleLayer('soundings')}>
                  <Text style={styles.layerToggleText}>Soundings</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showSeabed && styles.layerToggleRowActive]} onPress={() => toggleLayer('seabed')}>
                  <Text style={styles.layerToggleText}>Seabed</Text>
                </TouchableOpacity>

                {/* Land Section */}
                <Text style={styles.layerSectionHeader}>Land</Text>
                <TouchableOpacity style={[styles.layerToggleRow, showLand && styles.layerToggleRowActive]} onPress={() => toggleLayer('land')}>
                  <Text style={styles.layerToggleText}>Land</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showCoastline && styles.layerToggleRowActive]} onPress={() => toggleLayer('coastline')}>
                  <Text style={styles.layerToggleText}>Coastline</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showLandmarks && styles.layerToggleRowActive]} onPress={() => toggleLayer('landmarks')}>
                  <Text style={styles.layerToggleText}>Landmarks</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showBuildings && styles.layerToggleRowActive]} onPress={() => toggleLayer('buildings')}>
                  <Text style={styles.layerToggleText}>Buildings</Text>
                </TouchableOpacity>

                {/* Names Section */}
                <Text style={styles.layerSectionHeader}>Names</Text>
                <TouchableOpacity style={[styles.layerToggleRow, showGNISNames && styles.layerToggleRowActive]} onPress={() => toggleLayer('gnisNames')}>
                  <Text style={styles.layerToggleText}>GNIS Names</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showSeaAreaNames && styles.layerToggleRowActive]} onPress={() => toggleLayer('seaAreaNames')}>
                  <Text style={styles.layerToggleText}>Sea Area Names</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showLandRegions && styles.layerToggleRowActive]} onPress={() => toggleLayer('landRegions')}>
                  <Text style={styles.layerToggleText}>Land Regions</Text>
                </TouchableOpacity>

                {/* Infrastructure Section */}
                <Text style={styles.layerSectionHeader}>Infrastructure</Text>
                <TouchableOpacity style={[styles.layerToggleRow, showBridges && styles.layerToggleRowActive]} onPress={() => toggleLayer('bridges')}>
                  <Text style={styles.layerToggleText}>Bridges</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showMoorings && styles.layerToggleRowActive]} onPress={() => toggleLayer('moorings')}>
                  <Text style={styles.layerToggleText}>Moorings</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showShorelineConstruction && styles.layerToggleRowActive]} onPress={() => toggleLayer('shorelineConstruction')}>
                  <Text style={styles.layerToggleText}>Shore Construction</Text>
                </TouchableOpacity>
              </View>

              {/* Column 2 */}
              <View style={styles.layerSelectorColumn}>
                {/* Navigation Section */}
                <Text style={styles.layerSectionHeader}>Navigation</Text>
                <TouchableOpacity style={[styles.layerToggleRow, showLights && styles.layerToggleRowActive]} onPress={() => toggleLayer('lights')}>
                  <Text style={styles.layerToggleText}>Lights</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showBuoys && styles.layerToggleRowActive]} onPress={() => toggleLayer('buoys')}>
                  <Text style={styles.layerToggleText}>Buoys</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showBeacons && styles.layerToggleRowActive]} onPress={() => toggleLayer('beacons')}>
                  <Text style={styles.layerToggleText}>Beacons</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showSectors && styles.layerToggleRowActive]} onPress={() => toggleLayer('sectors')}>
                  <Text style={styles.layerToggleText}>Sectors</Text>
                </TouchableOpacity>

                {/* Predictions Section */}
                <Text style={styles.layerSectionHeader}>Predictions</Text>
                <TouchableOpacity style={[styles.layerToggleRow, showTideStations && styles.layerToggleRowActive]} onPress={() => toggleLayer('tideStations')}>
                  <Text style={styles.layerToggleText}>Tide Stations</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showCurrentStations && styles.layerToggleRowActive]} onPress={() => toggleLayer('currentStations')}>
                  <Text style={styles.layerToggleText}>Current Stations</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showTideDetails && styles.layerToggleRowActive]} onPress={() => toggleLayer('tideDetails')}>
                  <Text style={styles.layerToggleText}>Tide Details</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showCurrentDetails && styles.layerToggleRowActive]} onPress={() => toggleLayer('currentDetails')}>
                  <Text style={styles.layerToggleText}>Current Details</Text>
                </TouchableOpacity>

                {/* Weather Section */}
                <Text style={styles.layerSectionHeader}>Weather</Text>
                <TouchableOpacity style={[styles.layerToggleRow, showLiveBuoys && styles.layerToggleRowActive]} onPress={() => toggleLayer('liveBuoys')}>
                  <Text style={styles.layerToggleText}>Live Buoys</Text>
                </TouchableOpacity>

                {/* Waypoints Section */}
                <Text style={styles.layerSectionHeader}>Waypoints</Text>
                <TouchableOpacity style={[styles.layerToggleRow, showWaypoints && styles.layerToggleRowActive]} onPress={() => toggleLayer('waypoints')}>
                  <Text style={styles.layerToggleText}>Waypoints</Text>
                </TouchableOpacity>

                {/* Areas Section */}
                <Text style={styles.layerSectionHeader}>Areas</Text>
                <TouchableOpacity style={[styles.layerToggleRow, showRestrictedAreas && styles.layerToggleRowActive]} onPress={() => toggleLayer('restrictedAreas')}>
                  <Text style={styles.layerToggleText}>Restricted</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showCautionAreas && styles.layerToggleRowActive]} onPress={() => toggleLayer('cautionAreas')}>
                  <Text style={styles.layerToggleText}>Caution</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showMilitaryAreas && styles.layerToggleRowActive]} onPress={() => toggleLayer('militaryAreas')}>
                  <Text style={styles.layerToggleText}>Military</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showAnchorages && styles.layerToggleRowActive]} onPress={() => toggleLayer('anchorages')}>
                  <Text style={styles.layerToggleText}>Anchorages</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showAnchorBerths && styles.layerToggleRowActive]} onPress={() => toggleLayer('anchorBerths')}>
                  <Text style={styles.layerToggleText}>Anchor Berths</Text>
                </TouchableOpacity>

                {/* Hazards & Utilities Section */}
                <Text style={styles.layerSectionHeader}>Hazards & Utilities</Text>
                <TouchableOpacity style={[styles.layerToggleRow, showHazards && styles.layerToggleRowActive]} onPress={() => toggleLayer('hazards')}>
                  <Text style={styles.layerToggleText}>Hazards</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showCables && styles.layerToggleRowActive]} onPress={() => toggleLayer('cables')}>
                  <Text style={styles.layerToggleText}>Cables</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showPipelines && styles.layerToggleRowActive]} onPress={() => toggleLayer('pipelines')}>
                  <Text style={styles.layerToggleText}>Pipelines</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, showMarineFarms && styles.layerToggleRowActive]} onPress={() => toggleLayer('marineFarms')}>
                  <Text style={styles.layerToggleText}>Marine Farms</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      )}

      {/* Chart Debug Overlay - Shows active chart based on zoom, right of lat/long */}
      <ChartDebugOverlay
        visible={showChartDebug}
        currentZoom={currentZoom}
        centerCoord={centerCoord}
        mbtilesCharts={mbtilesCharts}
        tileServerReady={tileServerReady}
        topOffset={insets.top + 52}
        leftOffset={12}
      />

      {/* Technical Debug Info Panel */}
      {showDebug && (
        <View style={[styles.debugPanel, { top: insets.top + 56 }]}>
          <Text style={styles.debugTitle}>Technical Debug</Text>
          <ScrollView style={styles.debugScrollView} showsVerticalScrollIndicator={true}>
            <Text style={styles.debugSectionTitle}>Data Sources</Text>
            <View style={styles.debugToggleRow}>
              <TouchableOpacity 
                style={[styles.debugToggle, useMBTiles && styles.debugToggleActive]}
                onPress={() => setUseMBTiles(!useMBTiles)}
              >
                <Text style={[styles.debugToggleText, useMBTiles && styles.debugToggleTextActive]}>
                  MBTiles ({mbtilesCharts.length})
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.debugDivider} />
            
            <Text style={styles.debugSectionTitle}>Tile Server</Text>
            <Text style={styles.debugText}>
              Status: {tileServerReady ? '✅ Running' : '❌ Not running'}
            </Text>
            <Text style={styles.debugText}>
              Mode: 🚀 Composite (1 source)
            </Text>
            <View style={styles.debugDivider} />
            
            <Text style={styles.debugSectionTitle}>Storage</Text>
            <View style={styles.debugStorageRow}>
              <Text style={styles.debugStorageLabel}>Total:</Text>
              <Text style={styles.debugStorageValue}>
                {storageUsed.total >= 1024 * 1024 * 1024 
                  ? `${(storageUsed.total / 1024 / 1024 / 1024).toFixed(2)} GB`
                  : `${(storageUsed.total / 1024 / 1024).toFixed(1)} MB`}
              </Text>
            </View>
            <View style={styles.debugStorageRow}>
              <Text style={styles.debugStorageLabel}>Vector charts:</Text>
              <Text style={styles.debugStorageValueSmall}>
                {(storageUsed.vector / 1024 / 1024).toFixed(1)} MB
              </Text>
            </View>
            {storageUsed.raster > 0 && (
              <View style={styles.debugStorageRow}>
                <Text style={styles.debugStorageLabel}>Raster charts:</Text>
                <Text style={styles.debugStorageValueSmall}>
                  {(storageUsed.raster / 1024 / 1024).toFixed(1)} MB
                </Text>
              </View>
            )}
            <View style={styles.debugDivider} />
            
            <Text style={styles.debugSectionTitle}>Chart Inventory ({mbtilesCharts.length} available)</Text>
            <View style={styles.debugStorageRow}>
              <Text style={styles.debugStorageLabel}>Tier 1 (US1-3):</Text>
              <Text style={styles.debugStorageValueSmall}>
                {mbtilesCharts.filter(m => m.chartId.match(/^US[123]/)).length} charts
              </Text>
            </View>
            <View style={styles.debugStorageRow}>
              <Text style={styles.debugStorageLabel}>Tier 2 (US4-6):</Text>
              <Text style={styles.debugStorageValueSmall}>
                {mbtilesCharts.filter(m => m.chartId.match(/^US[456]/)).length} charts
              </Text>
            </View>
            <View style={styles.debugDivider} />
            
            <Text style={styles.debugSectionTitle}>Rendering ({allChartsToRender.length} active)</Text>
            <View style={styles.debugStorageRow}>
              <Text style={styles.debugStorageLabel}>Charts loaded:</Text>
              <Text style={styles.debugStorageValueSmall}>{chartsToRender.length}</Text>
            </View>
            <View style={styles.debugDivider} />
            
            <Text style={styles.debugSectionTitle}>All Charts</Text>
            <View style={styles.debugChartList}>
              {mbtilesCharts.map((chart, idx) => {
                const isRendering = allChartsToRender.includes(chart.chartId);
                return (
                  <Text 
                    key={chart.chartId} 
                    style={[
                      styles.debugChartItem,
                      isRendering && { color: '#4CAF50' },
                    ]}
                  >
                    {chart.chartId}{isRendering ? ' ✓' : ''}
                  </Text>
                );
              })}
            </View>
            <View style={styles.debugDivider} />
            
            <Text style={styles.debugSectionTitle}>Server URLs</Text>
            <Text style={styles.debugInfo} selectable>{debugInfo}</Text>
          </ScrollView>
          
          <View style={styles.debugActions}>
            <TouchableOpacity 
              style={styles.debugActionBtn}
              onPress={async () => {
                logger.info(LogCategory.CHARTS, 'Clear cache & reload initiated');
                // Stop tile server (closes all database connections)
                await tileServer.stopTileServer();
                // Clear all chart state
                setMbtilesCharts([]);
                setChartsToRender([]);
                setLoadingPhase('us1');
                setRasterCharts([]);
                setCharts([]);
                setGnisAvailable(false);
                setHasLocalBasemap(false);
                setSatelliteTileSets([]);
                setBasemapTileSets([]);
                setOceanTileSets([]);
                setTerrainTileSets([]);
                setTileServerReady(false);
                // Increment cache buster to force Mapbox to re-fetch tiles
                setCacheBuster(prev => prev + 1);
                // Small delay to ensure cleanup
                await new Promise(r => setTimeout(r, 500));
                // Reload everything fresh
                loadCharts();
              }}
            >
              <Text style={styles.debugActionBtnText}>Clear Cache & Reload</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.debugCloseBtn} 
              onPress={() => setShowDebug(false)}
            >
              <Text style={styles.debugCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Max zoom indicator - shows when limited and near max */}
      {limitZoomToCharts && currentZoom >= maxAvailableZoom - 2 && (
        <View style={[styles.maxZoomIndicator, { bottom: 42, right: 12 }]}>
          <Text style={styles.maxZoomText}>
            Chart limit: z{maxAvailableZoom}
          </Text>
        </View>
      )}

      {/* Bottom Settings Panel - Display, Symbols, Other tabs */}
      {showSettingsPanel && (
        <View style={[styles.controlPanel, themedStyles.controlPanel]}>
          {/* Tab Bar */}
          <View style={[styles.tabBar, themedStyles.tabBar]}>
            <TouchableOpacity 
              style={[styles.tabButton, themedStyles.tabButton, activeTab === 'display' && styles.tabButtonActive, activeTab === 'display' && themedStyles.tabButtonActive]}
              onPress={() => setActiveTab('display')}
            >
              <Text style={[styles.tabButtonText, themedStyles.tabButtonText, activeTab === 'display' && styles.tabButtonTextActive, activeTab === 'display' && themedStyles.tabButtonTextActive]}>Display</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.tabButton, themedStyles.tabButton, activeTab === 'symbols' && styles.tabButtonActive, activeTab === 'symbols' && themedStyles.tabButtonActive]}
              onPress={() => setActiveTab('symbols')}
            >
              <Text style={[styles.tabButtonText, themedStyles.tabButtonText, activeTab === 'symbols' && styles.tabButtonTextActive, activeTab === 'symbols' && themedStyles.tabButtonTextActive]}>Symbols</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.tabButton, themedStyles.tabButton, activeTab === 'other' && styles.tabButtonActive, activeTab === 'other' && themedStyles.tabButtonActive]}
              onPress={() => setActiveTab('other')}
            >
              <Text style={[styles.tabButtonText, themedStyles.tabButtonText, activeTab === 'other' && styles.tabButtonTextActive, activeTab === 'other' && themedStyles.tabButtonTextActive]}>Other</Text>
            </TouchableOpacity>
          </View>

          {/* Tab Content */}
          <View style={styles.tabContent}>
            {/* Display Settings Tab */}
            {activeTab === 'display' && (
              <View style={styles.displayTabContainer}>
                {/* Controls at top - full width */}
                <View style={styles.displayControlsTop}>
                  {(() => {
                    const feature = DISPLAY_FEATURES.find(f => f.id === selectedDisplayFeature);
                    if (!feature) return null;
                    
                    const formatPercent = (v: number) => `${Math.round(v * 100)}%`;
                    
                    const updateValue = async (key: keyof DisplaySettings, value: number) => {
                      const newSettings = { ...displaySettings, [key]: value };
                      setDisplaySettings(newSettings);
                      await displaySettingsService.saveSettings(newSettings);
                    };
                    
                    const resetFeature = async () => {
                      const updates: Partial<DisplaySettings> = {};
                      if (feature.fontSizeKey) updates[feature.fontSizeKey] = 1.5;  // 1.5 is nominal 100%
                      if (feature.haloKey) updates[feature.haloKey] = 1.0;
                      if (feature.strokeKey) updates[feature.strokeKey] = 1.0;
                      if (feature.opacityKey) updates[feature.opacityKey] = 1.0;
                      const newSettings = { ...displaySettings, ...updates };
                      setDisplaySettings(newSettings);
                      await displaySettingsService.saveSettings(newSettings);
                    };
                    
                    return (
                      <>
                        <View style={styles.displayControlHeader}>
                          <Text style={[styles.displayFeatureName, themedStyles.displayFeatureName]}>{feature.label}</Text>
                          <View style={styles.headerRightSection}>
                            <View style={[
                              styles.featureTypeBadge,
                              feature.type === 'text' && styles.featureTypeBadgeText,
                              feature.type === 'line' && styles.featureTypeBadgeLine,
                              feature.type === 'area' && styles.featureTypeBadgeArea,
                            ]}>
                              <Text style={styles.featureTypeBadgeLabel}>{feature.type}</Text>
                            </View>
                            <TouchableOpacity 
                              style={styles.resetIconBtn}
                              onPress={resetFeature}
                            >
                              <Text style={styles.resetIconText}>↺</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                        
                        {/* Font Size slider - for text features */}
                        {feature.fontSizeKey && (
                          <View style={styles.controlRow}>
                            <Text style={[styles.controlRowLabel, themedStyles.controlRowLabel]}>Font Size</Text>
                            <View style={styles.sliderContainerCompact}>
                              <Text style={[styles.sliderMinLabelSmall, themedStyles.sliderMinMaxLabel]}>67%</Text>
                              <Slider
                                style={styles.displaySliderCompact}
                                minimumValue={1.0}
                                maximumValue={3.0}
                                step={0.1}
                                value={displaySettings[feature.fontSizeKey] as number}
                                onValueChange={(v) => updateValue(feature.fontSizeKey!, v)}
                                minimumTrackTintColor="#4FC3F7"
                                maximumTrackTintColor={uiTheme.sliderTrack}
                                thumbTintColor="#4FC3F7"
                              />
                              <Text style={[styles.sliderMaxLabelSmall, themedStyles.sliderMinMaxLabel]}>200%</Text>
                            </View>
                            <Text style={[styles.sliderValueCompact, themedStyles.sliderValueCompact]}>
                              {Math.round((displaySettings[feature.fontSizeKey] as number) / 1.5 * 100)}%
                            </Text>
                          </View>
                        )}
                        
                        {/* Halo/Stroke slider - for text features */}
                        {feature.haloKey && (
                          <View style={styles.controlRow}>
                            <Text style={[styles.controlRowLabel, themedStyles.controlRowLabel]}>Halo</Text>
                            <View style={styles.sliderContainerCompact}>
                              <Text style={[styles.sliderMinLabelSmall, themedStyles.sliderMinMaxLabel]}>0%</Text>
                              <Slider
                                style={styles.displaySliderCompact}
                                minimumValue={0}
                                maximumValue={3.0}
                                step={0.1}
                                value={displaySettings[feature.haloKey] as number}
                                onValueChange={(v) => updateValue(feature.haloKey!, v)}
                                minimumTrackTintColor="#E040FB"
                                maximumTrackTintColor={uiTheme.sliderTrack}
                                thumbTintColor="#E040FB"
                              />
                              <Text style={[styles.sliderMaxLabelSmall, themedStyles.sliderMinMaxLabel]}>300%</Text>
                            </View>
                            <Text style={[styles.sliderValueCompact, themedStyles.sliderValueCompact]}>
                              {formatPercent(displaySettings[feature.haloKey] as number)}
                            </Text>
                          </View>
                        )}
                        
                        {/* Stroke/Line Width slider - for line and area features */}
                        {feature.strokeKey && (
                          <View style={styles.controlRow}>
                            <Text style={[styles.controlRowLabel, themedStyles.controlRowLabel]}>
                              {feature.type === 'line' ? 'Thickness' : 'Border'}
                            </Text>
                            <View style={styles.sliderContainerCompact}>
                              <Text style={[styles.sliderMinLabelSmall, themedStyles.sliderMinMaxLabel]}>50%</Text>
                              <Slider
                                style={styles.displaySliderCompact}
                                minimumValue={0.5}
                                maximumValue={2.0}
                                step={0.1}
                                value={displaySettings[feature.strokeKey] as number}
                                onValueChange={(v) => updateValue(feature.strokeKey!, v)}
                                minimumTrackTintColor="#FFB74D"
                                maximumTrackTintColor={uiTheme.sliderTrack}
                                thumbTintColor="#FFB74D"
                              />
                              <Text style={[styles.sliderMaxLabelSmall, themedStyles.sliderMinMaxLabel]}>200%</Text>
                            </View>
                            <Text style={[styles.sliderValueCompact, themedStyles.sliderValueCompact]}>
                              {formatPercent(displaySettings[feature.strokeKey] as number)}
                            </Text>
                          </View>
                        )}
                        
                        {/* Opacity slider - for all features */}
                        {feature.opacityKey && (
                          <View style={styles.controlRow}>
                            <Text style={[styles.controlRowLabel, themedStyles.controlRowLabel]}>Opacity</Text>
                            <View style={styles.sliderContainerCompact}>
                              <Text style={[styles.sliderMinLabelSmall, themedStyles.sliderMinMaxLabel]}>0%</Text>
                              <Slider
                                style={styles.displaySliderCompact}
                                minimumValue={0}
                                maximumValue={1.0}
                                step={0.1}
                                value={displaySettings[feature.opacityKey] as number}
                                onValueChange={(v) => updateValue(feature.opacityKey!, v)}
                                minimumTrackTintColor="#81C784"
                                maximumTrackTintColor={uiTheme.sliderTrack}
                                thumbTintColor="#81C784"
                              />
                              <Text style={[styles.sliderMaxLabelSmall, themedStyles.sliderMinMaxLabel]}>100%</Text>
                            </View>
                            <Text style={[styles.sliderValueCompact, themedStyles.sliderValueCompact]}>
                              {formatPercent(displaySettings[feature.opacityKey] as number)}
                            </Text>
                          </View>
                        )}
                      </>
                    );
                  })()}
                </View>
                
                {/* Feature selector below - horizontal scrollable with legend */}
                <View style={styles.featureSelectorContainer}>
                  <View style={styles.displayLegendInline}>
                    <View style={styles.legendItem}>
                      <View style={[styles.featureTypeIndicator, styles.featureTypeText]} />
                      <Text style={[styles.legendText, themedStyles.legendText]}>Text</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.featureTypeIndicator, styles.featureTypeLine]} />
                      <Text style={[styles.legendText, themedStyles.legendText]}>Line</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.featureTypeIndicator, styles.featureTypeArea]} />
                      <Text style={[styles.legendText, themedStyles.legendText]}>Area</Text>
                    </View>
                  </View>
                  <ScrollView 
                    style={styles.featureSelectorScroll}
                    contentContainerStyle={styles.featureSelectorContent}
                  >
                    <View style={styles.featureSelectorGrid}>
                      {DISPLAY_FEATURES.map((feature) => (
                        <TouchableOpacity
                          key={feature.id}
                          style={[
                            styles.featureSelectorChip,
                            selectedDisplayFeature === feature.id && styles.featureSelectorChipActive
                          ]}
                          onPress={() => setSelectedDisplayFeature(feature.id)}
                        >
                          <View style={[
                            styles.featureTypeIndicator,
                            feature.type === 'text' && styles.featureTypeText,
                            feature.type === 'line' && styles.featureTypeLine,
                            feature.type === 'area' && styles.featureTypeArea,
                          ]} />
                          <Text style={[
                            styles.featureSelectorChipText,
                            themedStyles.featureSelectorChipText,
                            selectedDisplayFeature === feature.id && styles.featureSelectorChipTextActive,
                            selectedDisplayFeature === feature.id && themedStyles.featureSelectorChipTextActive
                          ]}>
                            {feature.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              </View>
            )}

            {/* Tab 4: Symbols */}
            {activeTab === 'symbols' && (
              <View style={styles.displayTabContainer}>
                {/* Controls at top - full width */}
                <View style={styles.displayControlsTop}>
                  {(() => {
                    const symbol = SYMBOL_FEATURES.find(s => s.id === selectedSymbolFeature);
                    if (!symbol) return null;
                    
                    const formatPercent = (v: number) => `${Math.round(v * 100)}%`;
                    
                    // Get nominal size for this symbol type (lights/buoys: 2.0, others: 1.5)
                    const getNominalSize = (id: string) => {
                      if (id === 'lights' || id === 'buoys') return 2.0;
                      return 1.5;
                    };
                    
                    const updateValue = async (key: keyof DisplaySettings, value: number) => {
                      const newSettings = { ...displaySettings, [key]: value };
                      setDisplaySettings(newSettings);
                      await displaySettingsService.saveSettings(newSettings);
                    };
                    
                    const resetSymbol = async () => {
                      const updates: Partial<DisplaySettings> = {};
                      updates[symbol.sizeKey] = getNominalSize(symbol.id);
                      if (symbol.hasHalo) {
                        updates[symbol.haloKey] = 0.1;
                      }
                      updates[symbol.opacityKey] = 1.0;
                      const newSettings = { ...displaySettings, ...updates };
                      setDisplaySettings(newSettings);
                      await displaySettingsService.saveSettings(newSettings);
                    };
                    
                    const resetText = async () => {
                      if (!symbol.hasText || !symbol.textSizeKey || !symbol.textHaloKey || !symbol.textOpacityKey) return;
                      const updates: Partial<DisplaySettings> = {};
                      updates[symbol.textSizeKey] = 1.0;
                      updates[symbol.textHaloKey] = 0.1;  // 10% default
                      updates[symbol.textOpacityKey] = 1.0;
                      const newSettings = { ...displaySettings, ...updates };
                      setDisplaySettings(newSettings);
                      await displaySettingsService.saveSettings(newSettings);
                    };
                    
                    // Show symbol or text controls based on mode
                    const showingText = symbolEditMode === 'text' && symbol.hasText;
                    
                    return (
                      <>
                        <View style={styles.displayControlHeader}>
                          <Text style={[styles.displayFeatureName, themedStyles.displayFeatureName]}>{symbol.label}</Text>
                          <View style={styles.headerRightSection}>
                            {/* Symbol/Text toggle - only show for symbols with text */}
                            {symbol.hasText ? (
                              <View style={styles.symbolTextToggle}>
                                <TouchableOpacity 
                                  style={[
                                    styles.symbolTextToggleBtn,
                                    symbolEditMode === 'symbol' && styles.symbolTextToggleBtnActive,
                                    { backgroundColor: symbolEditMode === 'symbol' ? symbol.color : 'transparent' }
                                  ]}
                                  onPress={() => setSymbolEditMode('symbol')}
                                >
                                  <Text style={[
                                    styles.symbolTextToggleText,
                                    symbolEditMode === 'symbol' && styles.symbolTextToggleTextActive
                                  ]}>symbol</Text>
                                </TouchableOpacity>
                                <TouchableOpacity 
                                  style={[
                                    styles.symbolTextToggleBtn,
                                    symbolEditMode === 'text' && styles.symbolTextToggleBtnActive,
                                    { backgroundColor: symbolEditMode === 'text' ? symbol.color : 'transparent' }
                                  ]}
                                  onPress={() => setSymbolEditMode('text')}
                                >
                                  <Text style={[
                                    styles.symbolTextToggleText,
                                    symbolEditMode === 'text' && styles.symbolTextToggleTextActive
                                  ]}>text</Text>
                                </TouchableOpacity>
                              </View>
                            ) : (
                              <View style={[styles.featureTypeBadge, { backgroundColor: symbol.color }]}>
                                <Text style={styles.featureTypeBadgeLabel}>symbol</Text>
                              </View>
                            )}
                            <TouchableOpacity 
                              style={styles.resetIconBtn}
                              onPress={showingText ? resetText : resetSymbol}
                            >
                              <Text style={styles.resetIconText}>↺</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                        
                        {showingText ? (
                          <>
                            {/* Text Size slider */}
                            <View style={styles.controlRow}>
                              <Text style={[styles.controlRowLabel, themedStyles.controlRowLabel]}>Size</Text>
                              <View style={styles.sliderContainerCompact}>
                                <Text style={[styles.sliderMinLabelSmall, themedStyles.sliderMinMaxLabel]}>50%</Text>
                                <Slider
                                  style={styles.displaySliderCompact}
                                  minimumValue={0.5}
                                  maximumValue={2.0}
                                  step={0.1}
                                  value={displaySettings[symbol.textSizeKey!] as number}
                                  onValueChange={(v) => updateValue(symbol.textSizeKey!, v)}
                                  minimumTrackTintColor={symbol.color}
                                  maximumTrackTintColor={uiTheme.sliderTrack}
                                  thumbTintColor={symbol.color}
                                />
                                <Text style={[styles.sliderMaxLabelSmall, themedStyles.sliderMinMaxLabel]}>200%</Text>
                              </View>
                              <Text style={[styles.sliderValueCompact, themedStyles.sliderValueCompact]}>
                                {formatPercent(displaySettings[symbol.textSizeKey!] as number)}
                              </Text>
                            </View>
                            
                            {/* Text Halo slider */}
                            <View style={styles.controlRow}>
                              <Text style={[styles.controlRowLabel, themedStyles.controlRowLabel]}>Halo</Text>
                              <View style={styles.sliderContainerCompact}>
                                <Text style={[styles.sliderMinLabelSmall, themedStyles.sliderMinMaxLabel]}>0%</Text>
                                <Slider
                                  style={styles.displaySliderCompact}
                                  minimumValue={0}
                                  maximumValue={0.25}
                                  step={0.01}
                                  value={displaySettings[symbol.textHaloKey!] as number}
                                  onValueChange={(v) => updateValue(symbol.textHaloKey!, v)}
                                  minimumTrackTintColor="#E040FB"
                                  maximumTrackTintColor={uiTheme.sliderTrack}
                                  thumbTintColor="#E040FB"
                                />
                                <Text style={[styles.sliderMaxLabelSmall, themedStyles.sliderMinMaxLabel]}>25%</Text>
                              </View>
                              <Text style={[styles.sliderValueCompact, themedStyles.sliderValueCompact]}>
                                {formatPercent(displaySettings[symbol.textHaloKey!] as number)}
                              </Text>
                            </View>
                            
                            {/* Text Opacity slider */}
                            <View style={styles.controlRow}>
                              <Text style={[styles.controlRowLabel, themedStyles.controlRowLabel]}>Opacity</Text>
                              <View style={styles.sliderContainerCompact}>
                                <Text style={[styles.sliderMinLabelSmall, themedStyles.sliderMinMaxLabel]}>0%</Text>
                                <Slider
                                  style={styles.displaySliderCompact}
                                  minimumValue={0}
                                  maximumValue={1.0}
                                  step={0.1}
                                  value={displaySettings[symbol.textOpacityKey!] as number}
                                  onValueChange={(v) => updateValue(symbol.textOpacityKey!, v)}
                                  minimumTrackTintColor="#81C784"
                                  maximumTrackTintColor={uiTheme.sliderTrack}
                                  thumbTintColor="#81C784"
                                />
                                <Text style={[styles.sliderMaxLabelSmall, themedStyles.sliderMinMaxLabel]}>100%</Text>
                              </View>
                              <Text style={[styles.sliderValueCompact, themedStyles.sliderValueCompact]}>
                                {formatPercent(displaySettings[symbol.textOpacityKey!] as number)}
                              </Text>
                            </View>
                          </>
                        ) : (
                          <>
                            {/* Size slider */}
                            <View style={styles.controlRow}>
                              <Text style={[styles.controlRowLabel, themedStyles.controlRowLabel]}>Size</Text>
                              <View style={styles.sliderContainerCompact}>
                                <Text style={[styles.sliderMinLabelSmall, themedStyles.sliderMinMaxLabel]}>50%</Text>
                                <Slider
                                  style={styles.displaySliderCompact}
                                  minimumValue={0.5}
                                  maximumValue={3.0}
                                  step={0.1}
                                  value={displaySettings[symbol.sizeKey] as number}
                                  onValueChange={(v) => updateValue(symbol.sizeKey, v)}
                                  minimumTrackTintColor={symbol.color}
                                  maximumTrackTintColor={uiTheme.sliderTrack}
                                  thumbTintColor={symbol.color}
                                />
                                <Text style={[styles.sliderMaxLabelSmall, themedStyles.sliderMinMaxLabel]}>300%</Text>
                              </View>
                              <Text style={[styles.sliderValueCompact, themedStyles.sliderValueCompact]}>
                                {formatPercent(displaySettings[symbol.sizeKey] as number)}
                              </Text>
                            </View>
                            
                            {/* Halo slider - only shown for symbols that support halos */}
                            {symbol.hasHalo && (
                              <View style={styles.controlRow}>
                                <Text style={[styles.controlRowLabel, themedStyles.controlRowLabel]}>Halo</Text>
                                <View style={styles.sliderContainerCompact}>
                                  <Text style={[styles.sliderMinLabelSmall, themedStyles.sliderMinMaxLabel]}>0%</Text>
                                  <Slider
                                    style={styles.displaySliderCompact}
                                    minimumValue={0}
                                    maximumValue={0.25}
                                    step={0.05}
                                    value={displaySettings[symbol.haloKey] as number}
                                    onValueChange={(v) => updateValue(symbol.haloKey, v)}
                                    minimumTrackTintColor="#E040FB"
                                    maximumTrackTintColor={uiTheme.sliderTrack}
                                    thumbTintColor="#E040FB"
                                  />
                                  <Text style={[styles.sliderMaxLabelSmall, themedStyles.sliderMinMaxLabel]}>+25%</Text>
                                </View>
                                <Text style={[styles.sliderValueCompact, themedStyles.sliderValueCompact]}>
                                  +{Math.round((displaySettings[symbol.haloKey] as number) * 100)}%
                                </Text>
                              </View>
                            )}
                            
                            {/* Opacity slider */}
                            <View style={styles.controlRow}>
                              <Text style={[styles.controlRowLabel, themedStyles.controlRowLabel]}>Opacity</Text>
                              <View style={styles.sliderContainerCompact}>
                                <Text style={[styles.sliderMinLabelSmall, themedStyles.sliderMinMaxLabel]}>0%</Text>
                                <Slider
                                  style={styles.displaySliderCompact}
                                  minimumValue={0}
                                  maximumValue={1.0}
                                  step={0.1}
                                  value={displaySettings[symbol.opacityKey] as number}
                                  onValueChange={(v) => updateValue(symbol.opacityKey, v)}
                                  minimumTrackTintColor="#81C784"
                                  maximumTrackTintColor={uiTheme.sliderTrack}
                                  thumbTintColor="#81C784"
                                />
                                <Text style={[styles.sliderMaxLabelSmall, themedStyles.sliderMinMaxLabel]}>100%</Text>
                              </View>
                              <Text style={[styles.sliderValueCompact, themedStyles.sliderValueCompact]}>
                                {formatPercent(displaySettings[symbol.opacityKey] as number)}
                              </Text>
                            </View>
                          </>
                        )}
                      </>
                    );
                  })()}
                </View>
                
                {/* Symbol selector below - horizontal scrollable */}
                <View style={styles.featureSelectorContainer}>
                  <ScrollView 
                    style={styles.featureSelectorScroll}
                    contentContainerStyle={styles.featureSelectorContent}
                  >
                    <View style={styles.featureSelectorGrid}>
                      {SYMBOL_FEATURES.map((symbol) => (
                        <TouchableOpacity
                          key={symbol.id}
                          style={[
                            styles.featureSelectorChip,
                            selectedSymbolFeature === symbol.id && styles.featureSelectorChipActive
                          ]}
                          onPress={() => setSelectedSymbolFeature(symbol.id)}
                        >
                          <View style={[
                            styles.featureTypeIndicator,
                            { backgroundColor: symbol.color },
                          ]} />
                          <Text style={[
                            styles.featureSelectorChipText,
                            themedStyles.featureSelectorChipText,
                            selectedSymbolFeature === symbol.id && styles.featureSelectorChipTextActive,
                            selectedSymbolFeature === symbol.id && themedStyles.featureSelectorChipTextActive
                          ]}>
                            {symbol.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              </View>
            )}

            {/* Tab 5: Other Settings */}
            {activeTab === 'other' && (
              <ScrollView style={themedStyles.tabScrollContent} contentContainerStyle={styles.tabScrollContent}>
                <Text style={[styles.panelSectionTitle, themedStyles.panelSectionTitle]}>Display Mode</Text>
                <View style={styles.segmentedControl}>
                  <TouchableOpacity
                    style={[styles.segmentOption, displaySettings.dayNightMode === 'day' && styles.segmentOptionActive]}
                    onPress={async () => {
                      const newSettings = { ...displaySettings, dayNightMode: 'day' as const };
                      setDisplaySettings(newSettings);
                      await displaySettingsService.saveSettings(newSettings);
                    }}
                  >
                    <Text style={[styles.segmentOptionText, themedStyles.segmentOptionText, displaySettings.dayNightMode === 'day' && styles.segmentOptionTextActive, themedStyles.segmentOptionTextActive]}>Day</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.segmentOption, displaySettings.dayNightMode === 'night' && styles.segmentOptionActive]}
                    onPress={async () => {
                      const newSettings = { ...displaySettings, dayNightMode: 'night' as const };
                      setDisplaySettings(newSettings);
                      await displaySettingsService.saveSettings(newSettings);
                    }}
                  >
                    <Text style={[styles.segmentOptionText, themedStyles.segmentOptionText, displaySettings.dayNightMode === 'night' && styles.segmentOptionTextActive, themedStyles.segmentOptionTextActive]}>Night</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.segmentOption, displaySettings.dayNightMode === 'auto' && styles.segmentOptionActive]}
                    onPress={async () => {
                      const newSettings = { ...displaySettings, dayNightMode: 'auto' as const };
                      setDisplaySettings(newSettings);
                      await displaySettingsService.saveSettings(newSettings);
                    }}
                  >
                    <Text style={[styles.segmentOptionText, themedStyles.segmentOptionText, displaySettings.dayNightMode === 'auto' && styles.segmentOptionTextActive, themedStyles.segmentOptionTextActive]}>Auto</Text>
                  </TouchableOpacity>
                </View>
                
                <View style={[styles.panelDivider, themedStyles.panelDivider]} />
                <Text style={[styles.panelSectionTitle, themedStyles.panelSectionTitle]}>Map Orientation</Text>
                <View style={styles.segmentedControl}>
                  <TouchableOpacity
                    style={[styles.segmentOption, displaySettings.orientationMode === 'north-up' && styles.segmentOptionActive]}
                    onPress={async () => {
                      const newSettings = { ...displaySettings, orientationMode: 'north-up' as const };
                      setDisplaySettings(newSettings);
                      await displaySettingsService.saveSettings(newSettings);
                    }}
                  >
                    <Text style={[styles.segmentOptionText, themedStyles.segmentOptionText, displaySettings.orientationMode === 'north-up' && styles.segmentOptionTextActive, themedStyles.segmentOptionTextActive]}>North Up</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.segmentOption, displaySettings.orientationMode === 'head-up' && styles.segmentOptionActive]}
                    onPress={async () => {
                      const newSettings = { ...displaySettings, orientationMode: 'head-up' as const };
                      setDisplaySettings(newSettings);
                      await displaySettingsService.saveSettings(newSettings);
                    }}
                  >
                    <Text style={[styles.segmentOptionText, themedStyles.segmentOptionText, displaySettings.orientationMode === 'head-up' && styles.segmentOptionTextActive, themedStyles.segmentOptionTextActive]}>Head Up</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.segmentOption, displaySettings.orientationMode === 'course-up' && styles.segmentOptionActive]}
                    onPress={async () => {
                      const newSettings = { ...displaySettings, orientationMode: 'course-up' as const };
                      setDisplaySettings(newSettings);
                      await displaySettingsService.saveSettings(newSettings);
                    }}
                  >
                    <Text style={[styles.segmentOptionText, themedStyles.segmentOptionText, displaySettings.orientationMode === 'course-up' && styles.segmentOptionTextActive, themedStyles.segmentOptionTextActive]}>Course Up</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.settingNote, themedStyles.settingNote]}>Note: Head Up and Course Up require GPS heading data</Text>
                
                <View style={[styles.panelDivider, themedStyles.panelDivider]} />
                <Text style={[styles.panelSectionTitle, themedStyles.panelSectionTitle]}>Depth Units</Text>
                <View style={styles.segmentedControl}>
                  <TouchableOpacity
                    style={[styles.segmentOption, displaySettings.depthUnits === 'meters' && styles.segmentOptionActive]}
                    onPress={async () => {
                      const newSettings = { ...displaySettings, depthUnits: 'meters' as const };
                      setDisplaySettings(newSettings);
                      await displaySettingsService.saveSettings(newSettings);
                    }}
                  >
                    <Text style={[styles.segmentOptionText, themedStyles.segmentOptionText, displaySettings.depthUnits === 'meters' && styles.segmentOptionTextActive, themedStyles.segmentOptionTextActive]}>Meters</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.segmentOption, displaySettings.depthUnits === 'feet' && styles.segmentOptionActive]}
                    onPress={async () => {
                      const newSettings = { ...displaySettings, depthUnits: 'feet' as const };
                      setDisplaySettings(newSettings);
                      await displaySettingsService.saveSettings(newSettings);
                    }}
                  >
                    <Text style={[styles.segmentOptionText, themedStyles.segmentOptionText, displaySettings.depthUnits === 'feet' && styles.segmentOptionTextActive, themedStyles.segmentOptionTextActive]}>Feet</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.segmentOption, displaySettings.depthUnits === 'fathoms' && styles.segmentOptionActive]}
                    onPress={async () => {
                      const newSettings = { ...displaySettings, depthUnits: 'fathoms' as const };
                      setDisplaySettings(newSettings);
                      await displaySettingsService.saveSettings(newSettings);
                    }}
                  >
                    <Text style={[styles.segmentOptionText, themedStyles.segmentOptionText, displaySettings.depthUnits === 'fathoms' && styles.segmentOptionTextActive, themedStyles.segmentOptionTextActive]}>Fathoms</Text>
                  </TouchableOpacity>
                </View>
                
                <View style={[styles.panelDivider, themedStyles.panelDivider]} />
                <TouchableOpacity 
                  style={styles.resetAllBtn}
                  onPress={async () => {
                    await displaySettingsService.resetSettings();
                    const settings = await displaySettingsService.loadSettings();
                    setDisplaySettings(settings);
                  }}
                >
                  <Text style={styles.resetAllBtnText}>Reset All Settings to Defaults</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      )}

      {/* Feature Picker - When multiple features found at tap location */}

      {featureChoices && featureChoices.length > 1 && (
        <View style={styles.featurePickerContainer}>
          <View style={styles.featurePickerHeader}>
            <Text style={styles.featurePickerTitle}>Multiple Features Found</Text>
            <TouchableOpacity 
              onPress={() => setFeatureChoices(null)}
              style={styles.featurePickerClose}
            >
              <Text style={styles.featurePickerCloseText}>×</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.featurePickerList}>
            {featureChoices.map((feature, index) => (
              <TouchableOpacity
                key={`${feature.type}-${index}`}
                style={styles.featurePickerItem}
                onPress={() => {
                  setFeatureChoices(null);
                  if (feature.properties?._specialType) {
                    handleSpecialFeatureSelect(feature);
                  } else {
                    setSelectedFeature(feature);
                  }
                }}
              >
                <Text style={styles.featurePickerItemText}>{feature.type}</Text>
                {(feature.properties?.OBJNAM || feature.properties?.name) && (
                  <Text style={styles.featurePickerItemSubtext}>{String(feature.properties.OBJNAM || feature.properties.name)}</Text>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Feature Inspector - Memoized component for better performance */}
      {selectedFeature && (
        <FeatureInspector 
          feature={selectedFeature} 
          formattedProps={formattedFeatureProps}
          onClose={closeFeatureInspector}
        />
      )}

      {/* Tide/Current Station Modal */}
      {selectedStation && (
        <StationInfoModal
          visible={selectedStation !== null}
          stationId={selectedStation?.id || null}
          stationType={selectedStation?.type || null}
          onClose={() => setSelectedStation(null)}
        />
      )}

      {/* Compass and GPS overlays are now rendered in App.tsx outside MapLibre hierarchy */}

      </View>
      {/* End of mapSection wrapper */}

      {/* Detail Charts - Bottom of screen, flex layout sits above tab bar */}
      {!showSettingsPanel && (showTideDetails || showCurrentDetails) && (
      <View style={styles.bottomStack}>
        <TideDetailChart
          visible={showTideDetails}
          selectedStationId={detailChartTideStationId}
          currentLocation={gpsData.latitude !== null && gpsData.longitude !== null 
            ? [gpsData.longitude, gpsData.latitude] 
            : null}
          tideStations={tideStations}
          onClearSelection={() => {
            setDetailChartTideStationId(null);
            dispatchLayers({ type: 'SET', layer: 'tideDetails', value: false });
          }}
        />
        <CurrentDetailChart
          visible={showCurrentDetails}
          selectedStationId={detailChartCurrentStationId}
          currentLocation={gpsData.latitude !== null && gpsData.longitude !== null 
            ? [gpsData.longitude, gpsData.latitude] 
            : null}
          currentStations={currentStations}
          onClearSelection={() => {
            setDetailChartCurrentStationId(null);
            dispatchLayers({ type: 'SET', layer: 'currentDetails', value: false });
          }}
        />
      </View>
      )}

      {/* Buoy Detail Modal */}
      <BuoyDetailModal
        visible={selectedBuoy !== null}
        buoy={selectedBuoy}
        loading={loadingBuoyDetail}
        onClose={() => setSelectedBuoy(null)}
      />

      {/* Navigation Data Displays */}
      {showNavData && (
        <>
          {/* Upper Left - Speed */}
          <View style={[styles.navDataBox, styles.navDataUpperLeft, { top: insets.top }]}>
            <Text style={styles.navDataLabel}>SPD</Text>
            <Text style={styles.navDataValue}>{gpsData.speed !== null ? `${gpsData.speed.toFixed(1)}` : '--'}</Text>
            <Text style={styles.navDataUnit}>kn</Text>
          </View>

          {/* Upper Right - GPS Position */}
          <View style={[styles.navDataBox, styles.navDataUpperRight, { top: insets.top }]}>
            <View style={styles.navDataLabelRow}>
              <Text style={styles.navDataLabel}>GPS</Text>
              <Text style={styles.navDataZoom}>z{currentZoom.toFixed(1)}</Text>
            </View>
            <Text style={styles.navDataValueSmall}>
              {gpsData.latitude !== null ? `${Math.abs(gpsData.latitude).toFixed(4)}°${gpsData.latitude >= 0 ? 'N' : 'S'}` : '--'}
            </Text>
            <Text style={styles.navDataValueSmall}>
              {gpsData.longitude !== null ? `${Math.abs(gpsData.longitude).toFixed(4)}°${gpsData.longitude >= 0 ? 'E' : 'W'}` : '--'}
            </Text>
          </View>

          {/* Lower Left - Heading (high z-index to stay above detail charts) */}
          <View style={[
            styles.navDataBox, 
            styles.navDataLowerLeft, 
            { 
              bottom: showTideDetails && showCurrentDetails
                ? Dimensions.get('window').height * 0.30  // Both charts = 30% (15% each)
                : (showTideDetails || showCurrentDetails)
                  ? Dimensions.get('window').height * 0.15  // One chart = 15%
                  : 0  // No charts = tab bar level
            }
          ]}>
            <Text style={styles.navDataLabel}>HDG</Text>
            <Text style={styles.navDataValue}>{gpsData.heading !== null ? `${Math.round(gpsData.heading)}` : '--'}</Text>
            <Text style={styles.navDataUnit}>°</Text>
          </View>

          {/* Lower Right - Bearing Next (high z-index to stay above detail charts) */}
          <View style={[
            styles.navDataBox, 
            styles.navDataLowerRight, 
            { 
              bottom: showTideDetails && showCurrentDetails
                ? Dimensions.get('window').height * 0.30  // Both charts = 30% (15% each)
                : (showTideDetails || showCurrentDetails)
                  ? Dimensions.get('window').height * 0.15  // One chart = 15%
                  : 0  // No charts = tab bar level
            }
          ]}>
            <Text style={styles.navDataLabel}>BRG</Text>
            <Text style={styles.navDataValue}>--</Text>
            <Text style={styles.navDataUnit}>°</Text>
          </View>

          {/* Middle Left - COG (position adjusted for detail charts) */}
          <View style={[
            styles.navDataBox, 
            styles.navDataMiddleLeft,
            { 
              top: showTideDetails && showCurrentDetails
                ? '30%'  // Both charts (30% bottom) - center in remaining 70%
                : (showTideDetails || showCurrentDetails)
                  ? '40%'  // One chart (15% bottom) - center in remaining 85%
                  : '50%', // No charts - center in full screen
              marginTop: -30 
            }
          ]}>
            <Text style={styles.navDataLabel}>COG</Text>
            <Text style={styles.navDataValue}>--</Text>
            <Text style={styles.navDataUnit}>°</Text>
          </View>

          {/* Middle Right - ETE (position adjusted for detail charts) */}
          <View style={[
            styles.navDataBox, 
            styles.navDataMiddleRight,
            { 
              top: showTideDetails && showCurrentDetails
                ? '30%'  // Both charts (30% bottom) - center in remaining 70%
                : (showTideDetails || showCurrentDetails)
                  ? '40%'  // One chart (15% bottom) - center in remaining 85%
                  : '50%', // No charts - center in full screen
              marginTop: -30 
            }
          ]}>
            <Text style={styles.navDataLabel}>ETE</Text>
            <Text style={styles.navDataValue}>--</Text>
            <Text style={styles.navDataUnit}>min</Text>
          </View>
        </>
      )}

      {/* Debug Map Modal - Map source toggle panel */}
      <Modal
        visible={showDebugMap}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowDebugMap(false)}
      >
        <View style={debugStyles.container}>
          <View style={debugStyles.header}>
            <Text style={debugStyles.headerTitle}>Debug Map</Text>
            <TouchableOpacity onPress={() => setShowDebugMap(false)} style={debugStyles.closeBtn}>
              <Text style={debugStyles.closeBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={debugStyles.scroll} contentContainerStyle={debugStyles.scrollContent}>
            {/* Quick actions */}
            <View style={debugStyles.quickActions}>
              <TouchableOpacity
                style={debugStyles.quickActionBtn}
                onPress={() => setDebugHiddenSources(new Set())}
              >
                <Text style={debugStyles.quickActionText}>Show All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={debugStyles.quickActionBtn}
                onPress={() => setDebugHiddenSources(new Set([
                  'satellite', 'basemap', 'ocean', 'terrain', 'charts', 'bathymetry', 'gnis',
                ]))}
              >
                <Text style={debugStyles.quickActionText}>Hide All</Text>
              </TouchableOpacity>
            </View>

            {/* Active state indicator */}
            {debugHiddenSources.size > 0 && (
              <View style={debugStyles.debugBanner}>
                <Text style={debugStyles.debugBannerText}>
                  {debugHiddenSources.size} source{debugHiddenSources.size > 1 ? 's' : ''} hidden
                </Text>
              </View>
            )}

            {/* Base Map Mode */}
            <Text style={debugStyles.sectionTitle}>BASE MAP MODE</Text>
            <View style={debugStyles.card}>
              <DebugToggle label="Satellite" value={mapStyle === 'satellite'} onToggle={() => setMapStyle('satellite')} radio />
              <DebugToggle label="Light" value={mapStyle === 'light'} onToggle={() => setMapStyle('light')} radio subtitle={hasLocalBasemap ? 'Vector basemap' : 'No basemap tiles'} />
              <DebugToggle label="Dark" value={mapStyle === 'dark'} onToggle={() => setMapStyle('dark')} radio subtitle={hasLocalBasemap ? 'Vector basemap' : 'No basemap tiles'} />
              <DebugToggle label="Street" value={mapStyle === 'street'} onToggle={() => setMapStyle('street')} radio subtitle={hasLocalBasemap ? 'Vector basemap' : 'No basemap tiles'} />
              <DebugToggle label="Nautical (S-52)" value={mapStyle === 'nautical'} onToggle={() => setMapStyle('nautical')} radio subtitle={hasLocalBasemap ? 'Vector basemap' : 'No basemap tiles'} />
              <DebugToggle label="Ocean" value={mapStyle === 'ocean'} onToggle={() => setMapStyle('ocean')} radio subtitle={hasLocalOcean ? `${oceanTileSets.length} zoom sets` : 'Not downloaded'} />
              <DebugToggle label="Terrain" value={mapStyle === 'terrain'} onToggle={() => setMapStyle('terrain')} radio subtitle={hasLocalTerrain ? `${terrainTileSets.length} zoom sets` : 'Not downloaded'} />
            </View>

            {/* Display Mode */}
            <Text style={debugStyles.sectionTitle}>S-52 DISPLAY MODE</Text>
            <View style={debugStyles.card}>
              <DebugToggle label="Day" value={s52Mode === 'day'} onToggle={() => setS52Mode('day')} radio />
              <DebugToggle label="Dusk" value={s52Mode === 'dusk'} onToggle={() => setS52Mode('dusk')} radio />
              <DebugToggle label="Night" value={s52Mode === 'night'} onToggle={() => setS52Mode('night')} radio />
            </View>

            {/* MAP SOURCES - the main purpose of this debug panel */}
            <Text style={debugStyles.sectionTitle}>MAP SOURCES</Text>
            <View style={debugStyles.card}>
              <DebugToggle 
                label="Satellite Imagery" 
                value={debugIsSourceVisible('satellite')} 
                onToggle={() => debugToggleSource('satellite')} 
                subtitle={satelliteTileSets.length > 0 ? `${satelliteTileSets.length} tile sets loaded` : 'No tiles'}
              />
              <DebugToggle 
                label="Vector Basemap" 
                value={debugIsSourceVisible('basemap')} 
                onToggle={() => debugToggleSource('basemap')} 
                subtitle={hasLocalBasemap ? `${basemapTileSets.length} zoom sets` : 'Not downloaded'}
              />
              <DebugToggle 
                label="Ocean Raster" 
                value={debugIsSourceVisible('ocean')} 
                onToggle={() => debugToggleSource('ocean')} 
                subtitle={hasLocalOcean ? `${oceanTileSets.length} zoom sets` : 'Not downloaded'}
              />
              <DebugToggle 
                label="Terrain Raster" 
                value={debugIsSourceVisible('terrain')} 
                onToggle={() => debugToggleSource('terrain')} 
                subtitle={hasLocalTerrain ? `${terrainTileSets.length} zoom sets` : 'Not downloaded'}
              />
              <DebugToggle 
                label="NOAA Charts (Composite)" 
                value={debugIsSourceVisible('charts')} 
                onToggle={() => debugToggleSource('charts')} 
                subtitle={`${mbtilesCharts.length} chart packs`}
              />
              <DebugToggle 
                label="Raster Bathymetry" 
                value={debugIsSourceVisible('bathymetry')} 
                onToggle={() => debugToggleSource('bathymetry')} 
              />
              <DebugToggle 
                label="GNIS Place Names" 
                value={debugIsSourceVisible('gnis')} 
                onToggle={() => debugToggleSource('gnis')} 
                subtitle={gnisAvailable ? 'Available' : 'Not loaded'}
              />
            </View>

            {/* Status */}
            <Text style={debugStyles.sectionTitle}>STATUS</Text>
            <View style={debugStyles.card}>
              <DebugToggle label="Local Basemap" value={hasLocalBasemap} onToggle={() => {}} disabled />
              <DebugToggle label={`Ocean Tiles (${oceanTileSets.length})`} value={hasLocalOcean} onToggle={() => {}} disabled />
              <DebugToggle label={`Terrain Tiles (${terrainTileSets.length})`} value={hasLocalTerrain} onToggle={() => {}} disabled />
              <DebugToggle label="GNIS Available" value={gnisAvailable} onToggle={() => {}} disabled />
              <DebugToggle label={`Satellite Tiles (${satelliteTileSets.length})`} value={satelliteTileSets.length > 0} onToggle={() => {}} disabled />
              <DebugToggle label={`Chart Packs (${mbtilesCharts.length})`} value={mbtilesCharts.length > 0} onToggle={() => {}} disabled />
              <DebugToggle label="Tile Server" value={tileServerReady} onToggle={() => {}} disabled />
            </View>

            {/* DIAGNOSTICS */}
            <Text style={debugStyles.sectionTitle}>DIAGNOSTICS</Text>
            <TouchableOpacity
              style={[debugStyles.quickActionBtn, { marginBottom: 12 }]}
              onPress={runDiagnostics}
            >
              <Text style={debugStyles.quickActionText}>Run Diagnostics</Text>
            </TouchableOpacity>

            {debugDiagnostics && (
              <View style={debugStyles.card}>
                {/* Timestamp */}
                <View style={diagStyles.row}>
                  <Text style={diagStyles.label}>Captured</Text>
                  <Text style={diagStyles.value}>{debugDiagnostics.timestamp}</Text>
                </View>

                {/* Render Gate Checks */}
                <View style={diagStyles.sectionHeader}>
                  <Text style={diagStyles.sectionHeaderText}>RENDER GATES</Text>
                </View>
                {debugDiagnostics.gates.map((gate, i) => (
                  <View key={`gate-${i}`} style={diagStyles.row}>
                    <Text style={diagStyles.label}>
                      {gate.pass ? '\u2705' : '\u274C'} {gate.label}
                    </Text>
                    <Text style={[diagStyles.mono, { fontSize: 10 }]}>{gate.expression}</Text>
                  </View>
                ))}

                {/* State Dump */}
                <View style={diagStyles.sectionHeader}>
                  <Text style={diagStyles.sectionHeaderText}>STATE</Text>
                </View>
                <View style={diagStyles.row}>
                  <Text style={diagStyles.label}>mapStyle</Text>
                  <Text style={diagStyles.value}>{debugDiagnostics.mapStyle}</Text>
                </View>
                <View style={diagStyles.row}>
                  <Text style={diagStyles.label}>s52Mode</Text>
                  <Text style={diagStyles.value}>{debugDiagnostics.s52Mode}</Text>
                </View>
                <View style={diagStyles.row}>
                  <Text style={diagStyles.label}>tileServerReady</Text>
                  <Text style={diagStyles.value}>{String(debugDiagnostics.tileServerReady)}</Text>
                </View>
                <View style={diagStyles.row}>
                  <Text style={diagStyles.label}>hasLocalBasemap</Text>
                  <Text style={diagStyles.value}>{String(debugDiagnostics.hasLocalBasemap)}</Text>
                </View>
                <View style={diagStyles.row}>
                  <Text style={diagStyles.label}>hasLocalOcean</Text>
                  <Text style={diagStyles.value}>{String(debugDiagnostics.hasLocalOcean)}</Text>
                </View>
                <View style={diagStyles.row}>
                  <Text style={diagStyles.label}>hasLocalTerrain</Text>
                  <Text style={diagStyles.value}>{String(debugDiagnostics.hasLocalTerrain)}</Text>
                </View>
                <View style={diagStyles.row}>
                  <Text style={diagStyles.label}>gnisAvailable</Text>
                  <Text style={diagStyles.value}>{String(debugDiagnostics.gnisAvailable)}</Text>
                </View>
                <View style={diagStyles.row}>
                  <Text style={diagStyles.label}>useMBTiles</Text>
                  <Text style={diagStyles.value}>{String(debugDiagnostics.useMBTiles)}</Text>
                </View>
                <View style={diagStyles.row}>
                  <Text style={diagStyles.label}>useCompositeTiles</Text>
                  <Text style={diagStyles.value}>{String(debugDiagnostics.useCompositeTiles)}</Text>
                </View>
                <View style={diagStyles.row}>
                  <Text style={diagStyles.label}>Tile Server URL</Text>
                  <Text style={diagStyles.mono}>{debugDiagnostics.tileServerUrl}</Text>
                </View>
                {/* styleJSON */}
                <View style={diagStyles.sectionHeader}>
                  <Text style={diagStyles.sectionHeaderText}>STYLE JSON (passed to MapLibre)</Text>
                </View>
                <View style={diagStyles.codeBlock}>
                  <Text style={diagStyles.codeText}>{debugDiagnostics.styleJSON}</Text>
                </View>

                {/* MapLibre Sources */}
                <View style={diagStyles.sectionHeader}>
                  <Text style={diagStyles.sectionHeaderText}>
                    MAPLIBRE SOURCES ({debugDiagnostics.mapLibreSources.length})
                  </Text>
                </View>
                {debugDiagnostics.styleError ? (
                  <View style={diagStyles.errorBlock}>
                    <Text style={diagStyles.errorText}>{debugDiagnostics.styleError}</Text>
                  </View>
                ) : debugDiagnostics.mapLibreSources.length === 0 ? (
                  <View style={diagStyles.row}>
                    <Text style={diagStyles.label}>No sources found in style</Text>
                  </View>
                ) : (
                  debugDiagnostics.mapLibreSources.map((src, i) => (
                    <View key={`src-${i}`} style={diagStyles.layerItem}>
                      <Text style={diagStyles.layerId}>{src.id}</Text>
                      <Text style={diagStyles.layerMeta}>type: {src.type}</Text>
                      {src.urls && src.urls.map((url, j) => (
                        <Text key={`url-${j}`} style={diagStyles.mono}>{url}</Text>
                      ))}
                    </View>
                  ))
                )}

                {/* MapLibre Layers */}
                <View style={diagStyles.sectionHeader}>
                  <Text style={diagStyles.sectionHeaderText}>
                    MAPLIBRE LAYERS ({debugDiagnostics.mapLibreLayers.length}) - render order bottom to top
                  </Text>
                </View>
                {debugDiagnostics.mapLibreLayers.length === 0 && !debugDiagnostics.styleError ? (
                  <View style={diagStyles.row}>
                    <Text style={diagStyles.label}>No layers found in style</Text>
                  </View>
                ) : (
                  debugDiagnostics.mapLibreLayers.map((layer, i) => (
                    <View key={`layer-${i}`} style={diagStyles.layerItem}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={diagStyles.layerIndex}>{i}</Text>
                        <Text style={diagStyles.layerId}>{layer.id}</Text>
                        <Text style={[diagStyles.layerBadge, 
                          layer.visibility === 'none' && diagStyles.layerBadgeHidden
                        ]}>
                          {layer.type}
                        </Text>
                      </View>
                      <Text style={diagStyles.layerMeta}>
                        {layer.source ? `src: ${layer.source}` : 'no source'}
                        {layer.sourceLayer ? ` | layer: ${layer.sourceLayer}` : ''}
                        {` | vis: ${layer.visibility || 'visible'}`}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>

    </View>
  );
}

// Debug Map toggle row component
function DebugToggle({ label, value, onToggle, radio, disabled, subtitle }: { 
  label: string; value: boolean; onToggle: () => void; radio?: boolean; disabled?: boolean; subtitle?: string;
}) {
  return (
    <TouchableOpacity 
      style={debugStyles.toggleRow} 
      onPress={disabled ? undefined : onToggle}
      activeOpacity={disabled ? 1 : 0.6}
    >
      <View style={{ flex: 1 }}>
        <Text style={[debugStyles.toggleLabel, disabled && debugStyles.toggleLabelDisabled]}>{label}</Text>
        {subtitle && <Text style={debugStyles.toggleSubtitle}>{subtitle}</Text>}
      </View>
      {radio ? (
        <View style={[debugStyles.radioOuter, value && debugStyles.radioOuterActive]}>
          {value && <View style={debugStyles.radioInner} />}
        </View>
      ) : (
        <Switch
          value={value}
          onValueChange={disabled ? undefined : onToggle}
          disabled={disabled}
          trackColor={{ false: '#3a3a3c', true: '#34c759' }}
          thumbColor="#fff"
          style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
        />
      )}
    </TouchableOpacity>
  );
}

const debugStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1c1c1e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingTop: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
  closeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(79,195,247,0.15)',
  },
  closeBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#4FC3F7',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  quickActionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
  },
  quickActionText: {
    color: '#4FC3F7',
    fontSize: 14,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.8,
    marginBottom: 6,
    marginTop: 12,
    marginLeft: 4,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  toggleLabel: {
    fontSize: 15,
    color: '#fff',
    flex: 1,
  },
  toggleLabelDisabled: {
    color: 'rgba(255,255,255,0.4)',
  },
  toggleSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
    marginTop: 2,
  },
  debugBanner: {
    backgroundColor: 'rgba(255, 149, 0, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 149, 0, 0.3)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  debugBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FF9500',
    textAlign: 'center',
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterActive: {
    borderColor: '#4FC3F7',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4FC3F7',
  },
});

const diagStyles = StyleSheet.create({
  row: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  label: {
    fontSize: 13,
    color: '#fff',
    marginBottom: 2,
  },
  value: {
    fontSize: 13,
    color: '#4FC3F7',
    fontWeight: '500',
  },
  mono: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    fontFamily: 'monospace',
  },
  sectionHeader: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.6,
  },
  codeBlock: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    padding: 10,
    margin: 8,
    borderRadius: 6,
  },
  codeText: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.6)',
    fontFamily: 'monospace',
  },
  errorBlock: {
    backgroundColor: 'rgba(255,59,48,0.15)',
    padding: 10,
    margin: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.3)',
  },
  errorText: {
    fontSize: 12,
    color: '#FF3B30',
    fontFamily: 'monospace',
  },
  layerItem: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  layerIndex: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
    fontFamily: 'monospace',
    width: 20,
  },
  layerId: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
    flex: 1,
  },
  layerMeta: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
    fontFamily: 'monospace',
  },
  layerBadge: {
    fontSize: 9,
    color: '#4FC3F7',
    backgroundColor: 'rgba(79,195,247,0.15)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
    fontWeight: '600',
  },
  layerBadgeHidden: {
    color: '#FF9500',
    backgroundColor: 'rgba(255,149,0,0.15)',
  },
});

// Helper to get feature identifier for title
function getFeatureId(feature: FeatureInfo): string {
  const props = feature.properties;
  // Try LNAM first (lights), then OBJNAM (buoys, beacons)
  const lnam = props.LNAM as string | undefined;
  const objnam = props.OBJNAM as string | undefined;
  
  if (lnam) return `ID(LNAM): ${lnam}`;
  if (objnam) return `Name: ${objnam}`;
  return '';
}

// Helper to format properties based on feature type
function formatFeatureProperties(feature: FeatureInfo, depthUnit: 'meters' | 'feet' | 'fathoms' = 'meters'): Record<string, string> {
  // Depth unit conversion helpers
  const convertDepthValue = (meters: number): string => {
    switch (depthUnit) {
      case 'feet': return `${(meters * 3.28084).toFixed(1)}ft`;
      case 'fathoms': return `${(meters * 0.546807).toFixed(1)}fm`;
      default: return `${meters}m`;
    }
  };
  const props = feature.properties;
  const formatted: Record<string, string> = {};
  
  // Add tap coordinates if available
  if (props._tapCoordinates) {
    formatted['Location'] = String(props._tapCoordinates);
  }
  
  // Add object name if available
  if (props.OBJNAM) {
    formatted['Name'] = String(props.OBJNAM);
  }
  
  switch (feature.type) {
    case 'Light':
    case 'Light Sector':
      return { ...formatted, ...formatLightInfo(props) };
    
    case 'Lateral Buoy':
    case 'Cardinal Buoy':
    case 'Safe Water Buoy':
    case 'Special Purpose Buoy':
    case 'Isolated Danger Buoy':
      return { ...formatted, ...formatBuoyInfo(props) };
    
    case 'Lateral Beacon':
    case 'Special Purpose Beacon':
    case 'Cardinal Beacon':
    case 'Isolated Danger Beacon':
    case 'Safe Water Beacon':
      return { ...formatted, ...formatBeaconInfo(props) };
    
    case 'Landmark':
      return { ...formatted, ...formatLandmarkInfo(props) };
    
    case 'Seabed Area':
      return { ...formatted, ...formatSeabedInfo(props) };
    
    case 'Cable Area':
    case 'Submarine Cable':
      return { ...formatted, ...formatCableInfo(props) };
    
    case 'Wreck':
      return { ...formatted, ...formatWreckInfo(props) };
    
    case 'Underwater Rock':
      return { ...formatted, ...formatRockInfo(props) };
    
    case 'Obstruction':
      return { ...formatted, ...formatObstructionInfo(props) };
    
    case 'Sounding':
      if (props.DEPTH !== undefined) {
        formatted['Depth'] = convertDepthValue(Number(props.DEPTH));
      }
      return formatted;
    
    case 'Depth Area':
      if (props.DRVAL1 !== undefined) {
        formatted['Shallow depth'] = convertDepthValue(Number(props.DRVAL1));
      }
      if (props.DRVAL2 !== undefined) {
        formatted['Deep depth'] = convertDepthValue(Number(props.DRVAL2));
      }
      return formatted;
    
    case 'Depth Contour':
      if (props.VALDCO !== undefined) {
        formatted['Depth'] = convertDepthValue(Number(props.VALDCO));
      }
      return formatted;
    
    case 'Pipeline':
    case 'Pipeline Area':
      return { ...formatted, ...formatPipelineInfo(props) };
    
    case 'Dredged Area':
      if (props.DRVAL1 !== undefined) {
        formatted['Maintained depth'] = `${props.DRVAL1}m`;
      }
      return formatted;
    
    case 'Restricted Area':
      return { ...formatted, ...formatRestrictedAreaInfo(props) };
    
    case 'Caution Area':
      return { ...formatted, ...formatCautionAreaInfo(props) };
    
    case 'Military Practice Area':
      return { ...formatted, ...formatMilitaryAreaInfo(props) };
    
    case 'Anchorage Area':
    case 'Anchor Berth':
      return { ...formatted, ...formatAnchorageInfo(props) };
    
    case 'Marine Farm/Aquaculture':
      return { ...formatted, ...formatMarineFarmInfo(props) };
    
    default:
      // Show raw properties for other types
      for (const [key, value] of Object.entries(props)) {
        if (key.startsWith('_')) continue; // Skip internal props
        if (key === 'OBJNAM') continue; // Already added above
        formatted[key] = String(value);
      }
      return formatted;
  }
}

// Format wreck info
function formatWreckInfo(props: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  
  // CATWRK - Category of wreck
  const catwrk = props.CATWRK as number | undefined;
  if (catwrk !== undefined) {
    const categories: Record<number, string> = {
      1: 'Non-dangerous',
      2: 'Dangerous',
      3: 'Distributed remains',
      4: 'Mast showing',
      5: 'Hull showing',
    };
    result['Category'] = categories[catwrk] || `Code ${catwrk}`;
  }
  
  // WATLEV - Water level effect
  const watlev = props.WATLEV as number | undefined;
  if (watlev !== undefined) {
    const levels: Record<number, string> = {
      1: 'Partly submerged',
      2: 'Always dry',
      3: 'Always underwater',
      4: 'Covers and uncovers',
      5: 'Awash',
    };
    result['Water level'] = levels[watlev] || `Code ${watlev}`;
  }
  
  // VALSOU - Depth over wreck
  if (props.VALSOU !== undefined) {
    result['Depth over'] = `${props.VALSOU}m`;
  }
  
  return result;
}

// Format rock info
function formatRockInfo(props: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  
  // WATLEV - Water level effect
  const watlev = props.WATLEV as number | undefined;
  if (watlev !== undefined) {
    const levels: Record<number, string> = {
      3: 'Always underwater',
      4: 'Covers and uncovers',
      5: 'Awash',
    };
    result['Water level'] = levels[watlev] || `Code ${watlev}`;
  }
  
  // VALSOU - Depth
  if (props.VALSOU !== undefined) {
    result['Depth'] = `${props.VALSOU}m`;
  }
  
  return result;
}

// Format obstruction info
function formatObstructionInfo(props: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  
  // CATOBS - Category of obstruction
  const catobs = props.CATOBS as number | undefined;
  if (catobs !== undefined) {
    const categories: Record<number, string> = {
      1: 'Snag/stump',
      2: 'Wellhead',
      3: 'Diffuser',
      4: 'Crib',
      5: 'Fish haven',
      6: 'Foul area',
      7: 'Foul ground',
      8: 'Ice boom',
      9: 'Ground tackle',
      10: 'Boom',
    };
    result['Category'] = categories[catobs] || `Code ${catobs}`;
  }
  
  // VALSOU - Depth
  if (props.VALSOU !== undefined) {
    result['Depth'] = `${props.VALSOU}m`;
  }
  
  return result;
}

// Format pipeline info
function formatPipelineInfo(props: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  
  // CATPIP - Category of pipeline
  const catpip = props.CATPIP as number | undefined;
  if (catpip !== undefined) {
    const categories: Record<number, string> = {
      1: 'Oil pipeline',
      2: 'Gas pipeline',
      3: 'Water pipeline',
      4: 'Sewage pipeline',
      5: 'Bubbler system',
      6: 'Supply pipeline',
    };
    result['Type'] = categories[catpip] || `Code ${catpip}`;
  }
  
  // BURDEP - Buried depth
  if (props.BURDEP !== undefined) {
    result['Buried depth'] = `${props.BURDEP}m`;
  }
  
  return result;
}

// Format restricted area info
function formatRestrictedAreaInfo(props: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  
  // CATREA - Category of restricted area
  const catrea = props.CATREA as number | undefined;
  if (catrea !== undefined) {
    const categories: Record<number, string> = {
      1: 'Offshore safety zone',
      4: 'Nature reserve',
      5: 'Bird sanctuary',
      6: 'Game reserve',
      7: 'Seal sanctuary',
      8: 'Degaussing range',
      9: 'Military area',
      12: 'Historic wreck area',
      14: 'Research area',
      17: 'Explosives dumping',
      18: 'Spoil ground',
      19: 'No anchoring',
      20: 'No diving',
      21: 'No fishing',
      22: 'No trawling',
      23: 'No wake zone',
      24: 'Swinging area',
      25: 'Water skiing area',
      26: 'Environmentally sensitive',
      27: 'To be avoided',
    };
    result['Category'] = categories[catrea] || `Code ${catrea}`;
  }
  
  // RESTRN - Restrictions
  const restrn = props.RESTRN;
  if (restrn) {
    const restrictions: Record<number, string> = {
      1: 'Anchoring prohibited',
      2: 'Anchoring restricted',
      3: 'Fishing prohibited',
      4: 'Fishing restricted',
      5: 'Trawling prohibited',
      6: 'Trawling restricted',
      7: 'Entry prohibited',
      8: 'Entry restricted',
      9: 'Dredging prohibited',
      10: 'Dredging restricted',
      11: 'Diving prohibited',
      12: 'Diving restricted',
      13: 'No wake',
      14: 'To be avoided',
    };
    const codes = Array.isArray(restrn) ? restrn : [restrn];
    const names = codes.map((c: number) => restrictions[c] || `Code ${c}`);
    result['Restrictions'] = names.join(', ');
  }
  
  // INFORM - Information
  if (props.INFORM) {
    result['Info'] = String(props.INFORM);
  }
  
  return result;
}

// Format caution area info
function formatCautionAreaInfo(props: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  
  // INFORM - Information about the caution
  if (props.INFORM) {
    result['Info'] = String(props.INFORM);
  }
  
  // TXTDSC - Text description
  if (props.TXTDSC) {
    result['Description'] = String(props.TXTDSC);
  }
  
  return result;
}

// Format military practice area info
function formatMilitaryAreaInfo(props: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  
  // CATMPA - Category of military practice area
  const catmpa = props.CATMPA as number | undefined;
  if (catmpa !== undefined) {
    const categories: Record<number, string> = {
      1: 'Torpedo exercise area',
      2: 'Submarine exercise area',
      3: 'Firing danger area',
      4: 'Mine-laying practice area',
      5: 'Small arms firing range',
    };
    result['Category'] = categories[catmpa] || `Code ${catmpa}`;
  }
  
  // INFORM - Information
  if (props.INFORM) {
    result['Info'] = String(props.INFORM);
  }
  
  return result;
}

// Format anchorage info
function formatAnchorageInfo(props: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  
  // CATACH - Category of anchorage
  const catach = props.CATACH as number | undefined;
  if (catach !== undefined) {
    const categories: Record<number, string> = {
      1: 'Unrestricted anchorage',
      2: 'Deep water anchorage',
      3: 'Tanker anchorage',
      4: 'Explosives anchorage',
      5: 'Quarantine anchorage',
      6: 'Sea-plane anchorage',
      7: 'Small craft anchorage',
      8: '24-hour anchorage',
      9: 'Limited period anchorage',
    };
    result['Category'] = categories[catach] || `Code ${catach}`;
  }
  
  // PEREND/PERSTA - Period of validity
  if (props.PEREND || props.PERSTA) {
    const start = props.PERSTA ? String(props.PERSTA) : '';
    const end = props.PEREND ? String(props.PEREND) : '';
    if (start || end) {
      result['Period'] = `${start} - ${end}`.trim();
    }
  }
  
  // INFORM - Information
  if (props.INFORM) {
    result['Info'] = String(props.INFORM);
  }
  
  return result;
}

// Format marine farm/aquaculture info
function formatMarineFarmInfo(props: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  
  // CATMFA - Category of marine farm/culture
  const catmfa = props.CATMFA as number | undefined;
  if (catmfa !== undefined) {
    const categories: Record<number, string> = {
      1: 'Crustaceans',
      2: 'Oysters/mussels',
      3: 'Fish',
      4: 'Seaweed',
      5: 'Pearl culture',
    };
    result['Type'] = categories[catmfa] || `Code ${catmfa}`;
  }
  
  // INFORM - Information
  if (props.INFORM) {
    result['Info'] = String(props.INFORM);
  }
  
  return result;
}

// Memoized Feature Inspector - prevents full component tree re-render
const FeatureInspector = memo(function FeatureInspector({ 
  feature, 
  formattedProps, 
  onClose 
}: { 
  feature: FeatureInfo; 
  formattedProps: [string, string][] | null;
  onClose: () => void;
}) {
  const renderStart = Date.now();
  
  const content = (
    <View style={styles.inspector}>
      <View style={styles.inspectorHeader}>
        <View style={styles.inspectorTitleRow}>
          <Text style={styles.inspectorType}>{feature.type}</Text>
          <Text style={styles.inspectorId}>{getFeatureId(feature)}</Text>
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.inspectorClose}>✕</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.inspectorContent}>
        {formattedProps?.map(([key, value]) => (
          <View key={key} style={styles.inspectorRow}>
            <Text style={styles.inspectorKey}>{key}</Text>
            <Text style={styles.inspectorValue}>{String(value)}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
  
  return content;
});

// Toggle component (legacy)
function Toggle({ label, value, onToggle }: { label: string; value: boolean; onToggle: (v: boolean) => void }) {
  return (
    <TouchableOpacity style={styles.toggle} onPress={() => onToggle(!value)}>
      <View style={[styles.toggleBox, value && styles.toggleBoxActive]}>
        {value && <Text style={styles.toggleCheck}>✓</Text>}
      </View>
      <Text style={styles.toggleLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ForeFlight-style Toggle component for dark translucent panels
function FFToggle({ label, value, onToggle, indent = false }: { label: string; value: boolean; onToggle: (v: boolean) => void; indent?: boolean }) {
  // Get current theme colors
  const theme = themeService.getUITheme();
  
  return (
    <TouchableOpacity 
      style={[styles.ffToggle, indent && styles.ffToggleIndent]} 
      onPress={() => onToggle(!value)}
    >
      <View style={[styles.ffToggleBox, value && styles.ffToggleBoxActive, { borderColor: theme.border }]}>
        {value && <Text style={[styles.ffToggleCheck, { color: theme.accentPrimary }]}>✓</Text>}
      </View>
      <Text style={[styles.ffToggleLabel, { color: theme.textPrimary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // Map section wrapper - holds map and all overlays, takes remaining flex space
  mapSection: { flex: 1 },
  mapTouchWrapper: { flex: 1 },
  map: { flex: 1 },
  // Bottom stack for detail charts - flex layout, sits above tab bar naturally
  bottomStack: {
    // No absolute positioning - flex child that takes its content height
  },
  // Vertical quick toggles (left side)
  quickTogglesVertical: {
    position: 'absolute',
    backgroundColor: 'rgba(21, 21, 23, 0.65)',
  },
  quickToggleBtnV: {
    width: 44,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickToggleDividerH: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginHorizontal: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: { marginTop: 16, fontSize: 16, color: '#666' },
  // Chart loading progress overlay (non-blocking background loading indicator)
  chartLoadingOverlay: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
    pointerEvents: 'none', // Don't block touch events
  },
  chartLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  chartLoadingText: {
    marginLeft: 10,
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  chartLoadingProgress: {
    marginLeft: 8,
    fontSize: 13,
    color: '#666',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 32,
  },
  emptyTitle: { fontSize: 24, fontWeight: '600', color: '#333', marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#666', marginBottom: 24 },
  downloadBtn: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  downloadBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  zoomBadge: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  maxZoomIndicator: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 152, 0, 0.85)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  maxZoomText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: '600',
  },
  layersBtn: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.9)',
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  debugBtn: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.9)',
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  debugBtnText: {
    fontSize: 20,
  },
  debugPanel: {
    position: 'absolute',
    right: 12,
    width: 280,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    borderRadius: 10,
    padding: 12,
    maxHeight: 400,
  },
  debugScrollView: {
    maxHeight: 280,
  },
  debugTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  debugSectionTitle: {
    color: '#888',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
    marginTop: 4,
  },
  debugText: {
    color: '#ddd',
    fontSize: 12,
    marginBottom: 4,
  },
  debugInfo: {
    color: '#88ff88',
    fontSize: 9,
    fontFamily: 'monospace',
    lineHeight: 14,
  },
  debugStorageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 2,
  },
  debugStorageLabel: {
    color: '#aaa',
    fontSize: 11,
  },
  debugStorageValue: {
    color: '#4CAF50',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  debugStorageValueSmall: {
    color: '#888',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  debugChartList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  debugChartItem: {
    color: '#4FC3F7',
    fontSize: 10,
    fontFamily: 'monospace',
    backgroundColor: 'rgba(79, 195, 247, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  debugDivider: {
    height: 1,
    backgroundColor: '#333',
    marginVertical: 10,
  },
  // Debug buttons for tile diagnostics
  debugButtonRow: {
    position: 'absolute',
    bottom: 100,
    left: 12,
    flexDirection: 'row',
    backgroundColor: 'rgba(180, 60, 60, 0.85)',
    borderRadius: 8,
    padding: 4,
    gap: 4,
  },
  debugButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 4,
  },
  debugButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  debugToggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  debugToggle: {
    flex: 1,
    backgroundColor: '#222',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#444',
  },
  debugToggleActive: {
    backgroundColor: '#1B5E20',
    borderColor: '#4CAF50',
  },
  debugToggleText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  debugToggleTextActive: {
    color: '#fff',
  },
  debugActions: {
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingTop: 10,
    marginTop: 4,
  },
  debugActionBtn: {
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginBottom: 8,
    alignItems: 'center',
  },
  debugActionBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  debugCloseBtn: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  debugCloseBtnText: {
    color: '#666',
    fontSize: 13,
  },
  layersIcon: {
    width: 22,
    height: 22,
    position: 'relative',
  },
  layersSquare: {
    position: 'absolute',
    width: 14,
    height: 10,
    borderWidth: 1.5,
    borderColor: '#333',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 2,
  },
  layersSquare1: {
    top: 0,
    left: 0,
  },
  layersSquare2: {
    top: 4,
    left: 4,
  },
  layersSquare3: {
    top: 8,
    left: 8,
  },
  controls: {
    position: 'absolute',
    right: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    maxHeight: 420,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  controlsScroll: { maxHeight: 340 },
  controlSectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 4,
  },
  allToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  allToggleBtn: {
    flex: 1,
    backgroundColor: '#007AFF',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  allToggleBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  mapStyleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  mapStyleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  mapStyleBtnActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  mapStyleBtnText: {
    fontSize: 12,
    color: '#333',
    fontWeight: '500',
  },
  mapStyleBtnTextActive: {
    color: '#fff',
  },
  toggle: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  toggleBox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: '#ccc',
    borderRadius: 4,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBoxActive: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  toggleCheck: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  toggleLabel: { fontSize: 14, color: '#333' },
  closeBtn: { marginTop: 8, alignItems: 'center' },
  closeBtnText: { color: '#007AFF', fontSize: 14 },
  inspector: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 10,
    maxHeight: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  inspectorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    backgroundColor: '#f8f9fa',
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  inspectorTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  inspectorType: { fontSize: 13, fontWeight: '600', color: '#666' },
  inspectorId: { fontSize: 13, fontWeight: '500', color: '#333', marginLeft: 8 },
  inspectorClose: { fontSize: 18, color: '#999', paddingLeft: 8 },
  inspectorContent: { padding: 10 },
  inspectorRow: { flexDirection: 'row', paddingVertical: 3 },
  inspectorKey: { flex: 1, fontSize: 12, color: '#666' },
  inspectorValue: { flex: 2, fontSize: 12, color: '#333' },
  
  // GPS and Compass styles
  activeToggleBtn: {
    backgroundColor: 'rgba(33, 150, 243, 0.9)',
    borderWidth: 2,
    borderColor: '#1976d2',
  },
  shipMarker: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  shipIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 122, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  locationDotInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#007AFF',
  },
  shipBow: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#4FC3F7',
  },
  shipBody: {
    width: 16,
    height: 20,
    backgroundColor: '#4FC3F7',
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    marginTop: -2,
    borderWidth: 2,
    borderColor: '#0288D1',
    borderTopWidth: 0,
  },
  accuracyRing: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(33, 150, 243, 0.4)',
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
  },
  
  // ========== ForeFlight-style UI Styles ==========
  
  // Top menu bar - horizontal strip (same button size as vertical quick toggles)
  topMenuBar: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  topMenuBtn: {
    width: 44,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topMenuBtnActive: {
    backgroundColor: 'rgba(79, 195, 247, 0.4)',
  },
  topMenuBtnText: {
    fontSize: 24,
    color: '#fff',
  },
  topMenuBtnTextSmall: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  topMenuDivider: {
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginVertical: 6,
  },
  
  // Scale bar - centered below top menu bar
  scaleBarContainer: {
    position: 'absolute',
    alignSelf: 'center',
    alignItems: 'center',
  },
  scaleBarInner: {
    alignItems: 'center',
  },
  scaleBarLine: {
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 1,
    position: 'relative',
  },
  scaleBarEndCapLeft: {
    position: 'absolute',
    left: 0,
    top: -3,
    width: 2,
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 1,
  },
  scaleBarEndCapRight: {
    position: 'absolute',
    right: 0,
    top: -3,
    width: 2,
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 1,
  },
  scaleBarLabel: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 2,
    fontWeight: '600',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  
  // 3D layer stack icon (bigger)
  layerStackIcon: {
    width: 24,
    height: 20,
    position: 'relative',
  },
  layerStackLine: {
    position: 'absolute',
    width: 18,
    height: 4,
    backgroundColor: '#fff',
    borderRadius: 1,
  },
  
  // Upper right controls container - Day/Dusk/Night + Center on location
  upperRightControls: {
    position: 'absolute',
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 8,
    overflow: 'hidden',
    alignItems: 'center',
  },
  upperRightDivider: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  modeToggleText: {
    fontSize: 20,
  },
  centerBtnText: {
    fontSize: 28,
    color: '#fff',
  },
  
  // Quick toggles strip - minimalist style, bottom left
  quickToggleBtn: {
    width: 44,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickToggleBtnActive: {
    backgroundColor: 'rgba(79, 195, 247, 0.4)',
  },
  quickToggleBtnText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  quickToggleBtnTextLarge: {
    fontSize: 22,
    fontWeight: '400',
  },
  quickToggleDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginHorizontal: 8,
  },
  quickToggleDividerThick: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    marginVertical: 4,
  },
  
  
  // Bottom Control Panel - tabbed interface
  controlPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '40%',
    minHeight: 280,
    maxHeight: 450,
    backgroundColor: 'rgba(20, 25, 35, 0.95)',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    zIndex: 9999,
    elevation: 20, // Android
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabButtonActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#4FC3F7',
  },
  tabButtonText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '500',
  },
  tabButtonTextActive: {
    color: '#4FC3F7',
    fontWeight: '600',
  },
  tabContent: {
    flex: 1,
    overflow: 'hidden',
  },
  tabScrollContent: {
    padding: 16,
    paddingBottom: 64,
  },
  panelSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 4,
  },
  panelDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 12,
  },
  
  // Base Map tab
  basemapGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  basemapOption: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    minWidth: 80,
    alignItems: 'center',
  },
  basemapOptionActive: {
    backgroundColor: 'rgba(79, 195, 247, 0.3)',
  },
  basemapOptionText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  basemapOptionTextActive: {
    color: '#4FC3F7',
    fontWeight: '600',
  },
  activeChartInfo: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  activeChartText: {
    color: '#4FC3F7',
    fontSize: 14,
    fontWeight: '600',
  },
  activeChartSubtext: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    marginTop: 4,
  },
  chartScaleList: {
    marginTop: 8,
  },
  chartScaleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 4,
    marginBottom: 4,
  },
  chartScaleLabel: {
    color: '#4FC3F7',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  chartScaleCount: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
  },
  
  // Layers tab container
  layersTabContainer: {
    flex: 1,
  },
  subTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 8,
  },
  subTabButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginRight: 4,
  },
  subTabButtonActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#4FC3F7',
  },
  subTabButtonText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '500',
  },
  subTabButtonTextActive: {
    color: '#4FC3F7',
    fontWeight: '600',
  },
  layersColumnsContainer: {
    flex: 1,
  },
  layersColumnsContent: {
    padding: 12,
    paddingBottom: 20,
  },
  layersAllToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  layersThreeColumns: {
    flex: 1,
    flexDirection: 'row',
  },
  layersTwoColumns: {
    flex: 1,
    flexDirection: 'row',
  },
  layersColumn: {
    flex: 1,
    paddingHorizontal: 8,
  },
  layersColumnTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  layersIndentGroup: {
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(79, 195, 247, 0.3)',
    marginLeft: 4,
    marginTop: 4,
  },
  layersDisabledText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.3)',
    fontStyle: 'italic',
    marginTop: 4,
  },
  dataInfoBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: 10,
    borderRadius: 6,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dataInfoLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  dataInfoValue: {
    fontSize: 14,
    color: '#4FC3F7',
    fontWeight: '600',
  },
  
  // Layers tab - All On/Off buttons
  allToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  allToggleBtn: {
    flex: 1,
    backgroundColor: 'rgba(79, 195, 247, 0.2)',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  allToggleBtnText: {
    color: '#4FC3F7',
    fontSize: 12,
    fontWeight: '600',
  },
  
  // Display tab - vertical layout
  displayTabContainer: {
    flex: 1,
    flexDirection: 'column',
  },
  displayControlsTop: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  displayControlHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  displayFeatureName: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
  headerRightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  featureTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  resetIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resetIconText: {
    fontSize: 18,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  featureTypeBadgeText: {
    backgroundColor: 'rgba(79, 195, 247, 0.3)',
  },
  featureTypeBadgeLine: {
    backgroundColor: 'rgba(255, 183, 77, 0.3)',
  },
  featureTypeBadgeArea: {
    backgroundColor: 'rgba(129, 199, 132, 0.3)',
  },
  featureTypeBadgeLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.8)',
    textTransform: 'uppercase',
  },
  symbolTextToggle: {
    flexDirection: 'row',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  symbolTextToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  symbolTextToggleBtnActive: {
    // Background color set dynamically based on symbol.color
  },
  symbolTextToggleText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.85)',
    textTransform: 'uppercase',
  },
  symbolTextToggleTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  controlRowLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    width: 65,
  },
  sliderContainerCompact: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  displaySliderCompact: {
    flex: 1,
    height: 32,
  },
  sliderMinLabelSmall: {
    fontSize: 9,
    color: 'rgba(255, 255, 255, 0.4)',
    width: 26,
  },
  sliderMaxLabelSmall: {
    fontSize: 9,
    color: 'rgba(255, 255, 255, 0.4)',
    width: 26,
    textAlign: 'right',
  },
  sliderValueCompact: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
    width: 45,
    textAlign: 'right',
  },
  // Feature selector - grid below controls
  featureSelectorContainer: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  displayLegendInline: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginBottom: 10,
  },
  featureSelectorScroll: {
    flex: 1,
  },
  featureSelectorContent: {
    paddingBottom: 16,
  },
  featureSelectorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  featureSelectorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  featureSelectorChipActive: {
    backgroundColor: 'rgba(79, 195, 247, 0.25)',
  },
  featureSelectorChipText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  featureSelectorChipTextActive: {
    color: '#fff',
    fontWeight: '500',
  },
  featureTypeIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  featureTypeText: {
    backgroundColor: '#4FC3F7',
  },
  featureTypeLine: {
    backgroundColor: '#FFB74D',
  },
  featureTypeArea: {
    backgroundColor: '#81C784',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginLeft: 4,
  },
  
  // Other tab
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    padding: 4,
  },
  segmentOption: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 6,
  },
  segmentOptionActive: {
    backgroundColor: 'rgba(79, 195, 247, 0.3)',
  },
  segmentOptionText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  segmentOptionTextActive: {
    color: '#4FC3F7',
    fontWeight: '600',
  },
  settingNote: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.4)',
    marginTop: 8,
    fontStyle: 'italic',
  },
  resetAllBtn: {
    backgroundColor: 'rgba(244, 67, 54, 0.2)',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  resetAllBtnText: {
    color: '#EF5350',
    fontSize: 14,
    fontWeight: '600',
  },
  
  // ForeFlight-style toggles
  ffToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  ffToggleIndent: {
    paddingLeft: 16,
  },
  ffToggleBox: {
    width: 18,
    height: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    borderRadius: 4,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ffToggleBoxActive: {
    backgroundColor: '#4FC3F7',
    borderColor: '#4FC3F7',
  },
  ffToggleCheck: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  ffToggleLabel: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.85)',
  },
  
  // Feature Picker - for selecting between multiple features at tap location
  featurePickerContainer: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(20, 25, 35, 0.95)',
    borderRadius: 12,
    maxHeight: 300,
    overflow: 'hidden',
  },
  featurePickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  featurePickerTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  featurePickerClose: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featurePickerCloseText: {
    fontSize: 24,
    color: '#888',
    fontWeight: '300',
  },
  featurePickerList: {
    maxHeight: 240,
  },
  featurePickerItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  featurePickerItemText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#4FC3F7',
  },
  featurePickerItemSubtext: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 2,
  },

  // Layer Selector Panel - ForeFlight-style multi-column overlay (compact)
  layerSelectorOverlay: {
    position: 'absolute',
    left: 6,
    backgroundColor: 'rgba(21, 21, 23, 0.94)',
    borderRadius: 10,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  layerSelectorScroll: {
    maxHeight: '100%',
  },
  layerSelectorContent: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    padding: 8,
    paddingBottom: 12,
    gap: 12,
  },
  layerSelectorColumn: {
    paddingHorizontal: 4,
  },
  layerSectionHeader: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4FC3F7',
    marginTop: 8,
    marginBottom: 2,
    marginLeft: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  layerToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderRadius: 4,
    marginVertical: 0,
  },
  layerToggleRowActive: {
    backgroundColor: 'rgba(79, 195, 247, 0.25)',
  },
  layerToggleText: {
    fontSize: 12,
    color: '#fff',
  },
  
  // Navigation data boxes
  navDataBox: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 8,
    padding: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    minWidth: 80,
  },
  navDataUpperLeft: {
    left: 0,
    zIndex: 100,
  },
  navDataUpperRight: {
    right: 0,
    zIndex: 100,
  },
  navDataLowerLeft: {
    left: 0,
    zIndex: 1000, // Above detail charts
  },
  navDataLowerRight: {
    right: 0,
    zIndex: 1000, // Above detail charts
  },
  navDataMiddleLeft: {
    left: 0,
    zIndex: 100,
  },
  navDataMiddleRight: {
    right: 0,
    zIndex: 100,
  },
  navDataLabel: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '600',
    marginBottom: 2,
  },
  navDataLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    alignSelf: 'stretch',
    marginBottom: 2,
  },
  navDataZoom: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '500',
  },
  navDataValue: {
    fontSize: 28,
    color: '#fff',
    fontWeight: 'bold',
    fontVariant: ['tabular-nums'],
  },
  navDataValueSmall: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  navDataUnit: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: -2,
  },
});

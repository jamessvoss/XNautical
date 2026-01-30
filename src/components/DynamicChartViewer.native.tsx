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
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapLibre from '@maplibre/maplibre-react-native';
import {
  FeatureType,
  GeoJSONFeatureCollection,
  ALL_FEATURE_TYPES,
} from '../types/chart';
import * as chartCacheService from '../services/chartCacheService';
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
import GPSInfoPanel from './GPSInfoPanel';
import CompassOverlay from './CompassOverlay';
import { useGPS } from '../hooks/useGPS';
import { getDetailLevel, getDetailZoomOffset, DetailLevel } from '../screens/SettingsScreen';

// MapLibre doesn't require an access token
// Logger removed - not available in MapLibre React Native

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
};

// Feature lookup optimization constants (moved outside component for performance)
// OBJL code to layer name mapping (S-57 standard)
const OBJL_NAMES: Record<number, string> = {
  2: 'ACHARE', 3: 'ACHBRT', 6: 'BCNCAR', 7: 'BCNISD', 8: 'BCNLAT',
  9: 'BCNSPP', 10: 'BCNSAW', 12: 'BRIDGE', 14: 'BOYCAR', 15: 'BOYISD', 16: 'BOYINB',
  17: 'BOYLAT', 18: 'BOYSAW', 19: 'BOYSPP', 20: 'BUISGL', 21: 'CBLARE', 22: 'CBLSUB',
  23: 'CBLOHD', 30: 'COALNE', 33: 'CTNARE', 42: 'DEPARE', 43: 'DEPCNT',
  46: 'DRGARE', 57: 'FAIRWY', 71: 'LNDARE', 73: 'LNDRGN', 74: 'LNDMRK', 75: 'LIGHTS',
  79: 'MARCUL', 83: 'MIPARE', 84: 'MORFAC', 86: 'OBSTRN', 94: 'PIPSOL', 97: 'PIPARE', 98: 'PIPSOL',
  112: 'RESARE', 114: 'SBDARE', 119: 'SEAARE', 121: 'SBDARE', 122: 'SLCONS',
  129: 'SOUNDG', 153: 'UWTROC', 156: 'WATTUR', 159: 'WRECKS',
};

// Helper to get layer name from OBJL code
const getLayerName = (props: any): string => {
  const objl = props?.OBJL;
  return objl ? (OBJL_NAMES[objl] || `OBJL_${objl}`) : 'Unknown';
};

// Priority map for O(1) lookup - using OBJL codes for reliability
const OBJL_PRIORITIES: Map<number, number> = new Map([
  [75, 100],   // LIGHTS
  [17, 98], [14, 97], [18, 96], [19, 95], [15, 94], [16, 93],  // Buoys
  [8, 92], [9, 91], [6, 90], [7, 89], [10, 88],  // Beacons
  [159, 87], [153, 86], [86, 85],  // WRECKS, UWTROC, OBSTRN
  [112, 84], [33, 83], [83, 82],   // RESARE, CTNARE, MIPARE
  [2, 81], [3, 80], [79, 79],      // ACHARE, ACHBRT, MARCUL
  [74, 78],  // LNDMRK
  [84, 77],  // MORFAC (Mooring Facility)
  [22, 76], [21, 75], [94, 74], [98, 74], [97, 73],  // Cables and pipes
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
  cautionAreas: true,
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
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  
  // === STYLE SWITCH: Track render count ===
  const renderCountRef = useRef<number>(0);
  renderCountRef.current++;
  
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
  } = layers;
  
  // GNIS Place Names layer toggles
  const [gnisAvailable, setGnisAvailable] = useState(false);
  const [showPlaceNames, setShowPlaceNames] = useState(true);
  const [showWaterNames, setShowWaterNames] = useState(true);      // Bays, channels, sounds
  const [showCoastalNames, setShowCoastalNames] = useState(true);  // Capes, islands, beaches
  const [showLandmarkNames, setShowLandmarkNames] = useState(true); // Summits, glaciers
  const [showPopulatedNames, setShowPopulatedNames] = useState(true); // Towns, ports
  const [showStreamNames, setShowStreamNames] = useState(false);    // Rivers, creeks (off by default - too many)
  const [showLakeNames, setShowLakeNames] = useState(false);        // Lakes (off by default)
  const [showTerrainNames, setShowTerrainNames] = useState(false);  // Valleys, basins (off by default)
  
  // UI state
  const [currentZoom, setCurrentZoom] = useState(8);
  const [centerCoord, setCenterCoord] = useState<[number, number]>([-151.55, 59.64]);
  const [selectedFeature, setSelectedFeature] = useState<FeatureInfo | null>(null);
  const [showControls, setShowControls] = useState(false);
  
  // Debug: Force VectorSource reload
  const [sourceReloadKey, setSourceReloadKey] = useState(0);
  
  // Track tap start time for end-to-end performance measurement
  const tapStartTimeRef = useRef<number>(0);
  
  // === STYLE SWITCH PERFORMANCE TRACKING ===
  const styleSwitchStartRef = useRef<number>(0);
  const styleSwitchFromRef = useRef<string>('');
  const styleSwitchToRef = useRef<string>('');
  const styleSwitchRenderCountRef = useRef<number>(0);
  
  // Map style options
  type MapStyleOption = 'light' | 'dark' | 'satellite' | 'outdoors' | 'local';
  const [mapStyle, setMapStyleInternal] = useState<MapStyleOption>('light');
  const [hasLocalBasemap, setHasLocalBasemap] = useState(false);
  
  // Wrapper for setMapStyle with timing logs
  const setMapStyle = useCallback((newStyle: MapStyleOption) => {
    const now = Date.now();
    console.log('='.repeat(60));
    console.log('[STYLE-SWITCH] === BASEMAP SWITCH INITIATED ===');
    console.log(`[STYLE-SWITCH] From: "${mapStyle}" → To: "${newStyle}"`);
    console.log(`[STYLE-SWITCH] Start time: ${new Date(now).toISOString()}`);
    
    styleSwitchStartRef.current = now;
    styleSwitchFromRef.current = mapStyle;
    styleSwitchToRef.current = newStyle;
    styleSwitchRenderCountRef.current = 0;
    
    console.log(`[STYLE-SWITCH] Calling setMapStyleInternal...`);
    const stateStart = Date.now();
    setMapStyleInternal(newStyle);
    console.log(`[STYLE-SWITCH] setMapStyleInternal returned: ${Date.now() - stateStart}ms`);
  }, [mapStyle]);
  
  // Glyphs URL for local font serving (Noto Sans fonts bundled in assets)
  const glyphsUrl = 'http://localhost:8080/fonts/{fontstack}/{range}.pbf';
  
  // Minimal offline style - land colored background, water rendered on top
  const localOfflineStyle = {
    version: 8,
    name: 'Local Offline',
    glyphs: glyphsUrl,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#f0ede9' } // Light tan/beige for land
      }
    ]
  };
  
  // MapLibre uses OpenMapTiles-compatible styles with local font serving
  const mapStyleUrls: Record<MapStyleOption, string | object> = {
    light: { version: 8, glyphs: glyphsUrl, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f0f0f0' } }] },
    dark: { version: 8, glyphs: glyphsUrl, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#1a1a2e' } }] },
    satellite: { version: 8, glyphs: glyphsUrl, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#2d3436' } }] },
    outdoors: { version: 8, glyphs: glyphsUrl, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dfe6e9' } }] },
    local: localOfflineStyle, // Inline style object for offline mode
  };

  // Debug state
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [showDebug, setShowDebug] = useState(false);
  const [showChartDebug, setShowChartDebug] = useState(false);
  const [showCoords, setShowCoords] = useState(true);
  const [showZoomLevel, setShowZoomLevel] = useState(true);
  
  // GPS and Navigation state
  const [showGPSPanel, setShowGPSPanel] = useState(false);
  const [showCompass, setShowCompass] = useState(false);
  const [followGPS, setFollowGPS] = useState(false); // Follow mode - center map on position
  const { gpsData, startTracking, stopTracking, toggleTracking } = useGPS();
  
  // Zoom limiting - constrain zoom to available chart detail
  const [limitZoomToCharts, setLimitZoomToCharts] = useState(true);
  const [isAtMaxZoom, setIsAtMaxZoom] = useState(false);
  
  // Detail level - controls when higher-res charts appear (0, 2, or 4 zoom levels earlier)
  const [detailZoomOffset, setDetailZoomOffset] = useState(2); // Default medium
  const [detailLevel, setDetailLevel] = useState<DetailLevel>('medium');
  
  // Load detail level preference when screen gains focus
  // This allows changes in Settings to take effect immediately when returning
  useFocusEffect(
    useCallback(() => {
      getDetailLevel().then(level => {
        setDetailLevel(level);
        setDetailZoomOffset(getDetailZoomOffset(level));
      });
    }, [])
  );
  
  // Cycle through detail levels: low -> medium -> high -> low
  const cycleDetailLevel = useCallback(async () => {
    const nextLevel: DetailLevel = 
      detailLevel === 'low' ? 'medium' : 
      detailLevel === 'medium' ? 'high' : 'low';
    
    setDetailLevel(nextLevel);
    setDetailZoomOffset(getDetailZoomOffset(nextLevel));
    
    // Persist to AsyncStorage
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      await AsyncStorage.setItem('chartDetailLevel', nextLevel);
    } catch (e) {
      console.warn('Failed to save detail level:', e);
    }
  }, [detailLevel]);
  
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
    
    console.log('='.repeat(60));
    console.log('[DEBUG-BTN] === FETCH TILE ===');
    console.log(`[DEBUG-BTN] Center: ${centerCoord[0].toFixed(4)}, ${centerCoord[1].toFixed(4)}`);
    console.log(`[DEBUG-BTN] Zoom: ${currentZoom.toFixed(2)} → Tile: z${tile.z}/${tile.x}/${tile.y}`);
    console.log(`[DEBUG-BTN] URL: ${url}`);
    
    try {
      const start = Date.now();
      const response = await fetch(url);
      const elapsed = Date.now() - start;
      
      console.log(`[DEBUG-BTN] Response: ${response.status} ${response.statusText}`);
      console.log(`[DEBUG-BTN] Time: ${elapsed}ms`);
      
      const chartSource = response.headers.get('X-Chart-Source');
      const chartsTried = response.headers.get('X-Charts-Tried');
      console.log(`[DEBUG-BTN] X-Chart-Source: ${chartSource}`);
      console.log(`[DEBUG-BTN] X-Charts-Tried: ${chartsTried}`);
      
      if (response.ok) {
        const blob = await response.blob();
        console.log(`[DEBUG-BTN] Tile size: ${blob.size} bytes`);
      } else {
        console.log(`[DEBUG-BTN] No tile data`);
      }
    } catch (error) {
      console.log(`[DEBUG-BTN] Error: ${error}`);
    }
    console.log('='.repeat(60));
  }, [centerCoord, currentZoom, lonLatToTile]);

  // Button 2: Fetch the TileJSON metadata
  const debugFetchTileJSON = useCallback(async () => {
    const url = 'http://127.0.0.1:8765/tiles.json';
    
    console.log('='.repeat(60));
    console.log('[DEBUG-BTN] === FETCH TILEJSON ===');
    console.log(`[DEBUG-BTN] URL: ${url}`);
    
    try {
      const response = await fetch(url);
      console.log(`[DEBUG-BTN] Response: ${response.status} ${response.statusText}`);
      
      if (response.ok) {
        const json = await response.json();
        console.log('[DEBUG-BTN] TileJSON contents:');
        console.log(`[DEBUG-BTN]   name: ${json.name}`);
        console.log(`[DEBUG-BTN]   minzoom: ${json.minzoom}`);
        console.log(`[DEBUG-BTN]   maxzoom: ${json.maxzoom}`);
        console.log(`[DEBUG-BTN]   bounds: ${JSON.stringify(json.bounds)}`);
        console.log(`[DEBUG-BTN]   tiles: ${JSON.stringify(json.tiles)}`);
      } else {
        console.log(`[DEBUG-BTN] Failed to fetch TileJSON`);
      }
    } catch (error) {
      console.log(`[DEBUG-BTN] Error: ${error}`);
    }
    console.log('='.repeat(60));
  }, []);

  // Button 3: Log current map state
  const debugLogMapState = useCallback(async () => {
    console.log('='.repeat(60));
    console.log('[DEBUG-BTN] === MAP STATE ===');
    console.log(`[DEBUG-BTN] Current zoom: ${currentZoom.toFixed(2)}`);
    console.log(`[DEBUG-BTN] Center: [${centerCoord[0].toFixed(6)}, ${centerCoord[1].toFixed(6)}]`);
    console.log(`[DEBUG-BTN] Tile server ready: ${tileServerReady}`);
    console.log(`[DEBUG-BTN] Use composite tiles: ${useCompositeTiles}`);
    console.log(`[DEBUG-BTN] Source reload key: ${sourceReloadKey}`);
    
    const tile = lonLatToTile(centerCoord[0], centerCoord[1], currentZoom);
    console.log(`[DEBUG-BTN] Current tile: z${tile.z}/${tile.x}/${tile.y}`);
    
    if (mapRef.current) {
      try {
        const bounds = await mapRef.current.getVisibleBounds();
        console.log(`[DEBUG-BTN] Visible bounds: ${JSON.stringify(bounds)}`);
      } catch (e) {
        console.log(`[DEBUG-BTN] Could not get bounds: ${e}`);
      }
    }
    console.log('='.repeat(60));
  }, [currentZoom, centerCoord, tileServerReady, useCompositeTiles, sourceReloadKey, lonLatToTile]);

  // Button 4: Force reload the VectorSource
  const debugForceReload = useCallback(() => {
    console.log('='.repeat(60));
    console.log('[DEBUG-BTN] === FORCE RELOAD SOURCE ===');
    console.log(`[DEBUG-BTN] Old key: ${sourceReloadKey}`);
    const newKey = sourceReloadKey + 1;
    setSourceReloadKey(newKey);
    console.log(`[DEBUG-BTN] New key: ${newKey}`);
    console.log('[DEBUG-BTN] VectorSource will unmount and remount...');
    console.log('='.repeat(60));
  }, [sourceReloadKey]);

  // Button 5: Scan files on device - list all files with sizes
  const debugScanFiles = useCallback(async () => {
    const FileSystem = require('expo-file-system/legacy');
    const mbtilesDir = 'file:///storage/emulated/0/Android/data/com.xnautical.app/files/mbtiles';
    
    console.log('='.repeat(60));
    console.log('[SCAN-FILES] === SCANNING DEVICE FILES ===');
    console.log(`[SCAN-FILES] Directory: ${mbtilesDir}`);
    
    try {
      const dirInfo = await FileSystem.getInfoAsync(mbtilesDir);
      if (!dirInfo.exists) {
        console.log('[SCAN-FILES] Directory does not exist!');
        console.log('='.repeat(60));
        return;
      }
      
      const files = await FileSystem.readDirectoryAsync(mbtilesDir);
      let totalSize = 0;
      
      for (const filename of files) {
        const filePath = `${mbtilesDir}/${filename}`;
        try {
          const fileInfo = await FileSystem.getInfoAsync(filePath, { size: true });
          const size = fileInfo.size || 0;
          totalSize += size;
          const sizeMB = (size / 1024 / 1024).toFixed(2);
          console.log(`[SCAN-FILES]   ${filename}: ${sizeMB} MB`);
        } catch (e) {
          console.log(`[SCAN-FILES]   ${filename}: [error]`);
        }
      }
      
      console.log(`[SCAN-FILES] Total: ${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB (${files.length} files)`);
      
      // Check for manifest.json and show contents
      const manifestPath = `${mbtilesDir}/manifest.json`;
      const manifestInfo = await FileSystem.getInfoAsync(manifestPath);
      if (manifestInfo.exists) {
        const content = await FileSystem.readAsStringAsync(manifestPath);
        const manifest = JSON.parse(content);
        console.log('[SCAN-FILES] --- manifest.json contents ---');
        console.log(`[SCAN-FILES] Packs: ${manifest.packs?.length || 0}`);
        manifest.packs?.forEach((p: any) => console.log(`[SCAN-FILES]   - ${p.id}: z${p.minZoom}-${p.maxZoom}`));
        console.log(`[SCAN-FILES] BasePacks: ${manifest.basePacks?.length || 0}`);
        manifest.basePacks?.forEach((p: any) => console.log(`[SCAN-FILES]   - ${p.id}`));
      } else {
        console.log('[SCAN-FILES] No manifest.json found');
      }
      
    } catch (error) {
      console.log(`[SCAN-FILES] Error: ${error}`);
    }
    console.log('='.repeat(60));
  }, []);

  // Load cached charts
  useEffect(() => {
    loadCharts();
    
    // Cleanup on unmount
    return () => {
      tileServer.stopTileServer();
    };
  }, []);
  
  // === STYLE SWITCH TRACKING: Log when mapStyle state actually updates ===
  useEffect(() => {
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      console.log(`[STYLE-SWITCH] React state updated to "${mapStyle}" - elapsed: ${elapsed}ms`);
      console.log(`[STYLE-SWITCH] styleURL will be: ${typeof mapStyleUrls[mapStyle] === 'string' ? mapStyleUrls[mapStyle] : 'inline JSON (local)'}`);
      console.log(`[STYLE-SWITCH] Component render count: ${renderCountRef.current}`);
      console.log(`[STYLE-SWITCH] Render phase starting - React will now reconcile JSX...`);
    }
  }, [mapStyle]);
  
  // === STYLE SWITCH TRACKING: Log when React commits the render (useLayoutEffect runs sync after DOM mutations) ===
  useLayoutEffect(() => {
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      console.log(`[STYLE-SWITCH] useLayoutEffect (render committed) - elapsed: ${elapsed}ms`);
      console.log(`[STYLE-SWITCH] React has finished reconciling, native views being updated...`);
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
      console.log(`[PROGRESSIVE] Skipped - using composite tile mode (single source)`);
      setLoadingPhase('complete');
      return;
    }
    
    // DEBUG: Log every time this effect runs
    console.log(`[PROGRESSIVE] Effect triggered - phase=${loadingPhase}, tileServerReady=${tileServerReady}, mbtilesCharts=${mbtilesCharts.length}, chartsToRender=${chartsToRender.length}`);
    
    if (loadingPhase === 'us1' && tileServerReady && mbtilesCharts.length > 0) {
      // Prevent duplicate runs
      if (progressiveLoadingRef.current) {
        console.log(`[PROGRESSIVE] Already loading, skipping`);
        return;
      }
      progressiveLoadingRef.current = true;
      
      console.log(`[PROGRESSIVE] Scheduling Phase 2...`);
      
      // Wait for any pending interactions/animations to complete
      const interactionHandle = InteractionManager.runAfterInteractions(async () => {
        console.log(`[PROGRESSIVE] Phase 2 starting after interactions`);
        
        // Get US1 charts (already rendered)
        const us1Charts = mbtilesCharts
          .filter(m => m.chartId.startsWith('US1'))
          .map(m => m.chartId);
        
        // Get US2+US3 charts to add
        const us2us3Charts = mbtilesCharts
          .filter(m => m.chartId.match(/^US[23]/))
          .map(m => m.chartId);
        
        console.log(`[PERF] Phase 2: Adding ${us2us3Charts.length} US2+US3 charts in batches`);
        
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
            console.log(`[PERF] Phase 3: Adding ${us4Charts.length} US4 charts in batches`);
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
              console.log(`[PERF] Phase 4: Adding ${us5us6Charts.length} US5/US6 charts in batches`);
              await addChartsBatched(phase3Total, us5us6Charts, 15, 'Loading harbor charts');
            }
            
            setChartLoadingProgress(null);
            setLoadingPhase('complete');
            progressiveLoadingRef.current = false;
            console.log(`[PROGRESSIVE] All phases complete`);
          }, 150);
        }, 200);
      });
      
      return () => {
        console.log(`[PROGRESSIVE] Cleanup - cancelling interaction handle`);
        interactionHandle.cancel();
        progressiveLoadingRef.current = false;
      };
    }
    
    console.log(`[PROGRESSIVE] No action taken this run`);
  }, [loadingPhase, tileServerReady, mbtilesCharts, addChartsBatched, useCompositeTiles]);
  
  // Start/stop GPS tracking when panel is shown/hidden
  useEffect(() => {
    if (showGPSPanel || showCompass) {
      startTracking();
    } else {
      stopTracking();
    }
  }, [showGPSPanel, showCompass]);
  
  // Follow GPS position when enabled
  useEffect(() => {
    if (followGPS && gpsData.latitude !== null && gpsData.longitude !== null) {
      cameraRef.current?.setCamera({
        centerCoordinate: [gpsData.longitude, gpsData.latitude],
        animationDuration: 500,
      });
    }
  }, [followGPS, gpsData.latitude, gpsData.longitude]);

  const loadCharts = async () => {
    const t0 = Date.now();
    console.log('=== STARTUP PERFORMANCE ===');
    console.log(`[PERF] Start: ${new Date().toISOString()}`);
    
    try {
      setLoading(true);
      
      const FileSystem = require('expo-file-system/legacy');
      
      // === PHASE 1: mbtiles directory - ALWAYS external storage (survives app uninstall) ===
      const dirStart = Date.now();
      const mbtilesDir = 'file:///storage/emulated/0/Android/data/com.xnautical.app/files/mbtiles';
      
      // Ensure directory exists
      try {
        const dirInfo = await FileSystem.getInfoAsync(mbtilesDir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(mbtilesDir, { intermediates: true });
          console.log('[PERF] Created external mbtiles directory');
        }
      } catch (e) {
        console.log('[PERF] Could not create mbtiles directory:', e);
      }
      console.log(`[PERF] Using external storage: ${mbtilesDir} (${Date.now() - dirStart}ms)`);
      
      // === PHASE 2: Load manifest.json (chart pack index) ===
      const indexStart = Date.now();
      let manifest: { packs?: { id: string; minZoom: number; maxZoom: number; fileSize?: number }[]; basePacks?: { id: string }[] } | null = null;
      let chartPacks: string[] = [];
      
      try {
        const manifestPath = `${mbtilesDir}/manifest.json`;
        const manifestInfo = await FileSystem.getInfoAsync(manifestPath);
        if (manifestInfo.exists) {
          const content = await FileSystem.readAsStringAsync(manifestPath);
          manifest = JSON.parse(content);
          chartPacks = (manifest?.packs || []).map(p => p.id);
          console.log(`[PERF] Loaded manifest.json with ${chartPacks.length} chart packs`);
        } else {
          console.log('[PERF] No manifest.json found - will scan directory');
        }
      } catch (e) {
        console.log('[PERF] Error loading manifest.json:', e);
      }
      console.log(`[PERF] Index load: ${Date.now() - indexStart}ms`);
      
      // Legacy variables kept for compatibility
      let tier1ChartIds: string[] = [];
      let tier2ChartIds: string[] = [];
      let totalChartCount = chartPacks.length;
      
      // === PHASE 3: Check for special files (GNIS, basemap) ===
      const specialStart = Date.now();
      const [gnisInfo, basemapInfo] = await Promise.all([
        FileSystem.getInfoAsync(`${mbtilesDir}/gnis_names_ak.mbtiles`),
        FileSystem.getInfoAsync(`${mbtilesDir}/basemap_alaska.mbtiles`),
      ]);
      
      const gnisFound = gnisInfo.exists;
      const basemapFound = basemapInfo.exists;
      
      setGnisAvailable(gnisFound);
      setHasLocalBasemap(basemapFound);
      
      console.log(`[PERF] Special files check: ${Date.now() - specialStart}ms (GNIS: ${gnisFound}, Basemap: ${basemapFound})`);
      
      // === PHASE 4: Build chart list from manifest.json or directory scan ===
      const buildStart = Date.now();
      const loadedMbtiles: LoadedMBTilesChart[] = [];
      const loadedRasters: LoadedRasterChart[] = [];
      
      if (manifest && chartPacks.length > 0) {
        // Using manifest.json for pack-based loading
        console.log(`[PERF] Using manifest.json with ${chartPacks.length} chart packs`);
        
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
            console.log(`[PERF] Skipping ${pack.id} - file not found`);
          }
        }
        
        // Also scan for raster files (BATHY_*)
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
        
        console.log(`[PERF] Built chart list from manifest.json: ${Date.now() - buildStart}ms (${loadedMbtiles.length} packs)`);
      } else {
        // No manifest - scan directory for any mbtiles files
        console.log('[PERF] Scanning directory for mbtiles files...');
        const scanStart = Date.now();
        try {
          const filesInDir = await FileSystem.readDirectoryAsync(mbtilesDir);
          for (const filename of filesInDir) {
            if (filename.endsWith('.mbtiles') && !filename.startsWith('._')) {
              const chartId = filename.replace('.mbtiles', '');
              const path = `${mbtilesDir}/${filename}`;
              
              // Skip special files (GNIS, basemap)
              if (chartId.startsWith('gnis_names_') || chartId.startsWith('basemap_')) {
                continue;
              }
              
              if (chartId.startsWith('BATHY_')) {
                loadedRasters.push({ chartId, path });
              } else {
                loadedMbtiles.push({ chartId, path });
              }
            }
          }
        } catch (e) {
          console.log('[PERF] Directory scan failed:', e);
        }
        console.log(`[PERF] Directory scan: ${Date.now() - scanStart}ms (${loadedMbtiles.length} charts)`);
      }
      
      // Log chart/pack inventory
      console.log(`[CHARTS] ========== CHART INVENTORY ==========`);
      if (manifest && chartPacks.length > 0) {
        console.log(`[CHARTS] Mode: Chart Packs (from manifest.json)`);
        console.log(`[CHARTS] Chart packs: ${chartPacks.length}`);
        for (const pack of manifest.packs || []) {
          const sizeMB = pack.fileSize ? Math.round(pack.fileSize / 1024 / 1024) : 0;
          const zoomRange = `z${pack.minZoom}-${pack.maxZoom}`;
          console.log(`[CHARTS]   - ${pack.id}: ${sizeMB}MB ${zoomRange}`);
        }
      } else {
        console.log(`[CHARTS] Mode: Directory scan`);
        console.log(`[CHARTS] Total charts: ${loadedMbtiles.length}`);
        for (const m of loadedMbtiles) {
          console.log(`[CHARTS]   - ${m.chartId}`);
        }
      }
      console.log(`[CHARTS] =======================================`);
      
      setMbtilesCharts(loadedMbtiles);
      
      // Render all loaded charts - tile server handles quilting/compositing
      const allChartIds = loadedMbtiles.map(m => m.chartId);
      setChartsToRender(allChartIds);
      setLoadingPhase('complete');
      console.log(`[CHARTS] Rendering ${allChartIds.length} charts: ${allChartIds.join(', ')}`);
      
      setRasterCharts(loadedRasters);
      
      // Skip storage calculation for large collections
      if (loadedMbtiles.length > 200) {
        setStorageUsed({ total: 0, vector: 0, raster: 0 });
      }
      
      // === PHASE 5: Start tile server ===
      if (loadedMbtiles.length > 0 || loadedRasters.length > 0) {
        const serverStart = Date.now();
        
        try {
          const serverUrl = await tileServer.startTileServer({ mbtilesDir });
          console.log(`[PERF] Tile server start: ${Date.now() - serverStart}ms`);
          
          if (serverUrl) {
            setTileServerReady(true);
            
            const chartSummary = `${loadedMbtiles.length} charts`;
            setDebugInfo(`Server: ${serverUrl}\nCharts: ${chartSummary}\nDir: ${mbtilesDir}`);
          } else {
            console.warn('[PERF] Failed to start tile server');
            setDebugInfo(`Failed to start tile server\nDir: ${mbtilesDir}`);
          }
        } catch (e) {
          console.error('[PERF] Tile server error:', e);
          setDebugInfo(`Tile server error: ${e}`);
        }
      } else {
        setDebugInfo(`No MBTiles files found.\n\nPut .mbtiles files in:\n${mbtilesDir}\n\nOr download via Charts screen.`);
      }
      
      // === PHASE 6: Load legacy GeoJSON (if any) ===
      const geoStart = Date.now();
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
        console.log(`[PERF] GeoJSON load: ${Date.now() - geoStart}ms (${loadedCharts.length} charts)`);
      }
      setCharts(loadedCharts);
      
      // === FINAL SUMMARY ===
      const totalTime = Date.now() - t0;
      console.log('=== STARTUP COMPLETE ===');
      console.log(`[PERF] Total startup: ${totalTime}ms`);
      console.log(`[PERF] Tile mode: COMPOSITE (server-side quilting, ~20 layers)`);
      console.log(`[PERF] Special: GNIS=${gnisFound}, Basemap=${basemapFound}`);
      
      if (totalTime > 5000) {
        console.warn(`[PERF] ⚠️ Startup took ${(totalTime/1000).toFixed(1)}s - consider optimization`);
      }
      
    } catch (error) {
      console.error('[PERF] STARTUP ERROR:', error);
      Alert.alert('Error', 'Failed to load cached charts');
    } finally {
      setLoading(false);
    }
  };

  // Combine features from all charts
  const combinedFeatures = useMemo(() => {
    console.log('Combining features from', charts.length, 'charts');
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
    
    console.log('Combined feature types:', Object.keys(combined));
    for (const [type, data] of Object.entries(combined)) {
      console.log(`  ${type}: ${data?.features?.length || 0} features`);
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
      console.log(`[STYLE-SWITCH] onMapIdle fired - elapsed: ${elapsed}ms`);
      console.log(`[STYLE-SWITCH] Map is now idle after switching to "${styleSwitchToRef.current}"`);
      console.log(`[STYLE-SWITCH] === BASEMAP SWITCH COMPLETE ===`);
      console.log(`[STYLE-SWITCH] Total time: ${elapsed}ms`);
      console.log('='.repeat(60));
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
      console.log('[PERF] Warming up query cache...');
      const warmupStart = Date.now();
      mapRef.current.queryRenderedFeaturesAtPoint([100, 100], undefined, [])
        .then(() => {
          console.log(`[PERF] Query cache warmed up in ${Date.now() - warmupStart}ms`);
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

  // Build list of queryable layer IDs from loaded charts
  // OPTIMIZED: Only query tappable features at current zoom level
  // Skip large background fills, labels, and charts not rendered at this zoom
  const queryableLayerIds = useMemo(() => {
    // Helper to check if a chart is rendered at current zoom
    // Returns true if chart's zoom range overlaps with current view
    const isChartVisibleAtZoom = (chartId: string, zoom: number): boolean => {
      const match = chartId.match(/^US(\d)/);
      if (!match) return true; // Include unknown charts
      const scale = parseInt(match[1], 10);
      
      // Chart zoom ranges (from tippecanoe settings in convert.py)
      // US1: z0-8, US2: z0-10, US3: z4-13, US4: z6-16, US5: z8-18, US6: z10-18
      // Include ±2 zoom buffer for overzoom tolerance
      switch (scale) {
        case 1: return zoom <= 10;  // US1: z0-8, buffer to z10
        case 2: return zoom <= 12;  // US2: z0-10, buffer to z12
        case 3: return zoom >= 2 && zoom <= 15;  // US3: z4-13, buffer ±2
        case 4: return zoom >= 4;   // US4: z6-16, buffer to z4+
        case 5: return zoom >= 6;   // US5: z8-18, buffer to z6+
        default: return zoom >= 8;  // US6+: z10-18, buffer to z8+
      }
    };
    
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
    
    // Filter charts by zoom level, then build layer IDs
    const chartsAtZoom = allChartsToRender.filter(chartId => isChartVisibleAtZoom(chartId, currentZoom));
    
    for (const chartId of chartsAtZoom) {
      for (const layerType of visibleTypes) {
        ids.push(`mbtiles-${layerType}-${chartId}`);
      }
    }
    console.log(`[MapPress] Built ${ids.length} queryable layer IDs for ${chartsAtZoom.length}/${allChartsToRender.length} charts at z${currentZoom.toFixed(1)} (${visibleTypes.length} layer types)`);
    return ids;
  }, [allChartsToRender, chartsToRender.length, currentZoom,
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
    console.log('[PERF:MapPress] === TAP EVENT START ===');
    
    if (!mapRef.current) {
      console.log('[PERF:MapPress] No map ref, aborting');
      return;
    }
    
    const { geometry } = e;
    if (!geometry?.coordinates) {
      console.log('[PERF:MapPress] No coordinates, aborting');
      return;
    }
    
    const [longitude, latitude] = geometry.coordinates;
    console.log(`[PERF:MapPress] Tap at: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
    
    // Round screen coordinates to integers
    const screenX = Math.round(e.properties?.screenPointX || 0);
    const screenY = Math.round(e.properties?.screenPointY || 0);
    
    const coordsTime = Date.now();
    console.log(`[PERF:MapPress] Coordinate extraction: ${coordsTime - perfStart}ms`);
    
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
      console.log(`[PERF:MapPress] Querying all layers (filter in JS)...`);
      const queryStart = Date.now();
      
      const allFeatures = await mapRef.current.queryRenderedFeaturesInRect(
        bbox,
        undefined,  // No filter expression
        []     // Empty array = query all layers (much faster than specifying 1000+ IDs)
      );
      
      const queryEnd = Date.now();
      console.log(`[PERF:MapPress] queryRenderedFeaturesInRect: ${queryEnd - queryStart}ms (found ${allFeatures?.features?.length || 0} raw features)`);
      
      // Debug: Log first 3 raw features to see what we're getting
      if (allFeatures?.features?.length > 0) {
        console.log('[PERF:MapPress] Raw feature samples:');
        for (let i = 0; i < Math.min(3, allFeatures.features.length); i++) {
          const f = allFeatures.features[i];
          const layerName = getLayerName(f.properties);
          console.log(`  [${i}] sourceLayer=${f.sourceLayerID || 'N/A'}, OBJL=${f.properties?.OBJL || 'N/A'} (${layerName}), props=${JSON.stringify(f.properties || {}).substring(0, 200)}`);
        }
      }
      
      // Filter to nautical features using OBJL codes (O(n) but n is small)
      const filterStart = Date.now();
      // OBJL codes for nautical layers we care about
      const nauticalOBJL = new Set([
        75,   // LIGHTS
        17, 14, 18, 19, 15, 16,  // Buoys
        8, 9, 6, 7, 10,   // Beacons
        159, 153, 86,  // WRECKS, UWTROC, OBSTRN
        74, 129,  // LNDMRK, SOUNDG
        22, 21, 98, 97,  // Cables/pipes
        43, 30,  // DEPCNT, COALNE
        112, 33, 83,  // RESARE, CTNARE, MIPARE
        2, 3, 79, 114,  // ACHARE, ACHBRT, MARCUL, SBDARE
        42, 71,  // DEPARE, LNDARE
      ]);
      const features = {
        features: (allFeatures?.features || []).filter((f: any) => {
          const objl = f.properties?.OBJL;
          return objl && nauticalOBJL.has(objl);
        })
      };
      const filterEnd = Date.now();
      console.log(`[PERF:MapPress] JS filter: ${filterEnd - filterStart}ms (${features.features.length} nautical features)`);
      
      if (features?.features?.length > 0) {
        // Find the best feature to display (prioritize point features and nautical data)
        // Uses O(1) Map lookup instead of O(n) indexOf
        const priorityStart = Date.now();
        let bestFeature = null;
        let bestPriority = -1;
        
        for (const feature of features.features) {
          const props = feature.properties || {};
          const objl = props.OBJL;
          
          // Skip if no OBJL (metadata features)
          if (!objl) continue;
          
          // Calculate priority using OBJL Map for O(1) lookup
          let priority = OBJL_PRIORITIES.get(objl) || 0;
          
          // Boost point features (more likely what user tapped on)
          if (feature.geometry?.type === 'Point') {
            priority += 50;
          }
          
          if (priority > bestPriority) {
            bestPriority = priority;
            bestFeature = feature;
          }
        }
        
        const priorityEnd = Date.now();
        console.log(`[PERF:MapPress] Priority sorting (${features.features.length} features): ${priorityEnd - priorityStart}ms`);
        
        if (bestFeature) {
          const props = bestFeature.properties || {};
          const layer = getLayerName(props);
          
          console.log(`[PERF:MapPress] Selected feature: ${layer} (OBJL: ${props.OBJL}, priority: ${bestPriority})`);
          
          const stateStart = Date.now();
          // Use startTransition to make this non-blocking - allows UI to stay responsive
          startTransition(() => {
            setSelectedFeature({
              type: LAYER_DISPLAY_NAMES[layer] || layer,
              properties: {
                ...props,
                _tapCoordinates: `${latitude.toFixed(5)}°, ${longitude.toFixed(5)}°`,
              },
            });
          });
          const stateEnd = Date.now();
          console.log(`[PERF:MapPress] setSelectedFeature (startTransition): ${stateEnd - stateStart}ms`);
        } else {
          console.log('[PERF:MapPress] No suitable feature found after priority filtering');
        }
      } else {
        console.log('[PERF:MapPress] No features found at tap location');
      }
    } catch (error) {
      console.log('[PERF:MapPress] Error querying features:', error);
    }
    
    const perfEnd = Date.now();
    console.log(`[PERF:MapPress] === TOTAL TIME: ${perfEnd - perfStart}ms ===`);
  }, [queryableLayerIds]);

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
    
    console.log('Could not calculate center, using default');
    return [-152, 61] as [number, number];
  }, [charts, mbtilesCharts]);

  // Memoize formatted feature properties to avoid recalculation on every render
  // NOTE: Must be before early returns to comply with Rules of Hooks
  const formattedFeatureProps = useMemo(() => {
    if (!selectedFeature) return null;
    const formatStart = Date.now();
    console.log(`[PERF:Format] Starting formatFeatureProperties for: ${selectedFeature.type}`);
    const result = formatFeatureProperties(selectedFeature);
    const formatEnd = Date.now();
    console.log(`[PERF:Format] formatFeatureProperties: ${formatEnd - formatStart}ms`);
    const entriesStart = Date.now();
    const entries = Object.entries(result);
    const entriesEnd = Date.now();
    console.log(`[PERF:Format] Object.entries (${entries.length} props): ${entriesEnd - entriesStart}ms`);
    console.log(`[PERF:Format] Total useMemo: ${entriesEnd - formatStart}ms`);
    // Log end-to-end time from tap to info box ready
    if (tapStartTimeRef.current > 0) {
      console.log(`[PERF:InfoBox] === TAP TO INFO BOX READY: ${entriesEnd - tapStartTimeRef.current}ms ===`);
    }
    return entries;
  }, [selectedFeature]);
  
  // Log when info box actually renders (after React commit phase)
  useEffect(() => {
    if (selectedFeature && tapStartTimeRef.current > 0) {
      const renderTime = Date.now() - tapStartTimeRef.current;
      console.log(`[PERF:InfoBox] === TAP TO RENDER COMPLETE: ${renderTime}ms ===`);
      tapStartTimeRef.current = 0; // Reset for next tap
    }
  }, [selectedFeature]);

  // === STYLE SWITCH: Additional Mapbox event handlers for detailed timing ===
  // NOTE: These must be BEFORE early returns to comply with Rules of Hooks
  const handleWillStartLoadingMap = useCallback(() => {
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      console.log(`[STYLE-SWITCH] onWillStartLoadingMap - elapsed: ${elapsed}ms`);
    }
  }, []);
  
  const handleDidFinishLoadingMap = useCallback(() => {
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      console.log(`[STYLE-SWITCH] onDidFinishLoadingMap - elapsed: ${elapsed}ms`);
    }
  }, []);
  
  const handleDidFailLoadingMap = useCallback((error: any) => {
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      console.log(`[STYLE-SWITCH] onDidFailLoadingMap - elapsed: ${elapsed}ms, error:`, error);
    }
  }, []);
  
  const handleDidFinishLoadingStyle = useCallback(() => {
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      console.log(`[STYLE-SWITCH] onDidFinishLoadingStyle - elapsed: ${elapsed}ms`);
      console.log(`[STYLE-SWITCH] Style "${styleSwitchToRef.current}" has finished loading`);
    }
  }, []);
  
  // Track first render frame after style switch
  const styleRenderFrameCountRef = useRef<number>(0);
  const handleDidFinishRenderingFrame = useCallback((state: any) => {
    if (styleSwitchStartRef.current > 0) {
      styleRenderFrameCountRef.current++;
      // Only log first few frames to avoid spam
      if (styleRenderFrameCountRef.current <= 3) {
        const elapsed = Date.now() - styleSwitchStartRef.current;
        const fullyRendered = state?.properties?.renderMode === 'full';
        console.log(`[STYLE-SWITCH] onDidFinishRenderingFrame #${styleRenderFrameCountRef.current} - elapsed: ${elapsed}ms, fullyRendered: ${fullyRendered}`);
      }
    }
  }, []);
  
  const handleDidFinishRenderingFrameFully = useCallback(() => {
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      console.log(`[STYLE-SWITCH] onDidFinishRenderingFrameFully - elapsed: ${elapsed}ms`);
      console.log(`[STYLE-SWITCH] Map fully rendered with new style`);
      // Reset frame counter
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
      <MapLibre.MapView
        ref={mapRef}
        style={styles.map}
        styleURL={typeof mapStyleUrls[mapStyle] === 'string' ? mapStyleUrls[mapStyle] : undefined}
        styleJSON={typeof mapStyleUrls[mapStyle] === 'object' ? JSON.stringify(mapStyleUrls[mapStyle]) : undefined}
        onMapIdle={handleMapIdle}
        onRegionDidChange={handleCameraChanged}
        onRegionIsChanging={handleCameraChanged}
        onPress={handleMapPress}
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
        scaleBarEnabled={true}
        scaleBarPosition={{ bottom: 16, right: 70 }}
        logoEnabled={false}
        attributionEnabled={false}
      >
        <MapLibre.Camera
          ref={cameraRef}
          defaultSettings={{
            zoomLevel: 8,  // Start at z8 where US1 overview charts are visible
            centerCoordinate: [-151.55, 59.64],  // HARDCODED: Homer, Alaska
          }}
          maxZoomLevel={effectiveMaxZoom}
          minZoomLevel={0}
        />

        <MapLibre.Images images={NAV_SYMBOLS} />

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
                  rasterOpacity: showBathymetry ? 0.7 : 0,
                }}
              />
            </MapLibre.RasterSource>
          );
        })}

        {/* Local Offline Basemap - OpenMapTiles vector tiles */}
        {/* PERF: Always mounted when available, visibility toggled for instant switching */}
        {tileServerReady && hasLocalBasemap && (() => {
          const basemapVisible = mapStyle === 'local' ? 'visible' : 'none';
          // === STYLE SWITCH: Log basemap visibility during render ===
          if (styleSwitchStartRef.current > 0) {
            const elapsed = Date.now() - styleSwitchStartRef.current;
            console.log(`[STYLE-SWITCH] Rendering local basemap with visibility="${basemapVisible}" - elapsed: ${elapsed}ms`);
          }
          return (
          <MapLibre.VectorSource
            id="local-basemap-source"
            tileUrlTemplates={[`${tileServer.getTileServerUrl()}/tiles/basemap_alaska/{z}/{x}/{y}.pbf`]}
            minZoomLevel={0}
            maxZoomLevel={14}
          >
            {/* === WATER (renders on top of tan background = land) === */}
            <MapLibre.FillLayer
              id="basemap-water"
              sourceLayerID="water"
              style={{
                fillColor: '#a0cfe8',
                fillOpacity: 1,
                visibility: basemapVisible,
              }}
            />
            
            {/* Rivers and streams */}
            <MapLibre.LineLayer
              id="basemap-waterway"
              sourceLayerID="waterway"
              style={{
                lineColor: '#a0cfe8',
                lineWidth: [
                  'interpolate', ['linear'], ['zoom'],
                  8, 0.5,
                  12, 1.5,
                  14, 3,
                ],
                visibility: basemapVisible,
              }}
            />
            
            {/* === LAND COVER === */}
            <MapLibre.FillLayer
              id="basemap-landcover-ice"
              sourceLayerID="landcover"
              filter={['==', ['get', 'class'], 'ice']}
              style={{
                fillColor: '#ffffff',
                fillOpacity: 0.9,
                visibility: basemapVisible,
              }}
            />
            <MapLibre.FillLayer
              id="basemap-landcover-grass"
              sourceLayerID="landcover"
              filter={['==', ['get', 'class'], 'grass']}
              style={{
                fillColor: '#d8e8c8',
                fillOpacity: 0.6,
                visibility: basemapVisible,
              }}
            />
            <MapLibre.FillLayer
              id="basemap-landcover-wood"
              sourceLayerID="landcover"
              filter={['any', ['==', ['get', 'class'], 'wood'], ['==', ['get', 'class'], 'forest']]}
              style={{
                fillColor: '#c5ddb0',
                fillOpacity: 0.6,
                visibility: basemapVisible,
              }}
            />
            <MapLibre.FillLayer
              id="basemap-landcover-wetland"
              sourceLayerID="landcover"
              filter={['==', ['get', 'class'], 'wetland']}
              style={{
                fillColor: '#d0e8d8',
                fillOpacity: 0.5,
                visibility: basemapVisible,
              }}
            />
            
            {/* === LAND USE === */}
            <MapLibre.FillLayer
              id="basemap-landuse-residential"
              sourceLayerID="landuse"
              filter={['==', ['get', 'class'], 'residential']}
              minZoomLevel={10}
              style={{
                fillColor: '#e8e0d8',
                fillOpacity: 0.5,
                visibility: basemapVisible,
              }}
            />
            <MapLibre.FillLayer
              id="basemap-landuse-industrial"
              sourceLayerID="landuse"
              filter={['any', ['==', ['get', 'class'], 'industrial'], ['==', ['get', 'class'], 'commercial']]}
              minZoomLevel={10}
              style={{
                fillColor: '#ddd8d0',
                fillOpacity: 0.4,
                visibility: basemapVisible,
              }}
            />
            
            {/* === PARKS & PROTECTED AREAS === */}
            <MapLibre.FillLayer
              id="basemap-park"
              sourceLayerID="park"
              style={{
                fillColor: '#c8e6c9',
                fillOpacity: 0.4,
                visibility: basemapVisible,
              }}
            />
            
            {/* === BUILDINGS (high zoom) === */}
            <MapLibre.FillLayer
              id="basemap-building"
              sourceLayerID="building"
              minZoomLevel={13}
              style={{
                fillColor: '#d9d0c9',
                fillOpacity: 0.8,
                visibility: basemapVisible,
              }}
            />
            
            {/* === BOUNDARIES === */}
            <MapLibre.LineLayer
              id="basemap-boundary-state"
              sourceLayerID="boundary"
              filter={['==', ['get', 'admin_level'], 4]}
              style={{
                lineColor: '#9e9cab',
                lineWidth: 1,
                lineDasharray: [3, 2],
                lineOpacity: 0.6,
                visibility: basemapVisible,
              }}
            />
            
            {/* === TRANSPORTATION === */}
            <MapLibre.LineLayer
              id="basemap-roads-motorway-casing"
              sourceLayerID="transportation"
              filter={['==', ['get', 'class'], 'motorway']}
              style={{
                lineColor: '#e07850',
                lineWidth: [
                  'interpolate', ['linear'], ['zoom'],
                  6, 1,
                  10, 3,
                  14, 6,
                ],
                visibility: basemapVisible,
              }}
            />
            <MapLibre.LineLayer
              id="basemap-roads-motorway"
              sourceLayerID="transportation"
              filter={['==', ['get', 'class'], 'motorway']}
              style={{
                lineColor: '#ffa060',
                lineWidth: [
                  'interpolate', ['linear'], ['zoom'],
                  6, 0.5,
                  10, 2,
                  14, 4,
                ],
                visibility: basemapVisible,
              }}
            />
            <MapLibre.LineLayer
              id="basemap-roads-trunk-casing"
              sourceLayerID="transportation"
              filter={['==', ['get', 'class'], 'trunk']}
              style={{
                lineColor: '#d09050',
                lineWidth: [
                  'interpolate', ['linear'], ['zoom'],
                  6, 0.8,
                  10, 2.5,
                  14, 5,
                ],
                visibility: basemapVisible,
              }}
            />
            <MapLibre.LineLayer
              id="basemap-roads-trunk"
              sourceLayerID="transportation"
              filter={['==', ['get', 'class'], 'trunk']}
              style={{
                lineColor: '#f9d29c',
                lineWidth: [
                  'interpolate', ['linear'], ['zoom'],
                  6, 0.4,
                  10, 1.5,
                  14, 3,
                ],
                visibility: basemapVisible,
              }}
            />
            <MapLibre.LineLayer
              id="basemap-roads-primary"
              sourceLayerID="transportation"
              filter={['==', ['get', 'class'], 'primary']}
              style={{
                lineColor: '#ffeebb',
                lineWidth: [
                  'interpolate', ['linear'], ['zoom'],
                  6, 0.3,
                  10, 1,
                  14, 2.5,
                ],
                visibility: basemapVisible,
              }}
            />
            <MapLibre.LineLayer
              id="basemap-roads-secondary"
              sourceLayerID="transportation"
              filter={['==', ['get', 'class'], 'secondary']}
              minZoomLevel={9}
              style={{
                lineColor: '#ffffff',
                lineWidth: [
                  'interpolate', ['linear'], ['zoom'],
                  9, 0.5,
                  14, 2,
                ],
                visibility: basemapVisible,
              }}
            />
            <MapLibre.LineLayer
              id="basemap-roads-tertiary"
              sourceLayerID="transportation"
              filter={['==', ['get', 'class'], 'tertiary']}
              minZoomLevel={11}
              style={{
                lineColor: '#ffffff',
                lineWidth: [
                  'interpolate', ['linear'], ['zoom'],
                  11, 0.4,
                  14, 1.5,
                ],
                visibility: basemapVisible,
              }}
            />
            <MapLibre.LineLayer
              id="basemap-roads-minor"
              sourceLayerID="transportation"
              filter={['any', ['==', ['get', 'class'], 'minor'], ['==', ['get', 'class'], 'service']]}
              minZoomLevel={13}
              style={{
                lineColor: '#ffffff',
                lineWidth: 1,
                lineOpacity: 0.8,
                visibility: basemapVisible,
              }}
            />
            
            {/* === AIRPORTS === */}
            <MapLibre.FillLayer
              id="basemap-aeroway-area"
              sourceLayerID="aeroway"
              filter={['==', ['geometry-type'], 'Polygon']}
              minZoomLevel={10}
              style={{
                fillColor: '#e0dce0',
                fillOpacity: 0.7,
                visibility: basemapVisible,
              }}
            />
            <MapLibre.LineLayer
              id="basemap-aeroway-runway"
              sourceLayerID="aeroway"
              filter={['==', ['get', 'class'], 'runway']}
              minZoomLevel={10}
              style={{
                lineColor: '#bdbdbd',
                lineWidth: [
                  'interpolate', ['linear'], ['zoom'],
                  10, 2,
                  14, 8,
                ],
                visibility: basemapVisible,
              }}
            />
            
            {/* === LABELS === */}
            <MapLibre.SymbolLayer
              id="basemap-place-city"
              sourceLayerID="place"
              filter={['==', ['get', 'class'], 'city']}
              style={{
                textField: ['get', 'name'],
                textSize: [
                  'interpolate', ['linear'], ['zoom'],
                  4, 12,
                  10, 20,
                ],
                textColor: '#333333',
                textHaloColor: '#ffffff',
                textHaloWidth: 2,
                textFont: ['Noto Sans Bold'],
                textTransform: 'uppercase',
                textLetterSpacing: 0.1,
                visibility: basemapVisible,
              }}
            />
            <MapLibre.SymbolLayer
              id="basemap-place-town"
              sourceLayerID="place"
              filter={['==', ['get', 'class'], 'town']}
              minZoomLevel={6}
              style={{
                textField: ['get', 'name'],
                textSize: [
                  'interpolate', ['linear'], ['zoom'],
                  6, 10,
                  12, 14,
                ],
                textColor: '#444444',
                textHaloColor: '#ffffff',
                textHaloWidth: 1.5,
                textFont: ['Noto Sans Bold'],
                visibility: basemapVisible,
              }}
            />
            <MapLibre.SymbolLayer
              id="basemap-place-village"
              sourceLayerID="place"
              filter={['==', ['get', 'class'], 'village']}
              minZoomLevel={9}
              style={{
                textField: ['get', 'name'],
                textSize: [
                  'interpolate', ['linear'], ['zoom'],
                  9, 9,
                  14, 12,
                ],
                textColor: '#555555',
                textHaloColor: '#ffffff',
                textHaloWidth: 1,
                textFont: ['Noto Sans Regular'],
                visibility: basemapVisible,
              }}
            />
            <MapLibre.SymbolLayer
              id="basemap-water-name"
              sourceLayerID="water_name"
              minZoomLevel={8}
              style={{
                textField: ['get', 'name'],
                textSize: 11,
                textColor: '#5d8cae',
                textHaloColor: '#ffffff',
                textHaloWidth: 1,
                textFont: ['Noto Sans Italic'],
                visibility: basemapVisible,
              }}
            />
            <MapLibre.SymbolLayer
              id="basemap-road-label"
              sourceLayerID="transportation_name"
              minZoomLevel={12}
              style={{
                textField: ['get', 'name'],
                textSize: 10,
                symbolPlacement: 'line',
                textColor: '#555555',
                textHaloColor: '#ffffff',
                textHaloWidth: 1,
                textFont: ['Noto Sans Regular'],
                visibility: basemapVisible,
              }}
            />
          </MapLibre.VectorSource>
          );
        })()}

        {/* ================================================================== */}
        {/* COMPOSITE TILE MODE - Single VectorSource with server-side quilting */}
        {/* Uses ~20 layers instead of 3000+ for massive performance improvement */}
        {/* Requires mbtiles converted with sourceLayerID="charts" */}
        {/* ================================================================== */}
        {useMBTiles && tileServerReady && useCompositeTiles && (() => {
          // Use direct tile URL template instead of TileJSON
          const tileUrl = `${tileServer.getTileServerUrl()}/tiles/{z}/{x}/{y}.pbf`;
          console.log('[COMPOSITE] ═══════════════════════════════════════════');
          console.log('[COMPOSITE] VectorSource RENDERING');
          console.log('[COMPOSITE] useMBTiles:', useMBTiles);
          console.log('[COMPOSITE] tileServerReady:', tileServerReady);
          console.log('[COMPOSITE] useCompositeTiles:', useCompositeTiles);
          console.log('[COMPOSITE] Tile URL:', tileUrl);
          console.log('[COMPOSITE] ═══════════════════════════════════════════');
          return (
          <MapLibre.VectorSource
            key="composite-charts"
            id="composite-charts"
            tileUrlTemplates={[tileUrl]}
            minZoomLevel={0}
            maxZoomLevel={18}
            onPress={(e) => {
              console.log('[COMPOSITE] Source press - processing features...');
              const features = e.features || [];
              console.log(`[COMPOSITE] Found ${features.length} features at tap`);
              
              if (features.length === 0) return;
              
              // Find best feature using OBJL-based priorities
              let bestFeature = null;
              let bestPriority = -1;
              
              for (const feature of features) {
                const objl = feature.properties?.OBJL;
                if (!objl) continue;
                
                let priority = OBJL_PRIORITIES.get(objl) || 0;
                
                // Boost point features
                if (feature.geometry?.type === 'Point') {
                  priority += 50;
                }
                
                const layerName = getLayerName(feature.properties);
                console.log(`[COMPOSITE]   ${layerName} (OBJL ${objl}): priority=${priority}`);
                
                if (priority > bestPriority) {
                  bestPriority = priority;
                  bestFeature = feature;
                }
              }
              
              if (bestFeature) {
                const layer = getLayerName(bestFeature.properties);
                console.log(`[COMPOSITE] Selected: ${layer} (OBJL ${bestFeature.properties?.OBJL}, priority ${bestPriority})`);
                
                setSelectedFeature({
                  type: LAYER_DISPLAY_NAMES[layer] || layer,
                  properties: {
                    ...bestFeature.properties,
                    _tapCoordinates: `${e.coordinates?.latitude?.toFixed(5) || '?'}°, ${e.coordinates?.longitude?.toFixed(5) || '?'}°`,
                  },
                });
              }
            }}
            // @ts-ignore - undocumented but useful for debugging
            onMapboxError={(e: any) => console.error('[COMPOSITE] VectorSource error:', e)}
          >
            {/* DEPARE - Depth Areas */}
            <MapLibre.FillLayer
              id="composite-depare"
              sourceLayerID="charts"
              minZoomLevel={0}
              filter={['==', ['get', 'OBJL'], 42]}
              style={{
                fillColor: [
                  'step',
                  ['coalesce', ['get', 'DRVAL1'], 0],
                  '#C8D6A3', 0,    // Drying/negative depth - greenish
                  '#B5E3F0', 2,    // 0-2m - very light blue
                  '#9DD5E8', 5,    // 2-5m - light blue
                  '#7EC8E3', 10,   // 5-10m - medium light blue
                  '#5BB4D6', 20,   // 10-20m - medium blue
                  '#3A9FC9', 50,   // 20-50m - darker blue
                  '#2185B5',       // 50m+ - deep blue
                ],
                fillOpacity: mapStyle === 'satellite' ? 0.6 : 1.0,
                visibility: showDepthAreas ? 'visible' : 'none',
              }}
            />
            
            {/* DRGARE - Dredged Areas */}
            <MapLibre.FillLayer
              id="composite-drgare"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 46]}
              style={{
                fillColor: '#87CEEB',
                fillOpacity: 0.4,
              }}
            />
            
            {/* FAIRWY - Fairways */}
            <MapLibre.FillLayer
              id="composite-fairwy"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 57]}
              style={{
                fillColor: '#E6E6FA',
                fillOpacity: 0.3,
              }}
            />
            
            {/* LNDARE - Land Areas */}
            <MapLibre.FillLayer
              id="composite-lndare"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 71]}
              style={{
                fillColor: '#F5DEB3',
                fillOpacity: mapStyle === 'satellite' ? 0.3 : 1,
                visibility: showLand ? 'visible' : 'none',
              }}
            />
            
            {/* CBLARE - Cable Areas */}
            <MapLibre.FillLayer
              id="composite-cblare"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 21]}
              style={{
                fillColor: '#800080',
                fillOpacity: 0.15,
                visibility: showCables ? 'visible' : 'none',
              }}
            />
            
            {/* PIPARE - Pipeline Areas */}
            <MapLibre.FillLayer
              id="composite-pipare"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 97]}
              style={{
                fillColor: '#008000',
                fillOpacity: 0.15,
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
                fillOpacity: 0.2,
                visibility: showRestrictedAreas ? 'visible' : 'none',
              }}
            />
            
            {/* CTNARE - Caution Areas */}
            <MapLibre.FillLayer
              id="composite-ctnare"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 33]}
              style={{
                fillColor: '#FFD700',
                fillOpacity: 0.2,
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
                fillOpacity: 0.15,
                visibility: showMilitaryAreas ? 'visible' : 'none',
              }}
            />
            
            {/* ACHARE - Anchorage Areas */}
            <MapLibre.FillLayer
              id="composite-achare"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 2]}
              style={{
                fillColor: '#4169E1',
                fillOpacity: 0.15,
                visibility: showAnchorages ? 'visible' : 'none',
              }}
            />
            
            {/* MARCUL - Marine Farms */}
            <MapLibre.FillLayer
              id="composite-marcul"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 79]}
              style={{
                fillColor: '#228B22',
                fillOpacity: 0.2,
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
            
            {/* BRIDGE - Bridges (line) */}
            <MapLibre.LineLayer
              id="composite-bridge"
              sourceLayerID="charts"
              filter={['all',
                ['==', ['get', 'OBJL'], 12],
                ['==', ['geometry-type'], 'LineString']
              ]}
              style={{
                lineColor: '#696969',
                lineWidth: 3,
                visibility: showBridges ? 'visible' : 'none',
              }}
            />
            
            {/* BRIDGE - Bridges (polygon fill) */}
            <MapLibre.FillLayer
              id="composite-bridge-fill"
              sourceLayerID="charts"
              filter={['all',
                ['==', ['get', 'OBJL'], 12],
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
              filter={['==', ['get', 'OBJL'], 20]}
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
              filter={['all',
                ['==', ['get', 'OBJL'], 84],
                ['==', ['geometry-type'], 'Point']
              ]}
              style={{
                iconImage: 'mooring-buoy',
                iconSize: 0.6,
                iconAllowOverlap: true,
                visibility: showMoorings ? 'visible' : 'none',
              }}
            />
            
            {/* MORFAC - Mooring Facilities (line - dolphins, piers) */}
            <MapLibre.LineLayer
              id="composite-morfac-line"
              sourceLayerID="charts"
              filter={['all',
                ['==', ['get', 'OBJL'], 84],
                ['==', ['geometry-type'], 'LineString']
              ]}
              style={{
                lineColor: '#4B0082',
                lineWidth: 2,
                visibility: showMoorings ? 'visible' : 'none',
              }}
            />
            
            {/* SLCONS - Shoreline Construction (seawalls, breakwaters, etc) */}
            <MapLibre.LineLayer
              id="composite-slcons"
              sourceLayerID="charts"
              filter={['all',
                ['==', ['get', 'OBJL'], 122],
                ['==', ['geometry-type'], 'LineString']
              ]}
              style={{
                lineColor: '#4A4A4A',
                lineWidth: 2,
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
            
            {/* DEPCNT - Depth Contours */}
            <MapLibre.LineLayer
              id="composite-depcnt"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 43]}
              style={{
                lineColor: '#4A90D9',
                lineWidth: ['interpolate', ['linear'], ['zoom'], 8, 0.3, 12, 0.7, 16, 1.0],
                lineOpacity: 0.7,
                visibility: showDepthContours ? 'visible' : 'none',
              }}
            />
            
            {/* COALNE - Coastline */}
            <MapLibre.LineLayer
              id="composite-coalne"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 30]}
              style={{
                lineColor: '#8B4513',
                lineWidth: ['interpolate', ['linear'], ['zoom'], 8, 0.5, 12, 1.0, 16, 1.5],
              }}
            />
            
            {/* CBLSUB/CBLOHD - Cables */}
            <MapLibre.LineLayer
              id="composite-cables"
              sourceLayerID="charts"
              filter={['any',
                ['==', ['get', 'OBJL'], 22],
                ['==', ['get', 'OBJL'], 23]
              ]}
              style={{
                lineColor: '#800080',
                lineWidth: 1.5,
                lineDasharray: [3, 2],
                visibility: showCables ? 'visible' : 'none',
              }}
            />
            
            {/* PIPSOL - Pipelines */}
            {/* PIPSOL - Pipeline (OBJL 94, not 98 as some docs suggest) */}
            <MapLibre.LineLayer
              id="composite-pipsol"
              sourceLayerID="charts"
              filter={['in', ['get', 'OBJL'], ['literal', [94, 98]]]}
              style={{
                lineColor: '#008000',
                lineWidth: 2,
                lineDasharray: [5, 3],
                visibility: showPipelines ? 'visible' : 'none',
              }}
            />
            
            {/* SOUNDG - Soundings */}
            {/* SCAMIN varies wildly: overview ~3M, regionals 30K-500K */}
            {/* Just show all soundings at z8+ since density is handled by textAllowOverlap */}
            <MapLibre.SymbolLayer
              id="composite-soundg"
              sourceLayerID="charts"
              minZoomLevel={8}
              filter={['all',
                ['==', ['get', 'OBJL'], 129],
                ['==', ['geometry-type'], 'Point'],
                ['has', 'SCAMIN']  // Only require SCAMIN exists (filters bad data)
              ]}
              style={{
                textField: ['to-string', ['round', ['get', 'DEPTH']]],
                textSize: ['interpolate', ['linear'], ['zoom'], 
                  6, 7,      // Small at z6
                  8, 7,      // Keep small at z8
                  10, 8,     // Still small at z10
                  11, 9,     // Start growing at z11
                  14, 11,    // Larger at z14
                  18, 14     // Full size at z18
                ],
                textColor: '#000080',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1,
                textAllowOverlap: false,  // Key: Mapbox auto-thins at low zoom
                symbolSpacing: ['interpolate', ['linear'], ['zoom'],
                  6, 120,    // Sparse at z6
                  7, 120,    // Sparse at z7
                  8, 250,    // Very sparse at z8
                  9, 250,    // Very sparse at z9
                  10, 250,   // Very sparse at z10
                  11, 50,    // Tighter at z11
                  14, 20     // Dense at z14
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
                iconSize: ['interpolate', ['linear'], ['zoom'], 8, 0.25, 12, 0.4, 16, 0.6],
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
                iconSize: ['interpolate', ['linear'], ['zoom'], 8, 0.3, 12, 0.5, 16, 0.7],
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
                iconSize: ['interpolate', ['linear'], ['zoom'], 8, 0.25, 12, 0.4, 16, 0.6],
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
                iconSize: ['interpolate', ['linear'], ['zoom'], 8, 0.15, 10, 0.2, 12, 0.3, 16, 0.5],
                iconAllowOverlap: true,
                visibility: showHazards ? 'visible' : 'none',
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
                ['==', ['get', 'OBJL'], 15],
                ['==', ['get', 'OBJL'], 16]
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
                iconSize: ['interpolate', ['linear'], ['zoom'], 8, 0.25, 12, 0.4, 16, 0.6],
                iconAllowOverlap: true,
                visibility: showBuoys ? 'visible' : 'none',
              }}
            />
            
            {/* Beacons - BCNLAT, BCNCAR, etc. */}
            <MapLibre.SymbolLayer
              id="composite-beacons"
              sourceLayerID="charts"
              filter={['any',
                ['==', ['get', 'OBJL'], 8],
                ['==', ['get', 'OBJL'], 6],
                ['==', ['get', 'OBJL'], 10],
                ['==', ['get', 'OBJL'], 9],
                ['==', ['get', 'OBJL'], 7]
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
                iconSize: ['interpolate', ['linear'], ['zoom'], 8, 0.3, 12, 0.5, 16, 0.7],
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
                iconSize: ['interpolate', ['linear'], ['zoom'], 8, 0.3, 12, 0.5, 16, 0.8],
                iconRotate: ['coalesce', ['get', '_ORIENT'], 135],
                iconRotationAlignment: 'map',
                iconAnchor: 'bottom',
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
                visibility: showLights ? 'visible' : 'none',
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
                iconSize: ['interpolate', ['linear'], ['zoom'], 8, 0.25, 12, 0.45, 16, 0.7],
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
            
            {/* ACHBRT - Anchor Berths (specific anchorage positions) */}
            <MapLibre.SymbolLayer
              id="composite-achbrt"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 3]}
              style={{
                iconImage: 'anchor',
                iconSize: ['interpolate', ['linear'], ['zoom'], 4, 0.2, 8, 0.3, 12, 0.5, 16, 0.7],
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
            
            {/* CBLSUB - Submarine Cables (separate from combined cables layer) */}
            <MapLibre.LineLayer
              id="composite-cblsub"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 22]}
              style={{
                lineColor: '#800080',
                lineWidth: 2,
                lineDasharray: [4, 2],
                lineCap: 'round',
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
                textSize: 10,
                textColor: '#1E3A5F',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1.5,
                symbolPlacement: 'line',
                symbolSpacing: 300,
                textFont: ['Noto Sans Regular'],
                textMaxAngle: 30,
                textAllowOverlap: false,
                visibility: showDepthContours ? 'visible' : 'none',
              }}
            />
            
            {/* === OUTLINE LAYERS === */}
            
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
              filter={['==', ['get', 'OBJL'], 57]}
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
              filter={['==', ['get', 'OBJL'], 21]}
              style={{
                lineColor: '#800080',
                lineWidth: 1.5,
                lineDasharray: [4, 2],
                visibility: showCables ? 'visible' : 'none',
              }}
            />
            
            {/* PIPARE outline */}
            <MapLibre.LineLayer
              id="composite-pipare-outline"
              sourceLayerID="charts"
              filter={['==', ['get', 'OBJL'], 97]}
              style={{
                lineColor: '#008000',
                lineWidth: 1.5,
                lineDasharray: [6, 3],
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
              filter={['==', ['get', 'OBJL'], 33]}
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
              filter={['==', ['get', 'OBJL'], 2]}
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
              filter={['==', ['get', 'OBJL'], 79]}
              style={{
                lineColor: '#8B4513',
                lineWidth: 2,
                lineDasharray: [4, 2],
                visibility: showMarineFarms ? 'visible' : 'none',
              }}
            />
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

        {/* GNIS Place Names Layer - Reference data from USGS */}
        {/* IMPORTANT: maxZoomLevel must match tippecanoe --maximum-zoom (14) */}
        {/* to prevent overzoom rendering issues */}
        {/* NOTE: These layers use aboveLayerID to ensure they appear above all chart content */}
        {tileServerReady && gnisAvailable && showPlaceNames && (
          <MapLibre.VectorSource
            id="gnis-names-source"
            tileUrlTemplates={[`${tileServer.getTileServerUrl()}/tiles/gnis_names_ak/{z}/{x}/{y}.pbf`]}
            maxZoomLevel={14}
          >
            {/* Water features - Bays, channels, sounds (highest priority) */}
            {/* textAllowOverlap: true ensures GNIS shows regardless of chart symbols */}
            <MapLibre.SymbolLayer
              id="gnis-water-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'water']}
              minZoomLevel={6}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Regular'],
                textSize: [
                  'interpolate', ['linear'], ['zoom'],
                  6, 9,
                  7, 10,
                  10, 12,
                  14, 14,
                ],
                textColor: '#0066CC',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 2,
                textAllowOverlap: false,  // Declutter - don't overlap other labels
                textIgnorePlacement: false, // Reserve space so other GNIS categories don't overlap
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 10,
                symbolSortKey: ['get', 'PRIORITY'],  // Use GNIS priority field
                visibility: showWaterNames ? 'visible' : 'none',
              }}
            />
            
            {/* Coastal features - Capes, islands, beaches, rocks, reefs */}
            <MapLibre.SymbolLayer
              id="gnis-coastal-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'coastal']}
              minZoomLevel={6}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Regular'],
                textSize: [
                  'interpolate', ['linear'], ['zoom'],
                  6, 8,
                  7, 9,
                  10, 11,
                  14, 13,
                ],
                textColor: '#996633',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 2,
                textAllowOverlap: false,  // Declutter - don't overlap other labels
                textIgnorePlacement: false, // Reserve space so other GNIS categories don't overlap
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 10,
                symbolSortKey: ['get', 'PRIORITY'],
                visibility: showCoastalNames ? 'visible' : 'none',
              }}
            />
            
            {/* Landmark features - Summits, glaciers, cliffs */}
            <MapLibre.SymbolLayer
              id="gnis-landmark-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'landmark']}
              minZoomLevel={8}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Italic'],
                textSize: [
                  'interpolate', ['linear'], ['zoom'],
                  8, 8,
                  9, 9,
                  14, 12,
                ],
                textColor: '#666666',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 2,
                textAllowOverlap: false,  // Declutter - don't overlap other labels
                textIgnorePlacement: false, // Reserve space so other GNIS categories don't overlap
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 10,
                symbolSortKey: ['get', 'PRIORITY'],
                visibility: showLandmarkNames ? 'visible' : 'none',
              }}
            />
            
            {/* Populated places - Towns, ports */}
            <MapLibre.SymbolLayer
              id="gnis-populated-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'populated']}
              minZoomLevel={6}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Bold'],
                textSize: [
                  'interpolate', ['linear'], ['zoom'],
                  6, 9,
                  7, 10,
                  10, 12,
                  14, 14,
                ],
                textColor: '#CC0000',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 2,
                textAllowOverlap: false,  // Declutter - don't overlap other labels
                textIgnorePlacement: false, // Reserve space so other GNIS categories don't overlap
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 10,
                symbolSortKey: ['get', 'PRIORITY'],
                visibility: showPopulatedNames ? 'visible' : 'none',
              }}
            />
            
            {/* Stream names - Rivers, creeks (off by default) */}
            <MapLibre.SymbolLayer
              id="gnis-stream-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'stream']}
              minZoomLevel={9}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Italic'],
                textSize: [
                  'interpolate', ['linear'], ['zoom'],
                  9, 8,
                  10, 8,
                  14, 10,
                ],
                textColor: '#3399FF',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1.5,
                textAllowOverlap: false,  // Declutter - don't overlap other labels
                textIgnorePlacement: false, // Reserve space so other GNIS categories don't overlap
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 10,
                symbolSortKey: ['get', 'PRIORITY'],
                visibility: showStreamNames ? 'visible' : 'none',
              }}
            />
            
            {/* Lake names (off by default) */}
            <MapLibre.SymbolLayer
              id="gnis-lake-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'lake']}
              minZoomLevel={9}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Italic'],
                textSize: [
                  'interpolate', ['linear'], ['zoom'],
                  9, 8,
                  10, 8,
                  14, 10,
                ],
                textColor: '#66CCFF',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1.5,
                textAllowOverlap: false,  // Declutter - don't overlap other labels
                textIgnorePlacement: false, // Reserve space so other GNIS categories don't overlap
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 10,
                symbolSortKey: ['get', 'PRIORITY'],
                visibility: showLakeNames ? 'visible' : 'none',
              }}
            />
            
            {/* Terrain features - Valleys, basins (off by default) */}
            <MapLibre.SymbolLayer
              id="gnis-terrain-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'terrain']}
              minZoomLevel={10}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Regular'],
                textSize: [
                  'interpolate', ['linear'], ['zoom'],
                  10, 8,
                  11, 8,
                  14, 10,
                ],
                textColor: '#999966',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1.5,
                textAllowOverlap: false,  // Declutter - don't overlap other labels
                textIgnorePlacement: false, // Reserve space so other GNIS categories don't overlap
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 10,
                symbolSortKey: ['get', 'PRIORITY'],
                visibility: showTerrainNames ? 'visible' : 'none',
              }}
            />
          </MapLibre.VectorSource>
        )}

        {/* GPS Ship Position Marker */}
        {(showGPSPanel || showCompass) && gpsData.latitude !== null && gpsData.longitude !== null && (
          <MapLibre.PointAnnotation
            id="gps-ship-position"
            coordinate={[gpsData.longitude, gpsData.latitude]}
          >
            <View style={styles.shipMarker}>
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
              {/* Accuracy circle indicator */}
              {gpsData.accuracy !== null && gpsData.accuracy > 10 && (
                <View style={[
                  styles.accuracyRing,
                  { 
                    width: Math.min(gpsData.accuracy * 2, 100),
                    height: Math.min(gpsData.accuracy * 2, 100),
                    borderRadius: Math.min(gpsData.accuracy, 50),
                  }
                ]} />
              )}
            </View>
          </MapLibre.PointAnnotation>
        )}

      </MapLibre.MapView>

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
        {/* Layers button */}
        <TouchableOpacity 
          style={[styles.topMenuBtn, showControls && styles.topMenuBtnActive]}
          onPress={() => setShowControls(!showControls)}
        >
          <View style={styles.layerStackIcon}>
            <View style={[styles.layerStackLine, { top: 0, left: 0 }]} />
            <View style={[styles.layerStackLine, { top: 7, left: 2 }]} />
            <View style={[styles.layerStackLine, { top: 14, left: 4 }]} />
          </View>
        </TouchableOpacity>
        <View style={styles.topMenuDivider} />
        
        {/* Compass button */}
        <TouchableOpacity 
          style={[styles.topMenuBtn, showCompass && styles.topMenuBtnActive]}
          onPress={() => setShowCompass(!showCompass)}
        >
          <Text style={styles.topMenuBtnText}>🧭</Text>
        </TouchableOpacity>
        <View style={styles.topMenuDivider} />
        
        {/* Telemetry button */}
        <TouchableOpacity 
          style={[styles.topMenuBtn, showGPSPanel && styles.topMenuBtnActive]}
          onPress={() => setShowGPSPanel(!showGPSPanel)}
        >
          <Text style={styles.topMenuBtnText}>⏱</Text>
        </TouchableOpacity>
        <View style={styles.topMenuDivider} />
        
        {/* GPS Coordinates toggle */}
        <TouchableOpacity 
          style={[styles.topMenuBtn, showCoords && styles.topMenuBtnActive]}
          onPress={() => setShowCoords(!showCoords)}
        >
          <Text style={styles.topMenuBtnText}>🌐</Text>
        </TouchableOpacity>
        <View style={styles.topMenuDivider} />
        
        {/* Zoom Level toggle */}
        <TouchableOpacity 
          style={[styles.topMenuBtn, showZoomLevel && styles.topMenuBtnActive]}
          onPress={() => setShowZoomLevel(!showZoomLevel)}
        >
          <Text style={[styles.topMenuBtnText, { fontSize: 18, fontWeight: '700' }]}>N°</Text>
        </TouchableOpacity>
        <View style={styles.topMenuDivider} />
        
        {/* Chart Info toggle */}
        <TouchableOpacity 
          style={[styles.topMenuBtn, showChartDebug && styles.topMenuBtnActive]}
          onPress={() => setShowChartDebug(!showChartDebug)}
        >
          <Text style={styles.topMenuBtnText}>#</Text>
        </TouchableOpacity>
        <View style={styles.topMenuDivider} />
        
        {/* Scan Files button */}
        <TouchableOpacity 
          style={styles.topMenuBtn}
          onPress={debugScanFiles}
        >
          <Text style={styles.topMenuBtnText}>📂</Text>
        </TouchableOpacity>
      </View>
      
      {/* Center on location button - upper right (same style as other controls) */}
      <View style={[styles.centerBtnContainer, { top: insets.top + 8, right: 12 }]}>
        <TouchableOpacity 
          style={[styles.topMenuBtn, followGPS && styles.topMenuBtnActive]}
          onPress={() => {
            if (gpsData.latitude !== null && gpsData.longitude !== null) {
              cameraRef.current?.setCamera({
                centerCoordinate: [gpsData.longitude, gpsData.latitude],
                animationDuration: 500,
              });
            }
            setFollowGPS(!followGPS);
            if (!showGPSPanel && !showCompass) {
              startTracking();
            }
          }}
        >
          <Text style={styles.centerBtnText}>⌖</Text>
        </TouchableOpacity>
      </View>

      {/* Quick Toggles Strip - bottom left of map (minimalist style) */}
      <View style={[styles.quickTogglesStrip, { bottom: showGPSPanel ? 210 : 90 }]}>
        {/* Layer toggles first */}
        <TouchableOpacity 
          style={[styles.quickToggleBtn, showDepthAreas && styles.quickToggleBtnActive]}
          onPress={() => toggleLayer('depthAreas')}
        >
          <Text style={styles.quickToggleBtnText}>DEP</Text>
        </TouchableOpacity>
        <View style={styles.quickToggleDivider} />
        <TouchableOpacity 
          style={[styles.quickToggleBtn, showDepthContours && styles.quickToggleBtnActive]}
          onPress={() => toggleLayer('depthContours')}
        >
          <Text style={styles.quickToggleBtnText}>CNT</Text>
        </TouchableOpacity>
        <View style={styles.quickToggleDivider} />
        <TouchableOpacity 
          style={[styles.quickToggleBtn, showSoundings && styles.quickToggleBtnActive]}
          onPress={() => toggleLayer('soundings')}
        >
          <Text style={styles.quickToggleBtnText}>SND</Text>
        </TouchableOpacity>
        <View style={styles.quickToggleDivider} />
        <TouchableOpacity 
          style={[styles.quickToggleBtn, showLights && styles.quickToggleBtnActive]}
          onPress={() => toggleLayer('lights')}
        >
          <Text style={styles.quickToggleBtnText}>LTS</Text>
        </TouchableOpacity>
        <View style={styles.quickToggleDivider} />
        <TouchableOpacity 
          style={[styles.quickToggleBtn, showSectors && styles.quickToggleBtnActive]}
          onPress={() => toggleLayer('sectors')}
        >
          <Text style={styles.quickToggleBtnText}>SEC</Text>
        </TouchableOpacity>
        <View style={styles.quickToggleDivider} />
        <TouchableOpacity 
          style={[styles.quickToggleBtn, showSeabed && styles.quickToggleBtnActive]}
          onPress={() => toggleLayer('seabed')}
        >
          <Text style={styles.quickToggleBtnText}>SBD</Text>
        </TouchableOpacity>
        
        {/* Detail level toggle */}
        <View style={styles.quickToggleDividerThick} />
        <TouchableOpacity 
          style={[styles.quickToggleBtn, styles.quickToggleBtnActive]}
          onPress={cycleDetailLevel}
        >
          <Text style={[styles.quickToggleBtnText, { fontWeight: '700' }]}>
            {detailLevel === 'low' ? 'L' : detailLevel === 'medium' ? 'M' : 'H'}
          </Text>
        </TouchableOpacity>
        
        {/* Zoom controls */}
        <View style={styles.quickToggleDividerThick} />
        <TouchableOpacity 
          style={styles.quickToggleBtn}
          onPress={() => {
            const newZoom = Math.min(currentZoom + 0.25, effectiveMaxZoom);
            cameraRef.current?.setCamera({ zoomLevel: newZoom, animationDuration: 200 });
          }}
        >
          <Text style={[styles.quickToggleBtnText, styles.quickToggleBtnTextLarge]}>+</Text>
        </TouchableOpacity>
        <View style={styles.quickToggleDivider} />
        <TouchableOpacity 
          style={styles.quickToggleBtn}
          onPress={() => {
            const newZoom = Math.max(currentZoom - 0.25, 0);
            cameraRef.current?.setCamera({ zoomLevel: newZoom, animationDuration: 200 });
          }}
        >
          <Text style={[styles.quickToggleBtnText, styles.quickToggleBtnTextLarge]}>−</Text>
        </TouchableOpacity>
      </View>


      {/* Chart Debug Overlay - Shows active chart based on zoom, right of lat/long */}
      <ChartDebugOverlay
        visible={showChartDebug}
        currentZoom={currentZoom}
        centerCoord={centerCoord}
        mbtilesCharts={mbtilesCharts}
        tileServerReady={tileServerReady}
        topOffset={insets.top + 52}
        leftOffset={showCoords ? 200 : 12}
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
                console.log('=== CLEAR CACHE & RELOAD ===');
                // Stop tile server (closes all database connections)
                console.log('Stopping tile server...');
                await tileServer.stopTileServer();
                // Clear all chart state
                console.log('Clearing state...');
                setMbtilesCharts([]);
                setChartsToRender([]);
                setLoadingPhase('us1');
                setRasterCharts([]);
                setCharts([]);
                setGnisAvailable(false);
                setHasLocalBasemap(false);
                setTileServerReady(false);
                // Increment cache buster to force Mapbox to re-fetch tiles
                setCacheBuster(prev => prev + 1);
                // Small delay to ensure cleanup
                console.log('Waiting for cleanup...');
                await new Promise(r => setTimeout(r, 500));
                // Reload everything fresh
                console.log('Reloading charts...');
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

      {/* Coordinates - under top menu bar (upper left) */}
      {showCoords && (
        <View style={[styles.coordBadge, { top: insets.top + 52, left: 12 }]}>
          <Text style={styles.coordText}>
            {Math.abs(centerCoord[1]).toFixed(4)}°{centerCoord[1] >= 0 ? 'N' : 'S'}{' '}
            {Math.abs(centerCoord[0]).toFixed(4)}°{centerCoord[0] >= 0 ? 'E' : 'W'}
          </Text>
        </View>
      )}
      {/* Zoom indicator - under center button (upper right) */}
      {showZoomLevel && (
        <View style={[styles.zoomBadge, { top: insets.top + 52, right: 12 }, isAtMaxZoom && styles.zoomBadgeAtMax]}>
          <Text style={[styles.zoomText, isAtMaxZoom && styles.zoomTextAtMax]}>
            {currentZoom.toFixed(1)}x{isAtMaxZoom ? ' MAX' : ''}
          </Text>
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

      {/* Layer Controls - ForeFlight style two-column dark translucent panel */}
      {showControls && (
        <View style={[styles.ffLayersPanel, { top: insets.top + 56 }]}>
          <View style={styles.ffLayersPanelHeader}>
            <Text style={styles.ffLayersPanelTitle}>Map Layers</Text>
            <TouchableOpacity onPress={() => setShowControls(false)}>
              <Text style={styles.ffLayersPanelClose}>✕</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.ffLayersColumns}>
            {/* Left Column - Basemap */}
            <View style={styles.ffLayersColumnLeft}>
              <Text style={styles.ffLayersSectionTitle}>Base Map</Text>
              <TouchableOpacity
                style={[styles.ffLayerOption, mapStyle === 'light' && styles.ffLayerOptionActive]}
                onPress={() => setMapStyle('light')}
              >
                <Text style={[styles.ffLayerOptionText, mapStyle === 'light' && styles.ffLayerOptionTextActive]}>Light</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.ffLayerOption, mapStyle === 'dark' && styles.ffLayerOptionActive]}
                onPress={() => setMapStyle('dark')}
              >
                <Text style={[styles.ffLayerOptionText, mapStyle === 'dark' && styles.ffLayerOptionTextActive]}>Dark</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.ffLayerOption, mapStyle === 'satellite' && styles.ffLayerOptionActive]}
                onPress={() => setMapStyle('satellite')}
              >
                <Text style={[styles.ffLayerOptionText, mapStyle === 'satellite' && styles.ffLayerOptionTextActive]}>Satellite</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.ffLayerOption, mapStyle === 'outdoors' && styles.ffLayerOptionActive]}
                onPress={() => setMapStyle('outdoors')}
              >
                <Text style={[styles.ffLayerOptionText, mapStyle === 'outdoors' && styles.ffLayerOptionTextActive]}>Outdoors</Text>
              </TouchableOpacity>
              {hasLocalBasemap && (
                <TouchableOpacity
                  style={[styles.ffLayerOption, mapStyle === 'local' && styles.ffLayerOptionActive]}
                  onPress={() => setMapStyle('local')}
                >
                  <Text style={[styles.ffLayerOptionText, mapStyle === 'local' && styles.ffLayerOptionTextActive]}>Offline</Text>
                </TouchableOpacity>
              )}
              
              {/* Chart Info (moved from debug button) */}
              <View style={styles.ffLayersDivider} />
              <Text style={styles.ffLayersSectionTitle}>Chart Info</Text>
              <TouchableOpacity
                style={[styles.ffLayerOption, showChartDebug && styles.ffLayerOptionActive]}
                onPress={() => setShowChartDebug(!showChartDebug)}
              >
                <Text style={[styles.ffLayerOptionText, showChartDebug && styles.ffLayerOptionTextActive]}>Show Active Chart</Text>
              </TouchableOpacity>
            </View>
            
            {/* Right Column - Data Sources & Layers */}
            <ScrollView style={styles.ffLayersColumnRight}>
              <Text style={styles.ffLayersSectionTitle}>Data Sources</Text>
              <FFToggle label={`ENC Charts (${allChartsToRender.length})`} value={useMBTiles} onToggle={setUseMBTiles} />
              {rasterCharts.length > 0 && (
                <FFToggle label={`Bathymetry (${rasterCharts.length})`} value={showBathymetry} onToggle={() => toggleLayer('bathymetry')} />
              )}
              
              {/* GNIS Place Names */}
              {gnisAvailable && (
                <>
                  <View style={styles.ffLayersDivider} />
                  <Text style={styles.ffLayersSectionTitle}>Place Names</Text>
                  <FFToggle label="Show Names" value={showPlaceNames} onToggle={setShowPlaceNames} />
                  {showPlaceNames && (
                    <>
                      <FFToggle label="Water" value={showWaterNames} onToggle={setShowWaterNames} indent />
                      <FFToggle label="Coastal" value={showCoastalNames} onToggle={setShowCoastalNames} indent />
                      <FFToggle label="Landmarks" value={showLandmarkNames} onToggle={setShowLandmarkNames} indent />
                      <FFToggle label="Towns" value={showPopulatedNames} onToggle={setShowPopulatedNames} indent />
                      <FFToggle label="Rivers" value={showStreamNames} onToggle={setShowStreamNames} indent />
                      <FFToggle label="Lakes" value={showLakeNames} onToggle={setShowLakeNames} indent />
                      <FFToggle label="Terrain" value={showTerrainNames} onToggle={setShowTerrainNames} indent />
                    </>
                  )}
                </>
              )}
              
              <View style={styles.ffLayersDivider} />
              <Text style={styles.ffLayersSectionTitle}>Chart Layers</Text>
              <View style={styles.ffAllToggleRow}>
                <TouchableOpacity 
                  style={styles.ffAllToggleBtn} 
                  onPress={() => dispatchLayers({ type: 'SET_ALL', value: true })}
                >
                  <Text style={styles.ffAllToggleBtnText}>All On</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.ffAllToggleBtn} 
                  onPress={() => dispatchLayers({ type: 'SET_ALL', value: false })}
                >
                  <Text style={styles.ffAllToggleBtnText}>All Off</Text>
                </TouchableOpacity>
              </View>
              <FFToggle label="Land" value={showLand} onToggle={() => toggleLayer('land')} />
              <FFToggle label="Coastline" value={showCoastline} onToggle={() => toggleLayer('coastline')} />
              <FFToggle label="Buoys" value={showBuoys} onToggle={() => toggleLayer('buoys')} />
              <FFToggle label="Beacons" value={showBeacons} onToggle={() => toggleLayer('beacons')} />
              <FFToggle label="Landmarks" value={showLandmarks} onToggle={() => toggleLayer('landmarks')} />
              <FFToggle label="Hazards" value={showHazards} onToggle={() => toggleLayer('hazards')} />
              <FFToggle label="Cables" value={showCables} onToggle={() => toggleLayer('cables')} />
              <FFToggle label="Pipelines" value={showPipelines} onToggle={() => toggleLayer('pipelines')} />
              <FFToggle label="Restricted Areas" value={showRestrictedAreas} onToggle={() => toggleLayer('restrictedAreas')} />
              <FFToggle label="Caution Areas" value={showCautionAreas} onToggle={() => toggleLayer('cautionAreas')} />
              <FFToggle label="Military Areas" value={showMilitaryAreas} onToggle={() => toggleLayer('militaryAreas')} />
              <FFToggle label="Anchorages" value={showAnchorages} onToggle={() => toggleLayer('anchorages')} />
              <FFToggle label="Anchor Berths" value={showAnchorBerths} onToggle={() => toggleLayer('anchorBerths')} />
              <FFToggle label="Marine Farms" value={showMarineFarms} onToggle={() => toggleLayer('marineFarms')} />
              
              <View style={styles.ffLayersDivider} />
              <Text style={styles.ffLayersSectionTitle}>Infrastructure</Text>
              <FFToggle label="Bridges" value={showBridges} onToggle={() => toggleLayer('bridges')} />
              <FFToggle label="Buildings" value={showBuildings} onToggle={() => toggleLayer('buildings')} />
              <FFToggle label="Moorings" value={showMoorings} onToggle={() => toggleLayer('moorings')} />
              <FFToggle label="Shoreline Construction" value={showShorelineConstruction} onToggle={() => toggleLayer('shorelineConstruction')} />
              
              <View style={styles.ffLayersDivider} />
              <Text style={styles.ffLayersSectionTitle}>Labels</Text>
              <FFToggle label="Sea Area Names" value={showSeaAreaNames} onToggle={() => toggleLayer('seaAreaNames')} />
              <FFToggle label="Land Regions" value={showLandRegions} onToggle={() => toggleLayer('landRegions')} />
              
              <View style={styles.ffLayersDivider} />
              <Text style={styles.ffLayersSectionTitle}>Settings</Text>
              <FFToggle 
                label={`Limit zoom (max z${maxAvailableZoom})`} 
                value={limitZoomToCharts} 
                onToggle={setLimitZoomToCharts} 
              />
            </ScrollView>
          </View>
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

      {/* Compass Overlay - Full viewport HUD */}
      <CompassOverlay
        heading={gpsData.heading}
        course={gpsData.course}
        visible={showCompass}
      />

      {/* GPS Info Panel */}
      <GPSInfoPanel
        gpsData={gpsData}
        visible={showGPSPanel}
      />

    </View>
  );
}

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
function formatFeatureProperties(feature: FeatureInfo): Record<string, string> {
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
        formatted['Depth'] = `${props.DEPTH}m`;
      }
      return formatted;
    
    case 'Depth Area':
      if (props.DRVAL1 !== undefined) {
        formatted['Shallow depth'] = `${props.DRVAL1}m`;
      }
      if (props.DRVAL2 !== undefined) {
        formatted['Deep depth'] = `${props.DRVAL2}m`;
      }
      return formatted;
    
    case 'Depth Contour':
      if (props.VALDCO !== undefined) {
        formatted['Depth'] = `${props.VALDCO}m`;
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
  
  console.log(`[PERF:FeatureInspector] Render: ${Date.now() - renderStart}ms`);
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
  return (
    <TouchableOpacity 
      style={[styles.ffToggle, indent && styles.ffToggleIndent]} 
      onPress={() => onToggle(!value)}
    >
      <View style={[styles.ffToggleBox, value && styles.ffToggleBoxActive]}>
        {value && <Text style={styles.ffToggleCheck}>✓</Text>}
      </View>
      <Text style={styles.ffToggleLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
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
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  zoomText: { fontSize: 11, color: '#fff', fontWeight: '500', fontFamily: 'monospace' },
  zoomBadgeAtMax: {
    backgroundColor: 'rgba(244, 67, 54, 0.8)',
    borderWidth: 1,
    borderColor: '#F44336',
  },
  zoomTextAtMax: {
    color: '#fff',
    fontWeight: '700',
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
  coordBadge: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  coordText: { fontSize: 11, color: '#fff', fontWeight: '500', fontFamily: 'monospace' },
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
    left: 12,
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
  
  // Center button container - upper right (same style as other controls)
  centerBtnContainer: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  centerBtnText: {
    fontSize: 28,
    color: '#fff',
  },
  
  // Quick toggles strip - minimalist style, bottom left
  quickTogglesStrip: {
    position: 'absolute',
    left: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 8,
    overflow: 'hidden',
  },
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
  
  
  // Layers panel - dark translucent two-column
  ffLayersPanel: {
    position: 'absolute',
    left: 12,
    backgroundColor: 'rgba(20, 25, 35, 0.95)',
    borderRadius: 12,
    maxHeight: 500,
    width: 340,
    overflow: 'hidden',
  },
  ffLayersPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  ffLayersPanelTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  ffLayersPanelClose: {
    fontSize: 18,
    color: 'rgba(255, 255, 255, 0.6)',
    padding: 4,
  },
  ffLayersColumns: {
    flexDirection: 'row',
    maxHeight: 440,
  },
  ffLayersColumnLeft: {
    width: 130,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255, 255, 255, 0.1)',
  },
  ffLayersColumnRight: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  ffLayersSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  ffLayersDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 12,
  },
  ffLayerOption: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginBottom: 2,
  },
  ffLayerOptionActive: {
    backgroundColor: 'rgba(79, 195, 247, 0.2)',
  },
  ffLayerOptionText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  ffLayerOptionTextActive: {
    color: '#4FC3F7',
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
  ffAllToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  ffAllToggleBtn: {
    flex: 1,
    backgroundColor: 'rgba(79, 195, 247, 0.2)',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  ffAllToggleBtnText: {
    color: '#4FC3F7',
    fontSize: 12,
    fontWeight: '600',
  },
});

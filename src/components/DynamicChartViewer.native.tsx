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
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import {
  FeatureType,
  GeoJSONFeatureCollection,
  ALL_FEATURE_TYPES,
} from '../types/chart';
import * as chartCacheService from '../services/chartCacheService';
import * as tileServer from '../services/tileServer';
import { loadChartIndex, ChartIndex, findChartsForViewport, getChartInfo } from '../services/chartIndex';
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

Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || '');

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
// Priority map for O(1) lookup instead of O(n) indexOf
const NAUTICAL_LAYER_PRIORITIES: Map<string, number> = new Map([
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
  const mapRef = useRef<Mapbox.MapView>(null);
  const cameraRef = useRef<Mapbox.Camera>(null);
  
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
  const [dynamicCharts, setDynamicCharts] = useState<string[]>([]); // Viewport-loaded US4/US5 charts
  const [lastDynamicCheck, setLastDynamicCheck] = useState<{lon: number, lat: number, zoom: number} | null>(null);
  const [rasterCharts, setRasterCharts] = useState<LoadedRasterChart[]>([]);
  const [tileServerReady, setTileServerReady] = useState(false);
  const [storageUsed, setStorageUsed] = useState<{ total: number; vector: number; raster: number }>({ total: 0, vector: 0, raster: 0 });
  
  // Data source toggles
  const [useMBTiles, setUseMBTiles] = useState(true);
  
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
  
  // Minimal offline style - land colored background, water rendered on top
  const localOfflineStyle = {
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
  
  const mapStyleUrls: Record<MapStyleOption, string | object> = {
    light: Mapbox.StyleURL.Light,
    dark: Mapbox.StyleURL.Dark,
    satellite: Mapbox.StyleURL.Satellite,
    outdoors: Mapbox.StyleURL.Outdoors,
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
  useEffect(() => {
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
  }, [loadingPhase, tileServerReady, mbtilesCharts, addChartsBatched]);
  
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
      
      // === PHASE 1: Find mbtiles directory ===
      // Check external storage first (for dev - manual file pushing via ADB/OpenMTP)
      // Fall back to internal documentDirectory (for production - Firebase downloads)
      const dirStart = Date.now();
      const internalDir = `${FileSystem.documentDirectory}mbtiles`;
      const externalDir = 'file:///storage/emulated/0/Android/data/com.xnautical.app/files/mbtiles';
      
      let mbtilesDir = internalDir;
      
      // Ensure both directories exist (external for dev, internal for production)
      // Creating external dir here ensures it has correct ownership for ADB push
      try {
        const externalDirInfo = await FileSystem.getInfoAsync(externalDir);
        if (!externalDirInfo.exists) {
          await FileSystem.makeDirectoryAsync(externalDir, { intermediates: true });
          console.log('[PERF] Created external mbtiles directory');
        }
      } catch (e) {
        console.log('[PERF] Could not create external directory (normal on some devices)');
      }
      
      const internalInfo = await FileSystem.getInfoAsync(internalDir);
      if (!internalInfo.exists) {
        await FileSystem.makeDirectoryAsync(internalDir, { intermediates: true });
      }
      
      // Check if external dir has chart_index.json or mbtiles files (dev mode)
      try {
        const externalIndexInfo = await FileSystem.getInfoAsync(`${externalDir}/chart_index.json`);
        if (externalIndexInfo.exists) {
          mbtilesDir = externalDir;
          console.log('[PERF] Using external storage (has chart index)');
        } else {
          // No index - check if external has any mbtiles files
          const externalDirInfo = await FileSystem.getInfoAsync(externalDir);
          if (externalDirInfo.exists) {
            const externalFiles = await FileSystem.readDirectoryAsync(externalDir);
            if (externalFiles.some((f: string) => f.endsWith('.mbtiles'))) {
              mbtilesDir = externalDir;
              console.log('[PERF] Using external storage (has mbtiles files)');
            }
          }
        }
      } catch (e) {
        console.log('[PERF] External storage not accessible, using internal');
      }
      
      // Check internal for chart_index.json (if not already using external)
      if (mbtilesDir === internalDir) {
        const internalIndexInfo = await FileSystem.getInfoAsync(`${internalDir}/chart_index.json`);
        if (internalIndexInfo.exists) {
          console.log('[PERF] Using internal storage');
        }
      }
      console.log(`[PERF] Directory resolved: ${mbtilesDir} (${Date.now() - dirStart}ms)`);
      
      // === PHASE 2: Load chart index ===
      const indexStart = Date.now();
      const index = await loadChartIndex(`${mbtilesDir}/chart_index.json`);
      console.log(`[PERF] Index load: ${Date.now() - indexStart}ms`);
      
      let tier1ChartIds: string[] = [];
      let tier2ChartIds: string[] = [];
      let totalChartCount = 0;
      
      if (index) {
        // Progressive loading: US1 first, then US2+US3, then US4 up to 100
        tier1ChartIds = index.tier1Charts; // All Tier 1 (81 charts)
        tier2ChartIds = index.tier2Charts; // Tier 2 (1135 charts)
        totalChartCount = index.stats.totalCharts;
        
        const us1Charts = tier1ChartIds.filter(id => id.startsWith('US1'));
        console.log(`[PERF] Index: ${us1Charts.length} US1, ${tier1ChartIds.length} Tier1, ${tier2ChartIds.length} Tier2`);
      } else {
        console.log('[PERF] No index available - will use legacy scanning');
      }
      
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
      
      // === PHASE 4: Build chart list from index or legacy scan ===
      const buildStart = Date.now();
      const loadedMbtiles: LoadedMBTilesChart[] = [];
      const loadedRasters: LoadedRasterChart[] = [];
      
      if (index && tier1ChartIds.length > 0) {
        // Scan directory once to get actual files (fast single I/O operation)
        let existingFiles: Set<string> = new Set();
        try {
          const filesInDir = await FileSystem.readDirectoryAsync(mbtilesDir);
          existingFiles = new Set(
            filesInDir
              .filter((f: string) => f.endsWith('.mbtiles'))
              .map((f: string) => f.replace('.mbtiles', ''))
          );
          console.log(`[PERF] Found ${existingFiles.size} actual mbtiles files`);
        } catch (e) {
          console.log('[PERF] Could not scan directory for verification, using index as-is');
        }
        
        // Use index but verify file existence
        const verifyExists = existingFiles.size > 0;
        let skippedCount = 0;
        
        for (const chartId of tier1ChartIds) {
          if (!verifyExists || existingFiles.has(chartId)) {
            loadedMbtiles.push({ chartId, path: `${mbtilesDir}/${chartId}.mbtiles` });
          } else {
            skippedCount++;
          }
        }
        // Also add tier2 to the list (for reference count display)
        for (const chartId of tier2ChartIds) {
          if (!verifyExists || existingFiles.has(chartId)) {
            loadedMbtiles.push({ chartId, path: `${mbtilesDir}/${chartId}.mbtiles` });
          } else {
            skippedCount++;
          }
        }
        
        // Also check for raster files
        for (const filename of existingFiles) {
          if (filename.startsWith('BATHY_')) {
            loadedRasters.push({ chartId: filename, path: `${mbtilesDir}/${filename}.mbtiles` });
          }
        }
        
        if (skippedCount > 0) {
          console.log(`[PERF] Skipped ${skippedCount} charts (files not found)`);
        }
        console.log(`[PERF] Built chart list from index: ${Date.now() - buildStart}ms (${loadedMbtiles.length} verified)`);
      } else {
        // Legacy: scan directory (slower)
        console.log('[PERF] Falling back to directory scan...');
        const scanStart = Date.now();
        try {
          const filesInDir = await FileSystem.readDirectoryAsync(mbtilesDir);
          for (const filename of filesInDir) {
            if (filename.endsWith('.mbtiles') && !filename.startsWith('._')) {
              const chartId = filename.replace('.mbtiles', '');
              const path = `${mbtilesDir}/${filename}`;
              
              // Skip special files (already handled)
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
          
          // Sort by tier for proper quilting
          loadedMbtiles.sort((a, b) => {
            const getScaleNum = (id: string) => {
              const match = id.match(/^US(\d)/);
              return match ? parseInt(match[1], 10) : 0;
            };
            return getScaleNum(a.chartId) - getScaleNum(b.chartId);
          });
          
          // Separate into tiers
          tier1ChartIds = loadedMbtiles.filter(m => m.chartId.match(/^US[123]/)).map(m => m.chartId);
          tier2ChartIds = loadedMbtiles.filter(m => m.chartId.match(/^US[456]/)).map(m => m.chartId);
        } catch (e) {
          console.log('[PERF] Directory scan failed:', e);
        }
        console.log(`[PERF] Directory scan: ${Date.now() - scanStart}ms (${loadedMbtiles.length} charts)`);
      }
      
      // Count charts by tier for detailed logging
      const tierCounts: Record<string, number> = { US1: 0, US2: 0, US3: 0, US4: 0, US5: 0, US6: 0 };
      for (const m of loadedMbtiles) {
        const tier = m.chartId.substring(0, 3);
        tierCounts[tier] = (tierCounts[tier] || 0) + 1;
      }
      console.log(`[CHARTS] ========== CHART INVENTORY ==========`);
      console.log(`[CHARTS] Total verified charts: ${loadedMbtiles.length}`);
      console.log(`[CHARTS] By scale: US1=${tierCounts.US1} US2=${tierCounts.US2} US3=${tierCounts.US3} US4=${tierCounts.US4} US5=${tierCounts.US5} US6=${tierCounts.US6}`);
      console.log(`[CHARTS] Tier 1 (memory): ${tierCounts.US1 + tierCounts.US2 + tierCounts.US3} charts`);
      console.log(`[CHARTS] Tier 2 (dynamic): ${tierCounts.US4 + tierCounts.US5 + tierCounts.US6} charts`);
      console.log(`[CHARTS] =======================================`);
      
      setMbtilesCharts(loadedMbtiles);
      
      // Progressive loading: Start with US1 only for fast initial render
      const us1Only = loadedMbtiles.filter(m => m.chartId.startsWith('US1')).map(m => m.chartId);
      setChartsToRender(us1Only);
      setLoadingPhase('us1');
      console.log(`[PROGRESSIVE] Phase 1: Rendering ${us1Only.length} US1 charts`);
      
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
            
            const chartSummary = `${tier1ChartIds.length} Tier1, ${tier2ChartIds.length} Tier2`;
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
      console.log(`[PERF] Progressive loading: US1 → US2+US3 → US4 (up to 100)`);
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

  // Build a set of verified chart IDs for fast lookup
  const verifiedChartIds = useMemo(() => {
    return new Set(mbtilesCharts.map(m => m.chartId));
  }, [mbtilesCharts]);
  
  // Update dynamic charts based on viewport (for US4/US5/US6 loading)
  const updateDynamicCharts = useCallback((lon: number, lat: number, zoom: number) => {
    // Only load dynamic charts at zoom >= 10 (US4 starts at z11, US5 at z13)
    // Start a bit early to preload before they're fully visible
    if (zoom < 10) return;
    
    // Check if we've moved enough to warrant a check
    // ~0.2 degree movement or 1.0 zoom levels (more responsive)
    if (lastDynamicCheck) {
      const lonDiff = Math.abs(lon - lastDynamicCheck.lon);
      const latDiff = Math.abs(lat - lastDynamicCheck.lat);
      const zoomDiff = Math.abs(zoom - lastDynamicCheck.zoom);
      
      if (lonDiff < 0.2 && latDiff < 0.2 && zoomDiff < 1.0) {
        return; // Not enough movement
      }
    }
    
    // Find charts for this viewport
    const { tier2 } = findChartsForViewport(lon, lat, zoom);
    
    // Filter to only new charts that:
    // 1. Are not already loaded
    // 2. Actually exist on device (in verifiedChartIds)
    const alreadyLoaded = new Set([...chartsToRender, ...dynamicCharts]);
    const newCharts = tier2.filter(id => 
      !alreadyLoaded.has(id) && verifiedChartIds.has(id)
    );
    
    if (newCharts.length > 0) {
      // Add new charts, cap total dynamic at 50
      const updated = [...dynamicCharts, ...newCharts].slice(-50);
      setDynamicCharts(updated);
      console.log(`[DYNAMIC] Added ${newCharts.length} charts at z${zoom.toFixed(1)}: ${newCharts.join(', ')}`);
    }
    
    setLastDynamicCheck({ lon, lat, zoom });
  }, [lastDynamicCheck, chartsToRender, dynamicCharts, verifiedChartIds]);

  // Process camera state updates (extracted for throttling)
  const processCameraState = useCallback((state: any) => {
    if (state?.properties?.center) {
      setCenterCoord(state.properties.center);
      
      // Check for dynamic chart loading
      const [lon, lat] = state.properties.center;
      const zoom = state?.properties?.zoom ?? currentZoom;
      updateDynamicCharts(lon, lat, zoom);
    }
    if (state?.properties?.zoom !== undefined) {
      const zoom = Math.round(state.properties.zoom * 10) / 10;
      setCurrentZoom(zoom);
      // Check if we're at the max zoom limit
      setIsAtMaxZoom(limitZoomToCharts && zoom >= effectiveMaxZoom - 0.1);
    }
  }, [limitZoomToCharts, effectiveMaxZoom, currentZoom, updateDynamicCharts]);

  // Handle camera changes - throttled to max once per 100ms to reduce re-renders during pan/zoom
  const handleCameraChanged = useCallback((state: any) => {
    const THROTTLE_MS = 100;
    const now = Date.now();
    
    // Always store the latest state
    pendingCameraStateRef.current = state;
    
    // If enough time has passed, process immediately
    if (now - lastCameraUpdateRef.current >= THROTTLE_MS) {
      lastCameraUpdateRef.current = now;
      processCameraState(state);
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

  // Combine static (progressive) and dynamic (viewport-based) charts
  // Use Set to deduplicate - a chart may be in both lists if added progressively
  // and also discovered via viewport-based dynamic loading
  const allChartsToRender = useMemo(() => {
    const combined = [...chartsToRender, ...dynamicCharts];
    return [...new Set(combined)]; // Remove duplicates
  }, [chartsToRender, dynamicCharts]);

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
      
      // Chart zoom ranges (from tippecanoe settings)
      // US1: z0-8, US2: z8-10, US3: z10-13, US4: z11-16, US5: z13-18
      // Include charts within ±2 zoom levels for overzoom tolerance
      switch (scale) {
        case 1: return zoom <= 10;  // US1: visible up to z10 (overzoom from z8)
        case 2: return zoom >= 6 && zoom <= 12;  // US2: z8-10 ± buffer
        case 3: return zoom >= 8 && zoom <= 15;  // US3: z10-13 ± buffer
        case 4: return zoom >= 9;   // US4: z11-16, visible at high zooms
        case 5: return zoom >= 11;  // US5: z13-18, visible at high zooms
        default: return zoom >= 11; // US6+: high zoom only
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
  }, [allChartsToRender, chartsToRender.length, dynamicCharts.length, currentZoom,
      showLights, showBuoys, showBeacons, showHazards, showLandmarks, showSoundings,
      showCables, showPipelines, showDepthContours, showCoastline,
      showRestrictedAreas, showCautionAreas, showMilitaryAreas, showAnchorages,
      showMarineFarms, showSeabed]);

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
      
      // Filter to nautical layers in JavaScript (O(n) but n is small)
      const filterStart = Date.now();
      const nauticalLayers = new Set([
        'LIGHTS', 'BOYLAT', 'BOYCAR', 'BOYSAW', 'BOYSPP', 'BOYISD',
        'BCNLAT', 'BCNSPP', 'BCNCAR', 'BCNISD', 'BCNSAW',
        'WRECKS', 'UWTROC', 'OBSTRN', 'LNDMRK', 'SOUNDG',
        'CBLSUB', 'CBLARE', 'PIPSOL', 'PIPARE', 'DEPCNT', 'COALNE',
        'RESARE', 'CTNARE', 'MIPARE', 'ACHARE', 'ACHBRT', 'MARCUL', 'SBDARE',
      ]);
      const features = {
        features: (allFeatures?.features || []).filter((f: any) => {
          const layer = f.properties?._layer || '';
          return nauticalLayers.has(layer);
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
          const layer = props._layer || '';
          
          // Skip meta layers
          if (layer.startsWith('M_')) continue;
          
          // Calculate priority using Map for O(1) lookup
          let priority = NAUTICAL_LAYER_PRIORITIES.get(layer) || 0;
          
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
          const layer = props._layer || 'Unknown';
          
          console.log(`[PERF:MapPress] Selected feature: ${layer} (priority: ${bestPriority})`);
          
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
      <Mapbox.MapView
        ref={mapRef}
        style={styles.map}
        styleURL={typeof mapStyleUrls[mapStyle] === 'string' ? mapStyleUrls[mapStyle] : undefined}
        styleJSON={typeof mapStyleUrls[mapStyle] === 'object' ? JSON.stringify(mapStyleUrls[mapStyle]) : undefined}
        onMapIdle={handleMapIdle}
        onCameraChanged={handleCameraChanged}
        onPress={handleMapPress}
        onWillStartLoadingMap={handleWillStartLoadingMap}
        onDidFinishLoadingMap={handleDidFinishLoadingMap}
        onDidFailLoadingMap={handleDidFailLoadingMap}
        onDidFinishLoadingStyle={handleDidFinishLoadingStyle}
        onDidFinishRenderingFrame={handleDidFinishRenderingFrame}
        onDidFinishRenderingFrameFully={handleDidFinishRenderingFrameFully}
        scaleBarEnabled={true}
        scaleBarPosition={{ bottom: 16, right: 70 }}
        logoEnabled={false}
        attributionEnabled={false}
      >
        <Mapbox.Camera
          ref={cameraRef}
          defaultSettings={{
            zoomLevel: 8,  // Start at z8 where US1 overview charts are visible
            centerCoordinate: [-151.55, 59.64],  // HARDCODED: Homer, Alaska
          }}
          maxZoomLevel={effectiveMaxZoom}
          minZoomLevel={0}
        />

        <Mapbox.Images images={NAV_SYMBOLS} />

        {/* Raster Bathymetry Sources - renders BELOW vector chart data */}
        {tileServerReady && rasterCharts.map((chart) => {
          const rasterTileUrl = tileServer.getRasterTileUrlTemplate(chart.chartId);
          
          return (
            <Mapbox.RasterSource
              key={`raster-src-${chart.chartId}-${cacheBuster}`}
              id={`raster-src-${chart.chartId}`}
              tileUrlTemplates={[rasterTileUrl]}
              tileSize={256}
              minZoomLevel={6}
              maxZoomLevel={14}
            >
              <Mapbox.RasterLayer
                id={`raster-layer-${chart.chartId}`}
                style={{
                  rasterOpacity: showBathymetry ? 0.7 : 0,
                }}
              />
            </Mapbox.RasterSource>
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
          <Mapbox.VectorSource
            id="local-basemap-source"
            tileUrlTemplates={[`${tileServer.getTileServerUrl()}/tiles/basemap_alaska/{z}/{x}/{y}.pbf`]}
            minZoomLevel={0}
            maxZoomLevel={14}
          >
            {/* === WATER (renders on top of tan background = land) === */}
            <Mapbox.FillLayer
              id="basemap-water"
              sourceLayerID="water"
              style={{
                fillColor: '#a0cfe8',
                fillOpacity: 1,
                visibility: basemapVisible,
              }}
            />
            
            {/* Rivers and streams */}
            <Mapbox.LineLayer
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
            <Mapbox.FillLayer
              id="basemap-landcover-ice"
              sourceLayerID="landcover"
              filter={['==', ['get', 'class'], 'ice']}
              style={{
                fillColor: '#ffffff',
                fillOpacity: 0.9,
                visibility: basemapVisible,
              }}
            />
            <Mapbox.FillLayer
              id="basemap-landcover-grass"
              sourceLayerID="landcover"
              filter={['==', ['get', 'class'], 'grass']}
              style={{
                fillColor: '#d8e8c8',
                fillOpacity: 0.6,
                visibility: basemapVisible,
              }}
            />
            <Mapbox.FillLayer
              id="basemap-landcover-wood"
              sourceLayerID="landcover"
              filter={['any', ['==', ['get', 'class'], 'wood'], ['==', ['get', 'class'], 'forest']]}
              style={{
                fillColor: '#c5ddb0',
                fillOpacity: 0.6,
                visibility: basemapVisible,
              }}
            />
            <Mapbox.FillLayer
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
            <Mapbox.FillLayer
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
            <Mapbox.FillLayer
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
            <Mapbox.FillLayer
              id="basemap-park"
              sourceLayerID="park"
              style={{
                fillColor: '#c8e6c9',
                fillOpacity: 0.4,
                visibility: basemapVisible,
              }}
            />
            
            {/* === BUILDINGS (high zoom) === */}
            <Mapbox.FillLayer
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
            <Mapbox.LineLayer
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
            <Mapbox.LineLayer
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
            <Mapbox.LineLayer
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
            <Mapbox.LineLayer
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
            <Mapbox.LineLayer
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
            <Mapbox.LineLayer
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
            <Mapbox.LineLayer
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
            <Mapbox.LineLayer
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
            <Mapbox.LineLayer
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
            <Mapbox.FillLayer
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
            <Mapbox.LineLayer
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
            <Mapbox.SymbolLayer
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
                textFont: ['Open Sans Bold', 'Arial Unicode MS Bold'],
                textTransform: 'uppercase',
                textLetterSpacing: 0.1,
                visibility: basemapVisible,
              }}
            />
            <Mapbox.SymbolLayer
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
                textFont: ['Open Sans Bold', 'Arial Unicode MS Bold'],
                visibility: basemapVisible,
              }}
            />
            <Mapbox.SymbolLayer
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
                textFont: ['Open Sans Regular', 'Arial Unicode MS Regular'],
                visibility: basemapVisible,
              }}
            />
            <Mapbox.SymbolLayer
              id="basemap-water-name"
              sourceLayerID="water_name"
              minZoomLevel={8}
              style={{
                textField: ['get', 'name'],
                textSize: 11,
                textColor: '#5d8cae',
                textHaloColor: '#ffffff',
                textHaloWidth: 1,
                textFont: ['Open Sans Italic', 'Arial Unicode MS Regular'],
                visibility: basemapVisible,
              }}
            />
            <Mapbox.SymbolLayer
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
                textFont: ['Open Sans Regular', 'Arial Unicode MS Regular'],
                visibility: basemapVisible,
              }}
            />
          </Mapbox.VectorSource>
          );
        })()}

        {/* MBTiles Vector Sources - Chart quilting with zoom-based visibility */}
        {/* PERFORMANCE: Progressive loading + viewport-based dynamic loading */}
        {useMBTiles && tileServerReady && allChartsToRender.map((chartId) => {
          const tileUrl = tileServer.getTileUrlTemplate(chartId);
          
          // Determine minZoomLevel and maxZoomLevel based on chart scale for proper quilting
          // When zoomed in past maxZoom, lower-resolution charts hide and higher-res ones take over
          // US1: z0-9, US2: z8-11, US3: z10-13, US4: z11-15, US5: z13+
          const getChartMinZoom = (chartId: string): number => {
            const match = chartId.match(/^US(\d)/);
            if (!match) return 0;
            const scaleNum = parseInt(match[1], 10);
            
            if (scaleNum === 1) return 0;   // US1 Overview
            if (scaleNum === 2) return 8;   // US2 General
            if (scaleNum === 3) return 10;  // US3 Coastal
            if (scaleNum === 4) return 11;  // US4 Approach
            if (scaleNum === 5) return 13;  // US5 Harbor
            if (scaleNum >= 6) return 13;
            return 0;
          };
          
          const getChartMaxZoom = (chartId: string): number => {
            const match = chartId.match(/^US(\d)/);
            if (!match) return 22;
            const scaleNum = parseInt(match[1], 10);
            
            // Lower-res charts fade out when higher-res ones become available
            // Small overlap allows smooth transitions
            if (scaleNum === 1) return 9;   // US1 hides at z10 when US3 available
            if (scaleNum === 2) return 11;  // US2 hides at z12 when US4 available  
            if (scaleNum === 3) return 13;  // US3 hides at z14 when US5 available
            if (scaleNum === 4) return 15;  // US4 hides at z16
            if (scaleNum === 5) return 22;  // US5 stays visible at all high zooms
            if (scaleNum >= 6) return 22;
            return 22;
          };
          
          const chartMinZoom = getChartMinZoom(chartId);
          const chartMaxZoom = getChartMaxZoom(chartId);
          
          return (
          <Mapbox.VectorSource
            key={`mbtiles-src-${chartId}-${cacheBuster}`}
            id={`mbtiles-src-${chartId}`}
            tileUrlTemplates={[tileUrl]}
            maxZoomLevel={22}
          >
            {/* ============================================================ */}
            {/* LAYER ORDER - S-52 Compliant (bottom to top)                 */}
            {/* 1. Water/depth backgrounds                                    */}
            {/* 2. Land areas (masks water features on land)                  */}
            {/* 3. Area overlays (cables, pipelines, restricted areas)        */}
            {/* 4. Lines (depth contours, coastline, cables, pipelines)       */}
            {/* 5. Text (soundings, seabed)                                   */}
            {/* 6. Point symbols (hazards, nav aids, lights, landmarks)       */}
            {/* ============================================================ */}
            
            {/* === SECTION 1: WATER/DEPTH BACKGROUNDS === */}
            
            {/* DEPARE - Depth Areas with proper depth-based coloring */}
            {/* belowLayerID ensures depth fills stay below GNIS labels */}
            {/* maxZoomLevel hides lower-res charts when higher-res available */}
            <Mapbox.FillLayer
              id={`mbtiles-depare-${chartId}`}
              sourceLayerID={chartId}
              belowLayerID="chart-top-marker"
              minZoomLevel={chartMinZoom}
              maxZoomLevel={chartMaxZoom}
              filter={['==', ['get', '_layer'], 'DEPARE']}
              style={{
                fillColor: [
                  'step',
                  ['coalesce', ['get', 'DRVAL1'], 0], // Handle null/undefined DRVAL1
                  '#C8D6A3', 0,      // Drying/intertidal - tan/green
                  '#B5E3F0', 2,      // 0-2m - very light blue (danger)
                  '#9DD5E8', 5,      // 2-5m - light blue
                  '#7EC8E3', 10,     // 5-10m - medium light blue
                  '#5BB4D6', 20,     // 10-20m - medium blue
                  '#3A9FC9', 50,     // 20-50m - darker blue
                  '#2185B5',         // 50m+ - deep blue
                ],
                fillOpacity: mapStyle === 'satellite' ? 0.6 : 1.0,
                visibility: showDepthAreas ? 'visible' : 'none',
              }}
            />
            
            {/* DRGARE - Dredged Areas (maintained channels) */}
            <Mapbox.FillLayer
              id={`mbtiles-drgare-${chartId}`}
              sourceLayerID={chartId}
              belowLayerID="chart-top-marker"
              minZoomLevel={chartMinZoom}
              maxZoomLevel={chartMaxZoom}
              filter={['==', ['get', '_layer'], 'DRGARE']}
              style={{
                fillColor: '#87CEEB',
                fillOpacity: 0.4,
              }}
            />
            
            {/* FAIRWY - Fairways (navigation channels) */}
            <Mapbox.FillLayer
              id={`mbtiles-fairwy-${chartId}`}
              sourceLayerID={chartId}
              belowLayerID="chart-top-marker"
              minZoomLevel={chartMinZoom}
              maxZoomLevel={chartMaxZoom}
              filter={['==', ['get', '_layer'], 'FAIRWY']}
              style={{
                fillColor: '#E6E6FA',
                fillOpacity: 0.3,
              }}
            />
            
            {/* === SECTION 2: LAND (masks water features) === */}
            
            {/* LNDARE - Land Areas - MUST be early to mask water features on land */}
            <Mapbox.FillLayer
              id={`mbtiles-lndare-${chartId}`}
              sourceLayerID={chartId}
              belowLayerID="chart-top-marker"
              minZoomLevel={chartMinZoom}
              maxZoomLevel={chartMaxZoom}
              filter={['==', ['get', '_layer'], 'LNDARE']}
              style={{
                fillColor: '#F5DEB3',
                fillOpacity: mapStyle === 'satellite' ? 0.3 : 1,
                visibility: showLand ? 'visible' : 'none',
              }}
            />
            
            {/* === SECTION 3: AREA OVERLAYS (on top of land/water) === */}
            {/* All fill layers use belowLayerID to stay below GNIS labels */}
            
            {/* CBLARE - Cable Areas (fill only, outline later) */}
            <Mapbox.FillLayer
              id={`mbtiles-cblare-${chartId}`}
              sourceLayerID={chartId}
              belowLayerID="chart-top-marker"
              minZoomLevel={chartMinZoom}
              filter={['==', ['get', '_layer'], 'CBLARE']}
              style={{
                fillColor: '#800080',
                fillOpacity: 0.15,
                visibility: showCables ? 'visible' : 'none',
              }}
            />
            
            {/* PIPARE - Pipeline Areas (fill only, outline later) */}
            <Mapbox.FillLayer
              id={`mbtiles-pipare-${chartId}`}
              sourceLayerID={chartId}
              belowLayerID="chart-top-marker"
              minZoomLevel={chartMinZoom}
              filter={['==', ['get', '_layer'], 'PIPARE']}
              style={{
                fillColor: '#008000',
                fillOpacity: 0.15,
                visibility: showPipelines ? 'visible' : 'none',
              }}
            />
            
            {/* RESARE - Restricted Areas (no-go zones, nature reserves, etc.) */}
            {/* CATREA: 1=offshore safety, 4=nature reserve, 7=bird sanctuary, 8=game reserve, */}
            {/*         9=seal sanctuary, 12=degaussing range, 14=military, 17=historic wreck, */}
            {/*         22=no wake, 24=swinging area, 27=water skiing */}
            {/* Available at all zoom levels for route planning */}
            <Mapbox.FillLayer
              id={`mbtiles-resare-${chartId}`}
              sourceLayerID={chartId}
              belowLayerID="chart-top-marker"
              minZoomLevel={0}
              filter={['==', ['get', '_layer'], 'RESARE']}
              style={{
                fillColor: [
                  'match',
                  ['get', 'CATREA'],
                  14, '#FF0000',    // Military - red
                  12, '#FF0000',    // Degaussing - red
                  4, '#00AA00',     // Nature reserve - green
                  7, '#00AA00',     // Bird sanctuary - green
                  8, '#00AA00',     // Game reserve - green
                  9, '#00AA00',     // Seal sanctuary - green
                  '#FF00FF',        // Default - magenta
                ],
                fillOpacity: 0.2,
                visibility: showRestrictedAreas ? 'visible' : 'none',
              }}
            />
            
            {/* CTNARE - Caution Areas (areas requiring special attention) */}
            {/* Available at all zoom levels for route planning */}
            <Mapbox.FillLayer
              id={`mbtiles-ctnare-${chartId}`}
              sourceLayerID={chartId}
              belowLayerID="chart-top-marker"
              minZoomLevel={0}
              filter={['==', ['get', '_layer'], 'CTNARE']}
              style={{
                fillColor: '#FFA500',  // Orange for caution
                fillOpacity: 0.2,
                visibility: showCautionAreas ? 'visible' : 'none',
              }}
            />
            
            {/* MIPARE - Military Practice Areas */}
            {/* Available at all zoom levels for route planning */}
            <Mapbox.FillLayer
              id={`mbtiles-mipare-${chartId}`}
              sourceLayerID={chartId}
              belowLayerID="chart-top-marker"
              minZoomLevel={0}
              filter={['==', ['get', '_layer'], 'MIPARE']}
              style={{
                fillColor: '#FF0000',  // Red for military/danger
                fillOpacity: 0.2,
                visibility: showMilitaryAreas ? 'visible' : 'none',
              }}
            />
            
            {/* ACHARE - Anchorage Areas */}
            {/* Available at all zoom levels for route planning */}
            <Mapbox.FillLayer
              id={`mbtiles-achare-${chartId}`}
              sourceLayerID={chartId}
              belowLayerID="chart-top-marker"
              minZoomLevel={0}
              filter={['==', ['get', '_layer'], 'ACHARE']}
              style={{
                fillColor: '#9400D3',  // Dark violet for anchorage
                fillOpacity: 0.15,
                visibility: showAnchorages ? 'visible' : 'none',
              }}
            />
            
            {/* MARCUL - Marine Farm/Culture (aquaculture) */}
            {/* Available at all zoom levels for route planning */}
            <Mapbox.FillLayer
              id={`mbtiles-marcul-${chartId}`}
              sourceLayerID={chartId}
              belowLayerID="chart-top-marker"
              minZoomLevel={0}
              filter={['==', ['get', '_layer'], 'MARCUL']}
              style={{
                fillColor: '#8B4513',  // Brown for aquaculture
                fillOpacity: 0.2,
                visibility: showMarineFarms ? 'visible' : 'none',
              }}
            />
            
            {/* === SECTION 4: LINES === */}
            
            {/* DEPCNT - Depth Contours */}
            {/* maxZoomLevel prevents crossing contours from overlapping chart scales */}
            <Mapbox.LineLayer
              id={`mbtiles-depcnt-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={chartMinZoom}
              maxZoomLevel={chartMaxZoom}
              filter={[
                'all',
                ['==', ['get', '_layer'], 'DEPCNT'],
                ['any',
                  ['!', ['has', 'SCAMIN']],
                  ['>=', ['get', 'SCAMIN'],
                    ['step', ['zoom'],
                      250000, 11, 100000, 12, 15000, 13, 0
                    ]
                  ]
                ]
              ]}
              style={{
                lineColor: [
                  'step',
                  ['coalesce', ['get', 'VALDCO'], 0],
                  '#1E3A5F', 2,      // 0-2m - dark blue (shallow, important)
                  '#2E5984', 5,      // 2-5m
                  '#4A7BA7', 10,     // 5-10m
                  '#6B9BC3', 20,     // 10-20m
                  '#8FBCD9', 50,     // 20-50m
                  '#B0D4E8',         // 50m+ - light blue
                ],
                lineWidth: [
                  'step',
                  ['coalesce', ['get', 'VALDCO'], 0],
                  1.5, 5, 1.0, 20, 0.7, 50, 0.5, // Simplified - no 0.1 threshold
                ],
                lineCap: 'round',
                lineJoin: 'round',
                visibility: showDepthContours ? 'visible' : 'none',
              }}
            />
            
            {/* COALNE - Coastline */}
            <Mapbox.LineLayer
              id={`mbtiles-coalne-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={chartMinZoom}
              maxZoomLevel={chartMaxZoom}
              filter={['==', ['get', '_layer'], 'COALNE']}
              style={{
                lineColor: '#000000',
                lineWidth: 1.5,
                lineCap: 'round',
                lineJoin: 'round',
                visibility: showCoastline ? 'visible' : 'none',
              }}
            />
            
            {/* LNDARE outline */}
            <Mapbox.LineLayer
              id={`mbtiles-lndare-outline-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={chartMinZoom}
              maxZoomLevel={chartMaxZoom}
              filter={['==', ['get', '_layer'], 'LNDARE']}
              style={{
                lineColor: '#8B7355',
                lineWidth: 1,
                visibility: showLand ? 'visible' : 'none',
              }}
            />
            
            {/* DRGARE outline */}
            <Mapbox.LineLayer
              id={`mbtiles-drgare-outline-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={chartMinZoom}
              filter={['==', ['get', '_layer'], 'DRGARE']}
              style={{
                lineColor: '#4682B4',
                lineWidth: 1.5,
                lineDasharray: [4, 2],
              }}
            />
            
            {/* FAIRWY outline */}
            <Mapbox.LineLayer
              id={`mbtiles-fairwy-outline-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={chartMinZoom}
              filter={['==', ['get', '_layer'], 'FAIRWY']}
              style={{
                lineColor: '#9370DB',
                lineWidth: 2,
                lineDasharray: [8, 4],
              }}
            />
            
            {/* CBLARE outline */}
            <Mapbox.LineLayer
              id={`mbtiles-cblare-outline-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={chartMinZoom}
              filter={['==', ['get', '_layer'], 'CBLARE']}
              style={{
                lineColor: '#800080',
                lineWidth: 1.5,
                lineDasharray: [4, 2],
                visibility: showCables ? 'visible' : 'none',
              }}
            />
            
            {/* CBLSUB - Submarine Cables (lines) */}
            <Mapbox.LineLayer
              id={`mbtiles-cblsub-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={chartMinZoom}
              filter={['==', ['get', '_layer'], 'CBLSUB']}
              style={{
                lineColor: '#800080',
                lineWidth: 2,
                lineDasharray: [4, 2],
                lineCap: 'round',
                visibility: showCables ? 'visible' : 'none',
              }}
            />
            
            {/* PIPARE outline */}
            <Mapbox.LineLayer
              id={`mbtiles-pipare-outline-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={chartMinZoom}
              filter={['==', ['get', '_layer'], 'PIPARE']}
              style={{
                lineColor: '#008000',
                lineWidth: 1.5,
                lineDasharray: [6, 3],
                visibility: showPipelines ? 'visible' : 'none',
              }}
            />
            
            {/* RESARE outline - Restricted Areas */}
            <Mapbox.LineLayer
              id={`mbtiles-resare-outline-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={0}
              filter={['==', ['get', '_layer'], 'RESARE']}
              style={{
                lineColor: [
                  'match',
                  ['get', 'CATREA'],
                  14, '#FF0000',    // Military - red
                  12, '#FF0000',    // Degaussing - red
                  4, '#00AA00',     // Nature reserve - green
                  7, '#00AA00',     // Bird sanctuary - green
                  8, '#00AA00',     // Game reserve - green
                  9, '#00AA00',     // Seal sanctuary - green
                  '#FF00FF',        // Default - magenta
                ],
                lineWidth: 2,
                lineDasharray: [6, 3],
                visibility: showRestrictedAreas ? 'visible' : 'none',
              }}
            />
            
            {/* CTNARE outline - Caution Areas */}
            <Mapbox.LineLayer
              id={`mbtiles-ctnare-outline-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={0}
              filter={['==', ['get', '_layer'], 'CTNARE']}
              style={{
                lineColor: '#FFA500',
                lineWidth: 2,
                lineDasharray: [6, 3],
                visibility: showCautionAreas ? 'visible' : 'none',
              }}
            />
            
            {/* MIPARE outline - Military Practice Areas */}
            <Mapbox.LineLayer
              id={`mbtiles-mipare-outline-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={0}
              filter={['==', ['get', '_layer'], 'MIPARE']}
              style={{
                lineColor: '#FF0000',
                lineWidth: 2,
                lineDasharray: [4, 2],
                visibility: showMilitaryAreas ? 'visible' : 'none',
              }}
            />
            
            {/* ACHARE outline - Anchorage Areas */}
            <Mapbox.LineLayer
              id={`mbtiles-achare-outline-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={0}
              filter={['==', ['get', '_layer'], 'ACHARE']}
              style={{
                lineColor: '#9400D3',
                lineWidth: 2,
                lineDasharray: [8, 4],
                visibility: showAnchorages ? 'visible' : 'none',
              }}
            />
            
            {/* MARCUL outline - Marine Farm/Culture */}
            <Mapbox.LineLayer
              id={`mbtiles-marcul-outline-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={0}
              filter={['==', ['get', '_layer'], 'MARCUL']}
              style={{
                lineColor: '#8B4513',
                lineWidth: 2,
                lineDasharray: [4, 2],
                visibility: showMarineFarms ? 'visible' : 'none',
              }}
            />
            
            {/* PIPSOL - Pipelines (lines) */}
            <Mapbox.LineLayer
              id={`mbtiles-pipsol-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={chartMinZoom}
              filter={['==', ['get', '_layer'], 'PIPSOL']}
              style={{
                lineColor: '#008000',
                lineWidth: 2.5,
                lineDasharray: [6, 3],
                lineCap: 'round',
                visibility: showPipelines ? 'visible' : 'none',
              }}
            />
            
            {/* === SECTION 5: TEXT/LABELS ON WATER === */}
            
            {/* DEPCNT Labels */}
            <Mapbox.SymbolLayer
              id={`mbtiles-depcnt-labels-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={Math.max(chartMinZoom, 12)}
              filter={[
                'all',
                ['==', ['get', '_layer'], 'DEPCNT'],
                ['any',
                  ['!', ['has', 'SCAMIN']],
                  ['>=', ['get', 'SCAMIN'],
                    ['step', ['zoom'], 250000, 11, 100000, 12, 15000, 13, 0]
                  ]
                ]
              ]}
              style={{
                textField: ['to-string', ['coalesce', ['get', 'VALDCO'], '']],
                textSize: 10,
                textColor: '#1E3A5F',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1.5,
                symbolPlacement: 'line',
                symbolSpacing: 300,
                textFont: ['Open Sans Regular'],
                textMaxAngle: 30,
                textAllowOverlap: false,
                visibility: showDepthContours ? 'visible' : 'none',
              }}
            />
            
            {/* SBDARE - Seabed composition (text only per S-52) */}
            <Mapbox.SymbolLayer
              id={`mbtiles-sbdare-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={chartMinZoom}
              filter={['all',
                ['==', ['get', '_layer'], 'SBDARE'],
                ['==', ['geometry-type'], 'Point'],
                ['has', 'NATSUR']
              ]}
              style={{
                textField: [
                  'case',
                  ['in', '11', ['to-string', ['get', 'NATSUR']]], 'Co',
                  ['in', '14', ['to-string', ['get', 'NATSUR']]], 'Sh',
                  ['in', '"1"', ['to-string', ['get', 'NATSUR']]], 'M',
                  ['in', '"2"', ['to-string', ['get', 'NATSUR']]], 'Cy',
                  ['in', '"3"', ['to-string', ['get', 'NATSUR']]], 'Si',
                  ['in', '"4"', ['to-string', ['get', 'NATSUR']]], 'S',
                  ['in', '"5"', ['to-string', ['get', 'NATSUR']]], 'St',
                  ['in', '"6"', ['to-string', ['get', 'NATSUR']]], 'G',
                  ['in', '"7"', ['to-string', ['get', 'NATSUR']]], 'P',
                  ['in', '"8"', ['to-string', ['get', 'NATSUR']]], 'Cb',
                  ['in', '"9"', ['to-string', ['get', 'NATSUR']]], 'R',
                  '',
                ],
                textSize: 10,
                textColor: '#6B4423',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1.5,
                textFont: ['Open Sans Italic'],
                textAllowOverlap: false,
                visibility: showSeabed ? 'visible' : 'none',
              }}
            />
            
            {/* SOUNDG - Soundings */}
            {/* maxZoomLevel prevents duplicate soundings from overlapping chart scales */}
            <Mapbox.SymbolLayer
              id={`mbtiles-soundg-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={chartMinZoom}
              maxZoomLevel={chartMaxZoom}
              filter={[
                'all',
                ['==', ['get', '_layer'], 'SOUNDG'],
                ['any',
                  ['!', ['has', 'SCAMIN']],
                  ['>=', ['get', 'SCAMIN'],
                    ['step', ['zoom'], 250000, 11, 100000, 12, 15000, 13, 0]
                  ]
                ]
              ]}
              style={{
                textField: ['to-string', ['round', ['get', 'DEPTH']]],
                textSize: 11,
                textColor: '#000080',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1.5,
                textAllowOverlap: false,
                textIgnorePlacement: false,
                visibility: showSoundings ? 'visible' : 'none',
              }}
            />
            
            {/* Cable/Pipeline labels */}
            <Mapbox.SymbolLayer
              id={`mbtiles-cblsub-label-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={12}
              filter={['==', ['get', '_layer'], 'CBLSUB']}
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
            
            <Mapbox.SymbolLayer
              id={`mbtiles-pipsol-label-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={12}
              filter={['==', ['get', '_layer'], 'PIPSOL']}
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
            
            {/* === SECTION 6: POINT SYMBOLS (bottom to top) === */}
            
            {/* WRECKS - Hazards */}
            <Mapbox.SymbolLayer
              id={`mbtiles-wrecks-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={chartMinZoom}
              maxZoomLevel={chartMaxZoom}
              filter={['all',
                ['==', ['get', '_layer'], 'WRECKS'],
                ['==', ['geometry-type'], 'Point'],
                ['any',
                  ['!', ['has', 'SCAMIN']],
                  ['>=', ['get', 'SCAMIN'], ['step', ['zoom'], 250000, 11, 100000, 12, 15000, 13, 0]]
                ]
              ]}
              style={{
                iconImage: [
                  'case',
                  ['==', ['get', 'CATWRK'], 5], 'wreck-hull',
                  ['any', ['==', ['get', 'CATWRK'], 2], ['==', ['get', 'WATLEV'], 5]], 'wreck-danger',
                  ['==', ['get', 'WATLEV'], 4], 'wreck-uncovers',
                  ['==', ['get', 'CATWRK'], 1], 'wreck-safe',
                  ['==', ['get', 'WATLEV'], 3], 'wreck-submerged',
                  'wreck-danger',
                ],
                iconSize: ['interpolate', ['linear'], ['zoom'], 8, 0.25, 12, 0.45, 16, 0.7],
                iconAllowOverlap: true,
                visibility: showHazards ? 'visible' : 'none',
              }}
            />
            
            {/* UWTROC - Underwater Rocks */}
            <Mapbox.SymbolLayer
              id={`mbtiles-uwtroc-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={chartMinZoom}
              maxZoomLevel={chartMaxZoom}
              filter={['all',
                ['==', ['get', '_layer'], 'UWTROC'],
                ['==', ['geometry-type'], 'Point'],
                ['any',
                  ['!', ['has', 'SCAMIN']],
                  ['>=', ['get', 'SCAMIN'], ['step', ['zoom'], 250000, 11, 100000, 12, 15000, 13, 0]]
                ]
              ]}
              style={{
                iconImage: [
                  'case',
                  ['==', ['get', 'WATLEV'], 5], 'rock-awash',
                  ['==', ['get', 'WATLEV'], 4], 'rock-uncovers',
                  'rock-submerged',
                ],
                iconSize: ['interpolate', ['linear'], ['zoom'], 8, 0.25, 12, 0.45, 16, 0.7],
                iconAllowOverlap: true,
                visibility: showHazards ? 'visible' : 'none',
              }}
            />
            <Mapbox.SymbolLayer
              id={`mbtiles-uwtroc-label-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={12}
              filter={['all',
                ['==', ['get', '_layer'], 'UWTROC'],
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
            
            {/* OBSTRN - Obstructions */}
            <Mapbox.SymbolLayer
              id={`mbtiles-obstrn-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={chartMinZoom}
              maxZoomLevel={chartMaxZoom}
              filter={['all',
                ['==', ['get', '_layer'], 'OBSTRN'],
                ['==', ['geometry-type'], 'Point'],
                ['any',
                  ['!', ['has', 'SCAMIN']],
                  ['>=', ['get', 'SCAMIN'], ['step', ['zoom'], 250000, 11, 100000, 12, 15000, 13, 0]]
                ]
              ]}
              style={{
                iconImage: [
                  'case',
                  ['any', ['==', ['get', 'CATOBS'], 6], ['==', ['get', 'CATOBS'], 7]], 'foul-ground',
                  'obstruction',
                ],
                iconSize: ['interpolate', ['linear'], ['zoom'], 8, 0.25, 12, 0.45, 16, 0.7],
                iconAllowOverlap: true,
                visibility: showHazards ? 'visible' : 'none',
              }}
            />
            
            {/* ACHBRT - Anchor Berths (specific anchorage positions) */}
            {/* Available at all zoom levels for route planning */}
            <Mapbox.SymbolLayer
              id={`mbtiles-achbrt-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={0}
              filter={['==', ['get', '_layer'], 'ACHBRT']}
              style={{
                iconImage: 'anchor',
                iconSize: ['interpolate', ['linear'], ['zoom'], 4, 0.2, 8, 0.3, 12, 0.5, 16, 0.7],
                iconAllowOverlap: true,
                visibility: showAnchorBerths ? 'visible' : 'none',
              }}
            />
            <Mapbox.SymbolLayer
              id={`mbtiles-achbrt-label-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={10}
              filter={['==', ['get', '_layer'], 'ACHBRT']}
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
            
            {/* All Buoys */}
            {/* BOYSHP: 1=conical, 2=can, 3=spherical, 4=pillar, 5=spar, 6=barrel, 7=super-buoy */}
            <Mapbox.SymbolLayer
              id={`mbtiles-buoys-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={chartMinZoom}
              maxZoomLevel={chartMaxZoom}
              filter={['all',
                ['any',
                  ['==', ['get', '_layer'], 'BOYLAT'],
                  ['==', ['get', '_layer'], 'BOYCAR'],
                  ['==', ['get', '_layer'], 'BOYSAW'],
                  ['==', ['get', '_layer'], 'BOYSPP'],
                  ['==', ['get', '_layer'], 'BOYISD'],
                ],
                ['any',
                  ['!', ['has', 'SCAMIN']],
                  ['>=', ['get', 'SCAMIN'], ['step', ['zoom'], 250000, 11, 100000, 12, 15000, 13, 0]]
                ]
              ]}
              style={{
                iconImage: [
                  'match',
                  ['get', 'BOYSHP'],
                  1, 'buoy-conical',    // Conical (nun)
                  2, 'buoy-can',        // Can (cylindrical)
                  3, 'buoy-spherical',  // Spherical
                  4, 'buoy-pillar',     // Pillar
                  5, 'buoy-spar',       // Spar
                  6, 'buoy-barrel',     // Barrel
                  7, 'buoy-super',      // Super buoy
                  'buoy-pillar',        // Default to pillar
                ],
                iconSize: [
                  'interpolate', ['linear'], ['zoom'],
                  8, 0.25,   // Small at zoom 8
                  12, 0.45,  // Medium at zoom 12
                  16, 0.7    // Full size at zoom 16+
                ],
                iconAllowOverlap: true,
                visibility: showBuoys ? 'visible' : 'none',
              }}
            />
            
            {/* All Beacons - S-52 symbols based on BCNSHP (beacon shape) */}
            {/* BCNSHP: 1=stake/pole, 2=withy, 3=tower, 4=lattice, 5=cairn, 6=buoyant */}
            <Mapbox.SymbolLayer
              id={`mbtiles-beacons-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={chartMinZoom}
              maxZoomLevel={chartMaxZoom}
              filter={['all',
                ['any',
                  ['==', ['get', '_layer'], 'BCNLAT'],
                  ['==', ['get', '_layer'], 'BCNSPP'],
                  ['==', ['get', '_layer'], 'BCNCAR'],
                  ['==', ['get', '_layer'], 'BCNISD'],
                  ['==', ['get', '_layer'], 'BCNSAW'],
                ],
                ['any',
                  ['!', ['has', 'SCAMIN']],
                  ['>=', ['get', 'SCAMIN'], ['step', ['zoom'], 250000, 11, 100000, 12, 15000, 13, 0]]
                ]
              ]}
              style={{
                iconImage: [
                  'match',
                  ['get', 'BCNSHP'],
                  1, 'beacon-stake',    // Stake/pole
                  2, 'beacon-withy',    // Withy
                  3, 'beacon-tower',    // Tower
                  4, 'beacon-lattice',  // Lattice
                  5, 'beacon-cairn',    // Cairn
                  'beacon-generic',     // Default
                ],
                iconSize: [
                  'interpolate', ['linear'], ['zoom'],
                  8, 0.25,   // Small at zoom 8
                  12, 0.45,  // Medium at zoom 12
                  16, 0.7    // Full size at zoom 16+
                ],
                iconAllowOverlap: true,
                visibility: showBeacons ? 'visible' : 'none',
              }}
            />
            
            {/* === SECTION 7: LIGHTS (on top of nav aids) === */}
            
            {/* Light Sector arcs - background outline (BEFORE symbols) */}
            <Mapbox.LineLayer
              id={`mbtiles-lights-sector-outline-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={chartMinZoom}
              maxZoomLevel={chartMaxZoom}
              filter={['all',
                ['==', ['get', '_layer'], 'LIGHTS_SECTOR'],
                ['any',
                  ['!', ['has', 'SCAMIN']],
                  ['>=', ['get', 'SCAMIN'], ['step', ['zoom'], 250000, 11, 100000, 12, 15000, 13, 0]]
                ]
              ]}
              style={{
                lineColor: '#000000',
                lineWidth: 7,
                lineOpacity: 0.7,
                visibility: showLights ? 'visible' : 'none',
              }}
            />
            
            {/* Colored sector arcs (rendered on top of outline) */}
            <Mapbox.LineLayer
              id={`mbtiles-lights-sector-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={chartMinZoom}
              maxZoomLevel={chartMaxZoom}
              filter={['all',
                ['==', ['get', '_layer'], 'LIGHTS_SECTOR'],
                ['any',
                  ['!', ['has', 'SCAMIN']],
                  ['>=', ['get', 'SCAMIN'], ['step', ['zoom'], 250000, 11, 100000, 12, 15000, 13, 0]]
                ]
              ]}
              style={{
                lineColor: [
                  'match',
                  ['to-string', ['get', 'COLOUR']],
                  '1', '#FFFFFF',        // White
                  '3', '#FF0000',        // RED (code 3)
                  '4', '#00FF00',        // GREEN (code 4)
                  '6', '#FFFF00',        // Yellow
                  '11', '#FFA500',       // Orange
                  '#FF00FF',             // Default MAGENTA (makes missing colors obvious)
                ],
                lineWidth: 4,
                lineOpacity: 1.0,
                visibility: showLights ? 'visible' : 'none',
              }}
            />
            
            {/* LIGHTS - Navigation Light symbols (ON TOP of sector arcs) */}
            <Mapbox.SymbolLayer
              id={`mbtiles-lights-${chartId}`}
              sourceLayerID={chartId}
              filter={['all',
                ['==', ['get', '_layer'], 'LIGHTS'],
                ['any',
                  ['!', ['has', 'SCAMIN']],
                  ['>=', ['get', 'SCAMIN'], ['step', ['zoom'], 250000, 11, 100000, 12, 15000, 13, 0]]
                ]
              ]}
              minZoomLevel={chartMinZoom}
              maxZoomLevel={chartMaxZoom}
              style={{
                iconImage: [
                  'case',
                  // Check for RED (code 3)
                  ['any',
                    ['==', ['get', 'COLOUR'], '["3"]'],
                    ['==', ['get', 'COLOUR'], '3'],
                    ['in', '"3"', ['to-string', ['get', 'COLOUR']]],
                  ],
                  'light-red',
                  // Check for GREEN (code 4)
                  ['any',
                    ['==', ['get', 'COLOUR'], '["4"]'],
                    ['==', ['get', 'COLOUR'], '4'],
                    ['in', '"4"', ['to-string', ['get', 'COLOUR']]],
                  ],
                  'light-green',
                  // Check for white (code 1) or yellow (code 6)
                  ['any',
                    ['==', ['get', 'COLOUR'], '["1"]'],
                    ['==', ['get', 'COLOUR'], '1'],
                    ['in', '"1"', ['to-string', ['get', 'COLOUR']]],
                    ['==', ['get', 'COLOUR'], '["6"]'],
                    ['==', ['get', 'COLOUR'], '6'],
                    ['in', '"6"', ['to-string', ['get', 'COLOUR']]],
                  ],
                  'light-white',
                  // Default - magenta
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
            
            {/* LNDMRK - Landmarks - S-52 symbols based on CATLMK */}
            {/* CATLMK: 1=cairn, 2=cemetery, 3=chimney, 4=dish aerial, 5=flagstaff, 6=flare stack, */}
            {/*         7=mast, 8=windsock, 9=monument, 10=column, 11=memorial plaque, 12=obelisk, */}
            {/*         13=statue, 14=cross, 15=dome, 16=radar scanner, 17=tower, 18=windmill, */}
            {/*         19=windmotor, 20=spire/minaret, 21=large rock/boulder */}
            <Mapbox.SymbolLayer
              id={`mbtiles-lndmrk-${chartId}`}
              sourceLayerID={chartId}
              minZoomLevel={chartMinZoom}
              maxZoomLevel={chartMaxZoom}
              filter={['all',
                ['==', ['get', '_layer'], 'LNDMRK'],
                ['==', ['geometry-type'], 'Point'],
                ['any',
                  ['!', ['has', 'SCAMIN']],
                  ['>=', ['get', 'SCAMIN'], ['step', ['zoom'], 250000, 11, 100000, 12, 15000, 13, 0]]
                ]
              ]}
              style={{
                iconImage: [
                  'match',
                  ['get', 'CATLMK'],
                  3, 'landmark-chimney',      // Chimney
                  5, 'landmark-flagpole',     // Flagstaff
                  7, 'landmark-mast',         // Mast
                  9, 'landmark-monument',     // Monument
                  10, 'landmark-monument',    // Column (use monument)
                  12, 'landmark-monument',    // Obelisk (use monument)
                  13, 'landmark-monument',    // Statue (use monument)
                  14, 'landmark-church',      // Cross (use church)
                  17, 'landmark-tower',       // Tower
                  18, 'landmark-windmill',    // Windmill
                  19, 'landmark-windmill',    // Windmotor (use windmill)
                  20, 'landmark-church',      // Spire/minaret (use church)
                  28, 'landmark-radio-tower', // Radio/TV tower
                  'landmark-tower',           // Default to tower
                ],
                iconSize: [
                  'interpolate', ['linear'], ['zoom'],
                  8, 0.25,   // Small at zoom 8
                  12, 0.45,  // Medium at zoom 12
                  16, 0.7    // Full size at zoom 16+
                ],
                iconAllowOverlap: true,
                visibility: showLandmarks ? 'visible' : 'none',
              }}
            />
            <Mapbox.SymbolLayer
              id={`mbtiles-lndmrk-label-${chartId}`}
              sourceLayerID={chartId}
              filter={['all',
                ['==', ['get', '_layer'], 'LNDMRK'],
                ['==', ['geometry-type'], 'Point']
              ]}
              minZoomLevel={11}
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
            </Mapbox.VectorSource>
        );
        })}

        {/* Marker layer to establish z-order boundary between charts and labels */}
        {/* Uses an empty ShapeSource with a CircleLayer as the anchor point */}
        {/* GNIS layers reference this to ensure they render above ALL chart content */}
        {tileServerReady && (
          <Mapbox.ShapeSource
            id="layer-order-marker-source"
            shape={{ type: 'FeatureCollection', features: [] }}
          >
            <Mapbox.CircleLayer
              id="chart-top-marker"
              style={{ circleRadius: 0, circleOpacity: 0 }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* GNIS Place Names Layer - Reference data from USGS */}
        {/* IMPORTANT: maxZoomLevel must match tippecanoe --maximum-zoom (14) */}
        {/* to prevent overzoom rendering issues */}
        {/* NOTE: These layers use aboveLayerID to ensure they appear above all chart content */}
        {tileServerReady && gnisAvailable && showPlaceNames && (
          <Mapbox.VectorSource
            id="gnis-names-source"
            tileUrlTemplates={[`${tileServer.getTileServerUrl()}/tiles/gnis_names_ak/{z}/{x}/{y}.pbf`]}
            maxZoomLevel={14}
          >
            {/* Water features - Bays, channels, sounds (highest priority) */}
            {/* textAllowOverlap: true ensures GNIS shows regardless of chart symbols */}
            <Mapbox.SymbolLayer
              id="gnis-water-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'water']}
              minZoomLevel={6}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['DIN Pro Medium', 'Arial Unicode MS Regular'],
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
            <Mapbox.SymbolLayer
              id="gnis-coastal-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'coastal']}
              minZoomLevel={6}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['DIN Pro Medium', 'Arial Unicode MS Regular'],
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
            <Mapbox.SymbolLayer
              id="gnis-landmark-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'landmark']}
              minZoomLevel={8}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['DIN Pro Italic', 'Arial Unicode MS Regular'],
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
            <Mapbox.SymbolLayer
              id="gnis-populated-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'populated']}
              minZoomLevel={6}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['DIN Pro Bold', 'Arial Unicode MS Bold'],
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
            <Mapbox.SymbolLayer
              id="gnis-stream-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'stream']}
              minZoomLevel={9}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['DIN Pro Italic', 'Arial Unicode MS Regular'],
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
            <Mapbox.SymbolLayer
              id="gnis-lake-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'lake']}
              minZoomLevel={9}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['DIN Pro Italic', 'Arial Unicode MS Regular'],
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
            <Mapbox.SymbolLayer
              id="gnis-terrain-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'terrain']}
              minZoomLevel={10}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['DIN Pro Regular', 'Arial Unicode MS Regular'],
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
          </Mapbox.VectorSource>
        )}

        {/* GPS Ship Position Marker */}
        {(showGPSPanel || showCompass) && gpsData.latitude !== null && gpsData.longitude !== null && (
          <Mapbox.PointAnnotation
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
          </Mapbox.PointAnnotation>
        )}

      </Mapbox.MapView>

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
        
        {/* Zoom controls at bottom */}
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
              <Text style={styles.debugStorageLabel}>Static (progressive):</Text>
              <Text style={styles.debugStorageValueSmall}>{chartsToRender.length}</Text>
            </View>
            <View style={styles.debugStorageRow}>
              <Text style={styles.debugStorageLabel}>Dynamic (viewport):</Text>
              <Text style={styles.debugStorageValueSmall}>{dynamicCharts.length}</Text>
            </View>
            {dynamicCharts.length > 0 && (
              <Text style={[styles.debugText, { fontSize: 10, marginTop: 4 }]}>
                Dynamic: {dynamicCharts.slice(0, 5).join(', ')}{dynamicCharts.length > 5 ? '...' : ''}
              </Text>
            )}
            <View style={styles.debugDivider} />
            
            <Text style={styles.debugSectionTitle}>All Charts</Text>
            <View style={styles.debugChartList}>
              {mbtilesCharts.map((chart, idx) => {
                const isRendering = allChartsToRender.includes(chart.chartId);
                const isDynamic = dynamicCharts.includes(chart.chartId);
                return (
                  <Text 
                    key={chart.chartId} 
                    style={[
                      styles.debugChartItem,
                      isRendering && { color: '#4CAF50' },
                      isDynamic && { color: '#2196F3' }
                    ]}
                  >
                    {chart.chartId}{isDynamic ? ' (D)' : isRendering ? ' (S)' : ''}
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
                setDynamicCharts([]);
                setLastDynamicCheck(null);
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

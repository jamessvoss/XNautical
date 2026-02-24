/**
 * Dynamic Chart Viewer - Renders downloaded charts from local cache
 * Full-featured viewer with all navigation layers
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, useReducer, startTransition, memo } from 'react';
import {
  View,
  Text,
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
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapLibre from '@maplibre/maplibre-react-native';
import * as chartCacheService from '../services/chartCacheService';

// Suppress noisy "Request failed due to a permanent error: Canceled" messages
// that flood the console when MapLibre cancels in-flight tile requests during panning.
MapLibre.Logger.setLogCallback((log: { tag?: string; message: string }) => {
  if (log.tag === 'Mbgl-HttpRequest' && log.message.startsWith('Request failed due to a permanent error: Canceled')) {
    return true; // swallow — don't log
  }
  // Suppress font 404s — tile server only has Noto Sans, not MapLibre's default "Open Sans" fallback
  if (log.message.includes('/fonts/') && (log.message.includes('not found') || log.message.includes('Failed to load glyph'))) {
    return true;
  }
  return false; // let all other messages through to default logging
});
import * as chartPackService from '../services/chartPackService';
import * as tileServer from '../services/tileServer';
// Extracted modules (Phase 1 refactor)
import { NAV_SYMBOLS, DISPLAY_FEATURES, SYMBOL_FEATURES, OBJL_PRIORITIES, LAYER_DISPLAY_NAMES, getDepthUnitSuffix, getLayerName } from './DynamicChartViewer/constants';
// Phase 2: Extracted hooks
import { useDisplaySettings } from './DynamicChartViewer/hooks/useDisplaySettings';
import { useStationData } from './DynamicChartViewer/hooks/useStationData';
import { useMapConfiguration } from './DynamicChartViewer/hooks/useMapConfiguration';
import type { Props, FeatureInfo, LoadedChartData, LoadedMBTilesChart, LoadedRasterChart, LayerVisibility } from './DynamicChartViewer/types';
import { initialLayerVisibility, layerVisibilityReducer } from './DynamicChartViewer/layerState';
import { getFeatureId, formatFeatureProperties } from './DynamicChartViewer/utils/featureFormatting';
import { styles } from './DynamicChartViewer/styles/chartViewerStyles';
import { debugStyles, diagStyles } from './DynamicChartViewer/styles/debugStyles';
import GPSMarkerView from './DynamicChartViewer/components/GPSMarkerView';
import NavDataOverlay from './DynamicChartViewer/components/NavDataOverlay';
import { useGPS } from '../hooks/useGPS';
import { useOverlay } from '../contexts/OverlayContext';
import { getCompassModeLabel } from '../utils/compassUtils';
import * as displaySettingsService from '../services/displaySettingsService';
import type { DisplaySettings } from '../services/displaySettingsService';
import { logger, LogCategory } from '../services/loggingService';
import { performanceTracker, StartupPhase, RuntimeMetric } from '../services/performanceTracker';
import * as themeService from '../services/themeService';
import type { S52DisplayMode } from '../services/themeService';
import { migrateLegacyPredictionDatabases, TideStation } from '../services/stationService';
import { tideCorrectionService } from '../services/tideCorrectionService';
import StationInfoModal from './StationInfoModal';
import TideDetailChart from './TideDetailChart';
import CurrentDetailChart from './CurrentDetailChart';
import BuoyDetailModal from './BuoyDetailModal';
import { Ionicons } from '@expo/vector-icons';
import { useWaypoints } from '../contexts/WaypointContext';
import { WaypointMapPin } from './WaypointIcons';
import { useRoutes } from '../contexts/RouteContext';
import RouteEditor from './RouteEditor';
import RoutesModal from './RoutesModal';
import ActiveNavigation from './ActiveNavigation';

interface TileSet {
  id: string;
  minZoom: number;
  maxZoom: number;
}

interface ChartScaleSource {
  sourceId: string;    // VectorSource id: 'charts-unified'
  packId: string;      // MBTiles pack id, e.g., 'd07_charts'
  scaleNumber: number; // Always 0 for unified source
  tileUrl: string;     // Tile URL template
  minZoom: number;     // 0
  maxZoom: number;     // 15
}

export default function DynamicChartViewer({ onNavigateToDownloads }: Props = {}) {
  // Waypoint context
  const { waypoints: userWaypoints, openCreationModal: openWaypointCreation, openEditModal: openWaypointEdit } = useWaypoints();
  // Route context
  const { activeRoute, addPointToActiveRoute, startNewRoute, showRoutesModal, openRoutesModal, closeRoutesModal, navigation } = useRoutes();
  const insets = useSafeAreaInsets();
  // Phase 2: Extracted hooks
  const { displaySettings, setDisplaySettings } = useDisplaySettings();
  const {
    tideStations, currentStations, liveBuoys,
    selectedBuoy, setSelectedBuoy, loadingBuoyDetail,
    tideIconMap, currentIconMap,
    selectedStation, setSelectedStation,
    detailChartTideStationId, setDetailChartTideStationId,
    detailChartCurrentStationId, setDetailChartCurrentStationId,
    handleBuoyClick, reloadStations,
  } = useStationData();
  const {
    s52Mode, setS52Mode, uiTheme, s52Colors,
    landImagery, setLandImagery, marineImagery, setMarineImagery,
    showVectorBasemap, hasLandRasterTiles, hasMarineRasterTiles,
    ecdisLand, ecdisMarine, ecdisColors,
    basemapPalette, themedStyles,
    hasLocalBasemap, setHasLocalBasemap,
    satelliteTileSets, setSatelliteTileSets,
    basemapTileSets, setBasemapTileSets,
    oceanTileSets, setOceanTileSets,
    terrainTileSets, setTerrainTileSets,
    hasLocalOcean, hasLocalTerrain,
    debugInfo, setDebugInfo, showDebug, setShowDebug,
    debugDiagnostics, debugHiddenSources, setDebugHiddenSources,
    debugIsSourceVisible, debugToggleSource,
    createRunDiagnostics,
    styleSwitchStartRef,
  } = useMapConfiguration();
  const mapRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  
  // Route UI state
  const [showRouteEditor, setShowRouteEditor] = useState(false);
  
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
  
  // Unified chart source: single VectorSource covering all zoom levels (z0-15).
  // Scale transitions are handled by bgFillScaleFilter/contourScaleFilter on _scaleNum.
  const [chartScaleSources, setChartScaleSources] = useState<ChartScaleSource[]>([]);

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
    trafficRoutes: showTrafficRoutes,
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
  const [showPlaceNames] = useState(true);
  const [showWaterNames] = useState(true);      // Bays, channels, sounds
  const [showCoastalNames] = useState(true);  // Capes, islands, beaches
  const [showLandmarkNames] = useState(true); // Summits, glaciers
  
  // Tide correction for depth soundings
  const [currentTideCorrection, setCurrentTideCorrection] = useState<number>(0);
  const [tideCorrectionStation, setTideCorrectionStation] = useState<TideStation | null>(null);

  // Handler for selecting a special feature (tide/current station, live buoy) from the picker
  const handleSpecialFeatureSelect = (feature: FeatureInfo) => {
    const specialType = feature.properties?._specialType;
    const id = feature.properties?.id as string | undefined;
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
  
  const [showPopulatedNames] = useState(true); // Towns, ports
  const [showStreamNames] = useState(false);    // Rivers, creeks (off by default - too many)
  const [showLakeNames] = useState(false);        // Lakes (off by default)
  const [showTerrainNames] = useState(false);  // Valleys, basins (off by default)

  // Scale coverage debug overlay
  const [showScaleDebug, setShowScaleDebug] = useState(false);

  // Memoized depth text field expression based on unit setting
  const depthTextFieldExpression = useMemo(() => {
    const unit = displaySettings.depthUnits;
    
    // Start with the depth value, optionally corrected for tide
    // IMPORTANT: The correction value must be a literal number in the expression, not a variable reference
    const depthValue = displaySettings.tideCorrectedSoundings && currentTideCorrection !== 0
      ? ['+', ['get', 'DEPTH'], currentTideCorrection]  // Embed the actual number
      : ['get', 'DEPTH'];
    
    console.log('[DepthExpression] tideCorrectedSoundings:', displaySettings.tideCorrectedSoundings, 
                'currentTideCorrection:', currentTideCorrection, 
                'depthValue:', JSON.stringify(depthValue));
    
    if (unit === 'feet') {
      // Convert meters to feet: depth * 3.28084
      return ['to-string', ['round', ['*', depthValue, 3.28084]]];
    } else if (unit === 'fathoms') {
      // Convert meters to fathoms: depth * 0.546807
      return ['to-string', ['round', ['*', depthValue, 0.546807]]];
    }
    // Default: meters
    return ['to-string', ['round', depthValue]];
  }, [displaySettings.depthUnits, displaySettings.tideCorrectedSoundings, currentTideCorrection]);

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

  // Memoized scaled Sea Area Names text settings
  const scaledSeaAreaNamesFontSize = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    8, Math.round(10 * displaySettings.seaAreaNamesFontScale),
    12, Math.round(14 * displaySettings.seaAreaNamesFontScale),
  ], [displaySettings.seaAreaNamesFontScale]);

  const scaledSeaAreaNamesHalo = useMemo(() =>
    1.5 * displaySettings.seaAreaNamesHaloScale,
    [displaySettings.seaAreaNamesHaloScale]
  );

  const scaledSeaAreaNamesOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.seaAreaNamesOpacityScale)),
    [displaySettings.seaAreaNamesOpacityScale]
  );

  // Memoized scaled Seabed Names text settings
  const scaledSeabedNamesFontSize = useMemo(() =>
    Math.round(10 * displaySettings.seabedNamesFontScale),
    [displaySettings.seabedNamesFontScale]
  );

  const scaledSeabedNamesHalo = useMemo(() =>
    1.5 * displaySettings.seabedNamesHaloScale,
    [displaySettings.seabedNamesHaloScale]
  );

  const scaledSeabedNamesOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.seabedNamesOpacityScale)),
    [displaySettings.seabedNamesOpacityScale]
  );

  // Memoized scaled line widths
  const scaledDepthContourLineWidth = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    4, 0.3 * displaySettings.depthContourLineScale,
    8, 0.5 * displaySettings.depthContourLineScale,
    12, 0.8 * displaySettings.depthContourLineScale,
    16, 1.2 * displaySettings.depthContourLineScale,
  ], [displaySettings.depthContourLineScale]);

  const scaledCoastlineLineWidth = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    4, 0.3 * displaySettings.coastlineLineScale,
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
    4, (0.3 * displaySettings.depthContourLineScale) + scaledDepthContourLineHalo,
    8, (0.5 * displaySettings.depthContourLineScale) + scaledDepthContourLineHalo,
    12, (0.8 * displaySettings.depthContourLineScale) + scaledDepthContourLineHalo,
    16, (1.2 * displaySettings.depthContourLineScale) + scaledDepthContourLineHalo,
  ], [displaySettings.depthContourLineScale, scaledDepthContourLineHalo]);

  const scaledCoastlineHaloWidth = useMemo(() => [
    'interpolate', ['linear'], ['zoom'],
    4, (0.3 * displaySettings.coastlineLineScale) + scaledCoastlineHalo,
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

  // Live buoy text scaling
  const scaledLiveBuoyTextSize = useMemo(() => {
    const baseSize = 12 * (displaySettings.liveBuoyTextSizeScale ?? 1.0);
    return [
      'interpolate', ['linear'], ['zoom'],
      8, baseSize * 0.7,   // 70% at z8
      12, baseSize          // 100% at z12
    ];
  }, [displaySettings.liveBuoyTextSizeScale]);

  const scaledLiveBuoyTextHalo = useMemo(() => 
    15 * (displaySettings.liveBuoyTextHaloScale ?? 0.05),
    [displaySettings.liveBuoyTextHaloScale]
  );

  const scaledLiveBuoyTextOpacity = useMemo(() => 
    Math.min(1, Math.max(0, displaySettings.liveBuoyTextOpacityScale ?? 1.0)),
    [displaySettings.liveBuoyTextOpacityScale]
  );

  // Note: Symbol halos disabled - will implement with white symbol versions later
  // The halo settings are preserved in DisplaySettings for future use
  
  // UI state
  const [currentZoom, setCurrentZoom] = useState(8);

  // Dynamic sector arc state (screen-constant per S-52 §3.1.5)
  const [sectorArcFeatures, setSectorArcFeatures] = useState<{
    type: 'FeatureCollection'; features: any[];
  }>({ type: 'FeatureCollection', features: [] });
  const sectorArcDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Complete sector light index — loaded once from points.mbtiles metadata.
  // This is a deterministic, complete list embedded by the compose pipeline.
  interface SectorLight {
    lon: number; lat: number; sectr1: number; sectr2: number; colour: number; scamin: number; scaleNum?: number; maxZoom?: number;
    valnmr?: number;
  }
  const sectorLightIndexRef = useRef<SectorLight[]>([]);
  // M_COVR coverage boundaries per scale — loaded from points.mbtiles metadata.
  // Used for ECDIS usage band filtering (suppressing lower-scale features in areas
  // covered by higher-scale charts). Keys are scale numbers as strings.
  const coverageBoundariesRef = useRef<Record<string, any>>({});
  // Points VectorSource tile URL — set during chart loading when points-*.mbtiles is found.
  // All point features (soundings, nav-aids, hazards) served from a single MBTiles file.
  const [pointsTileUrl, setPointsTileUrl] = useState<string | null>(null);


  const [centerCoord, setCenterCoordState] = useState<[number, number]>([-151.55, 59.64]);
  const centerCoordRef = useRef<[number, number]>([-151.55, 59.64]);
  const setCenterCoord = useCallback((coord: [number, number]) => {
    centerCoordRef.current = coord;
    // NOTE: No longer calling setCenterCoordState(coord) here.
    // Setting state triggered a DCV re-render, which caused MapLibre to fire
    // another onRegionDidChange, creating an infinite feedback loop (~9/sec)
    // even without user interaction. The ref is sufficient — scale bar and
    // coordinate display read from centerCoordRef.current at next render.
  }, []);
  const [selectedFeature, setSelectedFeature] = useState<FeatureInfo | null>(null);
  const [featureChoices, setFeatureChoices] = useState<FeatureInfo[] | null>(null); // Multiple features to choose from
  const [showLayerSelector, setShowLayerSelector] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  
  // Control panel tabs
  type ControlPanelTab = 'display' | 'symbols' | 'other';
  const [activeTab, setActiveTab] = useState<ControlPanelTab>('display');
  const [selectedDisplayFeature, setSelectedDisplayFeature] = useState<string>('soundings');
  const [selectedSymbolFeature, setSelectedSymbolFeature] = useState<string>('lights');
  const [symbolEditMode, setSymbolEditMode] = useState<'symbol' | 'text'>('symbol');
  
  // Track tap start time for end-to-end performance measurement
  const tapStartTimeRef = useRef<number>(0);
  
  
  // GPS and Navigation state - overlay visibility from context (rendered in App.tsx)
  const { showCompass, compassMode, cycleCompassMode, updateGPSData, setShowTideDetails: setContextTideDetails, setShowCurrentDetails: setContextCurrentDetails, showDebugMap, setShowDebugMap, showNavData, setShowNavData, mapResetKey } = useOverlay();
  const [followGPS, setFollowGPS] = useState(true); // Follow mode - center map on position
  const followGPSRef = useRef(true); // Ref for immediate follow mode check (avoids race condition)
  const isProgrammaticCameraMove = useRef(false); // Flag to distinguish programmatic vs user camera moves
  const { gpsDataRef, startTracking } = useGPS();
  
  // Background color for the map — derived from S-52 color table per mode.
  // We do NOT use the mapStyle prop on MapView because setting it triggers
  // native removeAllSourcesFromMap() on every style change, which races with
  // child VectorSource registration and prevents tiles from loading.
  // Instead, we let MapView use its default style and cover it with a BackgroundLayer.
  const mapBackgroundColor = useMemo(() => {
    if (ecdisLand) return '#FFFFFF';
    switch (landImagery) {
      case 'satellite': return '#0A0A10';
      case 'terrain': return '#dfe6e9';
      case 'street': return s52Mode === 'day' ? '#f5f5f5' : '#1a1a2e';
      default: return '#1a1a2e';
    }
  }, [landImagery, ecdisLand, s52Mode]);

  // Memoize composite tile URL to prevent constant VectorSource re-renders
  const compositeTileUrl = useMemo(() => {
    return `${tileServer.getTileServerUrl()}/tiles/{z}/{x}/{y}.pbf`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileServerReady]); // Only recalculate if server restarts

  // Create runDiagnostics from hook factory (needs local component state)
  const runDiagnostics = useMemo(() => createRunDiagnostics({
    tileServerReady, gnisAvailable, useMBTiles,
    showGNISNames, showPlaceNames, mapRef,
  }), [createRunDiagnostics, tileServerReady, gnisAvailable, useMBTiles, showGNISNames, showPlaceNames]);

  // Update overlay context with GPS data (reads from ref — no re-render dependency)
  useEffect(() => {
    updateGPSData(gpsDataRef.current);
    const interval = setInterval(() => {
      updateGPSData(gpsDataRef.current);
    }, 1000);
    return () => clearInterval(interval);
  }, [gpsDataRef, updateGPSData]);

  // Sync detail chart visibility with overlay context (for compass positioning)
  useEffect(() => {
    setContextTideDetails(showTideDetails);
  }, [showTideDetails, setContextTideDetails]);
  
  useEffect(() => {
    setContextCurrentDetails(showCurrentDetails);
  }, [showCurrentDetails, setContextCurrentDetails]);
  
  // Tide correction management - use map viewport center, not GPS position
  useEffect(() => {
    if (!displaySettings.tideCorrectedSoundings) {
      // Setting is off - reset correction and stop updates
      setCurrentTideCorrection(0);
      setTideCorrectionStation(null);
      tideCorrectionService.stopAutoUpdate();
      return;
    }
    
    // Setting is on - start auto-updating tide correction based on map center
    // Uses centerCoordRef (not centerCoord state) to avoid restarting on every camera move
    tideCorrectionService.startAutoUpdate(() => {
      const coord = centerCoordRef.current;
      if (coord && coord.length === 2) {
        const [lng, lat] = coord;
        return { lat, lng };
      }
      return null;
    });

    // Subscribe to tide correction updates
    const unsubscribe = tideCorrectionService.subscribe((correction, station) => {
      setCurrentTideCorrection(correction);
      setTideCorrectionStation(station);
    });

    return () => {
      unsubscribe();
      tideCorrectionService.stopAutoUpdate();
    };
  }, [displaySettings.tideCorrectedSoundings, tideStations]);
  
  // Zoom limiting - constrain zoom to available chart detail
  const [limitZoomToCharts] = useState(true);
  const [, setIsAtMaxZoom] = useState(false);
  
  
  // Calculate max zoom based on most detailed chart available
  // Chart scale max zoom levels (from convert.py tippecanoe settings):
  // US1: z0-8, US2: z0-10, US3: z4-13, US4: z6-15, US5: z8-15, US6: z6-15
  const getChartMaxZoom = useCallback((chartId: string): number => {
    const match = chartId.match(/^US(\d)/);
    if (!match) return 15; // Non-US charts, cap at z15
    const scaleNum = parseInt(match[1], 10);

    switch (scaleNum) {
      case 1: return 8;   // US1 Overview
      case 2: return 10;  // US2 General
      case 3: return 13;  // US3 Coastal
      case 4: return 15;  // US4 Approach
      case 5: return 15;  // US5 Harbor
      default: return 15; // US6 Berthing
    }
  }, []);

  // Find the maximum zoom level across all loaded charts
  const maxAvailableZoom = useMemo(() => {
    if (mbtilesCharts.length === 0) return 15;
    
    const maxZoom = mbtilesCharts.reduce((max, chart) => {
      const chartMax = getChartMaxZoom(chart.chartId);
      return Math.max(max, chartMax);
    }, 0);
    
    return maxZoom;
  }, [mbtilesCharts, getChartMaxZoom]);
  
  // Effective max zoom (either limited by charts or unlimited)
  const effectiveMaxZoom = limitZoomToCharts ? maxAvailableZoom : 15;
  
  // Cache buster to force Mapbox to re-fetch tiles
  const [cacheBuster, setCacheBuster] = useState(0);

  // Track last manifest modification time to detect downloads
  const lastManifestTimeRef = useRef<number>(0);
  const lastStationsTimeRef = useRef<number>(0);
  const initialLoadCompleteRef = useRef<boolean>(false);
  // Guard: only set camera center on the FIRST loadCharts call.
  // Subsequent reloads (focus-effect, style change) must NOT reset the camera
  // because the MapView may remount (key change) and re-apply defaultSettings.
  const hasSetInitialCenterRef = useRef<boolean>(false);
  
  // Load cached charts on mount
  useEffect(() => {
    loadCharts();

    // Cleanup on unmount
    return () => {
      tileServer.stopTileServer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // Check if any data was downloaded and reload when returning to map screen
  useFocusEffect(
    useCallback(() => {
      // Skip until initial loadCharts() completes — otherwise state is all zeros
      // and every file comparison triggers a spurious "data changed" reload
      if (!initialLoadCompleteRef.current) return;

      const checkChangesAndReload = async () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const FileSystem = require('expo-file-system/legacy');
          const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
          const mbtilesDir = `${FileSystem.documentDirectory}mbtiles`;
          
          let needsFullReload = false;
          
          // Check for manifest changes (chart downloads)
          const manifestPath = `${mbtilesDir}/manifest.json`;
          const manifestInfo = await FileSystem.getInfoAsync(manifestPath);
          if (manifestInfo.exists && manifestInfo.modificationTime) {
            const currentTime = manifestInfo.modificationTime;
            if (lastManifestTimeRef.current === 0) {
              // Manifest appeared for the first time (wasn't present during initial load)
              logger.info(LogCategory.CHARTS, 'Manifest appeared - will reload charts');
              needsFullReload = true;
            } else if (currentTime > lastManifestTimeRef.current) {
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
                // Count tile files using patterns that match both legacy and multi-region naming
                const currentSatelliteCount = files.filter((f: string) => f.includes('satellite_z') && f.endsWith('.mbtiles')).length;
                const currentBasemapCount = files.filter((f: string) => f.includes('_basemap') && f.endsWith('.mbtiles')).length;
                const currentOceanCount = files.filter((f: string) => f.includes('_ocean') && f.endsWith('.mbtiles')).length;
                const currentTerrainCount = files.filter((f: string) => f.includes('_terrain') && f.endsWith('.mbtiles')).length;
                const hasGnis = files.some((f: string) => f === 'gnis_names.mbtiles');
                const hasBasemap = currentBasemapCount > 0;
                
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
            } catch {
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
              await reloadStations();
            }

            lastStationsTimeRef.current = currentStationsTime;
          }
        } catch (error) {
          logger.warn(LogCategory.CHARTS, 'Failed to check for updates', { error: (error as Error).message });
        }
      };
      
      checkChangesAndReload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [satelliteTileSets.length, basemapTileSets.length, oceanTileSets.length, terrainTileSets.length, hasLocalBasemap, gnisAvailable])
  );

  // Mark loading complete — unified VectorSource handles all zoom levels directly.
  useEffect(() => {
    setLoadingPhase('complete');
  }, []);
  
  // Auto-start GPS tracking when map loads - always show user's location
  useEffect(() => {
    startTracking();
    // Don't stop tracking on unmount - let the hook handle cleanup
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      
      // Run one-time migration for legacy prediction database filenames
      try {
        await migrateLegacyPredictionDatabases();
      } catch (migrationError) {
        console.warn('[MAP] Legacy prediction migration failed (non-critical):', migrationError);
      }
      
      // eslint-disable-next-line @typescript-eslint/no-require-imports
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
      let manifest: { packs?: { id: string; minZoom: number; maxZoom: number; fileSize?: number; bounds?: { south: number; west: number; north: number; east: number } }[]; basePacks?: { id: string }[] } | null = null;
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

          // Set initial map center from manifest bounds — ONLY on the very first load.
          // On subsequent reloads (focus-effect, data changes) preserve the user's
          // current viewport so the map doesn't snap back to the district center.
          const firstBounds = (manifest?.packs || []).find(p => p.bounds)?.bounds;
          if (firstBounds && !hasSetInitialCenterRef.current) {
            hasSetInitialCenterRef.current = true;
            const centerLng = (firstBounds.west + firstBounds.east) / 2;
            const centerLat = (firstBounds.south + firstBounds.north) / 2;
            setCenterCoord([centerLng, centerLat]);
            // Move camera to chart center (defaultSettings only applies on mount)
            setTimeout(() => {
              cameraRef.current?.setCamera({
                centerCoordinate: [centerLng, centerLat],
                zoomLevel: 6,
                animationDuration: 0,
              });
            }, 100);
            logger.debug(LogCategory.CHARTS, `Chart center from manifest: [${centerLng.toFixed(2)}, ${centerLat.toFixed(2)}]`);
          }
          // Seed the modification-time ref so the focus-effect can detect
          // future manifest changes (e.g. new chart downloads).
          if (manifestInfo.modificationTime) {
            lastManifestTimeRef.current = manifestInfo.modificationTime;
          }
        } else {
          logger.info(LogCategory.CHARTS, 'No manifest.json found - will scan directory');
          logger.setStartupParam('manifestLoaded', false);
        }
      } catch (e) {
        logger.warn(LogCategory.CHARTS, 'Error loading manifest.json', { error: e });
      }
      performanceTracker.endPhase(StartupPhase.MANIFEST_LOAD, { packsCount: chartPacks.length });
      
      
      // === PHASE 3: Check for special files (GNIS, satellite, basemap, ocean, terrain) ===
      performanceTracker.startPhase(StartupPhase.SPECIAL_FILES);
      const gnisInfo = await FileSystem.getInfoAsync(`${mbtilesDir}/gnis_names.mbtiles`);
      
      const gnisFound = gnisInfo.exists;
      
      setGnisAvailable(gnisFound);
      
      // Helper: scan for per-zoom MBTiles files matching a type pattern.
      // Supports both legacy (type_z8.mbtiles) and multi-region (prefix_type_z8.mbtiles) naming.
      // Returns sorted TileSet[] with unique zoom ranges (deduped across districts).
      const scanTileSets = (filesInDir: string[], tileType: string): TileSet[] => {
        const sets: TileSet[] = [];
        // Match zoom-suffixed files: e.g., d07_ocean_z0-5.mbtiles, satellite_z8.mbtiles
        const zoomPattern = new RegExp(`(?:^|_)${tileType}_z(\\d+)(?:-(\\d+))?\\.mbtiles$`);
        // Match monolithic files without zoom suffix: e.g., d07_ocean.mbtiles
        const singlePattern = new RegExp(`(?:^|_)${tileType}\\.mbtiles$`);
        for (const filename of filesInDir) {
          const zoomMatch = filename.match(zoomPattern);
          if (zoomMatch) {
            const minZoom = parseInt(zoomMatch[1], 10);
            const maxZoom = zoomMatch[2] ? parseInt(zoomMatch[2], 10) : minZoom;
            sets.push({ id: filename.replace('.mbtiles', ''), minZoom, maxZoom });
          } else if (filename.match(singlePattern)) {
            sets.push({ id: filename.replace('.mbtiles', ''), minZoom: 0, maxZoom: 15 });
          }
        }
        return sets.sort((a, b) => a.minZoom - b.minZoom);
      };

      // Scan directory for all tile set types (across all installed districts)
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
          basemapFound = filesInDir.some((f: string) => f.startsWith('basemap') && f.endsWith('.mbtiles'));
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
          } catch {
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
                  // Track if we found chart pack files (alaska_US*, d07_charts, etc.)
                  if (chartId.match(/^[a-z]\w+_(US\d|charts)$/)) {
                    hasChartPacks = true;
                  }
                }
              }
            }
            
            // If we found chart packs but no manifest, generate one for the native tile server
            if (hasChartPacks) {
              logger.info(LogCategory.CHARTS, 'Found chart packs without manifest - generating manifest.json for tile server');
              await chartPackService.generateManifest();
              
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
            
            // Find unified chart pack (composed by compose_job.py)
            const unifiedPack = loadedMbtiles.find(m => m.chartId.endsWith('_charts'));
            const scaleSources: ChartScaleSource[] = [];

            if (unifiedPack) {
              scaleSources.push({
                sourceId: 'charts-unified',
                packId: unifiedPack.chartId,
                scaleNumber: 0,
                tileUrl: `${serverUrl}/tiles/${unifiedPack.chartId}/{z}/{x}/{y}.pbf`,
                minZoom: 0,
                maxZoom: 15,
              });
              logger.info(LogCategory.CHARTS, `Unified chart source: ${unifiedPack.chartId} z0-15`);
            } else {
              logger.warn(LogCategory.CHARTS, 'No unified chart pack found (*_charts.mbtiles)');
            }

            setChartScaleSources(scaleSources);
            logger.info(LogCategory.CHARTS, `Chart rendering: ${scaleSources.length} source(s)`);

            // Detect points MBTiles (all point features: soundings, nav-aids, hazards).
            // Served as a VectorSource — no JSON parsing, no ShapeSource, no JS bridge overhead.
            const pointsPack = loadedMbtiles.find(m => m.chartId.startsWith('points-'));
            if (pointsPack) {
              setPointsTileUrl(`${serverUrl}/tiles/${pointsPack.chartId}/{z}/{x}/{y}.pbf`);
              logger.info(LogCategory.CHARTS, `Points VectorSource: ${pointsPack.chartId}`);

              // Load sector light index from MBTiles metadata (embedded by compose pipeline).
              // This is a complete, deterministic list — no queryRenderedFeaturesInRect needed.
              try {
                const meta = await tileServer.getMetadata(pointsPack.chartId);
                if (meta?.sector_lights) {
                  const sectorLights = JSON.parse(meta.sector_lights);
                  sectorLightIndexRef.current = sectorLights;
                  logger.info(LogCategory.CHARTS, `Sector light index: ${sectorLights.length} lights loaded from metadata`);
                } else {
                  logger.warn(LogCategory.CHARTS, 'No sector_lights in points.mbtiles metadata');
                }
                if (meta?.coverage_boundaries) {
                  const boundaries = JSON.parse(meta.coverage_boundaries);
                  coverageBoundariesRef.current = boundaries;
                  logger.info(LogCategory.CHARTS, `Coverage boundaries: ${Object.keys(boundaries).length} scales loaded from metadata`);
                }
              } catch (e) {
                logger.warn(LogCategory.CHARTS, `Failed to load points.mbtiles metadata: ${e}`);
              }
            }

            const chartSummary = `${loadedMbtiles.length} mbtiles (${scaleSources.length > 0 ? 'unified' : 'none'})`;
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
      performanceTracker.completeStartup();
      logger.info(LogCategory.STARTUP, `Tile mode: MULTI-SOURCE (lazy-loaded by zoom, cached layers)`);
      logger.info(LogCategory.STARTUP, `Special files: GNIS=${gnisFound}, Basemap=${foundBasemapSets.length} sets, Ocean=${foundOceanSets.length} sets, Terrain=${foundTerrainSets.length} sets`);
      
    } catch (error) {
      logger.error(LogCategory.STARTUP, 'STARTUP ERROR', error as Error);
      Alert.alert('Error', 'Failed to load cached charts');
    } finally {
      setLoading(false);
      initialLoadCompleteRef.current = true;
    }
  };

  // ─── Dynamic sector arc generation (screen-constant per S-52 §3.1.5) ───
  const TARGET_ARC_PIXELS = 60; // dp — arc radius in screen pixels at all zoom levels

  const updateSectorArcsRef = useRef<() => void>(() => {});
  updateSectorArcsRef.current = async () => {
    if (!mapRef.current || !showLights) return;

    const zoom = currentZoom;
    // Skip arc generation below z6 — sector arcs aren't useful at overview zoom
    // and the query is expensive (CircleLayer not rendered below z6).
    if (zoom < 6) {
      setSectorArcFeatures({ type: 'FeatureCollection', features: [] });
      return;
    }

    const [lng, lat] = centerCoordRef.current;
    // Calibrate dp-to-degrees conversion directly from the map.
    // This avoids metersPerPixel/PixelRatio/Mercator-distortion issues.
    const centerScreen = await mapRef.current.getPointInView([lng, lat]);
    const rightScreen = [centerScreen[0] + TARGET_ARC_PIXELS, centerScreen[1]];
    const belowScreen = [centerScreen[0], centerScreen[1] + TARGET_ARC_PIXELS];
    const rightCoord = await mapRef.current.getCoordinateFromView(rightScreen);
    const belowCoord = await mapRef.current.getCoordinateFromView(belowScreen);
    const dpToDegreesLon = Math.abs(rightCoord[0] - lng);
    const dpToDegreesLat = Math.abs(belowCoord[1] - lat);

    const { width, height } = Dimensions.get('window');

    // Determine viewport bounds for spatial filtering
    const halfWidthDeg = dpToDegreesLon * width / TARGET_ARC_PIXELS / 2;
    const halfHeightDeg = dpToDegreesLat * height / TARGET_ARC_PIXELS / 2;
    const viewWest = lng - halfWidthDeg;
    const viewEast = lng + halfWidthDeg;
    const viewSouth = lat - halfHeightDeg;
    const viewNorth = lat + halfHeightDeg;
    // Generous padding (1.5x viewport) so arcs near edges are included
    const padLon = halfWidthDeg * 1.5;
    const padLat = halfHeightDeg * 1.5;

    // SCAMIN filter in JS: show arc if the light's SCAMIN makes it visible at current zoom
    const scaminVisible = (scamin: number) => {
      if (!scamin || !isFinite(scamin)) return true; // No SCAMIN (0) = always visible
      const minZoom = 28 - scaminOffset - Math.log2(scamin);
      return zoom >= minZoom;
    };

    // Filter sector lights from the complete index by viewport bounds + SCAMIN.
    // The index is loaded once from points.mbtiles metadata — always complete.
    const sectorLights = sectorLightIndexRef.current;

    // Generate arc + sector leg geometries using screen-calibrated dp-to-degrees.
    // Per S-52 §3.1.5: sector legs at fixed 25mm screen size (~60dp).
    const arcFeatures: any[] = [];

    for (const light of sectorLights) {
      // Viewport bounds check with generous padding
      if (light.lon < viewWest - padLon || light.lon > viewEast + padLon ||
          light.lat < viewSouth - padLat || light.lat > viewNorth + padLat) continue;
      if (!scaminVisible(light.scamin)) continue;
      // ECDIS usage band: suppress sector lights past their scale's native zoom range
      if (light.maxZoom !== undefined && zoom > light.maxZoom) continue;

      // Physical ceiling + mobile clamp: min(VALNMR_degrees, screen_constant_degrees)
      // VALNMR is in nautical miles. 1 NM = 1/60 degree of latitude.
      let effectiveRadiusLon = dpToDegreesLon;
      let effectiveRadiusLat = dpToDegreesLat;
      if (light.valnmr != null && light.valnmr > 0) {
        const valnmrDegreesLat = light.valnmr / 60;
        const valnmrDegreesLon = valnmrDegreesLat / Math.cos(light.lat * Math.PI / 180);
        effectiveRadiusLon = Math.min(valnmrDegreesLon, dpToDegreesLon);
        effectiveRadiusLat = Math.min(valnmrDegreesLat, dpToDegreesLat);
      }

      // S-52: SECTR1/SECTR2 are bearings FROM SEAWARD toward the light.
      // The light shines OUTWARD: add 180° to get the direction it illuminates.
      const startBearing = (light.sectr1 + 180) % 360;
      const endBearing = (light.sectr2 + 180) % 360;
      let arcSpan = ((endBearing - startBearing) % 360 + 360) % 360;
      if (arcSpan === 0 && light.sectr1 !== light.sectr2) arcSpan = 360;
      if (arcSpan < 1) arcSpan = 1;

      const startRad = startBearing * Math.PI / 180;
      const endRad = (startBearing + arcSpan) * Math.PI / 180;

      // Sector leg endpoints (at arc radius distance from light)
      const legEnd1: [number, number] = [
        light.lon + effectiveRadiusLon * Math.sin(startRad),
        light.lat + effectiveRadiusLat * Math.cos(startRad),
      ];
      const legEnd2: [number, number] = [
        light.lon + effectiveRadiusLon * Math.sin(endRad),
        light.lat + effectiveRadiusLat * Math.cos(endRad),
      ];

      // Sector leg 1 (light center → arc start)
      arcFeatures.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[light.lon, light.lat], legEnd1] },
        properties: { COLOUR: light.colour, _type: 'leg' },
      });
      // Sector leg 2 (light center → arc end)
      arcFeatures.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[light.lon, light.lat], legEnd2] },
        properties: { COLOUR: light.colour, _type: 'leg' },
      });

      // Arc curve connecting leg endpoints
      const numPoints = Math.max(8, Math.floor(32 * arcSpan / 90));
      const arcCoords: [number, number][] = [];
      for (let i = 0; i <= numPoints; i++) {
        const bearing = startBearing + arcSpan * (i / numPoints);
        const bearingRad = bearing * Math.PI / 180;
        arcCoords.push([
          light.lon + effectiveRadiusLon * Math.sin(bearingRad),
          light.lat + effectiveRadiusLat * Math.cos(bearingRad),
        ]);
      }
      arcFeatures.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: arcCoords },
        properties: { COLOUR: light.colour, _type: 'arc' },
      });
    }

    logger.info(LogCategory.CHARTS, `[SECTOR-ARC] Generated ${arcFeatures.length} arc features from ${sectorLights.length} sector lights in index`);
    setSectorArcFeatures({ type: 'FeatureCollection', features: arcFeatures });
  };

  // Clear arcs when lights layer is turned off
  useEffect(() => {
    if (!showLights) {
      setSectorArcFeatures({ type: 'FeatureCollection', features: [] });
    }
  }, [showLights]);

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
      const roundedZoom = Math.round(state.properties.zoom * 10) / 10;
      setCurrentZoom(prev => prev === roundedZoom ? prev : roundedZoom);
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

  // Process camera state — full state update (triggers re-render for scale bar, layers, etc.)
  // Used by onRegionDidChange (pan/zoom end) for final position
  const processCameraState = useCallback((feature: any) => {
    if (feature?.geometry?.coordinates) {
      const [lng, lat] = feature.geometry.coordinates;
      setCenterCoord([lng, lat]);
    }
    const zoom = feature?.properties?.zoomLevel ?? feature?.properties?.zoom;
    if (zoom !== undefined) {
      const roundedZoom = Math.round(zoom * 10) / 10;
      // Only update state if zoom actually changed — avoids unnecessary re-renders
      // that cause MapLibre to cancel in-flight tile requests
      setCurrentZoom(prev => prev === roundedZoom ? prev : roundedZoom);
      const atMax = limitZoomToCharts && roundedZoom >= effectiveMaxZoom - 0.1;
      setIsAtMaxZoom(prev => prev === atMax ? prev : atMax);
    }

    // Debounced arc update — waits 150ms for tiles to load, then schedules
    // on next animation frame for smooth visual integration.
    if (sectorArcDebounceRef.current) clearTimeout(sectorArcDebounceRef.current);
    sectorArcDebounceRef.current = setTimeout(() => {
      requestAnimationFrame(() => {
        updateSectorArcsRef.current();
      });
    }, 150);
  }, [limitZoomToCharts, effectiveMaxZoom]);

  // Trigger sector arc update when points VectorSource becomes available.
  // Tiles need time to load after the source mounts, so delay the query.
  useEffect(() => {
    if (!pointsTileUrl) return;
    const timer = setTimeout(() => {
      updateSectorArcsRef.current();
    }, 1500);
    return () => clearTimeout(timer);
  }, [pointsTileUrl]);

  // Lightweight camera update — refs only, no state, no re-renders
  // Used by onRegionIsChanging (during active pan/zoom) to keep refs fresh
  // without triggering expensive React tree diffing of 200+ chart layers
  const processCameraStateLight = useCallback((feature: any) => {
    if (feature?.geometry?.coordinates) {
      const [lng, lat] = feature.geometry.coordinates;
      centerCoordRef.current = [lng, lat];

      // Detect user panning: camera center drifts from GPS position
      // Zoom-only gestures don't move the center, so they won't trigger this
      if (followGPSRef.current) {
        const gpsLat = gpsDataRef.current.latitude;
        const gpsLon = gpsDataRef.current.longitude;
        if (gpsLat !== null && gpsLon !== null) {
          const latDiff = Math.abs(lat - gpsLat);
          const lonDiff = Math.abs(lng - gpsLon);
          if (latDiff > 0.0001 || lonDiff > 0.0001) {
            followGPSRef.current = false;
            setFollowGPS(false);
          }
        }
      }
    }
  }, []);
  
  // Region will change callback - pan detection is handled in processCameraStateLight
  // (called during onRegionIsChanging) by comparing camera center to GPS position.
  // This naturally distinguishes pan from zoom since zoom doesn't move the center.
  const handleRegionWillChange = useCallback(() => {
    // No-op: pan detection moved to processCameraStateLight
  }, []);

  // Handle camera change completion (pan/zoom ended) — full state update
  // Throttled to 100ms with trailing call to catch the final position
  const handleCameraChanged = useCallback((feature: any) => {
    const THROTTLE_MS = 100;
    const now = Date.now();

    pendingCameraStateRef.current = feature;

    if (now - lastCameraUpdateRef.current >= THROTTLE_MS) {
      lastCameraUpdateRef.current = now;
      processCameraState(feature);
      pendingCameraStateRef.current = null;

      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
        throttleTimeoutRef.current = null;
      }
    } else if (!throttleTimeoutRef.current) {
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

  // Handle active camera movement (during pan/zoom gesture) — refs only, no re-renders
  // This keeps centerCoordRef fresh for tide correction without triggering React diffs
  // of the 200+ chart layer tree every 16ms
  const handleCameraMoving = useCallback((feature: any) => {
    processCameraStateLight(feature);
  }, [processCameraStateLight]);
  
  // Cleanup throttle timeout on unmount
  useEffect(() => {
    return () => {
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
      }
    };
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
    
    // Chart zoom ranges matching tile server getScaleForZoom():
    // US1: z0-4, US2: z5-7, US3: z8-11, US4: z12+, US5/US6: z14+
    // Include ±2 zoom buffer for overzoom tolerance
    switch (scale) {
      case 1: return zoom <= 6;   // US1: z0-4, buffer to z6
      case 2: return zoom >= 3 && zoom <= 10;  // US2: z5-7, buffer ±2
      case 3: return zoom >= 6 && zoom <= 14;  // US3: z8-11, buffer ±2
      case 4: return zoom >= 10;  // US4: z12+, buffer to z10+
      case 5: return zoom >= 13;  // US5: z14+, buffer to z13+
      default: return zoom >= 15; // US6+: z14+, buffer to z15+
    }
  }, []);

  // Scale bar calculation based on current zoom level and latitude
  const scaleBarData = useMemo(() => {
    // Ground resolution in meters per pixel at given zoom & latitude
    // Formula: 156543.03392 * cos(lat) / 2^zoom
    const lat = centerCoordRef.current[1];
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
  // centerCoord intentionally excluded — read from ref to avoid re-render loop
  // Scale bar recalculates when zoom changes, which is sufficient
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentZoom]);

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
  }, [chartsAtZoom,
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
          
          // Check for tide station click (type is 'R' or 'S' for Reference/Subordinate, with iconName starting with 'tide-')
          else if ((props?.type === 'R' || props?.type === 'S') && props?.id && props?.name && props?.iconName?.startsWith('tide-')) {
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
                type: 'Wx Buoy',
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
        // Soundings - temporarily tappable for _scaleNum debugging
        129: showSoundings,
        // Cables (CBLSUB, CBLOHD, CBLARE)
        22: showCables, 21: showCables, 20: showCables,
        // Pipelines (PIPSOL, PIPARE)
        94: showPipelines, 92: showPipelines,
        // Depth contours - EXCLUDED from click-to-identify (not useful)
        43: false,
        // Coastline
        30: showCoastline,
        // Traffic routes (Fairways, TSS lanes)
        51: showTrafficRoutes, 148: showTrafficRoutes,
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
          
          // Soundings tappable for debugging _scaleNum
          // if (objl === 129) return false;
          
          // ALWAYS exclude depth contours (OBJL 43) - not useful for identification
          if (objl === 43) return false;
          
          // Include if layer is visible, or if we don't have visibility info for this OBJL (include by default)
          return objlVisibility[objl] !== false;
        })
      };
      
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
        for (const [, feature] of featuresByType) {
          const props = feature.properties || {};
          const layer = getLayerName(props);
          // Extract feature's actual coordinates from geometry (not tap location)
          const geom = feature.geometry;
          let featureCoords = '';
          if (geom?.type === 'Point' && geom.coordinates) {
            const [fLon, fLat] = geom.coordinates;
            featureCoords = `${Number(fLat).toFixed(7)}°, ${Number(fLon).toFixed(7)}°`;
          }
          uniqueFeatures.push({
            type: LAYER_DISPLAY_NAMES[layer] || layer,
            properties: {
              ...props,
              _tapCoordinates: `${latitude.toFixed(5)}°, ${longitude.toFixed(5)}°`,
              ...(featureCoords ? { _featureCoordinates: featureCoords } : {}),
            },
          });
        }
        
        // Sort by priority (highest first)
        uniqueFeatures.sort((a, b) => {
          const objlA = Number(a.properties?.OBJL) || 0;
          const objlB = Number(b.properties?.OBJL) || 0;
          const prioA = OBJL_PRIORITIES.get(objlA) ?? 0;
          const prioB = OBJL_PRIORITIES.get(objlB) ?? 0;
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
    
    endTapMetric();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryableLayerIds, showLights, showBuoys, showBeacons, showHazards, showLandmarks,
      showSoundings, showCables, showPipelines, showDepthContours, showCoastline,
      showRestrictedAreas, showCautionAreas, showMilitaryAreas, showAnchorages,
      showMarineFarms, showTrafficRoutes, showSeabed, showBridges, showBuildings, showMoorings,
      showShorelineConstruction, showDepthAreas, showLand]);

  // Handle map long press - create a waypoint or add to route depending on mode
  const handleMapLongPress = useCallback((e: any) => {
    const { geometry } = e;
    if (!geometry?.coordinates) return;
    
    const [longitude, latitude] = geometry.coordinates;
    console.log(`[DynamicChartViewer] Long press at: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
    
    // If actively creating a route, add point to route
    if (activeRoute) {
      addPointToActiveRoute({ latitude, longitude });
      console.log('[DynamicChartViewer] Added point to active route');
      // Show route editor after adding first point
      if (!showRouteEditor) {
        setShowRouteEditor(true);
      }
    } else {
      // Otherwise create waypoint
      openWaypointCreation(longitude, latitude);
    }
  }, [openWaypointCreation, activeRoute, addPointToActiveRoute, showRouteEditor]);

  // Show route editor when active route has points
  useEffect(() => {
    if (activeRoute && activeRoute.routePoints.length > 0 && !showRouteEditor) {
      setShowRouteEditor(true);
    } else if (!activeRoute && showRouteEditor) {
      setShowRouteEditor(false);
    }
  }, [activeRoute, showRouteEditor]);

  // Memoize formatted feature properties to avoid recalculation on every render
  // NOTE: Must be before early returns to comply with Rules of Hooks
  const formattedFeatureProps = useMemo(() => {
    if (!selectedFeature) return null;
    const result = formatFeatureProperties(selectedFeature, displaySettings.depthUnits);
    const entries = Object.entries(result);
    return entries;
  }, [selectedFeature, displaySettings.depthUnits]);
  
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
  }, []);
  
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

  // ─── renderChartLayers ───────────────────────────────────────────────
  // Generates all ~60 chart layer definitions for the unified VectorSource.
  // The prefix parameter ensures unique layer IDs per source.
  // ─── SCAMIN OFFSET ──────────────────────────────────────────────────
  // Chart Detail setting controls how many zoom levels earlier features appear
  // relative to their S-57 SCAMIN value. Used by both chart tile layers and station layers.
  const chartDetailOffsets: Record<string, number> = { low: -1, medium: 0, high: 1, ultra: 2, max: 4 };
  const scaminOffset = chartDetailOffsets[displaySettings.chartDetail] ?? 1;

  // Non-chart layers use synthetic SCAMIN values (same formula, computed as minZoomLevel).
  // This lets Chart Detail control everything uniformly.
  const scaminToZoom = (scamin: number) => Math.max(0, Math.round(28 - Math.log2(scamin) - scaminOffset));

  // Tide/current station markers
  const stationIconMinZoom = scaminToZoom(3000000);   // ~z6 at high
  const stationLabelMinZoom = scaminToZoom(120000);   // ~z10 at high

  // GNIS place name categories
  const gnisWaterMinZoom = scaminToZoom(8388608);     // ~z4 at high (bays, channels, sounds)
  const gnisLandmarkMinZoom = scaminToZoom(524288);   // ~z8 at high
  const gnisStreamMinZoom = scaminToZoom(262144);     // ~z9 at high (streams, lakes)
  const gnisTerrainMinZoom = scaminToZoom(131072);    // ~z10 at high

  // SCAMIN may be string-encoded in MVT tiles; ['to-number', ...] ensures ln() math works.
  // Extracted as a top-level memo so sub-group caches can depend on it independently.
  const scaminFilter: any[] = useMemo(() => ['any',
    ['!', ['has', 'SCAMIN']],
    ['>=', ['zoom'], ['-', 28 - scaminOffset, ['/', ['ln', ['to-number', ['get', 'SCAMIN']]], ['ln', 2]]]]
  ], [scaminOffset]);

  // Background fills (DEPARE, LNDARE) use overlapping zoom bands that match each
  // scale's native tippecanoe zoom range. Where multiple scales overlap, the
  // last-rendered polygon wins (higher scales appear later from tile-join merge order).
  // Gaps are filled by lower-scale data; higher-scale data takes visual priority.
  const bgFillScaleFilter: any[] = useMemo(() => ['any',
    ['!', ['has', '_scaleNum']],  // Features without scale pass through
    ['all', ['<=', ['get', '_scaleNum'], 2], ['<', ['zoom'], 11]],   // US1-2: z0-10 (native max)
    ['all', ['==', ['get', '_scaleNum'], 3], ['>=', ['zoom'], 4]],   // US3: z4+ (native range z4-13)
    ['all', ['==', ['get', '_scaleNum'], 4], ['>=', ['zoom'], 6]],   // US4: z6+ (native range z6-15)
    ['all', ['>=', ['get', '_scaleNum'], 5], ['>=', ['zoom'], 6]],   // US5+: z6+ (native range z6-15)
  ], []);

  // Line features (DEPCNT) use overlapping bands. The compose_job clips
  // lower-scale contours against the next-higher scale's M_COVR coverage
  // (cascading per-scale-pair), so the tile data has no cross-scale geometry
  // overlap — overlapping display bands are safe (no double-contours) and
  // ensure contour continuity at all zooms.
  const contourScaleFilter: any[] = useMemo(() => ['any',
    ['!', ['has', '_scaleNum']],
    ['all', ['<=', ['get', '_scaleNum'], 2], ['<', ['zoom'], 11]],   // US1-2: z0-10 (native max)
    ['all', ['==', ['get', '_scaleNum'], 3], ['>=', ['zoom'], 4]],   // US3: z4+ (native range z4-13)
    ['all', ['==', ['get', '_scaleNum'], 4], ['>=', ['zoom'], 6]],   // US4: z6+ (native range z6-15)
    ['all', ['>=', ['get', '_scaleNum'], 5], ['>=', ['zoom'], 6]],   // US5+: z6+ (native range z6-15)
  ], []);

  // ECDIS usage band filter for point features from points.mbtiles.
  // Per S-57/ECDIS: features from lower-scale charts should not persist past
  // their native zoom range. This prevents "ghost" symbols from overview charts
  // cluttering the display when detailed charts are available.
  // Hard ceiling per scale matches SCALE_ZOOM_RANGES from the compose pipeline.
  const pointScaleFilter: any[] = useMemo(() => ['any',
    ['!', ['has', '_scaleNum']],                                                          // No scale → pass through
    ['all', ['==', ['get', '_scaleNum'], 1], ['<=', ['zoom'], 8]],                        // US1: z0-8
    ['all', ['==', ['get', '_scaleNum'], 2], ['<=', ['zoom'], 10]],                       // US2: z0-10
    ['all', ['==', ['get', '_scaleNum'], 3], ['>=', ['zoom'], 4], ['<=', ['zoom'], 13]],  // US3: z4-13
    ['all', ['>=', ['get', '_scaleNum'], 4], ['>=', ['zoom'], 6]],                        // US4+: z6+
  ], []);

  // ─── renderChartLayers: split into sub-group functions ──────────────
  // Each sub-group has independent dependencies for finer-grained memoization.
  // When a display slider changes, only the affected sub-group rebuilds its JSX.

  // SUB-GROUP 1: Background & area fills — DEPARE, LNDARE, DRGARE, FAIRWY, restricted/caution/military areas, etc.
  const renderFillLayers = (prefix: string) => {
    const p = prefix;
    return [
      /* ============================================== */
      /* S-52 LAYER ORDER: Opaque Background Fills First */
      /* ============================================== */

      /* DEPARE - Depth Areas (all scales render — consistent coverage) */
      <MapLibre.FillLayer
        key={`${p}-depare`}
        id={`${p}-depare`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 42], bgFillScaleFilter]}
        style={{
          fillColor: [
                'step',
                ['to-number', ['coalesce', ['get', 'DRVAL1'], 0]],
                s52Colors.DEPIT,
                0, s52Colors.DEPVS,
                2, s52Colors.DEPMS,
                5, s52Colors.DEPMD,
                10, s52Colors.DEPDW,
              ],
          fillOpacity: ecdisMarine ? 1 : (hasMarineRasterTiles ? scaledDepthAreaOpacitySatellite : scaledDepthAreaOpacity),
          visibility: (ecdisColors || showDepthAreas) ? 'visible' : 'none',
        }}
      />,

      /* DEPARE - Depth Area Outlines (depth transition edges act as contour lines) */
      <MapLibre.LineLayer
        key={`${p}-depare-outline`}
        id={`${p}-depare-outline`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 42], bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.CHGRD,
          lineWidth: 0.5,
          lineOpacity: 0.5,
          visibility: (showDepthContours || ecdisColors) ? 'visible' : 'none',
        }}
      />,

      /* LNDARE - Land Areas (all scales render — consistent coverage) */
      <MapLibre.FillLayer
        key={`${p}-lndare`}
        id={`${p}-lndare`}
        sourceLayerID="charts"
        filter={['all', ['==', ['get', 'OBJL'], 71], bgFillScaleFilter]}
        style={{
          fillColor: s52Colors.LANDA,
          fillOpacity: ecdisLand ? 1 : (hasLandRasterTiles ? 0.2 : 1),
          visibility: (ecdisColors || showLand) ? 'visible' : 'none',
        }}
      />,

      /* ============================================== */
      /* S-52 LAYER ORDER: Semi-transparent Area Fills  */
      /* ============================================== */

      /* DRGARE - Dredged Areas */
      <MapLibre.FillLayer
        key={`${p}-drgare`}
        id={`${p}-drgare`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 46], scaminFilter, bgFillScaleFilter]}
        style={{
          fillColor: s52Colors.DRGARE,
          fillOpacity: scaledDredgedAreaOpacity,
          visibility: showDepthAreas ? 'visible' : 'none',
        }}
      />,

      /* FAIRWY - Fairways */
      <MapLibre.FillLayer
        key={`${p}-fairwy`}
        id={`${p}-fairwy`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 51], scaminFilter, bgFillScaleFilter]}
        style={{
          fillColor: s52Colors.FAIRWY,
          fillOpacity: scaledFairwayOpacity,
          visibility: showTrafficRoutes ? 'visible' : 'none',
        }}
      />,

      /* CBLARE - Cable Areas */
      <MapLibre.FillLayer
        key={`${p}-cblare`}
        id={`${p}-cblare`}
        sourceLayerID="charts"
        minZoomLevel={6}
        filter={['all', ['==', ['get', 'OBJL'], 20], scaminFilter, bgFillScaleFilter]}
        style={{
          fillColor: s52Colors.CBLARE,
          fillOpacity: scaledCableAreaOpacity,
          visibility: showCables ? 'visible' : 'none',
        }}
      />,

      /* PIPARE - Pipeline Areas */
      <MapLibre.FillLayer
        key={`${p}-pipare`}
        id={`${p}-pipare`}
        sourceLayerID="charts"
        minZoomLevel={6}
        filter={['all', ['==', ['get', 'OBJL'], 92], scaminFilter, bgFillScaleFilter]}
        style={{
          fillColor: s52Colors.PIPARE,
          fillOpacity: scaledPipelineAreaOpacity,
          visibility: showPipelines ? 'visible' : 'none',
        }}
      />,

      /* RESARE - Restricted Areas */
      <MapLibre.FillLayer
        key={`${p}-resare`}
        id={`${p}-resare`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 112], scaminFilter, bgFillScaleFilter]}
        style={{
          fillColor: [
            'match',
            ['get', 'CATREA'],
            14, s52Colors.MIPARE,
            12, s52Colors.MIPARE,
            4, s52Colors.RESGR,
            7, s52Colors.RESGR,
            8, s52Colors.RESGR,
            9, s52Colors.RESGR,
            s52Colors.DNGHL,
          ],
          fillOpacity: scaledRestrictedAreaOpacity,
          visibility: showRestrictedAreas ? 'visible' : 'none',
        }}
      />,

      /* CTNARE - Caution Areas */
      <MapLibre.FillLayer
        key={`${p}-ctnare`}
        id={`${p}-ctnare`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 27], scaminFilter, bgFillScaleFilter]}
        style={{
          fillColor: s52Colors.CTNARE,
          fillOpacity: scaledCautionAreaOpacity,
          visibility: showCautionAreas ? 'visible' : 'none',
        }}
      />,

      /* MIPARE - Military Practice Areas */
      <MapLibre.FillLayer
        key={`${p}-mipare`}
        id={`${p}-mipare`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 83], scaminFilter, bgFillScaleFilter]}
        style={{
          fillColor: s52Colors.MIPARE,
          fillOpacity: scaledMilitaryAreaOpacity,
          visibility: showMilitaryAreas ? 'visible' : 'none',
        }}
      />,

      /* ACHARE - Anchorage Areas */
      <MapLibre.FillLayer
        key={`${p}-achare`}
        id={`${p}-achare`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 4], scaminFilter, bgFillScaleFilter]}
        style={{
          fillColor: s52Colors.ACHARE,
          fillOpacity: scaledAnchorageOpacity,
          visibility: showAnchorages ? 'visible' : 'none',
        }}
      />,

      /* MARCUL - Marine Farms */
      <MapLibre.FillLayer
        key={`${p}-marcul`}
        id={`${p}-marcul`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 82], scaminFilter, bgFillScaleFilter]}
        style={{
          fillColor: s52Colors.MARCUL,
          fillOpacity: scaledMarineFarmOpacity,
          visibility: showMarineFarms ? 'visible' : 'none',
        }}
      />,

      /* TSSLPT - Traffic Separation Scheme Lane Parts */
      <MapLibre.FillLayer
        key={`${p}-tsslpt`}
        id={`${p}-tsslpt`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 148], scaminFilter, bgFillScaleFilter]}
        style={{
          fillColor: s52Colors.TSSLPT,
          fillOpacity: 0.1,
          visibility: showTrafficRoutes ? 'visible' : 'none',
        }}
      />,

      /* TSSLPT - Traffic Separation Scheme Lane Parts (outline) */
      <MapLibre.LineLayer
        key={`${p}-tsslpt-line`}
        id={`${p}-tsslpt-line`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 148], ['==', ['geometry-type'], 'LineString'], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.TSSLPT,
          lineWidth: 1.5,
          lineOpacity: 0.6,
          lineDasharray: [4, 4],
          visibility: showTrafficRoutes ? 'visible' : 'none',
        }}
      />,

      /* LAKARE - Lake Areas */
      <MapLibre.FillLayer
        key={`${p}-lakare`}
        id={`${p}-lakare`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 69], bgFillScaleFilter]}
        style={{
          fillColor: s52Colors.DEPVS,
          fillOpacity: 0.6,
          visibility: showDepthAreas ? 'visible' : 'none',
        }}
      />,

      /* CANALS - Canals */
      <MapLibre.FillLayer
        key={`${p}-canals-fill`}
        id={`${p}-canals-fill`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 23], ['==', ['geometry-type'], 'Polygon'], scaminFilter, bgFillScaleFilter]}
        style={{
          fillColor: s52Colors.DEPVS,
          fillOpacity: 0.6,
        }}
      />,
      <MapLibre.LineLayer
        key={`${p}-canals-line`}
        id={`${p}-canals-line`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 23], ['==', ['geometry-type'], 'LineString'], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.CHGRD,
          lineWidth: ['interpolate', ['linear'], ['zoom'], 8, 1, 14, 2],
          lineOpacity: 0.8,
        }}
      />,

      /* ============================================== */
      /* S-52 LAYER ORDER: Area Outlines (on top of fills, below structures/symbols) */
      /* ============================================== */

      /* SBDARE - Seabed area fills (Polygons) */
      <MapLibre.FillLayer
        key={`${p}-sbdare-fill`}
        id={`${p}-sbdare-fill`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all',
          ['==', ['get', 'OBJL'], 121],
          ['==', ['geometry-type'], 'Polygon'],
          scaminFilter, bgFillScaleFilter
        ]}
        style={{
          fillColor: s52Colors.SBDFL,
          fillOpacity: 0.15,
          visibility: showSeabed ? 'visible' : 'none',
        }}
      />,

      /* SBDARE - Seabed area outlines (Polygons) */
      <MapLibre.LineLayer
        key={`${p}-sbdare-outline`}
        id={`${p}-sbdare-outline`}
        sourceLayerID="charts"
        minZoomLevel={10}
        filter={['all',
          ['==', ['get', 'OBJL'], 121],
          ['==', ['geometry-type'], 'Polygon'],
          scaminFilter, bgFillScaleFilter
        ]}
        style={{
          lineColor: s52Colors.SBDLN,
          lineWidth: 0.5,
          lineOpacity: 0.4,
          lineDasharray: [4, 2],
          visibility: showSeabed ? 'visible' : 'none',
        }}
      />,

      /* LNDARE outline */
      <MapLibre.LineLayer
        key={`${p}-lndare-outline`}
        id={`${p}-lndare-outline`}
        sourceLayerID="charts"
        minZoomLevel={4}
        filter={['==', ['get', 'OBJL'], 71]}
        style={{
          lineColor: s52Colors.LNDOL,
          lineWidth: 1,
          visibility: showLand ? 'visible' : 'none',
        }}
      />,

      /* DRGARE outline */
      <MapLibre.LineLayer
        key={`${p}-drgare-outline`}
        id={`${p}-drgare-outline`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 46], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.DRGOL,
          lineWidth: 1.5,
          lineDasharray: [4, 2],
          visibility: showDepthAreas ? 'visible' : 'none',
        }}
      />,

      /* FAIRWY outline */
      <MapLibre.LineLayer
        key={`${p}-fairwy-outline`}
        id={`${p}-fairwy-outline`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 51], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.FWYOL,
          lineWidth: 2,
          lineDasharray: [8, 4],
          visibility: showTrafficRoutes ? 'visible' : 'none',
        }}
      />,

      /* CBLARE outline */
      <MapLibre.LineLayer
        key={`${p}-cblare-outline`}
        id={`${p}-cblare-outline`}
        sourceLayerID="charts"
        minZoomLevel={6}
        filter={['all', ['==', ['get', 'OBJL'], 20], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.CABLN,
          lineWidth: scaledCableLineWidth,
          lineDasharray: [4, 2],
          lineOpacity: scaledCableLineOpacity,
          visibility: showCables ? 'visible' : 'none',
        }}
      />,

      /* PIPARE outline */
      <MapLibre.LineLayer
        key={`${p}-pipare-outline`}
        id={`${p}-pipare-outline`}
        sourceLayerID="charts"
        minZoomLevel={6}
        filter={['all', ['==', ['get', 'OBJL'], 92], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.PIPLN,
          lineWidth: scaledPipelineLineWidth * 0.75,
          lineDasharray: [6, 3],
          lineOpacity: scaledPipelineLineOpacity,
          visibility: showPipelines ? 'visible' : 'none',
        }}
      />,

      /* RESARE outline */
      <MapLibre.LineLayer
        key={`${p}-resare-outline`}
        id={`${p}-resare-outline`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 112], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: [
            'match',
            ['get', 'CATREA'],
            14, s52Colors.MIPARE,
            12, s52Colors.MIPARE,
            4, s52Colors.RESGR,
            7, s52Colors.RESGR,
            8, s52Colors.RESGR,
            9, s52Colors.RESGR,
            s52Colors.DNGHL,
          ],
          lineWidth: 2,
          lineDasharray: [6, 3],
          visibility: showRestrictedAreas ? 'visible' : 'none',
        }}
      />,

      /* CTNARE outline */
      <MapLibre.LineLayer
        key={`${p}-ctnare-outline`}
        id={`${p}-ctnare-outline`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 27], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.CTNOL,
          lineWidth: 2,
          lineDasharray: [6, 3],
          visibility: showCautionAreas ? 'visible' : 'none',
        }}
      />,

      /* MIPARE outline */
      <MapLibre.LineLayer
        key={`${p}-mipare-outline`}
        id={`${p}-mipare-outline`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 83], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.MIPOL,
          lineWidth: 2,
          lineDasharray: [4, 2],
          visibility: showMilitaryAreas ? 'visible' : 'none',
        }}
      />,

      /* ACHARE outline */
      <MapLibre.LineLayer
        key={`${p}-achare-outline`}
        id={`${p}-achare-outline`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 4], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.ACHOL,
          lineWidth: 2,
          lineDasharray: [8, 4],
          visibility: showAnchorages ? 'visible' : 'none',
        }}
      />,

      /* MARCUL outline */
      <MapLibre.LineLayer
        key={`${p}-marcul-outline`}
        id={`${p}-marcul-outline`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 82], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.MCUOL,
          lineWidth: 2,
          lineDasharray: [4, 2],
          visibility: showMarineFarms ? 'visible' : 'none',
        }}
      />,

      /* Debug: Scale coverage heatmap — DEPARE colored by _scaleNum, no bgFillScaleFilter */
      ...(showScaleDebug ? [
        <MapLibre.FillLayer
          key={`${p}-scale-debug`}
          id={`${p}-scale-debug`}
          sourceLayerID="charts"
          minZoomLevel={0}
          filter={['==', ['get', 'OBJL'], 42]}
          style={{
            fillColor: ['match', ['get', '_scaleNum'],
              1, '#ff0000', 2, '#ff8800', 3, '#ffff00',
              4, '#00ff00', 5, '#00aaff', 6, '#8800ff',
              '#888888'],
            fillOpacity: 0.4,
            visibility: 'visible',
          }}
        />,
      ] : []),

    ];
  };

  // SUB-GROUP 2: Structures & construction — bridges, buildings, moorings, shoreline construction, etc.
  const renderStructureLayers = (prefix: string) => {
    const p = prefix;
    return [
      /* ============================================== */
      /* S-52 LAYER ORDER: Structures & Construction    */
      /* ============================================== */

      /* BRIDGE - Bridges (polygon fill — below lines) */
      <MapLibre.FillLayer
        key={`${p}-bridge-fill`}
        id={`${p}-bridge-fill`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 11], ['==', ['geometry-type'], 'Polygon'], scaminFilter, bgFillScaleFilter]}
        style={{
          fillColor: s52Colors.BRGFL,
          fillOpacity: 0.6,
          visibility: showBridges ? 'visible' : 'none',
        }}
      />,

      /* BRIDGE - Bridges (lines) Halo */
      <MapLibre.LineLayer
        key={`${p}-bridge-halo`}
        id={`${p}-bridge-halo`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 11], ['==', ['geometry-type'], 'LineString'], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.HLCLR,
          lineWidth: scaledBridgeLineWidth + scaledBridgeLineHalo,
          lineOpacity: scaledBridgeLineHalo > 0 ? scaledBridgeOpacity * 0.8 : 0,
          visibility: showBridges ? 'visible' : 'none',
        }}
      />,

      /* BRIDGE - Bridges (lines) */
      <MapLibre.LineLayer
        key={`${p}-bridge`}
        id={`${p}-bridge`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 11], ['==', ['geometry-type'], 'LineString'], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.BRGLN,
          lineWidth: scaledBridgeLineWidth,
          lineOpacity: scaledBridgeOpacity,
          visibility: showBridges ? 'visible' : 'none',
        }}
      />,

      /* BUISGL - Buildings */
      <MapLibre.FillLayer
        key={`${p}-buisgl`}
        id={`${p}-buisgl`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 12], scaminFilter, bgFillScaleFilter]}
        style={{
          fillColor: s52Colors.BUIFL,
          fillOpacity: 0.4,
          visibility: showBuildings ? 'visible' : 'none',
        }}
      />,

      /* MORFAC - Mooring Facilities (lines) Halo */
      <MapLibre.LineLayer
        key={`${p}-morfac-line-halo`}
        id={`${p}-morfac-line-halo`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 84], ['==', ['geometry-type'], 'LineString'], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.HLCLR,
          lineWidth: scaledMooringLineHaloWidth,
          lineOpacity: scaledMooringLineHalo > 0 ? scaledMooringOpacity * 0.8 : 0,
          visibility: showMoorings ? 'visible' : 'none',
        }}
      />,

      /* MORFAC - Mooring Facilities (lines) */
      <MapLibre.LineLayer
        key={`${p}-morfac-line`}
        id={`${p}-morfac-line`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 84], ['==', ['geometry-type'], 'LineString'], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.MORLN,
          lineWidth: scaledMooringLineWidth,
          lineOpacity: scaledMooringOpacity,
          visibility: showMoorings ? 'visible' : 'none',
        }}
      />,

      /* MORFAC - Mooring Facilities (polygon) */
      <MapLibre.FillLayer
        key={`${p}-morfac-fill`}
        id={`${p}-morfac-fill`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 84], ['==', ['geometry-type'], 'Polygon'], scaminFilter, bgFillScaleFilter]}
        style={{
          fillColor: s52Colors.MORLN,
          fillOpacity: 0.4,
          visibility: showMoorings ? 'visible' : 'none',
        }}
      />,

      /* SLCONS - Shoreline Construction Halo */
      <MapLibre.LineLayer
        key={`${p}-slcons-halo`}
        id={`${p}-slcons-halo`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 122], ['==', ['geometry-type'], 'LineString'], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.HLCLR,
          lineWidth: scaledShorelineConstructionHaloWidth,
          lineOpacity: scaledShorelineConstructionHalo > 0 ? scaledShorelineConstructionOpacity * 0.8 : 0,
          visibility: showShorelineConstruction ? 'visible' : 'none',
        }}
      />,

      /* SLCONS - Shoreline Construction */
      <MapLibre.LineLayer
        key={`${p}-slcons`}
        id={`${p}-slcons`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 122], ['==', ['geometry-type'], 'LineString'], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.SLCLN,
          lineWidth: scaledShorelineConstructionLineWidth,
          lineOpacity: scaledShorelineConstructionOpacity,
          visibility: showShorelineConstruction ? 'visible' : 'none',
        }}
      />,

      /* SLCONS - Shoreline Construction (points) */
      <MapLibre.CircleLayer
        key={`${p}-slcons-point`}
        id={`${p}-slcons-point`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 122], ['==', ['geometry-type'], 'Point'], scaminFilter, bgFillScaleFilter]}
        style={{
          circleColor: s52Colors.SLCLN,
          circleRadius: ['interpolate', ['linear'], ['zoom'], 12, 3, 14, 4, 18, 6],
          circleStrokeColor: s52Colors.HLCLR,
          circleStrokeWidth: 1,
          visibility: showShorelineConstruction ? 'visible' : 'none',
        }}
      />,

      /* SLCONS - Shoreline Construction (polygon) */
      <MapLibre.FillLayer
        key={`${p}-slcons-fill`}
        id={`${p}-slcons-fill`}
        sourceLayerID="charts"
        filter={['all', ['==', ['get', 'OBJL'], 122], ['==', ['geometry-type'], 'Polygon'], scaminFilter, bgFillScaleFilter]}
        style={{
          fillColor: s52Colors.SLCFL,
          fillOpacity: 0.5,
          visibility: showShorelineConstruction ? 'visible' : 'none',
        }}
      />,

      /* CAUSWY - Causeways (fill below line) */
      <MapLibre.FillLayer
        key={`${p}-causwy-fill`}
        id={`${p}-causwy-fill`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 26], ['==', ['geometry-type'], 'Polygon'], scaminFilter, bgFillScaleFilter]}
        style={{
          fillColor: s52Colors.BRGFL,
          fillOpacity: 0.5,
        }}
      />,
      <MapLibre.LineLayer
        key={`${p}-causwy-line`}
        id={`${p}-causwy-line`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 26], ['==', ['geometry-type'], 'LineString'], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.CSWYL,
          lineWidth: ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 4],
          lineOpacity: 0.8,
        }}
      />,

      /* PONTON - Pontoon */
      <MapLibre.FillLayer
        key={`${p}-ponton-fill`}
        id={`${p}-ponton-fill`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 95], ['==', ['geometry-type'], 'Polygon'], scaminFilter, bgFillScaleFilter]}
        style={{
          fillColor: s52Colors.PONTN,
          fillOpacity: 0.5,
        }}
      />,
      <MapLibre.LineLayer
        key={`${p}-ponton-line`}
        id={`${p}-ponton-line`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 95], ['==', ['geometry-type'], 'LineString'], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.CHBLK,
          lineWidth: ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 2],
          lineOpacity: 0.8,
        }}
      />,

      /* HULKES - Hulks */
      <MapLibre.FillLayer
        key={`${p}-hulkes-fill`}
        id={`${p}-hulkes-fill`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 65], ['==', ['geometry-type'], 'Polygon'], scaminFilter, bgFillScaleFilter]}
        style={{
          fillColor: s52Colors.HULKS,
          fillOpacity: 0.5,
        }}
      />,
      <MapLibre.CircleLayer
        key={`${p}-hulkes-point`}
        id={`${p}-hulkes-point`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 65], ['==', ['geometry-type'], 'Point'], scaminFilter, bgFillScaleFilter]}
        style={{
          circleColor: s52Colors.HULKS,
          circleRadius: ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 5],
          circleStrokeColor: s52Colors.CHBLK,
          circleStrokeWidth: 1,
        }}
      />,

    ];
  };

  // SUB-GROUP 3: Line features — depth contours, coastline, cables, pipelines, navigation lines
  const renderLineLayers = (prefix: string) => {
    const p = prefix;
    return [
      /* ============================================== */
      /* S-52 LAYER ORDER: Line Features               */
      /* ============================================== */

      /* DEPCNT - Depth Contours Halo (scale-band filtered, no SCAMIN — contours
         follow scale band visibility like skin-of-earth features) */
      <MapLibre.LineLayer
        key={`${p}-depcnt-halo`}
        id={`${p}-depcnt-halo`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 43], contourScaleFilter]}
        style={{
          lineColor: s52Colors.HLCLR,
          lineWidth: scaledDepthContourLineHaloWidth,
          lineOpacity: scaledDepthContourLineHalo > 0 ? 0.5 * scaledDepthContourLineOpacity : 0,
          visibility: showDepthContours ? 'visible' : 'none',
        }}
      />,

      /* DEPCNT - Depth Contours (scale-band filtered, no SCAMIN) */
      <MapLibre.LineLayer
        key={`${p}-depcnt`}
        id={`${p}-depcnt`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 43], contourScaleFilter]}
        style={{
          lineColor: s52Colors.CHGRD,
          lineWidth: scaledDepthContourLineWidth,
          lineOpacity: 0.7 * scaledDepthContourLineOpacity,
          visibility: showDepthContours ? 'visible' : 'none',
        }}
      />,

      /* COALNE - Coastline Halo */
      <MapLibre.LineLayer
        key={`${p}-coalne-halo`}
        id={`${p}-coalne-halo`}
        sourceLayerID="charts"
        minZoomLevel={6}
        filter={['==', ['get', 'OBJL'], 30]}
        style={{
          lineColor: s52Colors.HLCLR,
          lineWidth: scaledCoastlineHaloWidth,
          lineOpacity: scaledCoastlineHalo > 0 ? scaledCoastlineOpacity * 0.8 : 0,
          visibility: showCoastline ? 'visible' : 'none',
        }}
      />,

      /* COALNE - Coastline */
      <MapLibre.LineLayer
        key={`${p}-coalne`}
        id={`${p}-coalne`}
        sourceLayerID="charts"
        minZoomLevel={2}
        filter={['==', ['get', 'OBJL'], 30]}
        style={{
          lineColor: s52Colors.CSTLN,
          lineWidth: scaledCoastlineLineWidth,
          lineOpacity: scaledCoastlineOpacity,
          visibility: showCoastline ? 'visible' : 'none',
        }}
      />,

      /* NAVLNE - Navigation Lines */
      <MapLibre.LineLayer
        key={`${p}-navlne`}
        id={`${p}-navlne`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 85], ['==', ['geometry-type'], 'LineString'], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.NAVLN,
          lineWidth: ['interpolate', ['linear'], ['zoom'], 6, 1, 12, 2],
          lineOpacity: 0.8,
          lineDasharray: [6, 3],
        }}
      />,

      /* RECTRC - Recommended Tracks */
      <MapLibre.LineLayer
        key={`${p}-rectrc`}
        id={`${p}-rectrc`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 109], ['==', ['geometry-type'], 'LineString'], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.RECTR,
          lineWidth: ['interpolate', ['linear'], ['zoom'], 6, 1, 12, 2],
          lineOpacity: 0.7,
          lineDasharray: [8, 4],
        }}
      />,

      /* TSELNE - Traffic Separation Lines */
      <MapLibre.LineLayer
        key={`${p}-tselne`}
        id={`${p}-tselne`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 145], ['==', ['geometry-type'], 'LineString'], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.TSELN,
          lineWidth: ['interpolate', ['linear'], ['zoom'], 6, 1.5, 12, 3],
          lineOpacity: 0.8,
        }}
      />,

      /* LNDELV - Land Elevation Contours */
      <MapLibre.LineLayer
        key={`${p}-lndelv`}
        id={`${p}-lndelv`}
        sourceLayerID="charts"
        minZoomLevel={8}
        filter={['all', ['==', ['get', 'OBJL'], 72], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.LDELV,
          lineWidth: 0.5,
          lineOpacity: 0.4,
          visibility: showLand ? 'visible' : 'none',
        }}
      />,

      /* CBLSUB - Submarine Cables Halo */
      <MapLibre.LineLayer
        key={`${p}-cblsub-halo`}
        id={`${p}-cblsub-halo`}
        sourceLayerID="charts"
        minZoomLevel={6}
        filter={['all', ['==', ['get', 'OBJL'], 22], ['==', ['geometry-type'], 'LineString'], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.HLCLR,
          lineWidth: scaledCableLineWidth + scaledCableLineHalo,
          lineOpacity: scaledCableLineHalo > 0 ? scaledCableLineOpacity * 0.8 : 0,
          visibility: showCables ? 'visible' : 'none',
        }}
      />,

      /* CBLSUB - Submarine Cables */
      <MapLibre.LineLayer
        key={`${p}-cblsub`}
        id={`${p}-cblsub`}
        sourceLayerID="charts"
        minZoomLevel={6}
        filter={['all', ['==', ['get', 'OBJL'], 22], ['==', ['geometry-type'], 'LineString'], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.CABLN,
          lineWidth: scaledCableLineWidth,
          lineDasharray: [3, 2],
          lineOpacity: scaledCableLineOpacity,
          visibility: showCables ? 'visible' : 'none',
        }}
      />,

      /* CBLOHD - Overhead Cables Halo */
      <MapLibre.LineLayer
        key={`${p}-cblohd-halo`}
        id={`${p}-cblohd-halo`}
        sourceLayerID="charts"
        minZoomLevel={6}
        filter={['all', ['==', ['get', 'OBJL'], 21], ['==', ['geometry-type'], 'LineString'], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.HLCLR,
          lineWidth: scaledCableLineWidth + scaledCableLineHalo,
          lineOpacity: scaledCableLineHalo > 0 ? scaledCableLineOpacity * 0.8 : 0,
          visibility: showCables ? 'visible' : 'none',
        }}
      />,

      /* CBLOHD - Overhead Cables */
      <MapLibre.LineLayer
        key={`${p}-cblohd`}
        id={`${p}-cblohd`}
        sourceLayerID="charts"
        minZoomLevel={6}
        filter={['all', ['==', ['get', 'OBJL'], 21], ['==', ['geometry-type'], 'LineString'], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.CABLN,
          lineWidth: scaledCableLineWidth,
          lineDasharray: [8, 4],
          lineOpacity: scaledCableLineOpacity,
          visibility: showCables ? 'visible' : 'none',
        }}
      />,

      /* PIPSOL - Pipelines Halo */
      <MapLibre.LineLayer
        key={`${p}-pipsol-halo`}
        id={`${p}-pipsol-halo`}
        sourceLayerID="charts"
        minZoomLevel={6}
        filter={['all', ['==', ['get', 'OBJL'], 94], ['==', ['geometry-type'], 'LineString'], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.HLCLR,
          lineWidth: scaledPipelineLineWidth + scaledPipelineLineHalo,
          lineOpacity: scaledPipelineLineHalo > 0 ? scaledPipelineLineOpacity * 0.8 : 0,
          visibility: showPipelines ? 'visible' : 'none',
        }}
      />,

      /* PIPSOL - Pipelines */
      <MapLibre.LineLayer
        key={`${p}-pipsol`}
        id={`${p}-pipsol`}
        sourceLayerID="charts"
        minZoomLevel={6}
        filter={['all', ['==', ['get', 'OBJL'], 94], ['==', ['geometry-type'], 'LineString'], scaminFilter, bgFillScaleFilter]}
        style={{
          lineColor: s52Colors.PIPLN,
          lineWidth: scaledPipelineLineWidth,
          lineDasharray: [5, 3],
          lineOpacity: scaledPipelineLineOpacity,
          visibility: showPipelines ? 'visible' : 'none',
        }}
      />,

    ];
  };

  // SUB-GROUP 4: Soundings & seabed — moved to points VectorSource
  // (SOUNDG, SBDARE point layers now rendered from points.mbtiles)
  const renderSoundingLayers = (_prefix: string): React.ReactNode[] => [];

  // SUB-GROUP 5: Labels & text that reference tile data (lines, areas)
  // Point symbol layers (hazards, soundings, nav-aids) have been moved to points VectorSource.
  const renderSymbolLayers = (prefix: string) => {
    const p = prefix;
    return [
      /* ============================================== */
      /* Geographic names (above soundings)             */
      /* ============================================== */

      /* SEAARE - Sea Area (named water bodies) */
      <MapLibre.SymbolLayer
        key={`${p}-seaare`}
        id={`${p}-seaare`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 119], ['has', 'OBJNAM'], scaminFilter, bgFillScaleFilter]}
        style={{
          textField: ['get', 'OBJNAM'],
          textSize: scaledSeaAreaNamesFontSize,
          textColor: s52Colors.SENAM,
          textHaloColor: s52Colors.HLCLR,
          textHaloWidth: scaledSeaAreaNamesHalo,
          textOpacity: scaledSeaAreaNamesOpacity,
          textFont: ['Noto Sans Italic'],
          textAllowOverlap: false,
          symbolSpacing: 500,
          visibility: showSeaAreaNames ? 'visible' : 'none',
        }}
      />,

      /* LNDRGN - Land Region names */
      <MapLibre.SymbolLayer
        key={`${p}-lndrgn`}
        id={`${p}-lndrgn`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 73], ['has', 'OBJNAM'], scaminFilter, bgFillScaleFilter]}
        style={{
          textField: ['get', 'OBJNAM'],
          textSize: 11,
          textColor: s52Colors.LRGNT,
          textHaloColor: s52Colors.HLCLR,
          textHaloWidth: 1.5,
          textFont: ['Noto Sans Regular'],
          textAllowOverlap: false,
          visibility: showLandRegions ? 'visible' : 'none',
        }}
      />,

      /* ============================================== */
      /* S-52 LAYER ORDER: Labels & Text (on top)      */
      /* ============================================== */

      /* CBLSUB Label */
      <MapLibre.SymbolLayer
        key={`${p}-cblsub-label`}
        id={`${p}-cblsub-label`}
        sourceLayerID="charts"
        minZoomLevel={10}
        filter={['all', ['==', ['get', 'OBJL'], 22], scaminFilter, bgFillScaleFilter]}
        style={{
          textField: 'Cable',
          textSize: 9,
          textColor: s52Colors.CBLTX,
          textHaloColor: s52Colors.HLCLR,
          textHaloWidth: 1.5,
          symbolPlacement: 'line',
          symbolSpacing: 400,
          visibility: showCables ? 'visible' : 'none',
        }}
      />,

      /* PIPSOL Label */
      <MapLibre.SymbolLayer
        key={`${p}-pipsol-label`}
        id={`${p}-pipsol-label`}
        sourceLayerID="charts"
        minZoomLevel={10}
        filter={['all', ['==', ['get', 'OBJL'], 94], scaminFilter, bgFillScaleFilter]}
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
          textColor: s52Colors.PIPTX,
          textHaloColor: s52Colors.HLCLR,
          textHaloWidth: 1.5,
          symbolPlacement: 'line',
          symbolSpacing: 400,
          visibility: showPipelines ? 'visible' : 'none',
        }}
      />,

      /* DEPCNT Labels (scale-band filtered, no SCAMIN) */
      <MapLibre.SymbolLayer
        key={`${p}-depcnt-labels`}
        id={`${p}-depcnt-labels`}
        sourceLayerID="charts"
        minZoomLevel={0}
        filter={['all', ['==', ['get', 'OBJL'], 43], contourScaleFilter]}
        style={{
          textField: ['to-string', ['coalesce', ['get', 'VALDCO'], '']],
          textSize: scaledDepthContourFontSize,
          textColor: s52Colors.DPCTX,
          textHaloColor: s52Colors.HLCLR,
          textHaloWidth: scaledDepthContourLabelHalo,
          textOpacity: scaledDepthContourLabelOpacity,
          symbolPlacement: 'line',
          symbolSpacing: 300,
          textFont: ['Noto Sans Regular'],
          textMaxAngle: 30,
          textAllowOverlap: false,
          visibility: showDepthContours ? 'visible' : 'none',
        }}
      />,
    ];
  };

  // ─── POINT LAYERS (VectorSource from points.mbtiles) ──────────────────
  // All point features: soundings, nav-aids, hazards — rendered from a single
  // VectorSource backed by points.mbtiles. Each layer uses sourceLayerID="points".
  const pointLayers = useMemo(() => [
    /* ============================================== */
    /* Soundings & Seabed (from points.mbtiles)      */
    /* ============================================== */

    /* SOUNDG - Soundings (SCAMIN-filtered) */
    <MapLibre.SymbolLayer
      key="pt-soundg"
      id="pt-soundg"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all', ['==', ['get', 'OBJL'], 129], scaminFilter, pointScaleFilter]}
      style={{
        textField: depthTextFieldExpression,
        textSize: scaledSoundingsFontSize,
        textColor: displaySettings.tideCorrectedSoundings ? s52Colors.LITGN : s52Colors.SNDCR,
        textHaloColor: displaySettings.tideCorrectedSoundings ? s52Colors.CHBLK : s52Colors.HLCLR,
        textHaloWidth: displaySettings.tideCorrectedSoundings ? scaledSoundingsHalo * 1.5 : scaledSoundingsHalo,
        textOpacity: scaledSoundingsOpacity,
        textAllowOverlap: true,
        textIgnorePlacement: true,
        textPadding: 0,
        visibility: showSoundings ? 'visible' : 'none',
      }}
    />,

    /* SBDARE - Seabed composition labels */
    <MapLibre.SymbolLayer
      key="pt-sbdare"
      id="pt-sbdare"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all',
        ['==', ['get', 'OBJL'], 121],
        ['has', 'NATSUR'],
        scaminFilter, pointScaleFilter
      ]}
      style={{
        textField: [
          'case',
          ['in', '11', ['to-string', ['get', 'NATSUR']]], 'Co',
          ['in', '14', ['to-string', ['get', 'NATSUR']]], 'Sh',
          ['==', ['get', 'NATSUR'], '1'], 'M',
          ['==', ['get', 'NATSUR'], '2'], 'Cy',
          ['==', ['get', 'NATSUR'], '3'], 'Si',
          ['==', ['get', 'NATSUR'], '4'], 'S',
          ['==', ['get', 'NATSUR'], '5'], 'St',
          ['==', ['get', 'NATSUR'], '6'], 'G',
          ['==', ['get', 'NATSUR'], '7'], 'P',
          ['==', ['get', 'NATSUR'], '8'], 'Cb',
          ['==', ['get', 'NATSUR'], '9'], 'R',
          '',
        ],
        textSize: scaledSeabedNamesFontSize,
        textColor: s52Colors.SBDTX,
        textHaloColor: s52Colors.HLCLR,
        textHaloWidth: scaledSeabedNamesHalo,
        textOpacity: scaledSeabedNamesOpacity,
        textFont: ['Noto Sans Italic'],
        textAllowOverlap: true,
        textIgnorePlacement: true,
        visibility: showSeabed ? 'visible' : 'none',
      }}
    />,

    /* ============================================== */
    /* Hazard point symbols (from points.mbtiles)    */
    /* ============================================== */

    /* UWTROC - Underwater Rocks */
    <MapLibre.SymbolLayer
      key="pt-uwtroc"
      id="pt-uwtroc"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all', ['==', ['get', 'OBJL'], 153], scaminFilter, pointScaleFilter]}
      style={{
        iconImage: [
          'case',
          ['==', ['coalesce', ['get', 'WATLEV'], 3], 2], 'rock-above-water',
          ['==', ['coalesce', ['get', 'WATLEV'], 3], 3], 'rock-submerged',
          ['==', ['coalesce', ['get', 'WATLEV'], 3], 4], 'rock-uncovers',
          ['==', ['coalesce', ['get', 'WATLEV'], 3], 5], 'rock-awash',
          'rock-submerged',
        ],
        iconSize: scaledRockIconSize,
        iconOpacity: scaledRockSymbolOpacity,
        iconAllowOverlap: true,
        iconIgnorePlacement: true,
        visibility: showHazards ? 'visible' : 'none',
      }}
    />,

    /* OBSTRN - Obstructions */
    <MapLibre.SymbolLayer
      key="pt-obstrn"
      id="pt-obstrn"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all', ['==', ['get', 'OBJL'], 86], scaminFilter, pointScaleFilter]}
      style={{
        iconImage: 'obstruction',
        iconSize: scaledHazardIconSize,
        iconOpacity: scaledHazardSymbolOpacity,
        iconAllowOverlap: true,
        iconIgnorePlacement: true,
        visibility: showHazards ? 'visible' : 'none',
      }}
    />,

    /* WATTUR halo - Water Turbulence */
    <MapLibre.SymbolLayer
      key="pt-wattur-halo"
      id="pt-wattur-halo"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all', ['==', ['get', 'OBJL'], 156], scaminFilter, pointScaleFilter]}
      style={{
        iconImage: 'tide-rips-halo',
        iconSize: scaledTideRipsHaloSize,
        iconOpacity: scaledTideRipsSymbolOpacity,
        iconAllowOverlap: true,
        iconIgnorePlacement: true,
        visibility: showHazards ? 'visible' : 'none',
      }}
    />,

    /* WATTUR - Water Turbulence */
    <MapLibre.SymbolLayer
      key="pt-wattur"
      id="pt-wattur"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all', ['==', ['get', 'OBJL'], 156], scaminFilter, pointScaleFilter]}
      style={{
        iconImage: 'tide-rips',
        iconSize: scaledTideRipsIconSize,
        iconOpacity: scaledTideRipsSymbolOpacity,
        iconAllowOverlap: true,
        iconIgnorePlacement: true,
        visibility: showHazards ? 'visible' : 'none',
      }}
    />,

    /* UWTROC Label */
    <MapLibre.SymbolLayer
      key="pt-uwtroc-label"
      id="pt-uwtroc-label"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all', ['==', ['get', 'OBJL'], 153], ['has', 'VALSOU'], scaminFilter, pointScaleFilter]}
      style={{
        textField: ['to-string', ['round', ['get', 'VALSOU']]],
        textSize: 9,
        textColor: s52Colors.CHBLK,
        textHaloColor: s52Colors.HLCLR,
        textHaloWidth: 1.5,
        textOffset: [0, 1.3],
        visibility: showHazards ? 'visible' : 'none',
      }}
    />,

    /* ============================================== */
    /* Nav-aid symbols (from points.mbtiles)         */
    /* ============================================== */

    /* MORFAC - Mooring Facilities (point symbol) */
    <MapLibre.SymbolLayer
      key="pt-morfac"
      id="pt-morfac"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all', ['==', ['get', 'OBJL'], 84], scaminFilter, pointScaleFilter]}
      style={{
        iconImage: 'mooring-buoy',
        iconSize: scaledMooringIconSize,
        iconOpacity: scaledMooringSymbolOpacity,
        iconAllowOverlap: true,
        iconIgnorePlacement: true,
        visibility: showMoorings ? 'visible' : 'none',
      }}
    />,

    /* WRECKS - Wrecks */
    <MapLibre.SymbolLayer
      key="pt-wrecks"
      id="pt-wrecks"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all', ['==', ['get', 'OBJL'], 159], scaminFilter, pointScaleFilter]}
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
        iconIgnorePlacement: true,
        visibility: showHazards ? 'visible' : 'none',
      }}
    />,

    /* DAYMAR - Daymarks */
    <MapLibre.SymbolLayer
      key="pt-daymar"
      id="pt-daymar"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all', ['==', ['get', 'OBJL'], 39], scaminFilter, pointScaleFilter]}
      style={{
        iconImage: 'beacon-generic',
        iconSize: scaledBeaconIconSize,
        iconOpacity: scaledBeaconSymbolOpacity,
        iconAllowOverlap: true,
        iconIgnorePlacement: true,
        visibility: showBeacons ? 'visible' : 'none',
      }}
    />,

    /* TOPMAR - Topmarks */
    <MapLibre.SymbolLayer
      key="pt-topmar"
      id="pt-topmar"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all', ['==', ['get', 'OBJL'], 144], scaminFilter, pointScaleFilter]}
      style={{
        iconImage: 'beacon-generic',
        iconSize: scaledBeaconIconSize,
        iconOpacity: scaledBeaconSymbolOpacity,
        iconAllowOverlap: true,
        iconIgnorePlacement: true,
        visibility: showBeacons ? 'visible' : 'none',
      }}
    />,

    /* FOGSIG - Fog Signals */
    <MapLibre.CircleLayer
      key="pt-fogsig"
      id="pt-fogsig"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all', ['==', ['get', 'OBJL'], 58], scaminFilter, pointScaleFilter]}
      style={{
        circleColor: s52Colors.FOGSN,
        circleRadius: ['interpolate', ['linear'], ['zoom'], 8, 3, 14, 5],
        circleStrokeColor: s52Colors.HLCLR,
        circleStrokeWidth: 1,
        circleOpacity: 0.8,
      }}
    />,

    /* PILPNT - Pile/Pile Point */
    <MapLibre.CircleLayer
      key="pt-pilpnt"
      id="pt-pilpnt"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all', ['==', ['get', 'OBJL'], 90], scaminFilter, pointScaleFilter]}
      style={{
        circleColor: s52Colors.PILPT,
        circleRadius: ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 4],
        circleStrokeColor: s52Colors.CHBLK,
        circleStrokeWidth: 1,
      }}
    />,

    /* RSCSTA - Rescue Station */
    <MapLibre.CircleLayer
      key="pt-rscsta"
      id="pt-rscsta"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all', ['==', ['get', 'OBJL'], 111], scaminFilter, pointScaleFilter]}
      style={{
        circleColor: s52Colors.RSCST,
        circleRadius: ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 6],
        circleStrokeColor: s52Colors.HLCLR,
        circleStrokeWidth: 2,
      }}
    />,

    /* Buoy halos */
    <MapLibre.SymbolLayer
      key="pt-buoys-halo"
      id="pt-buoys-halo"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all',
        ['any',
          ['==', ['get', 'OBJL'], 17],
          ['==', ['get', 'OBJL'], 14],
          ['==', ['get', 'OBJL'], 18],
          ['==', ['get', 'OBJL'], 19],
          ['==', ['get', 'OBJL'], 16],
          ['==', ['get', 'OBJL'], 15]
        ],
        scaminFilter, pointScaleFilter
      ]}
      style={{
        iconImage: [
          'match',
          ['get', 'BOYSHP'],
          1, 'buoy-conical-halo',
          2, 'buoy-can-halo',
          3, 'buoy-spherical-halo',
          4, 'buoy-pillar-halo',
          5, 'buoy-spar-halo',
          6, 'buoy-barrel-halo',
          7, 'buoy-super-halo',
          'buoy-pillar-halo',
        ],
        iconSize: scaledBuoyHaloSize,
        iconOpacity: scaledBuoySymbolOpacity,
        iconAllowOverlap: true,
        iconIgnorePlacement: true,
        visibility: showBuoys ? 'visible' : 'none',
      }}
    />,

    /* Buoys - BOYLAT, BOYCAR, etc. */
    <MapLibre.SymbolLayer
      key="pt-buoys"
      id="pt-buoys"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all',
        ['any',
          ['==', ['get', 'OBJL'], 17],
          ['==', ['get', 'OBJL'], 14],
          ['==', ['get', 'OBJL'], 18],
          ['==', ['get', 'OBJL'], 19],
          ['==', ['get', 'OBJL'], 16],
          ['==', ['get', 'OBJL'], 15]
        ],
        scaminFilter, pointScaleFilter
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
        iconIgnorePlacement: true,
        visibility: showBuoys ? 'visible' : 'none',
      }}
    />,

    /* Beacon halos */
    <MapLibre.SymbolLayer
      key="pt-beacons-halo"
      id="pt-beacons-halo"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all',
        ['any',
          ['==', ['get', 'OBJL'], 7],
          ['==', ['get', 'OBJL'], 5],
          ['==', ['get', 'OBJL'], 8],
          ['==', ['get', 'OBJL'], 9],
          ['==', ['get', 'OBJL'], 6]
        ],
        scaminFilter, pointScaleFilter
      ]}
      style={{
        iconImage: [
          'match',
          ['get', 'BCNSHP'],
          1, 'beacon-stake-halo',
          2, 'beacon-withy-halo',
          3, 'beacon-tower-halo',
          4, 'beacon-lattice-halo',
          5, 'beacon-cairn-halo',
          'beacon-generic-halo',
        ],
        iconSize: scaledBeaconHaloSize,
        iconOpacity: scaledBeaconSymbolOpacity,
        iconAllowOverlap: true,
        iconIgnorePlacement: true,
        visibility: showBeacons ? 'visible' : 'none',
      }}
    />,

    /* Beacons - BCNLAT, BCNCAR, etc. */
    <MapLibre.SymbolLayer
      key="pt-beacons"
      id="pt-beacons"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all',
        ['any',
          ['==', ['get', 'OBJL'], 7],
          ['==', ['get', 'OBJL'], 5],
          ['==', ['get', 'OBJL'], 8],
          ['==', ['get', 'OBJL'], 9],
          ['==', ['get', 'OBJL'], 6]
        ],
        scaminFilter, pointScaleFilter
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
        iconIgnorePlacement: true,
        visibility: showBeacons ? 'visible' : 'none',
      }}
    />,

    /* Landmark halos */
    <MapLibre.SymbolLayer
      key="pt-lndmrk-halo"
      id="pt-lndmrk-halo"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all', ['==', ['get', 'OBJL'], 74], scaminFilter, pointScaleFilter]}
      style={{
        iconImage: [
          'match',
          ['get', 'CATLMK'],
          3, 'landmark-chimney-halo',
          5, 'landmark-flagpole-halo',
          7, 'landmark-mast-halo',
          9, 'landmark-monument-halo',
          10, 'landmark-monument-halo',
          12, 'landmark-monument-halo',
          13, 'landmark-monument-halo',
          14, 'landmark-church-halo',
          17, 'landmark-tower-halo',
          18, 'landmark-windmill-halo',
          19, 'landmark-windmill-halo',
          20, 'landmark-church-halo',
          28, 'landmark-radio-tower-halo',
          'landmark-tower-halo',
        ],
        iconSize: scaledLandmarkHaloSize,
        iconOpacity: scaledLandmarkSymbolOpacity,
        iconAllowOverlap: true,
        iconIgnorePlacement: true,
        visibility: showLandmarks ? 'visible' : 'none',
      }}
    />,

    /* LNDMRK - Landmarks */
    <MapLibre.SymbolLayer
      key="pt-lndmrk"
      id="pt-lndmrk"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all', ['==', ['get', 'OBJL'], 74], scaminFilter, pointScaleFilter]}
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
        iconIgnorePlacement: true,
        visibility: showLandmarks ? 'visible' : 'none',
      }}
    />,

    /* LNDMRK Label */
    <MapLibre.SymbolLayer
      key="pt-lndmrk-label"
      id="pt-lndmrk-label"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all', ['==', ['get', 'OBJL'], 74], scaminFilter, pointScaleFilter]}
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
        textColor: s52Colors.CHBLK,
        textHaloColor: s52Colors.HLCLR,
        textHaloWidth: 1.5,
        textOffset: [0, 1.3],
        textAllowOverlap: false,
        visibility: showLandmarks ? 'visible' : 'none',
      }}
    />,

    /* LIGHTS - symbols (topmost nav aid per ECDIS display priority) */
    <MapLibre.SymbolLayer
      key="pt-lights"
      id="pt-lights"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all', ['==', ['get', 'OBJL'], 75], scaminFilter, pointScaleFilter]}
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
    />,

    /* ACHBRT - Anchor Berths */
    <MapLibre.SymbolLayer
      key="pt-achbrt"
      id="pt-achbrt"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all', ['==', ['get', 'OBJL'], 3], scaminFilter, pointScaleFilter]}
      style={{
        iconImage: 'anchor',
        iconSize: scaledAnchorIconSize,
        iconOpacity: scaledAnchorSymbolOpacity,
        iconAllowOverlap: true,
        iconIgnorePlacement: true,
        visibility: showAnchorBerths ? 'visible' : 'none',
      }}
    />,

    /* ACHBRT Label */
    <MapLibre.SymbolLayer
      key="pt-achbrt-label"
      id="pt-achbrt-label"
      sourceLayerID="points"
      minZoomLevel={0}
      filter={['all', ['==', ['get', 'OBJL'], 3], scaminFilter, pointScaleFilter]}
      style={{
        textField: ['coalesce', ['get', 'OBJNAM'], 'Anchorage'],
        textSize: 10,
        textColor: s52Colors.ACHBT,
        textHaloColor: s52Colors.HLCLR,
        textHaloWidth: 1.5,
        textOffset: [0, 1.5],
        textAllowOverlap: false,
        visibility: showAnchorBerths ? 'visible' : 'none',
      }}
    />,

  ], [scaminFilter, pointScaleFilter, s52Colors, depthTextFieldExpression,
    showSoundings, showSeabed, showHazards, showMoorings, showBeacons, showBuoys, showLandmarks, showLights, showAnchorBerths,
    scaledSoundingsFontSize, scaledSoundingsHalo, scaledSoundingsOpacity,
    scaledSeabedNamesFontSize, scaledSeabedNamesHalo, scaledSeabedNamesOpacity,
    scaledRockIconSize, scaledRockSymbolOpacity,
    scaledHazardIconSize, scaledHazardSymbolOpacity,
    scaledTideRipsIconSize, scaledTideRipsHaloSize, scaledTideRipsSymbolOpacity,
    scaledMooringIconSize, scaledMooringSymbolOpacity,
    scaledWreckIconSize, scaledWreckSymbolOpacity,
    scaledBeaconIconSize, scaledBeaconHaloSize, scaledBeaconSymbolOpacity,
    scaledBuoyIconSize, scaledBuoyHaloSize, scaledBuoySymbolOpacity,
    scaledLightIconSize, scaledLightSymbolOpacity,
    scaledLandmarkIconSize, scaledLandmarkHaloSize, scaledLandmarkSymbolOpacity,
    scaledAnchorIconSize, scaledAnchorSymbolOpacity,
    displaySettings.tideCorrectedSoundings,
  ]);

  // Composition function — calls all sub-groups in order
  const renderChartLayers = (prefix: string) => [
    ...renderFillLayers(prefix),
    ...renderStructureLayers(prefix),
    ...renderLineLayers(prefix),
    ...renderSoundingLayers(prefix),
    ...renderSymbolLayers(prefix),
  ];

  // ─── CHART LAYER SUB-CACHES ────────────────────────────────────────
  // Split into 5 sub-group caches for finer-grained memoization.
  // When a display slider changes, only the affected sub-group rebuilds its JSX.
  // Unchanged sub-groups return the same element references — React skips their reconciliation.

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fillLayerCache = useMemo(() => {
    const cache: Record<string, React.ReactNode[]> = {};
    for (const source of chartScaleSources) cache[source.sourceId] = renderFillLayers(source.sourceId);
    return cache;
  }, [chartScaleSources, scaminFilter, bgFillScaleFilter, showScaleDebug,
    showDepthAreas, showDepthContours, showLand, showCables, showPipelines,
    showRestrictedAreas, showCautionAreas, showMilitaryAreas, showAnchorages, showMarineFarms, showTrafficRoutes,
    showSeaAreaNames, showLandRegions, showSeabed,
    hasLandRasterTiles, hasMarineRasterTiles, ecdisColors, s52Colors, displaySettings.depthContourLineScale,
    scaledDepthAreaOpacity, scaledDepthAreaOpacitySatellite, scaledDepthContourLineOpacity,
    scaledDredgedAreaOpacity, scaledFairwayOpacity,
    scaledCableAreaOpacity, scaledPipelineAreaOpacity,
    scaledCableLineWidth, scaledCableLineOpacity,
    scaledPipelineLineWidth, scaledPipelineLineOpacity,
    scaledRestrictedAreaOpacity, scaledCautionAreaOpacity,
    scaledMilitaryAreaOpacity, scaledAnchorageOpacity, scaledMarineFarmOpacity,
  ]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const structureLayerCache = useMemo(() => {
    const cache: Record<string, React.ReactNode[]> = {};
    for (const source of chartScaleSources) cache[source.sourceId] = renderStructureLayers(source.sourceId);
    return cache;
  }, [chartScaleSources, scaminFilter, bgFillScaleFilter, s52Colors,
    showBridges, showBuildings, showMoorings, showShorelineConstruction,
    scaledBridgeLineWidth, scaledBridgeLineHalo, scaledBridgeOpacity,
    scaledMooringLineWidth, scaledMooringLineHaloWidth, scaledMooringLineHalo, scaledMooringOpacity,
    scaledShorelineConstructionLineWidth, scaledShorelineConstructionHaloWidth,
    scaledShorelineConstructionHalo, scaledShorelineConstructionOpacity,
  ]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lineLayerCache = useMemo(() => {
    const cache: Record<string, React.ReactNode[]> = {};
    for (const source of chartScaleSources) cache[source.sourceId] = renderLineLayers(source.sourceId);
    return cache;
  }, [chartScaleSources, scaminFilter, bgFillScaleFilter, contourScaleFilter, s52Colors, s52Mode,
    showDepthContours, showCoastline, showLand, showCables, showPipelines,
    scaledDepthContourLineWidth, scaledDepthContourLineHaloWidth,
    scaledDepthContourLineHalo, scaledDepthContourLineOpacity,
    scaledCoastlineLineWidth, scaledCoastlineHaloWidth, scaledCoastlineHalo, scaledCoastlineOpacity,
    scaledCableLineWidth, scaledCableLineHalo, scaledCableLineOpacity,
    scaledPipelineLineWidth, scaledPipelineLineHalo, scaledPipelineLineOpacity,
  ]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const soundingLayerCache = useMemo(() => {
    const cache: Record<string, React.ReactNode[]> = {};
    for (const source of chartScaleSources) cache[source.sourceId] = renderSoundingLayers(source.sourceId);
    return cache;
  }, [chartScaleSources]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const symbolLayerCache = useMemo(() => {
    const cache: Record<string, React.ReactNode[]> = {};
    for (const source of chartScaleSources) cache[source.sourceId] = renderSymbolLayers(source.sourceId);
    return cache;
  }, [chartScaleSources, scaminFilter, bgFillScaleFilter, contourScaleFilter, s52Colors,
    showCables, showPipelines, showDepthContours,
    showSeaAreaNames, showLandRegions,
    scaledSeaAreaNamesFontSize, scaledSeaAreaNamesHalo, scaledSeaAreaNamesOpacity,
    scaledDepthContourFontSize, scaledDepthContourLabelHalo, scaledDepthContourLabelOpacity,
  ]);

  // Composition: merge sub-group caches into final layer array per source.
  // When a sub-group cache is stable (same reference), the spread is cheap
  // and React's reconciliation skips those elements.
  const chartLayerCache = useMemo(() => {
    const cache: Record<string, React.ReactNode[]> = {};
    for (const source of chartScaleSources) {
      const sid = source.sourceId;
      cache[sid] = [
        ...(fillLayerCache[sid] || []),
        ...(structureLayerCache[sid] || []),
        ...(lineLayerCache[sid] || []),
        ...(soundingLayerCache[sid] || []),
        ...(symbolLayerCache[sid] || []),
      ];
    }
    return cache;
  }, [chartScaleSources, fillLayerCache, structureLayerCache, lineLayerCache, soundingLayerCache, symbolLayerCache]);

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
                (navigation as any)?.navigate('Charts');
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
      <View style={styles.mapTouchWrapper}>
      <MapLibre.MapView
        key={`map-${landImagery}-${s52Mode}-${mapResetKey}`}
        ref={mapRef}
        style={styles.map}
        // DO NOT set mapStyle prop — it triggers native removeAllSourcesFromMap()
        // which races with child VectorSource registration. Instead, we cover the
        // default style with a BackgroundLayer (first child below).
        onRegionWillChange={handleRegionWillChange}
        onRegionDidChange={handleCameraChanged}
        onRegionIsChanging={handleCameraMoving}
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
          // defaultSettings is read ONCE at mount time by MapLibre's Camera
          // (it uses useState internally, ignoring later prop changes).
          // However, when the MapView's `key` changes (e.g. S-52 mode switch),
          // the Camera remounts and re-reads defaultSettings.
          // Using centerCoordRef (a ref) instead of centerCoord (state) ensures
          // that a remount picks up the user's CURRENT viewport position rather
          // than the stale district center set during initial loadCharts().
          defaultSettings={{
            zoomLevel: currentZoom,
            centerCoordinate: centerCoordRef.current,
          }}
          // CONTROLLED centerCoordinate: only set when following GPS, undefined otherwise
          // This lets the user pan freely when not following.
          // Reads from gpsDataRef to avoid re-render dependency on GPS state.
          centerCoordinate={
            followGPS && gpsDataRef.current.latitude !== null && gpsDataRef.current.longitude !== null
              ? [gpsDataRef.current.longitude, gpsDataRef.current.latitude]
              : undefined
          }
          animationDuration={0}
          maxZoomLevel={effectiveMaxZoom}
          minZoomLevel={0}
        />

        {/* Background layer covers MapLibre's default demo tiles with our S-52 color */}
        <MapLibre.BackgroundLayer
          id="app-background"
          style={{ backgroundColor: mapBackgroundColor, backgroundOpacity: 1.0 }}
        />

        <MapLibre.Images images={NAV_SYMBOLS} />

        {/* ================================================================== */}
        {/* OCEAN BASEMAP - ESRI Ocean raster tiles (per zoom level)           */}
        {/* Renders BELOW satellite so satellite covers ESRI's land rendering  */}
        {/* On open water (no satellite tiles), ocean tiles show through       */}
        {/* ================================================================== */}
        {tileServerReady && oceanTileSets.length > 0 && oceanTileSets.map((tileSet) => {
          const oceanVisible = (hasMarineRasterTiles && debugIsSourceVisible('ocean')) ? 1 : 0;
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

        {/* Satellite Imagery - renders ABOVE ocean so it covers ESRI's land rendering */}
        {/* Each satellite_z*.mbtiles file is loaded as a separate source with its zoom range */}
        {tileServerReady && satelliteTileSets.length > 0 && satelliteTileSets.map((tileSet) => {
          const satelliteVisible = (landImagery === 'satellite' && debugIsSourceVisible('satellite')) ? 1 : 0;
          // Log satellite visibility during style switch
          if (styleSwitchStartRef.current > 0 && landImagery === 'satellite' && tileSet.minZoom === 0) {
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
        {/* TERRAIN BASEMAP - OpenTopoMap raster tiles (per zoom level)        */}
        {/* Same pattern as satellite: one RasterSource per terrain_z*.mbtiles */}
        {/* ================================================================== */}
        {tileServerReady && terrainTileSets.length > 0 && terrainTileSets.map((tileSet) => {
          const terrainVisible = (landImagery === 'terrain' && debugIsSourceVisible('terrain')) ? 1 : 0;
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
        {/* Powers: Light, Dark, ECDIS, Street modes from one download         */}
        {/* Colors are driven by basemapPalette (changes per selected style)   */}
        {/* Foreground layers (roads, labels) are in BASEMAP OVERLAY below     */}
        {/* ================================================================== */}
        {/* Basemap background (water, landcover, parks) disabled — chart DEPARE/LNDARE
            fills provide S-52 colors, MapView background handles uncovered areas */}

        {/* ================================================================== */}
        {/* MULTI-SOURCE CHART RENDERING                                    */}
        {/* Separate VectorSource per scale pack (US1-US5) for seamless     */}
        {/* multi-scale display. MapLibre composites all sources naturally.  */}
        {/* Ordered least→most detailed so detailed features render on top. */}
        {/* All sources always mounted for stable layer order.               */}
        {/* chartLayerCache (memoized JSX to prevent recreation on pan/zoom)*/}
        {/* ================================================================== */}
        {/* Unified chart VectorSource (z0-15).                                  */}
        {useMBTiles && tileServerReady && debugIsSourceVisible('charts') && chartScaleSources.length > 0 && (
          chartScaleSources.map(source => (
            <MapLibre.VectorSource
              key={source.sourceId}
              id={source.sourceId}
              tileUrlTemplates={[source.tileUrl]}
              minZoomLevel={source.minZoom}
              maxZoomLevel={source.maxZoom}
            >
              {chartLayerCache[source.sourceId]}
            </MapLibre.VectorSource>
          ))
        )}

        {/* ================================================================== */}
        {/* POINTS VECTORSOURCE — all point features (soundings, lights,   */}
        {/* buoys, beacons, wrecks, rocks, etc.) from points.mbtiles.      */}
        {/* Single VectorSource, SCAMIN-based visibility, native tile IO.  */}
        {/* ================================================================== */}
        {pointsTileUrl && (
          <MapLibre.VectorSource
            id="points"
            tileUrlTemplates={[pointsTileUrl]}
            minZoomLevel={0}
            maxZoomLevel={15}
          >
            {pointLayers}
          </MapLibre.VectorSource>
        )}

        {/* Dynamic sector arcs — screen-constant size per S-52 §3.1.5.
            Always mounted to avoid mount/unmount churn; visibility controls display. */}
        <MapLibre.ShapeSource id="sector-arcs-source" shape={sectorArcFeatures}>
          <MapLibre.LineLayer id="sector-arcs-outline" style={{
            lineColor: s52Colors.CHBLK, lineWidth: 5, lineOpacity: 0.8,
            visibility: showSectors && sectorArcFeatures.features.length > 0 ? 'visible' : 'none',
          }} />
          <MapLibre.LineLayer id="sector-arcs-fill" style={{
            lineColor: ['match', ['get', 'COLOUR'],
              1, s52Colors.LITYW, 3, s52Colors.LITRD, 4, s52Colors.LITGN, 6, s52Colors.CHCOR, s52Colors.LITYW],
            lineWidth: 3, lineOpacity: 1.0,
            visibility: showSectors && sectorArcFeatures.features.length > 0 ? 'visible' : 'none',
          }} />
        </MapLibre.ShapeSource>

        {/* ================================================================== */}
        {/* BASEMAP OVERLAY - Roads, buildings, labels rendered ABOVE charts   */}
        {/* Uses a separate VectorSource so these land-context features appear */}
        {/* on top of the opaque chart fills (DEPARE, LNDARE)                 */}
        {/* ================================================================== */}
        {tileServerReady && hasLocalBasemap && showVectorBasemap && debugIsSourceVisible('basemap') && (() => {
          const p = basemapPalette;
          const vis = 'visible';
          const basemapTileUrl = basemapTileSets.length > 0
            ? `${tileServer.getTileServerUrl()}/tiles/${basemapTileSets[0].id}/{z}/{x}/{y}.pbf`
            : `${tileServer.getTileServerUrl()}/tiles/basemap/{z}/{x}/{y}.pbf`;
          return (
          <MapLibre.VectorSource
            key={`basemap-overlay-${landImagery}-${s52Mode}`}
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
            {/* iconAllowOverlap=true: always draw, bypass global collision grid */}
            {/* (chart text, basemap labels, GNIS all reserve collision space that would push icons out) */}
            {/* Visibility controlled by synthetic SCAMIN 3,000,000 via Chart Detail offset */}
            <MapLibre.SymbolLayer
              id="tide-stations-halo"
              minZoomLevel={stationIconMinZoom}
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
              minZoomLevel={stationIconMinZoom}
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
            {/* Visibility controlled by synthetic SCAMIN 120,000 via Chart Detail offset */}
            <MapLibre.SymbolLayer
              id="tide-stations-label"
              minZoomLevel={stationLabelMinZoom}
              style={{
                textField: ['get', 'name'],
                textFont: ['Noto Sans Regular'],
                textSize: scaledTideStationLabelSize,
                textColor: s52Colors.TIDTX,
                textHaloColor: s52Colors.HLCLR,
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
                textIgnorePlacement: true,
              }}
            />
            {/* Tide height value label - further out from arrow head */}
            <MapLibre.SymbolLayer
              id="tide-stations-value"
              minZoomLevel={stationLabelMinZoom}
              style={{
                textField: ['get', 'heightLabel'],
                textFont: ['Noto Sans Regular'],
                textSize: scaledTideStationLabelSize,
                textColor: s52Colors.TIDTX,
                textHaloColor: s52Colors.HLCLR,
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
                textIgnorePlacement: true,
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
            {/* iconAllowOverlap=true: always draw, bypass global collision grid */}
            {/* (chart text, basemap labels, GNIS all reserve collision space that would push icons out) */}
            {/* Visibility controlled by synthetic SCAMIN 3,000,000 via Chart Detail offset */}
            <MapLibre.SymbolLayer
              id="current-stations-halo"
              minZoomLevel={stationIconMinZoom}
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
              minZoomLevel={stationIconMinZoom}
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
            {/* Visibility controlled by synthetic SCAMIN 120,000 via Chart Detail offset */}
            <MapLibre.SymbolLayer
              id="current-stations-label"
              minZoomLevel={stationLabelMinZoom}
              style={{
                textField: ['get', 'name'],
                textFont: ['Noto Sans Regular'],
                textSize: scaledCurrentStationLabelSize,
                textColor: s52Colors.CURTX,
                textHaloColor: s52Colors.HLCLR,
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
                textIgnorePlacement: true,
              }}
            />
            {/* Current velocity label - further out from arrow head */}
            <MapLibre.SymbolLayer
              id="current-stations-value"
              minZoomLevel={stationLabelMinZoom}
              style={{
                textField: ['get', 'velocityLabel'],
                textFont: ['Noto Sans Regular'],
                textSize: scaledCurrentStationLabelSize,
                textColor: s52Colors.CURTX,
                textHaloColor: s52Colors.HLCLR,
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
                textIgnorePlacement: true,
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
                  textSize: scaledLiveBuoyTextSize,
                  textColor: s52Colors.BUYTX,
                  textHaloColor: s52Colors.HLCLR,
                  textHaloWidth: scaledLiveBuoyTextHalo,
                  textOpacity: scaledLiveBuoyTextOpacity,
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
            tileUrlTemplates={[`${tileServer.getTileServerUrl()}/tiles/gnis_names/{z}/{x}/{y}.pbf`]}
            maxZoomLevel={14}
          >
            {/* Water features - Bays, channels, sounds */}
            <MapLibre.SymbolLayer
              id="gnis-water-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'water']}
              minZoomLevel={gnisWaterMinZoom}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Regular'],
                textSize: scaledGnisFontSizes.water,
                textColor: s52Colors.GNSWT,
                textHaloColor: s52Colors.HLCLR,
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
              minZoomLevel={gnisWaterMinZoom}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Regular'],
                textSize: scaledGnisFontSizes.coastal,
                textColor: s52Colors.GNSCL,
                textHaloColor: s52Colors.HLCLR,
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
              minZoomLevel={gnisLandmarkMinZoom}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Regular'], // Changed from Italic to Regular
                textSize: scaledGnisFontSizes.landmark,
                textColor: s52Colors.GNSLM,
                textHaloColor: s52Colors.HLCLR,
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
              minZoomLevel={gnisWaterMinZoom}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Regular'], // Changed from Bold to Regular
                textSize: scaledGnisFontSizes.populated,
                textColor: s52Colors.GNSPP,
                textHaloColor: s52Colors.HLCLR,
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
              minZoomLevel={gnisStreamMinZoom}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Regular'], // Changed from Italic to Regular
                textSize: scaledGnisFontSizes.stream,
                textColor: s52Colors.GNSST,
                textHaloColor: s52Colors.HLCLR,
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
              minZoomLevel={gnisStreamMinZoom}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Regular'], // Changed from Italic to Regular
                textSize: scaledGnisFontSizes.lake,
                textColor: s52Colors.GNSLK,
                textHaloColor: s52Colors.HLCLR,
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
              minZoomLevel={gnisTerrainMinZoom}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['Noto Sans Regular'],
                textSize: scaledGnisFontSizes.terrain,
                textColor: s52Colors.GNSTR,
                textHaloColor: s52Colors.HLCLR,
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

        {/* Active Route Line and Points */}
        {activeRoute && activeRoute.routePoints.length > 1 && (
          <MapLibre.ShapeSource
            id="active-route-source"
            shape={{
              type: 'FeatureCollection',
              features: [{
                type: 'Feature',
                geometry: {
                  type: 'LineString',
                  coordinates: activeRoute.routePoints.map(p => [p.position.longitude, p.position.latitude]),
                },
                properties: {},
              }],
            }}
          >
            <MapLibre.LineLayer
              id="active-route-line"
              style={{
                lineColor: activeRoute.color,
                lineWidth: 3,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </MapLibre.ShapeSource>
        )}

        {/* Active Route Point Markers */}
        {activeRoute && activeRoute.routePoints.map((point, index) => (
          <MapLibre.MarkerView
            key={point.id}
            coordinate={[point.position.longitude, point.position.latitude]}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.routePointMarker}>
              <Text style={styles.routePointNumber}>{index + 1}</Text>
            </View>
          </MapLibre.MarkerView>
        ))}

        {/* GPS Position Marker — isolated component with own 1s timer.
            Only this tiny subtree re-renders from GPS changes, not the
            entire DynamicChartViewer with 200+ MapLibre layers. */}
        <GPSMarkerView gpsDataRef={gpsDataRef} />

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

      {/* Stop Panning button - appears when user has panned away from GPS */}
      {!followGPS && gpsDataRef.current.latitude !== null && (
        <TouchableOpacity
          style={[styles.stopPanningBtn, { top: insets.top + 80 }]}
          onPress={() => {
            followGPSRef.current = true;
            setFollowGPS(true);
            const lat = gpsDataRef.current.latitude;
            const lon = gpsDataRef.current.longitude;
            if (lat !== null && lon !== null) {
              cameraRef.current?.setCamera({
                centerCoordinate: [lon, lat],
                animationDuration: 300,
              });
            }
          }}
        >
          <Text style={styles.stopPanningText}>Stop Panning</Text>
        </TouchableOpacity>
      )}

      {/* Crosshair overlay - shows screen center when panning */}
      {!followGPS && (
        <View style={styles.crosshairContainer} pointerEvents="none">
          <View style={styles.crosshairH} />
          <View style={styles.crosshairV} />
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
        <View style={styles.topMenuDivider} />
        
        {/* Routes button - opens routes modal */}
        <TouchableOpacity 
          style={[styles.topMenuBtn, showRoutesModal && styles.topMenuBtnActive]}
          onPress={openRoutesModal}
        >
          <Ionicons 
            name="map" 
            size={24} 
            color="#fff" 
          />
        </TouchableOpacity>
        <View style={styles.topMenuDivider} />
        
        {/* New Route button */}
        <TouchableOpacity 
          style={[styles.topMenuBtn, activeRoute && styles.topMenuBtnActive]}
          onPress={() => {
            if (activeRoute) {
              // Already have active route, toggle editor
              setShowRouteEditor(!showRouteEditor);
            } else {
              // Start new route
              const routeName = `Route ${new Date().toLocaleString()}`;
              startNewRoute(routeName);
              setShowRouteEditor(true);
            }
          }}
        >
          <Ionicons 
            name={activeRoute ? "create" : "add-circle-outline"} 
            size={24} 
            color={activeRoute ? "#FF6B35" : "#fff"} 
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
                {/* Land Imagery */}
                <Text style={styles.layerSectionHeader}>Land</Text>
                <TouchableOpacity style={[styles.layerToggleRow, landImagery === 'satellite' && styles.layerToggleRowActive]} onPress={() => setLandImagery('satellite')}>
                  <Text style={styles.layerToggleText}>Satellite</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.layerToggleRow, landImagery === 'terrain' && styles.layerToggleRowActive, !hasLocalTerrain && { opacity: 0.4 }]}
                  onPress={() => hasLocalTerrain && setLandImagery('terrain')}
                  disabled={!hasLocalTerrain}
                >
                  <Text style={styles.layerToggleText}>Terrain{!hasLocalTerrain ? ' ⬇' : ''}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.layerToggleRow, landImagery === 'street' && styles.layerToggleRowActive, !hasLocalBasemap && { opacity: 0.4 }]}
                  onPress={() => hasLocalBasemap && setLandImagery('street')}
                  disabled={!hasLocalBasemap}
                >
                  <Text style={styles.layerToggleText}>Street{!hasLocalBasemap ? ' ⬇' : ''}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, ecdisLand && styles.layerToggleRowActive]} onPress={() => setLandImagery('ecdis')}>
                  <Text style={styles.layerToggleText}>ECDIS</Text>
                </TouchableOpacity>

                {/* Marine Imagery */}
                <Text style={styles.layerSectionHeader}>Marine</Text>
                <TouchableOpacity style={[styles.layerToggleRow, marineImagery === 'chart' && styles.layerToggleRowActive]} onPress={() => setMarineImagery('chart')}>
                  <Text style={styles.layerToggleText}>Chart</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.layerToggleRow, marineImagery === 'ocean' && styles.layerToggleRowActive, !hasLocalOcean && { opacity: 0.4 }]}
                  onPress={() => hasLocalOcean && setMarineImagery('ocean')}
                  disabled={!hasLocalOcean}
                >
                  <Text style={styles.layerToggleText}>Ocean{!hasLocalOcean ? ' ⬇' : ''}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.layerToggleRow, ecdisMarine && styles.layerToggleRowActive]} onPress={() => setMarineImagery('ecdis')}>
                  <Text style={styles.layerToggleText}>ECDIS</Text>
                </TouchableOpacity>

                {/* Display Mode — Day/Dusk/Night */}
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
                  <Text style={styles.layerToggleText}>Wx Buoys</Text>
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
                <TouchableOpacity style={[styles.layerToggleRow, showTrafficRoutes && styles.layerToggleRowActive]} onPress={() => toggleLayer('trafficRoutes')}>
                  <Text style={styles.layerToggleText}>Traffic Routes</Text>
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
                      const updates: Record<string, number> = {};
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
                      const updates: Record<string, number> = {};
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
                      const updates: Record<string, number> = {};
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
                    style={[styles.segmentOption, displaySettings.dayNightMode === 'dusk' && styles.segmentOptionActive]}
                    onPress={async () => {
                      const newSettings = { ...displaySettings, dayNightMode: 'dusk' as const };
                      setDisplaySettings(newSettings);
                      await displaySettingsService.saveSettings(newSettings);
                    }}
                  >
                    <Text style={[styles.segmentOptionText, themedStyles.segmentOptionText, displaySettings.dayNightMode === 'dusk' && styles.segmentOptionTextActive, themedStyles.segmentOptionTextActive]}>Dusk</Text>
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
                <Text style={[styles.panelSectionTitle, themedStyles.panelSectionTitle]}>Tide Corrections</Text>
                <FFToggle
                  label="Tide-Corrected Soundings"
                  value={displaySettings.tideCorrectedSoundings}
                  onToggle={async (value) => {
                    const newSettings = { ...displaySettings, tideCorrectedSoundings: value };
                    setDisplaySettings(newSettings);
                    await displaySettingsService.saveSettings(newSettings);
                  }}
                />
                <Text style={[styles.settingNote, themedStyles.settingNote]}>
                  Adjust depth soundings for current tide height using nearest NOAA station. Corrected depths shown in neon green with black outline.
                  {tideCorrectionStation && displaySettings.tideCorrectedSoundings && (
                    <Text style={[styles.settingNote, themedStyles.settingNote]}>
                      {'\n'}Currently using: {tideCorrectionStation.name}
                      {'\n'}Tide correction: {currentTideCorrection >= 0 ? '+' : ''}{(currentTideCorrection * (displaySettings.depthUnits === 'feet' ? 3.28084 : displaySettings.depthUnits === 'fathoms' ? 0.546807 : 1)).toFixed(1)}{getDepthUnitSuffix(displaySettings.depthUnits)}
                    </Text>
                  )}
                </Text>
                
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
          currentLocation={gpsDataRef.current.latitude !== null && gpsDataRef.current.longitude !== null
            ? [gpsDataRef.current.longitude, gpsDataRef.current.latitude]
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
          currentLocation={gpsDataRef.current.latitude !== null && gpsDataRef.current.longitude !== null
            ? [gpsDataRef.current.longitude, gpsDataRef.current.latitude]
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

      {/* Navigation Data Displays — isolated component with own 1s timer.
          Only this subtree re-renders from GPS changes. */}
      {showNavData && (
        <NavDataOverlay
          gpsDataRef={gpsDataRef}
          centerCoordRef={centerCoordRef}
          followGPS={followGPS}
          currentZoom={currentZoom}
          showTideDetails={showTideDetails}
          showCurrentDetails={showCurrentDetails}
          topInset={insets.top}
        />
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

            {/* Land Imagery */}
            <Text style={debugStyles.sectionTitle}>LAND IMAGERY</Text>
            <View style={debugStyles.card}>
              <DebugToggle label="Satellite" value={landImagery === 'satellite'} onToggle={() => setLandImagery('satellite')} radio />
              <DebugToggle label="Terrain" value={landImagery === 'terrain'} onToggle={() => setLandImagery('terrain')} radio subtitle={hasLocalTerrain ? `${terrainTileSets.length} zoom sets` : 'Not downloaded'} />
              <DebugToggle label="Street" value={landImagery === 'street'} onToggle={() => setLandImagery('street')} radio subtitle={hasLocalBasemap ? 'Vector basemap' : 'No basemap tiles'} />
              <DebugToggle label="ECDIS" value={ecdisLand} onToggle={() => setLandImagery('ecdis')} radio />
            </View>

            {/* Marine Imagery */}
            <Text style={debugStyles.sectionTitle}>MARINE IMAGERY</Text>
            <View style={debugStyles.card}>
              <DebugToggle label="Chart" value={marineImagery === 'chart'} onToggle={() => setMarineImagery('chart')} radio />
              <DebugToggle label="Ocean" value={marineImagery === 'ocean'} onToggle={() => setMarineImagery('ocean')} radio subtitle={hasLocalOcean ? `${oceanTileSets.length} zoom sets` : 'Not downloaded'} />
              <DebugToggle label="ECDIS" value={ecdisMarine} onToggle={() => setMarineImagery('ecdis')} radio />
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
              <DebugToggle
                label="Scale Coverage Debug"
                value={showScaleDebug}
                onToggle={() => setShowScaleDebug(!showScaleDebug)}
                subtitle="Color-codes DEPARE by chart scale"
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
                  <Text style={diagStyles.label}>landImagery</Text>
                  <Text style={diagStyles.value}>{debugDiagnostics.landImagery}</Text>
                </View>
                <View style={diagStyles.row}>
                  <Text style={diagStyles.label}>marineImagery</Text>
                  <Text style={diagStyles.value}>{debugDiagnostics.marineImagery}</Text>
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
                  <Text style={diagStyles.label}>Rendering Mode</Text>
                  <Text style={diagStyles.value}>{chartScaleSources.length > 0 ? `Unified (${chartScaleSources[0].packId})` : 'No charts'}</Text>
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

      {/* Route Editor Panel */}
      {showRouteEditor && activeRoute && (
        <RouteEditor
          visible={showRouteEditor}
          onClose={() => setShowRouteEditor(false)}
        />
      )}

      {/* Active Navigation Overlay */}
      {navigation && navigation.isActive && (
        <ActiveNavigation
          visible={true}
          position="top"
        />
      )}

      {/* Routes Modal */}
      <RoutesModal
        visible={showRoutesModal}
        onClose={closeRoutesModal}
        onRouteLoad={(route) => {
          setShowRouteEditor(true);
        }}
      />

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

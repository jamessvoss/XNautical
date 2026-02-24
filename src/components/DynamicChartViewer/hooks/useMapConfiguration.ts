/**
 * Hook: Map configuration
 * S-52 display mode, theme, basemap palette, map style URLs,
 * themed UI styles, debug source toggles.
 */

import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import * as themeService from '../../../services/themeService';
import type { S52DisplayMode } from '../../../services/themeService';
import * as tileServer from '../../../services/tileServer';
import * as displaySettingsService from '../../../services/displaySettingsService';
import { logger, LogCategory } from '../../../services/loggingService';
import { performanceTracker, RuntimeMetric } from '../../../services/performanceTracker';
import type { LandImageryOption, MarineImageryOption } from '../types';

interface TileSet { id: string; minZoom: number; maxZoom: number; }

export function useMapConfiguration() {
  // S-52 Display Mode (Day/Dusk/Night)
  const [s52Mode, setS52ModeInternal] = useState<S52DisplayMode>('dusk');
  const [uiTheme, setUITheme] = useState(themeService.getUITheme('dusk'));

  // Land and Marine imagery (independent axes)
  const [landImagery, setLandImageryInternal] = useState<LandImageryOption>('satellite');
  const [marineImagery, setMarineImageryInternal] = useState<MarineImageryOption>('noaa-chart');

  // ECDIS derived from imagery choices (not standalone state)
  const ecdisLand = landImagery === 'ecdis';
  const ecdisMarine = marineImagery === 'ecdis';
  const ecdisColors = ecdisLand || ecdisMarine;

  // Derived booleans from the two imagery axes
  const hasLandRasterTiles = landImagery === 'satellite' || landImagery === 'terrain';
  const hasMarineRasterTiles = marineImagery === 'ocean';
  const showVectorBasemap = landImagery === 'street' || ecdisLand;

  // Local basemap availability
  const [hasLocalBasemap, setHasLocalBasemap] = useState(false);

  // Ocean and Terrain tile sets
  const [oceanTileSets, setOceanTileSets] = useState<TileSet[]>([]);
  const [terrainTileSets, setTerrainTileSets] = useState<TileSet[]>([]);
  const hasLocalOcean = oceanTileSets.length > 0;
  const hasLocalTerrain = terrainTileSets.length > 0;

  // Basemap and satellite tile sets
  const [basemapTileSets, setBasemapTileSets] = useState<TileSet[]>([]);
  const [satelliteTileSets, setSatelliteTileSets] = useState<TileSet[]>([]);

  // Debug map overrides
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

  // Debug state
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [showDebug, setShowDebug] = useState(false);
  const [debugDiagnostics, setDebugDiagnostics] = useState<{
    timestamp: string;
    landImagery: string;
    marineImagery: string;
    s52Mode: string;
    tileServerReady: boolean;
    hasLocalBasemap: boolean;
    hasLocalOcean: boolean;
    hasLocalTerrain: boolean;
    gnisAvailable: boolean;
    useMBTiles: boolean;
    tileServerUrl: string;
    styleJSON: string;
    gates: { label: string; expression: string; pass: boolean }[];
    mapLibreSources: { id: string; type: string; urls?: string[] }[];
    mapLibreLayers: { id: string; type: string; source?: string; sourceLayer?: string; visibility?: string }[];
    styleError?: string;
  } | null>(null);

  // Style switch performance tracking
  const styleSwitchStartRef = useRef<number>(0);
  const styleSwitchFromRef = useRef<string>('');
  const styleSwitchToRef = useRef<string>('');
  const styleSwitchRenderCountRef = useRef<number>(0);

  // Set S-52 display mode and update theme
  const setS52Mode = useCallback(async (mode: S52DisplayMode) => {
    await themeService.setDisplayMode(mode);
    setS52ModeInternal(mode);
    setUITheme(themeService.getUITheme(mode));
  }, []);

  // Wrapper for setLandImagery with timing logs + persistence
  const setLandImagery = useCallback((newLand: LandImageryOption) => {
    const now = Date.now();
    logger.info(LogCategory.UI, `Land imagery switch: "${landImagery}" → "${newLand}"`);
    performanceTracker.recordMetric(RuntimeMetric.STYLE_SWITCH);

    styleSwitchStartRef.current = now;
    styleSwitchFromRef.current = landImagery;
    styleSwitchToRef.current = newLand;
    styleSwitchRenderCountRef.current = 0;

    setLandImageryInternal(newLand);
    displaySettingsService.updateSetting('landImagery', newLand);
  }, [landImagery]);

  // Wrapper for setMarineImagery with persistence
  const setMarineImagery = useCallback((newMarine: MarineImageryOption) => {
    logger.info(LogCategory.UI, `Marine imagery switch: "${marineImagery}" → "${newMarine}"`);
    performanceTracker.recordMetric(RuntimeMetric.STYLE_SWITCH);

    setMarineImageryInternal(newMarine);
    displaySettingsService.updateSetting('marineImagery', newMarine);
  }, [marineImagery]);

  // Load saved S-52 theme mode and imagery settings on mount and subscribe to changes
  useEffect(() => {
    const loadThemeMode = async () => {
      const savedMode = await themeService.loadSavedMode();
      setS52ModeInternal(savedMode);
      setUITheme(themeService.getUITheme(savedMode));
      logger.debug(LogCategory.SETTINGS, `S-52 display mode loaded: ${savedMode}`);

      // Load persisted imagery settings
      const settings = await displaySettingsService.getSettings();
      if (settings.landImagery) {
        setLandImageryInternal(settings.landImagery as LandImageryOption);
        logger.debug(LogCategory.SETTINGS, `Land imagery loaded: ${settings.landImagery}`);
      }
      if (settings.marineImagery) {
        setMarineImageryInternal(settings.marineImagery as MarineImageryOption);
        logger.debug(LogCategory.SETTINGS, `Marine imagery loaded: ${settings.marineImagery}`);
      }
    };
    loadThemeMode();

    const unsubscribeTheme = themeService.subscribeToModeChanges((mode) => {
      setS52ModeInternal(mode);
      setUITheme(themeService.getUITheme(mode));
      logger.debug(LogCategory.SETTINGS, `S-52 display mode changed: ${mode}`);
    });

    return () => {
      unsubscribeTheme();
    };
  }, []);

  // Style switch tracking: React state update
  useEffect(() => {
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      logger.debug(LogCategory.UI, `Style switch: React state updated to land="${landImagery}" (${elapsed}ms)`);
    }
  }, [landImagery]);

  // Style switch tracking: render commit
  useLayoutEffect(() => {
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      logger.debug(LogCategory.UI, `Style switch: render committed (${elapsed}ms)`);
    }
  }, [landImagery]);

  // Glyphs URL for local font serving
  const glyphsUrl = 'http://127.0.0.1:8765/fonts/{fontstack}/{range}.pbf';

  // Get S-52 colors for current mode (ECDIS-aware, relief-aware)
  const s52Colors = useMemo(() => {
    if (ecdisColors) return themeService.getS52ColorTableWithECDIS(s52Mode);
    if (marineImagery === 'relief') {
      return themeService.getS52ColorTableWithMarineTheme(s52Mode, 'relief');
    }
    return themeService.getS52ColorTable(s52Mode);
  }, [s52Mode, ecdisColors, marineImagery]);

  // Build MapLibre expression for DEPARE fills
  // Relief: smooth interpolate gradient, all others: discrete step bands
  const depthFillExpression = useMemo(() => {
    const ramp = themeService.getDepthColorRamp(s52Mode, ecdisColors ? 'ecdis' : marineImagery);
    const input = ['to-number', ['coalesce', ['get', 'DRVAL1'], 0]];
    if (ramp.interpolate) {
      // Smooth gradient: ['interpolate', ['linear'], input, depth1, color1, ...]
      const expr: any[] = ['interpolate', ['linear'], input];
      for (const [depth, color] of ramp.stops) {
        expr.push(depth, color);
      }
      return expr;
    } else {
      // Discrete bands: ['step', input, defaultColor, depth1, color1, ...]
      const expr: any[] = ['step', input, ramp.defaultColor];
      for (const [depth, color] of ramp.stops) {
        expr.push(depth, color);
      }
      return expr;
    }
  }, [s52Mode, marineImagery, ecdisColors]);

  // Basemap color palettes — only relevant when landImagery === 'street'
  // ECDIS mode forces light palette (dark text on white background)
  const basemapPalette = useMemo(() => {
    const palettes = {
      light: {
        bg: '#f5f5f5', water: '#aadaff', waterway: '#aadaff', ice: '#ffffff',
        grass: '#d8e8c8', wood: '#c5ddb0', wetland: '#d0e8d8',
        residential: '#eee8e0', industrial: '#e8e0d8', park: '#c8e6c9',
        building: '#e0d8d0', road: '#ffffff', roadCasing: '#cccccc',
        text: '#333333', textHalo: '#ffffff', grid: '#c8c8c8',
        waterText: '#5d8cae', landcoverOpacity: 0.6, buildingOpacity: 0.8,
        parkOpacity: 0.4, roadNightDim: 1,
      },
      dark: {
        bg: '#1a1a2e', water: '#1a3a5c', waterway: '#1a3a5c', ice: '#303040',
        grass: '#1a2818', wood: '#142014', wetland: '#152818',
        residential: '#252028', industrial: '#201c24', park: '#152018',
        building: '#302830', road: '#444444', roadCasing: '#222222',
        text: '#cccccc', textHalo: '#1a1a2e', grid: '#404050',
        waterText: '#4a6a8a', landcoverOpacity: 0.4, buildingOpacity: 0.5,
        parkOpacity: 0.3, roadNightDim: 0.6,
      },
    };
    // ECDIS land forces light palette for correct contrast on white background
    if (ecdisLand) return palettes.light;
    if (landImagery === 'street') {
      return s52Mode === 'day' ? palettes.light : palettes.dark;
    }
    return palettes.light; // fallback for satellite, terrain
  }, [landImagery, ecdisLand, s52Mode]);

  // MapLibre style object — just glyphs + empty background
  // Actual background color is handled by mapBackgroundColor in the main component
  const mapStyleUrl = useMemo(() => ({
    version: 8, glyphs: glyphsUrl, sources: {}, layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#000000' } },
    ],
  }), [glyphsUrl]);

  // Dynamic themed styles
  const themedStyles = useMemo(() => ({
    controlPanel: { backgroundColor: uiTheme.panelBackgroundSolid, borderColor: uiTheme.border },
    tabBar: { backgroundColor: uiTheme.cardBackground, borderBottomColor: uiTheme.divider },
    tabButton: { backgroundColor: uiTheme.tabBackground },
    tabButtonActive: { backgroundColor: uiTheme.tabBackgroundActive },
    tabButtonText: { color: uiTheme.tabText },
    tabButtonTextActive: { color: uiTheme.tabTextActive },
    panelSectionTitle: { color: uiTheme.textPrimary },
    basemapOption: { backgroundColor: uiTheme.buttonBackground, borderColor: uiTheme.border },
    basemapOptionActive: { backgroundColor: uiTheme.buttonBackgroundActive, borderColor: uiTheme.accentPrimary },
    basemapOptionText: { color: uiTheme.buttonText },
    basemapOptionTextActive: { color: uiTheme.buttonTextActive },
    panelDivider: { backgroundColor: uiTheme.divider },
    toggleLabel: { color: uiTheme.textPrimary },
    sliderTrack: { color: uiTheme.sliderTrack },
    sliderTrackActive: { color: uiTheme.sliderTrackActive },
    sliderThumb: { color: uiTheme.sliderThumb },
    subTabBar: { backgroundColor: uiTheme.cardBackground, borderBottomColor: uiTheme.divider },
    subTabButtonText: { color: uiTheme.tabText },
    subTabButtonTextActive: { color: uiTheme.tabTextActive },
    activeChartText: { color: uiTheme.textPrimary },
    activeChartSubtext: { color: uiTheme.textSecondary },
    chartScaleLabel: { color: uiTheme.accentPrimary },
    chartScaleCount: { color: uiTheme.textSecondary },
    tabScrollContent: { flex: 1, backgroundColor: uiTheme.panelBackgroundSolid },
    layerRow: { borderBottomColor: uiTheme.divider },
    layerName: { color: uiTheme.textPrimary },
    symbolItem: { borderBottomColor: uiTheme.divider },
    symbolName: { color: uiTheme.textPrimary },
    symbolRow: { borderBottomColor: uiTheme.divider },
    centerButton: { backgroundColor: uiTheme.panelBackground, borderColor: uiTheme.border },
    centerButtonActive: { backgroundColor: uiTheme.accentPrimary },
    chartLoadingContainer: { backgroundColor: uiTheme.overlayBackground },
    chartLoadingText: { color: uiTheme.textPrimary },
    chartLoadingProgress: { color: uiTheme.textSecondary },
    featurePopup: { backgroundColor: uiTheme.panelBackground, borderColor: uiTheme.border },
    featurePopupTitle: { color: uiTheme.textPrimary },
    featurePopupText: { color: uiTheme.textSecondary },
    layersColumnTitle: { color: uiTheme.textPrimary },
    dataInfoLabel: { color: uiTheme.textMuted },
    dataInfoValue: { color: uiTheme.textPrimary },
    displayFeatureName: { color: uiTheme.textPrimary },
    sliderLabel: { color: uiTheme.textSecondary },
    sliderValueText: { color: uiTheme.textPrimary },
    featureItem: { borderBottomColor: uiTheme.divider },
    featureItemSelected: { backgroundColor: uiTheme.tabBackgroundActive },
    featureItemText: { color: uiTheme.textPrimary },
    featureItemTextSelected: { color: uiTheme.tabTextActive },
    ffToggleLabel: { color: uiTheme.textPrimary },
    controlRowLabel: { color: uiTheme.textSecondary },
    sliderMinMaxLabel: { color: uiTheme.textMuted },
    sliderValueCompact: { color: uiTheme.textPrimary },
    legendText: { color: uiTheme.textSecondary },
    featureSelectorChipText: { color: uiTheme.textSecondary },
    featureSelectorChipTextActive: { color: uiTheme.textPrimary },
    segmentOption: { borderColor: uiTheme.border },
    segmentOptionActive: { backgroundColor: uiTheme.accentPrimary },
    segmentOptionText: { color: uiTheme.textSecondary },
    segmentOptionTextActive: { color: uiTheme.textOnAccent },
    settingNote: { color: uiTheme.textMuted },
  }), [uiTheme]);

  // Diagnostics runner — needs external state, so return a factory
  const createRunDiagnostics = useCallback((params: {
    tileServerReady: boolean;
    gnisAvailable: boolean;
    useMBTiles: boolean;
    showGNISNames: boolean;
    showPlaceNames: boolean;
    mapRef: React.RefObject<any>;
  }) => {
    return async () => {
      const serverUrl = tileServer.getTileServerUrl();
      const currentStyleJSON = JSON.stringify(mapStyleUrl);

      const gates = [
        { label: 'Vector basemap renders', expression: `tileServerReady(${params.tileServerReady}) && hasLocalBasemap(${hasLocalBasemap}) && showVectorBasemap(${showVectorBasemap})`, pass: params.tileServerReady && hasLocalBasemap && showVectorBasemap },
        { label: 'Ocean source renders', expression: `tileServerReady(${params.tileServerReady}) && oceanTileSets.length(${oceanTileSets.length}) > 0 && hasMarineRasterTiles(${hasMarineRasterTiles})`, pass: params.tileServerReady && oceanTileSets.length > 0 && hasMarineRasterTiles },
        { label: 'Terrain source renders', expression: `tileServerReady(${params.tileServerReady}) && terrainTileSets.length(${terrainTileSets.length}) > 0 && landImagery === 'terrain'`, pass: params.tileServerReady && terrainTileSets.length > 0 && landImagery === 'terrain' },
        { label: 'Charts source renders', expression: `useMBTiles(${params.useMBTiles}) && tileServerReady(${params.tileServerReady})`, pass: params.useMBTiles && params.tileServerReady },
        { label: 'Satellite source renders', expression: `tileServerReady(${params.tileServerReady}) && satelliteTileSets.length(${satelliteTileSets.length}) > 0 && landImagery === 'satellite'`, pass: params.tileServerReady && satelliteTileSets.length > 0 && landImagery === 'satellite' },
        { label: 'GNIS source renders', expression: `tileServerReady(${params.tileServerReady}) && gnisAvailable(${params.gnisAvailable}) && showGNISNames(${params.showGNISNames}) && showPlaceNames(${params.showPlaceNames})`, pass: params.tileServerReady && params.gnisAvailable && params.showGNISNames && params.showPlaceNames },
      ];

      let mapLibreSources: { id: string; type: string; urls?: string[] }[] = [];
      let mapLibreLayers: { id: string; type: string; source?: string; sourceLayer?: string; visibility?: string }[] = [];
      let styleError: string | undefined;

      try {
        if (params.mapRef.current) {
          const style = await params.mapRef.current.getStyle();
          if (style) {
            if (style.sources) {
              mapLibreSources = Object.entries(style.sources).map(([id, src]: [string, any]) => ({
                id, type: src.type || 'unknown',
                urls: src.tiles || src.url ? [...(src.tiles || []), ...(src.url ? [src.url] : [])] : undefined,
              }));
            }
            if (style.layers && Array.isArray(style.layers)) {
              mapLibreLayers = style.layers.map((layer: any) => ({
                id: layer.id || '?', type: layer.type || '?',
                source: layer.source, sourceLayer: layer['source-layer'],
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
        landImagery, marineImagery, s52Mode,
        tileServerReady: params.tileServerReady,
        hasLocalBasemap, hasLocalOcean, hasLocalTerrain,
        gnisAvailable: params.gnisAvailable,
        useMBTiles: params.useMBTiles,
        tileServerUrl: serverUrl,
        styleJSON: currentStyleJSON.length > 300 ? currentStyleJSON.substring(0, 300) + '...' : currentStyleJSON,
        gates, mapLibreSources, mapLibreLayers, styleError,
      });
    };
  }, [landImagery, marineImagery, s52Mode, hasLocalBasemap, hasLocalOcean, hasLocalTerrain, showVectorBasemap, hasMarineRasterTiles, satelliteTileSets, oceanTileSets, terrainTileSets, mapStyleUrl]);

  return {
    // S-52 mode
    s52Mode,
    setS52Mode,
    uiTheme,
    s52Colors,
    depthFillExpression,
    // Imagery axes
    landImagery,
    setLandImagery,
    marineImagery,
    setMarineImagery,
    // Derived booleans
    showVectorBasemap,
    hasLandRasterTiles,
    hasMarineRasterTiles,
    // ECDIS (derived from imagery choices)
    ecdisLand,
    ecdisMarine,
    ecdisColors,
    glyphsUrl,
    basemapPalette,
    mapStyleUrl,
    themedStyles,
    // Tile sets
    hasLocalBasemap,
    setHasLocalBasemap,
    satelliteTileSets,
    setSatelliteTileSets,
    basemapTileSets,
    setBasemapTileSets,
    oceanTileSets,
    setOceanTileSets,
    terrainTileSets,
    setTerrainTileSets,
    hasLocalOcean,
    hasLocalTerrain,
    // Debug
    debugInfo,
    setDebugInfo,
    showDebug,
    setShowDebug,
    debugDiagnostics,
    debugHiddenSources,
    setDebugHiddenSources,
    debugIsSourceVisible,
    debugToggleSource,
    createRunDiagnostics,
    // Style switch refs (exposed for map event handlers)
    styleSwitchStartRef,
    styleSwitchRenderCountRef,
  };
}

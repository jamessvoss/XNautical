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
import type { MapStyleOption } from '../types';

interface TileSet { id: string; minZoom: number; maxZoom: number; }

export function useMapConfiguration() {
  // S-52 Display Mode (Day/Dusk/Night)
  const [s52Mode, setS52ModeInternal] = useState<S52DisplayMode>('dusk');
  const [uiTheme, setUITheme] = useState(themeService.getUITheme('dusk'));

  // Map style options
  const [mapStyle, setMapStyleInternal] = useState<MapStyleOption>('dark');

  // ECDIS chart color mode (independent of base map style)
  const [ecdisColors, setEcdisColors] = useState(false);

  // Which styles use the vector basemap tiles
  const VECTOR_BASEMAP_STYLES: MapStyleOption[] = ['light', 'dark', 'street'];
  const isVectorStyle = VECTOR_BASEMAP_STYLES.includes(mapStyle);

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
    mapStyle: string;
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

  // Wrapper for setMapStyle with timing logs + persistence
  const setMapStyle = useCallback((newStyle: MapStyleOption) => {
    if (newStyle === 'satellite') {
      logger.debug(LogCategory.UI, `Satellite map style disabled, ignoring`);
      return;
    }
    const now = Date.now();
    logger.info(LogCategory.UI, `Style switch: "${mapStyle}" → "${newStyle}"`);
    performanceTracker.recordMetric(RuntimeMetric.STYLE_SWITCH);

    styleSwitchStartRef.current = now;
    styleSwitchFromRef.current = mapStyle;
    styleSwitchToRef.current = newStyle;
    styleSwitchRenderCountRef.current = 0;

    setMapStyleInternal(newStyle);
    displaySettingsService.updateSetting('mapStyle', newStyle);
  }, [mapStyle]);

  // Wrapper for setEcdisColors with persistence
  const setEcdisColorsWithPersist = useCallback((value: boolean) => {
    setEcdisColors(value);
    displaySettingsService.updateSetting('ecdisColors', value);
  }, []);

  // Load saved S-52 theme mode, mapStyle, ecdisColors on mount and subscribe to changes
  useEffect(() => {
    const loadThemeMode = async () => {
      const savedMode = await themeService.loadSavedMode();
      setS52ModeInternal(savedMode);
      setUITheme(themeService.getUITheme(savedMode));
      logger.debug(LogCategory.SETTINGS, `S-52 display mode loaded: ${savedMode}`);

      // Load persisted mapStyle and ecdisColors
      const settings = await displaySettingsService.getSettings();
      if (settings.mapStyle && settings.mapStyle !== 'satellite') {
        setMapStyleInternal(settings.mapStyle as MapStyleOption);
        logger.debug(LogCategory.SETTINGS, `Map style loaded: ${settings.mapStyle}`);
      } else if (settings.mapStyle === 'satellite') {
        logger.debug(LogCategory.SETTINGS, `Satellite map style disabled, using default 'dark'`);
      }
      if (settings.ecdisColors !== undefined) {
        setEcdisColors(settings.ecdisColors);
        logger.debug(LogCategory.SETTINGS, `ECDIS colors loaded: ${settings.ecdisColors}`);
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
      logger.debug(LogCategory.UI, `Style switch: React state updated to "${mapStyle}" (${elapsed}ms)`);
    }
  }, [mapStyle]);

  // Style switch tracking: render commit
  useLayoutEffect(() => {
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      logger.debug(LogCategory.UI, `Style switch: render committed (${elapsed}ms)`);
    }
  }, [mapStyle]);

  // Glyphs URL for local font serving
  const glyphsUrl = 'http://127.0.0.1:8765/fonts/{fontstack}/{range}.pbf';

  // Get S-52 colors for current mode (ECDIS-aware when toggle is on)
  const s52Colors = useMemo(
    () => ecdisColors
      ? themeService.getS52ColorTableWithECDIS(s52Mode)
      : themeService.getS52ColorTable(s52Mode),
    [s52Mode, ecdisColors]
  );

  // Basemap color palettes per vector style
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
      street: {
        bg: '#f5f5f0', water: '#aadaff', waterway: '#aadaff', ice: '#f0f0f0',
        grass: '#f5f5f0',         // Almost white - matches background
        wood: '#f5f5f0',          // Almost white - matches background
        wetland: '#f5f5f0',       // Almost white - matches background
        residential: '#f5f5f0', industrial: '#f0f0ec',
        park: '#e8f5e8',          // Extremely subtle hint of green - like Google Maps
        building: '#e8e8e8', road: '#ffffff', roadCasing: '#d0d0d0',
        text: '#333333', textHalo: '#ffffff', grid: '#d8d8d8',
        waterText: '#5d8cae',
        landcoverOpacity: 0.15,   // Extremely low - almost invisible
        buildingOpacity: 0.9,     // Buildings more visible
        parkOpacity: 0.1,         // Barely there - like Google Maps
        roadNightDim: 1,
      },
    };
    // ECDIS forces light palette for correct contrast on white background
    if (ecdisColors) return palettes.light;
    if (mapStyle === 'light' || mapStyle === 'dark' || mapStyle === 'street') {
      return palettes[mapStyle];
    }
    return palettes.light; // fallback for satellite, ocean, terrain, etc.
  }, [mapStyle, ecdisColors]);

  // MapLibre background styles per mode — fixed per imagery, not display mode
  const mapStyleUrls = useMemo<Record<MapStyleOption, object>>(() => ({
    satellite: { version: 8, glyphs: glyphsUrl, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#0A0A10' } }] },
    light: { version: 8, glyphs: glyphsUrl, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f5f5f5' } }] },
    dark: { version: 8, glyphs: glyphsUrl, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#1a1a2e' } }] },
    street: { version: 8, glyphs: glyphsUrl, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f0ede8' } }] },
    ocean: { version: 8, glyphs: glyphsUrl, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#1a3a5c' } }] },
    terrain: { version: 8, glyphs: glyphsUrl, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dfe6e9' } }] },
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
      const currentStyleJSON = JSON.stringify(mapStyleUrls[mapStyle]);

      const gates = [
        { label: 'Vector basemap renders', expression: `tileServerReady(${params.tileServerReady}) && hasLocalBasemap(${hasLocalBasemap}) && isVectorStyle(${isVectorStyle})`, pass: params.tileServerReady && hasLocalBasemap && isVectorStyle },
        { label: 'Ocean source renders', expression: `tileServerReady(${params.tileServerReady}) && oceanTileSets.length(${oceanTileSets.length}) > 0 && mapStyle === 'ocean'`, pass: params.tileServerReady && oceanTileSets.length > 0 && mapStyle === 'ocean' },
        { label: 'Terrain source renders', expression: `tileServerReady(${params.tileServerReady}) && terrainTileSets.length(${terrainTileSets.length}) > 0 && mapStyle === 'terrain'`, pass: params.tileServerReady && terrainTileSets.length > 0 && mapStyle === 'terrain' },
        { label: 'Charts source renders', expression: `useMBTiles(${params.useMBTiles}) && tileServerReady(${params.tileServerReady})`, pass: params.useMBTiles && params.tileServerReady },
        { label: 'Satellite source renders', expression: `tileServerReady(${params.tileServerReady}) && satelliteTileSets.length(${satelliteTileSets.length}) > 0`, pass: params.tileServerReady && satelliteTileSets.length > 0 },
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
        mapStyle, s52Mode,
        tileServerReady: params.tileServerReady,
        hasLocalBasemap, hasLocalOcean, hasLocalTerrain,
        gnisAvailable: params.gnisAvailable,
        useMBTiles: params.useMBTiles,
        tileServerUrl: serverUrl,
        styleJSON: currentStyleJSON.length > 300 ? currentStyleJSON.substring(0, 300) + '...' : currentStyleJSON,
        gates, mapLibreSources, mapLibreLayers, styleError,
      });
    };
  }, [mapStyle, s52Mode, hasLocalBasemap, hasLocalOcean, hasLocalTerrain, isVectorStyle, satelliteTileSets, oceanTileSets, terrainTileSets, mapStyleUrls]);

  return {
    // S-52 mode
    s52Mode,
    setS52Mode,
    uiTheme,
    s52Colors,
    // Map style
    mapStyle,
    setMapStyle,
    isVectorStyle,
    ecdisColors,
    setEcdisColors: setEcdisColorsWithPersist,
    glyphsUrl,
    basemapPalette,
    mapStyleUrls,
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

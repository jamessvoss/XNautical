/**
 * Hook: Chart loading and tile server management
 * Scans mbtiles directory, starts tile server, manages progressive loading,
 * detects new downloads on focus, manages chart render list.
 */

import { useState, useEffect, useCallback, useMemo, useRef, startTransition } from 'react';
import { Alert, InteractionManager } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as chartCacheService from '../../../services/chartCacheService';
import * as chartPackService from '../../../services/chartPackService';
import * as tileServer from '../../../services/tileServer';
import { logger, LogCategory } from '../../../services/loggingService';
import { performanceTracker, StartupPhase } from '../../../services/performanceTracker';
import { migrateLegacyPredictionDatabases } from '../../../services/stationService';
import type { LoadedChartData, LoadedMBTilesChart, LoadedRasterChart } from '../types';

interface TileSet { id: string; minZoom: number; maxZoom: number; }

/** Setters for tile-set state that lives in useMapConfiguration. */
export interface ChartLoadingExternalSetters {
  setGnisAvailable: (v: boolean) => void;
  setSatelliteTileSets: (v: TileSet[]) => void;
  setBasemapTileSets: (v: TileSet[]) => void;
  setOceanTileSets: (v: TileSet[]) => void;
  setTerrainTileSets: (v: TileSet[]) => void;
  setHasLocalBasemap: (v: boolean) => void;
  setDebugInfo: (v: string) => void;
}

/** Current values from useMapConfiguration needed by the focus effect. */
export interface ChartLoadingExternalState {
  satelliteTileSets: TileSet[];
  basemapTileSets: TileSet[];
  oceanTileSets: TileSet[];
  terrainTileSets: TileSet[];
  hasLocalBasemap: boolean;
  gnisAvailable: boolean;
}

export function useChartLoading(
  externalSetters: ChartLoadingExternalSetters,
  externalState: ChartLoadingExternalState,
  reloadStations: () => Promise<void>,
) {
  // Core chart state
  const [loading, setLoading] = useState(true);
  const [charts, setCharts] = useState<LoadedChartData[]>([]);
  const [mbtilesCharts, setMbtilesCharts] = useState<LoadedMBTilesChart[]>([]);
  const [chartsToRender, setChartsToRender] = useState<string[]>([]);
  const [loadingPhase, setLoadingPhase] = useState<'us1' | 'tier1' | 'complete'>('us1');
  const [chartLoadingProgress, setChartLoadingProgress] = useState<{ current: number; total: number; phase: string } | null>(null);
  const [rasterCharts, setRasterCharts] = useState<LoadedRasterChart[]>([]);
  const [tileServerReady, setTileServerReady] = useState(false);
  const [storageUsed, setStorageUsed] = useState<{ total: number; vector: number; raster: number }>({ total: 0, vector: 0, raster: 0 });

  // Data source toggles
  const [useMBTiles] = useState(true);
  const useCompositeTiles = true;

  // GNIS state (owned here since it's discovered during scanning)
  const [gnisAvailable, setGnisAvailableLocal] = useState(false);

  // Chart center derived from manifest bounds
  const [chartCenter, setChartCenter] = useState<[number, number] | null>(null);

  // Cache buster
  const [cacheBuster, setCacheBuster] = useState(0);

  // Zoom limiting
  const [limitZoomToCharts] = useState(true);

  // Refs
  const lastManifestTimeRef = useRef<number>(0);
  const lastStationsTimeRef = useRef<number>(0);
  const progressiveLoadingRef = useRef<boolean>(false);

  // Composite tile URL
  const compositeTileUrl = useMemo(() => {
    return `${tileServer.getTileServerUrl()}/tiles/{z}/{x}/{y}.pbf`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileServerReady]);

  // Chart max zoom helper
  const getChartMaxZoom = useCallback((chartId: string): number => {
    const match = chartId.match(/^US(\d)/);
    if (!match) return 15;
    const scaleNum = parseInt(match[1], 10);
    switch (scaleNum) {
      case 1: return 8;
      case 2: return 10;
      case 3: return 13;
      case 4: return 15;
      case 5: return 15;
      default: return 15;
    }
  }, []);

  const maxAvailableZoom = useMemo(() => {
    if (mbtilesCharts.length === 0) return 15;
    return mbtilesCharts.reduce((max, chart) => {
      return Math.max(max, getChartMaxZoom(chart.chartId));
    }, 0);
  }, [mbtilesCharts, getChartMaxZoom]);

  const effectiveMaxZoom = limitZoomToCharts ? maxAvailableZoom : 15;

  // Check if chart is visible at zoom
  const isChartVisibleAtZoom = useCallback((chartId: string, zoom: number): boolean => {
    const match = chartId.match(/US(\d)/);
    if (!match) return true;
    const scale = parseInt(match[1], 10);
    // Matches tile server getScaleForZoom():
    // US1: z0-4, US2: z5-7, US3: z8-11, US4: z12+, US5/US6: z14+
    switch (scale) {
      case 1: return zoom <= 6;
      case 2: return zoom >= 3 && zoom <= 10;
      case 3: return zoom >= 6 && zoom <= 14;
      case 4: return zoom >= 10;
      case 5: return zoom >= 13;
      default: return zoom >= 15;
    }
  }, []);

  // All charts to render (deduplicated)
  const allChartsToRender = useMemo(() => {
    return [...new Set(chartsToRender)];
  }, [chartsToRender]);

  // Sync gnisAvailable to external state
  const setGnisAvailable = useCallback((v: boolean) => {
    setGnisAvailableLocal(v);
    externalSetters.setGnisAvailable(v);
  }, [externalSetters]);

  // ─── loadCharts ───────────────────────────────────────────────────────
  const loadCharts = async () => {
    performanceTracker.beginStartup();
    logger.setStartupParam('storagePath', 'file:///storage/emulated/0/Android/data/com.xnautical.app/files/mbtiles');

    try {
      setLoading(true);

      // One-time migration for legacy prediction database filenames
      try {
        await migrateLegacyPredictionDatabases();
      } catch (migrationError) {
        console.warn('[MAP] Legacy prediction migration failed (non-critical):', migrationError);
      }

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const FileSystem = require('expo-file-system/legacy');

      // === PHASE 1: mbtiles directory ===
      performanceTracker.startPhase(StartupPhase.DIRECTORY_SETUP);
      const mbtilesDir = `${FileSystem.documentDirectory}mbtiles`;
      let mbtilesDirectoryReady = false;

      try {
        const dirInfo = await FileSystem.getInfoAsync(mbtilesDir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(mbtilesDir, { intermediates: true });
          logger.debug(LogCategory.STARTUP, 'Created mbtiles directory');
        }
        mbtilesDirectoryReady = true;
      } catch (e) {
        logger.warn(LogCategory.STARTUP, 'Could not create mbtiles directory', { error: e });
      }
      performanceTracker.endPhase(StartupPhase.DIRECTORY_SETUP, { path: mbtilesDir, ready: mbtilesDirectoryReady });

      // === PHASE 2: Load manifest.json ===
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

          // Derive initial center from the first pack's bounds
          const firstBounds = (manifest?.packs || []).find(p => p.bounds)?.bounds;
          if (firstBounds) {
            const centerLng = (firstBounds.west + firstBounds.east) / 2;
            const centerLat = (firstBounds.south + firstBounds.north) / 2;
            setChartCenter([centerLng, centerLat]);
            logger.debug(LogCategory.CHARTS, `Chart center from manifest: [${centerLng.toFixed(2)}, ${centerLat.toFixed(2)}]`);
          }
        } else {
          logger.info(LogCategory.CHARTS, 'No manifest.json found - will scan directory');
          logger.setStartupParam('manifestLoaded', false);
        }
      } catch (e) {
        logger.warn(LogCategory.CHARTS, 'Error loading manifest.json', { error: e });
      }
      performanceTracker.endPhase(StartupPhase.MANIFEST_LOAD, { packsCount: chartPacks.length });

      // === PHASE 3: Check for special files ===
      performanceTracker.startPhase(StartupPhase.SPECIAL_FILES);
      const gnisInfo = await FileSystem.getInfoAsync(`${mbtilesDir}/gnis_names.mbtiles`);
      const gnisFound = gnisInfo.exists;
      setGnisAvailable(gnisFound);

      const scanTileSets = (filesInDir: string[], tileType: string): TileSet[] => {
        const sets: TileSet[] = [];
        // Match zoom-suffixed files: e.g., d07_ocean_z0-5.mbtiles
        const zoomPattern = new RegExp(`(?:^|_)${tileType}_z(\\d+)(?:-(\\d+))?\\.mbtiles$`);
        // Match single files without zoom suffix: e.g., d07_ocean.mbtiles
        const singlePattern = new RegExp(`(?:^|_)${tileType}\\.mbtiles$`);
        for (const filename of filesInDir) {
          const zoomMatch = filename.match(zoomPattern);
          if (zoomMatch) {
            const minZoom = parseInt(zoomMatch[1], 10);
            const maxZoom = zoomMatch[2] ? parseInt(zoomMatch[2], 10) : minZoom;
            sets.push({ id: filename.replace('.mbtiles', ''), minZoom, maxZoom });
          } else if (filename.match(singlePattern)) {
            // Single file without zoom suffix — covers all zoom levels
            sets.push({ id: filename.replace('.mbtiles', ''), minZoom: 0, maxZoom: 15 });
          }
        }
        return sets.sort((a, b) => a.minZoom - b.minZoom);
      };

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

        if (foundBasemapSets.length === 0) {
          basemapFound = filesInDir.some((f: string) => f.startsWith('basemap') && f.endsWith('.mbtiles'));
        } else {
          basemapFound = true;
        }
      } catch (e) {
        logger.warn(LogCategory.STARTUP, 'Error scanning for tile files', { error: e });
      }

      externalSetters.setSatelliteTileSets(foundSatelliteSets);
      externalSetters.setBasemapTileSets(foundBasemapSets);
      externalSetters.setOceanTileSets(foundOceanSets);
      externalSetters.setTerrainTileSets(foundTerrainSets);
      externalSetters.setHasLocalBasemap(basemapFound);

      logger.setStartupParam('specialFiles', {
        gnis: gnisFound, satellite: foundSatelliteSets.length,
        basemap: foundBasemapSets.length, ocean: foundOceanSets.length,
        terrain: foundTerrainSets.length,
      });
      performanceTracker.endPhase(StartupPhase.SPECIAL_FILES, {
        gnis: gnisFound, satelliteCount: foundSatelliteSets.length,
        basemapCount: foundBasemapSets.length, oceanCount: foundOceanSets.length,
        terrainCount: foundTerrainSets.length,
      });

      // === PHASE 4: Build chart list ===
      performanceTracker.startPhase(StartupPhase.CHART_DISCOVERY);
      const loadedMbtiles: LoadedMBTilesChart[] = [];
      const loadedRasters: LoadedRasterChart[] = [];

      if (manifest && chartPacks.length > 0) {
        logger.info(LogCategory.CHARTS, `Using manifest.json with ${chartPacks.length} chart packs`);
        for (const pack of manifest.packs || []) {
          const packPath = `${mbtilesDir}/${pack.id}.mbtiles`;
          const packInfo = await FileSystem.getInfoAsync(packPath);
          if (packInfo.exists) {
            loadedMbtiles.push({ chartId: pack.id, path: packPath });
          } else {
            logger.debug(LogCategory.CHARTS, `Skipping ${pack.id} - file not found`);
          }
        }

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
        if (mbtilesDirectoryReady) {
          logger.info(LogCategory.CHARTS, 'Scanning directory for mbtiles files...');
          let hasChartPacks = false;
          try {
            const filesInDir = await FileSystem.readDirectoryAsync(mbtilesDir);
            for (const filename of filesInDir) {
              if (filename.endsWith('.mbtiles') && !filename.startsWith('._')) {
                const chartId = filename.replace('.mbtiles', '');
                const path = `${mbtilesDir}/${filename}`;

                if (chartId.startsWith('gnis_names_') || chartId.startsWith('basemap_') || chartId.startsWith('satellite_')) {
                  continue;
                }

                if (chartId.startsWith('BATHY_')) {
                  loadedRasters.push({ chartId, path });
                } else {
                  loadedMbtiles.push({ chartId, path });
                  if (chartId.match(/^[a-z]+_US\d/)) {
                    hasChartPacks = true;
                  }
                }
              }
            }

            if (hasChartPacks) {
              logger.info(LogCategory.CHARTS, 'Found chart packs without manifest - generating manifest.json');
              await chartPackService.generateManifest();
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
            logger.warn(LogCategory.CHARTS, 'Directory scan failed', { error: (e as Error).message });
          }
        } else {
          logger.info(LogCategory.CHARTS, 'Directory not ready - skipping scan');
        }
        logger.perf(LogCategory.CHARTS, `Directory scan complete`, { charts: loadedMbtiles.length });
      }

      performanceTracker.endPhase(StartupPhase.CHART_DISCOVERY, {
        mode: manifest ? 'manifest' : 'scan',
        chartsFound: loadedMbtiles.length,
        rastersFound: loadedRasters.length
      });

      // Log chart inventory
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
      const allChartIds = loadedMbtiles.map(m => m.chartId);
      setChartsToRender(allChartIds);
      setLoadingPhase('complete');
      logger.info(LogCategory.CHARTS, `Rendering ${allChartIds.length} charts`);

      logger.setStartupParam('chartsLoaded', loadedMbtiles.length);
      logger.setStartupParam('chartTypes', { mbtiles: loadedMbtiles.length, raster: loadedRasters.length });
      setRasterCharts(loadedRasters);

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

            // Diagnostics
            try {
              const healthResp = await fetch(`${serverUrl}/health`);
              console.log(`[TILE-DIAG] Health check: ${healthResp.status}`);
              const tileJsonResp = await fetch(`${serverUrl}/tiles.json`);
              const tileJson = await tileJsonResp.json();
              console.log(`[TILE-DIAG] TileJSON: minzoom=${tileJson.minzoom}, maxzoom=${tileJson.maxzoom}, bounds=${JSON.stringify(tileJson.bounds)}`);
              // Test tile from center of actual chart bounds
              if (tileJson.bounds && tileJson.bounds.length === 4) {
                const [bW, bS, bE, bN] = tileJson.bounds;
                const cLng = (bW + bE) / 2;
                const cLat = (bS + bN) / 2;
                const tZ = 5;
                const n = Math.pow(2, tZ);
                const tX = Math.floor((cLng + 180) / 360 * n);
                const latRad = cLat * Math.PI / 180;
                const tY = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
                const tileResp = await fetch(`${serverUrl}/tiles/${tZ}/${tX}/${tY}.pbf`);
                console.log(`[TILE-DIAG] Tile ${tZ}/${tX}/${tY}: status=${tileResp.status}, size=${tileResp.headers.get('content-length') || 'unknown'}`);
              }
            } catch (diagErr) {
              console.error(`[TILE-DIAG] Connectivity test FAILED:`, diagErr);
            }

            externalSetters.setDebugInfo(`Server: ${serverUrl}\nCharts: ${loadedMbtiles.length} charts\nDir: ${mbtilesDir}`);
          } else {
            logger.warn(LogCategory.TILES, 'Failed to start tile server');
            logger.setStartupParam('tileServerStatus', 'failed');
            externalSetters.setDebugInfo(`Failed to start tile server\nDir: ${mbtilesDir}`);
          }
        } catch (e) {
          logger.error(LogCategory.TILES, 'Tile server error', e as Error);
          logger.setStartupParam('tileServerStatus', 'error');
          externalSetters.setDebugInfo(`Tile server error: ${e}`);
        }
      } else {
        externalSetters.setDebugInfo(`No MBTiles files found.\n\nPut .mbtiles files in:\n${mbtilesDir}\n\nOr download via Charts screen.`);
      }

      // === PHASE 6: Load legacy GeoJSON ===
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
      performanceTracker.endPhase(StartupPhase.GEOJSON_LOAD, { charts: loadedCharts.length });
      setCharts(loadedCharts);

      // Final summary
      performanceTracker.completeStartup();
      logger.info(LogCategory.STARTUP, `Tile mode: COMPOSITE (server-side quilting, ~20 layers)`);
    } catch (error) {
      logger.error(LogCategory.STARTUP, 'STARTUP ERROR', error as Error);
      Alert.alert('Error', 'Failed to load cached charts');
    } finally {
      setLoading(false);
    }
  };

  // Load on mount
  useEffect(() => {
    loadCharts();
    return () => {
      tileServer.stopTileServer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check for data changes on focus
  useFocusEffect(
    useCallback(() => {
      const checkChangesAndReload = async () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const FileSystem = require('expo-file-system/legacy');
          const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
          const mbtilesDir = `${FileSystem.documentDirectory}mbtiles`;

          let needsFullReload = false;

          // Check manifest changes
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

          // Check for new tile files
          if (!needsFullReload) {
            try {
              const dirInfo = await FileSystem.getInfoAsync(mbtilesDir);
              if (dirInfo.exists) {
                const files = await FileSystem.readDirectoryAsync(mbtilesDir);
                const currentSatelliteCount = files.filter((f: string) => f.includes('satellite_z') && f.endsWith('.mbtiles')).length;
                const currentBasemapCount = files.filter((f: string) => f.includes('basemap_z') && f.endsWith('.mbtiles')).length;
                const currentOceanCount = files.filter((f: string) => f.includes('ocean_z') && f.endsWith('.mbtiles')).length;
                const currentTerrainCount = files.filter((f: string) => f.includes('terrain_z') && f.endsWith('.mbtiles')).length;
                const hasGnis = files.some((f: string) => f === 'gnis_names.mbtiles');
                const hasBasemap = currentBasemapCount > 0 || files.some((f: string) => f.startsWith('basemap') && f.endsWith('.mbtiles'));

                if (currentSatelliteCount !== externalState.satelliteTileSets.length) needsFullReload = true;
                if (currentBasemapCount !== externalState.basemapTileSets.length) needsFullReload = true;
                if (currentOceanCount !== externalState.oceanTileSets.length) needsFullReload = true;
                if (currentTerrainCount !== externalState.terrainTileSets.length) needsFullReload = true;
                if (hasGnis !== externalState.gnisAvailable) needsFullReload = true;
                if (hasBasemap !== externalState.hasLocalBasemap) needsFullReload = true;
              }
            } catch {
              // Ignore scan errors
            }
          }

          if (needsFullReload) {
            logger.info(LogCategory.CHARTS, 'Data changed - reloading charts and restarting tile server');
            await tileServer.stopTileServer();
            await loadCharts();
          }

          // Check for station changes
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
    }, [externalState.satelliteTileSets.length, externalState.basemapTileSets.length, externalState.oceanTileSets.length, externalState.terrainTileSets.length, externalState.hasLocalBasemap, externalState.gnisAvailable])
  );

  // Helper: Add charts in batches
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

      setChartLoadingProgress({ current: Math.min(i + batchSize, total), total, phase: phaseName });
      startTransition(() => {
        setChartsToRender([...accumulated]);
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    return accumulated;
  }, []);

  // Progressive loading (skipped in composite mode)
  useEffect(() => {
    if (useCompositeTiles) {
      logger.debug(LogCategory.CHARTS, 'Progressive loading skipped - using composite tile mode');
      setLoadingPhase('complete');
      return;
    }

    if (loadingPhase === 'us1' && tileServerReady && mbtilesCharts.length > 0) {
      if (progressiveLoadingRef.current) return;
      progressiveLoadingRef.current = true;

      const interactionHandle = InteractionManager.runAfterInteractions(async () => {
        const us1Charts = mbtilesCharts.filter(m => m.chartId.startsWith('US1')).map(m => m.chartId);
        const us2us3Charts = mbtilesCharts.filter(m => m.chartId.match(/^US[23]/)).map(m => m.chartId);

        const tier1All = await addChartsBatched(us1Charts, us2us3Charts, 8, 'Loading coastal charts');
        setChartLoadingProgress(null);
        setLoadingPhase('tier1');

        setTimeout(async () => {
          const us4Charts = mbtilesCharts.filter(m => m.chartId.startsWith('US4')).map(m => m.chartId).slice(0, 100 - tier1All.length);
          let phase3Total = tier1All;
          if (us4Charts.length > 0) {
            phase3Total = await addChartsBatched(tier1All, us4Charts, 10, 'Loading approach charts');
          }
          setChartLoadingProgress(null);

          setTimeout(async () => {
            const us5us6Charts = mbtilesCharts.filter(m => m.chartId.match(/^US[56]/)).map(m => m.chartId).slice(0, 150 - phase3Total.length);
            if (us5us6Charts.length > 0) {
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

  return {
    loading,
    charts,
    mbtilesCharts,
    chartsToRender,
    allChartsToRender,
    loadingPhase,
    chartLoadingProgress,
    rasterCharts,
    tileServerReady,
    storageUsed,
    useMBTiles,
    useCompositeTiles,
    gnisAvailable,
    cacheBuster,
    compositeTileUrl,
    effectiveMaxZoom,
    limitZoomToCharts,
    getChartMaxZoom,
    isChartVisibleAtZoom,
    chartCenter,
    loadCharts,
  };
}

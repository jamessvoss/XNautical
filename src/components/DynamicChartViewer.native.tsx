/**
 * Dynamic Chart Viewer - Renders downloaded charts from local cache
 * Full-featured viewer with all navigation layers
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
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

export default function DynamicChartViewer({ onNavigateToDownloads }: Props = {}) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<Mapbox.MapView>(null);
  const cameraRef = useRef<Mapbox.Camera>(null);

  // Loaded chart data
  const [loading, setLoading] = useState(true);
  const [charts, setCharts] = useState<LoadedChartData[]>([]);
  const [mbtilesCharts, setMbtilesCharts] = useState<LoadedMBTilesChart[]>([]);
  const [rasterCharts, setRasterCharts] = useState<LoadedRasterChart[]>([]);
  const [tileServerReady, setTileServerReady] = useState(false);
  const [storageUsed, setStorageUsed] = useState<{ total: number; vector: number; raster: number }>({ total: 0, vector: 0, raster: 0 });
  
  // Data source toggles
  const [useMBTiles, setUseMBTiles] = useState(true);
  
  // Layer toggles
  const [showDepthAreas, setShowDepthAreas] = useState(true);
  const [showDepthContours, setShowDepthContours] = useState(true);
  const [showSoundings, setShowSoundings] = useState(true);
  const [showLand, setShowLand] = useState(true);
  const [showCoastline, setShowCoastline] = useState(true);
  const [showLights, setShowLights] = useState(true);
  const [showBuoys, setShowBuoys] = useState(true);
  const [showBeacons, setShowBeacons] = useState(true);
  const [showLandmarks, setShowLandmarks] = useState(true);
  const [showHazards, setShowHazards] = useState(true);
  const [showSectors, setShowSectors] = useState(true);
  const [showCables, setShowCables] = useState(true);
  const [showSeabed, setShowSeabed] = useState(true);
  const [showPipelines, setShowPipelines] = useState(true);
  const [showBathymetry, setShowBathymetry] = useState(true);
  const [showRestrictedAreas, setShowRestrictedAreas] = useState(true);
  const [showCautionAreas, setShowCautionAreas] = useState(true);
  const [showMilitaryAreas, setShowMilitaryAreas] = useState(true);
  const [showAnchorages, setShowAnchorages] = useState(true);
  const [showAnchorBerths, setShowAnchorBerths] = useState(true);
  const [showMarineFarms, setShowMarineFarms] = useState(true);
  
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
  const [currentZoom, setCurrentZoom] = useState(10);
  const [centerCoord, setCenterCoord] = useState<[number, number]>([-151.55, 59.64]);
  const [selectedFeature, setSelectedFeature] = useState<FeatureInfo | null>(null);
  const [showControls, setShowControls] = useState(false);
  
  // Map style options
  type MapStyleOption = 'light' | 'dark' | 'satellite' | 'outdoors' | 'local';
  const [mapStyle, setMapStyle] = useState<MapStyleOption>('light');
  const [hasLocalBasemap, setHasLocalBasemap] = useState(false);
  
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
    const totalLoadStart = Date.now();
    try {
      setLoading(true);
      console.log('=== CHART LOADING START ===');
      console.log(`Timestamp: ${new Date().toISOString()}`);
      
      await chartCacheService.initializeCache();
      
      const FileSystem = require('expo-file-system/legacy');
      
      console.log('FileSystem.documentDirectory:', FileSystem.documentDirectory);
      
      // Check multiple locations for mbtiles files
      // Priority: 1) App's internal storage, 2) App's external files dir (dev - survives reinstall)
      const appDir = `${FileSystem.documentDirectory}mbtiles`;
      // App's external files directory - accessible without permissions, writable via adb
      // Note: expo-file-system needs file:// prefix for paths
      const externalAppDir = 'file:///storage/emulated/0/Android/data/com.xnautical.app/files/mbtiles';
      // Also try the old Download location in case permissions work
      const downloadDir = 'file:///sdcard/Download/xnautical_charts';
      
      console.log('Checking directories:');
      console.log('  1. App internal:', appDir);
      console.log('  2. App external:', externalAppDir);
      console.log('  3. Download folder:', downloadDir);
      
      let mbtilesDir = appDir;
      let filesInDir: string[] = [];
      
      // Ensure app directory exists
      const appDirInfo = await FileSystem.getInfoAsync(appDir);
      console.log('App dir exists:', appDirInfo.exists);
      if (!appDirInfo.exists) {
        await FileSystem.makeDirectoryAsync(appDir, { intermediates: true });
        console.log('Created app dir');
      }
      
      // Try app's internal storage first (production location)
      try {
        const appFiles = await FileSystem.readDirectoryAsync(appDir);
        console.log(`App internal dir files (${appFiles.length}):`, appFiles.slice(0, 5));
        const mbtilesCount = appFiles.filter((f: string) => f.endsWith('.mbtiles')).length;
        if (mbtilesCount > 0) {
          console.log(`✓ Found ${mbtilesCount} mbtiles in app storage: ${appDir}`);
          filesInDir = appFiles;
        } else {
          console.log('✗ No mbtiles in app internal storage');
        }
      } catch (e) {
        console.log('✗ Could not read app mbtiles directory:', e);
      }
      
      // Fallback to app's external files directory (development: accessible via adb push)
      if (filesInDir.length === 0) {
        console.log('Trying app external dir...');
        try {
          const externalInfo = await FileSystem.getInfoAsync(externalAppDir);
          console.log('App external dir exists:', externalInfo.exists);
          if (externalInfo.exists) {
            const externalFiles = await FileSystem.readDirectoryAsync(externalAppDir);
            console.log(`App external dir files (${externalFiles.length}):`, externalFiles.slice(0, 5));
            const mbtilesCount = externalFiles.filter((f: string) => f.endsWith('.mbtiles')).length;
            if (mbtilesCount > 0) {
              console.log(`✓ [DEV MODE] Found ${mbtilesCount} mbtiles in app external dir`);
              mbtilesDir = externalAppDir;
              filesInDir = externalFiles;
            } else {
              console.log('✗ No mbtiles in app external dir');
            }
          } else {
            console.log('✗ App external dir does not exist');
          }
        } catch (e) {
          console.log('✗ App external dir error:', e);
        }
      }
      
      // Fallback to Download folder (may need permissions)
      if (filesInDir.length === 0) {
        console.log('Trying Download folder...');
        try {
          const downloadInfo = await FileSystem.getInfoAsync(downloadDir);
          console.log('Download dir exists:', downloadInfo.exists);
          if (downloadInfo.exists) {
            const downloadFiles = await FileSystem.readDirectoryAsync(downloadDir);
            console.log(`Download dir files (${downloadFiles.length}):`, downloadFiles.slice(0, 5));
            const mbtilesCount = downloadFiles.filter((f: string) => f.endsWith('.mbtiles')).length;
            if (mbtilesCount > 0) {
              console.log(`✓ Found ${mbtilesCount} mbtiles in Download folder`);
              mbtilesDir = downloadDir;
              filesInDir = downloadFiles;
            } else {
              console.log('✗ No mbtiles in Download folder');
            }
          } else {
            console.log('✗ Download dir does not exist or not accessible');
          }
        } catch (e) {
          console.log('✗ Download folder error:', e);
        }
      }
      
      console.log('=== FINAL RESULT ===');
      console.log(`Using mbtiles directory: ${mbtilesDir}`);
      console.log(`Total files found: ${filesInDir.length}`);
      
      // Load any .mbtiles files found - separate vector charts from raster charts and reference data
      const loadedMbtiles: LoadedMBTilesChart[] = [];
      const loadedRasters: LoadedRasterChart[] = [];
      let gnisFound = false;
      let basemapFound = false;
      
      console.log('=== PROCESSING FILES ===');
      const processStart = Date.now();
      let processedCount = 0;
      
      for (const filename of filesInDir) {
        if (filename.endsWith('.mbtiles') && !filename.startsWith('._')) {
          // Skip macOS resource fork files (._*)
          const chartId = filename.replace('.mbtiles', '');
          const path = `${mbtilesDir}/${filename}`;
          
          // GNIS place names - reference data layer
          if (chartId.startsWith('gnis_names_')) {
            console.log(`✓ Found GNIS file: ${chartId}`);
            gnisFound = true;
          }
          // Local basemap - vector base map tiles
          else if (chartId.startsWith('basemap_')) {
            console.log(`✓ Found local basemap: ${chartId}`);
            basemapFound = true;
          }
          // BATHY_* files are raster (bathymetric) charts
          else if (chartId.startsWith('BATHY_')) {
            loadedRasters.push({ chartId, path });
          } else {
            loadedMbtiles.push({ chartId, path });
          }
          
          processedCount++;
          // Log progress every 100 files
          if (processedCount % 100 === 0) {
            console.log(`  Processed ${processedCount} files...`);
          }
        }
      }
      console.log(`File processing complete: ${processedCount} files in ${Date.now() - processStart}ms`);
      
      // Set GNIS availability
      setGnisAvailable(gnisFound);
      if (gnisFound) {
        console.log('GNIS place names layer available');
      }
      
      // Set local basemap availability
      setHasLocalBasemap(basemapFound);
      if (basemapFound) {
        console.log('Local offline basemap available');
      }
      
      // Also check the registered downloads (legacy)
      const mbtilesIds = await chartCacheService.getDownloadedMBTilesIds();
      console.log('Registered MBTiles IDs:', mbtilesIds);
      for (const chartId of mbtilesIds) {
        if (!loadedMbtiles.some(m => m.chartId === chartId)) {
          const exists = await chartCacheService.hasMBTiles(chartId);
          if (exists) {
            const path = chartCacheService.getMBTilesPath(chartId);
            console.log(`Found registered MBTiles: ${chartId} at ${path}`);
            loadedMbtiles.push({ chartId, path });
          }
        }
      }
      
      console.log(`Total MBTiles found: ${loadedMbtiles.length}`);
      
      // Sort charts by scale for proper quilting (less detailed first, more detailed on top)
      // US chart naming: US3* = General (small scale), US4* = Harbor, US5* = Approach (large scale)
      // Higher number = more detail = should render LAST (on top)
      console.log('=== SORTING CHARTS ===');
      const sortStart = Date.now();
      loadedMbtiles.sort((a, b) => {
        // Extract the scale digit (e.g., "3" from "US3AK12M", "4" from "US4AK4PH", "5" from "US5AK5SI")
        const getScaleNum = (chartId: string) => {
          const match = chartId.match(/^US(\d)/);
          return match ? parseInt(match[1], 10) : 0;
        };
        return getScaleNum(a.chartId) - getScaleNum(b.chartId);
      });
      
      // Count charts by tier
      const tierCounts: Record<string, number> = {};
      for (const m of loadedMbtiles) {
        const tier = m.chartId.substring(0, 3);
        tierCounts[tier] = (tierCounts[tier] || 0) + 1;
      }
      console.log(`Sorted ${loadedMbtiles.length} charts in ${Date.now() - sortStart}ms`);
      console.log('Charts by tier:', tierCounts);
      console.log(`Total Raster charts: ${loadedRasters.length}`);
      
      setMbtilesCharts(loadedMbtiles);
      setRasterCharts(loadedRasters);
      
      // Calculate storage used by MBTiles files (skip for large collections to avoid slowdown)
      console.log('=== CALCULATING STORAGE ===');
      const storageStart = Date.now();
      let vectorSize = 0;
      let rasterSize = 0;
      
      const totalCharts = loadedMbtiles.length + loadedRasters.length;
      if (totalCharts > 200) {
        // Skip individual file size checks for large collections - too slow
        console.log(`Skipping size calculation for ${totalCharts} files (too many)`);
        setStorageUsed({ total: 0, vector: 0, raster: 0 });
      } else {
        for (const chart of loadedMbtiles) {
          try {
            const info = await FileSystem.getInfoAsync(chart.path);
            if (info.exists && 'size' in info) {
              vectorSize += info.size || 0;
            }
          } catch (e) {
            // Silently skip
          }
        }
        for (const chart of loadedRasters) {
          try {
            const info = await FileSystem.getInfoAsync(chart.path);
            if (info.exists && 'size' in info) {
              rasterSize += info.size || 0;
            }
          } catch (e) {
            // Silently skip
          }
        }
        setStorageUsed({ total: vectorSize + rasterSize, vector: vectorSize, raster: rasterSize });
        console.log(`Storage: ${((vectorSize + rasterSize) / 1024 / 1024).toFixed(1)} MB (${Date.now() - storageStart}ms)`);
      }
      
      // Start tile server if we have MBTiles or raster charts
      if (loadedMbtiles.length > 0 || loadedRasters.length > 0) {
        console.log('=== STARTING TILE SERVER ===');
        const serverStart = Date.now();
        console.log(`Starting local tile server with dir: ${mbtilesDir}`);
        
        try {
          const serverUrl = await tileServer.startTileServer({ mbtilesDir });
          console.log(`Tile server started in ${Date.now() - serverStart}ms at: ${serverUrl}`);
          
          if (serverUrl) {
            // Pre-load databases - limit to Tier 1 charts (US1/US2/US3) to avoid overload
            const tier1Charts = loadedMbtiles
              .filter(m => m.chartId.match(/^US[123]/))
              .map(m => m.chartId);
            
            console.log(`=== PRELOADING DATABASES ===`);
            console.log(`Preloading ${tier1Charts.length} Tier 1 charts (skipping ${loadedMbtiles.length - tier1Charts.length} Tier 2 charts)`);
            const preloadStart = Date.now();
            
            if (tier1Charts.length > 0) {
              await tileServer.preloadDatabases(tier1Charts);
            }
            console.log(`Preload complete in ${Date.now() - preloadStart}ms`);
            
            setTileServerReady(true);
            
            // Set debug info (summarized for large collections)
            const chartSummary = `${loadedMbtiles.length} vector charts, ${loadedRasters.length} raster charts`;
            setDebugInfo(`Server: ${serverUrl}\nCharts: ${chartSummary}\nDir: ${mbtilesDir}`);
          } else {
            console.warn('Failed to start tile server - no URL returned');
            setDebugInfo(`Failed to start tile server\nDir: ${mbtilesDir}`);
          }
        } catch (e) {
          console.error('Tile server error:', e);
          setDebugInfo(`Tile server error: ${e}`);
        }
      } else {
        setDebugInfo(`No MBTiles files found.\n\nPut .mbtiles files in:\n${mbtilesDir}\n\nOr download via Charts screen.`);
      }
      
      // Also load GeoJSON charts (legacy format)
      const downloadedIds = await chartCacheService.getDownloadedChartIds();
      console.log('Downloaded GeoJSON chart IDs:', downloadedIds);
      
      if (downloadedIds.length === 0 && loadedMbtiles.length === 0) {
        console.log('No charts downloaded');
        setLoading(false);
        return;
      }
      
      const loadedCharts: LoadedChartData[] = [];
      
      for (const chartId of downloadedIds) {
        // Skip if we have MBTiles version
        if (loadedMbtiles.some(m => m.chartId === chartId)) {
          console.log(`Skipping GeoJSON for ${chartId} - MBTiles version exists`);
          continue;
        }
        
        console.log(`Loading GeoJSON chart: ${chartId}`);
        const features = await chartCacheService.loadChart(chartId);
        const featureTypes = Object.keys(features);
        console.log(`  Loaded features for ${chartId}:`, featureTypes);
        
        // Log feature counts
        for (const [type, data] of Object.entries(features)) {
          console.log(`    ${type}: ${data?.features?.length || 0} features`);
        }
        
        if (Object.keys(features).length > 0) {
          loadedCharts.push({ chartId, features });
        }
      }
      
      console.log(`Total GeoJSON charts loaded: ${loadedCharts.length}`);
      console.log(`Total MBTiles charts loaded: ${loadedMbtiles.length}`);
      setCharts(loadedCharts);
      
      console.log('=== CHART LOADING COMPLETE ===');
      console.log(`Total load time: ${Date.now() - totalLoadStart}ms`);
      console.log(`MBTiles: ${loadedMbtiles.length}, GeoJSON: ${loadedCharts.length}`);
      if (loadedMbtiles.length > 100) {
        console.warn(`⚠️ Only rendering first 100 of ${loadedMbtiles.length} charts for performance`);
      }
    } catch (error) {
      console.error('=== CHART LOADING ERROR ===');
      console.error('Error:', error);
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

  // Handle map events
  const handleMapIdle = useCallback((state: any) => {
    if (state?.properties?.zoom !== undefined) {
      setCurrentZoom(Math.round(state.properties.zoom * 10) / 10);
    }
    if (state?.properties?.center) {
      setCenterCoord(state.properties.center);
    }
  }, []);

  // Handle camera changes (fires continuously during pan/zoom)
  const handleCameraChanged = useCallback((state: any) => {
    if (state?.properties?.center) {
      setCenterCoord(state.properties.center);
    }
    if (state?.properties?.zoom !== undefined) {
      const zoom = Math.round(state.properties.zoom * 10) / 10;
      setCurrentZoom(zoom);
      // Check if we're at the max zoom limit
      setIsAtMaxZoom(limitZoomToCharts && zoom >= effectiveMaxZoom - 0.1);
    }
  }, [limitZoomToCharts, effectiveMaxZoom]);
  

  const handleFeaturePress = useCallback((layerType: string) => (e: any) => {
    const feature = e.features?.[0];
    if (feature) {
      setSelectedFeature({
        type: layerType,
        properties: feature.properties || {},
      });
    }
  }, []);

  // Build list of queryable layer IDs from loaded charts
  const queryableLayerIds = useMemo(() => {
    // All layer types from our MBTiles rendering (must match actual layer IDs)
    const layerTypes = [
      'depare', 'depcnt', 'depcnt-labels', 'soundg',
      'lights', 'lights-sector', 'lights-sector-outline',
      'buoys', 'beacons',
      'wrecks', 'uwtroc', 'uwtroc-label', 'obstrn',
      'lndmrk', 'lndmrk-label',
      'cblsub', 'cblsub-label', 'cblare', 'cblare-outline',
      'pipsol', 'pipsol-label', 'pipare', 'pipare-outline',
      'sbdare', 'drgare', 'drgare-outline',
      'fairwy', 'fairwy-outline',
      'lndare', 'lndare-outline', 'coalne',
      // Restricted/caution areas and anchorages
      'resare', 'resare-outline',
      'ctnare', 'ctnare-outline',
      'mipare', 'mipare-outline',
      'achare', 'achare-outline',
      'achbrt', 'achbrt-label',
      'marcul', 'marcul-outline',
    ];
    
    const ids: string[] = [];
    for (const chart of mbtilesCharts) {
      for (const layerType of layerTypes) {
        ids.push(`mbtiles-${layerType}-${chart.chartId}`);
      }
    }
    // Limit queryable layers to match rendered charts (max 100)
    const renderedChartCount = Math.min(mbtilesCharts.length, 100);
    console.log(`[MapPress] Built ${ids.length} queryable layer IDs for ${renderedChartCount} rendered charts`);
    if (mbtilesCharts.length > 100) {
      console.warn(`[MapPress] ⚠️ ${mbtilesCharts.length - 100} charts not rendered (performance limit)`);
    }
    return ids.slice(0, renderedChartCount * layerTypes.length);
  }, [mbtilesCharts]);

  // Handle map press - query features at tap location from MBTiles vector layers
  const handleMapPress = useCallback(async (e: any) => {
    console.log('[MapPress] Event received');
    
    if (!mapRef.current) {
      console.log('[MapPress] No map ref');
      return;
    }
    
    const { geometry } = e;
    if (!geometry?.coordinates) {
      console.log('[MapPress] No geometry coordinates');
      return;
    }
    
    const [longitude, latitude] = geometry.coordinates;
    console.log(`[MapPress] Tap at: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
    
    // Round screen coordinates to integers
    const screenX = Math.round(e.properties?.screenPointX || 0);
    const screenY = Math.round(e.properties?.screenPointY || 0);
    console.log(`[MapPress] Screen point: ${screenX}, ${screenY}`);
    
    try {
      // Query features in a rectangle around the tap point (22px tolerance for finger taps)
      const tolerance = 22; // pixels (~10mm finger tap radius)
      const bbox: [number, number, number, number] = [
        screenY - tolerance,  // top
        screenX + tolerance,  // right  
        screenY + tolerance,  // bottom
        screenX - tolerance,  // left
      ];
      console.log(`[MapPress] Querying ${queryableLayerIds.length} layers in ${tolerance}px radius`);
      
      const features = await mapRef.current.queryRenderedFeaturesInRect(
        bbox,
        null,  // No filter expression
        queryableLayerIds  // Specific layer IDs to query
      );
      
      console.log(`[MapPress] Query returned ${features?.features?.length || 0} features`);
      
      if (features && features.features && features.features.length > 0) {
        // Log what we found
        console.log('[MapPress] Features found:');
        features.features.slice(0, 5).forEach((f: any, i: number) => {
          console.log(`  [${i}] layer: ${f.properties?._layer || f.sourceLayer || 'unknown'}, type: ${f.geometry?.type}`);
        });
        
        // Prioritize nautical features over base map features
        const nauticalLayers = [
          'LIGHTS', 'LIGHTS_SECTOR',
          'BOYLAT', 'BOYCAR', 'BOYSAW', 'BOYSPP', 'BOYISD',
          'BCNLAT', 'BCNSPP', 'BCNCAR', 'BCNISD', 'BCNSAW',
          'WRECKS', 'UWTROC', 'OBSTRN',
          'RESARE', 'CTNARE', 'MIPARE',  // Restricted/caution areas
          'ACHARE', 'ACHBRT', 'MARCUL',   // Anchorages and aquaculture
          'LNDMRK', 'CBLSUB', 'CBLARE', 'PIPSOL', 'PIPARE',
          'SOUNDG', 'DEPARE', 'DEPCNT', 'SBDARE',
          'DRGARE', 'FAIRWY',
        ];
        
        // Find the best feature to display (prioritize point features and nautical data)
        let bestFeature = null;
        let bestPriority = -1;
        
        for (const feature of features.features) {
          const props = feature.properties || {};
          const layer = props._layer || '';
          
          // Skip meta layers
          if (layer.startsWith('M_')) continue;
          
          // Calculate priority
          let priority = 0;
          const layerIndex = nauticalLayers.indexOf(layer);
          if (layerIndex >= 0) {
            priority = 100 - layerIndex; // Higher priority for layers earlier in the list
          }
          
          // Boost point features (more likely what user tapped on)
          if (feature.geometry?.type === 'Point') {
            priority += 50;
          }
          
          if (priority > bestPriority) {
            bestPriority = priority;
            bestFeature = feature;
          }
        }
        
        if (bestFeature) {
          const props = bestFeature.properties || {};
          const layer = props._layer || 'Unknown';
          
          // Map layer names to friendly display names
          const layerNames: Record<string, string> = {
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
          
          console.log(`[MapPress] Selected feature: ${layer}`);
          setSelectedFeature({
            type: layerNames[layer] || layer,
            properties: {
              ...props,
              _tapCoordinates: `${latitude.toFixed(5)}°, ${longitude.toFixed(5)}°`,
            },
          });
        } else {
          console.log('[MapPress] No best feature found after filtering');
        }
      } else {
        console.log('[MapPress] No features returned from query');
      }
    } catch (error) {
      console.log('[MapPress] Error querying features:', error);
    }
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
        scaleBarEnabled={true}
        scaleBarPosition={{ bottom: 16, right: 70 }}
      >
        <Mapbox.Camera
          ref={cameraRef}
          defaultSettings={{
            zoomLevel: 10,
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
        {mapStyle === 'local' && tileServerReady && hasLocalBasemap && (
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
              }}
            />
            <Mapbox.FillLayer
              id="basemap-landcover-grass"
              sourceLayerID="landcover"
              filter={['==', ['get', 'class'], 'grass']}
              style={{
                fillColor: '#d8e8c8',
                fillOpacity: 0.6,
              }}
            />
            <Mapbox.FillLayer
              id="basemap-landcover-wood"
              sourceLayerID="landcover"
              filter={['any', ['==', ['get', 'class'], 'wood'], ['==', ['get', 'class'], 'forest']]}
              style={{
                fillColor: '#c5ddb0',
                fillOpacity: 0.6,
              }}
            />
            <Mapbox.FillLayer
              id="basemap-landcover-wetland"
              sourceLayerID="landcover"
              filter={['==', ['get', 'class'], 'wetland']}
              style={{
                fillColor: '#d0e8d8',
                fillOpacity: 0.5,
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
              }}
            />
            
            {/* === PARKS & PROTECTED AREAS === */}
            <Mapbox.FillLayer
              id="basemap-park"
              sourceLayerID="park"
              style={{
                fillColor: '#c8e6c9',
                fillOpacity: 0.4,
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
              }}
            />
          </Mapbox.VectorSource>
        )}

        {/* MBTiles Vector Sources - Chart quilting with zoom-based visibility */}
        {/* PERFORMANCE: Limit to 100 charts max to prevent Mapbox overload */}
        {useMBTiles && tileServerReady && mbtilesCharts.slice(0, 100).map((chart) => {
          const tileUrl = tileServer.getTileUrlTemplate(chart.chartId);
          
          // Determine minZoomLevel based on chart scale for proper quilting
          // Matches the tippecanoe min zoom settings from convert.py
          // US1: z0, US2: z8, US3: z10, US4: z11, US5: z13
          const getChartMinZoom = (chartId: string): number => {
            const match = chartId.match(/^US(\d)/);
            if (!match) return 0;
            const scaleNum = parseInt(match[1], 10);
            
            // Match the scale-based conversion settings
            if (scaleNum === 1) return 0;   // US1 Overview: z0-8
            if (scaleNum === 2) return 8;   // US2 General: z8-10
            if (scaleNum === 3) return 10;  // US3 Coastal: z10-13
            if (scaleNum === 4) return 11;  // US4 Approach: z11-16
            if (scaleNum === 5) return 13;  // US5 Harbor: z13-18
            if (scaleNum >= 6) return 13;   // US6+ (if any)
            return 0;
          };
          const chartMinZoom = getChartMinZoom(chart.chartId);
          
          return (
          <Mapbox.VectorSource
            key={`mbtiles-src-${chart.chartId}-${cacheBuster}`}
            id={`mbtiles-src-${chart.chartId}`}
            tileUrlTemplates={[tileUrl]}
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
            <Mapbox.FillLayer
              id={`mbtiles-depare-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              minZoomLevel={chartMinZoom}
              filter={['==', ['get', '_layer'], 'DEPARE']}
              style={{
                fillColor: [
                  'step',
                  ['get', 'DRVAL1'],
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
              id={`mbtiles-drgare-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              minZoomLevel={chartMinZoom}
              filter={['==', ['get', '_layer'], 'DRGARE']}
              style={{
                fillColor: '#87CEEB',
                fillOpacity: 0.4,
              }}
            />
            
            {/* FAIRWY - Fairways (navigation channels) */}
            <Mapbox.FillLayer
              id={`mbtiles-fairwy-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              minZoomLevel={chartMinZoom}
              filter={['==', ['get', '_layer'], 'FAIRWY']}
              style={{
                fillColor: '#E6E6FA',
                fillOpacity: 0.3,
              }}
            />
            
            {/* === SECTION 2: LAND (masks water features) === */}
            
            {/* LNDARE - Land Areas - MUST be early to mask water features on land */}
            <Mapbox.FillLayer
              id={`mbtiles-lndare-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              minZoomLevel={chartMinZoom}
              filter={['==', ['get', '_layer'], 'LNDARE']}
              style={{
                fillColor: '#F5DEB3',
                fillOpacity: mapStyle === 'satellite' ? 0.3 : 1,
                visibility: showLand ? 'visible' : 'none',
              }}
            />
            
            {/* === SECTION 3: AREA OVERLAYS (on top of land/water) === */}
            
            {/* CBLARE - Cable Areas (fill only, outline later) */}
            <Mapbox.FillLayer
              id={`mbtiles-cblare-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-pipare-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-resare-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-ctnare-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-mipare-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-achare-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-marcul-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
            <Mapbox.LineLayer
              id={`mbtiles-depcnt-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              minZoomLevel={chartMinZoom}
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
                  '#000000', 0.1, '#1E3A5F', 2, '#2E5984', 5,
                  '#4A7BA7', 10, '#6B9BC3', 20, '#8FBCD9', 50, '#B0D4E8',
                ],
                lineWidth: [
                  'step',
                  ['coalesce', ['get', 'VALDCO'], 0],
                  2.0, 0.1, 1.5, 5, 1.0, 20, 0.7, 50, 0.5,
                ],
                lineCap: 'round',
                lineJoin: 'round',
                visibility: showDepthContours ? 'visible' : 'none',
              }}
            />
            
            {/* COALNE - Coastline */}
            <Mapbox.LineLayer
              id={`mbtiles-coalne-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              minZoomLevel={chartMinZoom}
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
              id={`mbtiles-lndare-outline-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              minZoomLevel={chartMinZoom}
              filter={['==', ['get', '_layer'], 'LNDARE']}
              style={{
                lineColor: '#8B7355',
                lineWidth: 1,
                visibility: showLand ? 'visible' : 'none',
              }}
            />
            
            {/* DRGARE outline */}
            <Mapbox.LineLayer
              id={`mbtiles-drgare-outline-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-fairwy-outline-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-cblare-outline-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-cblsub-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-pipare-outline-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-resare-outline-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-ctnare-outline-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-mipare-outline-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-achare-outline-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-marcul-outline-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-pipsol-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-depcnt-labels-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-sbdare-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
            <Mapbox.SymbolLayer
              id={`mbtiles-soundg-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              minZoomLevel={chartMinZoom}
              maxZoomLevel={22}
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
                textAllowOverlap: true,
                textIgnorePlacement: true,
                visibility: showSoundings ? 'visible' : 'none',
              }}
            />
            
            {/* Cable/Pipeline labels */}
            <Mapbox.SymbolLayer
              id={`mbtiles-cblsub-label-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-pipsol-label-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-wrecks-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              minZoomLevel={chartMinZoom}
              filter={['all',
                ['==', ['get', '_layer'], 'WRECKS'],
                ['==', ['geometry-type'], 'Point']
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
              id={`mbtiles-uwtroc-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              minZoomLevel={chartMinZoom}
              filter={['all',
                ['==', ['get', '_layer'], 'UWTROC'],
                ['==', ['geometry-type'], 'Point']
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
              id={`mbtiles-uwtroc-label-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-obstrn-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              minZoomLevel={chartMinZoom}
              filter={['all',
                ['==', ['get', '_layer'], 'OBSTRN'],
                ['==', ['geometry-type'], 'Point']
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
              id={`mbtiles-achbrt-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-achbrt-label-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
              id={`mbtiles-buoys-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              minZoomLevel={chartMinZoom}
              filter={['any',
                ['==', ['get', '_layer'], 'BOYLAT'],
                ['==', ['get', '_layer'], 'BOYCAR'],
                ['==', ['get', '_layer'], 'BOYSAW'],
                ['==', ['get', '_layer'], 'BOYSPP'],
                ['==', ['get', '_layer'], 'BOYISD'],
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
              id={`mbtiles-beacons-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              minZoomLevel={chartMinZoom}
              filter={['any',
                ['==', ['get', '_layer'], 'BCNLAT'],
                ['==', ['get', '_layer'], 'BCNSPP'],
                ['==', ['get', '_layer'], 'BCNCAR'],
                ['==', ['get', '_layer'], 'BCNISD'],
                ['==', ['get', '_layer'], 'BCNSAW'],
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
              id={`mbtiles-lights-sector-outline-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              minZoomLevel={chartMinZoom}
              maxZoomLevel={22}
              filter={['==', ['get', '_layer'], 'LIGHTS_SECTOR']}
              style={{
                lineColor: '#000000',
                lineWidth: 7,
                lineOpacity: 0.7,
                visibility: showLights ? 'visible' : 'none',
              }}
            />
            
            {/* Colored sector arcs (rendered on top of outline) */}
            <Mapbox.LineLayer
              id={`mbtiles-lights-sector-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              minZoomLevel={chartMinZoom}
              maxZoomLevel={22}
              filter={['==', ['get', '_layer'], 'LIGHTS_SECTOR']}
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
              id={`mbtiles-lights-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['==', ['get', '_layer'], 'LIGHTS']}
              minZoomLevel={chartMinZoom}
              maxZoomLevel={22}
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
              id={`mbtiles-lndmrk-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              minZoomLevel={chartMinZoom}
              filter={['all',
                ['==', ['get', '_layer'], 'LNDMRK'],
                ['==', ['geometry-type'], 'Point']
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
              id={`mbtiles-lndmrk-label-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              minZoomLevel={chartMinZoom}
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

        {/* GNIS Place Names Layer - Reference data from USGS */}
        {tileServerReady && gnisAvailable && showPlaceNames && (
          <Mapbox.VectorSource
            id="gnis-names-source"
            tileUrlTemplates={[`${tileServer.getTileServerUrl()}/tiles/gnis_names_ak/{z}/{x}/{y}.pbf`]}
          >
            {/* Water features - Bays, channels, sounds (highest priority) */}
            <Mapbox.SymbolLayer
              id="gnis-water-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'water']}
              minZoomLevel={7}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['DIN Pro Medium', 'Arial Unicode MS Regular'],
                textSize: [
                  'interpolate', ['linear'], ['zoom'],
                  7, 10,
                  10, 12,
                  14, 14,
                ],
                textColor: '#0066CC',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1.5,
                textAllowOverlap: false,
                textIgnorePlacement: false,
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 8,
                visibility: showWaterNames ? 'visible' : 'none',
              }}
            />
            
            {/* Coastal features - Capes, islands, beaches */}
            <Mapbox.SymbolLayer
              id="gnis-coastal-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'coastal']}
              minZoomLevel={8}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['DIN Pro Medium', 'Arial Unicode MS Regular'],
                textSize: [
                  'interpolate', ['linear'], ['zoom'],
                  8, 9,
                  12, 11,
                  14, 13,
                ],
                textColor: '#996633',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1.5,
                textAllowOverlap: false,
                textIgnorePlacement: false,
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 8,
                visibility: showCoastalNames ? 'visible' : 'none',
              }}
            />
            
            {/* Landmark features - Summits, glaciers, cliffs */}
            <Mapbox.SymbolLayer
              id="gnis-landmark-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'landmark']}
              minZoomLevel={9}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['DIN Pro Italic', 'Arial Unicode MS Regular'],
                textSize: [
                  'interpolate', ['linear'], ['zoom'],
                  9, 9,
                  14, 12,
                ],
                textColor: '#666666',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1.5,
                textAllowOverlap: false,
                textIgnorePlacement: false,
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 8,
                visibility: showLandmarkNames ? 'visible' : 'none',
              }}
            />
            
            {/* Populated places - Towns, ports */}
            <Mapbox.SymbolLayer
              id="gnis-populated-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'populated']}
              minZoomLevel={7}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['DIN Pro Bold', 'Arial Unicode MS Bold'],
                textSize: [
                  'interpolate', ['linear'], ['zoom'],
                  7, 10,
                  10, 12,
                  14, 14,
                ],
                textColor: '#CC0000',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 2,
                textAllowOverlap: false,
                textIgnorePlacement: false,
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 8,
                visibility: showPopulatedNames ? 'visible' : 'none',
              }}
            />
            
            {/* Stream names - Rivers, creeks (off by default) */}
            <Mapbox.SymbolLayer
              id="gnis-stream-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'stream']}
              minZoomLevel={10}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['DIN Pro Italic', 'Arial Unicode MS Regular'],
                textSize: [
                  'interpolate', ['linear'], ['zoom'],
                  10, 8,
                  14, 10,
                ],
                textColor: '#3399FF',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1,
                textAllowOverlap: false,
                textIgnorePlacement: false,
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 8,
                visibility: showStreamNames ? 'visible' : 'none',
              }}
            />
            
            {/* Lake names (off by default) */}
            <Mapbox.SymbolLayer
              id="gnis-lake-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'lake']}
              minZoomLevel={10}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['DIN Pro Italic', 'Arial Unicode MS Regular'],
                textSize: [
                  'interpolate', ['linear'], ['zoom'],
                  10, 8,
                  14, 10,
                ],
                textColor: '#66CCFF',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1,
                textAllowOverlap: false,
                textIgnorePlacement: false,
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 8,
                visibility: showLakeNames ? 'visible' : 'none',
              }}
            />
            
            {/* Terrain features - Valleys, basins (off by default) */}
            <Mapbox.SymbolLayer
              id="gnis-terrain-names"
              sourceLayerID="gnis_names"
              filter={['==', ['get', 'CATEGORY'], 'terrain']}
              minZoomLevel={11}
              style={{
                textField: ['get', 'NAME'],
                textFont: ['DIN Pro Regular', 'Arial Unicode MS Regular'],
                textSize: [
                  'interpolate', ['linear'], ['zoom'],
                  11, 8,
                  14, 10,
                ],
                textColor: '#999966',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1,
                textAllowOverlap: false,
                textIgnorePlacement: false,
                symbolPlacement: 'point',
                textAnchor: 'center',
                textMaxWidth: 8,
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

      {/* Layers button - positioned in safe area */}
      <TouchableOpacity 
        style={[styles.layersBtn, { top: insets.top + 12, right: 12 }]}
        onPress={() => setShowControls(!showControls)}
      >
        <View style={styles.layersIcon}>
          <View style={[styles.layersSquare, styles.layersSquare1]} />
          <View style={[styles.layersSquare, styles.layersSquare2]} />
          <View style={[styles.layersSquare, styles.layersSquare3]} />
        </View>
      </TouchableOpacity>

      {/* Chart debug button - shows active chart info */}
      <TouchableOpacity 
        style={[styles.debugBtn, { top: insets.top + 12, left: 12 }]}
        onPress={() => setShowChartDebug(!showChartDebug)}
      >
        <Text style={styles.debugBtnText}>📍</Text>
      </TouchableOpacity>

      {/* Technical debug button */}
      <TouchableOpacity 
        style={[styles.debugBtn, { top: insets.top + 12, left: 58 }]}
        onPress={() => setShowDebug(!showDebug)}
      >
        <Text style={styles.debugBtnText}>🔧</Text>
      </TouchableOpacity>

      {/* GPS Panel toggle button */}
      <TouchableOpacity 
        style={[
          styles.debugBtn, 
          { top: insets.top + 12, left: 104 },
          showGPSPanel && styles.activeToggleBtn,
        ]}
        onPress={() => setShowGPSPanel(!showGPSPanel)}
      >
        <Text style={styles.debugBtnText}>📡</Text>
      </TouchableOpacity>

      {/* Compass toggle button */}
      <TouchableOpacity 
        style={[
          styles.debugBtn, 
          { top: insets.top + 12, left: 150 },
          showCompass && styles.activeToggleBtn,
        ]}
        onPress={() => setShowCompass(!showCompass)}
      >
        <Text style={styles.debugBtnText}>🧭</Text>
      </TouchableOpacity>

      {/* Follow GPS toggle button (only when GPS is on) */}
      {(showGPSPanel || showCompass) && gpsData.isTracking && (
        <TouchableOpacity 
          style={[
            styles.debugBtn, 
            { top: insets.top + 12, left: 196 },
            followGPS && styles.activeToggleBtn,
          ]}
          onPress={() => setFollowGPS(!followGPS)}
        >
          <Text style={styles.debugBtnText}>{followGPS ? '🎯' : '📌'}</Text>
        </TouchableOpacity>
      )}

      {/* Chart Debug Overlay - Shows active chart based on zoom */}
      <ChartDebugOverlay
        visible={showChartDebug}
        currentZoom={currentZoom}
        centerCoord={centerCoord}
        mbtilesCharts={mbtilesCharts}
        tileServerReady={tileServerReady}
        topOffset={insets.top + 60}
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
            
            <Text style={styles.debugSectionTitle}>Loaded Charts ({mbtilesCharts.length})</Text>
            <View style={styles.debugChartList}>
              {mbtilesCharts.map((chart, idx) => (
                <Text key={chart.chartId} style={styles.debugChartItem}>
                  {chart.chartId}
                </Text>
              ))}
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

      {/* Coordinates and Zoom indicator - bottom right */}
      <View style={[styles.coordBadge, { bottom: 40, right: 12 }]}>
        <Text style={styles.coordText}>
          {Math.abs(centerCoord[1]).toFixed(4)}°{centerCoord[1] >= 0 ? 'N' : 'S'}{' '}
          {Math.abs(centerCoord[0]).toFixed(4)}°{centerCoord[0] >= 0 ? 'E' : 'W'}
        </Text>
      </View>
      <View style={[styles.zoomBadge, { bottom: 16, right: 12 }, isAtMaxZoom && styles.zoomBadgeAtMax]}>
        <Text style={[styles.zoomText, isAtMaxZoom && styles.zoomTextAtMax]}>
          {currentZoom.toFixed(1)}x{isAtMaxZoom ? ' MAX' : ''}
        </Text>
      </View>
      
      {/* Max zoom indicator - shows when limited and near max */}
      {limitZoomToCharts && currentZoom >= maxAvailableZoom - 2 && (
        <View style={[styles.maxZoomIndicator, { bottom: 42, right: 12 }]}>
          <Text style={styles.maxZoomText}>
            Chart limit: z{maxAvailableZoom}
          </Text>
        </View>
      )}

      {/* Layer Controls */}
      {showControls && (
        <View style={[styles.controls, { top: insets.top + 56 }]}>
          <ScrollView style={styles.controlsScroll}>
            {/* Map Style Selector */}
            <Text style={styles.controlSectionTitle}>Base Map</Text>
            <View style={styles.mapStyleRow}>
              <TouchableOpacity
                style={[styles.mapStyleBtn, mapStyle === 'light' && styles.mapStyleBtnActive]}
                onPress={() => setMapStyle('light')}
              >
                <Text style={[styles.mapStyleBtnText, mapStyle === 'light' && styles.mapStyleBtnTextActive]}>Light</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.mapStyleBtn, mapStyle === 'dark' && styles.mapStyleBtnActive]}
                onPress={() => setMapStyle('dark')}
              >
                <Text style={[styles.mapStyleBtnText, mapStyle === 'dark' && styles.mapStyleBtnTextActive]}>Dark</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.mapStyleBtn, mapStyle === 'satellite' && styles.mapStyleBtnActive]}
                onPress={() => setMapStyle('satellite')}
              >
                <Text style={[styles.mapStyleBtnText, mapStyle === 'satellite' && styles.mapStyleBtnTextActive]}>Satellite</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.mapStyleBtn, mapStyle === 'outdoors' && styles.mapStyleBtnActive]}
                onPress={() => setMapStyle('outdoors')}
              >
                <Text style={[styles.mapStyleBtnText, mapStyle === 'outdoors' && styles.mapStyleBtnTextActive]}>Outdoors</Text>
              </TouchableOpacity>
              {hasLocalBasemap && (
                <TouchableOpacity
                  style={[styles.mapStyleBtn, mapStyle === 'local' && styles.mapStyleBtnActive]}
                  onPress={() => setMapStyle('local')}
                >
                  <Text style={[styles.mapStyleBtnText, mapStyle === 'local' && styles.mapStyleBtnTextActive]}>Offline</Text>
                </TouchableOpacity>
              )}
            </View>
            
            {/* Data Sources - toggle entire chart types on/off */}
            <Text style={styles.controlSectionTitle}>Data Sources</Text>
            <Toggle label={`ENC Charts (${mbtilesCharts.length})`} value={useMBTiles} onToggle={setUseMBTiles} />
            {rasterCharts.length > 0 && (
              <Toggle label={`Bathymetry (${rasterCharts.length})`} value={showBathymetry} onToggle={setShowBathymetry} />
            )}
            
            {/* GNIS Place Names - Reference Data */}
            {gnisAvailable && (
              <>
                <Text style={styles.controlSectionTitle}>Place Names (GNIS)</Text>
                <Toggle label="Show Place Names" value={showPlaceNames} onToggle={setShowPlaceNames} />
                {showPlaceNames && (
                  <>
                    <Toggle label="Water (bays, channels)" value={showWaterNames} onToggle={setShowWaterNames} />
                    <Toggle label="Coastal (capes, islands)" value={showCoastalNames} onToggle={setShowCoastalNames} />
                    <Toggle label="Landmarks (summits, glaciers)" value={showLandmarkNames} onToggle={setShowLandmarkNames} />
                    <Toggle label="Towns & Ports" value={showPopulatedNames} onToggle={setShowPopulatedNames} />
                    <Toggle label="Rivers & Streams" value={showStreamNames} onToggle={setShowStreamNames} />
                    <Toggle label="Lakes" value={showLakeNames} onToggle={setShowLakeNames} />
                    <Toggle label="Terrain (valleys, basins)" value={showTerrainNames} onToggle={setShowTerrainNames} />
                  </>
                )}
              </>
            )}
            
            {/* Zoom Settings */}
            <Text style={styles.controlSectionTitle}>Zoom</Text>
            <Toggle 
              label={`Limit to chart detail (max z${maxAvailableZoom})`} 
              value={limitZoomToCharts} 
              onToggle={setLimitZoomToCharts} 
            />
            
            <Text style={styles.controlSectionTitle}>Chart Layers</Text>
            <View style={styles.allToggleRow}>
              <TouchableOpacity 
                style={styles.allToggleBtn} 
                onPress={() => {
                  setShowDepthAreas(true);
                  setShowDepthContours(true);
                  setShowSoundings(true);
                  setShowLand(true);
                  setShowCoastline(true);
                  setShowLights(true);
                  setShowSectors(true);
                  setShowBuoys(true);
                  setShowBeacons(true);
                  setShowLandmarks(true);
                  setShowHazards(true);
                  setShowCables(true);
                  setShowSeabed(true);
                  setShowPipelines(true);
                  setShowRestrictedAreas(true);
                  setShowCautionAreas(true);
                  setShowMilitaryAreas(true);
                  setShowAnchorages(true);
                  setShowAnchorBerths(true);
                  setShowMarineFarms(true);
                }}
              >
                <Text style={styles.allToggleBtnText}>All On</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.allToggleBtn} 
                onPress={() => {
                  setShowDepthAreas(false);
                  setShowDepthContours(false);
                  setShowSoundings(false);
                  setShowLand(false);
                  setShowCoastline(false);
                  setShowLights(false);
                  setShowSectors(false);
                  setShowBuoys(false);
                  setShowBeacons(false);
                  setShowLandmarks(false);
                  setShowHazards(false);
                  setShowCables(false);
                  setShowSeabed(false);
                  setShowPipelines(false);
                  setShowRestrictedAreas(false);
                  setShowCautionAreas(false);
                  setShowMilitaryAreas(false);
                  setShowAnchorages(false);
                  setShowAnchorBerths(false);
                  setShowMarineFarms(false);
                }}
              >
                <Text style={styles.allToggleBtnText}>All Off</Text>
              </TouchableOpacity>
            </View>
            <Toggle label="Depth Areas" value={showDepthAreas} onToggle={setShowDepthAreas} />
            <Toggle label="Depth Contours" value={showDepthContours} onToggle={setShowDepthContours} />
            <Toggle label="Soundings" value={showSoundings} onToggle={setShowSoundings} />
            <Toggle label="Land" value={showLand} onToggle={setShowLand} />
            <Toggle label="Coastline" value={showCoastline} onToggle={setShowCoastline} />
            <Toggle label="Lights" value={showLights} onToggle={setShowLights} />
            <Toggle label="Light Sectors" value={showSectors} onToggle={setShowSectors} />
            <Toggle label="Buoys" value={showBuoys} onToggle={setShowBuoys} />
            <Toggle label="Beacons" value={showBeacons} onToggle={setShowBeacons} />
            <Toggle label="Landmarks" value={showLandmarks} onToggle={setShowLandmarks} />
            <Toggle label="Hazards" value={showHazards} onToggle={setShowHazards} />
            <Toggle label="Cables" value={showCables} onToggle={setShowCables} />
            <Toggle label="Seabed" value={showSeabed} onToggle={setShowSeabed} />
            <Toggle label="Pipelines" value={showPipelines} onToggle={setShowPipelines} />
            <Toggle label="Restricted Areas" value={showRestrictedAreas} onToggle={setShowRestrictedAreas} />
            <Toggle label="Caution Areas" value={showCautionAreas} onToggle={setShowCautionAreas} />
            <Toggle label="Military Areas" value={showMilitaryAreas} onToggle={setShowMilitaryAreas} />
            <Toggle label="Anchorages" value={showAnchorages} onToggle={setShowAnchorages} />
            <Toggle label="Anchor Berths" value={showAnchorBerths} onToggle={setShowAnchorBerths} />
            <Toggle label="Marine Farms" value={showMarineFarms} onToggle={setShowMarineFarms} />
          </ScrollView>
          <TouchableOpacity style={styles.closeBtn} onPress={() => setShowControls(false)}>
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Feature Inspector */}
      {selectedFeature && (
        <View style={styles.inspector}>
          <View style={styles.inspectorHeader}>
            <View style={styles.inspectorTitleRow}>
              <Text style={styles.inspectorType}>{selectedFeature.type}</Text>
              <Text style={styles.inspectorId}>{getFeatureId(selectedFeature)}</Text>
            </View>
            <TouchableOpacity onPress={() => setSelectedFeature(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.inspectorClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.inspectorContent}>
            {Object.entries(formatFeatureProperties(selectedFeature)).map(([key, value]) => (
              <View key={key} style={styles.inspectorRow}>
                <Text style={styles.inspectorKey}>{key}</Text>
                <Text style={styles.inspectorValue}>{String(value)}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
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

// Toggle component
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
  zoomText: { fontSize: 12, color: '#fff', fontWeight: '500' },
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
});

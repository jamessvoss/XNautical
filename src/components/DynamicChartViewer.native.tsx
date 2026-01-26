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

export default function DynamicChartViewer({ onNavigateToDownloads }: Props = {}) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<Mapbox.MapView>(null);
  const cameraRef = useRef<Mapbox.Camera>(null);

  // Loaded chart data
  const [loading, setLoading] = useState(true);
  const [charts, setCharts] = useState<LoadedChartData[]>([]);
  const [mbtilesCharts, setMbtilesCharts] = useState<LoadedMBTilesChart[]>([]);
  const [tileServerReady, setTileServerReady] = useState(false);
  
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
  
  // UI state
  const [currentZoom, setCurrentZoom] = useState(10);
  const [selectedFeature, setSelectedFeature] = useState<FeatureInfo | null>(null);
  const [showControls, setShowControls] = useState(false);

  // Debug state
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [showDebug, setShowDebug] = useState(false);
  
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
  

  const loadCharts = async () => {
    try {
      setLoading(true);
      await chartCacheService.initializeCache();
      
      // HARDCODED TEST CHARTS - scan mbtiles directory directly
      const FileSystem = require('expo-file-system/legacy');
      const mbtilesDir = `${FileSystem.documentDirectory}mbtiles`;
      
      // Ensure directory exists
      const dirInfo = await FileSystem.getInfoAsync(mbtilesDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(mbtilesDir, { intermediates: true });
      }
      
      // Scan for any .mbtiles files in the directory
      let filesInDir: string[] = [];
      try {
        filesInDir = await FileSystem.readDirectoryAsync(mbtilesDir);
        console.log('Files in mbtiles directory:', filesInDir);
      } catch (e) {
        console.log('Could not read mbtiles directory:', e);
      }
      
      // Load any .mbtiles files found
      const loadedMbtiles: LoadedMBTilesChart[] = [];
      for (const filename of filesInDir) {
        if (filename.endsWith('.mbtiles')) {
          const chartId = filename.replace('.mbtiles', '');
          const path = `${mbtilesDir}/${filename}`;
          console.log(`Found MBTiles file: ${chartId} at ${path}`);
          loadedMbtiles.push({ chartId, path });
        }
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
      setMbtilesCharts(loadedMbtiles);
      
      // Start tile server if we have MBTiles charts
      if (loadedMbtiles.length > 0) {
        console.log('Starting local tile server...');
        const serverUrl = await tileServer.startTileServer();
        if (serverUrl) {
          console.log('Tile server started at:', serverUrl);
          // Pre-load databases for faster tile serving
          await tileServer.preloadDatabases(loadedMbtiles.map(m => m.chartId));
          setTileServerReady(true);
          
          // Set debug info
          const tileUrls = loadedMbtiles.map(m => tileServer.getTileUrlTemplate(m.chartId));
          setDebugInfo(`Server: ${serverUrl}\nMBTiles: ${loadedMbtiles.map(m => m.chartId).join(', ')}\nDir: ${mbtilesDir}\nURLs:\n${tileUrls.join('\n')}`);
        } else {
          console.warn('Failed to start tile server');
          setDebugInfo(`Failed to start tile server\nDir: ${mbtilesDir}`);
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
    } catch (error) {
      console.error('Error loading charts:', error);
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
        styleURL={Mapbox.StyleURL.Light}
        onMapIdle={handleMapIdle}
        scaleBarEnabled={true}
        scaleBarPosition={{ bottom: 16, right: 70 }}
      >
        <Mapbox.Camera
          ref={cameraRef}
          defaultSettings={{
            zoomLevel: 10,
            centerCoordinate: [-151.55, 59.64],  // HARDCODED: Homer, Alaska
          }}
        />

        <Mapbox.Images images={NAV_SYMBOLS} />

        {/* MBTiles Vector Sources - NO FILTERING, SHOW EVERYTHING */}
        {useMBTiles && tileServerReady && mbtilesCharts.map((chart) => {
          const tileUrl = tileServer.getTileUrlTemplate(chart.chartId);
          return (
          <Mapbox.VectorSource
            key={`mbtiles-src-${chart.chartId}-${cacheBuster}`}
            id={`mbtiles-src-${chart.chartId}`}
            tileUrlTemplates={[tileUrl]}
          >
            {/* M_COVR is chart coverage metadata - hide it (no fill or outline needed) */}
            
            {/* DEPARE - Depth Areas with proper depth-based coloring */}
            {/* DRVAL1 = shallow depth of area, used for coloring */}
            <Mapbox.FillLayer
              id={`mbtiles-depare-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['==', ['get', '_layer'], 'DEPARE']}
              style={{
                fillColor: [
                  'step',
                  ['get', 'DRVAL1'],
                  // Drying/intertidal (below 0m) - tan/green tint
                  '#C8D6A3',
                  0,
                  // 0-2m - very light blue (danger zone)
                  '#B5E3F0',
                  2,
                  // 2-5m - light blue
                  '#9DD5E8',
                  5,
                  // 5-10m - medium light blue
                  '#7EC8E3',
                  10,
                  // 10-20m - medium blue
                  '#5BB4D6',
                  20,
                  // 20-50m - darker blue
                  '#3A9FC9',
                  50,
                  // 50m+ - deep blue
                  '#2185B5',
                ],
                fillOpacity: 0.7,
                visibility: showDepthAreas ? 'visible' : 'none',
              }}
            />
            
            {/* DRGARE - Dredged Areas (maintained channels with specific depths) */}
            <Mapbox.FillLayer
              id={`mbtiles-drgare-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['==', ['get', '_layer'], 'DRGARE']}
              style={{
                fillColor: '#87CEEB',  // Light sky blue for dredged areas
                fillOpacity: 0.4,
              }}
            />
            <Mapbox.LineLayer
              id={`mbtiles-drgare-outline-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['==', ['get', '_layer'], 'DRGARE']}
              style={{
                lineColor: '#4682B4',  // Steel blue outline
                lineWidth: 1.5,
                lineDasharray: [4, 2],  // Dashed line for dredged areas
              }}
            />
            
            {/* FAIRWY - Fairways (navigation channels) */}
            <Mapbox.FillLayer
              id={`mbtiles-fairwy-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['==', ['get', '_layer'], 'FAIRWY']}
              style={{
                fillColor: '#E6E6FA',  // Light lavender/purple tint
                fillOpacity: 0.3,
              }}
            />
            <Mapbox.LineLayer
              id={`mbtiles-fairwy-outline-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['==', ['get', '_layer'], 'FAIRWY']}
              style={{
                lineColor: '#9370DB',  // Medium purple
                lineWidth: 2,
                lineDasharray: [8, 4],  // Longer dashes for fairways
              }}
            />
            
            {/* DEPCNT - Depth Contours (isobath lines) */}
            {/* VALDCO = value of depth contour in meters */}
            <Mapbox.LineLayer
              id={`mbtiles-depcnt-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['==', ['get', '_layer'], 'DEPCNT']}
              style={{
                lineColor: [
                  'step',
                  ['coalesce', ['get', 'VALDCO'], 0],
                  // 0m (drying line) - black, prominent
                  '#000000',
                  0.1,
                  // 0-2m - dark blue (danger zone)
                  '#1E3A5F',
                  2,
                  // 2-5m - medium dark blue
                  '#2E5984',
                  5,
                  // 5-10m - medium blue
                  '#4A7BA7',
                  10,
                  // 10-20m - lighter blue
                  '#6B9BC3',
                  20,
                  // 20-50m - light blue
                  '#8FBCD9',
                  50,
                  // 50m+ - very light blue
                  '#B0D4E8',
                ],
                lineWidth: [
                  'step',
                  ['coalesce', ['get', 'VALDCO'], 0],
                  // 0m (drying line) - thickest
                  2.0,
                  0.1,
                  // Shallow contours - medium thick
                  1.5,
                  5,
                  // Medium depth - normal
                  1.0,
                  20,
                  // Deep - thinner
                  0.7,
                  50,
                  // Very deep - thinnest
                  0.5,
                ],
                lineCap: 'round',
                lineJoin: 'round',
                visibility: showDepthContours ? 'visible' : 'none',
              }}
            />
            
            {/* DEPCNT Labels - Show depth values on contour lines */}
            <Mapbox.SymbolLayer
              id={`mbtiles-depcnt-labels-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['==', ['get', '_layer'], 'DEPCNT']}
              minZoomLevel={12}
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
            
            {/* ALL LINES - cyan/teal debug layer (disabled - proper layers now hooked up)
            <Mapbox.LineLayer
              id={`mbtiles-lines-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['all',
                ['has', '_layer'],
                // Exclude layers we've already styled
                ['!=', ['get', '_layer'], 'DEPCNT'],
                // Exclude ALL meta layers (any layer starting with 'M_')
                ['!=', ['slice', ['get', '_layer'], 0, 2], 'M_'],
              ]}
              style={{
                lineColor: '#00CED1',
                lineWidth: 1.5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            */}
            
            {/* Soundings - depth numbers */}
            <Mapbox.SymbolLayer
              id={`mbtiles-soundg-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              minZoomLevel={0}
              maxZoomLevel={22}
              filter={['==', ['get', '_layer'], 'SOUNDG']}
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
            
            {/* Navigation Lights - S-52 symbol based on COLOUR */}
            {/* S-57 COLOUR: 1=white, 3=RED, 4=GREEN, 6=yellow */}
            {/* _ORIENT: calculated orientation in degrees for symbol rotation */}
            <Mapbox.SymbolLayer
              id={`mbtiles-lights-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['==', ['get', '_layer'], 'LIGHTS']}
              minZoomLevel={0}
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
                // Scale icons based on zoom: smaller when zoomed out, larger when zoomed in
                iconSize: [
                  'interpolate', ['linear'], ['zoom'],
                  8, 0.3,    // Small at zoom 8
                  12, 0.5,   // Medium at zoom 12
                  16, 0.8    // Full size at zoom 16+
                ],
                // Rotate symbol based on _ORIENT (calculated from sector midpoint or ORIENT attr)
                // _ORIENT is degrees clockwise from north (direction the flare points)
                // Symbol flare points UP (0°) by default, light source is at bottom
                iconRotate: ['coalesce', ['get', '_ORIENT'], 135],
                iconRotationAlignment: 'map',  // Keep rotation fixed relative to map (not viewport)
                iconAnchor: 'bottom',  // Anchor at the light source (narrow point of teardrop)
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
                visibility: showLights ? 'visible' : 'none',
              }}
            />
            
            {/* All Buoys - S-52 symbols based on BOYSHP (buoy shape) */}
            {/* BOYSHP: 1=conical, 2=can, 3=spherical, 4=pillar, 5=spar, 6=barrel, 7=super-buoy */}
            <Mapbox.SymbolLayer
              id={`mbtiles-buoys-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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
            
            {/* Seabed Areas (SBDARE) - Bottom composition - TEXT ONLY per S-52 */}
            {/* NATSUR codes: 1=Mud, 2=Clay, 3=Silt, 4=Sand, 5=Stone, 6=Gravel, 7=Pebbles, */}
            {/*              8=Cobbles, 9=Rock, 11=Coral, 14=Shells */}
            {/* S-52 shows just the abbreviation text, no symbol dot */}
            <Mapbox.SymbolLayer
              id={`mbtiles-sbdare-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['all',
                ['==', ['get', '_layer'], 'SBDARE'],
                ['==', ['geometry-type'], 'Point'],
                ['has', 'NATSUR']
              ]}
              style={{
                textField: [
                  'case',
                  ['in', '11', ['to-string', ['get', 'NATSUR']]], 'Co',  // Coral
                  ['in', '14', ['to-string', ['get', 'NATSUR']]], 'Sh',  // Shells
                  ['in', '"1"', ['to-string', ['get', 'NATSUR']]], 'M',   // Mud
                  ['in', '"2"', ['to-string', ['get', 'NATSUR']]], 'Cy',  // Clay
                  ['in', '"3"', ['to-string', ['get', 'NATSUR']]], 'Si',  // Silt
                  ['in', '"4"', ['to-string', ['get', 'NATSUR']]], 'S',   // Sand
                  ['in', '"5"', ['to-string', ['get', 'NATSUR']]], 'St',  // Stone
                  ['in', '"6"', ['to-string', ['get', 'NATSUR']]], 'G',   // Gravel
                  ['in', '"7"', ['to-string', ['get', 'NATSUR']]], 'P',   // Pebbles
                  ['in', '"8"', ['to-string', ['get', 'NATSUR']]], 'Cb',  // Cobbles
                  ['in', '"9"', ['to-string', ['get', 'NATSUR']]], 'R',   // Rock
                  '',
                ],
                textSize: 10,
                textColor: '#6B4423',  // Brown color per S-52 for seabed
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1.5,
                textFont: ['Open Sans Italic'],  // Italic per S-52 convention
                textAllowOverlap: false,
                visibility: showSeabed ? 'visible' : 'none',
              }}
            />
            
            {/* WRECKS - S-52 symbols based on WATLEV and CATWRK */}
            {/* WATLEV: 1=partly submerged, 2=always dry, 3=always underwater, 4=covers/uncovers, 5=awash */}
            {/* CATWRK: 1=non-dangerous, 2=dangerous, 3=distributed, 4=mast showing, 5=hull showing */}
            <Mapbox.SymbolLayer
              id={`mbtiles-wrecks-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['all',
                ['==', ['get', '_layer'], 'WRECKS'],
                ['==', ['geometry-type'], 'Point']
              ]}
              style={{
                iconImage: [
                  'case',
                  // Hull showing
                  ['==', ['get', 'CATWRK'], 5], 'wreck-hull',
                  // Dangerous or awash
                  ['any',
                    ['==', ['get', 'CATWRK'], 2],
                    ['==', ['get', 'WATLEV'], 5]
                  ], 'wreck-danger',
                  // Covers/uncovers
                  ['==', ['get', 'WATLEV'], 4], 'wreck-uncovers',
                  // Safe (non-dangerous)
                  ['==', ['get', 'CATWRK'], 1], 'wreck-safe',
                  // Submerged (default for underwater)
                  ['==', ['get', 'WATLEV'], 3], 'wreck-submerged',
                  // Default
                  'wreck-danger',
                ],
                iconSize: [
                  'interpolate', ['linear'], ['zoom'],
                  8, 0.25,   // Small at zoom 8
                  12, 0.45,  // Medium at zoom 12
                  16, 0.7    // Full size at zoom 16+
                ],
                iconAllowOverlap: true,
                visibility: showHazards ? 'visible' : 'none',
              }}
            />
            
            {/* UWTROC - Underwater Rocks - S-52 symbols based on WATLEV */}
            {/* WATLEV: 3=always underwater (most dangerous), 4=covers/uncovers, 5=awash */}
            <Mapbox.SymbolLayer
              id={`mbtiles-uwtroc-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['all',
                ['==', ['get', '_layer'], 'UWTROC'],
                ['==', ['geometry-type'], 'Point']
              ]}
              style={{
                iconImage: [
                  'case',
                  // Awash
                  ['==', ['get', 'WATLEV'], 5], 'rock-awash',
                  // Covers and uncovers
                  ['==', ['get', 'WATLEV'], 4], 'rock-uncovers',
                  // Always submerged (default)
                  'rock-submerged',
                ],
                iconSize: [
                  'interpolate', ['linear'], ['zoom'],
                  8, 0.25,   // Small at zoom 8
                  12, 0.45,  // Medium at zoom 12
                  16, 0.7    // Full size at zoom 16+
                ],
                iconAllowOverlap: true,
                visibility: showHazards ? 'visible' : 'none',
              }}
            />
            <Mapbox.SymbolLayer
              id={`mbtiles-uwtroc-label-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['all',
                ['==', ['get', '_layer'], 'UWTROC'],
                ['==', ['geometry-type'], 'Point'],
                ['has', 'VALSOU']
              ]}
              minZoomLevel={12}
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
            
            {/* OBSTRN - Obstructions - S-52 symbols */}
            {/* CATOBS: 1=snag, 2=wellhead, 3=diffuser, 4=crib, 5=fish haven, 6=foul area, 7=foul ground */}
            <Mapbox.SymbolLayer
              id={`mbtiles-obstrn-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['all',
                ['==', ['get', '_layer'], 'OBSTRN'],
                ['==', ['geometry-type'], 'Point']
              ]}
              style={{
                iconImage: [
                  'case',
                  // Foul area/ground
                  ['any',
                    ['==', ['get', 'CATOBS'], 6],
                    ['==', ['get', 'CATOBS'], 7]
                  ], 'foul-ground',
                  // Default obstruction
                  'obstruction',
                ],
                iconSize: [
                  'interpolate', ['linear'], ['zoom'],
                  8, 0.25,   // Small at zoom 8
                  12, 0.45,  // Medium at zoom 12
                  16, 0.7    // Full size at zoom 16+
                ],
                iconAllowOverlap: true,
                visibility: showHazards ? 'visible' : 'none',
              }}
            />
            
            {/* CBLSUB - Submarine Cables (lines) */}
            {/* CATCBL: 1=power, 2=telephone/telegraph, 3=transmission, 4=telephone, 5=telegraph, 6=mooring */}
            <Mapbox.LineLayer
              id={`mbtiles-cblsub-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['==', ['get', '_layer'], 'CBLSUB']}
              style={{
                lineColor: '#800080',  // Purple for cables
                lineWidth: 2,
                lineDasharray: [4, 2],  // Dashed line per S-52
                lineCap: 'round',
                visibility: showCables ? 'visible' : 'none',
              }}
            />
            <Mapbox.SymbolLayer
              id={`mbtiles-cblsub-label-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['==', ['get', '_layer'], 'CBLSUB']}
              minZoomLevel={12}
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
            
            {/* CBLARE - Cable Areas (polygons) */}
            <Mapbox.FillLayer
              id={`mbtiles-cblare-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['==', ['get', '_layer'], 'CBLARE']}
              style={{
                fillColor: '#800080',
                fillOpacity: 0.15,
                visibility: showCables ? 'visible' : 'none',
              }}
            />
            <Mapbox.LineLayer
              id={`mbtiles-cblare-outline-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['==', ['get', '_layer'], 'CBLARE']}
              style={{
                lineColor: '#800080',
                lineWidth: 1.5,
                lineDasharray: [4, 2],
                visibility: showCables ? 'visible' : 'none',
              }}
            />
            
            {/* PIPSOL - Pipelines, submarine/on land (lines) */}
            {/* CATPIP: 1=oil, 2=gas, 3=water, 4=sewage, 5=bubbler, 6=supply */}
            <Mapbox.LineLayer
              id={`mbtiles-pipsol-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['==', ['get', '_layer'], 'PIPSOL']}
              style={{
                lineColor: '#008000',  // Green for pipelines
                lineWidth: 2.5,
                lineDasharray: [6, 3],  // Different dash pattern than cables
                lineCap: 'round',
                visibility: showPipelines ? 'visible' : 'none',
              }}
            />
            <Mapbox.SymbolLayer
              id={`mbtiles-pipsol-label-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['==', ['get', '_layer'], 'PIPSOL']}
              minZoomLevel={12}
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
            
            {/* PIPARE - Pipeline Areas (polygons) */}
            <Mapbox.FillLayer
              id={`mbtiles-pipare-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['==', ['get', '_layer'], 'PIPARE']}
              style={{
                fillColor: '#008000',
                fillOpacity: 0.15,
                visibility: showPipelines ? 'visible' : 'none',
              }}
            />
            <Mapbox.LineLayer
              id={`mbtiles-pipare-outline-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['==', ['get', '_layer'], 'PIPARE']}
              style={{
                lineColor: '#008000',
                lineWidth: 1.5,
                lineDasharray: [6, 3],
                visibility: showPipelines ? 'visible' : 'none',
              }}
            />
            
            {/* LNDARE - Land Areas (polygons) */}
            <Mapbox.FillLayer
              id={`mbtiles-lndare-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['==', ['get', '_layer'], 'LNDARE']}
              style={{
                fillColor: '#F5DEB3',  // Wheat/tan color for land
                fillOpacity: 1,
                visibility: showLand ? 'visible' : 'none',
              }}
            />
            <Mapbox.LineLayer
              id={`mbtiles-lndare-outline-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['==', ['get', '_layer'], 'LNDARE']}
              style={{
                lineColor: '#8B7355',  // Darker tan for outline
                lineWidth: 1,
                visibility: showLand ? 'visible' : 'none',
              }}
            />
            
            {/* COALNE - Coastline (lines) */}
            <Mapbox.LineLayer
              id={`mbtiles-coalne-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              filter={['==', ['get', '_layer'], 'COALNE']}
              style={{
                lineColor: '#000000',  // Black coastline
                lineWidth: 1.5,
                lineCap: 'round',
                lineJoin: 'round',
                visibility: showCoastline ? 'visible' : 'none',
              }}
            />
            
            {/* Light Sectors - Directional arc showing where light is visible */}
            {/* Placed AFTER land/coastline so arc renders on top */}
            {/* S-57 COLOUR: 1=white, 3=RED, 4=GREEN, 6=yellow, 11=orange */}
            
            {/* Black outline for ALL sector arcs (provides contrast, esp for white/yellow) */}
            <Mapbox.LineLayer
              id={`mbtiles-lights-sector-outline-${chart.chartId}`}
              sourceLayerID={chart.chartId}
              minZoomLevel={0}
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
              minZoomLevel={0}
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
            
            {/* LNDMRK - Landmarks - S-52 symbols based on CATLMK */}
            {/* CATLMK: 1=cairn, 2=cemetery, 3=chimney, 4=dish aerial, 5=flagstaff, 6=flare stack, */}
            {/*         7=mast, 8=windsock, 9=monument, 10=column, 11=memorial plaque, 12=obelisk, */}
            {/*         13=statue, 14=cross, 15=dome, 16=radar scanner, 17=tower, 18=windmill, */}
            {/*         19=windmotor, 20=spire/minaret, 21=large rock/boulder */}
            <Mapbox.SymbolLayer
              id={`mbtiles-lndmrk-${chart.chartId}`}
              sourceLayerID={chart.chartId}
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

      {/* Debug button */}
      <TouchableOpacity 
        style={[styles.debugBtn, { top: insets.top + 12, left: 12 }]}
        onPress={() => setShowDebug(!showDebug)}
      >
        <Text style={styles.debugBtnText}>🔧</Text>
      </TouchableOpacity>

      {/* Debug Info Panel */}
      {showDebug && (
        <View style={[styles.debugPanel, { top: insets.top + 56 }]}>
          <Text style={styles.debugTitle}>Data Source Toggles</Text>
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
          <Text style={styles.debugText}>
            Server: {tileServerReady ? '✅ Running' : '❌ Not running'}
          </Text>
          <Text style={styles.debugInfo} selectable>{debugInfo}</Text>
          <View style={styles.debugDivider} />
          <TouchableOpacity 
            style={styles.debugActionBtn}
            onPress={async () => {
              // Stop tile server (closes all database connections)
              await tileServer.stopTileServer();
              // Clear MBTiles state
              setMbtilesCharts([]);
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
      )}

      {/* Zoom indicator - bottom right, aligned with scale bar */}
      <View style={[styles.zoomBadge, { bottom: 16, right: 12 }]}>
        <Text style={styles.zoomText}>{currentZoom.toFixed(1)}x</Text>
      </View>

      {/* Layer Controls */}
      {showControls && (
        <View style={[styles.controls, { top: insets.top + 56 }]}>
          <ScrollView style={styles.controlsScroll}>
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
  switch (feature.type) {
    case 'Light':
      return formatLightInfo(feature.properties);
    case 'Buoy':
      return formatBuoyInfo(feature.properties);
    case 'Beacon':
      return formatBeaconInfo(feature.properties);
    case 'Landmark':
      return formatLandmarkInfo(feature.properties);
    case 'Seabed':
      return formatSeabedInfo(feature.properties);
    case 'Cable Area':
    case 'Submarine Cable':
      return formatCableInfo(feature.properties);
    default:
      // Show raw properties for other types
      const formatted: Record<string, string> = {};
      for (const [key, value] of Object.entries(feature.properties)) {
        if (key.startsWith('_')) continue; // Skip internal props
        formatted[key] = String(value);
      }
      return formatted;
  }
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
    left: 12,
    right: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderRadius: 8,
    padding: 12,
    maxHeight: 300,
  },
  debugTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  debugText: {
    color: '#ddd',
    fontSize: 12,
    marginBottom: 4,
  },
  debugInfo: {
    color: '#88ff88',
    fontSize: 10,
    marginTop: 8,
  },
  debugDivider: {
    height: 1,
    backgroundColor: '#444',
    marginVertical: 8,
  },
  debugToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  debugToggle: {
    flex: 1,
    backgroundColor: '#333',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#333',
  },
  debugToggleActive: {
    backgroundColor: '#28a745',
    borderColor: '#28a745',
  },
  debugToggleText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  debugToggleTextActive: {
    color: '#fff',
  },
  debugActionBtn: {
    backgroundColor: '#007AFF',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginBottom: 8,
    alignItems: 'center',
  },
  debugActionBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  debugCloseBtn: {
    marginTop: 4,
    alignItems: 'center',
  },
  debugCloseBtnText: {
    color: '#888',
    fontSize: 14,
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
    maxHeight: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  controlsScroll: { maxHeight: 240 },
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
});

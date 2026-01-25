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

export default function DynamicChartViewer({ onNavigateToDownloads }: Props = {}) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<Mapbox.MapView>(null);
  const cameraRef = useRef<Mapbox.Camera>(null);

  // Loaded chart data
  const [loading, setLoading] = useState(true);
  const [charts, setCharts] = useState<LoadedChartData[]>([]);
  
  // Layer toggles
  const [showDepthAreas, setShowDepthAreas] = useState(true);
  const [showDepthContours, setShowDepthContours] = useState(true);
  const [showSoundings, setShowSoundings] = useState(true);
  const [showLand, setShowLand] = useState(true);
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

  // Load cached charts
  useEffect(() => {
    loadCharts();
  }, []);

  const loadCharts = async () => {
    try {
      setLoading(true);
      await chartCacheService.initializeCache();
      
      const downloadedIds = await chartCacheService.getDownloadedChartIds();
      console.log('Downloaded chart IDs:', downloadedIds);
      
      if (downloadedIds.length === 0) {
        console.log('No charts downloaded');
        setLoading(false);
        return;
      }
      
      const loadedCharts: LoadedChartData[] = [];
      
      for (const chartId of downloadedIds) {
        console.log(`Loading chart: ${chartId}`);
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
      
      console.log(`Total charts loaded: ${loadedCharts.length}`);
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

  // Calculate initial center from loaded charts
  const initialCenter = useMemo(() => {
    if (charts.length === 0) {
      console.log('No charts, using default center');
      return [-152, 61] as [number, number];
    }
    
    // Try to find center from first chart's features
    const firstChart = charts[0];
    console.log('Finding center from chart:', firstChart.chartId);
    
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
        console.log('Calculated center:', center);
        return center;
      }
    }
    
    // Fallback: try to use any Point feature
    for (const [type, data] of Object.entries(firstChart.features)) {
      if (data?.features?.[0]?.geometry) {
        const geom = data.features[0].geometry as any;
        if (geom.type === 'Point' && geom.coordinates) {
          console.log(`Using ${type} point as center:`, geom.coordinates);
          return geom.coordinates as [number, number];
        }
      }
    }
    
    console.log('Could not calculate center, using default');
    return [-152, 61] as [number, number];
  }, [charts]);

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

  if (charts.length === 0) {
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
          zoomLevel={10}
          centerCoordinate={initialCenter}
        />

        <Mapbox.Images images={NAV_SYMBOLS} />

        {/* Land Areas */}
        {showLand && lndarePolygons && (
          <Mapbox.ShapeSource id="lndare" shape={lndarePolygons}>
            <Mapbox.FillLayer
              id="lndare-fill"
              style={{
                fillColor: '#F5DEB3',
                fillOpacity: 1,
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Depth Areas */}
        {showDepthAreas && deparePolygons && (
          <Mapbox.ShapeSource id="depare" shape={deparePolygons}>
            <Mapbox.FillLayer
              id="depare-fill"
              style={{
                fillColor: [
                  'case',
                  ['<', ['coalesce', ['get', 'DRVAL1'], 0], 2], DEPTH_COLORS.veryShallow,
                  ['<', ['coalesce', ['get', 'DRVAL1'], 0], 5], DEPTH_COLORS.shallow,
                  ['<', ['coalesce', ['get', 'DRVAL1'], 0], 10], DEPTH_COLORS.medium,
                  ['<', ['coalesce', ['get', 'DRVAL1'], 0], 20], DEPTH_COLORS.deep,
                  ['<', ['coalesce', ['get', 'DRVAL1'], 0], 30], DEPTH_COLORS.deeper,
                  ['<', ['coalesce', ['get', 'DRVAL1'], 0], 50], DEPTH_COLORS.veryDeep,
                  ['<', ['coalesce', ['get', 'DRVAL1'], 0], 100], DEPTH_COLORS.ultraDeep,
                  DEPTH_COLORS.abyssal,
                ],
                fillOpacity: 0.9,
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Depth Contours */}
        {showDepthContours && combinedFeatures.depcnt && (
          <Mapbox.ShapeSource id="depcnt" shape={combinedFeatures.depcnt}>
            <Mapbox.LineLayer
              id="depcnt-line"
              style={{
                lineColor: '#4169E1',
                lineWidth: 0.5,
                lineOpacity: 0.7,
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Soundings - sparse at zoom 8-10, all at zoom 10+ */}
        {showSoundings && combinedFeatures.soundg && currentZoom >= 8 && (
          <Mapbox.ShapeSource id="soundg" shape={combinedFeatures.soundg}>
            {/* Sparse soundings at zoom 8-10 (~30% using modulo on RCID) */}
            <Mapbox.SymbolLayer
              id="soundg-text-sparse"
              filter={['==', ['%', ['get', 'RCID'], 3], 0]}
              maxZoomLevel={10}
              style={{
                textField: ['to-string', ['round', ['get', 'DEPTH']]],
                textSize: 8,
                textColor: '#000080',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1,
                textAllowOverlap: false,
              }}
            />
            {/* All soundings at zoom 10+ */}
            <Mapbox.SymbolLayer
              id="soundg-text-full"
              minZoomLevel={10}
              style={{
                textField: ['to-string', ['round', ['get', 'DEPTH']]],
                textSize: 9,
                textColor: '#000080',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1,
                textAllowOverlap: false,
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Cable Areas (Polygons) - restricted zones */}
        {showCables && combinedFeatures.cblare && (
          <Mapbox.ShapeSource 
            id="cblare-poly" 
            shape={combinedFeatures.cblare}
            onPress={handleFeaturePress('Cable Area')}
          >
            <Mapbox.FillLayer
              id="cblare-fill"
              filter={['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']]}
              style={{
                fillColor: '#FF00FF',
                fillOpacity: 0.1,
              }}
            />
            <Mapbox.LineLayer
              id="cblare-outline"
              filter={['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']]}
              style={{
                lineColor: '#FF00FF',
                lineWidth: 2,
                lineDasharray: [8, 4],
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Submarine Cable Lines - actual cable routes */}
        {showCables && combinedFeatures.cblare && (
          <Mapbox.ShapeSource 
            id="cblare-lines" 
            shape={combinedFeatures.cblare}
            onPress={handleFeaturePress('Submarine Cable')}
            hitbox={{ width: 10, height: 10 }}
          >
            <Mapbox.LineLayer
              id="cblare-line"
              filter={['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']]}
              style={{
                lineColor: '#FF00FF',
                lineWidth: 2,
                lineDasharray: [8, 4],
                lineOpacity: 0.9,
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Seabed Areas - Bottom composition (mud, sand, rock, etc.) */}
        {showSeabed && combinedFeatures.sbdare && (
          <Mapbox.ShapeSource
            id="sbdare"
            shape={combinedFeatures.sbdare}
            onPress={handleFeaturePress('Seabed')}
          >
            <Mapbox.FillLayer
              id="sbdare-fill"
              filter={['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']]}
              style={{
                fillColor: [
                  'match',
                  ['to-string', ['at', 0, ['get', 'NATSUR']]],
                  '1', 'rgba(107, 142, 107, 0.3)',   // Mud - greenish
                  '2', 'rgba(128, 128, 128, 0.3)',   // Clay - grey
                  '3', 'rgba(169, 169, 169, 0.3)',   // Silt - dark grey
                  '4', 'rgba(218, 165, 32, 0.3)',    // Sand - golden
                  '5', 'rgba(139, 69, 19, 0.3)',     // Stone - brown
                  '6', 'rgba(210, 180, 140, 0.3)',   // Gravel - tan
                  '7', 'rgba(188, 143, 143, 0.3)',   // Pebbles - rosy brown
                  '8', 'rgba(160, 82, 45, 0.3)',     // Cobbles - sienna
                  '9', 'rgba(139, 0, 0, 0.3)',       // Rock - dark red
                  '11', 'rgba(255, 105, 180, 0.3)', // Coral - pink
                  '14', 'rgba(153, 50, 204, 0.3)',  // Shells - purple
                  'rgba(136, 136, 136, 0.2)',       // Default
                ],
                fillOutlineColor: [
                  'match',
                  ['to-string', ['at', 0, ['get', 'NATSUR']]],
                  '1', '#6B8E6B', '2', '#808080', '3', '#A9A9A9', '4', '#DAA520',
                  '5', '#8B4513', '6', '#D2B48C', '7', '#BC8F8F', '8', '#A0522D',
                  '9', '#8B0000', '11', '#FF69B4', '14', '#9932CC',
                  '#888888',
                ],
              }}
            />
            <Mapbox.SymbolLayer
              id="sbdare-labels"
              filter={['==', ['geometry-type'], 'Point']}
              minZoomLevel={11}
              style={{
                textField: [
                  'match',
                  ['to-string', ['at', 0, ['get', 'NATSUR']]],
                  '1', 'M', '2', 'Cy', '3', 'Si', '4', 'S', '5', 'St',
                  '6', 'G', '7', 'P', '8', 'Cb', '9', 'Rk', '10', 'Lv',
                  '11', 'Co', '12', 'Sh', '13', 'Bo', '14', 'V',
                  '?',
                ],
                textSize: 10,
                textColor: [
                  'match',
                  ['to-string', ['at', 0, ['get', 'NATSUR']]],
                  '1', '#6B8E6B', '2', '#808080', '3', '#A9A9A9', '4', '#DAA520',
                  '5', '#8B4513', '6', '#D2B48C', '7', '#BC8F8F', '8', '#A0522D',
                  '9', '#8B0000', '11', '#FF69B4', '14', '#9932CC',
                  '#888888',
                ],
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1,
                textFont: ['Open Sans Bold'],
                textAllowOverlap: false,
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Pipelines */}
        {showPipelines && combinedFeatures.pipsol && (
          <Mapbox.ShapeSource id="pipsol" shape={combinedFeatures.pipsol}>
            <Mapbox.LineLayer
              id="pipsol-line"
              style={{
                lineColor: '#800080',
                lineWidth: 2,
                lineDasharray: [6, 3],
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Shoreline Constructions */}
        {combinedFeatures.slcons && (
          <Mapbox.ShapeSource id="slcons" shape={combinedFeatures.slcons}>
            <Mapbox.LineLayer
              id="slcons-line"
              style={{
                lineColor: '#8B4513',
                lineWidth: 2,
              }}
            />
            <Mapbox.FillLayer
              id="slcons-fill"
              filter={['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']]}
              style={{
                fillColor: '#D2B48C',
                fillOpacity: 0.6,
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Wrecks */}
        {showHazards && combinedFeatures.wrecks && (
          <Mapbox.ShapeSource
            id="wrecks"
            shape={combinedFeatures.wrecks}
            onPress={handleFeaturePress('Wreck')}
          >
            <Mapbox.SymbolLayer
              id="wrecks-symbol"
              style={{
                iconImage: 'wreck-danger',
                iconSize: 0.5,
                iconAllowOverlap: true,
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Rocks */}
        {showHazards && combinedFeatures.uwtroc && (
          <Mapbox.ShapeSource
            id="uwtroc"
            shape={combinedFeatures.uwtroc}
            onPress={handleFeaturePress('Rock')}
          >
            <Mapbox.SymbolLayer
              id="uwtroc-symbol"
              style={{
                iconImage: 'rock-submerged',
                iconSize: 0.4,
                iconAllowOverlap: true,
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Obstructions */}
        {showHazards && combinedFeatures.obstrn && (
          <Mapbox.ShapeSource
            id="obstrn"
            shape={combinedFeatures.obstrn}
            onPress={handleFeaturePress('Obstruction')}
          >
            <Mapbox.SymbolLayer
              id="obstrn-symbol"
              style={{
                iconImage: 'obstruction',
                iconSize: 0.4,
                iconAllowOverlap: true,
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Light Sectors */}
        {showSectors && sectorFeatures.features.length > 0 && (
          <Mapbox.ShapeSource id="sectors" shape={sectorFeatures}>
            {/* Black outline for white sectors (renders underneath) */}
            <Mapbox.LineLayer
              id="sectors-outline"
              filter={['==', ['get', 'colour'], '1']}
              style={{
                lineColor: '#000000',
                lineWidth: 3.5,
                lineOpacity: 0.7,
              }}
            />
            {/* Colored sector lines */}
            <Mapbox.LineLayer
              id="sectors-line"
              style={{
                lineColor: [
                  'match', ['get', 'colour'],
                  '1', '#FFFFFF', '3', '#FF0000', '4', '#00FF00',
                  '6', '#FFFF00', '11', '#FFA500',
                  '#FFFFFF',
                ],
                lineWidth: 2,
                lineOpacity: 0.9,
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Lights */}
        {showLights && combinedFeatures.lights && (
          <Mapbox.ShapeSource
            id="lights"
            shape={combinedFeatures.lights}
            onPress={handleFeaturePress('Light')}
            hitbox={{ width: 30, height: 30 }}
          >
            <Mapbox.SymbolLayer
              id="lights-symbol"
              style={{
                iconImage: 'light-major',
                iconSize: 0.4,
                iconAllowOverlap: true,
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Buoys */}
        {showBuoys && combinedFeatures.buoys && (
          <Mapbox.ShapeSource
            id="buoys"
            shape={combinedFeatures.buoys}
            onPress={handleFeaturePress('Buoy')}
            hitbox={{ width: 30, height: 30 }}
          >
            <Mapbox.SymbolLayer
              id="buoys-symbol"
              style={{
                iconImage: 'buoy-can',
                iconSize: 0.4,
                iconAllowOverlap: true,
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Beacons */}
        {showBeacons && combinedFeatures.beacons && (
          <Mapbox.ShapeSource
            id="beacons"
            shape={combinedFeatures.beacons}
            onPress={handleFeaturePress('Beacon')}
            hitbox={{ width: 30, height: 30 }}
          >
            <Mapbox.SymbolLayer
              id="beacons-symbol"
              style={{
                iconImage: 'beacon-generic',
                iconSize: 0.4,
                iconAllowOverlap: true,
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Landmarks - Towers, monuments, and other conspicuous structures */}
        {showLandmarks && combinedFeatures.landmarks && (
          <Mapbox.ShapeSource
            id="landmarks"
            shape={combinedFeatures.landmarks}
            onPress={handleFeaturePress('Landmark')}
            hitbox={{ width: 30, height: 30 }}
          >
            <Mapbox.SymbolLayer
              id="landmarks-symbol"
              style={{
                // Select icon based on CATLMK (category of landmark)
                iconImage: [
                  'match',
                  ['to-string', ['at', 0, ['get', 'CATLMK']]],
                  '17', 'landmark-tower',      // Tower
                  '3', 'landmark-chimney',     // Chimney
                  '9', 'landmark-monument',    // Monument
                  '10', 'landmark-monument',   // Column/pillar
                  '5', 'landmark-flagpole',    // Flagstaff
                  '7', 'landmark-mast',        // Mast
                  '18', 'landmark-windmill',   // Windmill
                  '19', 'landmark-windmill',   // Windmotor
                  '2', 'landmark-church',      // Cemetery (use church)
                  'landmark-tower',            // Default: tower
                ],
                iconSize: 0.5,
                iconAnchor: 'bottom',
                iconAllowOverlap: true,
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Sea Area Names */}
        {combinedFeatures.seaare && currentZoom >= 10 && (
          <Mapbox.ShapeSource id="seaare" shape={combinedFeatures.seaare}>
            <Mapbox.SymbolLayer
              id="seaare-label"
              style={{
                textField: ['get', 'OBJNAM'],
                textSize: 12,
                textColor: '#4169E1',
                textHaloColor: '#FFFFFF',
                textHaloWidth: 1,
                textFont: ['Open Sans Italic'],
              }}
            />
          </Mapbox.ShapeSource>
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

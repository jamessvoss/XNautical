/**
 * Offline Chart Viewer using React Native Mapbox
 * Uses GeoJSON data stored locally for true offline operation
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Platform,
  ScrollView,
} from 'react-native';
import Mapbox, { MapView } from '@rnmapbox/maps';

// Import GeoJSON data directly (bundled with the app)
// Original Homer chart (US5AK5SI)
const depareData_SI = require('../../assets/Maps/depare.json');
const depcntData_SI = require('../../assets/Maps/depcnt.json');
const soundgData_SI = require('../../assets/Maps/soundg.json');
const lndareData_SI = require('../../assets/Maps/lndare.json');

// Additional charts
const depareData_PH = require('../../assets/Maps/US4AK4PH_depare.json');
const depcntData_PH = require('../../assets/Maps/US4AK4PH_depcnt.json');
const soundgData_PH = require('../../assets/Maps/US4AK4PH_soundg.json');
const lndareData_PH = require('../../assets/Maps/US4AK4PH_lndare.json');

const depareData_QG = require('../../assets/Maps/US5AK5QG_depare.json');
const depcntData_QG = require('../../assets/Maps/US5AK5QG_depcnt.json');
const soundgData_QG = require('../../assets/Maps/US5AK5QG_soundg.json');
const lndareData_QG = require('../../assets/Maps/US5AK5QG_lndare.json');

const depareData_SJ = require('../../assets/Maps/US5AK5SJ_depare.json');
const depcntData_SJ = require('../../assets/Maps/US5AK5SJ_depcnt.json');
const soundgData_SJ = require('../../assets/Maps/US5AK5SJ_soundg.json');
const lndareData_SJ = require('../../assets/Maps/US5AK5SJ_lndare.json');

// Lights data for each chart
const lightsData_PH = require('../../assets/Maps/US4AK4PH_lights.json');
const lightsData_SI = require('../../assets/Maps/US5AK5SI_lights.json');
const lightsData_QG = require('../../assets/Maps/US5AK5QG_lights.json');
const lightsData_SJ = require('../../assets/Maps/US5AK5SJ_lights.json');

// S-52 Symbol images for navigation lights
// Metro automatically selects @2x/@3x based on device pixel density
const LIGHT_SYMBOLS = {
  'light-flare-white': require('../../assets/symbols/png/light-flare-white.png'),
  'light-flare-red': require('../../assets/symbols/png/light-flare-red.png'),
  'light-flare-green': require('../../assets/symbols/png/light-flare-green.png'),
  'light-flare-magenta': require('../../assets/symbols/png/light-flare-magenta.png'),
};

// Debug colors for each chart
const DEBUG_COLORS = {
  US4AK4PH: '#FF9800',  // Orange - Approach
  US5AK5SJ: '#9C27B0',  // Purple - Approach Detail
  US5AK5SI: '#4CAF50',  // Green - Homer Harbor
  US5AK5QG: '#F44336',  // Red - Seldovia Harbor
};

// Chart definitions with scale/usage bands
// Quilting: Charts are rendered in order from least to most detailed.
// More detailed charts overlay less detailed ones, creating a seamless "quilt"
const CHARTS = {
  US4AK4PH: {
    name: 'Approaches to Homer Harbor',
    shortName: 'Approach',
    center: [-151.4900, 59.6350],
    scaleType: 'approach',
    scale: 1,  // Least detailed - base layer, always visible
    minZoom: 0,
    scaminContour: 179999,  // SCAMIN for contours
    scaminSounding: 119999,  // SCAMIN for soundings
    // Bounding box: [minLon, minLat, maxLon, maxLat]
    bounds: [-151.8000, 59.4023, -151.2000, 59.7000],
    data: {
      depare: depareData_PH,
      depcnt: depcntData_PH,
      soundg: soundgData_PH,
      lndare: lndareData_PH,
      lights: lightsData_PH,
    },
  },
  US5AK5SJ: {
    name: 'Approaches to Homer Harbor (Detail)',
    shortName: 'Approach Detail',
    center: [-151.4900, 59.6350],
    scaleType: 'approach_detail',
    scale: 2,  // More detailed than approach
    minZoom: 11,  // Appears at zoom 11+
    scaminContour: 44999,
    scaminSounding: 29999,
    bounds: [-151.3500, 59.5558, -151.2000, 59.6250],
    data: {
      depare: depareData_SJ,
      depcnt: depcntData_SJ,
      soundg: soundgData_SJ,
      lndare: lndareData_SJ,
      lights: lightsData_SJ,
    },
  },
  US5AK5SI: {
    name: 'Homer Harbor',
    shortName: 'Homer',
    center: [-151.4900, 59.6350],
    scaleType: 'harbor',
    scale: 3,  // Most detailed - harbor scale
    minZoom: 12,  // Appears at zoom 12+
    scaminContour: 21999,
    scaminSounding: 17999,
    bounds: [-151.5000, 59.5500, -151.3500, 59.6250],
    data: {
      depare: depareData_SI,
      depcnt: depcntData_SI,
      soundg: soundgData_SI,
      lndare: lndareData_SI,
      lights: lightsData_SI,
    },
  },
  US5AK5QG: {
    name: 'Seldovia Harbor',
    shortName: 'Seldovia',
    center: [-151.4900, 59.6350],
    scaleType: 'harbor',
    scale: 3,  // Most detailed - harbor scale
    minZoom: 12,  // Appears at zoom 12+
    scaminContour: 21999,
    scaminSounding: 17999,
    bounds: [-151.8000, 59.4002, -151.6704, 59.4750],
    data: {
      depare: depareData_QG,
      depcnt: depcntData_QG,
      soundg: soundgData_QG,
      lndare: lndareData_QG,
      lights: lightsData_QG,
    },
  },
};

// Helper to create GeoJSON polygon from bounds
const boundsToPolygon = (bounds: number[]) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: {
    type: 'Polygon' as const,
    coordinates: [[
      [bounds[0], bounds[1]],
      [bounds[2], bounds[1]],
      [bounds[2], bounds[3]],
      [bounds[0], bounds[3]],
      [bounds[0], bounds[1]],
    ]],
  },
});

// Feature info type for tap-to-inspect
interface FeatureInfo {
  layerType: string;
  chartKey: string;
  properties: Record<string, unknown>;
}

// S-57 Light attribute decoders for human-readable display
const LIGHT_COLOURS: Record<string, string> = {
  '1': 'White',
  '2': 'Black',
  '3': 'Red',
  '4': 'Green',
  '5': 'Blue',
  '6': 'Yellow',
  '7': 'Grey',
  '8': 'Brown',
  '9': 'Amber',
  '10': 'Violet',
  '11': 'Orange',
  '12': 'Magenta',
  '13': 'Pink',
};

const LIGHT_CHARACTERISTICS: Record<string, string> = {
  '1': 'Fixed (F)',
  '2': 'Flashing (Fl)',
  '3': 'Long-flashing (LFl)',
  '4': 'Quick (Q)',
  '5': 'Very quick (VQ)',
  '6': 'Ultra quick (UQ)',
  '7': 'Isophase (Iso)',
  '8': 'Occulting (Oc)',
  '9': 'Interrupted quick (IQ)',
  '10': 'Interrupted very quick (IVQ)',
  '11': 'Interrupted ultra quick (IUQ)',
  '12': 'Morse code (Mo)',
  '13': 'Fixed/flashing (FFl)',
  '14': 'Flashing/long-flashing (FlLFl)',
  '15': 'Occulting/flashing (OcFl)',
  '16': 'Fixed/long-flashing (FLFl)',
  '17': 'Occulting alternating (Al.Oc)',
  '18': 'Long-flash alternating (Al.LFl)',
  '19': 'Flashing alternating (Al.Fl)',
  '20': 'Quick alternating (Al.Q)',
  '25': 'Quick + Long-flash (Q+LFl)',
  '26': 'Very quick + Long-flash (VQ+LFl)',
  '27': 'Ultra quick + Long-flash (UQ+LFl)',
  '28': 'Alternating (Al)',
  '29': 'Fixed/alternating flashing (F+Al.Fl)',
};

// Format light properties for display
const formatLightInfo = (properties: Record<string, unknown>): Record<string, string> => {
  const formatted: Record<string, string> = {};
  
  // Color
  const colours = properties.COLOUR as string[] | undefined;
  if (colours && colours.length > 0) {
    const colorNames = colours.map(c => LIGHT_COLOURS[c] || c).join(', ');
    formatted['Color'] = colorNames;
  }
  
  // Characteristic
  const litchr = properties.LITCHR as string | undefined;
  if (litchr) {
    formatted['Characteristic'] = LIGHT_CHARACTERISTICS[litchr] || `Code ${litchr}`;
  }
  
  // Signal period
  const sigper = properties.SIGPER as number | undefined;
  if (sigper) {
    formatted['Period'] = `${sigper} seconds`;
  }
  
  // Signal group
  const siggrp = properties.SIGGRP as string | undefined;
  if (siggrp) {
    formatted['Group'] = siggrp;
  }
  
  // Height
  const height = properties.HEIGHT as number | undefined;
  if (height) {
    formatted['Height'] = `${height} meters`;
  }
  
  // Range (nominal range in nautical miles)
  const valnmr = properties.VALNMR as number | undefined;
  if (valnmr) {
    formatted['Range'] = `${valnmr} NM`;
  }
  
  // Sector angles
  const sectr1 = properties.SECTR1 as number | undefined;
  const sectr2 = properties.SECTR2 as number | undefined;
  if (sectr1 !== undefined) {
    if (sectr2 !== undefined) {
      formatted['Sector'] = `${sectr1}° - ${sectr2}°`;
    } else {
      formatted['Orientation'] = `${sectr1}°`;
    }
  }
  
  // Status
  const status = properties.STATUS as string | undefined;
  if (status) {
    const statusMap: Record<string, string> = {
      '1': 'Permanent',
      '2': 'Occasional',
      '3': 'Recommended',
      '4': 'Not in use',
      '5': 'Periodic/Intermittent',
      '7': 'Temporary',
      '8': 'Private',
      '11': 'On request',
      '12': 'Reserved',
      '17': 'Extinguished',
      '18': 'Illuminated',
    };
    formatted['Status'] = statusMap[status] || `Code ${status}`;
  }
  
  return formatted;
};

type ChartKey = keyof typeof CHARTS;

// Explicit render order: least detailed first (bottom), most detailed last (top)
// This ensures proper quilting - detailed charts overlay less detailed ones
const CHART_RENDER_ORDER: ChartKey[] = ['US4AK4PH', 'US5AK5SJ', 'US5AK5SI', 'US5AK5QG'];

// Set Mapbox access token from environment variable
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || '';
if (MAPBOX_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_TOKEN);
} else {
  console.warn('Mapbox access token not found. Please check .env file.');
}

// Homer Spit, Alaska coordinates
const HOMER_HARBOR_CENTER: [number, number] = [-151.4900, 59.6350];

export default function ChartViewerMapbox() {
  const [showDepthAreas, setShowDepthAreas] = useState(true);
  const [showDepthContours, setShowDepthContours] = useState(true);
  const [showSoundings, setShowSoundings] = useState(true);
  const [showLand, setShowLand] = useState(true);
  const [showLights, setShowLights] = useState(true);
  const [showSatellite, setShowSatellite] = useState(false);
  
  // Debug state
  const [currentZoom, setCurrentZoom] = useState(13);
  const [selectedFeature, setSelectedFeature] = useState<FeatureInfo | null>(null);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const mapRef = useRef<MapView>(null);

  // Calculate which charts are active at current zoom
  const getActiveCharts = useCallback((zoom: number) => {
    return CHART_RENDER_ORDER.filter(key => zoom >= CHARTS[key].minZoom);
  }, []);

  // Calculate SCAMIN visibility status - MUTUALLY EXCLUSIVE bands
  const getScaminStatus = useCallback((zoom: number) => {
    const status = {
      harbor: zoom >= 15,                    // SCAMIN <= 50000: zoom 15+
      approachDetail: zoom >= 13 && zoom < 15,  // SCAMIN 50-100k: zoom 13-14
      approach: zoom >= 11 && zoom < 13,     // SCAMIN > 100k: zoom 11-12
    };
    return status;
  }, []);

  // Handle map idle to track zoom (replaces deprecated onRegionDidChange)
  const handleMapIdle = useCallback((state: any) => {
    if (state?.properties?.zoom !== undefined) {
      setCurrentZoom(Math.round(state.properties.zoom * 10) / 10);
    }
  }, []);

  // Handle map press for tap-to-inspect
  const handleMapPress = useCallback(async (event: any) => {
    if (!mapRef.current) return;
    
    const { geometry } = event;
    if (!geometry?.coordinates) return;

    try {
      // Query features at the tap point
      const features = await mapRef.current.queryRenderedFeaturesAtPoint(
        [event.properties.screenPointX, event.properties.screenPointY],
        undefined,
        // Query all our layer IDs - lights tap-target first for priority
        CHART_RENDER_ORDER.flatMap(key => [
          `lights-tap-target-${key}`,
          `lights-symbol-${key}`,
          `depth-contours-${key}`,
          `soundings-${key}`,
          `depth-areas-${key}`,
        ])
      );

      if (features?.features?.length > 0) {
        const feat = features.features[0];
        
        // Debug: log the full feature structure to understand what we're getting
        console.log('Full feature object keys:', Object.keys(feat));
        console.log('Full feature:', JSON.stringify(feat, null, 2));
        
        // Get identifying info from the feature - check multiple possible locations
        // @rnmapbox/maps may return layer info in different properties
        const sourceId = feat.source || feat.properties?.source || '';
        const layerIdFromProps = feat.properties?.layerId || feat.layer?.id || '';
        const identifier = sourceId + ' ' + layerIdFromProps;
        
        // Debug: log what we're getting
        console.log('Tapped feature:', { sourceId, layerIdFromProps, identifier });
        
        // Extract chart key from source/layer ID
        let chartKey = 'unknown';
        let layerType = 'unknown';
        
        for (const key of CHART_RENDER_ORDER) {
          if (identifier.includes(key) || sourceId.includes(key)) {
            chartKey = key;
            break;
          }
        }
        
        // Determine layer type from source ID
        if (sourceId.includes('lights') || layerIdFromProps.includes('lights')) {
          layerType = 'Light';
        } else if (sourceId.includes('contours') || layerIdFromProps.includes('contour')) {
          layerType = 'Contour';
        } else if (sourceId.includes('soundings') || layerIdFromProps.includes('sounding')) {
          layerType = 'Sounding';
        } else if (sourceId.includes('depth-areas') || layerIdFromProps.includes('depth-area')) {
          layerType = 'Depth Area';
        }

        setSelectedFeature({
          layerType,
          chartKey,
          properties: feat.properties || {},
        });
      } else {
        setSelectedFeature(null);
      }
    } catch (err) {
      console.log('Query error:', err);
    }
  }, []);

  // Count features per chart (simplified - actual visible count would need querying)
  const featureCounts = CHART_RENDER_ORDER.reduce((acc, key) => {
    const chart = CHARTS[key];
    acc[key] = {
      contours: chart.data.depcnt.features?.length || 0,
      soundings: chart.data.soundg.features?.length || 0,
      lights: chart.data.lights?.features?.length || 0,
    };
    return acc;
  }, {} as Record<string, { contours: number; soundings: number; lights: number }>);

  const activeCharts = getActiveCharts(currentZoom);
  const scaminStatus = getScaminStatus(currentZoom);

  console.log('Quilted chart display - 4 charts layered by detail level');

  return (
    <View style={styles.container}>
      {/* Chart Info Header */}
      <View style={styles.header}>
        <Text style={styles.chartTitle}>Homer Harbor - Quilted Charts</Text>
        <Text style={styles.chartInfo}>
          4 Charts Layered | Zoom for Detail
        </Text>
      </View>

      {/* Mapbox Map */}
      <Mapbox.MapView
        ref={mapRef}
        style={styles.map}
        styleURL={showSatellite ? Mapbox.StyleURL.Satellite : Mapbox.StyleURL.Light}
        onMapIdle={handleMapIdle}
        onPress={handleMapPress}
      >
        <Mapbox.Camera
          zoomLevel={13}
          centerCoordinate={HOMER_HARBOR_CENTER}
          animationDuration={0}
        />

        {/* Load S-52 symbol images for navigation features */}
        <Mapbox.Images images={LIGHT_SYMBOLS} />

        {/* DEBUG: Chart boundary outlines */}
        {showBoundaries && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          const color = DEBUG_COLORS[chartKey];
          return (
            <Mapbox.ShapeSource
              key={`boundary-${chartKey}`}
              id={`boundary-source-${chartKey}`}
              shape={boundsToPolygon(chart.bounds)}
            >
              <Mapbox.LineLayer
                id={`boundary-line-${chartKey}`}
                style={{
                  lineColor: color,
                  lineWidth: 3,
                  lineDasharray: [4, 2],
                  lineOpacity: 0.8,
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Land Areas - Quilted: rendered in order from least to most detailed */}
        {showLand && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          return (
            <Mapbox.ShapeSource
              key={`land-${chartKey}`}
              id={`land-source-${chartKey}`}
              shape={chart.data.lndare}
              minZoomLevel={chart.minZoom}
            >
              <Mapbox.FillLayer
                id={`land-fill-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  fillColor: '#E8D4A0',
                  fillOpacity: 0.9,
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Depth Areas - Quilted: detailed charts overlay less detailed ones */}
        {showDepthAreas && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          return (
            <Mapbox.ShapeSource
              key={`depare-${chartKey}`}
              id={`depth-areas-source-${chartKey}`}
              shape={chart.data.depare}
              minZoomLevel={chart.minZoom}
            >
              <Mapbox.FillLayer
                id={`depth-areas-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  fillColor: [
                    'step',
                    ['get', 'DRVAL2'],
                    '#A5D6FF',
                    2,
                    '#8ECCFF',
                    5,
                    '#6BB8E8',
                    10,
                    '#4A9FD8',
                    20,
                    '#B8D4E8',
                  ],
                  fillOpacity: 0.7,
                }}
              />
              <Mapbox.LineLayer
                id={`depth-area-outlines-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  lineColor: '#1976D2',
                  lineWidth: 1,
                  lineOpacity: 0.5,
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Depth Contours - DEBUG: Color-coded by chart source
            SCAMIN controls when contours appear - MUTUALLY EXCLUSIVE zoom bands
            More detailed contours REPLACE less detailed ones at higher zoom */}
        {showDepthContours && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          const debugColor = DEBUG_COLORS[chartKey];
          return (
            <Mapbox.ShapeSource
              key={`depcnt-${chartKey}`}
              id={`contours-source-${chartKey}`}
              shape={chart.data.depcnt}
              minZoomLevel={chart.minZoom}
            >
              <Mapbox.LineLayer
                id={`depth-contours-${chartKey}`}
                minZoomLevel={chart.minZoom}
                filter={[
                  'any',
                  // Harbor scale (SCAMIN <= 50000) -> zoom 15+ ONLY
                  ['all', ['<=', ['get', 'SCAMIN'], 50000], ['>=', ['zoom'], 15]],
                  // Approach detail (50000 < SCAMIN <= 100000) -> zoom 13-14 ONLY
                  ['all', ['>', ['get', 'SCAMIN'], 50000], ['<=', ['get', 'SCAMIN'], 100000], ['>=', ['zoom'], 13], ['<', ['zoom'], 15]],
                  // Approach scale (SCAMIN > 100000) -> zoom 11-12 ONLY
                  ['all', ['>', ['get', 'SCAMIN'], 100000], ['>=', ['zoom'], 11], ['<', ['zoom'], 13]],
                ]}
                style={{
                  // DEBUG: Use chart-specific color instead of depth-based
                  lineColor: debugColor,
                  lineWidth: 2,
                  lineOpacity: 0.9,
                }}
              />
              <Mapbox.SymbolLayer
                id={`contour-labels-${chartKey}`}
                minZoomLevel={chart.minZoom}
                filter={[
                  'any',
                  // Harbor scale (SCAMIN <= 50000) -> zoom 15+ ONLY
                  ['all', ['<=', ['get', 'SCAMIN'], 50000], ['>=', ['zoom'], 15]],
                  // Approach detail (50000 < SCAMIN <= 100000) -> zoom 13-14 ONLY
                  ['all', ['>', ['get', 'SCAMIN'], 50000], ['<=', ['get', 'SCAMIN'], 100000], ['>=', ['zoom'], 13], ['<', ['zoom'], 15]],
                  // Approach scale (SCAMIN > 100000) -> zoom 11-12 ONLY
                  ['all', ['>', ['get', 'SCAMIN'], 100000], ['>=', ['zoom'], 11], ['<', ['zoom'], 13]],
                ]}
                style={{
                  textField: ['concat', ['get', 'VALDCO'], 'm'],
                  textSize: [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    11, 14,
                    13, 18,
                    15, 22,
                    17, 26,
                  ],
                  // DEBUG: Use chart-specific color for labels too
                  textColor: debugColor,
                  textHaloColor: '#FFFFFF',
                  textHaloWidth: 2,
                  symbolPlacement: 'line',
                  textRotationAlignment: 'map',
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Soundings - ADDITIVE display (more soundings at higher zoom)
            All soundings shown once they reach their SCAMIN threshold
            Shallower soundings have higher display priority */}
        {showSoundings && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          return (
            <Mapbox.ShapeSource
              key={`soundg-${chartKey}`}
              id={`soundings-source-${chartKey}`}
              shape={chart.data.soundg}
              minZoomLevel={chart.minZoom}
            >
              <Mapbox.SymbolLayer
                id={`soundings-${chartKey}`}
                minZoomLevel={chart.minZoom}
                filter={[
                  // SCAMIN-based visibility - ADDITIVE (show more at higher zoom)
                  'any',
                  // Harbor scale (SCAMIN <= 20000) -> zoom 14+
                  ['all', ['<=', ['get', 'SCAMIN'], 20000], ['>=', ['zoom'], 14]],
                  // Approach detail (20000 < SCAMIN <= 30000) -> zoom 13+
                  ['all', ['>', ['get', 'SCAMIN'], 20000], ['<=', ['get', 'SCAMIN'], 30000], ['>=', ['zoom'], 13]],
                  // Approach scale (SCAMIN > 30000) -> zoom 12+
                  ['all', ['>', ['get', 'SCAMIN'], 30000], ['>=', ['zoom'], 12]],
                ]}
                style={{
                  // Format depth to 1 decimal place
                  textField: [
                    'number-format',
                    ['get', 'DEPTH'],
                    { 'min-fraction-digits': 1, 'max-fraction-digits': 1 }
                  ],
                  textSize: [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    12, 9,
                    14, 11,
                    16, 13,
                    18, 15,
                  ],
                  textFont: ['DIN Pro Medium', 'Arial Unicode MS Regular'],
                  // Depth-based coloring: shallower = more prominent
                  textColor: [
                    'step',
                    ['get', 'DEPTH'],
                    '#CC0000',  // 0-5m: Red (danger)
                    5, '#0066CC',  // 5-10m: Blue
                    10, '#0052A3', // 10-20m: Darker blue
                    20, '#555555', // 20m+: Dark gray
                  ],
                  textHaloColor: '#FFFFFF',
                  textHaloWidth: 1.5,
                  // Priority: shallower depths shown first (lower sortKey = higher priority)
                  symbolSortKey: ['get', 'DEPTH'],
                  // Collision detection - don't overlap text
                  textAllowOverlap: false,
                  textIgnorePlacement: false,
                  // Don't hide soundings - always try to show them
                  textOptional: false,
                  // Reduced padding for denser display
                  textPadding: 1,
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Lights - Navigation lights using S-52 standard symbols
            COLOUR codes: 1=white, 3=red, 4=green
            Uses Light_Flare symbols rotated based on ORIENT/SECTR attributes
            Rendered on top of other features for visibility */}
        {showLights && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          if (!chart.data.lights) return null;
          return (
            <Mapbox.ShapeSource
              key={`lights-${chartKey}`}
              id={`lights-source-${chartKey}`}
              shape={chart.data.lights}
              minZoomLevel={chart.minZoom}
              hitbox={{ width: 44, height: 44 }}
              onPress={(e) => {
                console.log('Light tapped!', chartKey);
                if (e.features && e.features.length > 0) {
                  const feat = e.features[0];
                  console.log('Light feature:', JSON.stringify(feat.properties, null, 2));
                  setSelectedFeature({
                    layerType: 'Light',
                    chartKey: chartKey,
                    properties: feat.properties || {},
                  });
                }
              }}
            >
              {/* Invisible tap target - larger circle for easier selection */}
              <Mapbox.CircleLayer
                id={`lights-tap-target-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  circleRadius: 20,
                  circleColor: 'transparent',
                  circleOpacity: 0,
                }}
              />
              {/* S-52 Light Flare Symbol - colored by light color */}
              <Mapbox.SymbolLayer
                id={`lights-symbol-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  // Select icon based on S-57 COLOUR attribute
                  // COLOUR is an array, first element determines primary color
                  iconImage: [
                    'match',
                    ['to-string', ['at', 0, ['get', 'COLOUR']]],
                    '1', 'light-flare-white',   // White
                    '6', 'light-flare-white',   // Yellow (use white icon)
                    '9', 'light-flare-white',   // Amber (use white icon)
                    '11', 'light-flare-white',  // Orange (use white icon)
                    '3', 'light-flare-red',     // Red
                    '4', 'light-flare-green',   // Green
                    'light-flare-magenta',      // Default: Magenta
                  ],
                  // Size scales with zoom
                  iconSize: [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 0.4,
                    14, 0.6,
                    18, 0.8,
                  ],
                  // Rotate based on ORIENT (light orientation) or default to 135° (SW pointing)
                  // S-52 standard: flare points in direction of light sector
                  iconRotate: [
                    'case',
                    ['has', 'ORIENT'],
                    ['-', ['to-number', ['get', 'ORIENT']], 180],  // ORIENT is direction light faces
                    ['has', 'SECTR1'],
                    // For sector lights, point to middle of sector
                    ['-', 
                      ['/', ['+', ['to-number', ['get', 'SECTR1']], ['to-number', ['coalesce', ['get', 'SECTR2'], ['get', 'SECTR1']]]], 2],
                      180
                    ],
                    135,  // Default: point SW (standard chart convention)
                  ],
                  iconRotationAlignment: 'map',
                  iconAllowOverlap: true,
                  iconIgnorePlacement: false,
                }}
              />
              {/* Light characteristic label (shows at higher zoom) */}
              <Mapbox.SymbolLayer
                id={`lights-label-${chartKey}`}
                minZoomLevel={14}
                style={{
                  // Build light description string: "Fl(1) 4s 8m 5M"
                  // LITCHR: characteristic, SIGPER: period, HEIGHT: height, VALNMR: range
                  textField: [
                    'case',
                    ['has', 'SIGPER'],
                    ['concat', ['get', 'SIGPER'], 's'],
                    '',
                  ],
                  textSize: [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    14, 9,
                    18, 12,
                  ],
                  textFont: ['DIN Pro Medium', 'Arial Unicode MS Regular'],
                  textColor: '#000000',
                  textHaloColor: '#FFFFFF',
                  textHaloWidth: 1.5,
                  textOffset: [0, 1.2],
                  textAnchor: 'top',
                  textAllowOverlap: false,
                  textOptional: true,  // Hide label if it collides
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}
      </Mapbox.MapView>

      {/* DEBUG: Info Panel */}
      <View style={styles.debugPanel}>
        <Text style={styles.debugTitle}>DEBUG INFO</Text>
        <Text style={styles.debugText}>Zoom: {currentZoom.toFixed(1)}</Text>
        <Text style={styles.debugSubtitle}>Active SCAMIN Band:</Text>
        <Text style={[styles.debugText, { color: scaminStatus.approach ? '#FF9800' : '#555' }]}>
          Approach (z11-12): {scaminStatus.approach ? 'ACTIVE' : 'off'}
        </Text>
        <Text style={[styles.debugText, { color: scaminStatus.approachDetail ? '#9C27B0' : '#555' }]}>
          Detail (z13-14): {scaminStatus.approachDetail ? 'ACTIVE' : 'off'}
        </Text>
        <Text style={[styles.debugText, { color: scaminStatus.harbor ? '#4CAF50' : '#555' }]}>
          Harbor (z15+): {scaminStatus.harbor ? 'ACTIVE' : 'off'}
        </Text>
        
        <Text style={styles.debugSubtitle}>Active Charts:</Text>
        {CHART_RENDER_ORDER.map(key => {
          const isActive = activeCharts.includes(key);
          const color = DEBUG_COLORS[key];
          return (
            <View key={key} style={styles.chartIndicator}>
              <View style={[styles.chartColorDot, { backgroundColor: color, opacity: isActive ? 1 : 0.3 }]} />
              <Text style={[styles.debugText, { color: isActive ? '#333' : '#999' }]}>
                {CHARTS[key].shortName}
              </Text>
            </View>
          );
        })}

        <TouchableOpacity
          style={[styles.debugButton, showBoundaries && styles.debugButtonActive]}
          onPress={() => setShowBoundaries(!showBoundaries)}
        >
          <Text style={styles.debugButtonText}>
            {showBoundaries ? 'Hide' : 'Show'} Bounds
          </Text>
        </TouchableOpacity>
      </View>

      {/* DEBUG: Feature Counts */}
      <View style={styles.featureCountPanel}>
        <Text style={styles.debugTitle}>FEATURES</Text>
        {CHART_RENDER_ORDER.map(key => {
          const color = DEBUG_COLORS[key];
          const counts = featureCounts[key];
          const isActive = activeCharts.includes(key);
          return (
            <View key={key} style={{ opacity: isActive ? 1 : 0.4 }}>
              <Text style={[styles.featureCountLabel, { color }]}>
                {CHARTS[key].shortName}
              </Text>
              <Text style={styles.featureCountText}>
                {counts.contours} cnt / {counts.soundings} snd / {counts.lights} lt
              </Text>
            </View>
          );
        })}
      </View>

      {/* DEBUG: Feature Inspector (tap-to-inspect) */}
      {selectedFeature && (
        <View style={styles.featureInspector}>
          <View style={styles.inspectorHeader}>
            <Text style={styles.inspectorTitle}>
              {selectedFeature.layerType === 'Light' ? '💡 LIGHT INFO' : 'FEATURE INSPECTOR'}
            </Text>
            <TouchableOpacity onPress={() => setSelectedFeature(null)}>
              <Text style={styles.inspectorClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.inspectorScroll}>
            <Text style={styles.inspectorLabel}>Type: {selectedFeature.layerType}</Text>
            <Text style={[styles.inspectorLabel, { color: DEBUG_COLORS[selectedFeature.chartKey as ChartKey] || '#333' }]}>
              Chart: {selectedFeature.chartKey}
            </Text>
            
            {/* Special formatted display for Lights */}
            {selectedFeature.layerType === 'Light' ? (
              <>
                <Text style={styles.inspectorSubtitle}>Light Details:</Text>
                {Object.entries(formatLightInfo(selectedFeature.properties)).map(([key, value]) => (
                  <View key={key} style={styles.inspectorRow}>
                    <Text style={styles.inspectorPropKey}>{key}:</Text>
                    <Text style={styles.inspectorPropValue}>{value}</Text>
                  </View>
                ))}
                <Text style={[styles.inspectorSubtitle, { marginTop: 10 }]}>Raw S-57 Data:</Text>
                {Object.entries(selectedFeature.properties)
                  .filter(([key]) => !['layerId'].includes(key))
                  .slice(0, 10)  // Limit raw properties shown
                  .map(([key, value]) => (
                  <Text key={key} style={styles.inspectorProp}>
                    {key}: {String(value)}
                  </Text>
                ))}
              </>
            ) : (
              <>
                <Text style={styles.inspectorSubtitle}>Properties:</Text>
                {Object.entries(selectedFeature.properties).map(([key, value]) => (
                  <Text key={key} style={styles.inspectorProp}>
                    {key}: {String(value)}
                  </Text>
                ))}
              </>
            )}
          </ScrollView>
        </View>
      )}

      {/* Layer Controls */}
      <View style={styles.layerControl}>
        <Text style={styles.layerControlTitle}>Chart Layers</Text>
        <TouchableOpacity
          style={[styles.layerButton, showLand && styles.layerButtonActive]}
          onPress={() => setShowLand(!showLand)}
        >
          <Text style={[styles.layerButtonText, showLand && styles.layerButtonTextActive]}>
            Land
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, showDepthAreas && styles.layerButtonActive]}
          onPress={() => setShowDepthAreas(!showDepthAreas)}
        >
          <Text style={[styles.layerButtonText, showDepthAreas && styles.layerButtonTextActive]}>
            Depth Areas
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, showDepthContours && styles.layerButtonActive]}
          onPress={() => setShowDepthContours(!showDepthContours)}
        >
          <Text style={[styles.layerButtonText, showDepthContours && styles.layerButtonTextActive]}>
            Contours
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, showSoundings && styles.layerButtonActive]}
          onPress={() => setShowSoundings(!showSoundings)}
        >
          <Text style={[styles.layerButtonText, showSoundings && styles.layerButtonTextActive]}>
            Soundings
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, showLights && styles.layerButtonActive]}
          onPress={() => setShowLights(!showLights)}
        >
          <Text style={[styles.layerButtonText, showLights && styles.layerButtonTextActive]}>
            Lights
          </Text>
        </TouchableOpacity>
      </View>

      {/* Map Style Toggle */}
      <View style={styles.styleControl}>
        <Text style={styles.styleControlTitle}>Base Map</Text>
        <TouchableOpacity
          style={[styles.styleButton, showSatellite && styles.styleButtonActive]}
          onPress={() => setShowSatellite(!showSatellite)}
        >
          <Text style={[styles.styleButtonText, showSatellite && styles.styleButtonTextActive]}>
            {showSatellite ? 'Satellite' : 'Light'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.styleNote}>
          {showSatellite ? '(requires internet)' : '(offline)'}
        </Text>
      </View>

      {/* Status Badge */}
      <View style={styles.offlineBadge}>
        <Text style={styles.offlineBadgeText}>OFFLINE - Real S-57 Data</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    backgroundColor: '#4CAF50',
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    zIndex: 2000,
  },
  chartTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  chartInfo: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 4,
  },
  map: {
    flex: 1,
  },
  layerControl: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 130 : 90,
    left: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 12,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    minWidth: 120,
  },
  layerControlTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  layerButton: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ccc',
    marginBottom: 5,
  },
  layerButtonActive: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  layerButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
  },
  layerButtonTextActive: {
    color: 'white',
  },
  styleControl: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 130 : 90,
    right: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 12,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    minWidth: 120,
  },
  styleControlTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 6,
    color: '#333',
  },
  styleButton: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
  },
  styleButtonActive: {
    backgroundColor: '#FF9800',
    borderColor: '#FF9800',
  },
  styleButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#666',
  },
  styleButtonTextActive: {
    color: 'white',
  },
  styleNote: {
    fontSize: 8,
    color: '#999',
    marginTop: 4,
    textAlign: 'center',
  },
  offlineBadge: {
    position: 'absolute',
    bottom: 20,
    alignSelf: 'center',
    backgroundColor: '#4CAF50',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  offlineBadgeText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 11,
  },
  // Debug styles
  debugPanel: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 280 : 240,
    left: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    padding: 10,
    borderRadius: 8,
    minWidth: 140,
  },
  debugTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#FF9800',
    marginBottom: 6,
  },
  debugSubtitle: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#888',
    marginTop: 8,
    marginBottom: 4,
  },
  debugText: {
    fontSize: 10,
    color: '#fff',
    marginBottom: 2,
  },
  chartIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  chartColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  debugButton: {
    backgroundColor: '#333',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    marginTop: 8,
    alignItems: 'center',
  },
  debugButtonActive: {
    backgroundColor: '#FF9800',
  },
  debugButtonText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: 'bold',
  },
  featureCountPanel: {
    position: 'absolute',
    bottom: 60,
    left: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    padding: 10,
    borderRadius: 8,
    minWidth: 120,
  },
  featureCountLabel: {
    fontSize: 9,
    fontWeight: 'bold',
    marginTop: 4,
  },
  featureCountText: {
    fontSize: 9,
    color: '#ccc',
  },
  featureInspector: {
    position: 'absolute',
    bottom: 60,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    padding: 12,
    borderRadius: 10,
    maxWidth: 240,
    maxHeight: 320,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.3)',
  },
  inspectorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  inspectorTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#FF9800',
  },
  inspectorClose: {
    fontSize: 14,
    color: '#FF5722',
    fontWeight: 'bold',
    paddingHorizontal: 6,
  },
  inspectorScroll: {
    maxHeight: 260,
  },
  inspectorLabel: {
    fontSize: 10,
    color: '#fff',
    marginBottom: 4,
  },
  inspectorSubtitle: {
    fontSize: 9,
    color: '#888',
    marginTop: 6,
    marginBottom: 4,
  },
  inspectorProp: {
    fontSize: 9,
    color: '#aaa',
    marginBottom: 2,
  },
  inspectorRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  inspectorPropKey: {
    fontSize: 10,
    color: '#FFD700',
    fontWeight: 'bold',
    marginRight: 6,
    minWidth: 70,
  },
  inspectorPropValue: {
    fontSize: 10,
    color: '#fff',
    flex: 1,
  },
});

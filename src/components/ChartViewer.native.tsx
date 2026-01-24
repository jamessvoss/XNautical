/**
 * Offline Chart Viewer using React Native Mapbox
 * Uses GeoJSON data stored locally for true offline operation
 */

import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Platform,
} from 'react-native';
import Mapbox from '@rnmapbox/maps';

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

// Chart definitions with scale/usage bands
const CHARTS = {
  US4AK4PH: {
    name: 'Approaches to Homer Harbor',
    center: [-151.4900, 59.6350],
    scaleType: 'approach',
    minZoom: 0,
    maxZoom: 22,
    data: {
      depare: depareData_PH,
      depcnt: depcntData_PH,
      soundg: soundgData_PH,
      lndare: lndareData_PH,
    },
  },
  US5AK5SI: {
    name: 'Homer Harbor',
    center: [-151.4900, 59.6350],
    scaleType: 'harbor',
    minZoom: 13,
    maxZoom: 22,
    data: {
      depare: depareData_SI,
      depcnt: depcntData_SI,
      soundg: soundgData_SI,
      lndare: lndareData_SI,
    },
  },
  US5AK5QG: {
    name: 'Seldovia Harbor',
    center: [-151.4900, 59.6350],
    scaleType: 'harbor',
    minZoom: 13,
    maxZoom: 22,
    data: {
      depare: depareData_QG,
      depcnt: depcntData_QG,
      soundg: soundgData_QG,
      lndare: lndareData_QG,
    },
  },
  US5AK5SJ: {
    name: 'Approaches to Homer Harbor (Detail)',
    center: [-151.4900, 59.6350],
    scaleType: 'approach_detail',
    minZoom: 12,
    maxZoom: 22,
    data: {
      depare: depareData_SJ,
      depcnt: depcntData_SJ,
      soundg: soundgData_SJ,
      lndare: lndareData_SJ,
    },
  },
};

// Set Mapbox access token from environment variable
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || '';
if (MAPBOX_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_TOKEN);
} else {
  console.warn('Mapbox access token not found. Please check .env file.');
}

// Homer Spit, Alaska coordinates
const HOMER_HARBOR_CENTER: [number, number] = [-151.4900, 59.6350];

type ChartKey = keyof typeof CHARTS;

export default function ChartViewerMapbox() {
  const [showDepthAreas, setShowDepthAreas] = useState(true);
  const [showDepthContours, setShowDepthContours] = useState(true);
  const [showSoundings, setShowSoundings] = useState(true);
  const [showLand, setShowLand] = useState(true);
  const [showSatellite, setShowSatellite] = useState(false);

  console.log('All 4 charts loaded - testing without navigation features');

  return (
    <View style={styles.container}>
      {/* Chart Info Header */}
      <View style={styles.header}>
        <Text style={styles.chartTitle}>All Charts - Seamless View</Text>
        <Text style={styles.chartInfo}>
          4 Charts | No Internet Required
        </Text>
      </View>

      {/* Mapbox Map */}
      <Mapbox.MapView
        style={styles.map}
        styleURL={showSatellite ? Mapbox.StyleURL.Satellite : Mapbox.StyleURL.Light}
      >
        <Mapbox.Camera
          zoomLevel={13}
          centerCoordinate={HOMER_HARBOR_CENTER}
          animationDuration={0}
        />

        {/* Land Areas */}
        {showLand && (Object.keys(CHARTS) as ChartKey[]).map((chartKey) => {
          const chart = CHARTS[chartKey];
          return (
            <Mapbox.ShapeSource
              key={`land-${chartKey}`}
              id={`land-source-${chartKey}`}
              shape={chart.data.lndare}
              minZoomLevel={chart.minZoom}
              maxZoomLevel={chart.maxZoom}
            >
              <Mapbox.FillLayer
                id={`land-fill-${chartKey}`}
                minZoomLevel={chart.minZoom}
                maxZoomLevel={chart.maxZoom}
                style={{
                  fillColor: '#E8D4A0',
                  fillOpacity: 0.8,
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Depth Areas */}
        {showDepthAreas && (Object.keys(CHARTS) as ChartKey[]).map((chartKey) => {
          const chart = CHARTS[chartKey];
          return (
            <Mapbox.ShapeSource
              key={`depare-${chartKey}`}
              id={`depth-areas-source-${chartKey}`}
              shape={chart.data.depare}
              minZoomLevel={chart.minZoom}
              maxZoomLevel={chart.maxZoom}
            >
              <Mapbox.FillLayer
                id={`depth-areas-${chartKey}`}
                minZoomLevel={chart.minZoom}
                maxZoomLevel={chart.maxZoom}
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
                  fillOpacity: 0.6,
                }}
              />
              <Mapbox.LineLayer
                id={`depth-area-outlines-${chartKey}`}
                minZoomLevel={chart.minZoom}
                maxZoomLevel={chart.maxZoom}
                style={{
                  lineColor: '#1976D2',
                  lineWidth: 1,
                  lineOpacity: 0.5,
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Depth Contours */}
        {showDepthContours && (Object.keys(CHARTS) as ChartKey[]).map((chartKey) => {
          const chart = CHARTS[chartKey];
          return (
            <Mapbox.ShapeSource
              key={`depcnt-${chartKey}`}
              id={`contours-source-${chartKey}`}
              shape={chart.data.depcnt}
              minZoomLevel={chart.minZoom}
              maxZoomLevel={chart.maxZoom}
            >
              <Mapbox.LineLayer
                id={`depth-contours-${chartKey}`}
                minZoomLevel={chart.minZoom}
                maxZoomLevel={chart.maxZoom}
                style={{
                  lineColor: [
                    'step',
                    ['get', 'VALDCO'],
                    '#0066CC',
                    5,
                    '#0052A3',
                    10,
                    '#003D7A',
                    20,
                    '#002952',
                  ],
                  lineWidth: 2,
                  lineOpacity: 0.8,
                }}
              />
              <Mapbox.SymbolLayer
                id={`contour-labels-${chartKey}`}
                minZoomLevel={chart.minZoom}
                maxZoomLevel={chart.maxZoom}
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
                  textColor: '#0052A3',
                  textHaloColor: '#FFFFFF',
                  textHaloWidth: 2,
                  symbolPlacement: 'line',
                  textRotationAlignment: 'map',
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Soundings */}
        {showSoundings && (Object.keys(CHARTS) as ChartKey[]).map((chartKey) => {
          const chart = CHARTS[chartKey];
          return (
            <Mapbox.ShapeSource
              key={`soundg-${chartKey}`}
              id={`soundings-source-${chartKey}`}
              shape={chart.data.soundg}
              minZoomLevel={chart.minZoom}
              maxZoomLevel={chart.maxZoom}
            >
              <Mapbox.SymbolLayer
                id={`soundings-${chartKey}`}
                minZoomLevel={chart.minZoom}
                maxZoomLevel={chart.maxZoom}
                style={{
                  textField: ['get', 'DEPTH'],
                  textSize: [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    11, 16,
                    13, 20,
                    15, 24,
                    17, 28,
                  ],
                  textColor: '#0066CC',
                  textHaloColor: '#FFFFFF',
                  textHaloWidth: 2,
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}
      </Mapbox.MapView>

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
});

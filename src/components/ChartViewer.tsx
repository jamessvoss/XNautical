/**
 * ChartViewer Component
 * Displays NOAA ENC (Electronic Navigational Chart) data
 * for Homer Harbor, Alaska
 */

import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  Platform,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { S57Parser, loadChart } from '../utils/s57Parser';
import {
  S57Dataset,
  DepthContour,
  SoundingPoint,
  NavigationAid,
} from '../types/s57';

// Homer Spit, Alaska coordinates
const HOMER_HARBOR_CENTER = {
  latitude: 59.6350,
  longitude: -151.4900,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

// Depth-based color scheme for bathymetry
const DEPTH_COLORS = {
  shallow: '#B3E5FC',    // 0-5m - Light blue
  medium: '#4FC3F7',     // 5-10m - Medium blue
  deep: '#0288D1',       // 10-20m - Deep blue
  veryDeep: '#01579B',   // 20m+ - Very deep blue
};

function getDepthColor(depth: number): string {
  if (depth < 5) return DEPTH_COLORS.shallow;
  if (depth < 10) return DEPTH_COLORS.medium;
  if (depth < 20) return DEPTH_COLORS.deep;
  return DEPTH_COLORS.veryDeep;
}

export default function ChartViewer() {
  const [loading, setLoading] = useState(true);
  const [chartData, setChartData] = useState<S57Dataset | null>(null);
  const [depthContours, setDepthContours] = useState<DepthContour[]>([]);
  const [soundings, setSoundings] = useState<SoundingPoint[]>([]);
  const [navAids, setNavAids] = useState<NavigationAid[]>([]);
  const [showDepthLabels, setShowDepthLabels] = useState(true);
  const [showNavAids, setShowNavAids] = useState(true);

  useEffect(() => {
    loadChartData();
  }, []);

  const loadChartData = async () => {
    try {
      setLoading(true);
      const parser = await loadChart('US5AK5SI');
      
      // Load all chart data
      const [dataset, contours, soundingPoints, navigationAids] = await Promise.all([
        parser.parseChart(),
        parser.getDepthContours(),
        parser.getSoundings(),
        parser.getNavigationAids(),
      ]);

      setChartData(dataset);
      setDepthContours(contours);
      setSoundings(soundingPoints);
      setNavAids(navigationAids);
    } catch (error) {
      console.error('Error loading chart data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0288D1" />
        <Text style={styles.loadingText}>Loading ENC Chart...</Text>
        <Text style={styles.chartName}>US5AK5SI - Homer Harbor</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Chart Info Header */}
      <View style={styles.header}>
        <Text style={styles.chartTitle}>
          {chartData?.name || 'Homer Harbor'}
        </Text>
        <Text style={styles.chartInfo}>
          Cell: {chartData?.cellName} | Edition: {chartData?.edition}
        </Text>
      </View>

      {/* Map View */}
      <MapView
        style={styles.map}
        initialRegion={HOMER_HARBOR_CENTER}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        mapType="satellite" // Satellite view shows bathymetry better
      >
        {/* Depth Contours */}
        {depthContours.map((contour, index) => (
          <Polyline
            key={`contour-${index}`}
            coordinates={contour.coordinates}
            strokeColor={getDepthColor(contour.depth)}
            strokeWidth={2}
          />
        ))}

        {/* Depth Soundings */}
        {showDepthLabels && soundings.map((sounding, index) => (
          <Marker
            key={`sounding-${index}`}
            coordinate={{
              latitude: sounding.latitude,
              longitude: sounding.longitude,
            }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.soundingMarker}>
              <Text style={styles.soundingText}>
                {sounding.depth.toFixed(1)}
              </Text>
            </View>
          </Marker>
        ))}

        {/* Navigation Aids */}
        {showNavAids && navAids.map((aid, index) => (
          <Marker
            key={`navaid-${index}`}
            coordinate={{
              latitude: aid.latitude,
              longitude: aid.longitude,
            }}
            title={aid.name}
            description={aid.description}
            pinColor={aid.type === 'light' ? '#FFC107' : '#4CAF50'}
          />
        ))}
      </MapView>

      {/* Legend */}
      <View style={styles.legend}>
        <Text style={styles.legendTitle}>Depth Legend (meters)</Text>
        <View style={styles.legendItems}>
          <View style={styles.legendItem}>
            <View style={[styles.legendColor, { backgroundColor: DEPTH_COLORS.shallow }]} />
            <Text style={styles.legendText}>0-5m</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendColor, { backgroundColor: DEPTH_COLORS.medium }]} />
            <Text style={styles.legendText}>5-10m</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendColor, { backgroundColor: DEPTH_COLORS.deep }]} />
            <Text style={styles.legendText}>10-20m</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendColor, { backgroundColor: DEPTH_COLORS.veryDeep }]} />
            <Text style={styles.legendText}>20m+</Text>
          </View>
        </View>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.controlButton, showDepthLabels && styles.controlButtonActive]}
          onPress={() => setShowDepthLabels(!showDepthLabels)}
        >
          <Text style={styles.controlButtonText}>
            {showDepthLabels ? '✓' : ''} Depths
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlButton, showNavAids && styles.controlButtonActive]}
          onPress={() => setShowNavAids(!showNavAids)}
        >
          <Text style={styles.controlButtonText}>
            {showNavAids ? '✓' : ''} Nav Aids
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 18,
    color: '#333',
    fontWeight: '600',
  },
  chartName: {
    marginTop: 8,
    fontSize: 14,
    color: '#666',
  },
  header: {
    backgroundColor: '#0288D1',
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
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
  soundingMarker: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    padding: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#0288D1',
  },
  soundingText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#0288D1',
  },
  legend: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 140 : 100,
    right: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 12,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  legendTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  legendItems: {
    gap: 6,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendColor: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  legendText: {
    fontSize: 11,
    color: '#333',
  },
  controls: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  controlButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ccc',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  controlButtonActive: {
    backgroundColor: '#0288D1',
    borderColor: '#0288D1',
  },
  controlButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
});

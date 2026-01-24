/**
 * Offline Chart Viewer - Loads local GeoJSON data dynamically
 * No internet connection required!
 */

import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { MapContainer, TileLayer, GeoJSON, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Homer Spit, Alaska coordinates
const HOMER_HARBOR_CENTER: [number, number] = [59.6350, -151.4900];

// ECDIS-style depth colors based on DRVAL1/DRVAL2 attributes
function getDepthAreaColor(properties: any): string {
  const drval1 = properties.DRVAL1 || 0;
  const drval2 = properties.DRVAL2 || 999;
  
  if (drval2 <= 2) return '#A5D6FF';
  if (drval2 <= 5) return '#8ECCFF';
  if (drval2 <= 10) return '#6BB8E8';
  if (drval2 <= 20) return '#4A9FD8';
  return '#B8D4E8';
}

function getDepthContourColor(properties: any): string {
  const valdco = properties.VALDCO || 0;
  
  if (valdco <= 5) return '#0066CC';
  if (valdco <= 10) return '#0052A3';
  if (valdco <= 20) return '#003D7A';
  return '#002952';
}

export default function ChartViewerOffline() {
  const [loading, setLoading] = useState(true);
  const [depareData, setDepareData] = useState<any>(null);
  const [depcntData, setDepcntData] = useState<any>(null);
  const [soundgData, setSoundgData] = useState<any>(null);
  const [lndareData, setLndareData] = useState<any>(null);
  const [showDepthAreas, setShowDepthAreas] = useState(true);
  const [showDepthContours, setShowDepthContours] = useState(true);
  const [showSoundings, setShowSoundings] = useState(true);
  const [showLand, setShowLand] = useState(true);
  const [showSatellite, setShowSatellite] = useState(false);
  const [satelliteOpacity, setSatelliteOpacity] = useState(0.5);

  useEffect(() => {
    loadChartData();
  }, []);

  const loadChartData = async () => {
    try {
      setLoading(true);
      
      // Load GeoJSON files dynamically
      const [depare, depcnt, soundg, lndare] = await Promise.all([
        fetch('/assets/Maps/depare.geojson').then(r => r.json()),
        fetch('/assets/Maps/depcnt.geojson').then(r => r.json()),
        fetch('/assets/Maps/soundg.geojson').then(r => r.json()),
        fetch('/assets/Maps/lndare.geojson').then(r => r.json()),
      ]);

      setDepareData(depare);
      setDepcntData(depcnt);
      setSoundgData(soundg);
      setLndareData(lndare);
    } catch (error) {
      console.error('Error loading chart data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !depareData) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0288D1" />
        <Text style={styles.loadingText}>Loading Offline Chart Data...</Text>
        <Text style={styles.chartName}>US5AK5SI - Homer Harbor (OFFLINE)</Text>
        <Text style={styles.chartDetail}>Parsing S-57 GeoJSON...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Chart Info Header */}
      <View style={styles.header}>
        <Text style={styles.chartTitle}>Homer Harbor - OFFLINE MODE</Text>
        <Text style={styles.chartInfo}>
          Cell: US5AK5SI | Edition: 1 | 📡 No Internet Required
        </Text>
      </View>

      {/* Map View */}
      <div style={{ flex: 1, height: '100%', width: '100%' }}>
        <MapContainer
          center={HOMER_HARBOR_CENTER}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
        >
          {/* Base map (light) - optional, for reference only */}
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            opacity={0.2}
            zIndex={1}
          />
          
          {/* Satellite layer (optional, requires internet) */}
          {showSatellite && (
            <TileLayer
              attribution='&copy; Esri'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              opacity={satelliteOpacity}
              zIndex={2}
            />
          )}

          {/* Land Areas (from offline data) */}
          {showLand && lndareData && (
            <GeoJSON
              data={lndareData}
              style={() => ({
                fillColor: '#E8D4A0',
                fillOpacity: 0.8,
                color: '#8B7355',
                weight: 1,
              })}
              zIndex={3}
            />
          )}

          {/* Depth Areas (from offline data) */}
          {showDepthAreas && depareData && (
            <GeoJSON
              data={depareData}
              style={(feature) => ({
                fillColor: getDepthAreaColor(feature?.properties || {}),
                fillOpacity: 0.6,
                color: '#1976D2',
                weight: 1,
              })}
              onEachFeature={(feature, layer) => {
                const props = feature.properties;
                layer.bindPopup(`
                  <strong>Depth Area</strong><br/>
                  Min Depth: ${props.DRVAL1 || 'N/A'}m<br/>
                  Max Depth: ${props.DRVAL2 || 'N/A'}m
                `);
              }}
              zIndex={4}
            />
          )}

          {/* Depth Contours (from offline data) */}
          {showDepthContours && depcntData && (
            <GeoJSON
              data={depcntData}
              style={(feature) => ({
                color: getDepthContourColor(feature?.properties || {}),
                weight: 2,
                opacity: 0.8,
              })}
              onEachFeature={(feature, layer) => {
                const valdco = feature.properties?.VALDCO;
                if (valdco) {
                  layer.bindPopup(`<strong>${valdco}m</strong> depth contour`);
                }
              }}
              zIndex={5}
            />
          )}

          {/* Soundings (from offline data) */}
          {showSoundings && soundgData && (
            <GeoJSON
              data={soundgData}
              pointToLayer={(feature, latlng) => {
                const depth = feature.properties?.DEPTH || feature.geometry.coordinates[2];
                return L.marker(latlng, {
                  icon: L.divIcon({
                    className: 'sounding-label',
                    html: `<div style="background: rgba(255,255,255,0.9); padding: 1px 3px; border: 1px solid #0066CC; border-radius: 2px; font-size: 9px; font-weight: bold; color: #0066CC; white-space: nowrap;">${depth ? depth.toFixed(1) : 'N/A'}</div>`,
                    iconSize: [30, 15],
                  }),
                });
              }}
              onEachFeature={(feature, layer) => {
                const depth = feature.properties?.DEPTH || feature.geometry.coordinates[2];
                layer.bindPopup(`<strong>Depth:</strong> ${depth?.toFixed(1) || 'N/A'}m`);
              }}
              zIndex={6}
            />
          )}
        </MapContainer>
      </div>

      {/* Layer Controls */}
      <View style={styles.layerControl}>
        <Text style={styles.layerControlTitle}>Chart Layers</Text>
        <TouchableOpacity
          style={[styles.layerButton, showDepthAreas && styles.layerButtonActive]}
          onPress={() => setShowDepthAreas(!showDepthAreas)}
        >
          <Text style={[styles.layerButtonText, showDepthAreas && styles.layerButtonTextActive]}>
            {showDepthAreas ? '✓' : ''} Depth Areas
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, showDepthContours && styles.layerButtonActive]}
          onPress={() => setShowDepthContours(!showDepthContours)}
        >
          <Text style={[styles.layerButtonText, showDepthContours && styles.layerButtonTextActive]}>
            {showDepthContours ? '✓' : ''} Contours
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, showSoundings && styles.layerButtonActive]}
          onPress={() => setShowSoundings(!showSoundings)}
        >
          <Text style={[styles.layerButtonText, showSoundings && styles.layerButtonTextActive]}>
            {showSoundings ? '✓' : ''} Soundings
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, showLand && styles.layerButtonActive]}
          onPress={() => setShowLand(!showLand)}
        >
          <Text style={[styles.layerButtonText, showLand && styles.layerButtonTextActive]}>
            {showLand ? '✓' : ''} Land
          </Text>
        </TouchableOpacity>
      </View>

      {/* Satellite Control */}
      <View style={styles.satelliteControl}>
        <Text style={styles.satelliteControlTitle}>Satellite</Text>
        <Text style={styles.satelliteNote}>(requires internet)</Text>
        <TouchableOpacity
          style={[styles.satelliteToggle, showSatellite && styles.satelliteToggleActive]}
          onPress={() => setShowSatellite(!showSatellite)}
        >
          <Text style={[styles.satelliteToggleText, showSatellite && styles.satelliteToggleTextActive]}>
            {showSatellite ? '✓ ON' : 'OFF'}
          </Text>
        </TouchableOpacity>
        {showSatellite && (
          <View style={styles.opacityContainer}>
            <Text style={styles.opacityLabel}>Opacity: {Math.round(satelliteOpacity * 100)}%</Text>
            <input
              type="range"
              min="0"
              max="100"
              value={satelliteOpacity * 100}
              onChange={(e) => setSatelliteOpacity(Number(e.target.value) / 100)}
              style={{ width: '100%', cursor: 'pointer' }}
            />
          </View>
        )}
      </View>

      {/* Status Badge */}
      <View style={styles.offlineBadge}>
        <Text style={styles.offlineBadgeText}>📡 OFFLINE MODE - Real S-57 Data</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    height: '100vh',
    width: '100vw',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    height: '100vh',
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
  chartDetail: {
    marginTop: 4,
    fontSize: 12,
    color: '#999',
  },
  header: {
    backgroundColor: '#4CAF50',
    padding: 16,
    zIndex: 1000,
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
  layerControl: {
    position: 'absolute',
    top: 100,
    left: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 12,
    borderRadius: 8,
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    zIndex: 1000,
    minWidth: 130,
  },
  layerControlTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  layerButton: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 5,
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
    fontSize: 10,
    fontWeight: '600',
    color: '#666',
  },
  layerButtonTextActive: {
    color: 'white',
  },
  satelliteControl: {
    position: 'absolute',
    top: 100,
    right: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 12,
    borderRadius: 8,
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    zIndex: 1000,
    minWidth: 150,
  },
  satelliteControlTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#333',
  },
  satelliteNote: {
    fontSize: 9,
    color: '#999',
    fontStyle: 'italic',
    marginBottom: 6,
  },
  satelliteToggle: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
  },
  satelliteToggleActive: {
    backgroundColor: '#FF9800',
    borderColor: '#FF9800',
  },
  satelliteToggleText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#666',
  },
  satelliteToggleTextActive: {
    color: 'white',
  },
  opacityContainer: {
    marginTop: 8,
  },
  opacityLabel: {
    fontSize: 10,
    color: '#666',
    marginBottom: 4,
  },
  offlineBadge: {
    position: 'absolute',
    bottom: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: '#4CAF50',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    zIndex: 1000,
  },
  offlineBadgeText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 11,
  },
});

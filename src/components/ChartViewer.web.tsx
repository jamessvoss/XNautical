/**
 * Offline Chart Viewer - Web Platform (Leaflet)
 * Uses bundled GeoJSON files for true offline operation
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
} from 'react-native';
import { MapContainer, TileLayer, GeoJSON, useMap, Marker, Tooltip, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Feature, FeatureCollection, Point } from 'geojson';
import L from 'leaflet';

// Import GeoJSON files as assets
const depareData = require('../../assets/Maps/depare.geojson');
const depcntData = require('../../assets/Maps/depcnt.geojson');
const soundgData = require('../../assets/Maps/soundg.geojson');
const lndareData = require('../../assets/Maps/lndare.geojson');

// Homer Spit, Alaska coordinates
const HOMER_HARBOR_CENTER: [number, number] = [59.605265, -151.416321]; // [lat, lng] for Leaflet

// ECDIS-style color scheme for depth areas
const getDepthColor = (depth: number): string => {
  if (depth <= 2) return '#A5D6FF';  // 0-2m: Very light blue
  if (depth <= 5) return '#8ECCFF';  // 2-5m: Light blue
  if (depth <= 10) return '#6BB8E8'; // 5-10m: Medium blue
  if (depth <= 20) return '#4A9FD8'; // 10-20m: Darker blue
  return '#B8D4E8';                  // 20m+: Deep water blue
};

// Get contour color based on depth
const getContourColor = (depth: number): string => {
  if (depth <= 5) return '#0066CC';
  if (depth <= 10) return '#0052A3';
  if (depth <= 20) return '#003D7A';
  return '#002952';
};

// Get contour line width based on zoom level
const getContourWidth = (zoom: number): number => {
  if (zoom < 12) return 1;
  if (zoom < 14) return 1.5;
  if (zoom < 16) return 2;
  return 2.5;
};

// Get font size based on zoom level
const getFontSize = (zoom: number): number => {
  if (zoom < 12) return 12;
  if (zoom < 13) return 14;
  if (zoom < 14) return 16;
  if (zoom < 15) return 18;
  if (zoom < 16) return 20;
  if (zoom < 17) return 22;
  return 24;
};

// Get decimation factor (how many points to skip) based on zoom
const getDecimationFactor = (zoom: number): number => {
  if (zoom < 12) return 32;  // Show very few
  if (zoom < 13) return 16;  // Show few
  if (zoom < 14) return 8;   // Show some
  if (zoom < 15) return 4;   // Show many
  if (zoom < 16) return 2;   // Show most
  return 1;                  // Show all
};

// Component to track zoom changes and trigger re-renders
function ZoomTracker({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMapEvents({
    zoomend: () => {
      onZoomChange(map.getZoom());
    },
  });
  
  useEffect(() => {
    onZoomChange(map.getZoom());
  }, []);
  
  return null;
}

export default function ChartViewer() {
  const [depareGeoJSON, setDepareGeoJSON] = useState<any>(null);
  const [depcntGeoJSON, setDepcntGeoJSON] = useState<any>(null);
  const [soundgGeoJSON, setSoundgGeoJSON] = useState<any>(null);
  const [lndareGeoJSON, setLndareGeoJSON] = useState<any>(null);
  
  const [showDepthAreas, setShowDepthAreas] = useState(true);
  const [showDepthContours, setShowDepthContours] = useState(true);
  const [showSoundings, setShowSoundings] = useState(true);
  const [showLand, setShowLand] = useState(true);
  const [showSatellite, setShowSatellite] = useState(false);
  
  const [currentZoom, setCurrentZoom] = useState(14);
  const [contourKey, setContourKey] = useState(0); // Force re-render of contours

  useEffect(() => {
    console.log('Loading GeoJSON data...');
    console.log('depareData:', depareData);
    console.log('depcntData:', depcntData);
    console.log('soundgData:', soundgData);
    console.log('lndareData:', lndareData);
    
    // Load GeoJSON data
    fetch(depareData)
      .then(res => res.json())
      .then(data => {
        console.log('Loaded depare:', data);
        setDepareGeoJSON(data);
      })
      .catch(err => console.error('Error loading depare:', err));
    
    fetch(depcntData)
      .then(res => res.json())
      .then(data => {
        console.log('Loaded depcnt:', data);
        setDepcntGeoJSON(data);
      })
      .catch(err => console.error('Error loading depcnt:', err));
    
    fetch(soundgData)
      .then(res => res.json())
      .then(data => {
        console.log('Loaded soundg (raw):', data);
        // Store the full dataset without pre-filtering
        setSoundgGeoJSON(data);
      })
      .catch(err => console.error('Error loading soundg:', err));
    
    fetch(lndareData)
      .then(res => res.json())
      .then(data => {
        console.log('Loaded lndare:', data);
        setLndareGeoJSON(data);
      })
      .catch(err => console.error('Error loading lndare:', err));
  }, []);

  // Handle zoom changes
  const handleZoomChange = useCallback((zoom: number) => {
    console.log('Zoom changed to:', zoom);
    setCurrentZoom(zoom);
    setContourKey(prev => prev + 1); // Force contour re-render
  }, []);

  // Filter soundings based on zoom level
  const filteredSoundings = React.useMemo(() => {
    if (!soundgGeoJSON) return null;
    
    const decimationFactor = getDecimationFactor(currentZoom);
    const transformedFeatures: any[] = [];
    
    soundgGeoJSON.features.forEach((feature: any, featureIndex: number) => {
      if (feature.geometry.type === 'MultiPoint') {
        feature.geometry.coordinates.forEach((coord: number[], pointIndex: number) => {
          // Decimate based on zoom level
          if ((featureIndex * 1000 + pointIndex) % decimationFactor === 0) {
            transformedFeatures.push({
              type: 'Feature',
              properties: feature.properties,
              geometry: {
                type: 'Point',
                coordinates: coord
              }
            });
          }
        });
      }
    });
    
    console.log(`Zoom ${currentZoom}: Showing ${transformedFeatures.length} soundings (decimation: ${decimationFactor})`);
    
    return {
      type: 'FeatureCollection',
      features: transformedFeatures
    };
  }, [soundgGeoJSON, currentZoom]);

  return (
    <View style={styles.container}>
      {/* Chart Info Header */}
      <View style={styles.header}>
        <Text style={styles.chartTitle}>Homer Harbor - OFFLINE MODE</Text>
        <Text style={styles.chartInfo}>
          Cell: US5AK5SI | Edition: 1 | 📡 No Internet Required
        </Text>
        <Text style={{fontSize: 10, color: 'white', marginTop: 4}}>
          Status: {depareGeoJSON ? '✓DepthAreas' : '⏳DepthAreas'} {' '}
          {depcntGeoJSON ? '✓Contours' : '⏳Contours'} {' '}
          {filteredSoundings ? `✓Soundings(${filteredSoundings.features?.length || 0})` : '⏳Soundings'} {' '}
          {lndareGeoJSON ? '✓Land' : '⏳Land'} | Zoom: {currentZoom}
        </Text>
      </View>

      {/* Map Container */}
      <MapContainer
        center={HOMER_HARBOR_CENTER}
        zoom={14}
        style={styles.map}
        zoomControl={true}
      >
        {/* Zoom tracker to update state */}
        <ZoomTracker onZoomChange={handleZoomChange} />
        
        {/* Ocean background (offline - no tiles needed) */}
        <TileLayer
          url="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg=="
          attribution='NOAA ENC Chart'
        />
        
        {/* Satellite/Imagery Layer (optional, requires internet) */}
        {showSatellite && (
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution='Esri'
            opacity={0.5}
          />
        )}

        {/* Depth Areas (colored polygons) */}
        {showDepthAreas && depareGeoJSON && (
          <GeoJSON
            data={depareGeoJSON}
            style={(feature) => ({
              fillColor: getDepthColor(feature?.properties?.DRVAL2 || 0),
              fillOpacity: 0.6,
              color: '#1976D2',
              weight: 1,
              opacity: 0.5,
            })}
          />
        )}

        {/* Depth Contours (lines) - with zoom-responsive width */}
        {showDepthContours && depcntGeoJSON && (
          <GeoJSON
            key={`contours-${contourKey}`}
            data={depcntGeoJSON}
            style={(feature) => ({
              color: getContourColor(feature?.properties?.VALDCO || 0),
              weight: getContourWidth(currentZoom),
              opacity: 0.8,
            })}
          />
        )}

        {/* Land Areas */}
        {showLand && lndareGeoJSON && (
          <GeoJSON
            data={lndareGeoJSON}
            style={{
              fillColor: '#E8D4A0',
              fillOpacity: 0.8,
              color: '#8B7355',
              weight: 1,
            }}
          />
        )}

        {/* Soundings (depth measurements) - zoom-responsive */}
        {showSoundings && filteredSoundings && filteredSoundings.features.map((feature: any, index: number) => {
          const coords = feature.geometry.coordinates;
          const depth = coords[2];
          
          if (depth !== undefined && !isNaN(parseFloat(String(depth)))) {
            const depthValue = parseFloat(String(depth)).toFixed(1);
            const latlng: [number, number] = [coords[1], coords[0]]; // [lat, lng]
            const fontSize = getFontSize(currentZoom);
            
            // Debug log for first sounding only
            if (index === 0) {
              console.log(`Rendering soundings at zoom ${currentZoom} with fontSize ${fontSize}px`);
            }
            
            // Create a responsive icon
            const depthIcon = L.divIcon({
              html: `<span style="color: #003D7A; font-size: ${fontSize}px; font-weight: 800; background: rgba(255,255,255,0.95); padding: 3px 6px; border-radius: 4px; display: inline-block; white-space: nowrap; line-height: 1.2; box-shadow: 0 2px 4px rgba(0,0,0,0.3); border: 1px solid rgba(0,61,122,0.2);">${depthValue}</span>`,
              className: '',
              iconSize: [1, 1],
              iconAnchor: [0, 0],
            });
            
            return (
              <Marker 
                key={`sounding-${index}-${currentZoom}`}
                position={latlng}
                icon={depthIcon}
              />
            );
          }
          return null;
        })}
      </MapContainer>

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
      </View>

      {/* Status Badge */}
      <View style={styles.offlineBadge}>
        <Text style={styles.offlineBadgeText}>📡 OFFLINE MODE - Leaflet + GeoJSON</Text>
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
  map: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#B8D4E8', // Ocean blue background
  },
  layerControl: {
    position: 'absolute',
    top: 100,
    right: 160, // Moved from left to avoid blocking map center
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

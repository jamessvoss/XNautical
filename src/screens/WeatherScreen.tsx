/**
 * Weather Screen
 * Main weather tab with vertical sidebar to toggle between:
 * - Marine Zone Forecasts (Zones) - Map with polygons
 * - WindyMap (Wind) - Windy.com WebView
 * - FAA Weather Cameras (Cams) - FAA WebView
 * - Live Buoy Data (Buoys) - Map with markers
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polygon, Region } from 'react-native-maps';
import { X, Maximize2, Minimize2, RotateCcw } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';

// Firebase
import { waitForAuth } from '../config/firebase';

// Services
import {
  getMarineZones,
  getMarineForecast,
  MarineZone,
  MarineForecast,
  formatForecastTime,
  getWfoName,
} from '../services/marineZoneService';
import {
  getBuoysCatalog,
  getBuoy,
  BuoySummary,
  Buoy,
  formatTemp,
  formatWaveHeight,
  formatWindSpeed,
  formatWindDirection,
  formatPressure,
  formatBuoyTimestamp,
} from '../services/buoyService';

// Components
import BuoyDetailModal from '../components/BuoyDetailModal';
import WindyMap from '../components/WindyMap';
import FAAWeatherCamsView from '../components/FAAWeatherCamsView';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

type WeatherView = 'zones' | 'wind' | 'cams' | 'buoys';

interface SidebarOption {
  id: WeatherView;
  label: string;
  icon: string;
}

const SIDEBAR_OPTIONS: SidebarOption[] = [
  { id: 'zones', label: 'Zones', icon: '🌊' },
  { id: 'wind', label: 'Wind', icon: '💨' },
  { id: 'cams', label: 'Cams', icon: '📷' },
  { id: 'buoys', label: 'Buoys', icon: '📡' },
];

// Alaska initial region
const INITIAL_REGION: Region = {
  latitude: 61.2,
  longitude: -149.9,
  latitudeDelta: 15,
  longitudeDelta: 15,
};

export default function WeatherScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [activeView, setActiveView] = useState<WeatherView>('zones');
  const [isFullscreen, setIsFullscreen] = useState(true);
  
  // TODO: Integrate with region selector to allow users to choose district
  // For now, default to Alaska (17cgd) where marine zone data exists
  const [currentDistrict] = useState<string>('17cgd');
  
  // Marine zones state
  const [zones, setZones] = useState<MarineZone[]>([]);
  const [loadingZones, setLoadingZones] = useState(false);
  const [selectedZone, setSelectedZone] = useState<MarineZone | null>(null);
  const [zoneForecast, setZoneForecast] = useState<MarineForecast | null>(null);
  const [loadingForecast, setLoadingForecast] = useState(false);
  
  // Buoys state
  const [buoys, setBuoys] = useState<BuoySummary[]>([]);
  const [loadingBuoys, setLoadingBuoys] = useState(false);
  const [selectedBuoy, setSelectedBuoy] = useState<BuoySummary | null>(null);
  const [buoyDetail, setBuoyDetail] = useState<Buoy | null>(null);
  const [loadingBuoyDetail, setLoadingBuoyDetail] = useState(false);
  
  // Map region state
  const [region, setRegion] = useState<Region>(INITIAL_REGION);

  // Load zones with full geometry on mount
  useEffect(() => {
    loadZones();
  }, []);

  // Load buoys when switching to buoys view
  useEffect(() => {
    if (activeView === 'buoys' && buoys.length === 0) {
      loadBuoys();
    }
  }, [activeView]);

  const loadZones = async () => {
    setLoadingZones(true);
    try {
      await waitForAuth();
      const zoneList = await getMarineZones(currentDistrict); // Get full geometry for map
      setZones(zoneList);
    } catch (error) {
      console.error('Error loading marine zones:', error);
    }
    setLoadingZones(false);
  };

  const loadBuoys = async () => {
    setLoadingBuoys(true);
    try {
      await waitForAuth();
      const buoyList = await getBuoysCatalog();
      setBuoys(buoyList);
    } catch (error) {
      console.error('Error loading buoys:', error);
    }
    setLoadingBuoys(false);
  };

  const handleZonePress = async (zone: MarineZone) => {
    setSelectedZone(zone);
    setLoadingForecast(true);
    try {
      const forecast = await getMarineForecast(currentDistrict, zone.id);
      setZoneForecast(forecast);
    } catch (error) {
      console.error('Error loading forecast:', error);
      setZoneForecast(null);
    }
    setLoadingForecast(false);
  };

  const handleBuoyPress = async (buoy: BuoySummary) => {
    setSelectedBuoy(buoy);
    setLoadingBuoyDetail(true);
    try {
      const detail = await getBuoy(buoy.id);
      setBuoyDetail(detail);
    } catch (error) {
      console.error('Error loading buoy detail:', error);
      setBuoyDetail(null);
    }
    setLoadingBuoyDetail(false);
  };

  // Convert GeoJSON coordinates to react-native-maps format
  const getPolygonCoords = (geometry: any) => {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') {
      return geometry.coordinates[0].map((coord: number[]) => ({
        latitude: coord[1],
        longitude: coord[0],
      }));
    } else if (geometry.type === 'MultiPolygon') {
      // For MultiPolygon, return the first polygon (largest)
      return geometry.coordinates[0][0].map((coord: number[]) => ({
        latitude: coord[1],
        longitude: coord[0],
      }));
    }
    return [];
  };

  // Render marine zones map view
  const renderZonesView = () => (
    <View style={styles.mapContainer}>
      {loadingZones && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#4FC3F7" />
          <Text style={styles.loadingText}>Loading zones...</Text>
        </View>
      )}
      
      <MapView
        style={styles.map}
        initialRegion={INITIAL_REGION}
        region={region}
        onRegionChangeComplete={setRegion}
        mapType="terrain"
        showsUserLocation={true}
        showsMyLocationButton={true}
      >
        {/* Marine Zone Polygons */}
        {zones.map((zone) => {
          const isSelected = selectedZone?.id === zone.id;
          const coords = getPolygonCoords(zone.geometry);
          if (coords.length === 0) return null;
          
          return (
            <Polygon
              key={zone.id}
              coordinates={coords}
              strokeColor={isSelected ? '#1E88E5' : '#2196F3'}
              strokeWidth={isSelected ? 3 : 2}
              fillColor={isSelected ? 'rgba(30, 136, 229, 0.35)' : 'rgba(33, 150, 243, 0.2)'}
              tappable={true}
              onPress={() => handleZonePress(zone)}
            />
          );
        })}

        {/* Marine Zone Labels (centroids) */}
        {zones.map((zone) => {
          if (!zone.centroid?.lat || !zone.centroid?.lon) return null;
          
          // Extract just the number portion (e.g., "722" from "PKZ722")
          const shortId = zone.id.replace(/^[A-Z]+/, '');
          
          return (
            <Marker
              key={`zone-label-${zone.id}`}
              coordinate={{
                latitude: zone.centroid.lat,
                longitude: zone.centroid.lon,
              }}
              onPress={() => handleZonePress(zone)}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View 
                style={{ 
                  backgroundColor: '#1565C0', 
                  borderRadius: 3, 
                  paddingHorizontal: 4, 
                  paddingVertical: 2,
                  borderWidth: 1,
                  borderColor: '#0D47A1',
                }}
                collapsable={false}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '700' }}>{shortId}</Text>
              </View>
            </Marker>
          );
        })}
      </MapView>

      {/* Zone Detail Panel */}
      {selectedZone && (
        <View style={styles.detailPanel}>
          <View style={styles.detailHeader}>
            <View style={styles.zoneIdBadge}>
              <Text style={styles.zoneIdText}>{selectedZone.id}</Text>
            </View>
            <View style={styles.detailTitleContainer}>
              <Text style={styles.detailTitle} numberOfLines={1}>{selectedZone.name}</Text>
              <Text style={styles.detailSubtitle}>{getWfoName(selectedZone.wfo)} WFO</Text>
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => {
                setSelectedZone(null);
                setZoneForecast(null);
              }}
            >
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailScrollContent}>
            {loadingForecast ? (
              <ActivityIndicator size="small" color="#4FC3F7" style={{ marginTop: 20 }} />
            ) : zoneForecast ? (
              <>
                {zoneForecast.advisory && (
                  <View style={styles.advisoryBadge}>
                    <Text style={styles.advisoryText}>{zoneForecast.advisory}</Text>
                  </View>
                )}
                {zoneForecast.synopsis && (
                  <Text style={styles.synopsisText}>{zoneForecast.synopsis}</Text>
                )}
                {zoneForecast.forecast?.map((period, idx) => (
                  <View key={idx} style={styles.forecastPeriod}>
                    <Text style={styles.periodName}>{period.name}:</Text>
                    <Text style={styles.periodForecast}>{period.detailedForecast}</Text>
                  </View>
                ))}
                {zoneForecast.nwsUpdated && (
                  <Text style={styles.updateTime}>
                    Updated: {formatForecastTime(zoneForecast.nwsUpdated)}
                  </Text>
                )}
              </>
            ) : (
              <Text style={styles.noDataText}>No forecast available</Text>
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );

  // Render buoys map view
  const renderBuoysView = () => (
    <View style={styles.mapContainer}>
      {loadingBuoys && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#4FC3F7" />
          <Text style={styles.loadingText}>Loading buoys...</Text>
        </View>
      )}
      
      <MapView
        style={styles.map}
        initialRegion={INITIAL_REGION}
        region={region}
        onRegionChangeComplete={setRegion}
        mapType="terrain"
        showsUserLocation={true}
        showsMyLocationButton={true}
      >
        {/* Buoy Markers */}
        {buoys.map((buoy) => (
          <Marker
            key={buoy.id}
            coordinate={{
              latitude: buoy.latitude,
              longitude: buoy.longitude,
            }}
            onPress={() => handleBuoyPress(buoy)}
            anchor={{ x: 0.5, y: 0.5 }}
            image={require('../../assets/symbols/Custom Symbols/LiveBuoy-lg.png')}
          />
        ))}
      </MapView>

      {/* Buoy Detail Modal - matches map page */}
      <BuoyDetailModal
        visible={selectedBuoy !== null}
        buoy={buoyDetail}
        loading={loadingBuoyDetail}
        onClose={() => {
          setSelectedBuoy(null);
          setBuoyDetail(null);
        }}
      />
    </View>
  );

  const handleRefresh = () => {
    console.log('[WeatherScreen] Refresh requested for view:', activeView);
    switch (activeView) {
      case 'zones':
        loadZones();
        break;
      case 'buoys':
        loadBuoys();
        break;
      default:
        // Wind and Cams don't need refresh
        break;
    }
  };

  const handleClose = () => {
    setActiveView('zones');
  };

  // Get header title based on active view
  const getHeaderTitle = () => {
    switch (activeView) {
      case 'zones':
        return 'Marine Zones';
      case 'wind':
        return 'Weather Forecast';
      case 'cams':
        return 'Weather Cams';
      case 'buoys':
        return 'Weather Buoys';
      default:
        return 'Weather Forecast';
    }
  };

  // Render active view content
  const renderContent = () => {
    switch (activeView) {
      case 'zones':
        return renderZonesView();
      case 'wind':
        return <WindyMap visible={true} embedded={true} />;
      case 'cams':
        return <FAAWeatherCamsView visible={true} embedded={true} />;
      case 'buoys':
        return renderBuoysView();
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{getHeaderTitle()}</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={handleRefresh}
          >
            <RotateCcw size={20} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => setIsFullscreen(!isFullscreen)}
          >
            {isFullscreen ? (
              <Minimize2 size={20} color="#FFF" />
            ) : (
              <Maximize2 size={20} color="#FFF" />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={handleClose}
          >
            <X size={20} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>
      
      <View style={styles.content}>
        {/* Main Content Area - Full Screen */}
        <View style={styles.mainContent}>
          {renderContent()}
        </View>
        
        {/* Floating Sidebar - Upper Left */}
        <View style={[styles.layerSidebar, { top: insets.top + 60 }]}>
          <TouchableOpacity
            style={[styles.sidebarButton, activeView === 'zones' && styles.sidebarButtonActive]}
            onPress={() => setActiveView('zones')}
          >
            <Text style={styles.sidebarIcon}>🌊</Text>
            <Text style={styles.sidebarLabel}>Zones</Text>
          </TouchableOpacity>
          
          <View style={styles.sidebarDivider} />
          
          <TouchableOpacity
            style={[styles.sidebarButton, activeView === 'wind' && styles.sidebarButtonActive]}
            onPress={() => setActiveView('wind')}
          >
            <Text style={styles.sidebarIcon}>💨</Text>
            <Text style={styles.sidebarLabel}>Wind</Text>
          </TouchableOpacity>
          
          <View style={styles.sidebarDivider} />
          
          <TouchableOpacity
            style={[styles.sidebarButton, activeView === 'cams' && styles.sidebarButtonActive]}
            onPress={() => setActiveView('cams')}
          >
            <Text style={styles.sidebarIcon}>📷</Text>
            <Text style={styles.sidebarLabel}>Cams</Text>
          </TouchableOpacity>
          
          <View style={styles.sidebarDivider} />
          
          <TouchableOpacity
            style={[styles.sidebarButton, activeView === 'buoys' && styles.sidebarButtonActive]}
            onPress={() => setActiveView('buoys')}
          >
            <Text style={styles.sidebarIcon}>📡</Text>
            <Text style={styles.sidebarLabel}>Buoys</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#16213e',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  headerButton: {
    padding: 4,
  },
  content: {
    flex: 1,
  },
  mainContent: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  layerSidebar: {
    position: 'absolute',
    left: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 8,
    paddingTop: 4,
    paddingBottom: 6,
    paddingHorizontal: 4,
  },
  sidebarButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 2,
    marginVertical: 1,
    borderRadius: 4,
    minWidth: 48,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sidebarButtonActive: {
    backgroundColor: 'rgba(79, 195, 247, 0.4)',
    borderColor: 'rgba(79, 195, 247, 0.8)',
  },
  sidebarIcon: {
    fontSize: 20,
  },
  sidebarLabel: {
    fontSize: 9,
    fontWeight: '600',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    color: '#FFFFFF',
  },
  sidebarDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginVertical: 3,
    marginHorizontal: 4,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  map: {
    flex: 1,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    zIndex: 10,
  },
  loadingText: {
    marginTop: 12,
    color: '#4FC3F7',
    fontSize: 14,
  },
  zoneLabelMarker: {
    backgroundColor: '#1565C0',
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#0D47A1',
  },
  zoneLabelText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
  },
  detailPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: SCREEN_HEIGHT * 0.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  zoneIdBadge: {
    backgroundColor: '#1565C0',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 12,
  },
  zoneIdText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  detailTitleContainer: {
    flex: 1,
  },
  detailTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  detailSubtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 2,
  },
  closeButton: {
    padding: 8,
  },
  closeButtonText: {
    fontSize: 24,
    color: 'rgba(255, 255, 255, 0.7)',
    lineHeight: 24,
  },
  detailScroll: {
    flex: 1,
  },
  detailScrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  advisoryBadge: {
    backgroundColor: '#FF5722',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  advisoryText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  synopsisText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    lineHeight: 20,
    marginBottom: 12,
  },
  forecastPeriod: {
    marginBottom: 12,
  },
  periodName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4FC3F7',
    marginBottom: 4,
  },
  periodForecast: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    lineHeight: 20,
  },
  noDataText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.5)',
    fontStyle: 'italic',
    marginTop: 20,
    textAlign: 'center',
  },
});

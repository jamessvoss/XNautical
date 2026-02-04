/**
 * Weather Screen
 * Main weather tab with vertical sidebar to toggle between:
 * - Marine Zone Forecasts (Zones)
 * - WindyMap (Wind)
 * - FAA Weather Cameras (Cams)
 * - Live Buoy Data (Buoys)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Firebase
import { waitForAuth } from '../config/firebase';

// Services
import {
  getMarineZoneSummaries,
  getMarineForecast,
  MarineZoneSummary,
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
import WindyMap from '../components/WindyMap';
import FAAWeatherCamsView from '../components/FAAWeatherCamsView';

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

export default function WeatherScreen() {
  const [activeView, setActiveView] = useState<WeatherView>('zones');
  
  // Marine zones state
  const [zones, setZones] = useState<MarineZoneSummary[]>([]);
  const [loadingZones, setLoadingZones] = useState(false);
  const [selectedZone, setSelectedZone] = useState<MarineZoneSummary | null>(null);
  const [zoneForecast, setZoneForecast] = useState<MarineForecast | null>(null);
  const [loadingForecast, setLoadingForecast] = useState(false);
  
  // Buoys state
  const [buoys, setBuoys] = useState<BuoySummary[]>([]);
  const [loadingBuoys, setLoadingBuoys] = useState(false);
  const [selectedBuoy, setSelectedBuoy] = useState<BuoySummary | null>(null);
  const [buoyDetail, setBuoyDetail] = useState<Buoy | null>(null);
  const [loadingBuoyDetail, setLoadingBuoyDetail] = useState(false);
  
  // Refreshing state
  const [refreshing, setRefreshing] = useState(false);

  // Load zones on mount
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
      // Wait for authentication before accessing Firestore
      await waitForAuth();
      const zoneList = await getMarineZoneSummaries();
      setZones(zoneList);
    } catch (error) {
      console.error('Error loading marine zones:', error);
    }
    setLoadingZones(false);
  };

  const loadBuoys = async () => {
    setLoadingBuoys(true);
    try {
      // Wait for authentication before accessing Firestore
      await waitForAuth();
      const buoyList = await getBuoysCatalog();
      setBuoys(buoyList);
    } catch (error) {
      console.error('Error loading buoys:', error);
    }
    setLoadingBuoys(false);
  };

  const handleZonePress = async (zone: MarineZoneSummary) => {
    if (selectedZone?.id === zone.id) {
      // Collapse if already selected
      setSelectedZone(null);
      setZoneForecast(null);
      return;
    }
    
    setSelectedZone(zone);
    setLoadingForecast(true);
    try {
      const forecast = await getMarineForecast(zone.id);
      setZoneForecast(forecast);
    } catch (error) {
      console.error('Error loading forecast:', error);
      setZoneForecast(null);
    }
    setLoadingForecast(false);
  };

  const handleBuoyPress = async (buoy: BuoySummary) => {
    if (selectedBuoy?.id === buoy.id) {
      // Collapse if already selected
      setSelectedBuoy(null);
      setBuoyDetail(null);
      return;
    }
    
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (activeView === 'zones') {
      await loadZones();
    } else if (activeView === 'buoys') {
      await loadBuoys();
    }
    setRefreshing(false);
  }, [activeView]);

  // Render marine zones list
  const renderZonesView = () => (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#4FC3F7"
          colors={['#4FC3F7']}
        />
      }
    >
      <Text style={styles.viewTitle}>Marine Weather Zones</Text>
      <Text style={styles.viewSubtitle}>NWS Alaska Marine Forecasts</Text>
      
      {loadingZones ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4FC3F7" />
          <Text style={styles.loadingText}>Loading zones...</Text>
        </View>
      ) : zones.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No marine zones available</Text>
          <Text style={styles.emptySubtext}>Pull down to refresh</Text>
        </View>
      ) : (
        zones.map((zone) => (
          <TouchableOpacity
            key={zone.id}
            style={[
              styles.card,
              selectedZone?.id === zone.id && styles.cardSelected,
            ]}
            onPress={() => handleZonePress(zone)}
            activeOpacity={0.7}
          >
            <View style={styles.cardHeader}>
              <View style={styles.zoneIdBadge}>
                <Text style={styles.zoneIdText}>{zone.id}</Text>
              </View>
              <View style={styles.cardTitleContainer}>
                <Text style={styles.cardTitle} numberOfLines={1}>{zone.name}</Text>
                <Text style={styles.cardSubtitle}>{getWfoName(zone.wfo)} WFO</Text>
              </View>
              <Text style={styles.expandIcon}>
                {selectedZone?.id === zone.id ? '▼' : '▶'}
              </Text>
            </View>
            
            {selectedZone?.id === zone.id && (
              <View style={styles.forecastContainer}>
                {loadingForecast ? (
                  <ActivityIndicator size="small" color="#4FC3F7" />
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
                    {zoneForecast.forecast?.slice(0, 3).map((period, idx) => (
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
              </View>
            )}
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );

  // Render buoys list
  const renderBuoysView = () => (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#4FC3F7"
          colors={['#4FC3F7']}
        />
      }
    >
      <Text style={styles.viewTitle}>Live Buoy Data</Text>
      <Text style={styles.viewSubtitle}>NOAA NDBC Weather Buoys</Text>
      
      {loadingBuoys ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4FC3F7" />
          <Text style={styles.loadingText}>Loading buoys...</Text>
        </View>
      ) : buoys.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No buoy data available</Text>
          <Text style={styles.emptySubtext}>Pull down to refresh</Text>
        </View>
      ) : (
        buoys.map((buoy) => (
          <TouchableOpacity
            key={buoy.id}
            style={[
              styles.card,
              selectedBuoy?.id === buoy.id && styles.cardSelected,
            ]}
            onPress={() => handleBuoyPress(buoy)}
            activeOpacity={0.7}
          >
            <View style={styles.cardHeader}>
              <View style={styles.buoyIcon}>
                <Text style={styles.buoyIconText}>📡</Text>
              </View>
              <View style={styles.cardTitleContainer}>
                <Text style={styles.cardTitle} numberOfLines={1}>{buoy.name}</Text>
                <Text style={styles.cardSubtitle}>{buoy.type || 'Weather Buoy'}</Text>
              </View>
              <Text style={styles.expandIcon}>
                {selectedBuoy?.id === buoy.id ? '▼' : '▶'}
              </Text>
            </View>
            
            {selectedBuoy?.id === buoy.id && (
              <View style={styles.buoyDetailContainer}>
                {loadingBuoyDetail ? (
                  <ActivityIndicator size="small" color="#4FC3F7" />
                ) : buoyDetail?.latestObservation ? (
                  <>
                    <View style={styles.buoyDataGrid}>
                      <View style={styles.buoyDataItem}>
                        <Text style={styles.buoyDataLabel}>Water Temp</Text>
                        <Text style={styles.buoyDataValue}>
                          {formatTemp(buoyDetail.latestObservation.waterTemp)}
                        </Text>
                      </View>
                      <View style={styles.buoyDataItem}>
                        <Text style={styles.buoyDataLabel}>Air Temp</Text>
                        <Text style={styles.buoyDataValue}>
                          {formatTemp(buoyDetail.latestObservation.airTemp)}
                        </Text>
                      </View>
                      <View style={styles.buoyDataItem}>
                        <Text style={styles.buoyDataLabel}>Wind</Text>
                        <Text style={styles.buoyDataValue}>
                          {formatWindSpeed(buoyDetail.latestObservation.windSpeed)}{' '}
                          {formatWindDirection(buoyDetail.latestObservation.windDirection)}
                        </Text>
                      </View>
                      <View style={styles.buoyDataItem}>
                        <Text style={styles.buoyDataLabel}>Waves</Text>
                        <Text style={styles.buoyDataValue}>
                          {formatWaveHeight(buoyDetail.latestObservation.waveHeight)}
                        </Text>
                      </View>
                      <View style={styles.buoyDataItem}>
                        <Text style={styles.buoyDataLabel}>Pressure</Text>
                        <Text style={styles.buoyDataValue}>
                          {formatPressure(buoyDetail.latestObservation.pressure)}
                        </Text>
                      </View>
                      {buoyDetail.latestObservation.swellHeight && (
                        <View style={styles.buoyDataItem}>
                          <Text style={styles.buoyDataLabel}>Swell</Text>
                          <Text style={styles.buoyDataValue}>
                            {formatWaveHeight(buoyDetail.latestObservation.swellHeight)}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.updateTime}>
                      Updated: {formatBuoyTimestamp(buoyDetail.latestObservation.timestamp)}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.noDataText}>No observation data available</Text>
                )}
              </View>
            )}
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );

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
      <View style={styles.content}>
        {/* Vertical Sidebar */}
        <View style={styles.sidebar}>
          {SIDEBAR_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.id}
              style={[
                styles.sidebarButton,
                activeView === option.id && styles.sidebarButtonActive,
              ]}
              onPress={() => setActiveView(option.id)}
            >
              <Text style={styles.sidebarIcon}>{option.icon}</Text>
              <Text
                style={[
                  styles.sidebarLabel,
                  activeView === option.id && styles.sidebarLabelActive,
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Main Content Area */}
        <View style={styles.mainContent}>
          {renderContent()}
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
  content: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 70,
    backgroundColor: '#1e293b',
    paddingVertical: 12,
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255, 255, 255, 0.1)',
  },
  sidebarButton: {
    width: 60,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    marginBottom: 8,
  },
  sidebarButtonActive: {
    backgroundColor: 'rgba(79, 195, 247, 0.2)',
  },
  sidebarIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  sidebarLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
  },
  sidebarLabelActive: {
    color: '#4FC3F7',
  },
  mainContent: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  viewTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  viewSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.5)',
    marginBottom: 20,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#4FC3F7',
    fontSize: 14,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.4)',
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  cardSelected: {
    borderColor: '#4FC3F7',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
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
  buoyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 152, 0, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  buoyIconText: {
    fontSize: 20,
  },
  cardTitleContainer: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  cardSubtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 2,
  },
  expandIcon: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    marginLeft: 8,
  },
  forecastContainer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
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
  updateTime: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.4)',
    marginTop: 8,
  },
  noDataText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.5)',
    fontStyle: 'italic',
  },
  buoyDetailContainer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  buoyDataGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -8,
  },
  buoyDataItem: {
    width: '50%',
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  buoyDataLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginBottom: 2,
  },
  buoyDataValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});

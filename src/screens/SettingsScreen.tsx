/**
 * Settings Screen - App configuration and cache management
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAuth, signOut } from '@react-native-firebase/auth';
import * as chartCacheService from '../services/chartCacheService';
import { formatBytes } from '../services/chartService';
import * as displaySettingsService from '../services/displaySettingsService';
import type { DisplaySettings } from '../services/displaySettingsService';
import SystemInfoModal from '../components/SystemInfoModal';
import * as themeService from '../services/themeService';
import type { UITheme } from '../services/themeService';
import { fetchTideStations, fetchCurrentStations, clearStationCache } from '../services/stationService';
import type { TideStation, CurrentStation } from '../services/stationService';

export default function SettingsScreen() {
  const [cacheSize, setCacheSize] = useState<number>(0);
  const [downloadedCount, setDownloadedCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [showSystemInfo, setShowSystemInfo] = useState(false);
  
  // Tide & Current data
  const [tideStations, setTideStations] = useState<TideStation[]>([]);
  const [currentStations, setCurrentStations] = useState<CurrentStation[]>([]);
  const [tidesLoading, setTidesLoading] = useState(false);
  
  // Theme state
  const [uiTheme, setUITheme] = useState<UITheme>(themeService.getUITheme());
  
  // Subscribe to theme changes
  useEffect(() => {
    const unsubscribe = themeService.subscribeToModeChanges((mode) => {
      setUITheme(themeService.getUITheme(mode));
    });
    return unsubscribe;
  }, []);
  
  // Dynamic themed styles
  const themedStyles = useMemo(() => ({
    container: {
      backgroundColor: uiTheme.panelBackgroundSolid,
    },
    header: {
      backgroundColor: uiTheme.cardBackground,
      borderBottomColor: uiTheme.divider,
    },
    headerTitle: {
      color: uiTheme.textPrimary,
    },
    sectionTitle: {
      color: uiTheme.textSecondary,
    },
    card: {
      backgroundColor: uiTheme.cardBackground,
    },
    row: {
      borderBottomColor: uiTheme.divider,
    },
    label: {
      color: uiTheme.textPrimary,
    },
    value: {
      color: uiTheme.textSecondary,
    },
    valueSmall: {
      color: uiTheme.textMuted,
    },
    sliderTrack: uiTheme.sliderTrack,
    sliderTrackActive: uiTheme.sliderTrackActive,
    sliderThumb: uiTheme.sliderThumb,
  }), [uiTheme]);
  
  // Display settings
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>({
    // Font sizes (1.5 = nominal 100%, range 1.0-3.0)
    soundingsFontScale: 1.5,
    gnisFontScale: 1.5,
    depthContourFontScale: 1.5,
    chartLabelsFontScale: 1.5,
    // Text halo/stroke
    soundingsHaloScale: 1.0,
    gnisHaloScale: 1.0,
    depthContourLabelHaloScale: 1.0,
    chartLabelsHaloScale: 1.0,
    // Text opacities
    soundingsOpacityScale: 1.0,
    gnisOpacityScale: 1.0,
    depthContourLabelOpacityScale: 1.0,
    chartLabelsOpacityScale: 1.0,
    // Line widths
    depthContourLineScale: 1.0,
    coastlineLineScale: 1.0,
    cableLineScale: 1.0,
    pipelineLineScale: 1.0,
    bridgeLineScale: 1.0,
    mooringLineScale: 1.0,
    shorelineConstructionLineScale: 1.0,
    // Line halos - temporarily disabled to debug crash
    depthContourLineHaloScale: 0,
    coastlineHaloScale: 0,
    cableLineHaloScale: 0,
    pipelineLineHaloScale: 0,
    bridgeLineHaloScale: 0,
    mooringLineHaloScale: 0,
    shorelineConstructionHaloScale: 0,
    // Line opacities
    depthContourLineOpacityScale: 1.0,
    coastlineOpacityScale: 1.0,
    cableLineOpacityScale: 1.0,
    pipelineLineOpacityScale: 1.0,
    bridgeOpacityScale: 1.0,
    mooringOpacityScale: 1.0,
    shorelineConstructionOpacityScale: 1.0,
    // Area opacities
    depthAreaOpacityScale: 1.0,
    restrictedAreaOpacityScale: 1.0,
    cautionAreaOpacityScale: 1.0,
    militaryAreaOpacityScale: 1.0,
    anchorageOpacityScale: 1.0,
    marineFarmOpacityScale: 1.0,
    cableAreaOpacityScale: 1.0,
    pipelineAreaOpacityScale: 1.0,
    fairwayOpacityScale: 1.0,
    dredgedAreaOpacityScale: 1.0,
    // Area strokes
    depthAreaStrokeScale: 1.0,
    restrictedAreaStrokeScale: 1.0,
    cautionAreaStrokeScale: 1.0,
    militaryAreaStrokeScale: 1.0,
    anchorageStrokeScale: 1.0,
    marineFarmStrokeScale: 1.0,
    cableAreaStrokeScale: 1.0,
    pipelineAreaStrokeScale: 1.0,
    fairwayStrokeScale: 1.0,
    dredgedAreaStrokeScale: 1.0,
    // Symbol sizes (nominal values per S-52)
    lightSymbolSizeScale: 2.0,    // 200% nominal
    buoySymbolSizeScale: 2.0,     // 200% nominal
    beaconSymbolSizeScale: 1.5,   // 150% nominal
    wreckSymbolSizeScale: 1.5,
    rockSymbolSizeScale: 1.5,
    hazardSymbolSizeScale: 1.5,
    landmarkSymbolSizeScale: 1.5,
    mooringSymbolSizeScale: 1.5,
    anchorSymbolSizeScale: 1.5,
    // Symbol halos (white background per S-52)
    lightSymbolHaloScale: 1.0,
    buoySymbolHaloScale: 1.0,
    beaconSymbolHaloScale: 1.0,
    wreckSymbolHaloScale: 1.0,
    rockSymbolHaloScale: 1.0,
    hazardSymbolHaloScale: 1.0,
    landmarkSymbolHaloScale: 1.0,
    mooringSymbolHaloScale: 1.0,
    anchorSymbolHaloScale: 1.0,
    // Symbol opacities
    lightSymbolOpacityScale: 1.0,
    buoySymbolOpacityScale: 1.0,
    beaconSymbolOpacityScale: 1.0,
    wreckSymbolOpacityScale: 1.0,
    rockSymbolOpacityScale: 1.0,
    hazardSymbolOpacityScale: 1.0,
    landmarkSymbolOpacityScale: 1.0,
    mooringSymbolOpacityScale: 1.0,
    anchorSymbolOpacityScale: 1.0,
    // Other settings
    dayNightMode: 'dusk',
    orientationMode: 'north-up',
    depthUnits: 'meters',
  });

  useEffect(() => {
    loadCacheInfo();
    loadDisplaySettings();
    loadTideData();
  }, []);

  const loadCacheInfo = async () => {
    try {
      setLoading(true);
      const size = await chartCacheService.getCacheSize();
      const ids = await chartCacheService.getDownloadedChartIds();
      setCacheSize(size);
      setDownloadedCount(ids.length);
    } catch (error) {
      console.error('Error loading cache info:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadDisplaySettings = async () => {
    const settings = await displaySettingsService.loadSettings();
    setDisplaySettings(settings);
  };

  const loadTideData = async () => {
    try {
      setTidesLoading(true);
      console.log('Loading tide/current data...');
      const [tides, currents] = await Promise.all([
        fetchTideStations(),
        fetchCurrentStations(),
      ]);
      console.log(`Loaded ${tides.length} tide stations, ${currents.length} current stations`);
      setTideStations(tides);
      setCurrentStations(currents);
    } catch (error) {
      console.error('Error loading tide/current data:', error);
      Alert.alert(
        'Error Loading Data',
        `Failed to load tide/current data: ${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease check your internet connection and try again.`,
        [{ text: 'OK' }]
      );
    } finally {
      setTidesLoading(false);
    }
  };

  const getDateRange = (stations: (TideStation | CurrentStation)[]) => {
    let earliestDate: string | null = null;
    let latestDate: string | null = null;
    
    stations.forEach(station => {
      if (!station.predictions) return;
      const dates = Object.keys(station.predictions).sort();
      if (dates.length === 0) return;
      
      const first = dates[0];
      const last = dates[dates.length - 1];
      
      if (!earliestDate || first < earliestDate) earliestDate = first;
      if (!latestDate || last > latestDate) latestDate = last;
    });
    
    if (!earliestDate || !latestDate) return 'No data';
    
    // Format dates nicely
    const formatDate = (dateStr: string) => {
      const [year, month, day] = dateStr.split('-');
      return `${month}/${day}/${year}`;
    };
    
    return `${formatDate(earliestDate)} - ${formatDate(latestDate)}`;
  };

  const getStationsWithData = (stations: (TideStation | CurrentStation)[]) => {
    return stations.filter(s => s.predictions && Object.keys(s.predictions).length > 0).length;
  };

  const getMemorySize = (stations: (TideStation | CurrentStation)[]) => {
    // Rough estimate: JSON.stringify the predictions data
    let totalBytes = 0;
    stations.forEach(station => {
      if (station.predictions) {
        totalBytes += JSON.stringify(station.predictions).length;
      }
    });
    return formatBytes(totalBytes);
  };

  const handleRefreshTideData = async () => {
    clearStationCache();
    await loadTideData();
  };

  const updateDisplaySetting = async <K extends keyof DisplaySettings>(
    key: K,
    value: DisplaySettings[K]
  ) => {
    const newSettings = { ...displaySettings, [key]: value };
    setDisplaySettings(newSettings);
    await displaySettingsService.saveSettings(newSettings);
  };

  const resetDisplaySettings = () => {
    Alert.alert(
      'Reset Display Settings',
      'Reset area opacity settings to default values? (Other display settings like text size, line width, and symbol controls are in the Layers panel)',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          onPress: async () => {
            await displaySettingsService.resetSettings();
            const settings = await displaySettingsService.loadSettings();
            setDisplaySettings(settings);
          },
        },
      ]
    );
  };

  const formatScale = (scale: number) => {
    const percent = Math.round(scale * 100);
    return `${percent}%`;
  };

  const handleClearCache = () => {
    Alert.alert(
      'Clear All Charts',
      'This will delete all downloaded charts from your device. You can re-download them later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              setClearing(true);
              await chartCacheService.clearAllCharts();
              setCacheSize(0);
              setDownloadedCount(0);
              Alert.alert('Success', 'All cached charts have been cleared.');
            } catch (error) {
              Alert.alert('Error', 'Failed to clear cache.');
            } finally {
              setClearing(false);
            }
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              const authInstance = getAuth();
              await signOut(authInstance);
            } catch (error) {
              console.error('Logout error:', error);
            }
          },
        },
      ]
    );
  };

  const user = getAuth().currentUser;

  return (
    <SafeAreaView style={[styles.container, themedStyles.container]} edges={['top']}>
      <View style={[styles.header, themedStyles.header]}>
        <Text style={[styles.headerTitle, themedStyles.headerTitle]}>Settings</Text>
      </View>

      <ScrollView style={styles.content}>
        {/* Account Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>Account</Text>
          <View style={[styles.card, themedStyles.card]}>
            <View style={[styles.row, themedStyles.row]}>
              <Text style={[styles.label, themedStyles.label]}>Email</Text>
              <Text style={[styles.value, themedStyles.value]}>{user?.email || 'Not logged in'}</Text>
            </View>
            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
              <Text style={styles.logoutButtonText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Tides & Currents Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>Tides & Currents</Text>
          <View style={[styles.card, themedStyles.card]}>
            {tidesLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#007AFF" />
                <Text style={[styles.loadingText, themedStyles.label]}>Loading tide data...</Text>
              </View>
            ) : (
              <>
                {/* Tide Stations */}
                <View style={[styles.row, themedStyles.row]}>
                  <Text style={[styles.label, themedStyles.label]}>Tide Stations</Text>
                  <Text style={[styles.value, themedStyles.value]}>
                    {getStationsWithData(tideStations)} / {tideStations.length}
                  </Text>
                </View>
                <View style={[styles.row, themedStyles.row]}>
                  <Text style={[styles.label, themedStyles.label]}>Tide Date Range</Text>
                  <Text style={[styles.valueSmall, themedStyles.valueSmall]}>
                    {getDateRange(tideStations)}
                  </Text>
                </View>
                <View style={[styles.row, themedStyles.row]}>
                  <Text style={[styles.label, themedStyles.label]}>Tide Data Size</Text>
                  <Text style={[styles.value, themedStyles.value]}>
                    {getMemorySize(tideStations)}
                  </Text>
                </View>
                
                {/* Current Stations */}
                <View style={[styles.row, themedStyles.row]}>
                  <Text style={[styles.label, themedStyles.label]}>Current Stations</Text>
                  <Text style={[styles.value, themedStyles.value]}>
                    {getStationsWithData(currentStations)} / {currentStations.length}
                  </Text>
                </View>
                <View style={[styles.row, themedStyles.row]}>
                  <Text style={[styles.label, themedStyles.label]}>Current Date Range</Text>
                  <Text style={[styles.valueSmall, themedStyles.valueSmall]}>
                    {getDateRange(currentStations)}
                  </Text>
                </View>
                <View style={[styles.row, themedStyles.row]}>
                  <Text style={[styles.label, themedStyles.label]}>Current Data Size</Text>
                  <Text style={[styles.value, themedStyles.value]}>
                    {getMemorySize(currentStations)}
                  </Text>
                </View>
                
                {/* Total */}
                <View style={[styles.row, { borderBottomWidth: 0 }]}>
                  <Text style={[styles.label, themedStyles.label, { fontWeight: '600' }]}>Total Memory</Text>
                  <Text style={[styles.value, themedStyles.value, { fontWeight: '600' }]}>
                    {formatBytes(
                      JSON.stringify(tideStations.map(s => s.predictions)).length +
                      JSON.stringify(currentStations.map(s => s.predictions)).length
                    )}
                  </Text>
                </View>
                
                <TouchableOpacity 
                  style={styles.refreshTideButton} 
                  onPress={handleRefreshTideData}
                  disabled={tidesLoading}
                >
                  <Text style={styles.refreshTideButtonText}>
                    Refresh Tide Data
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* Storage Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>Storage</Text>
          <View style={[styles.card, themedStyles.card]}>
            {loading ? (
              <ActivityIndicator size="small" color="#007AFF" />
            ) : (
              <>
                <View style={[styles.row, themedStyles.row]}>
                  <Text style={[styles.label, themedStyles.label]}>Downloaded Charts</Text>
                  <Text style={[styles.value, themedStyles.value]}>{downloadedCount}</Text>
                </View>
                <View style={[styles.row, themedStyles.row]}>
                  <Text style={[styles.label, themedStyles.label]}>Cache Size</Text>
                  <Text style={[styles.value, themedStyles.value]}>{formatBytes(cacheSize)}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.clearButton, clearing && styles.clearButtonDisabled]}
                  onPress={handleClearCache}
                  disabled={clearing || downloadedCount === 0}
                >
                  {clearing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.clearButtonText}>Clear All Charts</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* About Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>About</Text>
          <View style={[styles.card, themedStyles.card]}>
            <View style={[styles.row, themedStyles.row]}>
              <Text style={[styles.label, themedStyles.label]}>App Version</Text>
              <Text style={[styles.value, themedStyles.value]}>1.0.0</Text>
            </View>
            <View style={[styles.row, themedStyles.row]}>
              <Text style={[styles.label, themedStyles.label]}>Data Source</Text>
              <Text style={[styles.value, themedStyles.value]}>NOAA ENC</Text>
            </View>
          </View>
        </View>

        {/* Developer Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>Developer</Text>
          <View style={[styles.card, themedStyles.card]}>
            <View style={[styles.row, { borderBottomWidth: 0 }]}>
              <Text style={[styles.label, themedStyles.label]}>Technical Debug</Text>
              <Text style={[styles.valueSmall, themedStyles.valueSmall]}>Available in Layers menu{'\n'}under "Show Active Chart"</Text>
            </View>
          </View>
        </View>

        {/* Refresh Cache Info */}
        <TouchableOpacity style={styles.refreshButton} onPress={loadCacheInfo}>
          <Text style={styles.refreshButtonText}>Refresh Cache Info</Text>
        </TouchableOpacity>
        
        {/* System Info Button */}
        <TouchableOpacity 
          style={styles.systemInfoButton} 
          onPress={() => setShowSystemInfo(true)}
        >
          <Text style={styles.systemInfoButtonText}>System Information</Text>
        </TouchableOpacity>
      </ScrollView>
      
      {/* System Info Modal */}
      <SystemInfoModal 
        visible={showSystemInfo} 
        onClose={() => setShowSystemInfo(false)} 
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },
  content: {
    flex: 1,
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  label: {
    fontSize: 16,
    color: '#333',
  },
  value: {
    fontSize: 16,
    color: '#666',
  },
  valueSmall: {
    fontSize: 12,
    color: '#999',
    textAlign: 'right',
  },
  logoutButton: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dc3545',
  },
  logoutButtonText: {
    color: '#dc3545',
    fontSize: 16,
    fontWeight: '600',
  },
  clearButton: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#dc3545',
  },
  clearButtonDisabled: {
    backgroundColor: '#ccc',
  },
  clearButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  refreshButton: {
    margin: 16,
    marginTop: 32,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#007AFF',
  },
  refreshButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  refreshTideButton: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#007AFF',
  },
  refreshTideButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  sliderRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sliderValue: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '600',
    minWidth: 50,
    textAlign: 'right',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  resetButton: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  resetButtonText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '600',
  },
  systemInfoButton: {
    margin: 16,
    marginTop: 8,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#6c757d',
  },
  systemInfoButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingContainer: {
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666',
  },
});

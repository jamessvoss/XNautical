/**
 * StatsContent
 * 
 * Read-only statistics display for the Context tab.
 * Shows Account, Tides & Currents, Storage, and About information.
 * No action buttons - all actions are handled via Downloads modal.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { getAuth } from '@react-native-firebase/auth';
import * as chartCacheService from '../services/chartCacheService';
import { formatBytes } from '../services/chartService';
import * as themeService from '../services/themeService';
import type { UITheme } from '../services/themeService';
import {
  arePredictionsDownloaded,
  getPredictionDatabaseStats,
  clearPredictions,
  downloadAllPredictions,
  clearStationCache,
} from '../services/stationService';
import type { PredictionDatabaseStats } from '../services/stationService';
import { getInstalledDistrictIds, getInstalledDistrict } from '../services/regionRegistryService';
import { areBuoysDownloaded } from '../services/buoyService';
import { areMarineZonesDownloaded } from '../services/marineZoneService';
import { getRegionByFirestoreId } from '../config/regionData';
import RegionManageModal from './RegionManageModal';

export default function StatsContent() {
  console.log('[StatsContent] Initializing...');
  const [loading, setLoading] = useState(true);
  
  // Storage tracking
  const [mbtilesCount, setMbtilesCount] = useState<number>(0);
  const [mbtilesSize, setMbtilesSize] = useState<number>(0);
  const [tidesDbSize, setTidesDbSize] = useState<number>(0);
  const [currentsDbSize, setCurrentsDbSize] = useState<number>(0);
  const [availableStorage, setAvailableStorage] = useState<number>(0);
  
  // Database stats
  const [dbStats, setDbStats] = useState<PredictionDatabaseStats | null>(null);
  const [predictionsDownloaded, setPredictionsDownloaded] = useState(false);
  
  // District info
  const [installedDistricts, setInstalledDistricts] = useState<string[]>([]);
  const [districtInfo, setDistrictInfo] = useState<any[]>([]);

  // Prediction refresh
  const [refreshing, setRefreshing] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState<string>('');

  // Region management modal
  const [manageDistrictId, setManageDistrictId] = useState<string | null>(null);
  
  // Theme state
  const [uiTheme, setUITheme] = useState<UITheme>(themeService.getUITheme());
  
  // Subscribe to theme changes
  useEffect(() => {
    const unsubscribe = themeService.subscribeToModeChanges((mode) => {
      setUITheme(themeService.getUITheme(mode));
    });
    return unsubscribe;
  }, []);
  
  // Use dark theme styles consistently
  const themedStyles = useMemo(() => ({
    container: {
      backgroundColor: '#1a1f2e',
    },
    sectionTitle: {
      color: 'rgba(255, 255, 255, 0.6)',
    },
    card: {
      backgroundColor: 'rgba(255, 255, 255, 0.08)',
    },
    row: {
      borderBottomColor: 'rgba(255, 255, 255, 0.15)',
    },
    label: {
      color: '#fff',
    },
    value: {
      color: 'rgba(255, 255, 255, 0.7)',
    },
    valueSmall: {
      color: 'rgba(255, 255, 255, 0.5)',
    },
  }), [uiTheme]);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    console.log('[StatsContent] loadStats() called');
    try {
      setLoading(true);
      
      // Get installed districts
      console.log('[StatsContent] Getting installed districts...');
      const districts = await getInstalledDistrictIds();
      setInstalledDistricts(districts);
      
      // Get detailed info for each district
      const districtDetails = await Promise.all(
        districts.map(async (districtId) => {
          const record = await getInstalledDistrict(districtId);
          const hasBuoys = await areBuoysDownloaded(districtId);
          const hasMarineZones = await areMarineZonesDownloaded(districtId);
          const hasPredictions = await arePredictionsDownloaded(districtId);
          return {
            id: districtId,
            record,
            hasBuoys,
            hasMarineZones,
            hasPredictions,
          };
        })
      );
      setDistrictInfo(districtDetails);
      
      // Get MBTiles data
      console.log('[StatsContent] Getting MBTiles cache size...');
      const mbtilesSize = await chartCacheService.getMBTilesCacheSize();
      console.log('[StatsContent] MBTiles size:', mbtilesSize);
      const mbtilesIds = await chartCacheService.getDownloadedMBTilesIds();
      console.log('[StatsContent] MBTiles IDs count:', mbtilesIds.length);
      setMbtilesSize(mbtilesSize);
      setMbtilesCount(mbtilesIds.length);
      
      // Get prediction database sizes (for any district)
      console.log('[StatsContent] Getting prediction database sizes...');
      const dbFiles = await FileSystem.readDirectoryAsync(FileSystem.documentDirectory || '');
      let totalTidesSize = 0;
      let totalCurrentsSize = 0;
      
      for (const file of dbFiles) {
        if (file.endsWith('.db')) {
          const filePath = `${FileSystem.documentDirectory}${file}`;
          const fileInfo = await FileSystem.getInfoAsync(filePath);
          if (fileInfo.exists && 'size' in fileInfo) {
            if (file.includes('tides')) {
              totalTidesSize += fileInfo.size;
            } else if (file.includes('currents')) {
              totalCurrentsSize += fileInfo.size;
            }
          }
        }
      }
      
      setTidesDbSize(totalTidesSize);
      setCurrentsDbSize(totalCurrentsSize);
      
      // Get available device storage
      console.log('[StatsContent] Getting free disk space...');
      try {
        const freeSpace = await FileSystem.getFreeDiskStorageAsync();
        console.log('[StatsContent] Free space:', freeSpace);
        setAvailableStorage(freeSpace);
      } catch (error) {
        console.error('[StatsContent] Error getting free disk space:', error);
        setAvailableStorage(0);
      }
      
      // Check if predictions are downloaded and get stats (for first district)
      console.log('[StatsContent] Checking predictions status...');
      if (districts.length > 0) {
        const downloaded = await arePredictionsDownloaded(districts[0]);
        console.log('[StatsContent] Predictions downloaded:', downloaded);
        setPredictionsDownloaded(downloaded);
        
        if (downloaded) {
          console.log('[StatsContent] Getting database stats...');
          const databaseStats = await getPredictionDatabaseStats(districts[0]);
          console.log('[StatsContent] Database stats retrieved');
          setDbStats(databaseStats);
        }
      }
      console.log('[StatsContent] loadStats() completed successfully');
    } catch (error) {
      console.error('[StatsContent] Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshPredictions = () => {
    if (installedDistricts.length === 0) {
      Alert.alert('No Regions', 'No regions are installed. Download a region first.');
      return;
    }

    Alert.alert(
      'Refresh Predictions',
      'This will re-download tide and current prediction data for all installed regions.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Refresh',
          onPress: async () => {
            setRefreshing(true);
            setRefreshProgress('Preparing...');
            try {
              for (const districtId of installedDistricts) {
                const region = getRegionByFirestoreId(districtId);
                const name = region?.name || districtId;

                setRefreshProgress(`Clearing ${name}...`);
                await clearPredictions(districtId);

                const result = await downloadAllPredictions(
                  (message, _percent) => {
                    setRefreshProgress(`${name}: ${message}`);
                  },
                  districtId
                );

                if (!result.success) {
                  throw new Error(`Failed for ${name}: ${result.error}`);
                }
              }

              clearStationCache();
              setRefreshProgress('');
              await loadStats();
              Alert.alert('Success', 'Prediction data has been refreshed.');
            } catch (error: any) {
              console.error('[StatsContent] Refresh predictions error:', error);
              Alert.alert('Error', error.message || 'Failed to refresh predictions.');
            } finally {
              setRefreshing(false);
              setRefreshProgress('');
            }
          },
        },
      ]
    );
  };

  // Format date from YYYY-MM-DD to MM/DD/YY
  const formatDateRange = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-');
    const shortYear = year.slice(2);
    return `${month}/${day}/${shortYear}`;
  };

  const user = getAuth().currentUser;

  if (loading) {
    return (
      <View style={[styles.container, themedStyles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={[styles.loadingText, themedStyles.label]}>Loading stats...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, themedStyles.container]}>
      {/* Account Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>Account</Text>
        <View style={[styles.card, themedStyles.card]}>
          <View style={[styles.row, themedStyles.row]}>
            <Text style={[styles.label, themedStyles.label]}>Email</Text>
            <Text style={[styles.value, themedStyles.value]}>{user?.email || 'Not logged in'}</Text>
          </View>
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <Text style={[styles.label, themedStyles.label]}>User ID</Text>
            <Text style={[styles.valueSmall, themedStyles.valueSmall]} numberOfLines={1}>
              {user?.uid || 'N/A'}
            </Text>
          </View>
        </View>
      </View>

      {/* Installed Regions Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>Installed Regions</Text>
        <View style={[styles.card, themedStyles.card]}>
          {installedDistricts.length === 0 ? (
            <View style={styles.row}>
              <Text style={[styles.label, themedStyles.label]}>No regions downloaded</Text>
            </View>
          ) : (
            installedDistricts.map((districtId, index) => {
              const info = districtInfo.find(d => d.id === districtId);
              const region = getRegionByFirestoreId(districtId);
              const displayName = region?.name || districtId;
              const isLast = index === installedDistricts.length - 1;
              return (
                <TouchableOpacity
                  key={districtId}
                  style={[styles.row, isLast && { borderBottomWidth: 0 }]}
                  onPress={() => setManageDistrictId(districtId)}
                  activeOpacity={0.6}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, themedStyles.label]}>{displayName}</Text>
                    {info && info.record && (
                      <Text style={[styles.valueSmall, themedStyles.valueSmall, { textAlign: 'left', marginTop: 4 }]}>
                        {[
                          info.record.hasCharts && 'Charts',
                          info.record.hasSatellite && 'Satellite',
                          info.record.hasBasemap && 'Basemap',
                          info.record.hasGnis && 'GNIS',
                          info.record.hasOcean && 'Ocean',
                          info.record.hasTerrain && 'Terrain',
                          info.hasPredictions && 'Predictions',
                          info.hasBuoys && 'Buoys',
                          info.hasMarineZones && 'Marine Zones',
                        ].filter(Boolean).join(' \u2022 ')}
                      </Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="rgba(255, 255, 255, 0.4)" />
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </View>

      {/* Map Layers Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>Available Map Layers</Text>
        <View style={[styles.card, themedStyles.card]}>
          <View style={[styles.row, themedStyles.row]}>
            <Text style={[styles.label, themedStyles.label]}>Basemap Styles</Text>
            <Text style={[styles.valueSmall, themedStyles.valueSmall]}>Light, Dark, Street, ECDIS</Text>
          </View>
          <View style={[styles.row, themedStyles.row]}>
            <Text style={[styles.label, themedStyles.label]}>Imagery</Text>
            <Text style={[styles.valueSmall, themedStyles.valueSmall]}>Satellite, Ocean, Terrain</Text>
          </View>
          <View style={[styles.row, themedStyles.row]}>
            <Text style={[styles.label, themedStyles.label]}>Chart Scales</Text>
            <Text style={[styles.valueSmall, themedStyles.valueSmall]}>US1-US6 (1:3M to 1:50k)</Text>
          </View>
          <View style={[styles.row, themedStyles.row]}>
            <Text style={[styles.label, themedStyles.label]}>Display Modes</Text>
            <Text style={[styles.valueSmall, themedStyles.valueSmall]}>Day, Dusk, Night</Text>
          </View>
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <Text style={[styles.label, themedStyles.label]}>Satellite Resolutions</Text>
            <Text style={[styles.valueSmall, themedStyles.valueSmall]}>None, Low, Med, High, Ultra</Text>
          </View>
        </View>
      </View>

      {/* Tides & Currents Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, themedStyles.sectionTitle, { marginBottom: 0 }]}>Tides & Currents</Text>
          {refreshing ? (
            <ActivityIndicator size="small" color="rgba(255, 255, 255, 0.6)" />
          ) : (
            <TouchableOpacity onPress={handleRefreshPredictions} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="refresh-outline" size={18} color="rgba(255, 255, 255, 0.6)" />
            </TouchableOpacity>
          )}
        </View>
        {refreshing && refreshProgress ? (
          <Text style={styles.refreshProgress}>{refreshProgress}</Text>
        ) : null}
        <View style={[styles.card, themedStyles.card]}>
          {/* Tide Stations */}
          <View style={[styles.row, themedStyles.row]}>
            <Text style={[styles.label, themedStyles.label]}>Tide Stations</Text>
            <Text style={[styles.value, themedStyles.value]}>
              {dbStats?.tideStations ?? (predictionsDownloaded ? '...' : 'Not downloaded')}
            </Text>
          </View>
          <View style={[styles.row, themedStyles.row]}>
            <Text style={[styles.label, themedStyles.label]}>Tide Date Range</Text>
            <Text style={[styles.valueSmall, themedStyles.valueSmall]}>
              {dbStats?.tideDateRange 
                ? `${formatDateRange(dbStats.tideDateRange.start)} - ${formatDateRange(dbStats.tideDateRange.end)}`
                : 'N/A'}
            </Text>
          </View>
          <View style={[styles.row, themedStyles.row]}>
            <Text style={[styles.label, themedStyles.label]}>Tide Predictions</Text>
            <Text style={[styles.value, themedStyles.value]}>
              {dbStats?.totalTidePredictions?.toLocaleString() ?? 'N/A'}
            </Text>
          </View>
          
          {/* Current Stations */}
          <View style={[styles.row, themedStyles.row]}>
            <Text style={[styles.label, themedStyles.label]}>Current Stations</Text>
            <Text style={[styles.value, themedStyles.value]}>
              {dbStats?.currentStations ?? (predictionsDownloaded ? '...' : 'Not downloaded')}
            </Text>
          </View>
          <View style={[styles.row, themedStyles.row]}>
            <Text style={[styles.label, themedStyles.label]}>Current Date Range</Text>
            <Text style={[styles.valueSmall, themedStyles.valueSmall]}>
              {dbStats?.currentDateRange 
                ? `${formatDateRange(dbStats.currentDateRange.start)} - ${formatDateRange(dbStats.currentDateRange.end)}`
                : 'N/A'}
            </Text>
          </View>
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <Text style={[styles.label, themedStyles.label]}>Current Predictions</Text>
            <Text style={[styles.value, themedStyles.value]}>
              {dbStats?.totalCurrentPredictions?.toLocaleString() ?? 'N/A'}
            </Text>
          </View>
        </View>
      </View>

      {/* Storage Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>Storage</Text>
        <View style={[styles.card, themedStyles.card]}>
          {/* Charts */}
          <View style={[styles.row, themedStyles.row]}>
            <Text style={[styles.label, themedStyles.label]}>MBTiles Files</Text>
            <Text style={[styles.value, themedStyles.value]}>
              {mbtilesCount > 0 ? `${mbtilesCount} files` : 'None'}
            </Text>
          </View>
          {mbtilesSize > 0 && (
            <View style={[styles.row, themedStyles.row]}>
              <Text style={[styles.labelIndent, themedStyles.label]}>Charts, Satellite, Basemaps</Text>
              <Text style={[styles.value, themedStyles.value]}>{formatBytes(mbtilesSize)}</Text>
            </View>
          )}
          
          {/* Tide Predictions */}
          <View style={[styles.row, themedStyles.row]}>
            <Text style={[styles.label, themedStyles.label]}>Tide Databases</Text>
            <Text style={[styles.value, themedStyles.value]}>
              {tidesDbSize > 0 ? formatBytes(tidesDbSize) : 'Not downloaded'}
            </Text>
          </View>
          
          {/* Current Predictions */}
          <View style={[styles.row, themedStyles.row]}>
            <Text style={[styles.label, themedStyles.label]}>Current Databases</Text>
            <Text style={[styles.value, themedStyles.value]}>
              {currentsDbSize > 0 ? formatBytes(currentsDbSize) : 'Not downloaded'}
            </Text>
          </View>
          
          {/* Total */}
          <View style={[styles.row, themedStyles.row, styles.totalRow]}>
            <Text style={[styles.label, themedStyles.label, styles.totalLabel]}>Total Used</Text>
            <Text style={[styles.value, themedStyles.value, styles.totalValue]}>
              {formatBytes(mbtilesSize + tidesDbSize + currentsDbSize)}
            </Text>
          </View>
          
          {/* Available */}
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <Text style={[styles.label, themedStyles.label]}>Available</Text>
            <Text style={[styles.value, themedStyles.value]}>
              {formatBytes(availableStorage)}
            </Text>
          </View>
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
            <Text style={[styles.label, themedStyles.label]}>Chart Format</Text>
            <Text style={[styles.value, themedStyles.value]}>NOAA S-57 ENC</Text>
          </View>
          <View style={[styles.row, themedStyles.row]}>
            <Text style={[styles.label, themedStyles.label]}>Symbology</Text>
            <Text style={[styles.value, themedStyles.value]}>IHO S-52</Text>
          </View>
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <Text style={[styles.label, themedStyles.label]}>Coverage</Text>
            <Text style={[styles.value, themedStyles.value]}>All US Waters (9 Districts)</Text>
          </View>
        </View>
      </View>

      {/* Bottom padding */}
      <View style={{ height: 40 }} />

      {/* Region Management Modal */}
      {manageDistrictId && (
        <RegionManageModal
          visible={!!manageDistrictId}
          districtId={manageDistrictId}
          onClose={(refreshNeeded) => {
            setManageDistrictId(null);
            if (refreshNeeded) {
              loadStats();
            }
          }}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1f2e',
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#fff',
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  refreshProgress: {
    fontSize: 12,
    color: 'rgba(79, 195, 247, 0.8)',
    marginBottom: 8,
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.15)',
  },
  label: {
    fontSize: 15,
    color: '#fff',
    flex: 1,
  },
  labelIndent: {
    fontSize: 15,
    color: '#fff',
    flex: 1,
    paddingLeft: 16,
  },
  value: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'right',
    flex: 1,
  },
  valueSmall: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'right',
    flex: 1,
  },
  totalRow: {
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
  },
  totalLabel: {
    fontWeight: '600',
  },
  totalValue: {
    fontWeight: '600',
  },
});

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
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { getAuth } from '@react-native-firebase/auth';
import * as chartCacheService from '../services/chartCacheService';
import { formatBytes } from '../services/chartService';
import * as themeService from '../services/themeService';
import type { UITheme } from '../services/themeService';
import { 
  arePredictionsDownloaded,
  getPredictionDatabaseStats,
} from '../services/stationService';
import type { PredictionDatabaseStats } from '../services/stationService';

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
      
      // Get MBTiles data
      console.log('[StatsContent] Getting MBTiles cache size...');
      const mbtilesSize = await chartCacheService.getMBTilesCacheSize();
      console.log('[StatsContent] MBTiles size:', mbtilesSize);
      const mbtilesIds = await chartCacheService.getDownloadedMBTilesIds();
      console.log('[StatsContent] MBTiles IDs count:', mbtilesIds.length);
      setMbtilesSize(mbtilesSize);
      setMbtilesCount(mbtilesIds.length);
      
      // Get prediction database sizes
      console.log('[StatsContent] Getting prediction database sizes...');
      const tidesPath = `${FileSystem.documentDirectory}tides.db`;
      const currentsPath = `${FileSystem.documentDirectory}currents.db`;
      
      const [tidesInfo, currentsInfo] = await Promise.all([
        FileSystem.getInfoAsync(tidesPath),
        FileSystem.getInfoAsync(currentsPath),
      ]);
      console.log('[StatsContent] Database info retrieved');
      
      setTidesDbSize(tidesInfo.exists && 'size' in tidesInfo ? tidesInfo.size : 0);
      setCurrentsDbSize(currentsInfo.exists && 'size' in currentsInfo ? currentsInfo.size : 0);
      
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
      
      // Check if predictions are downloaded and get stats
      console.log('[StatsContent] Checking predictions status...');
      const downloaded = await arePredictionsDownloaded();
      console.log('[StatsContent] Predictions downloaded:', downloaded);
      setPredictionsDownloaded(downloaded);
      
      if (downloaded) {
        console.log('[StatsContent] Getting database stats...');
        const databaseStats = await getPredictionDatabaseStats();
        console.log('[StatsContent] Database stats retrieved');
        setDbStats(databaseStats);
      }
      console.log('[StatsContent] loadStats() completed successfully');
    } catch (error) {
      console.error('[StatsContent] Error loading stats:', error);
    } finally {
      setLoading(false);
    }
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

      {/* Tides & Currents Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>Tides & Currents</Text>
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
            <Text style={[styles.label, themedStyles.label]}>Charts (MBTiles)</Text>
            <Text style={[styles.value, themedStyles.value]}>
              {mbtilesCount > 0 ? `${mbtilesCount} files` : 'None'}
            </Text>
          </View>
          {mbtilesSize > 0 && (
            <View style={[styles.row, themedStyles.row]}>
              <Text style={[styles.labelIndent, themedStyles.label]}>Size</Text>
              <Text style={[styles.value, themedStyles.value]}>{formatBytes(mbtilesSize)}</Text>
            </View>
          )}
          
          {/* Tide Predictions */}
          <View style={[styles.row, themedStyles.row]}>
            <Text style={[styles.label, themedStyles.label]}>Tide Database</Text>
            <Text style={[styles.value, themedStyles.value]}>
              {tidesDbSize > 0 ? formatBytes(tidesDbSize) : 'Not downloaded'}
            </Text>
          </View>
          
          {/* Current Predictions */}
          <View style={[styles.row, themedStyles.row]}>
            <Text style={[styles.label, themedStyles.label]}>Current Database</Text>
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
            <Text style={[styles.label, themedStyles.label]}>Data Source</Text>
            <Text style={[styles.value, themedStyles.value]}>NOAA ENC</Text>
          </View>
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <Text style={[styles.label, themedStyles.label]}>Region</Text>
            <Text style={[styles.value, themedStyles.value]}>Alaska (17 CGD)</Text>
          </View>
        </View>
      </View>

      {/* Bottom padding */}
      <View style={{ height: 40 }} />
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

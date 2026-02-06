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
import { Ionicons, FontAwesome6 } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system/legacy';
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
import { 
  fetchTideStations, 
  fetchCurrentStations, 
  clearStationCache,
  downloadAllPredictions,
  arePredictionsDownloaded,
  getPredictionsStats,
  clearPredictions,
  getPredictionDatabaseStats,
  getPredictionDatabaseMetadata,
} from '../services/stationService';
import type { TideStation, CurrentStation, PredictionDatabaseStats } from '../services/stationService';
import * as chartPackService from '../services/chartPackService';
import type { District, DistrictDownloadPack, PackDownloadStatus } from '../types/chartPack';

export default function SettingsScreen() {
  const [cacheSize, setCacheSize] = useState<number>(0);
  const [downloadedCount, setDownloadedCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [showSystemInfo, setShowSystemInfo] = useState(false);
  
  // Storage tracking for all data types
  const [mbtilesCount, setMbtilesCount] = useState<number>(0);
  const [mbtilesSize, setMbtilesSize] = useState<number>(0);
  const [tidesDbSize, setTidesDbSize] = useState<number>(0);
  const [currentsDbSize, setCurrentsDbSize] = useState<number>(0);
  const [availableStorage, setAvailableStorage] = useState<number>(0);
  
  // Tide & Current data
  const [tideStations, setTideStations] = useState<TideStation[]>([]);
  const [currentStations, setCurrentStations] = useState<CurrentStation[]>([]);
  const [tidesLoading, setTidesLoading] = useState(false);
  
  // Prediction download state
  const [predictionsDownloaded, setPredictionsDownloaded] = useState(false);
  const [predictionsStats, setPredictionsStats] = useState<any>(null);
  const [downloadingPredictions, setDownloadingPredictions] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');
  const [downloadPercent, setDownloadPercent] = useState(0);
  
  // Database stats (accurate values from SQLite)
  const [dbStats, setDbStats] = useState<PredictionDatabaseStats | null>(null);
  
  // Chart Data state
  const [district, setDistrict] = useState<District | null>(null);
  const [installedPackIds, setInstalledPackIds] = useState<string[]>([]);
  const [chartDataLoading, setChartDataLoading] = useState(false);
  const [packDownloadStatus, setPackDownloadStatus] = useState<PackDownloadStatus | null>(null);
  
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
    loadDatabaseStats(); // Load DB stats on mount without fetching from Firestore
    loadChartData(); // Load chart data from Firestore
  }, []);

  const loadCacheInfo = async () => {
    try {
      setLoading(true);
      
      // Get MBTiles data
      const mbtilesSize = await chartCacheService.getMBTilesCacheSize();
      const mbtilesIds = await chartCacheService.getDownloadedMBTilesIds();
      setMbtilesSize(mbtilesSize);
      setMbtilesCount(mbtilesIds.length);
      
      // Get prediction database sizes
      const tidesPath = `${FileSystem.documentDirectory}tides.db`;
      const currentsPath = `${FileSystem.documentDirectory}currents.db`;
      
      const [tidesInfo, currentsInfo] = await Promise.all([
        FileSystem.getInfoAsync(tidesPath),
        FileSystem.getInfoAsync(currentsPath),
      ]);
      
      setTidesDbSize(tidesInfo.exists && 'size' in tidesInfo ? tidesInfo.size : 0);
      setCurrentsDbSize(currentsInfo.exists && 'size' in currentsInfo ? currentsInfo.size : 0);
      
      // Get available device storage
      try {
        const freeSpace = await FileSystem.getFreeDiskStorageAsync();
        setAvailableStorage(freeSpace);
      } catch (error) {
        console.error('Error getting free disk space:', error);
        setAvailableStorage(0);
      }
      
      // Keep legacy GeoJSON tracking (hidden from UI, but used for cleanup)
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

  // Load database stats from local SQLite (no Firestore fetch)
  const loadDatabaseStats = async () => {
    try {
      // Check if predictions are downloaded
      const downloaded = await arePredictionsDownloaded();
      setPredictionsDownloaded(downloaded);
      
      if (downloaded) {
        const stats = await getPredictionsStats();
        setPredictionsStats(stats);
        
        // Get accurate stats from SQLite database
        const databaseStats = await getPredictionDatabaseStats();
        setDbStats(databaseStats);
      } else {
        setDbStats(null);
      }
    } catch (error) {
      console.error('[SETTINGS] Error loading database stats:', error);
      // Don't show alert for this - it's not critical on mount
    }
  };

  // Load chart data from Firestore
  const loadChartData = async () => {
    try {
      setChartDataLoading(true);
      
      // For now, hardcode Alaska (17cgd) as the default district
      const districtId = '17cgd';
      const districtData = await chartPackService.getDistrict(districtId);
      setDistrict(districtData);
      
      // Check which packs are installed locally
      const installed = await chartPackService.getInstalledPackIds(districtId);
      setInstalledPackIds(installed);
      
      console.log('[SETTINGS] Chart data loaded:', {
        district: districtData?.name,
        packs: districtData?.downloadPacks?.length || 0,
        installed: installed.length,
      });
    } catch (error) {
      console.error('[SETTINGS] Error loading chart data:', error);
    } finally {
      setChartDataLoading(false);
    }
  };

  // Handle pack download
  const handleDownloadPack = async (pack: DistrictDownloadPack) => {
    if (packDownloadStatus) {
      Alert.alert('Download in Progress', 'Please wait for the current download to complete.');
      return;
    }
    
    // Check network connection
    const netState = await NetInfo.fetch();
    const isConnected = netState.isConnected && netState.isInternetReachable;
    
    if (!isConnected) {
      Alert.alert(
        'No Internet Connection',
        'You need an internet connection to download chart data. Please check your connection and try again.',
        [{ text: 'OK' }]
      );
      return;
    }
    
    // Check if on WiFi for large downloads
    const isWifi = netState.type === 'wifi';
    const sizeMB = pack.sizeBytes / 1024 / 1024;
    const wifiWarning = !isWifi && sizeMB > 50
      ? '\n\n⚠️ WARNING: You are not connected to WiFi. This download will use cellular data.'
      : '';
    
    Alert.alert(
      'Download Pack',
      `Download "${pack.name}"?\n\n` +
      `Size: ${sizeMB.toFixed(1)} MB\n` +
      `${pack.description}${wifiWarning}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Download',
          onPress: async () => {
            try {
              const success = await chartPackService.downloadPack(
                pack,
                '17cgd', // District ID
                (status) => setPackDownloadStatus(status)
              );
              
              if (success) {
                // Refresh installed packs
                const installed = await chartPackService.getInstalledPackIds('17cgd');
                setInstalledPackIds(installed);
                
                // Refresh storage info
                await loadCacheInfo();
                
                Alert.alert('Download Complete', `"${pack.name}" has been downloaded successfully.`);
              }
            } catch (error: any) {
              Alert.alert('Download Failed', error.message || 'Unknown error');
            } finally {
              setPackDownloadStatus(null);
            }
          },
        },
      ]
    );
  };

  // Handle pack deletion
  const handleDeletePack = async (pack: DistrictDownloadPack) => {
    Alert.alert(
      'Delete Pack',
      `Delete "${pack.name}"? This will free up ${(pack.sizeBytes / 1024 / 1024).toFixed(1)} MB of storage.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await chartPackService.deletePack(pack, '17cgd');
              
              // Refresh installed packs
              const installed = await chartPackService.getInstalledPackIds('17cgd');
              setInstalledPackIds(installed);
              
              // Refresh storage info
              await loadCacheInfo();
              
              Alert.alert('Deleted', `"${pack.name}" has been deleted.`);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete pack');
            }
          },
        },
      ]
    );
  };

  // Load station locations from Firestore (via Cloud Function)
  const loadTideData = async () => {
    try {
      setTidesLoading(true);
      console.log('Loading tide/current station locations from Firestore...');
      
      // Load only metadata first (much faster, avoids string length errors)
      const [tides, currents] = await Promise.all([
        fetchTideStations(false), // false = metadata only, no predictions
        fetchCurrentStations(false), // false = metadata only, no predictions
      ]);
      
      console.log(`Loaded ${tides.length} tide stations, ${currents.length} current stations from Firestore`);
      setTideStations(tides);
      setCurrentStations(currents);
      
      // Also refresh database stats
      await loadDatabaseStats();
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

  // Format date from YYYY-MM-DD to MM/DD/YY
  const formatDateRange = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-');
    const shortYear = year.slice(2); // Get last 2 digits of year
    return `${month}/${day}/${shortYear}`;
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
    // If predictions aren't downloaded, trigger the download flow
    if (!predictionsDownloaded) {
      try {
        // Check network connection
        const netState = await NetInfo.fetch();
        const isConnected = netState.isConnected && netState.isInternetReachable;
        
        if (!isConnected) {
          Alert.alert(
            'No Internet Connection',
            'You need an internet connection to download prediction data. Please check your connection and try again.',
            [{ text: 'OK' }]
          );
          return;
        }
        
        // Get file sizes from Firebase Storage
        const metadata = await getPredictionDatabaseMetadata();
        
        // Check if on WiFi
        const isWifi = netState.type === 'wifi';
        const wifiWarning = !isWifi 
          ? '\n\n⚠️ WARNING: You are not connected to WiFi. This download will use cellular data and may affect your data plan.'
          : '';
        
        Alert.alert(
          'Download Predictions',
          `This will download ${metadata.totalSizeMB.toFixed(1)} MB of tide and current prediction data:\n\n` +
          `• Tides: ${(metadata.tidesSize / 1024 / 1024).toFixed(1)} MB\n` +
          `• Currents: ${(metadata.currentsSize / 1024 / 1024).toFixed(1)} MB\n\n` +
          `The download may take several minutes.${wifiWarning}\n\nContinue?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Download',
              onPress: async () => {
                setDownloadingPredictions(true);
                setDownloadProgress('Starting download...');
                setDownloadPercent(0);
                
                try {
                  const result = await downloadAllPredictions((message, percent) => {
                    setDownloadProgress(message);
                    setDownloadPercent(percent);
                  });
                  
                  if (result.success) {
                    setPredictionsDownloaded(true);
                    setPredictionsStats(result.stats);
                    
                    // Retry mechanism: Try to load database stats with retries for slow devices
                    let updatedStats: PredictionDatabaseStats | null = null;
                    const maxRetries = 3;
                    const retryDelay = 1000; // 1 second
                    
                    for (let attempt = 1; attempt <= maxRetries; attempt++) {
                      try {
                        // Reload database stats after successful download
                        await loadDatabaseStats();
                        
                        // Get the updated stats
                        updatedStats = await getPredictionDatabaseStats();
                        
                        // If we got valid stats with station counts, break out of retry loop
                        if (updatedStats && (updatedStats.tideStations > 0 || updatedStats.currentStations > 0)) {
                          break;
                        }
                        
                        // If stats are empty and we have more retries, wait and try again
                        if (attempt < maxRetries) {
                          await new Promise(resolve => setTimeout(resolve, retryDelay));
                        }
                      } catch (error) {
                        console.error(`[SETTINGS] Attempt ${attempt} failed to load database stats:`, error);
                        if (attempt < maxRetries) {
                          await new Promise(resolve => setTimeout(resolve, retryDelay));
                        } else {
                          throw error; // Throw on final attempt
                        }
                      }
                    }
                    
                    if (!updatedStats || (updatedStats.tideStations === 0 && updatedStats.currentStations === 0)) {
                      throw new Error('Database downloaded but unable to read station data. Please try again.');
                    }
                    
                    Alert.alert(
                      'Download Complete',
                      `Successfully downloaded predictions:\n\n` +
                      `• Tide Stations: ${updatedStats?.tideStations || 0}\n` +
                      `• Current Stations: ${updatedStats?.currentStations || 0}\n\n` +
                      `Total size: ${result.stats?.totalSizeMB?.toFixed(1) || '?'} MB\n` +
                      `Download time: ${result.stats?.downloadTimeSec || '?'}s`,
                      [{ text: 'OK' }]
                    );
                  } else {
                    Alert.alert(
                      'Download Failed',
                      result.error || 'Unknown error occurred during download',
                      [{ text: 'OK' }]
                    );
                  }
                } catch (error) {
                  console.error('[SETTINGS] ❌ Download exception:', error);
                  Alert.alert(
                    'Download Failed',
                    error instanceof Error ? error.message : 'Unknown error',
                    [{ text: 'OK' }]
                  );
                } finally {
                  setDownloadingPredictions(false);
                  setDownloadProgress('');
                  setDownloadPercent(0);
                }
              },
            },
          ]
        );
      } catch (error) {
        console.error('[SETTINGS] Error checking download prerequisites:', error);
        Alert.alert(
          'Error',
          error instanceof Error ? error.message : 'Unable to fetch download information',
          [{ text: 'OK' }]
        );
      }
      return;
    }
    
    // Otherwise, refresh station locations from Firestore
    clearStationCache();
    await loadTideData();
    
    // After loading, verify storage
    try {
      const keys = await AsyncStorage.multiGet([
        '@XNautical:tideStations',
        '@XNautical:currentStations',
        '@XNautical:stationsTimestamp',
      ]);
      
      const [tides, currents, timestamp] = keys;
      console.log('=== STORAGE VERIFICATION ===');
      console.log('Tide Stations in storage:', tides[1] ? `${JSON.parse(tides[1]).length} stations` : 'NOT FOUND');
      console.log('Current Stations in storage:', currents[1] ? `${JSON.parse(currents[1]).length} stations` : 'NOT FOUND');
      console.log('Saved at:', timestamp[1] ? new Date(parseInt(timestamp[1])).toISOString() : 'NOT FOUND');
      console.log('Total size:', tides[1] ? `${((tides[1].length + (currents[1]?.length || 0)) / 1024).toFixed(1)} KB` : '0 KB');
      
      // Check actual lat/lon data
      if (tides[1]) {
        const tideData = JSON.parse(tides[1]);
        const sample = tideData[0];
        console.log('Sample tide station:', {
          id: sample?.id,
          name: sample?.name,
          lat: sample?.lat,
          lng: sample?.lng,
          type: sample?.type
        });
      }
      
      if (currents[1]) {
        const currentData = JSON.parse(currents[1]);
        const sample = currentData[0];
        console.log('Sample current station:', {
          id: sample?.id,
          name: sample?.name,
          lat: sample?.lat,
          lng: sample?.lng,
          bin: sample?.bin
        });
      }
      
      console.log('===========================');
    } catch (error) {
      console.error('Error verifying storage:', error);
    }
  };
  
  // Manual verification function to check if prediction database exists
  const verifyPredictionDatabase = async () => {
    try {
      console.log('[VERIFY] ========================================');
      console.log('[VERIFY] Checking for prediction databases (split format)...');
      
      const FileSystem = require('expo-file-system/legacy');
      const SQLite = require('expo-sqlite');
      
      // Check for new split databases
      const tidesDbPath = `${FileSystem.documentDirectory}tides.db`;
      const currentsDbPath = `${FileSystem.documentDirectory}currents.db`;
      
      console.log('[VERIFY] Checking tides path:', tidesDbPath);
      console.log('[VERIFY] Checking currents path:', currentsDbPath);
      
      const [tidesInfo, currentsInfo] = await Promise.all([
        FileSystem.getInfoAsync(tidesDbPath),
        FileSystem.getInfoAsync(currentsDbPath),
      ]);
      
      console.log('[VERIFY] Tides DB exists:', tidesInfo.exists);
      console.log('[VERIFY] Currents DB exists:', currentsInfo.exists);
      
      let tidesTableInfo = '';
      let currentsTableInfo = '';
      
      // Check tides database
      if (tidesInfo.exists) {
        console.log('[VERIFY] Tides DB size:', (tidesInfo.size / 1024 / 1024).toFixed(2), 'MB');
        
        try {
          const tidesDb = await SQLite.openDatabaseAsync(tidesDbPath);
          console.log('[VERIFY] Tides database opened successfully');
          
          // Check what tables exist
          const tables = await tidesDb.getAllAsync(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
          );
          console.log('[VERIFY] Tables in tides.db:', tables.map((t: any) => t.name));
          
          // Check row counts
          for (const table of tables) {
            const tableName = (table as any).name;
            if (tableName !== 'sqlite_sequence') {
              const count = await tidesDb.getFirstAsync(`SELECT COUNT(*) as count FROM ${tableName}`);
              console.log(`[VERIFY] tides.db ${tableName}: ${(count as any)?.count} rows`);
              tidesTableInfo += `${tableName}: ${(count as any)?.count} rows\n`;
            }
          }
        } catch (dbError: any) {
          console.error('[VERIFY] Tides database query error:', dbError);
          tidesTableInfo = `Error: ${dbError.message}`;
        }
      }
      
      // Check currents database
      if (currentsInfo.exists) {
        console.log('[VERIFY] Currents DB size:', (currentsInfo.size / 1024 / 1024).toFixed(2), 'MB');
        
        try {
          const currentsDb = await SQLite.openDatabaseAsync(currentsDbPath);
          console.log('[VERIFY] Currents database opened successfully');
          
          // Check what tables exist
          const tables = await currentsDb.getAllAsync(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
          );
          console.log('[VERIFY] Tables in currents.db:', tables.map((t: any) => t.name));
          
          // Check row counts
          for (const table of tables) {
            const tableName = (table as any).name;
            if (tableName !== 'sqlite_sequence') {
              const count = await currentsDb.getFirstAsync(`SELECT COUNT(*) as count FROM ${tableName}`);
              console.log(`[VERIFY] currents.db ${tableName}: ${(count as any)?.count} rows`);
              currentsTableInfo += `${tableName}: ${(count as any)?.count} rows\n`;
            }
          }
        } catch (dbError: any) {
          console.error('[VERIFY] Currents database query error:', dbError);
          currentsTableInfo = `Error: ${dbError.message}`;
        }
      }
      
      // Also check AsyncStorage metadata
      const [statsJson, timestamp] = await Promise.all([
        AsyncStorage.getItem('@XNautical:predictionsStats'),
        AsyncStorage.getItem('@XNautical:predictionsTimestamp'),
      ]);
      
      console.log('[VERIFY] Metadata in AsyncStorage:', !!statsJson && !!timestamp);
      if (statsJson) {
        console.log('[VERIFY] Stats:', JSON.parse(statsJson));
      }
      if (timestamp) {
        console.log('[VERIFY] Downloaded at:', new Date(parseInt(timestamp)).toISOString());
      }
      
      console.log('[VERIFY] ========================================');
      
      const totalSize = (tidesInfo.exists ? tidesInfo.size : 0) + (currentsInfo.exists ? currentsInfo.size : 0);
      
      Alert.alert(
        'Database Verification',
        `Tides DB: ${tidesInfo.exists ? 'EXISTS' : 'NOT FOUND'}\n` +
        `  Size: ${tidesInfo.exists ? (tidesInfo.size / 1024 / 1024).toFixed(2) + ' MB' : 'N/A'}\n` +
        `  ${tidesTableInfo || 'No tables'}\n\n` +
        `Currents DB: ${currentsInfo.exists ? 'EXISTS' : 'NOT FOUND'}\n` +
        `  Size: ${currentsInfo.exists ? (currentsInfo.size / 1024 / 1024).toFixed(2) + ' MB' : 'N/A'}\n` +
        `  ${currentsTableInfo || 'No tables'}\n\n` +
        `Total Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB\n` +
        `Metadata saved: ${!!statsJson && !!timestamp}\n\n` +
        `Check console for table details`,
        [{ text: 'OK' }]
      );
    } catch (error: any) {
      console.error('[VERIFY] Error:', error);
      Alert.alert('Verification Error', error.message, [{ text: 'OK' }]);
    }
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
              // Clear both MBTiles (primary) and legacy GeoJSON (cleanup)
              await chartCacheService.clearAllMBTiles();
              await chartCacheService.clearAllCharts();
              
              // Reload all cache info
              await loadCacheInfo();
              
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
                {/* Tide Stations - use database stats if available */}
                <View style={[styles.row, themedStyles.row]}>
                  <Text style={[styles.label, themedStyles.label]}>Tide Stations</Text>
                  <Text style={[styles.value, themedStyles.value]}>
                    {dbStats?.tideStations ?? 0}
                  </Text>
                </View>
                <View style={[styles.row, themedStyles.row]}>
                  <Text style={[styles.label, themedStyles.label]}>Tide Date Range</Text>
                  <Text style={[styles.valueSmall, themedStyles.valueSmall]}>
                    {dbStats?.tideDateRange 
                      ? `${formatDateRange(dbStats.tideDateRange.start)} - ${formatDateRange(dbStats.tideDateRange.end)}`
                      : 'No data'}
                  </Text>
                </View>
                <View style={[styles.row, themedStyles.row]}>
                  <Text style={[styles.label, themedStyles.label]}>Tide DB Size</Text>
                  <Text style={[styles.value, themedStyles.value]}>
                    {dbStats?.tidesDbSizeMB ? `${dbStats.tidesDbSizeMB.toFixed(1)} MB` : 'N/A'}
                  </Text>
                </View>
                <View style={[styles.row, themedStyles.row]}>
                  <Text style={[styles.label, themedStyles.label]}>Tide Predictions</Text>
                  <Text style={[styles.value, themedStyles.value]}>
                    {dbStats?.totalTidePredictions?.toLocaleString() ?? 0}
                  </Text>
                </View>
                
                {/* Current Stations - use database stats if available */}
                <View style={[styles.row, themedStyles.row]}>
                  <Text style={[styles.label, themedStyles.label]}>Current Stations</Text>
                  <Text style={[styles.value, themedStyles.value]}>
                    {dbStats?.currentStations ?? 0}
                  </Text>
                </View>
                <View style={[styles.row, themedStyles.row]}>
                  <Text style={[styles.label, themedStyles.label]}>Current Date Range</Text>
                  <Text style={[styles.valueSmall, themedStyles.valueSmall]}>
                    {dbStats?.currentDateRange 
                      ? `${formatDateRange(dbStats.currentDateRange.start)} - ${formatDateRange(dbStats.currentDateRange.end)}`
                      : 'No data'}
                  </Text>
                </View>
                <View style={[styles.row, themedStyles.row]}>
                  <Text style={[styles.label, themedStyles.label]}>Current DB Size</Text>
                  <Text style={[styles.value, themedStyles.value]}>
                    {dbStats?.currentsDbSizeMB ? `${dbStats.currentsDbSizeMB.toFixed(1)} MB` : 'N/A'}
                  </Text>
                </View>
                <View style={[styles.row, themedStyles.row]}>
                  <Text style={[styles.label, themedStyles.label]}>Current Predictions</Text>
                  <Text style={[styles.value, themedStyles.value]}>
                    {dbStats?.totalCurrentPredictions?.toLocaleString() ?? 0}
                  </Text>
                </View>
                
                {/* Total */}
                <View style={[styles.row, { borderBottomWidth: 0 }]}>
                  <Text style={[styles.label, themedStyles.label, { fontWeight: '600' }]}>Total DB Size</Text>
                  <Text style={[styles.value, themedStyles.value, { fontWeight: '600' }]}>
                    {dbStats 
                      ? `${(dbStats.tidesDbSizeMB + dbStats.currentsDbSizeMB).toFixed(1)} MB`
                      : 'N/A'}
                  </Text>
                </View>
                
                {/* Action Buttons Row */}
                <View style={styles.actionButtonsRow}>
                  <TouchableOpacity 
                    style={[styles.iconButton, { backgroundColor: '#007AFF' }]} 
                    onPress={handleRefreshTideData}
                    disabled={tidesLoading}
                  >
                    <Ionicons 
                      name={predictionsDownloaded ? "refresh" : "download"} 
                      size={40} 
                      color="#fff" 
                    />
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={[styles.iconButton, { backgroundColor: '#444' }]}
                    onPress={verifyPredictionDatabase}
                  >
                    <Ionicons name="search" size={40} color="#fff" />
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={[styles.iconButton, { backgroundColor: '#dc3545' }]}
                    onPress={async () => {
                      Alert.alert(
                        'Delete Database',
                        'This will delete the predictions database files so you can re-download them.\n\nContinue?',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: async () => {
                              try {
                                await clearPredictions();
                                await loadDatabaseStats(); // Refresh status
                                Alert.alert('Success', 'Database deleted. You can now download again.', [{ text: 'OK' }]);
                              } catch (error: any) {
                                Alert.alert('Error', error.message, [{ text: 'OK' }]);
                              }
                            }
                          }
                        ]
                      );
                    }}
                  >
                    <FontAwesome6 name="trash-can" size={36} color="#fff" />
                  </TouchableOpacity>
                </View>
                
                {/* Download Progress Indicator */}
                {downloadingPredictions && (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#007AFF" />
                    <Text style={[styles.loadingText, themedStyles.label]}>
                      {downloadProgress}
                    </Text>
                    <Text style={[styles.valueSmall, themedStyles.valueSmall]}>
                      {downloadPercent}%
                    </Text>
                  </View>
                )}
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
                {/* Tide Predictions */}
                {tidesDbSize > 0 && (
                  <>
                    <View style={[styles.row, themedStyles.row]}>
                      <Text style={[styles.label, themedStyles.label]}>Tide Predictions</Text>
                      <Text style={[styles.value, themedStyles.value]}>
                        {dbStats?.tideStations || 0} stations
                      </Text>
                    </View>
                    <View style={[styles.row, themedStyles.row]}>
                      <Text style={[styles.labelIndent, themedStyles.label]}>Size</Text>
                      <Text style={[styles.value, themedStyles.value]}>{formatBytes(tidesDbSize)}</Text>
                    </View>
                  </>
                )}
                
                {/* Current Predictions */}
                {currentsDbSize > 0 && (
                  <>
                    <View style={[styles.row, themedStyles.row]}>
                      <Text style={[styles.label, themedStyles.label]}>Current Predictions</Text>
                      <Text style={[styles.value, themedStyles.value]}>
                        {dbStats?.currentStations || 0} stations
                      </Text>
                    </View>
                    <View style={[styles.row, themedStyles.row]}>
                      <Text style={[styles.labelIndent, themedStyles.label]}>Size</Text>
                      <Text style={[styles.value, themedStyles.value]}>{formatBytes(currentsDbSize)}</Text>
                    </View>
                  </>
                )}
                
                {/* Total Storage Used */}
                <View style={[styles.row, themedStyles.row, styles.totalRow]}>
                  <Text style={[styles.label, themedStyles.label, styles.totalLabel]}>Total Storage Used:</Text>
                  <Text style={[styles.value, themedStyles.value, styles.totalValue]}>
                    {formatBytes(mbtilesSize + tidesDbSize + currentsDbSize)}
                  </Text>
                </View>
                
                {/* Available Storage */}
                <View style={[styles.row, themedStyles.row]}>
                  <Text style={[styles.label, themedStyles.label]}>Available Storage:</Text>
                  <Text style={[styles.value, themedStyles.value]}>
                    {formatBytes(availableStorage)}
                  </Text>
                </View>
                
                {/* Clear button - only show if there are charts */}
                {mbtilesCount > 0 && (
                  <TouchableOpacity
                    style={[styles.clearButton, clearing && styles.clearButtonDisabled]}
                    onPress={handleClearCache}
                    disabled={clearing}
                  >
                    {clearing ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.clearButtonText}>Clear All Charts</Text>
                    )}
                  </TouchableOpacity>
                )}
                
                {/* No data message */}
                {mbtilesCount === 0 && tidesDbSize === 0 && currentsDbSize === 0 && (
                  <Text style={[styles.valueSmall, themedStyles.valueSmall, { textAlign: 'center', marginTop: 8 }]}>
                    No data stored
                  </Text>
                )}
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
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  label: {
    fontSize: 16,
    color: '#333',
  },
  labelIndent: {
    fontSize: 14,
    color: '#333',
    paddingLeft: 16,
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
  totalRow: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  totalLabel: {
    fontWeight: '600',
  },
  totalValue: {
    fontWeight: '600',
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
  actionButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    marginTop: 12,
    gap: 8,
  },
  iconButton: {
    flex: 1,
    paddingVertical: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    minWidth: 60,
  },
  iconButtonText: {
    fontSize: 40,
    color: '#fff',
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

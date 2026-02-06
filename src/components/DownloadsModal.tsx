/**
 * DownloadsModal
 * 
 * Full-screen modal for managing all downloads:
 * - Chart packs (MBTiles)
 * - Tide & Current predictions
 * - Basemaps, Satellite imagery
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import * as chartPackService from '../services/chartPackService';
import { formatBytes, formatSpeed, formatEta } from '../services/chartService';
import {
  downloadAllPredictions,
  arePredictionsDownloaded,
  clearPredictions,
  getPredictionDatabaseMetadata,
} from '../services/stationService';
import type { District, DistrictDownloadPack, PackDownloadStatus } from '../types/chartPack';
import * as themeService from '../services/themeService';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function DownloadsModal({ visible, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [district, setDistrict] = useState<District | null>(null);
  const [installedPackIds, setInstalledPackIds] = useState<string[]>([]);
  const [packDownloadStatus, setPackDownloadStatus] = useState<PackDownloadStatus | null>(null);
  
  // Predictions state
  const [predictionsDownloaded, setPredictionsDownloaded] = useState(false);
  const [downloadingPredictions, setDownloadingPredictions] = useState(false);
  const [predictionsProgress, setPredictionsProgress] = useState('');
  const [predictionsPercent, setPredictionsPercent] = useState(0);
  
  const uiTheme = themeService.getUITheme();
  
  // Use dark theme styles consistently
  const themedStyles = useMemo(() => ({
    container: {
      backgroundColor: '#1a1f2e',
    },
    header: {
      backgroundColor: '#1a1f2e',
      borderBottomColor: 'rgba(255, 255, 255, 0.15)',
    },
    headerTitle: {
      color: '#fff',
    },
    sectionTitle: {
      color: 'rgba(255, 255, 255, 0.6)',
    },
    card: {
      backgroundColor: 'rgba(255, 255, 255, 0.08)',
    },
    itemText: {
      color: '#fff',
    },
    itemSubtext: {
      color: 'rgba(255, 255, 255, 0.5)',
    },
  }), [uiTheme]);

  useEffect(() => {
    if (visible) {
      loadData();
    }
  }, [visible]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Load district data
      const districtData = await chartPackService.getDistrict('17cgd');
      setDistrict(districtData);
      
      // Check installed packs
      const installed = await chartPackService.getInstalledPackIds('17cgd');
      setInstalledPackIds(installed);
      
      // Check predictions status
      const predDownloaded = await arePredictionsDownloaded();
      setPredictionsDownloaded(predDownloaded);
    } catch (error) {
      console.error('[DownloadsModal] Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPack = async (pack: DistrictDownloadPack) => {
    if (packDownloadStatus || downloadingPredictions) {
      Alert.alert('Download in Progress', 'Please wait for the current download to complete.');
      return;
    }
    
    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      Alert.alert('No Internet', 'Please check your connection and try again.');
      return;
    }
    
    const sizeMB = pack.sizeBytes / 1024 / 1024;
    const isWifi = netState.type === 'wifi';
    const wifiWarning = !isWifi && sizeMB > 50 
      ? '\n\n⚠️ Not on WiFi - this will use cellular data.' 
      : '';
    
    Alert.alert(
      'Download',
      `Download "${pack.name}"?\n\nSize: ${sizeMB.toFixed(1)} MB${wifiWarning}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Download',
          onPress: async () => {
            try {
              const success = await chartPackService.downloadPack(
                pack,
                '17cgd',
                (status) => setPackDownloadStatus(status)
              );
              
              if (success) {
                const installed = await chartPackService.getInstalledPackIds('17cgd');
                setInstalledPackIds(installed);
                Alert.alert('Complete', `"${pack.name}" downloaded successfully.`);
              }
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Download failed');
            } finally {
              setPackDownloadStatus(null);
            }
          },
        },
      ]
    );
  };

  const handleDeletePack = async (pack: DistrictDownloadPack) => {
    Alert.alert(
      'Delete',
      `Delete "${pack.name}"? This will free up space.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await chartPackService.deletePack(pack, '17cgd');
              const installed = await chartPackService.getInstalledPackIds('17cgd');
              setInstalledPackIds(installed);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Delete failed');
            }
          },
        },
      ]
    );
  };

  const handleDownloadPredictions = async () => {
    if (packDownloadStatus || downloadingPredictions) {
      Alert.alert('Download in Progress', 'Please wait for the current download to complete.');
      return;
    }
    
    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      Alert.alert('No Internet', 'Please check your connection and try again.');
      return;
    }
    
    try {
      const metadata = await getPredictionDatabaseMetadata();
      const isWifi = netState.type === 'wifi';
      const wifiWarning = !isWifi 
        ? '\n\n⚠️ Not on WiFi - this will use cellular data.' 
        : '';
      
      Alert.alert(
        'Download Predictions',
        `Download tide and current predictions?\n\n` +
        `• Tides: ${(metadata.tidesSize / 1024 / 1024).toFixed(1)} MB\n` +
        `• Currents: ${(metadata.currentsSize / 1024 / 1024).toFixed(1)} MB\n` +
        `• Total: ${metadata.totalSizeMB.toFixed(1)} MB${wifiWarning}`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Download',
            onPress: async () => {
              setDownloadingPredictions(true);
              setPredictionsProgress('Starting...');
              setPredictionsPercent(0);
              
              try {
                const result = await downloadAllPredictions((message, percent) => {
                  setPredictionsProgress(message);
                  setPredictionsPercent(percent);
                });
                
                if (result.success) {
                  setPredictionsDownloaded(true);
                  Alert.alert('Complete', 'Predictions downloaded successfully.');
                } else {
                  Alert.alert('Error', result.error || 'Download failed');
                }
              } catch (error: any) {
                Alert.alert('Error', error.message || 'Download failed');
              } finally {
                setDownloadingPredictions(false);
                setPredictionsProgress('');
                setPredictionsPercent(0);
              }
            },
          },
        ]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Could not get download info');
    }
  };

  const handleClearPredictions = async () => {
    Alert.alert(
      'Delete Predictions',
      'Delete all tide and current prediction data?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearPredictions();
              setPredictionsDownloaded(false);
              Alert.alert('Deleted', 'Prediction data has been removed.');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Delete failed');
            }
          },
        },
      ]
    );
  };

  const renderPackItem = (pack: DistrictDownloadPack) => {
    const isInstalled = installedPackIds.includes(pack.id);
    const isDownloading = packDownloadStatus?.packId === pack.id;
    const sizeMB = pack.sizeBytes / 1024 / 1024;
    
    // Get speed info for this pack if downloading
    const speedInfo = isDownloading && packDownloadStatus?.speedBps 
      ? formatSpeed(packDownloadStatus.speedBps)
      : null;
    const etaInfo = isDownloading && packDownloadStatus?.etaSeconds
      ? formatEta(packDownloadStatus.etaSeconds)
      : null;
    
    return (
      <View key={pack.id} style={[styles.packItem, themedStyles.card]}>
        <View style={styles.packInfo}>
          <Text style={[styles.packName, themedStyles.itemText]}>{pack.name}</Text>
          <Text style={[styles.packDescription, themedStyles.itemSubtext]}>
            {pack.description}
          </Text>
          <Text style={[styles.packSize, themedStyles.itemSubtext]}>
            {sizeMB >= 1024 
              ? `${(sizeMB / 1024).toFixed(2)} GB` 
              : `${sizeMB.toFixed(1)} MB`}
            {pack.required && ' • Required'}
          </Text>
          {isDownloading && speedInfo && (
            <Text style={[styles.packSpeed, themedStyles.itemSubtext]}>
              ↓ {speedInfo}{etaInfo ? ` • ${etaInfo}` : ''}
            </Text>
          )}
        </View>
        
        <View style={styles.packActions}>
          {isDownloading ? (
            <View style={styles.progressContainer}>
              <ActivityIndicator size="small" color="#4FC3F7" />
              <Text style={styles.progressText}>
                {packDownloadStatus?.progress || 0}%
              </Text>
            </View>
          ) : isInstalled ? (
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => handleDeletePack(pack)}
            >
              <Ionicons name="trash-outline" size={20} color="#ff6b6b" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.downloadButton}
              onPress={() => handleDownloadPack(pack)}
            >
              <Ionicons name="download-outline" size={20} color="#4FC3F7" />
            </TouchableOpacity>
          )}
          
          {isInstalled && !isDownloading && (
            <Ionicons name="checkmark-circle" size={20} color="#51cf66" style={styles.installedIcon} />
          )}
        </View>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.container, themedStyles.container]} edges={['top']}>
        {/* Header */}
        <View style={[styles.header, themedStyles.header]}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Done</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, themedStyles.headerTitle]}>Downloads</Text>
          <View style={styles.headerSpacer} />
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#4FC3F7" />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        ) : (
          <ScrollView style={styles.content}>
            {/* Region Info */}
            {district && (
              <View style={styles.regionHeader}>
                <Ionicons name="location" size={20} color="#4FC3F7" />
                <Text style={[styles.regionName, themedStyles.itemText]}>
                  {district.name} ({district.code})
                </Text>
              </View>
            )}

            {/* Charts Section */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>CHARTS</Text>
              {district?.downloadPacks
                ?.filter(p => p.type === 'charts')
                .map(renderPackItem)}
            </View>

            {/* Predictions Section */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>TIDES & CURRENTS</Text>
              <View style={[styles.packItem, themedStyles.card]}>
                <View style={styles.packInfo}>
                  <Text style={[styles.packName, themedStyles.itemText]}>
                    Prediction Database
                  </Text>
                  <Text style={[styles.packDescription, themedStyles.itemSubtext]}>
                    Tide and current predictions for all Alaska stations
                  </Text>
                </View>
                
                <View style={styles.packActions}>
                  {downloadingPredictions ? (
                    <View style={styles.progressContainer}>
                      <ActivityIndicator size="small" color="#4FC3F7" />
                      <Text style={styles.progressText}>{predictionsPercent}%</Text>
                    </View>
                  ) : predictionsDownloaded ? (
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={handleClearPredictions}
                    >
                      <Ionicons name="trash-outline" size={20} color="#ff6b6b" />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.downloadButton}
                      onPress={handleDownloadPredictions}
                    >
                      <Ionicons name="download-outline" size={20} color="#4FC3F7" />
                    </TouchableOpacity>
                  )}
                  
                  {predictionsDownloaded && !downloadingPredictions && (
                    <Ionicons name="checkmark-circle" size={20} color="#51cf66" style={styles.installedIcon} />
                  )}
                </View>
              </View>
              
              {downloadingPredictions && (
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${predictionsPercent}%` }]} />
                </View>
              )}
            </View>

            {/* Satellite Imagery Section */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>SATELLITE IMAGERY</Text>
              {district?.downloadPacks
                ?.filter(p => p.type === 'satellite')
                .map(renderPackItem)}
            </View>

            {/* Other Data Section */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>OTHER DATA</Text>
              {district?.downloadPacks
                ?.filter(p => p.type !== 'charts' && p.type !== 'satellite')
                .map(renderPackItem)}
            </View>

            {/* Bottom padding */}
            <View style={{ height: 40 }} />
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1f2e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#1a1f2e',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.15)',
  },
  closeButton: {
    width: 60,
  },
  closeButtonText: {
    fontSize: 17,
    color: '#4FC3F7',
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  headerSpacer: {
    width: 60,
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  regionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 8,
  },
  regionName: {
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
    color: '#fff',
  },
  section: {
    marginTop: 16,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 8,
    marginLeft: 4,
    letterSpacing: 0.5,
  },
  packItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  packInfo: {
    flex: 1,
  },
  packName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#fff',
  },
  packDescription: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 2,
  },
  packSize: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 4,
  },
  packSpeed: {
    fontSize: 11,
    color: '#4FC3F7',
    marginTop: 2,
  },
  packActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  downloadButton: {
    padding: 8,
  },
  deleteButton: {
    padding: 8,
  },
  installedIcon: {
    marginLeft: 4,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressText: {
    marginLeft: 8,
    fontSize: 13,
    color: '#4FC3F7',
  },
  progressBar: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 2,
    marginHorizontal: 16,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4FC3F7',
    borderRadius: 2,
  },
});

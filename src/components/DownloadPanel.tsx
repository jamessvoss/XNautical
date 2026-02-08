/**
 * DownloadPanel
 *
 * Bottom panel shown in the RegionSelector when a district/subregion is selected.
 * Shows download summary with:
 *   - Charts (US1-US6) as a required package
 *   - Predictions (Tides & Currents)
 *   - Satellite imagery with resolution selector (Low/Med/High)
 *   - Basemap & GNIS (included)
 *   - Total download size
 *   - Download button with progress
 *   - Post-download management (delete individual items)
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
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
import type { Region, SatelliteResolution } from '../config/regionData';
import { SATELLITE_OPTIONS } from '../config/regionData';
import type { District, DistrictDownloadPack, PackDownloadStatus } from '../types/chartPack';

// ============================================
// Types
// ============================================

interface Props {
  region: Region | null;
  onBack: () => void;
  selectedOptionalMaps?: Set<string>;
}

interface DownloadCategory {
  id: string;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  sizeBytes: number;
  required: boolean;
  installed: boolean;
  packs: DistrictDownloadPack[];
}

// ============================================
// Component
// ============================================

export default function DownloadPanel({ region, onBack, selectedOptionalMaps }: Props) {
  const [loading, setLoading] = useState(true);
  const [districtData, setDistrictData] = useState<District | null>(null);
  const [installedPackIds, setInstalledPackIds] = useState<string[]>([]);
  const [satelliteResolution, setSatelliteResolution] = useState<SatelliteResolution>('medium');
  const [packDownloadStatus, setPackDownloadStatus] = useState<PackDownloadStatus | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [currentDownloadItem, setCurrentDownloadItem] = useState<string>('');

  // Predictions state
  const [predictionsDownloaded, setPredictionsDownloaded] = useState(false);
  const [downloadingPredictions, setDownloadingPredictions] = useState(false);
  const [predictionsPercent, setPredictionsPercent] = useState(0);

  const firestoreId = region?.firestoreId || '';

  // ============================================
  // Load data
  // ============================================

  useEffect(() => {
    if (region) {
      loadData();
    }
  }, [region]);

  const loadData = async () => {
    if (!region) return;
    try {
      setLoading(true);

      // Load district data from Firestore
      const data = await chartPackService.getDistrict(region.firestoreId);
      setDistrictData(data);

      // Check installed packs
      const installed = await chartPackService.getInstalledPackIds(region.firestoreId);
      setInstalledPackIds(installed);

      // Check predictions status
      const predDownloaded = await arePredictionsDownloaded();
      setPredictionsDownloaded(predDownloaded);
    } catch (error) {
      console.error('[DownloadPanel] Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // Organize packs into categories
  // ============================================

  const categories = useMemo((): DownloadCategory[] => {
    if (!districtData?.downloadPacks) return [];

    const packs = districtData.downloadPacks;
    const cats: DownloadCategory[] = [];

    // Charts (US1-US6) - grouped as one required package
    const chartPacks = packs.filter(p => p.type === 'charts');
    if (chartPacks.length > 0) {
      const totalSize = chartPacks.reduce((sum, p) => sum + p.sizeBytes, 0);
      const allInstalled = chartPacks.every(p => installedPackIds.includes(p.id));
      cats.push({
        id: 'charts',
        label: 'Charts (US1-US6)',
        description: `${chartPacks.length} scale packs`,
        icon: 'map',
        sizeBytes: totalSize,
        required: true,
        installed: allInstalled,
        packs: chartPacks,
      });
    }

    // Predictions (not a Firestore pack - handled separately)
    cats.push({
      id: 'predictions',
      label: 'Predictions (Tides & Currents)',
      description: 'Tide and current prediction data',
      icon: 'water',
      sizeBytes: 48 * 1024 * 1024, // ~48 MB estimate
      required: false,
      installed: predictionsDownloaded,
      packs: [],
    });

    // Satellite imagery - based on selected resolution
    const satellitePacks = packs.filter(p => p.type === 'satellite');
    if (satellitePacks.length > 0) {
      const selectedOption = SATELLITE_OPTIONS.find(o => o.resolution === satelliteResolution);
      const relevantPacks = satellitePacks; // All satellite packs available
      const totalSize = selectedOption
        ? selectedOption.estimatedSizeMB * 1024 * 1024
        : relevantPacks.reduce((sum, p) => sum + p.sizeBytes, 0);
      const anyInstalled = relevantPacks.some(p => installedPackIds.includes(p.id));
      cats.push({
        id: 'satellite',
        label: 'Satellite Imagery',
        description: selectedOption ? `${selectedOption.label} (${selectedOption.zoomLevels})` : '',
        icon: 'earth',
        sizeBytes: totalSize,
        required: false,
        installed: anyInstalled,
        packs: relevantPacks,
      });
    }

    // Basemap - only include if selected in optional maps picker
    if (!selectedOptionalMaps || selectedOptionalMaps.has('basemap')) {
      const basemapPacks = packs.filter(p => p.type === 'basemap');
      if (basemapPacks.length > 0) {
        const totalSize = basemapPacks.reduce((sum, p) => sum + p.sizeBytes, 0);
        const allInstalled = basemapPacks.every(p => installedPackIds.includes(p.id));
        cats.push({
          id: 'basemap',
          label: 'Basemap',
          description: 'Base land/water map tiles',
          icon: 'layers',
          sizeBytes: totalSize,
          required: false,
          installed: allInstalled,
          packs: basemapPacks,
        });
      }
    }

    // Ocean basemap - only include if selected in optional maps picker
    if (!selectedOptionalMaps || selectedOptionalMaps.has('ocean')) {
      const oceanPacks = packs.filter(p => p.type === 'ocean');
      if (oceanPacks.length > 0) {
        const totalSize = oceanPacks.reduce((sum, p) => sum + p.sizeBytes, 0);
        const allInstalled = oceanPacks.every(p => installedPackIds.includes(p.id));
        cats.push({
          id: 'ocean',
          label: 'Ocean Map',
          description: 'ESRI Ocean Basemap',
          icon: 'water',
          sizeBytes: totalSize,
          required: false,
          installed: allInstalled,
          packs: oceanPacks,
        });
      }
    }

    // Terrain basemap - only include if selected in optional maps picker
    if (!selectedOptionalMaps || selectedOptionalMaps.has('terrain')) {
      const terrainPacks = packs.filter(p => p.type === 'terrain');
      if (terrainPacks.length > 0) {
        const totalSize = terrainPacks.reduce((sum, p) => sum + p.sizeBytes, 0);
        const allInstalled = terrainPacks.every(p => installedPackIds.includes(p.id));
        cats.push({
          id: 'terrain',
          label: 'Terrain Map',
          description: 'OpenTopoMap terrain',
          icon: 'mountain',
          sizeBytes: totalSize,
          required: false,
          installed: allInstalled,
          packs: terrainPacks,
        });
      }
    }

    // GNIS Place Names - only include if selected in optional maps picker
    if (!selectedOptionalMaps || selectedOptionalMaps.has('gnis')) {
      const gnisPacks = packs.filter(p => p.type === 'gnis');
      if (gnisPacks.length > 0) {
        const totalSize = gnisPacks.reduce((sum, p) => sum + p.sizeBytes, 0);
        const allInstalled = gnisPacks.every(p => installedPackIds.includes(p.id));
        cats.push({
          id: 'gnis',
          label: 'Place Names (GNIS)',
          description: 'Geographic names overlay',
          icon: 'text',
          sizeBytes: totalSize,
          required: false,
          installed: allInstalled,
          packs: gnisPacks,
        });
      }
    }

    return cats;
  }, [districtData, installedPackIds, satelliteResolution, predictionsDownloaded, selectedOptionalMaps]);

  // ============================================
  // Total size calculation
  // ============================================

  const totalSizeBytes = useMemo(() => {
    return categories.reduce((sum, cat) => sum + cat.sizeBytes, 0);
  }, [categories]);

  const installedCount = useMemo(() => {
    return categories.filter(c => c.installed).length;
  }, [categories]);

  const allInstalled = installedCount === categories.length;

  // ============================================
  // Download handlers
  // ============================================

  const handleDownloadAll = async () => {
    if (downloadingAll || packDownloadStatus) {
      Alert.alert('Download in Progress', 'Please wait for the current download to complete.');
      return;
    }

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      Alert.alert('No Internet', 'Please check your connection and try again.');
      return;
    }

    const totalMB = totalSizeBytes / 1024 / 1024;
    const isWifi = netState.type === 'wifi';
    const wifiWarning = !isWifi && totalMB > 50
      ? '\n\nNot on WiFi - this will use cellular data.'
      : '';

    const regionName = region?.name || 'this region';

    Alert.alert(
      'Download All',
      `Download all data for ${regionName}?\n\nTotal: ~${totalMB >= 1024 ? `${(totalMB / 1024).toFixed(1)} GB` : `${totalMB.toFixed(0)} MB`}${wifiWarning}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Download',
          onPress: () => executeDownloadAll(),
        },
      ]
    );
  };

  const executeDownloadAll = async () => {
    setDownloadingAll(true);

    try {
      // Download each category sequentially
      for (const category of categories) {
        if (category.installed) continue;

        if (category.id === 'predictions') {
          // Handle predictions separately
          setCurrentDownloadItem('Predictions');
          setDownloadingPredictions(true);
          setPredictionsPercent(0);

          const result = await downloadAllPredictions((message, percent) => {
            setPredictionsPercent(percent);
          });

          setDownloadingPredictions(false);
          if (result.success) {
            setPredictionsDownloaded(true);
          }
          continue;
        }

        // Download all packs in this category
        for (const pack of category.packs) {
          if (installedPackIds.includes(pack.id)) continue;

          setCurrentDownloadItem(pack.name);
          const success = await chartPackService.downloadPack(
            pack,
            firestoreId,
            (status) => setPackDownloadStatus(status)
          );

          if (success) {
            setInstalledPackIds(prev => [...prev, pack.id]);
          }
          setPackDownloadStatus(null);
        }
      }

      // Refresh installed state
      const installed = await chartPackService.getInstalledPackIds(firestoreId);
      setInstalledPackIds(installed);
      const predDownloaded = await arePredictionsDownloaded();
      setPredictionsDownloaded(predDownloaded);

      Alert.alert('Complete', 'All data downloaded successfully.');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Download failed');
    } finally {
      setDownloadingAll(false);
      setCurrentDownloadItem('');
      setPackDownloadStatus(null);
    }
  };

  const handleDownloadCategory = async (category: DownloadCategory) => {
    if (downloadingAll || packDownloadStatus || downloadingPredictions) {
      Alert.alert('Download in Progress', 'Please wait for the current download to complete.');
      return;
    }

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      Alert.alert('No Internet', 'Please check your connection and try again.');
      return;
    }

    if (category.id === 'predictions') {
      handleDownloadPredictions();
      return;
    }

    const sizeMB = category.sizeBytes / 1024 / 1024;
    Alert.alert(
      'Download',
      `Download ${category.label}?\n\nSize: ~${sizeMB >= 1024 ? `${(sizeMB / 1024).toFixed(1)} GB` : `${sizeMB.toFixed(0)} MB`}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Download',
          onPress: async () => {
            for (const pack of category.packs) {
              if (installedPackIds.includes(pack.id)) continue;
              setCurrentDownloadItem(pack.name);
              const success = await chartPackService.downloadPack(
                pack,
                firestoreId,
                (status) => setPackDownloadStatus(status)
              );
              if (success) {
                setInstalledPackIds(prev => [...prev, pack.id]);
              }
              setPackDownloadStatus(null);
            }
            setCurrentDownloadItem('');
            const installed = await chartPackService.getInstalledPackIds(firestoreId);
            setInstalledPackIds(installed);
          },
        },
      ]
    );
  };

  const handleDownloadPredictions = async () => {
    try {
      const metadata = await getPredictionDatabaseMetadata();
      Alert.alert(
        'Download Predictions',
        `Download tide and current predictions?\n\n` +
        `Tides: ${(metadata.tidesSize / 1024 / 1024).toFixed(1)} MB\n` +
        `Currents: ${(metadata.currentsSize / 1024 / 1024).toFixed(1)} MB\n` +
        `Total: ${metadata.totalSizeMB.toFixed(1)} MB`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Download',
            onPress: async () => {
              setDownloadingPredictions(true);
              setPredictionsPercent(0);
              try {
                const result = await downloadAllPredictions((message, percent) => {
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

  const handleDeleteCategory = async (category: DownloadCategory) => {
    if (category.id === 'predictions') {
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
              } catch (error: any) {
                Alert.alert('Error', error.message || 'Delete failed');
              }
            },
          },
        ]
      );
      return;
    }

    Alert.alert(
      'Delete',
      `Delete ${category.label}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            for (const pack of category.packs) {
              await chartPackService.deletePack(pack, firestoreId);
            }
            const installed = await chartPackService.getInstalledPackIds(firestoreId);
            setInstalledPackIds(installed);
          },
        },
      ]
    );
  };

  // ============================================
  // Render
  // ============================================

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4FC3F7" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (!districtData && region?.status === 'pending') {
    return (
      <View style={styles.loadingContainer}>
        <Ionicons name="construct-outline" size={48} color="rgba(255,255,255,0.3)" />
        <Text style={styles.comingSoonTitle}>Coming Soon</Text>
        <Text style={styles.comingSoonText}>
          Charts for {region.name} are not yet available.{'\n'}
          Check back for updates.
        </Text>
      </View>
    );
  }

  const regionName = region?.name || 'Region';
  const isDownloading = downloadingAll || !!packDownloadStatus || downloadingPredictions;

  return (
    <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
      {/* Region header */}
      <View style={styles.regionHeader}>
        <Text style={styles.regionName}>{regionName}</Text>
        <Text style={styles.regionSummary}>
          {categories.find(c => c.id === 'charts')?.packs.length || 0} chart packs |{' '}
          ~{(totalSizeBytes / 1024 / 1024 / 1024).toFixed(1)} GB total
        </Text>
      </View>

      {/* Category items */}
      {categories.map(category => {
        const isThisDownloading =
          (category.id === 'predictions' && downloadingPredictions) ||
          (category.packs.some(p => packDownloadStatus?.packId === p.id));
        const sizeMB = category.sizeBytes / 1024 / 1024;

        return (
          <View key={category.id} style={styles.categoryItem}>
            <View style={styles.categoryLeft}>
              <View style={styles.categoryIconContainer}>
                <Ionicons name={category.icon} size={20} color="#4FC3F7" />
              </View>
              <View style={styles.categoryInfo}>
                <Text style={styles.categoryLabel}>{category.label}</Text>
                <View style={styles.categorySizeRow}>
                  <Text style={styles.categorySize}>
                    {sizeMB >= 1024
                      ? `${(sizeMB / 1024).toFixed(1)} GB`
                      : `${sizeMB.toFixed(0)} MB`}
                  </Text>
                  {category.required && (
                    <Text style={styles.categoryRequired}>Required</Text>
                  )}
                </View>
                {/* Download speed info */}
                {isThisDownloading && packDownloadStatus?.speedBps && (
                  <Text style={styles.speedText}>
                    {formatSpeed(packDownloadStatus.speedBps)}
                    {packDownloadStatus.etaSeconds
                      ? ` | ${formatEta(packDownloadStatus.etaSeconds)}`
                      : ''}
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.categoryActions}>
              {isThisDownloading ? (
                <View style={styles.progressContainer}>
                  <ActivityIndicator size="small" color="#4FC3F7" />
                  <Text style={styles.progressText}>
                    {category.id === 'predictions'
                      ? `${predictionsPercent}%`
                      : `${packDownloadStatus?.progress || 0}%`}
                  </Text>
                </View>
              ) : category.installed ? (
                <>
                  <Ionicons name="checkmark-circle" size={20} color="#51cf66" />
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleDeleteCategory(category)}
                  >
                    <Ionicons name="trash-outline" size={18} color="#ff6b6b" />
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => handleDownloadCategory(category)}
                  disabled={isDownloading}
                >
                  <Ionicons
                    name="download-outline"
                    size={20}
                    color={isDownloading ? 'rgba(255,255,255,0.2)' : '#4FC3F7'}
                  />
                </TouchableOpacity>
              )}
            </View>
          </View>
        );
      })}

      {/* Satellite resolution selector */}
      {categories.some(c => c.id === 'satellite') && (
        <View style={styles.satelliteSection}>
          <Text style={styles.satelliteSectionTitle}>SATELLITE RESOLUTION</Text>
          <View style={styles.satelliteOptions}>
            {SATELLITE_OPTIONS.map(option => (
              <TouchableOpacity
                key={option.resolution}
                style={[
                  styles.satelliteOption,
                  satelliteResolution === option.resolution && styles.satelliteOptionSelected,
                ]}
                onPress={() => setSatelliteResolution(option.resolution)}
              >
                <View style={styles.satelliteRadio}>
                  {satelliteResolution === option.resolution && (
                    <View style={styles.satelliteRadioFill} />
                  )}
                </View>
                <View style={styles.satelliteOptionInfo}>
                  <Text style={[
                    styles.satelliteOptionLabel,
                    satelliteResolution === option.resolution && styles.satelliteOptionLabelSelected,
                  ]}>
                    {option.label}
                  </Text>
                  <Text style={styles.satelliteOptionZoom}>{option.zoomLevels}</Text>
                </View>
                <Text style={styles.satelliteOptionSize}>
                  ~{option.estimatedSizeMB >= 1024
                    ? `${(option.estimatedSizeMB / 1024).toFixed(1)} GB`
                    : `${option.estimatedSizeMB} MB`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Total & download button */}
      <View style={styles.totalSection}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total Download</Text>
          <Text style={styles.totalSize}>
            ~{(totalSizeBytes / 1024 / 1024) >= 1024
              ? `${(totalSizeBytes / 1024 / 1024 / 1024).toFixed(1)} GB`
              : `${(totalSizeBytes / 1024 / 1024).toFixed(0)} MB`}
          </Text>
        </View>

        {allInstalled ? (
          <View style={styles.allInstalledBanner}>
            <Ionicons name="checkmark-circle" size={24} color="#51cf66" />
            <Text style={styles.allInstalledText}>All data installed</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.downloadAllButton, isDownloading && styles.downloadAllButtonDisabled]}
            onPress={handleDownloadAll}
            disabled={isDownloading}
          >
            {isDownloading ? (
              <>
                <ActivityIndicator size="small" color="#ffffff" />
                <Text style={styles.downloadAllText}>
                  Downloading {currentDownloadItem}...
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="download" size={20} color="#ffffff" />
                <Text style={styles.downloadAllText}>Download All</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Progress bar during downloads */}
      {isDownloading && (
        <View style={styles.downloadProgressBar}>
          <View
            style={[
              styles.downloadProgressFill,
              {
                width: `${downloadingPredictions
                  ? predictionsPercent
                  : (packDownloadStatus?.progress || 0)}%`,
              },
            ]}
          />
        </View>
      )}

      <View style={{ height: 30 }} />
    </ScrollView>
  );
}

// ============================================
// Styles
// ============================================

const styles = StyleSheet.create({
  scrollContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  comingSoonTitle: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  comingSoonText: {
    marginTop: 8,
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
    lineHeight: 20,
  },

  // Region header
  regionHeader: {
    marginBottom: 16,
  },
  regionName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
  },
  regionSummary: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 4,
  },

  // Category items
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  categoryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  categoryIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(79, 195, 247, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  categoryInfo: {
    flex: 1,
  },
  categoryLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#ffffff',
  },
  categorySizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  categorySize: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  categoryRequired: {
    fontSize: 10,
    color: '#4FC3F7',
    fontWeight: '600',
    marginLeft: 8,
    backgroundColor: 'rgba(79, 195, 247, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  speedText: {
    fontSize: 11,
    color: '#4FC3F7',
    marginTop: 2,
  },
  categoryActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionButton: {
    padding: 6,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressText: {
    fontSize: 12,
    color: '#4FC3F7',
    fontWeight: '600',
  },

  // Satellite resolution
  satelliteSection: {
    marginTop: 8,
    marginBottom: 8,
  },
  satelliteSectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.4)',
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 4,
  },
  satelliteOptions: {
    gap: 6,
  },
  satelliteOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  satelliteOptionSelected: {
    backgroundColor: 'rgba(79, 195, 247, 0.08)',
    borderColor: 'rgba(79, 195, 247, 0.25)',
  },
  satelliteRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  satelliteRadioFill: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4FC3F7',
  },
  satelliteOptionInfo: {
    flex: 1,
  },
  satelliteOptionLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: '500',
  },
  satelliteOptionLabelSelected: {
    color: '#ffffff',
  },
  satelliteOptionZoom: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.4)',
    marginTop: 1,
  },
  satelliteOptionSize: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '500',
  },

  // Total & download
  totalSection: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: 14,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  totalSize: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  downloadAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4FC3F7',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  downloadAllButtonDisabled: {
    backgroundColor: 'rgba(79, 195, 247, 0.4)',
  },
  downloadAllText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  allInstalledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(81, 207, 102, 0.1)',
    borderRadius: 12,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(81, 207, 102, 0.2)',
  },
  allInstalledText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#51cf66',
  },
  downloadProgressBar: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 2,
    marginTop: 12,
    overflow: 'hidden',
  },
  downloadProgressFill: {
    height: '100%',
    backgroundColor: '#4FC3F7',
    borderRadius: 2,
  },
});

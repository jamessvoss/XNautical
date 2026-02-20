/**
 * RegionManageModal
 *
 * Full-screen modal for managing a single installed region.
 * Shows every downloadable item with its install status, allowing
 * individual downloads, re-downloads, and deletions.
 *
 * Opened from StatsContent when tapping an installed region row.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import * as chartPackService from '../services/chartPackService';
import { formatBytes } from '../services/chartService';
import {
  downloadAllPredictions,
  arePredictionsDownloaded,
  clearPredictions,
  getPredictionDatabaseMetadata,
} from '../services/stationService';
import {
  downloadBuoyCatalog,
  areBuoysDownloaded,
  clearBuoys,
} from '../services/buoyService';
import {
  downloadMarineZones,
  areMarineZonesDownloaded,
  clearMarineZones,
} from '../services/marineZoneService';
import { getRegionByFirestoreId } from '../config/regionData';
import type { District, DistrictDownloadPack, PackDownloadStatus } from '../types/chartPack';

// ============================================
// Types
// ============================================

interface Props {
  visible: boolean;
  districtId: string;
  onClose: (refreshNeeded?: boolean) => void;
}

interface PackItem {
  id: string;
  label: string;
  description: string;
  sizeBytes: number;
  installed: boolean;
  type: 'pack' | 'predictions' | 'buoys' | 'marine-zones';
  pack?: DistrictDownloadPack;
}

interface Section {
  title: string;
  items: PackItem[];
}

// Decompression ratio: MBTiles and SQLite compress to ~50%
const DECOMPRESSION_RATIO = 2.0;

// ============================================
// Component
// ============================================

export default function RegionManageModal({ visible, districtId, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [districtData, setDistrictData] = useState<District | null>(null);
  const [installedPackIds, setInstalledPackIds] = useState<string[]>([]);
  const [predictionsDownloaded, setPredictionsDownloaded] = useState(false);
  const [buoysDownloaded, setBuoysDownloaded] = useState(false);
  const [marineZonesDownloaded, setMarineZonesDownloaded] = useState(false);
  const [changesMade, setChangesMade] = useState(false);

  // Download state for individual items
  const [downloadingItemId, setDownloadingItemId] = useState<string | null>(null);
  const [packDownloadStatus, setPackDownloadStatus] = useState<PackDownloadStatus | null>(null);
  const [servicePercent, setServicePercent] = useState(0);
  const [serviceMessage, setServiceMessage] = useState('');

  const regionName = useMemo(() => {
    const region = getRegionByFirestoreId(districtId);
    return region?.name || districtId;
  }, [districtId]);

  // ============================================
  // Load data
  // ============================================

  useEffect(() => {
    if (visible && districtId) {
      loadData();
    }
  }, [visible, districtId]);

  const loadData = async () => {
    try {
      setLoading(true);

      const [data, installed, predDl, buoysDl, zonesDl] = await Promise.all([
        chartPackService.getDistrict(districtId),
        chartPackService.getInstalledPackIds(districtId),
        arePredictionsDownloaded(districtId),
        areBuoysDownloaded(districtId),
        areMarineZonesDownloaded(districtId),
      ]);

      setDistrictData(data);
      setInstalledPackIds(installed);
      setPredictionsDownloaded(predDl);
      setBuoysDownloaded(buoysDl);
      setMarineZonesDownloaded(zonesDl);
    } catch (error) {
      console.error('[RegionManageModal] Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // Refresh state after an action
  // ============================================

  const refreshState = useCallback(async () => {
    try {
      const [installed, predDl, buoysDl, zonesDl] = await Promise.all([
        chartPackService.getInstalledPackIds(districtId),
        arePredictionsDownloaded(districtId),
        areBuoysDownloaded(districtId),
        areMarineZonesDownloaded(districtId),
      ]);
      setInstalledPackIds(installed);
      setPredictionsDownloaded(predDl);
      setBuoysDownloaded(buoysDl);
      setMarineZonesDownloaded(zonesDl);
    } catch (error) {
      console.error('[RegionManageModal] Error refreshing state:', error);
    }
  }, [districtId]);

  const updateRegistry = useCallback(async () => {
    try {
      const installed = await chartPackService.getInstalledPackIds(districtId);
      const predDl = await arePredictionsDownloaded(districtId);
      const buoysDl = await areBuoysDownloaded(districtId);
      const zonesDl = await areMarineZonesDownloaded(districtId);

      const { registerDistrict } = await import('../services/regionRegistryService');
      await registerDistrict(districtId, {
        hasCharts: installed.includes('charts') || installed.some(id => id.startsWith('charts-')),
        hasPredictions: predDl,
        hasBuoys: buoysDl,
        hasMarineZones: zonesDl,
        hasSatellite: installed.some(id => id.startsWith('satellite-')),
        hasBasemap: installed.includes('basemap'),
        hasGnis: installed.includes('gnis'),
        hasOcean: installed.some(id => id === 'ocean' || id.startsWith('ocean-') || id.includes('_ocean')),
        hasTerrain: installed.some(id => id === 'terrain' || id.startsWith('terrain-') || id.includes('_terrain')),
      });
    } catch (error) {
      console.error('[RegionManageModal] Error updating registry:', error);
    }
  }, [districtId]);

  // ============================================
  // Build sections
  // ============================================

  const sections = useMemo((): Section[] => {
    if (!districtData?.downloadPacks) return [];

    const packs = districtData.downloadPacks;
    const result: Section[] = [];
    const metadataAny = districtData as any;

    // --- CHARTS ---
    const chartPacks = packs.filter(p => p.type === 'charts');
    if (chartPacks.length > 0) {
      result.push({
        title: 'CHARTS',
        items: chartPacks.map(p => ({
          id: p.id,
          label: p.name,
          description: p.band ? `Scale ${p.band}` : p.description,
          sizeBytes: p.sizeBytes * DECOMPRESSION_RATIO,
          installed: installedPackIds.includes(p.id),
          type: 'pack' as const,
          pack: p,
        })),
      });
    }

    // --- DATA ---
    const dataItems: PackItem[] = [];

    // Predictions
    let predictionSize = 48 * 1024 * 1024;
    if (metadataAny.metadata?.predictionSizes) {
      const predSizes = metadataAny.metadata.predictionSizes;
      predictionSize = ((predSizes.tides || 0) + (predSizes.currents || 0)) * DECOMPRESSION_RATIO;
    }
    dataItems.push({
      id: 'predictions',
      label: 'Predictions (Tides & Currents)',
      description: 'Tide and current prediction data',
      sizeBytes: predictionSize,
      installed: predictionsDownloaded,
      type: 'predictions',
    });

    // Buoys
    let buoySize = 1 * 1024 * 1024;
    if (metadataAny.metadata?.buoyCount) {
      buoySize = metadataAny.metadata.buoyCount * 5 * 1024;
    }
    dataItems.push({
      id: 'buoys',
      label: 'Live Buoys',
      description: metadataAny.metadata?.buoyCount
        ? `${metadataAny.metadata.buoyCount} buoy stations`
        : 'Weather buoy locations & observations',
      sizeBytes: buoySize,
      installed: buoysDownloaded,
      type: 'buoys',
    });

    // Marine Zones
    let marineZoneSize = 0.5 * 1024 * 1024;
    if (metadataAny.metadata?.marineZoneCount) {
      marineZoneSize = metadataAny.metadata.marineZoneCount * 20 * 1024;
    }
    dataItems.push({
      id: 'marine-zones',
      label: 'Marine Zone Boundaries',
      description: metadataAny.metadata?.marineZoneCount
        ? `${metadataAny.metadata.marineZoneCount} forecast zones`
        : 'Weather forecast zone boundaries',
      sizeBytes: marineZoneSize,
      installed: marineZonesDownloaded,
      type: 'marine-zones',
    });

    // GNIS — always show, even if not in download metadata
    const gnisPack = packs.find(p => p.type === 'gnis');
    const gnisInstalled = installedPackIds.includes('gnis');
    const gnisFallbackPack: DistrictDownloadPack = {
      id: 'gnis',
      type: 'gnis',
      name: 'Place Names (GNIS)',
      description: 'Geographic place names overlay',
      storagePath: `${districtId}/gnis/gnis_names.mbtiles.zip`,
      sizeBytes: 40 * 1024 * 1024, // 40 MB estimate
      required: true,
    };
    dataItems.push({
      id: 'gnis',
      label: 'Place Names (GNIS)',
      description: 'Geographic names overlay',
      sizeBytes: gnisPack ? gnisPack.sizeBytes * DECOMPRESSION_RATIO : gnisFallbackPack.sizeBytes,
      installed: gnisInstalled,
      type: 'pack',
      pack: gnisPack || gnisFallbackPack,
    });

    result.push({ title: 'DATA', items: dataItems });

    // --- SATELLITE ---
    const satellitePacks = packs.filter(p => p.type === 'satellite');
    if (satellitePacks.length > 0) {
      // Sort by zoom range start
      const sorted = [...satellitePacks].sort((a, b) => {
        const zA = parseInt((a.id.match(/z(\d+)/) || ['', '0'])[1]);
        const zB = parseInt((b.id.match(/z(\d+)/) || ['', '0'])[1]);
        return zA - zB;
      });

      result.push({
        title: 'SATELLITE',
        items: sorted.map(p => ({
          id: p.id,
          label: p.name,
          description: p.description,
          sizeBytes: p.sizeBytes * DECOMPRESSION_RATIO,
          installed: installedPackIds.includes(p.id),
          type: 'pack' as const,
          pack: p,
        })),
      });
    }

    // --- OPTIONAL MAPS ---
    const optionalTypes: Array<{ type: string; label: string; desc: string }> = [
      { type: 'basemap', label: 'Basemap', desc: 'Base land/water map tiles' },
      { type: 'ocean', label: 'Ocean Map', desc: 'ESRI Ocean Basemap' },
      { type: 'terrain', label: 'Terrain Map', desc: 'OpenTopoMap terrain' },
    ];
    const optionalItems: PackItem[] = [];

    for (const opt of optionalTypes) {
      const optPacks = packs.filter(p => p.type === opt.type);
      if (optPacks.length > 0) {
        const totalSize = optPacks.reduce((sum, p) => sum + (p.sizeBytes * DECOMPRESSION_RATIO), 0);
        const allInstalled = optPacks.every(p => installedPackIds.includes(p.id));
        optionalItems.push({
          id: opt.type,
          label: opt.label,
          description: opt.desc,
          sizeBytes: totalSize,
          installed: allInstalled,
          type: 'pack',
          // Store first pack for single-pack types; for multi-pack we handle in download
          pack: optPacks.length === 1 ? optPacks[0] : undefined,
        });
      }
    }

    if (optionalItems.length > 0) {
      result.push({ title: 'OPTIONAL MAPS', items: optionalItems });
    }

    return result;
  }, [districtData, installedPackIds, predictionsDownloaded, buoysDownloaded, marineZonesDownloaded]);

  // ============================================
  // Download handlers
  // ============================================

  const isDownloading = downloadingItemId !== null;

  const getPacksForItem = (item: PackItem): DistrictDownloadPack[] => {
    if (item.pack) return [item.pack];
    // For grouped optional maps (ocean, terrain, basemap), find all packs of that type
    if (districtData?.downloadPacks) {
      return districtData.downloadPacks.filter(p => p.type === item.id);
    }
    return [];
  };

  const handleDownloadItem = async (item: PackItem) => {
    if (isDownloading) {
      Alert.alert('Download in Progress', 'Please wait for the current download to complete.');
      return;
    }

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      Alert.alert('No Internet', 'Please check your connection and try again.');
      return;
    }

    const sizeMB = item.sizeBytes / 1024 / 1024;
    const sizeLabel = sizeMB >= 1024
      ? `${(sizeMB / 1024).toFixed(1)} GB`
      : `${sizeMB.toFixed(0)} MB`;

    Alert.alert(
      `Download ${item.label}?`,
      `Size: ~${sizeLabel}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Download',
          onPress: () => executeDownload(item),
        },
      ]
    );
  };

  const executeDownload = async (item: PackItem, forceRedownload = false) => {
    setDownloadingItemId(item.id);
    setServicePercent(0);
    setServiceMessage('');

    try {
      if (item.type === 'predictions') {
        const result = await downloadAllPredictions((message, percent) => {
          setServicePercent(percent);
          setServiceMessage(message);
        }, districtId);
        if (result.success) {
          setPredictionsDownloaded(true);
        } else {
          Alert.alert('Error', result.error || 'Download failed');
        }
      } else if (item.type === 'buoys') {
        const result = await downloadBuoyCatalog(districtId, (message, percent) => {
          setServicePercent(percent);
          setServiceMessage(message);
        });
        if (result.success) {
          setBuoysDownloaded(true);
        } else {
          Alert.alert('Error', result.error || 'Download failed');
        }
      } else if (item.type === 'marine-zones') {
        const result = await downloadMarineZones(districtId, (message, percent) => {
          setServicePercent(percent);
          setServiceMessage(message);
        });
        if (result.success) {
          setMarineZonesDownloaded(true);
        } else {
          Alert.alert('Error', result.error || 'Download failed');
        }
      } else {
        // MBTiles pack download
        // When forceRedownload is true, re-check disk instead of using stale React state
        const currentInstalled = forceRedownload
          ? await chartPackService.getInstalledPackIds(districtId)
          : installedPackIds;
        const packs = getPacksForItem(item);
        for (const pack of packs) {
          if (currentInstalled.includes(pack.id)) continue;
          const success = await chartPackService.downloadPack(
            pack,
            districtId,
            (status) => setPackDownloadStatus(status),
            true,
          );
          if (success) {
            setInstalledPackIds(prev => [...prev, pack.id]);
          }
          setPackDownloadStatus(null);
        }
        await chartPackService.generateManifest();
      }

      setChangesMade(true);
      await refreshState();
      await updateRegistry();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Download failed');
    } finally {
      setDownloadingItemId(null);
      setServicePercent(0);
      setServiceMessage('');
      setPackDownloadStatus(null);
    }
  };

  const handleInstalledItemTap = (item: PackItem) => {
    if (isDownloading) return;

    Alert.alert(
      item.label,
      formatBytes(item.sizeBytes),
      [
        {
          text: 'Re-download',
          onPress: () => handleRedownload(item),
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => handleDeleteItem(item),
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleRedownload = async (item: PackItem) => {
    // Delete then download (forceRedownload=true to re-check disk, not stale state)
    await handleDeleteItemSilent(item);
    executeDownload(item, true);
  };

  const handleDeleteItemSilent = async (item: PackItem) => {
    try {
      if (item.type === 'predictions') {
        await clearPredictions(districtId);
        setPredictionsDownloaded(false);
      } else if (item.type === 'buoys') {
        await clearBuoys(districtId);
        setBuoysDownloaded(false);
      } else if (item.type === 'marine-zones') {
        await clearMarineZones(districtId);
        setMarineZonesDownloaded(false);
      } else {
        const packs = getPacksForItem(item);
        for (const pack of packs) {
          await chartPackService.deletePack(pack, districtId);
        }
        await chartPackService.generateManifest();
      }
      setChangesMade(true);
      await refreshState();
      await updateRegistry();
    } catch (error: any) {
      console.error('[RegionManageModal] Error deleting item:', error);
    }
  };

  const handleDeleteItem = async (item: PackItem) => {
    Alert.alert(
      `Delete ${item.label}?`,
      'This data will need to be re-downloaded.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await handleDeleteItemSilent(item);
          },
        },
      ]
    );
  };

  // ============================================
  // Delete entire region
  // ============================================

  const handleDeleteRegion = () => {
    Alert.alert(
      'Delete Region',
      `Delete all downloaded data for ${regionName}?\n\nThis includes charts, predictions, buoys, satellite imagery, and all other data for this region.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            try {
              const { getInstalledDistrictIds, unregisterDistrict } = await import('../services/regionRegistryService');
              const allDistrictIds = await getInstalledDistrictIds();
              const otherDistrictIds = allDistrictIds.filter(id => id !== districtId);

              await chartPackService.deleteRegion(districtId, otherDistrictIds);
              await clearBuoys(districtId);
              await clearMarineZones(districtId);
              await unregisterDistrict(districtId);

              Alert.alert('Region Deleted', `All data for ${regionName} has been removed.`, [
                { text: 'OK', onPress: () => onClose(true) },
              ]);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Delete failed');
            }
          },
        },
      ]
    );
  };

  // ============================================
  // Format size helper
  // ============================================

  const formatSize = (bytes: number): string => {
    const mb = bytes / 1024 / 1024;
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${mb.toFixed(0)} MB`;
  };

  // ============================================
  // Render
  // ============================================

  const renderItem = (item: PackItem) => {
    const isThisDownloading = downloadingItemId === item.id;
    const progress = item.type === 'pack'
      ? packDownloadStatus?.progress || 0
      : servicePercent;

    return (
      <TouchableOpacity
        key={item.id}
        style={styles.itemRow}
        onPress={() => {
          if (isThisDownloading) return;
          if (item.installed) {
            handleInstalledItemTap(item);
          } else {
            handleDownloadItem(item);
          }
        }}
        disabled={isDownloading && !isThisDownloading}
        activeOpacity={0.6}
      >
        <View style={styles.itemLeft}>
          {isThisDownloading ? (
            <ActivityIndicator size="small" color="#4FC3F7" style={styles.itemIcon} />
          ) : item.installed ? (
            <Ionicons name="checkmark-circle" size={20} color="#51cf66" style={styles.itemIcon} />
          ) : (
            <Ionicons name="download-outline" size={20} color="#4FC3F7" style={styles.itemIcon} />
          )}
          <View style={styles.itemInfo}>
            <Text style={[styles.itemLabel, isDownloading && !isThisDownloading && styles.itemLabelDisabled]}>
              {item.label}
            </Text>
            {isThisDownloading ? (
              <Text style={styles.itemProgress}>
                {progress}%{serviceMessage ? ` - ${serviceMessage}` : ''}
                {packDownloadStatus?.status === 'extracting' ? ' - Extracting...' : ''}
              </Text>
            ) : (
              <Text style={styles.itemSize}>{formatSize(item.sizeBytes)}</Text>
            )}
          </View>
        </View>
        {isThisDownloading && (
          <View style={styles.progressBarContainer}>
            <View style={[styles.progressBar, { width: `${progress}%` }]} />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => onClose(changesMade)}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => onClose(changesMade)}
          >
            <Ionicons name="chevron-back" size={24} color="#fff" />
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{regionName}</Text>
          <View style={styles.headerSpacer} />
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#4FC3F7" />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        ) : (
          <ScrollView
            style={styles.scrollContent}
            contentContainerStyle={styles.scrollContentContainer}
            showsVerticalScrollIndicator={false}
          >
            {sections.map((section) => (
              <View key={section.title} style={styles.section}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <View style={styles.card}>
                  {section.items.map((item, index) => (
                    <React.Fragment key={item.id}>
                      {renderItem(item)}
                      {index < section.items.length - 1 && <View style={styles.separator} />}
                    </React.Fragment>
                  ))}
                </View>
              </View>
            ))}

            {/* Delete Entire Region */}
            {!isDownloading && sections.length > 0 && (
              <View style={styles.deleteSection}>
                <TouchableOpacity
                  style={styles.deleteRegionButton}
                  onPress={handleDeleteRegion}
                  activeOpacity={0.7}
                >
                  <Ionicons name="trash-outline" size={18} color="#ff6b6b" />
                  <Text style={styles.deleteRegionText}>Delete Entire Region</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

// ============================================
// Styles
// ============================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1f2e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.15)',
  },
  closeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 80,
  },
  closeText: {
    fontSize: 16,
    color: '#4FC3F7',
    marginLeft: 2,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    minWidth: 80,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  scrollContent: {
    flex: 1,
  },
  scrollContentContainer: {
    paddingHorizontal: 16,
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    overflow: 'hidden',
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginHorizontal: 16,
  },
  itemRow: {
    flexDirection: 'column',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemIcon: {
    width: 24,
    marginRight: 12,
  },
  itemInfo: {
    flex: 1,
  },
  itemLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#fff',
  },
  itemLabelDisabled: {
    color: 'rgba(255, 255, 255, 0.4)',
  },
  itemSize: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 2,
  },
  itemProgress: {
    fontSize: 13,
    color: '#4FC3F7',
    marginTop: 2,
  },
  progressBarContainer: {
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 1.5,
    marginTop: 10,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#4FC3F7',
    borderRadius: 1.5,
  },
  deleteSection: {
    marginTop: 32,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingTop: 24,
  },
  deleteRegionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.3)',
    backgroundColor: 'rgba(255, 107, 107, 0.08)',
  },
  deleteRegionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ff6b6b',
  },
});

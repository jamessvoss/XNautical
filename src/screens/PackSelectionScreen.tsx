/**
 * Pack Selection Screen - Map-based interface for selecting chart packs to download
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import { CHART_PACKS, chartIntersectsPack, getPackById } from '../data/chartPacks';
import { ChartPack, ChartPackWithCharts, PackDownloadProgress } from '../types/chartPack';
import { ChartMetadata } from '../types/chart';
import * as chartService from '../services/chartService';
import * as chartCacheService from '../services/chartCacheService';
import * as chartLoader from '../services/chartLoader';
import { waitForAuth } from '../config/firebase';

// Initialize Mapbox
Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || '');

interface Props {
  onNavigateToViewer: () => void;
}

export default function PackSelectionScreen({ onNavigateToViewer }: Props) {
  const mapRef = useRef<Mapbox.MapView>(null);
  const cameraRef = useRef<Mapbox.Camera>(null);
  
  // State
  const [allCharts, setAllCharts] = useState<ChartMetadata[]>([]);
  const [downloadedChartIds, setDownloadedChartIds] = useState<string[]>([]);
  const [selectedPack, setSelectedPack] = useState<ChartPackWithCharts | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloadProgress, setDownloadProgress] = useState<PackDownloadProgress | null>(null);
  const [totalCacheSize, setTotalCacheSize] = useState(0);

  // Load chart metadata on mount
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Wait for auth to be ready
      console.log('PackSelectionScreen: Waiting for auth...');
      const user = await waitForAuth();
      console.log('PackSelectionScreen: Auth ready, user:', user?.email, 'uid:', user?.uid);
      
      if (!user) {
        console.log('PackSelectionScreen: No user after waitForAuth, cannot load charts');
        setLoading(false);
        return;
      }
      
      await chartCacheService.initializeCache();
      
      // Try to load from Firebase
      try {
        console.log('PackSelectionScreen: Fetching charts from Firestore...');
        const charts = await chartService.getAllCharts();
        console.log('PackSelectionScreen: Fetched', charts.length, 'charts from Firebase');
        setAllCharts(charts);
        // Cache for offline use
        await chartCacheService.cacheChartMetadata(charts);
      } catch (error: any) {
        console.log('PackSelectionScreen: Failed to fetch from Firebase:', error.code, error.message);
        const cached = await chartCacheService.getCachedChartMetadata();
        if (cached) {
          console.log('PackSelectionScreen: Loaded', cached.length, 'charts from cache');
          setAllCharts(cached);
        }
      }
      
      const downloaded = await chartCacheService.getDownloadedChartIds();
      setDownloadedChartIds(downloaded);
      
      const cacheSize = await chartCacheService.getCacheSize();
      setTotalCacheSize(cacheSize);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Get charts for a pack
  const getChartsForPack = useCallback((pack: ChartPack): ChartMetadata[] => {
    return allCharts.filter(chart => 
      chartIntersectsPack(chart.bounds, pack.bounds)
    );
  }, [allCharts]);

  // Build pack with chart info
  const buildPackWithCharts = useCallback((pack: ChartPack): ChartPackWithCharts => {
    const charts = getChartsForPack(pack);
    const downloadedCount = charts.filter(c => 
      downloadedChartIds.includes(c.chartId)
    ).length;
    
    return {
      ...pack,
      chartIds: charts.map(c => c.chartId),
      chartCount: charts.length,
      totalSizeBytes: charts.reduce((sum, c) => sum + (c.fileSizeBytes || 0), 0),
      downloadedCount,
    };
  }, [getChartsForPack, downloadedChartIds]);

  // Handle pack selection
  const handlePackPress = (packId: string) => {
    const pack = getPackById(packId);
    if (pack) {
      const packWithCharts = buildPackWithCharts(pack);
      setSelectedPack(packWithCharts);
      
      // Fly to pack location
      cameraRef.current?.flyTo(pack.center, 1000);
      setTimeout(() => {
        cameraRef.current?.zoomTo(pack.zoom, 1000);
      }, 500);
    }
  };

  // Download all charts in pack
  const downloadPack = async () => {
    if (!selectedPack) return;
    
    const chartsToDownload = selectedPack.chartIds.filter(
      id => !downloadedChartIds.includes(id)
    );
    
    if (chartsToDownload.length === 0) {
      Alert.alert('Already Downloaded', 'All charts in this pack are already downloaded.');
      return;
    }
    
    setDownloadProgress({
      packId: selectedPack.id,
      totalCharts: chartsToDownload.length,
      downloadedCharts: 0,
      totalBytes: selectedPack.totalSizeBytes,
      downloadedBytes: 0,
      status: 'downloading',
    });
    
    try {
      for (let i = 0; i < chartsToDownload.length; i++) {
        const chartId = chartsToDownload[i];
        const chart = allCharts.find(c => c.chartId === chartId);
        
        if (!chart) continue;
        
        setDownloadProgress(prev => prev ? {
          ...prev,
          currentChartId: chartId,
          downloadedCharts: i,
        } : null);
        
        // Download chart
        const features = await chartService.downloadChart(chartId, chart.region);
        await chartCacheService.saveChart(chartId, features);
        
        // Update downloaded list
        setDownloadedChartIds(prev => [...prev, chartId]);
      }
      
      setDownloadProgress(prev => prev ? {
        ...prev,
        status: 'completed',
        downloadedCharts: chartsToDownload.length,
      } : null);
      
      // Update cache size
      const cacheSize = await chartCacheService.getCacheSize();
      setTotalCacheSize(cacheSize);
      
      // Update selected pack
      if (selectedPack) {
        setSelectedPack(buildPackWithCharts(selectedPack));
      }
      
      setTimeout(() => setDownloadProgress(null), 2000);
      
    } catch (error) {
      console.error('Error downloading pack:', error);
      setDownloadProgress(prev => prev ? {
        ...prev,
        status: 'failed',
        error: 'Download failed',
      } : null);
      Alert.alert('Error', 'Failed to download some charts. Please try again.');
      setTimeout(() => setDownloadProgress(null), 3000);
    }
  };

  // Delete pack charts
  const deletePack = async () => {
    if (!selectedPack) return;
    
    Alert.alert(
      'Delete Pack',
      `Delete all ${selectedPack.downloadedCount} downloaded charts from "${selectedPack.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            for (const chartId of selectedPack.chartIds) {
              if (downloadedChartIds.includes(chartId)) {
                await chartCacheService.deleteChart(chartId);
                chartLoader.unloadChart(chartId);
              }
            }
            
            const newDownloaded = downloadedChartIds.filter(
              id => !selectedPack.chartIds.includes(id)
            );
            setDownloadedChartIds(newDownloaded);
            
            const cacheSize = await chartCacheService.getCacheSize();
            setTotalCacheSize(cacheSize);
            
            setSelectedPack(buildPackWithCharts(selectedPack));
          },
        },
      ]
    );
  };

  // Generate GeoJSON for pack regions
  const packRegionsGeoJSON: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: CHART_PACKS.map(pack => {
      const packWithCharts = buildPackWithCharts(pack);
      const isFullyDownloaded = packWithCharts.downloadedCount === packWithCharts.chartCount && packWithCharts.chartCount > 0;
      const isPartiallyDownloaded = packWithCharts.downloadedCount > 0;
      
      return {
        type: 'Feature',
        properties: {
          id: pack.id,
          name: pack.name,
          color: pack.color,
          chartCount: packWithCharts.chartCount,
          downloadedCount: packWithCharts.downloadedCount,
          isFullyDownloaded,
          isPartiallyDownloaded,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [pack.bounds[0], pack.bounds[1]], // SW
            [pack.bounds[2], pack.bounds[1]], // SE
            [pack.bounds[2], pack.bounds[3]], // NE
            [pack.bounds[0], pack.bounds[3]], // NW
            [pack.bounds[0], pack.bounds[1]], // Close
          ]],
        },
      };
    }),
  };

  // Pack labels GeoJSON
  const packLabelsGeoJSON: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: CHART_PACKS.map(pack => ({
      type: 'Feature',
      properties: {
        id: pack.id,
        name: pack.name,
      },
      geometry: {
        type: 'Point',
        coordinates: pack.center,
      },
    })),
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading chart data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Map */}
      <Mapbox.MapView
        ref={mapRef}
        style={styles.map}
        styleURL={Mapbox.StyleURL.Light}
      >
        <Mapbox.Camera
          ref={cameraRef}
          zoomLevel={4}
          centerCoordinate={[-152, 61]}
        />

        {/* Pack regions */}
        <Mapbox.ShapeSource
          id="pack-regions"
          shape={packRegionsGeoJSON}
          onPress={(e) => {
            const feature = e.features?.[0];
            if (feature?.properties?.id) {
              handlePackPress(feature.properties.id as string);
            }
          }}
        >
          <Mapbox.FillLayer
            id="pack-fill"
            style={{
              fillColor: ['get', 'color'],
              fillOpacity: [
                'case',
                ['get', 'isFullyDownloaded'], 0.4,
                ['get', 'isPartiallyDownloaded'], 0.25,
                0.15,
              ],
            }}
          />
          <Mapbox.LineLayer
            id="pack-outline"
            style={{
              lineColor: ['get', 'color'],
              lineWidth: [
                'case',
                ['get', 'isFullyDownloaded'], 3,
                2,
              ],
            }}
          />
        </Mapbox.ShapeSource>

        {/* Pack labels */}
        <Mapbox.ShapeSource id="pack-labels" shape={packLabelsGeoJSON}>
          <Mapbox.SymbolLayer
            id="pack-label-text"
            style={{
              textField: ['get', 'name'],
              textSize: 12,
              textColor: '#333',
              textHaloColor: '#fff',
              textHaloWidth: 1.5,
              textFont: ['Open Sans Bold'],
            }}
          />
        </Mapbox.ShapeSource>
      </Mapbox.MapView>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chart Packs</Text>
        <TouchableOpacity style={styles.viewerButton} onPress={onNavigateToViewer}>
          <Text style={styles.viewerButtonText}>View Charts →</Text>
        </TouchableOpacity>
      </View>

      {/* Status bar */}
      <View style={styles.statusBar}>
        <Text style={styles.statusText}>
          {allCharts.length} charts available • {downloadedChartIds.length} downloaded • {chartService.formatBytes(totalCacheSize)}
        </Text>
      </View>

      {/* Download progress */}
      {downloadProgress && (
        <View style={styles.progressOverlay}>
          <View style={styles.progressCard}>
            <Text style={styles.progressTitle}>
              {downloadProgress.status === 'completed' ? '✓ Download Complete' : 
               downloadProgress.status === 'failed' ? '✗ Download Failed' :
               `Downloading ${selectedPack?.name || ''}...`}
            </Text>
            <Text style={styles.progressText}>
              {downloadProgress.downloadedCharts} / {downloadProgress.totalCharts} charts
              {downloadProgress.currentChartId && ` (${downloadProgress.currentChartId})`}
            </Text>
            <View style={styles.progressBarTrack}>
              <View 
                style={[
                  styles.progressBarFill,
                  { 
                    width: `${(downloadProgress.downloadedCharts / downloadProgress.totalCharts) * 100}%`,
                    backgroundColor: downloadProgress.status === 'completed' ? '#28a745' : 
                                    downloadProgress.status === 'failed' ? '#dc3545' : '#007AFF',
                  }
                ]} 
              />
            </View>
          </View>
        </View>
      )}

      {/* Pack detail modal */}
      <Modal
        visible={selectedPack !== null && !downloadProgress}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedPack(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedPack && (
              <>
                <View style={styles.modalHeader}>
                  <View style={[styles.packColorDot, { backgroundColor: selectedPack.color }]} />
                  <Text style={styles.modalTitle}>{selectedPack.name}</Text>
                  <TouchableOpacity onPress={() => setSelectedPack(null)}>
                    <Text style={styles.closeButton}>✕</Text>
                  </TouchableOpacity>
                </View>
                
                <Text style={styles.modalDescription}>{selectedPack.description}</Text>
                
                <View style={styles.statsRow}>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{selectedPack.chartCount}</Text>
                    <Text style={styles.statLabel}>Charts</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>
                      {chartService.formatBytes(selectedPack.totalSizeBytes)}
                    </Text>
                    <Text style={styles.statLabel}>Size</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{selectedPack.downloadedCount}</Text>
                    <Text style={styles.statLabel}>Downloaded</Text>
                  </View>
                </View>
                
                {/* Progress bar */}
                <View style={styles.packProgressTrack}>
                  <View 
                    style={[
                      styles.packProgressFill,
                      { 
                        width: selectedPack.chartCount > 0 
                          ? `${(selectedPack.downloadedCount / selectedPack.chartCount) * 100}%` 
                          : '0%',
                        backgroundColor: selectedPack.color,
                      }
                    ]} 
                  />
                </View>
                <Text style={styles.progressLabel}>
                  {selectedPack.downloadedCount === selectedPack.chartCount && selectedPack.chartCount > 0
                    ? 'Fully downloaded'
                    : selectedPack.downloadedCount > 0
                    ? `${Math.round((selectedPack.downloadedCount / selectedPack.chartCount) * 100)}% downloaded`
                    : 'Not downloaded'}
                </Text>
                
                <View style={styles.modalButtons}>
                  {selectedPack.downloadedCount < selectedPack.chartCount && (
                    <TouchableOpacity
                      style={[styles.modalButton, styles.downloadButton]}
                      onPress={downloadPack}
                    >
                      <Text style={styles.downloadButtonText}>
                        {selectedPack.downloadedCount > 0 ? 'Download Remaining' : 'Download Pack'}
                      </Text>
                    </TouchableOpacity>
                  )}
                  
                  {selectedPack.downloadedCount > 0 && (
                    <TouchableOpacity
                      style={[styles.modalButton, styles.deleteButton]}
                      onPress={deletePack}
                    >
                      <Text style={styles.deleteButtonText}>Delete Downloaded</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {selectedPack.chartCount === 0 && (
                  <Text style={styles.noChartsText}>
                    No charts available for this area yet. Charts are still being processed.
                  </Text>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Instructions */}
      {!selectedPack && (
        <View style={styles.instructions}>
          <Text style={styles.instructionsText}>
            Tap a highlighted region to download charts
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  map: {
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
    color: '#666',
  },
  header: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  viewerButton: {
    padding: 4,
  },
  viewerButtonText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '600',
  },
  statusBar: {
    position: 'absolute',
    top: 110,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    padding: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 12,
    color: '#666',
  },
  instructions: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  instructionsText: {
    color: '#fff',
    fontSize: 14,
  },
  progressOverlay: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
  },
  progressCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  progressText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  progressBarTrack: {
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  packColorDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginRight: 12,
  },
  modalTitle: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    color: '#333',
  },
  closeButton: {
    fontSize: 24,
    color: '#999',
    padding: 4,
  },
  modalDescription: {
    fontSize: 15,
    color: '#666',
    lineHeight: 22,
    marginBottom: 20,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },
  statLabel: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  packProgressTrack: {
    height: 6,
    backgroundColor: '#e0e0e0',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 8,
  },
  packProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressLabel: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginBottom: 20,
  },
  modalButtons: {
    gap: 12,
  },
  modalButton: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  downloadButton: {
    backgroundColor: '#007AFF',
  },
  downloadButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: '#f8f8f8',
    borderWidth: 1,
    borderColor: '#dc3545',
  },
  deleteButtonText: {
    color: '#dc3545',
    fontSize: 16,
    fontWeight: '600',
  },
  noChartsText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 12,
  },
});

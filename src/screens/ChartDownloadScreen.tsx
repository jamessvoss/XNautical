/**
 * Chart Download Screen - Browse and download nautical charts by region
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { 
  ChartRegion, 
  ChartMetadata, 
  RegionId,
  DownloadProgress,
  FeatureType 
} from '../types/chart';
import * as chartService from '../services/chartService';
import * as chartCacheService from '../services/chartCacheService';
import * as chartLoader from '../services/chartLoader';

// Charts that have MBTiles versions available
const MBTILES_AVAILABLE = ['US5AK5QG', 'US5AK5SI', 'US5AK5SJ', 'US4AK4PH'];

interface Props {
  onNavigateToViewer: () => void;
}

type ViewMode = 'regions' | 'charts';

export default function ChartDownloadScreen({ onNavigateToViewer }: Props) {
  // State
  const [viewMode, setViewMode] = useState<ViewMode>('regions');
  const [regions, setRegions] = useState<ChartRegion[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<RegionId | null>(null);
  const [charts, setCharts] = useState<ChartMetadata[]>([]);
  const [downloadedChartIds, setDownloadedChartIds] = useState<string[]>([]);
  const [downloadedMBTilesIds, setDownloadedMBTilesIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [totalCacheSize, setTotalCacheSize] = useState(0);

  // Load initial data
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Initialize cache
      await chartCacheService.initializeCache();
      
      // Load regions
      const regionsData = await chartService.getRegions();
      setRegions(regionsData);
      
      // Load downloaded chart IDs (GeoJSON)
      const downloaded = await chartCacheService.getDownloadedChartIds();
      setDownloadedChartIds(downloaded);
      
      // Load downloaded MBTiles IDs
      const downloadedMBTiles = await chartCacheService.getDownloadedMBTilesIds();
      setDownloadedMBTilesIds(downloadedMBTiles);
      
      // Get cache size (both GeoJSON and MBTiles)
      const geojsonSize = await chartCacheService.getCacheSize();
      const mbtilesSize = await chartCacheService.getMBTilesCacheSize();
      setTotalCacheSize(geojsonSize + mbtilesSize);
    } catch (error) {
      console.error('Error loading data:', error);
      Alert.alert('Error', 'Failed to load chart data. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, []);

  const loadChartsForRegion = useCallback(async (regionId: RegionId) => {
    try {
      setLoading(true);
      const chartsData = await chartService.getChartsByRegion(regionId);
      setCharts(chartsData);
      setSelectedRegion(regionId);
      setViewMode('charts');
    } catch (error) {
      console.error('Error loading charts:', error);
      Alert.alert('Error', 'Failed to load charts for this region.');
    } finally {
      setLoading(false);
    }
  }, []);

  const downloadChart = async (chart: ChartMetadata) => {
    if (downloadProgress) {
      Alert.alert('Download in Progress', 'Please wait for the current download to complete.');
      return;
    }

    // Check if MBTiles version is available
    const hasMBTiles = MBTILES_AVAILABLE.includes(chart.chartId);

    try {
      setDownloadProgress({
        chartId: chart.chartId,
        totalFeatures: hasMBTiles ? 1 : 17,
        downloadedFeatures: 0,
        bytesDownloaded: 0,
        totalBytes: chart.fileSizeBytes,
        status: 'downloading',
        currentFeature: hasMBTiles ? 'mbtiles' : undefined,
      });

      if (hasMBTiles) {
        // Download MBTiles version
        console.log(`Downloading MBTiles for ${chart.chartId}...`);
        await chartService.downloadChartMBTiles(chart.chartId);
        
        // Update state
        setDownloadedMBTilesIds(prev => [...prev, chart.chartId]);
        const mbtilesSize = await chartCacheService.getMBTilesCacheSize();
        const geojsonSize = await chartCacheService.getCacheSize();
        setTotalCacheSize(geojsonSize + mbtilesSize);

        setDownloadProgress({
          chartId: chart.chartId,
          totalFeatures: 1,
          downloadedFeatures: 1,
          bytesDownloaded: chart.fileSizeBytes,
          totalBytes: chart.fileSizeBytes,
          status: 'completed',
        });
      } else {
        // Download GeoJSON version
        const features = await chartService.downloadChart(
          chart.chartId,
          chart.region,
          (featureType: FeatureType, downloaded: number, total: number) => {
            setDownloadProgress(prev => prev ? {
              ...prev,
              currentFeature: featureType,
              downloadedFeatures: downloaded,
            } : null);
          }
        );

        // Save to cache
        await chartCacheService.saveChart(chart.chartId, features);

        // Update state
        setDownloadedChartIds(prev => [...prev, chart.chartId]);
        const cacheSize = await chartCacheService.getCacheSize();
        const mbtilesSize = await chartCacheService.getMBTilesCacheSize();
        setTotalCacheSize(cacheSize + mbtilesSize);

        setDownloadProgress({
          chartId: chart.chartId,
          totalFeatures: 17,
          downloadedFeatures: 17,
          bytesDownloaded: chart.fileSizeBytes,
          totalBytes: chart.fileSizeBytes,
          status: 'completed',
        });
      }

      setTimeout(() => setDownloadProgress(null), 2000);
    } catch (error) {
      console.error('Error downloading chart:', error);
      setDownloadProgress(prev => prev ? {
        ...prev,
        status: 'failed',
        error: 'Download failed',
      } : null);
      Alert.alert('Error', `Failed to download ${chart.chartId}`);
      setTimeout(() => setDownloadProgress(null), 3000);
    }
  };

  const deleteChart = async (chartId: string) => {
    Alert.alert(
      'Delete Chart',
      `Are you sure you want to delete ${chartId}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Delete GeoJSON if exists
              if (downloadedChartIds.includes(chartId)) {
                await chartCacheService.deleteChart(chartId);
                chartLoader.unloadChart(chartId);
                setDownloadedChartIds(prev => prev.filter(id => id !== chartId));
              }
              
              // Delete MBTiles if exists
              if (downloadedMBTilesIds.includes(chartId)) {
                await chartCacheService.deleteMBTiles(chartId);
                setDownloadedMBTilesIds(prev => prev.filter(id => id !== chartId));
              }
              
              // Update cache size
              const geojsonSize = await chartCacheService.getCacheSize();
              const mbtilesSize = await chartCacheService.getMBTilesCacheSize();
              setTotalCacheSize(geojsonSize + mbtilesSize);
            } catch (error) {
              console.error('Error deleting chart:', error);
              Alert.alert('Error', 'Failed to delete chart');
            }
          },
        },
      ]
    );
  };

  const downloadAllInRegion = async () => {
    if (!selectedRegion) return;

    const chartsToDownload = charts.filter(
      c => !downloadedChartIds.includes(c.chartId)
    );

    if (chartsToDownload.length === 0) {
      Alert.alert('All Downloaded', 'All charts in this region are already downloaded.');
      return;
    }

    Alert.alert(
      'Download All',
      `Download ${chartsToDownload.length} charts (${chartService.formatBytes(
        chartService.calculateTotalSize(chartsToDownload)
      )})?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Download',
          onPress: async () => {
            for (const chart of chartsToDownload) {
              await downloadChart(chart);
            }
          },
        },
      ]
    );
  };

  const renderRegionItem = useCallback(({ item }: { item: ChartRegion }) => {
    return (
      <TouchableOpacity
        style={styles.listItem}
        onPress={() => loadChartsForRegion(item.id)}
      >
        <View style={styles.listItemContent}>
          <Text style={styles.listItemTitle}>{item.name}</Text>
          <Text style={styles.listItemSubtitle}>{item.description}</Text>
          <Text style={styles.listItemInfo}>
            {item.chartCount} charts ({chartService.formatBytes(item.totalSizeBytes)})
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    );
  }, [loadChartsForRegion]);

  const renderChartItem = useCallback(({ item }: { item: ChartMetadata }) => {
    const isDownloadedGeoJSON = downloadedChartIds.includes(item.chartId);
    const isDownloadedMBTiles = downloadedMBTilesIds.includes(item.chartId);
    const isDownloaded = isDownloadedGeoJSON || isDownloadedMBTiles;
    const isDownloading = downloadProgress?.chartId === item.chartId;
    const hasMBTiles = MBTILES_AVAILABLE.includes(item.chartId);

    return (
      <View style={styles.listItem}>
        <View style={styles.listItemContent}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={styles.listItemTitle}>{item.chartId}</Text>
            {hasMBTiles && (
              <View style={styles.mbtilesTag}>
                <Text style={styles.mbtilesTagText}>Vector</Text>
              </View>
            )}
          </View>
          <Text style={styles.listItemSubtitle}>
            {item.scaleType} • Scale {item.scale}
          </Text>
          <Text style={styles.listItemInfo}>
            {chartService.formatBytes(item.fileSizeBytes)}
            {isDownloadedMBTiles && ' • MBTiles'}
            {isDownloadedGeoJSON && !isDownloadedMBTiles && ' • GeoJSON'}
          </Text>
        </View>
        
        {isDownloading ? (
          <View style={styles.downloadingContainer}>
            <ActivityIndicator size="small" color="#007AFF" />
            <Text style={styles.downloadingText}>
              {downloadProgress?.currentFeature === 'mbtiles' 
                ? 'MBTiles...' 
                : `${downloadProgress?.downloadedFeatures || 0}/${downloadProgress?.totalFeatures || 17}`}
            </Text>
          </View>
        ) : isDownloaded ? (
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => deleteChart(item.chartId)}
          >
            <Text style={styles.deleteButtonText}>Delete</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.downloadButton, hasMBTiles && styles.downloadButtonMBTiles]}
            onPress={() => downloadChart(item)}
          >
            <Text style={styles.downloadButtonText}>
              {hasMBTiles ? 'Download' : 'Download'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }, [downloadedChartIds, downloadedMBTilesIds, downloadProgress, downloadChart, deleteChart]);

  if (loading && regions.length === 0) {
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
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        {viewMode === 'charts' && (
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              setViewMode('regions');
              setSelectedRegion(null);
            }}
          >
            <Text style={styles.backButtonText}>‹ Regions</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>
          {viewMode === 'regions' ? 'Chart Regions' : selectedRegion}
        </Text>
        <TouchableOpacity
          style={styles.viewChartsButton}
          onPress={onNavigateToViewer}
        >
          <Text style={styles.viewChartsButtonText}>View Map</Text>
        </TouchableOpacity>
      </View>

      {/* Cache Status */}
      <View style={styles.statusBar}>
        <Text style={styles.statusText}>
          {downloadedChartIds.length + downloadedMBTilesIds.length} charts downloaded • {chartService.formatBytes(totalCacheSize)}
        </Text>
        {viewMode === 'charts' && (
          <TouchableOpacity onPress={downloadAllInRegion}>
            <Text style={styles.downloadAllText}>Download All</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Download Progress */}
      {downloadProgress && (
        <View style={styles.progressBar}>
          <Text style={styles.progressText}>
            Downloading {downloadProgress.chartId}...
            {downloadProgress.currentFeature && ` (${downloadProgress.currentFeature})`}
          </Text>
          <View style={styles.progressBarTrack}>
            <View 
              style={[
                styles.progressBarFill,
                { 
                  width: `${(downloadProgress.downloadedFeatures / downloadProgress.totalFeatures) * 100}%` 
                }
              ]} 
            />
          </View>
        </View>
      )}

      {/* List */}
      {viewMode === 'regions' ? (
        <FlatList
          data={regions}
          renderItem={renderRegionItem}
          keyExtractor={item => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          contentContainerStyle={styles.listContent}
          // Performance optimizations
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={50}
          initialNumToRender={10}
          windowSize={5}
        />
      ) : (
        <FlatList
          data={charts}
          renderItem={renderChartItem}
          keyExtractor={item => item.chartId}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No charts available</Text>
            </View>
          }
          // Performance optimizations
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={50}
          initialNumToRender={10}
          windowSize={5}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    padding: 8,
  },
  backButtonText: {
    fontSize: 16,
    color: '#007AFF',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  viewChartsButton: {
    padding: 8,
  },
  viewChartsButtonText: {
    fontSize: 16,
    color: '#007AFF',
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#e8f4fd',
    borderBottomWidth: 1,
    borderBottomColor: '#d0e8f7',
  },
  statusText: {
    fontSize: 14,
    color: '#333',
  },
  downloadAllText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '600',
  },
  progressBar: {
    padding: 12,
    backgroundColor: '#fff3cd',
  },
  progressText: {
    fontSize: 14,
    color: '#856404',
    marginBottom: 8,
  },
  progressBarTrack: {
    height: 8,
    backgroundColor: '#ffeeba',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#28a745',
    borderRadius: 4,
  },
  listContent: {
    padding: 16,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  listItemContent: {
    flex: 1,
  },
  listItemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  listItemSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  listItemInfo: {
    fontSize: 12,
    color: '#999',
  },
  chevron: {
    fontSize: 24,
    color: '#ccc',
    marginLeft: 8,
  },
  downloadButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  downloadButtonMBTiles: {
    backgroundColor: '#28a745',
  },
  downloadButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  mbtilesTag: {
    backgroundColor: '#28a745',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  mbtilesTagText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: '#dc3545',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  downloadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  downloadingText: {
    marginLeft: 8,
    fontSize: 12,
    color: '#007AFF',
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
  },
});

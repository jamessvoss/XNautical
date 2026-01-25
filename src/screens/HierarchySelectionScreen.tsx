/**
 * Hierarchy Selection Screen - Drill-down chart selection based on NOAA hierarchy
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import { ChartMetadata } from '../types/chart';
import {
  ChartNode,
  buildChartHierarchy,
  getAllChartIds,
  getLevelName,
  getScaleDescription,
} from '../utils/chartHierarchy';
import * as chartService from '../services/chartService';
import * as chartCacheService from '../services/chartCacheService';
import { waitForAuth } from '../config/firebase';

Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || '');

interface Props {
  onNavigateToViewer: () => void;
}

// Colors for different levels
const LEVEL_COLORS: Record<number, string> = {
  1: '#1a365d', // Dark blue - Overview
  2: '#2c5282', // Blue - General
  3: '#2b6cb0', // Medium blue - Coastal
  4: '#3182ce', // Light blue - Approach
  5: '#4299e1', // Lighter blue - Harbor
};

export default function HierarchySelectionScreen({ onNavigateToViewer }: Props) {
  const mapRef = useRef<Mapbox.MapView>(null);
  const cameraRef = useRef<Mapbox.Camera>(null);

  // State
  const [loading, setLoading] = useState(true);
  const [hierarchy, setHierarchy] = useState<ChartNode[]>([]);
  const [currentPath, setCurrentPath] = useState<ChartNode[]>([]); // Breadcrumb path
  const [currentNodes, setCurrentNodes] = useState<ChartNode[]>([]); // Current level nodes
  const [downloadedChartIds, setDownloadedChartIds] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const [totalCacheSize, setTotalCacheSize] = useState(0);

  // Load data on mount
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      await waitForAuth();
      await chartCacheService.initializeCache();

      // Try Firebase first, then cache
      let charts: ChartMetadata[] = [];
      try {
        charts = await chartService.getAllCharts();
        await chartCacheService.cacheChartMetadata(charts);
      } catch {
        const cached = await chartCacheService.getCachedChartMetadata();
        if (cached) charts = cached;
      }

      // Build hierarchy
      const tree = buildChartHierarchy(charts);
      setHierarchy(tree);
      setCurrentNodes(tree);

      // Load download status
      const downloaded = await chartCacheService.getDownloadedChartIds();
      setDownloadedChartIds(downloaded);

      const cacheSize = await chartCacheService.getCacheSize();
      setTotalCacheSize(cacheSize);
    } catch (error) {
      console.error('Error loading data:', error);
      Alert.alert('Error', 'Failed to load chart data');
    } finally {
      setLoading(false);
    }
  };

  // Navigate into a node (drill down)
  const drillDown = (node: ChartNode) => {
    if (node.children.length > 0) {
      setCurrentPath([...currentPath, node]);
      setCurrentNodes(node.children);
      
      // Fly to this chart's bounds
      if (node.chart.bounds) {
        const [west, south, east, north] = node.chart.bounds;
        cameraRef.current?.fitBounds(
          [west, south],
          [east, north],
          50,
          1000
        );
      }
    }
  };

  // Navigate back up
  const goBack = () => {
    if (currentPath.length === 0) return;
    
    const newPath = [...currentPath];
    newPath.pop();
    setCurrentPath(newPath);
    
    if (newPath.length === 0) {
      setCurrentNodes(hierarchy);
      // Reset camera to Alaska
      cameraRef.current?.flyTo([-152, 61], 1000);
      cameraRef.current?.zoomTo(4, 1000);
    } else {
      const parent = newPath[newPath.length - 1];
      setCurrentNodes(parent.children);
      
      if (parent.chart.bounds) {
        const [west, south, east, north] = parent.chart.bounds;
        cameraRef.current?.fitBounds([west, south], [east, north], 50, 1000);
      }
    }
  };

  // Download a node and all its children
  const downloadNode = async (node: ChartNode) => {
    const allIds = getAllChartIds(node);
    const toDownload = allIds.filter(id => !downloadedChartIds.includes(id));

    if (toDownload.length === 0) {
      Alert.alert('Already Downloaded', 'All charts in this area are already downloaded.');
      return;
    }

    Alert.alert(
      'Download Charts',
      `Download ${toDownload.length} chart${toDownload.length > 1 ? 's' : ''} (${chartService.formatBytes(node.totalSizeBytes)})?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Download',
          onPress: () => startDownload(node, toDownload),
        },
      ]
    );
  };

  const startDownload = async (node: ChartNode, chartIds: string[]) => {
    setDownloading(node.chart.chartId);
    setDownloadProgress({ current: 0, total: chartIds.length });

    try {
      // Get all chart metadata we need
      const allCharts = getAllChartsFromNode(node);
      
      for (let i = 0; i < chartIds.length; i++) {
        const chartId = chartIds[i];
        const chart = allCharts.find(c => c.chartId === chartId);
        
        if (!chart) continue;

        setDownloadProgress({ current: i + 1, total: chartIds.length });

        try {
          const features = await chartService.downloadChart(chartId, chart.region);
          await chartCacheService.saveChart(chartId, features);
          setDownloadedChartIds(prev => [...prev, chartId]);
        } catch (error) {
          console.error(`Failed to download ${chartId}:`, error);
        }
      }

      const cacheSize = await chartCacheService.getCacheSize();
      setTotalCacheSize(cacheSize);

      Alert.alert('Success', `Downloaded ${chartIds.length} charts`);
    } catch (error) {
      console.error('Download error:', error);
      Alert.alert('Error', 'Some downloads failed');
    } finally {
      setDownloading(null);
    }
  };

  // Get all chart metadata from a node tree
  const getAllChartsFromNode = (node: ChartNode): ChartMetadata[] => {
    const charts: ChartMetadata[] = [node.chart];
    for (const child of node.children) {
      charts.push(...getAllChartsFromNode(child));
    }
    return charts;
  };

  // Calculate download status for a node
  const getNodeDownloadStatus = (node: ChartNode): { downloaded: number; total: number } => {
    const allIds = getAllChartIds(node);
    const downloaded = allIds.filter(id => downloadedChartIds.includes(id)).length;
    return { downloaded, total: allIds.length };
  };

  // Generate GeoJSON for current nodes
  const nodesGeoJSON: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: currentNodes
      .filter(node => node.chart.bounds)
      .map(node => {
        const status = getNodeDownloadStatus(node);
        const isFullyDownloaded = status.downloaded === status.total;
        
        return {
          type: 'Feature',
          properties: {
            id: node.chart.chartId,
            level: node.level,
            color: LEVEL_COLORS[node.level] || '#4299e1',
            isFullyDownloaded,
            hasChildren: node.children.length > 0,
          },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [node.chart.bounds![0], node.chart.bounds![1]],
              [node.chart.bounds![2], node.chart.bounds![1]],
              [node.chart.bounds![2], node.chart.bounds![3]],
              [node.chart.bounds![0], node.chart.bounds![3]],
              [node.chart.bounds![0], node.chart.bounds![1]],
            ]],
          },
        };
      }),
  };

  const renderNodeItem = ({ item }: { item: ChartNode }) => {
    const status = getNodeDownloadStatus(item);
    const isFullyDownloaded = status.downloaded === status.total;
    const isDownloading = downloading === item.chart.chartId;
    const levelColor = LEVEL_COLORS[item.level] || '#4299e1';

    return (
      <View style={styles.nodeItem}>
        <TouchableOpacity
          style={styles.nodeContent}
          onPress={() => item.children.length > 0 ? drillDown(item) : null}
          disabled={item.children.length === 0}
        >
          <View style={[styles.levelBadge, { backgroundColor: levelColor }]}>
            <Text style={styles.levelText}>{getLevelName(item.level)}</Text>
          </View>
          
          <View style={styles.nodeInfo}>
            <Text style={styles.nodeTitle}>{item.chart.chartId}</Text>
            <Text style={styles.nodeSubtitle}>
              {item.totalDescendants > 0
                ? `${item.totalDescendants + 1} charts • ${chartService.formatBytes(item.totalSizeBytes)}`
                : chartService.formatBytes(item.chart.fileSizeBytes || 0)}
            </Text>
            <Text style={styles.downloadStatus}>
              {status.downloaded}/{status.total} downloaded
            </Text>
          </View>

          {item.children.length > 0 && (
            <Text style={styles.drillIcon}>›</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.downloadBtn,
            isFullyDownloaded && styles.downloadedBtn,
            isDownloading && styles.downloadingBtn,
          ]}
          onPress={() => downloadNode(item)}
          disabled={isDownloading || isFullyDownloaded}
        >
          {isDownloading ? (
            <Text style={styles.downloadBtnText}>
              {downloadProgress.current}/{downloadProgress.total}
            </Text>
          ) : isFullyDownloaded ? (
            <Text style={[styles.downloadBtnText, styles.downloadedText]}>✓</Text>
          ) : (
            <Text style={styles.downloadBtnText}>↓</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Building chart hierarchy...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Map */}
      <View style={styles.mapContainer}>
        <Mapbox.MapView ref={mapRef} style={styles.map} styleURL={Mapbox.StyleURL.Light}>
          <Mapbox.Camera
            ref={cameraRef}
            zoomLevel={4}
            centerCoordinate={[-152, 61]}
          />

          <Mapbox.ShapeSource id="nodes" shape={nodesGeoJSON}>
            <Mapbox.FillLayer
              id="nodes-fill"
              style={{
                fillColor: ['get', 'color'],
                fillOpacity: ['case', ['get', 'isFullyDownloaded'], 0.4, 0.2],
              }}
            />
            <Mapbox.LineLayer
              id="nodes-line"
              style={{
                lineColor: ['get', 'color'],
                lineWidth: ['case', ['get', 'isFullyDownloaded'], 3, 2],
              }}
            />
          </Mapbox.ShapeSource>
        </Mapbox.MapView>
      </View>

      {/* Breadcrumb */}
      <View style={styles.breadcrumb}>
        <TouchableOpacity
          onPress={() => {
            setCurrentPath([]);
            setCurrentNodes(hierarchy);
            cameraRef.current?.flyTo([-152, 61], 1000);
            cameraRef.current?.zoomTo(4, 1000);
          }}
        >
          <Text style={styles.breadcrumbText}>Alaska</Text>
        </TouchableOpacity>
        
        {currentPath.map((node, index) => (
          <View key={node.chart.chartId} style={styles.breadcrumbItem}>
            <Text style={styles.breadcrumbSep}> › </Text>
            <TouchableOpacity
              onPress={() => {
                const newPath = currentPath.slice(0, index + 1);
                setCurrentPath(newPath);
                setCurrentNodes(newPath[newPath.length - 1].children);
              }}
            >
              <Text style={styles.breadcrumbText}>{node.chart.chartId}</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      {/* Header */}
      <View style={styles.header}>
        {currentPath.length > 0 && (
          <TouchableOpacity style={styles.backBtn} onPress={goBack}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
        )}
        
        <Text style={styles.headerTitle}>
          {currentPath.length > 0
            ? `${currentPath[currentPath.length - 1].chart.chartId} Charts`
            : 'All Alaska Charts'}
        </Text>

        <TouchableOpacity style={styles.viewerBtn} onPress={onNavigateToViewer}>
          <Text style={styles.viewerBtnText}>View Map</Text>
        </TouchableOpacity>
      </View>

      {/* Status */}
      <View style={styles.statusBar}>
        <Text style={styles.statusText}>
          {downloadedChartIds.length} downloaded • {chartService.formatBytes(totalCacheSize)}
        </Text>
      </View>

      {/* List */}
      <FlatList
        data={currentNodes}
        renderItem={renderNodeItem}
        keyExtractor={item => item.chart.chartId}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No charts at this level</Text>
        }
      />
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
  mapContainer: {
    height: 200,
  },
  map: {
    flex: 1,
  },
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    flexWrap: 'wrap',
  },
  breadcrumbItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  breadcrumbText: {
    color: '#007AFF',
    fontSize: 14,
  },
  breadcrumbSep: {
    color: '#999',
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backBtn: {
    padding: 4,
  },
  backBtnText: {
    color: '#007AFF',
    fontSize: 14,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  viewerBtn: {
    padding: 4,
  },
  viewerBtnText: {
    color: '#007AFF',
    fontSize: 14,
  },
  statusBar: {
    backgroundColor: '#e8f4fd',
    padding: 8,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 12,
    color: '#666',
  },
  listContent: {
    padding: 12,
  },
  nodeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  nodeContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  levelBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 12,
  },
  levelText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  nodeInfo: {
    flex: 1,
  },
  nodeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  nodeSubtitle: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  downloadStatus: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  drillIcon: {
    fontSize: 24,
    color: '#ccc',
    marginLeft: 8,
  },
  downloadBtn: {
    width: 50,
    height: '100%',
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    minHeight: 70,
  },
  downloadedBtn: {
    backgroundColor: '#28a745',
  },
  downloadingBtn: {
    backgroundColor: '#ffc107',
  },
  downloadBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  downloadedText: {
    fontSize: 20,
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    padding: 32,
  },
});

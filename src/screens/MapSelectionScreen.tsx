/**
 * Map Selection Screen - Fully map-driven chart selection with checkboxes
 * Enhanced with nautical styling and scale differentiation
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import { ChartMetadata } from '../types/chart';
import {
  ChartNode,
  buildChartHierarchy,
  getAllChartIds,
  getLevelName,
  getChartLevel,
} from '../utils/chartHierarchy';
import * as chartService from '../services/chartService';
import * as chartCacheService from '../services/chartCacheService';
import { waitForAuth } from '../config/firebase';

Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || '');

// Scale level styling - distinct colors for each resolution level
const SCALE_STYLES: Record<number, { color: string; textColor: string; name: string; abbrev: string }> = {
  1: { color: '#7c3aed', textColor: '#5b21b6', name: 'Overview', abbrev: 'OV' },   // Purple - largest area, least detail
  2: { color: '#2563eb', textColor: '#1d4ed8', name: 'General', abbrev: 'GN' },    // Blue
  3: { color: '#0891b2', textColor: '#0e7490', name: 'Coastal', abbrev: 'CO' },    // Cyan/Teal
  4: { color: '#d97706', textColor: '#b45309', name: 'Approach', abbrev: 'AP' },   // Amber/Orange
  5: { color: '#dc2626', textColor: '#b91c1c', name: 'Harbor', abbrev: 'HB' },     // Red - smallest area, most detail
};

// Status colors
const STATUS_COLORS = {
  selected: '#3b82f6',      // Blue for selection highlight
  partial: '#f59e0b',       // Amber for partial selection
  downloaded: '#22c55e',    // Green for downloaded
  notDownloaded: '#94a3b8', // Gray
};

// Downloaded text color
const DOWNLOADED_TEXT_COLOR = '#16a34a';

export default function MapSelectionScreen() {
  const mapRef = useRef<Mapbox.MapView>(null);
  const cameraRef = useRef<Mapbox.Camera>(null);

  // State
  const [loading, setLoading] = useState(true);
  const [hierarchy, setHierarchy] = useState<ChartNode[]>([]);
  const [allCharts, setAllCharts] = useState<ChartMetadata[]>([]);
  const [currentPath, setCurrentPath] = useState<ChartNode[]>([]);
  const [currentNodes, setCurrentNodes] = useState<ChartNode[]>([]);
  const [selectedChartIds, setSelectedChartIds] = useState<Set<string>>(new Set());
  const [downloadedChartIds, setDownloadedChartIds] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const [showLegend, setShowLegend] = useState(false);

  // Load data
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      await waitForAuth();
      await chartCacheService.initializeCache();

      let charts: ChartMetadata[] = [];
      try {
        charts = await chartService.getAllCharts();
        await chartCacheService.cacheChartMetadata(charts);
      } catch {
        const cached = await chartCacheService.getCachedChartMetadata();
        if (cached) charts = cached;
      }

      setAllCharts(charts);
      const tree = buildChartHierarchy(charts);
      setHierarchy(tree);
      setCurrentNodes(tree);

      const downloaded = await chartCacheService.getDownloadedChartIds();
      setDownloadedChartIds(new Set(downloaded));
    } catch (error) {
      console.error('Error loading data:', error);
      Alert.alert('Error', 'Failed to load chart data');
    } finally {
      setLoading(false);
    }
  };

  // Toggle selection for a node (and all its children)
  const toggleSelection = useCallback((node: ChartNode) => {
    const allIds = getAllChartIds(node);
    const newSelected = new Set(selectedChartIds);
    
    const allSelected = allIds.every(id => selectedChartIds.has(id));
    
    if (allSelected) {
      allIds.forEach(id => newSelected.delete(id));
    } else {
      allIds.forEach(id => newSelected.add(id));
    }
    
    setSelectedChartIds(newSelected);
  }, [selectedChartIds]);

  // Drill down into a node
  const drillDown = useCallback((node: ChartNode) => {
    if (node.children.length === 0) return;
    
    setCurrentPath(prev => [...prev, node]);
    setCurrentNodes(node.children);
    
    if (node.chart.bounds) {
      const [west, south, east, north] = node.chart.bounds;
      cameraRef.current?.fitBounds([west, south], [east, north], 50, 1000);
    }
  }, []);

  // Go back up
  const goBack = useCallback(() => {
    if (currentPath.length === 0) return;
    
    const newPath = currentPath.slice(0, -1);
    setCurrentPath(newPath);
    
    if (newPath.length === 0) {
      setCurrentNodes(hierarchy);
      cameraRef.current?.flyTo([-152, 61], 1000);
      setTimeout(() => cameraRef.current?.zoomTo(4, 500), 500);
    } else {
      setCurrentNodes(newPath[newPath.length - 1].children);
      const parent = newPath[newPath.length - 1];
      if (parent.chart.bounds) {
        const [west, south, east, north] = parent.chart.bounds;
        cameraRef.current?.fitBounds([west, south], [east, north], 50, 1000);
      }
    }
  }, [currentPath, hierarchy]);


  // Download all selected charts
  const downloadSelected = async () => {
    const toDownload = Array.from(selectedChartIds).filter(id => !downloadedChartIds.has(id));
    
    if (toDownload.length === 0) {
      Alert.alert('Nothing to Download', 'All selected charts are already downloaded.');
      return;
    }

    setDownloading(true);
    setDownloadProgress({ current: 0, total: toDownload.length });

    try {
      for (let i = 0; i < toDownload.length; i++) {
        const chartId = toDownload[i];
        const chart = allCharts.find(c => c.chartId === chartId);
        if (!chart) continue;

        setDownloadProgress({ current: i + 1, total: toDownload.length });

        try {
          console.log(`Downloading ${chartId} from region ${chart.region}...`);
          const features = await chartService.downloadChart(chartId, chart.region);
          console.log(`Downloaded features for ${chartId}:`, Object.keys(features));
          await chartCacheService.saveChart(chartId, features);
          console.log(`Saved ${chartId} to cache`);
          setDownloadedChartIds(prev => new Set([...prev, chartId]));
        } catch (error) {
          console.error(`Failed to download ${chartId}:`, error);
        }
      }

      Alert.alert('Success', `Downloaded ${toDownload.length} charts`);
      setSelectedChartIds(new Set());
    } catch (error) {
      Alert.alert('Error', 'Some downloads failed');
    } finally {
      setDownloading(false);
    }
  };

  // Calculate selection stats
  const getSelectionStats = () => {
    const selected = Array.from(selectedChartIds);
    const notDownloaded = selected.filter(id => !downloadedChartIds.has(id));
    const totalSize = selected.reduce((sum, id) => {
      const chart = allCharts.find(c => c.chartId === id);
      return sum + (chart?.fileSizeBytes || 0);
    }, 0);
    
    return {
      totalSelected: selected.length,
      toDownload: notDownloaded.length,
      totalSize,
    };
  };

  // Check if a node is selected (all its charts)
  const isNodeSelected = (node: ChartNode): boolean => {
    const allIds = getAllChartIds(node);
    return allIds.every(id => selectedChartIds.has(id));
  };

  // Check if a node is partially selected
  const isNodePartiallySelected = (node: ChartNode): boolean => {
    const allIds = getAllChartIds(node);
    const selectedCount = allIds.filter(id => selectedChartIds.has(id)).length;
    return selectedCount > 0 && selectedCount < allIds.length;
  };

  // Check if a node is fully downloaded
  const isNodeDownloaded = (node: ChartNode): boolean => {
    const allIds = getAllChartIds(node);
    return allIds.every(id => downloadedChartIds.has(id));
  };

  // Check if any part is downloaded
  const isNodePartiallyDownloaded = (node: ChartNode): boolean => {
    const allIds = getAllChartIds(node);
    const downloadedCount = allIds.filter(id => downloadedChartIds.has(id)).length;
    return downloadedCount > 0 && downloadedCount < allIds.length;
  };

  // Generate GeoJSON for regions with enhanced styling
  const regionsGeoJSON: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: currentNodes
      .filter(node => node.chart.bounds)
      .map(node => {
        const scaleStyle = SCALE_STYLES[node.level] || SCALE_STYLES[5];
        const isDownloaded = isNodeDownloaded(node);
        const isPartialDownload = isNodePartiallyDownloaded(node);
        
        return {
          type: 'Feature' as const,
          properties: {
            id: node.chart.chartId,
            name: node.chart.name || node.chart.chartId,
            level: node.level,
            scaleName: scaleStyle.name,
            scaleAbbrev: scaleStyle.abbrev,
            scaleColor: scaleStyle.color,
            isSelected: isNodeSelected(node),
            isPartial: isNodePartiallySelected(node),
            isDownloaded,
            isPartialDownload,
            hasChildren: node.children.length > 0,
            childCount: node.totalDescendants,
          },
          geometry: {
            type: 'Polygon' as const,
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

  // Generate checkbox markers
  const checkboxMarkersGeoJSON: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: currentNodes
      .filter(node => node.chart.bounds)
      .map(node => {
        const [west, , , north] = node.chart.bounds!;
        
        return {
          type: 'Feature' as const,
          properties: {
            id: node.chart.chartId,
            isSelected: isNodeSelected(node),
            isPartial: isNodePartiallySelected(node),
            isDownloaded: isNodeDownloaded(node),
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [west, north],
          },
        };
      }),
  };

  // Generate labels with chart name and scale info
  const labelsGeoJSON: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: currentNodes
      .filter(node => node.chart.bounds)
      .map(node => {
        const [west, south, east, north] = node.chart.bounds!;
        const scaleStyle = SCALE_STYLES[node.level] || SCALE_STYLES[5];
        const isDownloaded = isNodeDownloaded(node);
        
        return {
          type: 'Feature' as const,
          properties: {
            id: node.chart.chartId,
            name: node.chart.name || node.chart.chartId,
            scaleName: scaleStyle.name,
            scaleAbbrev: scaleStyle.abbrev,
            scaleColor: scaleStyle.color,
            textColor: isDownloaded ? DOWNLOADED_TEXT_COLOR : scaleStyle.textColor,
            childCount: node.children.length > 0 ? node.totalDescendants + 1 : 0,
            isDownloaded,
            level: node.level,
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [(west + east) / 2, (south + north) / 2],
          },
        };
      }),
  };

  // Handle map press
  const handleMapPress = (e: any) => {
    const feature = e.features?.[0];
    if (!feature) return;

    const chartId = feature.properties?.id;
    const node = currentNodes.find(n => n.chart.chartId === chartId);
    if (!node) return;

    if (node.children.length > 0) {
      drillDown(node);
    } else {
      toggleSelection(node);
    }
  };

  // Handle checkbox press
  const handleCheckboxPress = (e: any) => {
    const feature = e.features?.[0];
    if (!feature) return;

    const chartId = feature.properties?.id;
    const node = currentNodes.find(n => n.chart.chartId === chartId);
    if (node) {
      toggleSelection(node);
    }
  };

  const stats = getSelectionStats();

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1976d2" />
          <Text style={styles.loadingText}>Loading charts...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Full screen map with nautical style */}
      <Mapbox.MapView
        ref={mapRef}
        style={styles.map}
        styleURL="mapbox://styles/mapbox/outdoors-v12"
        logoEnabled={false}
        attributionEnabled={false}
        scaleBarEnabled={false}
      >
        <Mapbox.Camera
          ref={cameraRef}
          zoomLevel={4}
          centerCoordinate={[-152, 61]}
        />

        {/* Region polygons - styled by scale level */}
        <Mapbox.ShapeSource
          id="regions"
          shape={regionsGeoJSON}
          onPress={handleMapPress}
        >
          {/* Fill with scale-based color */}
          <Mapbox.FillLayer
            id="regions-fill"
            existing={false}
            style={{
              fillColor: [
                'case',
                ['get', 'isSelected'], STATUS_COLORS.selected,
                ['get', 'isPartial'], STATUS_COLORS.partial,
                ['get', 'isDownloaded'], STATUS_COLORS.downloaded,
                ['get', 'scaleColor'],
              ],
              fillOpacity: [
                'case',
                ['get', 'isSelected'], 0.45,
                ['get', 'isPartial'], 0.35,
                ['get', 'isDownloaded'], 0.4,
                0.25,
              ],
            }}
          />
          {/* Border with emphasis for downloaded */}
          <Mapbox.LineLayer
            id="regions-line"
            existing={false}
            style={{
              lineColor: [
                'case',
                ['get', 'isSelected'], '#1d4ed8',
                ['get', 'isPartial'], '#b45309',
                ['get', 'isDownloaded'], '#16a34a',
                ['get', 'scaleColor'],
              ],
              lineWidth: [
                'case',
                ['get', 'isSelected'], 3,
                ['get', 'isDownloaded'], 2.5,
                1.5,
              ],
            }}
          />
        </Mapbox.ShapeSource>

        {/* Center labels - Chart ID and Scale */}
        <Mapbox.ShapeSource id="labels" shape={labelsGeoJSON}>
          {/* Chart Name - top line */}
          <Mapbox.SymbolLayer
            id="label-name"
            existing={false}
            style={{
              textField: ['get', 'name'],
              textSize: 12,
              textColor: ['get', 'textColor'],
              textHaloColor: '#ffffff',
              textHaloWidth: 0.8,
              textFont: ['Open Sans Semibold'],
              textOffset: [0, -1.2],
              textMaxWidth: 12,
            }}
          />
          {/* Chart ID */}
          <Mapbox.SymbolLayer
            id="label-chartid"
            existing={false}
            style={{
              textField: ['get', 'id'],
              textSize: 10,
              textColor: ['get', 'textColor'],
              textHaloColor: '#ffffff',
              textHaloWidth: 0.8,
              textFont: ['Open Sans Regular'],
              textTransform: 'uppercase',
              textOffset: [0, 0],
            }}
          />
          {/* Scale type badge */}
          <Mapbox.SymbolLayer
            id="label-scale"
            existing={false}
            style={{
              textField: ['get', 'scaleName'],
              textSize: 11,
              textColor: ['get', 'textColor'],
              textHaloColor: '#ffffff',
              textHaloWidth: 0.8,
              textFont: ['Open Sans Semibold'],
              textOffset: [0, 1.0],
            }}
          />
          {/* Child count if has children */}
          <Mapbox.SymbolLayer
            id="label-childcount"
            existing={false}
            filter={['>', ['get', 'childCount'], 0]}
            style={{
              textField: ['concat', ['to-string', ['get', 'childCount']], ' charts'],
              textSize: 13,
              textColor: ['get', 'textColor'],
              textHaloColor: '#ffffff',
              textHaloWidth: 0.8,
              textFont: ['Open Sans Semibold'],
              textOffset: [0, 2.2],
            }}
          />
        </Mapbox.ShapeSource>

        {/* Checkbox markers */}
        <Mapbox.ShapeSource
          id="checkboxes"
          shape={checkboxMarkersGeoJSON}
          onPress={handleCheckboxPress}
          hitbox={{ width: 44, height: 44 }}
        >
          <Mapbox.SymbolLayer
            id="checkbox-bg"
            existing={false}
            style={{
              textField: '■',
              textSize: 24,
              textAnchor: 'top-left',
              textOffset: [0.1, 0.1],
              textColor: [
                'case',
                ['get', 'isSelected'], STATUS_COLORS.selected,
                ['get', 'isPartial'], STATUS_COLORS.partial,
                ['get', 'isDownloaded'], STATUS_COLORS.downloaded,
                '#ffffff',
              ],
              textHaloColor: [
                'case',
                ['get', 'isSelected'], '#1d4ed8',
                ['get', 'isPartial'], '#b45309',
                ['get', 'isDownloaded'], '#16a34a',
                '#64748b',
              ],
              textHaloWidth: 1,
              textAllowOverlap: true,
              textIgnorePlacement: true,
            }}
          />
          <Mapbox.SymbolLayer
            id="checkbox-check"
            existing={false}
            filter={['any', ['==', ['get', 'isSelected'], true], ['==', ['get', 'isDownloaded'], true]]}
            style={{
              textField: '✓',
              textSize: 14,
              textAnchor: 'top-left',
              textOffset: [0.4, 0.3],
              textColor: '#ffffff',
              textAllowOverlap: true,
              textIgnorePlacement: true,
            }}
          />
          <Mapbox.SymbolLayer
            id="checkbox-partial"
            existing={false}
            filter={['all', 
              ['==', ['get', 'isPartial'], true], 
              ['!=', ['get', 'isSelected'], true],
              ['!=', ['get', 'isDownloaded'], true]
            ]}
            style={{
              textField: '—',
              textSize: 14,
              textAnchor: 'top-left',
              textOffset: [0.4, 0.3],
              textColor: '#ffffff',
              textAllowOverlap: true,
              textIgnorePlacement: true,
            }}
          />
        </Mapbox.ShapeSource>
      </Mapbox.MapView>

      {/* Top bar */}
      <SafeAreaView style={styles.topBar} edges={['top']}>
        <View style={styles.topBarContent}>
          {currentPath.length > 0 ? (
            <TouchableOpacity style={styles.backBtn} onPress={goBack}>
              <Text style={styles.backBtnText}>← Back</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.legendBtn} onPress={() => setShowLegend(!showLegend)}>
              <Text style={styles.legendBtnText}>Legend</Text>
            </TouchableOpacity>
          )}
          
          <View style={styles.breadcrumb}>
            <Text style={styles.breadcrumbText}>
              {currentPath.length === 0
                ? 'Alaska Nautical Charts'
                : currentPath.map(n => n.chart.chartId).join(' › ')}
            </Text>
          </View>

          <View style={styles.placeholder} />
        </View>
      </SafeAreaView>

      {/* Legend overlay */}
      {showLegend && (
        <View style={styles.legend}>
          <Text style={styles.legendTitle}>Chart Scales</Text>
          {Object.entries(SCALE_STYLES).map(([level, style]) => (
            <View key={level} style={styles.legendItem}>
              <View style={[styles.legendColor, { backgroundColor: style.color }]} />
              <Text style={styles.legendLabel}>{style.name}</Text>
              <Text style={styles.legendDetail}>
                {level === '1' ? 'Largest area' : level === '5' ? 'Most detail' : ''}
              </Text>
            </View>
          ))}
          <View style={styles.legendDivider} />
          <Text style={styles.legendTitle}>Status</Text>
          <View style={styles.legendItem}>
            <View style={[styles.legendColor, { backgroundColor: STATUS_COLORS.downloaded }]} />
            <Text style={styles.legendLabel}>Downloaded</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendColor, { backgroundColor: STATUS_COLORS.selected }]} />
            <Text style={styles.legendLabel}>Selected</Text>
          </View>
          <TouchableOpacity style={styles.legendClose} onPress={() => setShowLegend(false)}>
            <Text style={styles.legendCloseText}>Close</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Stats bar */}
      <View style={styles.statsBar}>
        <Text style={styles.statsText}>
          {allCharts.length} charts available • {downloadedChartIds.size} downloaded
        </Text>
      </View>

      {/* Selection summary & download button */}
      {stats.totalSelected > 0 && (
        <View style={styles.selectionBar}>
          <View style={styles.selectionInfo}>
            <Text style={styles.selectionCount}>
              {stats.totalSelected} selected
            </Text>
            <Text style={styles.selectionSize}>
              {stats.toDownload} new • {chartService.formatBytes(stats.totalSize)}
            </Text>
          </View>
          
          <TouchableOpacity
            style={[styles.downloadBtn, downloading && styles.downloadingBtn]}
            onPress={downloadSelected}
            disabled={downloading || stats.toDownload === 0}
          >
            {downloading ? (
              <Text style={styles.downloadBtnText}>
                {downloadProgress.current}/{downloadProgress.total}
              </Text>
            ) : (
              <Text style={styles.downloadBtnText}>
                {stats.toDownload === 0 ? 'All Downloaded' : 'Download'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c4a6e',
  },
  map: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0c4a6e',
  },
  loadingText: {
    marginTop: 16,
    color: '#fff',
    fontSize: 16,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(12, 74, 110, 0.95)',
  },
  topBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  backBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  backBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  legendBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  legendBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  breadcrumb: {
    flex: 1,
    alignItems: 'center',
  },
  breadcrumbText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  placeholder: {
    width: 70,
  },
  legend: {
    position: 'absolute',
    top: 100,
    left: 16,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
    minWidth: 180,
  },
  legendTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  legendColor: {
    width: 16,
    height: 16,
    borderRadius: 3,
    marginRight: 10,
  },
  legendLabel: {
    fontSize: 14,
    color: '#334155',
    flex: 1,
  },
  legendDetail: {
    fontSize: 11,
    color: '#94a3b8',
  },
  legendDivider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginVertical: 12,
  },
  legendClose: {
    marginTop: 12,
    alignItems: 'center',
  },
  legendCloseText: {
    color: '#1976d2',
    fontSize: 14,
    fontWeight: '600',
  },
  statsBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(12, 74, 110, 0.9)',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  statsText: {
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
  },
  selectionBar: {
    position: 'absolute',
    bottom: 40,
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  selectionInfo: {
    flex: 1,
  },
  selectionCount: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
  },
  selectionSize: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
  downloadBtn: {
    backgroundColor: '#1976d2',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  downloadingBtn: {
    backgroundColor: '#64748b',
  },
  downloadBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});

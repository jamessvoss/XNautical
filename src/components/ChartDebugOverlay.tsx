/**
 * Chart Info Overlay - Shows real-time chart and navigation info
 * 
 * Displays:
 * - Active chart(s) based on current zoom level
 * - Scale information (nautical scale approximation)
 * - Viewport bounds and coverage
 * - Tile server statistics
 * - Performance metrics
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';

// Chart scale definitions matching convert.py and DynamicChartViewer
const CHART_SCALES = [
  { prefix: 'US1', name: 'Overview', minZoom: 0, maxZoom: 8, scale: '1:3,500,000+' },
  { prefix: 'US2', name: 'General', minZoom: 8, maxZoom: 10, scale: '1:350,000' },
  { prefix: 'US3', name: 'Coastal', minZoom: 10, maxZoom: 13, scale: '1:150,000' },
  { prefix: 'US4', name: 'Approach', minZoom: 11, maxZoom: 16, scale: '1:50,000' },
  { prefix: 'US5', name: 'Harbor', minZoom: 13, maxZoom: 18, scale: '1:12,000' },
];

interface ChartInfo {
  chartId: string;
  path?: string;
}

interface TileStats {
  requestCount: number;
  cacheHits: number;
  cacheMisses: number;
  errors: number;
  lastRequestTime: number;
}

interface Props {
  visible?: boolean;
  currentZoom: number;
  centerCoord: [number, number];
  mbtilesCharts: ChartInfo[];
  tileServerReady: boolean;
  // Position from top (should account for safe area + button height)
  topOffset?: number;
  // Position from left
  leftOffset?: number;
  // Optional callbacks for additional data
  onRequestTileStats?: () => Promise<TileStats | null>;
}

// Convert zoom level to approximate nautical scale
function zoomToScale(zoom: number): string {
  // Approximate scales at equator
  // Zoom 0 = 1:500,000,000
  // Each zoom level halves the scale
  const baseScale = 500000000;
  const scale = Math.round(baseScale / Math.pow(2, zoom));
  
  if (scale >= 1000000) {
    return `1:${(scale / 1000000).toFixed(1)}M`;
  } else if (scale >= 1000) {
    return `1:${(scale / 1000).toFixed(0)}K`;
  }
  return `1:${scale}`;
}

// Get chart category from zoom
function getChartCategory(zoom: number): { name: string; color: string } {
  if (zoom < 8) return { name: 'Overview', color: '#9C27B0' };
  if (zoom < 10) return { name: 'General', color: '#2196F3' };
  if (zoom < 13) return { name: 'Coastal', color: '#4CAF50' };
  if (zoom < 16) return { name: 'Approach', color: '#FF9800' };
  return { name: 'Harbor', color: '#F44336' };
}

// Calculate viewport bounds from center and zoom
function getViewportBounds(
  center: [number, number],
  zoom: number
): { nw: [number, number]; se: [number, number]; widthNm: number } {
  // Approximate degrees per pixel at this zoom (at equator)
  const degreesPerPixel = 360 / (256 * Math.pow(2, zoom));
  
  // Assume ~400px viewport width for mobile
  const viewportWidthDeg = degreesPerPixel * 400;
  const viewportHeightDeg = degreesPerPixel * 700;
  
  // Adjust for latitude (longitude degrees shrink towards poles)
  const latAdjust = Math.cos(center[1] * Math.PI / 180);
  const adjustedWidthDeg = viewportWidthDeg / latAdjust;
  
  const nw: [number, number] = [
    center[0] - adjustedWidthDeg / 2,
    center[1] + viewportHeightDeg / 2,
  ];
  const se: [number, number] = [
    center[0] + adjustedWidthDeg / 2,
    center[1] - viewportHeightDeg / 2,
  ];
  
  // Calculate width in nautical miles (1 degree lat = 60 nm)
  const widthNm = viewportWidthDeg * 60 * latAdjust;
  
  return { nw, se, widthNm };
}

// Format coordinates for display
function formatCoord(lon: number, lat: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(3)}°${latDir} ${Math.abs(lon).toFixed(3)}°${lonDir}`;
}

export default function ChartDebugOverlay({
  visible = true,
  currentZoom,
  centerCoord,
  mbtilesCharts,
  tileServerReady,
  topOffset = 60,
  leftOffset = 10,
  onRequestTileStats,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [tileStats, setTileStats] = useState<TileStats | null>(null);
  const [fps, setFps] = useState(0);
  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(Date.now());

  // FPS counter (approximate)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastFpsUpdateRef.current;
      if (elapsed > 0) {
        setFps(Math.round((frameCountRef.current * 1000) / elapsed));
        frameCountRef.current = 0;
        lastFpsUpdateRef.current = now;
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Count frame renders
  useEffect(() => {
    frameCountRef.current++;
  });

  // Fetch tile stats periodically
  useEffect(() => {
    if (!onRequestTileStats) return;
    
    const fetchStats = async () => {
      const stats = await onRequestTileStats();
      if (stats) setTileStats(stats);
    };
    
    fetchStats();
    const interval = setInterval(fetchStats, 2000);
    return () => clearInterval(interval);
  }, [onRequestTileStats]);

  if (!visible) return null;

  // All loaded charts (bounds filtering not available without chart index)
  const coveringCharts = mbtilesCharts;

  // Helper to get chart scale info from chart ID
  // Note: Regional charts like "alaska_US1" are MERGED files containing multiple scales
  // The number in the filename is a region identifier, NOT a scale indicator
  // We can't determine actual scale from filename alone for merged regional charts
  const getChartScaleInfo = (chartId: string) => {
    // Check if this is a direct scale chart (e.g., "US5AK5QG" starts with US followed by scale number)
    const directMatch = chartId.match(/^US(\d)/);
    if (directMatch) {
      const scaleNum = parseInt(directMatch[1], 10);
      return CHART_SCALES.find(s => s.prefix === `US${scaleNum}`) || null;
    }
    // Regional merged charts (e.g., "alaska_US1") - can't determine scale from filename
    // Return null to indicate this is a multi-scale merged chart
    return null;
  };
  
  // Check if chart is a merged regional chart (contains multiple scales)
  const isMergedRegionalChart = (chartId: string) => {
    return chartId.includes('_US') && !chartId.match(/^US\d/);
  };

  // Find the chart that BEST matches the current zoom level
  // For merged regional charts, we can't determine scale from filename
  // Just pick the first loaded chart covering the area
  const primaryChart = (() => {
    if (coveringCharts.length === 0) return null;
    
    // Check if we have any merged regional charts
    const mergedCharts = coveringCharts.filter(c => isMergedRegionalChart(c.chartId));
    const directScaleCharts = coveringCharts.filter(c => !isMergedRegionalChart(c.chartId));
    
    // If we have direct scale charts, use original scoring logic
    if (directScaleCharts.length > 0) {
      const scored = directScaleCharts.map(chart => {
        const scaleInfo = getChartScaleInfo(chart.chartId);
        if (!scaleInfo) return { chart, score: -1000, inRange: false };
        
        const { minZoom, maxZoom } = scaleInfo;
        const inRange = currentZoom >= minZoom && currentZoom <= maxZoom;
        const scaleNum = parseInt(chart.chartId.match(/^US(\d)/)?.[1] || '0', 10);
        
        if (inRange) {
          return { chart, score: 1000 + scaleNum, inRange: true };
        } else if (currentZoom > maxZoom) {
          return { chart, score: 500 + scaleNum - (currentZoom - maxZoom), inRange: false };
        } else {
          return { chart, score: -100 - (minZoom - currentZoom), inRange: false };
        }
      });
      
      scored.sort((a, b) => b.score - a.score);
      if (scored[0]) return scored[0].chart;
    }
    
    // For merged regional charts, just return the first one
    // The actual scale being rendered depends on the tile content, not the filename
    return mergedCharts[0] || coveringCharts[0] || null;
  })();
  
  // Determine what scale level SHOULD be rendering at current zoom
  const expectedScaleAtZoom = CHART_SCALES.find(
    s => currentZoom >= s.minZoom && currentZoom <= s.maxZoom
  );
  
  // Check if primary chart is a merged regional chart
  const primaryIsMerged = primaryChart && isMergedRegionalChart(primaryChart.chartId);

  // Get charts that are actively rendering at this zoom (for "also covering" display)
  const activeCharts = coveringCharts.filter(chart => {
    const scaleInfo = getChartScaleInfo(chart.chartId);
    if (!scaleInfo) return false;
    // Chart is "active" if we're within or above its zoom range (overzoom counts)
    return currentZoom >= scaleInfo.minZoom;
  });
  
  // Check what chart SHOULD be available at this zoom (for "no coverage" warning)
  const expectedScale = CHART_SCALES.find(s => currentZoom >= s.minZoom && currentZoom <= s.maxZoom);
  const hasCoverageGap = !primaryChart && currentZoom >= 0;
  
  // Check if we're overzooming the primary chart
  const primaryScaleInfo = primaryChart ? getChartScaleInfo(primaryChart.chartId) : null;
  const isOverzoom = primaryScaleInfo && currentZoom > primaryScaleInfo.maxZoom;

  const category = getChartCategory(currentZoom);
  const scale = zoomToScale(currentZoom);
  const bounds = getViewportBounds(centerCoord, currentZoom);

  // Compact view - shows expected scale level (changes with zoom)
  if (!expanded) {
    return (
      <TouchableOpacity 
        style={[styles.compactContainer, { top: topOffset, left: leftOffset }]}
        onPress={() => setExpanded(true)}
      >
        <View style={styles.compactRow}>
          <View style={[styles.categoryDot, { backgroundColor: expectedScaleAtZoom ? category.color : '#888' }]} />
          <Text style={styles.compactChartId}>
            {expectedScaleAtZoom ? `${expectedScaleAtZoom.prefix} ${expectedScaleAtZoom.name}` : 'Unknown'}
          </Text>
          <Text style={styles.compactZoom}>z{currentZoom.toFixed(0)}</Text>
        </View>
      </TouchableOpacity>
    );
  }

  // Expanded view
  return (
    <View style={[styles.container, { top: topOffset, left: leftOffset }]}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Chart Info</Text>
        <TouchableOpacity onPress={() => setExpanded(false)} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={true}>
        
        {/* Combined: Chart File + Scale + Zoom Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>CURRENT VIEW</Text>
          {/* Chart file */}
          <View style={styles.row}>
            <Text style={styles.label}>Chart:</Text>
            <Text style={[styles.primaryChartIdSmall, hasCoverageGap && styles.noCoverageText]}>
              {primaryChart?.chartId || 'No coverage'}
              {primaryIsMerged ? ' 📦' : ''}
            </Text>
          </View>
          {/* Expected scale */}
          <View style={styles.row}>
            <Text style={styles.label}>Tiles from:</Text>
            <View style={[styles.categoryBadgeSmall, { backgroundColor: expectedScaleAtZoom ? category.color : '#888' }]}>
              <Text style={styles.categoryTextSmall}>
                {expectedScaleAtZoom ? `${expectedScaleAtZoom.prefix} ${expectedScaleAtZoom.name}` : 'Unknown'}
              </Text>
            </View>
          </View>
          {/* Zoom and scale */}
          <View style={styles.row}>
            <Text style={styles.label}>Zoom:</Text>
            <Text style={styles.value}>{currentZoom.toFixed(2)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Scale:</Text>
            <Text style={styles.value}>{scale}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>View width:</Text>
            <Text style={styles.value}>{bounds.widthNm.toFixed(1)} nm</Text>
          </View>
        </View>

        {/* Tile Server - compact */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>TILE SERVER</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Status:</Text>
            <Text style={[styles.value, { color: tileServerReady ? '#4CAF50' : '#F44336' }]}>
              {tileServerReady ? 'Running' : 'Stopped'} ({mbtilesCharts.length} charts)
            </Text>
          </View>
          {tileStats && (
            <View style={styles.row}>
              <Text style={styles.label}>Cache:</Text>
              <Text style={styles.value}>
                {tileStats.requestCount > 0 
                  ? `${Math.round(tileStats.cacheHits / tileStats.requestCount * 100)}% hits`
                  : '0 requests'}
                {tileStats.errors > 0 ? ` (${tileStats.errors} errors)` : ''}
              </Text>
            </View>
          )}
        </View>

        {/* Viewport */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>VIEWPORT</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Center:</Text>
            <Text style={styles.coordValue}>
              {formatCoord(centerCoord[0], centerCoord[1])}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>NW:</Text>
            <Text style={styles.coordValue}>
              {formatCoord(bounds.nw[0], bounds.nw[1])}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>SE:</Text>
            <Text style={styles.coordValue}>
              {formatCoord(bounds.se[0], bounds.se[1])}
            </Text>
          </View>
        </View>

        {/* Chart Scale Reference */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SCALE RANGES (green = active)</Text>
          {CHART_SCALES.map(s => {
            const isActive = currentZoom >= s.minZoom && currentZoom <= s.maxZoom;
            return (
              <View key={s.prefix} style={[styles.scaleRow, isActive && styles.scaleRowActive]}>
                <Text style={[styles.scalePrefix, isActive && styles.scaleTextActive]}>
                  {s.prefix}
                </Text>
                <Text style={[styles.scaleName, isActive && styles.scaleTextActive]}>
                  {s.name}
                </Text>
                <Text style={[styles.scaleZoom, isActive && styles.scaleTextActive]}>
                  z{s.minZoom}-{s.maxZoom}
                </Text>
              </View>
            );
          })}
        </View>

        {/* All loaded charts */}
        {coveringCharts.length > 1 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>ALL LOADED CHARTS ({coveringCharts.length})</Text>
            {coveringCharts.slice(0, 6).map(c => (
              <Text key={c.chartId} style={styles.chartListItem}>{c.chartId}</Text>
            ))}
            {coveringCharts.length > 6 && (
              <Text style={styles.chartListMore}>+{coveringCharts.length - 6} more...</Text>
            )}
          </View>
        )}

        {/* Performance */}
        <View style={styles.row}>
          <Text style={styles.label}>FPS:</Text>
          <Text style={[styles.value, fps < 30 && { color: '#FF9800' }, fps < 15 && { color: '#F44336' }]}>
            {fps}
          </Text>
        </View>

        <Text style={styles.hint}>Scroll for more ↓</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    padding: 12,
    borderRadius: 10,
    maxWidth: 300,
    maxHeight: 600,
    zIndex: 9999,
  },
  scrollView: {
    maxHeight: 560,
  },
  compactContainer: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    zIndex: 9999,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  categoryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  compactChartId: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '500',
    fontFamily: 'monospace',
  },
  noCoverageText: {
    color: '#ff9800',
    fontStyle: 'italic',
  },
  overzoomText: {
    color: '#FF9800',
  },
  warningText: {
    color: '#ff9800',
    fontSize: 11,
    marginTop: 4,
  },
  infoText: {
    color: '#4FC3F7',
    fontSize: 11,
    marginTop: 4,
  },
  infoTextSmall: {
    color: '#888',
    fontSize: 10,
    marginTop: 4,
    fontStyle: 'italic',
  },
  compactZoom: {
    color: '#aaa',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 4,
    marginLeft: 8,
  },
  closeButtonText: {
    color: '#888',
    fontSize: 18,
    fontWeight: 'bold',
  },
  section: {
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  sectionTitle: {
    color: '#888',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 2,
  },
  subRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  label: {
    color: '#aaa',
    fontSize: 12,
  },
  subLabel: {
    color: '#666',
    fontSize: 10,
    marginRight: 4,
  },
  value: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
    fontFamily: 'monospace',
  },
  subValue: {
    color: '#888',
    fontSize: 10,
    fontFamily: 'monospace',
    flex: 1,
  },
  coordValue: {
    color: '#4FC3F7',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    marginRight: 8,
  },
  categoryText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  primaryChartId: {
    color: '#4CAF50',
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  primaryChartIdSmall: {
    color: '#4CAF50',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  categoryBadgeSmall: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  categoryTextSmall: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  chartListItem: {
    color: '#aaa',
    fontSize: 11,
    fontFamily: 'monospace',
    paddingVertical: 2,
  },
  chartListMore: {
    color: '#666',
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 4,
  },
  scaleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 4,
    marginVertical: 1,
  },
  scaleRowActive: {
    backgroundColor: 'rgba(76, 175, 80, 0.3)',
  },
  scalePrefix: {
    color: '#666',
    fontSize: 11,
    fontWeight: '600',
    width: 35,
    fontFamily: 'monospace',
  },
  scaleName: {
    color: '#888',
    fontSize: 11,
    flex: 1,
  },
  scaleZoom: {
    color: '#666',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  scaleTextActive: {
    color: '#4CAF50',
  },
  hint: {
    color: '#555',
    fontSize: 9,
    textAlign: 'center',
    marginTop: 8,
  },
});

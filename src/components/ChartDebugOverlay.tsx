/**
 * Chart Debug Overlay - Shows real-time chart and navigation debug info
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

  // Determine which charts are active at current zoom
  const activeCharts = mbtilesCharts.filter(chart => {
    const match = chart.chartId.match(/^US(\d)/);
    if (!match) return currentZoom >= 0; // Non-US charts always show
    
    const scaleNum = parseInt(match[1], 10);
    const scaleInfo = CHART_SCALES.find(s => s.prefix === `US${scaleNum}`);
    if (!scaleInfo) return false;
    
    return currentZoom >= scaleInfo.minZoom;
  });

  // Find the most detailed (primary) chart
  const primaryChart = activeCharts.length > 0 
    ? activeCharts.reduce((best, chart) => {
        const bestNum = parseInt(best.chartId.match(/^US(\d)/)?.[1] || '0', 10);
        const chartNum = parseInt(chart.chartId.match(/^US(\d)/)?.[1] || '0', 10);
        return chartNum > bestNum ? chart : best;
      })
    : null;

  const category = getChartCategory(currentZoom);
  const scale = zoomToScale(currentZoom);
  const bounds = getViewportBounds(centerCoord, currentZoom);

  // Compact view
  if (!expanded) {
    return (
      <TouchableOpacity 
        style={[styles.compactContainer, { top: topOffset }]}
        onPress={() => setExpanded(true)}
      >
        <View style={styles.compactRow}>
          <View style={[styles.categoryDot, { backgroundColor: category.color }]} />
          <Text style={styles.compactChartId}>
            {primaryChart?.chartId || 'No chart'}
          </Text>
          <Text style={styles.compactZoom}>z{currentZoom.toFixed(1)}</Text>
        </View>
      </TouchableOpacity>
    );
  }

  // Expanded view
  return (
    <TouchableOpacity 
      style={[styles.container, { top: topOffset }]}
      onPress={() => setExpanded(false)}
      activeOpacity={0.95}
    >
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Chart Debug</Text>
        
        {/* Active Chart */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ACTIVE CHART</Text>
          <View style={styles.row}>
            <View style={[styles.categoryBadge, { backgroundColor: category.color }]}>
              <Text style={styles.categoryText}>{category.name}</Text>
            </View>
            <Text style={styles.primaryChartId}>
              {primaryChart?.chartId || 'None'}
            </Text>
          </View>
          
          {activeCharts.length > 1 && (
            <View style={styles.subRow}>
              <Text style={styles.subLabel}>Also visible:</Text>
              <Text style={styles.subValue}>
                {activeCharts
                  .filter(c => c.chartId !== primaryChart?.chartId)
                  .map(c => c.chartId)
                  .slice(0, 3)
                  .join(', ')}
                {activeCharts.length > 4 ? ` +${activeCharts.length - 4}` : ''}
              </Text>
            </View>
          )}
        </View>

        {/* Scale & Zoom */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SCALE</Text>
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

        {/* Tile Server */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>TILE SERVER</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Status:</Text>
            <Text style={[styles.value, { color: tileServerReady ? '#4CAF50' : '#F44336' }]}>
              {tileServerReady ? 'Running' : 'Stopped'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Charts loaded:</Text>
            <Text style={styles.value}>{mbtilesCharts.length}</Text>
          </View>
          {tileStats && (
            <>
              <View style={styles.row}>
                <Text style={styles.label}>Requests:</Text>
                <Text style={styles.value}>{tileStats.requestCount}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Cache hits:</Text>
                <Text style={styles.value}>
                  {tileStats.cacheHits} ({tileStats.requestCount > 0 
                    ? Math.round(tileStats.cacheHits / tileStats.requestCount * 100) 
                    : 0}%)
                </Text>
              </View>
              {tileStats.errors > 0 && (
                <View style={styles.row}>
                  <Text style={[styles.label, { color: '#F44336' }]}>Errors:</Text>
                  <Text style={[styles.value, { color: '#F44336' }]}>{tileStats.errors}</Text>
                </View>
              )}
            </>
          )}
        </View>

        {/* Chart Scale Reference */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SCALE RANGES</Text>
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

        {/* Performance */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PERFORMANCE</Text>
          <View style={styles.row}>
            <Text style={styles.label}>FPS:</Text>
            <Text style={[styles.value, fps < 30 && { color: '#FF9800' }, fps < 15 && { color: '#F44336' }]}>
              {fps}
            </Text>
          </View>
        </View>

        <Text style={styles.hint}>Tap to minimize</Text>
      </ScrollView>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    padding: 12,
    borderRadius: 10,
    maxWidth: 280,
    maxHeight: 500,
    zIndex: 9999,
  },
  scrollView: {
    maxHeight: 470,
  },
  compactContainer: {
    position: 'absolute',
    left: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    zIndex: 9999,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  compactChartId: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  compactZoom: {
    color: '#888',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  title: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
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

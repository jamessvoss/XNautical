/**
 * Chart Loader Service - Dynamically loads chart data from cache
 * Replaces static require() imports with on-demand loading
 */

import {
  ChartMetadata,
  FeatureType,
  GeoJSONFeatureCollection,
  LoadedChart,
  ALL_FEATURE_TYPES
} from '../types/chart';
import * as chartCacheService from './chartCacheService';
import * as chartService from './chartService';

// In-memory LRU cache for loaded charts
const MAX_CACHED_CHARTS = 10;
const loadedCharts: Map<string, LoadedChart> = new Map();

/**
 * Get the order of keys for LRU eviction (oldest first)
 */
function getLRUOrder(): string[] {
  return Array.from(loadedCharts.entries())
    .sort((a, b) => a[1].loadedAt.getTime() - b[1].loadedAt.getTime())
    .map(([key]) => key);
}

/**
 * Evict oldest charts if cache is full
 */
function evictIfNeeded(): void {
  while (loadedCharts.size >= MAX_CACHED_CHARTS) {
    const order = getLRUOrder();
    if (order.length > 0) {
      loadedCharts.delete(order[0]);
      console.log(`Evicted chart ${order[0]} from memory cache`);
    }
  }
}

/**
 * Load a chart into memory from local cache
 */
export async function loadChart(chartId: string): Promise<LoadedChart | null> {
  // Check if already in memory
  const existing = loadedCharts.get(chartId);
  if (existing) {
    // Update access time for LRU
    existing.loadedAt = new Date();
    return existing;
  }
  
  // Check if downloaded
  const isCached = await chartCacheService.isChartCached(chartId);
  if (!isCached) {
    return null;
  }
  
  // Load from file system
  try {
    const data = await chartCacheService.loadChart(chartId);
    
    if (Object.keys(data).length === 0) {
      return null;
    }
    
    // Get metadata (try cache first)
    let metadata = await chartService.getChartMetadata(chartId);
    if (!metadata) {
      // Create minimal metadata if not available
      metadata = {
        chartId,
        name: chartId,
        region: 'overview',
        scaleType: 'harbor',
        scale: 5,
        bounds: null,
        center: null,
        fileSizeBytes: 0,
        featureCounts: {} as Record<FeatureType, number>,
        storagePath: '',
        noaaEdition: 0,
        noaaUpdate: 0,
        noaaIssueDate: '',
        lastUpdated: new Date(),
      };
    }
    
    // Evict old charts if needed
    evictIfNeeded();
    
    // Store in memory cache
    const loadedChart: LoadedChart = {
      chartId,
      metadata,
      data,
      loadedAt: new Date(),
    };
    
    loadedCharts.set(chartId, loadedChart);
    console.log(`Loaded chart ${chartId} into memory (${Object.keys(data).length} features)`);
    
    return loadedChart;
  } catch (error) {
    console.error(`Error loading chart ${chartId}:`, error);
    return null;
  }
}

/**
 * Load multiple charts
 */
export async function loadCharts(chartIds: string[]): Promise<Map<string, LoadedChart>> {
  const results = new Map<string, LoadedChart>();
  
  for (const chartId of chartIds) {
    const loaded = await loadChart(chartId);
    if (loaded) {
      results.set(chartId, loaded);
    }
  }
  
  return results;
}

/**
 * Load all downloaded charts
 */
export async function loadAllDownloadedCharts(): Promise<Map<string, LoadedChart>> {
  const downloadedIds = await chartCacheService.getDownloadedChartIds();
  return loadCharts(downloadedIds);
}

/**
 * Unload a chart from memory (keep on disk)
 */
export function unloadChart(chartId: string): void {
  loadedCharts.delete(chartId);
}

/**
 * Clear all charts from memory (keep on disk)
 */
export function clearMemoryCache(): void {
  loadedCharts.clear();
}

/**
 * Get a specific feature from a loaded chart
 */
export function getChartFeature(
  chartId: string,
  featureType: FeatureType
): GeoJSONFeatureCollection | null {
  const chart = loadedCharts.get(chartId);
  if (!chart) {
    return null;
  }
  return chart.data[featureType] || null;
}

/**
 * Get all loaded chart IDs
 */
export function getLoadedChartIds(): string[] {
  return Array.from(loadedCharts.keys());
}

/**
 * Check if a chart is loaded in memory
 */
export function isChartLoaded(chartId: string): boolean {
  return loadedCharts.has(chartId);
}

/**
 * Get chart render order (for quilting - least detailed first)
 */
export function getChartRenderOrder(charts: LoadedChart[]): string[] {
  return charts
    .sort((a, b) => {
      // Sort by scale number (lower = less detailed = render first)
      const scaleOrder = { overview: 1, general: 2, coastal: 3, approach: 4, harbor: 5, berthing: 6 };
      const aOrder = scaleOrder[a.metadata.scaleType] || 3;
      const bOrder = scaleOrder[b.metadata.scaleType] || 3;
      
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      
      // If same scale type, sort by scale number
      return a.metadata.scale - b.metadata.scale;
    })
    .map(c => c.chartId);
}

/**
 * Combine features from multiple charts for rendering
 * Respects quilting order (less detailed charts first, more detailed on top)
 */
export function combineChartFeatures(
  chartIds: string[],
  featureType: FeatureType
): GeoJSONFeatureCollection {
  const combined: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features: [],
  };
  
  for (const chartId of chartIds) {
    const features = getChartFeature(chartId, featureType);
    if (features && features.features) {
      // Add chart ID to each feature for filtering
      const taggedFeatures = features.features.map(f => ({
        ...f,
        properties: {
          ...f.properties,
          _chartId: chartId,
        },
      }));
      combined.features.push(...taggedFeatures);
    }
  }
  
  return combined;
}

/**
 * Get memory cache statistics
 */
export function getMemoryCacheStats(): {
  chartsLoaded: number;
  maxCharts: number;
  chartIds: string[];
} {
  return {
    chartsLoaded: loadedCharts.size,
    maxCharts: MAX_CACHED_CHARTS,
    chartIds: Array.from(loadedCharts.keys()),
  };
}

/**
 * Download and load a chart (convenience function)
 */
export async function downloadAndLoadChart(
  chartId: string,
  region: string,
  onProgress?: (featureType: FeatureType, downloaded: number, total: number) => void
): Promise<LoadedChart | null> {
  try {
    // Download from Firebase
    const features = await chartService.downloadChart(
      chartId,
      region as any,
      onProgress
    );
    
    if (Object.keys(features).length === 0) {
      return null;
    }
    
    // Save to cache
    await chartCacheService.saveChart(chartId, features);
    
    // Load into memory
    return loadChart(chartId);
  } catch (error) {
    console.error(`Error downloading and loading chart ${chartId}:`, error);
    throw error;
  }
}

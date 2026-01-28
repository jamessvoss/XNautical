/**
 * Chart Index Service
 * 
 * Loads and provides access to the pre-built chart index.
 * The index contains:
 * - Chart hierarchy (parent/child relationships)
 * - Bounds for each chart
 * - Tier assignments (memory vs dynamic)
 * - Zoom ranges
 * 
 * This eliminates runtime tree-building - just load the JSON and go.
 */

import * as FileSystem from 'expo-file-system/legacy';

export interface ChartInfo {
  bounds: [number, number, number, number] | null; // [west, south, east, north]
  level: number;
  levelName: string;
  minZoom: number | null;
  maxZoom: number | null;
  name: string | null;
  format: string;
  fileSizeBytes: number;
  parent: string | null;
  children: string[];
}

export interface ChartIndexStats {
  totalCharts: number;
  byLevel: Record<string, number>;
  tier1: {
    description: string;
    chartCount: number;
    totalSizeBytes: number;
    totalSizeMB: number;
  };
  tier2: {
    description: string;
    chartCount: number;
    totalSizeBytes: number;
    totalSizeMB: number;
  };
}

export interface ChartIndex {
  version: number;
  generated: string;
  stats: ChartIndexStats;
  roots: string[];
  tier1Charts: string[];
  tier2Charts: string[];
  charts: Record<string, ChartInfo>;
}

// Module state
let chartIndex: ChartIndex | null = null;
let isLoaded = false;

/**
 * Load the chart index from file
 */
export async function loadChartIndex(indexPath?: string): Promise<ChartIndex | null> {
  if (isLoaded && chartIndex) {
    return chartIndex;
  }

  const path = indexPath || `${FileSystem.documentDirectory}mbtiles/chart_index.json`;
  
  try {
    const fileInfo = await FileSystem.getInfoAsync(path);
    if (!fileInfo.exists) {
      // Not a warning - chart_index.json is optional when using regions.json for tiered loading
      console.log('[ChartIndex] Index file not found (OK if using regions.json):', path);
      return null;
    }

    const content = await FileSystem.readAsStringAsync(path);
    chartIndex = JSON.parse(content) as ChartIndex;
    isLoaded = true;

    console.log(`[ChartIndex] Loaded index v${chartIndex.version}`);
    console.log(`[ChartIndex] ${chartIndex.stats.totalCharts} charts`);
    console.log(`[ChartIndex] Tier 1: ${chartIndex.stats.tier1.chartCount} charts (${chartIndex.stats.tier1.totalSizeMB} MB)`);
    console.log(`[ChartIndex] Tier 2: ${chartIndex.stats.tier2.chartCount} charts (${chartIndex.stats.tier2.totalSizeMB} MB)`);

    return chartIndex;
  } catch (error) {
    console.error('[ChartIndex] Failed to load index:', error);
    return null;
  }
}

/**
 * Get the loaded chart index
 */
export function getChartIndex(): ChartIndex | null {
  return chartIndex;
}

/**
 * Check if index is loaded
 */
export function isIndexLoaded(): boolean {
  return isLoaded && chartIndex !== null;
}

/**
 * Get chart info by ID
 */
export function getChartInfo(chartId: string): ChartInfo | null {
  if (!chartIndex) return null;
  return chartIndex.charts[chartId] || null;
}

/**
 * Get all Tier 1 chart IDs (memory-resident: US1/US2/US3)
 */
export function getTier1Charts(): string[] {
  if (!chartIndex) return [];
  return chartIndex.tier1Charts;
}

/**
 * Get all Tier 2 chart IDs (dynamic loading: US4/US5)
 */
export function getTier2Charts(): string[] {
  if (!chartIndex) return [];
  return chartIndex.tier2Charts;
}

/**
 * Get root chart IDs (top of hierarchy)
 */
export function getRootCharts(): string[] {
  if (!chartIndex) return [];
  return chartIndex.roots;
}

/**
 * Get parent of a chart
 */
export function getParent(chartId: string): string | null {
  const info = getChartInfo(chartId);
  return info?.parent || null;
}

/**
 * Get children of a chart
 */
export function getChildren(chartId: string): string[] {
  const info = getChartInfo(chartId);
  return info?.children || [];
}

/**
 * Get ancestor chain (from chart up to root)
 */
export function getAncestors(chartId: string): string[] {
  const ancestors: string[] = [];
  let current = getParent(chartId);
  
  while (current) {
    ancestors.push(current);
    current = getParent(current);
  }
  
  return ancestors;
}

/**
 * Get all descendants (recursive children)
 */
export function getDescendants(chartId: string): string[] {
  const descendants: string[] = [];
  const children = getChildren(chartId);
  
  for (const child of children) {
    descendants.push(child);
    descendants.push(...getDescendants(child));
  }
  
  return descendants;
}

/**
 * Check if a point is within chart bounds
 */
export function isPointInChart(chartId: string, lon: number, lat: number): boolean {
  const info = getChartInfo(chartId);
  if (!info?.bounds) return false;
  
  const [west, south, east, north] = info.bounds;
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

/**
 * Find charts that contain a point, optionally filtered by level
 */
export function findChartsAtPoint(lon: number, lat: number, level?: number): string[] {
  if (!chartIndex) return [];
  
  const matches: string[] = [];
  
  for (const [chartId, info] of Object.entries(chartIndex.charts)) {
    if (level !== undefined && info.level !== level) continue;
    if (isPointInChart(chartId, lon, lat)) {
      matches.push(chartId);
    }
  }
  
  return matches;
}

/**
 * Find charts visible at a zoom level that contain a point
 * Uses the tree structure for efficient lookup
 */
export function findChartsForViewport(
  centerLon: number,
  centerLat: number,
  zoom: number
): { tier1: string[]; tier2: string[] } {
  if (!chartIndex) return { tier1: [], tier2: [] };
  
  const tier1: string[] = [];
  const tier2: string[] = [];
  
  // Start from roots and traverse down
  const processNode = (chartId: string) => {
    const info = chartIndex!.charts[chartId];
    if (!info) return;
    
    // Check if this chart contains the viewport center
    if (!isPointInChart(chartId, centerLon, centerLat)) {
      return;
    }
    
    // Check if this chart is visible at current zoom
    const minZoom = info.minZoom ?? 0;
    const maxZoom = info.maxZoom ?? 22;
    
    if (zoom >= minZoom) {
      // Add to appropriate tier
      if (info.level <= 3) {
        tier1.push(chartId);
      } else {
        tier2.push(chartId);
      }
    }
    
    // Recurse into children if we might need more detail
    if (zoom > minZoom) {
      for (const childId of info.children) {
        processNode(childId);
      }
    }
  };
  
  // Start from each root
  for (const rootId of chartIndex.roots) {
    processNode(rootId);
  }
  
  return { tier1, tier2 };
}

/**
 * Get charts appropriate for a zoom level
 */
export function getChartsForZoom(zoom: number): string[] {
  if (!chartIndex) return [];
  
  const charts: string[] = [];
  
  for (const [chartId, info] of Object.entries(chartIndex.charts)) {
    const minZoom = info.minZoom ?? 0;
    const maxZoom = info.maxZoom ?? 22;
    
    if (zoom >= minZoom && zoom <= maxZoom) {
      charts.push(chartId);
    }
  }
  
  return charts;
}

/**
 * Check if a chart is Tier 1 (memory-resident)
 */
export function isTier1Chart(chartId: string): boolean {
  if (!chartIndex) return false;
  return chartIndex.tier1Charts.includes(chartId);
}

/**
 * Check if a chart is Tier 2 (dynamic loading)
 */
export function isTier2Chart(chartId: string): boolean {
  if (!chartIndex) return false;
  return chartIndex.tier2Charts.includes(chartId);
}

/**
 * Get index statistics
 */
export function getStats(): ChartIndexStats | null {
  return chartIndex?.stats || null;
}

/**
 * Clear loaded index (for testing/reload)
 */
export function clearIndex(): void {
  chartIndex = null;
  isLoaded = false;
}

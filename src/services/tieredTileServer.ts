/**
 * Tiered Tile Server
 * 
 * Orchestrates the two-tier tile serving architecture:
 * 
 * Tier 1 (Memory): US1/US2/US3 tiles loaded entirely into RAM
 *   - ~500MB, 81 charts
 *   - O(1) lookup, instant serving
 *   
 * Tier 2 (Dynamic): US4/US5 tiles served from LRU database pool
 *   - ~1100+ charts, 40-50 open at a time
 *   - LRU eviction keeps memory bounded
 * 
 * Uses pre-built chart index for O(log n) chart lookup.
 */

import * as chartIndex from './chartIndex';
import * as memoryTileCache from './memoryTileCache';
import * as databasePool from './databasePool';
import * as FileSystem from 'expo-file-system/legacy';

// Server state
let isInitialized = false;
let initPromise: Promise<boolean> | null = null;
let mbtilesDirectory = '';

// Statistics
let stats = {
  tier1Requests: 0,
  tier1Hits: 0,
  tier2Requests: 0,
  tier2Hits: 0,
  totalRequests: 0,
};

export interface InitOptions {
  mbtilesDir?: string;
  poolSize?: number;
  onProgress?: (status: LoadingStatus) => void;
}

export interface LoadingStatus {
  stage: 'index' | 'tier1' | 'ready';
  progress: number;
  total: number;
  message: string;
}

/**
 * Initialize the tiered tile server
 * 
 * 1. Load chart index
 * 2. Load Tier 1 tiles into memory
 * 3. Initialize database pool for Tier 2
 */
export async function initialize(options: InitOptions = {}): Promise<boolean> {
  // Return existing promise if already initializing
  if (initPromise) {
    return initPromise;
  }
  
  if (isInitialized) {
    return true;
  }
  
  initPromise = doInitialize(options);
  return initPromise;
}

async function doInitialize(options: InitOptions): Promise<boolean> {
  const { onProgress } = options;
  mbtilesDirectory = options.mbtilesDir || `${FileSystem.documentDirectory}mbtiles`;
  
  console.log('[TieredTileServer] Initializing...');
  console.log(`[TieredTileServer] MBTiles directory: ${mbtilesDirectory}`);
  
  try {
    // Stage 1: Load chart index
    onProgress?.({ stage: 'index', progress: 0, total: 1, message: 'Loading chart index...' });
    
    const index = await chartIndex.loadChartIndex(`${mbtilesDirectory}/chart_index.json`);
    
    if (!index) {
      console.warn('[TieredTileServer] No chart index found - falling back to legacy mode');
      onProgress?.({ stage: 'ready', progress: 1, total: 1, message: 'No index found' });
      isInitialized = true;
      initPromise = null;
      return false;
    }
    
    onProgress?.({ stage: 'index', progress: 1, total: 1, message: 'Chart index loaded' });
    
    // Stage 2: Load Tier 1 tiles into memory
    const tier1Charts = chartIndex.getTier1Charts();
    console.log(`[TieredTileServer] Loading ${tier1Charts.length} Tier 1 charts into memory...`);
    
    // Subscribe to memory cache progress
    const unsubscribe = memoryTileCache.onProgress((progress) => {
      onProgress?.({
        stage: 'tier1',
        progress: progress.current,
        total: progress.total,
        message: `Loading ${progress.currentChart}...`,
      });
    });
    
    await memoryTileCache.loadTier1Tiles(mbtilesDirectory);
    unsubscribe();
    
    // Stage 3: Initialize database pool for Tier 2
    databasePool.initPool({
      maxSize: options.poolSize || 40,
      mbtilesDirectory,
    });
    
    const memStats = memoryTileCache.getStats();
    console.log(`[TieredTileServer] Initialization complete`);
    console.log(`[TieredTileServer] Tier 1: ${memStats.tileCount} tiles, ${memStats.estimatedMemoryMB.toFixed(1)} MB`);
    console.log(`[TieredTileServer] Tier 2: Pool size ${options.poolSize || 40}`);
    
    onProgress?.({ stage: 'ready', progress: 1, total: 1, message: 'Ready' });
    
    isInitialized = true;
    initPromise = null;
    return true;
    
  } catch (error) {
    console.error('[TieredTileServer] Initialization failed:', error);
    initPromise = null;
    return false;
  }
}

/**
 * Get a tile from the appropriate tier
 * 
 * Returns base64-encoded tile data or null if not found
 */
export async function getTile(
  chartId: string,
  z: number,
  x: number,
  y: number
): Promise<string | null> {
  stats.totalRequests++;
  
  // Check if this is a Tier 1 chart (memory)
  if (chartIndex.isTier1Chart(chartId)) {
    stats.tier1Requests++;
    const tile = memoryTileCache.getTile(chartId, z, x, y);
    if (tile) {
      stats.tier1Hits++;
    }
    return tile;
  }
  
  // Tier 2 chart (database pool)
  stats.tier2Requests++;
  const tile = await databasePool.getTile(chartId, z, x, y);
  if (tile) {
    stats.tier2Hits++;
  }
  return tile;
}

/**
 * Check if a tile exists
 */
export async function hasTile(
  chartId: string,
  z: number,
  x: number,
  y: number
): Promise<boolean> {
  if (chartIndex.isTier1Chart(chartId)) {
    return memoryTileCache.hasTile(chartId, z, x, y);
  }
  return databasePool.hasTile(chartId, z, x, y);
}

/**
 * Get charts relevant to a viewport
 */
export function getChartsForViewport(
  centerLon: number,
  centerLat: number,
  zoom: number
): { tier1: string[]; tier2: string[] } {
  return chartIndex.findChartsForViewport(centerLon, centerLat, zoom);
}

/**
 * Preload Tier 2 charts for a viewport
 * Call this when the user pans to a new area
 */
export async function preloadForViewport(
  centerLon: number,
  centerLat: number,
  zoom: number
): Promise<void> {
  const { tier2 } = chartIndex.findChartsForViewport(centerLon, centerLat, zoom);
  
  if (tier2.length > 0) {
    // Preload the most relevant charts (limit to not overwhelm pool)
    const toPreload = tier2.slice(0, 10);
    await databasePool.preloadCharts(toPreload);
  }
}

/**
 * Get all available chart IDs
 */
export function getAllChartIds(): string[] {
  const index = chartIndex.getChartIndex();
  if (!index) return [];
  return Object.keys(index.charts);
}

/**
 * Get Tier 1 chart IDs
 */
export function getTier1ChartIds(): string[] {
  return chartIndex.getTier1Charts();
}

/**
 * Get Tier 2 chart IDs
 */
export function getTier2ChartIds(): string[] {
  return chartIndex.getTier2Charts();
}

/**
 * Check if server is initialized
 */
export function isReady(): boolean {
  return isInitialized;
}

/**
 * Get server statistics
 */
export function getStats(): {
  isReady: boolean;
  tier1: {
    tileCount: number;
    memoryMB: number;
    chartCount: number;
    requests: number;
    hits: number;
    hitRate: number;
  };
  tier2: {
    poolSize: number;
    poolUsed: number;
    requests: number;
    hits: number;
    hitRate: number;
    evictions: number;
  };
  totalRequests: number;
} {
  const memStats = memoryTileCache.getStats();
  const poolStats = databasePool.getPoolStats();
  
  return {
    isReady: isInitialized,
    tier1: {
      tileCount: memStats.tileCount,
      memoryMB: memStats.estimatedMemoryMB,
      chartCount: memStats.chartCount,
      requests: stats.tier1Requests,
      hits: stats.tier1Hits,
      hitRate: stats.tier1Requests > 0 ? stats.tier1Hits / stats.tier1Requests : 0,
    },
    tier2: {
      poolSize: poolStats.maxSize,
      poolUsed: poolStats.size,
      requests: stats.tier2Requests,
      hits: stats.tier2Hits,
      hitRate: stats.tier2Requests > 0 ? stats.tier2Hits / stats.tier2Requests : 0,
      evictions: poolStats.evictions,
    },
    totalRequests: stats.totalRequests,
  };
}

/**
 * Shutdown the tiered tile server
 */
export async function shutdown(): Promise<void> {
  console.log('[TieredTileServer] Shutting down...');
  
  memoryTileCache.clearCache();
  await databasePool.clearPool();
  chartIndex.clearIndex();
  
  isInitialized = false;
  initPromise = null;
  stats = {
    tier1Requests: 0,
    tier1Hits: 0,
    tier2Requests: 0,
    tier2Hits: 0,
    totalRequests: 0,
  };
  
  console.log('[TieredTileServer] Shutdown complete');
}

/**
 * Get chart info from index
 */
export function getChartInfo(chartId: string) {
  return chartIndex.getChartInfo(chartId);
}

/**
 * Get chart hierarchy info
 */
export function getChartHierarchy(chartId: string): {
  parent: string | null;
  children: string[];
  ancestors: string[];
  descendants: string[];
} {
  return {
    parent: chartIndex.getParent(chartId),
    children: chartIndex.getChildren(chartId),
    ancestors: chartIndex.getAncestors(chartId),
    descendants: chartIndex.getDescendants(chartId),
  };
}

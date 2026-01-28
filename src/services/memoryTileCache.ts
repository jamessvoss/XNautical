/**
 * Memory Tile Cache - Tier 1 In-Memory Tiles
 * 
 * Loads all tiles from US1/US2/US3 charts into memory at startup.
 * This provides instant tile serving for overview/general/coastal charts.
 * 
 * ~500MB of tiles kept in RAM for O(1) lookup.
 * No SQLite queries needed for these charts.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import * as chartIndex from './chartIndex';

// Tile data stored as base64 strings (compressed MVT)
// Key format: "chartId/z/x/y"
const tileCache: Map<string, string> = new Map();

// Loading state
let isLoading = false;
let isLoaded = false;
let loadProgress = { current: 0, total: 0, currentChart: '' };

// Callbacks for progress updates
type ProgressCallback = (progress: typeof loadProgress) => void;
const progressCallbacks: Set<ProgressCallback> = new Set();

/**
 * Generate cache key for a tile
 */
function getTileKey(chartId: string, z: number, x: number, y: number): string {
  return `${chartId}/${z}/${x}/${y}`;
}

/**
 * Convert TMS y to standard y coordinate
 */
function tmsToStandardY(z: number, tmsY: number): number {
  return (1 << z) - 1 - tmsY;
}

/**
 * Efficiently convert Uint8Array to base64 string
 * Uses chunked processing to avoid call stack limits and reduce string concatenation overhead
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Process in chunks to avoid call stack overflow for large arrays
  const CHUNK_SIZE = 0x8000; // 32KB chunks
  const chunks: string[] = [];
  
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    chunks.push(String.fromCharCode.apply(null, chunk as unknown as number[]));
  }
  
  return btoa(chunks.join(''));
}

/**
 * Load all tiles from an MBTiles file into memory
 */
async function loadChartTiles(chartId: string, mbtilesPath: string): Promise<number> {
  let tileCount = 0;
  
  try {
    // Copy to SQLite directory if needed
    const dbName = `tier1_${chartId}.db`;
    const dbPath = `${FileSystem.documentDirectory}SQLite/${dbName}`;
    const dbDir = `${FileSystem.documentDirectory}SQLite`;
    
    // Ensure directory exists
    const dirInfo = await FileSystem.getInfoAsync(dbDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(dbDir, { intermediates: true });
    }
    
    // Copy file if not already there
    const dbFileInfo = await FileSystem.getInfoAsync(dbPath);
    if (!dbFileInfo.exists) {
      await FileSystem.copyAsync({ from: mbtilesPath, to: dbPath });
    }
    
    // Open database
    const db = await SQLite.openDatabaseAsync(dbName);
    
    // Read all tiles
    const rows = await db.getAllAsync<{
      zoom_level: number;
      tile_column: number;
      tile_row: number;
      tile_data: ArrayBuffer;
    }>('SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles');
    
    for (const row of rows) {
      const z = row.zoom_level;
      const x = row.tile_column;
      // MBTiles uses TMS y-coordinate, convert to standard
      const y = tmsToStandardY(z, row.tile_row);
      
      // Store tile data as base64
      const key = getTileKey(chartId, z, x, y);
      
      // Convert ArrayBuffer to base64 using efficient chunked conversion
      if (row.tile_data) {
        const bytes = new Uint8Array(row.tile_data);
        const base64 = uint8ArrayToBase64(bytes);
        tileCache.set(key, base64);
        tileCount++;
      }
    }
    
    // Close database - we don't need it anymore
    await db.closeAsync();
    
    // Delete the temp copy
    await FileSystem.deleteAsync(dbPath, { idempotent: true });
    
  } catch (error) {
    console.error(`[MemoryTileCache] Error loading ${chartId}:`, error);
  }
  
  return tileCount;
}

/**
 * Load all Tier 1 charts into memory
 */
export async function loadTier1Tiles(mbtilesDir?: string): Promise<boolean> {
  if (isLoaded) {
    console.log('[MemoryTileCache] Already loaded');
    return true;
  }
  
  if (isLoading) {
    console.log('[MemoryTileCache] Already loading');
    return false;
  }
  
  isLoading = true;
  const dir = mbtilesDir || `${FileSystem.documentDirectory}mbtiles`;
  
  // Get Tier 1 charts from index
  const tier1Charts = chartIndex.getTier1Charts();
  
  if (tier1Charts.length === 0) {
    console.warn('[MemoryTileCache] No Tier 1 charts in index');
    isLoading = false;
    return false;
  }
  
  console.log(`[MemoryTileCache] Loading ${tier1Charts.length} Tier 1 charts into memory...`);
  
  loadProgress = { current: 0, total: tier1Charts.length, currentChart: '' };
  notifyProgress();
  
  let totalTiles = 0;
  let loadedCount = 0;
  const startTime = Date.now();
  
  // Parallel batch loading for faster initialization (3-5x speedup)
  const BATCH_SIZE = 5;
  
  // First, filter to only charts that exist
  const existingCharts: { chartId: string; mbtilesPath: string }[] = [];
  for (const chartId of tier1Charts) {
    const mbtilesPath = `${dir}/${chartId}.mbtiles`;
    const fileInfo = await FileSystem.getInfoAsync(mbtilesPath);
    if (fileInfo.exists) {
      existingCharts.push({ chartId, mbtilesPath });
    } else {
      console.warn(`[MemoryTileCache] File not found: ${mbtilesPath}`);
    }
  }
  
  // Load in parallel batches
  for (let i = 0; i < existingCharts.length; i += BATCH_SIZE) {
    const batch = existingCharts.slice(i, i + BATCH_SIZE);
    
    // Update progress to show batch start
    loadProgress = { 
      current: loadedCount, 
      total: tier1Charts.length, 
      currentChart: batch.map(c => c.chartId).join(', ')
    };
    notifyProgress();
    
    // Load batch in parallel
    const results = await Promise.all(
      batch.map(async ({ chartId, mbtilesPath }) => {
        const tileCount = await loadChartTiles(chartId, mbtilesPath);
        console.log(`[MemoryTileCache] Loaded ${chartId}: ${tileCount} tiles`);
        return tileCount;
      })
    );
    
    // Accumulate results
    for (const tileCount of results) {
      totalTiles += tileCount;
    }
    loadedCount += batch.length;
    
    // Update progress after batch completes
    loadProgress = { current: loadedCount, total: tier1Charts.length, currentChart: '' };
    notifyProgress();
  }
  
  const elapsed = (Date.now() - startTime) / 1000;
  const memoryMB = estimateMemoryUsage() / 1024 / 1024;
  
  console.log(`[MemoryTileCache] Complete!`);
  console.log(`[MemoryTileCache] ${totalTiles} tiles loaded in ${elapsed.toFixed(1)}s`);
  console.log(`[MemoryTileCache] Estimated memory: ${memoryMB.toFixed(1)} MB`);
  
  isLoaded = true;
  isLoading = false;
  loadProgress = { current: tier1Charts.length, total: tier1Charts.length, currentChart: 'Done' };
  notifyProgress();
  
  return true;
}

/**
 * Get a tile from memory cache
 * Returns base64-encoded tile data or null if not found
 */
export function getTile(chartId: string, z: number, x: number, y: number): string | null {
  const key = getTileKey(chartId, z, x, y);
  return tileCache.get(key) || null;
}

/**
 * Check if a tile exists in memory cache
 */
export function hasTile(chartId: string, z: number, x: number, y: number): boolean {
  const key = getTileKey(chartId, z, x, y);
  return tileCache.has(key);
}

/**
 * Check if a chart is loaded in memory
 */
export function isChartLoaded(chartId: string): boolean {
  // Check if any tiles exist for this chart
  for (const key of tileCache.keys()) {
    if (key.startsWith(`${chartId}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * Get loading status
 */
export function getLoadingStatus(): {
  isLoading: boolean;
  isLoaded: boolean;
  progress: typeof loadProgress;
} {
  return { isLoading, isLoaded, progress: loadProgress };
}

/**
 * Subscribe to loading progress updates
 */
export function onProgress(callback: ProgressCallback): () => void {
  progressCallbacks.add(callback);
  return () => progressCallbacks.delete(callback);
}

/**
 * Notify all progress callbacks
 */
function notifyProgress(): void {
  for (const callback of progressCallbacks) {
    callback(loadProgress);
  }
}

/**
 * Estimate memory usage of cached tiles
 */
export function estimateMemoryUsage(): number {
  let totalBytes = 0;
  
  for (const data of tileCache.values()) {
    // Base64 is ~4/3 of original size, plus string overhead
    totalBytes += data.length * 0.75;
  }
  
  return totalBytes;
}

/**
 * Get cache statistics
 */
export function getStats(): {
  tileCount: number;
  estimatedMemoryBytes: number;
  estimatedMemoryMB: number;
  chartCount: number;
} {
  const charts = new Set<string>();
  
  for (const key of tileCache.keys()) {
    const chartId = key.split('/')[0];
    charts.add(chartId);
  }
  
  const memBytes = estimateMemoryUsage();
  
  return {
    tileCount: tileCache.size,
    estimatedMemoryBytes: memBytes,
    estimatedMemoryMB: memBytes / 1024 / 1024,
    chartCount: charts.size,
  };
}

/**
 * Clear the memory cache
 */
export function clearCache(): void {
  tileCache.clear();
  isLoaded = false;
  isLoading = false;
  loadProgress = { current: 0, total: 0, currentChart: '' };
}

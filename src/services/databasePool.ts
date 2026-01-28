/**
 * Database Pool - LRU Pool for Tier 2 MBTiles Databases
 * 
 * Manages a pool of open SQLite connections for US4/US5 charts.
 * Uses LRU (Least Recently Used) eviction to keep memory bounded.
 * 
 * Pool size: 40-50 databases (configurable)
 * When full, closes least recently used databases to make room.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';

interface PooledDatabase {
  chartId: string;
  db: SQLite.SQLiteDatabase;
  dbPath: string;
  lastAccess: number;
  accessCount: number;
}

// Configuration
const DEFAULT_POOL_SIZE = 40;
const MAX_POOL_SIZE = 60;

// Pool state
const pool: Map<string, PooledDatabase> = new Map();
let poolSize = DEFAULT_POOL_SIZE;
let mbtilesDir = '';

// LRU order tracking - oldest at front, newest at back
// This allows O(1) eviction instead of O(n) scan
let lruOrder: string[] = [];

// Statistics
let stats = {
  hits: 0,
  misses: 0,
  evictions: 0,
  errors: 0,
};

/**
 * Update LRU order when a chart is accessed
 * Moves the chart to the back of the queue (most recently used)
 */
function updateLruOrder(chartId: string): void {
  // Remove from current position if exists
  const index = lruOrder.indexOf(chartId);
  if (index > -1) {
    lruOrder.splice(index, 1);
  }
  // Add to back (most recently used)
  lruOrder.push(chartId);
}

/**
 * Initialize the database pool
 */
export function initPool(options?: {
  maxSize?: number;
  mbtilesDirectory?: string;
}): void {
  poolSize = Math.min(options?.maxSize || DEFAULT_POOL_SIZE, MAX_POOL_SIZE);
  mbtilesDir = options?.mbtilesDirectory || `${FileSystem.documentDirectory}mbtiles`;
  
  console.log(`[DatabasePool] Initialized with max size ${poolSize}`);
}

/**
 * Get or open a database connection
 */
async function getDatabase(chartId: string): Promise<PooledDatabase | null> {
  // Check if already in pool
  const existing = pool.get(chartId);
  if (existing) {
    existing.lastAccess = Date.now();
    existing.accessCount++;
    updateLruOrder(chartId); // Update LRU order on access
    stats.hits++;
    return existing;
  }
  
  stats.misses++;
  
  // Need to open a new database
  // First, ensure we have room in the pool
  if (pool.size >= poolSize) {
    await evictLRU();
  }
  
  try {
    const mbtilesPath = `${mbtilesDir}/${chartId}.mbtiles`;
    
    // Check if file exists
    const fileInfo = await FileSystem.getInfoAsync(mbtilesPath);
    if (!fileInfo.exists) {
      console.warn(`[DatabasePool] MBTiles not found: ${mbtilesPath}`);
      return null;
    }
    
    // Copy to SQLite directory
    const dbName = `pool_${chartId}.db`;
    const dbPath = `${FileSystem.documentDirectory}SQLite/${dbName}`;
    const dbDir = `${FileSystem.documentDirectory}SQLite`;
    
    // Ensure directory exists
    const dirInfo = await FileSystem.getInfoAsync(dbDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(dbDir, { intermediates: true });
    }
    
    // Copy file if not there
    const dbFileInfo = await FileSystem.getInfoAsync(dbPath);
    if (!dbFileInfo.exists) {
      await FileSystem.copyAsync({ from: mbtilesPath, to: dbPath });
    }
    
    // Open database
    const db = await SQLite.openDatabaseAsync(dbName);
    
    const pooledDb: PooledDatabase = {
      chartId,
      db,
      dbPath,
      lastAccess: Date.now(),
      accessCount: 1,
    };
    
    pool.set(chartId, pooledDb);
    updateLruOrder(chartId); // Add to LRU order
    console.log(`[DatabasePool] Opened ${chartId} (pool size: ${pool.size})`);
    
    return pooledDb;
  } catch (error) {
    console.error(`[DatabasePool] Error opening ${chartId}:`, error);
    stats.errors++;
    return null;
  }
}

/**
 * Evict the least recently used database
 * O(1) eviction using maintained LRU order
 */
async function evictLRU(): Promise<void> {
  if (pool.size === 0 || lruOrder.length === 0) return;
  
  // Get LRU entry from front of the order array
  const lruChartId = lruOrder[0];
  
  if (lruChartId && pool.has(lruChartId)) {
    await closeDatabase(lruChartId);
    stats.evictions++;
    console.log(`[DatabasePool] Evicted ${lruChartId}`);
  } else if (lruOrder.length > 0) {
    // If first entry is stale, remove it and try again
    lruOrder.shift();
    await evictLRU();
  }
}

/**
 * Close a specific database
 */
async function closeDatabase(chartId: string): Promise<void> {
  const entry = pool.get(chartId);
  if (!entry) return;
  
  try {
    await entry.db.closeAsync();
    // Clean up the copied file
    await FileSystem.deleteAsync(entry.dbPath, { idempotent: true });
  } catch (error) {
    console.error(`[DatabasePool] Error closing ${chartId}:`, error);
  }
  
  pool.delete(chartId);
  
  // Remove from LRU order
  const index = lruOrder.indexOf(chartId);
  if (index > -1) {
    lruOrder.splice(index, 1);
  }
}

/**
 * Convert TMS y to standard y coordinate
 */
function tmsToStandardY(z: number, tmsY: number): number {
  return (1 << z) - 1 - tmsY;
}

/**
 * Convert standard y to TMS y coordinate
 */
function standardToTmsY(z: number, y: number): number {
  return (1 << z) - 1 - y;
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
 * Get a tile from a Tier 2 chart
 * Returns base64-encoded tile data or null if not found
 */
export async function getTile(
  chartId: string,
  z: number,
  x: number,
  y: number
): Promise<string | null> {
  const pooledDb = await getDatabase(chartId);
  if (!pooledDb) return null;
  
  try {
    // Convert to TMS y-coordinate for MBTiles query
    const tmsY = standardToTmsY(z, y);
    
    const result = await pooledDb.db.getFirstAsync<{ tile_data: ArrayBuffer }>(
      'SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?',
      [z, x, tmsY]
    );
    
    if (!result?.tile_data) {
      return null;
    }
    
    // Convert to base64 using efficient chunked conversion
    const bytes = new Uint8Array(result.tile_data);
    return uint8ArrayToBase64(bytes);
  } catch (error) {
    console.error(`[DatabasePool] Error getting tile ${chartId}/${z}/${x}/${y}:`, error);
    return null;
  }
}

/**
 * Check if a tile exists in a Tier 2 chart
 */
export async function hasTile(
  chartId: string,
  z: number,
  x: number,
  y: number
): Promise<boolean> {
  const pooledDb = await getDatabase(chartId);
  if (!pooledDb) return false;
  
  try {
    const tmsY = standardToTmsY(z, y);
    
    const result = await pooledDb.db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?',
      [z, x, tmsY]
    );
    
    return (result?.count ?? 0) > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Preload specific charts into the pool
 */
export async function preloadCharts(chartIds: string[]): Promise<void> {
  console.log(`[DatabasePool] Preloading ${chartIds.length} charts...`);
  
  for (const chartId of chartIds) {
    if (pool.size >= poolSize) break;
    await getDatabase(chartId);
  }
}

/**
 * Check if a chart is currently in the pool
 */
export function isChartInPool(chartId: string): boolean {
  return pool.has(chartId);
}

/**
 * Get pool statistics
 */
export function getPoolStats(): {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  hitRate: number;
  evictions: number;
  errors: number;
  charts: string[];
} {
  const total = stats.hits + stats.misses;
  
  return {
    size: pool.size,
    maxSize: poolSize,
    hits: stats.hits,
    misses: stats.misses,
    hitRate: total > 0 ? stats.hits / total : 0,
    evictions: stats.evictions,
    errors: stats.errors,
    charts: Array.from(pool.keys()),
  };
}

/**
 * Clear the pool (close all databases)
 */
export async function clearPool(): Promise<void> {
  console.log(`[DatabasePool] Clearing pool (${pool.size} databases)...`);
  
  for (const chartId of pool.keys()) {
    await closeDatabase(chartId);
  }
  
  pool.clear();
  lruOrder = []; // Reset LRU order
  stats = { hits: 0, misses: 0, evictions: 0, errors: 0 };
}

/**
 * Set pool size (will evict if necessary)
 */
export async function setPoolSize(newSize: number): Promise<void> {
  poolSize = Math.min(Math.max(newSize, 10), MAX_POOL_SIZE);
  
  // Evict if over new size
  while (pool.size > poolSize) {
    await evictLRU();
  }
  
  console.log(`[DatabasePool] Pool size set to ${poolSize}`);
}

/**
 * Get list of charts currently in pool
 */
export function getPooledCharts(): string[] {
  return Array.from(pool.keys());
}

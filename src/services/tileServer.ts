/**
 * Local Tile Server - Serves MBTiles vector and raster tiles via local HTTP server
 * 
 * This service wraps native modules (LocalTileServer) that run an embedded HTTP server
 * on the device to serve tiles from MBTiles SQLite databases.
 * 
 * The server:
 * - Runs on localhost:8765 (or configurable port)
 * - Handles GET requests: /tiles/{chartId}/{z}/{x}/{y}.pbf (vector tiles)
 * - Handles GET requests: /tiles/{chartId}/{z}/{x}/{y}.png (raster tiles)
 * - Reads tile_data directly from MBTiles SQLite
 * - Returns gzipped MVT protobuf or PNG images with proper headers
 * 
 * MBTiles uses TMS y-coordinate which is handled in native code:
 * tmsY = (1 << z) - 1 - y
 */

import { NativeModules, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { logger, LogCategory } from './loggingService';

const { LocalTileServer } = NativeModules;

const DEFAULT_PORT = 8765;

interface TileServerOptions {
  port?: number;
  mbtilesDir?: string;
}

interface TileServerState {
  isRunning: boolean;
  serverUrl: string | null;
  port: number;
}

// Module-level state
const state: TileServerState = {
  isRunning: false,
  serverUrl: null,
  port: DEFAULT_PORT,
};

/**
 * Start the local tile server
 * 
 * @param options Configuration options
 * @returns The server base URL (e.g., "http://127.0.0.1:8765")
 */
export async function startTileServer(options: TileServerOptions = {}): Promise<string | null> {
  if (Platform.OS === 'web') {
    logger.debug(LogCategory.TILES, 'Not supported on web platform');
    return null;
  }

  if (!LocalTileServer) {
    logger.error(LogCategory.TILES, 'Native module not available');
    return null;
  }

  try {
    // Configure options - use internal storage (documentDirectory)
    const defaultDir = FileSystem.documentDirectory 
      ? `${FileSystem.documentDirectory}mbtiles`
      : 'file:///storage/emulated/0/Android/data/com.xnautical.app/files/mbtiles';
    const mbtilesDir = options.mbtilesDir || defaultDir;
    const port = options.port || DEFAULT_PORT;

    logger.info(LogCategory.TILES, `[DIAG] Requested mbtilesDir: ${mbtilesDir}`);

    // Check if already running - stop and restart to ensure correct directory
    const isRunning = await LocalTileServer.isRunning();
    if (isRunning) {
      logger.info(LogCategory.TILES, `Server already running - stopping to restart with correct directory`);
      await LocalTileServer.stop();
    }

    // Start the native server (fresh start ensures correct directory)
    const serverUrl = await LocalTileServer.start({
      port,
      mbtilesDir,
    });

    state.isRunning = true;
    state.serverUrl = serverUrl;
    state.port = port;

    logger.info(LogCategory.TILES, `Started at: ${serverUrl}`);
    return serverUrl;
  } catch (error) {
    logger.error(LogCategory.TILES, 'Failed to start', error as Error);
    return null;
  }
}

/**
 * Stop the local tile server
 */
export async function stopTileServer(): Promise<void> {
  if (Platform.OS === 'web') {
    return;
  }

  if (!LocalTileServer) {
    return;
  }

  try {
    await LocalTileServer.stop();
    state.isRunning = false;
    state.serverUrl = null;
    logger.info(LogCategory.TILES, 'Stopped');
  } catch (error) {
    logger.error(LogCategory.TILES, 'Failed to stop', error as Error);
  }
}

/**
 * Check if the tile server is running
 */
export async function isServerRunning(): Promise<boolean> {
  if (Platform.OS === 'web' || !LocalTileServer) {
    return false;
  }

  try {
    return await LocalTileServer.isRunning();
  } catch (error) {
    logger.error(LogCategory.TILES, 'Error checking server status', error as Error);
    return false;
  }
}

/**
 * Get the tile server base URL
 */
export function getTileServerUrl(): string {
  return state.serverUrl || `http://127.0.0.1:${state.port}`;
}

/**
 * Get the tile URL template for a chart
 * Returns a URL template suitable for use with Mapbox VectorSource
 * 
 * @param chartId The chart ID (e.g., "US5AK5QG")
 * @returns URL template like "http://127.0.0.1:8765/tiles/US5AK5QG/{z}/{x}/{y}.pbf"
 */
export function getTileUrlTemplate(chartId: string): string {
  return `${getTileServerUrl()}/tiles/${chartId}/{z}/{x}/{y}.pbf`;
}

/**
 * Get the composite tile URL template (no chartId - server does quilting)
 * Returns a URL template suitable for use with a single Mapbox VectorSource
 * The native server automatically selects the best chart for each tile request
 * 
 * @returns URL template like "http://127.0.0.1:8765/tiles/{z}/{x}/{y}.pbf"
 */
export function getCompositeTileUrl(): string {
  return `${getTileServerUrl()}/tiles/{z}/{x}/{y}.pbf`;
}

/**
 * Get the composite tile URL template asynchronously from native module
 */
export async function getCompositeTileUrlAsync(): Promise<string> {
  if (Platform.OS === 'web' || !LocalTileServer) {
    return getCompositeTileUrl();
  }

  try {
    return await LocalTileServer.getCompositeTileUrl();
  } catch (error) {
    console.error('[TileServer] Error getting composite tile URL:', error);
    return getCompositeTileUrl();
  }
}

/**
 * Get the tile URL template asynchronously from native module
 * This ensures the URL uses the correct port even if it was auto-assigned
 */
export async function getTileUrlTemplateAsync(chartId: string): Promise<string> {
  if (Platform.OS === 'web' || !LocalTileServer) {
    return getTileUrlTemplate(chartId);
  }

  try {
    return await LocalTileServer.getTileUrlTemplate(chartId);
  } catch (error) {
    console.error('[TileServer] Error getting tile URL template:', error);
    return getTileUrlTemplate(chartId);
  }
}

/**
 * Get the raster tile URL template for a chart (PNG format)
 * Returns a URL template suitable for use with Mapbox RasterSource
 * 
 * @param chartId The chart ID (e.g., "BATHY_TEST")
 * @returns URL template like "http://127.0.0.1:8765/tiles/BATHY_TEST/{z}/{x}/{y}.png"
 */
export function getRasterTileUrlTemplate(chartId: string): string {
  return `${getTileServerUrl()}/tiles/${chartId}/{z}/{x}/{y}.png`;
}

/**
 * Get the raster tile URL template asynchronously from native module
 * This ensures the URL uses the correct port even if it was auto-assigned
 */
export async function getRasterTileUrlTemplateAsync(chartId: string): Promise<string> {
  if (Platform.OS === 'web' || !LocalTileServer) {
    return getRasterTileUrlTemplate(chartId);
  }

  try {
    return await LocalTileServer.getRasterTileUrlTemplate(chartId);
  } catch (error) {
    console.error('[TileServer] Error getting raster tile URL template:', error);
    return getRasterTileUrlTemplate(chartId);
  }
}

/**
 * Pre-load databases for faster tile serving
 * Note: This is handled automatically by the native module on first tile request,
 * but can be called explicitly to warm up the database connections
 */
export async function preloadDatabases(chartIds: string[]): Promise<void> {
  // The native module automatically opens databases on demand and caches them
  // This function is a no-op but kept for API compatibility
  console.log('[TileServer] Databases will be opened on demand:', chartIds);
}

/**
 * Clear cached database connections
 * This forces the tile server to re-open MBTiles files on next request,
 * picking up any changes to the files.
 * 
 * @returns Number of database connections that were closed
 */
export async function clearCache(): Promise<number> {
  if (Platform.OS === 'web' || !LocalTileServer) {
    return 0;
  }

  try {
    const closedCount = await LocalTileServer.clearCache();
    console.log('[TileServer] Cache cleared, closed', closedCount, 'connections');
    return closedCount;
  } catch (error) {
    console.error('[TileServer] Error clearing cache:', error);
    return 0;
  }
}

/**
 * Get metadata from an MBTiles file
 * Note: This reads from the database via the native reader
 */
export async function getMetadata(chartId: string): Promise<Record<string, string> | null> {
  // Import mbtilesReader for metadata access
  // The tile server doesn't need to expose this - use mbtilesReader directly
  try {
    const mbtilesReader = await import('./mbtilesReader');
    return mbtilesReader.getMetadata(chartId);
  } catch (error) {
    console.error('[TileServer] Error getting metadata:', error);
    return null;
  }
}

/**
 * Get list of available vector layers in an MBTiles file
 */
export async function getVectorLayers(chartId: string): Promise<string[]> {
  const metadata = await getMetadata(chartId);
  if (!metadata?.json) {
    return [chartId]; // Default to chart ID as layer name
  }

  try {
    const json = JSON.parse(metadata.json);
    if (json.vector_layers) {
      return json.vector_layers.map((l: { id: string }) => l.id);
    }
  } catch (e) {
    console.error('[TileServer] Error parsing vector_layers:', e);
  }

  return [chartId];
}

/**
 * Get the MBTiles directory path
 * Uses internal storage (documentDirectory) for reliability
 */
export function getMBTilesDir(): string {
  if (FileSystem.documentDirectory) {
    return `${FileSystem.documentDirectory}mbtiles`;
  }
  // Fallback for edge cases
  return 'file:///storage/emulated/0/Android/data/com.xnautical.app/files/mbtiles';
}

// Export a convenience object for the tile server
export default {
  startTileServer,
  stopTileServer,
  isServerRunning,
  getTileServerUrl,
  getTileUrlTemplate,
  getTileUrlTemplateAsync,
  getRasterTileUrlTemplate,
  getRasterTileUrlTemplateAsync,
  getCompositeTileUrl,
  getCompositeTileUrlAsync,
  preloadDatabases,
  clearCache,
  getMetadata,
  getVectorLayers,
  getMBTilesDir,
};

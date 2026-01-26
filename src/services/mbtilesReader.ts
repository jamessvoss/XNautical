/**
 * MBTiles Reader - Reads vector tiles from MBTiles SQLite databases
 * and converts them to GeoJSON for rendering with ShapeSource
 * 
 * MBTiles is a SQLite database with:
 * - tiles table: zoom_level, tile_column, tile_row, tile_data (gzipped MVT)
 * - metadata table: name/value pairs
 */

import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import pako from 'pako';
import * as chartCacheService from './chartCacheService';
import { GeoJSONFeatureCollection } from '../types/chart';

// Protobuf decoder for MVT (Mapbox Vector Tiles)
// This is a simplified decoder - in production you'd use a proper MVT library

interface MBTilesDatabase {
  db: SQLite.SQLiteDatabase;
  chartId: string;
  metadata: Record<string, string>;
}

const openDatabases: Map<string, MBTilesDatabase> = new Map();

/**
 * Open an MBTiles database
 */
export async function openDatabase(chartId: string): Promise<MBTilesDatabase | null> {
  if (openDatabases.has(chartId)) {
    return openDatabases.get(chartId)!;
  }

  try {
    const mbtilesPath = chartCacheService.getMBTilesPath(chartId);
    
    // Check if file exists
    const fileInfo = await FileSystem.getInfoAsync(mbtilesPath);
    if (!fileInfo.exists) {
      console.error(`MBTiles file not found: ${mbtilesPath}`);
      return null;
    }

    console.log(`Opening MBTiles: ${mbtilesPath}`);

    // Open the database
    // expo-sqlite needs special handling for arbitrary file paths
    // We'll copy to a known location if needed
    const dbName = `mbtiles_${chartId}.db`;
    
    // Check if we need to copy the file
    const dbPath = `${FileSystem.documentDirectory}SQLite/${dbName}`;
    const dbDir = `${FileSystem.documentDirectory}SQLite`;
    
    // Ensure SQLite directory exists
    const dirInfo = await FileSystem.getInfoAsync(dbDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(dbDir, { intermediates: true });
    }

    // Copy MBTiles to SQLite directory if not already there
    const dbFileInfo = await FileSystem.getInfoAsync(dbPath);
    if (!dbFileInfo.exists) {
      console.log(`Copying MBTiles to SQLite directory: ${dbPath}`);
      await FileSystem.copyAsync({ from: mbtilesPath, to: dbPath });
    }

    // Open database
    const db = await SQLite.openDatabaseAsync(dbName);
    
    // Load metadata
    const metadata: Record<string, string> = {};
    try {
      const rows = await db.getAllAsync<{ name: string; value: string }>(
        'SELECT name, value FROM metadata'
      );
      for (const row of rows) {
        metadata[row.name] = row.value;
      }
    } catch (e) {
      console.warn('Could not read metadata:', e);
    }

    const mbtilesDb: MBTilesDatabase = { db, chartId, metadata };
    openDatabases.set(chartId, mbtilesDb);
    
    console.log(`Opened MBTiles for ${chartId}, metadata:`, metadata);
    return mbtilesDb;
  } catch (error) {
    console.error(`Error opening MBTiles for ${chartId}:`, error);
    return null;
  }
}

/**
 * Close a database
 */
export async function closeDatabase(chartId: string): Promise<void> {
  const mbtilesDb = openDatabases.get(chartId);
  if (mbtilesDb) {
    try {
      await mbtilesDb.db.closeAsync();
      openDatabases.delete(chartId);
    } catch (e) {
      console.error(`Error closing database for ${chartId}:`, e);
    }
  }
}

/**
 * Get raw tile data from MBTiles
 */
export async function getRawTile(
  chartId: string,
  z: number,
  x: number,
  y: number
): Promise<Uint8Array | null> {
  const mbtilesDb = await openDatabase(chartId);
  if (!mbtilesDb) return null;

  try {
    // MBTiles uses TMS y-coordinate (flipped)
    const tmsY = (1 << z) - 1 - y;

    const result = await mbtilesDb.db.getFirstAsync<{ tile_data: ArrayBuffer }>(
      'SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?',
      [z, x, tmsY]
    );

    if (result?.tile_data) {
      return new Uint8Array(result.tile_data);
    }
    return null;
  } catch (error) {
    console.error(`Error getting tile ${chartId}/${z}/${x}/${y}:`, error);
    return null;
  }
}

/**
 * Get tile bounds for a specific zoom level
 */
export async function getTileBounds(
  chartId: string,
  z: number
): Promise<{ minX: number; maxX: number; minY: number; maxY: number } | null> {
  const mbtilesDb = await openDatabase(chartId);
  if (!mbtilesDb) return null;

  try {
    const result = await mbtilesDb.db.getFirstAsync<{
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
    }>(
      `SELECT 
        MIN(tile_column) as minX, 
        MAX(tile_column) as maxX,
        MIN(tile_row) as minY,
        MAX(tile_row) as maxY
      FROM tiles WHERE zoom_level = ?`,
      [z]
    );
    return result || null;
  } catch (error) {
    console.error(`Error getting tile bounds for ${chartId}:`, error);
    return null;
  }
}

/**
 * Get available zoom levels in the MBTiles
 */
export async function getZoomLevels(chartId: string): Promise<number[]> {
  const mbtilesDb = await openDatabase(chartId);
  if (!mbtilesDb) return [];

  try {
    const results = await mbtilesDb.db.getAllAsync<{ zoom_level: number }>(
      'SELECT DISTINCT zoom_level FROM tiles ORDER BY zoom_level'
    );
    return results.map(r => r.zoom_level);
  } catch (error) {
    console.error(`Error getting zoom levels for ${chartId}:`, error);
    return [];
  }
}

/**
 * Get tile count
 */
export async function getTileCount(chartId: string): Promise<number> {
  const mbtilesDb = await openDatabase(chartId);
  if (!mbtilesDb) return 0;

  try {
    const result = await mbtilesDb.db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM tiles'
    );
    return result?.count || 0;
  } catch (error) {
    console.error(`Error getting tile count for ${chartId}:`, error);
    return 0;
  }
}

/**
 * Get metadata for a chart
 */
export async function getMetadata(chartId: string): Promise<Record<string, string> | null> {
  const mbtilesDb = await openDatabase(chartId);
  return mbtilesDb?.metadata || null;
}

/**
 * Check if an MBTiles file is valid
 */
export async function isValidMBTiles(chartId: string): Promise<boolean> {
  try {
    const mbtilesDb = await openDatabase(chartId);
    if (!mbtilesDb) return false;

    // Check if tiles table exists and has data
    const count = await getTileCount(chartId);
    return count > 0;
  } catch (error) {
    console.error(`Error validating MBTiles for ${chartId}:`, error);
    return false;
  }
}

/**
 * Chart Pack Service
 * 
 * Manages chart pack discovery and metadata.
 * Currently reads from local manifest.json in the mbtiles directory.
 * Future: fetch remote manifest for available downloads.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { ChartPackManifest, ChartPack, InstalledChartPack, BasePack } from '../types/chartPack';

// ALWAYS use external storage - survives app uninstall
const MBTILES_DIR = 'file:///storage/emulated/0/Android/data/com.xnautical.app/files/mbtiles/';

/**
 * Get the mbtiles directory - always external storage
 */
async function getMBTilesDir(): Promise<string> {
  return MBTILES_DIR;
}

/**
 * Get the local manifest of installed chart packs.
 * The manifest.json file should be pushed alongside .mbtiles files.
 */
export async function getLocalManifest(): Promise<ChartPackManifest | null> {
  try {
    const mbtilesDir = await getMBTilesDir();
    const manifestFile = `${mbtilesDir}manifest.json`;
    
    const fileInfo = await FileSystem.getInfoAsync(manifestFile);
    if (!fileInfo.exists) {
      console.log('[ChartPackService] No local manifest found at', manifestFile);
      return null;
    }

    const content = await FileSystem.readAsStringAsync(manifestFile);
    const manifest: ChartPackManifest = JSON.parse(content);
    console.log('[ChartPackService] Loaded manifest with', manifest.packs.length, 'packs from', mbtilesDir);
    return manifest;
  } catch (error) {
    console.error('[ChartPackService] Error reading local manifest:', error);
    return null;
  }
}

/**
 * Get installed base packs (e.g., place names).
 * These should be loaded automatically with any chart pack.
 */
export async function getInstalledBasePacks(): Promise<BasePack[]> {
  const manifest = await getLocalManifest();
  if (!manifest || !manifest.basePacks) {
    return [];
  }

  const mbtilesDir = await getMBTilesDir();
  const installedBasePacks: BasePack[] = [];

  for (const pack of manifest.basePacks) {
    const filePath = `${mbtilesDir}${pack.id}.mbtiles`;
    const fileInfo = await FileSystem.getInfoAsync(filePath);

    if (fileInfo.exists) {
      installedBasePacks.push(pack);
    }
  }

  console.log('[ChartPackService] Found', installedBasePacks.length, 'installed base packs');
  return installedBasePacks;
}

/**
 * Get list of installed chart packs.
 * Cross-references manifest with actual files on disk.
 */
export async function getInstalledPacks(): Promise<InstalledChartPack[]> {
  const manifest = await getLocalManifest();
  if (!manifest) {
    return [];
  }

  const mbtilesDir = await getMBTilesDir();
  const installedPacks: InstalledChartPack[] = [];

  for (const pack of manifest.packs) {
    const filePath = `${mbtilesDir}${pack.id}.mbtiles`;
    const fileInfo = await FileSystem.getInfoAsync(filePath);

    if (fileInfo.exists) {
      installedPacks.push({
        ...pack,
        installedAt: new Date().toISOString(), // We don't track this yet
        localPath: filePath,
      });
    }
  }

  console.log('[ChartPackService] Found', installedPacks.length, 'installed packs');
  return installedPacks;
}

/**
 * Get a specific installed pack by ID.
 */
export async function getInstalledPack(packId: string): Promise<InstalledChartPack | null> {
  const packs = await getInstalledPacks();
  return packs.find(p => p.id === packId) || null;
}

/**
 * Check if a pack is installed locally.
 */
export async function isPackInstalled(packId: string): Promise<boolean> {
  const mbtilesDir = await getMBTilesDir();
  const filePath = `${mbtilesDir}${packId}.mbtiles`;
  const fileInfo = await FileSystem.getInfoAsync(filePath);
  return fileInfo.exists;
}

/**
 * Get the tile URL template for a chart pack.
 * Use this to configure Mapbox sources.
 */
export function getPackTileUrl(packId: string, port: number = 8765): string {
  return `http://127.0.0.1:${port}/tiles/${packId}/{z}/{x}/{y}.pbf`;
}

/**
 * Format file size for display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Get all tile sources to load for a chart pack.
 * Returns the chart pack URL plus all base pack URLs.
 */
export async function getTileSourcesForPack(
  chartPackId: string,
  port: number = 8765
): Promise<{ charts: string; basePacks: { id: string; url: string; layer: string }[] }> {
  const basePacks = await getInstalledBasePacks();
  
  return {
    charts: getPackTileUrl(chartPackId, port),
    basePacks: basePacks.map(bp => ({
      id: bp.id,
      url: getPackTileUrl(bp.id, port),
      layer: bp.layer,
    })),
  };
}

// Future: Add remote manifest fetching
// export async function getRemoteManifest(): Promise<ChartPackManifest | null> {
//   const response = await fetch('https://your-storage.com/charts/manifest.json');
//   return response.json();
// }

// Future: Add pack downloading
// export async function downloadPack(pack: ChartPack, onProgress: (progress: number) => void): Promise<void> {
//   // Download from pack.downloadUrl to MBTILES_DIR
// }

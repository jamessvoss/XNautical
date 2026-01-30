/**
 * Chart Cache Service - Handles local storage of downloaded chart data
 * Uses expo-file-system for large GeoJSON files and AsyncStorage for metadata
 */

import { documentDirectory, makeDirectoryAsync, getInfoAsync, readDirectoryAsync, writeAsStringAsync, readAsStringAsync, deleteAsync } from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ChartMetadata,
  ChartDownloadStatus,
  FeatureType,
  RegionId,
  GeoJSONFeatureCollection,
  CacheStatus,
  ALL_FEATURE_TYPES
} from '../types/chart';

// Storage keys
const STORAGE_KEYS = {
  DOWNLOADED_CHARTS: '@XNautical:downloadedCharts',
  DOWNLOADED_MBTILES: '@XNautical:downloadedMBTiles',
  CHART_METADATA_CACHE: '@XNautical:chartMetadataCache',
  REGIONS_CACHE: '@XNautical:regionsCache',
} as const;

// Base directory for chart data - persistent external storage (survives app uninstall)
const EXTERNAL_BASE = 'file:///storage/emulated/0/Android/data/com.xnautical.app/files/';
const CHARTS_DIR = `${EXTERNAL_BASE}charts/`;
const MBTILES_DIR = `${EXTERNAL_BASE}mbtiles/`;

/**
 * Initialize the cache directories (charts and mbtiles)
 */
export async function initializeCache(): Promise<void> {
  try {
    const chartsDirInfo = await getInfoAsync(CHARTS_DIR);
    if (!chartsDirInfo.exists) {
      await makeDirectoryAsync(CHARTS_DIR, { intermediates: true });
    }
    
    const mbtilesDirInfo = await getInfoAsync(MBTILES_DIR);
    if (!mbtilesDirInfo.exists) {
      await makeDirectoryAsync(MBTILES_DIR, { intermediates: true });
    }
  } catch (error) {
    console.error('Error initializing cache directory:', error);
    throw error;
  }
}

/**
 * Get the file path for a chart feature
 */
function getFeatureFilePath(chartId: string, featureType: FeatureType): string {
  return `${CHARTS_DIR}${chartId}/${featureType}.json`;
}

/**
 * Get the directory path for a chart
 */
function getChartDirPath(chartId: string): string {
  return `${CHARTS_DIR}${chartId}/`;
}

/**
 * Check if a chart is cached locally
 */
export async function isChartCached(chartId: string): Promise<boolean> {
  try {
    const downloadedCharts = await getDownloadedChartIds();
    return downloadedCharts.includes(chartId);
  } catch (error) {
    console.error('Error checking chart cache:', error);
    return false;
  }
}

/**
 * Get list of all downloaded chart IDs
 */
export async function getDownloadedChartIds(): Promise<string[]> {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEYS.DOWNLOADED_CHARTS);
    return json ? JSON.parse(json) : [];
  } catch (error) {
    console.error('Error getting downloaded chart IDs:', error);
    return [];
  }
}

/**
 * Get download status for a chart
 */
export async function getChartDownloadStatus(chartId: string): Promise<ChartDownloadStatus> {
  try {
    const isDownloaded = await isChartCached(chartId);
    
    if (!isDownloaded) {
      return {
        chartId,
        isDownloaded: false,
      };
    }
    
    // Get list of downloaded feature types
    const chartDir = getChartDirPath(chartId);
    const dirInfo = await getInfoAsync(chartDir);
    
    if (!dirInfo.exists) {
      return {
        chartId,
        isDownloaded: false,
      };
    }
    
    const files = await readDirectoryAsync(chartDir);
    const featureTypes = files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', '') as FeatureType);
    
    // Calculate total size
    let totalSize = 0;
    for (const file of files) {
      const fileInfo = await getInfoAsync(`${chartDir}${file}`);
      if (fileInfo.exists && 'size' in fileInfo) {
        totalSize += fileInfo.size || 0;
      }
    }
    
    return {
      chartId,
      isDownloaded: true,
      downloadedAt: new Date(), // We don't track exact time, use current
      sizeBytes: totalSize,
      featureTypes,
    };
  } catch (error) {
    console.error('Error getting chart download status:', error);
    return {
      chartId,
      isDownloaded: false,
    };
  }
}

/**
 * Save a feature to local storage
 */
export async function saveChartFeature(
  chartId: string,
  featureType: FeatureType,
  data: GeoJSONFeatureCollection
): Promise<void> {
  try {
    // Ensure chart directory exists
    const chartDir = getChartDirPath(chartId);
    const dirInfo = await getInfoAsync(chartDir);
    if (!dirInfo.exists) {
      await makeDirectoryAsync(chartDir, { intermediates: true });
    }
    
    // Write the JSON file
    const filePath = getFeatureFilePath(chartId, featureType);
    await writeAsStringAsync(filePath, JSON.stringify(data));
  } catch (error) {
    console.error(`Error saving ${featureType} for ${chartId}:`, error);
    throw error;
  }
}

/**
 * Save all features for a chart and mark as downloaded
 */
export async function saveChart(
  chartId: string,
  features: Partial<Record<FeatureType, GeoJSONFeatureCollection>>
): Promise<void> {
  try {
    // Save each feature type
    for (const [featureType, data] of Object.entries(features)) {
      if (data) {
        await saveChartFeature(chartId, featureType as FeatureType, data);
      }
    }
    
    // Mark chart as downloaded
    const downloadedCharts = await getDownloadedChartIds();
    if (!downloadedCharts.includes(chartId)) {
      downloadedCharts.push(chartId);
      await AsyncStorage.setItem(
        STORAGE_KEYS.DOWNLOADED_CHARTS,
        JSON.stringify(downloadedCharts)
      );
    }
  } catch (error) {
    console.error(`Error saving chart ${chartId}:`, error);
    throw error;
  }
}

/**
 * Load a feature from local storage
 */
export async function loadChartFeature(
  chartId: string,
  featureType: FeatureType
): Promise<GeoJSONFeatureCollection | null> {
  try {
    const filePath = getFeatureFilePath(chartId, featureType);
    const fileInfo = await getInfoAsync(filePath);
    
    if (!fileInfo.exists) {
      return null;
    }
    
    const jsonString = await readAsStringAsync(filePath);
    return JSON.parse(jsonString) as GeoJSONFeatureCollection;
  } catch (error) {
    console.error(`Error loading ${featureType} for ${chartId}:`, error);
    return null;
  }
}

/**
 * Load all features for a chart
 */
export async function loadChart(
  chartId: string
): Promise<Partial<Record<FeatureType, GeoJSONFeatureCollection>>> {
  const results: Partial<Record<FeatureType, GeoJSONFeatureCollection>> = {};
  
  for (const featureType of ALL_FEATURE_TYPES) {
    const data = await loadChartFeature(chartId, featureType);
    if (data) {
      results[featureType] = data;
    }
  }
  
  return results;
}

/**
 * Delete a chart from local storage
 */
export async function deleteChart(chartId: string): Promise<void> {
  try {
    // Delete the chart directory
    const chartDir = getChartDirPath(chartId);
    const dirInfo = await getInfoAsync(chartDir);
    
    if (dirInfo.exists) {
      await deleteAsync(chartDir, { idempotent: true });
    }
    
    // Remove from downloaded list
    const downloadedCharts = await getDownloadedChartIds();
    const filtered = downloadedCharts.filter(id => id !== chartId);
    await AsyncStorage.setItem(
      STORAGE_KEYS.DOWNLOADED_CHARTS,
      JSON.stringify(filtered)
    );
  } catch (error) {
    console.error(`Error deleting chart ${chartId}:`, error);
    throw error;
  }
}

/**
 * Delete all cached charts
 */
export async function clearAllCharts(): Promise<void> {
  try {
    // Delete the entire charts directory
    const dirInfo = await getInfoAsync(CHARTS_DIR);
    if (dirInfo.exists) {
      await deleteAsync(CHARTS_DIR, { idempotent: true });
    }
    
    // Recreate empty directory
    await makeDirectoryAsync(CHARTS_DIR, { intermediates: true });
    
    // Clear downloaded list
    await AsyncStorage.setItem(STORAGE_KEYS.DOWNLOADED_CHARTS, JSON.stringify([]));
  } catch (error) {
    console.error('Error clearing all charts:', error);
    throw error;
  }
}

/**
 * Get total cache size in bytes
 */
export async function getCacheSize(): Promise<number> {
  try {
    const dirInfo = await getInfoAsync(CHARTS_DIR);
    if (!dirInfo.exists) {
      return 0;
    }
    
    let totalSize = 0;
    const chartDirs = await readDirectoryAsync(CHARTS_DIR);
    
    for (const chartId of chartDirs) {
      const chartDir = `${CHARTS_DIR}${chartId}/`;
      const chartDirInfo = await getInfoAsync(chartDir);
      
      if (chartDirInfo.exists && chartDirInfo.isDirectory) {
        const files = await readDirectoryAsync(chartDir);
        
        for (const file of files) {
          const fileInfo = await getInfoAsync(`${chartDir}${file}`);
          if (fileInfo.exists && 'size' in fileInfo) {
            totalSize += fileInfo.size || 0;
          }
        }
      }
    }
    
    return totalSize;
  } catch (error) {
    console.error('Error calculating cache size:', error);
    return 0;
  }
}

/**
 * Get cache status summary
 */
export async function getCacheStatus(
  allCharts: ChartMetadata[]
): Promise<CacheStatus> {
  try {
    const downloadedChartIds = await getDownloadedChartIds();
    const cacheSize = await getCacheSize();
    
    // Group by region
    const chartsByRegion: Record<RegionId, { total: number; downloaded: number }> = {
      overview: { total: 0, downloaded: 0 },
      southeast: { total: 0, downloaded: 0 },
      southcentral: { total: 0, downloaded: 0 },
      southwest: { total: 0, downloaded: 0 },
      western: { total: 0, downloaded: 0 },
      arctic: { total: 0, downloaded: 0 },
      interior: { total: 0, downloaded: 0 },
    };
    
    let totalSize = 0;
    
    for (const chart of allCharts) {
      const region = chart.region;
      if (chartsByRegion[region]) {
        chartsByRegion[region].total++;
        totalSize += chart.fileSizeBytes || 0;
        
        if (downloadedChartIds.includes(chart.chartId)) {
          chartsByRegion[region].downloaded++;
        }
      }
    }
    
    return {
      totalCharts: allCharts.length,
      downloadedCharts: downloadedChartIds.length,
      totalSizeBytes: totalSize,
      downloadedSizeBytes: cacheSize,
      chartsByRegion,
    };
  } catch (error) {
    console.error('Error getting cache status:', error);
    throw error;
  }
}

/**
 * Cache chart metadata for offline access
 */
export async function cacheChartMetadata(charts: ChartMetadata[]): Promise<void> {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEYS.CHART_METADATA_CACHE,
      JSON.stringify(charts)
    );
  } catch (error) {
    console.error('Error caching chart metadata:', error);
  }
}

/**
 * Get cached chart metadata
 */
export async function getCachedChartMetadata(): Promise<ChartMetadata[] | null> {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEYS.CHART_METADATA_CACHE);
    return json ? JSON.parse(json) : null;
  } catch (error) {
    console.error('Error getting cached chart metadata:', error);
    return null;
  }
}

// ============================================
// MBTiles Cache Functions
// ============================================

/**
 * Get the file path for an MBTiles file
 */
export function getMBTilesPath(chartId: string): string {
  return `${MBTILES_DIR}${chartId}.mbtiles`;
}

/**
 * Get the MBTiles directory path
 */
export function getMBTilesDir(): string {
  return MBTILES_DIR;
}

/**
 * Check if an MBTiles file exists for a chart
 */
export async function hasMBTiles(chartId: string): Promise<boolean> {
  try {
    const filePath = getMBTilesPath(chartId);
    const fileInfo = await getInfoAsync(filePath);
    return fileInfo.exists;
  } catch (error) {
    console.error(`Error checking MBTiles for ${chartId}:`, error);
    return false;
  }
}

/**
 * Get list of all downloaded MBTiles chart IDs
 */
export async function getDownloadedMBTilesIds(): Promise<string[]> {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEYS.DOWNLOADED_MBTILES);
    return json ? JSON.parse(json) : [];
  } catch (error) {
    console.error('Error getting downloaded MBTiles IDs:', error);
    return [];
  }
}

/**
 * Mark an MBTiles chart as downloaded
 */
export async function markMBTilesDownloaded(chartId: string): Promise<void> {
  try {
    const downloadedCharts = await getDownloadedMBTilesIds();
    if (!downloadedCharts.includes(chartId)) {
      downloadedCharts.push(chartId);
      await AsyncStorage.setItem(
        STORAGE_KEYS.DOWNLOADED_MBTILES,
        JSON.stringify(downloadedCharts)
      );
    }
  } catch (error) {
    console.error(`Error marking MBTiles downloaded for ${chartId}:`, error);
    throw error;
  }
}

/**
 * Delete an MBTiles file
 */
export async function deleteMBTiles(chartId: string): Promise<void> {
  try {
    const filePath = getMBTilesPath(chartId);
    const fileInfo = await getInfoAsync(filePath);
    
    if (fileInfo.exists) {
      await deleteAsync(filePath, { idempotent: true });
    }
    
    // Remove from downloaded list
    const downloadedCharts = await getDownloadedMBTilesIds();
    const filtered = downloadedCharts.filter(id => id !== chartId);
    await AsyncStorage.setItem(
      STORAGE_KEYS.DOWNLOADED_MBTILES,
      JSON.stringify(filtered)
    );
  } catch (error) {
    console.error(`Error deleting MBTiles for ${chartId}:`, error);
    throw error;
  }
}

/**
 * Delete all cached MBTiles files
 */
export async function clearAllMBTiles(): Promise<void> {
  try {
    const dirInfo = await getInfoAsync(MBTILES_DIR);
    if (dirInfo.exists) {
      await deleteAsync(MBTILES_DIR, { idempotent: true });
    }
    
    // Recreate empty directory
    await makeDirectoryAsync(MBTILES_DIR, { intermediates: true });
    
    // Clear downloaded list
    await AsyncStorage.setItem(STORAGE_KEYS.DOWNLOADED_MBTILES, JSON.stringify([]));
  } catch (error) {
    console.error('Error clearing all MBTiles:', error);
    throw error;
  }
}

/**
 * Get total MBTiles cache size in bytes
 */
export async function getMBTilesCacheSize(): Promise<number> {
  try {
    const dirInfo = await getInfoAsync(MBTILES_DIR);
    if (!dirInfo.exists) {
      return 0;
    }
    
    let totalSize = 0;
    const files = await readDirectoryAsync(MBTILES_DIR);
    
    for (const file of files) {
      if (file.endsWith('.mbtiles')) {
        const fileInfo = await getInfoAsync(`${MBTILES_DIR}${file}`);
        if (fileInfo.exists && 'size' in fileInfo) {
          totalSize += fileInfo.size || 0;
        }
      }
    }
    
    return totalSize;
  } catch (error) {
    console.error('Error calculating MBTiles cache size:', error);
    return 0;
  }
}

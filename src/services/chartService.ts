/**
 * Chart Service - Handles fetching chart metadata and downloading chart data from Firebase
 */

import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where,
  orderBy 
} from 'firebase/firestore';
import { ref, getBytes } from 'firebase/storage';
import pako from 'pako';
import { db, storage } from '../config/firebase';
import { 
  ChartRegion, 
  ChartMetadata, 
  RegionId, 
  FeatureType,
  GeoJSONFeatureCollection,
  ALL_FEATURE_TYPES
} from '../types/chart';

// Firestore collection names
const COLLECTIONS = {
  REGIONS: 'chart-regions',
  METADATA: 'chart-metadata',
  VERSIONS: 'chart-versions',
} as const;

/**
 * Fetch all available regions
 */
export async function getRegions(): Promise<ChartRegion[]> {
  try {
    const regionsRef = collection(db, COLLECTIONS.REGIONS);
    const snapshot = await getDocs(regionsRef);
    
    return snapshot.docs.map(doc => ({
      id: doc.id as RegionId,
      ...doc.data(),
      lastUpdated: doc.data().lastUpdated?.toDate() || new Date(),
    })) as ChartRegion[];
  } catch (error) {
    console.error('Error fetching regions:', error);
    throw error;
  }
}

/**
 * Fetch a single region by ID
 */
export async function getRegion(regionId: RegionId): Promise<ChartRegion | null> {
  try {
    const regionRef = doc(db, COLLECTIONS.REGIONS, regionId);
    const snapshot = await getDoc(regionRef);
    
    if (!snapshot.exists()) {
      return null;
    }
    
    const data = snapshot.data();
    return {
      id: snapshot.id as RegionId,
      ...data,
      lastUpdated: data.lastUpdated?.toDate() || new Date(),
    } as ChartRegion;
  } catch (error) {
    console.error('Error fetching region:', error);
    throw error;
  }
}

/**
 * Fetch all charts in a region
 */
export async function getChartsByRegion(regionId: RegionId): Promise<ChartMetadata[]> {
  try {
    const chartsRef = collection(db, COLLECTIONS.METADATA);
    const q = query(
      chartsRef, 
      where('region', '==', regionId),
      orderBy('scale', 'desc') // Harbor charts first (higher scale number)
    );
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map(doc => ({
      ...doc.data(),
      chartId: doc.id,
      lastUpdated: doc.data().lastUpdated?.toDate() || new Date(),
    })) as ChartMetadata[];
  } catch (error) {
    console.error('Error fetching charts by region:', error);
    throw error;
  }
}

/**
 * Fetch all available charts
 */
export async function getAllCharts(): Promise<ChartMetadata[]> {
  try {
    const chartsRef = collection(db, COLLECTIONS.METADATA);
    const snapshot = await getDocs(chartsRef);
    
    return snapshot.docs.map(doc => ({
      ...doc.data(),
      chartId: doc.id,
      lastUpdated: doc.data().lastUpdated?.toDate() || new Date(),
    })) as ChartMetadata[];
  } catch (error) {
    console.error('Error fetching all charts:', error);
    throw error;
  }
}

/**
 * Fetch charts that intersect with given bounds
 */
export async function getChartsInBounds(
  west: number, 
  south: number, 
  east: number, 
  north: number
): Promise<ChartMetadata[]> {
  try {
    // Firestore doesn't support geospatial queries well, so we fetch all and filter
    const allCharts = await getAllCharts();
    
    return allCharts.filter(chart => {
      if (!chart.bounds) return false;
      
      const [chartWest, chartSouth, chartEast, chartNorth] = chart.bounds;
      
      // Check if bounds intersect
      return !(
        chartEast < west ||
        chartWest > east ||
        chartNorth < south ||
        chartSouth > north
      );
    });
  } catch (error) {
    console.error('Error fetching charts in bounds:', error);
    throw error;
  }
}

/**
 * Fetch a single chart's metadata
 */
export async function getChartMetadata(chartId: string): Promise<ChartMetadata | null> {
  try {
    const chartRef = doc(db, COLLECTIONS.METADATA, chartId);
    const snapshot = await getDoc(chartRef);
    
    if (!snapshot.exists()) {
      return null;
    }
    
    const data = snapshot.data();
    return {
      ...data,
      chartId: snapshot.id,
      lastUpdated: data.lastUpdated?.toDate() || new Date(),
    } as ChartMetadata;
  } catch (error) {
    console.error('Error fetching chart metadata:', error);
    throw error;
  }
}

/**
 * Decompress gzip data using pako
 */
function decompressGzip(compressedData: ArrayBuffer): string {
  try {
    // Convert ArrayBuffer to Uint8Array for pako
    const compressed = new Uint8Array(compressedData);
    // Decompress and decode to string
    const decompressed = pako.inflate(compressed, { to: 'string' });
    return decompressed;
  } catch (error) {
    console.error('Gzip decompression failed:', error);
    // Try as uncompressed text as fallback
    const decoder = new TextDecoder();
    return decoder.decode(compressedData);
  }
}

/**
 * Download a single feature type for a chart
 */
export async function downloadChartFeature(
  chartId: string,
  region: RegionId,
  featureType: FeatureType
): Promise<GeoJSONFeatureCollection | null> {
  const storagePath = `charts/${region}/${chartId}/${featureType}.json.gz`;
  
  try {
    console.log(`Downloading: ${storagePath}`);
    const fileRef = ref(storage, storagePath);
    
    const compressedData = await getBytes(fileRef);
    console.log(`Got ${compressedData.byteLength} bytes for ${featureType}`);
    
    const jsonString = await decompressGzip(compressedData);
    console.log(`Decompressed to ${jsonString.length} chars for ${featureType}`);
    
    const geojson = JSON.parse(jsonString) as GeoJSONFeatureCollection;
    console.log(`Parsed ${geojson.features?.length || 0} features for ${featureType}`);
    
    return geojson;
  } catch (error: unknown) {
    // File might not exist for this chart (not all charts have all feature types)
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('object-not-found') || errorMessage.includes('404')) {
      console.log(`No ${featureType} file for ${chartId} at ${storagePath}`);
      return null;
    }
    console.error(`Error downloading ${featureType} for ${chartId}:`, error);
    throw error;
  }
}

/**
 * Download all features for a chart
 */
export async function downloadChart(
  chartId: string,
  region: RegionId,
  onProgress?: (featureType: FeatureType, downloaded: number, total: number) => void
): Promise<Partial<Record<FeatureType, GeoJSONFeatureCollection>>> {
  const results: Partial<Record<FeatureType, GeoJSONFeatureCollection>> = {};
  const total = ALL_FEATURE_TYPES.length;
  
  for (let i = 0; i < ALL_FEATURE_TYPES.length; i++) {
    const featureType = ALL_FEATURE_TYPES[i];
    
    if (onProgress) {
      onProgress(featureType, i, total);
    }
    
    try {
      const data = await downloadChartFeature(chartId, region, featureType);
      if (data && data.features && data.features.length > 0) {
        results[featureType] = data;
      }
    } catch (error) {
      console.warn(`Failed to download ${featureType} for ${chartId}:`, error);
      // Continue with other features
    }
  }
  
  if (onProgress) {
    onProgress('pipsol', total, total); // Signal completion
  }
  
  return results;
}

/**
 * Get the storage path for a chart feature
 */
export function getChartStoragePath(
  chartId: string, 
  region: RegionId, 
  featureType: FeatureType
): string {
  return `charts/${region}/${chartId}/${featureType}.json.gz`;
}

/**
 * Calculate total download size for a list of charts
 */
export function calculateTotalSize(charts: ChartMetadata[]): number {
  return charts.reduce((sum, chart) => sum + (chart.fileSizeBytes || 0), 0);
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

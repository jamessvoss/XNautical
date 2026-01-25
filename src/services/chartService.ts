/**
 * Chart Service - Handles fetching chart metadata and downloading chart data from Firebase
 */

import { Platform } from 'react-native';
import pako from 'pako';
import { 
  ChartRegion, 
  ChartMetadata, 
  RegionId, 
  FeatureType,
  GeoJSONFeatureCollection,
  ALL_FEATURE_TYPES
} from '../types/chart';

// Native Firebase modules (only on native platforms)
let firestore: any = null;
let storage: any = null;

if (Platform.OS !== 'web') {
  try {
    firestore = require('@react-native-firebase/firestore').default;
  } catch (e) {
    console.log('Native Firestore not available');
  }
  
  try {
    storage = require('@react-native-firebase/storage').default;
  } catch (e) {
    console.log('Native Storage not available');
  }
}

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
    if (!firestore) {
      throw new Error('Firestore not available');
    }
    
    // Log auth state for debugging
    let authModule: any = null;
    try {
      authModule = require('@react-native-firebase/auth').default;
      const currentUser = authModule().currentUser;
      console.log('getRegions - Auth state:', currentUser ? `Logged in as ${currentUser.email} (uid: ${currentUser.uid})` : 'NOT LOGGED IN');
    } catch (e) {
      console.log('getRegions - Could not check auth state');
    }
    
    console.log('getRegions - Fetching from collection:', COLLECTIONS.REGIONS);
    const snapshot = await firestore().collection(COLLECTIONS.REGIONS).get();
    console.log('getRegions - Got', snapshot.docs.length, 'documents');
    
    return snapshot.docs.map((doc: any) => ({
      id: doc.id as RegionId,
      ...doc.data(),
      lastUpdated: doc.data().lastUpdated?.toDate() || new Date(),
    })) as ChartRegion[];
  } catch (error: any) {
    console.error('Error fetching regions:', error);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    throw error;
  }
}

/**
 * Fetch a single region by ID
 */
export async function getRegion(regionId: RegionId): Promise<ChartRegion | null> {
  try {
    if (!firestore) {
      throw new Error('Firestore not available');
    }
    
    const snapshot = await firestore()
      .collection(COLLECTIONS.REGIONS)
      .doc(regionId)
      .get();
    
    if (!snapshot.exists) {
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
    if (!firestore) {
      throw new Error('Firestore not available');
    }
    
    const snapshot = await firestore()
      .collection(COLLECTIONS.METADATA)
      .where('region', '==', regionId)
      .orderBy('scale', 'desc') // Harbor charts first (higher scale number)
      .get();
    
    return snapshot.docs.map((doc: any) => ({
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
    if (!firestore) {
      throw new Error('Firestore not available');
    }
    
    // Log auth state for debugging
    let authModule: any = null;
    try {
      authModule = require('@react-native-firebase/auth').default;
      const currentUser = authModule().currentUser;
      console.log('getAllCharts - Auth state:', currentUser ? `Logged in as ${currentUser.email} (uid: ${currentUser.uid})` : 'NOT LOGGED IN');
    } catch (e) {
      console.log('getAllCharts - Could not check auth state');
    }
    
    console.log('getAllCharts - Fetching from collection:', COLLECTIONS.METADATA);
    const snapshot = await firestore().collection(COLLECTIONS.METADATA).get();
    console.log('getAllCharts - Got', snapshot.docs.length, 'documents');
    
    return snapshot.docs.map((doc: any) => ({
      ...doc.data(),
      chartId: doc.id,
      lastUpdated: doc.data().lastUpdated?.toDate() || new Date(),
    })) as ChartMetadata[];
  } catch (error: any) {
    console.error('Error fetching all charts:', error);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
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
    if (!firestore) {
      throw new Error('Firestore not available');
    }
    
    const snapshot = await firestore()
      .collection(COLLECTIONS.METADATA)
      .doc(chartId)
      .get();
    
    if (!snapshot.exists) {
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
    if (!storage) {
      throw new Error('Native Storage not available');
    }
    
    // Log auth state for debugging
    try {
      const authModule = require('@react-native-firebase/auth').default;
      const currentUser = authModule().currentUser;
      console.log(`downloadChartFeature - Auth: ${currentUser ? currentUser.email : 'NOT LOGGED IN'}`);
    } catch (e) {
      console.log('downloadChartFeature - Could not check auth');
    }
    
    console.log(`Downloading: ${storagePath}`);
    const fileRef = storage().ref(storagePath);
    
    // Download to a data URL and extract the base64 data
    const downloadUrl = await fileRef.getDownloadURL();
    console.log(`Got download URL for ${featureType}`);
    
    // Fetch the file data
    const response = await fetch(downloadUrl);
    const arrayBuffer = await response.arrayBuffer();
    console.log(`Got ${arrayBuffer.byteLength} bytes for ${featureType}`);
    
    const jsonString = decompressGzip(arrayBuffer);
    console.log(`Decompressed to ${jsonString.length} chars for ${featureType}`);
    
    const geojson = JSON.parse(jsonString) as GeoJSONFeatureCollection;
    console.log(`Parsed ${geojson.features?.length || 0} features for ${featureType}`);
    
    return geojson;
  } catch (error: unknown) {
    // File might not exist for this chart (not all charts have all feature types)
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('object-not-found') || errorMessage.includes('404') || errorMessage.includes('does not exist')) {
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

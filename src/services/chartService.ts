/**
 * Chart Service - Handles fetching chart metadata and downloading chart data from Firebase
 * Uses the modular API (React Native Firebase v22+)
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
import { documentDirectory, makeDirectoryAsync, getInfoAsync, writeAsStringAsync } from 'expo-file-system/legacy';
import * as chartCacheService from './chartCacheService';
import { logger, LogCategory } from './loggingService';

// Modular Firebase imports (only on native platforms)
let firestoreDb: any = null;
let firestoreFns: {
  collection: (db: any, path: string) => any;
  doc: (db: any, path: string, id: string) => any;
  getDocs: (query: any) => Promise<any>;
  getDoc: (docRef: any) => Promise<any>;
  query: (collectionRef: any, ...constraints: any[]) => any;
  where: (field: string, op: string, value: any) => any;
  orderBy: (field: string, direction?: string) => any;
} | null = null;

let storageRef: any = null;
let storageFns: {
  ref: (storage: any, path: string) => any;
  getDownloadURL: (ref: any) => Promise<string>;
} | null = null;

let authInstance: any = null;

if (Platform.OS !== 'web') {
  try {
    const rnfbFirestore = require('@react-native-firebase/firestore');
    firestoreDb = rnfbFirestore.getFirestore();
    firestoreFns = {
      collection: rnfbFirestore.collection,
      doc: rnfbFirestore.doc,
      getDocs: rnfbFirestore.getDocs,
      getDoc: rnfbFirestore.getDoc,
      query: rnfbFirestore.query,
      where: rnfbFirestore.where,
      orderBy: rnfbFirestore.orderBy,
    };
  } catch (e) {
    logger.debug(LogCategory.NETWORK, 'Native Firestore not available');
  }
  
  try {
    const rnfbStorage = require('@react-native-firebase/storage');
    storageRef = rnfbStorage.getStorage();
    storageFns = {
      ref: rnfbStorage.ref,
      getDownloadURL: rnfbStorage.getDownloadURL,
    };
  } catch (e) {
    logger.debug(LogCategory.NETWORK, 'Native Storage not available');
  }
  
  try {
    const rnfbAuth = require('@react-native-firebase/auth');
    authInstance = rnfbAuth.getAuth();
  } catch (e) {
    logger.debug(LogCategory.AUTH, 'Native Auth not available for chartService');
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
    if (!firestoreDb || !firestoreFns) {
      throw new Error('Firestore not available');
    }
    
    // Log auth state for debugging
    if (authInstance) {
      const currentUser = authInstance.currentUser;
      logger.debug(LogCategory.AUTH, currentUser ? `Logged in as ${currentUser.email}` : 'NOT LOGGED IN');
    }
    
    logger.debug(LogCategory.NETWORK, `Fetching from collection: ${COLLECTIONS.REGIONS}`);
    const collectionRef = firestoreFns.collection(firestoreDb, COLLECTIONS.REGIONS);
    const snapshot = await firestoreFns.getDocs(collectionRef);
    logger.debug(LogCategory.NETWORK, `Got ${snapshot.docs.length} documents`);
    
    return snapshot.docs.map((doc: any) => ({
      id: doc.id as RegionId,
      ...doc.data(),
      lastUpdated: doc.data().lastUpdated?.toDate() || new Date(),
    })) as ChartRegion[];
  } catch (error: any) {
    logger.error(LogCategory.NETWORK, 'Error fetching regions', { code: error.code, message: error.message });
    throw error;
  }
}

/**
 * Fetch a single region by ID
 */
export async function getRegion(regionId: RegionId): Promise<ChartRegion | null> {
  try {
    if (!firestoreDb || !firestoreFns) {
      throw new Error('Firestore not available');
    }
    
    const docRef = firestoreFns.doc(firestoreDb, COLLECTIONS.REGIONS, regionId);
    const snapshot = await firestoreFns.getDoc(docRef);
    
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
    logger.error(LogCategory.NETWORK, 'Error fetching region', error as Error);
    throw error;
  }
}

/**
 * Fetch all charts in a region
 */
export async function getChartsByRegion(regionId: RegionId): Promise<ChartMetadata[]> {
  try {
    if (!firestoreDb || !firestoreFns) {
      throw new Error('Firestore not available');
    }
    
    const collectionRef = firestoreFns.collection(firestoreDb, COLLECTIONS.METADATA);
    const q = firestoreFns.query(
      collectionRef,
      firestoreFns.where('region', '==', regionId),
      firestoreFns.orderBy('scale', 'desc') // Harbor charts first (higher scale number)
    );
    const snapshot = await firestoreFns.getDocs(q);
    
    return snapshot.docs.map((doc: any) => ({
      ...doc.data(),
      chartId: doc.id,
      lastUpdated: doc.data().lastUpdated?.toDate() || new Date(),
    })) as ChartMetadata[];
  } catch (error) {
    logger.error(LogCategory.NETWORK, 'Error fetching charts by region', error as Error);
    throw error;
  }
}

/**
 * Fetch all available charts
 */
export async function getAllCharts(): Promise<ChartMetadata[]> {
  try {
    if (!firestoreDb || !firestoreFns) {
      throw new Error('Firestore not available');
    }
    
    // Log auth state for debugging
    if (authInstance) {
      const currentUser = authInstance.currentUser;
      logger.debug(LogCategory.AUTH, currentUser ? `Logged in as ${currentUser.email}` : 'NOT LOGGED IN');
    }
    
    logger.debug(LogCategory.NETWORK, `Fetching from collection: ${COLLECTIONS.METADATA}`);
    const collectionRef = firestoreFns.collection(firestoreDb, COLLECTIONS.METADATA);
    const snapshot = await firestoreFns.getDocs(collectionRef);
    logger.debug(LogCategory.NETWORK, `Got ${snapshot.docs.length} documents`);
    
    return snapshot.docs.map((doc: any) => ({
      ...doc.data(),
      chartId: doc.id,
      lastUpdated: doc.data().lastUpdated?.toDate() || new Date(),
    })) as ChartMetadata[];
  } catch (error: any) {
    logger.error(LogCategory.NETWORK, 'Error fetching all charts', { code: error.code, message: error.message });
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
    logger.error(LogCategory.NETWORK, 'Error fetching charts in bounds', error as Error);
    throw error;
  }
}

/**
 * Fetch a single chart's metadata
 */
export async function getChartMetadata(chartId: string): Promise<ChartMetadata | null> {
  try {
    if (!firestoreDb || !firestoreFns) {
      throw new Error('Firestore not available');
    }
    
    const docRef = firestoreFns.doc(firestoreDb, COLLECTIONS.METADATA, chartId);
    const snapshot = await firestoreFns.getDoc(docRef);
    
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
    logger.error(LogCategory.NETWORK, 'Error fetching chart metadata', error as Error);
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
    logger.warn(LogCategory.CHARTS, 'Gzip decompression failed, trying as uncompressed');
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
    if (!storageRef || !storageFns) {
      throw new Error('Native Storage not available');
    }
    
    logger.debug(LogCategory.NETWORK, `Downloading: ${storagePath}`);
    const fileRef = storageFns.ref(storageRef, storagePath);
    
    // Download to a data URL and extract the base64 data
    const downloadUrl = await storageFns.getDownloadURL(fileRef);
    
    // Fetch the file data
    const response = await fetch(downloadUrl);
    const arrayBuffer = await response.arrayBuffer();
    
    const jsonString = decompressGzip(arrayBuffer);
    const geojson = JSON.parse(jsonString) as GeoJSONFeatureCollection;
    logger.debug(LogCategory.CHARTS, `Downloaded ${geojson.features?.length || 0} ${featureType} features`);
    
    return geojson;
  } catch (error: unknown) {
    // File might not exist for this chart (not all charts have all feature types)
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('object-not-found') || errorMessage.includes('404') || errorMessage.includes('does not exist')) {
      return null;
    }
    logger.error(LogCategory.NETWORK, `Error downloading ${featureType} for ${chartId}`, error as Error);
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

// ============================================
// MBTiles Download Functions
// ============================================

/**
 * Download an MBTiles file for a chart from Firebase Storage
 * Returns the local file path where the MBTiles was saved
 */
export async function downloadChartMBTiles(
  chartId: string,
  onProgress?: (bytesDownloaded: number, totalBytes: number) => void
): Promise<string> {
  const storagePath = `enc-mbtiles/${chartId}.mbtiles`;
  const localPath = chartCacheService.getMBTilesPath(chartId);
  
  try {
    if (!storageRef || !storageFns) {
      throw new Error('Native Storage not available');
    }
    
    // Log auth state for debugging
    if (authInstance) {
      const currentUser = authInstance.currentUser;
      console.log(`downloadChartMBTiles - Auth: ${currentUser ? currentUser.email : 'NOT LOGGED IN'}`);
    }
    
    // Ensure mbtiles directory exists
    const mbtilesDir = chartCacheService.getMBTilesDir();
    const dirInfo = await getInfoAsync(mbtilesDir);
    if (!dirInfo.exists) {
      await makeDirectoryAsync(mbtilesDir, { intermediates: true });
    }
    
    console.log(`Downloading MBTiles: ${storagePath}`);
    const fileRef = storageFns.ref(storageRef, storagePath);
    
    // Get download URL
    const downloadUrl = await storageFns.getDownloadURL(fileRef);
    console.log(`Got download URL for ${chartId}.mbtiles`);
    
    // Fetch the binary file
    const response = await fetch(downloadUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    // Get the total size for progress
    const contentLength = response.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
    
    // Read as array buffer
    const arrayBuffer = await response.arrayBuffer();
    console.log(`Downloaded ${arrayBuffer.byteLength} bytes for ${chartId}.mbtiles`);
    
    if (onProgress && totalBytes) {
      onProgress(arrayBuffer.byteLength, totalBytes);
    }
    
    // Convert to base64 and write to file
    // expo-file-system can write base64-encoded binary data
    const uint8Array = new Uint8Array(arrayBuffer);
    const base64 = uint8ArrayToBase64(uint8Array);
    
    // Write using expo-file-system's downloadAsync would be better, but for now use base64
    const FileSystem = require('expo-file-system/legacy');
    await FileSystem.writeAsStringAsync(localPath, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    
    console.log(`Saved MBTiles to: ${localPath}`);
    
    // Mark as downloaded
    await chartCacheService.markMBTilesDownloaded(chartId);
    
    return localPath;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('object-not-found') || errorMessage.includes('404') || errorMessage.includes('does not exist')) {
      console.error(`MBTiles file not found for ${chartId} at ${storagePath}`);
      throw new Error(`MBTiles file not found for chart ${chartId}`);
    }
    console.error(`Error downloading MBTiles for ${chartId}:`, error);
    throw error;
  }
}

/**
 * Check if an MBTiles file exists for a chart in Firebase Storage
 */
export async function checkMBTilesExists(chartId: string): Promise<boolean> {
  const storagePath = `enc-mbtiles/${chartId}.mbtiles`;
  
  try {
    if (!storageRef || !storageFns) {
      return false;
    }
    
    const fileRef = storageFns.ref(storageRef, storagePath);
    await storageFns.getDownloadURL(fileRef);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Helper function to convert Uint8Array to base64
 */
function uint8ArrayToBase64(uint8Array: Uint8Array): string {
  let binary = '';
  const len = uint8Array.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}

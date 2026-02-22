/**
 * Chart Pack Service
 * 
 * Manages chart pack discovery, metadata, and cloud downloads.
 * Supports both local manifest files and Firebase Storage downloads.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { unzip } from 'react-native-zip-archive';
import { 
  ChartPackManifest, 
  ChartPack, 
  InstalledChartPack, 
  BasePack,
  District,
  DistrictDownloadPack,
  PackDownloadStatus,
} from '../types/chartPack';

// Use internal storage (documentDirectory) for mbtiles
// This is always writable and doesn't require permissions
// Data is managed via cloud downloads

// Track if directory has been initialized
let mbtilesDirectoryInitialized = false;
let resolvedMBTilesDir: string | null = null;

/**
 * Get the mbtiles directory - uses internal storage
 * Ensures the directory exists before returning
 */
async function getMBTilesDir(): Promise<string> {
  // Return cached path if already initialized
  if (mbtilesDirectoryInitialized && resolvedMBTilesDir) {
    return resolvedMBTilesDir;
  }
  
  // Use document directory (internal storage)
  const baseDir = FileSystem.documentDirectory;
  if (!baseDir) {
    throw new Error('Document directory not available');
  }
  
  resolvedMBTilesDir = `${baseDir}mbtiles/`;
  
  try {
    const dirInfo = await FileSystem.getInfoAsync(resolvedMBTilesDir);
    if (!dirInfo.exists) {
      console.log('[ChartPackService] Creating mbtiles directory:', resolvedMBTilesDir);
      await FileSystem.makeDirectoryAsync(resolvedMBTilesDir, { intermediates: true });
    }
    mbtilesDirectoryInitialized = true;
  } catch (error) {
    console.warn('[ChartPackService] Could not create mbtiles directory:', error);
    // Try anyway - might work
  }
  
  return resolvedMBTilesDir;
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

// ============================================
// Cloud Download Functions (District-based)
// ============================================

/**
 * Fetch district information from Firestore.
 * Includes available download packs with sizes and storage paths.
 * 
 * First tries to load pre-generated metadata from Storage ({districtId}/download-metadata.json).
 * Falls back to Firestore district document if metadata file doesn't exist.
 */
export async function getDistrict(districtId: string): Promise<District | null> {
  try {
    const { firestore } = await import('../config/firebase');
    const { doc, getDoc } = await import('firebase/firestore');
    
    // Try to load pre-generated metadata from Storage first
    try {
      // Use direct public URL to avoid getDownloadURL auth issues
      const bucketName = 'xnautical-8a296.firebasestorage.app';
      const metadataPath = `${districtId}/download-metadata.json`;
      const encodedPath = encodeURIComponent(metadataPath);
      const metadataUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media`;
      
      const response = await fetch(metadataUrl);

      if (response.ok) {
        const metadata = await response.json();
        
        // Fetch basic district info from Firestore for non-download fields
        const districtRef = doc(firestore, 'districts', districtId);
        const districtSnap = await getDoc(districtRef);
        const districtData = districtSnap.exists() ? districtSnap.data() : {};
        
        // Merge metadata with Firestore data
        const result = {
          code: metadata.code || districtData.code || '',
          name: metadata.name || districtData.name || districtId,
          timezone: districtData.timezone || '',
          defaultCenter: districtData.defaultCenter || [0, 0],
          bounds: districtData.bounds || { west: 0, east: 0, south: 0, north: 0 },
          states: districtData.states || [],
          downloadPacks: metadata.downloadPacks || [],
          us1ChartBounds: districtData.us1ChartBounds,
          metadata: metadata.metadata, // Include metadata for buoy/zone counts and prediction sizes
        };
        return result;
      } else {
        console.warn(`[ChartPackService] Metadata fetch returned ${response.status}, falling back to Firestore`);
      }
    } catch (metadataError) {
      console.warn(`[ChartPackService] Error loading metadata, falling back to Firestore:`, metadataError);
    }
    
    // Fallback: Load from Firestore
    const districtRef = doc(firestore, 'districts', districtId);
    const snapshot = await getDoc(districtRef);
    
    if (!snapshot.exists()) {
      console.log(`[ChartPackService] District ${districtId} not found`);
      return null;
    }
    
    const data = snapshot.data() as District;
    console.log(`[ChartPackService] Loaded district ${districtId} with ${data.downloadPacks?.length || 0} packs`);
    return data;
  } catch (error) {
    console.error('[ChartPackService] Error fetching district:', error);
    return null;
  }
}

/**
 * Get list of available districts.
 */
export async function getAvailableDistricts(): Promise<{ id: string; name: string; code: string }[]> {
  try {
    const { firestore } = await import('../config/firebase');
    const { collection, getDocs } = await import('firebase/firestore');
    
    const districtsRef = collection(firestore, 'districts');
    const snapshot = await getDocs(districtsRef);
    
    const districts = snapshot.docs.map(doc => ({
      id: doc.id,
      name: doc.data().name,
      code: doc.data().code,
    }));
    
    console.log(`[ChartPackService] Found ${districts.length} districts`);
    return districts;
  } catch (error) {
    console.error('[ChartPackService] Error fetching districts:', error);
    return [];
  }
}

/**
 * District prefix mapping.
 * Maps Firestore district IDs to local filename prefixes for chart files.
 */
const DISTRICT_PREFIXES: Record<string, string> = {
  '01cgd': 'd01',
  '05cgd': 'd05',
  '07cgd': 'd07',
  '08cgd': 'd08',
  '09cgd': 'd09',
  '11cgd': 'd11',
  '13cgd': 'd13',
  '14cgd': 'd14',
  '17cgd': 'd17',
  '017cgd-test': '017-test',
};

/**
 * GNIS filename mapping per district.
 */
const GNIS_FILENAMES: Record<string, string> = {
  '01cgd': 'gnis_names_ne.mbtiles',
  '05cgd': 'gnis_names_ma.mbtiles',
  '07cgd': 'gnis_names_se.mbtiles',
  '08cgd': 'gnis_names_gc.mbtiles',
  '09cgd': 'gnis_names_gl.mbtiles',
  '11cgd': 'gnis_names_sw.mbtiles',
  '13cgd': 'gnis_names_pnw.mbtiles',
  '14cgd': 'gnis_names_hi.mbtiles',
  '17cgd': 'gnis_names_ak.mbtiles',
  '017cgd-test': 'gnis_names_ak.mbtiles',
};

/**
 * Basemap filename mapping per district.
 */
const BASEMAP_FILENAMES: Record<string, string> = {
  '01cgd': 'd01_basemap.mbtiles',
  '05cgd': 'd05_basemap.mbtiles',
  '07cgd': 'd07_basemap.mbtiles',
  '08cgd': 'd08_basemap.mbtiles',
  '09cgd': 'd09_basemap.mbtiles',
  '11cgd': 'd11_basemap.mbtiles',
  '13cgd': 'd13_basemap.mbtiles',
  '14cgd': 'd14_basemap.mbtiles',
  '17cgd': 'd17_basemap.mbtiles',
  '017cgd-test': 'd17_basemap.mbtiles',
};

/**
 * District bounds mapping for manifest generation.
 */
const DISTRICT_BOUNDS: Record<string, { south: number; west: number; north: number; east: number }> = {
  '01cgd': { south: 39.5, west: -74.5, north: 47.5, east: -65.5 },
  '05cgd': { south: 33.0, west: -81.0, north: 41.0, east: -73.5 },
  '07cgd': { south: 17.0, west: -83.5, north: 34.0, east: -64.0 },
  '08cgd': { south: 24.0, west: -98.0, north: 31.0, east: -82.0 },
  '09cgd': { south: 40.5, west: -95.0, north: 49.5, east: -75.5 },
  '11cgd': { south: 32.0, west: -123.5, north: 37.5, east: -117.0 },
  '13cgd': { south: 35.0, west: -127.0, north: 49.5, east: -122.0 },
  '14cgd': { south: 18.0, west: -162.0, north: 23.0, east: -154.0 },
  '17cgd': { south: 51.0, west: -180.0, north: 71.5, east: -130.0 },
  '017cgd-test': { south: 57.6, west: -153.6, north: 62.4, east: -144.0 },
};

/**
 * Get the file prefix for a district.
 */
function getDistrictPrefix(districtId: string): string {
  return DISTRICT_PREFIXES[districtId] || districtId;
}

/**
 * Map storage path to local filename.
 * e.g., '17cgd/charts/d17_US4.mbtiles.zip' -> 'd17_US4.mbtiles'
 * e.g., '07cgd/charts/d07_US4.mbtiles.zip' -> 'd07_US4.mbtiles'
 * e.g., '07cgd/satellite/d07_satellite_z8.mbtiles.zip' -> 'd07_satellite_z8.mbtiles'
 */
function getLocalFilename(pack: DistrictDownloadPack, districtId: string): string {
  // Get the base filename from storage path
  const pathParts = pack.storagePath.split('/');
  const zipFilename = pathParts[pathParts.length - 1]; // e.g., 'US4.mbtiles.zip'
  const baseFilename = zipFilename.replace('.zip', ''); // e.g., 'US4.mbtiles'
  
  const prefix = getDistrictPrefix(districtId);

  // Unified charts pack (no band) or per-scale charts
  if (pack.type === 'charts') {
    if (pack.band) {
      return `${prefix}_${pack.band}.mbtiles`;
    }
    return `${prefix}_charts.mbtiles`;
  }
  
  // GNIS files - use canonical filename (content is identical nationwide)
  if (pack.type === 'gnis') {
    return 'gnis_names.mbtiles';
  }
  
  // Basemap files - use district-specific filenames
  if (pack.type === 'basemap') {
    return BASEMAP_FILENAMES[districtId] || baseFilename;
  }
  
  // Ocean, terrain, and satellite files - prefix with district for multi-region coexistence
  // e.g., d17_ocean.mbtiles, d07_terrain.mbtiles, d07_satellite_z8.mbtiles
  // Guard against double-prefixing: if the blob name already starts with the prefix
  // (e.g., storagePath contains "d07_ocean.mbtiles.zip"), don't add it again.
  if (pack.type === 'ocean' || pack.type === 'terrain' || pack.type === 'satellite') {
    if (baseFilename.startsWith(`${prefix}_`)) {
      return baseFilename;
    }
    return `${prefix}_${baseFilename}`;
  }
  
  // For other types, use the base filename
  return baseFilename;
}

/**
 * Download a pack from Firebase Storage and extract it.
 * When downloading multiple packs in a batch, pass skipManifest=true and call
 * generateManifest() once after all packs are done.
 */
export async function downloadPack(
  pack: DistrictDownloadPack,
  districtId: string,
  onProgress?: (status: PackDownloadStatus) => void,
  skipManifest: boolean = false,
): Promise<boolean> {
  const { storage } = await import('../config/firebase');
  const { ref, getDownloadURL } = await import('firebase/storage');
  const { downloadManager } = await import('./downloadManager');
  
  const mbtilesDir = await getMBTilesDir();
  const localFilename = getLocalFilename(pack, districtId);
  const zipFilename = `${pack.id}.zip`;
  const compressedPath = `${FileSystem.cacheDirectory}${zipFilename}`;
  const finalPath = `${mbtilesDir}${localFilename}`;
  
  console.log(`[ChartPackService] Downloading ${pack.id} from ${pack.storagePath}`);
  console.log(`[ChartPackService] Will save to ${finalPath}`);
  
  try {
    // Update status: downloading
    onProgress?.({
      packId: pack.id,
      status: 'downloading',
      progress: 0,
      bytesDownloaded: 0,
      totalBytes: pack.sizeBytes,
    });
    
    // Get download URL from Firebase Storage
    const storageRef = ref(storage, pack.storagePath);
    const downloadUrl = await getDownloadURL(storageRef);
    
    // Start download through DownloadManager
    const downloadId = await downloadManager.startDownload({
      type: 'chart',
      districtId,
      packId: pack.id,
      url: downloadUrl,
      destination: compressedPath,
      totalBytes: pack.sizeBytes,
    });
    
    // Subscribe to progress updates
    const unsubscribe = downloadManager.subscribeToProgress(downloadId, (progress) => {
      onProgress?.({
        packId: pack.id,
        status: progress.status as any,
        progress: progress.percent,
        bytesDownloaded: progress.bytesDownloaded,
        totalBytes: progress.totalBytes,
        speedBps: progress.speedBps,
        etaSeconds: progress.etaSeconds,
        error: progress.error,
      });
    });
    
    // Wait for download to complete
    try {
      await downloadManager.waitForCompletion(downloadId);
    } finally {
      unsubscribe();
    }
    
    // Update status: extracting
    onProgress?.({
      packId: pack.id,
      status: 'extracting',
      progress: 100,
      bytesDownloaded: pack.sizeBytes,
      totalBytes: pack.sizeBytes,
    });
    
    // Ensure mbtiles directory exists
    const dirInfo = await FileSystem.getInfoAsync(mbtilesDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(mbtilesDir, { intermediates: true });
    }
    
    console.log(`[ChartPackService] Extracting ${compressedPath} to ${mbtilesDir}...`);

    // Snapshot files before extraction so we can detect what was added
    const filesBefore = new Set(await FileSystem.readDirectoryAsync(mbtilesDir));

    // Extract the zip file
    await unzip(compressedPath, mbtilesDir);

    // Clean up compressed file
    await FileSystem.deleteAsync(compressedPath, { idempotent: true });

    // Verify extraction — if the expected file doesn't exist, the zip may
    // have contained a differently-named file (e.g., gnis_names_ak.mbtiles
    // instead of gnis_names.mbtiles). Find the new file and rename it.
    // For shared files like GNIS, always overwrite the canonical file with
    // the latest download so multi-region installs stay current.
    const fileInfo = await FileSystem.getInfoAsync(finalPath);
    const filesAfter = await FileSystem.readDirectoryAsync(mbtilesDir);
    const newFiles = filesAfter.filter(f => !filesBefore.has(f) && f.endsWith('.mbtiles'));

    if (!fileInfo.exists && newFiles.length === 1) {
      // Expected file missing — rename the extracted file to the canonical name
      const extractedPath = `${mbtilesDir}${newFiles[0]}`;
      console.log(`[ChartPackService] Renaming ${newFiles[0]} -> ${localFilename}`);
      await FileSystem.moveAsync({ from: extractedPath, to: finalPath });
    } else if (fileInfo.exists && newFiles.length === 1 && newFiles[0] !== localFilename) {
      // Expected file exists but zip contained a differently-named file.
      // Replace the old file with the new one (e.g., updating GNIS from a
      // newer region download).
      const extractedPath = `${mbtilesDir}${newFiles[0]}`;
      console.log(`[ChartPackService] Replacing ${localFilename} with ${newFiles[0]}`);
      await FileSystem.deleteAsync(finalPath, { idempotent: true });
      await FileSystem.moveAsync({ from: extractedPath, to: finalPath });
    } else if (!fileInfo.exists && newFiles.length !== 1) {
      console.warn(`[ChartPackService] Expected ${localFilename} not found after extraction`);
      console.log(`[ChartPackService] New files: ${newFiles.join(', ')}`);
    }
    
    // Update status: completed
    onProgress?.({
      packId: pack.id,
      status: 'completed',
      progress: 100,
      bytesDownloaded: pack.sizeBytes,
      totalBytes: pack.sizeBytes,
    });
    
    console.log(`[ChartPackService] Successfully downloaded and extracted ${pack.id}`);
    
    // Regenerate manifest.json so the native tile server can find the chart packs
    // Skip when caller will batch-regenerate after all packs are done.
    if (pack.type === 'charts' && !skipManifest) {
      await generateManifest();
    }
    
    return true;
    
  } catch (error: any) {
    console.error(`[ChartPackService] Error downloading ${pack.id}:`, error);
    
    // Clean up on failure
    await FileSystem.deleteAsync(compressedPath, { idempotent: true }).catch(() => {});
    
    onProgress?.({
      packId: pack.id,
      status: 'failed',
      progress: 0,
      bytesDownloaded: 0,
      totalBytes: pack.sizeBytes,
      error: error.message || 'Download failed',
    });
    
    return false;
  }
}

/**
 * Get list of installed pack IDs by checking local files.
 */
export async function getInstalledPackIds(districtId: string): Promise<string[]> {
  try {
    const mbtilesDir = await getMBTilesDir();
    const dirInfo = await FileSystem.getInfoAsync(mbtilesDir);
    
    if (!dirInfo.exists) {
      return [];
    }
    
    const files = await FileSystem.readDirectoryAsync(mbtilesDir);
    const mbtilesFiles = files.filter(f => f.endsWith('.mbtiles'));
    
    // Map filenames back to pack IDs
    const prefix = getDistrictPrefix(districtId);
    
    const installedPackIds: string[] = [];
    
    for (const file of mbtilesFiles) {
      // Check for unified charts file (e.g., d07_charts.mbtiles -> charts)
      if (file === `${prefix}_charts.mbtiles`) {
        installedPackIds.push('charts');
      }
      // Check for per-scale chart files (e.g., d17_US4.mbtiles -> charts-US4)
      else if (file.startsWith(`${prefix}_US`)) {
        const band = file.replace(`${prefix}_`, '').replace('.mbtiles', '');
        installedPackIds.push(`charts-${band}`);
      }
      // Check for basemap (any district basemap file)
      else if (file.startsWith('basemap') && file.endsWith('.mbtiles')) {
        // Check if this basemap belongs to the requested district
        const expectedBasemap = BASEMAP_FILENAMES[districtId];
        if (file === expectedBasemap || file === 'basemap.mbtiles') {
          installedPackIds.push('basemap');
        }
      }
      // Check for GNIS (canonical filename, shared across all districts)
      else if (file === 'gnis_names.mbtiles') {
        installedPackIds.push('gnis');
      }
      // Check for satellite files: {prefix}_satellite_z*.mbtiles -> satellite-z*
      else if (file.startsWith(`${prefix}_satellite_z`) && file.endsWith('.mbtiles')) {
        const zoomPart = file.replace(`${prefix}_satellite_`, '').replace('.mbtiles', '');
        installedPackIds.push(`satellite-${zoomPart}`);
      }
      // Check for ocean files: {prefix}_ocean_z*.mbtiles -> ocean-z* OR {prefix}_ocean.mbtiles -> ocean
      else if (file.startsWith(`${prefix}_ocean_z`) && file.endsWith('.mbtiles')) {
        const zoomPart = file.replace(`${prefix}_ocean_`, '').replace('.mbtiles', '');
        installedPackIds.push(`ocean-${zoomPart}`);
      }
      else if (file === `${prefix}_ocean.mbtiles`) {
        installedPackIds.push('ocean');
      }
      // Check for terrain files: {prefix}_terrain_z*.mbtiles -> terrain-z* OR {prefix}_terrain.mbtiles -> terrain
      else if (file.startsWith(`${prefix}_terrain_z`) && file.endsWith('.mbtiles')) {
        const zoomPart = file.replace(`${prefix}_terrain_`, '').replace('.mbtiles', '');
        installedPackIds.push(`terrain-${zoomPart}`);
      }
      else if (file === `${prefix}_terrain.mbtiles`) {
        installedPackIds.push('terrain');
      }
    }
    
    console.log(`[ChartPackService] Found ${installedPackIds.length} installed packs:`, installedPackIds);
    return installedPackIds;
    
  } catch (error) {
    console.error('[ChartPackService] Error getting installed packs:', error);
    return [];
  }
}

/**
 * Delete a downloaded pack.
 */
export async function deletePack(
  pack: DistrictDownloadPack,
  districtId: string
): Promise<boolean> {
  try {
    const mbtilesDir = await getMBTilesDir();
    const localFilename = getLocalFilename(pack, districtId);
    const filePath = `${mbtilesDir}${localFilename}`;
    
    const fileInfo = await FileSystem.getInfoAsync(filePath);
    if (fileInfo.exists) {
      await FileSystem.deleteAsync(filePath, { idempotent: true });
      console.log(`[ChartPackService] Deleted ${filePath}`);
      
      // Regenerate manifest.json after deleting a chart pack
      if (pack.type === 'charts') {
        await generateManifest();
      }
      
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`[ChartPackService] Error deleting ${pack.id}:`, error);
    return false;
  }
}

/**
 * Generate manifest.json in the mbtiles directory.
 * 
 * The native tile server (LocalTileServerModule.java) reads manifest.json
 * to know which chart packs are available and their metadata (bounds, zoom ranges).
 * Without this file, composite tile requests (/tiles/{z}/{x}/{y}.pbf) return nothing.
 * 
 * This function scans the mbtiles directory for ALL installed districts' chart packs
 * (e.g., d17_US1.mbtiles, d07_US1.mbtiles) and includes them all in the manifest
 * with per-district bounds. This enables multi-region support where the tile server
 * serves tiles from whichever region covers the current viewport.
 */
export async function generateManifest(): Promise<void> {
  try {
    const mbtilesDir = await getMBTilesDir();
    const dirInfo = await FileSystem.getInfoAsync(mbtilesDir);
    
    if (!dirInfo.exists) {
      console.log('[ChartPackService] No mbtiles directory - skipping manifest generation');
      return;
    }
    
    const files = await FileSystem.readDirectoryAsync(mbtilesDir);
    
    // Zoom ranges for each chart scale — must match pipeline SCALE_ZOOM_RANGES
    // in compose_job.py so the app requests tiles at all zooms the pipeline generates.
    const scaleZoomRanges: Record<string, { minZoom: number; maxZoom: number }> = {
      'US1': { minZoom: 0, maxZoom: 8 },
      'US2': { minZoom: 0, maxZoom: 10 },
      'US3': { minZoom: 4, maxZoom: 13 },
      'US4': { minZoom: 6, maxZoom: 15 },
      'US5': { minZoom: 6, maxZoom: 15 },
      'US6': { minZoom: 6, maxZoom: 15 },
    };
    
    const packs: Array<{
      id: string;
      bounds: { south: number; west: number; north: number; east: number };
      minZoom: number;
      maxZoom: number;
      fileSize: number;
    }> = [];
    
    // Scan for chart packs from ALL known districts
    for (const [districtId, prefix] of Object.entries(DISTRICT_PREFIXES)) {
      const bounds = DISTRICT_BOUNDS[districtId] || { south: -90, west: -180, north: 90, east: 180 };

      // Check for unified charts file first: {prefix}_charts.mbtiles
      const unifiedFile = `${prefix}_charts.mbtiles`;
      if (files.includes(unifiedFile)) {
        const filePath = `${mbtilesDir}${unifiedFile}`;
        const fileInfo = await FileSystem.getInfoAsync(filePath);
        const fileSize = fileInfo.exists && fileInfo.size ? fileInfo.size : 0;

        packs.push({
          id: `${prefix}_charts`,
          bounds,
          minZoom: 0,
          maxZoom: 15,
          fileSize,
        });

        console.log(`[ChartPackService] Manifest pack: ${prefix}_charts (${districtId}/unified) z0-15, ${(fileSize / 1024 / 1024).toFixed(1)} MB`);
        continue; // Skip per-scale scanning for this district
      }

      // Fall back to per-scale chart files
      for (const file of files) {
        // Match chart pack files: {prefix}_US1.mbtiles, {prefix}_US2.mbtiles, etc.
        if (file.startsWith(`${prefix}_US`) && file.endsWith('.mbtiles')) {
          const band = file.replace(`${prefix}_`, '').replace('.mbtiles', ''); // e.g., "US1"
          const packId = `${prefix}_${band}`; // e.g., "d17_US1" or "d07_US1"

          // Get file size
          const filePath = `${mbtilesDir}${file}`;
          const fileInfo = await FileSystem.getInfoAsync(filePath);
          const fileSize = fileInfo.exists && fileInfo.size ? fileInfo.size : 0;

          const zoomRange = scaleZoomRanges[band] || { minZoom: 0, maxZoom: 15 };

          packs.push({
            id: packId,
            bounds,
            minZoom: zoomRange.minZoom,
            maxZoom: zoomRange.maxZoom,
            fileSize,
          });

          console.log(`[ChartPackService] Manifest pack: ${packId} (${districtId}/${band}) z${zoomRange.minZoom}-${zoomRange.maxZoom}, ${(fileSize / 1024 / 1024).toFixed(1)} MB`);
        }
      }
    }

    // Scan for points MBTiles from ALL known districts
    for (const [districtId, prefix] of Object.entries(DISTRICT_PREFIXES)) {
      const bounds = DISTRICT_BOUNDS[districtId] || { south: -90, west: -180, north: 90, east: 180 };
      const pointsFile = `points-${prefix}.mbtiles`;
      if (files.includes(pointsFile)) {
        const filePath = `${mbtilesDir}${pointsFile}`;
        const fileInfo = await FileSystem.getInfoAsync(filePath);
        const fileSize = fileInfo.exists && fileInfo.size ? fileInfo.size : 0;

        packs.push({
          id: `points-${prefix}`,
          bounds,
          minZoom: 0,
          maxZoom: 15,
          fileSize,
        });

        console.log(`[ChartPackService] Manifest pack: points-${prefix} (${districtId}/points) z0-15, ${(fileSize / 1024 / 1024).toFixed(1)} MB`);
      }
    }

    // Sort packs by ID for consistency
    packs.sort((a, b) => a.id.localeCompare(b.id));
    
    const manifest = { packs };
    const manifestPath = `${mbtilesDir}manifest.json`;
    
    await FileSystem.writeAsStringAsync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`[ChartPackService] Generated manifest.json with ${packs.length} chart packs from ${new Set(packs.map(p => p.id.split('_')[0])).size} district(s) at ${manifestPath}`);
    
  } catch (error) {
    console.error('[ChartPackService] Error generating manifest:', error);
  }
}

/**
 * Get total size of installed chart data.
 */
export async function getInstalledDataSize(): Promise<number> {
  try {
    const mbtilesDir = await getMBTilesDir();
    const dirInfo = await FileSystem.getInfoAsync(mbtilesDir);
    
    if (!dirInfo.exists) {
      return 0;
    }
    
    const files = await FileSystem.readDirectoryAsync(mbtilesDir);
    let totalSize = 0;
    
    for (const file of files) {
      if (file.endsWith('.mbtiles')) {
        const fileInfo = await FileSystem.getInfoAsync(`${mbtilesDir}${file}`);
        if (fileInfo.exists && fileInfo.size) {
          totalSize += fileInfo.size;
        }
      }
    }
    
    return totalSize;
  } catch (error) {
    console.error('[ChartPackService] Error calculating installed size:', error);
    return 0;
  }
}

/**
 * Get a list of mbtiles files that belong to a specific district.
 * Includes charts (prefix_US*.mbtiles), basemap, satellite, ocean, terrain.
 * GNIS is excluded since it's a shared canonical file.
 */
export function getDistrictFilePatterns(districtId: string): {
  prefix: string;
  patterns: ((filename: string) => boolean)[];
} {
  const prefix = getDistrictPrefix(districtId);
  const expectedBasemap = BASEMAP_FILENAMES[districtId];
  
  return {
    prefix,
    patterns: [
      // Unified chart pack: d07_charts.mbtiles
      (f: string) => f === `${prefix}_charts.mbtiles`,
      // Per-scale chart packs: d17_US1.mbtiles, d07_US1.mbtiles, etc.
      (f: string) => f.startsWith(`${prefix}_US`) && f.endsWith('.mbtiles'),
      // Basemap: d17_basemap.mbtiles, d07_basemap.mbtiles, etc.
      (f: string) => expectedBasemap ? f === expectedBasemap : false,
      // Satellite: d17_satellite_z0-5.mbtiles, d07_satellite_z8.mbtiles, etc.
      (f: string) => f.startsWith(`${prefix}_satellite_`) && f.endsWith('.mbtiles'),
      // Ocean: d07_ocean.mbtiles or d07_ocean_z0-5.mbtiles
      (f: string) => f.startsWith(`${prefix}_ocean`) && f.endsWith('.mbtiles'),
      // Terrain: d07_terrain.mbtiles or d07_terrain_z8.mbtiles
      (f: string) => f.startsWith(`${prefix}_terrain`) && f.endsWith('.mbtiles'),
      // Points: points-d07.mbtiles
      (f: string) => f === `points-${prefix}.mbtiles`,
      // Legacy sidecars (for cleanup of old installs)
      (f: string) => f === `sector-lights-${districtId}.json`,
      (f: string) => f === `nav-aids-${districtId}.json`,
    ],
  };
}

/**
 * Delete all data for a specific region/district.
 * Removes:
 *   - All mbtiles files for this district (charts, basemap, satellite, ocean, terrain)
 *   - GNIS file only if no other districts remain installed
 *   - Per-district prediction databases (tides_{districtId}.db, currents_{districtId}.db)
 *   - Buoy data from AsyncStorage
 *   - District from the region registry
 *   - Regenerates manifest.json for remaining districts
 * 
 * @param districtId The district to delete (e.g., '17cgd')
 * @param otherInstalledDistrictIds IDs of other districts that are still installed (for GNIS check)
 */
export async function deleteRegion(
  districtId: string,
  otherInstalledDistrictIds: string[] = []
): Promise<{ deletedFiles: number; freedBytes: number }> {
  console.log(`[ChartPackService] Deleting all data for district ${districtId}...`);
  
  // STEP 1: Close all open MBTiles databases
  console.log('[ChartPackService] Closing all MBTiles databases...');
  try {
    const { closeAllDatabases } = await import('./mbtilesReader');
    await closeAllDatabases();
    console.log('[ChartPackService] All MBTiles databases closed');
  } catch (error) {
    console.error('[ChartPackService] Error closing MBTiles databases:', error);
  }
  
  // STEP 2: Close prediction databases for this district
  console.log(`[ChartPackService] Closing prediction databases for ${districtId}...`);
  try {
    const { closePredictionDatabases } = await import('./stationService');
    await closePredictionDatabases(districtId);
    console.log(`[ChartPackService] Prediction databases closed for ${districtId}`);
  } catch (error) {
    console.error(`[ChartPackService] Error closing prediction databases:`, error);
  }
  
  let deletedFiles = 0;
  let freedBytes = 0;
  
  try {
    const mbtilesDir = await getMBTilesDir();
    const dirInfo = await FileSystem.getInfoAsync(mbtilesDir);
    
    if (dirInfo.exists) {
      const files = await FileSystem.readDirectoryAsync(mbtilesDir);
      const { patterns } = getDistrictFilePatterns(districtId);
      
      for (const file of files) {
        // Check if file belongs to this district
        const belongsToDistrict = patterns.some(pattern => pattern(file));
        
        if (belongsToDistrict) {
          const filePath = `${mbtilesDir}${file}`;
          const fileInfo = await FileSystem.getInfoAsync(filePath);
          if (fileInfo.exists) {
            freedBytes += fileInfo.size || 0;
            await FileSystem.deleteAsync(filePath, { idempotent: true });
            deletedFiles++;
            console.log(`[ChartPackService] Deleted ${file}`);
          }
        }
      }
      
      // Delete GNIS only if no other districts remain
      if (otherInstalledDistrictIds.length === 0) {
        const gnisPath = `${mbtilesDir}gnis_names.mbtiles`;
        const gnisInfo = await FileSystem.getInfoAsync(gnisPath);
        if (gnisInfo.exists) {
          freedBytes += gnisInfo.size || 0;
          await FileSystem.deleteAsync(gnisPath, { idempotent: true });
          deletedFiles++;
          console.log('[ChartPackService] Deleted gnis_names.mbtiles (no other districts installed)');
        }
      }
      
      // STEP 3: Verify deletion
      console.log('[ChartPackService] Verifying deletion...');
      const remainingFiles = await FileSystem.readDirectoryAsync(mbtilesDir);
      const leftover = remainingFiles.filter(file => 
        patterns.some(pattern => pattern(file))
      );
      
      if (leftover.length > 0) {
        console.warn(`[ChartPackService] Warning: ${leftover.length} files could not be deleted:`, leftover);
      } else {
        console.log('[ChartPackService] All district files successfully deleted');
      }
    }
    
    // Delete per-district prediction databases
    const docDir = FileSystem.documentDirectory;
    if (docDir) {
      const predDbFiles = [
        `tides_${districtId}.db`,
        `currents_${districtId}.db`,
      ];
      
      for (const dbFile of predDbFiles) {
        const dbPath = `${docDir}${dbFile}`;
        const dbInfo = await FileSystem.getInfoAsync(dbPath);
        if (dbInfo.exists) {
          freedBytes += dbInfo.size || 0;
          await FileSystem.deleteAsync(dbPath, { idempotent: true });
          deletedFiles++;
          console.log(`[ChartPackService] Deleted ${dbFile}`);
        }
      }
    }
    
    // STEP 4: Invalidate station cache (stations from deleted district must be removed)
    try {
      const { clearStationCache } = await import('./stationService');
      clearStationCache();
      console.log(`[ChartPackService] Station cache invalidated after deleting ${districtId}`);
    } catch (error) {
      console.error('[ChartPackService] Error invalidating station cache:', error);
    }

    // STEP 5: Regenerate manifest.json for remaining districts
    console.log('[ChartPackService] Regenerating manifest.json...');
    await generateManifest();
    console.log('[ChartPackService] Manifest regenerated');
    
    console.log(`[ChartPackService] Region ${districtId} deleted: ${deletedFiles} files, ${(freedBytes / 1024 / 1024).toFixed(1)} MB freed`);
    
    return { deletedFiles, freedBytes };
  } catch (error) {
    console.error(`[ChartPackService] Error deleting region ${districtId}:`, error);
    
    // Still try to regenerate manifest even if deletion had errors
    try {
      console.log('[ChartPackService] Attempting to regenerate manifest after error...');
      await generateManifest();
    } catch (manifestError) {
      console.error('[ChartPackService] Failed to regenerate manifest:', manifestError);
    }
    
    return { deletedFiles, freedBytes };
  }
}

// ─── Points MBTiles ─────────────────────────────────────────────────────
// All Point geometry features (soundings, lights, buoys, beacons, wrecks, rocks,
// obstructions, landmarks, etc.) are served from a single points.mbtiles file.
// This replaces the old nav-aids.json (GeoJSON ShapeSource, caused OOM) and
// sector-lights.json (pre-computed sidecar). MBTiles is memory-mapped SQLite
// read by MapLibre's native code — no JS bridge, no JSON parsing.

/**
 * Fetch points.mbtiles for a district from Firebase Storage and cache locally.
 * Downloads the zip, extracts to local mbtiles directory, and registers with tile server.
 * Returns true on success.
 */
export async function fetchPoints(districtId: string): Promise<boolean> {
  const mbtilesDir = await getMBTilesDir();
  const prefix = getDistrictPrefix(districtId);
  const localFilename = `points-${prefix}.mbtiles`;
  const finalPath = `${mbtilesDir}${localFilename}`;
  const zipFilename = `points-${prefix}.mbtiles.zip`;
  const compressedPath = `${FileSystem.cacheDirectory}${zipFilename}`;

  try {
    const bucketName = 'xnautical-8a296.firebasestorage.app';
    const storagePath = `${districtId}/charts/points.mbtiles.zip`;
    const encodedPath = encodeURIComponent(storagePath);
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media`;

    console.log(`[ChartPackService] Downloading points.mbtiles for ${districtId}...`);
    const { downloadAsync } = FileSystem;
    const result = await downloadAsync(url, compressedPath);

    if (result.status !== 200) {
      console.log(`[ChartPackService] No points.mbtiles.zip for ${districtId} (${result.status})`);
      return false;
    }

    // Ensure mbtiles directory exists
    const dirInfo = await FileSystem.getInfoAsync(mbtilesDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(mbtilesDir, { intermediates: true });
    }

    // Snapshot files before extraction
    const filesBefore = new Set(await FileSystem.readDirectoryAsync(mbtilesDir));

    // Extract the zip file
    const { unzip: unzipFile } = await import('react-native-zip-archive');
    await unzipFile(compressedPath, mbtilesDir);

    // Clean up compressed file
    await FileSystem.deleteAsync(compressedPath, { idempotent: true });

    // Rename extracted file if needed (zip may contain 'points.mbtiles')
    const filesAfter = await FileSystem.readDirectoryAsync(mbtilesDir);
    const newFiles = filesAfter.filter(f => !filesBefore.has(f) && f.endsWith('.mbtiles'));

    const fileInfo = await FileSystem.getInfoAsync(finalPath);
    if (!fileInfo.exists && newFiles.length === 1) {
      const extractedPath = `${mbtilesDir}${newFiles[0]}`;
      console.log(`[ChartPackService] Renaming ${newFiles[0]} -> ${localFilename}`);
      await FileSystem.moveAsync({ from: extractedPath, to: finalPath });
    }

    // Verify the file exists
    const verifyInfo = await FileSystem.getInfoAsync(finalPath);
    if (!verifyInfo.exists) {
      console.warn(`[ChartPackService] points.mbtiles not found after extraction for ${districtId}`);
      return false;
    }

    const sizeMB = (verifyInfo.size || 0) / 1024 / 1024;
    console.log(`[ChartPackService] Cached points.mbtiles for ${districtId}: ${sizeMB.toFixed(1)} MB`);

    // Regenerate manifest so tile server can serve the points tiles
    await generateManifest();

    return true;
  } catch (error) {
    console.warn(`[ChartPackService] Error fetching points for ${districtId}:`, error);
    // Clean up on failure
    await FileSystem.deleteAsync(compressedPath, { idempotent: true }).catch(() => {});
    return false;
  }
}

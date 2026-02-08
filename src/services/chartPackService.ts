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
 */
export async function getDistrict(districtId: string): Promise<District | null> {
  try {
    const { firestore } = await import('../config/firebase');
    const { doc, getDoc } = await import('firebase/firestore');
    
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
 * Alaska uses 'alaska' for backward compatibility; others use their district ID.
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
  '17cgd': 'alaska', // legacy naming
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
};

/**
 * Basemap filename mapping per district.
 */
const BASEMAP_FILENAMES: Record<string, string> = {
  '01cgd': 'basemap_ne.mbtiles',
  '05cgd': 'basemap_ma.mbtiles',
  '07cgd': 'basemap_se.mbtiles',
  '08cgd': 'basemap_gc.mbtiles',
  '09cgd': 'basemap_gl.mbtiles',
  '11cgd': 'basemap_sw.mbtiles',
  '13cgd': 'basemap_pnw.mbtiles',
  '14cgd': 'basemap_hi.mbtiles',
  '17cgd': 'basemap_alaska.mbtiles',
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
};

/**
 * Get the file prefix for a district.
 */
function getDistrictPrefix(districtId: string): string {
  return DISTRICT_PREFIXES[districtId] || districtId;
}

/**
 * Map storage path to local filename.
 * e.g., '17cgd/charts/US4.mbtiles.zip' -> 'alaska_US4.mbtiles'
 * e.g., '11cgd/charts/US4.mbtiles.zip' -> 'd11_US4.mbtiles'
 */
function getLocalFilename(pack: DistrictDownloadPack, districtId: string): string {
  // Get the base filename from storage path
  const pathParts = pack.storagePath.split('/');
  const zipFilename = pathParts[pathParts.length - 1]; // e.g., 'US4.mbtiles.zip'
  const baseFilename = zipFilename.replace('.zip', ''); // e.g., 'US4.mbtiles'
  
  // Prefix with district name for charts
  if (pack.type === 'charts' && pack.band) {
    const prefix = getDistrictPrefix(districtId);
    return `${prefix}_${pack.band}.mbtiles`;
  }
  
  // GNIS files - use district-specific filenames
  if (pack.type === 'gnis') {
    return GNIS_FILENAMES[districtId] || baseFilename;
  }
  
  // Basemap files - use district-specific filenames
  if (pack.type === 'basemap') {
    return BASEMAP_FILENAMES[districtId] || baseFilename;
  }
  
  // Ocean and terrain files - use the base filename directly (per-zoom pattern)
  // e.g., ocean_z0-5.mbtiles, terrain_z8.mbtiles
  if (pack.type === 'ocean' || pack.type === 'terrain') {
    return baseFilename;
  }
  
  // For other types (satellite, etc.), use the base filename
  return baseFilename;
}

/**
 * Download a pack from Firebase Storage and extract it.
 */
export async function downloadPack(
  pack: DistrictDownloadPack,
  districtId: string,
  onProgress?: (status: PackDownloadStatus) => void
): Promise<boolean> {
  const { storage } = await import('../config/firebase');
  const { ref, getDownloadURL } = await import('firebase/storage');
  
  const mbtilesDir = await getMBTilesDir();
  const localFilename = getLocalFilename(pack, districtId);
  const zipFilename = `${pack.id}.zip`;
  const compressedPath = `${FileSystem.cacheDirectory}${zipFilename}`;
  const finalPath = `${mbtilesDir}${localFilename}`;
  
  console.log(`[ChartPackService] Downloading ${pack.id} from ${pack.storagePath}`);
  console.log(`[ChartPackService] Will save to ${finalPath}`);
  
  try {
    // Track download start time for speed calculations
    const downloadStartTime = Date.now();
    
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
    
    // Download the zip file
    const downloadResumable = FileSystem.createDownloadResumable(
      downloadUrl,
      compressedPath,
      {},
      (downloadProgress) => {
        const { totalBytesWritten, totalBytesExpectedToWrite } = downloadProgress;
        if (totalBytesExpectedToWrite > 0) {
          const percent = Math.round((totalBytesWritten / totalBytesExpectedToWrite) * 100);
          
          // Calculate download speed and ETA
          const elapsedMs = Date.now() - downloadStartTime;
          const elapsedSeconds = elapsedMs / 1000;
          const speedBps = elapsedSeconds > 0 ? totalBytesWritten / elapsedSeconds : 0;
          const remainingBytes = totalBytesExpectedToWrite - totalBytesWritten;
          const etaSeconds = speedBps > 0 ? remainingBytes / speedBps : undefined;
          
          onProgress?.({
            packId: pack.id,
            status: 'downloading',
            progress: percent,
            bytesDownloaded: totalBytesWritten,
            totalBytes: totalBytesExpectedToWrite,
            speedBps,
            etaSeconds,
          });
        }
      }
    );
    
    const result = await downloadResumable.downloadAsync();
    if (!result) {
      throw new Error('Download failed - no result returned');
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
    
    // Extract the zip file
    await unzip(compressedPath, mbtilesDir);
    
    // Clean up compressed file
    await FileSystem.deleteAsync(compressedPath, { idempotent: true });
    
    // Verify extraction
    const fileInfo = await FileSystem.getInfoAsync(finalPath);
    if (!fileInfo.exists) {
      // The zip might have extracted with a different name, check for it
      console.warn(`[ChartPackService] Expected file not found: ${finalPath}`);
      // List directory to see what was extracted
      const files = await FileSystem.readDirectoryAsync(mbtilesDir);
      console.log(`[ChartPackService] Files in directory: ${files.join(', ')}`);
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
    if (pack.type === 'charts') {
      await generateManifest(districtId);
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
      // Check for chart files (e.g., alaska_US4.mbtiles -> charts-US4)
      if (file.startsWith(`${prefix}_US`)) {
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
      // Check for GNIS (any district gnis file)
      else if (file.startsWith('gnis_names') && file.endsWith('.mbtiles')) {
        // Check if this GNIS belongs to the requested district
        const expectedGnis = GNIS_FILENAMES[districtId];
        if (file === expectedGnis || file === 'gnis_names.mbtiles') {
          installedPackIds.push('gnis');
        }
      }
      // Check for satellite files (e.g., satellite_z0-5.mbtiles -> satellite-z0-5)
      else if (file.startsWith('satellite_z')) {
        const zoomPart = file.replace('satellite_', '').replace('.mbtiles', '');
        installedPackIds.push(`satellite-${zoomPart}`);
      }
      // Check for ocean files (e.g., ocean_z0-5.mbtiles -> ocean-z0-5)
      else if (file.startsWith('ocean_z') && file.endsWith('.mbtiles')) {
        const zoomPart = file.replace('ocean_', '').replace('.mbtiles', '');
        installedPackIds.push(`ocean-${zoomPart}`);
      }
      // Check for terrain files (e.g., terrain_z0-5.mbtiles -> terrain-z0-5)
      else if (file.startsWith('terrain_z') && file.endsWith('.mbtiles')) {
        const zoomPart = file.replace('terrain_', '').replace('.mbtiles', '');
        installedPackIds.push(`terrain-${zoomPart}`);
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
        await generateManifest(districtId);
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
 * This function scans the mbtiles directory for alaska_US*.mbtiles files
 * and generates the manifest with the metadata the native server needs.
 */
export async function generateManifest(districtId: string): Promise<void> {
  try {
    const mbtilesDir = await getMBTilesDir();
    const dirInfo = await FileSystem.getInfoAsync(mbtilesDir);
    
    if (!dirInfo.exists) {
      console.log('[ChartPackService] No mbtiles directory - skipping manifest generation');
      return;
    }
    
    const files = await FileSystem.readDirectoryAsync(mbtilesDir);
    
    // Use generalized prefix and bounds mappings
    const prefix = getDistrictPrefix(districtId);
    const bounds = DISTRICT_BOUNDS[districtId] || { south: -90, west: -180, north: 90, east: 180 };
    
    // Zoom ranges for each chart scale
    const scaleZoomRanges: Record<string, { minZoom: number; maxZoom: number }> = {
      'US1': { minZoom: 0, maxZoom: 7 },
      'US2': { minZoom: 4, maxZoom: 10 },
      'US3': { minZoom: 7, maxZoom: 13 },
      'US4': { minZoom: 10, maxZoom: 16 },
      'US5': { minZoom: 12, maxZoom: 19 },
      'US6': { minZoom: 14, maxZoom: 22 },
    };
    
    const packs: Array<{
      id: string;
      bounds: typeof bounds;
      minZoom: number;
      maxZoom: number;
      fileSize: number;
    }> = [];
    
    for (const file of files) {
      // Match chart pack files: alaska_US1.mbtiles, alaska_US2.mbtiles, etc.
      if (file.startsWith(`${prefix}_US`) && file.endsWith('.mbtiles')) {
        const band = file.replace(`${prefix}_`, '').replace('.mbtiles', ''); // e.g., "US1"
        const packId = `${prefix}_${band}`; // e.g., "alaska_US1"
        
        // Get file size
        const filePath = `${mbtilesDir}${file}`;
        const fileInfo = await FileSystem.getInfoAsync(filePath, { size: true });
        const fileSize = fileInfo.exists && fileInfo.size ? fileInfo.size : 0;
        
        const zoomRange = scaleZoomRanges[band] || { minZoom: 0, maxZoom: 22 };
        
        packs.push({
          id: packId,
          bounds,
          minZoom: zoomRange.minZoom,
          maxZoom: zoomRange.maxZoom,
          fileSize,
        });
        
        console.log(`[ChartPackService] Manifest pack: ${packId} (${band}) z${zoomRange.minZoom}-${zoomRange.maxZoom}, ${(fileSize / 1024 / 1024).toFixed(1)} MB`);
      }
    }
    
    // Sort packs by scale level (US1 first, US6 last)
    packs.sort((a, b) => a.id.localeCompare(b.id));
    
    const manifest = { packs };
    const manifestPath = `${mbtilesDir}manifest.json`;
    
    await FileSystem.writeAsStringAsync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`[ChartPackService] Generated manifest.json with ${packs.length} chart packs at ${manifestPath}`);
    
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

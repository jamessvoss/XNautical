/**
 * Reference Data Service - Manages bundled reference data like GNIS place names
 * 
 * This service handles reference data that is separate from downloadable charts.
 * Reference data includes:
 * - GNIS (Geographic Names Information System) place names
 * - Future: port information, tide stations, etc.
 */

import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys
const STORAGE_KEYS = {
  GNIS_INSTALLED: '@XNautical:gnisInstalled',
  REFERENCE_DATA_VERSION: '@XNautical:referenceDataVersion',
} as const;

// Base directory for reference data - EXTERNAL storage (survives app uninstall)
const MBTILES_DIR = 'file:///storage/emulated/0/Android/data/com.xnautical.app/files/mbtiles/';

// Known GNIS datasets
export interface GNISDataset {
  id: string;
  name: string;
  region: string;
  filename: string;
  description: string;
  featureCount?: number;
  sizeMB?: number;
}

export const GNIS_DATASETS: GNISDataset[] = [
  {
    id: 'gnis_names',
    name: 'GNIS Place Names',
    region: 'Nationwide',
    filename: 'gnis_names.mbtiles',
    description: 'USGS Geographic Names - bays, capes, islands, mountains, etc.',
    featureCount: 29790,
    sizeMB: 27.4,
  },
  // Future datasets can be added here:
  // { id: 'gnis_names_wa', name: 'Washington Place Names', ... },
  // { id: 'gnis_names_or', name: 'Oregon Place Names', ... },
];

/**
 * Check if GNIS data is installed
 */
export async function isGNISInstalled(datasetId: string = 'gnis_names'): Promise<boolean> {
  try {
    const dataset = GNIS_DATASETS.find(d => d.id === datasetId);
    if (!dataset) return false;

    const filePath = `${MBTILES_DIR}${dataset.filename}`;
    const fileInfo = await FileSystem.getInfoAsync(filePath);
    return fileInfo.exists;
  } catch (error) {
    console.error('[ReferenceData] Error checking GNIS installation:', error);
    return false;
  }
}

/**
 * Get all installed GNIS datasets
 */
export async function getInstalledGNISDatasets(): Promise<GNISDataset[]> {
  const installed: GNISDataset[] = [];
  
  for (const dataset of GNIS_DATASETS) {
    if (await isGNISInstalled(dataset.id)) {
      installed.push(dataset);
    }
  }
  
  return installed;
}

/**
 * Get GNIS file path
 */
export function getGNISPath(datasetId: string = 'gnis_names'): string | null {
  const dataset = GNIS_DATASETS.find(d => d.id === datasetId);
  if (!dataset) return null;
  return `${MBTILES_DIR}${dataset.filename}`;
}

/**
 * Get size of installed GNIS data in bytes
 */
export async function getGNISSize(datasetId: string = 'gnis_names'): Promise<number> {
  try {
    const filePath = getGNISPath(datasetId);
    if (!filePath) return 0;
    
    const fileInfo = await FileSystem.getInfoAsync(filePath);
    if (fileInfo.exists && 'size' in fileInfo) {
      return fileInfo.size || 0;
    }
    return 0;
  } catch (error) {
    console.error('[ReferenceData] Error getting GNIS size:', error);
    return 0;
  }
}

/**
 * Delete GNIS data
 */
export async function deleteGNISData(datasetId: string = 'gnis_names'): Promise<void> {
  try {
    const filePath = getGNISPath(datasetId);
    if (!filePath) return;
    
    const fileInfo = await FileSystem.getInfoAsync(filePath);
    if (fileInfo.exists) {
      await FileSystem.deleteAsync(filePath);
      console.log(`[ReferenceData] Deleted GNIS data: ${datasetId}`);
    }
    
    // Clear installed flag
    await AsyncStorage.removeItem(`${STORAGE_KEYS.GNIS_INSTALLED}_${datasetId}`);
  } catch (error) {
    console.error('[ReferenceData] Error deleting GNIS data:', error);
    throw error;
  }
}

/**
 * Initialize reference data directory
 */
export async function initializeReferenceData(): Promise<void> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(MBTILES_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(MBTILES_DIR, { intermediates: true });
    }
    console.log('[ReferenceData] Reference data directory initialized');
  } catch (error) {
    console.error('[ReferenceData] Error initializing reference data:', error);
  }
}

/**
 * Get reference data statistics
 */
export async function getReferenceDataStats(): Promise<{
  gnisInstalled: boolean;
  gnisDatasets: GNISDataset[];
  totalSizeBytes: number;
}> {
  const gnisDatasets = await getInstalledGNISDatasets();
  
  let totalSize = 0;
  for (const dataset of gnisDatasets) {
    totalSize += await getGNISSize(dataset.id);
  }
  
  return {
    gnisInstalled: gnisDatasets.length > 0,
    gnisDatasets,
    totalSizeBytes: totalSize,
  };
}

// Feature class categories for filtering
export const GNIS_CATEGORIES = {
  water: {
    name: 'Water Features',
    description: 'Bays, channels, sounds, harbors',
    classes: ['Bay', 'Channel', 'Gut', 'Sea', 'Harbor', 'Inlet', 'Sound', 'Strait'],
    priority: 1,
    color: '#0066CC',
  },
  coastal: {
    name: 'Coastal Features',
    description: 'Capes, islands, beaches, bars',
    classes: ['Cape', 'Island', 'Beach', 'Bar', 'Isthmus', 'Pillar', 'Arch'],
    priority: 2,
    color: '#996633',
  },
  landmark: {
    name: 'Landmarks',
    description: 'Summits, glaciers, cliffs visible from sea',
    classes: ['Summit', 'Glacier', 'Cliff', 'Range', 'Ridge', 'Falls'],
    priority: 3,
    color: '#666666',
  },
  populated: {
    name: 'Populated Places',
    description: 'Towns, villages, ports',
    classes: ['Populated Place'],
    priority: 4,
    color: '#CC0000',
  },
  stream: {
    name: 'Streams & Rivers',
    description: 'Rivers, creeks, canals',
    classes: ['Stream', 'Canal', 'Rapids'],
    priority: 5,
    color: '#3399FF',
  },
  lake: {
    name: 'Lakes',
    description: 'Lakes, reservoirs, swamps',
    classes: ['Lake', 'Reservoir', 'Swamp'],
    priority: 6,
    color: '#66CCFF',
  },
  terrain: {
    name: 'Terrain',
    description: 'Valleys, basins, gaps',
    classes: ['Valley', 'Basin', 'Gap', 'Flat', 'Plain', 'Slope', 'Bench', 'Crater', 'Lava'],
    priority: 7,
    color: '#999966',
  },
  admin: {
    name: 'Administrative',
    description: 'Census areas, civil divisions, military',
    classes: ['Census', 'Civil', 'Military', 'Area', 'Crossing', 'Levee', 'Woods', 'Bend', 'Spring'],
    priority: 8,
    color: '#CC66CC',
  },
} as const;

export type GNISCategory = keyof typeof GNIS_CATEGORIES;

export default {
  isGNISInstalled,
  getInstalledGNISDatasets,
  getGNISPath,
  getGNISSize,
  deleteGNISData,
  initializeReferenceData,
  getReferenceDataStats,
  GNIS_DATASETS,
  GNIS_CATEGORIES,
};

/**
 * Chart Pack Types
 * 
 * Defines the structure for chart pack manifests and metadata.
 * Used for both local and remote (future) manifest files.
 */

export interface ChartPackBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface ChartPack {
  /** Unique identifier, matches filename without .mbtiles */
  id: string;
  
  /** Display name */
  name: string;
  
  /** Description for UI */
  description: string;
  
  /** Geographic bounds */
  bounds: ChartPackBounds;
  
  /** File size in bytes */
  fileSize: number;
  
  /** Number of source charts included */
  chartCount: number;
  
  /** Pack version (ISO date or semver) */
  version: string;
  
  /** Min zoom level available */
  minZoom: number;
  
  /** Max zoom level available */
  maxZoom: number;
  
  /** Optional: download URL for remote fetching (future) */
  downloadUrl?: string;
  
  /** Optional: SHA256 checksum for verification (future) */
  checksum?: string;
}

export interface BasePack {
  /** Unique identifier, matches filename without .mbtiles */
  id: string;
  
  /** Display name */
  name: string;
  
  /** Description for UI */
  description: string;
  
  /** Geographic bounds */
  bounds: ChartPackBounds;
  
  /** File size in bytes */
  fileSize: number;
  
  /** Number of features */
  featureCount: number;
  
  /** Pack version (ISO date or semver) */
  version: string;
  
  /** Min zoom level available */
  minZoom: number;
  
  /** Max zoom level available */
  maxZoom: number;
  
  /** Vector layer name */
  layer: string;
}

export interface ChartPackManifest {
  /** Manifest format version */
  manifestVersion: string;
  
  /** When this manifest was generated */
  generatedAt: string;
  
  /** Base packs loaded with every chart pack (e.g., place names) */
  basePacks: BasePack[];
  
  /** Available chart packs */
  packs: ChartPack[];
}

export interface InstalledChartPack extends ChartPack {
  /** When this pack was installed locally */
  installedAt: string;
  
  /** Local file path */
  localPath: string;
}

// ============================================
// Cloud Download Types (District-based)
// ============================================

/** Download pack from Firestore districts collection */
export interface DistrictDownloadPack {
  /** Unique identifier (e.g., 'charts-US4', 'basemap') */
  id: string;
  
  /** Type of content */
  type: 'charts' | 'predictions' | 'buoys' | 'basemap' | 'satellite' | 'ocean' | 'terrain' | 'gnis';
  
  /** For charts: scale band (US1, US2, etc.) */
  band?: string;
  
  /** Display name */
  name: string;
  
  /** Description for UI */
  description: string;
  
  /** Firebase Storage path (e.g., '17cgd/charts/US4.mbtiles.zip') */
  storagePath: string;
  
  /** Compressed file size in bytes */
  sizeBytes: number;
  
  /** Whether this pack is required for basic functionality */
  required: boolean;
}

/** District information from Firestore */
export interface District {
  /** District code (e.g., '17 CGD') */
  code: string;
  
  /** Display name (e.g., 'Alaska') */
  name: string;
  
  /** Primary timezone */
  timezone: string;
  
  /** Default map center [lng, lat] */
  defaultCenter: [number, number];
  
  /** Geographic bounds */
  bounds: {
    west: number;
    east: number;
    south: number;
    north: number;
  };
  
  /** States included in this district */
  states: string[];
  
  /** Available download packs */
  downloadPacks: DistrictDownloadPack[];
  
  /** Union bounding box of all chart scales (auto-computed during ENC conversion) */
  regionBoundary?: { west: number; south: number; east: number; north: number };

  /** US1 chart bounding boxes (auto-extracted during ENC conversion) */
  us1ChartBounds?: { name: string; west: number; south: number; east: number; north: number }[];
  
  /** Additional metadata from pre-generated metadata file */
  metadata?: {
    buoyCount?: number;
    marineZoneCount?: number;
    predictionSizes?: {
      tides?: number;
      currents?: number;
    };
    predictionSizeMB?: {
      tides?: number;
      currents?: number;
    };
  };
  
  /** Firestore timestamps */
  createdAt?: any;
  updatedAt?: any;
}

/** Download progress status */
export interface PackDownloadStatus {
  /** Pack being downloaded */
  packId: string;
  
  /** Current status */
  status: 'pending' | 'downloading' | 'extracting' | 'completed' | 'failed';
  
  /** Progress percentage (0-100) */
  progress: number;
  
  /** Bytes downloaded so far */
  bytesDownloaded: number;
  
  /** Total bytes to download */
  totalBytes: number;
  
  /** Error message if failed */
  error?: string;
  
  /** Download speed in bytes per second */
  speedBps?: number;
  
  /** Estimated time remaining in seconds */
  etaSeconds?: number;
}

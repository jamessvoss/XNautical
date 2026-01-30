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

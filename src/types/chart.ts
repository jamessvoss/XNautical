/**
 * TypeScript interfaces for nautical chart data
 */

// Feature types extracted from S-57 ENC files
export type FeatureType = 
  | 'depare'    // Depth Areas
  | 'depcnt'    // Depth Contours
  | 'soundg'    // Soundings
  | 'lndare'    // Land Areas
  | 'coalne'    // Coastline
  | 'lights'    // Navigation Lights
  | 'buoys'     // Buoys
  | 'beacons'   // Beacons
  | 'landmarks' // Landmarks
  | 'wrecks'    // Wrecks
  | 'uwtroc'    // Underwater Rocks
  | 'obstrn'    // Obstructions
  | 'slcons'    // Shoreline Constructions
  | 'cblare'    // Cable Areas
  | 'sbdare'    // Seabed Areas
  | 'seaare'    // Sea Areas
  | 'pipsol';   // Pipelines

export const ALL_FEATURE_TYPES: FeatureType[] = [
  'depare', 'depcnt', 'soundg', 'lndare', 'coalne',
  'lights', 'buoys', 'beacons', 'landmarks', 'wrecks',
  'uwtroc', 'obstrn', 'slcons', 'cblare', 'sbdare',
  'seaare', 'pipsol'
];

// Region IDs matching Cloud Run service
export type RegionId = 
  | 'overview'
  | 'southeast'
  | 'southcentral'
  | 'southwest'
  | 'western'
  | 'arctic'
  | 'interior';

// Region metadata from Firestore
export interface ChartRegion {
  id: RegionId;
  name: string;
  description: string;
  bounds: {
    west: number;
    east: number;
    south: number;
    north: number;
  };
  chartCount: number;
  totalSizeBytes: number;
  lastUpdated: Date;
}

// Chart metadata from Firestore
export interface ChartMetadata {
  chartId: string;
  name: string;
  region: RegionId;
  scaleType: 'overview' | 'general' | 'coastal' | 'approach' | 'harbor' | 'berthing';
  scale: number;
  bounds: [number, number, number, number] | null; // [west, south, east, north]
  center: [number, number] | null; // [lon, lat]
  fileSizeBytes: number;
  featureCounts: Record<FeatureType, number>;
  storagePath: string;
  noaaEdition: number;
  noaaUpdate: number;
  noaaIssueDate: string;
  lastUpdated: Date;
}

// Download status for a chart
export interface ChartDownloadStatus {
  chartId: string;
  isDownloaded: boolean;
  downloadedAt?: Date;
  sizeBytes?: number;
  featureTypes?: FeatureType[];
}

// Download progress
export interface DownloadProgress {
  chartId: string;
  totalFeatures: number;
  downloadedFeatures: number;
  currentFeature?: FeatureType;
  bytesDownloaded: number;
  totalBytes: number;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  error?: string;
}

// GeoJSON types
export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

export interface GeoJSONFeature {
  type: 'Feature';
  geometry: GeoJSONGeometry;
  properties: Record<string, unknown>;
}

export type GeoJSONGeometry = 
  | { type: 'Point'; coordinates: [number, number] | [number, number, number] }
  | { type: 'LineString'; coordinates: Array<[number, number]> }
  | { type: 'Polygon'; coordinates: Array<Array<[number, number]>> }
  | { type: 'MultiPoint'; coordinates: Array<[number, number]> }
  | { type: 'MultiLineString'; coordinates: Array<Array<[number, number]>> }
  | { type: 'MultiPolygon'; coordinates: Array<Array<Array<[number, number]>>> };

// Loaded chart data (in memory)
export interface LoadedChart {
  chartId: string;
  metadata: ChartMetadata;
  data: Partial<Record<FeatureType, GeoJSONFeatureCollection>>;
  loadedAt: Date;
}

// Cache status summary
export interface CacheStatus {
  totalCharts: number;
  downloadedCharts: number;
  totalSizeBytes: number;
  downloadedSizeBytes: number;
  chartsByRegion: Record<RegionId, {
    total: number;
    downloaded: number;
  }>;
}

/**
 * Chart Pack definitions for downloadable map regions
 */

export interface ChartPack {
  id: string;
  name: string;
  description: string;
  // Bounding box [west, south, east, north]
  bounds: [number, number, number, number];
  // Center point for map display [lon, lat]
  center: [number, number];
  // Zoom level for pack detail view
  zoom: number;
  // Visual polygon for map overlay (optional - defaults to bounds rectangle)
  polygon?: Array<[number, number]>;
  // Color for map display
  color: string;
  // Estimated download size (will be calculated from actual charts)
  estimatedSizeMB?: number;
}

export interface ChartPackWithCharts extends ChartPack {
  chartIds: string[];
  chartCount: number;
  totalSizeBytes: number;
  downloadedCount: number;
}

export interface PackDownloadProgress {
  packId: string;
  totalCharts: number;
  downloadedCharts: number;
  currentChartId?: string;
  totalBytes: number;
  downloadedBytes: number;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  error?: string;
}

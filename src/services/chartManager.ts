/**
 * Chart Manager - Integration layer for tiered chart loading
 * 
 * Integrates the chart index with the existing native tile server.
 * Provides smart chart discovery and loading based on viewport.
 * 
 * Current integration:
 * - Uses chart index for fast O(log n) chart discovery
 * - Leverages existing native tile server for HTTP tile serving
 * - Manages which charts are registered with the tile server
 * 
 * Future: Full Tier 1/2 memory+LRU implementation in native code
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as chartIndex from './chartIndex';
import * as tileServer from './tileServer';

// State
let isInitialized = false;
let mbtilesDir = '';
let registeredCharts: Set<string> = new Set();
let availableCharts: Set<string> = new Set();

export interface ChartManagerStatus {
  isInitialized: boolean;
  indexLoaded: boolean;
  tileServerReady: boolean;
  totalCharts: number;
  tier1Charts: number;
  tier2Charts: number;
  registeredCharts: number;
  availableCharts: number;
}

export interface InitOptions {
  mbtilesDirectory?: string;
  onProgress?: (message: string, progress: number) => void;
}

/**
 * Initialize the chart manager
 */
export async function initialize(options: InitOptions = {}): Promise<boolean> {
  const { onProgress } = options;
  mbtilesDir = options.mbtilesDirectory || `${FileSystem.documentDirectory}mbtiles`;
  
  console.log('[ChartManager] Initializing...');
  onProgress?.('Loading chart index...', 0);
  
  try {
    // Step 1: Load chart index
    const index = await chartIndex.loadChartIndex(`${mbtilesDir}/chart_index.json`);
    
    if (index) {
      console.log(`[ChartManager] Index loaded: ${index.stats.totalCharts} charts`);
      onProgress?.('Chart index loaded', 0.2);
    } else {
      console.log('[ChartManager] No index found, will scan directory');
    }
    
    // Step 2: Scan for available mbtiles files
    onProgress?.('Scanning charts...', 0.3);
    await scanAvailableCharts();
    
    // Step 3: Start tile server
    onProgress?.('Starting tile server...', 0.5);
    const serverUrl = await tileServer.startTileServer({ mbtilesDir });
    
    if (!serverUrl) {
      console.error('[ChartManager] Failed to start tile server');
      return false;
    }
    
    // Step 4: Register charts with tile server
    // If we have index, register Tier 1 charts first (most important)
    // Then register some Tier 2 charts based on likely viewport
    onProgress?.('Registering charts...', 0.7);
    
    if (index) {
      // Register all Tier 1 charts (overview/general/coastal)
      const tier1 = chartIndex.getTier1Charts().filter(id => availableCharts.has(id));
      console.log(`[ChartManager] Registering ${tier1.length} Tier 1 charts`);
      
      for (const chartId of tier1) {
        await registerChart(chartId);
      }
      
      // Register some Tier 2 charts (approach/harbor)
      // In the future, this will be dynamic based on viewport
      const tier2 = chartIndex.getTier2Charts().filter(id => availableCharts.has(id));
      const tier2ToRegister = tier2.slice(0, 50); // Limit initial registration
      console.log(`[ChartManager] Registering ${tier2ToRegister.length} initial Tier 2 charts`);
      
      for (const chartId of tier2ToRegister) {
        await registerChart(chartId);
      }
    } else {
      // No index - register all available charts (legacy behavior)
      for (const chartId of availableCharts) {
        await registerChart(chartId);
      }
    }
    
    // Preload databases
    onProgress?.('Preloading databases...', 0.9);
    await tileServer.preloadDatabases(Array.from(registeredCharts));
    
    isInitialized = true;
    onProgress?.('Ready', 1.0);
    
    console.log(`[ChartManager] Initialization complete`);
    console.log(`[ChartManager] Registered ${registeredCharts.size} of ${availableCharts.size} available charts`);
    
    return true;
    
  } catch (error) {
    console.error('[ChartManager] Initialization failed:', error);
    return false;
  }
}

/**
 * Scan for available mbtiles files
 */
async function scanAvailableCharts(): Promise<void> {
  availableCharts.clear();
  
  try {
    const dirInfo = await FileSystem.getInfoAsync(mbtilesDir);
    if (!dirInfo.exists) {
      console.warn(`[ChartManager] Directory not found: ${mbtilesDir}`);
      return;
    }
    
    const files = await FileSystem.readDirectoryAsync(mbtilesDir);
    
    for (const filename of files) {
      if (filename.endsWith('.mbtiles')) {
        // Skip non-chart files
        if (filename.startsWith('gnis_') || filename.startsWith('BATHY_')) {
          continue;
        }
        
        const chartId = filename.replace('.mbtiles', '');
        availableCharts.add(chartId);
      }
    }
    
    console.log(`[ChartManager] Found ${availableCharts.size} chart files`);
    
  } catch (error) {
    console.error('[ChartManager] Error scanning charts:', error);
  }
}

/**
 * Register a chart with the tile server
 */
async function registerChart(chartId: string): Promise<boolean> {
  if (registeredCharts.has(chartId)) {
    return true;
  }
  
  if (!availableCharts.has(chartId)) {
    return false;
  }
  
  registeredCharts.add(chartId);
  return true;
}

/**
 * Get charts for the current viewport
 * Uses the index tree for fast lookup
 */
export function getChartsForViewport(
  centerLon: number,
  centerLat: number,
  zoom: number
): { tier1: string[]; tier2: string[]; all: string[] } {
  if (chartIndex.isIndexLoaded()) {
    const result = chartIndex.findChartsForViewport(centerLon, centerLat, zoom);
    return {
      tier1: result.tier1.filter(id => availableCharts.has(id)),
      tier2: result.tier2.filter(id => availableCharts.has(id)),
      all: [...result.tier1, ...result.tier2].filter(id => availableCharts.has(id)),
    };
  }
  
  // Fallback: return all registered charts
  return {
    tier1: [],
    tier2: [],
    all: Array.from(registeredCharts),
  };
}

/**
 * Ensure charts are registered for a viewport
 * Call this when the user pans to a new area
 */
export async function ensureChartsForViewport(
  centerLon: number,
  centerLat: number,
  zoom: number
): Promise<string[]> {
  const { tier2 } = getChartsForViewport(centerLon, centerLat, zoom);
  
  const newlyRegistered: string[] = [];
  
  for (const chartId of tier2) {
    if (!registeredCharts.has(chartId)) {
      await registerChart(chartId);
      newlyRegistered.push(chartId);
    }
  }
  
  if (newlyRegistered.length > 0) {
    console.log(`[ChartManager] Registered ${newlyRegistered.length} new charts for viewport`);
    // Preload the new databases
    await tileServer.preloadDatabases(newlyRegistered);
  }
  
  return newlyRegistered;
}

/**
 * Get tile URL template for a chart
 */
export function getTileUrl(chartId: string): string | null {
  if (!registeredCharts.has(chartId)) {
    return null;
  }
  return tileServer.getTileUrlTemplate(chartId);
}

/**
 * Get all registered chart IDs sorted by scale (for proper quilting)
 */
export function getRegisteredCharts(): string[] {
  const charts = Array.from(registeredCharts);
  
  // Sort by scale level (US1 first, US5 last)
  charts.sort((a, b) => {
    const getLevel = (id: string) => {
      const match = id.match(/^US(\d)/);
      return match ? parseInt(match[1], 10) : 5;
    };
    return getLevel(a) - getLevel(b);
  });
  
  return charts;
}

/**
 * Get status information
 */
export function getStatus(): ChartManagerStatus {
  const indexStats = chartIndex.getStats();
  
  return {
    isInitialized,
    indexLoaded: chartIndex.isIndexLoaded(),
    tileServerReady: tileServer.isServerRunning(),
    totalCharts: indexStats?.totalCharts || availableCharts.size,
    tier1Charts: indexStats?.tier1.chartCount || 0,
    tier2Charts: indexStats?.tier2.chartCount || 0,
    registeredCharts: registeredCharts.size,
    availableCharts: availableCharts.size,
  };
}

/**
 * Get chart info from index
 */
export function getChartInfo(chartId: string) {
  return chartIndex.getChartInfo(chartId);
}

/**
 * Shutdown the chart manager
 */
export async function shutdown(): Promise<void> {
  console.log('[ChartManager] Shutting down...');
  
  await tileServer.stopTileServer();
  chartIndex.clearIndex();
  
  registeredCharts.clear();
  availableCharts.clear();
  isInitialized = false;
  
  console.log('[ChartManager] Shutdown complete');
}

/**
 * Check if a chart is available (file exists)
 */
export function isChartAvailable(chartId: string): boolean {
  return availableCharts.has(chartId);
}

/**
 * Check if a chart is registered with the tile server
 */
export function isChartRegistered(chartId: string): boolean {
  return registeredCharts.has(chartId);
}

/**
 * Get server URL
 */
export function getServerUrl(): string | null {
  return tileServer.getServerUrl();
}

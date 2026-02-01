/**
 * State Reporter Service
 * 
 * Provides comprehensive system state reporting:
 * - App and device information
 * - Runtime state collection
 * - On-demand state dumps
 * - State serialization for sharing
 */

import { Platform, Dimensions } from 'react-native';
import { logger, LogCategory } from './loggingService';
import { performanceTracker } from './performanceTracker';
import Constants from 'expo-constants';

// App information
interface AppInfo {
  name: string;
  version: string;
  buildNumber: string;
  bundleId: string;
  expoVersion?: string;
}

// Device information
interface DeviceInfo {
  platform: string;
  osVersion: string;
  model?: string;
  brand?: string;
  screenWidth: number;
  screenHeight: number;
  pixelRatio: number;
}

// Chart state
interface ChartState {
  chartsLoaded: number;
  chartTypes: Record<string, number>;
  mbtilesCharts: string[];
  geojsonCharts: string[];
  specialFiles: {
    gnis: boolean;
    basemap: boolean;
    satelliteCount: number;
  };
}

// Map state
interface MapState {
  center: [number, number] | null;
  zoom: number;
  style: string;
  activeLayers: string[];
  visibleCharts: string[];
}

// GPS state
interface GPSState {
  isTracking: boolean;
  hasPermission: boolean;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  lastUpdate: number | null;
}

// Tile server state
interface TileServerState {
  isRunning: boolean;
  port: number;
  requestCount: number;
  errorCount: number;
}

// Cache state
interface CacheState {
  chartCacheSize: number;
  tileCacheSize: number;
  memoryCacheCharts: number;
}

// Full state report
interface StateReport {
  timestamp: string;
  app: AppInfo;
  device: DeviceInfo;
  charts: ChartState;
  map: MapState;
  gps: GPSState;
  tileServer: TileServerState;
  cache: CacheState;
  performance: ReturnType<typeof performanceTracker.getReport>;
  logging: ReturnType<typeof logger.getFullState>;
}

// State provider callback type
type StateProvider<T> = () => T | Promise<T>;

class StateReporter {
  // Registered state providers
  private chartStateProvider: StateProvider<ChartState> | null = null;
  private mapStateProvider: StateProvider<MapState> | null = null;
  private gpsStateProvider: StateProvider<GPSState> | null = null;
  private tileServerStateProvider: StateProvider<TileServerState> | null = null;
  private cacheStateProvider: StateProvider<CacheState> | null = null;

  // ===========================================
  // Static Info (doesn't change at runtime)
  // ===========================================

  /**
   * Get app information
   */
  getAppInfo(): AppInfo {
    return {
      name: Constants.expoConfig?.name ?? 'XNautical',
      version: Constants.expoConfig?.version ?? '1.0.0',
      buildNumber: Constants.expoConfig?.ios?.buildNumber ?? 
                   Constants.expoConfig?.android?.versionCode?.toString() ?? '1',
      bundleId: Constants.expoConfig?.ios?.bundleIdentifier ?? 
                Constants.expoConfig?.android?.package ?? 'com.xnautical.app',
      expoVersion: Constants.expoVersion ?? undefined,
    };
  }

  /**
   * Get device information
   */
  getDeviceInfo(): DeviceInfo {
    const { width, height } = Dimensions.get('window');
    const { fontScale, scale } = Dimensions.get('window');
    
    return {
      platform: Platform.OS,
      osVersion: Platform.Version?.toString() ?? 'unknown',
      model: Platform.select({
        ios: undefined, // Would need expo-device
        android: undefined, // Would need expo-device
        default: undefined,
      }),
      brand: undefined, // Would need expo-device
      screenWidth: width,
      screenHeight: height,
      pixelRatio: scale,
    };
  }

  // ===========================================
  // State Provider Registration
  // ===========================================

  /**
   * Register a chart state provider
   */
  registerChartStateProvider(provider: StateProvider<ChartState>): void {
    this.chartStateProvider = provider;
  }

  /**
   * Register a map state provider
   */
  registerMapStateProvider(provider: StateProvider<MapState>): void {
    this.mapStateProvider = provider;
  }

  /**
   * Register a GPS state provider
   */
  registerGPSStateProvider(provider: StateProvider<GPSState>): void {
    this.gpsStateProvider = provider;
  }

  /**
   * Register a tile server state provider
   */
  registerTileServerStateProvider(provider: StateProvider<TileServerState>): void {
    this.tileServerStateProvider = provider;
  }

  /**
   * Register a cache state provider
   */
  registerCacheStateProvider(provider: StateProvider<CacheState>): void {
    this.cacheStateProvider = provider;
  }

  // ===========================================
  // State Collection
  // ===========================================

  /**
   * Get chart state (from registered provider or default)
   */
  private async getChartState(): Promise<ChartState> {
    if (this.chartStateProvider) {
      return await this.chartStateProvider();
    }
    return {
      chartsLoaded: 0,
      chartTypes: {},
      mbtilesCharts: [],
      geojsonCharts: [],
      specialFiles: { gnis: false, basemap: false, satelliteCount: 0 },
    };
  }

  /**
   * Get map state (from registered provider or default)
   */
  private async getMapState(): Promise<MapState> {
    if (this.mapStateProvider) {
      return await this.mapStateProvider();
    }
    return {
      center: null,
      zoom: 0,
      style: 'unknown',
      activeLayers: [],
      visibleCharts: [],
    };
  }

  /**
   * Get GPS state (from registered provider or default)
   */
  private async getGPSState(): Promise<GPSState> {
    if (this.gpsStateProvider) {
      return await this.gpsStateProvider();
    }
    return {
      isTracking: false,
      hasPermission: false,
      latitude: null,
      longitude: null,
      accuracy: null,
      speed: null,
      heading: null,
      lastUpdate: null,
    };
  }

  /**
   * Get tile server state (from registered provider or default)
   */
  private async getTileServerState(): Promise<TileServerState> {
    if (this.tileServerStateProvider) {
      return await this.tileServerStateProvider();
    }
    return {
      isRunning: false,
      port: 0,
      requestCount: 0,
      errorCount: 0,
    };
  }

  /**
   * Get cache state (from registered provider or default)
   */
  private async getCacheState(): Promise<CacheState> {
    if (this.cacheStateProvider) {
      return await this.cacheStateProvider();
    }
    return {
      chartCacheSize: 0,
      tileCacheSize: 0,
      memoryCacheCharts: 0,
    };
  }

  // ===========================================
  // Full State Report
  // ===========================================

  /**
   * Generate a comprehensive state report
   */
  async generateReport(): Promise<StateReport> {
    logger.debug(LogCategory.STARTUP, 'Generating state report...');
    
    const [charts, map, gps, tileServer, cache] = await Promise.all([
      this.getChartState(),
      this.getMapState(),
      this.getGPSState(),
      this.getTileServerState(),
      this.getCacheState(),
    ]);
    
    return {
      timestamp: new Date().toISOString(),
      app: this.getAppInfo(),
      device: this.getDeviceInfo(),
      charts,
      map,
      gps,
      tileServer,
      cache,
      performance: performanceTracker.getReport(),
      logging: logger.getFullState(),
    };
  }

  /**
   * Generate and log state report to console
   */
  async dumpState(): Promise<void> {
    const report = await this.generateReport();
    
    logger.logRaw('');
    logger.logRaw('╔══════════════════════════════════════════════════════════════════════╗');
    logger.logRaw('║                        SYSTEM STATE REPORT                           ║');
    logger.logRaw('╠══════════════════════════════════════════════════════════════════════╣');
    
    // App Info
    logger.logRaw('║ APP INFO:                                                            ║');
    logger.logRaw(`║   Name: ${report.app.name}`);
    logger.logRaw(`║   Version: ${report.app.version} (build ${report.app.buildNumber})`);
    logger.logRaw(`║   Bundle ID: ${report.app.bundleId}`);
    
    // Device Info
    logger.logRaw('╠══════════════════════════════════════════════════════════════════════╣');
    logger.logRaw('║ DEVICE INFO:                                                         ║');
    logger.logRaw(`║   Platform: ${report.device.platform} ${report.device.osVersion}`);
    logger.logRaw(`║   Screen: ${report.device.screenWidth}x${report.device.screenHeight} @${report.device.pixelRatio}x`);
    
    // Charts
    logger.logRaw('╠══════════════════════════════════════════════════════════════════════╣');
    logger.logRaw('║ CHARTS:                                                              ║');
    logger.logRaw(`║   Loaded: ${report.charts.chartsLoaded}`);
    logger.logRaw(`║   Types: ${JSON.stringify(report.charts.chartTypes)}`);
    logger.logRaw(`║   Special Files: GNIS=${report.charts.specialFiles.gnis}, Basemap=${report.charts.specialFiles.basemap}, Satellite=${report.charts.specialFiles.satelliteCount}`);
    
    // Map
    logger.logRaw('╠══════════════════════════════════════════════════════════════════════╣');
    logger.logRaw('║ MAP STATE:                                                           ║');
    logger.logRaw(`║   Center: ${report.map.center ? `[${report.map.center[0].toFixed(4)}, ${report.map.center[1].toFixed(4)}]` : 'N/A'}`);
    logger.logRaw(`║   Zoom: ${report.map.zoom.toFixed(1)}`);
    logger.logRaw(`║   Style: ${report.map.style}`);
    logger.logRaw(`║   Active Layers: ${report.map.activeLayers.length}`);
    
    // GPS
    logger.logRaw('╠══════════════════════════════════════════════════════════════════════╣');
    logger.logRaw('║ GPS STATE:                                                           ║');
    logger.logRaw(`║   Tracking: ${report.gps.isTracking}`);
    logger.logRaw(`║   Permission: ${report.gps.hasPermission}`);
    if (report.gps.latitude !== null) {
      logger.logRaw(`║   Position: [${report.gps.longitude?.toFixed(6)}, ${report.gps.latitude?.toFixed(6)}]`);
      logger.logRaw(`║   Accuracy: ${report.gps.accuracy?.toFixed(1)}m`);
    }
    
    // Tile Server
    logger.logRaw('╠══════════════════════════════════════════════════════════════════════╣');
    logger.logRaw('║ TILE SERVER:                                                         ║');
    logger.logRaw(`║   Status: ${report.tileServer.isRunning ? 'Running' : 'Stopped'}`);
    logger.logRaw(`║   Port: ${report.tileServer.port}`);
    logger.logRaw(`║   Requests: ${report.tileServer.requestCount} (errors: ${report.tileServer.errorCount})`);
    
    // Cache
    logger.logRaw('╠══════════════════════════════════════════════════════════════════════╣');
    logger.logRaw('║ CACHE:                                                               ║');
    logger.logRaw(`║   Chart Cache: ${report.cache.chartCacheSize}`);
    logger.logRaw(`║   Tile Cache: ${report.cache.tileCacheSize}`);
    logger.logRaw(`║   Memory Cache Charts: ${report.cache.memoryCacheCharts}`);
    
    // Performance Summary
    logger.logRaw('╠══════════════════════════════════════════════════════════════════════╣');
    logger.logRaw('║ PERFORMANCE:                                                         ║');
    logger.logRaw(`║   Startup: ${report.performance.startup.complete ? 'Complete' : 'In Progress'} (${report.performance.startup.totalTime}ms)`);
    logger.logRaw(`║   Memory Peak: ${report.performance.memory.peak} MB`);
    
    // Logging Config
    logger.logRaw('╠══════════════════════════════════════════════════════════════════════╣');
    logger.logRaw('║ LOGGING:                                                             ║');
    logger.logRaw(`║   Level: ${['DEBUG', 'INFO', 'PERF', 'WARN', 'ERROR'][report.logging.config.logLevel]}`);
    logger.logRaw(`║   Timers Recorded: ${report.logging.timerHistory.length}`);
    
    logger.logRaw('╚══════════════════════════════════════════════════════════════════════╝');
    logger.logRaw('');
    
    logger.info(LogCategory.STARTUP, 'State report generated');
  }

  /**
   * Get state report as JSON string
   */
  async getStateAsJson(): Promise<string> {
    const report = await this.generateReport();
    return JSON.stringify(report, null, 2);
  }

  /**
   * Get a quick summary for display
   */
  async getQuickSummary(): Promise<{
    app: string;
    device: string;
    charts: string;
    memory: string;
    startup: string;
  }> {
    const report = await this.generateReport();
    
    return {
      app: `${report.app.name} v${report.app.version}`,
      device: `${report.device.platform} ${report.device.osVersion}`,
      charts: `${report.charts.chartsLoaded} charts loaded`,
      memory: `${report.performance.memory.peak} MB peak`,
      startup: `${report.performance.startup.totalTime}ms`,
    };
  }
}

// Export singleton instance
export const stateReporter = new StateReporter();

// Export types
export type { StateReport, AppInfo, DeviceInfo, ChartState, MapState, GPSState, TileServerState, CacheState };

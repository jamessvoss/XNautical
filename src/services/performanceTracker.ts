/**
 * Performance Tracker Service
 * 
 * Specialized performance tracking for:
 * - Startup phases with detailed timing
 * - Runtime metrics collection
 * - Memory tracking integration
 * - Aggregated statistics and reporting
 */

import { logger, LogCategory } from './loggingService';

// Startup phases in order
export enum StartupPhase {
  APP_LAUNCH = 'appLaunch',
  AUTH_CHECK = 'authCheck',
  DIRECTORY_SETUP = 'directorySetup',
  MANIFEST_LOAD = 'manifestLoad',
  CHART_DISCOVERY = 'chartDiscovery',
  SPECIAL_FILES = 'specialFiles',
  TILE_SERVER_START = 'tileServerStart',
  GEOJSON_LOAD = 'geoJsonLoad',
  DISPLAY_SETTINGS = 'displaySettings',
  FIRST_RENDER = 'firstRender',
  INTERACTIVE = 'interactive',
}

// Startup phase timing entry
interface PhaseEntry {
  phase: StartupPhase;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

// Runtime metric types
export enum RuntimeMetric {
  MAP_TAP = 'mapTap',
  STYLE_SWITCH = 'styleSwitch',
  TILE_LOAD = 'tileLoad',
  GPS_UPDATE = 'gpsUpdate',
  FEATURE_QUERY = 'featureQuery',
  LAYER_TOGGLE = 'layerToggle',
  ZOOM_CHANGE = 'zoomChange',
  PAN = 'pan',
}

// Runtime metric entry
interface RuntimeMetricEntry {
  metric: RuntimeMetric;
  timestamp: number;
  duration?: number;
  data?: Record<string, any>;
}

// Memory snapshot
interface MemorySnapshot {
  timestamp: number;
  totalPss?: number;
  nativePss?: number;
  graphicsPss?: number;
  javaPss?: number;
  systemAvailable?: number;
  systemTotal?: number;
}

class PerformanceTracker {
  private startupStartTime: number = 0;
  private startupPhases: Map<StartupPhase, PhaseEntry> = new Map();
  private currentPhase: StartupPhase | null = null;
  private startupComplete: boolean = false;
  
  private runtimeMetrics: RuntimeMetricEntry[] = [];
  private maxRuntimeMetrics: number = 500;
  
  private memorySnapshots: MemorySnapshot[] = [];
  private maxMemorySnapshots: number = 60; // 1 minute at 1s intervals
  
  private metricAggregates: Map<RuntimeMetric, {
    count: number;
    totalDuration: number;
    minDuration: number;
    maxDuration: number;
  }> = new Map();

  // ===========================================
  // Startup Phase Tracking
  // ===========================================

  /**
   * Mark the beginning of app startup
   */
  beginStartup(): void {
    this.startupStartTime = performance.now();
    this.startupComplete = false;
    this.startupPhases.clear();
    logger.info(LogCategory.STARTUP, 'App startup begin');
  }

  /**
   * Start tracking a startup phase
   */
  startPhase(phase: StartupPhase, metadata?: Record<string, any>): void {
    const now = performance.now();
    
    // End the previous phase if there was one
    if (this.currentPhase && this.currentPhase !== phase) {
      this.endPhase(this.currentPhase);
    }
    
    const entry: PhaseEntry = {
      phase,
      startTime: now,
      metadata,
    };
    
    this.startupPhases.set(phase, entry);
    this.currentPhase = phase;
    
    logger.debug(LogCategory.STARTUP, `Phase started: ${phase}`, metadata);
  }

  /**
   * End tracking a startup phase
   */
  endPhase(phase: StartupPhase, metadata?: Record<string, any>): number {
    const entry = this.startupPhases.get(phase);
    if (!entry) {
      return -1;
    }
    
    const now = performance.now();
    entry.endTime = now;
    entry.duration = Math.round(now - entry.startTime);
    
    if (metadata) {
      entry.metadata = { ...entry.metadata, ...metadata };
    }
    
    // Record in logger's performance metrics
    logger.recordStartupMetric(phase as any, entry.duration);
    
    logger.perf(LogCategory.STARTUP, `Phase ${phase}: ${entry.duration}ms`, entry.metadata);
    
    if (this.currentPhase === phase) {
      this.currentPhase = null;
    }
    
    return entry.duration;
  }

  /**
   * Mark startup as complete and log summary
   */
  completeStartup(): number {
    if (this.startupComplete) {
      return Math.round(performance.now() - this.startupStartTime);
    }

    if (this.currentPhase) {
      this.endPhase(this.currentPhase);
    }

    const totalDuration = Math.round(performance.now() - this.startupStartTime);
    this.startupComplete = true;
    
    // Record total startup time
    logger.recordStartupMetric('totalStartup', totalDuration);
    logger.setStartupParam('startupTime', totalDuration);
    
    // Log summary
    this.logStartupSummary(totalDuration);
    
    return totalDuration;
  }

  /**
   * Log a formatted startup summary
   */
  private logStartupSummary(totalDuration: number): void {
    const W = 53; // inner width between ║ markers
    const params = logger.getStartupParams();

    const pad = (s: string) => `║  ${s}`.padEnd(W + 1) + '║';
    const divider = '╠' + '═'.repeat(W) + '╣';

    // Header
    const version = params.appVersion || '?';
    const build = params.buildNumber || '?';
    const device = params.deviceModel || 'Unknown device';
    const os = params.osVersion || '';
    const headerLine = `XNAUTICAL v${version} (${build})`;
    const deviceLine = `${device} · ${params.platform || ''} ${os}`;

    logger.logRaw('');
    logger.logRaw('╔' + '═'.repeat(W) + '╗');
    logger.logRaw(`║${headerLine.padStart(Math.floor((W + headerLine.length) / 2)).padEnd(W)}║`);
    logger.logRaw(`║${deviceLine.padStart(Math.floor((W + deviceLine.length) / 2)).padEnd(W)}║`);
    logger.logRaw(divider);

    // Phase timings
    const phases = Array.from(this.startupPhases.values())
      .sort((a, b) => a.startTime - b.startTime);

    const phaseNames: Record<string, string> = {
      directorySetup: 'Directory Setup',
      manifestLoad: 'Manifest Load',
      specialFiles: 'Special Files',
      chartDiscovery: 'Chart Discovery',
      tileServerStart: 'Tile Server',
      geoJsonLoad: 'GeoJSON Load',
      displaySettings: 'Display Settings',
    };

    for (const entry of phases) {
      const name = phaseNames[entry.phase] || entry.phase;
      const dur = entry.duration ?? 0;
      const dots = '.'.repeat(Math.max(1, 28 - name.length));
      const line = `${name} ${dots} ${dur.toString().padStart(5)}ms`;
      logger.logRaw(pad(line));
    }

    logger.logRaw(divider);
    logger.logRaw(pad(`Total: ${totalDuration}ms${totalDuration > 5000 ? ' ⚠ SLOW' : ''}`));
    logger.logRaw(divider);

    // Data statistics from startup params
    const lines: string[] = [];

    if (params.installedDistricts) {
      lines.push(`Districts: ${params.installedDistricts}`);
    }
    if (params.chartsLoaded !== undefined) {
      const chartMB = params.chartStorageMB ? ` (${params.chartStorageMB} MB)` : '';
      lines.push(`Charts: ${params.chartsLoaded} packs${chartMB}`);
    }
    const sf = params.specialFiles as Record<string, any> | undefined;
    if (sf) {
      const parts: string[] = [];
      if (sf.satellite) parts.push(`Satellite: ${sf.satellite}`);
      if (sf.basemap) parts.push(`Basemap: ${sf.basemap}`);
      if (sf.ocean) parts.push(`Ocean: ${sf.ocean}`);
      if (sf.gnis) parts.push('GNIS: ✓');
      if (parts.length > 0) lines.push(parts.join(' · '));
    }
    if (params.stationCounts) {
      lines.push(`Stations: ${params.stationCounts}`);
    }
    if (params.displayMode) {
      lines.push(`Display: ${params.displayMode}`);
    }
    if (params.tileServerPort) {
      lines.push(`Tile Server: :${params.tileServerPort}`);
    }

    for (const line of lines) {
      logger.logRaw(pad(line));
    }

    logger.logRaw('╚' + '═'.repeat(W) + '╝');
    logger.logRaw('');

    // Warn if startup is slow
    if (totalDuration > 5000) {
      logger.warn(LogCategory.STARTUP, `Startup took ${(totalDuration / 1000).toFixed(1)}s - consider optimization`);
    }
  }

  /**
   * Get startup phase timing
   */
  getPhase(phase: StartupPhase): PhaseEntry | undefined {
    return this.startupPhases.get(phase);
  }

  /**
   * Get all startup phases
   */
  getAllPhases(): PhaseEntry[] {
    return Array.from(this.startupPhases.values());
  }

  /**
   * Check if startup is complete
   */
  isStartupComplete(): boolean {
    return this.startupComplete;
  }

  /**
   * Get total startup time
   */
  getStartupTime(): number {
    if (this.startupComplete) {
      return logger.getPerformanceMetrics().startup.totalStartup ?? 0;
    }
    return Math.round(performance.now() - this.startupStartTime);
  }

  // ===========================================
  // Runtime Metrics
  // ===========================================

  /**
   * Record a runtime metric
   */
  recordMetric(metric: RuntimeMetric, duration?: number, data?: Record<string, any>): void {
    const entry: RuntimeMetricEntry = {
      metric,
      timestamp: Date.now(),
      duration,
      data,
    };
    
    this.runtimeMetrics.push(entry);
    
    // Trim if needed
    if (this.runtimeMetrics.length > this.maxRuntimeMetrics) {
      this.runtimeMetrics = this.runtimeMetrics.slice(-this.maxRuntimeMetrics);
    }
    
    // Update aggregates
    if (duration !== undefined) {
      this.updateAggregate(metric, duration);
    }
    
    // Update logger's runtime metrics
    if (duration !== undefined) {
      switch (metric) {
        case RuntimeMetric.MAP_TAP:
          logger.recordRuntimeMetric('lastMapTap', duration);
          break;
        case RuntimeMetric.STYLE_SWITCH:
          logger.recordRuntimeMetric('lastStyleSwitch', duration);
          break;
        case RuntimeMetric.GPS_UPDATE:
          const count = logger.getPerformanceMetrics().runtime.gpsUpdateCount ?? 0;
          logger.recordRuntimeMetric('gpsUpdateCount', count + 1);
          logger.recordRuntimeMetric('lastGpsUpdate', Date.now());
          break;
      }
    }
  }

  /**
   * Start timing a runtime operation
   */
  startMetric(metric: RuntimeMetric): () => number {
    const startTime = performance.now();
    
    return () => {
      const duration = Math.round(performance.now() - startTime);
      this.recordMetric(metric, duration);
      return duration;
    };
  }

  /**
   * Update metric aggregates
   */
  private updateAggregate(metric: RuntimeMetric, duration: number): void {
    const existing = this.metricAggregates.get(metric) ?? {
      count: 0,
      totalDuration: 0,
      minDuration: Infinity,
      maxDuration: 0,
    };
    
    this.metricAggregates.set(metric, {
      count: existing.count + 1,
      totalDuration: existing.totalDuration + duration,
      minDuration: Math.min(existing.minDuration, duration),
      maxDuration: Math.max(existing.maxDuration, duration),
    });
  }

  /**
   * Get aggregated stats for a metric
   */
  getMetricStats(metric: RuntimeMetric): {
    count: number;
    average: number;
    min: number;
    max: number;
  } | null {
    const agg = this.metricAggregates.get(metric);
    if (!agg || agg.count === 0) return null;
    
    return {
      count: agg.count,
      average: Math.round(agg.totalDuration / agg.count),
      min: agg.minDuration === Infinity ? 0 : agg.minDuration,
      max: agg.maxDuration,
    };
  }

  /**
   * Get all metric aggregates
   */
  getAllMetricStats(): Map<RuntimeMetric, {
    count: number;
    average: number;
    min: number;
    max: number;
  }> {
    const result = new Map();
    
    this.metricAggregates.forEach((agg, metric) => {
      if (agg.count > 0) {
        result.set(metric, {
          count: agg.count,
          average: Math.round(agg.totalDuration / agg.count),
          min: agg.minDuration === Infinity ? 0 : agg.minDuration,
          max: agg.maxDuration,
        });
      }
    });
    
    return result;
  }

  /**
   * Get recent runtime metrics
   */
  getRecentMetrics(count: number = 50): RuntimeMetricEntry[] {
    return this.runtimeMetrics.slice(-count);
  }

  // ===========================================
  // Memory Tracking
  // ===========================================

  /**
   * Record a memory snapshot
   */
  recordMemorySnapshot(snapshot: Omit<MemorySnapshot, 'timestamp'>): void {
    const entry: MemorySnapshot = {
      ...snapshot,
      timestamp: Date.now(),
    };
    
    this.memorySnapshots.push(entry);
    
    // Trim if needed
    if (this.memorySnapshots.length > this.maxMemorySnapshots) {
      this.memorySnapshots = this.memorySnapshots.slice(-this.maxMemorySnapshots);
    }
    
    // Update logger's memory metrics
    if (snapshot.totalPss !== undefined) {
      logger.recordMemoryMetric('currentPss', snapshot.totalPss);
      
      const currentPeak = logger.getPerformanceMetrics().memory.peakPss ?? 0;
      if (snapshot.totalPss > currentPeak) {
        logger.recordMemoryMetric('peakPss', snapshot.totalPss);
      }
    }
    
    logger.recordMemoryMetric('lastUpdate', Date.now());
  }

  /**
   * Get memory snapshots
   */
  getMemorySnapshots(): MemorySnapshot[] {
    return [...this.memorySnapshots];
  }

  /**
   * Get memory trend (increase/decrease over last minute)
   */
  getMemoryTrend(): { change: number; percentage: number } | null {
    if (this.memorySnapshots.length < 2) return null;
    
    const recent = this.memorySnapshots.slice(-30); // Last 30 snapshots
    if (recent.length < 2) return null;
    
    const first = recent[0].totalPss ?? 0;
    const last = recent[recent.length - 1].totalPss ?? 0;
    
    if (first === 0) return null;
    
    const change = last - first;
    const percentage = Math.round((change / first) * 100);
    
    return { change, percentage };
  }

  // ===========================================
  // Reporting
  // ===========================================

  /**
   * Get a comprehensive performance report
   */
  getReport(): {
    startup: {
      complete: boolean;
      totalTime: number;
      phases: PhaseEntry[];
    };
    runtime: {
      metrics: Map<RuntimeMetric, { count: number; average: number; min: number; max: number }>;
      recentCount: number;
    };
    memory: {
      current: MemorySnapshot | null;
      peak: number;
      trend: { change: number; percentage: number } | null;
    };
  } {
    const lastMemory = this.memorySnapshots.length > 0 
      ? this.memorySnapshots[this.memorySnapshots.length - 1]
      : null;
    
    return {
      startup: {
        complete: this.startupComplete,
        totalTime: this.getStartupTime(),
        phases: this.getAllPhases(),
      },
      runtime: {
        metrics: this.getAllMetricStats(),
        recentCount: this.runtimeMetrics.length,
      },
      memory: {
        current: lastMemory,
        peak: logger.getPerformanceMetrics().memory.peakPss ?? 0,
        trend: this.getMemoryTrend(),
      },
    };
  }

  /**
   * Log a performance report summary
   */
  logReport(): void {
    const report = this.getReport();
    
    logger.logRaw('');
    logger.logRaw('╔══════════════════════════════════════════════════════════════╗');
    logger.logRaw('║                  PERFORMANCE REPORT                          ║');
    logger.logRaw('╠══════════════════════════════════════════════════════════════╣');
    
    logger.logRaw('║ STARTUP:');
    logger.logRaw(`║   Status: ${report.startup.complete ? 'Complete' : 'In Progress'}`);
    logger.logRaw(`║   Total Time: ${report.startup.totalTime}ms`);
    
    logger.logRaw('╠══════════════════════════════════════════════════════════════╣');
    logger.logRaw('║ RUNTIME METRICS:');
    report.runtime.metrics.forEach((stats, metric) => {
      logger.logRaw(`║   ${metric}: avg=${stats.average}ms, min=${stats.min}ms, max=${stats.max}ms (n=${stats.count})`);
    });
    
    logger.logRaw('╠══════════════════════════════════════════════════════════════╣');
    logger.logRaw('║ MEMORY:');
    if (report.memory.current) {
      logger.logRaw(`║   Current PSS: ${report.memory.current.totalPss ?? 'N/A'} MB`);
    }
    logger.logRaw(`║   Peak PSS: ${report.memory.peak} MB`);
    if (report.memory.trend) {
      const sign = report.memory.trend.change >= 0 ? '+' : '';
      logger.logRaw(`║   Trend: ${sign}${report.memory.trend.change} MB (${sign}${report.memory.trend.percentage}%)`);
    }
    
    logger.logRaw('╚══════════════════════════════════════════════════════════════╝');
    logger.logRaw('');
  }

  /**
   * Reset all tracking data
   */
  reset(): void {
    this.startupStartTime = 0;
    this.startupPhases.clear();
    this.currentPhase = null;
    this.startupComplete = false;
    this.runtimeMetrics = [];
    this.memorySnapshots = [];
    this.metricAggregates.clear();
  }
}

// Export singleton instance
export const performanceTracker = new PerformanceTracker();

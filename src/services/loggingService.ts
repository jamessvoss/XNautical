/**
 * Centralized Logging Service
 * 
 * Provides consistent logging with:
 * - Log levels (DEBUG, INFO, PERF, WARN, ERROR)
 * - Log categories (STARTUP, CHARTS, GPS, TILES, UI, NETWORK, MEMORY)
 * - Performance timing
 * - State reporting
 * - Production vs Development filtering
 */

import crashlytics from './crashlyticsService';
import { Platform } from 'react-native';

// Log levels in order of severity
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  PERF = 2,
  WARN = 3,
  ERROR = 4,
}

// Log categories for filtering
export enum LogCategory {
  STARTUP = 'STARTUP',
  CHARTS = 'CHARTS',
  GPS = 'GPS',
  TILES = 'TILES',
  UI = 'UI',
  NETWORK = 'NETWORK',
  MEMORY = 'MEMORY',
  SETTINGS = 'SETTINGS',
  AUTH = 'AUTH',
  CACHE = 'CACHE',
}

// ANSI color codes for terminal output
const Colors = {
  Reset: '\x1b[0m',
  // Foreground colors
  Gray: '\x1b[90m',
  Red: '\x1b[31m',
  Green: '\x1b[32m',
  Yellow: '\x1b[33m',
  Blue: '\x1b[34m',
  Magenta: '\x1b[35m',
  Cyan: '\x1b[36m',
  White: '\x1b[37m',
  // Bright versions
  BrightRed: '\x1b[91m',
  BrightYellow: '\x1b[93m',
  BrightCyan: '\x1b[96m',
};

// Startup parameters stored for state dumps
interface StartupParams {
  appVersion?: string;
  buildNumber?: string;
  platform?: string;
  osVersion?: string;
  deviceModel?: string;
  storagePath?: string;
  chartsLoaded?: number;
  chartTypes?: Record<string, number>;
  tileServerPort?: number;
  tileServerStatus?: string;
  manifestLoaded?: boolean;
  specialFiles?: {
    gnis: boolean;
    basemap: boolean;
    satellite: number;
  };
  startupTime?: number;
  [key: string]: any;
}

// Performance timing entry
interface TimerEntry {
  startTime: number;
  label: string;
}

// Performance metrics storage
interface PerformanceMetrics {
  startup: {
    appLaunch?: number;
    authCheck?: number;
    directorySetup?: number;
    manifestLoad?: number;
    chartDiscovery?: number;
    tileServerStart?: number;
    geoJsonLoad?: number;
    displaySettingsLoad?: number;
    totalStartup?: number;
  };
  runtime: {
    lastMapTap?: number;
    lastStyleSwitch?: number;
    avgTileLoadTime?: number;
    gpsUpdateCount?: number;
    lastGpsUpdate?: number;
  };
  memory: {
    peakPss?: number;
    currentPss?: number;
    lastUpdate?: number;
  };
}

class LoggingService {
  private currentLogLevel: LogLevel = __DEV__ ? LogLevel.DEBUG : LogLevel.WARN;
  private enabledCategories: Set<string> = new Set(Object.values(LogCategory));
  private disabledCategories: Set<string> = new Set();
  private startupParams: StartupParams = {};
  private performanceMetrics: PerformanceMetrics = {
    startup: {},
    runtime: {},
    memory: {},
  };
  private activeTimers: Map<string, TimerEntry> = new Map();
  private timerHistory: Array<{ label: string; duration: number; timestamp: number }> = [];
  private maxTimerHistory = 100;

  constructor() {
    // Initialize with platform info
    this.startupParams.platform = Platform.OS;
    this.startupParams.osVersion = Platform.Version?.toString();
  }

  // ===========================================
  // Core Logging Methods
  // ===========================================

  /**
   * Log a debug message (development only)
   */
  debug(category: LogCategory | string, message: string, data?: object): void {
    this.log(LogLevel.DEBUG, category, message, data);
  }

  /**
   * Log an info message
   */
  info(category: LogCategory | string, message: string, data?: object): void {
    this.log(LogLevel.INFO, category, message, data);
  }

  /**
   * Log a performance metric
   */
  perf(category: LogCategory | string, message: string, data?: object): void {
    this.log(LogLevel.PERF, category, message, data);
  }

  /**
   * Log a warning
   */
  warn(category: LogCategory | string, message: string, data?: object): void {
    this.log(LogLevel.WARN, category, message, data);
    
    // Send warnings to Crashlytics in production
    if (!__DEV__) {
      crashlytics.log(`[WARN][${category}] ${message}`);
    }
  }

  /**
   * Log an error
   */
  error(category: LogCategory | string, message: string, error?: Error | object): void {
    this.log(LogLevel.ERROR, category, message, error);
    
    // Send errors to Crashlytics
    if (error instanceof Error) {
      crashlytics.recordError(error, `[${category}] ${message}`);
    } else {
      crashlytics.log(`[ERROR][${category}] ${message}: ${JSON.stringify(error)}`);
    }
  }

  /**
   * Get a formatted timestamp string (HH:MM:SS.mmm)
   */
  getTimestamp(): string {
    return new Date().toISOString().split('T')[1].slice(0, 12);
  }

  /**
   * Get color code for a log level
   */
  private getLevelColor(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return Colors.Gray;
      case LogLevel.INFO:
        return Colors.Green;
      case LogLevel.PERF:
        return Colors.Cyan;
      case LogLevel.WARN:
        return Colors.Yellow;
      case LogLevel.ERROR:
        return Colors.BrightRed;
      default:
        return Colors.Reset;
    }
  }

  /**
   * Get a formatted log prefix with aligned columns and colors
   * Format: [HH:MM:SS.mmm][LEVEL ][CATEGORY  ]
   */
  getPrefix(level: LogLevel, category: string): string {
    const timestamp = this.getTimestamp();
    const levelName = LogLevel[level].padEnd(5); // DEBUG, INFO, PERF, WARN, ERROR - pad to 5
    const categoryName = category.padEnd(8); // Pad category to 8 chars for alignment
    const color = this.getLevelColor(level);
    // Color the entire line based on log level
    return `${color}[${timestamp}][${levelName}][${categoryName}]`;
  }

  /**
   * Log a raw line with timestamp prefix (for formatted output like boxes)
   * Uses matching bracket format for alignment with structured logs
   */
  logRaw(message: string): void {
    const timestamp = this.getTimestamp();
    // Match the bracket format: [timestamp][level][category] where level=5, category=8
    // Use white color for raw output (boxes, tables, etc.)
    console.log(`${Colors.White}[${timestamp}][     ][        ] ${message}${Colors.Reset}`);
  }

  /**
   * Core logging implementation
   */
  private log(level: LogLevel, category: string, message: string, data?: object): void {
    // Check if we should log this
    if (level < this.currentLogLevel) return;
    if (this.disabledCategories.has(category)) return;
    if (this.enabledCategories.size > 0 && !this.enabledCategories.has(category)) return;

    const prefix = this.getPrefix(level, category);

    // Format the log message with color reset at the end
    let logMessage = `${prefix} ${message}${Colors.Reset}`;
    
    // Choose appropriate console method
    const consoleMethod = this.getConsoleMethod(level);
    
    if (data !== undefined) {
      // For objects, log separately for better formatting
      if (typeof data === 'object' && data !== null) {
        consoleMethod(logMessage);
        consoleMethod(data);
      } else {
        consoleMethod(logMessage, data);
      }
    } else {
      consoleMethod(logMessage);
    }
  }

  private getConsoleMethod(level: LogLevel): (...args: any[]) => void {
    // Always use console.log so React Native shows consistent "LOG" prefix
    // The actual log level is shown in our own bracket prefix [DEBUG], [INFO], etc.
    return console.log;
  }

  // ===========================================
  // Performance Timing
  // ===========================================

  /**
   * Start a performance timer
   */
  startTimer(label: string): void {
    this.activeTimers.set(label, {
      startTime: performance.now(),
      label,
    });
  }

  /**
   * End a performance timer and return duration
   */
  endTimer(label: string): number {
    const timer = this.activeTimers.get(label);
    if (!timer) {
      this.warn(LogCategory.STARTUP, `Timer "${label}" was never started`);
      return -1;
    }

    const duration = Math.round(performance.now() - timer.startTime);
    this.activeTimers.delete(label);

    // Store in history
    this.timerHistory.push({
      label,
      duration,
      timestamp: Date.now(),
    });

    // Trim history if needed
    if (this.timerHistory.length > this.maxTimerHistory) {
      this.timerHistory = this.timerHistory.slice(-this.maxTimerHistory);
    }

    return duration;
  }

  /**
   * Measure and log a timed operation
   */
  time<T>(label: string, category: LogCategory | string, operation: () => T): T {
    this.startTimer(label);
    const result = operation();
    const duration = this.endTimer(label);
    this.perf(category, `${label}: ${duration}ms`);
    return result;
  }

  /**
   * Measure and log an async timed operation
   */
  async timeAsync<T>(label: string, category: LogCategory | string, operation: () => Promise<T>): Promise<T> {
    this.startTimer(label);
    const result = await operation();
    const duration = this.endTimer(label);
    this.perf(category, `${label}: ${duration}ms`);
    return result;
  }

  // ===========================================
  // Startup Parameters
  // ===========================================

  /**
   * Set a startup parameter
   */
  setStartupParam(key: string, value: any): void {
    this.startupParams[key] = value;
  }

  /**
   * Set multiple startup parameters
   */
  setStartupParams(params: Partial<StartupParams>): void {
    Object.assign(this.startupParams, params);
  }

  /**
   * Get all startup parameters
   */
  getStartupParams(): StartupParams {
    return { ...this.startupParams };
  }

  // ===========================================
  // Performance Metrics
  // ===========================================

  /**
   * Record a startup metric
   */
  recordStartupMetric(key: keyof PerformanceMetrics['startup'], value: number): void {
    this.performanceMetrics.startup[key] = value;
  }

  /**
   * Record a runtime metric
   */
  recordRuntimeMetric(key: keyof PerformanceMetrics['runtime'], value: number): void {
    this.performanceMetrics.runtime[key] = value;
  }

  /**
   * Record a memory metric
   */
  recordMemoryMetric(key: keyof PerformanceMetrics['memory'], value: number): void {
    this.performanceMetrics.memory[key] = value;
  }

  /**
   * Get all performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  /**
   * Get timer history
   */
  getTimerHistory(): Array<{ label: string; duration: number; timestamp: number }> {
    return [...this.timerHistory];
  }

  // ===========================================
  // State Reporting
  // ===========================================

  /**
   * Dump current state to console (formatted)
   */
  dumpState(): void {
    const state = this.getFullState();
    
    this.logRaw('');
    this.logRaw('╔══════════════════════════════════════════════════════════════╗');
    this.logRaw('║                    SYSTEM STATE DUMP                         ║');
    this.logRaw('╠══════════════════════════════════════════════════════════════╣');
    
    this.logRaw('║ STARTUP PARAMETERS:                                          ║');
    Object.entries(state.startupParams).forEach(([key, value]) => {
      const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
      this.logRaw(`║   ${key}: ${valueStr.substring(0, 50)}`);
    });
    
    this.logRaw('╠══════════════════════════════════════════════════════════════╣');
    this.logRaw('║ PERFORMANCE METRICS:                                         ║');
    this.logRaw('║   Startup:');
    Object.entries(state.performanceMetrics.startup).forEach(([key, value]) => {
      this.logRaw(`║     ${key}: ${value}ms`);
    });
    this.logRaw('║   Runtime:');
    Object.entries(state.performanceMetrics.runtime).forEach(([key, value]) => {
      this.logRaw(`║     ${key}: ${value}`);
    });
    this.logRaw('║   Memory:');
    Object.entries(state.performanceMetrics.memory).forEach(([key, value]) => {
      this.logRaw(`║     ${key}: ${value}`);
    });
    
    this.logRaw('╠══════════════════════════════════════════════════════════════╣');
    this.logRaw('║ LOGGING CONFIG:                                              ║');
    this.logRaw(`║   Log Level: ${LogLevel[state.config.logLevel]}`);
    this.logRaw(`║   Enabled Categories: ${state.config.enabledCategories.join(', ')}`);
    this.logRaw(`║   Disabled Categories: ${state.config.disabledCategories.join(', ') || 'none'}`);
    
    this.logRaw('╠══════════════════════════════════════════════════════════════╣');
    this.logRaw('║ RECENT TIMERS:                                               ║');
    state.timerHistory.slice(-10).forEach((timer) => {
      const time = new Date(timer.timestamp).toISOString().split('T')[1].slice(0, 8);
      this.logRaw(`║   [${time}] ${timer.label}: ${timer.duration}ms`);
    });
    
    this.logRaw('╚══════════════════════════════════════════════════════════════╝');
    this.logRaw('');
  }

  /**
   * Get full state as object (for UI display or serialization)
   */
  getFullState(): {
    startupParams: StartupParams;
    performanceMetrics: PerformanceMetrics;
    timerHistory: Array<{ label: string; duration: number; timestamp: number }>;
    config: {
      logLevel: LogLevel;
      enabledCategories: string[];
      disabledCategories: string[];
    };
  } {
    return {
      startupParams: { ...this.startupParams },
      performanceMetrics: { ...this.performanceMetrics },
      timerHistory: [...this.timerHistory],
      config: {
        logLevel: this.currentLogLevel,
        enabledCategories: Array.from(this.enabledCategories),
        disabledCategories: Array.from(this.disabledCategories),
      },
    };
  }

  /**
   * Get state as JSON string (for clipboard/sharing)
   */
  getStateAsJson(): string {
    return JSON.stringify(this.getFullState(), null, 2);
  }

  // ===========================================
  // Configuration
  // ===========================================

  /**
   * Set the minimum log level
   */
  setLogLevel(level: LogLevel): void {
    this.currentLogLevel = level;
    this.info(LogCategory.SETTINGS, `Log level set to ${LogLevel[level]}`);
  }

  /**
   * Get current log level
   */
  getLogLevel(): LogLevel {
    return this.currentLogLevel;
  }

  /**
   * Enable a specific category
   */
  enableCategory(category: LogCategory | string): void {
    this.enabledCategories.add(category);
    this.disabledCategories.delete(category);
  }

  /**
   * Disable a specific category
   */
  disableCategory(category: LogCategory | string): void {
    this.disabledCategories.add(category);
  }

  /**
   * Enable all categories
   */
  enableAllCategories(): void {
    this.enabledCategories = new Set(Object.values(LogCategory));
    this.disabledCategories.clear();
  }

  /**
   * Disable all categories except errors
   */
  disableAllCategories(): void {
    this.disabledCategories = new Set(Object.values(LogCategory));
  }

  /**
   * Check if a category is enabled
   */
  isCategoryEnabled(category: LogCategory | string): boolean {
    if (this.disabledCategories.has(category)) return false;
    if (this.enabledCategories.size === 0) return true;
    return this.enabledCategories.has(category);
  }

  // ===========================================
  // Utility Methods
  // ===========================================

  /**
   * Create a scoped logger for a specific category
   */
  scope(category: LogCategory | string): {
    debug: (message: string, data?: object) => void;
    info: (message: string, data?: object) => void;
    perf: (message: string, data?: object) => void;
    warn: (message: string, data?: object) => void;
    error: (message: string, error?: Error | object) => void;
  } {
    return {
      debug: (message: string, data?: object) => this.debug(category, message, data),
      info: (message: string, data?: object) => this.info(category, message, data),
      perf: (message: string, data?: object) => this.perf(category, message, data),
      warn: (message: string, data?: object) => this.warn(category, message, data),
      error: (message: string, error?: Error | object) => this.error(category, message, error),
    };
  }

  /**
   * Clear all stored data (for testing)
   */
  reset(): void {
    this.startupParams = {
      platform: Platform.OS,
      osVersion: Platform.Version?.toString(),
    };
    this.performanceMetrics = {
      startup: {},
      runtime: {},
      memory: {},
    };
    this.activeTimers.clear();
    this.timerHistory = [];
  }
}

// Export singleton instance
export const logger = new LoggingService();

// Export types for consumers
export type { StartupParams, PerformanceMetrics };

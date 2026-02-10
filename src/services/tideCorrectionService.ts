/**
 * Tide Correction Service
 * 
 * Manages real-time tide corrections for depth soundings.
 * Uses the nearest NOAA tide station to calculate current tide height above MLLW.
 */

import { interpolateTideHeight } from './tideInterpolation';
import { findNearestTideStation, getStationPredictionsForRange } from './stationService';
import type { TideStation, TideEvent } from './stationService';
import { logger, LogCategory } from './loggingService';

// Update interval in milliseconds (15 minutes - tides change slowly)
const UPDATE_INTERVAL_MS = 15 * 60 * 1000;

// Maximum distance to consider a tide station "nearby" (50 nautical miles in km)
const MAX_STATION_DISTANCE_KM = 50 * 1.852;

// Conversion: feet to meters (NOAA returns tide heights in feet, chart depths are in meters)
const FEET_TO_METERS = 0.3048;

class TideCorrectionService {
  private currentCorrectionMeters: number = 0;
  private currentStation: TideStation | null = null;
  private lastPosition: { lat: number; lng: number } | null = null;
  private lastUpdate: Date | null = null;
  private updateInterval: NodeJS.Timeout | null = null;
  private listeners: Set<(correction: number, station: TideStation | null) => void> = new Set();

  /**
   * Get the current tide correction in meters
   */
  getCurrentCorrection(): number {
    return this.currentCorrectionMeters;
  }

  /**
   * Get the current tide station being used
   */
  getCurrentStation(): TideStation | null {
    return this.currentStation;
  }

  /**
   * Update tide correction for a specific position
   * @param latitude - Latitude of the location
   * @param longitude - Longitude of the location
   * @param availableStations - Array of tide stations to search (optional, will use getCachedTideStations if not provided)
   */
  async updateTideCorrection(latitude: number, longitude: number, availableStations?: TideStation[]): Promise<void> {
    try {
      // Get stations array - either passed in or from cache
      let stations = availableStations;
      if (!stations) {
        const { getCachedTideStations } = await import('./stationService');
        stations = getCachedTideStations();
      }
      
      if (!stations || stations.length === 0) {
        console.log('[TideCorrectionService] No tide stations available - stations array is empty');
        logger.debug(LogCategory.TIDE, 'No tide stations available');
        this.currentCorrectionMeters = 0;
        this.currentStation = null;
        this.notifyListeners();
        return;
      }
      
      // Find nearest tide station
      console.log('[TideCorrectionService] Finding nearest station to:', latitude, longitude, 'from', stations.length, 'stations');
      const { findNearestTideStation } = await import('./stationService');
      const result = findNearestTideStation(latitude, longitude, stations);
      
      if (!result) {
        console.log('[TideCorrectionService] No nearby tide station found');
        logger.debug(LogCategory.TIDE, 'No tide stations available');
        this.currentCorrectionMeters = 0;
        this.currentStation = null;
        this.notifyListeners();
        return;
      }

      const { station, distance } = result;
      console.log('[TideCorrectionService] Found station:', station.name, 'at distance:', distance.toFixed(1), 'km');

      // Check if station is too far away
      if (distance > MAX_STATION_DISTANCE_KM) {
        console.log('[TideCorrectionService] Station too far:', distance.toFixed(1), 'km (max:', MAX_STATION_DISTANCE_KM, 'km)');
        logger.debug(LogCategory.TIDE, `Nearest tide station is ${distance.toFixed(1)}km away (max: ${MAX_STATION_DISTANCE_KM}km)`);
        this.currentCorrectionMeters = 0;
        this.currentStation = null;
        this.notifyListeners();
        return;
      }

      // Get today's date in YYYY-MM-DD format
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      
      // Also get tomorrow's date in case we need events that span into tomorrow
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      // Get tide predictions for today and tomorrow
      console.log('[TideCorrectionService] Fetching predictions for station:', station.id, 'dates:', today, '-', tomorrowStr);
      const predictions = await getStationPredictionsForRange(
        station.id,
        'tide',  // Specify tide station type
        now,     // Pass Date object for start
        tomorrow // Pass Date object for end
      );

      if (!predictions || predictions.length === 0) {
        console.log('[TideCorrectionService] No predictions available for station:', station.id, '- predictions may not be downloaded');
        logger.debug(LogCategory.TIDE, `No tide predictions available for station ${station.id}`);
        this.currentCorrectionMeters = 0;
        this.currentStation = null;
        this.notifyListeners();
        return;
      }
      
      console.log('[TideCorrectionService] Found', predictions.length, 'prediction events for today/tomorrow');

      // Convert predictions to TideEvent format for interpolation
      // Filter to just today's events plus a few from tomorrow for interpolation
      const todayEvents: TideEvent[] = predictions
        .filter(p => p.date === today)
        .map(p => ({
          time: p.time,
          height: p.height,
          type: p.type as 'H' | 'L',
        }));

      // Add first few events from tomorrow to handle interpolation near midnight
      const tomorrowEvents: TideEvent[] = predictions
        .filter(p => p.date === tomorrowStr)
        .slice(0, 2)
        .map(p => ({
          time: p.time,
          height: p.height,
          type: p.type as 'H' | 'L',
        }));

      const allEvents = [...todayEvents, ...tomorrowEvents];

      if (allEvents.length < 2) {
        logger.debug(LogCategory.TIDE, 'Not enough tide events for interpolation');
        this.currentCorrectionMeters = 0;
        this.currentStation = null;
        this.notifyListeners();
        return;
      }

      // Get current time as HH:MM
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const currentTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

      // Interpolate tide height at current time (returns feet)
      const tideHeightFeet = interpolateTideHeight(allEvents, currentTime);

      if (tideHeightFeet === null) {
        logger.debug(LogCategory.TIDE, 'Could not interpolate tide height');
        this.currentCorrectionMeters = 0;
        this.currentStation = null;
        this.notifyListeners();
        return;
      }

      // Convert feet to meters
      const tideHeightMeters = tideHeightFeet * FEET_TO_METERS;

      logger.debug(
        LogCategory.TIDE,
        `Tide correction updated: ${tideHeightFeet.toFixed(1)}ft (${tideHeightMeters.toFixed(2)}m) at station ${station.name}`
      );

      this.currentCorrectionMeters = tideHeightMeters;
      this.currentStation = station;
      this.lastPosition = { lat: latitude, lng: longitude };
      this.lastUpdate = now;
      this.notifyListeners();

    } catch (error) {
      logger.error(LogCategory.TIDE, 'Error updating tide correction', error as Error);
      this.currentCorrectionMeters = 0;
      this.currentStation = null;
      this.notifyListeners();
    }
  }

  /**
   * Start automatic updates based on a position provider
   */
  startAutoUpdate(getPosition: () => { lat: number; lng: number } | null | undefined): void {
    // Stop any existing interval
    this.stopAutoUpdate();

    // Immediate update
    const position = getPosition();
    if (position) {
      this.updateTideCorrection(position.lat, position.lng);
    }

    // Set up interval for periodic updates
    this.updateInterval = setInterval(() => {
      const pos = getPosition();
      if (pos) {
        this.updateTideCorrection(pos.lat, pos.lng);
      }
    }, UPDATE_INTERVAL_MS);

    logger.debug(LogCategory.TIDE, `Started tide correction auto-update (every ${UPDATE_INTERVAL_MS / 1000}s)`);
  }

  /**
   * Stop automatic updates
   */
  stopAutoUpdate(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      logger.debug(LogCategory.TIDE, 'Stopped tide correction auto-update');
    }
  }

  /**
   * Subscribe to tide correction updates
   */
  subscribe(listener: (correction: number, station: TideStation | null) => void): () => void {
    this.listeners.add(listener);
    // Immediately notify with current value
    listener(this.currentCorrectionMeters, this.currentStation);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of correction change
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      listener(this.currentCorrectionMeters, this.currentStation);
    });
  }

  /**
   * Reset the service (clear correction and station)
   */
  reset(): void {
    this.currentCorrectionMeters = 0;
    this.currentStation = null;
    this.lastPosition = null;
    this.lastUpdate = null;
    this.notifyListeners();
  }
}

// Export singleton instance
export const tideCorrectionService = new TideCorrectionService();

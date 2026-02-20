/**
 * Station State Service
 * 
 * Calculates the current visual state of tide and current stations
 * for rendering dynamic icons on the map.
 */

import type { TideStation, CurrentStation } from './stationService';
import { getStationPredictionsForRange } from './stationService';
import {
  convertToTideEvents,
  convertToCurrentEvents,
  generateTideChartCurve,
  generateCurrentChartCurve,
  getCurrentValueFromCurve,
  getChartRange,
  getTideState,
  TideEventWithDate,
  CurrentEventWithDate,
  ChartPoint,
} from './tideInterpolation';

// ============================================================
// Types
// ============================================================

export interface TideStationState {
  stationId: string;
  direction: 'rising' | 'falling';
  fillPercent: number;  // 0, 20, 40, 60, 80, 100 (quantized to 20s)
  iconName: string;     // e.g., 'tide-60'
  rotation: number;     // 0 = up/rising, 180 = down/falling
  currentHeight: number | null;  // Current interpolated height
  targetHeight: number | null;   // Next extreme: next High if rising, next Low if falling
}

export interface CurrentStationState {
  stationId: string;
  fillPercent: number;    // 0, 20, 40, 60, 80, 100 (quantized to 20s)
  iconName: string;       // e.g., 'current-60'
  rotation: number;       // Direction in degrees (0=North, clockwise)
  currentVelocity: number | null;  // Current interpolated velocity
  targetVelocity: number | null;   // Peak velocity it's heading towards
  nextSlackTime: string | null;    // Next slack time as "HH:MM" display string
}

export interface AllStationStates {
  tides: TideStationState[];
  currents: CurrentStationState[];
  calculatedAt: number;  // Timestamp when calculated
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Quantize a percentage to the nearest 20 (0, 20, 40, 60, 80, 100)
 */
function quantizeToTwenty(percent: number): number {
  // Clamp to 0-100
  const clamped = Math.max(0, Math.min(100, percent));
  // Round to nearest 20
  const rounded = Math.round(clamped / 20) * 20;
  return Math.min(100, rounded);
}

/**
 * Normalize degrees to 0-360 range
 */
function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * Convert velocity to fill percentage (0, 20, 40, 60, 80, 100)
 * Based on ratio of current velocity to max velocity
 */
function velocityToFillPercent(velocity: number, maxVelocity: number = 2.0): number {
  const absVel = Math.abs(velocity);
  
  if (absVel < 0.1) return 0; // Slack
  
  const percent = (absVel / maxVelocity) * 100;
  return quantizeToTwenty(percent);
}

// ============================================================
// State Calculation Functions
// ============================================================

/**
 * Calculate the state for a single tide station
 */
export async function calculateTideStationState(
  station: TideStation
): Promise<TideStationState | null> {
  try {
    // Get predictions for today and tomorrow (need range for interpolation)
    const now = new Date();
    const startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 1);
    endDate.setHours(23, 59, 59, 999);
    
    const predictions = await getStationPredictionsForRange(
      station.id,
      'tide',
      startDate,
      endDate
    );
    
    if (!predictions || predictions.length < 2) {
      // Return default state if no predictions
      return {
        stationId: station.id,
        direction: 'rising',
        fillPercent: 40,
        iconName: 'tide-40',
        rotation: 0,
        currentHeight: null,
        targetHeight: null,
      };
    }
    
    // Convert to TideEventWithDate format
    const events = convertToTideEvents(predictions);
    
    // Generate curve for current time range
    const curveStart = now.getTime() - 6 * 60 * 60 * 1000; // 6 hours ago
    const curveEnd = now.getTime() + 6 * 60 * 60 * 1000;   // 6 hours ahead
    const curve = generateTideChartCurve(events, curveStart, curveEnd, 15);
    
    // Get current height
    const currentHeight = getCurrentValueFromCurve(curve);
    
    // Determine rising/falling
    // Look at events around current time
    const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const todayDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const todayEvents = predictions
      .filter((p: any) => p.date === todayDateStr)
      .map((p: any) => ({ time: p.time, height: p.height, type: p.type as 'H' | 'L' }));
    
    const direction = getTideState(todayEvents, currentTimeStr) || 'rising';
    
    // Find the next extreme event (target height the tide is heading towards)
    // Rising → next High, Falling → next Low
    const nowTs = now.getTime();
    let targetHeight: number | null = null;
    try {
      const targetType = direction === 'rising' ? 'H' : 'L';
      // Use events (already have timestamps from convertToTideEvents)
      for (const evt of events) {
        if (evt.timestamp! > nowTs && evt.type === targetType) {
          targetHeight = evt.height;
          break;
        }
      }
    } catch (e) {
      // Non-critical: target height is optional enhancement
      console.warn(`[StationState] Could not determine target height for ${station.id}:`, e);
    }
    
    // Calculate fill percentage based on position between low and high
    const range = getChartRange(curve);
    let fillPercent = 40;
    if (currentHeight !== null && range.max !== range.min) {
      if (direction === 'rising') {
        // Rising: fill represents progress toward max (high tide)
        fillPercent = ((currentHeight - range.min) / (range.max - range.min)) * 100;
      } else {
        // Falling: fill represents progress toward min (low tide)
        // Inverted so fill increases as we approach low tide
        fillPercent = ((range.max - currentHeight) / (range.max - range.min)) * 100;
      }
    }
    
    const quantizedFill = quantizeToTwenty(fillPercent);
    const iconName = `tide-${quantizedFill}`;
    // Rotation: 0 = up (rising), 180 = down (falling)
    const rotation = direction === 'rising' ? 0 : 180;
    
    return {
      stationId: station.id,
      direction,
      fillPercent: quantizedFill,
      iconName,
      rotation,
      currentHeight,
      targetHeight,
    };
  } catch (error) {
    console.error(`[StationState] Error calculating tide state for ${station.id}:`, error);
    return null;
  }
}

/**
 * Calculate the state for a single current station
 */
export async function calculateCurrentStationState(
  station: CurrentStation
): Promise<CurrentStationState | null> {
  try {
    // Get predictions for today and tomorrow
    const now = new Date();
    const startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 1);
    endDate.setHours(23, 59, 59, 999);
    
    const predictions = await getStationPredictionsForRange(
      station.id,
      'current',
      startDate,
      endDate
    );
    
    if (!predictions || predictions.length < 2) {
      // Return default state if no predictions
      return {
        stationId: station.id,
        fillPercent: 0,
        iconName: 'current-0',
        rotation: 0,
        currentVelocity: null,
        targetVelocity: null,
        nextSlackTime: null,
      };
    }
    
    // Convert to CurrentEventWithDate format
    const events = convertToCurrentEvents(predictions);
    
    // Generate curve for current time range
    const curveStart = now.getTime() - 6 * 60 * 60 * 1000; // 6 hours ago
    const curveEnd = now.getTime() + 6 * 60 * 60 * 1000;   // 6 hours ahead
    const curve = generateCurrentChartCurve(events, curveStart, curveEnd, 15);
    
    // Get current velocity
    const currentVelocity = getCurrentValueFromCurve(curve);
    
    // Find direction from the predictions
    // Use the direction from the nearest event
    const nowTs = now.getTime();
    let nearestEvent = events[0];
    let nearestDist = Math.abs(events[0].timestamp! - nowTs);
    
    for (const event of events) {
      const dist = Math.abs(event.timestamp! - nowTs);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestEvent = event;
      }
    }
    
    // Rotation in degrees (0=North, clockwise) - default to 0 if no direction
    const rotation = nearestEvent.direction !== undefined 
      ? normalizeDegrees(nearestEvent.direction) 
      : 0;
    
    // Calculate fill percentage based on max velocity in the data
    const range = getChartRange(curve);
    const maxVelocity = Math.max(Math.abs(range.min), Math.abs(range.max));
    const fillPercent = velocityToFillPercent(currentVelocity ?? 0, maxVelocity || 2.0);
    
    // Find the next peak velocity event (flood or ebb) after now
    let targetVelocity: number | null = null;
    let nextSlackTime: string | null = null;
    try {
      for (const event of events) {
        // Database stores single-char types: 'f' (flood), 'e' (ebb), 's' (slack)
        if (event.timestamp! > nowTs && (event.type === 'f' || event.type === 'e')) {
          targetVelocity = event.velocity;
          break;
        }
      }
      
      // Find the next slack event after now
      for (const event of events) {
        if (event.timestamp! > nowTs && event.type === 's') {
          // Format as local time HH:MM
          const slackDate = new Date(event.timestamp!);
          const hours = String(slackDate.getHours()).padStart(2, '0');
          const minutes = String(slackDate.getMinutes()).padStart(2, '0');
          nextSlackTime = `${hours}:${minutes}`;
          break;
        }
      }
    } catch (e) {
      // Non-critical: target velocity and slack time are optional enhancements
      console.warn(`[StationState] Could not determine target/slack for ${station.id}:`, e);
    }
    
    // Icon name is fill percentage (rotation handled separately)
    const iconName = `current-${fillPercent}`;
    
    return {
      stationId: station.id,
      fillPercent,
      iconName,
      rotation,
      currentVelocity,
      targetVelocity,
      nextSlackTime,
    };
  } catch (error) {
    console.error(`[StationState] Error calculating current state for ${station.id}:`, error);
    return null;
  }
}

/**
 * Calculate states for all stations
 * This is the main function called by the UI on a timer
 */
export async function calculateAllStationStates(
  tideStations: TideStation[],
  currentStations: CurrentStation[]
): Promise<AllStationStates> {
  console.log(`[StationState] Calculating states for ${tideStations.length} tide and ${currentStations.length} current stations...`);
  
  const startTime = Date.now();
  
  // Process tide stations (in batches to avoid overwhelming the database)
  const tideStates: TideStationState[] = [];
  const BATCH_SIZE = 20;
  
  for (let i = 0; i < tideStations.length; i += BATCH_SIZE) {
    const batch = tideStations.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(station => calculateTideStationState(station))
    );
    
    for (const result of batchResults) {
      if (result) {
        tideStates.push(result);
      }
    }
  }
  
  // Process current stations
  const currentStates: CurrentStationState[] = [];
  
  for (let i = 0; i < currentStations.length; i += BATCH_SIZE) {
    const batch = currentStations.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(station => calculateCurrentStationState(station))
    );
    
    for (const result of batchResults) {
      if (result) {
        currentStates.push(result);
      }
    }
  }
  
  const elapsed = Date.now() - startTime;
  console.log(`[StationState] Calculated ${tideStates.length} tide and ${currentStates.length} current states in ${elapsed}ms`);
  
  return {
    tides: tideStates,
    currents: currentStates,
    calculatedAt: Date.now(),
  };
}

/**
 * Get a map of station ID to icon state for quick lookup
 */
export function createIconNameMap(states: AllStationStates): {
  tides: Map<string, { iconName: string; rotation: number; currentHeight: number | null; targetHeight: number | null }>;
  currents: Map<string, { iconName: string; rotation: number; currentVelocity: number | null; targetVelocity: number | null; nextSlackTime: string | null }>;
} {
  const tideMap = new Map<string, { iconName: string; rotation: number; currentHeight: number | null; targetHeight: number | null }>();
  const currentMap = new Map<string, { iconName: string; rotation: number; currentVelocity: number | null; targetVelocity: number | null; nextSlackTime: string | null }>();
  
  let tideWithTarget = 0;
  for (const state of states.tides) {
    tideMap.set(state.stationId, { 
      iconName: state.iconName, 
      rotation: state.rotation,
      currentHeight: state.currentHeight,
      targetHeight: state.targetHeight,
    });
    if (state.targetHeight != null) tideWithTarget++;
  }
  
  let currentWithTarget = 0;
  let currentWithSlack = 0;
  for (const state of states.currents) {
    currentMap.set(state.stationId, { 
      iconName: state.iconName, 
      rotation: state.rotation,
      currentVelocity: state.currentVelocity,
      targetVelocity: state.targetVelocity,
      nextSlackTime: state.nextSlackTime,
    });
    if (state.targetVelocity != null) currentWithTarget++;
    if (state.nextSlackTime != null) currentWithSlack++;
  }
  
  console.log(`[StationState] Icon map stats: tides=${tideMap.size} (${tideWithTarget} with targetHeight), currents=${currentMap.size} (${currentWithTarget} with targetVelocity, ${currentWithSlack} with nextSlack)`);
  
  return { tides: tideMap, currents: currentMap };
}

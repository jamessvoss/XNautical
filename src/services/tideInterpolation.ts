/**
 * Tide Interpolation Service
 * 
 * Provides sinusoidal interpolation between High/Low tide events
 * to calculate tide heights at specific times without storing full curves.
 */

import type { TideEvent } from './stationService';

/**
 * Parse time string "HH:MM" to minutes since midnight
 */
function parseTime(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Find the tide event immediately before the target time
 */
function findEventBefore(events: TideEvent[], targetMinutes: number): TideEvent | null {
  let closest: TideEvent | null = null;
  let closestMinutes = -Infinity;
  
  for (const event of events) {
    const eventMinutes = parseTime(event.time);
    if (eventMinutes <= targetMinutes && eventMinutes > closestMinutes) {
      closest = event;
      closestMinutes = eventMinutes;
    }
  }
  
  return closest;
}

/**
 * Find the tide event immediately after the target time
 */
function findEventAfter(events: TideEvent[], targetMinutes: number): TideEvent | null {
  let closest: TideEvent | null = null;
  let closestMinutes = Infinity;
  
  for (const event of events) {
    const eventMinutes = parseTime(event.time);
    if (eventMinutes >= targetMinutes && eventMinutes < closestMinutes) {
      closest = event;
      closestMinutes = eventMinutes;
    }
  }
  
  return closest;
}

/**
 * Interpolate tide height at a specific time using sinusoidal interpolation
 * 
 * @param events - Array of High/Low tide events for the day (should be sorted by time)
 * @param targetTime - Time as "HH:MM" string
 * @returns Interpolated tide height in feet, or null if cannot interpolate
 */
export function interpolateTideHeight(
  events: TideEvent[],
  targetTime: string
): number | null {
  if (!events || events.length < 2) {
    return null; // Need at least 2 events to interpolate
  }
  
  const targetMinutes = parseTime(targetTime);
  const before = findEventBefore(events, targetMinutes);
  const after = findEventAfter(events, targetMinutes);
  
  if (!before || !after || before === after) {
    // Target time is outside the range of available events
    // or exactly on an event - return the event height if exact match
    const exactMatch = events.find(e => parseTime(e.time) === targetMinutes);
    return exactMatch ? exactMatch.height : null;
  }
  
  // Calculate time ratio between events (0 to 1)
  const beforeMinutes = parseTime(before.time);
  const afterMinutes = parseTime(after.time);
  const ratio = (targetMinutes - beforeMinutes) / (afterMinutes - beforeMinutes);
  
  // Sinusoidal interpolation
  // The tide follows a roughly sinusoidal pattern between high and low
  // Phase goes from -π/2 (at before event) to +π/2 (at after event)
  const amplitude = (after.height - before.height) / 2;
  const midHeight = (before.height + after.height) / 2;
  const phase = ratio * Math.PI - Math.PI / 2; // -π/2 to +π/2
  
  return midHeight + amplitude * Math.sin(phase);
}

/**
 * Generate an array of tide curve points for visualization
 * 
 * @param events - Array of High/Low tide events
 * @param intervalMinutes - Interval between points in minutes (default: 15)
 * @returns Array of { time: "HH:MM", height: number } points
 */
export function generateTideCurve(
  events: TideEvent[],
  intervalMinutes: number = 15
): Array<{ time: string; height: number }> {
  if (!events || events.length < 2) {
    return events.map(e => ({ time: e.time, height: e.height }));
  }
  
  // Sort events by time
  const sortedEvents = [...events].sort((a, b) => parseTime(a.time) - parseTime(b.time));
  
  const firstMinutes = parseTime(sortedEvents[0].time);
  const lastMinutes = parseTime(sortedEvents[sortedEvents.length - 1].time);
  
  const points: Array<{ time: string; height: number }> = [];
  
  // Generate points at regular intervals
  for (let minutes = firstMinutes; minutes <= lastMinutes; minutes += intervalMinutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const timeStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    
    const height = interpolateTideHeight(sortedEvents, timeStr);
    if (height !== null) {
      points.push({ time: timeStr, height });
    }
  }
  
  // Add the last event if not already included
  const lastEventTime = sortedEvents[sortedEvents.length - 1].time;
  const lastPoint = points[points.length - 1];
  if (!lastPoint || lastPoint.time !== lastEventTime) {
    points.push({
      time: lastEventTime,
      height: sortedEvents[sortedEvents.length - 1].height,
    });
  }
  
  return points;
}

/**
 * Get tide range (min and max heights) for a day
 */
export function getTideRange(events: TideEvent[]): { min: number; max: number } | null {
  if (!events || events.length === 0) {
    return null;
  }
  
  const heights = events.map(e => e.height);
  return {
    min: Math.min(...heights),
    max: Math.max(...heights),
  };
}

/**
 * Get the next high or low tide after a specific time
 * 
 * @param events - Array of tide events for the day
 * @param currentTime - Current time as "HH:MM"
 * @param type - "H" for next high, "L" for next low, or undefined for next event of any type
 */
export function getNextTideEvent(
  events: TideEvent[],
  currentTime: string,
  type?: 'H' | 'L'
): TideEvent | null {
  if (!events || events.length === 0) {
    return null;
  }
  
  const currentMinutes = parseTime(currentTime);
  
  // Find next event after current time
  for (const event of events) {
    const eventMinutes = parseTime(event.time);
    if (eventMinutes > currentMinutes) {
      if (!type || event.type === type) {
        return event;
      }
    }
  }
  
  return null;
}

/**
 * Calculate current tide state (rising or falling)
 * 
 * @param events - Array of tide events
 * @param currentTime - Current time as "HH:MM"
 * @returns "rising" if tide is rising, "falling" if falling, or null if cannot determine
 */
export function getTideState(
  events: TideEvent[],
  currentTime: string
): 'rising' | 'falling' | null {
  if (!events || events.length < 2) {
    return null;
  }
  
  const currentMinutes = parseTime(currentTime);
  const before = findEventBefore(events, currentMinutes);
  const after = findEventAfter(events, currentMinutes);
  
  if (!before || !after) {
    return null;
  }
  
  // If height is increasing, tide is rising
  return after.height > before.height ? 'rising' : 'falling';
}

/**
 * Format height for display with proper precision
 */
export function formatTideHeight(height: number): string {
  return height.toFixed(1);
}

/**
 * Format time for display (handles 24-hour to 12-hour conversion)
 */
export function formatTimeDisplay(time: string, use24Hour: boolean = false): string {
  const [hours, minutes] = time.split(':').map(Number);
  
  if (use24Hour) {
    return time;
  }
  
  // Convert to 12-hour format
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`;
}

// ============================================================
// Multi-day chart generation functions for 36-hour display
// ============================================================

/**
 * Tide event with full date/time for multi-day processing
 */
export interface TideEventWithDate {
  date: string;      // "YYYY-MM-DD"
  time: string;      // "HH:MM"
  type: 'H' | 'L';   // High or Low
  height: number;    // Height in feet
  timestamp?: number; // Unix timestamp for easy sorting
}

/**
 * Current event with full date/time
 */
export interface CurrentEventWithDate {
  date: string;       // "YYYY-MM-DD"
  time: string;       // "HH:MM"
  type: string;       // 'slack', 'max_flood', 'max_ebb'
  velocity: number;   // Velocity in knots (positive=flood, negative=ebb)
  direction?: number; // Direction in degrees
  timestamp?: number; // Unix timestamp for easy sorting
}

/**
 * Point on the chart with absolute timestamp
 */
export interface ChartPoint {
  timestamp: number;  // Unix timestamp
  value: number;      // Height (tide) or velocity (current)
}

/**
 * Convert date + time string to Unix timestamp
 */
export function dateTimeToTimestamp(date: string, time: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes).getTime();
}

/**
 * Convert database predictions to TideEventWithDate array
 */
export function convertToTideEvents(predictions: any[]): TideEventWithDate[] {
  return predictions.map(p => ({
    date: p.date,
    time: p.time,
    type: p.type as 'H' | 'L',
    height: p.height,
    timestamp: dateTimeToTimestamp(p.date, p.time),
  })).sort((a, b) => a.timestamp! - b.timestamp!);
}

/**
 * Convert database predictions to CurrentEventWithDate array
 */
export function convertToCurrentEvents(predictions: any[]): CurrentEventWithDate[] {
  return predictions.map(p => ({
    date: p.date,
    time: p.time,
    type: p.type,
    velocity: p.velocity,
    direction: p.direction,
    timestamp: dateTimeToTimestamp(p.date, p.time),
  })).sort((a, b) => a.timestamp! - b.timestamp!);
}

/**
 * Generate interpolated tide curve points for chart rendering
 * Works across multiple days using absolute timestamps
 * 
 * @param events - Array of tide events (High/Low) with dates
 * @param startTimestamp - Start of time range (Unix ms)
 * @param endTimestamp - End of time range (Unix ms)
 * @param intervalMinutes - Interval between points (default 15 minutes)
 * @returns Array of ChartPoints with interpolated values
 */
export function generateTideChartCurve(
  events: TideEventWithDate[],
  startTimestamp: number,
  endTimestamp: number,
  intervalMinutes: number = 15
): ChartPoint[] {
  if (!events || events.length < 2) {
    return events?.map(e => ({ timestamp: e.timestamp!, value: e.height })) || [];
  }
  
  const points: ChartPoint[] = [];
  const intervalMs = intervalMinutes * 60 * 1000;
  
  // Generate points at regular intervals
  for (let ts = startTimestamp; ts <= endTimestamp; ts += intervalMs) {
    const value = interpolateTideAtTimestamp(events, ts);
    if (value !== null) {
      points.push({ timestamp: ts, value });
    }
  }
  
  // Inject actual high/low event points to ensure curve hits them exactly
  for (const event of events) {
    if (event.timestamp! >= startTimestamp && event.timestamp! <= endTimestamp) {
      points.push({ timestamp: event.timestamp!, value: event.height });
    }
  }
  
  // Sort by timestamp to maintain chronological order
  points.sort((a, b) => a.timestamp - b.timestamp);
  
  return points;
}

/**
 * Interpolate tide height at a specific timestamp using sinusoidal interpolation
 */
function interpolateTideAtTimestamp(
  events: TideEventWithDate[],
  targetTs: number
): number | null {
  // Find bracketing events
  let before: TideEventWithDate | null = null;
  let after: TideEventWithDate | null = null;
  
  for (const event of events) {
    if (event.timestamp! <= targetTs) {
      if (!before || event.timestamp! > before.timestamp!) {
        before = event;
      }
    }
    if (event.timestamp! >= targetTs) {
      if (!after || event.timestamp! < after.timestamp!) {
        after = event;
      }
    }
  }
  
  // If target is exactly on an event, return its height
  if (before && before.timestamp === targetTs) {
    return before.height;
  }
  if (after && after.timestamp === targetTs) {
    return after.height;
  }
  
  // Need both bracketing events for interpolation
  if (!before || !after || before === after) {
    // Extrapolate from nearest if possible
    if (before) return before.height;
    if (after) return after.height;
    return null;
  }
  
  // Calculate ratio (0 to 1) between events
  const totalDuration = after.timestamp! - before.timestamp!;
  const elapsed = targetTs - before.timestamp!;
  const ratio = elapsed / totalDuration;
  
  // Sinusoidal interpolation
  const amplitude = (after.height - before.height) / 2;
  const midHeight = (before.height + after.height) / 2;
  const phase = ratio * Math.PI - Math.PI / 2; // -π/2 to +π/2
  
  return midHeight + amplitude * Math.sin(phase);
}

/**
 * Generate interpolated current curve points for chart rendering
 * Works across multiple days using absolute timestamps
 * 
 * @param events - Array of current events (slack/max) with dates
 * @param startTimestamp - Start of time range (Unix ms)
 * @param endTimestamp - End of time range (Unix ms)
 * @param intervalMinutes - Interval between points (default 15 minutes)
 * @returns Array of ChartPoints with interpolated velocities
 */
export function generateCurrentChartCurve(
  events: CurrentEventWithDate[],
  startTimestamp: number,
  endTimestamp: number,
  intervalMinutes: number = 15
): ChartPoint[] {
  if (!events || events.length < 2) {
    return events?.map(e => ({ timestamp: e.timestamp!, value: e.velocity })) || [];
  }
  
  const points: ChartPoint[] = [];
  const intervalMs = intervalMinutes * 60 * 1000;
  
  // Generate points at regular intervals
  for (let ts = startTimestamp; ts <= endTimestamp; ts += intervalMs) {
    const value = interpolateCurrentAtTimestamp(events, ts);
    if (value !== null) {
      points.push({ timestamp: ts, value });
    }
  }
  
  // Inject actual slack/max current event points to ensure curve hits them exactly
  for (const event of events) {
    if (event.timestamp! >= startTimestamp && event.timestamp! <= endTimestamp) {
      points.push({ timestamp: event.timestamp!, value: event.velocity });
    }
  }
  
  // Sort by timestamp to maintain chronological order
  points.sort((a, b) => a.timestamp - b.timestamp);
  
  return points;
}

/**
 * Interpolate current velocity at a specific timestamp using sinusoidal interpolation
 */
function interpolateCurrentAtTimestamp(
  events: CurrentEventWithDate[],
  targetTs: number
): number | null {
  // Find bracketing events
  let before: CurrentEventWithDate | null = null;
  let after: CurrentEventWithDate | null = null;
  
  for (const event of events) {
    if (event.timestamp! <= targetTs) {
      if (!before || event.timestamp! > before.timestamp!) {
        before = event;
      }
    }
    if (event.timestamp! >= targetTs) {
      if (!after || event.timestamp! < after.timestamp!) {
        after = event;
      }
    }
  }
  
  // If target is exactly on an event, return its velocity
  if (before && before.timestamp === targetTs) {
    return before.velocity;
  }
  if (after && after.timestamp === targetTs) {
    return after.velocity;
  }
  
  // Need both bracketing events for interpolation
  if (!before || !after || before === after) {
    // Extrapolate from nearest if possible
    if (before) return before.velocity;
    if (after) return after.velocity;
    return null;
  }
  
  // Calculate ratio (0 to 1) between events
  const totalDuration = after.timestamp! - before.timestamp!;
  const elapsed = targetTs - before.timestamp!;
  const ratio = elapsed / totalDuration;
  
  // Sinusoidal interpolation for currents
  const amplitude = (after.velocity - before.velocity) / 2;
  const midVelocity = (before.velocity + after.velocity) / 2;
  const phase = ratio * Math.PI - Math.PI / 2; // -π/2 to +π/2
  
  return midVelocity + amplitude * Math.sin(phase);
}

/**
 * Get value range for chart Y-axis scaling
 */
export function getChartRange(points: ChartPoint[]): { min: number; max: number } {
  if (!points || points.length === 0) {
    return { min: 0, max: 1 };
  }
  
  let min = Infinity;
  let max = -Infinity;
  
  for (const point of points) {
    if (point.value < min) min = point.value;
    if (point.value > max) max = point.value;
  }
  
  // Add 10% padding
  const range = max - min;
  const padding = range * 0.1;
  
  return { 
    min: min - padding, 
    max: max + padding 
  };
}

/**
 * Get current value at "now" from chart curve
 */
export function getCurrentValueFromCurve(points: ChartPoint[]): number | null {
  const now = Date.now();
  
  // Find the two points bracketing "now"
  let before: ChartPoint | null = null;
  let after: ChartPoint | null = null;
  
  for (const point of points) {
    if (point.timestamp <= now) {
      before = point;
    }
    if (point.timestamp >= now && !after) {
      after = point;
      break;
    }
  }
  
  if (!before && !after) return null;
  if (!before) return after!.value;
  if (!after) return before.value;
  
  // Linear interpolate between the two nearest points
  const ratio = (now - before.timestamp) / (after.timestamp - before.timestamp);
  return before.value + ratio * (after.value - before.value);
}

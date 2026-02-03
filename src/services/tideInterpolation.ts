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

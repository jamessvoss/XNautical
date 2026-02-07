/**
 * Shared compass utilities
 * 
 * Common constants, types, and helper functions used across
 * all compass display mode components.
 */

import { Dimensions } from 'react-native';

// ---------- Types ----------

export type CompassMode = 'off' | 'full' | 'halfmoon' | 'ticker' | 'minimal';

export const COMPASS_MODES: CompassMode[] = ['off', 'full', 'halfmoon', 'ticker', 'minimal'];

export interface CompassProps {
  heading: number | null;
  course: number | null;
  showTideChart?: boolean;
  showCurrentChart?: boolean;
}

// ---------- Constants ----------

/** Chart height as percentage of screen (must match TideDetailChart/CurrentDetailChart) */
export const CHART_HEIGHT_PERCENT = 0.15;

/** Tab bar base height (before safe area inset) */
export const TAB_BAR_HEIGHT = 56;

/** Cardinal direction definitions */
export const CARDINALS = [
  { label: 'N', angle: 0, color: '#FF3333' },
  { label: 'E', angle: 90, color: '#FFFFFF' },
  { label: 'S', angle: 180, color: '#FFFFFF' },
  { label: 'W', angle: 270, color: '#FFFFFF' },
] as const;

/** Degree label positions (every 30 degrees, excluding cardinals) */
export const DEGREE_LABELS = [30, 60, 120, 150, 210, 240, 300, 330] as const;

// ---------- Helpers ----------

/**
 * Calculate shortest rotation path to avoid spinning backwards.
 * E.g., going from 359 to 1 should rotate +2, not -358.
 */
export function shortestRotationTarget(from: number, to: number): number {
  let delta = ((to - from + 540) % 360) - 180;
  return from + delta;
}

/**
 * Calculate the total height taken up by tide/current charts at the bottom.
 */
export function getChartsHeight(
  showTideChart: boolean,
  showCurrentChart: boolean,
): number {
  const { height: screenHeight } = Dimensions.get('window');
  const chartCount = (showTideChart ? 1 : 0) + (showCurrentChart ? 1 : 0);
  return chartCount * (screenHeight * CHART_HEIGHT_PERCENT);
}

/**
 * Format heading for display: rounds to integer, returns '--' for null.
 */
export function formatHeading(heading: number | null): string {
  return heading !== null ? `${Math.round(heading)}` : '--';
}

/**
 * Get the label for a heading (e.g., "N", "NE", "E", etc.)
 */
export function getCardinalLabel(heading: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(heading / 45) % 8;
  return directions[index];
}

/**
 * Cycle to the next compass mode in the sequence.
 * Off -> Full -> Half-Moon -> Ticker -> Minimal -> Off
 */
export function getNextCompassMode(current: CompassMode): CompassMode {
  const idx = COMPASS_MODES.indexOf(current);
  return COMPASS_MODES[(idx + 1) % COMPASS_MODES.length];
}

/**
 * Get a human-readable label for a compass mode.
 */
export function getCompassModeLabel(mode: CompassMode): string {
  switch (mode) {
    case 'off': return 'Off';
    case 'full': return 'Full';
    case 'halfmoon': return 'Arc';
    case 'ticker': return 'Tape';
    case 'minimal': return 'Mini';
  }
}

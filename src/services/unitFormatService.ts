/**
 * Unit Format Service — Centralized display-unit formatting
 *
 * All internal values remain nautical (knots, nm, °C, etc.).
 * This module converts to the user's chosen display units by
 * reading from displaySettingsService.getCachedSettings().
 */

import { getCachedSettings } from './displaySettingsService';
import type { DisplaySettings } from './displaySettingsService';

// ── Conversion constants ──────────────────────────────────────
const NM_TO_KM = 1.852;
const NM_TO_MI = 1.15078;
const KN_TO_MPH = 1.15078;
const KN_TO_KMH = 1.852;
const MS_TO_KN = 1.94384;
const MS_TO_MPH = 2.23694;
const MS_TO_KMH = 3.6;
const METERS_TO_FEET = 3.28084;
const FEET_TO_METERS = 0.3048;
const METERS_TO_FATHOMS = 0.546807;
const FEET_TO_FATHOMS = 0.166667;

// ── Helpers ───────────────────────────────────────────────────

function setting<K extends keyof DisplaySettings>(key: K, override?: DisplaySettings[K]): DisplaySettings[K] {
  if (override !== undefined) return override;
  const cached = getCachedSettings();
  if (cached) return cached[key];
  // Fallback defaults (should rarely fire — settings load at startup)
  const defaults: Record<string, any> = {
    speedUnits: 'kn',
    distanceUnits: 'nm',
    temperatureUnits: 'fahrenheit',
    depthUnits: 'meters',
    coordinateFormat: 'dm',
    timeFormat: '12h',
  };
  return defaults[key] as DisplaySettings[K];
}

// ── Speed ─────────────────────────────────────────────────────

/** Format a speed given in knots → user's speed unit */
export function formatSpeed(speedKnots: number | null, unitOverride?: DisplaySettings['speedUnits']): string {
  if (speedKnots === null) return '--';
  const unit = setting('speedUnits', unitOverride);
  switch (unit) {
    case 'mph':  return `${(speedKnots * KN_TO_MPH).toFixed(1)} mph`;
    case 'kmh':  return `${(speedKnots * KN_TO_KMH).toFixed(1)} km/h`;
    default:     return `${speedKnots.toFixed(1)} kn`;
  }
}

/** Format speed value only (no unit label) — for HUD-style displays */
export function formatSpeedValue(speedKnots: number | null, unitOverride?: DisplaySettings['speedUnits']): string {
  if (speedKnots === null) return '--';
  const unit = setting('speedUnits', unitOverride);
  switch (unit) {
    case 'mph':  return (speedKnots * KN_TO_MPH).toFixed(1);
    case 'kmh':  return (speedKnots * KN_TO_KMH).toFixed(1);
    default:     return speedKnots.toFixed(1);
  }
}

/** Format wind speed from m/s → user's speed unit */
export function formatWindSpeed(ms: number | undefined, unitOverride?: DisplaySettings['speedUnits']): string {
  if (ms === undefined) return '--';
  const unit = setting('speedUnits', unitOverride);
  switch (unit) {
    case 'mph':  return `${(ms * MS_TO_MPH).toFixed(0)} mph`;
    case 'kmh':  return `${(ms * MS_TO_KMH).toFixed(0)} km/h`;
    default:     return `${(ms * MS_TO_KN).toFixed(0)} kn`;
  }
}

/** Format current-station velocity from knots → user's speed unit */
export function formatVelocity(knots: number, unitOverride?: DisplaySettings['speedUnits']): string {
  const unit = setting('speedUnits', unitOverride);
  switch (unit) {
    case 'mph':  return `${(knots * KN_TO_MPH).toFixed(1)} mph`;
    case 'kmh':  return `${(knots * KN_TO_KMH).toFixed(1)} km/h`;
    default:     return `${knots.toFixed(1)} kn`;
  }
}

/** Short unit label for speed */
export function getSpeedUnitLabel(unitOverride?: DisplaySettings['speedUnits']): string {
  const unit = setting('speedUnits', unitOverride);
  switch (unit) {
    case 'mph':  return 'mph';
    case 'kmh':  return 'km/h';
    default:     return 'kn';
  }
}

// ── Distance ──────────────────────────────────────────────────

/** Format distance from nautical miles → user's distance unit */
export function formatDistance(distanceNm: number, decimals: number = 1, unitOverride?: DisplaySettings['distanceUnits']): string {
  const unit = setting('distanceUnits', unitOverride);
  switch (unit) {
    case 'mi':  return `${(distanceNm * NM_TO_MI).toFixed(decimals)} mi`;
    case 'km':  return `${(distanceNm * NM_TO_KM).toFixed(decimals)} km`;
    default:    return `${distanceNm.toFixed(decimals)} nm`;
  }
}

/** Format distance value only (no unit label) */
export function formatDistanceValue(distanceNm: number, decimals: number = 1, unitOverride?: DisplaySettings['distanceUnits']): string {
  const unit = setting('distanceUnits', unitOverride);
  switch (unit) {
    case 'mi':  return (distanceNm * NM_TO_MI).toFixed(decimals);
    case 'km':  return (distanceNm * NM_TO_KM).toFixed(decimals);
    default:    return distanceNm.toFixed(decimals);
  }
}

/** Short unit label for distance */
export function getDistanceUnitLabel(unitOverride?: DisplaySettings['distanceUnits']): string {
  const unit = setting('distanceUnits', unitOverride);
  switch (unit) {
    case 'mi':  return 'mi';
    case 'km':  return 'km';
    default:    return 'nm';
  }
}

// ── Temperature ───────────────────────────────────────────────

/** Format temperature from Celsius → user's temperature unit */
export function formatTemp(celsius: number | undefined, unitOverride?: DisplaySettings['temperatureUnits']): string {
  if (celsius === undefined) return '--';
  const unit = setting('temperatureUnits', unitOverride);
  if (unit === 'celsius') {
    return `${celsius.toFixed(0)}°C`;
  }
  const fahrenheit = (celsius * 9 / 5) + 32;
  return `${fahrenheit.toFixed(0)}°F`;
}

// ── Wave Height ───────────────────────────────────────────────

/** Format wave height from meters → user's depth unit */
export function formatWaveHeight(meters: number | undefined, unitOverride?: DisplaySettings['depthUnits']): string {
  if (meters === undefined) return '--';
  const unit = setting('depthUnits', unitOverride);
  switch (unit) {
    case 'feet':    return `${(meters * METERS_TO_FEET).toFixed(1)} ft`;
    case 'fathoms': return `${(meters * METERS_TO_FATHOMS).toFixed(1)} fm`;
    default:        return `${meters.toFixed(1)} m`;
  }
}

// ── Tide Height ───────────────────────────────────────────────

/** Format tide height from feet (NOAA native) → user's depth unit */
export function formatTideHeight(feet: number, unitOverride?: DisplaySettings['depthUnits']): string {
  const unit = setting('depthUnits', unitOverride);
  switch (unit) {
    case 'meters':  return `${(feet * FEET_TO_METERS).toFixed(1)} m`;
    case 'fathoms': return `${(feet * FEET_TO_FATHOMS).toFixed(1)} fm`;
    default:        return `${feet.toFixed(1)} ft`;
  }
}

// ── Coordinates ───────────────────────────────────────────────

/** Format a lat or lon value in the user's chosen coordinate format */
export function formatCoordinate(
  value: number | null,
  isLatitude: boolean,
  formatOverride?: DisplaySettings['coordinateFormat'],
): string {
  if (value === null) return '--';
  const fmt = setting('coordinateFormat', formatOverride);
  const abs = Math.abs(value);
  const dir = isLatitude ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');

  switch (fmt) {
    case 'decimal':
      return `${value.toFixed(6)}°`;
    case 'dms': {
      const deg = Math.floor(abs);
      const minTotal = (abs - deg) * 60;
      const min = Math.floor(minTotal);
      const sec = (minTotal - min) * 60;
      return `${deg}°${min}'${sec.toFixed(1)}"${dir}`;
    }
    default: { // 'dm'
      const deg = Math.floor(abs);
      const min = (abs - deg) * 60;
      return `${deg}°${min.toFixed(3)}'${dir}`;
    }
  }
}

// ── Time ──────────────────────────────────────────────────────

/** Format "HH:MM" time string in user's chosen 12h/24h format */
export function formatTimeDisplay(time: string, formatOverride?: DisplaySettings['timeFormat']): string {
  const fmt = setting('timeFormat', formatOverride);
  const [hours, minutes] = time.split(':').map(Number);

  if (fmt === '24h') {
    return time;
  }
  // 12-hour format
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`;
}

// ── Scale bar helpers ─────────────────────────────────────────

/** Nice distance values for scale bar, per unit system */
export function getScaleBarNiceValues(unitOverride?: DisplaySettings['distanceUnits']): number[] {
  const unit = setting('distanceUnits', unitOverride);
  switch (unit) {
    case 'mi':
      return [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    case 'km':
      return [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    default: // nm
      return [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  }
}

/** Convert meters to the user's distance unit */
export function metersToDisplayUnit(meters: number, unitOverride?: DisplaySettings['distanceUnits']): number {
  const unit = setting('distanceUnits', unitOverride);
  switch (unit) {
    case 'mi':  return meters / 1609.344;
    case 'km':  return meters / 1000;
    default:    return meters / 1852; // nm
  }
}

/** Convert display unit back to meters */
export function displayUnitToMeters(value: number, unitOverride?: DisplaySettings['distanceUnits']): number {
  const unit = setting('distanceUnits', unitOverride);
  switch (unit) {
    case 'mi':  return value * 1609.344;
    case 'km':  return value * 1000;
    default:    return value * 1852; // nm
  }
}

/** Sub-unit label for very small distances on scale bar */
export function getSmallScaleLabel(value: number, unitOverride?: DisplaySettings['distanceUnits']): string | null {
  const unit = setting('distanceUnits', unitOverride);
  if (unit === 'km' && value < 0.05) {
    const m = Math.round(value * 1000);
    return `${m} m`;
  }
  if ((unit === 'nm' || unit === 'mi') && value < 0.05) {
    const ft = Math.round(displayUnitToMeters(value, unitOverride) * METERS_TO_FEET);
    return `${ft} ft`;
  }
  return null;
}

/** Format scale bar label */
export function formatScaleBarLabel(value: number, unitOverride?: DisplaySettings['distanceUnits']): string {
  const small = getSmallScaleLabel(value, unitOverride);
  if (small) return small;
  const unitLabel = getDistanceUnitLabel(unitOverride);
  return `${value} ${unitLabel}`;
}

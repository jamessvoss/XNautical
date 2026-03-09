export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface MeasurementLeg {
  from: LatLng;
  to: LatLng;
  distanceNm: number;
  bearingTrue: number;
  cumulativeNm: number;
}

const EARTH_RADIUS_NM = 3440.065;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Great-circle distance between two points using the haversine formula.
 * Returns distance in nautical miles.
 */
export function haversineNm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(h));
}

/**
 * Initial (forward) bearing from point a to point b.
 * Returns degrees true (0–360).
 */
export function bearingTrue(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLon = toRad(b.longitude - a.longitude);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Compute legs from an ordered array of points.
 * Each leg includes distance, bearing, and cumulative distance.
 */
export function computeLegs(points: LatLng[]): MeasurementLeg[] {
  const legs: MeasurementLeg[] = [];
  let cumulative = 0;
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    const dist = haversineNm(from, to);
    const bearing = bearingTrue(from, to);
    cumulative += dist;
    legs.push({ from, to, distanceNm: dist, bearingTrue: bearing, cumulativeNm: cumulative });
  }
  return legs;
}

/**
 * Midpoint of a great-circle segment (for label placement).
 */
export function midpoint(a: LatLng, b: LatLng): LatLng {
  return {
    latitude: (a.latitude + b.latitude) / 2,
    longitude: (a.longitude + b.longitude) / 2,
  };
}

/**
 * Format bearing as 3-digit true bearing string, e.g. "045°T".
 */
export function formatBearing(deg: number): string {
  return `${Math.round(deg).toString().padStart(3, '0')}°T`;
}

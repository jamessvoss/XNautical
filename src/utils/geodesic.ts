/**
 * Geodesic Calculations for Marine Navigation
 * 
 * Provides accurate distance, bearing, and position calculations on the Earth's
 * surface (WGS84 ellipsoid approximated as sphere). Essential for nautical navigation
 * where accuracy matters over longer distances.
 * 
 * Key concepts:
 * - Great Circle: Shortest path between two points on a sphere
 * - Rhumb Line: Constant-bearing path (what compass navigation follows)
 * - Cross-track Distance: Perpendicular distance from a point to a line
 * 
 * All distances in nautical miles, bearings in degrees (0-360, 0=North).
 */

// Earth's mean radius in nautical miles (6371 km / 1.852 km/nm)
const EARTH_RADIUS_NM = 3440.065;

// Convert degrees to radians
const toRadians = (degrees: number): number => degrees * (Math.PI / 180);

// Convert radians to degrees
const toDegrees = (radians: number): number => radians * (180 / Math.PI);

// Normalize angle to 0-360 range
const normalizeAngle = (degrees: number): number => {
  const normalized = degrees % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

/**
 * Calculate great circle distance between two points using Haversine formula.
 * This is the shortest distance on a sphere.
 * 
 * @param lat1 Start latitude in degrees
 * @param lon1 Start longitude in degrees
 * @param lat2 End latitude in degrees
 * @param lon2 End longitude in degrees
 * @returns Distance in nautical miles
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δφ = toRadians(lat2 - lat1);
  const Δλ = toRadians(lon2 - lon1);

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_NM * c;
}

/**
 * Calculate initial bearing (forward azimuth) from start to end point.
 * This is the bearing you would follow at the start of a great circle route.
 * Note: Bearing changes continuously along a great circle (except on meridians/equator).
 * 
 * @param lat1 Start latitude in degrees
 * @param lon1 Start longitude in degrees
 * @param lat2 End latitude in degrees
 * @param lon2 End longitude in degrees
 * @returns Initial bearing in degrees (0-360, 0=North)
 */
export function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δλ = toRadians(lon2 - lon1);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  const θ = Math.atan2(y, x);

  return normalizeAngle(toDegrees(θ));
}

/**
 * Calculate rhumb line (loxodrome) distance between two points.
 * A rhumb line maintains constant bearing, which is what compass navigation follows.
 * Longer than great circle except when traveling E-W or along a meridian.
 * 
 * @param lat1 Start latitude in degrees
 * @param lon1 Start longitude in degrees
 * @param lat2 End latitude in degrees
 * @param lon2 End longitude in degrees
 * @returns Distance in nautical miles
 */
export function rhumbDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δφ = toRadians(lat2 - lat1);
  let Δλ = toRadians(Math.abs(lon2 - lon1));

  // E-W course becomes ill-conditioned with 0/0
  const Δψ = Math.log(Math.tan(φ2 / 2 + Math.PI / 4) / Math.tan(φ1 / 2 + Math.PI / 4));
  const q = Math.abs(Δψ) > 10e-12 ? Δφ / Δψ : Math.cos(φ1);

  // If longitude difference > 180°, take shorter route across antimeridian
  if (Δλ > Math.PI) Δλ = 2 * Math.PI - Δλ;

  const δ = Math.sqrt(Δφ * Δφ + q * q * Δλ * Δλ);

  return δ * EARTH_RADIUS_NM;
}

/**
 * Calculate rhumb line bearing between two points.
 * This is the constant bearing you would follow along a rhumb line.
 * 
 * @param lat1 Start latitude in degrees
 * @param lon1 Start longitude in degrees
 * @param lat2 End latitude in degrees
 * @param lon2 End longitude in degrees
 * @returns Bearing in degrees (0-360, 0=North)
 */
export function rhumbBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  let Δλ = toRadians(lon2 - lon1);

  const Δψ = Math.log(Math.tan(φ2 / 2 + Math.PI / 4) / Math.tan(φ1 / 2 + Math.PI / 4));

  if (Math.abs(Δλ) > Math.PI) {
    Δλ = Δλ > 0 ? -(2 * Math.PI - Δλ) : 2 * Math.PI + Δλ;
  }

  const θ = Math.atan2(Δλ, Δψ);

  return normalizeAngle(toDegrees(θ));
}

/**
 * Calculate destination point given start point, bearing, and distance.
 * Uses great circle calculation.
 * 
 * @param lat Start latitude in degrees
 * @param lon Start longitude in degrees
 * @param bearing Bearing in degrees (0-360)
 * @param distance Distance in nautical miles
 * @returns Destination point as {latitude, longitude}
 */
export function destinationPoint(
  lat: number,
  lon: number,
  bearing: number,
  distance: number
): { latitude: number; longitude: number } {
  const δ = distance / EARTH_RADIUS_NM; // angular distance
  const θ = toRadians(bearing);
  const φ1 = toRadians(lat);
  const λ1 = toRadians(lon);

  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );

  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );

  return {
    latitude: toDegrees(φ2),
    longitude: normalizeAngle(toDegrees(λ2)),
  };
}

/**
 * Calculate midpoint between two points along great circle route.
 * 
 * @param lat1 Start latitude in degrees
 * @param lon1 Start longitude in degrees
 * @param lat2 End latitude in degrees
 * @param lon2 End longitude in degrees
 * @returns Midpoint as {latitude, longitude}
 */
export function midpoint(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): { latitude: number; longitude: number } {
  const φ1 = toRadians(lat1);
  const λ1 = toRadians(lon1);
  const φ2 = toRadians(lat2);
  const Δλ = toRadians(lon2 - lon1);

  const Bx = Math.cos(φ2) * Math.cos(Δλ);
  const By = Math.cos(φ2) * Math.sin(Δλ);

  const φ3 = Math.atan2(
    Math.sin(φ1) + Math.sin(φ2),
    Math.sqrt((Math.cos(φ1) + Bx) * (Math.cos(φ1) + Bx) + By * By)
  );
  const λ3 = λ1 + Math.atan2(By, Math.cos(φ1) + Bx);

  return {
    latitude: toDegrees(φ3),
    longitude: normalizeAngle(toDegrees(λ3)),
  };
}

/**
 * Calculate cross-track distance: perpendicular distance from a point to a great circle path.
 * Positive values indicate point is right of path, negative indicates left.
 * Essential for navigation to determine if vessel is off course.
 * 
 * @param pointLat Latitude of point in degrees
 * @param pointLon Longitude of point in degrees
 * @param startLat Start of path latitude in degrees
 * @param startLon Start of path longitude in degrees
 * @param endLat End of path latitude in degrees
 * @param endLon End of path longitude in degrees
 * @returns Cross-track distance in nautical miles (+ = right, - = left)
 */
export function crossTrackDistance(
  pointLat: number,
  pointLon: number,
  startLat: number,
  startLon: number,
  endLat: number,
  endLon: number
): number {
  const δ13 = haversineDistance(startLat, startLon, pointLat, pointLon) / EARTH_RADIUS_NM;
  const θ13 = toRadians(calculateBearing(startLat, startLon, pointLat, pointLon));
  const θ12 = toRadians(calculateBearing(startLat, startLon, endLat, endLon));

  const δxt = Math.asin(Math.sin(δ13) * Math.sin(θ13 - θ12));

  return δxt * EARTH_RADIUS_NM;
}

/**
 * Calculate along-track distance: distance from start of path to closest point on path to given point.
 * 
 * @param pointLat Latitude of point in degrees
 * @param pointLon Longitude of point in degrees
 * @param startLat Start of path latitude in degrees
 * @param startLon Start of path longitude in degrees
 * @param endLat End of path latitude in degrees
 * @param endLon End of path longitude in degrees
 * @returns Along-track distance in nautical miles from start
 */
export function alongTrackDistance(
  pointLat: number,
  pointLon: number,
  startLat: number,
  startLon: number,
  endLat: number,
  endLon: number
): number {
  const δ13 = haversineDistance(startLat, startLon, pointLat, pointLon) / EARTH_RADIUS_NM;
  const δxt = crossTrackDistance(pointLat, pointLon, startLat, startLon, endLat, endLon) / EARTH_RADIUS_NM;

  const δat = Math.acos(Math.cos(δ13) / Math.cos(δxt));

  return δat * EARTH_RADIUS_NM;
}

/**
 * Apply magnetic declination to true bearing to get magnetic bearing.
 * Declination varies by location and time; simplified version uses provided value.
 * 
 * @param trueBearing True bearing in degrees (0-360)
 * @param declination Magnetic declination in degrees (+ = East, - = West)
 * @returns Magnetic bearing in degrees (0-360)
 */
export function trueToMagnetic(trueBearing: number, declination: number): number {
  return normalizeAngle(trueBearing - declination);
}

/**
 * Convert magnetic bearing to true bearing.
 * 
 * @param magneticBearing Magnetic bearing in degrees (0-360)
 * @param declination Magnetic declination in degrees (+ = East, - = West)
 * @returns True bearing in degrees (0-360)
 */
export function magneticToTrue(magneticBearing: number, declination: number): number {
  return normalizeAngle(magneticBearing + declination);
}

/**
 * Calculate estimated time of arrival given distance and speed.
 * 
 * @param distanceNm Distance in nautical miles
 * @param speedKnots Speed in knots
 * @returns Time in minutes
 */
export function calculateETA(distanceNm: number, speedKnots: number): number {
  if (speedKnots <= 0) return 0;
  return (distanceNm / speedKnots) * 60; // hours to minutes
}

/**
 * Find the closest point on a line segment to a given point.
 * Returns the closest point and its distance from the original point.
 * 
 * @param pointLat Latitude of point in degrees
 * @param pointLon Longitude of point in degrees
 * @param startLat Start of line segment latitude in degrees
 * @param startLon Start of line segment longitude in degrees
 * @param endLat End of line segment latitude in degrees
 * @param endLon End of line segment longitude in degrees
 * @returns Object with closest point coordinates and distance in nautical miles
 */
export function closestPointOnSegment(
  pointLat: number,
  pointLon: number,
  startLat: number,
  startLon: number,
  endLat: number,
  endLon: number
): { latitude: number; longitude: number; distance: number } {
  const segmentDistance = haversineDistance(startLat, startLon, endLat, endLon);
  
  // If segment has no length, return start point
  if (segmentDistance === 0) {
    return {
      latitude: startLat,
      longitude: startLon,
      distance: haversineDistance(pointLat, pointLon, startLat, startLon),
    };
  }

  const alongTrack = alongTrackDistance(
    pointLat,
    pointLon,
    startLat,
    startLon,
    endLat,
    endLon
  );

  // Clamp to segment bounds
  if (alongTrack < 0) {
    // Closest point is start
    return {
      latitude: startLat,
      longitude: startLon,
      distance: haversineDistance(pointLat, pointLon, startLat, startLon),
    };
  } else if (alongTrack > segmentDistance) {
    // Closest point is end
    return {
      latitude: endLat,
      longitude: endLon,
      distance: haversineDistance(pointLat, pointLon, endLat, endLon),
    };
  } else {
    // Closest point is on segment
    const bearing = calculateBearing(startLat, startLon, endLat, endLon);
    const closestPoint = destinationPoint(startLat, startLon, bearing, alongTrack);
    return {
      ...closestPoint,
      distance: haversineDistance(pointLat, pointLon, closestPoint.latitude, closestPoint.longitude),
    };
  }
}

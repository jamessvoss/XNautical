/**
 * Route Calculations
 * 
 * High-level route calculation utilities built on geodesic functions.
 * Handles route-level operations like total distance, leg calculations,
 * navigation data, and route state management.
 */

import {
  haversineDistance,
  calculateBearing,
  rhumbDistance,
  rhumbBearing,
  crossTrackDistance,
  calculateETA,
  closestPointOnSegment,
} from './geodesic';
import type { Route, RoutePoint, NavigationLegData, Position } from '../types/route';

/** Preferred routing method */
export type RoutingMethod = 'great-circle' | 'rhumb-line';

/**
 * Calculate distance and bearing for a single leg between two points.
 * 
 * @param from Start point
 * @param to End point
 * @param method Routing method (great circle or rhumb line)
 * @returns Object with distance (nm) and bearing (degrees)
 */
export function calculateLeg(
  from: Position,
  to: Position,
  method: RoutingMethod = 'great-circle'
): { distance: number; bearing: number } {
  if (method === 'rhumb-line') {
    return {
      distance: rhumbDistance(from.latitude, from.longitude, to.latitude, to.longitude),
      bearing: rhumbBearing(from.latitude, from.longitude, to.latitude, to.longitude),
    };
  } else {
    return {
      distance: haversineDistance(from.latitude, from.longitude, to.latitude, to.longitude),
      bearing: calculateBearing(from.latitude, from.longitude, to.latitude, to.longitude),
    };
  }
}

/**
 * Calculate leg data for all points in a route.
 * Updates legDistance and legBearing for each point.
 * 
 * @param points Array of route points
 * @param method Routing method
 * @returns Updated array with leg calculations
 */
export function calculateRouteLegs(
  points: RoutePoint[],
  method: RoutingMethod = 'great-circle'
): RoutePoint[] {
  if (points.length === 0) return points;

  return points.map((point, index) => {
    if (index === 0) {
      // First point has no previous leg
      return {
        ...point,
        legDistance: null,
        legBearing: null,
      };
    }

    const previousPoint = points[index - 1];
    const leg = calculateLeg(previousPoint.position, point.position, method);

    return {
      ...point,
      legDistance: leg.distance,
      legBearing: leg.bearing,
    };
  });
}

/**
 * Calculate total distance for a route.
 * 
 * @param points Array of route points with leg distances
 * @returns Total distance in nautical miles
 */
export function calculateTotalDistance(points: RoutePoint[]): number {
  return points.reduce((total, point) => {
    return total + (point.legDistance || 0);
  }, 0);
}

/**
 * Calculate estimated duration for entire route.
 * 
 * @param totalDistance Total route distance in nautical miles
 * @param cruisingSpeed Average cruising speed in knots
 * @returns Duration in minutes
 */
export function calculateRouteDuration(
  totalDistance: number,
  cruisingSpeed: number
): number {
  return calculateETA(totalDistance, cruisingSpeed);
}

/**
 * Update route calculations after points have been modified.
 * Recalculates leg data, total distance, and duration.
 * 
 * @param route Route to update
 * @param cruisingSpeed Cruising speed in knots for duration calculation
 * @param method Routing method
 * @returns Updated route with recalculated values
 */
export function recalculateRoute(
  route: Route,
  cruisingSpeed: number,
  method: RoutingMethod = 'great-circle'
): Route {
  const updatedPoints = calculateRouteLegs(route.routePoints, method);
  const totalDistance = calculateTotalDistance(updatedPoints);
  const estimatedDuration = calculateRouteDuration(totalDistance, cruisingSpeed);

  return {
    ...route,
    routePoints: updatedPoints,
    totalDistance,
    estimatedDuration,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Find which leg of the route a position is closest to.
 * 
 * @param currentPosition Current GPS position
 * @param route The route to check against
 * @returns Object with leg index and closest point info
 */
export function findClosestLeg(
  currentPosition: Position,
  route: Route
): {
  legIndex: number;
  closestPoint: Position;
  distance: number;
  nextPointIndex: number;
} | null {
  if (route.routePoints.length < 2) return null;

  let closestLegIndex = 0;
  let minDistance = Infinity;
  let closestPointOnRoute: Position = currentPosition;

  // Check each leg to find which one is closest
  for (let i = 0; i < route.routePoints.length - 1; i++) {
    const start = route.routePoints[i].position;
    const end = route.routePoints[i + 1].position;

    const result = closestPointOnSegment(
      currentPosition.latitude,
      currentPosition.longitude,
      start.latitude,
      start.longitude,
      end.latitude,
      end.longitude
    );

    if (result.distance < minDistance) {
      minDistance = result.distance;
      closestLegIndex = i;
      closestPointOnRoute = {
        latitude: result.latitude,
        longitude: result.longitude,
      };
    }
  }

  return {
    legIndex: closestLegIndex,
    closestPoint: closestPointOnRoute,
    distance: minDistance,
    nextPointIndex: closestLegIndex + 1,
  };
}

/**
 * Calculate navigation data for the current leg being followed.
 * 
 * @param currentPosition Current GPS position
 * @param route The route being navigated
 * @param targetPointIndex Index of point being navigated to
 * @param cruisingSpeed Cruising speed in knots for ETA
 * @param speedOverGround Current speed over ground in knots (null to use cruising speed)
 * @param declination Magnetic declination in degrees for magnetic bearing
 * @returns Navigation data for current leg
 */
export function calculateNavigationData(
  currentPosition: Position,
  route: Route,
  targetPointIndex: number,
  cruisingSpeed: number,
  speedOverGround: number | null = null,
  declination: number = 0
): NavigationLegData | null {
  if (targetPointIndex >= route.routePoints.length || targetPointIndex < 0) {
    return null;
  }

  const targetPoint = route.routePoints[targetPointIndex];
  const speed = speedOverGround || cruisingSpeed;

  // Calculate distance and bearing to target
  const distanceRemaining = haversineDistance(
    currentPosition.latitude,
    currentPosition.longitude,
    targetPoint.position.latitude,
    targetPoint.position.longitude
  );

  const bearingToTarget = calculateBearing(
    currentPosition.latitude,
    currentPosition.longitude,
    targetPoint.position.latitude,
    targetPoint.position.longitude
  );

  // Calculate magnetic bearing
  const magneticBearing = bearingToTarget - declination;
  const normalizedMagneticBearing =
    magneticBearing < 0 ? magneticBearing + 360 : magneticBearing % 360;

  // Calculate cross-track error if not navigating to first point
  let crossTrackError = 0;
  if (targetPointIndex > 0) {
    const previousPoint = route.routePoints[targetPointIndex - 1];
    crossTrackError = crossTrackDistance(
      currentPosition.latitude,
      currentPosition.longitude,
      previousPoint.position.latitude,
      previousPoint.position.longitude,
      targetPoint.position.latitude,
      targetPoint.position.longitude
    );
  }

  // Calculate ETA to target
  const eta = calculateETA(distanceRemaining, speed);

  // Calculate leg progress
  let legProgress = 0;
  if (targetPointIndex > 0 && targetPoint.legDistance) {
    const distanceCovered = targetPoint.legDistance - distanceRemaining;
    legProgress = Math.max(0, Math.min(100, (distanceCovered / targetPoint.legDistance) * 100));
  }

  // Calculate overall route progress
  let routeProgress = 0;
  if (route.totalDistance > 0) {
    // Sum distance of completed legs
    let completedDistance = 0;
    for (let i = 1; i < targetPointIndex; i++) {
      completedDistance += route.routePoints[i].legDistance || 0;
    }

    // Add progress on current leg
    if (targetPoint.legDistance) {
      const currentLegProgress = targetPoint.legDistance - distanceRemaining;
      completedDistance += Math.max(0, currentLegProgress);
    }

    routeProgress = Math.max(0, Math.min(100, (completedDistance / route.totalDistance) * 100));
  }

  return {
    targetPoint,
    distanceRemaining,
    bearingToTarget,
    magneticBearing: normalizedMagneticBearing,
    crossTrackError,
    eta,
    legProgress,
    routeProgress,
  };
}

/**
 * Check if position is within arrival radius of a point.
 * 
 * @param position Current position
 * @param targetPoint Target point
 * @param arrivalRadius Arrival radius in nautical miles
 * @returns True if within arrival radius
 */
export function isWithinArrivalRadius(
  position: Position,
  targetPoint: Position,
  arrivalRadius: number
): boolean {
  const distance = haversineDistance(
    position.latitude,
    position.longitude,
    targetPoint.latitude,
    targetPoint.longitude
  );
  return distance <= arrivalRadius;
}

/**
 * Generate intermediate points along a route leg for smoother rendering.
 * Useful for displaying curved paths on maps.
 * 
 * @param start Start point
 * @param end End point
 * @param numPoints Number of intermediate points to generate
 * @param method Routing method
 * @returns Array of positions including start and end
 */
export function generateIntermediatePoints(
  start: Position,
  end: Position,
  numPoints: number = 10,
  method: RoutingMethod = 'great-circle'
): Position[] {
  if (numPoints < 2) return [start, end];

  const points: Position[] = [start];
  const leg = calculateLeg(start, end, method);

  for (let i = 1; i < numPoints - 1; i++) {
    const fraction = i / (numPoints - 1);
    const distance = leg.distance * fraction;
    
    // For great circle, we need to calculate point along the path
    // For rhumb line, it's simpler as bearing is constant
    // Simplified: use linear interpolation (good enough for short distances)
    const lat = start.latitude + (end.latitude - start.latitude) * fraction;
    const lon = start.longitude + (end.longitude - start.longitude) * fraction;
    
    points.push({ latitude: lat, longitude: lon });
  }

  points.push(end);
  return points;
}

/**
 * Reverse a route (flip direction).
 * 
 * @param route Route to reverse
 * @param cruisingSpeed Cruising speed for recalculations
 * @param method Routing method
 * @returns Reversed route with recalculated values
 */
export function reverseRoute(
  route: Route,
  cruisingSpeed: number,
  method: RoutingMethod = 'great-circle'
): Route {
  const reversedPoints = [...route.routePoints].reverse().map((point, index) => ({
    ...point,
    order: index,
    legDistance: null, // Will be recalculated
    legBearing: null, // Will be recalculated
  }));

  return recalculateRoute(
    {
      ...route,
      routePoints: reversedPoints,
      name: `${route.name} (Reversed)`,
    },
    cruisingSpeed,
    method
  );
}

/**
 * Validate route points for common errors.
 * 
 * @param points Route points to validate
 * @returns Object with isValid flag and error messages
 */
export function validateRoutePoints(points: RoutePoint[]): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (points.length === 0) {
    errors.push('Route must have at least one point');
  }

  if (points.length === 1) {
    errors.push('Route must have at least two points for navigation');
  }

  points.forEach((point, index) => {
    // Check latitude bounds
    if (point.position.latitude < -90 || point.position.latitude > 90) {
      errors.push(`Point ${index + 1}: Invalid latitude ${point.position.latitude}`);
    }

    // Check longitude bounds
    if (point.position.longitude < -180 || point.position.longitude > 180) {
      errors.push(`Point ${index + 1}: Invalid longitude ${point.position.longitude}`);
    }

    // Check order sequence
    if (point.order !== index) {
      errors.push(`Point ${index + 1}: Order mismatch (expected ${index}, got ${point.order})`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}

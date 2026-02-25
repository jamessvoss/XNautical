/**
 * Route Service
 * 
 * Business logic layer for route management.
 * Handles route creation, updates, calculations, and integrations.
 */

import {
  Route,
  RoutePoint,
  RouteCreateData,
  Position,
  DEFAULT_ROUTE_COLOR,
  DEFAULT_CRUISING_SPEED,
  DEFAULT_FUEL_BURN_RATE,
} from '../types/route';
import {
  calculateRouteLegs,
  calculateTotalDistance,
  calculateRouteDuration,
  recalculateRoute,
  reverseRoute,
  validateRoutePoints,
  RoutingMethod,
} from '../utils/routeCalculations';
import { generateRouteId } from './routeStorageService';
import * as unitFormat from './unitFormatService';

/**
 * Generate a unique route point ID
 */
export function generateRoutePointId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 6);
  return `rp_${timestamp}_${random}`;
}

/**
 * Create a new route from provided data
 */
export function createRoute(
  data: RouteCreateData,
  cruisingSpeed: number = DEFAULT_CRUISING_SPEED
): Route {
  const now = new Date().toISOString();
  const id = generateRouteId();

  // Calculate leg data
  const routePointsWithLegs = calculateRouteLegs(data.routePoints);
  const totalDistance = calculateTotalDistance(routePointsWithLegs);
  const estimatedDuration = calculateRouteDuration(totalDistance, cruisingSpeed);
  
  // Calculate fuel consumption
  const fuelBurnRate = data.fuelBurnRate || DEFAULT_FUEL_BURN_RATE;
  const estimatedFuel = (estimatedDuration / 60) * fuelBurnRate; // minutes to hours

  return {
    id,
    name: data.name,
    routePoints: routePointsWithLegs,
    totalDistance,
    estimatedDuration,
    color: data.color || DEFAULT_ROUTE_COLOR,
    notes: data.notes || '',
    storageType: data.storageType || 'cloud',
    performanceMethod: data.performanceMethod || 'speed',
    cruisingSpeed: data.cruisingSpeed || cruisingSpeed,
    cruisingRPM: data.cruisingRPM || null,
    boatProfileId: data.boatProfileId || null,
    fuelBurnRate,
    estimatedFuel,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Create a route point from a position
 */
export function createRoutePoint(
  position: Position,
  order: number,
  options?: {
    name?: string;
    waypointRef?: string;
    notes?: string;
  }
): RoutePoint {
  return {
    id: generateRoutePointId(),
    position,
    name: options?.name || `P${order + 1}`, // Default to P1, P2, P3...
    waypointRef: options?.waypointRef || null,
    order,
    legDistance: null, // Will be calculated when added to route
    legBearing: null, // Will be calculated when added to route
    notes: options?.notes,
  };
}

/**
 * Add a point to a route
 */
export function addPointToRoute(
  route: Route,
  point: RoutePoint,
  insertAtIndex?: number,
  cruisingSpeed: number = DEFAULT_CRUISING_SPEED
): Route {
  const newPoints = [...route.routePoints];

  // Insert at specific index or append to end
  if (insertAtIndex !== undefined && insertAtIndex >= 0 && insertAtIndex <= newPoints.length) {
    newPoints.splice(insertAtIndex, 0, point);
  } else {
    newPoints.push(point);
  }

  // Reorder points
  const reorderedPoints = newPoints.map((p, index) => ({
    ...p,
    order: index,
  }));

  return recalculateRoute(
    {
      ...route,
      routePoints: reorderedPoints,
    },
    cruisingSpeed
  );
}

/**
 * Remove a point from a route
 */
export function removePointFromRoute(
  route: Route,
  pointId: string,
  cruisingSpeed: number = DEFAULT_CRUISING_SPEED
): Route {
  const filteredPoints = route.routePoints.filter(p => p.id !== pointId);

  // Reorder points
  const reorderedPoints = filteredPoints.map((p, index) => ({
    ...p,
    order: index,
  }));

  return recalculateRoute(
    {
      ...route,
      routePoints: reorderedPoints,
    },
    cruisingSpeed
  );
}

/**
 * Update a point in a route
 */
export function updatePointInRoute(
  route: Route,
  pointId: string,
  updates: Partial<RoutePoint>,
  cruisingSpeed: number = DEFAULT_CRUISING_SPEED
): Route {
  const updatedPoints = route.routePoints.map(p =>
    p.id === pointId ? { ...p, ...updates } : p
  );

  return recalculateRoute(
    {
      ...route,
      routePoints: updatedPoints,
    },
    cruisingSpeed
  );
}

/**
 * Reorder points in a route (e.g., after drag-and-drop)
 */
export function reorderRoutePoints(
  route: Route,
  fromIndex: number,
  toIndex: number,
  cruisingSpeed: number = DEFAULT_CRUISING_SPEED
): Route {
  const points = [...route.routePoints];
  const [movedPoint] = points.splice(fromIndex, 1);
  points.splice(toIndex, 0, movedPoint);

  // Reorder all points
  const reorderedPoints = points.map((p, index) => ({
    ...p,
    order: index,
  }));

  return recalculateRoute(
    {
      ...route,
      routePoints: reorderedPoints,
    },
    cruisingSpeed
  );
}

/**
 * Update route metadata (name, notes, color, etc.)
 */
export function updateRouteMetadata(
  route: Route,
  updates: Partial<Pick<Route, 'name' | 'notes' | 'color' | 'storageType'>>
): Route {
  return {
    ...route,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Duplicate a route with a new name
 */
export function duplicateRoute(
  route: Route,
  newName?: string,
  cruisingSpeed: number = DEFAULT_CRUISING_SPEED
): Route {
  const now = new Date().toISOString();
  const newId = generateRouteId();

  // Create new points with new IDs
  const newPoints = route.routePoints.map((p, index) => ({
    ...p,
    id: generateRoutePointId(),
    order: index,
  }));

  return {
    ...route,
    id: newId,
    name: newName || `${route.name} (Copy)`,
    routePoints: newPoints,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Reverse a route
 */
export function reverseRouteDirection(
  route: Route,
  cruisingSpeed: number = DEFAULT_CRUISING_SPEED,
  method: RoutingMethod = 'great-circle'
): Route {
  return reverseRoute(route, cruisingSpeed, method);
}

/**
 * Clear all points from a route
 */
export function clearRoutePoints(route: Route): Route {
  return {
    ...route,
    routePoints: [],
    totalDistance: 0,
    estimatedDuration: 0,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Validate a route for errors
 */
export function validateRoute(route: Route): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate basic fields
  if (!route.name || route.name.trim() === '') {
    errors.push('Route name cannot be empty');
  }

  if (!route.id || route.id.trim() === '') {
    errors.push('Route ID is missing');
  }

  // Validate points
  const pointValidation = validateRoutePoints(route.routePoints);
  errors.push(...pointValidation.errors);

  // Warnings
  if (route.routePoints.length === 0) {
    warnings.push('Route has no points');
  } else if (route.routePoints.length === 1) {
    warnings.push('Route has only one point - needs at least two for navigation');
  }

  if (route.totalDistance === 0 && route.routePoints.length > 1) {
    warnings.push('Route has zero distance - points may be at same location');
  }

  if (route.totalDistance > 500) {
    warnings.push('Route is very long (>500 nm) - consider breaking into segments');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Convert waypoint references in route to static coordinates
 * (useful when waypoint might be deleted later)
 */
export function convertWaypointRefsToCoordinates(
  route: Route,
  cruisingSpeed: number = DEFAULT_CRUISING_SPEED
): Route {
  const updatedPoints = route.routePoints.map(p => ({
    ...p,
    waypointRef: null, // Remove waypoint reference, keeping position
  }));

  return recalculateRoute(
    {
      ...route,
      routePoints: updatedPoints,
    },
    cruisingSpeed
  );
}

/**
 * Get route summary statistics
 */
export function getRouteSummary(route: Route): {
  pointCount: number;
  totalDistance: number;
  estimatedDuration: number;
  waypointRefs: number;
  adHocPoints: number;
  longestLeg: { distance: number; from: string; to: string } | null;
  shortestLeg: { distance: number; from: string; to: string } | null;
} {
  const waypointRefs = route.routePoints.filter(p => p.waypointRef).length;
  const adHocPoints = route.routePoints.length - waypointRefs;

  let longestLeg: { distance: number; from: string; to: string } | null = null;
  let shortestLeg: { distance: number; from: string; to: string } | null = null;

  for (let i = 1; i < route.routePoints.length; i++) {
    const point = route.routePoints[i];
    const prevPoint = route.routePoints[i - 1];

    if (point.legDistance) {
      const legInfo = {
        distance: point.legDistance,
        from: prevPoint.name || `Point ${i}`,
        to: point.name || `Point ${i + 1}`,
      };

      if (!longestLeg || point.legDistance > longestLeg.distance) {
        longestLeg = legInfo;
      }

      if (!shortestLeg || point.legDistance < shortestLeg.distance) {
        shortestLeg = legInfo;
      }
    }
  }

  return {
    pointCount: route.routePoints.length,
    totalDistance: route.totalDistance,
    estimatedDuration: route.estimatedDuration || 0,
    waypointRefs,
    adHocPoints,
    longestLeg,
    shortestLeg,
  };
}

/**
 * Format distance for display (nm → user's distance unit)
 */
export function formatDistance(distanceNm: number, decimals: number = 1): string {
  return unitFormat.formatDistance(distanceNm, decimals);
}

/**
 * Format bearing for display
 */
export function formatBearing(bearing: number, showMagnetic: boolean = false): string {
  const rounded = Math.round(bearing);
  const prefix = showMagnetic ? 'M' : 'T';
  return `${rounded.toString().padStart(3, '0')}° ${prefix}`;
}

/**
 * Format duration for display
 */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);

  if (hours === 0) {
    return `${mins}m`;
  } else if (mins === 0) {
    return `${hours}h`;
  } else {
    return `${hours}h ${mins}m`;
  }
}

/**
 * Format ETA for display (converts minutes to time string)
 */
export function formatETA(etaMinutes: number): string {
  const now = new Date();
  const eta = new Date(now.getTime() + etaMinutes * 60000);
  
  const hours = eta.getHours();
  const minutes = eta.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  
  return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

/**
 * Format fuel consumption for display
 */
export function formatFuel(gallons: number, decimals: number = 1): string {
  return `${gallons.toFixed(decimals)} gal`;
}

/**
 * Calculate fuel consumption for route
 */
export function calculateFuelConsumption(
  durationMinutes: number,
  fuelBurnRate: number
): number {
  return (durationMinutes / 60) * fuelBurnRate;
}

/**
 * Export route to simple text format (can be extended to GPX later)
 */
export function exportRouteAsText(route: Route): string {
  let text = `Route: ${route.name}\n`;
  text += `Total Distance: ${formatDistance(route.totalDistance)}\n`;
  
  if (route.estimatedDuration) {
    text += `Estimated Duration: ${formatDuration(route.estimatedDuration)}\n`;
  }
  
  if (route.notes) {
    text += `Notes: ${route.notes}\n`;
  }
  
  text += `\nPoints:\n`;
  
  route.routePoints.forEach((point, index) => {
    text += `${index + 1}. `;
    
    if (point.name) {
      text += `${point.name} `;
    }
    
    text += `(${point.position.latitude.toFixed(5)}, ${point.position.longitude.toFixed(5)})`;
    
    if (point.legDistance && point.legBearing) {
      text += ` - ${formatDistance(point.legDistance)} @ ${formatBearing(point.legBearing)}`;
    }
    
    text += `\n`;
  });
  
  return text;
}

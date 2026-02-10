/**
 * Route Types
 * 
 * Data model for navigation routes stored either in:
 * - Firestore: users/{userId}/routes/{routeId} (cloud-synced routes)
 * - AsyncStorage: @XNautical:routes (local-only routes)
 * 
 * Routes consist of ordered points that can either reference existing waypoints
 * or be ad-hoc coordinates. Each leg between points includes calculated distance
 * and bearing for navigation.
 */

/** Storage preference for route persistence */
export type RouteStorageType = 'cloud' | 'local' | 'both';

/** Geographic position (latitude/longitude) */
export interface Position {
  /** GPS latitude in decimal degrees (-90 to 90) */
  latitude: number;
  /** GPS longitude in decimal degrees (-180 to 180) */
  longitude: number;
}

/**
 * A single point in a route.
 * Can be either:
 * - A reference to an existing waypoint (waypointRef set)
 * - An ad-hoc coordinate (waypointRef null)
 */
export interface RoutePoint {
  /** Unique point ID within this route */
  id: string;
  /** Geographic position of this point */
  position: Position;
  /** Optional display name (e.g., "Start", "Reef Point", or waypoint name) */
  name?: string;
  /** Reference to a saved waypoint ID (null if ad-hoc coordinate) */
  waypointRef?: string | null;
  /** Order in the route sequence (0-indexed) */
  order: number;
  /** Distance in nautical miles from previous point (null for first point) */
  legDistance: number | null;
  /** True bearing in degrees from previous point (null for first point) */
  legBearing: number | null;
  /** Optional notes for this specific point */
  notes?: string;
}

/** Navigation route with multiple points */
export interface Route {
  /** Unique route ID (Firestore document ID or generated UUID) */
  id: string;
  /** User-given route name (e.g., "Morning fishing run", "Bay crossing") */
  name: string;
  /** Ordered array of route points */
  routePoints: RoutePoint[];
  /** Total route distance in nautical miles (sum of all leg distances) */
  totalDistance: number;
  /** Estimated duration in minutes (based on cruising speed) */
  estimatedDuration: number | null;
  /** Hex color for route line rendering */
  color: string;
  /** Free-text notes about the entire route */
  notes: string;
  /** Storage type preference */
  storageType: RouteStorageType;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last edit */
  updatedAt: string;
}

/** Data needed to create a new route (id and timestamps auto-generated) */
export type RouteCreateData = Omit<Route, 'id' | 'createdAt' | 'updatedAt'>;

/** Navigation state for active route following */
export interface ActiveNavigation {
  /** ID of the route being navigated */
  routeId: string;
  /** Index of the current target point (next waypoint to reach) */
  currentPointIndex: number;
  /** Whether navigation is actively running */
  isActive: boolean;
  /** Cruising speed in knots (for ETA calculations) */
  cruisingSpeed: number;
  /** Arrival radius in nautical miles (when to consider point "reached") */
  arrivalRadius: number;
  /** Whether to auto-advance to next point when arrival radius reached */
  autoAdvance: boolean;
  /** ISO timestamp when navigation started */
  startedAt: string | null;
}

/** Real-time navigation calculations for active leg */
export interface NavigationLegData {
  /** Current point being navigated to */
  targetPoint: RoutePoint;
  /** Distance remaining to target point in nautical miles */
  distanceRemaining: number;
  /** True bearing to target point in degrees */
  bearingToTarget: number;
  /** Magnetic bearing to target point in degrees (with declination applied) */
  magneticBearing: number;
  /** Cross-track error in nautical miles (positive = right of course, negative = left) */
  crossTrackError: number;
  /** Estimated time to arrival in minutes (based on current SOG or cruising speed) */
  eta: number;
  /** Progress along this leg as percentage (0-100) */
  legProgress: number;
  /** Overall route progress as percentage (0-100) */
  routeProgress: number;
}

/** Default values for new routes */
export const DEFAULT_ROUTE_COLOR = '#FF6B35'; // Orange
export const DEFAULT_ARRIVAL_RADIUS = 0.1; // nautical miles (about 600 feet)
export const DEFAULT_CRUISING_SPEED = 8; // knots (typical displacement cruising boat)
export const DEFAULT_ROUTE_LINE_WIDTH = 3; // pixels

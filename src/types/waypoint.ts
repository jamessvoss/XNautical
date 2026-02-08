/**
 * Waypoint Types
 * 
 * Data model for user waypoints stored in Firestore at users/{userId}/waypoints/{waypointId}.
 * 
 * Phase 1: Categories differentiated by color (colored pin markers with short labels).
 * Phase 2: Custom-designed icons per category (swap rendering, no data migration needed).
 */

/** 13 categories: 1 general + 12 species/type categories */
export type WaypointCategory =
  | 'general'
  | 'salmon'
  | 'halibut'
  | 'rockfish'
  | 'lingcod'
  | 'crab'
  | 'shrimp'
  | 'tuna'
  | 'trout'
  | 'cod'
  | 'sablefish'
  | 'shark'
  | 'bottomfish';

export interface WaypointPhoto {
  /** Unique photo ID */
  id: string;
  /** Local file path (always available, even offline) */
  localUri: string;
  /** Firebase Storage download URL (null until uploaded) */
  remoteUrl: string | null;
  /** Whether the photo has been synced to Firebase Storage */
  uploaded: boolean;
  /** ISO timestamp when the photo was taken/picked */
  takenAt: string;
}

export interface Waypoint {
  /** Unique waypoint ID (Firestore document ID) */
  id: string;
  /** User-given name (e.g., "King hole", "Halibut spot #3") */
  name: string;
  /** GPS latitude */
  latitude: number;
  /** GPS longitude */
  longitude: number;
  /** Category for icon mapping (Phase 2: maps to custom icon asset) */
  category: WaypointCategory;
  /** Hex color for the marker -- primary visual differentiator in Phase 1 */
  color: string;
  /** Free-text notes */
  notes: string;
  /** Array of attached photos */
  photos: WaypointPhoto[];
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last edit */
  updatedAt: string;
}

/** Data needed to create a new waypoint (id and timestamps auto-generated) */
export type WaypointCreateData = Omit<Waypoint, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * S-57 Electronic Navigational Chart (ENC) Type Definitions
 * Based on IHO S-57 standard for digital hydrographic data
 */

export interface S57Dataset {
  name: string;
  edition: number;
  updateDate: string;
  issueDate: string;
  cellName: string;
  bounds?: GeographicBounds;
}

export interface GeographicBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface DepthContour {
  depth: number;
  coordinates: Coordinate[];
}

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface SoundingPoint {
  latitude: number;
  longitude: number;
  depth: number;
}

export interface NavigationAid {
  type: string;
  name?: string;
  latitude: number;
  longitude: number;
  description?: string;
}

export interface S57Feature {
  featureType: string;
  attributes: Record<string, any>;
  geometry: Coordinate[];
}

export interface ChartMetadata {
  title: string;
  scale: number;
  compilationScale?: number;
  authority: string;
  edition: number;
  updateNumber: number;
  bounds: GeographicBounds;
}

// Homer Harbor Chart specific data
export const HOMER_HARBOR_METADATA: ChartMetadata = {
  title: 'Homer Harbor',
  scale: 20000, // Typical scale for harbor charts
  authority: 'NOAA',
  edition: 1,
  updateNumber: 0,
  bounds: {
    // Homer Spit, Alaska approximate bounds
    minLat: 59.60,
    maxLat: 59.65,
    minLon: -151.52,
    maxLon: -151.40,
  },
};

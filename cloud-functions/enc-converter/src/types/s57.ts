/**
 * S-57 data model type definitions.
 * Represents the hydrographic chart data extracted from ISO 8211 records.
 */

/**
 * Record Name (RCNM) values for S-57.
 */
export const RCNM = {
  DS: 10,   // Data Set General Information
  DP: 20,   // Data Set Geographic Reference
  FE: 100,  // Feature Record
  VI: 110,  // Vector - Isolated Node
  VC: 120,  // Vector - Connected Node
  VE: 130,  // Vector - Edge
} as const;

/**
 * Geometric primitive types (PRIM field).
 */
export const PRIM = {
  POINT: 1,
  LINE: 2,
  AREA: 3,
  NONE: 255,
} as const;

/**
 * Orientation values (ORNT field in FSPT/VRPT).
 */
export const ORNT = {
  FORWARD: 1,
  REVERSE: 2,
  NULL: 255,
} as const;

/**
 * Usage indicator values (USAG field in FSPT).
 */
export const USAG = {
  EXTERIOR: 1,
  INTERIOR: 2,
  EXTERIOR_TRUNCATED: 3,
  NULL: 255,
} as const;

/**
 * Topology indicator values (TOPI field in VRPT).
 */
export const TOPI = {
  BEGINNING: 1,
  END: 2,
  LEFT_FACE: 3,
  RIGHT_FACE: 4,
  CONTAINING_FACE: 5,
} as const;

/**
 * Data Set Identification (DSID) information.
 */
export interface S57DatasetIdentification {
  /** Record name (should be 10) */
  rcnm: number;
  /** Record identification number */
  rcid: number;
  /** Exchange purpose (N=New, R=Revision) */
  expp: number;
  /** Intended usage (1-9 scale range) */
  intu: number;
  /** Dataset name */
  dsnm: string;
  /** Edition number */
  edtn: string;
  /** Update number */
  updn: string;
  /** Update application date */
  uadt: string;
  /** Issue date */
  isdt: string;
  /** S-57 edition number */
  sted: string;
  /** Product specification (e.g., 'ENC') */
  prsp: number;
  /** Application profile ID */
  prof: number;
  /** Producing agency code */
  agen: number;
  /** Comment */
  comt: string;
  /** Data structure (1=cartographic spaghetti, 2=chain-node, etc.) */
  dstr: number;
  /** Lexical level for ATTF */
  aall: number;
  /** Lexical level for NATF */
  nall: number;
  /** Number of meta records */
  nomr: number;
  /** Number of cartographic records */
  nocr: number;
  /** Number of geo records */
  nogr: number;
  /** Number of collection records */
  nolr: number;
  /** Number of isolated node records */
  noin: number;
  /** Number of connected node records */
  nocn: number;
  /** Number of edge records */
  noed: number;
  /** Number of face records */
  nofa: number;
}

/**
 * Data Set Parameter (DSPM) information.
 */
export interface S57DatasetParameters {
  /** Record name */
  rcnm: number;
  /** Record identification number */
  rcid: number;
  /** Horizontal datum (2 = WGS-84) */
  hdat: number;
  /** Vertical datum */
  vdat: number;
  /** Sounding datum */
  sdat: number;
  /** Compilation scale */
  cscl: number;
  /** Depth measurement unit (1=metres) */
  duni: number;
  /** Height measurement unit */
  huni: number;
  /** Positional accuracy unit */
  puni: number;
  /** Coordinate unit (1=lat/lon, 2=easting/northing, 3=units on chart) */
  coun: number;
  /** Coordinate multiplication factor */
  comf: number;
  /** Sounding multiplication factor */
  somf: number;
}

/**
 * A spatial reference from a feature record (FSPT).
 */
export interface S57SpatialRef {
  /** Record name type (110=VI, 120=VC, 130=VE) */
  rcnm: number;
  /** Record identification number */
  rcid: number;
  /** Orientation (1=Forward, 2=Reverse) */
  ornt: number;
  /** Usage indicator (1=Exterior, 2=Interior) */
  usag: number;
  /** Mask indicator */
  mask: number;
}

/**
 * An S-57 feature record (chart object like DEPARE, LIGHTS, etc.).
 */
export interface S57Feature {
  /** Record identification number */
  rcid: number;
  /** Geometric primitive (1=Point, 2=Line, 3=Area, 255=None) */
  prim: number;
  /** Group (1=Skin of earth, 2=All other) */
  grup: number;
  /** Object class code (e.g., 42=DEPARE, 75=LIGHTS) */
  objl: number;
  /** Producing agency */
  agen: number;
  /** Feature identification number */
  fidn: number;
  /** Feature identification subdivision */
  fids: number;
  /** Feature attributes (attribute code → value) */
  attributes: Map<number, string>;
  /** National attributes */
  natAttributes: Map<number, string>;
  /** Spatial record references */
  spatialRefs: S57SpatialRef[];
}

/**
 * An isolated or connected node (spatial object with a single position).
 */
export interface S57Node {
  /** Record identification number */
  rcid: number;
  /** Record name type (110=isolated, 120=connected) */
  rcnm: number;
  /** Latitude in decimal degrees */
  lat: number;
  /** Longitude in decimal degrees */
  lon: number;
  /** Depth/height value (for 3D soundings — first coordinate) */
  depth?: number;
  /** All sounding coordinates when SG3D contains multiple points */
  soundings?: Array<{ lat: number; lon: number; depth: number }>;
}

/**
 * An edge (spatial object forming a line segment between nodes).
 */
export interface S57Edge {
  /** Record identification number */
  rcid: number;
  /** Start connected node RCID */
  startNode: number;
  /** End connected node RCID */
  endNode: number;
  /** Intermediate coordinate pairs */
  coordinates: Array<{ lat: number; lon: number }>;
}

/**
 * Complete parsed S-57 dataset.
 */
export interface S57Dataset {
  /** Dataset identification */
  dsid: S57DatasetIdentification;
  /** Dataset parameters */
  dspm: S57DatasetParameters;
  /** Feature records indexed by RCID */
  features: Map<number, S57Feature>;
  /** Isolated node records indexed by RCID */
  isolatedNodes: Map<number, S57Node>;
  /** Connected node records indexed by RCID */
  connectedNodes: Map<number, S57Node>;
  /** Edge records indexed by RCID */
  edges: Map<number, S57Edge>;
}

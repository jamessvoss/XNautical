/**
 * S-57 to GeoJSON Builder
 *
 * Resolves S-57 spatial references into GeoJSON geometry:
 * - Points (PRIM=1): Feature → Isolated Node → single coordinate
 * - Lines  (PRIM=2): Feature → ordered Edge refs → concatenated coordinates
 * - Areas  (PRIM=3): Feature → exterior/interior rings → Polygon/MultiPolygon
 */

import {
  S57Dataset,
  S57Feature,
  S57Edge,
  S57SpatialRef,
  PRIM,
  ORNT,
  USAG,
  RCNM,
} from '../types/s57';
import { getObjectClassName } from '../s52/objectCatalogue';
import { getAttributeAcronym } from '../s52/objectCatalogue';

type Position = [number, number]; // [lon, lat] per GeoJSON spec
type Position3D = [number, number, number]; // [lon, lat, depth]

interface GeoJSONFeature {
  type: 'Feature';
  geometry: GeoJSONGeometry | null;
  properties: Record<string, unknown>;
}

type GeoJSONGeometry =
  | { type: 'Point'; coordinates: Position | Position3D }
  | { type: 'MultiPoint'; coordinates: (Position | Position3D)[] }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'MultiLineString'; coordinates: Position[][] }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] };

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

/**
 * Convert an S-57 dataset to a GeoJSON FeatureCollection.
 */
export function s57ToGeoJSON(dataset: S57Dataset): GeoJSONFeatureCollection {
  const features: GeoJSONFeature[] = [];

  for (const [, s57Feature] of dataset.features) {
    const geometry = resolveGeometry(s57Feature, dataset);
    const properties = buildProperties(s57Feature);

    // For sounding features, extract depth from 3D coordinates into properties
    // so MapLibre can render per-feature depth labels
    if (geometry && s57Feature.prim === PRIM.POINT) {
      if (geometry.type === 'Point' && geometry.coordinates.length >= 3) {
        const depth = geometry.coordinates[2] as number;
        properties.DEPTH = depth;
        properties.DEPTH_LABEL = formatDepthLabel(depth);
      } else if (geometry.type === 'MultiPoint') {
        // For multi-point soundings, store the first depth
        const first3d = geometry.coordinates.find(c => c.length >= 3);
        if (first3d) {
          properties.DEPTH = first3d[2] as number;
          properties.DEPTH_LABEL = formatDepthLabel(first3d[2] as number);
        }
      }
    }

    // Validate geometry to avoid MapLibre "Invalid geometry" warnings
    if (geometry && !isValidGeometry(geometry)) {
      features.push({ type: 'Feature', geometry: null, properties });
      continue;
    }

    features.push({
      type: 'Feature',
      geometry,
      properties,
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * Get the bounding box of the dataset [minLon, minLat, maxLon, maxLat].
 */
export function getDatasetBounds(dataset: S57Dataset): [number, number, number, number] | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  let found = false;

  for (const [, node] of dataset.isolatedNodes) {
    if (node.soundings) {
      for (const s of node.soundings) {
        if (s.lon < minLon) minLon = s.lon;
        if (s.lon > maxLon) maxLon = s.lon;
        if (s.lat < minLat) minLat = s.lat;
        if (s.lat > maxLat) maxLat = s.lat;
      }
    } else {
      if (node.lon < minLon) minLon = node.lon;
      if (node.lon > maxLon) maxLon = node.lon;
      if (node.lat < minLat) minLat = node.lat;
      if (node.lat > maxLat) maxLat = node.lat;
    }
    found = true;
  }
  for (const [, node] of dataset.connectedNodes) {
    if (node.lon < minLon) minLon = node.lon;
    if (node.lon > maxLon) maxLon = node.lon;
    if (node.lat < minLat) minLat = node.lat;
    if (node.lat > maxLat) maxLat = node.lat;
    found = true;
  }
  for (const [, edge] of dataset.edges) {
    for (const coord of edge.coordinates) {
      if (coord.lon < minLon) minLon = coord.lon;
      if (coord.lon > maxLon) maxLon = coord.lon;
      if (coord.lat < minLat) minLat = coord.lat;
      if (coord.lat > maxLat) maxLat = coord.lat;
      found = true;
    }
  }

  return found ? [minLon, minLat, maxLon, maxLat] : null;
}

// ─── Geometry resolution ─────────────────────────────────────────────────

function resolveGeometry(
  feature: S57Feature,
  dataset: S57Dataset,
): GeoJSONGeometry | null {
  if (feature.spatialRefs.length === 0) return null;

  switch (feature.prim) {
    case PRIM.POINT:
      return resolvePointGeometry(feature, dataset);
    case PRIM.LINE:
      return resolveLineGeometry(feature, dataset);
    case PRIM.AREA:
      return resolveAreaGeometry(feature, dataset);
    default:
      return null;
  }
}

/**
 * Resolve point geometry.
 * Points reference isolated nodes (VI=110) or connected nodes (VC=120).
 * Soundings (SG3D) may have multiple 3D points → MultiPoint.
 */
function resolvePointGeometry(
  feature: S57Feature,
  dataset: S57Dataset,
): GeoJSONGeometry | null {
  const points: (Position | Position3D)[] = [];

  for (const ref of feature.spatialRefs) {
    if (ref.rcnm === RCNM.VI) {
      const node = dataset.isolatedNodes.get(ref.rcid);
      if (node) {
        // SOUNDG nodes may have multiple 3D coordinates packed in SG3D
        if (node.soundings) {
          for (const s of node.soundings) {
            points.push([s.lon, s.lat, s.depth]);
          }
        } else if (node.depth !== undefined) {
          points.push([node.lon, node.lat, node.depth]);
        } else {
          points.push([node.lon, node.lat]);
        }
      }
    } else if (ref.rcnm === RCNM.VC) {
      const node = dataset.connectedNodes.get(ref.rcid);
      if (node) {
        points.push([node.lon, node.lat]);
      }
    }
  }

  if (points.length === 0) return null;
  if (points.length === 1) {
    return { type: 'Point', coordinates: points[0] };
  }
  return { type: 'MultiPoint', coordinates: points };
}

/**
 * Resolve line geometry.
 * Lines reference edges (VE=130) with orientation (ORNT).
 * Edges are concatenated in order, with start/end nodes prepended/appended.
 */
function resolveLineGeometry(
  feature: S57Feature,
  dataset: S57Dataset,
): GeoJSONGeometry | null {
  const edgeRefs = feature.spatialRefs.filter(r => r.rcnm === RCNM.VE);
  if (edgeRefs.length === 0) return null;

  const lines: Position[][] = [];
  let currentLine: Position[] = [];

  for (const ref of edgeRefs) {
    const edgeCoords = resolveEdgeCoordinates(ref, dataset);
    if (edgeCoords.length === 0) continue;

    // Try to chain edges into a continuous line
    if (currentLine.length === 0) {
      currentLine = edgeCoords;
    } else {
      const lastPt = currentLine[currentLine.length - 1];
      const firstPt = edgeCoords[0];

      if (lastPt[0] === firstPt[0] && lastPt[1] === firstPt[1]) {
        // Edges connect: append (skip duplicate point)
        for (let i = 1; i < edgeCoords.length; i++) {
          currentLine.push(edgeCoords[i]);
        }
      } else {
        // Edges don't connect: start a new line segment
        if (currentLine.length >= 2) {
          lines.push(currentLine);
        }
        currentLine = edgeCoords;
      }
    }
  }

  if (currentLine.length >= 2) {
    lines.push(currentLine);
  }

  if (lines.length === 0) return null;
  if (lines.length === 1) {
    return { type: 'LineString', coordinates: lines[0] };
  }
  return { type: 'MultiLineString', coordinates: lines };
}

/**
 * Resolve area geometry.
 * Areas reference edges with USAG indicating exterior (1) or interior (2) rings.
 * Produces Polygon or MultiPolygon.
 *
 * When exterior edges form multiple disconnected rings, each becomes a
 * separate polygon in a MultiPolygon.
 */
function resolveAreaGeometry(
  feature: S57Feature,
  dataset: S57Dataset,
): GeoJSONGeometry | null {
  const edgeRefs = feature.spatialRefs.filter(r => r.rcnm === RCNM.VE);
  if (edgeRefs.length === 0) return null;

  // Separate exterior and interior edge references
  const exteriorRefs = edgeRefs.filter(r => r.usag === USAG.EXTERIOR || r.usag === USAG.EXTERIOR_TRUNCATED);
  const interiorRefs = edgeRefs.filter(r => r.usag === USAG.INTERIOR);

  // Build exterior rings — disconnected edge groups become separate rings
  // Enforce GeoJSON winding order: exterior = CCW, interior = CW
  const exteriorRings = buildRings(exteriorRefs, dataset).map(ensureCCW);
  if (exteriorRings.length === 0) return null;

  // Build interior rings (holes)
  const interiorRings = buildRings(interiorRefs, dataset).map(ensureCW);

  if (exteriorRings.length === 1) {
    // Simple Polygon: one exterior ring + any interior rings
    return { type: 'Polygon', coordinates: [exteriorRings[0], ...interiorRings] };
  }

  // MultiPolygon: each exterior ring becomes its own polygon
  // Assign interior rings to the exterior ring that contains them
  const polygons: Position[][][] = exteriorRings.map(extRing => [extRing]);

  for (const hole of interiorRings) {
    // Find which exterior ring contains this hole (test first point)
    let assigned = false;
    for (let i = 0; i < exteriorRings.length; i++) {
      if (pointInRing(hole[0], exteriorRings[i])) {
        polygons[i].push(hole);
        assigned = true;
        break;
      }
    }
    // Fallback: assign to first polygon
    if (!assigned) {
      polygons[0].push(hole);
    }
  }

  return { type: 'MultiPolygon', coordinates: polygons };
}

/**
 * Build closed rings from a set of edge references.
 * When consecutive edges don't connect, a new ring is started.
 * Returns one ring per connected group of edges.
 */
function buildRings(refs: S57SpatialRef[], dataset: S57Dataset): Position[][] {
  const rings: Position[][] = [];
  let current: Position[] = [];

  for (const ref of refs) {
    const edgeCoords = resolveEdgeCoordinates(ref, dataset);
    if (edgeCoords.length === 0) continue;

    if (current.length === 0) {
      current = edgeCoords;
    } else {
      const lastPt = current[current.length - 1];
      const firstPt = edgeCoords[0];

      if (lastPt[0] === firstPt[0] && lastPt[1] === firstPt[1]) {
        // Edges connect: append (skip duplicate point)
        for (let i = 1; i < edgeCoords.length; i++) {
          current.push(edgeCoords[i]);
        }
      } else {
        // Edges don't connect: close current ring, start a new one
        closeRing(current);
        if (current.length >= 4) {
          rings.push(current);
        }
        current = edgeCoords;
      }
    }
  }

  // Close and add the last ring
  closeRing(current);
  if (current.length >= 4) {
    rings.push(current);
  }

  return rings;
}

/** Close a ring by appending the first point if needed. */
function closeRing(coords: Position[]): void {
  if (coords.length >= 3) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      coords.push([first[0], first[1]]);
    }
  }
}

/** Ray-casting point-in-polygon test for assigning holes to exterior rings. */
function pointInRing(point: Position, ring: Position[]): boolean {
  let inside = false;
  const [px, py] = point;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Signed area of a ring (shoelace formula).
 * Positive = counter-clockwise, Negative = clockwise.
 */
function ringSignedArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 0, len = ring.length; i < len; i++) {
    const j = (i + 1) % len;
    sum += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  return sum;
}

/** Ensure exterior ring is counter-clockwise per GeoJSON RFC 7946. */
function ensureCCW(ring: Position[]): Position[] {
  if (ringSignedArea(ring) < 0) ring.reverse();
  return ring;
}

/** Ensure interior ring (hole) is clockwise per GeoJSON RFC 7946. */
function ensureCW(ring: Position[]): Position[] {
  if (ringSignedArea(ring) > 0) ring.reverse();
  return ring;
}

/**
 * Resolve an edge's coordinates including start/end nodes.
 * Respects ORNT (orientation): REVERSE means coordinates are reversed.
 */
function resolveEdgeCoordinates(ref: S57SpatialRef, dataset: S57Dataset): Position[] {
  const edge = dataset.edges.get(ref.rcid);
  if (!edge) return [];

  const startNode = dataset.connectedNodes.get(edge.startNode);
  const endNode = dataset.connectedNodes.get(edge.endNode);
  const edgeLen = edge.coordinates.length;

  // Pre-allocate array to exact size and fill directly (no intermediate arrays)
  const fullCoords: Position[] = new Array(
    edgeLen + (startNode ? 1 : 0) + (endNode ? 1 : 0),
  );
  let idx = 0;
  if (startNode) fullCoords[idx++] = [startNode.lon, startNode.lat];
  for (let i = 0; i < edgeLen; i++) {
    fullCoords[idx++] = [edge.coordinates[i].lon, edge.coordinates[i].lat];
  }
  if (endNode) fullCoords[idx++] = [endNode.lon, endNode.lat];

  // Reverse if orientation is reverse
  if (ref.ornt === ORNT.REVERSE) {
    fullCoords.reverse();
  }

  return fullCoords;
}

// ─── Geometry validation ─────────────────────────────────────────────────

function isValidGeometry(geom: GeoJSONGeometry): boolean {
  switch (geom.type) {
    case 'Point':
      return geom.coordinates.length >= 2 && isFinite(geom.coordinates[0]) && isFinite(geom.coordinates[1]);
    case 'MultiPoint':
      return geom.coordinates.length > 0;
    case 'LineString':
      return geom.coordinates.length >= 2;
    case 'MultiLineString':
      return geom.coordinates.length > 0 && geom.coordinates.every(line => line.length >= 2);
    case 'Polygon':
      return geom.coordinates.length > 0 && geom.coordinates[0].length >= 4;
    case 'MultiPolygon':
      return geom.coordinates.length > 0 &&
        geom.coordinates.every(poly => poly.length > 0 && poly[0].length >= 4);
    default:
      return false;
  }
}

// ─── Depth formatting ────────────────────────────────────────────────────

function formatDepthLabel(depth: number): string {
  const d = Math.abs(depth);
  const whole = Math.floor(d);
  const frac = Math.round((d - whole) * 10);
  if (frac === 0) return depth < 0 ? `-${whole}` : `${whole}`;
  const str = `${whole}.${frac}`;
  return depth < 0 ? `-${str}` : str;
}

// ─── Properties builder ──────────────────────────────────────────────────

function buildProperties(feature: S57Feature): Record<string, unknown> {
  const props: Record<string, unknown> = {
    RCID: feature.rcid,
    PRIM: feature.prim,
    OBJL: feature.objl,
    OBJL_NAME: getObjectClassName(feature.objl),
    GRUP: feature.grup,
  };

  // Add all S-57 attributes, converting numeric codes to acronyms
  for (const [code, value] of feature.attributes) {
    const acronym = getAttributeAcronym(code);
    props[acronym] = value;
  }

  return props;
}

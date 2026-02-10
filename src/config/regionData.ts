/**
 * Region Data Configuration
 *
 * Static geographic data for all 9 NOAA regions (mapped to former USCG Districts).
 * Each region contains pre-extracted US1 chart bounding boxes for map display.
 *
 * US1 chart bounds are extracted from NOAA S-57 ENC data using ogrinfo.
 * These are hardcoded so the app doesn't need to process them at runtime.
 */

// ============================================
// Types
// ============================================

/** A single US1-scale chart bounding box */
export interface US1ChartBounds {
  /** Chart name (e.g., 'US1WC01M') */
  name: string;
  /** Western extent (longitude) */
  west: number;
  /** Southern extent (latitude) */
  south: number;
  /** Eastern extent (longitude) */
  east: number;
  /** Northern extent (latitude) */
  north: number;
}

/** A NOAA region (mapped from former USCG Coast Guard District) */
export interface Region {
  /** Region key (e.g., 'arctic', 'southwest') */
  id: string;
  /** Display name (e.g., 'Arctic') */
  name: string;
  /** Former USCG district number (e.g., '17') */
  formerDistrict: string;
  /** Former USCG district label (e.g., '17 CGD') */
  formerDistrictLabel: string;
  /** Firestore document ID (e.g., '17cgd') */
  firestoreId: string;
  /** Brief description of coverage area */
  description: string;
  /** Map center [latitude, longitude] */
  center: [number, number];
  /** Color for map display */
  color: string;
  /** Whether cloud charts exist for this region */
  status: 'pending' | 'converted';
  /** Camera bounds [west, south, east, north] for optimal map view */
  mapBounds: [number, number, number, number];
  /** Estimated chart download size in MB (US1-US6, required) */
  estimatedChartSizeMB: number;
  /** Pre-extracted US1 chart bounding boxes */
  us1Charts: US1ChartBounds[];
}

export type SatelliteResolution = 'low' | 'medium' | 'high';

export interface SatelliteOption {
  resolution: SatelliteResolution;
  label: string;
  zoomLevels: string;
  estimatedSizeMB: number;
}

// ============================================
// Satellite Resolution Options
// ============================================

export const SATELLITE_OPTIONS: SatelliteOption[] = [
  { resolution: 'low', label: 'Low', zoomLevels: 'z0-5', estimatedSizeMB: 30 },
  { resolution: 'medium', label: 'Medium', zoomLevels: 'z0-9', estimatedSizeMB: 120 },
  { resolution: 'high', label: 'High', zoomLevels: 'z0-14', estimatedSizeMB: 800 },
];

// ============================================
// All NOAA Regions
// ============================================

export const REGIONS: Region[] = [
  {
    id: 'arctic',
    name: 'Arctic',
    formerDistrict: '17',
    formerDistrictLabel: '17 CGD',
    firestoreId: '17cgd',
    description: 'Alaska & Arctic',
    center: [62.0, -153.0],
    color: '#06b6d4',
    status: 'converted',
    mapBounds: [-180, 48, -130, 72],
    estimatedChartSizeMB: 350,
    us1Charts: [
      { name: 'US1AK90M', west: -179.527153, south: 64.348743, east: -133.484583, north: 74.580426 },
      { name: 'US1BS01M', west: -180.0, south: 48.059052, east: -160.401899, north: 61.169882 },
      { name: 'US1BS02M', west: 165.193533, south: 48.386984, east: 180.0, north: 60.950538 },
      { name: 'US1BS03M', west: -180.0, south: 58.284858, east: -159.56905, north: 68.180998 },
      { name: 'US1BS04M', west: 166.335469, south: 58.297091, east: 180.0, north: 68.149012 },
      { name: 'US1EEZ1M', west: 138.835426, south: 8.953691, east: 173.227561, north: 24.761043 },
      { name: 'US1GLBDA', west: -180.0, south: 38.4, east: -153.6, north: 62.4 },
      { name: 'US1GLBDC', west: -153.6, south: 38.4, east: -134.4, north: 62.4 },
      { name: 'US1GLBDD', west: -134.4, south: 38.4, east: -116.333333, north: 61.25 },
      { name: 'US1GLBDS', west: 165.666667, south: 48.5, east: 180.0, north: 62.4 },
      { name: 'US1GLBEA', west: -180.0, south: 62.4, east: -134.00015, north: 73.99999 },
      { name: 'US1GLBES', west: 166.75, south: 62.4, east: 180.0, north: 68.0 },
      { name: 'US1PO02M', west: -162.57242, south: 11.407873, east: -113.555523, north: 67.801099 },
      { name: 'US1WC01M', west: -138.741336, south: 30.71236, east: -115.317922, north: 56.201147 },
      { name: 'US1WC04M', west: -166.181536, south: 49.186154, east: -131.988681, north: 61.535556 },
      { name: 'US1WC07M', west: -180.0, south: 17.540943, east: -116.045281, north: 60.691936 },
    ],
  },
  {
    id: 'oceania',
    name: 'Oceania',
    formerDistrict: '14',
    formerDistrictLabel: '14 CGD',
    firestoreId: '14cgd',
    description: 'Hawaii & Pacific Islands',
    center: [21.0, -157.5],
    color: '#a855f7',
    status: 'pending',
    mapBounds: [-162, 17, -153, 23],
    estimatedChartSizeMB: 140,
    us1Charts: [],
  },
  {
    id: 'northwest',
    name: 'Northwest',
    formerDistrict: '13',
    formerDistrictLabel: '13 CGD',
    firestoreId: '13cgd',
    description: 'WA, OR, Northern CA',
    center: [43.0, -124.5],
    color: '#22c55e',
    status: 'pending',
    mapBounds: [-128, 34, -120, 49],
    estimatedChartSizeMB: 150,
    us1Charts: [],
  },
  {
    id: 'southwest',
    name: 'Southwest',
    formerDistrict: '11',
    formerDistrictLabel: '11 CGD',
    firestoreId: '11cgd',
    description: 'Southern CA, AZ, NV',
    center: [33.5, -119.0],
    color: '#eab308',
    status: 'converted',
    mapBounds: [-125, 30, -115, 38],
    estimatedChartSizeMB: 135,
    us1Charts: [
      { name: 'US1GLBDC', west: -153.6, south: 38.4, east: -134.4, north: 62.4 },
      { name: 'US1GLBDD', west: -134.4, south: 38.4, east: -116.333333, north: 61.25 },
      { name: 'US1PO02M', west: -162.57242, south: 11.407873, east: -113.555523, north: 67.801099 },
      { name: 'US1WC01M', west: -138.741336, south: 30.71236, east: -115.317922, north: 56.201147 },
      { name: 'US1WC07M', west: -180.0, south: 17.540943, east: -116.045281, north: 60.691936 },
    ],
  },
  {
    id: 'heartland',
    name: 'Heartland',
    formerDistrict: '08',
    formerDistrictLabel: '8 CGD',
    firestoreId: '08cgd',
    description: 'Gulf Coast & Inland Rivers',
    center: [28.0, -91.0],
    color: '#f97316',
    status: 'pending',
    mapBounds: [-98, 24, -82, 32],
    estimatedChartSizeMB: 190,
    us1Charts: [
      { name: 'US1GC09M', west: -98.453131, south: 17.373274, east: -75.654643, north: 34.044929 },
    ],
  },
  {
    id: 'great_lakes',
    name: 'Great Lakes',
    formerDistrict: '09',
    formerDistrictLabel: '9 CGD',
    firestoreId: '09cgd',
    description: 'Great Lakes States',
    center: [44.0, -84.0],
    color: '#3b82f6',
    status: 'pending',
    mapBounds: [-93, 41, -76, 49],
    estimatedChartSizeMB: 150,
    us1Charts: [],
  },
  {
    id: 'northeast',
    name: 'Northeast',
    formerDistrict: '01',
    formerDistrictLabel: '1 CGD',
    firestoreId: '01cgd',
    description: 'New England',
    center: [42.0, -70.0],
    color: '#ef4444',
    status: 'pending',
    mapBounds: [-74, 40, -66, 48],
    estimatedChartSizeMB: 190,
    us1Charts: [],
  },
  {
    id: 'east',
    name: 'East',
    formerDistrict: '05',
    formerDistrictLabel: '5 CGD',
    firestoreId: '05cgd',
    description: 'Mid-Atlantic',
    center: [37.5, -75.5],
    color: '#8b5cf6',
    status: 'pending',
    mapBounds: [-80, 33, -73, 41],
    estimatedChartSizeMB: 175,
    us1Charts: [],
  },
  {
    id: 'southeast',
    name: 'Southeast',
    formerDistrict: '07',
    formerDistrictLabel: '7 CGD',
    firestoreId: '07cgd',
    description: 'SE Coast & Caribbean',
    center: [27.0, -78.0],
    color: '#ec4899',
    status: 'converted',
    mapBounds: [-84, 24, -64, 34],
    estimatedChartSizeMB: 180,
    us1Charts: [
      { name: 'US1GC09M', west: -98.4375, south: 16.636192, east: -75.9375, north: 34.307144 },
    ],
  },
];

// ============================================
// Helpers
// ============================================

/**
 * Get a region by its ID (e.g., 'arctic')
 */
export function getRegionById(id: string): Region | undefined {
  return REGIONS.find(r => r.id === id);
}

/**
 * Get a region by its Firestore ID (e.g., '17cgd')
 */
export function getRegionByFirestoreId(firestoreId: string): Region | undefined {
  return REGIONS.find(r => r.firestoreId === firestoreId);
}

/**
 * Get a region by its former district number (e.g., '17')
 */
export function getRegionByDistrict(districtNumber: string): Region | undefined {
  return REGIONS.find(r => r.formerDistrict === districtNumber);
}

/**
 * Convert a region's US1 chart bounds to GeoJSON FeatureCollection
 * for rendering as rectangles on a MapLibre map.
 */
export function getUS1ChartsGeoJSON(regionId: string): GeoJSON.FeatureCollection {
  const region = getRegionById(regionId);
  if (!region) {
    return { type: 'FeatureCollection', features: [] };
  }

  return {
    type: 'FeatureCollection',
    features: region.us1Charts.map(chart => ({
      type: 'Feature' as const,
      properties: {
        name: chart.name,
        regionId: region.id,
        color: region.color,
      },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[
          [chart.west, chart.south],
          [chart.east, chart.south],
          [chart.east, chart.north],
          [chart.west, chart.north],
          [chart.west, chart.south],
        ]],
      },
    })),
  };
}

/**
 * Get the camera bounding box for a region.
 * Returns [west, south, east, north] for MapLibre camera bounds.
 *
 * Dynamically computes from US1 chart extents with a 25% buffer.
 * Filters out charts with positive longitudes (antimeridian-crossing
 * western Bering Sea / Pacific sectors) to avoid the bbox spanning
 * the entire globe. Falls back to mapBounds when no charts exist.
 */
export function getRegionBBox(regionId: string): [number, number, number, number] {
  const region = getRegionById(regionId);
  if (!region) return [-180, 17, -50, 72]; // US overview fallback

  // Filter to western-hemisphere charts only (negative longitudes)
  // to avoid antimeridian issues with Bering Sea/Pacific charts
  const usableCharts = region.us1Charts.filter(c => c.west < 0 && c.east < 0);

  if (usableCharts.length === 0) {
    // No usable charts - use the static mapBounds fallback
    return region.mapBounds;
  }

  let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
  for (const chart of usableCharts) {
    if (chart.west < minLng) minLng = chart.west;
    if (chart.east > maxLng) maxLng = chart.east;
    if (chart.south < minLat) minLat = chart.south;
    if (chart.north > maxLat) maxLat = chart.north;
  }

  // Add 25% buffer on each axis
  const lngSpan = maxLng - minLng;
  const latSpan = maxLat - minLat;
  const lngBuffer = lngSpan * 0.125; // 12.5% each side = 25% total
  const latBuffer = latSpan * 0.125;

  return [
    Math.max(minLng - lngBuffer, -180),
    Math.max(minLat - latBuffer, -90),
    Math.min(maxLng + lngBuffer, 180),
    Math.min(maxLat + latBuffer, 90),
  ];
}

/**
 * Get all regions as a simple GeoJSON for overview rendering.
 * Each feature is a point at the region center.
 */
export function getRegionCentersGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: REGIONS.map(r => ({
      type: 'Feature' as const,
      properties: {
        id: r.id,
        name: r.name,
        description: r.description,
        color: r.color,
        status: r.status,
        chartCount: r.us1Charts.length,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [r.center[1], r.center[0]], // [lng, lat]
      },
    })),
  };
}

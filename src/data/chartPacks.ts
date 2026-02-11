/**
 * Pre-defined chart packs covering popular Alaska boating areas
 * These define geographic regions - charts are matched by bounds intersection
 */

/** Pre-defined chart pack region for UI browsing */
export interface ChartPackRegion {
  id: string;
  name: string;
  description: string;
  bounds: [number, number, number, number]; // [west, south, east, north]
  center: [number, number]; // [lng, lat]
  zoom: number;
  color: string;
  estimatedSizeMB: number;
}

export const CHART_PACKS: ChartPackRegion[] = [
  {
    id: 'homer-kachemak',
    name: 'Homer & Kachemak Bay',
    description: 'Homer Spit, Kachemak Bay, Seldovia, Halibut Cove, and surrounding waters',
    bounds: [-151.8, 59.4, -151.0, 59.75],
    center: [-151.4, 59.6],
    zoom: 10,
    color: '#4CAF50',
    estimatedSizeMB: 45,
  },
  {
    id: 'kodiak',
    name: 'Kodiak Island',
    description: 'Kodiak Harbor, Chiniak Bay, and Kodiak Island approaches',
    bounds: [-154.5, 57.0, -152.0, 58.5],
    center: [-153.4, 57.8],
    zoom: 8,
    color: '#2196F3',
    estimatedSizeMB: 85,
  },
  {
    id: 'prince-william-sound',
    name: 'Prince William Sound',
    description: 'Valdez, Whittier, Cordova, and Prince William Sound waters',
    bounds: [-148.5, 60.0, -145.5, 61.2],
    center: [-147.0, 60.6],
    zoom: 8,
    color: '#9C27B0',
    estimatedSizeMB: 120,
  },
  {
    id: 'seward-resurrection',
    name: 'Seward & Resurrection Bay',
    description: 'Seward Harbor, Resurrection Bay, and Kenai Fjords approaches',
    bounds: [-150.2, 59.7, -149.2, 60.2],
    center: [-149.7, 60.0],
    zoom: 10,
    color: '#FF9800',
    estimatedSizeMB: 35,
  },
  {
    id: 'anchorage-cook-inlet',
    name: 'Anchorage & Upper Cook Inlet',
    description: 'Anchorage, Knik Arm, Turnagain Arm, and upper Cook Inlet',
    bounds: [-151.0, 60.8, -149.0, 61.5],
    center: [-150.0, 61.15],
    zoom: 9,
    color: '#F44336',
    estimatedSizeMB: 55,
  },
  {
    id: 'lower-cook-inlet',
    name: 'Lower Cook Inlet',
    description: 'Kenai, Nikiski, Drift River, and lower Cook Inlet waters',
    bounds: [-153.5, 59.0, -150.5, 60.8],
    center: [-152.0, 59.9],
    zoom: 8,
    color: '#795548',
    estimatedSizeMB: 95,
  },
  {
    id: 'juneau-southeast',
    name: 'Juneau & Northern Southeast',
    description: 'Juneau, Auke Bay, Lynn Canal, and Glacier Bay approaches',
    bounds: [-136.5, 58.0, -133.5, 59.5],
    center: [-135.0, 58.75],
    zoom: 8,
    color: '#00BCD4',
    estimatedSizeMB: 110,
  },
  {
    id: 'ketchikan',
    name: 'Ketchikan & Southern Southeast',
    description: 'Ketchikan, Revillagigedo Channel, and Dixon Entrance',
    bounds: [-132.5, 54.5, -130.5, 56.0],
    center: [-131.5, 55.25],
    zoom: 9,
    color: '#E91E63',
    estimatedSizeMB: 75,
  },
  {
    id: 'sitka',
    name: 'Sitka & Baranof Island',
    description: 'Sitka Sound, Baranof Island, and surrounding waters',
    bounds: [-136.5, 56.5, -134.5, 57.5],
    center: [-135.5, 57.0],
    zoom: 9,
    color: '#673AB7',
    estimatedSizeMB: 65,
  },
  {
    id: 'petersburg-wrangell',
    name: 'Petersburg & Wrangell',
    description: 'Petersburg, Wrangell, Wrangell Narrows, and Stikine River',
    bounds: [-134.0, 56.0, -132.0, 57.2],
    center: [-133.0, 56.6],
    zoom: 9,
    color: '#009688',
    estimatedSizeMB: 50,
  },
  {
    id: 'dutch-harbor',
    name: 'Dutch Harbor & Aleutians East',
    description: 'Dutch Harbor, Unalaska, and eastern Aleutian Islands',
    bounds: [-168.0, 53.0, -165.0, 54.5],
    center: [-166.5, 53.75],
    zoom: 8,
    color: '#607D8B',
    estimatedSizeMB: 60,
  },
  {
    id: 'bristol-bay',
    name: 'Bristol Bay',
    description: 'Dillingham, Naknek, and Bristol Bay fishing grounds',
    bounds: [-160.0, 57.5, -156.0, 59.5],
    center: [-158.0, 58.5],
    zoom: 8,
    color: '#8BC34A',
    estimatedSizeMB: 70,
  },
];

/**
 * Check if a chart's bounds intersect with a pack's bounds
 */
export function chartIntersectsPack(
  chartBounds: [number, number, number, number] | null,
  packBounds: [number, number, number, number]
): boolean {
  if (!chartBounds) return false;
  
  const [chartWest, chartSouth, chartEast, chartNorth] = chartBounds;
  const [packWest, packSouth, packEast, packNorth] = packBounds;
  
  // Check if bounds intersect
  return !(
    chartEast < packWest ||
    chartWest > packEast ||
    chartNorth < packSouth ||
    chartSouth > packNorth
  );
}

/**
 * Get pack by ID
 */
export function getPackById(packId: string): ChartPackRegion | undefined {
  return CHART_PACKS.find(p => p.id === packId);
}

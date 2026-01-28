/**
 * Chart Hierarchy Utilities
 * Builds a tree structure from chart metadata based on geographic containment
 * 
 * Performance optimizations:
 * - Grid-based spatial index for O(1) average parent lookups instead of O(n)
 * - Cached chart level extraction
 */

import { ChartMetadata } from '../types/chart';

export interface ChartNode {
  chart: ChartMetadata;
  children: ChartNode[];
  level: number; // 1-5 based on chart ID prefix (US1, US2, etc.)
  totalDescendants: number; // Total charts in this subtree
  totalSizeBytes: number; // Total size including all descendants
}

// Cache for chart level extraction to avoid repeated regex
const levelCache: Map<string, number> = new Map();

/**
 * Simple grid-based spatial index for faster parent lookups
 * Divides the world into grid cells and tracks which charts are in each cell
 */
interface SpatialIndex {
  cellSize: number;
  cells: Map<string, ChartMetadata[]>;
}

function createSpatialIndex(charts: ChartMetadata[], cellSize: number = 5): SpatialIndex {
  const cells: Map<string, ChartMetadata[]> = new Map();
  
  for (const chart of charts) {
    if (!chart.bounds) continue;
    
    const [west, south, east, north] = chart.bounds;
    
    // Get all cells this chart overlaps
    const minCellX = Math.floor(west / cellSize);
    const maxCellX = Math.floor(east / cellSize);
    const minCellY = Math.floor(south / cellSize);
    const maxCellY = Math.floor(north / cellSize);
    
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const key = `${cx},${cy}`;
        if (!cells.has(key)) {
          cells.set(key, []);
        }
        cells.get(key)!.push(chart);
      }
    }
  }
  
  return { cellSize, cells };
}

function querySpatialIndex(index: SpatialIndex, bounds: [number, number, number, number]): ChartMetadata[] {
  const [west, south, east, north] = bounds;
  const { cellSize, cells } = index;
  
  // Get center cell
  const centerX = (west + east) / 2;
  const centerY = (south + north) / 2;
  const cellX = Math.floor(centerX / cellSize);
  const cellY = Math.floor(centerY / cellSize);
  
  const key = `${cellX},${cellY}`;
  return cells.get(key) || [];
}

/**
 * Extract the scale level from a chart ID (US1 = 1, US2 = 2, etc.)
 * Uses caching to avoid repeated regex operations
 */
export function getChartLevel(chartId: string): number {
  // Check cache first
  const cached = levelCache.get(chartId);
  if (cached !== undefined) {
    return cached;
  }
  
  const match = chartId.match(/^US(\d)/);
  const level = match ? parseInt(match[1], 10) : 5;
  
  // Cache the result
  levelCache.set(chartId, level);
  return level;
}

/**
 * Check if bounds A contains bounds B (B's center is inside A)
 */
export function boundsContain(
  outer: [number, number, number, number] | null,
  inner: [number, number, number, number] | null
): boolean {
  if (!outer || !inner) return false;
  
  const [outerWest, outerSouth, outerEast, outerNorth] = outer;
  const [innerWest, innerSouth, innerEast, innerNorth] = inner;
  
  // Check if inner is mostly within outer (allow some overlap)
  const innerCenterLon = (innerWest + innerEast) / 2;
  const innerCenterLat = (innerSouth + innerNorth) / 2;
  
  return (
    innerCenterLon >= outerWest &&
    innerCenterLon <= outerEast &&
    innerCenterLat >= outerSouth &&
    innerCenterLat <= outerNorth
  );
}

/**
 * Check if two bounds overlap significantly
 */
function boundsOverlap(
  a: [number, number, number, number] | null,
  b: [number, number, number, number] | null,
  threshold: number = 0.3
): boolean {
  if (!a || !b) return false;
  
  const [aWest, aSouth, aEast, aNorth] = a;
  const [bWest, bSouth, bEast, bNorth] = b;
  
  // Calculate intersection
  const intWest = Math.max(aWest, bWest);
  const intSouth = Math.max(aSouth, bSouth);
  const intEast = Math.min(aEast, bEast);
  const intNorth = Math.min(aNorth, bNorth);
  
  if (intWest >= intEast || intSouth >= intNorth) {
    return false; // No intersection
  }
  
  const intArea = (intEast - intWest) * (intNorth - intSouth);
  const bArea = (bEast - bWest) * (bNorth - bSouth);
  
  // Check if intersection is significant portion of b
  return intArea / bArea >= threshold;
}

/**
 * Build a hierarchical tree from flat chart list
 * Optimized with spatial indexing for O(1) average parent lookups instead of O(n)
 */
export function buildChartHierarchy(charts: ChartMetadata[]): ChartNode[] {
  // Group charts by level
  const byLevel: Map<number, ChartMetadata[]> = new Map();
  
  for (const chart of charts) {
    const level = getChartLevel(chart.chartId);
    if (!byLevel.has(level)) {
      byLevel.set(level, []);
    }
    byLevel.get(level)!.push(chart);
  }
  
  // Get sorted levels (1, 2, 3, 4, 5)
  const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);
  
  if (levels.length === 0) {
    return [];
  }
  
  // Create nodes for each chart
  const nodeMap: Map<string, ChartNode> = new Map();
  
  for (const chart of charts) {
    nodeMap.set(chart.chartId, {
      chart,
      children: [],
      level: getChartLevel(chart.chartId),
      totalDescendants: 0,
      totalSizeBytes: chart.fileSizeBytes || 0,
    });
  }
  
  // Pre-calculate parent areas for score calculation
  const parentAreas: Map<string, number> = new Map();
  for (const chart of charts) {
    if (chart.bounds) {
      const [w, s, e, n] = chart.bounds;
      parentAreas.set(chart.chartId, (e - w) * (n - s));
    }
  }
  
  // Build parent-child relationships using spatial index
  // For each level (starting from most detailed), find parent at next level up
  for (let i = levels.length - 1; i > 0; i--) {
    const childLevel = levels[i];
    const parentLevel = levels[i - 1];
    
    const children = byLevel.get(childLevel) || [];
    const parents = byLevel.get(parentLevel) || [];
    
    // Create spatial index for parent level for O(1) average lookups
    const parentIndex = createSpatialIndex(parents);
    
    for (const child of children) {
      if (!child.bounds) continue;
      
      const childNode = nodeMap.get(child.chartId)!;
      
      // Query spatial index for candidate parents (O(1) average)
      const candidates = querySpatialIndex(parentIndex, child.bounds);
      
      // Find best parent among candidates
      let bestParent: ChartNode | null = null;
      let bestScore = 0;
      
      for (const parent of candidates) {
        if (boundsContain(parent.bounds, child.bounds) || 
            boundsOverlap(parent.bounds, child.bounds, 0.5)) {
          const parentNode = nodeMap.get(parent.chartId)!;
          
          // Use pre-calculated area for score
          const parentArea = parentAreas.get(parent.chartId);
          if (parentArea) {
            // Prefer smaller parents (more specific)
            const score = 1 / parentArea;
            
            if (score > bestScore) {
              bestScore = score;
              bestParent = parentNode;
            }
          } else if (!bestParent) {
            bestParent = parentNode;
          }
        }
      }
      
      if (bestParent) {
        bestParent.children.push(childNode);
      }
    }
  }
  
  // Calculate totals (bottom-up)
  function calculateTotals(node: ChartNode): { count: number; size: number } {
    let count = 1; // This chart
    let size = node.chart.fileSizeBytes || 0;
    
    for (const child of node.children) {
      const childTotals = calculateTotals(child);
      count += childTotals.count;
      size += childTotals.size;
    }
    
    node.totalDescendants = count - 1; // Exclude self
    node.totalSizeBytes = size;
    
    return { count, size };
  }
  
  // Get root nodes (level 1, or lowest level that exists)
  const rootLevel = levels[0];
  const roots = (byLevel.get(rootLevel) || [])
    .map(chart => nodeMap.get(chart.chartId)!)
    .filter(node => node !== undefined);
  
  // Calculate totals for all trees
  for (const root of roots) {
    calculateTotals(root);
  }
  
  // Sort roots by name
  roots.sort((a, b) => a.chart.chartId.localeCompare(b.chart.chartId));
  
  // Sort children at each level
  function sortChildren(node: ChartNode) {
    node.children.sort((a, b) => a.chart.chartId.localeCompare(b.chart.chartId));
    node.children.forEach(sortChildren);
  }
  roots.forEach(sortChildren);
  
  return roots;
}

/**
 * Get all chart IDs in a subtree (including the root)
 */
export function getAllChartIds(node: ChartNode): string[] {
  const ids: string[] = [node.chart.chartId];
  
  for (const child of node.children) {
    ids.push(...getAllChartIds(child));
  }
  
  return ids;
}

/**
 * Get all ancestor chart IDs by walking UP the hierarchy
 * Uses spatial indexing for O(1) average lookups instead of O(n)
 */
export function getAncestorChartIds(
  chartId: string,
  allCharts: ChartMetadata[]
): string[] {
  const ancestors: string[] = [];
  const chart = allCharts.find(c => c.chartId === chartId);
  if (!chart || !chart.bounds) return ancestors;

  let currentLevel = getChartLevel(chartId);
  let currentBounds = chart.bounds;

  // Group charts by level once
  const byLevel: Map<number, ChartMetadata[]> = new Map();
  for (const c of allCharts) {
    const level = getChartLevel(c.chartId);
    if (!byLevel.has(level)) {
      byLevel.set(level, []);
    }
    byLevel.get(level)!.push(c);
  }

  // Walk UP the levels: 5 → 4 → 3 → 2 → 1
  while (currentLevel > 1) {
    const parentLevel = currentLevel - 1;
    
    // Get charts at parent level
    const parentCharts = byLevel.get(parentLevel) || [];
    
    // Create spatial index for this level
    const parentIndex = createSpatialIndex(parentCharts);
    
    // Query for candidates using spatial index (O(1) average)
    const candidates = querySpatialIndex(parentIndex, currentBounds);
    
    // Find best parent among candidates
    let bestParent: ChartMetadata | null = null;
    let bestScore = 0;
    
    for (const candidate of candidates) {
      if (boundsContain(candidate.bounds, currentBounds)) {
        // Prefer smaller (more specific) parents
        const [w, s, e, n] = candidate.bounds!;
        const area = (e - w) * (n - s);
        const score = 1 / area;
        
        if (score > bestScore) {
          bestScore = score;
          bestParent = candidate;
        }
      }
    }
    
    if (bestParent) {
      ancestors.push(bestParent.chartId);
      currentBounds = bestParent.bounds!;
    }
    
    currentLevel--;
  }

  return ancestors;
}

/**
 * Find a node by chart ID in the tree
 */
export function findNode(roots: ChartNode[], chartId: string): ChartNode | null {
  for (const root of roots) {
    if (root.chart.chartId === chartId) {
      return root;
    }
    
    const found = findNodeInTree(root, chartId);
    if (found) {
      return found;
    }
  }
  
  return null;
}

function findNodeInTree(node: ChartNode, chartId: string): ChartNode | null {
  if (node.chart.chartId === chartId) {
    return node;
  }
  
  for (const child of node.children) {
    const found = findNodeInTree(child, chartId);
    if (found) {
      return found;
    }
  }
  
  return null;
}

/**
 * Get level name for display
 */
export function getLevelName(level: number): string {
  switch (level) {
    case 1: return 'Overview';
    case 2: return 'General';
    case 3: return 'Coastal';
    case 4: return 'Approach';
    case 5: return 'Harbor';
    default: return `Level ${level}`;
  }
}

/**
 * Get scale description
 */
export function getScaleDescription(level: number): string {
  switch (level) {
    case 1: return 'Largest coverage, least detail';
    case 2: return 'Regional overview';
    case 3: return 'Coastal navigation';
    case 4: return 'Harbor approaches';
    case 5: return 'Most detail, smallest area';
    default: return '';
  }
}

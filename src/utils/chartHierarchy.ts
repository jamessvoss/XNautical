/**
 * Chart Hierarchy Utilities
 * Builds a tree structure from chart metadata based on geographic containment
 */

import { ChartMetadata } from '../types/chart';

export interface ChartNode {
  chart: ChartMetadata;
  children: ChartNode[];
  level: number; // 1-5 based on chart ID prefix (US1, US2, etc.)
  totalDescendants: number; // Total charts in this subtree
  totalSizeBytes: number; // Total size including all descendants
}

/**
 * Extract the scale level from a chart ID (US1 = 1, US2 = 2, etc.)
 */
export function getChartLevel(chartId: string): number {
  const match = chartId.match(/^US(\d)/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return 5; // Default to most detailed
}

/**
 * Check if bounds A contains bounds B (B is inside A)
 */
function boundsContain(
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
  
  // Build parent-child relationships
  // For each level (starting from most detailed), find parent at next level up
  for (let i = levels.length - 1; i > 0; i--) {
    const childLevel = levels[i];
    const parentLevel = levels[i - 1];
    
    const children = byLevel.get(childLevel) || [];
    const parents = byLevel.get(parentLevel) || [];
    
    for (const child of children) {
      const childNode = nodeMap.get(child.chartId)!;
      
      // Find best parent (most specific one that contains this chart)
      let bestParent: ChartNode | null = null;
      let bestOverlap = 0;
      
      for (const parent of parents) {
        if (boundsContain(parent.bounds, child.bounds) || 
            boundsOverlap(parent.bounds, child.bounds, 0.5)) {
          const parentNode = nodeMap.get(parent.chartId)!;
          
          // Calculate overlap score
          if (parent.bounds && child.bounds) {
            const [pW, pS, pE, pN] = parent.bounds;
            const parentArea = (pE - pW) * (pN - pS);
            // Prefer smaller parents (more specific)
            const score = 1 / parentArea;
            
            if (score > bestOverlap) {
              bestOverlap = score;
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

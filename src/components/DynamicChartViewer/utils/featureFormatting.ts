/**
 * Feature formatting utilities for the chart viewer inspector panel.
 * Extracts feature property formatting from the monolith.
 */

import {
  formatLightInfo,
  formatBuoyInfo,
  formatBeaconInfo,
  formatLandmarkInfo,
  formatSeabedInfo,
  formatCableInfo,
} from '../../../utils/chartRendering';
import type { FeatureInfo } from '../types';

// Helper to get feature identifier for title
export function getFeatureId(feature: FeatureInfo): string {
  const props = feature.properties;
  // Try LNAM first (lights), then OBJNAM (buoys, beacons)
  const lnam = props.LNAM as string | undefined;
  const objnam = props.OBJNAM as string | undefined;

  if (lnam) return `ID(LNAM): ${lnam}`;
  if (objnam) return `Name: ${objnam}`;
  return '';
}

// Helper to format properties based on feature type
export function formatFeatureProperties(feature: FeatureInfo, depthUnit: 'meters' | 'feet' | 'fathoms' = 'meters'): Record<string, string> {
  // Depth unit conversion helpers
  const convertDepthValue = (meters: number): string => {
    switch (depthUnit) {
      case 'feet': return `${(meters * 3.28084).toFixed(1)}ft`;
      case 'fathoms': return `${(meters * 0.546807).toFixed(1)}fm`;
      default: return `${meters}m`;
    }
  };
  const props = feature.properties;
  const formatted: Record<string, string> = {};

  // Show feature's actual coordinates (from tile geometry) for precision verification
  if (props._featureCoordinates) {
    formatted['Feature Position'] = String(props._featureCoordinates);
  }
  // Also show tap location for reference
  if (props._tapCoordinates) {
    formatted['Tap Location'] = String(props._tapCoordinates);
  }

  // Add object name if available
  if (props.OBJNAM) {
    formatted['Name'] = String(props.OBJNAM);
  }

  switch (feature.type) {
    case 'Light':
    case 'Light Sector':
      return { ...formatted, ...formatLightInfo(props) };

    case 'Lateral Buoy':
    case 'Cardinal Buoy':
    case 'Safe Water Buoy':
    case 'Special Purpose Buoy':
    case 'Isolated Danger Buoy':
      return { ...formatted, ...formatBuoyInfo(props) };

    case 'Lateral Beacon':
    case 'Special Purpose Beacon':
    case 'Cardinal Beacon':
    case 'Isolated Danger Beacon':
    case 'Safe Water Beacon':
      return { ...formatted, ...formatBeaconInfo(props) };

    case 'Landmark':
      return { ...formatted, ...formatLandmarkInfo(props) };

    case 'Seabed Area':
      return { ...formatted, ...formatSeabedInfo(props) };

    case 'Cable Area':
    case 'Submarine Cable':
      return { ...formatted, ...formatCableInfo(props) };

    case 'Wreck':
      return { ...formatted, ...formatWreckInfo(props) };

    case 'Underwater Rock':
      return { ...formatted, ...formatRockInfo(props) };

    case 'Obstruction':
      return { ...formatted, ...formatObstructionInfo(props) };

    case 'Sounding':
      if (props.DEPTH !== undefined) {
        formatted['Depth'] = convertDepthValue(Number(props.DEPTH));
      }
      return formatted;

    case 'Depth Area':
      if (props.DRVAL1 !== undefined) {
        formatted['Shallow depth'] = convertDepthValue(Number(props.DRVAL1));
      }
      if (props.DRVAL2 !== undefined) {
        formatted['Deep depth'] = convertDepthValue(Number(props.DRVAL2));
      }
      return formatted;

    case 'Depth Contour':
      if (props.VALDCO !== undefined) {
        formatted['Depth'] = convertDepthValue(Number(props.VALDCO));
      }
      return formatted;

    case 'Pipeline':
    case 'Pipeline Area':
      return { ...formatted, ...formatPipelineInfo(props) };

    case 'Dredged Area':
      if (props.DRVAL1 !== undefined) {
        formatted['Maintained depth'] = `${props.DRVAL1}m`;
      }
      return formatted;

    case 'Restricted Area':
      return { ...formatted, ...formatRestrictedAreaInfo(props) };

    case 'Caution Area':
      return { ...formatted, ...formatCautionAreaInfo(props) };

    case 'Military Practice Area':
      return { ...formatted, ...formatMilitaryAreaInfo(props) };

    case 'Anchorage Area':
    case 'Anchor Berth':
      return { ...formatted, ...formatAnchorageInfo(props) };

    case 'Marine Farm/Aquaculture':
      return { ...formatted, ...formatMarineFarmInfo(props) };

    default:
      // Show raw properties for other types
      for (const [key, value] of Object.entries(props)) {
        if (key.startsWith('_')) continue; // Skip internal props
        if (key === 'OBJNAM') continue; // Already added above
        formatted[key] = String(value);
      }
      return formatted;
  }
}

// Format wreck info
export function formatWreckInfo(props: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};

  // CATWRK - Category of wreck
  const catwrk = props.CATWRK as number | undefined;
  if (catwrk !== undefined) {
    const categories: Record<number, string> = {
      1: 'Non-dangerous',
      2: 'Dangerous',
      3: 'Distributed remains',
      4: 'Mast showing',
      5: 'Hull showing',
    };
    result['Category'] = categories[catwrk] || `Code ${catwrk}`;
  }

  // WATLEV - Water level effect
  const watlev = props.WATLEV as number | undefined;
  if (watlev !== undefined) {
    const levels: Record<number, string> = {
      1: 'Partly submerged',
      2: 'Always dry',
      3: 'Always underwater',
      4: 'Covers and uncovers',
      5: 'Awash',
    };
    result['Water level'] = levels[watlev] || `Code ${watlev}`;
  }

  // VALSOU - Depth over wreck
  if (props.VALSOU !== undefined) {
    result['Depth over'] = `${props.VALSOU}m`;
  }

  return result;
}

// Format rock info
export function formatRockInfo(props: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};

  // WATLEV - Water level effect
  const watlev = props.WATLEV as number | undefined;
  if (watlev !== undefined) {
    const levels: Record<number, string> = {
      3: 'Always underwater',
      4: 'Covers and uncovers',
      5: 'Awash',
    };
    result['Water level'] = levels[watlev] || `Code ${watlev}`;
  }

  // VALSOU - Depth
  if (props.VALSOU !== undefined) {
    result['Depth'] = `${props.VALSOU}m`;
  }

  return result;
}

// Format obstruction info
export function formatObstructionInfo(props: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};

  // CATOBS - Category of obstruction
  const catobs = props.CATOBS as number | undefined;
  if (catobs !== undefined) {
    const categories: Record<number, string> = {
      1: 'Snag/stump',
      2: 'Wellhead',
      3: 'Diffuser',
      4: 'Crib',
      5: 'Fish haven',
      6: 'Foul area',
      7: 'Foul ground',
      8: 'Ice boom',
      9: 'Ground tackle',
      10: 'Boom',
    };
    result['Category'] = categories[catobs] || `Code ${catobs}`;
  }

  // VALSOU - Depth
  if (props.VALSOU !== undefined) {
    result['Depth'] = `${props.VALSOU}m`;
  }

  return result;
}

// Format pipeline info
export function formatPipelineInfo(props: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};

  // CATPIP - Category of pipeline
  const catpip = props.CATPIP as number | undefined;
  if (catpip !== undefined) {
    const categories: Record<number, string> = {
      1: 'Oil pipeline',
      2: 'Gas pipeline',
      3: 'Water pipeline',
      4: 'Sewage pipeline',
      5: 'Bubbler system',
      6: 'Supply pipeline',
    };
    result['Type'] = categories[catpip] || `Code ${catpip}`;
  }

  // BURDEP - Buried depth
  if (props.BURDEP !== undefined) {
    result['Buried depth'] = `${props.BURDEP}m`;
  }

  return result;
}

// Format restricted area info
export function formatRestrictedAreaInfo(props: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};

  // CATREA - Category of restricted area
  const catrea = props.CATREA as number | undefined;
  if (catrea !== undefined) {
    const categories: Record<number, string> = {
      1: 'Offshore safety zone',
      4: 'Nature reserve',
      5: 'Bird sanctuary',
      6: 'Game reserve',
      7: 'Seal sanctuary',
      8: 'Degaussing range',
      9: 'Military area',
      12: 'Historic wreck area',
      14: 'Research area',
      17: 'Explosives dumping',
      18: 'Spoil ground',
      19: 'No anchoring',
      20: 'No diving',
      21: 'No fishing',
      22: 'No trawling',
      23: 'No wake zone',
      24: 'Swinging area',
      25: 'Water skiing area',
      26: 'Environmentally sensitive',
      27: 'To be avoided',
    };
    result['Category'] = categories[catrea] || `Code ${catrea}`;
  }

  // RESTRN - Restrictions
  const restrn = props.RESTRN;
  if (restrn) {
    const restrictions: Record<number, string> = {
      1: 'Anchoring prohibited',
      2: 'Anchoring restricted',
      3: 'Fishing prohibited',
      4: 'Fishing restricted',
      5: 'Trawling prohibited',
      6: 'Trawling restricted',
      7: 'Entry prohibited',
      8: 'Entry restricted',
      9: 'Dredging prohibited',
      10: 'Dredging restricted',
      11: 'Diving prohibited',
      12: 'Diving restricted',
      13: 'No wake',
      14: 'To be avoided',
    };
    const codes = Array.isArray(restrn) ? restrn : [restrn];
    const names = codes.map((c: number) => restrictions[c] || `Code ${c}`);
    result['Restrictions'] = names.join(', ');
  }

  // INFORM - Information
  if (props.INFORM) {
    result['Info'] = String(props.INFORM);
  }

  return result;
}

// Format caution area info
export function formatCautionAreaInfo(props: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};

  // INFORM - Information about the caution
  if (props.INFORM) {
    result['Info'] = String(props.INFORM);
  }

  // TXTDSC - Text description
  if (props.TXTDSC) {
    result['Description'] = String(props.TXTDSC);
  }

  return result;
}

// Format military practice area info
export function formatMilitaryAreaInfo(props: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};

  // CATMPA - Category of military practice area
  const catmpa = props.CATMPA as number | undefined;
  if (catmpa !== undefined) {
    const categories: Record<number, string> = {
      1: 'Torpedo exercise area',
      2: 'Submarine exercise area',
      3: 'Firing danger area',
      4: 'Mine-laying practice area',
      5: 'Small arms firing range',
    };
    result['Category'] = categories[catmpa] || `Code ${catmpa}`;
  }

  // INFORM - Information
  if (props.INFORM) {
    result['Info'] = String(props.INFORM);
  }

  return result;
}

// Format anchorage info
export function formatAnchorageInfo(props: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};

  // CATACH - Category of anchorage
  const catach = props.CATACH as number | undefined;
  if (catach !== undefined) {
    const categories: Record<number, string> = {
      1: 'Unrestricted anchorage',
      2: 'Deep water anchorage',
      3: 'Tanker anchorage',
      4: 'Explosives anchorage',
      5: 'Quarantine anchorage',
      6: 'Sea-plane anchorage',
      7: 'Small craft anchorage',
      8: '24-hour anchorage',
      9: 'Limited period anchorage',
    };
    result['Category'] = categories[catach] || `Code ${catach}`;
  }

  // PEREND/PERSTA - Period of validity
  if (props.PEREND || props.PERSTA) {
    const start = props.PERSTA ? String(props.PERSTA) : '';
    const end = props.PEREND ? String(props.PEREND) : '';
    if (start || end) {
      result['Period'] = `${start} - ${end}`.trim();
    }
  }

  // INFORM - Information
  if (props.INFORM) {
    result['Info'] = String(props.INFORM);
  }

  return result;
}

// Format marine farm/aquaculture info
export function formatMarineFarmInfo(props: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};

  // CATMFA - Category of marine farm/culture
  const catmfa = props.CATMFA as number | undefined;
  if (catmfa !== undefined) {
    const categories: Record<number, string> = {
      1: 'Crustaceans',
      2: 'Oysters/mussels',
      3: 'Fish',
      4: 'Seaweed',
      5: 'Pearl culture',
    };
    result['Type'] = categories[catmfa] || `Code ${catmfa}`;
  }

  // INFORM - Information
  if (props.INFORM) {
    result['Info'] = String(props.INFORM);
  }

  return result;
}

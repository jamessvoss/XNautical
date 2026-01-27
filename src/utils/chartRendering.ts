/**
 * Shared chart rendering utilities, constants, and formatters
 * Used by both static and dynamic chart viewers
 */

/**
 * Safely parse an array value that might come as a string from MBTiles
 * MBTiles stores arrays as JSON strings like '["1", "2"]' or just '1'
 */
function safeParseArray(value: unknown): string[] {
  if (!value) return [];
  
  // Already an array
  if (Array.isArray(value)) {
    return value.map(v => String(v));
  }
  
  // String that looks like a JSON array
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map(v => String(v));
        }
      } catch {
        // Not valid JSON, treat as single value
      }
    }
    // Single value string
    return [trimmed];
  }
  
  // Number or other primitive
  return [String(value)];
}

// S-57 Color codes
export const LIGHT_COLOURS: Record<string, string> = {
  '1': 'White', '2': 'Black', '3': 'Red', '4': 'Green', '5': 'Blue',
  '6': 'Yellow', '7': 'Grey', '8': 'Brown', '9': 'Amber', '10': 'Violet',
  '11': 'Orange', '12': 'Magenta', '13': 'Pink',
};

// S-57 Light characteristic codes
export const LIGHT_CHARACTERISTICS: Record<string, string> = {
  '1': 'Fixed (F)', '2': 'Flashing (Fl)', '3': 'Long-flashing (LFl)',
  '4': 'Quick (Q)', '5': 'Very quick (VQ)', '6': 'Ultra quick (UQ)',
  '7': 'Isophase (Iso)', '8': 'Occulting (Oc)', '9': 'Interrupted quick (IQ)',
  '10': 'Interrupted very quick (IVQ)', '11': 'Interrupted ultra quick (IUQ)',
  '12': 'Morse code (Mo)', '13': 'Fixed/flashing (FFl)',
  '14': 'Flash/long-flash (FlLFl)', '15': 'Occulting/flash (OcFl)',
  '16': 'Fixed/long-flash (FLFl)', '17': 'Occulting/long-flash (OcLFl)',
  '25': 'Quick + Long-flash (Q+LFl)', '26': 'Very quick + Long-flash (VQ+LFl)',
};

// S-57 Category of light codes
export const LIGHT_CATEGORIES: Record<string, string> = {
  '1': 'Directional', '2': 'Upper range light', '3': 'Lower range light',
  '4': 'Leading light', '5': 'Aero light', '6': 'Air obstruction',
  '7': 'Fog detector', '8': 'Flood light', '9': 'Strip light',
  '10': 'Subsidiary', '11': 'Spotlight', '12': 'Front range',
  '13': 'Rear range', '14': 'Lower light', '15': 'Upper light',
  '16': 'Moire effect', '17': 'Emergency', '18': 'Bearing light',
  '19': 'Horizontally disposed', '20': 'Vertically disposed',
};

// S-57 Exhibition condition codes
export const EXHIBITION_CONDITIONS: Record<string, string> = {
  '1': 'Light shown without change of character',
  '2': 'Day light', '3': 'Fog light', '4': 'Night light',
};

// S-57 Light status codes
export const LIGHT_STATUS: Record<string, string> = {
  '1': 'Permanent', '2': 'Occasional', '3': 'Recommended',
  '4': 'Not in use', '5': 'Periodic/Intermittent', '7': 'Temporary',
  '8': 'Private', '11': 'On request', '12': 'Reserved',
  '17': 'Extinguished', '18': 'Illuminated',
};

// Abbreviated characteristic codes for chart labels
const CHAR_ABBREVS: Record<string, string> = {
  '1': 'F', '2': 'Fl', '3': 'LFl', '4': 'Q', '5': 'VQ', '6': 'UQ',
  '7': 'Iso', '8': 'Oc', '9': 'IQ', '10': 'IVQ', '11': 'IUQ',
  '12': 'Mo', '13': 'FFl', '14': 'FlLFl', '15': 'OcFl',
  '16': 'FLFl', '17': 'OcLFl', '25': 'Q+LFl', '26': 'VQ+LFl',
};

// Abbreviated color codes for chart labels
const COLOR_ABBREVS: Record<string, string> = {
  '1': 'W', '2': 'Bl', '3': 'R', '4': 'G', '5': 'Bu',
  '6': 'Y', '7': 'Gr', '8': 'Br', '9': 'Am', '10': 'Vi', '11': 'Or',
};

// S-57 Buoy shape codes
export const BUOY_SHAPES: Record<string, string> = {
  '1': 'Conical (nun)', '2': 'Can (cylindrical)', '3': 'Spherical',
  '4': 'Pillar', '5': 'Spar', '6': 'Barrel', '7': 'Super-buoy', '8': 'Ice buoy',
};

// S-57 Beacon shape codes
export const BEACON_SHAPES: Record<string, string> = {
  '1': 'Stake/pole', '2': 'Withy', '3': 'Tower', '4': 'Lattice',
  '5': 'Pile', '6': 'Cairn', '7': 'Buoyant',
};

// S-57 Lateral category codes
export const LATERAL_CATEGORIES: Record<string, string> = {
  '1': 'Port hand (red)', '2': 'Starboard hand (green)',
  '3': 'Preferred channel to starboard', '4': 'Preferred channel to port',
};

// S-57 Landmark category codes
export const LANDMARK_CATEGORIES: Record<string, string> = {
  '1': 'Cairn', '2': 'Cemetery', '3': 'Chimney', '4': 'Dish aerial',
  '5': 'Flagstaff', '6': 'Flare stack', '7': 'Mast', '8': 'Windsock',
  '9': 'Monument', '10': 'Column/pillar', '11': 'Memorial plaque', '12': 'Obelisk',
  '13': 'Statue', '14': 'Cross', '15': 'Dome', '16': 'Radar scanner',
  '17': 'Tower', '18': 'Windmill', '19': 'Windmotor', '20': 'Spire/minaret',
};

// S-57 Landmark function codes
export const LANDMARK_FUNCTIONS: Record<string, string> = {
  '2': 'Harbour-Loss', '3': 'Custom', '4': 'Health', '7': 'Hospital',
  '9': 'Police', '20': 'Control', '21': 'Coastguard', '33': 'Light support',
  '35': 'Radio/TV', '45': 'Bus station', '46': 'Railway station',
};

// S-57 Seabed nature codes
export const SEABED_NATURE: Record<string, string> = {
  '1': 'Mud', '2': 'Clay', '3': 'Silt', '4': 'Sand', '5': 'Stone',
  '6': 'Gravel', '7': 'Pebbles', '8': 'Cobbles', '9': 'Rock', '10': 'Lava',
  '11': 'Coral', '12': 'Shell', '13': 'Boulder', '14': 'Chalk', '15': 'Ground',
  '17': 'Volcanic ash', '18': 'Weed', '19': 'Kelp',
};

// S-57 Water level effect codes
export const WATER_LEVEL_EFFECT: Record<string, string> = {
  '1': 'Partly submerged at high water', '2': 'Always dry',
  '3': 'Always submerged', '4': 'Covers and uncovers',
  '5': 'Awash', '6': 'Subject to flooding', '7': 'Floating',
};

// S-57 Obstruction categories
export const OBSTRUCTION_CATEGORIES: Record<string, string> = {
  '1': 'Snag/stump', '2': 'Wellhead', '3': 'Diffuser', '4': 'Crib',
  '5': 'Fish haven', '6': 'Foul area', '7': 'Foul ground', '8': 'Ice boom',
  '9': 'Ground tackle', '10': 'Boom',
};

// S-57 Shoreline construction categories
export const SLCONS_CATEGORIES: Record<string, string> = {
  '1': 'Breakwater', '2': 'Groyne', '3': 'Mole', '4': 'Pier', '5': 'Promenade pier',
  '6': 'Wharf', '7': 'Training wall', '8': 'Rip rap', '9': 'Revetment',
  '10': 'Seawall', '11': 'Landing stairs', '12': 'Ramp', '13': 'Slipway',
  '14': 'Fender', '15': 'Solid face wharf', '16': 'Open face wharf', '17': 'Log ramp',
};

// S-57 Restriction codes
export const RESTRICTION_CODES: Record<string, string> = {
  '1': 'Anchoring prohibited', '2': 'Anchoring restricted',
  '3': 'Fishing prohibited', '4': 'Fishing restricted',
  '5': 'Trawling prohibited', '6': 'Trawling restricted',
  '7': 'Entry prohibited', '8': 'Entry restricted',
  '9': 'Dredging prohibited', '10': 'Dredging restricted',
  '11': 'Diving prohibited', '12': 'Diving restricted',
  '13': 'No wake', '14': 'Area to be avoided',
};

// Depth colors based on S-52 standards
export const DEPTH_COLORS = {
  veryShallow: '#9ECAE1',  // 0-2m
  shallow: '#C6DBEF',       // 2-5m
  medium: '#DEEBF7',        // 5-10m
  deep: '#F7FBFF',          // 10-20m
  deeper: '#E8F4FC',        // 20-30m
  veryDeep: '#D4EAF7',      // 30-50m
  ultraDeep: '#C0DCF0',     // 50-100m
  abyssal: '#A8CDE8',       // 100m+
};

// Map colors from S-57 code to CSS color
export const SECTOR_COLOURS: Record<string, string> = {
  '1': '#FFFFFF', // White
  '2': '#000000', // Black
  '3': '#FF0000', // Red
  '4': '#00FF00', // Green
  '5': '#0000FF', // Blue
  '6': '#FFFF00', // Yellow
  '11': '#FFA500', // Orange
};

/**
 * Generate sector arc geometry for a light
 */
export function generateSectorLines(
  centerLon: number,
  centerLat: number,
  sectr1: number,
  sectr2: number,
  colour: string,
  radiusNm: number = 0.4
): GeoJSON.Feature<GeoJSON.MultiLineString> {
  const radiusDeg = radiusNm / 60;
  const latRadians = (centerLat * Math.PI) / 180;
  const lonScale = Math.cos(latRadians);
  
  const projectedSectr1 = (sectr1 + 180) % 360;
  const projectedSectr2 = (sectr2 + 180) % 360;
  
  const bearing1Rad = (projectedSectr1 * Math.PI) / 180;
  const bearing2Rad = (projectedSectr2 * Math.PI) / 180;
  
  const dx1 = Math.sin(bearing1Rad) * radiusDeg / lonScale;
  const dy1 = Math.cos(bearing1Rad) * radiusDeg;
  const endPoint1: [number, number] = [centerLon + dx1, centerLat + dy1];
  
  const dx2 = Math.sin(bearing2Rad) * radiusDeg / lonScale;
  const dy2 = Math.cos(bearing2Rad) * radiusDeg;
  const endPoint2: [number, number] = [centerLon + dx2, centerLat + dy2];
  
  const arcPoints: [number, number][] = [];
  let startBearing = projectedSectr1;
  let endBearing = projectedSectr2;
  
  if (endBearing <= startBearing) {
    endBearing += 360;
  }
  
  for (let bearing = startBearing; bearing <= endBearing; bearing += 3) {
    const normalizedBearing = bearing % 360;
    const bearingRad = (normalizedBearing * Math.PI) / 180;
    const dx = Math.sin(bearingRad) * radiusDeg / lonScale;
    const dy = Math.cos(bearingRad) * radiusDeg;
    arcPoints.push([centerLon + dx, centerLat + dy]);
  }
  
  return {
    type: 'Feature',
    properties: { colour, sectr1: projectedSectr1, sectr2: projectedSectr2 },
    geometry: {
      type: 'MultiLineString',
      coordinates: [
        [[centerLon, centerLat], endPoint1],
        [[centerLon, centerLat], endPoint2],
        arcPoints,
      ],
    },
  };
}

/**
 * Extract sector features from lights data
 */
export function extractSectorFeatures(lightsData: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const sectorFeatures: GeoJSON.Feature<GeoJSON.MultiLineString>[] = [];
  
  if (!lightsData?.features) return { type: 'FeatureCollection', features: [] };
  
  for (const feature of lightsData.features) {
    const props = feature.properties;
    if (!props) continue;
    
    const sectr1 = props.SECTR1 as number | undefined;
    const sectr2 = props.SECTR2 as number | undefined;
    
    if (sectr1 !== undefined && sectr2 !== undefined) {
      const coords = (feature.geometry as GeoJSON.Point).coordinates;
      const colours = safeParseArray(props.COLOUR);
      const colour = colours.length > 0 ? colours[0] : '1';
      const range = props.VALNMR as number | undefined;
      const radiusNm = range ? Math.min(range * 0.2, 0.6) : 0.35;
      
      sectorFeatures.push(generateSectorLines(coords[0], coords[1], sectr1, sectr2, colour, radiusNm));
    }
  }
  
  return { type: 'FeatureCollection', features: sectorFeatures };
}

/**
 * Get buoy icon name based on shape
 */
export function getBuoyIcon(boyshp: string | undefined): string {
  const icons: Record<string, string> = {
    '1': 'buoy-conical', '2': 'buoy-can', '3': 'buoy-spherical',
    '4': 'buoy-pillar', '5': 'buoy-spar', '6': 'buoy-barrel', '7': 'buoy-super',
  };
  return icons[boyshp || ''] || 'buoy-can';
}

/**
 * Get beacon icon name based on shape
 */
export function getBeaconIcon(bcnshp: string | undefined): string {
  const icons: Record<string, string> = {
    '1': 'beacon-stake', '2': 'beacon-withy', '3': 'beacon-tower',
    '4': 'beacon-lattice', '6': 'beacon-cairn',
  };
  return icons[bcnshp || ''] || 'beacon-generic';
}

/**
 * Get wreck icon based on category and water level
 */
export function getWreckIcon(catwrk: string | undefined, watlev: string | undefined): string {
  if (watlev === '4') return 'wreck-uncovers';
  if (watlev === '3') return 'wreck-submerged';
  if (catwrk === '1') return 'wreck-safe';
  return 'wreck-danger';
}

/**
 * Get rock icon based on water level
 */
export function getRockIcon(watlev: string | undefined): string {
  const icons: Record<string, string> = {
    '2': 'rock-above-water', '4': 'rock-uncovers',
    '5': 'rock-awash', '3': 'rock-submerged',
  };
  return icons[watlev || ''] || 'rock-submerged';
}

/**
 * Format light properties for display
 */
export function formatLightInfo(properties: Record<string, unknown>): Record<string, string> {
  const formatted: Record<string, string> = {};
  
  const litchr = properties.LITCHR as string | undefined;
  const siggrp = properties.SIGGRP as string | undefined;
  const sigper = properties.SIGPER as number | undefined;
  const height = properties.HEIGHT as number | undefined;
  const valnmr = properties.VALNMR as number | undefined;
  const colours = safeParseArray(properties.COLOUR);
  
  // Build chart-style label first (e.g., "Fl(1) W 4s 8m 5M")
  let chartLabel = '';
  if (litchr) {
    chartLabel = CHAR_ABBREVS[litchr] || '';
    if (siggrp) chartLabel += siggrp;
  }
  if (colours && colours.length > 0) {
    const colorAbbr = colours.map(c => COLOR_ABBREVS[c] || '').join('');
    if (colorAbbr) chartLabel += ` ${colorAbbr}`;
  }
  if (sigper) chartLabel += ` ${sigper}s`;
  if (height) chartLabel += ` ${height}m`;
  if (valnmr) chartLabel += ` ${valnmr}M`;
  
  if (chartLabel.trim()) {
    formatted['Chart Label'] = chartLabel.trim();
  }
  
  // Color (full name)
  if (colours && colours.length > 0) {
    const colorNames = colours.map(c => LIGHT_COLOURS[c] || c).join(', ');
    if (colours.length > 1) {
      formatted['Color'] = `${colorNames} (alternating)`;
    } else {
      formatted['Color'] = colorNames;
    }
  }
  
  // Characteristic (full name)
  if (litchr) {
    formatted['Characteristic'] = LIGHT_CHARACTERISTICS[litchr] || `Code ${litchr}`;
  }
  
  // Signal group
  if (siggrp) {
    formatted['Group'] = siggrp;
  }
  
  // Signal period
  if (sigper) {
    formatted['Period'] = `${sigper} seconds`;
  }
  
  // Signal sequence (detailed timing)
  const sigseq = properties.SIGSEQ as string | undefined;
  if (sigseq) {
    formatted['Sequence'] = sigseq;
  }
  
  // Height
  if (height) {
    formatted['Height'] = `${height}m above water`;
  }
  
  // Range (nominal range in nautical miles)
  if (valnmr) {
    formatted['Range'] = `${valnmr} nautical miles`;
  }
  
  // Sector angles
  const sectr1 = properties.SECTR1 as number | undefined;
  const sectr2 = properties.SECTR2 as number | undefined;
  if (sectr1 !== undefined && sectr2 !== undefined) {
    formatted['Sector'] = `${sectr1}° to ${sectr2}° (visible arc)`;
  }
  
  // Orientation
  const orient = properties.ORIENT as number | undefined;
  if (orient !== undefined) {
    formatted['Orientation'] = `${orient}° (direction of light)`;
  }
  
  // Category of light
  const catlit = safeParseArray(properties.CATLIT);
  if (catlit.length > 0) {
    const categories = catlit.map(c => LIGHT_CATEGORIES[c] || `Code ${c}`).join(', ');
    formatted['Category'] = categories;
  }
  
  // Exhibition condition
  const exclit = properties.EXCLIT as number | undefined;
  if (exclit) {
    formatted['Exhibition'] = EXHIBITION_CONDITIONS[String(exclit)] || `Code ${exclit}`;
  }
  
  // Status
  const status = safeParseArray(properties.STATUS);
  if (status.length > 0) {
    const statusNames = status.map(s => LIGHT_STATUS[s] || `Code ${s}`).join(', ');
    formatted['Status'] = statusNames;
  }
  
  // Note: LNAM is now shown in the inspector title, not in properties
  
  return formatted;
}

/**
 * Format buoy properties for display
 */
export function formatBuoyInfo(properties: Record<string, unknown>): Record<string, string> {
  const formatted: Record<string, string> = {};
  
  const objnam = properties.OBJNAM as string | undefined;
  if (objnam) formatted['Name'] = objnam;
  
  const boyshp = properties.BOYSHP as string | undefined;
  if (boyshp) formatted['Shape'] = BUOY_SHAPES[boyshp] || `Code ${boyshp}`;
  
  const catlam = properties.CATLAM as string | undefined;
  if (catlam) formatted['Category'] = LATERAL_CATEGORIES[catlam] || `Code ${catlam}`;
  
  const colours = safeParseArray(properties.COLOUR);
  if (colours.length > 0) {
    formatted['Color'] = colours.map(c => LIGHT_COLOURS[c] || c).join(', ');
  }
  
  return formatted;
}

/**
 * Format beacon properties for display
 */
export function formatBeaconInfo(properties: Record<string, unknown>): Record<string, string> {
  const formatted: Record<string, string> = {};
  
  const objnam = properties.OBJNAM as string | undefined;
  if (objnam) formatted['Name'] = objnam;
  
  const bcnshp = properties.BCNSHP as string | undefined;
  if (bcnshp) formatted['Shape'] = BEACON_SHAPES[bcnshp] || `Code ${bcnshp}`;
  
  return formatted;
}

/**
 * Format landmark properties for display
 */
export function formatLandmarkInfo(properties: Record<string, unknown>): Record<string, string> {
  const formatted: Record<string, string> = {};
  
  // Name
  const objnam = properties.OBJNAM as string | undefined;
  if (objnam) formatted['Name'] = objnam;
  
  // Category
  const catlmk = safeParseArray(properties.CATLMK);
  if (catlmk.length > 0) {
    const categories = catlmk.map(c => LANDMARK_CATEGORIES[c] || `Code ${c}`).join(', ');
    formatted['Category'] = categories;
  }
  
  // Function
  const functn = safeParseArray(properties.FUNCTN);
  if (functn.length > 0) {
    const functions = functn.map(f => LANDMARK_FUNCTIONS[f] || `Code ${f}`).join(', ');
    formatted['Function'] = functions;
  }
  
  // Conspicuous
  const convis = properties.CONVIS as number | undefined;
  if (convis === 1) {
    formatted['Visibility'] = 'Conspicuous';
  } else if (convis === 2) {
    formatted['Visibility'] = 'Not conspicuous';
  }
  
  // Color
  const lmkColours = safeParseArray(properties.COLOUR);
  if (lmkColours.length > 0) {
    const colorNames = lmkColours.map(c => LIGHT_COLOURS[c] || c).join(', ');
    formatted['Color'] = colorNames;
  }
  
  return formatted;
}

/**
 * Format depth area properties for display
 */
export function formatDepthInfo(properties: Record<string, unknown>): Record<string, string> {
  const formatted: Record<string, string> = {};
  
  const drval1 = properties.DRVAL1 as number | undefined;
  const drval2 = properties.DRVAL2 as number | undefined;
  
  if (drval1 !== undefined && drval2 !== undefined) {
    formatted['Depth Range'] = `${drval1}m to ${drval2}m`;
  } else if (drval1 !== undefined) {
    formatted['Min Depth'] = `${drval1}m`;
  }
  
  return formatted;
}

/**
 * Get depth color based on DRVAL values
 */
export function getDepthColor(drval1: number | undefined): string {
  const depth = drval1 ?? 0;
  if (depth < 2) return DEPTH_COLORS.veryShallow;
  if (depth < 5) return DEPTH_COLORS.shallow;
  if (depth < 10) return DEPTH_COLORS.medium;
  if (depth < 20) return DEPTH_COLORS.deep;
  if (depth < 30) return DEPTH_COLORS.deeper;
  if (depth < 50) return DEPTH_COLORS.veryDeep;
  if (depth < 100) return DEPTH_COLORS.ultraDeep;
  return DEPTH_COLORS.abyssal;
}

/**
 * Format seabed area properties for display
 */
export function formatSeabedInfo(properties: Record<string, unknown>): Record<string, string> {
  const formatted: Record<string, string> = {};
  
  // Nature of seabed
  const natsur = safeParseArray(properties.NATSUR);
  if (natsur.length > 0) {
    const nature = natsur.map(n => SEABED_NATURE[n] || `Code ${n}`).join(', ');
    formatted['Seabed Type'] = nature;
  }
  
  // Qualifying terms
  const natqua = safeParseArray(properties.NATQUA);
  if (natqua.length > 0) {
    const qualMap: Record<string, string> = {
      '1': 'Fine', '2': 'Medium', '3': 'Coarse', '4': 'Broken',
      '5': 'Sticky', '6': 'Soft', '7': 'Stiff', '8': 'Volcanic',
      '9': 'Calcareous', '10': 'Hard',
    };
    formatted['Quality'] = natqua.map(q => qualMap[q] || q).join(', ');
  }
  
  // Color
  const sbdColour = safeParseArray(properties.COLOUR);
  if (sbdColour.length > 0) {
    formatted['Color'] = sbdColour.map(c => LIGHT_COLOURS[c] || c).join(', ');
  }
  
  return formatted;
}

/**
 * Format cable area/submarine cable properties for display
 */
export function formatCableInfo(properties: Record<string, unknown>): Record<string, string> {
  const formatted: Record<string, string> = {};
  
  // Type
  formatted['Type'] = 'Submarine Cable';
  
  // Name
  const objnam = properties.OBJNAM as string | undefined;
  if (objnam) formatted['Name'] = objnam;
  
  // Category of cable
  const catcbl = properties.CATCBL as string | undefined;
  if (catcbl) {
    const categories: Record<string, string> = {
      '1': 'Power line',
      '2': 'Telephone/telegraph',
      '3': 'Transmission line',
      '4': 'Telephone',
      '5': 'Telegraph',
      '6': 'Mooring cable/chain',
    };
    formatted['Category'] = categories[catcbl] || `Code ${catcbl}`;
  }
  
  // Restrictions
  const restrn = safeParseArray(properties.RESTRN);
  if (restrn.length > 0) {
    const restrictions = restrn.map(r => RESTRICTION_CODES[r] || `Code ${r}`).join(', ');
    formatted['Restrictions'] = restrictions;
  }
  
  // Buried depth
  const burdep = properties.BURDEP as number | undefined;
  if (burdep !== undefined) {
    formatted['Buried Depth'] = `${burdep}m`;
  }
  
  // Vertical clearance
  const verclr = properties.VERCLR as number | undefined;
  if (verclr !== undefined) {
    formatted['Vertical Clearance'] = `${verclr}m`;
  }
  
  return formatted;
}

/**
 * Offline Chart Viewer using React Native Mapbox
 * Uses GeoJSON data stored locally for true offline operation
 */

import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Platform,
  ScrollView,
} from 'react-native';
import Mapbox, { MapView } from '@rnmapbox/maps';

// Import GeoJSON data directly (bundled with the app)
// Original Homer chart (US5AK5SI)
const depareData_SI = require('../../assets/Maps/depare.json');
const depcntData_SI = require('../../assets/Maps/depcnt.json');
const soundgData_SI = require('../../assets/Maps/soundg.json');
const lndareData_SI = require('../../assets/Maps/lndare.json');

// Additional charts
const depareData_PH = require('../../assets/Maps/US4AK4PH_depare.json');
const depcntData_PH = require('../../assets/Maps/US4AK4PH_depcnt.json');
const soundgData_PH = require('../../assets/Maps/US4AK4PH_soundg.json');
const lndareData_PH = require('../../assets/Maps/US4AK4PH_lndare.json');

const depareData_QG = require('../../assets/Maps/US5AK5QG_depare.json');
const depcntData_QG = require('../../assets/Maps/US5AK5QG_depcnt.json');
const soundgData_QG = require('../../assets/Maps/US5AK5QG_soundg.json');
const lndareData_QG = require('../../assets/Maps/US5AK5QG_lndare.json');

const depareData_SJ = require('../../assets/Maps/US5AK5SJ_depare.json');
const depcntData_SJ = require('../../assets/Maps/US5AK5SJ_depcnt.json');
const soundgData_SJ = require('../../assets/Maps/US5AK5SJ_soundg.json');
const lndareData_SJ = require('../../assets/Maps/US5AK5SJ_lndare.json');

// Lights data for each chart
const lightsData_PH = require('../../assets/Maps/US4AK4PH_lights.json');
const lightsData_SI = require('../../assets/Maps/US5AK5SI_lights.json');
const lightsData_QG = require('../../assets/Maps/US5AK5QG_lights.json');
const lightsData_SJ = require('../../assets/Maps/US5AK5SJ_lights.json');

// Buoys data for each chart
const buoysData_PH = require('../../assets/Maps/US4AK4PH_buoys.json');
const buoysData_SI = require('../../assets/Maps/US5AK5SI_buoys.json');
const buoysData_QG = require('../../assets/Maps/US5AK5QG_buoys.json');
const buoysData_SJ = require('../../assets/Maps/US5AK5SJ_buoys.json');

// Beacons data for each chart
const beaconsData_PH = require('../../assets/Maps/US4AK4PH_beacons.json');
const beaconsData_SI = require('../../assets/Maps/US5AK5SI_beacons.json');
const beaconsData_QG = require('../../assets/Maps/US5AK5QG_beacons.json');
const beaconsData_SJ = require('../../assets/Maps/US5AK5SJ_beacons.json');

// Landmarks data for each chart
const landmarksData_PH = require('../../assets/Maps/US4AK4PH_landmarks.json');
const landmarksData_SI = require('../../assets/Maps/US5AK5SI_landmarks.json');
const landmarksData_QG = require('../../assets/Maps/US5AK5QG_landmarks.json');
const landmarksData_SJ = require('../../assets/Maps/US5AK5SJ_landmarks.json');

// Wrecks data for each chart
const wrecksData_PH = require('../../assets/Maps/US4AK4PH_wrecks.json');
const wrecksData_SI = require('../../assets/Maps/US5AK5SI_wrecks.json');
const wrecksData_QG = require('../../assets/Maps/US5AK5QG_wrecks.json');
const wrecksData_SJ = require('../../assets/Maps/US5AK5SJ_wrecks.json');

// Rocks data for each chart
const rocksData_PH = require('../../assets/Maps/US4AK4PH_rocks.json');
const rocksData_SI = require('../../assets/Maps/US5AK5SI_rocks.json');
const rocksData_QG = require('../../assets/Maps/US5AK5QG_rocks.json');
const rocksData_SJ = require('../../assets/Maps/US5AK5SJ_rocks.json');

// Obstructions data for each chart
const obstructionsData_PH = require('../../assets/Maps/US4AK4PH_obstructions.json');
const obstructionsData_SI = require('../../assets/Maps/US5AK5SI_obstructions.json');
const obstructionsData_QG = require('../../assets/Maps/US5AK5QG_obstructions.json');
const obstructionsData_SJ = require('../../assets/Maps/US5AK5SJ_obstructions.json');

// Shoreline constructions (piers, jetties, breakwaters) for each chart
const slconsData_PH = require('../../assets/Maps/US4AK4PH_slcons.json');
const slconsData_SI = require('../../assets/Maps/US5AK5SI_slcons.json');
const slconsData_QG = require('../../assets/Maps/US5AK5QG_slcons.json');
const slconsData_SJ = require('../../assets/Maps/US5AK5SJ_slcons.json');

// Cable areas (submarine cables - anchoring restricted) for each chart
const cblareData_PH = require('../../assets/Maps/US4AK4PH_cblare.json');
const cblareData_SI = require('../../assets/Maps/US5AK5SI_cblare.json');
const cblareData_QG = require('../../assets/Maps/US5AK5QG_cblare.json');
const cblareData_SJ = require('../../assets/Maps/US5AK5SJ_cblare.json');

// Seabed areas (bottom type - mud, sand, rock, etc.) for each chart
const sbdareData_PH = require('../../assets/Maps/US4AK4PH_sbdare.json');
const sbdareData_SI = require('../../assets/Maps/US5AK5SI_sbdare.json');
const sbdareData_QG = require('../../assets/Maps/US5AK5QG_sbdare.json');
const sbdareData_SJ = require('../../assets/Maps/US5AK5SJ_sbdare.json');

// Sea areas (named bodies of water - bays, coves, straits) for each chart
const seaareData_PH = require('../../assets/Maps/US4AK4PH_seaare.json');
const seaareData_SI = require('../../assets/Maps/US5AK5SI_seaare.json');
const seaareData_QG = require('../../assets/Maps/US5AK5QG_seaare.json');
const seaareData_SJ = require('../../assets/Maps/US5AK5SJ_seaare.json');

// Pipelines (submarine/on land - outfalls, intake pipes) for each chart
const pipsolData_PH = require('../../assets/Maps/US4AK4PH_pipsol.json');
const pipsolData_SI = require('../../assets/Maps/US5AK5SI_pipsol.json');
const pipsolData_QG = require('../../assets/Maps/US5AK5QG_pipsol.json');
const pipsolData_SJ = require('../../assets/Maps/US5AK5SJ_pipsol.json');

// ============ NEW CHARTS: US4AK4PG (large area) and US5AK5QF (detailed) ============
// US4AK4PG - Large area chart
const depareData_PG = require('../../assets/Maps/US4AK4PG_depare.json');
const depcntData_PG = require('../../assets/Maps/US4AK4PG_depcnt.json');
const lndareData_PG = require('../../assets/Maps/US4AK4PG_lndare.json');
const lightsData_PG = require('../../assets/Maps/US4AK4PG_lights.json');
const buoysData_PG = require('../../assets/Maps/US4AK4PG_buoys.json');
const beaconsData_PG = require('../../assets/Maps/US4AK4PG_beacons.json');
const landmarksData_PG = require('../../assets/Maps/US4AK4PG_landmarks.json');
const wrecksData_PG = require('../../assets/Maps/US4AK4PG_wrecks.json');
const rocksData_PG = require('../../assets/Maps/US4AK4PG_rocks.json');
const obstructionsData_PG = require('../../assets/Maps/US4AK4PG_obstructions.json');
const slconsData_PG = require('../../assets/Maps/US4AK4PG_slcons.json');
const cblareData_PG = require('../../assets/Maps/US4AK4PG_cblare.json');
const sbdareData_PG = require('../../assets/Maps/US4AK4PG_sbdare.json');
const seaareData_PG = require('../../assets/Maps/US4AK4PG_seaare.json');
const pipsolData_PG = require('../../assets/Maps/US4AK4PG_pipsol.json');

// US5AK5QF - Detailed area chart
const depareData_QF = require('../../assets/Maps/US5AK5QF_depare.json');
const depcntData_QF = require('../../assets/Maps/US5AK5QF_depcnt.json');
const lndareData_QF = require('../../assets/Maps/US5AK5QF_lndare.json');
const lightsData_QF = require('../../assets/Maps/US5AK5QF_lights.json');
const buoysData_QF = require('../../assets/Maps/US5AK5QF_buoys.json');
const beaconsData_QF = require('../../assets/Maps/US5AK5QF_beacons.json');
const landmarksData_QF = require('../../assets/Maps/US5AK5QF_landmarks.json');
const wrecksData_QF = require('../../assets/Maps/US5AK5QF_wrecks.json');
const rocksData_QF = require('../../assets/Maps/US5AK5QF_rocks.json');
const obstructionsData_QF = require('../../assets/Maps/US5AK5QF_obstructions.json');
const slconsData_QF = require('../../assets/Maps/US5AK5QF_slcons.json');
const cblareData_QF = require('../../assets/Maps/US5AK5QF_cblare.json');
const sbdareData_QF = require('../../assets/Maps/US5AK5QF_sbdare.json');
const seaareData_QF = require('../../assets/Maps/US5AK5QF_seaare.json');
const pipsolData_QF = require('../../assets/Maps/US5AK5QF_pipsol.json');

// S-52 Symbol images for navigation features
// Metro automatically selects @2x/@3x based on device pixel density
const NAV_SYMBOLS = {
  // Light flares
  'light-flare-white': require('../../assets/symbols/png/light-flare-white.png'),
  'light-flare-red': require('../../assets/symbols/png/light-flare-red.png'),
  'light-flare-green': require('../../assets/symbols/png/light-flare-green.png'),
  'light-flare-magenta': require('../../assets/symbols/png/light-flare-magenta.png'),
  // Buoys (by shape)
  'buoy-conical': require('../../assets/symbols/png/buoy-conical.png'),
  'buoy-can': require('../../assets/symbols/png/buoy-can.png'),
  'buoy-spherical': require('../../assets/symbols/png/buoy-spherical.png'),
  'buoy-pillar': require('../../assets/symbols/png/buoy-pillar.png'),
  'buoy-spar': require('../../assets/symbols/png/buoy-spar.png'),
  'buoy-barrel': require('../../assets/symbols/png/buoy-barrel.png'),
  'buoy-super': require('../../assets/symbols/png/buoy-super.png'),
  // Beacons (by shape)
  'beacon-stake': require('../../assets/symbols/png/beacon-stake.png'),
  'beacon-withy': require('../../assets/symbols/png/beacon-withy.png'),
  'beacon-tower': require('../../assets/symbols/png/beacon-tower.png'),
  'beacon-lattice': require('../../assets/symbols/png/beacon-lattice.png'),
  'beacon-generic': require('../../assets/symbols/png/beacon-generic.png'),
  'beacon-cairn': require('../../assets/symbols/png/beacon-cairn.png'),
  // Landmarks (by category)
  'landmark-tower': require('../../assets/symbols/png/landmark-tower.png'),
  'landmark-chimney': require('../../assets/symbols/png/landmark-chimney.png'),
  'landmark-monument': require('../../assets/symbols/png/landmark-monument.png'),
  'landmark-flagpole': require('../../assets/symbols/png/landmark-flagpole.png'),
  'landmark-mast': require('../../assets/symbols/png/landmark-mast.png'),
  'landmark-radio-tower': require('../../assets/symbols/png/landmark-radio-tower.png'),
  'landmark-windmill': require('../../assets/symbols/png/landmark-windmill.png'),
  'landmark-church': require('../../assets/symbols/png/landmark-church.png'),
  // Wrecks (by CATWRK and WATLEV)
  'wreck-hull': require('../../assets/symbols/png/wreck-hull.png'),
  'wreck-submerged': require('../../assets/symbols/png/wreck-submerged.png'),
  'wreck-uncovers': require('../../assets/symbols/png/wreck-uncovers.png'),
  'wreck-safe': require('../../assets/symbols/png/wreck-safe.png'),
  'wreck-danger': require('../../assets/symbols/png/wreck-danger.png'),
  // Rocks (by WATLEV)
  'rock-uncovers': require('../../assets/symbols/png/rock-uncovers.png'),
  'rock-awash': require('../../assets/symbols/png/rock-awash.png'),
  'rock-submerged': require('../../assets/symbols/png/rock-submerged.png'),
  'rock-above-water': require('../../assets/symbols/png/rock-above-water.png'),
  // Obstructions
  'obstruction': require('../../assets/symbols/png/obstruction.png'),
  'foul-ground': require('../../assets/symbols/png/foul-ground.png'),
};

// Generate sector arc outline for a light with sector information
// S-57 SECTR1/SECTR2 are bearings "from seaward" (bearing TO the light as seen by vessel)
// To show where the light PROJECTS, we add 180° to get the direction FROM the light
// Returns a GeoJSON MultiLineString with boundary lines AND the curved arc
const generateSectorLines = (
  centerLon: number,
  centerLat: number,
  sectr1: number,
  sectr2: number,
  colour: string,
  radiusNm: number = 0.4  // Default radius in nautical miles for display
): GeoJSON.Feature<GeoJSON.MultiLineString> => {
  // Convert nautical miles to approximate degrees (1 NM ≈ 1/60 degree at equator)
  // Adjust for latitude
  const radiusDeg = radiusNm / 60;
  const latRadians = (centerLat * Math.PI) / 180;
  const lonScale = Math.cos(latRadians);
  
  // S-57 bearings are "from seaward" - add 180° to get light projection direction
  const projectedSectr1 = (sectr1 + 180) % 360;
  const projectedSectr2 = (sectr2 + 180) % 360;
  
  // Calculate end points for both sector boundary lines
  const bearing1Rad = (projectedSectr1 * Math.PI) / 180;
  const bearing2Rad = (projectedSectr2 * Math.PI) / 180;
  
  // Line 1: from center to sectr1 boundary
  const dx1 = Math.sin(bearing1Rad) * radiusDeg / lonScale;
  const dy1 = Math.cos(bearing1Rad) * radiusDeg;
  const endPoint1: [number, number] = [centerLon + dx1, centerLat + dy1];
  
  // Line 2: from center to sectr2 boundary
  const dx2 = Math.sin(bearing2Rad) * radiusDeg / lonScale;
  const dy2 = Math.cos(bearing2Rad) * radiusDeg;
  const endPoint2: [number, number] = [centerLon + dx2, centerLat + dy2];
  
  // Generate arc points for the VISIBLE sector (every 3 degrees for smoothness)
  // The visible sector goes FROM sectr1 CLOCKWISE around TO sectr2
  // The GAP (where light is obscured) is the short arc from sectr2 to sectr1
  const arcPoints: [number, number][] = [];
  
  // Go clockwise from sectr1 to sectr2 (the long way around)
  // Clockwise = increasing bearing
  let startBearing = projectedSectr1;
  let endBearing = projectedSectr2;
  
  // To go clockwise from start to end:
  // If end <= start, add 360 to end so we go the long way
  if (endBearing <= startBearing) {
    endBearing += 360;
  }
  
  // Generate arc points going clockwise (increasing bearing)
  for (let bearing = startBearing; bearing <= endBearing; bearing += 3) {
    const normalizedBearing = bearing % 360;
    const bearingRad = (normalizedBearing * Math.PI) / 180;
    const dx = Math.sin(bearingRad) * radiusDeg / lonScale;
    const dy = Math.cos(bearingRad) * radiusDeg;
    arcPoints.push([centerLon + dx, centerLat + dy]);
  }
  
  // Ensure we end at exactly the end bearing
  const finalBearingRad = ((endBearing % 360) * Math.PI) / 180;
  const dxFinal = Math.sin(finalBearingRad) * radiusDeg / lonScale;
  const dyFinal = Math.cos(finalBearingRad) * radiusDeg;
  arcPoints.push([centerLon + dxFinal, centerLat + dyFinal]);
  
  return {
    type: 'Feature',
    properties: {
      colour: colour,
      sectr1: projectedSectr1,
      sectr2: projectedSectr2,
    },
    geometry: {
      type: 'MultiLineString',
      coordinates: [
        // Line from center to first sector boundary
        [[centerLon, centerLat], endPoint1],
        // Line from center to second sector boundary  
        [[centerLon, centerLat], endPoint2],
        // Curved arc connecting the two boundaries
        arcPoints,
      ],
    },
  };
};

// Process lights data to extract sector line features
const extractSectorFeatures = (lightsData: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection => {
  const sectorFeatures: GeoJSON.Feature<GeoJSON.MultiLineString>[] = [];
  
  if (!lightsData?.features) return { type: 'FeatureCollection', features: [] };
  
  for (const feature of lightsData.features) {
    const props = feature.properties;
    if (!props) continue;
    
    const sectr1 = props.SECTR1 as number | undefined;
    const sectr2 = props.SECTR2 as number | undefined;
    
    // Only process lights with sector information
    if (sectr1 !== undefined && sectr2 !== undefined) {
      const coords = (feature.geometry as GeoJSON.Point).coordinates;
      const colours = props.COLOUR as string[] | undefined;
      const colour = colours && colours.length > 0 ? colours[0] : '1';
      
      // Use range (VALNMR) if available, otherwise default
      const range = props.VALNMR as number | undefined;
      const radiusNm = range ? Math.min(range * 0.2, 0.6) : 0.35;
      
      const sectorFeature = generateSectorLines(
        coords[0],
        coords[1],
        sectr1,
        sectr2,
        colour,
        radiusNm
      );
      
      sectorFeatures.push(sectorFeature);
    }
  }
  
  return {
    type: 'FeatureCollection',
    features: sectorFeatures,
  };
};

// Debug colors for each chart
const DEBUG_COLORS: Record<string, string> = {
  US4AK4PG: '#2196F3',  // Blue - Port Graham Area (large)
  US4AK4PH: '#FF9800',  // Orange - Approach
  US5AK5SJ: '#9C27B0',  // Purple - Approach Detail
  US5AK5SI: '#4CAF50',  // Green - Homer Harbor
  US5AK5QG: '#F44336',  // Red - Seldovia Harbor
  US5AK5QF: '#00BCD4',  // Cyan - Port Graham Detail
};

// Chart definitions with scale/usage bands
// Quilting: Charts are rendered in order from least to most detailed.
// More detailed charts overlay less detailed ones, creating a seamless "quilt"
const CHARTS = {
  // Large area charts (scale 4) - base layers
  US4AK4PG: {
    name: 'Port Graham Area',
    shortName: 'Port Graham',
    center: [-152.1000, 59.5500],
    scaleType: 'approach',
    scale: 1,  // Base layer - large area
    minZoom: 0,
    scaminContour: 179999,
    scaminSounding: 119999,
    bounds: [-152.4000, 59.4000, -151.8000, 59.7000],
    data: {
      depare: depareData_PG,
      depcnt: depcntData_PG,
      soundg: { type: 'FeatureCollection', features: [] },  // No soundings extracted
      lndare: lndareData_PG,
      lights: lightsData_PG,
      buoys: buoysData_PG,
      beacons: beaconsData_PG,
      landmarks: landmarksData_PG,
      wrecks: wrecksData_PG,
      rocks: rocksData_PG,
      obstructions: obstructionsData_PG,
      slcons: slconsData_PG,
      cblare: cblareData_PG,
      sbdare: sbdareData_PG,
      seaare: seaareData_PG,
      pipsol: pipsolData_PG,
    },
  },
  US4AK4PH: {
    name: 'Approaches to Homer Harbor',
    shortName: 'Approach',
    center: [-151.4900, 59.6350],
    scaleType: 'approach',
    scale: 1,  // Least detailed - base layer, always visible
    minZoom: 0,
    scaminContour: 179999,  // SCAMIN for contours
    scaminSounding: 119999,  // SCAMIN for soundings
    // Bounding box: [minLon, minLat, maxLon, maxLat]
    bounds: [-151.8000, 59.4023, -151.2000, 59.7000],
    data: {
      depare: depareData_PH,
      depcnt: depcntData_PH,
      soundg: soundgData_PH,
      lndare: lndareData_PH,
      lights: lightsData_PH,
      buoys: buoysData_PH,
      beacons: beaconsData_PH,
      landmarks: landmarksData_PH,
      wrecks: wrecksData_PH,
      rocks: rocksData_PH,
      obstructions: obstructionsData_PH,
      slcons: slconsData_PH,
      cblare: cblareData_PH,
      sbdare: sbdareData_PH,
      seaare: seaareData_PH,
      pipsol: pipsolData_PH,
    },
  },
  US5AK5SJ: {
    name: 'Approaches to Homer Harbor (Detail)',
    shortName: 'Approach Detail',
    center: [-151.4900, 59.6350],
    scaleType: 'approach_detail',
    scale: 2,  // More detailed than approach
    minZoom: 11,  // Appears at zoom 11+
    scaminContour: 44999,
    scaminSounding: 29999,
    bounds: [-151.3500, 59.5558, -151.2000, 59.6250],
    data: {
      depare: depareData_SJ,
      depcnt: depcntData_SJ,
      soundg: soundgData_SJ,
      lndare: lndareData_SJ,
      lights: lightsData_SJ,
      buoys: buoysData_SJ,
      beacons: beaconsData_SJ,
      landmarks: landmarksData_SJ,
      wrecks: wrecksData_SJ,
      rocks: rocksData_SJ,
      obstructions: obstructionsData_SJ,
      slcons: slconsData_SJ,
      cblare: cblareData_SJ,
      sbdare: sbdareData_SJ,
      seaare: seaareData_SJ,
      pipsol: pipsolData_SJ,
    },
  },
  US5AK5SI: {
    name: 'Homer Harbor',
    shortName: 'Homer',
    center: [-151.4900, 59.6350],
    scaleType: 'harbor',
    scale: 3,  // Most detailed - harbor scale
    minZoom: 12,  // Appears at zoom 12+
    scaminContour: 21999,
    scaminSounding: 17999,
    bounds: [-151.5000, 59.5500, -151.3500, 59.6250],
    data: {
      depare: depareData_SI,
      depcnt: depcntData_SI,
      soundg: soundgData_SI,
      lndare: lndareData_SI,
      lights: lightsData_SI,
      buoys: buoysData_SI,
      beacons: beaconsData_SI,
      landmarks: landmarksData_SI,
      wrecks: wrecksData_SI,
      rocks: rocksData_SI,
      obstructions: obstructionsData_SI,
      slcons: slconsData_SI,
      cblare: cblareData_SI,
      sbdare: sbdareData_SI,
      seaare: seaareData_SI,
      pipsol: pipsolData_SI,
    },
  },
  US5AK5QG: {
    name: 'Seldovia Harbor',
    shortName: 'Seldovia',
    center: [-151.4900, 59.6350],
    scaleType: 'harbor',
    scale: 3,  // Most detailed - harbor scale
    minZoom: 12,  // Appears at zoom 12+
    scaminContour: 21999,
    scaminSounding: 17999,
    bounds: [-151.8000, 59.4002, -151.6704, 59.4750],
    data: {
      depare: depareData_QG,
      depcnt: depcntData_QG,
      soundg: soundgData_QG,
      lndare: lndareData_QG,
      lights: lightsData_QG,
      buoys: buoysData_QG,
      beacons: beaconsData_QG,
      landmarks: landmarksData_QG,
      wrecks: wrecksData_QG,
      rocks: rocksData_QG,
      obstructions: obstructionsData_QG,
      slcons: slconsData_QG,
      cblare: cblareData_QG,
      sbdare: sbdareData_QG,
      seaare: seaareData_QG,
      pipsol: pipsolData_QG,
    },
  },
  US5AK5QF: {
    name: 'Port Graham Harbor',
    shortName: 'Port Graham Detail',
    center: [-151.8750, 59.4375],
    scaleType: 'harbor',
    scale: 3,  // Most detailed - harbor scale
    minZoom: 12,  // Appears at zoom 12+
    scaminContour: 21999,
    scaminSounding: 17999,
    bounds: [-151.9500, 59.4000, -151.8000, 59.4750],
    data: {
      depare: depareData_QF,
      depcnt: depcntData_QF,
      soundg: { type: 'FeatureCollection', features: [] },  // No soundings extracted
      lndare: lndareData_QF,
      lights: lightsData_QF,
      buoys: buoysData_QF,
      beacons: beaconsData_QF,
      landmarks: landmarksData_QF,
      wrecks: wrecksData_QF,
      rocks: rocksData_QF,
      obstructions: obstructionsData_QF,
      slcons: slconsData_QF,
      cblare: cblareData_QF,
      sbdare: sbdareData_QF,
      seaare: seaareData_QF,
      pipsol: pipsolData_QF,
    },
  },
};

// Helper to create GeoJSON polygon from bounds
const boundsToPolygon = (bounds: number[]) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: {
    type: 'Polygon' as const,
    coordinates: [[
      [bounds[0], bounds[1]],
      [bounds[2], bounds[1]],
      [bounds[2], bounds[3]],
      [bounds[0], bounds[3]],
      [bounds[0], bounds[1]],
    ]],
  },
});

// Feature info type for tap-to-inspect
interface FeatureInfo {
  layerType: string;
  chartKey: string;
  properties: Record<string, unknown>;
}

// S-57 Light attribute decoders for human-readable display
const LIGHT_COLOURS: Record<string, string> = {
  '1': 'White',
  '2': 'Black',
  '3': 'Red',
  '4': 'Green',
  '5': 'Blue',
  '6': 'Yellow',
  '7': 'Grey',
  '8': 'Brown',
  '9': 'Amber',
  '10': 'Violet',
  '11': 'Orange',
  '12': 'Magenta',
  '13': 'Pink',
};

const LIGHT_CHARACTERISTICS: Record<string, string> = {
  '1': 'Fixed (F)',
  '2': 'Flashing (Fl)',
  '3': 'Long-flashing (LFl)',
  '4': 'Quick (Q)',
  '5': 'Very quick (VQ)',
  '6': 'Ultra quick (UQ)',
  '7': 'Isophase (Iso)',
  '8': 'Occulting (Oc)',
  '9': 'Interrupted quick (IQ)',
  '10': 'Interrupted very quick (IVQ)',
  '11': 'Interrupted ultra quick (IUQ)',
  '12': 'Morse code (Mo)',
  '13': 'Fixed/flashing (FFl)',
  '14': 'Flashing/long-flashing (FlLFl)',
  '15': 'Occulting/flashing (OcFl)',
  '16': 'Fixed/long-flashing (FLFl)',
  '17': 'Occulting alternating (Al.Oc)',
  '18': 'Long-flash alternating (Al.LFl)',
  '19': 'Flashing alternating (Al.Fl)',
  '20': 'Quick alternating (Al.Q)',
  '25': 'Quick + Long-flash (Q+LFl)',
  '26': 'Very quick + Long-flash (VQ+LFl)',
  '27': 'Ultra quick + Long-flash (UQ+LFl)',
  '28': 'Alternating (Al)',
  '29': 'Fixed/alternating flashing (F+Al.Fl)',
};

// S-57 Category of light codes
const LIGHT_CATEGORIES: Record<string, string> = {
  '1': 'Directional',
  '2': 'Upper range light',
  '3': 'Lower range light',
  '4': 'Leading light',
  '5': 'Aero light',
  '6': 'Air obstruction',
  '7': 'Fog detector',
  '8': 'Flood light',
  '9': 'Strip light',
  '10': 'Subsidiary',
  '11': 'Spotlight',
  '12': 'Front range',
  '13': 'Rear range',
  '14': 'Lower light',
  '15': 'Upper light',
  '16': 'Moire effect',
  '17': 'Emergency',
  '18': 'Bearing light',
  '19': 'Horizontally disposed',
  '20': 'Vertically disposed',
};

// S-57 Exhibition condition codes
const EXHIBITION_CONDITIONS: Record<string, string> = {
  '1': 'Light shown without change of character',
  '2': 'Day light',
  '3': 'Fog light',
  '4': 'Night light',
};

// S-57 Light status codes
const LIGHT_STATUS: Record<string, string> = {
  '1': 'Permanent',
  '2': 'Occasional',
  '3': 'Recommended',
  '4': 'Not in use',
  '5': 'Periodic/Intermittent',
  '7': 'Temporary',
  '8': 'Private',
  '11': 'On request',
  '12': 'Reserved',
  '17': 'Extinguished',
  '18': 'Illuminated',
};

// Build abbreviated characteristic string for chart label
const getCharAbbrev = (litchr: string): string => {
  const abbrevs: Record<string, string> = {
    '1': 'F',       // Fixed
    '2': 'Fl',      // Flashing
    '3': 'LFl',     // Long-flashing
    '4': 'Q',       // Quick
    '5': 'VQ',      // Very quick
    '6': 'UQ',      // Ultra quick
    '7': 'Iso',     // Isophase
    '8': 'Oc',      // Occulting
    '9': 'IQ',      // Interrupted quick
    '10': 'IVQ',    // Interrupted very quick
    '11': 'IUQ',    // Interrupted ultra quick
    '12': 'Mo',     // Morse
    '13': 'FFl',    // Fixed/flash
    '14': 'FlLFl',  // Flash/long-flash
    '15': 'OcFl',   // Occulting/flash
    '16': 'FLFl',   // Fixed/long-flash
    '17': 'OcLFl',  // Occulting/long-flash
    '25': 'Q+LFl',  // Quick + long-flash
    '26': 'VQ+LFl', // Very quick + long-flash
    '27': 'UQ+LFl', // Ultra quick + long-flash
    '28': 'Al',     // Alternating
    '29': 'F+Al.Fl',// Fixed + alternating flash
  };
  return abbrevs[litchr] || '';
};

// Build abbreviated color string for chart label
const getColorAbbrev = (colours: string[]): string => {
  const abbrevs: Record<string, string> = {
    '1': 'W', '2': 'Bl', '3': 'R', '4': 'G', '5': 'Bu',
    '6': 'Y', '7': 'Gr', '8': 'Br', '9': 'Am', '10': 'Vi', '11': 'Or',
  };
  return colours.map(c => abbrevs[c] || '').join('');
};

// Format light properties for display
const formatLightInfo = (properties: Record<string, unknown>): Record<string, string> => {
  const formatted: Record<string, string> = {};
  
  // Build chart-style label first (e.g., "Fl(1) W 4s 8m 5M")
  const litchr = properties.LITCHR as string | undefined;
  const siggrp = properties.SIGGRP as string | undefined;
  const sigper = properties.SIGPER as number | undefined;
  const height = properties.HEIGHT as number | undefined;
  const valnmr = properties.VALNMR as number | undefined;
  const colours = properties.COLOUR as string[] | undefined;
  
  let chartLabel = '';
  if (litchr) {
    chartLabel = getCharAbbrev(litchr);
    if (siggrp) chartLabel += siggrp;
  }
  if (colours && colours.length > 0) {
    const colorAbbr = getColorAbbrev(colours);
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
  const catlit = properties.CATLIT as string[] | undefined;
  if (catlit && catlit.length > 0) {
    const categories = catlit.map(c => LIGHT_CATEGORIES[c] || `Code ${c}`).join(', ');
    formatted['Category'] = categories;
  }
  
  // Exhibition condition
  const exclit = properties.EXCLIT as number | undefined;
  if (exclit) {
    formatted['Exhibition'] = EXHIBITION_CONDITIONS[String(exclit)] || `Code ${exclit}`;
  }
  
  // Status
  const status = properties.STATUS as string[] | string | undefined;
  if (status) {
    const statusArray = Array.isArray(status) ? status : [status];
    const statusNames = statusArray.map(s => LIGHT_STATUS[s] || `Code ${s}`).join(', ');
    formatted['Status'] = statusNames;
  }
  
  // LNAM (unique identifier)
  const lnam = properties.LNAM as string | undefined;
  if (lnam) {
    formatted['ID (LNAM)'] = lnam;
  }
  
  return formatted;
};

// S-57 Buoy shape codes
const BUOY_SHAPES: Record<string, string> = {
  '1': 'Conical (nun)',
  '2': 'Can (cylindrical)',
  '3': 'Spherical',
  '4': 'Pillar',
  '5': 'Spar',
  '6': 'Barrel',
  '7': 'Super-buoy',
  '8': 'Ice buoy',
};

// S-57 Beacon shape codes
const BEACON_SHAPES: Record<string, string> = {
  '1': 'Stake/pole',
  '2': 'Withy',
  '3': 'Tower',
  '4': 'Lattice',
  '5': 'Pile',
  '6': 'Cairn',
  '7': 'Buoyant',
};

// S-57 Category of lateral mark
const LATERAL_CATEGORIES: Record<string, string> = {
  '1': 'Port hand (red, left side)',
  '2': 'Starboard hand (green, right side)',
  '3': 'Preferred channel to starboard',
  '4': 'Preferred channel to port',
};

// Format buoy properties for display
const formatBuoyInfo = (properties: Record<string, unknown>): Record<string, string> => {
  const formatted: Record<string, string> = {};
  
  // Name
  const objnam = properties.OBJNAM as string | undefined;
  if (objnam) {
    formatted['Name'] = objnam;
  }
  
  // Shape
  const boyshp = properties.BOYSHP as string | undefined;
  if (boyshp) {
    formatted['Shape'] = BUOY_SHAPES[boyshp] || `Code ${boyshp}`;
  }
  
  // Lateral category
  const catlam = properties.CATLAM as string | undefined;
  if (catlam) {
    formatted['Category'] = LATERAL_CATEGORIES[catlam] || `Code ${catlam}`;
  }
  
  // Color
  const colours = properties.COLOUR as string[] | undefined;
  if (colours && colours.length > 0) {
    const colorNames = colours.map(c => LIGHT_COLOURS[c] || c).join(', ');
    formatted['Color'] = colorNames;
  }
  
  // Status
  const status = properties.STATUS as string[] | undefined;
  if (status && status.length > 0) {
    const statusMap: Record<string, string> = {
      '1': 'Permanent', '2': 'Occasional', '4': 'Not in use', '8': 'Private',
    };
    formatted['Status'] = status.map(s => statusMap[s] || s).join(', ');
  }
  
  return formatted;
};

// S-57 Landmark category codes
const LANDMARK_CATEGORIES: Record<string, string> = {
  '1': 'Cairn',
  '2': 'Cemetery',
  '3': 'Chimney',
  '4': 'Dish aerial',
  '5': 'Flagstaff',
  '6': 'Flare stack',
  '7': 'Mast',
  '8': 'Windsock',
  '9': 'Monument',
  '10': 'Column/pillar',
  '11': 'Memorial plaque',
  '12': 'Obelisk',
  '13': 'Statue',
  '14': 'Cross',
  '15': 'Dome',
  '16': 'Radar scanner',
  '17': 'Tower',
  '18': 'Windmill',
  '19': 'Windmotor',
  '20': 'Spire/minaret',
};

// S-57 Function codes
const LANDMARK_FUNCTIONS: Record<string, string> = {
  '2': 'Harbour-Loss',
  '3': 'Custom',
  '4': 'Health',
  '7': 'Hospital',
  '9': 'Police',
  '20': 'Control',
  '21': 'Coastguard',
  '33': 'Light support',
  '35': 'Radio/TV',
  '45': 'Bus station',
  '46': 'Railway station',
};

// Format landmark properties for display
const formatLandmarkInfo = (properties: Record<string, unknown>): Record<string, string> => {
  const formatted: Record<string, string> = {};
  
  // Name
  const objnam = properties.OBJNAM as string | undefined;
  if (objnam) {
    formatted['Name'] = objnam;
  }
  
  // Category
  const catlmk = properties.CATLMK as string[] | undefined;
  if (catlmk && catlmk.length > 0) {
    const categories = catlmk.map(c => LANDMARK_CATEGORIES[c] || `Code ${c}`).join(', ');
    formatted['Category'] = categories;
  }
  
  // Function
  const functn = properties.FUNCTN as string[] | undefined;
  if (functn && functn.length > 0) {
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
  const colours = properties.COLOUR as string[] | undefined;
  if (colours && colours.length > 0) {
    const colorNames = colours.map(c => LIGHT_COLOURS[c] || c).join(', ');
    formatted['Color'] = colorNames;
  }
  
  return formatted;
};

// S-57 Category of wreck codes
const WRECK_CATEGORIES: Record<string, string> = {
  '1': 'Non-dangerous (depth known)',
  '2': 'Dangerous (submerged)',
  '3': 'Distributed remains',
  '4': 'Mast(s) showing',
  '5': 'Hull showing',
};

// S-57 Water level effect codes (shared with rocks/obstructions)
const WATER_LEVEL_EFFECT: Record<string, string> = {
  '1': 'Partly submerged at high water',
  '2': 'Always dry',
  '3': 'Always underwater/submerged',
  '4': 'Covers and uncovers',
  '5': 'Awash',
  '6': 'Subject to flooding',
  '7': 'Floating',
};

// S-57 Category of obstruction codes
const OBSTRUCTION_CATEGORIES: Record<string, string> = {
  '1': 'Snag/stump',
  '2': 'Wellhead',
  '3': 'Diffuser',
  '4': 'Crib',
  '5': 'Fish haven',
  '6': 'Foul area/ground',
  '7': 'Foul area (fishing)',
  '8': 'Foul area (cables)',
  '9': 'Pipeline area',
  '10': 'Ice boom',
};

// Format wreck properties for display
const formatWreckInfo = (properties: Record<string, unknown>): Record<string, string> => {
  const formatted: Record<string, string> = {};
  
  // Category
  const catwrk = properties.CATWRK as string | number | undefined;
  if (catwrk) {
    formatted['Category'] = WRECK_CATEGORIES[String(catwrk)] || `Code ${catwrk}`;
  }
  
  // Water level effect
  const watlev = properties.WATLEV as string | number | undefined;
  if (watlev) {
    formatted['Water Level'] = WATER_LEVEL_EFFECT[String(watlev)] || `Code ${watlev}`;
  }
  
  // Depth over wreck
  const valsou = properties.VALSOU as number | undefined;
  if (valsou !== undefined) {
    formatted['Depth Over'] = `${valsou}m`;
  }
  
  // Name
  const objnam = properties.OBJNAM as string | undefined;
  if (objnam) {
    formatted['Name'] = objnam;
  }
  
  // Additional info
  const inform = properties.INFORM as string | undefined;
  if (inform) {
    formatted['Info'] = inform;
  }
  
  // Source date
  const sordat = properties.SORDAT as string | undefined;
  if (sordat) {
    formatted['Survey Date'] = sordat;
  }
  
  return formatted;
};

// Format rock properties for display
const formatRockInfo = (properties: Record<string, unknown>): Record<string, string> => {
  const formatted: Record<string, string> = {};
  
  // Water level effect
  const watlev = properties.WATLEV as string | number | undefined;
  if (watlev) {
    formatted['Water Level'] = WATER_LEVEL_EFFECT[String(watlev)] || `Code ${watlev}`;
  }
  
  // Depth over rock
  const valsou = properties.VALSOU as number | undefined;
  if (valsou !== undefined) {
    formatted['Depth Over'] = `${valsou}m`;
  }
  
  // Exposition of sounding
  const expsou = properties.EXPSOU as number | undefined;
  if (expsou === 1) {
    formatted['Depth Status'] = 'Within range of depth';
  } else if (expsou === 2) {
    formatted['Depth Status'] = 'Shoaler than depth shown';
  }
  
  // Name
  const objnam = properties.OBJNAM as string | undefined;
  if (objnam) {
    formatted['Name'] = objnam;
  }
  
  return formatted;
};

// S-57 Category of shoreline construction codes
const SLCONS_CATEGORIES: Record<string, string> = {
  '1': 'Breakwater',
  '2': 'Mole',
  '3': 'Pier/jetty',
  '4': 'Promenade pier',
  '5': 'Wharf/quay',
  '6': 'Training wall',
  '7': 'Groyne',
  '8': 'Dyke/levee',
  '9': 'Lock/gate',
  '10': 'Flood barrage',
  '11': 'Slip',
  '12': 'Ramp',
  '13': 'Revetment',
  '14': 'Sea wall',
  '15': 'Landing steps',
  '16': 'Rip rap',
  '17': 'Reclamation area',
  '18': 'Floating breakwater',
};

// S-57 Restriction codes (used by CBLARE and other areas)
const RESTRICTION_CODES: Record<string, string> = {
  '1': 'Anchoring prohibited',
  '2': 'Anchoring restricted',
  '3': 'Fishing prohibited',
  '4': 'Fishing restricted',
  '5': 'Trawling prohibited',
  '6': 'Entry prohibited',
  '7': 'Dredging prohibited',
  '8': 'Diving prohibited',
  '9': 'No wake',
  '10': 'Area to be avoided',
  '11': 'Construction prohibited',
  '13': 'Discharging prohibited',
  '14': 'Discharging restricted',
  '17': 'Speed restricted',
  '24': 'Anchoring prohibited',
  '27': 'Swimming prohibited',
};

// S-57 NATSUR (Nature of Surface) codes for seabed
const SEABED_NATURE: Record<string, string> = {
  '1': 'Mud (M)',
  '2': 'Clay (Cy)',
  '3': 'Silt (Si)',
  '4': 'Sand (S)',
  '5': 'Stone (St)',
  '6': 'Gravel (G)',
  '7': 'Pebbles (P)',
  '8': 'Cobbles (Cb)',
  '9': 'Rock (Rk)',
  '10': 'Lava',
  '11': 'Coral (Co)',
  '12': 'Volcanic',
  '13': 'Boulder (Bo)',
  '14': 'Shells (Sh)',
  '17': 'Hard (hrd)',
  '18': 'Soft (sft)',
};

// Get seabed abbreviation for map display
const getSeabedAbbrev = (natsur: string[]): string => {
  const abbrevMap: Record<string, string> = {
    '1': 'M', '2': 'Cy', '3': 'Si', '4': 'S', '5': 'St',
    '6': 'G', '7': 'P', '8': 'Cb', '9': 'Rk', '10': 'Lv',
    '11': 'Co', '12': 'V', '13': 'Bo', '14': 'Sh', '17': 'hrd', '18': 'sft',
  };
  return natsur.map(n => abbrevMap[n] || '?').join('.');
};

// Get color for seabed type (primary type)
const getSeabedColor = (natsur: string[]): string => {
  if (!natsur || natsur.length === 0) return '#888888';
  const primary = natsur[0];
  const colors: Record<string, string> = {
    '1': '#6B8E6B',   // Mud - greenish grey
    '2': '#808080',   // Clay - grey
    '3': '#A9A9A9',   // Silt - dark grey
    '4': '#DAA520',   // Sand - golden
    '5': '#8B4513',   // Stone - brown
    '6': '#D2B48C',   // Gravel - tan
    '7': '#BC8F8F',   // Pebbles - rosy brown
    '8': '#A0522D',   // Cobbles - sienna
    '9': '#8B0000',   // Rock - dark red
    '11': '#FF69B4',  // Coral - pink
    '14': '#9932CC',  // Shells - purple
    '17': '#8B4513',  // Hard - brown
    '18': '#D3D3D3',  // Soft - light grey
  };
  return colors[primary] || '#888888';
};

// S-57 CATSEA (Category of Sea Area) codes
const SEA_AREA_CATEGORIES: Record<string, string> = {
  '1': 'Gulf',
  '2': 'Basin',
  '3': 'Reach',
  '4': 'Anchorage',
  '5': 'Bay',
  '6': 'Canal',
  '7': 'Channel',
  '8': 'Strait',
  '9': 'Sound',
  '10': 'Ocean',
  '11': 'Routing Area',
  '12': 'Sea',
  '13': 'Bight',
  '14': 'Estuary',
  '15': 'Inlet',
  '16': 'Lake',
  '17': 'Fjord',
  '18': 'Harbor',
  '19': 'Cove',
  '20': 'Lagoon',
};

// S-57 CATPIP (Category of Pipeline) codes
const PIPELINE_CATEGORIES: Record<string, string> = {
  '1': 'Oil pipeline',
  '2': 'Gas pipeline',
  '3': 'Water pipeline',
  '4': 'Outfall pipe',
  '5': 'Intake pipe',
  '6': 'Sewer pipe',
  '7': 'Bubbler system',
  '8': 'Supply pipe',
};

// Format pipeline properties for display
const formatPipsolInfo = (properties: Record<string, unknown>): Record<string, string> => {
  const formatted: Record<string, string> = {};
  
  // Category
  const catpip = properties.CATPIP as string[] | undefined;
  if (catpip && catpip.length > 0) {
    formatted['Type'] = catpip.map(c => PIPELINE_CATEGORIES[c] || `Category ${c}`).join(', ');
  } else {
    formatted['Type'] = 'Submarine pipeline';
  }
  
  // Name
  const objnam = properties.OBJNAM as string | undefined;
  if (objnam) {
    formatted['Name'] = objnam;
  }
  
  // Product
  const prodct = properties.PRODCT as string | undefined;
  if (prodct) {
    formatted['Product'] = prodct;
  }
  
  return formatted;
};

// Format sea area properties for display
const formatSeaareInfo = (properties: Record<string, unknown>): Record<string, string> => {
  const formatted: Record<string, string> = {};
  
  // Name
  const objnam = properties.OBJNAM as string | undefined;
  if (objnam) {
    formatted['Name'] = objnam;
  }
  
  // Category
  const catsea = properties.CATSEA as number | undefined;
  if (catsea) {
    formatted['Type'] = SEA_AREA_CATEGORIES[String(catsea)] || `Category ${catsea}`;
  }
  
  return formatted;
};

// Format seabed area properties for display
const formatSbdareInfo = (properties: Record<string, unknown>): Record<string, string> => {
  const formatted: Record<string, string> = {};
  
  // Nature of seabed
  const natsur = properties.NATSUR as string[] | undefined;
  if (natsur && natsur.length > 0) {
    const nature = natsur.map(n => SEABED_NATURE[n] || `Code ${n}`).join(', ');
    formatted['Seabed Type'] = nature;
  }
  
  // Qualifying terms
  const natqua = properties.NATQUA as string[] | undefined;
  if (natqua && natqua.length > 0) {
    const qualMap: Record<string, string> = {
      '1': 'Fine', '2': 'Medium', '3': 'Coarse', '4': 'Broken',
      '5': 'Sticky', '6': 'Soft', '7': 'Stiff', '8': 'Volcanic',
      '9': 'Calcareous', '10': 'Hard',
    };
    formatted['Quality'] = natqua.map(q => qualMap[q] || q).join(', ');
  }
  
  // Color
  const colour = properties.COLOUR as string[] | undefined;
  if (colour && colour.length > 0) {
    const colorMap: Record<string, string> = {
      '1': 'White', '2': 'Black', '3': 'Red', '4': 'Green',
      '5': 'Blue', '6': 'Yellow', '7': 'Grey', '8': 'Brown',
      '9': 'Amber', '10': 'Violet', '11': 'Orange', '12': 'Magenta', '13': 'Pink',
    };
    formatted['Color'] = colour.map(c => colorMap[c] || c).join(', ');
  }
  
  return formatted;
};

// Format cable area properties for display
const formatCblareInfo = (properties: Record<string, unknown>): Record<string, string> => {
  const formatted: Record<string, string> = {};
  
  formatted['Type'] = 'Submarine Cable Area';
  
  // Restrictions
  const restrn = properties.RESTRN as string[] | undefined;
  if (restrn && restrn.length > 0) {
    const restrictions = restrn.map(r => RESTRICTION_CODES[r] || `Code ${r}`).join(', ');
    formatted['Restrictions'] = restrictions;
  }
  
  // Name
  const objnam = properties.OBJNAM as string | undefined;
  if (objnam) {
    formatted['Name'] = objnam;
  }
  
  // Additional info
  const inform = properties.INFORM as string | undefined;
  if (inform) {
    formatted['Info'] = inform;
  }
  
  return formatted;
};

// Format shoreline construction properties for display
const formatSlconsInfo = (properties: Record<string, unknown>): Record<string, string> => {
  const formatted: Record<string, string> = {};
  
  // Category
  const catslc = properties.CATSLC as string | number | undefined;
  if (catslc) {
    formatted['Type'] = SLCONS_CATEGORIES[String(catslc)] || `Code ${catslc}`;
  }
  
  // Water level effect
  const watlev = properties.WATLEV as string | number | undefined;
  if (watlev) {
    formatted['Water Level'] = WATER_LEVEL_EFFECT[String(watlev)] || `Code ${watlev}`;
  }
  
  // Condition
  const condtn = properties.CONDTN as number | undefined;
  if (condtn) {
    const conditions: Record<string, string> = {
      '1': 'Under construction',
      '2': 'Ruined',
      '3': 'Under reclamation',
      '4': 'Wingless',
      '5': 'Planned construction',
    };
    formatted['Condition'] = conditions[String(condtn)] || `Code ${condtn}`;
  }
  
  // Name
  const objnam = properties.OBJNAM as string | undefined;
  if (objnam) {
    formatted['Name'] = objnam;
  }
  
  // Additional info
  const inform = properties.INFORM as string | undefined;
  if (inform) {
    formatted['Info'] = inform;
  }
  
  return formatted;
};

// Format obstruction properties for display
const formatObstructionInfo = (properties: Record<string, unknown>): Record<string, string> => {
  const formatted: Record<string, string> = {};
  
  // Category
  const catobs = properties.CATOBS as string | number | undefined;
  if (catobs) {
    formatted['Category'] = OBSTRUCTION_CATEGORIES[String(catobs)] || `Code ${catobs}`;
  }
  
  // Water level effect
  const watlev = properties.WATLEV as string | number | undefined;
  if (watlev) {
    formatted['Water Level'] = WATER_LEVEL_EFFECT[String(watlev)] || `Code ${watlev}`;
  }
  
  // Depth
  const valsou = properties.VALSOU as number | undefined;
  if (valsou !== undefined) {
    formatted['Depth'] = `${valsou}m`;
  }
  
  // Name
  const objnam = properties.OBJNAM as string | undefined;
  if (objnam) {
    formatted['Name'] = objnam;
  }
  
  // Additional info
  const inform = properties.INFORM as string | undefined;
  if (inform) {
    formatted['Info'] = inform;
  }
  
  return formatted;
};

// Format beacon properties for display
const formatBeaconInfo = (properties: Record<string, unknown>): Record<string, string> => {
  const formatted: Record<string, string> = {};
  
  // Name
  const objnam = properties.OBJNAM as string | undefined;
  if (objnam) {
    formatted['Name'] = objnam;
  }
  
  // Shape
  const bcnshp = properties.BCNSHP as string | undefined;
  if (bcnshp) {
    formatted['Shape'] = BEACON_SHAPES[bcnshp] || `Code ${bcnshp}`;
  }
  
  // Lateral category
  const catlam = properties.CATLAM as string | undefined;
  if (catlam) {
    formatted['Category'] = LATERAL_CATEGORIES[catlam] || `Code ${catlam}`;
  }
  
  // Color
  const colours = properties.COLOUR as string[] | undefined;
  if (colours && colours.length > 0) {
    const colorNames = colours.map(c => LIGHT_COLOURS[c] || c).join(', ');
    formatted['Color'] = colorNames;
  }
  
  // Additional info
  const inform = properties.INFORM as string | undefined;
  if (inform) {
    formatted['Info'] = inform;
  }
  
  return formatted;
};

type ChartKey = keyof typeof CHARTS;

// Explicit render order: least detailed first (bottom), most detailed last (top)
// This ensures proper quilting - detailed charts overlay less detailed ones
const CHART_RENDER_ORDER: ChartKey[] = ['US4AK4PG', 'US4AK4PH', 'US5AK5SJ', 'US5AK5SI', 'US5AK5QG', 'US5AK5QF'];

// Set Mapbox access token from environment variable
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || '';
if (MAPBOX_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_TOKEN);
} else {
  console.warn('Mapbox access token not found. Please check .env file.');
}

// Homer Spit, Alaska coordinates
const HOMER_HARBOR_CENTER: [number, number] = [-151.4900, 59.6350];

export default function ChartViewerMapbox() {
  const [showDepthAreas, setShowDepthAreas] = useState(true);
  const [showDepthContours, setShowDepthContours] = useState(true);
  const [showSoundings, setShowSoundings] = useState(true);
  const [showLand, setShowLand] = useState(true);
  const [showLights, setShowLights] = useState(true);
  const [showBuoys, setShowBuoys] = useState(true);
  const [showBeacons, setShowBeacons] = useState(true);
  const [showLandmarks, setShowLandmarks] = useState(true);
  const [showSectors, setShowSectors] = useState(true);
  const [showHazards, setShowHazards] = useState(true);
  const [showSlcons, setShowSlcons] = useState(true);
  const [showCables, setShowCables] = useState(true);
  const [showSeabed, setShowSeabed] = useState(true);
  const [showSeaNames, setShowSeaNames] = useState(true);
  const [showSatellite, setShowSatellite] = useState(false);
  
  // Pre-compute sector arc geometries for all charts
  const sectorData = useMemo(() => {
    return {
      US4AK4PH: extractSectorFeatures(lightsData_PH),
      US5AK5SJ: extractSectorFeatures(lightsData_SJ),
      US5AK5SI: extractSectorFeatures(lightsData_SI),
      US5AK5QG: extractSectorFeatures(lightsData_QG),
    };
  }, []);
  
  // Debug state
  const [currentZoom, setCurrentZoom] = useState(13);
  const [selectedFeature, setSelectedFeature] = useState<FeatureInfo | null>(null);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const mapRef = useRef<MapView>(null);

  // Calculate which charts are active at current zoom
  const getActiveCharts = useCallback((zoom: number) => {
    return CHART_RENDER_ORDER.filter(key => zoom >= CHARTS[key].minZoom);
  }, []);

  // Calculate SCAMIN visibility status - MUTUALLY EXCLUSIVE bands
  const getScaminStatus = useCallback((zoom: number) => {
    const status = {
      harbor: zoom >= 15,                    // SCAMIN <= 50000: zoom 15+
      approachDetail: zoom >= 13 && zoom < 15,  // SCAMIN 50-100k: zoom 13-14
      approach: zoom >= 11 && zoom < 13,     // SCAMIN > 100k: zoom 11-12
    };
    return status;
  }, []);

  // Handle map idle to track zoom (replaces deprecated onRegionDidChange)
  const handleMapIdle = useCallback((state: any) => {
    if (state?.properties?.zoom !== undefined) {
      setCurrentZoom(Math.round(state.properties.zoom * 10) / 10);
    }
  }, []);

  // Handle map press for tap-to-inspect
  const handleMapPress = useCallback(async (event: any) => {
    if (!mapRef.current) return;
    
    const { geometry } = event;
    if (!geometry?.coordinates) return;

    try {
      // Query features at the tap point
      const features = await mapRef.current.queryRenderedFeaturesAtPoint(
        [event.properties.screenPointX, event.properties.screenPointY],
        undefined,
        // Query all our layer IDs - lights tap-target first for priority
        CHART_RENDER_ORDER.flatMap(key => [
          `lights-tap-target-${key}`,
          `lights-symbol-${key}`,
          `depth-contours-${key}`,
          `soundings-${key}`,
          `depth-areas-${key}`,
        ])
      );

      if (features?.features?.length > 0) {
        const feat = features.features[0];
        
        // Debug: log the full feature structure to understand what we're getting
        console.log('Full feature object keys:', Object.keys(feat));
        console.log('Full feature:', JSON.stringify(feat, null, 2));
        
        // Get identifying info from the feature - check multiple possible locations
        // @rnmapbox/maps may return layer info in different properties
        const sourceId = feat.source || feat.properties?.source || '';
        const layerIdFromProps = feat.properties?.layerId || feat.layer?.id || '';
        const identifier = sourceId + ' ' + layerIdFromProps;
        
        // Debug: log what we're getting
        console.log('Tapped feature:', { sourceId, layerIdFromProps, identifier });
        
        // Extract chart key from source/layer ID
        let chartKey = 'unknown';
        let layerType = 'unknown';
        
        for (const key of CHART_RENDER_ORDER) {
          if (identifier.includes(key) || sourceId.includes(key)) {
            chartKey = key;
            break;
          }
        }
        
        // Determine layer type from source ID
        if (sourceId.includes('lights') || layerIdFromProps.includes('lights')) {
          layerType = 'Light';
        } else if (sourceId.includes('contours') || layerIdFromProps.includes('contour')) {
          layerType = 'Contour';
        } else if (sourceId.includes('soundings') || layerIdFromProps.includes('sounding')) {
          layerType = 'Sounding';
        } else if (sourceId.includes('depth-areas') || layerIdFromProps.includes('depth-area')) {
          layerType = 'Depth Area';
        }

        setSelectedFeature({
          layerType,
          chartKey,
          properties: feat.properties || {},
        });
      } else {
        setSelectedFeature(null);
      }
    } catch (err) {
      console.log('Query error:', err);
    }
  }, []);

  // Count features per chart (simplified - actual visible count would need querying)
  const featureCounts = CHART_RENDER_ORDER.reduce((acc, key) => {
    const chart = CHARTS[key];
    acc[key] = {
      contours: chart.data.depcnt.features?.length || 0,
      soundings: chart.data.soundg.features?.length || 0,
      lights: chart.data.lights?.features?.length || 0,
    };
    return acc;
  }, {} as Record<string, { contours: number; soundings: number; lights: number }>);

  const activeCharts = getActiveCharts(currentZoom);
  const scaminStatus = getScaminStatus(currentZoom);

  console.log('Quilted chart display - 4 charts layered by detail level');

  return (
    <View style={styles.container}>
      {/* Chart Info Header */}
      <View style={styles.header}>
        <Text style={styles.chartTitle}>Homer Harbor - Quilted Charts</Text>
        <Text style={styles.chartInfo}>
          4 Charts Layered | Zoom for Detail
        </Text>
      </View>

      {/* Mapbox Map */}
      <Mapbox.MapView
        ref={mapRef}
        style={styles.map}
        styleURL={showSatellite ? Mapbox.StyleURL.Satellite : Mapbox.StyleURL.Light}
        onMapIdle={handleMapIdle}
        onPress={handleMapPress}
      >
        <Mapbox.Camera
          zoomLevel={13}
          centerCoordinate={HOMER_HARBOR_CENTER}
          animationDuration={0}
        />

        {/* Load S-52 symbol images for navigation features */}
        <Mapbox.Images images={NAV_SYMBOLS} />

        {/* DEBUG: Chart boundary outlines */}
        {showBoundaries && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          const color = DEBUG_COLORS[chartKey];
          return (
            <Mapbox.ShapeSource
              key={`boundary-${chartKey}`}
              id={`boundary-source-${chartKey}`}
              shape={boundsToPolygon(chart.bounds)}
            >
              <Mapbox.LineLayer
                id={`boundary-line-${chartKey}`}
                style={{
                  lineColor: color,
                  lineWidth: 3,
                  lineDasharray: [4, 2],
                  lineOpacity: 0.8,
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Land Areas - Quilted: rendered in order from least to most detailed
            Note: LNDARE can contain Point, LineString, and Polygon geometries
            We only render Polygon/MultiPolygon features in the FillLayer */}
        {showLand && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          
          // Filter to only polygon geometries for FillLayer
          const polygonFeatures = chart.data.lndare.features?.filter(
            (f: any) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
          ) || [];
          
          if (polygonFeatures.length === 0) {
            console.log(`[LNDARE] ${chartKey}: No polygon features, skipping FillLayer`);
            return null;
          }
          
          console.log(`[LNDARE] ${chartKey}: Rendering ${polygonFeatures.length} polygon features`);
          
          return (
            <Mapbox.ShapeSource
              key={`land-${chartKey}`}
              id={`land-source-${chartKey}`}
              shape={{ type: 'FeatureCollection', features: polygonFeatures }}
              minZoomLevel={chart.minZoom}
            >
              <Mapbox.FillLayer
                id={`land-fill-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  fillColor: '#E8D4A0',
                  fillOpacity: 0.9,
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Shoreline Constructions (SLCONS) - Piers, jetties, breakwaters
            Rendered on top of land/water as dark brown lines/polygons */}
        {showSlcons && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          if (!chart.data.slcons || chart.data.slcons.features.length === 0) return null;
          
          // Separate by geometry type
          const lineFeatures = chart.data.slcons.features.filter(
            (f: any) => f.geometry && f.geometry.type === 'LineString'
          );
          const polygonFeatures = chart.data.slcons.features.filter(
            (f: any) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
          );
          const pointFeatures = chart.data.slcons.features.filter(
            (f: any) => f.geometry && f.geometry.type === 'Point'
          );
          
          console.log(`[SLCONS] ${chartKey}: ${lineFeatures.length} lines, ${polygonFeatures.length} polys, ${pointFeatures.length} points`);
          
          return (
            <React.Fragment key={`slcons-${chartKey}`}>
              {/* Polygon SLCONS (larger structures like ramps) */}
              {polygonFeatures.length > 0 && (
                <Mapbox.ShapeSource
                  id={`slcons-poly-source-${chartKey}`}
                  shape={{ type: 'FeatureCollection', features: polygonFeatures }}
                  minZoomLevel={chart.minZoom}
                  onPress={(e) => {
                    if (e.features && e.features.length > 0) {
                      const feat = e.features[0];
                      setSelectedFeature({
                        layerType: 'Shoreline',
                        chartKey: chartKey,
                        properties: feat.properties || {},
                      });
                    }
                  }}
                >
                  <Mapbox.FillLayer
                    id={`slcons-fill-${chartKey}`}
                    minZoomLevel={chart.minZoom}
                    style={{
                      fillColor: '#8B7355',  // Dark brown/tan for structures
                      fillOpacity: 0.8,
                    }}
                  />
                  <Mapbox.LineLayer
                    id={`slcons-poly-outline-${chartKey}`}
                    minZoomLevel={chart.minZoom}
                    style={{
                      lineColor: '#4A3728',  // Darker brown outline
                      lineWidth: 1,
                    }}
                  />
                </Mapbox.ShapeSource>
              )}
              
              {/* Line SLCONS (piers, jetties, breakwaters) */}
              {lineFeatures.length > 0 && (
                <Mapbox.ShapeSource
                  id={`slcons-line-source-${chartKey}`}
                  shape={{ type: 'FeatureCollection', features: lineFeatures }}
                  minZoomLevel={chart.minZoom}
                  onPress={(e) => {
                    if (e.features && e.features.length > 0) {
                      const feat = e.features[0];
                      setSelectedFeature({
                        layerType: 'Shoreline',
                        chartKey: chartKey,
                        properties: feat.properties || {},
                      });
                    }
                  }}
                >
                  <Mapbox.LineLayer
                    id={`slcons-line-${chartKey}`}
                    minZoomLevel={chart.minZoom}
                    style={{
                      lineColor: '#4A3728',  // Dark brown for piers
                      lineWidth: [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        10, 2,
                        14, 3,
                        18, 5,
                      ],
                      lineCap: 'round',
                      lineJoin: 'round',
                    }}
                  />
                </Mapbox.ShapeSource>
              )}
              
              {/* Point SLCONS (rare - small features) */}
              {pointFeatures.length > 0 && (
                <Mapbox.ShapeSource
                  id={`slcons-point-source-${chartKey}`}
                  shape={{ type: 'FeatureCollection', features: pointFeatures }}
                  minZoomLevel={chart.minZoom}
                  hitbox={{ width: 30, height: 30 }}
                  onPress={(e) => {
                    if (e.features && e.features.length > 0) {
                      const feat = e.features[0];
                      setSelectedFeature({
                        layerType: 'Shoreline',
                        chartKey: chartKey,
                        properties: feat.properties || {},
                      });
                    }
                  }}
                >
                  <Mapbox.CircleLayer
                    id={`slcons-circle-${chartKey}`}
                    minZoomLevel={chart.minZoom}
                    style={{
                      circleRadius: 4,
                      circleColor: '#4A3728',
                      circleStrokeColor: '#FFFFFF',
                      circleStrokeWidth: 1,
                    }}
                  />
                </Mapbox.ShapeSource>
              )}
            </React.Fragment>
          );
        })}

        {/* Depth Areas - Quilted: detailed charts overlay less detailed ones */}
        {showDepthAreas && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          
          // Filter to only polygon geometries (DEPARE should only have polygons, but be safe)
          const polygonFeatures = chart.data.depare.features?.filter(
            (f: any) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
          ) || [];
          
          if (polygonFeatures.length === 0) {
            console.log(`[DEPARE] ${chartKey}: No polygon features, skipping`);
            return null;
          }
          
          // Log if there's a mismatch (indicates non-polygon data in the source)
          if (polygonFeatures.length !== chart.data.depare.features?.length) {
            console.warn(`[DEPARE] ${chartKey}: Filtered ${chart.data.depare.features.length - polygonFeatures.length} non-polygon features`);
          }
          
          return (
            <Mapbox.ShapeSource
              key={`depare-${chartKey}`}
              id={`depth-areas-source-${chartKey}`}
              shape={{ type: 'FeatureCollection', features: polygonFeatures }}
              minZoomLevel={chart.minZoom}
            >
              <Mapbox.FillLayer
                id={`depth-areas-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  fillColor: [
                    'step',
                    ['get', 'DRVAL2'],
                    '#A5D6FF',
                    2,
                    '#8ECCFF',
                    5,
                    '#6BB8E8',
                    10,
                    '#4A9FD8',
                    20,
                    '#B8D4E8',
                  ],
                  fillOpacity: 0.7,
                }}
              />
              <Mapbox.LineLayer
                id={`depth-area-outlines-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  lineColor: '#1976D2',
                  lineWidth: 1,
                  lineOpacity: 0.5,
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Cable Areas (CBLARE) - Submarine cable zones with anchoring restrictions
            Rendered as magenta dashed outline with semi-transparent fill */}
        {showCables && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          if (!chart.data.cblare || chart.data.cblare.features.length === 0) return null;
          
          // Filter to polygons only
          const polygonFeatures = chart.data.cblare.features.filter(
            (f: any) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
          );
          
          if (polygonFeatures.length === 0) return null;
          
          console.log(`[CBLARE] ${chartKey}: Rendering ${polygonFeatures.length} cable areas`);
          
          return (
            <Mapbox.ShapeSource
              key={`cblare-${chartKey}`}
              id={`cblare-source-${chartKey}`}
              shape={{ type: 'FeatureCollection', features: polygonFeatures }}
              minZoomLevel={chart.minZoom}
              onPress={(e) => {
                if (e.features && e.features.length > 0) {
                  const feat = e.features[0];
                  setSelectedFeature({
                    layerType: 'Cable Area',
                    chartKey: chartKey,
                    properties: feat.properties || {},
                  });
                }
              }}
            >
              <Mapbox.FillLayer
                id={`cblare-fill-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  fillColor: 'rgba(255, 0, 255, 0.1)',  // Light magenta fill
                  fillOutlineColor: '#FF00FF',
                }}
              />
              <Mapbox.LineLayer
                id={`cblare-outline-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  lineColor: '#FF00FF',  // Magenta outline
                  lineWidth: 2,
                  lineDasharray: [8, 4],  // Dashed line
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Pipelines (PIPSOL) - Submarine pipelines (outfalls, intakes)
            Rendered as cyan dashed lines to distinguish from cables */}
        {showCables && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          if (!chart.data.pipsol || chart.data.pipsol.features.length === 0) return null;
          
          console.log(`[PIPSOL] ${chartKey}: ${chart.data.pipsol.features.length} pipelines`);
          
          return (
            <Mapbox.ShapeSource
              key={`pipsol-${chartKey}`}
              id={`pipsol-source-${chartKey}`}
              shape={chart.data.pipsol}
              minZoomLevel={chart.minZoom}
              hitbox={{ width: 10, height: 10 }}
              onPress={(e) => {
                if (e.features && e.features.length > 0) {
                  const feat = e.features[0];
                  setSelectedFeature({
                    layerType: 'Pipeline',
                    chartKey: chartKey,
                    properties: feat.properties || {},
                  });
                }
              }}
            >
              <Mapbox.LineLayer
                id={`pipsol-line-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  lineColor: '#00CED1',  // Dark cyan for pipelines
                  lineWidth: 2,
                  lineDasharray: [6, 3],  // Different dash pattern than cables
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Seabed Areas (SBDARE) - Bottom type information (mud, sand, rock, etc.)
            Polygons show colored fills, Points show abbreviation labels */}
        {showSeabed && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          if (!chart.data.sbdare || chart.data.sbdare.features.length === 0) return null;
          
          // Separate polygons and points
          const polygonFeatures = chart.data.sbdare.features.filter(
            (f: any) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
          );
          const pointFeatures = chart.data.sbdare.features.filter(
            (f: any) => f.geometry && f.geometry.type === 'Point'
          );
          
          // Add seabed abbreviation to point features for labeling
          const labeledPoints = pointFeatures.map((f: any) => ({
            ...f,
            properties: {
              ...f.properties,
              _sbdLabel: getSeabedAbbrev(f.properties?.NATSUR || []),
              _sbdColor: getSeabedColor(f.properties?.NATSUR || []),
            }
          }));
          
          console.log(`[SBDARE] ${chartKey}: ${polygonFeatures.length} polygons, ${pointFeatures.length} points`);
          
          return (
            <React.Fragment key={`sbdare-${chartKey}`}>
              {/* Polygon seabed areas */}
              {polygonFeatures.length > 0 && (
                <Mapbox.ShapeSource
                  id={`sbdare-poly-source-${chartKey}`}
                  shape={{ type: 'FeatureCollection', features: polygonFeatures }}
                  minZoomLevel={chart.minZoom}
                  onPress={(e) => {
                    if (e.features && e.features.length > 0) {
                      const feat = e.features[0];
                      setSelectedFeature({
                        layerType: 'Seabed',
                        chartKey: chartKey,
                        properties: feat.properties || {},
                      });
                    }
                  }}
                >
                  <Mapbox.FillLayer
                    id={`sbdare-fill-${chartKey}`}
                    minZoomLevel={chart.minZoom}
                    style={{
                      fillColor: [
                        'match',
                        ['at', 0, ['get', 'NATSUR']],
                        '1', 'rgba(107, 142, 107, 0.3)',   // Mud - greenish
                        '2', 'rgba(128, 128, 128, 0.3)',   // Clay - grey
                        '4', 'rgba(218, 165, 32, 0.3)',    // Sand - golden
                        '6', 'rgba(210, 180, 140, 0.3)',   // Gravel - tan
                        '9', 'rgba(139, 0, 0, 0.3)',       // Rock - dark red
                        '11', 'rgba(255, 105, 180, 0.3)',  // Coral - pink
                        '14', 'rgba(153, 50, 204, 0.3)',   // Shells - purple
                        'rgba(136, 136, 136, 0.2)',       // Default
                      ],
                      fillOutlineColor: [
                        'match',
                        ['at', 0, ['get', 'NATSUR']],
                        '1', '#6B8E6B',
                        '2', '#808080',
                        '4', '#DAA520',
                        '6', '#D2B48C',
                        '9', '#8B0000',
                        '11', '#FF69B4',
                        '14', '#9932CC',
                        '#888888',
                      ],
                    }}
                  />
                </Mapbox.ShapeSource>
              )}
              
              {/* Point seabed samples - shown as text labels */}
              {labeledPoints.length > 0 && (
                <Mapbox.ShapeSource
                  id={`sbdare-point-source-${chartKey}`}
                  shape={{ type: 'FeatureCollection', features: labeledPoints }}
                  minZoomLevel={chart.minZoom}
                  hitbox={{ width: 20, height: 20 }}
                  onPress={(e) => {
                    if (e.features && e.features.length > 0) {
                      const feat = e.features[0];
                      setSelectedFeature({
                        layerType: 'Seabed',
                        chartKey: chartKey,
                        properties: feat.properties || {},
                      });
                    }
                  }}
                >
                  <Mapbox.SymbolLayer
                    id={`sbdare-labels-${chartKey}`}
                    minZoomLevel={Math.max(chart.minZoom, 11)}
                    style={{
                      textField: ['get', '_sbdLabel'],
                      textSize: 10,
                      textColor: ['get', '_sbdColor'],
                      textHaloColor: 'white',
                      textHaloWidth: 1,
                      textFont: ['Open Sans Bold'],
                      textAllowOverlap: false,
                      textIgnorePlacement: false,
                    }}
                  />
                </Mapbox.ShapeSource>
              )}
            </React.Fragment>
          );
        })}

        {/* Sea Areas (SEAARE) - Named bodies of water (bays, coves, straits)
            Rendered as text labels positioned at polygon centroids */}
        {showSeaNames && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          if (!chart.data.seaare || chart.data.seaare.features.length === 0) return null;
          
          // Filter to only features with names
          const namedFeatures = chart.data.seaare.features.filter(
            (f: any) => f.properties?.OBJNAM
          );
          
          if (namedFeatures.length === 0) return null;
          
          // Create point features at polygon centroids for labeling
          const labelPoints = namedFeatures.map((f: any) => {
            // Calculate centroid of polygon
            let coords = f.geometry?.coordinates;
            if (!coords) return null;
            
            // Handle Polygon vs MultiPolygon
            if (f.geometry.type === 'MultiPolygon') {
              coords = coords[0]; // Use first polygon
            }
            if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
              const ring = coords[0]; // Outer ring
              let sumX = 0, sumY = 0;
              for (const pt of ring) {
                sumX += pt[0];
                sumY += pt[1];
              }
              const centroid = [sumX / ring.length, sumY / ring.length];
              return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: centroid },
                properties: f.properties,
              };
            }
            return null;
          }).filter(Boolean);
          
          console.log(`[SEAARE] ${chartKey}: ${labelPoints.length} named sea areas`);
          // Debug: log first few label positions
          labelPoints.slice(0, 3).forEach((lp: any) => {
            console.log(`  - ${lp.properties.OBJNAM}: [${lp.geometry.coordinates[0].toFixed(4)}, ${lp.geometry.coordinates[1].toFixed(4)}]`);
          });
          
          return (
            <Mapbox.ShapeSource
              key={`seaare-${chartKey}`}
              id={`seaare-source-${chartKey}`}
              shape={{ type: 'FeatureCollection', features: labelPoints }}
              minZoomLevel={chart.minZoom}
              hitbox={{ width: 60, height: 20 }}
              onPress={(e) => {
                if (e.features && e.features.length > 0) {
                  const feat = e.features[0];
                  setSelectedFeature({
                    layerType: 'Sea Area',
                    chartKey: chartKey,
                    properties: feat.properties || {},
                  });
                }
              }}
            >
              <Mapbox.SymbolLayer
                id={`seaare-labels-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  textField: ['get', 'OBJNAM'],
                  textSize: [
                    'interpolate', ['linear'], ['zoom'],
                    8, 12,
                    14, 18,
                  ],
                  textColor: '#0D47A1',  // Darker blue for visibility
                  textHaloColor: 'white',
                  textHaloWidth: 2,
                  textFont: ['Open Sans Bold'],
                  textLetterSpacing: 0.15,
                  textAllowOverlap: true,  // Allow overlap to ensure visibility
                  textIgnorePlacement: true,
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Depth Contours - DEBUG: Color-coded by chart source
            SCAMIN controls when contours appear - MUTUALLY EXCLUSIVE zoom bands
            More detailed contours REPLACE less detailed ones at higher zoom */}
        {showDepthContours && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          const debugColor = DEBUG_COLORS[chartKey];
          return (
            <Mapbox.ShapeSource
              key={`depcnt-${chartKey}`}
              id={`contours-source-${chartKey}`}
              shape={chart.data.depcnt}
              minZoomLevel={chart.minZoom}
            >
              <Mapbox.LineLayer
                id={`depth-contours-${chartKey}`}
                minZoomLevel={chart.minZoom}
                filter={[
                  'any',
                  // Harbor scale (SCAMIN <= 50000) -> zoom 15+ ONLY
                  ['all', ['<=', ['get', 'SCAMIN'], 50000], ['>=', ['zoom'], 15]],
                  // Approach detail (50000 < SCAMIN <= 100000) -> zoom 13-14 ONLY
                  ['all', ['>', ['get', 'SCAMIN'], 50000], ['<=', ['get', 'SCAMIN'], 100000], ['>=', ['zoom'], 13], ['<', ['zoom'], 15]],
                  // Approach scale (SCAMIN > 100000) -> zoom 11-12 ONLY
                  ['all', ['>', ['get', 'SCAMIN'], 100000], ['>=', ['zoom'], 11], ['<', ['zoom'], 13]],
                ]}
                style={{
                  // DEBUG: Use chart-specific color instead of depth-based
                  lineColor: debugColor,
                  lineWidth: 2,
                  lineOpacity: 0.9,
                }}
              />
              <Mapbox.SymbolLayer
                id={`contour-labels-${chartKey}`}
                minZoomLevel={chart.minZoom}
                filter={[
                  'any',
                  // Harbor scale (SCAMIN <= 50000) -> zoom 15+ ONLY
                  ['all', ['<=', ['get', 'SCAMIN'], 50000], ['>=', ['zoom'], 15]],
                  // Approach detail (50000 < SCAMIN <= 100000) -> zoom 13-14 ONLY
                  ['all', ['>', ['get', 'SCAMIN'], 50000], ['<=', ['get', 'SCAMIN'], 100000], ['>=', ['zoom'], 13], ['<', ['zoom'], 15]],
                  // Approach scale (SCAMIN > 100000) -> zoom 11-12 ONLY
                  ['all', ['>', ['get', 'SCAMIN'], 100000], ['>=', ['zoom'], 11], ['<', ['zoom'], 13]],
                ]}
                style={{
                  textField: ['concat', ['get', 'VALDCO'], 'm'],
                  textSize: [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    11, 14,
                    13, 18,
                    15, 22,
                    17, 26,
                  ],
                  // DEBUG: Use chart-specific color for labels too
                  textColor: debugColor,
                  textHaloColor: '#FFFFFF',
                  textHaloWidth: 2,
                  symbolPlacement: 'line',
                  textRotationAlignment: 'map',
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Soundings - ADDITIVE display (more soundings at higher zoom)
            All soundings shown once they reach their SCAMIN threshold
            Shallower soundings have higher display priority */}
        {showSoundings && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          return (
            <Mapbox.ShapeSource
              key={`soundg-${chartKey}`}
              id={`soundings-source-${chartKey}`}
              shape={chart.data.soundg}
              minZoomLevel={chart.minZoom}
            >
              <Mapbox.SymbolLayer
                id={`soundings-${chartKey}`}
                minZoomLevel={chart.minZoom}
                filter={[
                  // SCAMIN-based visibility - ADDITIVE (show more at higher zoom)
                  'any',
                  // Harbor scale (SCAMIN <= 20000) -> zoom 14+
                  ['all', ['<=', ['get', 'SCAMIN'], 20000], ['>=', ['zoom'], 14]],
                  // Approach detail (20000 < SCAMIN <= 30000) -> zoom 13+
                  ['all', ['>', ['get', 'SCAMIN'], 20000], ['<=', ['get', 'SCAMIN'], 30000], ['>=', ['zoom'], 13]],
                  // Approach scale (SCAMIN > 30000) -> zoom 12+
                  ['all', ['>', ['get', 'SCAMIN'], 30000], ['>=', ['zoom'], 12]],
                ]}
                style={{
                  // Format depth to 1 decimal place
                  textField: [
                    'number-format',
                    ['get', 'DEPTH'],
                    { 'min-fraction-digits': 1, 'max-fraction-digits': 1 }
                  ],
                  textSize: [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    12, 9,
                    14, 11,
                    16, 13,
                    18, 15,
                  ],
                  textFont: ['DIN Pro Medium', 'Arial Unicode MS Regular'],
                  // Depth-based coloring: shallower = more prominent
                  textColor: [
                    'step',
                    ['get', 'DEPTH'],
                    '#CC0000',  // 0-5m: Red (danger)
                    5, '#0066CC',  // 5-10m: Blue
                    10, '#0052A3', // 10-20m: Darker blue
                    20, '#555555', // 20m+: Dark gray
                  ],
                  textHaloColor: '#FFFFFF',
                  textHaloWidth: 1.5,
                  // Priority: shallower depths shown first (lower sortKey = higher priority)
                  symbolSortKey: ['get', 'DEPTH'],
                  // Collision detection - don't overlap text
                  textAllowOverlap: false,
                  textIgnorePlacement: false,
                  // Don't hide soundings - always try to show them
                  textOptional: false,
                  // Reduced padding for denser display
                  textPadding: 1,
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Landmarks - Towers, monuments, and other conspicuous structures */}
        {showLandmarks && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          if (!chart.data.landmarks) return null;
          return (
            <Mapbox.ShapeSource
              key={`landmarks-${chartKey}`}
              id={`landmarks-source-${chartKey}`}
              shape={chart.data.landmarks}
              minZoomLevel={chart.minZoom}
              hitbox={{ width: 44, height: 44 }}
              onPress={(e) => {
                if (e.features && e.features.length > 0) {
                  const feat = e.features[0];
                  setSelectedFeature({
                    layerType: 'Landmark',
                    chartKey: chartKey,
                    properties: feat.properties || {},
                  });
                }
              }}
            >
              <Mapbox.SymbolLayer
                id={`landmarks-symbol-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  // Select icon based on CATLMK (category of landmark)
                  iconImage: [
                    'match',
                    ['to-string', ['at', 0, ['get', 'CATLMK']]],
                    '17', 'landmark-tower',      // Tower
                    '3', 'landmark-chimney',     // Chimney
                    '9', 'landmark-monument',    // Monument
                    '10', 'landmark-monument',   // Column/pillar
                    '5', 'landmark-flagpole',    // Flagstaff
                    '7', 'landmark-mast',        // Mast
                    '18', 'landmark-windmill',   // Windmill
                    '19', 'landmark-windmill',   // Windmotor
                    '2', 'landmark-church',      // Cemetery (use church)
                    'landmark-tower',            // Default: tower
                  ],
                  iconSize: [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 0.4,
                    14, 0.6,
                    18, 0.8,
                  ],
                  iconAnchor: 'bottom',  // Anchor at base for proper light alignment
                  iconAllowOverlap: true,
                }}
              />
              {/* Landmark name label at higher zoom */}
              <Mapbox.SymbolLayer
                id={`landmarks-label-${chartKey}`}
                minZoomLevel={14}
                style={{
                  textField: ['get', 'OBJNAM'],
                  textSize: 10,
                  textFont: ['DIN Pro Medium', 'Arial Unicode MS Regular'],
                  textColor: '#000000',
                  textHaloColor: '#FFFFFF',
                  textHaloWidth: 1.5,
                  textOffset: [0, 1.5],
                  textAnchor: 'top',
                  textAllowOverlap: false,
                  textOptional: true,
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Buoys - Navigation buoys with shape-based symbols */}
        {showBuoys && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          if (!chart.data.buoys) return null;
          return (
            <Mapbox.ShapeSource
              key={`buoys-${chartKey}`}
              id={`buoys-source-${chartKey}`}
              shape={chart.data.buoys}
              minZoomLevel={chart.minZoom}
              hitbox={{ width: 44, height: 44 }}
              onPress={(e) => {
                if (e.features && e.features.length > 0) {
                  const feat = e.features[0];
                  setSelectedFeature({
                    layerType: 'Buoy',
                    chartKey: chartKey,
                    properties: feat.properties || {},
                  });
                }
              }}
            >
              <Mapbox.SymbolLayer
                id={`buoys-symbol-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  // Select icon based on BOYSHP (buoy shape) attribute
                  iconImage: [
                    'match',
                    ['to-string', ['get', 'BOYSHP']],
                    '1', 'buoy-conical',    // Conical/nun
                    '2', 'buoy-can',        // Can/cylindrical
                    '3', 'buoy-spherical',  // Spherical
                    '4', 'buoy-pillar',     // Pillar
                    '5', 'buoy-spar',       // Spar
                    '6', 'buoy-barrel',     // Barrel
                    '7', 'buoy-super',      // Super-buoy
                    'buoy-pillar',          // Default
                  ],
                  iconSize: [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 0.4,
                    14, 0.6,
                    18, 0.8,
                  ],
                  iconAnchor: 'bottom',  // Anchor at waterline for proper light alignment
                  iconAllowOverlap: true,
                }}
              />
              {/* Buoy name label at higher zoom */}
              <Mapbox.SymbolLayer
                id={`buoys-label-${chartKey}`}
                minZoomLevel={14}
                style={{
                  textField: ['get', 'OBJNAM'],
                  textSize: 10,
                  textFont: ['DIN Pro Medium', 'Arial Unicode MS Regular'],
                  textColor: '#000000',
                  textHaloColor: '#FFFFFF',
                  textHaloWidth: 1.5,
                  textOffset: [0, 1.5],
                  textAnchor: 'top',
                  textAllowOverlap: false,
                  textOptional: true,
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Beacons - Fixed navigation beacons with shape-based symbols */}
        {showBeacons && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          if (!chart.data.beacons) return null;
          return (
            <Mapbox.ShapeSource
              key={`beacons-${chartKey}`}
              id={`beacons-source-${chartKey}`}
              shape={chart.data.beacons}
              minZoomLevel={chart.minZoom}
              hitbox={{ width: 44, height: 44 }}
              onPress={(e) => {
                if (e.features && e.features.length > 0) {
                  const feat = e.features[0];
                  setSelectedFeature({
                    layerType: 'Beacon',
                    chartKey: chartKey,
                    properties: feat.properties || {},
                  });
                }
              }}
            >
              <Mapbox.SymbolLayer
                id={`beacons-symbol-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  // Select icon based on BCNSHP (beacon shape) attribute
                  iconImage: [
                    'match',
                    ['to-string', ['get', 'BCNSHP']],
                    '1', 'beacon-stake',    // Stake/pole
                    '2', 'beacon-withy',    // Withy
                    '3', 'beacon-tower',    // Tower
                    '4', 'beacon-lattice',  // Lattice
                    '6', 'beacon-cairn',    // Cairn
                    'beacon-generic',       // Default
                  ],
                  iconSize: [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 0.4,
                    14, 0.6,
                    18, 0.8,
                  ],
                  iconAnchor: 'bottom',  // Anchor at base for proper light alignment
                  iconAllowOverlap: true,
                }}
              />
              {/* Beacon name label at higher zoom */}
              <Mapbox.SymbolLayer
                id={`beacons-label-${chartKey}`}
                minZoomLevel={14}
                style={{
                  textField: ['get', 'OBJNAM'],
                  textSize: 10,
                  textFont: ['DIN Pro Medium', 'Arial Unicode MS Regular'],
                  textColor: '#000000',
                  textHaloColor: '#FFFFFF',
                  textHaloWidth: 1.5,
                  textOffset: [0, 1.5],
                  textAnchor: 'top',
                  textAllowOverlap: false,
                  textOptional: true,
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Hazards: Wrecks - Point features showing shipwrecks */}
        {showHazards && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          if (!chart.data.wrecks || chart.data.wrecks.features.length === 0) return null;
          return (
            <Mapbox.ShapeSource
              key={`wrecks-${chartKey}`}
              id={`wrecks-source-${chartKey}`}
              shape={chart.data.wrecks}
              minZoomLevel={chart.minZoom}
              hitbox={{ width: 44, height: 44 }}
              onPress={(e) => {
                if (e.features && e.features.length > 0) {
                  const feat = e.features[0];
                  setSelectedFeature({
                    layerType: 'Wreck',
                    chartKey: chartKey,
                    properties: feat.properties || {},
                  });
                }
              }}
            >
              <Mapbox.SymbolLayer
                id={`wrecks-symbol-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  // Select icon based on CATWRK (category) and WATLEV (water level)
                  iconImage: [
                    'case',
                    // Hull showing (CATWRK=5)
                    ['==', ['to-number', ['get', 'CATWRK']], 5], 'wreck-hull',
                    // Mast showing (CATWRK=4) or covers/uncovers (WATLEV=4)
                    ['any',
                      ['==', ['to-number', ['get', 'CATWRK']], 4],
                      ['==', ['to-number', ['get', 'WATLEV']], 4]
                    ], 'wreck-uncovers',
                    // Not dangerous (CATWRK=1)
                    ['==', ['to-number', ['get', 'CATWRK']], 1], 'wreck-safe',
                    // Dangerous submerged (CATWRK=2) or always submerged (WATLEV=3)
                    ['any',
                      ['==', ['to-number', ['get', 'CATWRK']], 2],
                      ['==', ['to-number', ['get', 'WATLEV']], 3]
                    ], 'wreck-submerged',
                    // Default: dangerous wreck
                    'wreck-danger',
                  ],
                  iconSize: [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 0.5,
                    14, 0.7,
                    18, 0.9,
                  ],
                  iconAllowOverlap: true,
                }}
              />
              {/* Depth label for wrecks with known depth */}
              <Mapbox.SymbolLayer
                id={`wrecks-label-${chartKey}`}
                minZoomLevel={14}
                filter={['has', 'VALSOU']}
                style={{
                  textField: ['concat', ['number-format', ['get', 'VALSOU'], {'min-fraction-digits': 1, 'max-fraction-digits': 1}], 'm'],
                  textSize: 9,
                  textFont: ['DIN Pro Medium', 'Arial Unicode MS Regular'],
                  textColor: '#000000',
                  textHaloColor: '#FFFFFF',
                  textHaloWidth: 1.5,
                  textOffset: [0, 1.5],
                  textAnchor: 'top',
                  textAllowOverlap: false,
                  textOptional: true,
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Hazards: Rocks - Point features showing underwater rocks */}
        {showHazards && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          if (!chart.data.rocks || chart.data.rocks.features.length === 0) return null;
          return (
            <Mapbox.ShapeSource
              key={`rocks-${chartKey}`}
              id={`rocks-source-${chartKey}`}
              shape={chart.data.rocks}
              minZoomLevel={chart.minZoom}
              hitbox={{ width: 44, height: 44 }}
              onPress={(e) => {
                if (e.features && e.features.length > 0) {
                  const feat = e.features[0];
                  setSelectedFeature({
                    layerType: 'Rock',
                    chartKey: chartKey,
                    properties: feat.properties || {},
                  });
                }
              }}
            >
              <Mapbox.SymbolLayer
                id={`rocks-symbol-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  // Select icon based on WATLEV (water level effect)
                  iconImage: [
                    'match',
                    ['to-number', ['get', 'WATLEV']],
                    1, 'rock-above-water',   // Partly submerged at high water
                    2, 'rock-above-water',   // Always dry
                    3, 'rock-submerged',     // Always underwater
                    4, 'rock-uncovers',      // Covers and uncovers
                    5, 'rock-awash',         // Awash
                    'rock-submerged',        // Default: submerged
                  ],
                  iconSize: [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 0.4,
                    14, 0.6,
                    18, 0.8,
                  ],
                  iconAllowOverlap: true,
                }}
              />
              {/* Depth label for rocks with known depth */}
              <Mapbox.SymbolLayer
                id={`rocks-label-${chartKey}`}
                minZoomLevel={15}
                filter={['has', 'VALSOU']}
                style={{
                  textField: ['concat', ['number-format', ['get', 'VALSOU'], {'min-fraction-digits': 1, 'max-fraction-digits': 1}], 'm'],
                  textSize: 8,
                  textFont: ['DIN Pro Medium', 'Arial Unicode MS Regular'],
                  textColor: '#CC0000',
                  textHaloColor: '#FFFFFF',
                  textHaloWidth: 1.5,
                  textOffset: [0, 1.2],
                  textAnchor: 'top',
                  textAllowOverlap: false,
                  textOptional: true,
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Hazards: Obstructions - Polygon features only (kelp beds, foul ground areas)
            Point obstructions are handled separately below */}
        {showHazards && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          if (!chart.data.obstructions || chart.data.obstructions.features.length === 0) return null;
          
          // Only render polygon obstructions here
          const polygonFeatures = chart.data.obstructions.features.filter(
            (f: any) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
          );
          
          if (polygonFeatures.length === 0) {
            console.log(`[OBSTRN-POLY] ${chartKey}: No polygon features`);
            return null;
          }
          
          console.log(`[OBSTRN-POLY] ${chartKey}: Rendering ${polygonFeatures.length} polygon features`);
          
          return (
            <Mapbox.ShapeSource
              key={`obstructions-poly-${chartKey}`}
              id={`obstructions-poly-source-${chartKey}`}
              shape={{ type: 'FeatureCollection', features: polygonFeatures }}
              minZoomLevel={chart.minZoom}
              onPress={(e) => {
                if (e.features && e.features.length > 0) {
                  const feat = e.features[0];
                  setSelectedFeature({
                    layerType: 'Obstruction',
                    chartKey: chartKey,
                    properties: feat.properties || {},
                  });
                }
              }}
            >
              <Mapbox.FillLayer
                id={`obstructions-fill-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  fillColor: [
                    'match',
                    ['to-number', ['get', 'CATOBS']],
                    6, 'rgba(0, 128, 0, 0.2)',  // Foul ground - green tint
                    'rgba(128, 0, 128, 0.15)', // Other - purple tint
                  ],
                  fillOutlineColor: [
                    'match',
                    ['to-number', ['get', 'CATOBS']],
                    6, '#006400',  // Foul ground - dark green
                    '#800080',     // Other - purple
                  ],
                }}
              />
              <Mapbox.LineLayer
                id={`obstructions-outline-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  lineColor: [
                    'match',
                    ['to-number', ['get', 'CATOBS']],
                    6, '#006400',  // Foul ground
                    '#800080',     // Other
                  ],
                  lineWidth: 1,
                  lineDasharray: [4, 2],
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Hazards: Obstructions - Point features only */}
        {showHazards && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          if (!chart.data.obstructions || chart.data.obstructions.features.length === 0) return null;
          
          // Only render point obstructions here
          const pointFeatures = chart.data.obstructions.features.filter(
            (f: any) => f.geometry && f.geometry.type === 'Point'
          );
          
          if (pointFeatures.length === 0) {
            console.log(`[OBSTRN-POINT] ${chartKey}: No point features`);
            return null;
          }
          
          console.log(`[OBSTRN-POINT] ${chartKey}: Rendering ${pointFeatures.length} point features`);
          
          return (
            <Mapbox.ShapeSource
              key={`obstructions-point-${chartKey}`}
              id={`obstructions-point-source-${chartKey}`}
              shape={{ type: 'FeatureCollection', features: pointFeatures }}
              minZoomLevel={chart.minZoom}
              hitbox={{ width: 44, height: 44 }}
              onPress={(e) => {
                if (e.features && e.features.length > 0) {
                  const feat = e.features[0];
                  setSelectedFeature({
                    layerType: 'Obstruction',
                    chartKey: chartKey,
                    properties: feat.properties || {},
                  });
                }
              }}
            >
              <Mapbox.SymbolLayer
                id={`obstructions-symbol-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  iconImage: [
                    'match',
                    ['to-number', ['get', 'CATOBS']],
                    6, 'foul-ground',  // Foul ground/kelp
                    'obstruction',     // Default obstruction
                  ],
                  iconSize: [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 0.4,
                    14, 0.6,
                    18, 0.8,
                  ],
                  iconAllowOverlap: true,
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Light Sectors - Colored lines showing sector boundaries
            S-57 SECTR1/SECTR2 are "from seaward" so we add 180° to show projection direction
            Rendered before lights so light symbols appear on top */}
        {showSectors && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          const sectors = sectorData[chartKey];
          if (!sectors || sectors.features.length === 0) return null;
          return (
            <Mapbox.ShapeSource
              key={`sectors-${chartKey}`}
              id={`sectors-source-${chartKey}`}
              shape={sectors}
              minZoomLevel={chart.minZoom}
            >
              {/* Sector boundary lines - colored by light color */}
              <Mapbox.LineLayer
                id={`sectors-line-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  lineColor: [
                    'match',
                    ['get', 'colour'],
                    '1', '#DAA520',    // White/yellow -> goldenrod
                    '3', '#DC143C',    // Red -> crimson
                    '4', '#228B22',    // Green -> forest green
                    '6', '#FFD700',    // Yellow -> gold
                    '#BA55D3',         // Default: magenta
                  ],
                  lineWidth: [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    12, 2,
                    16, 3,
                  ],
                  lineDasharray: [6, 3],
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}

        {/* Lights - Navigation lights using S-52 standard symbols
            COLOUR codes: 1=white, 3=red, 4=green
            Uses Light_Flare symbols rotated based on ORIENT/SECTR attributes
            Rendered on top of other features for visibility */}
        {showLights && CHART_RENDER_ORDER.map((chartKey) => {
          const chart = CHARTS[chartKey];
          if (!chart.data.lights) return null;
          return (
            <Mapbox.ShapeSource
              key={`lights-${chartKey}`}
              id={`lights-source-${chartKey}`}
              shape={chart.data.lights}
              minZoomLevel={chart.minZoom}
              hitbox={{ width: 44, height: 44 }}
              onPress={(e) => {
                console.log('Light tapped!', chartKey);
                if (e.features && e.features.length > 0) {
                  const feat = e.features[0];
                  console.log('Light feature:', JSON.stringify(feat.properties, null, 2));
                  setSelectedFeature({
                    layerType: 'Light',
                    chartKey: chartKey,
                    properties: feat.properties || {},
                  });
                }
              }}
            >
              {/* Invisible tap target - larger circle for easier selection */}
              <Mapbox.CircleLayer
                id={`lights-tap-target-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  circleRadius: 20,
                  circleColor: 'transparent',
                  circleOpacity: 0,
                }}
              />
              {/* S-52 Light Flare Symbol - colored by light color */}
              <Mapbox.SymbolLayer
                id={`lights-symbol-${chartKey}`}
                minZoomLevel={chart.minZoom}
                style={{
                  // Select icon based on S-57 COLOUR attribute
                  // COLOUR is an array, first element determines primary color
                  iconImage: [
                    'match',
                    ['to-string', ['at', 0, ['get', 'COLOUR']]],
                    '1', 'light-flare-white',   // White
                    '6', 'light-flare-white',   // Yellow (use white icon)
                    '9', 'light-flare-white',   // Amber (use white icon)
                    '11', 'light-flare-white',  // Orange (use white icon)
                    '3', 'light-flare-red',     // Red
                    '4', 'light-flare-green',   // Green
                    'light-flare-magenta',      // Default: Magenta
                  ],
                  // Size scales with zoom
                  iconSize: [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 0.4,
                    14, 0.6,
                    18, 0.8,
                  ],
                  // Rotate based on ORIENT (light orientation) or default to 135° (SW pointing)
                  // S-52 standard: flare points in direction of light sector
                  iconRotate: [
                    'case',
                    ['has', 'ORIENT'],
                    ['-', ['to-number', ['get', 'ORIENT']], 180],  // ORIENT is direction light faces
                    ['has', 'SECTR1'],
                    // For sector lights, point to middle of sector
                    ['-', 
                      ['/', ['+', ['to-number', ['get', 'SECTR1']], ['to-number', ['coalesce', ['get', 'SECTR2'], ['get', 'SECTR1']]]], 2],
                      180
                    ],
                    135,  // Default: point SW (standard chart convention)
                  ],
                  iconRotationAlignment: 'map',
                  iconAnchor: 'bottom',  // Anchor at tip so flare emanates from structure
                  iconAllowOverlap: true,
                  iconIgnorePlacement: false,
                }}
              />
              {/* Light characteristic label (shows at higher zoom) */}
              <Mapbox.SymbolLayer
                id={`lights-label-${chartKey}`}
                minZoomLevel={14}
                style={{
                  // Build light description string: "Fl(1) 4s 8m 5M"
                  // LITCHR: characteristic, SIGPER: period, HEIGHT: height, VALNMR: range
                  textField: [
                    'case',
                    ['has', 'SIGPER'],
                    ['concat', ['get', 'SIGPER'], 's'],
                    '',
                  ],
                  textSize: [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    14, 9,
                    18, 12,
                  ],
                  textFont: ['DIN Pro Medium', 'Arial Unicode MS Regular'],
                  textColor: '#000000',
                  textHaloColor: '#FFFFFF',
                  textHaloWidth: 1.5,
                  textOffset: [0, 1.2],
                  textAnchor: 'top',
                  textAllowOverlap: false,
                  textOptional: true,  // Hide label if it collides
                }}
              />
            </Mapbox.ShapeSource>
          );
        })}
      </Mapbox.MapView>

      {/* DEBUG: Info Panel */}
      <View style={styles.debugPanel}>
        <Text style={styles.debugTitle}>DEBUG INFO</Text>
        <Text style={styles.debugText}>Zoom: {currentZoom.toFixed(1)}</Text>
        <Text style={styles.debugSubtitle}>Active SCAMIN Band:</Text>
        <Text style={[styles.debugText, { color: scaminStatus.approach ? '#FF9800' : '#555' }]}>
          Approach (z11-12): {scaminStatus.approach ? 'ACTIVE' : 'off'}
        </Text>
        <Text style={[styles.debugText, { color: scaminStatus.approachDetail ? '#9C27B0' : '#555' }]}>
          Detail (z13-14): {scaminStatus.approachDetail ? 'ACTIVE' : 'off'}
        </Text>
        <Text style={[styles.debugText, { color: scaminStatus.harbor ? '#4CAF50' : '#555' }]}>
          Harbor (z15+): {scaminStatus.harbor ? 'ACTIVE' : 'off'}
        </Text>
        
        <Text style={styles.debugSubtitle}>Active Charts:</Text>
        {CHART_RENDER_ORDER.map(key => {
          const isActive = activeCharts.includes(key);
          const color = DEBUG_COLORS[key];
          return (
            <View key={key} style={styles.chartIndicator}>
              <View style={[styles.chartColorDot, { backgroundColor: color, opacity: isActive ? 1 : 0.3 }]} />
              <Text style={[styles.debugText, { color: isActive ? '#333' : '#999' }]}>
                {CHARTS[key].shortName}
              </Text>
            </View>
          );
        })}

        <TouchableOpacity
          style={[styles.debugButton, showBoundaries && styles.debugButtonActive]}
          onPress={() => setShowBoundaries(!showBoundaries)}
        >
          <Text style={styles.debugButtonText}>
            {showBoundaries ? 'Hide' : 'Show'} Bounds
          </Text>
        </TouchableOpacity>
      </View>

      {/* DEBUG: Feature Counts */}
      <View style={styles.featureCountPanel}>
        <Text style={styles.debugTitle}>FEATURES</Text>
        {CHART_RENDER_ORDER.map(key => {
          const color = DEBUG_COLORS[key];
          const counts = featureCounts[key];
          const isActive = activeCharts.includes(key);
          return (
            <View key={key} style={{ opacity: isActive ? 1 : 0.4 }}>
              <Text style={[styles.featureCountLabel, { color }]}>
                {CHARTS[key].shortName}
              </Text>
              <Text style={styles.featureCountText}>
                {counts.contours} cnt / {counts.soundings} snd / {counts.lights} lt
              </Text>
            </View>
          );
        })}
      </View>

      {/* DEBUG: Feature Inspector (tap-to-inspect) */}
      {selectedFeature && (
        <View style={styles.featureInspector}>
          <View style={styles.inspectorHeader}>
            <Text style={styles.inspectorTitle}>
              {selectedFeature.layerType === 'Light' ? '💡 LIGHT INFO' : 
               selectedFeature.layerType === 'Buoy' ? '🔴 BUOY INFO' :
               selectedFeature.layerType === 'Beacon' ? '🔺 BEACON INFO' :
               selectedFeature.layerType === 'Landmark' ? '🗼 LANDMARK INFO' :
               selectedFeature.layerType === 'Wreck' ? '⚓ WRECK INFO' :
               selectedFeature.layerType === 'Rock' ? '🪨 ROCK INFO' :
               selectedFeature.layerType === 'Obstruction' ? '⚠️ OBSTRUCTION' :
               selectedFeature.layerType === 'Shoreline' ? '🏗️ SHORELINE' :
               selectedFeature.layerType === 'Cable Area' ? '⚡ CABLE AREA' :
               selectedFeature.layerType === 'Seabed' ? '⚓ SEABED' :
               selectedFeature.layerType === 'Sea Area' ? '🌊 SEA AREA' :
               selectedFeature.layerType === 'Pipeline' ? '🔵 PIPELINE' :
               'FEATURE INSPECTOR'}
            </Text>
            <TouchableOpacity onPress={() => setSelectedFeature(null)}>
              <Text style={styles.inspectorClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.inspectorScroll}>
            <Text style={styles.inspectorLabel}>Type: {selectedFeature.layerType}</Text>
            <Text style={[styles.inspectorLabel, { color: DEBUG_COLORS[selectedFeature.chartKey as ChartKey] || '#333' }]}>
              Chart: {selectedFeature.chartKey}
            </Text>
            
            {/* Special formatted display for Lights */}
            {selectedFeature.layerType === 'Light' && (
              <>
                <Text style={styles.inspectorSubtitle}>Light Details:</Text>
                {Object.entries(formatLightInfo(selectedFeature.properties)).map(([key, value]) => (
                  <View key={key} style={styles.inspectorRow}>
                    <Text style={styles.inspectorPropKey}>{key}:</Text>
                    <Text style={styles.inspectorPropValue}>{value}</Text>
                  </View>
                ))}
              </>
            )}
            
            {/* Special formatted display for Buoys */}
            {selectedFeature.layerType === 'Buoy' && (
              <>
                <Text style={styles.inspectorSubtitle}>Buoy Details:</Text>
                {Object.entries(formatBuoyInfo(selectedFeature.properties)).map(([key, value]) => (
                  <View key={key} style={styles.inspectorRow}>
                    <Text style={styles.inspectorPropKey}>{key}:</Text>
                    <Text style={styles.inspectorPropValue}>{value}</Text>
                  </View>
                ))}
              </>
            )}
            
            {/* Special formatted display for Beacons */}
            {selectedFeature.layerType === 'Beacon' && (
              <>
                <Text style={styles.inspectorSubtitle}>Beacon Details:</Text>
                {Object.entries(formatBeaconInfo(selectedFeature.properties)).map(([key, value]) => (
                  <View key={key} style={styles.inspectorRow}>
                    <Text style={styles.inspectorPropKey}>{key}:</Text>
                    <Text style={styles.inspectorPropValue}>{value}</Text>
                  </View>
                ))}
              </>
            )}
            
            {/* Special formatted display for Landmarks */}
            {selectedFeature.layerType === 'Landmark' && (
              <>
                <Text style={styles.inspectorSubtitle}>Landmark Details:</Text>
                {Object.entries(formatLandmarkInfo(selectedFeature.properties)).map(([key, value]) => (
                  <View key={key} style={styles.inspectorRow}>
                    <Text style={styles.inspectorPropKey}>{key}:</Text>
                    <Text style={styles.inspectorPropValue}>{value}</Text>
                  </View>
                ))}
              </>
            )}
            
            {/* Special formatted display for Wrecks */}
            {selectedFeature.layerType === 'Wreck' && (
              <>
                <Text style={styles.inspectorSubtitle}>Wreck Details:</Text>
                {Object.entries(formatWreckInfo(selectedFeature.properties)).map(([key, value]) => (
                  <View key={key} style={styles.inspectorRow}>
                    <Text style={styles.inspectorPropKey}>{key}:</Text>
                    <Text style={styles.inspectorPropValue}>{value}</Text>
                  </View>
                ))}
              </>
            )}
            
            {/* Special formatted display for Rocks */}
            {selectedFeature.layerType === 'Rock' && (
              <>
                <Text style={styles.inspectorSubtitle}>Rock Details:</Text>
                {Object.entries(formatRockInfo(selectedFeature.properties)).map(([key, value]) => (
                  <View key={key} style={styles.inspectorRow}>
                    <Text style={styles.inspectorPropKey}>{key}:</Text>
                    <Text style={styles.inspectorPropValue}>{value}</Text>
                  </View>
                ))}
              </>
            )}
            
            {/* Special formatted display for Obstructions */}
            {selectedFeature.layerType === 'Obstruction' && (
              <>
                <Text style={styles.inspectorSubtitle}>Obstruction Details:</Text>
                {Object.entries(formatObstructionInfo(selectedFeature.properties)).map(([key, value]) => (
                  <View key={key} style={styles.inspectorRow}>
                    <Text style={styles.inspectorPropKey}>{key}:</Text>
                    <Text style={styles.inspectorPropValue}>{value}</Text>
                  </View>
                ))}
              </>
            )}
            
            {/* Special formatted display for Shoreline Constructions */}
            {selectedFeature.layerType === 'Shoreline' && (
              <>
                <Text style={styles.inspectorSubtitle}>Shoreline Construction:</Text>
                {Object.entries(formatSlconsInfo(selectedFeature.properties)).map(([key, value]) => (
                  <View key={key} style={styles.inspectorRow}>
                    <Text style={styles.inspectorPropKey}>{key}:</Text>
                    <Text style={styles.inspectorPropValue}>{value}</Text>
                  </View>
                ))}
              </>
            )}
            
            {/* Special formatted display for Cable Areas */}
            {selectedFeature.layerType === 'Cable Area' && (
              <>
                <Text style={styles.inspectorSubtitle}>Cable Area Details:</Text>
                {Object.entries(formatCblareInfo(selectedFeature.properties)).map(([key, value]) => (
                  <View key={key} style={styles.inspectorRow}>
                    <Text style={styles.inspectorPropKey}>{key}:</Text>
                    <Text style={styles.inspectorPropValue}>{value}</Text>
                  </View>
                ))}
              </>
            )}
            
            {/* Special formatted display for Seabed Areas */}
            {selectedFeature.layerType === 'Seabed' && (
              <>
                <Text style={styles.inspectorSubtitle}>Seabed Details:</Text>
                {Object.entries(formatSbdareInfo(selectedFeature.properties)).map(([key, value]) => (
                  <View key={key} style={styles.inspectorRow}>
                    <Text style={styles.inspectorPropKey}>{key}:</Text>
                    <Text style={styles.inspectorPropValue}>{value}</Text>
                  </View>
                ))}
              </>
            )}
            
            {/* Special formatted display for Sea Areas */}
            {selectedFeature.layerType === 'Sea Area' && (
              <>
                <Text style={styles.inspectorSubtitle}>Sea Area Details:</Text>
                {Object.entries(formatSeaareInfo(selectedFeature.properties)).map(([key, value]) => (
                  <View key={key} style={styles.inspectorRow}>
                    <Text style={styles.inspectorPropKey}>{key}:</Text>
                    <Text style={styles.inspectorPropValue}>{value}</Text>
                  </View>
                ))}
              </>
            )}
            
            {/* Special formatted display for Pipelines */}
            {selectedFeature.layerType === 'Pipeline' && (
              <>
                <Text style={styles.inspectorSubtitle}>Pipeline Details:</Text>
                {Object.entries(formatPipsolInfo(selectedFeature.properties)).map(([key, value]) => (
                  <View key={key} style={styles.inspectorRow}>
                    <Text style={styles.inspectorPropKey}>{key}:</Text>
                    <Text style={styles.inspectorPropValue}>{value}</Text>
                  </View>
                ))}
              </>
            )}
            
            {/* Raw properties for other features or additional data */}
            {(selectedFeature.layerType === 'Light' || 
              selectedFeature.layerType === 'Buoy' || 
              selectedFeature.layerType === 'Beacon' ||
              selectedFeature.layerType === 'Landmark' ||
              selectedFeature.layerType === 'Wreck' ||
              selectedFeature.layerType === 'Rock' ||
              selectedFeature.layerType === 'Obstruction' ||
              selectedFeature.layerType === 'Shoreline' ||
              selectedFeature.layerType === 'Cable Area' ||
              selectedFeature.layerType === 'Seabed' ||
              selectedFeature.layerType === 'Sea Area' ||
              selectedFeature.layerType === 'Pipeline') ? (
              <>
                <Text style={[styles.inspectorSubtitle, { marginTop: 10 }]}>Raw S-57 Data:</Text>
                {Object.entries(selectedFeature.properties)
                  .filter(([key]) => !['layerId'].includes(key))
                  .slice(0, 8)
                  .map(([key, value]) => (
                  <Text key={key} style={styles.inspectorProp}>
                    {key}: {String(value)}
                  </Text>
                ))}
              </>
            ) : (
              <>
                <Text style={styles.inspectorSubtitle}>Properties:</Text>
                {Object.entries(selectedFeature.properties).map(([key, value]) => (
                  <Text key={key} style={styles.inspectorProp}>
                    {key}: {String(value)}
                  </Text>
                ))}
              </>
            )}
          </ScrollView>
        </View>
      )}

      {/* Layer Controls */}
      <View style={styles.layerControl}>
        <Text style={styles.layerControlTitle}>Chart Layers</Text>
        <TouchableOpacity
          style={[styles.layerButton, showLand && styles.layerButtonActive]}
          onPress={() => setShowLand(!showLand)}
        >
          <Text style={[styles.layerButtonText, showLand && styles.layerButtonTextActive]}>
            Land
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, showDepthAreas && styles.layerButtonActive]}
          onPress={() => setShowDepthAreas(!showDepthAreas)}
        >
          <Text style={[styles.layerButtonText, showDepthAreas && styles.layerButtonTextActive]}>
            Depth Areas
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, showDepthContours && styles.layerButtonActive]}
          onPress={() => setShowDepthContours(!showDepthContours)}
        >
          <Text style={[styles.layerButtonText, showDepthContours && styles.layerButtonTextActive]}>
            Contours
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, showSoundings && styles.layerButtonActive]}
          onPress={() => setShowSoundings(!showSoundings)}
        >
          <Text style={[styles.layerButtonText, showSoundings && styles.layerButtonTextActive]}>
            Soundings
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, showLights && styles.layerButtonActive]}
          onPress={() => setShowLights(!showLights)}
        >
          <Text style={[styles.layerButtonText, showLights && styles.layerButtonTextActive]}>
            Lights
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, showSectors && styles.layerButtonActive]}
          onPress={() => setShowSectors(!showSectors)}
        >
          <Text style={[styles.layerButtonText, showSectors && styles.layerButtonTextActive]}>
            Sectors
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, showBuoys && styles.layerButtonActive]}
          onPress={() => setShowBuoys(!showBuoys)}
        >
          <Text style={[styles.layerButtonText, showBuoys && styles.layerButtonTextActive]}>
            Buoys
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, showBeacons && styles.layerButtonActive]}
          onPress={() => setShowBeacons(!showBeacons)}
        >
          <Text style={[styles.layerButtonText, showBeacons && styles.layerButtonTextActive]}>
            Beacons
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, showLandmarks && styles.layerButtonActive]}
          onPress={() => setShowLandmarks(!showLandmarks)}
        >
          <Text style={[styles.layerButtonText, showLandmarks && styles.layerButtonTextActive]}>
            Landmarks
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, showHazards && styles.layerButtonActive]}
          onPress={() => setShowHazards(!showHazards)}
        >
          <Text style={[styles.layerButtonText, showHazards && styles.layerButtonTextActive]}>
            Hazards
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, showSlcons && styles.layerButtonActive]}
          onPress={() => setShowSlcons(!showSlcons)}
        >
          <Text style={[styles.layerButtonText, showSlcons && styles.layerButtonTextActive]}>
            Piers
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, showCables && styles.layerButtonActive]}
          onPress={() => setShowCables(!showCables)}
        >
          <Text style={[styles.layerButtonText, showCables && styles.layerButtonTextActive]}>
            Cables
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, showSeabed && styles.layerButtonActive]}
          onPress={() => setShowSeabed(!showSeabed)}
        >
          <Text style={[styles.layerButtonText, showSeabed && styles.layerButtonTextActive]}>
            Seabed
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, showSeaNames && styles.layerButtonActive]}
          onPress={() => setShowSeaNames(!showSeaNames)}
        >
          <Text style={[styles.layerButtonText, showSeaNames && styles.layerButtonTextActive]}>
            Names
          </Text>
        </TouchableOpacity>
      </View>

      {/* Map Style Toggle */}
      <View style={styles.styleControl}>
        <Text style={styles.styleControlTitle}>Base Map</Text>
        <TouchableOpacity
          style={[styles.styleButton, showSatellite && styles.styleButtonActive]}
          onPress={() => setShowSatellite(!showSatellite)}
        >
          <Text style={[styles.styleButtonText, showSatellite && styles.styleButtonTextActive]}>
            {showSatellite ? 'Satellite' : 'Light'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.styleNote}>
          {showSatellite ? '(requires internet)' : '(offline)'}
        </Text>
      </View>

      {/* Status Badge */}
      <View style={styles.offlineBadge}>
        <Text style={styles.offlineBadgeText}>OFFLINE - Real S-57 Data</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    backgroundColor: '#4CAF50',
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    zIndex: 2000,
  },
  chartTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  chartInfo: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 4,
  },
  map: {
    flex: 1,
  },
  layerControl: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 130 : 90,
    left: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 12,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    minWidth: 120,
  },
  layerControlTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  layerButton: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ccc',
    marginBottom: 5,
  },
  layerButtonActive: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  layerButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
  },
  layerButtonTextActive: {
    color: 'white',
  },
  styleControl: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 130 : 90,
    right: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 12,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    minWidth: 120,
  },
  styleControlTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 6,
    color: '#333',
  },
  styleButton: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
  },
  styleButtonActive: {
    backgroundColor: '#FF9800',
    borderColor: '#FF9800',
  },
  styleButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#666',
  },
  styleButtonTextActive: {
    color: 'white',
  },
  styleNote: {
    fontSize: 8,
    color: '#999',
    marginTop: 4,
    textAlign: 'center',
  },
  offlineBadge: {
    position: 'absolute',
    bottom: 20,
    alignSelf: 'center',
    backgroundColor: '#4CAF50',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  offlineBadgeText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 11,
  },
  // Debug styles
  debugPanel: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 280 : 240,
    left: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    padding: 10,
    borderRadius: 8,
    minWidth: 140,
  },
  debugTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#FF9800',
    marginBottom: 6,
  },
  debugSubtitle: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#888',
    marginTop: 8,
    marginBottom: 4,
  },
  debugText: {
    fontSize: 10,
    color: '#fff',
    marginBottom: 2,
  },
  chartIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  chartColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  debugButton: {
    backgroundColor: '#333',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    marginTop: 8,
    alignItems: 'center',
  },
  debugButtonActive: {
    backgroundColor: '#FF9800',
  },
  debugButtonText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: 'bold',
  },
  featureCountPanel: {
    position: 'absolute',
    bottom: 60,
    left: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    padding: 10,
    borderRadius: 8,
    minWidth: 120,
  },
  featureCountLabel: {
    fontSize: 9,
    fontWeight: 'bold',
    marginTop: 4,
  },
  featureCountText: {
    fontSize: 9,
    color: '#ccc',
  },
  featureInspector: {
    position: 'absolute',
    bottom: 60,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    padding: 12,
    borderRadius: 10,
    maxWidth: 240,
    maxHeight: 320,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.3)',
  },
  inspectorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  inspectorTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#FF9800',
  },
  inspectorClose: {
    fontSize: 14,
    color: '#FF5722',
    fontWeight: 'bold',
    paddingHorizontal: 6,
  },
  inspectorScroll: {
    maxHeight: 260,
  },
  inspectorLabel: {
    fontSize: 10,
    color: '#fff',
    marginBottom: 4,
  },
  inspectorSubtitle: {
    fontSize: 9,
    color: '#888',
    marginTop: 6,
    marginBottom: 4,
  },
  inspectorProp: {
    fontSize: 9,
    color: '#aaa',
    marginBottom: 2,
  },
  inspectorRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  inspectorPropKey: {
    fontSize: 10,
    color: '#FFD700',
    fontWeight: 'bold',
    marginRight: 6,
    minWidth: 70,
  },
  inspectorPropValue: {
    fontSize: 10,
    color: '#fff',
    flex: 1,
  },
});

#!/usr/bin/env node
/**
 * S-57 to GeoJSON Converter CLI
 *
 * Replaces the GDAL-based conversion in convert.py with a pure TypeScript
 * S-57 parser. Reads a .000 file, produces GeoJSON with all post-processing
 * needed for the downstream tile pipeline.
 *
 * Usage: node dist/convert_s57.js <input.000> <output_dir>
 *
 * Outputs JSON metadata to stdout:
 *   {"geojson_path": "...", "has_safety_areas": true, "feature_count": 1234}
 *
 * All logging goes to stderr so stdout is clean JSON for the caller.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseISO8211 } from './parsers/iso8211';
import { decodeS57 } from './parsers/s57decoder';
import { s57ToGeoJSON } from './parsers/s57ToGeoJSON';
import { getObjectClassName } from './s52/objectCatalogue';

// ─── IHO S-57 Object Class codes ─────────────────────────────────────────
// These codes match the actual binary OBJL values in S-57 .000 files,
// verified empirically against GDAL output from 50+ NOAA charts.

// Navigation aids — always visible at all zoom levels
const NAVIGATION_AID_OBJLS = new Set([
  75,                     // LIGHTS
  17, 14, 18, 19, 16,    // BOY* (BOYLAT, BOYCAR, BOYSAW, BOYSPP, BOYISD)
  7, 9, 5, 6, 8,         // BCN* (BCNLAT, BCNSPP, BCNCAR, BCNISD, BCNSAW)
  159,                    // WRECKS
  153,                    // UWTROC
  86,                     // OBSTRN
]);

// Safety areas — always visible for route planning
const SAFETY_AREA_OBJLS = new Set([
  112,  // RESARE
  27,   // CTNARE
  83,   // MIPARE
  4,    // ACHARE
  3,    // ACHBRT
  82,   // MARCUL
]);

const LIGHTS_OBJL = 75;
const SOUNDG_OBJL = 129;

// ─── Types ────────────────────────────────────────────────────────────────

interface GeoJSONFeature {
  type: 'Feature';
  geometry: any;
  properties: Record<string, any>;
  tippecanoe?: { minzoom: number; maxzoom: number; layer?: string };
}

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

// ─── Light sector arc geometry ────────────────────────────────────────────

/**
 * Generate a LineString arc for a light sector.
 *
 * S-57 SECTR1/SECTR2 are "true bearings as seen FROM SEAWARD towards the light".
 * The visible sector spans clockwise from SECTR1 to SECTR2.
 * We add 180 deg to get the direction the light shines from the light outward.
 */
function generateArcGeometry(
  centerLon: number,
  centerLat: number,
  startBearing: number,
  endBearing: number,
  radiusNm: number = 0.15,
  numPoints: number = 32,
): { type: 'LineString'; coordinates: [number, number][] } {
  const radiusDeg = radiusNm / 60.0;
  const latRad = (centerLat * Math.PI) / 180;
  const lonScale = Math.cos(latRad);

  const start = (startBearing + 180) % 360;
  const end = (endBearing + 180) % 360;

  let arcSpan = ((end - start) % 360 + 360) % 360;
  if (arcSpan === 0 && startBearing !== endBearing) arcSpan = 360;
  if (arcSpan < 1) arcSpan = 1;

  const pointsForArc = Math.max(8, Math.floor(numPoints * arcSpan / 90));
  const coords: [number, number][] = [];

  for (let i = 0; i <= pointsForArc; i++) {
    const fraction = i / pointsForArc;
    const bearing = start + arcSpan * fraction;
    const bearingRad = (bearing * Math.PI) / 180;

    const dx = radiusDeg * Math.sin(bearingRad) / lonScale;
    const dy = radiusDeg * Math.cos(bearingRad);

    coords.push([
      roundCoord(centerLon + dx),
      roundCoord(centerLat + dy),
    ]);
  }

  return { type: 'LineString', coordinates: coords };
}

// ─── Coordinate rounding ──────────────────────────────────────────────────

function roundCoord(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

function roundCoordinates(geom: any): any {
  if (!geom || !geom.coordinates) return geom;

  function roundRecursive(coords: any): any {
    if (typeof coords === 'number') return roundCoord(coords);
    if (Array.isArray(coords)) {
      if (coords.length > 0 && typeof coords[0] === 'number') {
        return coords.map(roundCoord);
      }
      return coords.map(roundRecursive);
    }
    return coords;
  }

  return { ...geom, coordinates: roundRecursive(geom.coordinates) };
}

// ─── COLOUR normalization ─────────────────────────────────────────────────

/**
 * Normalize S-57 COLOUR attribute from its string encoding to the first
 * integer value. S-57 stores COLOUR as a comma-separated list of integers
 * (e.g. "3" or "1,4"). We take the first value for MapLibre numeric matching.
 */
function normalizeColour(raw: any): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;

  if (typeof raw === 'number') return Math.floor(raw);

  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[()[\]{}]/g, '').trim();
    const parts = cleaned.split(/[,:]+/).filter((p: string) => p.trim());
    if (parts.length > 0) {
      const parsed = parseInt(parts[0], 10);
      if (!isNaN(parsed)) return parsed;
    }
  }

  return undefined;
}

// ─── Main conversion ──────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    process.stderr.write('Usage: node dist/convert_s57.js <input.000> <output_dir>\n');
    process.exit(1);
  }

  const inputPath = args[0];
  const outputDir = args[1];

  // Read binary .000 file
  const data = new Uint8Array(fs.readFileSync(inputPath));

  // Parse through the pipeline: ISO 8211 → S-57 → GeoJSON
  const iso8211 = parseISO8211(data);
  const dataset = decodeS57(iso8211);
  const rawGeoJSON = s57ToGeoJSON(dataset);

  // Extract chart info from filename
  const chartId = path.basename(inputPath, path.extname(inputPath));
  const scaleNum =
    chartId.length >= 3 && /\d/.test(chartId[2])
      ? parseInt(chartId[2], 10)
      : 0;

  process.stderr.write(`Chart ID: ${chartId} (scale ${scaleNum})\n`);

  // Post-process features
  const outputFeatures: GeoJSONFeature[] = [];
  let hasSafetyAreas = false;

  for (const feature of rawGeoJSON.features) {
    const props = feature.properties as Record<string, any>;
    const objl = props.OBJL as number;

    // Add chart identification properties
    props.CHART_ID = chartId;
    props._chartId = chartId;
    props._scaleNum = scaleNum;
    if (!props.OBJL_NAME) {
      props.OBJL_NAME = getObjectClassName(objl);
    }

    // Normalize COLOUR attribute for any feature that has it
    if (props.COLOUR !== undefined) {
      const normalized = normalizeColour(props.COLOUR);
      if (normalized !== undefined) {
        props.COLOUR = normalized;
      }
    }

    const isNavAid = NAVIGATION_AID_OBJLS.has(objl);
    const isSafetyArea = SAFETY_AREA_OBJLS.has(objl);
    if (isSafetyArea) hasSafetyAreas = true;

    // Tippecanoe hints: nav aids and safety areas visible at all zooms
    const tipp = (isNavAid || isSafetyArea)
      ? { minzoom: 0, maxzoom: 15 }
      : undefined;

    // ── LIGHTS: calculate orientation and generate sector arcs ──
    if (objl === LIGHTS_OBJL) {
      const sectr1 = props.SECTR1 !== undefined ? parseFloat(String(props.SECTR1)) : undefined;
      const sectr2 = props.SECTR2 !== undefined ? parseFloat(String(props.SECTR2)) : undefined;
      const orient = props.ORIENT !== undefined ? parseFloat(String(props.ORIENT)) : undefined;

      // Calculate _ORIENT for light symbol rotation
      if (sectr1 !== undefined && sectr2 !== undefined && !isNaN(sectr1) && !isNaN(sectr2)) {
        const span = ((sectr2 - sectr1) % 360 + 360) % 360;
        const midBearing = (sectr1 + span / 2) % 360;
        props._ORIENT = (midBearing + 180) % 360;
      } else if (orient !== undefined && !isNaN(orient)) {
        props._ORIENT = orient;
      } else {
        props._ORIENT = 135;
      }

      // Generate sector arc feature
      if (
        sectr1 !== undefined && sectr2 !== undefined &&
        !isNaN(sectr1) && !isNaN(sectr2) &&
        feature.geometry && feature.geometry.type === 'Point'
      ) {
        const coords = feature.geometry.coordinates;
        const colourCode = props.COLOUR ?? 1;

        const arcGeom = generateArcGeometry(coords[0], coords[1], sectr1, sectr2, 0.15);

        outputFeatures.push({
          type: 'Feature',
          geometry: arcGeom,
          properties: {
            OBJL: LIGHTS_OBJL,
            OBJL_NAME: 'LIGHTS',
            COLOUR: colourCode,
            SECTR1: sectr1,
            SECTR2: sectr2,
            OBJNAM: props.OBJNAM,
            CHART_ID: chartId,
            _chartId: chartId,
            _scaleNum: scaleNum,
          },
          tippecanoe: { minzoom: 0, maxzoom: 15, layer: 'arcs' },
        });
      }

      // Add the light feature itself
      outputFeatures.push({
        type: 'Feature',
        geometry: feature.geometry ? roundCoordinates(feature.geometry) : null,
        properties: props,
        ...(tipp ? { tippecanoe: tipp } : {}),
      });
    }

    // ── SOUNDG: split MultiPoint into individual Point features ──
    else if (objl === SOUNDG_OBJL) {
      const geom = feature.geometry;

      if (geom && geom.type === 'MultiPoint') {
        for (const coord of geom.coordinates) {
          const pointProps: Record<string, any> = {
            OBJL: SOUNDG_OBJL,
            OBJL_NAME: 'SOUNDG',
            DEPTH: coord.length >= 3 ? coord[2] : 0,
            CHART_ID: chartId,
            _chartId: chartId,
            _scaleNum: scaleNum,
          };
          if (props.SCAMIN !== undefined) pointProps.SCAMIN = props.SCAMIN;

          outputFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'Point' as const,
              coordinates: [roundCoord(coord[0]), roundCoord(coord[1])],
            },
            properties: pointProps,
          });
        }
      } else if (geom && geom.type === 'Point') {
        const coords = geom.coordinates;
        if (coords.length >= 3) {
          props.DEPTH = coords[2];
        }
        outputFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'Point' as const,
            coordinates: [roundCoord(coords[0]), roundCoord(coords[1])],
          },
          properties: props,
        });
      } else {
        outputFeatures.push({
          type: 'Feature',
          geometry: geom ? roundCoordinates(geom) : null,
          properties: props,
        });
      }
    }

    // ── All other features (including M_COVR) ──
    else {
      outputFeatures.push({
        type: 'Feature',
        geometry: feature.geometry ? roundCoordinates(feature.geometry) : null,
        properties: props,
        ...(tipp ? { tippecanoe: tipp } : {}),
      });
    }
  }

  process.stderr.write(
    `Extracted ${outputFeatures.length} features from ${rawGeoJSON.features.length} raw features\n`,
  );

  // Write GeoJSON output
  fs.mkdirSync(outputDir, { recursive: true });
  const geojsonPath = path.join(outputDir, `${chartId}.geojson`);
  const outputCollection: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features: outputFeatures,
  };
  fs.writeFileSync(geojsonPath, JSON.stringify(outputCollection));

  const fileSizeKB = fs.statSync(geojsonPath).size / 1024;
  process.stderr.write(`Created GeoJSON: ${geojsonPath} (${fileSizeKB.toFixed(1)} KB)\n`);

  // Output metadata to stdout (parsed by server.py)
  const result = {
    geojson_path: geojsonPath,
    has_safety_areas: hasSafetyAreas,
    feature_count: outputFeatures.length,
  };
  process.stdout.write(JSON.stringify(result) + '\n');
}

main();

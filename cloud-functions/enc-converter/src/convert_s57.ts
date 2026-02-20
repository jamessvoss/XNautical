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

// Safety areas — track presence for chart metadata (no longer forced to all zooms;
// features use their chart's native scale range and SCAMIN controls visibility)
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

interface SectorLight {
  lon: number;
  lat: number;
  sectr1: number;
  sectr2: number;
  colour: number;
  scamin: number;
  chartId: string;
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
  const sectorLights: SectorLight[] = [];
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

    const isSafetyArea = SAFETY_AREA_OBJLS.has(objl);
    if (isSafetyArea) hasSafetyAreas = true;

    // No forced tippecanoe zoom override — features use their chart's native
    // scale range (assigned by compose_job) and SCAMIN controls visibility.
    const tipp: { minzoom: number; maxzoom: number } | undefined = undefined;

    // ── LIGHTS: calculate orientation (arcs generated client-side per S-52) ──
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

      // Add the light feature itself
      outputFeatures.push({
        type: 'Feature',
        geometry: feature.geometry ? roundCoordinates(feature.geometry) : null,
        properties: props,
        ...(tipp ? { tippecanoe: tipp } : {}),
      });

      // Collect sector lights for sidecar JSON (used by app for reliable arc rendering)
      if (sectr1 !== undefined && sectr2 !== undefined && !isNaN(sectr1) && !isNaN(sectr2)) {
        const geom = feature.geometry;
        if (geom && geom.type === 'Point' && geom.coordinates) {
          const colour = normalizeColour(props.COLOUR);
          const scamin = props.SCAMIN !== undefined ? parseFloat(String(props.SCAMIN)) : Infinity;
          sectorLights.push({
            lon: roundCoord(geom.coordinates[0]),
            lat: roundCoord(geom.coordinates[1]),
            sectr1,
            sectr2,
            colour: colour ?? 1,
            scamin: isNaN(scamin) ? Infinity : scamin,
            chartId,
          });
        }
      }
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

  // Write sector lights sidecar JSON (used by app for reliable arc rendering
  // without needing queryRenderedFeaturesInRect)
  let sectorLightsPath: string | undefined;
  if (sectorLights.length > 0) {
    sectorLightsPath = path.join(outputDir, `${chartId}.sector-lights.json`);
    fs.writeFileSync(sectorLightsPath, JSON.stringify(sectorLights));
    process.stderr.write(`Sector lights: ${sectorLights.length} → ${sectorLightsPath}\n`);
  }

  // Output metadata to stdout (parsed by server.py)
  const result = {
    geojson_path: geojsonPath,
    has_safety_areas: hasSafetyAreas,
    feature_count: outputFeatures.length,
    sector_lights_path: sectorLightsPath,
    sector_lights_count: sectorLights.length,
  };
  process.stdout.write(JSON.stringify(result) + '\n');
}

main();

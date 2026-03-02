#!/usr/bin/env node
/**
 * Region Consistency Checker
 *
 * Compares hardcoded region lists across the codebase against
 * config/regions.json (single source of truth) and reports drift.
 *
 * Usage:
 *   node scripts/check-region-consistency.js
 *
 * Exit code 0 = consistent, 1 = drift detected.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const regionsPath = path.join(ROOT, 'config', 'regions.json');

if (!fs.existsSync(regionsPath)) {
  console.error('ERROR: config/regions.json not found');
  process.exit(1);
}

const { regions } = JSON.parse(fs.readFileSync(regionsPath, 'utf8'));
const canonicalIds = new Set(Object.keys(regions));
const canonicalPrefixes = new Map(
  Object.entries(regions).map(([id, r]) => [id, r.prefix])
);

let drift = false;

function checkFile(label, filePath, extractIds) {
  if (!fs.existsSync(filePath)) {
    console.warn(`  SKIP: ${filePath} (not found)`);
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const found = extractIds(content);
  if (!found) return;

  const foundSet = new Set(found);

  const missing = [...canonicalIds].filter(id => !foundSet.has(id));
  const extra = [...foundSet].filter(id => !canonicalIds.has(id));

  if (missing.length === 0 && extra.length === 0) {
    console.log(`  OK: ${label} (${found.length} regions)`);
  } else {
    drift = true;
    console.log(`  DRIFT: ${label}`);
    if (missing.length > 0) console.log(`    Missing: ${missing.join(', ')}`);
    if (extra.length > 0) console.log(`    Extra:   ${extra.join(', ')}`);
  }
}

console.log('Checking region consistency against config/regions.json...\n');
console.log(`Canonical regions (${canonicalIds.size}): ${[...canonicalIds].join(', ')}\n`);

// 1. chartPackService.ts — DISTRICT_PREFIXES
checkFile(
  'chartPackService.ts DISTRICT_PREFIXES',
  path.join(ROOT, 'src/services/chartPackService.ts'),
  (content) => {
    const match = content.match(/const DISTRICT_PREFIXES[^{]*\{([^}]+)\}/s);
    if (!match) return null;
    const keys = [...match[1].matchAll(/'([^']+)':/g)].map(m => m[1]);
    return keys;
  }
);

// 2. chartPackService.ts — DISTRICT_BOUNDS
checkFile(
  'chartPackService.ts DISTRICT_BOUNDS',
  path.join(ROOT, 'src/services/chartPackService.ts'),
  (content) => {
    const match = content.match(/const DISTRICT_BOUNDS[^{]*\{([\s\S]*?)\n\};/);
    if (!match) return null;
    const keys = [...match[1].matchAll(/'([^']+)':/g)].map(m => m[1]);
    return keys;
  }
);

// 3. generators-base/config.py — DISTRICT_PREFIXES (generated)
checkFile(
  'generators-base/config.py DISTRICT_PREFIXES',
  path.join(ROOT, 'cloud-functions/generators-base/config.py'),
  (content) => {
    const match = content.match(/DISTRICT_PREFIXES\s*=\s*\{([^}]+)\}/);
    if (!match) return null;
    const keys = [...match[1].matchAll(/'([^']+)':/g)].map(m => m[1]);
    return keys;
  }
);

// 4. prediction-generator/server.py — VALID_REGIONS
checkFile(
  'prediction-generator/server.py VALID_REGIONS',
  path.join(ROOT, 'cloud-functions/prediction-generator/server.py'),
  (content) => {
    const match = content.match(/VALID_REGIONS\s*=\s*[\[({]([\s\S]*?)[\])}]/);
    if (!match) return null;
    const keys = [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]);
    return keys;
  }
);

// 5. basemap-orchestrator/server.py — VALID_REGIONS
checkFile(
  'basemap-orchestrator/server.py VALID_REGIONS',
  path.join(ROOT, 'cloud-functions/basemap-orchestrator/server.py'),
  (content) => {
    const match = content.match(/VALID_REGIONS\s*=\s*[\[({]([\s\S]*?)[\])}]/);
    if (!match) return null;
    const keys = [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]);
    return keys;
  }
);

// 6. trigger-predictions.sh — VALID_REGIONS
checkFile(
  'trigger-predictions.sh VALID_REGIONS',
  path.join(ROOT, 'cloud-functions/prediction-generator/trigger-predictions.sh'),
  (content) => {
    const match = content.match(/VALID_REGIONS=\(([^)]+)\)/);
    if (!match) return null;
    const keys = [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
    return keys;
  }
);

// 7. enc-converter/region_config.py — Loaded at runtime, just verify it exists
const rcPath = path.join(ROOT, 'cloud-functions/enc-converter/region_config.py');
if (fs.existsSync(rcPath)) {
  const rcContent = fs.readFileSync(rcPath, 'utf8');
  if (rcContent.includes('regions.json')) {
    console.log('  OK: region_config.py (loads from regions.json at runtime)');
  } else {
    console.log('  WARN: region_config.py does not reference regions.json');
    drift = true;
  }
}

console.log('');
if (drift) {
  console.log('RESULT: Drift detected! Update the files above to match config/regions.json.');
  process.exit(1);
} else {
  console.log('RESULT: All region lists are consistent with config/regions.json.');
  process.exit(0);
}

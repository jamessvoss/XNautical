/**
 * Generate tide and current station ring+arrow icons
 *
 * Produces PNG icons at 1x/2x/3x densities:
 *   tide-{0,20,40,60,80,100}.png         (6 levels × 3 densities)
 *   current-{0,20,40,60,80,100}.png       (6 levels × 3 densities)
 *   tide-halo.png                          (1 × 3 densities)
 *   current-halo.png                       (1 × 3 densities)
 *
 * Design: circular ring with arrow inside; fill level clips the arrow.
 *   - Tide: blue (#3498db) up-arrow, rotated by MapLibre (0°=rising, 180°=falling)
 *   - Current: orange (#e67e22) right-arrow, rotated by MapLibre for compass bearing
 *
 * Usage: node scripts/generate-station-icons.js
 * Requires: sharp (already in project dependencies)
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'assets', 'symbols', 'png');

// Base size at 1x; 2x = 96, 3x = 144
const BASE_SIZE = 48;
// SVG coordinate system
const VB = 100;

// Arrow paths from the prototype
const ARROW_UP = 'M50,12 L72,40 L58,40 L58,88 L42,88 L42,40 L28,40 Z';
const ARROW_RIGHT = 'M88,50 L60,28 L60,42 L12,42 L12,58 L60,58 L60,72 Z';

// Colors
const TIDE_COLOR = '#3498db';
const CURRENT_COLOR = '#e67e22';

// Ring parameters (in viewBox coords)
const RING_CX = 50;
const RING_CY = 50;
const RING_R = 40;
const RING_STROKE = 3;

// Fill levels
const FILL_LEVELS = [0, 20, 40, 60, 80, 100];

// Density suffixes
const DENSITIES = [
  { suffix: '', scale: 1 },
  { suffix: '@2x', scale: 2 },
  { suffix: '@3x', scale: 3 },
];

/**
 * Build a clip-path rect that reveals `percent`% of an arrow from its base.
 *
 * Up arrow: base is at bottom (y=88), tip at top (y=12).
 *   Fill grows upward from y=88 → reveal from bottom.
 *
 * Right arrow: base is at left (x=12), tip at right (x=88).
 *   Fill grows rightward from x=12 → reveal from left.
 */
function clipRect(percent, direction) {
  const span = 76; // arrow occupies y 12..88 or x 12..88
  const filled = (percent / 100) * span;

  if (direction === 'up') {
    // Reveal from bottom: rect starts at (88 - filled) and goes to 88
    const y = 88 - filled;
    return `<rect x="0" y="${y}" width="100" height="${filled + 12}"/>`;
  }
  // right: reveal from left
  return `<rect x="12" y="0" width="${filled}" height="100"/>`;
}

/**
 * Generate SVG string for a station icon
 */
function buildIconSvg({ arrowPath, color, fillPercent, direction }) {
  const uid = `clip-${direction}-${fillPercent}`;
  const hasFill = fillPercent > 0;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}">
  <defs>
    <clipPath id="${uid}">
      ${clipRect(fillPercent, direction)}
    </clipPath>
  </defs>
  <!-- White halo outside ring -->
  <circle cx="${RING_CX}" cy="${RING_CY}" r="${RING_R + 3}" fill="none"
          stroke="white" stroke-width="1" opacity="0.6"/>
  <!-- Ring stroke (colored) -->
  <circle cx="${RING_CX}" cy="${RING_CY}" r="${RING_R}" fill="none"
          stroke="${color}" stroke-width="${RING_STROKE}" opacity="0.85"/>
  <!-- Arrow white halo for contrast -->
  <path d="${arrowPath}" fill="none" stroke="white" stroke-width="4"
        stroke-linejoin="round" opacity="0.6"/>
  <!-- Arrow outline -->
  <path d="${arrowPath}" fill="none" stroke="${color}" stroke-width="1.8"
        stroke-linejoin="round"/>
  ${hasFill ? `<!-- Arrow fill (clipped to fill level) -->
  <path d="${arrowPath}" fill="${color}" opacity="0.45"
        clip-path="url(#${uid})"/>` : ''}
</svg>`;
}

/**
 * Generate SVG string for a halo icon (white circle, slightly larger than ring)
 */
function buildHaloSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}">
  <circle cx="${RING_CX}" cy="${RING_CY}" r="${RING_R + 4}" fill="white" opacity="0.85"/>
</svg>`;
}

/**
 * Render SVG string to PNG at given pixel size via sharp
 */
async function svgToPng(svgString, pixelSize) {
  const buf = Buffer.from(svgString);
  return sharp(buf, { density: Math.round((72 * pixelSize) / BASE_SIZE) })
    .resize(pixelSize, pixelSize)
    .png()
    .toBuffer();
}

/**
 * Write PNG buffer to file
 */
function writePng(buffer, filename) {
  const filepath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filepath, buffer);
  console.log(`  ${filename}`);
}

async function generateAllIcons() {
  console.log('Generating ring+arrow station icons...\n');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // --- Tide icons (up arrow, blue) ---
  console.log('Tide icons:');
  for (const fill of FILL_LEVELS) {
    const svg = buildIconSvg({
      arrowPath: ARROW_UP,
      color: TIDE_COLOR,
      fillPercent: fill,
      direction: 'up',
    });
    for (const { suffix, scale } of DENSITIES) {
      const px = BASE_SIZE * scale;
      const png = await svgToPng(svg, px);
      writePng(png, `tide-${fill}${suffix}.png`);
    }
  }

  // --- Current icons (right arrow, orange) ---
  console.log('\nCurrent icons:');
  for (const fill of FILL_LEVELS) {
    const svg = buildIconSvg({
      arrowPath: ARROW_RIGHT,
      color: CURRENT_COLOR,
      fillPercent: fill,
      direction: 'right',
    });
    for (const { suffix, scale } of DENSITIES) {
      const px = BASE_SIZE * scale;
      const png = await svgToPng(svg, px);
      writePng(png, `current-${fill}${suffix}.png`);
    }
  }

  // --- Halo icons ---
  console.log('\nHalo icons:');
  const haloSvg = buildHaloSvg();
  for (const type of ['tide', 'current']) {
    for (const { suffix, scale } of DENSITIES) {
      const px = BASE_SIZE * scale;
      const png = await svgToPng(haloSvg, px);
      writePng(png, `${type}-halo${suffix}.png`);
    }
  }

  const totalFiles = FILL_LEVELS.length * 2 * DENSITIES.length + 2 * DENSITIES.length;
  console.log(`\nDone! Generated ${totalFiles} PNG files.`);
}

generateAllIcons().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});

/**
 * Generate tide and current station icons
 * 
 * Generates pre-rendered PNG icons for:
 * - Tide stations: 20 icons (2 directions × 10 fill levels)
 * - Current stations: 40 icons (8 directions × 5 velocity levels)
 * 
 * Usage: node scripts/generate-station-icons.js
 * Requires: npm install canvas
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'assets', 'symbols', 'png');

// Icon size
const SIZE = 32;
const CENTER = SIZE / 2;

// Colors
const TIDE_COLOR = '#0066CC';
const TIDE_FILL_COLOR = '#0066CC';
const CURRENT_COLOR = '#CC0066';
const STROKE_COLOR = '#FFFFFF';

/**
 * Generate a single tide icon
 * @param {string} direction - 'rising' or 'falling'
 * @param {number} fillPercent - 0, 10, 20, ... 90
 */
function generateTideIcon(direction, fillPercent) {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  
  // Clear with transparency
  ctx.clearRect(0, 0, SIZE, SIZE);
  
  // Draw white background circle for visibility
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, 14, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fill();
  ctx.strokeStyle = STROKE_COLOR;
  ctx.lineWidth = 1;
  ctx.stroke();
  
  // Gauge bar dimensions
  const barWidth = 8;
  const barHeight = 18;
  const barX = CENTER - barWidth / 2;
  const barY = CENTER - barHeight / 2 + 2; // Slightly lower to make room for arrow
  
  // Draw gauge outline
  ctx.strokeStyle = TIDE_COLOR;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(barX, barY, barWidth, barHeight);
  
  // Draw fill level (from bottom up)
  const fillHeight = (barHeight * fillPercent) / 100;
  const fillY = barY + barHeight - fillHeight;
  
  ctx.fillStyle = TIDE_FILL_COLOR;
  ctx.fillRect(barX + 1, fillY, barWidth - 2, fillHeight);
  
  // Draw arrow
  const arrowY = barY - 4;
  const arrowSize = 5;
  
  ctx.fillStyle = TIDE_COLOR;
  ctx.beginPath();
  
  if (direction === 'rising') {
    // Up arrow
    ctx.moveTo(CENTER, arrowY - arrowSize);
    ctx.lineTo(CENTER - arrowSize, arrowY + 2);
    ctx.lineTo(CENTER + arrowSize, arrowY + 2);
  } else {
    // Down arrow (at bottom)
    const downArrowY = barY + barHeight + 4;
    ctx.moveTo(CENTER, downArrowY + arrowSize);
    ctx.lineTo(CENTER - arrowSize, downArrowY - 2);
    ctx.lineTo(CENTER + arrowSize, downArrowY - 2);
  }
  ctx.closePath();
  ctx.fill();
  
  return canvas;
}

/**
 * Generate a single current icon (pointing UP/North - will be rotated by MapLibre)
 * @param {number} velocityLevel - 0 (slack) to 4 (max)
 */
function generateCurrentIcon(velocityLevel) {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  
  // Clear with transparency
  ctx.clearRect(0, 0, SIZE, SIZE);
  
  // Draw white background circle for visibility
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, 14, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fill();
  ctx.strokeStyle = STROKE_COLOR;
  ctx.lineWidth = 1;
  ctx.stroke();
  
  // Velocity affects arrow size and opacity
  // Level 0 = slack (small dot), Level 4 = max (full arrow)
  if (velocityLevel === 0) {
    // Slack - just draw a small dot
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, 4, 0, Math.PI * 2);
    ctx.fillStyle = CURRENT_COLOR;
    ctx.globalAlpha = 0.5;
    ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    // Draw arrow pointing UP (North = 0 degrees)
    const arrowLength = 6 + velocityLevel * 2; // 8, 10, 12, 14 pixels
    const arrowWidth = 3 + velocityLevel; // 4, 5, 6, 7 pixels
    const opacity = 0.4 + velocityLevel * 0.15; // 0.55, 0.7, 0.85, 1.0
    
    ctx.save();
    ctx.translate(CENTER, CENTER);
    // Arrow points UP (negative Y direction)
    ctx.rotate(-Math.PI / 2); // Rotate to point up
    
    // Arrow body
    ctx.fillStyle = CURRENT_COLOR;
    ctx.globalAlpha = opacity;
    
    ctx.beginPath();
    // Arrow pointing right (rotated to point up)
    ctx.moveTo(arrowLength, 0); // Tip
    ctx.lineTo(-arrowLength / 2, -arrowWidth);
    ctx.lineTo(-arrowLength / 3, 0);
    ctx.lineTo(-arrowLength / 2, arrowWidth);
    ctx.closePath();
    ctx.fill();
    
    // Arrow outline
    ctx.strokeStyle = CURRENT_COLOR;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
    ctx.stroke();
    
    ctx.restore();
  }
  
  return canvas;
}

/**
 * Save canvas as PNG
 */
function saveIcon(canvas, filename) {
  const buffer = canvas.toBuffer('image/png');
  const filepath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filepath, buffer);
  console.log(`  Created: ${filename}`);
}

/**
 * Main generation function
 */
async function generateAllIcons() {
  console.log('Generating station icons...\n');
  
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Generate tide icons
  console.log('Generating tide icons (20 total):');
  const directions = ['rising', 'falling'];
  const fillLevels = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
  
  for (const direction of directions) {
    for (const fill of fillLevels) {
      const canvas = generateTideIcon(direction, fill);
      const filename = `tide-${direction}-${fill.toString().padStart(2, '0')}.png`;
      saveIcon(canvas, filename);
    }
  }
  
  // Generate current icons (5 velocity levels, rotation handled by MapLibre)
  console.log('\nGenerating current icons (5 total):');
  const velocityLevels = [0, 1, 2, 3, 4];
  
  for (const vel of velocityLevels) {
    const canvas = generateCurrentIcon(vel);
    const filename = `current-${vel}.png`;
    saveIcon(canvas, filename);
  }
  
  console.log('\nDone! Generated 25 icons total (20 tide + 5 current).');
}

// Run
generateAllIcons().catch(console.error);

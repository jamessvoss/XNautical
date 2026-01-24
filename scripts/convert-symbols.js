/**
 * Convert S-52 SVG symbols to PNG for use with Mapbox GL
 * 
 * Run with: node scripts/convert-symbols.js
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Symbol definitions to convert
const SYMBOLS_TO_CONVERT = [
  // Light flare symbols
  { src: 'point/Light_Flare_white.svg', name: 'light-flare-white' },
  { src: 'point/Light_Flare_red.svg', name: 'light-flare-red' },
  { src: 'point/Light_Flare_green.svg', name: 'light-flare-green' },
  { src: 'point/Light_Flare.svg', name: 'light-flare-magenta' },
  
  // Alternative light point symbols
  { src: 'point/P1_Light_white.svg', name: 'light-point-white' },
  { src: 'point/P1_Light_red.svg', name: 'light-point-red' },
  { src: 'point/P1_Light_green.svg', name: 'light-point-green' },
  { src: 'point/P1_Light.svg', name: 'light-point-magenta' },
  
  // Lighted beacon
  { src: 'point/P4_Lighted_beacon.svg', name: 'lighted-beacon' },
];

const INPUT_DIR = path.join(__dirname, '../assets/symbols');
const OUTPUT_DIR = path.join(__dirname, '../assets/symbols/png');

// Size for the output PNG (base size, will create @2x and @3x versions)
const BASE_SIZE = 32;

async function convertSymbol(symbol) {
  const inputPath = path.join(INPUT_DIR, symbol.src);
  
  if (!fs.existsSync(inputPath)) {
    console.warn(`⚠️  File not found: ${symbol.src}`);
    return;
  }
  
  const sizes = [
    { suffix: '', size: BASE_SIZE },
    { suffix: '@2x', size: BASE_SIZE * 2 },
    { suffix: '@3x', size: BASE_SIZE * 3 },
  ];
  
  for (const { suffix, size } of sizes) {
    const outputPath = path.join(OUTPUT_DIR, `${symbol.name}${suffix}.png`);
    
    try {
      await sharp(inputPath)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(outputPath);
      
      console.log(`✅ ${symbol.name}${suffix}.png (${size}x${size})`);
    } catch (err) {
      console.error(`❌ Failed to convert ${symbol.src}: ${err.message}`);
    }
  }
}

async function main() {
  console.log('🔄 Converting S-52 SVG symbols to PNG...\n');
  
  // Create output directory if it doesn't exist
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Convert each symbol
  for (const symbol of SYMBOLS_TO_CONVERT) {
    await convertSymbol(symbol);
  }
  
  console.log('\n✨ Conversion complete!');
  console.log(`   Output: ${OUTPUT_DIR}`);
}

main().catch(console.error);

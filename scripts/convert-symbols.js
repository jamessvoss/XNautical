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
  
  // Buoy symbols (BOYSHP)
  { src: 'point/Q20a_Conical_buoy.svg', name: 'buoy-conical' },      // BOYSHP=1 (nun buoy)
  { src: 'point/Q21a_Can_buoy.svg', name: 'buoy-can' },              // BOYSHP=2
  { src: 'point/Q22a_Spherical_buoy.svg', name: 'buoy-spherical' },  // BOYSHP=3
  { src: 'point/Q23a_Pillar_buoy.svg', name: 'buoy-pillar' },        // BOYSHP=4
  { src: 'point/Q24_Spar_buoy.svg', name: 'buoy-spar' },             // BOYSHP=5
  { src: 'point/Q25a_Barrel_buoy.svg', name: 'buoy-barrel' },        // BOYSHP=6
  { src: 'point/Q26_Super_buoy.svg', name: 'buoy-super' },           // BOYSHP=7
  
  // Beacon symbols (BCNSHP)
  { src: 'point/Q90_Stake_pole.svg', name: 'beacon-stake' },         // BCNSHP=1
  { src: 'point/Q92_Withy_port.svg', name: 'beacon-withy' },         // BCNSHP=2
  { src: 'point/Q110a_Beacon_tower.svg', name: 'beacon-tower' },     // BCNSHP=3
  { src: 'point/Q111_Lattice_beacon.svg', name: 'beacon-lattice' },  // BCNSHP=4
  { src: 'point/Q80_Beacon.svg', name: 'beacon-generic' },           // Default beacon
  { src: 'point/Q100_cairn.svg', name: 'beacon-cairn' },             // BCNSHP=6
  
  // Landmark symbols (CATLMK)
  { src: 'point/E20_Tower.svg', name: 'landmark-tower' },            // CATLMK=17 (tower)
  { src: 'point/E22_Chimney.svg', name: 'landmark-chimney' },        // CATLMK=3 (chimney)
  { src: 'point/E24_Monument.svg', name: 'landmark-monument' },      // CATLMK=10 (monument)
  { src: 'point/E27_Flagpole.svg', name: 'landmark-flagpole' },      // CATLMK=7 (flagpole)
  { src: 'point/E28_Radio_mast.svg', name: 'landmark-mast' },        // CATLMK=12 (mast)
  { src: 'point/E29_Radio_tower.svg', name: 'landmark-radio-tower' },// Radio tower
  { src: 'point/E25_Windmill.svg', name: 'landmark-windmill' },      // CATLMK=20 (windmill)
  { src: 'point/E10_Church.svg', name: 'landmark-church' },          // CATLMK=2 (church)
  
  // Wreck symbols (CATWRK)
  { src: 'point/K24_Wreck_showing_hull.svg', name: 'wreck-hull' },      // CATWRK=5 (showing hull)
  { src: 'point/K22_Wreck_submerged.svg', name: 'wreck-submerged' },    // CATWRK=1,2 (submerged dangerous)
  { src: 'point/K21_Wreck_uncovers.svg', name: 'wreck-uncovers' },      // CATWRK=4 (shows at low water)
  { src: 'point/K29_Wreck_notdangerous.svg', name: 'wreck-safe' },      // Not dangerous to navigation
  { src: 'point/K25_Wreck_danger_no_depth.svg', name: 'wreck-danger' }, // Dangerous, depth unknown
  
  // Rock symbols (WATLEV)
  { src: 'point/K11a_Rock_uncovers.svg', name: 'rock-uncovers' },       // WATLEV=4 (covers and uncovers)
  { src: 'point/K12a_Rock_awash.svg', name: 'rock-awash' },             // WATLEV=5 (awash)
  { src: 'point/K13a_Dangerous_underwater_rk.svg', name: 'rock-submerged' }, // WATLEV=3 (always submerged)
  { src: 'point/K10_LandPoint.svg', name: 'rock-above-water' },         // WATLEV=1,2 (always dry)
  
  // Obstruction symbols (CATOBS)
  { src: 'point/K1_Obstruction4mm_shoal.svg', name: 'obstruction' },    // Generic obstruction
  { src: 'point/K31_Foul_ground.svg', name: 'foul-ground' },            // CATOBS=6 (foul ground/kelp)
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

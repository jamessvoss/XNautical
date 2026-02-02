#!/usr/bin/env node
/**
 * Calculate storage requirements for 2 years of tidal predictions
 * 
 * Data Structure per station (from functions/src/index.ts):
 * {
 *   id: string,
 *   name: string,
 *   lat: number,
 *   lng: number,
 *   type: 'R' | 'S',
 *   predictions: {
 *     "YYYY-MM-DD": [
 *       { time: "HH:MM", height: number, type: "H" | "L" }
 *     ]
 *   }
 * }
 */

// ============================================================================
// ASSUMPTIONS
// ============================================================================

const TIDAL_STATIONS = 578;
const YEARS_OF_DATA = 2;
const DAYS_PER_YEAR = 365.25; // Account for leap years
const TOTAL_DAYS = Math.ceil(YEARS_OF_DATA * DAYS_PER_YEAR);

// Typical tidal patterns:
// - Most locations have 2 high tides and 2 low tides per day (semi-diurnal)
// - Some locations have 1 high and 1 low per day (diurnal)
// - Mixed tides can have 3-4 events per day
// Average: ~4 tide events per day
const AVG_TIDE_EVENTS_PER_DAY = 4;

// ============================================================================
// DATA SIZE CALCULATIONS
// ============================================================================

// Firestore document overhead
const DOCUMENT_OVERHEAD = 32; // bytes (document metadata)
const FIELD_NAME_OVERHEAD = 1; // byte per character in field name
const STRING_OVERHEAD = 1; // byte per character

// Size per tide event (one high or low tide)
// Example: { time: "14:35", height: 8.42, type: "H" }
function calculateTideEventSize() {
  const timeField = 4 + 5; // "time" + "14:35" = 9 bytes
  const heightField = 6 + 8; // "height" + 8-byte float = 14 bytes
  const typeField = 4 + 1; // "type" + "H" = 5 bytes
  const objectOverhead = 10; // Object wrapper overhead
  
  return timeField + heightField + typeField + objectOverhead;
}

// Size per day's predictions
// Example: "2024-01-15": [4 tide events]
function calculateDaySize() {
  const dateKeySize = 10; // "YYYY-MM-DD" = 10 characters
  const arrayOverhead = 8; // Array wrapper
  const eventsSize = calculateTideEventSize() * AVG_TIDE_EVENTS_PER_DAY;
  
  return dateKeySize + arrayOverhead + eventsSize;
}

// Size per station document
function calculateStationSize() {
  // Base station info
  const idField = 2 + 10; // "id" + typical station ID (10 chars)
  const nameField = 4 + 30; // "name" + typical name (30 chars average)
  const latField = 3 + 8; // "lat" + 8-byte float
  const lngField = 3 + 8; // "lng" + 8-byte float
  const typeField = 4 + 1; // "type" + "R"
  
  const baseInfoSize = idField + nameField + latField + lngField + typeField;
  
  // Predictions field
  const predictionsFieldName = 11; // "predictions"
  const predictionsMapOverhead = 8; // Map wrapper
  const allDaysSize = calculateDaySize() * TOTAL_DAYS;
  
  const predictionsSize = predictionsFieldName + predictionsMapOverhead + allDaysSize;
  
  return DOCUMENT_OVERHEAD + baseInfoSize + predictionsSize;
}

// ============================================================================
// RESULTS
// ============================================================================

const tideEventSize = calculateTideEventSize();
const daySize = calculateDaySize();
const stationSize = calculateStationSize();
const totalSize = stationSize * TIDAL_STATIONS;

// Firestore pricing (as of 2024)
const STORAGE_COST_PER_GB_MONTH = 0.18; // $0.18/GB/month
const totalCostPerMonth = (totalSize / (1024 ** 3)) * STORAGE_COST_PER_GB_MONTH;

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('   TIDAL PREDICTION STORAGE CALCULATOR (2 Years of Data)');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('📊 Input Parameters:');
console.log(`   • Tidal Stations: ${TIDAL_STATIONS.toLocaleString()}`);
console.log(`   • Years of Data: ${YEARS_OF_DATA}`);
console.log(`   • Total Days: ${TOTAL_DAYS.toLocaleString()}`);
console.log(`   • Avg Tide Events/Day: ${AVG_TIDE_EVENTS_PER_DAY}`);
console.log('');

console.log('💾 Data Structure Sizes:');
console.log(`   • Per Tide Event: ${tideEventSize} bytes`);
console.log(`   • Per Day (${AVG_TIDE_EVENTS_PER_DAY} events): ${daySize.toLocaleString()} bytes`);
console.log(`   • Per Station (${TOTAL_DAYS} days): ${(stationSize / 1024).toFixed(2)} KB`);
console.log('');

console.log('📦 Total Storage Requirements:');
console.log(`   • Raw Data: ${(totalSize / (1024 ** 2)).toFixed(2)} MB`);
console.log(`   • Raw Data: ${(totalSize / (1024 ** 3)).toFixed(3)} GB`);
console.log('');

console.log('💰 Estimated Firestore Costs:');
console.log(`   • Storage: $${totalCostPerMonth.toFixed(4)}/month`);
console.log(`   • Storage: $${(totalCostPerMonth * 12).toFixed(2)}/year`);
console.log('');

console.log('📈 Breakdown per Station:');
const eventsPerStation = TOTAL_DAYS * AVG_TIDE_EVENTS_PER_DAY;
console.log(`   • Total Tide Events: ${eventsPerStation.toLocaleString()}`);
console.log(`   • Storage Size: ${(stationSize / 1024).toFixed(2)} KB`);
console.log('');

console.log('🔍 Data Density:');
const bytesPerEvent = stationSize / eventsPerStation;
console.log(`   • Bytes per Tide Event: ${bytesPerEvent.toFixed(1)}`);
console.log(`   • Events per KB: ${(1024 / bytesPerEvent).toFixed(1)}`);
console.log('');

// Comparison with different time periods
console.log('📊 Storage for Different Time Periods:');
const periods = [
  { name: '1 year', days: 365 },
  { name: '2 years', days: 730 },
  { name: '3 years', days: 1095 },
  { name: '5 years', days: 1825 },
];

periods.forEach(period => {
  const periodSize = (period.days * daySize * TIDAL_STATIONS) / (1024 ** 2);
  const periodCost = (periodSize / 1024) * STORAGE_COST_PER_GB_MONTH;
  console.log(`   • ${period.name.padEnd(8)}: ${periodSize.toFixed(1).padStart(6)} MB  ($${periodCost.toFixed(3)}/mo)`);
});

console.log('\n═══════════════════════════════════════════════════════════════\n');

// Export for programmatic use
module.exports = {
  TIDAL_STATIONS,
  YEARS_OF_DATA,
  TOTAL_DAYS,
  tideEventSize,
  daySize,
  stationSize,
  totalSize,
  totalSizeMB: totalSize / (1024 ** 2),
  totalSizeGB: totalSize / (1024 ** 3),
  costPerMonth: totalCostPerMonth,
  costPerYear: totalCostPerMonth * 12,
};

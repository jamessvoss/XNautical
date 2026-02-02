/**
 * Check if tide and current station data exists in AsyncStorage
 * Run this with: node scripts/check-station-storage.js
 */

// This would need to run in the React Native context to access AsyncStorage
// Instead, let's add a check in the app itself

console.log(`
To verify stations are stored on device:

1. Add this to your app (temporarily in DynamicChartViewer or Settings):

import AsyncStorage from '@react-native-async-storage/async-storage';

// Check storage
AsyncStorage.multiGet([
  '@XNautical:tideStations',
  '@XNautical:currentStations', 
  '@XNautical:stationsTimestamp'
]).then(values => {
  const [tides, currents, timestamp] = values;
  
  console.log('=== STATION STORAGE CHECK ===');
  console.log('Tide Stations:', tides[1] ? \`\${JSON.parse(tides[1]).length} stations\` : 'NOT FOUND');
  console.log('Current Stations:', currents[1] ? \`\${JSON.parse(currents[1]).length} stations\` : 'NOT FOUND');
  console.log('Timestamp:', timestamp[1] ? new Date(parseInt(timestamp[1])).toISOString() : 'NOT FOUND');
  console.log('Total Size:', tides[1] ? \`\${(tides[1].length + currents[1].length) / 1024} KB\` : '0 KB');
  console.log('============================');
});

2. Or use React Native Debugger / Flipper to inspect AsyncStorage directly

3. Or check the logs when the app starts - it should show:
   "Loading stations from AsyncStorage..."
   "Loaded X tide stations and Y current stations from storage"
`);

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Remove 'geojson' from assetExts and add it to sourceExts
// so it's treated as a source file (like JSON) instead of an asset
config.resolver.assetExts = config.resolver.assetExts.filter(ext => ext !== 'geojson');
config.resolver.sourceExts.push('geojson');

// Keep pb and mbtiles as assets
config.resolver.assetExts.push('pbf', 'mbtiles');

module.exports = config;

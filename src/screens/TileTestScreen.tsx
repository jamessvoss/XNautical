/**
 * TileTestScreen - Minimal test screen for debugging tile rendering.
 * Bypasses all DynamicChartViewer complexity.
 * Shows a MapLibre MapView with a single VectorSource for chart tiles.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity } from 'react-native';
import MapLibre from '@maplibre/maplibre-react-native';
import * as tileServer from '../services/tileServer';
import * as chartCacheService from '../services/chartCacheService';
import * as FileSystem from 'expo-file-system/legacy';

// S-57 OBJL code lookup (common objects)
const OBJL_NAMES: Record<number, string> = {
  1: 'ADMARE', 2: 'AIRARE', 3: 'ACHBRT', 4: 'ACHARE', 5: 'BCNCAR',
  6: 'BCNISD', 7: 'BCNLAT', 8: 'BCNSAW', 9: 'BCNSPP', 10: 'BERTHS',
  11: 'BRIDGE', 12: 'BUISGL', 13: 'BUAARE', 14: 'BOYCAR', 15: 'BOYISD',
  16: 'BOYLAT', 17: 'BOYSAW', 18: 'BOYSPP', 19: 'CBLARE', 20: 'CBLOHD',
  21: 'CBLSUB', 22: 'CANALS', 23: 'CAUSWY', 24: 'CTNARE', 25: 'CHKPNT',
  26: 'CGUSTA', 27: 'COALNE', 28: 'CONZNE', 29: 'COSARE', 30: 'CTRPNT',
  31: 'CONVYR', 32: 'CRANES', 33: 'CURENT', 34: 'CUSZNE', 35: 'DAMCON',
  36: 'DAYMAR', 37: 'DWRTCL', 38: 'DWRTPT', 39: 'DEPARE', 40: 'DEPCNT',
  41: 'DISMAR', 42: 'DEPARE', 43: 'DEPCNT', 44: 'DMPGRD', 45: 'DRGARE',
  46: 'DRYDOC', 47: 'DYKCON', 48: 'EXEZNE', 49: 'FAIRWY', 50: 'FNCLNE',
  51: 'FERYRT', 52: 'FSHZNE', 53: 'FSHFAC', 54: 'FSHGRD', 55: 'FLODOC',
  56: 'FOGSIG', 57: 'FORSTC', 58: 'GATCON', 59: 'GRIDRN', 60: 'HRBARE',
  61: 'HRBFAC', 62: 'HULKES', 63: 'ICEARE', 64: 'ICNARE', 65: 'ISTZNE',
  69: 'LAKARE', 71: 'LNDARE', 72: 'LNDELV', 73: 'LNDRGN', 74: 'LNDMRK',
  75: 'LIGHTS', 76: 'LITFLT', 77: 'LITVES', 78: 'LOCMAG', 79: 'LOKBSN',
  80: 'LOGPON', 81: 'MAGVAR', 82: 'MARCUL', 83: 'MIPARE', 84: 'MORFAC',
  85: 'NAVLNE', 86: 'OBSTRN', 87: 'OFSPLF', 88: 'OSPARE', 89: 'OILBAR',
  90: 'PILPNT', 91: 'PILBOP', 92: 'PIPARE', 93: 'PIPOHD', 94: 'PIPSOL',
  95: 'PONTON', 96: 'PRCARE', 97: 'PRDARE', 98: 'PYLONS', 99: 'RADLNE',
  100: 'RADRNG', 101: 'RADRFL', 102: 'RADSTA', 103: 'RTPBCN', 104: 'RDOCAL',
  105: 'RDOSTA', 106: 'RAILWY', 107: 'RAPIDS', 108: 'RCRTCL', 109: 'RECTRC',
  110: 'RESARE', 111: 'RETRFL', 112: 'RIVERS', 113: 'ROADWY', 114: 'RUNWAY',
  115: 'SNDWAV', 116: 'SEAARE', 117: 'SPLARE', 118: 'SBDARE', 119: 'SLCONS',
  120: 'SISTAT', 121: 'SISTAW', 122: 'SILTNK', 123: 'SLOTOP', 124: 'SLOGRD',
  125: 'SMCFAC', 126: 'SOUNDG', 127: 'SPRING', 128: 'STSLNE', 129: 'SUBTLN',
  130: 'SWPARE', 131: 'TESARE', 132: 'TS_PRH', 133: 'TS_PNH', 134: 'TS_PAD',
  135: 'TS_TIS', 136: 'T_HMON', 137: 'T_NHMN', 138: 'T_TIMS', 139: 'TIDEWY',
  140: 'TOPMAR', 141: 'TSELNE', 142: 'TSSBND', 143: 'TSSCRS', 144: 'TSSLPT',
  145: 'TSSRON', 146: 'TUNNEL', 147: 'TWRTPT', 148: 'UWTROC', 149: 'UNSARE',
  150: 'VEGATN', 151: 'WATTUR', 152: 'WATFAL', 153: 'WEDKLP', 154: 'WRECKS',
  155: 'TS_FEB', 159: 'ACHARE', 300: 'M_COVR', 301: 'M_CSCL', 302: 'M_QUAL',
  306: 'M_NSYS',
};

export default function TileTestScreen() {
  const [status, setStatus] = useState('Initializing...');
  const [tileUrl, setTileUrl] = useState<string | null>(null);
  const [serverReady, setServerReady] = useState(false);
  const [featureInfo, setFeatureInfo] = useState<string | null>(null);
  const mapRef = useRef<any>(null);

  // Handle map tap — query all rendered features at tap point
  const handleMapPress = useCallback(async (event: any) => {
    try {
      const { geometry, properties } = event;
      const screenPoint = event.properties?.screenPointX != null
        ? [event.properties.screenPointX, event.properties.screenPointY]
        : null;

      // Try queryRenderedFeaturesAtPoint for all layers
      if (mapRef.current && screenPoint) {
        const features = await mapRef.current.queryRenderedFeaturesAtPoint(
          screenPoint,
          null,  // no filter
          ['test-depare-fill', 'test-depare-outline', 'test-lndare-fill', 'test-coalne', 'test-depcnt', 'test-all-points']
        );

        if (features && features.features && features.features.length > 0) {
          const lines: string[] = [];
          lines.push(`${features.features.length} feature(s) at tap:`);
          lines.push(`Coord: [${geometry.coordinates[0].toFixed(5)}, ${geometry.coordinates[1].toFixed(5)}]`);
          lines.push('---');

          for (const feat of features.features.slice(0, 10)) {
            const props = feat.properties || {};
            const objl = props.OBJL;
            const objName = objl != null ? (OBJL_NAMES[objl] || `OBJL=${objl}`) : 'no OBJL';
            const geomType = feat.geometry?.type || '?';
            lines.push(`[${objName}] (${geomType})`);

            // Show all properties
            for (const [key, val] of Object.entries(props)) {
              lines.push(`  ${key}: ${JSON.stringify(val)}`);
            }
            lines.push('');
          }

          if (features.features.length > 10) {
            lines.push(`... and ${features.features.length - 10} more`);
          }

          const info = lines.join('\n');
          console.log('[TileTest] TAP:', info);
          setFeatureInfo(info);
          return;
        }
      }

      // Fallback: show tap coordinates
      const coord = geometry?.coordinates;
      if (coord) {
        const info = `No features at [${coord[0].toFixed(5)}, ${coord[1].toFixed(5)}]`;
        console.log('[TileTest] TAP:', info);
        setFeatureInfo(info);
      }
    } catch (e: any) {
      console.error('[TileTest] TAP error:', e);
      setFeatureInfo(`Error: ${e.message}`);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        // 1. Find the mbtiles directory
        const mbtilesDir = chartCacheService.getMBTilesDir();
        setStatus(`MBTiles dir: ${mbtilesDir}`);

        // 2. List mbtiles files
        const dirInfo = await FileSystem.getInfoAsync(mbtilesDir);
        if (!dirInfo.exists) {
          setStatus(`ERROR: MBTiles dir does not exist: ${mbtilesDir}`);
          return;
        }
        const files = await FileSystem.readDirectoryAsync(mbtilesDir);
        const mbtilesFiles = files.filter(f => f.endsWith('.mbtiles'));
        console.log('[TileTest] Found mbtiles:', mbtilesFiles);
        setStatus(`Found ${mbtilesFiles.length} mbtiles: ${mbtilesFiles.join(', ')}`);

        // 3. Find the unified charts file
        const unifiedFile = mbtilesFiles.find(f => f.includes('_charts'));
        if (!unifiedFile) {
          setStatus(`ERROR: No unified chart file found. Files: ${mbtilesFiles.join(', ')}`);
          return;
        }
        const chartId = unifiedFile.replace('.mbtiles', '');
        console.log('[TileTest] Using chart pack:', chartId);

        // 4. Start tile server
        setStatus(`Starting tile server for ${chartId}...`);
        const serverUrl = await tileServer.startTileServer({ mbtilesDir });
        if (!serverUrl) {
          setStatus('ERROR: Failed to start tile server');
          return;
        }
        console.log('[TileTest] Tile server running at:', serverUrl);

        // 5. Build tile URL
        const url = `${serverUrl}/tiles/${chartId}/{z}/{x}/{y}.pbf`;
        console.log('[TileTest] Tile URL template:', url);
        setTileUrl(url);
        setServerReady(true);
        setStatus(`Ready: ${chartId} @ ${serverUrl}`);

        // 6. Probe a few tiles
        for (const z of [0, 2, 4, 6, 8]) {
          const lat = 61, lon = -150;
          const latRad = lat * Math.PI / 180;
          const n = Math.pow(2, z);
          const x = Math.floor((lon + 180) / 360 * n);
          const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
          try {
            const resp = await fetch(`${serverUrl}/tiles/${chartId}/${z}/${x}/${y}.pbf`);
            const blob = await resp.blob();
            console.log(`[TileTest] z${z}/${x}/${y}: ${resp.status} ${blob.size} bytes`);
          } catch (e: any) {
            console.log(`[TileTest] z${z}: ${e.message}`);
          }
        }
      } catch (e: any) {
        setStatus(`ERROR: ${e.message}`);
        console.error('[TileTest]', e);
      }
    })();
  }, []);

  if (!serverReady || !tileUrl) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#4FC3F7" />
        <Text style={styles.statusText}>{status}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>{status}</Text>
      <MapLibre.MapView
        ref={mapRef}
        style={styles.map}
        onPress={handleMapPress}
        // NO mapStyle prop — let MapLibre use defaults
      >
        <MapLibre.Camera
          defaultSettings={{
            zoomLevel: 4,
            centerCoordinate: [-150, 61],
          }}
          minZoomLevel={0}
          maxZoomLevel={15}
        />

        {/* Cover demo tiles with dark background */}
        <MapLibre.BackgroundLayer
          id="test-bg"
          style={{ backgroundColor: '#1a1a2e', backgroundOpacity: 1.0 }}
        />

        {/* Single VectorSource for all chart tiles */}
        <MapLibre.VectorSource
          id="test-charts"
          tileUrlTemplates={[tileUrl]}
          minZoomLevel={0}
          maxZoomLevel={15}
        >
          {/* DEPARE fills — COLOR-CODED BY _scaleNum to debug scale filtering */}
          {/* Red=US1, Orange=US2, Yellow=US3, Green=US4, Cyan=US5, White=no _scaleNum */}
          <MapLibre.FillLayer
            id="test-depare-fill"
            sourceLayerID="charts"
            minZoomLevel={0}
            filter={['==', ['get', 'OBJL'], 42]}
            style={{
              fillColor: [
                'case',
                ['!', ['has', '_scaleNum']], '#FFFFFF',  // white = no _scaleNum
                ['==', ['get', '_scaleNum'], 1], '#FF0000',  // red = US1
                ['==', ['get', '_scaleNum'], 2], '#FF8800',  // orange = US2
                ['==', ['get', '_scaleNum'], 3], '#FFFF00',  // yellow = US3
                ['==', ['get', '_scaleNum'], 4], '#00FF00',  // green = US4
                ['==', ['get', '_scaleNum'], 5], '#00FFFF',  // cyan = US5
                '#FF00FF',  // magenta = unknown
              ],
              fillOpacity: 0.5,
            }}
          />

          {/* DEPARE outlines — colored by scale too */}
          <MapLibre.LineLayer
            id="test-depare-outline"
            sourceLayerID="charts"
            minZoomLevel={0}
            filter={['==', ['get', 'OBJL'], 42]}
            style={{
              lineColor: '#FF4444',
              lineWidth: 1,
              lineOpacity: 0.8,
            }}
          />

          {/* LNDARE fills — visible tan */}
          <MapLibre.FillLayer
            id="test-lndare-fill"
            sourceLayerID="charts"
            minZoomLevel={0}
            filter={['==', ['get', 'OBJL'], 71]}
            style={{
              fillColor: '#3a3830',
              fillOpacity: 1.0,
            }}
          />

          {/* COALNE - Coastlines — bright white */}
          <MapLibre.LineLayer
            id="test-coalne"
            sourceLayerID="charts"
            minZoomLevel={0}
            filter={['==', ['get', 'OBJL'], 30]}
            style={{
              lineColor: '#FFFFFF',
              lineWidth: 1.5,
              lineOpacity: 1.0,
            }}
          />

          {/* DEPCNT - Depth Contours — cyan */}
          <MapLibre.LineLayer
            id="test-depcnt"
            sourceLayerID="charts"
            minZoomLevel={0}
            filter={['==', ['get', 'OBJL'], 43]}
            style={{
              lineColor: '#00FFFF',
              lineWidth: 0.5,
              lineOpacity: 0.7,
            }}
          />

          {/* ALL other features — bright magenta dots/lines for debugging */}
          <MapLibre.CircleLayer
            id="test-all-points"
            sourceLayerID="charts"
            minZoomLevel={0}
            filter={['==', ['geometry-type'], 'Point']}
            style={{
              circleColor: '#FF00FF',
              circleRadius: 3,
              circleOpacity: 0.8,
            }}
          />
        </MapLibre.VectorSource>
      </MapLibre.MapView>

      {/* Feature info overlay — tap anywhere on map to query */}
      {featureInfo && (
        <View style={styles.featureOverlay}>
          <TouchableOpacity
            style={styles.dismissBtn}
            onPress={() => setFeatureInfo(null)}
          >
            <Text style={styles.dismissText}>X</Text>
          </TouchableOpacity>
          <ScrollView style={styles.featureScroll}>
            <Text style={styles.featureText}>{featureInfo}</Text>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a14',
  },
  header: {
    color: '#4FC3F7',
    fontSize: 10,
    padding: 8,
    paddingTop: 50,
    backgroundColor: '#0a0a14',
  },
  statusText: {
    color: '#aaa',
    fontSize: 14,
    marginTop: 16,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  map: {
    flex: 1,
  },
  featureOverlay: {
    position: 'absolute',
    bottom: 20,
    left: 10,
    right: 10,
    maxHeight: 300,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#4FC3F7',
  },
  dismissBtn: {
    position: 'absolute',
    top: 4,
    right: 8,
    zIndex: 10,
    padding: 4,
  },
  dismissText: {
    color: '#FF4444',
    fontSize: 16,
    fontWeight: 'bold',
  },
  featureScroll: {
    maxHeight: 270,
  },
  featureText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
});

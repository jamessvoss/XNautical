/**
 * GPSMarkerView — Self-contained GPS position marker for the map.
 *
 * Reads from gpsDataRef on its own 1-second timer so only this tiny
 * component re-renders when GPS position changes — not the 7000-line
 * DynamicChartViewer parent with 200+ MapLibre layers.
 */

import React, { useState, useEffect, memo } from 'react';
import { View, StyleSheet } from 'react-native';
import MapLibre from '@maplibre/maplibre-react-native';
import type { GPSData } from '../../../hooks/useGPS';

interface Props {
  gpsDataRef: React.MutableRefObject<GPSData>;
}

// Sync interval — how often to read the ref and update local state.
// 1 second is plenty for a ship marker; imperceptible difference from 60Hz.
const SYNC_MS = 1000;

function GPSMarkerViewInner({ gpsDataRef }: Props) {
  const [position, setPosition] = useState<{
    lat: number | null;
    lon: number | null;
    heading: number | null;
  }>({ lat: null, lon: null, heading: null });

  useEffect(() => {
    // Read immediately on mount
    const ref = gpsDataRef.current;
    setPosition({ lat: ref.latitude, lon: ref.longitude, heading: ref.heading });

    const interval = setInterval(() => {
      const cur = gpsDataRef.current;
      setPosition(prev => {
        if (prev.lat === cur.latitude &&
            prev.lon === cur.longitude &&
            prev.heading === cur.heading) {
          return prev; // Same reference → no re-render
        }
        return { lat: cur.latitude, lon: cur.longitude, heading: cur.heading };
      });
    }, SYNC_MS);

    return () => clearInterval(interval);
  }, [gpsDataRef]);

  if (position.lat === null || position.lon === null) return null;

  return (
    <MapLibre.MarkerView
      coordinate={[position.lon, position.lat]}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={markerStyles.shipMarker}>
        <View
          style={[
            markerStyles.shipIcon,
            position.heading !== null && {
              transform: [{ rotate: `${position.heading}deg` }],
            },
          ]}
        >
          <View style={markerStyles.shipBow} />
          <View style={markerStyles.shipBody} />
        </View>
      </View>
    </MapLibre.MarkerView>
  );
}

// Inline styles matching chartViewerStyles — duplicated here so this
// component has zero dependency on the parent's stylesheet.
const markerStyles = StyleSheet.create({
  shipMarker: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  shipIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  shipBow: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#4FC3F7',
  },
  shipBody: {
    width: 16,
    height: 20,
    backgroundColor: '#4FC3F7',
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    marginTop: -2,
    borderWidth: 2,
    borderColor: '#0288D1',
    borderTopWidth: 0,
  },
});

export default memo(GPSMarkerViewInner);

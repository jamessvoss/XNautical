/**
 * NavDataOverlay — Self-contained navigation data HUD.
 *
 * Reads from gpsDataRef on its own 1-second timer so only this small
 * component re-renders when GPS values change — not the 7000-line
 * DynamicChartViewer parent.
 */

import React, { useState, useEffect, memo } from 'react';
import { View, Text, Dimensions, StyleSheet } from 'react-native';
import type { GPSData } from '../../../hooks/useGPS';

interface Props {
  gpsDataRef: React.MutableRefObject<GPSData>;
  centerCoordRef: React.MutableRefObject<[number, number]>;
  followGPS: boolean;
  currentZoom: number;
  showTideDetails: boolean;
  showCurrentDetails: boolean;
  topInset: number;
}

const SYNC_MS = 1000;

function NavDataOverlayInner({
  gpsDataRef,
  centerCoordRef,
  followGPS,
  currentZoom,
  showTideDetails,
  showCurrentDetails,
  topInset,
}: Props) {
  const [nav, setNav] = useState<{
    speedKnots: number | null;
    heading: number | null;
    course: number | null;
    latitude: number | null;
    longitude: number | null;
  }>({
    speedKnots: null,
    heading: null,
    course: null,
    latitude: null,
    longitude: null,
  });

  useEffect(() => {
    const read = () => {
      const cur = gpsDataRef.current;
      setNav(prev => {
        if (prev.speedKnots === cur.speedKnots &&
            prev.heading === cur.heading &&
            prev.course === cur.course &&
            prev.latitude === cur.latitude &&
            prev.longitude === cur.longitude) {
          return prev;
        }
        return {
          speedKnots: cur.speedKnots,
          heading: cur.heading,
          course: cur.course,
          latitude: cur.latitude,
          longitude: cur.longitude,
        };
      });
    };
    read();
    const interval = setInterval(read, SYNC_MS);
    return () => clearInterval(interval);
  }, [gpsDataRef]);

  const windowHeight = Dimensions.get('window').height;

  // Detail chart bottom offset
  const bottomOffset = showTideDetails && showCurrentDetails
    ? windowHeight * 0.30
    : (showTideDetails || showCurrentDetails)
      ? windowHeight * 0.15
      : 0;

  // Middle vertical offset
  const middleTop = showTideDetails && showCurrentDetails
    ? '30%'
    : (showTideDetails || showCurrentDetails)
      ? '40%'
      : '50%';

  return (
    <>
      {/* Upper Left - Speed */}
      <View style={[s.navDataBox, s.navDataUpperLeft, { top: topInset + 52 }]}>
        <Text style={s.navDataLabel}>SPD</Text>
        <Text style={s.navDataValue}>
          {nav.speedKnots !== null ? `${nav.speedKnots.toFixed(1)}` : '--'}
        </Text>
        <Text style={s.navDataUnit}>kn</Text>
      </View>

      {/* Upper Right - GPS/PAN Position */}
      <View style={[s.navDataBox, s.navDataUpperRight, { top: topInset + 52 }]}>
        <View style={s.navDataLabelRow}>
          <Text style={s.navDataLabel}>{followGPS ? 'GPS' : 'PAN'}</Text>
          <Text style={s.navDataZoom}>z{currentZoom.toFixed(1)}</Text>
        </View>
        {followGPS && nav.latitude !== null ? (
          <>
            <Text style={s.navDataValueSmall}>
              {`${Math.abs(nav.latitude).toFixed(4)}°${nav.latitude >= 0 ? 'N' : 'S'}`}
            </Text>
            <Text style={s.navDataValueSmall}>
              {`${Math.abs(nav.longitude!).toFixed(4)}°${nav.longitude! >= 0 ? 'E' : 'W'}`}
            </Text>
          </>
        ) : (
          <>
            <Text style={s.navDataValueSmall}>
              {`${Math.abs(centerCoordRef.current[1]).toFixed(4)}°${centerCoordRef.current[1] >= 0 ? 'N' : 'S'}`}
            </Text>
            <Text style={s.navDataValueSmall}>
              {`${Math.abs(centerCoordRef.current[0]).toFixed(4)}°${centerCoordRef.current[0] >= 0 ? 'E' : 'W'}`}
            </Text>
          </>
        )}
      </View>

      {/* Lower Left - Heading */}
      <View style={[s.navDataBox, s.navDataLowerLeft, { bottom: bottomOffset }]}>
        <Text style={s.navDataLabel}>HDG</Text>
        <Text style={s.navDataValue}>
          {nav.heading !== null ? `${Math.round(nav.heading)}` : '--'}
        </Text>
        <Text style={s.navDataUnit}>°</Text>
      </View>

      {/* Lower Right - Bearing Next */}
      <View style={[s.navDataBox, s.navDataLowerRight, { bottom: bottomOffset }]}>
        <Text style={s.navDataLabel}>BRG</Text>
        <Text style={s.navDataValue}>--</Text>
        <Text style={s.navDataUnit}>°</Text>
      </View>

      {/* Middle Left - COG */}
      <View style={[s.navDataBox, s.navDataMiddleLeft, { top: middleTop as any, marginTop: -30 }]}>
        <Text style={s.navDataLabel}>COG</Text>
        <Text style={s.navDataValue}>
          {nav.course !== null ? `${Math.round(nav.course)}` : '--'}
        </Text>
        <Text style={s.navDataUnit}>°</Text>
      </View>

      {/* Middle Right - ETE */}
      <View style={[s.navDataBox, s.navDataMiddleRight, { top: middleTop as any, marginTop: -30 }]}>
        <Text style={s.navDataLabel}>ETE</Text>
        <Text style={s.navDataValue}>--</Text>
        <Text style={s.navDataUnit}>min</Text>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  navDataBox: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 8,
    padding: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    minWidth: 80,
  },
  navDataUpperLeft: { left: 0, zIndex: 100 },
  navDataUpperRight: { right: 0, zIndex: 100 },
  navDataLowerLeft: { left: 0, zIndex: 1000 },
  navDataLowerRight: { right: 0, zIndex: 1000 },
  navDataMiddleLeft: { left: 0, zIndex: 100 },
  navDataMiddleRight: { right: 0, zIndex: 100 },
  navDataLabel: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '600',
    marginBottom: 2,
  },
  navDataLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    alignSelf: 'stretch',
    marginBottom: 2,
  },
  navDataZoom: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '500',
  },
  navDataValue: {
    fontSize: 28,
    color: '#fff',
    fontWeight: 'bold',
    fontVariant: ['tabular-nums'],
  },
  navDataValueSmall: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  navDataUnit: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: -2,
  },
});

export default memo(NavDataOverlayInner);

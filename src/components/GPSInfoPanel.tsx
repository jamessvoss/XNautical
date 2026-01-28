/**
 * GPS Info Panel - Bottom navigation data display
 * 
 * Shows key navigation data in a dark transparent bar at the bottom:
 * - DTN (Distance to Next) - placeholder until route planning
 * - ETE (Estimated Time Enroute) - placeholder until route planning
 * - Speed (in knots)
 * - Heading (magnetic heading from compass)
 * - Course (COG - Course Over Ground)
 * - Accuracy (GPS accuracy in meters)
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  GPSData,
  formatSpeed,
  formatHeading,
  formatCourse,
  formatAccuracy,
} from '../hooks/useGPS';

interface Props {
  gpsData: GPSData;
  visible: boolean;
  onClose?: () => void;
  // Future: waypoint data for DTN/ETE
  nextWaypoint?: {
    name: string;
    distanceNm: number;
    etaMinutes: number;
  } | null;
}

export default function GPSInfoPanel({ 
  gpsData, 
  visible, 
  onClose,
  nextWaypoint = null,
}: Props) {
  const insets = useSafeAreaInsets();

  if (!visible) return null;

  // Format DTN (Distance to Next Waypoint)
  const formatDTN = (): string => {
    if (!nextWaypoint) return '--';
    if (nextWaypoint.distanceNm < 0.1) {
      return `${(nextWaypoint.distanceNm * 1852).toFixed(0)}m`;
    }
    return `${nextWaypoint.distanceNm.toFixed(1)} nm`;
  };

  // Format ETE (Estimated Time Enroute)
  const formatETE = (): string => {
    if (!nextWaypoint) return '--';
    const mins = nextWaypoint.etaMinutes;
    if (mins < 60) {
      return `${Math.round(mins)}m`;
    }
    const hours = Math.floor(mins / 60);
    const remainingMins = Math.round(mins % 60);
    return `${hours}h ${remainingMins}m`;
  };

  // Get cardinal direction from heading
  const getCardinal = (heading: number | null): string => {
    if (heading === null) return '';
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(heading / 45) % 8;
    return directions[index];
  };

  // Determine GPS signal quality indicator
  const getSignalQuality = (): { color: string; bars: number } => {
    if (!gpsData.isTracking || gpsData.accuracy === null) {
      return { color: '#666', bars: 0 };
    }
    if (gpsData.accuracy <= 5) return { color: '#4CAF50', bars: 4 };
    if (gpsData.accuracy <= 15) return { color: '#8BC34A', bars: 3 };
    if (gpsData.accuracy <= 30) return { color: '#FFC107', bars: 2 };
    return { color: '#FF5722', bars: 1 };
  };

  const signal = getSignalQuality();

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {/* Top row - DTN/ETE (larger, primary info) */}
      <View style={styles.primaryRow}>
        <View style={styles.primaryItem}>
          <Text style={styles.primaryLabel}>DTN</Text>
          <Text style={styles.primaryValue}>{formatDTN()}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.primaryItem}>
          <Text style={styles.primaryLabel}>ETE</Text>
          <Text style={styles.primaryValue}>{formatETE()}</Text>
        </View>
      </View>

      {/* Bottom row - Speed, Heading, Course, Accuracy */}
      <View style={styles.secondaryRow}>
        {/* Speed */}
        <View style={styles.secondaryItem}>
          <Text style={styles.secondaryLabel}>SPD</Text>
          <Text style={styles.secondaryValue}>{formatSpeed(gpsData.speedKnots)}</Text>
        </View>

        {/* Heading (magnetic) */}
        <View style={styles.secondaryItem}>
          <Text style={styles.secondaryLabel}>HDG</Text>
          <View style={styles.headingContainer}>
            <Text style={styles.secondaryValue}>{formatHeading(gpsData.heading)}</Text>
            {gpsData.heading !== null && (
              <Text style={styles.cardinalText}>{getCardinal(gpsData.heading)}</Text>
            )}
          </View>
        </View>

        {/* Course Over Ground */}
        <View style={styles.secondaryItem}>
          <Text style={styles.secondaryLabel}>COG</Text>
          <View style={styles.headingContainer}>
            <Text style={styles.secondaryValue}>{formatCourse(gpsData.course)}</Text>
            {gpsData.course !== null && (
              <Text style={styles.cardinalText}>{getCardinal(gpsData.course)}</Text>
            )}
          </View>
        </View>

        {/* Accuracy with signal indicator */}
        <View style={styles.secondaryItem}>
          <Text style={styles.secondaryLabel}>ACC</Text>
          <View style={styles.accuracyContainer}>
            <Text style={[styles.secondaryValue, { color: signal.color }]}>
              {formatAccuracy(gpsData.accuracy)}
            </Text>
            <View style={styles.signalBars}>
              {[1, 2, 3, 4].map(bar => (
                <View 
                  key={bar}
                  style={[
                    styles.signalBar,
                    { height: 4 + bar * 3 },
                    bar <= signal.bars && { backgroundColor: signal.color },
                  ]} 
                />
              ))}
            </View>
          </View>
        </View>
      </View>

      {/* Status indicator */}
      {!gpsData.isTracking && (
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>GPS OFF</Text>
        </View>
      )}

      {gpsData.error && (
        <View style={[styles.statusBadge, styles.errorBadge]}>
          <Text style={styles.errorText}>{gpsData.error}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 70, // Sit above the bottom nav bar (ForeFlight style)
    left: 0,
    right: 0,
    backgroundColor: 'rgba(20, 25, 35, 0.95)',
    paddingTop: 12,
    paddingHorizontal: 16,
    borderRadius: 0,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  primaryRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.15)',
  },
  primaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  primaryLabel: {
    color: '#888',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 4,
  },
  primaryValue: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  divider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginHorizontal: 20,
  },
  secondaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  secondaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  secondaryLabel: {
    color: '#666',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 4,
  },
  secondaryValue: {
    color: '#ddd',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  headingContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  cardinalText: {
    color: '#888',
    fontSize: 11,
    fontWeight: '500',
  },
  accuracyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  signalBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  signalBar: {
    width: 4,
    backgroundColor: '#444',
    borderRadius: 1,
  },
  statusBadge: {
    position: 'absolute',
    top: -12,
    right: 16,
    backgroundColor: '#444',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusText: {
    color: '#888',
    fontSize: 10,
    fontWeight: '600',
  },
  errorBadge: {
    backgroundColor: 'rgba(244, 67, 54, 0.9)',
    right: 'auto',
    left: 16,
  },
  errorText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
});

/**
 * GPS Info Panel - Uses absolute positioning instead of Modal
 * to avoid conflicts with native view hierarchies
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  GPSData,
  formatSpeed,
  formatHeading,
  formatCourse,
  formatAccuracy,
} from '../hooks/useGPS';
import * as themeService from '../services/themeService';
import type { UITheme } from '../services/themeService';

interface Props {
  gpsData: GPSData | null;
  visible: boolean;
  nextWaypoint?: {
    name: string;
    distanceNm: number;
    etaMinutes: number;
  } | null;
}

export default function GPSInfoModal({ 
  gpsData, 
  visible, 
  nextWaypoint = null,
}: Props) {
  const insets = useSafeAreaInsets();
  const [uiTheme, setUITheme] = useState<UITheme>(() => {
    try {
      return themeService.getUITheme();
    } catch {
      return {
        panelBackground: 'rgba(20, 25, 35, 0.95)',
        panelBackgroundSolid: '#141923',
        cardBackground: 'rgba(255, 255, 255, 0.05)',
        textPrimary: '#FFFFFF',
        textSecondary: '#E0E0E0',
        textMuted: '#888888',
        accentPrimary: '#4FC3F7',
        accentSecondary: '#81C784',
        border: 'rgba(255, 255, 255, 0.15)',
        divider: 'rgba(255, 255, 255, 0.1)',
        danger: '#F44336',
        warning: '#FF9800',
        success: '#4CAF50',
      } as unknown as UITheme;
    }
  });
  
  // Subscribe to theme changes
  useEffect(() => {
    try {
      const unsubscribe = themeService.subscribeToModeChanges((mode) => {
        setUITheme(themeService.getUITheme(mode));
      });
      return unsubscribe;
    } catch (error) {
      console.error('[GPSInfoModal] Error subscribing to theme changes:', error);
      return () => {};
    }
  }, []);

  // Visibility is now handled at the parent level

  // Use safe gpsData with defaults
  const safeGpsData = gpsData || {
    latitude: null,
    longitude: null,
    altitude: null,
    speed: null,
    speedKnots: null,
    course: null,
    heading: null,
    accuracy: null,
    timestamp: null,
    isTracking: false,
    hasPermission: false,
    error: null,
  };

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
    if (!safeGpsData.isTracking || safeGpsData.accuracy === null) {
      return { color: '#666', bars: 0 };
    }
    if (safeGpsData.accuracy <= 5) return { color: '#4CAF50', bars: 4 };
    if (safeGpsData.accuracy <= 15) return { color: '#8BC34A', bars: 3 };
    if (safeGpsData.accuracy <= 30) return { color: '#FFC107', bars: 2 };
    return { color: '#FF5722', bars: 1 };
  };

  const signal = getSignalQuality();

  // Themed styles
  const themedContainer = {
    backgroundColor: uiTheme.panelBackground,
    borderTopColor: uiTheme.border,
  };
  const themedPrimaryRow = {
    borderBottomColor: uiTheme.divider,
  };
  const themedPrimaryLabel = {
    color: uiTheme.textSecondary,
  };
  const themedPrimaryValue = {
    color: uiTheme.textPrimary,
  };
  const themedSecondaryLabel = {
    color: uiTheme.textMuted,
  };
  const themedSecondaryValue = {
    color: uiTheme.textSecondary,
  };
  const themedCardinalText = {
    color: uiTheme.textSecondary,
  };
  const themedDivider = {
    backgroundColor: uiTheme.divider,
  };
  const themedSignalBar = {
    backgroundColor: uiTheme.border,
  };

  return (
    <View style={[styles.wrapper, { bottom: insets.bottom }]} pointerEvents="box-none">
      <View style={[styles.container, themedContainer]}>
        {/* Top row - DTN/ETE (larger, primary info) */}
        <View style={[styles.primaryRow, themedPrimaryRow]}>
          <View style={styles.primaryItem}>
            <Text style={[styles.primaryLabel, themedPrimaryLabel]}>DTN</Text>
            <Text style={[styles.primaryValue, themedPrimaryValue]}>{formatDTN()}</Text>
          </View>
          <View style={[styles.divider, themedDivider]} />
          <View style={styles.primaryItem}>
            <Text style={[styles.primaryLabel, themedPrimaryLabel]}>ETE</Text>
            <Text style={[styles.primaryValue, themedPrimaryValue]}>{formatETE()}</Text>
          </View>
        </View>

        {/* Bottom row - Speed, Heading, Course, Accuracy */}
        <View style={styles.secondaryRow}>
          {/* Speed */}
          <View style={styles.secondaryItem}>
            <Text style={[styles.secondaryLabel, themedSecondaryLabel]}>SPD</Text>
            <Text style={[styles.secondaryValue, themedSecondaryValue]}>{formatSpeed(safeGpsData.speedKnots)}</Text>
          </View>

          {/* Heading (magnetic) */}
          <View style={styles.secondaryItem}>
            <Text style={[styles.secondaryLabel, themedSecondaryLabel]}>HDG</Text>
            <View style={styles.headingContainer}>
              <Text style={[styles.secondaryValue, themedSecondaryValue]}>{formatHeading(safeGpsData.heading)}</Text>
              {safeGpsData.heading !== null && (
                <Text style={[styles.cardinalText, themedCardinalText]}>{getCardinal(safeGpsData.heading)}</Text>
              )}
            </View>
          </View>

          {/* Course Over Ground */}
          <View style={styles.secondaryItem}>
            <Text style={[styles.secondaryLabel, themedSecondaryLabel]}>COG</Text>
            <View style={styles.headingContainer}>
              <Text style={[styles.secondaryValue, themedSecondaryValue]}>{formatCourse(safeGpsData.course)}</Text>
              {safeGpsData.course !== null && (
                <Text style={[styles.cardinalText, themedCardinalText]}>{getCardinal(safeGpsData.course)}</Text>
              )}
            </View>
          </View>

          {/* Accuracy with signal indicator */}
          <View style={styles.secondaryItem}>
            <Text style={[styles.secondaryLabel, themedSecondaryLabel]}>ACC</Text>
            <View style={styles.accuracyContainer}>
              <Text style={[styles.secondaryValue, { color: signal.color }]}>
                {formatAccuracy(safeGpsData.accuracy)}
              </Text>
              <View style={styles.signalBars}>
                {[1, 2, 3, 4].map(bar => (
                  <View 
                    key={bar}
                    style={[
                      styles.signalBar,
                      themedSignalBar,
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
        {!safeGpsData.isTracking && (
          <View style={[styles.statusBadge, { backgroundColor: uiTheme.cardBackground }]}>
            <Text style={[styles.statusText, { color: uiTheme.textMuted }]}>GPS OFF</Text>
          </View>
        )}

        {safeGpsData.error && (
          <View style={[styles.statusBadge, styles.errorBadge]}>
            <Text style={styles.errorText}>{safeGpsData.error}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9998,
  },
  container: {
    backgroundColor: 'rgba(20, 25, 35, 0.95)',
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
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

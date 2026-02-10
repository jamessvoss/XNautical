/**
 * ActiveNavigation Component
 * 
 * Floating overlay showing real-time navigation data during active route following.
 * Inspired by turn-by-turn navigation interfaces.
 * 
 * Features:
 * - Next waypoint display
 * - Distance/bearing/ETA to target
 * - Cross-track error (XTE)
 * - Progress indicators
 * - Skip to next button
 * - Arrival alerts
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoutes } from '../contexts/RouteContext';
import { useGPS } from '../hooks/useGPS';
import { calculateNavigationData, isWithinArrivalRadius } from '../utils/routeCalculations';
import { formatDistance, formatBearing, formatDuration, formatETA } from '../services/routeService';
import type { NavigationLegData } from '../types/route';

interface ActiveNavigationProps {
  visible: boolean;
  position?: 'top' | 'bottom' | 'floating';
}

export default function ActiveNavigation({ visible, position = 'floating' }: ActiveNavigationProps) {
  const {
    navigation,
    allRoutes,
    advanceToNextPoint,
    stopNavigation,
    updateNavigationSettings,
  } = useRoutes();

  const { gpsData } = useGPS();
  const [navData, setNavData] = useState<NavigationLegData | null>(null);
  const [hasAlerted, setHasAlerted] = useState(false);

  // Calculate navigation data
  useEffect(() => {
    if (!visible || !navigation || !navigation.isActive) {
      setNavData(null);
      return;
    }

    const route = allRoutes.find(r => r.id === navigation.routeId);
    if (!route || gpsData.latitude === null || gpsData.longitude === null) {
      setNavData(null);
      return;
    }

    const currentPosition = {
      latitude: gpsData.latitude,
      longitude: gpsData.longitude,
    };

    const data = calculateNavigationData(
      currentPosition,
      route,
      navigation.currentPointIndex,
      navigation.cruisingSpeed,
      gpsData.speed || null, // Use actual SOG if available
      0 // TODO: Get magnetic declination based on position
    );

    setNavData(data);

    // Check for arrival at waypoint
    if (data && !hasAlerted) {
      const arrived = isWithinArrivalRadius(
        currentPosition,
        data.targetPoint.position,
        navigation.arrivalRadius
      );

      if (arrived) {
        setHasAlerted(true);
        Alert.alert(
          'Waypoint Reached',
          `Arrived at ${data.targetPoint.name || `Point ${navigation.currentPointIndex + 1}`}`,
          [
            {
              text: 'Continue',
              onPress: () => {
                if (navigation.autoAdvance) {
                  advanceToNextPoint();
                  setHasAlerted(false);
                }
              },
            },
          ]
        );
      }
    }
  }, [visible, navigation, allRoutes, gpsData, hasAlerted, advanceToNextPoint]);

  // Handle manual advance
  const handleAdvance = useCallback(() => {
    advanceToNextPoint();
    setHasAlerted(false);
  }, [advanceToNextPoint]);

  // Handle stop navigation
  const handleStop = useCallback(() => {
    Alert.alert(
      'Stop Navigation',
      'Are you sure you want to stop navigation?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop',
          style: 'destructive',
          onPress: () => {
            stopNavigation();
            setHasAlerted(false);
          },
        },
      ]
    );
  }, [stopNavigation]);

  if (!visible || !navigation || !navData) {
    return null;
  }

  const route = allRoutes.find(r => r.id === navigation.routeId);
  if (!route) return null;

  const isLastPoint = navigation.currentPointIndex >= route.routePoints.length - 1;

  return (
    <View style={[styles.container, position === 'top' && styles.containerTop, position === 'bottom' && styles.containerBottom]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="navigate" size={20} color="#4FC3F7" />
          <Text style={styles.routeName} numberOfLines={1}>
            {route.name}
          </Text>
        </View>
        <TouchableOpacity onPress={handleStop} style={styles.stopButton}>
          <Ionicons name="close-circle" size={24} color="#FF5252" />
        </TouchableOpacity>
      </View>

      {/* Main Navigation Display */}
      <View style={styles.mainDisplay}>
        {/* Distance to next */}
        <View style={styles.primaryData}>
          <Text style={styles.primaryValue}>
            {formatDistance(navData.distanceRemaining, 1).replace(' nm', '')}
          </Text>
          <Text style={styles.primaryUnit}>nm</Text>
        </View>

        {/* Target info */}
        <View style={styles.targetInfo}>
          <Text style={styles.targetLabel}>TO</Text>
          <Text style={styles.targetName} numberOfLines={1}>
            {navData.targetPoint.name || `Point ${navigation.currentPointIndex + 1}`}
          </Text>
        </View>

        {/* Bearing */}
        <View style={styles.bearingDisplay}>
          <Ionicons name="compass" size={32} color="#4FC3F7" style={{ transform: [{ rotate: `${navData.bearingToTarget}deg` }] }} />
          <Text style={styles.bearingValue}>
            {Math.round(navData.bearingToTarget)}°
          </Text>
          <Text style={styles.bearingLabel}>Bearing</Text>
        </View>
      </View>

      {/* Secondary Data */}
      <View style={styles.secondaryData}>
        <View style={styles.dataItem}>
          <Text style={styles.dataLabel}>ETA</Text>
          <Text style={styles.dataValue}>
            {formatETA(navData.eta)}
          </Text>
        </View>

        <View style={styles.dataDivider} />

        <View style={styles.dataItem}>
          <Text style={styles.dataLabel}>XTE</Text>
          <Text style={[
            styles.dataValue,
            Math.abs(navData.crossTrackError) > 0.1 && styles.dataValueWarning,
          ]}>
            {navData.crossTrackError >= 0 ? 'R' : 'L'} {Math.abs(navData.crossTrackError).toFixed(2)} nm
          </Text>
        </View>

        <View style={styles.dataDivider} />

        <View style={styles.dataItem}>
          <Text style={styles.dataLabel}>SOG</Text>
          <Text style={styles.dataValue}>
            {gpsData.speed !== null ? `${gpsData.speed.toFixed(1)} kts` : '--'}
          </Text>
        </View>
      </View>

      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${navData.routeProgress}%` }]} />
        </View>
        <Text style={styles.progressText}>
          {Math.round(navData.routeProgress)}% complete
        </Text>
      </View>

      {/* Action Buttons */}
      <View style={styles.actions}>
        {!isLastPoint && (
          <TouchableOpacity style={styles.skipButton} onPress={handleAdvance}>
            <Ionicons name="play-skip-forward" size={20} color="#fff" />
            <Text style={styles.skipButtonText}>Skip to Next</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(26, 31, 46, 0.95)',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    maxWidth: 400,
  },
  containerTop: {
    position: 'absolute',
    top: 80,
    left: 16,
    right: 16,
  },
  containerBottom: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  routeName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    flex: 1,
  },
  stopButton: {
    padding: 4,
  },
  mainDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  primaryData: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  primaryValue: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#4FC3F7',
    fontVariant: ['tabular-nums'],
  },
  primaryUnit: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '600',
  },
  targetInfo: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  targetLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '600',
    marginBottom: 4,
  },
  targetName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
  },
  bearingDisplay: {
    alignItems: 'center',
    gap: 4,
  },
  bearingValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    fontVariant: ['tabular-nums'],
  },
  bearingLabel: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  secondaryData: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 12,
  },
  dataItem: {
    alignItems: 'center',
  },
  dataLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '600',
    marginBottom: 4,
  },
  dataValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    fontVariant: ['tabular-nums'],
  },
  dataValueWarning: {
    color: '#FFB74D',
  },
  dataDivider: {
    width: 1,
    height: 30,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  progressContainer: {
    marginBottom: 12,
  },
  progressBar: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4FC3F7',
  },
  progressText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  skipButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF6B35',
    paddingVertical: 12,
    borderRadius: 8,
    gap: 6,
  },
  skipButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});

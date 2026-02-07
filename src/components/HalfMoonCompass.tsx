/**
 * Half-Moon Compass - Semicircular compass anchored near the bottom of the screen
 * 
 * Shows the top 180 degrees of a compass rose (the arc around the current heading).
 * Positioned just above the RN Navigation tab bar, and shifts up when tide/current
 * detail charts are visible.
 * 
 * Uses the same spring animation and shortest-path rotation as CompassModal.
 */

import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  shortestRotationTarget,
  getChartsHeight,
  formatHeading,
  CARDINALS,
  DEGREE_LABELS,
  TAB_BAR_HEIGHT,
  type CompassProps,
} from '../utils/compassUtils';

const COMPASS_DIAMETER = 280;
const HALF_HEIGHT = COMPASS_DIAMETER / 2;

export default function HalfMoonCompass({
  heading,
  course,
  showTideChart = false,
  showCurrentChart = false,
}: CompassProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

  // Bottom offset: tab bar + safe area + charts + margin
  const chartsHeight = getChartsHeight(showTideChart, showCurrentChart);
  const bottomOffset = insets.bottom + TAB_BAR_HEIGHT + chartsHeight + 8;

  // Animation for compass rotation
  const animatedRotation = useRef(new Animated.Value(0)).current;
  const previousRotation = useRef<number>(0);

  const rotateInterpolate = animatedRotation.interpolate({
    inputRange: [-720, 720],
    outputRange: ['-720deg', '720deg'],
  });

  useEffect(() => {
    if (heading === null) return;

    const targetRotation = -heading;
    const current = previousRotation.current;
    const adjustedTarget = shortestRotationTarget(current, targetRotation);
    previousRotation.current = adjustedTarget;

    Animated.spring(animatedRotation, {
      toValue: adjustedTarget,
      tension: 120,
      friction: 12,
      useNativeDriver: true,
    }).start();
  }, [heading, animatedRotation]);

  const displayHeading = formatHeading(heading);
  const size = COMPASS_DIAMETER;

  return (
    <View
      style={[
        styles.container,
        { bottom: bottomOffset },
      ]}
      pointerEvents="none"
    >
      {/* Heading readout */}
      <View style={styles.headingBar}>
        <Text style={styles.headingValue}>{displayHeading}°</Text>
      </View>

      {/* Semicircle clip container - shows only top half of compass */}
      <View style={[styles.clipContainer, { width: size + 8, height: HALF_HEIGHT + 4 }]}>
        {/* Outer ring */}
        <View
          style={[
            styles.outerRing,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              top: 0,
              left: 4,
            },
          ]}
        />

        {/* Rotating compass card */}
        <Animated.View
          style={[
            styles.compassCard,
            {
              width: size - 10,
              height: size - 10,
              borderRadius: (size - 10) / 2,
              top: 5,
              left: 9,
              transform: [{ rotate: rotateInterpolate }],
            },
          ]}
        >
          {/* Tick marks */}
          {Array.from({ length: 72 }, (_, i) => i * 5).map((deg) => {
            const isMajor = deg % 30 === 0;
            const isCardinal = deg % 90 === 0;
            return (
              <View
                key={deg}
                style={[
                  styles.tickContainer,
                  { transform: [{ rotate: `${deg}deg` }] },
                ]}
              >
                <View
                  style={[
                    styles.tick,
                    {
                      height: isCardinal ? 18 : isMajor ? 13 : 7,
                      width: isCardinal ? 3 : isMajor ? 2 : 1,
                      backgroundColor: deg === 0 ? '#FF3333' : '#FFFFFF',
                    },
                  ]}
                />
              </View>
            );
          })}

          {/* Cardinal direction labels */}
          {CARDINALS.map(({ label, angle, color }) => (
            <View
              key={label}
              style={[
                styles.cardinalContainer,
                { transform: [{ rotate: `${angle}deg` }] },
              ]}
            >
              <Text style={[styles.cardinalText, { color }]}>{label}</Text>
            </View>
          ))}

          {/* Degree labels */}
          {DEGREE_LABELS.map((deg) => (
            <View
              key={deg}
              style={[
                styles.degreeContainer,
                { transform: [{ rotate: `${deg}deg` }] },
              ]}
            >
              <Text style={styles.degreeText}>{deg.toString().padStart(3, '0')}</Text>
            </View>
          ))}
        </Animated.View>

        {/* Fixed lubber line at top center */}
        <View style={styles.lubberLine} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  headingBar: {
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 4,
  },
  headingValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    fontFamily: 'monospace',
  },
  clipContainer: {
    overflow: 'hidden',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderTopLeftRadius: 150,
    borderTopRightRadius: 150,
  },
  outerRing: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    backgroundColor: 'transparent',
  },
  compassCard: {
    position: 'absolute',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickContainer: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    alignItems: 'center',
  },
  tick: {
    position: 'absolute',
    top: 6,
  },
  cardinalContainer: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    alignItems: 'center',
    paddingTop: 26,
  },
  cardinalText: {
    fontSize: 20,
    fontWeight: 'bold',
    textShadowColor: '#000',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
  },
  degreeContainer: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    alignItems: 'center',
    paddingTop: 48,
  },
  degreeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#AAAAAA',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  lubberLine: {
    position: 'absolute',
    top: -2,
    width: 5,
    height: 32,
    backgroundColor: '#FF3333',
    borderRadius: 2.5,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    alignSelf: 'center',
  },
});

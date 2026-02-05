/**
 * Compass Modal - Smooth compass display using sensor fusion
 * 
 * OPTIMIZED VERSION:
 * - Receives pre-smoothed heading from useDeviceHeading hook (60Hz sensor fusion)
 * - Uses spring animation with native driver for butter-smooth rotation
 * - Implements shortest-path rotation to avoid 358° backwards spin
 * - No heavy filtering or dead zones needed (sensor fusion handles jitter)
 */

import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Animated,
} from 'react-native';

interface Props {
  visible: boolean;
  heading: number | null;
  course: number | null;
  showTideChart?: boolean;
  showCurrentChart?: boolean;
}

// Chart height as percentage of screen (must match TideDetailChart/CurrentDetailChart)
const CHART_HEIGHT_PERCENT = 0.15;

/**
 * Calculate shortest rotation path to avoid spinning backwards.
 * E.g., going from 359° to 1° should rotate +2°, not -358°.
 */
function shortestRotationTarget(from: number, to: number): number {
  let delta = ((to - from + 540) % 360) - 180;
  return from + delta;
}

export default function CompassModal({ 
  heading, 
  course, 
  showTideChart = false, 
  showCurrentChart = false 
}: Props) {
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  const size = Math.min(screenWidth, screenHeight) - 60;
  
  // Calculate vertical offset based on visible charts
  const chartCount = (showTideChart ? 1 : 0) + (showCurrentChart ? 1 : 0);
  const chartsHeight = chartCount * (screenHeight * CHART_HEIGHT_PERCENT);
  
  // Animation for compass rotation
  const animatedRotation = useRef(new Animated.Value(0)).current;
  const previousRotation = useRef<number>(0);

  // Interpolate rotation for transform
  const rotateInterpolate = animatedRotation.interpolate({
    inputRange: [-720, 720],
    outputRange: ['-720deg', '720deg'],
  });

  // Animate rotation with spring physics
  useEffect(() => {
    if (heading === null) return;

    // Calculate rotation (negative because compass card rotates opposite to heading)
    const targetRotation = -heading;
    const current = previousRotation.current;
    
    // Find shortest path rotation
    const adjustedTarget = shortestRotationTarget(current, targetRotation);
    previousRotation.current = adjustedTarget;

    // Spring animation for natural, responsive feel
    Animated.spring(animatedRotation, {
      toValue: adjustedTarget,
      tension: 120,      // Higher = faster response
      friction: 12,      // Higher = less oscillation
      useNativeDriver: true,
    }).start();
  }, [heading, animatedRotation]);

  const displayHeading = heading !== null ? Math.round(heading) : '--';

  // Cardinal labels positioned around the compass
  const cardinals = [
    { label: 'N', angle: 0, color: '#FF3333' },
    { label: 'E', angle: 90, color: '#FFFFFF' },
    { label: 'S', angle: 180, color: '#FFFFFF' },
    { label: 'W', angle: 270, color: '#FFFFFF' },
  ];

  // Degree labels
  const degrees = [30, 60, 120, 150, 210, 240, 300, 330];

  return (
    <View style={styles.overlay} pointerEvents="none">
      <View style={[styles.compassContainer, { width: size, height: size, marginBottom: chartsHeight }]}>
        
        {/* Outer ring */}
        <View style={[styles.outerRing, { width: size, height: size, borderRadius: size / 2 }]} />
        
        {/* Rotating compass card */}
        <Animated.View 
          style={[
            styles.compassCard,
            { 
              width: size - 10, 
              height: size - 10, 
              borderRadius: (size - 10) / 2,
              transform: [{ rotate: rotateInterpolate }] 
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
                      height: isCardinal ? 20 : isMajor ? 15 : 8,
                      width: isCardinal ? 3 : isMajor ? 2 : 1,
                      backgroundColor: deg === 0 ? '#FF3333' : '#FFFFFF',
                    },
                  ]}
                />
              </View>
            );
          })}

          {/* Cardinal direction labels */}
          {cardinals.map(({ label, angle, color }) => (
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
          {degrees.map((deg) => (
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

        {/* Fixed lubber line at top */}
        <View style={styles.lubberLine} />
        
        {/* Heading display just below lubber line */}
        <View style={styles.headingDisplay}>
          <Text style={styles.headingValue}>{displayHeading}°</Text>
        </View>

        {/* Ship icon at center */}
        <View style={styles.shipIconContainer}>
          <View style={styles.shipBow} />
          <View style={styles.shipHull} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  compassContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  outerRing: {
    position: 'absolute',
    borderWidth: 4,
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
    top: 8,
  },
  cardinalContainer: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    alignItems: 'center',
    paddingTop: 32,
  },
  cardinalText: {
    fontSize: 26,
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
    paddingTop: 58,
  },
  degreeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#AAAAAA',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  lubberLine: {
    position: 'absolute',
    top: -2,
    width: 6,
    height: 40,
    backgroundColor: '#FF3333',
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  headingDisplay: {
    position: 'absolute',
    top: 45,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
  },
  headingValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    fontFamily: 'monospace',
  },
  shipIconContainer: {
    position: 'absolute',
    alignItems: 'center',
    top: '50%',
    marginTop: 50,
  },
  shipBow: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 16,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#4FC3F7',
  },
  shipHull: {
    width: 16,
    height: 20,
    backgroundColor: '#4FC3F7',
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    marginTop: -2,
  },
});

/**
 * Compass Overlay - Pure React Native (NO SVG to avoid Fabric issues)
 */

import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Animated,
  Easing,
} from 'react-native';

interface Props {
  visible: boolean;
  heading: number | null;
  course: number | null;
}

// Smoothing constants - heavily damped for jittery phone magnetometers on boats
const EMA_ALPHA = 0.08; // Very smooth (lower = smoother)
const MAX_ROTATION_RATE = 15; // degrees per second - like a damped marine compass
const DEAD_ZONE = 4; // Ignore changes smaller than this (degrees)

// Circular EMA for heading (handles 360 wraparound)
function circularEMA(current: number, newValue: number, alpha: number): number {
  // Convert to radians for circular math
  const currRad = current * Math.PI / 180;
  const newRad = newValue * Math.PI / 180;
  
  // EMA on sin/cos components
  const sinEMA = Math.sin(currRad) * (1 - alpha) + Math.sin(newRad) * alpha;
  const cosEMA = Math.cos(currRad) * (1 - alpha) + Math.cos(newRad) * alpha;
  
  // Convert back to degrees
  let result = Math.atan2(sinEMA, cosEMA) * 180 / Math.PI;
  if (result < 0) result += 360;
  return result;
}

// Adaptive animation duration based on heading change
function getAnimationDuration(headingChange: number): number {
  const absDiff = Math.abs(headingChange);
  if (absDiff < 5) return 400;   // Small changes: smooth
  if (absDiff < 15) return 300;  // Medium changes: normal
  if (absDiff < 30) return 200;  // Large changes: quick
  return 150;                     // Very large: snappy
}

export default function CompassModal({ heading, course }: Props) {
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  const size = Math.min(screenWidth, screenHeight) - 60;
  
  // Animation for compass rotation
  const animatedRotation = useRef(new Animated.Value(0)).current;
  const previousHeading = useRef<number>(0);
  
  // Smoothing state
  const smoothedHeading = useRef<number | null>(null);
  const lastUpdateTime = useRef<number>(Date.now());

  // Interpolate rotation
  const rotateInterpolate = animatedRotation.interpolate({
    inputRange: [-360, 360],
    outputRange: ['-360deg', '360deg'],
  });

  // Rate limiter function
  const rateLimitHeading = (current: number, target: number): number => {
    const now = Date.now();
    const deltaTime = (now - lastUpdateTime.current) / 1000;
    lastUpdateTime.current = now;
    
    const maxChange = MAX_ROTATION_RATE * deltaTime;
    let diff = target - current;
    
    // Shortest path
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    
    // Clamp to max rate
    if (Math.abs(diff) > maxChange) {
      diff = Math.sign(diff) * maxChange;
    }
    
    return (current + diff + 360) % 360;
  };

  // Animate rotation with smoothing
  useEffect(() => {
    if (heading === null) return;

    // Apply circular EMA smoothing
    if (smoothedHeading.current === null) {
      smoothedHeading.current = heading;
    } else {
      smoothedHeading.current = circularEMA(smoothedHeading.current, heading, EMA_ALPHA);
    }
    
    // Apply rate limiting
    const rateLimitedHeading = rateLimitHeading(
      smoothedHeading.current,
      heading
    );
    smoothedHeading.current = rateLimitedHeading;

    // Dead zone - ignore very small changes to reduce jitter
    let deadZoneDiff = rateLimitedHeading - (-previousHeading.current);
    if (deadZoneDiff > 180) deadZoneDiff -= 360;
    if (deadZoneDiff < -180) deadZoneDiff += 360;
    if (Math.abs(deadZoneDiff) < DEAD_ZONE) return;

    let targetRotation = -rateLimitedHeading;
    const current = previousHeading.current;
    
    // Shortest path rotation
    let diff = targetRotation - current;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    
    const newValue = current + diff;
    previousHeading.current = newValue;

    // Adaptive animation duration
    const duration = getAnimationDuration(diff);

    Animated.timing(animatedRotation, {
      toValue: newValue,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [heading]);

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
      <View style={[styles.compassContainer, { width: size, height: size }]}>
        
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

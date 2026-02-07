/**
 * Minimal Compass - Small circular heading indicator in the top-right corner
 * 
 * A compact compass (~70px) with a rotating needle and numeric heading readout.
 * Designed for minimal chart obstruction while still providing heading awareness.
 * 
 * Includes a COG (Course Over Ground) indicator as a small yellow tick when
 * COG differs from heading by more than 5 degrees.
 */

import React, { useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  Line,
  Text as SvgText,
  Path,
  G,
} from 'react-native-svg';
import {
  shortestRotationTarget,
  formatHeading,
  type CompassProps,
} from '../utils/compassUtils';

const SIZE = 70;
const CENTER = SIZE / 2;
const OUTER_RADIUS = SIZE / 2 - 2;
const TICK_OUTER = OUTER_RADIUS - 3;

export default function MinimalCompass({
  heading,
  course,
  showTideChart = false,
  showCurrentChart = false,
}: CompassProps) {
  const insets = useSafeAreaInsets();

  // Position: top-right, below the menu bar area
  const topOffset = insets.top + 52 + 8;

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

  // Calculate COG indicator rotation relative to heading
  const cogAngle = useMemo(() => {
    if (course === null || heading === null) return null;
    const diff = Math.abs(((course - heading + 540) % 360) - 180);
    if (diff <= 5) return null;
    return course - heading;
  }, [course, heading]);

  const displayHeading = formatHeading(heading);

  return (
    <View
      style={[styles.container, { top: topOffset }]}
      pointerEvents="none"
    >
      <View style={styles.compassWrapper}>
        {/* Rotating compass ring */}
        <Animated.View
          style={[
            styles.rotatingLayer,
            {
              width: SIZE,
              height: SIZE,
              transform: [{ rotate: rotateInterpolate }],
            },
          ]}
        >
          <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
            {/* Outer ring */}
            <Circle
              cx={CENTER}
              cy={CENTER}
              r={OUTER_RADIUS}
              fill="rgba(0, 0, 0, 0.6)"
              stroke="rgba(255, 255, 255, 0.5)"
              strokeWidth={1.5}
            />

            {/* Tick marks - every 30 degrees */}
            {Array.from({ length: 12 }, (_, i) => i * 30).map((deg) => {
              const isCardinal = deg % 90 === 0;
              const rad = (deg - 90) * Math.PI / 180;
              const outerR = TICK_OUTER;
              const innerR = isCardinal ? outerR - 10 : outerR - 6;
              return (
                <Line
                  key={`t-${deg}`}
                  x1={CENTER + Math.cos(rad) * outerR}
                  y1={CENTER + Math.sin(rad) * outerR}
                  x2={CENTER + Math.cos(rad) * innerR}
                  y2={CENTER + Math.sin(rad) * innerR}
                  stroke={deg === 0 ? '#FF3333' : '#FFFFFF'}
                  strokeWidth={isCardinal ? 2 : 1}
                  strokeLinecap="round"
                />
              );
            })}

            {/* Cardinal labels */}
            {[
              { label: 'N', angle: 0, color: '#FF3333' },
              { label: 'E', angle: 90, color: '#FFFFFF' },
              { label: 'S', angle: 180, color: '#FFFFFF' },
              { label: 'W', angle: 270, color: '#FFFFFF' },
            ].map(({ label, angle, color }) => {
              const rad = (angle - 90) * Math.PI / 180;
              const labelR = OUTER_RADIUS - 18;
              return (
                <SvgText
                  key={`c-${label}`}
                  x={CENTER + Math.cos(rad) * labelR}
                  y={CENTER + Math.sin(rad) * labelR}
                  fill={color}
                  fontSize={9}
                  fontWeight="bold"
                  textAnchor="middle"
                  alignmentBaseline="central"
                >
                  {label}
                </SvgText>
              );
            })}
          </Svg>
        </Animated.View>

        {/* Fixed elements (lubber line, center dot, COG) */}
        <Svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          style={StyleSheet.absoluteFill}
        >
          {/* Fixed lubber line at top */}
          <Line
            x1={CENTER}
            y1={3}
            x2={CENTER}
            y2={14}
            stroke="#FF3333"
            strokeWidth={3}
            strokeLinecap="round"
          />

          {/* Center dot */}
          <Circle
            cx={CENTER}
            cy={CENTER}
            r={2.5}
            fill="#4FC3F7"
          />

          {/* COG indicator */}
          {cogAngle !== null && (
            <G rotation={cogAngle} origin={`${CENTER}, ${CENTER}`}>
              <Path
                d={`M ${CENTER - 3} 6 L ${CENTER} 2 L ${CENTER + 3} 6`}
                fill="none"
                stroke="#FFC107"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </G>
          )}
        </Svg>
      </View>

      {/* Heading readout below */}
      <View style={styles.headingBox}>
        <Text style={styles.headingText}>{displayHeading}°</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 12,
    alignItems: 'center',
  },
  compassWrapper: {
    width: SIZE,
    height: SIZE,
  },
  rotatingLayer: {
    position: 'absolute',
  },
  headingBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 3,
  },
  headingText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FFFFFF',
    fontFamily: 'monospace',
  },
});

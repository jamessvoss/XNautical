/**
 * Ticker-Tape Compass - Horizontal heading strip near the top of the screen
 * 
 * Similar to an aviation/military HUD heading tape. Shows a horizontal sliding
 * strip with ~120 degrees of heading range visible at once. Cardinal letters
 * and degree marks scroll horizontally, with a fixed center lubber line.
 * 
 * Uses Animated.View with horizontal translateX driven by heading for smooth
 * native-driver animation.
 */

import React, { useRef, useEffect, useMemo } from 'react';
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
  formatHeading,
  type CompassProps,
} from '../utils/compassUtils';

const TAPE_HEIGHT = 50;
const DEGREES_VISIBLE = 120; // degrees of heading visible at once
const PIXELS_PER_DEGREE = 3; // how many pixels per degree of heading

// Total tape width: full 360 + buffer on each side for wrap-around
// We render 360*3 degrees worth of marks (one full revolution repeated 3x)
// to allow seamless wrapping
const TAPE_REPEAT = 3;
const TAPE_TOTAL_DEGREES = 360 * TAPE_REPEAT;
const TAPE_WIDTH = TAPE_TOTAL_DEGREES * PIXELS_PER_DEGREE;

// Generate all marks for the tape
interface TapeMark {
  degree: number;        // 0-359 actual degree
  offsetX: number;       // pixel position on the tape
  isCardinal: boolean;
  isMajor: boolean;      // every 10 degrees
  isLabeled: boolean;    // every 30 degrees
  label: string;
}

function generateTapeMarks(): TapeMark[] {
  const marks: TapeMark[] = [];
  const cardinalMap: Record<number, string> = {
    0: 'N', 90: 'E', 180: 'S', 270: 'W',
  };

  for (let rep = 0; rep < TAPE_REPEAT; rep++) {
    for (let deg = 0; deg < 360; deg += 5) {
      const actualDeg = deg;
      const globalDeg = rep * 360 + deg;
      const offsetX = globalDeg * PIXELS_PER_DEGREE;
      const isCardinal = deg % 90 === 0;
      const isMajor = deg % 10 === 0;
      const isLabeled = deg % 30 === 0;

      let label = '';
      if (isCardinal) {
        label = cardinalMap[deg];
      } else if (isLabeled) {
        label = deg.toString().padStart(3, '0');
      }

      marks.push({
        degree: actualDeg,
        offsetX,
        isCardinal,
        isMajor,
        isLabeled,
        label,
      });
    }
  }

  return marks;
}

export default function TickerTapeCompass({
  heading,
  course,
  showTideChart = false,
  showCurrentChart = false,
}: CompassProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = Dimensions.get('window');

  // Position below the top menu bar area
  const topOffset = insets.top + 52;

  // Animation for horizontal translation
  const animatedTranslateX = useRef(new Animated.Value(0)).current;
  const previousHeading = useRef<number>(0);

  // Generate marks once
  const tapeMarks = useMemo(() => generateTapeMarks(), []);

  // Center of the tape (middle repetition)
  const tapeCenter = 360 * PIXELS_PER_DEGREE; // start of the middle repetition

  useEffect(() => {
    if (heading === null) return;

    // Calculate target: we want the current heading centered
    // The tape is laid out 0..1080 degrees (3 repetitions)
    // We use the middle repetition (360..720) as the reference
    const targetHeading = heading;
    const current = previousHeading.current;

    // Use shortest path to avoid jumps
    const adjustedTarget = shortestRotationTarget(current, targetHeading);
    previousHeading.current = adjustedTarget;

    // Calculate translateX: move the tape so that adjustedTarget is centered
    // tapeCenter is the pixel position of degree 0 in the middle repetition
    const targetX = -(tapeCenter + adjustedTarget * PIXELS_PER_DEGREE - screenWidth / 2);

    Animated.spring(animatedTranslateX, {
      toValue: targetX,
      tension: 120,
      friction: 12,
      useNativeDriver: true,
    }).start();
  }, [heading, animatedTranslateX, screenWidth]);

  const displayHeading = formatHeading(heading);

  return (
    <View
      style={[styles.container, { top: topOffset, width: screenWidth }]}
      pointerEvents="none"
    >
      {/* Tape clip area */}
      <View style={styles.tapeClip}>
        <Animated.View
          style={[
            styles.tape,
            {
              width: TAPE_WIDTH,
              transform: [{ translateX: animatedTranslateX }],
            },
          ]}
        >
          {tapeMarks.map((mark, i) => (
            <View
              key={i}
              style={[
                styles.markContainer,
                { left: mark.offsetX },
              ]}
            >
              <View
                style={[
                  styles.tickMark,
                  {
                    height: mark.isCardinal ? 20 : mark.isMajor ? 14 : 8,
                    width: mark.isCardinal ? 2.5 : mark.isMajor ? 1.5 : 1,
                    backgroundColor: mark.degree === 0 ? '#FF3333' : '#FFFFFF',
                  },
                ]}
              />
              {mark.isLabeled && (
                <Text
                  style={[
                    styles.markLabel,
                    mark.isCardinal && styles.cardinalLabel,
                    mark.degree === 0 && styles.northLabel,
                  ]}
                >
                  {mark.label}
                </Text>
              )}
            </View>
          ))}
        </Animated.View>

        {/* Fixed center lubber line */}
        <View style={styles.lubberLine} />
      </View>

      {/* Heading readout centered below the tape */}
      <View style={styles.headingBox}>
        <Text style={styles.headingText}>{displayHeading}°</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    alignItems: 'center',
  },
  tapeClip: {
    width: '100%',
    height: TAPE_HEIGHT,
    overflow: 'hidden',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.3)',
  },
  tape: {
    position: 'absolute',
    height: TAPE_HEIGHT,
    flexDirection: 'row',
  },
  markContainer: {
    position: 'absolute',
    alignItems: 'center',
    height: TAPE_HEIGHT,
    justifyContent: 'flex-end',
    paddingBottom: 2,
  },
  tickMark: {
    position: 'absolute',
    top: 0,
  },
  markLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#AAAAAA',
    fontFamily: 'monospace',
    position: 'absolute',
    bottom: 4,
  },
  cardinalLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  northLabel: {
    color: '#FF3333',
  },
  lubberLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: 2,
    marginLeft: -1,
    backgroundColor: '#FF3333',
  },
  headingBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
  },
  headingText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
    fontFamily: 'monospace',
  },
});

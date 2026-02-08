/**
 * Compass Overlay - Full viewport HUD-style magnetic compass
 * 
 * OPTIMIZED VERSION:
 * - Uses Animated.View with useNativeDriver for smooth 60fps rotation
 * - Memoizes static SVG content to prevent re-renders
 * - Separates rotating elements from fixed elements
 * - Supports S-52 Day/Dusk/Night theming
 */

import React, { useEffect, useRef, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Animated,
  Easing,
} from 'react-native';
import Svg, {
  Circle,
  Line,
  Text as SvgText,
  G,
  Path,
} from 'react-native-svg';
import * as themeService from '../services/themeService';
import type { S52DisplayMode } from '../services/themeService';

interface Props {
  heading: number | null;  // Magnetic heading in degrees
  course: number | null;   // Course over ground (optional)
  visible: boolean;
  showTideChart?: boolean;    // Tide detail chart visible at bottom
  showCurrentChart?: boolean; // Current detail chart visible at bottom
  showNavData?: boolean;      // Nav data boxes visible (reduces compass size)
}

// Chart height as percentage of screen (must match TideDetailChart/CurrentDetailChart)
const CHART_HEIGHT_PERCENT = 0.15;

// Color scheme for different display modes
interface CompassColors {
  outline: string;      // Tick outline and ring
  fill: string;         // Tick fill and text
  textOutline: string;  // Text halo
}

// Get colors for current display mode
const getCompassColors = (mode: S52DisplayMode): CompassColors => {
  switch (mode) {
    case 'day':
      return {
        outline: '#FFFFFF',
        fill: '#000000',
        textOutline: '#FFFFFF',
      };
    case 'dusk':
      return {
        outline: '#000000',
        fill: '#E0E0E0',
        textOutline: '#000000',
      };
    case 'night':
      return {
        outline: '#101010',
        fill: '#404040',
        textOutline: '#101010',
      };
  }
};

// Rotating compass rose component (memo removed to fix Android crash)
const CompassRose = ({ size, colors }: { size: number; colors: CompassColors }) => {
  const center = size / 2;
  const outerRadius = size / 2 - 2;
  const tickOuterRadius = outerRadius - 4;
  const majorTickLength = 20;
  const minorTickLength = 10;
  const labelRadius = outerRadius - 35;
  const degreeRadius = outerRadius - 55;

  // Cardinal directions
  const cardinals = [
    { angle: 0, label: 'N', size: 24 },
    { angle: 90, label: 'E', size: 20 },
    { angle: 180, label: 'S', size: 20 },
    { angle: 270, label: 'W', size: 20 },
  ];

  // Degree labels (every 30°, excluding cardinals)
  const degreeLabels = [30, 60, 120, 150, 210, 240, 300, 330];

  // Pre-calculate all tick data
  const ticks = useMemo(() => {
    const result: { angle: number; length: number; width: number; x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let i = 0; i < 360; i += 5) {
      let length: number;
      let width: number;
      
      if (i % 30 === 0) {
        length = majorTickLength;
        width = i === 0 ? 5 : 3;
      } else if (i % 10 === 0) {
        length = 14;
        width = 2;
      } else {
        length = minorTickLength;
        width = 1.5;
      }
      
      const rad = (i - 90) * Math.PI / 180;
      result.push({
        angle: i,
        length,
        width,
        x1: center + Math.cos(rad) * tickOuterRadius,
        y1: center + Math.sin(rad) * tickOuterRadius,
        x2: center + Math.cos(rad) * (tickOuterRadius - length),
        y2: center + Math.sin(rad) * (tickOuterRadius - length),
      });
    }
    return result;
  }, [center, tickOuterRadius]);

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Tick marks - outline */}
      {ticks.map((tick, i) => (
        <Line
          key={`to-${i}`}
          x1={tick.x1}
          y1={tick.y1}
          x2={tick.x2}
          y2={tick.y2}
          stroke={colors.outline}
          strokeWidth={tick.width + 2}
          strokeLinecap="round"
        />
      ))}
      
      {/* Tick marks - fill */}
      {ticks.map((tick, i) => (
        <Line
          key={`t-${i}`}
          x1={tick.x1}
          y1={tick.y1}
          x2={tick.x2}
          y2={tick.y2}
          stroke={colors.fill}
          strokeWidth={tick.width}
          strokeLinecap="round"
        />
      ))}

      {/* Cardinal direction labels */}
      {cardinals.map(({ angle, label, size: fontSize }) => {
        const rad = (angle - 90) * Math.PI / 180;
        const x = center + Math.cos(rad) * labelRadius;
        const y = center + Math.sin(rad) * labelRadius;
        
        return (
          <G key={`c-${angle}`}>
            <SvgText
              x={x}
              y={y}
              fill="none"
              stroke={colors.textOutline}
              strokeWidth={3}
              fontSize={fontSize}
              fontWeight="bold"
              textAnchor="middle"
              alignmentBaseline="central"
            >
              {label}
            </SvgText>
            <SvgText
              x={x}
              y={y}
              fill={colors.fill}
              fontSize={fontSize}
              fontWeight="bold"
              textAnchor="middle"
              alignmentBaseline="central"
            >
              {label}
            </SvgText>
          </G>
        );
      })}

      {/* Degree labels */}
      {degreeLabels.map((angle) => {
        const rad = (angle - 90) * Math.PI / 180;
        const x = center + Math.cos(rad) * degreeRadius;
        const y = center + Math.sin(rad) * degreeRadius;
        const label = angle.toString().padStart(3, '0');
        
        return (
          <G key={`d-${angle}`}>
            <SvgText
              x={x}
              y={y}
              fill="none"
              stroke={colors.textOutline}
              strokeWidth={2.5}
              fontSize={14}
              fontWeight="600"
              textAnchor="middle"
              alignmentBaseline="central"
            >
              {label}
            </SvgText>
            <SvgText
              x={x}
              y={y}
              fill={colors.fill}
              fontSize={14}
              fontWeight="600"
              textAnchor="middle"
              alignmentBaseline="central"
            >
              {label}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
};

// Fixed elements component (outer ring, lubber line, ship icon) - memo removed to fix Android crash
const FixedElements = ({ size, cogRotation, colors }: { size: number; cogRotation: number | null; colors: CompassColors }) => {
  const center = size / 2;
  const outerRadius = size / 2 - 2;
  const innerClearRadius = size / 2 - 80;

  return (
    <Svg 
      width={size} 
      height={size} 
      viewBox={`0 0 ${size} ${size}`}
      style={StyleSheet.absoluteFill}
    >
      {/* Outer ring - outline */}
      <Circle
        cx={center}
        cy={center}
        r={outerRadius}
        fill="none"
        stroke={colors.outline}
        strokeWidth={4}
      />
      <Circle
        cx={center}
        cy={center}
        r={outerRadius}
        fill="none"
        stroke={colors.fill}
        strokeWidth={2}
      />

      {/* Fixed lubber line at top */}
      <Line
        x1={center}
        y1={8}
        x2={center}
        y2={35}
        stroke={colors.outline}
        strokeWidth={7}
        strokeLinecap="round"
      />
      <Line
        x1={center}
        y1={8}
        x2={center}
        y2={35}
        stroke={colors.fill}
        strokeWidth={4}
        strokeLinecap="round"
      />
      
      {/* Fixed ship icon at center */}
      <Path
        d={`
          M ${center} ${center - 25}
          L ${center + 12} ${center + 18}
          Q ${center + 10} ${center + 24} ${center} ${center + 20}
          Q ${center - 10} ${center + 24} ${center - 12} ${center + 18}
          Z
        `}
        fill="rgba(79, 195, 247, 0.3)"
        stroke="#4FC3F7"
        strokeWidth={2}
      />
      <Line
        x1={center}
        y1={center - 25}
        x2={center}
        y2={center - 40}
        stroke="#4FC3F7"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <Circle
        cx={center}
        cy={center}
        r={4}
        fill="#4FC3F7"
      />

      {/* COG indicator (if different from heading by >5°) */}
      {cogRotation !== null && (
        <G
          rotation={cogRotation}
          origin={`${center}, ${center}`}
        >
          <Line
            x1={center}
            y1={center - innerClearRadius + 20}
            x2={center}
            y2={center - innerClearRadius + 40}
            stroke="#FFC107"
            strokeWidth={4}
            strokeLinecap="round"
          />
          <Path
            d={`M ${center - 8} ${center - innerClearRadius + 40} L ${center} ${center - innerClearRadius + 28} L ${center + 8} ${center - innerClearRadius + 40}`}
            fill="none"
            stroke="#FFC107"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </G>
      )}
    </Svg>
  );
};

export default function CompassOverlay({
  heading,
  course,
  visible,
  showTideChart = false,
  showCurrentChart = false,
  showNavData = false,
}: Props) {
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  
  // Calculate compass size
  // When nav data is showing, constrain to fit between the lower left/right boxes
  // The nav boxes have minWidth: 80px but can be wider with content, so add extra margin
  const availableWidth = showNavData ? screenWidth - 200 : screenWidth; // Conservative: 100px margin on each side
  const size = Math.min(availableWidth, screenHeight) - 20;
  const center = size / 2;
  
  // Calculate vertical offset based on visible charts
  // Charts take up space at the bottom, so we center compass in remaining space
  const chartCount = (showTideChart ? 1 : 0) + (showCurrentChart ? 1 : 0);
  const chartsHeight = chartCount * (screenHeight * CHART_HEIGHT_PERCENT);
  
  // Theme state - with safe default
  const [displayMode, setDisplayMode] = useState<S52DisplayMode>(() => {
    try {
      return themeService.getCurrentMode();
    } catch {
      return 'day';
    }
  });
  const compassColors = useMemo(() => getCompassColors(displayMode), [displayMode]);
  
  // Subscribe to theme changes
  useEffect(() => {
    try {
      const unsubscribe = themeService.subscribeToModeChanges((mode) => {
        setDisplayMode(mode);
      });
      return unsubscribe;
    } catch (error) {
      console.error('[CompassOverlay] Error subscribing to theme changes:', error);
      return () => {}; // No-op cleanup
    }
  }, []);
  
  // Animation ref - persists across renders
  const animatedRotation = useRef(new Animated.Value(0)).current;
  const previousHeading = useRef<number>(0);
  const headingHistory = useRef<number[]>([]);

  // Smooth heading using circular moving average
  const smoothHeading = (newHeading: number): number => {
    const history = headingHistory.current;
    history.push(newHeading);
    if (history.length > 5) history.shift();
    
    let sinSum = 0, cosSum = 0;
    for (const h of history) {
      sinSum += Math.sin(h * Math.PI / 180);
      cosSum += Math.cos(h * Math.PI / 180);
    }
    
    let avg = Math.atan2(sinSum, cosSum) * 180 / Math.PI;
    if (avg < 0) avg += 360;
    return avg;
  };

  // Calculate COG difference for the indicator
  const cogRotation = useMemo(() => {
    if (course === null || heading === null) return null;
    const diff = Math.abs(((course - heading + 540) % 360) - 180);
    if (diff <= 5) return null;
    return course - heading;
  }, [course, heading]);

  // Interpolate rotation for the transform
  const rotateInterpolate = animatedRotation.interpolate({
    inputRange: [-360, 360],
    outputRange: ['-360deg', '360deg'],
  });

  // Animate rotation with native driver
  useEffect(() => {
    if (heading === null || !visible) return;

    const smoothed = smoothHeading(heading);
    let targetRotation = -smoothed;
    const current = previousHeading.current;
    
    // Shortest path rotation
    let diff = targetRotation - current;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    
    const newValue = current + diff;
    previousHeading.current = newValue;

    Animated.timing(animatedRotation, {
      toValue: newValue,
      duration: 400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [heading, visible]);

  // ALWAYS render the same structure - use opacity/scale to hide
  // This avoids the Android "child already has parent" crash caused by
  // returning different JSX structures when visibility changes
  const displayHeading = heading !== null ? Math.round(heading) : '--';
  
  return (
    <View 
      style={[
        styles.container,
        !visible && styles.invisible,
      ]} 
      pointerEvents={visible ? "none" : "box-none"}
    >
      <View 
        style={[
          styles.simpleCompass, 
          { 
            width: size, 
            height: size,
            marginBottom: chartsHeight, // Shift compass up to account for charts at bottom
          }
        ]}
        onLayout={(event) => {
          const { x, y, width, height } = event.nativeEvent.layout;
          console.log(`[CompassOverlay] ACTUAL POSITION: x=${x}, y=${y}, width=${width}, height=${height}`);
          console.log(`[CompassOverlay] Center of compass: y=${y + height/2} (screen center would be ${screenHeight/2})`);
        }}
      >
        <Text style={styles.headingText}>{displayHeading}°</Text>
        <Text style={styles.labelText}>HDG</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  invisible: {
    opacity: 0,
    transform: [{ scale: 0.001 }],
  },
  compassWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rotatingLayer: {
    position: 'absolute',
  },
  // Simple text compass styles (temporary)
  simpleCompass: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 200,
    borderWidth: 4,
    borderColor: '#4FC3F7',
  },
  headingText: {
    fontSize: 72,
    fontWeight: 'bold',
    color: '#FFFFFF',
    fontFamily: 'monospace',
  },
  labelText: {
    fontSize: 24,
    color: '#888888',
    marginTop: 8,
  },
});

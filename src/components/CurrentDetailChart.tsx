/**
 * CurrentDetailChart - Displays 36-hour current prediction chart
 * Shows sinusoidally interpolated current velocity curve with current time marker
 */

import React, { useEffect, useState, useMemo, memo, useCallback } from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity, ActivityIndicator, GestureResponderEvent } from 'react-native';
import Svg, { Path, Line, Text as SvgText, Circle, Rect, G } from 'react-native-svg';
import {
  findNearestCurrentStation,
  getStationPredictionsForRange,
  CurrentStation,
} from '../services/stationService';
import {
  convertToCurrentEvents,
  generateCurrentChartCurve,
  getChartRange,
  getCurrentValueFromCurve,
  ChartPoint,
} from '../services/tideInterpolation';

interface Props {
  visible: boolean;
  selectedStationId: string | null;
  currentLocation: [number, number] | null; // [lng, lat]
  currentStations: CurrentStation[];
  onClearSelection: () => void;
}

const CHART_HEIGHT_PERCENT = 0.15; // 15% of screen height
const CHART_PADDING = { top: 25, bottom: 20, left: 40, right: 10 };

function CurrentDetailChart({ 
  visible, 
  selectedStationId, 
  currentLocation, 
  currentStations,
  onClearSelection 
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stationId, setStationId] = useState<string | null>(null);
  const [stationName, setStationName] = useState<string>('');
  const [chartPoints, setChartPoints] = useState<ChartPoint[]>([]);
  const [isManualSelection, setIsManualSelection] = useState(false);
  const [touchX, setTouchX] = useState<number | null>(null);
  
  const screenWidth = Dimensions.get('window').width;
  const screenHeight = Dimensions.get('window').height;
  const chartHeight = screenHeight * CHART_HEIGHT_PERCENT;
  
  // Determine which station to use
  useEffect(() => {
    if (!visible) return;
    if (!currentStations || currentStations.length === 0) return;
    
    if (selectedStationId) {
      // User manually selected a station
      setStationId(selectedStationId);
      setIsManualSelection(true);
      // Find station name
      const station = currentStations.find(s => s.id === selectedStationId);
      setStationName(station?.name || selectedStationId);
    } else if (currentLocation) {
      // Find nearest station
      const [lng, lat] = currentLocation;
      const nearest = findNearestCurrentStation(lat, lng, currentStations);
      if (nearest) {
        setStationId(nearest.station.id);
        setStationName(nearest.station.name);
        setIsManualSelection(false);
      }
    }
  }, [visible, selectedStationId, currentLocation, currentStations]);
  
  // Load prediction data when station changes
  useEffect(() => {
    if (!visible || !stationId) return;
    
    loadChartData();
  }, [visible, stationId]);
  
  const loadChartData = async () => {
    if (!stationId) return;
    
    setLoading(true);
    setError(null);
    setChartPoints([]); // Clear old data immediately
    
    try {
      // Chart display window: -12 hours to +36 hours (48 hours total)
      const now = new Date();
      const chartStartTs = now.getTime() - 12 * 60 * 60 * 1000;  // 12 hours ago
      const chartEndTs = now.getTime() + 36 * 60 * 60 * 1000;    // 36 hours ahead
      
      // Query predictions with extra padding for interpolation at edges
      const queryStartDate = new Date(chartStartTs - 6 * 60 * 60 * 1000);  // 6h before chart start
      const queryEndDate = new Date(chartEndTs + 6 * 60 * 60 * 1000);      // 6h after chart end
      
      // Query predictions
      const predictions = await getStationPredictionsForRange(
        stationId,
        'current',
        queryStartDate,
        queryEndDate
      );
      
      if (!predictions || predictions.length === 0) {
        setError('No prediction data available');
        setChartPoints([]);
        return;
      }
      
      // Convert to events (includes events before "now" for interpolation)
      const events = convertToCurrentEvents(predictions);
      
      // Generate curve only for the display window (now to +36h)
      // but using all events (including those before now) for interpolation
      const points = generateCurrentChartCurve(events, chartStartTs, chartEndTs, 15);
      setChartPoints(points);
    } catch (err: any) {
      console.error('[CURRENT CHART] Error loading data:', err);
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };
  
  // Calculate chart dimensions
  const chartWidth = screenWidth - CHART_PADDING.left - CHART_PADDING.right;
  const chartInnerHeight = chartHeight - CHART_PADDING.top - CHART_PADDING.bottom;
  
  // Get value range for Y-axis (centered on zero for currents)
  const { min: yMin, max: yMax } = useMemo(() => {
    const range = getChartRange(chartPoints);
    // Make sure zero is visible and symmetric
    const absMax = Math.max(Math.abs(range.min), Math.abs(range.max));
    return { min: -absMax, max: absMax };
  }, [chartPoints]);
  
  // Generate SVG path for the curve
  // Note: -25 offset is applied at render time via transform, not in calculation
  const curvePath = useMemo(() => {
    if (chartPoints.length < 2) return '';
    
    const startTs = chartPoints[0].timestamp;
    const endTs = chartPoints[chartPoints.length - 1].timestamp;
    const timeRange = endTs - startTs;
    
    let path = '';
    chartPoints.forEach((point, i) => {
      const x = CHART_PADDING.left + ((point.timestamp - startTs) / timeRange) * chartWidth;
      const y = CHART_PADDING.top + chartInnerHeight - ((point.value - yMin) / (yMax - yMin)) * chartInnerHeight;
      
      if (i === 0) {
        path = `M ${x} ${y}`;
      } else {
        path += ` L ${x} ${y}`;
      }
    });
    
    return path;
  }, [chartPoints, chartWidth, chartInnerHeight, yMin, yMax]);
  
  // Calculate zero line position
  const zeroLineY = useMemo(() => {
    return CHART_PADDING.top + chartInnerHeight - ((0 - yMin) / (yMax - yMin)) * chartInnerHeight;
  }, [chartInnerHeight, yMin, yMax]);
  
  // Calculate "now" position
  const nowPosition = useMemo(() => {
    if (chartPoints.length < 2) return null;
    
    const now = Date.now();
    const startTs = chartPoints[0].timestamp;
    const endTs = chartPoints[chartPoints.length - 1].timestamp;
    
    if (now < startTs || now > endTs) return null;
    
    const x = CHART_PADDING.left + ((now - startTs) / (endTs - startTs)) * chartWidth;
    const currentValue = getCurrentValueFromCurve(chartPoints);
    const y = currentValue !== null 
      ? CHART_PADDING.top + chartInnerHeight - ((currentValue - yMin) / (yMax - yMin)) * chartInnerHeight
      : null;
    
    return { x, y, value: currentValue };
  }, [chartPoints, chartWidth, chartInnerHeight, yMin, yMax]);
  
  // Generate time labels (every 6 hours)
  const timeLabels = useMemo(() => {
    if (chartPoints.length < 2) return [];
    
    const labels: { x: number; label: string }[] = [];
    const startTs = chartPoints[0].timestamp;
    const endTs = chartPoints[chartPoints.length - 1].timestamp;
    const timeRange = endTs - startTs;
    
    // Start from the next 6-hour mark
    const startDate = new Date(startTs);
    let labelTs = new Date(startDate);
    labelTs.setMinutes(0, 0, 0);
    labelTs.setHours(Math.ceil(startDate.getHours() / 6) * 6);
    
    while (labelTs.getTime() <= endTs) {
      const x = CHART_PADDING.left + ((labelTs.getTime() - startTs) / timeRange) * chartWidth;
      const hours = labelTs.getHours();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
      
      labels.push({
        x,
        label: `${displayHours}${ampm}`,
      });
      
      labelTs.setHours(labelTs.getHours() + 6);
    }
    
    return labels;
  }, [chartPoints, chartWidth]);
  
  // Generate midnight markers with dates
  const midnightMarkers = useMemo(() => {
    if (chartPoints.length < 2) return [];
    
    const markers: { x: number; date: string }[] = [];
    const startTs = chartPoints[0].timestamp;
    const endTs = chartPoints[chartPoints.length - 1].timestamp;
    const timeRange = endTs - startTs;
    
    // Find first midnight after chart start
    const startDate = new Date(startTs);
    let midnightTs = new Date(startDate);
    midnightTs.setHours(0, 0, 0, 0);
    if (midnightTs.getTime() <= startTs) {
      midnightTs.setDate(midnightTs.getDate() + 1);
    }
    
    // Add all midnights within the chart range
    while (midnightTs.getTime() <= endTs) {
      const x = CHART_PADDING.left + ((midnightTs.getTime() - startTs) / timeRange) * chartWidth;
      const month = midnightTs.getMonth() + 1;
      const day = midnightTs.getDate();
      const year = midnightTs.getFullYear() % 100; // 2-digit year
      
      markers.push({
        x,
        date: `${month}/${day}/${year}`,
      });
      
      midnightTs.setDate(midnightTs.getDate() + 1);
    }
    
    return markers;
  }, [chartPoints, chartWidth]);
  
  // Generate Y-axis labels
  const yLabels = useMemo(() => {
    const range = yMax - yMin;
    const step = range / 4;
    const labels: { y: number; label: string }[] = [];
    
    for (let i = 0; i <= 4; i++) {
      const value = yMin + step * i;
      const y = CHART_PADDING.top + chartInnerHeight - (i / 4) * chartInnerHeight;
      labels.push({ y, label: value.toFixed(1) });
    }
    
    return labels;
  }, [yMin, yMax, chartInnerHeight, chartPoints.length]);
  
  // Get current direction text (flood/ebb/slack)
  const directionText = useMemo(() => {
    if (!nowPosition || nowPosition.value === null) return '';
    const v = nowPosition.value;
    if (Math.abs(v) < 0.2) return 'Slack';
    return v > 0 ? 'Flood' : 'Ebb';
  }, [nowPosition]);
  
  // Calculate touched point info
  const touchedPoint = useMemo(() => {
    if (touchX === null || chartPoints.length < 2) return null;
    
    const startTs = chartPoints[0].timestamp;
    const endTs = chartPoints[chartPoints.length - 1].timestamp;
    const timeRange = endTs - startTs;
    
    // Convert X position to timestamp
    const relativeX = touchX - CHART_PADDING.left;
    if (relativeX < 0 || relativeX > chartWidth) return null;
    
    const touchTs = startTs + (relativeX / chartWidth) * timeRange;
    
    // Find the value at this timestamp by interpolating between points
    let value: number | null = null;
    for (let i = 0; i < chartPoints.length - 1; i++) {
      if (touchTs >= chartPoints[i].timestamp && touchTs <= chartPoints[i + 1].timestamp) {
        const ratio = (touchTs - chartPoints[i].timestamp) / (chartPoints[i + 1].timestamp - chartPoints[i].timestamp);
        value = chartPoints[i].value + ratio * (chartPoints[i + 1].value - chartPoints[i].value);
        break;
      }
    }
    
    if (value === null) return null;
    
    const y = CHART_PADDING.top + chartInnerHeight - ((value - yMin) / (yMax - yMin)) * chartInnerHeight;
    const touchDate = new Date(touchTs);
    const hours = touchDate.getHours();
    const minutes = touchDate.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    const timeStr = `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
    const direction = value > 0.2 ? 'Flood' : value < -0.2 ? 'Ebb' : 'Slack';
    
    return { x: touchX, y, value, time: timeStr, direction };
  }, [touchX, chartPoints, chartWidth, chartInnerHeight, yMin, yMax]);
  
  // Handle touch on chart
  const handleChartTouch = useCallback((event: GestureResponderEvent) => {
    const { locationX } = event.nativeEvent;
    setTouchX(locationX);
  }, []);
  
  const handleTouchEnd = useCallback(() => {
    // Clear touch after a delay to let user see the value
    setTimeout(() => setTouchX(null), 2000);
  }, []);
  
  if (!visible) return null;
  
  return (
    <View style={[styles.container, { height: chartHeight }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>💨 Current</Text>
          <Text style={styles.stationName} numberOfLines={1}>
            {isManualSelection ? '📍 ' : ''}{stationName || 'Loading...'}
          </Text>
        </View>
        {isManualSelection && (
          <TouchableOpacity style={styles.clearButton} onPress={onClearSelection}>
            <Text style={styles.clearButtonText}>✕</Text>
          </TouchableOpacity>
        )}
        {nowPosition && nowPosition.value !== null && (
          <View style={styles.currentValueContainer}>
            <Text style={styles.currentValue}>
              {Math.abs(nowPosition.value).toFixed(1)} kt
            </Text>
            <Text style={[
              styles.directionText,
              nowPosition.value > 0.2 ? styles.floodText : 
              nowPosition.value < -0.2 ? styles.ebbText : styles.slackText
            ]}>
              {directionText}
            </Text>
          </View>
        )}
      </View>
      
      {/* Chart */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color="#CC0066" />
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <View
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={handleChartTouch}
          onResponderMove={handleChartTouch}
          onResponderRelease={handleTouchEnd}
        >
        <Svg key={`svg-${stationId}-${yMin.toFixed(1)}-${yMax.toFixed(1)}`} width={screenWidth} height={chartHeight - 25}>
          {/* Background - flood above zero, ebb below */}
          <Rect
            x={CHART_PADDING.left}
            y={CHART_PADDING.top - 25}
            width={chartWidth}
            height={zeroLineY - CHART_PADDING.top + 25}
            fill="rgba(0, 150, 0, 0.1)"
          />
          <Rect
            x={CHART_PADDING.left}
            y={zeroLineY - 25}
            width={chartWidth}
            height={CHART_PADDING.top + chartInnerHeight - zeroLineY}
            fill="rgba(150, 0, 0, 0.1)"
          />
          
          {/* Y-axis labels */}
          {yLabels.map((label, i) => (
            <SvgText
              key={`y-${i}-${label.label}`}
              x={CHART_PADDING.left - 5}
              y={label.y - 25}
              fontSize={10}
              fill="#DDD"
              textAnchor="end"
            >
              {label.label}
            </SvgText>
          ))}
          
          {/* Time labels */}
          {timeLabels.map((label, i) => (
            <SvgText
              key={`t-${i}`}
              x={label.x}
              y={chartHeight - 30}
              fontSize={9}
              fill="#DDD"
              textAnchor="middle"
            >
              {label.label}
            </SvgText>
          ))}
          
          {/* Zero line (slack water line) */}
          <Line
            x1={CHART_PADDING.left}
            y1={zeroLineY - 25}
            x2={CHART_PADDING.left + chartWidth}
            y2={zeroLineY - 25}
            stroke="rgba(255,255,255,0.5)"
            strokeWidth={1}
          />
          
          {/* Grid lines */}
          {yLabels.map((label, i) => (
            <Line
              key={`grid-${i}`}
              x1={CHART_PADDING.left}
              y1={label.y - 25}
              x2={CHART_PADDING.left + chartWidth}
              y2={label.y - 25}
              stroke="rgba(255,255,255,0.15)"
              strokeWidth={0.5}
            />
          ))}
          
          {/* Midnight markers with date labels */}
          {midnightMarkers.map((marker, i) => (
            <React.Fragment key={`midnight-${i}`}>
              <Line
                x1={marker.x}
                y1={CHART_PADDING.top - 25}
                x2={marker.x}
                y2={CHART_PADDING.top + chartInnerHeight - 25}
                stroke="rgba(255, 255, 255, 0.3)"
                strokeWidth={1}
                strokeDasharray="2,2"
              />
              <SvgText
                x={marker.x}
                y={CHART_PADDING.top - 25 + 12}
                fontSize={9}
                fill="rgba(255, 255, 255, 0.7)"
                textAnchor="middle"
              >
                {marker.date}
              </SvgText>
            </React.Fragment>
          ))}
          
          {/* Current curve - offset by -25 to match other elements */}
          <G transform="translate(0, -25)">
            <Path
              d={curvePath}
              stroke="#CC0066"
              strokeWidth={2}
              fill="none"
            />
          </G>
          
          {/* "Now" marker - faint vertical line at current time */}
          {nowPosition && (
            <>
              <Line
                x1={nowPosition.x}
                y1={CHART_PADDING.top - 25}
                x2={nowPosition.x}
                y2={CHART_PADDING.top + chartInnerHeight - 25}
                stroke="rgba(255, 255, 255, 0.4)"
                strokeWidth={1}
              />
              {nowPosition.y !== null && (
                <Circle
                  cx={nowPosition.x}
                  cy={nowPosition.y - 25}
                  r={4}
                  fill="#FF6600"
                  stroke="rgba(255, 255, 255, 0.6)"
                  strokeWidth={1}
                />
              )}
            </>
          )}
          
          {/* Touch marker with value */}
          {touchedPoint && (() => {
            const tooltipHeight = 34;
            const tooltipWidth = 80;
            const horizontalOffset = 85; // Offset from finger
            
            // Position tooltip left or right of finger based on which half of chart
            const chartCenterX = CHART_PADDING.left + chartWidth / 2;
            const showOnRight = touchedPoint.x < chartCenterX;
            let tooltipX = showOnRight 
              ? touchedPoint.x + horizontalOffset 
              : touchedPoint.x - horizontalOffset;
            
            // Clamp X to keep tooltip in bounds
            tooltipX = Math.max(tooltipWidth / 2 + 5, Math.min(screenWidth - tooltipWidth / 2 - 5, tooltipX));
            
            // Vertical position - center on the point (with -25 offset), but keep in bounds
            const pointY = touchedPoint.y - 25; // Apply offset for rendering
            let tooltipY = pointY - tooltipHeight / 2;
            tooltipY = Math.max(5, Math.min(chartHeight - 25 - tooltipHeight - 5, tooltipY));
            
            return (
              <>
                <Line
                  x1={touchedPoint.x}
                  y1={CHART_PADDING.top - 25}
                  x2={touchedPoint.x}
                  y2={CHART_PADDING.top + chartInnerHeight - 25}
                  stroke="rgba(255, 200, 0, 0.8)"
                  strokeWidth={1}
                />
                <Circle
                  cx={touchedPoint.x}
                  cy={pointY}
                  r={6}
                  fill="#FFC800"
                  stroke="#FFF"
                  strokeWidth={2}
                />
                <Rect
                  x={tooltipX - tooltipWidth / 2}
                  y={tooltipY}
                  width={tooltipWidth}
                  height={tooltipHeight}
                  rx={4}
                  fill="rgba(0, 0, 0, 0.85)"
                />
                <SvgText
                  x={tooltipX}
                  y={tooltipY + 14}
                  fontSize={10}
                  fill="#FFC800"
                  textAnchor="middle"
                  fontWeight="bold"
                >
                  {Math.abs(touchedPoint.value).toFixed(1)} kt {touchedPoint.direction}
                </SvgText>
                <SvgText
                  x={tooltipX}
                  y={tooltipY + 26}
                  fontSize={8}
                  fill="#CCC"
                  textAnchor="middle"
                >
                  {touchedPoint.time}
                </SvgText>
              </>
            );
          })()}
        </Svg>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(28, 28, 30, 0.95)',
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 3,
    backgroundColor: 'rgba(204, 0, 102, 0.2)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  title: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#CC0066',
    marginRight: 8,
  },
  stationName: {
    fontSize: 11,
    color: '#CCC',
    flex: 1,
  },
  clearButton: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  clearButtonText: {
    fontSize: 14,
    color: '#666',
  },
  currentValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
  },
  currentValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FF6600',
    marginRight: 4,
  },
  directionText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  floodText: {
    color: '#00CC00',
  },
  ebbText: {
    color: '#CC0000',
  },
  slackText: {
    color: '#888',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 12,
  },
});

// Memoize to prevent unnecessary re-renders
export default memo(CurrentDetailChart);

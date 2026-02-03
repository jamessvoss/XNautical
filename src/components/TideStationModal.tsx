/**
 * Tide/Current Station Modal
 * 
 * Displays tide or current predictions when user taps a station pin on the map
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';
import { getTidePredictionsForDate, getCurrentPredictionsForDate } from '../services/stationService';
import type { TideEvent, CurrentEvent } from '../services/stationService';
import { interpolateTideHeight, generateTideCurve, getTideState, formatTimeDisplay, formatTideHeight } from '../services/tideInterpolation';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface TideStationModalProps {
  visible: boolean;
  onClose: () => void;
  stationType: 'tide' | 'current';
  stationId: string;
  stationName: string;
}

export default function TideStationModal({
  visible,
  onClose,
  stationType,
  stationId,
  stationName,
}: TideStationModalProps) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [tideEvents, setTideEvents] = useState<TideEvent[]>([]);
  const [currentEvents, setCurrentEvents] = useState<CurrentEvent[]>([]);

  // Load predictions for selected date
  useEffect(() => {
    if (!visible) return;

    const dateKey = formatDateKey(selectedDate);
    
    if (stationType === 'tide') {
      const events = getTidePredictionsForDate(stationId, dateKey);
      setTideEvents(events);
    } else {
      const events = getCurrentPredictionsForDate(stationId, dateKey);
      setCurrentEvents(events);
    }
  }, [visible, stationType, stationId, selectedDate]);

  // Get current time and interpolated height
  const currentInfo = useMemo(() => {
    if (stationType !== 'tide' || tideEvents.length === 0) {
      return null;
    }

    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const currentHeight = interpolateTideHeight(tideEvents, currentTime);
    const tideState = getTideState(tideEvents, currentTime);

    return {
      time: currentTime,
      height: currentHeight,
      state: tideState,
    };
  }, [tideEvents, stationType]);

  // Generate tide curve for visualization
  const tideCurve = useMemo(() => {
    if (stationType !== 'tide' || tideEvents.length === 0) {
      return [];
    }
    return generateTideCurve(tideEvents, 30); // Points every 30 minutes
  }, [tideEvents, stationType]);

  const formatDateKey = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatDateDisplay = (date: Date): string => {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const changeDate = (days: number) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + days);
    setSelectedDate(newDate);
  };

  const getNextEvent = () => {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    if (stationType === 'tide') {
      for (const event of tideEvents) {
        if (event.time > currentTime) {
          return event;
        }
      }
    } else {
      for (const event of currentEvents) {
        if (event.time > currentTime) {
          return event;
        }
      }
    }
    return null;
  };

  const nextEvent = getNextEvent();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.title}>{stationName}</Text>
              <Text style={styles.subtitle}>
                {stationType === 'tide' ? 'Tide Station' : 'Current Station'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Date Navigation */}
          <View style={styles.dateNav}>
            <TouchableOpacity onPress={() => changeDate(-1)} style={styles.dateButton}>
              <Text style={styles.dateButtonText}>←</Text>
            </TouchableOpacity>
            <Text style={styles.dateText}>{formatDateDisplay(selectedDate)}</Text>
            <TouchableOpacity onPress={() => changeDate(1)} style={styles.dateButton}>
              <Text style={styles.dateButtonText}>→</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.contentScroll}>
            {/* Current Status (Tide only) */}
            {stationType === 'tide' && currentInfo && currentInfo.height !== null && (
              <View style={styles.currentStatus}>
                <Text style={styles.sectionTitle}>Current Tide</Text>
                <View style={styles.currentInfo}>
                  <Text style={styles.currentHeight}>
                    {formatTideHeight(currentInfo.height)} ft
                  </Text>
                  <Text style={styles.currentState}>
                    {currentInfo.state === 'rising' ? '↑ Rising' : '↓ Falling'}
                  </Text>
                </View>
              </View>
            )}

            {/* Next Event */}
            {nextEvent && (
              <View style={styles.nextEvent}>
                <Text style={styles.sectionTitle}>
                  Next {stationType === 'tide' ? (nextEvent as TideEvent).type === 'H' ? 'High' : 'Low' : (nextEvent as CurrentEvent).type}
                </Text>
                <View style={styles.eventInfo}>
                  <Text style={styles.eventTime}>
                    {formatTimeDisplay(nextEvent.time)}
                  </Text>
                  <Text style={styles.eventValue}>
                    {stationType === 'tide'
                      ? `${formatTideHeight((nextEvent as TideEvent).height)} ft`
                      : `${(nextEvent as CurrentEvent).velocity.toFixed(1)} kts`}
                  </Text>
                </View>
              </View>
            )}

            {/* Events List */}
            <View style={styles.eventsSection}>
              <Text style={styles.sectionTitle}>
                {stationType === 'tide' ? 'High/Low Tides' : 'Flood/Ebb/Slack'}
              </Text>
              {stationType === 'tide' ? (
                tideEvents.length > 0 ? (
                  tideEvents.map((event, index) => (
                    <View key={index} style={styles.eventRow}>
                      <Text style={styles.eventRowTime}>{formatTimeDisplay(event.time)}</Text>
                      <Text style={styles.eventRowType}>
                        {event.type === 'H' ? 'High' : 'Low'}
                      </Text>
                      <Text style={styles.eventRowValue}>
                        {formatTideHeight(event.height)} ft
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.noData}>No tide data available for this date</Text>
                )
              ) : (
                currentEvents.length > 0 ? (
                  currentEvents.map((event, index) => (
                    <View key={index} style={styles.eventRow}>
                      <Text style={styles.eventRowTime}>{formatTimeDisplay(event.time)}</Text>
                      <Text style={styles.eventRowType}>
                        {event.type.charAt(0).toUpperCase() + event.type.slice(1)}
                      </Text>
                      <Text style={styles.eventRowValue}>
                        {event.velocity.toFixed(1)} kts
                        {event.direction !== undefined && ` @ ${event.direction}°`}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.noData}>No current data available for this date</Text>
                )
              )}
            </View>

            {/* Simple Tide Curve Visualization */}
            {stationType === 'tide' && tideCurve.length > 0 && (
              <View style={styles.curveSection}>
                <Text style={styles.sectionTitle}>Tide Curve</Text>
                <View style={styles.curveContainer}>
                  {renderSimpleCurve(tideCurve)}
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// Simple ASCII-style tide curve visualization
function renderSimpleCurve(curvePoints: Array<{ time: string; height: number }>) {
  if (curvePoints.length === 0) return null;

  const heights = curvePoints.map(p => p.height);
  const minHeight = Math.min(...heights);
  const maxHeight = Math.max(...heights);
  const range = maxHeight - minHeight;

  const CHART_HEIGHT = 120;
  const CHART_WIDTH = SCREEN_WIDTH - 64;

  return (
    <View style={{ height: CHART_HEIGHT, width: CHART_WIDTH, backgroundColor: '#f5f5f5', borderRadius: 8, padding: 8 }}>
      {/* Y-axis labels */}
      <View style={{ position: 'absolute', left: 0, top: 8, bottom: 8, justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 10, color: '#666' }}>{maxHeight.toFixed(1)}</Text>
        <Text style={{ fontSize: 10, color: '#666' }}>{minHeight.toFixed(1)}</Text>
      </View>

      {/* Curve points */}
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', paddingLeft: 32, paddingRight: 8 }}>
        {curvePoints.map((point, index) => {
          const normalized = (point.height - minHeight) / range;
          const barHeight = normalized * (CHART_HEIGHT - 32);
          
          return (
            <View
              key={index}
              style={{
                flex: 1,
                height: barHeight,
                backgroundColor: '#007AFF',
                marginHorizontal: 0.5,
                opacity: 0.7,
              }}
            />
          );
        })}
      </View>

      {/* X-axis labels */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingLeft: 32, paddingRight: 8 }}>
        <Text style={{ fontSize: 10, color: '#666' }}>{curvePoints[0]?.time}</Text>
        <Text style={{ fontSize: 10, color: '#666' }}>{curvePoints[curvePoints.length - 1]?.time}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    minHeight: 400,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
  },
  closeButton: {
    padding: 8,
    marginTop: -8,
    marginRight: -8,
  },
  closeButtonText: {
    fontSize: 24,
    color: '#666',
  },
  dateNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#f8f8f8',
  },
  dateButton: {
    padding: 12,
    backgroundColor: '#007AFF',
    borderRadius: 8,
    minWidth: 44,
    alignItems: 'center',
  },
  dateButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  dateText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#000',
  },
  contentScroll: {
    flex: 1,
  },
  currentStatus: {
    padding: 20,
    backgroundColor: '#e3f2fd',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  currentInfo: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 12,
  },
  currentHeight: {
    fontSize: 32,
    fontWeight: '700',
    color: '#007AFF',
  },
  currentState: {
    fontSize: 18,
    fontWeight: '500',
    color: '#666',
  },
  nextEvent: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  eventInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  eventTime: {
    fontSize: 24,
    fontWeight: '600',
    color: '#000',
  },
  eventValue: {
    fontSize: 20,
    fontWeight: '500',
    color: '#007AFF',
  },
  eventsSection: {
    padding: 20,
  },
  eventRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  eventRowTime: {
    fontSize: 16,
    fontWeight: '500',
    color: '#000',
    flex: 1,
  },
  eventRowType: {
    fontSize: 14,
    color: '#666',
    flex: 1,
    textAlign: 'center',
  },
  eventRowValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
    flex: 1,
    textAlign: 'right',
  },
  noData: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    padding: 20,
  },
  curveSection: {
    padding: 20,
  },
  curveContainer: {
    marginTop: 8,
  },
});

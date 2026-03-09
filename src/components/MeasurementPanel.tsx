import React, { useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatDistance } from '../services/unitFormatService';
import { formatBearing, type MeasurementLeg } from '../utils/measurementUtils';

interface Props {
  legs: MeasurementLeg[];
  totalDistanceNm: number;
  selectedPointIndex: number | null;
  onUndo: () => void;
  onClear: () => void;
  onClose: () => void;
  onRemovePoint: (index: number) => void;
  onDeselectPoint: () => void;
}

export default function MeasurementPanel({
  legs,
  totalDistanceNm,
  selectedPointIndex,
  onUndo,
  onClear,
  onClose,
  onRemovePoint,
  onDeselectPoint,
}: Props) {
  const scrollRef = useRef<any>(null);

  // Auto-scroll to bottom when new leg added
  useEffect(() => {
    if (scrollRef.current && legs.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [legs.length]);

  return (
    <View style={styles.container}>
      {/* Header row with action buttons */}
      <View style={styles.header}>
        <Text style={styles.title}>Measure</Text>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionBtn} onPress={onUndo} disabled={legs.length === 0}>
            <Ionicons name="arrow-undo" size={18} color={legs.length > 0 ? '#fff' : '#666'} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={onClear} disabled={legs.length === 0}>
            <Ionicons name="trash-outline" size={18} color={legs.length > 0 ? '#fff' : '#666'} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={onClose}>
            <Ionicons name="close" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Selected point delete confirmation */}
      {selectedPointIndex !== null && (
        <View style={styles.deleteRow}>
          <Text style={styles.deleteText}>Point {selectedPointIndex + 1} selected</Text>
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => onRemovePoint(selectedPointIndex)}
          >
            <Ionicons name="trash" size={16} color="#FF6B6B" />
            <Text style={styles.deleteBtnText}>Remove</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={onDeselectPoint}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Scrollable leg list */}
      {legs.length > 0 && (
        <ScrollView
          ref={scrollRef}
          style={styles.legList}
          showsVerticalScrollIndicator={false}
        >
          {legs.map((leg, i) => (
            <View key={i} style={styles.legRow}>
              <Text style={styles.legNumber}>{i + 1}.</Text>
              <Text style={styles.legDistance}>{formatDistance(leg.distanceNm, 2)}</Text>
              <Text style={styles.legBearing}>{formatBearing(leg.bearingTrue)}</Text>
              <Text style={styles.legCumulative}>{formatDistance(leg.cumulativeNm, 2)}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      {legs.length === 0 && (
        <Text style={styles.hint}>Tap map to add points</Text>
      )}

      {/* Pinned total */}
      {legs.length > 0 && (
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{formatDistance(totalDistanceNm, 2)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 30,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderRadius: 12,
    padding: 12,
    maxHeight: 240,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    color: '#4FC3F7',
    fontSize: 14,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionBtn: {
    padding: 4,
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 107, 107, 0.15)',
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
    gap: 10,
  },
  deleteText: {
    color: '#fff',
    fontSize: 13,
    flex: 1,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  deleteBtnText: {
    color: '#FF6B6B',
    fontSize: 13,
    fontWeight: '600',
  },
  cancelBtn: {
    padding: 4,
  },
  cancelBtnText: {
    color: '#888',
    fontSize: 13,
  },
  legList: {
    maxHeight: 120,
  },
  legRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  legNumber: {
    color: '#888',
    fontSize: 13,
    width: 24,
  },
  legDistance: {
    color: '#fff',
    fontSize: 13,
    width: 80,
  },
  legBearing: {
    color: '#aaa',
    fontSize: 13,
    width: 60,
  },
  legCumulative: {
    color: '#4FC3F7',
    fontSize: 13,
    flex: 1,
    textAlign: 'right',
  },
  hint: {
    color: '#888',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 8,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
    paddingTop: 8,
    marginTop: 4,
  },
  totalLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  totalValue: {
    color: '#4FC3F7',
    fontSize: 14,
    fontWeight: '700',
  },
});

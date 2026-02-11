/**
 * PerformanceDataModal
 *
 * Full-screen modal for entering/editing boat performance data
 * (RPM, Speed, Fuel Consumption). Uses KeyboardAvoidingView so the
 * keyboard doesn't cover the table.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { PerformancePoint, getDefaultPerformanceRPMs } from '../types/boat';

interface Props {
  visible: boolean;
  performanceData: PerformancePoint[];
  boatName: string;
  onClose: () => void;
  onSave: (data: PerformancePoint[]) => void;
}

export default function PerformanceDataModal({
  visible,
  performanceData,
  boatName,
  onClose,
  onSave,
}: Props) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<PerformancePoint[]>([]);
  const [dirty, setDirty] = useState(false);
  const scrollRef = useRef<any>(null);

  // Initialize data when modal opens
  useEffect(() => {
    if (visible) {
      if (performanceData && performanceData.length > 0) {
        setData([...performanceData]);
      } else {
        setData(
          getDefaultPerformanceRPMs().map((rpm) => ({
            rpm,
            speed: 0,
            fuelConsumption: 0,
          }))
        );
      }
      setDirty(false);
    }
  }, [visible, performanceData]);

  const handleValueChange = useCallback(
    (index: number, field: 'speed' | 'fuelConsumption', value: string) => {
      setData((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], [field]: parseFloat(value) || 0 };
        return updated;
      });
      setDirty(true);
    },
    []
  );

  const handleSave = useCallback(() => {
    onSave(data);
    setDirty(false);
    onClose();
  }, [data, onSave, onClose]);

  const handleClose = useCallback(() => {
    if (dirty) {
      Alert.alert(
        'Unsaved Changes',
        'You have unsaved performance data. Discard changes?',
        [
          { text: 'Keep Editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: onClose },
        ]
      );
    } else {
      onClose();
    }
  }, [dirty, onClose]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} style={styles.headerButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Performance
          </Text>
          <TouchableOpacity onPress={handleSave} style={styles.headerButton}>
            <Text style={[styles.saveText, !dirty && styles.saveTextDisabled]}>
              Save
            </Text>
          </TouchableOpacity>
        </View>

        {/* Boat name subtitle */}
        <View style={styles.subtitleRow}>
          <Ionicons name="boat" size={14} color="rgba(255,255,255,0.5)" />
          <Text style={styles.subtitleText}>{boatName}</Text>
        </View>

        {/* Table header - fixed, not scrolling */}
        <View style={styles.tableHeader}>
          <Text style={[styles.headerCell, styles.rpmCol]}>RPM</Text>
          <Text style={[styles.headerCell, styles.valueCol]}>Speed (kts)</Text>
          <Text style={[styles.headerCell, styles.valueCol]}>GPH</Text>
        </View>

        {/* Table body */}
        <ScrollView
          ref={scrollRef}
          style={styles.tableBody}
          contentContainerStyle={styles.tableBodyContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {data.map((point, index) => (
            <View
              key={`${point.rpm}-${index}`}
              style={[
                styles.tableRow,
                index % 2 === 0 && styles.tableRowEven,
              ]}
            >
              <Text style={[styles.rpmCell, styles.rpmCol]}>
                {point.rpm === 0 ? 'Idle' : point.rpm.toLocaleString()}
              </Text>
              <View style={styles.valueCol}>
                <TextInput
                  style={styles.input}
                  value={point.speed > 0 ? point.speed.toString() : ''}
                  onChangeText={(v: string) => handleValueChange(index, 'speed', v)}
                  placeholder="—"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  onFocus={() => {
                    // Scroll row into view after a short delay to allow keyboard to appear
                    setTimeout(() => {
                      scrollRef.current?.scrollTo({
                        y: Math.max(0, index * 48 - 100),
                        animated: true,
                      });
                    }, 300);
                  }}
                />
              </View>
              <View style={styles.valueCol}>
                <TextInput
                  style={styles.input}
                  value={
                    point.fuelConsumption > 0
                      ? point.fuelConsumption.toString()
                      : ''
                  }
                  onChangeText={(v: string) =>
                    handleValueChange(index, 'fuelConsumption', v)
                  }
                  placeholder="—"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  onFocus={() => {
                    setTimeout(() => {
                      scrollRef.current?.scrollTo({
                        y: Math.max(0, index * 48 - 100),
                        animated: true,
                      });
                    }, 300);
                  }}
                />
              </View>
            </View>
          ))}
          {/* Extra space at bottom so last rows are reachable above keyboard */}
          <View style={{ height: 200 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1f2e',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  headerButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    minWidth: 60,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    flex: 1,
    textAlign: 'center',
  },
  cancelText: {
    fontSize: 17,
    color: '#4FC3F7',
  },
  saveText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#4FC3F7',
    textAlign: 'right',
  },
  saveTextDisabled: {
    opacity: 0.4,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  subtitleText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '500',
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(255, 255, 255, 0.15)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  headerCell: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.6)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rpmCol: {
    width: 70,
  },
  valueCol: {
    flex: 1,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  tableBody: {
    flex: 1,
  },
  tableBodyContent: {
    paddingBottom: 20,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    minHeight: 48,
  },
  tableRowEven: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  rpmCell: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    color: '#fff',
    textAlign: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    width: '90%',
  },
});

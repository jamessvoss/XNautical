/**
 * EngineDetailsModal
 * 
 * Full-screen modal for creating or editing engine information.
 * Supports: manufacturer, model, horsepower, serial number, hours, and maintenance tracking.
 */

import React, { useState, useEffect, useCallback } from 'react';
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
import { Engine, EngineManufacturer, createDefaultEngine } from '../types/boat';

const ENGINE_MANUFACTURERS: EngineManufacturer[] = [
  'Yamaha',
  'Mercury',
  'Suzuki',
  'Honda',
  'Evinrude',
  'Johnson',
  'Volvo Penta',
  'MerCruiser',
  'Other',
];

interface Props {
  visible: boolean;
  engine: Engine | null;
  position: number;
  /** Optional engine to copy manufacturer/model/HP from when creating a new engine */
  templateEngine?: Engine;
  onClose: () => void;
  onSave: (engine: Engine) => void;
}

export default function EngineDetailsModal({
  visible,
  engine,
  position,
  templateEngine,
  onClose,
  onSave,
}: Props) {
  const insets = useSafeAreaInsets();

  // Form state
  const [manufacturer, setManufacturer] = useState<EngineManufacturer>('Yamaha');
  const [customManufacturer, setCustomManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [horsepower, setHorsepower] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [hours, setHours] = useState('');
  const [saving, setSaving] = useState(false);

  const isEditing = !!engine;

  // Initialize form when modal opens
  useEffect(() => {
    if (visible) {
      if (engine) {
        setManufacturer(engine.manufacturer);
        setCustomManufacturer(engine.customManufacturer || '');
        setModel(engine.model);
        setHorsepower(engine.horsepower.toString());
        setSerialNumber(engine.serialNumber);
        setHours(engine.hours.toString());
      } else if (templateEngine) {
        // New engine: copy manufacturer, model, HP from existing engine
        setManufacturer(templateEngine.manufacturer);
        setCustomManufacturer(templateEngine.customManufacturer || '');
        setModel(templateEngine.model);
        setHorsepower(templateEngine.horsepower.toString());
        setSerialNumber('');
        setHours('0');
      } else {
        // New engine defaults
        setManufacturer('Yamaha');
        setCustomManufacturer('');
        setModel('');
        setHorsepower('');
        setSerialNumber('');
        setHours('0');
      }
    }
  }, [visible, engine, templateEngine]);

  const handleSave = useCallback(() => {
    if (!model.trim()) {
      Alert.alert('Model Required', 'Please enter an engine model.');
      return;
    }

    if (manufacturer === 'Other' && !customManufacturer.trim()) {
      Alert.alert(
        'Manufacturer Required',
        'Please enter a manufacturer name when "Other" is selected.'
      );
      return;
    }

    const hp = parseFloat(horsepower);
    if (isNaN(hp) || hp <= 0) {
      Alert.alert('Horsepower Required', 'Please enter a valid horsepower value.');
      return;
    }

    const engineHours = parseFloat(hours);
    if (isNaN(engineHours) || engineHours < 0) {
      Alert.alert('Invalid Hours', 'Please enter a valid engine hours value.');
      return;
    }

    setSaving(true);
    try {
      const savedEngine: Engine = engine
        ? {
            ...engine,
            manufacturer,
            customManufacturer: manufacturer === 'Other' ? customManufacturer.trim() : undefined,
            model: model.trim(),
            horsepower: hp,
            serialNumber: serialNumber.trim(),
            hours: engineHours,
          }
        : {
            ...createDefaultEngine(position),
            manufacturer,
            customManufacturer: manufacturer === 'Other' ? customManufacturer.trim() : undefined,
            model: model.trim(),
            horsepower: hp,
            serialNumber: serialNumber.trim(),
            hours: engineHours,
          };

      onSave(savedEngine);
      onClose();
    } catch (error) {
      console.error('[EngineDetailsModal] Save failed:', error);
      Alert.alert('Save Failed', 'Could not save engine details. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [
    engine,
    position,
    manufacturer,
    customManufacturer,
    model,
    horsepower,
    serialNumber,
    hours,
    onSave,
    onClose,
  ]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {isEditing ? `Edit Engine ${position}` : `New Engine ${position}`}
          </Text>
          <TouchableOpacity onPress={handleSave} style={styles.headerButton} disabled={saving}>
            <Text style={[styles.saveText, saving && styles.saveTextDisabled]}>
              {saving ? 'Saving...' : 'Save'}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Engine Information */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>ENGINE INFORMATION</Text>

            <Text style={styles.fieldLabel}>Manufacturer *</Text>
            <TouchableOpacity
              style={styles.manufacturerButton}
              onPress={() => {
                Alert.alert(
                  'Select Manufacturer',
                  'Choose an engine manufacturer:',
                  [
                    ...ENGINE_MANUFACTURERS.map((mfg) => ({
                      text: mfg,
                      onPress: () => setManufacturer(mfg),
                    })),
                    { text: 'Cancel', style: 'cancel' },
                  ]
                );
              }}
            >
              <Text style={styles.manufacturerButtonText}>
                {manufacturer}
              </Text>
              <Ionicons name="chevron-down" size={20} color="rgba(255, 255, 255, 0.5)" />
            </TouchableOpacity>

            {manufacturer === 'Other' && (
              <>
                <Text style={styles.fieldLabel}>Custom Manufacturer *</Text>
                <TextInput
                  style={styles.textInput}
                  value={customManufacturer}
                  onChangeText={setCustomManufacturer}
                  placeholder="Enter manufacturer name"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  autoCapitalize="words"
                />
              </>
            )}

            <Text style={styles.fieldLabel}>Model *</Text>
            <TextInput
              style={styles.textInput}
              value={model}
              onChangeText={setModel}
              placeholder="F250"
              placeholderTextColor="rgba(255,255,255,0.3)"
              autoCapitalize="characters"
            />

            <View style={styles.row}>
              <View style={styles.halfField}>
                <Text style={styles.fieldLabel}>Horsepower (HP) *</Text>
                <TextInput
                  style={styles.textInput}
                  value={horsepower}
                  onChangeText={setHorsepower}
                  placeholder="250"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="decimal-pad"
                />
              </View>

              <View style={styles.halfField}>
                <Text style={styles.fieldLabel}>Engine Hours *</Text>
                <TextInput
                  style={styles.textInput}
                  value={hours}
                  onChangeText={setHours}
                  placeholder="0"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            <Text style={styles.fieldLabel}>Serial Number</Text>
            <TextInput
              style={styles.textInput}
              value={serialNumber}
              onChangeText={setSerialNumber}
              placeholder="1234567890"
              placeholderTextColor="rgba(255,255,255,0.3)"
              autoCapitalize="characters"
            />
          </View>

          {/* Maintenance Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>MAINTENANCE</Text>
            <Text style={styles.infoText}>
              Track oil changes and lower unit service in the Maintenance tab.
            </Text>
          </View>

          {/* Performance Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>PERFORMANCE DATA</Text>
            <Text style={styles.infoText}>
              Configure RPM, speed, and fuel consumption data in the Performance tab.
            </Text>
          </View>

          <View style={{ height: 40 }} />
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
  },
  cancelText: {
    fontSize: 17,
    color: '#4FC3F7',
  },
  saveText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#4FC3F7',
  },
  saveTextDisabled: {
    opacity: 0.5,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 6,
    marginTop: 12,
  },
  textInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfField: {
    flex: 1,
  },
  manufacturerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  manufacturerButtonText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
  infoText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    lineHeight: 20,
  },
});

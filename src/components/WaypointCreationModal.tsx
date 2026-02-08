/**
 * WaypointCreationModal
 * 
 * Full-screen modal for creating or editing waypoints.
 * Supports: name, category, color, notes, photos, and GPS coordinates.
 * 
 * Used for:
 * - New waypoints (from map long-press or manual creation)
 * - Editing existing waypoints (from waypoint manager)
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  Image,
  Modal,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useWaypoints } from '../contexts/WaypointContext';
import { WaypointCategory, WaypointPhoto, WaypointCreateData } from '../types/waypoint';
import {
  WaypointCategoryPicker,
  WaypointColorPicker,
  WaypointMapPin,
  getDefaultColor,
  getCategoryConfig,
} from './WaypointIcons';
import { getPhotoDisplayUri } from '../services/waypointPhotoService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function WaypointCreationModal() {
  const insets = useSafeAreaInsets();
  const {
    showCreationModal,
    closeCreationModal,
    pendingCoordinate,
    editingWaypoint,
    addWaypoint,
    updateWaypoint,
    pickPhotoForWaypoint,
    takePhotoForWaypoint,
    waypoints,
  } = useWaypoints();

  // Form state
  const [name, setName] = useState('');
  const [category, setCategory] = useState<WaypointCategory>('general');
  const [color, setColor] = useState('#4FC3F7');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<WaypointPhoto[]>([]);
  const [latStr, setLatStr] = useState('');
  const [lngStr, setLngStr] = useState('');
  const [saving, setSaving] = useState(false);
  const [fullScreenPhoto, setFullScreenPhoto] = useState<string | null>(null);

  const isEditing = !!editingWaypoint;

  // Initialize form when modal opens
  useEffect(() => {
    if (showCreationModal) {
      if (editingWaypoint) {
        // Edit mode: populate from existing waypoint
        setName(editingWaypoint.name);
        setCategory(editingWaypoint.category);
        setColor(editingWaypoint.color);
        setNotes(editingWaypoint.notes);
        setPhotos(editingWaypoint.photos || []);
        setLatStr(editingWaypoint.latitude.toFixed(6));
        setLngStr(editingWaypoint.longitude.toFixed(6));
      } else {
        // Create mode: defaults
        const wpNumber = waypoints.length + 1;
        setName(`WP-${String(wpNumber).padStart(3, '0')}`);
        setCategory('general');
        setColor(getDefaultColor('general'));
        setNotes('');
        setPhotos([]);
        if (pendingCoordinate) {
          setLngStr(pendingCoordinate[0].toFixed(6));
          setLatStr(pendingCoordinate[1].toFixed(6));
        } else {
          setLatStr('');
          setLngStr('');
        }
      }
    }
  }, [showCreationModal, editingWaypoint, pendingCoordinate]);

  const handleCategorySelect = useCallback((cat: WaypointCategory, defaultColor: string) => {
    setCategory(cat);
    // Only change color if user hasn't manually picked one different from the previous default
    setColor(defaultColor);
  }, []);

  // Temporary ID for photos (used before waypoint is saved)
  const tempWaypointId = useMemo(() => {
    return editingWaypoint?.id || `temp_${Date.now()}`;
  }, [editingWaypoint]);

  const handleAddPhoto = useCallback(() => {
    Alert.alert(
      'Add Photo',
      'Choose a source',
      [
        {
          text: 'Camera',
          onPress: async () => {
            const photo = await takePhotoForWaypoint(tempWaypointId);
            if (photo) {
              setPhotos(prev => [...prev, photo]);
            }
          },
        },
        {
          text: 'Photo Library',
          onPress: async () => {
            const photo = await pickPhotoForWaypoint(tempWaypointId);
            if (photo) {
              setPhotos(prev => [...prev, photo]);
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [tempWaypointId, takePhotoForWaypoint, pickPhotoForWaypoint]);

  const handleRemovePhoto = useCallback((photoId: string) => {
    setPhotos(prev => prev.filter(p => p.id !== photoId));
  }, []);

  const handleSave = useCallback(async () => {
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);

    if (!name.trim()) {
      Alert.alert('Name Required', 'Please enter a name for this waypoint.');
      return;
    }

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      Alert.alert('Invalid Coordinates', 'Please enter valid latitude (-90 to 90) and longitude (-180 to 180).');
      return;
    }

    setSaving(true);
    try {
      if (isEditing && editingWaypoint) {
        await updateWaypoint({
          ...editingWaypoint,
          name: name.trim(),
          latitude: lat,
          longitude: lng,
          category,
          color,
          notes: notes.trim(),
          photos,
        });
      } else {
        const data: WaypointCreateData = {
          name: name.trim(),
          latitude: lat,
          longitude: lng,
          category,
          color,
          notes: notes.trim(),
          photos,
        };
        await addWaypoint(data);
      }
      closeCreationModal();
    } catch (error) {
      console.error('[WaypointCreationModal] Save failed:', error);
      Alert.alert('Save Failed', 'Could not save waypoint. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [name, latStr, lngStr, category, color, notes, photos, isEditing, editingWaypoint, addWaypoint, updateWaypoint, closeCreationModal]);

  if (!showCreationModal) return null;

  return (
    <Modal
      visible={showCreationModal}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={closeCreationModal}
    >
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={closeCreationModal} style={styles.headerButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {isEditing ? 'Edit Waypoint' : 'New Waypoint'}
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
          {/* Preview */}
          <View style={styles.previewSection}>
            <WaypointMapPin category={category} color={color} size={48} />
            <Text style={styles.previewName}>{name || 'Unnamed'}</Text>
          </View>

          {/* Name */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>NAME</Text>
            <TextInput
              style={styles.textInput}
              value={name}
              onChangeText={setName}
              placeholder="Waypoint name"
              placeholderTextColor="rgba(255,255,255,0.3)"
              autoCapitalize="words"
              returnKeyType="done"
            />
          </View>

          {/* Coordinates */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>COORDINATES</Text>
            <View style={styles.coordRow}>
              <View style={styles.coordField}>
                <Text style={styles.coordLabel}>Lat</Text>
                <TextInput
                  style={styles.coordInput}
                  value={latStr}
                  onChangeText={setLatStr}
                  placeholder="59.6425"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="numeric"
                  returnKeyType="done"
                />
              </View>
              <View style={styles.coordField}>
                <Text style={styles.coordLabel}>Lng</Text>
                <TextInput
                  style={styles.coordInput}
                  value={lngStr}
                  onChangeText={setLngStr}
                  placeholder="-151.5580"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="numeric"
                  returnKeyType="done"
                />
              </View>
            </View>
          </View>

          {/* Category */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>CATEGORY</Text>
            <WaypointCategoryPicker
              selected={category}
              selectedColor={color}
              onSelect={handleCategorySelect}
            />
          </View>

          {/* Color */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>COLOR</Text>
            <WaypointColorPicker selected={color} onSelect={setColor} />
          </View>

          {/* Notes */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>NOTES</Text>
            <TextInput
              style={[styles.textInput, styles.notesInput]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Add notes..."
              placeholderTextColor="rgba(255,255,255,0.3)"
              multiline
              textAlignVertical="top"
              returnKeyType="default"
            />
          </View>

          {/* Photos */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>PHOTOS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoStrip}>
              {photos.map((photo) => (
                <View key={photo.id} style={styles.photoThumb}>
                  <TouchableOpacity onPress={() => setFullScreenPhoto(getPhotoDisplayUri(photo))}>
                    <Image
                      source={{ uri: getPhotoDisplayUri(photo) }}
                      style={styles.photoImage}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.photoDelete}
                    onPress={() => handleRemovePhoto(photo.id)}
                  >
                    <Ionicons name="close-circle" size={22} color="#FF5252" />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity style={styles.addPhotoButton} onPress={handleAddPhoto}>
                <Ionicons name="camera-outline" size={28} color="rgba(255,255,255,0.5)" />
                <Text style={styles.addPhotoText}>Add</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>

          {/* Bottom spacing */}
          <View style={{ height: 40 + insets.bottom }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Full-screen photo viewer */}
      {fullScreenPhoto && (
        <Modal visible animationType="fade" transparent>
          <View style={styles.fullScreenOverlay}>
            <TouchableOpacity
              style={styles.fullScreenClose}
              onPress={() => setFullScreenPhoto(null)}
            >
              <Ionicons name="close" size={30} color="#fff" />
            </TouchableOpacity>
            <Image
              source={{ uri: fullScreenPhoto }}
              style={styles.fullScreenImage}
              resizeMode="contain"
            />
          </View>
        </Modal>
      )}
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  headerButton: {
    minWidth: 60,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  cancelText: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.7)',
  },
  saveText: {
    fontSize: 16,
    color: '#4FC3F7',
    fontWeight: '600',
    textAlign: 'right',
  },
  saveTextDisabled: {
    opacity: 0.4,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  previewSection: {
    alignItems: 'center',
    paddingVertical: 20,
    marginBottom: 8,
  },
  previewName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginTop: 12,
  },
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  notesInput: {
    minHeight: 80,
    paddingTop: 12,
  },
  coordRow: {
    flexDirection: 'row',
    gap: 12,
  },
  coordField: {
    flex: 1,
  },
  coordLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 4,
  },
  coordInput: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  photoStrip: {
    flexDirection: 'row',
  },
  photoThumb: {
    marginRight: 10,
    position: 'relative',
  },
  photoImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  photoDelete: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#1a1f2e',
    borderRadius: 11,
  },
  addPhotoButton: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPhotoText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
  },
  fullScreenOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 10,
  },
  fullScreenImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH,
  },
});

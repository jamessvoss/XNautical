/**
 * BoatDetailsModal
 * 
 * Full-screen modal for creating or editing boat information.
 * Supports: name, registration, hull ID, dimensions, photos, and storage type.
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
  Image,
  Modal,
  Picker,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Boat, BoatPhoto } from '../types/boat';
import { saveBoat } from '../services/boatStorageService';
import {
  pickPhoto,
  takePhoto,
  getPhotoDisplayUri,
  deletePhoto,
} from '../services/boatPhotoService';

// Auth helpers
let getCurrentUser: (() => any) | null = null;
if (Platform.OS !== 'web') {
  try {
    const firebase = require('../config/firebase');
    getCurrentUser = firebase.getCurrentUser;
  } catch (e) {
    console.log('[BoatDetailsModal] Firebase config not available');
  }
}

interface Props {
  visible: boolean;
  boat: Boat;
  onClose: () => void;
  onSave: (boat: Boat) => void;
}

export default function BoatDetailsModal({ visible, boat, onClose, onSave }: Props) {
  const insets = useSafeAreaInsets();
  const currentUser = getCurrentUser ? getCurrentUser() : null;

  // Form state
  const [name, setName] = useState('');
  const [registration, setRegistration] = useState('');
  const [hullIdNumber, setHullIdNumber] = useState('');
  const [year, setYear] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [lengthOverall, setLengthOverall] = useState('');
  const [beam, setBeam] = useState('');
  const [draft, setDraft] = useState('');
  const [displacement, setDisplacement] = useState('');
  const [homeport, setHomeport] = useState('');
  const [photos, setPhotos] = useState<BoatPhoto[]>([]);
  const [saving, setSaving] = useState(false);
  const [fullScreenPhoto, setFullScreenPhoto] = useState<string | null>(null);

  // Initialize form when modal opens
  useEffect(() => {
    if (visible) {
      setName(boat.name);
      setRegistration(boat.registration);
      setHullIdNumber(boat.hullIdNumber);
      setYear(boat.year?.toString() || '');
      setManufacturer(boat.manufacturer || '');
      setModel(boat.model || '');
      setLengthOverall(boat.lengthOverall?.toString() || '');
      setBeam(boat.beam?.toString() || '');
      setDraft(boat.draft?.toString() || '');
      setDisplacement(boat.displacement?.toString() || '');
      setHomeport(boat.homeport || '');
      setPhotos(boat.photos);
    }
  }, [visible, boat]);

  const handleAddPhoto = useCallback(() => {
    Alert.alert(
      'Add Photo',
      'Choose a source',
      [
        {
          text: 'Camera',
          onPress: async () => {
            const photo = await takePhoto(boat.id);
            if (photo) {
              setPhotos(prev => [...prev, photo]);
            }
          },
        },
        {
          text: 'Photo Library',
          onPress: async () => {
            const photo = await pickPhoto(boat.id);
            if (photo) {
              setPhotos(prev => [...prev, photo]);
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [boat.id]);

  const handleRemovePhoto = useCallback((photoId: string) => {
    if (!currentUser) return;

    Alert.alert(
      'Delete Photo',
      'Are you sure you want to delete this photo?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const photo = photos.find(p => p.id === photoId);
            if (photo) {
              await deletePhoto(currentUser.uid, boat.id, photo);
            }
            setPhotos(prev => prev.filter(p => p.id !== photoId));
          },
        },
      ]
    );
  }, [currentUser, boat.id, photos]);

  const handleSave = useCallback(async () => {
    if (!currentUser) {
      Alert.alert('Error', 'You must be logged in to save boat details.');
      return;
    }

    if (!name.trim()) {
      Alert.alert('Name Required', 'Please enter a name for this boat.');
      return;
    }

    if (!registration.trim() && !hullIdNumber.trim()) {
      Alert.alert(
        'Registration Required',
        'Please enter either a registration number or hull ID number.'
      );
      return;
    }

    setSaving(true);
    try {
      const updatedBoat: Boat = {
        ...boat,
        name: name.trim(),
        registration: registration.trim(),
        hullIdNumber: hullIdNumber.trim(),
        year: year ? parseInt(year, 10) : undefined,
        manufacturer: manufacturer.trim() || undefined,
        model: model.trim() || undefined,
        lengthOverall: lengthOverall ? parseFloat(lengthOverall) : undefined,
        beam: beam ? parseFloat(beam) : undefined,
        draft: draft ? parseFloat(draft) : undefined,
        displacement: displacement ? parseFloat(displacement) : undefined,
        homeport: homeport.trim() || undefined,
        photos,
        storageType: 'both', // Always use both storage types
        updatedAt: new Date().toISOString(),
      };

      await saveBoat(currentUser.uid, updatedBoat);
      onSave(updatedBoat);
      onClose();
    } catch (error) {
      console.error('[BoatDetailsModal] Save failed:', error);
      Alert.alert('Save Failed', 'Could not save boat details. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [
    currentUser,
    boat,
    name,
    registration,
    hullIdNumber,
    year,
    manufacturer,
    model,
    lengthOverall,
    beam,
    draft,
    displacement,
    homeport,
    photos,
    onSave,
    onClose,
  ]);

  if (!visible) return null;

  return (
    <>
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
            <Text style={styles.headerTitle}>Boat Details</Text>
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
            {/* Basic Information */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>BASIC INFORMATION</Text>
              
              <Text style={styles.fieldLabel}>Boat Name *</Text>
              <TextInput
                style={styles.textInput}
                value={name}
                onChangeText={setName}
                placeholder="My Boat"
                placeholderTextColor="rgba(255,255,255,0.3)"
                autoCapitalize="words"
              />

              <Text style={styles.fieldLabel}>Year</Text>
              <TextInput
                style={styles.textInput}
                value={year}
                onChangeText={setYear}
                placeholder="2020"
                placeholderTextColor="rgba(255,255,255,0.3)"
                keyboardType="numeric"
              />

              <Text style={styles.fieldLabel}>Manufacturer</Text>
              <TextInput
                style={styles.textInput}
                value={manufacturer}
                onChangeText={setManufacturer}
                placeholder="Grady-White"
                placeholderTextColor="rgba(255,255,255,0.3)"
                autoCapitalize="words"
              />

              <Text style={styles.fieldLabel}>Model</Text>
              <TextInput
                style={styles.textInput}
                value={model}
                onChangeText={setModel}
                placeholder="Canyon 376"
                placeholderTextColor="rgba(255,255,255,0.3)"
                autoCapitalize="words"
              />
            </View>

            {/* Registration & Documentation */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>REGISTRATION & DOCUMENTATION</Text>
              
              <Text style={styles.fieldLabel}>Registration Number *</Text>
              <TextInput
                style={styles.textInput}
                value={registration}
                onChangeText={setRegistration}
                placeholder="CA 1234 AB"
                placeholderTextColor="rgba(255,255,255,0.3)"
                autoCapitalize="characters"
              />

              <Text style={styles.fieldLabel}>Hull ID Number *</Text>
              <TextInput
                style={styles.textInput}
                value={hullIdNumber}
                onChangeText={setHullIdNumber}
                placeholder="ABC12345D404"
                placeholderTextColor="rgba(255,255,255,0.3)"
                autoCapitalize="characters"
              />

              <Text style={styles.fieldLabel}>Homeport</Text>
              <TextInput
                style={styles.textInput}
                value={homeport}
                onChangeText={setHomeport}
                placeholder="San Diego, CA"
                placeholderTextColor="rgba(255,255,255,0.3)"
                autoCapitalize="words"
              />
            </View>

            {/* Dimensions */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>DIMENSIONS</Text>
              
              <View style={styles.row}>
                <View style={styles.halfField}>
                  <Text style={styles.fieldLabel}>Length (ft)</Text>
                  <TextInput
                    style={styles.textInput}
                    value={lengthOverall}
                    onChangeText={setLengthOverall}
                    placeholder="37.6"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    keyboardType="decimal-pad"
                  />
                </View>
                
                <View style={styles.halfField}>
                  <Text style={styles.fieldLabel}>Beam (ft)</Text>
                  <TextInput
                    style={styles.textInput}
                    value={beam}
                    onChangeText={setBeam}
                    placeholder="13.5"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>

              <View style={styles.row}>
                <View style={styles.halfField}>
                  <Text style={styles.fieldLabel}>Draft (ft)</Text>
                  <TextInput
                    style={styles.textInput}
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="2.5"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    keyboardType="decimal-pad"
                  />
                </View>
                
                <View style={styles.halfField}>
                  <Text style={styles.fieldLabel}>Displacement (lbs)</Text>
                  <TextInput
                    style={styles.textInput}
                    value={displacement}
                    onChangeText={setDisplacement}
                    placeholder="18000"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    keyboardType="numeric"
                  />
                </View>
              </View>
            </View>

          {/* Photos */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>PHOTOS</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.photosContainer}
            >
              {photos.map((photo) => (
                <View key={photo.id} style={styles.photoItem}>
                  <TouchableOpacity
                    onPress={() => setFullScreenPhoto(getPhotoDisplayUri(photo))}
                  >
                    <Image
                      source={{ uri: getPhotoDisplayUri(photo) }}
                      style={styles.photoThumbnail}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deletePhotoButton}
                    onPress={() => handleRemovePhoto(photo.id)}
                  >
                    <Ionicons name="close-circle" size={24} color="#FF6B6B" />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity style={styles.addPhotoButton} onPress={handleAddPhoto}>
                <Ionicons name="camera" size={32} color="rgba(255,255,255,0.5)" />
                <Text style={styles.addPhotoText}>Add Photo</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Full-screen photo viewer */}
      {fullScreenPhoto && (
        <Modal
          visible={true}
          transparent
          animationType="fade"
          onRequestClose={() => setFullScreenPhoto(null)}
        >
          <TouchableOpacity
            style={styles.fullScreenPhotoContainer}
            activeOpacity={1}
            onPress={() => setFullScreenPhoto(null)}
          >
            <Image source={{ uri: fullScreenPhoto }} style={styles.fullScreenPhoto} />
            <TouchableOpacity
              style={styles.closePhotoButton}
              onPress={() => setFullScreenPhoto(null)}
            >
              <Ionicons name="close" size={32} color="#fff" />
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}
    </>
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
  photosContainer: {
    marginTop: 12,
  },
  photoItem: {
    marginRight: 12,
    position: 'relative',
  },
  photoThumbnail: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  deletePhotoButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#1a1f2e',
    borderRadius: 12,
  },
  addPhotoButton: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  addPhotoText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 4,
  },
  fullScreenPhotoContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenPhoto: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },
  closePhotoButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    padding: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 20,
  },
});

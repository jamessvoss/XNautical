/**
 * Boat Photo Service
 * 
 * Handles photo capture/picking, local filesystem storage, and
 * background upload to Firebase Storage.
 * 
 * Local path: {documentDirectory}boat-photos/{boatId}/{photoId}.jpg
 * Cloud path: users/{userId}/boat-photos/{boatId}/{photoId}.jpg
 */

import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { documentDirectory, makeDirectoryAsync, copyAsync, deleteAsync, getInfoAsync } from 'expo-file-system/legacy';
import { BoatPhoto } from '../types/boat';

// Firebase Storage (native SDK)
let storageFns: {
  getStorage: () => any;
  ref: (storage: any, path: string) => any;
  uploadBytesResumable: (ref: any, data: any, metadata?: any) => any;
  getDownloadURL: (ref: any) => Promise<string>;
  deleteObject: (ref: any) => Promise<void>;
} | null = null;

let storageInstance: any = null;

if (Platform.OS !== 'web') {
  try {
    const rnfbStorage = require('@react-native-firebase/storage');
    storageInstance = rnfbStorage.default();
    storageFns = {
      getStorage: () => storageInstance,
      ref: (storage: any, path: string) => storage.ref(path),
      uploadBytesResumable: async (ref: any, blob: any, metadata?: any) => {
        return ref.put(blob, metadata);
      },
      getDownloadURL: async (ref: any) => ref.getDownloadURL(),
      deleteObject: async (ref: any) => ref.delete(),
    };
    console.log('[BoatPhotoService] Firebase Storage initialized');
  } catch (e) {
    console.log('[BoatPhotoService] Firebase Storage not available:', e);
  }
}

const PHOTOS_DIR = `${documentDirectory}boat-photos/`;

/**
 * Ensure the photos directory exists for a boat
 */
async function ensureDir(boatId: string): Promise<string> {
  const dir = `${PHOTOS_DIR}${boatId}/`;
  const info = await getInfoAsync(dir);
  if (!info.exists) {
    await makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

/**
 * Generate a unique photo ID
 */
function generatePhotoId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 6);
  return `photo_${timestamp}_${random}`;
}

/**
 * Pick a photo from the device's photo library
 */
export async function pickPhoto(boatId: string): Promise<BoatPhoto | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    console.warn('[BoatPhotoService] Media library permission denied');
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.7,
    allowsEditing: false,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }

  const asset = result.assets[0];
  return savePhotoLocally(boatId, asset.uri);
}

/**
 * Take a photo using the device camera
 */
export async function takePhoto(boatId: string): Promise<BoatPhoto | null> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== 'granted') {
    console.warn('[BoatPhotoService] Camera permission denied');
    return null;
  }

  const result = await ImagePicker.launchCameraAsync({
    quality: 0.7,
    allowsEditing: false,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }

  const asset = result.assets[0];
  return savePhotoLocally(boatId, asset.uri);
}

/**
 * Save a photo to local filesystem from a source URI
 */
async function savePhotoLocally(boatId: string, sourceUri: string): Promise<BoatPhoto> {
  const photoId = generatePhotoId();
  const dir = await ensureDir(boatId);
  const localUri = `${dir}${photoId}.jpg`;

  await copyAsync({ from: sourceUri, to: localUri });
  console.log(`[BoatPhotoService] Saved photo locally: ${localUri}`);

  return {
    id: photoId,
    localUri,
    remoteUrl: undefined,
    uploaded: false,
    takenAt: new Date().toISOString(),
  };
}

/**
 * Upload a single photo to Firebase Storage
 */
export async function uploadPhoto(
  userId: string,
  boatId: string,
  photo: BoatPhoto,
): Promise<BoatPhoto> {
  if (!storageInstance || !storageFns) {
    console.warn('[BoatPhotoService] Storage not available, skipping upload');
    return photo;
  }

  if (photo.uploaded && photo.remoteUrl) {
    return photo; // Already uploaded
  }

  try {
    const storagePath = `users/${userId}/boat-photos/${boatId}/${photo.id}.jpg`;
    const storageRefObj = storageFns.ref(storageInstance, storagePath);

    // Read local file and upload
    if (!photo.localUri) {
      console.warn('[BoatPhotoService] No local URI for photo', photo.id);
      return photo;
    }

    const response = await fetch(photo.localUri);
    const blob = await response.blob();

    await storageFns.uploadBytesResumable(storageRefObj, blob, {
      contentType: 'image/jpeg',
    });

    const downloadUrl = await storageFns.getDownloadURL(storageRefObj);
    console.log(`[BoatPhotoService] Uploaded: ${photo.id}`);

    return {
      ...photo,
      remoteUrl: downloadUrl,
      uploaded: true,
    };
  } catch (error) {
    console.error(`[BoatPhotoService] Upload failed for ${photo.id}:`, error);
    return photo; // Return unchanged, will retry later
  }
}

/**
 * Upload all pending photos for a boat
 * Returns updated photo array with upload status
 */
export async function uploadPendingPhotos(
  userId: string,
  boatId: string,
  photos: BoatPhoto[],
): Promise<BoatPhoto[]> {
  const results: BoatPhoto[] = [];

  for (const photo of photos) {
    if (!photo.uploaded) {
      const updated = await uploadPhoto(userId, boatId, photo);
      results.push(updated);
    } else {
      results.push(photo);
    }
  }

  return results;
}

/**
 * Delete a photo from both local filesystem and Firebase Storage
 */
export async function deletePhoto(
  userId: string,
  boatId: string,
  photo: BoatPhoto,
): Promise<void> {
  // Delete from local filesystem
  if (photo.localUri) {
    try {
      const info = await getInfoAsync(photo.localUri);
      if (info.exists) {
        await deleteAsync(photo.localUri);
        console.log(`[BoatPhotoService] Deleted local photo: ${photo.id}`);
      }
    } catch (error) {
      console.error(`[BoatPhotoService] Error deleting local photo ${photo.id}:`, error);
    }
  }

  // Delete from Firebase Storage
  if (photo.remoteUrl && storageInstance && storageFns) {
    try {
      const storagePath = `users/${userId}/boat-photos/${boatId}/${photo.id}.jpg`;
      const storageRefObj = storageFns.ref(storageInstance, storagePath);
      await storageFns.deleteObject(storageRefObj);
      console.log(`[BoatPhotoService] Deleted remote photo: ${photo.id}`);
    } catch (error) {
      console.error(`[BoatPhotoService] Error deleting remote photo ${photo.id}:`, error);
    }
  }
}

/**
 * Get the best available URI for displaying a photo
 * Prefers local URI (faster), falls back to remote URL
 */
export function getPhotoDisplayUri(photo: BoatPhoto): string {
  if (photo.localUri) {
    return photo.localUri;
  }
  if (photo.remoteUrl) {
    return photo.remoteUrl;
  }
  return ''; // No URI available
}

/**
 * Delete all photos for a boat
 */
export async function deleteAllBoatPhotos(
  userId: string,
  boatId: string,
  photos: BoatPhoto[],
): Promise<void> {
  for (const photo of photos) {
    await deletePhoto(userId, boatId, photo);
  }

  // Remove directory
  try {
    const dir = `${PHOTOS_DIR}${boatId}/`;
    const info = await getInfoAsync(dir);
    if (info.exists) {
      await deleteAsync(dir);
      console.log(`[BoatPhotoService] Deleted boat photos directory: ${boatId}`);
    }
  } catch (error) {
    console.error(`[BoatPhotoService] Error deleting photos directory for ${boatId}:`, error);
  }
}

/**
 * Waypoint Photo Service
 * 
 * Handles photo capture/picking, local filesystem storage, and
 * background upload to Firebase Storage.
 * 
 * Local path: {documentDirectory}waypoint-photos/{waypointId}/{photoId}.jpg
 * Cloud path: users/{userId}/waypoint-photos/{waypointId}/{photoId}.jpg
 */

import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { documentDirectory, makeDirectoryAsync, copyAsync, deleteAsync, getInfoAsync } from 'expo-file-system/legacy';
import { WaypointPhoto } from '../types/waypoint';

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
    storageInstance = rnfbStorage.getStorage();
    storageFns = {
      getStorage: rnfbStorage.getStorage,
      ref: rnfbStorage.ref,
      uploadBytesResumable: rnfbStorage.uploadBytesResumable,
      getDownloadURL: rnfbStorage.getDownloadURL,
      deleteObject: rnfbStorage.deleteObject,
    };
    console.log('[WaypointPhotoService] Firebase Storage initialized');
  } catch (e) {
    console.log('[WaypointPhotoService] Firebase Storage not available');
  }
}

const PHOTOS_DIR = `${documentDirectory}waypoint-photos/`;

/**
 * Ensure the photos directory exists for a waypoint
 */
async function ensureDir(waypointId: string): Promise<string> {
  const dir = `${PHOTOS_DIR}${waypointId}/`;
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
export async function pickPhoto(waypointId: string): Promise<WaypointPhoto | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    console.warn('[WaypointPhotoService] Media library permission denied');
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
  return savePhotoLocally(waypointId, asset.uri);
}

/**
 * Take a photo using the device camera
 */
export async function takePhoto(waypointId: string): Promise<WaypointPhoto | null> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== 'granted') {
    console.warn('[WaypointPhotoService] Camera permission denied');
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
  return savePhotoLocally(waypointId, asset.uri);
}

/**
 * Save a photo to local filesystem from a source URI
 */
async function savePhotoLocally(waypointId: string, sourceUri: string): Promise<WaypointPhoto> {
  const photoId = generatePhotoId();
  const dir = await ensureDir(waypointId);
  const localUri = `${dir}${photoId}.jpg`;

  await copyAsync({ from: sourceUri, to: localUri });
  console.log(`[WaypointPhotoService] Saved photo locally: ${localUri}`);

  return {
    id: photoId,
    localUri,
    remoteUrl: null,
    uploaded: false,
    takenAt: new Date().toISOString(),
  };
}

/**
 * Upload a single photo to Firebase Storage
 */
export async function uploadPhoto(
  userId: string,
  waypointId: string,
  photo: WaypointPhoto,
): Promise<WaypointPhoto> {
  if (!storageInstance || !storageFns) {
    console.warn('[WaypointPhotoService] Storage not available, skipping upload');
    return photo;
  }

  if (photo.uploaded && photo.remoteUrl) {
    return photo; // Already uploaded
  }

  try {
    const storagePath = `users/${userId}/waypoint-photos/${waypointId}/${photo.id}.jpg`;
    const storageRefObj = storageFns.ref(storageInstance, storagePath);

    // Read local file and upload
    const response = await fetch(photo.localUri);
    const blob = await response.blob();

    await storageFns.uploadBytesResumable(storageRefObj, blob, {
      contentType: 'image/jpeg',
    });

    const downloadUrl = await storageFns.getDownloadURL(storageRefObj);
    console.log(`[WaypointPhotoService] Uploaded: ${photo.id}`);

    return {
      ...photo,
      remoteUrl: downloadUrl,
      uploaded: true,
    };
  } catch (error) {
    console.error(`[WaypointPhotoService] Upload failed for ${photo.id}:`, error);
    return photo; // Return unchanged, will retry later
  }
}

/**
 * Upload all pending photos for a waypoint
 * Returns updated photo array with upload status
 */
export async function uploadPendingPhotos(
  userId: string,
  waypointId: string,
  photos: WaypointPhoto[],
): Promise<WaypointPhoto[]> {
  const results: WaypointPhoto[] = [];

  for (const photo of photos) {
    if (!photo.uploaded) {
      const updated = await uploadPhoto(userId, waypointId, photo);
      results.push(updated);
    } else {
      results.push(photo);
    }
  }

  return results;
}

/**
 * Delete a photo locally and from Firebase Storage
 */
export async function deletePhoto(
  userId: string,
  waypointId: string,
  photo: WaypointPhoto,
): Promise<void> {
  // Delete local file
  try {
    const info = await getInfoAsync(photo.localUri);
    if (info.exists) {
      await deleteAsync(photo.localUri);
    }
  } catch (e) {
    console.warn(`[WaypointPhotoService] Failed to delete local file: ${photo.localUri}`);
  }

  // Delete from Firebase Storage if uploaded
  if (photo.uploaded && photo.remoteUrl && storageInstance && storageFns) {
    try {
      const storagePath = `users/${userId}/waypoint-photos/${waypointId}/${photo.id}.jpg`;
      const storageRefObj = storageFns.ref(storageInstance, storagePath);
      await storageFns.deleteObject(storageRefObj);
    } catch (e) {
      console.warn(`[WaypointPhotoService] Failed to delete remote file: ${photo.id}`);
    }
  }

  console.log(`[WaypointPhotoService] Deleted photo: ${photo.id}`);
}

/**
 * Delete all photos for a waypoint (local + remote)
 */
export async function deleteAllPhotos(
  userId: string,
  waypointId: string,
  photos: WaypointPhoto[],
): Promise<void> {
  for (const photo of photos) {
    await deletePhoto(userId, waypointId, photo);
  }

  // Clean up the waypoint's photo directory
  try {
    const dir = `${PHOTOS_DIR}${waypointId}/`;
    const info = await getInfoAsync(dir);
    if (info.exists) {
      await deleteAsync(dir, { idempotent: true });
    }
  } catch (e) {
    // Directory may already be cleaned up
  }
}

/**
 * Get the display URI for a photo (local path preferred, remote fallback)
 */
export function getPhotoDisplayUri(photo: WaypointPhoto): string {
  // Always prefer local URI (faster, works offline)
  return photo.localUri || photo.remoteUrl || '';
}

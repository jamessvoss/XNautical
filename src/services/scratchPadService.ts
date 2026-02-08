/**
 * ScratchPad Service
 *
 * CRUD operations for scratchpad documents.
 * Pads are stored as JSON files in the local file system with PNG thumbnails.
 * A lightweight metadata index lives in AsyncStorage for fast list loading.
 */

import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ScratchPad, ScratchPadMeta } from '../types/scratchPad';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = '@XNautical:scratchPadIndex';
const PADS_DIR = `${FileSystem.documentDirectory}scratchpads/`;

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

/** Ensure the scratchpads directory exists. */
async function ensureDirectory(): Promise<void> {
  const info = await FileSystem.getInfoAsync(PADS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PADS_DIR, { intermediates: true });
    console.log('[ScratchPadService] Created scratchpads directory');
  }
}

function padPath(id: string): string {
  return `${PADS_DIR}${id}.json`;
}

function thumbPath(id: string): string {
  return `${PADS_DIR}${id}.thumb.png`;
}

// ---------------------------------------------------------------------------
// Index helpers (AsyncStorage)
// ---------------------------------------------------------------------------

async function readIndex(): Promise<ScratchPadMeta[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ScratchPadMeta[];
  } catch (e) {
    console.error('[ScratchPadService] Failed to read index', e);
    return [];
  }
}

async function writeIndex(index: ScratchPadMeta[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(index));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all scratchpad metadata sorted by updatedAt descending.
 */
export async function listPads(): Promise<ScratchPadMeta[]> {
  const index = await readIndex();
  return index.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

/**
 * Load a full scratchpad document by id.
 */
export async function loadPad(id: string): Promise<ScratchPad | null> {
  try {
    const path = padPath(id);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(path);
    return JSON.parse(raw) as ScratchPad;
  } catch (e) {
    console.error(`[ScratchPadService] Failed to load pad ${id}`, e);
    return null;
  }
}

/**
 * Save (create or update) a scratchpad document.
 * Optionally provide a thumbnail URI (temporary cache file from view-shot)
 * which will be copied into the scratchpads directory.
 */
export async function savePad(
  pad: ScratchPad,
  thumbnailSourceUri?: string,
): Promise<void> {
  await ensureDirectory();

  // Write pad JSON
  const json = JSON.stringify(pad);
  await FileSystem.writeAsStringAsync(padPath(pad.id), json);

  // Copy thumbnail if provided
  if (thumbnailSourceUri) {
    const dest = thumbPath(pad.id);
    // Delete old thumbnail first (move would fail if target exists)
    const existing = await FileSystem.getInfoAsync(dest);
    if (existing.exists) {
      await FileSystem.deleteAsync(dest, { idempotent: true });
    }
    await FileSystem.copyAsync({ from: thumbnailSourceUri, to: dest });
  }

  // Update index
  const index = await readIndex();
  const meta: ScratchPadMeta = {
    id: pad.id,
    createdAt: pad.createdAt,
    updatedAt: pad.updatedAt,
  };
  const idx = index.findIndex((m) => m.id === pad.id);
  if (idx >= 0) {
    index[idx] = meta;
  } else {
    index.push(meta);
  }
  await writeIndex(index);
  console.log(`[ScratchPadService] Saved pad ${pad.id}`);
}

/**
 * Delete a scratchpad and its thumbnail.
 */
export async function deletePad(id: string): Promise<void> {
  // Remove files
  await FileSystem.deleteAsync(padPath(id), { idempotent: true });
  await FileSystem.deleteAsync(thumbPath(id), { idempotent: true });

  // Remove from index
  const index = await readIndex();
  const filtered = index.filter((m) => m.id !== id);
  await writeIndex(filtered);
  console.log(`[ScratchPadService] Deleted pad ${id}`);
}

/**
 * Get the local file URI for a pad's thumbnail image.
 * Returns null if the thumbnail doesn't exist.
 */
export async function getThumbnailUri(id: string): Promise<string | null> {
  const path = thumbPath(id);
  const info = await FileSystem.getInfoAsync(path);
  return info.exists ? path : null;
}

/**
 * Generate a new unique id for a scratchpad.
 * Uses timestamp + random hex to avoid needing a uuid library.
 */
export function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${ts}-${rand}`;
}

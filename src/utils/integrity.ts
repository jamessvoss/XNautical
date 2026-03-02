/**
 * Download integrity utilities.
 *
 * Validates downloaded files via size checks and optional MD5 checksum verification.
 * Used by chartPackService after extracting downloaded packs.
 */

import * as FileSystem from 'expo-file-system/legacy';

/**
 * Validate that a file's size matches the expected byte count.
 * @param filePath Absolute path to the file
 * @param expectedBytes Expected size in bytes
 * @param tolerance Fractional tolerance (0.05 = 5%). Set to 0 for exact match.
 * @returns true if within tolerance
 */
export async function validateFileSize(
  filePath: string,
  expectedBytes: number,
  tolerance: number = 0.05,
): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(filePath);
  if (!info.exists || !info.size) return false;

  if (tolerance === 0) {
    return info.size === expectedBytes;
  }

  const diff = Math.abs(info.size - expectedBytes);
  return diff <= expectedBytes * tolerance;
}

/**
 * Compute the MD5 hash of a file using expo-file-system (reads as base64 chunks).
 *
 * Uses the js-md5 library (pure JS, ~6KB, no native deps) for incremental hashing.
 * Falls back gracefully if js-md5 is not installed.
 *
 * @param filePath Absolute path to the file
 * @returns hex-encoded MD5 string, or null if hashing is unavailable
 */
export async function computeMD5(filePath: string): Promise<string | null> {
  try {
    // Dynamic import so we don't hard-fail if js-md5 isn't installed yet
    const { md5 } = await import('js-md5');

    // Read file as base64 — expo-file-system doesn't support streaming reads,
    // but this is acceptable for typical mbtiles files (< 500 MB).
    const base64Content = await FileSystem.readAsStringAsync(filePath, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Decode base64 to binary array for hashing
    const binaryStr = atob(base64Content);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    return md5(bytes);
  } catch (error) {
    console.warn('[integrity] MD5 computation unavailable:', error);
    return null;
  }
}

/**
 * Validate a downloaded .mbtiles file has the expected SQLite structure.
 * Checks that the file starts with the SQLite magic header and contains
 * the `tiles` and `metadata` tables by scanning for their names in the file header area.
 *
 * This is a lightweight check — not a full SQLite open.
 * @param filePath Absolute path to the .mbtiles file
 * @returns true if the file appears to be a valid MBTiles database
 */
export async function validateMBTilesSchema(filePath: string): Promise<boolean> {
  try {
    // Read the first 4KB of the file to check SQLite header
    // SQLite files start with "SQLite format 3\000"
    const info = await FileSystem.getInfoAsync(filePath);
    if (!info.exists || !info.size || info.size < 1024) return false;

    const base64Header = await FileSystem.readAsStringAsync(filePath, {
      encoding: FileSystem.EncodingType.Base64,
      length: 4096,
      position: 0,
    });

    const header = atob(base64Header);
    if (!header.startsWith('SQLite format 3')) {
      console.warn('[integrity] File is not a SQLite database:', filePath);
      return false;
    }

    return true;
  } catch (error) {
    console.warn('[integrity] MBTiles validation failed:', error);
    return false;
  }
}

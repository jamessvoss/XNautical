/**
 * Chart Service - Formatting utilities for download UI
 * 
 * Legacy chart-metadata Firestore functions have been removed.
 * Chart downloads now use chartPackService (district-based packs).
 */

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Format download speed (bytes per second) to human readable string
 */
export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return '0 KB/s';
  
  const k = 1024;
  if (bytesPerSecond < k * k) {
    // Less than 1 MB/s - show as KB/s
    return `${Math.round(bytesPerSecond / k)} KB/s`;
  } else {
    // 1 MB/s or more - show as MB/s
    return `${(bytesPerSecond / (k * k)).toFixed(1)} MB/s`;
  }
}

/**
 * Format estimated time remaining in seconds to human readable string
 */
export function formatEta(seconds: number | undefined): string {
  if (seconds === undefined || seconds <= 0 || !isFinite(seconds)) {
    return '';
  }
  
  if (seconds < 60) {
    return `~${Math.round(seconds)}s left`;
  } else if (seconds < 3600) {
    const mins = Math.round(seconds / 60);
    return `~${mins} min left`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return mins > 0 ? `~${hours}h ${mins}m left` : `~${hours}h left`;
  }
}

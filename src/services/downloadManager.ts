/**
 * Download Manager Service
 * 
 * Centralized download orchestration with pause/resume support, state persistence,
 * and keep-awake management. Ensures downloads survive tab switches, app backgrounding,
 * and app restarts.
 */

import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

// ============================================
// Types
// ============================================

export type DownloadType = 'chart' | 'prediction' | 'buoy' | 'marine-zone';
export type DownloadStatus = 'downloading' | 'paused' | 'extracting' | 'completed' | 'failed';

export interface StartDownloadParams {
  type: DownloadType;
  districtId: string;
  packId?: string;
  url: string;
  destination: string;
  totalBytes: number;
}

export interface DownloadProgress {
  id: string;
  status: DownloadStatus;
  percent: number;
  bytesDownloaded: number;
  totalBytes: number;
  speedBps?: number;
  etaSeconds?: number;
  error?: string;
}

interface SpeedSample {
  bytes: number;
  time: number;
}

interface ActiveDownload {
  id: string;
  type: DownloadType;
  districtId: string;
  packId?: string;
  url: string;
  destination: string;
  resumable: FileSystem.DownloadResumable;
  progress: number;
  status: DownloadStatus;
  bytesDownloaded: number;
  totalBytes: number;
  startTime: number;
  error?: string;
  lastNotifyTime: number;
  lastNotifyPercent: number;
  speedSamples: SpeedSample[];
}

interface PersistedDownloadState {
  id: string;
  type: DownloadType;
  districtId: string;
  packId?: string;
  url: string;
  destination: string;
  progress: number;
  status: DownloadStatus;
  bytesDownloaded: number;
  totalBytes: number;
  startTime: number;
  resumeData: string;
}

// ============================================
// Constants
// ============================================

const STORAGE_KEY = '@XNautical:downloadManager';
const KEEP_AWAKE_TAG = 'downloads';
const STATE_SAVE_INTERVAL_MS = 5000; // Save state every 5 seconds

// ============================================
// Download Manager Class
// ============================================

class DownloadManager {
  private activeDownloads: Map<string, ActiveDownload> = new Map();
  private progressListeners: Map<string, Set<(progress: DownloadProgress) => void>> = new Map();
  private keepAwakeActive: boolean = false;
  private stateSaveTimer: NodeJS.Timeout | null = null;
  private initialized: boolean = false;

  // ============================================
  // Initialization
  // ============================================

  /**
   * Load persisted download state from AsyncStorage.
   * Call this on app launch to restore incomplete downloads.
   */
  async loadState(): Promise<void> {
    if (this.initialized) return;

    try {
      const stateJson = await AsyncStorage.getItem(STORAGE_KEY);
      if (!stateJson) {
        console.log('[DownloadManager] No persisted state found');
        this.initialized = true;
        return;
      }

      const states: PersistedDownloadState[] = JSON.parse(stateJson);
      console.log(`[DownloadManager] Loading ${states.length} persisted downloads`);

      // Restore downloads (but don't auto-start them)
      for (const state of states) {
        if (state.status === 'completed') continue;

        try {
          // Create resumable download from saved state
          const resumable = new FileSystem.DownloadResumable(
            state.url,
            state.destination,
            {},
            undefined,
            state.resumeData
          );

          const download: ActiveDownload = {
            ...state,
            resumable,
            status: 'paused', // Mark as paused until user resumes
            lastNotifyTime: 0,
            lastNotifyPercent: 0,
            speedSamples: [],
          };

          this.activeDownloads.set(state.id, download);
          console.log(`[DownloadManager] Restored download: ${state.id}`);
        } catch (error) {
          console.error(`[DownloadManager] Failed to restore download ${state.id}:`, error);
        }
      }

      this.initialized = true;
    } catch (error) {
      console.error('[DownloadManager] Error loading state:', error);
      this.initialized = true;
    }
  }

  /**
   * Save current download state to AsyncStorage
   */
  async saveState(): Promise<void> {
    try {
      const states: PersistedDownloadState[] = [];

      for (const download of this.activeDownloads.values()) {
        // Only save downloads that are in progress or paused
        if (download.status === 'completed' || download.status === 'failed') continue;

        try {
          const savable = download.resumable.savable();
          states.push({
            id: download.id,
            type: download.type,
            districtId: download.districtId,
            packId: download.packId,
            url: download.url,
            destination: download.destination,
            progress: download.progress,
            status: download.status,
            bytesDownloaded: download.bytesDownloaded,
            totalBytes: download.totalBytes,
            startTime: download.startTime,
            resumeData: savable.resumeData ?? '',
          });
        } catch (error) {
          console.warn(`[DownloadManager] Could not save download ${download.id}:`, error);
        }
      }

      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(states));
    } catch (error) {
      console.error('[DownloadManager] Error saving state:', error);
    }
  }

  /**
   * Start periodic state saving
   */
  private startStateSaving(): void {
    if (this.stateSaveTimer) return;

    this.stateSaveTimer = setInterval(() => {
      this.saveState();
    }, STATE_SAVE_INTERVAL_MS);
  }

  /**
   * Stop periodic state saving
   */
  private stopStateSaving(): void {
    if (this.stateSaveTimer) {
      clearInterval(this.stateSaveTimer);
      this.stateSaveTimer = null;
    }
  }

  // ============================================
  // Download Management
  // ============================================

  /**
   * Start a new download
   */
  async startDownload(params: StartDownloadParams): Promise<string> {
    await this.ensureInitialized();

    const id = `${params.districtId}_${params.type}_${params.packId || Date.now()}`;
    
    // Check if download already exists
    if (this.activeDownloads.has(id)) {
      const existing = this.activeDownloads.get(id)!;
      if (existing.status === 'downloading' || existing.status === 'extracting') {
        console.warn(`[DownloadManager] Download ${id} already active`);
        return id;
      }
    }

    console.log(`[DownloadManager] Starting download: ${id}`);

    const startTime = Date.now();

    // Create resumable download (throttled: notify UI max once per 500ms)
    const NOTIFY_THROTTLE_MS = 500;
    const resumable = FileSystem.createDownloadResumable(
      params.url,
      params.destination,
      {},
      (downloadProgress) => {
        const { totalBytesWritten, totalBytesExpectedToWrite } = downloadProgress;

        if (totalBytesExpectedToWrite > 0) {
          const percent = Math.round((totalBytesWritten / totalBytesExpectedToWrite) * 100);
          const download = this.activeDownloads.get(id);

          if (download) {
            download.progress = percent;
            download.bytesDownloaded = totalBytesWritten;

            // Throttle: only notify when enough time or progress has changed
            const now = Date.now();
            const timeSince = now - download.lastNotifyTime;
            const progressDelta = percent - download.lastNotifyPercent;

            if (timeSince < NOTIFY_THROTTLE_MS && progressDelta < 5 && percent !== 100) {
              return;
            }

            // Rolling speed: keep samples from last 5 seconds
            const SPEED_WINDOW_MS = 5000;
            download.speedSamples.push({ bytes: totalBytesWritten, time: now });
            const cutoff = now - SPEED_WINDOW_MS;
            download.speedSamples = download.speedSamples.filter(s => s.time >= cutoff);

            let speedBps = 0;
            const samples = download.speedSamples;
            if (samples.length >= 2) {
              const oldest = samples[0];
              const newest = samples[samples.length - 1];
              const dt = (newest.time - oldest.time) / 1000;
              if (dt > 0) {
                speedBps = (newest.bytes - oldest.bytes) / dt;
              }
            }

            const remainingBytes = totalBytesExpectedToWrite - totalBytesWritten;
            const etaSeconds = speedBps > 0 ? remainingBytes / speedBps : undefined;

            download.lastNotifyTime = now;
            download.lastNotifyPercent = percent;

            this.notifyProgress(id, {
              id,
              status: download.status,
              percent,
              bytesDownloaded: totalBytesWritten,
              totalBytes: totalBytesExpectedToWrite,
              speedBps,
              etaSeconds,
            });
          }
        }
      }
    );

    const download: ActiveDownload = {
      id,
      type: params.type,
      districtId: params.districtId,
      packId: params.packId,
      url: params.url,
      destination: params.destination,
      resumable,
      progress: 0,
      status: 'downloading',
      bytesDownloaded: 0,
      totalBytes: params.totalBytes,
      startTime,
      lastNotifyTime: 0,
      lastNotifyPercent: 0,
      speedSamples: [],
    };

    this.activeDownloads.set(id, download);
    this.updateKeepAwake();
    this.startStateSaving();

    // Start the download asynchronously
    this.executeDownload(id);

    return id;
  }

  /**
   * Execute the actual download
   */
  private async executeDownload(id: string): Promise<void> {
    const download = this.activeDownloads.get(id);
    if (!download) return;

    try {
      const result = await download.resumable.downloadAsync();

      if (!result) {
        // downloadAsync() returns null when paused — not an error
        if (download.status === 'paused') {
          console.log(`[DownloadManager] Download paused gracefully: ${id}`);
          return;
        }
        throw new Error('Download failed - no result returned');
      }

      download.status = 'completed';
      download.progress = 100;
      
      this.notifyProgress(id, {
        id,
        status: 'completed',
        percent: 100,
        bytesDownloaded: download.totalBytes,
        totalBytes: download.totalBytes,
      });

      console.log(`[DownloadManager] Download completed: ${id}`);
      
      // Clean up completed download after a delay
      setTimeout(() => {
        this.activeDownloads.delete(id);
        this.updateKeepAwake();
      }, 1000);

    } catch (error: any) {
      console.error(`[DownloadManager] Download failed for ${id}:`, error);
      
      download.status = 'failed';
      download.error = error.message || 'Download failed';
      
      this.notifyProgress(id, {
        id,
        status: 'failed',
        percent: download.progress,
        bytesDownloaded: download.bytesDownloaded,
        totalBytes: download.totalBytes,
        error: download.error,
      });

      this.updateKeepAwake();
    }
  }

  /**
   * Pause a specific download
   */
  async pauseDownload(id: string): Promise<void> {
    const download = this.activeDownloads.get(id);
    if (!download || download.status !== 'downloading') {
      console.warn(`[DownloadManager] Cannot pause download ${id} - not downloading`);
      return;
    }

    try {
      await download.resumable.pauseAsync();
      download.status = 'paused';
      
      this.notifyProgress(id, {
        id,
        status: 'paused',
        percent: download.progress,
        bytesDownloaded: download.bytesDownloaded,
        totalBytes: download.totalBytes,
      });

      console.log(`[DownloadManager] Paused download: ${id}`);
      await this.saveState();
      this.updateKeepAwake();
    } catch (error) {
      console.error(`[DownloadManager] Error pausing download ${id}:`, error);
    }
  }

  /**
   * Resume a specific download
   */
  async resumeDownload(id: string): Promise<void> {
    const download = this.activeDownloads.get(id);
    if (!download || download.status !== 'paused') {
      console.warn(`[DownloadManager] Cannot resume download ${id} - not paused`);
      return;
    }

    try {
      download.status = 'downloading';
      download.startTime = Date.now();
      download.speedSamples = []; // Fresh speed samples after resume
      
      this.notifyProgress(id, {
        id,
        status: 'downloading',
        percent: download.progress,
        bytesDownloaded: download.bytesDownloaded,
        totalBytes: download.totalBytes,
      });

      this.updateKeepAwake();
      this.startStateSaving();

      console.log(`[DownloadManager] Resuming download: ${id}`);
      
      // Resume the download asynchronously
      this.executeDownload(id);
    } catch (error) {
      console.error(`[DownloadManager] Error resuming download ${id}:`, error);
    }
  }

  /**
   * Pause all active downloads
   */
  async pauseAll(): Promise<void> {
    console.log('[DownloadManager] Pausing all downloads');
    const pausePromises: Promise<void>[] = [];

    for (const [id, download] of this.activeDownloads) {
      if (download.status === 'downloading') {
        pausePromises.push(this.pauseDownload(id));
      }
    }

    await Promise.all(pausePromises);
    this.stopStateSaving();
    await this.saveState(); // Final save
  }

  /**
   * Resume all paused downloads
   */
  async resumeAll(): Promise<void> {
    console.log('[DownloadManager] Resuming all downloads');
    
    for (const [id, download] of this.activeDownloads) {
      if (download.status === 'paused') {
        await this.resumeDownload(id);
      }
    }
  }

  /**
   * Cancel a download
   */
  async cancelDownload(id: string): Promise<void> {
    const download = this.activeDownloads.get(id);
    if (!download) return;

    try {
      if (download.status === 'downloading') {
        await download.resumable.pauseAsync();
      }

      this.activeDownloads.delete(id);
      this.progressListeners.delete(id);

      console.log(`[DownloadManager] Cancelled download: ${id}`);
      await this.saveState();
      this.updateKeepAwake();
    } catch (error) {
      console.error(`[DownloadManager] Error cancelling download ${id}:`, error);
    }
  }

  // ============================================
  // Progress Monitoring
  // ============================================

  /**
   * Subscribe to progress updates for a specific download
   */
  subscribeToProgress(id: string, callback: (progress: DownloadProgress) => void): () => void {
    if (!this.progressListeners.has(id)) {
      this.progressListeners.set(id, new Set());
    }

    this.progressListeners.get(id)!.add(callback);

    // Immediately send current progress if download exists
    const download = this.activeDownloads.get(id);
    if (download) {
      callback({
        id,
        status: download.status,
        percent: download.progress,
        bytesDownloaded: download.bytesDownloaded,
        totalBytes: download.totalBytes,
      });
    }

    // Return unsubscribe function
    return () => {
      const listeners = this.progressListeners.get(id);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          this.progressListeners.delete(id);
        }
      }
    };
  }

  /**
   * Notify all listeners about progress update
   */
  private notifyProgress(id: string, progress: DownloadProgress): void {
    const listeners = this.progressListeners.get(id);
    if (listeners) {
      listeners.forEach(callback => callback(progress));
    }
  }

  /**
   * Wait for a download to complete
   */
  async waitForCompletion(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const unsubscribe = this.subscribeToProgress(id, (progress) => {
        if (progress.status === 'completed') {
          unsubscribe();
          resolve();
        } else if (progress.status === 'failed') {
          unsubscribe();
          reject(new Error(progress.error || 'Download failed'));
        }
      });
    });
  }

  // ============================================
  // Query Methods
  // ============================================

  /**
   * Get all incomplete downloads
   */
  async getIncompleteDownloads(districtId?: string): Promise<DownloadProgress[]> {
    await this.ensureInitialized();

    const incomplete: DownloadProgress[] = [];

    for (const download of this.activeDownloads.values()) {
      if (download.status === 'completed') continue;
      if (districtId && download.districtId !== districtId) continue;

      incomplete.push({
        id: download.id,
        status: download.status,
        percent: download.progress,
        bytesDownloaded: download.bytesDownloaded,
        totalBytes: download.totalBytes,
      });
    }

    return incomplete;
  }

  /**
   * Get all paused downloads
   */
  async getPausedDownloads(): Promise<DownloadProgress[]> {
    await this.ensureInitialized();

    const paused: DownloadProgress[] = [];

    for (const download of this.activeDownloads.values()) {
      if (download.status === 'paused') {
        paused.push({
          id: download.id,
          status: download.status,
          percent: download.progress,
          bytesDownloaded: download.bytesDownloaded,
          totalBytes: download.totalBytes,
        });
      }
    }

    return paused;
  }

  /**
   * Pause all downloads for a specific district
   */
  async pauseAllForDistrict(districtId: string): Promise<void> {
    console.log(`[DownloadManager] Pausing downloads for district: ${districtId}`);
    const pausePromises: Promise<void>[] = [];

    for (const [id, download] of this.activeDownloads) {
      if (download.districtId === districtId && download.status === 'downloading') {
        pausePromises.push(this.pauseDownload(id));
      }
    }

    await Promise.all(pausePromises);
    await this.saveState();
  }

  /**
   * Resume all downloads for a specific district
   */
  async resumeAllForDistrict(districtId: string): Promise<void> {
    console.log(`[DownloadManager] Resuming downloads for district: ${districtId}`);

    for (const [id, download] of this.activeDownloads) {
      if (download.districtId === districtId && download.status === 'paused') {
        await this.resumeDownload(id);
      }
    }
  }

  /**
   * Cancel all downloads for a specific district
   */
  async cancelAllForDistrict(districtId: string): Promise<void> {
    console.log(`[DownloadManager] Cancelling downloads for district: ${districtId}`);
    const ids: string[] = [];

    for (const [id, download] of this.activeDownloads) {
      if (download.districtId === districtId) {
        ids.push(id);
      }
    }

    for (const id of ids) {
      await this.cancelDownload(id);
    }
  }

  /**
   * Check if any downloads are active
   */
  hasActiveDownloads(): boolean {
    for (const download of this.activeDownloads.values()) {
      if (download.status === 'downloading' || download.status === 'extracting') {
        return true;
      }
    }
    return false;
  }

  // ============================================
  // Keep Awake Management
  // ============================================

  /**
   * Update keep-awake state based on active downloads
   */
  private updateKeepAwake(): void {
    const shouldBeAwake = this.hasActiveDownloads();

    if (shouldBeAwake && !this.keepAwakeActive) {
      console.log('[DownloadManager] Activating keep-awake');
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(error => {
        console.error('[DownloadManager] Error activating keep-awake:', error);
      });
      this.keepAwakeActive = true;
    } else if (!shouldBeAwake && this.keepAwakeActive) {
      console.log('[DownloadManager] Deactivating keep-awake');
      deactivateKeepAwake(KEEP_AWAKE_TAG);
      this.keepAwakeActive = false;
    }
  }

  // ============================================
  // Utilities
  // ============================================

  /**
   * Ensure manager is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.loadState();
    }
  }

  /**
   * Clear all persisted state (for testing/debugging)
   */
  async clearPersistedState(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEY);
    console.log('[DownloadManager] Cleared persisted state');
  }
}

// ============================================
// Export Singleton Instance
// ============================================

export const downloadManager = new DownloadManager();

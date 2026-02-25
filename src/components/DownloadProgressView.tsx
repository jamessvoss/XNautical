/**
 * DownloadProgressView
 * 
 * Streamlined download progress interface with:
 * - Master status box showing current phase, progress, speed, and ETA
 * - Visual checklist of all download items
 * - Pause/Resume and Cancel functionality
 * - Individual tracking for each chart scale and data type
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOverlay } from '../contexts/OverlayContext';
import * as chartPackService from '../services/chartPackService';
import { formatBytes, formatSpeed, formatEta } from '../services/chartService';
import type { PackDownloadStatus, DistrictDownloadPack } from '../types/chartPack';
import {
  downloadAllPredictions,
  arePredictionsDownloaded,
} from '../services/stationService';
import {
  downloadBuoyCatalog,
  areBuoysDownloaded,
} from '../services/buoyService';
import {
  downloadMarineZones,
  areMarineZonesDownloaded,
} from '../services/marineZoneService';

interface Region {
  firestoreId: string;
  name: string;
}

type SatelliteResolution = 'low' | 'medium' | 'high' | 'ultra';

interface DownloadProgressViewProps {
  region: Region;
  selectedResolution: SatelliteResolution;
  selectedOptionalMaps?: Set<string>;
  onComplete: () => void;
  onCancel: () => void;
}

interface DownloadItem {
  id: string;
  label: string;
  type: 'chart' | 'prediction' | 'buoy' | 'marine-zone' | 'gnis' | 'satellite' | 'basemap' | 'ocean' | 'terrain';
  packId?: string;
  predictionType?: 'tides' | 'currents';
}

interface ItemStatus {
  status: 'pending' | 'downloading' | 'extracting' | 'complete' | 'error';
  progress: number;
  message?: string;
}

interface District {
  downloadPacks: DistrictDownloadPack[];
  metadata?: {
    predictionSizeMB?: {
      tides?: number;
      currents?: number;
    };
  };
}

interface ConsoleLogEntry {
  id: string;
  timestamp: string;
  message: string;
  status: 'info' | 'pending' | 'active' | 'extracting' | 'complete' | 'error';
}

export default function DownloadProgressView({
  region,
  selectedResolution,
  selectedOptionalMaps,
  onComplete,
  onCancel,
}: DownloadProgressViewProps) {
  const [loading, setLoading] = useState(true);
  const [districtData, setDistrictData] = useState<District | null>(null);
  const [downloadItems, setDownloadItems] = useState<DownloadItem[]>([]);
  const [itemStatuses, setItemStatuses] = useState<Map<string, ItemStatus>>(new Map());
  
  const [currentPhase, setCurrentPhase] = useState('');
  const [currentItem, setCurrentItem] = useState('');
  const [overallProgress, setOverallProgress] = useState(0);
  
  const [isPaused, setIsPaused] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const isCancelledRef = useRef(false);

  // Enhanced master status
  const [totalBytesDownloaded, setTotalBytesDownloaded] = useState(0);
  const [totalBytesToDownload, setTotalBytesToDownload] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState('0:00');

  // Per-item byte tracking for continuous progress
  const itemByteSizes = useRef<Map<string, number>>(new Map());
  const itemBytesDownloaded = useRef<Map<string, number>>(new Map());

  // View-level rolling speed/ETA
  const byteSamples = useRef<{ bytes: number; time: number }[]>([]);
  const [viewSpeedBps, setViewSpeedBps] = useState<number | null>(null);
  const [viewEtaSeconds, setViewEtaSeconds] = useState<number | null>(null);

  // Console log
  const [consoleLog, setConsoleLog] = useState<ConsoleLogEntry[]>([]);
  const consoleScrollRef = useRef<any>(null);

  // Progress logging deduplication
  const lastLoggedProgress = useRef<Map<string, number>>(new Map());

  const insets = useSafeAreaInsets();
  const { requestMapReset } = useOverlay();

  const firestoreId = region.firestoreId;

  const monoFont = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

  // ============================================
  // Console log helpers
  // ============================================

  const getTimestamp = () => {
    const now = new Date();
    return now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const addConsoleEntry = (id: string, message: string, status: ConsoleLogEntry['status']) => {
    setConsoleLog(prev => {
      const existing = prev.findIndex(e => e.id === id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = { id, timestamp: getTimestamp(), message, status };
        return updated;
      }
      return [...prev, { id, timestamp: getTimestamp(), message, status }];
    });
    setTimeout(() => consoleScrollRef.current?.scrollToEnd({ animated: true }), 50);
  };

  const formatElapsed = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // Elapsed time ticker
  useEffect(() => {
    if (!startTime || !isDownloading) return;
    const timer = setInterval(() => {
      setElapsedTime(formatElapsed(Date.now() - startTime));
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime, isDownloading]);

  // ============================================
  // Per-item byte reporting and view-level speed
  // ============================================

  const reportItemBytes = (itemId: string, bytes: number) => {
    itemBytesDownloaded.current.set(itemId, bytes);
    // Sum all per-item bytes for continuous totalBytesDownloaded
    let total = 0;
    itemBytesDownloaded.current.forEach(b => { total += b; });
    setTotalBytesDownloaded(total);
  };

  // View-level rolling speed/ETA timer (every 1s, uses last 5s of byte samples)
  useEffect(() => {
    if (!isDownloading) return;
    const SPEED_WINDOW_MS = 5000;
    const timer = setInterval(() => {
      const now = Date.now();
      // Sum current bytes from ref
      let currentBytes = 0;
      itemBytesDownloaded.current.forEach(b => { currentBytes += b; });

      byteSamples.current.push({ bytes: currentBytes, time: now });
      const cutoff = now - SPEED_WINDOW_MS;
      byteSamples.current = byteSamples.current.filter(s => s.time >= cutoff);

      const samples = byteSamples.current;
      if (samples.length >= 2) {
        const oldest = samples[0];
        const newest = samples[samples.length - 1];
        const dt = (newest.time - oldest.time) / 1000;
        if (dt > 0.5) {
          const speed = (newest.bytes - oldest.bytes) / dt;
          setViewSpeedBps(speed > 0 ? speed : null);
          if (speed > 0 && totalBytesToDownload > 0) {
            const remaining = totalBytesToDownload - currentBytes;
            setViewEtaSeconds(remaining > 0 ? remaining / speed : 0);
          } else {
            setViewEtaSeconds(null);
          }
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isDownloading, totalBytesToDownload]);

  // ============================================
  // Load district data and build download list
  // ============================================

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      console.log(`[DownloadProgressView] Loading district data for ${firestoreId}...`);
      
      const data = await chartPackService.getDistrict(firestoreId);
      setDistrictData(data);
      
      if (data) {
        const items = buildDownloadItems(data);
        setDownloadItems(items);

        // Initialize all items as pending
        const initialStatuses = new Map<string, ItemStatus>();
        items.forEach(item => {
          initialStatuses.set(item.id, { status: 'pending', progress: 0 });
        });
        setItemStatuses(initialStatuses);

        // Calculate total download size: packs have known sizes, estimate others
        let totalBytes = 0;
        const predSizes = data.metadata?.predictionSizeMB;
        const BUOY_ESTIMATE = 2 * 1024 * 1024;       // ~2 MB
        const MARINE_ZONE_ESTIMATE = 1 * 1024 * 1024; // ~1 MB

        for (const item of items) {
          let size = 0;
          if (item.packId) {
            const pack = data.downloadPacks.find(p => p.id === item.packId);
            if (pack) size = pack.sizeBytes;
          } else if (item.type === 'prediction') {
            if (item.predictionType === 'tides') {
              size = (predSizes?.tides ?? 5) * 1024 * 1024;
            } else {
              size = (predSizes?.currents ?? 3) * 1024 * 1024;
            }
          } else if (item.type === 'buoy') {
            size = BUOY_ESTIMATE;
          } else if (item.type === 'marine-zone') {
            size = MARINE_ZONE_ESTIMATE;
          }
          itemByteSizes.current.set(item.id, size);
          totalBytes += size;
        }
        setTotalBytesToDownload(totalBytes);

        // Initialize console log with all items
        const initialLog: ConsoleLogEntry[] = items.map(item => ({
          id: item.id,
          timestamp: getTimestamp(),
          message: item.label,
          status: 'pending' as const,
        }));
        setConsoleLog(initialLog);

        console.log(`[DownloadProgressView] Built ${items.length} download items`);
      }
    } catch (error) {
      console.error('[DownloadProgressView] Error loading data:', error);
      Alert.alert('Error', 'Failed to load download data');
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // Build download items list
  // ============================================

  const buildDownloadItems = (data: District): DownloadItem[] => {
    const items: DownloadItem[] = [];
    const packs = data.downloadPacks;

    // Charts - separate item for each scale (US1-US6)
    const chartPacks = packs.filter(p => p.type === 'charts');
    chartPacks.forEach(pack => {
      const scale = pack.id.replace('charts-', '').toUpperCase();
      items.push({
        id: `chart-${scale}`,
        label: `Charts ${scale}`,
        type: 'chart',
        packId: pack.id,
      });
    });

    // Predictions - separate for tides and currents
    items.push({
      id: 'predictions-tides',
      label: 'Predictions (Tides)',
      type: 'prediction',
      predictionType: 'tides',
    });
    items.push({
      id: 'predictions-currents',
      label: 'Predictions (Currents)',
      type: 'prediction',
      predictionType: 'currents',
    });

    // Buoys
    items.push({
      id: 'buoys',
      label: 'Live Buoys',
      type: 'buoy',
    });

    // Marine zones
    items.push({
      id: 'marine-zones',
      label: 'Marine Zone Boundaries',
      type: 'marine-zone',
    });

    // GNIS
    const gnisPacks = packs.filter(p => p.type === 'gnis');
    if (gnisPacks.length > 0) {
      items.push({
        id: 'gnis',
        label: 'GNIS Place Names',
        type: 'gnis',
        packId: gnisPacks[0].id,
      });
    }

    // Satellite (if any selected)
    const satellitePacks = packs.filter(p => p.type === 'satellite');
    if (satellitePacks.length > 0) {
      // Filter by resolution
      let maxZoom = 8;
      if (selectedResolution === 'medium') maxZoom = 11;
      if (selectedResolution === 'high') maxZoom = 12;
      if (selectedResolution === 'ultra') maxZoom = 14;

      const relevantPacks = satellitePacks.filter(p => {
        const zoomMatch = p.id.match(/z(\d+)(?:[-_](\d+))?/);
        if (!zoomMatch) return false;
        const zStart = parseInt(zoomMatch[1]);
        return zStart <= maxZoom;
      });

      if (relevantPacks.length > 0) {
        relevantPacks.forEach(pack => {
          items.push({
            id: `satellite-${pack.id}`,
            label: `Satellite ${pack.id.replace('satellite-', '').replace('satellite_', '')}`,
            type: 'satellite',
            packId: pack.id,
          });
        });
      }
    }

    // Optional maps
    if (selectedOptionalMaps?.has('basemap')) {
      const basemapPacks = packs.filter(p => p.type === 'basemap');
      if (basemapPacks.length > 0) {
        items.push({
          id: 'basemap',
          label: 'Basemap',
          type: 'basemap',
          packId: basemapPacks[0].id,
        });
      }
    }

    if (selectedOptionalMaps?.has('ocean')) {
      const oceanPacks = packs.filter(p => p.type === 'ocean');
      if (oceanPacks.length > 0) {
        items.push({
          id: 'ocean',
          label: 'Ocean Map',
          type: 'ocean',
          packId: oceanPacks[0].id,
        });
      }
    }

    if (selectedOptionalMaps?.has('terrain')) {
      const terrainPacks = packs.filter(p => p.type === 'terrain');
      if (terrainPacks.length > 0) {
        items.push({
          id: 'terrain',
          label: 'Terrain Map',
          type: 'terrain',
          packId: terrainPacks[0].id,
        });
      }
    }

    return items;
  };

  // ============================================
  // Status update helpers
  // ============================================

  const updateItemStatus = (itemId: string, status: ItemStatus['status'], progress: number, message?: string) => {
    setItemStatuses(prev => {
      const updated = new Map(prev);
      updated.set(itemId, { status, progress, message });
      return updated;
    });

    // Map item status to console status
    const consoleStatus: ConsoleLogEntry['status'] =
      status === 'complete' ? 'complete'
      : status === 'error' ? 'error'
      : status === 'extracting' ? 'extracting'
      : status === 'downloading' ? 'active'
      : 'pending';
    addConsoleEntry(itemId, downloadItems.find(i => i.id === itemId)?.label || itemId, consoleStatus);
  };

  useEffect(() => {
    if (downloadItems.length === 0 || totalBytesToDownload === 0) return;
    // Byte-weighted progress: sum(itemSize * itemProgress%) / totalBytes
    let weightedBytes = 0;
    itemStatuses.forEach((s, itemId) => {
      const size = itemByteSizes.current.get(itemId) || 0;
      weightedBytes += size * (s.progress / 100);
    });
    setOverallProgress(Math.min(100, Math.floor((weightedBytes / totalBytesToDownload) * 100)));
  }, [itemStatuses, totalBytesToDownload]);

  // ============================================
  // Download orchestration
  // ============================================

  useEffect(() => {
    if (!loading && districtData && downloadItems.length > 0) {
      // Start downloading automatically
      setTimeout(() => {
        executeDownloads();
      }, 500);
    }
  }, [loading, districtData, downloadItems]);

  const executeDownloads = async () => {
    if (isDownloading) return;

    console.log(`[DownloadProgressView] Starting download of ${downloadItems.length} items: ${downloadItems.map(i => i.label).join(', ')}`);

    setIsDownloading(true);
    setStartTime(Date.now());
    isCancelledRef.current = false;
    byteSamples.current = [];
    itemBytesDownloaded.current.clear();

    addConsoleEntry('__start__', `Downloading ${downloadItems.length} items for ${region.name}...`, 'info');

    try {
      for (let i = 0; i < downloadItems.length; i++) {
        if (isCancelledRef.current) {
          console.log('[DownloadProgressView] ❌ Download cancelled by user at item', i);
          break;
        }

        const item = downloadItems[i];
        console.log(`\n[DownloadProgressView] [${i + 1}/${downloadItems.length}] Starting: ${item.label} (type: ${item.type})`);

        try {
          if (item.type === 'chart') {
            await downloadChartItem(item);
          } else if (item.type === 'prediction') {
            await downloadPredictionItem(item);
          } else if (item.type === 'buoy') {
            await downloadBuoyItem(item);
          } else if (item.type === 'marine-zone') {
            await downloadMarineZoneItem(item);
          } else if (item.type === 'gnis' || item.type === 'satellite' || item.type === 'basemap' || item.type === 'ocean' || item.type === 'terrain') {
            await downloadPackItem(item);
          }

          if (!isCancelledRef.current) {
            updateItemStatus(item.id, 'complete', 100);
            console.log(`[DownloadProgressView] ✅ [${i + 1}/${downloadItems.length}] Completed: ${item.label}`);
          }
        } catch (itemError: any) {
          console.error(`[DownloadProgressView] ❌ Error downloading ${item.label}:`, itemError);
          console.error('[DownloadProgressView] Error stack:', itemError.stack);
          updateItemStatus(item.id, 'error', 0, itemError.message);
          // Don't stop the loop - continue with other items
        }
      }

      if (!isCancelledRef.current) {
        console.log('[DownloadProgressView] All downloads complete, finalizing...');
        setCurrentPhase('Finalizing');
        setCurrentItem('Generating manifest...');
        addConsoleEntry('__finalize__', 'Finalizing installation...', 'info');

        // Regenerate manifest once for all downloaded chart packs
        await chartPackService.generateManifest();

        // Fetch points.mbtiles (all point features: soundings, lights, buoys, etc.)
        try {
          const success = await chartPackService.fetchPoints(firestoreId);
          if (success) {
            console.log(`[DownloadProgressView] Fetched points.mbtiles for ${firestoreId}`);
          }
        } catch (ptErr) {
          console.warn('[DownloadProgressView] Points fetch failed (non-critical):', ptErr);
        }

        await registerDistrict();

        addConsoleEntry('__done__', 'All downloads complete!', 'complete');
        console.log('[DownloadProgressView] Download sequence complete');

        // Flush tile server caches and force MapLibre remount
        await requestMapReset();

        Alert.alert('Complete', 'All data downloaded successfully.');
        onComplete();
      }
    } catch (error: any) {
      console.error('[DownloadProgressView] Fatal error in download sequence:', error);
      addConsoleEntry('__error__', `Error: ${error.message || 'Download failed'}`, 'error');
      Alert.alert('Error', error.message || 'Download failed');
    } finally {
      setIsDownloading(false);
    }
  };

  // ============================================
  // Individual download handlers
  // ============================================

  const downloadChartItem = async (item: DownloadItem) => {
    if (!item.packId || !districtData) return;

    setCurrentPhase('Downloading Charts');
    setCurrentItem(item.label);
    updateItemStatus(item.id, 'downloading', 0);

    const pack = districtData.downloadPacks.find(p => p.id === item.packId);
    if (!pack) return;

    console.log(`  [Chart] ${item.label} (${(pack.sizeBytes / 1024 / 1024).toFixed(1)} MB)`);

    const success = await chartPackService.downloadPack(
      pack,
      firestoreId,
      (status: PackDownloadStatus) => {
        if (isCancelledRef.current) return;

        const isExtracting = status.status === 'extracting';
        if (isExtracting) setCurrentPhase('Extracting Charts');

        updateItemStatus(item.id, isExtracting ? 'extracting' : 'downloading', status.progress);
        reportItemBytes(item.id, status.bytesDownloaded);

        // Deduplicated progress logging
        const lastLogged = lastLoggedProgress.current.get(item.id) ?? -1;
        if (Math.floor(status.progress / 25) > Math.floor(lastLogged / 25)) {
          console.log(`  [Chart] ${item.label}: ${status.progress}%`);
          lastLoggedProgress.current.set(item.id, status.progress);
        }
      },
      true, // skipManifest — regenerated once after all chart packs
    );

    if (success) {
      reportItemBytes(item.id, pack.sizeBytes);
      console.log(`  [Chart] ${item.label} complete`);
    } else if (!isCancelledRef.current) {
      console.error(`  [Chart] ${item.label} failed`);
      updateItemStatus(item.id, 'error', 0, 'Download failed');
    }
  };

  const downloadPredictionItem = async (item: DownloadItem) => {
    // Predictions are downloaded together — only process via the tides item
    if (item.predictionType !== 'tides') return;

    setCurrentPhase('Downloading Predictions');
    setCurrentItem('Tides & Currents');
    updateItemStatus('predictions-tides', 'downloading', 0);
    updateItemStatus('predictions-currents', 'downloading', 0);

    const result = await downloadAllPredictions(
      (message: string, percent: number) => {
        if (isCancelledRef.current) return;

        const isExtracting = message.toLowerCase().includes('extracting');
        if (isExtracting) setCurrentPhase('Extracting Predictions');

        const status: ItemStatus['status'] = isExtracting ? 'extracting' : 'downloading';
        updateItemStatus('predictions-tides', status, percent, message);
        updateItemStatus('predictions-currents', status, percent, message);

        // Estimate bytes from percent for both prediction items
        const tidesSize = itemByteSizes.current.get('predictions-tides') || 0;
        const currentsSize = itemByteSizes.current.get('predictions-currents') || 0;
        reportItemBytes('predictions-tides', tidesSize * (percent / 100));
        reportItemBytes('predictions-currents', currentsSize * (percent / 100));

        if (message.toLowerCase().includes('tides')) setCurrentItem('Tides');
        else if (message.toLowerCase().includes('currents')) setCurrentItem('Currents');

        const lastLogged = lastLoggedProgress.current.get('predictions') ?? -1;
        if (Math.floor(percent / 25) > Math.floor(lastLogged / 25)) {
          console.log(`  [Predictions] ${message} (${percent}%)`);
          lastLoggedProgress.current.set('predictions', percent);
        }
      },
      firestoreId
    );

    if (result.success) {
      reportItemBytes('predictions-tides', itemByteSizes.current.get('predictions-tides') || 0);
      reportItemBytes('predictions-currents', itemByteSizes.current.get('predictions-currents') || 0);
      console.log('  [Predictions] complete');
    } else if (!isCancelledRef.current) {
      console.error('  [Predictions] failed:', result.error);
      updateItemStatus('predictions-tides', 'error', 0, 'Download failed');
      updateItemStatus('predictions-currents', 'error', 0, 'Download failed');
    }
  };

  const downloadBuoyItem = async (item: DownloadItem) => {
    setCurrentPhase('Downloading Live Buoys');
    setCurrentItem(item.label);
    updateItemStatus(item.id, 'downloading', 0);

    const result = await downloadBuoyCatalog(
      firestoreId,
      (message: string, percent: number) => {
        if (isCancelledRef.current) return;
        updateItemStatus(item.id, 'downloading', percent, message);
        const estimatedSize = itemByteSizes.current.get(item.id) || 0;
        reportItemBytes(item.id, estimatedSize * (percent / 100));
      }
    );

    if (result.success) {
      reportItemBytes(item.id, itemByteSizes.current.get(item.id) || 0);
      console.log('  [Buoys] complete');
    } else if (!isCancelledRef.current) {
      console.error('  [Buoys] failed');
      updateItemStatus(item.id, 'error', 0, 'Download failed');
    }
  };

  const downloadMarineZoneItem = async (item: DownloadItem) => {
    setCurrentPhase('Downloading Marine Zones');
    setCurrentItem(item.label);
    updateItemStatus(item.id, 'downloading', 0);

    const result = await downloadMarineZones(
      firestoreId,
      (message: string, percent: number) => {
        if (isCancelledRef.current) return;
        updateItemStatus(item.id, 'downloading', percent, message);
        const estimatedSize = itemByteSizes.current.get(item.id) || 0;
        reportItemBytes(item.id, estimatedSize * (percent / 100));
      }
    );

    if (result.success) {
      reportItemBytes(item.id, itemByteSizes.current.get(item.id) || 0);
      console.log('  [Marine Zones] complete');
    } else if (!isCancelledRef.current) {
      console.error('  [Marine Zones] failed');
      updateItemStatus(item.id, 'error', 0, 'Download failed');
    }
  };

  const downloadPackItem = async (item: DownloadItem) => {
    if (!item.packId || !districtData) return;

    const typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1);
    setCurrentPhase(`Downloading ${typeLabel}`);
    setCurrentItem(item.label);
    updateItemStatus(item.id, 'downloading', 0);

    const pack = districtData.downloadPacks.find(p => p.id === item.packId);
    if (!pack) return;

    console.log(`  [Pack] ${item.label} (${(pack.sizeBytes / 1024 / 1024).toFixed(1)} MB)`);

    const success = await chartPackService.downloadPack(
      pack,
      firestoreId,
      (status: PackDownloadStatus) => {
        if (isCancelledRef.current) return;

        const isExtracting = status.status === 'extracting';
        if (isExtracting) setCurrentPhase(`Extracting ${typeLabel}`);

        updateItemStatus(item.id, isExtracting ? 'extracting' : 'downloading', status.progress);
        reportItemBytes(item.id, status.bytesDownloaded);

        const lastLogged = lastLoggedProgress.current.get(item.id) ?? -1;
        if (Math.floor(status.progress / 25) > Math.floor(lastLogged / 25)) {
          console.log(`  [Pack] ${item.label}: ${status.progress}%`);
          lastLoggedProgress.current.set(item.id, status.progress);
        }
      }
    );

    if (success) {
      reportItemBytes(item.id, pack.sizeBytes);
      console.log(`  [Pack] ${item.label} complete`);
    } else if (!isCancelledRef.current) {
      console.error(`  [Pack] ${item.label} failed`);
      updateItemStatus(item.id, 'error', 0, 'Download failed');
    }
  };

  // ============================================
  // Register district
  // ============================================

  const registerDistrict = async () => {
    console.log('[DownloadProgressView] Registering district with region registry...');
    
    try {
      const { registerDistrict } = await import('../services/regionRegistryService');
      
      const installedPackIds = await chartPackService.getInstalledPackIds(firestoreId);
      const predDownloaded = await arePredictionsDownloaded(firestoreId);
      const buoysDownloaded = await areBuoysDownloaded(firestoreId);
      const marineZonesDownloaded = await areMarineZonesDownloaded(firestoreId);

      const districtInfo = {
        hasCharts: installedPackIds.includes('charts') || installedPackIds.some(id => id.startsWith('charts-')),
        hasPredictions: predDownloaded,
        hasBuoys: buoysDownloaded,
        hasMarineZones: marineZonesDownloaded,
        hasSatellite: installedPackIds.some(id => id.startsWith('satellite-')),
        hasBasemap: installedPackIds.includes('basemap'),
        hasGnis: installedPackIds.includes('gnis'),
        hasOcean: installedPackIds.some(id => id === 'ocean' || id.startsWith('ocean-')),
        hasTerrain: installedPackIds.some(id => id === 'terrain' || id.startsWith('terrain-')),
      };

      await registerDistrict(firestoreId, districtInfo);
      console.log('[DownloadProgressView] District registered:', districtInfo);
    } catch (error: any) {
      console.error('[DownloadProgressView] Error registering district:', error);
      // Don't throw - registration failure shouldn't stop completion
    }
  };

  // ============================================
  // Pause/Resume/Cancel handlers
  // ============================================

  const handlePause = async () => {
    if (isPaused) {
      // Resume
      console.log('[DownloadProgressView] Resuming downloads...');
      const { downloadManager } = await import('../services/downloadManager');
      await downloadManager.resumeAllForDistrict(firestoreId);
      setIsPaused(false);
      // TODO: Continue download loop
    } else {
      // Pause
      console.log('[DownloadProgressView] Pausing downloads...');
      const { downloadManager } = await import('../services/downloadManager');
      await downloadManager.pauseAllForDistrict(firestoreId);
      setIsPaused(true);
    }
  };

  const handleCancel = () => {
    Alert.alert(
      'Cancel Downloads',
      'Stop downloading and discard incomplete files?',
      [
        { text: 'Keep Downloading', style: 'cancel' },
        {
          text: 'Cancel',
          style: 'destructive',
          onPress: async () => {
            console.log('[DownloadProgressView] Cancelling downloads...');
            isCancelledRef.current = true;
            
            // Cancel via download manager
            try {
              const { downloadManager } = await import('../services/downloadManager');
              await downloadManager.cancelAllForDistrict(firestoreId);
            } catch (error) {
              console.error('[DownloadProgressView] Error cancelling downloads:', error);
            }
            
            onCancel();
          },
        },
      ]
    );
  };

  // ============================================
  // Derived values
  // ============================================

  const completedCount = (() => {
    let c = 0;
    itemStatuses.forEach(s => { if (s.status === 'complete') c++; });
    return c;
  })();

  // ============================================
  // Render helpers
  // ============================================

  const renderStatsRow = (label: string, value: string, isLast = false) => (
    <View style={[styles.statsRow, isLast && styles.statsRowLast]}>
      <Text style={styles.statsLabel}>{label}</Text>
      <Text style={[styles.statsValue, { fontFamily: monoFont }]}>{value}</Text>
    </View>
  );

  const renderConsoleEntry = (entry: ConsoleLogEntry, index: number) => {
    let badge = '';
    let badgeColor = '#00cc00';
    if (entry.status === 'active') { badge = '[DOWNLOAD]'; badgeColor = '#ffcc00'; }
    else if (entry.status === 'extracting') { badge = '[EXTRACT]'; badgeColor = '#ff9900'; }
    else if (entry.status === 'complete') { badge = '[OK]'; badgeColor = '#00cc00'; }
    else if (entry.status === 'error') { badge = '[FAIL]'; badgeColor = '#ff4444'; }

    const msgColor =
      entry.status === 'pending' ? '#555555'
      : entry.status === 'error' ? '#ff4444'
      : entry.status === 'info' ? '#00cc00'
      : '#cccccc';

    return (
      <View key={`${entry.id}-${index}`} style={styles.consoleLine}>
        <Text style={[styles.consoleTimestamp, { fontFamily: monoFont }]}>
          [{entry.timestamp}]
        </Text>
        <Text
          style={[styles.consoleMessage, { fontFamily: monoFont, color: msgColor }]}
          numberOfLines={1}
        >
          {entry.message}
        </Text>
        {badge !== '' && (
          <Text style={[styles.consoleBadge, { fontFamily: monoFont, color: badgeColor }]}>
            {badge}
          </Text>
        )}
      </View>
    );
  };

  // ============================================
  // Render
  // ============================================

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4FC3F7" />
        <Text style={styles.loadingText}>Preparing downloads...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 20) }]}>
      {/* Master Status Box */}
      <View style={styles.masterStatusBox}>
        <View style={styles.statusHeader}>
          <Text style={styles.phaseText}>{currentPhase || 'PREPARING...'}</Text>
          <View style={styles.actionButtons}>
            <TouchableOpacity onPress={handlePause} style={styles.actionButton}>
              <Ionicons name={isPaused ? 'play' : 'pause'} size={22} color="#ffffff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleCancel} style={styles.actionButton}>
              <Ionicons name="close" size={22} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Progress bar with percentage inline */}
        <View style={styles.progressRow}>
          <View style={styles.progressBarContainer}>
            <View style={[styles.progressBar, { width: `${overallProgress}%` }]} />
          </View>
          <Text style={[styles.progressPercentage, { fontFamily: monoFont }]}>{overallProgress}%</Text>
        </View>

        {currentItem ? (
          <Text style={styles.currentItem}>{currentItem}</Text>
        ) : null}

        {isPaused && (
          <Text style={styles.pausedText}>PAUSED</Text>
        )}

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          {totalBytesToDownload > 0 && renderStatsRow(
            'Downloaded',
            `${formatBytes(totalBytesDownloaded)} / ${formatBytes(totalBytesToDownload)}`
          )}
          {renderStatsRow('Progress', `${completedCount} / ${downloadItems.length} items`)}
          {viewSpeedBps !== null && viewSpeedBps > 0 && renderStatsRow('Speed', formatSpeed(viewSpeedBps))}
          {viewEtaSeconds !== null && viewEtaSeconds > 0 && renderStatsRow('Time Left', formatEta(viewEtaSeconds))}
          {renderStatsRow('Elapsed', elapsedTime, true)}
        </View>
      </View>

      {/* Console Log */}
      <View style={styles.consoleContainer}>
        <View style={styles.consoleHeader}>
          <Text style={[styles.consoleTitle, { fontFamily: monoFont }]}>DOWNLOAD LOG</Text>
        </View>
        <ScrollView
          ref={consoleScrollRef}
          style={styles.consoleScroll}
          showsVerticalScrollIndicator={true}
          contentContainerStyle={{ paddingBottom: 8 }}
        >
          {consoleLog.map((entry, i) => renderConsoleEntry(entry, i))}
        </ScrollView>
      </View>
    </View>
  );
}

// ============================================
// Styles
// ============================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 20,
    paddingHorizontal: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
  },

  // Master status box
  masterStatusBox: {
    backgroundColor: 'rgba(20, 30, 50, 0.95)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(79, 195, 247, 0.4)',
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  phaseText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#4FC3F7',
    textTransform: 'uppercase',
    letterSpacing: 1,
    flex: 1,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 16,
  },
  actionButton: {
    padding: 4,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  progressBarContainer: {
    flex: 1,
    height: 10,
    backgroundColor: 'rgba(79, 195, 247, 0.15)',
    borderRadius: 5,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(79, 195, 247, 0.25)',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#4FC3F7',
    borderRadius: 4,
  },
  progressPercentage: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    width: 44,
    textAlign: 'right',
  },
  currentItem: {
    fontSize: 15,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.85)',
    marginBottom: 12,
  },
  pausedText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFA726',
    letterSpacing: 1,
    marginBottom: 12,
  },

  // Stats grid
  statsGrid: {
    backgroundColor: 'rgba(79, 195, 247, 0.06)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(79, 195, 247, 0.15)',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  statsRowLast: {
    borderBottomWidth: 0,
  },
  statsLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: 0.3,
  },
  statsValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4FC3F7',
  },

  // Console log
  consoleContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a3a1a',
    overflow: 'hidden',
  },
  consoleHeader: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a3a1a',
  },
  consoleTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#00cc00',
    letterSpacing: 1.5,
  },
  consoleScroll: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  consoleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
  },
  consoleTimestamp: {
    fontSize: 11,
    color: '#555555',
    marginRight: 8,
  },
  consoleMessage: {
    fontSize: 12,
    color: '#cccccc',
    flex: 1,
  },
  consoleBadge: {
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 6,
  },
});

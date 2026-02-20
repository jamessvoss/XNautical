/**
 * DownloadPanel
 *
 * Bottom panel shown in the RegionSelector when a district/subregion is selected.
 * Shows download summary with:
 *   - Charts (US1-US6) as a required package
 *   - Predictions (Tides & Currents)
 *   - Satellite imagery with resolution selector (Low/Med/High)
 *   - Basemap & GNIS (included)
 *   - Total download size
 *   - Download button with progress
 *   - Post-download management (delete individual items)
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import * as chartPackService from '../services/chartPackService';
import { formatBytes, formatSpeed, formatEta } from '../services/chartService';
import {
  downloadAllPredictions,
  arePredictionsDownloaded,
  clearPredictions,
  getPredictionDatabaseMetadata,
} from '../services/stationService';
import {
  downloadBuoyCatalog,
  areBuoysDownloaded,
  clearBuoys,
} from '../services/buoyService';
import {
  downloadMarineZones,
  areMarineZonesDownloaded,
  clearMarineZones,
} from '../services/marineZoneService';
import type { Region, SatelliteResolution } from '../config/regionData';
import { SATELLITE_OPTIONS } from '../config/regionData';
import type { District, DistrictDownloadPack, PackDownloadStatus } from '../types/chartPack';

// ============================================
// Types
// ============================================

interface Props {
  region: Region | null;
  onBack: () => void;
  selectedOptionalMaps?: Set<string>;
}

interface DownloadCategory {
  id: string;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  sizeBytes: number;
  required: boolean;
  installed: boolean;
  packs: DistrictDownloadPack[];
}

// ============================================
// Component
// ============================================

export default function DownloadPanel({ region, onBack, selectedOptionalMaps }: Props) {
  console.log('[DownloadPanel] Component rendering, region:', region?.firestoreId);
  
  const [loading, setLoading] = useState(true);
  const [districtData, setDistrictData] = useState<District | null>(null);
  const [installedPackIds, setInstalledPackIds] = useState<string[]>([]);
  const [satelliteResolution, setSatelliteResolution] = useState<SatelliteResolution>('medium');
  const [packDownloadStatus, setPackDownloadStatus] = useState<PackDownloadStatus | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [currentDownloadItem, setCurrentDownloadItem] = useState<string>('');
  const [hasIncompleteDownloads, setHasIncompleteDownloads] = useState(false);

  // Predictions state
  const [predictionsDownloaded, setPredictionsDownloaded] = useState(false);
  const [downloadingPredictions, setDownloadingPredictions] = useState(false);
  const [predictionsPercent, setPredictionsPercent] = useState(0);
  const [predictionsMessage, setPredictionsMessage] = useState('');

  // Buoys state
  const [buoysDownloaded, setBuoysDownloaded] = useState(false);
  const [downloadingBuoys, setDownloadingBuoys] = useState(false);
  const [buoysPercent, setBuoysPercent] = useState(0);
  const [buoysMessage, setBuoysMessage] = useState('');

  // Marine zones state
  const [marineZonesDownloaded, setMarineZonesDownloaded] = useState(false);
  const [downloadingMarineZones, setDownloadingMarineZones] = useState(false);
  const [marineZonesPercent, setMarineZonesPercent] = useState(0);
  const [marineZonesMessage, setMarineZonesMessage] = useState('');

  const firestoreId = region?.firestoreId || '';
  console.log('[DownloadPanel] firestoreId:', firestoreId);

  // ============================================
  // Check for incomplete downloads
  // ============================================

  useEffect(() => {
    checkForIncompleteDownloads();
  }, [firestoreId]);

  const checkForIncompleteDownloads = async () => {
    if (!firestoreId) return;
    
    try {
      const { downloadManager } = await import('../services/downloadManager');
      const incomplete = await downloadManager.getIncompleteDownloads(firestoreId);
      setHasIncompleteDownloads(incomplete.length > 0);
    } catch (error) {
      console.error('[DownloadPanel] Error checking incomplete downloads:', error);
    }
  };

  const handleResumeDownloads = async () => {
    try {
      const { downloadManager } = await import('../services/downloadManager');
      await downloadManager.resumeAllForDistrict(firestoreId);
      setDownloadingAll(true);
      setHasIncompleteDownloads(false);
    } catch (error) {
      console.error('[DownloadPanel] Error resuming downloads:', error);
    }
  };

  // ============================================
  // Load data
  // ============================================

  useEffect(() => {
    console.log('[DownloadPanel] useEffect triggered, region:', region?.firestoreId);
    if (region) {
      console.log('[DownloadPanel] Calling loadData()');
      loadData();
    }
  }, [region]);

  const loadData = async () => {
    if (!region) return;
    try {
      setLoading(true);

      // Load district data from Firestore
      console.log(`[DownloadPanel] Loading district data for ${region.firestoreId}...`);
      const data = await chartPackService.getDistrict(region.firestoreId);
      console.log(`[DownloadPanel] District data loaded:`, data);
      console.log(`[DownloadPanel] District has metadata?`, data?.metadata ? 'YES' : 'NO');
      if (data?.metadata) {
        console.log(`[DownloadPanel] Metadata contents:`, JSON.stringify(data.metadata, null, 2));
      }
      setDistrictData(data);

      // Check installed packs
      const installed = await chartPackService.getInstalledPackIds(region.firestoreId);
      setInstalledPackIds(installed);

      // Check predictions status (per-district)
      const predDownloaded = await arePredictionsDownloaded(region.firestoreId);
      setPredictionsDownloaded(predDownloaded);

      // Check buoys status
      const buoysDl = await areBuoysDownloaded(region.firestoreId);
      setBuoysDownloaded(buoysDl);

      // Check marine zones status
      const marineZonesDl = await areMarineZonesDownloaded(region.firestoreId);
      setMarineZonesDownloaded(marineZonesDl);
    } catch (error) {
      console.error('[DownloadPanel] Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // Organize packs into categories
  // ============================================

  const categories = useMemo((): DownloadCategory[] => {
    if (!districtData?.downloadPacks) return [];

    console.log(`[DownloadPanel] Building categories from districtData`);
    console.log(`[DownloadPanel] districtData.metadata:`, districtData.metadata);

    // Decompression ratio: MBTiles and SQLite compress to ~50%, so 2x for decompressed size
    const DECOMPRESSION_RATIO = 2.0;

    const packs = districtData.downloadPacks;
    const cats: DownloadCategory[] = [];

    // Charts - unified single pack or per-scale packs
    const chartPacks = packs.filter(p => p.type === 'charts');
    if (chartPacks.length > 0) {
      const totalSize = chartPacks.reduce((sum, p) => sum + (p.sizeBytes * DECOMPRESSION_RATIO), 0);
      const allInstalled = chartPacks.every(p => installedPackIds.includes(p.id));
      const isUnified = chartPacks.length === 1 && !chartPacks[0].band;
      cats.push({
        id: 'charts',
        label: isUnified ? 'Navigation Charts' : 'Charts (US1-US6)',
        description: isUnified ? 'All chart scales (Overview through Berthing)' : `${chartPacks.length} scale packs`,
        icon: 'map',
        sizeBytes: totalSize,
        required: true,
        installed: allInstalled,
        packs: chartPacks,
      });
    }

    // Predictions (required - not a Firestore pack, handled separately)
    // Try to get actual size from district metadata
    let predictionSize = 48 * 1024 * 1024; // Default estimate
    if (districtData.downloadPacks) {
      // Check if metadata includes prediction sizes
      const metadataAny = districtData as any;
      console.log(`[DownloadPanel] Checking prediction sizes from metadata...`);
      console.log(`[DownloadPanel] metadataAny.metadata:`, metadataAny.metadata);
      if (metadataAny.metadata?.predictionSizes) {
        const predSizes = metadataAny.metadata.predictionSizes;
        console.log(`[DownloadPanel] Found prediction sizes:`, predSizes);
        predictionSize = ((predSizes.tides || 0) + (predSizes.currents || 0)) * DECOMPRESSION_RATIO;
        console.log(`[DownloadPanel] Calculated prediction size (decompressed):`, predictionSize, 'bytes');
      } else {
        console.log(`[DownloadPanel] No prediction sizes in metadata, using default estimate`);
      }
    }
    
    cats.push({
      id: 'predictions',
      label: 'Predictions (Tides & Currents)',
      description: 'Tide and current prediction data',
      icon: 'water',
      sizeBytes: predictionSize,
      required: true,
      installed: predictionsDownloaded,
      packs: [],
    });

    // Live Buoys (required - cached from Firestore for offline use)
    // Try to get actual count from district metadata
    let buoySize = 1 * 1024 * 1024; // Default estimate
    const metadataAny = districtData as any;
    console.log(`[DownloadPanel] Checking buoy count from metadata...`);
    console.log(`[DownloadPanel] metadataAny.metadata?.buoyCount:`, metadataAny.metadata?.buoyCount);
    if (metadataAny.metadata?.buoyCount) {
      // Rough estimate: 5 KB per buoy station
      buoySize = metadataAny.metadata.buoyCount * 5 * 1024;
      console.log(`[DownloadPanel] Calculated buoy size:`, buoySize, 'bytes for', metadataAny.metadata.buoyCount, 'buoys');
    }
    
    cats.push({
      id: 'buoys',
      label: 'Live Buoys',
      description: 'Weather buoy locations & observations',
      icon: 'radio-outline',
      sizeBytes: buoySize,
      required: true,
      installed: buoysDownloaded,
      packs: [],
    });

    // Marine Zone Boundaries (required - for offline weather zone display)
    // Try to get actual count from district metadata
    let marineZoneSize = 0.5 * 1024 * 1024; // Default estimate
    console.log(`[DownloadPanel] Checking marine zone count from metadata...`);
    console.log(`[DownloadPanel] metadataAny.metadata?.marineZoneCount:`, metadataAny.metadata?.marineZoneCount);
    if (metadataAny.metadata?.marineZoneCount) {
      // Rough estimate: 20 KB per zone (includes geometry)
      marineZoneSize = metadataAny.metadata.marineZoneCount * 20 * 1024;
      console.log(`[DownloadPanel] Calculated marine zone size:`, marineZoneSize, 'bytes for', metadataAny.metadata.marineZoneCount, 'zones');
    }
    
    cats.push({
      id: 'marine-zones',
      label: 'Marine Zone Boundaries',
      description: 'Weather forecast zone boundaries',
      icon: 'map-outline',
      sizeBytes: marineZoneSize,
      required: true,
      installed: marineZonesDownloaded,
      packs: [],
    });

    // GNIS Place Names (required - small overlay)
    const gnisPacks = packs.filter(p => p.type === 'gnis');
    if (gnisPacks.length > 0) {
      const totalSize = gnisPacks.reduce((sum, p) => sum + (p.sizeBytes * DECOMPRESSION_RATIO), 0);
      const allInstalled = gnisPacks.every(p => installedPackIds.includes(p.id));
      cats.push({
        id: 'gnis',
        label: 'Place Names (GNIS)',
        description: 'Geographic names overlay',
        icon: 'text',
        sizeBytes: totalSize,
        required: true,
        installed: allInstalled,
        packs: gnisPacks,
      });
    }

    // Satellite imagery - based on selected resolution
    const satellitePacks = packs.filter(p => p.type === 'satellite');
    if (satellitePacks.length > 0) {
      const selectedOption = SATELLITE_OPTIONS.find(o => o.resolution === satelliteResolution);
      
      // Calculate actual size from packs based on resolution
      let maxZoom = 8;
      if (satelliteResolution === 'medium') maxZoom = 11;
      if (satelliteResolution === 'high') maxZoom = 12;
      if (satelliteResolution === 'ultra') maxZoom = 14;
      
      const relevantPacks = satellitePacks.filter(p => {
        // Match patterns like: satellite-z0-5, satellite_z0-5, satellite-z8, satellite_z14
        const zoomMatch = p.id.match(/z(\d+)(?:[-_](\d+))?/);
        if (!zoomMatch) return false;
        
        const zStart = parseInt(zoomMatch[1]);
        // Include if zoom range starts at or below our max zoom
        return zStart <= maxZoom;
      });
      
      const totalSize = relevantPacks.reduce((sum, p) => sum + (p.sizeBytes * DECOMPRESSION_RATIO), 0);
      const anyInstalled = relevantPacks.some(p => installedPackIds.includes(p.id));
      cats.push({
        id: 'satellite',
        label: 'Satellite Imagery',
        description: selectedOption ? `${selectedOption.label} (${selectedOption.zoomLevels})` : '',
        icon: 'earth',
        sizeBytes: totalSize,
        required: false,
        installed: anyInstalled,
        packs: relevantPacks,
      });
    }

    // Basemap - only include if selected in optional maps picker
    if (!selectedOptionalMaps || selectedOptionalMaps.has('basemap')) {
      const basemapPacks = packs.filter(p => p.type === 'basemap');
      if (basemapPacks.length > 0) {
        const totalSize = basemapPacks.reduce((sum, p) => sum + (p.sizeBytes * DECOMPRESSION_RATIO), 0);
        const allInstalled = basemapPacks.every(p => installedPackIds.includes(p.id));
        cats.push({
          id: 'basemap',
          label: 'Basemap',
          description: 'Base land/water map tiles',
          icon: 'layers',
          sizeBytes: totalSize,
          required: false,
          installed: allInstalled,
          packs: basemapPacks,
        });
      }
    }

    // Ocean basemap - only include if selected in optional maps picker
    if (!selectedOptionalMaps || selectedOptionalMaps.has('ocean')) {
      const oceanPacks = packs.filter(p => p.type === 'ocean');
      if (oceanPacks.length > 0) {
        const totalSize = oceanPacks.reduce((sum, p) => sum + (p.sizeBytes * DECOMPRESSION_RATIO), 0);
        const allInstalled = oceanPacks.every(p => installedPackIds.includes(p.id));
        cats.push({
          id: 'ocean',
          label: 'Ocean Map',
          description: 'ESRI Ocean Basemap',
          icon: 'water',
          sizeBytes: totalSize,
          required: false,
          installed: allInstalled,
          packs: oceanPacks,
        });
      }
    }

    // Terrain basemap - only include if selected in optional maps picker
    if (!selectedOptionalMaps || selectedOptionalMaps.has('terrain')) {
      const terrainPacks = packs.filter(p => p.type === 'terrain');
      if (terrainPacks.length > 0) {
        const totalSize = terrainPacks.reduce((sum, p) => sum + (p.sizeBytes * DECOMPRESSION_RATIO), 0);
        const allInstalled = terrainPacks.every(p => installedPackIds.includes(p.id));
        cats.push({
          id: 'terrain',
          label: 'Terrain Map',
          description: 'OpenTopoMap terrain',
          icon: 'layers-outline',
          sizeBytes: totalSize,
          required: false,
          installed: allInstalled,
          packs: terrainPacks,
        });
      }
    }


    return cats;
  }, [districtData, installedPackIds, satelliteResolution, predictionsDownloaded, buoysDownloaded, marineZonesDownloaded, selectedOptionalMaps]);

  // ============================================
  // Total size calculation
  // ============================================

  const totalSizeBytes = useMemo(() => {
    return categories.reduce((sum, cat) => sum + cat.sizeBytes, 0);
  }, [categories]);

  const installedCount = useMemo(() => {
    return categories.filter(c => c.installed).length;
  }, [categories]);

  const allInstalled = installedCount === categories.length;

  // Split categories into required and optional
  const requiredCategories = useMemo(() => {
    return categories.filter(c => c.required);
  }, [categories]);

  const optionalCategories = useMemo(() => {
    return categories.filter(c => !c.required);
  }, [categories]);

  const requiredSizeBytes = useMemo(() => {
    return requiredCategories.reduce((sum, cat) => sum + cat.sizeBytes, 0);
  }, [requiredCategories]);

  const optionalSizeBytes = useMemo(() => {
    return optionalCategories.reduce((sum, cat) => sum + cat.sizeBytes, 0);
  }, [optionalCategories]);

  // ============================================
  // Download handlers
  // ============================================

  // Helper to format category size for display
  const formatCategorySize = (cat: DownloadCategory): string => {
    const metadataAny = districtData as any;
    
    console.log(`[DownloadPanel] formatCategorySize called for ${cat.id}`);
    
    // Special formatting for metadata-based categories
    if (cat.id === 'buoys') {
      const count = metadataAny.metadata?.buoyCount;
      console.log(`[DownloadPanel] Formatting buoys - count:`, count);
      return count ? `${count} buoys` : '? buoys';
    }
    
    if (cat.id === 'marine-zones') {
      const count = metadataAny.metadata?.marineZoneCount;
      console.log(`[DownloadPanel] Formatting marine zones - count:`, count);
      return count ? `${count} zones` : '? zones';
    }
    
    if (cat.id === 'predictions') {
      const predSizes = metadataAny.metadata?.predictionSizeMB;
      console.log(`[DownloadPanel] Formatting predictions - sizes:`, predSizes);
      if (predSizes?.tides && predSizes?.currents) {
        return `Tides ${predSizes.tides}MB • Currents ${predSizes.currents}MB`;
      }
    }
    
    // Standard size formatting
    const mb = cat.sizeBytes / 1024 / 1024;
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)}GB`;
    } else if (mb < 1) {
      return `${(cat.sizeBytes / 1024).toFixed(0)}KB`;
    } else {
      return `${mb.toFixed(0)}MB`;
    }
  };

  const handleDownloadAll = async () => {
    if (downloadingAll || packDownloadStatus) {
      Alert.alert('Download in Progress', 'Please wait for the current download to complete.');
      return;
    }

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      Alert.alert('No Internet', 'Please check your connection and try again.');
      return;
    }

    const totalMB = totalSizeBytes / 1024 / 1024;
    const isWifi = netState.type === 'wifi';
    const wifiWarning = !isWifi && totalMB > 50
      ? '\n\nNot on WiFi - this will use cellular data.'
      : '';

    const regionName = region?.name || 'this region';

    Alert.alert(
      'Download All',
      `Download all data for ${regionName}?\n\nTotal: ~${totalMB >= 1024 ? `${(totalMB / 1024).toFixed(1)} GB` : `${totalMB.toFixed(0)} MB`}${wifiWarning}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Download',
          onPress: () => executeDownloadAll(),
        },
      ]
    );
  };

  const executeDownloadAll = async () => {
    setDownloadingAll(true);

    try {
      // Download each category sequentially
      for (const category of categories) {
        if (category.installed) continue;

        if (category.id === 'predictions') {
          // Handle predictions separately
          setCurrentDownloadItem('Predictions');
          setDownloadingPredictions(true);
          setPredictionsPercent(0);
          setPredictionsMessage('');

          const result = await downloadAllPredictions((message, percent) => {
            setPredictionsPercent(percent);
            setPredictionsMessage(message);
          }, firestoreId);

          setDownloadingPredictions(false);
          setPredictionsMessage('');
          if (result.success) {
            setPredictionsDownloaded(true);
          }
          continue;
        }

        if (category.id === 'buoys') {
          // Handle buoys separately
          setCurrentDownloadItem('Live Buoys');
          setDownloadingBuoys(true);
          setBuoysPercent(0);
          setBuoysMessage('');

          const result = await downloadBuoyCatalog(firestoreId, (message, percent) => {
            setBuoysPercent(percent);
            setBuoysMessage(message);
          });

          setDownloadingBuoys(false);
          setBuoysMessage('');
          if (result.success) {
            setBuoysDownloaded(true);
          }
          continue;
        }

        if (category.id === 'marine-zones') {
          // Handle marine zones separately
          setCurrentDownloadItem('Marine Zone Boundaries');
          setDownloadingMarineZones(true);
          setMarineZonesPercent(0);
          setMarineZonesMessage('');

          const result = await downloadMarineZones(firestoreId, (message, percent) => {
            setMarineZonesPercent(percent);
            setMarineZonesMessage(message);
          });

          setDownloadingMarineZones(false);
          setMarineZonesMessage('');
          if (result.success) {
            setMarineZonesDownloaded(true);
          }
          continue;
        }

        // Download all packs in this category (skip per-pack manifest, batch at end)
        for (const pack of category.packs) {
          if (installedPackIds.includes(pack.id)) continue;

          setCurrentDownloadItem(pack.name);
          const success = await chartPackService.downloadPack(
            pack,
            firestoreId,
            (status) => setPackDownloadStatus(status),
            true, // skipManifest — we'll regenerate once after all packs
          );

          if (success) {
            setInstalledPackIds(prev => [...prev, pack.id]);
          }
          setPackDownloadStatus(null);
        }
      }

      // Regenerate manifest once for all downloaded chart packs
      await chartPackService.generateManifest();

      // Fetch pre-computed sector lights for reliable arc rendering
      try {
        const slCount = await chartPackService.fetchSectorLights(firestoreId);
        if (slCount > 0) {
          console.log(`[DownloadPanel] Fetched ${slCount} sector lights for ${firestoreId}`);
        }
      } catch (slErr) {
        console.warn('[DownloadPanel] Sector lights fetch failed (non-critical):', slErr);
      }

      // Refresh installed state
      const installed = await chartPackService.getInstalledPackIds(firestoreId);
      setInstalledPackIds(installed);
      const predDownloaded = await arePredictionsDownloaded(firestoreId);
      setPredictionsDownloaded(predDownloaded);
      const buoysDl = await areBuoysDownloaded(firestoreId);
      setBuoysDownloaded(buoysDl);
      const marineZonesDl = await areMarineZonesDownloaded(firestoreId);
      setMarineZonesDownloaded(marineZonesDl);

      // Register this district in the region registry
      const { registerDistrict } = await import('../services/regionRegistryService');
      await registerDistrict(firestoreId, {
        hasCharts: installed.includes('charts') || installed.some(id => id.startsWith('charts-')),
        hasPredictions: predDownloaded,
        hasBuoys: buoysDl,
        hasMarineZones: marineZonesDl,
        hasSatellite: installed.some(id => id.startsWith('satellite-')),
        hasBasemap: installed.includes('basemap'),
        hasGnis: installed.includes('gnis'),
        hasOcean: installed.some(id => id === 'ocean' || id.startsWith('ocean-') || id.includes('_ocean')),
        hasTerrain: installed.some(id => id === 'terrain' || id.startsWith('terrain-') || id.includes('_terrain')),
      });

      Alert.alert('Complete', 'All data downloaded successfully.');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Download failed');
    } finally {
      setDownloadingAll(false);
      setCurrentDownloadItem('');
      setPackDownloadStatus(null);
    }
  };

  const handleDownloadCategory = async (category: DownloadCategory) => {
    if (downloadingAll || packDownloadStatus || downloadingPredictions || downloadingBuoys) {
      Alert.alert('Download in Progress', 'Please wait for the current download to complete.');
      return;
    }

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      Alert.alert('No Internet', 'Please check your connection and try again.');
      return;
    }

    if (category.id === 'predictions') {
      handleDownloadPredictions();
      return;
    }

    if (category.id === 'buoys') {
      handleDownloadBuoys();
      return;
    }

    if (category.id === 'marine-zones') {
      handleDownloadMarineZones();
      return;
    }

    const sizeMB = category.sizeBytes / 1024 / 1024;
    Alert.alert(
      'Download',
      `Download ${category.label}?\n\nSize: ~${sizeMB >= 1024 ? `${(sizeMB / 1024).toFixed(1)} GB` : `${sizeMB.toFixed(0)} MB`}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Download',
          onPress: async () => {
            for (const pack of category.packs) {
              if (installedPackIds.includes(pack.id)) continue;
              setCurrentDownloadItem(pack.name);
              const success = await chartPackService.downloadPack(
                pack,
                firestoreId,
                (status) => setPackDownloadStatus(status)
              );
              if (success) {
                setInstalledPackIds(prev => [...prev, pack.id]);
              }
              setPackDownloadStatus(null);
            }
            setCurrentDownloadItem('');
            const installed = await chartPackService.getInstalledPackIds(firestoreId);
            setInstalledPackIds(installed);
            // Register/update district in region registry
            const { registerDistrict } = await import('../services/regionRegistryService');
            await registerDistrict(firestoreId, {
              hasCharts: installed.includes('charts') || installed.some(id => id.startsWith('charts-')),
              hasSatellite: installed.some(id => id.startsWith('satellite-')),
              hasBasemap: installed.includes('basemap'),
              hasGnis: installed.includes('gnis'),
              hasOcean: installed.some(id => id === 'ocean' || id.startsWith('ocean-') || id.includes('_ocean')),
              hasTerrain: installed.some(id => id === 'terrain' || id.startsWith('terrain-') || id.includes('_terrain')),
            });
          },
        },
      ]
    );
  };

  const handleDownloadPredictions = async () => {
    try {
      const metadata = await getPredictionDatabaseMetadata(firestoreId);
      Alert.alert(
        'Download Predictions',
        `Download tide and current predictions?\n\n` +
        `Tides: ${(metadata.tidesSize / 1024 / 1024).toFixed(1)} MB\n` +
        `Currents: ${(metadata.currentsSize / 1024 / 1024).toFixed(1)} MB\n` +
        `Total: ${metadata.totalSizeMB.toFixed(1)} MB`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Download',
            onPress: async () => {
              setDownloadingPredictions(true);
              setPredictionsPercent(0);
              setPredictionsMessage('');
              try {
                const result = await downloadAllPredictions((message, percent) => {
                  setPredictionsPercent(percent);
                  setPredictionsMessage(message);
                }, firestoreId);
                if (result.success) {
                  setPredictionsDownloaded(true);
                  const { registerDistrict } = await import('../services/regionRegistryService');
                  await registerDistrict(firestoreId, { hasPredictions: true });
                  Alert.alert('Complete', 'Predictions downloaded successfully.');
                } else {
                  Alert.alert('Error', result.error || 'Download failed');
                }
              } catch (error: any) {
                Alert.alert('Error', error.message || 'Download failed');
              } finally {
                setDownloadingPredictions(false);
                setPredictionsPercent(0);
                setPredictionsMessage('');
              }
            },
          },
        ]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Could not get download info');
    }
  };

  const handleDownloadBuoys = async () => {
    Alert.alert(
      'Download Live Buoys',
      'Download buoy station locations and latest observations for offline use?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Download',
          onPress: async () => {
            setDownloadingBuoys(true);
            setBuoysPercent(0);
            setBuoysMessage('');
            try {
              const result = await downloadBuoyCatalog(firestoreId, (message, percent) => {
                setBuoysPercent(percent);
                setBuoysMessage(message);
              });
              if (result.success) {
                setBuoysDownloaded(true);
                const { registerDistrict } = await import('../services/regionRegistryService');
                await registerDistrict(firestoreId, { hasBuoys: true });
                Alert.alert('Complete', `${result.stationCount} buoy stations cached.`);
              } else {
                Alert.alert('Error', result.error || 'Download failed');
              }
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Download failed');
            } finally {
              setDownloadingBuoys(false);
              setBuoysPercent(0);
              setBuoysMessage('');
            }
          },
        },
      ]
    );
  };

  const handleDownloadMarineZones = async () => {
    Alert.alert(
      'Download Marine Zone Boundaries',
      'Download weather forecast zone boundaries for offline display?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Download',
          onPress: async () => {
            setDownloadingMarineZones(true);
            setMarineZonesPercent(0);
            setMarineZonesMessage('');
            try {
              const result = await downloadMarineZones(firestoreId, (message, percent) => {
                setMarineZonesPercent(percent);
                setMarineZonesMessage(message);
              });
              if (result.success) {
                setMarineZonesDownloaded(true);
                const { registerDistrict } = await import('../services/regionRegistryService');
                await registerDistrict(firestoreId, { hasMarineZones: true });
                Alert.alert('Complete', `${result.zoneCount} marine zone boundaries cached.`);
              } else {
                Alert.alert('Error', result.error || 'Download failed');
              }
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Download failed');
            } finally {
              setDownloadingMarineZones(false);
              setMarineZonesPercent(0);
              setMarineZonesMessage('');
            }
          },
        },
      ]
    );
  };

  const handleDeleteCategory = async (category: DownloadCategory) => {
    if (category.id === 'predictions') {
      Alert.alert(
        'Delete Predictions',
        'Delete all tide and current prediction data?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await clearPredictions(firestoreId);
                setPredictionsDownloaded(false);
              } catch (error: any) {
                Alert.alert('Error', error.message || 'Delete failed');
              }
            },
          },
        ]
      );
      return;
    }

    if (category.id === 'buoys') {
      Alert.alert(
        'Delete Live Buoys',
        'Delete cached buoy data?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await clearBuoys(firestoreId);
                setBuoysDownloaded(false);
              } catch (error: any) {
                Alert.alert('Error', error.message || 'Delete failed');
              }
            },
          },
        ]
      );
      return;
    }

    if (category.id === 'marine-zones') {
      Alert.alert(
        'Delete Marine Zone Boundaries',
        'Delete cached marine zone boundaries?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await clearMarineZones(firestoreId);
                setMarineZonesDownloaded(false);
              } catch (error: any) {
                Alert.alert('Error', error.message || 'Delete failed');
              }
            },
          },
        ]
      );
      return;
    }

    Alert.alert(
      'Delete',
      `Delete ${category.label}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            for (const pack of category.packs) {
              await chartPackService.deletePack(pack, firestoreId);
            }
            const installed = await chartPackService.getInstalledPackIds(firestoreId);
            setInstalledPackIds(installed);
          },
        },
      ]
    );
  };

  // ============================================
  // Delete Entire Region
  // ============================================

  const handleDeleteRegion = () => {
    const regionName = region?.name || 'this region';
    Alert.alert(
      'Delete Region',
      `Delete all downloaded data for ${regionName}?\n\nThis includes charts, predictions, buoys, satellite imagery, and all other data for this region.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            try {
              const { getInstalledDistrictIds, unregisterDistrict } = await import('../services/regionRegistryService');
              
              // Get other installed districts (for GNIS cleanup check)
              const allDistrictIds = await getInstalledDistrictIds();
              const otherDistrictIds = allDistrictIds.filter(id => id !== firestoreId);
              
              // Delete all region files
              const result = await chartPackService.deleteRegion(firestoreId, otherDistrictIds);
              
              // Clear buoy data
              await clearBuoys(firestoreId);
              
              // Clear marine zone boundaries
              await clearMarineZones(firestoreId);
              
              // Unregister from the region registry
              await unregisterDistrict(firestoreId);
              
              // Reset local state
              setInstalledPackIds([]);
              setPredictionsDownloaded(false);
              setBuoysDownloaded(false);
              setMarineZonesDownloaded(false);
              
              const freedMB = result.freedBytes / 1024 / 1024;
              Alert.alert(
                'Region Deleted',
                `Deleted ${result.deletedFiles} files and freed ${freedMB >= 1024 ? `${(freedMB / 1024).toFixed(1)} GB` : `${freedMB.toFixed(0)} MB`} of storage.`,
                [{ text: 'OK', onPress: () => onBack() }]
              );
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Delete failed');
            }
          },
        },
      ]
    );
  };

  // ============================================
  // Render
  // ============================================

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4FC3F7" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (!districtData && region?.status === 'pending') {
    return (
      <View style={styles.loadingContainer}>
        <Ionicons name="construct-outline" size={48} color="rgba(255,255,255,0.3)" />
        <Text style={styles.comingSoonTitle}>Coming Soon</Text>
        <Text style={styles.comingSoonText}>
          Charts for {region.name} are not yet available.{'\n'}
          Check back for updates.
        </Text>
      </View>
    );
  }

  const regionName = region?.name || 'Region';
  const isDownloading = downloadingAll || !!packDownloadStatus || downloadingPredictions || downloadingBuoys || downloadingMarineZones;

  return (
    <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
      {/* Region header */}
      <View style={styles.regionHeader}>
        <Text style={styles.regionName}>{regionName}</Text>
        
        {/* Required downloads summary */}
        <Text style={styles.regionSummary}>
          Required ({requiredCategories.length} items • {(requiredSizeBytes / 1024 / 1024 / 1024).toFixed(1)} GB)
        </Text>
        <Text style={styles.regionDetailsSummary}>
          {requiredCategories.map(cat => {
            const size = formatCategorySize(cat);
            // Simplify label for compact display
            const label = cat.id === 'charts' ? 'Charts' :
                         cat.id === 'predictions' ? '' : // Special handling - size includes both
                         cat.id === 'gnis' ? 'GNIS' :
                         cat.id === 'buoys' ? 'Buoys' :
                         cat.id === 'marine-zones' ? 'Zones' :
                         cat.label;
            return label ? `${label}: ${size}` : size;
          }).join(' • ')}
        </Text>
        
        {/* Optional downloads summary */}
        {optionalCategories.length > 0 && (
          <Text style={styles.regionOptionalSummary}>
            Optional: {optionalCategories.map(c => c.label).join(', ')} ({(optionalSizeBytes / 1024 / 1024 / 1024).toFixed(1)} GB)
          </Text>
        )}
      </View>

      {/* Resume incomplete downloads banner */}
      {hasIncompleteDownloads && !downloadingAll && (
        <View style={styles.resumeBanner}>
          <Ionicons name="pause-circle" size={24} color="#FFA726" />
          <View style={styles.resumeBannerText}>
            <Text style={styles.resumeBannerTitle}>Incomplete Downloads</Text>
            <Text style={styles.resumeBannerSubtitle}>You have paused downloads</Text>
          </View>
          <TouchableOpacity
            style={styles.resumeBannerButton}
            onPress={handleResumeDownloads}
          >
            <Text style={styles.resumeBannerButtonText}>Resume</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Category items */}
      {categories.map(category => {
        const isThisDownloading =
          (category.id === 'predictions' && downloadingPredictions) ||
          (category.id === 'buoys' && downloadingBuoys) ||
          (category.id === 'marine-zones' && downloadingMarineZones) ||
          (category.packs.some(p => packDownloadStatus?.packId === p.id));
        const sizeMB = category.sizeBytes / 1024 / 1024;

        return (
          <View key={category.id} style={styles.categoryItem}>
            <View style={styles.categoryLeft}>
              <View style={styles.categoryIconContainer}>
                <Ionicons name={category.icon} size={20} color="#4FC3F7" />
              </View>
              <View style={styles.categoryInfo}>
                <Text style={styles.categoryLabel}>{category.label}</Text>
                <View style={styles.categorySizeRow}>
                  <Text style={styles.categorySize}>
                    {sizeMB >= 1024
                      ? `${(sizeMB / 1024).toFixed(1)} GB`
                      : `${sizeMB.toFixed(0)} MB`}
                  </Text>
                  {category.required && (
                    <Text style={styles.categoryRequired}>Required</Text>
                  )}
                </View>
                {/* Download speed info */}
                {isThisDownloading && packDownloadStatus?.speedBps && (
                  <Text style={styles.speedText}>
                    {formatSpeed(packDownloadStatus.speedBps)}
                    {packDownloadStatus.etaSeconds
                      ? ` | ${formatEta(packDownloadStatus.etaSeconds)}`
                      : ''}
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.categoryActions}>
              {isThisDownloading ? (
                <View style={styles.progressContainer}>
                  <ActivityIndicator size="small" color="#4FC3F7" />
                  <View style={styles.progressInfo}>
                    <Text style={styles.progressText}>
                      {category.id === 'predictions'
                        ? `${predictionsPercent}%`
                        : category.id === 'buoys'
                        ? `${buoysPercent}%`
                        : category.id === 'marine-zones'
                        ? `${marineZonesPercent}%`
                        : `${packDownloadStatus?.progress || 0}%`}
                    </Text>
                    {/* Show status message */}
                    {category.id === 'predictions' && predictionsMessage ? (
                      <Text style={styles.statusText}>{predictionsMessage}</Text>
                    ) : category.id === 'buoys' && buoysMessage ? (
                      <Text style={styles.statusText}>{buoysMessage}</Text>
                    ) : category.id === 'marine-zones' && marineZonesMessage ? (
                      <Text style={styles.statusText}>{marineZonesMessage}</Text>
                    ) : packDownloadStatus?.status ? (
                      <Text style={styles.statusText}>
                        {packDownloadStatus.status === 'downloading'
                          ? 'Downloading...'
                          : packDownloadStatus.status === 'extracting'
                          ? 'Extracting...'
                          : packDownloadStatus.status === 'completed'
                          ? 'Complete'
                          : ''}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ) : category.installed ? (
                <>
                  <Ionicons name="checkmark-circle" size={20} color="#51cf66" />
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleDeleteCategory(category)}
                  >
                    <Ionicons name="trash-outline" size={18} color="#ff6b6b" />
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => handleDownloadCategory(category)}
                  disabled={isDownloading}
                >
                  <Ionicons
                    name="download-outline"
                    size={20}
                    color={isDownloading ? 'rgba(255,255,255,0.2)' : '#4FC3F7'}
                  />
                </TouchableOpacity>
              )}
            </View>
          </View>
        );
      })}

      {/* Satellite resolution selector */}
      {categories.some(c => c.id === 'satellite') && (
        <View style={styles.satelliteSection}>
          <Text style={styles.satelliteSectionTitle}>SATELLITE RESOLUTION</Text>
          <View style={styles.satelliteOptions}>
            {SATELLITE_OPTIONS.map(option => (
              <TouchableOpacity
                key={option.resolution}
                style={[
                  styles.satelliteOption,
                  satelliteResolution === option.resolution && styles.satelliteOptionSelected,
                ]}
                onPress={() => setSatelliteResolution(option.resolution)}
              >
                <View style={styles.satelliteRadio}>
                  {satelliteResolution === option.resolution && (
                    <View style={styles.satelliteRadioFill} />
                  )}
                </View>
                <View style={styles.satelliteOptionInfo}>
                  <Text style={[
                    styles.satelliteOptionLabel,
                    satelliteResolution === option.resolution && styles.satelliteOptionLabelSelected,
                  ]}>
                    {option.label}
                  </Text>
                  <Text style={styles.satelliteOptionZoom}>{option.zoomLevels}</Text>
                </View>
                <Text style={styles.satelliteOptionSize}>
                  ~{option.estimatedSizeMB >= 1024
                    ? `${(option.estimatedSizeMB / 1024).toFixed(1)} GB`
                    : `${option.estimatedSizeMB} MB`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Total & download button */}
      <View style={styles.totalSection}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total Download</Text>
          <Text style={styles.totalSize}>
            ~{(totalSizeBytes / 1024 / 1024) >= 1024
              ? `${(totalSizeBytes / 1024 / 1024 / 1024).toFixed(1)} GB`
              : `${(totalSizeBytes / 1024 / 1024).toFixed(0)} MB`}
          </Text>
        </View>

        {allInstalled ? (
          <View style={styles.allInstalledBanner}>
            <Ionicons name="checkmark-circle" size={24} color="#51cf66" />
            <Text style={styles.allInstalledText}>All data installed</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.downloadAllButton, isDownloading && styles.downloadAllButtonDisabled]}
            onPress={handleDownloadAll}
            disabled={isDownloading}
          >
            {isDownloading ? (
              <>
                <ActivityIndicator size="small" color="#ffffff" />
                <View style={styles.downloadAllTextContainer}>
                  <Text style={styles.downloadAllText}>
                    {currentDownloadItem || 'Downloading...'}
                  </Text>
                  {packDownloadStatus?.status && (
                    <Text style={styles.downloadAllStatus}>
                      {packDownloadStatus.status === 'downloading'
                        ? `Downloading ${packDownloadStatus.progress}%`
                        : packDownloadStatus.status === 'extracting'
                        ? `Extracting ${packDownloadStatus.progress}%`
                        : packDownloadStatus.status}
                    </Text>
                  )}
                </View>
              </>
            ) : (
              <>
                <Ionicons name="download" size={20} color="#ffffff" />
                <Text style={styles.downloadAllText}>Download All</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Progress bar during downloads */}
      {isDownloading && (
        <View style={styles.downloadProgressBar}>
          <View
            style={[
              styles.downloadProgressFill,
              {
                width: `${downloadingPredictions
                  ? predictionsPercent
                  : (packDownloadStatus?.progress || 0)}%`,
              },
            ]}
          />
        </View>
      )}

      {/* Delete Entire Region button - shown when any data is installed */}
      {categories.some(c => c.installed) && !isDownloading && (
        <View style={styles.deleteRegionSection}>
          <TouchableOpacity
            style={styles.deleteRegionButton}
            onPress={handleDeleteRegion}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={18} color="#ff6b6b" />
            <Text style={styles.deleteRegionText}>Delete Entire Region</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={{ height: 30 }} />
    </ScrollView>
  );
}

// ============================================
// Styles
// ============================================

const styles = StyleSheet.create({
  scrollContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
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
  comingSoonTitle: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  comingSoonText: {
    marginTop: 8,
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
    lineHeight: 20,
  },

  // Region header
  regionHeader: {
    marginBottom: 16,
  },
  regionName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
  },
  regionSummary: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 4,
  },
  regionDetailsSummary: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 2,
    lineHeight: 16,
  },
  regionOptionalSummary: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.4)',
    marginTop: 4,
  },

  // Category items
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  categoryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  categoryIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(79, 195, 247, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  categoryInfo: {
    flex: 1,
  },
  categoryLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#ffffff',
  },
  categorySizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  categorySize: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  categoryRequired: {
    fontSize: 10,
    color: '#4FC3F7',
    fontWeight: '600',
    marginLeft: 8,
    backgroundColor: 'rgba(79, 195, 247, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  speedText: {
    fontSize: 11,
    color: '#4FC3F7',
    marginTop: 2,
  },
  categoryActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionButton: {
    padding: 6,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressInfo: {
    flexDirection: 'column',
  },
  progressText: {
    fontSize: 12,
    color: '#4FC3F7',
    fontWeight: '600',
  },
  statusText: {
    fontSize: 10,
    color: 'rgba(79, 195, 247, 0.7)',
    marginTop: 1,
  },

  // Satellite resolution
  satelliteSection: {
    marginTop: 8,
    marginBottom: 8,
  },
  satelliteSectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.4)',
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 4,
  },
  satelliteOptions: {
    gap: 6,
  },
  satelliteOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  satelliteOptionSelected: {
    backgroundColor: 'rgba(79, 195, 247, 0.08)',
    borderColor: 'rgba(79, 195, 247, 0.25)',
  },
  satelliteRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  satelliteRadioFill: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4FC3F7',
  },
  satelliteOptionInfo: {
    flex: 1,
  },
  satelliteOptionLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: '500',
  },
  satelliteOptionLabelSelected: {
    color: '#ffffff',
  },
  satelliteOptionZoom: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.4)',
    marginTop: 1,
  },
  satelliteOptionSize: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '500',
  },

  // Total & download
  totalSection: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: 14,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  totalSize: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  downloadAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4FC3F7',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  downloadAllButtonDisabled: {
    backgroundColor: 'rgba(79, 195, 247, 0.4)',
  },
  downloadAllTextContainer: {
    flexDirection: 'column',
    alignItems: 'center',
  },
  downloadAllText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  downloadAllStatus: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 2,
  },
  allInstalledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(81, 207, 102, 0.1)',
    borderRadius: 12,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(81, 207, 102, 0.2)',
  },
  allInstalledText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#51cf66',
  },
  downloadProgressBar: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 2,
    marginTop: 12,
    overflow: 'hidden',
  },
  downloadProgressFill: {
    height: '100%',
    backgroundColor: '#4FC3F7',
    borderRadius: 2,
  },

  // Delete Entire Region
  deleteRegionSection: {
    marginTop: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingTop: 16,
    alignItems: 'center',
  },
  deleteRegionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.3)',
    backgroundColor: 'rgba(255, 107, 107, 0.08)',
  },
  deleteRegionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ff6b6b',
  },

  // Resume banner
  resumeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 167, 38, 0.1)',
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 167, 38, 0.3)',
    gap: 12,
  },
  resumeBannerText: {
    flex: 1,
  },
  resumeBannerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFA726',
    marginBottom: 2,
  },
  resumeBannerSubtitle: {
    fontSize: 12,
    color: 'rgba(255, 167, 38, 0.7)',
  },
  resumeBannerButton: {
    backgroundColor: '#FFA726',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  resumeBannerButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0a0e1a',
  },
});

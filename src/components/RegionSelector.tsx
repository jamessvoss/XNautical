/**
 * RegionSelector
 *
 * Map-based region selector for downloading chart data.
 * Shows 9 NOAA regions as pill chips and a satellite resolution picker.
 * When a region is selected, displays its US1 chart bounding boxes on the map
 * and shows an info overlay in the upper-left corner.
 * A resolution picker floats on the upper-right of the map.
 *
 * Download is enabled only when both a region and a resolution are selected.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Dimensions,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system/legacy';
import MapLibre from '@maplibre/maplibre-react-native';
import {
  REGIONS,
  Region,
  SATELLITE_OPTIONS,
  SatelliteResolution,
  getRegionBBox,
} from '../config/regionData';
import * as chartPackService from '../services/chartPackService';
import { getInstalledDistricts, type InstalledDistrictRecord } from '../services/regionRegistryService';
import type { District } from '../types/chartPack';
import DownloadPanel from './DownloadPanel';

// ============================================
// Types
// ============================================

type SelectorState = 'selecting' | 'downloading';

interface Props {
  visible: boolean;
  onClose: () => void;
}

// ============================================
// Constants
// ============================================

const US_OVERVIEW_BOUNDS = {
  ne: [-50, 72],
  sw: [-180, 17],
};

const OPTIONAL_MAP_OPTIONS = [
  { id: 'basemap', label: 'Basemap', description: 'Light/Dark/Street/ECDIS', estimatedSizeMB: 724 },
  { id: 'ocean', label: 'Ocean Map', description: 'ESRI Ocean Basemap', estimatedSizeMB: 400 },
  { id: 'terrain', label: 'Terrain Map', description: 'OpenTopoMap', estimatedSizeMB: 500 },
];

// ============================================
// Component
// ============================================

export default function RegionSelector({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<SelectorState>('selecting');
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [selectedResolution, setSelectedResolution] = useState<SatelliteResolution>('none');
  const [selectedOptionalMaps, setSelectedOptionalMaps] = useState<Set<string>>(new Set());
  const cameraRef = useRef<any>(null);

  // Track which districts are installed on device
  const [installedDistricts, setInstalledDistricts] = useState<InstalledDistrictRecord[]>([]);
  
  // Track loaded district metadata for selected region
  const [districtData, setDistrictData] = useState<District | null>(null);
  
  // Track device storage info
  const [storageInfo, setStorageInfo] = useState<{
    totalGB: number;
    usedGB: number;
    availableGB: number;
  } | null>(null);
  
  // Track download confirmation modal
  const [showDownloadConfirm, setShowDownloadConfirm] = useState(false);
  const [downloadInfo, setDownloadInfo] = useState<{
    downloadSizeGB: string;
    deviceSizeGB: string;
    isWifi: boolean;
    isConnected: boolean;
  } | null>(null);
  
  // Load installed districts when modal opens
  useEffect(() => {
    if (visible) {
      getInstalledDistricts().then(setInstalledDistricts).catch(() => {});
    }
  }, [visible, state]);
  
  // Load device storage info
  useEffect(() => {
    const fetchStorageInfo = async () => {
      try {
        console.log('[RegionSelector] Fetching storage info...');
        const [freeSpace, totalSpace] = await Promise.all([
          FileSystem.getFreeDiskStorageAsync(),
          FileSystem.getTotalDiskCapacityAsync(),
        ]);
        
        console.log('[RegionSelector] Storage raw values:', { freeSpace, totalSpace });
        
        const totalGB = totalSpace / 1024 / 1024 / 1024;
        const availableGB = freeSpace / 1024 / 1024 / 1024;
        const usedGB = totalGB - availableGB;
        
        console.log('[RegionSelector] Storage calculated:', { totalGB, usedGB, availableGB });
        setStorageInfo({ totalGB, usedGB, availableGB });
      } catch (error) {
        console.error('[RegionSelector] Error fetching storage info:', error);
      }
    };
    
    if (visible) {
      fetchStorageInfo();
    }
  }, [visible]);

  const selectedRegion = useMemo(
    () => REGIONS.find(r => r.id === selectedRegionId) || null,
    [selectedRegionId]
  );

  const selectedSatOption = useMemo(
    () => SATELLITE_OPTIONS.find(o => o.resolution === selectedResolution) || null,
    [selectedResolution]
  );

  // Check if a region's district is installed
  const isRegionInstalled = useCallback((region: Region) => {
    return installedDistricts.some(d => d.districtId === region.firestoreId);
  }, [installedDistricts]);

  // Can download when region is ready (satellite is optional now)
  const canDownload = !!(selectedRegion && selectedRegion.status === 'converted');

  // Region boundary (fetched dynamically from Firestore, computed from all chart scales)
  const [regionBoundary, setRegionBoundary] = useState<
    { west: number; south: number; east: number; north: number } | null
  >(null);

  // Fetch district data (including regionBoundary) when a region is selected
  useEffect(() => {
    if (!selectedRegion) {
      setRegionBoundary(null);
      setDistrictData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const district = await chartPackService.getDistrict(selectedRegion.firestoreId);
        if (!cancelled) {
          setDistrictData(district);
          
          // Priority 1: Use Firestore regionBoundary if available
          if (district?.regionBoundary) {
            console.log(`[RegionSelector] Using Firestore regionBoundary for ${selectedRegion.id}:`, district.regionBoundary);
            setRegionBoundary(district.regionBoundary);
          } 
          // Priority 2: Compute from US1 chart bounds (with antimeridian filtering)
          else if (district?.us1ChartBounds && district.us1ChartBounds.length > 0) {
            const usableCharts = district.us1ChartBounds.filter((b: any) => b.west < 0 && b.east < 0);
            
            if (usableCharts.length > 0) {
              let w = 180, s = 90, e = -180, n = -90;
              for (const b of usableCharts) {
                if (b.west < w) w = b.west;
                if (b.south < s) s = b.south;
                if (b.east > e) e = b.east;
                if (b.north > n) n = b.north;
              }
              console.log(`[RegionSelector] Computed boundary for ${selectedRegion.id} from ${usableCharts.length} western-hemisphere charts:`, { west: w, south: s, east: e, north: n });
              setRegionBoundary({ west: w, south: s, east: e, north: n });
            } else {
              // All charts cross antimeridian - use static mapBounds
              const [west, south, east, north] = selectedRegion.mapBounds;
              console.log(`[RegionSelector] No usable charts for ${selectedRegion.id}, using static mapBounds:`, { west, south, east, north });
              setRegionBoundary({ west, south, east, north });
            }
          } 
          // Priority 3: Always fall back to static mapBounds
          else {
            const [west, south, east, north] = selectedRegion.mapBounds;
            console.log(`[RegionSelector] No district data for ${selectedRegion.id}, using static mapBounds:`, { west, south, east, north });
            setRegionBoundary({ west, south, east, north });
          }
        }
      } catch (error) {
        // On error, fall back to static bounds
        console.error('[RegionSelector] Error loading district:', error);
        if (!cancelled) {
          const [west, south, east, north] = selectedRegion.mapBounds;
          console.log(`[RegionSelector] Error fallback for ${selectedRegion.id}, using static mapBounds:`, { west, south, east, north });
          setRegionBoundary({ west, south, east, north });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedRegion]);

  // Fly to region AFTER boundary data is loaded
  useEffect(() => {
    console.log('[RegionSelector] Camera useEffect triggered - selectedRegionId:', selectedRegionId, 'regionBoundary:', regionBoundary);
    if (selectedRegionId && regionBoundary) {
      console.log(`[RegionSelector] Flying to region ${selectedRegionId} with bounds:`, regionBoundary);
      
      const { west, south, east, north } = regionBoundary;
      
      // Calculate extents of the boundary
      const lngExtent = east - west;
      const latExtent = north - south;
      
      // Add 25% buffer on each side
      const lngBuf = lngExtent * 0.25;
      const latBuf = latExtent * 0.25;
      
      const ne = [Math.min(east + lngBuf, 180), Math.min(north + latBuf, 90)];
      const sw = [Math.max(west - lngBuf, -180), Math.max(south - latBuf, -90)];
      
      console.log(`[RegionSelector] Calling fitBounds with NE:`, ne, 'SW:', sw);
      
      // Apply buffer to create zoomed out view
      cameraRef.current?.fitBounds(
        ne,
        sw,
        [40, 40, 40, 40],  // Minimal padding since buffer handles zoom
        1200
      );
    } else {
      console.log('[RegionSelector] NOT flying - missing:', selectedRegionId ? 'regionBoundary' : 'selectedRegionId');
    }
  }, [selectedRegionId, regionBoundary]);

  // Resolved boundary: regionBoundary is always set by the useEffect above
  // (either from Firestore, computed from charts, or fallback to static mapBounds)
  const resolvedBoundary = useMemo(() => {
    console.log('[RegionSelector] resolvedBoundary computed:', regionBoundary);
    return regionBoundary;
  }, [regionBoundary]);

  // GeoJSON for the selected region's coverage boundary (single rectangle)
  const regionGeoJSON = useMemo(() => {
    if (!selectedRegion || !resolvedBoundary) return null;
    const { west, south, east, north } = resolvedBoundary;
    return {
      type: 'FeatureCollection' as const,
      features: [{
        type: 'Feature' as const,
        properties: { regionId: selectedRegion.id, color: selectedRegion.color },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
          ]],
        },
      }],
    };
  }, [selectedRegion, resolvedBoundary]);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setState('selecting');
      setSelectedRegionId(null);
      setSelectedResolution('high');
      setSelectedOptionalMaps(new Set(['gnis']));
    }
  }, [visible]);

  // ============================================
  // Map camera control
  // ============================================

  const flyToOverview = useCallback(() => {
    cameraRef.current?.fitBounds(
      US_OVERVIEW_BOUNDS.ne,
      US_OVERVIEW_BOUNDS.sw,
      [40, 40, 40, 40],
      1200
    );
  }, []);

  const flyToRegion = useCallback((regionId: string) => {
    // Use resolvedBoundary if available (from Firestore)
    // Otherwise fall back to static bounds for the fallback case
    const boundary = resolvedBoundary || (() => {
      const region = REGIONS.find(r => r.id === regionId);
      if (region) {
        const [west, south, east, north] = region.mapBounds;
        return { west, south, east, north };
      }
      return null;
    })();
    
    if (boundary) {
      const { west, south, east, north } = boundary;
      
      console.log(`[RegionSelector] flyToRegion(${regionId}) called with boundary:`, boundary);
      
      // Calculate extents of the boundary
      const lngExtent = east - west;
      const latExtent = north - south;
      
      // Add 25% buffer on each side
      const lngBuf = lngExtent * 0.25;
      const latBuf = latExtent * 0.25;
      
      const ne = [Math.min(east + lngBuf, 180), Math.min(north + latBuf, 90)];
      const sw = [Math.max(west - lngBuf, -180), Math.max(south - latBuf, -90)];
      
      console.log(`[RegionSelector] Calling fitBounds with NE:`, ne, 'SW:', sw);
      
      // Apply buffer to create zoomed out view
      cameraRef.current?.fitBounds(
        ne,
        sw,
        [40, 40, 40, 40],  // Minimal padding since buffer handles zoom
        1200
      );
    } else {
      console.log(`[RegionSelector] flyToRegion(${regionId}) - no boundary available!`);
    }
  }, [resolvedBoundary]);

  // ============================================
  // Handlers
  // ============================================

  const handleRegionSelect = useCallback((regionId: string) => {
    if (selectedRegionId === regionId) {
      // Deselecting - clear state and fly to overview
      setSelectedRegionId(null);
      setRegionBoundary(null);
      setDistrictData(null);
      flyToOverview();
    } else {
      // Selecting new region - clear old state first
      setRegionBoundary(null);
      setDistrictData(null);
      setSelectedRegionId(regionId);
      // Camera will move after boundary loads (see useEffect below)
    }
  }, [selectedRegionId, flyToOverview]);

  const handleResolutionSelect = useCallback((res: SatelliteResolution) => {
    setSelectedResolution(res);
  }, []);

  const handleOptionalMapToggle = useCallback((mapId: string) => {
    setSelectedOptionalMaps(prev => {
      const next = new Set(prev);
      if (next.has(mapId)) next.delete(mapId);
      else next.add(mapId);
      return next;
    });
  }, []);

  const handleDownloadPress = useCallback(async () => {
    if (!canDownload || !districtData) return;
    
    try {
      // Calculate total download size (compressed)
      const chartPacks = districtData.downloadPacks?.filter(p => p.type === 'charts') || [];
      const gnisPack = districtData.downloadPacks?.find(p => p.type === 'gnis');
      let compressedBytes = chartPacks.reduce((sum, p) => sum + p.sizeBytes, 0);
      if (gnisPack) compressedBytes += gnisPack.sizeBytes;
      
      // Add predictions (compressed size from metadata)
      if (districtData.metadata?.predictionSizes) {
        compressedBytes += (districtData.metadata.predictionSizes.tides || 0);
        compressedBytes += (districtData.metadata.predictionSizes.currents || 0);
      }
      
      // Add selected satellite packs
      if (selectedResolution !== 'none' && districtData.downloadPacks) {
        let maxZoom = 8;
        if (selectedResolution === 'medium') maxZoom = 11;
        if (selectedResolution === 'high') maxZoom = 12;
        if (selectedResolution === 'ultra') maxZoom = 14;
        
        const satPacks = districtData.downloadPacks.filter(p => {
          if (p.type !== 'satellite') return false;
          
          // Match patterns like: satellite-z0-5, satellite_z0-5, satellite-z8, satellite_z14
          const zoomMatch = p.id.match(/z(\d+)(?:[-_](\d+))?/);
          if (!zoomMatch) return false;
          
          const zStart = parseInt(zoomMatch[1]);
          const zEnd = zoomMatch[2] ? parseInt(zoomMatch[2]) : zStart;
          
          // Include if the zoom range overlaps with our max zoom
          // e.g., z0-5 (0-5), z6-7 (6-7), z8 (8), z9 (9), etc.
          return zStart <= maxZoom;
        });
        
        compressedBytes += satPacks.reduce((sum, p) => sum + p.sizeBytes, 0);
      }
      
      // Add selected optional maps
      if (districtData.downloadPacks) {
        selectedOptionalMaps.forEach(mapId => {
          const pack = districtData.downloadPacks.find(p => p.type === mapId);
          if (pack) compressedBytes += pack.sizeBytes;
        });
      }
      
      // Calculate both compressed (download) and decompressed (on-device) sizes
      const DECOMPRESSION_RATIO = 2.0;
      const downloadSizeGB = (compressedBytes / 1024 / 1024 / 1024).toFixed(2);
      const deviceSizeGB = (compressedBytes * DECOMPRESSION_RATIO / 1024 / 1024 / 1024).toFixed(2);
      
      // Check network connection
      const netInfo = await NetInfo.fetch();
      const isWifi = netInfo.type === 'wifi';
      const isConnected = netInfo.isConnected;
      
      // Store download info and show custom modal
      setDownloadInfo({ downloadSizeGB, deviceSizeGB, isWifi, isConnected: isConnected ?? false });
      setShowDownloadConfirm(true);
    } catch (error) {
      console.error('[RegionSelector] Error checking network:', error);
      Alert.alert('Error', 'Unable to check network status. Please try again.');
    }
  }, [canDownload, districtData, selectedResolution, selectedOptionalMaps]);
  
  const handleConfirmDownload = useCallback(() => {
    setShowDownloadConfirm(false);
    setDownloadInfo(null);
    setState('downloading');
  }, []);
  
  const handleCancelDownload = useCallback(() => {
    setShowDownloadConfirm(false);
    setDownloadInfo(null);
  }, []);

  const handleBackFromDownload = useCallback(() => {
    setState('selecting');
    if (selectedRegionId) {
      flyToRegion(selectedRegionId);
    }
  }, [selectedRegionId, flyToRegion]);

  // ============================================
  // Helpers
  // ============================================

  const formatSize = (mb: number) => {
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${Math.round(mb)} MB`;
  };

  // ============================================
  // Render: Header
  // ============================================

  const renderHeader = () => {
    const isDownloading = state === 'downloading';
    const title = isDownloading && selectedRegion
      ? selectedRegion.name
      : 'Select Region';

    return (
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        {isDownloading ? (
          <TouchableOpacity style={styles.headerButton} onPress={handleBackFromDownload}>
            <Ionicons name="chevron-back" size={24} color="#4FC3F7" />
            <Text style={styles.headerButtonText}>Back</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerButton} />
        )}
        <Text style={styles.headerTitle}>{title}</Text>
        <TouchableOpacity style={styles.headerButton} onPress={onClose}>
          <Text style={styles.headerDoneText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // ============================================
  // Render: Info overlay (upper-left of map)
  // ============================================

  const renderInfoOverlay = () => {
    if (!selectedRegion || state === 'downloading') return null;

    console.log(`[RegionSelector] renderInfoOverlay - districtData:`, districtData);
    console.log(`[RegionSelector] renderInfoOverlay - metadata:`, districtData?.metadata);
    console.log(`[RegionSelector] renderInfoOverlay - selectedResolution:`, selectedResolution);

    const isReady = selectedRegion.status === 'converted';
    
    // === REQUIRED ITEMS ===
    
    // 1. Charts (US1-US6)
    let chartsMB = selectedRegion.estimatedChartSizeMB; // Fallback
    if (districtData?.downloadPacks) {
      const chartPacks = districtData.downloadPacks.filter(p => p.type === 'charts');
      if (chartPacks.length > 0) {
        chartsMB = chartPacks.reduce((sum, p) => sum + p.sizeBytes, 0) / 1024 / 1024;
        console.log(`[RegionSelector] Charts: ${chartsMB.toFixed(1)} MB from ${chartPacks.length} packs`);
      }
    }
    
    // 2. GNIS Place Names
    let gnisMB = 60; // Fallback estimate
    if (districtData?.downloadPacks) {
      const gnisPack = districtData.downloadPacks.find(p => p.type === 'gnis');
      if (gnisPack) {
        gnisMB = gnisPack.sizeBytes / 1024 / 1024;
        console.log(`[RegionSelector] GNIS: ${gnisMB.toFixed(1)} MB`);
      }
    }
    
    // 3. Tides (uncompressed size estimate: compressed * 2)
    let tidesMB = 50; // Fallback estimate
    if (districtData?.metadata?.predictionSizeMB?.tides) {
      const compressedMB = districtData.metadata.predictionSizeMB.tides;
      tidesMB = compressedMB * 2; // Estimate uncompressed
      console.log(`[RegionSelector] Tides: ${tidesMB.toFixed(1)} MB (uncompressed from ${compressedMB} MB compressed)`);
    }
    
    // 4. Currents (uncompressed size estimate: compressed * 2)
    let currentsMB = 90; // Fallback estimate
    if (districtData?.metadata?.predictionSizeMB?.currents) {
      const compressedMB = districtData.metadata.predictionSizeMB.currents;
      currentsMB = compressedMB * 2; // Estimate uncompressed
      console.log(`[RegionSelector] Currents: ${currentsMB.toFixed(1)} MB (uncompressed from ${compressedMB} MB compressed)`);
    }
    
    // 5. Buoys metadata (rough estimate: count * 5KB)
    let buoysMB = 1; // Fallback estimate
    if (districtData?.metadata?.buoyCount) {
      buoysMB = (districtData.metadata.buoyCount * 5 * 1024) / 1024 / 1024;
      console.log(`[RegionSelector] Buoys: ${buoysMB.toFixed(1)} MB for ${districtData.metadata.buoyCount} buoys`);
    }
    
    // 6. Marine Zones metadata (rough estimate: count * 20KB)
    let marineZonesMB = 0.5; // Fallback estimate
    if (districtData?.metadata?.marineZoneCount) {
      marineZonesMB = (districtData.metadata.marineZoneCount * 20 * 1024) / 1024 / 1024;
      console.log(`[RegionSelector] Marine Zones: ${marineZonesMB.toFixed(1)} MB for ${districtData.metadata.marineZoneCount} zones`);
    }
    
    const requiredMB = chartsMB + gnisMB + tidesMB + currentsMB + buoysMB + marineZonesMB;
    
    // === OPTIONAL ITEMS ===
    
    // Satellite (filtered by resolution)
    let satMB = 0;
    if (selectedResolution !== 'none') {
      if (districtData?.downloadPacks) {
        // Use real data from Firebase Storage
        let maxZoom = 8; // low
        if (selectedResolution === 'medium') maxZoom = 11;
        if (selectedResolution === 'high') maxZoom = 12;
        if (selectedResolution === 'ultra') maxZoom = 14;
        
        console.log(`[RegionSelector] Filtering satellite packs for ${selectedResolution} (z0-${maxZoom})`);
        
        const satPacks = districtData.downloadPacks.filter(p => {
          if (p.type !== 'satellite') return false;
          const zoomMatch = p.id.match(/z(\d+)(?:[-_](\d+))?/);
          if (!zoomMatch) return false;
          const zStart = parseInt(zoomMatch[1]);
          const zEnd = zoomMatch[2] ? parseInt(zoomMatch[2]) : zStart;
          return zStart <= maxZoom;
        });
        
        if (satPacks.length > 0) {
          satMB = satPacks.reduce((sum, p) => sum + p.sizeBytes, 0) / 1024 / 1024;
          console.log(`[RegionSelector] Satellite: ${satMB.toFixed(1)} MB from ${satPacks.length} packs`);
        }
      } else {
        // Fall back to estimates for pending regions
        const satOption = SATELLITE_OPTIONS.find(o => o.resolution === selectedResolution);
        if (satOption) {
          satMB = satOption.estimatedSizeMB;
          console.log(`[RegionSelector] Satellite (estimate): ${satMB.toFixed(1)} MB for ${selectedResolution}`);
        }
      }
    }
    
    // Other optional maps (using real data from downloadPacks)
    let optionalMapsMB = 0;
    if (districtData?.downloadPacks) {
      OPTIONAL_MAP_OPTIONS.filter(opt => selectedOptionalMaps.has(opt.id)).forEach(opt => {
        const pack = districtData.downloadPacks.find(p => p.type === opt.id);
        if (pack) {
          const sizeMB = pack.sizeBytes / 1024 / 1024;
          optionalMapsMB += sizeMB;
          console.log(`[RegionSelector] Optional map ${opt.label}: ${sizeMB.toFixed(1)} MB (real data)`);
        } else {
          optionalMapsMB += opt.estimatedSizeMB;
          console.log(`[RegionSelector] Optional map ${opt.label}: ${opt.estimatedSizeMB.toFixed(1)} MB (estimate - pack not found)`);
        }
      });
    } else {
      // Fallback to estimates if no downloadPacks data
      OPTIONAL_MAP_OPTIONS.filter(opt => selectedOptionalMaps.has(opt.id)).forEach(opt => {
        optionalMapsMB += opt.estimatedSizeMB;
        console.log(`[RegionSelector] Optional map ${opt.label}: ${opt.estimatedSizeMB.toFixed(1)} MB (estimate - no district data)`);
      });
    }
    
    const optionalMB = satMB + optionalMapsMB;
    const totalMB = requiredMB + optionalMB;
    
    console.log(`[RegionSelector] Total: Required=${requiredMB.toFixed(1)} Optional=${optionalMB.toFixed(1)} Total=${totalMB.toFixed(1)}`);
    console.log(`[RegionSelector] renderInfoOverlay - storageInfo:`, storageInfo);

    return (
      <View style={styles.infoOverlay} pointerEvents="none">
        <View style={[styles.infoColorBar, { backgroundColor: selectedRegion.color }]} />
        <View style={styles.infoContent}>
          <Text style={styles.infoRegionName}>{selectedRegion.name}</Text>
          <Text style={styles.infoDescription}>{selectedRegion.description}</Text>

          <View style={styles.infoDivider} />
          
          {/* REQUIRED SECTION */}
          <Text style={styles.infoSectionTitle}>Required</Text>
          
          <View style={styles.infoSizeRow}>
            <Text style={styles.infoSizeLabel}>Charts (US1-US6)</Text>
            <Text style={styles.infoSizeValue}>{formatSize(chartsMB)}</Text>
          </View>
          <View style={styles.infoSizeRow}>
            <Text style={styles.infoSizeLabel}>Place Names</Text>
            <Text style={styles.infoSizeValue}>{formatSize(gnisMB)}</Text>
          </View>
          <View style={styles.infoSizeRow}>
            <Text style={styles.infoSizeLabel}>Tide Predictions</Text>
            <Text style={styles.infoSizeValue}>{formatSize(tidesMB)}</Text>
          </View>
          <View style={styles.infoSizeRow}>
            <Text style={styles.infoSizeLabel}>Current Predictions</Text>
            <Text style={styles.infoSizeValue}>{formatSize(currentsMB)}</Text>
          </View>
          <View style={styles.infoSizeRow}>
            <Text style={styles.infoSizeLabel}>Buoy Metadata</Text>
            <Text style={styles.infoSizeValue}>{formatSize(buoysMB)}</Text>
          </View>
          <View style={styles.infoSizeRow}>
            <Text style={styles.infoSizeLabel}>Marine Zones</Text>
            <Text style={styles.infoSizeValue}>{formatSize(marineZonesMB)}</Text>
          </View>
          
          <View style={styles.infoDivider} />
          
          {/* OPTIONAL SECTION */}
          <Text style={styles.infoSectionTitle}>Optional</Text>
          
          <View style={styles.infoSizeRow}>
            <Text style={styles.infoSizeLabel}>Satellite ({selectedResolution === 'none' ? 'None' : SATELLITE_OPTIONS.find(o => o.resolution === selectedResolution)?.label})</Text>
            <Text style={styles.infoSizeValue}>{satMB > 0 ? formatSize(satMB) : '0 MB'}</Text>
          </View>
          {OPTIONAL_MAP_OPTIONS.filter(opt => selectedOptionalMaps.has(opt.id)).map(opt => {
            // Get real size from downloadPacks or fall back to estimate
            let optMapMB = opt.estimatedSizeMB;
            if (districtData?.downloadPacks) {
              const pack = districtData.downloadPacks.find(p => p.type === opt.id);
              if (pack) {
                optMapMB = pack.sizeBytes / 1024 / 1024;
                console.log(`[RegionSelector] ${opt.label}: ${optMapMB.toFixed(1)} MB (real data)`);
              } else {
                console.log(`[RegionSelector] ${opt.label}: ${optMapMB.toFixed(1)} MB (estimate - pack not found)`);
              }
            }
            
            return (
              <View key={opt.id} style={styles.infoSizeRow}>
                <Text style={styles.infoSizeLabel}>{opt.label}</Text>
                <Text style={styles.infoSizeValue}>{formatSize(optMapMB)}</Text>
              </View>
            );
          })}

          <View style={styles.infoDivider} />
          <View style={styles.infoSizeRow}>
            <Text style={styles.infoTotalLabel}>Total Download</Text>
            <Text style={styles.infoTotalValue}>{formatSize(totalMB)}</Text>
          </View>

          <View style={styles.infoDivider} />

          {/* Storage Info */}
          {storageInfo && (
            <View style={styles.infoStorageSection}>
              <Text style={styles.infoStorageLabel}>Device Storage</Text>
              <Text style={[
                styles.infoStorageValue,
                {
                  color: storageInfo.availableGB > 5 
                    ? '#2ecc71'  // Green: plenty of space
                    : storageInfo.availableGB > 1
                    ? '#f39c12'  // Yellow: cautious
                    : '#e74c3c'  // Red: low space
                }
              ]}>
                {storageInfo.availableGB.toFixed(1)} GB available
              </Text>
              <Text style={styles.infoStorageDetail}>
                {storageInfo.usedGB.toFixed(1)} GB used • {storageInfo.totalGB.toFixed(1)} GB total
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  // ============================================
  // Render: Combined optional downloads picker (upper-right of map)
  // ============================================

  const renderOptionalDownloadsPicker = () => {
    if (state === 'downloading' || !selectedRegion) return null;

    console.log('[RegionSelector] renderOptionalDownloadsPicker - districtData available?', !!districtData);
    console.log('[RegionSelector] renderOptionalDownloadsPicker - downloadPacks count:', districtData?.downloadPacks?.length || 0);

    // Calculate real satellite sizes for each resolution option
    const getSatelliteSizeForResolution = (resolution: SatelliteResolution): number => {
      if (resolution === 'none' || !districtData?.downloadPacks) {
        console.log(`[RegionSelector] Satellite ${resolution}: no data available, returning 0`);
        return 0;
      }
      
      let maxZoom = 8; // low
      if (resolution === 'medium') maxZoom = 11;
      if (resolution === 'high') maxZoom = 12;
      if (resolution === 'ultra') maxZoom = 14;
      
      const satPacks = districtData.downloadPacks.filter(p => {
        if (p.type !== 'satellite') return false;
        const zoomMatch = p.id.match(/z(\d+)(?:[-_](\d+))?/);
        if (!zoomMatch) return false;
        const zStart = parseInt(zoomMatch[1]);
        return zStart <= maxZoom;
      });
      
      if (satPacks.length === 0) {
        console.log(`[RegionSelector] Satellite ${resolution} (z0-${maxZoom}): no packs found`);
        return 0;
      }
      
      const sizeMB = satPacks.reduce((sum, p) => sum + p.sizeBytes, 0) / 1024 / 1024;
      console.log(`[RegionSelector] Satellite ${resolution} (z0-${maxZoom}): ${sizeMB.toFixed(1)} MB from ${satPacks.length} packs`);
      return sizeMB;
    };

    return (
      <View style={styles.optionalPicker}>
        {/* Title */}
        <Text style={styles.optionalPickerTitle}>Optional Maps</Text>
        
        {/* Satellite Section */}
        <Text style={styles.resPickerTitle}>SATELLITE</Text>
        {SATELLITE_OPTIONS.map(opt => {
          const isSelected = selectedResolution === opt.resolution;
          const realSizeMB = getSatelliteSizeForResolution(opt.resolution);
          const displaySize = realSizeMB > 0 ? realSizeMB : opt.estimatedSizeMB;
          
          return (
            <TouchableOpacity
              key={opt.resolution}
              style={[styles.resOption, isSelected && styles.resOptionSelected]}
              onPress={() => handleResolutionSelect(opt.resolution)}
              activeOpacity={0.7}
            >
              <Text style={[styles.resOptionLabel, isSelected && styles.resOptionLabelSelected]}>
                {opt.label}
              </Text>
              <Text style={styles.resOptionSize}>{formatSize(displaySize)}</Text>
            </TouchableOpacity>
          );
        })}
        
        {/* Separator */}
        <View style={styles.optionalPickerSeparator} />
        
        {/* Optional Maps Section */}
        {OPTIONAL_MAP_OPTIONS.map(opt => {
          const isSelected = selectedOptionalMaps.has(opt.id);
          
          // Get real size from downloadPacks or fall back to estimate
          let optMapMB = opt.estimatedSizeMB;
          if (districtData?.downloadPacks) {
            const pack = districtData.downloadPacks.find(p => p.type === opt.id);
            if (pack) {
              optMapMB = pack.sizeBytes / 1024 / 1024;
            }
          }
          
          return (
            <TouchableOpacity
              key={opt.id}
              style={[styles.resOption, isSelected && styles.resOptionSelected]}
              onPress={() => handleOptionalMapToggle(opt.id)}
              activeOpacity={0.7}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                <Ionicons
                  name={isSelected ? 'checkbox' : 'square-outline'}
                  size={16}
                  color={isSelected ? '#4FC3F7' : 'rgba(255,255,255,0.3)'}
                />
                <Text style={[styles.resOptionLabel, isSelected && styles.resOptionLabelSelected]}>
                  {opt.label}
                </Text>
              </View>
              <Text style={styles.resOptionSize}>{formatSize(optMapMB)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  // ============================================
  // Render: Bottom panel content
  // ============================================

  const renderRegionList = () => {
    const isRegionPending = selectedRegion && selectedRegion.status !== 'converted';
    const buttonDisabled = !canDownload;

    return (
      <View style={[styles.panelContent, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Text style={styles.panelSectionTitle}>NOAA REGIONS</Text>

        <View style={styles.chipGrid}>
          {REGIONS.map(region => {
            const isSelected = selectedRegionId === region.id;
            const installed = isRegionInstalled(region);

            return (
              <TouchableOpacity
                key={region.id}
                style={[
                  styles.chip,
                  installed && !isSelected && styles.chipInstalled,
                  isSelected && { backgroundColor: region.color, borderColor: region.color },
                ]}
                onPress={() => handleRegionSelect(region.id)}
                activeOpacity={0.7}
              >
                {installed && (
                  <Ionicons name="checkmark-circle" size={14} color={isSelected ? '#ffffff' : '#4CAF50'} style={{ marginRight: 4 }} />
                )}
                <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                  {region.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Download button - always visible */}
        <View style={styles.downloadSection}>
          {isRegionPending ? (
            <View style={styles.comingSoonButton}>
              <Ionicons name="construct-outline" size={18} color="rgba(255,255,255,0.3)" />
              <Text style={styles.comingSoonButtonText}>Coming Soon</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[
                styles.downloadButton,
                canDownload
                  ? { backgroundColor: selectedRegion!.color }
                  : styles.downloadButtonDisabled,
              ]}
              onPress={handleDownloadPress}
              activeOpacity={canDownload ? 0.8 : 1}
              disabled={buttonDisabled}
            >
              <Ionicons
                name="download"
                size={20}
                color={canDownload ? '#ffffff' : 'rgba(255,255,255,0.3)'}
              />
              <Text style={[styles.downloadButtonText, !canDownload && styles.downloadButtonTextDisabled]}>
                {!selectedRegion
                  ? 'Select a region'
                  : `Download ${selectedRegion.name}`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  // ============================================
  // Render: Map layers
  // ============================================

  const renderMapLayers = () => {
    if (!regionGeoJSON) return null;

    return (
      <MapLibre.ShapeSource id="region-boundary-source" shape={regionGeoJSON}>
        <MapLibre.FillLayer
          id="region-boundary-fill"
          style={{
            fillColor: selectedRegion?.color || '#4FC3F7',
            fillOpacity: 0.12,
          }}
        />
        <MapLibre.LineLayer
          id="region-boundary-border"
          style={{
            lineColor: selectedRegion?.color || '#4FC3F7',
            lineWidth: 2,
            lineOpacity: 0.8,
          }}
        />
      </MapLibre.ShapeSource>
    );
  };

  // ============================================
  // Render: Download confirmation modal
  // ============================================

  const renderDownloadConfirmation = () => {
    if (!showDownloadConfirm || !downloadInfo) return null;

    const { downloadSizeGB, deviceSizeGB, isWifi, isConnected } = downloadInfo;

    if (!isConnected) {
      return (
        <Modal
          visible={true}
          transparent={true}
          animationType="fade"
          onRequestClose={handleCancelDownload}
        >
          <View style={styles.confirmOverlay}>
            <View style={styles.confirmModal}>
              <Ionicons name="wifi" size={80} color="#e74c3c" style={{ marginBottom: 20 }} />
              <Text style={styles.confirmTitle}>No Internet Connection</Text>
              <Text style={styles.confirmMessage}>
                You must be connected to the internet to download region data.
              </Text>
              <TouchableOpacity style={styles.confirmButtonSingle} onPress={handleCancelDownload}>
                <Text style={styles.confirmButtonText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      );
    }

    return (
      <Modal
        visible={true}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCancelDownload}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmModal}>
            {isWifi ? (
              <Ionicons name="wifi" size={80} color="#2ecc71" style={{ marginBottom: 20 }} />
            ) : (
              <View style={{ marginBottom: 20, alignItems: 'center' }}>
                <Ionicons name="wifi" size={80} color="#e74c3c" />
                <View style={styles.wifiSlash} />
                <Text style={styles.cellularLabel}>Cellular</Text>
              </View>
            )}
            
            <Text style={styles.confirmTitle}>
              {isWifi ? 'Download Region Data' : 'Cellular Data Warning'}
            </Text>
            
            <View style={styles.confirmSizeBox}>
              <View style={styles.confirmSizeRow}>
                <Text style={styles.confirmSizeLabel}>Download Size</Text>
                <Text style={styles.confirmSizeValue}>{downloadSizeGB} GB</Text>
              </View>
              <View style={styles.confirmSizeRow}>
                <Text style={styles.confirmSizeLabel}>Required on Device</Text>
                <Text style={styles.confirmSizeValue}>{deviceSizeGB} GB</Text>
              </View>
            </View>
            
            {isWifi ? (
              <Text style={styles.confirmMessage}>
                You are about to download {downloadSizeGB} GB of data over WiFi.{'\n\n'}
                This will require {deviceSizeGB} GB of storage space on your device.{'\n\n'}
                This will take a few minutes depending on your connection speed.
              </Text>
            ) : (
              <Text style={styles.confirmMessage}>
                You are about to download {downloadSizeGB} GB of data over your cellular connection.{'\n\n'}
                This will require {deviceSizeGB} GB of storage space on your device.{'\n\n'}
                This will use a significant amount of your data plan and may take considerable time.{'\n\n'}
                <Text style={{ fontWeight: '700', color: '#f39c12' }}>
                  We strongly recommend connecting to WiFi first.
                </Text>
              </Text>
            )}
            
            <View style={styles.confirmButtons}>
              <TouchableOpacity 
                style={styles.confirmButtonCancel} 
                onPress={handleCancelDownload}
              >
                <Text style={styles.confirmButtonCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.confirmButtonDownload, !isWifi && styles.confirmButtonWarning]} 
                onPress={handleConfirmDownload}
              >
                <Text style={styles.confirmButtonText}>
                  {isWifi ? 'Download' : 'Download Anyway'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  // ============================================
  // Render: Bottom panel
  // ============================================

  const renderBottomPanel = () => {
    if (state === 'downloading' && selectedRegion) {
      return (
        <View style={{ flex: 1, paddingBottom: Math.max(insets.bottom, 8) }}>
          <DownloadPanel
            region={selectedRegion}
            onBack={handleBackFromDownload}
            selectedOptionalMaps={selectedOptionalMaps}
          />
        </View>
      );
    }
    return renderRegionList();
  };

  // ============================================
  // Main render
  // ============================================

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={onClose}
      >
        <View style={styles.container}>
          {renderHeader()}

          {/* Map fills remaining space */}
          <View style={styles.mapContainer}>
          <MapLibre.MapView
            style={styles.map}
            styleURL="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
            logoEnabled={false}
            attributionEnabled={false}
            compassEnabled={false}
          >
            <MapLibre.Camera
              ref={cameraRef}
              defaultSettings={{
                bounds: {
                  ne: US_OVERVIEW_BOUNDS.ne,
                  sw: US_OVERVIEW_BOUNDS.sw,
                  paddingLeft: 40,
                  paddingRight: 40,
                  paddingTop: 40,
                  paddingBottom: 40,
                },
              }}
            />
            {renderMapLayers()}
          </MapLibre.MapView>

          {/* Info overlay - upper left */}
          {renderInfoOverlay()}

          {/* Optional downloads picker - upper right */}
          {renderOptionalDownloadsPicker()}
        </View>

        {/* Bottom Panel */}
        <View style={[styles.bottomPanel, state === 'downloading' && styles.bottomPanelExpanded]}>
          {renderBottomPanel()}
        </View>
      </View>
    </Modal>
    
    {/* Download confirmation modal */}
    {renderDownloadConfirmation()}
    </>
  );
}

// ============================================
// Styles
// ============================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f1923',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
    backgroundColor: '#0f1923',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  headerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 70,
  },
  headerButtonText: {
    fontSize: 16,
    color: '#4FC3F7',
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#ffffff',
    flex: 1,
    textAlign: 'center',
  },
  headerDoneText: {
    fontSize: 16,
    color: '#4FC3F7',
    fontWeight: '600',
    textAlign: 'right',
  },

  // Map
  mapContainer: {
    flex: 1,
    backgroundColor: '#0a1628',
  },
  map: {
    flex: 1,
  },

  // Info overlay (upper-left of map)
  infoOverlay: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 25, 35, 0.92)',
    borderRadius: 10,
    overflow: 'hidden',
    maxWidth: 180,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  infoColorBar: {
    width: 4,
  },
  infoContent: {
    padding: 10,
    flex: 1,
  },
  infoRegionName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  infoDescription: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.55)',
    marginTop: 2,
  },
  infoDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 6,
  },
  infoSectionTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.4)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  infoSizeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  infoSizeLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  infoSizeValue: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.8)',
  },
  infoTotalLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.8)',
  },
  infoTotalValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  infoDetail: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  infoStorageSection: {
    marginTop: 2,
  },
  infoStorageLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.4)',
    marginBottom: 2,
  },
  infoStorageValue: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 1,
  },
  infoStorageDetail: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.4)',
  },

  // Combined optional downloads picker (upper-right of map)
  optionalPicker: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(15, 25, 35, 0.92)',
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    width: 170,
  },
  optionalPickerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 8,
    textAlign: 'center',
  },
  resPickerTitle: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.4)',
    letterSpacing: 0.8,
    marginBottom: 5,
    textAlign: 'center',
  },
  optionalPickerSeparator: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginVertical: 8,
  },
  resOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginBottom: 2,
  },
  resOptionSelected: {
    backgroundColor: 'rgba(79, 195, 247, 0.2)',
  },
  resOptionLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  resOptionLabelSelected: {
    color: '#ffffff',
    fontWeight: '700',
  },
  resOptionSize: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.4)',
    marginLeft: 8,
  },

  // Bottom Panel
  bottomPanel: {
    backgroundColor: '#1a1f2e',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    marginTop: -16,
    overflow: 'hidden',
  },
  bottomPanelExpanded: {
    flex: 1,
  },
  panelContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  panelSectionTitle: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.4)',
    letterSpacing: 1,
    marginBottom: 6,
    marginLeft: 2,
  },

  // Region chip grid
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  chipInstalled: {
    borderColor: 'rgba(76, 175, 80, 0.4)',
    backgroundColor: 'rgba(76, 175, 80, 0.08)',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.65)',
  },
  chipTextSelected: {
    color: '#ffffff',
    fontWeight: '700',
  },

  // Download section
  downloadSection: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  downloadButtonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  downloadButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  downloadButtonTextDisabled: {
    color: 'rgba(255, 255, 255, 0.3)',
    fontWeight: '500',
  },
  comingSoonButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  comingSoonButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.35)',
  },
  
  // Download confirmation modal
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  confirmModal: {
    backgroundColor: '#1a1f2e',
    borderRadius: 16,
    padding: 30,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(79, 195, 247, 0.3)',
  },
  wifiSlash: {
    position: 'absolute',
    width: 100,
    height: 3,
    backgroundColor: '#e74c3c',
    transform: [{ rotate: '45deg' }],
    top: 38,
  },
  cellularLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#e74c3c',
    marginTop: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  confirmTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 20,
  },
  confirmSizeBox: {
    backgroundColor: 'rgba(79, 195, 247, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(79, 195, 247, 0.3)',
  },
  confirmSizeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 8,
  },
  confirmSizeLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.6)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  confirmSizeValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#4FC3F7',
  },
  confirmMessage: {
    fontSize: 15,
    lineHeight: 22,
    color: 'rgba(255, 255, 255, 0.75)',
    textAlign: 'center',
    marginBottom: 24,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  confirmButtonCancel: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  confirmButtonCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  confirmButtonDownload: {
    flex: 1,
    backgroundColor: '#2ecc71',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonWarning: {
    backgroundColor: '#e74c3c',
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
  },
  confirmButtonSingle: {
    backgroundColor: '#4FC3F7',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    width: '100%',
    marginTop: 10,
  },
});

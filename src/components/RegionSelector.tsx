/**
 * RegionSelector
 *
 * Map-centric region selector for downloading chart data.
 * Shows all 15 NOAA regions as tappable MapLibre polygons on a full-screen map.
 * Tapping a region opens a right sidebar card with download options and progress.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  Dimensions,
  Alert,
  ScrollView,
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
import { getInstalledDistricts, unregisterDistrict, type InstalledDistrictRecord } from '../services/regionRegistryService';
import type { District } from '../types/chartPack';
import DownloadProgressView from './DownloadProgressView';

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

const SIDEBAR_WIDTH = 240;

const US_OVERVIEW_BOUNDS = {
  ne: [-50, 72],
  sw: [-180, 17],
};

const OPTIONAL_MAP_OPTIONS = [
  { id: 'basemap', label: 'Basemap', description: 'Light/Dark/Street/ECDIS', estimatedSizeMB: 724 },
  { id: 'ocean', label: 'Ocean Map', description: 'ESRI Ocean Basemap', estimatedSizeMB: 400 },
  { id: 'terrain', label: 'Terrain Map', description: 'OpenTopoMap', estimatedSizeMB: 500 },
];

// Regions to display (exclude test/special regions)
const DISPLAY_REGIONS = REGIONS.filter(
  r => r.firestoreId !== '17cgd-test' && r.firestoreId !== '07cgd-wflorida'
);

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

  // Sidebar animation
  const sidebarAnim = useRef(new Animated.Value(SIDEBAR_WIDTH + 20)).current;

  // Details expander
  const [showDetails, setShowDetails] = useState(false);

  // Disambiguation popup
  const [disambigRegions, setDisambigRegions] = useState<Region[] | null>(null);
  const [disambigPosition, setDisambigPosition] = useState<{ x: number; y: number } | null>(null);

  // Network state for inline cellular warning
  const [networkType, setNetworkType] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(true);

  // Region boundary (fetched dynamically from Firestore)
  const [regionBoundary, setRegionBoundary] = useState<
    { west: number; south: number; east: number; north: number } | null
  >(null);

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
        const [freeSpace, totalSpace] = await Promise.all([
          FileSystem.getFreeDiskStorageAsync(),
          FileSystem.getTotalDiskCapacityAsync(),
        ]);

        const totalGB = totalSpace / 1024 / 1024 / 1024;
        const availableGB = freeSpace / 1024 / 1024 / 1024;
        const usedGB = totalGB - availableGB;

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
    () => DISPLAY_REGIONS.find(r => r.id === selectedRegionId) || null,
    [selectedRegionId]
  );

  // Check if a region's district is installed
  const isRegionInstalled = useCallback((region: Region) => {
    return installedDistricts.some(d => d.districtId === region.firestoreId);
  }, [installedDistricts]);

  // Fetch district data when a region is selected
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
            setRegionBoundary(district.regionBoundary);
          }
          // Priority 2: Compute from US1 chart bounds
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
              setRegionBoundary({ west: w, south: s, east: e, north: n });
            } else {
              const [west, south, east, north] = selectedRegion.mapBounds;
              setRegionBoundary({ west, south, east, north });
            }
          }
          // Priority 3: Fall back to static mapBounds
          else {
            const [west, south, east, north] = selectedRegion.mapBounds;
            setRegionBoundary({ west, south, east, north });
          }
        }
      } catch (error) {
        console.error('[RegionSelector] Error loading district:', error);
        if (!cancelled) {
          const [west, south, east, north] = selectedRegion.mapBounds;
          setRegionBoundary({ west, south, east, north });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedRegion]);

  // Fly to region AFTER boundary data is loaded
  useEffect(() => {
    if (selectedRegionId && regionBoundary) {
      const { west, south, east, north } = regionBoundary;
      const lngExtent = east - west;
      const latExtent = north - south;
      const lngBuf = lngExtent * 0.25;
      const latBuf = latExtent * 0.25;

      const ne = [Math.min(east + lngBuf, 180), Math.min(north + latBuf, 90)];
      const sw = [Math.max(west - lngBuf, -180), Math.max(south - latBuf, -90)];

      const rightPad = selectedRegionId ? SIDEBAR_WIDTH + 40 : 40;

      cameraRef.current?.fitBounds(
        ne,
        sw,
        [40, rightPad, 40, 40],
        1200
      );
    }
  }, [selectedRegionId, regionBoundary]);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setState('selecting');
      setSelectedRegionId(null);
      setSelectedResolution('high');
      setSelectedOptionalMaps(new Set());
      setShowDetails(false);
      setDisambigRegions(null);
      sidebarAnim.setValue(SIDEBAR_WIDTH + 20);
    }
  }, [visible]);

  // Animate sidebar
  useEffect(() => {
    if (selectedRegionId) {
      Animated.timing(sidebarAnim, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(sidebarAnim, {
        toValue: SIDEBAR_WIDTH + 20,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [selectedRegionId]);

  // ============================================
  // GeoJSON for all region polygons
  // ============================================

  const allRegionsGeoJSON = useMemo(() => {
    return {
      type: 'FeatureCollection' as const,
      features: DISPLAY_REGIONS.map(region => {
        const [west, south, east, north] = region.mapBounds;
        const installed = installedDistricts.some(d => d.districtId === region.firestoreId);
        const isSelected = region.id === selectedRegionId;
        const isAlaskaSub = region.firestoreId.startsWith('17cgd-');

        return {
          type: 'Feature' as const,
          properties: {
            regionId: region.id,
            color: installed ? '#22c55e' : region.color,
            borderColor: installed ? '#22c55e' : region.color,
            name: region.name,
            installed: installed ? 1 : 0,
            isSelected: isSelected ? 1 : 0,
            isAlaskaSub: isAlaskaSub ? 1 : 0,
            fillOpacity: isSelected ? 0.35 : (installed ? 0.3 : 0.12),
            borderWidth: isSelected ? 2.5 : (installed ? 2 : 1.5),
            borderOpacity: isSelected ? 1 : (installed ? 0.8 : 0.5),
          },
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
        };
      }),
    };
  }, [installedDistricts, selectedRegionId]);

  // Label points for region names
  const regionLabelsGeoJSON = useMemo(() => {
    return {
      type: 'FeatureCollection' as const,
      features: DISPLAY_REGIONS.map(region => {
        const [west, south, east, north] = region.mapBounds;
        const installed = installedDistricts.some(d => d.districtId === region.firestoreId);
        const centerLng = (west + east) / 2;
        const centerLat = (south + north) / 2;

        return {
          type: 'Feature' as const,
          properties: {
            regionId: region.id,
            name: region.name,
            installed: installed ? 1 : 0,
            // Checkmark label shown below name for installed regions
            subtitle: installed ? '\u2713 Downloaded' : '',
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [centerLng, centerLat],
          },
        };
      }),
    };
  }, [installedDistricts]);

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

  // ============================================
  // Handlers
  // ============================================

  const selectRegion = useCallback((regionId: string) => {
    setDisambigRegions(null);
    setShowDetails(false);

    if (selectedRegionId === regionId) {
      // Deselect
      setSelectedRegionId(null);
      setRegionBoundary(null);
      setDistrictData(null);
      setState('selecting');
      flyToOverview();
    } else {
      // Select new region
      setRegionBoundary(null);
      setDistrictData(null);
      setSelectedRegionId(regionId);
      setState('selecting');
    }
  }, [selectedRegionId, flyToOverview]);

  const handleMapPress = useCallback((event: any) => {
    setDisambigRegions(null);

    const features = event?.features;
    if (!features || features.length === 0) {
      // Tapped empty map — deselect
      if (selectedRegionId) {
        setSelectedRegionId(null);
        setRegionBoundary(null);
        setDistrictData(null);
        setState('selecting');
        flyToOverview();
      }
      return;
    }

    // Find which region polygons were tapped
    const tappedRegionIds = features
      .map((f: any) => f.properties?.regionId)
      .filter((id: string | undefined) => id);

    const uniqueIds = [...new Set(tappedRegionIds)] as string[];

    if (uniqueIds.length === 0) {
      // Tapped empty map
      if (selectedRegionId) {
        setSelectedRegionId(null);
        setRegionBoundary(null);
        setDistrictData(null);
        setState('selecting');
        flyToOverview();
      }
      return;
    }

    if (uniqueIds.length === 1) {
      selectRegion(uniqueIds[0]);
    } else {
      // Multiple overlapping regions — show disambiguation popup
      const overlappingRegions = uniqueIds
        .map(id => DISPLAY_REGIONS.find(r => r.id === id))
        .filter(Boolean) as Region[];

      if (overlappingRegions.length > 1) {
        const screenPoint = event?.properties?.screenPointX != null
          ? { x: event.properties.screenPointX, y: event.properties.screenPointY }
          : { x: Dimensions.get('window').width / 2, y: Dimensions.get('window').height / 2 };
        setDisambigPosition(screenPoint);
        setDisambigRegions(overlappingRegions);
      } else {
        selectRegion(uniqueIds[0]);
      }
    }
  }, [selectedRegionId, selectRegion, flyToOverview]);

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
    if (!selectedRegion || !districtData) return;

    try {
      const netInfo = await NetInfo.fetch();
      setNetworkType(netInfo.type);
      setIsConnected(netInfo.isConnected ?? false);

      if (!netInfo.isConnected) {
        // No connection — show inline message (handled in sidebar render)
        return;
      }

      if (netInfo.type !== 'wifi') {
        // On cellular — show warning in sidebar, don't auto-start
        return;
      }

      // WiFi — start download
      setState('downloading');
    } catch (error) {
      console.error('[RegionSelector] Error checking network:', error);
      Alert.alert('Error', 'Unable to check network status.');
    }
  }, [selectedRegion, districtData]);

  const handleCellularDownload = useCallback(() => {
    setState('downloading');
  }, []);

  const handleDeleteRegion = useCallback(async () => {
    if (!selectedRegion) return;

    Alert.alert(
      'Delete Region Data',
      `Delete all downloaded data for ${selectedRegion.name}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await unregisterDistrict(selectedRegion.firestoreId);
              // Get other installed district IDs for GNIS check
              const otherIds = installedDistricts
                .filter(d => d.districtId !== selectedRegion.firestoreId)
                .map(d => d.districtId);
              await chartPackService.deleteRegion(selectedRegion.firestoreId, otherIds);

              // Refresh installed districts
              const updated = await getInstalledDistricts();
              setInstalledDistricts(updated);

              // Close sidebar
              setSelectedRegionId(null);
              setRegionBoundary(null);
              setDistrictData(null);
            } catch (error) {
              console.error('[RegionSelector] Error deleting region:', error);
              Alert.alert('Error', 'Failed to delete region data.');
            }
          },
        },
      ]
    );
  }, [selectedRegion]);

  // ============================================
  // Size calculation helpers
  // ============================================

  const formatSize = (mb: number) => {
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${Math.round(mb)} MB`;
  };

  const getSatelliteSizeForResolution = useCallback((resolution: SatelliteResolution): number => {
    if (resolution === 'none' || !districtData?.downloadPacks) return 0;

    let maxZoom = 8;
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

    if (satPacks.length === 0) return 0;
    return satPacks.reduce((sum, p) => sum + p.sizeBytes, 0) / 1024 / 1024;
  }, [districtData]);

  const sizeBreakdown = useMemo(() => {
    if (!selectedRegion) return null;

    // Charts
    let chartsMB = selectedRegion.estimatedChartSizeMB;
    if (districtData?.downloadPacks) {
      const chartPacks = districtData.downloadPacks.filter(p => p.type === 'charts');
      if (chartPacks.length > 0) {
        chartsMB = chartPacks.reduce((sum, p) => sum + p.sizeBytes, 0) / 1024 / 1024;
      }
    }

    // GNIS
    let gnisMB = 60;
    if (districtData?.downloadPacks) {
      const gnisPack = districtData.downloadPacks.find(p => p.type === 'gnis');
      if (gnisPack) gnisMB = gnisPack.sizeBytes / 1024 / 1024;
    }

    // Predictions
    let tidesMB = 50;
    if (districtData?.metadata?.predictionSizeMB?.tides) {
      tidesMB = districtData.metadata.predictionSizeMB.tides * 2;
    }
    let currentsMB = 90;
    if (districtData?.metadata?.predictionSizeMB?.currents) {
      currentsMB = districtData.metadata.predictionSizeMB.currents * 2;
    }
    const predictionsMB = tidesMB + currentsMB;

    // Buoys
    let buoysMB = 1;
    if (districtData?.metadata?.buoyCount) {
      buoysMB = (districtData.metadata.buoyCount * 5 * 1024) / 1024 / 1024;
    }

    // Marine Zones
    let marineZonesMB = 0.5;
    if (districtData?.metadata?.marineZoneCount) {
      marineZonesMB = (districtData.metadata.marineZoneCount * 20 * 1024) / 1024 / 1024;
    }

    // Satellite
    const satMB = getSatelliteSizeForResolution(selectedResolution);

    // Optional maps
    let optionalMapsMB = 0;
    OPTIONAL_MAP_OPTIONS.filter(opt => selectedOptionalMaps.has(opt.id)).forEach(opt => {
      if (districtData?.downloadPacks) {
        const pack = districtData.downloadPacks.find(p => p.type === opt.id);
        optionalMapsMB += pack ? pack.sizeBytes / 1024 / 1024 : opt.estimatedSizeMB;
      } else {
        optionalMapsMB += opt.estimatedSizeMB;
      }
    });

    const requiredMB = chartsMB + gnisMB + predictionsMB + buoysMB + marineZonesMB;
    const totalMB = requiredMB + satMB + optionalMapsMB;

    return {
      chartsMB,
      gnisMB,
      predictionsMB,
      buoysMB,
      marineZonesMB,
      satMB,
      optionalMapsMB,
      requiredMB,
      totalMB,
    };
  }, [selectedRegion, districtData, selectedResolution, selectedOptionalMaps, getSatelliteSizeForResolution]);

  // ============================================
  // Render: Header
  // ============================================

  const renderHeader = () => (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <View style={styles.headerButton} />
      <Text style={styles.headerTitle}>Download Charts</Text>
      <TouchableOpacity style={styles.headerButton} onPress={onClose}>
        <Text style={styles.headerDoneText}>Done</Text>
      </TouchableOpacity>
    </View>
  );

  // ============================================
  // Render: Sidebar
  // ============================================

  const renderSidebar = () => {
    if (!selectedRegion) return null;

    const installed = isRegionInstalled(selectedRegion);

    return (
      <Animated.View
        style={[
          styles.sidebar,
          { top: insets.top + 60, bottom: insets.bottom + 16 },
          { transform: [{ translateX: sidebarAnim }] },
        ]}
      >
        {/* Header */}
        <View style={styles.sidebarHeader}>
          <View style={[styles.sidebarColorBar, { backgroundColor: selectedRegion.color }]} />
          <Text style={styles.sidebarRegionName}>{selectedRegion.name}</Text>
          <Text style={styles.sidebarDescription}>{selectedRegion.description}</Text>
        </View>

        {state === 'downloading' ? (
          // Download progress
          <View style={{ flex: 1 }}>
            <DownloadProgressView
              region={selectedRegion}
              selectedResolution={selectedResolution}
              selectedOptionalMaps={selectedOptionalMaps}
              compact
              onComplete={() => {
                setState('selecting');
                getInstalledDistricts().then(setInstalledDistricts).catch(() => {});
              }}
              onCancel={() => setState('selecting')}
            />
          </View>
        ) : (
          // Selection state
          <>
            <ScrollView style={styles.sidebarBody} showsVerticalScrollIndicator={false}>
              {/* Status + Size section */}
              <View style={styles.sidebarSection}>
                {installed && (
                  <View style={styles.installedBadge}>
                    <View style={styles.installedDot} />
                    <Text style={styles.installedText}>Installed</Text>
                  </View>
                )}

                <View style={styles.statusRow}>
                  <Text style={styles.statusLabel}>
                    {installed ? 'On Device' : 'Total Download'}
                  </Text>
                  <Text style={styles.statusValue}>
                    {sizeBreakdown ? formatSize(sizeBreakdown.totalMB) : '...'}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.detailsToggle}
                  onPress={() => setShowDetails(!showDetails)}
                >
                  <Ionicons
                    name={showDetails ? 'chevron-down' : 'chevron-forward'}
                    size={12}
                    color="#4FC3F7"
                  />
                  <Text style={styles.detailsToggleText}>
                    {showDetails ? 'Hide details' : 'Show details'}
                  </Text>
                </TouchableOpacity>

                {showDetails && sizeBreakdown && (
                  <View style={styles.detailsList}>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailName}>Charts (US1-US6)</Text>
                      <Text style={styles.detailSize}>{formatSize(sizeBreakdown.chartsMB)}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailName}>Place Names</Text>
                      <Text style={styles.detailSize}>{formatSize(sizeBreakdown.gnisMB)}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailName}>Predictions</Text>
                      <Text style={styles.detailSize}>{formatSize(sizeBreakdown.predictionsMB)}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailName}>Buoys</Text>
                      <Text style={styles.detailSize}>{formatSize(sizeBreakdown.buoysMB)}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailName}>Marine Zones</Text>
                      <Text style={styles.detailSize}>{formatSize(sizeBreakdown.marineZonesMB)}</Text>
                    </View>
                    {sizeBreakdown.satMB > 0 && (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailName}>Satellite</Text>
                        <Text style={styles.detailSize}>{formatSize(sizeBreakdown.satMB)}</Text>
                      </View>
                    )}
                    {selectedOptionalMaps.has('basemap') && (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailName}>Basemap</Text>
                        <Text style={styles.detailSize}>{formatSize(724)}</Text>
                      </View>
                    )}
                    {selectedOptionalMaps.has('ocean') && (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailName}>Ocean Map</Text>
                        <Text style={styles.detailSize}>{formatSize(400)}</Text>
                      </View>
                    )}
                    {selectedOptionalMaps.has('terrain') && (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailName}>Terrain Map</Text>
                        <Text style={styles.detailSize}>{formatSize(500)}</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>

              {/* Satellite Resolution section */}
              <View style={styles.sidebarSection}>
                <Text style={styles.sidebarSectionTitle}>Satellite Imagery</Text>
                <View style={styles.satPills}>
                  {SATELLITE_OPTIONS.map(opt => {
                    const isActive = selectedResolution === opt.resolution;
                    return (
                      <TouchableOpacity
                        key={opt.resolution}
                        style={[styles.satPill, isActive && styles.satPillActive]}
                        onPress={() => handleResolutionSelect(opt.resolution)}
                      >
                        <Text style={[styles.satPillText, isActive && styles.satPillTextActive]}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={styles.satSizeLabel}>
                  {selectedResolution === 'none'
                    ? 'No satellite imagery'
                    : formatSize(getSatelliteSizeForResolution(selectedResolution) || SATELLITE_OPTIONS.find(o => o.resolution === selectedResolution)?.estimatedSizeMB || 0)}
                </Text>
              </View>

              {/* Optional Maps section */}
              <View style={styles.sidebarSection}>
                <Text style={styles.sidebarSectionTitle}>Optional Maps</Text>
                {OPTIONAL_MAP_OPTIONS.map(opt => {
                  const isChecked = selectedOptionalMaps.has(opt.id);
                  let optMapMB = opt.estimatedSizeMB;
                  if (districtData?.downloadPacks) {
                    const pack = districtData.downloadPacks.find(p => p.type === opt.id);
                    if (pack) optMapMB = pack.sizeBytes / 1024 / 1024;
                  }

                  return (
                    <TouchableOpacity
                      key={opt.id}
                      style={styles.optRow}
                      onPress={() => handleOptionalMapToggle(opt.id)}
                    >
                      <Ionicons
                        name={isChecked ? 'checkbox' : 'square-outline'}
                        size={18}
                        color={isChecked ? '#4FC3F7' : '#4a5568'}
                      />
                      <Text style={styles.optLabel}>{opt.label}</Text>
                      <Text style={styles.optSize}>{formatSize(optMapMB)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Storage indicator */}
              {storageInfo && (
                <View style={styles.sidebarSection}>
                  <View style={styles.storageBarBg}>
                    <View
                      style={[
                        styles.storageBarFill,
                        {
                          width: `${Math.min(100, (storageInfo.usedGB / storageInfo.totalGB) * 100)}%`,
                          backgroundColor: storageInfo.availableGB > 5
                            ? '#22c55e'
                            : storageInfo.availableGB > 1
                            ? '#eab308'
                            : '#ef4444',
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.storageText}>
                    {storageInfo.availableGB.toFixed(1)} GB available
                  </Text>
                </View>
              )}
            </ScrollView>

            {/* Inline cellular warning */}
            {networkType && networkType !== 'wifi' && isConnected && (
              <View style={styles.cellularWarning}>
                <Text style={styles.cellularWarningText}>
                  You're on cellular data {sizeBreakdown ? `\u2014 ${formatSize(sizeBreakdown.totalMB)} download` : ''}
                </Text>
              </View>
            )}

            {/* No connection warning */}
            {isConnected === false && networkType !== null && (
              <View style={[styles.cellularWarning, { borderColor: 'rgba(239,68,68,0.25)', backgroundColor: 'rgba(239,68,68,0.12)' }]}>
                <Text style={[styles.cellularWarningText, { color: '#ef4444' }]}>
                  No internet connection
                </Text>
              </View>
            )}

            {/* Action buttons */}
            <View style={styles.sidebarActions}>
              {installed ? (
                <View style={styles.manageBtns}>
                  <TouchableOpacity
                    style={[styles.manageBtn, styles.manageBtnUpdate]}
                    onPress={() => setState('downloading')}
                  >
                    <Text style={styles.manageBtnUpdateText}>Update</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.manageBtn, styles.manageBtnDelete]}
                    onPress={handleDeleteRegion}
                  >
                    <Text style={styles.manageBtnDeleteText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                networkType && networkType !== 'wifi' && isConnected ? (
                  <TouchableOpacity
                    style={[styles.downloadBtn, { backgroundColor: '#f97316' }]}
                    onPress={handleCellularDownload}
                  >
                    <Ionicons name="warning" size={16} color="#fff" />
                    <Text style={styles.downloadBtnText}>Download on Cellular</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.downloadBtn, { backgroundColor: selectedRegion.color }]}
                    onPress={handleDownloadPress}
                    disabled={!isConnected && networkType !== null}
                  >
                    <Ionicons name="download" size={16} color="#fff" />
                    <Text style={styles.downloadBtnText}>Download</Text>
                  </TouchableOpacity>
                )
              )}
            </View>
          </>
        )}
      </Animated.View>
    );
  };

  // ============================================
  // Render: Disambiguation popup
  // ============================================

  const renderDisambiguation = () => {
    if (!disambigRegions || !disambigPosition) return null;

    // Position the popup near the tap point, clamped to screen
    const { width: screenW, height: screenH } = Dimensions.get('window');
    const popupW = 180;
    const popupH = 40 + disambigRegions.length * 44;
    let left = Math.min(disambigPosition.x, screenW - popupW - 16);
    let top = Math.min(disambigPosition.y, screenH - popupH - 16);
    left = Math.max(16, left);
    top = Math.max(insets.top + 60, top);

    return (
      <View style={[styles.disambig, { left, top }]}>
        <Text style={styles.disambigTitle}>Select Region</Text>
        {disambigRegions.map(region => (
          <TouchableOpacity
            key={region.id}
            style={styles.disambigItem}
            onPress={() => selectRegion(region.id)}
          >
            <View style={[styles.disambigDot, { backgroundColor: region.color }]} />
            <Text style={styles.disambigItemText}>{region.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  // ============================================
  // Render: Map layers
  // ============================================

  const renderMapLayers = () => (
    <>
      <MapLibre.ShapeSource
        id="region-polygons-source"
        shape={allRegionsGeoJSON}
        onPress={handleMapPress}
      >
        <MapLibre.FillLayer
          id="region-polygons-fill"
          style={{
            fillColor: ['get', 'color'],
            fillOpacity: ['get', 'fillOpacity'],
          }}
        />
        <MapLibre.LineLayer
          id="region-polygons-border"
          style={{
            lineColor: ['get', 'borderColor'],
            lineWidth: ['get', 'borderWidth'],
            lineOpacity: ['get', 'borderOpacity'],
          }}
        />
      </MapLibre.ShapeSource>
      <MapLibre.ShapeSource id="region-labels-source" shape={regionLabelsGeoJSON}>
        <MapLibre.SymbolLayer
          id="region-labels"
          style={{
            textField: [
              'case',
              ['==', ['get', 'installed'], 1],
              ['concat', ['get', 'name'], '\nDownloaded'],
              ['get', 'name'],
            ],
            textSize: 12,
            textColor: [
              'case',
              ['==', ['get', 'installed'], 1],
              '#a3e635',
              '#ffffff',
            ],
            textHaloColor: 'rgba(0, 0, 0, 0.8)',
            textHaloWidth: 1.5,
            textFont: ['Noto Sans Bold'],
            textAllowOverlap: true,
            textIgnorePlacement: true,
          }}
        />
      </MapLibre.ShapeSource>
    </>
  );

  // ============================================
  // Main render
  // ============================================

  return (
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
            onPress={handleMapPress}
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

          {/* Sidebar */}
          {renderSidebar()}

          {/* Disambiguation popup */}
          {renderDisambiguation()}
        </View>
      </View>
    </Modal>
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
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: 'rgba(10,14,20,0.95)',
    zIndex: 1000,
  },
  headerButton: {
    minWidth: 60,
    alignItems: 'flex-end',
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
    fontWeight: '500',
  },

  // Map
  mapContainer: {
    flex: 1,
    backgroundColor: '#0a1628',
  },
  map: {
    flex: 1,
  },

  // Sidebar
  sidebar: {
    position: 'absolute',
    right: 0,
    width: SIDEBAR_WIDTH,
    backgroundColor: '#1a2332',
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    overflow: 'hidden',
    zIndex: 1001,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
  },
  sidebarHeader: {
    padding: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    position: 'relative',
  },
  sidebarColorBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopLeftRadius: 12,
  },
  sidebarRegionName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 2,
    marginLeft: 4,
  },
  sidebarDescription: {
    fontSize: 12,
    color: '#8899aa',
    marginLeft: 4,
  },
  sidebarBody: {
    flex: 1,
  },
  sidebarSection: {
    padding: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  sidebarSectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6b7b8d',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },

  // Status + Size
  installedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  installedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
  },
  installedText: {
    fontSize: 13,
    color: '#22c55e',
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  statusLabel: {
    fontSize: 13,
    color: '#8899aa',
  },
  statusValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#4FC3F7',
  },

  // Details expander
  detailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  detailsToggleText: {
    fontSize: 12,
    color: '#4FC3F7',
  },
  detailsList: {
    marginTop: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  detailName: {
    fontSize: 12,
    color: '#8899aa',
  },
  detailSize: {
    fontSize: 12,
    color: '#a0b0c0',
    fontVariant: ['tabular-nums'],
  },

  // Satellite pills
  satPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  satPill: {
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  satPillActive: {
    backgroundColor: 'rgba(79,195,247,0.2)',
    borderColor: '#4FC3F7',
  },
  satPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8899aa',
  },
  satPillTextActive: {
    color: '#4FC3F7',
  },
  satSizeLabel: {
    fontSize: 11,
    color: '#6b7b8d',
    marginTop: 6,
  },

  // Optional maps
  optRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5,
  },
  optLabel: {
    fontSize: 13,
    color: '#c0c8d0',
    flex: 1,
  },
  optSize: {
    fontSize: 12,
    color: '#6b7b8d',
    fontVariant: ['tabular-nums'],
  },

  // Storage
  storageBarBg: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginBottom: 6,
  },
  storageBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  storageText: {
    fontSize: 12,
    color: '#6b7b8d',
  },

  // Cellular warning
  cellularWarning: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginHorizontal: 14,
    marginBottom: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(234,179,8,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(234,179,8,0.25)',
  },
  cellularWarningText: {
    fontSize: 12,
    color: '#eab308',
  },

  // Action buttons
  sidebarActions: {
    padding: 12,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 8,
  },
  downloadBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  manageBtns: {
    flexDirection: 'row',
    gap: 8,
  },
  manageBtn: {
    flex: 1,
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1.5,
  },
  manageBtnUpdate: {
    backgroundColor: 'transparent',
    borderColor: '#4FC3F7',
  },
  manageBtnUpdateText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4FC3F7',
  },
  manageBtnDelete: {
    backgroundColor: 'transparent',
    borderColor: '#ef4444',
  },
  manageBtnDeleteText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ef4444',
  },

  // Disambiguation popup
  disambig: {
    position: 'absolute',
    backgroundColor: '#1a2332',
    borderRadius: 10,
    minWidth: 160,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    zIndex: 1002,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
  },
  disambigTitle: {
    fontSize: 11,
    color: '#6b7b8d',
    padding: 10,
    paddingBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  disambigItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  disambigItemText: {
    fontSize: 14,
    color: '#e0e0e0',
  },
  disambigDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});

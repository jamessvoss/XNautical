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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MapLibre from '@maplibre/maplibre-react-native';
import {
  REGIONS,
  Region,
  SATELLITE_OPTIONS,
  SatelliteResolution,
  getUS1ChartsGeoJSON,
  getRegionBBox,
} from '../config/regionData';
import * as chartPackService from '../services/chartPackService';
import { getInstalledDistricts, type InstalledDistrictRecord } from '../services/regionRegistryService';
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
  { id: 'basemap', label: 'Basemap', description: 'Light/Dark/Street/Nautical', estimatedSizeMB: 724 },
  { id: 'ocean', label: 'Ocean Map', description: 'ESRI Ocean Basemap', estimatedSizeMB: 400 },
  { id: 'terrain', label: 'Terrain Map', description: 'OpenTopoMap', estimatedSizeMB: 500 },
  { id: 'gnis', label: 'Place Names', description: 'GNIS overlay', estimatedSizeMB: 60 },
];

// ============================================
// Component
// ============================================

export default function RegionSelector({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<SelectorState>('selecting');
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [selectedResolution, setSelectedResolution] = useState<SatelliteResolution>('high');
  const [selectedOptionalMaps, setSelectedOptionalMaps] = useState<Set<string>>(new Set(['gnis']));
  const cameraRef = useRef<any>(null);

  // Track which districts are installed on device
  const [installedDistricts, setInstalledDistricts] = useState<InstalledDistrictRecord[]>([]);
  
  // Load installed districts when modal opens
  useEffect(() => {
    if (visible) {
      getInstalledDistricts().then(setInstalledDistricts).catch(() => {});
    }
  }, [visible, state]);

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

  // Can download when region is ready and resolution is chosen
  const canDownload = !!(selectedRegion && selectedRegion.status === 'converted' && selectedResolution);

  // Firestore US1 chart bounds (fetched dynamically, populated by enc-converter)
  const [firestoreBounds, setFirestoreBounds] = useState<
    { name: string; west: number; south: number; east: number; north: number }[] | null
  >(null);

  // Fetch US1 chart bounds from Firestore when a region is selected
  useEffect(() => {
    if (!selectedRegion) {
      setFirestoreBounds(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const district = await chartPackService.getDistrict(selectedRegion.firestoreId);
        if (!cancelled && district?.us1ChartBounds && district.us1ChartBounds.length > 0) {
          setFirestoreBounds(district.us1ChartBounds);
        }
      } catch {
        // Firestore fetch failed -- will fall back to static data
      }
    })();
    return () => { cancelled = true; };
  }, [selectedRegion]);

  // Resolved US1 chart list: prefer Firestore data, fall back to static regionData
  const resolvedUS1Charts = useMemo(() => {
    if (firestoreBounds && firestoreBounds.length > 0) return firestoreBounds;
    if (selectedRegion && selectedRegion.us1Charts.length > 0) return selectedRegion.us1Charts;
    return [];
  }, [firestoreBounds, selectedRegion]);

  // GeoJSON for the selected region's US1 chart bounding boxes
  const us1GeoJSON = useMemo(() => {
    if (!selectedRegion || resolvedUS1Charts.length === 0) return null;
    // If using Firestore bounds, build GeoJSON directly; otherwise use static helper
    if (firestoreBounds && firestoreBounds.length > 0) {
      return {
        type: 'FeatureCollection' as const,
        features: firestoreBounds.map(chart => ({
          type: 'Feature' as const,
          properties: { name: chart.name, regionId: selectedRegion.id, color: selectedRegion.color },
          geometry: {
            type: 'Polygon' as const,
            coordinates: [[
              [chart.west, chart.south],
              [chart.east, chart.south],
              [chart.east, chart.north],
              [chart.west, chart.north],
              [chart.west, chart.south],
            ]],
          },
        })),
      };
    }
    const geojson = getUS1ChartsGeoJSON(selectedRegion.id);
    return geojson.features.length > 0 ? geojson : null;
  }, [selectedRegion, resolvedUS1Charts, firestoreBounds]);

  // GeoJSON for US1 chart label points (center of each box)
  const us1LabelsGeoJSON = useMemo(() => {
    if (!selectedRegion || resolvedUS1Charts.length === 0) return null;

    return {
      type: 'FeatureCollection' as const,
      features: resolvedUS1Charts.map(chart => ({
        type: 'Feature' as const,
        properties: {
          name: chart.name,
          color: selectedRegion.color,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [
            (chart.west + chart.east) / 2,
            (chart.south + chart.north) / 2,
          ],
        },
      })),
    };
  }, [selectedRegion, resolvedUS1Charts]);

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
    const bbox = getRegionBBox(regionId);
    const [west, south, east, north] = bbox;
    cameraRef.current?.fitBounds(
      [east, north],
      [west, south],
      [60, 60, 60, 60],
      1200
    );
  }, []);

  // ============================================
  // Handlers
  // ============================================

  const handleRegionSelect = useCallback((regionId: string) => {
    if (selectedRegionId === regionId) {
      setSelectedRegionId(null);
      flyToOverview();
    } else {
      setSelectedRegionId(regionId);
      flyToRegion(regionId);
    }
  }, [selectedRegionId, flyToOverview, flyToRegion]);

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

  const handleDownloadPress = useCallback(() => {
    if (canDownload) {
      setState('downloading');
    }
  }, [canDownload]);

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

    const isReady = selectedRegion.status === 'converted';
    const chartsMB = selectedRegion.estimatedChartSizeMB;
    const satMB = selectedSatOption ? selectedSatOption.estimatedSizeMB : 0;
    const optionalMB = OPTIONAL_MAP_OPTIONS
      .filter(opt => selectedOptionalMaps.has(opt.id))
      .reduce((sum, opt) => sum + opt.estimatedSizeMB, 0);
    const totalMB = chartsMB + satMB + optionalMB;

    return (
      <View style={styles.infoOverlay} pointerEvents="none">
        <View style={[styles.infoColorBar, { backgroundColor: selectedRegion.color }]} />
        <View style={styles.infoContent}>
          <Text style={styles.infoRegionName}>{selectedRegion.name}</Text>
          <Text style={styles.infoDescription}>{selectedRegion.description}</Text>

          <View style={styles.infoDivider} />

          <View style={styles.infoSizeRow}>
            <Text style={styles.infoSizeLabel}>Charts</Text>
            <Text style={styles.infoSizeValue}>{formatSize(chartsMB)}</Text>
          </View>
          {selectedSatOption && (
            <View style={styles.infoSizeRow}>
              <Text style={styles.infoSizeLabel}>Satellite ({selectedSatOption.label})</Text>
              <Text style={styles.infoSizeValue}>{formatSize(selectedSatOption.estimatedSizeMB)}</Text>
            </View>
          )}
          {OPTIONAL_MAP_OPTIONS.filter(opt => selectedOptionalMaps.has(opt.id)).map(opt => (
            <View key={opt.id} style={styles.infoSizeRow}>
              <Text style={styles.infoSizeLabel}>{opt.label}</Text>
              <Text style={styles.infoSizeValue}>{formatSize(opt.estimatedSizeMB)}</Text>
            </View>
          ))}

          <View style={styles.infoDivider} />
          <View style={styles.infoSizeRow}>
            <Text style={styles.infoTotalLabel}>Total</Text>
            <Text style={styles.infoTotalValue}>{formatSize(totalMB)}</Text>
          </View>

          <View style={styles.infoDivider} />

          <View style={styles.infoRow}>
            <Ionicons
              name={isReady ? 'checkmark-circle' : 'time-outline'}
              size={12}
              color={isReady ? '#2ecc71' : '#8888aa'}
            />
            <Text style={[styles.infoDetail, { color: isReady ? '#2ecc71' : '#8888aa' }]}>
              {isReady ? 'Available' : 'Coming soon'}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  // ============================================
  // Render: Resolution picker (upper-right of map)
  // ============================================

  const renderResolutionPicker = () => {
    if (state === 'downloading') return null;

    return (
      <View style={styles.resPicker}>
        <Text style={styles.resPickerTitle}>SATELLITE</Text>
        {SATELLITE_OPTIONS.map(opt => {
          const isSelected = selectedResolution === opt.resolution;
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
              <Text style={styles.resOptionSize}>{formatSize(opt.estimatedSizeMB)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  // ============================================
  // Render: Optional maps picker (upper-right, below satellite)
  // ============================================

  const renderOptionalMapsPicker = () => {
    if (state === 'downloading') return null;

    return (
      <View style={styles.optMapsPicker}>
        <Text style={styles.resPickerTitle}>OPTIONAL MAPS</Text>
        {OPTIONAL_MAP_OPTIONS.map(opt => {
          const isSelected = selectedOptionalMaps.has(opt.id);
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
              <Text style={styles.resOptionSize}>{formatSize(opt.estimatedSizeMB)}</Text>
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
    if (!us1GeoJSON) return null;

    return (
      <>
        <MapLibre.ShapeSource id="us1-charts-source" shape={us1GeoJSON}>
          <MapLibre.FillLayer
            id="us1-chart-fills"
            style={{
              fillColor: selectedRegion?.color || '#4FC3F7',
              fillOpacity: 0.12,
            }}
          />
          <MapLibre.LineLayer
            id="us1-chart-borders"
            style={{
              lineColor: selectedRegion?.color || '#4FC3F7',
              lineWidth: 2,
              lineOpacity: 0.8,
            }}
          />
        </MapLibre.ShapeSource>

        {us1LabelsGeoJSON && (
          <MapLibre.ShapeSource id="us1-labels-source" shape={us1LabelsGeoJSON}>
            <MapLibre.SymbolLayer
              id="us1-chart-labels"
              style={{
                textField: ['get', 'name'],
                textSize: 11,
                textColor: '#ffffff',
                textHaloColor: 'rgba(0, 0, 0, 0.85)',
                textHaloWidth: 1.5,
                textAllowOverlap: true,
                textIgnorePlacement: true,
              }}
            />
          </MapLibre.ShapeSource>
        )}
      </>
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

          {/* Resolution picker - upper right */}
          {renderResolutionPicker()}

          {/* Optional maps picker - upper right, below satellite */}
          {renderOptionalMapsPicker()}
        </View>

        {/* Bottom Panel */}
        <View style={[styles.bottomPanel, state === 'downloading' && styles.bottomPanelExpanded]}>
          {renderBottomPanel()}
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
    maxWidth: 200,
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
  infoSizeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  infoSizeLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  infoSizeValue: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.8)',
  },
  infoTotalLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.8)',
  },
  infoTotalValue: {
    fontSize: 12,
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

  // Resolution picker (upper-right of map)
  resPicker: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(15, 25, 35, 0.92)',
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    width: 150,
  },
  resPickerTitle: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.4)',
    letterSpacing: 0.8,
    marginBottom: 5,
    textAlign: 'center',
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

  // Optional maps picker (upper-right of map, below satellite)
  optMapsPicker: {
    position: 'absolute',
    top: 138,
    right: 10,
    backgroundColor: 'rgba(15, 25, 35, 0.92)',
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    width: 150,
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
});

/**
 * Main StyleSheet for the DynamicChartViewer component.
 */

import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  container: { flex: 1 },
  // Map section wrapper - holds map and all overlays, takes remaining flex space
  mapSection: { flex: 1 },
  mapTouchWrapper: { flex: 1 },
  map: { flex: 1 },
  // Bottom stack for detail charts - flex layout, sits above tab bar naturally
  bottomStack: {
    // No absolute positioning - flex child that takes its content height
  },
  // Vertical quick toggles (left side)
  quickTogglesVertical: {
    position: 'absolute',
    backgroundColor: 'rgba(21, 21, 23, 0.65)',
  },
  quickToggleBtnV: {
    width: 44,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickToggleDividerH: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginHorizontal: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: { marginTop: 16, fontSize: 16, color: '#666' },
  // Chart loading progress overlay (non-blocking background loading indicator)
  chartLoadingOverlay: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
    pointerEvents: 'none', // Don't block touch events
  },
  chartLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  chartLoadingText: {
    marginLeft: 10,
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  chartLoadingProgress: {
    marginLeft: 8,
    fontSize: 13,
    color: '#666',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 32,
  },
  emptyTitle: { fontSize: 24, fontWeight: '600', color: '#333', marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#666', marginBottom: 24 },
  downloadBtn: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  downloadBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  zoomBadge: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  maxZoomIndicator: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 152, 0, 0.85)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  maxZoomText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: '600',
  },
  layersBtn: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.9)',
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  debugBtn: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.9)',
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  debugBtnText: {
    fontSize: 20,
  },
  debugPanel: {
    position: 'absolute',
    right: 12,
    width: 280,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    borderRadius: 10,
    padding: 12,
    maxHeight: 400,
  },
  debugScrollView: {
    maxHeight: 280,
  },
  debugTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  debugSectionTitle: {
    color: '#888',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
    marginTop: 4,
  },
  debugText: {
    color: '#ddd',
    fontSize: 12,
    marginBottom: 4,
  },
  debugInfo: {
    color: '#88ff88',
    fontSize: 9,
    fontFamily: 'monospace',
    lineHeight: 14,
  },
  debugStorageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 2,
  },
  debugStorageLabel: {
    color: '#aaa',
    fontSize: 11,
  },
  debugStorageValue: {
    color: '#4CAF50',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  debugStorageValueSmall: {
    color: '#888',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  debugChartList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  debugChartItem: {
    color: '#4FC3F7',
    fontSize: 10,
    fontFamily: 'monospace',
    backgroundColor: 'rgba(79, 195, 247, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  debugDivider: {
    height: 1,
    backgroundColor: '#333',
    marginVertical: 10,
  },
  // Debug buttons for tile diagnostics
  debugButtonRow: {
    position: 'absolute',
    bottom: 100,
    left: 12,
    flexDirection: 'row',
    backgroundColor: 'rgba(180, 60, 60, 0.85)',
    borderRadius: 8,
    padding: 4,
    gap: 4,
  },
  debugButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 4,
  },
  debugButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  debugToggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  debugToggle: {
    flex: 1,
    backgroundColor: '#222',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#444',
  },
  debugToggleActive: {
    backgroundColor: '#1B5E20',
    borderColor: '#4CAF50',
  },
  debugToggleText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  debugToggleTextActive: {
    color: '#fff',
  },
  debugActions: {
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingTop: 10,
    marginTop: 4,
  },
  debugActionBtn: {
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginBottom: 8,
    alignItems: 'center',
  },
  debugActionBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  debugCloseBtn: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  debugCloseBtnText: {
    color: '#666',
    fontSize: 13,
  },
  layersIcon: {
    width: 22,
    height: 22,
    position: 'relative',
  },
  layersSquare: {
    position: 'absolute',
    width: 14,
    height: 10,
    borderWidth: 1.5,
    borderColor: '#333',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 2,
  },
  layersSquare1: {
    top: 0,
    left: 0,
  },
  layersSquare2: {
    top: 4,
    left: 4,
  },
  layersSquare3: {
    top: 8,
    left: 8,
  },
  controls: {
    position: 'absolute',
    right: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    maxHeight: 420,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  controlsScroll: { maxHeight: 340 },
  controlSectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 4,
  },
  allToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  allToggleBtn: {
    flex: 1,
    backgroundColor: '#007AFF',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  allToggleBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  mapStyleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  mapStyleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  mapStyleBtnActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  mapStyleBtnText: {
    fontSize: 12,
    color: '#333',
    fontWeight: '500',
  },
  mapStyleBtnTextActive: {
    color: '#fff',
  },
  toggle: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  toggleBox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: '#ccc',
    borderRadius: 4,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBoxActive: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  toggleCheck: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  toggleLabel: { fontSize: 14, color: '#333' },
  closeBtn: { marginTop: 8, alignItems: 'center' },
  closeBtnText: { color: '#007AFF', fontSize: 14 },
  inspector: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 10,
    maxHeight: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  inspectorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    backgroundColor: '#f8f9fa',
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  inspectorTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  inspectorType: { fontSize: 13, fontWeight: '600', color: '#666' },
  inspectorId: { fontSize: 13, fontWeight: '500', color: '#333', marginLeft: 8 },
  inspectorClose: { fontSize: 18, color: '#999', paddingLeft: 8 },
  inspectorContent: { padding: 10 },
  inspectorRow: { flexDirection: 'row', paddingVertical: 3 },
  inspectorKey: { flex: 1, fontSize: 12, color: '#666' },
  inspectorValue: { flex: 2, fontSize: 12, color: '#333' },

  // GPS and Compass styles
  activeToggleBtn: {
    backgroundColor: 'rgba(33, 150, 243, 0.9)',
    borderWidth: 2,
    borderColor: '#1976d2',
  },
  shipMarker: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  shipIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 122, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  locationDotInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#007AFF',
  },
  shipBow: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#4FC3F7',
  },
  shipBody: {
    width: 16,
    height: 20,
    backgroundColor: '#4FC3F7',
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    marginTop: -2,
    borderWidth: 2,
    borderColor: '#0288D1',
    borderTopWidth: 0,
  },
  accuracyRing: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(33, 150, 243, 0.4)',
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
  },

  // ========== ForeFlight-style UI Styles ==========

  // Top menu bar - horizontal strip (same button size as vertical quick toggles)
  topMenuBar: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  topMenuBtn: {
    width: 44,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topMenuBtnActive: {
    backgroundColor: 'rgba(79, 195, 247, 0.4)',
  },
  topMenuBtnText: {
    fontSize: 24,
    color: '#fff',
  },
  topMenuBtnTextSmall: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  topMenuDivider: {
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginVertical: 6,
  },

  // Scale bar - centered below top menu bar
  scaleBarContainer: {
    position: 'absolute',
    alignSelf: 'center',
    alignItems: 'center',
  },
  scaleBarInner: {
    alignItems: 'center',
  },
  scaleBarLine: {
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 1,
    position: 'relative',
  },
  scaleBarEndCapLeft: {
    position: 'absolute',
    left: 0,
    top: -3,
    width: 2,
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 1,
  },
  scaleBarEndCapRight: {
    position: 'absolute',
    right: 0,
    top: -3,
    width: 2,
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 1,
  },
  scaleBarLabel: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 2,
    fontWeight: '600',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  // 3D layer stack icon (bigger)
  layerStackIcon: {
    width: 24,
    height: 20,
    position: 'relative',
  },
  layerStackLine: {
    position: 'absolute',
    width: 18,
    height: 4,
    backgroundColor: '#fff',
    borderRadius: 1,
  },

  // Upper right controls container - Day/Dusk/Night + Center on location
  upperRightControls: {
    position: 'absolute',
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 8,
    overflow: 'hidden',
    alignItems: 'center',
  },
  upperRightDivider: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  modeToggleText: {
    fontSize: 20,
  },
  centerBtnText: {
    fontSize: 28,
    color: '#fff',
  },

  // Quick toggles strip - minimalist style, bottom left
  quickToggleBtn: {
    width: 44,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickToggleBtnActive: {
    backgroundColor: 'rgba(79, 195, 247, 0.4)',
  },
  quickToggleBtnText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  quickToggleBtnTextLarge: {
    fontSize: 22,
    fontWeight: '400',
  },
  quickToggleDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginHorizontal: 8,
  },
  quickToggleDividerThick: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    marginVertical: 4,
  },


  // Bottom Control Panel - tabbed interface
  controlPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '40%',
    minHeight: 280,
    maxHeight: 450,
    backgroundColor: 'rgba(20, 25, 35, 0.95)',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    zIndex: 9999,
    elevation: 20, // Android
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabButtonActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#4FC3F7',
  },
  tabButtonText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '500',
  },
  tabButtonTextActive: {
    color: '#4FC3F7',
    fontWeight: '600',
  },
  tabContent: {
    flex: 1,
    overflow: 'hidden',
  },
  tabScrollContent: {
    padding: 16,
    paddingBottom: 64,
  },
  panelSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 4,
  },
  panelDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 12,
  },

  // Base Map tab
  basemapGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  basemapOption: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    minWidth: 80,
    alignItems: 'center',
  },
  basemapOptionActive: {
    backgroundColor: 'rgba(79, 195, 247, 0.3)',
  },
  basemapOptionText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  basemapOptionTextActive: {
    color: '#4FC3F7',
    fontWeight: '600',
  },
  activeChartInfo: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  activeChartText: {
    color: '#4FC3F7',
    fontSize: 14,
    fontWeight: '600',
  },
  activeChartSubtext: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    marginTop: 4,
  },
  chartScaleList: {
    marginTop: 8,
  },
  chartScaleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 4,
    marginBottom: 4,
  },
  chartScaleLabel: {
    color: '#4FC3F7',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  chartScaleCount: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
  },

  // Layers tab container
  layersTabContainer: {
    flex: 1,
  },
  subTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 8,
  },
  subTabButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginRight: 4,
  },
  subTabButtonActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#4FC3F7',
  },
  subTabButtonText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '500',
  },
  subTabButtonTextActive: {
    color: '#4FC3F7',
    fontWeight: '600',
  },
  layersColumnsContainer: {
    flex: 1,
  },
  layersColumnsContent: {
    padding: 12,
    paddingBottom: 20,
  },
  layersAllToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  layersThreeColumns: {
    flex: 1,
    flexDirection: 'row',
  },
  layersTwoColumns: {
    flex: 1,
    flexDirection: 'row',
  },
  layersColumn: {
    flex: 1,
    paddingHorizontal: 8,
  },
  layersColumnTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  layersIndentGroup: {
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(79, 195, 247, 0.3)',
    marginLeft: 4,
    marginTop: 4,
  },
  layersDisabledText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.3)',
    fontStyle: 'italic',
    marginTop: 4,
  },
  dataInfoBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: 10,
    borderRadius: 6,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dataInfoLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  dataInfoValue: {
    fontSize: 14,
    color: '#4FC3F7',
    fontWeight: '600',
  },

  // Display tab - vertical layout
  displayTabContainer: {
    flex: 1,
    flexDirection: 'column',
  },
  displayControlsTop: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  displayControlHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  displayFeatureName: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
  headerRightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  featureTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  resetIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resetIconText: {
    fontSize: 18,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  featureTypeBadgeText: {
    backgroundColor: 'rgba(79, 195, 247, 0.3)',
  },
  featureTypeBadgeLine: {
    backgroundColor: 'rgba(255, 183, 77, 0.3)',
  },
  featureTypeBadgeArea: {
    backgroundColor: 'rgba(129, 199, 132, 0.3)',
  },
  featureTypeBadgeLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.8)',
    textTransform: 'uppercase',
  },
  symbolTextToggle: {
    flexDirection: 'row',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  symbolTextToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  symbolTextToggleBtnActive: {
    // Background color set dynamically based on symbol.color
  },
  symbolTextToggleText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.85)',
    textTransform: 'uppercase',
  },
  symbolTextToggleTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  controlRowLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    width: 65,
  },
  sliderContainerCompact: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  displaySliderCompact: {
    flex: 1,
    height: 32,
  },
  sliderMinLabelSmall: {
    fontSize: 9,
    color: 'rgba(255, 255, 255, 0.4)',
    width: 26,
  },
  sliderMaxLabelSmall: {
    fontSize: 9,
    color: 'rgba(255, 255, 255, 0.4)',
    width: 26,
    textAlign: 'right',
  },
  sliderValueCompact: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
    width: 45,
    textAlign: 'right',
  },
  // Feature selector - grid below controls
  featureSelectorContainer: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  displayLegendInline: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginBottom: 10,
  },
  featureSelectorScroll: {
    flex: 1,
  },
  featureSelectorContent: {
    paddingBottom: 16,
  },
  featureSelectorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  featureSelectorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  featureSelectorChipActive: {
    backgroundColor: 'rgba(79, 195, 247, 0.25)',
  },
  featureSelectorChipText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  featureSelectorChipTextActive: {
    color: '#fff',
    fontWeight: '500',
  },
  featureTypeIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  featureTypeText: {
    backgroundColor: '#4FC3F7',
  },
  featureTypeLine: {
    backgroundColor: '#FFB74D',
  },
  featureTypeArea: {
    backgroundColor: '#81C784',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginLeft: 4,
  },

  // Other tab
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    padding: 4,
  },
  segmentOption: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 6,
  },
  segmentOptionActive: {
    backgroundColor: 'rgba(79, 195, 247, 0.3)',
  },
  segmentOptionText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  segmentOptionTextActive: {
    color: '#4FC3F7',
    fontWeight: '600',
  },
  settingNote: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.4)',
    marginTop: 8,
    fontStyle: 'italic',
  },
  resetAllBtn: {
    backgroundColor: 'rgba(244, 67, 54, 0.2)',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  resetAllBtnText: {
    color: '#EF5350',
    fontSize: 14,
    fontWeight: '600',
  },

  // ForeFlight-style toggles
  ffToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  ffToggleIndent: {
    paddingLeft: 16,
  },
  ffToggleBox: {
    width: 18,
    height: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    borderRadius: 4,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ffToggleBoxActive: {
    backgroundColor: '#4FC3F7',
    borderColor: '#4FC3F7',
  },
  ffToggleCheck: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  ffToggleLabel: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.85)',
  },

  // Feature Picker - for selecting between multiple features at tap location
  featurePickerContainer: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(20, 25, 35, 0.95)',
    borderRadius: 12,
    maxHeight: 300,
    overflow: 'hidden',
  },
  featurePickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  featurePickerTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  featurePickerClose: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featurePickerCloseText: {
    fontSize: 24,
    color: '#888',
    fontWeight: '300',
  },
  featurePickerList: {
    maxHeight: 240,
  },
  featurePickerItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  featurePickerItemText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#4FC3F7',
  },
  featurePickerItemSubtext: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 2,
  },

  // Layer Selector Panel - ForeFlight-style multi-column overlay (compact)
  layerSelectorOverlay: {
    position: 'absolute',
    left: 6,
    backgroundColor: 'rgba(21, 21, 23, 0.94)',
    borderRadius: 10,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  layerSelectorScroll: {
    maxHeight: '100%',
  },
  layerSelectorContent: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    padding: 8,
    paddingBottom: 12,
    gap: 12,
  },
  layerSelectorColumn: {
    paddingHorizontal: 4,
  },
  layerSectionHeader: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4FC3F7',
    marginTop: 8,
    marginBottom: 2,
    marginLeft: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  layerToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderRadius: 4,
    marginVertical: 0,
  },
  layerToggleRowActive: {
    backgroundColor: 'rgba(79, 195, 247, 0.25)',
  },
  layerToggleText: {
    fontSize: 12,
    color: '#fff',
  },

  // Navigation data boxes
  navDataBox: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 8,
    padding: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    minWidth: 80,
  },
  navDataUpperLeft: {
    left: 0,
    zIndex: 100,
  },
  navDataUpperRight: {
    right: 0,
    zIndex: 100,
  },
  navDataLowerLeft: {
    left: 0,
    zIndex: 1000, // Above detail charts
  },
  navDataLowerRight: {
    right: 0,
    zIndex: 1000, // Above detail charts
  },
  navDataMiddleLeft: {
    left: 0,
    zIndex: 100,
  },
  navDataMiddleRight: {
    right: 0,
    zIndex: 100,
  },
  navDataLabel: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '600',
    marginBottom: 2,
  },
  navDataLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    alignSelf: 'stretch',
    marginBottom: 2,
  },
  navDataZoom: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '500',
  },
  navDataValue: {
    fontSize: 28,
    color: '#fff',
    fontWeight: 'bold',
    fontVariant: ['tabular-nums'],
  },
  navDataValueSmall: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  navDataUnit: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: -2,
  },
  // Route point markers
  routePointMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FF6B35',
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  routePointNumber: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#fff',
  },

  // Stop Panning button - floating pill when user has panned away from GPS
  stopPanningBtn: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    zIndex: 200,
  },
  stopPanningText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },

  // Crosshair overlay - centered on screen during panning mode
  crosshairContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 50,
  },
  crosshairH: {
    position: 'absolute',
    width: 30,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  crosshairV: {
    position: 'absolute',
    width: 1,
    height: 30,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
});

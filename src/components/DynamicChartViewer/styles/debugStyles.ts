/**
 * Debug and diagnostics StyleSheets for the chart viewer.
 */

import { StyleSheet } from 'react-native';

export const debugStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1c1c1e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingTop: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
  closeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(79,195,247,0.15)',
  },
  closeBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#4FC3F7',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  quickActionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
  },
  quickActionText: {
    color: '#4FC3F7',
    fontSize: 14,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.8,
    marginBottom: 6,
    marginTop: 12,
    marginLeft: 4,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  toggleLabel: {
    fontSize: 15,
    color: '#fff',
    flex: 1,
  },
  toggleLabelDisabled: {
    color: 'rgba(255,255,255,0.4)',
  },
  toggleSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
    marginTop: 2,
  },
  debugBanner: {
    backgroundColor: 'rgba(255, 149, 0, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 149, 0, 0.3)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  debugBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FF9500',
    textAlign: 'center',
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterActive: {
    borderColor: '#4FC3F7',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4FC3F7',
  },
});

export const diagStyles = StyleSheet.create({
  row: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  label: {
    fontSize: 13,
    color: '#fff',
    marginBottom: 2,
  },
  value: {
    fontSize: 13,
    color: '#4FC3F7',
    fontWeight: '500',
  },
  mono: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    fontFamily: 'monospace',
  },
  sectionHeader: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.6,
  },
  codeBlock: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    padding: 10,
    margin: 8,
    borderRadius: 6,
  },
  codeText: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.6)',
    fontFamily: 'monospace',
  },
  errorBlock: {
    backgroundColor: 'rgba(255,59,48,0.15)',
    padding: 10,
    margin: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.3)',
  },
  errorText: {
    fontSize: 12,
    color: '#FF3B30',
    fontFamily: 'monospace',
  },
  layerItem: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  layerIndex: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
    fontFamily: 'monospace',
    width: 20,
  },
  layerId: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
    flex: 1,
  },
  layerMeta: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
    fontFamily: 'monospace',
  },
  layerBadge: {
    fontSize: 9,
    color: '#4FC3F7',
    backgroundColor: 'rgba(79,195,247,0.15)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
    fontWeight: '600',
  },
  layerBadgeHidden: {
    color: '#FF9500',
    backgroundColor: 'rgba(255,149,0,0.15)',
  },
});

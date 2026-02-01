/**
 * System Info Modal - Displays comprehensive system state for debugging
 * 
 * Shows:
 * - App and device information
 * - Startup parameters
 * - Performance metrics
 * - Current state (charts, map, GPS, etc.)
 * - Memory statistics
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Share,
  Platform,
} from 'react-native';
import { stateReporter, StateReport } from '../services/stateReporter';
import { logger } from '../services/loggingService';
import { performanceTracker } from '../services/performanceTracker';

interface SystemInfoModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function SystemInfoModal({ visible, onClose }: SystemInfoModalProps) {
  const [report, setReport] = useState<StateReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load state report when modal opens
  useEffect(() => {
    if (visible) {
      loadReport();
    }
  }, [visible]);

  const loadReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const stateReport = await stateReporter.generateReport();
      setReport(stateReport);
    } catch (err) {
      setError('Failed to generate state report');
      logger.error('STARTUP', 'Failed to generate state report', err as Error);
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    try {
      const jsonState = await stateReporter.getStateAsJson();
      await Share.share({
        message: jsonState,
        title: 'XNautical System State',
      });
    } catch (err) {
      logger.error('UI', 'Failed to share state', err as Error);
    }
  };

  const handleDumpToConsole = () => {
    logger.dumpState();
    performanceTracker.logReport();
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>System Information</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>Loading system info...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={loadReport} style={styles.retryButton}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : report ? (
          <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
            {/* App Info */}
            <Section title="App Info">
              <InfoRow label="Name" value={report.app.name} />
              <InfoRow label="Version" value={`${report.app.version} (${report.app.buildNumber})`} />
              <InfoRow label="Bundle ID" value={report.app.bundleId} />
            </Section>

            {/* Device Info */}
            <Section title="Device Info">
              <InfoRow label="Platform" value={`${report.device.platform} ${report.device.osVersion}`} />
              <InfoRow label="Screen" value={`${report.device.screenWidth}x${report.device.screenHeight} @${report.device.pixelRatio}x`} />
            </Section>

            {/* Charts */}
            <Section title="Charts">
              <InfoRow label="Loaded" value={String(report.charts.chartsLoaded)} />
              <InfoRow label="MBTiles" value={String(report.charts.mbtilesCharts.length)} />
              <InfoRow label="GeoJSON" value={String(report.charts.geojsonCharts.length)} />
              <InfoRow label="GNIS" value={report.charts.specialFiles.gnis ? 'Yes' : 'No'} />
              <InfoRow label="Basemap" value={report.charts.specialFiles.basemap ? 'Yes' : 'No'} />
              <InfoRow label="Satellite" value={String(report.charts.specialFiles.satelliteCount)} />
            </Section>

            {/* Map State */}
            <Section title="Map State">
              <InfoRow 
                label="Center" 
                value={report.map.center ? `${report.map.center[0].toFixed(4)}, ${report.map.center[1].toFixed(4)}` : 'N/A'} 
              />
              <InfoRow label="Zoom" value={report.map.zoom.toFixed(1)} />
              <InfoRow label="Style" value={report.map.style} />
              <InfoRow label="Layers" value={String(report.map.activeLayers.length)} />
            </Section>

            {/* GPS State */}
            <Section title="GPS State">
              <InfoRow label="Tracking" value={report.gps.isTracking ? 'Yes' : 'No'} />
              <InfoRow label="Permission" value={report.gps.hasPermission ? 'Yes' : 'No'} />
              {report.gps.latitude !== null && (
                <>
                  <InfoRow 
                    label="Position" 
                    value={`${report.gps.latitude?.toFixed(6)}, ${report.gps.longitude?.toFixed(6)}`} 
                  />
                  <InfoRow label="Accuracy" value={`${report.gps.accuracy?.toFixed(1)}m`} />
                </>
              )}
            </Section>

            {/* Tile Server */}
            <Section title="Tile Server">
              <InfoRow label="Status" value={report.tileServer.isRunning ? 'Running' : 'Stopped'} />
              <InfoRow label="Port" value={String(report.tileServer.port)} />
              <InfoRow label="Requests" value={String(report.tileServer.requestCount)} />
              <InfoRow label="Errors" value={String(report.tileServer.errorCount)} />
            </Section>

            {/* Performance */}
            <Section title="Performance">
              <InfoRow 
                label="Startup" 
                value={`${report.performance.startup.totalTime}ms ${report.performance.startup.complete ? '✓' : '...'}`} 
              />
              <InfoRow label="Peak Memory" value={`${report.performance.memory.peak} MB`} />
              {report.performance.memory.trend && (
                <InfoRow 
                  label="Memory Trend" 
                  value={`${report.performance.memory.trend.change >= 0 ? '+' : ''}${report.performance.memory.trend.change} MB (${report.performance.memory.trend.percentage}%)`} 
                />
              )}
            </Section>

            {/* Startup Phases */}
            {report.performance.startup.phases.length > 0 && (
              <Section title="Startup Phases">
                {report.performance.startup.phases.map((phase) => (
                  <InfoRow 
                    key={phase.phase} 
                    label={phase.phase} 
                    value={`${phase.duration ?? '?'}ms`} 
                  />
                ))}
              </Section>
            )}

            {/* Logging Config */}
            <Section title="Logging Config">
              <InfoRow 
                label="Level" 
                value={['DEBUG', 'INFO', 'PERF', 'WARN', 'ERROR'][report.logging.config.logLevel]} 
              />
              <InfoRow label="Timers Recorded" value={String(report.logging.timerHistory.length)} />
            </Section>
          </ScrollView>
        ) : null}

        <View style={styles.footer}>
          <TouchableOpacity onPress={handleDumpToConsole} style={styles.footerButton}>
            <Text style={styles.footerButtonText}>Dump to Console</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleShare} style={[styles.footerButton, styles.shareButton]}>
            <Text style={[styles.footerButtonText, styles.shareButtonText]}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={loadReport} style={styles.footerButton}>
            <Text style={styles.footerButtonText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// Section component
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

// Info row component
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: Platform.OS === 'ios' ? 48 : 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  closeButton: {
    padding: 8,
  },
  closeButtonText: {
    fontSize: 20,
    color: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    color: '#d00',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  infoLabel: {
    fontSize: 14,
    color: '#666',
    flex: 1,
  },
  infoValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
  },
  footer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e0e0e0',
    paddingVertical: 12,
    paddingHorizontal: 16,
    justifyContent: 'space-between',
  },
  footerButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  shareButton: {
    backgroundColor: '#007AFF',
  },
  footerButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  shareButtonText: {
    color: '#fff',
  },
});

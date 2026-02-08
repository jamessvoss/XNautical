/**
 * BuoyDetailModal - Displays live buoy observation data
 * Compact dark theme with minimal padding
 */

import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { X } from 'lucide-react-native';
import { Buoy, formatTemp, formatWaveHeight, formatWindSpeed, formatWindDirection, formatPressure, formatBuoyTimestamp, formatAirTemp, formatPressureTendency, formatWavePeriod } from '../services/buoyService';

interface Props {
  visible: boolean;
  buoy: Buoy | null;
  loading: boolean;
  onClose: () => void;
}

export default function BuoyDetailModal({ visible, buoy, loading, onClose }: Props) {
  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header - title + timestamp + close */}
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>{buoy?.name || 'Wx Buoy'}</Text>
              {buoy?.lastUpdated && (
                <Text style={styles.timestamp}>Last Updated: {formatBuoyTimestamp(buoy.lastUpdated)}</Text>
              )}
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X size={20} color="#aaa" />
            </TouchableOpacity>
          </View>

          {/* Content */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color="#FF8C00" />
              <Text style={styles.loadingText}>Loading...</Text>
            </View>
          ) : buoy ? (
            <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
              {/* Latest Observation */}
              {buoy.latestObservation && (
                <>
                  {/* Wind */}
                  {(buoy.latestObservation.windSpeed !== undefined || buoy.latestObservation.windDirection !== undefined) && (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>Wind</Text>
                      {buoy.latestObservation.windSpeed !== undefined && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Speed</Text>
                          <Text style={styles.infoValue}>{formatWindSpeed(buoy.latestObservation.windSpeed)}</Text>
                        </View>
                      )}
                      {buoy.latestObservation.windGust !== undefined && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Gust</Text>
                          <Text style={styles.infoValue}>{formatWindSpeed(buoy.latestObservation.windGust)}</Text>
                        </View>
                      )}
                      {buoy.latestObservation.windDirection !== undefined && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Direction</Text>
                          <Text style={styles.infoValue}>
                            {formatWindDirection(buoy.latestObservation.windDirection)} ({buoy.latestObservation.windDirection}°)
                          </Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Waves */}
                  {(buoy.latestObservation.waveHeight !== undefined || 
                    buoy.latestObservation.swellHeight !== undefined || 
                    buoy.latestObservation.windWaveHeight !== undefined) && (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>Waves</Text>
                      {buoy.latestObservation.waveHeight !== undefined && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Height</Text>
                          <Text style={styles.infoValue}>{formatWaveHeight(buoy.latestObservation.waveHeight)}</Text>
                        </View>
                      )}
                      {buoy.latestObservation.dominantWavePeriod !== undefined && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Period</Text>
                          <Text style={styles.infoValue}>{formatWavePeriod(buoy.latestObservation.dominantWavePeriod)}</Text>
                        </View>
                      )}
                      {buoy.latestObservation.meanWaveDirection !== undefined && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Direction</Text>
                          <Text style={styles.infoValue}>{buoy.latestObservation.meanWaveDirection}°</Text>
                        </View>
                      )}
                      {buoy.latestObservation.swellHeight !== undefined && (
                        <>
                          <View style={[styles.infoRow, styles.subSection]}>
                            <Text style={styles.infoLabel}>Swell</Text>
                            <Text style={styles.infoValue}>{formatWaveHeight(buoy.latestObservation.swellHeight)}</Text>
                          </View>
                          {buoy.latestObservation.swellPeriod !== undefined && (
                            <View style={[styles.infoRow, styles.subSection]}>
                              <Text style={styles.infoLabel}>Swell Period</Text>
                              <Text style={styles.infoValue}>{formatWavePeriod(buoy.latestObservation.swellPeriod)}</Text>
                            </View>
                          )}
                        </>
                      )}
                      {buoy.latestObservation.windWaveHeight !== undefined && (
                        <>
                          <View style={[styles.infoRow, styles.subSection]}>
                            <Text style={styles.infoLabel}>Wind Wave</Text>
                            <Text style={styles.infoValue}>{formatWaveHeight(buoy.latestObservation.windWaveHeight)}</Text>
                          </View>
                          {buoy.latestObservation.windWavePeriod !== undefined && (
                            <View style={[styles.infoRow, styles.subSection]}>
                              <Text style={styles.infoLabel}>Wind Wave Period</Text>
                              <Text style={styles.infoValue}>{formatWavePeriod(buoy.latestObservation.windWavePeriod)}</Text>
                            </View>
                          )}
                        </>
                      )}
                    </View>
                  )}

                  {/* Temperature */}
                  {(buoy.latestObservation.waterTemp !== undefined || 
                    buoy.latestObservation.airTemp !== undefined) && (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>Temperature</Text>
                      {buoy.latestObservation.waterTemp !== undefined && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Water</Text>
                          <Text style={styles.infoValue}>{formatTemp(buoy.latestObservation.waterTemp)}</Text>
                        </View>
                      )}
                      {buoy.latestObservation.airTemp !== undefined && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Air</Text>
                          <Text style={styles.infoValue}>{formatAirTemp(buoy.latestObservation.airTemp)}</Text>
                        </View>
                      )}
                      {buoy.latestObservation.dewPoint !== undefined && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Dew Point</Text>
                          <Text style={styles.infoValue}>{formatAirTemp(buoy.latestObservation.dewPoint)}</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Atmospheric */}
                  {(buoy.latestObservation.pressure !== undefined) && (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>Atmospheric</Text>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Pressure</Text>
                        <Text style={styles.infoValue}>{formatPressure(buoy.latestObservation.pressure)}</Text>
                      </View>
                      {buoy.latestObservation.pressureTendency !== undefined && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Tendency</Text>
                          <Text style={styles.infoValue}>{formatPressureTendency(buoy.latestObservation.pressureTendency)}</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Ocean Data */}
                  {buoy.latestObservation.oceanData && Object.keys(buoy.latestObservation.oceanData).length > 0 && (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>Ocean</Text>
                      {buoy.latestObservation.oceanData.depth !== undefined && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Depth</Text>
                          <Text style={styles.infoValue}>{buoy.latestObservation.oceanData.depth} m</Text>
                        </View>
                      )}
                      {buoy.latestObservation.oceanData.salinity !== undefined && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Salinity</Text>
                          <Text style={styles.infoValue}>{buoy.latestObservation.oceanData.salinity.toFixed(2)} psu</Text>
                        </View>
                      )}
                      {buoy.latestObservation.oceanData.ph !== undefined && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>pH</Text>
                          <Text style={styles.infoValue}>{buoy.latestObservation.oceanData.ph.toFixed(2)}</Text>
                        </View>
                      )}
                    </View>
                  )}
                </>
              )}

              {!buoy.latestObservation && (
                <View style={styles.noDataContainer}>
                  <Text style={styles.noDataText}>No observation data available</Text>
                </View>
              )}

              {/* Buoy Info - at the bottom */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Info</Text>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>ID</Text>
                  <Text style={styles.infoValue}>{buoy.id}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Type</Text>
                  <Text style={styles.infoValue}>{buoy.type}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Owner</Text>
                  <Text style={styles.infoValue}>{buoy.owner}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Position</Text>
                  <Text style={styles.infoValue}>
                    {buoy.latitude.toFixed(4)}°, {buoy.longitude.toFixed(4)}°
                  </Text>
                </View>
              </View>
            </ScrollView>
          ) : (
            <View style={styles.noDataContainer}>
              <Text style={styles.noDataText}>Buoy data not available</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'rgba(30, 30, 30, 0.92)',
    borderRadius: 10,
    width: '88%',
    maxHeight: '75%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.15)',
  },
  headerText: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  timestamp: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 1,
  },
  closeButton: {
    padding: 2,
  },
  scrollView: {
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 10,
  },
  loadingContainer: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 6,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  section: {
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FF8C00',
    marginBottom: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  subSection: {
    paddingLeft: 8,
  },
  infoLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.55)',
    flex: 1,
  },
  infoValue: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
  },
  noDataContainer: {
    padding: 20,
    alignItems: 'center',
  },
  noDataText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.4)',
  },
});

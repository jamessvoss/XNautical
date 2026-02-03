import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { getStationPredictions } from '../services/stationService';

interface Props {
  visible: boolean;
  stationId: string | null;
  stationType: 'tide' | 'current' | null;
  onClose: () => void;
}

function StationInfoModal({ visible, stationId, stationType, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible && stationId && stationType) {
      console.log('[STATION MODAL] Loading data for:', { stationId, stationType });
      loadStationData();
    }
  }, [visible, stationId, stationType]);

  const loadStationData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await getStationPredictions(stationId!, stationType!);
      setData(result);
    } catch (err: any) {
      console.error('Error loading station data:', err);
      setError(err.message || 'Failed to load station data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>
              {stationType === 'tide' ? '🌊 Tide Station' : '💨 Current Station'}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Content */}
          <ScrollView style={styles.content}>
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#007AFF" />
                <Text style={styles.loadingText}>Loading station data...</Text>
              </View>
            ) : error ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>❌ {error}</Text>
              </View>
            ) : data ? (
              <View>
                <Text style={styles.stationName}>{data.station.name}</Text>
                <Text style={styles.stationLocation}>
                  {data.station.lat.toFixed(4)}°, {data.station.lng.toFixed(4)}°
                </Text>
                <Text style={styles.date}>📅 {data.date}</Text>
                
                <View style={styles.divider} />
                
                <Text style={styles.sectionTitle}>
                  {stationType === 'tide' ? 'Today\'s Tides' : 'Today\'s Currents'}
                </Text>
                
                {data.predictions.length > 0 ? (
                  data.predictions.map((pred: any, idx: number) => (
                    <View key={idx} style={styles.predictionRow}>
                      <Text style={styles.time}>{pred.time}</Text>
                      {stationType === 'tide' ? (
                        <>
                          <Text style={styles.type}>
                            {pred.type === 'H' ? '⬆️ High' : '⬇️ Low'}
                          </Text>
                          <Text style={styles.value}>{pred.height.toFixed(2)} ft</Text>
                        </>
                      ) : (
                        <>
                          <Text style={styles.type}>
                            {pred.type === 'slack' ? '🔄 Slack' : '⚡ Max'}
                          </Text>
                          <Text style={styles.value}>
                            {pred.velocity.toFixed(2)} kt
                            {pred.direction ? ` @ ${pred.direction}°` : ''}
                          </Text>
                        </>
                      )}
                    </View>
                  ))
                ) : (
                  <Text style={styles.noData}>No predictions available for today</Text>
                )}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
    paddingBottom: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2C2C2E',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  closeButton: {
    padding: 8,
  },
  closeText: {
    fontSize: 24,
    color: '#8E8E93',
  },
  content: {
    padding: 16,
  },
  loadingContainer: {
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    color: '#8E8E93',
    marginTop: 12,
  },
  errorContainer: {
    padding: 20,
    alignItems: 'center',
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 16,
  },
  stationName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  stationLocation: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 8,
  },
  date: {
    fontSize: 14,
    color: '#007AFF',
    marginBottom: 12,
  },
  divider: {
    height: 1,
    backgroundColor: '#2C2C2E',
    marginVertical: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  predictionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#2C2C2E',
    borderRadius: 8,
    marginBottom: 8,
  },
  time: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
    width: 60,
  },
  type: {
    fontSize: 14,
    color: '#8E8E93',
    flex: 1,
  },
  value: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '600',
  },
  noData: {
    color: '#8E8E93',
    textAlign: 'center',
    padding: 20,
  },
});

// Memoize the component to prevent unnecessary re-renders
// Only re-render when props actually change
export default React.memo(StationInfoModal);

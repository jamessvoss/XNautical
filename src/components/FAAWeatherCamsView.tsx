/**
 * FAA WeatherCams WebView Component
 * Displays FAA weather cameras for Alaska
 */

import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  visible: boolean;
  onClose?: () => void;
  embedded?: boolean; // If true, renders without header/close button
}

// Alaska-centered URL for FAA WeatherCams
const FAA_WEATHERCAMS_URL = 'https://weathercams.faa.gov/map/-150.0,61.2,5';

const FAAWeatherCamsView = ({ visible, onClose, embedded = false }: Props) => {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);

  if (!visible) return null;

  const containerStyle = embedded
    ? styles.containerEmbedded
    : [styles.containerFullscreen, { paddingTop: insets.top }];

  return (
    <View style={containerStyle}>
      {/* Header - only show if not embedded */}
      {!embedded && (
        <View style={styles.header}>
          <Text style={styles.title}>FAA WeatherCams</Text>
          {onClose && (
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeButton}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      
      {/* Loading indicator */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#4FC3F7" />
          <Text style={styles.loadingText}>Loading weather cameras...</Text>
        </View>
      )}
      
      <WebView
        source={{ uri: FAA_WEATHERCAMS_URL }}
        style={styles.webview}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        javaScriptEnabled={true}
        domStorageEnabled={true}
      />
      
      {/* Legend */}
      <View style={styles.legend}>
        <Text style={styles.legendText}>FAA Weather Camera Program</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  containerEmbedded: {
    flex: 1,
    backgroundColor: '#14355e',
  },
  containerFullscreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#14355e',
    zIndex: 9999,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#16213e',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF',
  },
  closeButton: {
    fontSize: 24,
    color: '#FFF',
  },
  webview: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#14355e',
    zIndex: 10,
  },
  loadingText: {
    marginTop: 12,
    color: '#4FC3F7',
    fontSize: 14,
  },
  legend: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#16213e',
    alignItems: 'center',
  },
  legendText: {
    fontSize: 11,
    color: '#888',
  },
});

export default FAAWeatherCamsView;

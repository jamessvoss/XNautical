/**
 * Memory Debug Overlay - Shows real-time memory statistics
 * Toggle visibility by tapping the overlay
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  NativeModules,
  Platform,
} from 'react-native';

const { MemoryInfo } = NativeModules;

interface MemoryStats {
  // JVM heap (small part of total)
  jvmHeapUsed: number;
  jvmHeapMax: number;
  // Native heap from Debug API
  nativeHeapAllocated: number;
  nativeHeapSize: number;
  // PSS (actual memory footprint)
  totalPss: number;
  totalPssSummary: number;
  totalPrivateDirty: number;
  totalPrivateClean: number;
  // Detailed PSS breakdown
  javaHeapPss: number;
  nativeHeapPss: number;
  graphicsPss: number;
  stackPss: number;
  codePss: number;
  otherPss: number;
  // System
  systemAvailable: number;
  systemTotal: number;
  lowMemory: boolean;
  threshold: number;
}

interface Props {
  visible?: boolean;
  refreshInterval?: number; // ms
}

export default function MemoryDebugOverlay({ 
  visible = true, 
  refreshInterval = 2000 
}: Props) {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [history, setHistory] = useState<number[]>([]); // Track PSS history
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;

    const fetchMemory = async () => {
      try {
        if (MemoryInfo?.getMemoryInfo) {
          const info = await MemoryInfo.getMemoryInfo();
          setStats(info);
          
          // Use the summary total PSS which is most accurate
          const pssValue = info.totalPssSummary || info.totalPss || 0;
          
          // Track PSS history (last 30 readings = 1 minute at 2s interval)
          setHistory(prev => {
            const newHistory = [...prev, pssValue];
            if (newHistory.length > 30) newHistory.shift();
            return newHistory;
          });
          
          // Log to console for verification against adb dumpsys
          console.log(`[MEM] Total: ${pssValue}MB | Native: ${info.nativeHeapPss}MB | Graphics: ${info.graphicsPss}MB | Java: ${info.javaHeapPss}MB`);
        }
      } catch (error) {
        console.error('Failed to get memory info:', error);
      }
    };

    fetchMemory();
    intervalRef.current = setInterval(fetchMemory, refreshInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [visible, refreshInterval]);

  if (!visible || Platform.OS !== 'android' || !stats) {
    return null;
  }

  // Use the best available total PSS value
  const totalPss = stats.totalPssSummary || stats.totalPss || 0;
  
  // Calculate trend
  const trend = history.length >= 2 
    ? history[history.length - 1] - history[0]
    : 0;
  const trendText = trend > 50 ? '↑' : trend < -50 ? '↓' : '→';
  const trendColor = trend > 100 ? '#ff4444' : trend < -50 ? '#44ff44' : '#ffff44';

  // Warning thresholds
  const pssWarning = totalPss > 2000; // > 2GB
  const pssCritical = totalPss > 3000; // > 3GB
  const lowMemWarning = stats.lowMemory;

  if (!expanded) {
    // Compact view - just show total PSS
    return (
      <TouchableOpacity 
        style={[styles.compactContainer, pssCritical && styles.critical, pssWarning && !pssCritical && styles.warning]}
        onPress={() => setExpanded(true)}
      >
        <Text style={styles.compactText}>
          {Math.round(totalPss)} MB {trendText}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity 
      style={[styles.container, lowMemWarning && styles.lowMemory]}
      onPress={() => setExpanded(false)}
      activeOpacity={0.9}
    >
      <Text style={styles.title}>Memory Debug</Text>
      
      {/* Total PSS - Main metric */}
      <View style={styles.row}>
        <Text style={[styles.label, pssCritical && styles.criticalText]}>Total PSS:</Text>
        <Text style={[styles.value, pssCritical && styles.criticalText]}>
          {Math.round(totalPss)} MB
          <Text style={[styles.trend, { color: trendColor }]}> {trendText}</Text>
        </Text>
      </View>

      {/* Breakdown */}
      <View style={styles.section}>
        <View style={styles.row}>
          <Text style={styles.smallLabel}>Native Heap:</Text>
          <Text style={styles.smallValue}>{Math.round(stats.nativeHeapPss || 0)} MB</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.smallLabel}>Graphics:</Text>
          <Text style={styles.smallValue}>{Math.round(stats.graphicsPss || 0)} MB</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.smallLabel}>Java Heap:</Text>
          <Text style={styles.smallValue}>{Math.round(stats.javaHeapPss || 0)} MB</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.smallLabel}>Code:</Text>
          <Text style={styles.smallValue}>{Math.round(stats.codePss || 0)} MB</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.smallLabel}>Other:</Text>
          <Text style={styles.smallValue}>{Math.round(stats.otherPss || 0)} MB</Text>
        </View>
      </View>

      {/* System */}
      <View style={styles.section}>
        <View style={styles.row}>
          <Text style={styles.smallLabel}>System Free:</Text>
          <Text style={styles.smallValue}>
            {Math.round(stats.systemAvailable)} / {Math.round(stats.systemTotal)} MB
          </Text>
        </View>
        {lowMemWarning && (
          <Text style={styles.warningText}>⚠️ LOW MEMORY</Text>
        )}
      </View>

      {/* Trend indicator */}
      <View style={styles.row}>
        <Text style={styles.smallLabel}>1min trend:</Text>
        <Text style={[styles.smallValue, { color: trendColor }]}>
          {trend > 0 ? '+' : ''}{Math.round(trend)} MB
        </Text>
      </View>

      <Text style={styles.hint}>Tap to minimize</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    left: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    padding: 12,
    borderRadius: 8,
    minWidth: 180,
    zIndex: 9999,
  },
  compactContainer: {
    position: 'absolute',
    top: 50,
    left: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    padding: 8,
    borderRadius: 6,
    zIndex: 9999,
  },
  lowMemory: {
    borderWidth: 2,
    borderColor: '#ff4444',
  },
  warning: {
    borderWidth: 2,
    borderColor: '#ffaa00',
  },
  critical: {
    borderWidth: 2,
    borderColor: '#ff0000',
    backgroundColor: 'rgba(100, 0, 0, 0.9)',
  },
  title: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 2,
  },
  section: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
  },
  label: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  value: {
    color: '#00ff00',
    fontSize: 13,
    fontWeight: 'bold',
  },
  smallLabel: {
    color: '#aaaaaa',
    fontSize: 11,
  },
  smallValue: {
    color: '#cccccc',
    fontSize: 11,
  },
  trend: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  compactText: {
    color: '#00ff00',
    fontSize: 12,
    fontWeight: 'bold',
  },
  criticalText: {
    color: '#ff4444',
  },
  warningText: {
    color: '#ff4444',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 4,
  },
  hint: {
    color: '#666666',
    fontSize: 9,
    textAlign: 'center',
    marginTop: 8,
  },
});

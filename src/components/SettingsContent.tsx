/**
 * SettingsContent
 * 
 * Settings and preferences view shown in the Context tab.
 */

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { getInstalledDistricts, clearRegistry } from '../services/regionRegistryService';
import { deleteRegion } from '../services/chartPackService';
import { clearPredictions } from '../services/stationService';
import { clearBuoys } from '../services/buoyService';
import { clearMarineZones } from '../services/marineZoneService';

export default function SettingsContent() {
  const [storageInfo, setStorageInfo] = useState<{
    totalGB: number;
    usedGB: number;
    availableGB: number;
  } | null>(null);
  const [dataSize, setDataSize] = useState<string>('Calculating...');
  const [clearing, setClearing] = useState(false);
  
  // Load storage info
  useEffect(() => {
    const loadStorageInfo = async () => {
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
        console.error('[Settings] Error fetching storage:', error);
      }
    };
    
    const calculateDataSize = async () => {
      try {
        const mbtilesDir = FileSystem.documentDirectory + 'mbtiles/';
        const dirInfo = await FileSystem.getInfoAsync(mbtilesDir);
        
        if (dirInfo.exists) {
          const files = await FileSystem.readDirectoryAsync(mbtilesDir);
          let totalBytes = 0;
          
          for (const file of files) {
            const fileInfo = await FileSystem.getInfoAsync(mbtilesDir + file);
            if (fileInfo.exists) {
              totalBytes += fileInfo.size || 0;
            }
          }
          
          const gb = totalBytes / 1024 / 1024 / 1024;
          setDataSize(gb > 1 ? `${gb.toFixed(2)} GB` : `${(totalBytes / 1024 / 1024).toFixed(0)} MB`);
        } else {
          setDataSize('0 MB');
        }
      } catch (error) {
        console.error('[Settings] Error calculating data size:', error);
        setDataSize('Unknown');
      }
    };
    
    loadStorageInfo();
    calculateDataSize();
  }, []);
  
  const handleClearAllData = async () => {
    Alert.alert(
      'Clear All Downloaded Data',
      'This will delete all charts, predictions, satellite imagery, and other downloaded content.\n\nYour waypoints, routes, and boats will NOT be affected.\n\nThis cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All Data',
          style: 'destructive',
          onPress: async () => {
            setClearing(true);
            try {
              console.log('[Settings] Starting data clearing...');
              
              // Get all installed districts
              const districts = await getInstalledDistricts();
              console.log(`[Settings] Found ${districts.length} installed districts`);
              
              // Delete each district's data
              for (const district of districts) {
                console.log(`[Settings] Clearing district ${district.districtId}...`);
                await deleteRegion(district.districtId, []);
                await clearPredictions(district.districtId);
                await clearBuoys(district.districtId);
                await clearMarineZones(district.districtId);
              }
              
              // Clear the registry
              await clearRegistry();
              console.log('[Settings] Registry cleared');
              
              // Recalculate data size
              setDataSize('0 MB');
              
              Alert.alert('Success', 'All downloaded data has been cleared.');
            } catch (error) {
              console.error('[Settings] Error clearing data:', error);
              Alert.alert('Error', 'Failed to clear all data. Some files may remain.');
            } finally {
              setClearing(false);
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        {/* Storage Info Section */}
        <Text style={styles.sectionTitle}>DEVICE STORAGE</Text>
        
        {storageInfo && (
          <View style={styles.storageCard}>
            <View style={styles.storageRow}>
              <Text style={styles.storageLabel}>Total Capacity</Text>
              <Text style={styles.storageValue}>{storageInfo.totalGB.toFixed(1)} GB</Text>
            </View>
            <View style={styles.storageRow}>
              <Text style={styles.storageLabel}>Used</Text>
              <Text style={styles.storageValue}>{storageInfo.usedGB.toFixed(1)} GB</Text>
            </View>
            <View style={styles.storageRow}>
              <Text style={styles.storageLabel}>Available</Text>
              <Text style={[
                styles.storageValue,
                { 
                  color: storageInfo.availableGB > 5 
                    ? '#2ecc71' 
                    : storageInfo.availableGB > 1 
                    ? '#f39c12' 
                    : '#e74c3c' 
                }
              ]}>
                {storageInfo.availableGB.toFixed(1)} GB
              </Text>
            </View>
          </View>
        )}
        
        {/* Data Management Section */}
        <Text style={styles.sectionTitle}>DATA MANAGEMENT</Text>
        
        <View style={styles.dataCard}>
          <View style={styles.dataRow}>
            <Ionicons name="folder-open" size={24} color="#4FC3F7" />
            <View style={styles.dataInfo}>
              <Text style={styles.dataLabel}>Downloaded Data</Text>
              <Text style={styles.dataDescription}>Charts, predictions, satellite imagery</Text>
            </View>
            <Text style={styles.dataSize}>{dataSize}</Text>
          </View>
        </View>
        
        <TouchableOpacity 
          style={[styles.dangerButton, clearing && styles.dangerButtonDisabled]}
          onPress={handleClearAllData}
          disabled={clearing}
        >
          {clearing ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <>
              <Ionicons name="trash" size={20} color="#ffffff" />
              <Text style={styles.dangerButtonText}>Clear All Downloaded Data</Text>
            </>
          )}
        </TouchableOpacity>
        
        <Text style={styles.warningText}>
          Your waypoints, routes, and boat data will not be affected
        </Text>
        
        {/* Placeholder for future settings */}
        <Text style={styles.sectionTitle}>APP SETTINGS</Text>
        
        <View style={styles.settingItem}>
          <View style={styles.settingLeft}>
            <Ionicons name="moon-outline" size={24} color="#4FC3F7" />
            <Text style={styles.settingLabel}>Dark Mode</Text>
          </View>
          <Text style={styles.settingValue}>On</Text>
        </View>
        
        <View style={styles.settingItem}>
          <View style={styles.settingLeft}>
            <Ionicons name="notifications-outline" size={24} color="#4FC3F7" />
            <Text style={styles.settingLabel}>Notifications</Text>
          </View>
          <Text style={styles.settingValue}>Enabled</Text>
        </View>
        
        <View style={styles.settingItem}>
          <View style={styles.settingLeft}>
            <Ionicons name="map-outline" size={24} color="#4FC3F7" />
            <Text style={styles.settingLabel}>Map Units</Text>
          </View>
          <Text style={styles.settingValue}>Nautical</Text>
        </View>
        
        <Text style={styles.placeholder}>
          Additional settings coming soon
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1f2e',
  },
  content: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.4)',
    letterSpacing: 1,
    marginBottom: 12,
    marginTop: 20,
  },
  storageCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 10,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  storageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  storageLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  storageValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  dataCard: {
    backgroundColor: 'rgba(79, 195, 247, 0.1)',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(79, 195, 247, 0.3)',
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dataInfo: {
    flex: 1,
  },
  dataLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 2,
  },
  dataDescription: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  dataSize: {
    fontSize: 18,
    fontWeight: '700',
    color: '#4FC3F7',
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#e74c3c',
    borderRadius: 10,
    padding: 16,
    marginBottom: 8,
  },
  dangerButtonDisabled: {
    backgroundColor: 'rgba(231, 76, 60, 0.5)',
  },
  dangerButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  warningText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
    fontStyle: 'italic',
    marginBottom: 20,
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 10,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#ffffff',
  },
  settingValue: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  placeholder: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
    marginTop: 20,
    fontStyle: 'italic',
  },
});

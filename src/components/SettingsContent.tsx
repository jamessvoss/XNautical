/**
 * SettingsContent
 * 
 * Settings and preferences view shown in the Context tab.
 */

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { getInstalledDistricts, clearRegistry } from '../services/regionRegistryService';
import { deleteRegion, generateManifest } from '../services/chartPackService';
import * as tileServer from '../services/tileServer';
import { clearPredictions } from '../services/stationService';
import { clearBuoys } from '../services/buoyService';
import { clearMarineZones } from '../services/marineZoneService';
import * as displaySettingsService from '../services/displaySettingsService';
import type { DisplaySettings } from '../services/displaySettingsService';

export default function SettingsContent() {
  const [storageInfo, setStorageInfo] = useState<{
    totalGB: number;
    usedGB: number;
    availableGB: number;
  } | null>(null);
  const [appSize] = useState<string>('~80 MB'); // Estimated app binary size
  const [dataSize, setDataSize] = useState<string>('Calculating...');
  const [clearing, setClearing] = useState(false);
  const [loadingMBTiles, setLoadingMBTiles] = useState(false);
  const [chartDetail, setChartDetail] = useState<DisplaySettings['chartDetail']>('high');
  
  // Helper functions for loading storage info
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
  
  // Load storage info on mount
  useEffect(() => {
    loadStorageInfo();
    calculateDataSize();
    // Load chart detail setting
    displaySettingsService.loadSettings().then(settings => {
      setChartDetail(settings.chartDetail);
    });
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
              console.log('[Settings] ========================================');
              console.log('[Settings] STARTING COMPREHENSIVE DATA CLEARING');
              console.log('[Settings] ========================================');
              
              // STEP 1: Close all database connections
              console.log('[Settings] Closing all databases...');
              try {
                const { closeAllDatabases } = await import('../services/mbtilesReader');
                await closeAllDatabases();
                console.log('[Settings] ✅ MBTiles databases closed');
              } catch (err) {
                console.error('[Settings] ❌ Error closing MBTiles:', err);
              }
              
              // Close all prediction databases
              try {
                await clearPredictions(); // No districtId = clear all
                console.log('[Settings] ✅ Prediction databases closed and cleared');
              } catch (err) {
                console.error('[Settings] ❌ Error clearing predictions:', err);
              }
              
              // STEP 2: Delete ALL files in mbtiles directory (filesystem-first approach)
              console.log('[Settings] Scanning mbtiles directory for all files...');
              const mbtilesDir = FileSystem.documentDirectory + 'mbtiles/';
              const dirInfo = await FileSystem.getInfoAsync(mbtilesDir);
              
              let deletedFiles = 0;
              let freedBytes = 0;
              
              if (dirInfo.exists) {
                const files = await FileSystem.readDirectoryAsync(mbtilesDir);
                console.log(`[Settings] Found ${files.length} files in mbtiles directory`);
                
                for (const file of files) {
                  try {
                    const filePath = mbtilesDir + file;
                    const fileInfo = await FileSystem.getInfoAsync(filePath);
                    
                    if (fileInfo.exists) {
                      const sizeMB = (fileInfo.size || 0) / 1024 / 1024;
                      freedBytes += fileInfo.size || 0;
                      await FileSystem.deleteAsync(filePath, { idempotent: true });
                      deletedFiles++;
                      console.log(`[Settings] ✅ Deleted: ${file} (${sizeMB.toFixed(1)} MB)`);
                    }
                  } catch (err) {
                    console.error(`[Settings] ❌ Failed to delete ${file}:`, err);
                  }
                }
                
                console.log(`[Settings] Deleted ${deletedFiles} files from mbtiles directory`);
              } else {
                console.log('[Settings] mbtiles directory does not exist');
              }
              
              // STEP 3: Delete all prediction database files
              console.log('[Settings] Scanning for prediction database files...');
              const docDir = FileSystem.documentDirectory;
              if (docDir) {
                try {
                  const allFiles = await FileSystem.readDirectoryAsync(docDir);
                  const predDbFiles = allFiles.filter(f => 
                    f.startsWith('tides_') || f.startsWith('currents_')
                  );
                  
                  console.log(`[Settings] Found ${predDbFiles.length} prediction database files`);
                  
                  for (const dbFile of predDbFiles) {
                    try {
                      const dbPath = docDir + dbFile;
                      const dbInfo = await FileSystem.getInfoAsync(dbPath);
                      if (dbInfo.exists) {
                        freedBytes += dbInfo.size || 0;
                        await FileSystem.deleteAsync(dbPath, { idempotent: true });
                        deletedFiles++;
                        console.log(`[Settings] ✅ Deleted: ${dbFile}`);
                      }
                    } catch (err) {
                      console.error(`[Settings] ❌ Failed to delete ${dbFile}:`, err);
                    }
                  }
                } catch (err) {
                  console.error('[Settings] Error scanning document directory:', err);
                }
              }
              
              // STEP 4: Clear all buoy data from AsyncStorage
              console.log('[Settings] Clearing buoy data from AsyncStorage...');
              await clearBuoys(); // No districtId = clear all
              console.log('[Settings] ✅ Buoy data cleared');
              
              // STEP 5: Clear all marine zone data
              console.log('[Settings] Clearing marine zone data...');
              await clearMarineZones(); // No districtId = clear all
              console.log('[Settings] ✅ Marine zone data cleared');
              
              // STEP 6: Clear the registry
              await clearRegistry();
              console.log('[Settings] ✅ Registry cleared');
              
              // STEP 7: Regenerate empty manifest
              console.log('[Settings] Regenerating manifest...');
              const { generateManifest } = await import('../services/chartPackService');
              await generateManifest();
              console.log('[Settings] ✅ Manifest regenerated (empty)');
              
              console.log('[Settings] ========================================');
              console.log('[Settings] DATA CLEARING COMPLETE');
              console.log(`[Settings] Total: ${deletedFiles} files, ${(freedBytes / 1024 / 1024).toFixed(1)} MB freed`);
              console.log('[Settings] ========================================');
              
              // Update UI
              setDataSize('0 MB');
              
              const freedGB = freedBytes / 1024 / 1024 / 1024;
              Alert.alert(
                'Success', 
                `Deleted ${deletedFiles} files and freed ${freedGB >= 1 ? `${freedGB.toFixed(2)} GB` : `${(freedBytes / 1024 / 1024).toFixed(0)} MB`} of storage.\n\nPlease restart the app to complete the cleanup.`
              );
            } catch (error) {
              console.error('[Settings] ❌ Error clearing data:', error);
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
              <Text style={styles.storageLabel}>Total Capacity of Device</Text>
              <Text style={styles.storageValue}>{storageInfo.totalGB.toFixed(1)} GB</Text>
            </View>
            <View style={styles.storageRow}>
              <Text style={styles.storageLabel}>Total Capacity Used on Device</Text>
              <Text style={styles.storageValue}>{storageInfo.usedGB.toFixed(1)} GB</Text>
            </View>
            <View style={styles.storageRow}>
              <Text style={styles.storageLabel}>Total Capacity Available on Device</Text>
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
            <View style={[styles.storageRow, styles.storageDivider]}>
              <Text style={styles.storageLabel}>Capacity used by XNautical App</Text>
              <Text style={styles.storageValue}>{appSize}</Text>
            </View>
            <View style={styles.storageRow}>
              <Text style={styles.storageLabel}>Capacity used by XNautical Data</Text>
              <Text style={styles.storageValue}>{dataSize}</Text>
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
        
        <Text style={styles.sectionTitle}>CHART SETTINGS</Text>

        <View style={styles.settingItem}>
          <View style={styles.settingLeft}>
            <Ionicons name="layers-outline" size={24} color="#4FC3F7" />
            <Text style={styles.settingLabel}>Chart Detail</Text>
          </View>
        </View>
        <View style={styles.chartDetailRow}>
          {(['low', 'medium', 'high', 'ultra', 'max'] as const).map((level) => (
            <TouchableOpacity
              key={level}
              style={[
                styles.chartDetailButton,
                chartDetail === level && styles.chartDetailButtonActive,
              ]}
              onPress={async () => {
                setChartDetail(level);
                await displaySettingsService.updateSetting('chartDetail', level);
              }}
            >
              <Text style={[
                styles.chartDetailText,
                chartDetail === level && styles.chartDetailTextActive,
              ]}>
                {level === 'ultra' ? 'Ultra' : level.charAt(0).toUpperCase() + level.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.chartDetailDescription}>
          {chartDetail === 'low' ? 'Minimal detail — less clutter on small screens' :
           chartDetail === 'medium' ? 'Standard ECDIS — official S-57 scale minimums' :
           chartDetail === 'high' ? 'Enhanced detail — shows features one zoom level earlier' :
           chartDetail === 'ultra' ? 'High density — ideal for large, high-res displays' :
           'Maximum detail — shows all features as early as possible'}
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
  storageDivider: {
    paddingTop: 12,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
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
  chartDetailRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  chartDetailButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  chartDetailButtonActive: {
    backgroundColor: 'rgba(79, 195, 247, 0.2)',
    borderColor: '#4FC3F7',
  },
  chartDetailText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.4)',
  },
  chartDetailTextActive: {
    color: '#4FC3F7',
  },
  chartDetailDescription: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
    fontStyle: 'italic',
    marginBottom: 12,
  },
  placeholder: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
    marginTop: 20,
    fontStyle: 'italic',
  },
});

/**
 * Settings Screen - App configuration and cache management
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAuth, signOut } from '@react-native-firebase/auth';
import * as chartCacheService from '../services/chartCacheService';
import { formatBytes } from '../services/chartService';
import * as displaySettingsService from '../services/displaySettingsService';
import type { DisplaySettings } from '../services/displaySettingsService';
import SystemInfoModal from '../components/SystemInfoModal';

export default function SettingsScreen() {
  const [cacheSize, setCacheSize] = useState<number>(0);
  const [downloadedCount, setDownloadedCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [showSystemInfo, setShowSystemInfo] = useState(false);
  
  // Display settings
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>({
    // Font sizes (1.5 = nominal 100%, range 1.0-3.0)
    soundingsFontScale: 1.5,
    gnisFontScale: 1.5,
    depthContourFontScale: 1.5,
    chartLabelsFontScale: 1.5,
    // Text halo/stroke
    soundingsHaloScale: 1.0,
    gnisHaloScale: 1.0,
    depthContourLabelHaloScale: 1.0,
    chartLabelsHaloScale: 1.0,
    // Text opacities
    soundingsOpacityScale: 1.0,
    gnisOpacityScale: 1.0,
    depthContourLabelOpacityScale: 1.0,
    chartLabelsOpacityScale: 1.0,
    // Line widths
    depthContourLineScale: 1.0,
    coastlineLineScale: 1.0,
    cableLineScale: 1.0,
    pipelineLineScale: 1.0,
    bridgeLineScale: 1.0,
    mooringLineScale: 1.0,
    shorelineConstructionLineScale: 1.0,
    // Line halos - temporarily disabled to debug crash
    depthContourLineHaloScale: 0,
    coastlineHaloScale: 0,
    cableLineHaloScale: 0,
    pipelineLineHaloScale: 0,
    bridgeLineHaloScale: 0,
    mooringLineHaloScale: 0,
    shorelineConstructionHaloScale: 0,
    // Line opacities
    depthContourLineOpacityScale: 1.0,
    coastlineOpacityScale: 1.0,
    cableLineOpacityScale: 1.0,
    pipelineLineOpacityScale: 1.0,
    bridgeOpacityScale: 1.0,
    mooringOpacityScale: 1.0,
    shorelineConstructionOpacityScale: 1.0,
    // Area opacities
    depthAreaOpacityScale: 1.0,
    restrictedAreaOpacityScale: 1.0,
    cautionAreaOpacityScale: 1.0,
    militaryAreaOpacityScale: 1.0,
    anchorageOpacityScale: 1.0,
    marineFarmOpacityScale: 1.0,
    cableAreaOpacityScale: 1.0,
    pipelineAreaOpacityScale: 1.0,
    fairwayOpacityScale: 1.0,
    dredgedAreaOpacityScale: 1.0,
    // Area strokes
    depthAreaStrokeScale: 1.0,
    restrictedAreaStrokeScale: 1.0,
    cautionAreaStrokeScale: 1.0,
    militaryAreaStrokeScale: 1.0,
    anchorageStrokeScale: 1.0,
    marineFarmStrokeScale: 1.0,
    cableAreaStrokeScale: 1.0,
    pipelineAreaStrokeScale: 1.0,
    fairwayStrokeScale: 1.0,
    dredgedAreaStrokeScale: 1.0,
    // Symbol sizes (nominal values per S-52)
    lightSymbolSizeScale: 2.0,    // 200% nominal
    buoySymbolSizeScale: 2.0,     // 200% nominal
    beaconSymbolSizeScale: 1.5,   // 150% nominal
    wreckSymbolSizeScale: 1.5,
    rockSymbolSizeScale: 1.5,
    hazardSymbolSizeScale: 1.5,
    landmarkSymbolSizeScale: 1.5,
    mooringSymbolSizeScale: 1.5,
    anchorSymbolSizeScale: 1.5,
    // Symbol halos (white background per S-52)
    lightSymbolHaloScale: 1.0,
    buoySymbolHaloScale: 1.0,
    beaconSymbolHaloScale: 1.0,
    wreckSymbolHaloScale: 1.0,
    rockSymbolHaloScale: 1.0,
    hazardSymbolHaloScale: 1.0,
    landmarkSymbolHaloScale: 1.0,
    mooringSymbolHaloScale: 1.0,
    anchorSymbolHaloScale: 1.0,
    // Symbol opacities
    lightSymbolOpacityScale: 1.0,
    buoySymbolOpacityScale: 1.0,
    beaconSymbolOpacityScale: 1.0,
    wreckSymbolOpacityScale: 1.0,
    rockSymbolOpacityScale: 1.0,
    hazardSymbolOpacityScale: 1.0,
    landmarkSymbolOpacityScale: 1.0,
    mooringSymbolOpacityScale: 1.0,
    anchorSymbolOpacityScale: 1.0,
    // Other settings
    dayNightMode: 'day',
    orientationMode: 'north-up',
    depthUnits: 'meters',
  });

  useEffect(() => {
    loadCacheInfo();
    loadDisplaySettings();
  }, []);

  const loadCacheInfo = async () => {
    try {
      setLoading(true);
      const size = await chartCacheService.getCacheSize();
      const ids = await chartCacheService.getDownloadedChartIds();
      setCacheSize(size);
      setDownloadedCount(ids.length);
    } catch (error) {
      console.error('Error loading cache info:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadDisplaySettings = async () => {
    const settings = await displaySettingsService.loadSettings();
    setDisplaySettings(settings);
  };

  const updateDisplaySetting = async <K extends keyof DisplaySettings>(
    key: K,
    value: DisplaySettings[K]
  ) => {
    const newSettings = { ...displaySettings, [key]: value };
    setDisplaySettings(newSettings);
    await displaySettingsService.saveSettings(newSettings);
  };

  const resetDisplaySettings = () => {
    Alert.alert(
      'Reset Display Settings',
      'Reset all display settings (text sizes, line widths, area opacities) to default values?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          onPress: async () => {
            await displaySettingsService.resetSettings();
            const settings = await displaySettingsService.loadSettings();
            setDisplaySettings(settings);
          },
        },
      ]
    );
  };

  const formatScale = (scale: number) => {
    const percent = Math.round(scale * 100);
    return `${percent}%`;
  };

  const handleClearCache = () => {
    Alert.alert(
      'Clear All Charts',
      'This will delete all downloaded charts from your device. You can re-download them later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              setClearing(true);
              await chartCacheService.clearAllCharts();
              setCacheSize(0);
              setDownloadedCount(0);
              Alert.alert('Success', 'All cached charts have been cleared.');
            } catch (error) {
              Alert.alert('Error', 'Failed to clear cache.');
            } finally {
              setClearing(false);
            }
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              const authInstance = getAuth();
              await signOut(authInstance);
            } catch (error) {
              console.error('Logout error:', error);
            }
          },
        },
      ]
    );
  };

  const user = getAuth().currentUser;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <ScrollView style={styles.content}>
        {/* Account Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>Email</Text>
              <Text style={styles.value}>{user?.email || 'Not logged in'}</Text>
            </View>
            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
              <Text style={styles.logoutButtonText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Text Sizes Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Text Sizes</Text>
          <View style={styles.card}>
            {/* Soundings Font Size */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Soundings</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.soundingsFontScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0.5}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.soundingsFontScale}
                onValueChange={(value) => updateDisplaySetting('soundingsFontScale', value)}
                minimumTrackTintColor="#007AFF"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#007AFF"
              />
            </View>

            {/* GNIS Place Names Font Size */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Place Names (GNIS)</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.gnisFontScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0.5}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.gnisFontScale}
                onValueChange={(value) => updateDisplaySetting('gnisFontScale', value)}
                minimumTrackTintColor="#007AFF"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#007AFF"
              />
            </View>

            {/* Depth Contour Labels Font Size */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Depth Contours</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.depthContourFontScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0.5}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.depthContourFontScale}
                onValueChange={(value) => updateDisplaySetting('depthContourFontScale', value)}
                minimumTrackTintColor="#007AFF"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#007AFF"
              />
            </View>

            {/* Chart Labels Font Size */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Chart Labels</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.chartLabelsFontScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0.5}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.chartLabelsFontScale}
                onValueChange={(value) => updateDisplaySetting('chartLabelsFontScale', value)}
                minimumTrackTintColor="#007AFF"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#007AFF"
              />
            </View>
          </View>
        </View>

        {/* Line Widths Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Line Widths</Text>
          <View style={styles.card}>
            {/* Depth Contours Line Width */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Depth Contours</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.depthContourLineScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0.5}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.depthContourLineScale}
                onValueChange={(value) => updateDisplaySetting('depthContourLineScale', value)}
                minimumTrackTintColor="#4A90D9"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#4A90D9"
              />
            </View>

            {/* Coastline Line Width */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Coastline</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.coastlineLineScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0.5}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.coastlineLineScale}
                onValueChange={(value) => updateDisplaySetting('coastlineLineScale', value)}
                minimumTrackTintColor="#8B4513"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#8B4513"
              />
            </View>

            {/* Cables Line Width */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Cables</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.cableLineScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0.5}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.cableLineScale}
                onValueChange={(value) => updateDisplaySetting('cableLineScale', value)}
                minimumTrackTintColor="#800080"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#800080"
              />
            </View>

            {/* Pipelines Line Width */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Pipelines</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.pipelineLineScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0.5}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.pipelineLineScale}
                onValueChange={(value) => updateDisplaySetting('pipelineLineScale', value)}
                minimumTrackTintColor="#008000"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#008000"
              />
            </View>

            {/* Bridges Line Width */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Bridges</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.bridgeLineScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0.5}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.bridgeLineScale}
                onValueChange={(value) => updateDisplaySetting('bridgeLineScale', value)}
                minimumTrackTintColor="#696969"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#696969"
              />
            </View>

            {/* Moorings Line Width */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Moorings</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.mooringLineScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0.5}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.mooringLineScale}
                onValueChange={(value) => updateDisplaySetting('mooringLineScale', value)}
                minimumTrackTintColor="#4B0082"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#4B0082"
              />
            </View>

            {/* Shoreline Construction Line Width */}
            <View style={[styles.sliderRow, { borderBottomWidth: 0 }]}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Shoreline Construction</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.shorelineConstructionLineScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0.5}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.shorelineConstructionLineScale}
                onValueChange={(value) => updateDisplaySetting('shorelineConstructionLineScale', value)}
                minimumTrackTintColor="#5C4033"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#5C4033"
              />
            </View>
          </View>
        </View>

        {/* Area Opacity Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Area Opacity</Text>
          <View style={styles.card}>
            {/* Depth Areas Opacity */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Depth Areas</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.depthAreaOpacityScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.depthAreaOpacityScale}
                onValueChange={(value) => updateDisplaySetting('depthAreaOpacityScale', value)}
                minimumTrackTintColor="#5BB4D6"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#5BB4D6"
              />
            </View>

            {/* Restricted Areas Opacity */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Restricted Areas</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.restrictedAreaOpacityScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.restrictedAreaOpacityScale}
                onValueChange={(value) => updateDisplaySetting('restrictedAreaOpacityScale', value)}
                minimumTrackTintColor="#00AA00"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#00AA00"
              />
            </View>

            {/* Caution Areas Opacity */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Caution Areas</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.cautionAreaOpacityScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.cautionAreaOpacityScale}
                onValueChange={(value) => updateDisplaySetting('cautionAreaOpacityScale', value)}
                minimumTrackTintColor="#FFD700"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#FFD700"
              />
            </View>

            {/* Military Areas Opacity */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Military Areas</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.militaryAreaOpacityScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.militaryAreaOpacityScale}
                onValueChange={(value) => updateDisplaySetting('militaryAreaOpacityScale', value)}
                minimumTrackTintColor="#FF0000"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#FF0000"
              />
            </View>

            {/* Anchorages Opacity */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Anchorages</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.anchorageOpacityScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.anchorageOpacityScale}
                onValueChange={(value) => updateDisplaySetting('anchorageOpacityScale', value)}
                minimumTrackTintColor="#4169E1"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#4169E1"
              />
            </View>

            {/* Marine Farms Opacity */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Marine Farms</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.marineFarmOpacityScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.marineFarmOpacityScale}
                onValueChange={(value) => updateDisplaySetting('marineFarmOpacityScale', value)}
                minimumTrackTintColor="#228B22"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#228B22"
              />
            </View>

            {/* Cable Areas Opacity */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Cable Areas</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.cableAreaOpacityScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.cableAreaOpacityScale}
                onValueChange={(value) => updateDisplaySetting('cableAreaOpacityScale', value)}
                minimumTrackTintColor="#800080"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#800080"
              />
            </View>

            {/* Pipeline Areas Opacity */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Pipeline Areas</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.pipelineAreaOpacityScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.pipelineAreaOpacityScale}
                onValueChange={(value) => updateDisplaySetting('pipelineAreaOpacityScale', value)}
                minimumTrackTintColor="#008000"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#008000"
              />
            </View>

            {/* Fairways Opacity */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Fairways</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.fairwayOpacityScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.fairwayOpacityScale}
                onValueChange={(value) => updateDisplaySetting('fairwayOpacityScale', value)}
                minimumTrackTintColor="#E6E6FA"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#9370DB"
              />
            </View>

            {/* Dredged Areas Opacity */}
            <View style={[styles.sliderRow, { borderBottomWidth: 0 }]}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Dredged Areas</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.dredgedAreaOpacityScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={2.0}
                step={0.1}
                value={displaySettings.dredgedAreaOpacityScale}
                onValueChange={(value) => updateDisplaySetting('dredgedAreaOpacityScale', value)}
                minimumTrackTintColor="#87CEEB"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#87CEEB"
              />
            </View>

            <TouchableOpacity style={styles.resetButton} onPress={resetDisplaySettings}>
              <Text style={styles.resetButtonText}>Reset All to Defaults</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Symbol Sizes Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Symbol Sizes</Text>
          <View style={styles.card}>
            {/* Lights Symbol Size */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Lights</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.lightSymbolSizeScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0.5}
                maximumValue={3.0}
                step={0.1}
                value={displaySettings.lightSymbolSizeScale}
                onValueChange={(value) => updateDisplaySetting('lightSymbolSizeScale', value)}
                minimumTrackTintColor="#FF00FF"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#FF00FF"
              />
            </View>

            {/* Buoys Symbol Size */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Buoys</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.buoySymbolSizeScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0.5}
                maximumValue={3.0}
                step={0.1}
                value={displaySettings.buoySymbolSizeScale}
                onValueChange={(value) => updateDisplaySetting('buoySymbolSizeScale', value)}
                minimumTrackTintColor="#FF0000"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#FF0000"
              />
            </View>

            {/* Beacons Symbol Size */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Beacons</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.beaconSymbolSizeScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0.5}
                maximumValue={3.0}
                step={0.1}
                value={displaySettings.beaconSymbolSizeScale}
                onValueChange={(value) => updateDisplaySetting('beaconSymbolSizeScale', value)}
                minimumTrackTintColor="#00AA00"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#00AA00"
              />
            </View>

            {/* Wrecks Symbol Size */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Wrecks</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.wreckSymbolSizeScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0.5}
                maximumValue={3.0}
                step={0.1}
                value={displaySettings.wreckSymbolSizeScale}
                onValueChange={(value) => updateDisplaySetting('wreckSymbolSizeScale', value)}
                minimumTrackTintColor="#000000"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#000000"
              />
            </View>

            {/* Rocks Symbol Size */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Rocks</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.rockSymbolSizeScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0.5}
                maximumValue={3.0}
                step={0.1}
                value={displaySettings.rockSymbolSizeScale}
                onValueChange={(value) => updateDisplaySetting('rockSymbolSizeScale', value)}
                minimumTrackTintColor="#000000"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#000000"
              />
            </View>

            {/* Hazards Symbol Size */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Hazards (Obstructions)</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.hazardSymbolSizeScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0.5}
                maximumValue={3.0}
                step={0.1}
                value={displaySettings.hazardSymbolSizeScale}
                onValueChange={(value) => updateDisplaySetting('hazardSymbolSizeScale', value)}
                minimumTrackTintColor="#000000"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#000000"
              />
            </View>

            {/* Landmarks Symbol Size */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Landmarks</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.landmarkSymbolSizeScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0.5}
                maximumValue={3.0}
                step={0.1}
                value={displaySettings.landmarkSymbolSizeScale}
                onValueChange={(value) => updateDisplaySetting('landmarkSymbolSizeScale', value)}
                minimumTrackTintColor="#8B4513"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#8B4513"
              />
            </View>

            {/* Moorings Symbol Size */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Moorings</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.mooringSymbolSizeScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0.5}
                maximumValue={3.0}
                step={0.1}
                value={displaySettings.mooringSymbolSizeScale}
                onValueChange={(value) => updateDisplaySetting('mooringSymbolSizeScale', value)}
                minimumTrackTintColor="#800080"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#800080"
              />
            </View>

            {/* Anchors Symbol Size */}
            <View style={[styles.sliderRow, { borderBottomWidth: 0 }]}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Anchors</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.anchorSymbolSizeScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0.5}
                maximumValue={3.0}
                step={0.1}
                value={displaySettings.anchorSymbolSizeScale}
                onValueChange={(value) => updateDisplaySetting('anchorSymbolSizeScale', value)}
                minimumTrackTintColor="#000080"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#000080"
              />
            </View>
          </View>
        </View>

        {/* Symbol Halos Section - disabled for now, will implement with white symbol versions later */}
        
        {/* Symbol Opacity Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Symbol Opacity</Text>
          <View style={styles.card}>
            {/* Lights Symbol Opacity */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Lights</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.lightSymbolOpacityScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={1.0}
                step={0.1}
                value={displaySettings.lightSymbolOpacityScale}
                onValueChange={(value) => updateDisplaySetting('lightSymbolOpacityScale', value)}
                minimumTrackTintColor="#FFD700"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#FFD700"
              />
            </View>

            {/* Buoys Symbol Opacity */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Buoys</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.buoySymbolOpacityScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={1.0}
                step={0.1}
                value={displaySettings.buoySymbolOpacityScale}
                onValueChange={(value) => updateDisplaySetting('buoySymbolOpacityScale', value)}
                minimumTrackTintColor="#FF6347"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#FF6347"
              />
            </View>

            {/* Beacons Symbol Opacity */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Beacons</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.beaconSymbolOpacityScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={1.0}
                step={0.1}
                value={displaySettings.beaconSymbolOpacityScale}
                onValueChange={(value) => updateDisplaySetting('beaconSymbolOpacityScale', value)}
                minimumTrackTintColor="#32CD32"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#32CD32"
              />
            </View>

            {/* Wrecks Symbol Opacity */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Wrecks</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.wreckSymbolOpacityScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={1.0}
                step={0.1}
                value={displaySettings.wreckSymbolOpacityScale}
                onValueChange={(value) => updateDisplaySetting('wreckSymbolOpacityScale', value)}
                minimumTrackTintColor="#8B4513"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#8B4513"
              />
            </View>

            {/* Rocks Symbol Opacity */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Rocks</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.rockSymbolOpacityScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={1.0}
                step={0.1}
                value={displaySettings.rockSymbolOpacityScale}
                onValueChange={(value) => updateDisplaySetting('rockSymbolOpacityScale', value)}
                minimumTrackTintColor="#696969"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#696969"
              />
            </View>

            {/* Hazards Symbol Opacity */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Hazards (Obstructions)</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.hazardSymbolOpacityScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={1.0}
                step={0.1}
                value={displaySettings.hazardSymbolOpacityScale}
                onValueChange={(value) => updateDisplaySetting('hazardSymbolOpacityScale', value)}
                minimumTrackTintColor="#DC143C"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#DC143C"
              />
            </View>

            {/* Landmarks Symbol Opacity */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Landmarks</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.landmarkSymbolOpacityScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={1.0}
                step={0.1}
                value={displaySettings.landmarkSymbolOpacityScale}
                onValueChange={(value) => updateDisplaySetting('landmarkSymbolOpacityScale', value)}
                minimumTrackTintColor="#4682B4"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#4682B4"
              />
            </View>

            {/* Moorings Symbol Opacity */}
            <View style={styles.sliderRow}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Moorings</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.mooringSymbolOpacityScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={1.0}
                step={0.1}
                value={displaySettings.mooringSymbolOpacityScale}
                onValueChange={(value) => updateDisplaySetting('mooringSymbolOpacityScale', value)}
                minimumTrackTintColor="#4B0082"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#4B0082"
              />
            </View>

            {/* Anchors Symbol Opacity */}
            <View style={[styles.sliderRow, { borderBottomWidth: 0 }]}>
              <View style={styles.sliderHeader}>
                <Text style={styles.label}>Anchors</Text>
                <Text style={styles.sliderValue}>{formatScale(displaySettings.anchorSymbolOpacityScale)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={1.0}
                step={0.1}
                value={displaySettings.anchorSymbolOpacityScale}
                onValueChange={(value) => updateDisplaySetting('anchorSymbolOpacityScale', value)}
                minimumTrackTintColor="#000080"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#000080"
              />
            </View>
          </View>
        </View>

        {/* Storage Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Storage</Text>
          <View style={styles.card}>
            {loading ? (
              <ActivityIndicator size="small" color="#007AFF" />
            ) : (
              <>
                <View style={styles.row}>
                  <Text style={styles.label}>Downloaded Charts</Text>
                  <Text style={styles.value}>{downloadedCount}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.label}>Cache Size</Text>
                  <Text style={styles.value}>{formatBytes(cacheSize)}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.clearButton, clearing && styles.clearButtonDisabled]}
                  onPress={handleClearCache}
                  disabled={clearing || downloadedCount === 0}
                >
                  {clearing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.clearButtonText}>Clear All Charts</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* About Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>App Version</Text>
              <Text style={styles.value}>1.0.0</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Data Source</Text>
              <Text style={styles.value}>NOAA ENC</Text>
            </View>
          </View>
        </View>

        {/* Developer Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Developer</Text>
          <View style={styles.card}>
            <View style={[styles.row, { borderBottomWidth: 0 }]}>
              <Text style={styles.label}>Technical Debug</Text>
              <Text style={styles.valueSmall}>Available in Layers menu{'\n'}under "Show Active Chart"</Text>
            </View>
          </View>
        </View>

        {/* Refresh Cache Info */}
        <TouchableOpacity style={styles.refreshButton} onPress={loadCacheInfo}>
          <Text style={styles.refreshButtonText}>Refresh Cache Info</Text>
        </TouchableOpacity>
        
        {/* System Info Button */}
        <TouchableOpacity 
          style={styles.systemInfoButton} 
          onPress={() => setShowSystemInfo(true)}
        >
          <Text style={styles.systemInfoButtonText}>System Information</Text>
        </TouchableOpacity>
      </ScrollView>
      
      {/* System Info Modal */}
      <SystemInfoModal 
        visible={showSystemInfo} 
        onClose={() => setShowSystemInfo(false)} 
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },
  content: {
    flex: 1,
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  label: {
    fontSize: 16,
    color: '#333',
  },
  value: {
    fontSize: 16,
    color: '#666',
  },
  valueSmall: {
    fontSize: 12,
    color: '#999',
    textAlign: 'right',
  },
  logoutButton: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dc3545',
  },
  logoutButtonText: {
    color: '#dc3545',
    fontSize: 16,
    fontWeight: '600',
  },
  clearButton: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#dc3545',
  },
  clearButtonDisabled: {
    backgroundColor: '#ccc',
  },
  clearButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  refreshButton: {
    margin: 16,
    marginTop: 32,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#007AFF',
  },
  refreshButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  sliderRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sliderValue: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '600',
    minWidth: 50,
    textAlign: 'right',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  resetButton: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  resetButtonText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '600',
  },
  systemInfoButton: {
    margin: 16,
    marginTop: 8,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#6c757d',
  },
  systemInfoButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

/**
 * MoreScreen
 * 
 * ForeFlight-style menu screen with:
 * - Top buttons: Downloads, Settings (open full-screen modals)
 * - VIEWS section: List of views that switch the context tab
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useContextNav, ContextView } from '../contexts/NavigationContext';
import RegionSelector from '../components/RegionSelector';
import * as themeService from '../services/themeService';
import type { UITheme } from '../services/themeService';

interface ViewItem {
  id: ContextView;
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  description?: string;
}

const VIEWS: ViewItem[] = [
  { id: 'stats', name: 'Stats', icon: 'stats-chart', description: 'Account, storage, and data info' },
  { id: 'scratchpad', name: 'Scratch Pads', icon: 'document-text', description: 'Freeform drawing and notes' },
  { id: 'waypoints', name: 'Waypoints', icon: 'location-sharp', description: 'Manage saved waypoints' },
  { id: 'gpssensors', name: 'GPS & Sensors', icon: 'navigate-circle', description: 'Live GPS, compass, and sensor dashboard' },
];

export default function MoreScreen() {
  console.log('[MoreScreen] Initializing...');
  const { setContextView, contextTabView } = useContextNav();
  console.log('[MoreScreen] Got context, contextTabView:', contextTabView);
  const [showDownloads, setShowDownloads] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  const uiTheme = themeService.getUITheme();
  console.log('[MoreScreen] Got uiTheme');
  
  // Use dark theme styles consistently
  const themedStyles = useMemo(() => ({
    container: {
      backgroundColor: '#1a1f2e',
    },
    header: {
      backgroundColor: '#1a1f2e',
      borderBottomColor: 'rgba(255, 255, 255, 0.15)',
    },
    headerTitle: {
      color: '#fff',
    },
    sectionTitle: {
      color: 'rgba(255, 255, 255, 0.6)',
    },
    card: {
      backgroundColor: 'rgba(255, 255, 255, 0.08)',
    },
    menuItem: {
      borderBottomColor: 'rgba(255, 255, 255, 0.15)',
    },
    menuItemText: {
      color: '#fff',
    },
    menuItemDescription: {
      color: 'rgba(255, 255, 255, 0.5)',
    },
  }), [uiTheme]);

  const handleViewPress = (view: ContextView) => {
    setContextView(view);
  };

  return (
    <SafeAreaView style={[styles.container, themedStyles.container]} edges={['top']}>
      <View style={[styles.header, themedStyles.header]}>
        <Text style={[styles.headerTitle, themedStyles.headerTitle]}>More</Text>
      </View>

      <ScrollView style={styles.content}>
        {/* Top Action Buttons */}
        <View style={styles.actionButtonsContainer}>
          <TouchableOpacity
            style={[styles.actionButton, themedStyles.card]}
            onPress={() => setShowDownloads(true)}
          >
            <Ionicons name="download" size={28} color="#4FC3F7" />
            <Text style={[styles.actionButtonText, themedStyles.menuItemText]}>Downloads</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.actionButton, themedStyles.card]}
            onPress={() => setShowSettings(true)}
          >
            <Ionicons name="settings" size={28} color="#4FC3F7" />
            <Text style={[styles.actionButtonText, themedStyles.menuItemText]}>Settings</Text>
          </TouchableOpacity>
        </View>

        {/* Views Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>VIEWS</Text>
          <View style={[styles.card, themedStyles.card]}>
            {VIEWS.map((view, index) => (
              <TouchableOpacity
                key={view.id}
                style={[
                  styles.menuItem,
                  themedStyles.menuItem,
                  index === VIEWS.length - 1 && styles.menuItemLast,
                  contextTabView === view.id && styles.menuItemSelected,
                ]}
                onPress={() => handleViewPress(view.id)}
              >
                <Ionicons 
                  name={view.icon} 
                  size={22} 
                  color={contextTabView === view.id ? '#4FC3F7' : 'rgba(255, 255, 255, 0.6)'} 
                  style={styles.menuItemIcon}
                />
                <View style={styles.menuItemContent}>
                  <Text style={[
                    styles.menuItemText, 
                    themedStyles.menuItemText,
                    contextTabView === view.id && styles.menuItemTextSelected,
                  ]}>
                    {view.name}
                  </Text>
                  {view.description && (
                    <Text style={[styles.menuItemDescription, themedStyles.menuItemDescription]}>
                      {view.description}
                    </Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={20} color="rgba(255, 255, 255, 0.4)" />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Account Section - Quick logout access */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>ACCOUNT</Text>
          <View style={[styles.card, themedStyles.card]}>
            <TouchableOpacity
              style={[styles.menuItem, styles.menuItemLast, themedStyles.menuItem]}
              onPress={() => {
                // Will be handled in Settings modal
                setShowSettings(true);
              }}
            >
              <Ionicons name="person" size={22} color="rgba(255, 255, 255, 0.6)" style={styles.menuItemIcon} />
              <View style={styles.menuItemContent}>
                <Text style={[styles.menuItemText, themedStyles.menuItemText]}>Account & Logout</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="rgba(255, 255, 255, 0.4)" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Bottom padding */}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Region Selector (replaces old DownloadsModal) */}
      <RegionSelector
        visible={showDownloads}
        onClose={() => setShowDownloads(false)}
      />

      {/* Settings Modal - Placeholder for now */}
      {/* TODO: Create SettingsModal component */}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1f2e',
  },
  header: {
    padding: 16,
    backgroundColor: '#1a1f2e',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.15)',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
  content: {
    flex: 1,
  },
  actionButtonsContainer: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  actionButtonText: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  section: {
    marginTop: 8,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 8,
    marginLeft: 4,
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.15)',
  },
  menuItemLast: {
    borderBottomWidth: 0,
  },
  menuItemSelected: {
    backgroundColor: 'rgba(0, 122, 255, 0.15)',
  },
  menuItemIcon: {
    marginRight: 12,
    width: 24,
  },
  menuItemContent: {
    flex: 1,
  },
  menuItemText: {
    fontSize: 16,
    color: '#fff',
  },
  menuItemTextSelected: {
    color: '#4FC3F7',
    fontWeight: '500',
  },
  menuItemDescription: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 2,
  },
});

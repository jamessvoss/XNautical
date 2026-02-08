/**
 * ContextScreen
 * 
 * Context-sensitive screen that renders different content based on 
 * the currently selected view from the NavigationContext.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useContextNav } from '../contexts/NavigationContext';
import StatsContent from '../components/StatsContent';
import ScratchPadListView from '../components/ScratchPadListView';
import * as themeService from '../services/themeService';

export default function ContextScreen() {
  console.log('[ContextScreen] Initializing...');
  const { contextTabView, contextTabName } = useContextNav();
  console.log('[ContextScreen] contextTabView:', contextTabView, 'contextTabName:', contextTabName);
  const uiTheme = themeService.getUITheme();
  console.log('[ContextScreen] Got uiTheme');
  
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
  }), [uiTheme]);

  // Render content based on selected view
  const renderContent = () => {
    switch (contextTabView) {
      case 'stats':
        return <StatsContent />;
      
      case 'scratchpad':
        return <ScratchPadListView />;
      
      default:
        return (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>Unknown View</Text>
          </View>
        );
    }
  };

  return (
    <SafeAreaView style={[styles.container, themedStyles.container]} edges={['top']}>
      <View style={[styles.header, themedStyles.header]}>
        <Text style={[styles.headerTitle, themedStyles.headerTitle]}>{contextTabName}</Text>
      </View>
      <View style={styles.content}>
        {renderContent()}
      </View>
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
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  placeholderText: {
    fontSize: 20,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 8,
  },
  placeholderSubtext: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.5)',
  },
});

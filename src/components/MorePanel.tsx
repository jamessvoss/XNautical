/**
 * MorePanel - Slide-out settings/actions panel from the right edge
 * 
 * Replaces the full-screen MoreScreen with a narrow panel that slides
 * in from the right, occupying ~25% of the screen (min 220px for usability).
 * Tapping the More tab toggles it open/closed without leaving the current screen.
 * 
 * Styled to match the ForeFlight-style menu (dark background, icon rows,
 * Downloads/Settings top buttons, Views list).
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  Animated,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useContextNav, ContextView } from '../contexts/NavigationContext';
import DownloadsModal from './DownloadsModal';

interface ViewItem {
  id: ContextView;
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const VIEWS: ViewItem[] = [
  { id: 'stats', name: 'Stats', icon: 'stats-chart' },
];

// Panel width: 25% of screen, but at least 220px for usability
const PANEL_WIDTH = Math.max(Dimensions.get('window').width * 0.25, 220);

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function MorePanel({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { setContextView, contextTabView } = useContextNav();
  const [showDownloads, setShowDownloads] = useState(false);

  // Slide animation
  const slideAnim = useRef(new Animated.Value(PANEL_WIDTH)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const [renderPanel, setRenderPanel] = useState(false);

  useEffect(() => {
    if (visible) {
      setRenderPanel(true);
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 65,
          friction: 11,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: PANEL_WIDTH,
          tension: 65,
          friction: 11,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setRenderPanel(false);
      });
    }
  }, [visible, slideAnim, backdropAnim]);

  const handleViewPress = (view: ContextView) => {
    setContextView(view);
    onClose();
  };

  if (!renderPanel) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Semi-transparent backdrop - tap to close */}
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View
          style={[
            styles.backdrop,
            { opacity: backdropAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.35],
            })},
          ]}
        />
      </TouchableWithoutFeedback>

      {/* Sliding panel */}
      <Animated.View
        style={[
          styles.panel,
          {
            width: PANEL_WIDTH,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            transform: [{ translateX: slideAnim }],
          },
        ]}
      >
        {/* Top action buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => setShowDownloads(true)}
          >
            <Ionicons name="download" size={24} color="#4FC3F7" />
            <Text style={styles.actionButtonText}>Downloads</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              // TODO: Open settings
            }}
          >
            <Ionicons name="settings" size={24} color="#4FC3F7" />
            <Text style={styles.actionButtonText}>Settings</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        {/* Views section */}
        <Text style={styles.sectionTitle}>VIEWS</Text>
        <ScrollView style={styles.scrollArea} bounces={false}>
          {VIEWS.map((view) => {
            const isSelected = contextTabView === view.id;
            return (
              <TouchableOpacity
                key={view.id}
                style={[styles.menuItem, isSelected && styles.menuItemSelected]}
                onPress={() => handleViewPress(view.id)}
              >
                <Ionicons
                  name={view.icon}
                  size={20}
                  color={isSelected ? '#4FC3F7' : 'rgba(255, 255, 255, 0.6)'}
                  style={styles.menuItemIcon}
                />
                <Text
                  style={[styles.menuItemText, isSelected && styles.menuItemTextSelected]}
                  numberOfLines={1}
                >
                  {view.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.divider} />

        {/* Account */}
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => {
            // TODO: Open settings / account
          }}
        >
          <Ionicons name="person" size={20} color="rgba(255, 255, 255, 0.6)" style={styles.menuItemIcon} />
          <Text style={styles.menuItemText} numberOfLines={1}>Account</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Downloads Modal */}
      <DownloadsModal
        visible={showDownloads}
        onClose={() => setShowDownloads(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(20, 25, 35, 0.96)',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255, 255, 255, 0.15)',
  },
  actionRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 8,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  actionButtonText: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    marginHorizontal: 12,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.5)',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 6,
    letterSpacing: 0.5,
  },
  scrollArea: {
    flex: 1,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  menuItemSelected: {
    backgroundColor: 'rgba(79, 195, 247, 0.12)',
  },
  menuItemIcon: {
    marginRight: 10,
    width: 22,
  },
  menuItemText: {
    fontSize: 14,
    color: '#fff',
    flex: 1,
  },
  menuItemTextSelected: {
    color: '#4FC3F7',
    fontWeight: '600',
  },
});

/**
 * RouteEditor Component
 * 
 * Horizontal scrollable panel showing route points with edit capabilities.
 * Inspired by Foreflight's FPL Editor but adapted for nautical use.
 * 
 * Features:
 * - Horizontal scrollable list of route points (bubbles)
 * - Tap point for menu (Edit, Remove, Insert, Show on Map)
 * - Drag-and-drop to reorder points (future)
 * - Show leg distance and bearing between points
 * - Total route statistics at bottom
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoutes } from '../contexts/RouteContext';
import { formatDistance, formatBearing, formatDuration } from '../services/routeService';
import type { RoutePoint } from '../types/route';

interface RouteEditorProps {
  visible: boolean;
  onClose: () => void;
}

export default function RouteEditor({ visible, onClose }: RouteEditorProps) {
  const {
    activeRoute,
    removePointFromActiveRoute,
    updatePointInActiveRoute,
    saveActiveRoute,
    clearActiveRoute,
  } = useRoutes();

  const [selectedPoint, setSelectedPoint] = useState<RoutePoint | null>(null);
  const [showPointMenu, setShowPointMenu] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  // Handle point tap - show menu
  const handlePointPress = useCallback((point: RoutePoint) => {
    setSelectedPoint(point);
    setShowPointMenu(true);
  }, []);

  // Close point menu
  const closePointMenu = useCallback(() => {
    setShowPointMenu(false);
    setSelectedPoint(null);
  }, []);

  // Remove point
  const handleRemovePoint = useCallback(() => {
    if (!selectedPoint) return;
    
    Alert.alert(
      'Remove Point',
      `Remove ${selectedPoint.name || 'this point'} from route?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removePointFromActiveRoute(selectedPoint.id);
            closePointMenu();
          },
        },
      ]
    );
  }, [selectedPoint, removePointFromActiveRoute, closePointMenu]);

  // Edit point name
  const handleEditName = useCallback(() => {
    if (!selectedPoint) return;
    setNameInput(selectedPoint.name || '');
    setEditingName(true);
    setShowPointMenu(false);
  }, [selectedPoint]);

  // Save point name
  const handleSaveName = useCallback(() => {
    if (!selectedPoint) return;
    updatePointInActiveRoute(selectedPoint.id, { name: nameInput });
    setEditingName(false);
    setSelectedPoint(null);
  }, [selectedPoint, nameInput, updatePointInActiveRoute]);

  // Save route
  const handleSaveRoute = useCallback(async () => {
    if (!activeRoute) return;

    try {
      await saveActiveRoute();
      Alert.alert('Success', 'Route saved successfully');
      onClose();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to save route');
    }
  }, [activeRoute, saveActiveRoute, onClose]);

  // Clear route
  const handleClearRoute = useCallback(() => {
    Alert.alert(
      'Clear Route',
      'Remove all points from this route?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            clearActiveRoute();
            onClose();
          },
        },
      ]
    );
  }, [clearActiveRoute, onClose]);

  if (!visible || !activeRoute) return null;

  const hasPoints = activeRoute.routePoints.length > 0;
  const canSave = activeRoute.routePoints.length >= 2;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{activeRoute.name}</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Route Points List */}
      {hasPoints ? (
        <ScrollView
          horizontal
          style={styles.pointsList}
          contentContainerStyle={styles.pointsListContent}
          showsHorizontalScrollIndicator={false}
        >
          {activeRoute.routePoints.map((point, index) => (
            <View key={point.id} style={styles.pointContainer}>
              {/* Route Point Bubble */}
              <TouchableOpacity
                style={[
                  styles.pointBubble,
                  point.waypointRef && styles.pointBubbleWaypoint,
                ]}
                onPress={() => handlePointPress(point)}
              >
                <View style={styles.pointNumber}>
                  <Text style={styles.pointNumberText}>{index + 1}</Text>
                </View>
                <View style={styles.pointInfo}>
                  <Text style={styles.pointName} numberOfLines={1}>
                    {point.name || `Point ${index + 1}`}
                  </Text>
                  <Text style={styles.pointCoords} numberOfLines={1}>
                    {point.position.latitude.toFixed(4)}°, {point.position.longitude.toFixed(4)}°
                  </Text>
                </View>
                {point.waypointRef && (
                  <Ionicons name="location" size={16} color="#4CAF50" style={styles.waypointIcon} />
                )}
              </TouchableOpacity>

              {/* Leg Info (if not first point) */}
              {index > 0 && point.legDistance !== null && point.legBearing !== null && (
                <View style={styles.legInfo}>
                  <Text style={styles.legDistance}>
                    {formatDistance(point.legDistance, 1)}
                  </Text>
                  <Text style={styles.legBearing}>
                    {formatBearing(point.legBearing)}
                  </Text>
                </View>
              )}

              {/* Arrow to next point */}
              {index < activeRoute.routePoints.length - 1 && (
                <Ionicons name="arrow-forward" size={20} color="rgba(255,255,255,0.5)" style={styles.arrow} />
              )}
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.emptyState}>
          <Ionicons name="map-outline" size={48} color="rgba(255,255,255,0.3)" />
          <Text style={styles.emptyText}>Long-press the map to add points</Text>
        </View>
      )}

      {/* Route Statistics */}
      {hasPoints && (
        <View style={styles.stats}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Points</Text>
            <Text style={styles.statValue}>{activeRoute.routePoints.length}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Distance</Text>
            <Text style={styles.statValue}>
              {formatDistance(activeRoute.totalDistance, 1)}
            </Text>
          </View>
          {activeRoute.estimatedDuration !== null && (
            <>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Time</Text>
                <Text style={styles.statValue}>
                  {formatDuration(activeRoute.estimatedDuration)}
                </Text>
              </View>
            </>
          )}
        </View>
      )}

      {/* Action Buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.clearButton]}
          onPress={handleClearRoute}
          disabled={!hasPoints}
        >
          <Ionicons name="trash-outline" size={20} color={hasPoints ? '#FF5252' : '#666'} />
          <Text style={[styles.actionButtonText, styles.clearButtonText, !hasPoints && styles.disabledText]}>
            Clear
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.saveButton, !canSave && styles.disabledButton]}
          onPress={handleSaveRoute}
          disabled={!canSave}
        >
          <Ionicons name="checkmark" size={20} color="#fff" />
          <Text style={[styles.actionButtonText, !canSave && styles.disabledText]}>
            Save Route
          </Text>
        </TouchableOpacity>
      </View>

      {/* Point Menu Modal */}
      <Modal
        visible={showPointMenu}
        transparent
        animationType="fade"
        onRequestClose={closePointMenu}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={closePointMenu}
        >
          <View style={styles.pointMenu}>
            <Text style={styles.menuTitle}>
              {selectedPoint?.name || `Point ${selectedPoint?.order ? selectedPoint.order + 1 : ''}`}
            </Text>

            <TouchableOpacity style={styles.menuItem} onPress={handleEditName}>
              <Ionicons name="pencil-outline" size={20} color="#fff" />
              <Text style={styles.menuItemText}>Edit Name</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem} onPress={handleRemovePoint}>
              <Ionicons name="trash-outline" size={20} color="#FF5252" />
              <Text style={[styles.menuItemText, styles.menuItemDanger]}>Remove</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem} onPress={closePointMenu}>
              <Ionicons name="close" size={20} color="#999" />
              <Text style={[styles.menuItemText, { color: '#999' }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Edit Name Modal */}
      <Modal
        visible={editingName}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingName(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setEditingName(false)}
        >
          <View style={styles.editNameModal}>
            <Text style={styles.editNameTitle}>Edit Point Name</Text>
            <TextInput
              style={styles.nameInput}
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="Enter name..."
              placeholderTextColor="#666"
              autoFocus
            />
            <View style={styles.editNameActions}>
              <TouchableOpacity
                style={[styles.editNameButton, styles.cancelButton]}
                onPress={() => setEditingName(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.editNameButton, styles.saveNameButton]}
                onPress={handleSaveName}
              >
                <Text style={styles.saveNameButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(26, 31, 46, 0.95)',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  closeButton: {
    padding: 4,
  },
  pointsList: {
    maxHeight: 140,
  },
  pointsListContent: {
    padding: 16,
    alignItems: 'center',
  },
  pointContainer: {
    alignItems: 'center',
  },
  pointBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 107, 53, 0.2)',
    borderWidth: 2,
    borderColor: '#FF6B35',
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    minWidth: 120,
  },
  pointBubbleWaypoint: {
    borderColor: '#4CAF50',
    backgroundColor: 'rgba(76, 175, 80, 0.2)',
  },
  pointNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  pointNumberText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  pointInfo: {
    flex: 1,
  },
  pointName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  pointCoords: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 11,
  },
  waypointIcon: {
    marginLeft: 4,
  },
  legInfo: {
    marginTop: 4,
    alignItems: 'center',
  },
  legDistance: {
    color: '#4FC3F7',
    fontSize: 12,
    fontWeight: '600',
  },
  legBearing: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 10,
  },
  arrow: {
    marginHorizontal: 8,
  },
  emptyState: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 14,
    marginTop: 12,
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 11,
    marginBottom: 4,
  },
  statValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  actions: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    gap: 6,
  },
  clearButton: {
    backgroundColor: 'rgba(255, 82, 82, 0.1)',
    borderWidth: 1,
    borderColor: '#FF5252',
  },
  saveButton: {
    backgroundColor: '#FF6B35',
  },
  disabledButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  clearButtonText: {
    color: '#FF5252',
  },
  disabledText: {
    color: '#666',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pointMenu: {
    backgroundColor: '#2a2f3f',
    borderRadius: 12,
    minWidth: 200,
    overflow: 'hidden',
  },
  menuTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  menuItemText: {
    color: '#fff',
    fontSize: 14,
  },
  menuItemDanger: {
    color: '#FF5252',
  },
  editNameModal: {
    backgroundColor: '#2a2f3f',
    borderRadius: 12,
    padding: 20,
    width: '80%',
    maxWidth: 400,
  },
  editNameTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  nameInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 14,
    marginBottom: 16,
  },
  editNameActions: {
    flexDirection: 'row',
    gap: 12,
  },
  editNameButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  saveNameButton: {
    backgroundColor: '#FF6B35',
  },
  cancelButtonText: {
    color: '#999',
    fontSize: 14,
    fontWeight: '600',
  },
  saveNameButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});

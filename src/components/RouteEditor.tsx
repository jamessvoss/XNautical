/**
 * RouteEditor Component
 * 
 * Foreflight-style flight plan editor adapted for nautical use.
 * Shows route name, performance settings, route points, and statistics.
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
import { formatDistance, formatBearing, formatDuration, formatETA, formatFuel, calculateFuelConsumption } from '../services/routeService';
import { recalculateRoute } from '../utils/routeCalculations';
import type { RoutePoint, PerformanceMethod } from '../types/route';

interface RouteEditorProps {
  visible: boolean;
  onClose: () => void;
}

export default function RouteEditor({ visible, onClose }: RouteEditorProps) {
  const {
    activeRoute,
    removePointFromActiveRoute,
    updatePointInActiveRoute,
    updateActiveRouteMetadata,
    saveActiveRoute,
    clearActiveRoute,
  } = useRoutes();

  const [selectedPoint, setSelectedPoint] = useState<RoutePoint | null>(null);
  const [showPointMenu, setShowPointMenu] = useState(false);
  const [editingRouteName, setEditingRouteName] = useState(false);
  const [routeNameInput, setRouteNameInput] = useState('');
  const [editingPointName, setEditingPointName] = useState(false);
  const [pointNameInput, setPointNameInput] = useState('');
  const [editingCoordinate, setEditingCoordinate] = useState(false);
  const [latInput, setLatInput] = useState('');
  const [lonInput, setLonInput] = useState('');

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

  // Edit route name
  const handleEditRouteName = useCallback(() => {
    if (!activeRoute) return;
    setRouteNameInput(activeRoute.name);
    setEditingRouteName(true);
  }, [activeRoute]);

  // Save route name
  const handleSaveRouteName = useCallback(() => {
    if (!activeRoute) return;
    updateActiveRouteMetadata({ name: routeNameInput });
    setEditingRouteName(false);
  }, [activeRoute, routeNameInput, updateActiveRouteMetadata]);

  // Remove point
  const handleRemovePoint = useCallback(() => {
    if (!selectedPoint) return;
    
    Alert.alert(
      'Remove Point',
      `Remove ${selectedPoint.name} from route?`,
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
  const handleEditPointName = useCallback(() => {
    if (!selectedPoint) return;
    setPointNameInput(selectedPoint.name || '');
    setEditingPointName(true);
    setShowPointMenu(false);
  }, [selectedPoint]);

  // Save point name
  const handleSavePointName = useCallback(() => {
    if (!selectedPoint) return;
    updatePointInActiveRoute(selectedPoint.id, { name: pointNameInput });
    setEditingPointName(false);
    setSelectedPoint(null);
  }, [selectedPoint, pointNameInput, updatePointInActiveRoute]);

  // Edit coordinate
  const handleEditCoordinate = useCallback(() => {
    if (!selectedPoint) return;
    setLatInput(selectedPoint.position.latitude.toFixed(6));
    setLonInput(selectedPoint.position.longitude.toFixed(6));
    setEditingCoordinate(true);
    setShowPointMenu(false);
  }, [selectedPoint]);

  // Save coordinate
  const handleSaveCoordinate = useCallback(() => {
    if (!selectedPoint) return;
    
    const lat = parseFloat(latInput);
    const lon = parseFloat(lonInput);
    
    if (isNaN(lat) || lat < -90 || lat > 90) {
      Alert.alert('Error', 'Invalid latitude. Must be between -90 and 90.');
      return;
    }
    
    if (isNaN(lon) || lon < -180 || lon > 180) {
      Alert.alert('Error', 'Invalid longitude. Must be between -180 and 180.');
      return;
    }
    
    updatePointInActiveRoute(selectedPoint.id, {
      position: { latitude: lat, longitude: lon }
    });
    
    setEditingCoordinate(false);
    setSelectedPoint(null);
  }, [selectedPoint, latInput, lonInput, updatePointInActiveRoute]);

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
  
  // Calculate ETA
  const now = new Date();
  const eta = activeRoute.estimatedDuration 
    ? new Date(now.getTime() + activeRoute.estimatedDuration * 60000)
    : null;

  return (
    <View style={styles.container}>
      {/* Header with Route Name */}
      <TouchableOpacity style={styles.header} onPress={handleEditRouteName}>
        <Text style={styles.routeNameLabel}>Route</Text>
        <Text style={styles.routeName}>{activeRoute.name}</Text>
        <Ionicons name="pencil" size={16} color="rgba(255,255,255,0.5)" />
      </TouchableOpacity>

      {/* Performance Settings Row */}
      <View style={styles.performanceRow}>
        <TouchableOpacity style={styles.perfBox}>
          <Text style={styles.perfLabel}>Boat</Text>
          <Text style={styles.perfValue}>Default</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.perfBox}>
          <Text style={styles.perfLabel}>RPM</Text>
          <Text style={styles.perfValue}>--</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.perfBox}>
          <Text style={styles.perfLabel}>Speed</Text>
          <Text style={styles.perfValue}>{activeRoute.cruisingSpeed} kts</Text>
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
            <React.Fragment key={point.id}>
              {/* Route Point Bubble */}
              <TouchableOpacity
                style={[
                  styles.pointBubble,
                  point.waypointRef && styles.pointBubbleWaypoint,
                ]}
                onPress={() => handlePointPress(point)}
              >
                <Text style={styles.pointText}>{point.name}</Text>
              </TouchableOpacity>

              {/* Arrow to next point */}
              {index < activeRoute.routePoints.length - 1 && (
                <View style={styles.arrowContainer}>
                  <View style={styles.arrowLine} />
                  <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.3)" />
                </View>
              )}
            </React.Fragment>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Long-press map to add waypoints</Text>
        </View>
      )}

      {/* Route Statistics - Foreflight style */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Dist</Text>
          <Text style={styles.statValue}>
            {formatDistance(activeRoute.totalDistance, 1).replace(' nm', '')}
          </Text>
        </View>
        
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>ETE</Text>
          <Text style={styles.statValue}>
            {activeRoute.estimatedDuration 
              ? formatDuration(activeRoute.estimatedDuration)
              : '--'}
          </Text>
        </View>
        
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>ETA(CDT)</Text>
          <Text style={styles.statValue}>
            {eta ? `${eta.getHours() % 12 || 12}:${eta.getMinutes().toString().padStart(2, '0')} ${eta.getHours() >= 12 ? 'PM' : 'AM'}` : '--'}
          </Text>
        </View>
        
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Fuel</Text>
          <Text style={styles.statValue}>
            {activeRoute.estimatedFuel ? activeRoute.estimatedFuel.toFixed(1) : '--'}
          </Text>
        </View>
      </View>

      {/* Action Buttons Row */}
      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.iconButton}>
          <Ionicons name="globe-outline" size={24} color="#fff" />
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.iconButton}>
          <Ionicons name="home-outline" size={24} color="#fff" />
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.iconButton}>
          <Ionicons name="star-outline" size={24} color="#fff" />
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.iconButton}>
          <Ionicons name="share-outline" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Bottom Action Buttons */}
      <View style={styles.bottomActions}>
        <TouchableOpacity
          style={[styles.bottomButton, styles.editButton]}
          onPress={onClose}
        >
          <Text style={styles.bottomButtonText}>Edit</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.bottomButton, styles.navLogButton]}
          onPress={handleSaveRoute}
          disabled={!canSave}
        >
          <Text style={[styles.bottomButtonText, !canSave && styles.disabledText]}>
            Save
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
            {selectedPoint && (
              <>
                <Text style={styles.menuTitle}>{selectedPoint.name}</Text>
                <Text style={styles.menuSubtitle}>
                  {selectedPoint.position.latitude.toFixed(6)}°, {selectedPoint.position.longitude.toFixed(6)}°
                </Text>

                <TouchableOpacity style={styles.menuItem} onPress={handleEditPointName}>
                  <Ionicons name="pencil-outline" size={20} color="#fff" />
                  <Text style={styles.menuItemText}>Edit Name</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.menuItem} onPress={handleEditCoordinate}>
                  <Ionicons name="location-outline" size={20} color="#fff" />
                  <Text style={styles.menuItemText}>Edit GPS</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.menuItem} onPress={handleRemovePoint}>
                  <Ionicons name="trash-outline" size={20} color="#FF5252" />
                  <Text style={[styles.menuItemText, styles.menuItemDanger]}>Delete</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.menuItem} onPress={closePointMenu}>
                  <Ionicons name="close" size={20} color="#999" />
                  <Text style={[styles.menuItemText, { color: '#999' }]}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Edit Route Name Modal */}
      <Modal
        visible={editingRouteName}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingRouteName(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setEditingRouteName(false)}
        >
          <View style={styles.editModal}>
            <Text style={styles.editModalTitle}>Edit Route Name</Text>
            <TextInput
              style={styles.input}
              value={routeNameInput}
              onChangeText={setRouteNameInput}
              placeholder="Route name..."
              placeholderTextColor="#666"
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setEditingRouteName(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton]}
                onPress={handleSaveRouteName}
              >
                <Text style={styles.saveButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Edit Point Name Modal */}
      <Modal
        visible={editingPointName}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingPointName(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setEditingPointName(false)}
        >
          <View style={styles.editModal}>
            <Text style={styles.editModalTitle}>Edit Point Name</Text>
            <TextInput
              style={styles.input}
              value={pointNameInput}
              onChangeText={setPointNameInput}
              placeholder="Point name..."
              placeholderTextColor="#666"
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setEditingPointName(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton]}
                onPress={handleSavePointName}
              >
                <Text style={styles.saveButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Edit Coordinate Modal */}
      <Modal
        visible={editingCoordinate}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingCoordinate(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setEditingCoordinate(false)}
        >
          <View style={styles.editModal}>
            <Text style={styles.editModalTitle}>Edit GPS Coordinates</Text>
            <Text style={styles.inputLabel}>Latitude</Text>
            <TextInput
              style={styles.input}
              value={latInput}
              onChangeText={setLatInput}
              placeholder="-90 to 90"
              placeholderTextColor="#666"
              keyboardType="numeric"
            />
            <Text style={styles.inputLabel}>Longitude</Text>
            <TextInput
              style={styles.input}
              value={lonInput}
              onChangeText={setLonInput}
              placeholder="-180 to 180"
              placeholderTextColor="#666"
              keyboardType="numeric"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setEditingCoordinate(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton]}
                onPress={handleSaveCoordinate}
              >
                <Text style={styles.saveButtonText}>Save</Text>
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
    backgroundColor: '#1c2738',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    gap: 8,
  },
  routeNameLabel: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '600',
  },
  routeName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  performanceRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  perfBox: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  perfLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '600',
    marginBottom: 4,
  },
  perfValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  pointsList: {
    maxHeight: 80,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  pointsListContent: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  pointBubble: {
    backgroundColor: '#5b7fa8',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 50,
    alignItems: 'center',
  },
  pointBubbleWaypoint: {
    backgroundColor: '#4CAF50',
  },
  pointText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  arrowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  arrowLine: {
    width: 12,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  emptyState: {
    paddingVertical: 30,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  emptyText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 13,
  },
  statsRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '600',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  bottomActions: {
    flexDirection: 'row',
    gap: 1,
  },
  bottomButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editButton: {
    backgroundColor: '#2a3447',
  },
  navLogButton: {
    backgroundColor: '#2a3447',
  },
  bottomButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
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
    minWidth: 240,
    overflow: 'hidden',
  },
  menuTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    padding: 16,
    paddingBottom: 4,
  },
  menuSubtitle: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
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
  editModal: {
    backgroundColor: '#2a2f3f',
    borderRadius: 12,
    padding: 20,
    width: '80%',
    maxWidth: 400,
  },
  editModalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  inputLabel: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 14,
    marginBottom: 8,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  saveButton: {
    backgroundColor: '#FF6B35',
  },
  cancelButtonText: {
    color: '#999',
    fontSize: 14,
    fontWeight: '600',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});

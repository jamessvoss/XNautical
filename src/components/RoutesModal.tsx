/**
 * RoutesModal Component
 * 
 * Modal for viewing, loading, and managing saved routes.
 * Similar to WaypointManager but for routes.
 * 
 * Features:
 * - List all saved routes (cloud + local)
 * - Search/filter by name
 * - Tap to load route on map
 * - Swipe to delete
 * - Sort options
 * - Storage type indicator
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoutes } from '../contexts/RouteContext';
import { formatDistance, formatDuration, getRouteSummary } from '../services/routeService';
import type { Route } from '../types/route';

interface RoutesModalProps {
  visible: boolean;
  onClose: () => void;
  onRouteLoad?: (route: Route) => void;
}

type SortOption = 'name' | 'date' | 'distance';

export default function RoutesModal({ visible, onClose, onRouteLoad }: RoutesModalProps) {
  const { allRoutes, loadRoute, deleteRoute, duplicateRoute, startNavigation } = useRoutes();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('date');
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [showRouteMenu, setShowRouteMenu] = useState(false);

  // Filter routes by search query
  const filteredRoutes = useMemo(() => {
    let routes = allRoutes;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      routes = routes.filter(r =>
        r.name.toLowerCase().includes(query) ||
        r.notes.toLowerCase().includes(query)
      );
    }

    // Sort routes
    return [...routes].sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'date':
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        case 'distance':
          return b.totalDistance - a.totalDistance;
        default:
          return 0;
      }
    });
  }, [allRoutes, searchQuery, sortBy]);

  // Handle route tap
  const handleRoutePress = useCallback((route: Route) => {
    setSelectedRoute(route);
    setShowRouteMenu(true);
  }, []);

  // Close route menu
  const closeRouteMenu = useCallback(() => {
    setShowRouteMenu(false);
    setSelectedRoute(null);
  }, []);

  // Load route for editing
  const handleLoadRoute = useCallback(() => {
    if (!selectedRoute) return;
    loadRoute(selectedRoute);
    closeRouteMenu();
    onClose();
    if (onRouteLoad) onRouteLoad(selectedRoute);
  }, [selectedRoute, loadRoute, closeRouteMenu, onClose, onRouteLoad]);

  // Start navigation
  const handleStartNavigation = useCallback(() => {
    if (!selectedRoute) return;
    
    if (selectedRoute.routePoints.length < 2) {
      Alert.alert('Error', 'Route must have at least 2 points to navigate');
      return;
    }

    startNavigation(selectedRoute.id);
    closeRouteMenu();
    onClose();
  }, [selectedRoute, startNavigation, closeRouteMenu, onClose]);

  // Duplicate route
  const handleDuplicateRoute = useCallback(async () => {
    if (!selectedRoute) return;

    try {
      await duplicateRoute(selectedRoute);
      Alert.alert('Success', 'Route duplicated');
      closeRouteMenu();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to duplicate route');
    }
  }, [selectedRoute, duplicateRoute, closeRouteMenu]);

  // Delete route
  const handleDeleteRoute = useCallback(() => {
    if (!selectedRoute) return;

    Alert.alert(
      'Delete Route',
      `Delete "${selectedRoute.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteRoute(selectedRoute);
              closeRouteMenu();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete route');
            }
          },
        },
      ]
    );
  }, [selectedRoute, deleteRoute, closeRouteMenu]);

  // Get storage icon
  const getStorageIcon = (storageType: Route['storageType']) => {
    switch (storageType) {
      case 'cloud':
        return 'cloud';
      case 'local':
        return 'phone-portrait';
      case 'both':
        return 'sync';
      default:
        return 'help';
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>My Routes</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color="#999" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search routes..."
            placeholderTextColor="#666"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearSearch}>
              <Ionicons name="close-circle" size={20} color="#666" />
            </TouchableOpacity>
          )}
        </View>

        {/* Sort Options */}
        <View style={styles.sortContainer}>
          <Text style={styles.sortLabel}>Sort by:</Text>
          <TouchableOpacity
            style={[styles.sortButton, sortBy === 'date' && styles.sortButtonActive]}
            onPress={() => setSortBy('date')}
          >
            <Text style={[styles.sortButtonText, sortBy === 'date' && styles.sortButtonTextActive]}>
              Date
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sortButton, sortBy === 'name' && styles.sortButtonActive]}
            onPress={() => setSortBy('name')}
          >
            <Text style={[styles.sortButtonText, sortBy === 'name' && styles.sortButtonTextActive]}>
              Name
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sortButton, sortBy === 'distance' && styles.sortButtonActive]}
            onPress={() => setSortBy('distance')}
          >
            <Text style={[styles.sortButtonText, sortBy === 'distance' && styles.sortButtonTextActive]}>
              Distance
            </Text>
          </TouchableOpacity>
        </View>

        {/* Routes List */}
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {filteredRoutes.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="map-outline" size={64} color="rgba(255,255,255,0.2)" />
              <Text style={styles.emptyText}>
                {searchQuery ? 'No routes found' : 'No saved routes yet'}
              </Text>
              <Text style={styles.emptySubtext}>
                {searchQuery ? 'Try a different search' : 'Create a route to get started'}
              </Text>
            </View>
          ) : (
            filteredRoutes.map((route) => {
              const summary = getRouteSummary(route);
              return (
                <TouchableOpacity
                  key={route.id}
                  style={styles.routeCard}
                  onPress={() => handleRoutePress(route)}
                >
                  <View style={styles.routeHeader}>
                    <Text style={styles.routeName} numberOfLines={1}>
                      {route.name}
                    </Text>
                    <Ionicons
                      name={getStorageIcon(route.storageType)}
                      size={16}
                      color="rgba(255,255,255,0.5)"
                    />
                  </View>

                  <View style={styles.routeStats}>
                    <View style={styles.routeStat}>
                      <Ionicons name="location" size={14} color="#4FC3F7" />
                      <Text style={styles.routeStatText}>
                        {summary.pointCount} {summary.pointCount === 1 ? 'point' : 'points'}
                      </Text>
                    </View>
                    <View style={styles.routeStat}>
                      <Ionicons name="navigate" size={14} color="#4FC3F7" />
                      <Text style={styles.routeStatText}>
                        {formatDistance(summary.totalDistance, 1)}
                      </Text>
                    </View>
                    {summary.estimatedDuration > 0 && (
                      <View style={styles.routeStat}>
                        <Ionicons name="time" size={14} color="#4FC3F7" />
                        <Text style={styles.routeStatText}>
                          {formatDuration(summary.estimatedDuration)}
                        </Text>
                      </View>
                    )}
                  </View>

                  {route.notes && (
                    <Text style={styles.routeNotes} numberOfLines={2}>
                      {route.notes}
                    </Text>
                  )}

                  <Text style={styles.routeDate}>
                    Updated {new Date(route.updatedAt).toLocaleDateString()}
                  </Text>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>

        {/* Route Menu Modal */}
        <Modal
          visible={showRouteMenu}
          transparent
          animationType="fade"
          onRequestClose={closeRouteMenu}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={closeRouteMenu}
          >
            <View style={styles.routeMenu}>
              <Text style={styles.menuTitle}>{selectedRoute?.name}</Text>

              <TouchableOpacity style={styles.menuItem} onPress={handleLoadRoute}>
                <Ionicons name="pencil" size={20} color="#fff" />
                <Text style={styles.menuItemText}>Edit Route</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem} onPress={handleStartNavigation}>
                <Ionicons name="navigate" size={20} color="#4FC3F7" />
                <Text style={styles.menuItemText}>Start Navigation</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem} onPress={handleDuplicateRoute}>
                <Ionicons name="copy" size={20} color="#fff" />
                <Text style={styles.menuItemText}>Duplicate</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem} onPress={handleDeleteRoute}>
                <Ionicons name="trash" size={20} color="#FF5252" />
                <Text style={[styles.menuItemText, styles.menuItemDanger]}>Delete</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem} onPress={closeRouteMenu}>
                <Ionicons name="close" size={20} color="#999" />
                <Text style={[styles.menuItemText, { color: '#999' }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1f2e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  closeButton: {
    padding: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    marginHorizontal: 20,
    marginTop: 16,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    paddingVertical: 12,
  },
  clearSearch: {
    padding: 4,
  },
  sortContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 8,
  },
  sortLabel: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 14,
    marginRight: 4,
  },
  sortButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  sortButtonActive: {
    backgroundColor: '#FF6B35',
  },
  sortButtonText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 13,
    fontWeight: '600',
  },
  sortButtonTextActive: {
    color: '#fff',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 20,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  emptySubtext: {
    color: 'rgba(255, 255, 255, 0.3)',
    fontSize: 14,
    marginTop: 8,
  },
  routeCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  routeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  routeName: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginRight: 8,
  },
  routeStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 8,
  },
  routeStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  routeStatText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 13,
  },
  routeNotes: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 13,
    marginTop: 8,
    fontStyle: 'italic',
  },
  routeDate: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 11,
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  routeMenu: {
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
});

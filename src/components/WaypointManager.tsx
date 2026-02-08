/**
 * WaypointManager
 * 
 * Full management panel for waypoints, shown in the Context tab.
 * Features: list all waypoints, bulk select/delete, edit, and manual creation.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useWaypoints } from '../contexts/WaypointContext';
import { Waypoint } from '../types/waypoint';
import { getCategoryConfig, WaypointMapPin } from './WaypointIcons';
import { getPhotoDisplayUri } from '../services/waypointPhotoService';

export default function WaypointManager() {
  const {
    waypoints,
    loading,
    deleteWaypoint,
    deleteWaypoints,
    openCreationModal,
    openEditModal,
  } = useWaypoints();

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(waypoints.map(w => w.id)));
  }, [waypoints]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleBulkDelete = useCallback(() => {
    if (selectedIds.size === 0) return;

    Alert.alert(
      'Delete Waypoints',
      `Are you sure you want to delete ${selectedIds.size} waypoint${selectedIds.size > 1 ? 's' : ''}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteWaypoints(Array.from(selectedIds));
            exitSelectionMode();
          },
        },
      ],
    );
  }, [selectedIds, deleteWaypoints, exitSelectionMode]);

  const handleDeleteSingle = useCallback((waypoint: Waypoint) => {
    Alert.alert(
      'Delete Waypoint',
      `Delete "${waypoint.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteWaypoint(waypoint.id),
        },
      ],
    );
  }, [deleteWaypoint]);

  const handleManualCreate = useCallback(() => {
    // Open creation modal with empty coordinates (user will enter manually)
    openCreationModal(0, 0);
  }, [openCreationModal]);

  const formatCoord = (lat: number, lng: number): string => {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lngDir = lng >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(4)}°${latDir}  ${Math.abs(lng).toFixed(4)}°${lngDir}`;
  };

  const formatDate = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  };

  const renderWaypoint = useCallback(({ item }: { item: Waypoint }) => {
    const config = getCategoryConfig(item.category);
    const isSelected = selectedIds.has(item.id);
    const hasPhotos = item.photos && item.photos.length > 0;

    return (
      <TouchableOpacity
        style={[styles.waypointRow, isSelected && styles.waypointRowSelected]}
        onPress={() => {
          if (selectionMode) {
            toggleSelection(item.id);
          } else {
            openEditModal(item);
          }
        }}
        onLongPress={() => {
          if (!selectionMode) {
            setSelectionMode(true);
            setSelectedIds(new Set([item.id]));
          }
        }}
        activeOpacity={0.7}
      >
        {/* Selection checkbox */}
        {selectionMode && (
          <View style={styles.checkboxContainer}>
            <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
              {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
            </View>
          </View>
        )}

        {/* Pin icon */}
        <View style={styles.pinContainer}>
          <WaypointMapPin category={item.category} color={item.color} size={28} />
        </View>

        {/* Info */}
        <View style={styles.infoContainer}>
          <Text style={styles.waypointName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.waypointCoords}>{formatCoord(item.latitude, item.longitude)}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.waypointCategory}>{config.name}</Text>
            <Text style={styles.waypointDate}>{formatDate(item.createdAt)}</Text>
          </View>
          {item.notes ? (
            <Text style={styles.waypointNotes} numberOfLines={1}>{item.notes}</Text>
          ) : null}
        </View>

        {/* Photo thumbnail */}
        {hasPhotos && (
          <Image
            source={{ uri: getPhotoDisplayUri(item.photos[0]) }}
            style={styles.thumbImage}
          />
        )}

        {/* Delete button (non-selection mode) */}
        {!selectionMode && (
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleDeleteSingle(item)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="trash-outline" size={18} color="rgba(255,255,255,0.3)" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  }, [selectionMode, selectedIds, toggleSelection, openEditModal, handleDeleteSingle]);

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="location-outline" size={48} color="rgba(255,255,255,0.2)" />
      <Text style={styles.emptyTitle}>No Waypoints</Text>
      <Text style={styles.emptySubtext}>
        Long-press on the map to create a waypoint,{'\n'}or tap "Add New" above.
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Toolbar */}
      <View style={styles.toolbar}>
        {selectionMode ? (
          <>
            <TouchableOpacity onPress={exitSelectionMode} style={styles.toolbarButton}>
              <Text style={styles.toolbarButtonText}>Done</Text>
            </TouchableOpacity>
            <Text style={styles.toolbarInfo}>
              {selectedIds.size} selected
            </Text>
            <View style={styles.toolbarActions}>
              <TouchableOpacity
                onPress={selectedIds.size === waypoints.length ? deselectAll : selectAll}
                style={styles.toolbarButton}
              >
                <Text style={styles.toolbarButtonText}>
                  {selectedIds.size === waypoints.length ? 'Deselect All' : 'Select All'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleBulkDelete}
                style={[styles.toolbarButton, selectedIds.size === 0 && styles.toolbarButtonDisabled]}
                disabled={selectedIds.size === 0}
              >
                <Ionicons name="trash" size={18} color={selectedIds.size > 0 ? '#FF5252' : 'rgba(255,255,255,0.2)'} />
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.waypointCount}>
              {waypoints.length} waypoint{waypoints.length !== 1 ? 's' : ''}
            </Text>
            <View style={styles.toolbarActions}>
              {waypoints.length > 0 && (
                <TouchableOpacity
                  onPress={() => setSelectionMode(true)}
                  style={styles.toolbarButton}
                >
                  <Text style={styles.toolbarButtonText}>Select</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={handleManualCreate} style={styles.addButton}>
                <Ionicons name="add" size={20} color="#fff" />
                <Text style={styles.addButtonText}>Add New</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {/* Waypoint List */}
      <FlatList
        data={waypoints}
        keyExtractor={(item) => item.id}
        renderItem={renderWaypoint}
        ListEmptyComponent={loading ? null : renderEmpty}
        contentContainerStyle={waypoints.length === 0 ? styles.emptyList : undefined}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1f2e',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  toolbarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toolbarButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  toolbarButtonText: {
    fontSize: 14,
    color: '#4FC3F7',
    fontWeight: '500',
  },
  toolbarButtonDisabled: {
    opacity: 0.4,
  },
  toolbarInfo: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
  },
  waypointCount: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(79, 195, 247, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(79, 195, 247, 0.3)',
    gap: 4,
  },
  addButtonText: {
    fontSize: 13,
    color: '#4FC3F7',
    fontWeight: '600',
  },
  waypointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  waypointRowSelected: {
    backgroundColor: 'rgba(79, 195, 247, 0.08)',
  },
  checkboxContainer: {
    marginRight: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#4FC3F7',
    borderColor: '#4FC3F7',
  },
  pinContainer: {
    marginRight: 12,
    width: 36,
    alignItems: 'center',
  },
  infoContainer: {
    flex: 1,
    marginRight: 8,
  },
  waypointName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 2,
  },
  waypointCoords: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    fontFamily: 'Menlo',
    marginBottom: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  waypointCategory: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '500',
  },
  waypointDate: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
  },
  waypointNotes: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    fontStyle: 'italic',
    marginTop: 2,
  },
  thumbImage: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginRight: 8,
  },
  deleteButton: {
    padding: 8,
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginLeft: 64,
  },
  emptyList: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
    marginTop: 12,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.3)',
    textAlign: 'center',
    lineHeight: 20,
  },
});

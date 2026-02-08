/**
 * ScratchPadListView
 *
 * Grid view of saved scratchpad thumbnails, matching ForeFlight's layout.
 * Shows 3 columns of cards with thumbnail previews, date/time bars, an
 * "Edit" button for deletion, and a "New Scratchpad" card.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Dimensions,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as scratchPadService from '../services/scratchPadService';
import type { ScratchPadMeta } from '../types/scratchPad';
import ScratchPadEditor from './ScratchPadEditor';

const NUM_COLUMNS = 3;
const CARD_GAP = 10;
const HORIZONTAL_PADDING = 12;

function getCardWidth(): number {
  const screenWidth = Dimensions.get('window').width;
  return (screenWidth - HORIZONTAL_PADDING * 2 - CARD_GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;
}

/** Format a date string for the card footer. */
function formatDate(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear().toString().slice(-2);
  const hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  return {
    date: `${month}/${day}/${year}`,
    time: `${h}:${minutes}${ampm}`,
  };
}

/** Sentinel item representing the "New Scratchpad" card. */
const NEW_PAD_SENTINEL: ScratchPadMeta = {
  id: '__new__',
  createdAt: '',
  updatedAt: '',
};

export default function ScratchPadListView() {
  const [pads, setPads] = useState<ScratchPadMeta[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingPadId, setEditingPadId] = useState<string | null>(null);
  const cardWidth = getCardWidth();
  const cardHeight = cardWidth * 1.35;

  // Load pads list
  const loadPads = useCallback(async () => {
    setLoading(true);
    try {
      const list = await scratchPadService.listPads();
      setPads(list);

      // Load thumbnails in parallel
      const thumbMap: Record<string, string | null> = {};
      await Promise.all(
        list.map(async (meta) => {
          thumbMap[meta.id] = await scratchPadService.getThumbnailUri(meta.id);
        }),
      );
      setThumbnails(thumbMap);
    } catch (e) {
      console.error('[ScratchPadListView] Failed to load pads', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPads();
  }, [loadPads]);

  // Reload when editor closes
  const handleEditorClose = useCallback(() => {
    setEditorVisible(false);
    setEditingPadId(null);
    loadPads();
  }, [loadPads]);

  const handleNewPad = useCallback(() => {
    setEditingPadId(null); // null = new pad
    setEditorVisible(true);
  }, []);

  const handleOpenPad = useCallback((id: string) => {
    if (editMode) return;
    setEditingPadId(id);
    setEditorVisible(true);
  }, [editMode]);

  const handleDeletePad = useCallback((id: string) => {
    Alert.alert(
      'Delete Scratchpad',
      'Are you sure you want to delete this scratchpad?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await scratchPadService.deletePad(id);
            loadPads();
          },
        },
      ],
    );
  }, [loadPads]);

  // Build data: pads + new pad sentinel
  const data = [...pads, NEW_PAD_SENTINEL];

  const renderItem = ({ item }: { item: ScratchPadMeta }) => {
    // "New Scratchpad" card
    if (item.id === '__new__') {
      return (
        <TouchableOpacity
          style={[styles.card, { width: cardWidth, height: cardHeight }]}
          onPress={handleNewPad}
          activeOpacity={0.7}
        >
          <View style={styles.newPadContent}>
            <Ionicons name="add" size={40} color="rgba(255, 255, 255, 0.5)" />
            <Text style={styles.newPadText}>NEW{'\n'}SCRATCHPAD</Text>
          </View>
        </TouchableOpacity>
      );
    }

    const thumb = thumbnails[item.id];
    const { date, time } = formatDate(item.updatedAt || item.createdAt);

    return (
      <TouchableOpacity
        style={[styles.card, { width: cardWidth, height: cardHeight }]}
        onPress={() => handleOpenPad(item.id)}
        activeOpacity={0.7}
      >
        {/* Thumbnail */}
        <View style={styles.thumbnailContainer}>
          {thumb ? (
            <Image
              source={{ uri: thumb }}
              style={styles.thumbnail}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.thumbnailPlaceholder} />
          )}
        </View>

        {/* Date bar */}
        <View style={styles.dateBar}>
          <Text style={styles.dateText}>{date}</Text>
          <Text style={styles.timeText}>{time}</Text>
        </View>

        {/* Delete badge in edit mode */}
        {editMode && (
          <TouchableOpacity
            style={styles.deleteBadge}
            onPress={() => handleDeletePad(item.id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-circle" size={24} color="#FF3B30" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4FC3F7" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header row */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setEditMode(!editMode)}>
          <Text style={[styles.headerButton, editMode && styles.headerButtonActive]}>
            {editMode ? 'Done' : 'Edit'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleNewPad}>
          <Ionicons name="add" size={28} color="#4FC3F7" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={data}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        numColumns={NUM_COLUMNS}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.row}
        showsVerticalScrollIndicator={false}
        onRefresh={loadPads}
        refreshing={loading}
      />

      {/* Editor modal */}
      {editorVisible && (
        <ScratchPadEditor
          padId={editingPadId}
          onClose={handleEditorClose}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: HORIZONTAL_PADDING + 4,
    paddingVertical: 10,
  },
  headerButton: {
    fontSize: 16,
    color: '#4FC3F7',
    fontWeight: '500',
  },
  headerButtonActive: {
    fontWeight: '700',
  },
  grid: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingBottom: 20,
  },
  row: {
    gap: CARD_GAP,
    marginBottom: CARD_GAP,
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },
  thumbnailContainer: {
    flex: 1,
  },
  thumbnail: {
    flex: 1,
    width: '100%',
  },
  thumbnailPlaceholder: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  dateBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(79, 195, 247, 0.25)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  dateText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4FC3F7',
  },
  timeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4FC3F7',
  },
  newPadContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  newPadText: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  deleteBadge: {
    position: 'absolute',
    top: -4,
    left: -4,
    zIndex: 10,
    backgroundColor: '#1a1f2e',
    borderRadius: 12,
  },
});

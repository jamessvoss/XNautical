/**
 * WaypointIcons - Category configuration and marker components
 * 
 * Phase 1: Colored pin markers with short category labels.
 * Phase 2: Swap for custom-designed PNG icon assets (no data model changes needed).
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WaypointCategory } from '../types/waypoint';

/** Configuration for each waypoint category */
export interface CategoryConfig {
  id: WaypointCategory;
  name: string;
  shortLabel: string; // 2-3 letter label for map pin
  defaultColor: string;
  icon: keyof typeof Ionicons.glyphMap; // Temporary icon for picker UI
  group: 'General' | 'Fish';
}

/** All waypoint categories with their display configuration */
export const WAYPOINT_CATEGORIES: CategoryConfig[] = [
  // General
  { id: 'general',    name: 'General',    shortLabel: 'GEN', defaultColor: '#4FC3F7', icon: 'location-sharp', group: 'General' },
  
  // Fish / Species
  { id: 'salmon',     name: 'Salmon',     shortLabel: 'SAL', defaultColor: '#FF6B6B', icon: 'fish',           group: 'Fish' },
  { id: 'halibut',    name: 'Halibut',    shortLabel: 'HAL', defaultColor: '#D4A574', icon: 'fish',           group: 'Fish' },
  { id: 'rockfish',   name: 'Rockfish',   shortLabel: 'ROK', defaultColor: '#FF8A65', icon: 'fish',           group: 'Fish' },
  { id: 'lingcod',    name: 'Lingcod',    shortLabel: 'LIN', defaultColor: '#81C784', icon: 'fish',           group: 'Fish' },
  { id: 'crab',       name: 'Crab',       shortLabel: 'CRB', defaultColor: '#E57373', icon: 'fish',           group: 'Fish' },
  { id: 'shrimp',     name: 'Shrimp',     shortLabel: 'SHR', defaultColor: '#F48FB1', icon: 'fish',           group: 'Fish' },
  { id: 'tuna',       name: 'Tuna',       shortLabel: 'TUN', defaultColor: '#64B5F6', icon: 'fish',           group: 'Fish' },
  { id: 'trout',      name: 'Trout',      shortLabel: 'TRT', defaultColor: '#AED581', icon: 'fish',           group: 'Fish' },
  { id: 'cod',        name: 'Cod',        shortLabel: 'COD', defaultColor: '#B0BEC5', icon: 'fish',           group: 'Fish' },
  { id: 'sablefish',  name: 'Sablefish',  shortLabel: 'SAB', defaultColor: '#78909C', icon: 'fish',           group: 'Fish' },
  { id: 'shark',      name: 'Shark',      shortLabel: 'SHK', defaultColor: '#90A4AE', icon: 'fish',           group: 'Fish' },
  { id: 'bottomfish', name: 'Bottomfish', shortLabel: 'BTM', defaultColor: '#A1887F', icon: 'fish',           group: 'Fish' },
];

/** Lookup a category config by ID */
export function getCategoryConfig(category: WaypointCategory): CategoryConfig {
  return WAYPOINT_CATEGORIES.find(c => c.id === category) || WAYPOINT_CATEGORIES[0];
}

/** Get the default color for a category */
export function getDefaultColor(category: WaypointCategory): string {
  return getCategoryConfig(category).defaultColor;
}

// ─── Map Pin Component ───────────────────────────────────────────────────────

interface WaypointMapPinProps {
  category: WaypointCategory;
  color: string;
  size?: number;
  selected?: boolean;
}

/**
 * Colored teardrop-shaped map pin with category label.
 * Rendered inside MapLibre MarkerView for each waypoint.
 */
export function WaypointMapPin({ category, color, size = 36, selected = false }: WaypointMapPinProps) {
  const config = getCategoryConfig(category);
  const pinSize = selected ? size * 1.2 : size;
  const fontSize = pinSize * 0.28;

  return (
    <View style={[pinStyles.container, { width: pinSize, height: pinSize * 1.3 }]}>
      {/* Pin body */}
      <View
        style={[
          pinStyles.pinBody,
          {
            width: pinSize,
            height: pinSize,
            borderRadius: pinSize / 2,
            backgroundColor: color,
            borderColor: selected ? '#fff' : 'rgba(0,0,0,0.3)',
            borderWidth: selected ? 2.5 : 1.5,
          },
        ]}
      >
        <Text
          style={[
            pinStyles.label,
            { fontSize, color: '#fff' },
          ]}
          numberOfLines={1}
        >
          {config.shortLabel}
        </Text>
      </View>
      {/* Pin tail */}
      <View
        style={[
          pinStyles.pinTail,
          {
            borderTopColor: color,
            borderLeftWidth: pinSize * 0.2,
            borderRightWidth: pinSize * 0.2,
            borderTopWidth: pinSize * 0.35,
          },
        ]}
      />
    </View>
  );
}

const pinStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  pinBody: {
    justifyContent: 'center',
    alignItems: 'center',
    // Shadow for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  label: {
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  pinTail: {
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -2,
  },
});

// ─── Category Picker Component ───────────────────────────────────────────────

interface WaypointCategoryPickerProps {
  selected: WaypointCategory;
  selectedColor: string;
  onSelect: (category: WaypointCategory, defaultColor: string) => void;
}

/**
 * Grid of category options for the creation/edit modal.
 * Shows colored circles with category names, grouped by General and Fish.
 */
export function WaypointCategoryPicker({ selected, selectedColor, onSelect }: WaypointCategoryPickerProps) {
  const generalCategories = WAYPOINT_CATEGORIES.filter(c => c.group === 'General');
  const fishCategories = WAYPOINT_CATEGORIES.filter(c => c.group === 'Fish');

  const renderCategory = (config: CategoryConfig) => {
    const isSelected = selected === config.id;
    return (
      <TouchableOpacity
        key={config.id}
        style={[
          pickerStyles.categoryItem,
          isSelected && pickerStyles.categoryItemSelected,
        ]}
        onPress={() => onSelect(config.id, config.defaultColor)}
        activeOpacity={0.7}
      >
        <View
          style={[
            pickerStyles.colorCircle,
            {
              backgroundColor: isSelected ? selectedColor : config.defaultColor,
              borderColor: isSelected ? '#fff' : 'rgba(255,255,255,0.2)',
            },
          ]}
        >
          <Ionicons
            name={config.icon}
            size={18}
            color="#fff"
          />
        </View>
        <Text
          style={[
            pickerStyles.categoryName,
            isSelected && pickerStyles.categoryNameSelected,
          ]}
          numberOfLines={1}
        >
          {config.name}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView style={pickerStyles.container} bounces={false}>
      <Text style={pickerStyles.groupHeader}>GENERAL</Text>
      <View style={pickerStyles.grid}>
        {generalCategories.map(renderCategory)}
      </View>

      <Text style={pickerStyles.groupHeader}>FISH &amp; SPECIES</Text>
      <View style={pickerStyles.grid}>
        {fishCategories.map(renderCategory)}
      </View>
    </ScrollView>
  );
}

// ─── Color Picker Component ──────────────────────────────────────────────────

const PRESET_COLORS = [
  '#4FC3F7', // Cyan
  '#FF6B6B', // Coral red
  '#81C784', // Green
  '#FFB74D', // Orange
  '#BA68C8', // Purple
  '#FF8A65', // Deep orange
  '#64B5F6', // Blue
  '#F48FB1', // Pink
  '#D4A574', // Sandy brown
  '#A1887F', // Warm brown
  '#90A4AE', // Blue grey
  '#AED581', // Light green
  '#E57373', // Red
  '#78909C', // Dark grey
  '#FFD54F', // Amber
  '#4DB6AC', // Teal
];

interface WaypointColorPickerProps {
  selected: string;
  onSelect: (color: string) => void;
}

export function WaypointColorPicker({ selected, onSelect }: WaypointColorPickerProps) {
  return (
    <View style={colorPickerStyles.container}>
      {PRESET_COLORS.map((color) => {
        const isSelected = selected.toLowerCase() === color.toLowerCase();
        return (
          <TouchableOpacity
            key={color}
            style={[
              colorPickerStyles.swatch,
              { backgroundColor: color },
              isSelected && colorPickerStyles.swatchSelected,
            ]}
            onPress={() => onSelect(color)}
            activeOpacity={0.7}
          />
        );
      })}
    </View>
  );
}

const pickerStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  groupHeader: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  categoryItem: {
    alignItems: 'center',
    width: 72,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  categoryItemSelected: {
    backgroundColor: 'rgba(79, 195, 247, 0.15)',
    borderColor: 'rgba(79, 195, 247, 0.4)',
  },
  colorCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    marginBottom: 4,
  },
  categoryName: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  categoryNameSelected: {
    color: '#4FC3F7',
    fontWeight: '600',
  },
});

const colorPickerStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  swatchSelected: {
    borderColor: '#fff',
    borderWidth: 3,
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
});

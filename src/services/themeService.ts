/**
 * S-52 Theme Service
 * 
 * Implements IHO S-52 color standards for ECDIS displays.
 * Provides DAY, DUSK, and NIGHT color modes per the S-52 specification.
 * 
 * S-52 Color Design Principles:
 * - DAY: White/light background with dark foreground (optimized for bright sunlight)
 * - DUSK: Black background with light foreground (usable day or twilight)
 * - NIGHT: Very dim black background, strict luminance limits (preserves night vision)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// S-52 Display Modes
export type S52DisplayMode = 'day' | 'dusk' | 'night';

// S-52 Color Token Names (based on S-52 Presentation Library)
export type S52ColorToken = 
  // Depth zone colors
  | 'DEPDW'   // Deep water (deeper than safety contour)
  | 'DEPMD'   // Medium deep water
  | 'DEPMS'   // Medium shallow water
  | 'DEPVS'   // Very shallow water
  | 'DEPIT'   // Intertidal area
  // Land colors
  | 'LANDA'   // Land in general
  | 'LANDF'   // Land features (landmarks)
  | 'CHBRN'   // Built-up areas
  // Chart infrastructure
  | 'NODTA'   // No data area
  | 'CHBLK'   // Chart black (main lines)
  | 'CHGRD'   // Chart grid/graticule
  | 'CHGRF'   // Chart gray fill
  | 'CHWHT'   // Chart white
  | 'SNDG1'   // Soundings (safe depth)
  | 'SNDG2'   // Soundings (unsafe depth)
  // Aids to navigation
  | 'LITRD'   // Light red
  | 'LITGN'   // Light green
  | 'LITYW'   // Light yellow/white
  | 'RADHI'   // Radar high intensity
  | 'RADLO'   // Radar low intensity
  // Traffic/regulatory
  | 'TRFCD'   // Traffic control dominant
  | 'TRFCF'   // Traffic control faint
  | 'RESBL'   // Restricted area blue
  | 'RESGR'   // Restricted area gray
  // Danger highlighting
  | 'DNGHL'   // Danger highlight
  | 'CSTLN'   // Coastline
  // UI colors
  | 'UIBCK'   // UI background
  | 'UIBDR'   // UI border
  | 'UINFF'   // UI info faint
  | 'UINFD'   // UI info dominant (important)
  | 'APTS1'   // Attention point symbol 1
  | 'APTS2'   // Attention point symbol 2
  // Text colors
  | 'CHCOR'   // Chart correction (orange)
  | 'NINFO'   // Navigator info (orange)
  | 'APTS3'   // Attention point symbol 3
  // Water features
  | 'WATRW'   // Waterway
  // Road colors
  | 'ROADF'   // Road fill
  | 'ROADC'   // Road casing
  // Mariner data
  | 'MARINER' // Mariner's data
  | 'ROUTE'   // Route line
  | 'OWNSH';  // Own ship

// RGB Color type
interface RGBColor {
  r: number;
  g: number;
  b: number;
}

// S-52 Color Tables
// Values approximated from S-52 Presentation Library color specifications
// CIE coordinates converted to RGB for display use
const S52_COLOR_TABLES: Record<S52DisplayMode, Record<S52ColorToken, string>> = {
  // DAY mode - white/light backgrounds for bright sunlight viewing
  day: {
    // Depth zones (light backgrounds)
    DEPDW: '#FFFFFF',   // Deep water - white
    DEPMD: '#E6F0F5',   // Medium deep - pale blue
    DEPMS: '#C0D8E8',   // Medium shallow - light blue
    DEPVS: '#A0C8D8',   // Very shallow - cyan-blue
    DEPIT: '#A8D8C0',   // Intertidal - green-gray
    // Land
    LANDA: '#F0EDE9',   // Land - tan/beige
    LANDF: '#D4C4A8',   // Land features - darker tan
    CHBRN: '#E8D8C8',   // Built-up - light brown
    // Chart infrastructure
    NODTA: '#D0D0D0',   // No data - light gray
    CHBLK: '#000000',   // Chart black
    CHGRD: '#C8C8C8',   // Grid - light gray
    CHGRF: '#E0E0E0',   // Gray fill
    CHWHT: '#FFFFFF',   // White
    SNDG1: '#000000',   // Soundings safe - black
    SNDG2: '#000000',   // Soundings unsafe - black (bold)
    // Aids to navigation
    LITRD: '#FF0000',   // Red light
    LITGN: '#00AA00',   // Green light
    LITYW: '#FFD700',   // Yellow/white light
    RADHI: '#00FF00',   // Radar high
    RADLO: '#008800',   // Radar low
    // Traffic/regulatory
    TRFCD: '#C000C0',   // Traffic dominant - magenta
    TRFCF: '#E0C0E0',   // Traffic faint - pale magenta
    RESBL: '#8080FF',   // Restricted blue
    RESGR: '#A0A0A0',   // Restricted gray
    // Danger
    DNGHL: '#FF00FF',   // Danger highlight - magenta
    CSTLN: '#000000',   // Coastline - black
    // UI colors
    UIBCK: '#F5F5F5',   // UI background - near white
    UIBDR: '#C0C0C0',   // UI border - gray
    UINFF: '#808080',   // UI info faint
    UINFD: '#FF4040',   // UI info dominant - red
    APTS1: '#FF0000',   // Attention 1 - red
    APTS2: '#FF8000',   // Attention 2 - orange
    APTS3: '#FFFF00',   // Attention 3 - yellow
    // Text
    CHCOR: '#FF8000',   // Chart correction - orange
    NINFO: '#FF8000',   // Navigator info - orange
    // Water
    WATRW: '#A0CFE8',   // Waterway - blue
    // Roads
    ROADF: '#FFFFFF',   // Road fill - white
    ROADC: '#808080',   // Road casing - gray
    // Mariner
    MARINER: '#FF8000', // Mariner data - orange
    ROUTE: '#C00000',   // Route - dark red
    OWNSH: '#FF8000',   // Own ship - orange
  },

  // DUSK mode - black backgrounds, usable day or twilight
  dusk: {
    // Depth zones (dark backgrounds)
    DEPDW: '#1A1A2E',   // Deep water - very dark blue-gray
    DEPMD: '#2A3A4E',   // Medium deep - dark blue
    DEPMS: '#3A4A5E',   // Medium shallow - medium dark blue
    DEPVS: '#4A5A6E',   // Very shallow - lighter dark blue
    DEPIT: '#3A4A3E',   // Intertidal - dark green-gray
    // Land
    LANDA: '#2A2820',   // Land - dark brown
    LANDF: '#3A3828',   // Land features - slightly lighter
    CHBRN: '#3A3530',   // Built-up - dark brown-gray
    // Chart infrastructure
    NODTA: '#252530',   // No data - dark gray
    CHBLK: '#E0E0E0',   // Chart lines - light gray (inverted)
    CHGRD: '#505060',   // Grid - medium gray
    CHGRF: '#353540',   // Gray fill
    CHWHT: '#E0E0E0',   // White (text, symbols)
    SNDG1: '#C0C0C0',   // Soundings safe - light gray
    SNDG2: '#FFFFFF',   // Soundings unsafe - white (bold)
    // Aids to navigation
    LITRD: '#FF4040',   // Red light - brighter for dark bg
    LITGN: '#40FF40',   // Green light
    LITYW: '#FFFF40',   // Yellow light
    RADHI: '#00FF00',   // Radar high
    RADLO: '#008800',   // Radar low
    // Traffic/regulatory
    TRFCD: '#FF80FF',   // Traffic dominant - light magenta
    TRFCF: '#804080',   // Traffic faint - dim magenta
    RESBL: '#6060C0',   // Restricted blue
    RESGR: '#606060',   // Restricted gray
    // Danger
    DNGHL: '#FF80FF',   // Danger highlight
    CSTLN: '#C0C080',   // Coastline - tan
    // UI colors
    UIBCK: '#1A1A25',   // UI background - very dark
    UIBDR: '#404050',   // UI border
    UINFF: '#606070',   // UI info faint
    UINFD: '#FF6060',   // UI info dominant
    APTS1: '#FF4040',   // Attention 1
    APTS2: '#FFA040',   // Attention 2
    APTS3: '#FFFF40',   // Attention 3
    // Text
    CHCOR: '#FFA040',   // Chart correction
    NINFO: '#FFA040',   // Navigator info
    // Water
    WATRW: '#4A6080',   // Waterway - dark blue
    // Roads
    ROADF: '#808080',   // Road fill - gray
    ROADC: '#404040',   // Road casing
    // Mariner
    MARINER: '#FFA040', // Mariner data
    ROUTE: '#FF4040',   // Route - red
    OWNSH: '#FFA040',   // Own ship
  },

  // NIGHT mode - very dim, preserves night vision
  // Per S-52: maximum luminance of area color is 1.3 cd/sq.m
  night: {
    // Depth zones (very dark, minimal luminance)
    DEPDW: '#0A0A10',   // Deep water - near black
    DEPMD: '#101018',   // Medium deep
    DEPMS: '#181820',   // Medium shallow
    DEPVS: '#202028',   // Very shallow
    DEPIT: '#181818',   // Intertidal
    // Land
    LANDA: '#141410',   // Land - very dark
    LANDF: '#1C1C14',   // Land features
    CHBRN: '#1A1818',   // Built-up
    // Chart infrastructure
    NODTA: '#101014',   // No data
    CHBLK: '#606060',   // Chart lines - dim gray
    CHGRD: '#282830',   // Grid - very dim
    CHGRF: '#181820',   // Gray fill
    CHWHT: '#606060',   // White - dimmed
    SNDG1: '#505050',   // Soundings safe - dim
    SNDG2: '#707070',   // Soundings unsafe - slightly brighter
    // Aids to navigation (can be brighter - point sources)
    LITRD: '#800000',   // Red light - dim
    LITGN: '#008000',   // Green light - dim
    LITYW: '#806000',   // Yellow light - dim
    RADHI: '#004000',   // Radar high - dim
    RADLO: '#002000',   // Radar low - very dim
    // Traffic/regulatory
    TRFCD: '#602060',   // Traffic dominant - dim magenta
    TRFCF: '#301030',   // Traffic faint - very dim
    RESBL: '#303060',   // Restricted blue
    RESGR: '#303030',   // Restricted gray
    // Danger (can be slightly brighter for safety)
    DNGHL: '#803080',   // Danger highlight - dim magenta
    CSTLN: '#504830',   // Coastline - dim tan
    // UI colors (minimal light emission)
    UIBCK: '#0A0A0E',   // UI background - near black
    UIBDR: '#202028',   // UI border - very dim
    UINFF: '#303038',   // UI info faint
    UINFD: '#602020',   // UI info dominant - dim red
    APTS1: '#600000',   // Attention 1 - dim red
    APTS2: '#603000',   // Attention 2 - dim orange
    APTS3: '#606000',   // Attention 3 - dim yellow
    // Text
    CHCOR: '#603000',   // Chart correction
    NINFO: '#603000',   // Navigator info
    // Water
    WATRW: '#202838',   // Waterway - very dark blue
    // Roads
    ROADF: '#303030',   // Road fill
    ROADC: '#181818',   // Road casing
    // Mariner
    MARINER: '#603000', // Mariner data
    ROUTE: '#600000',   // Route - dim red
    OWNSH: '#803000',   // Own ship - dim orange
  },
};

// UI Theme colors (for app interface elements)
export interface UITheme {
  // Backgrounds
  panelBackground: string;
  panelBackgroundSolid: string;
  cardBackground: string;
  overlayBackground: string;
  mapBackground: string;
  
  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textOnAccent: string;
  
  // Borders and dividers
  border: string;
  divider: string;
  
  // Interactive elements
  buttonBackground: string;
  buttonBackgroundActive: string;
  buttonText: string;
  buttonTextActive: string;
  
  // Accents
  accentPrimary: string;
  accentSecondary: string;
  accentSuccess: string;
  accentWarning: string;
  accentDanger: string;
  
  // Tab bar
  tabBackground: string;
  tabBackgroundActive: string;
  tabText: string;
  tabTextActive: string;
  
  // Slider
  sliderTrack: string;
  sliderTrackActive: string;
  sliderThumb: string;
  
  // Status
  statusOnline: string;
  statusOffline: string;
  statusWarning: string;
}

// UI Theme definitions for each mode
const UI_THEMES: Record<S52DisplayMode, UITheme> = {
  day: {
    // Backgrounds - light
    panelBackground: 'rgba(255, 255, 255, 0.95)',
    panelBackgroundSolid: '#FFFFFF',
    cardBackground: '#F8F8F8',
    overlayBackground: 'rgba(255, 255, 255, 0.9)',
    mapBackground: '#F0F0F0',
    
    // Text - dark
    textPrimary: '#1A1A1A',
    textSecondary: '#4A4A4A',
    textMuted: '#808080',
    textOnAccent: '#FFFFFF',
    
    // Borders
    border: '#C0C0C0',
    divider: '#E0E0E0',
    
    // Interactive
    buttonBackground: '#E8E8E8',
    buttonBackgroundActive: '#007AFF',
    buttonText: '#333333',
    buttonTextActive: '#FFFFFF',
    
    // Accents
    accentPrimary: '#007AFF',
    accentSecondary: '#5856D6',
    accentSuccess: '#34C759',
    accentWarning: '#FF9500',
    accentDanger: '#FF3B30',
    
    // Tab bar
    tabBackground: 'rgba(0, 0, 0, 0.05)',
    tabBackgroundActive: 'rgba(0, 122, 255, 0.15)',
    tabText: '#666666',
    tabTextActive: '#007AFF',
    
    // Slider
    sliderTrack: '#D0D0D0',
    sliderTrackActive: '#007AFF',
    sliderThumb: '#007AFF',
    
    // Status
    statusOnline: '#34C759',
    statusOffline: '#8E8E93',
    statusWarning: '#FF9500',
  },

  dusk: {
    // Backgrounds - dark
    panelBackground: 'rgba(20, 25, 35, 0.95)',
    panelBackgroundSolid: '#1A1A25',
    cardBackground: '#252530',
    overlayBackground: 'rgba(20, 25, 35, 0.9)',
    mapBackground: '#1A1A2E',
    
    // Text - light
    textPrimary: '#E8E8F0',
    textSecondary: '#A0A0B0',
    textMuted: '#606070',
    textOnAccent: '#FFFFFF',
    
    // Borders
    border: '#404050',
    divider: '#303040',
    
    // Interactive
    buttonBackground: '#303040',
    buttonBackgroundActive: '#4FC3F7',
    buttonText: '#C0C0D0',
    buttonTextActive: '#FFFFFF',
    
    // Accents
    accentPrimary: '#4FC3F7',
    accentSecondary: '#7C4DFF',
    accentSuccess: '#69F0AE',
    accentWarning: '#FFB74D',
    accentDanger: '#FF5252',
    
    // Tab bar
    tabBackground: 'rgba(255, 255, 255, 0.05)',
    tabBackgroundActive: 'rgba(79, 195, 247, 0.2)',
    tabText: 'rgba(255, 255, 255, 0.6)',
    tabTextActive: '#4FC3F7',
    
    // Slider
    sliderTrack: 'rgba(255, 255, 255, 0.2)',
    sliderTrackActive: '#4FC3F7',
    sliderThumb: '#4FC3F7',
    
    // Status
    statusOnline: '#69F0AE',
    statusOffline: '#606070',
    statusWarning: '#FFB74D',
  },

  night: {
    // Backgrounds - very dark, minimal luminance
    panelBackground: 'rgba(10, 10, 14, 0.95)',
    panelBackgroundSolid: '#0A0A0E',
    cardBackground: '#101014',
    overlayBackground: 'rgba(10, 10, 14, 0.9)',
    mapBackground: '#0A0A10',
    
    // Text - dim
    textPrimary: '#606068',
    textSecondary: '#404048',
    textMuted: '#282830',
    textOnAccent: '#303030',
    
    // Borders
    border: '#202028',
    divider: '#181820',
    
    // Interactive
    buttonBackground: '#181820',
    buttonBackgroundActive: '#303850',
    buttonText: '#404048',
    buttonTextActive: '#506070',
    
    // Accents - very dim
    accentPrimary: '#304050',
    accentSecondary: '#302840',
    accentSuccess: '#203020',
    accentWarning: '#403020',
    accentDanger: '#402020',
    
    // Tab bar
    tabBackground: 'rgba(255, 255, 255, 0.02)',
    tabBackgroundActive: 'rgba(48, 64, 80, 0.3)',
    tabText: 'rgba(255, 255, 255, 0.2)',
    tabTextActive: '#405060',
    
    // Slider
    sliderTrack: 'rgba(255, 255, 255, 0.1)',
    sliderTrackActive: '#304050',
    sliderThumb: '#405060',
    
    // Status
    statusOnline: '#203020',
    statusOffline: '#181820',
    statusWarning: '#302818',
  },
};

// Storage key
const THEME_MODE_STORAGE_KEY = '@XNautical:themeMode';

// Current mode state
let currentMode: S52DisplayMode = 'dusk'; // Default to dusk (dark background)

// Listeners for mode changes
type ModeChangeListener = (mode: S52DisplayMode) => void;
const listeners: Set<ModeChangeListener> = new Set();

/**
 * Get a specific S-52 color for the current or specified mode
 */
export function getS52Color(token: S52ColorToken, mode?: S52DisplayMode): string {
  const effectiveMode = mode ?? currentMode;
  return S52_COLOR_TABLES[effectiveMode][token] ?? '#FF00FF'; // Magenta fallback for missing
}

/**
 * Get the entire UI theme for the current or specified mode
 */
export function getUITheme(mode?: S52DisplayMode): UITheme {
  const effectiveMode = mode ?? currentMode;
  return UI_THEMES[effectiveMode];
}

/**
 * Get the current display mode
 */
export function getCurrentMode(): S52DisplayMode {
  return currentMode;
}

/**
 * Set the display mode
 */
export async function setDisplayMode(mode: S52DisplayMode): Promise<void> {
  if (currentMode === mode) return;
  
  currentMode = mode;
  
  // Persist to storage
  try {
    await AsyncStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  } catch (error) {
    console.warn('[ThemeService] Failed to persist theme mode:', error);
  }
  
  // Notify listeners
  listeners.forEach(listener => listener(mode));
}

/**
 * Load saved mode from storage
 */
export async function loadSavedMode(): Promise<S52DisplayMode> {
  try {
    const saved = await AsyncStorage.getItem(THEME_MODE_STORAGE_KEY);
    if (saved && (saved === 'day' || saved === 'dusk' || saved === 'night')) {
      currentMode = saved;
    }
  } catch (error) {
    console.warn('[ThemeService] Failed to load saved theme mode:', error);
  }
  return currentMode;
}

/**
 * Subscribe to mode changes
 */
export function subscribeToModeChanges(listener: ModeChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Get all S-52 colors for a specific mode (for chart rendering)
 */
export function getS52ColorTable(mode?: S52DisplayMode): Record<S52ColorToken, string> {
  const effectiveMode = mode ?? currentMode;
  return { ...S52_COLOR_TABLES[effectiveMode] };
}

/**
 * Convert hex color to rgba with opacity
 */
export function hexToRgba(hex: string, opacity: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return hex;
  
  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);
  
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// Default export for convenience
export default {
  getS52Color,
  getUITheme,
  getCurrentMode,
  setDisplayMode,
  loadSavedMode,
  subscribeToModeChanges,
  getS52ColorTable,
  hexToRgba,
};

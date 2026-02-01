/**
 * Display Settings Service - Manages user preferences for chart display
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@xnautical_display_settings';

export interface DisplaySettings {
  // Font size multipliers (1.0 = default)
  soundingsFontScale: number;
  gnisFontScale: number;
  depthContourFontScale: number;
  chartLabelsFontScale: number;
  
  // Text halo/stroke width multipliers (1.0 = default)
  soundingsHaloScale: number;
  gnisHaloScale: number;
  depthContourLabelHaloScale: number;
  chartLabelsHaloScale: number;
  
  // Text opacity multipliers (1.0 = default)
  soundingsOpacityScale: number;
  gnisOpacityScale: number;
  depthContourLabelOpacityScale: number;
  chartLabelsOpacityScale: number;
  
  // Line width multipliers (1.0 = default)
  depthContourLineScale: number;
  coastlineLineScale: number;
  cableLineScale: number;
  pipelineLineScale: number;
  bridgeLineScale: number;
  mooringLineScale: number;
  shorelineConstructionLineScale: number;
  
  // Line halo multipliers (1.0 = default, 0 = no halo)
  depthContourLineHaloScale: number;
  coastlineHaloScale: number;
  cableLineHaloScale: number;
  pipelineLineHaloScale: number;
  bridgeLineHaloScale: number;
  mooringLineHaloScale: number;
  shorelineConstructionHaloScale: number;
  
  // Line opacity multipliers (1.0 = default)
  depthContourLineOpacityScale: number;
  coastlineOpacityScale: number;
  cableLineOpacityScale: number;
  pipelineLineOpacityScale: number;
  bridgeOpacityScale: number;
  mooringOpacityScale: number;
  shorelineConstructionOpacityScale: number;
  
  // Area opacity multipliers (1.0 = default)
  depthAreaOpacityScale: number;
  restrictedAreaOpacityScale: number;
  cautionAreaOpacityScale: number;
  militaryAreaOpacityScale: number;
  anchorageOpacityScale: number;
  marineFarmOpacityScale: number;
  cableAreaOpacityScale: number;
  pipelineAreaOpacityScale: number;
  fairwayOpacityScale: number;
  dredgedAreaOpacityScale: number;
  
  // Area stroke multipliers (1.0 = default)
  depthAreaStrokeScale: number;
  restrictedAreaStrokeScale: number;
  cautionAreaStrokeScale: number;
  militaryAreaStrokeScale: number;
  anchorageStrokeScale: number;
  marineFarmStrokeScale: number;
  cableAreaStrokeScale: number;
  pipelineAreaStrokeScale: number;
  fairwayStrokeScale: number;
  dredgedAreaStrokeScale: number;
  
  // Other settings
  dayNightMode: 'day' | 'night' | 'auto';
  orientationMode: 'north-up' | 'head-up' | 'course-up';
}

const DEFAULT_SETTINGS: DisplaySettings = {
  // Font sizes (1.5 = nominal 100%, range 1.0-3.0)
  soundingsFontScale: 1.5,
  gnisFontScale: 1.5,
  depthContourFontScale: 1.5,
  chartLabelsFontScale: 1.5,
  // Text halo/stroke
  soundingsHaloScale: 1.0,
  gnisHaloScale: 1.0,
  depthContourLabelHaloScale: 1.0,
  chartLabelsHaloScale: 1.0,
  // Text opacities
  soundingsOpacityScale: 1.0,
  gnisOpacityScale: 1.0,
  depthContourLabelOpacityScale: 1.0,
  chartLabelsOpacityScale: 1.0,
  // Line widths
  depthContourLineScale: 1.0,
  coastlineLineScale: 1.0,
  cableLineScale: 1.0,
  pipelineLineScale: 1.0,
  bridgeLineScale: 1.0,
  mooringLineScale: 1.0,
  shorelineConstructionLineScale: 1.0,
  // Line halos (0 = no halo, 1.0 = default halo) - temporarily disabled to debug crash
  depthContourLineHaloScale: 0,
  coastlineHaloScale: 0,
  cableLineHaloScale: 0,
  pipelineLineHaloScale: 0,
  bridgeLineHaloScale: 0,
  mooringLineHaloScale: 0,
  shorelineConstructionHaloScale: 0,
  // Line opacities
  depthContourLineOpacityScale: 1.0,
  coastlineOpacityScale: 1.0,
  cableLineOpacityScale: 1.0,
  pipelineLineOpacityScale: 1.0,
  bridgeOpacityScale: 1.0,
  mooringOpacityScale: 1.0,
  shorelineConstructionOpacityScale: 1.0,
  // Area opacities
  depthAreaOpacityScale: 1.0,
  restrictedAreaOpacityScale: 1.0,
  cautionAreaOpacityScale: 1.0,
  militaryAreaOpacityScale: 1.0,
  anchorageOpacityScale: 1.0,
  marineFarmOpacityScale: 1.0,
  cableAreaOpacityScale: 1.0,
  pipelineAreaOpacityScale: 1.0,
  fairwayOpacityScale: 1.0,
  dredgedAreaOpacityScale: 1.0,
  // Area strokes
  depthAreaStrokeScale: 1.0,
  restrictedAreaStrokeScale: 1.0,
  cautionAreaStrokeScale: 1.0,
  militaryAreaStrokeScale: 1.0,
  anchorageStrokeScale: 1.0,
  marineFarmStrokeScale: 1.0,
  cableAreaStrokeScale: 1.0,
  pipelineAreaStrokeScale: 1.0,
  fairwayStrokeScale: 1.0,
  dredgedAreaStrokeScale: 1.0,
  // Other settings
  dayNightMode: 'day',
  orientationMode: 'north-up',
};

// In-memory cache
let cachedSettings: DisplaySettings | null = null;

// Listeners for settings changes
type SettingsListener = (settings: DisplaySettings) => void;
const listeners: Set<SettingsListener> = new Set();

/**
 * Load settings from storage
 */
export async function loadSettings(): Promise<DisplaySettings> {
  try {
    console.log('[DEBUG] displaySettingsService.loadSettings() called');
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    console.log('[DEBUG] Raw stored settings:', stored ? 'exists' : 'null');
    if (stored) {
      const parsed = JSON.parse(stored);
      console.log('[DEBUG] Parsed stored settings keys:', Object.keys(parsed).length);
      cachedSettings = { ...DEFAULT_SETTINGS, ...parsed };
    } else {
      console.log('[DEBUG] No stored settings, using defaults');
      cachedSettings = { ...DEFAULT_SETTINGS };
    }
    console.log('[DEBUG] Final settings keys:', Object.keys(cachedSettings).length);
    // Validate all required keys exist
    const requiredKeys = Object.keys(DEFAULT_SETTINGS);
    const missingKeys = requiredKeys.filter(key => cachedSettings![key as keyof DisplaySettings] === undefined);
    if (missingKeys.length > 0) {
      console.warn('[DEBUG] Missing settings keys:', missingKeys);
    }
    return cachedSettings;
  } catch (error) {
    console.error('Error loading display settings:', error);
    cachedSettings = { ...DEFAULT_SETTINGS };
    return cachedSettings;
  }
}

/**
 * Save settings to storage
 */
export async function saveSettings(settings: DisplaySettings): Promise<void> {
  try {
    cachedSettings = settings;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    // Notify all listeners
    listeners.forEach(listener => listener(settings));
  } catch (error) {
    console.error('Error saving display settings:', error);
  }
}

/**
 * Get current settings (from cache or load)
 */
export async function getSettings(): Promise<DisplaySettings> {
  if (cachedSettings) {
    return cachedSettings;
  }
  return loadSettings();
}

/**
 * Get cached settings synchronously (may be null if not loaded)
 */
export function getCachedSettings(): DisplaySettings | null {
  return cachedSettings;
}

/**
 * Update a single setting
 */
export async function updateSetting<K extends keyof DisplaySettings>(
  key: K,
  value: DisplaySettings[K]
): Promise<void> {
  const current = await getSettings();
  await saveSettings({ ...current, [key]: value });
}

/**
 * Reset all settings to defaults
 */
export async function resetSettings(): Promise<void> {
  await saveSettings({ ...DEFAULT_SETTINGS });
}

/**
 * Subscribe to settings changes
 */
export function subscribe(listener: SettingsListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Apply font scale to a base size
 */
export function applyFontScale(baseSize: number, scale: number): number {
  return Math.round(baseSize * scale);
}

/**
 * Apply font scale to an interpolated size array
 * Input: ['interpolate', ['linear'], ['zoom'], z1, s1, z2, s2, ...]
 * Output: same structure with scaled sizes
 */
export function applyFontScaleToInterpolation(
  interpolation: any[],
  scale: number
): any[] {
  if (!Array.isArray(interpolation) || interpolation[0] !== 'interpolate') {
    return interpolation;
  }
  
  // Copy the array
  const result = [...interpolation];
  
  // Scale the size values (every other element starting from index 3)
  for (let i = 3; i < result.length; i += 2) {
    if (typeof result[i + 1] === 'number') {
      result[i + 1] = Math.round(result[i + 1] * scale);
    }
  }
  
  return result;
}

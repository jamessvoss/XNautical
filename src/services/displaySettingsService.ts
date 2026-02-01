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
  
  // Line width multipliers (1.0 = default)
  depthContourLineScale: number;
  coastlineLineScale: number;
  cableLineScale: number;
  pipelineLineScale: number;
  bridgeLineScale: number;
  mooringLineScale: number;
  shorelineConstructionLineScale: number;
  
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
}

const DEFAULT_SETTINGS: DisplaySettings = {
  // Font sizes
  soundingsFontScale: 1.0,
  gnisFontScale: 1.0,
  depthContourFontScale: 1.0,
  chartLabelsFontScale: 1.0,
  // Line widths
  depthContourLineScale: 1.0,
  coastlineLineScale: 1.0,
  cableLineScale: 1.0,
  pipelineLineScale: 1.0,
  bridgeLineScale: 1.0,
  mooringLineScale: 1.0,
  shorelineConstructionLineScale: 1.0,
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
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      cachedSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    } else {
      cachedSettings = { ...DEFAULT_SETTINGS };
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

/**
 * Hook: Display settings state management
 * Loads persisted display settings on mount and subscribes to changes.
 */

import { useState, useEffect } from 'react';
import * as displaySettingsService from '../../../services/displaySettingsService';
import type { DisplaySettings } from '../../../services/displaySettingsService';
import { logger, LogCategory } from '../../../services/loggingService';
import { performanceTracker, StartupPhase } from '../../../services/performanceTracker';

// Default display settings (matches S-52 nominal values)
const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
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
  // Line halos - temporarily disabled to debug crash
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
  // Symbol sizes (nominal values based on S-52 standard visibility)
  lightSymbolSizeScale: 2.0,
  buoySymbolSizeScale: 2.0,
  beaconSymbolSizeScale: 1.5,
  wreckSymbolSizeScale: 1.5,
  rockSymbolSizeScale: 1.5,
  hazardSymbolSizeScale: 1.5,
  landmarkSymbolSizeScale: 1.5,
  mooringSymbolSizeScale: 1.5,
  anchorSymbolSizeScale: 1.5,
  tideRipsSymbolSizeScale: 1.5,
  // Symbol halos (white background for visibility per S-52)
  lightSymbolHaloScale: 0.1,
  buoySymbolHaloScale: 0.1,
  beaconSymbolHaloScale: 0.1,
  wreckSymbolHaloScale: 0.1,
  rockSymbolHaloScale: 0.1,
  hazardSymbolHaloScale: 0.1,
  landmarkSymbolHaloScale: 0.1,
  mooringSymbolHaloScale: 0.1,
  anchorSymbolHaloScale: 0.1,
  tideRipsSymbolHaloScale: 0.1,
  tideStationSymbolSizeScale: 1.0,
  currentStationSymbolSizeScale: 1.0,
  tideStationSymbolHaloScale: 0.1,
  currentStationSymbolHaloScale: 0.1,
  // Symbol opacities
  lightSymbolOpacityScale: 1.0,
  buoySymbolOpacityScale: 1.0,
  beaconSymbolOpacityScale: 1.0,
  wreckSymbolOpacityScale: 1.0,
  rockSymbolOpacityScale: 1.0,
  hazardSymbolOpacityScale: 1.0,
  landmarkSymbolOpacityScale: 1.0,
  mooringSymbolOpacityScale: 1.0,
  anchorSymbolOpacityScale: 1.0,
  tideRipsSymbolOpacityScale: 1.0,
  tideStationSymbolOpacityScale: 1.0,
  currentStationSymbolOpacityScale: 1.0,
  // Live Buoy symbol
  liveBuoySymbolSizeScale: 1.0,
  liveBuoySymbolHaloScale: 0.05,
  liveBuoySymbolOpacityScale: 1.0,
  // Live buoy text
  liveBuoyTextSizeScale: 1.0,
  liveBuoyTextHaloScale: 0.05,
  liveBuoyTextOpacityScale: 1.0,
  // Tide station text
  tideStationTextSizeScale: 1.0,
  tideStationTextHaloScale: 0.05,
  tideStationTextOpacityScale: 1.0,
  // Current station text
  currentStationTextSizeScale: 1.0,
  currentStationTextHaloScale: 0.05,
  currentStationTextOpacityScale: 1.0,
  // Other settings
  dayNightMode: 'day',
  orientationMode: 'north-up',
  depthUnits: 'meters',
  tideCorrectedSoundings: false,
};

export function useDisplaySettings() {
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>(DEFAULT_DISPLAY_SETTINGS);

  // Load persisted settings and subscribe to changes
  useEffect(() => {
    const loadDisplaySettings = async () => {
      performanceTracker.startPhase(StartupPhase.DISPLAY_SETTINGS);
      const settings = await displaySettingsService.loadSettings();
      performanceTracker.endPhase(StartupPhase.DISPLAY_SETTINGS);
      logger.debug(LogCategory.SETTINGS, 'Display settings loaded');
      setDisplaySettings(settings);
    };
    loadDisplaySettings();

    // Subscribe to changes from Settings screen
    const unsubscribe = displaySettingsService.subscribe((settings) => {
      logger.debug(LogCategory.SETTINGS, 'Display settings updated via subscription');
      setDisplaySettings(settings);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return { displaySettings, setDisplaySettings };
}

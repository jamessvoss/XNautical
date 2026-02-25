/**
 * Hook: Scaled display values
 * All 60+ zoom-interpolated useMemo hooks for font sizes, line widths,
 * halos, opacities, and symbol sizes. Pure computation — no side effects.
 */

import { useMemo } from 'react';
import type { DisplaySettings } from '../../../services/displaySettingsService';
import { logger, LogCategory } from '../../../services/loggingService';

// MapLibre interpolation expression type (not strictly typed by MapLibre)
type MLExpression = (string | number | (string | number)[])[];

export function useScaledDisplayValues(
  displaySettings: DisplaySettings,
  currentTideCorrection: number,
) {
  // ─── Depth text field expression ──────────────────────────────────────
  const depthTextFieldExpression = useMemo(() => {
    const unit = displaySettings.depthUnits;

    const depthValue = displaySettings.tideCorrectedSoundings && currentTideCorrection !== 0
      ? ['+', ['get', 'DEPTH'], currentTideCorrection]
      : ['get', 'DEPTH'];

    console.log('[DepthExpression] tideCorrectedSoundings:', displaySettings.tideCorrectedSoundings,
                'currentTideCorrection:', currentTideCorrection,
                'depthValue:', JSON.stringify(depthValue));

    if (unit === 'feet') {
      return ['to-string', ['round', ['*', depthValue, 3.28084]]];
    } else if (unit === 'fathoms') {
      return ['to-string', ['round', ['*', depthValue, 0.546807]]];
    }
    return ['to-string', ['round', depthValue]];
  }, [displaySettings.depthUnits, displaySettings.tideCorrectedSoundings, currentTideCorrection]);

  // ─── Font sizes ───────────────────────────────────────────────────────
  const scaledSoundingsFontSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    4, Math.round(6 * displaySettings.soundingsFontScale),
    8, Math.round(7 * displaySettings.soundingsFontScale),
    10, Math.round(8 * displaySettings.soundingsFontScale),
    12, Math.round(9 * displaySettings.soundingsFontScale),
    14, Math.round(11 * displaySettings.soundingsFontScale),
    18, Math.round(14 * displaySettings.soundingsFontScale),
  ], [displaySettings.soundingsFontScale]);

  const scaledDepthContourFontSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    12, Math.round(11 * displaySettings.depthContourFontScale),
    14, Math.round(13 * displaySettings.depthContourFontScale),
    16, Math.round(15 * displaySettings.depthContourFontScale),
  ], [displaySettings.depthContourFontScale]);

  const scaledGnisFontSizes = useMemo(() => ({
    water: [
      'interpolate', ['linear'], ['zoom'],
      6, Math.round(11 * displaySettings.gnisFontScale),
      7, Math.round(12 * displaySettings.gnisFontScale),
      10, Math.round(14 * displaySettings.gnisFontScale),
      14, Math.round(16 * displaySettings.gnisFontScale),
    ],
    coastal: [
      'interpolate', ['linear'], ['zoom'],
      6, Math.round(10 * displaySettings.gnisFontScale),
      7, Math.round(11 * displaySettings.gnisFontScale),
      10, Math.round(13 * displaySettings.gnisFontScale),
      14, Math.round(15 * displaySettings.gnisFontScale),
    ],
    landmark: [
      'interpolate', ['linear'], ['zoom'],
      8, Math.round(10 * displaySettings.gnisFontScale),
      9, Math.round(11 * displaySettings.gnisFontScale),
      14, Math.round(14 * displaySettings.gnisFontScale),
    ],
    populated: [
      'interpolate', ['linear'], ['zoom'],
      6, Math.round(11 * displaySettings.gnisFontScale),
      7, Math.round(12 * displaySettings.gnisFontScale),
      10, Math.round(14 * displaySettings.gnisFontScale),
      14, Math.round(16 * displaySettings.gnisFontScale),
    ],
    stream: [
      'interpolate', ['linear'], ['zoom'],
      9, Math.round(10 * displaySettings.gnisFontScale),
      10, Math.round(10 * displaySettings.gnisFontScale),
      14, Math.round(12 * displaySettings.gnisFontScale),
    ],
    lake: [
      'interpolate', ['linear'], ['zoom'],
      9, Math.round(10 * displaySettings.gnisFontScale),
      10, Math.round(10 * displaySettings.gnisFontScale),
      14, Math.round(12 * displaySettings.gnisFontScale),
    ],
    terrain: [
      'interpolate', ['linear'], ['zoom'],
      10, Math.round(10 * displaySettings.gnisFontScale),
      11, Math.round(10 * displaySettings.gnisFontScale),
      14, Math.round(12 * displaySettings.gnisFontScale),
    ],
  }), [displaySettings.gnisFontScale]);

  // ─── Text halo widths ─────────────────────────────────────────────────
  const scaledSoundingsHalo = useMemo(() =>
    1.0 * displaySettings.soundingsHaloScale,
    [displaySettings.soundingsHaloScale]
  );

  const scaledGnisHalo = useMemo(() =>
    0.8 * displaySettings.gnisHaloScale,
    [displaySettings.gnisHaloScale]
  );

  const scaledDepthContourLabelHalo = useMemo(() =>
    0.7 * displaySettings.depthContourLabelHaloScale,
    [displaySettings.depthContourLabelHaloScale]
  );

  // ─── Text opacities (clamped 0–1) ────────────────────────────────────
  const scaledSoundingsOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.soundingsOpacityScale)),
    [displaySettings.soundingsOpacityScale]
  );

  const scaledGnisOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.gnisOpacityScale)),
    [displaySettings.gnisOpacityScale]
  );

  const scaledDepthContourLabelOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.depthContourLabelOpacityScale)),
    [displaySettings.depthContourLabelOpacityScale]
  );

  // ─── Line widths ──────────────────────────────────────────────────────
  const scaledDepthContourLineWidth = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.2 * displaySettings.depthContourLineScale,
    12, 0.5 * displaySettings.depthContourLineScale,
    16, 0.8 * displaySettings.depthContourLineScale,
  ], [displaySettings.depthContourLineScale]);

  const scaledCoastlineLineWidth = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.5 * displaySettings.coastlineLineScale,
    12, 1.0 * displaySettings.coastlineLineScale,
    16, 1.5 * displaySettings.coastlineLineScale,
  ], [displaySettings.coastlineLineScale]);

  const scaledCableLineWidth = useMemo(() =>
    1.5 * displaySettings.cableLineScale,
    [displaySettings.cableLineScale]
  );

  const scaledPipelineLineWidth = useMemo(() =>
    2 * displaySettings.pipelineLineScale,
    [displaySettings.pipelineLineScale]
  );

  const scaledBridgeLineWidth = useMemo(() =>
    3 * displaySettings.bridgeLineScale,
    [displaySettings.bridgeLineScale]
  );

  const scaledMooringLineWidth = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    12, 1.5 * displaySettings.mooringLineScale,
    14, 2.5 * displaySettings.mooringLineScale,
    18, 4 * displaySettings.mooringLineScale,
  ], [displaySettings.mooringLineScale]);

  const scaledShorelineConstructionLineWidth = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    12, 1.5 * displaySettings.shorelineConstructionLineScale,
    14, 2.5 * displaySettings.shorelineConstructionLineScale,
    18, 4 * displaySettings.shorelineConstructionLineScale,
  ], [displaySettings.shorelineConstructionLineScale]);

  // ─── Line halo widths (shadow behind lines) ──────────────────────────
  const scaledDepthContourLineHalo = useMemo(() => {
    const val = 2.0 * (displaySettings.depthContourLineHaloScale ?? 1.0);
    if (isNaN(val)) logger.warn(LogCategory.SETTINGS, 'scaledDepthContourLineHalo is NaN', { value: displaySettings.depthContourLineHaloScale });
    return val;
  }, [displaySettings.depthContourLineHaloScale]);

  const scaledCoastlineHalo = useMemo(() => {
    const val = 3.0 * (displaySettings.coastlineHaloScale ?? 1.0);
    if (isNaN(val)) logger.warn(LogCategory.SETTINGS, 'scaledCoastlineHalo is NaN', { value: displaySettings.coastlineHaloScale });
    return val;
  }, [displaySettings.coastlineHaloScale]);

  const scaledCableLineHalo = useMemo(() => {
    const val = 2.5 * (displaySettings.cableLineHaloScale ?? 1.0);
    if (isNaN(val)) logger.warn(LogCategory.SETTINGS, 'scaledCableLineHalo is NaN', { value: displaySettings.cableLineHaloScale });
    return val;
  }, [displaySettings.cableLineHaloScale]);

  const scaledPipelineLineHalo = useMemo(() => {
    const val = 3.0 * (displaySettings.pipelineLineHaloScale ?? 1.0);
    if (isNaN(val)) logger.warn(LogCategory.SETTINGS, 'scaledPipelineLineHalo is NaN', { value: displaySettings.pipelineLineHaloScale });
    return val;
  }, [displaySettings.pipelineLineHaloScale]);

  const scaledBridgeLineHalo = useMemo(() => {
    const val = 4.0 * (displaySettings.bridgeLineHaloScale ?? 1.0);
    if (isNaN(val)) logger.warn(LogCategory.SETTINGS, 'scaledBridgeLineHalo is NaN', { value: displaySettings.bridgeLineHaloScale });
    return val;
  }, [displaySettings.bridgeLineHaloScale]);

  const scaledMooringLineHalo = useMemo(() => {
    const val = 3.0 * (displaySettings.mooringLineHaloScale ?? 1.0);
    if (isNaN(val)) logger.warn(LogCategory.SETTINGS, 'scaledMooringLineHalo is NaN', { value: displaySettings.mooringLineHaloScale });
    return val;
  }, [displaySettings.mooringLineHaloScale]);

  const scaledShorelineConstructionHalo = useMemo(() => {
    const val = 3.0 * (displaySettings.shorelineConstructionHaloScale ?? 1.0);
    if (isNaN(val)) logger.warn(LogCategory.SETTINGS, 'scaledShorelineConstructionHalo is NaN', { value: displaySettings.shorelineConstructionHaloScale });
    return val;
  }, [displaySettings.shorelineConstructionHaloScale]);

  // ─── Interpolated halo widths (for mooring, shoreline, depth contours, coastline) ─
  const scaledMooringLineHaloWidth = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    12, (1.5 * displaySettings.mooringLineScale) + scaledMooringLineHalo,
    14, (2.5 * displaySettings.mooringLineScale) + scaledMooringLineHalo,
    18, (4 * displaySettings.mooringLineScale) + scaledMooringLineHalo,
  ], [displaySettings.mooringLineScale, scaledMooringLineHalo]);

  const scaledShorelineConstructionHaloWidth = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    12, (1.5 * displaySettings.shorelineConstructionLineScale) + scaledShorelineConstructionHalo,
    14, (2.5 * displaySettings.shorelineConstructionLineScale) + scaledShorelineConstructionHalo,
    18, (4 * displaySettings.shorelineConstructionLineScale) + scaledShorelineConstructionHalo,
  ], [displaySettings.shorelineConstructionLineScale, scaledShorelineConstructionHalo]);

  const scaledDepthContourLineHaloWidth = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    8, (0.3 * displaySettings.depthContourLineScale) + scaledDepthContourLineHalo,
    12, (0.7 * displaySettings.depthContourLineScale) + scaledDepthContourLineHalo,
    16, (1.0 * displaySettings.depthContourLineScale) + scaledDepthContourLineHalo,
  ], [displaySettings.depthContourLineScale, scaledDepthContourLineHalo]);

  const scaledCoastlineHaloWidth = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    8, (0.5 * displaySettings.coastlineLineScale) + scaledCoastlineHalo,
    12, (1.0 * displaySettings.coastlineLineScale) + scaledCoastlineHalo,
    16, (1.5 * displaySettings.coastlineLineScale) + scaledCoastlineHalo,
  ], [displaySettings.coastlineLineScale, scaledCoastlineHalo]);

  // ─── Line opacities (clamped 0–1) ────────────────────────────────────
  const scaledDepthContourLineOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.depthContourLineOpacityScale)),
    [displaySettings.depthContourLineOpacityScale]
  );

  const scaledCoastlineOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.coastlineOpacityScale)),
    [displaySettings.coastlineOpacityScale]
  );

  const scaledCableLineOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.cableLineOpacityScale)),
    [displaySettings.cableLineOpacityScale]
  );

  const scaledPipelineLineOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.pipelineLineOpacityScale)),
    [displaySettings.pipelineLineOpacityScale]
  );

  const scaledBridgeOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.bridgeOpacityScale)),
    [displaySettings.bridgeOpacityScale]
  );

  const scaledMooringOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.mooringOpacityScale)),
    [displaySettings.mooringOpacityScale]
  );

  const scaledShorelineConstructionOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.shorelineConstructionOpacityScale)),
    [displaySettings.shorelineConstructionOpacityScale]
  );

  // ─── Area opacities (clamped 0–1) ────────────────────────────────────
  const scaledDepthAreaOpacity = useMemo(() =>
    Math.min(1, Math.max(0, 1.0 * displaySettings.depthAreaOpacityScale)),
    [displaySettings.depthAreaOpacityScale]
  );

  const scaledDepthAreaOpacitySatellite = useMemo(() =>
    Math.min(1, Math.max(0, 0.3 * displaySettings.depthAreaOpacityScale)),
    [displaySettings.depthAreaOpacityScale]
  );

  const scaledRestrictedAreaOpacity = useMemo(() =>
    Math.min(1, Math.max(0, 0.2 * displaySettings.restrictedAreaOpacityScale)),
    [displaySettings.restrictedAreaOpacityScale]
  );

  const scaledCautionAreaOpacity = useMemo(() =>
    Math.min(1, Math.max(0, 0.2 * displaySettings.cautionAreaOpacityScale)),
    [displaySettings.cautionAreaOpacityScale]
  );

  const scaledMilitaryAreaOpacity = useMemo(() =>
    Math.min(1, Math.max(0, 0.15 * displaySettings.militaryAreaOpacityScale)),
    [displaySettings.militaryAreaOpacityScale]
  );

  const scaledAnchorageOpacity = useMemo(() =>
    Math.min(1, Math.max(0, 0.15 * displaySettings.anchorageOpacityScale)),
    [displaySettings.anchorageOpacityScale]
  );

  const scaledMarineFarmOpacity = useMemo(() =>
    Math.min(1, Math.max(0, 0.2 * displaySettings.marineFarmOpacityScale)),
    [displaySettings.marineFarmOpacityScale]
  );

  const scaledCableAreaOpacity = useMemo(() =>
    Math.min(1, Math.max(0, 0.15 * displaySettings.cableAreaOpacityScale)),
    [displaySettings.cableAreaOpacityScale]
  );

  const scaledPipelineAreaOpacity = useMemo(() =>
    Math.min(1, Math.max(0, 0.15 * displaySettings.pipelineAreaOpacityScale)),
    [displaySettings.pipelineAreaOpacityScale]
  );

  const scaledFairwayOpacity = useMemo(() =>
    Math.min(1, Math.max(0, 0.3 * displaySettings.fairwayOpacityScale)),
    [displaySettings.fairwayOpacityScale]
  );

  const scaledDredgedAreaOpacity = useMemo(() =>
    Math.min(1, Math.max(0, 0.4 * displaySettings.dredgedAreaOpacityScale)),
    [displaySettings.dredgedAreaOpacityScale]
  );

  // ─── Symbol / icon sizes ──────────────────────────────────────────────
  const scaledLightIconSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.3 * displaySettings.lightSymbolSizeScale,
    12, 0.5 * displaySettings.lightSymbolSizeScale,
    16, 0.8 * displaySettings.lightSymbolSizeScale,
  ], [displaySettings.lightSymbolSizeScale]);

  const scaledBuoyIconSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.25 * displaySettings.buoySymbolSizeScale,
    12, 0.4 * displaySettings.buoySymbolSizeScale,
    16, 0.6 * displaySettings.buoySymbolSizeScale,
  ], [displaySettings.buoySymbolSizeScale]);

  const scaledBuoyHaloSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.25 * displaySettings.buoySymbolSizeScale * (1.0 + displaySettings.buoySymbolHaloScale),
    12, 0.4 * displaySettings.buoySymbolSizeScale * (1.0 + displaySettings.buoySymbolHaloScale),
    16, 0.6 * displaySettings.buoySymbolSizeScale * (1.0 + displaySettings.buoySymbolHaloScale),
  ], [displaySettings.buoySymbolSizeScale, displaySettings.buoySymbolHaloScale]);

  const scaledBeaconIconSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.08 * displaySettings.beaconSymbolSizeScale,
    10, 0.15 * displaySettings.beaconSymbolSizeScale,
    12, 0.3 * displaySettings.beaconSymbolSizeScale,
    14, 0.45 * displaySettings.beaconSymbolSizeScale,
    16, 0.6 * displaySettings.beaconSymbolSizeScale,
  ], [displaySettings.beaconSymbolSizeScale]);

  const scaledBeaconHaloSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.08 * displaySettings.beaconSymbolSizeScale * (1.0 + displaySettings.beaconSymbolHaloScale),
    10, 0.15 * displaySettings.beaconSymbolSizeScale * (1.0 + displaySettings.beaconSymbolHaloScale),
    12, 0.3 * displaySettings.beaconSymbolSizeScale * (1.0 + displaySettings.beaconSymbolHaloScale),
    14, 0.45 * displaySettings.beaconSymbolSizeScale * (1.0 + displaySettings.beaconSymbolHaloScale),
    16, 0.6 * displaySettings.beaconSymbolSizeScale * (1.0 + displaySettings.beaconSymbolHaloScale),
  ], [displaySettings.beaconSymbolSizeScale, displaySettings.beaconSymbolHaloScale]);

  const scaledWreckIconSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.3 * displaySettings.wreckSymbolSizeScale,
    12, 0.5 * displaySettings.wreckSymbolSizeScale,
    16, 0.7 * displaySettings.wreckSymbolSizeScale,
  ], [displaySettings.wreckSymbolSizeScale]);

  const scaledRockIconSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.25 * displaySettings.rockSymbolSizeScale,
    12, 0.4 * displaySettings.rockSymbolSizeScale,
    16, 0.6 * displaySettings.rockSymbolSizeScale,
  ], [displaySettings.rockSymbolSizeScale]);

  const scaledHazardIconSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.25 * displaySettings.hazardSymbolSizeScale,
    12, 0.4 * displaySettings.hazardSymbolSizeScale,
    16, 0.6 * displaySettings.hazardSymbolSizeScale,
  ], [displaySettings.hazardSymbolSizeScale]);

  const scaledLandmarkIconSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.2 * displaySettings.landmarkSymbolSizeScale,
    10, 0.4 * displaySettings.landmarkSymbolSizeScale,
    12, 0.65 * displaySettings.landmarkSymbolSizeScale,
    14, 0.9 * displaySettings.landmarkSymbolSizeScale,
    16, 1.2 * displaySettings.landmarkSymbolSizeScale,
  ], [displaySettings.landmarkSymbolSizeScale]);

  const scaledLandmarkHaloSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.2 * displaySettings.landmarkSymbolSizeScale * (1.0 + displaySettings.landmarkSymbolHaloScale),
    10, 0.4 * displaySettings.landmarkSymbolSizeScale * (1.0 + displaySettings.landmarkSymbolHaloScale),
    12, 0.65 * displaySettings.landmarkSymbolSizeScale * (1.0 + displaySettings.landmarkSymbolHaloScale),
    14, 0.9 * displaySettings.landmarkSymbolSizeScale * (1.0 + displaySettings.landmarkSymbolHaloScale),
    16, 1.2 * displaySettings.landmarkSymbolSizeScale * (1.0 + displaySettings.landmarkSymbolHaloScale),
  ], [displaySettings.landmarkSymbolSizeScale, displaySettings.landmarkSymbolHaloScale]);

  const scaledMooringIconSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.2 * displaySettings.mooringSymbolSizeScale,
    12, 0.35 * displaySettings.mooringSymbolSizeScale,
    16, 0.5 * displaySettings.mooringSymbolSizeScale,
  ], [displaySettings.mooringSymbolSizeScale]);

  const scaledAnchorIconSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.25 * displaySettings.anchorSymbolSizeScale,
    12, 0.4 * displaySettings.anchorSymbolSizeScale,
    16, 0.6 * displaySettings.anchorSymbolSizeScale,
  ], [displaySettings.anchorSymbolSizeScale]);

  const scaledTideRipsIconSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.25 * (displaySettings.tideRipsSymbolSizeScale ?? 1.5),
    12, 0.4 * (displaySettings.tideRipsSymbolSizeScale ?? 1.5),
    16, 0.6 * (displaySettings.tideRipsSymbolSizeScale ?? 1.5),
  ], [displaySettings.tideRipsSymbolSizeScale]);

  const scaledTideRipsHaloSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    8, 0.25 * (displaySettings.tideRipsSymbolSizeScale ?? 1.5) * (1.0 + (displaySettings.tideRipsSymbolHaloScale ?? 0.1)),
    12, 0.4 * (displaySettings.tideRipsSymbolSizeScale ?? 1.5) * (1.0 + (displaySettings.tideRipsSymbolHaloScale ?? 0.1)),
    16, 0.6 * (displaySettings.tideRipsSymbolSizeScale ?? 1.5) * (1.0 + (displaySettings.tideRipsSymbolHaloScale ?? 0.1)),
  ], [displaySettings.tideRipsSymbolSizeScale, displaySettings.tideRipsSymbolHaloScale]);

  // ─── Symbol opacities (clamped 0–1) ───────────────────────────────────
  const scaledLightSymbolOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.lightSymbolOpacityScale)),
    [displaySettings.lightSymbolOpacityScale]
  );

  const scaledBuoySymbolOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.buoySymbolOpacityScale)),
    [displaySettings.buoySymbolOpacityScale]
  );

  const scaledBeaconSymbolOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.beaconSymbolOpacityScale)),
    [displaySettings.beaconSymbolOpacityScale]
  );

  const scaledWreckSymbolOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.wreckSymbolOpacityScale)),
    [displaySettings.wreckSymbolOpacityScale]
  );

  const scaledRockSymbolOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.rockSymbolOpacityScale)),
    [displaySettings.rockSymbolOpacityScale]
  );

  const scaledHazardSymbolOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.hazardSymbolOpacityScale)),
    [displaySettings.hazardSymbolOpacityScale]
  );

  const scaledTideRipsSymbolOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.tideRipsSymbolOpacityScale ?? 1.0)),
    [displaySettings.tideRipsSymbolOpacityScale]
  );

  const scaledLandmarkSymbolOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.landmarkSymbolOpacityScale)),
    [displaySettings.landmarkSymbolOpacityScale]
  );

  const scaledMooringSymbolOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.mooringSymbolOpacityScale)),
    [displaySettings.mooringSymbolOpacityScale]
  );

  const scaledAnchorSymbolOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.anchorSymbolOpacityScale)),
    [displaySettings.anchorSymbolOpacityScale]
  );

  // ─── Tide station scaling ─────────────────────────────────────────────
  const scaledTideStationIconSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    7, 0.3 * (displaySettings.tideStationSymbolSizeScale ?? 1.0),
    12, 1.0 * (displaySettings.tideStationSymbolSizeScale ?? 1.0),
  ], [displaySettings.tideStationSymbolSizeScale]);

  const scaledTideStationHaloSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    7, 0.3 * (displaySettings.tideStationSymbolSizeScale ?? 1.0) * (1.0 + (displaySettings.tideStationSymbolHaloScale ?? 0.1)),
    12, 1.0 * (displaySettings.tideStationSymbolSizeScale ?? 1.0) * (1.0 + (displaySettings.tideStationSymbolHaloScale ?? 0.1)),
  ], [displaySettings.tideStationSymbolSizeScale, displaySettings.tideStationSymbolHaloScale]);

  const scaledTideStationSymbolOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.tideStationSymbolOpacityScale ?? 1.0)),
    [displaySettings.tideStationSymbolOpacityScale]
  );

  const scaledTideStationLabelSize = useMemo(() => {
    const baseSize = 15 * (displaySettings.tideStationTextSizeScale ?? 1.0);
    return [
      'interpolate', ['linear'], ['zoom'],
      10, baseSize * 0.5,
      13, baseSize
    ];
  }, [displaySettings.tideStationTextSizeScale]);

  const scaledTideStationTextHalo = useMemo(() =>
    15 * (displaySettings.tideStationTextHaloScale ?? 0.05),
    [displaySettings.tideStationTextHaloScale]
  );

  const scaledTideStationTextOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.tideStationTextOpacityScale ?? 1.0)),
    [displaySettings.tideStationTextOpacityScale]
  );

  // ─── Current station scaling ──────────────────────────────────────────
  const scaledCurrentStationIconSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    7, 0.3 * (displaySettings.currentStationSymbolSizeScale ?? 1.0),
    12, 1.0 * (displaySettings.currentStationSymbolSizeScale ?? 1.0),
  ], [displaySettings.currentStationSymbolSizeScale]);

  const scaledCurrentStationHaloSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    7, 0.3 * (displaySettings.currentStationSymbolSizeScale ?? 1.0) * (1.0 + (displaySettings.currentStationSymbolHaloScale ?? 0.1)),
    12, 1.0 * (displaySettings.currentStationSymbolSizeScale ?? 1.0) * (1.0 + (displaySettings.currentStationSymbolHaloScale ?? 0.1)),
  ], [displaySettings.currentStationSymbolSizeScale, displaySettings.currentStationSymbolHaloScale]);

  const scaledCurrentStationSymbolOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.currentStationSymbolOpacityScale ?? 1.0)),
    [displaySettings.currentStationSymbolOpacityScale]
  );

  const scaledCurrentStationLabelSize = useMemo(() => {
    const baseSize = 15 * (displaySettings.currentStationTextSizeScale ?? 1.0);
    return [
      'interpolate', ['linear'], ['zoom'],
      10, baseSize * 0.5,
      13, baseSize
    ];
  }, [displaySettings.currentStationTextSizeScale]);

  const scaledCurrentStationTextHalo = useMemo(() =>
    15 * (displaySettings.currentStationTextHaloScale ?? 0.05),
    [displaySettings.currentStationTextHaloScale]
  );

  const scaledCurrentStationTextOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.currentStationTextOpacityScale ?? 1.0)),
    [displaySettings.currentStationTextOpacityScale]
  );

  // ─── Live buoy scaling ────────────────────────────────────────────────
  const scaledLiveBuoyIconSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    5, 0.2 * (displaySettings.liveBuoySymbolSizeScale ?? 1.0),
    10, 0.5 * (displaySettings.liveBuoySymbolSizeScale ?? 1.0),
    14, 1.0 * (displaySettings.liveBuoySymbolSizeScale ?? 1.0),
  ], [displaySettings.liveBuoySymbolSizeScale]);

  const scaledLiveBuoyHaloSize = useMemo((): MLExpression => [
    'interpolate', ['linear'], ['zoom'],
    5, 0.2 * (displaySettings.liveBuoySymbolSizeScale ?? 1.0) * (1.0 + (displaySettings.liveBuoySymbolHaloScale ?? 0.05)),
    10, 0.5 * (displaySettings.liveBuoySymbolSizeScale ?? 1.0) * (1.0 + (displaySettings.liveBuoySymbolHaloScale ?? 0.05)),
    14, 1.0 * (displaySettings.liveBuoySymbolSizeScale ?? 1.0) * (1.0 + (displaySettings.liveBuoySymbolHaloScale ?? 0.05)),
  ], [displaySettings.liveBuoySymbolSizeScale, displaySettings.liveBuoySymbolHaloScale]);

  const scaledLiveBuoySymbolOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.liveBuoySymbolOpacityScale ?? 1.0)),
    [displaySettings.liveBuoySymbolOpacityScale]
  );

  const scaledLiveBuoyTextSize = useMemo(() => {
    const baseSize = 12 * (displaySettings.liveBuoyTextSizeScale ?? 1.0);
    return [
      'interpolate', ['linear'], ['zoom'],
      8, baseSize * 0.7,
      12, baseSize
    ];
  }, [displaySettings.liveBuoyTextSizeScale]);

  const scaledLiveBuoyTextHalo = useMemo(() =>
    15 * (displaySettings.liveBuoyTextHaloScale ?? 0.05),
    [displaySettings.liveBuoyTextHaloScale]
  );

  const scaledLiveBuoyTextOpacity = useMemo(() =>
    Math.min(1, Math.max(0, displaySettings.liveBuoyTextOpacityScale ?? 1.0)),
    [displaySettings.liveBuoyTextOpacityScale]
  );

  // ─── Return all values ────────────────────────────────────────────────
  return {
    // Depth expression
    depthTextFieldExpression,
    // Font sizes
    scaledSoundingsFontSize,
    scaledDepthContourFontSize,
    scaledGnisFontSizes,
    // Text halos
    scaledSoundingsHalo,
    scaledGnisHalo,
    scaledDepthContourLabelHalo,
    // Text opacities
    scaledSoundingsOpacity,
    scaledGnisOpacity,
    scaledDepthContourLabelOpacity,
    // Line widths
    scaledDepthContourLineWidth,
    scaledCoastlineLineWidth,
    scaledCableLineWidth,
    scaledPipelineLineWidth,
    scaledBridgeLineWidth,
    scaledMooringLineWidth,
    scaledShorelineConstructionLineWidth,
    // Line halos
    scaledDepthContourLineHalo,
    scaledCoastlineHalo,
    scaledCableLineHalo,
    scaledPipelineLineHalo,
    scaledBridgeLineHalo,
    scaledMooringLineHalo,
    scaledShorelineConstructionHalo,
    // Interpolated line halos
    scaledMooringLineHaloWidth,
    scaledShorelineConstructionHaloWidth,
    scaledDepthContourLineHaloWidth,
    scaledCoastlineHaloWidth,
    // Line opacities
    scaledDepthContourLineOpacity,
    scaledCoastlineOpacity,
    scaledCableLineOpacity,
    scaledPipelineLineOpacity,
    scaledBridgeOpacity,
    scaledMooringOpacity,
    scaledShorelineConstructionOpacity,
    // Area opacities
    scaledDepthAreaOpacity,
    scaledDepthAreaOpacitySatellite,
    scaledRestrictedAreaOpacity,
    scaledCautionAreaOpacity,
    scaledMilitaryAreaOpacity,
    scaledAnchorageOpacity,
    scaledMarineFarmOpacity,
    scaledCableAreaOpacity,
    scaledPipelineAreaOpacity,
    scaledFairwayOpacity,
    scaledDredgedAreaOpacity,
    // Symbol sizes
    scaledLightIconSize,
    scaledBuoyIconSize,
    scaledBuoyHaloSize,
    scaledBeaconIconSize,
    scaledBeaconHaloSize,
    scaledWreckIconSize,
    scaledRockIconSize,
    scaledHazardIconSize,
    scaledLandmarkIconSize,
    scaledLandmarkHaloSize,
    scaledMooringIconSize,
    scaledAnchorIconSize,
    scaledTideRipsIconSize,
    scaledTideRipsHaloSize,
    // Symbol opacities
    scaledLightSymbolOpacity,
    scaledBuoySymbolOpacity,
    scaledBeaconSymbolOpacity,
    scaledWreckSymbolOpacity,
    scaledRockSymbolOpacity,
    scaledHazardSymbolOpacity,
    scaledTideRipsSymbolOpacity,
    scaledLandmarkSymbolOpacity,
    scaledMooringSymbolOpacity,
    scaledAnchorSymbolOpacity,
    // Tide station
    scaledTideStationIconSize,
    scaledTideStationHaloSize,
    scaledTideStationSymbolOpacity,
    scaledTideStationLabelSize,
    scaledTideStationTextHalo,
    scaledTideStationTextOpacity,
    // Current station
    scaledCurrentStationIconSize,
    scaledCurrentStationHaloSize,
    scaledCurrentStationSymbolOpacity,
    scaledCurrentStationLabelSize,
    scaledCurrentStationTextHalo,
    scaledCurrentStationTextOpacity,
    // Live buoy
    scaledLiveBuoyIconSize,
    scaledLiveBuoyHaloSize,
    scaledLiveBuoySymbolOpacity,
    scaledLiveBuoyTextSize,
    scaledLiveBuoyTextHalo,
    scaledLiveBuoyTextOpacity,
  };
}

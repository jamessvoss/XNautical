/**
 * Hook: Tide correction management
 * Subscribes to tide correction updates based on map viewport center.
 */

import { useState, useEffect } from 'react';
import { tideCorrectionService } from '../../../services/tideCorrectionService';
import type { TideStation } from '../../../services/stationService';

export function useTideCorrection(
  tideCorrectedSoundings: boolean,
  centerCoord: [number, number],
  tideStations: TideStation[],
) {
  const [currentTideCorrection, setCurrentTideCorrection] = useState<number>(0);
  const [tideCorrectionStation, setTideCorrectionStation] = useState<TideStation | null>(null);

  useEffect(() => {
    if (!tideCorrectedSoundings) {
      // Setting is off - reset correction and stop updates
      setCurrentTideCorrection(0);
      setTideCorrectionStation(null);
      tideCorrectionService.stopAutoUpdate();
      return;
    }

    // Setting is on - start auto-updating based on map center
    tideCorrectionService.startAutoUpdate(() => {
      if (centerCoord && centerCoord.length === 2) {
        const [lng, lat] = centerCoord;
        console.log('[TideCorrection] Using map center:', lat, lng, 'with', tideStations.length, 'stations');
        return { lat, lng };
      }
      console.log('[TideCorrection] No map center available');
      return null;
    });

    // Subscribe to tide correction updates
    const unsubscribe = tideCorrectionService.subscribe((correction, station) => {
      console.log('[TideCorrection] Updated - correction:', correction, 'meters, station:', station?.name);
      setCurrentTideCorrection(correction);
      setTideCorrectionStation(station);
    });

    return () => {
      unsubscribe();
      tideCorrectionService.stopAutoUpdate();
    };
  }, [tideCorrectedSoundings, centerCoord, tideStations]);

  return { currentTideCorrection, tideCorrectionStation };
}

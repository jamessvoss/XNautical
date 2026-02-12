/**
 * Hook: Station data management
 * Loads tide/current stations and live buoys from storage,
 * calculates icon states, refreshes every 15 minutes.
 */

import { useState, useEffect } from 'react';
import { getCachedTideStations, getCachedCurrentStations, loadFromStorage, TideStation, CurrentStation } from '../../../services/stationService';
import { calculateAllStationStates, createIconNameMap } from '../../../services/stationStateService';
import { getBuoysCatalog, getBuoy, BuoySummary, Buoy } from '../../../services/buoyService';
import { logger, LogCategory } from '../../../services/loggingService';

/** Filter current stations to keep only the highest bin per location. */
function filterHighestBinCurrents(currents: CurrentStation[]): CurrentStation[] {
  const stationsByLocation = new Map<string, CurrentStation[]>();

  for (const station of currents) {
    const locationKey = `${station.lat.toFixed(4)},${station.lng.toFixed(4)}`;
    if (!stationsByLocation.has(locationKey)) {
      stationsByLocation.set(locationKey, []);
    }
    stationsByLocation.get(locationKey)!.push(station);
  }

  const result: CurrentStation[] = [];
  for (const stations of stationsByLocation.values()) {
    if (stations.length === 1) {
      result.push(stations[0]);
    } else {
      const highestBinStation = stations.reduce((best, current) =>
        current.bin > best.bin ? current : best
      );
      result.push(highestBinStation);
    }
  }
  return result;
}

export function useStationData() {
  // Tide and current station data
  const [tideStations, setTideStations] = useState<TideStation[]>([]);
  const [currentStations, setCurrentStations] = useState<CurrentStation[]>([]);

  // Live buoy data
  const [liveBuoys, setLiveBuoys] = useState<BuoySummary[]>([]);
  const [selectedBuoy, setSelectedBuoy] = useState<Buoy | null>(null);
  const [loadingBuoyDetail, setLoadingBuoyDetail] = useState(false);

  // Station icon states (calculated every 15 minutes)
  const [tideIconMap, setTideIconMap] = useState<Map<string, { iconName: string; rotation: number; currentHeight: number | null; targetHeight: number | null }>>(new Map());
  const [currentIconMap, setCurrentIconMap] = useState<Map<string, { iconName: string; rotation: number; currentVelocity: number | null; targetVelocity: number | null; nextSlackTime: string | null }>>(new Map());

  // Station modal state
  const [selectedStation, setSelectedStation] = useState<{
    type: 'tide' | 'current';
    id: string;
    name: string;
  } | null>(null);

  // Detail chart station selection (separate from modal)
  const [detailChartTideStationId, setDetailChartTideStationId] = useState<string | null>(null);
  const [detailChartCurrentStationId, setDetailChartCurrentStationId] = useState<string | null>(null);

  // Handler for buoy clicks
  const handleBuoyClick = async (buoyId: string) => {
    console.log('[BUOY] Clicked:', buoyId);
    setLoadingBuoyDetail(true);
    try {
      const detail = await getBuoy(buoyId);
      setSelectedBuoy(detail);
      console.log('[BUOY] Loaded detail:', detail?.name);
    } catch (error) {
      console.error('[BUOY] Error loading detail:', error);
      setSelectedBuoy(null);
    } finally {
      setLoadingBuoyDetail(false);
    }
  };

  // Load tide and current stations from AsyncStorage on startup
  useEffect(() => {
    const loadStations = async () => {
      try {
        console.log('[MAP] Loading stations from AsyncStorage (if available)...');
        await loadFromStorage();

        const tides = getCachedTideStations();
        const currents = getCachedCurrentStations();

        if (tides.length === 0 && currents.length === 0) {
          console.log('[MAP] No station metadata found - download predictions to see stations');
          setTideStations([]);
          setCurrentStations([]);
          return;
        }

        console.log(`[MAP] Loaded ${tides.length} tide stations and ${currents.length} current stations from AsyncStorage`);

        const filteredCurrents = filterHighestBinCurrents(currents);

        if (tides.length > 0 || filteredCurrents.length > 0) {
          logger.info(LogCategory.CHARTS, `Loaded ${tides.length} tide stations and ${filteredCurrents.length} current stations (highest bin only) from storage`);

          if (tides.length > 0) {
            console.log('[MAP] Sample tide station:', {
              id: tides[0].id, name: tides[0].name,
              lat: tides[0].lat, lng: tides[0].lng
            });
          }
          if (filteredCurrents.length > 0) {
            console.log('[MAP] Sample current station:', {
              id: filteredCurrents[0].id, name: filteredCurrents[0].name,
              lat: filteredCurrents[0].lat, lng: filteredCurrents[0].lng,
              bin: filteredCurrents[0].bin
            });
          }

          setTideStations(tides);
          setCurrentStations(filteredCurrents);
          console.log(`[MAP] Successfully set ${tides.length} tide stations and ${filteredCurrents.length} current stations into state`);
        } else {
          console.log('[MAP] No stations in storage - user needs to press "Refresh Tide Data" in Settings');
        }
      } catch (error) {
        logger.error(LogCategory.CHARTS, 'Error loading stations', error as Error);
        console.error('[MAP] Error loading stations:', error);
      }
    };

    loadStations();
  }, []);

  // Calculate station icon states (runs every 15 minutes)
  useEffect(() => {
    if (tideStations.length === 0 && currentStations.length === 0) {
      return;
    }

    const updateStationStates = async () => {
      try {
        console.log('[MAP] Calculating station icon states...');
        const states = await calculateAllStationStates(tideStations, currentStations);
        const iconMaps = createIconNameMap(states);

        setTideIconMap(iconMaps.tides);
        setCurrentIconMap(iconMaps.currents);

        console.log(`[MAP] Updated icon states: ${iconMaps.tides.size} tide, ${iconMaps.currents.size} current`);
      } catch (error) {
        console.error('[MAP] Error calculating station states:', error);
      }
    };

    updateStationStates();
    const intervalId = setInterval(updateStationStates, 15 * 60 * 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [tideStations, currentStations]);

  // Load live buoys catalog
  useEffect(() => {
    const loadBuoys = async () => {
      try {
        console.log('[MAP] Loading live buoys catalog...');
        const allBuoys = await getBuoysCatalog();
        setLiveBuoys(allBuoys);
        console.log(`[MAP] Loaded ${allBuoys.length} live buoys`);
      } catch (error) {
        console.warn('[MAP] Error loading buoys:', error);
      }
    };

    loadBuoys();
  }, []);

  /** Reload stations (called from focus effect when predictions change). */
  const reloadStations = async () => {
    await loadFromStorage();
    const tides = getCachedTideStations();
    const currents = getCachedCurrentStations();

    console.log(`[MAP] Reloaded ${tides.length} tide stations and ${currents.length} current stations after prediction download`);

    const filteredCurrents = filterHighestBinCurrents(currents);

    setTideStations(tides);
    setCurrentStations(filteredCurrents);

    console.log(`[MAP] Filtered ${currents.length} current stations to ${filteredCurrents.length} (highest bin per location)`);
  };

  return {
    tideStations,
    currentStations,
    liveBuoys,
    selectedBuoy,
    setSelectedBuoy,
    loadingBuoyDetail,
    tideIconMap,
    currentIconMap,
    selectedStation,
    setSelectedStation,
    detailChartTideStationId,
    setDetailChartTideStationId,
    detailChartCurrentStationId,
    setDetailChartCurrentStationId,
    handleBuoyClick,
    reloadStations,
  };
}

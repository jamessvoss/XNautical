/**
 * Hook: Station data management
 * Loads tide/current stations and live buoys from storage,
 * calculates icon states, refreshes every 15 minutes.
 */

import { useState, useEffect } from 'react';
import { getCachedTideStations, getCachedCurrentStations, loadStationsFromDatabases, clearStationCache, TideStation, CurrentStation } from '../../../services/stationService';
import { calculateAllStationStates, createIconNameMap } from '../../../services/stationStateService';
import { getCachedBuoyCatalog, getBuoy, BuoySummary, Buoy } from '../../../services/buoyService';
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
  const [tideIconMap, setTideIconMap] = useState<Map<string, { iconName: string; rotation: number; currentHeight: number | null; targetHeight: number | null; positionSlot: number; tickEvents?: Array<{ type: 'H' | 'L'; angleSlot: number; label: string; time: string; value: string }> }>>(new Map());
  const [currentIconMap, setCurrentIconMap] = useState<Map<string, { iconName: string; rotation: number; currentVelocity: number | null; targetVelocity: number | null; nextSlackTime: string | null; positionSlot: number; tickEvents?: Array<{ type: 'slack' | 'flood' | 'ebb'; angleSlot: number; label: string; time: string; value: string }> }>>(new Map());

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
    setLoadingBuoyDetail(true);
    try {
      const detail = await getBuoy(buoyId);
      setSelectedBuoy(detail);
    } catch (error) {
      console.error('[BUOY] Error loading detail:', error);
      setSelectedBuoy(null);
    } finally {
      setLoadingBuoyDetail(false);
    }
  };

  // Load tide and current stations from prediction databases on startup
  useEffect(() => {
    const loadStations = async () => {
      try {
        await loadStationsFromDatabases();

        const tides = getCachedTideStations();
        const currents = getCachedCurrentStations();

        if (tides.length === 0 && currents.length === 0) {
          setTideStations([]);
          setCurrentStations([]);
          return;
        }

        const filteredCurrents = filterHighestBinCurrents(currents);

        if (tides.length > 0 || filteredCurrents.length > 0) {
          logger.info(LogCategory.CHARTS, `Stations: ${tides.length} tide, ${filteredCurrents.length} current`);
          logger.setStartupParam('stationCounts', `${tides.length} tide, ${filteredCurrents.length} current`);
          setTideStations(tides);
          setCurrentStations(filteredCurrents);
        }
      } catch (error) {
        logger.error(LogCategory.CHARTS, 'Error loading stations', error as Error);
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
        const states = await calculateAllStationStates(tideStations, currentStations);
        const iconMaps = createIconNameMap(states);

        setTideIconMap(iconMaps.tides);
        setCurrentIconMap(iconMaps.currents);
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

  // Load live buoys catalog from downloaded districts only
  useEffect(() => {
    const loadBuoys = async () => {
      try {
        // Get list of downloaded districts
        const { getInstalledDistricts } = await import('../../../services/regionRegistryService');
        const installedDistricts = await getInstalledDistricts();

        if (installedDistricts.length === 0) {
          setLiveBuoys([]);
          return;
        }

        // Load cached buoys for each downloaded district
        const allBuoys: BuoySummary[] = [];
        for (const district of installedDistricts) {
          const buoys = await getCachedBuoyCatalog(district.districtId);
          allBuoys.push(...buoys);
        }

        setLiveBuoys(allBuoys);
        if (allBuoys.length > 0) {
          logger.debug(LogCategory.CHARTS, `Buoys: ${allBuoys.length} from ${installedDistricts.length} districts`);
        }
      } catch (error) {
        console.warn('[MAP] Error loading buoys:', error);
        setLiveBuoys([]);
      }
    };

    loadBuoys();
  }, []);

  /** Reload stations (called from focus effect when predictions change). */
  const reloadStations = async () => {
    clearStationCache();
    await loadStationsFromDatabases();
    const tides = getCachedTideStations();
    const currents = getCachedCurrentStations();
    const filteredCurrents = filterHighestBinCurrents(currents);

    setTideStations(tides);
    setCurrentStations(filteredCurrents);
    logger.info(LogCategory.CHARTS, `Stations reloaded: ${tides.length} tide, ${filteredCurrents.length} current`);
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

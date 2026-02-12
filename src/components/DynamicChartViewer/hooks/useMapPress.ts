/**
 * Hook: Map press handling
 * Tap handling, feature query, feature selection, long-press for waypoints/routes.
 */

import { useState, useCallback, useMemo, useEffect, useRef, startTransition } from 'react';
import { logger, LogCategory } from '../../../services/loggingService';
import { performanceTracker, RuntimeMetric } from '../../../services/performanceTracker';
import { OBJL_PRIORITIES, LAYER_DISPLAY_NAMES, getLayerName } from '../constants';
import { formatFeatureProperties } from '../utils/featureFormatting';
import type { FeatureInfo, LayerVisibility } from '../types';
import type { DisplaySettings } from '../../../services/displaySettingsService';

interface UseMapPressParams {
  mapRef: React.RefObject<any>;
  layers: LayerVisibility;
  chartsAtZoom: { chartId: string }[];
  displaySettings: DisplaySettings;
  activeRoute: any;
  addPointToActiveRoute: (point: { latitude: number; longitude: number }) => void;
  openWaypointCreation: (lng: number, lat: number) => void;
  dispatchLayers: (action: any) => void;
  handleBuoyClick: (buoyId: string) => void;
  setDetailChartTideStationId: (id: string | null) => void;
  setDetailChartCurrentStationId: (id: string | null) => void;
}

export function useMapPress({
  mapRef,
  layers,
  chartsAtZoom,
  displaySettings,
  activeRoute,
  addPointToActiveRoute,
  openWaypointCreation,
  dispatchLayers,
  handleBuoyClick,
  setDetailChartTideStationId,
  setDetailChartCurrentStationId,
}: UseMapPressParams) {
  // Selection state
  const [selectedFeature, setSelectedFeature] = useState<FeatureInfo | null>(null);
  const [featureChoices, setFeatureChoices] = useState<FeatureInfo[] | null>(null);

  // Route editor state
  const [showRouteEditor, setShowRouteEditor] = useState(false);

  // Tap timing ref
  const tapStartTimeRef = useRef<number>(0);

  // Memoized close callback
  const closeFeatureInspector = useCallback(() => {
    setSelectedFeature(null);
  }, []);

  // Destructure visibility flags
  const {
    depthAreas: showDepthAreas,
    depthContours: showDepthContours,
    soundings: showSoundings,
    land: showLand,
    coastline: showCoastline,
    lights: showLights,
    buoys: showBuoys,
    beacons: showBeacons,
    landmarks: showLandmarks,
    hazards: showHazards,
    cables: showCables,
    seabed: showSeabed,
    pipelines: showPipelines,
    restrictedAreas: showRestrictedAreas,
    cautionAreas: showCautionAreas,
    militaryAreas: showMilitaryAreas,
    anchorages: showAnchorages,
    marineFarms: showMarineFarms,
    bridges: showBridges,
    buildings: showBuildings,
    moorings: showMoorings,
    shorelineConstruction: showShorelineConstruction,
    seaAreaNames: showSeaAreaNames,
    landRegions: showLandRegions,
  } = layers;

  // Handler for special feature select (tide/current station, buoy)
  const handleSpecialFeatureSelect = useCallback((feature: FeatureInfo) => {
    const specialType = feature.properties?._specialType;
    const id = feature.properties?.id as string | undefined;
    if (!id) return;

    switch (specialType) {
      case 'tideStation':
        console.log('[TIDE PIN SELECT] Station:', id);
        setDetailChartTideStationId(id);
        dispatchLayers({ type: 'SET', layer: 'tideDetails', value: true });
        break;
      case 'currentStation':
        console.log('[CURRENT PIN SELECT] Station:', id);
        setDetailChartCurrentStationId(id);
        dispatchLayers({ type: 'SET', layer: 'currentDetails', value: true });
        break;
      case 'liveBuoy':
        console.log('[BUOY PIN SELECT] Buoy:', id);
        handleBuoyClick(id);
        break;
    }
  }, [dispatchLayers, handleBuoyClick, setDetailChartTideStationId, setDetailChartCurrentStationId]);

  // Queryable layer IDs — built from chartsAtZoom and visibility state
  const queryableLayerIds = useMemo(() => {
    const layerTypes: { type: string; visible: boolean }[] = [
      { type: 'lights', visible: showLights },
      { type: 'buoys', visible: showBuoys },
      { type: 'beacons', visible: showBeacons },
      { type: 'wrecks', visible: showHazards },
      { type: 'uwtroc', visible: showHazards },
      { type: 'obstrn', visible: showHazards },
      { type: 'lndmrk', visible: showLandmarks },
      { type: 'soundg', visible: showSoundings },
      { type: 'cblsub', visible: showCables },
      { type: 'pipsol', visible: showPipelines },
      { type: 'depcnt', visible: showDepthContours },
      { type: 'coalne', visible: showCoastline },
      { type: 'resare', visible: showRestrictedAreas },
      { type: 'ctnare', visible: showCautionAreas },
      { type: 'mipare', visible: showMilitaryAreas },
      { type: 'achare', visible: showAnchorages },
      { type: 'achbrt', visible: showAnchorages },
      { type: 'marcul', visible: showMarineFarms },
      { type: 'cblare', visible: showCables },
      { type: 'pipare', visible: showPipelines },
      { type: 'sbdare', visible: showSeabed },
      { type: 'bridge', visible: showBridges },
      { type: 'buisgl', visible: showBuildings },
      { type: 'morfac', visible: showMoorings },
      { type: 'slcons', visible: showShorelineConstruction },
      { type: 'seaare', visible: showSeaAreaNames },
      { type: 'lndrgn', visible: showLandRegions },
    ];

    const ids: string[] = [];
    const visibleTypes = layerTypes.filter(l => l.visible).map(l => l.type);
    for (const chart of chartsAtZoom) {
      for (const layerType of visibleTypes) {
        ids.push(`mbtiles-${layerType}-${chart.chartId}`);
      }
    }
    return ids;
  }, [chartsAtZoom,
      showLights, showBuoys, showBeacons, showHazards, showLandmarks, showSoundings,
      showCables, showPipelines, showDepthContours, showCoastline,
      showRestrictedAreas, showCautionAreas, showMilitaryAreas, showAnchorages,
      showMarineFarms, showSeabed, showBridges, showBuildings, showMoorings,
      showShorelineConstruction, showSeaAreaNames, showLandRegions]);

  // Handle map press — query features at tap location
  const handleMapPress = useCallback(async (e: any) => {
    const perfStart = Date.now();
    tapStartTimeRef.current = perfStart;
    const endTapMetric = performanceTracker.startMetric(RuntimeMetric.MAP_TAP);

    setFeatureChoices(null);
    setSelectedFeature(null);

    if (!mapRef.current) return;
    const { geometry } = e;
    if (!geometry?.coordinates) return;

    const [longitude, latitude] = geometry.coordinates;
    logger.debug(LogCategory.UI, `Map tap at: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);

    const screenX = Math.round(e.properties?.screenPointX || 0);
    const screenY = Math.round(e.properties?.screenPointY || 0);

    try {
      const tolerance = 22;
      const bbox: [number, number, number, number] = [
        screenY - tolerance, screenX + tolerance,
        screenY + tolerance, screenX - tolerance,
      ];

      const queryStart = Date.now();
      const allFeatures = await mapRef.current.queryRenderedFeaturesInRect(bbox, undefined, []);
      const queryTime = Date.now() - queryStart;
      logger.debug(LogCategory.UI, `Feature query: ${queryTime}ms (${allFeatures?.features?.length || 0} raw features)`);

      // Collect special features (tide/current stations, live buoys)
      const specialFeatures: FeatureInfo[] = [];
      const seenSpecialIds = new Set<string>();

      if (allFeatures?.features) {
        for (const feature of allFeatures.features) {
          const props = feature.properties;

          if (props?.bin !== undefined && props?.id && props?.name) {
            const key = `current-${props.id}`;
            if (!seenSpecialIds.has(key)) {
              seenSpecialIds.add(key);
              specialFeatures.push({
                type: 'Current Station',
                properties: { ...props, _specialType: 'currentStation', _tapCoordinates: `${latitude.toFixed(5)}°, ${longitude.toFixed(5)}°` },
              });
            }
          } else if (props?.type === 'tide_prediction' && props?.id && props?.name) {
            const key = `tide-${props.id}`;
            if (!seenSpecialIds.has(key)) {
              seenSpecialIds.add(key);
              specialFeatures.push({
                type: 'Tide Station',
                properties: { ...props, _specialType: 'tideStation', OBJNAM: props.name, _tapCoordinates: `${latitude.toFixed(5)}°, ${longitude.toFixed(5)}°` },
              });
            }
          } else if (props?.isLiveBuoy && props?.id) {
            const key = `buoy-${props.id}`;
            if (!seenSpecialIds.has(key)) {
              seenSpecialIds.add(key);
              specialFeatures.push({
                type: 'Wx Buoy',
                properties: { ...props, _specialType: 'liveBuoy', OBJNAM: props.name, _tapCoordinates: `${latitude.toFixed(5)}°, ${longitude.toFixed(5)}°` },
              });
            }
          }
        }
      }

      // OBJL visibility map
      const objlVisibility: Record<number, boolean> = {
        75: showLights,
        14: showBuoys, 15: showBuoys, 16: showBuoys, 17: showBuoys, 18: showBuoys, 19: showBuoys,
        8: showBeacons, 9: showBeacons, 6: showBeacons, 7: showBeacons, 5: showBeacons,
        159: showHazards, 153: showHazards, 86: showHazards,
        74: showLandmarks,
        129: false, // Soundings excluded
        22: showCables, 21: showCables, 20: showCables,
        94: showPipelines, 92: showPipelines,
        43: false, // Depth contours excluded
        30: showCoastline,
        112: showRestrictedAreas,
        27: showCautionAreas,
        83: showMilitaryAreas,
        4: showAnchorages, 3: showAnchorages,
        82: showMarineFarms,
        114: showSeabed,
        11: showBridges,
        12: showBuildings,
        84: showMoorings,
        122: showShorelineConstruction,
        42: false, // Depth areas excluded
        71: showLand,
      };

      // Filter to features from visible layers
      const features = {
        features: (allFeatures?.features || []).filter((f: any) => {
          const objl = f.properties?.OBJL;
          if (!objl) return false;
          if (objl === 129 || objl === 43) return false;
          return objlVisibility[objl] !== false;
        })
      };

      if (features?.features?.length > 0) {
        const featuresByType = new Map<number, any>();
        for (const feature of features.features) {
          const props = feature.properties || {};
          const objl = props.OBJL;
          if (!objl) continue;

          const existing = featuresByType.get(objl);
          if (!existing) {
            featuresByType.set(objl, feature);
          } else {
            const existingIsPoint = existing.geometry?.type === 'Point';
            const newIsPoint = feature.geometry?.type === 'Point';
            if (newIsPoint && !existingIsPoint) {
              featuresByType.set(objl, feature);
            }
          }
        }

        const uniqueFeatures: FeatureInfo[] = [];
        for (const [, feature] of featuresByType) {
          const props = feature.properties || {};
          const layer = getLayerName(props);
          uniqueFeatures.push({
            type: LAYER_DISPLAY_NAMES[layer] || layer,
            properties: { ...props, _tapCoordinates: `${latitude.toFixed(5)}°, ${longitude.toFixed(5)}°` },
          });
        }

        uniqueFeatures.sort((a, b) => {
          const objlA = Number(a.properties?.OBJL) || 0;
          const objlB = Number(b.properties?.OBJL) || 0;
          const prioA = OBJL_PRIORITIES.get(objlA) ?? 0;
          const prioB = OBJL_PRIORITIES.get(objlB) ?? 0;
          return prioB - prioA;
        });

        const allTapFeatures = [...specialFeatures, ...uniqueFeatures];

        if (allTapFeatures.length === 1) {
          const feature = allTapFeatures[0];
          if (feature.properties?._specialType) {
            handleSpecialFeatureSelect(feature);
          } else {
            startTransition(() => {
              setFeatureChoices(null);
              setSelectedFeature(feature);
            });
          }
        } else if (allTapFeatures.length > 1) {
          startTransition(() => {
            setSelectedFeature(null);
            setFeatureChoices(allTapFeatures);
          });
        }
      } else if (specialFeatures.length > 0) {
        if (specialFeatures.length === 1) {
          handleSpecialFeatureSelect(specialFeatures[0]);
        } else {
          startTransition(() => {
            setSelectedFeature(null);
            setFeatureChoices(specialFeatures);
          });
        }
      }
    } catch (error) {
      logger.error(LogCategory.UI, 'Error querying features', error as Error);
    }

    endTapMetric();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryableLayerIds, showLights, showBuoys, showBeacons, showHazards, showLandmarks,
      showSoundings, showCables, showPipelines, showDepthContours, showCoastline,
      showRestrictedAreas, showCautionAreas, showMilitaryAreas, showAnchorages,
      showMarineFarms, showSeabed, showBridges, showBuildings, showMoorings,
      showShorelineConstruction, showDepthAreas, showLand, handleSpecialFeatureSelect, mapRef]);

  // Handle map long press — create waypoint or add to route
  const handleMapLongPress = useCallback((e: any) => {
    const { geometry } = e;
    if (!geometry?.coordinates) return;

    const [longitude, latitude] = geometry.coordinates;
    console.log(`[DynamicChartViewer] Long press at: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);

    if (activeRoute) {
      addPointToActiveRoute({ latitude, longitude });
      console.log('[DynamicChartViewer] Added point to active route');
      if (!showRouteEditor) {
        setShowRouteEditor(true);
      }
    } else {
      openWaypointCreation(longitude, latitude);
    }
  }, [openWaypointCreation, activeRoute, addPointToActiveRoute, showRouteEditor]);

  // Show route editor when active route has points
  useEffect(() => {
    if (activeRoute && activeRoute.routePoints.length > 0 && !showRouteEditor) {
      setShowRouteEditor(true);
    } else if (!activeRoute && showRouteEditor) {
      setShowRouteEditor(false);
    }
  }, [activeRoute, showRouteEditor]);

  // Memoized formatted feature properties
  const formattedFeatureProps = useMemo(() => {
    if (!selectedFeature) return null;
    const result = formatFeatureProperties(selectedFeature, displaySettings.depthUnits);
    return Object.entries(result);
  }, [selectedFeature, displaySettings.depthUnits]);

  // Track when info box renders
  useEffect(() => {
    if (selectedFeature && tapStartTimeRef.current > 0) {
      tapStartTimeRef.current = 0;
    }
  }, [selectedFeature]);

  return {
    selectedFeature,
    setSelectedFeature,
    featureChoices,
    setFeatureChoices,
    closeFeatureInspector,
    showRouteEditor,
    setShowRouteEditor,
    handleMapPress,
    handleMapLongPress,
    handleSpecialFeatureSelect,
    formattedFeatureProps,
    queryableLayerIds,
  };
}

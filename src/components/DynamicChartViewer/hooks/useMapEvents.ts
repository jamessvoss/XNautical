/**
 * Hook: Map event handlers
 * Camera change handling (throttled), zoom tracking, scale bar calculation,
 * MapLibre lifecycle callbacks, GPS follow mode.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { logger, LogCategory } from '../../../services/loggingService';
import { performanceTracker, RuntimeMetric } from '../../../services/performanceTracker';

interface UseMapEventsParams {
  mapRef: React.RefObject<any>;
  limitZoomToCharts: boolean;
  effectiveMaxZoom: number;
  styleSwitchStartRef: React.MutableRefObject<number>;
}

export function useMapEvents({
  mapRef,
  limitZoomToCharts,
  effectiveMaxZoom,
  styleSwitchStartRef,
}: UseMapEventsParams) {
  // UI state
  const [currentZoom, setCurrentZoom] = useState(8);
  const [centerCoord, setCenterCoord] = useState<[number, number]>([-151.55, 59.64]);
  const [, setIsAtMaxZoom] = useState(false);

  // GPS follow state
  const [followGPS, setFollowGPS] = useState(false);
  const followGPSRef = useRef(false);
  const isProgrammaticCameraMove = useRef(false);

  // Throttle refs for camera change handler (100ms)
  const lastCameraUpdateRef = useRef<number>(0);
  const pendingCameraStateRef = useRef<any>(null);
  const throttleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Query warm-up ref
  const queryWarmupDoneRef = useRef(false);

  // Style switch render tracking
  const styleRenderFrameCountRef = useRef<number>(0);

  // Sync follow GPS ref with state
  useEffect(() => {
    followGPSRef.current = followGPS;
  }, [followGPS]);

  // Cleanup throttle timeout on unmount
  useEffect(() => {
    return () => {
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
      }
    };
  }, []);

  // Process camera state updates (extracted for throttling)
  const processCameraState = useCallback((feature: any) => {
    if (feature?.geometry?.coordinates) {
      const [lng, lat] = feature.geometry.coordinates;
      setCenterCoord([lng, lat]);
    }
    const zoom = feature?.properties?.zoomLevel ?? feature?.properties?.zoom;
    if (zoom !== undefined) {
      const roundedZoom = Math.round(zoom * 10) / 10;
      setCurrentZoom(roundedZoom);
      setIsAtMaxZoom(limitZoomToCharts && roundedZoom >= effectiveMaxZoom - 0.1);
    }
  }, [limitZoomToCharts, effectiveMaxZoom]);

  // Handle map idle
  const handleMapIdle = useCallback((state: any) => {
    // Style switch completion tracking
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      logger.perf(LogCategory.UI, `Style switch complete: ${elapsed}ms`);
      performanceTracker.recordMetric(RuntimeMetric.STYLE_SWITCH, elapsed);
      styleSwitchStartRef.current = 0;
    }

    if (state?.properties?.zoom !== undefined) {
      setCurrentZoom(Math.round(state.properties.zoom * 10) / 10);
    }
    if (state?.properties?.center) {
      setCenterCoord(state.properties.center);
    }

    // Warm up query cache on first idle
    if (!queryWarmupDoneRef.current && mapRef.current) {
      queryWarmupDoneRef.current = true;
      logger.debug(LogCategory.STARTUP, 'Warming up query cache...');
      const warmupStart = Date.now();
      mapRef.current.queryRenderedFeaturesAtPoint([100, 100], undefined, [])
        .then(() => {
          logger.perf(LogCategory.STARTUP, `Query cache warmed up in ${Date.now() - warmupStart}ms`);
        })
        .catch(() => {
          // Ignore errors
        });
    }
  }, [mapRef, styleSwitchStartRef]);

  // Handle camera changes — throttled to max once per 100ms
  const handleCameraChanged = useCallback((feature: any) => {
    const THROTTLE_MS = 100;
    const now = Date.now();

    pendingCameraStateRef.current = feature;

    if (now - lastCameraUpdateRef.current >= THROTTLE_MS) {
      lastCameraUpdateRef.current = now;
      processCameraState(feature);
      pendingCameraStateRef.current = null;

      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
        throttleTimeoutRef.current = null;
      }
    } else if (!throttleTimeoutRef.current) {
      const remainingTime = THROTTLE_MS - (now - lastCameraUpdateRef.current);
      throttleTimeoutRef.current = setTimeout(() => {
        if (pendingCameraStateRef.current) {
          lastCameraUpdateRef.current = Date.now();
          processCameraState(pendingCameraStateRef.current);
          pendingCameraStateRef.current = null;
        }
        throttleTimeoutRef.current = null;
      }, remainingTime);
    }
  }, [processCameraState]);

  // Detect user panning (region will change)
  const handleRegionWillChange = useCallback(() => {
    if (isProgrammaticCameraMove.current) return;
    if (followGPSRef.current) {
      followGPSRef.current = false;
      setFollowGPS(false);
    }
  }, []);

  // Scale bar calculation
  const scaleBarData = useMemo(() => {
    const lat = centerCoord[1];
    const metersPerPixel = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, currentZoom);

    const METERS_PER_NM = 1852;
    const targetWidthPx = 100;
    const targetDistanceM = metersPerPixel * targetWidthPx;
    const targetDistanceNM = targetDistanceM / METERS_PER_NM;

    const niceValues = [
      0.01, 0.02, 0.05,
      0.1, 0.2, 0.5,
      1, 2, 5,
      10, 20, 50,
      100, 200, 500,
      1000, 2000, 5000,
    ];

    let bestNM = niceValues[0];
    let bestDiff = Math.abs(Math.log(targetDistanceNM) - Math.log(niceValues[0]));
    for (const v of niceValues) {
      const diff = Math.abs(Math.log(targetDistanceNM) - Math.log(v));
      if (diff < bestDiff) {
        bestDiff = diff;
        bestNM = v;
      }
    }

    const barWidthPx = (bestNM * METERS_PER_NM) / metersPerPixel;

    let label: string;
    if (bestNM >= 1) {
      label = `${bestNM} nm`;
    } else {
      if (bestNM < 0.05) {
        const feet = Math.round(bestNM * METERS_PER_NM * 3.28084);
        label = `${feet} ft`;
      } else {
        label = `${bestNM} nm`;
      }
    }

    return { barWidthPx: Math.round(barWidthPx), label };
  }, [currentZoom, centerCoord]);

  // MapLibre lifecycle callbacks for style switch tracking
  const handleWillStartLoadingMap = useCallback(() => {
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      logger.debug(LogCategory.UI, `Style switch: onWillStartLoadingMap (${elapsed}ms)`);
    }
  }, [styleSwitchStartRef]);

  const handleDidFinishLoadingMap = useCallback(() => {
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      logger.debug(LogCategory.UI, `Style switch: onDidFinishLoadingMap (${elapsed}ms)`);
    }
  }, [styleSwitchStartRef]);

  const handleDidFailLoadingMap = useCallback((error: any) => {
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      logger.error(LogCategory.UI, `Style switch failed (${elapsed}ms)`, error);
    }
  }, [styleSwitchStartRef]);

  const handleDidFinishLoadingStyle = useCallback(() => {
    try {
      if (styleSwitchStartRef.current > 0) {
        const elapsed = Date.now() - styleSwitchStartRef.current;
        logger.debug(LogCategory.UI, `Style switch: onDidFinishLoadingStyle (${elapsed}ms)`);
      }
    } catch (error) {
      logger.error(LogCategory.UI, 'Error in handleDidFinishLoadingStyle callback', error as Error);
    }
  }, [styleSwitchStartRef]);

  const handleDidFinishRenderingFrame = useCallback(() => {
    if (styleSwitchStartRef.current > 0) {
      styleRenderFrameCountRef.current++;
      if (styleRenderFrameCountRef.current <= 3) {
        const elapsed = Date.now() - styleSwitchStartRef.current;
        logger.debug(LogCategory.UI, `Style switch: render frame #${styleRenderFrameCountRef.current} (${elapsed}ms)`);
      }
    }
  }, [styleSwitchStartRef]);

  const handleDidFinishRenderingFrameFully = useCallback(() => {
    if (styleSwitchStartRef.current > 0) {
      const elapsed = Date.now() - styleSwitchStartRef.current;
      logger.debug(LogCategory.UI, `Style switch: fully rendered (${elapsed}ms)`);
      styleSwitchStartRef.current = 0;
      styleRenderFrameCountRef.current = 0;
    }
  }, [styleSwitchStartRef]);

  return {
    // State
    currentZoom,
    centerCoord,
    followGPS,
    setFollowGPS,
    isProgrammaticCameraMove,
    // Handlers
    handleMapIdle,
    handleCameraChanged,
    handleRegionWillChange,
    // Scale bar
    scaleBarData,
    // Lifecycle callbacks
    handleWillStartLoadingMap,
    handleDidFinishLoadingMap,
    handleDidFailLoadingMap,
    handleDidFinishLoadingStyle,
    handleDidFinishRenderingFrame,
    handleDidFinishRenderingFrameFully,
  };
}

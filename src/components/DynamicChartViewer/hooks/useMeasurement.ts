import { useState, useCallback, useMemo } from 'react';
import { computeLegs, type LatLng, type MeasurementLeg } from '../../../utils/measurementUtils';

export function useMeasurement() {
  const [isMeasureMode, setIsMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<LatLng[]>([]);
  const [selectedMeasurePoint, setSelectedMeasurePoint] = useState<number | null>(null);

  const legs = useMemo(() => computeLegs(measurePoints), [measurePoints]);
  const totalDistanceNm = legs.length > 0 ? legs[legs.length - 1].cumulativeNm : 0;

  const toggleMeasureMode = useCallback(() => {
    setIsMeasureMode(prev => {
      if (prev) {
        // Exiting: clear everything
        setMeasurePoints([]);
        setSelectedMeasurePoint(null);
      }
      return !prev;
    });
  }, []);

  const addPoint = useCallback((point: LatLng) => {
    setMeasurePoints(prev => [...prev, point]);
    setSelectedMeasurePoint(null);
  }, []);

  const undoLastPoint = useCallback(() => {
    setMeasurePoints(prev => prev.slice(0, -1));
    setSelectedMeasurePoint(null);
  }, []);

  const removePoint = useCallback((index: number) => {
    setMeasurePoints(prev => prev.filter((_, i) => i !== index));
    setSelectedMeasurePoint(null);
  }, []);

  const clearAll = useCallback(() => {
    setMeasurePoints([]);
    setSelectedMeasurePoint(null);
  }, []);

  const selectPoint = useCallback((index: number | null) => {
    setSelectedMeasurePoint(index);
  }, []);

  return {
    isMeasureMode,
    measurePoints,
    selectedMeasurePoint,
    legs,
    totalDistanceNm,
    toggleMeasureMode,
    addPoint,
    undoLastPoint,
    removePoint,
    clearAll,
    selectPoint,
  };
}

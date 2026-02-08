/**
 * GPS & Sensors Dashboard
 * 
 * Comprehensive instrument panel with a unified Primary Flight Display (PFD)
 * combining attitude indicator, heading tape, and speed/altitude tapes
 * into a single glass-cockpit-style instrument -- like a Garmin G1000 or Boeing 787.
 * 
 * Features:
 * - Unified PFD with attitude, heading tape, speed/altitude tapes
 * - Inline lat/lon position with tappable coordinate format cycling
 * - Pitch, roll, and g-force readout bar
 * - Magnetometer, barometer, accelerometer readouts
 * - Signal quality display
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  TouchableOpacity,
  Platform,
} from 'react-native';
import Svg, {
  Line,
  Rect,
  Text as SvgText,
  G,
  Polygon,
  Polyline,
  Defs,
  LinearGradient,
  Stop,
  ClipPath,
} from 'react-native-svg';
import {
  Magnetometer,
  Barometer,
  DeviceMotion,
  type DeviceMotionMeasurement,
} from 'expo-sensors';
import { useOverlay } from '../contexts/OverlayContext';
import { Ionicons } from '@expo/vector-icons';
import { useGnssSatellites } from '../hooks/useGnssSatellites';

// ─────────────────────────────────────────────────────────────
// Types & Constants
// ─────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SPARKLINE_POINTS = 60;

// Primary Flight Display dimensions
const PFD_W = SCREEN_WIDTH - 32;
const PFD_ATT_H = Math.round(PFD_W * 0.72);
const PFD_HDG_H = 44;
const PFD_TAPE_W = 56;
const PFD_GAP = 8;
const PFD_SVG_H = PFD_ATT_H + PFD_GAP + PFD_HDG_H;

// Satellite bar chart
const SAT_MAX_SNR = 50;
const SAT_BAR_H = 50;

// Full constellation pool (50 satellites across 4 GNSS systems)
const ALL_GPS_PRNS = ['G02','G04','G05','G07','G09','G12','G13','G15','G16','G18','G20','G21','G24','G25','G26','G27','G29','G30','G31','G32'];
const ALL_GLONASS_PRNS = ['R01','R02','R03','R07','R08','R09','R10','R12','R15','R17','R18','R19','R20','R21','R24'];
const ALL_GALILEO_PRNS = ['E01','E02','E03','E04','E05','E07','E08','E09','E11','E12','E13','E19','E24','E25','E26','E30','E31','E33'];
const ALL_BEIDOU_PRNS = ['C06','C07','C08','C10','C11','C12','C14','C16','C19','C20','C21','C23','C27','C29','C30'];

// Deterministic per-channel seeds (50 values to support max satellites)
const SAT_SEEDS = [
  0.82, 0.45, 0.91, 0.33, 0.73, 0.58, 0.87, 0.22, 0.76, 0.52,
  0.95, 0.41, 0.68, 0.79, 0.35, 0.62, 0.48, 0.85, 0.71, 0.38,
  0.93, 0.55, 0.27, 0.64, 0.81, 0.44, 0.89, 0.31, 0.67, 0.53,
  0.92, 0.39, 0.74, 0.60, 0.84, 0.28, 0.70, 0.51, 0.88, 0.36,
  0.78, 0.47, 0.90, 0.34, 0.69, 0.56, 0.83, 0.25, 0.75, 0.49,
];

/** Generate visible satellite list based on GPS accuracy (mimics real receiver behavior) */
function generateVisibleSatellites(accuracy: number | null): string[] {
  if (accuracy === null) return [];
  
  // Determine constellation sizes by accuracy bracket
  let gpsCount: number, glonassCount: number, galileoCount: number, beidouCount: number;
  if (accuracy <= 3) {
    gpsCount = 16; glonassCount = 10; galileoCount = 9; beidouCount = 6; // 41 total
  } else if (accuracy <= 8) {
    gpsCount = 14; glonassCount = 9; galileoCount = 7; beidouCount = 5; // 35 total
  } else if (accuracy <= 15) {
    gpsCount = 12; glonassCount = 7; galileoCount = 6; beidouCount = 4; // 29 total
  } else if (accuracy <= 30) {
    gpsCount = 10; glonassCount = 6; galileoCount = 4; beidouCount = 3; // 23 total
  } else {
    gpsCount = 8; glonassCount = 4; galileoCount = 3; beidouCount = 2; // 17 total
  }
  
  // Deterministically select satellites (same accuracy = same satellites)
  return [
    ...ALL_GPS_PRNS.slice(0, gpsCount),
    ...ALL_GLONASS_PRNS.slice(0, glonassCount),
    ...ALL_GALILEO_PRNS.slice(0, galileoCount),
    ...ALL_BEIDOU_PRNS.slice(0, beidouCount),
  ];
}

// Color palette
const C = {
  bg: '#1a1f2e',
  cardBg: 'rgba(255, 255, 255, 0.05)',
  cardBorder: 'rgba(255, 255, 255, 0.08)',
  accent: '#4FC3F7',
  accentDim: 'rgba(79, 195, 247, 0.3)',
  green: '#66BB6A',
  greenDim: 'rgba(102, 187, 106, 0.15)',
  amber: '#FFB74D',
  amberDim: 'rgba(255, 183, 77, 0.15)',
  red: '#EF5350',
  redDim: 'rgba(239, 83, 80, 0.15)',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.7)',
  textMuted: 'rgba(255, 255, 255, 0.4)',
  textLabel: 'rgba(255, 255, 255, 0.5)',
  divider: 'rgba(255, 255, 255, 0.08)',
  north: '#FF3333',
} as const;

interface SensorState {
  pitch: number | null;
  roll: number | null;
  heading: number | null;
  accelX: number;
  accelY: number;
  accelZ: number;
  accelG: number;
  magX: number;
  magY: number;
  magZ: number;
  magTotal: number;
  pressure: number | null;
  relAltitude: number | null;
}

interface SatInfo {
  snr: number;     // 0–50 dB-Hz
  active: boolean; // used in current fix
}

type CoordFormat = 'dms' | 'ddm' | 'dd';

// ─────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────

function formatCoord(value: number | null, isLat: boolean, format: CoordFormat): string {
  if (value === null) return '--';
  const abs = Math.abs(value);
  const dir = isLat ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
  switch (format) {
    case 'dd':
      return `${value.toFixed(6)}°`;
    case 'ddm': {
      const deg = Math.floor(abs);
      const min = (abs - deg) * 60;
      return `${deg}°${min.toFixed(4)}'${dir}`;
    }
    case 'dms': {
      const deg = Math.floor(abs);
      const minTotal = (abs - deg) * 60;
      const min = Math.floor(minTotal);
      const sec = (minTotal - min) * 60;
      return `${deg}°${min}'${sec.toFixed(1)}"${dir}`;
    }
  }
}

function getCardinal(heading: number | null): string {
  if (heading === null) return '--';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(heading / 22.5) % 16];
}

function getSignalQuality(accuracy: number | null, isTracking: boolean): { label: string; color: string; bars: number } {
  if (!isTracking || accuracy === null) return { label: 'NO FIX', color: C.red, bars: 0 };
  if (accuracy <= 3) return { label: 'EXCELLENT', color: C.green, bars: 5 };
  if (accuracy <= 8) return { label: 'GOOD', color: C.green, bars: 4 };
  if (accuracy <= 15) return { label: 'FAIR', color: C.amber, bars: 3 };
  if (accuracy <= 30) return { label: 'POOR', color: C.amber, bars: 2 };
  return { label: 'WEAK', color: C.red, bars: 1 };
}

/** Estimate satellite constellation from GPS accuracy (real GNSS data not exposed by expo).
 *  Distributes active/tracked/blank across dynamic satellite list to resemble a real multi-GNSS receiver. */
function estimateSatellites(prns: string[], accuracy: number | null, isTracking: boolean): SatInfo[] {
  const count = prns.length;
  if (!isTracking || accuracy === null || count === 0) {
    return SAT_SEEDS.slice(0, count).map(() => ({ snr: 0, active: false }));
  }
  // How many satellites are used in fix vs just tracked, by accuracy bracket
  // Scale percentages based on total visible satellites
  const activeRatio = accuracy <= 3 ? 0.45 : accuracy <= 8 ? 0.40 : accuracy <= 15 ? 0.35 : accuracy <= 30 ? 0.28 : 0.22;
  const trackedRatio = 0.15; // Additional satellites tracked but not in fix
  const activeSats = Math.max(3, Math.round(count * activeRatio));
  const trackedExtra = Math.max(2, Math.round(count * trackedRatio));
  
  let baseSNR: number, variation: number;
  if (accuracy <= 3)       { baseSNR = 40; variation = 10; }
  else if (accuracy <= 8)  { baseSNR = 34; variation = 12; }
  else if (accuracy <= 15) { baseSNR = 28; variation = 12; }
  else if (accuracy <= 30) { baseSNR = 22; variation = 10; }
  else                     { baseSNR = 16; variation = 8; }

  // Build per-channel data; use seed to decide which channels are active
  // Sort seeds by value to pick the "strongest" channels as active, keeping original index
  const indexed = SAT_SEEDS.slice(0, count).map((seed, i) => ({ seed, i }));
  const ranked = [...indexed].sort((a, b) => b.seed - a.seed); // highest seed = strongest
  const activeSet = new Set(ranked.slice(0, activeSats).map(r => r.i));
  const trackedSet = new Set(ranked.slice(activeSats, activeSats + trackedExtra).map(r => r.i));

  return SAT_SEEDS.slice(0, count).map((seed, i) => {
    if (activeSet.has(i)) {
      const snr = Math.max(12, Math.min(50, Math.round(baseSNR + (seed - 0.5) * 2 * variation)));
      return { snr, active: true };
    }
    if (trackedSet.has(i)) {
      const snr = Math.max(5, Math.round(8 + seed * 14));
      return { snr, active: false };
    }
    return { snr: 0, active: false };
  });
}

// ─────────────────────────────────────────────────────────────
// Sub-Components
// ─────────────────────────────────────────────────────────────

/** Sparkline mini-graph */
function Sparkline({ data, width, height, color, fillColor }: {
  data: number[];
  width: number;
  height: number;
  color: string;
  fillColor?: string;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;
  const innerH = height - padding * 2;
  const innerW = width - padding * 2;
  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * innerW;
    const y = padding + innerH - ((v - min) / range) * innerH;
    return `${x},${y}`;
  }).join(' ');
  const fillPoints = `${padding},${height - padding} ${points} ${width - padding},${height - padding}`;
  return (
    <Svg width={width} height={height}>
      {fillColor && <Polygon points={fillPoints} fill={fillColor} opacity={0.3} />}
      <Polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Signal strength bars */
function SignalBars({ bars, maxBars = 5, color, size = 'normal' }: {
  bars: number;
  maxBars?: number;
  color: string;
  size?: 'small' | 'normal';
}) {
  const barW = size === 'small' ? 3 : 4;
  const baseH = size === 'small' ? 3 : 4;
  const stepH = size === 'small' ? 2 : 3;
  const gap = size === 'small' ? 1.5 : 2;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap }}>
      {Array.from({ length: maxBars }, (_, i) => (
        <View key={i} style={{
          width: barW,
          height: baseH + (i + 1) * stepH,
          borderRadius: 1,
          backgroundColor: i < bars ? color : 'rgba(255,255,255,0.15)',
        }} />
      ))}
    </View>
  );
}

/** Satellite constellation bar chart + fix info line */
function SatelliteStatus({ accuracy, isTracking, lastFixTime, signal, gnssData }: {
  accuracy: number | null;
  isTracking: boolean;
  lastFixTime: string;
  signal: { label: string; color: string; bars: number };
  gnssData: ReturnType<typeof useGnssSatellites>['data'];
}) {
  const w = PFD_W;
  
  // Use real GNSS data if available (Android), otherwise estimate
  const useRealData = gnssData && gnssData.satellites && gnssData.satellites.length > 0;
  
  // Generate satellite list (real or estimated)
  const satellitesData = useMemo(() => {
    if (useRealData && gnssData!.satellites) {
      // Android: Real GNSS data
      const sats = gnssData!.satellites;
      return {
        prns: sats.map(s => {
          const prefix = s.constellation === 'GPS' ? 'G'
            : s.constellation === 'GLONASS' ? 'R'
            : s.constellation === 'Galileo' ? 'E'
            : s.constellation === 'BeiDou' ? 'C'
            : s.constellation === 'QZSS' ? 'Q'
            : 'S'; // SBAS
          return `${prefix}${String(s.svid).padStart(2, '0')}`;
        }),
        satellites: sats.map(s => ({
          snr: s.cn0DbHz, // Real C/N0 in dB-Hz
          active: s.usedInFix,
        })),
      };
    } else {
      // iOS or no permission: Use estimation
      const visiblePRNs = generateVisibleSatellites(accuracy);
      return {
        prns: visiblePRNs,
        satellites: estimateSatellites(visiblePRNs, accuracy, isTracking),
      };
    }
  }, [useRealData, gnssData, accuracy, isTracking]);
  
  const { prns: visiblePRNs, satellites } = satellitesData;
  const satCount = visiblePRNs.length;
  
  const barGap = 2;
  const barW = satCount > 0 ? Math.floor((w - 12 - barGap * (satCount - 1)) / satCount) : 10;
  const totalBarsW = barW * satCount + barGap * (satCount - 1);
  const offsetX = Math.round((w - totalBarsW) / 2);
  const labelH = 14;
  const svgH = SAT_BAR_H + labelH;

  const usedCount = satellites.filter(s => s.active).length;
  const trackedCount = satellites.filter(s => s.snr > 0).length;
  const accuracyFt = accuracy != null ? `${(accuracy * 3.28084).toFixed(1)} ft` : '--';

  return (
    <View style={satStyles.wrapper}>
      {/* ── Line 1: bar chart ── */}
      <View style={satStyles.chartHeader}>
        <Ionicons name="radio-outline" size={12} color={C.textMuted} />
        <Text style={satStyles.chartTitle}>
          SATELLITES {useRealData ? '(Real C/N0)' : '(Estimated)'}
        </Text>
        <Text style={satStyles.satCount}>
          {usedCount} in use · {trackedCount} tracked
        </Text>
      </View>
      <Svg width={w} height={svgH}>
        {/* Reference line at 50 % SNR */}
        <Line
          x1={offsetX} y1={SAT_BAR_H * 0.5}
          x2={offsetX + totalBarsW} y2={SAT_BAR_H * 0.5}
          stroke="rgba(255,255,255,0.06)" strokeWidth={1} strokeDasharray="4,4"
        />
        {satellites.map((sat, i) => {
          const x = offsetX + i * (barW + barGap);
          const barH = sat.snr > 0 ? Math.max(3, (sat.snr / SAT_MAX_SNR) * SAT_BAR_H) : 0;
          const y = SAT_BAR_H - barH;
          const color = sat.snr > 30 ? C.green
            : sat.snr > 20 ? C.amber
            : sat.snr > 0 ? C.red
            : 'transparent';
          return (
            <G key={i}>
              {/* Ghost background bar */}
              <Rect x={x} y={0} width={barW} height={SAT_BAR_H}
                fill="rgba(255,255,255,0.04)" rx={1.5} />
              {/* Signal bar */}
              {sat.snr > 0 && (
                <Rect x={x} y={y} width={barW} height={barH}
                  fill={color} rx={1.5} opacity={sat.active ? 0.9 : 0.3} />
              )}
              {/* PRN label (e.g. G02, R03, E05) */}
              <SvgText x={x + barW / 2} y={SAT_BAR_H + 10}
                fill={sat.active ? C.textSecondary : C.textMuted}
                fontSize={6} fontWeight={sat.active ? '600' : '400'}
                textAnchor="middle">{visiblePRNs[i]}</SvgText>
            </G>
          );
        })}
      </Svg>

      {/* ── Line 2: fix info ── */}
      <View style={satStyles.infoLine}>
        <Ionicons name="time-outline" size={12} color={C.textMuted} />
        <Text style={satStyles.infoText}>{lastFixTime}</Text>
        <View style={satStyles.infoDivider} />
        <Text style={satStyles.infoLabel}>ACC</Text>
        <Text style={[satStyles.infoText, { color: signal.color }]}>{accuracyFt}</Text>
        <View style={satStyles.infoDivider} />
        <SignalBars bars={signal.bars} color={signal.color} size="small" />
        <Text style={[satStyles.qualityText, { color: signal.color }]}>{signal.label}</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Primary Flight Display (Combined Attitude + Heading + Tapes)
// ─────────────────────────────────────────────────────────────

function PrimaryFlightDisplay({
  heading, course, pitch, roll, speedKn, altitudeFt,
}: {
  heading: number | null;
  course: number | null;
  pitch: number | null;
  roll: number | null;
  speedKn: string;
  altitudeFt: string;
}) {
  const w = PFD_W;
  const attH = PFD_ATT_H;
  const hdgH = PFD_HDG_H;
  const tapeW = PFD_TAPE_W;
  const cx = w / 2;
  const attCy = attH / 2;

  const safeHeading = heading ?? 0;
  const safePitch = pitch ?? 0;
  const safeRoll = roll ?? 0;
  const clampedPitch = Math.max(-45, Math.min(45, safePitch));
  const pitchPx = clampedPitch * (attH / 90);

  // ── Heading tape items ──
  const hdgItems = useMemo(() => {
    const pixPerDeg = w / 120;
    const items: Array<{ deg: number; x: number; isMajor: boolean; isCardinal: boolean; label: string }> = [];
    for (let deg = 0; deg < 360; deg += 5) {
      const delta = ((deg - safeHeading + 540) % 360) - 180;
      if (Math.abs(delta) > 65) continue;
      const x = cx + delta * pixPerDeg;
      const isMajor = deg % 10 === 0;
      const isCardinal = deg % 90 === 0;
      let label = '';
      if (isCardinal) label = ['N', 'E', 'S', 'W'][deg / 90];
      else if (deg % 30 === 0) label = `${deg}`;
      items.push({ deg, x, isMajor, isCardinal, label });
    }
    return items;
  }, [safeHeading, w, cx]);

  // ── Speed tape items ──
  const spdItems = useMemo(() => {
    const speedVal = parseFloat(speedKn);
    if (isNaN(speedVal)) return [];
    const range = 20;
    const pixPerKn = attH / range;
    const items: Array<{ spd: number; y: number; isMajor: boolean; label: string }> = [];
    for (let spd = Math.max(0, Math.floor(speedVal - 12)); spd <= Math.ceil(speedVal + 12); spd++) {
      const y = attCy + (speedVal - spd) * pixPerKn;
      if (y < -10 || y > attH + 10) continue;
      const isMajor = spd % 5 === 0;
      items.push({ spd, y, isMajor, label: isMajor ? `${spd}` : '' });
    }
    return items;
  }, [speedKn, attH, attCy]);

  // ── Altitude tape items ──
  const altItems = useMemo(() => {
    const altVal = parseFloat(altitudeFt);
    if (isNaN(altVal)) return [];
    const range = 400;
    const pixPerFt = attH / range;
    const items: Array<{ alt: number; y: number; isMajor: boolean; label: string }> = [];
    const step = 20;
    for (let a = Math.floor((altVal - 220) / step) * step; a <= Math.ceil((altVal + 220) / step) * step; a += step) {
      const y = attCy + (altVal - a) * pixPerFt;
      if (y < -10 || y > attH + 10) continue;
      const isMajor = a % 100 === 0;
      items.push({ alt: a, y, isMajor, label: isMajor ? `${a}` : '' });
    }
    return items;
  }, [altitudeFt, attH, attCy]);

  // ── COG bug on heading tape ──
  const cogX = useMemo(() => {
    if (course === null) return null;
    const delta = ((course - safeHeading + 540) % 360) - 180;
    if (Math.abs(delta) > 62) return null;
    return cx + delta * (w / 120);
  }, [course, safeHeading, cx, w]);

  // ── Pitch ladder lines ──
  const pitchLines = useMemo(() => {
    const lines: Array<{ deg: number; y: number; wide: boolean }> = [];
    for (let deg = -50; deg <= 50; deg += 5) {
      if (deg === 0) continue;
      lines.push({ deg, y: -deg * (attH / 90), wide: deg % 10 === 0 });
    }
    return lines;
  }, [attH]);

  // ── Roll arc ticks ──
  const rollTicks = useMemo(() => {
    return [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].map(deg => {
      const rad = (deg - 90) * Math.PI / 180;
      const r1 = attH * 0.46;
      const r2 = r1 - (deg % 30 === 0 ? 14 : 8);
      return {
        deg,
        x1: cx + r1 * Math.cos(rad), y1: attCy + r1 * Math.sin(rad),
        x2: cx + r2 * Math.cos(rad), y2: attCy + r2 * Math.sin(rad),
      };
    });
  }, [cx, attCy, attH]);

  // Roll pointer triangle points
  const rollPtrR = attH * 0.46;
  const rollPtrY = attCy - rollPtrR;

  return (
    <View style={pfdStyles.wrapper}>
      <Svg width={w} height={PFD_SVG_H}>
        <Defs>
          <ClipPath id="attClip">
            <Rect x={0} y={0} width={w} height={attH} rx={12} />
          </ClipPath>
          <ClipPath id="spdClip">
            <Rect x={0} y={0} width={tapeW} height={attH} rx={12} />
          </ClipPath>
          <ClipPath id="altClip">
            <Rect x={w - tapeW} y={0} width={tapeW} height={attH} rx={12} />
          </ClipPath>
          <ClipPath id="hdgClip">
            <Rect x={0} y={attH + PFD_GAP} width={w} height={hdgH} rx={10} />
          </ClipPath>
          <LinearGradient id="pfdSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#0D47A1" />
            <Stop offset="0.5" stopColor="#1976D2" />
            <Stop offset="1" stopColor="#42A5F5" />
          </LinearGradient>
          <LinearGradient id="pfdGround" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#8D6E63" />
            <Stop offset="0.3" stopColor="#6D4C41" />
            <Stop offset="1" stopColor="#4E342E" />
          </LinearGradient>
        </Defs>

        {/* ═══════════ ATTITUDE INDICATOR ═══════════ */}
        <G clipPath="url(#attClip)">
          {/* Rotating sky/ground/pitch group */}
          <G rotation={-safeRoll} origin={`${cx}, ${attCy}`}>
            {/* Sky */}
            <Rect x={-w} y={-attH * 2 + attCy + pitchPx} width={w * 3} height={attH * 2} fill="url(#pfdSky)" />
            {/* Ground */}
            <Rect x={-w} y={attCy + pitchPx} width={w * 3} height={attH * 2} fill="url(#pfdGround)" />
            {/* Horizon line */}
            <Line x1={-w} y1={attCy + pitchPx} x2={w * 2} y2={attCy + pitchPx}
              stroke="white" strokeWidth={2} strokeOpacity={0.9} />

            {/* Pitch ladder */}
            {pitchLines.map(pl => {
              const lineW = pl.wide ? 40 : 20;
              const yPos = attCy + pitchPx + pl.y;
              return (
                <G key={`pl${pl.deg}`}>
                  {/* Left bar */}
                  <Line x1={cx - lineW - 8} y1={yPos} x2={cx - 8} y2={yPos}
                    stroke="white" strokeWidth={pl.wide ? 1.5 : 1} strokeOpacity={0.7} />
                  {/* Right bar */}
                  <Line x1={cx + 8} y1={yPos} x2={cx + lineW + 8} y2={yPos}
                    stroke="white" strokeWidth={pl.wide ? 1.5 : 1} strokeOpacity={0.7} />
                  {/* Down-ticks for negative pitch */}
                  {pl.deg < 0 && pl.wide && (
                    <>
                      <Line x1={cx - lineW - 8} y1={yPos} x2={cx - lineW - 8} y2={yPos - 6}
                        stroke="white" strokeWidth={1} strokeOpacity={0.6} />
                      <Line x1={cx + lineW + 8} y1={yPos} x2={cx + lineW + 8} y2={yPos - 6}
                        stroke="white" strokeWidth={1} strokeOpacity={0.6} />
                    </>
                  )}
                  {/* Degree labels on pitch bars */}
                  {pl.wide && (
                    <>
                      <SvgText x={cx - lineW - 14} y={yPos} fill="white" fontSize={10} fontWeight="600"
                        textAnchor="end" alignmentBaseline="central" fillOpacity={0.8}>
                        {Math.abs(pl.deg)}
                      </SvgText>
                      <SvgText x={cx + lineW + 14} y={yPos} fill="white" fontSize={10} fontWeight="600"
                        textAnchor="start" alignmentBaseline="central" fillOpacity={0.8}>
                        {Math.abs(pl.deg)}
                      </SvgText>
                    </>
                  )}
                </G>
              );
            })}
          </G>

          {/* Roll arc (fixed) */}
          {rollTicks.map(t => (
            <Line key={`rt${t.deg}`}
              x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
              stroke={t.deg === 0 ? C.amber : 'rgba(255,255,255,0.5)'}
              strokeWidth={t.deg === 0 ? 2.5 : 1.5} />
          ))}

          {/* Roll pointer (rotates with roll) */}
          <G rotation={-safeRoll} origin={`${cx}, ${attCy}`}>
            <Polygon
              points={`${cx},${rollPtrY + 16} ${cx - 6},${rollPtrY + 4} ${cx + 6},${rollPtrY + 4}`}
              fill={C.amber} />
          </G>
        </G>

        {/* ═══════════ AIRCRAFT REFERENCE SYMBOL (fixed) ═══════════ */}
        <Line x1={cx - 55} y1={attCy} x2={cx - 16} y2={attCy}
          stroke={C.amber} strokeWidth={3.5} strokeLinecap="round" />
        <Line x1={cx + 16} y1={attCy} x2={cx + 55} y2={attCy}
          stroke={C.amber} strokeWidth={3.5} strokeLinecap="round" />
        <Line x1={cx - 16} y1={attCy} x2={cx - 10} y2={attCy + 8}
          stroke={C.amber} strokeWidth={3.5} strokeLinecap="round" />
        <Line x1={cx + 16} y1={attCy} x2={cx + 10} y2={attCy + 8}
          stroke={C.amber} strokeWidth={3.5} strokeLinecap="round" />
        <Rect x={cx - 3} y={attCy - 3} width={6} height={6} fill={C.amber} rx={1} />

        {/* ═══════════ SPEED TAPE (left) ═══════════ */}
        <G clipPath="url(#spdClip)">
          <Rect x={0} y={0} width={tapeW} height={attH} fill="rgba(10,14,22,0.78)" />
          <Line x1={tapeW - 0.5} y1={0} x2={tapeW - 0.5} y2={attH}
            stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
          {spdItems.map(item => (
            <G key={`s${item.spd}`}>
              <Line x1={tapeW - 2} y1={item.y} x2={tapeW - (item.isMajor ? 12 : 6)} y2={item.y}
                stroke={item.isMajor ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)'} strokeWidth={1} />
              {item.label !== '' && (
                <SvgText x={tapeW - 16} y={item.y} fill="white" fontSize={11} fontWeight="500"
                  textAnchor="end" alignmentBaseline="central" fillOpacity={0.9}>
                  {item.label}
                </SvgText>
              )}
            </G>
          ))}
        </G>
        {/* Speed readout box */}
        <Rect x={0} y={attCy - 16} width={tapeW + 4} height={32}
          fill="rgba(0,0,0,0.85)" stroke={C.accent} strokeWidth={1.5} rx={4} />
        <SvgText x={tapeW / 2 + 2} y={attCy + 1} fill="white" fontSize={16} fontWeight="700"
          textAnchor="middle" alignmentBaseline="central">
          {speedKn}
        </SvgText>
        <SvgText x={tapeW / 2 + 2} y={attCy + 26} fill={C.textMuted} fontSize={9} fontWeight="600"
          textAnchor="middle" alignmentBaseline="central">KN</SvgText>

        {/* ═══════════ ALTITUDE TAPE (right) ═══════════ */}
        <G clipPath="url(#altClip)">
          <Rect x={w - tapeW} y={0} width={tapeW} height={attH} fill="rgba(10,14,22,0.78)" />
          <Line x1={w - tapeW + 0.5} y1={0} x2={w - tapeW + 0.5} y2={attH}
            stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
          {altItems.map(item => (
            <G key={`a${item.alt}`}>
              <Line x1={w - tapeW + 2} y1={item.y} x2={w - tapeW + (item.isMajor ? 12 : 6)} y2={item.y}
                stroke={item.isMajor ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)'} strokeWidth={1} />
              {item.label !== '' && (
                <SvgText x={w - tapeW + 16} y={item.y} fill="white" fontSize={11} fontWeight="500"
                  textAnchor="start" alignmentBaseline="central" fillOpacity={0.9}>
                  {item.label}
                </SvgText>
              )}
            </G>
          ))}
        </G>
        {/* Altitude readout box */}
        <Rect x={w - tapeW - 4} y={attCy - 16} width={tapeW + 4} height={32}
          fill="rgba(0,0,0,0.85)" stroke={C.green} strokeWidth={1.5} rx={4} />
        <SvgText x={w - tapeW / 2 - 2} y={attCy + 1} fill="white" fontSize={16} fontWeight="700"
          textAnchor="middle" alignmentBaseline="central">
          {altitudeFt}
        </SvgText>
        <SvgText x={w - tapeW / 2 - 2} y={attCy + 26} fill={C.textMuted} fontSize={9} fontWeight="600"
          textAnchor="middle" alignmentBaseline="central">FT MSL</SvgText>

        {/* ═══════════ HDG / COG CORNER READOUTS (tall, 3 lines) ═══════════ */}
        {/* HDG upper-left (just inside speed tape) */}
        <Rect x={tapeW + 4} y={6} width={46} height={48} fill="rgba(0,0,0,0.65)" rx={5} />
        <SvgText x={tapeW + 27} y={17} fill={C.textMuted}
          fontSize={8} fontWeight="700" textAnchor="middle" alignmentBaseline="central"
          letterSpacing={1}>HDG</SvgText>
        <SvgText x={tapeW + 27} y={31} fill="white"
          fontSize={15} fontWeight="700" textAnchor="middle" alignmentBaseline="central">
          {heading != null ? `${Math.round(heading)}°` : '--°'}
        </SvgText>
        <SvgText x={tapeW + 27} y={44} fill={C.accent}
          fontSize={12} fontWeight="700" textAnchor="middle" alignmentBaseline="central">
          {getCardinal(heading)}
        </SvgText>

        {/* COG upper-right (just inside altitude tape) */}
        {course != null && (
          <G>
            <Rect x={w - tapeW - 50} y={6} width={46} height={48} fill="rgba(0,0,0,0.65)" rx={5} />
            <SvgText x={w - tapeW - 27} y={17} fill={C.textMuted}
              fontSize={8} fontWeight="700" textAnchor="middle" alignmentBaseline="central"
              letterSpacing={1}>COG</SvgText>
            <SvgText x={w - tapeW - 27} y={31} fill="white"
              fontSize={15} fontWeight="700" textAnchor="middle" alignmentBaseline="central">
              {Math.round(course)}°
            </SvgText>
            <SvgText x={w - tapeW - 27} y={44} fill={C.green}
              fontSize={12} fontWeight="700" textAnchor="middle" alignmentBaseline="central">
              {getCardinal(course)}
            </SvgText>
          </G>
        )}

        {/* Attitude border */}
        <Rect x={0} y={0} width={w} height={attH} fill="none"
          stroke="rgba(255,255,255,0.15)" strokeWidth={1.5} rx={12} />

        {/* ═══════════ HEADING TAPE (bottom) ═══════════ */}
        <G clipPath="url(#hdgClip)">
          <Rect x={0} y={attH + PFD_GAP} width={w} height={hdgH}
            fill="rgba(10,14,22,0.88)" rx={10} />
          {hdgItems.map(item => {
            const tapeY = attH + PFD_GAP;
            return (
              <G key={`h${item.deg}`}>
                <Line x1={item.x} y1={tapeY}
                  x2={item.x} y2={tapeY + (item.isCardinal ? 16 : item.isMajor ? 10 : 5)}
                  stroke={item.isCardinal ? (item.deg === 0 ? C.north : 'rgba(255,255,255,0.8)') : 'rgba(255,255,255,0.35)'}
                  strokeWidth={item.isCardinal ? 2 : 1} />
                {item.label !== '' && (
                  <SvgText x={item.x} y={tapeY + (item.isCardinal ? 30 : 24)}
                    fill={item.isCardinal ? (item.deg === 0 ? C.north : 'white') : 'rgba(255,255,255,0.6)'}
                    fontSize={item.isCardinal ? 14 : 10} fontWeight={item.isCardinal ? '800' : '500'}
                    textAnchor="middle" alignmentBaseline="central">
                    {item.label}
                  </SvgText>
                )}
              </G>
            );
          })}
          {/* COG bug */}
          {cogX != null && (
            <>
              <Polygon points={`${cogX - 5},${attH + PFD_GAP + hdgH - 4} ${cogX},${attH + PFD_GAP + hdgH - 12} ${cogX + 5},${attH + PFD_GAP + hdgH - 4}`}
                fill={C.green} fillOpacity={0.9} />
            </>
          )}
        </G>
        {/* Heading tape border */}
        <Rect x={0} y={attH + PFD_GAP} width={w} height={hdgH} fill="none"
          stroke="rgba(255,255,255,0.12)" strokeWidth={1} rx={10} />
        {/* Heading pointer (fixed triangle above tape) */}
        <Polygon points={`${cx},${attH + PFD_GAP + 1} ${cx - 7},${attH - 1} ${cx + 7},${attH - 1}`}
          fill={C.accent} />

        {/* ═══════════ PITCH / ROLL CORNER READOUTS (lower corners) ═══════════ */}
        {/* PITCH lower-left */}
        <Rect x={tapeW + 4} y={attH - 54} width={46} height={48} fill="rgba(0,0,0,0.65)" rx={5} />
        <SvgText x={tapeW + 27} y={attH - 43} fill={C.textMuted}
          fontSize={8} fontWeight="700" textAnchor="middle" alignmentBaseline="central"
          letterSpacing={1}>PITCH</SvgText>
        <SvgText x={tapeW + 27} y={attH - 29} fill="white"
          fontSize={15} fontWeight="700" textAnchor="middle" alignmentBaseline="central">
          {pitch != null ? `${Math.abs(pitch).toFixed(1)}°` : '--°'}
        </SvgText>
        <SvgText x={tapeW + 27} y={attH - 16} fill={C.accent}
          fontSize={12} fontWeight="700" textAnchor="middle" alignmentBaseline="central">
          {pitch != null ? (pitch > 0 ? '\u25B2 UP' : '\u25BC DN') : '--'}
        </SvgText>

        {/* ROLL lower-right */}
        <Rect x={w - tapeW - 50} y={attH - 54} width={46} height={48} fill="rgba(0,0,0,0.65)" rx={5} />
        <SvgText x={w - tapeW - 27} y={attH - 43} fill={C.textMuted}
          fontSize={8} fontWeight="700" textAnchor="middle" alignmentBaseline="central"
          letterSpacing={1}>ROLL</SvgText>
        <SvgText x={w - tapeW - 27} y={attH - 29} fill="white"
          fontSize={15} fontWeight="700" textAnchor="middle" alignmentBaseline="central">
          {roll != null ? `${Math.abs(roll).toFixed(1)}°` : '--°'}
        </SvgText>
        <SvgText x={w - tapeW - 27} y={attH - 16} fill={C.green}
          fontSize={12} fontWeight="700" textAnchor="middle" alignmentBaseline="central">
          {roll != null ? (roll > 0 ? 'R' : 'L') : '--'}
        </SvgText>
      </Svg>

    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────

export default function GPSSensorsView() {
  const { gpsData, heading: overlayHeading } = useOverlay();
  
  // ── GNSS satellite tracking ──
  const { data: gnssData, startTracking, stopTracking, isAvailable: gnssAvailable } = useGnssSatellites();

  // ── Sensor state ──
  const [sensors, setSensors] = useState<SensorState>({
    pitch: null, roll: null, heading: null,
    accelX: 0, accelY: 0, accelZ: 0, accelG: 0,
    magX: 0, magY: 0, magZ: 0, magTotal: 0,
    pressure: null, relAltitude: null,
  });

  // ── UI state ──
  const [coordFormat, setCoordFormat] = useState<CoordFormat>('ddm');

  // ── Sparkline history ──
  const pressureHistoryRef = useRef<number[]>([]);
  const [pressureHistory, setPressureHistory] = useState<number[]>([]);

  // ── Active heading (prefer DeviceMotion, fall back to overlay) ──
  const activeHeading = sensors.heading ?? overlayHeading;
  
  // ── Start/stop GNSS satellite tracking ──
  useEffect(() => {
    if (gnssAvailable) {
      startTracking();
      console.log('[GPSSensorsView] Started GNSS satellite tracking');
    }
    return () => {
      if (gnssAvailable) {
        stopTracking();
        console.log('[GPSSensorsView] Stopped GNSS satellite tracking');
      }
    };
  }, [gnssAvailable]);

  // ── Subscribe to DeviceMotion for pitch/roll/heading ──
  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    DeviceMotion.setUpdateInterval(100);
    DeviceMotion.isAvailableAsync().then(available => {
      if (!available) return;
      sub = DeviceMotion.addListener((data: DeviceMotionMeasurement) => {
        if (!data.rotation) return;
        const { alpha, beta, gamma } = data.rotation;
        let heading = alpha * (180 / Math.PI);
        const pitch = beta * (180 / Math.PI);
        const roll = gamma * (180 / Math.PI);
        if (Platform.OS === 'ios') {
          heading = (360 - heading) % 360;
        } else {
          heading = ((heading % 360) + 360) % 360;
        }
        let accelG = 0;
        if (data.acceleration) {
          const { x, y, z } = data.acceleration;
          accelG = Math.sqrt(x * x + y * y + z * z) / 9.81;
        }
        setSensors(prev => ({
          ...prev,
          heading: Math.round(heading * 10) / 10,
          pitch: Math.round(pitch * 10) / 10,
          roll: Math.round(roll * 10) / 10,
          accelG: Math.round(accelG * 100) / 100,
          ...(data.acceleration ? {
            accelX: Math.round(data.acceleration.x * 100) / 100,
            accelY: Math.round(data.acceleration.y * 100) / 100,
            accelZ: Math.round(data.acceleration.z * 100) / 100,
          } : {}),
        }));
      });
    });
    return () => { sub?.remove(); };
  }, []);

  // ── Subscribe to Magnetometer ──
  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    Magnetometer.setUpdateInterval(250);
    Magnetometer.isAvailableAsync().then(available => {
      if (!available) return;
      sub = Magnetometer.addListener(({ x, y, z }) => {
        const total = Math.sqrt(x * x + y * y + z * z);
        setSensors(prev => ({
          ...prev,
          magX: Math.round(x * 10) / 10, magY: Math.round(y * 10) / 10,
          magZ: Math.round(z * 10) / 10, magTotal: Math.round(total * 10) / 10,
        }));
      });
    });
    return () => { sub?.remove(); };
  }, []);

  // ── Subscribe to Barometer ──
  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    Barometer.isAvailableAsync().then(available => {
      if (!available) return;
      sub = Barometer.addListener(({ pressure, relativeAltitude }) => {
        setSensors(prev => ({
          ...prev,
          pressure: Math.round(pressure * 10) / 10,
          relAltitude: relativeAltitude != null ? Math.round(relativeAltitude * 10) / 10 : null,
        }));
      });
    });
    return () => { sub?.remove(); };
  }, []);

  // ── Pressure sparkline history (1Hz) ──
  useEffect(() => {
    const interval = setInterval(() => {
      if (sensors.pressure != null) {
        pressureHistoryRef.current = [...pressureHistoryRef.current.slice(-SPARKLINE_POINTS + 1), sensors.pressure];
        setPressureHistory([...pressureHistoryRef.current]);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [sensors.pressure]);


  // ── Computed values ──
  const signal = getSignalQuality(gpsData?.accuracy ?? null, gpsData?.isTracking ?? false);
  const altitudeFt = gpsData?.altitude != null ? (gpsData.altitude * 3.28084).toFixed(1) : '--';
  const speedKn = gpsData?.speedKnots != null ? gpsData.speedKnots.toFixed(1) : '--';
  const lastFixTime = gpsData?.timestamp
    ? new Date(gpsData.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--';

  const pressureTrend = useMemo(() => {
    if (pressureHistory.length < 10) return null;
    const recent = pressureHistory.slice(-10);
    const earlier = pressureHistory.slice(-30, -20);
    if (earlier.length === 0) return null;
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const earlierAvg = earlier.reduce((a, b) => a + b, 0) / earlier.length;
    const diff = recentAvg - earlierAvg;
    if (diff > 0.3) return { label: 'Rising', icon: 'arrow-up' as const, color: C.green };
    if (diff < -0.3) return { label: 'Falling', icon: 'arrow-down' as const, color: C.red };
    return { label: 'Steady', icon: 'remove' as const, color: C.textMuted };
  }, [pressureHistory]);

  const cycleCoordFormat = useCallback(() => {
    setCoordFormat(prev => {
      switch (prev) { case 'ddm': return 'dms'; case 'dms': return 'dd'; case 'dd': return 'ddm'; }
    });
  }, []);

  // ─────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>

      {/* ═══ SATELLITE STATUS (bar chart + fix info) ═══ */}
      <SatelliteStatus
        accuracy={gpsData?.accuracy ?? null}
        isTracking={gpsData?.isTracking ?? false}
        lastFixTime={lastFixTime}
        signal={signal}
        gnssData={gnssData}
      />

      {/* ═══ LAT / LON (clean centered, above PFD) ═══ */}
      <TouchableOpacity style={styles.posLine} onPress={cycleCoordFormat} activeOpacity={0.7}>
        <Text style={styles.posCoord}>{formatCoord(gpsData?.latitude ?? null, true, coordFormat)}</Text>
        <Text style={styles.posSep}>·</Text>
        <Text style={styles.posCoord}>{formatCoord(gpsData?.longitude ?? null, false, coordFormat)}</Text>
        <Text style={styles.posFormat}>{coordFormat.toUpperCase()}</Text>
      </TouchableOpacity>

      {/* ═══ PRIMARY FLIGHT DISPLAY ═══ */}
      <PrimaryFlightDisplay
        heading={activeHeading}
        course={gpsData?.course ?? null}
        pitch={sensors.pitch}
        roll={sensors.roll}
        speedKn={speedKn}
        altitudeFt={altitudeFt}
      />

      {/* ═══ G-FORCE BAR ═══ */}
      <View style={styles.attitudeBar}>
        <View style={styles.attBarItem}>
          <Text style={styles.attBarLabel}>G-FORCE</Text>
          <Text style={[styles.attBarValue, sensors.accelG > 1.5 ? { color: C.red } : null]}>
            {sensors.accelG.toFixed(2)} g
          </Text>
        </View>
      </View>

      {/* ═══ SENSORS ═══ */}
      <View style={styles.sensorBar}>
        <View style={styles.sensorItem}>
          <Text style={styles.sensorLabel}>MAG FIELD</Text>
          <Text style={styles.sensorValue}>{sensors.magTotal.toFixed(0)}</Text>
          <Text style={styles.sensorUnit}>µT</Text>
        </View>
        <View style={styles.sensorDivider} />
        <View style={styles.sensorItem}>
          <Text style={styles.sensorLabel}>PRESSURE</Text>
          <Text style={styles.sensorValue}>{sensors.pressure != null ? sensors.pressure.toFixed(1) : '--'}</Text>
          <Text style={styles.sensorUnit}>hPa</Text>
          {pressureTrend && (
            <View style={styles.trendRow}>
              <Ionicons name={pressureTrend.icon} size={10} color={pressureTrend.color} />
              <Text style={[styles.trendText, { color: pressureTrend.color }]}>{pressureTrend.label}</Text>
            </View>
          )}
        </View>
        <View style={styles.sensorDivider} />
        <View style={styles.sensorItem}>
          <Text style={styles.sensorLabel}>BARO ALT</Text>
          <Text style={styles.sensorValue}>{sensors.relAltitude != null ? sensors.relAltitude.toFixed(1) : '--'}</Text>
          <Text style={styles.sensorUnit}>m rel</Text>
          {pressureHistory.length > 5 && (
            <View style={{ marginTop: 2 }}>
              <Sparkline data={pressureHistory} width={50} height={14} color={C.green} fillColor={C.greenDim} />
            </View>
          )}
        </View>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────
// PFD Styles
// ─────────────────────────────────────────────────────────────

const pfdStyles = StyleSheet.create({
  wrapper: {
    marginBottom: 4,
  },
});

// ─────────────────────────────────────────────────────────────
// Satellite Styles
// ─────────────────────────────────────────────────────────────

const satStyles = StyleSheet.create({
  wrapper: {
    backgroundColor: C.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.cardBorder,
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  chartTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: C.textMuted,
    letterSpacing: 1.5,
  },
  satCount: {
    fontSize: 10,
    color: C.textMuted,
    marginLeft: 'auto',
  },
  infoLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: C.divider,
  },
  infoLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: C.textMuted,
    letterSpacing: 1,
  },
  infoText: {
    fontSize: 12,
    fontWeight: '600',
    color: C.textSecondary,
    fontFamily: 'monospace',
  },
  infoDivider: {
    width: 1,
    height: 14,
    backgroundColor: C.divider,
  },
  qualityText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});

// ─────────────────────────────────────────────────────────────
// Main Styles
// ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },

  // ── Position line (clean centered lat/lon) ──
  posLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 6,
    marginBottom: 4,
  },
  posCoord: {
    fontSize: 14,
    fontWeight: '500',
    color: C.textPrimary,
    fontFamily: 'monospace',
    letterSpacing: 0.3,
  },
  posSep: {
    fontSize: 14,
    color: C.textMuted,
  },
  posFormat: {
    fontSize: 9,
    fontWeight: '700',
    color: C.accent,
    letterSpacing: 1,
    opacity: 0.6,
  },

  // ── Attitude bar (pitch/roll/g below PFD) ──
  attitudeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.cardBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.cardBorder,
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  attBarItem: {
    flex: 1,
    alignItems: 'center',
  },
  attBarLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: C.textMuted,
    letterSpacing: 1.5,
    marginBottom: 3,
  },
  attBarValue: {
    fontSize: 16,
    fontWeight: '500',
    color: C.textPrimary,
    fontFamily: 'monospace',
  },
  attBarDivider: {
    width: 1,
    height: 30,
    backgroundColor: C.divider,
  },

  // ── Sensors (compact single-row bar) ──
  sensorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.cardBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.cardBorder,
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginBottom: 12,
  },
  sensorItem: {
    flex: 1,
    alignItems: 'center',
  },
  sensorDivider: {
    width: 1,
    height: 36,
    backgroundColor: C.divider,
    flexShrink: 0,
    flexGrow: 0,
  },
  sensorLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: C.textMuted,
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  sensorValue: {
    fontSize: 16,
    fontWeight: '500',
    color: C.textPrimary,
    fontFamily: 'monospace',
  },
  sensorUnit: {
    fontSize: 9,
    color: C.textMuted,
    marginTop: 1,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 2,
  },
  trendText: {
    fontSize: 8,
    fontWeight: '600',
  },

});

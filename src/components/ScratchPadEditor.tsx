/**
 * ScratchPadEditor
 *
 * Full-screen drawing canvas with freeform pen strokes and text boxes.
 * Uses PanResponder for touch capture and react-native-svg for rendering.
 * Saves thumbnails via react-native-view-shot on close.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  Dimensions,
  Modal,
  TextInput,
  Keyboard,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import * as scratchPadService from '../services/scratchPadService';
import type { ScratchPad, Stroke, TextBox } from '../types/scratchPad';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLORS = ['#000000', '#FFFFFF', '#FF3B30', '#007AFF', '#FFCC00', '#34C759'];
const WIDTHS = [2, 5, 10];
const ERASER_COLOR = '#FFFFFF'; // matches white canvas background

type Tool = 'pen' | 'eraser' | 'text';

interface Props {
  padId: string | null; // null = new pad
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ScratchPadEditor({ padId, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const canvasRef = useRef<any>(null);
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

  // Drawing state
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [undoneStrokes, setUndoneStrokes] = useState<Stroke[]>([]);

  // Text boxes
  const [textBoxes, setTextBoxes] = useState<TextBox[]>([]);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);

  // Tools
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(WIDTHS[1]);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showWidthPicker, setShowWidthPicker] = useState(false);

  // Pad metadata
  const [padData, setPadData] = useState<ScratchPad | null>(null);
  const [saving, setSaving] = useState(false);

  // Refs for PanResponder (avoid stale closures)
  const strokesRef = useRef<Stroke[]>([]);
  const currentPathRef = useRef<string>('');
  const colorRef = useRef(color);
  const strokeWidthRef = useRef(strokeWidth);
  const toolRef = useRef<Tool>(tool);
  const prevPointRef = useRef<{ x: number; y: number } | null>(null);

  // Keep refs in sync
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { strokeWidthRef.current = strokeWidth; }, [strokeWidth]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { strokesRef.current = strokes; }, [strokes]);

  // Load existing pad
  useEffect(() => {
    if (padId) {
      scratchPadService.loadPad(padId).then((pad) => {
        if (pad) {
          setPadData(pad);
          setStrokes(pad.strokes);
          setTextBoxes(pad.textBoxes);
          strokesRef.current = pad.strokes;
        }
      });
    }
  }, [padId]);

  // -------------------------------------------
  // PanResponder for drawing
  // -------------------------------------------
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,

      onPanResponderGrant: (evt: any) => {
        if (toolRef.current === 'text') return;
        const { locationX: x, locationY: y } = evt.nativeEvent;
        const path = `M ${x.toFixed(1)} ${y.toFixed(1)}`;
        currentPathRef.current = path;
        prevPointRef.current = { x, y };
        setCurrentPath(path);
      },

      onPanResponderMove: (evt: any) => {
        if (toolRef.current === 'text') return;
        const { locationX: x, locationY: y } = evt.nativeEvent;
        const prev = prevPointRef.current;
        if (!prev) return;

        // Quadratic bezier through midpoint for smooth curves
        const midX = (prev.x + x) / 2;
        const midY = (prev.y + y) / 2;
        const segment = ` Q ${prev.x.toFixed(1)} ${prev.y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;

        currentPathRef.current += segment;
        prevPointRef.current = { x, y };
        setCurrentPath(currentPathRef.current);
      },

      onPanResponderRelease: () => {
        if (toolRef.current === 'text') return;
        if (!currentPathRef.current) return;

        const finalStroke: Stroke = {
          points: currentPathRef.current,
          color: toolRef.current === 'eraser' ? ERASER_COLOR : colorRef.current,
          width: toolRef.current === 'eraser' ? strokeWidthRef.current * 3 : strokeWidthRef.current,
        };

        const updated = [...strokesRef.current, finalStroke];
        strokesRef.current = updated;
        setStrokes(updated);
        setUndoneStrokes([]); // clear redo stack on new stroke
        currentPathRef.current = '';
        prevPointRef.current = null;
        setCurrentPath('');
      },
    }),
  ).current;

  // -------------------------------------------
  // Text box handling
  // -------------------------------------------
  const handleCanvasTapForText = useCallback(
    (evt: any) => {
      if (tool !== 'text') return;
      const { locationX: x, locationY: y } = evt.nativeEvent;

      const newBox: TextBox = {
        id: scratchPadService.generateId(),
        text: '',
        x,
        y,
        fontSize: 16,
        color,
      };

      setTextBoxes((prev) => [...prev, newBox]);
      setEditingTextId(newBox.id);
    },
    [tool, color],
  );

  const handleTextChange = useCallback((id: string, text: string) => {
    setTextBoxes((prev) =>
      prev.map((tb) => (tb.id === id ? { ...tb, text } : tb)),
    );
  }, []);

  const handleTextBlur = useCallback((id: string) => {
    setEditingTextId(null);
    // Remove empty text boxes
    setTextBoxes((prev) => prev.filter((tb) => tb.id !== id || tb.text.trim().length > 0));
  }, []);

  // -------------------------------------------
  // Undo / Redo
  // -------------------------------------------
  const handleUndo = useCallback(() => {
    if (strokes.length === 0) return;
    const last = strokes[strokes.length - 1];
    setStrokes((prev) => prev.slice(0, -1));
    strokesRef.current = strokesRef.current.slice(0, -1);
    setUndoneStrokes((prev) => [...prev, last]);
  }, [strokes]);

  const handleRedo = useCallback(() => {
    if (undoneStrokes.length === 0) return;
    const last = undoneStrokes[undoneStrokes.length - 1];
    setStrokes((prev) => [...prev, last]);
    strokesRef.current = [...strokesRef.current, last];
    setUndoneStrokes((prev) => prev.slice(0, -1));
  }, [undoneStrokes]);

  const handleClear = useCallback(() => {
    Alert.alert('Clear All', 'Erase everything on this scratchpad?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          setStrokes([]);
          strokesRef.current = [];
          setTextBoxes([]);
          setUndoneStrokes([]);
        },
      },
    ]);
  }, []);

  // -------------------------------------------
  // Save & close
  // -------------------------------------------
  const handleSave = useCallback(async () => {
    Keyboard.dismiss();
    setSaving(true);
    try {
      // Capture thumbnail
      let thumbUri: string | undefined;
      if (canvasRef.current) {
        try {
          thumbUri = await captureRef(canvasRef, {
            format: 'png',
            quality: 0.6,
            width: 200,
          });
        } catch (e) {
          console.warn('[ScratchPadEditor] Thumbnail capture failed', e);
        }
      }

      const now = new Date().toISOString();
      const pad: ScratchPad = {
        id: padData?.id ?? scratchPadService.generateId(),
        createdAt: padData?.createdAt ?? now,
        updatedAt: now,
        canvasWidth: screenWidth,
        canvasHeight: screenHeight,
        strokes,
        textBoxes,
      };

      await scratchPadService.savePad(pad, thumbUri);
    } catch (e) {
      console.error('[ScratchPadEditor] Save failed', e);
      Alert.alert('Error', 'Failed to save scratchpad.');
    } finally {
      setSaving(false);
      onClose();
    }
  }, [padData, strokes, textBoxes, screenWidth, screenHeight, onClose]);

  // -------------------------------------------
  // Derived
  // -------------------------------------------
  const activeColor = tool === 'eraser' ? ERASER_COLOR : color;
  const activeWidth = tool === 'eraser' ? strokeWidth * 3 : strokeWidth;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen">
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Scratch Pad</Text>
          <TouchableOpacity
            onPress={handleSave}
            style={styles.headerBtn}
            disabled={saving}
          >
            <Text style={[styles.headerBtnText, styles.headerSaveText]}>
              {saving ? 'Saving...' : 'Done'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Canvas */}
        <View
          ref={canvasRef}
          style={styles.canvas}
          {...panResponder.panHandlers}
          onTouchEnd={tool === 'text' ? handleCanvasTapForText : undefined}
          collapsable={false}
        >
          <Svg style={StyleSheet.absoluteFill}>
            {/* Completed strokes */}
            {strokes.map((s, i) => (
              <Path
                key={i}
                d={s.points}
                fill="none"
                stroke={s.color}
                strokeWidth={s.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {/* In-progress stroke */}
            {currentPath ? (
              <Path
                d={currentPath}
                fill="none"
                stroke={activeColor}
                strokeWidth={activeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </Svg>

          {/* Text boxes */}
          {textBoxes.map((tb) => (
            <View
              key={tb.id}
              style={[styles.textBoxWrapper, { left: tb.x - 4, top: tb.y - 4 }]}
            >
              {editingTextId === tb.id ? (
                <TextInput
                  style={[styles.textInput, { color: tb.color, fontSize: tb.fontSize }]}
                  value={tb.text}
                  onChangeText={(t: string) => handleTextChange(tb.id, t)}
                  onBlur={() => handleTextBlur(tb.id)}
                  autoFocus
                  multiline
                  placeholder="Type here..."
                  placeholderTextColor="rgba(0,0,0,0.3)"
                />
              ) : (
                <TouchableOpacity onPress={() => setEditingTextId(tb.id)}>
                  <Text style={{ color: tb.color, fontSize: tb.fontSize }}>
                    {tb.text}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>

        {/* Toolbar */}
        <View style={[styles.toolbar, { paddingBottom: insets.bottom + 4 }]}>
          {/* Row 1: tools */}
          <View style={styles.toolRow}>
            {/* Pen */}
            <TouchableOpacity
              style={[styles.toolBtn, tool === 'pen' && styles.toolBtnActive]}
              onPress={() => setTool('pen')}
            >
              <Ionicons name="pencil" size={22} color={tool === 'pen' ? '#4FC3F7' : '#fff'} />
            </TouchableOpacity>

            {/* Eraser */}
            <TouchableOpacity
              style={[styles.toolBtn, tool === 'eraser' && styles.toolBtnActive]}
              onPress={() => setTool('eraser')}
            >
              <Ionicons name="backspace-outline" size={22} color={tool === 'eraser' ? '#4FC3F7' : '#fff'} />
            </TouchableOpacity>

            {/* Text */}
            <TouchableOpacity
              style={[styles.toolBtn, tool === 'text' && styles.toolBtnActive]}
              onPress={() => setTool('text')}
            >
              <Ionicons name="text" size={22} color={tool === 'text' ? '#4FC3F7' : '#fff'} />
            </TouchableOpacity>

            <View style={styles.toolDivider} />

            {/* Color */}
            <TouchableOpacity
              style={styles.toolBtn}
              onPress={() => { setShowColorPicker(!showColorPicker); setShowWidthPicker(false); }}
            >
              <View style={[styles.colorDot, { backgroundColor: color }]} />
            </TouchableOpacity>

            {/* Width */}
            <TouchableOpacity
              style={styles.toolBtn}
              onPress={() => { setShowWidthPicker(!showWidthPicker); setShowColorPicker(false); }}
            >
              <View style={[styles.widthIndicator, { height: strokeWidth, width: 20 }]} />
            </TouchableOpacity>

            <View style={styles.toolDivider} />

            {/* Undo */}
            <TouchableOpacity
              style={styles.toolBtn}
              onPress={handleUndo}
              disabled={strokes.length === 0}
            >
              <Ionicons
                name="arrow-undo"
                size={22}
                color={strokes.length > 0 ? '#fff' : 'rgba(255,255,255,0.25)'}
              />
            </TouchableOpacity>

            {/* Redo */}
            <TouchableOpacity
              style={styles.toolBtn}
              onPress={handleRedo}
              disabled={undoneStrokes.length === 0}
            >
              <Ionicons
                name="arrow-redo"
                size={22}
                color={undoneStrokes.length > 0 ? '#fff' : 'rgba(255,255,255,0.25)'}
              />
            </TouchableOpacity>

            {/* Clear */}
            <TouchableOpacity style={styles.toolBtn} onPress={handleClear}>
              <Ionicons name="trash-outline" size={22} color="#FF3B30" />
            </TouchableOpacity>
          </View>

          {/* Color picker popover */}
          {showColorPicker && (
            <View style={styles.pickerRow}>
              {COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[
                    styles.colorOption,
                    { backgroundColor: c },
                    c === color && styles.colorOptionSelected,
                    c === '#FFFFFF' && styles.colorOptionWhite,
                  ]}
                  onPress={() => { setColor(c); setShowColorPicker(false); }}
                />
              ))}
            </View>
          )}

          {/* Width picker popover */}
          {showWidthPicker && (
            <View style={styles.pickerRow}>
              {WIDTHS.map((w) => (
                <TouchableOpacity
                  key={w}
                  style={[styles.widthOption, w === strokeWidth && styles.widthOptionSelected]}
                  onPress={() => { setStrokeWidth(w); setShowWidthPicker(false); }}
                >
                  <View style={[styles.widthBar, { height: w }]} />
                  <Text style={styles.widthLabel}>{w}px</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1f2e',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.15)',
  },
  headerBtn: {
    minWidth: 60,
  },
  headerBtnText: {
    fontSize: 16,
    color: '#4FC3F7',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  headerSaveText: {
    fontWeight: '700',
    textAlign: 'right',
  },
  canvas: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  textBoxWrapper: {
    position: 'absolute',
    minWidth: 40,
  },
  textInput: {
    padding: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.2)',
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.9)',
    minWidth: 80,
  },
  toolbar: {
    backgroundColor: 'rgba(20, 25, 35, 0.96)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.15)',
    paddingTop: 6,
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 8,
  },
  toolBtn: {
    padding: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 38,
    minHeight: 38,
  },
  toolBtnActive: {
    backgroundColor: 'rgba(79, 195, 247, 0.2)',
  },
  toolDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginHorizontal: 4,
  },
  colorDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#fff',
  },
  widthIndicator: {
    backgroundColor: '#fff',
    borderRadius: 4,
  },
  pickerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  colorOption: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorOptionSelected: {
    borderColor: '#4FC3F7',
  },
  colorOptionWhite: {
    borderColor: 'rgba(255,255,255,0.4)',
  },
  widthOption: {
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    minWidth: 60,
  },
  widthOptionSelected: {
    backgroundColor: 'rgba(79, 195, 247, 0.2)',
  },
  widthBar: {
    width: 30,
    backgroundColor: '#fff',
    borderRadius: 4,
    marginBottom: 4,
  },
  widthLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
  },
});

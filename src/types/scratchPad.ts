/**
 * ScratchPad types
 *
 * Data model for freeform drawing pads with pen strokes and text boxes.
 * Each pad is persisted as a JSON file in the local file system.
 */

/** A single pen stroke recorded as an SVG path. */
export interface Stroke {
  /** SVG path d-attribute, e.g. "M 10 20 Q 15 25 20 30 ..." */
  points: string;
  /** Stroke color, e.g. "#000000" */
  color: string;
  /** Stroke width in points */
  width: number;
}

/** A text annotation placed on the canvas. */
export interface TextBox {
  id: string;
  text: string;
  /** Position relative to canvas origin */
  x: number;
  y: number;
  fontSize: number;
  color: string;
}

/** Full scratchpad document persisted to disk. */
export interface ScratchPad {
  id: string;
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
  /** Canvas dimensions when the pad was created / last saved */
  canvasWidth: number;
  canvasHeight: number;
  strokes: Stroke[];
  textBoxes: TextBox[];
}

/** Lightweight metadata kept in the in-memory index for fast list rendering. */
export interface ScratchPadMeta {
  id: string;
  createdAt: string;
  updatedAt: string;
}

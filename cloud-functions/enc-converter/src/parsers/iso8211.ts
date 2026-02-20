/**
 * ISO/IEC 8211 Binary Format Parser
 *
 * Parses the ISO 8211 container format used by S-57 ENC files.
 * Works entirely with Uint8Array/DataView (no Node.js Buffer dependency).
 *
 * File structure:
 *   DDR (Data Descriptive Record) - first record, defines field structure
 *   DR  (Data Records)           - subsequent records with actual data
 *
 * Each record:
 *   Leader (24 bytes) | Directory (variable) | Field Area (variable)
 *
 * Reference implementations: GDAL (C), py-iso8211 (Python), tburke/iso8211 (Go)
 */

import {
  FIELD_TERMINATOR,
  UNIT_TERMINATOR,
  ISO8211Leader,
  ISO8211DirectoryEntry,
  ISO8211FieldDefinition,
  ISO8211SubfieldDescriptor,
  ISO8211Field,
  ISO8211Record,
  ISO8211File,
  ISO8211SubfieldValue,
  SubfieldFormat,
} from '../types/iso8211';

// ─── Utility: base64 decode ──────────────────────────────────────────────

/**
 * Decode a base64 string to Uint8Array.
 * Works in React Native (no atob needed — uses lookup table).
 */
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < BASE64_CHARS.length; i++) {
  BASE64_LOOKUP[BASE64_CHARS.charCodeAt(i)] = i;
}

export function base64ToUint8Array(base64: string): Uint8Array {
  // Strip padding
  let len = base64.length;
  while (len > 0 && base64[len - 1] === '=') len--;

  const bytes = new Uint8Array(Math.floor((len * 3) / 4));
  let p = 0;

  for (let i = 0; i < len; i += 4) {
    const a = BASE64_LOOKUP[base64.charCodeAt(i)];
    const b = i + 1 < len ? BASE64_LOOKUP[base64.charCodeAt(i + 1)] : 0;
    const c = i + 2 < len ? BASE64_LOOKUP[base64.charCodeAt(i + 2)] : 0;
    const d = i + 3 < len ? BASE64_LOOKUP[base64.charCodeAt(i + 3)] : 0;

    bytes[p++] = (a << 2) | (b >> 4);
    if (i + 2 < len) bytes[p++] = ((b & 0x0f) << 4) | (c >> 2);
    if (i + 3 < len) bytes[p++] = ((c & 0x03) << 6) | d;
  }

  return bytes;
}

// ─── Text decoding helpers ───────────────────────────────────────────────

/**
 * Read ASCII string from byte array.
 */
function readAscii(data: Uint8Array, offset: number, length: number): string {
  if (length <= 0) return '';
  // Batch decode — single call instead of per-char string concatenation.
  // Safe for ISO 8211 field strings which are always small (<1k chars).
  if (length > 10000) {
    // Fallback for unexpectedly large strings (apply has a call-stack limit)
    let str = '';
    for (let i = 0; i < length; i++) {
      str += String.fromCharCode(data[offset + i]);
    }
    return str;
  }
  return String.fromCharCode.apply(null, data.subarray(offset, offset + length) as any);
}

/**
 * Read ASCII integer from byte array.
 */
function readAsciiInt(data: Uint8Array, offset: number, length: number): number {
  return parseInt(readAscii(data, offset, length), 10);
}

/**
 * Read a null/UT/FT-terminated string from data starting at offset.
 * Returns the string and the number of bytes consumed (including terminator).
 */
function readTerminatedString(data: Uint8Array, offset: number): { value: string; bytesRead: number } {
  let end = offset;
  while (end < data.length &&
         data[end] !== UNIT_TERMINATOR &&
         data[end] !== FIELD_TERMINATOR &&
         data[end] !== 0) {
    end++;
  }
  const value = readAscii(data, offset, end - offset);
  // Include the terminator in bytes read if present
  const bytesRead = end < data.length ? end - offset + 1 : end - offset;
  return { value, bytesRead };
}

// ─── Leader parsing ──────────────────────────────────────────────────────

/**
 * Parse the 24-byte leader at the start of a record.
 */
function parseLeader(data: Uint8Array, offset: number): ISO8211Leader {
  // ISO 8211 leader (24 bytes):
  //   0-4:   Record length (5 ASCII digits)
  //   5:     Interchange level
  //   6:     Leader identifier ('L'=DDR, 'D'/' '=DR)
  //   7:     Inline code extension indicator
  //   8:     Version number
  //   9:     Application indicator
  //   10-11: Field control length (2 chars, DDR only)
  //   12-16: Base address of field area (5 ASCII digits)
  //   17-19: Extended character set indicator
  //   Entry map (bytes 20-23):
  //     20: Size of field LENGTH in directory entries
  //     21: Size of field POSITION in directory entries
  //     22: Reserved (always '0')
  //     23: Size of field TAG in directory entries
  return {
    recordLength: readAsciiInt(data, offset, 5),
    interchangeLevel: readAscii(data, offset + 5, 1),
    leaderIdentifier: readAscii(data, offset + 6, 1),
    inlineCodeExtensionIndicator: readAscii(data, offset + 7, 1),
    versionNumber: readAscii(data, offset + 8, 1),
    applicationIndicator: readAscii(data, offset + 9, 1),
    fieldControlLength: readAsciiInt(data, offset + 10, 2),
    fieldAreaBaseAddress: readAsciiInt(data, offset + 12, 5),
    extendedCharacterSetIndicator: readAscii(data, offset + 17, 3),
    sizeOfFieldLength: readAsciiInt(data, offset + 20, 1),
    sizeOfFieldPosition: readAsciiInt(data, offset + 21, 1),
    // byte 22 is reserved
    sizeOfFieldTag: readAsciiInt(data, offset + 23, 1),
  };
}

// ─── Directory parsing ───────────────────────────────────────────────────

/**
 * Parse directory entries from a record.
 * Directory starts at byte 24 and continues until FIELD_TERMINATOR.
 */
function parseDirectory(
  data: Uint8Array,
  offset: number,
  leader: ISO8211Leader,
): ISO8211DirectoryEntry[] {
  const entries: ISO8211DirectoryEntry[] = [];
  const { sizeOfFieldTag, sizeOfFieldLength, sizeOfFieldPosition } = leader;
  const entrySize = sizeOfFieldTag + sizeOfFieldLength + sizeOfFieldPosition;

  let pos = offset + 24; // Skip leader
  while (pos < offset + leader.fieldAreaBaseAddress - 1) {
    if (data[pos] === FIELD_TERMINATOR) break;

    const tag = readAscii(data, pos, sizeOfFieldTag);
    const length = readAsciiInt(data, pos + sizeOfFieldTag, sizeOfFieldLength);
    const position = readAsciiInt(data, pos + sizeOfFieldTag + sizeOfFieldLength, sizeOfFieldPosition);

    entries.push({ tag, length, position });
    pos += entrySize;
  }

  return entries;
}

// ─── Field area parsing ──────────────────────────────────────────────────

/**
 * Extract raw fields from a record's field area using directory entries.
 */
function extractFields(
  data: Uint8Array,
  recordOffset: number,
  leader: ISO8211Leader,
  directory: ISO8211DirectoryEntry[],
): ISO8211Field[] {
  const fieldAreaStart = recordOffset + leader.fieldAreaBaseAddress;

  return directory.map((entry) => {
    const fieldStart = fieldAreaStart + entry.position;
    const fieldData = data.subarray(fieldStart, fieldStart + entry.length);
    return {
      tag: entry.tag,
      data: fieldData,
    };
  });
}

// ─── DDR field definition parsing ────────────────────────────────────────

/**
 * Parse format controls string into subfield format descriptors.
 * Format controls look like: (A,I(10),A,b12,b14,b12)
 * or: (A(2),I(10),3A,A,A,A(3))
 */
function parseFormatControls(formatStr: string): SubfieldFormat[] {
  const formats: SubfieldFormat[] = [];
  if (!formatStr) return formats;

  // Remove outer parentheses
  let inner = formatStr.trim();
  if (inner.startsWith('(') && inner.endsWith(')')) {
    inner = inner.slice(1, -1);
  }
  if (!inner) return formats;

  // Split by comma, respecting nested parens
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of inner) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  for (const part of parts) {
    // Check for repeat count prefix (e.g., "3A" means A repeated 3 times)
    const repeatMatch = part.match(/^(\d+)(.+)$/);
    let repeat = 1;
    let spec = part;
    if (repeatMatch && !part.startsWith('b')) {
      repeat = parseInt(repeatMatch[1], 10);
      spec = repeatMatch[2];
    }

    for (let r = 0; r < repeat; r++) {
      const fmt = parseSingleFormat(spec);
      if (fmt) formats.push(fmt);
    }
  }

  return formats;
}

/**
 * Parse a single format specification.
 */
function parseSingleFormat(spec: string): SubfieldFormat | null {
  spec = spec.trim();

  // Binary subfield: b11, b12, b14, b21, b22, b24
  if (spec.startsWith('b')) {
    const code = spec.slice(1);
    const typeChar = code[0]; // '1' = unsigned, '2' = signed
    const widthChar = code[1]; // '1' = 1 byte, '2' = 2 bytes, '4' = 4 bytes
    const signed = typeChar === '2';
    const width = parseInt(widthChar, 10);
    return { type: 'b', signed, width };
  }

  // Binary (B) with bit width
  if (spec.startsWith('B') && spec.length > 1) {
    const widthMatch = spec.match(/B\((\d+)\)/);
    const width = widthMatch ? parseInt(widthMatch[1], 10) : parseInt(spec.slice(1), 10);
    return { type: 'B', width };
  }

  // Character string: A or A(width)
  if (spec.startsWith('A')) {
    const widthMatch = spec.match(/A\((\d+)\)/);
    return { type: 'A', width: widthMatch ? parseInt(widthMatch[1], 10) : undefined };
  }

  // Integer: I or I(width)
  if (spec.startsWith('I')) {
    const widthMatch = spec.match(/I\((\d+)\)/);
    const width = widthMatch ? parseInt(widthMatch[1], 10) : 10;
    return { type: 'I', width };
  }

  // Real: R or R(width)
  if (spec.startsWith('R')) {
    const widthMatch = spec.match(/R\((\d+)\)/);
    return { type: 'R', width: widthMatch ? parseInt(widthMatch[1], 10) : undefined };
  }

  return null;
}

/**
 * Parse a DDR field descriptor to extract the field definition.
 *
 * DDR field data structure (for non-0000 fields):
 *   Field Controls (FCL bytes) + Data Field Name + UT +
 *   Array Descriptor (subfield labels) + UT + Format Controls + FT
 *
 * @param tag - Field tag (e.g., 'DSID')
 * @param data - Raw field data bytes
 * @param fieldControlLength - From DDR leader bytes 10-11 (typically 6 for S-57)
 */
function parseDDRFieldDefinition(tag: string, data: Uint8Array, fieldControlLength: number): ISO8211FieldDefinition {
  if (tag === '0000') {
    // File control field - skip special handling
    return {
      tag,
      fieldControls: '',
      name: 'File Control',
      arrayDescriptor: '',
      formatControls: '',
      subfields: [],
    };
  }

  let pos = 0;

  // Read field controls (length from DDR leader bytes 10-11)
  const fcl = Math.min(fieldControlLength, data.length);
  const fieldControls = readAscii(data, 0, fcl);
  pos = fcl;

  // Find field name (up to first UT)
  let nameEnd = pos;
  while (nameEnd < data.length && data[nameEnd] !== UNIT_TERMINATOR) {
    nameEnd++;
  }
  const name = readAscii(data, pos, nameEnd - pos);
  pos = nameEnd + 1; // Skip UT

  // Find array descriptor and format controls
  // They are separated by UT, terminated by FT
  let arrayDesc = '';
  let formatCtrl = '';

  if (pos < data.length) {
    // Read subfield labels (array descriptor) - labels separated by '!'
    let labelEnd = pos;
    while (labelEnd < data.length && data[labelEnd] !== UNIT_TERMINATOR && data[labelEnd] !== FIELD_TERMINATOR) {
      labelEnd++;
    }
    arrayDesc = readAscii(data, pos, labelEnd - pos);
    pos = labelEnd + 1; // Skip UT

    // Read format controls
    if (pos < data.length) {
      let fmtEnd = pos;
      while (fmtEnd < data.length && data[fmtEnd] !== FIELD_TERMINATOR) {
        fmtEnd++;
      }
      formatCtrl = readAscii(data, pos, fmtEnd - pos);
    }
  }

  // Check for repeating '*' prefix in array descriptor
  // The '*' means the subfield group repeats until end of field
  const isRepeating = arrayDesc.startsWith('*');
  const cleanArrayDesc = isRepeating ? '*' : arrayDesc;

  // Parse subfield labels — strip '*' prefix from first label
  let rawLabels = arrayDesc ? arrayDesc.split('!').filter(l => l.length > 0) : [];
  if (rawLabels.length > 0 && rawLabels[0].startsWith('*')) {
    rawLabels[0] = rawLabels[0].slice(1);
  }

  // Parse format controls
  const formats = parseFormatControls(formatCtrl);

  // Build subfield descriptors by matching labels to formats
  const subfields: ISO8211SubfieldDescriptor[] = [];
  for (let i = 0; i < rawLabels.length; i++) {
    const fmt = i < formats.length ? formats[i] : { type: 'A' as const };
    subfields.push({ label: rawLabels[i], format: fmt });
  }

  return {
    tag,
    fieldControls,
    name,
    arrayDescriptor: cleanArrayDesc,
    formatControls: formatCtrl,
    subfields,
  };
}

// ─── Record parsing ──────────────────────────────────────────────────────

/**
 * Parse a single ISO 8211 record starting at the given offset.
 * Returns the parsed record and the offset of the next record.
 */
function parseRecord(data: Uint8Array, offset: number): { record: ISO8211Record; nextOffset: number } {
  const leader = parseLeader(data, offset);
  const directory = parseDirectory(data, offset, leader);
  const fields = extractFields(data, offset, leader, directory);

  return {
    record: { leader, directory, fields },
    nextOffset: offset + leader.recordLength,
  };
}

// ─── Complete file parsing ───────────────────────────────────────────────

/**
 * Parse a complete ISO 8211 file from binary data.
 */
export function parseISO8211(data: Uint8Array): ISO8211File {
  let offset = 0;

  // Parse DDR (first record)
  const { record: ddr, nextOffset } = parseRecord(data, offset);
  offset = nextOffset;

  // Extract field definitions from DDR
  // Field control length comes from DDR leader bytes 10-11
  const fcl = ddr.leader.fieldControlLength || 6;
  const fieldDefinitions = new Map<string, ISO8211FieldDefinition>();
  for (const field of ddr.fields) {
    const def = parseDDRFieldDefinition(field.tag, field.data, fcl);
    fieldDefinitions.set(field.tag, def);
  }

  // Parse all data records
  const dataRecords: ISO8211Record[] = [];
  while (offset < data.length) {
    // Check we have enough bytes for a leader
    if (offset + 24 > data.length) break;

    // Sanity check: record length should be valid
    const recLen = readAsciiInt(data, offset, 5);
    if (recLen <= 0 || offset + recLen > data.length) break;

    const { record, nextOffset: next } = parseRecord(data, offset);
    dataRecords.push(record);
    offset = next;
  }

  return { ddr, fieldDefinitions, dataRecords };
}

// ─── Subfield value extraction ───────────────────────────────────────────

/**
 * Read a single subfield value from field data at the given offset.
 * Returns the parsed value and the number of bytes consumed.
 */
export function readSubfieldValue(
  data: Uint8Array,
  offset: number,
  format: SubfieldFormat,
  view?: DataView,
): { value: string | number; bytesRead: number } {
  if (!view) view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  switch (format.type) {
    case 'A': {
      if (format.width !== undefined) {
        // Fixed width string
        const value = readAscii(data, offset, format.width);
        return { value, bytesRead: format.width };
      }
      // Variable length, terminated by UT or FT
      const result = readTerminatedString(data, offset);
      return { value: result.value, bytesRead: result.bytesRead };
    }

    case 'I': {
      if (format.width !== undefined) {
        // Fixed width integer as ASCII text
        const str = readAscii(data, offset, format.width);
        return { value: parseInt(str, 10) || 0, bytesRead: format.width };
      }
      // Variable length integer
      const result = readTerminatedString(data, offset);
      return { value: parseInt(result.value, 10) || 0, bytesRead: result.bytesRead };
    }

    case 'R': {
      if (format.width !== undefined) {
        const str = readAscii(data, offset, format.width);
        return { value: parseFloat(str) || 0, bytesRead: format.width };
      }
      const result = readTerminatedString(data, offset);
      return { value: parseFloat(result.value) || 0, bytesRead: result.bytesRead };
    }

    case 'B': {
      // Binary data, width is in bits
      const byteWidth = Math.ceil(format.width / 8);
      let value = 0;
      for (let i = 0; i < byteWidth && offset + i < data.length; i++) {
        value = (value << 8) | data[offset + i];
      }
      return { value, bytesRead: byteWidth };
    }

    case 'b': {
      // Binary integer
      const { signed, width } = format;
      if (offset + width > data.length) {
        return { value: 0, bytesRead: width };
      }
      let value: number;
      switch (width) {
        case 1:
          value = signed ? view.getInt8(offset) : data[offset];
          break;
        case 2:
          value = signed
            ? view.getInt16(offset, true)  // little-endian
            : view.getUint16(offset, true);
          break;
        case 4:
          value = signed
            ? view.getInt32(offset, true)
            : view.getUint32(offset, true);
          break;
        default:
          value = 0;
      }
      return { value, bytesRead: width };
    }
  }
}

/**
 * Check whether a subfield format has a fixed byte width (binary types, or
 * text types with an explicit width). Fixed-width formats must NOT use
 * FIELD_TERMINATOR (0x1E) as a sentinel because 0x1E is a valid data byte.
 */
function isFixedWidthFormat(fmt: SubfieldFormat): boolean {
  switch (fmt.type) {
    case 'b': return true;  // binary integer — always fixed width
    case 'B': return true;  // binary data — always fixed width
    case 'A': return fmt.width !== undefined;
    case 'I': return fmt.width !== undefined;
    case 'R': return fmt.width !== undefined;
    default: return false;
  }
}

/**
 * Parse all subfield values from a field's data using its definition.
 * Handles repeating fields (arrayDescriptor = '*').
 */
export function parseFieldValues(
  fieldData: Uint8Array,
  fieldDef: ISO8211FieldDefinition,
): ISO8211SubfieldValue[][] {
  const results: ISO8211SubfieldValue[][] = [];
  if (!fieldDef.subfields.length) return results;

  // Create DataView once and reuse for all subfield reads in this field
  const view = new DataView(fieldData.buffer, fieldData.byteOffset, fieldData.byteLength);
  let offset = 0;
  const dataLen = fieldData.length;

  // Continue reading groups of subfields until we run out of data
  while (offset < dataLen) {
    // Only check for field terminator if the first subfield is variable-length.
    // For binary (fixed-width) subfields, 0x1E is a valid data byte, not a terminator.
    const firstFmt = fieldDef.subfields[0]?.format;
    if (firstFmt && !isFixedWidthFormat(firstFmt) && fieldData[offset] === FIELD_TERMINATOR) break;

    const group: ISO8211SubfieldValue[] = [];
    let groupComplete = true;

    for (const sf of fieldDef.subfields) {
      if (offset >= dataLen) {
        groupComplete = false;
        break;
      }

      // Only treat 0x1E as a field terminator for variable-length text formats.
      // Binary subfields have fixed widths, and 0x1E (30) is a valid binary value.
      if (!isFixedWidthFormat(sf.format) && fieldData[offset] === FIELD_TERMINATOR) {
        groupComplete = false;
        break;
      }

      const { value, bytesRead } = readSubfieldValue(fieldData, offset, sf.format, view);
      group.push({ label: sf.label, value });
      offset += bytesRead;
    }

    // For repeating fields, only push complete groups — partial groups at the
    // end happen when the parser reads into the field terminator byte (0x1E is
    // a valid value for fixed-width binary subfields like ATTL).
    if (group.length > 0) {
      if (groupComplete || fieldDef.arrayDescriptor !== '*') {
        results.push(group);
      }
    }

    // If not a repeating field, only read one group
    if (fieldDef.arrayDescriptor !== '*') break;
    if (!groupComplete) break;
  }

  return results;
}

/**
 * Convenience: parse field values as a flat key-value map (first group only).
 */
export function parseFieldAsMap(
  fieldData: Uint8Array,
  fieldDef: ISO8211FieldDefinition,
): Map<string, string | number> {
  const groups = parseFieldValues(fieldData, fieldDef);
  const map = new Map<string, string | number>();
  if (groups.length > 0) {
    for (const sv of groups[0]) {
      map.set(sv.label, sv.value);
    }
  }
  return map;
}

/**
 * Convenience: parse repeating field into array of maps.
 */
export function parseFieldAsArray(
  fieldData: Uint8Array,
  fieldDef: ISO8211FieldDefinition,
): Array<Map<string, string | number>> {
  const groups = parseFieldValues(fieldData, fieldDef);
  return groups.map((group) => {
    const map = new Map<string, string | number>();
    for (const sv of group) {
      map.set(sv.label, sv.value);
    }
    return map;
  });
}

// ─── Exports ─────────────────────────────────────────────────────────────

export { parseLeader, parseDirectory, extractFields, parseFormatControls };

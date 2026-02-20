/**
 * ISO/IEC 8211 binary format type definitions.
 * This is the container format used by S-57 ENC files (.000).
 */

/** Field Terminator byte */
export const FIELD_TERMINATOR = 0x1e;

/** Unit Terminator byte */
export const UNIT_TERMINATOR = 0x1f;

/**
 * Leader structure (first 24 bytes of every record).
 */
export interface ISO8211Leader {
  /** Total record length in bytes (bytes 0-4) */
  recordLength: number;
  /** Interchange level (byte 5): '1', '2', or '3' */
  interchangeLevel: string;
  /** Leader identifier (byte 6): 'L' for DDR, 'D' or ' ' for DR */
  leaderIdentifier: string;
  /** Inline code extension indicator (byte 7) */
  inlineCodeExtensionIndicator: string;
  /** Version number (byte 8) */
  versionNumber: string;
  /** Application indicator (byte 9) */
  applicationIndicator: string;
  /** Field control length (bytes 10-11, DDR only) */
  fieldControlLength: number;
  /** Base address of the field area (bytes 12-16) */
  fieldAreaBaseAddress: number;
  /** Extended character set indicators (bytes 17-19) */
  extendedCharacterSetIndicator: string;
  /** Size of field length in directory entry (byte 20) */
  sizeOfFieldLength: number;
  /** Size of field position in directory entry (byte 21) */
  sizeOfFieldPosition: number;
  /** Size of field tag in directory entry (byte 23) */
  sizeOfFieldTag: number;
}

/**
 * A single entry in the record directory.
 */
export interface ISO8211DirectoryEntry {
  /** Field tag (e.g., '0000', 'DSID', 'FRID') */
  tag: string;
  /** Length of the field data in bytes */
  length: number;
  /** Position (offset) of field data relative to field area base */
  position: number;
}

/**
 * Format control type for subfields.
 */
export type SubfieldFormat =
  | { type: 'A'; width?: number }   // Character string
  | { type: 'I'; width: number }    // Integer
  | { type: 'R'; width?: number }   // Real/float
  | { type: 'B'; width: number }    // Binary (width in bits)
  | { type: 'b'; signed: boolean; width: number } // Binary integer (width in bytes: 11=uint8, 12=uint16, 14=uint32, 21=int8, 22=int16, 24=int32)
  ;

/**
 * A subfield descriptor (parsed from DDR field definitions).
 */
export interface ISO8211SubfieldDescriptor {
  /** Subfield label/name */
  label: string;
  /** Format specification */
  format: SubfieldFormat;
}

/**
 * A field definition from the DDR (Data Descriptive Record).
 */
export interface ISO8211FieldDefinition {
  /** Field tag */
  tag: string;
  /** Field control string */
  fieldControls: string;
  /** Human-readable field name */
  name: string;
  /** Array descriptor (empty or '*' for repeating) */
  arrayDescriptor: string;
  /** Raw format controls string */
  formatControls: string;
  /** Parsed subfield descriptors */
  subfields: ISO8211SubfieldDescriptor[];
}

/**
 * A field within a data record (raw data).
 */
export interface ISO8211Field {
  /** Field tag */
  tag: string;
  /** Raw field data bytes */
  data: Uint8Array;
}

/**
 * A parsed subfield value.
 */
export interface ISO8211SubfieldValue {
  /** Subfield label */
  label: string;
  /** Parsed value (string for text fields, number for numeric/binary) */
  value: string | number;
}

/**
 * A parsed ISO 8211 record.
 */
export interface ISO8211Record {
  /** Parsed leader */
  leader: ISO8211Leader;
  /** Directory entries */
  directory: ISO8211DirectoryEntry[];
  /** Raw fields */
  fields: ISO8211Field[];
}

/**
 * Complete parsed ISO 8211 file.
 */
export interface ISO8211File {
  /** Data Descriptive Record (first record) */
  ddr: ISO8211Record;
  /** Field definitions extracted from DDR */
  fieldDefinitions: Map<string, ISO8211FieldDefinition>;
  /** Data Records (all subsequent records) */
  dataRecords: ISO8211Record[];
}

/**
 * S-57 Data Decoder
 *
 * Interprets ISO 8211 records according to S-57 (IHO Transfer Standard
 * for Digital Hydrographic Data) semantics.
 *
 * Extracts:
 * - Dataset identification (DSID) and parameters (DSPM)
 * - Feature records (FRID/FOID/ATTF/NATF/FSPT)
 * - Spatial records: Isolated Nodes (VI), Connected Nodes (VC), Edges (VE)
 */

import {
  ISO8211File,
  ISO8211Record,
  ISO8211Field,
  ISO8211FieldDefinition,
  FIELD_TERMINATOR,
  UNIT_TERMINATOR,
} from '../types/iso8211';
import {
  S57Dataset,
  S57DatasetIdentification,
  S57DatasetParameters,
  S57Feature,
  S57Node,
  S57Edge,
  S57SpatialRef,
  RCNM,
} from '../types/s57';
import { parseFieldValues, parseFieldAsMap, parseFieldAsArray, readSubfieldValue } from './iso8211';

/**
 * Decode an ISO 8211 file into an S-57 dataset.
 */
export function decodeS57(iso8211: ISO8211File): S57Dataset {
  const dataset: S57Dataset = {
    dsid: createDefaultDSID(),
    dspm: createDefaultDSPM(),
    features: new Map(),
    isolatedNodes: new Map(),
    connectedNodes: new Map(),
    edges: new Map(),
  };

  for (const record of iso8211.dataRecords) {
    processRecord(record, iso8211.fieldDefinitions, dataset);
  }

  return dataset;
}

// ─── Default structures ──────────────────────────────────────────────────

function createDefaultDSID(): S57DatasetIdentification {
  return {
    rcnm: 10, rcid: 0, expp: 1, intu: 0,
    dsnm: '', edtn: '', updn: '', uadt: '', isdt: '', sted: '',
    prsp: 0, prof: 0, agen: 0, comt: '',
    dstr: 0, aall: 0, nall: 0,
    nomr: 0, nocr: 0, nogr: 0, nolr: 0,
    noin: 0, nocn: 0, noed: 0, nofa: 0,
  };
}

function createDefaultDSPM(): S57DatasetParameters {
  return {
    rcnm: 20, rcid: 0,
    hdat: 2, vdat: 0, sdat: 0, cscl: 0,
    duni: 1, huni: 1, puni: 1, coun: 1,
    comf: 10000000, somf: 10,
  };
}

// ─── Record processing ──────────────────────────────────────────────────

function processRecord(
  record: ISO8211Record,
  fieldDefs: Map<string, ISO8211FieldDefinition>,
  dataset: S57Dataset,
): void {
  // Determine record type by finding the identifying field tag.
  // The first field is often '0001' (ISO 8211 record identifier) — skip it.
  // Linear scan with early exit is faster than allocating a Set per record.
  let identifyingTag = '';
  for (const f of record.fields) {
    const t = f.tag;
    if (t === 'DSID' || t === 'DSPM' || t === 'FRID' || t === 'VRID') {
      identifyingTag = t;
      break;
    }
  }

  switch (identifyingTag) {
    case 'DSID': processDSID(record, fieldDefs, dataset); break;
    case 'DSPM': processDSPM(record, fieldDefs, dataset); break;
    case 'FRID': processFeatureRecord(record, fieldDefs, dataset); break;
    case 'VRID': processVectorRecord(record, fieldDefs, dataset); break;
  }
}

// ─── DSID processing ─────────────────────────────────────────────────────

function processDSID(
  record: ISO8211Record,
  fieldDefs: Map<string, ISO8211FieldDefinition>,
  dataset: S57Dataset,
): void {
  for (const field of record.fields) {
    const def = fieldDefs.get(field.tag);
    if (!def) continue;

    if (field.tag === 'DSID') {
      const vals = parseFieldAsMap(field.data, def);
      dataset.dsid.rcnm = asNumber(vals.get('RCNM'));
      dataset.dsid.rcid = asNumber(vals.get('RCID'));
      dataset.dsid.expp = asNumber(vals.get('EXPP'));
      dataset.dsid.intu = asNumber(vals.get('INTU'));
      dataset.dsid.dsnm = asString(vals.get('DSNM'));
      dataset.dsid.edtn = asString(vals.get('EDTN'));
      dataset.dsid.updn = asString(vals.get('UPDN'));
      dataset.dsid.uadt = asString(vals.get('UADT'));
      dataset.dsid.isdt = asString(vals.get('ISDT'));
      dataset.dsid.sted = asString(vals.get('STED'));
      dataset.dsid.prsp = asNumber(vals.get('PRSP'));
      dataset.dsid.prof = asNumber(vals.get('PROF'));
      dataset.dsid.agen = asNumber(vals.get('AGEN'));
      dataset.dsid.comt = asString(vals.get('COMT'));
    } else if (field.tag === 'DSSI') {
      const vals = parseFieldAsMap(field.data, def);
      dataset.dsid.dstr = asNumber(vals.get('DSTR'));
      dataset.dsid.aall = asNumber(vals.get('AALL'));
      dataset.dsid.nall = asNumber(vals.get('NALL'));
      dataset.dsid.nomr = asNumber(vals.get('NOMR'));
      dataset.dsid.nocr = asNumber(vals.get('NOCR'));
      dataset.dsid.nogr = asNumber(vals.get('NOGR'));
      dataset.dsid.nolr = asNumber(vals.get('NOLR'));
      dataset.dsid.noin = asNumber(vals.get('NOIN'));
      dataset.dsid.nocn = asNumber(vals.get('NOCN'));
      dataset.dsid.noed = asNumber(vals.get('NOED'));
      dataset.dsid.nofa = asNumber(vals.get('NOFA'));
    }
  }
}

// ─── DSPM processing ─────────────────────────────────────────────────────

function processDSPM(
  record: ISO8211Record,
  fieldDefs: Map<string, ISO8211FieldDefinition>,
  dataset: S57Dataset,
): void {
  for (const field of record.fields) {
    if (field.tag !== 'DSPM') continue;
    const def = fieldDefs.get(field.tag);
    if (!def) continue;

    const vals = parseFieldAsMap(field.data, def);
    dataset.dspm.rcnm = asNumber(vals.get('RCNM'));
    dataset.dspm.rcid = asNumber(vals.get('RCID'));
    dataset.dspm.hdat = asNumber(vals.get('HDAT'));
    dataset.dspm.vdat = asNumber(vals.get('VDAT'));
    dataset.dspm.sdat = asNumber(vals.get('SDAT'));
    dataset.dspm.cscl = asNumber(vals.get('CSCL'));
    dataset.dspm.duni = asNumber(vals.get('DUNI'));
    dataset.dspm.huni = asNumber(vals.get('HUNI'));
    dataset.dspm.puni = asNumber(vals.get('PUNI'));
    dataset.dspm.coun = asNumber(vals.get('COUN'));
    dataset.dspm.comf = asNumber(vals.get('COMF')) || 10000000;
    dataset.dspm.somf = asNumber(vals.get('SOMF')) || 10;
  }
}

// ─── Feature record processing ───────────────────────────────────────────

function processFeatureRecord(
  record: ISO8211Record,
  fieldDefs: Map<string, ISO8211FieldDefinition>,
  dataset: S57Dataset,
): void {
  const feature: S57Feature = {
    rcid: 0,
    prim: 255,
    grup: 0,
    objl: 0,
    agen: 0,
    fidn: 0,
    fids: 0,
    attributes: new Map(),
    natAttributes: new Map(),
    spatialRefs: [],
  };

  for (const field of record.fields) {
    const def = fieldDefs.get(field.tag);
    if (!def) continue;

    switch (field.tag) {
      case 'FRID': {
        const vals = parseFieldAsMap(field.data, def);
        feature.rcid = asNumber(vals.get('RCID'));
        feature.prim = asNumber(vals.get('PRIM'));
        feature.grup = asNumber(vals.get('GRUP'));
        feature.objl = asNumber(vals.get('OBJL'));
        break;
      }

      case 'FOID': {
        const vals = parseFieldAsMap(field.data, def);
        feature.agen = asNumber(vals.get('AGEN'));
        feature.fidn = asNumber(vals.get('FIDN'));
        feature.fids = asNumber(vals.get('FIDS'));
        break;
      }

      case 'ATTF': {
        // Repeating attribute field: ATTL (code) + ATVL (value) pairs
        const groups = parseFieldValues(field.data, def);
        for (const group of groups) {
          let attl = 0;
          let atvl = '';
          for (const sf of group) {
            if (sf.label === 'ATTL') attl = asNumber(sf.value);
            if (sf.label === 'ATVL') atvl = asString(sf.value);
          }
          if (attl > 0) {
            feature.attributes.set(attl, atvl);
          }
        }
        break;
      }

      case 'NATF': {
        // National attribute field (same structure as ATTF)
        const groups = parseFieldValues(field.data, def);
        for (const group of groups) {
          let attl = 0;
          let atvl = '';
          for (const sf of group) {
            if (sf.label === 'ATTL') attl = asNumber(sf.value);
            if (sf.label === 'ATVL') atvl = asString(sf.value);
          }
          if (attl > 0) {
            feature.natAttributes.set(attl, atvl);
          }
        }
        break;
      }

      case 'FSPT': {
        // Feature-to-Spatial record pointer
        // NAME is an 8-byte binary field: RCNM(1) + RCID(4) + padding
        // In S-57 the NAME field is actually composed of RCNM(b11) + RCID(b14)
        // plus ORNT(b11) + USAG(b11) + MASK(b11) for FSPT
        const groups = parseFieldValues(field.data, def);
        for (const group of groups) {
          const ref: S57SpatialRef = {
            rcnm: 0, rcid: 0, ornt: 1, usag: 1, mask: 0,
          };
          for (const sf of group) {
            switch (sf.label) {
              case 'NAME': {
                // NAME is a binary compound: RCNM (1 byte) + RCID (4 bytes LE)
                // It comes as a number from the binary parser, but we need to
                // handle it specially. The NAME subfield is typically parsed as
                // raw bytes.
                // We'll extract RCNM and RCID from the raw field data instead.
                break;
              }
              case 'ORNT': ref.ornt = asNumber(sf.value); break;
              case 'USAG': ref.usag = asNumber(sf.value); break;
              case 'MASK': ref.mask = asNumber(sf.value); break;
            }
          }
          feature.spatialRefs.push(ref);
        }
        // Re-parse FSPT NAME fields from raw binary data
        parseFSPTNames(field.data, def, feature.spatialRefs);
        break;
      }
    }
  }

  if (feature.rcid > 0) {
    dataset.features.set(feature.rcid, feature);
  }
}

/**
 * Parse FSPT NAME subfields from raw binary data.
 * NAME is a 5-byte binary field: RCNM(uint8) + RCID(uint32 LE).
 * Each FSPT group is: NAME(5) + ORNT(1) + USAG(1) + MASK(1) = 8 bytes.
 */
function parseFSPTNames(
  data: Uint8Array,
  def: ISO8211FieldDefinition,
  refs: S57SpatialRef[],
): void {
  // Determine the record size from the field definition
  // FSPT subfields: NAME(B(40)) or NAME(b15), ORNT(b11), USAG(b11), MASK(b11)
  // Total per record: 5 + 1 + 1 + 1 = 8 bytes
  const recordSize = 8;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  let offset = 0;
  let idx = 0;

  while (offset + recordSize <= data.length && idx < refs.length) {
    const rcnm = data[offset];
    const rcid = view.getUint32(offset + 1, true); // little-endian
    const ornt = data[offset + 5];
    const usag = data[offset + 6];
    const mask = data[offset + 7];

    refs[idx].rcnm = rcnm;
    refs[idx].rcid = rcid;
    refs[idx].ornt = ornt;
    refs[idx].usag = usag;
    refs[idx].mask = mask;

    offset += recordSize;
    idx++;
  }

  // Trim refs if we have fewer than expected
  refs.length = idx;
}

// ─── Vector record processing ────────────────────────────────────────────

function processVectorRecord(
  record: ISO8211Record,
  fieldDefs: Map<string, ISO8211FieldDefinition>,
  dataset: S57Dataset,
): void {
  let rcnm = 0;
  let rcid = 0;

  // First pass: get VRID info
  for (const field of record.fields) {
    if (field.tag !== 'VRID') continue;
    const def = fieldDefs.get(field.tag);
    if (!def) continue;

    const vals = parseFieldAsMap(field.data, def);
    rcnm = asNumber(vals.get('RCNM'));
    rcid = asNumber(vals.get('RCID'));
    break;
  }

  if (rcid === 0) return;

  switch (rcnm) {
    case RCNM.VI: // Isolated Node
    case RCNM.VC: // Connected Node
      processNodeRecord(record, fieldDefs, dataset, rcnm, rcid);
      break;
    case RCNM.VE: // Edge
      processEdgeRecord(record, fieldDefs, dataset, rcid);
      break;
  }
}

function processNodeRecord(
  record: ISO8211Record,
  fieldDefs: Map<string, ISO8211FieldDefinition>,
  dataset: S57Dataset,
  rcnm: number,
  rcid: number,
): void {
  const node: S57Node = { rcid, rcnm, lat: 0, lon: 0 };

  for (const field of record.fields) {
    const def = fieldDefs.get(field.tag);
    if (!def) continue;

    if (field.tag === 'SG2D') {
      // 2D coordinate: YCOO (lat), XCOO (lon) as b24 (int32)
      const coords = parseSG2D(field.data, dataset.dspm.comf);
      if (coords.length > 0) {
        node.lat = coords[0].lat;
        node.lon = coords[0].lon;
      }
    } else if (field.tag === 'SG3D') {
      // 3D coordinate: YCOO, XCOO, VE3D (depth)
      const coords = parseSG3D(field.data, dataset.dspm.comf, dataset.dspm.somf);
      if (coords.length > 0) {
        node.lat = coords[0].lat;
        node.lon = coords[0].lon;
        node.depth = coords[0].depth;
      }
    }
  }

  if (rcnm === RCNM.VI) {
    dataset.isolatedNodes.set(rcid, node);
  } else {
    dataset.connectedNodes.set(rcid, node);
  }
}

function processEdgeRecord(
  record: ISO8211Record,
  fieldDefs: Map<string, ISO8211FieldDefinition>,
  dataset: S57Dataset,
  rcid: number,
): void {
  const edge: S57Edge = {
    rcid,
    startNode: 0,
    endNode: 0,
    coordinates: [],
  };

  for (const field of record.fields) {
    const def = fieldDefs.get(field.tag);
    if (!def) continue;

    if (field.tag === 'VRPT') {
      // Vector record pointer: start/end nodes
      // VRPT structure: NAME(5 bytes: RCNM+RCID) + ORNT(1) + USAG(1) + TOPI(1) + MASK(1)
      parseVRPT(field.data, edge);
    } else if (field.tag === 'SG2D') {
      edge.coordinates = parseSG2D(field.data, dataset.dspm.comf);
    }
  }

  dataset.edges.set(rcid, edge);
}

/**
 * Parse VRPT (Vector Record Pointer) to extract start/end node references.
 * Each VRPT entry: NAME(5) + ORNT(1) + USAG(1) + TOPI(1) + MASK(1) = 9 bytes
 * TOPI: 1=beginning node, 2=end node
 */
function parseVRPT(data: Uint8Array, edge: S57Edge): void {
  const recordSize = 9;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  while (offset + recordSize <= data.length) {
    const rcnm = data[offset];
    const rcid = view.getUint32(offset + 1, true);
    const topi = data[offset + 7];

    if (topi === 1) {
      edge.startNode = rcid;
    } else if (topi === 2) {
      edge.endNode = rcid;
    }

    offset += recordSize;
  }
}

/**
 * Parse SG2D (2D coordinate) field.
 * Each coord pair: YCOO(int32 LE) + XCOO(int32 LE) = 8 bytes.
 * Divide by COMF to get decimal degrees.
 */
function parseSG2D(data: Uint8Array, comf: number): Array<{ lat: number; lon: number }> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const recordSize = 8;
  const count = Math.floor(data.length / recordSize);
  const coords = new Array<{ lat: number; lon: number }>(count);

  for (let i = 0; i < count; i++) {
    const offset = i * recordSize;
    const ycoo = view.getInt32(offset, true);
    const xcoo = view.getInt32(offset + 4, true);
    coords[i] = { lat: ycoo / comf, lon: xcoo / comf };
  }

  return coords;
}

/**
 * Parse SG3D (3D coordinate) field.
 * Each coord: YCOO(int32) + XCOO(int32) + VE3D(int32) = 12 bytes.
 */
function parseSG3D(
  data: Uint8Array,
  comf: number,
  somf: number,
): Array<{ lat: number; lon: number; depth: number }> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const recordSize = 12;
  const count = Math.floor(data.length / recordSize);
  const coords = new Array<{ lat: number; lon: number; depth: number }>(count);

  for (let i = 0; i < count; i++) {
    const offset = i * recordSize;
    const ycoo = view.getInt32(offset, true);
    const xcoo = view.getInt32(offset + 4, true);
    const ve3d = view.getInt32(offset + 8, true);
    coords[i] = { lat: ycoo / comf, lon: xcoo / comf, depth: ve3d / somf };
  }

  return coords;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function asNumber(val: string | number | undefined): number {
  if (val === undefined) return 0;
  return typeof val === 'number' ? val : parseInt(String(val), 10) || 0;
}

function asString(val: string | number | undefined): string {
  if (val === undefined) return '';
  return String(val);
}

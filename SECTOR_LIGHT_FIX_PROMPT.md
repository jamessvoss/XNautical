# Sector Light Rendering — Three Bug Fixes

## Background

This is a React Native maritime charting app (XNautical) that displays S-57 Electronic Navigational Chart data on mobile devices using MapLibre. Sector lights are navigation lights that shine through defined angular sectors. In S-57 encoding, each sector of a physical light is stored as a separate LIGHTS feature (OBJL=75) at the same coordinate, with different SECTR1/SECTR2 bearing angles and COLOUR values.

Sector arcs are rendered dynamically on the client. The pipeline works as follows:

1. **Per-chart conversion** (`cloud-functions/enc-converter/src/convert_s57.ts`): S-57 → GeoJSON. Extracts LIGHTS features and writes a per-chart sidecar JSON file (`{chartId}.sector-lights.json`) with `{lon, lat, sectr1, sectr2, colour, scamin, chartId}` for each sector.

2. **District compose** (`cloud-functions/enc-converter/compose_job.py`): Merges per-chart GeoJSON into MBTiles. All Point features go into `points.mbtiles`. Sector lights are re-collected from the merged features and embedded as a JSON array in the `sector_lights` metadata key of `points.mbtiles`.

3. **App rendering** (`src/components/DynamicChartViewer.native.tsx`): On chart load, reads the `sector_lights` metadata from `points.mbtiles`, stores it in `sectorLightIndexRef`. On every map move/zoom, generates arc + leg LineString geometries from this index and renders them via a MapLibre ShapeSource with LineLayer styling.

There are three bugs that all need to be fixed. Read every file referenced below before making changes.

---

## Bug 1: Multi-Sector Lights Losing All But One Sector (Dedup Key)

### Problem

The compose pipeline deduplicates point features to remove cross-scale duplicates (the same buoy appearing in both US4 and US5 charts). LIGHTS (OBJL=75) is in `DEDUP_POINT_OBJLS` (compose_job.py, line 103-104). The dedup key for unnamed points (compose_job.py, lines 329-333) is:

```python
lon = round(coords[0], 5)
lat = round(coords[1], 5)
return f"{objl}:{lon}:{lat}"
```

Multi-sector lights are multiple LIGHTS features at identical coordinates with different SECTR1/SECTR2/COLOUR. They all produce the same dedup key. The dedup check at lines 1034-1050 skips all but the first one. Only one sector survives; all others are discarded.

**Concrete example:** The light at `[-151.721127, 59.452154]` in chart US5AK5QG has two sectors in the source data (`assets/Maps/US5AK5QG_lights.json`, lines 6-7):
- Sector 1: SECTR1=80.0, SECTR2=88.0, COLOUR=1, VALNMR=7.0
- Sector 2: SECTR1=98.0, SECTR2=202.0, COLOUR=1, VALNMR=7.0

Only sector 1 (the narrow 8° arc) renders. Sector 2 (the wide 104° arc) is lost in dedup.

### Fix Location

`cloud-functions/enc-converter/compose_job.py`, function `dedup_key()` (lines 301-343).

### Required Change

For LIGHTS features (OBJL=75), the dedup key must include sector bearings and colour to distinguish co-located sectors while still deduplicating the same sector across chart scales. Non-sector LIGHTS (no SECTR1/SECTR2) should continue to use the existing key format.

In the Point branch of `dedup_key()` (the `if geom_type == 'Point':` block), add handling for LIGHTS before the existing named/unnamed fallback logic:

```python
if geom_type == 'Point':
    coords = geom.get('coordinates', [0, 0])
    # LIGHTS: include sector bearings + colour to preserve multi-sector lights
    if objl == 75:
        sectr1 = props.get('SECTR1', '')
        sectr2 = props.get('SECTR2', '')
        colour = props.get('COLOUR', '')
        lon = round(coords[0], 5)
        lat = round(coords[1], 5)
        return f"{objl}:{lon}:{lat}:{sectr1}:{sectr2}:{colour}"
    if objnam:
        # ... existing named-point logic ...
```

This ensures each sector at the same physical light generates a unique key, but the same sector appearing in overlapping chart scales (e.g., US4 and US5 both containing the same sector) still deduplicates correctly.

---

## Bug 2: VALNMR (Nominal Range) Missing from Sector Light Index

### Problem

The VALNMR attribute (Value of Nominal Range, in nautical miles) exists in the S-57 source data and is passed through to GeoJSON/MBTiles tile properties. However, it is **not included** in the sector light sidecar data at any stage:

1. `convert_s57.ts` (lines 205-213): The sidecar JSON object does not include `valnmr`. The `SectorLight` interface at lines 56-64 has no `valnmr` field.
2. `compose_job.py` (lines 1092-1100): The `sector_lights_index` entry does not include `valnmr` (it uses `stripped` properties, and VALNMR is present in `stripped` but not copied to the index dict).
3. `DynamicChartViewer.native.tsx` (lines 904-906): The `SectorLight` interface has no `valnmr` field.

Without VALNMR in the sector light index, the app renderer cannot enforce the physical range ceiling (the arc must never extend beyond the light's nominal range).

### Fix Locations & Changes

**File 1: `cloud-functions/enc-converter/src/convert_s57.ts`**

Add `valnmr` to the `SectorLight` interface (line 56-64):

```typescript
interface SectorLight {
  lon: number;
  lat: number;
  sectr1: number;
  sectr2: number;
  colour: number;
  scamin: number;
  chartId: string;
  valnmr?: number;
}
```

Add `valnmr` to the sidecar push (lines 205-213). The VALNMR value is available in `props.VALNMR`. Parse it the same way SCAMIN is parsed:

```typescript
sectorLights.push({
  lon: roundCoord(geom.coordinates[0]),
  lat: roundCoord(geom.coordinates[1]),
  sectr1,
  sectr2,
  colour: colour ?? 1,
  scamin: isNaN(scamin) ? Infinity : scamin,
  chartId,
  valnmr: props.VALNMR !== undefined ? parseFloat(String(props.VALNMR)) : undefined,
});
```

**File 2: `cloud-functions/enc-converter/compose_job.py`**

Add `valnmr` to the sector lights index entry (lines 1092-1100). The value is in `stripped` dict under key `'VALNMR'`:

```python
sector_lights_index.append({
    'lon': round(coords[0], 6),
    'lat': round(coords[1], 6),
    'sectr1': float(sectr1),
    'sectr2': float(sectr2),
    'colour': int(stripped.get('COLOUR', 1)),
    'scamin': float(best_scamin) if best_scamin > 0 else 0,
    'scaleNum': scale_num,
    'valnmr': float(stripped['VALNMR']) if stripped.get('VALNMR') is not None else None,
})
```

Note: Use `None` (which becomes `null` in JSON) for lights without VALNMR, not 0 — a zero range is semantically different from "no range data."

**File 3: `src/components/DynamicChartViewer.native.tsx`**

Add `valnmr` to the `SectorLight` interface (lines 904-906):

```typescript
interface SectorLight {
  lon: number; lat: number; sectr1: number; sectr2: number;
  colour: number; scamin: number; scaleNum?: number;
  valnmr?: number;
}
```

---

## Bug 3: Arc Radius Has No VALNMR Physical Ceiling or Mobile Clamping Logic

### Problem

The dynamic arc renderer at `DynamicChartViewer.native.tsx` lines 1653-1772 uses a fixed screen-constant radius:

```typescript
const TARGET_ARC_PIXELS = 60; // dp — arc radius in screen pixels at all zoom levels
```

Lines 1671-1677 calibrate this into geographic degrees at the current zoom:
- `dpToDegreesLon` = how many degrees of longitude correspond to 60 screen pixels
- `dpToDegreesLat` = how many degrees of latitude correspond to 60 screen pixels

All sector arcs use these values directly as their radius (lines 1731-1761). This means:
- Every arc is always exactly 60dp on screen regardless of zoom level
- A 5 NM light and a 15 NM light draw identical arcs — VALNMR is ignored
- At low zoom levels, 60 screen pixels may represent MORE than the light's actual nominal range, making the arc extend beyond the physical reach of the light (violating maritime safety standards)

### Required Behavior

The arc radius must follow this logic gate:

```
Display_Radius = min(VALNMR_in_geographic_degrees, Screen_Constant_60dp_in_geographic_degrees)
```

- **At low zoom (zoomed out):** VALNMR in degrees is small compared to 60dp in degrees. The VALNMR ceiling wins. The arc is physically bounded — it never extends beyond the light's actual range.
- **At high zoom (zoomed in):** 60dp in degrees is small compared to VALNMR in degrees. The screen constant wins. The arc stays at a readable 60dp on screen, preventing it from going off-canvas.
- **If VALNMR is absent** (`undefined`/`null`): Fall back to the existing 60dp screen-constant behavior (no physical ceiling).

### Fix Location

`src/components/DynamicChartViewer.native.tsx`, inside the `for (const light of sectorLights)` loop, between the ECDIS usage band filter (line 1717) and the bearing calculations (line 1719).

### Required Change

After the existing filter checks and before the bearing calculations, compute per-light effective radius values:

```typescript
// Physical ceiling + mobile clamp: min(VALNMR_degrees, screen_constant_degrees)
// VALNMR is in nautical miles. 1 NM = 1/60 degree of latitude.
let effectiveRadiusLon = dpToDegreesLon;
let effectiveRadiusLat = dpToDegreesLat;

if (light.valnmr != null && light.valnmr > 0) {
  const valnmrDegreesLat = light.valnmr / 60;
  const valnmrDegreesLon = valnmrDegreesLat / Math.cos(light.lat * Math.PI / 180);
  effectiveRadiusLon = Math.min(valnmrDegreesLon, dpToDegreesLon);
  effectiveRadiusLat = Math.min(valnmrDegreesLat, dpToDegreesLat);
}
```

Then replace all uses of `dpToDegreesLon` and `dpToDegreesLat` within the rest of that loop iteration (leg endpoints at lines 1731-1738 and arc points at lines 1759-1761) with `effectiveRadiusLon` and `effectiveRadiusLat`.

Specifically, these six lines change from `dpToDegreesLon`/`dpToDegreesLat` to `effectiveRadiusLon`/`effectiveRadiusLat`:

- Line 1732: `light.lon + dpToDegreesLon * Math.sin(startRad)` → `light.lon + effectiveRadiusLon * Math.sin(startRad)`
- Line 1733: `light.lat + dpToDegreesLat * Math.cos(startRad)` → `light.lat + effectiveRadiusLat * Math.cos(startRad)`
- Line 1736: `light.lon + dpToDegreesLon * Math.sin(endRad)` → `light.lon + effectiveRadiusLon * Math.sin(endRad)`
- Line 1737: `light.lat + dpToDegreesLat * Math.cos(endRad)` → `light.lat + effectiveRadiusLat * Math.cos(endRad)`
- Line 1760: `light.lon + dpToDegreesLon * Math.sin(bearingRad)` → `light.lon + effectiveRadiusLon * Math.sin(bearingRad)`
- Line 1761: `light.lat + dpToDegreesLat * Math.cos(bearingRad)` → `light.lat + effectiveRadiusLat * Math.cos(bearingRad)`

Do NOT change `dpToDegreesLon`/`dpToDegreesLat` where they are used for viewport bounds calculation (lines 1682-1690) — those must remain based on the full 60dp screen constant.

---

## Files to Modify (Summary)

| File | Changes |
|---|---|
| `cloud-functions/enc-converter/compose_job.py` | 1. Fix `dedup_key()` for OBJL=75 to include SECTR1/SECTR2/COLOUR. 2. Add `valnmr` to `sector_lights_index` entry. |
| `cloud-functions/enc-converter/src/convert_s57.ts` | 1. Add `valnmr` to `SectorLight` interface. 2. Add `valnmr` to sidecar push. |
| `src/components/DynamicChartViewer.native.tsx` | 1. Add `valnmr` to `SectorLight` interface. 2. Add per-light effective radius calculation. 3. Replace `dpToDegreesLon/Lat` with `effectiveRadiusLon/Lat` in the 6 geometry lines within the arc generation loop. |

## Files NOT to Modify

- `src/utils/chartRendering.ts` — Contains `generateSectorLines()` and `extractSectorFeatures()`. These appear to be legacy/utility functions not in the active rendering path. Leave them as-is.
- `assets/symbols/lua/lights.lua` and `light_functions.lua` — Esri reference scripts, not used by the app renderer.

## Important Notes

- After these code changes, existing district packs will need to be re-converted/re-composed to populate the updated `sector_lights` metadata with VALNMR and the previously-deduplicated sectors. The app-side changes are backward compatible — `valnmr` is optional, so old data without it will fall back to the existing 60dp constant.
- There are no tests in this project.
- Do not modify any files beyond those listed. Do not add comments, docstrings, or type annotations to code you did not change. Do not refactor surrounding code.

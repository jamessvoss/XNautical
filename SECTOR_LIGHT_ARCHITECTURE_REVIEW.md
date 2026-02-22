# Sector Light & Rendering Architecture Deep Dive

## Mission

Perform a comprehensive architectural review of the XNautical chart rendering system with special emphasis on sector light arc rendering. The goal is to propose a **reliable, performant, and S-52 compliant** approach to displaying light sector arcs. The current implementation is unstable — arcs appear/disappear inconsistently, and multiple approaches have failed.

---

## Current System Architecture

### Conversion Pipeline

```
S-57 .000 files
  → cloud-functions/enc-converter/src/convert_s57.ts (TypeScript S-57 parser)
    → ISO 8211 → S-57 decode → GeoJSON
    → Post-processing: LIGHTS get _ORIENT, SECTR1/SECTR2 preserved as properties
    → SOUNDG MultiPoint split into individual Points
    → Navigation aids (LIGHTS, buoys, beacons) get tippecanoe minzoom=0
  → tippecanoe
    → MBTiles vector tiles (per-chart, then merged into per-district unified packs)
```

Key converter file: `cloud-functions/enc-converter/src/convert_s57.ts`

### App Rendering

```
MBTiles on device
  → Local tile server (serves .pbf tiles)
  → MapLibre React Native VectorSource (single unified source, z0-15)
    → ~60 MapLibre layers per source (SymbolLayer, FillLayer, LineLayer, CircleLayer)
    → Each layer filtered by OBJL (S-57 object class) + scaminFilter
```

Key app file: `src/components/DynamicChartViewer.native.tsx` (~6700 lines)

### Layer Architecture

All chart features live in a single MVT layer called `charts`. MapLibre layers filter by `OBJL` property:
- OBJL=75: LIGHTS (rendered as SymbolLayer with teardrop icons)
- OBJL=17/14/18/19/16/15: Buoys (SymbolLayer)
- OBJL=7/9/5/6/8: Beacons (SymbolLayer)
- OBJL=42: DEPARE (FillLayer) — depth areas
- OBJL=129: SOUNDG (SymbolLayer) — soundings
- etc.

### SCAMIN Filter

Controls feature visibility based on the S-57 SCAMIN (Scale Minimum) attribute:

```javascript
const scaminFilter = ['any',
  ['!', ['has', 'SCAMIN']],
  ['>=', ['floor', ['zoom']],
   ['floor', ['-', 28 - scaminOffset,
    ['/', ['ln', ['to-number', ['get', 'SCAMIN']]], ['ln', 2]]]]]
];
```

- `scaminOffset` comes from user's "Chart Detail" setting: low(-1), medium(0), high(1), ultra(2), max(4)
- Formula: feature visible when `zoom >= 28 - offset - log2(SCAMIN)`
- SCAMIN is stored as STRING in MVT tiles — the `['to-number', ...]` coercion is critical (discovered as a bug fix during this work)

### Scale Sources

The app supports two modes:
1. **Unified pack** (current): Single VectorSource `charts-unified` covering z0-15
2. **Per-scale packs** (legacy): Separate VectorSources per NOAA scale (US1 z0-6, US2 z4-10, etc.)

The `activeScaleSources` memo filters which sources are active at current zoom, but ALL sources are always mounted in the JSX (for stable layer ordering). VectorSource `minZoomLevel`/`maxZoomLevel` prevents tile loading outside range.

---

## The Sector Light Problem

### What S-52 Requires

Per IHO S-52 Presentation Library and confirmed through research:

1. **SCAMIN controls visibility**: Light AND its arcs appear/disappear together based on SCAMIN threshold
2. **Default mode**: Sector legs drawn at fixed **25mm screen size** (~60dp). Arc connects the leg endpoints. This is screen-constant — same physical size on screen regardless of zoom.
3. **Full sectors mode (optional)**: Legs extend to VALNMR (nominal range in NM) — geographic distance that scales with zoom
4. **Sector bearings**: SECTR1/SECTR2 are "true bearings FROM SEAWARD towards the light". To get the direction the light shines outward, add 180°.

### What Was Tried and Why It Failed

#### Attempt 1: Baked arcs in converter (original, pre-this-work)
- Generated LineString arc geometries at fixed 0.15 NM geographic radius in `convert_s57.ts`
- Put them in a separate `arcs` MVT layer
- Rendered with MapLibre LineLayer
- **Problem**: Fixed geographic radius = arcs invisible at low zoom (sub-pixel), only visible at z14-15. Not S-52 compliant.

#### Attempt 2: Client-side arc generation via queryRenderedFeaturesInRect on SymbolLayer
- Removed arc generation from converter
- App queries visible LIGHTS SymbolLayer features, generates arc LineString geometries in JavaScript
- Renders arcs via ShapeSource + LineLayer
- **Problem**: `queryRenderedFeaturesInRect` on SymbolLayers returns **wildly inconsistent results**. The MapLibre symbol placement engine has internal state that affects what features are "rendered" and queryable. Same viewport, same zoom — different results on consecutive calls. Arcs appear and disappear randomly.

#### Attempt 3: Invisible CircleLayer for querying (with scaminFilter)
- Added a tiny CircleLayer (radius 1, opacity 0.01) for LIGHTS with SECTR1, using scaminFilter
- Query this layer instead of SymbolLayer for more reliable results
- **Problem**: Still inconsistent. CircleLayer queries might be more reliable than SymbolLayer, but the fundamental approach of querying rendered features and generating geometries in JavaScript is fragile.

#### Attempt 4: Accumulator pattern
- Accumulated known sector lights in a Map ref across queries
- Only removed lights that left the viewport
- Cleared on zoom change (different SCAMIN visibility)
- **Problem**: Complexity explosion. Stale data, timing issues with debounced updates, zoom change clearing. Didn't solve the fundamental query unreliability.

#### Attempt 5: Screen-space calibration for arc radius
- Used `getPointInView`/`getCoordinateFromView` to calibrate dp-to-degrees conversion directly from the map
- Avoided metersPerPixel formula issues with PixelRatio (device is 2.625x)
- **Status**: Untested/inconclusive due to the query reliability being the blocking issue

### Core Technical Issues Discovered

1. **SCAMIN stored as string in MVT**: `['ln', ['get', 'SCAMIN']]` fails silently (NaN). Fixed with `['to-number', ['get', 'SCAMIN']]`.

2. **queryRenderedFeaturesInRect is unreliable for SymbolLayers**: MapLibre's symbol placement engine makes results inconsistent. Not a bug per se — it's inherent to how symbol rendering works.

3. **PixelRatio mismatch**: Device has PixelRatio=2.625. The standard metersPerPixel formula `156543.03 * cos(lat) / 2^zoom` may not account for this correctly, causing arc radius to be wrong.

4. **onMapIdle doesn't exist** in this version of MapLibre React Native. Was silently ignored. Event-driven arc updates had to be moved to `onRegionDidChange` → `processCameraState`.

5. **Same light appears in multiple chart scales with different SCAMIN values**: E.g., Homer light has SCAMIN=59999 in US5 chart, SCAMIN=259999 in US4 chart. Both copies exist in unified tiles.

6. **Antimeridian crossing**: Lights near 180° (western Aleutians) can generate arc coordinates that cross the antimeridian, causing MapLibre rendering artifacts.

---

## Key Files to Review

### Converter
- `cloud-functions/enc-converter/src/convert_s57.ts` — Main conversion, LIGHTS processing (lines 175-198)
- `cloud-functions/enc-converter/CLAUDE.md` — Architecture overview

### App Rendering
- `src/components/DynamicChartViewer.native.tsx` — Main file (~6700 lines):
  - Lines ~860-872: Sector arc state declarations
  - Lines ~1730-1860: Arc update function (`updateSectorArcsRef`)
  - Lines ~2530-2560: scaminFilter definition
  - Lines ~2554-4200: `renderChartLayers()` — all ~60 layer definitions
  - Lines ~3780-3820: LIGHTS SymbolLayer + CircleLayer query layer
  - Lines ~4460-4490: ShapeSource for dynamic arcs
  - Lines ~4477-4485: VectorSource mounting

### Supporting
- `src/components/DynamicChartViewer/constants.ts` — NAV_SYMBOLS, icon mappings
- `src/components/DynamicChartViewer/layerState.ts` — Layer visibility defaults
- `node_modules/@maplibre/maplibre-react-native/src/components/MapView.tsx` — Available events and query methods

---

## Data Flow for Sector Lights

```
S-57 .000 file
  → convert_s57.ts extracts LIGHTS features with SECTR1, SECTR2, COLOUR, SCAMIN, _ORIENT
  → tippecanoe embeds in MVT tiles (minzoom=0 for nav aids)
  → Unified MBTiles on device
  → Tile server serves .pbf
  → MapLibre VectorSource loads tiles
  → LIGHTS SymbolLayer renders teardrop icon (with scaminFilter)
  → [BROKEN] JavaScript queries rendered features, generates arc LineStrings
  → [BROKEN] ShapeSource renders arcs as LineLayer
```

The broken part is everything after the SymbolLayer render. The light SYMBOLS themselves render correctly and consistently. It's the arc generation that's unstable.

---

## Questions for the Review

1. **Is client-side query + JS geometry generation the right approach at all?** Or should arcs be pre-computed in the conversion pipeline?

2. **If pre-computed**: How to achieve screen-constant sizing? Options:
   - Multiple arc geometries at different radii, with tippecanoe minzoom/maxzoom per set
   - Single geographic radius with MapLibre style expression for line width/opacity to simulate size
   - Something else?

3. **If client-side**: How to make queries reliable? Options:
   - Different query layer type (CircleLayer vs SymbolLayer)
   - querySourceFeatures instead of queryRenderedFeatures (not available in this MapLibre RN version)
   - Parse tile data directly
   - Cache arc data more aggressively

4. **Hybrid approach?**: Could we pre-compute arc data (not geometry, just the sector light positions + bearings) and embed it differently so it's accessible without unreliable feature queries?

5. **Performance**: The app has ~60 layers per VectorSource. Any architectural improvements to the rendering pipeline?

6. **Caching**: Are layers being recreated unnecessarily? The `renderChartLayers()` function is called with a prefix — is the output properly memoized?

---

## Relevant S-57 Properties on LIGHTS Features

| Property | Type | Description |
|----------|------|-------------|
| OBJL | number | Always 75 for LIGHTS |
| SECTR1 | number | Sector start bearing (from seaward) |
| SECTR2 | number | Sector end bearing (from seaward) |
| COLOUR | number/string | Light color: 1=white, 3=red, 4=green, 6=orange |
| VALNMR | number | Nominal range in nautical miles |
| SCAMIN | string(!) | Minimum scale for display (string in MVT!) |
| _ORIENT | number | Pre-computed orientation for icon rotation |
| CHART_ID | string | Source chart identifier |
| _chartId | string | Source chart (for dedup) |
| _scaleNum | number | NOAA scale number (1-6) |

---

## MapLibre React Native Constraints

- **No `onMapIdle` event** — use `onRegionDidChange` instead
- **No `querySourceFeatures`** — only `queryRenderedFeaturesAtPoint` and `queryRenderedFeaturesInRect`
- **`queryRenderedFeaturesInRect(bbox, filter, layerIDs)`** — bbox format: `[top, right, bottom, left]` in screen pixels
- **SymbolLayer queries are unreliable** — symbol placement engine internals
- **Available coordinate methods**: `getPointInView(coordinate)` → screen point, `getCoordinateFromView(point)` → geographic coordinate
- **PixelRatio**: 2.625 on test device. `Dimensions.get('window')` returns logical pixels.

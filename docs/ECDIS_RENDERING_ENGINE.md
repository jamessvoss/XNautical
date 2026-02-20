# ECDIS Hybrid Rendering Engine — Architecture Plan

## Goal
Replace the current MBTiles pre-processing pipeline with real-time S-57 rendering that achieves professional ECDIS-quality display for recreational use. Hybrid approach: MapLibre handles base geometry rendering, a custom S-52 overlay layer handles symbols, text, patterns, and sector lights.

## Current Architecture (MBTiles Pipeline)

```
S-57 .000 files
    → GDAL/scripts pre-process
    → MBTiles (vector tiles in SQLite)
    → Upload to Firebase Storage
    → Download to device
    → MapLibre renders via style layers
```

### Limitations of this approach
- **No dynamic safety contour** — changing vessel draft requires re-processing all tiles
- **No real-time tide correction of depth areas** — only point soundings can be adjusted
- **No mariner-selectable symbol changes** — symbology baked into tiles at processing time
- **No proper S-52 pick reports** — tile properties are lossy compared to raw S-57 attributes
- **Update files (.001+) require full re-tiling** — can't patch incrementally
- **Pre-processing is slow and fragile** — GDAL pipeline, upload, download for every update
- **Tile boundaries create artifacts** — features split across tile edges

## Proposed Architecture (Hybrid Real-Time)

```
S-57 .000 files (on device, ~50-200MB per region)
    → ISO 8211 parser (proven in XNautical-test)
    → S-57 decoder → S57Dataset (features, nodes, edges)
    → S-52 symbology engine → rendering instructions
    ↓
    ├── MapLibre layer (base geometry)
    │   └── Depth areas, land, coastlines, contours, restricted areas
    │       (polygons + lines — MapLibre excels here)
    │
    └── Custom S-52 overlay (symbols, text, patterns)
        └── Point symbols, text labels, soundings, pattern fills,
            sector lights, overscale indication
            (Canvas/Skia — full S-52 control)
```

### Why hybrid instead of full custom
- MapLibre is excellent at rendering thousands of polygons/lines with GPU acceleration
- Depth areas, coastlines, contour lines, restricted area polygons — these render perfectly in MapLibre and represent the heaviest geometry load
- The S-52 rendering challenges are almost entirely about **point features and text** — symbols, light descriptions, sounding groups, pattern fills
- Building a full map engine (tile management, GPU rendering, pan/zoom/rotation, camera projection) from scratch would take 12-18 months and duplicate what MapLibre already does well

## Component Breakdown

### Layer 1: MapLibre (Base Geometry)

**What it renders:**
- Depth areas (DEPARE) — color-coded polygons
- Land areas (LNDARE) — fill polygons
- Coastline (COALNE) — line geometry
- Depth contours (DEPCNT) — line geometry
- Restricted areas (RESARE, CTNARE, etc.) — semi-transparent polygons
- Cables, pipelines, fairways — line geometry
- Built-up areas, buildings — fill polygons

**Data flow:**
- S-57 area/line features → GeoJSON FeatureCollection
- S-52 symbology engine generates MapLibre style layers (AC, LS, LC, AP instructions)
- Feed to MapLibre ShapeSource as today, but from real-time parsed data instead of MBTiles

**Why MapLibre works here:**
- Polygons and lines don't need S-52-specific rendering
- MapLibre handles thousands of features with GPU acceleration
- Pan/zoom/rotation/tilt all work natively
- Filter expressions handle display category, SCAMIN, feature toggling

### Layer 2: Custom S-52 Overlay (Symbols + Text)

**What it renders:**
- Point symbols (SY instruction) — buoys, beacons, lights, wrecks, rocks, landmarks
- Text labels (TX/TE instructions) — soundings, feature names, light descriptions
- Sector lights — arc geometry with angular extents and colors
- Area patterns (AP instruction) — DIAMOND1, hachures, stipple fills
- Overscale indication — checkerboard pattern for areas outside ENC coverage
- Complex line patterns (LC instruction) — e.g., overhead cable symbols along a line

**Rendering technology options:**

| Option | Pros | Cons |
|--------|------|------|
| `react-native-skia` | GPU-accelerated, vector drawing, shader support, cross-platform | Additional dependency, learning curve |
| React Native Canvas | Familiar API, good for 2D | No GPU acceleration, may be slow with many symbols |
| Custom native module (Metal/OpenGL) | Maximum performance, full control | Platform-specific code, complex |
| MapLibre custom layer (addLayer with custom render) | Integrated with map camera | Limited API, hard to do complex S-52 rendering |

**Recommended: `react-native-skia`**
- GPU-accelerated 2D drawing with Skia (same engine Chrome and Android use)
- Supports paths, arcs, gradients, text layout, image drawing
- Can render as an overlay on top of MapLibre
- Handles coordinate transforms (geo → screen) efficiently
- Cross-platform (iOS + Android)

### Layer 3: Interaction Layer

**What it handles:**
- Feature picking (tap → identify feature → show S-57 attributes)
- Cursor queries (long press → show all features at location)
- Danger highlighting (proximity to hazards)
- Measurement tools
- Route interaction (drag waypoints)

## S-52 Vector Symbol Library

### Current state (XNautical-test)
- 55 PNG icons with @2x/@3x retina variants
- Static raster images, can't recolor for night mode
- Limited to the shapes we've drawn

### Target state
- S-52 symbol library defines ~600 symbols as **vector drawing instructions**
- Each symbol is a sequence of: lines, arcs, circles, filled areas, with specific colors
- Rendering a symbol = executing its drawing instructions at the target coordinate

### Implementation approach
1. Parse the S-52 symbol library (`.dai` file or equivalent data) into a structured format
2. Each symbol becomes a function: `drawSymbol(canvas, symbolName, x, y, rotation, colorTable)`
3. The function draws lines, arcs, fills using Skia primitives
4. Color tokens resolve against the active color table (DAY/DUSK/NIGHT)
5. Symbols automatically adapt to night mode — no separate PNG sets needed

### Symbol categories to implement
| Category | Count | Examples |
|----------|-------|---------|
| Buoys (BOYCAR, BOYLAT, etc.) | ~40 | Lateral, cardinal, isolated danger, safe water, special |
| Beacons (BCNCAR, BCNLAT, etc.) | ~30 | Lattice, tower, stake, cairn, with topmarks |
| Lights (LIGHTS) | ~20 | Flare symbols, sector arcs, directional |
| Wrecks (WRECKS) | ~10 | Dangerous, non-dangerous, hull showing |
| Rocks (UWTROC) | ~8 | Submerged, awash, above water, covers/uncovers |
| Landmarks (LNDMRK) | ~25 | Tower, church, chimney, monument, windmill |
| Navigation aids | ~30 | Fog signals, radar reflectors, daymarks |
| Topmarks | ~20 | Cone, cylinder, sphere, diamond, cross |
| Miscellaneous | ~100+ | Anchoring, fishing, restricted, military, nature reserves |

## Text Rendering (S-52 Compliant)

### S-52 text rules
- **Sounding groups**: depth values positioned relative to the sounding point, with whole and fractional parts at different sizes
- **Light descriptions**: abbreviated characteristics (e.g., "Fl(3)R 15s 21m 15M") positioned relative to the light symbol
- **Feature names**: OBJNAM placed with specific justification (left/center/right, top/center/bottom)
- **Priority-based placement**: higher priority text suppresses lower priority text
- **No text-on-text overlap**: S-52 specifies its own de-confliction rules (different from MapLibre's)

### Implementation
- Custom text layout engine that follows S-52 placement rules
- Render via Skia text primitives with proper font metrics
- Sounding text uses subscript for fractional part
- Text halos for readability over colored backgrounds
- Text suppression based on display priority and available space

## Sector Light Rendering

### What sector lights need
- Arc segments drawn at configurable radius from the light position
- Each sector has: start bearing, end bearing, color, visibility (visible/faint/obscured)
- Arcs drawn in geographic coordinates (bearings are true north relative)
- Multiple sectors per light, potentially overlapping
- Directional lights show a narrow beam line

### Implementation
- Calculate screen-space arc geometry from geographic bearings
- Draw filled arcs with S-52 sector colors
- Handle wrap-around (e.g., sector from 350° to 010°)
- Faint sectors drawn with reduced opacity
- Obscured sectors drawn with dashed arcs

## Area Pattern Fills

### S-52 patterns needed
| Pattern | Used for |
|---------|----------|
| DIAMOND1 | Anchorage areas |
| HCLIFF11 | Cliff hachures |
| OVERSC01 | Overscale indication (checkerboard) |
| TSSJCT02 | Traffic separation junctions |
| DRGARE01 | Dredged areas |
| Various | Military areas, nature reserves, etc. |

### Implementation options
1. **Skia shader patterns**: Define repeating tile patterns as Skia shaders, apply to polygon geometry
2. **Pre-rendered pattern tiles**: Small repeating images tiled across polygon bounds
3. **MapLibre fill-pattern**: MapLibre supports `fill-pattern` with sprite images — may work for simple cases

## Coordinate Transforms

### The bridge between MapLibre and the overlay
- MapLibre manages the camera (center, zoom, bearing, pitch)
- The custom overlay needs to project geographic coordinates (lon, lat) to screen pixels
- On every frame (pan/zoom/rotate), the overlay must re-render at the correct positions

### Implementation
- Subscribe to MapLibre camera change events
- Use MapLibre's `getPointInView([lon, lat])` to project geo → screen coordinates
- For bulk transforms (thousands of symbols), use the map's projection matrix directly
- Throttle re-renders to animation frame rate (60fps)
- Hybrid culling: only render features within the visible viewport ± buffer

## Data Flow (Complete Pipeline)

```
1. User installs region
   → Download S-57 .000 files to device storage (~50-200MB per district)
   → Download update files (.001, .002, ...)

2. User opens chart at location
   → Determine which .000 cells cover the viewport (by scale + bounds)
   → Parse each cell: ISO 8211 → S57Dataset (cached after first parse)
   → Apply update files incrementally

3. For each visible cell:
   → S-52 symbology engine processes features
   → Area/line features → GeoJSON → MapLibre ShapeSource
   → Point features → S-52 overlay render list
   → Text features → S-52 overlay text list

4. On camera change (pan/zoom/rotate):
   → MapLibre re-renders base geometry (automatic)
   → Custom overlay re-projects and re-renders symbols + text
   → SCAMIN filtering updates (features appear/disappear by zoom)
   → Cell loading updates (new cells loaded as viewport moves)

5. On setting change (safety depth, color table, display category):
   → Re-run S-52 symbology for affected features
   → MapLibre layers update styles
   → Custom overlay re-renders with new symbology
```

## Performance Considerations

### Parsing
- ISO 8211 parsing: ~500ms for a typical ENC cell (proven in XNautical-test)
- Cache parsed S57Dataset in memory (LRU cache, ~10-20 cells)
- Parse on background thread (React Native JSI or worker)

### Rendering
- MapLibre base layer: handles 100K+ polygons/lines at 60fps (proven)
- Custom overlay: typical chart has 500-2000 point features visible at any zoom
- Skia can render 2000+ shapes per frame at 60fps
- Culling to viewport reduces render count by 80-90%

### Memory
- Single ENC cell parsed: ~5-20MB depending on complexity
- 10 cells cached: ~50-200MB (manageable on modern devices)
- GeoJSON for MapLibre: ~10-50MB per viewport (similar to current MBTiles approach)

### Battery
- MapLibre GPU rendering is efficient (hardware accelerated)
- Custom overlay only re-renders on camera change (not continuous)
- S-57 parsing is one-time per cell (cached)

## Migration Path

### Phase 1: Real-time S-57 → MapLibre (no MBTiles)
- Port XNautical-test's parser into XNautical
- Replace MBTiles ShapeSource with GeoJSON ShapeSource from parsed S-57
- Keep current MapLibre-only rendering (PNGs for symbols)
- Ship S-57 .000 files instead of MBTiles
- **Result**: eliminates the pre-processing pipeline, enables dynamic safety contour

### Phase 2: Custom overlay for symbols
- Add react-native-skia overlay on top of MapLibre
- Move point symbol rendering from MapLibre SymbolLayer to Skia
- Implement S-52 vector symbols (replace PNGs)
- Implement proper sounding text layout
- **Result**: crisp vector symbols, night mode recoloring, S-52 text placement

### Phase 3: Advanced S-52 features
- Sector light rendering with arcs
- Area pattern fills
- Complex line patterns
- Overscale indication
- Pick reports with full S-57 attributes
- **Result**: near-complete S-52 presentation library compliance

### Phase 4: Multi-cell management
- Cell loading/unloading based on viewport and scale
- Update file (.001+) application
- Chart adequacy warnings
- **Result**: full ENC data management without pre-processing

## Key Dependencies

| Dependency | Purpose | Status |
|------------|---------|--------|
| ISO 8211 parser | S-57 binary parsing | Built (XNautical-test) |
| S-57 decoder | Feature/spatial extraction | Built (XNautical-test) |
| S-52 symbology engine | Instruction generation | Built (XNautical-test) |
| MapLibre React Native | Base geometry rendering | Already in use |
| react-native-skia | Custom overlay rendering | To be added |
| S-52 symbol data | Vector symbol definitions | To be sourced/created |
| S-52 color tables | DAY/DUSK/NIGHT palettes | Already implemented |
| S-52 lookup tables | Feature → instruction mapping | Partially built |

## Open Questions

1. **S-57 file distribution**: Ship .000 files directly to devices, or keep a lighter intermediate format? Raw S-57 files are larger than MBTiles but contain full fidelity.
2. **Skia vs native**: Is react-native-skia performant enough for 2000+ symbols at 60fps, or do we need a native Metal/OpenGL module?
3. **S-52 symbol data source**: Parse the official .dai symbol library, or hand-build the ~600 symbols as Skia drawing functions?
4. **Cell caching strategy**: Cache parsed S57Dataset to disk (serialized) for instant reload, or re-parse from .000 each time?
5. **Update file handling**: Apply .001/.002 updates incrementally to the cached dataset, or re-parse the base + updates together?

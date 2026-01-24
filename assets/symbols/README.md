# S-52 Nautical Chart Symbols

This folder contains INT1/S-52 standard nautical chart symbols from the [Esri nautical-chart-symbols](https://github.com/Esri/nautical-chart-symbols) repository.

## License

These symbols are licensed under the Apache License 2.0. See `ESRI_LICENSE.txt` for details.

## Folder Structure

```
symbols/
├── point/          # Point symbols (lights, buoys, beacons, wrecks, etc.)
├── line/           # Line patterns (cables, pipelines, restricted areas)
├── lua/            # Lua scripts showing symbolization logic (reference only)
├── ESRI_LICENSE.txt
├── ESRI_README.md
└── README.md       # This file
```

## Symbol Categories

### Point Symbols (`point/`)

#### Lights (P1, Light_Flare)
| Symbol | File | S-57 COLOUR Code |
|--------|------|------------------|
| Light (white) | `P1_Light_white.svg`, `Light_Flare_white.svg` | 1, 6, 9, 11 |
| Light (red) | `P1_Light_red.svg`, `Light_Flare_red.svg` | 3 |
| Light (green) | `P1_Light_green.svg`, `Light_Flare_green.svg` | 4 |
| Light (default/magenta) | `P1_Light.svg`, `Light_Flare.svg` | Other |
| Fixed light | `P1_Light-fixed.svg` | - |
| Lighted beacon | `P4_Lighted_beacon.svg` | - |
| Flood light | `P63_Flood_light.svg` | - |
| Strip light | `P64_Strip_light.svg` | - |

#### Buoys (Q20-Q26)
| Symbol | File | Description |
|--------|------|-------------|
| Conical buoy | `Q20a_Conical_buoy.svg`, `Q20b_Conical_buoy.svg` | Nun buoy |
| Can buoy | `Q21a_Can_buoy.svg`, `Q21b_Can_buoy.svg` | Cylindrical |
| Spherical buoy | `Q22a/b/c_Spherical_buoy.svg` | Round |
| Pillar buoy | `Q23a/b/c_Pillar_buoy.svg` | Tall pillar |
| Spar buoy | `Q24_Spar_buoy.svg` | Pole-shaped |
| Barrel buoy | `Q25a/b_Barrel_buoy.svg` | Barrel-shaped |
| Super buoy | `Q26_Super_buoy.svg` | Large navigational buoy |
| Light float | `Q30_Light_float.svg`, `Q31_Light_float.svg` | Floating light |
| Light vessel | `Q32_Light_vessel.svg` | Lightship |
| Mooring buoy | `Q40a/b/c/d_Mooring_buoy.svg` | For vessel mooring |

#### Beacons (Q80-Q130)
| Symbol | File | Description |
|--------|------|-------------|
| Beacon | `Q80_Beacon.svg` | Generic beacon |
| Beacon (submerged rock) | `Q83_Beacon_submerged_rock.svg` | Marks underwater rock |
| Stake/pole | `Q90_Stake_pole.svg` | Simple marker |
| Perch | `Q91_Port_hand_perch.svg`, `Q91_Lateral_hand_perch.svg` | Lateral marker |
| Withy | `Q92_Withy_port.svg`, `Q92_Withy_starboard.svg` | Branch marker |
| Cairn | `Q100_cairn.svg` | Stone pile marker |
| Mark | `Q101_Mark.svg` | Generic mark |
| Beacon tower | `Q110a/b_Beacon_tower.svg` | Tower beacon |
| Lattice beacon | `Q111_Lattice_beacon.svg` | Metal framework |
| Cardinal marks | `Q130_3_topmark_N/E/S/W.svg` | IALA cardinal marks |
| Isolated danger | `Q130_4_Isolated_danger_mark.svg` | Danger marker |
| Safe water | `Q130_5_Safe_water_mark.svg` | Safe passage |
| Special mark | `Q130_6_Special_mark.svg` | Special purpose |

#### Topmarks (Q9)
| Symbol | File | Description |
|--------|------|-------------|
| Cone/Arrow | `Q9_Arrow.svg`, `Q9_Arrow_filled.svg` | Conical topmark |
| Cylinder | `Q9_Cylinder.svg`, `Q9_Cylinder_filled.svg` | Can topmark |
| Square | `Q9_Square.svg` | Square topmark |
| Rhombus | `Q9_Rhombus.svg` | Diamond topmark |
| Cross | `Q9_Cross.svg` | X-shaped topmark |

#### Wrecks & Obstructions (K)
| Symbol | File | Description |
|--------|------|-------------|
| Wreck (hull showing) | `K24_Wreck_showing_hull.svg` | Visible wreck |
| Wreck (submerged) | `K22_Wreck_submerged.svg` | Underwater wreck |
| Wreck (uncovers) | `K21_Wreck_uncovers.svg` | Tidal exposure |
| Wreck (dangerous) | `K25_Wreck_danger_no_depth.svg` | Navigation hazard |
| Wreck (not dangerous) | `K29_Wreck_notdangerous.svg` | Safe clearance |
| Wreck (swept) | `K30_Wreck_safe_clearance.svg` | Verified depth |
| Foul ground | `K31_Foul_ground.svg` | Anchoring hazard |
| Obstruction | `K1_Obstruction*.svg` | Various obstruction types |
| Rock (awash) | `K12a/b_Rock_awash.svg` | Covers/uncovers |
| Rock (underwater) | `K13a/b_Dangerous_underwater_rk.svg` | Submerged rock |
| Rock (uncovers) | `K11a/b_Rock_uncovers.svg` | Dries at low tide |
| Swept depth | `K27_SweptDepth.svg`, `K2_SweptDepth_magenta.svg` | Wire drag area |

#### Other Point Symbols
| Category | Files | Description |
|----------|-------|-------------|
| Landmarks | `E10_Church.svg`, `E20_Tower.svg`, `E22_Chimney.svg`, etc. | Prominent features |
| Platforms | `L10_Offshore_platform.svg`, `L16_Tanker_mooring.svg` | Offshore structures |
| Signals | `R1_Fog_signal.svg`, `S1_Ra_transponder*.svg` | Electronic aids |
| Harbors | `F10_Fishing_harbor.svg`, `F11_*.svg` | Port facilities |
| Anchorage | `N10_Reported_anchorage.svg`, `Q42_Ground_tackle.svg` | Anchoring areas |
| Prohibited | `N20_AnchoringProhibitedPoint.svg`, `N21_1_Fishing_ProhibitedPoint.svg` | Restrictions |

### Line Symbols (`line/`)

| Symbol | File | Description |
|--------|------|-------------|
| Cables | `L30_Cable.svg`, `L31_1_PowerCable.svg`, `L32_DisusedCable.svg` | Submarine cables |
| Pipelines | `L40_pipeline_supply.svg`, `L41_pipeline_outfall_intake.svg` | Underwater pipes |
| Navigation | `M1_NavigationLine.svg`, `M4_RecommendedTrack*.svg` | Shipping routes |
| Restricted | `N1_Limit_general.svg`, `N2_1_RestrictedArea.svg` | Area boundaries |
| Prohibited | `N2_2_EntryProhibited.svg`, `N20_AnchoringProhibited.svg` | No-go zones |
| Terrain | `C3_Cliffs.svg`, `C8_Dunes.svg`, `rock_ledge.svg` | Coastal features |
| Roads | `D11_Roadway.svg`, `D14_Cutting.svg`, `D15_Embankment.svg` | Land features |

## S-57 COLOUR Codes Reference

| Code | Color |
|------|-------|
| 1 | White |
| 2 | Black |
| 3 | Red |
| 4 | Green |
| 5 | Blue |
| 6 | Yellow |
| 7 | Grey |
| 8 | Brown |
| 9 | Amber |
| 10 | Violet |
| 11 | Orange |
| 12 | Magenta |
| 13 | Pink |

## Usage in React Native

These SVG files can be used with:
- `react-native-svg` for direct SVG rendering
- Convert to PNG for use as Mapbox symbol icons
- Use with `@shopify/react-native-skia` for advanced rendering

### Example: Converting SVG to Mapbox Icon

```typescript
// Using react-native-svg-transformer
import LightWhite from '../assets/symbols/point/P1_Light_white.svg';

// Or load as Mapbox image
await Mapbox.imageManager.addImage('light-white', require('./assets/symbols/point/P1_Light_white.svg'));
```

## Lua Reference Scripts

The `lua/` folder contains Esri's symbolization logic scripts. These are for **reference only** to understand how S-57 attributes map to symbols:

- `lights.lua` - Light symbolization rules
- `wrecks05.lua` - Wreck display rules
- `depare01.lua`, `depare03.lua` - Depth area styling
- `sounding.lua` - Sounding display rules

## Attribution

Symbols sourced from [Esri/nautical-chart-symbols](https://github.com/Esri/nautical-chart-symbols) - Apache 2.0 License.
